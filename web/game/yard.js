// The yard master on the table: the hump of arail/game/yard.js is the hump yard of the lab's layout
// (its module Hump yard, the object `hump-yard`). While the game is shown, the object draws the
// game's run instead of its own: the train pushed over the crest, the cuts rolling through the
// retarders (orange while they brake) into the six tracks, a wagon red after an impact too hard,
// a track emptied when its train is pulled out. The board adds what can be chosen: a ring at the
// crest (the pushing speed: orange above the automatic's limit), one at the end of each track
// that has an outbound train (orange once it is due and wagons are missing, full while it waits),
// and one round a cut in the wrong track. What a question is about, and what is chosen, pulses in
// the choice's colour. A click chooses, as in the picture of the yard beside the table, where the
// moves are. Nothing is written on the table. Data, geometry and drawing on a View: no DOM.
import { CD_LIGHT, OVERLAY, rgba } from "../arail/index.js";
import { HIT_PX, RING } from "./control.js";

/** The colours of the board: as planned, something to look at, a cut gone wrong, what a question is about or what is chosen. */
const TONE = { plan: CD_LIGHT.tuerkis, warn: CD_LIGHT.orange, bad: CD_LIGHT.rot, choice: OVERLAY.task };
/** A pushing speed above this (m/s) shows orange at the crest: the automatic's limit (PUSH.limit of the game). */
export const FAST_MPS = 1.4;
/** How far round the yard the camera may look, and what it shows of it beside the yard itself (layout mm). */
const MARGIN_MM = 180;
/** Where the parts of the yard end, from the crest towards the tracks (layout mm): the hump, the switches and retarders, the tracks. */
const PARTS_MM = { hump: 700, tracks: 2500 };

/**
 * The board of a yard master's game on the layout's world: one of the world's simulations. It hands
 * the game's hump simulation to the layout's hump yard to draw, and marks what can be chosen.
 * Without a hump yard in the layout it shows nothing.
 */
export class YardBoard {
  static elevation = "ground";
  static type = "yard-board";
  /** The modules of the layout that are on while the game is on the table (LiveScene). */
  static layers = ["hump"];
  /** Where the camera may look ([x0, y0, x1, y1], layout mm): the module Hump yard, west of the lab's table. */
  static area = [-8800, -500, -2000, 1100];
  /** What the parts of the picture are called here (LiveScene.show). */
  static parts = [["west", "The tracks"], ["platforms", "Switches and retarders"], ["east", "The hump"], ["all", "Whole yard"]];

  /** @param {import("../arail/index.js").World} world the world of the layout the table lies on */
  constructor(world) {
    this.world = world;
    this.enabled = true;
    this.config = { type: YardBoard.type };
    /** @type {import("../arail/game/yard.js").YardGame | null} the game shown */
    this.game = null;
    /** What is chosen (an item of the game's picture: "hump", "track-3"), and the moves offered from it. */
    this.picked = null;
    this.offers = [];
    /** Whether a person can choose (else the board only shows). */
    this.active = false;
    world.simulations.push(this);
  }

  /** The layout's hump yard (the object), or null. */
  get yard() {
    return this.world.objects.find((o) => o.type === "hump-yard") ?? null;
  }

  /** Show a game (null: none): the layout's hump yard draws the game's run. */
  show(game) {
    this.game = game ?? null;
    this.yard?.show(game?.sim ?? null);
  }

  /** Take the board out of its world again: the hump yard runs by itself again. */
  dispose() {
    this.yard?.show(null);
    const sims = this.world.simulations, i = sims.indexOf(this);
    if (i >= 0) sims.splice(i, 1);
  }

  /** The items of the game's picture a question is about now. */
  asked(g = this.game) {
    const out = new Set();
    for (const d of g?.open ?? []) for (const id of g.about.get(d.id) ?? []) out.add(id);
    return out;
  }

  /**
   * Where an item of the game's picture is on the table: the hump ("hump": the crest), a
   * classification track ("track-3": its far end, where its train is pulled out), a train in the
   * arrival tracks ("train-56012": the push track before the crest), a cut ("cut-56012/4": where it
   * stands); null where there is none.
   * @param {string} item
   * @returns {number[] | null} [x, y, z] layout mm
   */
  placeOf(item) {
    const y = this.yard, g = this.game;
    if (!y?.geometry || !g) return null;
    const [kind, id] = String(item ?? "").split(/-(.*)/s), yard = y.yard;
    if (kind === "hump") return y.pointAt(null, yard.crest_m);
    if (kind === "train") return y.pointAt(null, Math.max(4, yard.crest_m - 60));
    if (kind === "track") {
      const t = yard.tracks.find((x) => x.name === id);
      return t ? y.pointAt(t.name, t.s1 - 6) : null;
    }
    if (kind === "cut") {
      const c = g.sim.bodies.find((b) => b.id === id);
      return c ? y.pointAt(c.track, Math.max(0, c.s - c.body.length_m / 2)) : null;
    }
    return null;
  }

  /** What can be chosen on the table now: the hump, the tracks, the cuts in a wrong track; each with its colour and whether it is full. */
  marks(g = this.game) {
    if (!g) return [];
    const out = [{ item: "hump", tone: g.inspection != null || g.sim.pushing?.blocked ? "bad" : g.v > FAST_MPS + 1e-9 ? "warn" : "plan", full: g.loco.state === "push" && g.v > 0 }];
    for (const t of g.sim.yard.tracks) {
      const o = g.outbound.find((x) => x.track === t.name);
      if (o && o.pulled_t != null) continue;
      const due = o && g.t >= o.pull - 90 && g.missing(o).length > 0;
      out.push({ item: `track-${t.name}`, tone: due ? "warn" : "plan", full: !!o?.hold_min, faint: !o });
    }
    for (const id of g.wrong.keys()) out.push({ item: `cut-${id}`, tone: "bad", full: false, pulse: true });
    return out;
  }

  step() {}

  pickables() {
    return [];
  }

  states() {
    return [];
  }

  describeObject() {}

  describeVehicle() {}

  toJSON() {
    return { ...this.config };
  }

  /**
   * Mark what can be chosen: a ring at the crest, at each track's end, round a cut gone wrong. No text.
   * @param {import("../arail/index.js").View} view
   */
  draw(view) {
    const g = this.game;
    if (!g || !this.yard?.geometry) return;
    const beat = view.pulse ?? 1, asked = this.asked(g);
    for (const m of this.marks(g)) {
      const p = this.placeOf(m.item);
      if (!p || !view.inImage(p[0], p[1], p[2], 200)) continue;
      const chosen = this.picked === m.item, about = asked.has(m.item), pulses = chosen || about || !!m.pulse;
      const colour = chosen || about ? TONE.choice : TONE[m.tone];
      const r = Math.max(view.m(RING.m), (RING.px * view.px) / Math.max(1e-6, view.pxPerMM(p[0], p[1], p[2]))) * (pulses ? 1 + 0.3 * beat : 1);
      const ring = Array.from({ length: 28 }, (_, i) => [p[0] + r * Math.cos((i * Math.PI) / 14), p[1] + r * 0.62 * Math.sin((i * Math.PI) / 14)]);
      view.polygon(ring, { z: p[2], fill: rgba(colour, chosen ? 0.5 : pulses ? 0.16 + 0.26 * beat : m.full ? 0.34 : m.faint ? 0.03 : 0.08), stroke: rgba(colour, pulses || m.full ? 1 : m.faint ? 0.4 : 0.7), width: pulses || m.full ? 2.2 : 1.2, order: 7, emissive: true });
    }
  }

  /**
   * What of the board is at a pixel: the hump, a track or a cut gone wrong (`{item}`, the id of the item of the game's picture), or null.
   * @param {import("../arail/index.js").View} view the view of the frame drawn last
   * @param {number[]} pixel [u, v] canvas px
   * @param {number} [scale] how many CSS px a thing may be away, as a factor (a finger: more)
   * @returns {{item: string} | null}
   */
  hit(view, [u, v], scale = 1) {
    const g = this.game;
    if (!g || !this.yard?.geometry) return null;
    let best = null;
    for (const m of this.marks(g)) {
      const q = this.placeOf(m.item), p = q && view.project(q[0], q[1], q[2]), d = p ? Math.hypot(p[0] - u, p[1] - v) : Infinity;
      if (d <= HIT_PX.train * view.px * scale && (!best || d < best.d)) best = { d, item: m.item };
    }
    return best ? { item: best.item } : null;
  }

  /** The part of the yard a place lies in (`bounds`): "east" the hump, "platforms" its switches and retarders, "west" the tracks. */
  partOf([x]) {
    const c = this.yard?.geometry?.center;
    if (!c) return "all";
    return x > c[0] - PARTS_MM.hump ? "east" : x < c[0] - PARTS_MM.tracks ? "west" : "platforms";
  }

  /**
   * The part of the layout the game needs in the picture ([x0, y0, x1, y1], layout mm): the whole
   * yard, or one part of it ("east": the push track and the crest, "platforms": the ramp, the
   * switches and the retarders, "west": the classification tracks).
   * @param {"all" | "west" | "platforms" | "east"} [part]
   */
  bounds(part = "all") {
    const o = this.yard?.footprint?.(), c = this.yard?.geometry?.center;
    if (!o || !c) return [...YardBoard.area];
    const xs = o.map((p) => p[0]), ys = o.map((p) => p[1]);
    const [x0, y0, x1, y1] = [Math.min(...xs) - MARGIN_MM, Math.min(...ys) - MARGIN_MM, Math.max(...xs) + MARGIN_MM, Math.max(...ys) + MARGIN_MM];
    if (part === "east") return [c[0] - PARTS_MM.hump - 500, y0, x1, y1];
    if (part === "platforms") return [c[0] - PARTS_MM.tracks - 500, y0, c[0] - PARTS_MM.hump + 400, y1];
    if (part === "west") return [x0, y0, c[0] - PARTS_MM.tracks + 300, y1];
    return [x0, y0, x1, y1];
  }
}
