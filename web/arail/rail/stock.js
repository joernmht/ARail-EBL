/**
 * The rolling stock of the trains at the platforms, drawn solid on their track: the cars of a
 * train's consist (rail/trains.js: the layout's `consists`, the units of the rail operations, else
 * the default fleet) in the look of their type; where the train stands (its front near the end of
 * the platform in its direction of travel, as long as it is) and how it comes in along its track and
 * leaves; its doors along the platform and its outline. `RAIL_TRAIN` is the vehicle of kind "train"
 * that does it (registered by rail/index.js in place of core's box over the whole platform).
 * @module arail/rail/stock
 */
import { OVERLAY, rgba } from "../core/colors.js";
import { dist2, polylineAt, polylineProject, smoothstep } from "../core/math.js";
import { LIVERIES, carsLength, drawTrain } from "./draw.js";
import { trainConsist } from "./trains.js";

/** How the vehicles of a type look (liveries of rail/draw.js; doors as shares of a car from its back). */
export const LOOKS = {
  et442: { livery: "talent", doors: [0.22, 0.78] },
  et442s: { livery: "talent", doors: [0.22, 0.78] },
  br642: { livery: "regio", doors: [0.18, 0.82] },
  dbpza: { livery: "coach", decks: 2, doors: [0.22, 0.78], floor_m: 0.35, roof_m: 4.6 },
  bpmz: { livery: "coach", doors: [0.08, 0.92] },
};
/** How the vehicles of a kind look, where their type has no look of its own. */
const KIND_LOOKS = {
  locomotive: { livery: "loco", roof_m: 4.05 },
  "multiple-unit": { livery: "talent", doors: [0.22, 0.78] },
  railcar: { livery: "regio", doors: [0.2, 0.8] },
  coach: { livery: "coach", doors: [0.1, 0.9] },
  wagon: { livery: "wagon", roof_m: 1.6 },
};
/** Metres between the cars of a unit, and between two vehicles (buffers). */
const CAR_GAP_M = 0.6, BUFFER_GAP_M = 1;
/** Metres between a train's front and the end of the platform it stops at. */
export const STOP_MARGIN_M = 3;
/** Metres of a line drawn along a platform without a track, beyond each of its ends. */
const LINE_BEYOND_M = 400;

/**
 * The cars of a consist, from its first vehicle: a multiple unit or railcar in its cars (`cars` of
 * the catalogue) with cabs at its ends and a pantograph on its second car, a locomotive with cabs at
 * both ends, coaches and wagons; each with its doors and the look of its type.
 * @param {import("./vehicles.js").Consist} consist
 * @returns {import("./draw.js").Car[]}
 */
export function carsOf(consist) {
  const cars = [];
  for (const v of consist.vehicles) {
    const t = v.t, look = { ...(KIND_LOOKS[t.kind] || {}), ...(LOOKS[v.type] || {}) };
    const unit = t.kind === "multiple-unit" || t.kind === "railcar", n = unit ? Math.max(1, Math.round(t.cars || 2)) : 1;
    const length = (t.length_m - (n - 1) * CAR_GAP_M) / n, electric = (t.power || []).length > 0;
    for (let k = 0; k < n; k++) {
      cars.push({
        kind: t.kind, length_m: length, gap_m: k < n - 1 ? CAR_GAP_M : BUFFER_GAP_M,
        width_m: look.width_m ?? 2.9, floor_m: look.floor_m ?? 0.6, roof_m: look.roof_m ?? 3.95, decks: look.decks ?? 1,
        doors: t.kind === "locomotive" || t.kind === "wagon" ? [] : look.doors ?? [0.2, 0.8],
        cabFront: unit ? k === 0 : t.kind === "locomotive", cabBack: unit ? k === n - 1 : t.kind === "locomotive",
        // near the coupling of a unit's second car; a locomotive's rear one
        pantograph: !electric ? null : unit ? (k === Math.min(1, n - 1) ? (n > 1 ? 1 - 4 / length : 0.5) : null) : t.kind === "locomotive" ? 0.25 : null,
        livery: LIVERIES[look.livery] ?? LIVERIES.plain,
      });
    }
  }
  if (cars.length) cars[cars.length - 1].gap_m = 0;
  return cars;
}

/** The world a vehicle at a dock belongs to (its stop's object knows it), or null. */
const worldOf = (v) => v?.dock?.area?.owner?.world ?? null;

/** The lines of the docks, worked out once per layout: dock → {key, value}. */
const LINES = new WeakMap();

/**
 * The line a train at a dock runs on: the dock's track (the `track` object with its track id), else
 * a straight line along the platform's edge, far beyond its ends. `at(s)`: mm along the line of a
 * place along the platform (m); `sign`: +1 where the line runs the way the platform does.
 * @returns {{line: {points: number[][], lengths: number[], total: number, m: number}, at: (s: number) => number, sign: number}}
 */
export function dockLine(world, dock) {
  const key = `${world.objectsVersion}:${world.map.version}`, kept = LINES.get(dock);
  if (kept?.key === key) return kept.value;
  const area = dock.area, track = dock.track ? world.objects.find((o) => o.type === "track" && String(o.spec.track_id) === String(dock.track) && o.geometry) : null;
  const across = dock.side * (area.W / 2 + 1.75);
  let value;
  if (track) {
    const g = track.geometry, line = { points: g.points, lengths: g.lengths, total: g.total, m: track.mm(1) };
    const at = (s) => polylineProject(g.points, area.toLayout(s, across), g.lengths).s;
    value = { line, at, sign: at(area.L) >= at(0) ? 1 : -1 };
  } else {
    const a = area.toLayout(-LINE_BEYOND_M, across), b = area.toLayout(area.L + LINE_BEYOND_M, across), total = dist2(a, b);
    const m = dist2(area.toLayout(0, 0), area.toLayout(1, 0));
    value = { line: { points: [a, b], lengths: [0, total], total, m }, at: (s) => (s + LINE_BEYOND_M) * m, sign: 1 };
  }
  LINES.set(dock, { key, value });
  return value;
}

/**
 * Where a train at a dock is now: its cars, the line, its front (`head`, mm along the line) and its
 * direction along the line (`dir`). Standing, its front is near the end of the platform it heads
 * for; it comes in from as far back as it is long, and leaves the same way (a train of the control
 * system stays where it stood).
 * @param {import("../core/world.js").World} world
 * @param {object} v a vehicle of the services
 * @returns {{line: object, head: number, dir: number, stop: number, cars: object[], length_m: number} | null}
 */
export function trainPose(world, v) {
  const consist = trainConsist(world, v);
  if (!consist?.vehicles.length) return null;
  if (v.stockCars?.consist !== consist) v.stockCars = { consist, cars: carsOf(consist) };
  const cars = v.stockCars.cars, length = carsLength(cars), dock = v.dock;
  const { line, at, sign } = dockLine(world, dock);
  const dir = (v.direction || 1) * sign;
  const stop = at(v.direction > 0 ? dock.s1 - STOP_MARGIN_M : dock.s0 + STOP_MARGIN_M);
  const travel = (length + 40) * line.m;
  let head = stop;
  if (v.phase === "arriving") head = stop - dir * (1 - smoothstep(v.progress)) * travel;
  else if (v.phase === "departing" && v.source !== "feed") head = stop + dir * smoothstep(v.progress) * travel;
  return { line, head, dir, stop, cars, length_m: length };
}

/**
 * The doors of a train standing at its dock: where they are along the platform (m), those beside it.
 * @returns {number[]}
 */
export function trainDoors(world, v) {
  const pose = trainPose(world, v), dock = v.dock, area = dock.area;
  if (!pose) return [];
  const { line, dir, cars } = pose, out = [];
  let front = pose.stop;
  for (const car of cars) {
    for (const d of car.doors) {
      const s = area.fromLayout(polylineAt(line.points, front - dir * (1 - d) * car.length_m * line.m, line.lengths).point)[0];
      if (s >= dock.s0 + 0.3 && s <= dock.s1 - 0.3) out.push(s);
    }
    front -= dir * (car.length_m + car.gap_m) * line.m;
  }
  return out.sort((a, b) => a - b);
}

/**
 * The outline of a train (layout mm): along its line from its back to its front, as wide as its
 * cars, for pointing at it.
 * @returns {number[][]}
 */
export function trainOutline(pose) {
  const { line, head, dir, cars } = pose, m = line.m, hw = (Math.max(...cars.map((c) => c.width_m)) / 2) * m;
  const a = Math.max(0, Math.min(head, head - dir * pose.length_m * m)), b = Math.min(line.total, Math.max(head, head - dir * pose.length_m * m));
  if (b - a < m) return [];
  const steps = Math.max(1, Math.ceil((b - a) / (10 * m))), left = [], right = [];
  for (let i = 0; i <= steps; i++) {
    const p = polylineAt(line.points, a + ((b - a) * i) / steps, line.lengths), n = [-p.dir[1], p.dir[0]];
    left.push([p.point[0] + n[0] * hw, p.point[1] + n[1] * hw]);
    right.push([p.point[0] - n[0] * hw, p.point[1] - n[1] * hw]);
  }
  return [...left, ...right.reverse()];
}

/**
 * Trains at the platforms (vehicle kind "train"), drawn solid from their consist: as long as they
 * are, on their track. `pose`, `doorsOf`, `outline` and `capacity` are what the services ask of it
 * (core/services.js); `extent` and `doors` answer for a vehicle without a world.
 */
export const RAIL_TRAIN = {
  kind: "train",
  label: "Train",
  width_m: 2.9,
  height_m: 3.95,
  floor_m: 0.6,
  gap_m: 0.3,
  overhang_m: 0,
  carLength_m: 26,
  /** Getting on and off as core's TRAIN: a regional multiple unit for 76 cm platforms (core/vehicles.js, sims/passengers.js). */
  entry_m: 0.76,
  door_gap_m: 0.05,
  assist: null,
  seats_per_car: 80,
  standing_per_car_m2: 10,
  wheelchair_places: 2,
  racks: true,
  /** Stopped extent along the dock (m), as far as the platform goes. */
  extent: (dock) => [dock.s0, dock.s1],
  /** Doors along a dock without knowing the train: every 7 m. */
  doors(dock) {
    const len = dock.s1 - dock.s0, n = Math.max(2, Math.round(len / 7));
    return Array.from({ length: n }, (_, i) => dock.s0 + len * (0.1 + (0.8 * i) / (n - 1)));
  },
  pose(v) {
    const world = worldOf(v);
    return world ? trainPose(world, v) : null;
  },
  doorsOf(v) {
    const world = worldOf(v);
    return world ? trainDoors(world, v) : this.doors(v.dock);
  },
  outline: (pose) => trainOutline(pose),
  /** Seats and standing places, or null where the consist does not say. */
  capacity(v) {
    const world = worldOf(v), c = world ? trainConsist(world, v) : null;
    return c && c.capacity > 0 ? c.capacity : null;
  },
  draw(view, v, place) {
    const pose = place?.pose ?? this.pose(v);
    if (!pose) return;
    const top = drawTrain(view, pose.line, { head: pose.head, dir: pose.dir, cars: pose.cars, doors: v.doorsOpen ? 1 : 0, area: v.dock.area });
    if (top && v.phase === "dwelling" && v.line) {
      // `info`: more lines from the planner (units, driver, delay)
      view.label([top[0], top[1], view.m(5.2)], v.info?.length ? [v.line, ...v.info] : v.line, { size: 11, background: rgba(OVERLAY.sign, 0.92), fit: true });
    }
  },
};
