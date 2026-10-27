/**
 * Disruptions of the railway systems: slippery rails on one track of a platform (wet rails, leaves
 * in autumn, ice). The wheels grip less (rail/dynamics.js): trains start slower and need longer to
 * brake, so they come in and leave later; their running dynamics on the card use the rails'
 * condition while it lasts (rail/ahead.js `railCondition`).
 * @module arail/rail/disruptions
 */
import { CD, rgba } from "../core/colors.js";
import { affectedAreas, dockOf } from "../core/disruptions.js";
import { RAIL_CONDITIONS, approachFactor, trainModel } from "./dynamics.js";
import { trainConsist } from "./trains.js";

/** How much slower trains come in and leave where the dock's train is not known (typical, a regional unit). */
export const SLOW = { wet: 1.15, leaves: 2.2, ice: 1.6 };

/** The colour of slippery rails on the table: Orange (wet rails, leaves), Brillantblau (ice). */
const COLOUR = { wet: CD.orange, leaves: CD.orange, ice: CD.brillantblau };

/**
 * How much slower the trains at a dock come in and leave on rails in a condition: from the running
 * dynamics of the train at it, else typical values.
 */
function slowAt(world, dockId, condition) {
  const v = world.services?.docks.get(dockId)?.vehicle;
  const consist = v ? trainConsist(world, v) : null;
  if (!consist?.vehicles.length) return SLOW[condition] ?? 1;
  return Math.min(10, approachFactor(trainModel(consist), condition));
}

/** The disruption type: slippery rails on one track of a platform. */
export const LOW_ADHESION = {
  type: "low-adhesion",
  label: "Slippery rails",
  description: "Wet rails, leaves or ice on one track of a platform: the wheels grip less, so trains start slower and need longer to brake; they come in and leave later.",
  targets: "track",
  params: [
    { key: "condition", label: "Rails", type: "select", default: "leaves", options: [["wet", RAIL_CONDITIONS.wet.label], ["leaves", RAIL_CONDITIONS.leaves.label], ["ice", RAIL_CONDITIONS.ice.label]] },
    { key: "minutes", label: "Duration", type: "number", unit: "min (simulated)", min: 1, max: 600, step: 1, default: 60 },
  ],
  duration: (p) => p.minutes * 60,
  appliesTo: (area, d) => area.kind === "rail" && !!dockOf(area, d.target),
  /** The rails' condition while it lasts (rail/ahead.js). */
  railCondition: (d) => (RAIL_CONDITIONS[d.params.condition] ? d.params.condition : "leaves"),
  effects(d, area, world) {
    const cond = RAIL_CONDITIONS[d.params.condition] ? d.params.condition : "leaves";
    const left = d.until == null ? "" : ` (${Math.max(0, Math.ceil((d.until - world.time) / 60))} min left)`;
    return { slow: slowAt(world, d.target, cond), mood: -0.002, messages: [`${RAIL_CONDITIONS[cond].label} · trains run slower${left}`] };
  },
  /** A band along the track in the colour of its rails. */
  draw(view, d, world) {
    const cond = RAIL_CONDITIONS[d.params.condition] ? d.params.condition : "leaves";
    for (const area of affectedAreas(d, world)) {
      const dock = dockOf(area, d.target);
      if (!dock) continue;
      const t = (dock.side ?? 1) * (area.W / 2 + 1.75);
      view.ribbon([area.toLayout(0, t), area.toLayout(area.L, t)], view.m(3.2), { fill: rgba(COLOUR[cond], 0.4), order: 20 });
      view.line([area.toLayout(0, t), area.toLayout(area.L, t)], { stroke: rgba(COLOUR[cond], 0.9), width: 2, dash: [4, 4], order: 21 });
    }
  },
};
