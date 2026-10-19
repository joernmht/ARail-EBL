// The Overview tab: the modules to switch on and off, and the state of what the simulations keep
// (assets, people, vehicles; core/states.js): one figure for the whole layout, a search, and per
// kind its mean and a histogram, the worst and the best kind first.
import { objectPickable, overallState, searchKinds, searchStates } from "../arail/index.js";
import { h, morph, mount, section, toast } from "./ui.js";

/** Icons of the modules (by what they add): line drawings in the colour of the text. */
const MODULE_ICONS = {
  operations: '<svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="14" rx="3"/><path d="M6 10h12M9.5 13.5h.01M14.5 13.5h.01M8 21l2-4M16 21l-2-4"/></svg>',
  infrastructure: '<svg viewBox="0 0 24 24"><rect x="8.5" y="2.5" width="7" height="12" rx="3.5"/><circle cx="12" cy="6.2" r="1.4"/><circle cx="12" cy="10.8" r="1.4"/><path d="M12 14.5V21M8 21h8"/></svg>',
  journeys: '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="5.5" r="2.5"/><path d="M8 18.5h6.5a3 3 0 0 0 0-6h-5a3 3 0 0 1 0-6H16" stroke-dasharray="2.2 2.2"/></svg>',
  layout: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="14" height="10" rx="1"/><path d="M6.5 7v10M10 7v10M13.5 7v10M14 3.5h6.5V10M20.5 3.5 15 9"/></svg>',
  module: '<svg viewBox="0 0 24 24"><path d="M12 3 21 8l-9 5-9-5 9-5Z"/><path d="m3 12.5 9 5 9-5M3 16.5l9 5 9-5"/></svg>',
  build: '<svg viewBox="0 0 24 24"><path d="M3.5 20.5 4.6 16 15.8 4.8a2.1 2.1 0 0 1 3 3L7.6 19l-4.1 1.5Z"/><path d="m14 6.6 3 3M3 20.9h18"/></svg>',
  disruptions: '<svg viewBox="0 0 24 24"><path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5M12 17.2h.01"/></svg>',
};
/** The icon of a module by the simulations of its layer. */
const SIM_ICONS = { operations: "operations", infrastructure: "infrastructure", "maintenance-story": "infrastructure", journeys: "journeys", "journeys-story": "journeys" };
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
  }

  render(el) {
    this.el = el;
    const app = this.app;
    // a control that had the focus (the box of a module just switched) gets it back
    const focused = el.contains(document.activeElement) ? document.activeElement.id : null;
    this.stateBox = h("div", { class: "states", "aria-live": "off" });
    const search = h("input", {
      type: "search", id: "stateSearch", value: this.query, placeholder: "Search assets and people", autocomplete: "off",
      oninput: (e) => { this.query = e.target.value; this.update(); },
    });
    mount(el,
      section("Modules", h("div", { class: "modules", role: "group", "aria-label": "Modules" }, app.modules().map((m) => this._moduleBox(m)))),
      section("State",
        h("label", { class: "field", for: "stateSearch" }, h("span", { class: "visually-hidden" }, "Search assets and people"), search),
        this.stateBox),
    );
    this.update();
    if (focused) document.getElementById(focused)?.focus();
  }

  /** Draw the Overview again if it is shown (a module switched). */
  renderIfShown() {
    if (this.app.activeTab === "overview" && this.el?.isConnected) this.render(this.el);
  }

  /** The figures, every 400 ms while the tab is shown (the search field and buttons keep the focus). */
  update() {
    if (!this.stateBox?.isConnected) return;
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

  /**
   * A module as a box to click (a toggle button): its icon and its name, Orange when on, "Alone"
   * for one that opens alone. Its accessible name is the module's name; what it adds describes it
   * (and is its tooltip).
   */
  _moduleBox(m) {
    const id = `module-${m.id}`;
    const icon = m.icon ?? (m.layout ? "layout" : Object.entries(SIM_ICONS).find(([t]) => m.simulations?.includes(t))?.[1] ?? "module");
    const box = h("button", {
      type: "button", class: `module${m.exclusive ? " exclusive" : ""}`, id, "aria-pressed": m.enabled ? "true" : "false", title: m.description || null,
      "aria-labelledby": `${id}-name`, "aria-describedby": m.description ? `${id}-text` : null,
      onclick: () => this.app.toggleModule(m.id),
    },
    h("span", { class: "module-icon", "aria-hidden": "true" }),
    h("span", { class: "module-name", id: `${id}-name` }, m.name),
    m.exclusive ? h("span", { class: "module-state", "aria-hidden": "true" }, "Alone") : null,
    // what it adds: for screen readers and as the tooltip, not as text in the box
    m.description ? h("span", { class: "visually-hidden", id: `${id}-text` }, m.description) : null);
    box.firstChild.innerHTML = MODULE_ICONS[icon];
    return box;
  }
}
