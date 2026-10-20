// The cases of the Interaction chapter, a class each: what the modules let people do on the layout.
// A case belongs to a side of the strip, the infrastructure manager ("infra") or the railway
// undertaking (EVU, "evu"), or it is a tool of the layout (Build, Disruptions: no side). It needs a
// simulation of the layout (a story, the terminal) or a module of the app, and shows its panel;
// without what it needs, it offers to switch its module on, to open the example that has it, or to
// add it to the layout. A page lists its case classes (main.js): a new case is one class and one line.
import { StoryPanel } from "./story.js";
import { TerminalPanel } from "./terminal.js";
import { h, mount } from "./ui.js";

/** The sides of the strip, in its order. */
export const SIDES = [
  { id: "infra", label: "Infrastructure", description: "The infrastructure manager: tracks, signals, the station", icon: "infrastructure" },
  { id: "evu", label: "Railway undertaking", description: "The railway undertaking (EVU): its trains, staff and customers", icon: "operations" },
];

export class Case {
  /** Its id: the address (#id) and what the app keeps. */
  static id = "";
  /** "infra" or "evu" (SIDES); null for a tool of the layout. */
  static side = null;
  /** Its name in the tabs of its side (short). */
  static label = "";
  /** What it does, in one line (the tooltip, and the text while it is off). */
  static description = "";
  /** The icon of a tool in the strip (interaction.js, ICONS). */
  static icon = "module";
  /** Former tab names that open it (old links). */
  static aliases = [];
  /** The simulation type it needs, or null. */
  static needs = null;
  /** The app's module it needs ("build", "disruptions"), or null. */
  static appModule = null;
  /** The example that has it (Settings → View), opened when no module of this layout has it. */
  static example = null;

  /** @param {import("./app.js").App} app */
  constructor(app) {
    this.app = app;
    /** Its panel: `render(el)`, `update()`, optionally `key(e)`, `syncWidth()`, `stepped()`. */
    this.panel = this.makePanel();
  }

  get id() {
    return this.constructor.id;
  }

  get side() {
    return this.constructor.side;
  }

  get label() {
    return this.constructor.label;
  }

  /** The panel of the case (null: it has none). */
  makePanel() {
    return null;
  }

  /** Whether the layout and the app's modules have what it needs. */
  get ready() {
    const C = this.constructor, app = this.app;
    if (C.appModule && !app.appModuleOn(C.appModule)) return false;
    return !C.needs || app.world.simulations.some((s) => s.constructor.type === C.needs);
  }

  /** The module of this layout, off, that has what it needs, or null. */
  module() {
    const C = this.constructor, app = this.app;
    if (!C.needs) return null;
    return app.modules().find((m) => !m.app && !m.enabled && m.simulations?.includes(C.needs)) ?? (C.example ? app.moduleOpening(C.example) : null);
  }

  /** Add what it needs to this layout (the game page's panels can), or null where it cannot. */
  add() {
    return null;
  }

  /** Draw the case into its place in Interaction. @param {HTMLElement} el */
  render(el) {
    if (this.ready && this.panel) this.panel.render(el);
    else this.renderOff(el);
  }

  /** Refresh it in place (every 400 ms while it is shown). */
  update() {
    if (this.ready) this.panel?.update?.();
  }

  /** Without what it needs: its name, what it does, and the way to it. */
  renderOff(el) {
    const C = this.constructor, app = this.app, m = this.module();
    const on = C.appModule
      ? h("button", { class: "btn primary", type: "button", id: "caseOn", onclick: () => app.setAppModule(C.appModule, true) }, "Switch on")
      : m ? h("button", { class: "btn primary", type: "button", id: "caseOn", onclick: () => app.toggleModule(m.id) }, `Switch on “${m.name}”`)
        : C.example ? h("button", { class: "btn", type: "button", id: "caseExample", onclick: () => app.openExample(C.example) }, "Open the example") : null;
    const add = !C.appModule && this.constructor.prototype.add !== Case.prototype.add
      ? h("button", { class: "btn", type: "button", id: "caseAdd", onclick: () => this.add() }, "Add to this layout") : null;
    mount(el,
      h("div", { class: "section case-off" },
        h("h2", { tabindex: "-1" }, C.label),
        C.description ? h("p", { class: "hint" }, C.description) : null,
        on || add ? h("div", { class: "row" }, on, add) : null));
  }
}

/** A story to click through (core/story.js) in a StoryPanel. */
export class StoryCase extends Case {
  /** The prefix of the panel's ids ("infra": #infraStoryNext). */
  static prefix = "";

  makePanel() {
    return new StoryPanel(this.app, { prefix: this.constructor.prefix, type: this.constructor.needs });
  }
}

/** The container terminal: containers moved one by one (the game page: with its visits, `full`). */
export class TerminalCase extends Case {
  static id = "terminal";
  static side = "evu";
  static label = "Terminal";
  static description = "Container trains, trucks and barges: move the containers with the crane";
  static icon = "terminal";
  static needs = "terminal";
  static example = "terminal";
  /** With the visits, new arrivals, crane jobs and the speed. */
  static full = false;

  makePanel() {
    return new TerminalPanel(this.app, { full: this.constructor.full });
  }

  add() {
    return this.panel.addTerminal();
  }
}

/** Build, a tool of the layout: placing and editing its objects (editor.js). */
export class BuildCase extends Case {
  static id = "build";
  static label = "Build";
  static description = "Place and edit the objects of the layout";
  static icon = "build";
  static appModule = "build";

  makePanel() {
    return this.app.editor;
  }

  update() {
    // the marker map grows while the camera finds markers
    const app = this.app, n = app.world.map.ids().length;
    if (!this.ready || this._markers === n) return;
    this._markers = n;
    app.editor.renderMarkers();
  }
}

/** Disruptions, a tool of the layout: disruptions started by hand and the layout's scenarios (panels.js). */
export class DisruptionsCase extends Case {
  static id = "disrupt";
  static label = "Disruptions";
  static description = "Delays, failures and closures by hand, and the scenarios of the layout";
  static icon = "disruptions";
  static appModule = "disruptions";

  makePanel() {
    const app = this.app;
    return {
      render: (el) => app.panels.renderDisruptions(el),
      update: () => {
        app.panels.updateDisruptions();
        app.panels.updateScenarios();
      },
    };
  }
}
