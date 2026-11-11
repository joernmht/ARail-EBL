// The camera positions of the game's virtual pictures: where the flyover camera stands for each,
// on which layout and at which time of day. tools/game-places.mjs takes the still pictures
// (web/game/places/<name>.jpg) from them; the live backdrop (live.js) flies between those of the
// layout it runs. Data and plain functions only: no DOM.

/** The layouts, below web/. */
export const NEUSTADT = "layouts/ebl-neustadt.json", TERMINAL = "layouts/container-terminal.json";
/** The times of day of the pictures (minutes after midnight). */
export const DAY = 8 * 60 + 30, NIGHT = 22 * 60 + 30;

/**
 * @typedef {object} Shot
 * @property {string} name the picture's name (its file is <name>.jpg)
 * @property {string} layout the layout's path below web/
 * @property {number[]} target the point looked at, [x, y] in layout mm
 * @property {number} distance_mm the camera's distance from it
 * @property {number} yaw_deg its direction seen from above (0 = along +x)
 * @property {number} pitch_deg its tilt (90 = straight down)
 * @property {number} time the time of day (minutes after midnight)
 */

/** @type {Shot[]} */
export const SHOTS = [
  { name: "platform-fly", layout: NEUSTADT, target: [3000, 330], distance_mm: 650, yaw_deg: 20, pitch_deg: 18, time: DAY },
  { name: "forecourt-fly", layout: NEUSTADT, target: [3560, -330], distance_mm: 700, yaw_deg: 60, pitch_deg: 22, time: DAY },
  { name: "town-fly", layout: NEUSTADT, target: [3474, -1300], distance_mm: 1300, yaw_deg: 110, pitch_deg: 25, time: DAY },
  { name: "crossing-fly", layout: NEUSTADT, target: [-560, 404], distance_mm: 650, yaw_deg: 40, pitch_deg: 18, time: DAY },
  { name: "station-fly", layout: NEUSTADT, target: [2930, -150], distance_mm: 900, yaw_deg: 270, pitch_deg: 16, time: DAY },
  { name: "school-fly", layout: NEUSTADT, target: [5050, -1650], distance_mm: 900, yaw_deg: 60, pitch_deg: 20, time: DAY },
  { name: "tram-fly", layout: NEUSTADT, target: [1950, -217], distance_mm: 520, yaw_deg: 10, pitch_deg: 16, time: DAY },
  { name: "throat-fly", layout: NEUSTADT, target: [2600, 330], distance_mm: 600, yaw_deg: 160, pitch_deg: 16, time: DAY },
  { name: "line-fly", layout: NEUSTADT, target: [5200, 300], distance_mm: 900, yaw_deg: 10, pitch_deg: 14, time: DAY },
  { name: "overview-fly", layout: NEUSTADT, target: [2600, 0], distance_mm: 5200, yaw_deg: 90, pitch_deg: 42, time: DAY },
  { name: "night-platform-fly", layout: NEUSTADT, target: [3000, 330], distance_mm: 650, yaw_deg: 20, pitch_deg: 18, time: NIGHT },
  { name: "night-town-fly", layout: NEUSTADT, target: [3474, -1300], distance_mm: 1300, yaw_deg: 110, pitch_deg: 25, time: NIGHT },
  { name: "night-line-fly", layout: NEUSTADT, target: [5200, 300], distance_mm: 900, yaw_deg: 10, pitch_deg: 14, time: NIGHT },
  { name: "night-office-fly", layout: NEUSTADT, target: [-2050, -750], distance_mm: 700, yaw_deg: 250, pitch_deg: 16, time: NIGHT },
  { name: "night-crossing-fly", layout: NEUSTADT, target: [-560, 404], distance_mm: 650, yaw_deg: 40, pitch_deg: 18, time: NIGHT },
  { name: "terminal-fly", layout: TERMINAL, target: [750, 420], distance_mm: 900, yaw_deg: 60, pitch_deg: 20, time: DAY },
  { name: "quay-fly", layout: TERMINAL, target: [600, 560], distance_mm: 800, yaw_deg: 300, pitch_deg: 18, time: DAY },
];

/** A shot by its name, or null. */
export function shotOf(name) {
  return SHOTS.find((s) => s.name === name) ?? null;
}

/** How much of a layout a shot shows: `near` times the camera's distance, at least `min_mm`. */
export const SEEN = { near: 3, min_mm: 1500 };

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The camera between two shots: the point looked at and the tilt go straight, the distance by its
 * logarithm (a zoom feels even), the direction the short way round.
 * @param {import("./shots.js").Shot} a
 * @param {import("./shots.js").Shot} b
 * @param {number} t 0 … 1
 * @returns {{target: number[], distance_mm: number, yaw_deg: number, pitch_deg: number}}
 */
export function between(a, b, t) {
  const k = easeInOut(Math.max(0, Math.min(1, t))), turn = ((((b.yaw_deg - a.yaw_deg) % 360) + 540) % 360) - 180;
  return {
    target: [a.target[0] + (b.target[0] - a.target[0]) * k, a.target[1] + (b.target[1] - a.target[1]) * k],
    distance_mm: Math.exp(Math.log(a.distance_mm) + (Math.log(b.distance_mm) - Math.log(a.distance_mm)) * k),
    yaw_deg: a.yaw_deg + turn * k,
    pitch_deg: a.pitch_deg + (b.pitch_deg - a.pitch_deg) * k,
  };
}

/**
 * The part of a layout a shot shows, as a square on the ground ([x0, y0, x1, y1], layout mm): it
 * reaches from behind the camera to several times its distance ahead and as far to both sides.
 * What lies outside is not drawn.
 * @param {{target: number[], distance_mm: number, yaw_deg: number}} shot
 */
export function seenFrom(shot) {
  const r = Math.max(SEEN.min_mm, SEEN.near * shot.distance_mm), a = (shot.yaw_deg * Math.PI) / 180;
  const cx = shot.target[0] + (Math.cos(a) * r) / 2, cy = shot.target[1] + (Math.sin(a) * r) / 2;
  return [cx - r, cy - r, cx + r, cy + r];
}
