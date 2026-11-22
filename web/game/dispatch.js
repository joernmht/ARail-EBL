// The train dispatcher on the table: the trains of arail/game/dispatcher.js are the trains of the
// signaller's game that runs the same morning, and a board marks them where they are on the lab's
// layout, as the operations control's board does (control.js). Every train has a thin ring: Türkis
// while it runs as planned, orange once it is known to be late; a train that waits by an order has
// a full ring; the trains a question is about, and the one chosen, pulse in the choice's colour (the
// train that could wait and the one it would wait for). A click on a train chooses it, as in the
// picture of the tracks beside the table, where its orders are. Nothing is written on the table.
// Data, geometry and drawing on a View: no DOM.
import { CD_LIGHT, OVERLAY, rgba } from "../arail/index.js";
import { ControlBoard, RING } from "./control.js";

/** The colours of the board: a train as planned, one that is late, one a question is about or that is chosen. */
const TONE = { plan: CD_LIGHT.tuerkis, late: CD_LIGHT.orange, choice: OVERLAY.task };
/** A train counts as late on the board from this (s). */
export const LATE_S = 60;

/**
 * The board of a train dispatcher's game on the layout's world: one of the world's simulations.
 * It has no trains of its own: it marks those of the signaller's game on the same table, and
 * without one it shows nothing.
 */
export class DispatchBoard extends ControlBoard {
  static elevation = "ground";
  static type = "dispatch-board";

  /** @param {import("../arail/index.js").World} world the world of the layout the table lies on */
  constructor(world) {
    super(world);
    this.config = { type: DispatchBoard.type };
    /** @type {import("../arail/game/dispatcher.js").DispatcherGame | null} the game shown */
    this.game = null;
  }

  /** The trains a question is about now: the train that could wait or go elsewhere, and the one it is about. */
  asked(g = this.game) {
    const out = new Set();
    for (const d of g?.open ?? []) for (const id of g.about.get(d.id) ?? []) out.add(id);
    return out;
  }

  /**
   * Mark the trains on the table: a ring under each, full where it waits by an order, pulsing where a question is about it. No text.
   * @param {import("../arail/index.js").View} view
   */
  draw(view) {
    const g = this.game;
    if (!g || !this.trains) return;
    const beat = view.pulse ?? 1, asked = this.asked(g);
    for (const tr of g.trains) {
      const p = this.where(tr.id);
      if (!p || !view.inImage(p[0], p[1], 0, 200)) continue;
      const chosen = this.picked === `train-${tr.id}`, about = asked.has(tr.id), waits = tr.out_s == null && tr.order?.minutes > 0;
      const colour = chosen || about ? TONE.choice : tr.in_s >= LATE_S ? TONE.late : TONE.plan, pulses = chosen || about;
      const r = Math.max(view.m(RING.m), (RING.px * view.px) / Math.max(1e-6, view.pxPerMM(p[0], p[1], 0))) * (pulses ? 1 + 0.3 * beat : 1);
      const ring = Array.from({ length: 28 }, (_, i) => [p[0] + r * Math.cos((i * Math.PI) / 14), p[1] + r * 0.62 * Math.sin((i * Math.PI) / 14)]);
      view.polygon(ring, { fill: rgba(colour, chosen ? 0.5 : pulses ? 0.16 + 0.26 * beat : waits ? 0.34 : 0.08), stroke: rgba(colour, pulses || waits ? 1 : 0.7), width: pulses || waits ? 2.2 : 1.2, order: 7, emissive: true });
    }
  }
}
