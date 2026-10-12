/**
 * Disruptions of the operations simulation, for the Disruptions panel and for scenarios
 * (`{"at": 60, "start": {"type": "crew-sick", "params": {"count": 3}}}`): short-term changes
 * (sick calls, breakdowns, the workshop closed) and long-term ones (drivers leaving, units out of
 * service for days). They act on the operations engine when they start; they do not change
 * stops directly (`targets: "none"`), and they are only offered when the layout has rail
 * operations (`requires`).
 * @module arail/ops/disruptions
 */
import { opsOf } from "./simulation.js";

const run = (world, event) => opsOf(world)?.inject(event) ?? "no rail operations on this layout";
const common = { targets: "none", requires: "operations", duration: () => 60, appliesTo: () => false };

export const OPS_DISRUPTIONS = [
  {
    ...common,
    type: "crew-sick",
    label: "Drivers call in sick",
    description: "Drivers whose duty has not started yet call in sick at short notice. The dispatcher looks for drivers on stand-by and asks people on a free day.",
    params: [
      { key: "count", label: "Drivers", type: "number", min: 1, max: 20, step: 1, default: 3 },
      { key: "notice_min", label: "Notice", type: "number", unit: "clock min", min: 0, max: 240, step: 5, default: 30 },
    ],
    onStart(d, world) {
      d.result = run(world, { type: "sick", count: d.params.count, notice_min: d.params.notice_min });
    },
  },
  {
    ...common,
    type: "unit-failure",
    label: "Unit failure",
    description: "A unit of a train on its way fails: a breakdown (the train stops or limps on, the unit needs a repair) or a defect it can run with.",
    params: [{ key: "kind", label: "Kind", type: "select", options: [["hard", "breakdown (hard failure)"], ["soft", "defect (soft failure)"]], default: "hard" }],
    onStart(d, world) {
      d.result = run(world, { type: "failure", kind: d.params.kind });
    },
  },
  {
    ...common,
    type: "drivers-leave",
    label: "Drivers leave",
    description: "Drivers leave the company for good, from tomorrow: a long-term shortage that the roster has to absorb.",
    params: [{ key: "count", label: "Drivers", type: "number", min: 1, max: 50, step: 1, default: 4 }],
    onStart(d, world) {
      d.result = run(world, { type: "staff_loss", count: d.params.count });
    },
  },
  {
    ...common,
    type: "workshop-closed",
    label: "Workshop closed",
    description: "The workshop cannot work for a while (a strike, a power cut): jobs wait.",
    params: [{ key: "hours", label: "For", type: "number", unit: "clock h", min: 1, max: 168, step: 1, default: 8 }],
    onStart(d, world) {
      d.result = run(world, { type: "workshop_closed", hours: d.params.hours });
    },
  },
  {
    ...common,
    type: "units-damaged",
    label: "Units damaged",
    description: "Units are out of service for days, e.g. after a collision.",
    params: [
      { key: "count", label: "Units", type: "number", min: 1, max: 10, step: 1, default: 1 },
      { key: "days", label: "For", type: "number", unit: "days", min: 1, max: 60, step: 1, default: 5 },
    ],
    onStart(d, world) {
      d.result = run(world, { type: "unit_out", count: d.params.count, days: d.params.days });
    },
  },
];
