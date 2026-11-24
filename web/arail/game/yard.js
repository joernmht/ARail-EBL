/**
 * The yard master's game (Schichtleiter/in einer Zugbildungsanlage), "Before the cut-off": the
 * start of an early shift at the hump yard Neustadt West, 06:00 to 06:35. Four trains come in and are
 * broken up over the hump into six classification tracks; four trains go out of them, each pulled
 * out of its track at its cut-off. A wagon that does not stand in its track then stays behind.
 *
 * The yard is the hump simulation of arail/hump (the yard of the lab's table: six tracks of 120 m,
 * speed-holding units), so what a decision leads to is physics: pushed faster, a train is over the
 * hump sooner, and a good runner catches up the bad runner ahead of it, a switch cannot be thrown
 * between them (a cut in the wrong track), wagons meet too hard. In the frost bad runners stop
 * early and leave gaps.
 *
 * The yard master decides which train goes over the hump next, how fast each is pushed (a number,
 * and changed at any time while it is pushed), how long an outbound train waits for wagons that are
 * not in yet (a number of minutes: beyond three its path is lost), and what the one shunting
 * locomotive does besides pushing: fetch a cut from the wrong track, take a wagon that must not be
 * humped round to its track, close up a track. Whatever it does, the hump waits.
 *
 * Three people count differently: the hump operator the impacts and the speed, the freight
 * undertaking's production dispatcher the minutes its trains leave late, the customer service agent
 * the wagons left behind. Their patience falls, they phone and ask for a promise, and what one is
 * promised another pays. So no order is right for everybody: the shift asks for compromise.
 *
 * Simplified for teaching: one locomotive does everything, its jobs take fixed times, a train is
 * pulled out at once (its brake test and departure are beyond the picture, a fixed time later), and
 * a path lost is replaced by the next one 10 or 25 min later.
 * @module arail/game/yard
 */
import { wagonType } from "../hump/cuts.js";
import { HumpSimulation } from "../hump/simulation.js";
import { standardYard } from "../hump/yard.js";
import { Game, Player, clockAt } from "./core.js";

/** The yard: that of the lab's table (the layout's object `hump-yard` with its own figures). */
export const YARD = { tracks: 6, track_m: 120, design: "speed", push_m: 100 };

/**
 * The pushing speed (m/s): the ends and the step of its scale, the speed of the yard's instructions,
 * the highest at which the automatic still gets every switch between two cuts, the speed the hump
 * operator pushes at when nobody says one, and how much a tap changes it.
 */
export const PUSH = { min: 0.8, max: 2, step: 0.1, rule: 1.2, limit: 1.4, auto: 1, tap: 0.2 };

/** How long an outbound train can be held (min), the scale's step, and how long its path waits for it (min). */
export const HOLD = { max_min: 8, step_min: 0.5, slot_min: 3 };
/** A path lost: the next one comes so many minutes later (one of these, by chance), and how likely the nearer one is. */
export const NEXT_PATH = { min: [10, 25], near: 0.5 };
/** A wrong wagon found in an outbound train at its check is shunted out: so many minutes per cut. */
export const WRONG_MIN = 3;

/**
 * The shunting locomotive (s): back from the hump to the next train, closing up a track, fetching
 * a cut from a wrong track (and more for every cut that stands in its way), taking wagons that must
 * not be humped round to their track, and how long the hump operator's inspection of the retarders
 * stops the hump.
 */
export const LOCO = { back_s: 70, close_s: 60, fetch_s: 150, per_cut_s: 30, round_s: 160, inspect_s: 240 };

/**
 * How long before a cut-off the yard master is asked about wagons not in yet (s), and how long a
 * question waits (s). No train goes over the hump without the yard master's word: which train and
 * how fast are asked without a time.
 */
export const HOLD_ASK_S = 90;
/** The shift's first seconds: the locomotive is coupled to nothing yet, and nothing is asked (the hand-over). */
const FIRST_S = 15;
/** A late train's time is known exactly this long before it comes in (s): it has passed the last station. */
const EXACT_S = 90;
const DECIDE_S = { hold: 70, loco: 60, call: 70 };
/** From its release at the crest until it is wholly in its track a cut takes about this long (s), give or take. */
const ROLL_S = 95, ROLL_SPREAD_S = 15;
/** A wagon's length for estimates (m), and how far before the crest a train starts (m). */
const WAGON_M = 15.6, START_M = 15;

/**
 * The patience of the three people (0 to 100): where it starts, below which they phone, below
 * which they act; and what moves it. The hump operator: a train pushed faster than the automatic's
 * limit (per 0.2 m/s above it), an impact too hard (and one on a wagon to shunt with care), a cut
 * in the wrong track, a train humped clean. The production dispatcher: a minute an outbound train
 * leaves late, a path lost, a train on time. The customer service agent: a booked wagon left
 * behind (and a priority one), a booked wagon damaged, a train that leaves with all its wagons.
 * On the phone: what a promise, a compromise and an accepted explanation are worth, what a refused
 * explanation, a refusal and a broken promise cost.
 */
export const MOOD = {
  start: 100, call: 60, act: 30,
  fast: -5, hard: -12, careful: -30, misrouted: -7, clean: 4,
  late_min: -8, lost: -40, on_time: 3,
  missed: -6, priority: -12, damaged: -5, complete: 5,
  promise: 14, compromise: 7, explained: 10, refused: -6, declined: -8, broken: -26,
};
/**
 * The score: the share of booked wagons (a priority wagon counts twice) left behind at which the
 * first objective is worth nothing; the minutes late at which an outbound train is worth nothing;
 * and what a path lost is worth (less than nothing: a new path, and a driver beyond the shift).
 */
const WAGONS_NONE = 0.6, LATE_NONE_MIN = 4, LOST = -0.5;
/** An explanation on the phone is accepted this often. */
const ACCEPT = 0.5;

/** The people on the phone (bird names, see CONTRIBUTING.md). */
export const PEOPLE = {
  hump: { name: "S. Pirol", role: "the hump operator", label: "Hump operator" },
  production: { name: "D. Turna", role: "the freight undertaking's production dispatcher", label: "Production dispatcher" },
  customers: { name: "N. Wachtel", role: "the customer service agent", label: "Customer service" },
};

/**
 * The outbound trains: where to, the classification track they are formed in, and their cut-off
 * (s of the shift): the time the train is pulled out of its track.
 */
export const OUTBOUND = [
  { id: "51204", to: "the port", track: "1", pull: 600 },
  { id: "51208", to: "the steelworks", track: "2", pull: 840 },
  { id: "51212", to: "the chemical park", track: "3", pull: 1260 },
  { id: "51216", to: "the border", track: "4", pull: 1620 },
];
/** The tracks no train leaves in the shift: the wagons for Neustadt's sidings, taken out by day. */
export const SIDINGS = { 5: "Neustadt's sidings, north", 6: "Neustadt's sidings, south" };

/**
 * The inbound trains: where from, when planned in (s of the shift; before 0: it stands in the
 * arrival tracks), how many wagons for each classification track, how many of those are a
 * customer's priority wagons, whether one of them (for `careful`'s track) is a tank wagon to shunt
 * with care (RID label 13) and one (for `noHump`'s track) must not be humped (RID label 15).
 */
export const INBOUND = [
  { id: "56012", from: "the port", planned: -1500, groups: { 1: 2, 2: 3, 5: 3, 6: 2 }, priority: { 1: 2 } },
  { id: "56034", from: "Bergheim", planned: -900, groups: { 1: 3, 2: 1, 3: 2, 5: 2, 6: 2 }, noHump: "1" },
  { id: "56058", from: "Talsee", planned: -300, groups: { 1: 2, 2: 2, 3: 2, 4: 2, 6: 2 }, careful: "2" },
  { id: "56071", from: "the border", planned: 720, groups: { 3: 3, 4: 4, 5: 2, 6: 1 }, priority: { 3: 3 } },
];

/**
 * Levels: the season of the hump and the head wind against the cuts (m/s), which trains come late
 * (s) and how far the forecast may be off (s either way), and whether a wagon that must not be
 * humped is among them.
 */
export const LEVELS = {
  training: { label: "Training: a summer night, every train on time, every wagon may be humped", season: "summer", wind_mps: 0, late: {}, spread: {}, noHump: false },
  normal: { label: "Normal: frost, a train late by a forecast, a wagon that must not be humped", season: "winter", wind_mps: 3, late: { 56071: 420 }, spread: { 56071: 180 }, noHump: true },
  hard: { label: "Hard: hard frost and a head wind, the late train later and its forecast wider", season: "winter", wind_mps: 5, late: { 56071: 450 }, spread: { 56071: 240 }, noHump: true },
};

/** The wagons of a train by chance: type, loaded or not, and how often (a loaded open wagon is a good runner, an empty 2-axle one a bad one). */
const MIX = [
  [{ type: "eanos", loaded: 1 }, 0.34], [{ type: "eanos", loaded: 0 }, 0.2], [{ type: "hbbillns", loaded: 0 }, 0.26],
  [{ type: "hbbillns", loaded: 1 }, 0.1], [{ type: "zacns", loaded: 1 }, 0.1],
];
/** Wagons per cut and how often. */
const SIZES = [[1, 0.5], [2, 0.35], [3, 0.15]];

/** Minutes as they are said: "2", "2.5". */
const mins = (s) => String(Math.round(s / 6) / 10);
/** A time of day without its seconds, of a time of the shift (s); with them where it has some. */
const START = 6 * 3600;
const hm = (t) => clockAt(t, START);
const hms = (t) => {
  const r = Math.round(t);
  return r % 60 ? `${hm(r)}:${String(((r % 60) + 60) % 60).padStart(2, "0")}` : hm(r);
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** A pushing speed as it is said: "1.4". */
const speed = (v) => (Math.round(v * 10) / 10).toFixed(1);
/** One of a weighted list, by a random number 0 … 1. */
const pick = (list, u) => {
  let acc = 0;
  for (const [x, p] of list) if (u < (acc += p)) return x;
  return list[list.length - 1][0];
};
/** The rolling class of a wagon's spec (good, medium, bad), as its list says it before it rolls. */
const classOf = (w) => wagonType(w.type).rolling[w.loaded >= 0.5 ? 1 : 0];

/**
 * The computer's yard master, by the yard's instructions with some judgment: the train with wagons
 * for the next cut-off first; pushed at the instructions' speed, at the automatic's limit when
 * wagons are short of time and no tank wagon is aboard; an outbound train held within its path's
 * three minutes where that brings the wagons in; the locomotive first where a booked wagon can
 * still make its train; on the phone the compromise. It closes up a track that is nearly full.
 */
export class YardPlayer extends Player {
  /** @param {YardGame} g */
  think(g) {
    for (const d of g.open) g.act("decide", d.id, g.advice(d.id));
    for (const t of g.full()) g.act("close", t);
  }
}

export class YardGame extends Game {
  static id = "yard";
  static title = "Before the cut-off";
  static role = "yard-master";
  static kind = "simulation";
  static description = "The start of an early shift at the hump yard: four trains to break up, four to send out, frost on the hump and one locomotive. Say which train goes next, how fast it is pushed and how long a train waits for its last wagons.";
  static scale = "minutes";
  static clock = "06:00";
  static takes = [];
  static gives = [
    { flow: "handling-order", to: ["hump-operator"] },
    { flow: "train-report", to: ["freight-production-dispatcher", "train-dispatcher"] },
    { flow: "delay-notice", to: ["freight-customer-service-agent", "freight-production-dispatcher"] },
    { flow: "incident-report", to: ["dangerous-goods-adviser", "safety-manager"] },
    { flow: "performance-report" },
  ];
  static actions = {
    ...Game.actions,
    push: { label: "Set the pushing speed" },
    hump: { label: "Choose the next train for the hump" },
    hold: { label: "Hold an outbound train" },
    close: { label: "Close up a track" },
    fetch: { label: "Fetch a cut from the wrong track" },
  };
  static player = YardPlayer;
  /**
   * What does not go to plan (`irregular`, with the texts a mission's story names): a cut in the
   * wrong track (`cut`, `track`, `intended`); an impact too hard (`cut`, `speed`); a cut that
   * stopped before its track or sticks out of it (`cut`, `track`); booked wagons left behind
   * (`train`, `wagons`); a path lost (`train`, `min`); the hump stopped by its operator; a promise
   * not kept (`who`); the yard backed up to the crest (`track`); a train that comes otherwise than
   * announced (`train`, `min`, `told`); a written complaint or a customer's claim (`who`).
   */
  static irregularities = ["misrouted", "hard-impact", "short", "missed", "path-lost", "hump-stopped", "promise-broken", "blocked", "forecast-off", "complaint"];

  /** @param {{seed?: number, level?: keyof LEVELS, conditions?: object, wired?: Iterable<string>, length?: number}} [options] */
  constructor(options = {}) {
    super({ ...options, level: LEVELS[options.level] ? options.level : "normal" });
    const lv = LEVELS[this.level];
    this.length = options.length ?? 2100;
    /** The hump: the simulation of the yard of the lab's table, in this game's season, with its own random numbers (the board on the table draws it). */
    this.sim = new HumpSimulation(standardYard(YARD), { seed: this.rng("hump").int(2 ** 31), season: lv.season, wind_mps: lv.wind_mps, dt: 0.1, train_gap_s: 0 });
    /**
     * The wagons of the shift by their id: their train, type, load and rolling class, the track they
     * are for, the outbound train they are booked on (`out`, or null: the sidings), whether they
     * are a customer's priority wagons, to shunt with care or not to hump, whether they were hit
     * too hard, and whether they made their train (`made`: null while open).
     * @type {Map<string, object>}
     */
    this.wagons = new Map();
    /**
     * The inbound trains: when they come (`arrive`; the forecast `told_s` late, give or take
     * `spread_s`, exact once the train is near), their wagons from the end that goes over the hump
     * first, where they are (`coming`, `waiting`, `hump`, `done`), the speed said for them (`push`), how fast
     * they were pushed at most.
     * @type {Array<object>}
     */
    this.inbound = INBOUND.map((spec) => this._inbound(spec, lv));
    /**
     * The outbound trains: their track and cut-off, how long they are held (`hold_min`, null: not
     * said), when they were pulled out, how late they leave (`late_min`), whether their path was
     * lost, the wrong cuts found in them.
     * @type {Array<object>}
     */
    this.outbound = OUTBOUND.map((o) => ({ ...o, hold_min: null, asked: false, pulled_t: null, late_min: null, lost: false, wrong: 0, made: 0, missed: 0 }));
    /**
     * The shunting locomotive: what it does (`idle`, `push`, `back`, `job`), until when, its job, the
     * train it pushes, the speed it pushes on at after it stood (`resume`), and whether it does so by
     * itself once what holds it is over (`goOn`: the train was blocked or the hump was stopped by its
     * operator; not when the yard master stopped it).
     */
    this.loco = { state: "back", until: FIRST_S, job: null, train: null, resume: 0, goOn: false };
    /** What the locomotive is to do besides pushing: `{kind, track?, cut?, train?, first}` (`first`: before the next train). */
    this.jobs = [];
    /** Wagons that must not be humped and found no room in their track: `{train, track}`, taken round again once it has room. */
    this.waiting = [];
    /** The train chosen for the hump next (its id), the pushing speed now, and the highest the hump operator takes. */
    this.nextUp = null;
    this.v = 0;
    this.cap = PUSH.max;
    /** The hump stopped by its operator until then (s), or null; who of the three has acted at the end of their patience. */
    this.inspection = null;
    this.acted = new Set();
    for (const [id, p] of Object.entries(PEOPLE)) this.resource(`mood-${id}`, `${p.label}: patience`, MOOD.start);
    /** Who phoned, and what was promised: `{who, what, train?, max_min?, kept}` (to the customer service agent a train with all its wagons, to the production dispatcher the longest wait). */
    this.called = new Set();
    this.promises = [];
    /** The things an open decision is about: its id → items of the picture. */
    this.about = new Map();
    /** Impacts too hard, cuts gone wrong, what was asked already. */
    this.hard = [];
    this.wrong = new Map();
    this._asked = new Set();
    this._seen = 0;
    this.log(`${hm(0)} The early shift begins: ${this.inbound.length} trains to break up, ${this.outbound.length} to send out by ${hm(this.outbound.at(-1).pull)}.`);
    for (const tr of this.inbound.filter((x) => x.state === "waiting")) this.log(`${hm(0)} ${tr.id} from ${tr.from} stands in the arrival tracks: ${this._load(tr)}.`, "train");
  }

  /** An inbound train from its spec: its time, and its wagons in the order of its cuts. */
  _inbound(spec, lv) {
    const r = this.rng("train", spec.id), late = lv.late[spec.id] ?? 0, spread = lv.spread[spec.id] ?? 0;
    const off = spread ? Math.round((2 * this.rng("arrive", spec.id).next() - 1) * spread) : 0;
    // the cuts: each track's wagons in cuts of one to three, shuffled so that two cuts for one track seldom follow each other
    const cuts = [];
    for (const [track, n] of Object.entries(spec.groups)) {
      let left = n, prio = spec.priority?.[track] ?? 0, special = spec.careful === track ? "careful" : spec.noHump === track && lv.noHump ? "noHump" : null;
      while (left > 0) {
        const size = Math.min(left, special ? 1 : pick(SIZES, r.next())), wagons = [];
        for (let i = 0; i < size; i++) {
          const kind = special ? { type: "zacns", loaded: 1 } : pick(MIX, r.next());
          wagons.push({ ...kind, track, priority: prio-- > 0, careful: special === "careful", noHump: special === "noHump" });
        }
        special = null;
        cuts.push(wagons);
        left -= size;
      }
    }
    for (let i = cuts.length - 1; i > 0; i--) {
      const j = r.int(i + 1);
      [cuts[i], cuts[j]] = [cuts[j], cuts[i]];
    }
    for (let i = 1; i < cuts.length; i++) {
      if (cuts[i][0].track !== cuts[i - 1][0].track) continue;
      const k = cuts.findIndex((c, j) => j > i && c[0].track !== cuts[i][0].track && c[0].track !== cuts[i + 1]?.[0].track);
      if (k > 0) [cuts[i], cuts[k]] = [cuts[k], cuts[i]];
    }
    const wagons = cuts.flat().map((w, i) => ({ ...w, id: `${spec.id}.${i + 1}` }));
    for (const w of wagons) {
      const out = OUTBOUND.find((o) => o.track === w.track);
      this.wagons.set(w.id, { ...w, train: spec.id, cls: classOf(w), out: out?.id ?? null, damaged: false, made: null });
    }
    const arrive = spec.planned + late + off;
    return {
      id: spec.id, from: spec.from, planned: spec.planned, arrive, told_s: late, spread_s: spread, exact: !spread, wagons,
      state: arrive <= 0 ? "waiting" : "coming", announced: false, push: null, vmax: 0, started_t: null, humped_t: null, rec: null, clean: true,
    };
  }

  /** What a train carries, in words: its wagons, and those booked on each outbound train. */
  _load(tr) {
    const parts = this.outbound.filter((o) => o.pulled_t == null).map((o) => [o, tr.wagons.filter((w) => w.track === o.track)]).filter(([, ws]) => ws.length)
      .map(([o, ws]) => `${ws.length} for the ${hm(o.pull)} to ${o.to}${ws.some((w) => w.priority) ? " (priority)" : ""}`);
    return `${plural(tr.wagons.length, "wagon")}${parts.length ? `, ${parts.join(", ")}` : ""}`;
  }

  /** A train of the shift by its id: inbound or outbound. */
  train(id) {
    return this.inbound.find((x) => x.id === id) ?? this.outbound.find((x) => x.id === id);
  }

  /** The patience of one of the three people (0 to 100). */
  mood(who) {
    return Math.round(this.value(`mood-${who}`));
  }

  _mood(who, by) {
    const r = this.resources.get(`mood-${who}`);
    r.value = Math.max(0, Math.min(100, r.value + by));
  }

  /* ---------------------------------------------------------------- the yard as it stands */

  /** The cut of the hump's simulation a wagon is in, or null (not on the hump yet, not to be humped, or gone). */
  cutOf(wagon) {
    return this.sim.cuts.find((c) => c.state !== "departed" && c.wagons.some((w) => w.id === wagon)) ?? null;
  }

  /**
   * Is a wagon in the track it is for: its cut wholly in it (still rolling to the wagons there, or
   * standing), or standing across its entrance (it leaves with the train)?
   */
  inPlace(w) {
    const c = this.cutOf(w.id), leaf = this.sim.yard.trackSegment(w.track);
    if (!c || c.route[c.route.length - 1] !== leaf.id || (c.state !== "running" && c.state !== "stopped")) return false;
    return c.s - c.body.length_m >= leaf.track.s0 - 1e-6 || (c.v === 0 && c.s >= leaf.track.s0 - 1e-6);
  }

  /** The booked wagons of an outbound train, and those of them not standing in its track yet. */
  booked(o) {
    return [...this.wagons.values()].filter((w) => w.out === o.id);
  }

  missing(o) {
    return this.booked(o).filter((w) => w.made == null && !this.inPlace(w));
  }

  /**
   * When a wagon is expected to stand in its track (s of the shift), and how far that may be off
   * (s); `needs`: what it needs first where it will not get there by itself (the locomotive).
   * @returns {{t: number | null, spread: number, needs?: string, where: string}}
   */
  eta(w) {
    const c = this.cutOf(w.id), sim = this.sim, tr = this.train(w.train), rule = Math.min(this.cap, PUSH.rule);
    if (c && (c.state === "running" || c.state === "stopped")) {
      const job = this.jobs.concat(this.loco.job ?? []).find((j) => j.cut === c.id);
      if (c.state === "stopped" && (c.rec.stop?.track !== w.track)) return { t: job ? this._jobEnd(job) : null, spread: 30, needs: job ? undefined : "the locomotive", where: c.rec.stop?.track ? `in track ${c.rec.stop.track}` : "before its track" };
      return { t: Math.max(this.t + 5, (c.rec.released_t ?? this.t) + ROLL_S), spread: ROLL_SPREAD_S, where: "rolling" };
    }
    if (w.noHump) {
      const job = this.jobs.concat(this.loco.job ?? []).find((j) => j.kind === "round" && j.train === w.train);
      const room = this.waiting.some((x) => x.train === w.train);
      return { t: job ? this._jobEnd(job) : null, spread: 30, needs: job ? undefined : room ? `room in track ${w.track}` : "the locomotive", where: "not to be humped" };
    }
    // still in its train: when the train is on the hump, how far the wagon is from the crest
    const before = tr.wagons.slice(0, tr.wagons.findIndex((x) => x.id === w.id)).filter((x) => !x.noHump).length;
    if (tr.state === "hump") {
      const v = this.v > 0 ? this.v : rule;
      return { t: (c?.state === "pushed" ? this.t + Math.max(0, sim.yard.crest_m - c.s + WAGON_M / 2) / v : this.t) + ROLL_S, spread: ROLL_SPREAD_S, where: "on the hump" };
    }
    const start = this._startOf(tr);
    return { t: start.t + (START_M + before * WAGON_M + WAGON_M / 2) / rule + ROLL_S, spread: start.spread + ROLL_SPREAD_S, where: tr.state === "coming" ? `in ${tr.id}, not in yet` : `in ${tr.id}, waiting` };
  }

  /** When the locomotive is expected free for the next train (s of the shift). */
  _free() {
    const sim = this.sim, P = sim.pushing, v = this.v > 0 ? this.v : PUSH.rule;
    let t = this.t;
    if (this.loco.state === "push" && P) t += P.cuts.reduce((m, c) => m + c.body.length_m, 0) / v + LOCO.back_s;
    else if (this.loco.state !== "idle") t = Math.max(t, this.loco.until);
    for (const j of this.jobs.filter((x) => x.first)) t += this._jobTime(j);
    return Math.max(t, this.inspection ?? 0);
  }

  /** When a train not on the hump yet is expected to start over it, and how far that may be off (s). */
  _startOf(tr) {
    let t = this._free(), spread = 0;
    const rule = Math.min(this.cap, PUSH.rule), time = (x) => (START_M + x.wagons.length * WAGON_M) / rule + LOCO.back_s;
    const queue = this.inbound.filter((x) => x.state === "waiting" || x.state === "coming").sort((a, b) => (a.id === this.nextUp ? -1 : b.id === this.nextUp ? 1 : this._expected(a) - this._expected(b)));
    for (const x of queue) {
      t = Math.max(t, this._expected(x));
      if (x === tr) return { t, spread: Math.max(spread, x.state === "coming" && !x.exact ? x.spread_s : 0) };
      t += time(x);
    }
    return { t, spread };
  }

  /** When a train is expected in (s of the shift): as announced. */
  _expected(tr) {
    return tr.state === "coming" ? Math.max(this.t, tr.planned + tr.told_s) : Math.min(this.t, tr.arrive);
  }

  /**
   * The tracks worth closing up now: one that is full to its entrance although its wagons stand
   * with gaps, while more wagons for it are to come; and one a cut for an outbound train stopped
   * before, while that train has not gone (closing up brings the cut in).
   */
  full() {
    const out = [];
    for (const t of this.sim.yard.tracks) {
      if (this.jobs.concat(this.loco.job ?? []).some((j) => j.kind === "close" && j.track === t.name)) continue;
      const c = this.sim.trackContents(t.name), o = this.outbound.find((x) => x.track === t.name && x.pulled_t == null);
      const toCome = [...this.wagons.values()].some((w) => w.track === t.name && w.made == null && !this.cutOf(w.id)?.rec.stop);
      const before = this._short(t.name).some((b) => b.s < this.sim.yard.trackSegment(t.name).track.s0);
      if ((toCome && c.cuts.length && c.free_m < WAGON_M && c.gaps_m + (c.end_m ?? 0) > WAGON_M) || (o && before)) out.push(t.name);
    }
    return out;
  }

  /* ---------------------------------------------------------------- the player's moves */

  /**
   * Set the pushing speed of the train on the hump (m/s; 0: it stops, the cuts already free roll on).
   * @param {number} v
   * @returns {{ok: boolean, reason?: string}}
   */
  push(v) {
    const n = Number(v), sim = this.sim;
    if (!Number.isFinite(n) || n < 0 || (n > 0 && n < PUSH.min - 1e-9) || n > PUSH.max + 1e-9) return { ok: false, reason: `The hump is pushed at ${speed(PUSH.min)} to ${speed(PUSH.max)} m/s, or stopped.` };
    if (this.loco.state !== "push" || !sim.pushing) return { ok: false, reason: "No train is on the hump." };
    if (n > this.cap + 1e-9) return { ok: false, reason: `${PEOPLE.hump.name} pushes at ${speed(this.cap)} m/s at most.` };
    if (this.inspection != null && n > 0) return { ok: false, reason: "The hump is stopped while its retarders are checked." };
    // (one locomotive: while it is away on a job, the train it left on the hump stands)
    if (this.loco.job && n > 0) return { ok: false, reason: `The locomotive is away from the train: it ${this._locoText()}.` };
    // (the yard master's own word: nothing pushes on by itself afterwards)
    this.loco.goOn = false;
    this._push(Math.round(n * 10) / 10);
    return { ok: true };
  }

  _push(v) {
    const sim = this.sim, tr = this.train(this.loco.train);
    if (v === this.v) return;
    // (stopped, it is pushed on at the speed it had)
    if (!v && this.v > 0) this.loco.resume = this.v;
    this.v = v;
    if (sim.pushing) sim.pushing.v = v;
    for (const r of sim.queue) r.push_mps = v;
    if (tr && v > tr.vmax) tr.vmax = v;
    this.give("handling-order", { hump: tr?.id ?? null, push_mps: v });
    this.log(`${hms(this.t)} ${v ? `${tr?.id ?? "The train"} is pushed at ${speed(v)} m/s` : `${tr?.id ?? "The train"} stops on the hump`}.`, "request");
  }

  /**
   * Choose the train that goes over the hump next: one that waits in the arrival tracks (a train that is not in yet cannot be chosen).
   * @param {string} train
   * @returns {{ok: boolean, reason?: string}}
   */
  hump(train) {
    const tr = this.inbound.find((x) => x.id === train);
    if (!tr) return { ok: false, reason: "There is no such train." };
    if (tr.state === "hump" || tr.state === "done") return { ok: false, reason: `${tr.id} ${tr.state === "done" ? "is humped" : "is on the hump"}.` };
    if (tr.state === "coming") return { ok: false, reason: `${tr.id} is not in yet.` };
    this.nextUp = tr.id;
    if (this.withdraw("next")) this.about.delete("next");
    // (a speed asked for another train that has not started is asked again when its turn comes)
    for (const d of this.open.filter((x) => x.id.startsWith("push-") && x.id !== `push-${tr.id}`)) {
      this.withdraw(d.id);
      this.about.delete(d.id);
    }
    this.log(`${hms(this.t)} ${tr.id} goes over the hump next.`, "request");
    return { ok: true };
  }

  /**
   * Hold an outbound train for wagons not in yet: it is pulled out when they stand in its track,
   * at the latest so many minutes after its cut-off (0: at its cut-off).
   * @param {string} train
   * @param {number} minutes
   * @returns {{ok: boolean, reason?: string}}
   */
  hold(train, minutes) {
    const o = this.outbound.find((x) => x.id === train), n = Number(minutes);
    if (!o) return { ok: false, reason: "There is no such outbound train." };
    if (o.pulled_t != null) return { ok: false, reason: `${o.id} is pulled out.` };
    if (!Number.isFinite(n) || n < 0 || n > HOLD.max_min) return { ok: false, reason: `A train is held 0 to ${HOLD.max_min} min.` };
    if (this.withdraw(`hold-${o.id}`)) this.about.delete(`hold-${o.id}`);
    o.asked = true;
    this._hold(o, Math.round(n / HOLD.step_min) * HOLD.step_min);
    return { ok: true };
  }

  _hold(o, n) {
    o.hold_min = n;
    this.log(`${hms(this.t)} Order: the ${hm(o.pull)} to ${o.to} ${n ? `waits for its wagons, until ${hms(o.pull + n * 60)} at the latest` : "is pulled out at its cut-off"}.`, "request");
    // a promise to the production dispatcher that no train waits longer
    const p = this.promises.find((x) => x.who === "production" && x.kept == null);
    if (p && n > p.max_min) this._broken(p, `the ${hm(o.pull)} is held ${mins(n * 60)} min`);
  }

  /**
   * Have the locomotive close up a track: its wagons are pushed buffer to buffer to its end, and a
   * cut that stopped before it is pushed in. Done when the locomotive is free of its train.
   * @param {string} track
   * @returns {{ok: boolean, reason?: string}}
   */
  close(track) {
    const t = this.sim.yard.tracks.find((x) => x.name === String(track));
    if (!t) return { ok: false, reason: "There is no such track." };
    if (this.jobs.some((j) => j.kind === "close" && j.track === t.name)) return { ok: false, reason: `Track ${t.name} is on the locomotive's list.` };
    if (!this.sim.trackContents(t.name).cuts.length && !this._short(t.name).length) return { ok: false, reason: `Track ${t.name} is empty.` };
    this.jobs.push({ kind: "close", track: t.name, first: true });
    this.log(`${hms(this.t)} Order: the locomotive closes up track ${t.name} ${this.loco.state === "push" && this.v > 0 ? "after this train" : "now"}.`, "request");
    return { ok: true };
  }

  /**
   * Have the locomotive fetch a cut that stands in the wrong track (or before its own) and put it into its own.
   * @param {string} cut
   * @param {boolean} [first] before the next train (else when no train waits)
   * @returns {{ok: boolean, reason?: string}}
   */
  fetch(cut, first = true) {
    const c = this.sim.bodies.find((b) => b.id === cut);
    if (!c || !this.wrong.has(cut)) return { ok: false, reason: "No such cut stands in a wrong track." };
    if (this.jobs.some((j) => j.cut === cut)) return { ok: false, reason: "It is on the locomotive's list." };
    this.jobs.push({ kind: "fetch", cut, first: !!first });
    if (this.withdraw(`wrong-${cut}`)) this.about.delete(`wrong-${cut}`);
    this.log(`${hms(this.t)} Order: the locomotive fetches the ${this._cutName(c)} ${first ? "before the next train" : "when no train waits"}.`, "request");
    return { ok: true };
  }

  /* ---------------------------------------------------------------- the locomotive */

  _jobTime(j) {
    if (j.kind === "close") return LOCO.close_s;
    if (j.kind === "round") return LOCO.round_s;
    const c = this.sim.bodies.find((b) => b.id === j.cut), leafId = c?.route[c.route.length - 1];
    const inWay = c ? this.sim.bodies.filter((b) => b !== c && b.v === 0 && b.route[b.route.length - 1] === leafId && b.s < c.s).length : 0;
    return LOCO.fetch_s + inWay * LOCO.per_cut_s;
  }

  _jobEnd(j) {
    if (this.loco.job === j) return this.loco.until;
    let t = this._free();
    for (const x of this.jobs) {
      if (!x.first) t += this._jobTime(x);
      if (x === j) return t;
    }
    return t;
  }

  /** The cuts that stopped before a track's entrance on their way into it. */
  _short(track) {
    return this.sim.bodies.filter((b) => b.v === 0 && b.state === "stopped" && b.track === track && b.rec.stop && b.rec.stop.track == null && !b.derailed);
  }

  /** No cut rolls towards these tracks (the locomotive does not go into a track a cut rolls into). */
  _quiet(tracks) {
    return !this.sim.bodies.some((b) => b.v > 0 && tracks.includes(b.track));
  }

  /** The tracks a job works in. */
  _tracksOf(j) {
    if (j.kind === "close") return [j.track];
    if (j.kind === "round") return [j.track];
    const c = this.sim.bodies.find((b) => b.id === j.cut);
    return c ? [c.track, c.intended, c.rec.stop?.track].filter(Boolean) : [];
  }

  /** The locomotive's work, step by step: the train on the hump, back to the next, its jobs, the next train. */
  _work() {
    const L = this.loco, sim = this.sim;
    if (this.inspection != null && this.t >= this.inspection) {
      this.inspection = null;
      this.log(`${hms(this.t)} ${PEOPLE.hump.name}: "Retarders checked. From now on I push at ${speed(this.cap)}, whatever you say."`, "request");
      // (a train that was moving when the hump was stopped is pushed on, unless the locomotive is away on a job: then after it)
      if (L.state === "push" && sim.pushing && L.goOn && !L.job) {
        L.goOn = false;
        this._push(Math.min(this.cap, L.resume || PUSH.auto));
      }
    }
    if (L.state === "push") {
      const tr = this.train(L.train);
      if (tr.rec.humped_t != null) {
        tr.state = "done";
        tr.humped_t = this.t;
        this.v = 0;
        this._humped(tr);
        Object.assign(L, { state: "back", until: this.t + LOCO.back_s, train: null });
      } else if ((this.v === 0 || sim.pushing?.blocked) && this.inspection == null && !L.job) {
        // the train stands on the hump (stopped, or the yard is backed up to the crest): the locomotive can leave it for a job
        const j = this.jobs.find((x) => this._quiet(this._tracksOf(x)));
        if (j) this._start(j, true);
      }
    }
    if (L.job && this.t >= L.until) this._done();
    if (L.state === "back" && this.t >= L.until) L.state = "idle";
    if (L.state === "push" || this.t < FIRST_S) return;
    // the next train: which one, and how fast, is asked while the locomotive is on its way back or at a job
    const waiting = this.inbound.filter((x) => x.state === "waiting");
    const chosen = waiting.find((x) => x.id === this.nextUp) ?? (waiting.length === 1 ? waiting[0] : null);
    if (!chosen && waiting.length > 1 && !this.open.some((d) => d.id === "next")) this._askNext(waiting);
    if (chosen && chosen.push == null && !this.open.some((d) => d.id === `push-${chosen.id}`)) this._askPush(chosen);
    if (L.state !== "idle" || this.inspection != null) return;
    // a wagon that found no room in its track is taken round again once the track has room for it
    for (const x of [...this.waiting]) {
      const ws = [...this.wagons.values()].filter((w) => w.train === x.train && w.noHump && !this.cutOf(w.id)), c = sim.trackContents(x.track);
      if (ws.length && c.free_m < ws.length * WAGON_M + 1) continue;
      this.waiting = this.waiting.filter((y) => y !== x);
      if (ws.length) this.jobs.push({ kind: "round", train: x.train, track: x.track, first: false });
    }
    // jobs before the next train; those for later only while no train waits
    const j = this.jobs.find((x) => (x.first || !waiting.length) && this._quiet(this._tracksOf(x)));
    if (j) return void this._start(j, false);
    if (this.jobs.some((x) => x.first) && waiting.length) return; // a job before the next train waits for its track to be quiet
    if (chosen?.push != null) this._begin(chosen, Math.min(this.cap, chosen.push));
  }

  _start(j, onHump) {
    this.jobs = this.jobs.filter((x) => x !== j);
    const L = this.loco, s = this._jobTime(j);
    // (a train that was blocked is pushed on after the job; one the yard master stopped stays stopped)
    Object.assign(L, { job: j, until: this.t + s, goOn: L.goOn || (onHump && this.v > 0), ...(onHump ? {} : { state: "job" }) });
    if (onHump && this.v > 0) this._push(0);
    this.log(`${hms(this.t)} The locomotive ${j.kind === "close" ? `closes up track ${j.track}` : j.kind === "round" ? `takes the wagon that must not be humped round to track ${j.track}` : `fetches the ${this._cutName(this.sim.bodies.find((b) => b.id === j.cut))}`}: until ${hms(this.t + s)}.`, "info");
  }

  _done() {
    const L = this.loco, j = L.job, sim = this.sim;
    L.job = null;
    if (j.kind === "close") {
      for (const c of this._short(j.track)) sim.moveCut(c.id, j.track) || (sim.pushUp(j.track), sim.moveCut(c.id, j.track));
      const won = sim.pushUp(j.track);
      this.log(`${hms(this.t)} Track ${j.track} is closed up: ${Math.round(won)} m won at its entrance.`, "info");
    } else if (j.kind === "fetch") {
      const c = sim.bodies.find((b) => b.id === j.cut);
      if (c) {
        const ok = sim.moveCut(c.id, c.intended) || (sim.pushUp(c.intended), sim.moveCut(c.id, c.intended));
        if (ok) this.wrong.delete(c.id);
        this.log(`${hms(this.t)} ${ok ? `The ${this._cutName(c)} stands in track ${c.intended} now.` : `No room in track ${c.intended} for the ${this._cutName(c)}: it stays where it is.`}`, ok ? "info" : "fault");
      }
    } else if (j.kind === "round") {
      const ws = [...this.wagons.values()].filter((w) => w.train === j.train && w.noHump && !this.cutOf(w.id));
      const put = (group) => sim.setOut({ id: `${j.train}/r`, train: j.train, wagons: group.map((w) => ({ id: w.id, type: w.type, loaded: w.loaded, careful: w.careful })) }, j.track);
      if (ws.length) {
        const c = put(ws) ?? (sim.pushUp(j.track), put(ws));
        // (no room: it is taken round again when the track has some, after its train has gone at the latest)
        if (!c) this.waiting.push({ train: j.train, track: j.track });
        this.log(`${hms(this.t)} ${c ? `The wagon that must not be humped stands in track ${j.track}.` : `No room in track ${j.track}: the wagon is back in the arrival tracks, until the track has room.`}`, c ? "info" : "fault");
      }
    }
    if (L.state === "job") Object.assign(L, { state: "back", until: this.t + 20 });
    else if (L.state === "push" && L.goOn && this.inspection == null) {
      L.goOn = false;
      this._push(Math.min(this.cap, L.resume || PUSH.auto));
    }
  }

  /** A cut in words: "tank wagon for track 2", "2 wagons for track 3". */
  _cutName(c) {
    if (!c) return "cut";
    const ws = c.wagons.map((w) => this.wagons.get(w.id)).filter(Boolean);
    return `${ws.length === 1 ? (ws[0].careful ? "tank wagon" : "wagon") : `${ws.length} wagons`} for track ${c.intended}`;
  }

  /* ---------------------------------------------------------------- what is asked */

  /** Two trains or more wait: which goes over the hump next? One of a few choices. */
  _askNext(waiting) {
    const first = [...waiting].sort((a, b) => a.arrive - b.arrive);
    this.about.set("next", first.map((x) => `train-${x.id}`));
    const o = this.outbound.find((x) => x.pulled_t == null), need = (tr) => tr.wagons.filter((w) => w.track === o?.track);
    const a = first[0], most = [...first].sort((x, y) => need(y).length - need(x).length)[0];
    const names = first.map((x) => x.id), list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
    // what a train carries for the outbound trains still to go, in a few words: "06:10: 2 (priority), 06:14: 3"
    const load = (tr) => this.outbound.filter((x) => x.pulled_t == null).map((x) => [x, tr.wagons.filter((w) => w.track === x.track)]).filter(([, ws]) => ws.length)
      .map(([x, ws]) => `${hm(x.pull)}: ${ws.length}${ws.some((w) => w.priority) ? " (priority)" : ""}${ws.some((w) => w.noHump) ? " (1 not to be humped)" : ""}`).join(", ");
    this.ask({
      id: "next", title: `${list} wait in the arrival tracks. Which goes over the hump next?`,
      text: `${a.id} came in first${o && most !== a ? `; ${most.id} has more wagons for the ${hm(o.pull)} to ${o.to}` : ""}. The yard's instructions say: in the order they came. `
        + `A train takes about ${mins((START_M + a.wagons.length * WAGON_M) / PUSH.rule + LOCO.back_s)} min over the hump at ${speed(PUSH.rule)} m/s, the locomotive's way back counted, and its last wagons are in their tracks ${mins(ROLL_S)} min after that. `
        + `Beside each train: how many of its wagons are booked on which outbound train.`,
      options: first.map((x, i) => ({ id: x.id, label: `${x.id} from ${x.from}`, hint: `${i === 0 ? "first in; " : ""}${load(x) || "nothing booked"}` })),
      fallback: a.id,
      then: (id) => {
        this.about.delete("next");
        this.nextUp = id;
        this.log(`${hms(this.t)} ${id} goes over the hump next.`, "request");
      },
    });
  }

  /** A train is coupled to the locomotive: how fast is it pushed? A number. */
  _askPush(tr) {
    const id = `push-${tr.id}`, n = tr.wagons.filter((w) => !w.noHump);
    const bad = n.filter((w) => classOf(w) === "bad").length;
    // a good runner right behind a bad one in another cut: the pair that catches up
    let pairs = 0;
    for (let i = 1; i < n.length; i++) if (n[i].track !== n[i - 1].track && classOf(n[i - 1]) === "bad" && classOf(n[i]) !== "bad") pairs++;
    const o = this.outbound.find((x) => x.pulled_t == null && n.some((w) => w.track === x.track));
    const len = START_M + n.length * WAGON_M, free = this._free(), over = (v) => free + len / v + ROLL_S;
    const max = Math.min(PUSH.max, this.cap), tank = n.some((w) => w.careful), value = Math.min(max, PUSH.rule);
    this.about.set(id, ["hump", `train-${tr.id}`]);
    this.ask({
      id, title: `${tr.id} is ready for the hump. How fast shall it be pushed?`,
      text: `Faster, its wagons are in sooner; above ${speed(PUSH.limit)} m/s a switch may not get between two cuts, and wagons meet too hard. `
        + `${tr.id}: ${plural(n.length, "wagon")}, ${bad} of them bad runners, ${pairs ? `${plural(pairs, "good runner")} right behind a bad one` : "no good runner right behind a bad one"}${tank ? ", and a tank wagon to shunt with care" : ""}. `
        + `At ${speed(value)} m/s its last wagon stands at about ${hms(Math.round(over(value) / 10) * 10)}${max > value ? `, at ${speed(max)} at about ${hms(Math.round(over(max) / 10) * 10)}` : ""}. `
        + `${o ? `The ${hm(o.pull)} to ${o.to} takes ${n.filter((w) => w.track === o.track).length} of them. ` : ""}`
        + `${max < PUSH.max ? `${PEOPLE.hump.name} pushes at ${speed(max)} at most. ` : ""}You can change the speed while it is pushed: tap the hump.`,
      scale: { min: PUSH.min, max, step: PUSH.step, unit: "m/s", value, label: `${tr.id} is pushed at` },
      fallback: Math.min(max, PUSH.auto),
      then: (v) => {
        this.about.delete(id);
        tr.push = Number(v);
        if (this.loco.state !== "idle") this.log(`${hms(this.t)} ${tr.id} will be pushed at ${speed(tr.push)} m/s.`, "request");
      },
    });
  }

  /** A train starts over the hump. */
  _begin(tr, v) {
    const sim = this.sim;
    tr.state = "hump";
    tr.started_t = this.t;
    if (this.nextUp === tr.id) this.nextUp = null;
    tr.rec = sim.hump({ id: tr.id, push_mps: v, wagons: tr.wagons.map((w) => ({ id: w.id, type: w.type, loaded: w.loaded, track: w.track, careful: w.careful, noHump: w.noHump })) });
    Object.assign(this.loco, { state: "push", train: tr.id, until: 0, resume: v, goOn: false });
    this.v = 0;
    this._push(v);
  }

  /** A train is over the hump: what the hump operator makes of it, and the wagons that were not humped. */
  _humped(tr) {
    const fast = Math.max(0, tr.vmax - PUSH.limit);
    if (fast > 1e-9) this._mood("hump", (MOOD.fast * fast) / 0.2);
    else if (tr.clean) this._mood("hump", MOOD.clean);
    this.log(`${hms(this.t)} ${tr.id} is over the hump${tr.vmax > PUSH.limit ? `, pushed at up to ${speed(tr.vmax)} m/s` : ""}.`, "train");
    const left = tr.wagons.filter((w) => w.noHump);
    if (left.length) this._askRound(tr, left);
    this._patience("hump");
  }

  /** A wagon that must not be humped stands in the arrival tracks: when does the locomotive take it round? One of a few choices. */
  _askRound(tr, left) {
    const id = `round-${tr.id}`, w = this.wagons.get(left[0].id), o = this.outbound.find((x) => x.id === w.out);
    const next = this.inbound.filter((x) => x.state === "waiting" || x.state === "coming").sort((a, b) => this._expected(a) - this._expected(b))[0];
    const there = this.t + LOCO.back_s + LOCO.round_s, late = o && o.pulled_t == null ? Math.max(0, there - o.pull) : null;
    this.about.set(id, [`track-${w.track}`]);
    this.ask({
      id, title: `A tank wagon of ${tr.id} must not be humped (label 15). When does the locomotive take it round to track ${w.track}?`,
      text: `Now, ${next ? `${next.id} waits ${mins(LOCO.round_s)} min longer for the hump` : "no train waits for it"}; later, the wagon ${o && o.pulled_t == null ? `may miss the ${hm(o.pull)} to ${o.to}` : "stands in the arrival tracks meanwhile"}. `
        + `Taken round now, it stands in track ${w.track} at about ${hms(Math.round(there / 10) * 10)}${late != null ? (late > 0 ? `, ${mins(late)} min after the cut-off of the ${hm(o.pull)}` : `, in time for the ${hm(o.pull)}`) : ""}. `
        + `The locomotive needs ${mins(LOCO.round_s)} min for the way round the hump, and it is the only one. ${o ? `The wagon is booked on the ${hm(o.pull)}; if it misses that, it goes with the next train to ${o.to}, twelve hours on.` : ""}`,
      options: [
        { id: "now", label: "Now, before the next train", hint: next ? `${next.id} waits` : undefined },
        { id: "free", label: "When no train waits for the hump" },
      ],
      within: DECIDE_S.loco, fallback: "free",
      then: (x) => {
        this.about.delete(id);
        this.jobs.push({ kind: "round", train: tr.id, track: w.track, first: x === "now" });
        this.log(`${hms(this.t)} Order: the locomotive takes the wagon round ${x === "now" ? "before the next train" : "when no train waits"}.`, "request");
      },
    });
  }

  /** A cut stands in the wrong track: when does the locomotive fetch it? One of a few choices. */
  _askWrong(c) {
    const id = `wrong-${c.id}`, now = c.rec.stop?.track;
    if (this._asked.has(`${id}|${now}`)) return;
    this._asked.add(`${id}|${now}`);
    const ws = c.wagons.map((w) => this.wagons.get(w.id)), o = this.outbound.find((x) => x.id === ws[0]?.out && x.pulled_t == null);
    const there = this.outbound.find((x) => x.track === now && x.pulled_t == null);
    const s = this._jobTime({ kind: "fetch", cut: c.id });
    this.about.set(id, [`cut-${c.id}`, `track-${c.intended}`]);
    this.ask({
      id, title: `The ${this._cutName(c)} stands ${now ? `in track ${now}` : "before its track"}. When does the locomotive fetch it?`,
      text: `Fetched before the next train, the hump waits about ${mins(s)} min; left where it is, ${o ? `it misses the ${hm(o.pull)} to ${o.to}` : "it goes to the wrong sidings"}. `
        + `${there ? `The ${hm(there.pull)} to ${there.to}, in whose track it stands, then leaves ${WRONG_MIN} min late: a wrong wagon is shunted out at its check. ` : ""}`
        + `Every cut that comes to stand behind it makes fetching it ${mins(LOCO.per_cut_s)} min longer.`,
      options: [
        { id: "now", label: "Before the next train" },
        { id: "free", label: "When no train waits for the hump" },
        { id: "leave", label: "Leave it where it is" },
      ],
      within: DECIDE_S.loco, fallback: "free",
      then: (x) => {
        this.about.delete(id);
        if (x === "leave") this.log(`${hms(this.t)} The ${this._cutName(c)} stays where it is.`, "request");
        else this.fetch(c.id, x === "now");
      },
    });
  }

  /** Wagons booked on an outbound train are not in at its cut-off: how long does it wait? A number of minutes. */
  _askHold(o) {
    o.asked = true;
    const miss = this.missing(o);
    if (!miss.length) return;
    const id = `hold-${o.id}`, etas = miss.map((w) => ({ w, ...this.eta(w) }));
    const coming = etas.filter((e) => e.t != null), lo = Math.max(0, ...coming.map((e) => e.t - e.spread - o.pull)), hi = Math.max(0, ...coming.map((e) => e.t + e.spread - o.pull));
    const mid = Math.max(0, ...coming.map((e) => e.t - o.pull)), stuck = etas.filter((e) => e.t == null), prio = miss.filter((w) => w.priority).length;
    const where = [...new Set(etas.map((e) => e.where))].join(", ");
    const p = this.promises.find((x) => x.who === "production" && x.kept == null);
    this.about.set(id, [`track-${o.track}`]);
    this.ask({
      id, title: `${plural(miss.length, "wagon")} for the ${hm(o.pull)} to ${o.to} ${miss.length === 1 ? "is" : "are"} not in track ${o.track} yet. How long shall the train wait?`,
      text: `Its path waits ${HOLD.slot_min} min; held longer, the train loses it and goes ${NEXT_PATH.min[0]} or ${NEXT_PATH.min[1]} min late. Left at its cut-off, the wagons stay behind until the next train to ${o.to}, twelve hours on. `
        + `${this.booked(o).length - miss.length} of ${this.booked(o).length} booked wagons stand in track ${o.track}; missing: ${where}${prio ? ` (${prio} of them a customer's priority wagons)` : ""}. `
        + `${coming.length ? `As it looks, ${coming.length === miss.length ? "they are" : `${coming.length} of them are`} in about ${mins(mid)} min after the cut-off (it may be ${mins(lo)} to ${mins(hi)}). ` : ""}`
        + `${stuck.length ? `${plural(stuck.length, "wagon")} will not come without ${[...new Set(stuck.map((e) => e.needs))].join(" and ")}. ` : ""}`
        + `${p ? `You promised ${PEOPLE.production.name}: no train waits longer than ${mins(p.max_min * 60)} min. ` : ""}The train is pulled out as soon as its wagons are in; without your word it waits for them as long as it may, ${HOLD.max_min} min.`,
      scale: { min: 0, max: HOLD.max_min, step: HOLD.step_min, unit: "min", value: Math.min(HOLD.slot_min, Math.ceil(mid / 30) / 2), label: `The ${hm(o.pull)} waits at most` },
      within: DECIDE_S.hold, fallback: HOLD.max_min,
      then: (n) => {
        this.about.delete(id);
        this._hold(o, Number(n));
      },
    });
  }

  /** One of the three is below the mark: the phone rings (once each). */
  _call(who) {
    if (this.over || this.called.has(who) || this.value(`mood-${who}`) >= MOOD.call) return;
    const p = PEOPLE[who], id = `call-${who}`;
    this.called.add(who);
    this.log(`${hms(this.t)} ${p.name}, ${p.role}, is on the phone.`, "request");
    if (who === "hump") {
      this.about.set(id, ["hump"]);
      // (what the operator names: the impacts, the cuts that ran into a wrong track, or the speed alone)
      const hard = this.hard.length, wrong = this.irregulars.filter((x) => x.kind === "misrouted").length, fastest = Math.max(...this.inbound.map((x) => x.vmax));
      const what = hard ? `${plural(hard, "impact")} over the limit${wrong ? ` and ${plural(wrong, "cut")} in the wrong track` : ""} this morning` : wrong ? `${plural(wrong, "cut")} in the wrong track this morning` : `${speed(fastest)} m/s over my hump`;
      this.ask({
        id, title: `${p.name}, ${p.role}, is on the phone: “${what.replace(/^./, (ch) => ch.toUpperCase())}. At that speed, in this frost, I am not letting the next train go.”`,
        text: `Give in, and the trains still to come take longer over the hump; insist, and the next impact is yours. The hump operator answers for every impact: below ${MOOD.act} of 100 the operator stops the hump to inspect the retarders (${mins(LOCO.inspect_s)} min) and pushes at ${speed(PUSH.auto)} m/s from then on. ${p.name}'s patience is at ${this.mood(who)}.`,
        options: [
          { id: "rule", label: `Back to ${speed(PUSH.rule)} m/s for the rest of the shift` },
          { id: "limit", label: `${speed(PUSH.limit)} m/s at most from now on` },
          { id: "insist", label: "As ordered: I answer for it" },
        ],
        within: DECIDE_S.call, fallback: "limit",
        then: (o) => {
          this.about.delete(id);
          if (o === "insist") {
            this._mood(who, MOOD.declined);
            this.log(`${hms(this.t)} ${p.name}: "Then it is in the book under your name."`, "request");
          } else {
            this.cap = o === "rule" ? PUSH.rule : PUSH.limit;
            this._mood(who, o === "rule" ? MOOD.promise : MOOD.compromise);
            if (this.v > this.cap) this._push(this.cap);
            this.log(`${hms(this.t)} Agreed with ${p.name}: ${speed(this.cap)} m/s at most from now on.`, "request");
          }
          this._act(who);
        },
      });
    } else if (who === "production") {
      const last = this.outbound.filter((x) => x.pulled_t != null).at(-1), left = this.outbound.filter((x) => x.pulled_t == null);
      this.about.set(id, left.slice(0, 1).map((x) => `track-${x.track}`));
      this.ask({
        id, title: `${p.name}, ${p.role}, is on the phone: “${last ? `The ${hm(last.pull)} went ${last.lost ? `without its path, ${last.late_min} min late` : `${mins(last.late_min * 60)} min late`}.` : "Your trains are not ready."} My drivers are on the clock. Can I count on the next ones leaving on the minute?”`,
        text: `A promise helps now and binds you; what you promise here, the wagons that are not in yet pay. ${left.length ? `The ${left.map((x) => hm(x.pull)).join(" and the ")} must then be pulled out no later than you say` : "There is no later train to promise for"}. An explanation is taken or not. ${p.name}'s patience is at ${this.mood(who)}.`,
        options: [
          ...(left.length ? [{ id: "promise", label: "Promise: no train waits from now on" }, { id: "two", label: "Offer: no train waits more than 2 min" }] : []),
          { id: "explain", label: "Explain: a wagon left behind costs more than a minute" },
        ],
        within: DECIDE_S.call, fallback: "explain",
        then: (o) => {
          this.about.delete(id);
          if (o === "promise" || o === "two") {
            const max = o === "promise" ? 0.5 : 2;
            this.promises.push({ who, what: `no train waits more than ${mins(max * 60)} min`, max_min: max, kept: null });
            this._mood(who, o === "promise" ? MOOD.promise : MOOD.compromise);
            this.log(`${hms(this.t)} Promised to ${p.name}: ${o === "promise" ? "no train waits from now on" : "no train waits more than 2 min"}.`, "request");
            for (const x of left) if (x.hold_min > max) this._broken(this.promises.at(-1), `the ${hm(x.pull)} is held ${mins(x.hold_min * 60)} min`);
          } else {
            const taken = this.rng("call", who).next() < ACCEPT;
            this._mood(who, taken ? MOOD.explained : MOOD.refused);
            this.log(`${hms(this.t)} ${p.name}: "${taken ? "All right. But not a minute more than you must." : "Tell that to a driver whose shift ends at five."}"`, "request");
          }
        },
      });
    } else {
      const o = this.outbound.find((x) => x.pulled_t == null && this.missing(x).length);
      const miss = o ? this.missing(o) : [];
      this.about.set(id, o ? [`track-${o.track}`] : []);
      this.ask({
        id, title: `${p.name}, ${p.role}, is on the phone: “Wagons of mine stood there when their train left. ${o ? `${plural(miss.length, "wagon")} for the ${hm(o.pull)} to ${o.to} ${miss.length === 1 ? "is" : "are"} not in yet. Does it wait for them?` : "What do I tell the customers?"}”`,
        text: `A promise helps now and binds you; what you promise here, the train's path and its driver may pay. ${o ? `The ${hm(o.pull)} must then leave with every wagon booked on it, however long that takes` : "There is no train left to promise for"}. ${p.name}'s patience is at ${this.mood(who)}.`,
        options: [
          ...(o ? [{ id: "promise", label: `Promise: the ${hm(o.pull)} waits for its wagons` }, { id: "try", label: `Offer: it waits the ${HOLD.slot_min} min its path allows` }] : []),
          { id: "no", label: o ? "Refuse: it leaves at its cut-off" : "Say sorry and get back to the hump" },
        ],
        within: DECIDE_S.call, fallback: o ? "try" : "no",
        then: (x) => {
          this.about.delete(id);
          if (x === "promise") {
            this.promises.push({ who, what: `the ${hm(o.pull)} leaves with all its wagons`, train: o.id, kept: null });
            this._mood(who, MOOD.promise);
            this.log(`${hms(this.t)} Promised to ${p.name}: the ${hm(o.pull)} waits for its wagons.`, "request");
          } else if (x === "try") {
            this._mood(who, MOOD.compromise);
            this.log(`${hms(this.t)} ${p.name}: "Three minutes. I will tell them it is being tried."`, "request");
          } else {
            this._mood(who, MOOD.declined);
            this.log(`${hms(this.t)} ${p.name}: "Then the customer hears it from you next time."`, "request");
          }
        },
      });
    }
  }

  /** A promise is not kept. */
  _broken(p, why) {
    if (p.kept != null) return;
    p.kept = false;
    this._mood(p.who, MOOD.broken);
    this.violate("promise", `${hms(this.t)} Promised to ${PEOPLE[p.who].name}: ${p.what}. Not kept: ${why}.`, 2);
    this.irregular("promise-broken", `promise:${p.who}`, { who: PEOPLE[p.who].name });
  }

  /**
   * Somebody's patience is at its end. The hump operator stops the hump for an inspection and
   * pushes at the careful speed from then on; the production dispatcher complains to the yard's
   * owner about its service; the customer service agent passes on a customer's claim.
   */
  _act(who) {
    if (this.value(`mood-${who}`) >= MOOD.act || this.acted.has(who)) return;
    this.acted.add(who);
    if (who !== "hump") {
      const p = PEOPLE[who];
      this.violate("complaint", who === "production"
        ? `${hms(this.t)} ${p.name} complains in writing about the yard's service: trains that do not leave when they are due.`
        : `${hms(this.t)} ${p.name} passes on a customer's claim for the wagons left behind, and the customer asks for a road haulier's price.`, 2);
      this.irregular("complaint", `complaint:${who}`, { who: p.name });
      return;
    }
    this.inspection = this.t + LOCO.inspect_s;
    this.cap = PUSH.auto;
    if (this.v > 0) {
      this.loco.goOn = true;
      this._push(0);
    }
    this.log(`${hms(this.t)} ${PEOPLE.hump.name} stops the hump: the retarders are inspected until ${hms(this.inspection)}.`, "fault");
    this.irregular("hump-stopped", "hump-stopped", { who: PEOPLE.hump.name, min: mins(LOCO.inspect_s) });
  }

  /** What the computer's yard master would decide (a decision's id → an option or a number). */
  advice(id) {
    const d = this.open.find((x) => x.id === id);
    if (!d) return null;
    if (id === "next") {
      const o = this.outbound.find((x) => x.pulled_t == null);
      const waiting = d.options.map((x) => this.train(x.id)), n = (tr) => tr.wagons.filter((w) => w.track === o?.track).reduce((s, w) => s + (w.priority ? 2 : 1), 0);
      return [...waiting].sort((a, b) => n(b) - n(a) || a.arrive - b.arrive)[0].id;
    }
    if (id.startsWith("push-")) {
      const tr = this.train(id.slice(5)), tank = tr.wagons.some((w) => w.careful && !w.noHump), free = this._free();
      // wagons short of time for their train: those that would be in less than a minute before its cut-off
      const tight = tr.wagons.some((w) => {
        const o = this.outbound.find((x) => x.id === this.wagons.get(w.id).out && x.pulled_t == null);
        return o && free + (START_M + tr.wagons.length * WAGON_M) / PUSH.rule + ROLL_S > o.pull - 60;
      });
      return Math.min(d.scale.max, tight && !tank ? PUSH.limit : PUSH.rule);
    }
    if (id.startsWith("hold-")) {
      const o = this.train(id.slice(5)), etas = this.missing(o).map((w) => this.eta(w)).filter((e) => e.t != null);
      if (!etas.length) return 0;
      const need = Math.max(...etas.map((e) => e.t - o.pull)) / 60 + 0.25, p = this.promises.find((x) => x.who === "production" && x.kept == null);
      const max = Math.min(HOLD.slot_min, p?.max_min ?? HOLD.slot_min);
      return need <= max ? Math.max(0, Math.ceil(need / HOLD.step_min) * HOLD.step_min) : this.promises.some((x) => x.train === o.id && x.kept == null) ? Math.min(HOLD.max_min, Math.ceil(need)) : 0;
    }
    if (id.startsWith("round-") || id.startsWith("wrong-")) {
      const c = id.startsWith("wrong-") ? this.sim.bodies.find((b) => b.id === id.slice(6)) : null;
      const w = c ? this.wagons.get(c.wagons[0].id) : [...this.wagons.values()].find((x) => x.train === id.slice(6) && x.noHump);
      const o = this.outbound.find((x) => x.id === w?.out && x.pulled_t == null);
      const s = c ? this._jobTime({ kind: "fetch", cut: c.id }) : LOCO.round_s;
      // the locomotive first where the wagon can still make its train within the path's three minutes, and no
      // train waits for the hump with wagons for a cut-off that is as near
      const rival = this.inbound.some((x) => x.state === "waiting" && x.wagons.some((y) => this.outbound.some((z) => z.track === y.track && z.pulled_t == null && o && z.pull <= o.pull)));
      return o && !rival && this._free() + s <= o.pull + HOLD.slot_min * 60 ? "now" : "free";
    }
    if (id === "call-hump") return "limit";
    if (id === "call-production") return d.options.some((x) => x.id === "two") ? "two" : "explain";
    if (id === "call-customers") return d.options.some((x) => x.id === "try") ? "try" : "no";
    return d.fallback ?? d.options[0]?.id ?? null;
  }

  /* ---------------------------------------------------------------- what comes of it */

  /** What the hump's simulation noted since the last step. */
  _read() {
    const sim = this.sim;
    for (; this._seen < sim.log.length; this._seen++) {
      const e = sim.log[this._seen], c = e.cut ? sim.cuts.find((x) => x.id === e.cut) : null, tr = c ? this.train(c.train) : null;
      if (e.type === "cut.misrouted") {
        if (tr) tr.clean = false;
        this._mood("hump", MOOD.misrouted);
        this.log(`${hms(this.t)} A switch did not get between two cuts: the ${this._cutName(c)} runs into track ${e.now}.`, "fault");
        this.irregular("misrouted", `misrouted:${c.id}`, { cut: this._cutName(c), track: e.now, intended: e.intended });
        this._patience("hump");
      } else if (e.type === "cut.hard") {
        if (tr) tr.clean = false;
        const ws = c.wagons.map((w) => this.wagons.get(w.id)).filter(Boolean), tank = c.careful;
        for (const w of ws) w.damaged = true;
        this.hard.push({ cut: c.id, v: e.v_mps, careful: tank, t: this.t });
        this._mood("hump", tank ? MOOD.careful : MOOD.hard);
        this._mood("customers", MOOD.damaged * ws.filter((w) => w.out).length);
        const fast = (tr?.vmax ?? 0) > PUSH.limit + 1e-9;
        if (tank) {
          this.violate("careful", `${hms(this.t)} The tank wagon (label 13: shunt with care) met the wagons in track ${c.track} at ${e.v_mps.toFixed(1)} m/s${fast ? `, in a train pushed at ${speed(tr.vmax)} m/s on your word` : ""}: an incident report.`, fast ? 3 : 2);
          this.give("incident-report", { kind: "hard impact on a dangerous goods wagon", cut: c.id, v_mps: e.v_mps, track: c.track });
        } else this.log(`${hms(this.t)} Too hard: the ${this._cutName(c)} met the wagons in track ${c.track} at ${e.v_mps.toFixed(1)} m/s (the limit is 1.25).`, "fault");
        this.irregular("hard-impact", `hard:${c.id}`, { cut: this._cutName(c), speed: e.v_mps.toFixed(1), track: c.track });
        this._patience("hump");
      } else if (e.type === "cut.derailed") {
        this._mood("hump", MOOD.careful);
        this.violate("derailed", `${hms(this.t)} A cut derailed in a switch that was moving.`, 2);
        this._patience("hump");
      } else if ((e.type === "cut.stopped" || e.type === "cut.moved") && c) this._stood(c);
      else if (e.type === "train.blocked") {
        const by = sim.cuts.find((x) => x.id === e.by);
        this.log(`${hms(this.t)} The yard is backed up to the crest: ${e.train} cannot be pushed on until track ${by?.track ?? "?"} is closed up.`, "fault");
        this.irregular("blocked", `blocked:${e.train}:${by?.track}`, { train: e.train, track: by?.track ?? "" });
      }
    }
  }

  /**
   * A cut has come to stand, or the locomotive has put it somewhere: where it belongs it is no
   * longer wrong; in another track the yard master is asked when to fetch it (once for each track it
   * comes to stand in); before a track, or across its entrance, the hump operator says so, and
   * closing up that track brings it in.
   */
  _stood(c) {
    const here = c.rec.stop?.track ?? null, was = this.wrong.get(c.id);
    if (here === c.intended) return void this.wrong.delete(c.id);
    if (c.state !== "stopped" || (was && was.track === here)) return;
    this.wrong.set(c.id, { track: here, t: this.t });
    if (here) return void this._askWrong(c);
    const tr = this.train(c.train);
    if (tr) tr.clean = false;
    this.log(`${hms(this.t)} ${PEOPLE.hump.name}: "The ${this._cutName(c)} stopped before its track. Close up track ${c.track}, or the next ones run into it."`, "fault");
    this.irregular("short", `short:${c.id}`, { cut: this._cutName(c), track: c.track });
  }

  /** Somebody's patience has fallen: below the first mark they phone (once), below the second they act (once). */
  _patience(who) {
    this._call(who);
    this._act(who);
  }

  /** An inbound train comes in, or its forecast is made exact. */
  _arrivals() {
    for (const tr of this.inbound.filter((x) => x.state === "coming")) {
      if (!tr.announced && tr.told_s >= 60 && this.t >= Math.min(60, tr.planned - 300)) {
        tr.announced = true;
        this.log(`${hms(this.t)} ${tr.id} from ${tr.from} is announced about ${mins(tr.told_s)} min late${tr.spread_s ? ` (it may be ${mins(Math.max(0, tr.told_s - tr.spread_s))} to ${mins(tr.told_s + tr.spread_s)})` : ""}: here at about ${hm(tr.planned + tr.told_s)}.`, "train");
      }
      if (!tr.exact && this.t >= tr.arrive - EXACT_S) {
        tr.exact = true;
        const late = tr.arrive - tr.planned;
        this.log(`${hms(this.t)} ${tr.id} has passed the last station: here at ${hms(tr.arrive)}, ${mins(late)} min late, not ${mins(tr.told_s)}.`, "train");
        if (Math.abs(late - tr.told_s) >= 60) this.irregular("forecast-off", `off:${tr.id}`, { train: tr.id, min: mins(late), told: mins(tr.told_s) });
        tr.told_s = late;
        tr.spread_s = 0;
      }
      if (this.t >= tr.arrive) {
        tr.state = "waiting";
        tr.exact = true;
        this.log(`${hms(this.t)} ${tr.id} from ${tr.from} is in: ${this._load(tr)}.`, "train");
      }
    }
  }

  /** The outbound trains: asked about before their cut-off, pulled out when their wagons are in or their wait is over. */
  _departures() {
    for (const o of this.outbound.filter((x) => x.pulled_t == null)) {
      if (!o.asked && this.t >= o.pull - HOLD_ASK_S) this._askHold(o);
      if (this.t < o.pull) continue;
      const until = o.pull + (o.hold_min ?? 0) * 60;
      if (!this.missing(o).length || this.t >= until) this._pull(o);
    }
  }

  /** An outbound train is pulled out of its track: who is aboard, who is not, how late it leaves. */
  _pull(o) {
    const sim = this.sim, leaf = sim.yard.trackSegment(o.track);
    // cuts wholly in the track and still rolling to the wagons there are stopped where they are: they leave with the train
    for (const b of sim.bodies) {
      if (b.v > 0 && b.route[b.route.length - 1] === leaf.id && b.s - b.body.length_m >= leaf.track.s0 - 1e-6) Object.assign(b, { v: 0, a: 0, state: "stopped" }).rec.stop = { t: sim.t, s: b.s, track: o.track };
    }
    const out = sim.pullOut(o.track), ids = new Set(out.wagons.map((w) => w.id));
    if (this.withdraw(`hold-${o.id}`)) this.about.delete(`hold-${o.id}`);
    o.pulled_t = this.t;
    // (a booked wagon that left with another train, in a wrong track, was counted then)
    const booked = this.booked(o), p = PEOPLE, miss = booked.filter((w) => w.made == null && !ids.has(w.id));
    for (const w of booked) if (w.made == null) w.made = ids.has(w.id);
    // (whatever left with the train stands nowhere any more: also a cut that stood across the track's entrance)
    for (const id of out.cuts) {
      this.wrong.delete(id);
      if (this.withdraw(`wrong-${id}`)) this.about.delete(`wrong-${id}`);
      this.jobs = this.jobs.filter((j) => j.cut !== id);
    }
    const wrongCuts = out.cuts.map((id) => sim.cuts.find((c) => c.id === id)).filter((c) => c && c.intended !== o.track);
    for (const c of wrongCuts) {
      for (const w of c.wagons) {
        const x = this.wagons.get(w.id);
        if (x?.out && x.made == null) this._mood("customers", x.priority ? MOOD.priority : MOOD.missed);
        if (x && x.made == null) x.made = false;
      }
    }
    o.wrong = wrongCuts.length;
    o.made = booked.filter((w) => w.made).length;
    o.missed = booked.length - o.made;
    const held = Math.max(0, this.t - o.pull) / 60, late = held + o.wrong * WRONG_MIN;
    if (late > HOLD.slot_min + 1e-9) {
      o.lost = true;
      o.late_min = pick([[NEXT_PATH.min[0], NEXT_PATH.near], [NEXT_PATH.min[1], 1 - NEXT_PATH.near]], this.rng("path", o.id).next());
    } else o.late_min = Math.round(late * 10) / 10;
    this.log(`${hms(this.t)} The ${hm(o.pull)} to ${o.to} is pulled out of track ${o.track} with ${o.made} of ${booked.length} booked wagons${o.wrong ? ` and ${plural(o.wrong, "wrong cut")} to shunt out` : ""}: it leaves ${o.lost ? `without its path, ${o.late_min} min late` : o.late_min >= 0.5 ? `${mins(o.late_min * 60)} min late` : "on time"}.`, "train");
    this.give("train-report", { train: o.id, to: o.to, wagons: out.wagons.length - wrongCuts.reduce((n, c) => n + c.wagons.length, 0), late_min: o.late_min, path_lost: o.lost });
    // the production dispatcher counts the minutes, the customer service agent the wagons
    if (o.lost) {
      this._mood("production", MOOD.lost);
      this.irregular("path-lost", `path:${o.id}`, { train: `${hm(o.pull)} to ${o.to}`, min: String(o.late_min), who: p.production.name });
    } else if (o.late_min >= 0.5) this._mood("production", MOOD.late_min * o.late_min);
    else this._mood("production", MOOD.on_time);
    if (miss.length) {
      this._mood("customers", miss.reduce((s, w) => s + (w.priority ? MOOD.priority : MOOD.missed), 0));
      this.give("delay-notice", { train: o.id, wagons_left_behind: miss.length, priority: miss.filter((w) => w.priority).length });
      this.irregular("missed", `missed:${o.id}`, { train: `${hm(o.pull)} to ${o.to}`, wagons: plural(miss.length, "wagon"), who: p.customers.name });
    } else this._mood("customers", MOOD.complete);
    // promises: to the production dispatcher (no train waits longer), to the customer service agent (this train with all its wagons)
    for (const pr of this.promises.filter((x) => x.kept == null)) {
      if (pr.who === "production" && late > pr.max_min + 1e-9) this._broken(pr, `the ${hm(o.pull)} left ${o.lost ? `${o.late_min} min late, without its path` : `${mins(late * 60)} min late`}`);
      else if (pr.who === "customers" && pr.train === o.id) {
        if (o.missed) this._broken(pr, `${plural(o.missed, "wagon")} stayed behind`);
        else {
          pr.kept = true;
          this._mood("customers", MOOD.complete);
          this.log(`${hms(this.t)} The ${hm(o.pull)} has all its wagons: the promise to ${p.customers.name} is kept.`, "request");
        }
      }
    }
    if (!this.outbound.some((x) => x.pulled_t == null)) for (const pr of this.promises.filter((x) => x.who === "production" && x.kept == null)) pr.kept = true;
    for (const who of ["production", "customers"]) this._patience(who);
  }

  tick(dt) {
    const sim = this.sim;
    this._arrivals();
    this._work();
    while (sim.t < this.t - 1e-9) sim.step();
    this._read();
    this._departures();
    // a question about a cut that is fetched or gone is taken back
    for (const d of this.open.filter((x) => x.id.startsWith("wrong-"))) {
      if (!this.wrong.has(d.id.slice(6))) {
        this.withdraw(d.id);
        this.about.delete(d.id);
      }
    }
    if (this.t >= this.length) this.end(`${hm(this.length)}: the shift is over.`);
    else if (this.outbound.every((o) => o.pulled_t != null) && this.inbound.every((x) => x.state === "done") && !sim.bodies.some((b) => b.v > 0) && !this.open.length && !this.jobs.length && !this.waiting.length && !this.loco.job) this.end(`${hms(this.t)} Every train is broken up and every outbound train has gone.`);
  }

  /* ---------------------------------------------------------------- the account */

  /** The shift in numbers: the booked wagons and their trains, the outbound trains' minutes, damage and wrong tracks, the three people. */
  account() {
    const all = [...this.wagons.values()], booked = all.filter((w) => w.out), weight = (w) => (w.priority ? 2 : 1);
    // (a wagon whose train has not gone by the end of the shift counts as it stands)
    const made = (w) => w.made ?? false, done = booked.filter((w) => w.made != null || this.over);
    const moods = Object.fromEntries(Object.keys(PEOPLE).map((k) => [k, this.mood(k)]));
    const gone = this.outbound.filter((o) => o.pulled_t != null);
    const sim = this.sim.results();
    return {
      booked: booked.length, decided: done.length, made: booked.filter(made).length, missed: done.filter((w) => !made(w)).length,
      weight: done.reduce((s, w) => s + weight(w), 0), weight_made: done.filter(made).reduce((s, w) => s + weight(w), 0),
      priority: booked.filter((w) => w.priority).length, priority_made: booked.filter((w) => w.priority && made(w)).length,
      trains: this.outbound.length, gone: gone.length, on_time: gone.filter((o) => o.late_min < 0.5).length, late_min: Math.round(gone.reduce((s, o) => s + o.late_min, 0) * 10) / 10, lost: gone.filter((o) => o.lost).length,
      hard: this.hard.length, careful: this.hard.filter((h) => h.careful).length, damaged: all.filter((w) => w.damaged).length,
      // (left in a wrong track: those that stand in one, and those that were shunted out of a train; stopped before their own track is another matter)
      misrouted: sim.misrouted, wrong: [...this.wrong.values()].filter((w) => w.track).length + gone.reduce((n, o) => n + o.wrong, 0), short: [...this.wrong.values()].filter((w) => !w.track).length, cuts: sim.cuts, humped: this.inbound.filter((x) => x.state === "done").length,
      moods, lowest: Math.min(...Object.values(moods)), promises: this.promises.length, broken: this.promises.filter((p) => p.kept === false).length,
    };
  }

  finish() {
    const a = this.account();
    // a promise to the customer service agent whose train never left
    this.give("performance-report", {
      scope: "Hump yard Neustadt West", kind: "yard", wagons_booked: a.booked, wagons_on_their_trains: a.made, trains_out: a.gone, trains_on_time: a.on_time, late_min: a.late_min,
      paths_lost: a.lost, impacts_too_hard: a.hard, misrouted: a.misrouted, patience: a.moods, promises_broken: a.broken, violations: this.violations.length, score: this.score().total,
    });
  }

  objectives() {
    const a = this.account(), m = Object.values(a.moods), mean = m.reduce((s, v) => s + v, 0) / m.length;
    // an outbound train: on time, or so much of it left as it leaves late (a path lost: nothing)
    const punctual = this.outbound.reduce((s, o) => s + (o.pulled_t == null ? (this.over ? 0 : 1) : o.lost ? LOST : Math.max(0, 1 - o.late_min / LATE_NONE_MIN)), 0) / this.outbound.length;
    const sev = this.violations.reduce((s, v) => s + (v.severity >= 3 ? 1 : v.severity === 2 ? 0.4 : 0.15), 0);
    const names = Object.entries(PEOPLE).map(([k, p]) => `${p.label} ${a.moods[k]}`).join(", ");
    return [
      // (a yard that leaves four in ten booked wagons behind does not work: worth nothing)
      { id: "wagons", label: "Wagons on their trains", weight: 30, value: a.weight ? (a.weight_made / a.weight - WAGONS_NONE) / (1 - WAGONS_NONE) : 1, note: a.decided ? `${a.made} of ${a.decided} booked wagons left with their train${a.priority ? ` (${a.priority_made} of ${a.priority} priority wagons)` : ""}` : "no train has gone yet" },
      { id: "departures", label: "Trains out on time", weight: 30, value: punctual, note: a.gone ? `${a.on_time} of ${a.gone} on time, ${a.late_min} min late in all${a.lost ? `, ${plural(a.lost, "path")} lost` : ""}` : "no train has gone yet" },
      { id: "damage", label: "Without damage or complaint", weight: 15, value: 1 - 0.18 * (a.hard - a.careful) - 0.1 * a.wrong - sev, note: `${plural(a.hard, "impact")} too hard, ${plural(a.misrouted, "cut")} into a wrong track (${a.wrong} left there)${a.short ? `, ${plural(a.short, "cut")} stopped short of ${a.short === 1 ? "its" : "their"} track` : ""}, ${plural(a.broken, "promise")} not kept` },
      // the one who is worst off counts most: a shift that is good for two of three is not good enough
      { id: "people", label: "The people you work with", weight: 25, value: (0.6 * a.lowest + 0.4 * mean) / 100, note: `patience of 100: ${names}` },
    ];
  }

  /* ---------------------------------------------------------------- for a page */

  /** What the locomotive does, in words. */
  _locoText() {
    const L = this.loco, j = L.job;
    if (this.inspection != null) return `the hump is stopped until ${hms(this.inspection)}`;
    if (j) return `${j.kind === "close" ? `closes up track ${j.track}` : j.kind === "round" ? `takes a wagon round to track ${j.track}` : "fetches a cut"} until ${hms(L.until)}`;
    if (L.state === "push") return this.sim.pushing?.blocked ? `${L.train} is blocked on the hump` : this.v ? `pushes ${L.train} at ${speed(this.v)} m/s` : `${L.train} stands on the hump`;
    if (L.state === "back") return this.t < FIRST_S ? "stands ready at the arrival tracks" : `runs back to the arrival tracks until ${hms(L.until)}`;
    return this.jobs.length ? "waits for a track to be quiet" : this.inbound.some((x) => x.state === "waiting") ? "couples to the next train" : "waits for the next train";
  }

  view() {
    const a = this.account(), tone = (v) => (v < MOOD.act ? "bad" : v < MOOD.call ? "warn" : "ok");
    const held = this.outbound.filter((o) => o.pulled_t == null);
    const state = (tr) => (tr.state === "done" ? `humped ${hm(tr.humped_t)}` : tr.state === "hump" ? "on the hump" : tr.state === "waiting" ? "in the arrival tracks" : `announced ${hm(tr.planned + tr.told_s)}${tr.spread_s ? ` (±${mins(tr.spread_s)} min)` : ""}`);
    const out = (o) => (o.pulled_t != null ? (o.lost ? `path lost: ${o.late_min} min late` : o.late_min >= 0.5 ? `left ${mins(o.late_min * 60)} min late` : "left on time") : o.hold_min ? `waits until ${hms(o.pull + o.hold_min * 60)} at the latest` : this.t >= o.pull - HOLD_ASK_S ? "at its cut-off" : "forming");
    return {
      sketch: this._sketch(),
      figures: [
        { label: "Wagons on their trains", value: `${a.made} of ${a.decided || a.booked}`, tone: a.missed ? (a.missed > 3 ? "bad" : "warn") : "ok" },
        { label: "Pushing", value: this.loco.state === "push" ? speed(this.v) : "–", unit: "m/s", asset: "hump", tone: this.v > PUSH.limit ? "warn" : "ok" },
        ...Object.entries(PEOPLE).map(([k, p]) => ({ label: p.label, value: a.moods[k], tone: tone(a.moods[k]) })),
      ],
      tables: [
        {
          id: "outbound", title: "Outbound trains", window: true, columns: ["Cut-off", "To", "Track", "Wagons in", "Now"],
          rows: this.outbound.map((o) => [hm(o.pull), o.to, o.track, o.pulled_t != null ? `${o.made} of ${o.made + o.missed}` : `${this.booked(o).length - this.missing(o).length} of ${this.booked(o).length}`, out(o)]),
        },
        {
          id: "inbound", title: "Inbound trains", columns: ["Train", "From", "Wagons", "Booked on", "Now"],
          rows: this.inbound.map((tr) => [tr.id, tr.from, tr.wagons.length, this.outbound.map((o) => [o, tr.wagons.filter((w) => w.track === o.track).length]).filter(([, n]) => n).map(([o, n]) => `${hm(o.pull)}: ${n}`).join(", ") || "–", state(tr)]),
        },
        {
          id: "people", title: "The people you work with", columns: ["Who", "Counts", "Patience", "Promised"],
          rows: Object.entries(PEOPLE).map(([k, p]) => [`${p.name}, ${p.role}`, k === "hump" ? "impacts, speed" : k === "production" ? "minutes late" : "wagons left behind", `${a.moods[k]} of 100`, this.promises.filter((x) => x.who === k).map((x) => `${x.what}: ${x.kept == null ? "open" : x.kept ? "kept" : "not kept"}`).join("; ") || "–"]),
        },
      ],
      actions: [
        {
          name: "push", label: "Set the pushing speed", primary: true, hint: `The train on the hump is pushed at this speed from now on (0: it stops). Above ${speed(PUSH.limit)} m/s a switch may not get between two cuts.`,
          disabled: this.loco.state === "push" ? undefined : "No train is on the hump.",
          fields: [{ id: "v", label: "Speed", type: "number", min: 0, max: this.cap, step: PUSH.step, value: this.v || PUSH.rule, unit: "m/s" }],
        },
        ...(held.length ? [{
          name: "hold", label: "Hold an outbound train", hint: `It is pulled out when its booked wagons stand in its track, at the latest so many minutes after its cut-off. Its path waits ${HOLD.slot_min} min.`,
          fields: [
            { id: "train", label: "Train", options: held.map((o) => ({ id: o.id, label: `${hm(o.pull)} to ${o.to}` })) },
            { id: "minutes", label: "At most", type: "number", min: 0, max: HOLD.max_min, step: HOLD.step_min, value: 0, unit: "min" },
          ],
        }] : []),
        {
          name: "close", label: "Close up a track", hint: `The locomotive pushes a track's wagons together (${mins(LOCO.close_s)} min): room at its entrance, and a cut that stopped before it is brought in. The hump waits meanwhile.`,
          fields: [{ id: "track", label: "Track", options: this.sim.yard.tracks.map((t) => ({ id: t.name, label: `Track ${t.name}` })) }],
        },
      ],
    };
  }

  /** What is known of a track, in words. */
  _aboutTrack(name) {
    const o = this.outbound.find((x) => x.track === name), c = this.sim.trackContents(name);
    const parts = [o ? `the ${hm(o.pull)} to ${o.to}` : SIDINGS[name], `${plural(c.wagons, "wagon")}, ${Math.round(c.free_m)} m free at its entrance`];
    if (c.gaps_m > 1) parts.push(`${Math.round(c.gaps_m)} m of gaps`);
    if (o) parts.push(o.pulled_t != null ? (o.lost ? `gone, its path lost: ${o.late_min} min late` : o.late_min >= 0.5 ? `gone ${mins(o.late_min * 60)} min late` : "gone on time") : `${this.booked(o).length - this.missing(o).length} of ${this.booked(o).length} booked wagons in${o.hold_min ? `; waits until ${hms(o.pull + o.hold_min * 60)} at the latest` : ""}`);
    return `Track ${name}: ${parts.join("; ")}`;
  }

  /**
   * The yard as a sketch for a page that does not know the game: on the left the trains in the
   * arrival tracks and the one on the hump, its wagons from the crest back, each in the colour of
   * how well it rolls; on the right the six classification tracks with the wagons standing and
   * rolling in them, and at each track's end its outbound train with its cut-off and how many of
   * its booked wagons are in. The hump, a track, a waiting train and a cut in the wrong track can
   * be chosen: their moves are the speed, a wait, the locomotive's jobs.
   */
  _sketch() {
    const sim = this.sim, yard = sim.yard, W = 640, items = [], row = 26, top = 30;
    // (a wagon's colour: how it rolls, as its band on the table; grey between good and bad)
    const cls = { good: "ok", medium: "plain", bad: "warn" };
    const asked = new Set([...this.about.entries()].filter(([id]) => this.open.some((d) => d.id === id)).flatMap(([, ids]) => ids));
    // the arrival tracks and the hump: x 8 … 250; the crest at 250
    const crestX = 222, tracksX = 300, endX = 530;
    items.push({ kind: "text", x: 8, y: 14, small: true, tone: "muted", text: `Arrival tracks · ${hms(this.t)}` });
    items.push({ kind: "text", x: tracksX, y: 14, small: true, tone: "muted", text: "Classification tracks" });
    items.push({ kind: "text", x: endX + 8, y: 14, small: true, tone: "muted", text: "Cut-off · in" });
    const waiting = this.inbound.filter((x) => x.state === "waiting" || x.state === "coming");
    waiting.forEach((tr, i) => {
      const y = top + 8 + i * row, coming = tr.state === "coming";
      items.push({
        id: `train-${tr.id}`, kind: "tag", x: 8, y, anchor: "start", text: tr.id, tone: coming ? "idle" : this.nextUp === tr.id ? "ok" : undefined,
        alert: asked.has(`train-${tr.id}`) ? "warn" : undefined,
        title: `${tr.id} from ${tr.from}: ${this._load(tr)}; ${coming ? `announced for ${hm(tr.planned + tr.told_s)}${tr.spread_s ? `, give or take ${mins(tr.spread_s)} min` : ""}` : "in the arrival tracks"}`,
        menu: coming || this.nextUp === tr.id ? undefined : [{ label: "Over the hump next", name: "hump", args: [tr.id] }],
      });
      if (coming) items.push({ kind: "text", x: 70, y: y + 4, small: true, tone: "muted", text: `${hm(tr.planned + tr.told_s)}${tr.spread_s ? ` ±${mins(tr.spread_s)}` : ""}` });
      else tr.wagons.forEach((w, k) => items.push({ kind: "box", x: 70 + k * 9, y: y - 9, w: 7, h: 11, tone: w.noHump ? "closed" : cls[classOf(w)] }));
    });
    // the hump: the push track rising to the crest, the ramp falling; the train on it, a metre a pixel
    const hy = top + 5 * row + 6, rise = (x) => hy + (12 * (crestX - x)) / (crestX - 30);
    items.push({ kind: "line", x1: 30, y1: hy + 12, x2: crestX, y2: hy, tone: "free" }, { kind: "line", x1: crestX, y1: hy, x2: crestX + 30, y2: hy + 12, tone: "free" });
    const P = sim.pushing;
    for (const c of P?.cuts ?? []) {
      let front = c.s;
      for (const w of c.wagons) {
        const x2 = crestX - (yard.crest_m - front), x1 = x2 - w.length_m + 1.5;
        if (x1 > 28) items.push({ kind: "box", x: x1, y: rise((x1 + x2) / 2) - 14, w: x2 - x1, h: 10, tone: cls[this.wagons.get(w.id)?.cls ?? "medium"] });
        front -= w.length_m;
      }
    }
    const pushing = this.loco.state === "push";
    items.push({
      id: "hump", kind: "tag", x: crestX, y: hy - 30, anchor: "middle", text: pushing ? (P?.blocked ? "blocked" : this.v ? `${speed(this.v)} m/s` : "stopped") : "hump",
      tone: !pushing ? "idle" : P?.blocked || this.inspection != null ? "bad" : this.v > PUSH.limit ? "warn" : this.v ? "ok" : "warn", alert: asked.has("hump") ? "warn" : undefined,
      title: `The hump: the locomotive ${this._locoText()}${this.cap < PUSH.max ? `; ${PEOPLE.hump.name} pushes at ${speed(this.cap)} m/s at most` : ""}`,
      menu: pushing && this.inspection == null && !this.loco.job ? [
        ...(this.v > 0 && this.v + PUSH.tap <= this.cap + 1e-9 ? [{ label: `Faster: ${speed(this.v + PUSH.tap)} m/s`, name: "push", args: [Math.round((this.v + PUSH.tap) * 10) / 10] }] : []),
        ...(this.v - PUSH.tap >= PUSH.min - 1e-9 ? [{ label: `Slower: ${speed(this.v - PUSH.tap)} m/s`, name: "push", args: [Math.round((this.v - PUSH.tap) * 10) / 10] }] : []),
        this.v > 0 ? { label: "Stop the train", name: "push", args: [0] } : { label: `Push on at ${speed(Math.min(this.cap, this.loco.resume || PUSH.rule))} m/s`, name: "push", args: [Math.min(this.cap, this.loco.resume || PUSH.rule)] },
      ] : undefined,
    });
    items.push({ kind: "text", x: 8, y: hy + 34, small: true, tone: "muted", text: `Locomotive: ${this._locoText()}` });
    // the classification tracks, from their entrance (left) to their end (right); a cut on its way through the switches between the crest and its track
    const len = YARD.track_m, x0 = tracksX + 14, tx = (t, s) => x0 + ((s - t.s0) / len) * (endX - x0 - 8);
    yard.tracks.forEach((t, i) => {
      const y = top + 10 + i * row, o = this.outbound.find((x) => x.track === t.name), leaf = yard.trackSegment(t.name);
      items.push({ kind: "text", x: tracksX, y: y + 11, small: true, tone: "muted", text: t.name });
      items.push({ kind: "line", x1: x0, y1: y + 7, x2: endX - 8, y2: y + 7, thin: true, tone: o?.pulled_t != null ? "muted" : "free" });
      for (const b of sim.bodies) {
        if (b.track !== t.name) continue;
        const inLeaf = b.route[b.route.length - 1] === leaf.id, wrong = b.intended !== t.name;
        let front = b.s;
        for (const w of b.wagons) {
          const x = this.wagons.get(w.id), tone = x?.damaged || wrong ? "bad" : b.v > 0 ? "train" : cls[x?.cls ?? "medium"];
          if (inLeaf && front > t.s0) {
            const x2 = tx(t, front), x1 = Math.max(x0 - 12, tx(t, front - w.length_m) + 1);
            items.push({ kind: "box", x: x1, y: y - 3, w: Math.max(2, x2 - x1), h: 10, tone });
          } else if (front > yard.crest_m) {
            // on the ramp and in the switch zone: between the crest and the track's entrance
            const f = Math.min(1, (front - yard.crest_m) / (t.s0 - yard.crest_m));
            items.push({ kind: "box", x: crestX + 4 + f * (tracksX - 14 - crestX), y: hy - 12 + f * (y - 3 - hy + 12), w: 6, h: 8, tone });
          }
          front -= w.length_m;
        }
      }
      const booked = o ? this.booked(o) : [], inn = o ? booked.length - this.missing(o).length : 0;
      const text = o ? (o.pulled_t != null ? `${hm(o.pull)} ${o.made}/${booked.length}` : `${hm(o.pull)} ${inn}/${booked.length}`) : "sidings";
      const due = o && o.pulled_t == null && this.t >= o.pull - HOLD_ASK_S;
      items.push({
        id: `track-${t.name}`, kind: "tag", x: endX, y: y + 11, anchor: "start", text,
        tone: o?.pulled_t != null ? (o.missed || o.lost ? "warn" : "idle") : due ? (inn < booked.length ? "warn" : "ok") : undefined,
        alert: asked.has(`track-${t.name}`) ? "warn" : undefined, title: this._aboutTrack(t.name),
        menu: [
          ...(o && o.pulled_t == null ? [
            ...((o.hold_min ?? 0) < HOLD.max_min ? [{ label: `Wait for its wagons: ${mins(Math.min(HOLD.max_min, (o.hold_min ?? 0) + 1) * 60)} min at most`, name: "hold", args: [o.id, Math.min(HOLD.max_min, (o.hold_min ?? 0) + 1)] }] : []),
            ...(o.hold_min ? [{ label: "No wait: out at its cut-off", name: "hold", args: [o.id, 0] }] : []),
          ] : []),
          { label: "Close up this track", name: "close", args: [t.name], disabled: this.jobs.some((j) => j.kind === "close" && j.track === t.name) || (!sim.trackContents(t.name).cuts.length && !this._short(t.name).length) },
        ],
      });
    });
    // cuts in a wrong track: a tag of their own, with the locomotive's fetch
    let k = 0;
    for (const [id, wr] of this.wrong) {
      const c = sim.bodies.find((b) => b.id === id);
      if (!c) continue;
      const i = wr.track ? yard.tracks.findIndex((t) => t.name === wr.track) : yard.tracks.findIndex((t) => t.name === c.track);
      const queued = this.jobs.concat(this.loco.job ?? []).some((j) => j.cut === id);
      items.push({
        id: `cut-${id}`, kind: "tag", x: tracksX - 8 - (k++ % 2) * 30, y: top + 8 + Math.max(0, i) * row, anchor: "end", text: `→${c.intended}`, tone: queued ? "warn" : "bad",
        alert: asked.has(`cut-${id}`) ? "bad" : undefined, title: `The ${this._cutName(c)} stands ${wr.track ? `in track ${wr.track}` : "before its track"}${queued ? ": the locomotive is to fetch it" : ""}`,
        menu: queued || !wr.track ? (wr.track ? undefined : [{ label: `Close up track ${c.track}`, name: "close", args: [c.track] }]) : [{ label: "Fetch it before the next train", name: "fetch", args: [id, true] }, { label: "Fetch it when no train waits", name: "fetch", args: [id, false] }],
      });
    }
    return {
      title: "The yard", width: W, height: top + 6 * row + 46,
      label: "The hump yard Neustadt West: on the left the trains in the arrival tracks and the train on the hump, each wagon coloured by how well it rolls; on the right the six classification tracks with their wagons, and for each its outbound train with its cut-off and how many of its booked wagons are in",
      items,
    };
  }
}
