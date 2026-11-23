// The workshop manager on the table: the night of arail/game/workshop.js is played in the layout's
// workshop hall (its module Workshop hall, the object `workshop-hall`). While the game is shown, the
// hall draws the game's night instead of its own: every unit on its track or on its way through
// the throat, raised on the jacks, its fitters beside it, the lathe cutting, the lamp at each hall
// track in the colour of its unit's state, a driver at the door of a unit that is released and not
// yet returned to operation. The board adds what can be chosen: a ring under each unit (orange
// while its work waits for a word or an answer, full once it can be released, red when fleet
// management keeps it in) and a faint one at each free track. What a question is about, and what
// is chosen, pulses in the choice's colour. A click chooses, as in the picture of the depot beside
// the table, where the moves are. Nothing is written on the table. Data, geometry and drawing on a
// View: no DOM.
import { CD_LIGHT, OVERLAY, rgba } from "../arail/index.js";
import { HIT_PX, RING } from "./control.js";

/** The colours of the board: as planned, something to look at, a unit kept in, what a question is about or what is chosen. */
const TONE = { plan: CD_LIGHT.tuerkis, warn: CD_LIGHT.orange, bad: CD_LIGHT.rot, choice: OVERLAY.task };
/** How far round the depot the camera looks beside it (layout mm), and how much of the throat beyond the tracks' ends the whole picture keeps (m). */
const MARGIN_MM = 60, THROAT_M = 8;

/**
 * The board of a workshop manager's game on the layout's world: one of the world's simulations. It
 * hands the game's picture of the hall to the layout's workshop hall to draw, and marks what can be
 * chosen. Without a workshop hall in the layout it shows nothing.
 */
export class WorkshopBoard {
  static elevation = "ground";
  static type = "workshop-board";
  /** The modules of the layout that are on while the game is on the table (LiveScene). */
  static layers = ["workshop"];
  /** Where the camera may look ([x0, y0, x1, y1], layout mm): the module Workshop hall, beyond the west end of the lab's table. */
  static area = [-6400, -1100, -3400, 200];
  /** What the parts of the picture are called here (LiveScene.show). */
  static parts = [["west", "The throat"], ["platforms", "Outside"], ["east", "The hall"], ["all", "Whole depot"]];

  /** @param {import("../arail/index.js").World} world the world of the layout the table lies on */
  constructor(world) {
    this.world = world;
    this.enabled = true;
    this.config = { type: WorkshopBoard.type };
    /** @type {import("../arail/game/workshop.js").WorkshopGame | null} the game shown */
    this.game = null;
    /** What is chosen (an item of the game's picture: "unit-103", "track-2"), and the moves offered from it. */
    this.picked = null;
    this.offers = [];
    /** Whether a person can choose (else the board only shows). */
    this.active = false;
    world.simulations.push(this);
  }

  /** The layout's workshop hall (the object), or null. */
  get hall() {
    return this.world.objects.find((o) => o.type === "workshop-hall") ?? null;
  }

  /** Show a game (null: none): the layout's hall draws the game's night. */
  show(game) {
    this.game = game ?? null;
    this.hall?.show(game ? () => game.hall() : null);
  }

  /** Take the board out of its world again: the hall shows its own quiet night again. */
  dispose() {
    this.hall?.show(null);
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
   * Where an item of the game's picture is on the table: a unit ("unit-103": its middle, where it
   * stands or moves), a track ("track-2": the middle of its place); null where there is none (a
   * train of the morning is not on the table).
   * @param {string} item
   * @returns {number[] | null} [x, y, z] layout mm
   */
  placeOf(item) {
    const h = this.hall;
    return h?.geometry && this.game ? h.placeOf(item) : null;
  }

  /** What can be chosen on the table now: the units, and the free tracks; each with its colour and whether it is full. */
  marks(g = this.game) {
    if (!g) return [];
    const out = [];
    for (const u of g.hall().units) {
      out.push({ item: `unit-${u.id}`, tone: u.tone === "bad" ? "bad" : u.waiting ? "warn" : "plan", full: g.releasable(u.id).ok, pulse: u.tone === "wait" });
    }
    for (const t of ["1", "2", "3", "A", "B", "C"]) if (g.isFree(t)) out.push({ item: `track-${t}`, tone: "plan", full: false, faint: true });
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
   * Mark what can be chosen: a ring under each unit and at each free track. No text.
   * @param {import("../arail/index.js").View} view
   */
  draw(view) {
    const g = this.game;
    if (!g || !this.hall?.geometry) return;
    const beat = view.pulse ?? 1, asked = this.asked(g);
    for (const m of this.marks(g)) {
      const p = this.placeOf(m.item);
      if (!p || !view.inImage(p[0], p[1], 0, 200)) continue;
      const chosen = this.picked === m.item, about = asked.has(m.item), pulses = chosen || about || !!m.pulse;
      const colour = chosen || about ? TONE.choice : TONE[m.tone];
      const r = Math.max(view.m(RING.m), (RING.px * view.px) / Math.max(1e-6, view.pxPerMM(p[0], p[1], 0))) * (pulses ? 1 + 0.3 * beat : 1);
      const ring = Array.from({ length: 28 }, (_, i) => [p[0] + r * Math.cos((i * Math.PI) / 14), p[1] + r * 0.62 * Math.sin((i * Math.PI) / 14)]);
      view.polygon(ring, { fill: rgba(colour, chosen ? 0.5 : pulses ? 0.16 + 0.26 * beat : m.full ? 0.34 : m.faint ? 0.03 : 0.08), stroke: rgba(colour, pulses || m.full ? 1 : m.faint ? 0.4 : 0.7), width: pulses || m.full ? 2.2 : 1.2, order: 7, emissive: true });
    }
  }

  /**
   * What of the board is at a pixel: a unit or a free track (`{item}`, the id of the item of the game's picture), or null.
   * @param {import("../arail/index.js").View} view the view of the frame drawn last
   * @param {number[]} pixel [u, v] canvas px
   * @param {number} [scale] how many CSS px a thing may be away, as a factor (a finger: more)
   * @returns {{item: string} | null}
   */
  hit(view, [u, v], scale = 1) {
    const g = this.game;
    if (!g || !this.hall?.geometry) return null;
    let best = null;
    for (const m of this.marks(g)) {
      const q = this.placeOf(m.item), p = q && view.project(q[0], q[1], q[2]), d = p ? Math.hypot(p[0] - u, p[1] - v) : Infinity;
      // (a unit before a free track: the unit is what is meant)
      const near = d - (m.faint ? 0 : 6 * view.px);
      if (d <= HIT_PX.train * view.px * scale && (!best || near < best.near)) best = { near, item: m.item };
    }
    return best ? { item: best.item } : null;
  }

  /** The hall's box and the stabling tracks' on the layout ([x0, y0, x1, y1] each, layout mm), and the throat's end. */
  _boxes() {
    const h = this.hall, P = h?.constructor.plan;
    if (!h?.geometry || !P) return null;
    const box = (x0, y0, x1, y1) => {
      const pts = [h.at(x0, y0), h.at(x1, y0), h.at(x1, y1), h.at(x0, y1)], xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return [Math.min(...xs) - MARGIN_MM, Math.min(...ys) - MARGIN_MM, Math.max(...xs) + MARGIN_MM, Math.max(...ys) + MARGIN_MM];
    };
    return {
      hall: box(P.hall.x0, P.hall.y0, P.hall.x1 + 6, P.hall.y1),
      outside: box(P.hall.x0, P.tracks.A - 4, P.fan_x, P.tracks.C + 3),
      throat: box(P.hall.x1, P.hall.y0, P.lead.x1, P.tracks.C + 3),
      all: box(P.hall.x0, P.hall.y0, P.fan_x + THROAT_M, P.tracks.C + 3),
    };
  }

  /** The part of the depot a place lies in (`bounds`): "east" the hall, "platforms" the stabling tracks outside, "west" the throat. */
  partOf([x, y]) {
    const b = this._boxes();
    if (!b) return "all";
    const within = ([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    return within(b.hall) ? "east" : within(b.outside) ? "platforms" : within(b.throat) ? "west" : "all";
  }

  /**
   * The part of the layout the game needs in the picture ([x0, y0, x1, y1], layout mm): the hall and
   * the stabling tracks with the beginning of the throat (a unit on the move leaves the picture
   * there and comes back), or one part of it ("east": the hall, "platforms": the stabling tracks,
   * "west": the throat and the lead track).
   * @param {"all" | "west" | "platforms" | "east"} [part]
   */
  bounds(part = "all") {
    const b = this._boxes();
    if (!b) return [...WorkshopBoard.area];
    return part === "east" ? b.hall : part === "platforms" ? b.outside : part === "west" ? b.throat : b.all;
  }
}
