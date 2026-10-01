/**
 * Container terminal: containers, carriers (wagons, trucks, barges, yard blocks) and the
 * inventory of who stands where, with the stacking rules.
 *
 * Carrier-local coordinates are prototype metres: `along` + towards the front (A end), `across`
 * + to the left. Bays are 20 ft positions along the carrier, rows lie across it, tiers count
 * from the bottom; a 40 or 45 ft container covers two bays and is referred to by its first bay.
 *
 * The constants and the BIC (ISO 6346) helpers are final; `Container`, `Carrier` and `Inventory`
 * are placeholders with the final interface until the terminal model is implemented.
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

const NOT_IMPLEMENTED = "The terminal is not implemented yet";

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
    return 0;
  }

  /** Number of rows. */
  get rows() {
    return 0;
  }

  /** Highest stack. */
  get tiers() {
    return 0;
  }

  /** Does it take containers of this size? */
  allows(size) {
    return false;
  }

  /**
   * Allowed first bays for a container size.
   * @returns {number[]}
   */
  firstBays(size) {
    return [];
  }

  /** Carrier-local position (m) along it of a bay; for 2-bay sizes the midpoint of bays `bay` and `bay + 1`. */
  along(bay, size) {
    return 0;
  }

  /** Carrier-local position (m) across it of a row. */
  across(row) {
    return 0;
  }

  /**
   * Layout point (mm) of a carrier-local position.
   * @returns {number[] | null} null while the pose is unknown
   */
  toLayout(along_m, across_m, scale) {
    return null;
  }

  /**
   * Outline (layout mm, counter-clockwise): its length × width around the pose.
   * @returns {number[][] | null}
   */
  footprint(scale) {
    return null;
  }
}

/**
 * Where all containers are: carriers by id, containers by id, reservations of queued moves.
 * Every method that refuses returns the reason as a sentence (null = fine).
 */
export class Inventory {
  constructor() {
    /** @type {Map<string, Carrier>} */
    this.carriers = new Map();
    /** @type {Map<string, Container>} */
    this.containers = new Map();
  }

  /** @returns {Carrier} */
  addCarrier(carrier) {
    this.carriers.set(carrier.id, carrier);
    return carrier;
  }

  /**
   * Remove a carrier; the containers on it are removed too.
   * @returns {Container[]} the removed containers
   */
  removeCarrier(id) {
    this.carriers.delete(id);
    return [];
  }

  /**
   * Initial placement of a container (as `canPlace`).
   * @param {Container} container
   * @param {import("./types.js").SlotRef} ref
   * @returns {string | null} the reason on failure
   */
  add(container, ref) {
    return NOT_IMPLEMENTED;
  }

  /**
   * A container leaves the terminal.
   * @returns {Container | null}
   */
  remove(containerId) {
    return null;
  }

  /** @returns {Container | null} */
  get(id) {
    return null;
  }

  /**
   * Containers stored on a carrier, sorted by tier, row, bay.
   * @returns {Container[]}
   */
  on(carrierId) {
    return [];
  }

  /** @returns {Container | null} the container covering that cell */
  at(carrierId, row, bay, tier) {
    return null;
  }

  /** Lowest free tier of a stack. */
  top(carrierId, row, bay) {
    return 0;
  }

  /**
   * Can `container` be placed at `ref`? Checked as if it were lifted first (its own cells count as free).
   * @returns {string | null} the reason, or null
   */
  canPlace(container, ref) {
    return NOT_IMPLEMENTED;
  }

  /**
   * Can `container` be lifted now?
   * @returns {string | null} the reason, or null
   */
  canLift(container) {
    return NOT_IMPLEMENTED;
  }

  /**
   * All slots where `container` can be placed on a carrier, ordered by tier, bay, row ascending.
   * @returns {import("./types.js").SlotRef[]}
   */
  freeSlots(container, carrierId) {
    return [];
  }

  /** Reserve the cells of a slot for a move. */
  reserve(ref, size, moveId) {}

  /** Release the reservation of a move. */
  release(moveId) {}

  /** @returns {string | null} id of the move that reserved this cell */
  reservedBy(carrierId, row, bay, tier) {
    return null;
  }

  /** A handler takes a container off its carrier. */
  detach(containerId, handlerId) {}

  /** A handler sets a container down at `ref`. */
  attach(containerId, ref) {}

  /** Height (m) of the containers under a slot (0 at tier 0). */
  heightBelow(ref) {
    return 0;
  }

  /** TEU stored on a carrier. */
  usedTeu(carrierId) {
    return 0;
  }

  /** TEU a carrier can take. */
  capacityTeu(carrierId) {
    return 0;
  }

  /**
   * Invariant violations (empty = fine).
   * @returns {string[]}
   */
  check() {
    return [];
  }

  /**
   * Stored containers in inventory order, as layout file entries: `[{...container.toJSON(), at}]`.
   * @returns {object[]}
   */
  snapshot() {
    return [];
  }
}
