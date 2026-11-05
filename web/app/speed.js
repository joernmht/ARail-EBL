// The speed of the simulation, in the upper right corner of the stage (over the camera image and
// the flyover alike, also in full screen; the photo tour's perspective is in the upper left corner):
// Pause, and one button with the speed, which goes faster with each click (1× to 30×, then back to
// 1×). Paused, Pause is pressed (Orange, as the stage's other toggles); Space pauses too. The time of
// day is in Settings → Simulation.
import { h, mount } from "./ui.js";
import { tr } from "./i18n.js";

/** The speeds offered: how many times as fast as real time the simulation runs (the world's `speed`). */
export const SPEEDS = [1, 2, 5, 10, 30];

const PAUSE_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4.5v11M13 4.5v11"/></svg>';

/**
 * The speed a click on the speed button chooses: the next one offered above this one (a scenario's
 * own speed, not one of SPEEDS, goes on to the next above it); after the fastest, the slowest again.
 * @param {number} speed
 */
export function nextSpeed(speed) {
  return SPEEDS.find((s) => s > speed) ?? SPEEDS[0];
}

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
    this.el.setAttribute("aria-label", tr("Speed"));
    this.pause = h("button", { class: "btn sim-pause", type: "button", id: "simPause", "aria-label": "Pause", title: "Pause (Space)", "aria-pressed": "false", onclick: () => this.setPaused(!app.world.paused) });
    this.pause.innerHTML = PAUSE_ICON;
    this.faster = h("button", { class: "btn sim-speed", type: "button", id: "simSpeed", onclick: () => this.setSpeed(nextSpeed(app.world.speed)) });
    this._shown = null;
    mount(this.el, this.pause, this.faster);
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
   * As the world is now (with the HUD every 400 ms, and after a change): Pause pressed while paused;
   * the speed on its button, whose name says it ("Speed 10×") and whose title what a click does.
   */
  update() {
    const w = this.app.world, s = w.speed, next = nextSpeed(s);
    this.pause.setAttribute("aria-pressed", w.paused ? "true" : "false");
    const key = `${s}|${tr("Speed")}`; // the language shown, too
    if (this._shown !== key) {
      this._shown = key;
      this.faster.textContent = `${s}×`;
      this.faster.setAttribute("aria-label", tr(`Speed ${s}×`));
      this.faster.title = tr(next > s ? `Faster: ${next}×` : `Back to ${next}×`);
    }
    // the HUD's chips and a message keep clear of it (its size: --clock-w, --clock-h)
    const stage = this.el.parentElement;
    stage?.style.setProperty("--clock-w", `${this.el.offsetWidth}px`);
    stage?.style.setProperty("--clock-h", `${this.el.offsetHeight}px`);
  }
}
