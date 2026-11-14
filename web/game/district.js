// The maintenance dispatcher's game on the table: the district of arail/game/maintenance.js laid on
// the lab's layout of Bf Neustadt, and a board that draws a shift there. A fault is a ring at its
// asset that pulses while it waits (red: a danger nobody guards; orange: it holds trains), the teams
// are vans that drive the layout's streets from the maintenance base to it, their people stand and
// work at the asset, and a track asked or closed for them is a band on its rails. Nothing is
// written on the table: the names and the minutes are on the district's map beside it. What can be
// chosen on the map can be chosen here: a fault, then the van to send (or a van, then where it
// goes), the base to call a technician. Data, geometry and drawing on a View: no DOM.
//
// The table is smaller than the district, as every model railway is: the faults of Bf Neustadt are
// where their assets stand, and those of the other places lie on the stretch of the table that
// leads there (Bergheim: the line at the Bergheim end; Talsee: the line at the Talsee end, with the
// level crossing of Brückenstraße; Waldau: the light-rail strip at the windows). A van takes the
// time the game gives it, however short its way on the table is.
import { CD, CD_LIGHT, OVERLAY, STAFF_COLOURS, boxFaces, drawPerson, grey, polylineAt, polylineLengths, polylineProject, prismFaces, rectFootprint, rgba } from "../arail/index.js";
import { DISTRICT } from "../arail/game/maintenance.js";
import { TABLE, TableStation } from "./table.js";

/**
 * @typedef {object} Spot where something of the district is on the table
 * @property {number[]} at [x, y] layout mm: the asset itself
 * @property {number[]} park [x, y]: where a van leaves the street for it
 * @property {number[]} [stand] [x, y]: where the van stands, beside the asset (default: `park`)
 * @property {number} [z] how high the table is there (mm; the light-rail strip rises towards its end)
 * @property {string} [track] the track of the table the work is in (a section of table.js), for the band of its closure
 */

/**
 * The district on the table (layout mm): the maintenance base with its yard (where the vans stand,
 * and where they reach the street), a place of the table for every place of the district (for a
 * fault that has no spot of its own), and the spots of the faults by their id.
 * @type {{base: {at: number[], yard: number[][], gate: number[]}, places: Record<string, Spot>, spots: Record<string, Spot>}}
 */
export const DISTRICT_TABLE = {
  base: { at: [4780, -480], yard: [[4640, -345], [4760, -345], [4880, -345], [5000, -345]], gate: [4780, -217] },
  places: {
    "Bf Neustadt": { at: [3300, 150], park: [2930, -217], stand: [3300, 60] },
    Bergheim: { at: [7450, 262], park: [5500, -217], stand: [7300, 150] },
    Talsee: { at: [-1500, 436], park: [-1500, 235], stand: [-1500, 330] },
    Waldau: { at: [-150, 812], park: [-558, 800], stand: [-470, 760], z: 56 },
  },
  spots: {
    // (exit signal N2 stands where the signaller's table has it: `DistrictBoard#spot`)
    lift: { at: [2930, 268], park: [2930, -217], stand: [2890, -150] },
    bue: { at: [-560, 404], park: [-560, 250], stand: [-520, 290] },
    azs: { at: [-1200, 414], park: [-1200, 235], stand: [-1200, 320], track: "ae" },
    rail: { at: [-1750, 485], park: [-1700, 235], stand: [-1760, 380], track: "be" },
    w12: { at: [7250, 266], park: [5500, -217], stand: [7150, 150], track: "bw" },
    vsig: { at: [7700, 342], park: [5500, -217], stand: [7620, 150] },
    fence: { at: [-330, 760], park: [-558, 760], stand: [-480, 730], z: 56 },
    dfi: { at: [-245, 870], park: [-558, 871], stand: [-480, 850], z: 56 },
  },
};

/** The colours of the board: a danger nobody guards, a fault that waits, one a team is at, one repaired; what is chosen and what can be. */
const TONE = { danger: CD.rot, waits: CD_LIGHT.orange, minor: grey(0.72), handled: CD_LIGHT.tuerkis, done: "#3ed37a", choice: OVERLAY.task, closed: CD_LIGHT.orange };
/** The roofs of the vans by their trade (the technicians on call drive the same, a little smaller). */
const ROOF = { signalling: CD.orange, track: CD.tuerkis };
/** A van (m), how long a repaired fault stays on the table (s of the game), how much of a drive is getting ready (0 … 1). */
const VAN = { length_m: 5.6, width_m: 2.1, height_m: 2.5, small: 0.82 }, DONE_S = 90, READY = 0.12;
/** How near a click must be (CSS px): to a fault, to a van, to the base. */
export const HIT_PX = { fault: 26, van: 24, base: 30 };
/** How long the band of a closure is around the work (mm). */
const BAND_MM = { length: 420, width: 26 };

/** A length on the table (mm) that is at least so many CSS px in the picture: a mark must be found from far away too. */
const atLeast = (view, at, mm, px) => Math.max(mm, (px * view.px) / Math.max(1e-6, view.pxPerMM(at[0], at[1], at[2] ?? 0)));
const circle = ([x, y], r, n = 22) => Array.from({ length: n }, (_, i) => [x + r * Math.cos((i * 2 * Math.PI) / n), y + r * Math.sin((i * 2 * Math.PI) / n)]);

/**
 * The maintenance base: its yard and its hall with the gate.
 * @param {import("../arail/index.js").View} view
 * @param {typeof DISTRICT_TABLE.base} base
 */
export function drawBase(view, base) {
  const b = base, m = (x) => view.m(x);
  const yard = [[b.yard[0][0] - m(6), b.at[1]], [b.yard.at(-1)[0] + m(6), b.at[1]], [b.yard.at(-1)[0] + m(6), b.gate[1] - m(5.5)], [b.yard[0][0] - m(6), b.gate[1] - m(5.5)]];
  view.polygon(yard, { fill: grey(0.66), stroke: grey(0.5), width: 1, order: 3 });
  view.faces(prismFaces(rectFootprint(b.at, m(30), m(11)), 0, m(6), { side: grey(0.8), top: grey(0.6) }), [b.at[0], b.at[1], m(3)]);
  view.faces(prismFaces(rectFootprint([b.at[0], b.at[1] + m(5.6)], m(26), m(0.4)), 0, m(4.2), { side: CD.dunkelblau, top: CD.dunkelblau }), [b.at[0], b.at[1] + m(5.6), m(2)]);
}

/**
 * A team's van: white, its roof in the colour of its trade; a technician's is a little smaller.
 * @param {import("../arail/index.js").View} view
 * @param {number[]} at [x, y] layout mm
 * @param {number[]} dir where it looks
 * @param {{trade?: string, small?: boolean, beacon?: number | null}} [options] beacon: how bright its beacon is (0 … 1), or null
 */
export function drawTeamVan(view, at, dir, { trade = "signalling", small = false, beacon = null } = {}) {
  const [x, y] = at, m = (v) => view.m(v), k = small ? VAN.small : 1;
  if (!view.inImage(x, y, 0, 120)) return;
  const l = Math.hypot(dir[0], dir[1]) || 1, u = [dir[0] / l, dir[1] / l];
  const half = (m(VAN.length_m) * k) / 2, rear = [x - u[0] * half, y - u[1] * half], front = [x + u[0] * half, y + u[1] * half], roof = ROOF[trade] ?? grey(0.5);
  view.faces(boxFaces(rear, front, m(VAN.width_m) * k, m(0.35), m(VAN.height_m) * k, { side: "#f2f2ef", top: roof, end: grey(0.86) }), [x, y, m(1.2)]);
  if (beacon != null) view.glow([x, y, m(VAN.height_m + 0.3)], m(1.2), CD.orange, beacon);
}

/**
 * What is wrong with a district on the table: a place or a fault of the game without its spot, a
 * spot outside the part of the layout the table's camera may look at.
 * @param {typeof DISTRICT_TABLE} [table]
 * @param {{places: string[], faults: string[], area?: number[]}} [of] the game's places and faults, and where the camera may look ([x0, y0, x1, y1])
 * @returns {string[]}
 */
export function districtProblems(table = DISTRICT_TABLE, { places = Object.keys(DISTRICT.places), faults = [], area = null } = {}) {
  const problems = [];
  for (const p of places) if (!table.places[p]) problems.push(`The place ${p} has no spot on the table.`);
  for (const f of faults) if (f !== "N2" && !table.spots[f]) problems.push(`The fault ${f} has no spot on the table.`);
  if (area) {
    for (const [id, s] of [...Object.entries(table.places), ...Object.entries(table.spots)]) {
      for (const [name, q] of [["asset", s.at], ["street", s.park], ["van", s.stand ?? s.park]]) {
        if (q[0] < area[0] || q[0] > area[2] || q[1] < area[1] || q[1] > area[3]) problems.push(`${id}: its ${name} lies outside the table's picture.`);
      }
    }
  }
  return problems;
}

/**
 * The board of a maintenance dispatcher's game on the layout's world: one of the world's
 * simulations (drawn with everything else, so a van passes behind a house), which changes nothing
 * in the world but the platform track a team works in: no train of the world's own timetable is
 * sent there while it is closed (where a signaller's game runs the station, that is the signaller's).
 */
export class DistrictBoard {
  static elevation = "ground";
  static type = "district-board";

  /**
   * @param {import("../arail/index.js").World} world the world of the layout the table lies on
   * @param {{table?: typeof DISTRICT_TABLE}} [options]
   */
  constructor(world, { table = DISTRICT_TABLE } = {}) {
    this.world = world;
    this.table = table;
    this.station = new TableStation();
    this.enabled = true;
    this.config = { type: DistrictBoard.type };
    /** @type {import("../arail/game/maintenance.js").MaintenanceGame | null} the game shown */
    this.game = null;
    /** What is chosen (an item of the game's picture: "fault-bue", "team-T1", "base"), and the moves offered from it (`{i, target}`). */
    this.picked = null;
    this.offers = [];
    /** Whether a person can choose (else the board only shows). */
    this.active = false;
    /** Where each team's van stood last (a fault's id, or "base"), and the ways between two stands. */
    this.last = new Map();
    this.ways = new Map();
    /** The platform tracks closed for a team now (their names), which the board keeps the world's trains off. */
    this.closed = new Set();
    world.simulations.push(this);
  }

  /** Show a game (null: none). */
  show(game) {
    if (game === this.game) return;
    this.game = game ?? null;
    this.last.clear();
    this._plan(new Set());
  }

  /** Take the board out of its world again. */
  dispose() {
    this._plan(new Set());
    const sims = this.world.simulations, i = sims.indexOf(this);
    if (i >= 0) sims.splice(i, 1);
  }

  /* ---------------------------------------------------------------- the world's services */

  /** The platform tracks of the station closed for a team now (their names: "G2"). */
  closedTracks(g = this.game) {
    const out = new Set();
    for (const f of g?.faults ?? []) {
      if (f.closure !== "closed" || f.state === "done" || f.reported == null) continue;
      const track = this.station.station.sections[this.spot(f).track]?.track;
      if (track) out.add(track);
    }
    return out;
  }

  /** A platform track closed for a team is the board's while it is closed: the world's timetable sends no train there (ServiceManager.planner). */
  claims(dock) {
    return dock.kind === "rail" && this.closed.has(String(dock.track ?? ""));
  }

  /**
   * Keep the world's trains off the tracks closed now. Only where no other board plans the platform
   * tracks: the signaller's does, and closes the track in its own game.
   */
  _plan(closed) {
    const services = this.world.services;
    if (services.planner != null && services.planner !== this) return void (this.closed = new Set());
    if (closed.size === this.closed.size && [...closed].every((t) => this.closed.has(t))) return;
    this.closed = closed;
    services.planner = closed.size ? this : null;
    services.refreshModes();
  }

  /* ---------------------------------------------------------------- where things are */

  /**
   * The spot of a fault: its own, exit signal N2 where the signaller's table has it, else that of its place.
   * @param {{id: string, place: string}} fault
   * @returns {Spot}
   */
  spot(fault) {
    if (this.table.spots[fault.id]) return this.table.spots[fault.id];
    if (this.station.station.signals[fault.id]) {
      const at = this.station.signal(fault.id).at, sig = this.station.station.signals[fault.id];
      return (this._signals ||= new Map()).get(fault.id) ?? this._signals.set(fault.id, { at, park: [1340, -18], stand: [at[0] - 60, 180], track: sig.section }).get(fault.id);
    }
    return this.table.places[fault.place] ?? this.table.places[DISTRICT.base];
  }

  /** Where a van stands: in the yard of the base (each team its slot), or beside a fault. */
  stand(key, team) {
    if (key === "base") {
      const i = Math.max(0, this.game?.teams.indexOf(team) ?? 0), yard = this.table.base.yard;
      return yard[i % yard.length];
    }
    const f = this.game?.fault(key), s = f ? this.spot(f) : this.table.places[key] ?? this.table.places[DISTRICT.base];
    return s.stand ?? s.park;
  }

  /** Where a team's van stood before it set off (or stands now): the fault it was at last, else the base or its place. */
  from(team) {
    return this.last.get(team.id) ?? (team.base ? "base" : team.place);
  }

  /**
   * The way of a van from one stand to another: out to the street, along the streets (the world's
   * road network, as its cars drive), and to the asset; straight where the streets do not connect.
   * @returns {{points: number[][], lengths: number[], total: number}}
   */
  way(fromKey, toKey, team) {
    const key = `${fromKey}>${toKey}>${fromKey === "base" || toKey === "base" ? team.id : ""}`;
    let w = this.ways.get(key);
    if (w) return w;
    const street = (k) => (k === "base" ? this.table.base.gate : (this.game?.fault(k) ? this.spot(this.game.fault(k)) : this.table.places[k] ?? this.table.places[DISTRICT.base]).park);
    const a = this.stand(fromKey, team), b = this.stand(toKey, team), points = [a];
    const net = this.world.network?.(), n0 = net?.nearestNode(street(fromKey), { mode: "car" }), n1 = net?.nearestNode(street(toKey), { mode: "car" });
    const route = n0 && n1 && n0 !== n1 ? net.route(n0, n1, { mode: "car" }) : null;
    for (const p of route ? route.points : [street(fromKey), street(toKey)]) if (Math.hypot(p[0] - points.at(-1)[0], p[1] - points.at(-1)[1]) > 1) points.push([p[0], p[1]]);
    if (Math.hypot(b[0] - points.at(-1)[0], b[1] - points.at(-1)[1]) > 1) points.push(b);
    if (points.length < 2) points.push([b[0] + 1, b[1]]);
    const lengths = polylineLengths(points);
    w = { points, lengths, total: lengths.at(-1) };
    this.ways.set(key, w);
    return w;
  }

  /**
   * Where a team's van is now: on its way (the first part of a drive is getting ready), or standing.
   * @returns {{at: number[], dir: number[], driving: boolean}}
   */
  van(team) {
    const g = this.game;
    if (team.state === "driving" && team.fault) {
      const w = this.way(this.from(team), team.fault, team), span = Math.max(1, team.until - team.left);
      const u = Math.max(0, Math.min(1, ((g.t - team.left) / span - READY) / (1 - READY)));
      const p = polylineAt(w.points, w.total * u * u * (3 - 2 * u), w.lengths);
      return { at: p.point, dir: p.dir, driving: u > 0 && u < 1 };
    }
    const key = team.fault ?? this.from(team), at = this.stand(key, team);
    // (standing, a van looks the way it came)
    return { at, dir: key === "base" ? [0, 1] : [1, 0], driving: false };
  }

  /** The world's time goes on: the board remembers where each van stands, for the way it takes next, and keeps the world's trains off a closed platform track. */
  step() {
    const g = this.game;
    if (!g) return;
    this._plan(this.closedTracks(g));
    for (const tm of g.teams) {
      if (tm.state === "driving") continue;
      if (tm.fault) this.last.set(tm.id, tm.fault);
      else if (tm.base) this.last.set(tm.id, "base");
    }
  }

  /* ---------------------------------------------------------------- drawing */

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

  /** The faults on the table now: reported, and not repaired longer ago than DONE_S. */
  shown(g = this.game) {
    return (g?.faults ?? []).filter((f) => f.reported != null && (f.state !== "done" || g.t - f.done < DONE_S));
  }

  /** The tone of a fault: a danger nobody guards, one that waits (and matters), one a team is at, one repaired. */
  tone(f, g = this.game) {
    if (f.state === "done") return "done";
    if (g.exposed(f)) return "danger";
    if (f.state === "open" || f.state === "secured") return f.holds || f.safety ? "waits" : "minor";
    return "handled";
  }

  /**
   * Draw the shift on the table: the base, the tracks asked or closed for a team, the faults, the vans and the people at work. No text.
   * @param {import("../arail/index.js").View} view
   */
  draw(view) {
    const g = this.game;
    if (!g) return;
    this._base(view, g);
    for (const f of this.shown(g)) {
      this._closure(view, g, f);
      this._fault(view, g, f);
    }
    for (const tm of g.teams) this._team(view, g, tm);
  }

  /** The maintenance base: its hall and its yard; it pulses in the choice's colour while a technician can be called from it. */
  _base(view, g) {
    const b = this.table.base, m = (x) => view.m(x), beat = view.pulse ?? 1;
    drawBase(view, b);
    const chosen = this.picked === "base";
    if (this.active && (chosen || this._canCall(g))) view.polygon(circle([b.at[0], b.at[1] + m(8)], atLeast(view, b.at, m(3.2), 7) * (chosen ? 1.5 : 1 + 0.25 * beat)), { fill: rgba(TONE.choice, chosen ? 0.6 : 0.2 + 0.25 * beat), stroke: TONE.choice, width: 1.5, order: 7, emissive: true });
  }

  _canCall(g) {
    return Object.values(g.onCall ?? {}).includes("available") && g.faults.some((f) => (f.state === "open" || f.state === "secured") && (f.holds || f.safety));
  }

  /** The track a team works in: a band on its rails, pulsing while the closure is asked for, steady once it is closed. */
  _closure(view, g, f) {
    if (!f.track || f.state === "done" || (f.closure !== "asked" && f.closure !== "closed")) return;
    const s = this.spot(f), ways = TABLE.sections[s.track];
    if (!ways) return;
    const w = this.station.way(s.track, "+", 1), on = polylineProject(w.points, s.at, w.lengths), beat = view.pulse ?? 1;
    // (a platform track is closed as a whole; of a line, the stretch around the work)
    const whole = !!this.station.station.sections[s.track]?.track, a = whole ? 0 : Math.max(0, on.s - BAND_MM.length / 2), b = whole ? w.total : Math.min(w.total, on.s + BAND_MM.length / 2);
    const pts = [polylineAt(w.points, a, w.lengths).point, ...w.points.filter((_, i) => w.lengths[i] > a && w.lengths[i] < b), polylineAt(w.points, b, w.lengths).point];
    view.ribbon(pts, BAND_MM.width, { fill: rgba(TONE.closed, f.closure === "closed" ? 0.6 : 0.2 + 0.35 * beat), order: 6, emissive: true });
  }

  /** A fault: a ring on the ground at its asset in the colour of its state, and a post with a lamp over it; one that waits pulses. */
  _fault(view, g, f) {
    const s = this.spot(f), [x, y] = s.at, z = s.z ?? 0, m = (v) => view.m(v), beat = view.pulse ?? 1;
    if (!view.inImage(x, y, z, 200)) return;
    const tone = this.tone(f, g), chosen = this.picked === `fault-${f.id}`, offered = this.active && this.offers.some((o) => o.target === `fault-${f.id}` && !o.disabled);
    const colour = chosen || offered ? TONE.choice : TONE[tone], pulses = chosen || offered || tone === "danger" || tone === "waits";
    const fade = tone === "done" ? Math.max(0, 1 - (g.t - f.done) / DONE_S) : 1;
    const r = atLeast(view, [x, y, z], m(3), 8);
    view.polygon(circle([x, y], r * (pulses ? 1 + 0.4 * beat : 0.9)), { z, fill: rgba(colour, (chosen ? 0.6 : pulses ? 0.22 + 0.34 * beat : 0.34) * fade), stroke: rgba(colour, fade), width: tone === "danger" ? 2.5 : 1.6, order: 8, emissive: true });
    if (tone === "danger") view.polygon(circle([x, y], r * (1.7 + 0.7 * beat)), { z, stroke: rgba(colour, 0.75 - 0.5 * beat), width: 2, order: 8, emissive: true });
    if (tone === "done") return;
    // a post with a lamp, so that the fault is found from the side too
    const post = prismFaces(rectFootprint([x, y], m(0.3), m(0.3)), z, z + m(4.4), { side: grey(0.3), top: grey(0.3) }), lamp = prismFaces(rectFootprint([x, y], m(1.1), m(1.1)), z + m(4.4), z + m(5.5), { side: colour, top: colour });
    view.faces([...post, ...lamp], [x, y, z + m(3)], { emissive: true });
    view.glow([x, y, z + m(5)], m(2.4), colour, pulses ? 0.5 + 0.5 * beat : 0.7);
  }

  /** A team: its van where it is, a ring under it where it can be chosen or sent, and its people at the asset while they are there. */
  _team(view, g, tm) {
    const v = this.van(tm), m = (x) => view.m(x), beat = view.pulse ?? 1, [x, y] = v.at;
    const chosen = this.picked === `team-${tm.id}`, offered = this.active && this.offers.some((o) => o.target === `team-${tm.id}` && !o.disabled);
    const free = this.active && tm.state === "ready" && g.faults.some((f) => f.state === "open" || f.state === "secured");
    if (chosen || offered || free) {
      const strong = chosen || offered;
      view.polygon(circle([x, y], atLeast(view, [x, y], m(3.6), 8) * (strong ? 1.2 + 0.3 * beat : 1)), { fill: rgba(TONE.choice, chosen ? 0.6 : strong ? 0.25 + 0.3 * beat : 0.16), stroke: rgba(TONE.choice, strong ? 1 : 0.6), width: strong ? 2 : 1.2, order: 7, emissive: true });
    }
    // the beacon: on the road, and at a danger the team guards
    drawTeamVan(view, v.at, v.dir, { trade: tm.trade, small: tm.overtime, beacon: v.driving || tm.state === "securing" ? 0.5 + 0.5 * beat : null });
    const f = tm.fault ? g.fault(tm.fault) : null;
    if (!f || tm.state === "driving" || tm.state === "ready") return;
    // its people: beside the van while they wait for the closure, at the asset when they look, work or guard
    const s = this.spot(f), t = view.time ?? 0, waits = tm.state === "waiting", at = waits ? [x, y] : s.at, busy = tm.state === "working" || tm.state === "diagnosing";
    for (const i of [0, 1]) {
      const a = t * (busy ? 1.1 : 0) + i * Math.PI, r = m(waits ? 2.6 : tm.state === "securing" ? 4.2 : 1.6);
      const p = [at[0] + r * Math.cos(a + i * 0.6) * (waits ? 1 : 1), at[1] + r * Math.sin(a + i * 0.6) * (tm.state === "securing" ? 0.25 : 0.7)];
      drawPerson(view, s.z && !waits ? [p[0], p[1]] : p, { dir: [-Math.sin(a), Math.cos(a)], speed: busy ? 0.6 : 0, phase: t * 5 + i * 2, height: 1.8, colour: STAFF_COLOURS.body, legs: STAFF_COLOURS.legs });
    }
  }

  /* ---------------------------------------------------------------- choosing */

  /**
   * What of the board is at a pixel: with something chosen, the thing one of its moves needs
   * (`{target}`: the item it needs, by which the page finds the move in the menu as it is now); else a fault, a van or the base
   * (`{item}`, the id of the item of the game's picture); else null.
   * @param {import("../arail/index.js").View} view the view of the frame drawn last
   * @param {number[]} pixel [u, v] canvas px
   * @param {number} [scale] how many CSS px a thing may be away, as a factor (a finger: more)
   * @returns {{item: string} | {target: string} | null}
   */
  hit(view, [u, v], scale = 1) {
    const g = this.game;
    if (!g) return null;
    const px = view.px, mz = view.m(1);
    let best = null;
    const near = (id, at, r, zs = [0]) => {
      for (const z of zs) {
        const p = view.project(at[0], at[1], (at[2] ?? 0) + z * mz), d = p ? Math.hypot(p[0] - u, p[1] - v) : Infinity;
        if (d <= r * px * scale && (!best || d < best.d)) best = { d, id };
      }
    };
    for (const f of this.shown(g)) {
      if (f.state === "done") continue;
      const s = this.spot(f);
      near(`fault-${f.id}`, [s.at[0], s.at[1], s.z ?? 0], HIT_PX.fault, [0, 2.5, 5]);
    }
    for (const tm of g.teams) near(`team-${tm.id}`, this.van(tm).at, HIT_PX.van, [0, 1.5]);
    const b = this.table.base;
    near("base", [b.at[0], b.at[1] + view.m(8)], HIT_PX.base);
    near("base", b.at, HIT_PX.base, [0, 4]);
    if (!best) return null;
    const offer = this.offers.find((o) => o.target === best.id);
    return offer ? { target: offer.target } : { item: best.id };
  }

  /** Where an item of the game's picture is on the table ("fault-bue", "team-T1", "base"), or null. */
  placeOf(item) {
    const [kind, id] = String(item ?? "").split(/-(.*)/s), g = this.game;
    if (item === "base") return this.table.base.at;
    if (kind === "fault" && g?.fault(id)) return this.spot(g.fault(id)).at;
    const tm = kind === "team" ? g?.teams.find((x) => x.id === id) : null;
    return tm ? this.van(tm).at : null;
  }

  /** The part of the table a place lies in (`bounds`): "west", "platforms" or "east". */
  partOf([x]) {
    return x > 4300 ? "west" : x < 1500 ? "east" : "platforms";
  }

  /**
   * The part of the layout the game needs in the picture (layout mm, [x0, y0, x1, y1]): the whole
   * district on the table, or a part of it ("west": the base and the Bergheim end, "platforms": the
   * station, "east": the Talsee end and the strip towards Waldau).
   * @param {"all" | "west" | "platforms" | "east"} [part]
   */
  bounds(part = "all") {
    const x = { all: [-2000, 7800], west: [4100, 7900], platforms: [1200, 4700], east: [-2100, 1700] }[part] ?? [-2000, 7800];
    return [x[0], -430, x[1], 900];
  }
}
