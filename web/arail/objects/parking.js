/**
 * Parking: what it costs (`Tariff`), who may park where (`parkingTerms`), parking lots, parking
 * garages above or below ground, and bike stands.
 *
 * Everything that offers parking says so with `parkingInfo()`: a list of facilities, each
 * `{id, owner, kind, label, spaces, spots, tariff, access, for, entry, exit}` (see core/parking.js,
 * which keeps track of the cars parked there). Streets offer it along their parking strips
 * (objects/road.js), supermarkets on their own lot (objects/houses.js), and the objects here.
 *
 * - A **tariff** is chosen by hand: free, by the hour, by the day, by the week, or a yearly permit
 *   (residents' parking, Bewohnerparken). Prices are in euros; empty means a usual price.
 * - **Access**: public (everybody pays the tariff), residents (only with a permit: people living
 *   nearby), customers or employees of the building the facility belongs to (`owner`). Parking at a
 *   supermarket is always free for its customers, parking at a production site (a factory) always
 *   free for its employees; nobody else may park there.
 * - **Bikes** are locked to bike stands (two per stand, Anlehnbügel) or to street lamps (objects/road.js).
 * @module arail/objects/parking
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoint } from "../core/anchors.js";
import { toRad } from "../core/math.js";
import { PALETTE, grey } from "../core/colors.js";
import { BuildingBase, TONES, axes, parapetRoof } from "./building-kit.js";
import { drawSign } from "./signs.js";

/**
 * How parking is paid, with a usual price (€) in German towns: label, unit, minutes per unit, the
 * price in garages and lots and on the street. In 2025 most towns charged at most 1 € an hour on
 * the street (up to about 3.35 €), garages about 2 € an hour and up to 24 € a day, a residents'
 * permit 10.20 € to 360 € a year (Bonn 120 € from 2026).
 */
export const TARIFFS = {
  free: { label: "free", unit: null, minutes: 0, price: 0, street: 0 },
  hourly: { label: "by the hour", unit: "hour", minutes: 60, price: 2.0, street: 1.0 },
  daily: { label: "by the day", unit: "day", minutes: 1440, price: 15, street: 8 },
  weekly: { label: "by the week", unit: "week", minutes: 10080, price: 25, street: 20 },
  yearly: { label: "yearly permit (residents)", unit: "year", minutes: 525600, price: 120, street: 120 },
};

/** Who may park: everybody, residents with a permit, customers or employees of the owner. */
export const PARKING_ACCESS = {
  auto: { label: "by its owner (supermarket: customers, factory: employees, else everybody)" },
  public: { label: "everybody" },
  residents: { label: "residents with a permit" },
  customers: { label: "customers of the owner (free)" },
  employees: { label: "employees of the owner (free)" },
};

/** What parking costs. */
export class Tariff {
  /**
   * @param {{kind?: string, price_eur?: number, street?: boolean}} [o] kind: a key of TARIFFS; price:
   *   per unit (empty: the usual price, on the street or in a garage)
   */
  constructor({ kind = "free", price_eur, street = false } = {}) {
    this.kind = TARIFFS[kind] ? kind : "free";
    const T = TARIFFS[this.kind];
    this.price = this.kind === "free" ? 0 : Number(price_eur) >= 0 && price_eur !== "" && price_eur != null ? Number(price_eur) : street ? T.street : T.price;
  }

  /** The fee (€) for a stay of `minutes`: started hours, days or weeks; a yearly permit costs nothing per stay. */
  fee(minutes) {
    const T = TARIFFS[this.kind];
    if (!T.unit || this.kind === "yearly") return 0;
    return Math.max(1, Math.ceil(Math.max(0, minutes) / T.minutes)) * this.price;
  }

  /** "free", "2 € per hour", "120 € per year (permit)". */
  label() {
    const T = TARIFFS[this.kind];
    if (!T.unit) return "free";
    const price = Number.isInteger(this.price) ? String(this.price) : this.price.toFixed(2);
    return this.kind === "yearly" ? `${price} € per year (permit)` : `${price} € per ${T.unit}`;
  }
}

/** Is an object a supermarket (customers park free) or a production site (employees park free)? */
export function ownerAccess(owner) {
  if (!owner) return "public";
  if (owner.type === "supermarket") return "customers";
  if (owner.type === "factory") return "employees";
  const use = typeof owner.use === "function" ? owner.use() : owner.constructor?.use;
  return use === "residential" ? "residents" : "public";
}

/**
 * May a driver park at a facility, and what does it cost? Supermarkets are free for their
 * customers and factories for their employees (whatever the tariff); residents' parking needs a
 * permit (the driver lives nearby: `driver.permits` holds the facility, or its owner is the
 * driver's home).
 * @param {{access: string, for?: string | null, tariff: Tariff, id: string}} facility
 * @param {{purpose?: string, destId?: string | null, home?: string | null, resident?: boolean, permits?: Set<string>}} driver
 * @returns {{allowed: boolean, free: boolean, fee: (minutes: number) => number, why: string}}
 */
export function parkingTerms(facility, driver = {}) {
  const ownFor = (purpose) => driver.purpose === purpose && driver.destId && driver.destId === facility.for;
  const free = { allowed: true, free: true, fee: () => 0 };
  const no = (why) => ({ allowed: false, free: false, fee: () => Infinity, why });
  switch (facility.access) {
    case "customers": return ownFor("shopping") ? { ...free, why: "free for customers" } : no("for customers only");
    case "employees": return ownFor("work") ? { ...free, why: "free for employees" } : no("for employees only");
    case "residents": {
      // a permit: given for this facility, the house the facility belongs to, or (residents' parking in a street) a resident nearby
      const ok = driver.permits?.has?.(facility.id) || (facility.for && driver.home === facility.for) || (driver.resident && !facility.for);
      return ok ? { ...free, why: "with a residents' permit" } : no("for residents with a permit only");
    }
    default: {
      const t = facility.tariff;
      return { allowed: true, free: t.kind === "free", fee: (m) => t.fee(m), why: t.label() };
    }
  }
}

const TARIFF_PARAMS = [
  { key: "tariff", label: "Parking costs", type: "select", options: Object.entries(TARIFFS).map(([k, v]) => [k, v.label]), default: "free" },
  { key: "price_eur", label: "Price", type: "number", unit: "€", min: 0, max: 2000, step: 0.1, when: (v) => v.tariff && v.tariff !== "free", help: "Per hour, day, week or year, as chosen. Empty = a usual price (2 € an hour, 15 € a day, 25 € a week, 120 € a year)." },
];
const ACCESS_PARAMS = [
  { key: "owner", label: "Belongs to", type: "object", help: "A building: a supermarket's lot is free for its customers, a factory's for its employees, a house's for its residents." },
  { key: "access", label: "Who may park", type: "select", options: Object.entries(PARKING_ACCESS).map(([k, v]) => [k, v.label]), default: "auto" },
];

/** Stalls of a lot (EAR 23): depth of a row, length along it, aisle between two rows (m). */
const STALLS = {
  perpendicular: { depth: 5.2, length: 2.65, aisle: 6.0 },
  angled: { depth: 4.35, length: 3.75, aisle: 3.5 },
  parallel: { depth: 2.0, length: 5.7, aisle: 3.5 },
};

/** Common parts of lots and garages: the owner, the access, the tariff and the facility record. */
function facilityOf(o, { kind, spaces, spots, entry, exit, label }) {
  const owner = o.spec.owner ? o.world.getObject(o.spec.owner) : null;
  const access = o.spec.access && o.spec.access !== "auto" ? o.spec.access : ownerAccess(owner);
  return {
    id: o.id, owner: o, kind, label: label ?? o.name, spaces, spots, tariff: new Tariff({ kind: o.spec.tariff, price_eur: o.spec.price_eur }),
    access, for: owner?.id ?? null, entry, exit,
  };
}

/** The card rows of a facility: spaces, who may park, what it costs. */
function facilityRows(f) {
  const rows = [["Spaces", f.spaces]];
  rows.push(["Who may park", PARKING_ACCESS[f.access]?.label ?? f.access]);
  rows.push(["Parking costs", f.access === "customers" || f.access === "employees" ? "free" : f.tariff.label()]);
  return rows;
}

/** Override of BuildingBase's card: a facility's own rows instead of floors and residents. */
function facilityCard(o, f) {
  const card = LayoutObject.prototype.card.call(o);
  card.rows.push(...facilityRows(f));
  const used = o.world.parking?.occupied?.(f.id);
  if (used != null) card.rows.push(["Taken now", `${used} of ${f.spaces}`]);
  return card;
}

export class ParkingLot extends BuildingBase {
  static type = "parking-lot";
  static label = "Parking lot";
  static category = "Transport";
  static use = "other";
  static description = "A parking lot (Parkplatz) beside a street: rows of spaces with aisles. Free or with a tariff; a supermarket's lot is free for its customers, a factory's for its employees.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0, help: "The front (the way in) faces the street." },
    { key: "width_m", label: "Width", type: "number", unit: "m", min: 8, max: 200, step: 1, default: 30 },
    { key: "depth_m", label: "Depth", type: "number", unit: "m", min: 6, max: 120, step: 1, default: 17 },
    { key: "layout", label: "Spaces", type: "select", options: [["perpendicular", "perpendicular (2.65 × 5.20 m)"], ["angled", "angled (45°)"], ["parallel", "parallel"]], default: "perpendicular" },
    ...ACCESS_PARAMS,
    ...TARIFF_PARAMS,
  ];

  computeGeometry() {
    const m = this.model();
    if (!m) return null;
    const w = clampNum(this.spec.width_m, 30, 8, 200), d = clampNum(this.spec.depth_m, 17, 6, 120);
    const S = STALLS[this.spec.layout] || STALLS.perpendicular;
    const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
    m.setAnchor(0, 0, 1, Math.hypot(w, d) / 2 + 2);
    m.plate(m.rect(x0, y0, x1, y1), { fill: grey(TONES.asphalt), alpha: 0.88, order: 2 });
    // rows of stalls from the back, an aisle in front of each pair of rows
    const rows = [];
    let y = y1;
    while (y - S.depth >= y0 + S.aisle - 1e-6) {
      rows.push({ y0: y - S.depth, y1: y, facing: 1 });
      y -= S.depth + S.aisle;
      if (y - S.depth < y0 - 1e-6) break;
      rows.push({ y0: y - S.depth, y1: y, facing: -1 });
      y -= S.depth;
    }
    const n = Math.max(0, Math.floor((w - 1) / S.length));
    const spots = [], mark = { stroke: grey(TONES.marking), width: 1, order: 2.2 };
    for (const r of rows) {
      const sx0 = -(n * S.length) / 2;
      for (let i = 0; i <= n; i++) m.line([[sx0 + i * S.length, r.y0], [sx0 + i * S.length, r.y1]], mark);
      for (let i = 0; i < n; i++) {
        const c = [sx0 + (i + 0.5) * S.length, (r.y0 + r.y1) / 2];
        const dir = this.spec.layout === "parallel" ? m.frame.dir(1, 0) : m.frame.dir(0, r.facing);
        spots.push({ pos: m.frame.xy(c[0], c[1]), dir: unit(dir) });
      }
    }
    m.entrance(0, y0);
    const g = m.finish({ footprint: m.rect(x0, y0, x1, y1), height: 0.2, capacity: {} });
    g.spots = spots;
    g.entry = m.frame.xy(0, y0 - 1);
    g.sign = m.frame.xy(x0 + 1, y0 + 0.5);
    return g;
  }

  /** The lot as a facility of core/parking.js. */
  parkingInfo() {
    const g = this.geometry;
    if (!g) return [];
    return [facilityOf(this, { kind: "lot", spaces: g.spots.length, spots: g.spots, entry: g.entry, exit: g.entrances[0]?.pos ?? g.entry })];
  }

  card() {
    const f = this.parkingInfo()[0];
    return f ? facilityCard(this, f) : LayoutObject.prototype.card.call(this);
  }

  draw(view) {
    super.draw(view);
    const g = this.geometry;
    drawSign(view, g.sign, "parking");
  }
}

export class ParkingGarage extends BuildingBase {
  static type = "parking-garage";
  static label = "Parking garage";
  static category = "Transport";
  static use = "other";
  static description = "A parking garage: a multi-storey car park (Parkhaus) or an underground one (Tiefgarage) under a building, of which only the ramp and the stairs are seen. Usually paid by the hour, the day or the week; an underground garage of a house is for its residents.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "kind", label: "Kind", type: "select", options: [["multi-storey", "multi-storey (Parkhaus)"], ["underground", "underground (Tiefgarage)"]], default: "multi-storey" },
    { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0, help: "The front (the way in) faces the street." },
    { key: "width_m", label: "Width", type: "number", unit: "m", min: 10, max: 150, step: 1, default: 32 },
    { key: "depth_m", label: "Depth", type: "number", unit: "m", min: 10, max: 150, step: 1, default: 32 },
    { key: "levels", label: "Levels", type: "number", min: 1, max: 12, step: 1, default: 4 },
    { key: "spaces", label: "Spaces", type: "number", min: 1, max: 5000, step: 1, help: "Empty = by its size: a space per 25 m² of each level (EAR 05)." },
    ...ACCESS_PARAMS,
    { ...TARIFF_PARAMS[0], default: "hourly" },
    TARIFF_PARAMS[1],
  ];

  floorsCount() {
    return clampNum(this.spec.levels, 4, 1, 12);
  }

  computeGeometry() {
    const m = this.model();
    if (!m) return null;
    const w = clampNum(this.spec.width_m, 32, 10, 150), d = clampNum(this.spec.depth_m, 32, 10, 150), levels = this.floorsCount();
    const under = this.spec.kind === "underground";
    const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
    const spaces = Number(this.spec.spaces) > 0 ? Math.round(+this.spec.spaces) : Math.max(1, Math.floor((w * d * levels) / 25));
    let g;
    if (under) {
      // the ramp down (between low walls) and a stair housing; the garage lies under the house
      const rw = 3.5, rl = 16, rx = x0 + rw / 2 + 1;
      m.setAnchor(rx, y0 + rl / 2, 1, rl);
      m.plate(m.rect(rx - rw / 2, y0, rx + rw / 2, y0 + rl), { fill: grey(0.46), alpha: 0.95, order: 2 });
      for (const sx of [-1, 1]) m.part(m.box(rx + sx * (rw / 2 + 0.1) - 0.1, y0 + 2, rx + sx * (rw / 2 + 0.1) + 0.1, y0 + rl, 0, 0.9, { wall: grey(0.86), top: grey(0.8) }).faces);
      const sx = x1 - 3;
      const stairs = m.box(sx - 2, y0, sx + 2, y0 + 3, 0, 2.6, { wall: grey(TONES.glass), top: grey(0.84) });
      m.part(stairs.faces);
      m.entrance(sx, y0);
      g = m.finish({ footprint: m.rect(x0, y0, x1, y0 + rl), height: 2.6, capacity: {} });
      g.entry = m.frame.xy(rx, y0 - 1);
      g.sign = m.frame.xy(rx + rw / 2 + 0.6, y0 + 0.3);
    } else {
      const H = levels * 2.9;
      m.setAnchor(0, 0, H / 2, Math.hypot(w, d) / 2 + 2);
      const body = m.box(x0, y0, x1, y1, 0, H, { wall: grey(0.84) });
      // open levels: a dark opening and a white parapet on each level
      for (const f of body.walls) {
        if (!f) continue;
        for (let k = 0; k < levels; k++) {
          m.decal(f, 0.3, f.length - 0.3, k * 2.9 + 1.1, k * 2.9 + 2.6, grey(0.5));
          for (const a of axes(f.length, 7.5, 0.5)) m.decal(f, a - 0.2, a + 0.2, k * 2.9 + 1.1, k * 2.9 + 2.6, grey(0.8));
        }
      }
      const roof = parapetRoof(m, { x0, y0, x1, y1, z: H, parapet: 1.1, roof: grey(0.8), surface: grey(0.6) });
      m.part([...body.faces, roof]);
      m.shadow(m.rect(x0, y0, x1, y1), H);
      m.entrance(x1 - 3, y0);
      g = m.finish({ footprint: m.rect(x0, y0, x1, y1), height: H + 1.1, capacity: {}, detail: { window: 1.4 } });
      g.entry = m.frame.xy(x0 + 4, y0 - 1);
      g.sign = m.frame.xy(x0 + 1, y0 - 0.5);
    }
    g.spaces = spaces;
    return g;
  }

  /** The garage as a facility of core/parking.js (its spaces are inside: no spots to draw). */
  parkingInfo() {
    const g = this.geometry;
    if (!g) return [];
    return [facilityOf(this, { kind: this.spec.kind === "underground" ? "underground" : "garage", spaces: g.spaces, spots: [], entry: g.entry, exit: g.entrances[0]?.pos ?? g.entry })];
  }

  card() {
    const f = this.parkingInfo()[0];
    const card = f ? facilityCard(this, f) : LayoutObject.prototype.card.call(this);
    card.rows.unshift(["Kind", this.spec.kind === "underground" ? "underground garage" : `multi-storey, ${this.floorsCount()} levels`]);
    return card;
  }

  draw(view) {
    super.draw(view);
    drawSign(view, this.geometry.sign, "parking");
  }
}

export class BikeStand extends LayoutObject {
  static type = "bike-stand";
  static label = "Bike stands";
  static category = "Transport";
  static placement = "point";
  static description = "A row of bike stands (Anlehnbügel) on a sidewalk: two bikes are locked to each. Bikes are also locked to street lamps, two at most.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0, help: "Along the row." },
    { key: "stands", label: "Stands", type: "number", min: 1, max: 60, step: 1, default: 5, help: "Two bikes each; 1.2 m apart." },
  ];

  computeGeometry() {
    const c = resolvePoint(this.world.map, this.spec.position);
    if (!c) return null;
    const a = toRad(+this.spec.rotation_deg || 0), u = [Math.cos(a), Math.sin(a)], n = [-u[1], u[0]];
    const count = clampNum(this.spec.stands, 5, 1, 60), gap = this.mm(1.2);
    const stands = [];
    for (let i = 0; i < count; i++) {
      const t = (i - (count - 1) / 2) * gap;
      stands.push([c[0] + u[0] * t, c[1] + u[1] * t]);
    }
    const half = (count * gap) / 2, r = this.mm(1.2);
    const footprint = [[-half, -r], [half, -r], [half, r], [-half, r]].map(([x, y]) => [c[0] + u[0] * x + n[0] * y, c[1] + u[1] * x + n[1] * y]);
    return { center: c, u, n, stands, footprint };
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  /** Two bikes per stand, one on each side of it. */
  bikeParking() {
    const g = this.geometry;
    if (!g) return [];
    return g.stands.map((p) => ({ pos: p, dir: g.n, capacity: 2, kind: "stand" }));
  }

  draw(view) {
    const g = this.geometry, z = view.m(0.85), w = view.m(0.35);
    if (view.pxPerMM(g.center[0], g.center[1], 0) * this.mm(1) < 0.6) return;
    for (const p of g.stands) {
      const a = [p[0] - g.n[0] * w, p[1] - g.n[1] * w], b = [p[0] + g.n[0] * w, p[1] + g.n[1] * w];
      view.faces([{ pts: [[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], z], [a[0], a[1], z]], color: PALETTE.steel, twoSided: true, alpha: 0.9 }], [p[0], p[1], z / 2]);
    }
  }
}

function clampNum(v, fallback, lo, hi) {
  const n = Number(v);
  return Math.min(hi, Math.max(lo, Number.isFinite(n) && n > 0 ? n : fallback));
}

function unit(d) {
  const l = Math.hypot(d[0], d[1]) || 1;
  return [d[0] / l, d[1] / l];
}
