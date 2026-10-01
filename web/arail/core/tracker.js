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
 *
 * A *locked* map is complete (e.g. after a survey of the whole layout and "Keep positions"):
 * nothing is surveyed any more, markers that are not in the map are ignored, and misread or
 * moved markers are dropped from the pose as outliers. *Moving* markers (on vehicles, e.g.
 * container wagons) are never part of the map and never used for the pose; their detections
 * are reported in `state.moving`.
 * @module arail/core/tracker
 */
import { focalFromHomography, markerCorners, markerHomography, relativeMarkerPose, spread } from "./geometry.js";
import { markerIds } from "./layout.js";
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
   * @param {boolean} [options.locked=false] the map is complete: no survey, other markers are ignored
   * @param {number[]} [options.moving] IDs of markers on vehicles (never part of the map)
   */
  constructor(options = {}) {
    /** Incremented on every change, so dependants can cache derived geometry. */
    this.version = 0;
    /** Incremented by `configure`: trackers then start their survey afresh. */
    this.generation = 0;
    this.configure(options);
  }

  /** Replace sizes, origin, all poses and the locked and moving settings (e.g. when another layout is loaded). */
  configure({ size = 30, sizes = {}, poses = {}, origin = null, locked = false, moving = [] } = {}) {
    this.size = size;
    this.sizes = { ...sizes };
    this.origin = origin;
    /** @type {Map<number, {x: number, y: number, theta: number, fixed: boolean}>} */
    this.entries = new Map();
    /** Marker the survey is anchored to (its pose never changes). */
    this.anchor = null;
    /** Complete map: trackers survey nothing, markers not in the map are ignored. */
    this.locked = !!locked;
    /** IDs of markers on vehicles: never part of the map, never used for the pose. @type {Set<number>} */
    this.moving = new Set(markerIds(moving));
    /** Poses of the moving markers that were in the map: back in it when they are no longer moving. */
    this.parked = new Map();
    this.generation++;
    this.version++;
    for (const [id, p] of Object.entries(poses)) {
      const pose = { x: +p[0], y: +p[1], theta: wrapAngle(toRad(+p[2] || 0)), fixed: true };
      if (this.moving.has(Number(id))) this.parked.set(Number(id), pose); // a moving marker has no place in the map
      else this.set(Number(id), pose, true);
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
    for (const [id, e] of this.parked) if (all || !e.fixed) this.parked.delete(id);
    if (!this.entries.has(this.anchor)) this.anchor = this.entries.size ? this.ids()[0] : null;
    this.version++;
  }

  /** Mark all current poses as fixed (they are no longer refined). */
  fixAll() {
    for (const e of this.entries.values()) e.fixed = true;
    this.version++;
  }

  /** "Keep positions": fix all poses and lock the map (only these markers are used from now on). */
  lock() {
    this.fixAll();
    this.locked = true;
  }

  /** Unknown markers are surveyed again when they are seen together with known ones. */
  unlock() {
    this.locked = false;
  }

  /**
   * Set the markers on vehicles. Their poses are removed from the map (they are no longer part
   * of it) and kept aside: a marker that is no longer moving gets its pose back (e.g. after a
   * typo in the list), unless it was measured anew meanwhile. Returns the IDs that were removed.
   * @param {Iterable<number>} ids
   * @returns {number[]}
   */
  setMoving(ids) {
    this.moving = new Set(markerIds([...ids]));
    for (const [id, pose] of this.parked) {
      if (this.moving.has(id)) continue;
      this.parked.delete(id);
      if (!this.entries.has(id)) this.set(id, pose, pose.fixed);
    }
    const removed = this.ids().filter((id) => this.moving.has(id));
    for (const id of removed) {
      this.parked.set(id, { ...this.entries.get(id) });
      this.delete(id);
    }
    return removed;
  }

  /** Highest marker ID in the map or the list of moving markers (-1 if none). */
  highestId() {
    return Math.max(-1, ...this.entries.keys(), ...this.moving);
  }

  /**
   * Number of codes the marker detector needs (IDs 0 ... n-1): all `codes` of the layout, or, for
   * a locked map, only up to its highest ID (moving markers included). Fewer codes are further
   * apart, so the detector can correct more bit errors safely, and IDs that cannot be on the
   * layout are not even read.
   * @param {number} codes `markers.codes` of the layout
   */
  detectionCodes(codes) {
    const highest = this.highestId();
    return this.locked && highest >= 0 ? Math.min(codes, highest + 1) : codes;
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

  /** Poses as stored in layout files (`markers.poses`): ID -> [x_mm, y_mm, rotation_deg]. */
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
 * @property {Object<number, MovingMarker>} moving detections of the map's moving markers (on vehicles)
 */

/**
 * A moving marker seen in the current frame (groundwork for vehicles that carry markers).
 * @typedef {object} MovingMarker
 * @property {number[][]} corners image corners (px; TL, TR, BR, BL; undistorted like the pose)
 * @property {number[] | null} center where the marker's centre is seen on the layout plane (mm), null without a pose.
 *   A marker on a vehicle lies above the plane: this point is shifted away from the camera by its height.
 * @property {number | null} heading direction of the marker's x axis (from its left to its right edge) in the layout frame (rad)
 */

/**
 * How the survey writes its estimates into the marker map. Every change of the map makes all
 * objects work out their geometry, the stop areas and the road network anew, which takes longer
 * than the rest of a frame's simulation. A marker seen in more than `settled` frames creeps by a
 * few hundredths of a millimetre per frame: its estimate is written every `every` frames, or at
 * once when it is more than `mm` or `rad` away from the map's pose. New and young markers are
 * written in every frame.
 */
export const SURVEY_WRITE = { settled: 10, every: 8, mm: 0.25, rad: 5e-4 };

export class PlaneTracker {
  /**
   * @param {MarkerMap} map
   * @param {object} [options]
   * @param {boolean} [options.survey=true] add and refine unknown markers automatically (never in a locked map)
   * @param {number} [options.holdSeconds=1.5] keep the last pose this long when all markers are hidden
   * @param {number} [options.minSurveyFrames=3] frames an unknown marker must be seen before it is used
   */
  constructor(map, { survey = true, holdSeconds = 1.5, minSurveyFrames = 3 } = {}) {
    this.map = map;
    this.survey = survey;
    this.holdSeconds = holdSeconds;
    this.minSurveyFrames = minSurveyFrames;
    this.acc = new Map(); // survey accumulators per marker ID
    this.generation = map.generation;
    this.reset();
  }

  /** Forget the current pose (e.g. when the video source changes). */
  reset() {
    this.H = null;
    this.Hinv = null;
    this.lastSeen = -Infinity;
    /** @type {TrackingState} */
    this.state = { H: null, Hinv: null, visible: [], used: [], holding: false, rms: 0, moving: {} };
    this.markers = {};
  }

  /**
   * Measure the markers again: forget surveyed poses (with `all`, also the fixed ones;
   * the origin marker then defines the layout frame again when it is seen). Unlocks the map.
   */
  resurvey(all = true) {
    this.acc.clear();
    this.map.clear(all);
    this.map.unlock();
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
    if (this.generation !== this.map.generation) {
      // the map was configured anew (another layout): start over
      this.generation = this.map.generation;
      this.acc.clear();
      this.reset();
    }
    const markers = {}, moving = {};
    for (const [key, corners] of Object.entries(detections)) {
      const id = Number(key);
      const c = camera.undistortPoints(corners);
      if (this.map.moving.has(id)) {
        moving[id] = c; // on a vehicle: neither surveyed nor used for the pose
        continue;
      }
      const H = markerHomography(c, this.map.sizeOf(id));
      if (H && H.every(Number.isFinite)) markers[id] = { H, corners: c };
    }
    this.markers = markers;
    if (this.survey && !this.map.locked) this._survey(markers, still);

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
      moving: this._moving(moving),
    };
    return this.state;
  }

  /** Moving markers in the image and, with a pose, where they are seen on the layout plane. */
  _moving(moving) {
    const out = {};
    for (const [id, corners] of Object.entries(moving)) {
      let center = null, heading = null;
      const p = this.Hinv ? corners.map((c) => applyH(this.Hinv, c)) : null;
      if (p && p.every((q) => q.every(Number.isFinite))) {
        center = [(p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4, (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4];
        // the marker's x axis: from its left edge (TL, BL) to its right edge (TR, BR)
        heading = Math.atan2(p[1][1] + p[2][1] - p[0][1] - p[3][1], p[1][0] + p[2][0] - p[0][0] - p[3][0]);
      }
      out[id] = { corners, center, heading };
    }
    return out;
  }

  /* ---------------------------------------------------------------- survey */

  _survey(markers, still) {
    const map = this.map;
    const ids = Object.keys(markers).map(Number).sort((a, b) => a - b);
    if (!ids.length) return;
    this.surveyFrames = (this.surveyFrames || 0) + 1;
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
        const x = a.sx / a.sw, y = a.sy / a.sw, theta = Math.atan2(a.ss, a.sc), S = SURVEY_WRITE;
        const write = still || !entry || a.frames <= S.settled || this.surveyFrames % S.every === 0 ||
          Math.abs(x - entry.x) > S.mm || Math.abs(y - entry.y) > S.mm || Math.abs(wrapAngle(theta - entry.theta)) > S.rad;
        if (write) map.set(id, { x, y, theta });
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
    let ids = Object.keys(markers).map(Number).filter((id) => this.map.has(id) && !this.map.moving.has(id));
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
