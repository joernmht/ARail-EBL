/**
 * Town simulation: a simple day and night routine.
 *
 * Residents live in the residential buildings of the layout. Following the fast clock
 * (`world.clock`), they go to work, to school and shopping and come home again; some work
 * elsewhere and take the train, others come in by train in the morning and leave in the
 * evening. They walk on the sidewalks of the road network (`world.network()`), take a bus
 * line when the way is long and a line connects both ends (`world.transit`), and take
 * trains at the platforms. At stops they are handed over to the passenger simulation
 * (`enter`, `alight` and the `passenger.*` events), so waiting, boarding and alighting look
 * the same for everybody.
 *
 * Inside a building people are not drawn; `world.occupancy` (building id -> people inside,
 * in real persons) lets buildings light their windows at night.
 *
 * How many people there are follows from the buildings, without counting a place twice: the homes
 * give the residents; jobs, school places and shop visits are slots the residents within reach fill
 * first (nearest first). Only the balance crosses the edge of the town: workers and pupils without
 * a place go elsewhere by train, and places the residents leave empty draw people from elsewhere.
 * From that the town tells the other parts what it needs (`serviceInterval`: how often trains,
 * buses and trams run; `othersAt`: the other passengers at a stop).
 *
 * Everything degrades gracefully: without roads people walk straight, without bus lines
 * they walk, without platforms nobody commutes by train, without a passenger simulation
 * stops are skipped.
 * @module arail/sims/town
 */
import { Simulation } from "../core/simulation.js";
import { CD, moodColor } from "../core/colors.js";
import { createRng, dist2, hashKey, polylineAt, rectAround } from "../core/math.js";
import { DAY_MINUTES, PROFILES, formatTime, wrapMinutes } from "../core/clock.js";
import { hiddenAt, straightWalk } from "../core/network.js";
import { Person, Population, residentialBuildings } from "../core/people.js";
import { drawPerson } from "./passengers.js";

/** Colours of people by the purpose of their trip (corporate design colours). */
export const PURPOSE_COLOURS = {
  work: CD.tuerkis,
  school: CD.orange,
  shopping: CD.gelb,
  home: CD.brillantblau,
  train: CD.rot,
};

export const PURPOSE_LABELS = { work: "to work", school: "to school", shopping: "shopping", home: "home", train: "to the train" };

/** The roles of the town's people, in words. */
export const ROLE_LABELS = { worker: "works in the town", commuter: "commuter, works elsewhere", pupil: "pupil", senior: "senior", visitor: "visitor, comes by train" };

/** What brings a visitor (role "visitor") or takes a commuter away, in words. */
const VISIT_LABELS = { work: "comes by train to work", school: "pupil, comes by train to school", shopping: "comes by train to shop" };

/** Opening hours (minutes) of the destinations. */
const OPEN = { shop: [7 * 60, 21 * 60], school: [7 * 60 + 30, 15 * 60 + 30] };

const WALK_SPEED = [1.05, 1.5]; // m/s prototype
const BUS_SPEED = 25 / 3.6; // average speed of a bus incl. stops, for planning (m/s)
const PATIENCE_MIN = 20; // clock minutes an agent waits for a bus or train
const ACCESS_M = 300; // longest walk to a bus stop (prototype metres)

/** Shares of the residents: pupils, seniors (and others at home by day), workers. */
const SHARES = { pupil: 0.15, senior: 0.25, worker: 0.6 };
/** Shop visits a day per visitor place: a visit takes half an hour, a shop is about a fifth full while open. */
const SHOP_VISITS = ((OPEN.shop[1] - OPEN.shop[0]) / 30) * 0.2;
/** Trips a resident makes by train or by bus or tram a day besides work and school (errands, leisure, visits). */
const OTHER_TRIPS = { rail: 0.3, bus: 0.2 };
/** Share of the morning trips in the busiest hour (they spread over about two hours). */
const PEAK_HOUR = 0.5;
/** Share of a day's other trips in the busiest hour. */
const OTHERS_PEAK = 0.1;
/** How much more often vehicles run in the rush hour than by day (the clock's profiles, core/clock.js). */
const RUSH = 1.5;
/** Places at a comfortable load (70 %): a regional train, a 12 m bus, a tram per metre of its length. */
const PLACES = { rail: 200 * 0.7, bus: 70 * 0.7, tramPerM: 6 * 0.7 };
/** Regular intervals (clock minutes) a timetable chooses from: at least once an hour. */
export const INTERVALS_MIN = [5, 10, 15, 20, 30, 60];

/**
 * The regular interval (clock minutes) that carries `riders` people in the busiest hour, from
 * `departures` places (a dock, a line's starts) with `places` each: the longest of
 * {@link INTERVALS_MIN} that is still enough at the rush-hour frequency, at most 60.
 * @param {number} riders people in the busiest hour
 * @param {number} places people one vehicle carries
 * @param {number} [departures=1] places vehicles leave from
 */
export function regularInterval(riders, places, departures = 1) {
  const perHour = riders / Math.max(1, departures) / RUSH; // vehicles per hour by day carry this
  const longest = perHour > 0 ? (60 * places) / perHour : Infinity;
  let best = INTERVALS_MIN[0];
  for (const m of INTERVALS_MIN) if (m <= longest) best = m;
  return best;
}

/**
 * Split `n` among `weights`: the whole parts as they are, the rest drawn by the remainders
 * (exact for large numbers, fair in expectation for small ones).
 * @returns {number[]}
 */
function apportion(rng, n, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  if (!(total > 0) || !(n > 0)) return weights.map(() => 0);
  const exact = weights.map((w) => (n * w) / total);
  const out = exact.map(Math.floor);
  const rest = exact.map((x, i) => x - out[i]);
  for (let left = n - out.reduce((s, v) => s + v, 0); left > 0; left--) {
    if (!(rest.reduce((s, v) => s + v, 0) > 1e-9)) break;
    const i = rng.weighted(rest);
    out[i]++;
    rest[i] = 0;
  }
  return out;
}

/** Hours of a day at the normal daytime level that a demand profile adds up to (24 without profiles). */
function profileHours(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += ((points[i][1] + points[i - 1][1]) / 2) * (points[i][0] - points[i - 1][0]);
  return sum;
}

/** Uniform time between two clock times (minutes). */
const between = (rng, a, b) => rng.uniform(a, b);
const hm = (h, m = 0) => h * 60 + m;

/**
 * A person of the town. `role`: "worker" | "commuter" (works elsewhere, train) | "pupil" | "senior" |
 * "visitor" (comes by train); `home`: a house on the layout ({kind: "layout", building, entrance}),
 * for visitors a station beyond it.
 */
class Agent extends Person {
  constructor(spec) {
    super(spec);
    this.job = null;
    this.school = null;
    /** Visitors: the shop they come to. */
    this.shop = null;
    /** Visitors: what brings them ("work", "school", "shopping"); commuters: what takes them away ("work", "school"). */
    this.visit = null;
    /** Today's plan: [{at: minutes, purpose, to: {kind: "building", id} | {kind: "home"} | {kind: "station"} | {kind: "shop"}}]. */
    this.plan = [];
    this.planDay = -1;
    this.next = 0;
    /** "inside" | "walking" | "stop" (with the passenger simulation) | "riding" | "away" */
    this.state = "inside";
    /** Building id while inside, else null. */
    this.inside = null;
    this.purpose = "home";
    /** Current trip: {legs, leg, purpose, dest} */
    this.trip = null;
    this.pos = null;
    this.path = null;
    this.s = 0;
    this.speed = 1.3;
    this.phase = 0;
    this.person = null;
    this.waitSince = 0;
    this.vehicle = null;
    /** Visitors and commuters: earliest clock time to come (back) by train. */
    this.trainFrom = null;
  }

  /** The home building ({building, entrance}), null for people who live beyond the layout. */
  get house() {
    return this.home?.kind === "layout" ? this.home : null;
  }

  /** Colour of the person (by trip purpose). */
  get colour() {
    return PURPOSE_COLOURS[this.purpose] || PURPOSE_COLOURS.home;
  }
}

export class TownSimulation extends Simulation {
  static type = "town";
  static label = "Town (day and night)";
  static description = "Residents go to work, school and shopping and come home, on foot, by bus and by train, following the clock.";
  static params = [
    { key: "people_per_100", label: "People shown", type: "number", unit: "per 100 residents", min: 1, max: 100, step: 1, default: 12 },
    { key: "max_people", label: "Max. people", type: "number", min: 0, max: 2000, step: 10, default: 300 },
    { key: "walk_max_m", label: "Longest walk", type: "number", unit: "m", min: 20, max: 3000, step: 10, default: 150, help: "Longer ways are taken by bus when a line connects both ends." },
    { key: "bus_share", label: "Take the bus", type: "number", unit: "share of long ways", min: 0, max: 1, step: 0.05, default: 0.8 },
    {
      key: "catchment_m", label: "Local area", type: "number", unit: "m", min: 50, max: 20000, step: 50, default: 1500,
      help: "Jobs, school places and shops this close to a home (or on a bus or tram line from near it) are taken by its residents first.",
    },
    {
      key: "commuters_out", label: "Work elsewhere anyway", type: "number", unit: "share of workers", min: 0, max: 1, step: 0.05, default: 0.15,
      help: "Some work elsewhere (by train) although there are jobs in the town; workers who find no job in the town work elsewhere too.",
    },
    {
      key: "commuters_in", label: "Come from elsewhere", type: "number", unit: "share of empty places", min: 0, max: 1, step: 0.05, default: 0.6,
      help: "Of the jobs, school places and shop visits the residents leave empty, the share people from elsewhere take (by train).",
    },
    { key: "shopping", label: "Shopping", type: "number", unit: "share of adults per day", min: 0, max: 1, step: 0.05, default: 0.5 },
  ];

  constructor(world, config) {
    super(world, config);
    // before #176 commuters_in counted people per 100 local jobs (0-200): read such values as a share
    if (+this.config.commuters_in > 1) this.config.commuters_in = Math.min(1, +this.config.commuters_in / 100);
    /** @type {Agent[]} */
    this.agents = [];
    this._built = null;
    this._lastMinutes = null;
    this._lastDay = null;
    this._check = 0;
    world.occupancy = new Map();
    const on = (name, fn) => world.events.on(name, fn);
    this._unsubscribe = [
      on("passenger.boarded", (e) => this._boarded(e)),
      on("passenger.exited", (e) => this._exited(e)),
      on("passenger.removed", (e) => this._removed(e)),
      on("vehicle.arrived", (e) => this._vehicleArrived(e)),
      on("clock.set", () => this.enabled && this._placeAll()),
      on("layout.loaded", () => {
        this._built = null;
        this.agents = []; // another layout: nobody stays
      }),
    ];
  }

  dispose() {
    this._unsubscribe.forEach((off) => off());
    if (this.world.occupancy && this._ownsOccupancy()) this.world.occupancy = new Map();
  }

  _ownsOccupancy() {
    return this.world.simulations?.filter((s) => s.constructor.type === "town").length <= 1;
  }

  /** Real people one agent stands for (in `world.occupancy`). */
  _personWeight() {
    return this._weight || 1 / this.scale;
  }

  /** Visible people per real person. */
  get scale() {
    return Math.max(0.001, (+this.config.people_per_100 || 12) / 100);
  }

  get passengers() {
    return this.world.simulations.find((s) => s.enabled && typeof s.enter === "function" && typeof s.alight === "function") || null;
  }

  clear() {
    this._removeAgents();
    this._built = null;
    this.agents = [];
  }

  /**
   * Take this town's people off the stops and buses (the agents of other simulations stay).
   * @param {Set<Agent>} [only] just these
   */
  _removeAgents(only = null) {
    const ours = (agent) => agent instanceof Agent && (!only || only.has(agent));
    this.passengers?.removeAgents(ours);
    for (const v of this.world.transit?.buses || []) if (Array.isArray(v.riders)) v.riders = v.riders.filter((r) => !ours(r.agent));
  }

  /* ================================================================ population */

  /** Where a building is (layout mm): its first entrance, else its anchor point; null when unknown. */
  _placeOf(o) {
    return this._buildingPos(o.id) || o.anchorPoint?.() || null;
  }

  /** Buildings with a capacity, by use; those without a known position take no part (nobody gets there). */
  _buildings() {
    const located = residentialBuildings(this.world).filter(({ o }) => this._placeOf(o));
    const out = { residential: located.map(({ o }) => ({ o, cap: o.capacity() || {} })), work: [], school: [], shop: [] };
    for (const o of this.world.objects) {
      if (!o.geometry || typeof o.capacity !== "function" || !this._placeOf(o)) continue;
      const cap = o.capacity() || {};
      const use = typeof o.use === "function" ? o.use() : o.constructor.use;
      if (cap.jobs > 0) out.work.push({ o, cap });
      if (use === "school" && cap.pupils > 0) out.school.push({ o, cap });
      if (use === "shop") out.shop.push({ o, cap });
    }
    return out;
  }

  /**
   * Key that changes when what `_demand` depends on changes: the buildings, the settings, whether
   * there are platforms, the stops of the lines (then the town is worked out again; the people who
   * are still there keep where they are, see `_build`). Moved buildings keep the town as it is.
   */
  _populationKey(b) {
    const ids = (list) => list.map((x) => `${x.o.id}:${x.cap.residents || 0}:${x.cap.jobs || 0}:${x.cap.pupils || 0}:${x.cap.visitors || 0}`).join(",");
    const rail = this.world.stopAreas().some((a) => a.kind === "rail");
    const lines = [...(this.world.transit?.lines?.values?.() || [])].filter((l) => l.ok).map((l) => `${l.id}:${l.visits.map((v) => v.area?.id).join(",")}`);
    return [ids(b.residential), ids(b.work), ids(b.school), ids(b.shop), rail, lines.join(";"), JSON.stringify(this.config)].join("/");
  }

  _build() {
    const w = this.world;
    const quick = `${w.objectsVersion ?? ""}:${w.map.version}:${w.scale}:${JSON.stringify(this.config)}`;
    if (this._built && w.objectsVersion != null && quick === this._quick) return false;
    if (this._built && w.objectsVersion == null && (this._sinceBuild = (this._sinceBuild || 0) + 1) < 20) return false;
    this._sinceBuild = 0;
    this._quick = quick;
    const b = this._buildings();
    const key = this._populationKey(b);
    if (this._built === key) return false;
    this._built = key;
    this.places = b;
    this._lineDemand = null;
    // random streams of their own for each home and each place: a change at one leaves the others as they are
    const rngOf = (...parts) => createRng(hashKey(this.world.seed, "town", ...parts));
    const people = new Population(this.world.seed, "town");
    const d = (this.demand = this._demand(b));
    const scale = this.scale, max = Math.max(0, Math.round(+this.config.max_people || 0));
    // residents in proportion to the residents of each building, visitors to the places they take;
    // the cap scales all alike
    const wantedHomes = d.homes.map((h) => Math.max(1, Math.round(h.R * scale)));
    const wantedVisitors = d.visitors.map((v) => v.n * scale);
    const total = [...wantedHomes, ...wantedVisitors].reduce((s, v) => s + v, 0);
    const k = total > max ? max / total : 1;
    /** Visible people per real person. */
    this._shown = scale * k;
    const agents = [];
    // a person's id says who it is (home, role, where to, number): the same id is the same person
    d.homes.forEach((h, i) => {
      const rng = rngOf("home", h.o.id);
      const n = Math.floor(wantedHomes[i] * k + rng.next());
      const entrances = this._entrances(h.o);
      const counts = apportion(rng, n, h.kinds.map((x) => x.n));
      h.kinds.forEach((kind, q) => {
        const what = [kind.role, kind.job ?? kind.school ?? kind.visit].filter(Boolean).join(":");
        for (let c = 0; c < counts[q]; c++) {
          const id = `${h.o.id}#${what}#${c}`;
          const home = { kind: "layout", building: h.o.id, entrance: rngOf(id, "entrance").int(Math.max(1, entrances.length)) };
          const a = people.add(id, { id, role: kind.role, home }, Agent);
          a.job = kind.job ?? null;
          a.school = kind.school ?? null;
          a.visit = kind.visit ?? null;
          agents.push(a);
        }
      });
    });
    // people from elsewhere (by train) for the places the residents leave empty
    d.visitors.forEach((group, i) => {
      const n = Math.floor(wantedVisitors[i] * k + rngOf("visitors", group.visit, group.id).next());
      for (let c = 0; c < n; c++) {
        const id = `visitor#${group.visit}:${group.id}#${c}`;
        const a = people.add(id, { id, role: "visitor", home: { kind: "station" } }, Agent);
        a.visit = group.visit;
        if (group.visit === "work") a.job = group.id;
        else if (group.visit === "school") a.school = group.id;
        else a.shop = group.id;
        agents.push(a);
      }
    });
    for (const a of agents) a.speed = createRng(hashKey(a.id, "speed")).uniform(...WALK_SPEED);
    // the town worked out again: who is still there stays where they are, on their way, at a stop or on a bus
    const before = new Map((this.agents || []).map((a) => [a.id, a]));
    const kept = new Set();
    this.agents = agents.map((a) => {
      const old = before.get(a.id);
      if (!old) return a;
      kept.add(old);
      return old;
    });
    // real people per agent (the cap makes it more than 100 / people_per_100)
    const shown = this.agents.filter((a) => a.role !== "visitor").length;
    this._weight = shown > 0 ? d.totals.residents / shown : 1 / scale;
    if (!kept.size) {
      this._placeAll();
      return true;
    }
    this._removeAgents(new Set([...before.values()].filter((a) => !kept.has(a))));
    this._countOccupancy();
    const now = this.world.clock.minutes;
    for (const a of this.agents) if (!kept.has(a)) this._place(a, now);
    return true;
  }

  /**
   * Who goes where, in real people: the residents of each home (workers, pupils, seniors), the jobs,
   * school places and shop visits they take within reach (nearest first), and the balance: workers
   * and pupils who go elsewhere by train, and people from elsewhere for the places left empty.
   * @returns {{homes: object[], visitors: {visit: string, id: string, n: number}[], places: Map<string, object[]>, flows: object[], totals: object}}
   */
  _demand(b) {
    const cfg = this.config;
    const rail = this.world.stopAreas().some((a) => a.kind === "rail");
    const share = (v, fallback) => Math.min(1, Math.max(0, Number.isFinite(+v) ? +v : fallback));
    const anyway = rail ? share(cfg.commuters_out, 0.15) : 0;
    const fromElsewhere = rail ? share(cfg.commuters_in, 0.6) : 0;
    const shopping = share(cfg.shopping, 0.5);
    this._reach = new Map();
    const pos = (o) => this._placeOf(o);
    const homes = b.residential.map(({ o, cap }) => {
      const R = Math.max(0, +cap.residents || 0);
      return { o, pos: pos(o), R, workers: R * SHARES.worker, pupils: R * SHARES.pupil, seniors: R * SHARES.senior, jobs: new Map(), schools: new Map(), out: 0, pupilsOut: 0, kinds: [] };
    });
    const slots = (list, n) => list.map(({ o, cap }) => ({ o, pos: pos(o), slots: n(cap), free: n(cap) }));
    const work = slots(b.work, (c) => Math.max(0, +c.jobs || 0));
    const school = slots(b.school, (c) => Math.max(0, +c.pupils || 0));
    const shop = slots(b.shop, (c) => Math.max(0, +c.visitors || 0) * SHOP_VISITS);
    // jobs: the workers who work elsewhere anyway leave theirs to others
    const jobs = this._fill(homes.map((h) => ({ h, n: h.workers * (1 - anyway) })), work);
    for (const f of jobs.flows) f.h.jobs.set(f.p.o.id, (f.h.jobs.get(f.p.o.id) || 0) + f.n);
    homes.forEach((h, i) => {
      if (rail) h.out = h.workers * anyway + jobs.left[i];
      else h.seniors += jobs.left[i]; // nowhere to go: at home by day
    });
    // school places; pupils without one go to school elsewhere by train
    const pupils = this._fill(homes.map((h) => ({ h, n: h.pupils })), school);
    for (const f of pupils.flows) f.h.schools.set(f.p.o.id, (f.h.schools.get(f.p.o.id) || 0) + f.n);
    homes.forEach((h, i) => {
      if (rail) h.pupilsOut = pupils.left[i];
      else h.seniors += pupils.left[i];
    });
    // shop visits a day: the adults of the town first (they go to the nearest shop)
    this._fill(homes.map((h) => ({ h, n: (h.workers + h.seniors) * shopping * 1.1 })), shop);
    for (const h of homes) {
      h.kinds = [
        ...[...h.jobs].map(([job, n]) => ({ role: "worker", job, n })),
        { role: "commuter", visit: "work", n: h.out },
        ...[...h.schools].map(([id, n]) => ({ role: "pupil", school: id, n })),
        { role: "commuter", visit: "school", n: h.pupilsOut },
        { role: "senior", n: h.seniors },
      ].filter((x) => x.n > 1e-9);
    }
    // the places left empty: people from elsewhere take a share of them
    const visitors = [];
    const places = new Map();
    const note = (list, kind, visit) => {
      for (const p of list) {
        const n = p.free * fromElsewhere;
        if (n > 1e-9) visitors.push({ visit, id: p.o.id, n, pos: p.pos });
        if (!places.has(p.o.id)) places.set(p.o.id, []);
        places.get(p.o.id).push({ kind, slots: p.slots, local: p.slots - p.free, outside: n });
      }
    };
    note(work, "jobs", "work");
    note(school, "school places", "school");
    note(shop, "shop visits a day", "shopping");
    // the ways of the morning (for buses and trams): to work, to school, to the train, from the train
    const station = (p) => this._nearestRailPoint(p);
    const flows = [];
    for (const h of homes) {
      for (const [id, n] of h.jobs) flows.push({ from: h.pos, to: work.find((p) => p.o.id === id)?.pos, n });
      for (const [id, n] of h.schools) flows.push({ from: h.pos, to: school.find((p) => p.o.id === id)?.pos, n });
      if (h.out + h.pupilsOut > 0) flows.push({ from: h.pos, to: station(h.pos), n: h.out + h.pupilsOut });
    }
    for (const g of visitors) if (g.visit !== "shopping") flows.push({ from: station(g.pos), to: g.pos, n: g.n });
    const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
    const totals = {
      residents: sum(homes, (h) => h.R),
      workers: sum(homes, (h) => h.workers),
      jobs: sum(work, (p) => p.slots),
      jobsLocal: sum(work, (p) => p.slots - p.free),
      out: sum(homes, (h) => h.out),
      pupils: sum(homes, (h) => h.pupils),
      schoolPlaces: sum(school, (p) => p.slots),
      pupilsLocal: sum(school, (p) => p.slots - p.free),
      pupilsOut: sum(homes, (h) => h.pupilsOut),
      inWork: sum(visitors, (g) => (g.visit === "work" ? g.n : 0)),
      inSchool: sum(visitors, (g) => (g.visit === "school" ? g.n : 0)),
      inShopping: sum(visitors, (g) => (g.visit === "shopping" ? g.n : 0)),
    };
    return { homes, visitors, places, flows: flows.filter((f) => f.from && f.to && f.n > 0), totals };
  }

  /**
   * Fill the slots of `places` ({pos, free}) with the people of `demands` ({h, n}), the nearest
   * pairs first, only within reach (see `_reachable`).
   * @returns {{flows: {h: object, p: object, n: number}[], left: number[]}} what went where, the people of each demand left over
   */
  _fill(demands, places) {
    const left = demands.map((d) => d.n);
    const pairs = [];
    demands.forEach((d, i) => {
      places.forEach((p, j) => {
        if (left[i] > 0 && p.free > 0 && this._reachable(d.h, p)) pairs.push({ i, j, d: dist2(d.h.pos, p.pos) });
      });
    });
    pairs.sort((a, b) => a.d - b.d || a.i - b.i || a.j - b.j);
    const flows = [];
    for (const { i, j } of pairs) {
      const p = places[j];
      const n = Math.min(left[i], p.free);
      if (!(n > 0)) continue;
      left[i] -= n;
      p.free -= n;
      flows.push({ h: demands[i].h, p, n });
    }
    return { flows, left };
  }

  /** Can the residents of a home reach a place: within the local area (`catchment_m`), or by a bus or tram line from near it? */
  _reachable(h, p) {
    const key = `${h.o.id}>${p.o.id}`;
    if (this._reach.has(key)) return this._reach.get(key);
    const ok = this._metres(dist2(h.pos, p.pos)) <= (+this.config.catchment_m || 1500) || this._linked(h.pos, p.pos);
    this._reach.set(key, ok);
    return ok;
  }

  /** Is there a bus or tram line between stops within a walk (300 m) of both points? */
  _linked(a, b) {
    const transit = this.world.transit;
    if (typeof transit?.connections !== "function") return false;
    const near = (p) => this._busStops().filter((area) => this._metres(dist2(this._accessPoint(area, this._nearestAccess(area, p)), p)) <= ACCESS_M);
    const from = near(a), to = near(b);
    return from.some((x) => to.some((y) => x.id !== y.id && (transit.connections(x.id, y.id) || []).length > 0));
  }

  /** The access point of the platform nearest a point (layout mm), or null without platforms. */
  _nearestRailPoint(p) {
    let best = null, bd = Infinity;
    for (const area of this._railAreas()) {
      const q = this._accessPoint(area, this._nearestAccess(area, p));
      const d = dist2(p, q);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best;
  }

  /* ================================================================ what the town needs */

  /**
   * How often trains, buses or trams should run for the town (when the layout leaves it open):
   * from the people in the busiest hour and the places of a vehicle, a regular interval of
   * {@link INTERVALS_MIN}. Null while the town has no people yet.
   * @param {{kind: string, dock?: object, line?: object}} target a timetable dock (kind "rail" or "bus") or a line (kind "bus" or "tram")
   * @returns {{minutes: number, headway_s: number, riders: number}|null} riders: real people in the busiest hour
   */
  serviceInterval({ kind, dock = null, line = null }) {
    const d = this.demand;
    if (!this.enabled || !d || !(d.totals.residents > 0)) return null;
    const t = d.totals;
    let riders, places, departures;
    if (line) {
      riders = this._lineRiders(line);
      places = line.vehicle === "tram" ? PLACES.tramPerM * (line.length || 30) : PLACES.bus;
      departures = Math.max(1, line.starts?.length || 1);
    } else {
      const docks = this.world.stopAreas().flatMap((a) => a.docks).filter((x) => !x.managed && (x.kind === "rail") === (kind === "rail"));
      departures = Math.max(1, docks.length);
      if (kind === "rail") {
        riders = PEAK_HOUR * (t.out + t.pupilsOut + t.inWork + t.inSchool) + OTHERS_PEAK * OTHER_TRIPS.rail * t.residents;
        places = PLACES.rail;
      } else {
        // regional buses at the bays of a terminal: the town's other trips by bus
        riders = OTHERS_PEAK * OTHER_TRIPS.bus * t.residents;
        places = PLACES.bus;
      }
    }
    const minutes = regularInterval(riders, places, departures);
    const factor = this.world.clock.factor > 0 ? this.world.clock.factor : 12;
    return { minutes, headway_s: (minutes * 60) / factor, riders };
  }

  /**
   * People in the busiest hour on a bus or tram line: the long ways of the morning (longer than
   * `walk_max_m`) between two stops of the line, by `bus_share`; a way that several lines serve is
   * shared among them.
   */
  _lineRiders(line) {
    const transit = this.world.transit;
    const lines = [...(transit?.lines?.values?.() || [])].filter((l) => l.ok && l.visits?.length);
    const key = lines.map((l) => l.signature).join("|");
    if (!this._lineDemand || this._lineDemand.key !== key) {
      const riders = new Map(lines.map((l) => [l.id, 0]));
      const walkMax = +this.config.walk_max_m || 150;
      const share = Math.min(1, Math.max(0, +this.config.bus_share || 0));
      const near = (l, p) => l.visits.some((v) => v.area && this._metres(dist2(this._accessPoint(v.area, this._nearestAccess(v.area, p)), p)) <= ACCESS_M);
      for (const f of this.demand?.flows || []) {
        if (this._metres(dist2(f.from, f.to)) * 1.3 <= walkMax) continue;
        const serving = lines.filter((l) => near(l, f.from) && near(l, f.to));
        for (const l of serving) riders.set(l.id, riders.get(l.id) + (f.n * share * PEAK_HOUR) / serving.length);
      }
      this._lineDemand = { key, riders };
    }
    return this._lineDemand.riders.get(line.id) || 0;
  }

  /**
   * Other passengers at a stop area: people the town's agents do not stand for (errands, leisure,
   * visits, changing between train and bus), from the residents it serves (all at a station, those
   * within 300 m at a bus or tram stop), as visible people per simulated second at the normal
   * daytime level. Null while the town has no people.
   * @param {object} area a stop area
   */
  othersAt(area) {
    const d = this.demand;
    if (!this.enabled || !d || !(d.totals.residents > 0) || !area) return null;
    // real people a day at each stop area, worked out once for the stops there are (world.stopAreas()
    // gives a new list when they change: also when they move or a line starts to serve them)
    const areas = this.world.stopAreas();
    if (!this._othersPerDay || this._othersPerDay.demand !== d || this._othersPerDay.areas !== areas) {
      const perDay = new Map();
      const rail = areas.filter((a) => a.kind === "rail" && a.docks.length);
      for (const a of rail) perDay.set(a.id, (OTHER_TRIPS.rail * d.totals.residents) / rail.length);
      const stops = this._busStops();
      for (const h of d.homes) {
        const near = stops.filter((a) => this._metres(dist2(this._accessPoint(a, this._nearestAccess(a, h.pos)), h.pos)) <= ACCESS_M);
        for (const a of near) perDay.set(a.id, (perDay.get(a.id) || 0) + (OTHER_TRIPS.bus * h.R) / near.length);
      }
      this._othersPerDay = { demand: d, areas, perDay };
    }
    const perDay = this._othersPerDay.perDay.get(area.id) || 0;
    const clock = this.world.clock;
    const hours = clock.profiles ? profileHours(PROFILES.passengers) : 24;
    const factor = clock.factor > 0 ? clock.factor : 12;
    return (perDay * (this._shown || this.scale) * factor) / (hours * 3600);
  }

  /** A building's card: how many of its places the town takes, how many people from elsewhere. */
  describeObject(o, card) {
    const list = this.enabled ? this.demand?.places?.get(o.id) : null;
    for (const p of list || []) {
      if (!(p.slots > 0)) continue;
      const kind = p.kind === "jobs" ? "Jobs" : p.kind === "school places" ? "School places" : "Shop visits a day";
      card.rows.push([kind, `${Math.round(p.local)} from the town · ${Math.round(p.outside)} from elsewhere · ${Math.round(p.slots - p.local - p.outside)} empty`]);
    }
  }

  /* ================================================================ plans */

  _makePlan(a, day) {
    const rng = createRng(hashKey(this.world.seed, a.id, day));
    const plan = [];
    const shop = rng.chance(+this.config.shopping || 0);
    const home = { kind: "home" };
    if (a.role === "worker") {
      plan.push({ at: between(rng, hm(6, 30), hm(8)), purpose: "work", to: { kind: "building", id: a.job } });
      const off = between(rng, hm(15, 30), hm(17, 30));
      if (shop && rng.chance(0.4)) {
        plan.push({ at: off, purpose: "shopping", to: { kind: "shop" } });
        plan.push({ at: off + between(rng, 15, 40), purpose: "home", to: home, after: true });
      } else plan.push({ at: off, purpose: "home", to: home });
    } else if (a.role === "commuter" && a.visit === "school") {
      // to a school elsewhere by train, back after school
      plan.push({ at: between(rng, hm(6, 30), hm(7, 15)), purpose: "train", to: { kind: "station" } });
      a.trainFrom = between(rng, hm(13), hm(15, 30));
      plan.push({ at: a.trainFrom, purpose: "home", to: home, byTrain: true });
    } else if (a.role === "commuter") {
      plan.push({ at: between(rng, hm(5, 45), hm(7, 45)), purpose: "train", to: { kind: "station" } });
      // back on a train that arrives in the evening, then home (perhaps via the shop)
      a.trainFrom = between(rng, hm(16), hm(18, 30));
      plan.push({ at: a.trainFrom, purpose: "home", to: home, byTrain: true, shop: shop && rng.chance(0.2) });
    } else if (a.role === "pupil") {
      plan.push({ at: between(rng, hm(7), hm(7, 40)), purpose: "school", to: { kind: "building", id: a.school } });
      plan.push({ at: between(rng, hm(12, 30), hm(15)), purpose: "home", to: home });
    } else if (a.role === "senior") {
      if (shop) {
        const t = between(rng, hm(8, 30), hm(11, 30));
        plan.push({ at: t, purpose: "shopping", to: { kind: "shop" } });
        plan.push({ at: t + between(rng, 20, 60), purpose: "home", to: home, after: true });
      }
      if (rng.chance(0.25)) {
        const t = between(rng, hm(15), hm(17, 30));
        plan.push({ at: t, purpose: "shopping", to: { kind: "shop" } });
        plan.push({ at: t + between(rng, 20, 45), purpose: "home", to: home, after: true });
      }
    } else if (a.role === "visitor" && a.visit === "school") {
      a.trainFrom = between(rng, hm(6, 45), hm(7, 30));
      plan.push({ at: a.trainFrom, purpose: "school", to: { kind: "building", id: a.school }, byTrain: true });
      plan.push({ at: between(rng, hm(12, 30), hm(15)), purpose: "train", to: { kind: "station" } });
    } else if (a.role === "visitor" && a.visit === "shopping") {
      // a day's shoppers spread over the opening hours
      a.trainFrom = between(rng, hm(8), hm(18));
      plan.push({ at: a.trainFrom, purpose: "shopping", to: { kind: "building", id: a.shop }, byTrain: true });
      plan.push({ at: a.trainFrom + between(rng, 30, 75), purpose: "train", to: { kind: "station" } });
    } else if (a.role === "visitor") {
      a.trainFrom = between(rng, hm(6, 30), hm(9));
      plan.push({ at: a.trainFrom, purpose: "work", to: { kind: "building", id: a.job }, byTrain: true });
      plan.push({ at: between(rng, hm(15, 30), hm(18)), purpose: "train", to: { kind: "station" } });
    }
    // evening shopping for some adults
    if (a.role !== "pupil" && a.role !== "visitor" && a.visit !== "school" && rng.chance(0.1 * (+this.config.shopping || 0) / 0.5)) {
      const t = between(rng, hm(18, 30), hm(20, 30));
      plan.push({ at: t, purpose: "shopping", to: { kind: "shop" } });
      plan.push({ at: t + between(rng, 15, 35), purpose: "home", to: home, after: true });
    }
    plan.sort((p, q) => p.at - q.at);
    return plan;
  }

  _ensurePlan(a) {
    const day = this.world.clock.day;
    if (a.planDay === day) return;
    // a new day: commuters still away came home late at night
    if (a.planDay >= 0 && a.role === "commuter" && a.state === "away" && !a.trip) this._setInside(a, a.house?.building);
    a.plan = this._makePlan(a, day);
    a.planDay = day;
    a.next = 0;
  }

  /** Everybody where they are (by their plans) at the current time of day, without travelling. */
  _placeAll() {
    const clock = this.world.clock;
    const now = clock.minutes;
    this._removeAgents();
    for (const a of this.agents) a.inside = null; // counted afresh in the new occupancy (leaving the old building must not subtract)
    this._countOccupancy();
    for (const a of this.agents) this._place(a, now);
    this._lastMinutes = now;
    this._lastDay = clock.day;
  }

  /**
   * `world.occupancy` anew: every building of the town listed (0 = nobody in: dark windows at
   * night), the agents inside counted with the current weight.
   */
  _countOccupancy() {
    const occ = (this.world.occupancy = new Map());
    for (const list of Object.values(this.places || {})) for (const { o } of list) occ.set(o.id, 0);
    for (const a of this.agents) if (a.state === "inside" && a.inside) occ.set(a.inside, (occ.get(a.inside) || 0) + this._personWeight());
  }

  /** Put an agent where its plan says it is at `now` (clock minutes), without travelling. */
  _place(a, now) {
    a.planDay = -1;
    this._ensurePlan(a);
    a.trip = null;
    a.person = null;
    a.vehicle = null;
    a.path = null;
    let at = a.role === "visitor" ? { kind: "away" } : { kind: "home" };
    let i = 0;
    for (; i < a.plan.length && a.plan[i].at <= now; i++) {
      const step = a.plan[i];
      at = step.to.kind === "station" ? { kind: "away" } : step.to;
      a.purpose = step.purpose;
    }
    a.next = i;
    if (at.kind === "away") this._setAway(a);
    else this._setInside(a, this._resolveBuilding(a, at));
  }

  /* ================================================================ places and ways */

  _entrances(o) {
    const list = typeof o.entrances === "function" ? o.entrances() : null;
    if (list && list.length) return list;
    const p = o.anchorPoint?.();
    return p ? [{ pos: p, dir: [0, -1] }] : [];
  }

  /** Building id for a plan target ({kind: "home" | "building" | "shop"}). */
  _resolveBuilding(a, to, from = null) {
    if (to.kind === "home") return a.house?.building ?? null;
    if (to.kind === "building") return to.id;
    if (to.kind === "shop") return this._nearestShop(from || this._buildingPos(a.house?.building) || [0, 0])?.id ?? a.house?.building ?? null;
    return null;
  }

  _buildingPos(id, entrance = 0) {
    const o = id ? this.world.getObject(id) : null;
    if (!o?.geometry) return null;
    const e = this._entrances(o);
    return e.length ? e[Math.min(entrance, e.length - 1)].pos : null;
  }

  _nearestShop(p) {
    let best = null;
    for (const { o } of this.places?.shop || []) {
      const q = this._buildingPos(o.id);
      if (!q) continue;
      const d = dist2(p, q);
      if (!best || d < best.d) best = { d, o };
    }
    return best?.o || null;
  }

  _network() {
    try {
      return this.world.network?.() || null;
    } catch {
      return null;
    }
  }

  /**
   * A walking path between two layout points (mm): over the network on the sidewalks when it
   * connects them, else straight (out of sight where it would cross a track), see
   * `RoadNetwork.walk`.
   * @returns {{points: number[][], lengths: number[], length: number, hidden: number[][], route: object | null}}
   */
  _walkPath(from, to, fromKey = null, toKey = null) {
    const net = this._network();
    if (net && typeof net.walk === "function") return net.walk(from, to, { fromKey, toKey });
    return straightWalk(from, to);
  }

  _metres(mm) {
    return (mm * this.world.scale) / 1000;
  }

  /** Stop areas served by bus lines, with their access point positions. */
  _busStops() {
    return this.world.stopAreas().filter((a) => (a.kind === "bus" || a.kind === "tram") && a.docks.some((d) => d.managed));
  }

  _railAreas() {
    return this.world.stopAreas().filter((a) => a.kind === "rail" && a.docks.length);
  }

  _accessPoint(area, i = 0) {
    const e = area.access[Math.min(i, area.access.length - 1)] || { s: 0, t: 0 };
    return area.toLayout(e.s, e.t);
  }

  _nearestAccess(area, p) {
    let best = 0, bd = Infinity;
    area.access.forEach((e, i) => {
      const d = dist2(area.toLayout(e.s, e.t), p);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  /* ================================================================ trips */

  /** Start the trip of a plan step from where the agent is. */
  _startTrip(a, step) {
    a.purpose = step.purpose;
    const from = a.inside ? this._buildingPos(a.inside, a.inside === a.house?.building ? a.house.entrance : 0) : a.pos;
    const fromKey = a.inside ? `building:${a.inside}:${a.inside === a.house?.building ? a.house.entrance : 0}` : null;
    if (!from) {
      // the building is gone: just be there
      this._arrive(a, step);
      return;
    }
    let destId = null;
    if (step.to.kind !== "station") {
      destId = this._resolveBuilding(a, step.to, from);
      if (!destId || destId === a.inside) return; // nothing to do (e.g. no shop)
      if (step.to.kind === "shop" && !this._open("shop")) return;
    }
    this._leave(a);
    a.pos = from.slice();
    if (step.to.kind === "station") {
      const legs = this._trainLegs(a, from, fromKey);
      if (!legs) {
        // no platform: the agent just leaves the town
        this._setAway(a);
        return;
      }
      a.trip = { legs, leg: 0, purpose: step.purpose, dest: null, station: true };
    } else {
      a.trip = { legs: this._legsTo(a, from, fromKey, destId), leg: 0, purpose: step.purpose, dest: destId };
    }
    this._beginLeg(a);
  }

  _open(kind) {
    const [o, c] = OPEN[kind] || [0, DAY_MINUTES];
    const m = this.world.clock.minutes;
    return m >= o && m < c;
  }

  /** Legs from a point to a building: walk, or walk + bus + walk. */
  _legsTo(a, from, fromKey, destId) {
    const dest = this._buildingPos(destId);
    if (!dest) return [];
    const destKey = `building:${destId}:0`;
    const walk = this._walkPath(from, dest, fromKey, destKey);
    const bus = this._busChoice(a, from, fromKey, dest, destKey, this._metres(walk.length));
    if (bus) return [...this._busLegs(bus), { type: "walk", path: null, toBuilding: destId }];
    return [{ type: "walk", path: walk, toBuilding: destId }];
  }

  /**
   * A bus connection for a way of `walkM` metres, or null: only for long ways (`walk_max_m`),
   * for a share of the people (`bus_share`, a little more for pupils and seniors) and when the
   * bus is not much slower than walking (see `_bestBus`).
   */
  _busChoice(a, from, fromKey, dest, destKey, walkM) {
    const transit = this.world.transit, pax = this.passengers;
    const shareBoost = a.role === "pupil" || a.role === "senior" ? 0.1 : 0;
    const rng = createRng(hashKey(this.world.seed, a.id, this.world.clock.day, a.next, "mode"));
    if (!transit || !pax || !(walkM > (+this.config.walk_max_m || 150)) || !rng.chance(Math.min(1, (+this.config.bus_share || 0) + shareBoost))) return null;
    return this._bestBus(from, dest, fromKey, destKey, walkM);
  }

  /** Walk to the stop, wait for the bus of the connection, ride it to the other stop. */
  _busLegs(bus) {
    return [
      { type: "walk", path: bus.walk1, target: bus.access, to: { area: bus.fromArea.id } },
      { type: "wait", area: bus.fromArea.id, dockId: bus.conn.fromDockId, line: bus.conn.lineId, toDockId: bus.conn.toDockId },
      { type: "ride", toDockId: bus.conn.toDockId, toArea: bus.toArea.id },
    ];
  }

  /** Best bus connection between two points, or null when walking is about as good. */
  _bestBus(from, dest, fromKey, destKey, walkM) {
    const transit = this.world.transit;
    if (typeof transit?.connections !== "function") return null;
    const stops = this._busStops();
    if (!stops.length) return null;
    const near = (p, key) => stops.map((area) => {
      const i = this._nearestAccess(area, p);
      const access = { pos: this._accessPoint(area, i), key: `area:${area.id}:${i}` };
      const path = key === "dest" ? this._walkPath(access.pos, p, access.key, destKey) : this._walkPath(p, access.pos, fromKey, access.key);
      return { area, path, access, m: this._metres(path.length) };
    }).filter((x) => x.m <= ACCESS_M);
    const origins = near(from, "from"), targets = near(dest, "dest");
    let best = null;
    for (const o of origins) {
      for (const t of targets) {
        if (o.area.id === t.area.id) continue;
        for (const conn of transit.connections(o.area.id, t.area.id) || []) {
          const headway = this._headway(conn.lineId);
          const ride = this._metres(conn.rideMM || 0) / BUS_SPEED;
          const time = (o.m + t.m) / 1.3 + headway / 2 + ride;
          if (!best || time < best.time) best = { time, conn, fromArea: o.area, toArea: t.area, walk1: o.path, access: o.access };
        }
      }
    }
    if (!best) return null;
    return best.time < (walkM / 1.3) * 1.3 ? best : null;
  }

  _headway(lineId) {
    const line = this.world.transit?.lines?.get?.(lineId);
    const h = Number(line?.headway ?? line?.obj?.spec?.headway_s ?? this.world.getObject(lineId)?.spec?.headway_s);
    return Number.isFinite(h) && h > 0 ? h : 240;
  }

  /**
   * Legs to the nearest platform and onto any train there. A long way to the station is taken by
   * bus (like other long ways) to a stop near the platform, e.g. the station's bus terminal; from
   * there people walk to the platform.
   */
  _trainLegs(a, from, fromKey) {
    const areas = this._railAreas();
    if (!areas.length) return null;
    let best = null;
    for (const area of areas) {
      const i = this._nearestAccess(area, from);
      const path = this._walkPath(from, this._accessPoint(area, i), fromKey, `area:${area.id}:${i}`);
      if (!best || path.length < best.path.length) best = { area, path, i };
    }
    const target = { pos: this._accessPoint(best.area, best.i), key: `area:${best.area.id}:${best.i}` };
    const toTrain = [
      { type: "walk", path: best.path, target, to: { area: best.area.id } },
      { type: "wait", area: best.area.id, dockId: null, line: null, train: true },
    ];
    const bus = this._busChoice(a, from, fromKey, target.pos, target.key, this._metres(best.path.length));
    if (!bus) return toTrain;
    toTrain[0].path = null; // from the stop where the bus stops
    return [...this._busLegs(bus), ...toTrain];
  }

  _beginLeg(a) {
    const leg = a.trip?.legs[a.trip.leg];
    if (!leg) {
      this._finishTrip(a);
      return;
    }
    if (leg.type === "walk") {
      // planned from another point (e.g. where people leave the platform): from here
      if (leg.path && a.pos && dist2(a.pos, leg.path.points[0]) > 1) leg.path = null;
      if (!leg.path && leg.target) leg.path = this._walkPath(a.pos, leg.target.pos, null, leg.target.key);
      else if (!leg.path) {
        const dest = this._buildingPos(leg.toBuilding);
        if (!dest) return this._finishTrip(a);
        leg.path = this._walkPath(a.pos, dest, null, `building:${leg.toBuilding}:0`);
      }
      a.state = "walking";
      a.path = leg.path;
      a.s = 0;
      a.person = null;
    } else if (leg.type === "wait") {
      const pax = this.passengers;
      a.path = null;
      if (!pax) return this._skipStop(a, leg);
      // a closed stop: people see it at the entrance and do not go in
      const area = this.world.getStopArea(leg.area);
      if (area && this.world.disruptions.effectsFor(area).closed) return this._skipStop(a, leg);
      const p = pax.enter(leg.area, { agent: a, dockId: leg.dockId, line: leg.line, anyDock: !leg.dockId, at: a.pos });
      if (!p) return this._skipStop(a, leg);
      a.person = p;
      a.state = "stop";
      a.waitSince = this.world.time;
    }
  }

  /** The stop cannot be used (no passenger simulation or the stop is gone, or no bus came). */
  _skipStop(a, leg) {
    if (leg.train) return this._setAway(a);
    // on the way to the train: walk to the platform instead
    const k = a.trip?.legs.findIndex((l) => l.type === "wait" && l.train) ?? -1;
    if (k > 0 && a.trip.legs[k - 1].type === "walk") {
      a.trip = { ...a.trip, legs: [{ ...a.trip.legs[k - 1], path: null }, a.trip.legs[k]], leg: 0 };
      return this._beginLeg(a);
    }
    // walk the rest of the way
    const dest = a.trip?.dest;
    if (!dest) return this._goHome(a);
    a.trip = { legs: [{ type: "walk", path: null, toBuilding: dest }], leg: 0, purpose: a.trip.purpose, dest };
    this._beginLeg(a);
  }

  _nextLeg(a) {
    if (!a.trip) return;
    a.trip.leg++;
    this._beginLeg(a);
  }

  _finishTrip(a) {
    const dest = a.trip?.dest ?? null, station = !!a.trip?.station;
    a.trip = null;
    a.path = null;
    a.person = null;
    a.vehicle = null;
    if (dest && this.world.getObject(dest)) this._setInside(a, dest);
    else if (station) this._setAway(a); // on the way to the train (e.g. its bus was taken out of service)
    else this._goHome(a, true);
  }

  _arrive(a, step) {
    if (step.to.kind === "station") this._setAway(a);
    else this._setInside(a, this._resolveBuilding(a, step.to));
  }

  /** Back home (or away for visitors), without travelling. */
  _goHome(a, teleport = true) {
    a.trip = null;
    a.path = null;
    a.person = null;
    a.vehicle = null;
    if (a.role === "visitor" || !a.house) this._setAway(a);
    else if (teleport) this._setInside(a, a.house.building);
  }

  _setInside(a, id) {
    this._leave(a);
    a.state = "inside";
    a.inside = id && this.world.getObject(id) ? id : null;
    if (!a.inside && a.house && this.world.getObject(a.house.building)) a.inside = a.house.building;
    if (!a.inside) {
      a.state = "away";
      return;
    }
    a.pos = null;
    // stay at least a little while (shopping takes some time even when the next plan step is due)
    a.stayUntil = this.world.time + (a.purpose === "shopping" ? 15 : 5) * 60 / Math.max(1e-6, this.world.clock.factor);
    const occ = this.world.occupancy || (this.world.occupancy = new Map());
    occ.set(a.inside, (occ.get(a.inside) || 0) + this._personWeight());
  }

  _setAway(a) {
    this._leave(a);
    a.state = "away";
    a.pos = null;
    a.path = null;
    a.person = null;
  }

  _leave(a) {
    if (a.state === "inside" && a.inside) {
      const occ = this.world.occupancy;
      if (occ) occ.set(a.inside, Math.max(0, (occ.get(a.inside) || 0) - this._personWeight()));
    }
    a.inside = null;
  }

  /* ================================================================ events from stops and vehicles */

  _boarded({ agent, vehicle, dock }) {
    const a = agent instanceof Agent && this.agents.includes(agent) ? agent : null;
    if (!a) return;
    a.person = null;
    const leg = a.trip?.legs[a.trip.leg];
    if (leg?.type === "wait" && leg.train) {
      // off by train; visitors and commuters come back by train later
      a.trip = null;
      this._setAway(a);
      return;
    }
    if (leg?.type === "wait" && vehicle) {
      a.trip.leg++;
      const ride = a.trip.legs[a.trip.leg];
      a.state = "riding";
      a.vehicle = vehicle;
      if (!Array.isArray(vehicle.riders)) vehicle.riders = [];
      vehicle.riders.push({ agent: a, toDockId: ride?.toDockId ?? null });
      return;
    }
    // boarded something unexpected: be at the destination
    this._finishTrip(a);
  }

  _exited({ agent, pos }) {
    const a = agent instanceof Agent && this.agents.includes(agent) ? agent : null;
    if (!a) return;
    a.person = null;
    a.pos = pos ? pos.slice() : a.pos;
    if (!a.trip) {
      this._goHome(a);
      return;
    }
    const leg = a.trip.legs[a.trip.leg];
    if (leg?.type === "wait") {
      // gave up waiting (or the stop was closed): walk instead, or go home
      if (leg.train) {
        a.trip = null;
        const home = a.house ? this._buildingPos(a.house.building, a.house.entrance) : null;
        if (!home) return this._setAway(a);
        a.trip = { legs: [{ type: "walk", path: null, toBuilding: a.house.building }], leg: 0, purpose: "home", dest: a.house.building };
        a.purpose = "home";
        return this._beginLeg(a);
      }
      return this._skipStop(a, leg);
    }
    // got off the bus or the train: on to the next leg
    this._nextLeg(a);
  }

  _removed({ agent }) {
    const a = agent instanceof Agent && this.agents.includes(agent) ? agent : null;
    if (!a) return;
    a.person = null;
    if (a.trip?.dest) this._setInside(a, a.trip.dest);
    else if (a.trip?.station) this._setAway(a);
    else this._goHome(a);
    a.trip = null;
  }

  _vehicleArrived({ vehicle, dock }) {
    if (!vehicle || !dock) return;
    const pax = this.passengers;
    // riders of a bus get off at their stop
    if (Array.isArray(vehicle.riders) && vehicle.riders.length) {
      const off = vehicle.riders.filter((r) => r.toDockId === dock.id && this.agents.includes(r.agent));
      if (off.length) {
        vehicle.riders = vehicle.riders.filter((r) => !off.includes(r));
        const agents = off.map((r) => r.agent);
        for (const a of agents) {
          a.vehicle = null;
          a.state = "stop"; // getting off; leaving the stop (passenger.exited) starts the next leg
        }
        if (pax) {
          for (const p of pax.alight(vehicle, dock, agents)) p.agent.person = p;
        } else for (const a of agents) this._finishTrip(a);
      }
    }
    // trains bring visitors in the morning and commuters back in the evening
    if (dock.kind === "rail" || vehicle.kind === "train") this._trainArrivals(vehicle, dock);
  }

  _trainArrivals(vehicle, dock) {
    const now = this.world.clock.minutes;
    const due = this.agents.filter((a) => a.state === "away" && this._dueByTrain(a, now));
    if (!due.length) return;
    const pax = this.passengers;
    const n = Math.min(due.length, 30);
    // by dock, not by vehicle: vehicle ids count on over all worlds (a layout loaded again), so the same seed would not give the same day
    const rng = createRng(hashKey(this.world.seed, dock.id, this.world.time.toFixed(1)));
    const chosen = [];
    for (let i = 0; i < n; i++) chosen.push(due.splice(rng.int(due.length), 1)[0]);
    for (const a of chosen) {
      const step = a.plan[a.next];
      a.next++;
      a.purpose = step.purpose;
      let destId = step.to.kind === "home" ? a.house?.building : this._resolveBuilding(a, step.to);
      if (step.shop && this._open("shop")) {
        // shopping on the way home: the shop first, home after a short stay
        const shopId = this._nearestShop(this._accessPoint(dock.area))?.id;
        if (shopId) {
          a.purpose = "shopping";
          a.plan.splice(a.next, 0, { at: now + 25, purpose: "home", to: { kind: "home" } });
          destId = shopId;
        }
      }
      // from the platform exit nearest the destination: on foot, or by bus when it is far
      const i = this._nearestAccess(dock.area, this._buildingPos(destId) || this._accessPoint(dock.area));
      const legs = this._legsTo(a, this._accessPoint(dock.area, i), `area:${dock.area.id}:${i}`, destId);
      a.trip = { legs: [{ type: "train-off" }, ...(legs.length ? legs : [{ type: "walk", path: null, toBuilding: destId }])], leg: 0, purpose: a.purpose, dest: destId };
      a.state = "stop";
    }
    if (pax) {
      for (const p of pax.alight(vehicle, dock, chosen)) p.agent.person = p;
    } else {
      for (const a of chosen) {
        a.pos = this._accessPoint(dock.area);
        this._nextLeg(a);
      }
    }
  }

  /** Is an away agent due to come (back) by train now? */
  _dueByTrain(a, now) {
    const step = a.plan[a.next];
    if (!step || !step.byTrain) return false;
    return now >= step.at && now < step.at + 4 * 60;
  }

  /* ================================================================ step */

  step(dt) {
    if (!this.enabled) return;
    if (this._build()) return;
    const clock = this.world.clock, now = clock.minutes;
    // clock jumps (time set by hand) and new days
    if (this._lastMinutes != null) {
      const expected = (dt * clock.factor) / 60;
      const moved = clock.day !== this._lastDay ? now + DAY_MINUTES * (clock.day - this._lastDay) - this._lastMinutes : now - this._lastMinutes;
      if (Math.abs(moved - expected) > Math.max(2, 3 * expected) && !clock.frozen) {
        this._placeAll();
        return;
      }
    }
    this._lastMinutes = now;
    this._lastDay = clock.day;
    for (const a of this.agents) {
      this._ensurePlan(a);
      if (a.state === "inside" || (a.state === "away" && !a.trip)) {
        const step = a.plan[a.next];
        if (!step || step.at > now) continue;
        if (a.state === "away") {
          // away agents come (back) by train (see _trainArrivals); other steps wait for that
          if (step.to.kind === "station") a.next++;
          continue;
        }
        a.next++;
        if (step.byTrain) continue; // already here (e.g. walked home instead of taking the train)
        if (a.stayUntil > this.world.time) {
          a.next--;
          continue;
        }
        this._startTrip(a, step);
      } else if (a.state === "walking") {
        this._walk(a, dt);
        // anger at a bike on the sidewalk passes slowly
        if (a.mood != null && a.mood < 0.85) a.mood = Math.min(0.85, a.mood + 0.003 * dt);
      } else if (a.state === "stop" && a.person && a.person.state === "waiting" && this.world.time - a.waitSince > this._patience(a)) {
        this.passengers?.release(a.person);
        a.waitSince = Infinity;
      }
    }
    // second chance: plans whose time passed while the agent was travelling
    if ((this._check += dt) > 2) {
      this._check = 0;
      this._sanity();
    }
  }

  /**
   * How long an agent waits at a stop (simulated s): 20 clock minutes, or a little longer than the
   * interval of what it waits for (an hourly train is worth waiting for).
   */
  _patience(a) {
    const clock = this.world.clock;
    const base = (PATIENCE_MIN * 60) / Math.max(1e-6, clock.factor);
    const leg = a.trip?.legs[a.trip.leg];
    let every = 0;
    if (leg?.train) {
      const docks = (this.world.getStopArea(leg.area)?.docks || []).filter((d) => !d.managed);
      if (docks.length && this.world.services.headwayOf) every = Math.min(...docks.map((d) => this.world.services.headwayOf(d)));
    } else if (leg?.line) every = this._headway(leg.line);
    const tod = Math.max(0.25, clock.demand(leg?.train ? "rail" : "bus"));
    return Math.max(base, (1.25 * every) / tod);
  }

  _walk(a, dt) {
    const path = a.path;
    if (!path) return this._nextLeg(a);
    const mmPerS = (a.speed * 1000) / this.world.scale;
    a.s += mmPerS * dt;
    a.phase += a.speed * dt * 5;
    if (a.s >= path.length) {
      a.pos = path.points[path.points.length - 1].slice();
      const leg = a.trip?.legs[a.trip.leg];
      if (leg?.toBuilding && a.trip.leg === a.trip.legs.length - 1) return this._finishTrip(a);
      return this._nextLeg(a);
    }
    const at = polylineAt(path.points, a.s, path.lengths);
    a.pos = at.point;
    a.dir = at.dir;
  }

  /** Repair agents whose stop, vehicle or building disappeared. */
  _sanity() {
    const transit = this.world.transit;
    const buses = new Set(transit?.buses || []);
    for (const a of this.agents) {
      if (a.state === "riding") {
        // the bus is gone (line deleted or changed, out of service) or the agent is not on board
        const rider = a.vehicle?.riders?.find?.((r) => r.agent === a);
        if (!a.vehicle || (transit && !buses.has(a.vehicle)) || !rider) this._finishTrip(a);
        else this._checkRide(a, rider);
      } else if (a.state === "inside" && a.inside && !this.world.getObject(a.inside)) {
        this._goHome(a);
      } else if (a.state === "stop" && !a.person && !a.trip) {
        this._goHome(a);
      }
    }
  }

  /** The stop a rider wants to get off at is not served any more (taken off the line): off at the next stop. */
  _checkRide(a, rider) {
    const bus = a.vehicle, V = this.world.transit?.lines?.get?.(bus.lineId)?.visits;
    if (!V?.length || V.some((v) => v.dockId === rider.toDockId)) return;
    // standing at a stop (also while the doors close): the people for it got off already
    const atStop = bus.phase === "dwelling" || (bus.phase === "departing" && bus.doorsLeft > 0);
    const next = V[(bus.next + (atStop ? 1 : 0)) % V.length];
    rider.toDockId = next?.dockId ?? null;
    const leg = a.trip?.legs[a.trip.leg];
    if (leg?.type === "ride") leg.toDockId = rider.toDockId;
  }

  /* ================================================================ drawing and figures */

  draw(view) {
    if (!this.enabled) return;
    const mode = this.world.settings.peopleColour || "auto";
    for (const a of this.agents) {
      if (a.state !== "walking" || !a.pos) continue;
      // the walk is on the sidewalks already (RoadNetwork.walkLine)
      const [x, y] = a.pos, dir = a.dir || [1, 0];
      if (hiddenAt(a.path, a.s)) continue; // in an underpass, or off stage
      if (!view.inImage(x, y, 0)) continue;
      drawPerson(view, [x, y], {
        dir, speed: a.speed, phase: a.phase, height: 1.6 + (hashKey(a.id) % 30) / 100,
        colour: mode === "mood" ? moodColor(a.mood ?? 0.85) : a.colour,
      });
    }
  }

  /** The residents walking now, for zebra crossings and riders (core/network.js, sims/cycling.js): [{pos, dir, agent}]. */
  pedestrians() {
    if (!this.enabled) return [];
    const out = [];
    for (const a of this.agents) if (a.state === "walking" && a.pos && !hiddenAt(a.path, a.s)) out.push({ pos: a.pos, dir: a.dir || [1, 0], agent: a });
    return out;
  }

  /** Somebody got in a walker's way (a bike on the sidewalk): the mood drops, and comes back slowly. */
  annoy(agent, amount = 0.2) {
    if (!agent) return;
    agent.mood = Math.max(0, (agent.mood ?? 0.85) - amount);
    agent.annoyed = this.world.time;
  }

  /* ================================================================ pointing at people */

  /** The people walking in the town as pickables (core/pick.js); those at the stops are the passengers'. */
  pickables(view) {
    if (!this.enabled) return [];
    const out = [];
    for (const a of this.agents) {
      if (a.state !== "walking" || !a.pos || hiddenAt(a.path, a.s)) continue;
      out.push({ key: `resident:${a.id}`, kind: "person", label: a.name, outline: rectAround(a.pos, view.m(0.7), view.m(0.7)), z0: 0, z1: view.m(1.8), owner: this, ref: a });
    }
    return out;
  }

  card(hit) {
    return { ...this.describeAgent(hit.ref), actions: [{ id: "follow", label: "Follow" }] };
  }

  /**
   * The card of a person of the town: where it lives and works, what it is doing, its plan for today.
   * @returns {import("../core/pick.js").Card | null} null for agents of other simulations
   */
  describeAgent(a) {
    if (!this.agents.includes(a)) return null;
    const name = (id) => (id ? this.world.getObject(id)?.name ?? id : null);
    const home = a.house ? name(a.house.building) : a.home?.kind === "station" ? `beyond the layout (by train)` : "away (by car)";
    const dest = a.trip?.station ? "the train" : name(a.trip?.dest);
    const doing = {
      inside: `In ${name(a.inside) ?? "a building"}`,
      walking: `Walking ${PURPOSE_LABELS[a.purpose] ?? ""}${dest && a.purpose !== "train" ? ` (${dest})` : ""}`.trim(),
      stop: `At a stop ${PURPOSE_LABELS[a.purpose] ?? ""}`.trim(),
      riding: `${a.vehicle?.kind === "tram" ? "On tram" : "On bus"} ${a.vehicle?.line ?? ""}`.trim(),
      away: "Away from the layout",
    }[a.state] || a.state;
    const rows = [["Lives", home]];
    if (a.job) rows.push(["Works at", name(a.job)]);
    if (a.school) rows.push(["School", name(a.school)]);
    if (a.shop) rows.push(["Shops at", name(a.shop)]);
    if (a.mood != null && a.mood < 0.8) rows.push(["Mood", `${Math.round(a.mood * 100)} %: a bike came too close on the sidewalk`]);
    const today = (a.plan || []).map((step, i) => {
      const to = step.to.kind === "building" ? ` (${name(step.to.id)})` : step.to.kind === "shop" ? " (the nearest shop)" : "";
      return `${i < a.next ? "✓ " : ""}${formatTime(step.at)} ${PURPOSE_LABELS[step.purpose] ?? step.purpose}${to}`;
    });
    const related = [a.house?.building, a.trip?.dest].filter((id) => id && this.world.getObject(id));
    return {
      title: a.name,
      subtitle: `Town · ${this._roleLabel(a)}`,
      status: doing,
      rows,
      sections: today.length ? [{ title: "Today", lines: today }] : [],
      related,
    };
  }

  _roleLabel(a) {
    if (a.role === "visitor") return VISIT_LABELS[a.visit] ?? ROLE_LABELS.visitor;
    if (a.role === "commuter" && a.visit === "school") return "pupil, goes to school elsewhere (train)";
    return ROLE_LABELS[a.role] ?? a.role;
  }

  /** Counts for the panel: where people are and what they are doing. */
  /** The town's people by their mood (it drops when a bike comes too close on the sidewalk). */
  states() {
    const items = this.agents.map((a) => ({ name: a.name, score: a.mood ?? 0.85, text: `mood ${Math.round((a.mood ?? 0.85) * 100)} %`, key: `resident:${a.id}` }));
    return [{ id: "residents", label: "Residents", measure: "mood", items }];
  }

    townStats() {
    const out = { total: this.agents.length, home: 0, work: 0, school: 0, shopping: 0, walking: 0, waiting: 0, riding: 0, away: 0, byPurpose: {} };
    const use = (id) => {
      const o = id ? this.world.getObject(id) : null;
      return o ? (typeof o.use === "function" ? o.use() : o.constructor.use) : null;
    };
    for (const a of this.agents) {
      if (a.state === "inside") {
        if (a.house && a.inside === a.house.building) out.home++;
        else {
          const u = use(a.inside);
          if (u === "school" && a.role === "pupil") out.school++;
          else if (u === "shop" && a.purpose === "shopping") out.shopping++;
          else out.work++;
        }
      } else if (a.state === "walking") {
        out.walking++;
        out.byPurpose[a.purpose] = (out.byPurpose[a.purpose] || 0) + 1;
      } else if (a.state === "stop") out.waiting++;
      else if (a.state === "riding") out.riding++;
      else out.away++;
    }
    return out;
  }

  /** Time of day as text (for messages). */
  timeLabel() {
    return formatTime(this.world.clock.minutes);
  }
}

export { wrapMinutes };
