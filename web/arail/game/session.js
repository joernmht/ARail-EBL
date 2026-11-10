/**
 * A session: several role games played together as one big game (docs/game-core.md).
 *
 * A mission (mission.js) seats roles: each seat is one role's game, played by a person or by the
 * computer. The session wires the games by their ports: a flow one game gives goes to every seated
 * game that takes it; what no seat gives comes from the mission (its conditions and injects), and
 * what nobody takes, a game plays itself. So the same games work alone and together.
 *
 * Roles decide at different rhythms, so a session runs in phases, round after round. In a **turn**
 * the slow roles (days to years) decide without a clock: the budget, the year's plan, the account.
 * In a **shift** the fast roles (seconds to hours) work at the same time on one clock, in fixed
 * ticks. State flows carry a turn's decisions into the shifts that follow (a staff plan, the
 * condition of the assets); the shifts' reports carry what happened back into the next turn. A
 * shift is a sample of its period: it shows how well the operators handle what the slow roles left
 * them with.
 *
 * Flows travel at tick boundaries, in the order they were given, and every move of a person is
 * recorded with its phase and tick. The games being deterministic, a session can be played again
 * from its seed and its record (`Session.replay`): for saving, for the debrief, and for several
 * devices that exchange only their moves.
 * @module arail/game/session
 */
import { hashKey } from "../core/math.js";
import { threads } from "./chain.js";
import { flowOf } from "./flows.js";

/** Who plays a seat. */
export const SEATS = ["human", "computer"];
/** The sender of what the mission itself gives (conditions, injects). */
export const MISSION = "mission";

const FLOW_LOG = 4000;

/**
 * Whether a flow given by a game of role `from` reaches a seat: the receiving game takes it (from
 * that role, if it names roles), the giving game gives it (to that role, if it names roles), and
 * the message is not addressed elsewhere.
 */
function reaches(msg, give, seat) {
  const take = seat.Game.takes.find((x) => x.flow === msg.flow);
  if (!take) return false;
  if (msg.from !== MISSION) {
    if (take.from && !take.from.includes(msg.from)) return false;
    if (give?.to && !give.to.includes(seat.role)) return false;
  }
  return !msg.to || msg.to.includes(seat.role) || msg.to.includes(seat.id);
}

export class Session {
  /**
   * @param {object} mission a mission as `normalizeMission` gives it
   * @param {object} options
   * @param {Map<string, Function>} options.games the game classes by their id (games.js)
   * @param {number} [options.seed] instead of the mission's
   * @param {Record<string, "human" | "computer">} [options.seats] who plays which seat, instead of the mission's
   */
  constructor(mission, { games, seed = null, seats = {} } = {}) {
    this.mission = mission;
    this.seed = seed ?? mission.seed ?? 1;
    /** @type {Map<string, {id: string, role: string, Game: Function, by: string, level: string, options: object, weight: number, game: object | null, player: object | null, live: boolean, mail: object[], held: Record<string, object>, results: object[]}>} */
    this.seats = new Map();
    /** Who sat where at the start (later changes are in the record). */
    this.seated = {};
    for (const r of mission.roles) {
      const Game = games?.get(r.game);
      if (!Game) throw new Error(`Mission ${mission.id}: there is no game "${r.game}"`);
      const by = seats[r.id] ?? r.seat ?? "computer";
      if (!SEATS.includes(by)) throw new Error(`Mission ${mission.id}: seat ${r.id} must be played by one of ${SEATS.join(", ")}`);
      this.seated[r.id] = by;
      this.seats.set(r.id, { id: r.id, role: r.role, Game, by, level: r.level ?? "normal", options: r.options ?? {}, weight: r.weight ?? 1, game: null, player: null, live: false, mail: [], held: {}, results: [] });
    }
    /** The phases of all rounds, in the order they are played. */
    this.plan = [];
    for (let round = 1; round <= mission.rounds; round++) {
      for (const p of mission.phases) if (!p.rounds || p.rounds.includes(round)) this.plan.push({ ...p, round });
    }
    /** The index of the current phase in `plan` (-1 before the start), the phase, and its seats. */
    this.index = -1;
    this.phase = null;
    this.active = [];
    /** Simulated seconds and ticks since the current phase began (a turn has no clock). */
    this.t = 0;
    this.ticks = 0;
    this._acc = 0;
    /** A shift's time is up, but a game's world has not caught up yet: it closes when it has (`_settle`). */
    this._settling = false;
    /** Flows on their way, and every flow delivered: `{n, phase, round, t, flow, from, seat, to, payload}`. */
    this.queue = [];
    this.flows = [];
    this._n = 0;
    this._injected = new Set();
    /** The moves of people, for `replay`: `{phase, tick, seat, name, args}`. */
    this.record = [];
    this.over = false;
    this._listeners = new Set();
  }

  /** Listen to the session's events: `phase`, `phase-end`, `flow`, `move`, `over`. */
  on(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  emit(name, payload = {}) {
    for (const fn of this._listeners) fn(name, payload);
  }

  get round() {
    return this.phase?.round ?? 0;
  }

  get rounds() {
    return this.mission.rounds;
  }

  /** A seat by its id. */
  seat(id) {
    return this.seats.get(id);
  }

  /** The flows of a seat's game that another seat is at the other end of. */
  wiredOf(seat) {
    const wired = new Set();
    for (const other of this.seats.values()) {
      if (other === seat) continue;
      for (const g of other.Game.gives) if (reaches({ flow: g.flow, from: other.role, to: null }, g, seat)) wired.add(g.flow);
      for (const g of seat.Game.gives) if (reaches({ flow: g.flow, from: seat.role, to: null }, g, other)) wired.add(g.flow);
    }
    return wired;
  }

  /** Begin the session with its first phase. */
  start() {
    if (this.index >= 0) return this;
    this._begin(0);
    this._auto();
    return this;
  }

  /* ---------------------------------------------------------------- phases */

  /** What a game is told of a phase: the round, how many there are, the calendar year of the round (rounds count as years from the mission's `year`), the phase. */
  _ctx() {
    return { round: this.round, rounds: this.rounds, year: (this.mission.year ?? 2027) + this.round - 1, phase: this.phase };
  }

  _begin(i) {
    this.index = i;
    this.phase = this.plan[i];
    this.t = 0;
    this.ticks = 0;
    this._acc = 0;
    const ph = this.phase;
    this.active = ph.roles.map((id) => this.seats.get(id));
    for (const seat of this.active) {
      // a shift is a new game each time; a slow role's game lives through the rounds
      if (ph.kind === "shift" || !seat.game) {
        const conditions = {};
        for (const tk of seat.Game.takes) {
          if (flowOf(tk.flow)?.kind !== "state") continue;
          const v = seat.held[tk.flow] ?? this.mission.conditions?.[tk.flow];
          if (v !== undefined) conditions[tk.flow] = structuredClone(v);
        }
        const seed = hashKey(this.seed, seat.id, ph.kind === "shift" ? ph.round : 0);
        seat.game = new seat.Game({ ...seat.options, ...(ph.options?.[seat.id] ?? {}), seed, level: seat.level, conditions, wired: this.wiredOf(seat), ...(ph.kind === "shift" ? { length: ph.length } : {}) });
        seat.game.on((name, payload) => {
          if (name === "give") this.queue.push({ ...payload, seat: seat.id });
        });
        seat.player = new (seat.Game.player)();
      }
      seat.live = true;
      for (const msg of seat.mail.splice(0)) seat.game.receive(msg);
      // a game that has ended (a slow role's game can fail for good) is asked nothing more
      if (!seat.game.over) seat.game.begin(this._ctx());
    }
    this.emit("phase", { phase: ph, index: i });
    this._injects();
    this._deliver();
    if (ph.kind === "turn") this._think();
  }

  /** The computer players of the current phase make their moves. */
  _think() {
    for (const seat of this.active) if (seat.by === "computer" && seat.game && !seat.game.over) seat.player.think(seat.game, this);
  }

  /** The mission's injects that are due in the current phase. */
  _injects() {
    this.mission.injects?.forEach((inj, k) => {
      const key = `${this.index}|${k}`;
      if (inj.phase !== this.phase.id || this._injected.has(key)) return;
      if (inj.rounds && !inj.rounds.includes(this.round)) return;
      if ((inj.at ?? 0) > this.t + 1e-9) return;
      this._injected.add(key);
      this.queue.push({ flow: inj.flow, from: MISSION, seat: MISSION, to: inj.to ?? null, t: this.t, payload: structuredClone(inj.payload ?? {}) });
    });
  }

  /**
   * Flows on their way reach the games that take them. A game at work receives them at once (a slow
   * role's game is at work from its first turn to the end, a fast role's only in its shift). For a
   * game not at work, a state is kept as what holds when it begins, an event waits as its mail.
   */
  _deliver() {
    // what a game gives on receiving is delivered the next time
    for (const msg of this.queue.splice(0)) {
      const from = this.seats.get(msg.seat);
      const give = from?.Game.gives.find((g) => g.flow === msg.flow);
      const state = flowOf(msg.flow)?.kind === "state";
      const to = [];
      for (const seat of this.seats.values()) {
        if (seat === from || !reaches(msg, give, seat)) continue;
        to.push(seat.id);
        if (state) seat.held[msg.flow] = msg.payload;
        if (seat.live) seat.game.receive(msg);
        else if (!state) seat.mail.push(msg);
      }
      const line = { n: ++this._n, phase: this.index, round: this.round, t: this.t, flow: msg.flow, from: msg.from, seat: msg.seat, to, payload: msg.payload };
      this.flows.push(line);
      if (this.flows.length > FLOW_LOG) this.flows.splice(0, FLOW_LOG / 10);
      this.emit("flow", line);
    }
  }

  /** Whether the current phase waits for a person: a shift with a person at work, a turn with a person's seat. */
  get waiting() {
    return !this.over && this.active.some((s) => s.by === "human" && s.game && !s.game.over);
  }

  /** Whether every person of a turn has decided what was asked. */
  get ready() {
    return this.active.every((s) => s.by !== "human" || !s.game || !s.game.open.length);
  }

  /** Go on while no person is needed (turns of computer players; a shift only with `shifts`). */
  _auto() {
    while (!this.over && this.phase.kind === "turn" && !this.waiting) this._close();
  }

  /**
   * Play on until a person is needed or the session is over: the turns and shifts of computer
   * players. A mission's test run plays a whole session this way.
   */
  run() {
    this.start();
    while (!this.over && !this.waiting) {
      if (this.phase.kind !== "shift") this._close();
      // a game whose world is elsewhere must be exchanged with first: that is `runWith`
      else if (this._settling ? !this._settle() : this.holding) break;
      else if (!this._settling) this._tick(this.phase.tick);
    }
    return this;
  }

  /**
   * Go on by `dt` simulated seconds in a shift, in the mission's fixed ticks (the rest is kept for
   * the next call): flows arrive, the computer players move, the games step.
   */
  step(dt) {
    if (this._settling) this._settle();
    if (this.over || this.phase?.kind !== "shift" || !(dt > 0) || this.holding || this._settling) return;
    this._acc += dt;
    const index = this.index;
    while (this._acc >= this.phase.tick - 1e-9 && !this.over && this.index === index && !this._settling) {
      this._acc -= this.phase.tick;
      this._tick(this.phase.tick);
    }
    if (this.index !== index) this._acc = 0;
  }

  /** Whether the clock waits for a game whose world is elsewhere and has not caught up. */
  get holding() {
    return this.active.some((s) => s.game && !s.game.over && s.game.holding);
  }

  /**
   * Let the games whose world is elsewhere exchange with it (`Game.sync`): a page calls this
   * between steps and does not call it again before it is done.
   * @returns {Promise<void>}
   */
  async sync() {
    await Promise.all(this.active.filter((s) => s.game && !s.game.over).map((s) => s.game.sync()));
    this._settle();
  }

  /**
   * The session is given up or over: every game is left (a game whose world is elsewhere gives back
   * what it holds there). A page calls it when it drops a session.
   * @returns {Promise<void>}
   */
  async leave() {
    await Promise.all([...this.seats.values()].map((s) => Promise.resolve(s.game?.leave()).catch(() => {})));
  }

  /**
   * Like `run`, for sessions with a game whose world is elsewhere: play on until a person is needed
   * or the session is over, exchanging with the worlds between the ticks.
   * @returns {Promise<Session>}
   */
  async runWith() {
    this.start();
    while (!this.over && !this.waiting) {
      await this.sync();
      if (this.over || this.waiting) break;
      if (this.phase.kind !== "shift") this._close();
      else if (!this.holding && !this._settling) this._tick(this.phase.tick);
    }
    return this;
  }

  _tick(h) {
    if (this._settling) return;
    this._injects();
    this._deliver();
    this._think();
    for (const seat of this.active) seat.game.step(h);
    this.ticks++;
    this.t = this.ticks * h;
    if (this.t >= this.phase.length - 1e-9 || this.active.every((s) => s.game.over)) {
      // the shift's time is up: a game whose world has not caught up is waited for (`sync`), then the shift closes
      if (this.holding) this._settling = true;
      else {
        this._close();
        this._auto();
      }
    }
  }

  /** A shift whose time is up closes once no game's world is waited for any more. @returns {boolean} whether it closed */
  _settle() {
    if (!this._settling || this.holding) return false;
    this._close();
    this._auto();
    return true;
  }

  /** End the current phase and begin the next (or end the session). */
  _close() {
    const ph = this.phase, ctx = this._ctx();
    this._settling = false;
    this._deliver();
    for (const seat of this.active) {
      const g = seat.game;
      // in a turn, what was not decided is decided by its fallback
      if (ph.kind === "turn" && !g.over) for (const d of g.open) g.decide(d.id, d.fallback ?? d.options[0].id, { auto: true });
      if (ph.kind === "shift" || !g.over) g.finish(ctx);
      if (ph.kind === "shift") {
        g.end("The shift is over.");
        seat.results.push({ round: ph.round, phase: ph.id, ...g.result() });
        seat.live = false;
        // a shift's game is not played on: what it holds elsewhere is given back
        Promise.resolve(g.leave()).catch(() => {});
      }
    }
    this._deliver();
    this.emit("phase-end", { phase: ph, index: this.index });
    const last = this.index + 1 >= this.plan.length;
    // the slow roles' results at the end of each round
    if (last || this.plan[this.index + 1].round !== ph.round) {
      for (const seat of this.seats.values()) {
        if (seat.game && seat.live) seat.results.push({ round: ph.round, phase: null, ...seat.game.result() });
      }
    }
    if (last) {
      this.over = true;
      for (const seat of this.seats.values()) {
        if (!seat.game || !seat.live) continue;
        seat.game.end("The session is over.");
        Promise.resolve(seat.game.leave()).catch(() => {});
      }
      this.emit("over", { result: this.result() });
      return;
    }
    this._begin(this.index + 1);
  }

  /* ---------------------------------------------------------------- the people's moves */

  /**
   * A person's move at a seat (one of the game's `static actions`), recorded for `replay`.
   * @returns what the move returns, or `{ok: false, reason}` when the seat is not at work
   */
  act(seatId, name, ...args) {
    const seat = this.seats.get(seatId);
    if (!seat || !seat.live || !this.active.includes(seat) || this.over) return { ok: false, reason: "This role is not at work now." };
    if (this._settling) return { ok: false, reason: "The shift is over." };
    if (!Object.hasOwn(seat.Game.actions, name)) throw new Error(`${seat.Game.id}: no move "${name}"`);
    this.record.push({ phase: this.index, tick: this.ticks, seat: seatId, name, args: structuredClone(args) });
    const result = seat.game.act(name, ...args);
    this.emit("move", { seat: seatId, name, args, result });
    return result;
  }

  /** End a turn (what is still open is decided by its fallback), or cut a shift short. */
  next() {
    if (this.over || this.index < 0) return;
    this.record.push({ phase: this.index, tick: this.ticks, seat: null, name: "@next", args: [] });
    this._close();
    this._auto();
  }

  /** A seat changes hands: a person sits down, or the computer takes over (before the start: who sits there at the start). */
  sit(seatId, by) {
    const seat = this.seats.get(seatId);
    if (!seat || !SEATS.includes(by)) return false;
    seat.by = by;
    if (this.index < 0) {
      this.seated[seatId] = by;
      return true;
    }
    this.record.push({ phase: this.index, tick: this.ticks, seat: seatId, name: "@seat", args: [by] });
    this._auto();
    return true;
  }

  /* ---------------------------------------------------------------- results, saving */

  /**
   * What led to what (chain.js): the story of each fault of the session's shifts, read from the
   * flows: every stretch of its time out of order with whose it was, and what it did.
   */
  threads() {
    const endOf = (i) => {
      const length = this.plan[i]?.length ?? this.t;
      return i < this.index || this.over ? length : Math.min(this.t, length);
    };
    return threads(this.flows, { endOf });
  }

  /**
   * The result: each seat with the results of its rounds and their mean as its score; the score of
   * the whole (the seats' scores by their weights), passed when every seat passed all its rounds;
   * how often each flow passed.
   */
  result() {
    const seats = [...this.seats.values()].map((s) => {
      const rs = s.results;
      const score = rs.length ? Math.round(rs.reduce((a, r) => a + r.score, 0) / rs.length) : 0;
      return {
        seat: s.id, role: s.role, game: s.Game.id, title: s.Game.title, by: s.by, weight: s.weight, score,
        passed: rs.length > 0 && rs.every((r) => r.passed), worst: rs.reduce((m, r) => Math.max(m, r.worst), 0),
        violations: rs.reduce((a, r) => a + r.violations, 0), rounds: rs,
      };
    });
    const w = seats.reduce((a, s) => a + s.weight, 0) || 1;
    const flows = {};
    for (const f of this.flows) flows[f.flow] = (flows[f.flow] || 0) + 1;
    return {
      mission: this.mission.id, seed: this.seed, over: this.over, rounds: this.rounds,
      score: Math.round(seats.reduce((a, s) => a + s.weight * s.score, 0) / w),
      passed: seats.every((s) => s.passed), seats, flows,
    };
  }

  /** What is needed to play the session again up to now: the mission's id, the seed, who sat where at the start, the moves, and where it stands. */
  save() {
    return { format: "arail-session/1", mission: this.mission.id, seed: this.seed, seats: { ...this.seated }, record: structuredClone(this.record), at: { phase: this.index, tick: this.ticks } };
  }

  /**
   * Play a session again from what `save` gives: the same mission, seed and seats, the people's
   * moves at their phase and tick, and on to where it stood (`at`; without it, to the last move).
   * A saved session goes on from there.
   * @param {object} mission
   * @param {{seed: number, seats: Record<string, string>, record: object[], at?: {phase: number, tick: number}}} saved
   * @param {{games: Map<string, Function>}} options
   * @returns {Session}
   */
  static replay(mission, saved, { games }) {
    const s = new Session(mission, { games, seed: saved.seed, seats: saved.seats });
    const record = saved.record ?? [], at = saved.at ?? null;
    s.start();
    let k = 0;
    while (!s.over) {
      const m = record[k];
      if (m && m.phase < s.index) k++; // of a phase that is over: it cannot be made any more
      else if (m && m.phase === s.index && m.tick <= s.ticks) {
        k++;
        if (m.name === "@next") s.next();
        else if (m.name === "@seat") s.sit(m.seat, m.args[0]);
        else s.act(m.seat, m.name, ...m.args);
      } else if (s._settling) break; // the shift's time is up and a game's world is waited for: the page's exchange goes on from here
      else if (s.phase.kind === "shift" && (m || (at && (s.index < at.phase || (s.index === at.phase && s.ticks < at.tick))))) s._tick(s.phase.tick); // time passes
      else break; // where it stood; or a turn the record never ended
    }
    return s;
  }
}
