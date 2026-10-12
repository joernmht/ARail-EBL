/**
 * The plant that builds level crossing systems (BÜ-Sicherungsanlagen: half barriers with their
 * drives, road light signals, the controller cabinet with its software, train detection): an order
 * goes through engineering (the project-specific design and data), production, the factory test
 * (Werksprüfung, sometimes failed: rework) and delivery to the site. The plant has a few
 * production lines and also builds for other customers, so the delivery time depends on its queue.
 * Played by the computer.
 * @module arail/infra/factory
 */

export const STAGES = ["engineering", "production", "test", "delivery"];
export const STAGE_LABELS = { queued: "waiting", engineering: "engineering", production: "production", test: "factory test", rework: "rework", delivery: "delivery", done: "delivered" };
const WEEK = 7 * 1440;

export class Plant {
  /** @param {object} settings `factory` of the settings */
  constructor(settings) {
    this.s = settings;
    /** @type {object[]} */
    this.orders = [];
    this.n = 0;
  }

  get lines() {
    return this.s.lines;
  }

  /** Orders being worked on (with their line). */
  get active() {
    return this.orders.filter((o) => o.line != null && o.stage !== "done");
  }

  /** Orders waiting for a line. */
  get queued() {
    return this.orders.filter((o) => o.stage === "queued");
  }

  /** A new order; returns it. `project` is null for another customer's order. */
  order(t, { project = null, name }) {
    const o = { id: `BÜ-${String(++this.n).padStart(3, "0")}`, project, name, external: !project, stage: "queued", line: null, ordered: t, stageEnd: null, ready: null };
    this.orders.push(o);
    return o;
  }

  /** Free lines take queued orders (first come, first served); returns the orders started. */
  start(t) {
    const started = [];
    const busy = new Set(this.active.map((o) => o.line));
    for (const o of this.queued) {
      let line = -1;
      for (let i = 0; i < this.lines; i++) if (!busy.has(i)) { line = i; break; }
      if (line < 0) break;
      busy.add(line);
      o.line = line;
      o.stage = "engineering";
      o.stageEnd = t + this.s.weeks.engineering * WEEK;
      started.push(o);
    }
    return started;
  }

  /**
   * The current stage of an order is done: the next one starts (a failed factory test means
   * rework, then the test again). Returns the order, with `stage` "done" when it is delivered.
   */
  advance(o, t, rng) {
    if (o.stage === "test" && rng.chance(this.s.test_fail_p)) {
      o.stage = "rework";
      o.stageEnd = t + this.s.rework_weeks * WEEK;
      o.failedTest = (o.failedTest || 0) + 1;
      return o;
    }
    const next = o.stage === "rework" ? "test" : STAGES[STAGES.indexOf(o.stage) + 1];
    if (!next) {
      o.stage = "done";
      o.ready = t;
      o.line = null;
      return o;
    }
    // the line is free once the system is on its way to the site
    if (next === "delivery") o.line = null;
    o.stage = next;
    o.stageEnd = t + this.s.weeks[next] * WEEK;
    return o;
  }

  /** Expected weeks until an order now would be delivered. */
  leadWeeks() {
    const w = this.s.weeks, per = w.engineering + w.production + w.test;
    const waiting = this.queued.length + Math.max(0, this.active.length - this.lines + 1);
    return Math.ceil(per + w.delivery + (waiting * per) / Math.max(1, this.lines));
  }
}
