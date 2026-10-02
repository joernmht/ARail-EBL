/**
 * Comparing setups: every setup (a patch of the settings: who does which ECM function, crew buffers,
 * the workshop, …) is run under the same stress test for a number of days and with several random
 * seeds, after the burn-in days. The same seed gives the same random events in every setup where
 * the same things happen (failures by unit and trip, sickness by person and day, …), so differences
 * come from the setups, not from luck.
 *
 *   for await (const step of runExperiment({ config, layout, setups, stress, days: 28, seeds: [1, 2, 3] })) {
 *     if (step.done) console.table(step.result.rows);
 *   }
 * @module arail/ops/experiment
 */
import { applySetup, setupsOf, stressOf } from "./config.js";
import { OpsEngine } from "./engine.js";
import { CAUSE_LABELS } from "./contracts.js";
import { DAY } from "./util.js";

/**
 * Key figures: [key, label, unit, better] (better: "low" or "high", for highlighting; "" where neither is better); the values come
 * from `kpis()`.
 */
export const KPIS = [
  ["cancelledPct", "Trains cancelled", "%", "low"],
  ["punctualPct", "Punctual (< 5 min late)", "%", "high"],
  ["avgDelay", "Average delay", "min", "low"],
  ["shortPct", "Trains too short", "%", "low"],
  ["kmLostPct", "Train-km lost", "%", "low"],
  ["availabilityPct", "Units available", "%", "high"],
  ["workshopPct", "Units in the workshop", "%", "low"],
  ["hardFailures", "Hard failures", "", "low"],
  ["softFailures", "Defects", "", "low"],
  ["mdbf", "Km between hard failures", "km", "high"],
  ["missingUnits", "Units short at the first pull-out", "", "low"],
  ["lateReleases", "Workshop jobs late", "", "low"],
  ["sickCalls", "Sick calls", "", "low"],
  ["dutiesUncovered", "Duties nobody could take", "", "low"],
  ["coveredByReserve", "Taken over by stand-by", "", ""],
  ["coveredByCallIn", "Called in on a free day", "", "low"],
  ["lateSignOns", "Late to work", "", "low"],
  ["overtimeH", "Overtime (late trains)", "h", "low"],
  ["weekOvertimeH", "Hours above contracts", "h", "low"],
  ["restConflicts", "Rest time cut short", "", "low"],
  ["drivers", "Drivers employed", "", ""],
  ["penaltyAuthority", "Penalties to the authority", "€", "low"],
  ["crewCost", "Crew cost", "€", "low"],
  ["workshopCost", "Workshop cost", "€", "low"],
];

/**
 * Key figures of one engine over days [from, to) (default: the measured days up to yesterday).
 * Penalties count until 04:00 after the last day (its trips after midnight).
 */
export function kpis(engine, { from = engine.measureFrom, to = engine.today } = {}) {
  const t = engine.totals({ from, to });
  const pen = engine.penalties({ from: from * DAY, to: to * DAY + 240 });
  const costs = engine.model.costs;
  const pct = (a, b) => (b > 0 ? (100 * a) / b : 0);
  const authority = engine.ledger.authorityContract()?.id;
  const out = {
    days: t.days,
    trips: t.trips,
    cancelledPct: pct(t.tripsCancelled + t.tripsTerminated, t.trips),
    punctualPct: pct(t.onTime, t.tripsRun),
    avgDelay: t.tripsRun ? t.delayMin / t.tripsRun : 0,
    shortPct: pct(t.tripsShort, t.trips),
    kmLostPct: pct(t.kmCancelled, t.kmPlanned),
    availabilityPct: pct(t.unitMinAvailable + t.unitMinService, t.unitMinTotal),
    workshopPct: pct(t.unitMinWorkshop, t.unitMinTotal),
    hardFailures: t.hardFailures,
    softFailures: t.softFailures,
    mdbf: t.hardFailures ? t.kmRun / t.hardFailures : t.kmRun,
    missingUnits: t.missingUnits,
    lateReleases: t.jobsLate,
    sickCalls: t.sickCalls,
    dutiesUncovered: t.dutiesUncovered,
    coveredByReserve: t.coveredByReserve,
    coveredByCallIn: t.coveredByCallIn,
    lateSignOns: t.lateSignOns,
    overtimeH: t.overtimeMin / 60,
    weekOvertimeH: weekOvertime(engine, from, to) / 60,
    restConflicts: t.restConflicts,
    drivers: [...engine.desk.people.values()].filter((p) => p.role === "driver" && (p.left == null || p.left > to)).length,
    penaltyAuthority: authority ? pen.byContract[authority] || 0 : 0,
    crewCost: (t.paidMin / 60) * (costs.driver_hour || 0) + (t.overtimeMin / 60) * (costs.driver_hour || 0) * Math.max(0, (costs.overtime_factor || 1) - 1),
    workshopCost: (t.workshopMin / 60) * (costs.workshop_hour || 0) + t.emptyKm * (costs.empty_km || 0),
    parties: pen.parties,
    penaltiesByContract: pen.byContract,
    penaltiesByCause: pen.byCause,
    cancelByCause: t.byCause.cancel,
    delayByCause: t.byCause.delay,
  };
  return out;
}

/**
 * Minutes worked above the contracts' weekly hours over days [from, to) (weeks cut by the range
 * count with their share of the hours).
 */
export function weekOvertime(engine, from, to) {
  const desk = engine.desk;
  let sum = 0;
  for (const p of desk.people.values()) {
    const weeks = new Map();
    for (let d = from; d < to; d++) weeks.set(desk.weekOf(d), (weeks.get(desk.weekOf(d)) || 0) + 1);
    for (const [w, days] of weeks) {
      const worked = (p.week.get(w) || 0) * (days / 7);
      sum += Math.max(0, worked - p.contract.hours_week * 60 * (days / 7));
    }
  }
  return sum;
}

/**
 * One run: a setup under a stress test for `days` measured days.
 * @param {object} config the `operations` entry
 * @param {{layout?: object, setup?: object, stress?: object, days?: number, seed?: number, homes?: object[]}} o
 * @returns {{kpi: object, daily: object[], engine: OpsEngine}}
 */
export function runOne(config, { layout = null, setup = null, stress = null, days = 28, seed = 1, homes = [] } = {}) {
  const engine = new OpsEngine(applySetup(config, setup, stress), { layout, seed, homes });
  engine.runTo(engine.dayOffset * DAY);
  engine.measureFrom = engine.dayOffset;
  engine.scheduleStress(stress?.events || []);
  engine.runTo((engine.dayOffset + days) * DAY);
  // the trips after midnight of the last day are part of it
  const end = engine.dayOffset + days;
  engine.runTo(end * DAY + 240);
  const daily = [];
  for (let d = engine.dayOffset; d < engine.dayOffset + days; d++) {
    const x = engine.daily.get(d);
    if (!x) continue;
    daily.push({ day: d - engine.dayOffset, trips: x.trips, cancelled: x.tripsCancelled + x.tripsTerminated, late: x.late, short: x.tripsShort, sick: x.sickCalls, hard: x.hardFailures });
  }
  const kpi = kpis(engine, { from: engine.dayOffset, to: end });
  return { kpi, daily, engine };
}

/**
 * Run setups × seeds under one stress test, yielding progress; the last step has `done: true` and
 * the `result`.
 * @param {object} o
 * @param {object} o.config the `operations` entry
 * @param {object} [o.layout] normalized layout
 * @param {object[]} [o.setups] setups to compare (default: the layout's or the presets)
 * @param {object} [o.stress] the stress test (default: none)
 * @param {number} [o.days] measured days per run
 * @param {number[]} [o.seeds] one run per seed and setup
 * @param {object[]} [o.homes] buildings where crews live (see OpsEngine)
 */
export async function* runExperiment({ config, layout = null, setups = null, stress = null, days = 28, seeds = [1, 2, 3], homes = [] }) {
  const list = setups && setups.length ? setups : setupsOf(config);
  const runs = list.length * seeds.length;
  const results = [];
  let n = 0;
  for (const setup of list) {
    const per = [];
    for (const seed of seeds) {
      yield { done: false, progress: n / runs, setup: setup.id, seed };
      const { kpi, daily } = runOne(config, { layout, setup, stress, days, seed, homes });
      per.push({ kpi, daily });
      n++;
      // let the page draw between runs
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    results.push({ setup, runs: per });
  }
  yield { done: true, progress: 1, result: summarize(results, { days, seeds, stress }) };
}

/** Mean, minimum and maximum of each key figure per setup; parties' net results; daily series. */
export function summarize(results, { days, seeds, stress }) {
  const rows = results.map(({ setup, runs }) => {
    const values = {};
    for (const [key] of KPIS) {
      const xs = runs.map((r) => r.kpi[key]);
      values[key] = { mean: xs.reduce((s, v) => s + v, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs) };
    }
    const parties = {};
    for (const r of runs) {
      for (const [id, p] of Object.entries(r.kpi.parties)) {
        parties[id] ||= { paid: 0, received: 0, net: 0 };
        for (const k of ["paid", "received", "net"]) parties[id][k] += p[k] / runs.length;
      }
    }
    const causes = {};
    for (const r of runs) for (const [k, v] of Object.entries(r.kpi.penaltiesByCause)) causes[k] = (causes[k] || 0) + v / runs.length;
    const cancel = {};
    for (const r of runs) for (const [k, v] of Object.entries(r.kpi.cancelByCause)) cancel[k] = (cancel[k] || 0) + v / runs.length;
    const daily = runs[0]?.daily.map((d, i) => ({
      day: d.day,
      cancelled: runs.reduce((s, r) => s + (r.daily[i]?.cancelled || 0), 0) / runs.length,
      late: runs.reduce((s, r) => s + (r.daily[i]?.late || 0), 0) / runs.length,
      trips: d.trips,
    })) || [];
    return { id: setup.id, name: setup.name || setup.id, description: setup.description || "", values, parties, penaltiesByCause: causes, cancelByCause: cancel, daily };
  });
  return { days, seeds: seeds.length, stress: stress ? { id: stress.id, name: stress.name || stress.id } : null, rows };
}

/** The comparison as CSV (one line per setup and key figure; mean, min, max). */
export function toCSV(result) {
  const lines = ["setup,key,label,unit,mean,min,max"];
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  for (const row of result.rows) {
    for (const [key, label, unit] of KPIS) {
      const v = row.values[key];
      lines.push([q(row.name), key, q(label), q(unit), v.mean.toFixed(3), v.min.toFixed(3), v.max.toFixed(3)].join(","));
    }
    for (const [party, p] of Object.entries(row.parties)) lines.push([q(row.name), `net:${party}`, q(`Net penalties of ${party}`), "€", p.net.toFixed(2), "", ""].join(","));
  }
  return `${lines.join("\n")}\n`;
}

/** "unit failure (transport)" for a `contract|cause` key. */
export function causeKeyLabel(key) {
  const [contract, cause] = key.split("|");
  return `${CAUSE_LABELS[cause] || cause} (${contract})`;
}

export { setupsOf, stressOf };
