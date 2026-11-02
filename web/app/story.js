// Story panel: a story of the layout (arail/core/story.js) as steps to click through, the panel of a
// case of Interaction (the app: the infrastructure's disruption, the maintenance story; the railway
// undertaking's, the operations story; the journeys story). Light in text: the step it is at, its
// title and text; below it the bar of the steps (a segment per step, filled as far as the story has
// run; a click on one goes to its step); then Back, Next, Play and Restart in one row. A presenter's
// clicker (Page Down, Page Up) goes on and back while the case is shown. Start opens the flyover, and
// while the scenario runs its camera always follows the story (the story's `view()`: the spare unit on
// its way, the van, the signal, the works; the traveller, her bus, her train), from the side the story
// says, if it says one; the photo chosen by hand stays (the story drawn on the real table). A control
// used before Start starts the scenario first.
import { storyOf } from "../arail/index.js";
import { h, morph, mount } from "./ui.js";

/** How long the flyover's camera takes to fly to where a step of the story happens (ms): soft, not a jump. */
const AIM_MS = 1000;

/**
 * The steps of a story or a film as a bar: a segment per step, full for those before, filled as far as
 * the one it is at has run. It is one slider: a click on a segment goes to its step (its title is the
 * segment's tooltip), the arrow keys, Home and End step along it; the step shown stays as it is (going
 * there would start it again, and a finished story would not be done any more). Then where it is ("Step 3 of 12"),
 * and Done at its end (a status: screen readers say it).
 * @param {{id: string, titles: string[], index: number, part: number, active?: boolean, done?: boolean, word?: string, go: (i: number) => void}} o
 *   the slider's id (the panel drawn anew gives it the focus back), the steps' titles, the step it is
 *   at and how far it has run (0…1), whether it runs (else nothing is filled), whether its task is
 *   done, "Step" or "Scene", and what a click or a key does
 */
export function stepBar({ id, titles, index, part, active = true, done = false, word = "Step", go }) {
  const n = titles.length, at = Math.min(index + 1, n);
  const fill = (i) => (!active ? 0 : i < index ? 1 : i === index ? Math.max(0, Math.min(1, part)) : 0);
  const keys = { ArrowLeft: index - 1, ArrowDown: index - 1, ArrowRight: index + 1, ArrowUp: index + 1, Home: 0, End: n - 1 };
  return h("div", { class: "step-bar" },
    h("div", {
      id, class: "step-segs", role: "slider", tabindex: "0", "aria-label": `${word}s`, "aria-valuemin": "1", "aria-valuemax": String(n), "aria-valuenow": String(at),
      "aria-valuetext": `${word} ${at} of ${n}: ${titles[index] ?? ""}`,
      onclick: (e) => {
        const seg = e.target.closest?.(".step-seg"), i = Number(seg?.dataset.i);
        if (seg && !(active && i === index)) go(i);
      },
      onkeydown: (e) => {
        if (!(e.key in keys)) return;
        e.preventDefault();
        // at either end a key stays where it is
        const to = Math.max(0, Math.min(n - 1, keys[e.key]));
        if (to !== index) go(to);
      },
    }, titles.map((title, i) => h("span", { class: `step-seg${active && i === index ? " now" : ""}`, "data-i": String(i), title },
      h("i", { style: `--fill: ${Math.round(fill(i) * 100)}%` })))),
    h("span", { class: "step-count" }, h("span", { "aria-hidden": "true" }, `${word} ${at} of ${n}`),
      // always there, so that its text is announced when it comes
      h("span", { class: "step-done", role: "status" }, done ? "Done" : "")));
}

export class StoryPanel {
  /**
   * @param {object} app the ARail app (app.js)
   * @param {{prefix: string, type: string, owner?: import("./cases.js").Case}} o the prefix of the panel's
   *   ids ("infra": #infraStoryNext), the story's simulation type, and the case it is the panel of (its
   *   controls start it first; the camera follows the story while it runs)
   */
  constructor(app, { prefix, type, owner = null }) {
    this.app = app;
    this.prefix = prefix;
    this.type = type;
    this.owner = owner;
    this.el = null;
  }

  /** Does its scenario run (or has it none)? Then the camera follows the story. */
  get running() {
    return !this.owner || this.owner.started;
  }

  /** The layout's story, or null. */
  get story() {
    return storyOf(this.app.world, this.type);
  }

  /** Draw the panel anew. @param {HTMLElement} el the tab's panel */
  render(el) {
    this.el = {
      root: el, now: h("div", { class: "story-now", "aria-live": "polite" }), bar: h("div", {}),
      controls: h("div", { class: "row story-controls", role: "group", "aria-label": "Story" }),
    };
    mount(el, h("div", { class: "story" }, this.el.now, this.el.bar, this.el.controls));
    this.update();
    // drawn again (another chapter, a module switched): the camera back on the story, in the flyover
    if (this.running && this.app.mode === "flyover") this.aim();
  }

  /** Refresh in place (every 400 ms while shown, and after a step). */
  update() {
    const e = this.el;
    if (!e?.root.isConnected) return;
    const story = this.story;
    if (!story) {
      for (const k of ["now", "bar", "controls"]) morph(e[k]);
      return;
    }
    const st = story.state(), id = (x) => `${this.prefix}Story${x}`;
    morph(e.now,
      h("h3", { id: id("Title") }, st.step.title),
      h("p", {}, st.step.text));
    morph(e.bar, stepBar({ id: id("Bar"), done: st.finished, titles: st.steps.map((s) => s.title), index: st.index, part: st.step.seconds > 0 ? st.progress : 1, go: (i) => this.goTo(i) }));
    morph(e.controls,
      h("button", { class: "btn", type: "button", id: id("Back"), disabled: st.index === 0, title: "Page Up", "aria-keyshortcuts": "PageUp", onclick: () => this.back() }, "Back"),
      h("button", { class: "btn primary", type: "button", id: id("Next"), disabled: st.finished, title: "Page Down", "aria-keyshortcuts": "PageDown", onclick: () => this.next() }, st.index === st.count - 1 ? "To the end" : "Next"),
      h("button", { class: "btn", type: "button", id: id("Play"), "aria-pressed": st.playing ? "true" : "false", title: "Go on from step to step by itself", onclick: () => this.play() }, "Play"),
      h("button", { class: "btn", type: "button", id: id("Restart"), disabled: st.index === 0 && st.progress >= 1 && !st.playing, title: "The story from its beginning", onclick: () => this.restart() }, "Restart"));
  }

  /**
   * A control used before its scenario was started starts it first (the story from its beginning, the
   * camera on it), then does what it asked.
   */
  async _act(fn) {
    const c = this.owner;
    if (c && !c.started && (!(await this.app.startCase(c.id)) || !c.started)) return;
    fn();
  }

  next() {
    return this._act(() => {
      this.story?.next();
      this.stepped();
    });
  }

  back() {
    return this._act(() => {
      this.story?.back();
      this.stepped();
    });
  }

  restart() {
    return this._act(() => {
      this.story?.restart();
      this.stepped();
    });
  }

  /**
   * After a step began (here, by Play, a clicker or a scenario): the panel, and while it runs the
   * flyover's camera; the photo chosen by hand stays (Start opens the flyover: StoryCase.begin).
   */
  stepped() {
    this.update();
    if (this.running && this.app.mode === "flyover") this.aim();
  }

  /**
   * The flyover's camera goes to where the story happens and follows it there; from the photo the
   * flyover starts where its camera stands.
   */
  aim() {
    const story = this.story, v = story?.view();
    if (!v?.at) return;
    const fly = this.app.flyover;
    if (!fly.active) fly.enter({ fromPhoto: true });
    fly.follow(() => (this.story === story ? story.view()?.at ?? null : null));
    const rad = (deg) => (Number.isFinite(deg) ? (deg * Math.PI) / 180 : undefined);
    fly.move((k) => k.set({ target: v.at, distance: v.distance, pitch: rad(v.pitch_deg), yaw: rad(v.yaw_deg) }), AIM_MS);
  }

  play() {
    return this._act(() => {
      const s = this.story;
      if (!s) return;
      s.play();
      // the story only goes on while the world runs
      if (s.playing && this.app.world.paused) {
        this.app.world.paused = false;
        this.app.panels.updateSimulateControls();
      }
      this.update();
    });
  }

  goTo(i) {
    return this._act(() => {
      this.story?.goTo(i);
      this.stepped();
    });
  }

  /**
   * Page Down / Page Up from a clicker: next or back (on the stage, the flyover tilts with them).
   * @returns {boolean} whether it was used
   */
  key(e) {
    if (!this.story || (e.key !== "PageDown" && e.key !== "PageUp") || e.target.closest?.("#stageWrap")) return false;
    if (e.key === "PageDown") this.next();
    else this.back();
    return true;
  }
}
