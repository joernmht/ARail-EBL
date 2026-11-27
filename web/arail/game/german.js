/**
 * German mode: the load on the infrastructure rises until nothing moves any more. An endless game, as
 * the one a browser shows without a network: there is no way to win, only a score to beat. It is told
 * of two places:
 *
 * - **the signal box** (GermanSignallerGame): Bf Neustadt with the signaller's interlocking as it is
 *   (signaller.js: routes, points, signals, trains that brake), with a timetable that never ends: trains
 *   from both sides, each with its planned track and its time, closer and closer together. Each needs a
 *   route in and a route out; another track than the planned one costs points, so does every minute late. A train that
 *   finds its line occupied waits behind it. With more than QUEUE_MAX trains waiting on one line the
 *   game is over.
 * - **the container terminal** (GermanTerminalGame): trains bring containers, a truck comes for each
 *   of them some minutes later, and one crane does every move. The yard is small: a container a truck
 *   asks for may lie under others. With more than TRAIN_QUEUE_MAX trains before the terminal, more
 *   than TRUCK_QUEUE_MAX trucks at the gate, or a yard in which no move is left, the game is over.
 *
 * Both are deterministic: the seed decides what comes and when, the player's moves the rest. They are
 * not seated in missions (games.js): no role, no flows, no score out of 100, only points. The load stops rising
 * where playing well still keeps up (GAP_MIN_S, TRAIN_GAP_MIN_S, LOAD_MAX): a game can last long.
 * @module arail/game/german
 */
import { Game, Player } from "./core.js";
import { DWELL_S, STATION, SignallerGame, Train, clockOf } from "./signaller.js";

/** The load rises in stages of this length (s). */
export const STAGE_S = 120;

/** The stage of the load at a time (1, 2, …). */
export const stageAt = (t) => 1 + Math.floor(Math.max(0, t) / STAGE_S);

/** Minutes and seconds of a game time ("7:05"). */
export const span = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/* ------------------------------------------------------------------------------------------------ the signal box */

/** The signal box: the time between two trains of one direction at stage 1 (s). */
export const GAP_S = 180;
/** What the gap is multiplied by with every stage, and what it never falls below (s). */
export const GAP_FACTOR = 0.95;
export const GAP_MIN_S = 115;
/** How far a train may come earlier or later (a share of the gap). */
export const GAP_JITTER = 0.25;

/** The game is over with more than this many trains waiting on one line before the station. */
export const QUEUE_MAX = 3;

/** Which kinds of trains come, and how often (shares of 1); a regional train stops, the others pass. */
export const MIX = [["RB", 0.55], ["IC", 0.25], ["GZ", 0.2]];

/**
 * The timetable: how far ahead it is known (s); how long after it comes onto the panel a regional train arrives at
 * its platform and departs, and an intercity or a freight train passes its exit signal (s).
 */
export const AHEAD_S = 600;
export const RUN_S_BY_KIND = { RB: { arr: 150, dep: 210 }, IC: { pass: 100 }, GZ: { pass: 180 } };

/** The points: for a train through; taken off for a track other than the planned one, and for every minute late (at most so many). */
export const POINTS = { through: 10, wrongTrack: 5, perMinute: 1, lateMax: 5 };

/** The time between two trains of a direction at a stage (s), before its jitter. */
export const gapAt = (stage) => Math.max(GAP_MIN_S, GAP_S * GAP_FACTOR ** (stage - 1));

/** The lines by their direction of travel: where a train comes from. */
const FROM = { 1: STATION.west, [-1]: STATION.east };

/**
 * The computer in the signal box, by the timetable: every train into its planned track; into another one only
 * when a train already waits behind it on the line; and out as soon as its time has come and its route can be set.
 */
export class GermanSignallerPlayer extends Player {
  /** @param {GermanSignallerGame} g */
  think(g) {
    const set = (id) => !g.blocked(id) && g.act("setRoute", id).ok;
    for (const dir of [1, -1]) {
      const sig = dir > 0 ? "A" : "F";
      // out first: a track that is free again takes the next train
      for (const tr of g.trains) {
        if (tr.dir !== dir || tr.state === "coming" || tr.state === "gone") continue;
        const next = g.nextSignal(tr);
        if (!next || next === sig || g.routeFrom(next)) continue;
        if (tr.stops && (tr.state !== "dwelling" || tr.dwell < DWELL_S - 15 || g.t < tr.dep - 15)) continue;
        set(`${next}-${dir > 0 ? "T" : "B"}`);
      }
      if (g.routeFrom(sig)) continue;
      const first = g.trains.filter((tr) => tr.dir === dir && (tr.state === "coming" ? g.t >= tr.enterAt - 30 : g.nextSignal(tr) === sig)).sort((a, b) => a.enterAt - b.enterAt)[0];
      if (!first || set(`${sig}-${first.plan}`)) continue;
      // the planned track is not free: another one costs points, a line that fills up costs the game
      if (g.waiting(dir).length >= 1) for (const track of dir > 0 ? ["G1", "G2", "G3"] : ["G3", "G2"]) if (track !== first.plan && set(`${sig}-${track}`)) break;
    }
  }
}

/**
 * The signal box in German mode: the signaller's interlocking and trains, with a timetable that never ends and
 * gets denser. Nothing fails and nothing is asked. A train through gives points (POINTS); a track other than
 * the planned one and every minute late take some off.
 */
export class GermanSignallerGame extends SignallerGame {
  static id = "german-signaller";
  static title = "German mode: the signal box";
  static role = "";
  static kind = "simulation";
  static description = "Bf Neustadt with a timetable that gets denser and denser: give each train a route into its planned track and a route out, until the lines are full.";
  static takes = [];
  static gives = [];
  static actions = { setRoute: { label: "Set a route" }, cancelRoute: { label: "Cancel a route" } };
  static player = GermanSignallerPlayer;
  static irregularities = [];
  /** How fast its page plays it: simulated seconds in one second. */
  static pace = 6;

  /** @param {{seed?: number}} [options] */
  constructor(options = {}) {
    super({ seed: options.seed, level: "training" });
    // its own timetable: the trains are made as it goes on, some minutes ahead
    this.trains = [];
    this.logs = [];
    this.failure = null;
    /** How many trains have come, by kind (their numbers), and how many got through. */
    this.made = { RB: 0, IC: 0, GZ: 0 };
    /** How many trains of each direction the timetable has so far. */
    this.count = { 1: 0, [-1]: 0 };
    this.through = 0;
    /** The points, the trains that ran on another track than planned, and the minutes late that cost points. */
    this.earned = 0;
    this.wrong = 0;
    this.lateMin = 0;
    /** When the next train of each direction comes (s). */
    this.nextAt = { 1: 10, [-1]: 70 };
    /** The most trains that waited on one line so far. */
    this.worst = 0;
    this._traffic();
    this.log(`${clockOf(0)} German mode: every train needs a route in and a route out. With more than ${QUEUE_MAX} trains waiting on one line, it is over.`, "info");
  }

  /** The stage of the load now. */
  get stage() {
    return stageAt(this.t);
  }

  /** The trains that wait on the line from a side for the one before them to clear it: their ids, the first to come first. */
  waiting(dir) {
    return this.trains.filter((tr) => tr.dir === dir && tr.state === "coming" && this.t >= tr.enterAt).sort((a, b) => a.enterAt - b.enterAt).map((tr) => tr.id);
  }

  tick(dt) {
    const n = Math.max(1, Math.ceil(dt / 0.5)), h = dt / n;
    const t0 = this.t - dt;
    for (let i = 1; i <= n; i++) {
      this._step(t0 + i * h, h);
      this._traffic();
    }
    // trains that have left count, and are forgotten
    const gone = this.trains.filter((tr) => tr.state === "gone");
    for (const tr of gone) {
      const wrong = tr.track !== tr.plan, late = Math.min(POINTS.lateMax, Math.floor(Math.max(0, this._measured(tr) - tr.due) / 60));
      const points = POINTS.through - (wrong ? POINTS.wrongTrack : 0) - late * POINTS.perMinute;
      this.through += 1;
      this.earned += points;
      this.wrong += wrong ? 1 : 0;
      this.lateMin += late;
      this.emit("through", { train: tr.id, points, wrong, late, track: tr.track, plan: tr.plan });
    }
    if (gone.length) this.trains = this.trains.filter((tr) => tr.state !== "gone");
    for (const dir of [1, -1]) {
      const q = this.waiting(dir).length;
      this.worst = Math.max(this.worst, q);
      if (q > QUEUE_MAX) return this.end(`${clockOf(this.t)} Stuck: ${q} trains wait on the line from ${FROM[dir]}. ${this.earned} points: ${this.through} ${this.through === 1 ? "train" : "trains"} through in ${span(this.t)} min, ${this.wrong} on another track than planned.`);
    }
  }

  /** The timetable goes on: the trains of the next minutes (AHEAD_S), each direction by its own stream of the seed. */
  _traffic() {
    for (const dir of [1, -1]) {
      while (this.t + AHEAD_S >= this.nextAt[dir]) {
        // by the count of its own direction: the other direction's trains change nothing, whatever the step
        const at = this.nextAt[dir], r = this.rng("train", dir, this.count[dir]++);
        let x = r.next(), kind = MIX[0][0];
        for (const [k, share] of MIX) {
          kind = k;
          if ((x -= share) < 0) break;
        }
        this.made[kind] += 1;
        // odd numbers run east, even numbers west, as on the railway
        const id = `${kind} ${(kind === "RB" ? 100 : kind === "IC" ? 2000 : 50000) + 2 * this.made[kind] - (dir > 0 ? 1 : 0)}`;
        const plan = dir > 0 ? (kind === "RB" ? "G2" : "G1") : "G3";
        const run = RUN_S_BY_KIND[kind], enter = Math.round(at);
        const spec = kind === "RB" ? { id, kind, dir, enter, plan, arr: enter + run.arr, dep: enter + run.dep } : { id, kind, dir, enter, plan, pass: enter + run.pass };
        this.trains.push(new Train(spec, enter));
        this.nextAt[dir] = at + gapAt(stageAt(at)) * (1 + (r.next() * 2 - 1) * GAP_JITTER);
      }
    }
  }

  // nobody is told of a delay here
  _notice() {}

  _ran() {}

  /** The timetable from now on: the trains not yet gone, in the order they come, each with its planned track and its time. */
  timetable() {
    return [...this.trains].sort((a, b) => a.enter - b.enter).map((tr) => ({
      id: tr.id, kind: tr.kind, dir: tr.dir, from: FROM[tr.dir], plan: tr.plan, track: tr.track, enter: tr.enter, due: tr.due, stops: tr.stops, state: tr.state,
      waiting: tr.state === "coming" && this.t >= tr.enterAt, late: tr.state === "coming" && this.t < tr.enterAt ? 0 : Math.max(0, Math.floor((this._measured(tr) - tr.due) / 60)),
    }));
  }

  /** How far it got: the points, the trains through, the time, the stage. */
  result() {
    return { game: this.constructor.id, seed: this.seed, t: this.t, points: this.earned, through: this.through, wrong: this.wrong, lateMin: this.lateMin, stage: this.stage, worst: this.worst, reason: this.over };
  }

  /** The panel's state (SignallerGame.state), and German mode's own: the trains through, the stage, who waits where. */
  state() {
    return { ...super.state(), score: this.earned, through: this.through, wrong: this.wrong, lateMin: this.lateMin, timetable: this.timetable(), stage: this.stage, limit: QUEUE_MAX, gap: Math.round(gapAt(this.stage)), waiting: { west: this.waiting(1), east: this.waiting(-1) } };
  }
}

/* ------------------------------------------------------------------------------------------------ the container terminal */

/** The yard: stacks side by side under the crane, each so many containers high. */
export const STACKS = 6;
export const TIERS = 3;
/** The wagons of a train. */
export const WAGONS = 4;

/** Where things stand along the crane's runway (positions): the wagons, the stacks, the truck lane. */
export const AT = {
  wagon: (i) => i,
  stack: (i) => WAGONS + 0.5 + i,
  truck: WAGONS + STACKS + 1,
};

/** The crane: lifting or setting down a container (s), and running one position with or without it (s). */
export const HOIST_S = 6;
export const RUN_S = 2;

/** At most this many moves wait for the crane. */
export const JOBS_MAX = 4;

/** The traffic: the time between two trains at stage 1 (s), what it is multiplied by with every stage, and what it never falls below (s). */
export const TRAIN_GAP_S = 260;
export const TRAIN_GAP_FACTOR = 0.96;
export const TRAIN_GAP_MIN_S = 165;
/** A train's containers: two at stage 1, one more every so many stages, at most so many. */
export const MORE_EVERY = 8;
export const LOAD_MAX = 3;
/** How long after its train a container's truck comes (s, between the two). */
export const PICKUP_S = [60, 360];

/** A train rolls in or out in this time (s). */
export const ROLL_S = 20;

/** The game is over with more trains waiting before the terminal, or more trucks at the gate, than these. */
export const TRAIN_QUEUE_MAX = 2;
export const TRUCK_QUEUE_MAX = 5;

/** The time between two trains at a stage (s). */
export const trainGapAt = (stage) => Math.max(TRAIN_GAP_MIN_S, TRAIN_GAP_S * TRAIN_GAP_FACTOR ** (stage - 1));

/** How many containers a train brings at a stage. */
export const loadAt = (stage) => Math.min(LOAD_MAX, 2 + Math.floor((stage - 1) / MORE_EVERY));

/** Where a place is along the runway: "W2" (a wagon), "S3" (a stack), "T" (the truck lane); null for no place. */
export function placeAt(place) {
  const m = /^([WS])(\d+)$/.exec(String(place));
  if (place === "T") return AT.truck;
  if (!m) return null;
  const i = Number(m[2]) - 1;
  if (m[1] === "W") return i >= 0 && i < WAGONS ? AT.wagon(i) : null;
  return i >= 0 && i < STACKS ? AT.stack(i) : null;
}

/**
 * The computer at the crane: a truck whose container can be lifted is served first; else what lies on a
 * container a truck waits for is put aside; else the train is unloaded, onto the lowest stack.
 */
export class GermanTerminalPlayer extends Player {
  /** @param {GermanTerminalGame} g */
  think(g) {
    if (g.jobs.length >= 2) return;
    const wanted = new Set(g.trucks.filter((k) => !k.served).map((k) => k.wants));
    const where = (id) => g.find(id);
    // the stack to put a container on: the lowest, and not one that buries what a truck waits for
    const aside = (not) => {
      const ranked = g.plan.stacks.map((s, i) => ({ i, n: s.length, buries: s.some((id) => wanted.has(id)) })).filter((s) => s.i !== not && s.n < TIERS).sort((a, b) => a.buries - b.buries || a.n - b.n || a.i - b.i);
      return ranked.length ? `S${ranked[0].i + 1}` : null;
    };
    for (const id of wanted) {
      const at = where(id);
      if (at && g.top(at) === id && g.act("move", at, "T").ok) return;
    }
    for (const id of wanted) {
      const at = where(id);
      if (!at?.startsWith("S")) continue;
      const to = aside(Number(at.slice(1)) - 1);
      if (to && g.act("move", at, to).ok) return;
    }
    for (let i = 0; i < WAGONS; i++) {
      if (!g.plan.wagons[i]) continue;
      const to = aside(-1);
      if (to && g.act("move", `W${i + 1}`, to).ok) return;
    }
  }
}

/**
 * The container terminal in German mode: trains bring containers, a truck comes for each, one crane moves
 * them all. The player gives the crane its moves (`move`: from a wagon or the top of a stack, to a stack or
 * to the truck that waits for that container); the crane does them one after the other.
 *
 * The yard is kept twice: as it is (`real`), and as it will be when every move given is done (`plan`). A
 * move is checked against the plan, so several can be given ahead.
 */
export class GermanTerminalGame extends Game {
  static id = "german-terminal";
  static title = "German mode: the container terminal";
  static kind = "simulation";
  static description = "Trains bring containers, a truck comes for each of them, and one crane does every move. More trains, fuller trains, until the yard is full.";
  static scale = "seconds";
  static actions = { move: { label: "Move a container" } };
  static player = GermanTerminalPlayer;
  /** How fast its page plays it: simulated seconds in one second. */
  static pace = 6;

  /** @param {{seed?: number}} [options] */
  constructor(options = {}) {
    super({ seed: options.seed });
    const empty = () => ({ stacks: Array.from({ length: STACKS }, () => []), wagons: Array(WAGONS).fill(null) });
    /** Where the containers are, and where they will be once the moves given are done: stacks from the ground up, wagons. */
    this.real = empty();
    this.plan = empty();
    /** The train at the loading track ({id, state: "in" | "here" | "out", at: since when}), or null; how many wait before the terminal. */
    this.train = null;
    this.queue = [];
    this.trainsMade = 0;
    this.nextTrain = 5;
    /** The containers made, and the trucks to come: {t, wants}, in the order of their time. */
    this.boxes = 0;
    this.due = [];
    /** The trucks at the gate: {id, wants, since, served: a move to them is given}. */
    this.trucks = [];
    this.trucksMade = 0;
    /** The crane: where it is (a position), what it carries, and its moves: the first is being done. */
    this.crane = { x: AT.stack(0), carries: null };
    /** @type {Array<{id: string, from: string, to: string, phase: number, t0: number, x0: number}>} */
    this.jobs = [];
    /** Containers gone by truck, trains unloaded, moves made. */
    this.out = 0;
    this.trainsDone = 0;
    this.lifts = 0;
    this.log(`German mode: unload the trains, give every truck its container. With more than ${TRAIN_QUEUE_MAX} trains or ${TRUCK_QUEUE_MAX} trucks waiting, it is over.`, "info");
  }

  get stage() {
    return stageAt(this.t);
  }

  /** The place a container is at in the plan ("W2", "S3"), or null (gone, or not here yet). */
  find(id) {
    const w = this.plan.wagons.indexOf(id);
    if (w >= 0) return `W${w + 1}`;
    const s = this.plan.stacks.findIndex((st) => st.includes(id));
    return s >= 0 ? `S${s + 1}` : null;
  }

  /** The container that can be lifted at a place in the plan (a wagon's, the top of a stack), or null. */
  top(place) {
    const i = Number(String(place).slice(1)) - 1;
    if (placeAt(place) == null || place === "T") return null;
    return place[0] === "W" ? this.train?.state === "here" ? this.plan.wagons[i] : null : this.plan.stacks[i].at(-1) ?? null;
  }

  /** Why a move cannot be given now, or null. */
  blocked(from, to) {
    if (placeAt(from) == null || from === "T") return "There is nothing to lift there.";
    if (placeAt(to) == null || to[0] === "W") return "A container goes onto a stack or to its truck.";
    if (from === to) return "It is there already.";
    const id = this.top(from);
    if (!id) return from[0] === "W" ? "No container on that wagon." : "That stack is empty.";
    if (this.jobs.length >= JOBS_MAX) return `The crane has ${JOBS_MAX} moves waiting.`;
    if (to === "T") return this.trucks.some((k) => k.wants === id && !k.served) ? null : `No truck waits for ${id}.`;
    return this.plan.stacks[Number(to.slice(1)) - 1].length >= TIERS ? `Stack ${to.slice(1)} is full.` : null;
  }

  /**
   * Give the crane a move: the container of a wagon ("W1"…) or the top one of a stack ("S1"…), onto a stack
   * or to the truck that waits for it ("T").
   * @returns {{ok: boolean, reason?: string}}
   */
  move(from, to) {
    const why = this.blocked(from, to);
    if (why) return { ok: false, reason: why };
    const id = this.top(from), i = Number(from.slice(1)) - 1;
    if (from[0] === "W") this.plan.wagons[i] = null;
    else this.plan.stacks[i].pop();
    if (to === "T") this.trucks.find((k) => k.wants === id && !k.served).served = true;
    else this.plan.stacks[Number(to.slice(1)) - 1].push(id);
    this.jobs.push({ id, from, to, phase: 0, t0: this.t, x0: this.crane.x });
    return { ok: true };
  }

  /** Whether any move could be given (with the crane free): a container a truck waits for that can be lifted, or one that can be put on another stack. */
  movable() {
    const wanted = new Set(this.trucks.filter((k) => !k.served).map((k) => k.wants));
    const room = this.plan.stacks.map((s) => s.length < TIERS);
    const wagons = this.train?.state === "here" ? this.plan.wagons.filter(Boolean) : [];
    if (wagons.some((id) => wanted.has(id)) || this.plan.stacks.some((s) => wanted.has(s.at(-1)))) return true;
    if (wagons.length && room.some(Boolean)) return true;
    return this.plan.stacks.some((s, i) => s.length > 0 && room.some((free, j) => free && j !== i));
  }

  tick(dt) {
    const n = Math.max(1, Math.ceil(dt / 0.5)), h = dt / n, t0 = this.t - dt;
    for (let i = 1; i <= n && !this.over; i++) {
      this.t = t0 + i * h;
      this._trains();
      this._trucks();
      this._crane();
      this._stuck();
    }
    this.t = t0 + dt;
  }

  /** Trains come, roll in when the track is free, and leave when they are empty. */
  _trains() {
    while (this.t >= this.nextTrain) {
      const at = this.nextTrain, stage = stageAt(at), r = this.rng("train", this.trainsMade);
      this.trainsMade += 1;
      const boxes = Array.from({ length: loadAt(stage) }, () => {
        this.boxes += 1;
        const id = `${"ABCDEFGH"[(this.boxes - 1) % 8]}${1 + (Math.floor((this.boxes - 1) / 8) % 99)}`;
        this.due.push({ t: at + PICKUP_S[0] + r.next() * (PICKUP_S[1] - PICKUP_S[0]), wants: id });
        return id;
      });
      this.due.sort((a, b) => a.t - b.t);
      this.queue.push({ id: `KT ${40 + this.trainsMade}`, boxes });
      this.nextTrain = at + trainGapAt(stage) * (0.8 + 0.4 * r.next());
    }
    const tr = this.train;
    if (!tr && this.queue.length) {
      const next = this.queue.shift();
      this.train = { id: next.id, state: "in", at: this.t, boxes: next.boxes };
    } else if (tr?.state === "in" && this.t >= tr.at + ROLL_S) {
      tr.state = "here";
      tr.boxes.forEach((id, i) => (this.real.wagons[i] = this.plan.wagons[i] = id));
      this.log(`${span(this.t)} ${tr.id} is at the loading track with ${tr.boxes.length} containers.`, "train");
    } else if (tr?.state === "here" && this.real.wagons.every((x) => !x)) {
      tr.state = "out";
      tr.at = this.t;
      this.trainsDone += 1;
    } else if (tr?.state === "out" && this.t >= tr.at + ROLL_S) this.train = null;
  }

  /** A truck comes for its container, whether it is unloaded yet or not. */
  _trucks() {
    while (this.due.length && this.t >= this.due[0].t) {
      const d = this.due.shift();
      this.trucksMade += 1;
      this.trucks.push({ id: `L${this.trucksMade}`, wants: d.wants, since: d.t, served: false });
    }
  }

  /** The crane's move: to the container, lift it, to its place, set it down (phases 0 to 3). */
  _crane() {
    const job = this.jobs[0];
    if (!job) return;
    const a = placeAt(job.from), b = placeAt(job.to);
    const spans = [Math.abs(a - job.x0) * RUN_S, HOIST_S, Math.abs(b - a) * RUN_S, HOIST_S];
    let since = this.t - job.t0, phase = 0;
    while (phase < 4 && since >= spans[phase]) since -= spans[phase++];
    // what happens when a phase ends: the container leaves its place, or reaches it
    for (; job.phase < phase; job.phase++) {
      if (job.phase === 1) {
        const i = Number(job.from.slice(1)) - 1;
        if (job.from[0] === "W") this.real.wagons[i] = null;
        else this.real.stacks[i].pop();
        this.crane.carries = job.id;
      } else if (job.phase === 3) {
        this.crane.carries = null;
        this.lifts += 1;
        if (job.to === "T") {
          this.trucks = this.trucks.filter((k) => k.wants !== job.id);
          this.out += 1;
          this.emit("out", { container: job.id, out: this.out });
        } else this.real.stacks[Number(job.to.slice(1)) - 1].push(job.id);
      }
    }
    if (phase >= 4) {
      this.crane.x = b;
      this.jobs.shift();
      if (this.jobs[0]) Object.assign(this.jobs[0], { t0: this.t, x0: b });
      return;
    }
    const f = spans[phase] ? since / spans[phase] : 1;
    this.crane.x = phase === 0 ? job.x0 + (a - job.x0) * f : phase === 1 ? a : phase === 2 ? a + (b - a) * f : b;
  }

  /** Over: too many trains before the terminal, too many trucks at the gate, or no move left in the yard. */
  _stuck() {
    const sum = `${this.out} ${this.out === 1 ? "container" : "containers"} left by truck in ${span(this.t)} min.`;
    if (this.queue.length > TRAIN_QUEUE_MAX) this.end(`Stuck: ${this.queue.length} trains wait before the terminal, back onto the main line. ${sum}`);
    else if (this.trucks.length > TRUCK_QUEUE_MAX) this.end(`Stuck: ${this.trucks.length} trucks wait at the gate, back onto the road. ${sum}`);
    // no move left: only with every container a truck waits for in the yard (one still on a train to come can go straight to its truck)
    else if (!this.jobs.length && this.trucks.length && this.trucks.every((k) => k.served || this.find(k.wants)) && !this.movable()) this.end(`Stuck: the yard is full, and no container a truck waits for can be reached. ${sum}`);
  }

  result() {
    return { game: this.constructor.id, seed: this.seed, t: this.t, points: this.out, stage: this.stage, trains: this.trainsDone, lifts: this.lifts, reason: this.over };
  }

  /** Everything a page draws, as plain data. */
  state() {
    const wanted = new Map(this.trucks.map((k) => [k.wants, k.id])), moving = new Set(this.jobs.map((j) => j.id));
    const box = (id) => (id ? { id, wanted: wanted.get(id) ?? null, moving: moving.has(id) } : null);
    const job = this.jobs[0];
    return {
      t: this.t, clock: span(this.t), over: this.over, score: this.out, stage: this.stage,
      stacks: this.real.stacks.map((s) => s.map(box)),
      wagons: this.real.wagons.map(box),
      train: this.train ? { id: this.train.id, state: this.train.state, f: this.train.state === "here" ? 1 : Math.min(1, (this.t - this.train.at) / ROLL_S) } : null,
      queue: this.queue.map((q) => q.id), queueMax: TRAIN_QUEUE_MAX,
      trucks: this.trucks.map((k) => ({ ...k, here: this.find(k.wants) != null || moving.has(k.wants) })), trucksMax: TRUCK_QUEUE_MAX,
      crane: { x: this.crane.x, carries: this.crane.carries, hoisting: !!job && (job.phase === 1 || job.phase === 3) },
      jobs: this.jobs.map((j) => ({ id: j.id, from: j.from, to: j.to })), jobsMax: JOBS_MAX,
      trainsDone: this.trainsDone, gap: Math.round(trainGapAt(this.stage)), load: loadAt(this.stage),
    };
  }
}

/** The games of German mode, by the name their page calls them. */
export const GERMAN_GAMES = { signaller: GermanSignallerGame, terminal: GermanTerminalGame };
