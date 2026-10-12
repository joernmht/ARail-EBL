/**
 * Vehicles and trains as technical objects: a catalogue of typical German and neighbouring vehicles
 * (locomotives, multiple units, coaches, freight wagons) with length, masses, axles, brake weights
 * per brake position, top speed and what they are equipped with; a consist (the vehicles of a train
 * in order) with the figures of the train: length, mass, axles, top speed, brake percentage
 * (Bremshundertstel), axle and metre loads.
 *
 * The values are typical ones, rounded, for teaching (from data sheets and published vehicle data);
 * a real vehicle's are on its data plate and in its register entry.
 * @module arail/rail/vehicles
 */

/**
 * Brake positions (Bremsstellungen) and what they are for: G slow-acting (long freight trains),
 * P passenger, R rapid, R+Mg rapid with magnetic track brake.
 */
export const BRAKE_POSITIONS = {
  G: { label: "G (goods, slow acting)" },
  P: { label: "P (passenger)" },
  R: { label: "R (rapid)" },
  "R+Mg": { label: "R+Mg (rapid, magnetic track brake)" },
};

/** Kinds of vehicles. */
export const VEHICLE_KINDS = {
  locomotive: { label: "Locomotive", traction: true },
  "multiple-unit": { label: "Multiple unit", traction: true },
  railcar: { label: "Railcar", traction: true },
  coach: { label: "Coach", traction: false },
  wagon: { label: "Freight wagon", traction: false },
};

/**
 * The catalogue. Per type: `label`, `kind`, `length_m` (over buffers), `mass_t` (empty, in
 * service), `load_t` (the most a wagon carries; 0 for others), `axles`, `vmax_kmh`, `brake_t`
 * (brake weight per brake position, t; for wagons with a load-dependent brake `brake_loaded_t`
 * too), `seats`, `power_kw`; what it is equipped with (rail/systems.js keys): `power` (the
 * systems it runs on), `pantograph_mm` (heads fitted), `train_control` (class B systems),
 * `etcs` (the highest level it can run), `radio`, `gauge_mm`, `countries` (where it is
 * authorised to run).
 */
export const VEHICLE_TYPES = {
  /* ---------------------------------------------------------------- locomotives */
  br146: {
    label: "BR 146.2 (TRAXX P160 AC2)", kind: "locomotive", length_m: 18.9, mass_t: 85, axles: 4, vmax_kmh: 160, power_kw: 5600,
    brake_t: { G: 64, P: 105, R: 105 }, power: ["ac15"], pantograph_mm: [1950], train_control: ["pzb", "pzb_lzb"], etcs: "none", radio: ["gsmr"], countries: ["DE"],
  },
  br185: {
    label: "BR 185.2 (TRAXX F140 AC2)", kind: "locomotive", length_m: 18.9, mass_t: 85, axles: 4, vmax_kmh: 140, power_kw: 5600,
    brake_t: { G: 64, P: 100, R: 100 }, power: ["ac15", "ac25"], pantograph_mm: [1950, 1450], train_control: ["pzb", "pzb_lzb", "zub"], etcs: "none", radio: ["gsmr"], countries: ["DE", "AT", "CH"],
  },
  br193: {
    label: "BR 193 (Vectron MS)", kind: "locomotive", length_m: 19, mass_t: 90, axles: 4, vmax_kmh: 200, power_kw: 6400,
    brake_t: { G: 70, P: 115, R: 135 }, power: ["ac15", "ac25", "dc3", "dc1_5"], pantograph_mm: [1950, 1450], train_control: ["pzb", "pzb_lzb", "ls", "shp", "atb"], etcs: "l2", radio: ["gsmr"], countries: ["DE", "AT", "CZ", "PL", "NL"],
  },
  cd380: {
    label: "ČD 380 (Škoda 109E)", kind: "locomotive", length_m: 20.8, mass_t: 87, axles: 4, vmax_kmh: 200, power_kw: 6400,
    brake_t: { G: 65, P: 110, R: 130 }, power: ["ac15", "ac25", "dc3"], pantograph_mm: [1950], train_control: ["ls", "pzb"], etcs: "l2", radio: ["gsmr"], countries: ["CZ", "AT", "DE"],
  },
  eu07: {
    label: "EU07 (PKP)", kind: "locomotive", length_m: 15.9, mass_t: 80, axles: 4, vmax_kmh: 125, power_kw: 2000,
    brake_t: { G: 52, P: 80 }, power: ["dc3"], pantograph_mm: [1950], train_control: ["shp"], etcs: "none", radio: ["analogue", "gsmr"], countries: ["PL"],
  },
  br218: {
    label: "BR 218 (diesel)", kind: "locomotive", length_m: 16.4, mass_t: 79, axles: 4, vmax_kmh: 140, power_kw: 1840,
    brake_t: { G: 55, P: 85, R: 85 }, power: [], pantograph_mm: [], train_control: ["pzb"], etcs: "none", radio: ["gsmr"], countries: ["DE"],
  },
  /* ---------------------------------------------------------------- multiple units and railcars */
  et442: {
    label: "ET 442 Talent 2 (4 cars)", kind: "multiple-unit", length_m: 66, mass_t: 135, axles: 10, vmax_kmh: 160, power_kw: 2880, seats: 200,
    brake_t: { R: 190, "R+Mg": 230 }, power: ["ac15"], pantograph_mm: [1950], train_control: ["pzb", "pzb_lzb"], etcs: "none", radio: ["gsmr"], countries: ["DE"],
  },
  br642: {
    label: "BR 642 Desiro Classic (diesel)", kind: "railcar", length_m: 41.7, mass_t: 69, axles: 6, vmax_kmh: 120, power_kw: 550, seats: 120,
    brake_t: { R: 95, "R+Mg": 115 }, power: [], pantograph_mm: [], train_control: ["pzb"], etcs: "none", radio: ["gsmr"], countries: ["DE", "CZ", "PL"],
  },
  /* ---------------------------------------------------------------- coaches */
  dbpza: {
    label: "DBpza (double-deck coach)", kind: "coach", length_m: 26.8, mass_t: 49, axles: 4, vmax_kmh: 160, seats: 120,
    brake_t: { P: 55, R: 75 }, countries: ["DE"],
  },
  bpmz: {
    label: "Bpmz (open coach)", kind: "coach", length_m: 26.4, mass_t: 47, axles: 4, vmax_kmh: 200, seats: 80,
    brake_t: { P: 52, R: 74, "R+Mg": 96 }, countries: ["DE", "AT", "CH", "CZ", "PL", "NL"],
  },
  /* ---------------------------------------------------------------- freight wagons */
  sgns: {
    label: "Sgns (container flat, 60 ft)", kind: "wagon", length_m: 19.7, mass_t: 20, load_t: 70, axles: 4, vmax_kmh: 120,
    brake_t: { G: 20, P: 20 }, brake_loaded_t: { G: 58, P: 58 }, countries: ["DE", "AT", "CH", "CZ", "PL", "NL", "FR"],
  },
  eanos: {
    label: "Eanos (open wagon)", kind: "wagon", length_m: 15.7, mass_t: 25, load_t: 65, axles: 4, vmax_kmh: 100,
    brake_t: { G: 24, P: 24 }, brake_loaded_t: { G: 58, P: 58 }, countries: ["DE", "AT", "CH", "CZ", "PL", "NL", "FR"],
  },
  habbins: {
    label: "Habbins (sliding wall wagon)", kind: "wagon", length_m: 23.3, mass_t: 28, load_t: 62, axles: 4, vmax_kmh: 120,
    brake_t: { G: 27, P: 27 }, brake_loaded_t: { G: 58, P: 58 }, countries: ["DE", "AT", "CH", "CZ", "PL", "NL", "FR"],
  },
  zacns: {
    label: "Zacns (tank wagon)", kind: "wagon", length_m: 15.5, mass_t: 23, load_t: 67, axles: 4, vmax_kmh: 100,
    brake_t: { G: 23, P: 23 }, brake_loaded_t: { G: 58, P: 58 }, countries: ["DE", "AT", "CH", "CZ", "PL", "NL", "FR"],
  },
};

/**
 * A train's vehicles in order, resolved from the catalogue (and a layout's own types), with the
 * figures of the train.
 */
export class Consist {
  /**
   * @param {object} spec `{id, name, vehicles: [{type, count?, loaded?, isolated?}], brake_position?}`
   *   (`loaded`: share 0..1 of the load, true = full; `isolated`: brakes cut out)
   * @param {Record<string, object>} [types] vehicle types (default: the catalogue)
   */
  constructor(spec, types = VEHICLE_TYPES) {
    this.id = spec.id ?? null;
    this.name = spec.name || spec.id || "Train";
    /** Brake position of the train (default: G for freight trains, else P or R by its vehicles). */
    this.brakePosition = BRAKE_POSITIONS[spec.brake_position] ? spec.brake_position : null;
    /** @type {Array<{type: string, t: object, loaded: number, isolated: boolean}>} */
    this.vehicles = [];
    /** Types of the spec that are not known. */
    this.unknown = [];
    for (const v of spec.vehicles || []) {
      const t = types[v.type];
      if (!t) {
        this.unknown.push(v.type);
        continue;
      }
      const n = Math.max(1, Math.min(60, Math.round(Number(v.count) || 1)));
      const loaded = v.loaded === true ? 1 : Math.min(1, Math.max(0, Number(v.loaded) || 0));
      for (let i = 0; i < n; i++) this.vehicles.push({ type: v.type, t, loaded, isolated: v.isolated === true || (Number.isInteger(v.isolated) && i < v.isolated) });
    }
    if (!this.brakePosition) this.brakePosition = this.vehicles.length && this.vehicles.every((v) => v.t.kind === "wagon" || v.t.kind === "locomotive") && this.vehicles.some((v) => v.t.kind === "wagon") ? "G" : this.vehicles.some((v) => v.t.brake_t?.R != null) ? "R" : "P";
  }

  /** Mass of a vehicle as it is loaded (t). */
  static massOf(v) {
    return v.t.mass_t + (v.t.load_t || 0) * v.loaded;
  }

  /**
   * Brake weight (t) of a vehicle in a brake position: its own for that position, else the nearest
   * slower one it has (R+Mg → R → P → G), else the nearest faster one (a coach in a train braked in
   * G brakes with its P weight); for wagons with a load-dependent brake between empty and loaded;
   * 0 when its brakes are isolated.
   */
  static brakeWeightOf(v, position) {
    if (v.isolated) return 0;
    const order = ["R+Mg", "R", "P", "G"], at = Math.max(0, order.indexOf(position));
    const search = [...order.slice(at), ...order.slice(0, at).reverse()];
    const pick = (table) => {
      if (!table) return null;
      for (const p of search) if (table[p] != null) return table[p];
      return null;
    };
    const empty = pick(v.t.brake_t) ?? 0;
    const loaded = pick(v.t.brake_loaded_t);
    return loaded == null ? empty : empty + (loaded - empty) * v.loaded;
  }

  get length_m() {
    return this.vehicles.reduce((s, v) => s + v.t.length_m, 0);
  }

  get mass_t() {
    return this.vehicles.reduce((s, v) => s + Consist.massOf(v), 0);
  }

  get axles() {
    return this.vehicles.reduce((s, v) => s + v.t.axles, 0);
  }

  /** Sum of the brake weights in the train's brake position (t). */
  get brakeWeight_t() {
    return this.vehicles.reduce((s, v) => s + Consist.brakeWeightOf(v, this.brakePosition), 0);
  }

  /** Brake percentage (Bremshundertstel): brake weights / train mass × 100. */
  get brakePercentage() {
    const m = this.mass_t;
    return m > 0 ? (this.brakeWeight_t / m) * 100 : 0;
  }

  /** Top speed: the lowest of its vehicles, and the vehicle that limits it. */
  get vmax() {
    let best = null;
    for (const v of this.vehicles) if (!best || v.t.vmax_kmh < best.kmh) best = { kmh: v.t.vmax_kmh, by: v.t.label };
    return best ?? { kmh: null, by: null };
  }

  /** The highest axle load (t) and the vehicle with it. */
  get maxAxleLoad() {
    let best = null;
    for (const v of this.vehicles) {
      const a = Consist.massOf(v) / v.t.axles;
      if (!best || a > best.t) best = { t: a, by: v.t.label };
    }
    return best ?? { t: 0, by: null };
  }

  /** The highest load per metre (t/m) of a vehicle (EN 15528: mass over the length over buffers). */
  get maxMetreLoad() {
    let best = null;
    for (const v of this.vehicles) {
      const m = Consist.massOf(v) / v.t.length_m;
      if (!best || m > best.t) best = { t: m, by: v.t.label };
    }
    return best ?? { t: 0, by: null };
  }

  /** Vehicles whose brakes are isolated. */
  get isolated() {
    return this.vehicles.filter((v) => v.isolated).length;
  }

  /** The vehicles in groups of the same type as text: "BR 146.2 + 4 × DBpza". */
  get summary() {
    const groups = [];
    for (const v of this.vehicles) {
      const last = groups[groups.length - 1];
      if (last && last.type === v.type) last.n++;
      else groups.push({ type: v.type, n: 1, label: v.t.label.split(" (")[0] });
    }
    return groups.map((g) => (g.n > 1 ? `${g.n} × ${g.label}` : g.label)).join(" + ");
  }
}

/**
 * The rows of a train's card for its consist: what it is made of, its length, mass, axles, top
 * speed, brake position and percentage, axle and metre load.
 * @param {Consist} c
 * @returns {Array<[string, string]>}
 */
export function consistRows(c) {
  const v = c.vmax, a = c.maxAxleLoad, m = c.maxMetreLoad;
  const rows = [
    ["Consist", c.summary || "–"],
    ["Length", `${Math.round(c.length_m)} m`],
    ["Mass", `${Math.round(c.mass_t)} t`],
    ["Axles", String(c.axles)],
    // the vehicle that limits it, when another one could run faster
    ["Top speed", v.kmh ? `${v.kmh} km/h${c.vehicles.some((x) => x.t.vmax_kmh > v.kmh) ? ` (${v.by.split(" (")[0]})` : ""}` : "–"],
    ["Brake position", c.brakePosition],
    ["Brake percentage", `${Math.round(c.brakePercentage)} %${c.isolated ? ` (${c.isolated} brake${c.isolated === 1 ? "" : "s"} isolated)` : ""}`],
    ["Highest axle load", `${a.t.toFixed(1)} t`],
    ["Highest metre load", `${m.t.toFixed(1)} t/m`],
  ];
  if (c.unknown.length) rows.push(["Unknown vehicle types", c.unknown.join(", ")]);
  return rows;
}
