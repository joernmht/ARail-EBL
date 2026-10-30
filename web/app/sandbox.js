// The Sandbox (the case Sandbox): the layout to look around freely, in the flyover or in the photos,
// with the modules of the layout and of the app to switch on and off, and what the stage shows: how
// the infrastructure ages (its assets in the colour of their condition, years ahead without
// renewals), the people (coloured by the purpose of their trip or by their mood, their walking
// trails, the room they take), the signs and boards, the tracks by one of their railway systems.
import { boundsOf, SYSTEM_OVERLAYS, storyOf } from "../arail/index.js";
import { icon } from "./icons.js";
import { h, morph, mount } from "./ui.js";

/** The icon of a module by the simulations of its layer. */
const SIM_ICONS = {
  "ops-plan": "plan", operations: "operations", "ops-story": "operations", infrastructure: "infrastructure", "maintenance-story": "infrastructure", journeys: "journeys", "journeys-story": "journeys", terminal: "terminal",
};
/** The years the infrastructure can be aged by, and the step of the slider. */
const AGE_MAX = 50, AGE_STEP = 5;
/** The story whose assets show their condition by their age (infra/story.js). */
const AGEING = "maintenance-story";

export class SandboxPanel {
  /** @param {import("./app.js").App} app */
  constructor(app) {
    this.app = app;
    this.el = null;
  }

  get world() {
    return this.app.world;
  }

  /** Draw the panel anew. @param {HTMLElement} el the case's place */
  render(el) {
    this.el = { root: el, look: h("div", { class: "section" }), modules: h("div", { class: "section" }), show: h("div", { class: "section" }) };
    mount(el, this.el.look, this.el.modules, this.el.show);
    this.update();
  }

  /** Refresh in place (every 400 ms while shown, and after a change): controls keep the focus. */
  update() {
    const e = this.el;
    if (!e?.root.isConnected) return;
    morph(e.look, ...this._look());
    morph(e.modules,
      h("h2", {}, "Modules"),
      h("div", { class: "modules", role: "group", "aria-label": "Modules" }, this.app.modules().map((m) => this._moduleBox(m))));
    morph(e.show, ...this._show());
  }

  /** Look around: the flyover or the photo, the whole layout. */
  _look() {
    const app = this.app, fly = app.flyover, photo = !!app.source && !app.source.stale;
    return [
      h("h2", {}, "Look around"),
      h("div", { class: "row" },
        h("button", { class: "btn small", type: "button", id: "sandboxFlyover", "aria-pressed": fly.active ? "true" : "false", onclick: () => (fly.active ? fly.leave() : fly.enter()) }, "Flyover"),
        h("button", { class: "btn small", type: "button", id: "sandboxFit", onclick: () => this.fit() }, "Whole layout"),
        photo ? h("button", { class: "btn small", type: "button", id: "sandboxPhoto", "aria-pressed": fly.active ? "false" : "true", onclick: () => fly.leave() }, "Photo") : null),
      h("p", { class: "hint" }, fly.active
        ? "Drag on the stage to turn the view, pinch or scroll to zoom; the buttons on the stage turn, tilt and zoom too."
        : "The arrows at the edges of the photo go round the lab; the Flyover lets you fly over the layout."),
    ];
  }

  /** The whole layout in the flyover. */
  fit() {
    const fly = this.app.flyover;
    if (!fly.active) fly.enter();
    fly.command("fit");
  }

  /** What the stage shows: the infrastructure's age, the people, signs and boards, the tracks. */
  _show() {
    const app = this.app, s = this.world.settings;
    const set = (key, value) => {
      s[key] = value;
      app.savePrefs();
      this.update();
    };
    const toggle = (id, label, key) => h("label", { class: "field check", for: id },
      h("input", { type: "checkbox", id, checked: !!s[key], onchange: (ev) => set(key, ev.target.checked) }), label);
    return [
      h("h2", {}, "Show"),
      ...this._ageing(),
      h("h3", { class: "sandbox-sub" }, "People"),
      h("div", { class: "fields" },
        h("label", { class: "field", for: "sandboxPeopleColour" }, h("span", {}, "Colour of people"),
          h("select", { id: "sandboxPeopleColour", onchange: (ev) => set("peopleColour", ev.target.value) },
            [["auto", "town: purpose of the trip; passengers: mood"], ["purpose", "purpose of the trip"], ["mood", "mood"]].map(([v, t]) => h("option", { value: v, selected: (s.peopleColour || "auto") === v }, t)))),
        toggle("sandboxTrails", "Walking trails", "trails"),
        toggle("sandboxSpace", "The room people take", "spaceCircles")),
      h("h3", { class: "sandbox-sub" }, "Signs and tracks"),
      h("div", { class: "fields" },
        toggle("sandboxLabels", "Signs and boards", "labels"),
        toggle("sandboxBoards", "Departure boards at the stops", "stopBoards"),
        h("label", { class: "field", for: "sandboxTrackSystems" }, h("span", {}, "Colour the tracks by"),
          h("select", { id: "sandboxTrackSystems", onchange: (ev) => set("trackSystems", ev.target.value) },
            [["", "nothing"], ...SYSTEM_OVERLAYS].map(([v, t]) => h("option", { value: v, selected: (s.trackSystems || "") === v }, t))))),
      h("p", { class: "hint" }, "More in Settings → View."),
    ];
  }

  /**
   * How the infrastructure ages: with the story of the infrastructure running, a slider of the years
   * ahead (the assets' rings show their condition then); with its module off, a button to switch it on.
   */
  _ageing() {
    const app = this.app, s = this.world.settings, story = storyOf(this.world, AGEING);
    const head = h("h3", { class: "sandbox-sub" }, "Infrastructure aging");
    if (!story) {
      const m = app.modules().find((x) => !x.app && x.simulations?.includes(AGEING));
      return m ? [head, h("p", { class: "hint" }, "The signals, tracks and platforms of the station in the colour of their condition, years ahead."),
        h("button", { class: "btn small", type: "button", id: "sandboxAgeing", onclick: () => this.showAgeing(m.id) }, `Switch on “${m.name}”`)] : [];
    }
    const years = Math.max(0, Math.min(AGE_MAX, +s.ageYears || 0));
    return [
      head,
      h("label", { class: "field", for: "sandboxAge" }, h("span", {}, years ? `In ${story.year}: ${years} years older, without renewals` : `Today (${story.year})`),
        h("input", {
          type: "range", id: "sandboxAge", min: 0, max: AGE_MAX, step: AGE_STEP, value: years, "aria-valuetext": `${years} years ahead`,
          oninput: (ev) => {
            s.ageYears = Number(ev.target.value);
            this.update();
          },
        })),
      h("p", { class: "hint" }, "The rings on the ground show the condition of each asset by its age, from grade 1 (Türkis: as new) to grade 5 (Rot: deficient). Tap one to see its age."),
      h("button", { class: "btn small", type: "button", id: "sandboxAssets", onclick: () => this.showAssets() }, "Go to the assets"),
    ];
  }

  /** Switch on the module of the infrastructure's story, then go to its assets. */
  async showAgeing(module) {
    await this.app.switchOnModule(module);
    this.showAssets();
  }

  /** The flyover over the infrastructure's assets: the signals, the interlocking, the platforms. */
  showAssets() {
    const assets = this.world.objects.filter((o) => o.geometry && (o.type === "platform" || (o.constructor.category === "Infrastructure" && !["track", "label", "system-change"].includes(o.type))));
    this.app.showPlace(boundsOf(assets, 0.15));
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
