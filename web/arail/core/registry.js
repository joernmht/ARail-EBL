/**
 * Registry of extension points: object types, simulations, disruption types and vehicle
 * renderers. The built-ins are registered in `arail/index.js`; plugins add their own.
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
   * Register how vehicles of a kind are drawn: `{kind, length_m, width_m, height_m, doors(len), draw(view, vehicle, placement)}`.
   * @param {object} def
   */
  registerVehicle(def) {
    if (!def || !def.kind) throw new Error("Vehicle definitions need a `kind`");
    this.vehicles.set(def.kind, def);
    return def;
  }
}
