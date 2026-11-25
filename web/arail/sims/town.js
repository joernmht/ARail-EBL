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
 * Every person has a profile of characteristics (core/mobility.js), drawn once from their own
 * random stream: pupils are children, seniors old; it sets how fast they walk and get on, the room
 * they take, and whether they can drive. For a long way (longer than `walk_max_m`) a person
 * chooses the mode (core/modes.js): on foot, by bike, by bus or tram where a line serves it, by
 * car for those with a driving licence while a car of the household stands at home; by what each
 * is expected to take, the weather, the person, and what they and the town have learned. A car
 * trip and a bike trip are driven on the streets where the road traffic and the cycling are
 * simulated (`TrafficSimulation.drive`, `CyclingSimulation.ride`), else they take their time
 * undrawn: the walks to and from the car, the time to load and unload (luggage, a pram, a
 * wheelchair), the drive and parking. People of a household go together where their ways are the
 * same (a parent takes a child to school, couples and families go shopping). Each trip is
 * recorded from door to door, in its parts (on foot, waiting, at the doors, riding, by car, by
 * bike): `tripStats()` by group, `tripsCSV()`.
 *
 * Everything degrades gracefully: without roads people walk straight, without bus lines
 * they walk, without platforms nobody commutes by train, without a passenger simulation
 * stops are skipped.
 * @module arail/sims/town
 */
import { Simulation } from "../core/simulation.js";
import { CD, moodColor } from "../core/colors.js";
import { createRng, dist2, hashKey, polylineAt, rectAround } from "../core/math.js";
import { DAY_MINUTES, formatTime, wrapMinutes } from "../core/clock.js";
import { hiddenAt, straightWalk } from "../core/network.js";
import { Person, Population, residentialBuildings } from "../core/people.js";
import { GROUPS, canDrive, carLegTime, drawProfile, mobilityOf, profileGroups, profileWords, walkingSpeed } from "../core/mobility.js";
import { MODES, MODE_KEYS, MODE_TABLE, TripMemory, chooseMode, exposure, modeProblems, modeSettings, perceived, personFactors, typicalShares } from "../core/modes.js";
import { drawPerson, personLooks, profileRows } from "./passengers.js";
import { hasShops } from "../objects/building-kit.js";

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

const BUS_SPEED = 25 / 3.6; // average speed of a bus incl. stops, for planning (m/s)
const PATIENCE_MIN = 20; // clock minutes an agent waits for a bus or train
const ACCESS_M = 300; // longest walk to a bus stop (prototype metres)
/** A car trip in the town: driving at about 30 km/h, the way 1.3 × as long as the straight line, a minute to park. */
const CAR_MPS = 30 / 3.6, CAR_DETOUR = 1.3, PARK_S = 60;
/** The walk to the car at home and from the car park to the door (prototype m). */
const CAR_WALK_M = [30, 60];
/** People leave through a door this far apart (s): about one a second through a house door (Weidmann 1993). */
const DOOR_S = 1.1;
/** Rain on a trip with more than this on foot and on the bike (simulated min) soaks the person. */
const SOAKED_MIN = 2;
/** What a trip that went badly costs the person's mood, and what a good one gives back. */
const BAD_TRIP_MOOD = 0.2;
const GOOD_TRIP_MOOD = 0.03;
/** Trips kept for the statistics (the latest). */
const TRIP_LOG = 5000;
/** The parts of a trip (`tripStats`), in words. */
export const TRIP_PARTS = { walk: "on foot", wait: "waiting", doors: "at the doors", ride: "riding", car: "by car", bike: "by bike" };
/**
 * A trip by bike: riding at 16 km/h (children three quarters, old people 0.85 of it; a little by how
 * fast the person walks), half a minute to unlock and to lock the bike, and its lamp or stand within
 * 20 m of the door.
 */
const BIKE = { kmh: 16, child: 0.75, old: 0.85, lock_s: 25, walk_m: 20 };
/** A mode nobody may take costs this (min), one everybody must take the negative of it. */
const NEVER = 1e6;
/** Children younger than this (years) are taken to school by somebody of their household. */
const ESCORT_YEARS = 10;
/** Somebody led by another (a child taken to school, a partner going along) waits this long (clock min) for them, then goes alone. */
const LED_GRACE_MIN = 25;
/** Households: children per family (shares of 1, 2, 3), families with two parents, couples among the old and among the other adults (Destatis 2023, rounded). */
const HOUSEHOLDS = { children: [0.5, 0.37, 0.13], twoParents: 0.8, oldCouples: 0.6, couples: 0.5 };
/** Going along: a partner at home goes shopping too, children at home come along, pupils of a house walk to school together (shares; estimates). */
const TOGETHER = { partner: 0.5, oldPartner: 0.7, children: 0.5, schoolmates: 0.7 };
/** A group walks two abreast, 0.7 m apart, the next row 0.9 m behind; in single file 0.8 m apart; a child strays up to 0.6 m. */
const FORMATION = { abreast_m: 0.7, row_m: 0.9, file_m: 0.8, stray_m: 0.6 };
/** A group that got apart at a stop waits this long (s) for those still on their way, then goes on. */
const GATHER_S = 40;

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
    // (what the loop over all agents in `TownSimulation.step` reads in every step comes first: next
    // to each other in memory)
    /**
     * "inside" | "walking" | "stop" (with the passenger simulation) | "riding" | "driving" (by car or
     * by bike: the car or the bike is drawn, not the person) | "with" (going along with `with`, who
     * leads the group) | "away"
     */
    this.state = "inside";
    this.planDay = -1;
    /** The trip being recorded from door to door (`_newRecord`), or null (undefined before the first). */
    this.record = undefined;
    /** Today's plan: [{at: minutes, purpose, to: {kind: "building", id} | {kind: "home"} | {kind: "station"} | {kind: "shop"}}]. */
    this.plan = [];
    this.next = 0;
    /**
     * The step of the plan due next (`plan[next]`) and its time, as they were for this plan and
     * index (see `TownSimulation._due`): plans are not changed once made, but for a step put in.
     */
    this._dueFor = null;
    this._dueIndex = -1;
    this._dueStep = undefined;
    this._dueAt = undefined;
    /** Current trip: {legs, leg, purpose, dest} */
    this.trip = null;
    this.job = null;
    this.school = null;
    /** Visitors: the shop they come to. */
    this.shop = null;
    /** Visitors: what brings them ("work", "school", "shopping"); commuters: what takes them away ("work", "school"). */
    this.visit = null;
    /** Building id while inside, else null. */
    this.inside = null;
    this.purpose = "home";
    this.pos = null;
    this.path = null;
    this.s = 0;
    /** Age, aid, luggage, licence and car (core/mobility.js), drawn once from its own stream. */
    this.profile = null;
    /** Walking speed (m/s), from the profile. */
    this.speed = 1.34;
    this.phase = 0;
    /** Today's trips from door to door: [{purpose, from, to, start, minutes, parts, end}] (clock minutes). */
    this.trips = [];
    this.person = null;
    this.waitSince = 0;
    this.vehicle = null;
    /** Visitors and commuters: earliest clock time to come (back) by train. */
    this.trainFrom = null;
    // set later (undefined until then); declared here so that all agents have the same shape, which
    // keeps the loop over them in `step` fast
    /** Simulated time before which the agent stays where it arrived. */
    this.stayUntil = undefined;
    /** Today by car on the long ways (`_makePlan`). */
    this.drives = undefined;
    /** Simulated time when the car trip is over (state "driving"). */
    this.carUntil = undefined;
    /** Walking direction (unit vector). */
    this.dir = undefined;
    /** Mood 0..1 after somebody got in the way (`annoy`), and when that was. */
    this.mood = undefined;
    this.annoyed = undefined;
    // on foot among the others (core/walking.js): mm to the right of the walk's line, the point on the
    // line, seconds waited at the kerb for a gap, standing there now, on a carriageway now
    this.lat = 0;
    this.line = undefined;
    this.kerb = 0;
    this.held = false;
    this.onRoad = false;
    this._cross = undefined;
    /** Where it walks in its group (`{lat, single, depth_s}`), and the group, or null. */
    this.form = null;
    this.group = null;
    /** The household ({id, members, cars, carsHome}), or null (people from elsewhere). */
    this.household = null;
    /** A child's age in years (6 to 18), else null. */
    this.years = null;
    /** How the person likes each mode against the others (min, less is liked): its own taste. */
    this.liking = null;
    /** Has a bike (and can ride it). */
    this.bike = false;
    /** What it remembers of its ways (core/modes.js TripMemory), made with its first trip. */
    this.memory = null;
    /**
     * Where its car and its bike are when not at home (a building's id, "area:<stop>" at a station,
     * "road" on the way), else null; the parking space of the car (sims/traffic.js), the rider and
     * the lamp or stand of the bike (sims/cycling.js).
     */
    this.carAt = null;
    this.carParked = null;
    this.bikeAt = null;
    this.bikeRider = null;
    this.bikeSpot = null;
    /** The car or rider it is in or on now (state "driving"), or null (the time is counted). */
    this.vehicleOwn = null;
    /** The one it goes along with (state "with"), and the group it is in ({leader, members}). */
    this.with = null;
    this.party = null;
    /** The pace of its group while it leads one (m/s), else 0. */
    this.pace = 0;
    /** Simulated time until which it waits for the others of its group, else 0. */
    this.gatherUntil = 0;
    /** Got apart from its group (it comes to their destination with them). */
    this.apart = false;
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
  static description = "Residents go to work, school and shopping and come home, on foot, by bike, by bus, tram and car and by train, alone and together, following the clock. They choose how they go by what they have learned.";
  static params = [
    { key: "people_per_100", label: "People shown", type: "number", unit: "per 100 residents", min: 1, max: 100, step: 1, default: 12 },
    { key: "max_people", label: "Max. people", type: "number", min: 0, max: 2000, step: 10, default: 300 },
    { key: "walk_max_m", label: "Longest walk", type: "number", unit: "m", min: 20, max: 3000, step: 10, default: 150, help: "A way up to this is walked. For a longer one people choose: on foot, by bike, by bus or tram, by car." },
    {
      key: "bus_share", label: "Bus and tram", type: "number", unit: "0 never, 1 always", min: 0, max: 1, step: 1, default: 0.5,
      help: "0: nobody takes the bus or the tram; 1: everybody does where a line fits. In between people choose for themselves (see the choice of the mode).",
    },
    {
      key: "car_share", label: "Car", type: "number", unit: "0 never, 1 always", min: 0, max: 1, step: 1, default: 0.5,
      help: "0: nobody drives in the town; 1: everybody who has a driving licence and a car does. In between people choose for themselves (see the choice of the mode).",
    },
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
    {
      key: "stretch", label: "Ways count as", type: "number", unit: "times as long", min: 1, max: 10, step: 0.5, default: 1,
      help: "A layout's town is smaller than a real one: when people choose their mode, the ways in it count as this many times as long, as if the town were of real size (3: a way of 300 m is weighed like one of 900 m; the walk to a stop and the waiting there as they are). It changes the choice, not how long anything takes.",
    },
    {
      key: "modes", label: "Choice of the mode", type: "table", rows: MODE_TABLE,
      help: "How people weigh walking, the bike, bus and tram and the car: a constant for each mode, how long a minute of it feels, and how they learn from their trips. A layout sets only the cells it changes.",
    },
    { key: "together", label: "Households and groups", type: "boolean", default: true, help: "People live in households (families, couples, singles) that share their cars; children are taken to school, partners go shopping together, pupils of a house walk together." },
  ];

  /** Problems of the settings as a layout writes them (the table of the modes). */
  static validate(config) {
    return modeProblems(config?.modes);
  }

  constructor(world, config) {
    super(world, config);
    // before #176 commuters_in counted people per 100 local jobs (0-200): read such values as a share
    if (+this.config.commuters_in > 1) this.config.commuters_in = Math.min(1, +this.config.commuters_in / 100);
    /** @type {Agent[]} */
    this.agents = [];
    /** The latest trips from door to door (see `tripStats`): [{id, name, groups, purpose, from, to, start, minutes, parts, end}]. */
    this.tripLog = [];
    /** Captive people (no licence or no car) who gave up waiting at a stop or found it closed, since the layout was loaded. */
    this.stranded = 0;
    this._built = null;
    this._lastMinutes = null;
    this._lastDay = null;
    this._check = 0;
    /** Agents that began a walk (`_beginLeg`): all who walk now are among them (see `_walking`). */
    this._walkers = new Set();
    this._walkingList = null;
    this._agentIndex = null;
    world.occupancy = new Map();
    const on = (name, fn) => world.events.on(name, fn);
    this._unsubscribe = [
      on("passenger.boarded", (e) => this._boarded(e)),
      on("passenger.exited", (e) => this._exited(e)),
      on("passenger.removed", (e) => this._removed(e)),
      on("passenger.denied", (e) => this._denied(e)),
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
      // shops of their own, and the shops on the ground floor of houses and offices
      if (hasShops(o) && cap.visitors > 0) out.shop.push({ o, cap });
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
    // the town worked out again: who is still there stays where they are, on their way, at a stop or on a bus
    const before = new Map((this.agents || []).map((a) => [a.id, a]));
    const kept = new Set();
    this.agents = agents.map((a) => {
      const old = before.get(a.id);
      if (!old) return a;
      kept.add(old);
      return old;
    });
    this._byId = new Map(this.agents.map((a) => [a.id, a]));
    // what each one is like: from its own random stream (the same id, the same person)
    const mob = mobilityOf(this.world), taste = (this.taste = this._taste());
    for (const a of this.agents) {
      a.profile = drawProfile(createRng(hashKey(this.world.seed, a.id, "profile")), this._profileContext(a), mob);
      a.speed = walkingSpeed(a.profile, mob);
      // how it likes each mode (people differ), a bike, and a child's age
      const rng = createRng(hashKey(this.world.seed, a.id, "taste"));
      a.liking = Object.fromEntries(MODE_KEYS.map((m) => [m, rng.normal(0, taste[m].spread)]));
      a.bike = rng.next() < taste.bike.own && personFactors(a.profile).canBike;
      a.years = a.profile.age === "child" ? 6 + rng.int(13) : null;
      a.memory ||= new TripMemory();
    }
    this._households();
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

  /** The tastes of the people (core/modes.js): the table `modes`, with the likings of bus and car of the settings. */
  _taste() {
    const T = modeSettings(this.config.modes);
    // the shares of before the choice of the modes: 0 still means never, 1 always; in between the choice decides
    const shift = (v) => {
      const x = Number(v);
      if (v === "" || v == null || !Number.isFinite(x)) return 0;
      return x <= 0 ? NEVER : x >= 1 ? -NEVER : 0;
    };
    return { ...T, transit: { ...T.transit, constant: T.transit.constant + shift(this.config.bus_share) }, car: { ...T.car, constant: T.car.constant + shift(this.config.car_share) } };
  }

  /**
   * The households of the town: the people of each house in families (one to three children with one
   * or two adults), couples and singles, each from the house's own random stream. A household shares
   * its cars: who has a driving licence can take one while one stands at home.
   */
  _households() {
    const byHome = new Map();
    for (const a of this.agents) {
      a.household = null;
      if (!a.house) continue;
      if (!byHome.has(a.house.building)) byHome.set(a.house.building, []);
      byHome.get(a.house.building).push(a);
    }
    /** The people of each house (id → agents), and the day each house's plans were made for. */
    this._homes = byHome;
    this._planned = new Map();
    if (this.config.together === false) return;
    for (const [home, list] of byHome) {
      const rng = createRng(hashKey(this.world.seed, "households", home));
      const mix = (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = rng.int(i + 1);
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      };
      const kids = mix(list.filter((a) => a.profile.age === "child")), old = mix(list.filter((a) => a.profile.age === "old")), adults = mix(list.filter((a) => a.profile.age === "adult"));
      const groups = [];
      while (kids.length) {
        const members = kids.splice(0, 1 + rng.weighted(HOUSEHOLDS.children));
        const parents = rng.chance(HOUSEHOLDS.twoParents) ? 2 : 1;
        for (let i = 0; i < parents; i++) {
          // (a grandparent where no parent is left)
          const parent = adults.pop() ?? (i === 0 ? old.pop() : null);
          if (parent) members.push(parent);
        }
        groups.push(members);
      }
      for (const [pool, share] of [[old, HOUSEHOLDS.oldCouples], [adults, HOUSEHOLDS.couples]]) {
        while (pool.length) groups.push(pool.splice(0, pool.length > 1 && rng.chance(share) ? 2 : 1));
      }
      groups.forEach((members, k) => {
        // the household's cars: one for each of its people who would have one, two at most (MiD 2017)
        const cars = Math.min(2, members.filter((m) => canDrive(m.profile)).length);
        const h = { id: `${home}/${k}`, home, members, cars, carsHome: cars - members.filter((m) => m.carAt != null).length };
        for (const m of members) {
          m.household = h;
          if (m.profile.licence) m.profile = { ...m.profile, car: cars > 0 };
        }
      });
    }
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
      for (const [id, n] of h.jobs) flows.push({ kind: "work", from: h.pos, to: work.find((p) => p.o.id === id)?.pos, n });
      for (const [id, n] of h.schools) flows.push({ kind: "school", from: h.pos, to: school.find((p) => p.o.id === id)?.pos, n });
      if (h.out + h.pupilsOut > 0) flows.push({ kind: "train", from: h.pos, to: station(h.pos), n: h.out + h.pupilsOut });
    }
    for (const g of visitors) if (g.visit !== "shopping") flows.push({ kind: "train", from: station(g.pos), to: g.pos, n: g.n });
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
   * People in the busiest hour on a bus or tram line: of the long ways of the morning (longer than
   * `walk_max_m`) between two stops of the line, the share that takes the bus or tram, as the choice
   * of the modes gives it for a way of that length (`_transitShare`); a way that several lines serve
   * is shared among them.
   */
  _lineRiders(line) {
    const transit = this.world.transit;
    const lines = [...(transit?.lines?.values?.() || [])].filter((l) => l.ok && l.visits?.length);
    const key = `${lines.map((l) => l.signature).join("|")}/${this._transitKey()}`;
    if (!this._lineDemand || this._lineDemand.key !== key) {
      const riders = new Map(lines.map((l) => [l.id, 0]));
      const walkMax = +this.config.walk_max_m || 150;
      const near = (l, p) => l.visits.some((v) => v.area && this._metres(dist2(this._accessPoint(v.area, this._nearestAccess(v.area, p)), p)) <= ACCESS_M);
      for (const f of this.demand?.flows || []) {
        const m = this._metres(dist2(f.from, f.to));
        if (m * 1.3 <= walkMax) continue;
        const serving = lines.filter((l) => near(l, f.from) && near(l, f.to));
        if (!serving.length) continue;
        const share = this._transitShare((m * this._stretch()) / 1000, f.kind);
        for (const l of serving) riders.set(l.id, riders.get(l.id) + (f.n * share * PEAK_HOUR) / serving.length);
      }
      this._lineDemand = { key, riders };
    }
    return this._lineDemand.riders.get(line.id) || 0;
  }

  /** What the share of bus and tram depends on besides the ways: the tastes, and how many trips the town has learned from (in steps). */
  _transitKey() {
    const n = this.tripLog.length;
    return `${JSON.stringify(this.config.modes ?? null)}:${this.config.bus_share}:${this.config.car_share}:${this.config.stretch}:${n < 200 ? 0 : n < 1000 ? 1 : 2}`;
  }

  /**
   * The share of the ways of `km` kilometres taken by bus or tram where a line fits: as the choice of
   * the modes gives it for the people of the town (core/modes.js `typicalShares`: a car only to work,
   * for those with a driving licence and a car; a bike for four in five where bikes are simulated),
   * and once the town has made some hundred long trips, half of it what they really took.
   * @param {number} km the straight line
   * @param {string} kind of the way: "work", "school" or "train"
   */
  _transitShare(km, kind) {
    const T = this.taste || this._taste(), mob = mobilityOf(this.world);
    if (T.transit.constant >= NEVER) return 0;
    if (T.transit.constant <= -NEVER / 2) return 1;
    const bikes = !!this._sim("cycling") && T.bike.constant < NEVER, cars = kind === "work" && T.car.constant < NEVER;
    const drive = cars ? mob.adult.licence * mob.everybody.car : 0, ride = bikes ? T.bike.own : 0;
    let share = 0;
    // (the people who have a car, a bike, both or neither)
    for (const [p, has] of [[drive * ride, ["walk", "bike", "transit", "car"]], [drive * (1 - ride), ["walk", "transit", "car"]], [(1 - drive) * ride, ["walk", "bike", "transit"]], [(1 - drive) * (1 - ride), ["walk", "transit"]]]) {
      if (p > 0) share += p * typicalShares(km, { taste: T, has }).transit;
    }
    const split = this.tripLog.length >= 200 ? this.modalSplit({ long: true }) : null;
    return split && split.trips >= 100 ? (share + split.shares.transit) / 2 : share;
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
    const hours = clock.profiles ? profileHours(clock.profile("passengers")) : 24;
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

  /**
   * What a person's profile is drawn with (core/mobility.js drawProfile): pupils are children,
   * seniors old, the others adults; the length of their trips (to the train: 30 km, else 2 km) and
   * what for, for their luggage.
   */
  _profileContext(a) {
    const child = a.role === "pupil" || a.visit === "school";
    const age = child ? "child" : a.role === "senior" ? "old" : "adult";
    const train = a.role === "visitor" || a.role === "commuter";
    return { age, km: train ? 30 : 2, purpose: child ? "school" : a.visit ?? (a.role === "worker" ? "work" : a.role === "senior" ? "shopping" : null) };
  }

  _ensurePlan(a) {
    const day = this.world.clock.day;
    if (a.planDay === day) return;
    // the people of a house plan their day together (who takes whom, who goes along); one who joins
    // a house whose day is planned already plans alone
    const home = a.house?.building;
    if (home != null && this._homes?.has(home) && this._planned.get(home) !== day) return this._planHome(home, day);
    this._planOne(a, day);
  }

  /** A person's plan for the day, each for themselves (`_makePlan`). */
  _planOne(a, day) {
    // a new day: commuters still away came home late at night
    if (a.planDay >= 0 && a.role === "commuter" && a.state === "away" && !a.trip) this._setInside(a, a.house?.building);
    a.plan = this._makePlan(a, day);
    a.planDay = day;
    a.next = 0;
    a.trips = [];
    a._dueFor = null;
  }

  /**
   * The plans of the people of a house for a day: each their own (`_planOne`), then what they do
   * together: the households' ways (`_joinPlans`) and the pupils of the house who walk to the same
   * school (`_schoolmates`). Who goes along has the step in their own plan too, `led`: they wait for
   * the one who leads, and go alone when nobody comes for them.
   */
  _planHome(home, day) {
    this._planned.set(home, day);
    const people = this._homes.get(home) || [];
    for (const a of people) this._planOne(a, day);
    if (this.config.together === false) return;
    const households = new Set(people.map((a) => a.household).filter(Boolean));
    for (const h of households) this._joinPlans(h, day);
    this._schoolmates(home, people, day);
    for (const a of people) a.plan.sort((p, q) => p.at - q.at);
  }

  /** Where a plan has its person at a time of day: "home", a building's id, "shop" or "away". */
  _whereAt(a, plan, minutes) {
    let at = a.role === "visitor" ? "away" : "home";
    for (const step of plan) {
      if (step.at > minutes) break;
      at = step.to.kind === "home" ? "home" : step.to.kind === "station" ? "away" : step.to.kind === "shop" ? "shop" : step.to.id;
    }
    return at;
  }

  /**
   * What a household does together on a day: a child younger than 10 is taken to school by an adult
   * of the household (one at home by day, else one on the way to work, who goes on from the school);
   * when an adult goes shopping, the partner at home goes along, and so do the children at home.
   */
  _joinPlans(h, day) {
    const rng = createRng(hashKey(this.world.seed, h.id, day, "together"));
    const adults = h.members.filter((m) => m.profile.age !== "child"), kids = h.members.filter((m) => m.profile.age === "child");
    let n = 0;
    const pid = () => `${h.id}:${day}:${n++}`;
    // to school together
    const schools = new Map();
    for (const kid of kids) {
      const step = kid.role === "pupil" && kid.years < ESCORT_YEARS ? kid.plan.find((x) => x.purpose === "school" && x.to.kind === "building") : null;
      if (!step) continue;
      if (!schools.has(step.to.id)) schools.set(step.to.id, []);
      schools.get(step.to.id).push({ kid, step });
    }
    // (the one at home by day takes them; else one who leaves for work or the train anyway)
    const escorts = [...adults.filter((m) => m.role === "senior"), ...adults.filter((m) => m.role === "worker" || (m.role === "commuter" && m.visit !== "school"))];
    for (const [school, list] of schools) {
      const adult = escorts.shift();
      if (!adult) break;
      const at = Math.min(...list.map((x) => x.step.at)), id = pid();
      for (const { step } of list) Object.assign(step, { at, led: true, pid: id });
      // their own way begins at the school: not before they are there
      let later = 0;
      for (const own of adult.plan) if (own.at < at + 12) own.at = at + 12 + 0.01 * later++;
      adult.plan.push({ at, purpose: "school", to: { kind: "building", id: school }, with: list.map((x) => x.kid.id), pid: id, escort: true });
      if (!adult.plan.some((x) => x.at > at && x.at < at + 60)) adult.plan.push({ at: at + 15, purpose: "home", to: { kind: "home" }, after: true });
    }
    // shopping together
    for (const adult of adults) {
      for (let i = 0; i < adult.plan.length - 1; i++) {
        const go = adult.plan[i], back = adult.plan[i + 1];
        if (go.purpose !== "shopping" || go.to.kind !== "shop" || go.led || go.with || !back.after || back.to.kind !== "home") continue;
        const free = (m) => m !== adult && this._whereAt(m, m.plan, go.at) === "home" && !m.plan.some((x) => x.at > go.at - 15 && x.at < back.at + 30);
        const along = [];
        for (const m of adults) if (free(m) && rng.chance(m.profile.age === "old" && adult.profile.age === "old" ? TOGETHER.oldPartner : TOGETHER.partner)) along.push(m);
        for (const m of kids) if (free(m) && rng.chance(TOGETHER.children)) along.push(m);
        if (!along.length) continue;
        const idGo = pid(), idBack = pid();
        Object.assign(go, { with: along.map((m) => m.id), pid: idGo });
        Object.assign(back, { with: along.map((m) => m.id), pid: idBack });
        for (const m of along) m.plan.push({ ...go, with: null, led: true }, { ...back, with: null, led: true });
        for (const m of along) m.plan.sort((p, q) => p.at - q.at);
      }
    }
    for (const m of h.members) m.plan.sort((p, q) => p.at - q.at);
  }

  /**
   * The pupils of a house who go to the same school walk together, two to four of them: those old
   * enough to go without an adult (and the younger ones nobody takes). The first of a group leads,
   * there and back.
   */
  _schoolmates(home, people, day) {
    const rng = createRng(hashKey(this.world.seed, home, day, "schoolmates"));
    const bySchool = new Map();
    for (const a of people) {
      if (a.role !== "pupil") continue;
      const go = a.plan.find((x) => x.purpose === "school" && x.to.kind === "building" && !x.led);
      const back = go ? a.plan.find((x) => x.purpose === "home" && x.at > go.at && !x.led) : null;
      if (!go || !back) continue;
      if (!bySchool.has(go.to.id)) bySchool.set(go.to.id, []);
      bySchool.get(go.to.id).push({ a, go, back });
    }
    let n = 0;
    for (const list of bySchool.values()) {
      while (list.length > 1) {
        const group = list.splice(0, 2 + rng.int(3));
        if (group.length < 2 || !rng.chance(TOGETHER.schoolmates)) continue;
        const [lead, ...rest] = group, idGo = `${home}:mates:${day}:${n++}`, idBack = `${home}:mates:${day}:${n++}`;
        Object.assign(lead.go, { with: rest.map((x) => x.a.id), pid: idGo });
        Object.assign(lead.back, { with: rest.map((x) => x.a.id), pid: idBack });
        for (const x of rest) {
          Object.assign(x.go, { at: lead.go.at, led: true, pid: idGo });
          Object.assign(x.back, { at: lead.back.at, led: true, pid: idBack });
        }
      }
    }
  }

  /** Everybody where they are (by their plans) at the current time of day, without travelling. */
  _placeAll() {
    const clock = this.world.clock;
    const now = clock.minutes;
    this._removeAgents();
    for (const a of this.agents) a.inside = null; // counted afresh in the new occupancy (leaving the old building must not subtract)
    this._countOccupancy();
    // the plans of today anew (they are changed as the day goes), each house once; cars and bikes are at home again
    this._planned?.clear();
    this._vehiclesHome();
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
    if (this._planned?.get(a.house?.building) !== this.world.clock.day) a.planDay = -1;
    this._ensurePlan(a);
    this._alone(a);
    a.trip = null;
    a.record = null;
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
    // placed, not arrived: it has been there since its plan said so, and leaves when its next step is
    // due (a stay from now held everybody in for five clock minutes after loading or setting the
    // time, and then sent them all off at once)
    a.stayUntil = 0;
  }

  /** Everybody's car and bike are at home again (the clock was set: nobody is on the way). */
  _vehiclesHome() {
    const cyc = this._sim("cycling");
    for (const a of this.agents) {
      if (a.bikeRider) cyc?.unlock?.(a.bikeRider);
      Object.assign(a, { carAt: null, carParked: null, bikeAt: null, bikeRider: null, bikeSpot: null, vehicleOwn: null });
      if (a.household) a.household.carsHome = a.household.cars;
    }
  }

  /** A simulation of the world by its type, if it runs. */
  _sim(type) {
    return this.world.simulations.find((x) => x.enabled !== false && x.constructor.type === type) || null;
  }

  /** Out of the group it was in (`_gather`): for itself again. */
  _alone(a) {
    const party = a.party;
    a.with = null;
    a.party = null;
    a.group = null;
    a.form = null;
    a.pace = 0;
    a.gatherUntil = 0;
    a.apart = false;
    if (party && party.leader === a) for (const m of party.members) if (m !== a && m.party === party) this._alone(m);
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

  /** The length (mm) of `_walkPath(from, to, …)`, without the walk itself (the network keeps the lengths). */
  _walkLength(from, to, fromKey = null, toKey = null) {
    const net = this._network();
    if (net && typeof net.walkLength === "function") return net.walkLength(from, to, { fromKey, toKey });
    return this._walkPath(from, to, fromKey, toKey).length;
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
    const fromId = a.inside;
    // who comes along (a child taken to school, a partner): those of the step who are here
    const along = step.to.kind === "station" ? [] : this._companions(a, step, fromId);
    this._leave(a);
    a.pos = from.slice();
    a.record = this._newRecord(step.purpose, fromId, step.to.kind === "station" ? null : destId);
    if (along.length) this._gather(a, along, step);
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

  /** The people of a step's group (`with`) who are in the building the leader leaves and free to come along. */
  _companions(a, step, fromId) {
    if (!step.with?.length || !fromId) return [];
    const out = [];
    for (const id of step.with) {
      const m = this._byId?.get(id);
      if (m && m !== a && m.state === "inside" && m.inside === fromId && !m.party && !m.trip) out.push(m);
    }
    return out;
  }

  /**
   * A group sets out: the leader and those who come along (state "with"). They walk at the pace of
   * the slowest, two abreast; at a stop each waits and gets on for themselves; a car takes them all.
   * Each has the trip in their own record; the plans of those led move on past the step.
   */
  _gather(leader, along, step) {
    const party = { leader, members: [leader, ...along] };
    leader.party = party;
    leader.group = party;
    leader.pace = Math.min(...party.members.map((m) => m.speed));
    const mmOf = (m) => (m * 1000) / this.world.scale;
    // two abreast: the leader on the left of the line, the next one beside, the others in rows behind
    leader.form = { lat: -mmOf(FORMATION.abreast_m / 2), single: mmOf(0.4), depth_s: (Math.ceil(party.members.length / 2) * FORMATION.row_m) / Math.max(0.3, leader.pace) };
    along.forEach((m, k) => {
      this._leave(m);
      Object.assign(m, { state: "with", with: leader, party, group: party, purpose: step.purpose, pos: leader.pos.slice(), path: null, person: null, vehicle: null, apart: false, trip: null });
      m.record = this._newRecord(step.purpose, leader.record.from, leader.record.to);
      // row and side: k = 0 walks beside the leader, 1 and 2 behind them, …
      m.form = { row: Math.floor((k + 1) / 2), side: (k + 1) % 2 ? 1 : -1, n: k + 1 };
      const i = step.pid ? m.plan.findIndex((x) => x.pid === step.pid) : -1;
      if (i >= 0) m.next = Math.max(m.next, i + 1);
      m._dueFor = null;
    });
  }

  _open(kind) {
    const [o, c] = OPEN[kind] || [0, DAY_MINUTES];
    const m = this.world.clock.minutes;
    return m >= o && m < c;
  }

  /**
   * Legs from a point to a building, by the mode the person chooses (`_choose`): on foot, by bike, by
   * bus or tram (walk, wait, ride, walk), by car. A short way (up to `walk_max_m`) is walked. A car or
   * a bike that is out with the person comes along: it is taken from where it stands, and fetched
   * before going home.
   */
  _legsTo(a, from, fromKey, destId) {
    const dest = this._buildingPos(destId);
    if (!dest) return [];
    const destKey = `building:${destId}:0`, here = placeOf(fromKey), home = a.house?.building ?? null;
    const walk = () => [{ type: "walk", path: this._walkPath(from, dest, fromKey, destKey), toBuilding: destId }];
    // the car or the bike is out: with it from here, back to it before going home
    for (const kind of ["car", "bike"]) {
      const at = kind === "car" ? a.carAt : a.bikeAt;
      if (at == null || (at !== here && destId !== home)) continue;
      const stands = kind === "car" ? a.carParked?.spot?.pos ?? null : a.bikeSpot?.pos ?? null;
      this._chosen(a, kind, null);
      // (from another place: on foot to where it stands)
      const to = at === here ? [] : [{ type: "walk", path: null, target: { pos: stands ?? this._buildingPos(at) ?? from, key: null } }];
      return [...to, ...this._ownLegs(a, kind, destId, at === here)];
    }
    // the length decides; the walk itself is made only when it is walked
    const walkM = this._metres(this._walkLength(from, dest, fromKey, destKey));
    if (!(walkM > (+this.config.walk_max_m || 150))) {
      this._chosen(a, "walk", { walk: walkM / this._pace(a) / 60 });
      return walk();
    }
    const options = this._options(a, from, fromKey, dest, destKey, walkM, home != null && here === home);
    const pick = this._choose(a, `${here ?? "?"}>${destId}`, options);
    if (pick.mode === "transit") return [...this._busLegs(pick.bus), { type: "walk", path: null, toBuilding: destId }];
    if (pick.mode === "car" || pick.mode === "bike") return this._ownLegs(a, pick.mode, destId, false, pick.seconds);
    return walk();
  }

  /** The pace of a person on foot (m/s): its own, or that of the group it leads. */
  _pace(a) {
    return Math.max(0.3, a.pace || a.speed);
  }

  /**
   * The legs of a trip by car or by bike to a building: on foot to where it stands when that is not
   * at the door (`toIt`: a parking space, a lamp), the drive or the ride, and the walk from where it
   * is left.
   */
  _ownLegs(a, kind, destId, toIt = false, seconds = null) {
    const stands = kind === "car" ? a.carParked?.spot?.pos : a.bikeSpot?.pos;
    const to = toIt && stands ? [{ type: "walk", path: null, target: { pos: stands, key: null } }] : [];
    const dest = this._buildingPos(destId), from = stands ?? a.pos;
    const s = seconds ?? (kind === "car" ? this._carSeconds(a, from, dest) : this._bikeSeconds(a, from, dest));
    return [...to, { type: kind, toBuilding: destId, seconds: s }, { type: "walk", path: null, toBuilding: destId }];
  }

  /** How fast a person rides a bike (km/h): 16, children and old people slower, a little by how fast they walk. */
  _bikeKmh(a) {
    const p = a.profile || {};
    return BIKE.kmh * (p.age === "child" ? BIKE.child : p.age === "old" ? BIKE.old : 1) * Math.min(1.25, Math.max(0.8, (p.base_mps || 1.34) / 1.34));
  }

  /** How long a trip by bike takes where no bike is drawn (simulated s): the ride on a way 1.3 × the straight line, unlocking and locking, the steps to the lamp. */
  _bikeSeconds(a, from, dest) {
    return (this._metres(dist2(from, dest)) * CAR_DETOUR) / (this._bikeKmh(a) / 3.6) + this._bikeEnds(a);
  }

  /** Unlocking and locking a bike and the steps between it and the doors (simulated s). */
  _bikeEnds(a) {
    return 2 * BIKE.lock_s + (2 * BIKE.walk_m) / Math.max(0.3, a.speed);
  }

  /**
   * The modes a person has for a way of `walkM` metres, each with the parts of the trip as planned
   * (simulated minutes: on empty streets, with a timetable that holds): on foot; by bus or tram where
   * a line fits (`_bestBus`); from home by car for those with a driving licence while a car of the
   * household stands there (not for people from elsewhere: their car is elsewhere), and by bike for
   * those who have one, where the bikes are simulated. A group takes no bikes, and a car only with a
   * driver and seats for all.
   * @returns {Array<{mode: string, parts: object, plan: number, bus?: object, seconds?: number}>} plan: its minutes together
   */
  _options(a, from, fromKey, dest, destKey, walkM, atHome) {
    const pace = this._pace(a), party = a.party?.leader === a ? a.party.members : null;
    const out = [{ mode: "walk", parts: { walk: walkM / pace / 60 } }];
    const T = this.taste;
    if (this.world.transit && this.passengers && T.transit.constant < NEVER) {
      const bus = this._bestBus(from, dest, fromKey, destKey, walkM, pace);
      if (bus) out.push({ mode: "transit", bus, parts: { walk: bus.walkS / 60, wait: bus.waitS / 60, ride: bus.rideS / 60, eur: T.transit.fare_eur * (party ? party.length : 1) } });
    }
    const resident = a.role !== "visitor" && atHome;
    const driver = party ? party.find((m) => canDrive(m.profile)) : a;
    const carFree = a.household ? a.household.carsHome > 0 : true;
    if (resident && driver && canDrive(driver.profile) && carFree && (!party || party.length <= 5) && T.car.constant < NEVER) {
      const real = this._sim("traffic")?.planSeconds?.(from, dest) ?? null;
      const mob = mobilityOf(this.world), load = 2 * carLegTime(party ? party.map((m) => m.profile) : a.profile, mob);
      const drive = real ?? (this._metres(dist2(from, dest)) * CAR_DETOUR) / CAR_MPS;
      const ends = (CAR_WALK_M[0] + CAR_WALK_M[1]) / pace + load + PARK_S;
      out.push({ mode: "car", seconds: drive + ends, parts: { drive: drive / 60, fixed: ends / 60, eur: (T.car.eur_km * this._metres(dist2(from, dest)) * CAR_DETOUR) / 1000 } });
    }
    const cyc = party ? null : this._sim("cycling");
    if (resident && cyc && a.bike && T.bike.constant < NEVER) {
      const ride = cyc.planSeconds?.(from, dest, this._bikeKmh(a)) ?? null;
      if (ride != null) out.push({ mode: "bike", seconds: ride + this._bikeEnds(a), parts: { bike: ride / 60, fixed: this._bikeEnds(a) / 60 } });
    }
    for (const o of out) o.plan = (o.parts.walk || 0) + (o.parts.wait || 0) + (o.parts.ride || 0) + (o.parts.drive || 0) + (o.parts.bike || 0) + (o.parts.fixed || 0);
    return out;
  }

  /**
   * The person chooses among the modes it has for a way (`key`): each costs what its parts are
   * expected to take, as the person feels them (core/modes.js `perceived`: the weather, the dark,
   * its age, aid and luggage, its own liking). What is expected is the plan times what the town has
   * learned of the mode at this hour (`world.experience`; for the car also the traffic news) and
   * what the person remembers of the mode on this way; the mode taken last time counts as cheaper
   * (habit), one that went badly as dearer. A logit over the costs chooses.
   */
  _choose(a, key, options) {
    const T = this.taste, clock = this.world.clock, weekend = clock.weekend();
    const party = a.party?.leader === a ? a.party.members : null;
    const person = { ...personFactors(a.profile) };
    // (a group goes as its most burdened member can)
    if (party) for (const m of party) person.walk = Math.max(person.walk, personFactors(m.profile).walk);
    const ctx = { taste: T, weather: exposure(this.world.weather, clock.daylight() < 0.2), person };
    const traffic = this._sim("traffic"), stretch = this._stretch();
    for (const o of options) {
      let town = this.world.experience.ratio(o.mode, clock.minutes, weekend);
      if (o.mode === "car" && traffic?.liveRatio) town = (town + traffic.liveRatio()) / 2;
      const own = a.memory?.of(key, o.mode), k = T.everybody.hearsay;
      // what was expected is learned against: the person's own ratio is about 1 where the town is right
      const ratio = town * (own ? (own.n * own.ratio + k) / (own.n + k) : 1);
      const p = o.parts, exp = { ...p };
      // the plan's own minutes stay (locking the bike, the walk to the car), the rest takes as long as the mode does now;
      // what is travelled counts as long as it would be in a town of real size (`stretch`), the waiting as it is
      // (the walk to a stop is as far as it is: the stops of a small town are no farther apart than those of a large one)
      for (const part of ["walk", "wait", "ride", "drive", "bike"]) if (exp[part]) exp[part] *= ratio * (part === "wait" || (part === "walk" && o.mode !== "walk") ? 1 : stretch);
      if (exp.eur && o.mode === "car") exp.eur *= stretch;
      o.ratio = ratio;
      o.expected = o.plan + (ratio - 1) * (o.plan - (p.fixed || 0));
      o.cost = perceived(o.mode, exp, { ...ctx, own: a.liking?.[o.mode] ?? 0 }) - (a.memory?.last(key) === o.mode ? T.everybody.habit : 0) + (own ? own.bad * T.everybody.anger : 0);
    }
    const rng = createRng(hashKey(this.world.seed, a.id, clock.day, a.next, "mode"));
    const pick = chooseMode(rng, options, T.everybody.sharpness) || options[0];
    this._chosen(a, pick.mode, pick.parts, key, pick, options);
    return pick;
  }

  /** How many times as long the ways count in the choice of the mode (`stretch`): a layout's town is smaller than a real one. */
  _stretch() {
    const v = Number(this.config.stretch);
    return Number.isFinite(v) && v >= 1 ? Math.min(10, v) : 1;
  }

  /** The mode chosen for the trip that begins, into its record: what was planned and expected (simulated minutes), and what else there was. */
  _chosen(a, mode, parts, key = null, pick = null, options = null) {
    const r = a.record;
    if (!r) return;
    Object.assign(r, {
      mode, way: key, planned: pick?.plan ?? (parts?.walk || 0), expected: pick?.expected ?? (parts?.walk || 0), plannedParts: parts,
      weighed: options ? options.map((o) => ({ mode: o.mode, minutes: o.expected, cost: o.cost })) : null,
    });
    for (const m of a.party?.leader === a ? a.party.members : []) if (m !== a && m.record) Object.assign(m.record, { mode, along: true });
  }

  /**
   * How long a trip by car takes (simulated s; it is not drawn): the walk to the car and from the car
   * park at the person's speed, loading and unloading (luggage, a pram, a wheelchair: carLegTime), the
   * drive at 30 km/h on a way 1.3 × the straight line, and a minute to park.
   */
  _carSeconds(a, from, dest) {
    const mob = mobilityOf(this.world);
    const drive = (this._metres(dist2(from, dest)) * CAR_DETOUR) / CAR_MPS;
    return (CAR_WALK_M[0] + CAR_WALK_M[1]) / Math.max(0.3, a.speed) + 2 * carLegTime(a.profile, mob) + drive + PARK_S;
  }

  /** Walk to the stop, wait for the bus of the connection, ride it to the other stop. */
  _busLegs(bus) {
    return [
      { type: "walk", path: bus.walk1, target: bus.access, to: { area: bus.fromArea.id } },
      { type: "wait", area: bus.fromArea.id, dockId: bus.conn.fromDockId, line: bus.conn.lineId, toDockId: bus.conn.toDockId },
      { type: "ride", toDockId: bus.conn.toDockId, toArea: bus.toArea.id },
    ];
  }

  /** Best bus connection between two points, or null when walking (at `speed`, m/s) is about as good. */
  _bestBus(from, dest, fromKey, destKey, walkM, speed = 1.34) {
    const transit = this.world.transit;
    if (typeof transit?.connections !== "function") return null;
    const stops = this._busStops();
    if (!stops.length) return null;
    // the walks to and from every stop by their lengths (the network keeps them); the walk to the
    // stop taken is made at the end
    const near = (p, key) => stops.map((area) => {
      const i = this._nearestAccess(area, p);
      const access = { pos: this._accessPoint(area, i), key: `area:${area.id}:${i}` };
      // no walk is shorter than the straight line (a metre to spare): a stop farther away is out of reach
      if (this._metres(dist2(p, access.pos)) > ACCESS_M + 1) return { area, access, m: Infinity };
      const length = key === "dest" ? this._walkLength(access.pos, p, access.key, destKey) : this._walkLength(p, access.pos, fromKey, access.key);
      return { area, access, m: this._metres(length) };
    }).filter((x) => x.m <= ACCESS_M);
    const origins = near(from, "from"), targets = near(dest, "dest");
    let best = null;
    for (const o of origins) {
      for (const t of targets) {
        if (o.area.id === t.area.id) continue;
        for (const conn of transit.connections(o.area.id, t.area.id) || []) {
          const headway = this._headway(conn.lineId);
          const ride = this._metres(conn.rideMM || 0) / BUS_SPEED;
          const time = (o.m + t.m) / speed + headway / 2 + ride;
          if (!best || time < best.time) best = { time, conn, fromArea: o.area, toArea: t.area, walk1: null, access: o.access, walkS: (o.m + t.m) / speed, waitS: headway / 2, rideS: ride };
        }
      }
    }
    if (!best || !(best.time < (walkM / speed) * 1.3)) return null;
    best.walk1 = this._walkPath(from, best.access.pos, fromKey, best.access.key);
    return best;
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
    // the nearest platform by the length of the walk; the walk itself only when it is walked from here
    let best = null;
    for (const area of areas) {
      const i = this._nearestAccess(area, from);
      const length = this._walkLength(from, this._accessPoint(area, i), fromKey, `area:${area.id}:${i}`);
      if (!best || length < best.length) best = { area, length, i };
    }
    const target = { pos: this._accessPoint(best.area, best.i), key: `area:${best.area.id}:${best.i}` };
    const toTrain = [
      { type: "walk", path: null, target, to: { area: best.area.id } },
      { type: "wait", area: best.area.id, dockId: null, line: null, train: true },
    ];
    // to the station on foot, by bus or tram, or by bike (which waits there for the way back); not by car
    const walkM = this._metres(best.length), here = placeOf(fromKey), home = a.house?.building ?? null;
    let pick = { mode: "walk" };
    if (a.bikeAt != null && a.bikeAt === here) pick = { mode: "bike", seconds: null };
    else if (walkM > (+this.config.walk_max_m || 150)) {
      const options = this._options(a, from, fromKey, target.pos, target.key, walkM, home != null && here === home).filter((o) => o.mode !== "car");
      pick = this._choose(a, `${here ?? "?"}>station`, options);
    } else this._chosen(a, "walk", { walk: walkM / this._pace(a) / 60 });
    if (pick.mode === "transit") return [...this._busLegs(pick.bus), ...toTrain]; // (the walk to the platform starts from the stop where the bus stops)
    if (pick.mode === "bike") {
      if (pick.seconds == null) this._chosen(a, "bike", null);
      return [{ type: "bike", toBuilding: null, toPos: target.pos, toPlace: `area:${best.area.id}`, seconds: pick.seconds ?? this._bikeSeconds(a, from, target.pos) }, ...toTrain];
    }
    toTrain[0].path = this._walkPath(from, this._accessPoint(best.area, best.i), fromKey, target.key);
    return toTrain;
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
      this._walkers.add(a);
      this._walkingList = null;
      a.path = leg.path;
      a.s = 0;
      a.lat = a.form?.lat ?? 0;
      a.kerb = 0;
      a.held = false;
      a.person = null;
      // a group that got apart (at a stop, on the bus) waits here for those still on their way
      const along = this._along(a);
      if (along.some((m) => m.state !== "with")) a.gatherUntil = this.world.time + GATHER_S;
      for (const m of along) if (m.state === "with") this._beside(a, m);
    } else if (leg.type === "car" || leg.type === "bike") {
      this._beginOwn(a, leg);
    } else if (leg.type === "wait") {
      const pax = this.passengers;
      a.path = null;
      if (!pax) return this._skipStop(a, leg);
      // a closed stop: people see it at the entrance and do not go in (a captive one has no car to take instead)
      const area = this.world.getStopArea(leg.area);
      if (area && this.world.disruptions.effectsFor(area).closed) {
        if (a.profile && a.profile.age !== "child" && !canDrive(a.profile)) this.stranded++;
        return this._skipStop(a, leg);
      }
      const p = pax.enter(leg.area, { agent: a, dockId: leg.dockId, line: leg.line, anyDock: !leg.dockId, at: a.pos });
      if (!p) return this._skipStop(a, leg);
      a.person = p;
      a.state = "stop";
      a.waitSince = this.world.time;
      // those who come along wait and get on for themselves
      for (const m of this._along(a)) {
        if (m.state !== "with") continue;
        const q = pax.enter(leg.area, { agent: m, dockId: leg.dockId, line: leg.line, anyDock: !leg.dockId, at: m.pos || a.pos });
        if (!q) continue;
        m.person = q;
        m.state = "stop";
      }
    }
  }

  /** Those who come along with a leader (the members of its group but itself); none for anybody else. */
  _along(a) {
    const party = a.party;
    return party && party.leader === a ? party.members.filter((m) => m !== a && m.party === party) : [];
  }

  /**
   * A leg by car or by bike begins: with a car of the road traffic or a rider of the cycling
   * simulation where they run (it is drawn, and takes as long as the streets let it), else the time
   * is counted and nothing is drawn. The household's car leaves home; a bike is unlocked.
   */
  _beginOwn(a, leg) {
    const car = leg.type === "car", to = leg.toPos ?? this._buildingPos(leg.toBuilding);
    a.state = "driving";
    a.path = null;
    a.person = null;
    leg.from = a.pos ? a.pos.slice() : null;
    leg.began = this.world.time;
    const done = (at) => this._ownArrived(a, leg, at);
    let handle = null;
    if (car) {
      if (a.carAt == null && a.household) a.household.carsHome = Math.max(0, a.household.carsHome - 1);
      const people = [a, ...this._along(a)], driver = people.find((m) => canDrive(m.profile)) || a;
      handle = to && leg.toBuilding ? this._sim("traffic")?.drive?.({
        people: [driver, ...people.filter((m) => m !== driver)], from: leg.from, to: leg.toBuilding, purpose: leg.toBuilding === a.house?.building ? "home" : a.purpose === "work" ? "work" : a.purpose === "shopping" ? "shopping" : "visit",
        parked: a.carParked, onArrive: done,
      }) ?? null : null;
      a.carAt = "road";
      a.carParked = null;
    } else {
      const cyc = this._sim("cycling");
      if (a.bikeRider) cyc?.unlock?.(a.bikeRider);
      handle = to ? cyc?.ride?.({ person: a, from: leg.from, to, kmh: this._bikeKmh(a), child: a.profile?.age === "child" && a.years < 10, name: leg.toBuilding ? this.world.getObject(leg.toBuilding)?.name ?? null : "the station", onArrive: done }) ?? null : null;
      a.bikeAt = "road";
      a.bikeRider = null;
      a.bikeSpot = null;
    }
    a.vehicleOwn = handle;
    a.pos = null;
    // (no car or bike to be seen: there after the time it takes)
    a.carUntil = handle ? Infinity : this.world.time + leg.seconds;
    for (const m of this._along(a)) m.pos = null;
  }

  /**
   * The car is parked, the bike is locked (or the counted time is over): the person is where they
   * get out or off, the car or bike stays there (at home it is home again), and the trip goes on.
   */
  _ownArrived(a, leg, at = {}) {
    if (a.state !== "driving" || a.trip?.legs[a.trip.leg] !== leg) return;
    const car = leg.type === "car", home = a.house?.building ?? null;
    const place = leg.toBuilding ?? leg.toPlace ?? null, atHome = place != null && place === home;
    a.vehicleOwn = null;
    if (car) {
      a.carAt = atHome ? null : place;
      a.carParked = at.parked ?? null;
      if (atHome && a.household) a.household.carsHome = Math.min(a.household.cars, a.household.carsHome + 1);
      if (a.record && at.ratio > 0) a.record.driveRatio = at.ratio;
    } else {
      a.bikeAt = atHome ? null : place;
      a.bikeRider = at.spot ? at.rider ?? null : null;
      a.bikeSpot = at.spot ?? null;
      // (at home the bike goes into the cellar: the lamp is free again)
      if (atHome && a.bikeRider) {
        this._sim("cycling")?.unlock?.(a.bikeRider);
        a.bikeRider = null;
        a.bikeSpot = null;
      }
    }
    a.pos = (at.pos ?? leg.toPos ?? this._buildingPos(leg.toBuilding) ?? leg.from ?? [0, 0]).slice();
    for (const m of this._along(a)) m.pos = a.pos.slice();
    this._nextLeg(a);
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
    this._closeRecord(a, dest && this.world.getObject(dest) ? "arrived" : station ? "train" : "home");
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
    // those who came along are where their leader is now
    if (a.party?.leader === a) this._dissolve(a, id);
    // a trip that ended otherwise (taken off a stop, sent home): recorded as such
    if (a.record) this._closeRecord(a, "other");
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
    if (a.party?.leader === a) this._dissolve(a, a.house?.building ?? null);
    if (a.record) this._closeRecord(a, a.trip?.station ? "train" : "other");
    this._leave(a);
    a.state = "away";
    a.pos = null;
    a.path = null;
    a.person = null;
  }

  /**
   * A group's trip is over: those who came along are in the building too (off the stop or the bus
   * where they still were), each with the trip in their record; the group is no more.
   */
  _dissolve(leader, id) {
    const party = leader.party, r = leader.record;
    const along = this._along(leader);
    this._alone(leader);
    if (!party) return;
    const off = new Set(along.filter((m) => m.state === "stop" || m.state === "riding"));
    if (off.size) this._removeAgents(off);
    for (const m of along) {
      this._alone(m);
      if (m.record && r) Object.assign(m.record, { mode: r.mode, way: null });
      // (the leader's record is closed by now where it arrived: theirs ends the same way)
      if (m.record) this._closeRecord(m, leader.trips[leader.trips.length - 1]?.end ?? "other");
      m.person = null;
      m.vehicle = null;
      m.state = "walking"; // (so that `_setInside` counts it in, not out)
      this._setInside(m, id);
    }
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
    if (a.with) {
      // comes along: on board for as far as its leader rides
      const L = a.with.trip?.legs || [], ride = L[a.with.trip?.leg]?.type === "ride" ? L[a.with.trip.leg] : L.slice(a.with.trip?.leg ?? 0).find((l) => l.type === "ride");
      if (!vehicle || !ride) {
        a.state = "with";
        return;
      }
      a.state = "riding";
      a.vehicle = vehicle;
      if (!Array.isArray(vehicle.riders)) vehicle.riders = [];
      vehicle.riders.push({ agent: a, toDockId: ride.toDockId ?? null });
      return;
    }
    const leg = a.trip?.legs[a.trip.leg];
    if (leg?.type === "wait" && leg.train) {
      // off by train; visitors and commuters come back by train later
      this._closeRecord(a, "train");
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
    if (a.with) {
      // comes along: off the stop, back with its leader (out of sight until they are together again)
      a.state = "with";
      a.vehicle = null;
      const lead = a.with;
      a.apart = !(lead.pos && a.pos && this._metres(dist2(lead.pos, a.pos)) < 40 && (lead.state === "walking" || lead.state === "stop"));
      return;
    }
    if (!a.trip) {
      this._goHome(a);
      return;
    }
    const leg = a.trip.legs[a.trip.leg];
    if (leg?.type === "wait") {
      // a captive one: no car to take instead
      if (a.profile && a.profile.age !== "child" && !canDrive(a.profile)) this.stranded++;
      if (a.record) a.record.gaveUp = true;
      // those who came along give up with it
      for (const m of this._along(a)) if (m.person) this.passengers?.release(m.person);
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
    if (a.with) {
      a.state = "with";
      a.apart = true;
      return;
    }
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
          a._dueFor = null; // the plan changed (see `_due`)
          destId = shopId;
        }
      }
      // from the platform exit nearest the destination: on foot, or by bus when it is far
      const i = this._nearestAccess(dock.area, this._buildingPos(destId) || this._accessPoint(dock.area));
      a.record = this._newRecord(a.purpose, null, destId, "train");
      a.pos = this._accessPoint(dock.area, i);
      const legs = this._legsTo(a, a.pos, `area:${dock.area.id}:${i}`, destId);
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

  /** Left behind at a stop (full, no wheelchair place, a step too high): the trip went badly. */
  _denied({ agent }) {
    if (agent instanceof Agent && agent.record) agent.record.denied = true;
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
    const day = clock.day;
    for (const a of this.agents) {
      if (a.planDay !== day) this._ensurePlan(a);
      if (a.record) this._tally(a, dt);
      if (a.state === "with") continue; // goes along: its leader moves it
      if (a.state === "inside" || (a.state === "away" && !a.trip)) {
        // most wait for the next step of their plan: its time is kept on the agent (see `_due`)
        if (a._dueFor !== a.plan || a._dueIndex !== a.next) this._due(a);
        const step = a._dueStep;
        if (!step || a._dueAt > now) continue;
        if (a.state === "away") {
          // away agents come (back) by train (see _trainArrivals); other steps wait for that
          if (step.to.kind === "station") a.next++;
          continue;
        }
        // led by another (a child taken to school, a partner going along): they wait for them a while, then go alone
        if (step.led && !step.alone) {
          if (now < step.at + LED_GRACE_MIN) continue;
          step.alone = true;
        }
        a.next++;
        if (step.byTrain) continue; // already here (e.g. walked home instead of taking the train)
        if (a.stayUntil > this.world.time || !this._doorFree(a)) {
          a.next--;
          continue;
        }
        this._startTrip(a, step);
      } else if (a.state === "driving") {
        if (this.world.time >= a.carUntil) this._ownArrived(a, a.trip?.legs[a.trip.leg]);
      } else if (a.state === "walking") {
        this._walk(a, dt);
        // anger at a bike on the sidewalk passes slowly
        if (a.mood != null && a.mood < 0.85) a.mood = Math.min(0.85, a.mood + 0.003 * dt);
      } else if (a.state === "stop" && !a.with && a.person && a.person.state === "waiting" && this._impatient(a)) {
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
   * People leave a building through its door one after the other ({@link DOOR_S} apart), not as one
   * figure: may this one go now? (Then the door is taken for the next.)
   */
  _doorFree(a) {
    if (!a.inside) return true;
    const doors = (this._doors ||= new Map());
    const key = a.inside === a.house?.building ? `${a.inside}:${a.house.entrance}` : a.inside;
    const now = this.world.time;
    if (now - (doors.get(key) ?? -Infinity) < DOOR_S) return false;
    doors.set(key, now);
    return true;
  }

  /**
   * Keep the step of an agent's plan due next (`plan[next]`) and its time on the agent, for this plan
   * and index: the loop over all agents in `step` then need not look into every plan. A plan's steps
   * do not change once made; where a step is put into a plan, what is kept is dropped.
   */
  _due(a) {
    const step = a.plan[a.next];
    a._dueFor = a.plan;
    a._dueIndex = a.next;
    a._dueStep = step;
    a._dueAt = step ? step.at : undefined;
  }

  /**
   * Has an agent waited at its stop longer than its patience (`_patience`)? Never before the 20
   * clock minutes all wait at least: until then the rest need not be worked out.
   */
  _impatient(a) {
    const waited = this.world.time - a.waitSince;
    if (waited <= (PATIENCE_MIN * 60) / Math.max(1e-6, this.world.clock.factor)) return false;
    return waited > this._patience(a);
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
    const along = this._along(a);
    // a group that got apart waits for those still on their way (who is not there in time comes to the destination later)
    if (a.gatherUntil) {
      if (along.some((m) => m.state !== "with") && this.world.time < a.gatherUntil) {
        a.held = true;
        return;
      }
      a.gatherUntil = 0;
      for (const m of along) if (m.state === "with") this._beside(a, m);
    }
    // among the others and the vehicles (core/walking.js): at the kerb until there is a gap, to the
    // right when somebody comes, behind a slower one; slower on snow and ice (core/weather.js).
    // A group walks at the pace of its slowest.
    const own = a.speed;
    if (a.pace) a.speed = a.pace;
    const there = this.world.walking.advance(a, dt, this.world.weather.walkFactor());
    a.speed = own;
    if (!a.held) a.phase += a.speed * dt * 5;
    for (const m of along) if (m.state === "with" && !m.apart) this._beside(a, m);
    if (there) {
      a.pos = path.points[path.points.length - 1].slice();
      const leg = a.trip?.legs[a.trip.leg];
      if (leg?.toBuilding && a.trip.leg === a.trip.legs.length - 1) return this._finishTrip(a);
      return this._nextLeg(a);
    }
  }

  /**
   * Where one who comes along walks: beside or behind its leader, two abreast in rows; in single file
   * behind the leader when somebody comes the other way or the group crosses a street; a child strays
   * a little ahead and back on the sidewalk.
   */
  _beside(leader, m) {
    const path = leader.path, f = m.form;
    if (!path || !f || leader.s == null) return;
    const mmOf = (x) => (x * 1000) / this.world.scale;
    const file = leader.onRoad || leader.held || (leader.lat || 0) > (leader.form?.lat ?? 0) + mmOf(0.2);
    let back = file ? f.n * FORMATION.file_m : f.row * FORMATION.row_m;
    let lat = (leader.lat || 0) + (file ? 0 : f.row === 0 ? mmOf(FORMATION.abreast_m) : f.side > 0 ? mmOf(FORMATION.abreast_m) : 0);
    if (!file && m.profile?.age === "child") {
      // (skipping ahead and falling back, each child in its own rhythm)
      const t = this.world.time * 0.5 + (hashKey(m.id) % 628) / 100;
      back += Math.sin(t) * FORMATION.stray_m;
      lat += Math.cos(t * 1.3) * mmOf(0.15);
    }
    const s = Math.max(0, Math.min(path.length, leader.s - mmOf(back)));
    const at = polylineAt(path.points, s, path.lengths);
    m.pos = [at.point[0] - at.dir[1] * lat, at.point[1] + at.dir[0] * lat];
    m.dir = at.dir;
    m.lat = lat;
    m.held = leader.held;
    m.onRoad = leader.onRoad;
    m.s = s;
    if (!leader.held) m.phase += leader.pace * 0.1 * 5;
  }

  /* ================================================================ trips from door to door */

  /** Clock minutes since 00:00 of day 0. */
  _clockNow() {
    const c = this.world.clock;
    return (c.day ?? 0) * DAY_MINUTES + c.minutes;
  }

  /**
   * A new record of a trip: what for, from and to which building (ids; null: the train or a station),
   * when it began (clock minutes since day 0) and its parts (clock minutes) so far.
   */
  _newRecord(purpose, from, to, fromKind = null) {
    return { purpose, from: from ?? null, to: to ?? null, fromTrain: fromKind === "train", start: this._clockNow(), parts: { walk: 0, wait: 0, doors: 0, ride: 0, car: 0, bike: 0 }, mode: null };
  }

  /**
   * A step of a trip into its part: on foot (also on the stop area), waiting at a stop, at the doors
   * (getting on and off), riding, by car.
   */
  _tally(a, dt) {
    // (one who comes along does what its leader does, but at a stop and on the bus, where each is for themselves)
    const of = a.state === "with" && a.with ? a.with : a;
    const p = of.person?.state;
    const part = of.state === "walking" ? "walk" : of.state === "riding" ? "ride" : of.state === "driving" ? (of.trip?.legs[of.trip.leg]?.type === "bike" ? "bike" : "car")
      : of.state === "stop" ? (p === "waiting" ? "wait" : p === "boarding" || p === "onboard" ? "doors" : "walk") : null;
    if (part) a.record.parts[part] += (dt * this.world.clock.factor) / 60;
  }

  /** The trip is over (`end`: arrived, train: left by train, home: went home instead): into today's trips and the statistics. */
  _closeRecord(a, end) {
    const r = a.record;
    a.record = null;
    if (!r) return;
    r.minutes = this._clockNow() - r.start;
    r.end = end;
    // the mode of the trip: the one chosen; a trip nobody chose for (sent home, placed) by its longest part
    r.mode ||= r.parts.car > 0 ? "car" : r.parts.bike > 0 ? "bike" : r.parts.ride + r.parts.wait > 0 ? "transit" : "walk";
    if (end === "arrived" || end === "train") this._learn(a, r);
    a.trips.push(r);
    if (a.trips.length > 12) a.trips.shift();
    this.tripLog.push({ id: a.id, name: a.name, groups: profileGroups(a.profile), profile: a.profile, ...r, plannedParts: undefined, weighed: undefined });
    if (this.tripLog.length > TRIP_LOG) this.tripLog.splice(0, this.tripLog.length - TRIP_LOG);
  }

  /**
   * A trip is over: the person and the town learn from it. The person remembers how long it took
   * against what it expected, for this way and mode, and whether it went badly: a jam (the drive
   * took `jam` times its plan or more), left behind at the stop or given up waiting, soaked on foot
   * or on the bike; a bad trip costs mood, a good one gives a little back. The town learns for the
   * hour the trip began in how long the mode's own part took against its plan (waiting and riding by
   * bus and tram, the walk, the ride by bike; of the car the road traffic learns from the drive itself).
   */
  _learn(a, r) {
    if (r.along || !r.mode || !(r.planned > 0)) return;
    const T = this.taste, clock = this.world.clock, perMin = clock.factor > 0 ? clock.factor : 12;
    const took = r.minutes / perMin, P = r.plannedParts || {}, sim = (part) => (r.parts[part] || 0) / perMin;
    const rain = this.world.weather?.on && this.world.weather.now().precipitation !== "none";
    const bad = r.mode === "car" ? (r.driveRatio ?? took / r.planned) >= T.everybody.jam
      : r.mode === "transit" ? !!(r.gaveUp || r.denied) : !!rain && sim("walk") + sim("bike") > SOAKED_MIN;
    r.bad = bad;
    if (r.way) a.memory?.learn(r.way, r.mode, took / Math.max(0.2, r.expected || r.planned), bad, T.everybody.learn);
    a.mood = Math.min(1, Math.max(0, (a.mood ?? 0.85) + (bad ? -BAD_TRIP_MOOD : GOOD_TRIP_MOOD)));
    const began = ((r.start % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES, weekend = clock.weekend(), X = this.world.experience;
    if (r.mode === "transit" && P.wait + P.ride > 0) X.learn("transit", began, weekend, (sim("wait") + sim("doors") + sim("ride")) / (P.wait + P.ride));
    else if (r.mode === "walk" && P.walk > 0.5) X.learn("walk", began, weekend, sim("walk") / P.walk);
    else if (r.mode === "bike" && P.bike > 0.2 && sim("bike") > 0) X.learn("bike", began, weekend, sim("bike") / (P.bike + (P.fixed || 0) / 2));
    // (a car that is not drawn takes what was planned: nothing to learn; one that is, the road traffic learns from)
  }

  /**
   * The shares of the modes of the trips made (the latest, `tripLog`; those that reached their
   * building or the train): of all, of one purpose, or by the hours of the day.
   * @param {{purpose?: string | null, from?: number, to?: number, long?: boolean}} [of] purpose: only trips of it;
   *   from, to: only trips that began in these hours of the day (e.g. 6, 9); long: only the ways long
   *   enough for a choice (longer than `walk_max_m`)
   * @returns {{trips: number, modes: Record<string, number>, shares: Record<string, number>, bad: Record<string, number>}}
   *   modes: trips by mode; shares: of all; bad: the share of each mode's trips that went badly
   */
  modalSplit({ purpose = null, from = 0, to = 24, long = false } = {}) {
    const modes = Object.fromEntries(MODE_KEYS.map((m) => [m, 0])), bad = { ...modes };
    let trips = 0;
    for (const r of this.tripLog) {
      if ((r.end !== "arrived" && r.end !== "train") || !(r.mode in modes) || (purpose && r.purpose !== purpose) || (long && !r.way)) continue;
      const h = ((r.start % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES / 60;
      if (h < from || h >= to) continue;
      modes[r.mode]++;
      if (r.bad) bad[r.mode]++;
      trips++;
    }
    const share = (n, of) => (of > 0 ? Math.round((n / of) * 1000) / 1000 : 0);
    return { trips, modes, shares: Object.fromEntries(MODE_KEYS.map((m) => [m, share(modes[m], trips)])), bad: Object.fromEntries(MODE_KEYS.map((m) => [m, share(bad[m], modes[m])])) };
  }

  /** The shares of the modes in words: "On foot 61 % · Bike 12 % · Bus and tram 9 % · Car 18 %" ("" before any trip). */
  modalWords(of = {}) {
    const split = this.modalSplit(of);
    return split.trips ? MODE_KEYS.map((m) => `${MODES[m].label} ${Math.round(split.shares[m] * 100)} %`).join(" · ") : "";
  }

  /**
   * Trips from door to door by group (core/mobility.js GROUPS: everybody, age groups, aids, luggage,
   * no licence or no car): the trips that reached their building (from home or from the train), their
   * mean minutes in all and in each part, and the share by car.
   * @returns {Array<{group: string, label: string, trips: number, minutes: number, parts: Record<string, number>, car: number}>}
   */
  tripStats() {
    const by = new Map();
    for (const r of this.tripLog) {
      if (r.end !== "arrived") continue;
      for (const g of r.groups) {
        const x = by.get(g) || { trips: 0, minutes: 0, car: 0, parts: Object.fromEntries(Object.keys(TRIP_PARTS).map((k) => [k, 0])) };
        x.trips++;
        x.minutes += r.minutes;
        if (r.parts.car > 0) x.car++;
        for (const k of Object.keys(TRIP_PARTS)) x.parts[k] += r.parts[k];
        by.set(g, x);
      }
    }
    return Object.keys(GROUPS).filter((g) => by.has(g)).map((g) => {
      const x = by.get(g), mean = (v) => Math.round((v / x.trips) * 10) / 10;
      return { group: g, label: GROUPS[g], trips: x.trips, minutes: mean(x.minutes), parts: Object.fromEntries(Object.entries(x.parts).map(([k, v]) => [k, mean(v)])), car: Math.round((x.car / x.trips) * 100) / 100 };
    });
  }

  /** The trips of the statistics as CSV (clock minutes; for the debriefing). */
  tripsCSV() {
    const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const name = (id) => (id ? this.world.getObject(id)?.name ?? id : "");
    const head = ["id", "name", "characteristics", "purpose", "from", "to", "start", "minutes", ...Object.keys(TRIP_PARTS), "end", "mode", "went badly", "with others"];
    const rows = this.tripLog.map((r) => [
      r.id, r.name, profileWords(r.profile), r.purpose, r.fromTrain ? "train" : name(r.from), r.to ? name(r.to) : "train", formatTime(r.start % DAY_MINUTES),
      r.minutes.toFixed(1), ...Object.keys(TRIP_PARTS).map((k) => (r.parts[k] || 0).toFixed(1)), r.end, r.mode ?? "", r.bad ? "yes" : "", r.along ? "yes" : "",
    ].map(q).join(","));
    return `${head.join(",")}\n${rows.join("\n")}\n`;
  }

  /** Repair agents whose stop, vehicle or building disappeared. */
  _sanity() {
    const transit = this.world.transit;
    const buses = new Set(transit?.buses || []);
    // the ids of the objects there are, once (most agents are inside a building)
    const ids = new Set();
    for (const o of this.world.objects) ids.add(o.id);
    for (const a of this.agents) {
      if (a.state === "riding") {
        // the bus is gone (line deleted or changed, out of service) or the agent is not on board
        const rider = a.vehicle?.riders?.find?.((r) => r.agent === a);
        if (!a.vehicle || (transit && !buses.has(a.vehicle)) || !rider) {
          if (a.with) Object.assign(a, { state: "with", vehicle: null, apart: true });
          else this._finishTrip(a);
        } else if (!a.with) this._checkRide(a, rider);
      } else if (a.state === "inside" && a.inside && !ids.has(a.inside)) {
        this._goHome(a);
      } else if (a.state === "stop" && !a.person && !a.trip && !a.with) {
        this._goHome(a);
      } else if (a.state === "driving" && a.vehicleOwn && !this._onTheRoad(a)) {
        // its car or bike is gone (the streets changed, the simulation was switched off): there now
        this._ownArrived(a, a.trip?.legs[a.trip.leg]);
      } else if (a.state === "with" || a.with) {
        // its leader is no more on the way with it
        const lead = a.with;
        if (!lead || lead.party !== a.party || !lead.trip || !this._byId?.has(lead.id)) {
          const to = lead?.trip?.dest ?? a.house?.building ?? null;
          this._removeAgents(new Set([a]));
          this._alone(a);
          a.state = "walking";
          this._setInside(a, to);
        }
      }
    }
  }

  /** Is the car or the rider a person is in or on still on the streets? */
  _onTheRoad(a) {
    const v = a.vehicleOwn;
    return !!v && (this._sim("traffic")?.cars?.includes(v) || this._sim("cycling")?.riders?.includes(v));
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
      if (!this._onFoot(a)) continue;
      // the walk is on the sidewalks already (RoadNetwork.walkLine)
      const [x, y] = a.pos, dir = a.dir || [1, 0];
      if (!view.inImage(x, y, 0)) continue;
      drawPerson(view, [x, y], {
        dir, speed: a.held ? 0 : a.speed, phase: a.phase, height: a.years != null ? 1.15 + (Math.min(16, a.years) - 6) * 0.055 : (a.profile?.age === "child" ? 1.2 : 1.6) + (hashKey(a.id) % 30) / 100,
        colour: mode === "mood" ? moodColor(a.mood ?? 0.85) : a.colour, ...personLooks(this.world, a.profile),
      });
    }
  }

  /** The residents walking now, for zebra crossings and riders (core/network.js, sims/cycling.js): [{pos, dir, agent}]. */
  pedestrians() {
    if (!this.enabled) return [];
    const out = [];
    for (const a of this._walking()) {
      if (!a.pos || hiddenAt(a.path, a.s)) continue;
      out.push({ pos: a.pos, dir: a.dir || [1, 0], agent: a });
      // those who come along walk beside and behind
      for (const m of this._along(a)) if (this._onFoot(m)) out.push({ pos: m.pos, dir: m.dir || [1, 0], agent: m });
    }
    return out;
  }

  /** Is a person on foot in the picture now: walking, or walking along with its leader (not in an underpass, not off stage)? */
  _onFoot(a) {
    if (!a.pos) return false;
    if (a.state === "walking") return !hiddenAt(a.path, a.s);
    const lead = a.with;
    return a.state === "with" && !a.apart && !!lead && lead.state === "walking" && !!lead.pos && !hiddenAt(lead.path, lead.s);
  }

  /**
   * The agents walking now, in the order of `agents`. Only `_beginLeg` sets an agent walking and
   * notes it: those who walk now are among the noted ones (no need to look at all agents, most of
   * them are inside); who stopped walking, or is no agent any more, is dropped.
   */
  _walking() {
    if (this._agentIndex?.agents !== this.agents) {
      this._agentIndex = { agents: this.agents, of: new Map(this.agents.map((a, i) => [a, i])) };
      this._walkingList = null;
    }
    const of = this._agentIndex.of;
    for (const a of this._walkers) {
      if (a.state === "walking" && of.has(a)) continue;
      this._walkers.delete(a);
      this._walkingList = null;
    }
    this._walkingList ||= [...this._walkers].sort((x, y) => of.get(x) - of.get(y));
    return this._walkingList;
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
      if (!this._onFoot(a)) continue;
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
      driving: `${a.trip?.legs[a.trip.leg]?.type === "bike" ? "By bike" : "By car"}${dest ? ` to ${dest}` : ""}`,
      with: `With ${a.with?.name ?? "somebody"} ${PURPOSE_LABELS[a.purpose] ?? ""}`.trim(),
      away: "Away from the layout",
    }[a.state] || a.state;
    const rows = [["Lives", home]];
    const h = a.household;
    if (h && h.members.length > 1) rows.push(["Household", `with ${h.members.filter((m) => m !== a).map((m) => m.name).join(", ")}`]);
    if (a.years != null) rows.push(["Age", `${a.years} years`]);
    const along = this._along(a);
    if (along.length) rows.push(["Together with", along.map((m) => m.name).join(", ")]);
    if (a.job) rows.push(["Works at", name(a.job)]);
    if (a.school) rows.push(["School", name(a.school)]);
    if (a.shop) rows.push(["Shops at", name(a.shop)]);
    if (a.profile) rows.push(...profileRows(a.profile, a.speed));
    if (a.profile && a.profile.age !== "child") rows.push(["Car", h ? (h.cars ? `${h.cars} in the household${a.carAt ? ` · this one is at ${a.carAt === "road" ? "on the way" : name(a.carAt) ?? "the station"}` : ""}` : "none in the household") : a.profile.car ? "has one" : "none"]);
    rows.push(["Bike", a.bike ? (a.bikeAt ? `at ${a.bikeAt === "road" ? "on the way" : name(a.bikeAt) ?? "the station"}` : "has one") : "none"]);
    if (a.mood != null && a.mood < 0.8) rows.push(["Mood", `${Math.round(a.mood * 100)} %${a.trips?.length && a.trips[a.trips.length - 1].bad ? ": the last trip went badly" : ""}`]);
    const today = (a.plan || []).map((step, i) => {
      const to = step.to.kind === "building" ? ` (${name(step.to.id)})` : step.to.kind === "shop" ? " (the nearest shop)" : "";
      const who = step.with?.length ? `, with ${step.with.map((id) => this._byId?.get(id)?.name).filter(Boolean).join(", ")}` : step.led && !step.alone ? ", taken along" : "";
      return `${i < a.next ? "✓ " : ""}${formatTime(step.at)} ${PURPOSE_LABELS[step.purpose] ?? step.purpose}${to}${who}`;
    });
    const related = [a.house?.building, a.trip?.dest].filter((id) => id && this.world.getObject(id));
    // the trips of today from door to door, in their parts
    const minutes = (m) => `${Math.round(m)} min`;
    const trips = (a.trips || []).map((r) => {
      const parts = Object.entries(TRIP_PARTS).filter(([k]) => r.parts[k] >= 0.5).map(([k, w]) => `${w} ${minutes(r.parts[k])}`);
      return [`${formatTime(r.start % DAY_MINUTES)} ${PURPOSE_LABELS[r.purpose] ?? r.purpose}: ${minutes(r.minutes)}${r.bad ? " (it went badly)" : ""}`, ...parts].join(" · ");
    });
    // what it weighed for the trip it is on (or the last one), and what it has learned of its ways
    const perMin = this.world.clock.factor > 0 ? this.world.clock.factor : 12;
    const weighed = (a.record ?? a.trips?.[a.trips.length - 1])?.weighed;
    const chose = weighed ? weighed.map((o) => `${MODES[o.mode].label} ${minutes(o.minutes * perMin)}${o.mode === (a.record ?? a.trips[a.trips.length - 1]).mode ? " (taken)" : ""}`) : [];
    const learned = [];
    for (const m of MODE_KEYS) {
      let n = 0, ratio = 0, bad = 0;
      for (const way of a.memory?.ways.values() || []) {
        const x = way.modes[m];
        if (!x) continue;
        n += x.n;
        ratio += x.n * x.ratio;
        bad += x.n * x.bad;
      }
      if (n) learned.push(`${MODES[m].label}: ${n} ${n === 1 ? "trip" : "trips"}, ${Math.round((100 * ratio) / n)} % of the time expected${bad / n > 0.3 ? ", often badly" : ""}`);
    }
    return {
      title: a.name,
      subtitle: `Town · ${this._roleLabel(a)}`,
      status: doing,
      rows,
      sections: [
        ...(today.length ? [{ title: "Today", lines: today }] : []), ...(trips.length ? [{ title: "Door to door", lines: trips }] : []),
        ...(chose.length > 1 ? [{ title: "Weighed for this way", lines: chose }] : []), ...(learned.length ? [{ title: "Learned on its ways", lines: learned }] : []),
      ],
      related,
    };
  }

  _roleLabel(a) {
    if (a.role === "visitor") return VISIT_LABELS[a.visit] ?? ROLE_LABELS.visitor;
    if (a.role === "commuter" && a.visit === "school") return "pupil, goes to school elsewhere (train)";
    return ROLE_LABELS[a.role] ?? a.role;
  }

  /** The town's people by their mood (it drops when a bike comes too close on the sidewalk). */
  states() {
    const items = this.agents.map((a) => ({ name: a.name, score: a.mood ?? 0.85, text: `mood ${Math.round((a.mood ?? 0.85) * 100)} %`, key: `resident:${a.id}` }));
    return [{ id: "residents", label: "Residents", measure: "mood", items }];
  }

  /**
   * Counts for the panel: where people are and what they are doing (`driving`: by car, `cycling`: by
   * bike, `together`: of them all, those who go along with another), the
   * captive ones (`captive`: adults and old people without a licence or a car) and how many times one of
   * them gave up waiting at a stop or found it closed (`stranded`).
   */
  townStats() {
    const out = { total: this.agents.length, home: 0, work: 0, school: 0, shopping: 0, walking: 0, waiting: 0, riding: 0, driving: 0, cycling: 0, together: 0, away: 0, captive: 0, byPurpose: {} };
    const use = (id) => {
      const o = id ? this.world.getObject(id) : null;
      return o ? (typeof o.use === "function" ? o.use() : o.constructor.use) : null;
    };
    for (const one of this.agents) {
      // (one who goes along is counted where its leader is)
      const a = one.state === "with" && one.with ? one.with : one;
      if (one !== a) out.together++;
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
      else if (one.state === "riding" || a.state === "riding") out.riding++;
      else if (a.state === "driving") out[a.trip?.legs[a.trip.leg]?.type === "bike" ? "cycling" : "driving"]++;
      else out.away++;
      if (one.profile && one.profile.age !== "child" && !canDrive(one.profile)) out.captive++;
    }
    out.stranded = this.stranded;
    return out;
  }

  /** Time of day as text (for messages). */
  timeLabel() {
    return formatTime(this.world.clock.minutes);
  }
}

/** The place a key of the road network stands for, as the town names where a car or a bike is: a building's id, or "area:<id>" for a stop. */
function placeOf(key) {
  if (typeof key !== "string") return null;
  const i = key.lastIndexOf(":");
  if (key.startsWith("building:")) return key.slice(9, i > 9 ? i : undefined);
  if (key.startsWith("area:")) return key.slice(0, i > 5 ? i : undefined);
  return null;
}

export { wrapMinutes };
