// The introduction (the case Introduction, the app's first scenario): the layout in a short film of
// scenes (arail/core/intro.js) about what is real in the lab and what the app adds. Each scene
// takes the stage to its place, the photo alone, the photo with what the app draws over it, or the
// flyover over the place, outlines what it is about (real things in Türkis, virtual ones in
// Orange) and says it in a few sentences with its figures. Play goes on from scene to scene by
// itself, the camera turning slowly as in a film; Back and Next step, the list jumps, and a
// presenter's clicker (Page Down, Page Up) steps too. While the card of something tapped on the
// stage is open, the film waits.
import { introScenes, objectPickable, OVERLAY, toRad } from "../arail/index.js";
import { outline } from "./inspect.js";
import { h, morph, mount } from "./ui.js";

/** How long the stage takes to go to a scene's place, and to fade what the app draws in or out (ms). */
const MOVE_MS = 1400, FADE_MS = 900;
/** How far the flyover's camera turns while a scene is shown (degrees): the slow drift of a film. */
const DRIFT_DEG = 8;
/** Pitch of the flyover's camera: at a scene's place, and over the whole layout. */
const PITCH_PLACE = toRad(50), PITCH_ALL = toRad(40);
/** The kinds of scenes, as their badge says them. */
const KINDS = { real: "Real", virtual: "Virtual", both: "Real and virtual" };
/** At most this many objects of a scene are outlined. */
const OUTLINES_MAX = 400;
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export class IntroPanel {
  /**
   * @param {import("./app.js").App} app
   * @param {import("./cases.js").Case} owner the case it is the panel of (its Play starts the case)
   */
  constructor(app, owner) {
    this.app = app;
    this.owner = owner;
    /** The scene shown. */
    this.index = 0;
    /** How many scenes have been shown since the film started (the task's progress). */
    this.seen = 0;
    /** Whether the film goes on by itself. */
    this.playing = false;
    /** Whether the film runs (from its start until its case stops): the stage follows its scenes. */
    this.active = false;
    this.el = null;
    this._scenes = [];
    this._key = null;
    this._photo = null;
    this._timer = null;
    this._drift = null;
    this._fading = null;
    this._t0 = 0;
    this._yaw = null;
    // a hand on the stage takes over the camera: the scene does not turn it any more
    for (const type of ["pointerdown", "wheel"]) app.canvas.addEventListener(type, () => (this._touched = true), { passive: true });
  }

  /** The scenes of the layout shown, made again when it changes. */
  get scenes() {
    const app = this.app, w = app.world, photo = this._photo ?? this._hasPhoto();
    const key = `${app.layoutUrl}|${w.objectsVersion}|${w.map.version}|${app.layersOn().join(",")}|${photo}`;
    if (key !== this._key) {
      this._key = key;
      this._scenes = introScenes(w, { photo });
      if (this.index >= this._scenes.length) this.index = 0;
    }
    return this._scenes;
  }

  /** Is the layout shown over a tracked photo, video or the camera (the film can show the photo alone)? */
  _hasPhoto() {
    const s = this.app.source;
    return !!s && !s.stale && !s.untracked && !!this.app.tracker.state.H;
  }

  /* ---------------------------------------------------------------- panel */

  /** Draw the panel anew. @param {HTMLElement} el the case's place */
  render(el) {
    this.el = {
      root: el, now: h("div", { class: "section intro-now", "aria-live": "polite" }),
      controls: h("div", { class: "row story-controls", role: "group", "aria-label": "Film" }), scenes: h("div", { class: "section" }),
    };
    mount(el, this.el.now, this.el.controls, this.el.scenes);
    this.update();
  }

  /** Refresh in place (every 400 ms while shown, and after a scene began). */
  update() {
    const e = this.el;
    if (!e?.root.isConnected) return;
    const scenes = this.scenes, s = scenes[this.index];
    if (!s) return;
    const pct = this.playing ? Math.round(100 * Math.min(1, (performance.now() - this._t0) / (s.seconds * 1000))) : null;
    morph(e.now,
      h("p", { class: "intro-meta" }, h("span", { class: `intro-kind ${s.kind}` }, KINDS[s.kind]), h("span", { class: "story-count" }, `Scene ${this.index + 1} of ${scenes.length}`)),
      h("h3", { id: "introTitle" }, s.title),
      s.text.map((t) => h("p", {}, t)),
      s.facts.length ? h("dl", { class: "intro-facts" }, s.facts.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, String(v))))) : null,
      pct != null ? h("div", { class: "story-progress", role: "progressbar", "aria-labelledby": "introTitle", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) }, h("i", { style: { width: `${pct}%` } })) : null,
    );
    const last = this.index >= scenes.length - 1;
    morph(e.controls,
      h("button", { class: "btn", type: "button", id: "introBack", disabled: !this.active || this.index === 0, onclick: () => this.back() }, "Back"),
      h("button", { class: "btn primary", type: "button", id: "introPlay", "aria-pressed": this.playing ? "true" : "false", title: "Go on from scene to scene by itself", onclick: () => this.play() }, "Play"),
      h("button", { class: "btn", type: "button", id: "introNext", disabled: this.active && last, onclick: () => this.next() }, "Next"),
      h("button", { class: "btn", type: "button", id: "introRestart", disabled: !this.active || (this.index === 0 && !this.playing), onclick: () => this.restart({ play: false }) }, "Start again"),
    );
    morph(e.scenes,
      h("h2", {}, "All scenes"),
      h("ol", { class: "story-steps" }, scenes.map((x, i) => h("li", { class: !this.active ? "" : i < this.index ? "done" : i === this.index ? "now" : "" },
        h("button", { class: "link", type: "button", "aria-current": this.active && i === this.index ? "step" : null, onclick: () => this.goTo(i) }, x.title)))),
      h("p", { class: "hint" }, "A presenter's clicker works too: Page Down for the next scene, Page Up for the one before."),
    );
  }

  /** A story went on: the panel (the app calls it for the panel of the case shown). */
  stepped() {
    this.update();
  }

  /* ---------------------------------------------------------------- the film */

  /** Start the film from its first scene (Start, Start again); playing, or waiting for Next. */
  restart({ play = true } = {}) {
    this._photo = this._hasPhoto();
    this._key = null; // the scenes as the stage is now
    this._yaw = this.app.flyover.cam.yaw;
    this.active = true;
    this.playing = play && this.scenes.length > 1;
    this.seen = 0;
    this.goTo(0);
  }

  /** Show scene i from its beginning (before the film started, Next and the list start it). */
  goTo(i) {
    if (!this.active) return this._begin(() => this._step(i));
    const n = this.scenes.length;
    if (!n) return;
    this.index = Math.max(0, Math.min(n - 1, i));
    this.seen = Math.max(this.seen, this.index + 1);
    if (this.index === n - 1) this.playing = false;
    this._t0 = performance.now();
    this._show(this.scenes[this.index]);
    this._schedule();
    this.update();
  }

  next() {
    if (!this.active) return this._begin(() => this._step(1));
    this.goTo(this.index + 1);
  }

  /** Scene i, stepped to by hand: the film waits for the next step. */
  _step(i) {
    this.playing = false;
    this.goTo(i);
  }

  back() {
    this.goTo(this.index - 1);
  }

  /** Play or pause; at its end, Play starts the film again. */
  play() {
    if (!this.active) return this._begin(() => {});
    if (!this.playing && this.index >= this.scenes.length - 1) return this.restart({ play: true });
    this.playing = !this.playing;
    // a scene paused and played again runs its full time
    if (this.playing) this._t0 = performance.now();
    this._schedule();
    this.update();
  }

  /** The film stops (its case is left): the stage keeps where it is, the photo shows everything again. */
  stop() {
    this.active = false;
    this.playing = false;
    clearTimeout(this._timer);
    clearTimeout(this._drift);
    this._photo = null;
    this._fade(1);
    this.update();
  }

  /** Start the case first (Start shows the first scene and plays), then do what was asked. */
  async _begin(then) {
    await this.app.startCase(this.owner.id);
    if (this.active) then();
  }

  /** The next scene when this one's time is up, while the film plays. */
  _schedule() {
    clearTimeout(this._timer);
    if (!this.playing) return;
    const s = this.scenes[this.index];
    this._timer = setTimeout(() => this._tick(), Math.max(0, s.seconds * 1000 - (performance.now() - this._t0)));
  }

  _tick() {
    if (!this.playing) return;
    // the film waits while a card is open on the stage, and while its case is not shown
    if (this.app.inspector.open || this.app.shownCase?.panel !== this) {
      this._timer = setTimeout(() => this._tick(), 1000);
      return;
    }
    this.goTo(this.index + 1);
  }

  /** Take the stage to a scene: the photo (alone, or with what the app draws) or the flyover over its place. */
  _show(s) {
    const app = this.app, fly = app.flyover;
    clearTimeout(this._drift);
    this._touched = false;
    const src = app.source;
    if (s.view === "camera" && src && !src.stale) {
      fly.leave();
      this._fade(s.overlay);
      return;
    }
    this._fade(1);
    if (!fly.active) fly.enter();
    fly.following = null;
    const c = app.canvas, aspect = c.width / Math.max(1, c.height);
    // each scene a little from another side, as a camera would go round the layout
    const yaw = this._yaw + toRad(14) * ((this.index % 3) - 1);
    fly.move((k) => k.set({ yaw, pitch: s.bounds ? PITCH_PLACE : PITCH_ALL }).fit(s.bounds ?? fly.sceneBounds(), aspect, 0.1), MOVE_MS);
    // then the camera turns slowly while the scene is shown (not when people move it, nor without motion)
    if (this.playing && !reducedMotion()) {
      this._drift = setTimeout(() => {
        if (!this._touched && this.active && fly.active) fly.move((k) => k.orbit(toRad(DRIFT_DEG)), Math.max(1000, s.seconds * 1000 - MOVE_MS));
      }, MOVE_MS);
    }
  }

  /** Fade what the app draws over the camera image to this share (app.fade, 0…1). */
  _fade(to) {
    const app = this.app, from = app.fade;
    cancelAnimationFrame(this._fading);
    if (reducedMotion() || from === to) {
      app.fade = to;
      return;
    }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / FADE_MS);
      app.fade = from + (to - from) * k;
      if (k < 1) this._fading = requestAnimationFrame(step);
    };
    this._fading = requestAnimationFrame(step);
  }

  /**
   * Outline what the scene is about (the app draws it after the stage): real things in Türkis,
   * virtual ones in Orange.
   */
  drawFocus(ctx, view) {
    const s = this.active ? this.scenes[this.index] : null;
    if (!s?.focus.length) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineJoin = "round";
    for (const id of s.focus.slice(0, OUTLINES_MAX)) {
      const o = this.app.world.getObject(id);
      if (o?.geometry) outline(ctx, view, objectPickable(o), o.real ? OVERLAY.tracked : OVERLAY.selection, 2);
    }
    ctx.restore();
  }

  /**
   * Page Down / Page Up from a clicker: the next scene or the one before (on the stage, the flyover
   * tilts with them).
   * @returns {boolean} whether it was used
   */
  key(e) {
    if ((e.key !== "PageDown" && e.key !== "PageUp") || e.target.closest?.("#stageWrap")) return false;
    if (e.key === "PageDown") this.next();
    else this.back();
    return true;
  }
}
