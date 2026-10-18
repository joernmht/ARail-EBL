/**
 * Built-in vehicle renderers: trains, buses and trams, drawn as simple shaded boxes; bikes and
 * e-scooters drawn with lines (drawBike).
 * Register your own with `registry.registerVehicle({kind, ...})`.
 * All sizes are prototype metres.
 * @module arail/core/vehicles
 */
import { CD, OVERLAY, PALETTE, grey, mix, rgba, shade } from "./colors.js";

/** Box faces of a vehicle segment in stop-area coordinates (metres), converted to layout mm. */
function vehicleFaces(area, view, { s0, s1, t0, t1, z0, z1 }, colors, decorate) {
  const P = (s, t, z) => {
    const [x, y] = area.toLayout(s, t);
    return [x, y, view.m(z)];
  };
  const tl = Math.min(t0, t1), tr = Math.max(t0, t1);
  const u = area.dir, n = area.normal;
  const faces = [
    { pts: [P(s0, tl, z1), P(s1, tl, z1), P(s1, tr, z1), P(s0, tr, z1)], normal: [0, 0, 1], color: colors.roof, alpha: colors.alpha },
    { pts: [P(s0, tr, z0), P(s1, tr, z0), P(s1, tr, z1), P(s0, tr, z1)], normal: [n[0], n[1], 0], color: colors.body, alpha: colors.alpha, side: "left" },
    { pts: [P(s1, tl, z0), P(s0, tl, z0), P(s0, tl, z1), P(s1, tl, z1)], normal: [-n[0], -n[1], 0], color: colors.body, alpha: colors.alpha, side: "right" },
    { pts: [P(s1, tr, z0), P(s1, tl, z0), P(s1, tl, z1), P(s1, tr, z1)], normal: [u[0], u[1], 0], color: colors.end, alpha: colors.alpha, side: "front" },
    { pts: [P(s0, tl, z0), P(s0, tr, z0), P(s0, tr, z1), P(s0, tl, z1)], normal: [-u[0], -u[1], 0], color: colors.end, alpha: colors.alpha, side: "back" },
  ];
  if (decorate) for (const f of faces) f.decals = decorate(f, P, tl, tr);
  return faces;
}

export const TRAIN = {
  kind: "train",
  label: "Train",
  width_m: 2.9,
  height_m: 3.9,
  floor_m: 0.4,
  gap_m: 0.3,
  overhang_m: 0,
  carLength_m: 26,
  /** Stopped extent along the dock (m): the whole platform track. */
  extent: (dock) => [dock.s0, dock.s1],
  doors(dock) {
    const len = dock.s1 - dock.s0;
    const n = Math.max(2, Math.round(len / 7));
    return Array.from({ length: n }, (_, i) => dock.s0 + len * (0.1 + (0.8 * i) / (n - 1)));
  },
  draw(view, v, place) {
    const area = v.dock.area;
    const alpha = view.virtual ? 0.92 : 0.62; // see-through over the camera image, nearly solid in the flyover
    const colors = { body: PALETTE.train, roof: shade(PALETTE.train, 0.78), end: shade(PALETTE.train, 0.9), alpha };
    const z0 = this.floor_m, z1 = this.height_m;
    const doors = v.doorsOpen ? this.doors(v.dock) : [];
    const inner = v.dock.side > 0 ? "right" : "left"; // wall facing the platform
    const lit = view.darkness > 0.35; // lights on inside
    const cars = Math.max(1, Math.round((place.s1 - place.s0) / this.carLength_m));
    const len = (place.s1 - place.s0) / cars;
    for (let c = 0; c < cars; c++) {
      const s0 = place.s0 + c * len + (c ? 0.35 : 0), s1 = place.s0 + (c + 1) * len - (c < cars - 1 ? 0.35 : 0);
      const faces = vehicleFaces(area, view, { s0, s1, t0: place.t0, t1: place.t1, z0, z1 }, colors, (f, P, tl, tr) => {
        if (f.side !== "left" && f.side !== "right") return [];
        const t = f.side === "left" ? tr : tl;
        const out = [{ pts: [P(s0 + 0.8, t, 2.2), P(s1 - 0.8, t, 2.2), P(s1 - 0.8, t, 3.1), P(s0 + 0.8, t, 3.1)], color: lit ? PALETTE.litWindow : PALETTE.trainWindow, alpha, emissive: lit }];
        if (f.side === inner) {
          for (const d of doors) {
            if (d - 0.7 < s0 || d + 0.7 > s1) continue;
            out.push({ pts: [P(d - 0.7, t, z0), P(d + 0.7, t, z0), P(d + 0.7, t, 3.2), P(d - 0.7, t, 3.2)], color: PALETTE.trainDoor, alpha: Math.min(1, alpha + 0.25) });
          }
        }
        return out;
      });
      const mid = area.toLayout((s0 + s1) / 2, (place.t0 + place.t1) / 2);
      view.faces(faces, [mid[0], mid[1], view.m(2)]);
    }
    if (v.phase === "dwelling" && v.line) {
      const top = area.toLayout(place.s1 - 2, (place.t0 + place.t1) / 2);
      // `info`: more lines from the planner (units, driver, delay)
      view.label([top[0], top[1], view.m(5)], v.info?.length ? [v.line, ...v.info] : v.line, { size: 11, background: rgba(OVERLAY.sign, 0.92), fit: true });
    }
  },
};

export const BUS = {
  kind: "bus",
  label: "Bus",
  width_m: 2.55,
  height_m: 3.2,
  floor_m: 0.3,
  gap_m: 0.4,
  overhang_m: 30,
  length_m: 12,
  /** A bus stands at the end of its bay (m). */
  extent: (dock) => [Math.max(dock.s0, dock.s1 - 1.5 - 12), dock.s1 - 1.5],
  doors(dock) {
    const [, front] = this.extent(dock);
    return [front - 1.6, front - 6.4];
  },
  draw(view, v, place) {
    const area = v.dock.area;
    const alpha = 0.9;
    const colors = { body: PALETTE.bus, roof: shade(PALETTE.bus, 1.45), end: shade(PALETTE.bus, 0.88), alpha };
    const z0 = this.floor_m, z1 = this.height_m;
    const doors = v.doorsOpen ? this.doors(v.dock) : [];
    const inner = v.dock.side > 0 ? "right" : "left";
    const lit = view.darkness > 0.35;
    const { s0, s1 } = place;
    const faces = vehicleFaces(area, view, { s0, s1, t0: place.t0, t1: place.t1, z0, z1 }, colors, (f, P, tl, tr) => {
      const out = [];
      if (f.side === "left" || f.side === "right") {
        const t = f.side === "left" ? tr : tl;
        out.push({ pts: [P(s0 + 0.6, t, 1.3), P(s1 - 0.4, t, 1.3), P(s1 - 0.4, t, 2.7), P(s0 + 0.6, t, 2.7)], color: lit ? PALETTE.litWindow : PALETTE.busWindow, alpha, emissive: lit });
        if (f.side === inner) {
          for (const d of doors) {
            if (d - 0.6 < s0 || d + 0.6 > s1) continue;
            out.push({ pts: [P(d - 0.6, t, z0), P(d + 0.6, t, z0), P(d + 0.6, t, 2.8), P(d - 0.6, t, 2.8)], color: "#2a2a2a", alpha });
          }
        }
      } else if (f.side === "front") {
        out.push({ pts: [P(s1, tr - 0.2, 1.1), P(s1, tl + 0.2, 1.1), P(s1, tl + 0.2, 2.8), P(s1, tr - 0.2, 2.8)], color: PALETTE.busWindow, alpha });
      }
      return out;
    });
    const mid = area.toLayout((s0 + s1) / 2, (place.t0 + place.t1) / 2);
    view.faces(faces, [mid[0], mid[1], view.m(1.6)]);
    if (v.phase === "dwelling" && v.line) {
      const top = area.toLayout(s1 - 1, (place.t0 + place.t1) / 2);
      view.label([top[0], top[1], view.m(4.2)], v.line, { size: 11, background: OVERLAY.label, fit: true });
    }
  },
};

/**
 * A low-floor tram (Niederflurstraßenbahn): 2.65 m wide (the widest BOStrab allows, as in Dresden),
 * 30 m long in five sections, its floor 0.30 m above the rails, four double doors on the right.
 * Trams of tram lines are driven by core/transit.js; this definition gives their size, doors and
 * where they stand at a stop.
 */
export const TRAM = {
  kind: "tram",
  label: "Tram",
  width_m: 2.65,
  height_m: 3.4,
  floor_m: 0.3,
  gap_m: 0.05,
  overhang_m: 30,
  length_m: 30,
  /** A tram stands with its front 1 m before the end of the platform (m). */
  extent: (dock) => [Math.max(dock.s0, dock.s1 - 1 - 30), dock.s1 - 1],
  doors(dock) {
    const [, front] = this.extent(dock);
    return [front - 2.5, front - 10.5, front - 18.5, front - 26.5];
  },
  draw(view, v, place) {
    const area = v.dock.area;
    const colors = { body: PALETTE.tram, roof: shade(PALETTE.tram, 1.35), end: shade(PALETTE.tram, 0.88), alpha: 0.92 };
    const doors = v.doorsOpen ? this.doors(v.dock) : [];
    const lit = view.darkness > 0.35;
    const faces = vehicleFaces(area, view, { s0: place.s0, s1: place.s1, t0: place.t0, t1: place.t1, z0: this.floor_m, z1: this.height_m }, colors, (f, P, tl, tr) => {
      if (f.side !== "left" && f.side !== "right") return [];
      const t = f.side === "left" ? tr : tl;
      const out = [{ pts: [P(place.s0 + 0.5, t, 1.2), P(place.s1 - 0.5, t, 1.2), P(place.s1 - 0.5, t, 2.6), P(place.s0 + 0.5, t, 2.6)], color: lit ? PALETTE.litWindow : PALETTE.busWindow, alpha: 0.92, emissive: lit }];
      for (const d of doors) out.push({ pts: [P(d - 0.65, t, this.floor_m), P(d + 0.65, t, this.floor_m), P(d + 0.65, t, 2.7), P(d - 0.65, t, 2.7)], color: "#2a2a2a", alpha: 0.95 });
      return out;
    });
    const mid = area.toLayout((place.s0 + place.s1) / 2, (place.t0 + place.t1) / 2);
    view.faces(faces, [mid[0], mid[1], view.m(1.7)]);
  },
};

/** Colours of bike frames (by the rider's number: the same rider, the same bike). */
export const BIKE_COLOURS = [grey(0.12), grey(0.3), CD.brillantblau, mix(CD.rot, grey(0.3), 0.3), grey(0.82), CD.dunkelblau, CD.tuerkis];

/** The colour of a rider's bike: the same rider (by its number), the same bike, riding or locked. */
export function bikeColour(rider) {
  return BIKE_COLOURS[(rider?.seq ?? 0) % BIKE_COLOURS.length];
}

/** Tyres, saddles and handlebars; the outline of riders (as of people, sims/passengers.js); shadows. */
const TYRE = grey(0.1), OUTLINE = grey(0.1), SHADOW = grey(0.08);

/**
 * The parts of a bike and an e-scooter and where its rider holds them (prototype m): `a` along it from
 * its middle (forward +), `z` up. Wheels of 28" (0.35 m) and of an e-scooter (0.1 m).
 */
const BIKE_PARTS = {
  wheel: 0.35, rear: [-0.55, 0.35], front: [0.55, 0.35], crank: [-0.12, 0.28], crankLength: 0.17,
  seatTube: [-0.25, 0.8], saddle: [-0.28, 0.95], head: [0.38, 0.82], headLow: [0.43, 0.62], bars: [0.3, 1.0], grip: 0.26,
  hip: [-0.26, 1.0], shoulder: [0.04, 1.47], neck: [0.1, 1.58], thigh: 0.46, shin: 0.5,
};
const SCOOTER_PARTS = {
  wheel: 0.1, rear: [-0.5, 0.1], front: [0.5, 0.1], deck: [[-0.42, 0.14], [0.32, 0.14]], bars: [0.42, 1.05], grip: 0.22,
  feet: [[-0.22, 0.16], [0.1, 0.16]], hip: [-0.08, 0.96], shoulder: [0.02, 1.46], neck: [0.05, 1.57],
};

/**
 * A bike or an e-scooter from `rear` to `front` (layout mm, on the ground), drawn with lines: wheels,
 * frame, saddle and handlebar; a rider on it when `rider` is given (pedalling at `rider.phase`,
 * radians). A child's bike is drawn smaller (`scale`). The simple view draws blocks instead.
 * @param {import("./view.js").View} view
 * @param {number[]} rear
 * @param {number[]} front
 * @param {{kind?: "bike" | "scooter", colour?: string, scale?: number, rider?: {colour: string, legs?: string, phase?: number}}} [options]
 */
export function drawBike(view, rear, front, { kind = "bike", colour = BIKE_COLOURS[0], scale = 1, rider = null } = {}) {
  const dx = front[0] - rear[0], dy = front[1] - rear[1], len = Math.hypot(dx, dy);
  if (!(len > 1e-6)) return;
  const u = [dx / len, dy / len], n = [-u[1], u[0]];
  const mid = [(rear[0] + front[0]) / 2, (rear[1] + front[1]) / 2];
  const k = view.m(1) * scale;
  if (view.simple) {
    // the simple view (core/simple.js): a block for the bike, one for its rider
    const box = (a, b) => [[-a, -b], [a, -b], [a, b], [-a, b]].map(([x, y]) => [mid[0] + (u[0] * x + n[0] * y) * k, mid[1] + (u[1] * x + n[1] * y) * k]);
    view.block(box(kind === "scooter" ? 0.55 : 0.85, 0.25), 0, k * (kind === "scooter" ? 0.3 : 0.9), colour);
    if (rider) view.block(box(0.3, 0.3), k * (kind === "scooter" ? 0.2 : 0.9), k * 1.75, rider.colour);
    return;
  }
  /** A point `a` m along, `b` m to the left, `z` m up, projected; null behind the camera. */
  const P = ([a, z], b = 0) => view.project(mid[0] + (u[0] * a + n[0] * b) * k, mid[1] + (u[1] * a + n[1] * b) * k, z * k);
  const base = P([0, 0]), up = P([0, 1]), side = P([0, 0], 0.5);
  if (!base || !up || !side) return;
  // px per prototype metre there (as for people, sims/passengers.js): upright, or half of it on the ground
  const vertical = Math.hypot(up[0] - base[0], up[1] - base[1]), ground = Math.hypot(side[0] - base[0], side[1] - base[1]) / 0.5;
  const ref = Math.max(vertical, 0.5 * ground);
  if (view.boxOffImage(base[0] - 2 * ref, base[1] - 2 * ref, base[0] + 2 * ref, base[1] + 2 * ref)) return;
  const S = kind === "scooter" ? SCOOTER_PARTS : BIKE_PARTS;
  // its shadow on the ground
  const r0 = P([S.rear[0] - S.wheel, 0]), r1 = P([S.front[0] + S.wheel, 0]);
  if (r0 && r1) {
    const shadow = (ctx) => {
      ctx.globalAlpha *= 0.25 * (1 - 0.6 * view.darkness);
      ctx.strokeStyle = SHADOW;
      ctx.lineWidth = Math.max(1, 0.25 * ref);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(r0[0], r0[1]);
      ctx.lineTo(r1[0], r1[1]);
      ctx.stroke();
    };
    shadow.plain = true;
    view.ground(7, shadow);
  }
  const frame = view.dim(colour, 0.5), dark = view.dim(TYRE, 0.5);
  const body = rider ? view.dim(rider.colour, 0.5) : null, legs = rider ? view.dim(rider.legs || mix(rider.colour, CD.black, 0.45), 0.5) : null;
  // the wheels, in the upright plane along the bike
  const wheel = (c) => {
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * 2 * Math.PI, p = P([c[0] + S.wheel * Math.cos(t), c[1] + S.wheel * Math.sin(t)]);
      if (!p) return null;
      pts.push(p);
    }
    return pts;
  };
  const wheels = [wheel(S.rear), wheel(S.front)];
  // the bike's points, and the rider's
  const pt = {};
  const put = (name, at, b = 0) => (pt[name] = P(at, b));
  if (kind === "scooter") {
    put("deck0", S.deck[0]), put("deck1", S.deck[1]), put("front", S.front), put("bars", S.bars), put("gripL", S.bars, S.grip), put("gripR", S.bars, -S.grip);
  } else {
    const phase = rider?.phase || 0, c = Math.cos(phase) * S.crankLength, s = Math.sin(phase) * S.crankLength;
    put("rear", S.rear), put("front", S.front), put("crank", S.crank), put("seatTube", S.seatTube), put("saddle", S.saddle), put("saddleFront", [S.saddle[0] + 0.12, S.saddle[1]]);
    put("head", S.head), put("headLow", S.headLow), put("bars", S.bars), put("gripL", S.bars, S.grip), put("gripR", S.bars, -S.grip);
    pt.pedalL = [S.crank[0] + c, S.crank[1] + s];
    pt.pedalR = [S.crank[0] - c, S.crank[1] - s];
  }
  let limbs = null;
  if (rider) {
    const legL = kind === "scooter" ? S.feet[0] : pt.pedalL, legR = kind === "scooter" ? S.feet[1] : pt.pedalR;
    limbs = {
      hipL: P(S.hip, 0.1), hipR: P(S.hip, -0.1), shoulderL: P(S.shoulder, 0.18), shoulderR: P(S.shoulder, -0.18), hip: P(S.hip), shoulder: P(S.shoulder), head: P([S.neck[0] + 0.03, S.neck[1] + 0.1]),
      footL: P(legL, 0.12), footR: P(legR, -0.12),
    };
    // on a bike the knees bend (standing on an e-scooter the legs are straight)
    if (kind !== "scooter") Object.assign(limbs, { kneeL: P(knee(S.hip, legL, S.thigh, S.shin), 0.12), kneeR: P(knee(S.hip, legR, S.thigh, S.shin), -0.12) });
  }
  if (kind !== "scooter") for (const key of ["pedalL", "pedalR"]) pt[key] = P(pt[key], key === "pedalL" ? 0.12 : -0.12);
  if (Object.values(pt).some((p) => !p) || wheels.some((w) => !w) || (limbs && Object.values(limbs).some((p) => !p))) return;
  const figure = (ctx) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const line = (pts, w, style) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.lineWidth = w;
      ctx.strokeStyle = style;
      ctx.stroke();
    };
    const tyre = Math.max(0.7, 0.05 * ref), tube = Math.max(0.8, 0.05 * ref);
    for (const w of wheels) {
      ctx.beginPath();
      w.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.lineWidth = tyre;
      ctx.strokeStyle = dark;
      ctx.stroke();
    }
    if (kind === "scooter") {
      line([pt.deck0, pt.deck1], Math.max(1.2, 0.12 * ref), dark);
      line([pt.deck1, pt.front], tube, dark);
      line([pt.front, pt.bars], Math.max(1, 0.07 * ref), frame);
      line([pt.gripL, pt.gripR], tube, dark);
    } else {
      // the frame (chain and seat stays, seat and down tube, top tube, fork), the cranks, saddle and handlebar
      line([pt.rear, pt.crank, pt.seatTube, pt.rear], tube, frame);
      line([pt.seatTube, pt.head, pt.headLow, pt.crank], tube, frame);
      line([pt.headLow, pt.front], tube, frame);
      line([pt.pedalL, pt.pedalR], Math.max(0.7, 0.04 * ref), dark);
      line([pt.seatTube, pt.saddle], tube, dark);
      line([pt.saddle, pt.saddleFront], Math.max(1, 0.07 * ref), dark);
      line([pt.head, pt.bars], tube, dark);
      line([pt.gripL, pt.gripR], tube, dark);
    }
    if (!limbs) return;
    const L = limbs, lw = Math.max(1, 0.13 * ref), aw = Math.max(0.8, 0.09 * ref), bw = Math.max(1.6, 0.3 * ref), hr = Math.max(1.3, 0.12 * ref);
    const outlined = (pts, w, style) => {
      line(pts, w + 2, OUTLINE);
      line(pts, w, style);
    };
    // the legs (to the pedals, or standing on the deck), the body leaning to the handlebar, the arms, the head
    outlined(L.kneeL ? [L.hipL, L.kneeL, L.footL] : [L.hipL, L.footL], lw, legs);
    outlined(L.kneeR ? [L.hipR, L.kneeR, L.footR] : [L.hipR, L.footR], lw, legs);
    outlined([L.hip, L.shoulder], bw, body);
    outlined([L.shoulderL, pt.gripL], aw, body);
    outlined([L.shoulderR, pt.gripR], aw, body);
    ctx.beginPath();
    ctx.arc(L.head[0], L.head[1], hr + 1, 0, 2 * Math.PI);
    ctx.fillStyle = OUTLINE;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(L.head[0], L.head[1], hr, 0, 2 * Math.PI);
    ctx.fillStyle = body;
    ctx.fill();
  };
  figure.plain = true;
  view.solid(view.depth(mid[0], mid[1], 0), figure);
  // its lamp at night (StVZO § 67)
  if (rider && view.darkness > 0.05) {
    const l = [S.front[0] + 0.05, kind === "scooter" ? 0.9 : 0.75];
    view.glow([mid[0] + u[0] * l[0] * k, mid[1] + u[1] * l[0] * k, l[1] * k], view.m(0.35), "#fff3d6", 0.8);
  }
}

/**
 * Where the knee is (a, z; m) between the hip and the foot, for a thigh and a shin of these lengths:
 * bent forward.
 */
function knee(hip, foot, thigh, shin) {
  const ea = foot[0] - hip[0], ez = foot[1] - hip[1], d = Math.min(Math.hypot(ea, ez), thigh + shin - 1e-6);
  const l = Math.hypot(ea, ez) || 1, ua = ea / l, uz = ez / l;
  const along = (thigh * thigh - shin * shin + d * d) / (2 * d), across = Math.sqrt(Math.max(0, thigh * thigh - along * along));
  // the side of the leg that points forward (+a)
  return [hip[0] + ua * along - uz * across, hip[1] + uz * along + ua * across];
}
