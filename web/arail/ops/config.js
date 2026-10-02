/**
 * Settings of the operations simulation (`{"type": "operations", …}` in the layout's
 * `simulations`): defaults, the network made from the layout's platforms when none is given,
 * presets for setups and stress tests, normalization and validation.
 *
 * Every section is optional. Without `stations` and `lines`, the platforms of the layout form one
 * station and the line names on the platforms (`lines`, e.g. "RE 1, S 2") become lines out to
 * stations beyond the layout and back. The fleet and the crews are sized to the timetable.
 * See docs/operations.md for every setting.
 * @module arail/ops/config
 */
import { DAY, clockMinutes, deepMerge, hashKey, isObject, normalizeHours, num, weekdayIndex, weekdaySet } from "./util.js";

/** Maintenance levels of the default programme (ECM function 2: maintenance development). */
export const DEFAULT_PROGRAM = [
  { id: "IS1", name: "Inspection 1", every_km: 7500, every_days: 21, hours: 4, tolerance: 0.1, wear_reset: 0.6 },
  { id: "IS2", name: "Inspection 2", every_km: 30000, every_days: 90, hours: 10, tolerance: 0.1, wear_reset: 0.85, includes: ["IS1"] },
  { id: "IS3", name: "Inspection 3", every_km: 120000, every_days: 365, hours: 30, tolerance: 0.05, wear_reset: 1, includes: ["IS2", "IS1"] },
];

/** Soft failures: the train still runs, with a defect. */
export const DEFAULT_SOFT = [
  { id: "comfort", label: "Air conditioning or toilet out of order", share: 0.5, repair_h: 1.5, comfort: true },
  { id: "door", label: "Door out of order", share: 0.25, repair_h: 1, delay_min: 1, comfort: true },
  { id: "traction", label: "Traction restricted", share: 0.25, repair_h: 3, delay_min: 4, deadline_h: 48 },
];

/** The default vehicle type: a regional electric multiple unit. */
export const DEFAULT_VEHICLE = {
  id: "emu",
  name: "Electric multiple unit",
  seats: 200,
  prefix: "442 ",
  first_number: 101,
  built: [2008, 2018],
  failure: {
    hard_per_100k_km: 1.6,
    soft_per_10k_km: 2,
    wear_share: 0.6,
    shape: 2,
    infant: 0.8,
    infant_years: 1,
    ageing: 0.04,
    ageing_from: 12,
    start_share: 0.15,
    limp_share: 0.5,
    breakdown_min: 30,
    tow_min: 120,
    repair_h: 8,
    repair_sigma: 0.7,
  },
};

/** Parties of the default setup. Who does what is set by `ecm` and the contracts. */
export const DEFAULT_PARTIES = [
  { id: "authority", name: "Transport authority", role: "authority" },
  { id: "ru", name: "Railway undertaking", role: "operator" },
  { id: "ecm", name: "ECM company", hours: { days: "mon-fri", from: "07:00", to: "16:00" }, latency_min: 60 },
  { id: "works", name: "Workshop company", hours: { days: "mon-sat", from: "06:00", to: "22:00" }, latency_min: 30 },
];

/** The default contracts: penalties in euros. */
export const DEFAULT_CONTRACTS = [
  {
    id: "transport", name: "Transport contract", payer: "ru", payee: "authority", exempt: ["infrastructure"],
    penalties: { cancelled_km: 12, late_trip: 40, late_threshold_min: 5, short_km: 4, comfort_day: 250, no_conductor_trip: 60 },
  },
  {
    id: "availability", name: "Availability contract", payer: "ecm", payee: "ru",
    penalties: { missing_unit: 2500, hard_failure: 1200, late_release_h: 150, pass_through: 0.5 },
  },
  {
    id: "workshop", name: "Workshop contract", payer: "works", payee: "ecm",
    penalties: { late_release_h: 120, repeat_failure: 900, repeat_days: 14, pass_through: 0.5 },
  },
];

/** Defaults of every section (stations and lines come from the layout when they are missing). */
export const OPS_DEFAULTS = {
  name: "Rail operations",
  start_weekday: "mon",
  year: 2026,
  burn_in_days: 7,
  fleet: { types: [DEFAULT_VEHICLE], units: null, count: null, reserve_share: 0.15, failure_factor: 1, soft_factor: 1 },
  maintenance: {
    program: DEFAULT_PROGRAM,
    soft: DEFAULT_SOFT,
    workshop: {
      name: "Depot workshop", station: null, object: null, bays: 2, hours: "24/7", quality: 0.9, speed: 1, spread: 0.25,
      parts_p: 0.2, parts_h: 10, transfer_min: 0, findings: 0.3,
    },
    planning: { at: "13:00", strategy: "windows", early_share: 0.8, reaction_min: 20 },
    development: { extension: 0.1, grant: 0.8, approval_h: 4 },
  },
  parties: DEFAULT_PARTIES,
  ecm: { management: "ru", development: "ru", planning: "ru", delivery: "ru", data_latency_h: 0 },
  contracts: DEFAULT_CONTRACTS,
  crew: {
    base: null,
    drivers: null,
    conductors: null,
    staffing: 1.05,
    vacancies: 0,
    contracts: [
      { id: "full", name: "Full time 38 h", share: 0.7, hours_week: 38, max_duty_h: 10, min_rest_h: 11, max_days_row: 6, overtime_accept: 0.35, max_overtime_h_week: 8 },
      { id: "part", name: "Part time 25 h", share: 0.3, hours_week: 25, max_duty_h: 8, min_rest_h: 11, max_days_row: 5, overtime_accept: 0.25, max_overtime_h_week: 6 },
    ],
    sign_on_min: 15,
    sign_off_min: 10,
    transfer_min: 8,
    walk_min: 4,
    max_gap_min: 150,
    reserve: [{ from: "04:15", to: "12:15", count: 1 }, { from: "12:00", to: "20:00", count: 1 }],
    sick_rate: 0.06,
    sick_days: 4,
    sick_notice_min: 120,
    vacation_rate: 0.08,
    vacation_days: 10,
    route_knowledge: 1,
    off_layout_homes: 0.3,
    commute: { margin_min: 10, late_p: 0.03, late_min: 12, car_min: 25, walk_max_m: 500 },
    call_in: true,
  },
  dispatch: {
    wait_unit_min: 20, wait_crew_min: 15, short_wait_min: 5, pull_out_min: 15, pull_in_min: 10, stable_after_min: 40,
    delays: { p: 0.1, median_min: 2.5, sigma: 0.8, max_min: 45 }, recovery_min: 1,
  },
  costs: { driver_hour: 48, overtime_factor: 1.3, standby_factor: 0.6, workshop_hour: 95, empty_km: 6 },
  setups: [],
  stress: [],
};

/** Ready-made setups to compare (patches over the layout's settings). */
export const PRESET_SETUPS = [
  { id: "as-configured", name: "As configured", description: "The settings of the layout.", patch: {} },
  {
    id: "integrated", name: "Integrated ECM",
    description: "The railway undertaking plans and does its own maintenance in its depot, around the clock, with live mileage data.",
    patch: { ecm: { management: "ru", development: "ru", planning: "ru", delivery: "ru", data_latency_h: 0 }, maintenance: { workshop: { transfer_min: 0, hours: "24/7" } } },
  },
  {
    id: "distributed", name: "Distributed ECM",
    description: "An ECM company (office hours Mon–Fri) plans from daily mileage reports; an external workshop (Mon–Sat 06–22, 35 min away) does the work.",
    patch: {
      ecm: { management: "ecm", development: "ecm", planning: "ecm", delivery: "works", data_latency_h: 24 },
      maintenance: { workshop: { transfer_min: 35, hours: { days: "mon-sat", from: "06:00", to: "22:00" }, parts_h: 20 } },
    },
  },
  {
    id: "full-service", name: "Manufacturer full service",
    description: "The manufacturer is ECM and runs the workshop in the depot (Mon–Sat 06–22); the railway undertaking only operates.",
    patch: {
      ecm: { management: "ecm", development: "ecm", planning: "ecm", delivery: "ecm", data_latency_h: 0 },
      maintenance: { workshop: { hours: { days: "mon-sat", from: "06:00", to: "22:00" } } },
    },
  },
  {
    id: "crew-buffers", name: "Generous crew buffers",
    description: "15 min to change trains, two drivers on stand-by in each shift, 10 % more staff.",
    patch: { crew: { transfer_min: 15, staffing: 1.15, reserve: [{ from: "04:15", to: "12:15", count: 2 }, { from: "12:00", to: "20:00", count: 2 }, { from: "16:00", to: "00:30", count: 1 }] } },
  },
  {
    id: "lean-crew", name: "Lean crew planning",
    description: "5 min to change trains, no drivers on stand-by, staff sized exactly to the need.",
    patch: { crew: { transfer_min: 5, staffing: 1, reserve: [] } },
  },
];

/** Ready-made stress tests: short-term changes (events) and long-term shortages (patches). */
export const PRESET_STRESS = [
  { id: "none", name: "Normal operation", description: "No extra stress.", patch: {} },
  { id: "flu", name: "Flu wave", description: "14 % of the staff off sick, called in at short notice.", patch: { crew: { sick_rate: 0.14, sick_notice_min: 60 } } },
  { id: "shortage", name: "Long-term staff shortage", description: "12 % of the driver positions are vacant.", patch: { crew: { vacancies: 0.12 } } },
  { id: "heat", name: "Heat wave", description: "More failures, above all air conditioning.", patch: { fleet: { failure_factor: 1.3, soft_factor: 2.5 } } },
  { id: "bus-strike", name: "Bus strike", description: "Staff get to work late more often.", patch: { crew: { commute: { late_p: 0.18, late_min: 25 } } } },
  { id: "workshop-slow", name: "Workshop short of staff", description: "Every job takes 50 % longer; parts take twice as long.", patch: { maintenance: { workshop: { speed: 1.5, parts_h: 20 } } } },
  {
    id: "bad-monday", name: "Bad Monday", description: "Five sick calls before the morning peak, two breakdowns in it.",
    events: [
      { day: 0, at: "04:30", type: "sick", count: 5, notice_min: 30 },
      { day: 0, at: "07:05", type: "failure", kind: "hard" },
      { day: 0, at: "07:40", type: "failure", kind: "hard" },
    ],
  },
  { id: "unit-damage", name: "Two units damaged", description: "Two units are out of service for two weeks from day 2 (e.g. after a collision).", events: [{ day: 2, at: "06:00", type: "unit_out", count: 2, days: 14 }] },
];

/* ---------------------------------------------------------------- the network from the layout */

/** Names of the stations beyond the layout (fictional). */
const TERMINI = ["Altstadt", "Bergheim", "Talsee", "Waldau", "Kirchberg", "Neudorf", "Hafen", "Rosental", "Lindenau", "Eichwald"];

/** Line kinds by the start of the line name: headway, running time, speed, service hours, formation. */
const LINE_KINDS = [
  { re: /^S\s*\d/i, takt: 30, run: 18, spread: 8, kmh: 48, first: 290, last: 1430, turn: 6, units: 1, peak: 2 },
  { re: /^RE\b/i, takt: 60, run: 38, spread: 14, kmh: 75, first: 315, last: 1335, turn: 10, units: 1, peak: 2 },
  { re: /^(IC|ICE|EC)\b/i, takt: 120, run: 70, spread: 20, kmh: 110, first: 360, last: 1200, turn: 15, units: 1, peak: 1 },
  { re: /./, takt: 60, run: 28, spread: 12, kmh: 58, first: 300, last: 1380, turn: 8, units: 1, peak: 1 },
];

/** Dock ids of a platform spec (the docks `Platform.stopAreas` makes). */
export function platformDocks(spec) {
  const sides = spec.sides || "both";
  const out = [];
  if (sides === "both" || sides === "left") out.push(`${spec.id}:left`);
  if (sides === "both" || sides === "right") out.push(`${spec.id}:right`);
  return out;
}

const splitLines = (text) => String(text || "").split(",").map((s) => s.trim()).filter(Boolean);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "line";

/**
 * Stations and lines from the platforms of a layout: all platforms form one station; every line
 * named on a platform runs from it to a station beyond the layout and back.
 * @param {object} layout normalized layout
 * @returns {{stations: object[], lines: object[]}}
 */
export function autoNetwork(layout) {
  const platforms = (layout?.objects || []).filter((o) => o?.type === "platform" && (o.sides ?? "both") !== "none" && o.id);
  if (!platforms.length) return { stations: [], lines: [] };
  const hub = { id: "station", name: "Station", platforms: platforms.map((p) => p.id) };
  const names = [], docksOf = new Map();
  platforms.forEach((p, i) => {
    const own = splitLines(p.lines);
    for (const l of own.length ? own : [`RB ${i + 1}`]) {
      if (!names.includes(l)) names.push(l);
      docksOf.set(l, [...(docksOf.get(l) || []), ...platformDocks(p)]);
    }
  });
  const stations = [hub], lines = [];
  const used = new Set();
  names.forEach((name, i) => {
    const k = LINE_KINDS.find((x) => x.re.test(name));
    const h = hashKey("line", name);
    let id = `${slug(name)}-end`;
    while (used.has(id)) id += "-2";
    used.add(id);
    stations.push({ id, name: TERMINI[i % TERMINI.length] });
    const run = k.run + (h % (k.spread + 1));
    lines.push({
      id: name, route: [hub.id, id], run_min: run, km: Math.round((run * k.kmh) / 60), turn_min: k.turn, takt_min: k.takt,
      first: k.first + ((i * 7) % k.takt), last: k.last + ((i * 7) % k.takt), units: k.units, peak_units: k.peak,
      docks: { [hub.id]: docksOf.get(name) },
    });
  });
  return { stations, lines };
}

/* ---------------------------------------------------------------- normalization */

const list = (v) => (Array.isArray(v) ? v : []);
const minutes = (v, fallback) => clockMinutes(v) ?? fallback;
const segmentList = (v, n, fallback) => {
  if (Array.isArray(v)) return Array.from({ length: n }, (_, i) => num(v[i] ?? v[v.length - 1], fallback, 0.5));
  return Array.from({ length: n }, () => num(v, fallback, 0.5));
};

/**
 * The settings with all defaults, the network from the layout where it is missing, times in
 * minutes and day sets as sets. Never throws; what cannot be used is left out (validate reports it).
 * @param {object} config the simulation entry
 * @param {object} [layout] the normalized layout (for the platforms)
 */
export function normalizeOps(config = {}, layout = null) {
  const c = deepMerge(OPS_DEFAULTS, isObject(config) ? withoutType(config) : {});
  const auto = autoNetwork(layout);
  const stationsIn = Array.isArray(config?.stations) ? config.stations : auto.stations;
  const linesIn = Array.isArray(config?.lines) ? config.lines : auto.lines;
  const objects = new Map((layout?.objects || []).filter((o) => o?.id).map((o) => [o.id, o]));

  // stations: on the layout when they have platforms
  const stations = [];
  for (const s of stationsIn) {
    if (!isObject(s) || typeof s.id !== "string" || !s.id || stations.some((x) => x.id === s.id)) continue;
    const platforms = list(s.platforms).filter((id) => typeof id === "string");
    const docks = platforms.flatMap((id) => (objects.get(id)?.type === "platform" ? platformDocks(objects.get(id)) : []));
    const tracks = Math.round(num(s.tracks, docks.length || 2, 1, 20));
    stations.push({
      id: s.id, name: String(s.name || s.id), on_layout: platforms.length > 0, platforms,
      docks: docks.length ? docks : platforms.length ? Array.from({ length: tracks }, (_, i) => `${s.id}:track-${i + 1}`) : [],
    });
  }
  const stationIds = new Set(stations.map((s) => s.id));
  const firstOnLayout = stations.find((s) => s.on_layout)?.id ?? stations[0]?.id ?? null;

  // vehicle types
  const types = [];
  for (const t of list(c.fleet.types)) {
    if (!isObject(t) || typeof t.id !== "string" || !t.id || types.some((x) => x.id === t.id)) continue;
    const merged = deepMerge(DEFAULT_VEHICLE, t);
    types.push({ ...merged, failure: { ...DEFAULT_VEHICLE.failure, ...(isObject(t.failure) ? t.failure : {}) }, program: normalizeProgram(t.program ?? c.maintenance.program) });
  }
  if (!types.length) types.push({ ...structuredClone(DEFAULT_VEHICLE), program: normalizeProgram(c.maintenance.program) });
  const typeIds = new Set(types.map((t) => t.id));

  // lines
  const lines = [];
  for (const l of linesIn) {
    if (!isObject(l) || l.id == null || lines.some((x) => x.id === String(l.id))) continue;
    const route = list(l.route).map(String).filter((id) => stationIds.has(id));
    if (route.length < 2 || new Set(route).size !== route.length) continue;
    const n = route.length - 1;
    const takt = num(l.takt_min, 60, 5, 720);
    const first = minutes(l.first, 300), lastRaw = minutes(l.last, 1380);
    const last = lastRaw < first ? lastRaw + DAY : lastRaw;
    const docks = {};
    for (const sid of route) {
      const st = stations.find((s) => s.id === sid);
      if (!st.on_layout) continue;
      const wanted = list(isObject(l.docks) ? l.docks[sid] : null).filter((d) => st.docks.includes(d));
      docks[sid] = wanted.length ? wanted : st.docks.slice();
    }
    const units = Math.round(num(l.units, 1, 1, 4));
    lines.push({
      id: String(l.id), name: String(l.name || l.id), route,
      run_min: segmentList(l.run_min, n, 30), km: segmentList(l.km, n, 30),
      dwell_min: num(l.dwell_min, 1, 0, 30), turn_min: num(l.turn_min, 8, 1, 120), takt_min: takt, first, last,
      back_first: l.back_first != null ? minutes(l.back_first, null) : null,
      vehicle: typeIds.has(l.vehicle) ? l.vehicle : types[0].id,
      units, peak_units: Math.max(units, Math.round(num(l.peak_units, units, 1, 4))),
      peak: list(l.peak ?? [["06:00", "08:30"], ["15:30", "18:30"]]).filter((p) => Array.isArray(p) && p.length === 2)
        .map(([a, b]) => [minutes(a, 0), minutes(b, 0)]).filter(([a, b]) => b > a),
      days: weekdaySet(l.days) ?? new Set([0, 1, 2, 3, 4, 5, 6]),
      peak_days: weekdaySet(l.peak_days ?? "mon-fri") ?? new Set([0, 1, 2, 3, 4]),
      docks, conductor: l.conductor === true,
    });
  }

  const fleet = c.fleet;
  const units = [];
  for (const u of list(fleet.units)) {
    if (!isObject(u) || u.id == null || units.some((x) => x.id === String(u.id))) continue;
    units.push({ id: String(u.id), type: typeIds.has(u.type) ? u.type : types[0].id, built: num(u.built, 2012, 1950, 2100), km: num(u.km, 0, 0), since: isObject(u.since) ? u.since : null });
  }

  const w = c.maintenance.workshop;
  const parties = [];
  for (const p of list(c.parties)) {
    if (!isObject(p) || typeof p.id !== "string" || !p.id || parties.some((x) => x.id === p.id)) continue;
    parties.push({ id: p.id, name: String(p.name || p.id), role: p.role || null, hours: normalizeHours(p.hours), latency_min: num(p.latency_min, 0, 0, 10080) });
  }
  if (!parties.some((p) => p.role === "operator")) parties.unshift({ id: "ru", name: "Railway undertaking", role: "operator", hours: { always: true }, latency_min: 0 });
  const operator = parties.find((p) => p.role === "operator").id;
  const partyIds = new Set(parties.map((p) => p.id));
  const role = (v) => (partyIds.has(v) ? v : operator);
  const ecm = {
    management: role(c.ecm.management), development: role(c.ecm.development), planning: role(c.ecm.planning), delivery: role(c.ecm.delivery),
    data_latency_h: num(c.ecm.data_latency_h, 0, 0, 24 * 14),
  };

  const crew = c.crew;
  const contracts = list(crew.contracts).filter((k) => isObject(k) && k.id).map((k) => ({
    id: String(k.id), name: String(k.name || k.id), share: num(k.share, 1, 0),
    hours_week: num(k.hours_week, 38, 4, 60), max_duty_h: num(k.max_duty_h, 10, 3, 14), min_rest_h: num(k.min_rest_h, 11, 6, 24),
    max_days_row: Math.round(num(k.max_days_row, 6, 1, 13)), overtime_accept: num(k.overtime_accept, 0.3, 0, 1),
    max_overtime_h_week: num(k.max_overtime_h_week, 8, 0, 40), earliest: k.earliest != null ? minutes(k.earliest, null) : null,
    latest_end: k.latest_end != null ? minutes(k.latest_end, null) : null,
  }));

  return {
    name: String(c.name || OPS_DEFAULTS.name),
    seed: c.seed != null ? num(c.seed, null) : null,
    start_weekday: weekdayIndex(c.start_weekday, 0),
    year: num(c.year, 2026, 1950, 2100),
    burn_in_days: Math.round(num(c.burn_in_days, 7, 0, 60)),
    stations, lines, types,
    fleet: {
      units, count: fleet.count != null ? Math.round(num(fleet.count, 0, 0, 500)) : null, reserve_share: num(fleet.reserve_share, 0.15, 0, 2),
      failure_factor: num(fleet.failure_factor, 1, 0, 20), soft_factor: num(fleet.soft_factor, 1, 0, 20),
    },
    maintenance: {
      soft: list(c.maintenance.soft).filter((s) => isObject(s) && s.id).map((s) => ({
        id: String(s.id), label: String(s.label || s.id), share: num(s.share, 1, 0), repair_h: num(s.repair_h, 1, 0.1, 200),
        delay_min: num(s.delay_min, 0, 0, 60), deadline_h: s.deadline_h != null ? num(s.deadline_h, null, 1) : null, comfort: s.comfort === true,
      })),
      workshop: {
        name: String(w.name || "Workshop"), station: stationIds.has(w.station) ? w.station : firstOnLayout, object: typeof w.object === "string" ? w.object : null,
        bays: Math.round(num(w.bays, 2, 1, 12)), hours: normalizeHours(w.hours), quality: num(w.quality, 0.9, 0, 1), speed: num(w.speed, 1, 0.2, 5),
        spread: num(w.spread, 0.25, 0, 2), parts_p: num(w.parts_p, 0.2, 0, 1), parts_h: num(w.parts_h, 10, 0, 2000),
        transfer_min: num(w.transfer_min, 0, 0, 600), findings: num(w.findings, 0.3, 0, 3),
      },
      planning: {
        at: minutes(c.maintenance.planning.at, 780) % DAY, strategy: c.maintenance.planning.strategy === "late" ? "late" : "windows",
        early_share: num(c.maintenance.planning.early_share, 0.8, 0.3, 1), reaction_min: num(c.maintenance.planning.reaction_min, 20, 0, 1440),
      },
      development: {
        extension: num(c.maintenance.development.extension, 0.1, 0, 1), grant: num(c.maintenance.development.grant, 0.8, 0, 1),
        approval_h: num(c.maintenance.development.approval_h, 4, 0, 500),
      },
    },
    parties, operator, ecm,
    contracts: list(c.contracts).filter((k) => isObject(k) && k.id && partyIds.has(k.payer) && partyIds.has(k.payee) && k.payer !== k.payee).map((k) => ({
      id: String(k.id), name: String(k.name || k.id), payer: k.payer, payee: k.payee, exempt: list(k.exempt).map(String),
      penalties: Object.fromEntries(Object.entries(isObject(k.penalties) ? k.penalties : {}).map(([key, v]) => [key, num(v, 0, 0)])),
    })),
    crew: {
      base: stationIds.has(crew.base) ? crew.base : firstOnLayout,
      drivers: crew.drivers != null ? Math.round(num(crew.drivers, 0, 0, 2000)) : null,
      conductors: crew.conductors != null ? Math.round(num(crew.conductors, 0, 0, 2000)) : null,
      staffing: num(crew.staffing, 1.05, 0.3, 3), vacancies: num(crew.vacancies, 0, 0, 0.9),
      contracts: contracts.length ? contracts : [{ id: "full", name: "Full time", share: 1, hours_week: 38, max_duty_h: 10, min_rest_h: 11, max_days_row: 6, overtime_accept: 0.3, max_overtime_h_week: 8, earliest: null, latest_end: null }],
      sign_on_min: num(crew.sign_on_min, 15, 0, 120), sign_off_min: num(crew.sign_off_min, 10, 0, 120),
      transfer_min: num(crew.transfer_min, 8, 0, 120), walk_min: num(crew.walk_min, 4, 0, 60), max_gap_min: num(crew.max_gap_min, 150, 15, 600),
      reserve: list(crew.reserve).filter((r) => isObject(r)).map((r) => {
        const from = minutes(r.from, 240), to = minutes(r.to, 720);
        return { from, to: to <= from ? to + DAY : to, count: Math.round(num(r.count, 1, 0, 50)) };
      }).filter((r) => r.count > 0),
      sick_rate: num(crew.sick_rate, 0.06, 0, 0.9), sick_days: num(crew.sick_days, 4, 1, 120), sick_notice_min: num(crew.sick_notice_min, 120, 0, 1440),
      vacation_rate: num(crew.vacation_rate, 0.08, 0, 0.5), vacation_days: Math.round(num(crew.vacation_days, 10, 1, 60)),
      route_knowledge: num(crew.route_knowledge, 1, 0, 1), off_layout_homes: num(crew.off_layout_homes, 0.3, 0, 1),
      commute: {
        margin_min: num(crew.commute?.margin_min, 10, 0, 120), late_p: num(crew.commute?.late_p, 0.03, 0, 1), late_min: num(crew.commute?.late_min, 12, 0, 600),
        car_min: num(crew.commute?.car_min, 25, 1, 240), walk_max_m: num(crew.commute?.walk_max_m, 500, 0, 100000),
      },
      call_in: crew.call_in !== false,
    },
    dispatch: {
      wait_unit_min: num(c.dispatch.wait_unit_min, 20, 0, 240), wait_crew_min: num(c.dispatch.wait_crew_min, 15, 0, 240),
      short_wait_min: num(c.dispatch.short_wait_min, 5, 0, 60), pull_out_min: num(c.dispatch.pull_out_min, 15, 0, 240),
      pull_in_min: num(c.dispatch.pull_in_min, 10, 0, 240), stable_after_min: num(c.dispatch.stable_after_min, 40, 5, 1440),
      delays: {
        p: num(c.dispatch.delays?.p, 0.1, 0, 1), median_min: num(c.dispatch.delays?.median_min, 2.5, 0, 120),
        sigma: num(c.dispatch.delays?.sigma, 0.8, 0, 3), max_min: num(c.dispatch.delays?.max_min, 45, 0, 600),
      },
      recovery_min: num(c.dispatch.recovery_min, 1, 0, 30),
    },
    costs: Object.fromEntries(Object.entries(isObject(c.costs) ? c.costs : {}).map(([k, v]) => [k, num(v, 0, 0)])),
    setups: list(c.setups).filter((s) => isObject(s) && s.id),
    stress: list(c.stress).filter((s) => isObject(s) && s.id),
  };
}

function withoutType(config) {
  const { type, enabled, ...rest } = config;
  return rest;
}

/** A maintenance programme with numbers, highest level last; levels without an interval are left out. */
export function normalizeProgram(program) {
  const levels = list(program).filter((l) => isObject(l) && l.id && (Number(l.every_km) > 0 || Number(l.every_days) > 0)).map((l) => ({
    id: String(l.id), name: String(l.name || l.id),
    every_km: Number(l.every_km) > 0 ? Number(l.every_km) : null, every_days: Number(l.every_days) > 0 ? Number(l.every_days) : null,
    hours: num(l.hours, 4, 0.1, 2000), tolerance: num(l.tolerance, 0.1, 0, 1), wear_reset: num(l.wear_reset, 0.6, 0, 1),
    includes: list(l.includes).map(String),
  }));
  // a level that includes another one comes after it
  return levels.sort((a, b) => a.includes.length - b.includes.length);
}

/* ---------------------------------------------------------------- setups and stress tests */

/**
 * The settings of one run: the layout's settings, a setup's patch and a stress test's patch.
 * @param {object} config the simulation entry
 * @param {{patch?: object} | null} setup
 * @param {{patch?: object} | null} stress
 */
export function applySetup(config, setup, stress) {
  let out = deepMerge({}, config || {});
  if (isObject(setup?.patch)) out = deepMerge(out, setup.patch);
  if (isObject(stress?.patch)) out = deepMerge(out, stress.patch);
  return out;
}

/** The setups offered for comparison: the layout's own, else the presets. */
export function setupsOf(config) {
  const own = list(config?.setups).filter((s) => isObject(s) && s.id);
  return own.length ? [{ ...PRESET_SETUPS[0] }, ...own.filter((s) => s.id !== PRESET_SETUPS[0].id)] : PRESET_SETUPS.map((s) => ({ ...s }));
}

/** The stress tests offered: the presets and the layout's own. */
export function stressOf(config) {
  const own = list(config?.stress).filter((s) => isObject(s) && s.id);
  const ids = new Set(own.map((s) => s.id));
  return [...PRESET_STRESS.filter((s) => !ids.has(s.id)), ...own];
}

/* ---------------------------------------------------------------- validation */

const EVENT_TYPES = ["sick", "failure", "unit_out", "staff_loss", "workshop_closed", "station_closed", "delay"];

/**
 * Problems of an operations entry, in plain words (validateLayout prefixes them).
 * @param {object} cfg the entry as written in the file
 * @param {object} layout the normalized layout
 * @returns {string[]}
 */
export function validateOps(cfg, layout) {
  const problems = [];
  const objects = new Map((layout?.objects || []).map((o) => [o.id, o]));
  const stations = Array.isArray(cfg.stations) ? cfg.stations : null;
  const ids = new Set();
  if (cfg.stations != null && !stations) problems.push("stations must be a list");
  (stations || []).forEach((s, i) => {
    if (!isObject(s) || typeof s.id !== "string" || !s.id) return problems.push(`stations[${i}] needs an id`);
    if (ids.has(s.id)) problems.push(`stations[${i}]: duplicate id "${s.id}"`);
    ids.add(s.id);
    for (const p of list(s.platforms)) {
      if (!objects.has(p)) problems.push(`stations[${i}] (${s.id}): no object "${p}" on the layout`);
    }
  });
  const stationIds = stations ? ids : new Set(autoNetwork(layout).stations.map((s) => s.id));
  const types = new Set(list(cfg.fleet?.types).filter(isObject).map((t) => t.id));
  if (!types.size) types.add(DEFAULT_VEHICLE.id);
  if (cfg.lines != null && !Array.isArray(cfg.lines)) problems.push("lines must be a list");
  list(cfg.lines).forEach((l, i) => {
    const name = `lines[${i}]${isObject(l) && l.id != null ? ` (${l.id})` : ""}`;
    if (!isObject(l) || l.id == null) return problems.push(`lines[${i}] needs an id`);
    const route = list(l.route);
    if (route.length < 2) problems.push(`${name}: route needs at least two stations`);
    for (const s of route) if (!stationIds.has(s)) problems.push(`${name}: no station "${s}"`);
    if (new Set(route).size !== route.length) problems.push(`${name}: a station appears twice in the route`);
    for (const key of ["first", "last", "back_first"]) if (l[key] != null && clockMinutes(l[key]) == null) problems.push(`${name}: ${key} must be a time like "05:30"`);
    if (l.takt_min != null && !(Number(l.takt_min) >= 5)) problems.push(`${name}: takt_min must be at least 5`);
    if (l.vehicle != null && !types.has(l.vehicle)) problems.push(`${name}: no vehicle type "${l.vehicle}"`);
    if (l.days != null && !weekdaySet(l.days)) problems.push(`${name}: days must be like "mon-fri" or "sat,sun"`);
    if (isObject(l.docks)) {
      for (const [sid, docks] of Object.entries(l.docks)) {
        for (const d of list(docks)) {
          const [obj] = String(d).split(":");
          if (!objects.has(obj)) problems.push(`${name}: dock "${d}" at ${sid} is not a platform track of the layout`);
        }
      }
    }
  });
  const parties = list(cfg.parties).length ? list(cfg.parties) : DEFAULT_PARTIES;
  const partyIds = new Set(parties.filter(isObject).map((p) => p.id));
  for (const [fn, party] of Object.entries(isObject(cfg.ecm) ? cfg.ecm : {})) {
    if (fn !== "data_latency_h" && !partyIds.has(party)) problems.push(`ecm.${fn}: no party "${party}"`);
  }
  list(cfg.contracts).forEach((k, i) => {
    if (!isObject(k)) return problems.push(`contracts[${i}] is not an object`);
    for (const key of ["payer", "payee"]) if (!partyIds.has(k[key])) problems.push(`contracts[${i}] (${k.id}): no party "${k[key]}" as ${key}`);
    if (k.payer === k.payee) problems.push(`contracts[${i}] (${k.id}): payer and payee are the same party`);
  });
  const w = cfg.maintenance?.workshop;
  if (isObject(w)) {
    if (w.station != null && !stationIds.has(w.station)) problems.push(`maintenance.workshop.station: no station "${w.station}"`);
    if (w.object != null && objects.get(w.object)?.type !== "depot") problems.push(`maintenance.workshop.object: "${w.object}" is not a depot on the layout`);
  }
  if (cfg.crew?.base != null && !stationIds.has(cfg.crew.base)) problems.push(`crew.base: no station "${cfg.crew.base}"`);
  for (const key of ["setups", "stress"]) {
    list(cfg[key]).forEach((s, i) => {
      if (!isObject(s) || !s.id) return problems.push(`${key}[${i}] needs an id`);
      if (s.patch != null && !isObject(s.patch)) problems.push(`${key}[${i}] (${s.id}): patch must be an object`);
      list(s.events).forEach((e, j) => {
        if (!isObject(e) || !EVENT_TYPES.includes(e.type)) problems.push(`${key}[${i}] (${s.id}): events[${j}] needs a type (${EVENT_TYPES.join(", ")})`);
      });
    });
  }
  return problems;
}
