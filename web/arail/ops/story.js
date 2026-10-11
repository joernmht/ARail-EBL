/**
 * The operations story of a railway undertaking (`{"type": "ops-story"}` in the layout's
 * `simulations`): a walkthrough on the layout to click through, step by step.
 *
 * 1. A regional train boards at a platform track (RB 31 to Talsee, the two-car unit 442 101).
 * 2. The unit reports a fault of its traction converter and cannot leave; 3. the driver calls the
 *    operations control, a reset does not help, the dispatcher takes the unit out of service and
 *    sends the spare unit; 4. the passengers get off and wait across the platform.
 * 5. In the depot a stand-by driver takes the spare unit out; 6. it comes in at the platform's other
 *    track; 7. the passengers change trains and the train leaves late.
 * 8. The broken unit runs empty to the depot's workshop; 9. diagnosis and repair, and what the
 *    breakdown cost under the transport contract; 10. back to normal service the next morning.
 *
 * Everything is scripted (core/story.js): the picture is a function of the step and of how far its
 * animation has run, so Back, Next and a jump to a step always show the same. The story draws its own
 * trains, passengers, staff and the platform's display, and holds the tracks of its trains with
 * "story-train" disruptions: no timetable train comes there, and the platform shows the story's
 * messages. The depot shows the story's board (`depotState`). The rail operations simulation
 * (`{"type": "operations"}`, engine.js) is not used; the penalties are those of its default contracts.
 * @module arail/ops/story
 */
import { Story } from "../core/story.js";
import { CD, OVERLAY, PALETTE, grey, moodColor, shade } from "../core/colors.js";
import { polylineAt, polylineLengths, polylineProject } from "../core/math.js";
import { formatTime, parseTime } from "../core/clock.js";
import { boxFaces } from "../core/transit.js";
import { drawPerson } from "../sims/passengers.js";
import { hash01 } from "../objects/building-kit.js";
import { DEFAULT_CONTRACTS } from "./config.js";
import { CREW_COLOURS } from "./simulation.js";

/** A two-car electric multiple unit (class 442, prototype metres): its cars, sizes and door places (shares of a car). */
const EMU = { cars: 2, car_m: 21, gap_m: 0.6, width_m: 2.9, floor_m: 0.6, roof_m: 3.95, doors: [0.22, 0.78] };
const EMU_M = EMU.cars * EMU.car_m + (EMU.cars - 1) * EMU.gap_m;
/** Livery of the units: light grey with a red band and red cab ends. */
const LIVERY = { body: grey(0.93), roof: grey(0.66), band: CD.rot, cab: CD.rot, glass: PALETTE.trainWindow, door: PALETTE.trainDoor, closed: grey(0.74), pantograph: grey(0.2) };
/** Fitters in the workshop: an orange vest over dark blue trousers (the drivers wear yellow, CREW_COLOURS). */
const FITTER_COLOURS = { body: CD.orange, legs: CD.dunkelblau };
/** Minutes after the scheduled departure: the fault, the spare leaves the depot, stands at the platform, the train leaves. */
const AT = { fault: -1, out: 15, in: 21, leave: 25 };
/** Hours the workshop needs for the repair; minutes between two trains of the line. */
const REPAIR_H = 6, TAKT_MIN = 60;
/** The story's passengers, their walking speed (m/s) and the stand-by driver's (in a hurry). */
const PASSENGERS = 14, WALK_MPS = 1.3, HURRY_MPS = 2;
/** Metres of the lead track beyond the depot's gate end, along which its units come and go (to the edge of Bf Neustadt's table module). */
const LEAD_M = 36;
/** Mood of the passengers in each step (0 annoyed … 1 happy). */
const MOOD = { normal: 0.9, fault: 0.75, call: 0.62, alight: 0.5, spare: 0.45, arrive: 0.45, change: 0.75, back: 0.9 };

/** 0…1 → a share of k from a to b (0 before a, 1 after b). */
const part = (k, a, b) => Math.min(1, Math.max(0, (k - a) / Math.max(1e-9, b - a)));
const upper = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** Euros with a space between the thousands ("1 056 €"). */
const euros = (n) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} €`;
/** The default transport contract's penalties (the operations simulation's). */
const TRANSPORT = DEFAULT_CONTRACTS.find((c) => c.id === "transport").penalties;

export class OpsStory extends Story {
  static type = "ops-story";
  static label = "Operations story (railway undertaking)";
  static description = "A walkthrough to click through: a regional train breaks down at the platform, the operations control sends the spare unit from the depot, the passengers change trains, and the broken unit goes to the workshop.";
  static params = [
    { key: "track", label: "Track of the train", type: "object", objectType: "track", default: "track-g3", help: "A platform track: the train breaks down there." },
    { key: "spare_track", label: "Track of the spare unit", type: "object", objectType: "track", default: "track-g2", help: "Another platform track, best across the same platform: the spare unit comes in there." },
    { key: "depot", label: "Depot", type: "object", objectType: "depot", default: "depot-neustadt", help: "Where the spare unit waits and the broken one is repaired." },
    { key: "line", label: "Line", type: "text", default: "RB 31" },
    { key: "destination", label: "Destination", type: "text", default: "Talsee" },
    { key: "departure", label: "Departure", type: "text", default: "07:42", help: "The train's departure (HH:MM); the story's other times follow from it." },
    { key: "unit", label: "Unit", type: "text", default: "442 101" },
    { key: "spare", label: "Spare unit", type: "text", default: "442 108" },
    { key: "km", label: "Length of the line", type: "number", unit: "km", min: 1, max: 300, step: 1, default: 22, help: "To the destination: the train-km of the penalties." },
  ];

  static STEPS = [
    {
      id: "normal", title: "{line} to {destination} boards at {track}", seconds: 12,
      text: "Normal service: {line} to {destination}, due out at {dep}, stands at {track} of {platform}, the two-car electric multiple unit {unit}. Passengers board; the display shows the train on time.",
    },
    {
      id: "fault", title: "{unit} reports a fault", seconds: 4,
      text: "At {fault} the driver's display reports a fault of the traction converter (Stromrichter): the unit has no traction power and cannot leave. The display shows {line} delayed.",
    },
    {
      id: "call", title: "The driver calls the operations control", seconds: 12,
      text: "By train radio (GSM-R) the driver reports the fault to the operations control (Transportleitung) and tries a reset: pantograph down, the unit shut down and started again. The fault comes back, so the dispatcher takes {unit} out of service and sends the spare unit {spare} from {depot}.",
    },
    {
      id: "alight", title: "The passengers get off and wait", seconds: 12,
      text: "Everybody leaves the broken train: {line} will leave from {spareTrack}, across the platform, about {delay} minutes late. The display says so.",
    },
    {
      id: "spare", title: "The spare unit leaves the depot", seconds: 16,
      text: "In {depot} a stand-by driver (Reservelokführer) walks to {spare}, raises the pantograph, starts the unit up and tests the brakes. At {out} it leaves for the station.",
    },
    {
      id: "arrive", title: "{spare} comes in at {spareTrack}", seconds: 14,
      text: "At {in} the spare unit stops at {spareTrack}, across the platform from the broken one, and opens its doors.",
    },
    {
      id: "change", title: "Passengers change trains; {line} leaves late", seconds: 18,
      text: "The passengers cross the platform and board {spare}. At {leave} {line} leaves for {destination}, {delay} minutes late.",
    },
    {
      id: "empty", title: "{unit} runs empty to the workshop", seconds: 20,
      text: "The driver isolates the faulty converter: with half of its traction the unit may run empty at reduced speed. He changes to the cab at the other end and takes it to the workshop of the depot; {track} is free again.",
    },
    {
      id: "workshop", title: "In the workshop: diagnosis and repair", seconds: 12,
      text: "The fitters read the fault memory: a power module (IGBT) of the traction converter has burnt out, and they exchange it in about {repair} hours. {line} and its trip back were more than {threshold} minutes late: under the transport contract the railway undertaking pays the transport authority {late}. Without the spare both trips would have been cancelled: {cancelled}.",
    },
    {
      id: "back", title: "Back to normal service", seconds: 12,
      text: "The next morning {unit} runs {line} again, on time; {spare} waits in the depot as the spare unit for the next fault.",
    },
  ];

  constructor(world, config = {}) {
    super(world, config);
    this._paths = new Map();
  }

  /* ---------------------------------------------------------------- the places of the story */

  /** The platform track (dock) of a track object: `{area, dock, track}`, or null. */
  _dockOf(trackId) {
    const track = this.world.getObject(trackId);
    if (track?.type !== "track" || !track.geometry || !track.spec.track_id) return null;
    for (const area of this.world.stopAreas()) {
      if (area.kind !== "rail") continue;
      const dock = area.docks.find((k) => k.track === track.spec.track_id);
      if (dock) return { area, dock, track };
    }
    return null;
  }

  /**
   * The story's places, cached until the layout or the settings change: the train's platform track
   * (`a`: the settings' track, else the first platform track), the spare's (`b`: the settings' track,
   * else another track of the same platform, else any other), the depot, and which way the trains run
   * to their destination (`heading`: +1 towards the tracks' last points; they come from the depot's end).
   */
  _places() {
    const c = this.config;
    return this._cached(`places:${c.track}:${c.spare_track}:${c.depot}`, () => {
      const docks = this.world.objects.filter((o) => o.type === "track").map((o) => this._dockOf(o.id)).filter(Boolean);
      const a = this._dockOf(c.track) ?? docks[0] ?? null, own = this._dockOf(c.spare_track);
      const others = docks.filter((d) => d.dock !== a?.dock);
      const b = own && own.dock !== a?.dock ? own : others.find((d) => d.area === a?.area) ?? others[0] ?? null;
      const o = this.world.getObject(c.depot);
      const depot = (o?.type === "depot" && o.geometry ? o : this.world.objects.find((x) => x.type === "depot" && x.geometry)) ?? null;
      let heading = 1;
      if (a && depot) {
        const pts = a.track.geometry.points, m = depot.geometry.center, d = (q) => Math.hypot(q[0] - m[0], q[1] - m[1]);
        heading = d(pts[0]) <= d(pts[pts.length - 1]) ? 1 : -1;
      }
      return { a, b, depot, heading };
    });
  }

  /** Where the train breaks down: `{area, dock, track}`, or null. */
  dock() {
    return this._places().a;
  }

  /** Where the spare unit comes in: `{area, dock, track}`, or null. */
  spareDock() {
    return this._places().b;
  }

  /** The depot of the spare unit and the workshop, or null. */
  depot() {
    return this._places().depot;
  }

  /** Which way the story's trains run to their destination along the platform tracks: +1 towards the tracks' last points, -1 towards their first points. */
  heading() {
    return this._places().heading;
  }

  /** Clock times of the story (minutes): the scheduled departure, and the others from it. */
  times() {
    const dep = parseTime(this.config.departure) ?? parseTime("07:42");
    return { dep, ...Object.fromEntries(Object.entries(AT).map(([k, v]) => [k, dep + v])), next: dep + TAKT_MIN, delay: AT.leave };
  }

  /** The steps with the names and numbers of the layout and the settings in their texts. */
  get steps() {
    const c = this.config, a = this.dock(), b = this.spareDock(), depot = this.depot(), t = this.times();
    const km = Math.max(1, +c.km || 22);
    const track = a ? `track ${a.dock.track}` : "the platform track", spareTrack = b ? `track ${b.dock.track}` : "the other track";
    const words = {
      line: c.line || "The train", destination: c.destination || "its destination", unit: c.unit || "the unit", spare: c.spare || "the spare unit",
      track, Track: upper(track), spareTrack, platform: a ? a.area.owner.name : "the platform", depot: depot?.name || "the depot",
      dep: formatTime(t.dep), fault: formatTime(t.fault), out: formatTime(t.out), in: formatTime(t.in), leave: formatTime(t.leave), delay: t.delay,
      repair: REPAIR_H, threshold: TRANSPORT.late_threshold_min,
      late: `2 × ${euros(TRANSPORT.late_trip)} = ${euros(2 * TRANSPORT.late_trip)}`,
      cancelled: `${2 * km} train-km × ${euros(TRANSPORT.cancelled_km)} = ${euros(2 * km * TRANSPORT.cancelled_km)}`,
    };
    const fill = (s) => String(s ?? "").replace(/\{(\w+)\}/g, (m, k) => (k in words ? String(words[k]) : m));
    return super.steps.map((s) => ({ ...s, title: upper(fill(s.title)), text: fill(s.text) }));
  }

  /* ---------------------------------------------------------------- the scene */

  compose(index, k) {
    const step = this.constructor.STEPS[index]?.id;
    const at = (id) => this.constructor.STEPS.findIndex((s) => s.id === id);
    const i = index, a = this.dock(), b = this.spareDock(), c = this.config, t = this.times();
    // seconds of the step's animation (the layout may retell a step with other seconds)
    const own = Array.isArray(c.steps) ? c.steps.find((x) => x?.id === step) : null;
    const scene = { step, k, seconds: +(own?.seconds ?? this.constructor.STEPS[index]?.seconds) || 0, focus: [], disruptions: [] };
    const service = `${c.line} ${c.destination} ${formatTime(t.dep)}`, delay = `about +${t.delay} min`;
    // the train: boarding, failed, reset (pantograph down and up), out of service, the empty run, the workshop
    const train = { place: "track", pantograph: 1, powered: true, doors: 0, fault: false, reversed: false, move: 0 };
    if (step === "normal" || step === "back") train.doors = 1;
    if (step === "fault" || step === "call") Object.assign(train, { doors: 1, fault: true });
    if (step === "call") {
      Object.assign(train, { pantograph: 1 - part(k, 0.2, 0.35) + part(k, 0.55, 0.7), powered: k < 0.3 || k >= 0.6, fault: k < 0.35 || k >= 0.75, reset: k >= 0.3 && k < 0.75 });
      scene.radio = k < 0.3 ? "report" : k < 0.75 ? "reset" : "decision";
    }
    if (step === "alight") Object.assign(train, { doors: 1 - part(k, 0.85, 0.95), fault: true });
    if (i >= at("spare") && i <= at("change")) train.fault = true;
    if (step === "empty") {
      // the driver changes ends (the lights change over), the unit leaves the station and comes into the workshop
      Object.assign(train, { fault: true, reversed: k >= 0.15, move: part(k, 0.25, 0.6) });
      if (k >= 0.62) Object.assign(train, { place: "workshop", move: part(k, 0.62, 1) });
    }
    if (step === "workshop") Object.assign(train, { place: "workshop", move: 1, pantograph: 0, powered: false, repair: k });
    scene.train = train;
    // the spare unit: stabled, out of the depot, in at the other track, boarding, away; back in the depot
    const spare = { place: "stabled", pantograph: 0, powered: false, doors: 0, move: 0 };
    if (step === "spare") Object.assign(spare, { pantograph: part(k, 0.36, 0.48), powered: k >= 0.44, place: k < 0.52 ? "stabled" : "leaving", move: part(k, 0.52, 1) });
    if (step === "arrive") Object.assign(spare, { place: "arriving", pantograph: 1, powered: true, move: part(k, 0.08, 0.82), doors: part(k, 0.86, 0.94) });
    if (step === "change") Object.assign(spare, { place: k < 0.62 ? "track" : "departing", pantograph: 1, powered: true, doors: 1 - part(k, 0.52, 0.58), move: part(k, 0.62, 1) });
    if (step === "empty" || step === "workshop") spare.place = null;
    scene.spare = spare;
    // the passengers (on board while not drawn), the stand-by driver in the depot, the fitters
    scene.mood = MOOD[step] ?? 0.9;
    if (step === "arrive") scene.mood = MOOD.arrive + 0.25 * part(k, 0.6, 1);
    scene.walker = step === "spare" ? { t: k * scene.seconds } : null;
    scene.fitters = step === "workshop" || (step === "empty" && k >= 0.9);
    // the platform's display and the message of the platform (its board): on time, delayed, the other track
    const elsewhere = b ? `now from ${b.dock.track ? `track ${b.dock.track}` : "the other track"}, ${delay}` : delay;
    let display = { lines: [`${formatTime(t.dep)}  ${c.line}  ${c.destination}`, "On time"], alert: false };
    let message = null;
    if (step === "fault") [display, message] = [{ lines: [display.lines[0], "Delayed: fault on the train"], alert: true }, `${service}: delayed, fault on the train`];
    if (step === "call") [display, message] = [{ lines: [display.lines[0], `${upper(delay)}: fault on the train`], alert: true }, `${service}: ${delay}`];
    if (i >= at("alight") && i <= at("change") && !(step === "change" && k >= 0.62)) [display, message] = [{ lines: [display.lines[0], upper(elsewhere)], alert: true }, `${service}: ${elsewhere}`];
    if ((step === "change" && k >= 0.62) || step === "empty" || step === "workshop") display = { lines: [`${formatTime(t.next)}  ${c.line}  ${c.destination}`, "On time"], alert: false };
    if (step === "empty" && k < 0.6 && a) message = `${a.dock.label || "Track"}: empty train, do not board`;
    scene.display = display;
    // the tracks of the story's trains: held for them from the start, the platform shows the message
    if (a && (step !== "empty" || k < 0.6) && step !== "workshop") scene.disruptions.push({ id: "train", type: "story-train", target: a.dock.id, params: message ? { text: message } : {} });
    if (b && i <= at("change") && !(step === "change" && k >= 0.97)) scene.disruptions.push({ id: "spare", type: "story-train", target: b.dock.id, params: {} });
    if (step === "spare" || step === "workshop") scene.focus.push(this.depot()?.id);
    scene.focus = scene.focus.filter(Boolean);
    return scene;
  }

  /* ---------------------------------------------------------------- the ways */

  /** Cached until the layout changes: `make()` once per key. */
  _cached(key, make) {
    const k = `${this.world.objectsVersion}:${this.world.map.version}:${key}`;
    if (!this._paths.has(k)) {
      this._paths.set(k, make());
      if (this._paths.size > 40) this._paths.delete(this._paths.keys().next().value);
    }
    return this._paths.get(k);
  }

  /** A line to run on: points (layout mm), their lengths, the total and mm per metre. */
  _line(points, mPerM) {
    const lengths = polylineLengths(points);
    return { points, lengths, total: lengths[lengths.length - 1], m: mPerM };
  }

  /**
   * Where a unit stops at a platform track: its head (mm along the track, from its first point) near
   * the front end of the platform, as short trains stop.
   */
  stopAt(d) {
    if (!d) return null;
    const g = d.track.geometry, m = d.track.mm(1), dir = this.heading();
    const ends = [0, d.area.L].map((s) => polylineProject(g.points, d.area.toLayout(s, 0), g.lengths).s);
    const front = dir > 0 ? Math.max(...ends) : Math.min(...ends), len = EMU_M * m;
    const head = front - dir * 3 * m;
    return dir > 0 ? Math.min(g.total - 2 * m, Math.max(len + 2 * m, head)) : Math.max(2 * m, Math.min(g.total - len - 2 * m, head));
  }

  /**
   * The depot's lines (local metres → layout): the gate end nearer to the station, and for the
   * workshop track and the stabling track a line from the lead track beyond the gate (`LEAD_M`) to the
   * far end. `{gateX, side, bay, stable}`, or null without a depot.
   */
  depotLines() {
    const depot = this.depot(), b = this.spareDock() ?? this.dock();
    if (!depot) return null;
    return this._cached(`depot:${depot.id}:${b?.track.id}`, () => {
      const p = depot.geometry.plan, m = depot.mm(1), pts = b?.track.geometry.points;
      // the end of the station's tracks where the depot is
      const toward = pts ? (this.heading() > 0 ? pts[0] : pts[pts.length - 1]) : depot.geometry.center;
      const near = (x) => Math.hypot(depot.at(x, 0)[0] - toward[0], depot.at(x, 0)[1] - toward[1]);
      const gateX = near(p.x1) <= near(p.x0) ? p.x1 : p.x0, side = gateX === p.x1 ? 1 : -1, farX = gateX === p.x1 ? p.x0 : p.x1;
      const line = (y) => this._line([depot.at(gateX + side * LEAD_M, y), depot.at(farX, y)], m);
      const stableY = p.stableY[0] ?? p.bayY[1] ?? p.bayY[0];
      return { gateX, side, plan: p, bay: line(p.bayY[0]), stable: line(stableY), stableY, m };
    });
  }

  /* ---------------------------------------------------------------- where the units are */

  /** A track's line (a platform track). */
  _trackLine(d) {
    const g = d.track.geometry;
    return { points: g.points, lengths: g.lengths, total: g.total, m: d.track.mm(1) };
  }

  /**
   * The broken unit: `{line, head, dir, flip, area?, ...state}` (head: mm along the line, dir: +1 towards
   * its end; flip: the cars the other way round, after the driver changed ends), or null.
   */
  trainAt() {
    const sc = this.scene?.train, a = this.dock();
    if (!sc || !a) return null;
    const m = a.track.mm(1), stop = this.stopAt(a), len = EMU_M * m, D = this.heading(), line = this._trackLine(a);
    if (sc.place === "track") {
      if (!sc.reversed) return { ...sc, line, head: stop, dir: D, flip: false, area: a.area };
      // after the change of ends: back along the platform and off towards the depot
      const from = stop - D * len, to = D > 0 ? -len - m : line.total + len + m, e = sc.move * sc.move;
      return { ...sc, line, head: from + (to - from) * e, dir: -D, flip: true, area: a.area };
    }
    const dl = this.depotLines();
    if (!dl) return null;
    // into the workshop track, from the lead track to the hall
    const to = (LEAD_M + 4 + EMU_M) * dl.m, e = 1 - (1 - sc.move) * (1 - sc.move);
    return { ...sc, line: dl.bay, head: to * e, dir: 1, flip: true, inHall: sc.move >= 0.5 };
  }

  /** The spare unit: as `trainAt`, or null while it is away. */
  spareAt() {
    const sc = this.scene?.spare, b = this.spareDock();
    if (!sc || !sc.place) return null;
    if (sc.place === "stabled" || sc.place === "leaving") {
      const dl = this.depotLines();
      if (!dl) return null;
      // stabled with its cab towards the gate; out along the lead track
      const from = (LEAD_M + 4) * dl.m, to = -(EMU_M + 1) * dl.m, e = sc.move * sc.move;
      return { ...sc, line: dl.stable, head: from + (to - from) * e, dir: -1, flip: false };
    }
    if (!b) return null;
    const m = b.track.mm(1), stop = this.stopAt(b), line = this._trackLine(b), D = this.heading();
    // in from the depot's end, braking to its stop; off to the destination, speeding up
    if (sc.place === "arriving") {
      const from = D > 0 ? -m : line.total + m, e = 1 - (1 - sc.move) * (1 - sc.move);
      return { ...sc, line, head: from + (stop - from) * e, dir: D, flip: false, area: b.area };
    }
    if (sc.place === "departing") {
      const to = D > 0 ? line.total + (EMU_M + 1) * m : -(EMU_M + 1) * m;
      return { ...sc, line, head: stop + (to - stop) * sc.move * sc.move, dir: D, flip: false, area: b.area };
    }
    return { ...sc, line, head: stop, dir: D, flip: false, area: b.area };
  }

  /** The door places of a unit standing at a platform: `[{s, t}]` in the stop area's frame (m), on the platform's edge. */
  doorsAt(d) {
    if (!d) return [];
    const stop = this.stopAt(d), g = d.track.geometry, m = d.track.mm(1), D = this.heading(), out = [];
    for (let c = 0; c < EMU.cars; c++) {
      const front = stop - D * c * (EMU.car_m + EMU.gap_m) * m;
      for (const f of EMU.doors) {
        const p = polylineAt(g.points, front - D * (1 - f) * EMU.car_m * m, g.lengths).point;
        out.push({ s: d.area.fromLayout(p)[0], t: d.dock.side * (d.area.W / 2 - 0.35) });
      }
    }
    return out.sort((x, y) => x.s - y.s);
  }

  /**
   * The story's passengers where the step shows them: `[{at, dir, speed, mood}]` (layout mm). They board
   * the train, get off and wait across the platform, and board the spare; on board they are not shown.
   */
  passengers() {
    const sc = this.scene, a = this.dock(), b = this.spareDock();
    if (!sc || !a || !b || a.area !== b.area) return [];
    const step = sc.step, now = sc.k * sc.seconds;
    const area = a.area, W = area.W, doorsA = this.doorsAt(a), doorsB = this.doorsAt(b);
    if (!doorsA.length || !doorsB.length) return [];
    const out = [];
    for (let i = 0; i < PASSENGERS; i++) {
      const r = (j) => hash01(7919 + i, j);
      const dA = doorsA[i % doorsA.length], dB = doorsB[i % doorsB.length];
      // waiting for the train near its track; after the fault across the platform, near the spare's track
      const spotA = [dA.s + (r(1) - 0.5) * 8, a.dock.side * (0.4 + r(2) * (W / 2 - 1.1))];
      const spotB = [dB.s + (r(3) - 0.5) * 5, b.dock.side * (0.3 + r(4) * (W / 2 - 1))];
      const start = 0.3 + (i / PASSENGERS) * 5 + 0.6 * r(5), boarding = step === "normal" || step === "back" || step === "change";
      let from = null, to = null;
      if (step === "normal" || step === "back") [from, to] = [spotA, [dA.s, dA.t]];
      else if (step === "alight") [from, to] = [[dA.s, dA.t], spotB];
      else if (step === "spare" || step === "arrive") [from, to] = [spotB, spotB];
      else if (step === "change") [from, to] = [spotB, [dB.s, dB.t]];
      else continue;
      const walk = Math.hypot(to[0] - from[0], to[1] - from[1]) / WALK_MPS;
      const u = from === to ? 1 : Math.min(1, Math.max(0, (now - start) / Math.max(walk, 1e-6)));
      // boarding: gone once at the door; alighting: out of the door when its time has come
      if ((boarding && u >= 1) || (step === "alight" && now < start)) continue;
      const walking = u > 0 && u < 1;
      const s = from[0] + (to[0] - from[0]) * u, t = from[1] + (to[1] - from[1]) * u;
      const look = walking ? [to[0] - from[0], to[1] - from[1]] : [0, (step === "normal" || step === "back" ? a : b).dock.side];
      const o = area.toLayout(0, 0), x = area.toLayout(look[0], look[1]);
      out.push({ at: area.toLayout(s, t), dir: [x[0] - o[0], x[1] - o[1]], speed: walking ? WALK_MPS : 0, mood: sc.mood, phase: i * 1.7 });
    }
    return out;
  }

  /** The stand-by driver in the depot (step 5): from the workshop's gate to the spare unit's cab, `{at, dir, speed}`, or null. */
  walkerAt() {
    const w = this.scene?.walker, dl = this.depotLines(), depot = this.depot();
    if (!w || !dl || !depot) return null;
    const p = dl.plan, x = dl.gateX, sd = dl.side, yBay = p.bayY[p.bayY.length - 1], yWay = dl.stableY - 2.2;
    const path = [[x + sd * 0.5, yBay], [x + sd * 1.5, yBay], [x + sd * 1.5, yWay], [x - sd * 5, yWay]].map(([lx, ly]) => depot.at(lx, ly));
    const lengths = polylineLengths(path), total = lengths[lengths.length - 1];
    const s = Math.min(total, HURRY_MPS * w.t * dl.m), at = polylineAt(path, s, lengths);
    return { at: at.point, dir: at.dir, speed: s < total ? HURRY_MPS : 0 };
  }

  /* ---------------------------------------------------------------- the depot */

  /**
   * The depot's board (as the rail operations' `depotState`): the story draws the units itself.
   * @returns {{bays: object[], stabled: object[][], lines: string[]} | null}
   */
  depotState(depot) {
    const sc = this.scene;
    if (!this.active || !sc || depot !== this.depot()) return null;
    const c = this.config, step = sc.step, k = sc.k;
    const ordered = step === "alight" || step === "spare" || (step === "call" && k >= 0.75);
    const spare = sc.spare.place !== "stabled" ? `No spare unit: ${c.spare} runs ${c.line}` : ordered ? `Spare unit ${c.spare} ordered for ${c.line}` : `Spare unit ${c.spare} ready`;
    let shop = "Workshop free";
    if (step === "empty") shop = k < 0.62 ? `Workshop: ${c.unit} on its way` : `Workshop: ${c.unit}, converter fault`;
    if (step === "workshop") shop = `Workshop: ${c.unit} · repair ${Math.round(100 * k)} %`;
    return { bays: [], stabled: [], lines: [spare, shop] };
  }

  /* ---------------------------------------------------------------- the camera */

  /**
   * Where to look in the current step (the app's flyover follows it): `{at, distance, pitch_deg,
   * yaw_deg}` (layout mm): the train at its platform, the people on the platform, the spare unit on its
   * way, the broken unit on its way to the workshop and in it. Always from the same side, at a slant
   * along the tracks: from straight in front the train at the near track would hide the platform.
   */
  view() {
    const sc = this.scene, a = this.dock();
    if (!sc || !a) return null;
    const step = sc.step, train = this.trainAt(), spare = this.spareAt(), yaw = this._yaw();
    const mid = (u) => this._unitMid(u), platform = this._platformPoint();
    const look = (at, distance, pitch_deg) => ({ at, distance, pitch_deg, yaw_deg: yaw });
    if (step === "normal" || step === "back" || step === "alight") return look(platform, 800, 52);
    if (step === "fault" || step === "call") return look(this._cab(train) ?? platform, 700, 50);
    if (step === "spare") {
      const w = this.walkerAt();
      return look(sc.k < 0.5 && w ? w.at : mid(spare) ?? this._gate(), 1150, 58);
    }
    // the spare comes in beside the platform's canopy: from high above, the canopy hides none of it
    if (step === "arrive") return look(spare && sc.k < 0.82 ? this._cab(spare) ?? platform : platform, 950, 72);
    if (step === "change") return look(spare && sc.k >= 0.62 ? this._cab(spare) ?? platform : platform, 800, 52);
    if (step === "empty") {
      if (train?.place === "workshop") return look(train.move > 0.08 ? this._cab(train) ?? this._gate() : this._gate(), 1000, 60);
      return look(train && sc.k >= 0.25 ? this._cab(train) ?? platform : platform, 950, 50);
    }
    return look(mid(train) ?? this._gate() ?? platform, 900, 64);
  }

  /**
   * The direction the camera looks in (degrees seen from above, 0 = along +x): from the train's track
   * across the platform, turned 30° along the tracks towards where the trains come from, so that it
   * sees their cabs and the platform between them.
   */
  _yaw() {
    const a = this.dock(), area = a.area, D = this.heading(), g = a.track.geometry;
    const u = polylineAt(g.points, g.total / 2, g.lengths).dir, n = area.normal;
    const across = a.dock.side < 0 ? n : [-n[0], -n[1]], c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
    return Math.round((Math.atan2(across[1] * c - u[1] * D * s, across[0] * c - u[0] * D * s) * 180) / Math.PI);
  }

  /** The middle of the platform beside the train (layout mm). */
  _platformPoint() {
    const a = this.dock(), area = a.area;
    const mid = this._unitMid({ line: this._trackLine(a), head: this.stopAt(a), dir: this.heading() });
    return area.toLayout(mid ? area.fromLayout(mid)[0] : area.L / 2, 0);
  }

  /** The middle of a unit (layout mm) as far as it is on its line, or null. */
  _unitMid(u) {
    if (!u?.line) return null;
    const m = u.line.m, s = u.head - u.dir * (EMU_M / 2) * m;
    if (s < -EMU_M * m * 0.5 || s > u.line.total + EMU_M * m * 0.5) return null;
    return polylineAt(u.line.points, Math.min(u.line.total, Math.max(0, s)), u.line.lengths).point;
  }

  /** The leading cab of a unit (layout mm) while it is on its line, or null. */
  _cab(u) {
    if (!u?.line) return null;
    const m = u.line.m, s = u.head - u.dir * 3 * m;
    if (s < 0 || s > u.line.total) return null;
    return polylineAt(u.line.points, s, u.line.lengths).point;
  }

  /** The depot's gate (layout mm). */
  _gate() {
    const dl = this.depotLines();
    return dl ? polylineAt(dl.bay.points, LEAD_M * dl.m, dl.bay.lengths).point : null;
  }

  /* ---------------------------------------------------------------- drawing */

  draw(view) {
    if (!this.active || !this.scene) return;
    const sc = this.scene, t = view.time || 0, c = this.config;
    const train = this.trainAt(), spare = this.spareAt();
    if (train) {
      const label = train.place === "workshop"
        ? { lines: [c.unit, sc.step === "workshop" ? `Repair: traction converter · ${Math.round(100 * (train.repair ?? 0))} %` : train.move < 1 ? "Empty run to the workshop" : "Workshop: converter fault"], danger: sc.step !== "workshop" }
        : train.reversed ? { lines: [c.unit, "Empty run · half traction"], danger: true }
          : train.reset ? { lines: [c.unit, "Reset …"], danger: false }
            : train.fault ? { lines: [c.unit, "Fault: traction converter"], danger: true }
              : { lines: [`${c.line} ${c.destination}`, c.unit], danger: false };
      drawUnit(view, train, { label, ref: train.inHall ? this._hallRef(view) : null });
    }
    if (spare) {
      const label = spare.place === "stabled" ? { lines: [c.spare, sc.step === "spare" && spare.powered ? "Starting up" : "Spare unit"], danger: false } : { lines: [`${c.line} ${c.destination}`, c.spare], danger: false };
      drawUnit(view, spare, { label });
    }
    if (sc.radio && train) this._drawRadio(view, sc, train);
    if (sc.step === "workshop" && train) this._drawRepair(view, train, sc.k);
    this._drawDisplay(view, sc);
    for (const p of this.passengers()) drawPerson(view, p.at, { dir: p.dir, speed: p.speed, phase: t * 6 + p.phase, height: 1.7, colour: moodColor(p.mood), legs: moodColor(p.mood, 1, 0.55) });
    const w = this.walkerAt();
    if (w) drawPerson(view, w.at, { dir: w.dir, speed: w.speed, phase: t * 7, height: 1.8, colour: CREW_COLOURS.body, legs: CREW_COLOURS.legs });
    if (sc.fitters && train) this._drawFitters(view, train, t);
  }

  /** A point behind the depot's hall seen from the camera: units in the hall are drawn before its glass. */
  _hallRef(view) {
    const depot = this.depot(), p = depot?.geometry?.plan;
    if (!p) return null;
    const corners = [[p.x0, p.hall.y0], [p.x1, p.hall.y0], [p.x1, p.hall.y1], [p.x0, p.hall.y1]].map(([x, y]) => depot.at(x, y, 0));
    const far = corners.reduce((x, y) => (view.depth(x[0], x[1], 0) > view.depth(y[0], y[1], 0) ? x : y));
    return [far[0], far[1], 0];
  }

  /** The train radio and the reset over the broken unit's cab (step 3). */
  _drawRadio(view, sc, train) {
    const cab = this._cab(train);
    if (!cab) return;
    const c = this.config, lines = {
      report: ["Train radio (GSM-R)", `${c.line}: converter fault, no traction`],
      reset: ["Reset", "Pantograph down, unit off and on"],
      decision: ["Operations control", `${c.unit} out of service · spare ${c.spare} ordered`],
    }[sc.radio];
    view.label([cab[0], cab[1], view.m(8.5)], lines, { size: 11, background: OVERLAY.label, colors: [null, OVERLAY.status], badge: "R", badgeColor: OVERLAY.sign, order: 3 });
  }

  /** The repair in the workshop: the converter's power module lifted off the roof and a new one put on (step 9). */
  _drawRepair(view, train, k) {
    if (!this._unitMid(train)) return;
    const m = view.m(1), u = polylineAt(train.line.points, Math.max(0, train.head - train.dir * 8 * train.line.m), train.line.lengths);
    const lift = k < 0.5 ? part(k, 0.1, 0.4) : 1 - part(k, 0.6, 0.9);
    const z = (EMU.roof_m + 0.1 + 2.4 * lift) * m, p = u.point, d = u.dir;
    // the old module dark grey, the new one Dunkelblau
    const colour = k < 0.5 ? grey(0.3) : CD.dunkelblau;
    view.faces(boxFaces([p[0] - d[0] * 1.1 * m, p[1] - d[1] * 1.1 * m], [p[0] + d[0] * 1.1 * m, p[1] + d[1] * 1.1 * m], 1.6 * m, z, z + 0.6 * m, { side: colour, top: shade(colour, 1.2) }), [p[0], p[1], z]);
  }

  /** Two fitters beside the unit in the workshop track. */
  _drawFitters(view, train, t) {
    const m = train.line.m;
    for (const [i, off, side] of [[0, 9, 1], [1, 27, -1]]) {
      const a = polylineAt(train.line.points, Math.max(0, train.head - train.dir * off * m), train.line.lengths);
      const q = [-a.dir[1], a.dir[0]], sway = Math.sin(t * 0.6 + i * 2) * 1.5 * m;
      const p = [a.point[0] + q[0] * side * 2.3 * m + a.dir[0] * sway, a.point[1] + q[1] * side * 2.3 * m + a.dir[1] * sway];
      drawPerson(view, p, { dir: [a.dir[0] * Math.cos(t * 0.6 + i * 2), a.dir[1] * Math.cos(t * 0.6 + i * 2)], speed: 0.5, phase: t * 4 + i, height: 1.78, colour: FITTER_COLOURS.body, legs: FITTER_COLOURS.legs });
    }
  }

  /** The platform's display beside the train: its departure, on time or delayed, the track to go to. */
  _drawDisplay(view, sc) {
    const a = this.dock();
    if (!a || !sc.display) return;
    const area = a.area, m = view.m(1);
    const mid = this._unitMid({ line: this._trackLine(a), head: this.stopAt(a), dir: this.heading() });
    // just beyond the train's rear, towards the middle of the platform (its label then hides no passenger)
    const ms = mid ? area.fromLayout(mid)[0] : area.L / 2, away = EMU_M / 2 + 6;
    const s = Math.min(area.L - 3, Math.max(3, ms + (ms < area.L / 2 ? away : -away)));
    const p = area.toLayout(s, 0), q = area.toLayout(s + 1, 0), u = [(q[0] - p[0]) / m, (q[1] - p[1]) / m];
    const P = (along) => [p[0] + u[0] * along * m, p[1] + u[1] * along * m];
    const steel = grey(0.45), board = CD.dunkelblau;
    view.faces([
      ...boxFaces(P(-1.05), P(-0.9), 0.12 * m, 0, 2.6 * m, { side: steel, top: steel }),
      ...boxFaces(P(0.9), P(1.05), 0.12 * m, 0, 2.6 * m, { side: steel, top: steel }),
      ...boxFaces(P(-1.15), P(1.15), 0.26 * m, 2.6 * m, 3.4 * m, { side: board, top: shade(board, 1.3) }),
    ], [p[0], p[1], 1.8 * m]);
    view.label([p[0], p[1], 3.6 * m], sc.display.lines, { size: 11, anchor: "bottom", background: OVERLAY.label, colors: [null, sc.display.alert ? OVERLAY.alert : OVERLAY.status], badge: a.dock.track || undefined, badgeColor: OVERLAY.sign, order: 5 });
  }
}

/* ---------------------------------------------------------------- drawing helpers */

/**
 * A two-car unit on its line: car bodies with a red band, windows, doors (yellow while open, on the
 * platform's side), red cab ends with their windscreens, the pantograph (up or down), head and tail
 * lights while it is powered, and a label with its number. Cars beyond the line's ends are not drawn.
 * @param {object} view
 * @param {{line: object, head: number, dir: number, flip: boolean, pantograph: number, powered: boolean, doors: number, area?: object}} u
 * @param {{label?: {lines: string[], danger: boolean} | null, ref?: number[] | null}} [o] its label, and a
 *   reference point to sort it by (a unit in the depot's hall: behind the hall, seen through its glass)
 */
export function drawUnit(view, u, { label = null, ref = null } = {}) {
  const { line, head, dir } = u, m = line.m, mz = view.m(1);
  const car = EMU.car_m * m, gap = EMU.gap_m * m, z0 = EMU.floor_m * mz, z1 = EMU.roof_m * mz;
  const lit = u.powered && view.darkness > 0.35;
  let top = null;
  for (let c = 0; c < EMU.cars; c++) {
    const f = head - dir * c * (car + gap), r = f - dir * car;
    const lo = Math.max(0, Math.min(f, r)), hi = Math.min(line.total, Math.max(f, r));
    if (hi - lo < 0.5 * m) continue;
    const fc = dir > 0 ? hi : lo, rc = dir > 0 ? lo : hi;
    const A = polylineAt(line.points, rc, line.lengths).point, B = polylineAt(line.points, fc, line.lengths).point;
    if (!view.inImage((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, 0, 160)) continue;
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]) / m;
    const ax = [(B[0] - A[0]) / (len * m || 1), (B[1] - A[1]) / (len * m || 1)];
    // the platform's side (doors open there), seen along the car
    let doorSide = null;
    if (u.area && u.doors > 0) {
      const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], w = u.area.toLayout(u.area.fromLayout(mid)[0], 0);
      doorSide = -ax[1] * (w[0] - mid[0]) + ax[0] * (w[1] - mid[1]) > 0 ? "left" : "right";
    }
    // where the car's doors are (m from its clipped rear) and whether its ends are cabs
    const offset = Math.abs(rc - r) / m, cabFront = c === 0 && fc === f, cabBack = c === EMU.cars - 1 && rc === r;
    const doors = EMU.doors.map((x) => (u.flip ? 1 - x : x) * EMU.car_m - offset).filter((x) => x > 0.8 && x < len - 0.8);
    const faces = boxFaces(A, B, EMU.width_m * m, z0, z1, { side: LIVERY.body, top: LIVERY.roof, end: shade(LIVERY.body, 0.9) }, (face, P, L, hw) => {
      const out = [];
      if (face.side === "left" || face.side === "right") {
        const t = face.side === "left" ? hw : -hw, a0 = cabBack ? 2.6 * m : 0.6 * m, a1 = L - (cabFront ? 2.6 * m : 0.6 * m);
        out.push({ pts: [P(0, t, 0.75 * mz), P(L, t, 0.75 * mz), P(L, t, 1.35 * mz), P(0, t, 1.35 * mz)], color: LIVERY.band });
        if (a1 > a0) out.push({ pts: [P(a0, t, 1.75 * mz), P(a1, t, 1.75 * mz), P(a1, t, 2.75 * mz), P(a0, t, 2.75 * mz)], color: lit ? PALETTE.litWindow : LIVERY.glass, emissive: lit });
        const open = face.side === doorSide ? u.doors : 0;
        for (const d of doors) {
          const w = 0.65 * m;
          out.push({ pts: [P(d * m - w, t, z0 + 0.05 * mz), P(d * m + w, t, z0 + 0.05 * mz), P(d * m + w, t, 2.9 * mz), P(d * m - w, t, 2.9 * mz)], color: open > 0.5 ? LIVERY.door : LIVERY.closed });
        }
      } else if ((face.side === "front" && cabFront) || (face.side === "back" && cabBack)) {
        const a = face.side === "front" ? L : 0;
        out.push({ pts: [P(a, -1.15 * m, 2.05 * mz), P(a, 1.15 * m, 2.05 * mz), P(a, 1.15 * m, 3.15 * mz), P(a, -1.15 * m, 3.15 * mz)], color: LIVERY.glass });
      }
      return out;
    });
    for (const face of faces) {
      if ((face.side === "front" && cabFront) || (face.side === "back" && cabBack)) face.color = LIVERY.cab;
    }
    const midPt = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    view.faces(faces, ref || [midPt[0], midPt[1], 2 * mz]);
    // the pantograph on the second car as built (the first one when it runs the other way round), near its inner end
    if ((u.flip ? EMU.cars - 1 - c : c) === EMU.cars - 1) drawPantograph(view, A, ax, m, mz, u.pantograph ?? 0, c === 0 ? 4 : len - 4, ref);
    // head and tail lights
    if (u.powered) {
      const q = [-ax[1], ax[0]];
      const end = (a, colour) => {
        for (const sgn of [-1, 1]) {
          const p = [A[0] + ax[0] * a * m + q[0] * sgn * 0.85 * m, A[1] + ax[1] * a * m + q[1] * sgn * 0.85 * m, 0.95 * mz];
          view.glow(p, 0.45 * m, colour, 0.9);
        }
      };
      if (cabFront) end(len + 0.05, "#ffffff");
      if (cabBack) end(-0.05, CD.rot);
    }
    if (c === 0 || !top) top = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  }
  if (label && top) {
    view.label([top[0], top[1], view.m(6)], label.lines, { size: 11, background: label.danger ? OVERLAY.dangerLabel : OVERLAY.label, colors: [null, label.danger ? OVERLAY.alert : OVERLAY.status], order: 4 });
  }
}

/**
 * A single-arm pantograph on a car's roof at `a` (m from the car's rear `A`, along `ax`): its base, the
 * lower and the upper arm (seen from the side) and the head across the roof (seen from above), from
 * folded down (`up` 0) to raised to the contact wire (1).
 */
function drawPantograph(view, A, ax, m, mz, up, a, ref) {
  const q = [-ax[1], ax[0]], roof = EMU.roof_m, mix = (x, y) => x + (y - x) * up;
  const at = (s, across = 0) => [A[0] + ax[0] * s * m + q[0] * across * m, A[1] + ax[1] * s * m + q[1] * across * m];
  const P = (s, across, z) => [...at(s, across), z * mz];
  // the hinge, the knee and the head (along the car, height in m): folded flat, or raised
  const hinge = [a - 1.1, roof + 0.3], knee = [mix(a + 1.2, a + 0.7), mix(roof + 0.42, roof + 1.15)], head = [mix(a - 0.9, a - 0.2), mix(roof + 0.5, roof + 1.95)];
  const arm = (p0, p1, th = 0.09) => ({ pts: [P(p0[0], 0, p0[1] - th), P(p1[0], 0, p1[1] - th), P(p1[0], 0, p1[1] + th), P(p0[0], 0, p0[1] + th)], normal: [q[0], q[1], 0], color: LIVERY.pantograph, twoSided: true });
  const flat = (s0, s1, w, z) => ({ pts: [P(s0, -w, z), P(s1, -w, z), P(s1, w, z), P(s0, w, z)], normal: [0, 0, 1], color: LIVERY.pantograph, twoSided: true });
  const p = at(a);
  view.faces([
    ...boxFaces(at(a - 1.4), at(a + 1.4), 1.3 * m, roof * mz, (roof + 0.25) * mz, { side: grey(0.45), top: grey(0.5) }),
    arm(hinge, knee),
    arm(knee, head),
    flat(head[0] - 0.18, head[0] + 0.18, 0.95, head[1] + 0.08),
  ], ref || [p[0], p[1], (roof + 1) * mz]);
}
