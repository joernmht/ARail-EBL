/**
 * Stories: short walkthroughs on the layout that a presenter clicks through, step by step
 * ("Signal N2 fails", "Track 2 is closed", "The repair team drives out", …). A story is a
 * simulation in the layout's `simulations` (e.g. `{"type": "maintenance-story"}`); its steps have
 * a title, a text and the seconds their animation runs. The app shows them with Back and Next.
 *
 * What the world shows is a function of the step and of how far its animation has run (0…1): going
 * back, jumping to a step or starting again always gives the same picture. A subclass describes
 * that picture in `compose(index, k)`:
 *
 *   compose(index, k) {
 *     return {
 *       disruptions: [{ id: "closed", type: "track-closure", target: "platform-1:left" }],
 *       focus: ["signal-n2"],     // objects the step is about (outlined by the app)
 *       ...                       // anything else the subclass draws
 *     };
 *   }
 *
 * and draws it in `draw(view)` (`this.scene`). The disruptions of the scene are started and stopped
 * to match, so the trains and passengers of the layout react to the story.
 *
 * A story that drives the engine of a simulation (the rail operations, the journeys) cannot compose
 * its picture from the step alone. It sets `static replay = true`: going to a step starts again
 * (`reset()`) and replays the steps before it, each begun (`enter(j)`) and run to its end at once
 * (`settle(j)`); then the step itself is begun. The world then runs as usual while the step's
 * animation runs.
 *
 * A story that draws a train of its own at a platform holds that track with a "story-train"
 * disruption in its scene (`{id: "rb", type: "story-train", target: "platform-2:right", params:
 * {text: "…"}}`): no timetable train comes there, and the platform shows the story's message.
 *
 * Steps can be retold in the layout (`"steps": [{"id": "fault", "title": "…", "text": "…"}]`, by id).
 * @module arail/core/story
 */
import { Simulation } from "./simulation.js";
import { dockOf } from "./disruptions.js";

/** Seconds (simulated) between two steps while the story plays by itself. */
export const STORY_PAUSE_S = 6;

/**
 * The disruption types of stories (registered with the built-ins). "story-train": a story's own
 * train at one track of a platform (its dock): no timetable train comes to that track, one standing
 * or coming in there is taken away at once, and the platform shows the story's message (`text`),
 * with a warning sign only while there is one.
 */
export const STORY_DISRUPTIONS = [
  {
    type: "story-train",
    label: "A story's train",
    description: "A train of a story stands at one track of a platform, or is due there: no other train comes to that track; the platform shows the story's message.",
    targets: "track",
    hidden: true,
    quiet: true,
    params: [],
    duration: () => null,
    appliesTo: (area, d) => area.kind === "rail" && !!dockOf(area, d.target),
    effects: (d) => ({ closed: true, messages: d.params.text ? [String(d.params.text)] : [] }),
    onStart(d, world) {
      world.services.free(d.target);
    },
  },
];

export class Story extends Simulation {
  static type = "story";
  static label = "Story";
  static description = "A walkthrough of steps to click through.";
  /**
   * The steps: `{id, title, text, seconds}`; seconds (simulated) the step's animation runs.
   * @type {Array<{id: string, title: string, text: string, seconds?: number}>}
   */
  static STEPS = [];
  /** Whether going to a step replays the steps before it (a story that drives an engine). */
  static replay = false;

  constructor(world, config = {}) {
    super(world, config);
    /** The step shown. */
    this.index = 0;
    /** Seconds (simulated) since the step began. */
    this.t = 0;
    /** Whether the story goes on by itself (Play). */
    this.playing = false;
    /** The picture of the current moment (see `compose`). */
    this.scene = null;
    this._started = new Map();
    this._key = null;
    /** Whether the current step has been begun (a replay story begins its first step in the first world step). */
    this._entered = false;
    this._offs = [world.events.on("object.changed", () => (this._key = null)), world.events.on("objects.changed", () => (this._key = null))];
  }

  get active() {
    return this.enabled;
  }

  get name() {
    return this.config.name || this.constructor.label;
  }

  /** The steps, with the texts of the layout (`config.steps`, by id) over the built-in ones. */
  get steps() {
    const own = Array.isArray(this.config.steps) ? this.config.steps : [];
    return this.constructor.STEPS.map((s) => ({ seconds: 0, ...s, ...(own.find((o) => o?.id === s.id) || {}) }));
  }

  /** The current step. */
  get current() {
    return this.steps[this.index];
  }

  /** How far the current step's animation has run (0…1). */
  get progress() {
    const s = +this.current?.seconds || 0;
    return s > 0 ? Math.min(1, this.t / s) : 1;
  }

  /** The last step has run to its end. */
  get finished() {
    return this.index === this.steps.length - 1 && this.progress >= 1;
  }

  /** Show step i from its beginning. */
  goTo(i) {
    const n = this.steps.length;
    if (!n) return;
    const from = this._entered ? this.index : -1;
    this.index = Math.max(0, Math.min(n - 1, Math.round(+i || 0)));
    if (this.constructor.replay) {
      if (this.index === from + 1 && from >= 0) this.settle(from);
      else {
        this.reset();
        for (let j = 0; j < this.index; j++) {
          this.enter(j);
          this.settle(j);
        }
      }
      this.enter(this.index);
    }
    this._entered = true;
    this.t = 0;
    if (this.index === n - 1) this.playing = false;
    this.refresh();
    this.world.events.emit("story.step", { story: this, index: this.index, step: this.current });
  }

  /** A replay story: back to the state before its first step. */
  reset() {}

  /** A replay story: what happens when step `index` begins. */
  enter(index) {}

  /** A replay story: run step `index` on to its end at once. */
  settle(index) {}

  next() {
    if (this.index < this.steps.length - 1) this.goTo(this.index + 1);
    else this.t = +this.current?.seconds || 0;
  }

  back() {
    this.goTo(this.index - 1);
  }

  restart() {
    this.playing = false;
    this.goTo(0);
  }

  /** Run the current step's animation to its end at once. */
  skip() {
    this.t = Math.max(this.t, +this.current?.seconds || 0);
    this.refresh();
  }

  /** Go on by itself (each step to its end, a pause, the next one) or stop. */
  play(on = !this.playing) {
    this.playing = !!on && this.steps.length > 0;
    if (this.playing && this.finished) this.goTo(0);
    this.world.events.emit("story.play", { story: this, playing: this.playing });
  }

  step(dt) {
    if (!this.active || !this.steps.length) return;
    if (!this._entered && this.constructor.replay) this.goTo(this.index);
    const s = +this.current.seconds || 0;
    const before = this.t;
    this.t += dt;
    if (this.playing && this.t >= s + STORY_PAUSE_S) {
      this.next();
      return;
    }
    if (before < s || this._key == null) this.refresh();
  }

  /** Compose the scene of the current moment and bring the world's disruptions in line with it. */
  refresh() {
    if (!this.active || !this.steps.length) {
      this._sync([]);
      this.scene = null;
      return;
    }
    this.scene = this.compose(this.index, this.progress) || {};
    this._key = `${this.index}:${this.progress}`;
    this._sync(this.scene.disruptions || []);
  }

  /**
   * The picture at step `index`, `k` (0…1) into its animation. Subclasses override it.
   * @returns {{disruptions?: Array<{id: string, type: string, target?: string, params?: object}>, focus?: string[]}}
   */
  compose(index, k) {
    return {};
  }

  /** Start and stop the story's disruptions to match the scene (each runs until the scene drops it). */
  _sync(list) {
    const want = new Map(list.map((d) => [`story:${this.constructor.type}:${d.id}`, d]));
    for (const [id, sig] of [...this._started]) {
      const d = want.get(id);
      if (d && JSON.stringify(d) === sig && this.world.disruptions.active.some((x) => x.id === id)) continue;
      this.world.disruptions.stop(id);
      this._started.delete(id);
    }
    for (const [id, d] of want) {
      if (this._started.has(id) || !this.world.registry.disruptions.has(d.type)) continue;
      this.world.disruptions.start({ ...d, id, duration: null });
      this._started.set(id, JSON.stringify(d));
    }
  }

  /**
   * Where to look in the current step, for a virtual camera: `{at: [x, y], distance, pitch_deg, yaw_deg}`
   * (layout mm; the tilt and the direction seen from above optional), or null. Subclasses say it; it
   * may move during the step (a vehicle on its way).
   */
  view() {
    return null;
  }

  /** What the panel shows. */
  state() {
    const steps = this.steps;
    return { index: this.index, count: steps.length, step: steps[this.index] ?? null, steps, progress: this.progress, playing: this.playing, finished: this.finished, focus: this.scene?.focus ?? [] };
  }

  /** Stop playing (Clear passengers); the scene's disruptions start again with the next world step: the step's picture stays. */
  clear() {
    this.playing = false;
    this._sync([]);
    this._key = null;
  }

  dispose() {
    this._offs.forEach((off) => off());
    this._sync([]);
  }
}

/** The layout's story of a type (or its first story), or null. */
export function storyOf(world, type = null) {
  return world.simulations?.find((s) => s instanceof Story && (!type || s.constructor.type === type)) ?? null;
}
