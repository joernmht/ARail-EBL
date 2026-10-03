// Operations panel: the layout's rail operations — the day (trains, units, crews, penalties), the fleet,
// the workshop and who does which ECM function, the crews and their duties, the penalties between the
// parties — and comparisons of setups under stress tests (runExperiment, in the page).
import {
  CAUSE_LABELS, FUNCTION_LABELS, KPIS, causeKeyLabel, durationLabel, hoursLabel, jobWord, opsOf, runExperiment, setupsOf, shortName,
  stressOf, toCSV,
} from "../arail/index.js";
import { download, h, morph, mount, storage, toast } from "./ui.js";

const VIEWS = [["today", "Today"], ["fleet", "Fleet"], ["workshop", "Workshop"], ["crews", "Crews"], ["money", "Penalties"], ["compare", "Compare"]];
const DAY = 1440;
/** Key figures shown as percentages or minutes (two decimals in the table). */
const FINE = new Set(["cancelledPct", "punctualPct", "shortPct", "kmLostPct", "availabilityPct", "workshopPct", "avgDelay"]);
const euro = (v) => `${Math.round(v).toLocaleString("en")} €`;
const signedEuro = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString("en")} €`;
const pct = (a, b) => (b > 0 ? `${((100 * a) / b).toFixed(1)} %` : "–");
const hhmm = (t) => {
  const m = ((Math.floor(t) % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
/** Words for the duty states. */
const DUTY_WORDS = { planned: "planned", active: "on duty", done: "done", open: "nobody", cancelled: "off sick", taken: "took over a duty" };

export class OperationsPanel {
  /** @param {object} app the ARail app (app.js) */
  constructor(app) {
    this.app = app;
    this.view = VIEWS.some(([v]) => v === storage.get("arail.opsView")) ? storage.get("arail.opsView") : "today";
    /** The comparison: what to run, its progress and its result. */
    this.compare = { setups: null, stress: "none", days: 14, seeds: 3, running: false, progress: 0, step: "", result: null, error: "", stop: false };
    /** A wider panel (on large screens) for the tables and the comparison. */
    this.wide = storage.get("arail.opsWide", false) === true;
    this.el = null;
  }

  get world() {
    return this.app.world;
  }

  /** The layout's operations simulation, or null. */
  get sim() {
    return opsOf(this.world);
  }

  /** Draw the panel anew. @param {HTMLElement} el the Operations tab panel */
  render(el) {
    this.el = { root: el, head: h("div", { class: "section" }), body: h("div", { class: "ops-body" }) };
    mount(el, this.el.head, this.el.body);
    this.update();
  }

  /** Refresh in place (every 400 ms while shown, and after actions). */
  update() {
    const e = this.el;
    if (!e?.root.isConnected) return;
    const sim = this.sim;
    if (!sim) {
      morph(e.head, this._noOperations());
      morph(e.body);
      return;
    }
    // another layout: its own setups, no result of the previous one
    if (sim !== this._shown && !this.compare.running) {
      Object.assign(this.compare, { setups: null, result: null, error: "", stress: "none" });
      this._shown = sim;
    }
    sim.step?.(0);
    morph(e.head, this._head(sim));
    const engine = sim.engine;
    if (!sim.active || !engine) {
      morph(e.body, h("p", { class: "hint" }, !sim.enabled ? "The rail operations of this layout are switched off (\"enabled\": false in the layout file)."
        : !sim.active ? "Another rail operations entry of this layout runs the trains." : "Starting the rail operations…"));
      return;
    }
    const views = { today: this._today, fleet: this._fleet, workshop: this._workshop, crews: this._crews, money: this._money, compare: this._compare };
    morph(e.body, views[this.view].call(this, sim, engine));
  }

  setView(v) {
    this.view = v;
    storage.set("arail.opsView", v);
    this.update();
  }

  /** Make the panel wider or narrow again (large screens; the stage gets narrower). */
  setWide(on) {
    this.wide = on;
    storage.set("arail.opsWide", on);
    this.syncWidth();
    this.update();
  }

  /** The panel is wide while the Operations tab is shown and the wide panel is chosen. */
  syncWidth() {
    document.querySelector(".main")?.classList.toggle("wide", this.wide && this.app.activeTab === "ops");
  }

  _noOperations() {
    return [
      h("h2", { tabindex: "-1" }, "Rail operations"),
      h("p", { class: "hint" }, "This layout has no rail operations. The Simulate tab adds them, or opens the example."),
    ];
  }

  /**
   * "Add rail operations to this layout" (Simulate panel): an operations entry with the default
   * settings; the Operations tab opens.
   */
  async addOperations() {
    const app = this.app, json = this.world.toJSON();
    json.simulations = [...(json.simulations || []), { type: "operations" }];
    try {
      await app._applyLayout(json);
    } catch (err) {
      toast(`Rail operations could not be added: ${err.message}`, 7000);
      return;
    }
    app.saveLayout();
    app.selectTab("ops");
    toast(this.sim?.engine?.lines.size
      ? "Rail operations added: the trains at the platforms now follow their timetable. A depot (Build → Transport) shows the workshop."
      : "Rail operations added, but no platform names a line yet (Lines in Build).", 7000);
  }

  _head(sim) {
    const e = sim.engine;
    const day = e ? e.today - e.dayOffset + 1 : 1;
    return [
      h("h2", { tabindex: "-1" }, sim.name),
      h("div", { class: "row ops-headline" },
        h("p", { class: "ops-status" }, e ? `${e.timeText(e.now)} · day ${day}` : "Starting…"),
        h("button", { class: "btn small ops-widen", type: "button", id: "opsWide", "aria-pressed": this.wide ? "true" : "false", onclick: () => this.setWide(!this.wide) }, "Wide panel")),
      h("div", { class: "seg ops-views", role: "group", "aria-label": "Show" },
        VIEWS.map(([v, label]) => h("button", { type: "button", id: `opsView-${v}`, "aria-pressed": this.view === v ? "true" : "false", onclick: () => this.setView(v) }, label))),
    ];
  }

  /* ---------------------------------------------------------------- Today */

  _today(sim, e) {
    const d = e.daily.get(e.today) || {};
    const units = [...e.units.values()];
    const available = units.filter((u) => u.status === "service" || (u.status === "ready" && u.released && !e._overdue(u))).length;
    const crew = [...e.desk.people.values()];
    const onDuty = crew.filter((p) => p.present).length;
    const duties = e.days.get(e.today)?.duties.filter((x) => x.kind === "line") || [];
    const open = duties.filter((x) => !x.person && x.state === "open").length;
    const penalties = e.penalties({ from: e.today * DAY, to: (e.today + 1) * DAY + 240 });
    const auth = e.ledger.authorityContract()?.id;
    const tiles = [
      ["Trains run", `${d.tripsRun ?? 0}`, `of ${d.trips ?? 0} today`],
      ["Cancelled", `${(d.tripsCancelled ?? 0) + (d.tripsTerminated ?? 0)}`, pct((d.tripsCancelled ?? 0) + (d.tripsTerminated ?? 0), d.trips ?? 0)],
      ["Punctual", d.tripsRun ? `${((100 * (d.onTime ?? 0)) / d.tripsRun).toFixed(1)} %` : "–", "less than 5 min late"],
      ["Units available", `${available}`, `of ${units.length}`],
      ["Crews on duty", `${onDuty}`, open ? `${open} dut${open === 1 ? "y" : "ies"} without anybody` : "all duties covered"],
      ["Penalties today", euro(auth ? penalties.byContract[auth] || 0 : 0), "to the transport authority"],
    ];
    const log = e.logs.slice(-12).reverse();
    return [
      h("div", { class: "ops-tiles" }, tiles.map(([label, value, note]) => h("div", { class: "tile" }, h("span", { class: "label" }, label), h("b", { class: "value" }, value), h("span", { class: "note" }, note)))),
      h("div", { class: "section" },
        h("h2", {}, "What happened"),
        log.length ? h("div", { class: "ops-log", tabindex: "0", role: "region", "aria-label": "What happened, newest first" },
          h("ul", {}, log.map((l) => h("li", { class: l.kind }, h("time", {}, e.timeText(l.t)), h("span", {}, l.text)))))
          : h("p", { class: "hint" }, "Nothing out of the ordinary yet."),
      ),
      h("div", { class: "section" },
        h("h2", {}, "Short-term changes"),
        h("div", { class: "row" },
          h("button", { class: "btn small", type: "button", id: "opsSick", onclick: () => this._inject({ type: "sick", count: 1, notice_min: 20 }) }, "A driver calls in sick"),
          h("button", { class: "btn small", type: "button", id: "opsBreak", onclick: () => this._inject({ type: "failure", kind: "hard" }) }, "A unit breaks down"),
          h("button", { class: "btn small", type: "button", id: "opsDefect", onclick: () => this._inject({ type: "failure", kind: "soft" }) }, "A unit gets a defect"),
        ),
        h("p", { class: "hint" }, "More in the Disruptions panel (drivers leave, the workshop closes, units damaged) and in scripted scenarios."),
      ),
    ];
  }

  _inject(event) {
    const text = this.sim?.inject(event);
    toast(text ? `${text[0].toUpperCase()}${text.slice(1)}.` : "Nothing happened.");
    this.update();
  }

  /* ---------------------------------------------------------------- Fleet */

  _fleet(sim, e) {
    const units = [...e.units.values()].sort((a, b) => a.id.localeCompare(b.id));
    const count = (f) => units.filter(f).length;
    const station = (id) => e.stations.get(id)?.name ?? id;
    const where = (u) => {
      if (u.trip) return `${u.trip.lineName} to ${station(u.trip.to)}`;
      if (u.status === "job") return `workshop: ${u.job ? jobWord(u.job) : "job"}`;
      if (u.status === "failed") return `failed (${CAUSE_LABELS[u.failCause] || "failure"})`;
      if (u.outUntil != null && e.now < u.outUntil) return "damaged";
      if (u.at === "workshop") return "at the workshop";
      if (!u.released) return "waiting for release";
      if (e._overdue(u)) return "may not run";
      return u.inDepot ? "in the depot" : `at ${station(u.at)}`;
    };
    const next = (u) => {
      const due = u.mostDue(u.type.program, e.now);
      if (!due) return "–";
      const km = Math.max(0, Math.round(u.kmLeft(u.type.program, e.now))), days = Math.max(0, u.daysLeft(u.type.program, e.now));
      return `${due.level.name}: ${Number.isFinite(km) ? `${km.toLocaleString("en")} km` : ""}${Number.isFinite(days) ? `${Number.isFinite(km) ? " / " : ""}${days.toFixed(0)} d` : ""}`;
    };
    const selected = this.unitChoice && e.units.has(this.unitChoice) ? this.unitChoice : units[0]?.id;
    return [
      h("p", { class: "hint" }, `${units.length} units: ${count((u) => u.status === "service")} in service, ${count((u) => u.status === "ready" && u.released)} ready, ${count((u) => u.status === "job" || u.status === "transfer" || u.status === "waiting")} in the workshop, ${count((u) => u.status === "failed")} failed.`),
      scroller("Units", h("table", { class: "ops-table" },
        h("thead", {}, h("tr", {}, ["Unit", "Where", "Next maintenance", "Defects"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, units.map((u) => h("tr", {},
          h("th", { scope: "row" }, u.id),
          h("td", {}, h("span", { class: `status-dot ${u.status === "failed" ? "bad" : u.status === "service" || (u.status === "ready" && u.released) ? "ok" : "warn"}` }), where(u)),
          h("td", {}, next(u)),
          h("td", {}, u.defects.map((x) => e.softKinds.get(x.kind)?.label.toLowerCase() ?? x.kind).join(", ") || "–")))))),
      h("div", { class: "row" },
        h("label", { class: "field", for: "opsUnit" }, h("span", {}, "Unit"),
          h("select", { id: "opsUnit", onchange: (ev) => (this.unitChoice = ev.target.value) }, units.map((u) => h("option", { value: u.id, selected: u.id === selected }, u.id)))),
        h("button", { class: "btn small", type: "button", onclick: () => this._failUnit(selected, "hard") }, "Breaks down"),
        h("button", { class: "btn small", type: "button", onclick: () => this._failUnit(selected, "soft") }, "Gets a defect"),
      ),
      h("p", { class: "hint" }, "Next maintenance: the level whose interval is closest to its limit, with the kilometres and days left. A unit past a limit may not run."),
    ];
  }

  _failUnit(id, kind) {
    const ok = this.sim?.failUnit(this.unitChoice || id, kind);
    toast(ok ? `${this.unitChoice || id}: ${kind === "soft" ? "a defect" : "broken down"}.` : kind === "soft" ? "Only a unit on its way can get a defect." : "This unit cannot fail now.");
    this.update();
  }

  /* ---------------------------------------------------------------- Workshop and ECM */

  _workshop(sim, e) {
    const m = e.model, w = m.maintenance.workshop;
    const party = (id) => e.parties.get(id);
    const roles = [["management", "1"], ["development", "2"], ["planning", "3"], ["delivery", "4"]].map(([fn]) => {
      const p = party(m.ecm[fn]);
      return h("tr", {},
        h("th", { scope: "row", class: "wrap" }, FUNCTION_LABELS[fn]),
        h("td", {}, p?.name ?? m.ecm[fn]),
        h("td", {}, p ? hoursLabel(p.hours) : "–", p && p.id !== m.operator && p.latency_min ? h("small", { class: "sub" }, `handles messages in ${durationLabel(p.latency_min)}`) : null));
    });
    const jobs = [...e.jobs.values()].filter((j) => j.state !== "done" && !j.cancelled).sort((a, b) => a.plannedStart - b.plannedStart);
    const bayText = (bay) => {
      const j = bay.job;
      return j ? `${j.unit} · ${jobWord(j)} · ${durationLabel(j.end - e.now)} left` : "free";
    };
    const planner = party(m.ecm.planning);
    return [
      h("div", { class: "section" },
        h("h2", {}, "Who does what (ECM)"),
        scroller("Who does what (ECM)", h("table", { class: "ops-table" },
          h("thead", {}, h("tr", {}, ["Function", "Party", "Working hours"].map((t) => h("th", { scope: "col" }, t)))),
          h("tbody", {}, roles))),
        h("p", { class: "hint" }, `Planning runs at ${hhmm(m.maintenance.planning.at)} when ${planner?.name ?? "the planning"} is at work; mileage data ${m.ecm.planning === m.operator || !m.ecm.data_latency_h ? "are live" : `are ${m.ecm.data_latency_h} h old`}. Messages between parties wait for the receiver's working hours and handling time.`),
      ),
      h("div", { class: "section" },
        h("h2", {}, `${w.name} `, h("span", { class: "count" }, `${hoursLabel(w.hours)}${w.transfer_min ? ` · ${w.transfer_min} min away` : " · in the depot"}`)),
        h("dl", { class: "kv" }, e.bays.map((bay) => [h("dt", {}, `Track ${bay.id}`), h("dd", {}, bayText(bay))])),
        jobs.length ? scroller("Workshop jobs", h("table", { class: "ops-table" },
          h("thead", {}, h("tr", {}, ["Unit", "Job", "Planned", "State"].map((t) => h("th", { scope: "col" }, t)))),
          h("tbody", {}, jobs.slice(0, 10).map((j) => h("tr", {},
            h("th", { scope: "row" }, j.unit),
            h("td", {}, jobWord(j)),
            h("td", { class: "nowrap" }, `${e.timeText(j.plannedStart)}–${hhmm(j.plannedEnd)}`),
            h("td", {}, j.state === "running" ? "working" : j.state === "waiting" ? "waiting" : "planned"))))))
          : h("p", { class: "hint" }, "No jobs planned."),
      ),
    ];
  }

  /* ---------------------------------------------------------------- Crews */

  _crews(sim, e) {
    const people = [...e.desk.people.values()];
    const drivers = people.filter((p) => p.role === "driver" && (p.left == null || p.left > e.today));
    const today = e.today;
    const duties = (e.days.get(today)?.duties || []).slice().sort((a, b) => a.signOn - b.signOn);
    const sick = drivers.filter((p) => e.desk.sickOn(p, today)).length;
    const away = drivers.filter((p) => e.desk.onVacation(p, today)).length;
    const standby = drivers.filter((p) => p.present && p.today?.kind === "reserve").length;
    const state = (duty) => {
      const p = duty.person ? e.desk.people.get(duty.person) : null;
      if (duty.state === "planned" && p && !p.present && duty.commute?.walking) return "walking to work";
      if (duty.state === "planned" && p && !p.present && duty.commute?.trip) return "on the train to work";
      return DUTY_WORDS[duty.state] ?? duty.state;
    };
    const choice = people.find((p) => p.id === this.personChoice) ? this.personChoice : duties.find((x) => x.person && x.state !== "done")?.person;
    const named = duties.filter((x) => x.person && x.state !== "done");
    return [
      h("p", { class: "hint" }, `${drivers.length} drivers: ${people.filter((p) => p.present).length} on duty now (${standby} on stand-by), ${sick} off sick, ${away} on vacation today.`),
      scroller("Duties today", h("table", { class: "ops-table" },
        h("thead", {}, h("tr", {}, ["Duty", "Driver", "Time", "State"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, duties.map((duty) => h("tr", {},
          h("th", { scope: "row" }, duty.kind === "reserve" ? `${duty.tpl.id} stand-by` : duty.tpl.id),
          h("td", { class: "nowrap" }, duty.person ? shortName(e.desk.people.get(duty.person)?.name ?? duty.person) : "–"),
          h("td", { class: "nowrap" }, `${hhmm(duty.signOn)}–${hhmm(duty.signOff)}`),
          h("td", {}, h("span", { class: `status-dot ${duty.state === "open" ? "bad" : duty.state === "active" ? "ok" : ""}` }), state(duty))))))),
      named.length ? h("div", { class: "row" },
        h("label", { class: "field", for: "opsPerson" }, h("span", {}, "Driver"),
          h("select", { id: "opsPerson", onchange: (ev) => (this.personChoice = ev.target.value) },
            named.map((x) => h("option", { value: x.person, selected: x.person === choice }, `${shortName(e.desk.people.get(x.person).name)} (${x.tpl.id})`)))),
        h("button", { class: "btn small", type: "button", onclick: () => this._sick(this.personChoice || choice) }, "Calls in sick"),
      ) : null,
      h("p", { class: "hint" }, `Duties keep the working-time rules: at most ${Math.max(...e.model.crew.contracts.map((k) => k.max_duty_h))} h, breaks after 6 h, ${e.model.crew.contracts[0].min_rest_h} h rest. Changing trains takes ${e.model.crew.transfer_min} min. People who live in the town walk to the depot; some come in by train.`),
    ];
  }

  _sick(id) {
    const p = this.sim?.engine?.desk.people.get(id);
    const ok = p && this.sim.sickCall(id);
    toast(ok ? `${p.name} called in sick.` : "Nobody to call in sick.");
    this.update();
  }

  /* ---------------------------------------------------------------- Penalties */

  _money(sim, e) {
    const pen = e.penalties();
    const parties = e.model.parties;
    const contracts = e.model.contracts;
    const max = Math.max(1, ...Object.values(pen.parties).map((p) => Math.abs(p.net)));
    const causes = Object.entries(pen.byCause).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const days = e.today - e.measureFrom + 1;
    return [
      h("p", { class: "hint" }, `Since day 1 (${days} day${days === 1 ? "" : "s"}). Penalties go to the transport authority for what passengers notice, then down the contracts to the party responsible.`),
      h("div", { class: "section" },
        h("h2", {}, "Contracts"),
        scroller("Contracts", h("table", { class: "ops-table" },
          h("thead", {}, h("tr", {}, ["Contract", "Who pays whom", "Amount"].map((t) => h("th", { scope: "col" }, t)))),
          h("tbody", {}, contracts.map((c) => h("tr", {},
            h("th", { scope: "row" }, c.name),
            h("td", {}, `${e.parties.get(c.payer)?.name} → ${e.parties.get(c.payee)?.name}`),
            h("td", { class: "num" }, euro(pen.byContract[c.id] || 0)))))))),
      h("div", { class: "section" },
        h("h2", {}, "Net per party"),
        netTable(parties.map((p) => ({ name: p.name, values: [pen.parties[p.id]?.net ?? 0] })), [""], max),
        h("p", { class: "hint" }, "Received minus paid. Parties with several roles pay nothing to themselves."),
      ),
      h("div", { class: "section" },
        h("h2", {}, "Largest causes"),
        causes.length ? h("dl", { class: "kv" }, causes.map(([k, v]) => [h("dt", {}, causeKeyLabel(k)), h("dd", {}, euro(v))])) : h("p", { class: "hint" }, "No penalties yet."),
      ),
    ];
  }

  /* ---------------------------------------------------------------- Compare */

  _compare(sim) {
    const c = this.compare, config = sim.config;
    const setups = setupsOf(config), stresses = stressOf(config);
    if (!c.setups) c.setups = setups.map((s) => s.id);
    const stress = stresses.find((s) => s.id === c.stress) || stresses[0];
    return [
      h("p", { class: "hint" }, "Runs the layout's operations for each setup under a stress test, from the same random events, without the clock. Setups and stress tests come from the layout (setups, stress) or the presets."),
      h("fieldset", { class: "ops-choices" },
        h("legend", {}, "Setups"),
        setups.map((s) => h("label", { class: "field check", for: `opsSetup-${s.id}`, title: s.description || null },
          h("input", { type: "checkbox", id: `opsSetup-${s.id}`, checked: c.setups.includes(s.id), disabled: c.running,
            onchange: (ev) => { c.setups = ev.target.checked ? [...c.setups, s.id] : c.setups.filter((x) => x !== s.id); } }),
          s.name)),
      ),
      h("div", { class: "fields" },
        h("label", { class: "field", for: "opsStress" }, h("span", {}, "Stress test"),
          h("select", { id: "opsStress", disabled: c.running, onchange: (ev) => { c.stress = ev.target.value; this.update(); } },
            stresses.map((s) => h("option", { value: s.id, selected: s.id === stress.id }, s.name)))),
        h("label", { class: "field", for: "opsDays" }, h("span", {}, "Days"),
          h("select", { id: "opsDays", disabled: c.running, onchange: (ev) => (c.days = Number(ev.target.value)) },
            [7, 14, 28, 56].map((d) => h("option", { value: d, selected: d === c.days }, `${d} days`)))),
        h("label", { class: "field", for: "opsSeeds" }, h("span", {}, "Runs per setup"),
          h("select", { id: "opsSeeds", disabled: c.running, onchange: (ev) => (c.seeds = Number(ev.target.value)) },
            [1, 3, 5, 10].map((d) => h("option", { value: d, selected: d === c.seeds }, `${d}`)))),
      ),
      stress.description ? h("p", { class: "hint" }, stress.description) : null,
      h("div", { class: "row" },
        c.running ? h("button", { class: "btn", type: "button", id: "opsStop", onclick: () => (c.stop = true) }, "Stop")
          : h("button", { class: "btn primary", type: "button", id: "opsRun", disabled: !c.setups.length, onclick: () => this.runComparison() }, "Compare"),
        c.result ? h("button", { class: "btn small", type: "button", id: "opsCsv", onclick: () => download("operations-comparison.csv", toCSV(c.result), "text/csv") }, "Download CSV") : null,
      ),
      c.running ? h("div", { class: "ops-progress", role: "progressbar", "aria-label": "Comparison", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(c.progress * 100)) },
        h("i", { style: { width: `${Math.round(c.progress * 100)}%` } })) : null,
      c.running ? h("p", { class: "hint" }, c.step) : null,
      c.error ? h("p", { class: "hint error" }, c.error) : null,
      c.result ? this._results(c.result) : null,
    ];
  }

  /** Run the comparison in the page, a setup and seed at a time (the panel shows the progress). */
  async runComparison() {
    const sim = this.sim, c = this.compare;
    if (!sim || c.running) return;
    const all = setupsOf(sim.config), stresses = stressOf(sim.config);
    const setups = all.filter((s) => c.setups.includes(s.id));
    const stress = stresses.find((s) => s.id === c.stress) || null;
    const base = sim._baseDoor();
    const homes = base ? sim._homes(base) : [];
    Object.assign(c, { running: true, progress: 0, error: "", stop: false, step: "Starting…" });
    this.update();
    try {
      const seeds = Array.from({ length: c.seeds }, (_, i) => this.world.seed + i);
      for await (const step of runExperiment({ config: sim.config, layout: sim._layout(), setups, stress, days: c.days, seeds, homes })) {
        if (c.stop) break;
        c.progress = step.progress;
        if (step.done) c.result = step.result;
        else c.step = `${all.find((s) => s.id === step.setup)?.name ?? step.setup}, run ${seeds.indexOf(step.seed) + 1} of ${seeds.length}`;
        this.update();
      }
      if (c.stop) toast("Comparison stopped.");
    } catch (err) {
      c.error = `The comparison failed: ${err.message}`;
    } finally {
      c.running = false;
      this.update();
    }
  }

  _results(result) {
    const rows = result.rows;
    const names = rows.map((r) => r.name);
    const best = (key, better) => {
      const vals = rows.map((r) => r.values[key].mean);
      if (!better || vals.every((v) => v === vals[0])) return -1;
      return vals.indexOf(better === "low" ? Math.min(...vals) : Math.max(...vals));
    };
    const fmt = (key, v) => (FINE.has(key) ? v.toFixed(key === "avgDelay" ? 2 : 1) : Math.round(v).toLocaleString("en"));
    const parties = [...new Set(rows.flatMap((r) => Object.keys(r.parties)))];
    const max = Math.max(1, ...rows.flatMap((r) => Object.values(r.parties).map((p) => Math.abs(p.net))));
    const sparkMax = Math.max(1, ...rows.flatMap((r) => r.daily.map((d) => d.cancelled)));
    return h("div", { class: "section ops-results" },
      h("h2", {}, `Results `, h("span", { class: "count" }, `${result.stress?.name ?? "normal operation"}, ${result.days} days, ${result.seeds} run${result.seeds === 1 ? "" : "s"} each`)),
      scroller("Key figures per setup", h("table", { class: "ops-table ops-compare" },
        h("caption", { class: "visually-hidden" }, "Key figures per setup (means); the best value of each row is bold, where lower or higher is better"),
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Key figure"), names.map((n) => h("th", { scope: "col" }, n)))),
        h("tbody", {}, KPIS.map(([key, label, unit, better]) => {
          const b = best(key, better);
          return h("tr", {},
            h("th", { scope: "row" }, label, unit ? h("small", {}, ` ${unit}`) : null),
            rows.map((r, i) => {
              const v = r.values[key];
              const range = v.max > v.min ? `${fmt(key, v.min)}–${fmt(key, v.max)}` : null;
              return h("td", { class: "num", title: range ? `range ${range}` : null }, i === b ? h("strong", {}, fmt(key, v.mean), h("span", { class: "visually-hidden" }, " (best)")) : fmt(key, v.mean));
            }));
        })))),
      h("h3", {}, "Cancelled trains per day"),
      h("div", { class: "ops-sparks" }, rows.map((r) => h("div", { class: "spark-row" },
        h("span", { class: "name" }, r.name),
        sparkline(r.daily.map((d) => d.cancelled), sparkMax, `${r.name}: cancelled trains per day`),
        h("b", {}, `${Math.round(r.daily.reduce((s, d) => s + d.cancelled, 0))}`)))),
      h("p", { class: "hint" }, `Same scale for every setup (0–${Math.ceil(sparkMax)} a day); the number is the total.`),
      h("h3", {}, "Who pays whom (net penalties)"),
      netTable(parties.map((p) => ({ name: this.sim?.engine?.parties.get(p)?.name ?? p, values: rows.map((r) => r.parties[p]?.net ?? 0) })), names, max),
      h("p", { class: "hint" }, "Received minus paid, mean per run. Bars to the right: receives; to the left: pays."),
    );
  }
}

/** A table that scrolls sideways where it is too wide: a named region that the keyboard can scroll. */
function scroller(label, table) {
  return h("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": label }, table);
}

/**
 * A table of signed euro values with a bar in each cell (diverging around zero: pays to the left in
 * Orange, receives to the right in Türkis; the sign is also in the number).
 */
function netTable(rows, columns, max) {
  return scroller("Net penalties per party", h("table", { class: "ops-table ops-net" },
    columns.some(Boolean) ? h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Party"), columns.map((c) => h("th", { scope: "col" }, c)))) : null,
    h("tbody", {}, rows.map((r) => h("tr", {},
      h("th", { scope: "row" }, r.name),
      r.values.map((v) => {
        const w = Math.min(50, (50 * Math.abs(v)) / max);
        return h("td", { class: "num" },
          h("span", { class: "dbar", "aria-hidden": "true" }, h("i", { class: v < 0 ? "pays" : "gets", style: { width: `${w}%`, [v < 0 ? "right" : "left"]: "50%" } })),
          signedEuro(v));
      }))))));
}

/** A small column chart of values (shared maximum), with the values in its title. */
function sparkline(values, max, label) {
  const n = Math.max(1, values.length), W = 140, H = 28, gap = n > 30 ? 0.5 : 1;
  const bw = W / n;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "spark");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${label}: ${values.map((v) => Math.round(v * 10) / 10).join(", ")}`);
  const base = document.createElementNS(ns, "line");
  Object.entries({ x1: 0, x2: W, y1: H - 0.5, y2: H - 0.5, class: "base" }).forEach(([k, v]) => base.setAttribute(k, v));
  svg.append(base);
  values.forEach((v, i) => {
    if (!(v > 0)) return;
    const hgt = Math.max(1.5, ((H - 2) * v) / max);
    const r = document.createElementNS(ns, "rect");
    Object.entries({ x: i * bw + gap / 2, y: H - 1 - hgt, width: Math.max(0.8, bw - gap), height: hgt, rx: Math.min(1.5, bw / 3) }).forEach(([k, val]) => r.setAttribute(k, val));
    const t = document.createElementNS(ns, "title");
    t.textContent = `day ${i + 1}: ${Math.round(v * 10) / 10}`;
    r.append(t);
    svg.append(r);
  });
  return svg;
}

