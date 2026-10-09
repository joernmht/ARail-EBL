/**
 * Rolling-stock markers: model wagons carry a deck card with one tag per container spot.
 * Tag ID = (wagon number − 1) · stride + slot; slot 0 is the spot at the A end, and every tag's x
 * axis points to the A end, so any visible tag gives the pose of the whole wagon.
 *
 * `RollingStock` turns the tags of each frame (already lifted to the deck plane) into wagon poses:
 * size gate, one centre estimate per tag, outlier rejection, fusion (the heading comes from the
 * line through the tag centres when two or more are seen), exponential smoothing, snapping to the
 * nearest track and the states moving, standing, held (tags hidden for a moment) and lost.
 * @module arail/terminal/rolling
 */
import { cross2, dist2, dot2, lerp2, median, meanAngle, polylineAt, polylineLengths, polylineProject, sub2, wrapAngle } from "../core/math.js";

/**
 * Tracking settings: how long a wagon is held when its tags vanish (s, standing or moving),
 * smoothing time constant (s), size gate (fraction of the tag size), standing detection (mm/s,
 * s), jump that resets the smoothing (mm), outlier tags (mm) and snapping to tracks (mm, degrees).
 */
export const ROLLING_DEFAULTS = Object.freeze({
  hold_s: 4, movingHold_s: 0.5, tau_s: 0.15, gate: 0.15, standing_mm_s: 3,
  standing_s: 1, jump_mm: 30, outlier_mm: 6, snap_mm: 8, snap_deg: 15,
});

/**
 * Wagon number and slot of a tag ID.
 * @param {number} id tag ID
 * @param {number} stride IDs per wagon
 * @returns {{number: number, slot: number}}
 */
export function decodeTag(id, stride) {
  return { number: Math.floor(id / stride) + 1, slot: id % stride };
}

/**
 * Tag ID of a wagon's slot.
 * @param {number} number wagon number (from 1)
 * @param {number} slot 0 … stride − 1 (0 = A end)
 * @param {number} stride IDs per wagon
 */
export function encodeTag(number, slot, stride) {
  return (number - 1) * stride + slot;
}

/**
 * A tracked model wagon.
 * @typedef {{number: number, center: number[]|null, heading: number|null, state: "moving"|"standing"|"held"|"lost",
 *   speed: number, tags: number[], seen: number, lastSeen: number, firstSeen: number, stood: boolean}} TrackedWagon
 *   tags: slots seen in the last frame; seen: number of different tags seen this session;
 *   stood: it was standing when last measured (a held wagon that stood still, not one that moved);
 *   lastSeen, firstSeen: real seconds
 */

/** A change of heading larger than this (rad) resets the smoothing, like a jump in position. */
const JUMP_RAD = Math.PI / 4;
/** Shortest time span (s) the speed is measured over, so that the first frames give no spikes. */
const MIN_SPAN_S = 0.25;
/** Tags closer together than this along the wagon (mm², summed) give no heading of their own. */
const MIN_SPREAD_MM2 = 1;

/**
 * Cumulative lengths and bounding box of a track polyline, cached by its points array (tracks are
 * rebuilt, not changed in place, when the layout changes).
 * @type {WeakMap<number[][], {n: number, cum: number[], box: number[]}>}
 */
const TRACK_CACHE = new WeakMap();

/** Cached geometry of a track: cumulative lengths (its own when it has them) and [minX, minY, maxX, maxY]. */
function trackGeometry(track) {
  const pts = track.points;
  let g = TRACK_CACHE.get(pts);
  if (!g || g.n !== pts.length) {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of pts) {
      box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
    }
    g = { n: pts.length, cum: polylineLengths(pts), box };
    TRACK_CACHE.set(pts, g);
  }
  const cum = Array.isArray(track.lengths) && track.lengths.length === pts.length ? track.lengths : g.cum;
  return { cum, box: g.box };
}

/** Model wagons from their tags (lifted to the deck plane), with smoothing and held/lost states. */
export class RollingStock {
  /**
   * @param {object} options
   * @param {number} [options.stride] IDs per wagon
   * @param {number} [options.size_mm] tag size
   * @param {(number: number, slot: number) => number | null} [options.slotAlongMM] position of a slot along
   *   the wagon (mm from its centre, + to the A end); null = no such slot
   * @param {(number: number, slot: number) => number} [options.slotTurn] how the tag of a slot is turned on
   *   the wagon (radians, counterclockwise from the A end; π: its x axis points to the B end)
   * @param {() => {points: number[][], lengths: number[]}[]} [options.tracks] tracks for snapping
   * @param {object} [options.options] overrides of {@link ROLLING_DEFAULTS}
   */
  constructor({ stride = 4, size_mm = 20, slotAlongMM = () => null, slotTurn = () => 0, tracks = () => [], options = {} } = {}) {
    this.stride = stride;
    this.size_mm = size_mm;
    this.slotAlongMM = slotAlongMM;
    this.slotTurn = slotTurn;
    this.tracks = tracks;
    this.options = { ...ROLLING_DEFAULTS, ...options };
    /** @type {Map<number, TrackedWagon>} */
    this.wagons = new Map();
    // per wagon number: smoothing state {center, heading, time, history, before}
    this._filters = new Map();
    // per wagon number: the slots ever seen (kept by reset())
    this._slotsSeen = new Map();
  }

  /**
   * Feed one frame of tag observations. A wagon appears when one of its tags is first seen with a
   * pose; tags without a pose (no camera pose) only keep a known wagon "held".
   * @param {{[tagId: string]: import("./types.js").TagObservation}} observations
   * @param {number} time real seconds
   * @param {{still?: boolean}} [options] still: the image does not change (a photo)
   */
  observe(observations, time, { still = false } = {}) {
    const updated = new Set();
    let tracks = null; // fetched once per frame, and only when a wagon is measured
    const getTracks = () => (tracks ??= (this.tracks() || []).filter((t) => Array.isArray(t?.points) && t.points.length >= 2));
    for (const [number, tags] of this._group(observations)) {
      const fused = this._fuse(tags.filter((t) => t.placed), this._filters.get(number)?.center ?? null);
      let w = this.wagons.get(number);
      if (!fused && !w) continue;
      if (!w) {
        w = { number, center: null, heading: null, state: "moving", speed: 0, tags: [], seen: 0, lastSeen: time, firstSeen: time, stood: false };
        this.wagons.set(number, w);
      }
      const unplaced = tags.filter((t) => !t.placed).map((t) => t.slot);
      w.tags = [...new Set([...(fused?.slots ?? []), ...unplaced])].sort((a, b) => a - b);
      const seen = this._slotsSeen.get(number) ?? new Set();
      for (const s of w.tags) seen.add(s);
      this._slotsSeen.set(number, seen);
      w.seen = seen.size;
      if (fused) this._update(w, fused, time, still, getTracks);
      else this._hold(w, time, true);
      updated.add(number);
    }
    for (const w of this.wagons.values()) if (!updated.has(w.number)) this._hold(w, time, false);
  }

  /** Clear the smoothing state; all wagons become "lost" (their poses are kept for ghosts). */
  reset() {
    this._filters.clear();
    for (const w of this.wagons.values()) {
      w.state = "lost";
      w.speed = 0;
      w.tags = [];
      w.stood = false;
    }
  }

  /**
   * Usable tags of one frame by wagon number: known slots only; a tag with a pose also has to
   * pass the size gate. Its heading becomes the wagon's (a tag stuck turned is turned back).
   * @returns {Map<number, {slot: number, along: number, center: number[]|null, heading: number|null, edge: number|null, placed: boolean}[]>}
   */
  _group(observations) {
    const { gate } = this.options, out = new Map();
    for (const [key, o] of Object.entries(observations || {})) {
      const id = Number(key);
      if (!Number.isInteger(id) || id < 0 || !o) continue;
      const placed = Array.isArray(o.center) && Number.isFinite(o.center[0]) && Number.isFinite(o.center[1]) && Number.isFinite(o.heading);
      if (placed && !(Math.abs(o.edge_mm - this.size_mm) <= gate * this.size_mm)) continue;
      const { number, slot } = decodeTag(id, this.stride);
      const along = this.slotAlongMM(number, slot);
      if (along == null || !Number.isFinite(along)) continue;
      if (!out.has(number)) out.set(number, []);
      // the wagon's heading (towards its A end) from the tag's, for a tag stuck turned
      const heading = placed ? wrapAngle(o.heading - (this.slotTurn(number, slot) || 0)) : null;
      out.get(number).push({ slot, along, center: placed ? o.center : null, heading, edge: o.edge_mm ?? null, placed });
    }
    return out;
  }

  /**
   * Wagon pose from its tags: each tag gives a centre estimate; estimates farther than
   * `outlier_mm` from their median are dropped; two or more remaining tags give the heading from
   * the line through their centres.
   * @param {object[]} tags tags of one wagon with a pose
   * @param {number[] | null} previous smoothed centre, to choose between two disagreeing tags
   * @returns {{center: number[], heading: number, slots: number[]} | null}
   */
  _fuse(tags, previous) {
    if (!tags.length) return null;
    const estimates = tags.map((t) => [t.center[0] - t.along * Math.cos(t.heading), t.center[1] - t.along * Math.sin(t.heading)]);
    const mid = [median(estimates.map((e) => e[0])), median(estimates.map((e) => e[1]))];
    let keep = tags.map((_, i) => i).filter((i) => dist2(estimates[i], mid) <= this.options.outlier_mm);
    if (!keep.length) {
      // two tags that disagree: trust the one that fits the previous pose, else the better-sized one
      const score = (i) => (previous ? dist2(estimates[i], previous) : Math.abs(tags[i].edge - this.size_mm) || 0);
      keep = [tags.map((_, i) => i).reduce((a, b) => (score(b) < score(a) ? b : a))];
    }
    const used = keep.map((i) => tags[i]);
    const tagHeading = meanAngle(used.map((t) => t.heading));
    if (used.length === 1) return { center: estimates[keep[0]], heading: wrapAngle(tagHeading), slots: [used[0].slot] };
    // least-squares line through the tag centres: centre_i = C + along_i · [cos h, sin h]
    const n = used.length;
    const a0 = used.reduce((s, t) => s + t.along, 0) / n;
    const c0 = [used.reduce((s, t) => s + t.center[0], 0) / n, used.reduce((s, t) => s + t.center[1], 0) / n];
    let saa = 0, ux = 0, uy = 0;
    for (const t of used) {
      const da = t.along - a0;
      saa += da * da;
      ux += da * (t.center[0] - c0[0]);
      uy += da * (t.center[1] - c0[1]);
    }
    let heading = tagHeading;
    if (saa > MIN_SPREAD_MM2) {
      const line = Math.atan2(uy, ux);
      if (Math.abs(wrapAngle(line - tagHeading)) < Math.PI / 2) heading = line;
    }
    return { center: [c0[0] - a0 * Math.cos(heading), c0[1] - a0 * Math.sin(heading)], heading: wrapAngle(heading), slots: used.map((t) => t.slot) };
  }

  /**
   * A wagon was measured: smooth, estimate the speed, decide between moving and standing, snap.
   * Standing = the smoothed centre has moved less than `standing_mm_s` · `standing_s` over the last
   * `standing_s`; a still image counts as standing for `standing_s` already.
   * @param {() => object[]} getTracks the tracks of this frame
   */
  _update(w, measured, time, still, getTracks) {
    const o = this.options;
    let f = this._filters.get(w.number);
    const dt = f ? time - f.time : Infinity;
    const jump = !f || !(dt >= 0) || dist2(measured.center, f.center) > o.jump_mm || Math.abs(wrapAngle(measured.heading - f.heading)) > JUMP_RAD;
    if (jump) {
      f = { center: measured.center, heading: measured.heading, time, history: [], before: "moving" };
      this._filters.set(w.number, f);
    } else {
      const a = still || !(o.tau_s > 0) ? 1 : 1 - Math.exp(-dt / o.tau_s);
      f.center = lerp2(f.center, measured.center, a);
      f.heading = wrapAngle(f.heading + a * wrapAngle(measured.heading - f.heading));
      f.time = time;
    }
    // speed over the last `standing_s` (at least MIN_SPAN_S) of smoothed positions; a still image
    // stands for a wagon that has been here for `standing_s`
    const h = f.history, span = Math.max(o.standing_s, MIN_SPAN_S);
    if (still) h.splice(0, h.length, { time: time - span, center: f.center });
    h.push({ time, center: f.center });
    while (h.length > 2 && h[1].time <= time - span) h.shift();
    const elapsed = time - h[0].time;
    w.speed = still || elapsed <= 0 ? 0 : dist2(f.center, h[0].center) / Math.max(elapsed, MIN_SPAN_S);
    w.state = elapsed >= o.standing_s - 1e-9 && w.speed < o.standing_mm_s ? "standing" : "moving";
    f.before = w.state;
    w.stood = w.state === "standing";
    const snapped = this._snap(f.center, f.heading, getTracks());
    w.center = snapped.center;
    w.heading = snapped.heading;
    w.lastSeen = time;
  }

  /**
   * A known wagon without a pose in this frame: "held" while its tags are visible without a pose,
   * and for `hold_s` (`movingHold_s` if it was moving) after they vanished; then "lost".
   */
  _hold(w, time, visible) {
    if (w.state === "lost") return;
    const o = this.options, f = this._filters.get(w.number);
    if (visible) {
      w.lastSeen = time;
    } else {
      w.tags = [];
      const hold = f?.before === "moving" ? o.movingHold_s : o.hold_s;
      if (!f || time - w.lastSeen > hold) {
        w.state = "lost";
        w.speed = 0;
        w.stood = false;
        this._filters.delete(w.number);
        return;
      }
    }
    w.state = "held";
  }

  /**
   * Snap a pose onto the nearest track within `snap_mm` whose direction (either way round) is
   * within `snap_deg` of the heading. Up to `snap_mm` beyond a track's ends the pose only moves
   * sideways; farther out it is not snapped.
   * @param {number[]} center
   * @param {number} heading
   * @param {{points: number[][], lengths?: number[]}[]} tracks
   * @returns {{center: number[], heading: number}}
   */
  _snap(center, heading, tracks) {
    const o = this.options, maxAngle = (o.snap_deg * Math.PI) / 180;
    // a pose that can snap lies within snap_mm of the track and of its ends' extensions
    const margin = Math.SQRT2 * o.snap_mm;
    let best = null;
    for (const track of tracks) {
      const pts = track.points, { cum, box } = trackGeometry(track);
      if (center[0] < box[0] - margin || center[0] > box[2] + margin || center[1] < box[1] - margin || center[1] > box[3] + margin) continue;
      const { s } = polylineProject(pts, center, cum);
      const { point, dir } = polylineAt(pts, s, cum);
      const off = sub2(center, point), inside = s > 0 && s < cum[cum.length - 1];
      const sideways = !inside && Math.abs(dot2(dir, off)) <= o.snap_mm;
      const distance = sideways ? Math.abs(cross2(dir, off)) : Math.hypot(off[0], off[1]);
      if (distance > o.snap_mm || (best && distance >= best.distance)) continue;
      const along = Math.atan2(dir[1], dir[0]), d = Math.abs(wrapAngle(heading - along));
      if (Math.min(d, Math.PI - d) > maxAngle) continue;
      const foot = inside ? point : [point[0] + dir[0] * dot2(dir, off), point[1] + dir[1] * dot2(dir, off)];
      best = { distance, center: foot, heading: d > Math.PI / 2 ? wrapAngle(along + Math.PI) : along };
    }
    return best ? { center: best.center, heading: best.heading } : { center: center.slice(), heading };
  }
}

