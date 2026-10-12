/**
 * The game core: what the role games of ARail have in common (a first, small form of issue #103).
 *
 * A game is one role of the railway system (an id of the role catalogue, docs/roles.md) at work: a
 * clock in simulated seconds, resources (money, time, staff, counters), decisions with options, a
 * deadline and a default, rules that are kept or broken, objectives with weights, and a log. Its
 * result (score, rules broken, what was decided) is what a round gives to the career mode (one
 * person's working life through roles) and to the big game (the roles together).
 *
 * Games run in Node and in the browser, without the DOM, and are deterministic: the same seed and the
 * same moves at the same times give the same game. A page draws them and passes the player's moves.
 * @module arail/game/core
 */
import { createRng, hashKey } from "../core/math.js";

/** How a game is played: a right answer exists, a simulation answers, or both. */
export const GAME_KINDS = ["knowledge", "simulation", "both"];

export class Game {
  /** Unique id of the game. */
  static id = "game";
  static title = "Game";
  /** The role it is the game of (an id of the role catalogue). */
  static role = "";
  /** @type {"knowledge" | "simulation" | "both"} */
  static kind = "simulation";
  static description = "";

  /** @param {{seed?: number, level?: string}} [options] */
  constructor({ seed = 1, level = "normal" } = {}) {
    this.seed = seed;
    this.level = level;
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
    this._handlers = new Map();
    this._listeners = new Set();
  }

  /** A random stream for one purpose and thing: the same keys give the same numbers. */
  rng(...parts) {
    const r = createRng(hashKey(this.seed, this.constructor.id, ...parts));
    r.next();
    return r;
  }

  /** Listen to the game's events (`log`, `decision`, `decided`, `violation`, `over`, and the game's own). */
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
    if (this.logs.length > 300) this.logs.splice(0, 50);
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
   * fallback option is taken.
   * @param {{id: string, title: string, text?: string, options: Array<{id: string, label: string}>, within?: number | null, fallback?: string | null, then?: (option: string, decision: object) => void}} spec
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
