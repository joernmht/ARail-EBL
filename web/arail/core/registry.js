/**
 * Registry of extension points: object types, simulations, disruption types, vehicle renderers,
 * what info cards add (card providers) and checks of layout files. The built-ins are registered in
 * `arail/index.js`; plugins add their own.
 * @module arail/core/registry
 */
export class Registry {
  constructor() {
    /** @type {Map<string, typeof import("./object.js").LayoutObject>} */
    this.objects = new Map();
    /** @type {Map<string, any>} simulation classes by type */
    this.simulations = new Map();
    /** @type {Map<string, object>} disruption definitions by type */
    this.disruptions = new Map();
    /** @type {Map<string, object>} vehicle renderers by kind */
    this.vehicles = new Map();
    /** @type {Map<string, Function>} card providers by name: `(world, hit, card)` adds to the info card of what is pointed at */
    this.cards = new Map();
    /** @type {Map<string, Function>} layout checks by name: `(json)` returns problems of a layout file (texts) */
    this.checks = new Map();
  }

  /** Register a LayoutObject subclass (its static `type` is the key). */
  registerObject(cls) {
    if (!cls || !cls.type || cls.type === "object") throw new Error("Object classes need a static `type`");
    this.objects.set(cls.type, cls);
    return cls;
  }

  /** Register a Simulation subclass (its static `type` is the key). */
  registerSimulation(cls) {
    if (!cls || !cls.type) throw new Error("Simulation classes need a static `type`");
    this.simulations.set(cls.type, cls);
    return cls;
  }

  /**
   * Register a disruption type, see `core/disruptions.js` for the definition format.
   * @param {object} def
   */
  registerDisruption(def) {
    if (!def || !def.type) throw new Error("Disruption definitions need a `type`");
    this.disruptions.set(def.type, def);
    return def;
  }

  /**
   * Register a card provider: `fn(world, hit, card)` adds to the info card of what is pointed at
   * (core/pick.js), e.g. the train data of a train.
   * @param {string} name
   * @param {(world: object, hit: object, card: object) => void} fn
   */
  registerCard(name, fn) {
    if (typeof fn !== "function") throw new Error("A card provider is a function");
    this.cards.set(name, fn);
    return fn;
  }

  /**
   * Register a check of layout files: `fn(json)` returns the problems it finds (texts), shown with
   * those of `validateLayout`.
   * @param {string} name
   * @param {(json: object) => string[]} fn
   */
  registerCheck(name, fn) {
    if (typeof fn !== "function") throw new Error("A layout check is a function");
    this.checks.set(name, fn);
    return fn;
  }

  /**
   * Register how vehicles of a kind are drawn: `{kind, length_m, width_m, height_m, doors(len), draw(view, vehicle, placement)}`.
   * @param {object} def
   */
  registerVehicle(def) {
    if (!def || !def.kind) throw new Error("Vehicle definitions need a `kind`");
    this.vehicles.set(def.kind, def);
    return def;
  }
}
