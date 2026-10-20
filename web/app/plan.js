// Operations panel: the operations plan of the layout (arail/ops/plan.js), the panel of the cases
// Infrastructure → Operations and Railway undertaking → Operations, the same trains for both sides.
// The railway undertaking puts a unit and a driver on each train, the infrastructure manager puts it
// on a track; each train says at once what does not work, and a chart shows the plan over the hour
// (the units and drivers, or the tracks). Run plays the plan on the layout; the panel then tells how
// it went.
import { PLAN_KEYS, PLAN_SIDES, formatTime, planOf } from "../arail/index.js";
import { h, morph, mount } from "./ui.js";

const SPEEDS = [1, 2, 5, 10, 30];
/** The names of a train's choices. */
const LABELS = { unit: "Unit", driver: "Driver", track: "Track" };
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
/** The problems that colour a bar of the chart red, by the chart's rows. */
const BAD = { unit: ["unit-out", "places"], driver: ["driver-out", "shift"], track: ["track-taken", "length"] };

export class PlanPanel {
  /**
   * @param {object} app the ARail app (app.js)
   * @param {{side: "infra" | "evu"}} o the side whose part of the plan it shows
   */
  constructor(app, { side }) {
    this.app = app;
    this.side = side;
    this.el = null;
  }

  /** The layout's operations plan, or null. */
  get plan() {
    return planOf(this.app.world);
  }

  /** Draw the panel anew. @param {HTMLElement} el the case's place */
  render(el) {
    this.el = { root: el, head: h("div", { class: "section" }), trains: h("div", { class: "section" }), chart: h("div", { class: "section" }) };
    mount(el, this.el.head, this.el.trains, this.el.chart);
    this.update();
  }

  /** Refresh in place (every 400 ms while shown, and after a change). */
  update() {
    const e = this.el;
    if (!e?.root.isConnected) return;
    const plan = this.plan;
    if (!plan) {
      morph(e.head);
      morph(e.trains);
      morph(e.chart);
      return;
    }
    const checks = plan.checks(), mine = (id) => checks.get(id).filter((p) => p.side === this.side);
    morph(e.head, ...this._head(plan, plan.trains.reduce((n, t) => n + mine(t.id).length, 0)));
    morph(e.trains, h("h2", {}, "Trains"), h("ul", { class: "plan-trains" }, plan.trains.map((t) => this._train(plan, t, mine(t.id)))));
    morph(e.chart, ...this._chart(plan, checks));
  }

  _head(plan, problems) {
    const w = this.app.world, r = plan.running, res = plan.result, id = (x) => `${this.side}Plan${x}`;
    const gone = r ? [...plan.progress().values()].filter((s) => s === "done" || s === "cancelled").length : 0;
    return [
      h("h2", { tabindex: "-1" }, plan.name),
      h("p", { class: "hint" }, this.side === "evu" ? "Put a unit and a driver on each train." : "Put each train on a track."),
      h("p", { class: `plan-status${!r && problems ? " bad" : ""}`, id: id("Status"), "aria-live": "polite" },
        r ? `Running · ${gone} of ${plan.trains.length}` : problems ? plural(problems, "problem") : "No problems"),
      h("div", { class: "row" },
        r ? h("button", { class: "btn", type: "button", id: id("Stop"), onclick: () => this.stop() }, "Stop")
          : h("button", { class: "btn primary", type: "button", id: id("Run"), disabled: !plan.canRun, title: "Play the plan on the layout", onclick: () => this.run() }, "Run"),
        h("button", { class: "btn", type: "button", id: id("Reset"), disabled: !!r, title: "The plan as the layout has it", onclick: () => this.reset() }, "Start again"),
        r ? h("div", { class: "seg", role: "group", "aria-label": "Speed" },
          SPEEDS.map((s) => h("button", { type: "button", "aria-pressed": w.speed === s ? "true" : "false", onclick: () => this.setSpeed(s) }, `${s}×`))) : null),
      res && !r ? h("div", { class: "ops-tiles plan-result", id: id("Result"), role: "group", "aria-label": "Last run" },
        [["On time", res.onTime], ["Late", res.late], ["Cancelled", res.cancelled], ["Left behind", res.leftBehind]].map(([label, n]) =>
          h("div", { class: "tile" }, h("span", { class: "label" }, label), h("span", { class: "value" }, String(n))))) : null,
    ];
  }

  /** A train: its time and what it carries or how long it is, its choices, what does not work. */
  _train(plan, t, problems) {
    const evu = this.side === "evu";
    const meta = evu ? `${t.passengers} people` : `${formatTime(t.arr)}–${formatTime(t.dep)} · ${Math.round(plan.consistOf(t.id)?.length_m ?? 0)} m`;
    // what this side decides: the unit and driver, or the track
    const choices = {
      unit: () => plan.units.map((u) => [u.id, `${u.id} · ${u.places} places`]),
      driver: () => plan.drivers.map((d) => [d.id, `${d.name} · ${formatTime(d.from)}–${formatTime(d.to)}`]),
      track: () => plan.tracks.map((x) => [x.id, `${x.id} · ${Math.round(x.length_m)} m`]),
    };
    const fields = PLAN_KEYS.filter((k) => PLAN_SIDES[k] === this.side).map((k) => this._select(plan, t, k, LABELS[k], choices[k]()));
    // how it ran (or runs), else whether its part of the plan works
    const ran = this._outcome(plan, t);
    const chip = ran ? h("span", { class: `plan-chip ${ran.tone}` }, ran.text) : problems.length ? null : h("span", { class: "plan-chip ok" }, "OK");
    return h("li", { class: `plan-train${problems.length ? " bad" : ""}` },
      h("div", { class: "plan-head" }, h("strong", {}, plan.label(t)), h("span", { class: "meta" }, meta), chip),
      h("div", { class: "plan-fields" }, fields),
      problems.length ? h("ul", { class: "plan-problems" }, problems.map((p) => h("li", {}, p.text))) : null);
  }

  /** How a train runs or ran: on time, late, cancelled (null before the first run). */
  _outcome(plan, t) {
    const s = plan.running?.schedule.get(t.id) ?? plan.result?.trains.find((x) => x.id === t.id);
    if (!s) return null;
    if (s.cancelled) return { text: "cancelled", tone: "bad" };
    return s.delay >= 1 ? { text: `+${Math.round(s.delay)} min`, tone: "warn" } : { text: "on time", tone: "ok" };
  }

  _select(plan, t, key, label, choices) {
    const id = `plan-${this.side}-${t.id}-${key}`, now = plan.get(t.id)[key] ?? "";
    return h("label", { class: "field", for: id }, h("span", { class: "visually-hidden" }, label),
      h("select", { id, disabled: !!plan.running, onchange: (e) => this.choose(t.id, key, e.target.value) },
        h("option", { value: "", selected: !now }, "—"),
        choices.map(([value, text]) => h("option", { value, selected: value === now }, text))));
  }

  /**
   * The plan over the hour: for the railway undertaking its units and drivers (out with a train from
   * its arrival until it is back; a driver's shift as a band), for the infrastructure its tracks (taken
   * from a train's arrival to its departure). Red where the plan does not work; the time of a run.
   */
  _chart(plan, checks) {
    const evu = this.side === "evu", trains = plan.trains;
    if (!trains.length) return [];
    const end = (t) => (evu ? t.back : t.dep + plan.margin);
    const from = Math.floor(Math.min(...trains.map((t) => t.arr)) / 15) * 15, to = Math.max(from + 15, Math.ceil(Math.max(...trains.map(end)) / 15) * 15);
    const x = (m) => `${(100 * (Math.min(to, Math.max(from, m)) - from)) / (to - from)}%`;
    const width = (a, b) => `${(100 * (Math.min(to, b) - Math.max(from, a))) / (to - from)}%`;
    const bad = (t, key) => checks.get(t.id).some((p) => BAD[key].includes(p.kind));
    // the line in a few letters: the bars of the tracks are short
    const span = (t, a, b, key) => h("div", { class: `plan-span${bad(t, key) ? " bad" : ""}`, style: { left: x(a), width: width(a, b) }, title: `${plan.label(t)} · ${formatTime(a)}–${formatTime(b)}` }, evu ? t.line : t.line.replace(/\s+/g, ""));
    const row = (label, spans, shift = null) => h("div", { class: "plan-row" },
      h("span", { class: "plan-label" }, label),
      h("div", { class: "plan-lane" },
        shift ? h("div", { class: "plan-shift", style: { left: x(shift[0]), width: width(shift[0], shift[1]) } }) : null,
        spans,
        plan.running ? h("div", { class: "plan-now", style: { left: x(this.app.world.clock.minutes) } }) : null));
    const on = (key, id) => trains.filter((t) => plan.get(t.id)[key] === id);
    const rows = evu
      ? [...plan.units.map((u) => row(u.id, on("unit", u.id).map((t) => span(t, t.arr, t.back, "unit")))),
        ...plan.drivers.map((d) => row(d.name, on("driver", d.id).map((t) => span(t, t.arr, t.back, "driver")), [d.from, d.to]))]
      : plan.tracks.map((k) => row(k.id, on("track", k.id).map((t) => span(t, t.arr, t.dep + plan.margin, "track"))));
    const ticks = [];
    for (let m = from; m <= to; m += to - from > 60 ? 30 : 15) ticks.push(h("span", { style: { left: x(m) } }, formatTime(m)));
    return [
      h("h2", {}, evu ? "Units and drivers" : "Tracks"),
      h("p", { class: "hint" }, evu ? "A unit and its driver are out from the train's arrival until they are back." : "A track is taken from the train's arrival until a little after it left."),
      h("div", { class: "plan-chart" }, h("div", { class: "plan-axis", "aria-hidden": "true" }, ticks), rows),
    ];
  }

  /** Put a unit, a driver or a track on a train. */
  choose(trainId, key, value) {
    this.plan?.set(trainId, key, value || null);
    this.update();
  }

  /** Play the plan on the layout (the world runs). */
  run() {
    const plan = this.plan, app = this.app;
    if (!plan?.run()) return;
    if (app.world.paused) {
      app.world.paused = false;
      app.panels.updateSimulateControls();
    }
    this.update();
  }

  stop() {
    this.plan?.stop();
    this.update();
  }

  /** The plan as the layout has it. */
  reset() {
    this.plan?.reset();
    this.update();
  }

  setSpeed(s) {
    this.app.world.speed = s;
    this.app.panels.updateSimulateControls();
    this.update();
  }
}
