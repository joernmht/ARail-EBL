// Journeys panel: the travellers of an exercise. Every attendee makes a traveller with a start and
// an aim, asks for travel plans with transfers and chooses one; then all follow their travellers on
// the layout ("Show" follows one with the flyover's camera), and the results compare the planned and
// the real arrivals (CSV for the debriefing).
import { formatTime, journeysOf, parseColor, TRAVELLER_STATES } from "../arail/index.js";
import { download, h, morph, mount, section, storage, toast } from "./ui.js";

/** Transfer times offered (clock minutes). */
const TRANSFERS = [0, 2, 3, 5, 8, 10, 15, 20];
const DAY = 1440;
/** Groups of places in the lists, by the use of the building. */
const GROUPS = [
  ["residential", "Homes"],
  ["work", "Work and school"],
  ["shop", "Shops and the station"],
  ["other", "Other buildings"],
  ["station", "Stations beyond the layout (by train)"],
];
const groupOf = (p) => (p.kind === "station" ? "station" : p.use === "residential" ? "residential" : p.use === "work" || p.use === "school" ? "work" : p.use === "shop" ? "shop" : "other");

const hm = (t) => (t == null || !Number.isFinite(t) ? "–" : formatTime(((t % DAY) + DAY) % DAY));
const minutes = (m) => `${Math.max(0, Math.round(m))} min`;
const refOf = (value) => {
  const [kind, ...id] = String(value || "").split(":");
  return kind && id.length ? { kind, id: id.join(":") } : null;
};
const valueOf = (ref) => (ref ? `${ref.kind}:${ref.id}` : "");

/** Black or white text on a colour, whichever has more contrast. */
function textOn(colour) {
  const lum = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = parseColor(colour);
  const L = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? "#000000" : "#ffffff";
}

export class JourneysPanel {
  /** @param {object} app the ARail app (app.js) */
  constructor(app) {
    this.app = app;
    /** The traveller being made. */
    this.draft = { name: "", from: "", to: "", leave: "", transfer: null };
    /** Plans found for the draft (null: not asked yet). */
    this.plans = null;
    /** Travellers whose plan and log are open. */
    this.open = new Set();
    /** A wider panel (on large screens) for the results. */
    this.wide = storage.get("arail.journeysWide", false) === true;
    this._removeAll = 0;
    this.el = null;
  }

  get world() {
    return this.app.world;
  }

  /** The layout's journeys simulation, or null. */
  get sim() {
    return journeysOf(this.world);
  }

  /** Draw the panel anew. @param {HTMLElement} el the Journeys tab panel */
  render(el) {
    this.el = {
      root: el, head: h("div", { class: "section" }), form: h("div", { class: "section journey-new" }), plans: h("div", { class: "journey-plans", "aria-live": "polite" }),
      list: h("div", { class: "section" }), results: h("div", { class: "section" }),
    };
    mount(el, this.el.head, this.el.form, this.el.list, this.el.results);
    this._shown = this.sim;
    this.renderForm();
    this.update();
  }

  /** The panel is wide while the Journeys tab is shown and the wide panel is chosen. */
  syncWidth() {
    if (this.app.activeTab === "journeys") document.querySelector(".main")?.classList.toggle("wide", this.wide);
  }

  setWide(on) {
    this.wide = on;
    storage.set("arail.journeysWide", on);
    this.syncWidth();
    this.update();
  }

  /** "Add journeys to this layout" (Simulate panel): a journeys entry with the default settings. */
  async addJourneys() {
    const app = this.app, json = this.world.toJSON();
    json.simulations = [...(json.simulations || []), { type: "journeys" }];
    try {
      await app._applyLayout(json);
    } catch (err) {
      toast(`The journeys could not be added: ${err.message}`, 7000);
      return;
    }
    app.saveLayout();
    app.selectTab("journeys");
    toast(this.sim?.rail().stations.some((s) => !s.on_layout)
      ? "Journeys added: make a traveller, choose its travel plan and follow it on the layout. The trains at the platforms now run to the timetable."
      : "Journeys added. No platform names a line yet (Lines in Build), so the travellers go on foot and by bus.", 7000);
  }

  /* ---------------------------------------------------------------- refresh */

  /** Refresh in place (every 400 ms while shown, and after actions). */
  update() {
    const e = this.el;
    if (!e?.root.isConnected) return;
    const sim = this.sim;
    if (sim !== this._shown) {
      // another layout (or the module switched): its places
      this._shown = sim;
      this.plans = null;
      this.renderForm();
    }
    if (!sim) {
      morph(e.head, h("h2", { tabindex: "-1" }, "Journeys"), h("p", { class: "hint" }, "This layout has no journeys. The Simulate tab adds them, or switches on the module of the lab example."));
      morph(e.list);
      morph(e.results);
      return;
    }
    morph(e.head, this._head(sim));
    morph(e.list, this._list(sim));
    morph(e.results, this._results(sim));
  }

  _head(sim) {
    const c = this.world.clock, all = sim.travellers;
    const done = all.filter((t) => t.state === "arrived").length;
    const rail = sim.rail();
    const trains = rail.kind === "operations" ? "the trains of the rail operations" : sim.runsTrains ? "the trains of the journeys' timetable" : "the trains of the control system";
    const town = this.world.simulations.find((s) => s.constructor.type === "town");
    const pax = this.world.simulations.find((s) => s.constructor.type === "passengers");
    const crowd = (town?.enabled ?? false) || (pax?.others ?? false);
    return [
      h("h2", { tabindex: "-1" }, "Journeys"),
      h("div", { class: "row ops-headline" },
        h("p", { class: "ops-status" }, `${c.label()} · ${all.length} traveller${all.length === 1 ? "" : "s"}${all.length ? ` · ${done} arrived` : ""}`),
        h("button", { class: "btn small ops-widen", type: "button", id: "journeysWide", "aria-pressed": this.wide ? "true" : "false", onclick: () => this.setWide(!this.wide) }, "Wide panel")),
      h("p", { class: "hint" }, `Every attendee makes a traveller and chooses its travel plan. Travellers walk, take the buses and ${trains}; a train they miss, they take the next one of its line. “Show” follows a traveller in the flyover.`),
      town || pax ? h("label", { class: "field check", for: "journeysCrowd" },
        h("input", { type: "checkbox", id: "journeysCrowd", checked: crowd, onchange: (ev) => this._setCrowd(ev.target.checked) }),
        "Generated people too (the town's residents and other passengers)") : null,
    ];
  }

  /** The town and the other passengers on or off (with the travellers, or the travellers alone). */
  _setCrowd(on) {
    const w = this.world;
    const town = w.simulations.find((s) => s.constructor.type === "town");
    const pax = w.simulations.find((s) => s.constructor.type === "passengers");
    if (town) {
      town.clear();
      town.enabled = on;
      town.config.enabled = on;
      if (!on) w.occupancy = new Map(); // buildings light up by the time of day again
    }
    if (pax) pax.config.others = on;
    this.app.saveLayout();
    toast(on ? "The town's residents and other passengers are back." : "Only the travellers are on the move now.");
    this.update();
  }

  /* ---------------------------------------------------------------- a new traveller */

  /** The form for a new traveller (rendered when the panel or the layout changes, not refreshed). */
  renderForm() {
    const e = this.el, sim = this.sim;
    if (!e) return;
    if (!sim) {
      mount(e.form);
      return;
    }
    const places = sim.places();
    const d = this.draft;
    const has = (v) => places.some((p) => valueOf(p) === v);
    if (!has(d.from)) d.from = valueOf(places.find((p) => p.use === "residential") || places[0]);
    if (!has(d.to) || d.to === d.from) d.to = valueOf(places.find((p) => p.kind === "station") || places.find((p) => valueOf(p) !== d.from));
    if (!d.leave) d.leave = formatTime(Math.ceil((this.world.clock.minutes + 10) / 5) * 5);
    d.transfer ??= Number(sim.config.transfer_min ?? 3);
    const options = (id, label, key) => h("label", { class: "field", for: id }, h("span", {}, label),
      h("select", { id, onchange: (ev) => this._change(key, ev.target.value) },
        GROUPS.map(([g, title]) => {
          const list = places.filter((p) => groupOf(p) === g);
          return list.length ? h("optgroup", { label: title }, list.map((p) => h("option", { value: valueOf(p), selected: valueOf(p) === d[key] }, p.name))) : null;
        })));
    mount(e.form,
      h("h2", {}, "New traveller"),
      places.length < 2 ? h("p", { class: "hint" }, "This layout has nothing to go from and to yet: buildings with an entrance, or stations beyond the layout (lines on the platforms).") : [
        h("div", { class: "fields" },
          h("label", { class: "field wide", for: "journeyName" }, h("span", {}, "Name"),
            h("input", { type: "text", id: "journeyName", value: d.name, placeholder: sim.newName(), maxlength: 40, autocomplete: "off", oninput: (ev) => (d.name = ev.target.value) })),
          options("journeyFrom", "From", "from"),
          options("journeyTo", "To", "to"),
          h("label", { class: "field", for: "journeyLeave" }, h("span", {}, "Leaves at"),
            h("input", { type: "time", id: "journeyLeave", value: d.leave, step: 60, required: true, onchange: (ev) => this._change("leave", ev.target.value) })),
          h("label", { class: "field", for: "journeyTransfer" }, h("span", {}, "Transfer time"),
            h("select", { id: "journeyTransfer", onchange: (ev) => this._change("transfer", Number(ev.target.value)) },
              [...new Set([...TRANSFERS, d.transfer])].sort((a, b) => a - b).map((m) => h("option", { value: m, selected: m === d.transfer }, `${m} min`)))),
        ),
        h("p", { class: "hint" }, "The transfer time is the least time between getting to a platform (or off a train) and the next train: short ones are fast, but a little delay breaks them. Times are on the layout's fast clock: walks and buses take longer than in reality."),
        h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", id: "journeyFind", onclick: () => this.findPlans() }, "Find travel plans")),
        e.plans,
      ]);
    this._renderPlans();
  }

  _change(key, value) {
    this.draft[key] = value;
    if (this.plans) {
      this.plans = null;
      this._renderPlans();
    }
  }

  /** Ask the planner for plans for the draft. */
  findPlans() {
    const sim = this.sim, d = this.draft;
    if (!sim) return;
    const from = refOf(d.from), to = refOf(d.to);
    if (!from || !to) return toast("Choose where the traveller starts and where it goes.");
    if (d.from === d.to) return toast("The start and the aim are the same place.");
    if (!/^\d{1,2}:\d{2}$/.test(d.leave || "")) return toast("Enter the time the traveller leaves, e.g. 07:40.");
    this.plans = sim.plan({ from, to, leave: d.leave, transfer: d.transfer });
    this._renderPlans();
    if (!this.plans.length) return;
    this.el.plans.querySelector("button")?.focus({ preventScroll: false });
  }

  _renderPlans() {
    const box = this.el?.plans;
    if (!box) return;
    const plans = this.plans;
    if (plans == null) return mount(box);
    if (!plans.length) {
      return mount(box, h("p", { class: "hint error" }, "No travel plan found for this time: no way between these places, or no trains run then (they start at about 05:00). Try another time or place."));
    }
    const fastest = Math.min(...plans.map((p) => p.arr)), fewest = Math.min(...plans.map((p) => p.transfers));
    const today = this.world.clock.day;
    mount(box,
      h("h3", {}, `Travel plans · ${plans.length}`, Math.floor(plans[0].dep / DAY) > today ? " (tomorrow)" : ""),
      h("ol", { class: "plan-list" }, plans.map((p, i) => {
        const tags = [p.arr === fastest ? "fastest" : null, p.transfers === fewest && plans.some((q) => q.transfers > fewest) ? "fewest changes" : null].filter(Boolean);
        const summary = `${hm(p.dep)} → ${hm(p.arr)}, ${minutes(p.arr - p.dep)}, ${p.transfers ? `${p.transfers} change${p.transfers > 1 ? "s" : ""}` : "no change"}`;
        return h("li", { class: "plan" },
          h("div", { class: "plan-head" },
            h("b", {}, `${hm(p.dep)} → ${hm(p.arr)}`),
            h("span", {}, ` · ${minutes(p.arr - p.dep)} · ${p.transfers ? `${p.transfers} change${p.transfers > 1 ? "s" : ""}` : "no change"}`),
            tags.map((t) => h("span", { class: "tag" }, t))),
          legList(p.legs, p.dep),
          h("button", { class: "btn small primary", type: "button", id: `journeyChoose-${i}`, "aria-label": `Choose: ${summary}`, onclick: () => this.choose(p) }, "Choose"));
      })));
  }

  /** The attendee chose a plan: the traveller is made. */
  choose(plan) {
    const sim = this.sim, d = this.draft;
    if (!sim) return;
    let t;
    try {
      t = sim.addTraveller({ name: d.name, from: refOf(d.from), to: refOf(d.to), plan, transfer: d.transfer });
    } catch (err) {
      toast(err.message);
      return;
    }
    this.app.saveLayout();
    d.name = "";
    this.plans = null;
    this.renderForm();
    this.update();
    toast(`${t.name} leaves at ${hm(t.at(t.leave))}${t.at(t.leave) < this.world.clock.day * DAY + this.world.clock.minutes ? " (now)" : ""}. Follow the traveller with “Show”.`, 5000);
  }

  /* ---------------------------------------------------------------- the travellers */

  _list(sim) {
    const all = sim.travellers;
    return [
      h("h2", {}, "Travellers ", h("span", { class: "count" }, all.length ? `(${all.length})` : "")),
      all.length ? h("ul", { class: "traveller-list" }, all.map((t) => this._traveller(sim, t)))
        : h("p", { class: "hint" }, "No travellers yet. Each attendee makes one above."),
    ];
  }

  _traveller(sim, t) {
    const st = sim.status(t), chosen = sim.selected === t.id;
    const expected = st.expected != null && t.state !== "arrived" && t.state !== "home" && Math.abs(st.expected - st.planned) >= 1 ? ` · expected ${hm(st.expected)}` : "";
    return h("li", { class: `traveller${chosen ? " chosen" : ""}`, "data-id": t.id, "aria-current": chosen ? "true" : null },
      h("span", { class: "traveller-badge", style: { background: t.colour, color: textOn(t.colour) }, "aria-hidden": "true" }, String(t.number)),
      h("div", { class: "traveller-body" },
        h("p", { class: "traveller-name" }, h("b", {}, t.name), h("span", { class: "visually-hidden" }, ` (number ${t.number})`),
          h("small", {}, ` ${placeLabel(sim, t.from)} → ${placeLabel(sim, t.to)}`)),
        h("p", { class: `traveller-status ${st.tone}` }, st.text),
        h("p", { class: "traveller-times" }, `${t.state === "home" ? "" : `Left ${hm(t.started ?? t.at(t.leave))} · `}planned arrival ${hm(st.planned)}${expected}`),
        h("div", { class: "row" },
          h("button", { class: "btn small", type: "button", "aria-label": `Show ${t.name}`, "aria-pressed": chosen ? "true" : "false", onclick: () => this.show(t) }, "Show"),
          h("button", { class: "btn small", type: "button", "aria-label": `Start ${t.name} again`, onclick: () => this.restart(t) }, "Start again"),
          h("button", { class: "btn small danger", type: "button", "aria-label": `Remove ${t.name}`, onclick: () => this.remove(t) }, "Remove")),
        h("details", { open: this.open.has(t.id), ontoggle: (ev) => (ev.target.open ? this.open.add(t.id) : this.open.delete(t.id)) },
          h("summary", {}, "Plan and log"),
          legList(t.plan.legs.map((l) => shift(l, t.day * DAY)), t.at(t.leave)),
          t.log.length ? h("ul", { class: "journey-log" }, t.log.map((e) => h("li", {}, h("time", {}, hm(e.t)), h("span", {}, e.text))))
            : h("p", { class: "hint" }, `${TRAVELLER_STATES[t.state] ?? t.state}.`))));
  }

  /** Follow a traveller (flyover), or stop following it. */
  show(t) {
    const sim = this.sim;
    if (sim.selected === t.id && this.app.flyover.following) {
      sim.selected = null;
      this.app.flyover.follow(null);
    } else {
      this.app.followTraveller(t.id);
      if (!sim.positionOf(t.id)) toast(`${t.name} is not on the layout now (${TRAVELLER_STATES[t.state] ?? t.state}); the camera follows when it is.`, 4000);
    }
    this.update();
  }

  restart(t) {
    this.sim.restart(t.id);
    this.app.saveLayout();
    this.update();
  }

  remove(t) {
    this.sim.removeTraveller(t.id);
    this.open.delete(t.id);
    this.app.saveLayout();
    this.update();
  }

  /* ---------------------------------------------------------------- results */

  _results(sim) {
    const rows = sim.results();
    if (!rows.length) return [];
    const arrived = rows.filter((r) => r.state === "arrived");
    const late = arrived.filter((r) => r.delay >= 1);
    const sure = this._removeAll > Date.now();
    return [
      h("h2", {}, "Results"),
      h("p", { class: "hint" }, arrived.length
        ? `${arrived.length} of ${rows.length} arrived, ${late.length} of them late${late.length ? ` (on average ${Math.round(late.reduce((s, r) => s + r.delay, 0) / late.length)} min)` : ""}; ${rows.reduce((s, r) => s + r.missed, 0)} trains missed or cancelled.`
        : "Nobody has arrived yet."),
      h("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": "Results of the journeys" }, h("table", { class: "journey-results" },
        h("thead", {}, h("tr", {}, ["#", "Traveller", "From → to", "Leaves", "Planned", "Arrived", "Delay", "Missed"].map((x) => h("th", { scope: "col" }, x)))),
        h("tbody", {}, rows.map((r) => h("tr", {},
          h("td", {}, String(r.number)),
          h("th", { scope: "row" }, r.name),
          h("td", { class: "wrap" }, `${r.from} → ${r.to}`),
          h("td", {}, hm(r.leave)),
          h("td", {}, hm(r.planned)),
          h("td", {}, r.arrived != null ? hm(r.arrived) : r.expected != null && r.state !== "home" ? `(${hm(r.expected)})` : "–"),
          h("td", { class: r.delay >= 5 ? "bad" : r.delay >= 1 ? "warn" : "" }, r.delay == null ? "–" : r.delay > 0 ? `+${r.delay}` : String(r.delay)),
          h("td", {}, String(r.missed))))))),
      h("p", { class: "hint" }, "Arrived: the real arrival; in brackets the expected one of those still travelling. Delay in clock minutes against the plan."),
      h("div", { class: "row" },
        h("button", { class: "btn small", type: "button", id: "journeysCsv", onclick: () => this.downloadCSV() }, "Download results (CSV)"),
        h("button", { class: "btn small", type: "button", id: "journeysRestart", onclick: () => this.restartAll() }, "Start all again"),
        h("button", { class: "btn small danger", type: "button", id: "journeysClear", onclick: () => this.removeAll() }, sure ? "Click again to remove all" : "Remove all")),
    ];
  }

  downloadCSV() {
    const rows = this.sim?.results() || [];
    const head = ["number", "name", "from", "to", "leaves", "planned_arrival", "arrival", "delay_min", "transfers", "missed", "state"];
    const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lines = rows.map((r) => [r.number, r.name, r.from, r.to, hm(r.leave), hm(r.planned), r.arrived != null ? hm(r.arrived) : "", r.delay ?? "", r.transfers, r.missed, r.state].map(q).join(","));
    download("journeys.csv", `${head.join(",")}\n${lines.join("\n")}\n`, "text/csv");
  }

  /** Every traveller starts again (at its departure time; set the clock back to before it to watch it again). */
  restartAll() {
    const sim = this.sim;
    for (const t of sim.travellers) sim.restart(t.id);
    this.app.saveLayout();
    const first = Math.min(...sim.travellers.map((t) => t.leave));
    toast(first < this.world.clock.minutes ? `All start again. Set the clock to ${hm(first - 5)} (Simulate) to watch them from their departure.` : "All start again.", 6000);
    this.update();
  }

  /** Remove all travellers: the first click asks, the second one (within a few seconds) does it. */
  removeAll() {
    if (this._removeAll < Date.now()) {
      this._removeAll = Date.now() + 4000;
      setTimeout(() => this.update(), 4100);
      return this.update();
    }
    this._removeAll = 0;
    const sim = this.sim;
    for (const t of [...sim.travellers]) sim.removeTraveller(t.id);
    this.open.clear();
    this.app.saveLayout();
    toast("All travellers removed.");
    this.update();
  }
}

/** A leg's times moved by `by` minutes (the plan of a traveller is kept relative to its day). */
function shift(l, by) {
  return { ...l, dep: l.dep + by, arr: l.arr + by };
}

/** The name of a start or aim. */
function placeLabel(sim, ref) {
  if (ref?.kind === "building") return sim.world.getObject(ref.id)?.name ?? ref.id;
  return sim.rail().station(ref?.id)?.name ?? ref?.id ?? "?";
}

/** The legs of a plan as a list: when, how and where, with the time for each change between vehicles. */
function legList(legs, start) {
  const items = [];
  let t = start;
  legs.forEach((l, i) => {
    if (l.type === "walk") {
      items.push(h("li", { class: "leg walk" }, h("time", {}, hm(l.dep)), h("span", {}, `Walk ${minutes(l.min)} to ${l.toName}`)));
    } else if (l.type === "bus") {
      const wait = l.dep - t;
      items.push(h("li", { class: "leg bus" }, h("time", {}, `~${hm(l.dep)}`),
        h("span", {}, h("span", { class: "line-badge", style: { background: l.colour, color: textOn(l.colour) } }, l.label), ` ${l.towards} from ${l.fromName} to ${l.toName}`,
          h("small", {}, ` · every ${l.every} min${wait >= 1 ? ` · waits about ${minutes(wait)}` : ""} · off about ${hm(l.arr)}`))));
    } else if (l.type === "train") {
      items.push(h("li", { class: "leg train" }, h("time", {}, hm(l.dep)),
        h("span", {}, h("span", { class: "line-badge train" }, l.name), ` → ${l.towards}${l.platform ? `, ${l.platform}` : ` from ${l.fromName}`}`,
          h("small", {}, ` · arrives ${l.toName}${l.toPlatform ? ` (${l.toPlatform})` : ""} ${hm(l.arr)}`))));
    }
    // the next vehicle: the time to change to it
    const next = l.type === "walk" ? null : legs.slice(i + 1).find((x) => x.type !== "walk");
    if (next) items.push(h("li", { class: "leg change" }, h("time", {}, ""), h("span", {}, `Change at ${l.toPlatform ?? l.toName}: ${minutes(next.dep - l.arr)}`)));
    t = l.arr;
  });
  return h("ol", { class: "legs" }, items);
}
