// The undertaking's operations control on the table: the regional trains of
// arail/game/transport-control.js are the trains of the signaller's game that runs the same morning,
// and a board marks them where they are on the lab's layout. A train of the undertaking has a thin
// ring; it pulses orange while its passengers have not been told of its delay, and in the choice's
// colour while a question is about it (the feeder that comes late and the train that could wait for
// it). A train of later in the day that is cancelled has a ring on platform 1, where its passengers
// wait, until they are told. A click on a train chooses it, as in the picture of the connections beside the table, where
// its moves are. Nothing is written on the table. Data, geometry and drawing on a View: no DOM.
import { CD_LIGHT, OVERLAY, polylineAt, rgba } from "../arail/index.js";
import { TableBoard } from "./table.js";

/** The colours of the board: a train of the undertaking, one whose passengers wait to be told, one a question is about or that is chosen. */
const TONE = { ours: CD_LIGHT.tuerkis, todo: CD_LIGHT.orange, choice: OVERLAY.task };
/** How near a click must be to a train (CSS px). */
export const HIT_PX = { train: 30 };
/** The ring under a train: its radius on the layout (m at the layout's scale) and the smallest it gets in the picture (CSS px). */
export const RING = { m: 9, px: 9 };
/** How long before its time a train to come is marked at the table's end (s). */
export const AHEAD_S = 240;
/** Platform 1 of the layout (its edge, mm), where the passengers of a cancelled train wait. */
const PLATFORM_1 = [[1615, 425], [4161, 380]];

/** The train a decision's id is about ("hold-RB 34": RB 34), or null. */
const heldIn = (id) => (String(id).startsWith("hold-") ? String(id).slice(5) : null);

/**
 * The board of an operations control's game on the layout's world: one of the world's simulations.
 * It has no trains of its own: it marks those of the signaller's game on the same table
 * (`TableBoard`), and without one it shows nothing.
 */
export class ControlBoard {
  static elevation = "ground";
  static type = "control-board";

  /** @param {import("../arail/index.js").World} world the world of the layout the table lies on */
  constructor(world) {
    this.world = world;
    this.enabled = true;
    this.config = { type: ControlBoard.type };
    /** @type {import("../arail/game/transport-control.js").TransportControlGame | null} the game shown */
    this.game = null;
    /** What is chosen (an item of the game's picture: "train-RB 33"), and the moves offered from it. */
    this.picked = null;
    this.offers = [];
    /** Whether a person can choose (else the board only shows). */
    this.active = false;
    world.simulations.push(this);
  }

  /** Show a game (null: none). */
  show(game) {
    this.game = game ?? null;
  }

  /** Take the board out of its world again. */
  dispose() {
    const sims = this.world.simulations, i = sims.indexOf(this);
    if (i >= 0) sims.splice(i, 1);
  }

  /** The signaller's board on the same table, with the game that runs the trains; null without one. */
  get trains() {
    const b = this.world.simulations.find((s) => s instanceof TableBoard);
    return b?.game ? b : null;
  }

  /**
   * Where a train of the undertaking is on the table: its middle while it runs or stands there, the
   * end of the table it comes in at while it is still to come (from AHEAD_S before its time, or
   * once it is known to be late); null when it has gone, or is not a train of the morning.
   * @param {string} id the train ("RB 33")
   * @returns {number[] | null} [x, y] layout mm
   */
  where(id) {
    const mine = this.game?.train(id);
    // a train of later in the day that is cancelled: on platform 1, where its passengers wait, while they must be told
    if (mine?.cancelled) return this.trains && mine.informed == null ? this.waiting(id) : null;
    const tb = this.trains, tr = tb?.game.trains.find((x) => x.id === id);
    if (!tr || tr.state === "gone") return null;
    const place = tr.state === "coming" ? null : tb.at.place(tr, tb.m);
    if (place?.on) return polylineAt(place.line.points, Math.max(0, Math.min(place.line.total, place.head - (tr.length * tb.at.k) / 2)), place.line.lengths).point;
    if (tr.state !== "coming") return null;
    if (tr.enterAt - tb.game.t > AHEAD_S && !(mine?.delay_min > 0)) return null;
    // the end of the table it comes in at: the line from Bergheim, or from Talsee
    const w = tb.at.way(tr.dir > 0 ? "aw" : "ae", "+", tr.dir);
    return polylineAt(w.points, Math.min(w.total, 160), w.lengths).point;
  }

  /** Where the passengers of a cancelled train wait (the trains of later in the day, side by side along platform 1). */
  waiting(id) {
    const k = Math.max(0, this.game.trains.filter((x) => x.cancelled).findIndex((x) => x.id === id));
    const [a, b] = PLATFORM_1, x = a[0] + (b[0] - a[0]) * (0.75 - 0.12 * k);
    return [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
  }

  /** The trains a question is about now: the train that could be held, and the feeder it would wait for. */
  asked(g = this.game) {
    const out = new Set();
    for (const d of g?.open ?? []) {
      const b = heldIn(d.id), a = b && g.trains.find((x) => x.partner === b && x.feeder);
      if (b) out.add(b);
      if (a) out.add(a.id);
    }
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
   * Mark the undertaking's trains on the table: a ring under each, pulsing where it needs the desk. No text.
   * @param {import("../arail/index.js").View} view
   */
  draw(view) {
    const g = this.game;
    if (!g || !this.trains) return;
    const beat = view.pulse ?? 1, asked = this.asked(g);
    for (const tr of g.trains) {
      const p = this.where(tr.id);
      if (!p || !view.inImage(p[0], p[1], 0, 200)) continue;
      const chosen = this.picked === `train-${tr.id}`, todo = tr.info_since != null && tr.informed == null, about = asked.has(tr.id);
      const colour = chosen || about ? TONE.choice : todo ? TONE.todo : TONE.ours, pulses = chosen || about || todo;
      const r = Math.max(view.m(RING.m), (RING.px * view.px) / Math.max(1e-6, view.pxPerMM(p[0], p[1], 0))) * (pulses ? 1 + 0.3 * beat : 1);
      const ring = Array.from({ length: 28 }, (_, i) => [p[0] + r * Math.cos((i * Math.PI) / 14), p[1] + r * 0.62 * Math.sin((i * Math.PI) / 14)]);
      view.polygon(ring, { fill: rgba(colour, chosen ? 0.5 : pulses ? 0.16 + 0.26 * beat : 0.08), stroke: rgba(colour, pulses ? 1 : 0.7), width: pulses ? 2.2 : 1.2, order: 7, emissive: true });
    }
  }

  /**
   * What of the board is at a pixel: a train of the undertaking (`{item}`, the id of the item of the game's picture), or null.
   * @param {import("../arail/index.js").View} view the view of the frame drawn last
   * @param {number[]} pixel [u, v] canvas px
   * @param {number} [scale] how many CSS px a train may be away, as a factor (a finger: more)
   * @returns {{item: string} | null}
   */
  hit(view, [u, v], scale = 1) {
    const g = this.game;
    if (!g || !this.trains) return null;
    let best = null;
    for (const tr of g.trains) {
      const q = this.where(tr.id), p = q && view.project(q[0], q[1], 0), d = p ? Math.hypot(p[0] - u, p[1] - v) : Infinity;
      if (d <= HIT_PX.train * view.px * scale && (!best || d < best.d)) best = { d, id: tr.id };
    }
    return best ? { item: `train-${best.id}` } : null;
  }

  /** Where an item of the game's picture is on the table ("train-RB 33"), or null. */
  placeOf(item) {
    const [kind, id] = String(item ?? "").split(/-(.*)/s);
    return kind === "train" ? this.where(id) : null;
  }

  /** The part of the station a place lies in, as the signaller's board has it. */
  partOf(place) {
    return this.trains?.partOf(place) ?? "platforms";
  }

  /** The part of the layout the game needs in the picture: the station, as the signaller's board shows it. */
  bounds(part = "all") {
    return (this.trains ?? TableBoard.prototype).bounds.call(this.trains ?? {}, part);
  }
}
