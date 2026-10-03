/**
 * Disruptions of the infrastructure simulation: faults that players can cause (an asset fails,
 * cable theft, a storm), offered only for layouts with the infrastructure simulation, and the
 * internal disruption with which a fault at the station on the layout holds or slows its trains.
 * @module arail/infra/disruptions
 */
import { infraOf } from "./simulation.js";

const common = { targets: "none", requires: "infrastructure", duration: () => 60, appliesTo: () => false };

export const INFRA_DISRUPTIONS = [
  {
    ...common,
    type: "asset-fault",
    label: "Asset fault",
    description: "An asset of the infrastructure fails now: one on the layout (its name or id), or any asset of the network when the field is empty. How soon it is known depends on what it reports.",
    params: [{ key: "asset", label: "Asset", type: "text", default: "", help: "Name or id of an asset, e.g. a signal on the layout; empty: one by chance." }],
    onStart(d, world) {
      d.result = infraOf(world)?.failAsset(d.params.asset) ?? "no infrastructure simulation on this layout";
    },
  },
  {
    ...common,
    type: "cable-theft",
    label: "Cable theft",
    description: "Thieves cut a signalling cable at night: the signals of its section go dark until it is repaired.",
    params: [],
    onStart(d, world) {
      d.result = infraOf(world)?.inject({ type: "theft" }) ?? "no infrastructure simulation on this layout";
    },
  },
  {
    ...common,
    type: "storm",
    label: "Storm damage",
    description: "A storm brings trees down on the line: overhead lines, signals, GSM-R masts and cable routes are damaged.",
    params: [{ key: "count", label: "Assets damaged", type: "number", min: 1, max: 20, step: 1, default: 4 }],
    onStart(d, world) {
      d.result = infraOf(world)?.inject({ type: "storm", count: d.params.count }) ?? "no infrastructure simulation on this layout";
    },
  },
  {
    // started by the infrastructure simulation itself for a fault at the station on the layout
    type: "infra-fault",
    label: "Infrastructure fault",
    description: "A fault of the infrastructure at the station: trains are held or pass at caution until it is repaired.",
    targets: "rail",
    hidden: true,
    params: [],
    duration: () => null,
    appliesTo: (area, d) => area.kind === "rail" && (d.target === "*" || area.owner?.id === d.target),
    effects: (d) => ({ hold: !!d.params.hold, mood: d.params.hold ? -0.02 : -0.006, messages: [d.params.text || "Infrastructure fault"] }),
  },
];
