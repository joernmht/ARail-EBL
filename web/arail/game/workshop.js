/**
 * The workshop manager's game (Werkstattleiter/in, Instandhaltungsdurchführung), "A night in the
 * hall": the night shift in the hall of Betriebswerk Neustadt, 22:00 to 05:24. Four multiple units
 * come in with their orders, four trains want a unit in the morning. The hall has three tracks: the
 * pit, the lifting jacks, the underfloor wheel lathe; outside are three stabling tracks, and one
 * throat through which every move goes.
 *
 * The game teaches who decides what in the maintenance of a vehicle: the four functions of the
 * entity in charge of maintenance (ECM, Regulation (EU) 2019/779). The player is the fourth,
 * maintenance delivery: does the work that is ordered, as the maintenance file says, with
 * authorised staff, and releases to service what was done. The other three are people on the
 * phone. Fleet maintenance management (the third) orders the work, decides what may wait, and
 * returns a unit to operation: released to service is not returned to operation. Maintenance
 * development (the second) writes the maintenance file: only it moves a limit. The management
 * function (the first) answers for all of it, and asks in the morning about every rule left.
 *
 * So the night's questions lie on the borders: a finding beyond the order (ask and wait while the
 * pit stands, repair it under the standing order and hope it is small, or write it into the
 * release and leave it to the morning); a value at its limit (take the reading, measure again,
 * change the part, or ask for a concession); how deep the lathe cuts (too little and it starts
 * again, too much and wheel life is gone and the other wheelset must follow); a time promised to
 * the operator's dispatcher; a driver at the door of a unit that is released and not yet returned.
 * Between the questions the hall is the player's: which unit stands on which track, when it is
 * released, when somebody is phoned out of bed.
 *
 * Three people count differently: the fleet manager the orders and the calls at night, the
 * maintenance development engineer the limits and the wheels, the operator's vehicle dispatcher
 * the trains. Their patience falls, they phone and ask for a promise, and what one is promised
 * another pays.
 *
 * Simplified for teaching: a second of the shift is twelve of the night (`PACE`); a track's crew
 * is with the track; every move takes the same time and one goes at a time; any unit that is
 * returned to operation can take any train; a unit kept in by fleet management (a release signed
 * without authorisation) is lost for the night.
 * @module arail/game/workshop
 */
import { Game, Player, clockAt } from "./core.js";

/** A second of the shift is so many seconds of the night: the night's seven hours in 37 minutes. */
export const PACE = 12;
/** The shift begins at 22:00 (seconds after midnight) and is so long (minutes of the night). */
const START = 22 * 3600, NIGHT_MIN = 444;
/** Seconds of the shift of minutes of the night, and back (rounded). */
const S = (min) => (min * 60) / PACE;
const mins = (s) => Math.round((s * PACE) / 60);
/** A time of day of a time of the shift (s). */
const hm = (t) => clockAt(Math.round(t * PACE), START);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** One of a weighted list, by a random number 0 … 1. */
const pick = (list, u) => list[Math.min(list.length - 1, Math.floor(u * list.length))];
/** A depth or a margin as it is said: "2.5". */
const mm = (v) => String(Math.round(v * 10) / 10);

/** The fleet's class number: a unit "103" is 442 103. */
export const FLEET = "442";
const nameOf = (id) => `${FLEET} ${id}`;

/**
 * The tracks: three in the hall, each with what stands on it (the pit under track 1, the lifting
 * jacks along track 2, the underfloor wheel lathe in track 3), and three stabling tracks outside.
 * One unit stands on a track.
 */
export const TRACKS = [
  { id: "1", hall: true, kind: "pit", name: "track 1", what: "the pit" },
  { id: "2", hall: true, kind: "jacks", name: "track 2", what: "the lifting jacks" },
  { id: "3", hall: true, kind: "lathe", name: "track 3", what: "the wheel lathe" },
  { id: "A", hall: false, kind: "stabling", name: "stabling track A", what: "outside" },
  { id: "B", hall: false, kind: "stabling", name: "stabling track B", what: "outside" },
  { id: "C", hall: false, kind: "stabling", name: "stabling track C", what: "outside" },
];
const HALL = TRACKS.filter((t) => t.hall).map((t) => t.id), OUTSIDE = TRACKS.filter((t) => !t.hall).map((t) => t.id);
const trackOf = (id) => TRACKS.find((t) => t.id === id);

/**
 * Moves (minutes of the night): from one track to another through the throat, in from the line to
 * a stabling track, out to the station, and raising or lowering a unit on the jacks. One move goes
 * at a time.
 */
export const MOVE = { shunt_min: 6, in_min: 4, out_min: 4, lift_min: 3 };

/**
 * The work (minutes of the night with the track's crew): the inspection (on the pit only), the
 * brake pads of both bogies (from the pit or on the jacks), the brake test after them (anywhere,
 * by the one person authorised for it tonight), the drive of a door (on any hall track), a brake
 * disc or contact strip changed after a reading below its limit, a second measurement.
 */
export const WORK = { inspection_min: 170, pads_min: 110, brake_test_min: 20, door_min: 75, change_min: 45, measure_min: 10, reopen_min: 20 };

/**
 * The wheel lathe: setting up a wheelset (min), each millimetre cut (min), setting up again after
 * a cut too shallow (min); above so many millimetres the other wheelset of the bogie is cut to
 * match (the maintenance file's limit on the difference of diameters); the scale of the cut; what
 * a millimetre of diameter is worth in kilometres; and what the maintenance file asks to cut below
 * the damage (mm).
 */
export const LATHE = { setup_min: 30, per_mm_min: 12, again_min: 15, pair_mm: 3, min: 1, max: 6, step: 0.5, life_km: 30000, below_mm: 0.5 };

/** A finding that takes no longer than this (min) is covered by fleet management's standing order: the workshop repairs it without asking. */
export const STANDING_MIN = 30;

/**
 * The people on call (minutes of the night, from … to): how long fleet management takes to answer
 * about a finding, maintenance development about a concession, and fleet management to return a
 * released unit to operation; how fast that goes when it is phoned for, and how much longer once
 * the fleet manager reads every paper line by line.
 */
export const ON_CALL = { fleet: [4, 12], development: [6, 14], rto: [6, 16], quick_min: 2, slow_min: 8 };

/** The trains of the morning: the minute of the night a unit must leave the depot for them, and how long a train waits for a unit (min) before it is cancelled. */
export const PULLOUTS = [
  { id: "RB 31", to: "Talsee", at_min: 384 },
  { id: "RB 33", to: "Waldau", at_min: 402 },
  { id: "RB 31", to: "Bergheim", at_min: 420 },
  { id: "RB 35", to: "Talsee", at_min: 432 },
];
export const LATE_MAX_MIN = 12;

/**
 * The units of the night: when they come in (minute of the night; before 0: they stand outside),
 * their order from fleet management in words, and their tasks.
 */
export const UNITS = [
  { id: "105", arrive_min: -30, order: "brake pads of both bogies, brake test", tasks: ["pads", "brake-test"] },
  { id: "101", arrive_min: -30, order: "door 3 does not close and is locked: its drive, if the night allows", tasks: ["door"] },
  { id: "107", arrive_min: 45, order: "wheel flat on axle 3, reported by its driver: reprofile the wheelset", tasks: ["wheel"] },
  { id: "103", arrive_min: 100, order: "inspection, due tomorrow by its days", tasks: ["inspection"] },
];

/**
 * What a fitter may find beyond the order, by chance: what is seen, how likely fleet management
 * wants it repaired before the unit runs (else it may run with a restriction), the foreman's
 * estimate of the repair (min, from … to; it can take ten more), the restriction it runs with
 * if it waits, and whether it is on the brakes (repaired after the brake test, the test is due again).
 */
export const FINDINGS = [
  { id: "damper", what: "a damper on the second bogie is wet with oil", must: 0.45, est: [25, 50], restriction: "the damper watched: checked again within seven days" },
  { id: "hose", what: "a brake hose under the middle car is chafed, its fabric shows", must: 0.8, est: [20, 40], restriction: "the hose checked at every stabling until it is changed", brakes: true },
  { id: "sander", what: "the sanding pipe at the first axle is bent and blocked", must: 0.5, est: [15, 35], restriction: "no sand on one axle: 120 km/h at most" },
  { id: "step", what: "the weld of the step at door 2 has a crack", must: 0.25, est: [30, 60], restriction: "door 2 locked" },
];

/** What may be measured at its limit, by chance: the part, and the restriction a concession comes with. */
export const LIMITS = [
  { id: "disc", what: "the brake disc of axle 4", of: "wear limit", part: "disc", restriction: "120 km/h at most, the disc changed by Friday" },
  { id: "strip", what: "the contact strip of the pantograph", of: "wear limit", part: "contact strip", restriction: "checked every night, changed by Friday" },
];
/** The readings (mm above the limit; below 0: under it) a gauge may show, how far the part may truly be off that (mm either way), and above which true margin a part changed anyway was a good part scrapped. */
const READINGS = [-0.2, 0, 0.1, 0.2, 0.3], GAUGE_MM = 0.45, GOOD_MM = 0.25;
/** A concession is given down to this true margin (mm). */
const CONCESSION_MM = -0.3;

/**
 * Levels: how many findings beyond the order the inspection brings, whether a value at its limit
 * is among them, whether the brake job finds something too, how far the foreman's guess of the
 * flat's depth may be off (mm either way), how fast the crews work, how long the return to
 * operation takes (min, from … to), and how long people on call take (a factor).
 */
export const LEVELS = {
  training: { label: "Training: one finding beyond the order, nobody slow on the phone", limit: false, brake: false, guess_mm: 0.5, rate: 1, rto: [3, 6], answer: 0.5 },
  normal: { label: "Normal: findings beyond the order on two units, a value at its limit, people on call who take their time", limit: true, brake: true, guess_mm: 1, rate: 1, rto: ON_CALL.rto, answer: 1 },
  hard: { label: "Hard: a fitter short, the phones slower, the foreman's guesses wider", limit: true, brake: true, guess_mm: 1.5, rate: 0.9, rto: [8, 18], answer: 1.4 },
};

/**
 * The patience of the three people (0 to 100): where it starts, below which they phone, below
 * which they act; and what moves it. The fleet manager: a call at night, work beyond the standing
 * order done without asking, a finding left in the release (and one that keeps the unit in), a
 * unit handed to its driver before it is returned to operation, a unit released, a unit not out by
 * four. The maintenance development engineer: a call at night, each millimetre cut more than the
 * flat needed, a good part scrapped, a part that fails in service, a cut that fits. The
 * dispatcher: a train on time, a unit with a restriction, a minute late, a train cancelled (and
 * one cancelled in good time), a train that looks short of its unit in the hourly status, a time
 * kept. On the phone: what a promise, a compromise and an accepted explanation are worth, what a
 * refused explanation, a refusal and a broken promise cost.
 */
export const MOOD = {
  start: 85, call: 70, act: 35,
  night_call: -7, bypassed: -22, noted: -3, noted_must: -24, handed: -30, released: 3, after_four: -8,
  dev_call: -8, excess_mm: -9, scrapped: -12, repeat: -30, fits: 5,
  on_time: 3, restricted: -9, late_min: -4, cancelled: -32, planned: -14, slipping: -7, kept_word: 6,
  promise: 14, compromise: 7, explained: 10, refused: -6, declined: -8, broken: -26,
};
/** What a release that fleet management sends back for a finding written into it costs the night's orders. */
export const SENT_BACK = { orders: 0.12 };
/** What a cancelled train is worth in the score: cancelled at the platform, and cancelled in good time. */
const CANCELLED = { late: -0.4, planned: -0.15 };
/** Fleet management wants every unit released by this minute of the night (04:00). */
const OUT_BY_MIN = 360;
/** The dispatcher asks for a time at this minute of the night (03:10), and takes a release up to so many minutes after the time said as kept. */
const PROMISE_AT_MIN = 310, GRACE_MIN = 3;
/** A unit released so long before a train (min) is expected back in operation for it. */
const RTO_GUESS_MIN = 10;
/** An explanation on the phone is accepted this often. */
const ACCEPT = 0.5;
/** A part passed at its limit that was truly under it fails in service so long after the unit left (min, from … to). */
const FAILS_AFTER_MIN = [10, 16];
/** The shift's first seconds: the hand-over, nothing is asked. */
const FIRST_S = 12;
/** How long a question on the phone or at the door waits (s). */
const DECIDE_S = { call: 75, door: 45 };

/** The people on the phone and in the hall (bird names, see CONTRIBUTING.md). */
export const PEOPLE = {
  fleet: { name: "O. Stieglitz", role: "the fleet manager on call", label: "Fleet management", counts: "orders, calls at night, the return to operation" },
  development: { name: "I. Zeisig", role: "the maintenance development engineer on call", label: "Maintenance development", counts: "limits, wheel life, parts that come back" },
  dispatch: { name: "F. Sokół", role: "the operator's vehicle dispatcher", label: "The operator's dispatcher", counts: "trains with a unit, on time" },
};
/** The foreman of the night, the one person authorised for brake tests (who also runs the lathe), the fitter whose authorisation has run out, the ECM manager. */
export const HANDS = { foreman: "C. Gimpel", tester: "Y. Şahin", lapsed: "V. Ammer", manager: "K. Eisvogel" };

/**
 * The computer's workshop manager, by the book with some judgment: the unit with the shorter job
 * over the pit first, the door's drive on the jacks while the night is young; a finding reported
 * and waited for; a value at its limit measured again; the lathe set to the foreman's guess; a
 * time said with a quarter of an hour in hand; the driver kept at the door while fleet management
 * is phoned; on the phone the compromise. It releases a unit as soon as its work is done and puts
 * it outside.
 */
export class WorkshopPlayer extends Player {
  /** @param {WorkshopGame} g */
  think(g) {
    for (const d of g.open) g.act("decide", d.id, g.advice(d.id));
    this.hands(g);
  }

  /**
   * What is done in the hall without being asked: a unit is released as soon as its work is done
   * (one whose work that may wait is still open: once the night no longer allows it, when nobody
   * works on it at three, or at a quarter to four), and a released unit leaves a hall track that
   * another unit's work needs.
   * @param {WorkshopGame} g
   */
  hands(g) {
    for (const u of g.units) {
      const waits = u.tasks.some((t) => t.state === "open");
      if (g.releasable(u.id).ok && (!waits || (g.t >= S(300) && !g.current(u)) || g.t >= S(345))) g.act("release", u.id);
      else if (u.released_t != null && u.gone_t == null && u.train == null && !u.moving && !g.queued(u.id) && HALL.includes(u.track)) {
        const needs = (track) => g.units.some((x) => x !== u && x.released_t == null && x.gone_t == null && g.t >= x.arrive - S(10) && x.tasks.find((t) => t.state === "open")?.where.includes(track) && !x.tasks.find((t) => t.state === "open").where.includes(x.track));
        if (!needs(u.track)) continue;
        const to = OUTSIDE.find((t) => g.isFree(t)) ?? HALL.find((t) => g.isFree(t) && !needs(t));
        if (to) g.act("move", u.id, to);
      }
    }
  }
}

export class WorkshopGame extends Game {
  static id = "workshop";
  static title = "A night in the hall";
  static role = "workshop-manager";
  static kind = "simulation";
  static description = "The night shift in the hall of a depot: four units with their orders, four trains in the morning, a pit, lifting jacks and a wheel lathe. Do the work that is ordered, release what is done, and know whose decision the rest is.";
  static scale = "minutes";
  static clock = "22:00";
  /** A second of the shift is so many seconds of the day (a mission's shift with this game has this pace). */
  static pace = PACE;
  static takes = [];
  static gives = [
    { flow: "vehicle-release", to: ["ru-control-dispatcher", "ecm-manager", "fleet-manager"] },
    { flow: "incident-report", to: ["ecm-manager"] },
    { flow: "performance-report", to: ["ecm-manager"] },
  ];
  static actions = {
    ...Game.actions,
    move: { label: "Move a unit to a track" },
    release: { label: "Release a unit to service" },
    phone: { label: "Phone fleet management for a unit's return to operation" },
  };
  static player = WorkshopPlayer;
  /**
   * What does not go to plan (`irregular`, with the texts a mission's story names): a finding
   * beyond the order (`unit`, `what`); a value at its limit (`unit`, `what`); the lathe starting
   * again after a cut too shallow (`unit`); work beyond the standing order done without an order,
   * or a unit handed over before its return to operation (`who`, `unit`); a unit that fleet
   * management does not return to operation (`unit`, `what`); a unit it sends back to the hall
   * for a finding written into its release (`unit`, `what`, `who`); a unit that runs with a restriction
   * (`unit`, `what`); a train that leaves late (`train`, `min`) or not at all (`train`); a part
   * that fails in service (`unit`, `what`); a promise not kept (`who`); a complaint in writing
   * (`who`); a release signed by somebody not authorised (`who`).
   */
  static irregularities = ["finding", "limit", "second-pass", "bypassed", "kept", "sent-back", "restricted", "late", "cancelled", "repeat", "promise-broken", "complaint", "void-release"];

  /** @param {{seed?: number, level?: keyof LEVELS, conditions?: object, wired?: Iterable<string>, length?: number}} [options] */
  constructor(options = {}) {
    super({ ...options, level: LEVELS[options.level] ? options.level : "normal" });
    const lv = LEVELS[this.level];
    this.length = options.length ?? S(NIGHT_MIN);
    /**
     * The units: their order, when they come in (`arrive`), where they stand (`track`, null: not in
     * yet or gone), their tasks, their findings, what holds their work (`hold`: a question, an
     * answer awaited, a measurement), how far they are raised on the jacks (`lift`, 0 … 1), when
     * they were released to service, when fleet management is due to return them to operation and
     * when it did, the restrictions they run with, whether fleet management keeps them in, the
     * train they left for and when.
     * @type {Array<object>}
     */
    this.units = UNITS.map((spec) => this._unit(spec, lv));
    /** The trains of the morning: when their unit must leave (`at`), the unit that left for them, how late, whether they were cancelled (`true`, or `"planned"`: in good time). */
    this.pullouts = PULLOUTS.map((p, i) => ({ ...p, n: i, at: S(p.at_min), unit: null, late_min: null, cancelled: false, restricted: false, failed: false, slipped: false, unsafe: false }));
    /** The throat: the move that goes now (`{unit, from, to, kind, t0, t1}`), and those that wait. */
    this.shunt = { now: null, queue: [] };
    /** The one person authorised for brake tests, who also runs the lathe: the task they work on (null: free), and the lathe's task that waits for them. */
    this.tester = { task: null, yielded: null };
    for (const [id, p] of Object.entries(PEOPLE)) this.resource(`mood-${id}`, `${p.label}: patience`, MOOD.start);
    /** Who phoned, who acted at the end of their patience, and what was promised: `{who, what, kept, ...}`. */
    this.called = new Set();
    this.acted = new Set();
    this.promises = [];
    /** The time said to the dispatcher: `{unit, t, kept}`, or null. */
    this.word = null;
    /** The things an open decision is about: its id → items of the picture. */
    this.about = new Map();
    /** What the night adds up: second passes of the lathe, millimetres cut beyond need, good parts scrapped, parts that failed in service, calls at night. */
    this.tally = { second: 0, excess_mm: 0, scrapped: 0, repeats: 0, calls: 0 };
    /** The units a free track was left free for (it is asked about again when another comes), and what else was asked already. */
    this._left = new Map();
    this._asked = new Set();
    this._status = 0;
    this.log(`${hm(0)} The night shift begins: ${this.units.length} units with their orders, ${this.pullouts.length} trains from ${hm(this.pullouts[0].at)}.`);
    for (const u of this.units.filter((x) => x.track)) this.log(`${hm(0)} ${u.name} stands on ${trackOf(u.track).name}: ${u.order}.`, "train");
  }

  /** A unit from its spec: its tasks, and what the seed has hidden in them. */
  _unit(spec, lv) {
    const u = {
      id: spec.id, name: nameOf(spec.id), order: spec.order, arrive: S(spec.arrive_min), track: null, moving: null, tasks: [], findings: [], hold: null, lift: 0,
      released_t: null, rto_due: null, rto_t: null, restrictions: [], kept: false, handed: false, gone_t: null, train: null, fails_t: null, void: false,
    };
    const task = (id, name, where, min, extra = {}) => ({ id, unit: u.id, name, where, work: S(min), done: 0, state: "open", required: true, ordered: true, under: false, lathe: false, tester: false, ...extra });
    for (const id of spec.tasks) {
      if (id === "inspection") u.tasks.push(task(id, "the inspection", ["1"], WORK.inspection_min, { checks: this._checks(u, lv) }));
      else if (id === "pads") u.tasks.push(task(id, "the brake pads", ["1", "2"], WORK.pads_min, { under: true, checks: lv.brake ? [{ at: 0.6, finding: this._extra(u, "b") }] : [] }));
      else if (id === "brake-test") u.tasks.push(task(id, "the brake test", TRACKS.map((t) => t.id), WORK.brake_test_min, { tester: true }));
      else if (id === "door") u.tasks.push(task(id, "the drive of door 3", HALL, WORK.door_min, { required: false }));
      else if (id === "wheel") {
        // the flat: how deep its damage truly goes, and what the foreman guesses
        const r = this.rng("flat", u.id), depth = 1 + Math.round(r.next() * 5) / 2, off = Math.round((2 * r.next() - 1) * lv.guess_mm * 2) / 2;
        const mid = Math.min(LATHE.max - 1, Math.max(LATHE.min + 1, depth + off));
        u.tasks.push(task(id, "the wheelset on the lathe", ["3"], 0, { lathe: true, tester: true, depth, guess: [mid - 1, mid + 1], cut: null, passes: 0, pair: false, measured: false }));
      }
    }
    // (a unit that is in already stands outside, in the order of the list)
    if (u.arrive <= 0) u.track = OUTSIDE[UNITS.filter((x) => x.arrive_min <= 0).findIndex((x) => x.id === spec.id)];
    return u;
  }

  /** What the inspection brings: a finding beyond the order, and on most levels a value at its limit. */
  _checks(u, lv) {
    const out = [{ at: 0.3, finding: this._extra(u, "a") }];
    if (lv.limit) {
      const r = this.rng("limit", u.id), kind = pick(LIMITS, r.next()), reading = pick(READINGS, r.next());
      const truth = Math.round((reading + (2 * r.next() - 1) * GAUGE_MM) * 20) / 20;
      out.push({ at: 0.65, finding: { ...kind, kind: kind.id, id: `${u.id}-${kind.id}`, unit: u.id, type: "limit", reading, truth: truth === 0 ? 0.05 : truth, state: "new" } });
    }
    return out;
  }

  /** A finding beyond the order on a unit, by the seed. */
  _extra(u, key) {
    const r = this.rng("finding", u.id, key), kind = pick(FINDINGS, r.next()), must = r.next() < kind.must;
    const real = Math.round(kind.est[0] + r.next() * (kind.est[1] + 10 - kind.est[0]));
    return { ...kind, kind: kind.id, id: `${u.id}-${kind.id}`, unit: u.id, type: "extra", must_have: must, real_min: real, state: "new" };
  }

  /** A unit of the night by its id ("103"). */
  unit(id) {
    return this.units.find((u) => u.id === String(id)) ?? null;
  }

  /** The patience of one of the three people (0 to 100). */
  mood(who) {
    return Math.round(this.value(`mood-${who}`));
  }

  _mood(who, by) {
    const r = this.resources.get(`mood-${who}`);
    r.value = Math.max(0, Math.min(100, r.value + by));
  }

  /* ---------------------------------------------------------------- the hall as it stands */

  /** Whether a track is free: no unit stands on it, none is on its way to it. */
  isFree(track) {
    const sh = this.shunt;
    return !this.units.some((u) => u.track === track) && sh.now?.to !== track && !sh.queue.some((m) => m.to === track);
  }

  /** Whether a move of a unit waits or goes. */
  queued(unit) {
    return this.shunt.now?.unit === unit || this.shunt.queue.some((m) => m.unit === unit);
  }

  /** The task a unit's crew works on where it stands: the next of its tasks, if this track fits it; else null. */
  current(u) {
    if (!u.track || u.moving || u.released_t != null) return null;
    const next = u.tasks.find((t) => t.state === "open");
    return next?.where.includes(u.track) ? next : null;
  }

  /** What is left of a unit's work that must be done before it is released (s of the shift, as far as it is known). */
  left(u) {
    return u.tasks.filter((t) => t.state === "open" && t.required).reduce((s, t) => s + Math.max(0, (t.lathe && t.cut == null ? S(LATHE.setup_min + LATHE.per_mm_min * (t.guess[0] + t.guess[1]) / 2) : t.work) - t.done), 0);
  }

  /**
   * When a unit is expected to be released (s of the shift): its work, the way to its track where
   * it does not stand on one that fits, and the unit that is in its way there.
   */
  eta(u) {
    if (u.released_t != null) return u.released_t;
    const lv = LEVELS[this.level], next = u.tasks.find((t) => t.state === "open" && t.required);
    let t = Math.max(this.t, u.arrive) + this.left(u) / lv.rate;
    if (u.hold?.until) t += Math.max(0, u.hold.until - this.t);
    if (next && !next.where.includes(u.track)) {
      t += S(MOVE.shunt_min);
      // (work that can be done on one track only waits for the unit that stands there)
      if (next.where.length === 1) for (const x of this.units.filter((y) => y !== u && y.released_t == null && y.track === next.where[0])) t += this.left(x) / lv.rate + S(MOVE.shunt_min);
    }
    return t;
  }

  /** Whether a unit can be released to service now, and why not. */
  releasable(id) {
    const u = this.unit(id);
    if (!u || u.gone_t != null) return { ok: false, reason: "There is no such unit in the depot." };
    if (u.released_t != null) return { ok: false, reason: `${u.name} is released.` };
    if (!u.track || u.moving) return { ok: false, reason: `${u.name} is on the move.` };
    if (u.hold) return { ok: false, reason: u.hold.why === "decision" ? `A question about ${u.name} is open.` : `${u.name} waits for ${u.hold.why === "measure" ? "a measurement" : `${PEOPLE[u.hold.why].name}'s answer`}.` };
    const open = u.tasks.find((t) => t.state === "open" && t.required);
    if (open) return { ok: false, reason: `${open.name[0].toUpperCase()}${open.name.slice(1)} of ${u.name} is not done: there is nothing to release yet.` };
    if (u.lift > 0) return { ok: false, reason: `${u.name} is still on the jacks.` };
    return { ok: true };
  }

  /* ---------------------------------------------------------------- the player's moves */

  /**
   * Move a unit to a track: through the throat, one move at a time. Work on it stops while it moves
   * and goes on where its new track fits.
   * @param {string} unit
   * @param {string} track
   * @returns {{ok: boolean, reason?: string}}
   */
  move(unit, track) {
    const u = this.unit(unit), to = trackOf(String(track));
    if (!u || u.gone_t != null || this.t < u.arrive) return { ok: false, reason: "There is no such unit in the depot." };
    if (!to) return { ok: false, reason: "There is no such track." };
    if (!u.track || u.moving || this.queued(u.id)) return { ok: false, reason: `${u.name} is on the move.` };
    if (u.track === to.id) return { ok: false, reason: `${u.name} stands there.` };
    if (!this.isFree(to.id)) return { ok: false, reason: `${to.name[0].toUpperCase()}${to.name.slice(1)} is not free.` };
    const cur = this.current(u);
    if (cur?.lathe && cur.done > 0) return { ok: false, reason: `${u.name} has a wheelset in the lathe: not before the cut is done.` };
    if (cur?.tester && this.tester.task === cur) return { ok: false, reason: `${u.name} is in its brake test.` };
    this.shunt.queue.push({ unit: u.id, from: u.track, to: to.id, kind: "shunt" });
    for (const id of HALL) this._drop(`free-${id}`);
    this.log(`${hm(this.t)} Order: ${u.name} to ${to.name}${to.hall ? `, ${to.what}` : ""}.`, "request");
    return { ok: true };
  }

  /**
   * Release a unit to service: the work ordered is done as the maintenance file says, and what was
   * found and not repaired is written in. Fleet management then returns it to operation.
   * @param {string} unit
   * @returns {{ok: boolean, reason?: string}}
   */
  release(unit) {
    const can = this.releasable(unit);
    if (!can.ok) return can;
    const u = this.unit(unit), lv = LEVELS[this.level], r = this.rng("rto", u.id);
    u.released_t = this.t;
    const open = [...u.tasks.filter((t) => t.state === "open").map((t) => t.name), ...u.findings.filter((f) => f.state === "noted").map((f) => f.what)];
    u.rto_due = this.t + S(lv.rto[0] + r.next() * (lv.rto[1] - lv.rto[0]) + (this.acted.has("fleet") ? ON_CALL.slow_min : 0));
    this.give("vehicle-release", { unit: u.name, released: hm(this.t), work_done: u.tasks.filter((t) => t.state === "done").map((t) => t.name), open, signed_by: u.void ? HANDS.lapsed : HANDS.foreman });
    this.log(`${hm(this.t)} ${u.name} is released to service${open.length ? `, written in as open: ${open.join("; ")}` : ""}. Its return to operation is ${PEOPLE.fleet.name}'s.`, "request");
    this._mood("fleet", this.t > S(OUT_BY_MIN) ? MOOD.after_four : MOOD.released);
    if (this.word?.unit === u.id && this.word.kept == null && this.t <= this.word.t + S(GRACE_MIN)) {
      this.word.kept = true;
      // (what the dispatcher's patience truly gained, below its top of 100: a release sent back takes back that)
      const was = this.resources.get("mood-dispatch").value;
      this._mood("dispatch", MOOD.kept_word);
      this.word.gave = this.resources.get("mood-dispatch").value - was;
      this.log(`${hm(this.t)} ${u.name} is out by the time said to ${PEOPLE.dispatch.name}.`, "request");
    }
    this._patience("fleet");
    return { ok: true };
  }

  /**
   * Phone fleet management for the return to operation of a released unit: it comes within two
   * minutes, and it is a call at night.
   * @param {string} unit
   * @returns {{ok: boolean, reason?: string}}
   */
  phone(unit) {
    const u = this.unit(unit);
    if (!u || u.gone_t != null) return { ok: false, reason: "There is no such unit in the depot." };
    if (u.released_t == null) return { ok: false, reason: `${u.name} is not released to service yet.` };
    if (u.rto_t != null || u.kept) return { ok: false, reason: `${PEOPLE.fleet.name} has decided on ${u.name}.` };
    if (u.phoned) return { ok: false, reason: `${PEOPLE.fleet.name} has been phoned about ${u.name}.` };
    u.phoned = true;
    u.rto_due = Math.min(u.rto_due, this.t + S(ON_CALL.quick_min));
    this._nightCall("fleet");
    this.log(`${hm(this.t)} Phoned ${PEOPLE.fleet.name} for the return to operation of ${u.name}.`, "request");
    this._patience("fleet");
    return { ok: true };
  }

  /* ---------------------------------------------------------------- moves through the throat */

  /** Units come in from their last run, onto a free stabling track. */
  _arrivals() {
    for (const u of this.units) {
      if (u.track || u.gone_t != null || u.arrived || this.t < u.arrive || this.queued(u.id)) continue;
      const to = OUTSIDE.find((t) => this.isFree(t)) ?? TRACKS.map((t) => t.id).find((t) => this.isFree(t));
      if (!to) continue;
      u.arrived = true;
      this.shunt.queue.unshift({ unit: u.id, from: null, to, kind: "in" });
      this.log(`${hm(this.t)} ${u.name} comes in from its last run: ${u.order}.`, "train");
    }
  }

  /** The throat: the move that goes ends, the next begins (a unit on the jacks is lowered first). */
  _shunt() {
    const sh = this.shunt;
    if (sh.now && this.t >= sh.now.t1) {
      const m = sh.now, u = this.unit(m.unit);
      sh.now = null;
      u.moving = null;
      if (m.kind === "out") {
        u.track = null;
        u.gone_t = this.t;
      } else {
        u.track = m.to;
        this._left.delete(m.to);
        this.log(`${hm(this.t)} ${u.name} stands on ${trackOf(m.to).name}.`, "train");
      }
    }
    if (sh.now || !sh.queue.length) return;
    const i = sh.queue.findIndex((m) => !(this.unit(m.unit).lift > 0));
    if (i < 0) return;
    const [m] = sh.queue.splice(i, 1), u = this.unit(m.unit);
    Object.assign(m, { t0: this.t, t1: this.t + S(m.kind === "in" ? MOVE.in_min : m.kind === "out" ? MOVE.out_min : MOVE.shunt_min) });
    sh.now = m;
    u.moving = m;
    if (this.tester.yielded?.unit === u.id) this.tester.yielded = null;
  }

  /* ---------------------------------------------------------------- the work */

  /** The crews work: every unit's task where it stands, the jacks, the one tester, what a task brings to light. */
  _work(dt) {
    const lv = LEVELS[this.level], T = this.tester;
    for (const u of this.units) {
      // (a unit that is to move is lowered, and nobody works on it meanwhile)
      const leaving = this.queued(u.id), cur = leaving ? null : this.current(u), lifted = !!cur && cur.under && u.track === "2" && !u.hold;
      // the jacks: up for work under the floor on track 2, down for everything else
      const want = lifted ? 1 : 0, step = dt / S(MOVE.lift_min);
      u.lift = want ? Math.min(1, u.lift + step) : Math.max(0, u.lift - step);
      if (!cur || u.hold) continue;
      if (cur.under && u.track === "2" && u.lift < 1) continue;
      if (cur.lathe && cur.cut == null) {
        this._askCut(u, cur);
        continue;
      }
      if (cur.tester) {
        if (T.task && T.task !== cur) {
          // the tester is at the lathe (or at a brake test): the brake test asks, the lathe waits
          if (!cur.lathe && T.task.lathe && T.yielded !== T.task) this._askTester(u, cur);
          continue;
        }
        if (cur.lathe && T.yielded === cur) continue;
        T.task = cur;
      }
      const before = cur.done;
      cur.done = Math.min(cur.work, cur.done + dt * lv.rate);
      for (const c of cur.checks ?? []) {
        if (!c.seen && before < c.at * cur.work && cur.done >= c.at * cur.work) {
          c.seen = true;
          this._found(u, c.finding);
        }
      }
      if (cur.done >= cur.work - 1e-9 && !u.hold) this._taskDone(u, cur);
    }
    // the lathe's task goes on once the tester is back from a brake test
    if (T.yielded && !T.task) T.yielded = null;
  }

  /** A task is done: the lathe's cut is checked, the tester is free, the log has it. */
  _taskDone(u, task) {
    const T = this.tester;
    if (task.lathe) {
      task.passes++;
      if (task.cut < task.depth - 1e-9) {
        // the flat still shows: set up again, cut to below the damage
        const rest = task.depth + LATHE.below_mm - task.cut, was = task.pair;
        task.cut += rest;
        task.pair = task.cut > LATHE.pair_mm + 1e-9;
        task.work += S(LATHE.again_min + LATHE.per_mm_min * rest * (task.pair ? 2 : 1) + (task.pair && !was ? LATHE.setup_min + LATHE.per_mm_min * (task.cut - rest) : 0));
        this.tally.second++;
        this.log(`${hm(this.t)} ${u.name}: the flat still shows after the cut. ${HANDS.tester} sets up again and cuts ${mm(rest)} mm more${task.pair && !was ? `; the other wheelset of the bogie must follow now` : ""}.`, "fault");
        this.irregular("second-pass", `second:${u.id}`, { unit: u.name });
        // (a brake test that waited for this cut is done before the lathe is set up again)
        if (this.units.some((x) => !x.hold && this.current(x)?.id === "brake-test")) {
          T.task = null;
          T.yielded = task;
        }
        return;
      }
      const excess = Math.max(0, task.cut - task.depth - LATHE.below_mm) * (task.pair ? 2 : 1);
      this.tally.excess_mm += excess;
      if (excess >= 0.5) this._mood("development", MOOD.excess_mm * excess);
      else if (task.passes === 1) this._mood("development", MOOD.fits);
      this.log(`${hm(this.t)} ${u.name}: the wheelset is round again, ${mm(task.cut)} mm cut${task.pair ? " on both wheelsets of the bogie" : ""}${excess >= 0.5 ? `, ${mm(excess)} mm more than the flat needed: ${Math.round((excess * LATHE.life_km) / 1000)} 000 km of wheel life` : ""}.`, "train");
      this._patience("development");
    } else if (task.id === "brake-test") this.log(`${hm(this.t)} ${u.name}: brake test done and signed by ${u.void ? HANDS.lapsed : HANDS.tester}.`, "train");
    else this.log(`${hm(this.t)} ${u.name}: ${task.name} ${task.name.endsWith("s") ? "are" : "is"} done.`, "train");
    task.state = "done";
    if (T.task === task) T.task = null;
    this._drop("brake-test");
  }

  /* ---------------------------------------------------------------- what is asked */

  /** Take back a question and what it is about. */
  _drop(id) {
    if (this.withdraw(id)) this.about.delete(id);
  }

  /** A night call to one of the people on call. */
  _nightCall(who) {
    this.tally.calls++;
    this._mood(who, who === "fleet" ? MOOD.night_call : MOOD.dev_call);
  }

  /** How long somebody on call takes to answer (s of the shift). */
  _answer(who, key) {
    const [a, b] = ON_CALL[who], lv = LEVELS[this.level];
    return S((a + this.rng("answer", who, key).next() * (b - a)) * lv.answer + (who === "fleet" && this.acted.has("fleet") ? ON_CALL.slow_min : 0));
  }

  /** A hall track is free and units with work for it stand outside: who goes in? One of a few choices. */
  _askFree() {
    if (this.t < FIRST_S || this.open.some((d) => d.id.startsWith("free-"))) return;
    for (const id of HALL) {
      if (!this.isFree(id)) continue;
      const cands = this.units.filter((u) => u.track && !HALL.includes(u.track) && !u.moving && !this.queued(u.id) && u.released_t == null && u.tasks.some((t) => t.state === "open" && t.where.includes(id) && t.where.length < TRACKS.length));
      const left = this._left.get(id);
      if (!cands.length || (left && cands.every((u) => left.has(u.id)))) continue;
      const tr = trackOf(id), qid = `free-${id}`;
      this.about.set(qid, [`track-${id}`, ...cands.map((u) => `unit-${u.id}`)]);
      const names = cands.map((u) => u.name), list = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0];
      const coming = this.units.filter((u) => !u.track && u.gone_t == null && this.t < u.arrive);
      this.ask({
        id: qid, title: `${tr.name[0].toUpperCase()}${tr.name.slice(1)}, ${tr.what}, is free. ${cands.length > 1 ? `Who goes in: ${list}?` : `Does ${list} go in?`}`,
        text: `A unit on a track keeps it until its work there is done or you move it out. The inspection needs the pit, the brake pads the pit or the jacks, a wheelset the lathe, the door's drive any hall track. `
          + `Every move takes ${MOVE.shunt_min} min, and one goes at a time. ${coming.length ? `Still to come: ${coming.map((u) => `${u.name} at about ${hm(u.arrive)} (${u.order.split(",")[0].split(":")[0]})`).join(", ")}. ` : ""}`
          + `You can move a unit at any time: tap it in the hall.`,
        options: [
          ...cands.map((u) => ({ id: u.id, label: u.name, hint: u.tasks.filter((t) => t.state === "open" && t.where.includes(id)).map((t) => `${t.name}${t.required ? "" : " (if the night allows)"}`).join(", ") })),
          { id: "leave", label: "Leave it free for now" },
        ],
        fallback: "leave",
        then: (x) => {
          this.about.delete(qid);
          if (x === "leave") {
            this._left.set(id, new Set(cands.map((u) => u.id)));
            this.log(`${hm(this.t)} ${tr.name[0].toUpperCase()}${tr.name.slice(1)} stays free for now.`, "request");
          } else this.move(x, id);
        },
      });
      return;
    }
  }

  /** A fitter finds something: a finding beyond the order, or a value at its limit. The unit's work waits for the word. */
  _found(u, f) {
    u.findings.push(f);
    u.hold = { why: "decision" };
    if (f.type === "limit") this._askLimit(u, f);
    else this._askFinding(u, f);
  }

  /** A finding beyond the order: whose decision? One of a few choices. */
  _askFinding(u, f) {
    const id = `finding-${f.id}`, p = PEOPLE.fleet, strict = this.promises.some((x) => x.who === "fleet" && x.strict && x.kept == null);
    const guess = f.must >= 0.7 ? "That they will want done before it runs, I would say." : f.must <= 0.3 ? "With that it can run, I would say." : "That can go either way.";
    f.state = "asked";
    this.about.set(id, [`unit-${u.id}`]);
    this.log(`${hm(this.t)} ${HANDS.foreman}: on ${u.name}, ${f.what}. Not in the order.`, "fault");
    this.irregular("finding", `finding:${f.id}`, { unit: u.name, what: f.what, who: HANDS.foreman });
    this.ask({
      id, title: `${HANDS.foreman}, the foreman, from under ${u.name}: “${f.what[0].toUpperCase()}${f.what.slice(1)}. It is not in the order. ${guess}”`,
      text: `Ask and the track waits for the answer; repair it unasked and it may be more than you may. The order is fleet management's. `
        + `${HANDS.foreman} reckons ${f.est[0]} to ${f.est[1]} min for the repair. Fleet management's standing order covers findings up to ${STANDING_MIN} min of work; beyond it, what is repaired and what may wait is ${p.name}'s decision. `
        + `${p.name} is on call and takes ${mins(S(ON_CALL.fleet[0]))} to ${mins(S(ON_CALL.fleet[1]))} min to answer; nobody works on ${u.name} meanwhile. `
        + `Written into the release as found, nobody is woken and the order goes on: fleet management decides at the return to operation. If it wants the repair then, the release comes back and the unit with it, into the hall again, the crew set up for it again (${WORK.reopen_min} min), and the repair.${strict ? ` You promised ${p.name}: nothing without an order.` : ""}`,
      options: [
        { id: "ask", label: `Phone ${p.name} and wait for the order` },
        ...(strict ? [] : [{ id: "do", label: "Repair it now, under the standing order" }]),
        { id: "note", label: "Go on with the order; it goes into the release" },
      ],
      fallback: "ask",
      then: (x) => {
        this.about.delete(id);
        if (x === "ask") {
          f.state = "fleet";
          u.hold = { why: "fleet", until: this.t + this._answer("fleet", f.id), finding: f };
          this._nightCall("fleet");
          this.log(`${hm(this.t)} Phoned ${p.name} about ${u.name}: ${f.what}.`, "request");
          this._patience("fleet");
        } else if (x === "do") {
          u.hold = null;
          this._repair(u, f, false);
          this.log(`${hm(this.t)} Order to ${HANDS.foreman}: repair it now.`, "request");
        } else {
          u.hold = null;
          f.state = "noted";
          this.log(`${hm(this.t)} ${u.name}: the finding goes into the release; the order goes on.`, "request");
        }
      },
    });
  }

  /** A repair of a finding becomes a task of the unit, before what is left of its order. */
  _repair(u, f, ordered) {
    f.state = "task";
    const where = ["1", "2"], i = Math.max(0, u.tasks.findIndex((t) => t.state === "open"));
    u.tasks.splice(i, 0, { id: `repair-${f.id}`, unit: u.id, name: f.type === "limit" ? `the new ${f.part}` : "the repair of the finding", where, work: S(f.type === "limit" ? WORK.change_min : f.real_min), done: 0, state: "open", required: true, ordered, under: true, lathe: false, tester: false, finding: f });
  }

  /** Fleet management answers about a finding: repaired tonight, or it runs with a restriction. */
  _fleetAnswers(u, f) {
    const p = PEOPLE.fleet;
    u.hold = null;
    if (f.must_have) {
      this._repair(u, f, true);
      this.log(`${hm(this.t)} ${p.name}: "Repair it tonight. ${u.name} does not run with that." The order is extended.`, "request");
    } else {
      f.state = "deferred";
      u.restrictions.push(f.restriction);
      this.log(`${hm(this.t)} ${p.name}: "It runs as it is: ${f.restriction}. I book the repair for another night."`, "request");
    }
  }

  /** A repair is done: was it within the standing order? */
  _repaired(u, task) {
    const f = task.finding;
    f.state = "repaired";
    if (f.type !== "extra" || task.ordered) return;
    if (f.real_min > STANDING_MIN) {
      this._mood("fleet", MOOD.bypassed);
      this.violate("order", `${hm(this.t)} ${u.name}: ${f.real_min} min of work without an order (${f.what}). The standing order covers ${STANDING_MIN} min; the rest was ${PEOPLE.fleet.name}'s to decide.`, 1);
      this.irregular("bypassed", `bypassed:${f.id}`, { who: PEOPLE.fleet.name, unit: u.name });
      const pr = this.promises.find((x) => x.who === "fleet" && x.kept == null);
      if (pr) this._broken(pr, `${f.real_min} min of work on ${u.name} without an order`);
      this._patience("fleet");
    } else this.log(`${hm(this.t)} ${u.name}: repaired in ${f.real_min} min, within the standing order.`, "train");
  }

  /** A value at its limit: whose limit? One of a few choices. */
  _askLimit(u, f) {
    const id = `limit-${f.id}`, p = PEOPLE.development, over = f.reading < 0, refused = this.acted.has("development");
    const twice = this.promises.some((x) => x.who === "development" && x.kept == null);
    f.state = "asked";
    this.about.set(id, [`unit-${u.id}`]);
    const says = over ? `${mm(-f.reading)} mm under its ${f.of}` : f.reading === 0 ? `on its ${f.of} to the tenth` : `${mm(f.reading)} mm above its ${f.of}`;
    this.log(`${hm(this.t)} ${HANDS.foreman}: on ${u.name}, ${f.what} measures ${says}.`, "fault");
    this.irregular("limit", `limit:${f.id}`, { unit: u.name, what: f.what, who: HANDS.foreman });
    this.ask({
      id, title: `${HANDS.foreman}, the foreman: “${f.what[0].toUpperCase()}${f.what.slice(1)} of ${u.name} measures ${says}. The gauge is good for half a millimetre.”`,
      text: `You can measure and you can change the part; to let it run under its limit is not yours to decide. The limit is in the maintenance file, and the file is maintenance development's: only ${p.name} can let a part run that is under it. `
        + `A second measurement takes ${WORK.measure_min} min and settles which side of the limit it is; changing the ${f.part} takes ${WORK.change_min} min, from the pit or on the jacks. `
        + `${refused ? `${p.name} gives no concessions any more tonight. ` : `${p.name} is on call, takes ${mins(S(ON_CALL.development[0]))} to ${mins(S(ON_CALL.development[1]))} min, and may let it run with a restriction or say no. `}`
        + `${over ? "" : "Taken as read, nothing is done: if the part is truly under its limit, it fails in service. "}Nobody works on ${u.name} until this is decided.${twice ? ` You promised ${p.name} a second measurement first.` : ""}`,
      options: [
        { id: "again", label: `Measure again (${WORK.measure_min} min)` },
        { id: "change", label: `Change the ${f.part} (${WORK.change_min} min)` },
        ...(refused ? [] : [{ id: "concession", label: `Phone ${p.name} for a concession` }]),
        ...(over ? [] : [{ id: "within", label: "Take the reading: it is within its limit" }]),
      ],
      fallback: "again",
      then: (x) => {
        this.about.delete(id);
        const pr = this.promises.find((y) => y.who === "development" && y.kept == null);
        if (pr && x !== "again") this._broken(pr, `${f.what} of ${u.name} was decided on one reading`);
        if (x === "again") {
          u.hold = { why: "measure", until: this.t + S(WORK.measure_min), finding: f };
          this.log(`${hm(this.t)} Order to ${HANDS.foreman}: measure ${f.what} again, with the other gauge.`, "request");
        } else if (x === "change") {
          u.hold = null;
          this._change(u, f);
        } else if (x === "concession") {
          f.state = "development";
          u.hold = { why: "development", until: this.t + this._answer("development", f.id), finding: f };
          this._nightCall("development");
          this.log(`${hm(this.t)} Phoned ${p.name} about ${f.what} of ${u.name}.`, "request");
          this._patience("development");
        } else {
          u.hold = null;
          f.state = "within";
          this.log(`${hm(this.t)} ${u.name}: ${f.what} is written in as within its limit.`, "request");
        }
      },
    });
  }

  /** The part at its limit is changed. */
  _change(u, f) {
    if (f.truth >= GOOD_MM) {
      this.tally.scrapped++;
      this._mood("development", MOOD.scrapped);
    }
    this._repair(u, f, true);
    this.log(`${hm(this.t)} ${u.name}: the ${f.part} is changed${f.truth >= GOOD_MM ? ` (it had ${mm(f.truth)} mm left, as the old part shows on the bench)` : ""}.`, "request");
    this._patience("development");
  }

  /** The second measurement is in, or maintenance development answers. */
  _answers() {
    for (const u of this.units) {
      const h = u.hold;
      if (!h?.until || this.t < h.until) continue;
      const f = h.finding, p = PEOPLE.development;
      if (h.why === "fleet") this._fleetAnswers(u, f);
      else if (h.why === "measure") {
        u.hold = null;
        if (f.truth >= 0) {
          f.state = "clear";
          this.log(`${hm(this.t)} ${u.name}: measured again, ${f.what} is ${mm(f.truth)} mm above its limit. It stays.`, "train");
        } else {
          this.log(`${hm(this.t)} ${u.name}: measured again, ${f.what} is ${mm(-f.truth)} mm under its limit.`, "fault");
          this._change(u, f);
        }
      } else if (h.why === "development") {
        u.hold = null;
        if (f.truth >= CONCESSION_MM) {
          f.state = "concession";
          u.restrictions.push(f.restriction);
          this.log(`${hm(this.t)} ${p.name}: "Send me both readings. It may run: ${f.restriction}." The concession goes into the file.`, "request");
        } else {
          this.log(`${hm(this.t)} ${p.name}: "With those readings, no. Change it."`, "request");
          this._change(u, f);
        }
      }
    }
  }

  /** A wheelset is on the lathe: how deep does it cut? A number, and beside it: measure first. */
  _askCut(u, task) {
    const id = `cut-${u.id}`;
    if (this.open.some((d) => d.id === id)) return;
    const twice = this.promises.some((x) => x.who === "development" && x.twice && x.kept == null);
    if (twice && !task.measured) return this._measureFlat(u, task);
    const [lo, hi] = task.guess, value = Math.min(LATHE.max, Math.max(LATHE.min, Math.ceil(((lo + hi) / 2) * 2) / 2));
    const time = (x) => LATHE.setup_min + LATHE.per_mm_min * x;
    u.hold = { why: "decision" };
    this.about.set(id, [`unit-${u.id}`, "track-3"]);
    this.ask({
      id, title: `${u.name} is on the lathe. ${HANDS.tester}: “The flat's damage goes ${mm(lo)} to ${mm(hi)} mm deep${task.measured ? ", measured" : ", I would say"}. How deep do I cut?”`,
      text: `Cut too little and the lathe sets up again; cut too much and wheel life is gone. `
        + `The maintenance file asks for ${mm(LATHE.below_mm)} mm below the damage, and limits the difference of diameters in a bogie: above ${LATHE.pair_mm} mm the other wheelset of the bogie must be cut to match. A cut of ${mm(value)} mm takes ${time(value)} min, each millimetre more ${LATHE.per_mm_min} min, a second set-up ${LATHE.again_min} min, and the other wheelset as long again. `
        + `Every millimetre of diameter is about ${LATHE.life_km / 1000} 000 km of the wheel's life: that is ${PEOPLE.development.name}'s count.${task.measured ? "" : ` Measuring the damage first takes ${WORK.measure_min} min and says it to half a millimetre.`}`,
      scale: { min: LATHE.min, max: LATHE.max, step: LATHE.step, unit: "mm", value, label: "The lathe cuts" },
      options: task.measured ? [] : [{ id: "measure", label: `Measure the damage first (${WORK.measure_min} min)` }],
      fallback: value,
      then: (x) => {
        this.about.delete(id);
        u.hold = null;
        if (x === "measure") return this._measureFlat(u, task);
        task.cut = Number(x);
        task.pair = task.cut > LATHE.pair_mm + 1e-9;
        task.work = S(time(task.cut) * (task.pair ? 2 : 1));
        this.log(`${hm(this.t)} Order to ${HANDS.tester}: cut ${mm(task.cut)} mm${task.pair ? ", both wheelsets of the bogie" : ""}.`, "request");
      },
    });
  }

  /** The flat's damage is measured before the cut: ten minutes, and the guess becomes less than half a millimetre wide. */
  _measureFlat(u, task) {
    task.measured = true;
    task.guess = [task.depth - 0.2, task.depth + 0.2].map((v) => Math.round(v * 10) / 10);
    u.hold = { why: "measure", until: this.t + S(WORK.measure_min), finding: { truth: 1, what: "the flat", state: "flat" }, flat: true };
    this.log(`${hm(this.t)} ${HANDS.tester} measures the flat's damage on ${u.name} before the cut.`, "request");
  }

  /** The brake test is due and the one tester is at the lathe: who gives way? One of a few choices. */
  _askTester(u, task) {
    const id = "brake-test", lathe = this.tester.task;
    if (this.open.some((d) => d.id === id) || this._asked.has(`${id}:${u.id}`)) return;
    this._asked.add(`${id}:${u.id}`);
    const other = this.unit(lathe.unit), left = mins(Math.max(0, lathe.work - lathe.done));
    this.about.set(id, [`unit-${u.id}`, `unit-${other.id}`]);
    this.ask({
      id, title: `${u.name} needs its brake test, and ${HANDS.tester}, the one person authorised for it tonight, is cutting the wheelset of ${other.name}.`,
      text: `The lathe stops for the test, or the unit waits for the lathe: the signature must be an authorised one. `
        + `The brake test takes ${WORK.brake_test_min} min; the lathe has about ${left} min left on ${other.name}. `
        + `${HANDS.lapsed} changed the pads and has done a hundred brake tests; the authorisation ran out in October, the refresher is booked for next week. A release signed by somebody not authorised is no release.`,
      options: [
        { id: "now", label: `${HANDS.tester} tests now; the lathe waits` },
        { id: "after", label: `After the lathe's cut; ${u.name} waits` },
        { id: "other", label: `${HANDS.lapsed} tests and signs` },
      ],
      fallback: "after",
      then: (x) => {
        this.about.delete(id);
        if (x === "now") {
          this.tester.yielded = lathe;
          this.tester.task = null;
          this.log(`${hm(this.t)} Order: ${HANDS.tester} leaves the lathe for the brake test of ${u.name}.`, "request");
        } else if (x === "other") {
          u.void = true;
          task.tester = false;
          this.log(`${hm(this.t)} Order: ${HANDS.lapsed} does the brake test of ${u.name}.`, "request");
          this.violate("authorisation", `${hm(this.t)} The brake test of ${u.name} was signed by ${HANDS.lapsed}, whose authorisation has run out: the release to service is void, and ${HANDS.manager} answers for it to the certification body.`, 3);
          this.give("incident-report", { unit: u.name, what: "a release signed without authorisation", by: HANDS.lapsed });
          this.irregular("void-release", `void:${u.id}`, { who: HANDS.lapsed, unit: u.name });
        } else this.log(`${hm(this.t)} ${u.name} waits for ${HANDS.tester}.`, "request");
      },
    });
  }

  /** The dispatcher asks for a time: when is the unit that is furthest from done released? A number of minutes. */
  _askWord() {
    if (this.word || this._asked.has("word") || this.t < S(PROMISE_AT_MIN)) return;
    this._asked.add("word");
    const open = this.units.filter((u) => u.released_t == null && u.gone_t == null && u.tasks.some((t) => t.state === "open" && t.required));
    if (!open.length) return;
    const u = open.sort((a, b) => this.eta(b) - this.eta(a))[0], p = PEOPLE.dispatch, last = this.pullouts.at(-1);
    const guess = Math.max(10, mins(this.eta(u) - this.t)), value = Math.min(150, Math.ceil(guess / 5) * 5), limit = mins(last.at - this.t) - RTO_GUESS_MIN;
    this.about.set("word", [`unit-${u.id}`]);
    this.log(`${hm(this.t)} ${p.name}, ${p.role}, is on the phone.`, "request");
    this.ask({
      id: "word", title: `${p.name}, ${p.role}, is on the phone: “At half past three I fix the morning. When is ${u.name} released? I plan by your word.”`,
      text: `Too early a time and a train stands without its unit; too late and one is cancelled that could have run. `
        + `As it stands, ${u.name} needs about ${guess} min more, if nothing else is found. The last train wants its unit at ${hm(last.at)}, and fleet management needs some ${RTO_GUESS_MIN} min for the return to operation: `
        + `said later than ${limit} min from now, ${p.name} plans without ${u.name} and cancels the ${hm(last.at)} in good time. A time said and missed is a train cancelled at the platform.`,
      scale: { min: 10, max: 150, step: 5, unit: "min", value, label: `${u.name} is released in at most` },
      within: DECIDE_S.call, fallback: value,
      then: (n) => {
        this.about.delete("word");
        this.word = { unit: u.id, t: this.t + S(Number(n)), kept: null };
        this.log(`${hm(this.t)} Said to ${p.name}: ${u.name} is released by ${hm(this.word.t)}.`, "request");
        if (Number(n) > limit) {
          const pl = this.pullouts.filter((x) => x.unit == null && !x.cancelled).at(-1);
          if (pl) {
            pl.cancelled = "planned";
            this._mood("dispatch", MOOD.planned);
            this.log(`${hm(this.t)} ${p.name}: "Then the ${hm(pl.at)} ${pl.id} does not run. I tell the passengers now."`, "request");
            this.irregular("cancelled", `cancelled:${pl.n}`, { train: `${hm(pl.at)} ${pl.id} to ${pl.to}`, who: p.name });
            this._patience("dispatch");
          }
        }
      },
    });
  }

  /** The time said to the dispatcher is over and the unit is not released. */
  _wordDue() {
    const w = this.word;
    if (!w || w.kept != null || this.t <= w.t + S(GRACE_MIN)) return;
    w.kept = false;
    this._mood("dispatch", MOOD.broken);
    this.violate("promise", `${hm(this.t)} Said to ${PEOPLE.dispatch.name}: ${nameOf(w.unit)} is released by ${hm(w.t)}. It is not.`, 2);
    this.irregular("promise-broken", "promise:word", { who: PEOPLE.dispatch.name });
    this._patience("dispatch");
  }

  /** A train is due, a unit is released to service and not yet returned to operation, its driver stands at the door. One of a few choices. */
  _askDoor(pl, u) {
    const id = `door-${u.id}`, p = PEOPLE.fleet;
    // (once for a unit and a train: a driver who was told to wait does not ask again for the same train)
    if (this._asked.has(`${id}:${pl.n}`) || this.open.some((d) => d.id === id)) return;
    this._asked.add(`${id}:${pl.n}`);
    const open = u.findings.filter((f) => f.state === "noted").length;
    // (phoned for already, fleet management is not phoned again: the answer is on its way)
    const phoned = !!u.phoned;
    this.about.set(id, [`unit-${u.id}`]);
    this.ask({
      id, title: `The driver of the ${hm(pl.at)} ${pl.id} stands at ${u.name}: “It is released, the paper lies on the desk. Do I take it?”`,
      text: `Released to service is not returned to operation: that word is fleet management's, and it has not come. `
        + `${p.name} may know what the hall does not: a restriction, an open campaign, a booking. ${open ? `${plural(open, "finding")} of tonight ${open === 1 ? "is" : "are"} written into this release as open. ` : ""}`
        + `${u.void ? `Its brake test is signed by ${HANDS.lapsed}, whose authorisation has run out. ` : ""}`
        + `${phoned ? `${p.name} has been phoned about it: the answer is on its way. ` : `Phoned, ${p.name} answers within ${ON_CALL.quick_min} min, and it is another call at night. Without a call the return to operation comes when it comes. `}The train waits ${LATE_MAX_MIN} min at most.`,
      options: [
        ...(phoned ? [] : [{ id: "phone", label: `Phone ${p.name} now; the driver waits` }]),
        { id: "wait", label: "The driver waits for the return to operation" },
        { id: "go", label: "Take it: it is released" },
      ],
      within: DECIDE_S.door, fallback: "wait",
      then: (x) => {
        this.about.delete(id);
        // (fleet management has decided meanwhile: there is nothing left to hand over)
        if (u.rto_t != null || u.kept || u.gone_t != null || u.released_t == null) return;
        if (x === "phone") this.phone(u.id);
        else if (x === "go") this._handOver(u);
        else this.log(`${hm(this.t)} The driver of the ${hm(pl.at)} waits at ${u.name}.`, "request");
      },
    });
  }

  /** A unit goes to its driver without its return to operation. */
  _handOver(u) {
    const p = PEOPLE.fleet, must = u.findings.find((f) => f.state === "noted" && f.must_have);
    // (what fleet management would have kept it in for: a finding that must be repaired, a brake test nobody authorised signed)
    const unsafe = must?.what ?? (u.void ? `a brake test signed by ${HANDS.lapsed}, whose authorisation has run out` : null);
    const unsaid = [...u.findings.filter((f) => f.state === "noted" && !f.must_have).map((f) => f.restriction), ...(u.tasks.some((t) => t.id === "door" && t.state === "open") ? ["door 3 locked"] : [])];
    u.handed = true;
    u.rto_t = this.t;
    this._mood("fleet", MOOD.handed);
    this.violate("return-to-operation", `${hm(this.t)} ${u.name} went to its driver without a return to operation. That decision is fleet management's, not the workshop's.`, 2);
    this.irregular("bypassed", `handed:${u.id}`, { who: p.name, unit: u.name });
    this.log(`${hm(this.t)} ${u.name} is handed to its driver on the release alone.`, "request");
    if (unsafe) {
      u.unsafe = true;
      this.violate("unsafe", `${hm(this.t)} ${u.name} runs with ${unsafe}: ${p.name} would not have returned it to operation.`, 3);
      this.give("incident-report", { unit: u.name, what: unsafe, ran: true });
    }
    for (const f of u.findings.filter((x) => x.state === "noted")) f.state = "ran";
    if (unsaid.length) this.log(`${hm(this.t)} Nobody told the driver: ${unsaid.join("; ")}.`, "fault");
    const pr = this.promises.find((x) => x.who === "fleet" && x.kept == null);
    if (pr) this._broken(pr, `${u.name} left without a return to operation`);
    this._patience("fleet");
  }

  /** One of the three is below the mark: the phone rings (once each). */
  _call(who) {
    if (this.over || this.called.has(who) || this.value(`mood-${who}`) >= MOOD.call || this.t < FIRST_S) return;
    const p = PEOPLE[who], id = `call-${who}`;
    this.called.add(who);
    this.log(`${hm(this.t)} ${p.name}, ${p.role}, is on the phone.`, "request");
    const at = this.mood(who);
    if (who === "fleet") {
      const by = this.irregulars.filter((x) => x.kind === "bypassed").length, noted = this.units.flatMap((u) => u.findings).filter((f) => f.state === "noted").length;
      const what = by ? "Work on my units that I never ordered" : noted ? "Findings you leave me in the release for half past four" : `${plural(this.tally.calls, "call")} tonight, one for each screw`;
      this.about.set(id, []);
      this.ask({
        id, title: `${p.name}, ${p.role}, is on the phone: “${what}. From now on nothing happens on my units without my order.”`,
        text: `Promise it and every finding waits for a call; keep the standing order and the next repair beyond it breaks your word. What you promise here, the pit's minutes pay, and with them the dispatcher's trains. `
          + `Below ${MOOD.act} of 100 ${p.name} puts the night into writing and reads every release line by line before a unit goes back into operation (${ON_CALL.slow_min} min more each). ${p.name}'s patience is at ${at}.`,
        options: [
          { id: "promise", label: "Promise: nothing without an order from now on" },
          { id: "two", label: `Offer: up to ${STANDING_MIN} min as agreed, everything above only on your word` },
          { id: "explain", label: "Explain: every call costs the pit ten minutes" },
        ],
        within: DECIDE_S.call, fallback: "two",
        then: (o) => {
          this.about.delete(id);
          if (o === "promise" || o === "two") {
            this.promises.push({ who, what: o === "promise" ? "nothing without an order" : `nothing beyond ${STANDING_MIN} min without an order`, strict: o === "promise", kept: null });
            this._mood(who, o === "promise" ? MOOD.promise : MOOD.compromise);
            this.log(`${hm(this.t)} Promised to ${p.name}: ${this.promises.at(-1).what}.`, "request");
          } else this._explained(who, "All right. But the order stays mine.", "Ten minutes of the pit are cheaper than a unit I must take out again.");
          this._act(who);
        },
      });
    } else if (who === "development") {
      const what = this.tally.repeats ? "A part you passed at its limit failed in service" : this.tally.excess_mm >= 0.5 ? `${mm(this.tally.excess_mm)} mm more off my wheels than the flat needed` : this.tally.scrapped ? "A good part on the scrap pallet" : "Two calls about one reading";
      this.about.set(id, []);
      this.ask({
        id, title: `${p.name}, ${p.role}, is on the phone: “${what}. Measure twice before you cut or scrap or pass anything of mine.”`,
        text: `Promise it and every cut and every limit costs ten minutes more; refuse and the next millimetre is on file. What you promise here, the trains pay in minutes. `
          + `Below ${MOOD.act} of 100 ${p.name} gives no concessions any more and reports the night's readings to ${HANDS.manager}, the ECM manager. ${p.name}'s patience is at ${at}.`,
        options: [
          { id: "promise", label: "Promise: a second measurement before every cut and every limit" },
          { id: "try", label: "Offer: a second measurement at every limit" },
          { id: "no", label: "Refuse: the night is too short for that" },
        ],
        within: DECIDE_S.call, fallback: "try",
        then: (o) => {
          this.about.delete(id);
          if (o === "no") {
            this._mood(who, MOOD.declined);
            this.log(`${hm(this.t)} ${p.name}: "Then I read every figure of tonight in the morning."`, "request");
          } else {
            this.promises.push({ who, what: o === "promise" ? "a second measurement before every cut and every limit" : "a second measurement at every limit", twice: o === "promise", kept: null });
            this._mood(who, o === "promise" ? MOOD.promise : MOOD.compromise);
            this.log(`${hm(this.t)} Promised to ${p.name}: ${this.promises.at(-1).what}.`, "request");
          }
          this._act(who);
        },
      });
    } else {
      const next = this.pullouts.filter((x) => x.unit == null && !x.cancelled).slice(0, 2), last = this.pullouts.filter((x) => x.unit != null || x.cancelled).at(-1);
      const what = last?.cancelled ? `The ${hm(last.at)} does not run` : last?.late_min >= 1 ? `The ${hm(last.at)} went ${last.late_min} min late` : last?.restricted ? "A unit with half its doors and a speed limit" : "Every hour your status moves a train further out";
      this.about.set(id, next.map((x) => `train-${x.n}`));
      this.ask({
        id, title: `${p.name}, ${p.role}, is on the phone: “${what}. ${next.length ? `Promise me the ${next.map((x) => hm(x.at)).join(" and the ")}: on the minute, whatever is on your pit.` : "What do I tell the passengers?"}”`,
        text: `A promise helps now and binds you; what you promise here, the unit on the pit may pay. ${next.length ? `The ${next.map((x) => hm(x.at)).join(" and the ")} must then leave on time, each with a unit returned to operation` : "There is no train left to promise for"}. `
          + `Below ${MOOD.act} of 100 ${p.name} orders buses for the last train still open. ${p.name}'s patience is at ${at}.`,
        options: [
          ...(next.length ? [{ id: "promise", label: `Promise: the ${next.map((x) => hm(x.at)).join(" and the ")} get their units on time` }, { id: "try", label: "Offer: you hear at once when a train is in danger" }] : []),
          { id: "no", label: next.length ? "Refuse: I release what is fit to run, when it is" : "Say sorry and get back to the hall" },
        ],
        within: DECIDE_S.call, fallback: next.length ? "try" : "no",
        then: (o) => {
          this.about.delete(id);
          if (o === "promise") {
            this.promises.push({ who, what: `the ${next.map((x) => hm(x.at)).join(" and the ")} leave on time`, trains: next.map((x) => x.n), kept: null });
            this._mood(who, MOOD.promise);
            this.log(`${hm(this.t)} Promised to ${p.name}: ${this.promises.at(-1).what}.`, "request");
          } else if (o === "try") {
            this._mood(who, MOOD.compromise);
            this.log(`${hm(this.t)} ${p.name}: "Then phone me before the platform does."`, "request");
          } else {
            this._mood(who, MOOD.declined);
            this.log(`${hm(this.t)} ${p.name}: "Then I plan as if you had nothing for me."`, "request");
          }
          this._act(who);
        },
      });
    }
  }

  /** An explanation on the phone is taken or not. */
  _explained(who, yes, no) {
    const taken = this.rng("call", who).next() < ACCEPT;
    this._mood(who, taken ? MOOD.explained : MOOD.refused);
    this.log(`${hm(this.t)} ${PEOPLE[who].name}: "${taken ? yes : no}"`, "request");
  }

  /** A promise is not kept. */
  _broken(p, why) {
    if (p.kept != null) return;
    p.kept = false;
    this._mood(p.who, MOOD.broken);
    this.violate("promise", `${hm(this.t)} Promised to ${PEOPLE[p.who].name}: ${p.what}. Not kept: ${why}.`, 2);
    this.irregular("promise-broken", `promise:${p.who}`, { who: PEOPLE[p.who].name });
  }

  /**
   * Somebody's patience is at its end. The fleet manager puts the night into writing and reads
   * every release line by line from then on; the maintenance development engineer gives no
   * concessions any more and reports the readings to the ECM manager; the dispatcher orders buses
   * for the last train still open.
   */
  _act(who) {
    if (this.value(`mood-${who}`) >= MOOD.act || this.acted.has(who)) return;
    this.acted.add(who);
    const p = PEOPLE[who];
    if (who === "dispatch") {
      const pl = this.pullouts.filter((x) => x.unit == null && !x.cancelled).at(-1);
      if (pl) {
        pl.cancelled = "planned";
        this.irregular("cancelled", `cancelled:${pl.n}`, { train: `${hm(pl.at)} ${pl.id} to ${pl.to}`, who: p.name });
      }
      this.violate("complaint", `${hm(this.t)} ${p.name} ${pl ? `orders buses for the ${hm(pl.at)} ${pl.id} and ` : ""}writes to the operator's management about the depot's releases.`, 2);
    } else if (who === "fleet") this.violate("complaint", `${hm(this.t)} ${p.name} claims the malus of the workshop contract for tonight, in writing, and reads every release line by line from now on.`, 2);
    else this.violate("complaint", `${hm(this.t)} ${p.name} gives no concessions any more and reports tonight's readings to ${HANDS.manager}, the ECM manager.`, 2);
    this.irregular("complaint", `complaint:${who}`, { who: p.name });
  }

  _patience(who) {
    this._call(who);
    this._act(who);
  }

  /** What the computer's workshop manager would decide (a decision's id → an option or a number). */
  advice(id) {
    const d = this.open.find((x) => x.id === id);
    if (!d) return null;
    if (id.startsWith("free-")) {
      const track = id.slice(5), cands = d.options.filter((o) => o.id !== "leave").map((o) => this.unit(o.id));
      // work that must be done and can be done only here first; then other work that must be done; the door's drive while the night is young and nobody else needs the track
      const only = cands.find((u) => u.tasks.some((t) => t.state === "open" && t.required && t.where.length === 1 && t.where[0] === track));
      if (only) return only.id;
      const must = cands.find((u) => u.tasks.some((t) => t.state === "open" && t.required && t.where.includes(track)));
      if (must) return must.id;
      const soon = this.units.some((u) => !u.track && u.gone_t == null && u.arrive - this.t < S(WORK.door_min + 2 * MOVE.shunt_min) && u.tasks.some((t) => t.required && t.where.includes(track) && t.where.length <= 2));
      const waiting = this.units.some((u) => u.track && !HALL.includes(u.track) && !this.queued(u.id) && u.released_t == null && u.tasks.some((t) => t.state === "open" && t.required && t.where.includes(track)));
      return cands.length && track !== "1" && !soon && !waiting && this.t < S(240) ? cands[0].id : "leave";
    }
    if (id.startsWith("finding-")) return "ask";
    if (id.startsWith("limit-")) return "again";
    if (id.startsWith("cut-")) return d.scale.value;
    if (id === "brake-test") {
      const lathe = this.tester.task;
      return lathe && lathe.work - lathe.done > S(25) ? "now" : "after";
    }
    if (id === "word") return Math.min(d.scale.max, d.scale.value + 15);
    if (id.startsWith("door-")) return d.options.some((x) => x.id === "phone") ? "phone" : "wait";
    if (id === "call-fleet") return "two";
    if (id === "call-development" || id === "call-dispatch") return d.options.some((x) => x.id === "try") ? "try" : "no";
    return d.fallback ?? d.options[0]?.id ?? null;
  }

  /* ---------------------------------------------------------------- what comes of it */

  /** Fleet management returns released units to operation, sends one back to the hall for a finding written into its release that must be repaired, or keeps it in. */
  _returns() {
    const p = PEOPLE.fleet;
    for (const u of this.units) {
      if (u.released_t == null || u.rto_t != null || u.kept || this.t < u.rto_due) continue;
      const noted = u.findings.filter((f) => f.state === "noted"), must = noted.find((f) => f.must_have);
      if (u.void) {
        u.kept = true;
        this.log(`${hm(this.t)} ${p.name}: "${u.name}: the brake test is signed by ${HANDS.lapsed}. That is no release. It stays in."`, "fault");
        this.irregular("kept", `kept:${u.id}`, { unit: u.name, what: "a signature without authorisation", who: p.name });
        continue;
      }
      if (must) {
        this._sendBack(u, must);
        continue;
      }
      for (const f of noted) {
        f.state = "deferred";
        u.restrictions.push(f.restriction);
        this._mood("fleet", MOOD.noted);
      }
      if (u.tasks.some((t) => t.id === "door" && t.state === "open")) u.restrictions.push("door 3 locked");
      u.rto_t = this.t;
      this.log(`${hm(this.t)} ${p.name} returns ${u.name} to operation${u.restrictions.length ? `, with: ${u.restrictions.join("; ")}` : ""}.`, "train");
      if (u.restrictions.length) this.irregular("restricted", `restricted:${u.id}`, { unit: u.name, what: u.restrictions.join("; "), who: p.name });
      this._patience("fleet");
    }
  }

  /**
   * Fleet management wants a finding repaired that was written into the release: the unit is not
   * returned to operation but goes back to the hall with the repair ordered, repaired where it
   * stands on a hall track, or taken in again when a track is free. The night decides whether it is
   * still in time for a train.
   */
  _sendBack(u, f) {
    const p = PEOPLE.fleet;
    Object.assign(u, { released_t: null, rto_due: null, phoned: false, sent_back: (u.sent_back ?? 0) + 1 });
    this._repair(u, f, true);
    const task = u.tasks.find((t) => t.finding === f);
    // (the release withdrawn, a crew that had finished with the unit set up for it again)
    task.work += S(WORK.reopen_min);
    // (on the lathe's track it is repaired from the lathe's pit: it does not move for it)
    if (HALL.includes(u.track) && !task.where.includes(u.track)) task.where = [...task.where, u.track];
    // (a repair on the brakes after the brake test: the test is due again, and signed again)
    const test = f.brakes ? u.tasks.find((t) => t.id === "brake-test" && t.state === "done") : null;
    if (test) Object.assign(test, { state: "open", done: 0 });
    // (a time said to the dispatcher for this unit rested on the release that came back: it is judged again)
    if (this.word?.unit === u.id && this.word.kept === true) {
      this.word.kept = null;
      this._mood("dispatch", -(this.word.gave ?? MOOD.kept_word));
      this.word.gave = 0;
    }
    this._mood("fleet", MOOD.noted_must);
    this.log(`${hm(this.t)} ${p.name}: "${u.name}: ${f.what}, and you write it into the release? Not returned to operation: repair it first${test ? ", and test the brakes again" : ""}. You could have asked me when it was found."`, "fault");
    this.irregular("sent-back", `sent-back:${u.id}:${f.id}`, { unit: u.name, what: f.what, who: p.name });
    this._patience("fleet");
  }

  /** The units that are returned to operation and stand in the depot: those without a restriction first, then as they were released. */
  fit() {
    return this.units.filter((u) => u.rto_t != null && !u.kept && u.gone_t == null && u.train == null && u.track && !u.moving && !this.queued(u.id))
      .sort((a, b) => a.restrictions.length - b.restrictions.length || a.released_t - b.released_t);
  }

  /** The trains of the morning: a unit leaves for each, on time or as soon as one is fit; a train without one is cancelled. */
  _pullouts() {
    const p = PEOPLE.dispatch;
    for (const pl of this.pullouts) {
      if (pl.unit != null || pl.cancelled || this.t < pl.at) continue;
      const u = this.fit()[0];
      if (u) {
        pl.unit = u.id;
        u.train = pl.n;
        pl.late_min = Math.max(0, Math.round(((this.t - pl.at) * PACE) / 60));
        pl.restricted = u.restrictions.length > 0 && !u.handed;
        pl.unsafe = !!u.unsafe;
        this.shunt.queue.unshift({ unit: u.id, from: u.track, to: null, kind: "out" });
        for (const f of u.findings) if (f.state === "within" && f.truth < 0) u.fails_t = Math.min(this.length - 2, this.t + S(FAILS_AFTER_MIN[0] + this.rng("fails", u.id).next() * (FAILS_AFTER_MIN[1] - FAILS_AFTER_MIN[0])));
        this.log(`${hm(this.t)} ${u.name} leaves the depot for the ${hm(pl.at)} ${pl.id} to ${pl.to}${pl.late_min ? `, ${pl.late_min} min late` : ""}${pl.restricted ? ` (${u.restrictions.join("; ")})` : ""}.`, "train");
        if (pl.late_min >= 1) {
          this._mood("dispatch", MOOD.late_min * pl.late_min);
          this.irregular("late", `late:${pl.n}`, { train: `${hm(pl.at)} ${pl.id} to ${pl.to}`, min: String(pl.late_min), who: p.name });
        } else this._mood("dispatch", MOOD.on_time);
        if (pl.restricted) this._mood("dispatch", MOOD.restricted);
        const pr = this.promises.find((x) => x.who === "dispatch" && x.kept == null && x.trains?.includes(pl.n));
        if (pr && pl.late_min >= 1) this._broken(pr, `the ${hm(pl.at)} left ${pl.late_min} min late`);
        this._patience("dispatch");
        continue;
      }
      // no unit is fit: one that is released and not returned has its driver at the door; after the wait the train is cancelled
      const waiting = this.units.find((x) => x.released_t != null && x.rto_t == null && !x.kept && x.gone_t == null);
      if (waiting) this._askDoor(pl, waiting);
      if (this.t >= pl.at + S(LATE_MAX_MIN)) {
        pl.cancelled = true;
        this._mood("dispatch", MOOD.cancelled);
        this.log(`${hm(this.t)} The ${hm(pl.at)} ${pl.id} to ${pl.to} is cancelled: no unit.`, "fault");
        this.irregular("cancelled", `cancelled:${pl.n}`, { train: `${hm(pl.at)} ${pl.id} to ${pl.to}`, who: p.name });
        const pr = this.promises.find((x) => x.who === "dispatch" && x.kept == null && x.trains?.includes(pl.n));
        if (pr) this._broken(pr, `the ${hm(pl.at)} did not run`);
        this._patience("dispatch");
      }
      break;
    }
    // a promise for trains that have all gone on time is kept
    for (const pr of this.promises.filter((x) => x.who === "dispatch" && x.kept == null && x.trains)) {
      if (pr.trains.every((n) => this.pullouts[n].unit != null && this.pullouts[n].late_min < 1)) {
        pr.kept = true;
        this._mood("dispatch", MOOD.kept_word);
      }
    }
  }

  /** A part passed at its limit fails in service. */
  _failures() {
    for (const u of this.units) {
      if (u.fails_t == null || this.t < u.fails_t) continue;
      u.fails_t = null;
      const f = u.findings.find((x) => x.state === "within" && x.truth < 0), pl = this.pullouts[u.train];
      f.state = "failed";
      if (pl) pl.failed = true;
      this.tally.repeats++;
      for (const who of ["development", "fleet", "dispatch"]) this._mood(who, who === "development" ? MOOD.repeat : MOOD.repeat / 2);
      this.log(`${hm(this.t)} ${u.name} is taken out of service at its first station: ${f.what}, passed tonight at its limit, was ${mm(-f.truth)} mm under it.`, "fault");
      this.give("incident-report", { unit: u.name, what: f.what, in_service: true });
      this.irregular("repeat", `repeat:${u.id}`, { unit: u.name, what: f.what, who: PEOPLE.development.name });
      for (const who of ["development", "fleet", "dispatch"]) this._patience(who);
    }
  }

  /** Every hour the status goes to fleet management and the dispatcher: a train that looks short of its unit costs the dispatcher's patience. */
  _hourly() {
    const hour = Math.floor((this.t * PACE) / 3600);
    if (hour <= this._status) return;
    this._status = hour;
    // (from one o'clock: before that nobody is far enough to say)
    if (hour < 3) return;
    // the units that can still take one of the trains to come: not one on its way out to its train, not one fleet management will keep in
    const etas = this.units.filter((u) => u.gone_t == null && u.train == null && !u.kept && !(u.void && u.rto_t == null)).map((u) => ({ u, t: (u.rto_t ?? (u.released_t != null ? u.rto_due : this.eta(u) + S(RTO_GUESS_MIN))) })).sort((a, b) => a.t - b.t);
    const open = this.pullouts.filter((x) => x.unit == null && !x.cancelled);
    const short = open.filter((pl, i) => !etas[i] || etas[i].t > pl.at + S(1));
    const lines = this.units.filter((u) => u.gone_t == null && u.released_t == null && u.tasks.some((t) => t.state === "open" && t.required)).map((u) => `${u.name} at about ${hm(S(Math.ceil(mins(this.eta(u)) / 5) * 5))}`);
    this.log(`${hm(this.t)} Status to fleet management and the dispatcher: ${lines.length ? `to be released, ${lines.join(", ")}` : "the work that must be done is done"}.`, "info");
    for (const pl of short) {
      this._mood("dispatch", MOOD.slipping);
      pl.slipped = true;
    }
    if (short.length) {
      this.log(`${hm(this.t)} ${PEOPLE.dispatch.name}: "By that, the ${short.map((x) => hm(x.at)).join(" and the ")} ${short.length === 1 ? "has" : "have"} no unit."`, "request");
      this._patience("dispatch");
    }
  }

  tick(dt) {
    this._arrivals();
    this._shunt();
    this._work(dt);
    // a repair that is done, and whether it was within the standing order
    for (const u of this.units) for (const t of u.tasks) if (t.finding && t.state === "done" && t.finding.state === "task") this._repaired(u, t);
    // the flat's measurement before the cut is in
    for (const u of this.units) {
      if (!u.hold?.flat || this.t < u.hold.until) continue;
      u.hold = null;
      this.log(`${hm(this.t)} ${u.name}: the flat's damage is measured.`, "train");
    }
    this._answers();
    this._returns();
    this._pullouts();
    // the driver's question at a door is over once fleet management has decided on the unit, or no train waits for one any more
    for (const d of this.open.filter((x) => x.id.startsWith("door-"))) {
      const u = this.unit(d.id.slice(5)), waits = this.pullouts.some((p) => p.unit == null && !p.cancelled && this.t >= p.at);
      if (u.rto_t != null || u.kept || u.gone_t != null || u.released_t == null || !waits) this._drop(d.id);
    }
    this._failures();
    this._wordDue();
    this._hourly();
    this._askWord();
    this._askFree();
    if (this.t >= this.length) this.end(`${hm(this.length)}: the early shift takes over.`);
    else if (this.pullouts.every((p) => p.unit != null || p.cancelled) && this.units.every((u) => u.released_t != null) && !this.shunt.now && !this.shunt.queue.length && !this.units.some((u) => u.fails_t != null) && !this.open.length) this.end(`${hm(this.t)} Every unit is released and every train of the morning has its unit, or is cancelled.`);
  }

  /* ---------------------------------------------------------------- the account */

  /** The night in numbers: the trains, the orders, what came back, the three people. */
  account() {
    const moods = Object.fromEntries(Object.keys(PEOPLE).map((k) => [k, this.mood(k)]));
    const P = this.pullouts, gone = P.filter((p) => p.unit != null);
    const tasks = this.units.flatMap((u) => u.tasks.filter((t) => t.ordered));
    const noted = this.units.flatMap((u) => u.findings).filter((f) => ["noted", "ran"].includes(f.state)).length;
    return {
      trains: P.length, gone: gone.length, on_time: gone.filter((p) => p.late_min < 1).length, late_min: gone.reduce((s, p) => s + p.late_min, 0), cancelled: P.filter((p) => p.cancelled).length,
      restricted: gone.filter((p) => p.restricted).length, failed: P.filter((p) => p.failed).length,
      released: this.units.filter((u) => u.released_t != null).length, returned: this.units.filter((u) => u.rto_t != null && !u.handed).length, kept: this.units.filter((u) => u.kept).length, sent_back: this.units.reduce((n, u) => n + (u.sent_back ?? 0), 0), handed: this.units.filter((u) => u.handed).length,
      work: tasks.reduce((s, t) => s + t.work, 0), work_done: tasks.reduce((s, t) => s + Math.min(t.work, t.done), 0), tasks: tasks.length, tasks_done: tasks.filter((t) => t.state === "done").length, noted,
      ...this.tally, moods, lowest: Math.min(...Object.values(moods)), promises: this.promises.length + (this.word ? 1 : 0), broken: this.promises.filter((p) => p.kept === false).length + (this.word?.kept === false ? 1 : 0),
    };
  }

  finish() {
    const a = this.account();
    this.give("performance-report", {
      scope: "Betriebswerk Neustadt, the night shift", kind: "workshop", units_released: a.released, returned_to_operation: a.returned, trains_with_a_unit: a.gone, trains_on_time: a.on_time, cancelled: a.cancelled,
      failed_in_service: a.repeats, lathe_second_passes: a.second, mm_cut_beyond_need: a.excess_mm, patience: a.moods, promises_broken: a.broken, violations: this.violations.length, score: this.score().total,
    });
  }

  objectives() {
    const a = this.account(), m = Object.values(a.moods), mean = m.reduce((s, v) => s + v, 0) / m.length;
    // a train: with a unit on time 1, with a restricted unit a little less, late by its minutes, failed in service a little; cancelled less than nothing (buses, and passengers who do not come back), in good time not quite as bad; one that ran with a unit that should have been kept in is worth what a cancelled one is
    const worth = (p) => (p.cancelled ? (p.cancelled === "planned" ? CANCELLED.planned : CANCELLED.late) : p.unit == null ? (this.over ? CANCELLED.late : 1) : p.unsafe ? CANCELLED.late : p.failed ? 0.25 : Math.max(0.2, 1 - p.late_min / LATE_MAX_MIN) * (p.restricted ? 0.85 : 1));
    const trains = this.pullouts.reduce((s, p) => s + worth(p), 0) / this.pullouts.length;
    const sev = this.violations.reduce((s, v) => s + (v.severity >= 3 ? 1 : v.severity === 2 ? 0.4 : 0.15), 0);
    const names = Object.entries(PEOPLE).map(([k, p]) => `${p.label} ${a.moods[k]}`).join(", ");
    return [
      { id: "trains", label: "Trains with their unit", weight: 35, value: trains, note: a.gone + a.cancelled ? `${a.on_time} of ${a.trains} on time${a.late_min ? `, ${a.late_min} min late in all` : ""}${a.cancelled ? `, ${a.cancelled} cancelled` : ""}${a.restricted ? `, ${plural(a.restricted, "unit")} with a restriction` : ""}` : "no train is due yet" },
      { id: "orders", label: "The night's orders", weight: 20, value: (a.work ? a.work_done / a.work : 1) - 0.12 * a.noted - SENT_BACK.orders * a.sent_back - 0.25 * a.kept, note: `${a.tasks_done} of ${plural(a.tasks, "job")} done, ${a.released} of ${this.units.length} units released${a.noted ? `, ${plural(a.noted, "finding")} left in a release` : ""}${a.sent_back ? `, ${plural(a.sent_back, "release")} sent back by fleet management` : ""}${a.kept ? `, ${plural(a.kept, "unit")} kept in by fleet management` : ""}` },
      { id: "quality", label: "Nothing comes back", weight: 15, value: 1 - 0.4 * a.repeats - 0.12 * a.second - 0.06 * a.excess_mm - 0.08 * a.scrapped - sev, note: `${plural(a.repeats, "part")} failed in service, the lathe set up again ${a.second} time${a.second === 1 ? "" : "s"}, ${mm(a.excess_mm)} mm cut beyond need, ${plural(a.broken, "promise")} not kept` },
      // the one who is worst off counts most: a night that is good for two of three is not good enough
      { id: "people", label: "The people you work with", weight: 30, value: (0.6 * a.lowest + 0.4 * mean) / 100, note: `patience of 100: ${names}` },
    ];
  }

  /* ---------------------------------------------------------------- for a page */

  /** What a unit is doing, in a few words. */
  stateOf(u) {
    if (u.gone_t != null) return `left ${hm(u.gone_t)} for the ${hm(this.pullouts[u.train].at)}`;
    if (!u.track && !u.moving) return this.t < u.arrive ? `comes in at about ${hm(u.arrive)}` : "waits at the gate";
    if (u.moving) return u.moving.kind === "out" ? "leaves for its train" : u.moving.kind === "in" ? "comes in" : `moves to ${trackOf(u.moving.to).name}`;
    if (u.kept) return "kept in by fleet management";
    if (u.rto_t != null) return `fit to run${u.restrictions.length ? `, with: ${u.restrictions.join("; ")}` : ""}`;
    if (u.released_t != null) return `released ${hm(u.released_t)}, not yet returned to operation`;
    if (u.hold) return u.hold.why === "decision" ? "waits for your word" : u.hold.why === "measure" ? `measured until ${hm(u.hold.until)}` : `waits for ${PEOPLE[u.hold.why].name}`;
    const cur = this.current(u), open = u.tasks.filter((t) => t.state === "open");
    if (cur) return cur.tester && this.tester.task !== cur ? `${cur.name}: waits for ${HANDS.tester}` : `${cur.name}${cur.work ? `, ${Math.round((100 * cur.done) / cur.work)} %` : ""}`;
    if (!open.some((t) => t.required)) return open.length ? `${open.map((t) => t.name).join(", ")} may wait: a hall track, or release it as it is` : "ready to release";
    return `waits for ${trackOf(open.find((t) => t.required).where[0]).what}`;
  }

  /** What a unit is doing, in two or three words (beside its tag in the sketch). */
  _short(u) {
    if (u.kept) return "kept in";
    if (u.rto_t != null) return u.restrictions.length ? "fit, restricted" : "fit to run";
    if (u.released_t != null) return "released";
    if (u.hold) return u.hold.why === "decision" ? "your word" : u.hold.why === "measure" ? "measuring" : `waits: ${PEOPLE[u.hold.why].name}`;
    const open = u.tasks.filter((t) => t.state === "open"), next = open[0];
    if (!open.some((t) => t.required)) return open.length ? "door: may wait" : "work done";
    return this.current(u) ? `waits: ${HANDS.tester}` : `needs ${trackOf(next.where[0]).what.replace("the ", "")}`;
  }

  /** The moves a unit offers in the picture. */
  _menu(u) {
    if (u.gone_t != null || !u.track || u.moving || this.queued(u.id) || u.train != null) return undefined;
    const out = [];
    if (this.releasable(u.id).ok) out.push({ label: "Release to service", name: "release", args: [u.id] });
    if (u.released_t != null && u.rto_t == null && !u.kept && !u.phoned) out.push({ label: `Phone ${PEOPLE.fleet.name} for its return to operation`, name: "phone", args: [u.id] });
    for (const t of TRACKS) if (t.id !== u.track && this.isFree(t.id)) out.push({ label: `To ${t.name}${t.hall ? `, ${t.what}` : ""}`, name: "move", args: [u.id, t.id] });
    return out.length ? out : undefined;
  }

  view() {
    const a = this.account(), tone = (v) => (v < MOOD.act ? "bad" : v < MOOD.call ? "warn" : "ok");
    const here = this.units.filter((u) => u.track && !u.moving && u.gone_t == null && !this.queued(u.id));
    const train = (p) => (p.cancelled ? (p.cancelled === "planned" ? "cancelled in good time" : "cancelled") : p.unit ? `${nameOf(p.unit)}${p.late_min ? `, ${p.late_min} min late` : ", on time"}${p.failed ? ", failed in service" : ""}` : "–");
    return {
      sketch: this._sketch(),
      figures: [
        { label: "Trains with a unit", value: `${a.gone} of ${a.trains}`, tone: a.cancelled ? "bad" : a.late_min ? "warn" : "ok" },
        { label: "Released", value: `${a.released} of ${this.units.length}`, tone: "ok" },
        ...Object.entries(PEOPLE).map(([k, p]) => ({ label: p.label, value: a.moods[k], tone: tone(a.moods[k]) })),
      ],
      tables: [
        {
          id: "units", title: "Units and their orders", window: true, columns: ["Unit", "Order", "Where", "Now"],
          rows: this.units.map((u) => [u.name, u.order, u.track ? trackOf(u.track).name : "–", this.stateOf(u)]),
        },
        {
          id: "trains", title: "The trains of the morning", columns: ["Leaves the depot", "Train", "Unit"],
          rows: this.pullouts.map((p) => [hm(p.at), `${p.id} to ${p.to}`, train(p)]),
        },
        {
          id: "people", title: "The people you work with", columns: ["Who", "Counts", "Patience", "Promised"],
          rows: Object.entries(PEOPLE).map(([k, p]) => [`${p.name}, ${p.role}`, p.counts, `${a.moods[k]} of 100`, [...this.promises.filter((x) => x.who === k), ...(k === "dispatch" && this.word ? [{ what: `${nameOf(this.word.unit)} released by ${hm(this.word.t)}`, kept: this.word.kept }] : [])].map((x) => `${x.what}: ${x.kept == null ? "open" : x.kept ? "kept" : "not kept"}`).join("; ") || "–"]),
        },
      ],
      actions: [
        {
          name: "move", label: "Move a unit", primary: true, hint: `Through the throat, one move at a time, ${MOVE.shunt_min} min each. Work on the unit stops while it moves.`,
          disabled: here.length ? undefined : "No unit stands ready to move.",
          fields: [
            { id: "unit", label: "Unit", options: here.map((u) => ({ id: u.id, label: u.name })) },
            { id: "track", label: "To", options: TRACKS.map((t) => ({ id: t.id, label: `${t.name[0].toUpperCase()}${t.name.slice(1)}${t.hall ? `, ${t.what}` : ""}` })) },
          ],
        },
        {
          name: "release", label: "Release to service", hint: "The work ordered is done as the maintenance file says, and what was found and not repaired is written in. The return to operation is fleet management's.",
          disabled: this.units.some((u) => this.releasable(u.id).ok) ? undefined : "No unit's work is done.",
          fields: [{ id: "unit", label: "Unit", options: this.units.filter((u) => u.released_t == null && u.gone_t == null && u.track).map((u) => ({ id: u.id, label: u.name })) }],
        },
      ],
    };
  }

  /**
   * The hall as the table shows it (no geometry: the layout's hall object has that): every unit
   * with its track and how far it is along the way there (`at`: 1 on its place, 0 on the throat's
   * lead, below 0 beyond the depot), how far it is raised, what state its light shows, how many
   * fitters are at it; the lathe cutting, the driver at a door.
   * @returns {{units: Array<object>, lathe: {unit: string | null, cutting: boolean}, tracks: Record<string, string>}}
   */
  hall() {
    const tone = (u) => (u.kept ? "bad" : u.hold ? "wait" : u.rto_t != null ? "fit" : u.released_t != null ? "released" : this.current(u) ? "work" : "idle");
    const units = [];
    for (const u of this.units) {
      if (u.gone_t != null || (!u.track && !u.moving)) continue;
      let track = u.track, at = 1;
      const m = u.moving;
      if (m) {
        const p = Math.min(1, Math.max(0, (this.t - m.t0) / (m.t1 - m.t0)));
        if (m.kind === "in") [track, at] = [m.to, p < 0.4 ? -1 + p / 0.4 : (p - 0.4) / 0.6];
        else if (m.kind === "out") [track, at] = [m.from, p < 0.6 ? 1 - p / 0.6 : -(p - 0.6) / 0.4];
        else [track, at] = p < 0.5 ? [m.from, 1 - 2 * p] : [m.to, 2 * p - 1];
      }
      const cur = this.current(u), working = !!cur && !u.hold && !(cur.tester && this.tester.task !== cur) && !(cur.under && track === "2" && u.lift < 1);
      units.push({ id: u.id, name: u.name, track, at, lift: u.lift, tone: tone(u), moving: !!m, fitters: working ? (cur.lathe ? 1 : cur.tester ? 1 : cur.id === "door" ? 2 : 3) : 0, waiting: !!u.hold });
    }
    const lathe = this.tester.task?.lathe ? this.tester.task : null;
    const door = this.open.find((d) => d.id.startsWith("door-"));
    return {
      units, lathe: { unit: lathe?.unit ?? null, cutting: !!lathe && lathe.done > 0 && lathe.done < lathe.work },
      tracks: Object.fromEntries(TRACKS.map((t) => [t.id, this.units.find((u) => u.track === t.id && !u.moving)?.id ?? null])),
      driver: door ? door.id.slice(5) : null,
    };
  }

  /**
   * The depot as a sketch for a page that does not know the game: on the left the stabling tracks
   * outside, in the middle the hall with its three tracks and what stands on each, on the right
   * the trains of the morning. A unit can be chosen: its moves are a track, the release, the phone.
   */
  _sketch() {
    const W = 640, items = [], row = 30, top = 44;
    const asked = new Set([...this.about.entries()].filter(([id]) => this.open.some((d) => d.id === id)).flatMap(([, ids]) => ids));
    const X = { out: 14, outEnd: 196, hall: 236, hallEnd: 452, trains: 478 };
    items.push({ kind: "text", x: X.out, y: 14, small: true, tone: "muted", text: `Outside · ${hm(this.t)}` });
    items.push({ kind: "text", x: X.hall, y: 14, small: true, tone: "muted", text: "The hall" });
    items.push({ kind: "text", x: X.trains, y: 14, small: true, tone: "muted", text: "Trains · unit" });
    const tones = { bad: "bad", wait: "warn", fit: "ok", released: "train", work: undefined, idle: "idle" };
    const hall = this.hall();
    const unitTag = (u, x, y) => {
      const h = hall.units.find((v) => v.id === u.id);
      items.push({
        id: `unit-${u.id}`, kind: "tag", x, y, anchor: "start", text: u.id, tone: tones[h?.tone ?? "idle"], alert: asked.has(`unit-${u.id}`) ? "warn" : undefined,
        title: `${u.name}: ${u.order}; ${this.stateOf(u)}`, menu: this._menu(u),
      });
      const cur = this.current(u);
      if (cur?.work) {
        const w = 60;
        items.push({ kind: "box", x: x + 44, y: y - 9, w, h: 8, tone: "closed" }, { kind: "box", x: x + 44, y: y - 9, w: Math.max(1, (w * cur.done) / cur.work), h: 8, tone: u.hold ? "warn" : "ok" });
      } else items.push({ kind: "text", x: x + 44, y: y - 1, small: true, tone: "muted", text: this._short(u) });
    };
    TRACKS.forEach((t) => {
      const i = t.hall ? HALL.indexOf(t.id) : OUTSIDE.indexOf(t.id), y = top + i * row, x0 = t.hall ? X.hall : X.out, x1 = t.hall ? X.hallEnd : X.outEnd;
      items.push({ kind: "line", x1: x0, y1: y + 6, x2: x1, y2: y + 6, thin: true, tone: "free" });
      const u = this.units.find((x) => x.gone_t == null && (x.track === t.id && !x.moving));
      // (a free track offers the units that can come: tap it on the table)
      const movable = this.isFree(t.id) ? this.units.filter((x) => x.track && !x.moving && x.gone_t == null && x.train == null && !this.queued(x.id)) : [];
      items.push({
        id: `track-${t.id}`, kind: "tag", x: x0, y: y + 4, anchor: "start", text: t.hall ? `${t.id} ${t.kind}` : t.id, tone: u ? "idle" : undefined, alert: asked.has(`track-${t.id}`) ? "warn" : undefined,
        title: `${t.name[0].toUpperCase()}${t.name.slice(1)}${t.hall ? `, ${t.what}` : ""}: ${u ? `${u.name} stands here` : "free"}`,
        menu: movable.length ? movable.map((x) => ({ label: `${x.name} comes here`, name: "move", args: [x.id, t.id] })) : undefined,
      });
      if (u) unitTag(u, x0 + (t.hall ? 66 : 30), y + 4);
    });
    // the throat: the move that goes, those that wait, the units still to come
    const m = this.shunt.now, yT = top + 3 * row + 4;
    const lines = [
      m ? `Throat: ${nameOf(m.unit)} ${m.kind === "in" ? `comes in to ${trackOf(m.to).name}` : m.kind === "out" ? "leaves for its train" : `to ${trackOf(m.to).name}`} until ${hm(m.t1)}${this.shunt.queue.length ? `, ${plural(this.shunt.queue.length, "move")} waiting` : ""}` : "Throat: free",
      ...this.units.filter((u) => !u.track && !u.moving && u.gone_t == null).map((u) => `${u.name} comes in at about ${hm(u.arrive)}: ${u.order.split(",")[0].split(":")[0]}`),
      `${HANDS.tester} (lathe, brake tests): ${this.tester.task ? `${this.tester.task.name} of ${nameOf(this.tester.task.unit)}` : "free"}`,
    ];
    lines.forEach((text, i) => items.push({ kind: "text", x: X.out, y: yT + i * 15, small: true, tone: "muted", text }));
    this.pullouts.forEach((p, i) => {
      const y = top + i * 24 - 4, late = p.late_min >= 1;
      items.push({
        id: `train-${p.n}`, kind: "tag", x: X.trains, y: y + 4, anchor: "start", text: `${hm(p.at)} ${p.unit ?? (p.cancelled ? "×" : "–")}`,
        tone: p.cancelled || p.failed ? "bad" : p.unit ? (late || p.restricted ? "warn" : "ok") : p.slipped ? "warn" : "idle", alert: asked.has(`train-${p.n}`) ? "warn" : undefined,
        title: `${hm(p.at)} ${p.id} to ${p.to}: ${p.cancelled ? "cancelled" : p.unit ? `${nameOf(p.unit)}${late ? `, ${p.late_min} min late` : ", on time"}` : "no unit yet"}`,
      });
    });
    return {
      title: "The depot", width: W, height: yT + lines.length * 15 + 6,
      label: "Betriebswerk Neustadt: on the left the stabling tracks outside, in the middle the hall with the pit, the lifting jacks and the wheel lathe and the unit on each with how far its work is, on the right the trains of the morning and the unit that left for each",
      items,
    };
  }
}
