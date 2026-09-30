/**
 * Layout-plane tracking from markers.
 *
 * All markers lie flat on the layout. Their poses in a common *layout frame* (mm) form
 * the {@link MarkerMap}. Poses can be given in the layout file or are surveyed
 * automatically from the images: whenever an unknown marker is seen together with known
 * ones, its pose follows from the pairwise geometry of the markers (no camera
 * calibration needed, see `relativeMarkerPose`).
 *
 * Every frame, all visible known markers yield one least-squares homography
 * layout (mm) -> image (px). Many markers spread over the layout make this stable,
 * and hidden markers do not matter as long as some others are visible.
 * @module arail/core/tracker
 */
import { focalFromHomography, markerCorners, markerHomography, relativeMarkerPose, spread } from "./geometry.js";
import {
  applyH, homography4, homographyLS, inv3, lerp2, meanAngle, poseApply, poseCompose, poseInverse,
  toDeg, toRad, wrapAngle,
} from "./math.js";

/* ================================================================ marker map */

export class MarkerMap {
  /**
   * @param {object} [options]
   * @param {number} [options.size=30] edge length of the black marker square in mm
   * @param {Object<string, number>} [options.sizes] per-marker sizes in mm (by ID)
   * @param {Object<string, number[]>} [options.poses] known poses: ID -> [x_mm, y_mm, rotation_deg]
   * @param {number | null} [options.origin] marker that defines the layout frame when surveying
   */
  constructor({ size = 30, sizes = {}, poses = {}, origin = null } = {}) {
    this.size = size;
    this.sizes = { ...sizes };
    this.origin = origin;
    /** @type {Map<number, {x: number, y: number, theta: number, fixed: boolean}>} */
    this.entries = new Map();
    /** Marker the survey is anchored to (its pose never changes). */
    this.anchor = null;
    /** Incremented on every change, so dependants can cache derived geometry. */
    this.version = 0;
    for (const [id, p] of Object.entries(poses)) {
      this.set(Number(id), { x: +p[0], y: +p[1], theta: toRad(+p[2] || 0) }, true);
    }
    if (this.entries.size) this.anchor = this.origin != null && this.entries.has(this.origin) ? this.origin : this.ids()[0];
  }

  ids() {
    return [...this.entries.keys()].sort((a, b) => a - b);
  }

  has(id) {
    return this.entries.has(id);
  }

  get(id) {
    return this.entries.get(id) || null;
  }

  set(id, pose, fixed = false) {
    this.entries.set(id, { x: pose.x, y: pose.y, theta: wrapAngle(pose.theta), fixed });
    this.version++;
  }

  delete(id) {
    if (this.entries.delete(id)) this.version++;
    if (this.anchor === id) this.anchor = this.entries.size ? this.ids()[0] : null;
  }

  /** Forget surveyed poses; keep the ones marked fixed (unless `all`). */
  clear(all = false) {
    for (const [id, e] of this.entries) if (all || !e.fixed) this.entries.delete(id);
    if (!this.entries.has(this.anchor)) this.anchor = this.entries.size ? this.ids()[0] : null;
    this.version++;
  }

  /** Mark all current poses as fixed (they are no longer refined). */
  fixAll() {
    for (const e of this.entries.values()) e.fixed = true;
    this.version++;
  }

  sizeOf(id) {
    return this.sizes[id] ?? this.size;
  }

  /** Marker corners (TL, TR, BR, BL) in layout coordinates. */
  cornersInLayout(id) {
    const pose = this.entries.get(id);
    return markerCorners(this.sizeOf(id)).map((p) => poseApply(pose, p));
  }

  /** Express all poses relative to marker `id` (which becomes (0, 0, 0)). */
  rebase(id) {
    const ref = this.entries.get(id);
    if (!ref) return;
    const inv = poseInverse(ref);
    for (const [k, e] of this.entries) {
      const p = poseCompose(inv, e);
      this.entries.set(k, { ...p, fixed: e.fixed });
    }
    this.anchor = id;
    this.version++;
  }

  /** Poses as stored in layout files: ID -> [x_mm, y_mm, rotation_deg]. */
  toJSON() {
    const out = {};
    for (const id of this.ids()) {
      const e = this.entries.get(id);
      out[id] = [Math.round(e.x * 10) / 10, Math.round(e.y * 10) / 10, Math.round(toDeg(e.theta) * 100) / 100];
    }
    return out;
  }
}

/* ================================================================ tracker */

/**
 * @typedef {object} TrackingState
 * @property {number[] | null} H homography layout (mm) -> image (px), smoothed
 * @property {number[] | null} Hinv inverse of H
 * @property {number[]} visible IDs of all detected markers
 * @property {number[]} used IDs of the markers that determined H
 * @property {boolean} holding true while showing the last pose because no marker is visible
 * @property {number} rms reprojection error of H (px)
 */

export class PlaneTracker {
  /**
   * @param {MarkerMap} map
   * @param {object} [options]
   * @param {boolean} [options.survey=true] add and refine unknown markers automatically
   * @param {number} [options.holdSeconds=1.5] keep the last pose this long when all markers are hidden
   * @param {number} [options.minSurveyFrames=3] frames an unknown marker must be seen before it is used
   */
  constructor(map, { survey = true, holdSeconds = 1.5, minSurveyFrames = 3 } = {}) {
    this.map = map;
    this.survey = survey;
    this.holdSeconds = holdSeconds;
    this.minSurveyFrames = minSurveyFrames;
    this.acc = new Map(); // survey accumulators per marker ID
    this.reset();
  }

  /** Forget the current pose (e.g. when the video source changes). */
  reset() {
    this.H = null;
    this.Hinv = null;
    this.lastSeen = -Infinity;
    /** @type {TrackingState} */
    this.state = { H: null, Hinv: null, visible: [], used: [], holding: false, rms: 0 };
    this.markers = {};
  }

  /**
   * Measure the markers again: forget surveyed poses (with `all`, also the fixed ones;
   * the origin marker then defines the layout frame again when it is seen).
   */
  resurvey(all = true) {
    this.acc.clear();
    this.map.clear(all);
    this.reset();
  }

  /**
   * Process the markers detected in one frame.
   * @param {Object<number, number[][]>} detections marker ID -> image corners (px)
   * @param {number} time current time in seconds
   * @param {import("./camera.js").Camera} camera
   * @param {{still?: boolean}} [options] still = single photo: survey and pose without smoothing
   * @returns {TrackingState}
   */
  update(detections, time, camera, { still = false } = {}) {
    const markers = {};
    for (const [key, corners] of Object.entries(detections)) {
      const id = Number(key);
      const c = camera.undistortPoints(corners);
      const H = markerHomography(c, this.map.sizeOf(id));
      if (H && H.every(Number.isFinite)) markers[id] = { H, corners: c };
    }
    this.markers = markers;
    if (this.survey) this._survey(markers, still);

    const est = this._estimate(markers);
    let holding = false;
    if (est) {
      this._learnFocal(est, camera);
      this._smooth(est, still);
      this.lastSeen = time;
    } else if (this.H && time - this.lastSeen > this.holdSeconds) {
      this.H = null;
      this.Hinv = null;
    } else if (this.H) {
      holding = true;
    }
    this.state = {
      H: this.H,
      Hinv: this.Hinv,
      visible: Object.keys(markers).map(Number).sort((a, b) => a - b),
      used: est ? est.ids : [],
      holding,
      rms: est ? est.rms : 0,
    };
    return this.state;
  }

  /* ---------------------------------------------------------------- survey */

  _survey(markers, still) {
    const map = this.map;
    const ids = Object.keys(markers).map(Number).sort((a, b) => a - b);
    if (!ids.length) return;
    if (!map.entries.size) {
      const root = map.origin != null && markers[map.origin] ? map.origin : ids[0];
      map.set(root, { x: 0, y: 0, theta: 0 });
      map.anchor = root;
    }
    const known = ids.filter((id) => map.has(id));
    if (!known.length) return;
    for (const id of ids) {
      const entry = map.get(id);
      if (entry && (entry.fixed || id === map.anchor)) continue;
      const est = this._surveyEstimate(id, known.filter((k) => k !== id), markers);
      if (!est) continue;
      let a = this.acc.get(id);
      if (!a) this.acc.set(id, (a = { sx: 0, sy: 0, sc: 0, ss: 0, sw: 0, frames: 0 }));
      a.sx += est.w * est.x;
      a.sy += est.w * est.y;
      a.sc += est.w * Math.cos(est.theta);
      a.ss += est.w * Math.sin(est.theta);
      a.sw += est.w;
      a.frames++;
      if (a.frames > 200) {
        // keep adapting slowly if a marker is moved
        const k = 200 / a.frames;
        for (const key of ["sx", "sy", "sc", "ss", "sw"]) a[key] *= k;
        a.frames = 200;
      }
      if (still || a.frames >= this.minSurveyFrames || entry) {
        map.set(id, { x: a.sx / a.sw, y: a.sy / a.sw, theta: Math.atan2(a.ss, a.sc) });
      }
    }
    // A configured origin defines the layout frame as soon as it is known.
    if (map.origin != null && map.anchor !== map.origin && map.has(map.origin) && ![...map.entries.values()].some((e) => e.fixed)) {
      const inv = poseInverse(map.get(map.origin));
      map.rebase(map.origin);
      for (const a of this.acc.values()) {
        const p = poseCompose(inv, { x: a.sx / a.sw, y: a.sy / a.sw, theta: Math.atan2(a.ss, a.sc) });
        Object.assign(a, { sx: p.x * a.sw, sy: p.y * a.sw, sc: Math.cos(p.theta) * a.sw, ss: Math.sin(p.theta) * a.sw });
      }
      this.H = null; // the old pose refers to the previous frame
      this.Hinv = null;
    }
  }

  /** Pose of marker `id` from its geometry relative to the visible known markers. */
  _surveyEstimate(id, references, markers) {
    const size = this.map.sizeOf(id);
    const xs = [], ys = [], thetas = [], ws = [];
    for (const r of references) {
      const rel = relativeMarkerPose(markers[r].H, markers[id].H);
      if (!rel || rel.distance < 1.2 * Math.max(size, this.map.sizeOf(r))) continue;
      const ref = this.map.get(r);
      const [x, y] = poseApply(ref, [rel.dirA[0] * rel.distance, rel.dirA[1] * rel.distance]);
      const phi = Math.atan2(rel.dirA[1], rel.dirA[0]) - Math.atan2(rel.dirB[1], rel.dirB[0]);
      // position errors grow with the distance between the markers
      const w = 1 / (rel.distance ** 2 + (5 * size) ** 2);
      xs.push(x);
      ys.push(y);
      thetas.push(ref.theta + phi);
      ws.push(w);
    }
    if (!ws.length) return null;
    const sw = ws.reduce((a, b) => a + b, 0);
    return {
      x: xs.reduce((s, v, i) => s + v * ws[i], 0) / sw,
      y: ys.reduce((s, v, i) => s + v * ws[i], 0) / sw,
      theta: meanAngle(thetas, ws),
      w: sw,
    };
  }

  /* ---------------------------------------------------------------- pose */

  /** Least-squares homography from all visible known markers, dropping inconsistent ones. */
  _estimate(markers) {
    let ids = Object.keys(markers).map(Number).filter((id) => this.map.has(id));
    while (ids.length) {
      const src = [], dst = [];
      for (const id of ids) {
        src.push(...this.map.cornersInLayout(id));
        dst.push(...markers[id].corners);
      }
      const H = homographyLS(src, dst);
      if (!H || !H.every(Number.isFinite)) return null;
      let worst = null, sum2 = 0;
      for (const id of ids) {
        const lc = this.map.cornersInLayout(id), ic = markers[id].corners;
        let e = 0, edge = 0;
        for (let k = 0; k < 4; k++) {
          const p = applyH(H, lc[k]);
          const d = Math.hypot(p[0] - ic[k][0], p[1] - ic[k][1]);
          e += d / 4;
          sum2 += d * d;
          edge += Math.hypot(ic[k][0] - ic[(k + 1) % 4][0], ic[k][1] - ic[(k + 1) % 4][1]) / 4;
        }
        const limit = Math.max(3, 0.2 * edge);
        if (e > limit && (!worst || e / limit > worst.ratio)) worst = { id, ratio: e / limit };
      }
      if (worst && ids.length > 2) {
        ids = ids.filter((i) => i !== worst.id);
        continue;
      }
      return { H, ids, src, rms: Math.sqrt(sum2 / (4 * ids.length)) };
    }
    return null;
  }

  _learnFocal(est, camera) {
    if (camera.calibrated || camera.manualFocal || est.ids.length < 3) return;
    const centres = est.ids.map((id) => {
      const e = this.map.get(id);
      return [e.x, e.y];
    });
    if (spread(centres) < 40) return; // markers nearly on one line: focal length is ill-defined
    const r = focalFromHomography(est.H, camera.width / 2, camera.height / 2);
    const W = Math.max(camera.width, camera.height);
    if (r && r.tiltDeg >= 15 && r.tiltDeg <= 80 && r.f > 0.25 * W && r.f < 5 * W) camera.addFocalSample(r.f);
  }

  /** Smooth jitter while following fast camera motion without lag. */
  _smooth(est, still) {
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (const p of est.src) {
      xmin = Math.min(xmin, p[0]);
      ymin = Math.min(ymin, p[1]);
      xmax = Math.max(xmax, p[0]);
      ymax = Math.max(ymax, p[1]);
    }
    const ref = [[xmin, ymin], [xmax, ymin], [xmax, ymax], [xmin, ymax]];
    let H = est.H;
    if (this.H && !still) {
      const before = ref.map((p) => applyH(this.H, p));
      const now = ref.map((p) => applyH(est.H, p));
      let diff = 0;
      for (let k = 0; k < 4; k++) diff = Math.max(diff, Math.hypot(now[k][0] - before[k][0], now[k][1] - before[k][1]));
      const alpha = Math.min(1, 0.25 + diff / 12);
      const smoothed = homography4(ref, before.map((p, k) => lerp2(p, now[k], alpha)));
      if (smoothed && smoothed.every(Number.isFinite)) H = smoothed;
    }
    this.H = H;
    this.Hinv = inv3(H);
  }
}
