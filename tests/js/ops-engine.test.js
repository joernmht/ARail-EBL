// The operations engine without the world: settings, timetable and rotations, duties, working
// hours, failures, maintenance and the ECM functions, crews, contracts and penalties, stress
// tests and comparisons.
import assert from "node:assert/strict";
import test from "node:test";

import {
  OpsEngine, Ledger, addWork, autoNetwork, buildDuties, deadheadMin, expectedFailures, kpis, nextOpen, normalizeHours, normalizeOps,
  planPieces, planRotations, runExperiment, runOne, toCSV, tripTemplates, validateOps, workBetween, WORK_RULES, PRESET_SETUPS, PRESET_STRESS,
  normalizeLayout,
} from "../../web/arail/index.js";
import { readJSON } from "./helpers.js";

const LAB = normalizeLayout(readJSON("web/layouts/ebl-lab.json"));
const DAY = 1440;
const setup = (id) => PRESET_SETUPS.find((s) => s.id === id);
const stress = (id) => PRESET_STRESS.find((s) => s.id === id);

/* ---------------------------------------------------------------- settings and timetable */

test("ops settings: the network comes from the platforms and their lines", () => {
  const net = autoNetwork(LAB);
  assert.equal(net.stations[0].id, "station");
  assert.deepEqual(net.stations[0].platforms, ["platform-1", "platform-2"]);
  assert.deepEqual(net.lines.map((l) => l.id), ["RE 1", "RB 33", "S 2", "S 8"]);
  const m = normalizeOps({}, LAB);
  assert.equal(m.stations.length, 5, "the station on the layout and one beyond it per line");
  assert.ok(m.stations[0].on_layout && m.stations.slice(1).every((s) => !s.on_layout));
  const s2 = m.lines.find((l) => l.id === "S 2");
  assert.equal(s2.takt_min, 30, "S lines every 30 minutes");
  assert.deepEqual(s2.docks.station, ["platform-2:left", "platform-2:right"], "S 2 stops at platform 2, where it is named");
  assert.equal(m.maintenance.workshop.station, "station");
  assert.equal(m.crew.base, "station");
  assert.deepEqual(validateOps({}, LAB), []);
});

test("ops settings: problems are reported in plain words", () => {
  const problems = validateOps({
    stations: [{ id: "a", platforms: ["nope"] }, { id: "a" }],
    lines: [{ id: "X", route: ["a"], first: "25:99" }, { id: "Y", route: ["a", "zz"], vehicle: "tram" }],
    ecm: { planning: "nobody" },
    contracts: [{ id: "c", payer: "ru", payee: "ru" }],
    maintenance: { workshop: { object: "platform-1" } },
    stress: [{ id: "s", events: [{ type: "earthquake" }] }],
  }, LAB);
  const text = problems.join("\n");
  for (const part of ['no object "nope"', 'duplicate id "a"', "route needs at least two stations", "first must be a time", 'no station "zz"', 'no vehicle type "tram"', 'ecm.planning: no party "nobody"', "payer and payee are the same party", "is not a depot", "needs a type"]) {
    assert.ok(text.includes(part), `${part} in:\n${text}`);
  }
});

test("timetable: trips out and back, peaks with two units, rotations that start and end at the depot", () => {
  const m = normalizeOps({}, LAB);
  const monday = tripTemplates(m, 0), saturday = tripTemplates(m, 5);
  assert.equal(monday.length, saturday.length, "the same trains every day");
  assert.ok(monday.some((t) => t.units === 2) && !saturday.some((t) => t.units === 2), "two units in the weekday peaks only");
  const s2 = monday.filter((t) => t.line === "S 2");
  const out = s2.filter((t) => t.dir > 0), back = s2.filter((t) => t.dir < 0);
  assert.equal(out.length, back.length);
  assert.equal(out[1].dep - out[0].dep, 30);
  assert.equal(back[0].dep, out[0].arr + m.lines.find((l) => l.id === "S 2").turn_min, "the first train turns at the far end");
  const rotations = planRotations(m, monday, "station");
  const byKey = new Map(monday.map((t) => [t.key, t]));
  for (const t of monday) assert.equal(t.rotations.length, t.units, `${t.key}: one rotation per unit`);
  for (const r of rotations) {
    const trips = r.trips.map((k) => byKey.get(k));
    for (let i = 1; i < trips.length; i++) {
      assert.equal(trips[i].from, trips[i - 1].to, `${r.id}: a unit goes on from where it arrived`);
      assert.ok(trips[i].dep >= trips[i - 1].arr + m.lines.find((l) => l.id === trips[i - 1].line).turn_min, `${r.id}: turnaround`);
    }
    assert.ok(r.pullOut < trips[0].dep && r.pullIn > trips[trips.length - 1].arr);
  }
  assert.ok(rotations.length < planRotations(m, saturday, "station").length * 2, "peak units are added, not whole rotations");
  // units for the peaks wait at the depot between the peaks (windows for maintenance)
  assert.ok(rotations.some((r) => r.layovers.some((l) => l.to - l.from > 300)));
});

test("duties: pieces of the leading unit only, the working-time rules and the longest duty", () => {
  const m = normalizeOps({}, LAB);
  const trips = tripTemplates(m, 0), byKey = new Map(trips.map((t) => [t.key, t]));
  const rotations = planRotations(m, trips, "station");
  const pieces = planPieces(m, rotations, byKey, new Set(["station"]), "station");
  const driven = new Set(pieces.flatMap((p) => p.trips));
  assert.equal(driven.size, trips.length, "every trip has exactly one driver");
  assert.equal(pieces.reduce((s, p) => s + p.trips.length, 0), trips.length);
  const duties = buildDuties(m, pieces);
  assert.equal(new Set(duties.flatMap((d) => d.pieces)).size, pieces.length, "every piece in one duty");
  const maxDuty = Math.max(...m.crew.contracts.map((k) => k.max_duty_h)) * 60;
  for (const d of duties) {
    const length = d.signOff - d.signOn, work = length - d.breaks;
    assert.ok(length <= maxDuty, `${d.id}: ${length} min`);
    if (work > 540) assert.ok(d.breaks >= WORK_RULES.after9, `${d.id}: breaks for more than 9 h`);
    else if (work > 360) assert.ok(d.breaks >= WORK_RULES.after6, `${d.id}: breaks for more than 6 h`);
  }
  // a parked unit: its driver rides back as a passenger
  assert.ok(deadheadMin(m, "s-2-end", "station") > m.lines.find((l) => l.id === "S 2").run_min[0]);
});

test("working hours: opening times, work only inside them, messages between parties", () => {
  const office = normalizeHours({ days: "mon-fri", from: "07:00", to: "16:00" });
  // Monday is day 0
  assert.equal(nextOpen(office, 6 * 60), 7 * 60);
  assert.equal(nextOpen(office, 4 * DAY + 17 * 60), 7 * DAY + 7 * 60, "Friday evening -> Monday morning");
  assert.equal(addWork(office, 15 * 60, 120), DAY + 8 * 60, "two hours from 15:00 end at 08:00 the next day");
  assert.equal(workBetween(office, 0, 7 * DAY), 5 * 9 * 60);
  const night = normalizeHours({ days: "mon-sun", from: "22:00", to: "06:00" });
  assert.equal(addWork(night, 21 * 60, 60), 23 * 60);
  assert.equal(workBetween(night, 0, 2 * DAY), 6 * 60 + 8 * 60 + 2 * 60);
  assert.ok(normalizeHours("24/7").always);
});

/* ---------------------------------------------------------------- the engine */

function engine(config = {}, seed = 3) {
  return new OpsEngine(config, { layout: LAB, seed });
}

test("ops engine: four weeks of normal operation run fast and well", () => {
  const started = performance.now();
  const { kpi, engine: e } = runOne({}, { layout: LAB, days: 28, seed: 1 });
  const ms = performance.now() - started;
  assert.ok(ms < 4000, `${ms.toFixed(0)} ms`);
  assert.equal(kpi.days, 28);
  assert.ok(kpi.cancelledPct < 2, `cancelled ${kpi.cancelledPct.toFixed(2)} %`);
  assert.ok(kpi.punctualPct > 92, `punctual ${kpi.punctualPct.toFixed(1)} %`);
  assert.ok(kpi.availabilityPct > 85 && kpi.availabilityPct <= 100, `available ${kpi.availabilityPct.toFixed(1)} %`);
  const t = e.totals({ from: e.dayOffset, to: e.dayOffset + 28 });
  assert.ok(t.inspections > 15, `${t.inspections} inspections`);
  assert.ok(t.softFailures > 10, `${t.softFailures} defects`);
  // nobody maintains a unit too late, and every unit is back in the depot at night
  assert.equal(t.groundedUnits, 0);
  e.runTo(e.today * DAY + 180);
  for (const u of e.units.values()) assert.ok(u.at === e.depot || u.trip || u.at === "workshop", `${u.id} at ${u.at} at night`);
  // every duty of a finished day has ended
  for (const d of e.days.get(e.today - 1)?.duties || []) if (d.person) assert.ok(["done", "cancelled", "open", "taken"].includes(d.state), `${d.id} ${d.state}`);
});

test("ops engine: the same seed gives the same days, another seed others", () => {
  const a = runOne({}, { layout: LAB, days: 7, seed: 5 }).kpi;
  const b = runOne({}, { layout: LAB, days: 7, seed: 5 }).kpi;
  const c = runOne({}, { layout: LAB, days: 7, seed: 6 }).kpi;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test("failures: the hazard grows with the wear since maintenance and in the first year", () => {
  const e = engine();
  const u = [...e.units.values()][0];
  const ctx = { t: 0, year: 2026, interval: 7500, factor: 1 };
  u.wear = 0;
  const fresh = expectedFailures(u, 100, "hard", ctx);
  u.wear = 7500;
  const due = expectedFailures(u, 100, "hard", ctx);
  u.wear = 15000;
  const overdue = expectedFailures(u, 100, "hard", ctx);
  assert.ok(fresh < due && due < overdue, `${fresh} < ${due} < ${overdue}`);
  const built = u.built;
  u.built = 2026;
  const young = expectedFailures(u, 100, "hard", ctx);
  u.built = 2010;
  const middle = expectedFailures(u, 100, "hard", ctx);
  u.built = 1990;
  const old = expectedFailures(u, 100, "hard", ctx);
  u.built = built;
  assert.ok(young > middle && old > middle, "a bathtub over the years");
});

test("maintenance: units are inspected before their limits, also with live mileage only", () => {
  const e = engine();
  e.runDays(21);
  for (const u of e.units.values()) {
    for (const level of u.type.program) assert.ok(u.usage(level, e.now) <= u.limit(level) + 0.02, `${u.id} ${level.id} at ${u.usage(level, e.now).toFixed(2)}`);
  }
  const t = e.totals();
  assert.ok(t.inspections > 10);
  assert.equal(t.groundedUnits, 0);
});

test("ECM: distributed roles keep units waiting for releases and pass penalties down the chain", () => {
  const integrated = runOne({}, { layout: LAB, setup: setup("integrated"), days: 14, seed: 2 }).kpi;
  const distributed = runOne({}, { layout: LAB, setup: setup("distributed"), days: 14, seed: 2 }).kpi;
  assert.ok(distributed.availabilityPct < integrated.availabilityPct, "messages and office hours cost availability");
  assert.ok(distributed.missingUnits > integrated.missingUnits);
  assert.ok(distributed.penaltyAuthority > integrated.penaltyAuthority);
  // integrated: only the authority's contract books anything
  assert.equal(integrated.parties.ecm.paid, 0);
  assert.equal(integrated.parties.works.paid, 0);
  // distributed: the ECM company and the workshop pay
  assert.ok(distributed.parties.ecm.paid > 0 && distributed.parties.works.paid > 0);
  assert.ok(distributed.parties.ru.received > 0);
  for (const k of Object.keys(distributed.penaltiesByContract)) assert.ok(["transport", "availability", "workshop"].includes(k));
});

test("contracts: causes go to their function's party; pass-through along the chain; exemptions", () => {
  const m = normalizeOps({ ecm: { management: "ecm", planning: "ecm", delivery: "works", development: "ecm" } }, LAB);
  const ledger = new Ledger(m);
  assert.equal(ledger.responsible("sick"), "ru");
  assert.equal(ledger.responsible("failure"), "ecm");
  assert.equal(ledger.responsible("overrun"), "works");
  assert.equal(ledger.responsible("release"), "ecm");
  assert.equal(ledger.responsible("infrastructure"), null);
  assert.deepEqual(ledger.path("works").map((c) => c.id), ["availability", "workshop"]);
  // a cancelled train of 40 km because the workshop was late: 12 €/km to the authority, half of it passed on twice
  ledger.book({ t: 0, type: "cancel", cause: "overrun", km: 40 });
  const by = Object.fromEntries(ledger.entries.map((e) => [e.contract, e.amount]));
  assert.equal(by.transport, 480);
  assert.equal(by.availability, 240);
  assert.equal(by.workshop, 120);
  // a late release: only the contracts' own items (150 and 120 €/h, plus half of 150 passed on)
  ledger.entries.length = 0;
  ledger.book({ t: 0, type: "late_release", cause: "overrun", hours: 2 });
  assert.deepEqual(ledger.entries.map((e) => [e.contract, e.amount]), [["availability", 300], ["workshop", 390]]);
  // infrastructure is exempt in the transport contract
  ledger.entries.length = 0;
  ledger.book({ t: 0, type: "cancel", cause: "infrastructure", km: 40 });
  assert.equal(ledger.entries.length, 0);
  // crews are the operator's own business
  ledger.book({ t: 0, type: "cancel", cause: "sick", km: 40 });
  assert.deepEqual(ledger.entries.map((e) => e.contract), ["transport"]);
});

/* ---------------------------------------------------------------- crews */

test("crews: staff sized to the duties, rostered with rest and qualifications", () => {
  const e = engine();
  const drivers = [...e.desk.people.values()].filter((p) => p.role === "driver");
  assert.ok(drivers.length >= 40 && drivers.length <= 70, `${drivers.length} drivers`);
  assert.ok(drivers.some((p) => p.contract.id === "part") && drivers.some((p) => p.contract.id === "full"));
  assert.ok(drivers.some((p) => p.home.kind === "station"), "some live beyond the layout and come by train");
  e.runDays(10);
  for (const p of drivers) {
    const days = [...p.plan.keys()].sort((a, b) => a - b);
    for (let i = 1; i < days.length; i++) {
      const a = p.plan.get(days[i - 1]), b = p.plan.get(days[i]);
      assert.ok(b.signOn - a.signOff >= p.contract.min_rest_h * 60 - 1, `${p.id}: rest between ${a.id} and ${b.id}`);
    }
  }
});

test("crews: sick calls are covered by stand-by and calls on free days; without them trains are cancelled", () => {
  const base = runOne({}, { layout: LAB, stress: stress("flu"), days: 14, seed: 4 }).kpi;
  const lean = runOne({}, { layout: LAB, setup: setup("lean-crew"), stress: stress("flu"), days: 14, seed: 4 }).kpi;
  const buffers = runOne({}, { layout: LAB, setup: setup("crew-buffers"), stress: stress("flu"), days: 14, seed: 4 }).kpi;
  assert.ok(base.sickCalls > 3, `${base.sickCalls} sick calls`);
  assert.ok(base.coveredByReserve + base.coveredByCallIn > 0);
  assert.equal(lean.coveredByReserve, 0, "no stand-by in the lean setup");
  assert.ok(buffers.coveredByReserve >= base.coveredByReserve);
  assert.ok(buffers.drivers > base.drivers && lean.drivers < base.drivers);
  assert.ok(lean.cancelledPct >= buffers.cancelledPct, `${lean.cancelledPct} >= ${buffers.cancelledPct}`);
  // a stress test meets the staff planned for normal times: the flu wave hires nobody, vacant positions cut the staff
  const calm = runOne({}, { layout: LAB, days: 1, seed: 4 }).kpi;
  assert.equal(base.drivers, calm.drivers, "the same drivers in a flu wave");
  const short = runOne({}, { layout: LAB, stress: stress("shortage"), days: 1, seed: 4 }).kpi;
  assert.equal(short.drivers, Math.round(calm.drivers * (1 - 0.12)), "12 % of the positions vacant");
});

test("crews: a driver kept late gets the full rest; the next duty goes to somebody else when somebody can take it", () => {
  const e = engine({ dispatch: { delays: { p: 0.5, median_min: 20, max_min: 120 } } }, 2);
  const handed = [];
  e.on((name, x) => {
    if (name === "log" && /needs the full rest/.test(x.text)) handed.push(x.text);
  });
  e.runTo((e.dayOffset + 14) * DAY);
  assert.ok(handed.length >= 3, `${handed.length} duties handed over`);
  assert.ok(e.totals().restConflicts < handed.length, "rest is cut short only when nobody can take over");
  // the duties handed over are someone else's now, who had the rest
  for (const duty of e.desk.duties.values()) {
    if (!duty.person || duty.kind !== "line" || !(duty.state === "done" || duty.state === "planned")) continue;
    const p = e.desk.people.get(duty.person);
    const before = p.plan.get(duty.day - 1);
    if (before?.end != null && !duty.restConflict) assert.ok(duty.signOn - before.end >= p.contract.min_rest_h * 60 - 0.5, `${p.name}: ${duty.tpl.id}`);
  }
});

test("crews: a bus strike makes people late to work, which delays and cancels trains", () => {
  const calm = runOne({}, { layout: LAB, days: 10, seed: 8 }).kpi;
  const strike = runOne({}, { layout: LAB, stress: stress("bus-strike"), days: 10, seed: 8 }).kpi;
  assert.ok(strike.lateSignOns > calm.lateSignOns * 2, `${strike.lateSignOns} vs ${calm.lateSignOns}`);
  assert.ok(strike.cancelledPct + (100 - strike.punctualPct) > calm.cancelledPct + (100 - calm.punctualPct));
});

test("crews: somebody who rides in on a cancelled train takes the next one, or a taxi", () => {
  const e = engine();
  e.runTo(DAY + 120);
  const day = e.days.get(1);
  const duty = day.duties.find((d) => d.commute?.trip && d.person);
  assert.ok(duty, "a crew member comes to work by train");
  const trip = e.trips.get(duty.commute.trip);
  e.now = trip.dep;
  e._cancel(trip, "infrastructure");
  assert.notEqual(duty.commute.trip, trip.id, "not on the cancelled train");
  assert.ok(duty.commute.arriveAt >= e.now + 1, "on the way");
});

/* ---------------------------------------------------------------- stress tests and comparisons */

test("stress tests: events on the first measured day and lasting changes", () => {
  const calm = runOne({}, { layout: LAB, days: 3, seed: 9 });
  const bad = runOne({}, { layout: LAB, stress: stress("bad-monday"), days: 3, seed: 9 });
  const first = (r) => r.daily[0];
  assert.ok(first(bad).sick >= first(calm).sick + 3, "five sick calls on the first morning");
  assert.ok(first(bad).hard >= first(calm).hard + 1, "breakdowns in the peak");
  assert.ok(bad.kpi.cancelledPct > calm.kpi.cancelledPct);
  const damaged = runOne({}, { layout: LAB, stress: stress("unit-damage"), days: 7, seed: 9 }).kpi;
  assert.ok(damaged.availabilityPct < calm.kpi.availabilityPct - 5, "two units out of service");
  const e = engine();
  e.runDays(1);
  const before = [...e.desk.people.values()].filter((p) => p.left == null).length;
  e.inject({ type: "staff_loss", count: 4 });
  assert.equal([...e.desk.people.values()].filter((p) => p.left == null).length, before - 4);
});

test("comparisons: setups x seeds under a stress test, with means, the parties and CSV", async () => {
  let last = null;
  const progress = [];
  for await (const step of runExperiment({ config: {}, layout: LAB, setups: [setup("integrated"), setup("distributed")], stress: stress("heat"), days: 5, seeds: [1, 2] })) {
    progress.push(step.progress);
    last = step;
  }
  assert.ok(last.done);
  assert.deepEqual(progress.slice(0, -1), [0, 0.25, 0.5, 0.75]);
  const { rows } = last.result;
  assert.deepEqual(rows.map((r) => r.id), ["integrated", "distributed"]);
  for (const r of rows) {
    assert.ok(r.values.cancelledPct.min <= r.values.cancelledPct.mean && r.values.cancelledPct.mean <= r.values.cancelledPct.max);
    assert.equal(r.daily.length, 5);
  }
  const csv = toCSV(last.result);
  assert.match(csv, /^setup,key,label,unit,mean,min,max\n/);
  assert.match(csv, /"Distributed ECM",penaltyAuthority/);
  assert.ok(kpis(runOne({}, { layout: LAB, days: 2, seed: 1 }).engine).days >= 2);
});
