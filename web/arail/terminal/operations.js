/**
 * The container terminal as a simulation (`{"type": "terminal", ...}` in the layout's
 * `simulations`): visits of trains, trucks and barges, gantry cranes and reach stackers moving
 * containers between them and the yard, and model wagons seen by their rolling-stock markers.
 *
 * Runtime state never enters object specs; `toJSON()` returns the configured start state.
 * Requests arrive as method calls (from the app) or as `terminal.request.*` events (from
 * scenarios); see types.js for the events.
 *
 * This is a placeholder with the final interface: it holds no visits, handlers or moves and
 * refuses every request with "The terminal is not implemented yet". It never throws, so layouts
 * with a terminal load and run.
 * @module arail/terminal/operations
 */
import { Simulation } from "../core/simulation.js";
import { Inventory } from "./model.js";
import { decodeTag } from "./rolling.js";

const NOT_IMPLEMENTED = "The terminal is not implemented yet";

export class TerminalSimulation extends Simulation {
  static type = "terminal";
  static label = "Container terminal";
  static description = "Container trains, trucks and barges, handled by gantry cranes and reach stackers.";
  static params = [];

  /**
   * Problems of a terminal entry (validateLayout prefixes them with `simulations[i] (terminal): `).
   * @param {object} cfg the entry of the layout's `simulations`
   * @param {object} layout the normalized layout
   * @returns {string[]}
   */
  static validate(cfg, layout) {
    return [];
  }

  /**
   * @param {import("../core/world.js").World} world
   * @param {object} [config] entry of the layout's `simulations` list
   */
  constructor(world, config = {}) {
    super(world, config);
    /** @type {Inventory} */
    this.inventory = new Inventory();
    /** @type {Map<string, import("./types.js").Visit>} trains, barges, then trucks */
    this.visits = new Map();
    /** @type {Map<string, import("./types.js").Handler>} cranes (in object order), then reach stackers */
    this.handlers = new Map();
    /** @type {import("./types.js").Move[]} in creation order */
    this.moves = [];
    /** @type {import("./rolling.js").RollingStock | null} */
    this.rolling = null;
    /** What the app highlights (drawn in `draw`): the selected container, its targets, the slot numbers. */
    this.highlight = { selected: null, targets: null, slots: false };
  }

  get name() {
    return this.config.name || "Container terminal";
  }

  /* ---------------------------------------------------------------- state */

  /**
   * All carriers: train wagons, model wagons, barges, trucks, yards.
   * @returns {import("./model.js").Carrier[]}
   */
  carriers() {
    return [];
  }

  /** @returns {import("./model.js").Carrier | null} */
  carrier(id) {
    return null;
  }

  /**
   * Carriers of the model wagons seen by their markers.
   * @returns {import("./model.js").Carrier[]}
   */
  markerWagons() {
    return [];
  }

  /**
   * A slot in words, e.g. "Block A · bay 4 · row 2 · tier 1".
   * @param {import("./types.js").SlotRef} ref
   */
  describe(ref) {
    return "";
  }

  /* ---------------------------------------------------------------- visits */

  /**
   * Call a visit (train or barge) to the terminal.
   * @returns {string | null} null = done; else the reason
   */
  call(visitId) {
    return NOT_IMPLEMENTED;
  }

  /**
   * Send a visit away.
   * @param {string} visitId
   * @param {{force?: boolean}} [options] force: cancel its queued moves
   * @returns {string | null} null = done; else the reason
   */
  depart(visitId, { force = false } = {}) {
    return NOT_IMPLEMENTED;
  }

  /**
   * Create a train (and call it).
   * @param {{track?: string, wagons?: string[], load?: "empty"|"random", name?: string|null}} [options]
   * @returns {{visit: import("./types.js").Visit} | {error: string}}
   */
  addTrain({ track, wagons = ["sgns60", "sgns60", "sgns60"], load = "empty", name = null } = {}) {
    return { error: NOT_IMPLEMENTED };
  }

  /**
   * Create a barge (and call it).
   * @param {{quay?: string, length_m?: number, load?: "empty"|"random", name?: string|null}} [options]
   * @returns {{visit: import("./types.js").Visit} | {error: string}}
   */
  addBarge({ quay, length_m = 55, load = "empty", name = null } = {}) {
    return { error: NOT_IMPLEMENTED };
  }

  /**
   * Send a truck to the gate: a pickup truck comes empty, a delivery truck brings a container.
   * @param {{purpose?: "pickup"|"delivery", size?: "20"|"40"|"45"|null}} [options]
   * @returns {{visit: import("./types.js").Visit} | {error: string}}
   */
  sendTruck({ purpose = "pickup", size = null } = {}) {
    return { error: NOT_IMPLEMENTED };
  }

  /* ---------------------------------------------------------------- moves */

  /**
   * Where a container can go now, and the carriers that refuse it (with the reason).
   * @returns {{ok: import("./types.js").Target[], refused: import("./types.js").Refusal[]}}
   */
  targets(containerId) {
    return { ok: [], refused: [] };
  }

  /**
   * Queue a move of a container.
   * @param {string} containerId
   * @param {import("./types.js").SlotRef | {carrier: string} | {kind: string}} to a slot, any free slot of a
   *   carrier, or any free slot on a carrier of a kind (wagon, truck, barge, yard)
   * @param {{source?: "user"|"scenario"}} [options]
   * @returns {{move: import("./types.js").Move} | {error: string}}
   */
  request(containerId, to, { source = "user" } = {}) {
    return { error: NOT_IMPLEMENTED };
  }

  /**
   * Cancel a queued move (or an active one before its container is locked).
   * @returns {string | null} null = done; else the reason
   */
  cancel(moveId) {
    return NOT_IMPLEMENTED;
  }

  /**
   * Queue moves for every container of a visit that can be lifted now, to free slots on carriers
   * of kind `to`; containers that cannot be lifted are listed in `refused`.
   * @param {string} visitId
   * @param {{to?: "yard"|"truck"|"wagon"|"barge"}} [options]
   * @returns {{moves: import("./types.js").Move[], refused: import("./types.js").Refusal[]}}
   */
  unload(visitId, { to = "yard" } = {}) {
    return { moves: [], refused: [] };
  }

  /**
   * Fill a visit's free slots with containers from carriers of kind `from`.
   * @param {string} visitId
   * @param {{from?: "yard"|"truck"|"wagon"|"barge"}} [options]
   * @returns {{moves: import("./types.js").Move[], refused: import("./types.js").Refusal[]}}
   */
  load(visitId, { from = "yard" } = {}) {
    return { moves: [], refused: [] };
  }

  /* ---------------------------------------------------------------- start state */

  /** Restore the configured start state. */
  reset() {}

  /**
   * The current state as a terminal entry for the layout file (a new start state).
   * @returns {object}
   */
  snapshot() {
    return { ...this.config };
  }

  /** Make the current state the start state (the app then saves the layout). */
  saveStart() {
    this.config = this.snapshot();
  }

  /* ---------------------------------------------------------------- picking and drawing helpers */

  /**
   * Boxes (layout mm) of the stored containers of present carriers.
   * @param {import("../core/view.js").View} view
   * @returns {import("./types.js").Box[]}
   */
  boxes(view) {
    return [];
  }

  /**
   * Boxes of the places a container could go now.
   * @returns {{target: import("./types.js").Target, box: import("./types.js").Box}[]}
   */
  targetBoxes(containerId, view) {
    return [];
  }

  /**
   * The carrier whose footprint contains a layout point (mm).
   * @returns {string | null}
   */
  carrierAt(point, view) {
    return null;
  }

  /* ---------------------------------------------------------------- rolling stock */

  /**
   * The layout's normalized `markers.rolling`, or null if the layout has no rolling-stock markers.
   * @returns {object | null}
   */
  rollingConfig() {
    return this.world.layout?.markers?.rolling ?? null;
  }

  /**
   * Height (mm) of a tag above the layout plane: the wagon's `rolling_stock[].height_mm`, else
   * `markers.rolling.height_mm`.
   * @param {number} tagId
   */
  tagHeight(tagId) {
    const r = this.rollingConfig();
    if (!r) return 0;
    const { number } = decodeTag(Number(tagId), r.stride);
    const list = Array.isArray(this.config.rolling_stock) ? this.config.rolling_stock : [];
    const own = list.find((w) => w && Number(w.number) === number)?.height_mm;
    return own != null && Number.isFinite(Number(own)) ? Number(own) : r.height_mm;
  }

  /**
   * Feed the tags seen in one frame.
   * @param {{[tagId: string]: import("./types.js").TagObservation}} observations
   * @param {number} time real seconds
   * @param {{still?: boolean}} [options]
   */
  observe(observations, time, { still = false } = {}) {}

  /** A new image source: the model wagons become "lost". */
  forgetObservations() {}

  /* ---------------------------------------------------------------- Simulation hooks */

  step(dt) {}

  draw(view) {}

  /** Deliberately empty: "Clear passengers" must not empty the terminal. */
  clear() {}

  dispose() {}

  toJSON() {
    return { ...this.config };
  }
}

/**
 * The world's container terminal: its first simulation of type "terminal".
 * @param {import("../core/world.js").World} world
 * @returns {TerminalSimulation | null}
 */
export function terminalOf(world) {
  return world?.simulations?.find((s) => s.constructor.type === TerminalSimulation.type) ?? null;
}
