/**
 * The game core: what the role games of ARail have in common (issue #103).
 *
 * A game is one role of the railway system (an id of the role catalogue, docs/roles.md) at work: a
 * clock in simulated seconds, resources (money, time, staff, counters), decisions with options, a
 * deadline and a default, moves the player may make at any time, rules that are kept or broken,
 * objectives with weights, and a log. Its result (score, rules broken, what was decided) is what a
 * round gives to the career mode (one person's working life through roles) and to the big game (the
 * roles together).
 *
 * A game has ports: the flows it takes from other roles and the flows it gives them (flows.js). On
 * its own, a game plays the other side of its ports itself (the signaller's own repair team); in a
 * session (session.js) the ports are wired to the games of the other roles, and what no role gives
 * comes from the mission. So every game works alone and joins the big game. See docs/game-core.md.
 *
 * Games run in Node and in the browser, without the DOM, and are deterministic: the same seed and the
 * same moves at the same times give the same game. A page draws them and passes the player's moves.
 * @module arail/game/core
 */
import { createRng, hashKey } from "../core/math.js";
import { flowOf } from "./flows.js";

/** How a game is played: a right answer exists, a simulation answers, or both. */
export const GAME_KINDS = ["knowledge", "simulation", "both"];

/** The time of day (HH:MM) of a game time: `t` seconds after `start` (seconds after midnight; a shift begins at 08:00). */
export const clockAt = (t, start = 8 * 3600) => {
  const s = Math.max(0, Math.floor((start + t) / 60));
  return `${String(Math.floor(s / 60) % 24).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** Seconds after midnight of a time of day, "HH:MM" or "HH:MM:SS". */
export const secondsOf = (clock) => String(clock).split(":").reduce((a, x, i) => a + Number(x) * [3600, 60, 1][i], 0);

/**
 * A computer player: plays a seat nobody sits on. `think` is called before every tick of a shift and
 * at the start of a turn, and makes its moves with `game.act`. This one takes every open decision's
 * fallback (or, without one, its first option) at once; a game names a better one in `static player`.
 */
export class Player {
  /** @param {Game} game */
  think(game) {
    for (const d of game.open) game.act("decide", d.id, d.fallback ?? d.options[0].id);
  }
}

export class Game {
  /** Unique id of the game. */
  static id = "game";
  static title = "Game";
  /** The role it is the game of (an id of the role catalogue). */
  static role = "";
  /** @type {"knowledge" | "simulation" | "both"} */
  static kind = "simulation";
  static description = "";
  /** The rhythm of its decisions (flows.js, SCALES): seconds to hours are played in shifts, days to years in turns. */
  static scale = "minutes";
  /**
   * The flows it takes from other roles and gives them. `from` and `to` name the roles (ids of the
   * catalogue) it exchanges them with; without them, any role.
   * @type {Array<{flow: string, from?: string[]}>}
   */
  static takes = [];
  /** @type {Array<{flow: string, to?: string[]}>} */
  static gives = [];
  /** The moves a player may make at any time: the name of the method, and a label. `act` makes them. */
  static actions = { decide: { label: "Decide" } };
  /** The computer player for a seat nobody sits on. */
  static player = Player;
  /**
   * What a seat must be told before the game begins when its world is elsewhere (the address of the
   * lab's simulation, a key): a page asks for these and passes them to the game as options.
   * @type {Array<{id: string, label: string, type?: "text" | "password", value?: string, hint?: string}>}
   */
  static settings = [];
  /**
   * Whether a session with this game can be played again from its record alone (`Session.replay`).
   * Not a game whose world is elsewhere and starts anew there (the lab's simulation): what was done
   * in it at its time would all arrive at once, and the world would run differently.
   */
  static replays = true;
  /**
   * The time of day ("HH:MM") a shift of this game begins, where the game is bound to one (a
   * timetable of its own). A session tells every game of a shift the shift's `clock` as an option;
   * a mission whose shift begins at another time than such a game's is not sound (`validateMission`).
   * @type {string | null}
   */
  static clock = null;

  /**
   * @param {object} [options]
   * @param {number} [options.seed]
   * @param {string} [options.level]
   * @param {Record<string, object>} [options.conditions] what holds when the game begins: the latest of each state flow it takes, by flow id
   * @param {Iterable<string>} [options.wired] the flows another seat of the session takes or gives; the other flows the game plays itself
   */
  constructor({ seed = 1, level = "normal", conditions = {}, wired = [] } = {}) {
    this.seed = seed;
    this.level = level;
    this.conditions = { ...conditions };
    this.wired = new Set(wired);
    /** Simulated time (s) since the start. */
    this.t = 0;
    /** Why the game is over, or null while it runs. */
    this.over = null;
    /** @type {Map<string, {id: string, label: string, value: number, unit: string}>} */
    this.resources = new Map();
    /** @type {Array<{id: string, title: string, text: string, options: Array<{id: string, label: string}>, deadline: number | null, fallback: string | null, made: string | null, at: number | null}>} */
    this.decisions = [];
    /** @type {Array<{t: number, rule: string, text: string, severity: number}>} */
    this.violations = [];
    /** @type {Array<{t: number, text: string, kind: string}>} */
    this.logs = [];
    /** How many of the oldest messages were let go (the list keeps the newest 250 to 300): with the list's length, how many there were. */
    this.dropped = 0;
    /** The flows received and given: `{flow, from, to, t, payload}`. */
    this.inbox = [];
    this.outbox = [];
    /** The moves made with `act`: `{t, name, args}`. */
    this.moves = [];
    this._handlers = new Map();
    this._listeners = new Set();
  }

  /** A random stream for one purpose and thing: the same keys give the same numbers. */
  rng(...parts) {
    const r = createRng(hashKey(this.seed, this.constructor.id, ...parts));
    r.next();
    return r;
  }

  /** Listen to the game's events (`log`, `decision`, `decided`, `violation`, `move`, `give`, `receive`, `over`, and the game's own). */
  on(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  emit(name, payload = {}) {
    for (const fn of this._listeners) fn(name, payload);
  }

  log(text, kind = "info") {
    const line = { t: this.t, text, kind };
    this.logs.push(line);
    if (this.logs.length > 300) {
      this.logs.splice(0, 50);
      this.dropped += 50;
    }
    this.emit("log", line);
  }

  /** Define a resource or set its value. */
  resource(id, label, value = 0, unit = "") {
    const r = this.resources.get(id) ?? { id, label, value: 0, unit };
    Object.assign(r, { label, value, unit });
    this.resources.set(id, r);
    return r;
  }

  /** Add to a resource (negative: spend); returns the new value. */
  add(id, v) {
    const r = this.resources.get(id);
    if (!r) throw new Error(`Unknown resource: ${id}`);
    r.value += v;
    return r.value;
  }

  value(id) {
    return this.resources.get(id)?.value ?? 0;
  }

  /**
   * Ask the player to decide. Without a decision by the deadline (simulated s from now), the
   * fallback option is taken; in a turn, at the end of the turn.
   * @param {{id: string, title: string, text?: string, options: Array<{id: string, label: string, hint?: string}>, within?: number | null, fallback?: string | null, then?: (option: string, decision: object) => void}} spec
   */
  ask({ id, title, text = "", options, within = null, fallback = null, then = null }) {
    const d = { id, title, text, options, deadline: within == null ? null : this.t + within, fallback, made: null, at: null };
    this.decisions = this.decisions.filter((x) => x.id !== id || x.made);
    this.decisions.push(d);
    if (then) this._handlers.set(id, then);
    this.emit("decision", { decision: d });
    return d;
  }

  /** The decisions waiting for the player. */
  get open() {
    return this.decisions.filter((d) => !d.made);
  }

  /**
   * Take back a decision that is still open, because its occasion has passed (the team it was about
   * has gone, the track it asked to open is open). Nobody decided it: its handler is not called, its
   * fallback not taken. A game keeps its open decisions true to its state with this.
   * @returns {boolean} whether one was open
   */
  withdraw(id) {
    const d = this.decisions.find((x) => x.id === id && !x.made);
    if (!d) return false;
    this.decisions = this.decisions.filter((x) => x !== d);
    this._handlers.delete(id);
    this.emit("withdrawn", { decision: d });
    return true;
  }

  /**
   * Take a decision.
   * @returns {boolean} whether there was such an open decision with that option
   */
  decide(id, option, { auto = false } = {}) {
    const d = this.decisions.find((x) => x.id === id && !x.made);
    if (!d || !d.options.some((o) => o.id === option)) return false;
    d.made = option;
    // a fallback is taken at the deadline
    d.at = auto && d.deadline != null ? d.deadline : this.t;
    d.auto = auto;
    const fn = this._handlers.get(id);
    this._handlers.delete(id);
    this.emit("decided", { decision: d, option, auto });
    fn?.(option, d);
    return true;
  }

  /**
   * Make a move: one of the game's `static actions`, by its name. The move is kept (`moves`), so a
   * session can record a game and play it again; pages and computer players move through here.
   * @returns what the move's method returns (`{ok, reason}` or a boolean)
   */
  act(name, ...args) {
    if (!Object.hasOwn(this.constructor.actions, name) || typeof this[name] !== "function") throw new Error(`${this.constructor.id}: no move "${name}"`);
    if (this.over) return { ok: false, reason: "The game is over." };
    const move = { t: this.t, name, args: structuredClone(args) };
    this.moves.push(move);
    const result = this[name](...args);
    this.emit("move", { ...move, result });
    return result;
  }

  /** Whether another seat of the session is at the other end of a flow (else the game plays that end itself). */
  isWired(flow) {
    return this.wired.has(flow);
  }

  /**
   * Give a flow to other roles (one of `static gives`). In a session it goes to the games that take
   * it; alone, it is only kept (`outbox`).
   * @param {string} flow
   * @param {object} [payload]
   * @param {{to?: string[] | null}} [options] only to these roles
   * @returns {{flow: string, from: string, to: string[] | null, t: number, payload: object}}
   */
  give(flow, payload = {}, { to = null } = {}) {
    if (!this.constructor.gives.some((g) => g.flow === flow)) throw new Error(`${this.constructor.id} does not give "${flow}" (static gives)`);
    const msg = { flow, from: this.constructor.role, to, t: this.t, payload };
    this.outbox.push(msg);
    this.emit("give", msg);
    return msg;
  }

  /** A flow arrives from another role or from the mission. A state flow replaces what held before. */
  receive(msg) {
    this.inbox.push(msg);
    if (flowOf(msg.flow)?.kind === "state") this.conditions[msg.flow] = msg.payload;
    this.emit("receive", msg);
    this.take(msg);
  }

  /** What the game does with a flow it receives (to override). */
  take(msg) {}

  /**
   * A game whose world is elsewhere (the lab's simulation behind its API) exchanges with it here:
   * its commands go out, what happened there comes in. A page calls it between the steps
   * (`Session.sync`); a step never waits for it. To override.
   * @returns {Promise<void>}
   */
  async sync() {}

  /**
   * Whether the session's clock must wait for this game: its world has not caught up (to override).
   * At the end of a shift too: the session closes the shift only when no game holds any more.
   */
  get holding() {
    return false;
  }

  /**
   * The game is left for good: its shift or its session is over, or the session was given up. A game
   * whose world is elsewhere gives back what it holds there (to override; called more than once).
   * @returns {Promise<void>}
   */
  async leave() {}

  /** A phase of a session begins for this game: a turn's decisions are asked here (to override). @param {{round: number, rounds: number, year: number, phase: object}} ctx */
  begin(ctx) {}

  /** A phase ends: a turn's decisions take effect, reports are given (to override). @param {{round: number, rounds: number, year: number, phase: object}} ctx */
  finish(ctx) {}

  /** A rule was broken (severity 1: a slip, 2: a breach, 3: a danger to people). */
  violate(rule, text, severity = 2) {
    const v = { t: this.t, rule, text, severity };
    this.violations.push(v);
    this.log(text, "violation");
    this.emit("violation", v);
    return v;
  }

  /** Go on by `dt` simulated seconds: deadlines of decisions, then the game's own `tick`. */
  step(dt) {
    if (this.over || !(dt > 0)) return;
    this.t += dt;
    for (const d of this.open) if (d.deadline != null && this.t >= d.deadline && d.fallback) this.decide(d.id, d.fallback, { auto: true });
    this.tick(dt);
  }

  /** The game's own step (to override). @param {number} dt simulated seconds */
  tick(dt) {}

  end(reason) {
    if (this.over) return;
    this.over = reason;
    this.log(reason, "end");
    this.emit("over", { reason });
  }

  /**
   * The objectives, each with a weight and how far it was reached (0–1); to override.
   * @returns {Array<{id: string, label: string, weight: number, value: number, note?: string}>}
   */
  objectives() {
    return [];
  }

  /** The score (0–100) from the weighted objectives. */
  score() {
    const parts = this.objectives();
    const w = parts.reduce((s, p) => s + p.weight, 0) || 1;
    const total = Math.round((100 * parts.reduce((s, p) => s + p.weight * Math.max(0, Math.min(1, p.value)), 0)) / w);
    return { total, parts };
  }

  /**
   * What a page shows of the game without knowing it: key figures, tables, and the moves that can be
   * made now, each with the fields to fill (to override). The generic role view of the play page
   * (game/play/) draws any game from this; a game's own page may draw more.
   *
   * A game may add a `sketch`: a picture of its world as plain shapes (a track diagram, a map), which
   * the page draws as it is. Its `items` are lines, texts, dots, tags (a label in a box: a train, a
   * van) and boxes, placed in a `width` × `height` and coloured by a `tone` (free, route, occupied,
   * closed, ok, warn, bad, failed, muted, place, train, idle, zs1); an item with an `id`, a `title`
   * and a `menu` can be chosen, and the page then offers the menu's moves (`{label, name, args,
   * disabled}`): a signal with its routes, a fault with the teams to send. An item's `alert` ("bad",
   * "warn") says that something about it needs attention: the page makes it pulse. A figure about one
   * item of the sketch names it as its `asset`: the page shows the figure on the item (its tone as
   * the pulse, its value when the item is chosen) instead of writing it out.
   * @returns {{sketch?: {title?: string, width: number, height: number, label: string, items: object[]}, figures: Array<{label: string, value: string | number, unit?: string, tone?: "ok" | "warn" | "bad", asset?: string}>, tables: Array<{id: string, title: string, columns: string[], rows: Array<Array<string | number>>, empty?: string}>, actions: Array<{name: string, label: string, hint?: string, primary?: boolean, disabled?: string, args?: any[], fields?: Array<{id: string, label: string, options?: Array<{id: string, label: string}>, type?: "number", min?: number, max?: number, step?: number, value?: number | string, unit?: string}>}>}}
   */
  view() {
    return { figures: [...this.resources.values()].map((r) => ({ label: r.label, value: r.value, unit: r.unit })), tables: [], actions: [] };
  }

  /** What a round gives to the career mode and the big game. */
  result() {
    const { total, parts } = this.score();
    const worst = this.violations.reduce((m, v) => Math.max(m, v.severity), 0);
    return {
      game: this.constructor.id, role: this.constructor.role, seed: this.seed, level: this.level, t: this.t,
      score: total, parts, violations: this.violations.length, worst,
      // a danger to people ends a round as failed, whatever the score (in the career: an investigation)
      passed: total >= 50 && worst < 3,
      decisions: this.decisions.filter((d) => d.made).map((d) => ({ id: d.id, option: d.made, at: d.at, auto: !!d.auto })),
    };
  }
}
