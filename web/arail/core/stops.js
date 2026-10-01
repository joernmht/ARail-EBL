/**
 * Stop areas and docks.
 *
 * A `StopArea` is a rectangle where passengers wait (a platform, a bus terminal's waiting
 * area). It has local coordinates in prototype metres: `s` along the area (0..L) and `t`
 * across it (-W/2..W/2, positive = left of the direction of `s`).
 * A `Dock` is a stretch of one of its long edges where vehicles stop (a platform track,
 * a bus bay). Simulations use these abstractions, so they work for any object type that
 * provides stop areas.
 * @module arail/core/stops
 */

/**
 * @typedef {object} Dock
 * @property {string} id unique, e.g. "platform-1:left"
 * @property {StopArea} area
 * @property {1 | -1} side +1 = left edge, -1 = right edge (seen in direction of s)
 * @property {number} s0 start along the area (m)
 * @property {number} s1 end along the area (m)
 * @property {"rail" | "bus" | string} kind vehicle kind that stops here
 * @property {string | null} track track name in the control system (rail docks)
 * @property {string} label e.g. "Track 3" or "Bay B"
 * @property {number | null} headway average time between vehicles (s); null on docks served by bus lines
 * @property {number} dwell dwell time (s)
 * @property {string | null} managed set (e.g. "line") when something other than the timetable
 *   serves the dock: bus lines (core/transit.js); the timetable services skip such docks
 */

export class StopArea {
  /**
   * @param {object} o
   * @param {string} o.id unique ID (usually the owner object's ID)
   * @param {import("./object.js").LayoutObject} o.owner
   * @param {"rail" | "bus" | string} o.kind
   * @param {number[]} o.origin layout point (mm) at s = 0, t = 0 (middle of the start edge)
   * @param {number[]} o.dir unit vector (layout frame) of increasing s
   * @param {number} o.lengthMM
   * @param {number} o.widthMM
   * @param {number} o.scale model scale denominator
   * @param {Array<Partial<Dock>>} [o.docks]
   * @param {Array<{s: number, t: number, weight?: number}>} [o.access] entrances/exits (m); default: both ends and the middle
   */
  constructor({ id, owner, kind, origin, dir, lengthMM, widthMM, scale, docks = [], access = null }) {
    this.id = id;
    this.owner = owner;
    this.kind = kind;
    this.origin = origin;
    this.dir = dir;
    this.normal = [-dir[1], dir[0]];
    this.scale = scale;
    this.lengthMM = lengthMM;
    this.widthMM = widthMM;
    /** Length and width in prototype metres. */
    this.L = (lengthMM * scale) / 1000;
    this.W = (widthMM * scale) / 1000;
    this.docks = docks.map((d, i) => ({
      id: d.id || `${id}:${i}`,
      area: this,
      side: d.side ?? 1,
      s0: d.s0 ?? 0,
      s1: d.s1 ?? this.L,
      kind: d.kind || kind,
      track: d.track ?? null,
      label: d.label || "",
      headway: d.managed && d.headway === null ? null : d.headway ?? 70,
      dwell: d.dwell ?? 24,
      managed: d.managed ?? null,
    }));
    this.access = access || [
      { s: 0.3, t: 0, weight: 0.35 },
      { s: this.L - 0.3, t: 0, weight: 0.35 },
      { s: this.L / 2, t: 0, weight: 0.3 },
    ];
  }

  /** Layout point (mm) for local coordinates (m); `z` (m) is returned as mm too. */
  toLayout(s, t) {
    const k = 1000 / this.scale;
    return [
      this.origin[0] + (this.dir[0] * s + this.normal[0] * t) * k,
      this.origin[1] + (this.dir[1] * s + this.normal[1] * t) * k,
    ];
  }

  /** Local coordinates (m) of a layout point (mm). */
  fromLayout(p) {
    const k = this.scale / 1000;
    const dx = p[0] - this.origin[0], dy = p[1] - this.origin[1];
    return [(dx * this.dir[0] + dy * this.dir[1]) * k, (dx * this.normal[0] + dy * this.normal[1]) * k];
  }

  /** Corners of the area (layout mm), counter-clockwise. */
  outline() {
    const h = this.W / 2;
    return [this.toLayout(0, -h), this.toLayout(this.L, -h), this.toLayout(this.L, h), this.toLayout(0, h)];
  }
}
