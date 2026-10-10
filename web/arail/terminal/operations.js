/**
 * The container terminal as a simulation (`{"type": "terminal", ...}` in the layout's
 * `simulations`): visits of trains, trucks and barges, gantry cranes and reach stackers moving
 * containers between them and the yard, and model wagons seen by their rolling-stock markers.
 *
 * Runtime state never enters object specs; `toJSON()` returns the configured start state.
 * Requests arrive as method calls (from the app) or as `terminal.request.*` events (from
 * scenarios); see types.js for the events.
 *
 * The infrastructure comes from the layout's objects (container yards, gantry cranes, reach
 * stackers, tracks, quays, truck lanes) and is read again whenever objects, the marker map or the
 * scale change. Every move is queued for one handler (assigned when it is requested, and again
 * when that handler no longer reaches its places) and starts when the handler is free and both
 * carriers are available; the terminal's random numbers (fill, delivered containers) come from its
 * own stream, so other simulations are not affected.
 * @module arail/terminal/operations
 */
import { rollingHeightMM } from "../core/layout.js";
import { Simulation } from "../core/simulation.js";
import { createRng, dist2, pointInPolygon, toRad } from "../core/math.js";
import { hashString } from "../objects/building-kit.js";
import {
  CARRIER_TYPES, CONTAINER_SIZES, CONTAINER_WIDTH_M, Carrier, Container, Inventory, bargeType, bicProblem, makeBic, yardType,
} from "./model.js";
import { ContainerYard, GantryCrane, Quay, ReachStacker, TruckLane, yardGrid } from "./objects.js";
import { RollingStock, decodeTag, encodeTag } from "./rolling.js";
import { TERMINAL_EVENTS as EV, TERMINAL_REQUESTS as REQ } from "./types.js";
import { CraneHandler, StackerHandler, stackerReach } from "./handlers.js";
import { BargeVisit, LOCO_M, TrainVisit, TruckVisit, departTruck, stepTrucks } from "./visits.js";
import {
  colourFor, drawBarge, drawContainers, drawCrane, drawGhost, drawHighlights, drawLocomotive, drawReachStacker, drawTruck, drawWagon,
  drawYardLabels, drawYardStacks,
} from "./draw.js";

/** Owner codes of the containers the fill creates. */
const FILL_OWNERS = ["ARLU", "EBLU", "TUDU", "DBCU"];
/** Container sizes of the fill and of delivery trucks, with their weights. */
const FILL_SIZES = [["20", 0.55], ["40", 0.35], ["45", 0.1]];
const TRUCK_SIZES = [["20", 0.4], ["40", 0.45], ["45", 0.15]];
/** Share of high cubes. */
const HIGH_CUBE = 0.3;
/** Seconds a truck stands ready before it leaves on its own. */
const TRUCK_LEAVE_S = 3;
/** Heights (m) of vehicles a crane passes over: locomotive, truck cab, barge wheelhouse. */
const TOPS_M = { loco: 4.2, truck: 3.8, barge: 6.0 };
/** Target kinds of `request(…, {kind})`, with the word for messages. */
const KINDS = { wagon: "wagon", truck: "truck", barge: "barge", yard: "yard block" };
/** Carrier kinds a reach stacker serves. */
const GROUND = new Set(["wagon", "truck", "yard"]);
/** Words for the end states of a move. */
const ENDED = { done: "finished", failed: "failed", cancelled: "been cancelled" };

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isWagonType = (t) => typeof t === "string" && CARRIER_TYPES[t]?.kind === "wagon";
/** A non-empty list of numbers, else null (`tags_mm`, `tags_deg`, `spots_mm` of a `rolling_stock` entry). */
const numberList = (v) => (Array.isArray(v) && v.length && v.every(Number.isFinite) ? v : null);
/** The `tags_mm` of a `rolling_stock` entry when it is a non-empty list of numbers, else null. */
const tagPositions = (entry) => numberList(entry?.tags_mm);
/**
 * Carrier type of a model wagon: its wagon type, with its container spots where `spots_mm` puts
 * them (layout mm from the centre, + towards the A end; e.g. a model truck with two trailers),
 * which then take 20 ft containers only.
 * @param {object | undefined} entry `rolling_stock` entry
 * @param {string} type wagon type key
 * @param {number} scale layout scale
 * @returns {string | object} the type key, or a type object
 */
function stockCarrierType(entry, type, scale) {
  const spots = numberList(entry?.spots_mm);
  if (!spots) return type;
  return { ...CARRIER_TYPES[type], bays_m: spots.map((a) => (a * scale) / 1000), sizes: ["20"], pairs: [] };
}
/** Carrier ids reserved for model wagons and trucks. */
const RESERVED_ID = /^[WT]\d+$/;
const MODEL_WAGON = /^W([1-9]\d*)$/;
/** Number of bays a container size covers. */
const baysOf = (size) => CONTAINER_SIZES[String(size)]?.bays ?? 1;
/** A slot reference with numbers (row and tier default to 0). */
const slotRef = (r) => ({ carrier: r.carrier, bay: Number(r.bay), row: r.row == null ? 0 : Number(r.row), tier: r.tier == null ? 0 : Number(r.tier) });
/** Does a slot exist on a carrier for a size (bay, row and tier in range)? */
function slotExists(carrier, size, at) {
  const bayOk = baysOf(size) === 1 ? at.bay >= 0 && at.bay < carrier.bays : carrier.firstBays(size).includes(at.bay);
  return bayOk && at.row >= 0 && at.row < carrier.rows && at.tier >= 0 && at.tier < carrier.tiers;
}

/** Carrier type of a yard block from its spec (as its geometry computes it). */
function yardSpecType(spec, scale) {
  const width = Math.max(1, +spec.width_mm || 476), depth = Math.max(1, +spec.depth_mm || 134);
  const tiers = Math.min(5, Math.max(1, Math.round(+spec.tiers || 3)));
  return yardType({ ...yardGrid(width, depth, scale), tiers });
}

/** Point (layout mm) at carrier-local metres of a pose. */
function posePoint(pose, along_m, across_m, scale) {
  const k = 1000 / scale, h = pose.heading || 0, a = along_m * k, t = across_m * k, c = Math.cos(h), s = Math.sin(h);
  return [pose.center[0] + c * a - s * t, pose.center[1] + s * a + c * t];
}

/** Pick a size by weights from `[[size, weight], …]`. */
const pickSize = (rng, table) => table[rng.weighted(table.map((e) => e[1]))][0];

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
    return validateTerminal(cfg, layout);
  }

  /**
   * @param {import("../core/world.js").World} world
   * @param {object} [config] entry of the layout's `simulations` list
   */
  constructor(world, config = {}) {
    super(world, config);
    /** @type {Map<string, import("./types.js").Visit>} trains, barges, then trucks */
    this.visits = new Map();
    /** @type {Map<string, import("./types.js").Handler>} cranes (in object order), then reach stackers */
    this.handlers = new Map();
    /** @type {import("../terminal/rolling.js").RollingStock | null} */
    this.rolling = null;
    /** What the app highlights (drawn in `draw`): the selected container, its targets, the slot numbers. */
    this.highlight = { selected: null, targets: null, slots: false };
    this._offs = [];
    this._listen();
    this._build();
  }

  get name() {
    return this.config.name || "Container terminal";
  }

  /** Prototype metres → layout mm. */
  mm(m) {
    return (m * 1000) / this.world.scale;
  }

  /* ---------------------------------------------------------------- building */

  /** Build everything from the configuration: carriers, visits, handlers, containers, fill (§ loading). */
  _build() {
    const cfg = this.config;
    this.rng = createRng(hashString(`${this.world.seed}:terminal`));
    /** @type {Inventory} */
    this.inventory = new Inventory();
    /** @type {import("./types.js").Move[]} in creation order */
    this.moves = [];
    this._pending = [];
    this._count = { move: 0, truck: 0, train: 0, barge: 0 };
    this._version = 0;
    this._boxCache = new Map();
    this._colours = new Map();
    this._trains = [];
    this._barges = [];
    this._trucks = [];
    /** @type {Map<string, Carrier>} yard object id → carrier, in object order */
    this._yards = new Map();
    /** @type {Map<number, Carrier>} model wagon number → carrier */
    this._wagons = new Map();
    this.handlers.clear();
    this._syncKey = this._laneKey = null;
    this._carrierList = null;

    const ids = new Set();
    const fresh = (e) => isObject(e) && typeof e.id === "string" && e.id && !ids.has(e.id) && !e.id.includes("/") && !RESERVED_ID.test(e.id) && ids.add(e.id);
    const defWagon = isWagonType(cfg.default_wagon) ? cfg.default_wagon : "sgns60";
    for (const t of Array.isArray(cfg.trains) ? cfg.trains : []) {
      if (!fresh(t)) continue;
      const wagons = Array.isArray(t.wagons) && t.wagons.length ? t.wagons.map((w) => (isWagonType(w) ? w : defWagon)) : [defWagon, defWagon, defWagon];
      const stop = typeof t.stop_mm === "number" && t.stop_mm >= 0 ? t.stop_mm : null;
      this._addVisit(new TrainVisit({ id: t.id, name: t.name, track: t.track, direction: t.direction, stop_mm: stop, wagons }));
    }
    for (const b of Array.isArray(cfg.barges) ? cfg.barges : []) {
      if (!fresh(b)) continue;
      this._addVisit(new BargeVisit({ id: b.id, name: b.name, quay: b.quay, length_m: b.length_m, tiers: b.tiers }));
    }
    for (const w of Array.isArray(cfg.rolling_stock) ? cfg.rolling_stock : []) {
      if (isObject(w) && Number.isInteger(w.number) && w.number >= 1) this._wagonCarrier(w.number);
    }
    this._syncInfra();
    const starts = new Map([...(cfg.trains || []), ...(cfg.barges || [])].filter(isObject).map((e) => [e.id, e.start]));
    for (const v of [...this._trains, ...this._barges]) if (starts.get(v.id) === "positioned" && v.pathOk) v.position(this);

    // containers in file order (failures are skipped; validate reports them)
    for (const [i, e] of (Array.isArray(cfg.containers) ? cfg.containers : []).entries()) {
      const reason = this._addConfigured(e);
      if (reason) console.warn(`Terminal: containers[${i}] (${e?.id}): ${reason}`);
    }
    this._fill();
    if (this.rolling) this._syncWagons(false);
    this._changed();
  }

  /** Add a configured container; the reason if it is skipped. */
  _addConfigured(e) {
    if (!isObject(e) || typeof e.id !== "string" || !e.id) return "no id";
    const size = String(e.size ?? "20");
    if (!CONTAINER_SIZES[size]) return `unknown size "${e.size}"`;
    if (!isObject(e.at)) return "no place";
    const m = MODEL_WAGON.exec(String(e.at.carrier));
    if (m) this._wagonCarrier(Number(m[1]));
    const c = new Container({ id: e.id, size, high: e.high === true, colour: e.colour ?? null, label: e.label ?? "" });
    return this.inventory.add(c, slotRef(e.at));
  }

  /**
   * Random containers in yard blocks (`fill`: yard id → fraction of empty stacks): per stack (bay,
   * row) that is empty at tier 0, with probability f a box (20/40/45 ft) and, each with probability
   * f/2, more of the same span on top.
   */
  _fill() {
    const fill = isObject(this.config.fill) ? this.config.fill : {};
    let k = 0;
    const nextId = () => {
      let id;
      do id = makeBic(this.rng.pick(FILL_OWNERS), 500000 + ++k);
      while (this.inventory.get(id));
      return id;
    };
    for (const [yardId, carrier] of this._yards) {
      const f = Number(fill[yardId]);
      if (!(f > 0)) continue;
      for (let bay = 0; bay < carrier.bays; bay++) {
        for (let row = 0; row < carrier.rows; row++) {
          if (this.inventory.at(yardId, row, bay, 0) || !this.rng.chance(f)) continue;
          let size = pickSize(this.rng, FILL_SIZES);
          if (baysOf(size) === 2 && (bay + 1 >= carrier.bays || this.inventory.at(yardId, row, bay + 1, 0))) size = "20";
          for (let tier = 0; tier < carrier.tiers; tier++) {
            if (tier > 0) {
              if (!this.rng.chance(f * 0.5)) break;
              if (baysOf(size) === 2) size = pickSize(this.rng, FILL_SIZES.slice(1));
            }
            const c = new Container({ id: nextId(), size, high: this.rng.chance(HIGH_CUBE) });
            if (this.inventory.add(c, { carrier: yardId, bay, row, tier })) break;
          }
        }
      }
    }
  }

  /** Something changed that the carrier list, caches or boxes depend on. */
  _changed() {
    this._version++;
    this._carrierList = null;
  }

  /** Add a visit (train, barge or truck) and its carriers. */
  _addVisit(v) {
    for (const c of v.carriers) this.inventory.addCarrier(c);
    (v.kind === "train" ? this._trains : v.kind === "barge" ? this._barges : this._trucks).push(v);
    this._rebuildVisits();
    if (v.kind !== "truck") v.setPath(this._pathOf(v), this);
    this._changed();
  }

  /** `visits` in the order trains, barges, trucks. */
  _rebuildVisits() {
    this.visits.clear();
    for (const v of [...this._trains, ...this._barges, ...this._trucks]) this.visits.set(v.id, v);
  }

  /** The `rolling_stock` entry of model wagon `number`, or undefined. */
  _stockEntry(number) {
    return (Array.isArray(this.config.rolling_stock) ? this.config.rolling_stock : []).find((w) => isObject(w) && w.number === number);
  }

  /** The wagon type of model wagon `number`: its `rolling_stock` type, else `default_wagon`, else Sgns. */
  _wagonType(number) {
    const type = this._stockEntry(number)?.type;
    return isWagonType(type) ? type : isWagonType(this.config.default_wagon) ? this.config.default_wagon : "sgns60";
  }

  /** The carrier type of model wagon `number`: its wagon type, or one with the spots of `rolling_stock[].spots_mm`. */
  _wagonCarrierType(number) {
    const t = stockCarrierType(this._stockEntry(number), this._wagonType(number), this.world.scale);
    return typeof t === "string" ? CARRIER_TYPES[t] : t;
  }

  /**
   * Number of tags on model wagon `number`: its `rolling_stock[].tags_mm`, else one per container
   * spot (at most `markers.rolling.stride`).
   */
  tagCount(number) {
    const at = tagPositions(this._stockEntry(number)), stride = this.rollingConfig()?.stride ?? 4;
    return Math.min(at ? at.length : this._wagonCarrierType(number).bays_m.length, stride);
  }

  /**
   * Where tag `slot` of model wagon `number` sits along the wagon (layout mm from its centre, +
   * towards the A end): `rolling_stock[].tags_mm[slot]`, else the centre of container spot `slot`;
   * null for a slot the wagon does not have.
   */
  _tagAlongMM(number, slot) {
    if (!(slot >= 0 && slot < this.tagCount(number))) return null;
    const at = tagPositions(this._stockEntry(number));
    if (at) return at[slot];
    const along = this._wagonCarrierType(number).bays_m[slot];
    return Number.isFinite(along) ? this.mm(along) : null;
  }

  /** How tag `slot` of model wagon `number` is turned on it (radians): `rolling_stock[].tags_deg[slot]`, else 0. */
  _tagTurn(number, slot) {
    const deg = numberList(this._stockEntry(number)?.tags_deg)?.[slot];
    return Number.isFinite(deg) ? toRad(deg) : 0;
  }

  /** The carrier of model wagon `number` (created when first needed). */
  _wagonCarrier(number) {
    let c = this._wagons.get(number);
    if (c) return c;
    const entry = this._stockEntry(number);
    c = new Carrier({ id: `W${number}`, type: this._wagonCarrierType(number), label: entry?.name || `W${number}` });
    c.number = number;
    this._wagons = new Map([...this._wagons, [number, c]].sort((a, b) => a[0] - b[0]));
    this.inventory.addCarrier(c);
    this._changed();
    return c;
  }

  /* ---------------------------------------------------------------- infrastructure */

  /** Read the objects again if objects, the marker map or the scale changed (§5.1). */
  _syncInfra() {
    const w = this.world, key = `${w.objectsVersion}:${w.map.version}:${w.scale}`;
    if (key === this._syncKey) return;
    this._syncKey = key;
    const objects = w.objects;

    // handlers: cranes in object order, then reach stackers; runtime state is kept by object id
    const old = new Map(this.handlers);
    this.handlers.clear();
    for (const o of objects) if (o instanceof GantryCrane) this.handlers.set(o.id, this._handler(old.get(o.id), o, CraneHandler));
    for (const o of objects) if (o instanceof ReachStacker) this.handlers.set(o.id, this._handler(old.get(o.id), o, StackerHandler));
    for (const [id, h] of old) {
      if (this.handlers.has(id)) continue;
      for (const m of this._pending.filter((m) => m.handler === id)) this._cancelMove(m);
      h.abort();
    }

    // yard blocks: carriers with a type from their spec; containers in vanished cells leave
    const seen = new Set();
    for (const o of objects) {
      if (!(o instanceof ContainerYard)) continue;
      seen.add(o.id);
      const type = yardSpecType(o.spec, w.scale), g = o.geometry;
      let c = this._yards.get(o.id);
      if (!c) {
        c = this.inventory.addCarrier(new Carrier({ id: o.id, type, label: o.spec.name || o.id, owner: o.id }));
        this._yards.set(o.id, c);
      } else {
        c.label = o.spec.name || o.id;
        const t = c.type;
        if (t.bays_m.length !== type.bays_m.length || t.rows_m.length !== type.rows_m.length || t.tiers !== type.tiers) {
          c.type = type;
          this._dropVanished(c);
        }
      }
      c.pose = g ? { center: g.center, heading: g.angle } : null;
      c.present = c.available = !!g;
    }
    for (const [id, c] of [...this._yards]) {
      if (seen.has(id)) continue;
      // the yard goes first, so that a container lifted from it is not put back there
      const gone = this.inventory.removeCarrier(id);
      this._yards.delete(id);
      this._boxCache.delete(c.id);
      for (const m of this._pending.filter((m) => m.from.carrier === id || m.to.carrier === id)) this._cancelMove(m);
      for (const box of gone) this._emit(EV.containerLeft, { container: box, visit: null, reason: "place removed" });
    }
    // keep the yards in object order
    this._yards = new Map(objects.filter((o) => this._yards.has(o.id)).map((o) => [o.id, this._yards.get(o.id)]));

    // paths of the visits; tracks for snapping model wagons
    this._tracks = objects.filter((o) => o.type === "track" && o.geometry).map((o) => ({ points: o.geometry.points, lengths: o.geometry.lengths }));
    for (const v of [...this._trains, ...this._barges]) v.setPath(this._pathOf(v), this);
    this._changed();

    // moves whose handler no longer reaches their places; busy handlers aim again where things are now
    for (const m of [...this._pending]) if (this._recheckable(m)) this._recheck(m);
    for (const h of this.handlers.values()) h.replan(this);
  }

  /** The handler of an object, keeping the state of the old one. */
  _handler(old, object, Cls) {
    if (old instanceof Cls) {
      old.sync(object);
      return old;
    }
    return new Cls(object, this);
  }

  /** A resized yard: containers in cells that no longer exist leave the terminal, moves to such cells are cancelled. */
  _dropVanished(c) {
    for (const m of this._pending.filter((m) => m.to.carrier === c.id)) {
      const box = this.inventory.get(m.container);
      if (box && !slotExists(c, box.size, m.to)) this._cancelMove(m);
    }
    for (const box of this.inventory.on(c.id).reverse()) {
      if (slotExists(c, box.size, box.at)) continue;
      const m = this._pending.find((m) => m.container === box.id);
      if (m) this._cancelMove(m);
      this.inventory.remove(box.id);
      this._emit(EV.containerLeft, { container: box, visit: null, reason: "place removed" });
    }
  }

  /** Path polyline (layout mm) of a train or barge, null if its track or quay is missing. */
  _pathOf(v) {
    const o = this.world.getObject(v.where);
    if (v.kind === "train") return o && o.type === "track" ? o.geometry?.points ?? null : null;
    return o instanceof Quay ? o.geometry?.points ?? null : null;
  }

  /** The truck lane: `trucks.lane`, else the first truck lane (looked up again when the objects change). */
  _lane() {
    this._syncInfra();
    if (this._laneKey !== this._syncKey) {
      const id = isObject(this.config.trucks) ? this.config.trucks.lane : null;
      const o = id != null ? this.world.getObject(id) : this.world.objects.find((x) => x instanceof TruckLane);
      this._laneObj = o instanceof TruckLane ? o : null;
      this._laneKey = this._syncKey;
    }
    return this._laneObj;
  }

  /* ---------------------------------------------------------------- state */

  /**
   * All carriers: train wagons, model wagons, barges, trucks, yards.
   * @returns {import("./model.js").Carrier[]}
   */
  carriers() {
    this._syncInfra();
    if (!this._carrierList) {
      this._carrierList = [
        ...this._trains.flatMap((v) => v.carriers), ...this._wagons.values(), ...this._barges.flatMap((v) => v.carriers),
        ...this._trucks.flatMap((v) => v.carriers), ...this._yards.values(),
      ];
    }
    return this._carrierList;
  }

  /** @returns {import("./model.js").Carrier | null} */
  carrier(id) {
    return this.inventory.carriers.get(id) ?? null;
  }

  /**
   * Carriers of the model wagons seen by their markers (or with containers in the start state), by number.
   * @returns {import("./model.js").Carrier[]}
   */
  markerWagons() {
    return [...this._wagons.values()];
  }

  /**
   * A slot in words, e.g. "Block A · bay 4 · row 2 · tier 1", "KT 41 Hamburg · wagon 1 · bay 2", "Truck T3";
   * for a container over two bays (`bays` 2: 40 and 45 ft) "KT 41 Hamburg · wagon 1 · bay 1–2".
   * @param {import("./types.js").SlotRef} ref
   * @param {{bays?: number} | null} [container] bays the container takes (a Container has them; default 1)
   */
  describe(ref, container = null) {
    if (!isObject(ref)) return "";
    const at = slotRef(ref), c = this.carrier(at.carrier);
    const bay = container?.bays === 2 ? `bay ${at.bay + 1}–${at.bay + 2}` : `bay ${at.bay + 1}`;
    if (!c) return `${at.carrier} · ${bay}`;
    if (c.kind === "truck") return c.label;
    const parts = [c.label, bay];
    if (c.rows > 1) parts.push(`row ${at.row + 1}`);
    if (c.tiers > 1) parts.push(`tier ${at.tier + 1}`);
    return parts.join(" · ");
  }

  /** The visit a carrier belongs to (null for yards and model wagons). */
  _visitOf(carrier) {
    return carrier && carrier.kind !== "yard" ? this.visits.get(carrier.owner) ?? null : null;
  }

  /** The queued and active moves from or to a visit's carriers. */
  _movesOfVisit(v) {
    const ids = new Set(v.carriers.map((c) => c.id));
    return this._pending.filter((m) => ids.has(m.from.carrier) || ids.has(m.to.carrier));
  }

  /** Is a visit leaving, or will it leave once the crane working on it is done? */
  _leaving(v) {
    return v?.state === "departing" || !!v?.leaveWhenDone;
  }

  /* ---------------------------------------------------------------- visits */

  /**
   * Call a visit (train or barge) to the terminal.
   * @returns {string | null} null = done; else the reason
   */
  call(visitId) {
    this._syncInfra();
    const v = this.visits.get(visitId);
    if (!v) return `Unknown visit "${visitId}"`;
    if (v.kind === "truck") return `${v.name} comes by itself`;
    if (v.state === "departing") return `${v.name} is leaving`;
    if (v.state !== "away") return `${v.name} is already here`;
    if (!v.pathOk) return `${v.name}: no ${v.kind === "train" ? "track" : "quay"} "${v.where}"`;
    const other = [...this._trains, ...this._barges].find((o) => o !== v && o.kind === v.kind && o.where === v.where && o.state !== "away");
    if (other) return `${other.name} is ${v.kind === "train" ? `on track ${v.where}` : "at the quay"}`;
    v.call(this);
    return null;
  }

  /**
   * Send a visit away.
   * @param {string} visitId
   * @param {{force?: boolean}} [options] force: cancel its queued moves; while a crane works on the
   *   visit, it leaves once that move has ended (`leaveWhenDone`)
   * @returns {string | null} null = done (or it leaves once the crane is done); else the reason
   */
  depart(visitId, { force = false } = {}) {
    this._syncInfra();
    const v = this.visits.get(visitId);
    if (!v) return `Unknown visit "${visitId}"`;
    if (v.state === "away") return `${v.name} is not here`;
    if (v.state === "departing" || v.leaveWhenDone) return `${v.name} is already leaving`;
    const moves = this._movesOfVisit(v), active = moves.some((m) => m.state === "active");
    if (active && !force) return `A crane is working on ${v.name}`;
    if (moves.length && !force) return `${v.name} still has ${moves.length} move${moves.length === 1 ? "" : "s"}`;
    for (const m of moves) if (m.state === "queued") this._cancelMove(m);
    if (active) {
      v.leaveWhenDone = true;
      return null;
    }
    if (v.kind !== "truck") v.depart(this);
    else if (v.state === "waiting") this._truckGone(v);
    else departTruck(v, this);
    return null;
  }

  /**
   * Create a train (and call it).
   * @param {{track?: string, wagons?: string[], load?: "empty"|"random", name?: string|null}} [options]
   * @returns {{visit: import("./types.js").Visit} | {error: string}}
   */
  addTrain({ track, wagons = ["sgns60", "sgns60", "sgns60"], load = "empty", name = null } = {}) {
    this._syncInfra();
    const o = track != null ? this.world.getObject(track) : this.world.objects.find((x) => x.type === "track" && x.geometry);
    if (!o || o.type !== "track") return { error: track != null ? `No track "${track}"` : "No track" };
    if (!Array.isArray(wagons) || !wagons.length) return { error: "A train needs at least one wagon" };
    const bad = wagons.find((t) => !isWagonType(t));
    if (bad !== undefined) return { error: `Unknown wagon type "${bad}"` };
    const n = this._nextNumber("train", "train-");
    const v = new TrainVisit({ id: `train-${n}`, name: name || `Train ${n}`, track: o.id, wagons, runtime: true });
    return this._callNew(v, load);
  }

  /**
   * Create a barge (and call it).
   * @param {{quay?: string, length_m?: number, load?: "empty"|"random", name?: string|null}} [options]
   * @returns {{visit: import("./types.js").Visit} | {error: string}}
   */
  addBarge({ quay, length_m = 55, load = "empty", name = null } = {}) {
    this._syncInfra();
    const o = quay != null ? this.world.getObject(quay) : this.world.objects.find((x) => x instanceof Quay);
    if (!(o instanceof Quay)) return { error: quay != null ? `No quay "${quay}"` : "No quay" };
    if (!(Number(length_m) >= 25 && Number(length_m) <= 110)) return { error: "A barge is 25–110 m long" };
    const n = this._nextNumber("barge", "barge-");
    const v = new BargeVisit({ id: `barge-${n}`, name: name || `Barge ${n}`, quay: o.id, length_m: Number(length_m), runtime: true });
    return this._callNew(v, load);
  }

  /** Next free number for a runtime visit id with this prefix. */
  _nextNumber(kind, prefix) {
    let n;
    do n = ++this._count[kind];
    while (this.visits.has(`${prefix}${n}`) || this.inventory.carriers.has(`${prefix}${n}`));
    return n;
  }

  /** Add a new train or barge, load it, call it; it is dropped again if it cannot come. */
  _callNew(v, load) {
    this._addVisit(v);
    const reason = this.call(v.id);
    if (reason) {
      this._removeVisit(v);
      return { error: reason };
    }
    if (load === "random") this._loadRandom(v);
    return { visit: v };
  }

  /** Remove a visit and its carriers (with their containers); moves from or to them are cancelled. */
  _removeVisit(v) {
    this._cancelMovesOf(v);
    for (const c of v.carriers) {
      this.inventory.removeCarrier(c.id);
      this._boxCache.delete(c.id);
    }
    if (v.kind === "train") this._trains = this._trains.filter((x) => x !== v);
    else if (v.kind === "barge") this._barges = this._barges.filter((x) => x !== v);
    else this._trucks = this._trucks.filter((x) => x !== v);
    this._rebuildVisits();
    this._changed();
  }

  /** Cancel the moves from or to the carriers of a visit. */
  _cancelMovesOf(v) {
    const ids = new Set(v.carriers.map((c) => c.id));
    for (const m of this._pending.filter((m) => ids.has(m.from.carrier) || ids.has(m.to.carrier))) this._cancelMove(m);
  }

  /** Random containers on the carriers of a new visit (emits `container.added` for each). */
  _loadRandom(v) {
    let k = 0;
    const base = v.kind === "train" ? 600000 : 700000;
    for (const c of v.carriers) {
      for (let tier = 0; tier < Math.min(c.tiers, 2); tier++) {
        for (let row = 0; row < c.rows; row++) {
          for (let bay = 0; bay < c.bays; bay++) {
            if (!this.rng.chance(tier ? 0.4 : 0.8)) continue;
            const below = tier ? this.inventory.at(c.id, row, bay, tier - 1) : null;
            if (tier && (!below || below.at.bay !== bay)) continue;
            const two = tier ? below.bays === 2 : c.firstBays("40").includes(bay) && !this.inventory.at(c.id, row, bay + 1, 0) && this.rng.chance(0.5);
            const size = two ? (c.allows("45") && this.rng.chance(0.2) ? "45" : "40") : "20";
            let id;
            do id = makeBic(this.rng.pick(FILL_OWNERS), base + ++k);
            while (this.inventory.get(id));
            const box = new Container({ id, size, high: this.rng.chance(HIGH_CUBE) });
            if (!this.inventory.add(box, { carrier: c.id, bay, row, tier })) this._emit(EV.containerAdded, { container: box, carrier: c.id });
          }
        }
      }
    }
    this._changed();
  }

  /**
   * Send a truck to the gate: a pickup truck comes empty, a delivery truck brings a container.
   * @param {{purpose?: "pickup"|"delivery", size?: "20"|"40"|"45"|null}} [options]
   * @returns {{visit: import("./types.js").Visit} | {error: string}}
   */
  sendTruck({ purpose = "pickup", size = null } = {}) {
    this._syncInfra();
    const lane = this._lane();
    if (!lane) return { error: "No truck lane" };
    if (purpose !== "pickup" && purpose !== "delivery") return { error: `Unknown purpose "${purpose}": use pickup or delivery` };
    if (size != null && !CONTAINER_SIZES[String(size)]) return { error: `Unknown container size "${size}"` };
    let n;
    do n = ++this._count.truck;
    while (this.visits.has(`T${n}`) || this.inventory.carriers.has(`T${n}`));
    const v = new TruckVisit({ id: `T${n}`, lane: lane.id, purpose });
    this._addVisit(v);
    if (purpose === "delivery") {
      const s = size != null ? String(size) : pickSize(this.rng, TRUCK_SIZES);
      let id = makeBic("TRKU", 100000 + n);
      for (let k = 1; this.inventory.get(id); k++) id = makeBic("TRKU", 100000 + n + 1000 * k);
      const box = new Container({ id, size: s, high: this.rng.chance(HIGH_CUBE) });
      if (!this.inventory.add(box, { carrier: v.id, bay: 0 })) this._emit(EV.containerAdded, { container: box, carrier: v.id });
      this._changed();
    }
    return { visit: v };
  }

  /** A truck reached the end of the lane (or left from the gate): its containers leave, the visit is gone. */
  _truckGone(t) {
    this._cancelMovesOf(t);
    for (const box of this.inventory.on(t.id)) this._emit(EV.containerLeft, { container: box, visit: t, reason: "truck" });
    t.state = "away";
    this._removeVisit(t);
    this._visitEvent(EV.visitDeparted, t);
  }

  /**
   * Visits sent away while a crane worked on them leave once it is done; trucks that stand ready
   * (loaded, or emptied) leave on their own after a few seconds.
   */
  _autoLeave(dt) {
    for (const v of [...this.visits.values()]) {
      if (!v.leaveWhenDone || this._movesOfVisit(v).length) continue;
      v.leaveWhenDone = false;
      this.depart(v.id);
    }
    for (const t of this._trucks) {
      if (t.state !== "positioned") continue;
      const busy = this._pending.some((m) => m.from.carrier === t.id || m.to.carrier === t.id);
      const used = this.inventory.usedTeu(t.id);
      const ready = !busy && (t.purpose === "pickup" ? used > 0 : used === 0);
      t.ready_s = ready ? t.ready_s + dt : 0;
      if (ready && t.ready_s >= TRUCK_LEAVE_S) this.depart(t.id);
    }
  }

  /* ---------------------------------------------------------------- moves */

  /**
   * Where a container can go now, and the carriers that refuse it (with the reason).
   * @returns {{ok: import("./types.js").Target[], refused: import("./types.js").Refusal[]}}
   */
  targets(containerId) {
    this._syncInfra();
    const c = this.inventory.get(containerId);
    if (!c) return { ok: [], refused: [{ carrier: "", label: String(containerId), reason: `Unknown container "${containerId}"` }] };
    const lift = this._liftProblem(c);
    if (lift) return { ok: [], refused: [{ carrier: c.at?.carrier ?? "", label: c.id, reason: lift }] };
    const ok = [], refused = [];
    for (const carrier of this.carriers()) {
      const v = this._visitOf(carrier);
      if (!carrier.present && v?.state !== "departing") continue;
      const why = this._placeProblem(carrier);
      if (why) {
        refused.push({ carrier: carrier.id, label: carrier.label, reason: why });
        continue;
      }
      const slots = this.inventory.freeSlots(c, carrier.id);
      let first = null;
      for (const at of slots) {
        const handler = this._assign(c, at);
        if (handler) ok.push({ at, carrier: carrier.id, kind: carrier.kind, label: this.describe(at, c), handler });
        else first ??= at;
      }
      if (!slots.length) refused.push({ carrier: carrier.id, label: carrier.label, reason: this._noSlot(c, carrier) });
      else if (!ok.some((t) => t.carrier === carrier.id)) refused.push({ carrier: carrier.id, label: carrier.label, reason: this._noHandler(c, first) });
    }
    return { ok, refused };
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
    return this._request(containerId, to, { source });
  }

  /** `request`, optionally never onto the carriers in `exclude`. */
  _request(containerId, to, { source = "user", exclude = null } = {}) {
    this._syncInfra();
    const c = this.inventory.get(containerId);
    if (!c) return { error: `Unknown container "${containerId}"` };
    const lift = this._liftProblem(c);
    if (lift) return { error: lift };
    const target = this._resolve(c, to, exclude);
    if (target.error) return target;
    const { ref, handler } = target;
    const id = `M${this._count.move + 1}`;
    const reason = this.inventory.reserve(ref, c.size, id);
    if (reason) return { error: reason };
    this._count.move++;
    c.move = id;
    const move = {
      id, container: c.id, from: slotRef(c.at), to: ref, handler, state: "queued", reason: null, waiting: null,
      source: source === "scenario" ? "scenario" : "user", queuedAt: this.world.time, startedAt: null, doneAt: null,
    };
    this.moves.push(move);
    this._pending.push(move);
    this._emit(EV.moveQueued, { move });
    return { move };
  }

  /** Why a container cannot be lifted for a new move (null = it can). */
  _liftProblem(c) {
    const reason = this.inventory.canLift(c);
    if (reason) return reason;
    const src = this.carrier(c.at.carrier);
    if (!src?.present) return `${src?.label ?? c.at.carrier} is not here`;
    const v = this._visitOf(src);
    return this._leaving(v) ? `${v.name} is leaving` : null;
  }

  /** Why nothing can be put on a carrier now (null = it can take containers). */
  _placeProblem(carrier) {
    if (!carrier) return "Unknown place";
    const v = this._visitOf(carrier);
    if (this._leaving(v)) return `${v.name} is leaving`;
    if (!carrier.present || v?.state === "away" || v?.state === "waiting") return `${carrier.label} is not here`;
    return null;
  }

  /** Resolve a target (slot, carrier or kind) to a slot and its handler, or the reason. */
  _resolve(c, to, exclude) {
    if (!isObject(to)) return { error: "No target given" };
    if (to.kind != null) {
      const kind = to.kind === "train" ? "wagon" : String(to.kind);
      if (!KINDS[kind]) return { error: `Unknown kind "${to.kind}": use wagon, truck, barge or yard` };
      // a free place that no handler serves: say so (rather than "no free place")
      let free = null;
      for (const carrier of this.carriers()) {
        if (carrier.kind !== kind || exclude?.has(carrier.id) || this._placeProblem(carrier)) continue;
        free ??= this.inventory.freeSlots(c, carrier.id)[0] ?? null;
        const slot = this._firstSlot(c, carrier);
        if (slot) return slot;
      }
      return { error: free ? this._noHandler(c, free) : `No free place for ${c.id} on a ${KINDS[kind]}` };
    }
    const carrier = this.carrier(to.carrier);
    if (!carrier) return { error: `Unknown place "${to.carrier}"` };
    if (exclude?.has(carrier.id)) return { error: `${c.id} is already on ${carrier.label}` };
    const why = this._placeProblem(carrier);
    if (why) return { error: why };
    if (to.bay == null) {
      const slot = this._firstSlot(c, carrier);
      if (slot) return slot;
      const free = this.inventory.freeSlots(c, carrier.id);
      return { error: free.length ? this._noHandler(c, free[0]) : this._noSlot(c, carrier) };
    }
    const ref = slotRef(to);
    if (to.tier == null) ref.tier = this.inventory.top(carrier.id, ref.row, ref.bay);
    const reason = this.inventory.canPlace(c, ref);
    if (reason) return { error: reason };
    const handler = this._assign(c, ref);
    return handler ? { ref, handler } : { error: this._noHandler(c, ref) };
  }

  /** First free slot of a carrier (in `freeSlots` order) that a handler can serve. */
  _firstSlot(c, carrier) {
    for (const ref of this.inventory.freeSlots(c, carrier.id)) {
      const handler = this._assign(c, ref);
      if (handler) return { ref, handler };
    }
    return null;
  }

  _noSlot(c, carrier) {
    if (!carrier.allows(c.size)) return `${carrier.type?.label ?? carrier.label} takes no ${c.size} ft containers`;
    return `No free place for ${c.id} on ${carrier.label}`;
  }

  _noHandler(c, ref) {
    return `No crane or reach stacker can move it from ${this.describe(c.at, c)} to ${this.describe(ref, c)}`;
  }

  /**
   * The handler for a move (§5.2): a crane reaching both slots (the one with the fewest moves, then
   * the first), else the reach stacker nearest to the source if both carriers are wagons, trucks or
   * yards and the target tier is low enough; null if none.
   */
  _assign(c, ref) {
    const src = this.carrier(c.at.carrier), dst = this.carrier(ref.carrier);
    const a = this._slotPoint(src, c.at, c.size), b = this._slotPoint(dst, ref, c.size);
    if (!a || !b) return null;
    let best = null, bestLoad = Infinity;
    for (const h of this.handlers.values()) {
      if (h.kind !== "crane" || !this._handles(h, src, dst, a, b, ref.tier)) continue;
      const load = this._pending.reduce((n, m) => n + (m.handler === h.id), 0);
      if (load < bestLoad) [best, bestLoad] = [h.id, load];
    }
    if (best) return best;
    let bestDist = Infinity;
    for (const h of this.handlers.values()) {
      if (h.kind !== "reach-stacker" || !this._handles(h, src, dst, a, b, ref.tier)) continue;
      const d = dist2(h.center, a);
      if (d < bestDist - 1e-9) [best, bestDist] = [h.id, d];
    }
    return best;
  }

  /**
   * Can handler `h` move a container from slot centre `a` on `src` to slot centre `b` (tier `tier`)
   * on `dst`? A crane must reach both; a reach stacker serves wagons, trucks and yards up to its tiers.
   */
  _handles(h, src, dst, a, b, tier) {
    if (!h.object.geometry) return false;
    if (h.kind === "crane") return h.object.reaches(a) && h.object.reaches(b);
    return GROUND.has(src.kind) && GROUND.has(dst.kind) && tier < h.tiers;
  }

  /** May a move still be given to another handler (queued, or active before the lock)? */
  _recheckable(m) {
    return m.state === "queued" || (m.state === "active" && !!this.handlers.get(m.handler)?.cancellable);
  }

  /**
   * A move whose handler no longer serves it (a crane was moved or resized, a place was moved out
   * of its reach) goes to a handler that serves it, starting again if it was active. If there is
   * none, it waits while it involves a model wagon (which may be pushed back), else it fails. A
   * place whose pose is unknown is left alone: the move waits for its carrier anyway.
   */
  _recheck(m) {
    const c = this.inventory.get(m.container), h = this.handlers.get(m.handler);
    const src = this.carrier(c?.at?.carrier), dst = this.carrier(m.to.carrier);
    const a = this._slotPoint(src, c?.at, c?.size), b = this._slotPoint(dst, m.to, c?.size);
    if (!a || !b || (h && this._handles(h, src, dst, a, b, m.to.tier))) return;
    const next = this._assign(c, m.to);
    const wagon = [src, dst].find((x) => x.number != null && this._wagons.get(x.number) === x);
    if (m.state === "active") h.abort();
    if (!next && !wagon) {
      this._endMove(m, "failed", this._noHandler(c, m.to));
      this._emit(EV.moveFailed, { move: m });
      return;
    }
    m.state = "queued";
    m.startedAt = null;
    if (next) m.handler = next;
    else m.waiting = `waiting for ${wagon.label} to come within reach`;
  }

  /** Layout point (mm) of a slot centre where its carrier will be handled (a coming train: at its stop). */
  _slotPoint(carrier, ref, size) {
    if (!carrier) return null;
    const v = this._visitOf(carrier);
    const pose = v?.homePose ? v.homePose(carrier, this) : carrier.pose;
    if (!pose) return null;
    const along = carrier.along(ref.bay, size), across = carrier.across(ref.row ?? 0);
    return Number.isFinite(along) && Number.isFinite(across) ? posePoint(pose, along, across, this.world.scale) : null;
  }

  /**
   * Cancel a queued move (or an active one before its container is locked).
   * @returns {string | null} null = done; else the reason
   */
  cancel(moveId) {
    const m = this.moves.find((x) => x.id === moveId);
    if (!m) return `Unknown move "${moveId}"`;
    if (ENDED[m.state]) return `Move ${m.id} has already ${ENDED[m.state]}`;
    const h = this.handlers.get(m.handler);
    if (m.state === "active" && h && h.move === m.id && !h.cancellable) {
      return `The ${h.kind === "crane" ? "crane" : "reach stacker"} is carrying ${m.container}; it finishes the move`;
    }
    this._cancelMove(m);
    return null;
  }

  /** End a queued or active move as cancelled; a container on a spreader goes back (or leaves). */
  _cancelMove(m) {
    const h = this.handlers.get(m.handler);
    if (m.state === "active" && h?.move === m.id) h.abort();
    this._endMove(m, "cancelled", null);
    this._emit(EV.moveCancelled, { move: m });
  }

  /**
   * Close a move: release its reservation and the container. A container on a spreader is set down
   * where it came from, else at the move's target, else in a free slot of the carrier it came from
   * or of a yard; it leaves the terminal only if none of these takes it.
   */
  _endMove(m, state, reason) {
    m.state = state;
    m.reason = reason;
    m.waiting = null;
    m.doneAt = this.world.time;
    this._pending = this._pending.filter((x) => x !== m);
    this.inventory.release(m.id);
    const c = this.inventory.get(m.container);
    if (c && c.move === m.id) c.move = null;
    if (c && c.handler != null && !c.at) {
      const free = (id) => (this.carrier(id) ? this.inventory.freeSlots(c, id)[0] : null);
      const places = [m.from, m.to, free(m.from.carrier), ...[...this._yards.keys()].map(free)];
      const home = places.find((r) => r && this.carrier(r.carrier) && !this.inventory.canPlace(c, r));
      if (!home || this.inventory.attach(c.id, home)) {
        this.inventory.remove(c.id);
        this._emit(EV.containerLeft, { container: c, visit: null, reason: "place removed" });
      }
    }
    this._changed();
  }

  /**
   * Queue moves for every container of a visit that can be lifted now, to free slots on carriers
   * of kind `to`; containers that cannot be lifted are listed in `refused`.
   * @param {string} visitId
   * @param {{to?: "yard"|"truck"|"wagon"|"barge"}} [options]
   * @returns {{moves: import("./types.js").Move[], refused: import("./types.js").Refusal[]}}
   */
  unload(visitId, { to = "yard" } = {}) {
    return this._unload(visitId, { to });
  }

  _unload(visitId, { to = "yard", source = "user" } = {}) {
    this._syncInfra();
    const v = this.visits.get(visitId), why = this._visitProblem(v, visitId);
    if (why) return { moves: [], refused: [{ carrier: visitId, label: v?.name ?? String(visitId), reason: why }] };
    const own = new Set(v.carriers.map((c) => c.id));
    const boxes = v.carriers.flatMap((c) => this.inventory.on(c.id));
    boxes.sort((p, q) => q.at.tier - p.at.tier || p.at.bay - q.at.bay || p.at.row - q.at.row);
    const moves = [], refused = [];
    for (const box of boxes) {
      const lift = this._liftProblem(box);
      const r = lift ? { error: lift } : this._request(box.id, { kind: to }, { source, exclude: own });
      if (r.move) moves.push(r.move);
      else refused.push({ carrier: box.at.carrier, label: box.id, reason: r.error });
    }
    return { moves, refused };
  }

  /**
   * Fill a visit's free slots with containers from carriers of kind `from`.
   * @param {string} visitId
   * @param {{from?: "yard"|"truck"|"wagon"|"barge"}} [options]
   * @returns {{moves: import("./types.js").Move[], refused: import("./types.js").Refusal[]}}
   */
  load(visitId, { from = "yard" } = {}) {
    return this._load(visitId, { from });
  }

  _load(visitId, { from = "yard", source = "user" } = {}) {
    this._syncInfra();
    const v = this.visits.get(visitId), why = this._visitProblem(v, visitId);
    if (why) return { moves: [], refused: [{ carrier: visitId, label: v?.name ?? String(visitId), reason: why }] };
    const kind = from === "train" ? "wagon" : from;
    const own = new Set(v.carriers.map((c) => c.id));
    const order = new Map(this.carriers().map((c, i) => [c.id, i]));
    const boxes = [...this.inventory.containers.values()].filter((b) => b.at && !own.has(b.at.carrier) && this.carrier(b.at.carrier)?.kind === kind);
    boxes.sort((p, q) => order.get(p.at.carrier) - order.get(q.at.carrier) || q.at.tier - p.at.tier || p.at.bay - q.at.bay || p.at.row - q.at.row);
    const moves = [];
    const probe = new Container({ id: "\u0000probe", size: "20" });
    const room = () => v.carriers.some((c) => this.inventory.freeSlots(probe, c.id).length);
    for (const box of boxes) {
      if (!room()) break;
      if (this._liftProblem(box)) continue;
      for (const c of v.carriers) {
        if (!c.allows(box.size) || !this.inventory.freeSlots(box, c.id).length) continue;
        const r = this._request(box.id, { carrier: c.id }, { source });
        if (r.move) {
          moves.push(r.move);
          break;
        }
      }
    }
    const refused = moves.length ? [] : [{ carrier: visitId, label: v.name, reason: room() ? `No container on a ${KINDS[kind] ?? kind} fits ${v.name}` : `${v.name} has no free place` }];
    return { moves, refused };
  }

  /** Why a visit cannot be unloaded or loaded (null = it can). */
  _visitProblem(v, id) {
    if (!v) return `Unknown visit "${id}"`;
    if (v.state === "away" || v.state === "waiting") return `${v.name} is not here`;
    if (this._leaving(v)) return `${v.name} is leaving`;
    return null;
  }

  /* ---------------------------------------------------------------- handlers (host interface) */

  /**
   * Start queued moves on idle handlers; note what queued moves wait for (§5.4). A move whose
   * carriers are both available is checked against its handler's reach first (a model wagon may
   * have been pushed away).
   */
  _dispatch() {
    for (const m of [...this._pending]) {
      if (!this._recheckable(m)) continue;
      const wait = [m.from.carrier, m.to.carrier].find((id) => !this.carrier(id)?.available);
      if (m.state === "queued") m.waiting = wait ? `waiting for ${this._carrierLabel(wait)}` : null;
      if (!wait) this._recheck(m);
    }
    for (const h of this.handlers.values()) {
      if (h.busy || !h.object.geometry) continue;
      const m = this._pending.find((x) => x.state === "queued" && x.handler === h.id && !x.waiting);
      if (!m) continue;
      m.state = "active";
      m.startedAt = this.world.time;
      h.begin(m, this.inventory.get(m.container), this);
      this._emit(EV.moveStarted, { move: m });
    }
  }

  _available(id) {
    return !!this.carrier(id)?.available;
  }

  _carrierLabel(id) {
    return this.carrier(id)?.label ?? id;
  }

  /** Height (mm) of the deck of a carrier: the tag height for model wagons. */
  _deckZ(carrier) {
    if (carrier.number != null && this._wagons.get(carrier.number) === carrier) {
      return this.tagHeight(encodeTag(carrier.number, 0, this.rollingConfig()?.stride ?? 4));
    }
    return this.mm(carrier.type?.deck_m ?? 0);
  }

  /**
   * Box (layout mm) of a container at a slot on its carrier's current pose; null while the pose is unknown.
   * @returns {import("./types.js").Box | null}
   */
  _slotBox(ref, container) {
    const carrier = this.carrier(ref?.carrier);
    if (!carrier?.pose || !container) return null;
    const at = slotRef(ref), along = carrier.along(at.bay, container.size), across = carrier.across(at.row);
    if (!Number.isFinite(along) || !Number.isFinite(across)) return null;
    return {
      id: container.id, center: posePoint(carrier.pose, along, across, this.world.scale), heading: carrier.pose.heading || 0,
      z0: this._deckZ(carrier) + this.mm(this.inventory.heightBelow(at)), length: this.mm(container.length_m),
      width: this.mm(CONTAINER_WIDTH_M), height: this.mm(container.height_m),
    };
  }

  /** The highest box or vehicle top (mm) under a crane. */
  _maxTop(handler) {
    const crane = handler.object;
    let top = 0;
    for (const c of this.carriers()) {
      if (!c.present || !c.pose) continue;
      for (const b of this._carrierBoxes(c)) if (b.z0 + b.height > top && crane.reaches(b.center)) top = b.z0 + b.height;
    }
    for (const v of this._trains) if (v.loco && crane.reaches(v.loco.center)) top = Math.max(top, this.mm(TOPS_M.loco));
    for (const t of this._trucks) if (t.carriers[0].pose && crane.reaches(t.carriers[0].pose.center)) top = Math.max(top, this.mm(TOPS_M.truck));
    for (const b of this._barges) {
      const p = b.carriers[0].pose;
      if (p && crane.reaches(posePoint(p, -b.length_m / 2 + 4, 0, this.world.scale))) top = Math.max(top, this.mm(TOPS_M.barge));
    }
    return top;
  }

  _detach(h) {
    const reason = this.inventory.detach(h.load.id, h.id);
    this._changed();
    return reason;
  }

  _attach(h) {
    const reason = this.inventory.attach(h.load.id, h._move.to);
    this._changed();
    return reason;
  }

  /** A handler finished its move: the container stands on its target. */
  _finish(h) {
    const m = h._move, c = this.inventory.get(m.container);
    h.abort();
    this._endMove(m, "done", null);
    this._emit(EV.containerMoved, { container: c, from: m.from, to: m.to, move: m });
    this._emit(EV.moveFinished, { move: m });
  }

  /** A handler could not complete its move. */
  _fail(h, reason) {
    const m = h._move;
    h.abort();
    this._endMove(m, "failed", reason);
    this._emit(EV.moveFailed, { move: m });
  }

  /* ---------------------------------------------------------------- start state */

  /** Restore the configured start state (runtime visits, trucks and moves are discarded). */
  reset() {
    this._build();
    this._emit(EV.reset, {});
  }

  /**
   * The current state as a terminal entry for the layout file (a new start state): the stored
   * containers (not those on trucks; a container on a spreader at its target), the trains and barges
   * including those created at run time, without `fill`.
   * @returns {object}
   */
  snapshot() {
    const { fill, ...out } = this.config;
    const trucks = new Set(this._trucks.map((t) => t.id));
    const list = this.inventory.snapshot().filter((e) => !trucks.has(e.at.carrier));
    // a container on a spreader is saved where it goes; one going to a truck (never in files) where
    // it came from, if that place is free and holds it in the saved state (pending moves are not
    // saved, so their reservations do not count), else not at all
    const toTruck = [];
    for (const m of this._pending) {
      const c = this.inventory.get(m.container);
      if (!c || c.at || c.handler == null) continue;
      if (!trucks.has(m.to.carrier)) list.push({ ...c.toJSON(), at: { ...m.to } });
      else if (!trucks.has(m.from.carrier)) toTruck.push([c, m.from]);
    }
    list.sort((a, b) => a.at.tier - b.at.tier);
    const saved = new Inventory();
    for (const c of this.inventory.carriers.values()) saved.addCarrier(new Carrier({ id: c.id, type: c.type }));
    out.containers = list.filter((e) => !saved.add(new Container(e), e.at));
    toTruck.sort((p, q) => p[1].tier - q[1].tier);
    for (const [c, from] of toTruck) if (!saved.add(new Container(c.toJSON()), from)) out.containers.push({ ...c.toJSON(), at: { ...from } });
    out.containers.sort((a, b) => a.at.tier - b.at.tier);
    const start = (v) => (v.state === "positioned" ? "positioned" : "away");
    const cfgTrains = new Map((Array.isArray(this.config.trains) ? this.config.trains : []).filter(isObject).map((e) => [e.id, e]));
    const cfgBarges = new Map((Array.isArray(this.config.barges) ? this.config.barges : []).filter(isObject).map((e) => [e.id, e]));
    out.trains = this._trains.map((v) => ({
      ...(cfgTrains.get(v.id) ?? { id: v.id, name: v.name, track: v.where, direction: v.direction, wagons: v.wagons.slice() }), start: start(v),
    }));
    out.barges = this._barges.map((v) => ({
      ...(cfgBarges.get(v.id) ?? { id: v.id, name: v.name, quay: v.where, length_m: v.length_m, tiers: v.tiers }), start: start(v),
    }));
    return out;
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
    const out = [];
    for (const c of this.carriers()) if (c.present && c.pose) out.push(...this._carrierBoxes(c));
    return out;
  }

  /**
   * Boxes of the places a container could go now.
   * @returns {{target: import("./types.js").Target, box: import("./types.js").Box}[]}
   */
  targetBoxes(containerId, view) {
    const c = this.inventory.get(containerId);
    if (!c) return [];
    const out = [];
    for (const target of this.targets(containerId).ok) {
      const box = this._targetBox(target.at, c);
      if (box) out.push({ target, box });
    }
    return out;
  }

  /** Box of a container at a slot it could go to: on the stack there, not where it stands now. */
  _targetBox(ref, c) {
    const box = this._slotBox(ref, c);
    return box ? { ...box, id: `${c.id}→${ref.carrier}/${ref.bay}/${ref.row ?? 0}/${ref.tier ?? 0}` } : null;
  }

  /**
   * The carrier whose footprint contains a layout point (mm).
   * @returns {string | null}
   */
  carrierAt(point, view) {
    if (!point) return null;
    for (const c of this.carriers()) {
      if (!c.present || !c.pose) continue;
      const fp = c.footprint(this.world.scale);
      if (fp && pointInPolygon(point, fp)) return c.id;
    }
    return null;
  }

  /** Draw boxes of the containers on a carrier (cached until the inventory or the pose changes). */
  _carrierBoxes(carrier) {
    const p = carrier.pose;
    if (!p) return [];
    const key = `${this._version}:${p.center[0]}:${p.center[1]}:${p.heading}`;
    const hit = this._boxCache.get(carrier.id);
    if (hit && hit.key === key) return hit.boxes;
    const boxes = [];
    for (const c of this.inventory.on(carrier.id)) {
      const b = this._slotBox(c.at, c);
      if (b) boxes.push(Object.assign(b, { size: c.size, high: c.high, colour: this._colour(c), at: c.at }));
    }
    this._boxCache.set(carrier.id, { key, boxes });
    return boxes;
  }

  /** Body colour [r, g, b] of a container (cached by id). */
  _colour(c) {
    let col = this._colours.get(c.id);
    if (!col) this._colours.set(c.id, (col = colourFor(c)));
    return col;
  }

  /** Draw box of the container on a handler's spreader. */
  _loadBox(h) {
    const c = h.load;
    if (!c || c.handler !== h.id) return null;
    const height = this.mm(c.height_m), base = { id: c.id, length: this.mm(c.length_m), width: this.mm(CONTAINER_WIDTH_M), height, size: c.size, high: c.high, colour: this._colour(c) };
    if (h.kind === "crane") return { ...base, center: h.point(), heading: h.loadHeading, z0: h.z - height };
    const head = posePoint({ center: h.center, heading: h.heading }, stackerReach(h.boom), 0, this.world.scale);
    return { ...base, center: head, heading: h.heading + Math.PI / 2, z0: h.lift - height };
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
    return rollingHeightMM(this._stockEntry(number)?.height_mm) ?? r.height_mm;
  }

  /** The tracker of model wagons, (re)built for the current `markers.rolling`; null without it. */
  _rollingStock() {
    const r = this.rollingConfig();
    if (!r) return null;
    if (!this.rolling || this.rolling.stride !== r.stride || this.rolling.size_mm !== r.size_mm) {
      this.rolling = new RollingStock({
        stride: r.stride, size_mm: r.size_mm,
        // a lookup only: the carrier is created in _syncWagons, for wagons the tracker keeps
        slotAlongMM: (number, slot) => this._tagAlongMM(number, slot),
        slotTurn: (number, slot) => this._tagTurn(number, slot),
        tracks: () => this._tracks,
      });
    }
    return this.rolling;
  }

  /**
   * Feed the tags seen in one frame.
   * @param {{[tagId: string]: import("./types.js").TagObservation}} observations
   * @param {number} time real seconds
   * @param {{still?: boolean}} [options]
   */
  observe(observations, time, { still = false } = {}) {
    this._syncInfra();
    const r = this._rollingStock();
    if (!r) return;
    r.observe(observations, time, { still });
    this._syncWagons(true);
  }

  /** A new image source: the model wagons become "lost". */
  forgetObservations() {
    if (!this.rolling) return;
    this.rolling.reset();
    this._syncWagons(true);
  }

  /** Poses and flags of the model wagons from the tracker (§5.6); emits `wagon.seen` and `wagon.lost`. */
  _syncWagons(events) {
    for (const [number, w] of this.rolling.wagons) {
      const c = this._wagonCarrier(number), before = c.tracked ?? "lost";
      if (w.center && Number.isFinite(w.heading)) c.pose = { center: w.center, heading: w.heading };
      c.present = w.state !== "lost";
      // held counts only for a wagon that stood still: one hidden while moving may still be moving
      c.available = w.state === "standing" || (w.state === "held" && w.stood);
      c.tracked = w.state;
      if (!events) continue;
      if (before === "lost" && w.state !== "lost") this._emit(EV.wagonSeen, { carrier: c });
      else if (before !== "lost" && w.state === "lost") this._emit(EV.wagonLost, { carrier: c });
    }
  }

  /* ---------------------------------------------------------------- events */

  _emit(name, payload) {
    this.world.events.emit(name, { terminal: this, ...payload });
  }

  _visitEvent(name, visit) {
    this._changed();
    this._emit(name, { visit });
  }

  /** Requests from scenarios (`emit` steps); a refusal becomes a scenario message "Terminal: …". */
  _listen() {
    const say = (reason) => {
      if (reason) this.world.events.emit("scenario.message", { scenario: null, text: `Terminal: ${reason}` });
    };
    const sayRefused = ({ refused }) => {
      if (refused.length) say(refused[0].reason + (refused.length > 1 ? ` (and ${refused.length - 1} more)` : ""));
    };
    const on = (name, fn) => {
      this._offs.push(this.world.events.on(name, (p) => {
        try {
          fn(isObject(p) ? p : {});
        } catch (err) {
          say(err.message);
        }
      }));
    };
    on(REQ.call, (p) => say(this.call(p.visit)));
    on(REQ.depart, (p) => say(this.depart(p.visit, { force: p.force === true })));
    on(REQ.move, (p) => say(this._request(p.container, p.to, { source: "scenario" }).error));
    on(REQ.truck, (p) => say(this.sendTruck({ purpose: p.purpose ?? "pickup", size: p.size ?? null }).error));
    on(REQ.train, (p) => say(this.addTrain({ track: p.track, wagons: p.wagons, load: p.load ?? "empty", name: p.name ?? null }).error));
    on(REQ.barge, (p) => say(this.addBarge({ quay: p.quay, length_m: p.length_m, load: p.load ?? "empty", name: p.name ?? null }).error));
    on(REQ.reset, () => this.reset());
    on(REQ.unload, (p) => sayRefused(this._unload(p.visit, { to: p.to ?? "yard", source: "scenario" })));
    on(REQ.load, (p) => sayRefused(this._load(p.visit, { from: p.from ?? "yard", source: "scenario" })));
  }

  /* ---------------------------------------------------------------- Simulation hooks */

  step(dt) {
    this._syncInfra();
    for (const v of this._trains) v.step(dt, this);
    for (const v of this._barges) v.step(dt, this);
    this._autoLeave(dt);
    if (this._trucks.length) stepTrucks(this._trucks, this._lane(), dt, this);
    this._dispatch();
    for (const h of this.handlers.values()) if (h.object.geometry) h.step(dt, this);
  }

  draw(view) {
    this._syncInfra();
    const flyover = !!view.virtual, alpha = flyover ? 1 : 0.9, lit = (view.darkness ?? 0) > 0.35;
    // 1. handlers
    for (const h of this.handlers.values()) {
      const g = h.object.geometry;
      if (!g) continue;
      const load = this._loadBox(h);
      if (h.kind === "crane") drawCrane(view, { geometry: g, s: h.s, t: h.t, z: h.z, spreader_m: h.spreader_m, load, name: h.name, lit });
      else drawReachStacker(view, { center: h.center, heading: h.heading, boom: h.boom, lift: h.lift, spreader_m: h.spreader_m, load, name: h.name, lit });
    }
    // 2. yard stacks (and the slot numbers)
    for (const [id, c] of this._yards) {
      if (!c.present) continue;
      drawYardStacks(view, this._stacks(c));
      if (this.highlight.slots) drawYardLabels(view, this.world.getObject(id)?.geometry);
    }
    // 3. trains: locomotive, then wagons
    for (const v of this._trains) {
      if (!v.visible(this)) continue;
      drawLocomotive(view, { center: v.loco.center, heading: v.loco.heading, length_m: LOCO_M, alpha, lit, label: v.name });
      for (const c of v.carriers) drawWagon(view, { type: c.type, center: c.pose.center, heading: c.pose.heading, deck: this._deckZ(c), alpha, tags: null }, this._carrierBoxes(c));
    }
    // 4. trucks
    for (const t of this._trucks) {
      if (!t.visible(this)) continue;
      const c = t.carriers[0];
      drawTruck(view, { id: t.id, type: c.type, center: c.pose.center, heading: c.pose.heading, alpha, lit, label: t.name }, this._carrierBoxes(c));
    }
    // 5. barges
    for (const v of this._barges) {
      if (!v.visible(this)) continue;
      const c = v.carriers[0], byBay = Array.from({ length: c.bays }, () => []);
      for (const b of this._carrierBoxes(c)) byBay[b.at.bay]?.push(b);
      drawBarge(view, { type: c.type, center: c.pose.center, heading: c.pose.heading, alpha, lit, name: v.name }, byBay);
    }
    // 6. model wagons: solid in the flyover; over the camera image only their containers (or a ghost)
    const stride = this.rollingConfig()?.stride ?? 4;
    for (const c of this._wagons.values()) {
      if (!c.pose) continue;
      const boxes = this._carrierBoxes(c), ref = [c.pose.center[0], c.pose.center[1], 0];
      if (flyover) {
        const tags = Array.from({ length: this.tagCount(c.number) }, (_, slot) => ({ slot, id: encodeTag(c.number, slot, stride), at_m: this._tagAlongMM(c.number, slot) / this.mm(1) }));
        drawWagon(view, { type: c.type, center: c.pose.center, heading: c.pose.heading, deck: this._deckZ(c), alpha: 1, tags }, boxes);
      } else if (c.present) {
        drawContainers(view, boxes, ref, { alpha: 0.92 });
      } else {
        drawGhost(view, c.footprint(this.world.scale), this._deckZ(c), `${c.id} not visible`);
        drawContainers(view, boxes, ref, { alpha: 0.35 });
      }
    }
    // 7. highlights
    this._drawHighlights(view, flyover);
  }

  /** Yard stacks (draw boxes, bottom to top) of a yard carrier. */
  _stacks(c) {
    const boxes = this._carrierBoxes(c), hit = this._boxCache.get(c.id);
    if (!hit) return [];
    if (hit.stacks) return hit.stacks;
    const by = new Map();
    for (const b of boxes) {
      const k = `${b.at.bay}:${b.at.row}`;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(b);
    }
    hit.stacks = [...by.values()];
    return hit.stacks;
  }

  /** The selected container, the boxes of its targets and (camera view) the empty slots of model wagons. */
  _drawHighlights(view, flyover) {
    const hl = this.highlight;
    const c = hl.selected ? this.inventory.get(hl.selected) : null;
    let selected = null;
    if (c?.at) selected = (this._carrierBoxes(this.carrier(c.at.carrier)) || []).find((b) => b.id === c.id) ?? null;
    else if (c?.handler) selected = this._loadBox(this.handlers.get(c.handler) ?? {});
    const targets = [];
    for (const t of Array.isArray(hl.targets) ? hl.targets : []) {
      const box = t?.center ? t : t?.box?.center ? t.box : t?.at && c ? this._targetBox(t.at, c) : null;
      if (box) targets.push(box);
    }
    const empties = [];
    if (hl.slots && !flyover) {
      const probe = { id: "", size: "20", length_m: CONTAINER_SIZES["20"].length_m, height_m: 0 };
      for (const w of this._wagons.values()) {
        if (!w.present || !w.pose) continue;
        for (let bay = 0; bay < w.bays; bay++) if (!this.inventory.at(w.id, 0, bay, 0)) empties.push(this._slotBox({ carrier: w.id, bay }, probe));
      }
    }
    if (selected || targets.length || empties.length) drawHighlights(view, { selected, targets, empties: empties.filter(Boolean) });
  }

  /** Deliberately empty: "Clear passengers" must not empty the terminal. */
  clear() {}

  dispose() {
    for (const off of this._offs) off();
    this._offs = [];
  }

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

/* ---------------------------------------------------------------- validation */

/** Per normalized layout: how many identical first terminal entries were checked (to tell duplicates apart). */
const CHECKED = new WeakMap();

/**
 * Problems of a terminal entry (§5.9): list shapes, visit ids, the objects it refers to, types and
 * values, the containers (placed in file order on a scratch inventory), the fill and the rolling stock.
 * @param {object} cfg
 * @param {object} layout normalized layout
 * @returns {string[]}
 */
function validateTerminal(cfg, layout) {
  const out = [];
  if (!isObject(cfg)) return out;
  const objects = new Map((Array.isArray(layout?.objects) ? layout.objects : []).filter(isObject).map((o) => [o.id, o]));
  const isType = (id, type) => objects.get(id)?.type === type;
  const scale = Number(layout?.scale) > 0 ? Number(layout.scale) : 87;
  const list = (key) => {
    const v = cfg[key];
    if (v == null) return [];
    if (Array.isArray(v)) return v;
    out.push(`${key} must be a list`);
    return [];
  };
  const trains = list("trains"), barges = list("barges"), containers = list("containers"), stock = list("rolling_stock");
  const inv = new Inventory();

  if (cfg.default_wagon != null && !isWagonType(cfg.default_wagon)) out.push(`default_wagon: unknown wagon type "${cfg.default_wagon}"`);
  const defWagon = isWagonType(cfg.default_wagon) ? cfg.default_wagon : "sgns60";

  const visitIds = new Set();
  const visitId = (e, key, i) => {
    if (!isObject(e) || typeof e.id !== "string" || !e.id) {
      out.push(`${key}[${i}] has no id`);
      return null;
    }
    if (visitIds.has(e.id)) out.push(`duplicate visit id "${e.id}"`);
    else if (e.id.includes("/") || RESERVED_ID.test(e.id)) out.push(`visit id "${e.id}" must not contain "/" or look like W1 or T1`);
    else {
      visitIds.add(e.id);
      return e.id;
    }
    return null;
  };
  trains.forEach((t, i) => {
    const id = visitId(t, "trains", i);
    if (id == null) return;
    const p = `trains[${i}] (${id})`;
    if (!isType(t.track, "track")) out.push(`${p}: no track "${t.track}"`);
    const wagons = Array.isArray(t.wagons) && t.wagons.length ? t.wagons : [defWagon, defWagon, defWagon];
    for (const w of wagons) if (!isWagonType(w)) out.push(`${p}: unknown wagon type "${w}"`);
    wagons.forEach((w, k) => inv.addCarrier(new Carrier({ id: `${id}/${k + 1}`, type: isWagonType(w) ? w : defWagon })));
    if (t.direction != null && t.direction !== 1 && t.direction !== -1) out.push(`${p}: direction must be 1 or -1`);
    if (t.stop_mm != null && !(typeof t.stop_mm === "number" && t.stop_mm >= 0)) out.push(`${p}: stop_mm must be a number ≥ 0`);
  });
  barges.forEach((b, i) => {
    const id = visitId(b, "barges", i);
    if (id == null) return;
    const p = `barges[${i}] (${id})`;
    if (!isType(b.quay, "quay")) out.push(`${p}: no quay "${b.quay}"`);
    if (b.length_m != null && !(typeof b.length_m === "number" && b.length_m >= 25 && b.length_m <= 110)) out.push(`${p}: length_m must be 25–110`);
    if (b.tiers != null && !(Number.isInteger(b.tiers) && b.tiers >= 1 && b.tiers <= 3)) out.push(`${p}: tiers must be 1–3`);
    inv.addCarrier(new Carrier({ id, type: bargeType({ length_m: Number(b.length_m) || 55, tiers: Number(b.tiers) || 2 }) }));
  });
  if (isObject(cfg.trucks) && cfg.trucks.lane != null && !isType(cfg.trucks.lane, "truck-lane")) out.push(`trucks.lane: no truck lane "${cfg.trucks.lane}"`);
  for (const o of objects.values()) if (o.type === "container-yard") inv.addCarrier(new Carrier({ id: o.id, type: yardSpecType(o, scale) }));

  // rolling stock (model wagons)
  const rolling = layout?.markers?.rolling ?? null, numbers = new Map(), withPositions = new Set();
  stock.forEach((w, i) => {
    if (!isObject(w) || !Number.isInteger(w.number) || w.number < 1) {
      out.push(`rolling_stock[${i}]: number must be a whole number ≥ 1`);
      return;
    }
    if (numbers.has(w.number)) out.push(`rolling_stock[${i}]: duplicate number ${w.number}`);
    if (w.type != null && !isWagonType(w.type)) out.push(`rolling_stock[${i}]: unknown type "${w.type}"`);
    if (w.height_mm != null && rollingHeightMM(w.height_mm) == null) out.push(`rolling_stock[${i}]: height_mm must be a number from 0 to 200 (mm)`);
    const type = isWagonType(w.type) ? w.type : defWagon;
    numbers.set(w.number, stockCarrierType(w, type, scale));
    const at = tagPositions(w), half = (CARRIER_TYPES[type].length_m * 1000) / scale / 2;
    if (w.spots_mm != null) {
      // container spots where they are (e.g. the two trailers of a model truck): 20 ft each
      const spots = numberList(w.spots_mm), pitch = (6.1 * 1000) / scale;
      if (!spots || spots.length > 4) out.push(`rolling_stock[${i}]: spots_mm must be a list of 1 to 4 numbers (mm from the wagon's centre, + towards the A end)`);
      else if (spots.some((a) => Math.abs(a) > half)) out.push(`rolling_stock[${i}]: spots_mm must lie on the wagon, within ${Math.round(half)} mm of its centre`);
      else if (spots.some((a, k) => spots.some((b, l) => l > k && Math.abs(a - b) < pitch - 0.5))) out.push(`rolling_stock[${i}]: the spots in spots_mm overlap: a 20 ft spot is ${Math.round(pitch)} mm long`);
    }
    if (w.tags_deg != null) {
      const turns = numberList(w.tags_deg);
      if (!turns || turns.some((d) => Math.abs(d) > 360)) out.push(`rolling_stock[${i}]: tags_deg must be a list of numbers from -360 to 360 (how each tag is turned; 180: its arrow points to the B end)`);
    }
    if (w.tags_mm != null) {
      // tags stuck where they fit (not one per spot): positions along the wagon, from its centre
      const size = rolling?.size_mm ?? 20;
      if (!at) out.push(`rolling_stock[${i}]: tags_mm must be a list of numbers (mm from the wagon's centre, + towards the A end)`);
      else if (rolling && at.length > rolling.stride) out.push(`rolling_stock[${i}]: ${at.length} tags in tags_mm, but markers.rolling.stride is ${rolling.stride}`);
      else if (at.some((a) => Math.abs(a) > half)) out.push(`rolling_stock[${i}]: tags_mm must lie on the wagon, within ${Math.round(half)} mm of its centre`);
      else if (at.some((a, k) => at.some((b, l) => l > k && Math.abs(a - b) < size))) out.push(`rolling_stock[${i}]: the tags in tags_mm overlap: keep them at least ${size} mm apart`);
    }
    if (at) withPositions.add(w.number);
    if (rolling) {
      const spots = numberList(w.spots_mm)?.length ?? CARRIER_TYPES[type].bays_m.length;
      const count = Math.min(at ? at.length : spots, rolling.stride);
      const max = encodeTag(w.number, count - 1, rolling.stride);
      if (max >= rolling.codes) out.push(`rolling_stock[${i}]: wagon ${w.number} needs tag IDs up to ${max}, but markers.rolling.codes is ${rolling.codes}`);
    }
  });
  if (stock.length && !rolling) out.push("rolling_stock: markers.rolling is missing, so model wagons cannot be seen");
  // a tag on every container spot (wagons without tags_mm): wagon types with more spots than IDs
  // per wagon cannot get deck cards
  if (rolling) {
    for (const type of new Set([defWagon, ...[...numbers].filter(([n]) => !withPositions.has(n)).map(([, t]) => t)])) {
      const t = typeof type === "string" ? CARRIER_TYPES[type] : type, spots = t.bays_m.length;
      if (spots > rolling.stride) out.push(`markers.rolling.stride is ${rolling.stride}, but ${t.label} has ${spots} container spots: use at least ${spots} IDs per wagon`);
    }
  }
  const wagonCarrier = (id) => {
    const m = MODEL_WAGON.exec(String(id));
    if (m && !inv.carriers.has(id)) inv.addCarrier(new Carrier({ id, type: numbers.get(Number(m[1])) ?? defWagon }));
  };

  // containers, placed in file order
  const seen = new Set();
  containers.forEach((e, i) => {
    if (!isObject(e) || typeof e.id !== "string" || !e.id) {
      out.push(`containers[${i}] has no id`);
      return;
    }
    if (seen.has(e.id)) {
      out.push(`containers[${i}]: duplicate id "${e.id}"`);
      return;
    }
    seen.add(e.id);
    const p = `containers[${i}] (${e.id})`;
    const size = String(e.size ?? "20");
    if (!CONTAINER_SIZES[size]) {
      out.push(`${p}: unknown size "${e.size}"`);
      return;
    }
    const bic = bicProblem(e.id);
    if (bic) out.push(`${p}: ${bic}`);
    const carrier = isObject(e.at) ? e.at.carrier : undefined;
    wagonCarrier(carrier);
    if (!inv.carriers.has(carrier)) {
      out.push(`${p}: unknown place "${carrier}"`);
      return;
    }
    const reason = inv.add(new Container({ id: e.id, size, high: e.high === true }), slotRef(e.at));
    if (reason) out.push(`${p}: ${reason}`);
  });

  // fill
  if (cfg.fill != null) {
    if (!isObject(cfg.fill)) out.push("fill must be an object like {\"yard-1\": 0.3}");
    else {
      for (const [id, f] of Object.entries(cfg.fill)) {
        if (!isType(id, "container-yard")) out.push(`fill: no container yard "${id}"`);
        if (!(typeof f === "number" && f >= 0 && f <= 1)) out.push(`fill.${id} must be 0–1`);
      }
    }
  }

  // one terminal per layout: reported on every terminal entry after the first
  const terminals = (Array.isArray(layout?.simulations) ? layout.simulations : []).filter((s) => isObject(s) && s.type === TerminalSimulation.type);
  if (terminals.length > 1) {
    const first = JSON.stringify(terminals[0]);
    let later = JSON.stringify({ ...cfg, type: TerminalSimulation.type }) !== first && JSON.stringify(cfg) !== first;
    if (!later) {
      const n = CHECKED.get(layout) ?? 0;
      CHECKED.set(layout, n + 1);
      later = n > 0;
    }
    if (later) out.push("only one container terminal per layout");
  }
  return out;
}

