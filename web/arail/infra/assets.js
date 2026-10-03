/**
 * Assets of the infrastructure simulation: their true condition (health, hidden from the players),
 * what is known of it (the last observation, live monitoring, its age), their data in the asset
 * information model, and the generation of the assets of the network beyond the layout.
 *
 * The true condition falls a little every day (faster with more traffic and when servicing is
 * overdue, randomly); faults are more likely the worse it is. What the players see is the known
 * condition: the last inspection, aged by the expected wear and getting less certain with time, mixed
 * with the share of the condition the asset (or its interlocking) reports live.
 * @module arail/infra/assets
 */
import { GENERATIONS, gradeOf, gradeValue, hazardFactor, repairCap } from "./catalog.js";
import { hashKey, stream } from "../ops/util.js";

/** Wear acceleration: worn assets wear faster (du/dt = r (1 + A u), u = 1 − h). */
const A = 1;
/** Health at the end of the service life with normal servicing. */
const END_U = 0.7;
/** Uncertainty an estimate gains per year since the last observation. */
const SIGMA_PER_YEAR = 0.07;
/** Uncertainty of an estimate from the age alone. */
const SIGMA_AGE = 0.18;

/** Wear rate (per year) of a service life: the health is 1 − END_U at its end. */
export const wearRate = (lifeY) => Math.log(1 + A * END_U) / (A * Math.max(1, lifeY));

/** Expected health of an asset of this age (years) and service life with normal servicing. */
export function healthAtAge(ageY, lifeY) {
  const u = (Math.exp(A * wearRate(lifeY) * Math.max(0, ageY)) - 1) / A;
  return Math.max(0.02, 1 - u);
}

/** Expected health after `years` from health h (the same wear law). */
export function healthAfter(h, years, rate) {
  const u0 = 1 - h;
  const u = ((1 + A * u0) * Math.exp(A * rate * Math.max(0, years)) - 1) / A;
  return Math.max(0, 1 - u);
}

/** A stable IFC GlobalId (22 characters of the IFC base-64 alphabet) for an asset id. */
export function ifcGuid(id) {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
  let out = chars[hashKey("g0", id) % 4];
  for (let i = 1; i < 22; i++) out += chars[hashKey("g", id, i) % 64];
  return out;
}

export class Asset {
  /**
   * @param {object} spec {id, type, name, line, km, length_km, pos, object, station, built, generation, interlocking, road_owner, road}
   * @param {object} type the asset type (catalog.js, with the layout's changes)
   */
  constructor(spec, type) {
    Object.assign(this, spec);
    this.t = type;
    this.discipline = type.discipline;
    this.length_km = type.linear ? Math.max(0.01, spec.length_km ?? 1) : 0;
    this.guid = ifcGuid(spec.id);
    /** True health 0..1 (hidden). */
    this.h = 1;
    /** The open fault: {id, t, knownAt, kind, cause, responder, end}. */
    this.fault = null;
    /** Faults of the year (for the failure rate shown). */
    this.faults = 0;
    /** The last observation: {h, sigma, t, source}; null if never observed. */
    this.obs = null;
    /** Condition monitoring added (share of the condition reported live). */
    this.retrofit = 0;
    /** Data completeness in the asset information model (0..1). */
    this.data = 0.6;
    /** The year of construction is recorded. */
    this.builtKnown = true;
    /** Until when a hidden construction defect makes it fail more often (minutes). */
    this.defectUntil = -Infinity;
    /** Time of the last servicing (on-site inspection or repair). */
    this.serviced = 0;
    /** Removed from the network (by an upgrade). */
    this.removed = false;
    /** Units an interlocking operates (Stelleinheiten). */
    this.units = 0;
  }

  get life() {
    return this.t.life_y ?? GENERATIONS[this.generation]?.life_y ?? 30;
  }

  /** Age in years at engine time t (minutes; year 0 starts at `startYear`). */
  age(t, startYear) {
    return Math.max(0, startYear + t / 525600 - this.built);
  }

  /** Units this asset counts as (km for linear assets). */
  get size() {
    return this.t.linear ? this.length_km : 1;
  }

  /**
   * Share of the condition known live: its own monitoring (GSM-R, substations, lifts, displays),
   * that of its interlocking (field elements), or condition monitoring added later.
   * @param {Map<string, Asset>} assets
   */
  liveShare(assets) {
    let w = this.t.live || 0;
    if (this.t.field) {
      const il = assets.get(this.interlocking);
      w = Math.max(w, (GENERATIONS[il?.generation]?.share ?? 0) * (this.t.field_share ?? 1));
    }
    if (this.type === "interlocking") w = Math.max(w, GENERATIONS[this.generation]?.share ? GENERATIONS[this.generation].share + 0.2 : 0);
    return Math.min(0.95, Math.max(w, this.retrofit));
  }

  /** How its faults become known: "driver", "panel", "diagnosis", "monitoring" or "passengers". */
  reportPath(assets) {
    if (this.retrofit > 0) return "monitoring";
    if (this.t.field) {
      const il = assets.get(this.interlocking);
      if (il) return GENERATIONS[il.generation]?.report ?? "driver";
    }
    if (this.type === "interlocking") return GENERATIONS[this.generation]?.report === "driver" ? "driver" : "panel";
    return this.t.report || "driver";
  }

  /** Expected failures a year at a health (per piece or for its length). */
  failureRate(h = this.h, loadFactor = 1) {
    return this.t.fail_per_y * this.size * hazardFactor(h) * (this.t.load ? loadFactor : 1);
  }

  /** One day of wear. */
  wear(rate, rng, { overdue = false, load = 1 } = {}) {
    const k = rate * (this.t.load ? load : 1) * (overdue ? 1.35 : 1) * Math.exp(0.45 * rng.normal() - 0.1);
    this.h = healthAfter(this.h, 1 / 365, k);
  }

  /** A repair of `gain` health, up to what its age allows. */
  repair(gain, t, startYear) {
    const cap = repairCap(this.age(t, startYear), this.life);
    if (this.h < cap) this.h = Math.min(cap, this.h + gain);
    if (gain >= 0.2) this.findingGrade = null;
  }

  /** Renewed (new asset, new data): health 1 (less with a hidden defect), age 0. */
  renew(t, startYear, { h = 1, data = 0.9 } = {}) {
    this.h = h;
    this.built = Math.round((startYear + t / 525600) * 10) / 10;
    this.builtKnown = true;
    this.data = data;
    this.serviced = t;
    this.faults = 0;
    this.findingGrade = null;
  }

  /** Record what an inspection (or a repair team, or a fault) saw: a health with an error. */
  observe(t, sigma, source, rng, { visible = 1 } = {}) {
    if (visible <= 0) return;
    const seen = Math.min(1, Math.max(0, this.h + sigma * rng.normal()));
    // a drone sees only part of the condition: the rest stays as estimated before
    const before = this.obs ? healthAfter(this.obs.h, (t - this.obs.t) / 525600, this._rate) : seen;
    const h = visible >= 1 ? seen : visible * seen + (1 - visible) * before;
    const prevSigma = this.obs ? Math.hypot(this.obs.sigma, (SIGMA_PER_YEAR * (t - this.obs.t)) / 525600) : SIGMA_AGE;
    const s = visible >= 1 ? sigma : Math.hypot(visible * sigma, (1 - visible) * prevSigma);
    this.obs = { h, sigma: s, t, source };
  }

  /**
   * What is known of its condition at time t: {h, sigma, grade, value, t, source, live}. `t` of the
   * result is when it was last checked (null: never), `live` the share known live.
   * @param {number} t now (minutes)
   * @param {{assets: Map, startYear: number, seed: number}} ctx
   */
  known(t, ctx) {
    const w = this.liveShare(ctx.assets);
    let h, sigma, source;
    if (this.obs) {
      const y = (t - this.obs.t) / 525600;
      h = healthAfter(this.obs.h, y, this._rate);
      sigma = Math.hypot(this.obs.sigma, SIGMA_PER_YEAR * y);
      source = this.obs.source;
    } else {
      // only the age: from the records, or a guess when the year of construction is not recorded
      const age = this.builtKnown ? this.age(t, ctx.startYear) : this.life * 0.6;
      h = healthAtAge(age, this.life);
      sigma = this.builtKnown ? SIGMA_AGE : SIGMA_AGE * 1.4;
      source = this.builtKnown ? "age" : "unknown";
    }
    if (w > 0) {
      // the live part: the true condition with a small measurement noise (stable within a day)
      const r = stream(ctx.seed, "live", this.id, Math.floor(t / 1440));
      const live = Math.min(1, Math.max(0, this.h + 0.02 * r.normal()));
      h = w * live + (1 - w) * h;
      sigma = w * 0.02 + (1 - w) * sigma;
    }
    const faultKnown = !!(this.fault && this.fault.knownAt <= t);
    return {
      h, sigma, value: faultKnown ? 6 : gradeValue(h), grade: faultKnown ? 6 : gradeOf(h), t: this.obs?.t ?? null, source, live: w,
      fault: faultKnown,
    };
  }

  /** The true grade (6 while a fault is open). */
  trueGrade() {
    return this.fault ? 6 : gradeOf(this.h);
  }
}

/* ---------------------------------------------------------------- generating the network's assets */

const PREFIX = {
  track: "GL", turnout: "W", signal: "SIG", balise: "BAL", interlocking: "STW", "level-crossing": "BÜ", cable: "KAB", gsmr: "GSM",
  catenary: "OL", substation: "UW", platform: "BST", lift: "AZ", pis: "FIA",
};

/** A short code of a station name ("Talsee" → "Tal"). */
const short = (name) => String(name).replace(/[^A-Za-zÄÖÜäöüß]/g, "").slice(0, 3) || "X";

/**
 * The specs of the assets of the network beyond the layout (and of stations not on the layout),
 * generated by rules from the lines and stations: track sections, signals with their balises,
 * switches, interlockings, cable routes, GSM-R sites, overhead line sections, substations, level
 * crossings, platforms, lifts and displays. Deterministic for a seed.
 * @param {object} model normalized settings
 * @param {import("./network.js").Network} net
 * @param {{seed: number, skipStation?: string|null, layoutSpan?: number[]|null}} options layoutSpan: km of
 *   the station's line that the layout shows (no generated track, catenary or cable there)
 */
export function generateAssets(model, net, { seed, skipStation = null, layoutSpan = null }) {
  const out = [];
  const g = model.generate || {};
  const rng = stream(seed, "generate");
  const ids = new Set();
  const year = model.start_year;
  /** A year of construction for a service life, spread so that some assets are past it. */
  const built = (life, spread = 1.05) => Math.round(year - rng.uniform(0.05, spread) * life);
  const add = (spec) => {
    // equipment of a station at the end of its line stays on the line
    const line = model.lines.find((l) => l.id === spec.line);
    if (line && !spec.length_km) spec = { ...spec, km: Math.min(line.km[1], Math.max(line.km[0], spec.km)) };
    let id = spec.id;
    for (let i = 2; ids.has(id); i++) id = `${spec.id}-${i}`;
    ids.add(id);
    const pos = spec.pos ?? net.at(spec.line, spec.km + (spec.length_km || 0) / 2)?.pos ?? null;
    out.push({ ...spec, id, pos });
  };
  const inLayout = (line, a, b) => layoutSpan && line === model.placement.line && b > layoutSpan[0] && a < layoutSpan[1];
  // interlockings and station equipment
  for (const s of model.stations) {
    const code = short(s.name);
    add({ id: `STW-${code}`, type: "interlocking", name: `Interlocking ${s.name}`, line: s.line, km: s.km, station: s.id, generation: s.interlocking.generation, built: s.interlocking.built });
    if (s.id === skipStation) continue;
    for (let i = 1; i <= Math.max(2, s.tracks + 1); i++) {
      add({ id: `W-${code}-${i}`, type: "turnout", name: `Switch ${i} ${s.name}`, line: s.line, km: s.km + (i % 2 ? -0.35 : 0.35) + i * 0.01, station: s.id, built: built(20) });
    }
    for (const [k, dir] of [["A", -1], ["F", 1]]) {
      add({ id: `SIG-${code}-${k}`, type: "signal", name: `Entry signal ${k} ${s.name}`, line: s.line, km: s.km + dir * 0.9, station: s.id, built: built(30) });
      add({ id: `BAL-${code}-${k}`, type: "balise", name: `Balise at signal ${k} ${s.name}`, line: s.line, km: s.km + dir * 0.9 + 0.01, station: s.id, built: built(20) });
    }
    for (let i = 1; i <= s.tracks; i++) {
      for (const [k, dir] of [["N", 1], ["P", -1]]) {
        add({ id: `SIG-${code}-${k}${i}`, type: "signal", name: `Exit signal ${k}${i} ${s.name}`, line: s.line, km: s.km + dir * 0.25, station: s.id, built: built(30) });
      }
    }
    for (let i = 1; i <= s.platforms; i++) {
      add({ id: `BST-${code}-${i}`, type: "platform", name: `Platform ${i} ${s.name}`, line: s.line, km: s.km, station: s.id, built: built(50, 1.1) });
      add({ id: `FIA-${code}-${i}`, type: "pis", name: `Display platform ${i} ${s.name}`, line: s.line, km: s.km, station: s.id, built: built(12, 1.2) });
    }
    for (let i = 1; i <= s.lifts; i++) add({ id: `AZ-${code}-${i}`, type: "lift", name: `Lift ${i} ${s.name}`, line: s.line, km: s.km, station: s.id, built: built(15, 1.2) });
  }
  // along the lines
  for (const l of model.lines) {
    const [k0, k1] = l.km;
    const sec = Math.max(0.5, g.section_km || 3);
    for (let a = k0, i = 1; a < k1 - 0.05; a += sec, i++) {
      const b = Math.min(k1, a + sec);
      if (inLayout(l.id, a, b)) {
        // the part beyond the layout's tracks
        for (const [x, y] of [[a, layoutSpan[0]], [layoutSpan[1], b]]) {
          if (y - x < 0.05) continue;
          for (let tr = 1; tr <= l.tracks; tr++) add({ id: `GL-${l.id}-${tr}-${x.toFixed(1)}`, type: "track", name: `Track ${tr}, line ${l.id} km ${x.toFixed(1)}–${y.toFixed(1)}`, line: l.id, km: x, length_km: y - x, track: tr, built: built(30) });
        }
        continue;
      }
      for (let tr = 1; tr <= l.tracks; tr++) add({ id: `GL-${l.id}-${tr}-${a.toFixed(1)}`, type: "track", name: `Track ${tr}, line ${l.id} km ${a.toFixed(1)}–${b.toFixed(1)}`, line: l.id, km: a, length_km: b - a, track: tr, built: built(30) });
    }
    // block signals between the stations (double-track lines), one per direction every block_km
    if (l.tracks >= 2) {
      const stations = model.stations.filter((s) => s.line === l.id).map((s) => s.km);
      for (let km = k0 + (g.block_km || 3); km < k1 - 1; km += g.block_km || 3) {
        if (stations.some((s) => Math.abs(s - km) < 1.5)) continue;
        for (const [d, off] of [["1", 0], ["2", 0.15]]) {
          add({ id: `SIG-${l.id}-${km.toFixed(1)}-${d}`, type: "signal", name: `Block signal ${Math.round(km * 10)}${d === "2" ? "1" : ""} (line ${l.id})`, line: l.id, km: km + off, built: built(30) });
          add({ id: `BAL-${l.id}-${km.toFixed(1)}-${d}`, type: "balise", name: `Balise at block signal ${Math.round(km * 10)}${d === "2" ? "1" : ""}`, line: l.id, km: km + off + 0.01, built: built(20) });
        }
      }
    }
    const cable = Math.max(0.5, g.cable_km || 3);
    for (let a = k0; a < k1 - 0.05; a += cable) {
      const b = Math.min(k1, a + cable);
      if (inLayout(l.id, a, b)) continue;
      add({ id: `KAB-${l.id}-${a.toFixed(1)}`, type: "cable", name: `Cable route line ${l.id} km ${a.toFixed(1)}–${b.toFixed(1)}`, line: l.id, km: a, length_km: b - a, built: built(40) });
    }
    const gsm = Math.max(1, g.gsmr_km || 5);
    for (let km = k0 + gsm / 2; km < k1; km += gsm) {
      if (inLayout(l.id, km - 0.2, km + 0.2)) continue;
      add({ id: `GSM-${l.id}-${km.toFixed(1)}`, type: "gsmr", name: `GSM-R site line ${l.id} km ${km.toFixed(1)}`, line: l.id, km, built: built(15, 1.1) });
    }
    if (l.electrified) {
      const cat = Math.max(1, g.catenary_km || 5);
      for (let a = k0; a < k1 - 0.05; a += cat) {
        const b = Math.min(k1, a + cat);
        add({ id: `OL-${l.id}-${a.toFixed(1)}`, type: "catenary", name: `Overhead line line ${l.id} km ${a.toFixed(1)}–${b.toFixed(1)}`, line: l.id, km: a, length_km: b - a, built: built(30, 1.3) });
      }
    }
  }
  for (const c of model.crossings) {
    if (!net.onLine(String(c.line), +c.km)) continue;
    add({ id: `BÜ-${c.line}-${(+c.km).toFixed(1)}`, type: "level-crossing", name: `Level crossing ${c.road ?? ""} (line ${c.line} km ${(+c.km).toFixed(1)})`.replace("  ", " "), line: String(c.line), km: +c.km, road: c.road, road_owner: c.road_owner ?? "default", built: built(30) });
  }
  for (const s of model.substations) {
    if (!net.onLine(String(s.line), +s.km)) continue;
    add({ id: `UW-${s.line}-${(+s.km).toFixed(1)}`, type: "substation", name: s.name ?? `Substation km ${s.km}`, line: String(s.line), km: +s.km, built: built(40) });
  }
  // the layout's own extra assets
  for (const a of model.assets || []) if (a && a.type && a.object == null) add({ ...a, id: String(a.id ?? `${PREFIX[a.type] ?? "X"}-${a.line}-${a.km}`), line: String(a.line), km: +a.km });
  return out;
}

export { PREFIX as ASSET_PREFIX };
