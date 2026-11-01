// Story panel: a story of the layout (arail/core/story.js) as steps to click through, the panel of a
// case of Interaction (the app: the infrastructure's disruption, the maintenance story; the railway
// undertaking's, the operations story; the journeys story). Light in text: Back, Next, Play, Start
// again and Camera follows; the bar of the steps (a segment per step, filled as far as the story has
// run; a click on one goes to its step); below it only the step it is at, its title and text. A
// presenter's clicker (Page Down, Page Up) goes on and back while the case is shown. In the flyover the
// camera follows the story (the story's `view()`: the spare unit on its way, the van, the signal, the
// works; the traveller, her bus, her train), from the side the story says, if it says one.
import { storyOf } from "../arail/index.js";
import { h, morph, mount, storage } from "./ui.js";

/** How long the flyover's camera takes to fly to where a step of the story happens (ms): soft, not a jump. */
const AIM_MS = 1000;

/**
 * The steps of a story or a film as a bar: a segment per step, full for those before, filled as far as
 * the one it is at has run. It is one slider: a click on a segment goes to its step (its title is the
 * segment's tooltip), the arrow keys, Home and End step along it. Then where it is ("Step 3 of 12").
 * @param {{titles: string[], index: number, part: number, active?: boolean, word?: string, go: (i: number) => void}} o
 *   the steps' titles, the step it is at and how far it has run (0…1), whether it runs (else nothing
 *   is filled), "Step" or "Scene", and what a click or a key does
 */
export function stepBar({ titles, index, part, active = true, word = "Step", go }) {
  const n = titles.length, at = Math.min(index + 1, n);
  const fill = (i) => (!active ? 0 : i < index ? 1 : i === index ? Math.max(0, Math.min(1, part)) : 0);
  const keys = { ArrowLeft: index - 1, ArrowDown: index - 1, ArrowRight: index + 1, ArrowUp: index + 1, Home: 0, End: n - 1 };
  return h("div", { class: "step-bar" },
    h("div", {
      class: "step-segs", role: "slider", tabindex: "0", "aria-label": `${word}s`, "aria-valuemin": "1", "aria-valuemax": String(n), "aria-valuenow": String(at),
      "aria-valuetext": `${word} ${at} of ${n}: ${titles[index] ?? ""}`,
      onclick: (e) => {
        const seg = e.target.closest?.(".step-seg");
        if (seg) go(Number(seg.dataset.i));
      },
      onkeydown: (e) => {
        if (!(e.key in keys)) return;
        e.preventDefault();
        go(Math.max(0, Math.min(n - 1, keys[e.key])));
      },
    }, titles.map((title, i) => h("span", { class: `step-seg${active && i === index ? " now" : ""}`, "data-i": String(i), title },
      h("i", { style: `--fill: ${Math.round(fill(i) * 100)}%` })))),
    h("span", { class: "step-count", "aria-hidden": "true" }, `${word} ${at} of ${n}`));
}

export class StoryPanel {
  /**
   * @param {object} app the ARail app (app.js)
   * @param {{prefix: string, type: string}} o the prefix of the panel's ids ("infra": #infraStoryNext)
   *   and the story's simulation type
   */
  constructor(app, { prefix, type }) {
    this.app = app;
    this.prefix = prefix;
    this.type = type;
    /** Whether the flyover's camera follows the story. */
    this.follow = storage.get("arail.storyFollow", true) !== false;
    this.el = null;
  }

  /** The layout's story, or null. */
  get story() {
    return storyOf(this.app.world, this.type);
  }

  /** Draw the panel anew. @param {HTMLElement} el the tab's panel */
  render(el) {
    this.el = {
      root: el, controls: h("div", { class: "row story-controls", role: "group", "aria-label": "Story" }),
      bar: h("div", {}), now: h("div", { class: "story-now", "aria-live": "polite" }),
    };
    mount(el, this.el.controls, this.el.bar, this.el.now);
    this.stepped();
  }

  /** Refresh in place (every 400 ms while shown, and after a step). */
  update() {
    const e = this.el;
    if (!e?.root.isConnected) return;
    const story = this.story;
    if (!story) {
      for (const k of ["controls", "bar", "now"]) morph(e[k]);
      return;
    }
    const st = story.state(), id = (x) => `${this.prefix}Story${x}`;
    // pressed while the flyover follows; in the camera view, a press opens the flyover
    const following = this.follow && this.app.mode === "flyover";
    morph(e.controls,
      h("button", { class: "btn", type: "button", id: id("Back"), disabled: st.index === 0, title: "Page Up", "aria-keyshortcuts": "PageUp", onclick: () => this.back() }, "Back"),
      h("button", { class: "btn primary", type: "button", id: id("Next"), disabled: st.finished, title: "Page Down", "aria-keyshortcuts": "PageDown", onclick: () => this.next() }, st.index === st.count - 1 ? "To the end" : "Next"),
      h("button", { class: "btn", type: "button", id: id("Play"), "aria-pressed": st.playing ? "true" : "false", title: "Go on from step to step by itself", onclick: () => this.play() }, "Play"),
      h("button", { class: "btn", type: "button", id: id("Restart"), disabled: st.index === 0 && st.progress >= 1 && !st.playing, onclick: () => this.restart() }, "Start again"),
      h("button", { class: "btn", type: "button", id: id("Follow"), "aria-pressed": following ? "true" : "false", title: "The flyover's camera goes where the story happens.", onclick: () => this.setFollow(!following) }, "Camera follows"));
    morph(e.bar, stepBar({ titles: st.steps.map((s) => s.title), index: st.index, part: st.step.seconds > 0 ? st.progress : 1, go: (i) => this.goTo(i) }));
    morph(e.now,
      h("h3", { id: id("Title") }, st.step.title),
      h("p", {}, st.step.text));
  }

  next() {
    this.story?.next();
    this.stepped();
  }

  back() {
    this.story?.back();
    this.stepped();
  }

  restart() {
    this.story?.restart();
    this.stepped();
  }

  /** After a step began (here, by Play, a clicker or a scenario): the panel, and the camera if it follows. */
  stepped() {
    this.update();
    if (this.follow && this.app.mode === "flyover") this.aim();
  }

  /** The flyover's camera goes to where the story happens and follows it there. */
  aim() {
    const story = this.story, v = story?.view();
    if (!v?.at) return;
    const fly = this.app.flyover;
    fly.follow(() => (this.story === story ? story.view()?.at ?? null : null));
    const rad = (deg) => (Number.isFinite(deg) ? (deg * Math.PI) / 180 : undefined);
    fly.move((k) => k.set({ target: v.at, distance: v.distance, pitch: rad(v.pitch_deg), yaw: rad(v.yaw_deg) }), AIM_MS);
  }

  /** Let the flyover's camera follow the story or not; on, it opens the flyover. */
  setFollow(on) {
    this.follow = on;
    storage.set("arail.storyFollow", on);
    if (on) {
      // from the photo the flyover starts where its camera stands, and flies to the story
      if (this.app.mode !== "flyover") this.app.flyover.enter({ fromPhoto: true });
      this.aim();
    } else this.app.flyover.following = null;
    this.update();
  }

  play() {
    const s = this.story;
    if (!s) return;
    s.play();
    // the story only goes on while the world runs
    if (s.playing && this.app.world.paused) {
      this.app.world.paused = false;
      this.app.panels.updateSimulateControls();
    }
    this.update();
  }

  goTo(i) {
    this.story?.goTo(i);
    this.stepped();
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
