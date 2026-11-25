// The Overview chapter: what the app measures, in a few figures (Measured: the weather, the town, the
// trips from door to door, the people waiting at the stops, the trains of a control system, the
// tracking), and the state of what the simulations keep (assets, people, vehicles; core/states.js):
// one figure for the whole layout, a search, and per kind its mean and a histogram, the worst and the
// best kind first. What can be set is in Settings; the modules are switched in Examples → Sandbox.
import { formatTime, MockFeed, MODES, MODE_KEYS, objectPickable, overallState, RAIL_CONDITIONS, searchKinds, searchStates, terminalOf } from "../arail/index.js";
import { download, h, morph, mount, section, toast } from "./ui.js";

/** At most this many items found are listed. */
const SEARCH_LIMIT = 30;
const pct = (x) => `${Math.round(x * 100)} %`;

export class Overview {
  /** @param {import("./app.js").App} app */
  constructor(app) {
    this.app = app;
    /** What is searched for. */
    this.query = "";
    /** All kinds shown (else the worst and the best). */
    this.all = false;
    this.el = null;
    this.stateBox = null;
    this.measureBox = null;
  }

  render(el) {
    this.el = el;
    // a control that had the focus gets it back
    const focused = el.contains(document.activeElement) ? document.activeElement.id : null;
    this.stateBox = h("div", { class: "states", "aria-live": "off" });
    this.measureBox = h("div", { class: "measures", id: "measures", "aria-live": "off" });
    const search = h("input", {
      type: "search", id: "stateSearch", value: this.query, placeholder: "Search assets and people", autocomplete: "off",
      oninput: (e) => { this.query = e.target.value; this.update(); },
    });
    mount(el,
      section("Measured", this.measureBox),
      section("State",
        h("label", { class: "field", for: "stateSearch" }, h("span", { class: "visually-hidden" }, "Search assets and people"), search),
        this.stateBox),
    );
    this.update();
    if (focused) document.getElementById(focused)?.focus();
  }

  /** The figures, every 400 ms while the chapter is shown (the search field and buttons keep the focus). */
  update() {
    if (!this.stateBox?.isConnected) return;
    const measures = this.measures();
    morph(this.measureBox, measures.length
      ? measures.map((m) => h("article", { class: "measure", "data-measure": m.id },
        h("h3", {}, m.label), h("p", { class: "measure-value" }, m.value), m.note ? h("p", { class: "measure-note" }, m.note) : null, m.action ?? null))
      : h("p", { class: "hint" }, "Nothing measured yet: switch on a module, or start the camera."));
    const st = overallState(this.app.world);
    if (!st.groups.length) {
      morph(this.stateBox, h("p", { class: "hint" }, "Nothing to rate yet: switch on a module, or add stops and people."));
      return;
    }
    const q = this.query.trim();
    morph(this.stateBox,
      h("div", { class: "kpi" },
        h("span", { class: "kpi-value" }, pct(st.mean)),
        h("span", { class: "kpi-text" }, `Mean state · ${st.count} assets and people`)),
      q ? this._found(st.groups, q) : this._kinds(st.groups),
    );
  }

  /**
   * What the app measures, each in one figure and a short note: only what this layout has and what
   * runs (the weather with a date or weather, the town, its trips from door to door, the stops, a
   * control system, the tracking of a camera image, the model wagons with tags).
   * @returns {Array<{id: string, label: string, value: string, note?: string, action?: HTMLElement}>}
   */
  measures() {
    const app = this.app, w = app.world, c = w.clock, out = [];
    if (w.weather.on || c.date != null) {
      const sun = c.sun(), n = w.weather.on ? w.weather.now() : null;
      const ground = !n ? null : n.snow_cm > 0.5 ? `${Math.round(n.snow_cm)} cm of snow` : n.ice ? "ice on the ground" : n.wet > 0.3 ? "wet ground" : "dry ground";
      out.push({ id: "weather", label: "Weather", value: w.weather.on ? w.weather.describe() : c.dateLabel(),
        note: [n ? `Rails: ${RAIL_CONDITIONS[w.weather.railCondition()].label}` : null, ground, c.date != null ? `Sunrise ${formatTime(sun.rise)}` : null, c.date != null ? `Sunset ${formatTime(sun.set)}` : null].filter(Boolean).join(" · ") });
    }
    const town = w.simulations.find((x) => x.constructor.type === "town");
    if (town) {
      const st = town.townStats();
      out.push({ id: "town", label: "Town", value: `${st.total} people`, note: `${st.walking} on their way · ${st.riding} on the bus · ${st.cycling} by bike · ${st.driving} by car` });
      const split = town.modalSplit(), long = town.modalSplit({ long: true });
      if (split.trips) {
        out.push({ id: "modes", label: "Modal split", value: `${Math.round(split.shares.walk * 100)} % on foot`,
          note: `${MODE_KEYS.filter((m) => m !== "walk").map((m) => `${MODES[m].label} ${Math.round(split.shares[m] * 100)} %`).join(" · ")} · of ${split.trips} trips${long.trips ? `; of the ${long.trips} longer ways ${Math.round(long.shares.walk * 100)} % on foot` : ""}` });
      }
      const jams = split.modes.car ? Math.round(split.bad.car * 100) : null;
      if (w.experience.known) {
        const now = (m) => w.experience.ratio(m, c.minutes, c.weekend());
        out.push({ id: "learned", label: "What the town has learned", value: `Car ${now("car").toFixed(1)}×`, note: `how long a drive takes now against empty streets · bus and tram ${now("transit").toFixed(1)}× their timetable${jams != null ? ` · ${jams} % of the drives were a jam` : ""} · ${Math.round(w.experience.days)} days` });
      }
      const all = town.tripStats()[0];
      out.push({ id: "trips", label: "Door to door", value: all ? `${Math.round(all.minutes)} min` : "–", note: all ? `mean of ${all.trips} trips` : "No trip finished yet",
        action: all ? h("button", { class: "btn small", type: "button", id: "townTripsCsv", onclick: () => download("town-trips.csv", town.tripsCSV(), "text/csv") }, "Download the trips (CSV)") : null });
    }
    const areas = w.stopAreas(), sim = w.simulations.find((x) => x.constructor.type === "passengers" && x.enabled !== false);
    if (areas.length && sim) {
      let waiting = 0, mood = 0;
      for (const a of areas) {
        const s = sim.stats(a.id);
        if (s) { waiting += s.count; mood += s.count * s.mood; }
      }
      out.push({ id: "stops", label: "At the stops", value: `${waiting} waiting`, note: waiting ? `mood ${Math.round((100 * mood) / waiting)} %` : `${areas.length} stops` });
    }
    const f = app.feed, trains = w.trains;
    if (f) out.push({ id: "trains", label: "Control system", value: `${trains.trains.size} trains`, note: f instanceof MockFeed ? "simulated" : f.status === "connected" ? `${f.messages} messages` : f.status === "connecting" ? "connecting" : "not connected" });
    const st = app.tracker?.state;
    if (app.source && st) out.push({ id: "tracking", label: "Tracking", value: `${st.visible.length} markers`, note: st.used.length ? `pose from ${st.used.length}, error ${st.rms.toFixed(1)} px` : "no pose yet" });
    const rolling = w.layout.markers.rolling ? [...(terminalOf(w)?.rolling?.wagons.values() || [])] : null;
    if (rolling && app.source) out.push({ id: "wagons", label: "Model wagons", value: `${rolling.filter((x) => x.state !== "lost").length} of ${rolling.length}`, note: "seen by their tags" });
    return out;
  }

  /** No search: the worst and the best kind, or all of them. */
  _kinds(groups) {
    const shown = this.all || groups.length <= 2 ? groups : [groups[0], groups[groups.length - 1]];
    return [
      h("div", { class: "kinds" }, shown.map((g, i) => this._kind(g, !this.all && groups.length > 2 ? (i ? "Best" : "Worst") : null))),
      groups.length > 2 ? h("button", { class: "btn small", type: "button", id: "statesAll", "aria-expanded": this.all ? "true" : "false", onclick: () => { this.all = !this.all; this.update(); } },
        this.all ? "Show the worst and the best" : `Show all ${groups.length} kinds`) : null,
    ];
  }

  /** A search: the kinds of that name, and the items found, the worst first. */
  _found(groups, q) {
    const kinds = searchKinds(groups, q);
    const items = searchStates(groups, q, Infinity);
    return [
      kinds.length ? h("div", { class: "kinds" }, kinds.map((g) => this._kind(g))) : null,
      h("p", { class: "hint", role: "status" }, items.length ? (items.length > SEARCH_LIMIT ? `${items.length} found; the ${SEARCH_LIMIT} worst:` : `${items.length} found`) : "Nothing found."),
      items.length ? h("ul", { class: "state-items" }, items.slice(0, SEARCH_LIMIT).map((it) => h("li", {}, this._item(it, it.group)))) : null,
    ];
  }

  /** A kind: its name, how many, its mean, its histogram (0–100 % across; up to the fullest bin) and its worst item. */
  _kind(g, badge = null) {
    const n = g.items.length, top = Math.max(1, ...g.bins);
    const bins = g.bins.map((c, i) => {
      const range = `${i * 10}–${(i + 1) * 10} %`;
      return h("span", { class: `bin${c ? "" : " empty"}`, style: { height: `${(100 * c) / top}%` }, title: `${range}: ${c} of ${n}` });
    });
    return h("article", { class: "kind", "data-kind": g.id },
      h("p", { class: "kind-badge" }, badge ? `${badge} · ${n}` : String(n)),
      h("header", {}, h("h3", {}, g.label), h("span", { class: "kind-value" }, pct(g.mean))),
      h("div", { class: "histogram", role: "img", "aria-label": `${g.label}: ${n} by ${g.measure || "state"}, from 0 % (left) to 100 % (right): ${g.bins.join(", ")}` },
        h("div", { class: "bins" }, bins),
        h("div", { class: "axis", "aria-hidden": "true" }, h("span", {}, "0 %"), h("span", {}, "50 %"), h("span", {}, "100 %"))),
      g.worst && g.mean < 0.999 ? h("p", { class: "kind-foot" }, "Worst: ", this._item(g.worst, null, true), g.worst.text ? [" (", h("span", {}, g.worst.text), ")"] : null) : null,
    );
  }

  /** An item: its name (a button that opens its card, if it has one), its state in words and its score. */
  _item(it, group = null, inline = false) {
    const meta = [group, it.text].filter(Boolean);
    const label = [h("span", { class: "item-name", translate: "no" }, it.name), meta.length ? h("span", { class: "item-text" }, meta.map((t, i) => [i ? " · " : null, h("span", {}, t)])) : null];
    const body = inline ? [h("span", { translate: "no" }, it.name)] : [...label, h("span", { class: "item-score" }, pct(it.score))];
    return it.key
      ? h("button", { class: inline ? "link" : "state-item", type: "button", onclick: () => this.open(it) }, body)
      : h("span", { class: inline ? "" : "state-item" }, body);
  }

  /** Open the card of an item (as a tap on it on the stage would). */
  open(it) {
    const app = this.app, w = app.world;
    const hit = (app.lastView && w.findPickable(app.lastView, it.key)) || (it.key.startsWith("object:") && w.getObject(it.key.slice(7)) ? objectPickable(w.getObject(it.key.slice(7))) : null);
    if (hit) app.inspector.show(hit);
    else toast(`${it.name} is not in the picture right now.`);
  }
}
