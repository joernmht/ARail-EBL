/**
 * Base class of everything that can be placed on a layout (platforms, bus terminals,
 * buildings, trees, ...). To add a new kind of object, extend this class, describe its
 * parameters in `static params` and register it: `registry.registerObject(MyObject)`.
 * See docs/extending.md.
 * @module arail/core/object
 */
import { pointInPolygon, pointSegment } from "./math.js";
import { translatePoint } from "./anchors.js";
import { OVERLAY } from "./colors.js";

/**
 * Description of an editable parameter; the app builds its property forms from these.
 * @typedef {object} ParamSpec
 * @property {string} key name in the layout file (use unit suffixes: _mm = model mm, _m = prototype metres, _s = seconds)
 * @property {string} label
 * @property {"number" | "text" | "select" | "boolean" | "color" | "marker" | "object"} type
 * @property {*} [default]
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {string} [unit]
 * @property {Array<[string, string]>} [options] for "select": [value, label]
 * @property {string} [objectType] for "object": only offer objects of this type
 * @property {string} [help]
 */

export class LayoutObject {
  /** Unique type name used in layout files, e.g. "platform". */
  static type = "object";
  /** Human-readable name. */
  static label = "Object";
  static description = "";
  /** Group in the object palette of the editor. */
  static category = "Scenery";
  /**
   * How the editor places a new object:
   * "point" (tap once), "segment" (two points or two markers), "polygon", "polyline",
   * "rect" (two opposite corners, e.g. table modules: `position` = the centre, `width_mm`, `depth_mm`),
   * "stops" (tap stops in order, e.g. bus lines: `spec.stops` = their ids; `static stopTypes` lists the types).
   */
  static placement = "point";
  /** @type {ParamSpec[]} */
  static params = [];

  /** Default values of all parameters. */
  static defaults() {
    const d = {};
    for (const p of this.params) if (p.default !== undefined) d[p.key] = structuredClone(p.default);
    return d;
  }

  /**
   * @param {import("./world.js").World} world
   * @param {object} spec object entry of the layout file (id, type, geometry, parameters)
   */
  constructor(world, spec) {
    this.world = world;
    const cls = /** @type {typeof LayoutObject} */ (this.constructor);
    this.spec = { ...cls.defaults(), ...structuredClone(spec), type: cls.type };
    /** Keys given in the layout file or set later; written back even if equal to the default. */
    this._explicit = new Set(Object.keys(spec));
    this.id = this.spec.id;
    this._specVersion = 0;
    this._cacheKey = null;
    this._geometry = null;
  }

  get type() {
    return /** @type {typeof LayoutObject} */ (this.constructor).type;
  }

  get name() {
    return this.spec.name || this.id;
  }

  /** Model scale helpers: prototype metres <-> model millimetres. */
  mm(meters) {
    return (meters * 1000) / this.world.scale;
  }

  meters(mm) {
    return (mm * this.world.scale) / 1000;
  }

  /**
   * Derived geometry in layout mm, recomputed when the spec, the marker map or the scale
   * changed. Returns null while the object cannot be placed (e.g. its marker is unknown).
   */
  get geometry() {
    const key = `${this.world.map.version}:${this._specVersion}:${this.world.scale}`;
    if (key !== this._cacheKey) {
      this._cacheKey = key;
      this._geometry = this.computeGeometry();
    }
    return this._geometry;
  }

  /** Override: compute geometry from `this.spec` (use `resolvePoint` & co. for positions). */
  computeGeometry() {
    return null;
  }

  /** Change parameters (and/or geometry) of the object. */
  set(patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (k === "id" || k === "type") continue;
      if (v === undefined) {
        delete this.spec[k];
        this._explicit.delete(k);
      } else {
        this.spec[k] = v;
        this._explicit.add(k);
      }
    }
    this._specVersion++;
    this.world.objectChanged(this);
  }

  /** Outline on the layout (mm) for selection and hit testing. Override for non-point objects. */
  footprint() {
    const g = this.geometry;
    if (!g || !g.center) return null;
    const r = this.mm(3);
    return [[g.center[0] - r, g.center[1] - r], [g.center[0] + r, g.center[1] - r], [g.center[0] + r, g.center[1] + r], [g.center[0] - r, g.center[1] + r]];
  }

  /** Is the layout point (mm) on this object? */
  contains(p, toleranceMM = 0) {
    const fp = this.footprint();
    if (!fp) return false;
    if (pointInPolygon(p, fp)) return true;
    if (toleranceMM > 0) {
      for (let i = 0; i < fp.length; i++) if (pointSegment(p, fp[i], fp[(i + 1) % fp.length]).distance <= toleranceMM) return true;
    }
    return false;
  }

  /** Where labels and the editor handle go (layout mm). */
  anchorPoint() {
    const fp = this.footprint();
    if (!fp) return null;
    return [fp.reduce((s, p) => s + p[0], 0) / fp.length, fp.reduce((s, p) => s + p[1], 0) / fp.length];
  }

  /** Move the object by (dx, dy) layout mm (used when dragging in the editor). */
  translate(dx, dy) {
    const map = this.world.map;
    const patch = {};
    if (this.spec.position) patch.position = translatePoint(map, this.spec.position, dx, dy);
    if (this.spec.from) patch.from = translatePoint(map, this.spec.from, dx, dy);
    if (this.spec.to) patch.to = translatePoint(map, this.spec.to, dx, dy);
    if (Array.isArray(this.spec.points)) patch.points = this.spec.points.map((p) => translatePoint(map, p, dx, dy));
    if (Object.keys(patch).length) this.set(patch);
  }

  /**
   * Height (layout mm) up to which the object is pointed at in the image (walls, masts, roofs; see
   * core/pick.js). 0: on the ground only.
   */
  pickHeight() {
    return 0;
  }

  /**
   * What the info card says about the object (see core/pick.js): its name, its type and what
   * its parameters say. Types add what they know (a building its residents, a platform its
   * tracks); simulations add what they know about it (`describeObject`), e.g. the next trains.
   * @returns {import("./pick.js").Card}
   */
  card() {
    const cls = /** @type {typeof LayoutObject} */ (this.constructor);
    const rows = [];
    const layers = this.world.layers?.() || [];
    // the module (layer) it comes from, when it is not the base
    const layer = layers.length ? layers.find((l) => l.id === this.world.layerOf(this.id)) : null;
    if (layer) rows.push(["Module", layer.name]);
    return { title: this.spec.name || cls.label, subtitle: this.spec.name ? cls.label : this.id, rows, text: cls.description || "" };
  }

  /** Stop areas (passenger waiting areas with vehicle docks) of this object. */
  stopAreas() {
    return [];
  }

  /** Advance object-specific animation/state by `dt` simulated seconds. */
  update(dt) {}

  /** Queue drawing operations on the view. */
  draw(view) {}

  /** Highlight for the editor. */
  drawSelection(view) {
    const fp = this.footprint();
    if (fp) view.polygon(fp, { stroke: OVERLAY.selection, width: 2.5, dash: [6, 4], order: 100, layer: "overlay" });
  }

  /** Entry for the layout file (parameters left at their default are omitted). */
  toJSON() {
    const defaults = /** @type {typeof LayoutObject} */ (this.constructor).defaults();
    const out = {};
    for (const [k, v] of Object.entries(this.spec)) {
      if (v === undefined) continue;
      if (this._explicit.has(k) || k === "id" || k === "type" || JSON.stringify(v) !== JSON.stringify(defaults[k])) out[k] = structuredClone(v);
    }
    return out;
  }
}

/** Placeholder for objects of unknown type (e.g. from a plugin that is not loaded); kept verbatim. */
export class UnknownObject extends LayoutObject {
  static type = "unknown";
  static label = "Unknown object";

  constructor(world, spec) {
    super(world, spec);
    this.spec = structuredClone(spec);
  }

  get type() {
    return this.spec.type;
  }
}
