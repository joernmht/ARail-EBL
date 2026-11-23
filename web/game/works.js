// The maintenance district manager on the table: the week of arail/game/works.js is played on the
// lab's layout of Bf Neustadt, by day and by night as the week's clock runs. Every work has its
// site where its area lies on the table: a thin ring while it is planned (orange while something
// is missing for it), and while it runs a building site: the possession as a band on its rails,
// barriers, the tamping machine, the people at work, lamps in the dark. A fault is a ring with a
// lamp at its asset, a track closed or slowed for it a red or yellow band, and the trains that are
// held by a work or a fault are discs beside the track, more of them the denser the traffic is.
// The people are vans: each drives from its home (a small house where the person lives: at the
// Bergheim end, in the town, at the Talsee end, on the strip towards Waldau, beyond the table's
// edge) to the base in the morning and home in the afternoon, to a night's site and back, to a
// fault with its beacon on. The four people who are told are pins where they sit: operations at
// the platform tracks, the works council and the team at the base, the town at the town hall,
// safety at the station building, each in the colour of its patience. The houses beside a night's
// site show whether they were told: a note at the door, or lit windows and a red ring when the
// machines came unannounced. In the storm the layout's weather is the storm.
//
// What can be chosen in the picture of the week beside the table can be chosen here: a van, then
// the site or the fault it goes to; a pin, then what is told there; a site, for its slots. Nothing
// is written on the table. Data, geometry and drawing on a View: no DOM.
import { CD, CD_LIGHT, OVERLAY, STAFF_COLOURS, drawPerson, grey, polylineAt, polylineLengths, prismFaces, rectFootprint, rgba } from "../arail/index.js";
import { DISTRICT_TABLE, drawBase, drawTeamVan } from "./district.js";
import { TableStation } from "./table.js";

/**
 * The week on the table (layout mm). `areas`: for each area of the game the track its works are
 * in (a section of table.js and how far along it, 0 … 1), the track beside it (where a driver's
 * report lies), the place of the district's table a van parks at, and where its houses stand
 * (from the site: along the track and away from it, mm). `faults`: the spots of faults that are
 * not on an area's track. `homes`: where each person lives (the house, and where its van leaves
 * the street). `pins`: where the people who are told sit.
 */
export const WORKS_TABLE = {
  areas: {
    west: { section: "bw", share: 0.55, beside: ["aw", 0.5], place: "Bergheim", houses: [[-260, -170], [-40, -200], [200, -170]] },
    station: { section: "g3", share: 0.45, beside: ["w2", 0.5], place: "Bf Neustadt", houses: [] },
    east: { section: "be", share: 0.4, beside: ["ae", 0.45], place: "Talsee", houses: [[-220, -190], [0, -215], [230, -185]] },
    branch: { place: "Waldau", houses: [] },
  },
  faults: { crossing: DISTRICT_TABLE.spots.bue, tree: { at: [-330, 760], z: 56 } },
  homes: {
    p1: { at: [7650, -120], park: [5500, -217] },
    p2: { at: [-2250, 120], park: [-1700, 235] },
    p3: { at: [1900, -330], park: [1900, -217] },
    p4: { at: [-1250, 140], park: [-1500, 235] },
    p5: { at: [-660, 900], park: [-558, 871], z: 56 },
  },
  pins: { ops: [3250, 330], council: [5060, -470], staff: [4780, -392], town: [1500, -420], safety: [2930, -107] },
};

/** The colours of the board: a work as planned, one that misses something, a possession, a closed and a slowed track, a danger, what is done, what is chosen or asked, a note at a door. */
const TONE = { plan: CD_LIGHT.tuerkis, warn: CD_LIGHT.orange, possession: CD_LIGHT.orange, closed: CD.rot, slow: "#f2c400", bad: CD.rot, ok: "#3ed37a", choice: OVERLAY.task, note: CD_LIGHT.tuerkis, lit: "#ffd98a" };
/** How near a click must be (CSS px): to a site, a fault, a van, a pin. */
export const HIT_PX = { work: 28, fault: 26, person: 24, pin: 26 };
/** The band of a possession around its site (mm), a held train's disc (m), the most discs, how far apart they lie (mm). */
const BAND_MM = { length: 520, width: 28 }, HELD = { r_m: 2.2, most: 4, gap_mm: 105 };
/** The patience below which a pin is orange, and red (as the game's marks). */
const MARK = { call: 62, act: 35 };
/** How much of a drive is getting ready (0 … 1), and how long a cleared fault stays on the table (h of the week). */
const READY = 0.1, CLEARED_H = 1.5;

const circle = ([x, y], r, n = 22) => Array.from({ length: n }, (_, i) => [x + r * Math.cos((i * 2 * Math.PI) / n), y + r * Math.sin((i * 2 * Math.PI) / n)]);
/** A length on the table (mm) that is at least so many CSS px in the picture. */
const atLeast = (view, at, mm, px) => Math.max(mm, (px * view.px) / Math.max(1e-6, view.pxPerMM(at[0], at[1], at[2] ?? 0)));

/**
 * What is wrong with a week on the table: an area, a person or somebody who is told without a
 * place, a place outside the part of the layout the table's camera may look at.
 * @param {typeof WORKS_TABLE} [table]
 * @param {{areas: string[], people: string[], audiences: string[], area?: number[]}} of the game's areas, people and audiences, and where the camera may look
 * @returns {string[]}
 */
export function worksProblems(table = WORKS_TABLE, { areas = [], people = [], audiences = [], area = null } = {}) {
  const problems = [];
  for (const a of areas) if (!table.areas[a] || !DISTRICT_TABLE.places[table.areas[a].place]) problems.push(`The area ${a} has no place on the table.`);
  for (const p of people) if (!table.homes[p]) problems.push(`${p} has no home on the table.`);
  for (const a of [...audiences, "staff"]) if (!table.pins[a]) problems.push(`${a} has no pin on the table.`);
  if (area) {
    const inside = (q) => q[0] >= area[0] && q[0] <= area[2] && q[1] >= area[1] && q[1] <= area[3];
    for (const [id, home] of Object.entries(table.homes)) if (!inside(home.at) || !inside(home.park)) problems.push(`${id}: the home lies outside the table's picture.`);
    for (const [id, q] of Object.entries(table.pins)) if (!inside(q)) problems.push(`${id}: the pin lies outside the table's picture.`);
  }
  return problems;
}

/**
 * The board of a maintenance district manager's game on the layout's world: one of the world's
 * simulations (drawn with everything else, so a van passes behind a house). It changes nothing in
 * the world but two things: no train of the world's own timetable is sent onto platform track G3
 * while a possession holds there, and while the game's storm blows the world's weather is a storm.
 */
export class WorksBoard {
  static elevation = "ground";
  static type = "works-board";

  /**
   * @param {import("../arail/index.js").World} world the world of the layout the table lies on
   * @param {{table?: typeof WORKS_TABLE}} [options]
   */
  constructor(world, { table = WORKS_TABLE } = {}) {
    this.world = world;
    this.table = table;
    this.station = new TableStation();
    this.enabled = true;
    this.config = { type: WorksBoard.type };
    /** @type {import("../arail/game/works.js").WorksGame | null} the game shown */
    this.game = null;
    /** What is chosen (an item of the game's picture: "work-tamp", "person-p1", "fault-knock", "aud-ops"), and the moves offered from it. */
    this.picked = null;
    this.offers = [];
    /** Whether a person can choose (else the board only shows). */
    this.active = false;
    /** The ways between two stands, the platform tracks under a possession now, and the weather the world had before the storm (null: no storm set). */
    this.ways = new Map();
    this.closed = new Set();
    this.weatherWas = null;
    world.simulations.push(this);
  }

  /** Show a game (null: none). */
  show(game) {
    if (game === this.game) return;
    this.game = game ?? null;
    this._plan(new Set());
    this._weather(null);
  }

  /** Take the board out of its world again: its trains and its weather are the world's own again. */
  dispose() {
    this._plan(new Set());
    this._weather(null);
    const sims = this.world.simulations, i = sims.indexOf(this);
    if (i >= 0) sims.splice(i, 1);
  }

  /* ---------------------------------------------------------------- the world's services */

  /** A platform track under a possession is the board's while it holds: the world's timetable sends no train there (ServiceManager.planner). */
  claims(dock) {
    return dock.kind === "rail" && this.closed.has(String(dock.track ?? ""));
  }

  /** Keep the world's trains off the platform tracks under a possession now; only where no other board plans the platform tracks. */
  _plan(closed) {
    const services = this.world.services;
    if (!services || (services.planner != null && services.planner !== this)) return void (this.closed = new Set());
    if (closed.size === this.closed.size && [...closed].every((t) => this.closed.has(t))) return;
    this.closed = closed;
    services.planner = closed.size ? this : null;
    services.refreshModes();
  }

  /** The world's weather while the game's storm blows ("strong", "weak"), and what it was before once it has passed (null). */
  _weather(storm) {
    const w = this.world.weather;
    if (!w?.set) return;
    if (storm && this.weatherWas == null) {
      this.weatherWas = w.mode === "fixed" ? w.preset : w.mode;
      w.set(storm === "strong" ? "thunderstorm" : "heavy-rain");
    } else if (!storm && this.weatherWas != null) {
      w.set(this.weatherWas);
      this.weatherWas = null;
    }
  }

  /** The world's time goes on: the board keeps the world's trains off a track under a possession, and its weather with the game's. */
  step() {
    const g = this.game;
    if (!g) return;
    const d = g.district(), closed = new Set();
    const track = this.station.station.sections[this.table.areas.station.section]?.track;
    if (d.areas.station.possession && track) closed.add(track);
    this._plan(closed);
    this._weather(d.storm);
  }

  /* ---------------------------------------------------------------- where things are */

  /** A point of the table's rails: so far (0 … 1) along a section of the signaller's station, with the track's direction there. */
  rail(section, share) {
    const w = this.station.way(section, "+", 1), p = polylineAt(w.points, w.total * share, w.lengths);
    return { at: p.point, dir: p.dir, way: w, s: w.total * share };
  }

  /**
   * Where an area's works are: on its track, or (the branch, which the station's table has no
   * track of) at its place on the district's table.
   * @returns {{at: number[], dir: number[], z: number, way?: object, s?: number}}
   */
  site(area) {
    const a = this.table.areas[area], place = DISTRICT_TABLE.places[a.place];
    if (!a.section) return { at: place.at, dir: [1, 0], z: place.z ?? 0 };
    return { ...this.rail(a.section, a.share), z: 0 };
  }

  /** Where a fault is: on the track beside its area's site, or at its own spot (the crossing, the tree). */
  spot(f) {
    const own = this.table.faults[f.kind];
    if (own) return { at: own.at, z: own.z ?? 0 };
    const a = this.table.areas[f.area];
    if (!a.beside) return this.site(f.area);
    const [section, share] = f.kind === "nearmiss" ? [a.section, a.share] : a.beside;
    return { ...this.rail(section, share), z: 0 };
  }

  /** Where a van stands: at a home ("home:p1"), in the yard of the base (each person a slot), or beside an area's site. */
  stand(key, i = 0) {
    if (key === "base") return DISTRICT_TABLE.base.yard[i % DISTRICT_TABLE.base.yard.length];
    if (key.startsWith("home:")) {
      const h = this.table.homes[key.slice(5)];
      return [h.at[0] + 46, h.at[1] + 30];
    }
    const place = DISTRICT_TABLE.places[this.table.areas[key].place];
    // (each person a little apart, so that two vans at one site are two)
    return [(place.stand ?? place.park)[0] + 62 * i, (place.stand ?? place.park)[1] + 14 * (i % 2)];
  }

  /** Where a van leaves the street for a stand. */
  street(key) {
    if (key === "base") return DISTRICT_TABLE.base.gate;
    if (key.startsWith("home:")) return this.table.homes[key.slice(5)].park;
    return DISTRICT_TABLE.places[this.table.areas[key].place].park;
  }

  /**
   * The way of a van from one stand to another: out to the street, along the streets (the world's
   * road network, as its cars drive), and to the stand; straight where the streets do not connect.
   * @returns {{points: number[][], lengths: number[], total: number}}
   */
  way(from, to, i = 0) {
    const key = `${from}>${to}>${i}`;
    let w = this.ways.get(key);
    if (w) return w;
    const a = this.stand(from, i), b = this.stand(to, i), points = [a];
    const net = this.world.network?.(), n0 = net?.nearestNode(this.street(from), { mode: "car" }), n1 = net?.nearestNode(this.street(to), { mode: "car" });
    const route = n0 && n1 && n0 !== n1 ? net.route(n0, n1, { mode: "car" }) : null;
    for (const p of route ? route.points : [this.street(from), this.street(to)]) if (Math.hypot(p[0] - points.at(-1)[0], p[1] - points.at(-1)[1]) > 1) points.push([p[0], p[1]]);
    if (Math.hypot(b[0] - points.at(-1)[0], b[1] - points.at(-1)[1]) > 1) points.push(b);
    if (points.length < 2) points.push([b[0] + 1, b[1]]);
    const lengths = polylineLengths(points);
    w = { points, lengths, total: lengths.at(-1) };
    this.ways.set(key, w);
    return w;
  }

  /**
   * Where a person's van is now, from where the game says the person is.
   * @param {{id: string, at: string, to?: string, u?: number}} p a person of the game's picture of the district
   * @param {number} i the person's place in the list
   * @returns {{at: number[], dir: number[], driving: boolean, z: number}}
   */
  van(p, i) {
    const key = (k) => (k === "home" ? `home:${p.id}` : k), z = (k) => (k === "home" ? this.table.homes[p.id].z ?? 0 : k === "branch" ? DISTRICT_TABLE.places.Waldau.z ?? 0 : 0);
    if (p.to != null && p.to !== p.at) {
      const w = this.way(key(p.at), key(p.to), i), u = Math.max(0, Math.min(1, ((p.u ?? 0) - READY) / (1 - READY)));
      const q = polylineAt(w.points, w.total * u * u * (3 - 2 * u), w.lengths);
      return { at: q.point, dir: q.dir, driving: u > 0 && u < 1, z: u < 0.5 ? z(p.at) * (1 - 2 * u) : z(p.to) * (2 * u - 1) };
    }
    return { at: this.stand(key(p.at), i), dir: p.at === "base" ? [0, 1] : [1, 0], driving: false, z: z(p.at) };
  }

  /** Where the houses of an area stand (beside its site, on the town's side). */
  houses(area) {
    const a = this.table.areas[area];
    if (!a.houses.length) return [];
    const s = this.site(area), n = [-s.dir[1], s.dir[0]], side = n[1] <= 0 ? 1 : -1;
    return a.houses.map(([along, away]) => [s.at[0] + s.dir[0] * along + n[0] * side * -away, s.at[1] + s.dir[1] * along + n[1] * side * -away]);
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

  /** The items of the game's picture a question is about now. */
  asked(g = this.game) {
    const out = new Set();
    for (const d of g?.open ?? []) for (const id of g.about.get(d.id) ?? []) out.add(id);
    return out;
  }

  /** Whether an item of the game's picture is chosen, or is what a move of the chosen thing needs. */
  _marked(item) {
    return this.picked === item || (this.active && this.offers.some((o) => o.target === item && !o.disabled));
  }

  /**
   * Draw the week on the table: the base, the homes, the bands on the rails, the sites, the faults, the trains held, the vans, the pins. No text.
   * @param {import("../arail/index.js").View} view
   */
  draw(view) {
    const g = this.game;
    if (!g) return;
    const d = g.district(), asked = this.asked(g);
    drawBase(view, DISTRICT_TABLE.base);
    for (const [area, a] of Object.entries(d.areas)) this._track(view, area, a);
    for (const [area, a] of Object.entries(d.areas)) this._houses(view, area, a, d.night);
    for (const p of d.people) this._home(view, p, d.night);
    for (const w of d.works) this._work(view, w, d, asked);
    for (const f of d.faults) this._fault(view, f, d, asked);
    d.people.forEach((p, i) => this._person(view, p, i, d, asked));
    for (const [who, mood] of Object.entries({ ...d.moods, staff: null })) this._pin(view, who, mood, asked);
  }

  /** An area's track: the band of a possession, of a closed or a slowed track, and beside it a disc for every train held there now. */
  _track(view, area, a) {
    const t = this.table.areas[area];
    if (!t.section || (!a.possession && !a.mode && !a.queue)) return;
    const beat = view.pulse ?? 1, band = (section, share, colour, alpha, len = BAND_MM.length) => {
      const r = this.rail(section, share), w = r.way, from = Math.max(0, r.s - len / 2), to = Math.min(w.total, r.s + len / 2);
      const pts = [polylineAt(w.points, from, w.lengths).point, ...w.points.filter((_, i) => w.lengths[i] > from && w.lengths[i] < to), polylineAt(w.points, to, w.lengths).point];
      view.ribbon(pts, BAND_MM.width, { fill: rgba(colour, alpha), order: 6, emissive: true });
    };
    if (a.possession) band(t.section, t.share, TONE.possession, 0.6);
    if (a.mode) band(...(a.possession || a.mode === "slow" && !this.game.faults.some((f) => f.area === area && f.state !== "done") ? [t.section, t.share] : t.beside), a.mode === "closed" ? TONE.closed : TONE.slow, a.mode === "closed" ? 0.45 + 0.25 * beat : 0.45, a.mode === "closed" ? BAND_MM.length : BAND_MM.length / 2);
    // the trains held: discs beside the track, before the site
    const s = this.site(area), n = [-s.dir[1], s.dir[0]], m = (v) => view.m(v);
    for (let i = 0; i < Math.min(HELD.most, a.queue); i++) {
      const q = [s.at[0] - s.dir[0] * (BAND_MM.length / 2 + 60 + i * HELD.gap_mm) + n[0] * 46, s.at[1] - s.dir[1] * (BAND_MM.length / 2 + 60 + i * HELD.gap_mm) + n[1] * 46];
      view.polygon(circle(q, atLeast(view, q, m(HELD.r_m), 5) * (1 + 0.12 * beat), 16), { fill: rgba(TONE.warn, 0.55 + 0.3 * beat), stroke: CD.dunkelblau, width: 1.2, order: 7, emissive: true });
    }
  }

  /** The houses beside a site: a note at each door while a night is announced there, lit windows and a red ring when the work came unannounced. */
  _houses(view, area, a, night) {
    const m = (v) => view.m(v), beat = view.pulse ?? 1;
    for (const at of this.houses(area)) {
      if (!view.inImage(at[0], at[1], 0, 200)) continue;
      view.faces(prismFaces(rectFootprint(at, m(9), m(7)), 0, m(5.5), { side: grey(0.82), top: grey(0.5) }), [at[0], at[1], m(3)]);
      if (a.awake) {
        view.polygon(circle(at, atLeast(view, at, m(7), 9) * (1 + 0.25 * beat)), { stroke: rgba(TONE.bad, 0.9 - 0.4 * beat), width: 2, order: 7, emissive: true });
        view.glow([at[0], at[1], m(3.2)], m(3.4), TONE.lit, 0.7 + 0.3 * beat);
      } else if (a.told) view.polygon(circle([at[0], at[1] + m(5)], atLeast(view, at, m(1.3), 3), 10), { fill: TONE.note, order: 8, emissive: true });
      else if (night) view.glow([at[0], at[1], m(3.2)], m(1.6), TONE.lit, 0.25);
    }
  }

  /** A person's home: a small house, its window lit at night while the person is there. */
  _home(view, p, night) {
    const h = this.table.homes[p.id], [x, y] = h.at, z = h.z ?? 0, m = (v) => view.m(v);
    if (!view.inImage(x, y, z, 200)) return;
    view.faces(prismFaces(rectFootprint([x, y], m(10), m(8)), z, z + m(6), { side: grey(0.9), top: p.trade === "track" ? CD.tuerkis : CD.orange }), [x, y, z + m(3)]);
    if (night && p.at === "home" && p.to == null) view.glow([x, y, z + m(3.5)], m(2.2), TONE.lit, 0.6);
  }

  /** A work: a ring at its site while it is planned, a building site while it runs. */
  _work(view, w, d, asked) {
    if (w.state === "off" || (w.state === "planned" && w.start == null && !this._marked(`work-${w.id}`) && !asked.has(`work-${w.id}`))) return;
    const s = this.site(w.area), [x, y] = s.at, z = s.z, m = (v) => view.m(v), beat = view.pulse ?? 1, t = view.time ?? 0;
    if (!view.inImage(x, y, z, 300)) return;
    const marked = this._marked(`work-${w.id}`), about = asked.has(`work-${w.id}`), soon = w.start != null && w.start - d.hour < 36;
    const colour = marked || about ? TONE.choice : w.state === "done" ? TONE.ok : w.state === "running" ? TONE.possession : w.ready ? TONE.plan : soon ? TONE.warn : TONE.plan;
    const pulses = marked || about || (w.state === "planned" && !w.ready && soon);
    // (each work of an area its own ring: the rail change and a fault can lie at one place)
    const r = atLeast(view, [x, y, z], m(w.id === "points" ? 4.6 : 5.6), 13) * (pulses ? 1 + 0.25 * beat : 1);
    if (w.state !== "done" || marked) view.polygon(circle([x, y], r), { z, fill: rgba(colour, this.picked === `work-${w.id}` ? 0.5 : pulses ? 0.14 + 0.2 * beat : 0.06), stroke: rgba(colour, pulses ? 1 : 0.75), width: pulses ? 2.2 : 1.3, order: 7, emissive: true });
    if (w.state !== "running") return;
    // the building site: barriers at both ends of the band, the machine, the people, lamps in the dark
    const n = [-s.dir[1], s.dir[0]], ang = Math.atan2(s.dir[1], s.dir[0]);
    if (s.way) for (const k of [-1, 1]) {
      const q = polylineAt(s.way.points, Math.max(0, Math.min(s.way.total, s.s + (k * BAND_MM.length) / 2)), s.way.lengths).point;
      view.faces(prismFaces(rectFootprint(q, m(0.5), m(4.5), ang), 0, m(1.3), { side: CD.rot, top: CD.white }), [q[0], q[1], m(1)]);
    }
    if (w.machine && s.way) {
      const q = polylineAt(s.way.points, s.s + 150 * Math.sin(t * 0.2), s.way.lengths).point;
      view.faces(prismFaces(rectFootprint(q, m(14), m(2.9), ang), m(0.6), m(3.8), { side: "#f2c400", top: "#d9ad00" }), [q[0], q[1], m(2)]);
    }
    for (let i = 0; i < w.people; i++) {
      const a = t * 0.9 + i * 2.4, rr = m(3.5 + 2.5 * i);
      drawPerson(view, [x + n[0] * m(3.4) + s.dir[0] * rr * Math.cos(a), y + n[1] * m(3.4) + s.dir[1] * rr * Math.cos(a)], { dir: [-s.dir[0] * Math.sin(a), -s.dir[1] * Math.sin(a)], speed: 0.6, phase: t * 5 + i, height: 1.8, colour: STAFF_COLOURS.body, legs: STAFF_COLOURS.legs });
    }
    if (d.night) for (const k of [-1, 1]) view.glow([x + s.dir[0] * k * m(12) + n[0] * m(4), y + s.dir[1] * k * m(12) + n[1] * m(4), z + m(5)], m(5), "#ffffff", 0.75);
  }

  /** A fault: a ring on the ground at its asset in the colour of its state, a post with a lamp over it; one nobody is at pulses. */
  _fault(view, f, d, asked) {
    const s = this.spot(f), [x, y] = s.at, z = s.z, m = (v) => view.m(v), beat = view.pulse ?? 1;
    if (!view.inImage(x, y, z, 200)) return;
    const done = f.state === "done", marked = this._marked(`fault-${f.id}`), about = asked.has(`fault-${f.id}`);
    const colour = marked || about ? TONE.choice : done ? TONE.ok : f.danger || f.mode === "closed" ? TONE.bad : f.attended ? CD_LIGHT.tuerkis : TONE.warn;
    const pulses = marked || about || (!done && !f.attended);
    const r = atLeast(view, [x, y, z], m(3), 8);
    view.polygon(circle([x, y], r * (pulses ? 1 + 0.4 * beat : 0.9)), { z, fill: rgba(colour, pulses ? 0.22 + 0.34 * beat : 0.34), stroke: colour, width: f.danger ? 2.5 : 1.6, order: 8, emissive: true });
    if (done) return;
    const post = prismFaces(rectFootprint([x, y], m(0.3), m(0.3)), z, z + m(4.4), { side: grey(0.3), top: grey(0.3) }), lamp = prismFaces(rectFootprint([x, y], m(1.1), m(1.1)), z + m(4.4), z + m(5.5), { side: colour, top: colour });
    view.faces([...post, ...lamp], [x, y, z + m(3)], { emissive: true });
    view.glow([x, y, z + m(5)], m(2.4), colour, pulses ? 0.5 + 0.5 * beat : 0.7);
  }

  /** A person: the van where it is, a ring under it where it can be chosen or is asked about, the beacon on the way to a fault. */
  _person(view, p, i, d, asked) {
    const v = this.van(p, i), [x, y] = v.at, m = (q) => view.m(q), beat = view.pulse ?? 1;
    if (!view.inImage(x, y, v.z, 200)) return;
    const marked = this._marked(`person-${p.id}`), about = asked.has(`person-${p.id}`);
    if (marked || about || this.active) {
      const strong = marked || about, colour = strong ? TONE.choice : p.away ? TONE.bad : p.strain >= 60 ? TONE.warn : TONE.plan;
      view.polygon(circle([x, y], atLeast(view, [x, y, v.z], m(3.6), 8) * (strong ? 1.2 + 0.3 * beat : 1)), { z: v.z, fill: rgba(colour, this.picked === `person-${p.id}` ? 0.6 : strong ? 0.25 + 0.3 * beat : 0.12), stroke: rgba(colour, strong ? 1 : 0.6), width: strong ? 2 : 1.2, order: 7, emissive: true });
    }
    if (p.away === "sick") return;
    drawTeamVan(view, v.at, v.dir, { trade: p.trade, small: p.away === "brigade", beacon: p.beacon && v.driving ? 0.5 + 0.5 * beat : null });
  }

  /** Somebody who is told: a ring and a pin where they sit, in the colour of their patience; it pulses while a question is about them or they are chosen. */
  _pin(view, who, mood, asked) {
    const at = this.table.pins[who], [x, y] = at, m = (v) => view.m(v), beat = view.pulse ?? 1;
    if (!view.inImage(x, y, 0, 200)) return;
    const marked = this._marked(`aud-${who}`), about = asked.has(`aud-${who}`);
    const colour = marked || about ? TONE.choice : mood == null ? CD.white : mood < MARK.act ? TONE.bad : mood < MARK.call ? TONE.warn : TONE.ok, pulses = marked || about;
    const r = atLeast(view, at, m(2.6), 7);
    view.polygon(circle([x, y], r * (pulses ? 1 + 0.35 * beat : 1)), { fill: rgba(colour, this.picked === `aud-${who}` ? 0.6 : pulses ? 0.2 + 0.3 * beat : 0.18), stroke: colour, width: pulses ? 2.2 : 1.5, order: 8, emissive: true });
    const post = prismFaces(rectFootprint([x, y], m(0.25), m(0.25)), 0, m(5), { side: grey(0.25), top: grey(0.25) }), head = prismFaces(rectFootprint([x, y], m(1.5), m(1.5)), m(5), m(6.5), { side: colour, top: colour });
    view.faces([...post, ...head], [x, y, m(3.5)], { emissive: true });
    view.glow([x, y, m(5.8)], m(2), colour, pulses ? 0.5 + 0.5 * beat : 0.45);
  }

  /* ---------------------------------------------------------------- choosing */

  /**
   * What of the board is at a pixel: with something chosen, the thing one of its moves needs
   * (`{target}`); else a site, a fault, a van or a pin (`{item}`, the id of the item of the game's
   * picture); else null.
   * @param {import("../arail/index.js").View} view the view of the frame drawn last
   * @param {number[]} pixel [u, v] canvas px
   * @param {number} [scale] how many CSS px a thing may be away, as a factor (a finger: more)
   * @returns {{item: string} | {target: string} | null}
   */
  hit(view, [u, v], scale = 1) {
    const g = this.game;
    if (!g) return null;
    const px = view.px, mz = view.m(1), d = g.district();
    let best = null;
    const near = (id, at, r, zs = [0]) => {
      for (const z of zs) {
        const p = view.project(at[0], at[1], (at[2] ?? 0) + z * mz), dist = p ? Math.hypot(p[0] - u, p[1] - v) : Infinity;
        // (what a move of the chosen thing needs comes first where two things lie at one place)
        const wanted = this.offers.some((o) => o.target === id && !o.disabled);
        if (dist <= r * px * scale && (!best || (wanted && !best.wanted) || (wanted === best.wanted && dist < best.d))) best = { d: dist, id, wanted };
      }
    };
    for (const w of d.works) {
      if (w.state === "off" || w.state === "done") continue;
      const s = this.site(w.area);
      near(`work-${w.id}`, [s.at[0], s.at[1], s.z], HIT_PX.work);
    }
    for (const f of d.faults) {
      if (f.state === "done") continue;
      const s = this.spot(f);
      near(`fault-${f.id}`, [s.at[0], s.at[1], s.z], HIT_PX.fault, [0, 2.5, 5]);
    }
    d.people.forEach((p, i) => {
      const van = this.van(p, i);
      near(`person-${p.id}`, [van.at[0], van.at[1], van.z], HIT_PX.person, [0, 1.5]);
    });
    for (const [who, at] of Object.entries(this.table.pins)) near(`aud-${who}`, at, HIT_PX.pin, [0, 3, 6]);
    if (!best) return null;
    return best.wanted ? { target: best.id } : { item: best.id };
  }

  /** Where an item of the game's picture is on the table ("work-tamp", "fault-knock", "person-p1", "aud-town"), or null. */
  placeOf(item) {
    const [kind, id] = String(item ?? "").split(/-(.*)/s), g = this.game;
    if (kind === "aud") return this.table.pins[id] ?? null;
    if (kind === "work" && g?.work(id)) return this.site(g.work(id).area).at;
    if (kind === "fault" && g?.fault(id)) return this.spot(g.fault(id)).at;
    if (kind === "person" && g?.person(id)) {
      const d = g.district(), i = d.people.findIndex((p) => p.id === id);
      return this.van(d.people[i], i).at;
    }
    return null;
  }

  /** The part of the table a place lies in (`bounds`): "west", "platforms" or "east". */
  partOf([x]) {
    return x > 4300 ? "west" : x < 1500 ? "east" : "platforms";
  }

  /**
   * The part of the layout the game needs in the picture (layout mm, [x0, y0, x1, y1]): the whole
   * district on the table, or a part of it ("west": the base and the Bergheim end, "platforms": the
   * station and the town, "east": the Talsee end and the strip towards Waldau).
   * @param {"all" | "west" | "platforms" | "east"} [part]
   */
  bounds(part = "all") {
    const x = { all: [-2300, 7800], west: [4100, 7900], platforms: [1200, 5200], east: [-2350, 1700] }[part] ?? [-2300, 7800];
    return [x[0], -480, x[1], 930];
  }
}
