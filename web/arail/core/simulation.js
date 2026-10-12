/**
 * Base class for simulations (passenger flows, road traffic, ...).
 *
 * A simulation reads the world (stop areas, vehicles, disruption effects), keeps its own
 * state, and draws on the view. It is created from an entry in the layout's
 * `simulations` list, e.g. `{ "type": "passengers", "base_rate": 0.5 }`.
 * Register subclasses with `registry.registerSimulation(MySimulation)`.
 * See docs/extending.md for a walkthrough.
 * @module arail/core/simulation
 */
export class Simulation {
  /** Unique type name used in layout files. */
  static type = "simulation";
  static label = "Simulation";
  static description = "";
  /** @type {import("./object.js").ParamSpec[]} */
  static params = [];

  /**
   * @param {import("./world.js").World} world
   * @param {object} [config] entry of the layout's `simulations` list
   */
  constructor(world, config = {}) {
    this.world = world;
    const cls = /** @type {typeof Simulation} */ (this.constructor);
    const defaults = {};
    for (const p of cls.params) if (p.default !== undefined) defaults[p.key] = p.default;
    this.config = { ...defaults, ...config, type: cls.type };
    this.enabled = config.enabled !== false;
  }

  /** Advance by `dt` simulated seconds. */
  step(dt) {}

  /** Queue drawing operations. */
  draw(view) {}

  /**
   * Key figures for a stop area (shown on departure boards), or null.
   * @returns {{count: number, mood: number, inPerMin: number, outPerMin: number} | null}
   */
  stats(areaId) {
    return null;
  }

  /**
   * What of this simulation can be pointed at on the stage (people, vehicles; see core/pick.js):
   * a list of pickables with their outline on the layout and `owner: this`.
   * @param {import("./view.js").View} view
   * @returns {import("./pick.js").Pickable[]}
   */
  pickables(view) {
    return [];
  }

  /**
   * The info card of one of its pickables.
   * @param {import("./pick.js").Pickable} hit
   * @returns {import("./pick.js").Card}
   */
  card(hit) {
    return { title: hit.label };
  }

  /**
   * Add what this simulation knows about a layout object to its card (e.g. the people waiting at a
   * stop, the condition of an asset).
   * @param {import("./object.js").LayoutObject} object
   * @param {import("./pick.js").Card} card changed in place
   */
  describeObject(object, card) {}

  /**
   * The card of a person of this simulation that another simulation shows (a resident waiting at a
   * stop is a person of the passenger simulation), or null if the agent is not its own.
   * @param {object} agent
   * @returns {import("./pick.js").Card | null}
   */
  describeAgent(agent) {
    return null;
  }

  /**
   * Add what this simulation knows about a vehicle at a stop to its card (the trip and units of a
   * train of the rail operations).
   * @param {object} vehicle
   * @param {import("./pick.js").Card} card changed in place
   */
  describeVehicle(vehicle, card) {}

  /** Remove all simulated entities (keeps settings). */
  clear() {}

  /** Release resources such as event subscriptions (called when the layout is reloaded). */
  dispose() {}

  toJSON() {
    return { ...this.config };
  }
}
