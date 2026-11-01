// The Interaction chapter: the scenarios to start (cases.js), as a list with filter pills (First
// steps, the sides Infrastructure and Railway undertaking, Passengers, Freight, Tools), and the
// scenario shown, light in text: the way back to the list, its name, Start until it is started, then
// the bar of its task (and its figures), and its panel. What a scenario is about is said in the list.
// Start sets up the stage for it (its module, its view).
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
    this.taskBox = h("div", { class: "scenario-task", id: "scenarioTask" });
    mount(el, h("div", { class: "interaction", "data-case": shown.id },
      h("div", { class: "scenario-head" },
        h("button", { class: "btn small scenario-back", type: "button", id: "scenariosBack", onclick: () => this.back() },
          h("span", { "aria-hidden": "true" }, "← "), "Scenarios"),
        h("h2", { class: "scenario-name", id: "scenarioName", tabindex: "-1" }, shown.label)),
      this.taskBox,
      panel));
    this._task(shown);
    shown.render(panel);
    // Start is gone once started: its name takes the focus
    if (focused) (document.getElementById(focused) ?? document.getElementById("scenarioName"))?.focus();
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
   * A scenario as a card to click: its icon, its side or kind, its name and what it is about, and
   * that it was done (one scenario runs at a time: going back to the list ends it). Its accessible
   * name is its side and name, what it is about describes it.
   */
  _card(c) {
    const id = `scenario-${c.id}`;
    const state = c.completed ? "Done" : !c.startable ? "Not in this layout" : null;
    return h("button", {
      type: "button", class: `scenario-card${c.startable ? "" : " off"}`, id, "aria-labelledby": `${id}-tag ${id}-name`, "aria-describedby": `${id}-text`,
      onclick: () => this.app.startCase(c.id),
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

  /**
   * The task of the case shown: Start until it is started; then the bar of its progress with how far
   * it is (Done at its end) and its figures (the time, the moves). A case whose panel shows its steps
   * on a bar of its own (a story, the film: `steps`) has none here.
   */
  _task(c) {
    const C = c.constructor;
    if (!c.started) {
      this.taskBox.hidden = false;
      // in place: Start keeps the focus
      morph(this.taskBox, h("div", { class: "row" },
        h("button", { class: "btn primary", type: "button", id: "scenarioStart", disabled: !c.startable, onclick: () => this.app.startCase(c.id) }, "Start")));
      return;
    }
    const p = C.steps ? null : c.progress(), figures = c.figures();
    this.taskBox.hidden = !p && !figures;
    const n = p ? Math.min(p.done, p.of) : 0, pct = p?.of ? Math.round((100 * n) / p.of) : 0;
    morph(this.taskBox,
      p ? h("div", { class: "task-progress" },
        h("div", { class: "story-progress", role: "progressbar", "aria-labelledby": "scenarioName", "aria-valuemin": "0", "aria-valuemax": String(p.of), "aria-valuenow": String(n), "aria-valuetext": `${n} of ${p.of}` }, h("i", { style: { width: `${pct}%` } })),
        h("span", { class: "task-count", role: "status" }, c.done ? "Done" : `${n} of ${p.of}`)) : null,
      figures ? h("dl", { class: "task-figures" }, figures.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v)))) : null);
  }
}
