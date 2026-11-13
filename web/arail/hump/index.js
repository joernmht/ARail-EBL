/**
 * The hump yard (Ablaufberg): public names. It runs on its own for now (issue #236): no world, no
 * registration, not exported by arail/index.js.
 *
 *   import { standardYard, HumpSimulation, randomTrain } from "./hump/index.js";
 *   const yard = standardYard();
 *   const sim = new HumpSimulation(yard, { seed: 1 });
 *   sim.hump({ id: "53201", wagons: [{ type: "eanos", loaded: 1, track: "3" }, …] });
 *   const results = sim.run();
 *
 * See docs/hump-yard.md.
 * @module arail/hump
 */
export {
  G, AIR_DENSITY, ROTATING_T_PER_AXLE, ROLLING, SEASONS, START_EXTRA, AIR, curveResistance, SWITCHES, RETARDERS, SPEEDS, CONTROL, WAGONS,
  TRACK_DESIGNS, STANDARD_YARD,
} from "./params.js";
export { HumpYard, standardYard } from "./yard.js";
export { wagonType, wagonTypes, axlePositions, makeWagon, cutsOf, CUT_SIZES, randomTrain } from "./cuts.js";
export { cutBody, cutForces, coast, requiredSpeeds, timeRun, energyHeight } from "./physics.js";
export { HumpControl } from "./control.js";
export { SIM_DEFAULTS, HumpSimulation } from "./simulation.js";
