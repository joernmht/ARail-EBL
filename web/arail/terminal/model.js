/**
 * Container terminal: containers, carriers (wagons, trucks, barges, yard blocks) and the
 * inventory of who stands where, with the stacking rules.
 *
 * Carrier-local coordinates are prototype metres: `along` + towards the front (A end), `across`
 * + to the left. Bays are 20 ft positions along the carrier, rows lie across it, tiers count
 * from the bottom; a 40 or 45 ft container covers two bays and is referred to by its first bay.
 *
 * A carrier's pose (layout mm, heading in radians) is set by its owner (a visit, a yard block, a
 * tracked model wagon); the inventory knows nothing about positions, only slots.
 * @module arail/terminal/model
 */

/** Container sizes: label, length (m), bays covered and TEU. */
export const CONTAINER_SIZES = Object.freeze({
  "20": { label: "20 ft", length_m: 6.058, bays: 1, teu: 1 },
  "40": { label: "40 ft", length_m: 12.192, bays: 2, teu: 2 },
  "45": { label: "45 ft", length_m: 13.716, bays: 2, teu: 2 },
});
export const CONTAINER_WIDTH_M = 2.438, CONTAINER_HEIGHT_M = 2.591, HIGH_CUBE_HEIGHT_M = 2.896;
/** Bay pitch of yard blocks and barge holds (m); two bays take a 45 ft box. */
export const BAY_M = 6.9;
/** Row pitch of yard blocks and barge holds (m). */
export const ROW_M = 2.9;

/**
 * Carrier types: wagons and the truck chassis. `bays_m`: carrier-local position of each 20 ft bay
 * centre, + towards the front (A end); `rows_m`: + to the left; `pairs`: allowed first bays of 2-bay
 * boxes (null = any b with b + 1 < bays); `running_m`: bogie (or, with `axles`, axle) centres;
 * `deck_m`: height of the loading deck above the rail top.
 */
export const CARRIER_TYPES = Object.freeze({
  sgns60: { kind: "wagon", label: "Sgns (60 ft)", length_m: 19.74, width_m: 2.9, deck_m: 1.155, bays_m: [6.1, 0, -6.1], rows_m: [0], tiers: 1, sizes: ["20", "40"], pairs: [0, 1], running_m: [7.1, -7.1] },
  lgns40: { kind: "wagon", label: "Lgns (40 ft)", length_m: 13.86, width_m: 2.9, deck_m: 1.17, bays_m: [3.05, -3.05], rows_m: [0], tiers: 1, sizes: ["20", "40"], pairs: [0], running_m: [4.5, -4.5], axles: true },
  sggrss80: { kind: "wagon", label: "Sggrss (80 ft)", length_m: 26.39, width_m: 2.9, deck_m: 1.155, bays_m: [9.65, 3.55, -3.55, -9.65], rows_m: [0], tiers: 1, sizes: ["20", "40"], pairs: [0, 2], running_m: [11.6, 0, -11.6] },
  chassis40: { kind: "truck", label: "Truck (40 ft chassis)", length_m: 16.5, width_m: 2.55, deck_m: 1.25, bays_m: [3.05, -3.05], rows_m: [0], tiers: 1, sizes: ["20", "40", "45"], pairs: [0], front_m: 9.7, rear_m: -6.8 },
});

/**
 * Carrier type of a yard block: `bays` × `rows` stacks of up to `tiers` containers, centred on
 * the block.
 * @param {{bays: number, rows: number, tiers: number}} grid
 */
export function yardType({ bays, rows, tiers }) {
  return {
    kind: "yard", label: "Yard block", length_m: bays * BAY_M, width_m: rows * ROW_M, deck_m: 0,
    bays_m: Array.from({ length: bays }, (_, k) => (-bays * BAY_M) / 2 + BAY_M * (k + 0.5)),
    rows_m: Array.from({ length: rows }, (_, r) => (-rows * ROW_M) / 2 + ROW_M * (r + 0.5)),
    tiers, sizes: ["20", "40", "45"], pairs: null,
  };
}

/**
 * Carrier type of an inland barge: holds of 6.9 m bays behind a 4 m bow, three rows; the
 * wheelhouse is at the stern.
 * @param {{length_m?: number, tiers?: number}} [options]
 */
export function bargeType({ length_m = 55, tiers = 2 } = {}) {
  const bays = Math.max(1, Math.floor((length_m - 16) / BAY_M));
  return {
    kind: "barge", label: "Inland barge", length_m, width_m: 9.5, deck_m: 1.4,
    bays_m: Array.from({ length: bays }, (_, k) => length_m / 2 - 4 - BAY_M * (k + 0.5)),
    rows_m: [-2.9, 0, 2.9],
    tiers, sizes: ["20", "40", "45"], pairs: null,
  };
}

/* ---------------------------------------------------------------- BIC code (ISO 6346) */

/** Letter values of ISO 6346: A = 10, B = 12 … (multiples of 11 are skipped). */
const LETTER_VALUES = (() => {
  const values = {};
  let v = 10;
  for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    if (v % 11 === 0) v++;
    values[c] = v++;
  }
  return values;
})();

/**
 * Check digit of a container number (ISO 6346): letter values A = 10, B = 12 … (skipping multiples
 * of 11), weights 2^i, sum mod 11 mod 10. `bicCheckDigit("CSQU305438")` → 3.
 * @param {string} code10 owner code (4 letters) and serial number (6 digits); spaces are ignored
 * @returns {number} 0-9, or NaN if `code10` is not 4 letters and 6 digits
 */
export function bicCheckDigit(code10) {
  const s = String(code10 ?? "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{4}\d{6}$/.test(s)) return NaN;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (i < 4 ? LETTER_VALUES[s[i]] : Number(s[i])) * 2 ** i;
  return (sum % 11) % 10;
}

/**
 * Split a container number into owner code, serial number and check digit. Accepts
 * "CSQU 305438 3", "CSQU3054383" and "CSQU 305438-3".
 * @param {string} id
 * @returns {{owner: string, serial: string, check: number} | null} serial as 6 digits; null if `id` is not shaped like a container number
 */
export function parseBic(id) {
  const m = /^\s*([A-Za-z]{4})\s*(\d{6})\s*-?\s*(\d)\s*$/.exec(String(id ?? ""));
  return m ? { owner: m[1].toUpperCase(), serial: m[2], check: Number(m[3]) } : null;
}

/**
 * What is wrong with a container number, e.g. "check digit should be 3".
 * @param {string} id
 * @returns {string | null} null if `id` is correct or not shaped like a container number
 */
export function bicProblem(id) {
  const bic = parseBic(id);
  if (!bic) return null;
  const check = bicCheckDigit(bic.owner + bic.serial);
  return check === bic.check ? null : `check digit should be ${check}`;
}

/**
 * A container number with its check digit: `makeBic("TRKU", 123)` → "TRKU 000123 9".
 * @param {string} owner4 owner code and category (4 letters)
 * @param {number} serial serial number (zero-padded to 6 digits; only the last 6 digits are used)
 */
export function makeBic(owner4, serial) {
  const owner = String(owner4).toUpperCase();
  const digits = String(Math.abs(Math.trunc(Number(serial) || 0)) % 1e6).padStart(6, "0");
  return `${owner} ${digits} ${bicCheckDigit(owner + digits)}`;
}

/* ---------------------------------------------------------------- containers, carriers, inventory */

/** A container (identified by its BIC code). */
export class Container {
  /**
   * @param {{id: string, size?: "20"|"40"|"45"|number, high?: boolean, colour?: string|null, label?: string}} options
   */
  constructor({ id, size = "20", high = false, colour = null, label = "" }) {
    this.id = id;
    /** @type {"20"|"40"|"45"} */
    this.size = String(size);
    this.high = high === true;
    this.colour = colour;
    this.label = label;
    /** @type {import("./types.js").SlotRef | null} slot while stored on a carrier */
    this.at = null;
    /** @type {string | null} id of the handler carrying it */
    this.handler = null;
    /** @type {string | null} id of the queued or active move that will move it */
    this.move = null;
  }

  /** Length (m). */
  get length_m() {
    return CONTAINER_SIZES[this.size]?.length_m ?? CONTAINER_SIZES["20"].length_m;
  }

  /** Height (m): 9 ft 6 in for high cubes, 8 ft 6 in otherwise. */
  get height_m() {
    return this.high ? HIGH_CUBE_HEIGHT_M : CONTAINER_HEIGHT_M;
  }

  get teu() {
    return CONTAINER_SIZES[this.size]?.teu ?? 1;
  }

  /** Bays covered (1 or 2). */
  get bays() {
    return CONTAINER_SIZES[this.size]?.bays ?? 1;
  }

  /** Entry for the layout file: `{id, size, high?: true, colour?, label?}`. */
  toJSON() {
    return { id: this.id, size: this.size, ...(this.high ? { high: true } : {}), ...(this.colour ? { colour: this.colour } : {}), ...(this.label ? { label: this.label } : {}) };
  }
}

/** Bays covered by containers of a size (1 for unknown sizes). */
const baysOf = (size) => CONTAINER_SIZES[String(size)]?.bays ?? 1;

/** Something containers stand on: a wagon, a truck, a barge or a yard block. */
export class Carrier {
  /**
   * @param {{id: string, type: string|object, label?: string, owner?: string|null}} options type: key of
   *   {@link CARRIER_TYPES} or a type object (e.g. from {@link yardType})
   */
  constructor({ id, type, label, owner = null }) {
    this.id = id;
    this.type = typeof type === "string" ? CARRIER_TYPES[type] ?? null : type ?? null;
    this.kind = this.type?.kind ?? null;
    this.label = label ?? this.type?.label ?? id;
    /** Visit or object that owns this carrier. */
    this.owner = owner;
    /** @type {{center: number[], heading: number} | null} set by its owner every step; null = unknown */
    this.pose = null;
    /** Here: drawn, listed, a possible target (an approaching train is present). */
    this.present = false;
    /** A handler may lift from or set down on it now. */
    this.available = false;
  }

  /** Number of bays. */
  get bays() {
    return this.type?.bays_m?.length ?? 0;
  }

  /** Number of rows. */
  get rows() {
    return this.type?.rows_m?.length ?? 0;
  }

  /** Highest stack. */
  get tiers() {
    return this.type?.tiers ?? 0;
  }

  /** Does it take containers of this size? */
  allows(size) {
    return !!this.type?.sizes?.includes(String(size));
  }

  /**
   * Allowed first bays for a container size: every bay for 20 ft, the type's `pairs` (or every bay
   * with a bay behind it) for 40 and 45 ft.
   * @returns {number[]}
   */
  firstBays(size) {
    if (!this.allows(size)) return [];
    const bays = this.bays;
    if (baysOf(size) === 1) return Array.from({ length: bays }, (_, b) => b);
    const pairs = this.type.pairs;
    if (Array.isArray(pairs)) return pairs.filter((b) => Number.isInteger(b) && b >= 0 && b + 1 < bays);
    return Array.from({ length: Math.max(0, bays - 1) }, (_, b) => b);
  }

  /**
   * Carrier-local position (m) along it of a bay; for 2-bay sizes the midpoint of bays `bay` and `bay + 1`.
   * @returns {number} NaN if there is no such bay
   */
  along(bay, size = "20") {
    const b = this.type?.bays_m ?? [];
    const v = baysOf(size) === 2 ? (b[bay] + b[bay + 1]) / 2 : b[bay];
    return Number.isFinite(v) ? v : NaN;
  }

  /**
   * Carrier-local position (m) across it of a row (+ to the left).
   * @returns {number} NaN if there is no such row
   */
  across(row) {
    return this.type?.rows_m?.[row] ?? NaN;
  }

  /**
   * Layout point (mm) of a carrier-local position.
   * @param {number} along_m + towards the front (A end)
   * @param {number} across_m + to the left
   * @param {number} scale e.g. 87 for H0
   * @returns {number[] | null} null while the pose is unknown
   */
  toLayout(along_m, across_m, scale) {
    const p = this.pose;
    if (!p || !Array.isArray(p.center)) return null;
    const k = 1000 / scale, h = Number(p.heading) || 0;
    const a = along_m * k, t = across_m * k, c = Math.cos(h), s = Math.sin(h);
    return [p.center[0] + c * a - s * t, p.center[1] + s * a + c * t];
  }

  /**
   * Outline (layout mm, counter-clockwise): its length × width around the pose; trucks reach from
   * `rear_m` to `front_m` of their type.
   * @param {number} scale
   * @returns {number[][] | null} null while the pose is unknown
   */
  footprint(scale) {
    const t = this.type;
    if (!t) return null;
    const front = t.front_m ?? t.length_m / 2, rear = t.rear_m ?? -t.length_m / 2, half = t.width_m / 2;
    const out = [[rear, -half], [front, -half], [front, half], [rear, half]].map(([a, c]) => this.toLayout(a, c, scale));
    return out[0] ? out : null;
  }
}

/* ---------------------------------------------------------------- inventory */

const cellKey = (row, bay, tier) => `${tier}:${row}:${bay}`;

/** A slot reference with numbers, row and tier defaulting to 0; null if `ref` is not an object. */
function slotOf(ref) {
  if (!ref || typeof ref !== "object") return null;
  return { carrier: ref.carrier, bay: Number(ref.bay), row: ref.row == null ? 0 : Number(ref.row), tier: ref.tier == null ? 0 : Number(ref.tier) };
}

const where = (at) => `${at.carrier} bay ${at.bay + 1} row ${at.row + 1} tier ${at.tier + 1}`;

/**
 * Where all containers are: carriers by id, containers by id, reservations of queued moves.
 * Every method that refuses returns the reason as a sentence (null = fine).
 *
 * A container is either stored (`at` is its slot; it fills the cells of that slot) or carried by a
 * handler between `detach` and `attach` (`handler` is set, it fills no cell). A stored container's
 * cells are occupied for every other container; for itself they count as free, so `canPlace`
 * answers "as if it were lifted first". Cells reserved by a move are free only for the container
 * of that move (`container.move`).
 */
export class Inventory {
  constructor() {
    /** @type {Map<string, Carrier>} */
    this.carriers = new Map();
    /** @type {Map<string, Container>} */
    this.containers = new Map();
    /** @type {Map<string, Map<string, string>>} carrier id → cell → container id */
    this._cells = new Map();
    /** @type {Map<string, Map<string, string>>} carrier id → cell → move id */
    this._reserved = new Map();
    /** @type {Map<string, {at: import("./types.js").SlotRef, size: string, keys: string[]}>} move id → reservation */
    this._reservations = new Map();
  }

  /**
   * Add a carrier. A carrier with the same id is replaced and the containers on it stay (e.g. a
   * resized yard block: remove the containers that no longer fit, `check()` lists them).
   * @param {Carrier} carrier
   * @returns {Carrier}
   */
  addCarrier(carrier) {
    this.carriers.set(carrier.id, carrier);
    return carrier;
  }

  /**
   * Remove a carrier; the containers on it and the reservations on it are removed too.
   * @returns {Container[]} the removed containers
   */
  removeCarrier(id) {
    const removed = this.on(id);
    for (const c of removed) this.remove(c.id);
    for (const [moveId, r] of [...this._reservations]) if (r.at.carrier === id) this.release(moveId);
    this._cells.delete(id);
    this._reserved.delete(id);
    this.carriers.delete(id);
    return removed;
  }

  /**
   * Initial placement of a container (as `canPlace`).
   * @param {Container} container
   * @param {import("./types.js").SlotRef} ref
   * @returns {string | null} the reason on failure
   */
  add(container, ref) {
    if (!container) return "No container";
    if (this.containers.has(container.id)) return `${container.id} is already in the terminal`;
    container.at = null;
    const reason = this.canPlace(container, ref);
    if (reason) return reason;
    container.handler = null;
    this.containers.set(container.id, container);
    this._occupy(container, slotOf(ref));
    return null;
  }

  /**
   * A container leaves the terminal (from its slot or from a handler).
   * @returns {Container | null}
   */
  remove(containerId) {
    const c = this.get(containerId);
    if (!c) return null;
    this._vacate(c);
    this.containers.delete(c.id);
    c.at = null;
    c.handler = null;
    return c;
  }

  /** @returns {Container | null} */
  get(id) {
    return this.containers.get(id) ?? null;
  }

  /**
   * Containers stored on a carrier, sorted by tier, row, bay.
   * @returns {Container[]}
   */
  on(carrierId) {
    const out = [];
    for (const c of this.containers.values()) if (c.at && c.at.carrier === carrierId) out.push(c);
    return out.sort((a, b) => a.at.tier - b.at.tier || a.at.row - b.at.row || a.at.bay - b.at.bay);
  }

  /** @returns {Container | null} the container covering that cell */
  at(carrierId, row, bay, tier) {
    const id = this._cells.get(carrierId)?.get(cellKey(row, bay, tier));
    return id == null ? null : this.containers.get(id) ?? null;
  }

  /** Lowest free tier of a stack (the number of containers stored in it). */
  top(carrierId, row, bay) {
    let t = 0;
    while (this.at(carrierId, row, bay, t)) t++;
    return t;
  }

  /**
   * Can `container` be placed at `ref`? Checked as if it were lifted first (its own cells count as
   * free). The rules and their reasons, in this order: the place is known; it takes the size; the
   * bay, row and tier exist; the cells are free and not reserved by another move; a container
   * above tier 0 stands on one container of the same span; it is not where the container already
   * is. A container with a move counts as gone for rule 7 ("Nothing to stand on"): nothing is
   * stacked on what is about to be lifted.
   * @param {Container | string} container the container or its id
   * @param {import("./types.js").SlotRef} ref
   * @returns {string | null} the reason, or null
   */
  canPlace(container, ref) {
    const at = slotOf(ref);
    const carrier = at ? this.carriers.get(at.carrier) : null;
    if (!carrier) return `Unknown place "${ref?.carrier}"`;
    const box = this._resolve(container);
    if (!box) return container == null ? "No container" : `Unknown container "${container}"`;
    const slot = this._slotProblem(carrier, box.size, at);
    if (slot) return slot;
    const { row, bay, tier } = at, n = box.bays;
    for (let k = 0; k < n; k++) {
      const occupant = this.at(carrier.id, row, bay + k, tier);
      if (occupant && occupant !== box) return `Occupied by ${occupant.id}`;
      const moveId = this.reservedBy(carrier.id, row, bay + k, tier);
      if (moveId != null && moveId !== box.move) return `Reserved for move ${moveId}`;
    }
    if (tier > 0) {
      const below = [];
      for (let k = 0; k < n; k++) {
        const c = this.at(carrier.id, row, bay + k, tier - 1);
        below.push(c === box ? null : c);
      }
      if (below.every((c) => !c)) return "Nothing to stand on";
      const first = below[0];
      if (!first || below.some((c) => c !== first) || first.at.bay !== bay || first.bays !== n) return `A ${box.size} ft container needs a ${n === 1 ? "20" : "40/45"} ft container below`;
      if (first.move != null) return "Nothing to stand on";
    }
    const cur = box.at;
    if (cur && cur.carrier === at.carrier && cur.bay === bay && (cur.row ?? 0) === row && (cur.tier ?? 0) === tier) return "Already there";
    return null;
  }

  /**
   * Can `container` be lifted now? It must be stored, have no move, and nothing may be stored or
   * reserved on top of it.
   * @param {Container | string} container the container or its id
   * @returns {string | null} the reason, or null
   */
  canLift(container) {
    const box = this._resolve(container);
    if (!box) return container == null ? "No container" : `Unknown container "${container}"`;
    if (!box.at || this.get(box.id) !== box) return `${box.id} is not on a carrier`;
    if (box.move != null) return `${box.id} is already being moved (${box.move})`;
    return this._blockedAbove(box);
  }

  /**
   * All slots where `container` can be placed on a carrier, ordered by tier, bay, row ascending.
   * @param {Container | string} container the container or its id
   * @param {string} carrierId
   * @returns {import("./types.js").SlotRef[]}
   */
  freeSlots(container, carrierId) {
    const carrier = this.carriers.get(carrierId), box = this._resolve(container);
    if (!carrier || !box) return [];
    const out = [], bays = carrier.firstBays(box.size);
    for (let tier = 0; tier < carrier.tiers; tier++) {
      for (const bay of bays) {
        for (let row = 0; row < carrier.rows; row++) {
          const ref = { carrier: carrierId, bay, row, tier };
          if (!this.canPlace(box, ref)) out.push(ref);
        }
      }
    }
    return out;
  }

  /**
   * Reserve the cells of a slot for a move (a move holds one reservation; reserving again moves it).
   * Callers check `canPlace` first; a cell reserved by another move is never taken over.
   * @param {import("./types.js").SlotRef} ref
   * @param {"20"|"40"|"45"} size size of the container that will be set down there
   * @param {string} moveId
   * @returns {string | null} the reason if nothing was reserved (the move keeps its old reservation)
   */
  reserve(ref, size, moveId) {
    const at = slotOf(ref);
    if (!at) return "No place";
    if (moveId == null) return "No move";
    for (let k = 0; k < baysOf(size); k++) {
      const other = this.reservedBy(at.carrier, at.row, at.bay + k, at.tier);
      if (other != null && other !== moveId) return `Reserved for move ${other}`;
    }
    this.release(moveId);
    let cells = this._reserved.get(at.carrier);
    if (!cells) this._reserved.set(at.carrier, (cells = new Map()));
    const keys = [];
    for (let k = 0; k < baysOf(size); k++) {
      const key = cellKey(at.row, at.bay + k, at.tier);
      cells.set(key, moveId);
      keys.push(key);
    }
    this._reservations.set(moveId, { at, size: String(size), keys });
    return null;
  }

  /** Release the reservation of a move (nothing happens if it has none). */
  release(moveId) {
    const r = this._reservations.get(moveId);
    if (!r) return;
    const cells = this._reserved.get(r.at.carrier);
    if (cells) {
      for (const key of r.keys) if (cells.get(key) === moveId) cells.delete(key);
      if (!cells.size) this._reserved.delete(r.at.carrier);
    }
    this._reservations.delete(moveId);
  }

  /** @returns {string | null} id of the move that reserved this cell */
  reservedBy(carrierId, row, bay, tier) {
    return this._reserved.get(carrierId)?.get(cellKey(row, bay, tier)) ?? null;
  }

  /**
   * A handler takes a container off its carrier: its cells become free, `handler` is set.
   * @returns {string | null} the reason if it is not stored, or something stands or is reserved on it
   *   (nothing changes then)
   */
  detach(containerId, handlerId) {
    const c = this.get(containerId);
    if (!c) return `Unknown container "${containerId}"`;
    if (!c.at) return `${c.id} is not on a carrier`;
    const blocked = this._blockedAbove(c);
    if (blocked) return blocked;
    this._vacate(c);
    c.at = null;
    c.handler = handlerId ?? null;
    return null;
  }

  /**
   * A handler sets a container down at `ref` (as `canPlace`; the reservation of its move stays
   * until the move releases it). A stored container is moved there directly if nothing stands or
   * is reserved on it.
   * @returns {string | null} the reason on failure (nothing changes then)
   */
  attach(containerId, ref) {
    const c = this.get(containerId);
    if (!c) return `Unknown container "${containerId}"`;
    const reason = this.canPlace(c, ref);
    if (reason) return reason;
    const blocked = c.at ? this._blockedAbove(c) : null;
    if (blocked) return blocked;
    this._vacate(c);
    c.handler = null;
    this._occupy(c, slotOf(ref));
    return null;
  }

  /** Height (m) of the containers under a slot (0 at tier 0). */
  heightBelow(ref) {
    const at = slotOf(ref);
    if (!at) return 0;
    let h = 0;
    for (let t = 0; t < at.tier; t++) h += this.at(at.carrier, at.row, at.bay, t)?.height_m ?? 0;
    return h;
  }

  /** TEU stored on a carrier. */
  usedTeu(carrierId) {
    return this.on(carrierId).reduce((s, c) => s + c.teu, 0);
  }

  /** TEU a carrier can take: bays × rows × tiers. */
  capacityTeu(carrierId) {
    const c = this.carriers.get(carrierId);
    return c ? c.bays * c.rows * c.tiers : 0;
  }

  /**
   * Invariant violations (empty = fine): containers neither stored nor carried (or both), slots
   * that do not exist, cells and containers that disagree, containers without a stack below them,
   * and reservations that disagree with their cells, are occupied by another container or have
   * nothing to stand on.
   * @returns {string[]}
   */
  check() {
    const problems = [];
    for (const [id, c] of this.containers) {
      if (c.id !== id) problems.push(`${id}: listed under a different id (${c.id})`);
      if (c.at && c.handler != null) problems.push(`${id}: on ${c.at.carrier} and on handler ${c.handler} at the same time`);
      if (!c.at && c.handler == null) problems.push(`${id}: neither on a carrier nor on a handler`);
      if (!c.at) continue;
      const at = slotOf(c.at), carrier = this.carriers.get(at.carrier);
      if (!carrier) {
        problems.push(`${id}: on an unknown carrier "${at.carrier}"`);
        continue;
      }
      const slot = this._slotProblem(carrier, c.size, at);
      if (slot) problems.push(`${id} at ${where(at)}: ${slot}`);
      for (let k = 0; k < c.bays; k++) {
        const held = this._cells.get(at.carrier)?.get(cellKey(at.row, at.bay + k, at.tier));
        if (held !== c.id) problems.push(`${id}: its cell ${where({ ...at, bay: at.bay + k })} holds ${held ?? "nothing"}`);
      }
      const support = this._supportProblem(at, c.bays, c);
      if (support) problems.push(`${id} at ${where(at)}: ${support}`);
      const base = !support && at.tier > 0 ? this.at(at.carrier, at.row, at.bay, at.tier - 1) : null;
      if (base && base.move != null && base.move !== c.move) problems.push(`${id} at ${where(at)}: stands on ${base.id}, which is being moved (${base.move})`);
    }
    for (const [carrierId, cells] of this._cells) {
      if (cells.size && !this.carriers.has(carrierId)) problems.push(`cells of an unknown carrier "${carrierId}"`);
      for (const [key, id] of cells) {
        const [tier, row, bay] = key.split(":").map(Number), cell = where({ carrier: carrierId, bay, row, tier });
        const c = this.containers.get(id);
        if (!c) problems.push(`${cell}: holds ${id}, which is not in the terminal`);
        else if (!c.at || c.at.carrier !== carrierId || (c.at.row ?? 0) !== row || (c.at.tier ?? 0) !== tier || bay < c.at.bay || bay >= c.at.bay + c.bays) {
          problems.push(`${cell}: holds ${id}, which is ${c.at ? `at ${where(slotOf(c.at))}` : "not stored"}`);
        }
      }
    }
    for (const [moveId, r] of this._reservations) {
      const carrier = this.carriers.get(r.at.carrier);
      if (!carrier) {
        problems.push(`move ${moveId}: reserves a place on an unknown carrier "${r.at.carrier}"`);
        continue;
      }
      const slot = this._slotProblem(carrier, r.size, r.at);
      if (slot) problems.push(`move ${moveId}: reserves ${where(r.at)}: ${slot}`);
      for (const key of r.keys) {
        if (this._reserved.get(r.at.carrier)?.get(key) !== moveId) problems.push(`move ${moveId}: its reserved cell ${r.at.carrier} ${key} is not marked`);
        const held = this._cells.get(r.at.carrier)?.get(key);
        if (held != null && this.containers.get(held)?.move !== moveId) problems.push(`move ${moveId}: its reserved place ${where(r.at)} holds ${held}`);
      }
      const holder = r.keys.map((key) => this._cells.get(r.at.carrier)?.get(key)).find((id) => id != null);
      const support = holder == null ? this._supportProblem(r.at, baysOf(r.size), null) : null;
      if (support) problems.push(`move ${moveId}: its reserved place ${where(r.at)}: ${support}`);
      const base = holder == null && !support && r.at.tier > 0 ? this.at(r.at.carrier, r.at.row, r.at.bay, r.at.tier - 1) : null;
      if (base && base.move != null && base.move !== moveId) problems.push(`move ${moveId}: its reserved place ${where(r.at)} stands on ${base.id}, which is being moved (${base.move})`);
    }
    for (const [carrierId, cells] of this._reserved) {
      for (const [key, moveId] of cells) {
        const r = this._reservations.get(moveId);
        if (!r || r.at.carrier !== carrierId || !r.keys.includes(key)) problems.push(`${carrierId} ${key}: marked as reserved for move ${moveId}, which has no such reservation`);
      }
    }
    return problems;
  }

  /**
   * Stored containers as layout file entries: `[{...container.toJSON(), at}]`, lower tiers first and
   * inventory order within each tier, so every entry follows the container it stands on and the
   * snapshot adds back in file order.
   * @returns {object[]}
   */
  snapshot() {
    const out = [];
    for (const c of this.containers.values()) {
      if (!c.at) continue;
      const at = slotOf(c.at);
      out.push({ ...c.toJSON(), at: { carrier: at.carrier, bay: at.bay, row: at.row, tier: at.tier } });
    }
    return out.sort((a, b) => a.at.tier - b.at.tier); // Array.prototype.sort is stable
  }

  /* ---------------------------------------------------------------- internals */

  /** The container (an id is looked up). */
  _resolve(container) {
    return typeof container === "string" ? this.get(container) : container || null;
  }

  /** Rules 2-5 of `canPlace`: the carrier takes the size and has this bay, row and tier. */
  _slotProblem(carrier, size, at) {
    if (!carrier.allows(size)) return `${carrier.type?.label ?? carrier.label} takes no ${size} ft containers`;
    const { bay, row, tier } = at;
    const bayOk = baysOf(size) === 1 ? Number.isInteger(bay) && bay >= 0 && bay < carrier.bays : carrier.firstBays(size).includes(bay);
    if (!bayOk) return `No ${size} ft position at bay ${bay + 1}`;
    if (!(Number.isInteger(row) && row >= 0 && row < carrier.rows)) return `No row ${row + 1}`;
    if (!(Number.isInteger(tier) && tier >= 0 && tier < carrier.tiers)) return `Stacks here are at most ${carrier.tiers} high`;
    return null;
  }

  /** Is a slot of `n` bays held up by one stored container of the same span (`self` does not count)? */
  _supportProblem(at, n, self) {
    if (!(at.tier > 0)) return null;
    const below = [];
    for (let k = 0; k < n; k++) {
      const c = this.at(at.carrier, at.row, at.bay + k, at.tier - 1);
      below.push(c === self ? null : c);
    }
    if (below.every((c) => !c)) return "nothing to stand on";
    const first = below[0];
    if (!first || below.some((c) => c !== first) || first.at?.bay !== at.bay || first.bays !== n) return `stands on ${[...new Set(below.map((c) => c?.id ?? "nothing"))].join(" and ")}`;
    return null;
  }

  /**
   * Why the stored container `c` cannot leave its slot: a container stored on top of it, or a move
   * that reserved a place on top of it (null = nothing above).
   */
  _blockedAbove(c) {
    const { carrier, row, bay, tier } = slotOf(c.at);
    for (let k = 0; k < c.bays; k++) {
      const above = this.at(carrier, row, bay + k, tier + 1);
      if (above) return `Blocked by ${above.id} on top: move that first`;
    }
    for (let k = 0; k < c.bays; k++) {
      const moveId = this.reservedBy(carrier, row, bay + k, tier + 1);
      if (moveId != null) return `Blocked by move ${moveId}, which sets a container on top: wait for it`;
    }
    return null;
  }

  /** Store a container at a (normalized) slot. */
  _occupy(c, at) {
    c.at = { carrier: at.carrier, bay: at.bay, row: at.row, tier: at.tier };
    let cells = this._cells.get(at.carrier);
    if (!cells) this._cells.set(at.carrier, (cells = new Map()));
    for (let k = 0; k < c.bays; k++) cells.set(cellKey(at.row, at.bay + k, at.tier), c.id);
  }

  /** Free the cells of a stored container. */
  _vacate(c) {
    if (!c.at) return;
    const at = slotOf(c.at), cells = this._cells.get(at.carrier);
    if (!cells) return;
    for (let k = 0; k < c.bays; k++) {
      const key = cellKey(at.row, at.bay + k, at.tier);
      if (cells.get(key) === c.id) cells.delete(key);
    }
    if (!cells.size) this._cells.delete(at.carrier);
  }
}
