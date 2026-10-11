/**
 * The journeys story (`{"type": "journeys-story"}` in the layout's `simulations`): a traveller's view
 * of the station, a walkthrough on the layout to click through, step by step.
 *
 * 1. Ada, a student, leaves home and walks to the station; 2. the departure board, her plan: RB 31 to
 *    Talsee, there the RE 3 to Altstadt; 3. she waits on the platform, its display shows her train.
 * 4. RB 31 is late (the platform shows it); 5. her travel app: the connection in Talsee is lost;
 *    6. it finds a bus from the bus station.
 * 7. She walks to the bus station; 8. the bus comes and leaves with her; 9. meanwhile the late RB 31
 *    comes in, other travellers get off and on.
 * 10. Her journey in numbers (planned, real, had she waited); 11. her rights as a passenger.
 *
 * Everything is scripted (core/story.js): the picture is a function of the step and of how far its
 * animation has run, so Back, Next and a jump to a step always show the same. The late train's
 * platform track and the bus's bay are kept free for the story's own train and bus (a "kept-free"
 * disruption): the timetable's vehicles keep off them, and the platform shows the delay. When the
 * story's train or bus comes in, stands and leaves, it tells the world as the services do
 * (`vehicle.arrived`, …): the passengers waiting there get on, others get off. Each step sets the
 * world's clock to its time when the clock is more than five minutes away. Lines, times and places
 * beyond the layout are invented (JOURNEY_PLAN). The exercise with travellers made by hand
 * (`{"type": "journeys"}`, simulation.js) is not used.
 * @module arail/journeys/story
 */
import { Story } from "../core/story.js";
import { formatTime } from "../core/clock.js";
import { CD, CD_LIGHT, OVERLAY, PALETTE, grey, mix, rgba, shade } from "../core/colors.js";
import { dockOf } from "../core/disruptions.js";
import { polylineAt, polylineLengths, polylineProject } from "../core/math.js";
import { hiddenAt, joinPaths } from "../core/network.js";
import { Vehicle } from "../core/services.js";
import { boxFaces } from "../core/transit.js";
import { drawPerson } from "../sims/passengers.js";
import { placePoint, walkPath } from "./planner.js";

/**
 * The timetable of the story in clock minutes after midnight (lines, times and the places beyond
 * the layout are invented): RB 31 Bergheim – Neustadt – Talsee, the RE 3 Talsee – Altstadt every
 * hour, the express bus 270 (PlusBus) Neustadt – Altstadt; the minutes she needs to change in
 * Talsee; when she leaves home, the delay is announced and her exam begins.
 */
export const JOURNEY_PLAN = Object.freeze({
  leave: 450, announced: 458, exam: 570, change: 3,
  rb: Object.freeze({ line: "RB 31", to: "Talsee", dep: 462, arr: 484 }),
  re: Object.freeze({ line: "RE 3", to: "Altstadt", dep: 490, arr: 526, every: 60 }),
  bus: Object.freeze({ line: "270", to: "Altstadt", at: 467, dep: 468, arr: 538 }),
  /** Another departure on the board: from another platform. */
  other: Object.freeze({ line: "S 1", to: "Waldau", dep: 466 }),
});

/** Share of the fare paid back (%) for a delay at the destination (min): 25 % from 60, 50 % from 120 (Fahrgastrechte). */
export function refundShare(lateMin) {
  return lateMin >= 120 ? 50 : lateMin >= 60 ? 25 : 0;
}

/**
 * Her journey with the train `delay` minutes late (clock minutes): the train's new times, whether the
 * connection is lost, the RE she would have waited for and how late she would have been, the bus.
 * @param {number} delay minutes
 * @param {object} [plan] JOURNEY_PLAN
 */
export function journeyTimes(delay, plan = JOURNEY_PLAN) {
  const d = Math.max(0, Math.round(+delay || 0));
  const late = { dep: plan.rb.dep + d, arr: plan.rb.arr + d };
  // the first RE that leaves Talsee after the late train is in, with the minutes to change
  const n = Math.max(0, Math.ceil((late.arr + plan.change - plan.re.dep) / plan.re.every));
  const wait = { dep: plan.re.dep + n * plan.re.every, arr: plan.re.arr + n * plan.re.every };
  const waitLate = wait.arr - plan.re.arr, busLate = plan.bus.arr - plan.re.arr;
  return { delay: d, late, lost: n > 0, wait, waitLate, busLate, refund: refundShare(waitLate) };
}

/**
 * The disruption with which the story keeps a platform track or a bus bay free for its own train or
 * bus: the timetable's vehicles keep off it (one standing there leaves). The stop shows the message
 * (the late train's); a bay kept for the bus says nothing.
 */
export const JOURNEY_DISRUPTIONS = [
  {
    type: "kept-free",
    label: "Kept free",
    description: "One track of a platform or one bay of a bus station is kept free for the train or bus of a story (the journeys story's late train and its bus): the timetable's vehicles keep off it; the stop shows the message, if there is one.",
    targets: "track",
    hidden: true,
    params: [{ key: "text", label: "Message", type: "text", default: "" }],
    duration: () => null,
    appliesTo: (area, d) => !!dockOf(area, d.target),
    effects: (d) => ({ closed: true, messages: d.params.text ? [String(d.params.text)] : [] }),
  },
];

/**
 * The traveller: taller and stouter than the other people, in Brillantblau (no waiting passenger has
 * it: their mood runs from Rot over Gelb to Türkis), in a ring and with her name in Orange, the CD's
 * accent: she is found at once.
 */
const TRAVELLER = { body: CD.brillantblau, legs: CD.dunkelblau, height_m: 2.8, girth: 1.9, ring_m: 2 };
/** Her bus: 12 m, in the yellow of the town's buses with a stripe in the colour of its line. */
const BUS = { length_m: 12, width_m: 2.55, colour: CD.tuerkis };
/** The vehicles' phases in their order (`gone`: it has left). */
const PHASES = [null, "arriving", "dwelling", "departing", "gone"];
/** Minutes the world's clock may be away from the time of a step before the step sets it. */
const CLOCK_SLACK_MIN = 5;
/** The time of each step (clock minutes) from the plan and her journey (journeyTimes). */
const STEP_CLOCK = {
  home: (p) => p.leave, board: (p) => p.leave + 2, platform: (p) => p.leave + 3, late: (p) => p.announced, connection: (p) => p.announced + 1,
  alternative: (p) => p.announced + 2, walk: (p) => p.announced + 2, bus: (p) => p.bus.at - 3, train: (p, tm) => tm.late.dep - 2, arrive: (p) => p.bus.arr, rights: (p) => p.bus.arr,
};

/** 0…1 → a share of k from a to b (0 before a, 1 after b). */
const part = (k, a, b) => Math.min(1, Math.max(0, (k - a) / Math.max(1e-9, b - a)));
const lower = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const upper = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** The index of a step by its id. */
const stepAt = (id) => JourneyStory.STEPS.findIndex((s) => s.id === id);

export class JourneyStory extends Story {
  static type = "journeys-story";
  static label = "Journeys story (a traveller)";
  static description = "A walkthrough to click through: Ada walks to the station, her train is late and her connection lost, her app finds a bus; her journey in numbers and her rights as a passenger.";
  static params = [
    { key: "traveller", label: "Traveller", type: "text", default: "Ada", help: "Her name." },
    { key: "home", label: "Home", type: "object", default: "plattenbau-1", help: "The building she leaves from (one with an entrance)." },
    { key: "track", label: "Track of her train", type: "object", objectType: "track", default: "track-g1", help: "A track at a platform: her train leaves there; it is kept free for her train from when she waits on the platform." },
    { key: "bus_terminal", label: "Bus station", type: "object", objectType: "bus-terminal", default: "bus-terminal-1", help: "Her bus stops at its last bay." },
    { key: "bus_street", label: "Street of the bus", type: "object", objectType: "road", default: "road-marktstrasse", help: "Her bus comes in and leaves by the end of this street at the edge of the layout." },
    {
      key: "delay_min", label: "Delay of her train", type: "number", unit: "min", min: 10, max: 90, step: 1, default: 20,
      help: "The times in the texts, the RE she would wait for and the share of her fare paid back follow it.",
    },
  ];

  static STEPS = [
    {
      id: "home", title: "{Traveller} sets off", seconds: 16,
      text: "{Traveller}, a student, leaves her flat in {home} at {leave} and walks to the station. Her exam in Altstadt begins at {exam}.",
    },
    {
      id: "board", title: "The departure board", seconds: 4,
      text: "In {station} the departure board (Abfahrtstafel) shows her train: RB 31 to Talsee at {dep} from {platform}. Her plan: in Talsee she changes to the RE 3 at {re} and is in Altstadt at {arr}.",
    },
    {
      id: "platform", title: "On {platform}", seconds: 12,
      text: "She takes the underpass to {platform}. The display there (Zugzielanzeiger) shows RB 31 to Talsee at {dep}: on time.",
    },
    {
      id: "late", title: "RB 31 is {delay} minutes late", seconds: 4,
      text: "At {announced} the display changes, and an announcement follows: RB 31 is about {delay} minutes late because of a level crossing fault near Bergheim (Störung an einem Bahnübergang). It will leave at {expDep}.",
    },
    {
      id: "connection", title: "The connection in Talsee is lost", seconds: 4,
      text: "Her travel app does the sums: RB 31 reaches Talsee at {expTalsee}, but the RE 3 leaves at {re}. The next one would bring her to Altstadt at {waitArr}, {waitLate} minutes late: after the start of her exam.",
    },
    {
      id: "alternative", title: "Her app finds a bus", seconds: 4,
      text: "It offers the express bus {busLine} (PlusBus) from {busStation} at {bus}, in Altstadt at {busArr}. Her ticket of the transport association (Verbundfahrkarte) is valid on the bus too.",
    },
    {
      id: "walk", title: "To the bus station", seconds: 18,
      text: "{Traveller} goes back through the underpass and along the street to {busStation}, {bay}: four minutes on foot.",
    },
    {
      id: "bus", title: "Bus {busLine} leaves with {Traveller}", seconds: 32,
      text: "The bus pulls in at {bay} at {busAt}. {Traveller} gets on with the other travellers, and at {bus} it leaves for Altstadt.",
    },
    {
      id: "train", title: "Meanwhile: RB 31 comes in", seconds: 24,
      text: "At {expDep}, {delay} minutes late, RB 31 stops at {track}. Travellers get off and on; whoever changes in Talsee now waits there for the next RE 3.",
    },
    {
      id: "arrive", title: "{Traveller} in Altstadt: her journey in numbers", seconds: 4,
      text: "Planned: {dep} to {arr} by train. Real: {bus} to {busArr} by bus, {busLate} minutes late and in time for her exam. Had she waited for RB 31, she would have arrived at {waitArr}, {waitLate} minutes late.",
    },
    {
      id: "rights", title: "Her rights as a passenger", seconds: 4,
      text: "What counts is the delay at her destination, a missed connection included (Fahrgastrechte): from 20 minutes she may take another train; from 60 minutes she gets 25 % of the fare back, from 120 minutes 50 %. Had she waited, {refund}. The transport association adds its mobility guarantee (Mobilitätsgarantie): from 20 minutes, a taxi up to 30 €.",
    },
  ];

  constructor(world, config = {}) {
    super(world, config);
    this._paths = new Map();
    /** The story's train and bus as vehicles of the services (for the events and the train's drawing). */
    this._vehicles = {};
  }

  /* ---------------------------------------------------------------- the people, places and times of the story */

  /** The traveller's name. */
  get traveller() {
    return String(this.config.traveller ?? "").trim() || "Ada";
  }

  /** Her journey with the delay of the settings (journeyTimes). */
  get times() {
    return journeyTimes(this.config.delay_min ?? 20);
  }

  /** The building she lives in: the settings', else the first building with an entrance. */
  home() {
    const ok = (o) => !!o?.geometry && o.type !== "station-building" && typeof o.entrances === "function" && o.entrances().length > 0;
    const o = this.world.getObject(this.config.home);
    return ok(o) ? o : this.world.objects.find(ok) ?? null;
  }

  /** The platform track (dock) of a track name: `{area, dock}`, or null. */
  _dockOf(trackId) {
    if (!trackId) return null;
    for (const area of this.world.stopAreas()) {
      if (area.kind !== "rail") continue;
      const dock = area.docks.find((k) => k.track === trackId);
      if (dock) return { area, dock };
    }
    return null;
  }

  /** Her train's platform track: `{area, dock, track}` (the settings' track, else the first track at a platform), or null. */
  dock() {
    const own = this.world.getObject(this.config.track);
    const tracks = this.world.objects.filter((o) => o.type === "track" && o.geometry && o.spec.track_id);
    for (const t of [own, ...tracks]) {
      if (t?.type !== "track") continue;
      const d = this._dockOf(t.spec.track_id);
      if (d) return { ...d, track: t };
    }
    return null;
  }

  /** The station building nearest to her platform, or null. */
  station() {
    const d = this.dock();
    if (!d) return null;
    const mid = d.area.toLayout(d.area.L / 2, 0);
    const all = this.world.objects.filter((o) => o.type === "station-building" && o.geometry && o.entrances?.().length);
    const far = (o) => Math.hypot(o.entrances()[0].pos[0] - mid[0], o.entrances()[0].pos[1] - mid[1]);
    return all.sort((a, b) => far(a) - far(b))[0] ?? null;
  }

  /**
   * The bus station and the bay of her bus: `{terminal, area, dock}` (its last bay: the first ones
   * belong to the bus lines that serve the station, if there are any), or null.
   */
  bay() {
    const own = this.world.getObject(this.config.bus_terminal);
    const terminal = own?.type === "bus-terminal" && own.geometry ? own : this.world.objects.find((o) => o.type === "bus-terminal" && o.geometry);
    const area = terminal ? this.world.stopAreas().find((a) => a.owner === terminal) : null;
    const dock = area?.docks[area.docks.length - 1];
    return dock ? { terminal, area, dock } : null;
  }

  /** The steps with the names of the layout's objects and the times of her journey in their texts. */
  get steps() {
    const home = this.home(), d = this.dock(), st = this.station(), b = this.bay(), tm = this.times, plan = JOURNEY_PLAN;
    const name = (o, fallback) => o?.spec?.name || o?.name || fallback;
    const platform = d ? lower(d.area.owner?.name || "the platform") : "the platform";
    const words = {
      Traveller: this.traveller, home: name(home, "town"), station: name(st, "the station"), platform, Platform: upper(platform),
      track: d ? (d.track.spec.track_id ? `track ${d.track.spec.track_id}` : lower(name(d.track, "the track"))) : "its track",
      busStation: name(b?.terminal, "the bus station"), bay: lower(b?.dock.label || "its bay"),
      leave: formatTime(plan.leave), announced: formatTime(plan.announced), exam: formatTime(plan.exam),
      dep: formatTime(plan.rb.dep), re: formatTime(plan.re.dep), arr: formatTime(plan.re.arr), delay: tm.delay,
      expDep: formatTime(tm.late.dep), expTalsee: formatTime(tm.late.arr), waitArr: formatTime(tm.wait.arr), waitLate: tm.waitLate,
      bus: formatTime(plan.bus.dep), busAt: formatTime(plan.bus.at), busArr: formatTime(plan.bus.arr), busLate: tm.busLate, busLine: plan.bus.line,
      refund: tm.refund ? `she would have got ${tm.refund} % of her fare back` : "she would have got nothing back",
    };
    const fill = (s) => String(s ?? "").replace(/\{(\w+)\}/g, (m, k) => (k in words ? String(words[k]) : m));
    return super.steps.map((s) => ({ ...s, title: fill(s.title), text: fill(s.text) }));
  }

  /* ---------------------------------------------------------------- the scene */

  compose(index, k) {
    const i = index, id = this.constructor.STEPS[index]?.id, d = this.dock(), b = this.bay(), tm = this.times;
    const scene = { step: id, k, focus: [], disruptions: [], ada: null, phone: null, board: null, display: null, train: null, bus: null, route: null, card: null };
    // the traveller: walking, standing, getting on the bus, on it; from the train's arrival on, beyond the layout
    if (id === "home") scene.ada = { walk: "station", u: part(k, 0.04, 0.96) };
    else if (id === "board") scene.ada = { at: "station" };
    else if (id === "platform") scene.ada = { walk: "platform", u: part(k, 0.04, 0.96) };
    else if (id === "walk") scene.ada = { walk: "bus", u: part(k, 0.04, 0.96) };
    else if (id === "bus") scene.ada = k < 0.41 ? { at: "bay" } : k < 0.5 ? { walk: "board", u: part(k, 0.41, 0.5) } : k < 1 ? { on: "bus" } : null;
    else if (i > stepAt("platform") && i < stepAt("walk")) scene.ada = { at: "spot" };
    // her phone: the plan, the lost connection, the bus
    if (id === "board") scene.phone = "plan";
    else if (id === "connection") scene.phone = "lost";
    else if (id === "alternative") scene.phone = "bus";
    else if (id === "walk" || (id === "bus" && k < 0.41)) scene.phone = "go";
    // the departure board in the station, the display on the platform
    if (i >= stepAt("board") && i <= stepAt("walk")) scene.board = { late: i >= stepAt("late") };
    // the late train: coming in, standing (doors open), leaving
    if (id === "train") {
      const phase = k < 0.12 ? null : k < 0.42 ? "arriving" : k < 0.8 ? "dwelling" : k < 1 ? "departing" : "gone";
      scene.train = { phase, progress: phase === "arriving" ? part(k, 0.12, 0.42) : phase === "departing" ? part(k, 0.8, 1) : 1 };
    }
    if (i >= stepAt("platform") && i <= stepAt("train") && scene.train?.phase !== "departing" && scene.train?.phase !== "gone") {
      scene.display = { late: i >= stepAt("late"), boarding: scene.train?.phase === "dwelling" };
    }
    // her bus: coming in over the streets, at the bay (doors open), leaving
    if (id === "bus") {
      const phase = k < 0.36 ? "arriving" : k < 0.58 ? "dwelling" : k < 1 ? "departing" : "gone";
      scene.bus = { phase, u: phase === "arriving" ? part(k, 0, 0.36) : phase === "departing" ? part(k, 0.58, 1) : 1, doors: k >= 0.38 && k < 0.56 };
    }
    // her platform track is kept for her train from when she is on the platform (no other train in front
    // of her), and while it is late the platform shows it; the bay is kept for the bus
    if (d && i >= stepAt("platform") && i <= stepAt("train")) {
      const ph = scene.train?.phase, rb = `${JOURNEY_PLAN.rb.line} to ${JOURNEY_PLAN.rb.to}`;
      const text = i < stepAt("late") ? "" : ph === "arriving" ? `${rb} arriving, ${tm.delay} min late` : ph === "dwelling" ? `${rb} boarding, ${tm.delay} min late`
        : ph === "departing" || ph === "gone" ? "" : `${rb} about ${tm.delay} min late`;
      scene.disruptions.push({ id: "late", type: "kept-free", target: d.dock.id, params: { text } });
    }
    if (b && (id === "walk" || id === "bus")) scene.disruptions.push({ id: "bay", type: "kept-free", target: b.dock.id, params: { text: "" } });
    // the app's way to the bus; her whole way at the end; the cards
    if (id === "alternative") scene.route = "plan";
    if (id === "arrive" || id === "rights") {
      scene.route = "trace";
      scene.card = id;
    }
    const home = this.home(), st = this.station();
    if (id === "home" && home) scene.focus.push(home.id);
    else if (id === "board" && st) scene.focus.push(st.id);
    else if ((i >= stepAt("platform") && i <= stepAt("alternative")) || id === "train") {
      if (d?.area.owner) scene.focus.push(d.area.owner.id);
    } else if ((id === "walk" || id === "bus") && b) scene.focus.push(b.terminal.id);
    return scene;
  }

  /* ---------------------------------------------------------------- the ways */

  /** The network of the streets, or null. */
  _net() {
    try {
      return this.world.network?.() ?? null;
    } catch {
      return null;
    }
  }

  /** Cached until the layout changes: `make()` once per key. */
  _cached(key, make) {
    const k = `${this.world.objectsVersion}:${this.world.map.version}:${key}`;
    if (!this._paths.has(k)) {
      this._paths.set(k, make());
      if (this._paths.size > 40) this._paths.delete(this._paths.keys().next().value);
    }
    return this._paths.get(k);
  }

  /**
   * Where she goes (cached until the layout changes): her places (`points`: at the station, her spot
   * on the platform, at the bay; `dirs`: which way she looks there) and her walks (`walks`: to the
   * station, to the platform, to the bus station, onto the bus), each `{points, lengths, length,
   * hidden}` (`hidden`: the parts out of sight, in the underpass). Null without her home, her
   * platform or the bus station.
   */
  places() {
    const home = this.home(), d = this.dock(), b = this.bay();
    if (!home || !d || !b) return null;
    return this._cached(`places:${home.id}:${d.dock.id}:${b.dock.id}:${this.config.bus_street ?? ""}`, () => {
      const world = this.world, st = this.station();
      const from = placePoint(world, { kind: "building", id: home.id });
      const entry = st ? placePoint(world, { kind: "building", id: st.id }) : null;
      // her spot two thirds along the platform, away from the edge of her track; at the bay, behind its
      // front door at the back of the waiting area (the bus at the curb would hide her)
      const spot = d.area.toLayout(d.area.L * 0.68, -d.dock.side * Math.min(0.6, d.area.W * 0.2));
      const bayAt = b.area.toLayout(b.dock.s1 - 4.5, -b.dock.side * (b.area.W / 2 - 0.6));
      // to the station's entrance, where she stops to read the board (before the way goes out of sight)
      const toStation = trimHidden(walkPath(world, from, entry ?? { pos: spot }));
      const stand = toStation.points[toStation.points.length - 1];
      const toPlatform = walkPath(world, entry ?? { pos: stand }, { pos: spot });
      // back the way she came, then on from the station (a walk from her spot would be out of sight from its start)
      const toBus = entry ? joinWalks(reverseWalk(toPlatform), walkPath(world, entry, { pos: bayAt })) : walkPath(world, { pos: spot }, { pos: bayAt });
      const bus = this.busPath(), door = bus ? doorOf(bus.pose, world.scale) : bayAt;
      const board = { ...straight(bayAt, door), hidden: [] };
      const look = (a, c) => [c[0] - a[0], c[1] - a[1]];
      return {
        points: { station: stand, spot, bay: bayAt },
        dirs: { station: entry ? look(stand, entry.pos) : [1, 0], spot: d.area.dir, bay: b.area.dir },
        walks: { station: toStation, platform: toPlatform, bus: toBus, board },
      };
    });
  }

  /**
   * The way of her bus (cached until the layout changes): over the streets from the edge of the
   * layout (the end of the bus's street, else the end nearest to the bus lane's start), through the
   * lane to her bay and back to that end (else to the end nearest to the lane's end); its driving
   * line (`points`, `lengths`, `length`), where the bus's front stands at the bay (`stop`, mm along
   * it) and its pose there (`pose`). Without streets, along the bay. Null without a bay.
   */
  busPath() {
    const b = this.bay();
    if (!b) return null;
    return this._cached(`bus:${b.dock.id}:${this.config.bus_street ?? ""}`, () => {
      const net = this._net(), stop = net?.dock(b.dock.id);
      const len = (BUS.length_m * 1000) / this.world.scale;
      const pose = stop?.pose ?? { front: b.area.toLayout(b.dock.s1 - 1.5, b.dock.side * (b.area.W / 2 + 1.7)), dir: b.area.dir };
      let points = null;
      const lane = b.terminal.busLane?.();
      if (stop && lane) {
        // the ends of the streets at the edge of the layout, nearest to a point or to the bus's street first
        const street = this.world.getObject(this.config.bus_street);
        const far = (p) => (n) => (street?.type === "road" && street.geometry?.points ? polylineProject(street.geometry.points, n.pos).distance : 0) * 1e6 + Math.hypot(n.pos[0] - p[0], n.pos[1] - p[1]);
        const near = (p) => net.boundaryNodes().filter((n) => n !== stop.node).map((n) => [far(p)(n), n]).sort((x, y) => x[0] - y[0]).map(([, n]) => n);
        const out = near(lane.points[lane.points.length - 1]).map((n) => [n, net.routeDirected(stop.node, stop.dir, n, null, { mode: "bus" })]).find(([, r]) => r);
        const inn = near(lane.points[0]).map((n) => [n, net.routeDirected(n, null, stop.node, stop.dir, { mode: "bus" })]).find(([, r]) => r);
        if (out && inn) points = net.drivingLine(joinPaths([inn[1], out[1]])).points;
      }
      // no streets: it comes in and goes on along the bay
      if (!points) points = [-1, 1].map((sgn) => [pose.front[0] + pose.dir[0] * sgn * 6 * len, pose.front[1] + pose.dir[1] * sgn * 6 * len]);
      const lengths = polylineLengths(points);
      return { points, lengths, length: lengths[lengths.length - 1], stop: polylineProject(points, pose.front, lengths).s, pose, bus: len };
    });
  }

  /* ---------------------------------------------------------------- where the traveller, the bus and the train are */

  /**
   * Where the traveller is: `{point, dir, walking, hidden, where}` (`hidden`: out of sight, `where`
   * says where), or null while she is not on the layout.
   */
  adaAt() {
    const a = this.scene?.ada, p = this.places();
    if (!a || !p) return null;
    if (a.walk) {
      const w = p.walks[a.walk], s = a.u * w.length, q = polylineAt(w.points, s, w.lengths);
      const hidden = hiddenAt(w, s);
      return { point: q.point, dir: q.dir, walking: a.u > 0 && a.u < 1, hidden, where: hidden ? (w.offstage ? "on her way" : "in the underpass") : null };
    }
    if (a.at) return { point: p.points[a.at], dir: p.dirs[a.at], walking: false, hidden: false, where: null };
    const bus = this.busAt();
    return bus ? { point: [(bus.front[0] + bus.rear[0]) / 2, (bus.front[1] + bus.rear[1]) / 2], dir: bus.dir, walking: false, hidden: true, where: `on bus ${JOURNEY_PLAN.bus.line}` } : null;
  }

  /** Her bus: `{front, rear, dir, s, doors}` on its way, at the bay or leaving; null while it is away. */
  busAt() {
    const sc = this.scene?.bus, path = this.busPath();
    if (!sc || !path || !sc.phase || sc.phase === "gone") return null;
    const s0 = Math.min(path.stop, path.bus);
    // at a steady speed, braking for the bay and pulling away from it
    const s = sc.phase === "arriving" ? s0 + (path.stop - s0) * (1 - cruise(1 - sc.u))
      : sc.phase === "dwelling" ? path.stop : path.stop + (path.length - path.stop) * cruise(sc.u);
    const f = polylineAt(path.points, s, path.lengths), r = polylineAt(path.points, s - path.bus, path.lengths);
    return { front: f.point, rear: r.point, dir: f.dir, s, doors: !!sc.doors };
  }

  /** The story's vehicle of a kind at a dock (one per kind, kept while its dock stays); the train with its delay. */
  _vehicle(kind, dock) {
    let v = this._vehicles[kind];
    const plan = JOURNEY_PLAN;
    if (!v || v.dock.id !== dock.id) {
      v = kind === "train" ? new Vehicle({ kind: "train", dock, line: `${plan.rb.line} ${plan.rb.to}`, source: "story" }) : new Vehicle({ kind: "bus", dock, line: plan.bus.line, source: "story" });
      this._vehicles[kind] = v;
    }
    v.dock = dock;
    if (kind === "train") {
      v.delayMin = this.times.delay;
      v.info = [`+${v.delayMin} min`];
    }
    return v;
  }

  /** Her train as a vehicle of the services at its platform track (its phase and progress from the step), or null. */
  trainAt() {
    const sc = this.scene?.train, d = this.dock();
    if (!sc?.phase || sc.phase === "gone" || !d) return null;
    const v = this._vehicle("train", d.dock);
    v.phase = sc.phase;
    v.progress = sc.progress;
    return v;
  }

  /**
   * Where to look in the current step (the app's flyover follows it): `{at, distance, pitch_deg}`
   * (layout mm): the traveller on her way and where she waits, the bus, the train; at the end her
   * whole way from above.
   */
  view() {
    const sc = this.scene, p = this.places();
    if (!sc || !p) return null;
    const ada = this.adaAt();
    if (sc.step === "bus") {
      const bus = this.busAt();
      if (bus && sc.bus.phase !== "dwelling") return { at: bus.front, distance: 1300, pitch_deg: 58 };
      return { at: p.points.bay, distance: 800, pitch_deg: 58 };
    }
    // the train from above: the trains at the platforms in front would hide it
    if (sc.step === "train") {
      const d = this.dock();
      return d ? { at: d.area.toLayout(d.area.L * 0.8, 0), distance: 1400, pitch_deg: 62 } : null;
    }
    if (sc.route === "plan") return { at: mid(p.points.spot, p.points.bay), distance: 2300, pitch_deg: 64 };
    if (sc.card) return { at: mid(p.points.station, p.points.bay), distance: 3000, pitch_deg: 62 };
    // close to her, so that she is large; her track is kept free, the trains of the platform's other
    // track are far enough in front of her not to hide her
    if (ada) return { at: ada.point, distance: ada.walking ? 750 : 600, pitch_deg: sc.step === "board" ? 46 : 50 };
    return null;
  }

  /* ---------------------------------------------------------------- the clock, and the vehicles tell the world */

  /** The time of step `index` (clock minutes): when it happens in her journey. */
  clockOf(index) {
    const id = this.constructor.STEPS[index]?.id;
    return STEP_CLOCK[id]?.(JOURNEY_PLAN, this.times) ?? null;
  }

  /**
   * Go to a step; the world's clock shows its time (it is set when it is more than a few minutes
   * away, so that it runs on between steps that follow each other).
   */
  goTo(i) {
    super.goTo(i);
    const want = this.clockOf(this.index), now = this.world.clock?.minutes;
    if (want == null || !Number.isFinite(now)) return;
    const off = Math.abs(((now - want + 720) % 1440 + 1440) % 1440 - 720);
    if (off > CLOCK_SLACK_MIN) this.world.setTime(want);
  }

  /** Run the step on; when its train or bus has come to a later phase, tell the world (once: not on a jump). */
  step(dt) {
    const before = { index: this.index, train: this.scene?.train?.phase ?? null, bus: this.scene?.bus?.phase ?? null };
    super.step(dt);
    // only while a step runs on, not on a jump: each moment once
    if (!this.active || !this.scene || before.index !== this.index) return;
    const d = this.dock(), b = this.bay();
    if (d) this._tell(this._vehicle("train", d.dock), before.train, this.scene.train?.phase ?? null);
    if (b) this._tell(this._vehicle("bus", b.dock), before.bus, this.scene.bus?.phase ?? null);
  }

  /** A vehicle of the story went on from one phase to a later one: the events of the services for each phase begun. */
  _tell(v, from, to) {
    for (let j = PHASES.indexOf(from) + 1; j <= PHASES.indexOf(to); j++) {
      if (PHASES[j] === "arriving") this._emit("vehicle.arriving", v);
      else if (PHASES[j] === "dwelling") this._emit("vehicle.arrived", v);
      else if (PHASES[j] === "departing") this._emit("vehicle.departing", v);
      else if (PHASES[j] === "gone") this._emit("vehicle.departed", v);
    }
  }

  /** An event of a vehicle at its dock, with the payload of the services' (core/services.js). */
  _emit(name, vehicle) {
    this.world.events.emit(name, { vehicle, dock: vehicle.dock, area: vehicle.dock.area });
  }

  /* ---------------------------------------------------------------- drawing */

  draw(view) {
    if (!this.active || !this.scene) return;
    const sc = this.scene, t = view.time || 0, p = this.places();
    if (!p) return;
    if (sc.route) this._drawRoute(view, p, sc.route);
    if (sc.board) this._drawBoard(view, p, sc.board);
    if (sc.display) this._drawDisplay(view, sc.display);
    const train = this.trainAt();
    if (train) {
      const place = this.world.services.placement(train);
      if (place) place.def.draw(view, train, place);
    }
    const bus = this.busAt();
    if (bus) drawBus(view, bus, this.world.settings.labels !== false);
    const ada = this.adaAt();
    if (ada) this._drawTraveller(view, ada, sc, t);
    if (sc.card) this._drawCard(view, p, sc.card);
  }

  /** The traveller: a ring on the ground, the figure (taller than the others), her name and her phone's message. */
  _drawTraveller(view, ada, sc, t) {
    const m = view.m(1), [x, y] = ada.point;
    if (!view.inImage(x, y, 0, 200)) return;
    if (!ada.hidden) {
      const ring = Array.from({ length: 24 }, (_, j) => [x + Math.cos((j * Math.PI) / 12) * TRAVELLER.ring_m * m, y + Math.sin((j * Math.PI) / 12) * TRAVELLER.ring_m * m]);
      view.polygon(ring, { fill: rgba(CD.orange, 0.28), stroke: CD.orange, width: 2.5, order: 8.5 });
      drawPerson(view, ada.point, {
        dir: ada.dir, height: TRAVELLER.height_m, girth: TRAVELLER.girth, colour: TRAVELLER.body, legs: TRAVELLER.legs, speed: ada.walking ? 1.4 : 0, phase: ada.walking ? t * 7 : 0,
      });
    }
    const z = (TRAVELLER.height_m + 0.4) * m;
    view.label([x, y, z], ada.where ? `${this.traveller} · ${ada.where}` : this.traveller, { size: 13, anchor: "bottom", background: CD.orange, order: 7 });
    const phone = this._phone(sc.phone);
    if (phone) view.label([x, y, z], phone.lines, { size: 11, anchor: "bottom", colors: [phone.colour], order: 7.5 });
  }

  /** Her phone's message: `{lines, colour}` (the first line's colour: Orange as her app, Rot for bad news, Türkis for good). */
  _phone(kind) {
    if (!kind) return null;
    const tm = this.times, plan = JOURNEY_PLAN, T = formatTime, b = this.bay();
    const bay = b?.dock.label ?? "";
    if (kind === "plan") {
      return { colour: CD_LIGHT.orange, lines: ["Her plan · Altstadt", `${T(plan.rb.dep)} ${plan.rb.line} → Talsee ${T(plan.rb.arr)}`, `${T(plan.re.dep)} ${plan.re.line} → Altstadt ${T(plan.re.arr)}`] };
    }
    if (kind === "lost") {
      return { colour: OVERLAY.alert, lines: ["Connection in Talsee lost", `${plan.rb.line} in Talsee ${T(tm.late.arr)}, ${plan.re.line} leaves ${T(plan.re.dep)}`, `Next ${plan.re.line}: in Altstadt ${T(tm.wait.arr)} (+${tm.waitLate} min)`] };
    }
    if (kind === "bus") {
      return { colour: CD_LIGHT.tuerkis, lines: ["New connection", `${T(plan.bus.dep)} Bus ${plan.bus.line}, ${b?.terminal.name ?? ""} ${bay}`.trim(), `Altstadt ${T(plan.bus.arr)} (+${tm.busLate} min) · ticket valid`] };
    }
    return { colour: CD_LIGHT.tuerkis, lines: [`Bus ${plan.bus.line} · ${T(plan.bus.dep)} · ${bay}`.trim()] };
  }

  /** The departure board (Abfahrtstafel) of the station, over its entrance: her train first, later with its delay. */
  _drawBoard(view, p, board) {
    const st = this.station(), d = this.dock(), plan = JOURNEY_PLAN, T = formatTime, tm = this.times;
    // in the hall, a third of the building's length beside its entrance (her phone's message is over her)
    const entry = st?.entrances()[0]?.pos ?? p.points.station, c = st?.anchorPoint?.() ?? entry;
    const out = [entry[0] - c[0], entry[1] - c[1]], l = Math.hypot(out[0], out[1]) || 1, side = st ? st.mm(+st.spec.length_m || 30) / 3 : 0;
    const at = [entry[0] + (out[1] / l) * side, entry[1] - (out[0] / l) * side];
    const number = (area) => area?.owner?.spec?.number || "";
    const other = this.world.stopAreas().find((a) => a.kind === "rail" && a !== d?.area);
    const lines = ["Departures (Abfahrt)", `${T(plan.rb.dep)} ${plan.rb.line} ${plan.rb.to}${board.late ? ` +${tm.delay}` : ""} · ${number(d?.area)}`];
    if (other) lines.push(`${T(plan.other.dep)} ${plan.other.line} ${plan.other.to} · ${number(other)}`);
    view.label([at[0], at[1], view.m(7)], lines, { size: 11, anchor: "bottom", colors: [OVERLAY.status, board.late ? OVERLAY.alert : null], order: 3 });
  }

  /** The display on her platform (Zugzielanzeiger) on its post beside her spot, and what it shows. */
  _drawDisplay(view, display) {
    const d = this.dock();
    if (!d) return;
    const A = d.area, m = view.m(1), s = A.L * 0.68 + 7;
    const a = A.toLayout(s - 1.4, 0), b = A.toLayout(s + 1.4, 0), c = A.toLayout(s, 0);
    if (!view.inImage(c[0], c[1], 0, 200)) return;
    view.faces([
      ...boxFaces(A.toLayout(s - 0.08, 0), A.toLayout(s + 0.08, 0), 0.16 * m, 0, 2.6 * m, { side: grey(0.35), top: grey(0.35) }),
      ...boxFaces(a, b, 0.3 * m, 2.6 * m, 3.3 * m, { side: grey(0.14), top: grey(0.22), end: grey(0.2) }),
    ], [c[0], c[1], 2.9 * m]);
    const tm = this.times, plan = JOURNEY_PLAN;
    const lines = [`${formatTime(plan.rb.dep)} ${plan.rb.line} ${plan.rb.to}`];
    if (display.boarding) lines.push(`+${tm.delay} min · boarding`);
    else lines.push(display.late ? `about ${tm.delay} min later` : "on time");
    view.label([c[0], c[1], 3.4 * m], lines, {
      size: 11, anchor: "bottom", badge: A.owner?.spec?.number || undefined, badgeColor: OVERLAY.sign, colors: [null, display.late ? OVERLAY.alert : CD_LIGHT.tuerkis], order: 4,
    });
  }

  /** Her ways: the app's way to the bus (dashed), or at the end all she walked (dashed) and rode (solid). */
  _drawRoute(view, p, route) {
    const style = { stroke: CD.orange, width: 3, dash: [7, 6], order: 8.4 };
    if (route === "plan") {
      view.line(p.walks.bus.points, style);
      return;
    }
    for (const w of ["station", "platform", "bus", "board"]) view.line(p.walks[w].points, style);
    const bus = this.busPath();
    if (bus) view.line(slice(bus.points, bus.lengths, bus.stop, bus.length), { stroke: CD.orange, width: 4, order: 8.4 });
  }

  /** The card at the end: her journey in numbers, or her rights as a passenger. */
  _drawCard(view, p, card) {
    const tm = this.times, plan = JOURNEY_PLAN, T = formatTime, at = mid(p.points.station, p.points.bay);
    const lines = card === "arrive"
      ? [`${this.traveller}: Neustadt → Altstadt`, `Planned  ${T(plan.rb.dep)} → ${T(plan.re.arr)}  ${plan.rb.line}, ${plan.re.line}`,
        `Real  ${T(plan.bus.dep)} → ${T(plan.bus.arr)}  Bus ${plan.bus.line} · +${tm.busLate} min`, `Waiting  ${T(tm.late.dep)} → ${T(tm.wait.arr)}  ${plan.rb.line}, ${plan.re.line} · +${tm.waitLate} min`]
      : ["Passenger rights (Fahrgastrechte)", "From 20 min: another train", "From 60 min: 25 % of the fare back", "From 120 min: 50 % back",
        `Waiting, +${tm.waitLate} min: ${tm.refund} % back`, "Mobility guarantee: a taxi, up to 30 €"];
    const colors = card === "arrive" ? [CD_LIGHT.orange, null, CD_LIGHT.tuerkis, OVERLAY.alert] : [CD_LIGHT.orange, null, null, null, OVERLAY.status, null];
    view.label([at[0], at[1], view.m(14)], lines, { size: 13, colors, order: 9 });
  }
}

/* ---------------------------------------------------------------- helpers */

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** The share of a way done (0…1) at time u (0…1) by a vehicle pulling away: speeding up over the first 30 %, then steady. */
function cruise(u, b = 0.3) {
  const v = 1 / (1 - b / 2);
  return u < b ? (v * u * u) / (2 * b) : v * (u - b / 2);
}

/** A straight way from a to b: `{points, lengths, length}`. */
function straight(a, b) {
  const points = [a, b], lengths = polylineLengths(points);
  return { points, lengths, length: lengths[1] };
}

/** A walk without its last part if that is out of sight (into a building, an underpass): it stops where it is still seen. */
function trimHidden(walk) {
  const last = walk.hidden?.[walk.hidden.length - 1];
  if (!last || last[1] < walk.length - 1e-6 || last[0] <= 0) return walk;
  const points = slice(walk.points, walk.lengths, 0, last[0]), lengths = polylineLengths(points);
  return { ...walk, points, lengths, length: lengths[lengths.length - 1], hidden: walk.hidden.slice(0, -1) };
}

/** A walk the other way round. */
function reverseWalk(w) {
  const points = [...w.points].reverse(), lengths = polylineLengths(points);
  return { points, lengths, length: w.length, hidden: (w.hidden || []).map(([a, b]) => [w.length - b, w.length - a]).reverse(), offstage: w.offstage };
}

/** Two walks one after the other (the second begins where the first ends). */
function joinWalks(a, b) {
  const points = [...a.points, ...b.points.slice(1)], lengths = polylineLengths(points);
  const hidden = [...(a.hidden || []), ...(b.hidden || []).map(([s0, s1]) => [s0 + a.length, s1 + a.length])];
  return { points, lengths, length: lengths[lengths.length - 1], hidden, offstage: !!(a.offstage || b.offstage) };
}

/** The part of a polyline from s0 to s1 (mm along it). */
function slice(points, lengths, s0, s1) {
  if (s1 <= s0) return [];
  const out = [polylineAt(points, s0, lengths).point];
  for (let i = 1; i < points.length - 1; i++) if (lengths[i] > s0 && lengths[i] < s1) out.push(points[i]);
  out.push(polylineAt(points, s1, lengths).point);
  return out;
}

/** The front door of a bus standing at its bay (pose: front and heading), on the side of the waiting area (left). */
function doorOf(pose, scale) {
  const m = 1000 / scale, u = pose.dir, n = [-u[1], u[0]];
  return [pose.front[0] - u[0] * 1.6 * m + n[0] * 1.5 * m, pose.front[1] - u[1] * 1.6 * m + n[1] * 1.5 * m];
}

/** The story's bus on the street or at its bay: yellow, with its line's stripe, open doors at the bay and its sign. */
function drawBus(view, bus, labels) {
  const { front, rear } = bus;
  if (!view.inImage(front[0], front[1], 0, 120) && !view.inImage(rear[0], rear[1], 0, 120)) return;
  const m = (x) => view.m(x), lit = view.darkness > 0.35;
  const len = Math.hypot(front[0] - rear[0], front[1] - rear[1]) || 1;
  const colours = { side: PALETTE.bus, top: shade(PALETTE.bus, 1.4), end: shade(PALETTE.bus, 0.9), alpha: 1 };
  const faces = boxFaces(rear, front, m(BUS.width_m), m(0.3), m(3.1), colours, (f, P, L, hw) => {
    const out = [], a = (x) => (m(x) / len) * L, Lm = len / m(1);
    if (f.side === "left" || f.side === "right") {
      const t = f.side === "left" ? hw : -hw;
      out.push({ pts: [P(a(0.6), t, m(1.3)), P(a(Lm - 1.6), t, m(1.3)), P(a(Lm - 1.6), t, m(2.7)), P(a(0.6), t, m(2.7))], color: lit ? PALETTE.litWindow : PALETTE.busWindow, emissive: lit });
      out.push({ pts: [P(a(0.3), t, m(0.75)), P(a(Lm - 0.3), t, m(0.75)), P(a(Lm - 0.3), t, m(0.95)), P(a(0.3), t, m(0.95))], color: BUS.colour });
      // the doors open on the left, towards the waiting area of the bus station
      if (f.side === "left" && bus.doors) {
        for (const d of [Lm - 1.6, Lm - 6.4]) out.push({ pts: [P(a(d - 0.6), t, m(0.3)), P(a(d + 0.6), t, m(0.3)), P(a(d + 0.6), t, m(2.8)), P(a(d - 0.6), t, m(2.8))], color: grey(0.16) });
      }
    } else if (f.side === "front") {
      out.push({ pts: [P(L, hw - m(0.2), m(1.1)), P(L, -hw + m(0.2), m(1.1)), P(L, -hw + m(0.2), m(2.6)), P(L, hw - m(0.2), m(2.6))], color: PALETTE.busWindow });
    }
    return out;
  });
  view.faces(faces, [(front[0] + rear[0]) / 2, (front[1] + rear[1]) / 2, m(1.6)]);
  if (labels) {
    const plan = JOURNEY_PLAN;
    view.label([front[0], front[1], m(4.4)], plan.bus.to, { size: 11, badge: plan.bus.line, badgeColor: mix(BUS.colour, "#000000", 0.15), order: 2 });
  }
}
