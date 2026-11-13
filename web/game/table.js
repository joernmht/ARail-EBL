// The signaller's game on the table: the panel's station (STATION of arail/game/signaller.js) laid
// on the lab's layout of Bf Neustadt, section by section along the real rails, and a board that
// draws a game there as the app draws its digital layer: the trains as cars on their tracks, the
// signals as masts with their lamps, a route as a band on the rails it locks, the trains to come
// as signs at the table's ends. What can be chosen on the panel can be chosen on the table (a
// signal, then where its route goes; a platform track). While a train stands at a platform the
// people of the layout's world get on and off it: the board tells the world's services, as a
// control system would. Data, geometry and drawing on a View: no DOM.
import {
  CD, CD_LIGHT, LIVERIES, OVERLAY, PALETTE, RAIL_TRAIN, drawTrain, grey, polylineAt, polylineLengths, polylineProject, prismFaces, rectFootprint, rgba, shade,
} from "../arail/index.js";
import { STATION } from "../arail/game/signaller.js";

/** The layout the station lies on, below web/. */
export const TABLE_LAYOUT = "layouts/ebl-neustadt.json";

/**
 * The three lines through the station, read from the table's orthophoto (layout mm), from the
 * Bergheim end of the table (+x) to the Talsee end (−x): the game's east is the layout's −x, so a
 * train to Talsee runs on the right-hand track, the one towards the windows. `top` is track G1
 * and the line it goes on as, `mid` track G2 and its line, `low` track G3 between its two points.
 */
const TOP = [
  [7900, 311], [7500, 319], [7300, 325], [7100, 331], [6700, 341], [6300, 346], [5900, 353], [5500, 358], [5100, 368], [4500, 373], [4100, 381],
  [3500, 386], [2900, 390], [2500, 393], [1900, 399], [1300, 402], [700, 407], [300, 405], [100, 400], [-100, 395], [-280, 392], [-500, 428],
  [-650, 443], [-850, 458], [-1050, 474], [-1350, 490], [-1500, 499], [-1650, 494], [-1750, 485], [-1850, 467], [-1950, 441], [-2030, 410],
];
const MID = [
  [7900, 251], [7500, 258], [7300, 264], [7100, 269], [6700, 283], [6300, 286], [6100, 289], [5900, 293], [5500, 301], [5100, 308], [4700, 312],
  [4300, 320], [3900, 323], [3500, 327], [2900, 332], [2500, 334], [1900, 339], [1300, 342], [900, 349], [300, 348], [100, 341], [-100, 334],
  [-280, 331], [-500, 367], [-650, 381], [-750, 389], [-850, 400], [-1000, 406], [-1150, 410], [-1300, 428], [-1450, 436], [-1600, 433],
  [-1700, 428], [-1800, 414], [-1900, 391], [-2000, 356], [-2080, 322],
];
const LOW = [
  [5800, 231], [5500, 231], [5300, 230], [5000, 216], [4700, 208], [4300, 210], [4100, 212], [3700, 215], [3300, 219], [2900, 222], [2500, 224],
  [2100, 230], [1700, 232], [1300, 234], [1100, 238], [1000, 246], [900, 255], [800, 266], [700, 283], [600, 304], [500, 328], [430, 340], [370, 348],
];

/** The point of a line (its x falling along it) at x. */
function at(line, x) {
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    if (x <= a[0] && x >= b[0]) return [x, a[1] + ((b[1] - a[1]) * (a[0] - x)) / (a[0] - b[0] || 1)];
  }
  return x > line[0][0] ? line[0].slice() : line.at(-1).slice();
}

/** A line from x0 down to x1 (x0 > x1), with its points between. */
function cut(line, x0, x1) {
  return [at(line, x0), ...line.filter((p) => p[0] < x0 && p[0] > x1), at(line, x1)];
}

/**
 * Where the station lies (x, layout mm): the entry signals A and F; the platform tracks from their
 * exit signals to Bergheim (P) to those to Talsee (N); the points W1–W6 and the ends of their
 * sections; the ends of the table. Between W1 and W2 a ladder leads from the line from Bergheim
 * down to track G2's, between W3 and track G3 on; between W5 and W4 a crossover leads to the line
 * to Talsee.
 */
const X = { west: 7900, A: 6900, w1: 6650, top: 6500, mid: 6450, w2: 6350, w3s: 6200, w3: 6080, low: 5800, P: 4296, N: 1560, w6: 370, w5s: 250, w5: 170, w4: -100, F: -150, be: -280 };
const LADDER = [X.top, (at(TOP, X.w1)[1] + at(MID, X.w2)[1]) / 2], CROSSOVER = [(X.w5 + X.w4) / 2, (at(MID, X.w5)[1] + at(TOP, X.w4)[1]) / 2];

/**
 * @typedef {object} Table
 * @property {string} layout the layout it lies on (its path below web/)
 * @property {Record<string, Record<string, number[][]>>} sections each section of the station: its way along the
 *   rails (layout mm) in the direction to Talsee, for the straight ("+") and, in a section with a point, the
 *   diverging ("-") position of its point
 * @property {number} signal_mm how far a signal stands beside its track, on the right of the trains it applies to
 */

/** @type {Table} */
export const TABLE = {
  layout: TABLE_LAYOUT,
  signal_mm: 27,
  sections: {
    aw: { "+": cut(TOP, X.west, X.A) },
    bw: { "+": cut(MID, X.west, X.mid) },
    w1: { "+": cut(TOP, X.A, X.top), "-": [...cut(TOP, X.A, X.w1), LADDER] },
    w2: { "+": cut(MID, X.mid, X.w3s), "-": [LADDER, ...cut(MID, X.w2, X.w3s)] },
    w3: { "+": cut(MID, X.w3s, X.P), "-": [...cut(MID, X.w3s, X.w3), ...cut(LOW, X.low, X.P)] },
    g1: { "+": cut(TOP, X.top, X.N) },
    g2: { "+": cut(MID, X.P, X.N) },
    g3: { "+": cut(LOW, X.P, X.N) },
    w6: { "+": cut(MID, X.N, X.w5s), "-": [...cut(LOW, X.N, X.w6), ...cut(MID, X.w6, X.w5s).slice(1)] },
    w5: { "+": cut(MID, X.w5s, X.F), "-": [...cut(MID, X.w5s, X.w5), CROSSOVER] },
    w4: { "+": cut(TOP, X.N, X.be), "-": [CROSSOVER, ...cut(TOP, X.w4, X.be)] },
    ae: { "+": cut(MID, X.F, MID.at(-1)[0]) },
    be: { "+": cut(TOP, X.be, TOP.at(-1)[0]) },
  },
};

/** The point of a section (its id), or null. */
const pointOf = (station, section) => Object.entries(station.points).find(([, p]) => p.section === section)?.[0] ?? null;

/**
 * What is wrong with a table for a station: sections without their ways, ways that do not meet
 * where a route goes from one section to the next. Empty when a train can be drawn on every route.
 * @param {Table} [table]
 * @param {typeof STATION} [station]
 * @returns {string[]}
 */
export function tableProblems(table = TABLE, station = STATION) {
  const problems = [];
  for (const id of Object.keys(station.sections)) {
    const ways = table.sections[id];
    if (!ways?.["+"] || ways["+"].length < 2) problems.push(`Section ${id} has no way on the table.`);
    else if (pointOf(station, id) && !(ways["-"]?.length >= 2)) problems.push(`Section ${id} has a point, but no way for its diverging position.`);
  }
  if (problems.length) return problems;
  const t = new TableStation(table, station);
  for (const r of station.routes) {
    const sig = station.signals[r.from], secs = [sig.section, ...r.sections];
    for (let i = 0; i < secs.length - 1; i++) {
      const a = t.way(secs[i], r.points[pointOf(station, secs[i])] ?? "+", sig.dir), b = t.way(secs[i + 1], r.points[pointOf(station, secs[i + 1])] ?? "+", sig.dir);
      const gap = Math.hypot(a.points.at(-1)[0] - b.points[0][0], a.points.at(-1)[1] - b.points[0][1]);
      if (gap > 1) problems.push(`Route ${r.id}: ${secs[i]} and ${secs[i + 1]} do not meet (${Math.round(gap)} mm apart).`);
    }
  }
  return problems;
}

/**
 * How the cars of the game's kinds of trains look (rail/draw.js): the first of a train, and what
 * follows it until the train is as long as it is. Lengths in metres at the layout's scale.
 */
const STOCK = {
  RB: { first: null, car: { kind: "railcar", length_m: 22, livery: "regio", doors: [0.24, 0.76], cabs: true }, places: 120 },
  IC: { first: { kind: "locomotive", length_m: 17, livery: "loco", pantograph: 0.3 }, car: { kind: "coach", length_m: 23, livery: "coach", doors: [0.08, 0.92] }, places: 420 },
  GZ: { first: { kind: "locomotive", length_m: 17, livery: "loco", pantograph: 0.3 }, car: { kind: "wagon", length_m: 15, livery: "wagon" }, places: 0 },
};
/** The bodies of freight wagons, one after the other. */
const WAGONS = [grey(0.45), shade(CD.tuerkis, 0.75), grey(0.6), shade(CD.rot, 0.62), grey(0.36), shade(CD.orange, 0.8)];
const GAP_M = 0.8;

/** A cubic that rises from 0 to 1 with the slope `d` at both ends (monotone for d ≤ 3). */
const ease = (u, d) => (u * u * u - 2 * u * u + u) * d + (-2 * u * u * u + 3 * u * u) + (u * u * u - u * u) * d;

/**
 * The station on the table: where a place of the game (a section and metres along it) lies on the
 * layout. The table is shorter than the station (as every model railway is): the platform tracks
 * set the scale (`k`, mm of table per metre of the game); a section with a point is as long as its
 * rails are, and a train passes it faster or slower in between, at the scale at its ends; of the
 * open line only the stretch next to the station is on the table.
 */
export class TableStation {
  /**
   * @param {Table} [table]
   * @param {typeof STATION} [station]
   */
  constructor(table = TABLE, station = STATION) {
    this.table = table;
    this.station = station;
    /** @type {Map<string, {points: number[][], lengths: number[], total: number}>} */
    this.ways = new Map();
    const g = this.way("g2", "+", 1);
    /** Millimetres of table per metre of the game, as on track G2. */
    this.k = g.total / station.sections.g2.len;
  }

  /**
   * The way through a section in a direction of travel (+1 to Talsee, −1 to Bergheim) with its
   * point straight ("+") or diverging ("-").
   * @returns {{points: number[][], lengths: number[], total: number}}
   */
  way(section, pos = "+", dir = 1) {
    const key = `${section}|${pos}|${dir}`;
    let w = this.ways.get(key);
    if (!w) {
      const ways = this.table.sections[section], base = ways[pos] ?? ways["+"];
      const points = dir > 0 ? base : [...base].reverse(), lengths = polylineLengths(points);
      w = { points, lengths, total: lengths.at(-1) };
      this.ways.set(key, w);
    }
    return w;
  }

  /**
   * Where `s` metres into a section are along its way (mm from the way's start; a place on the
   * open line beyond the table lies before the way, below 0, or behind it).
   * @param {string} section
   * @param {number} total the length of the way (mm)
   * @param {number} s metres from where a train enters the section
   * @param {boolean} entering the section is the open line a train comes in on (else it leaves on it)
   */
  along(section, total, s, entering) {
    const sec = this.station.sections[section];
    if (sec.line) return entering ? total - (sec.len - s) * this.k : s * this.k;
    return total * ease(Math.max(0, Math.min(1, s / sec.len)), Math.min(3, (this.k * sec.len) / total));
  }

  /** The position of a section's point on a train's way: that of the route the train runs on. */
  posOf(tr, section) {
    const point = pointOf(this.station, section);
    if (!point) return "+";
    return tr.routes?.find((r) => r.def.sections.includes(section))?.def.points[point] ?? "+";
  }

  /**
   * Where a train is: the line of its whole path on the table in its direction of travel (as
   * rail/draw.js draws along it), and its front (mm along that line; below 0 or beyond the line
   * while its front is on the open line beyond the table).
   * @param {object} tr a train of the game (its path, its routes, its head, its direction)
   * @param {number} mm_per_m model mm per metre of the layout's scale (the size of the cars)
   * @returns {{line: {points: number[][], lengths: number[], total: number, m: number}, head: number, on: boolean} | null}
   */
  place(tr, mm_per_m) {
    if (!tr.path?.length) return null;
    const points = [], starts = tr.starts;
    let offset = 0, head = null;
    tr.path.forEach((sec, i) => {
      const w = this.way(sec, this.posOf(tr, sec), tr.dir), len = this.station.sections[sec].len;
      for (const p of w.points) if (!points.length || Math.hypot(p[0] - points.at(-1)[0], p[1] - points.at(-1)[1]) > 0.01) points.push(p);
      if (head == null && (tr.head < starts[i] + len || i === tr.path.length - 1)) head = offset + this.along(sec, w.total, tr.head - starts[i], i === 0);
      offset += w.total;
    });
    const lengths = polylineLengths(points), total = lengths.at(-1);
    return { line: { points, lengths, total, m: mm_per_m }, head, on: head > 0 && head - tr.length * this.k < total };
  }

  /** The cars of a train, as long together as the train is on the table. */
  cars(tr, mm_per_m) {
    const stock = STOCK[tr.kind] ?? STOCK.RB, want = (tr.length * this.k) / mm_per_m, cars = [];
    const car = (c, i) => ({
      kind: c.kind, length_m: c.length_m, gap_m: GAP_M, width_m: 2.9, floor_m: 0.6, roof_m: c.kind === "wagon" ? 3.2 : c.kind === "locomotive" ? 4.05 : 3.95,
      doors: c.doors ?? [], cabFront: !!c.cabs || c.kind === "locomotive", cabBack: !!c.cabs || c.kind === "locomotive", pantograph: c.pantograph ?? null,
      livery: c.kind === "wagon" ? { ...LIVERIES.wagon, body: WAGONS[i % WAGONS.length], roof: shade(WAGONS[i % WAGONS.length], 0.85), cab: WAGONS[i % WAGONS.length] } : LIVERIES[c.livery],
    });
    if (stock.first) cars.push(car(stock.first, 0));
    let length = cars.reduce((n, c) => n + c.length_m + GAP_M, 0);
    const n = Math.max(1, Math.round((want - length + GAP_M) / (stock.car.length_m + GAP_M)));
    for (let i = 0; i < n; i++) cars.push(car(stock.car, i));
    // the cars share what is left of the train's length
    length = cars.length * GAP_M - GAP_M;
    const fixed = stock.first ? stock.first.length_m : 0, each = Math.max(6, (want - length - fixed) / n);
    for (const c of cars) if (c !== cars[0] || !stock.first) c.length_m = each;
    cars.at(-1).gap_m = 0;
    return cars;
  }

  /**
   * Where a signal stands: at the end of its section, on the right of the trains it applies to.
   * @returns {{at: number[], foot: number[], heading: number}} at: beside the track; foot: on the track; heading: the trains' direction (radians)
   */
  signal(id) {
    const sig = this.station.signals[id], w = this.way(sig.section, "+", sig.dir);
    const end = polylineAt(w.points, w.total, w.lengths), d = this.table.signal_mm;
    return { at: [end.point[0] + end.dir[1] * d, end.point[1] - end.dir[0] * d], foot: end.point, heading: Math.atan2(end.dir[1], end.dir[0]) };
  }

  /** The middle of a platform track (by its name, "G2"), for its sign. */
  trackMiddle(track) {
    const id = Object.keys(this.station.sections).find((s) => this.station.sections[s].track === track), w = this.way(id, "+", 1);
    return polylineAt(w.points, w.total / 2, w.lengths).point;
  }

  /** Where a route ends, for the sign of where it goes: the middle of its platform track, or the table's end of its line. */
  destination(route) {
    const last = route.sections.at(-1), sec = this.station.sections[last];
    if (sec.track) return this.trackMiddle(sec.track);
    const w = this.way(last, "+", this.station.signals[route.from].dir);
    return polylineAt(w.points, Math.min(w.total, 420), w.lengths).point;
  }
}

/** The boards by the world they draw in: the world's services ask the board of their world for a train's doors. */
const BOARDS = new WeakMap();
const boardOf = (v) => BOARDS.get(v?.dock?.area?.owner?.world) ?? null;

/**
 * The game's trains at the platforms, for the world's services (core/services.js): nothing is drawn
 * for them (the board draws its trains itself, wherever they are), their doors are where the
 * board's train has them.
 */
export const TABLE_TRAIN = {
  ...RAIL_TRAIN,
  kind: "table-train",
  pose: () => null,
  doorsOf: (v) => boardOf(v)?.doorsOf(v) ?? [],
  capacity: (v) => boardOf(v)?.placesOf(v) ?? null,
  draw: () => {},
};

/** The colours of the board: a route locked, its points still moving, a section occupied, a track closed, what can be chosen. */
const TONE = { route: CD_LIGHT.tuerkis, occupied: CD.rot, closed: CD_LIGHT.orange, choice: OVERLAY.task, proceed: "#3ed37a", stop: CD.rot, zs1: CD.white };
/** Widths on the table (mm): the band of a section's state, a track bed drawn where no real track shows. */
const BAND_MM = 26, BED_MM = 30, GAUGE_MM = 16.5;
/** A level crossing closes for a train of the game: this far before the train reaches it (m of the game), and how near the train's way must pass it (mm). */
export const CROSSING = { before_m: 250, beside_mm: 90, behind_mm: 40 };
/** How near a click must be (CSS px): to a signal, to a track. */
export const HIT_PX = { signal: 26, track: 16 };

/**
 * The board of a signaller's game on the layout's world. It is one of the world's simulations
 * (drawn with everything else, so a train passes behind a house and under a canopy), and the
 * planner of the station's platform tracks: the world's own timetable sends no trains there.
 */
export class TableBoard {
  /** The railway stands on the table module, never on a street's bridge (core/elevation.js). */
  static elevation = "ground";
  static type = "table-board";

  /**
   * @param {import("../arail/index.js").World} world the world of the layout the table lies on
   * @param {{table?: Table, station?: typeof STATION}} [options]
   */
  constructor(world, { table = TABLE, station = STATION } = {}) {
    this.world = world;
    this.station = station;
    this.at = new TableStation(table, station);
    this.enabled = true;
    this.config = { type: TableBoard.type };
    /** @type {import("../arail/game/signaller.js").SignallerGame | null} the game shown */
    this.game = null;
    /** What is chosen (an item of the game's picture: "signal-A", "track-G2"), and the routes offered from a signal chosen. */
    this.picked = null;
    this.offers = [];
    /** Whether a person can choose (else the board only shows). */
    this.active = false;
    /** The trains standing at a platform, as the world's services know them: train id → {dock, vehicle}. */
    this.standing = new Map();
    this.cache = new Map();
    world.registry.registerVehicle(TABLE_TRAIN);
    BOARDS.set(world, this);
    world.simulations.push(this);
    world.services.planner = this;
    world.services.refreshModes();
  }

  /** Model mm per metre at the layout's scale. */
  get m() {
    return 1000 / this.world.scale;
  }

  /** Show a game (null: none); the trains of the one before leave the platforms. */
  show(game) {
    if (game === this.game) return;
    this._clear();
    this.game = game ?? null;
  }

  /** Take the board out of its world again. */
  dispose() {
    this._clear();
    const sims = this.world.simulations, i = sims.indexOf(this);
    if (i >= 0) sims.splice(i, 1);
    if (this.world.services.planner === this) {
      this.world.services.planner = null;
      this.world.services.refreshModes();
    }
    if (BOARDS.get(this.world) === this) BOARDS.delete(this.world);
  }

  _clear() {
    for (const { dock } of this.standing.values()) this.world.services.feedDeparted(dock.id);
    this.standing.clear();
    this.cache.clear();
  }

  /* ---------------------------------------------------------------- the world's services */

  /** The platform tracks of the station are the board's: the world's timetable sends no trains there (ServiceManager.planner). */
  claims(dock) {
    return dock.kind === "rail" && this._tracks().includes(String(dock.track ?? ""));
  }

  _tracks() {
    return (this._trackNames ||= Object.values(this.station.sections).map((s) => s.track).filter(Boolean));
  }

  /** The dock of a platform track ("G2"), or null where the layout has no platform there. */
  dockOf(track) {
    for (const st of this.world.services.docks.values()) if (st.dock.kind === "rail" && String(st.dock.track ?? "") === track) return st.dock;
    return null;
  }

  /** The world's time goes on: a train that has come to a stand at a platform opens its doors there, one that leaves is gone. */
  step() {
    const g = this.game, services = this.world.services;
    if (services.planner !== this) return;
    for (const tr of g?.trains ?? []) {
      const here = tr.state === "dwelling" && tr.stops && !!tr.track, known = this.standing.get(tr.id);
      if (here && !known) {
        const dock = this.dockOf(tr.track);
        if (!dock || services.docks.get(dock.id)?.vehicle) continue;
        const vehicle = services.feedArrived(dock.id, { trainId: tr.id, line: tr.id, kind: TABLE_TRAIN.kind });
        if (vehicle) this.standing.set(tr.id, { dock, vehicle });
      } else if (!here && known) {
        services.feedDeparted(known.dock.id);
        this.standing.delete(tr.id);
      }
    }
    for (const [id, { dock }] of this.standing) {
      if (g?.trains.some((tr) => tr.id === id)) continue;
      services.feedDeparted(dock.id);
      this.standing.delete(id);
    }
  }

  /**
   * Is a train of the game coming to, or on, a place of the layout (a level crossing asks:
   * objects/crossings.js)? From CROSSING.before_m before its front reaches the place until its
   * end has passed it; a train standing at a platform is not coming. Null without a game: then
   * the board answers for no train.
   * @param {number[]} pos [x, y] layout mm
   * @returns {boolean | null}
   */
  trainsNear(pos) {
    const g = this.game;
    if (!g) return null;
    for (const tr of g.trains) {
      if (tr.state !== "running") continue;
      const place = this.at.place(tr, this.m);
      if (!place) continue;
      const on = polylineProject(place.line.points, pos, place.line.lengths);
      if (on.distance > CROSSING.beside_mm) continue;
      if (place.head > on.s - CROSSING.before_m * this.at.k && place.head - tr.length * this.at.k < on.s + CROSSING.behind_mm) return true;
    }
    return false;
  }

  /** The train of the game that a vehicle of the services stands for, or null. */
  trainOf(v) {
    return this.game?.trains.find((tr) => tr.id === v.trainId) ?? null;
  }

  /** The doors of a train standing at its platform: where they are along the platform (m). */
  doorsOf(v) {
    const tr = this.trainOf(v), place = tr && this.at.place(tr, this.m);
    if (!place) return [];
    const dock = v.dock, area = dock.area, out = [];
    let front = place.head;
    for (const car of this.carsOf(tr)) {
      for (const d of car.doors) {
        const s = area.fromLayout(polylineAt(place.line.points, front - (1 - d) * car.length_m * this.m, place.line.lengths).point)[0];
        if (s >= dock.s0 + 0.3 && s <= dock.s1 - 0.3) out.push(s);
      }
      front -= (car.length_m + car.gap_m) * this.m;
    }
    return out.sort((a, b) => a - b);
  }

  /** The places of a train (seats and standing), or null for a train without passengers. */
  placesOf(v) {
    const tr = this.trainOf(v);
    return tr ? STOCK[tr.kind]?.places || null : null;
  }

  carsOf(tr) {
    let cars = this.cache.get(tr.id);
    if (!cars) this.cache.set(tr.id, (cars = this.at.cars(tr, this.m)));
    return cars;
  }

  /* ---------------------------------------------------------------- drawing */

  /** The simulations' other duties, which the board has none of. */
  pickables() {
    return [];
  }

  states() {
    return [];
  }

  describeObject() {}

  describeVehicle() {}

  toJSON() {
    return { ...this.config };
  }

  /**
   * Draw the game on the table: the sections in the colour of their state, the signals, the trains,
   * the signs of the trains to come and, with a signal chosen, where its routes go.
   * @param {import("../arail/index.js").View} view
   */
  draw(view) {
    const g = this.game;
    if (!g) return;
    this._sections(view, g);
    for (const id of Object.keys(this.station.signals)) this._signal(view, g, id);
    for (const tr of g.trains) this._train(view, g, tr);
    this._coming(view, g);
    this._tracks().forEach((t) => this._trackSign(view, g, t));
    if (this.active) this._offers(view);
  }

  /** The way of a section as it is used now: by the route that locks it, else by the train on it, else straight. */
  _posNow(g, section) {
    const point = pointOf(this.station, section);
    if (!point) return "+";
    const lock = g.lockOf(section);
    if (lock) return lock.def.points[point] ?? "+";
    const on = g.occupancy().get(section), tr = on ? g.trains.find((x) => x.id === on) : null;
    return tr ? this.at.posOf(tr, section) : g.points[point].pos;
  }

  _sections(view, g) {
    const occ = g.occupancy(), beat = view.pulse ?? 1;
    for (const id of Object.keys(this.station.sections)) {
      const ways = this.at.table.sections[id];
      // where no real track shows (a virtual camera without the table's photo), the track itself
      for (const pos of Object.keys(ways)) {
        const w = this.at.way(id, pos, 1);
        if (!view.showsReal(w.points)) this._bed(view, w.points);
      }
      const lock = g.lockOf(id), tone = occ.has(id) ? "occupied" : lock ? "route" : g.closed.has(id) ? "closed" : null;
      if (!tone) continue;
      const w = this.at.way(id, this._posNow(g, id), 1), setting = tone === "route" && lock.state === "setting";
      // (a train shows itself: the band under it is faint)
      view.ribbon(w.points, BAND_MM, { fill: rgba(TONE[tone], tone === "occupied" ? 0.24 : setting ? 0.3 + 0.35 * beat : 0.62), order: 6, emissive: true });
    }
  }

  /** A track bed: ballast and two rails. */
  _bed(view, points) {
    view.ribbon(points, BED_MM, { fill: PALETTE.ballast, order: 4 });
    for (const side of [-1, 1]) {
      const rail = points.map((p, i) => {
        const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [p[0] - ((b[1] - a[1]) / l) * side * (GAUGE_MM / 2), p[1] + ((b[0] - a[0]) / l) * side * (GAUGE_MM / 2)];
      });
      view.line(rail, { stroke: PALETTE.rail, width: 1.2, order: 5 });
    }
  }

  /** A signal: its mast and head, its lamp (stop, proceed, the three lights of Zs 1), a ring on the ground and its name. */
  _signal(view, g, id) {
    const s = this.at.signal(id), a = g.aspect(id), mz = view.m(1), [x, y] = s.at;
    if (!view.inImage(x, y, 0, 200)) return;
    const box = (w, d, z0, z1, colour) => prismFaces(rectFootprint([x, y], view.m(w), view.m(d), s.heading), z0 * mz, z1 * mz, { side: colour, top: colour });
    view.faces([...box(0.7, 0.7, 0, 0.3, grey(0.6)), ...box(0.2, 0.2, 0.3, 4.2, grey(0.42)), ...box(0.4, 0.7, 4.2, 5.8, grey(0.14))], [x, y, 2 * mz]);
    const colour = a.aspect === "proceed" ? TONE.proceed : TONE.stop, beat = view.pulse ?? 1;
    // a failed signal flickers
    view.glow([x, y, 5.3 * mz], view.m(1.5), colour, a.failed ? 0.35 + 0.5 * beat : 1);
    if (a.zs1) for (const [dx, dz] of [[-0.25, 4.5], [0.25, 4.5], [0, 4.85]]) view.glow([x - Math.sin(s.heading) * view.m(dx), y + Math.cos(s.heading) * view.m(dx), dz * mz], view.m(0.5), TONE.zs1, 1);
    const chosen = this.picked === `signal-${id}`, ring = chosen ? TONE.choice : a.failed ? CD.rot : colour;
    const circle = (r) => Array.from({ length: 20 }, (_, i) => [x + r * Math.cos((i * Math.PI) / 10), y + r * Math.sin((i * Math.PI) / 10)]);
    view.polygon(circle(view.m(chosen || a.failed ? 2.6 + 0.9 * beat : 2.2)), { fill: rgba(ring, chosen ? 0.55 : 0.32), stroke: ring, width: 1.5, order: 7, emissive: true });
    view.label([x, y, 7.4 * mz], id, { size: 11, background: a.failed ? OVERLAY.dangerLabel : OVERLAY.label, fit: true });
  }

  /** A train: its cars along its way, its doors open at a platform, its number over it (and how late it is). */
  _train(view, g, tr) {
    if (tr.state !== "running" && tr.state !== "dwelling") return;
    const place = this.at.place(tr, this.m);
    if (!place?.on) return;
    const standing = this.standing.get(tr.id);
    const top = drawTrain(view, place.line, { head: place.head, dir: 1, cars: this.carsOf(tr), doors: standing ? 1 : 0, area: standing?.dock.area ?? null });
    if (!top) return;
    const late = Math.round((g.t - tr.due) / 60), halted = tr.state === "running" && tr.v === 0;
    const text = `${tr.id}${late >= 1 && (tr.stops ? tr.departed : tr.passed) == null ? ` +${late}` : ""}`;
    view.label([top[0], top[1], view.m(6)], halted ? [text, "waits at the signal"] : text, { size: 11, background: late >= 1 ? OVERLAY.dangerLabel : rgba(OVERLAY.sign, 0.94), fit: true });
  }

  /** The trains to come, as signs at the table's ends: which train, for which track, and when it comes (or how far it still is). */
  _coming(view, g) {
    const rows = { 1: [], [-1]: [] };
    for (const tr of g.trains) {
      if (tr.state === "coming" && tr.enterAt - g.t < 150) rows[tr.dir].push(`${tr.id} → ${tr.plan} · ${tr.enterAt <= g.t ? "now" : `in ${Math.max(1, Math.ceil(tr.enterAt - g.t))} s`}`);
      else if (tr.state === "running" && tr.head < this.station.sections[tr.path[0]].len && this.at.place(tr, this.m)?.head <= 0) {
        rows[tr.dir].push(`${tr.id} → ${tr.plan} · ${Math.max(0.1, Math.round((this.station.sections[tr.path[0]].len - tr.head) / 100) / 10)} km`);
      }
    }
    for (const dir of [1, -1]) {
      const w = this.at.way(dir > 0 ? "aw" : "ae", "+", dir), p = polylineAt(w.points, Math.min(w.total, 160), w.lengths).point;
      const from = dir > 0 ? this.station.west : this.station.east;
      view.label([p[0], p[1], view.m(rows[dir].length ? 9 : 5)], rows[dir].length ? [`From ${from}`, ...rows[dir]] : `${from}`, { size: rows[dir].length ? 11 : 10, background: rows[dir].length ? rgba(CD.dunkelblau, 0.94) : rgba(CD.dunkelblau, 0.6), fit: true });
    }
  }

  /** The name of a platform track on the table; orange where the track is closed. */
  _trackSign(view, g, track) {
    const id = Object.keys(this.station.sections).find((s) => this.station.sections[s].track === track), p = this.at.trackMiddle(track);
    const closed = g.closed.has(id), chosen = this.picked === `track-${track}`;
    view.plate(p, 0, view.m(9), view.m(3.4), { fill: chosen ? TONE.choice : closed ? TONE.closed : rgba(CD.dunkelblau, 0.82), text: closed ? `${track} closed` : track, textColour: chosen || closed ? CD.dunkelblau : CD.white, order: 8 });
  }

  /** With a signal chosen: where its routes go, as marks that pulse (a route that cannot be set now is faint). */
  _offers(view) {
    const beat = view.pulse ?? 1;
    for (const o of this.offers) {
      const r = this.station.routes.find((x) => x.id === o.route);
      if (!r) continue;
      const p = this.at.destination(r), rad = view.m(o.disabled ? 3 : 4 + 1.5 * beat);
      const circle = Array.from({ length: 24 }, (_, i) => [p[0] + rad * Math.cos((i * Math.PI) / 12), p[1] + rad * Math.sin((i * Math.PI) / 12)]);
      view.polygon(circle, { fill: rgba(o.disabled ? grey(0.6) : TONE.choice, o.disabled ? 0.35 : 0.6), stroke: o.disabled ? grey(0.5) : TONE.choice, width: 2, order: 9, emissive: true });
      view.label([p[0], p[1], view.m(4)], `→ ${r.to}`, { size: 12, background: o.disabled ? rgba(grey(0.3), 0.9) : rgba(CD.dunkelblau, 0.94), fit: true });
    }
  }

  /* ---------------------------------------------------------------- choosing */

  /**
   * What of the board is at a pixel: with a signal chosen, where one of its routes goes
   * (`{route}`); else a signal or a platform track (`{item}`, the id of the item of the game's
   * picture); else null.
   * @param {import("../arail/index.js").View} view the view of the frame drawn last
   * @param {number[]} pixel [u, v] canvas px
   * @param {number} [scale] how many CSS px a signal or a track may be away, as a factor (a finger: more)
   * @returns {{item: string} | {route: string} | null}
   */
  hit(view, [u, v], scale = 1) {
    if (!this.game) return null;
    const px = view.px, near = (p, r) => !!p && Math.hypot(p[0] - u, p[1] - v) <= r * px * scale;
    const mz = view.m(1);
    for (const o of this.offers) {
      const r = this.station.routes.find((x) => x.id === o.route), p = r && this.at.destination(r);
      if (p && near(view.project(p[0], p[1], 0), HIT_PX.signal * 1.3)) return { route: o.route };
    }
    // of the signals near enough (at their foot, their mast or their lamp), the nearest
    let signal = null;
    for (const id of Object.keys(this.station.signals)) {
      const [x, y] = this.at.signal(id).at;
      for (const z of [0, 2.8, 5.3]) {
        const p = view.project(x, y, z * mz), d = p ? Math.hypot(p[0] - u, p[1] - v) : Infinity;
        if (d <= HIT_PX.signal * px * scale && (!signal || d < signal.d)) signal = { d, id };
      }
    }
    if (signal) return { item: `signal-${signal.id}` };
    // a track: with a signal chosen, the track is where the signal's route goes
    let best = null;
    for (const [id, sec] of Object.entries(this.station.sections)) {
      if (!sec.track) continue;
      const w = this.at.way(id, "+", 1);
      for (let s = 0; s <= w.total; s += 40) {
        const q = polylineAt(w.points, s, w.lengths).point, p = view.project(q[0], q[1], 0), d = p ? Math.hypot(p[0] - u, p[1] - v) : Infinity;
        if (d <= HIT_PX.track * px * scale && (!best || d < best.d)) best = { d, track: sec.track };
      }
    }
    if (!best) return null;
    const offer = this.offers.find((o) => this.station.routes.find((x) => x.id === o.route)?.to === best.track);
    return offer ? { route: offer.route } : { item: `track-${best.track}` };
  }

  /** Where an item of the game's picture is on the table ("signal-A": the signal, "track-G2": the middle of the track), or null. */
  placeOf(item) {
    const [kind, id] = String(item ?? "").split(/-(.*)/s);
    if (kind === "signal" && this.station.signals[id]) return this.at.signal(id).at;
    if (kind === "track" && this._tracks().includes(id)) return this.at.trackMiddle(id);
    return null;
  }

  /** The part of the station a place lies in (`bounds`): "west", "platforms" or "east". */
  partOf([x]) {
    return x > X.P ? "west" : x < X.N ? "east" : "platforms";
  }

  /**
   * The part of the layout a game needs in the picture (layout mm, [x0, y0, x1, y1]): the whole
   * station, or one end of it ("west": the points towards Bergheim, "east": towards Talsee, "platforms").
   * @param {"all" | "west" | "platforms" | "east"} [part]
   */
  bounds(part = "all") {
    const x = { all: [X.be - 700, X.A + 500], west: [X.P - 200, X.A + 600], platforms: [X.N - 300, X.P + 300], east: [X.be - 900, X.N + 500] }[part] ?? [X.be - 700, X.A + 500];
    return [x[0], 120, x[1], 480];
  }
}
