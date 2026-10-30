// The Interaction chapter: the scenarios to start (cases.js), as a list with filter pills (First
// steps, the sides Infrastructure and Railway undertaking, Passengers, Freight, Tools), and the
// scenario shown: the way back to the list, its name, its task with the progress and Start (or
// Start again), and its panel. Start sets up the stage for it (its module, its view).
import { SIDES, TAGS } from "./cases.js";
import { icon } from "./icons.js";
import { h, morph, mount, storage } from "./ui.js";

/** The list of scenarios: what Interaction shows when no scenario is (app.activeCase). */
export const LIST = "scenarios";
/** The pill that shows all scenarios. */
const ALL = { id: "all", label: "All" };

export class Interaction {
  /** @param {import("./app.js").App} app */
  constructor(app) {
    this.app = app;
    /** The pill chosen: a tag (TAGS) or "all"; kept in the browser. */
    this.filter = storage.get(app.key("scenarioFilter"), ALL.id);
  }

  /** The pills there are: All, then the tags the page's cases have, in their order. */
  pills() {
    return [ALL, ...TAGS.filter((t) => this.app.cases.some((c) => c.tags.includes(t.id)))];
  }

  /** The cases the pill chosen shows, in the page's order. */
  shown() {
    const f = this.pills().some((p) => p.id === this.filter) ? this.filter : ALL.id;
    return this.app.cases.filter((c) => f === ALL.id || c.tags.includes(f));
  }

  /** Choose a pill. */
  choose(tag) {
    this.filter = tag;
    storage.set(this.app.key("scenarioFilter"), tag);
    this.renderIfShown();
    document.getElementById(`pill-${tag}`)?.focus();
  }

  /** Draw the chapter anew; a control that had the focus gets it back. @param {HTMLElement} el */
  render(el) {
    const app = this.app;
    const focused = el.contains(document.activeElement) ? document.activeElement.id : null;
    const shown = app.caseById(app.activeCase);
    if (!shown) {
      mount(el, this._list());
      if (focused) document.getElementById(focused)?.focus();
      return;
    }
    const panel = h("div", { class: "case-panel", id: "casePanel" });
    this.taskBox = h("div", { class: "scenario-task", id: "scenarioTask", role: "group", "aria-labelledby": "scenarioName" });
    mount(el, h("div", { class: "interaction", "data-case": shown.id },
      h("div", { class: "scenario-head" },
        h("button", { class: "btn small scenario-back", type: "button", id: "scenariosBack", onclick: () => this.back() },
          h("span", { "aria-hidden": "true" }, "← "), "Scenarios"),
        h("p", { class: "scenario-side" }, this._tagText(shown)),
        h("h2", { class: "scenario-name", id: "scenarioName", tabindex: "-1" }, shown.label)),
      this.taskBox,
      panel));
    this._task(shown);
    shown.render(panel);
    if (focused) document.getElementById(focused)?.focus();
  }

  /** Draw the chapter again if it is shown (a module switched). */
  renderIfShown() {
    if (this.app.activeTab === "interaction") this.app.renderPanel("interaction");
  }

  /** Every 400 ms while shown: the task's progress and the case's live figures. */
  update() {
    const c = this.app.caseById(this.app.activeCase);
    if (!c) return;
    if (this.taskBox?.isConnected) this._task(c);
    c.update();
  }

  /** Back to the list of scenarios; the one left has the focus there. */
  back() {
    const from = this.app.activeCase;
    this.app.selectTab(LIST);
    document.getElementById(`scenario-${from}`)?.focus();
  }

  /** Outline what the scenario shown is about (the app draws it after the stage, camera view and flyover). */
  drawFocus(ctx, view) {
    this.app.shownCase?.panel?.drawFocus?.(ctx, view);
  }

  /* ---------------------------------------------------------------- the list */

  _list() {
    const pills = this.pills(), shown = this.shown(), filter = pills.some((p) => p.id === this.filter) ? this.filter : ALL.id;
    return h("div", { class: "scenarios" },
      h("div", { class: "section" },
        h("h2", { id: "scenariosTitle", tabindex: "-1" }, "Scenarios"),
        h("p", { class: "hint" }, "Each scenario sets up the stage and gives you a small task to try."),
        pills.length > 2 ? h("div", { class: "pills", role: "group", "aria-label": "Filter the scenarios" },
          pills.map((p) => h("button", { type: "button", class: "pill", id: `pill-${p.id}`, "aria-pressed": p.id === filter ? "true" : "false", onclick: () => this.choose(p.id) }, p.label))) : null),
      h("ul", { class: "scenario-list", "aria-labelledby": "scenariosTitle" }, shown.map((c) => h("li", {}, this._card(c)))));
  }

  /**
   * A scenario as a card to click: its icon, its side or kind, its name and what it is about; its
   * task, or that it is done. Its accessible name is its side and name, what it is about describes it.
   */
  _card(c) {
    const id = `scenario-${c.id}`, p = c.started ? c.progress() : null;
    const state = c.done ? "Done" : p ? `${p.done} of ${p.of}` : !c.startable ? "Not in this layout" : null;
    return h("button", {
      type: "button", class: `scenario-card${c.startable ? "" : " off"}`, id, "aria-labelledby": `${id}-tag ${id}-name`, "aria-describedby": `${id}-text`,
      "aria-current": c.started ? "true" : null, onclick: () => this.app.startCase(c.id),
    },
    icon(c.constructor.icon, "scenario-icon"),
    h("span", { class: "scenario-tag", id: `${id}-tag` }, this._tagText(c)),
    h("span", { class: "scenario-name", id: `${id}-name` }, c.label),
    h("span", { class: "scenario-text", id: `${id}-text` }, c.constructor.description, state ? [" (", h("span", { class: "scenario-state" }, state), ")"] : null));
  }

  /** The side of a case, else its first tag ("Railway undertaking", "First steps", "Tools"). */
  _tagText(c) {
    return (SIDES.find((s) => s.id === c.side) ?? TAGS.find((t) => c.tags.includes(t.id)))?.label ?? "";
  }

  /* ---------------------------------------------------------------- the task */

  /** The task of the case shown: what to do and how, its progress, Start or Start again. */
  _task(c) {
    const C = c.constructor, p = c.started ? c.progress() : null, pct = p?.of ? Math.round((100 * Math.min(p.done, p.of)) / p.of) : 0;
    const figures = c.started ? c.figures() : null;
    const start = h("button", {
      class: `btn${c.started ? "" : " primary"}`, type: "button", id: "scenarioStart", disabled: !c.startable,
      onclick: () => this.app.startCase(c.id),
    }, c.started ? "Start again" : "Start");
    // in place: Start keeps the focus while the progress changes
    morph(this.taskBox,
      C.task ? h("p", { class: "task-line" }, h("strong", {}, "Task"), ": ", C.task) : h("p", { class: "task-line" }, C.description),
      C.how ? h("p", { class: "hint" }, C.how) : null,
      p ? h("div", { class: "task-progress" },
        h("div", { class: "story-progress", role: "progressbar", "aria-labelledby": "scenarioName", "aria-valuemin": "0", "aria-valuemax": String(p.of), "aria-valuenow": String(Math.min(p.done, p.of)), "aria-valuetext": `${Math.min(p.done, p.of)} of ${p.of}` }, h("i", { style: { width: `${pct}%` } })),
        h("span", { class: "task-count" }, `${Math.min(p.done, p.of)} of ${p.of}`)) : null,
      figures ? h("dl", { class: "task-figures" }, figures.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v)))) : null,
      c.done ? h("p", { class: "task-done", role: "status" }, "Done! Try another scenario, or start this one again.") : null,
      h("div", { class: "row" }, start, C.speed && c.started ? h("span", { class: "hint" }, `The clock runs ${C.speed} times as fast.`) : null));
  }
}
