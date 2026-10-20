/**
 * Trains drawn solid along their track, car by car: the cars of their vehicles (the cars of a
 * multiple unit with cabs at its ends, locomotives, coaches, double-deck coaches) in the livery of
 * their type, with windows (lit at night), doors (open on the platform's side), cab windscreens,
 * pantographs (folded down or raised), head and tail lights. The trains at the platforms
 * (rail/stock.js) and the units of the operations story (ops/story.js) are drawn the same way.
 * @module arail/rail/draw
 */
import { CD, PALETTE, grey, shade } from "../core/colors.js";
import { polylineAt } from "../core/math.js";
import { boxFaces } from "../core/transit.js";

/** Liveries by name: body, roof, the band along the side, the cab ends, windows, doors open and closed, pantograph. */
export const LIVERIES = {
  /** Light grey with a red band and red cab ends (an electric multiple unit). */
  talent: { body: grey(0.93), roof: grey(0.66), band: CD.rot, cab: CD.rot, glass: PALETTE.trainWindow, door: PALETTE.trainDoor, closed: grey(0.74), pantograph: grey(0.2) },
  /** Red with a light band (a diesel railcar). */
  regio: { body: CD.rot, roof: grey(0.55), band: grey(0.93), cab: shade(CD.rot, 0.82), glass: PALETTE.trainWindow, door: PALETTE.trainDoor, closed: shade(CD.rot, 0.8), pantograph: grey(0.2) },
  /** Light grey with a red band low down (coaches, double-deck coaches). */
  coach: { body: grey(0.93), roof: grey(0.62), band: CD.rot, cab: CD.rot, glass: PALETTE.trainWindow, door: PALETTE.trainDoor, closed: grey(0.74), pantograph: grey(0.2) },
  /** Red with a light band (a locomotive). */
  loco: { body: CD.rot, roof: grey(0.5), band: grey(0.93), cab: CD.rot, glass: PALETTE.trainWindow, door: shade(CD.rot, 0.8), closed: shade(CD.rot, 0.8), pantograph: grey(0.2) },
  /** Grey (freight wagons). */
  wagon: { body: grey(0.45), roof: grey(0.38), band: null, cab: grey(0.45), glass: PALETTE.trainWindow, door: grey(0.4), closed: grey(0.4), pantograph: grey(0.2) },
  /** Türkis, the virtual trains of earlier versions (a type of unknown look). */
  plain: { body: PALETTE.train, roof: shade(PALETTE.train, 0.78), band: grey(0.93), cab: shade(PALETTE.train, 0.8), glass: PALETTE.trainWindow, door: PALETTE.trainDoor, closed: shade(PALETTE.train, 0.85), pantograph: grey(0.2) },
};

/**
 * The cars in the reverse order, each turned round: what a unit looks like after the driver changed
 * ends (doors, cabs, pantographs mirrored; the gaps between the cars kept).
 * @param {Car[]} cars
 * @returns {Car[]}
 */
export function turnCars(cars) {
  const n = cars.length;
  return cars.map((_, j) => {
    const c = cars[n - 1 - j];
    return {
      ...c, cabFront: c.cabBack, cabBack: c.cabFront, doors: (c.doors || []).map((x) => 1 - x),
      pantograph: c.pantograph == null ? null : 1 - c.pantograph, gap_m: j < n - 1 ? cars[n - 2 - j].gap_m : 0,
    };
  });
}

/**
 * The length of cars from the front of the first to the back of the last (m).
 * @param {Car[]} cars
 */
export function carsLength(cars) {
  return cars.reduce((s, c, i) => s + c.length_m + (i < cars.length - 1 ? c.gap_m ?? 0.6 : 0), 0);
}

/**
 * Draw a train along a line: its first car's front at `head` (mm along the line), the others behind
 * it against the direction of travel. Cars beyond the line's ends or off the picture are not drawn.
 * @typedef {{length_m: number, gap_m?: number, width_m: number, floor_m: number, roof_m: number, decks?: number,
 *   doors?: number[], cabFront?: boolean, cabBack?: boolean, pantograph?: number | null, livery: object, kind?: string}} Car
 *   a car: its doors and pantograph as shares of its length from its back (0) to its front (1)
 * @param {object} view
 * @param {{points: number[][], lengths: number[], total: number, m: number}} line the track (layout mm), mm per metre
 * @param {{head: number, dir: number, cars: Car[], doors?: number, area?: object | null, powered?: boolean, pantograph?: number}} t
 *   dir: +1 towards the line's end; doors: how far they are open (0…1, on the platform's side of
 *   `area`); powered: lights on; pantograph: how far the pantographs are raised (0…1, default up)
 * @param {{ref?: number[] | null}} [o] a reference point to sort it by (a unit in a hall: behind it)
 * @returns {number[] | null} the middle of the first car drawn (for a label), or null
 */
export function drawTrain(view, line, t, { ref = null } = {}) {
  const { head, dir } = t, m = line.m, mz = view.m(1);
  const powered = t.powered !== false, lit = powered && view.darkness > 0.35;
  let front = head, top = null;
  t.cars.forEach((car, c) => {
    const f = front, r = f - dir * car.length_m * m;
    front = r - dir * (car.gap_m ?? 0.6) * m;
    const lo = Math.max(0, Math.min(f, r)), hi = Math.min(line.total, Math.max(f, r));
    if (hi - lo < 0.5 * m) return;
    const fc = dir > 0 ? hi : lo, rc = dir > 0 ? lo : hi;
    const A = polylineAt(line.points, rc, line.lengths).point, B = polylineAt(line.points, fc, line.lengths).point;
    // a car is long: one whose middle is off the picture may still reach into it
    if (!view.inImage((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, 0, 400)) return;
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]) / m;
    const ax = [(B[0] - A[0]) / (len * m || 1), (B[1] - A[1]) / (len * m || 1)];
    // the platform's side (doors open there), seen along the car
    let doorSide = null;
    if (t.area && t.doors > 0) {
      const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], w = t.area.toLayout(t.area.fromLayout(mid)[0], 0);
      doorSide = -ax[1] * (w[0] - mid[0]) + ax[0] * (w[1] - mid[1]) > 0 ? "left" : "right";
    }
    // where its doors are (m from its clipped back), whether its ends are cabs
    const offset = Math.abs(rc - r) / m, cabFront = !!car.cabFront && fc === f, cabBack = !!car.cabBack && rc === r;
    const doors = (car.doors || []).map((x) => x * car.length_m - offset).filter((x) => x > 0.8 && x < len - 0.8);
    const L = car.livery, z0 = car.floor_m * mz, z1 = car.roof_m * mz, decks = car.decks ?? 1;
    const faces = boxFaces(A, B, car.width_m * m, z0, z1, { side: L.body, top: L.roof, end: shade(L.body, 0.9) }, (face, P, Lm, hw) => {
      const out = [];
      if (face.side === "left" || face.side === "right") {
        const side = face.side === "left" ? hw : -hw;
        const strip = (a0, a1, h0, h1, color, extra = {}) => out.push({ pts: [P(a0, side, h0 * mz), P(a1, side, h0 * mz), P(a1, side, h1 * mz), P(a0, side, h1 * mz)], color, ...extra });
        if (L.band) strip(0, Lm, decks > 1 ? 0.45 : 0.75, decks > 1 ? 0.85 : 1.35, L.band);
        const a0 = cabBack ? 2.6 * m : 0.6 * m, a1 = Lm - (cabFront ? 2.6 * m : 0.6 * m);
        if (car.kind !== "locomotive" && car.kind !== "wagon" && a1 > a0) {
          const rows = decks > 1 ? [[1.15, 1.95], [2.75, 3.55]] : [[1.75, 2.75]];
          for (const [h0, h1] of rows) strip(a0, a1, h0, h1, lit ? PALETTE.litWindow : L.glass, { emissive: lit });
        }
        const open = face.side === doorSide ? t.doors : 0;
        const doorTop = decks > 1 ? 2.3 : 2.9;
        for (const d of doors) strip(d * m - 0.65 * m, d * m + 0.65 * m, car.floor_m + 0.05, doorTop, open > 0.5 ? L.door : L.closed);
      } else if ((face.side === "front" && cabFront) || (face.side === "back" && cabBack)) {
        const a = face.side === "front" ? Lm : 0, z = car.roof_m - 0.8;
        out.push({ pts: [P(a, -1.15 * m, (z - 1.1) * mz), P(a, 1.15 * m, (z - 1.1) * mz), P(a, 1.15 * m, z * mz), P(a, -1.15 * m, z * mz)], color: L.glass });
      }
      return out;
    });
    for (const face of faces) {
      if ((face.side === "front" && cabFront) || (face.side === "back" && cabBack)) face.color = L.cab;
    }
    const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    view.faces(faces, ref || [mid[0], mid[1], 2 * mz]);
    if (car.pantograph != null) {
      const at = car.pantograph * car.length_m - offset;
      if (at > 1.5 && at < len - 1.5) drawPantograph(view, A, ax, m, mz, car.roof_m, t.pantograph ?? 1, at, L.pantograph, ref);
    }
    // head lights at the train's front, tail lights at its back
    if (powered) {
      const q = [-ax[1], ax[0]];
      const end = (a, colour) => {
        for (const sgn of [-1, 1]) view.glow([A[0] + ax[0] * a * m + q[0] * sgn * 0.85 * m, A[1] + ax[1] * a * m + q[1] * sgn * 0.85 * m, 0.95 * mz], 0.45 * m, colour, 0.9);
      };
      if (c === 0 && fc === f) end(len + 0.05, CD.white);
      if (c === t.cars.length - 1 && rc === r) end(-0.05, CD.rot);
    }
    if (!top) top = mid;
  });
  return top;
}

/**
 * A single-arm pantograph on a car's roof at `a` (m from the car's back `A`, along `ax`): its base,
 * the lower and the upper arm (seen from the side) and the head across the roof (seen from above),
 * from folded down (`up` 0) to raised to the contact wire (1).
 */
function drawPantograph(view, A, ax, m, mz, roof, up, a, colour, ref) {
  const q = [-ax[1], ax[0]], mix = (x, y) => x + (y - x) * up;
  const at = (s, across = 0) => [A[0] + ax[0] * s * m + q[0] * across * m, A[1] + ax[1] * s * m + q[1] * across * m];
  const P = (s, across, z) => [...at(s, across), z * mz];
  // the hinge, the knee and the head (along the car, height in m): folded flat, or raised
  const hinge = [a - 1.1, roof + 0.3], knee = [mix(a + 1.2, a + 0.7), mix(roof + 0.42, roof + 1.15)], head = [mix(a - 0.9, a - 0.2), mix(roof + 0.5, roof + 1.95)];
  const arm = (p0, p1, th = 0.09) => ({ pts: [P(p0[0], 0, p0[1] - th), P(p1[0], 0, p1[1] - th), P(p1[0], 0, p1[1] + th), P(p0[0], 0, p0[1] + th)], normal: [q[0], q[1], 0], color: colour, twoSided: true });
  const flat = (s0, s1, w, z) => ({ pts: [P(s0, -w, z), P(s1, -w, z), P(s1, w, z), P(s0, w, z)], normal: [0, 0, 1], color: colour, twoSided: true });
  const p = at(a);
  view.faces([
    ...boxFaces(at(a - 1.4), at(a + 1.4), 1.3 * m, roof * mz, (roof + 0.25) * mz, { side: grey(0.45), top: grey(0.5) }),
    arm(hinge, knee),
    arm(knee, head),
    flat(head[0] - 0.18, head[0] + 0.18, 0.95, head[1] + 0.08),
  ], ref || [p[0], p[1], (roof + 1) * mz]);
}
