/**
 * Rolling-stock markers: model wagons carry a deck card with one tag per container spot.
 * Tag ID = (wagon number − 1) · stride + slot; slot 0 is the spot at the A end, and every tag's x
 * axis points to the A end, so any visible tag gives the pose of the whole wagon.
 *
 * `ROLLING_DEFAULTS`, `decodeTag` and `encodeTag` are final; `RollingStock` is a placeholder with
 * the final interface until wagon tracking is implemented.
 * @module arail/terminal/rolling
 */

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
 *   speed: number, tags: number[], seen: number, lastSeen: number, firstSeen: number}} TrackedWagon
 *   tags: slots seen in the last frame; seen: tags ever seen this session
 */

/** Model wagons from their tags (lifted to the deck plane), with smoothing and held/lost states. */
export class RollingStock {
  /**
   * @param {object} options
   * @param {number} [options.stride] IDs per wagon
   * @param {number} [options.size_mm] tag size
   * @param {(number: number, slot: number) => number | null} [options.slotAlongMM] position of a slot along
   *   the wagon (mm from its centre, + to the A end); null = no such slot
   * @param {() => {points: number[][], lengths: number[]}[]} [options.tracks] tracks for snapping
   * @param {object} [options.options] overrides of {@link ROLLING_DEFAULTS}
   */
  constructor({ stride = 4, size_mm = 20, slotAlongMM = () => null, tracks = () => [], options = {} } = {}) {
    this.stride = stride;
    this.size_mm = size_mm;
    this.slotAlongMM = slotAlongMM;
    this.tracks = tracks;
    this.options = { ...ROLLING_DEFAULTS, ...options };
    /** @type {Map<number, TrackedWagon>} */
    this.wagons = new Map();
  }

  /**
   * Feed one frame of tag observations.
   * @param {{[tagId: string]: import("./types.js").TagObservation}} observations
   * @param {number} time real seconds
   * @param {{still?: boolean}} [options] still: the image does not change (a photo)
   */
  observe(observations, time, { still = false } = {}) {}

  /** Clear the smoothing state; all wagons become "lost" (their poses are kept for ghosts). */
  reset() {}
}
