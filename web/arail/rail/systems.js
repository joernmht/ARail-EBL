/**
 * The railway systems of the track sections: traction power, train control, signalling, radio,
 * gauge, line category and loading gauge, line speed, the country and its infrastructure manager.
 *
 * Every `track` object carries them as parameters; a value left empty is the usual one of the
 * section's country ({@link COUNTRIES}). The names follow the parameters of the EU Register of
 * Infrastructure (RINF), so that real corridors can be filled in from it later. The values of the
 * countries are typical ones, simplified for teaching: a real line may differ (see RINF).
 * @module arail/rail/systems
 */
import { CD, CD_LIGHT, OVERLAY, grey, rgba } from "../core/colors.js";

/** Traction power supply (RINF: energy supply system, voltage and frequency). */
export const POWER = {
  none: { label: "not electrified", short: "no power", colour: grey(0.55) },
  ac15: { label: "15 kV 16.7 Hz AC", short: "15 kV 16.7 Hz", colour: CD.tuerkis },
  ac25: { label: "25 kV 50 Hz AC", short: "25 kV 50 Hz", colour: CD.brillantblau },
  dc3: { label: "3 kV DC", short: "3 kV DC", colour: CD.orange },
  dc1_5: { label: "1.5 kV DC", short: "1.5 kV DC", colour: CD.gelb },
  dc0_75: { label: "750 V DC third rail", short: "750 V DC", colour: CD.rot },
};

/** Pantograph heads the contact line accepts (RINF: accepted pantograph heads), mm. */
export const PANTOGRAPH = {
  1450: { label: "1450 mm head", short: "1450 mm", colour: CD.orange },
  1600: { label: "1600 mm head (TSI)", short: "1600 mm", colour: CD.brillantblau },
  1950: { label: "1950 mm head", short: "1950 mm", colour: CD.tuerkis },
};

/** Class B (national) train protection (RINF: other train protection, control and warning systems). */
export const TRAIN_CONTROL = {
  none: { label: "none", short: "none", colour: grey(0.55) },
  pzb: { label: "PZB 90", short: "PZB", colour: CD.tuerkis },
  pzb_lzb: { label: "PZB 90 and LZB", short: "PZB + LZB", colour: CD_LIGHT.tuerkis },
  ls: { label: "LS (Czechia, Slovakia)", short: "LS", colour: CD.orange },
  shp: { label: "SHP (Poland)", short: "SHP", colour: CD.rot },
  kvb: { label: "KVB (France)", short: "KVB", colour: CD.brillantblau },
  atb: { label: "ATB (Netherlands)", short: "ATB", colour: CD.gelb },
  zub: { label: "ZUB 121 / Integra (Switzerland)", short: "ZUB", colour: CD_LIGHT.rot },
};

/** ETCS level (RINF: ETCS level). */
export const ETCS = {
  none: { label: "no ETCS", short: "no ETCS", colour: grey(0.55) },
  l1ls: { label: "ETCS Level 1 Limited Supervision", short: "ETCS L1 LS", colour: CD_LIGHT.orange },
  l1: { label: "ETCS Level 1", short: "ETCS L1", colour: CD.orange },
  l2: { label: "ETCS Level 2", short: "ETCS L2", colour: CD.tuerkis },
};

/** Lineside signals (the aspects drivers read). */
export const SIGNALLING = {
  hv: { label: "H/V signals (Germany)", short: "H/V", colour: CD.tuerkis },
  ks: { label: "Ks signals (Germany)", short: "Ks", colour: CD_LIGHT.tuerkis },
  hl: { label: "Hl signals (former DR, Germany)", short: "Hl", colour: CD.brillantblau },
  cz: { label: "Czech signals (SŽ)", short: "CZ signals", colour: CD.orange },
  pl: { label: "Polish signals (PKP PLK)", short: "PL signals", colour: CD.rot },
  at: { label: "Austrian signals (ÖBB)", short: "AT signals", colour: CD_LIGHT.rot },
  ch: { label: "Swiss signals (SBB)", short: "CH signals", colour: CD.gelb },
  fr: { label: "French signals (SNCF Réseau)", short: "FR signals", colour: CD_LIGHT.orange },
  nl: { label: "Dutch signals (ProRail)", short: "NL signals", colour: grey(0.4) },
  etcs: { label: "no lineside signals (ETCS marker boards)", short: "marker boards", colour: grey(0.7) },
};

/** Train radio (RINF: GSM-R version; its network is the country's). */
export const RADIO = {
  none: { label: "no train radio", short: "no radio", colour: grey(0.55) },
  analogue: { label: "analogue train radio", short: "analogue", colour: CD.orange },
  gsmr: { label: "GSM-R", short: "GSM-R", colour: CD.tuerkis },
  frmcs: { label: "FRMCS", short: "FRMCS", colour: CD.brillantblau },
};

/** Nominal track gauge (RINF: nominal track gauge), mm. */
export const GAUGE = {
  1435: { label: "1435 mm (standard gauge)", short: "1435 mm", colour: CD.tuerkis },
  1520: { label: "1520 mm (broad gauge)", short: "1520 mm", colour: CD.orange },
  1668: { label: "1668 mm (Iberian gauge)", short: "1668 mm", colour: CD.rot },
  1000: { label: "1000 mm (metre gauge)", short: "1000 mm", colour: CD.gelb },
};

/**
 * Line categories of EN 15528 (RINF: load capability): the letter is the highest axle load, the
 * number the highest load per metre of the train.
 */
export const AXLE_LOADS_T = { A: 16, B: 18, C: 20, D: 22.5, E: 25 };
export const METRE_LOADS_T = { 1: 5, 2: 6.4, 3: 7.2, 4: 8, 5: 8.8, 6: 10 };
export const ROUTE_CLASS = Object.fromEntries(["A", "B1", "B2", "C2", "C3", "C4", "D2", "D3", "D4", "E4", "E5"].map((c, i, all) => {
  const { axle_t, metre_t } = routeClassLimits(c);
  const colours = [grey(0.7), grey(0.6), grey(0.5), CD.gelb, CD_LIGHT.orange, CD.orange, CD_LIGHT.tuerkis, CD.tuerkis, CD.tuerkis, CD.brillantblau, CD.brillantblau];
  return [c, { label: `${c} (${axle_t} t per axle, ${metre_t} t per metre)`, short: c, colour: colours[i % all.length] }];
}));

/** Loading gauges (RINF: gauging). */
export const LOADING_GAUGE = {
  G1: { label: "G1", short: "G1", colour: grey(0.6) },
  G2: { label: "G2", short: "G2", colour: CD.tuerkis },
  GA: { label: "GA", short: "GA", colour: CD.gelb },
  GB: { label: "GB", short: "GB", colour: CD.orange },
  GC: { label: "GC", short: "GC", colour: CD.brillantblau },
};

/**
 * Countries and what is usual there (typical values, simplified): the defaults of every section
 * of the country. `im`: its main infrastructure manager.
 */
export const COUNTRIES = {
  DE: { label: "Germany", im: "DB InfraGO", power: "ac15", pantograph_mm: 1950, train_control: "pzb", etcs: "none", signalling: "ks", radio: "gsmr", gauge_mm: 1435, route_class: "D4", loading_gauge: "G2", colour: CD.tuerkis },
  CZ: { label: "Czechia", im: "Správa železnic", power: "dc3", pantograph_mm: 1950, train_control: "ls", etcs: "none", signalling: "cz", radio: "gsmr", gauge_mm: 1435, route_class: "D4", loading_gauge: "GC", colour: CD.orange },
  PL: { label: "Poland", im: "PKP PLK", power: "dc3", pantograph_mm: 1950, train_control: "shp", etcs: "none", signalling: "pl", radio: "gsmr", gauge_mm: 1435, route_class: "D4", loading_gauge: "GC", colour: CD.rot },
  AT: { label: "Austria", im: "ÖBB-Infrastruktur", power: "ac15", pantograph_mm: 1950, train_control: "pzb", etcs: "none", signalling: "at", radio: "gsmr", gauge_mm: 1435, route_class: "D4", loading_gauge: "GC", colour: CD_LIGHT.rot },
  CH: { label: "Switzerland", im: "SBB Infrastruktur", power: "ac15", pantograph_mm: 1450, train_control: "zub", etcs: "l1ls", signalling: "ch", radio: "gsmr", gauge_mm: 1435, route_class: "D4", loading_gauge: "GB", colour: CD.gelb },
  FR: { label: "France", im: "SNCF Réseau", power: "ac25", pantograph_mm: 1600, train_control: "kvb", etcs: "none", signalling: "fr", radio: "gsmr", gauge_mm: 1435, route_class: "D4", loading_gauge: "GB", colour: CD.brillantblau },
  NL: { label: "Netherlands", im: "ProRail", power: "dc1_5", pantograph_mm: 1950, train_control: "atb", etcs: "none", signalling: "nl", radio: "gsmr", gauge_mm: 1435, route_class: "D4", loading_gauge: "GC", colour: CD_LIGHT.orange },
};

/**
 * The systems of a section, in the order shown: key (a parameter of tracks), label, RINF parameter,
 * catalogue of values (null: a free value).
 */
export const SYSTEMS = [
  { key: "power", label: "Traction power", rinf: "Energy supply system (voltage and frequency)", values: POWER },
  { key: "pantograph_mm", label: "Pantograph head", rinf: "Accepted pantograph heads", values: PANTOGRAPH, unit: "mm" },
  { key: "train_control", label: "Train protection", rinf: "Other train protection, control and warning systems installed", values: TRAIN_CONTROL },
  { key: "etcs", label: "ETCS", rinf: "ETCS level", values: ETCS },
  { key: "signalling", label: "Signals", rinf: "Lineside signalling system", values: SIGNALLING },
  { key: "radio", label: "Train radio", rinf: "GSM-R version", values: RADIO },
  { key: "gauge_mm", label: "Track gauge", rinf: "Nominal track gauge", values: GAUGE, unit: "mm" },
  { key: "route_class", label: "Line category", rinf: "Load capability (EN 15528)", values: ROUTE_CLASS },
  { key: "loading_gauge", label: "Loading gauge", rinf: "Gauging", values: LOADING_GAUGE },
  { key: "country", label: "Country", rinf: "Member State", values: COUNTRIES },
  { key: "im", label: "Infrastructure manager", rinf: "Infrastructure manager", values: null },
  { key: "max_speed_kmh", label: "Line speed", rinf: "Maximum permitted speed", values: null, unit: "km/h" },
];

/** The systems that can colour the tracks (View → Track systems), with their names. */
export const SYSTEM_OVERLAYS = [
  ["power", "Traction power"], ["train_control", "Train protection"], ["etcs", "ETCS"], ["signalling", "Signals"], ["radio", "Train radio"],
  ["gauge_mm", "Track gauge"], ["route_class", "Line category"], ["loading_gauge", "Loading gauge"], ["country", "Country"], ["im", "Infrastructure manager"],
];

/** The highest axle load and metre load (t) of a line category of EN 15528 ("D4": 22.5 t, 8 t/m). */
export function routeClassLimits(code) {
  const m = String(code || "").match(/^([A-E])([1-6])?$/);
  if (!m) return { axle_t: null, metre_t: null };
  return { axle_t: AXLE_LOADS_T[m[1]], metre_t: m[2] ? METRE_LOADS_T[m[2]] : METRE_LOADS_T[1] };
}

/**
 * Parameters (ParamSpec) of the systems for the `track` object: each one empty by default, which
 * means the usual value of the section's country.
 */
export const SYSTEM_PARAMS = [
  { key: "country", label: "Country", type: "select", default: "DE", options: Object.entries(COUNTRIES).map(([k, c]) => [k, `${c.label} (${k})`]), help: "The country the section belongs to: the systems left empty are the ones usual there." },
  ...SYSTEMS.filter((s) => s.values && s.key !== "country").map((s) => ({
    key: s.key, label: s.label, type: "select", default: "",
    options: [["", "as usual in the country"], ...Object.entries(s.values).map(([k, v]) => [k, v.label])],
  })),
  { key: "im", label: "Infrastructure manager", type: "text", default: "", help: "Empty: the country's main one." },
  { key: "max_speed_kmh", label: "Line speed", type: "number", unit: "km/h", min: 0, max: 400, step: 5, help: "Empty: not known." },
];

/**
 * The systems of a section from its parameters: every key of {@link SYSTEMS} with its value, and
 * which of them come from the country (`usual`).
 * @param {object} spec a track's spec
 * @returns {{values: Record<string, string | number | null>, usual: Set<string>}}
 */
export function sectionSystems(spec = {}) {
  const country = COUNTRIES[spec.country] ? spec.country : "DE";
  const preset = COUNTRIES[country], values = { country }, usual = new Set();
  for (const s of SYSTEMS) {
    if (s.key === "country") continue;
    const own = spec[s.key];
    if (own !== undefined && own !== null && own !== "") values[s.key] = typeof own === "string" && /^\d+$/.test(own) && s.unit === "mm" ? Number(own) : own;
    else {
      values[s.key] = preset[s.key] ?? null;
      if (values[s.key] != null) usual.add(s.key);
    }
  }
  if (!(Number(values.max_speed_kmh) > 0)) values.max_speed_kmh = null;
  return { values, usual };
}

/** The catalogue entry of a value of a system (label, short, colour), or a plain one for free values. */
export function systemValue(key, value) {
  const s = SYSTEMS.find((x) => x.key === key);
  const entry = s?.values?.[value];
  if (entry) return entry;
  if (value == null || value === "") return { label: "not known", short: "–", colour: grey(0.55) };
  // a free value (the infrastructure manager): a colour of its own, stable for its name
  const colours = [CD.tuerkis, CD.orange, CD.brillantblau, CD.rot, CD_LIGHT.tuerkis, CD_LIGHT.orange];
  let h = 0;
  for (const c of String(value)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { label: `${value}${s?.unit ? ` ${s.unit}` : ""}`, short: `${value}${s?.unit ? ` ${s.unit}` : ""}`, colour: colours[h % colours.length] };
}

/** The systems of a section as card rows: [label, value] (values usual in the country marked so). */
export function systemRows(spec) {
  const { values, usual } = sectionSystems(spec);
  return SYSTEMS.filter((s) => values[s.key] != null).map((s) => {
    const v = s.key === "country" ? `${COUNTRIES[values.country].label} (${values.country})` : systemValue(s.key, values[s.key]).label;
    return [s.label, usual.has(s.key) ? `${v} (usual in ${values.country})` : v];
  });
}

/**
 * Where neighbouring sections meet with different systems: ends of tracks closer than `tolMM`.
 * @param {Array<{id: string, spec: object, geometry: {points: number[][]} | null}>} tracks
 * @param {string} key the system compared (e.g. "power"), or null: any system
 * @param {number} [tolMM]
 * @returns {Array<{at: number[], a: string, b: string, changes: Array<{key: string, from: *, to: *}>}>}
 */
export function systemChanges(tracks, key = null, tolMM = 25) {
  const ends = [];
  for (const t of tracks) {
    const p = t.geometry?.points;
    if (!p || p.length < 2) continue;
    ends.push({ t, at: p[0] }, { t, at: p[p.length - 1] });
  }
  const out = [], seen = new Set();
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i], b = ends[j];
      if (a.t === b.t || Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) > tolMM) continue;
      const pair = [a.t.id, b.t.id].sort().join("|");
      if (seen.has(pair)) continue;
      seen.add(pair);
      const A = sectionSystems(a.t.spec).values, B = sectionSystems(b.t.spec).values;
      const changes = SYSTEMS.filter((s) => (!key || s.key === key) && String(A[s.key] ?? "") !== String(B[s.key] ?? "")).map((s) => ({ key: s.key, from: A[s.key], to: B[s.key] }));
      if (changes.length) out.push({ at: [(a.at[0] + b.at[0]) / 2, (a.at[1] + b.at[1]) / 2], a: a.t.id, b: b.t.id, changes });
    }
  }
  return out;
}

const changeCache = new WeakMap();

/**
 * {@link systemChanges} between the tracks of a world, cached until objects or the marker map change.
 * @param {import("../core/world.js").World} world
 * @param {string | null} key
 */
export function worldSystemChanges(world, key) {
  const stamp = `${world.objectsVersion}:${world.map.version}:${world.scale}:${key}`;
  const hit = changeCache.get(world);
  if (hit?.stamp === stamp) return hit.changes;
  const changes = systemChanges(world.objects.filter((o) => o.type === "track"), key);
  changeCache.set(world, { stamp, changes });
  return changes;
}

/**
 * Colour a track by one of its systems (View → Track systems): a band over the track, its value
 * at the middle; the label is left out where it would cover others.
 * @param {import("../core/view.js").View} view
 * @param {{spec: object, geometry: {points: number[][], lengths: number[], total: number}}} track
 * @param {string} key
 */
export function drawSystemBand(view, track, key) {
  const g = track.geometry;
  if (!g) return;
  const { values } = sectionSystems(track.spec);
  const v = systemValue(key, values[key]);
  view.ribbon(g.points, view.m(3.6), { fill: rgba(v.colour, 0.62), order: 26 });
  view.line(g.points, { stroke: v.colour, width: 2, order: 27 });
  let s = g.total / 2, i = 1;
  while (i < g.lengths.length - 1 && g.lengths[i] < s) i++;
  const a = g.points[i - 1], b = g.points[i], k = (s - g.lengths[i - 1]) / Math.max(1e-9, g.lengths[i] - g.lengths[i - 1]);
  const mid = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  view.label([mid[0], mid[1], view.m(1)], v.short, { size: 10, background: OVERLAY.label, optional: true, order: 2 });
}

/**
 * Mark where the system shown changes between two sections: a bar across the track and the change
 * ("15 kV 16.7 Hz | 3 kV DC").
 * @param {import("../core/view.js").View} view
 * @param {{at: number[], changes: Array<{key: string, from: *, to: *}>}} change
 */
export function drawSystemChange(view, change) {
  const [x, y] = change.at, r = view.m(4);
  view.polygon([[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]], { fill: rgba(OVERLAY.selection, 0.85), stroke: "#ffffff", width: 1.5, order: 28 });
  const c = change.changes[0];
  view.label([x, y, view.m(2)], `${systemValue(c.key, c.from).short} | ${systemValue(c.key, c.to).short}`, { size: 10, background: OVERLAY.label, anchor: "bottom", order: 3 });
}
