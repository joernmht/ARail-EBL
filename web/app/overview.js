// The Overview chapter: the state of what the simulations keep (assets, people, vehicles;
// core/states.js): one figure for the whole layout, a search, and per kind its mean and a histogram,
// the worst and the best kind first. The modules are switched in Interaction.
import { objectPickable, overallState, searchKinds, searchStates } from "../arail/index.js";
import { h, morph, mount, section, toast } from "./ui.js";

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
    // a control that had the focus gets it back
    const focused = el.contains(document.activeElement) ? document.activeElement.id : null;
    this.stateBox = h("div", { class: "states", "aria-live": "off" });
    const search = h("input", {
      type: "search", id: "stateSearch", value: this.query, placeholder: "Search assets and people", autocomplete: "off",
      oninput: (e) => { this.query = e.target.value; this.update(); },
    });
    mount(el,
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
}
