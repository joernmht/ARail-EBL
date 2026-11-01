// The time and the speed of the simulation, in the upper right corner of the stage (over the camera
// image and the flyover alike, also in full screen; the photo tour's perspectives are in the upper
// left corner): the time of day, which opens Settings → Simulation, Pause, and the speeds 1× to 30×.
// The speed chosen is pressed (Orange, as the stage's other toggles); Space pauses too.
import { h, mount } from "./ui.js";
import { tr } from "./i18n.js";

/** The speeds offered: how many times as fast as real time the simulation runs (the world's `speed`). */
export const SPEEDS = [1, 2, 5, 10, 30];

const PAUSE_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4.5v11M13 4.5v11"/></svg>';

export class SpeedControl {
  /**
   * @param {import("./app.js").App} app
   * @param {HTMLElement} el its place on the stage (#simClock)
   */
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.render();
  }

  /** Make its buttons (again, in the language shown). */
  render() {
    const app = this.app;
    this.el.setAttribute("aria-label", tr("Time and speed"));
    this.time = h("button", { class: "btn sim-time", type: "button", id: "simTime", title: "Time and speed (Settings → Simulation)", onclick: () => app.openTab("simulate") });
    this.pause = h("button", { class: "btn sim-pause", type: "button", id: "simPause", "aria-label": "Pause", title: "Pause (Space)", "aria-pressed": "false", onclick: () => this.setPaused(!app.world.paused) });
    this.pause.innerHTML = PAUSE_ICON;
    this.speeds = h("div", { class: "sim-speeds", role: "group", "aria-label": "Speed" },
      SPEEDS.map((s) => h("button", { class: "btn", type: "button", "data-speed": String(s), "aria-pressed": "false", onclick: () => this.setSpeed(s) }, `${s}×`)));
    mount(this.el, this.time, this.pause, this.speeds);
    this.update();
  }

  /** Pause the simulation, or let it go on. */
  setPaused(on) {
    this.app.world.paused = !!on;
    this.app.panels.updateSimulateControls();
  }

  /** Run the simulation this many times as fast as real time. */
  setSpeed(s) {
    this.app.world.speed = s;
    this.app.panels.updateSimulateControls();
  }

  /**
   * As the world is now (with the HUD every 400 ms, and after a change): the time, Paused, a speed
   * none of the buttons has (a scenario's own); the button of the speed pressed.
   */
  update() {
    const w = this.app.world;
    const text = [w.clock.label(), w.paused ? tr("Paused") : !SPEEDS.includes(w.speed) ? `×${w.speed}` : null].filter(Boolean).join(" · ");
    if (this.time.textContent !== text) this.time.textContent = text;
    this.pause.setAttribute("aria-pressed", w.paused ? "true" : "false");
    for (const b of this.speeds.children) b.setAttribute("aria-pressed", Number(b.dataset.speed) === w.speed ? "true" : "false");
    // the HUD's chips and a message keep clear of it (its size: --clock-w, --clock-h)
    const stage = this.el.parentElement;
    stage?.style.setProperty("--clock-w", `${this.el.offsetWidth}px`);
    stage?.style.setProperty("--clock-h", `${this.el.offsetHeight}px`);
  }
}
