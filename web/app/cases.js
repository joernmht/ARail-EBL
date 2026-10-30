// The scenarios of the Interaction chapter, a class each (a "case"): examples to start, each with a
// small task to try ("Load 3 containers onto the real container train") and its progress, and a view of the stage
// chosen for it (the flyover at the terminal, the camera following a story), so that what it is
// about is in the picture at once. A case belongs to a side, the infrastructure manager ("infra")
// or the railway undertaking (EVU, "evu"), or it is a first step (the Introduction, the Sandbox) or
// a tool of the layout (Build, Disruptions); its tags are the filter pills it is listed under. It
// may need a simulation of the layout (a story, the operations plan, the terminal) or a module of
// the app: Start switches that module on, or opens the example that has it, and then shows the
// view. A page lists its case classes (main.js): a new case is one class and one line.
import { boundsOf, planOf, storyOf, TERMINAL_EVENTS, terminalOf } from "../arail/index.js";
import { IntroPanel } from "./intro.js";
import { PlanPanel } from "./plan.js";
import { SandboxPanel } from "./sandbox.js";
import { StoryPanel } from "./story.js";
import { TerminalPanel } from "./terminal.js";
import { h, mount } from "./ui.js";

/** The sides of the railway, in their order (the cases' tags "infra" and "evu"). */
export const SIDES = [
  { id: "infra", label: "Infrastructure", description: "The infrastructure manager: tracks, signals, the station", icon: "infrastructure" },
  { id: "evu", label: "Railway undertaking", description: "The railway undertaking (EVU): its trains, staff and customers", icon: "operations" },
];

/** The filter pills of the scenarios, in their order; a pill is shown when a case has its tag. */
export const TAGS = [
  { id: "explore", label: "First steps" },
  ...SIDES.map(({ id, label }) => ({ id, label })),
  { id: "passengers", label: "Passengers" },
  { id: "freight", label: "Freight" },
  { id: "tools", label: "Tools" },
];

export class Case {
  /** Its id: the address (#id) and what the app keeps. */
  static id = "";
  /** "infra" or "evu" (SIDES); null for a first step or a tool of the layout. */
  static side = null;
  /** Its name in the list of scenarios. */
  static label = "";
  /** What it is about, in one line (in the list, and the text while it is off). */
  static description = "";
  /** The filter pills it is listed under (TAGS); null: its side, else "tools". */
  static tags = null;
  /** Its task, in one line ("Load 3 containers onto the real container train"); "" for none (a tool, the Sandbox). */
  static task = "";
  /** How to do it, in one line. */
  static how = "";
  /** The world's speed while it runs (the clock runs this many times as fast), or null: as it is. */
  static speed = null;
  /** The icon in the list (interaction.js, ICONS). */
  static icon = "module";
  /** Former tab names that open it (old links). */
  static aliases = [];
  /** The simulation type it needs, or null. */
  static needs = null;
  /** The app's module it needs ("build", "disruptions"), or null. */
  static appModule = null;
  /** The example that has it (Settings → View), opened when no module of this layout has it. */
  static example = null;
  /** The example it plays in (the hybrid container train): Start opens it, unless its layout is open. */
  static opens = null;

  /** @param {import("./app.js").App} app */
  constructor(app) {
    this.app = app;
    /** Whether it was started (Start): its task counts from then. */
    this.started = false;
    /** The world's speed before it was started, while it runs at its own (static speed). */
    this._speed = null;
    /** Its panel: `render(el)`, `update()`, optionally `key(e)`, `syncWidth()`, `stepped()`, `drawFocus(ctx, view)`. */
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

  /** The filter pills it is listed under. */
  get tags() {
    return this.constructor.tags ?? [this.side ?? "tools"];
  }

  /** Its task in one line, or "". */
  get task() {
    return this.constructor.task;
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
    if (!C.needs || C.opens) return null;
    return app.modules().find((m) => !m.app && !m.enabled && m.simulations?.includes(C.needs)) ?? (C.example ? app.moduleOpening(C.example) : null);
  }

  /** Can Start give it what it needs (its app module, a module of the layout, its example)? */
  get startable() {
    const C = this.constructor;
    return this.ready || !!C.appModule || !!this.module() || !!C.example || !!C.opens;
  }

  /** Add what it needs to this layout (the game page's panels can), or null where it cannot. */
  add() {
    return null;
  }

  /**
   * Start it: the example it plays in is opened, and what it needs is switched on (its app module,
   * its module of the layout, or the example that has it); then its task starts and the stage shows
   * its view.
   * @returns {Promise<boolean>} whether it started
   */
  async start() {
    const C = this.constructor, app = this.app;
    if (C.opens && !app.exampleOpen(C.opens)) await app.openExample(C.opens);
    if (!this.ready) {
      const m = this.module();
      if (C.appModule) app.setAppModule(C.appModule, true);
      else if (m) await app.toggleModule(m.id);
      else if (C.example) await app.openExample(C.example);
      // the layout may have been loaded again: this case is still the one shown
      if (!this.ready) return false;
    }
    if (C.speed && this._speed == null) {
      this._speed = app.world.speed;
      app.world.speed = C.speed;
    }
    this.started = true;
    this.begin();
    return true;
  }

  /** Its task from the start and its view (Start, Start again). */
  begin() {}

  /** Stop it (another case is shown, or the list): the world's speed as before. */
  stop() {
    if (this._speed != null) this.app.world.speed = this._speed;
    this._speed = null;
    this.started = false;
    this.end();
  }

  /** What stops with it (a film that plays). */
  end() {}

  /** How far its task is ({done, of}), or null: it has none, or it was not started. */
  progress() {
    return null;
  }

  /** Is its task done? */
  get done() {
    const p = this.started ? this.progress() : null;
    return !!p && p.of > 0 && p.done >= p.of;
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
        : C.opens || C.example ? h("button", { class: "btn", type: "button", id: "caseExample", onclick: () => app.openExample(C.opens || C.example) }, "Open the example") : null;
    const add = !C.appModule && this.constructor.prototype.add !== Case.prototype.add
      ? h("button", { class: "btn", type: "button", id: "caseAdd", onclick: () => this.add() }, "Add to this layout") : null;
    mount(el,
      h("div", { class: "section case-off" },
        h("h2", { tabindex: "-1" }, C.label),
        C.description ? h("p", { class: "hint" }, C.description) : null,
        on || add ? h("div", { class: "row" }, on, add) : null));
  }
}

/** The Introduction: the layout in a short film, what is real and what the app adds (intro.js). */
export class IntroCase extends Case {
  static id = "intro";
  static label = "Introduction";
  static description = "The layout in a short film: what is real in the lab, and what the app adds";
  static tags = ["explore"];
  static task = "Watch the film: Play runs it, Next and Back go from scene to scene.";
  static how = "Tap anything on the stage to see what it is; the film waits while its card is open.";
  static icon = "intro";

  makePanel() {
    return new IntroPanel(this.app);
  }

  begin() {
    this.panel.restart({ play: true });
  }

  end() {
    this.panel.stop();
  }

  progress() {
    const n = this.panel.scenes.length;
    return n ? { done: this.panel.seen, of: n } : null;
  }
}

/** The Sandbox: look around freely, switch the modules on and off, show the state of things (sandbox.js). */
export class SandboxCase extends Case {
  static id = "sandbox";
  static label = "Sandbox";
  static description = "Look around freely: switch the modules on and off, show how the infrastructure ages and what people do";
  static tags = ["explore"];
  static how = "Drag on the stage to turn the view, pinch or scroll to zoom; tap anything to see what it is.";
  static aliases = ["modules"];
  static icon = "sandbox";

  makePanel() {
    return new SandboxPanel(this.app);
  }

  begin() {
    this.app.showPlace(null);
  }
}

/** A story to click through (core/story.js) in a StoryPanel; the flyover's camera follows it. */
export class StoryCase extends Case {
  /** The prefix of the panel's ids ("infra": #infraStoryNext). */
  static prefix = "";
  static task = "Follow the story to its end: Next goes on, Play runs it by itself.";
  static how = "The camera follows the story; tap a vehicle or a person to see what it does.";

  makePanel() {
    return new StoryPanel(this.app, { prefix: this.constructor.prefix, type: this.constructor.needs });
  }

  get story() {
    return storyOf(this.app.world, this.constructor.needs);
  }

  begin() {
    this.story?.restart();
    this.panel.setFollow(true);
  }

  progress() {
    const st = this.story?.state();
    return st ? { done: st.finished ? st.count : st.index, of: st.count } : null;
  }
}

/** Operations: the operations plan of the layout (arail/ops/plan.js), the part of the case's side. */
export class PlanCase extends Case {
  static label = "Operations";
  static needs = "ops-plan";
  static example = "plan";
  static how = "Each train says what does not work; choose another track, unit or driver until none does. Run plays the plan.";

  makePanel() {
    return new PlanPanel(this.app, { side: this.constructor.side });
  }

  begin() {
    const plan = planOf(this.app.world);
    if (plan && !plan.running) plan.reset();
    this.panel.update();
    // the station's platforms, where the trains of the plan stop
    this.app.showPlace(boundsOf(this.app.world.objects.filter((o) => o.type === "platform" && o.geometry), 0.15));
  }

  /** The trains whose part of this side works, of all trains of the plan. */
  progress() {
    const plan = planOf(this.app.world);
    if (!plan?.trains.length) return null;
    const checks = plan.checks();
    return { done: plan.trains.filter((t) => !checks.get(t.id).some((p) => p.side === this.side)).length, of: plan.trains.length };
  }
}

/**
 * The container terminal: containers moved one by one. In the app it plays in the hybrid container
 * train (`opens`): real model wagons with tags in the photo, virtual containers on them, a virtual
 * crane; on the game page with its visits (`full`).
 */
export class TerminalCase extends Case {
  static id = "terminal";
  static side = "evu";
  static label = "Load the hybrid train";
  static description = "Real model wagons with tags, virtual containers: load the train with the crane";
  static tags = ["evu", "freight"];
  static task = "Load 3 containers onto the real container train with the crane.";
  static how = "Tap a container in the yard or on the barge, then a free place on a wagon of the real train: the crane takes it there.";
  static speed = 10;
  static icon = "terminal";
  static needs = "terminal";
  static example = "terminal";
  static opens = "container-train";
  /** With the visits, new arrivals, crane jobs and the speed. */
  static full = false;
  /** How many containers the task loads (the example's photo shows four free places on the train). */
  static goal = 3;
  /** The unit of model wagons the task loads (its name in the layout), or null: any wagon. */
  static unit = "Container train";

  constructor(app) {
    super(app);
    /** Containers set down on a wagon of the task since the case was started. */
    this.loaded = 0;
    app.world.events.on(TERMINAL_EVENTS.containerMoved, (e) => {
      if (this.started && e.terminal && this.loads(e.terminal, e.to?.carrier)) this.loaded++;
    });
  }

  /** Does the task load this carrier: a wagon (of the unit of model wagons `unit`, where the terminal has it)? */
  loads(terminal, id) {
    if (terminal.carrier(id)?.kind !== "wagon") return false;
    const units = terminal.modelUnits(), unit = this.constructor.unit;
    return !unit || !units.some((u) => u.name === unit) || units.some((u) => u.name === unit && u.carriers.some((c) => c.id === id));
  }

  makePanel() {
    return new TerminalPanel(this.app, { full: this.constructor.full });
  }

  add() {
    return this.panel.addTerminal();
  }

  begin() {
    this.loaded = 0;
    const app = this.app;
    // real model wagons with their tags: the photo of the layout, where the camera finds them
    if (app.world.layout.markers.rolling && app.world.layout.view?.image) return app.flyover.leave();
    // else the crane, the yard and the loading tracks in the flyover
    app.showPlace(boundsOf(app.world.objects.filter((o) => o.constructor.category === "Terminal" && o.geometry), 0.12));
  }

  progress() {
    const goal = this.constructor.goal;
    return this.task && terminalOf(this.app.world) ? { done: Math.min(goal, this.loaded), of: goal } : null;
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
  static description = "Delays, failures and closures by hand, and the timelines of disruptions of the layout";
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
