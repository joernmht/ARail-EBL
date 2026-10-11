// Story panel: a story of the layout (arail/core/story.js) as steps to click through, the panel of a
// module's tab (Infrastructure: the maintenance story; Journeys: a traveller's journey). The current
// step with its text and how far its animation has run; Back, Next, Play and Start again; the list of
// all steps to jump to. A presenter's clicker (Page Down, Page Up) goes on and back while the tab is
// shown. In the flyover the camera follows the story (the story's `view()`: the van on its way, the
// signal, the works; the traveller, her bus, her train).
import { storyOf } from "../arail/index.js";
import { h, morph, mount, storage } from "./ui.js";

export class StoryPanel {
  /**
   * @param {object} app the ARail app (app.js)
   * @param {{tab: string, type: string, title: string, empty: string, hint?: string}} o the tab (also the
   *   prefix of the panel's ids), the story's simulation type, the tab's heading, the hint without a
   *   story, and what Settings → Simulation says of the module while the layout does not have it
   */
  constructor(app, { tab, type, title, empty, hint = "" }) {
    this.app = app;
    this.tab = tab;
    this.type = type;
    this.title = title;
    this.empty = empty;
    /** What Settings → Simulation says of the module while the layout does not have it. */
    this.settingsHint = hint;
    /** Whether the flyover's camera follows the story. */
    this.follow = storage.get("arail.storyFollow", true) !== false;
    this.el = null;
  }

  /** The layout's story of this tab, or null. */
  get story() {
    return storyOf(this.app.world, this.type);
  }

  /** Draw the panel anew. @param {HTMLElement} el the tab's panel */
  render(el) {
    this.el = { root: el, head: h("div", { class: "section" }), now: h("div", { class: "section story-now", "aria-live": "polite" }), steps: h("div", { class: "section" }) };
    mount(el, this.el.head, this.el.now, this.el.steps);
    this.stepped();
  }

  /** Refresh in place (every 400 ms while shown, and after a step). */
  update() {
    const e = this.el;
    if (!e?.root.isConnected) return;
    const story = this.story;
    if (!story) {
      morph(e.head, h("h2", { tabindex: "-1" }, this.title), h("p", { class: "hint" }, this.empty));
      morph(e.now);
      morph(e.steps);
      return;
    }
    const st = story.state(), id = (x) => `${this.tab}Story${x}`;
    // pressed while the flyover follows; in the camera view, a press opens the flyover
    const following = this.follow && this.app.mode === "flyover";
    morph(e.head,
      h("h2", { tabindex: "-1" }, story.name),
      h("p", { class: "hint" }, story.constructor.description),
      h("div", { class: "row story-controls", role: "group", "aria-label": "Story" },
        h("button", { class: "btn", type: "button", id: id("Back"), disabled: st.index === 0, onclick: () => this.back() }, "Back"),
        h("button", { class: "btn primary", type: "button", id: id("Next"), disabled: st.finished, onclick: () => this.next() }, st.index === st.count - 1 ? "To the end" : "Next"),
        h("button", { class: "btn", type: "button", id: id("Play"), "aria-pressed": st.playing ? "true" : "false", title: "Go on from step to step by itself", onclick: () => this.play() }, "Play"),
        h("button", { class: "btn", type: "button", id: id("Restart"), disabled: st.index === 0 && st.progress >= 1 && !st.playing, onclick: () => this.restart() }, "Start again"),
        h("button", { class: "btn", type: "button", id: id("Follow"), "aria-pressed": following ? "true" : "false", onclick: () => this.setFollow(!following) }, "Camera follows")),
      h("p", { class: "hint" }, this.app.mode === "flyover" ? "The flyover's camera goes where the story happens." : "Some steps happen beside the table: Camera follows opens the flyover and goes there."),
    );
    const pct = Math.round(st.progress * 100);
    morph(e.now,
      h("p", { class: "story-count" }, `Step ${st.index + 1} of ${st.count}`),
      h("h3", { id: id("Title") }, st.step.title),
      h("p", {}, st.step.text),
      st.step.seconds > 0 ? h("div", { class: "story-progress", role: "progressbar", "aria-labelledby": id("Title"), "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) }, h("i", { style: { width: `${pct}%` } })) : null,
    );
    morph(e.steps,
      h("h2", {}, "All steps"),
      h("ol", { class: "story-steps" }, st.steps.map((s, i) => h("li", { class: i < st.index ? "done" : i === st.index ? "now" : "" },
        h("button", { class: "link", type: "button", "aria-current": i === st.index ? "step" : null, onclick: () => this.goTo(i) }, s.title)))),
      h("p", { class: "hint" }, "A presenter's clicker works too: Page Down for the next step, Page Up for the one before."),
    );
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
    fly.move((k) => k.set({ target: v.at, distance: v.distance, pitch: v.pitch_deg ? (v.pitch_deg * Math.PI) / 180 : undefined }));
  }

  /** Let the flyover's camera follow the story or not; on, it opens the flyover. */
  setFollow(on) {
    this.follow = on;
    storage.set("arail.storyFollow", on);
    if (on) {
      if (this.app.mode !== "flyover") this.app.flyover.enter();
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
    this.el?.now.querySelector("h3")?.scrollIntoView?.({ block: "nearest" });
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
