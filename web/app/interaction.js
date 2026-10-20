// The Interaction chapter: a strip at its side (Modules, the sides Infrastructure and Railway
// undertaking, the tools of the layout), the cases of the side chosen as tabs, and the case shown
// (cases.js). Modules: the layout's modules and the app's, as boxes to switch on and off.
import { SIDES } from "./cases.js";
import { h, mount } from "./ui.js";

/** Icons by what they stand for: line drawings in the colour of the text. */
export const ICONS = {
  operations: '<svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="14" rx="3"/><path d="M6 10h12M9.5 13.5h.01M14.5 13.5h.01M8 21l2-4M16 21l-2-4"/></svg>',
  infrastructure: '<svg viewBox="0 0 24 24"><rect x="8.5" y="2.5" width="7" height="12" rx="3.5"/><circle cx="12" cy="6.2" r="1.4"/><circle cx="12" cy="10.8" r="1.4"/><path d="M12 14.5V21M8 21h8"/></svg>',
  journeys: '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="5.5" r="2.5"/><path d="M8 18.5h6.5a3 3 0 0 0 0-6h-5a3 3 0 0 1 0-6H16" stroke-dasharray="2.2 2.2"/></svg>',
  terminal: '<svg viewBox="0 0 24 24"><path d="M3 21V5h18v16M3 8h18"/><path d="M12 8v5"/><rect x="9" y="13" width="6" height="4" rx=".5"/><path d="M6 21v-2h12v2"/></svg>',
  layout: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="14" height="10" rx="1"/><path d="M6.5 7v10M10 7v10M13.5 7v10M14 3.5h6.5V10M20.5 3.5 15 9"/></svg>',
  module: '<svg viewBox="0 0 24 24"><path d="M12 3 21 8l-9 5-9-5 9-5Z"/><path d="m3 12.5 9 5 9-5M3 16.5l9 5 9-5"/></svg>',
  build: '<svg viewBox="0 0 24 24"><path d="M3.5 20.5 4.6 16 15.8 4.8a2.1 2.1 0 0 1 3 3L7.6 19l-4.1 1.5Z"/><path d="m14 6.6 3 3M3 20.9h18"/></svg>',
  disruptions: '<svg viewBox="0 0 24 24"><path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5M12 17.2h.01"/></svg>',
};
/** The icon of a module by the simulations of its layer. */
const SIM_ICONS = {
  operations: "operations", "ops-story": "operations", infrastructure: "infrastructure", "maintenance-story": "infrastructure", journeys: "journeys", "journeys-story": "journeys", terminal: "terminal",
};
/** The strip's first entry. */
const MODULES = { id: "modules", label: "Modules", description: "Switch the modules of the layout on and off", icon: "module" };

/** An icon (aria-hidden: the text next to it names it). */
function icon(key, cls) {
  const el = h("span", { class: cls, "aria-hidden": "true" });
  el.innerHTML = ICONS[key] ?? ICONS.module;
  return el;
}

export class Interaction {
  /** @param {import("./app.js").App} app */
  constructor(app) {
    this.app = app;
    /** The case chosen last on each side. */
    this.last = new Map();
  }

  /** The strip's entries: Modules, the sides that have cases, then the tools (cases without a side). */
  entries() {
    const cases = this.app.cases;
    const tools = cases.filter((c) => !c.side).map((c) => ({ id: c.id, label: c.label, description: c.constructor.description, icon: c.constructor.icon, tool: true }));
    return [MODULES, ...SIDES.filter((s) => cases.some((c) => c.side === s.id)), ...tools];
  }

  /** The strip's entry of what is shown: a case's side, a tool itself, else Modules. */
  entryOf(id) {
    const c = this.app.caseById(id);
    return c ? c.side ?? c.id : MODULES.id;
  }

  /** The cases of a side, in the page's order. */
  casesOf(side) {
    return this.app.cases.filter((c) => c.side === side);
  }

  /** Choose an entry of the strip: a side shows its case chosen last, else its first one that is on. */
  choose(entry) {
    const cases = this.casesOf(entry);
    const id = cases.length ? (this.last.get(entry) ?? (cases.find((c) => c.ready) ?? cases[0]).id) : entry;
    this.app.selectTab(id);
  }

  /** Draw the chapter anew; a control that had the focus gets it back. @param {HTMLElement} el */
  render(el) {
    const app = this.app;
    const focused = el.contains(document.activeElement) ? document.activeElement.id : null;
    const shown = app.caseById(app.activeCase), entry = this.entryOf(app.activeCase);
    const entries = this.entries();
    const strip = h("div", { class: "strip", role: "tablist", "aria-orientation": "vertical", "aria-label": "Interaction", onkeydown: (e) => this._key(e, entries.map((x) => x.id), (id) => this.choose(id), "strip", ["ArrowUp", "ArrowDown"]) },
      entries.map((x, i) => h("button", {
        type: "button", role: "tab", id: `strip-${x.id}`, class: `strip-item${x.tool && !entries[i - 1]?.tool ? " first-tool" : ""}`,
        "aria-selected": x.id === entry ? "true" : "false", "aria-controls": "interactionBody", tabindex: x.id === entry ? "0" : "-1", title: x.description,
        onclick: () => this.choose(x.id),
      }, icon(x.icon, "strip-icon"), h("span", { class: "strip-label" }, x.label))));
    const side = shown?.side ? SIDES.find((s) => s.id === shown.side) : null;
    const panel = h("div", { class: "case-panel", id: "casePanel" });
    const body = h("div", { class: "interaction-body", role: "tabpanel", id: "interactionBody", "aria-labelledby": `strip-${entry}` });
    if (side) {
      const cases = this.casesOf(side.id);
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `case-${shown.id}`);
      mount(body,
        h("div", { class: "case-tabs", role: "tablist", "aria-label": side.label, onkeydown: (e) => this._key(e, cases.map((c) => c.id), (id) => app.selectTab(id), "case", ["ArrowLeft", "ArrowRight"]) },
          cases.map((c) => h("button", {
            type: "button", role: "tab", id: `case-${c.id}`, "aria-selected": c === shown ? "true" : "false", "aria-controls": "casePanel",
            tabindex: c === shown ? "0" : "-1", title: c.constructor.description || null, onclick: () => app.selectTab(c.id),
          }, c.label))),
        panel);
    } else mount(body, panel);
    mount(el, h("div", { class: "interaction" }, strip, body));
    if (shown) shown.render(panel);
    else mount(panel, this._modules());
    if (focused) document.getElementById(focused)?.focus();
  }

  /** Draw the chapter again if it is shown (a module switched). */
  renderIfShown() {
    if (this.app.activeTab === "interaction") this.app.renderPanel("interaction");
  }

  /** Every 400 ms while shown: the case's live figures. */
  update() {
    this.app.caseById(this.app.activeCase)?.update();
  }

  /** Arrows (and Home, End) go from tab to tab of the strip or of the cases; the one chosen keeps the focus. */
  _key(e, ids, go, prefix, [back, on]) {
    const from = e.target.closest?.("[role=tab]")?.id.slice(prefix.length + 1);
    const i = ids.indexOf(from);
    if (i < 0) return;
    const to = e.key === on ? ids[(i + 1) % ids.length] : e.key === back ? ids[(i - 1 + ids.length) % ids.length] : e.key === "Home" ? ids[0] : e.key === "End" ? ids[ids.length - 1] : null;
    if (!to) return;
    e.preventDefault();
    e.stopPropagation();
    go(to);
    document.getElementById(`${prefix}-${to}`)?.focus();
  }

  /** Modules: the boxes of the layout's modules and the app's. */
  _modules() {
    return h("div", { class: "section" },
      h("h2", { tabindex: "-1" }, "Modules"),
      h("div", { class: "modules", role: "group", "aria-label": "Modules" }, this.app.modules().map((m) => this._moduleBox(m))));
  }

  /**
   * A module as a box to click (a toggle button): its icon and its name, Orange when on, "Alone"
   * for one that opens alone. Its accessible name is the module's name; what it adds describes it
   * (and is its tooltip).
   */
  _moduleBox(m) {
    const id = `module-${m.id}`;
    const key = m.icon ?? (m.layout ? "layout" : Object.entries(SIM_ICONS).find(([t]) => m.simulations?.includes(t))?.[1] ?? "module");
    return h("button", {
      type: "button", class: `module${m.exclusive ? " exclusive" : ""}`, id, "aria-pressed": m.enabled ? "true" : "false", title: m.description || null,
      "aria-labelledby": `${id}-name`, "aria-describedby": m.description ? `${id}-text` : null,
      onclick: () => this.app.toggleModule(m.id),
    },
    icon(key, "module-icon"),
    h("span", { class: "module-name", id: `${id}-name` }, m.name),
    m.exclusive ? h("span", { class: "module-state", "aria-hidden": "true" }, "Alone") : null,
    // what it adds: for screen readers and as the tooltip, not as text in the box
    m.description ? h("span", { class: "visually-hidden", id: `${id}-text` }, m.description) : null);
  }
}
