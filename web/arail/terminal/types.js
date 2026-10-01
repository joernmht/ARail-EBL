/**
 * Container terminal: shared types, event names and labels.
 *
 * Units: layout mm for positions, radians for headings, prototype metres for anything named
 * `_m`, simulated seconds for time.
 *
 * Events (emitted on `world.events`; payloads):
 * - `terminal.visit.arriving|arrived|departing|departed`: `{terminal, visit}`
 * - `terminal.move.queued|started|finished|failed|cancelled`: `{terminal, move}`
 * - `terminal.container.moved`: `{terminal, container, from, to, move}`
 * - `terminal.container.added`: `{terminal, container, carrier}`
 * - `terminal.container.left`: `{terminal, container, visit, reason}`
 * - `terminal.wagon.seen|lost`: `{terminal, carrier}`
 * - `terminal.reset`: `{terminal}`
 *
 * Requests (inbound, e.g. scenario `emit` steps; payloads):
 * - `terminal.request.call`: `{visit}`
 * - `terminal.request.depart`: `{visit, force?}`
 * - `terminal.request.move`: `{container, to}`
 * - `terminal.request.truck`: `{purpose?, size?}`
 * - `terminal.request.train`: `{track, wagons?, load?}`
 * - `terminal.request.barge`: `{quay, load?}`
 * - `terminal.request.unload`: `{visit, to?}`
 * - `terminal.request.load`: `{visit, from?}`
 * - `terminal.request.reset`: `{}`
 * @module arail/terminal/types
 */

/** @typedef {{carrier: string, bay: number, row?: number, tier?: number}} SlotRef  row/tier default 0; bay = first bay */
/** @typedef {{id: string, center: number[], heading: number, z0: number, length: number, width: number, height: number}} Box  layout mm */
/** @typedef {Box & {size: "20"|"40"|"45", high: boolean, colour: number[]}} DrawBox  colour = [r, g, b] */
/** @typedef {{at: SlotRef, carrier: string, kind: "wagon"|"truck"|"barge"|"yard", label: string, handler: string}} Target */
/** @typedef {{carrier: string, label: string, reason: string}} Refusal */
/**
 * @typedef {{id: string, container: string, from: SlotRef, to: SlotRef, handler: string,
 *   state: "queued"|"active"|"done"|"failed"|"cancelled", reason: string|null, waiting: string|null,
 *   source: "user"|"scenario", queuedAt: number, startedAt: number|null, doneAt: number|null}} Move
 */
/**
 * A train, barge or truck visiting the terminal (state `waiting` = a truck queued at the gate).
 * @typedef {{id: string, kind: "train"|"barge"|"truck", name: string,
 *   state: "away"|"waiting"|"approaching"|"positioned"|"departing", carriers: import("./model.js").Carrier[],
 *   where: string|null, purpose: "pickup"|"delivery"|null, runtime: boolean}} Visit
 */
/** @typedef {{id: string, kind: "crane"|"reach-stacker", name: string, phase: string, move: string|null}} Handler */
/** @typedef {{center: number[]|null, heading: number|null, edge_mm: number|null}} TagObservation  lifted to the deck plane */

/** Names of the events the terminal emits. */
export const TERMINAL_EVENTS = Object.freeze({
  visitArriving: "terminal.visit.arriving", visitArrived: "terminal.visit.arrived",
  visitDeparting: "terminal.visit.departing", visitDeparted: "terminal.visit.departed",
  moveQueued: "terminal.move.queued", moveStarted: "terminal.move.started", moveFinished: "terminal.move.finished",
  moveFailed: "terminal.move.failed", moveCancelled: "terminal.move.cancelled",
  containerMoved: "terminal.container.moved", containerAdded: "terminal.container.added", containerLeft: "terminal.container.left",
  wagonSeen: "terminal.wagon.seen", wagonLost: "terminal.wagon.lost", reset: "terminal.reset",
});

/** Names of the requests the terminal listens to (e.g. from scenario `emit` steps). */
export const TERMINAL_REQUESTS = Object.freeze({
  call: "terminal.request.call", depart: "terminal.request.depart", move: "terminal.request.move",
  truck: "terminal.request.truck", train: "terminal.request.train", barge: "terminal.request.barge", reset: "terminal.request.reset",
  unload: "terminal.request.unload", load: "terminal.request.load",
});

/** What a crane or reach stacker is doing, by phase (shown in the Crane jobs table). */
export const PHASE_LABELS = Object.freeze({
  idle: "idle", raise: "raising", travel: "moving to the container", lower: "lowering", lock: "locking", lift: "lifting",
  carry: "carrying", "set-down": "setting down", release: "releasing", drive: "driving", park: "driving to its place",
});
