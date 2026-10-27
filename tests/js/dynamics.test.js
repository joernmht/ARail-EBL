// Running dynamics of trains (rail/dynamics.js): the forces (tractive effort within the adhesion,
// Strahl's running resistance, gradients and Röckl's curve resistance), the Minden braking distance
// and its inverses, a run along a line (limits for the whole train, braking for lower limits and the
// stop, stalling on a gradient, slippery rails, a train without vehicles), its energy, coasting,
// coupler forces, the run-in force, the load limit, how much slower slippery rails make a train, and
// the rail operations' running times (also for a line whose train cannot run).
import assert from "node:assert/strict";
import test from "node:test";

import {
  Consist, G, adhesion, approachFactor, brakingDistance, brakingSpeed, coastingRun, couplerForces, curveResistance, fullBraking, loadLimit,
  requiredBrakePercentage, runInForce, runProfile, runningResistance, startingForces, tractiveEffort, trainModel,
} from "../../web/arail/index.js";
import { readJSON } from "./helpers.js";

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not ${b} ± ${tol}`);
const model = (spec, options) => trainModel(new Consist(spec), options);
const flat = (length_m, kmh, more = {}) => ({ length_m, sections: [{ s0: 0, s1: length_m, kmh }], power: "ac15", ...more });
const RE = { vehicles: [{ type: "br146" }, { type: "dbpza", count: 4 }] };
const FREIGHT = { brake_position: "G", vehicles: [{ type: "br185" }, { type: "sgns", count: 20, loaded: 1 }] };

test("the forces: tractive effort, adhesion after Curtius and Kniffler, Strahl and Röckl", () => {
  near(adhesion(0), 7.5 / 44 + 0.161, 1e-9, "dry at a standstill");
  near(adhesion(100), 7.5 / 144 + 0.161, 1e-9, "dry at 100 km/h");
  assert.ok(adhesion(0, "wet") < adhesion(0) && adhesion(0, "ice") < adhesion(0, "wet") && adhesion(0, "leaves") < adhesion(0, "ice"));
  assert.ok(adhesion(0, "leaves", { sanding: true }) > adhesion(0, "leaves") && adhesion(0, "dry", { sanding: true }) === adhesion(0));
  const re = model(RE);
  near(re.mass_t, 85 + 4 * 49, 1e-9, "mass");
  near(re.mass_factor, (85 * 1.15 + 196 * 1.04) / 281, 1e-9, "mass factor, averaged by mass");
  // the BR 146 at a standstill: 300 kN, but the adhesion carries 0.331 × 85 t × g = 276 kN
  near(tractiveEffort(re, 0), adhesion(0) * 85 * G, 1e-9, "starting tractive effort, adhesion-limited");
  // at 140 km/h the power: 5600 kW / 38.9 m/s = 144 kN (the adhesion would carry more)
  near(tractiveEffort(re, 140), 5600 / (140 / 3.6), 1e-6, "on the hyperbola");
  assert.equal(tractiveEffort(model({ vehicles: [{ type: "dbpza" }] }), 50), 0, "a coach has none");
  // an electric locomotive on an unelectrified line pulls nothing
  assert.equal(tractiveEffort(model(RE, { power: "none" }), 20), 0);
  // Strahl: a double-deck coach (k = 0.025) at 100 km/h: 2.5 + 0.025 · (112/10)² N/kN
  const coach = model({ vehicles: [{ type: "dbpza" }] });
  near(runningResistance(coach, 100), (49 * G * (2.5 + 0.025 * 11.2 * 11.2)) / 1000, 1e-9, "Strahl");
  // an empty wagon resists more per tonne than a full one
  const per = (spec) => runningResistance(model(spec), 100) / model(spec).mass_t;
  assert.ok(per({ vehicles: [{ type: "eanos" }] }) > per({ vehicles: [{ type: "eanos", loaded: true }] }));
  near(curveResistance(500), 650 / 445, 1e-12, "Röckl, r ≥ 300 m");
  near(curveResistance(250), 500 / 220, 1e-12, "Röckl, below 300 m");
  assert.equal(curveResistance(null), 0);
});

test("the Minden formula: braking distance, the braking table's speed and the brake percentage needed", () => {
  // 3.85 · v² / (6.1 · (1 + λ/10)): about 152 brake hundredths stop from 160 km/h within 1000 m
  near(requiredBrakePercentage(160, 1000), 151.6, 0.1, "λ for 160 km/h on 1000 m");
  near(brakingDistance(160, requiredBrakePercentage(160, 1000)), 1000, 1e-6, "and back");
  near(brakingSpeed(1000, requiredBrakePercentage(120, 1000)), 120, 1e-6, "the speed of the braking table");
  assert.ok(brakingDistance(120, 80, -10) > brakingDistance(120, 80) && brakingDistance(120, 80, 10) < brakingDistance(120, 80), "longer downhill, shorter uphill");
  assert.ok(brakingSpeed(700, 80) < brakingSpeed(1000, 80), "a shorter braking distance needs a lower speed");
  // full braking of a train: its brake percentage; on leaves the adhesion limits it (but not a magnetic track brake)
  const re = model(RE);
  near(fullBraking(re, 120).distance_m, brakingDistance(120, new Consist(RE).brakePercentage), 1e-6, "dry: the Minden distance");
  const leaves = fullBraking(re, 120, { condition: "leaves" });
  assert.ok(leaves.limited && leaves.distance_m > 2 * fullBraking(re, 120).distance_m, `${leaves.distance_m} m on leaves`);
  const mg = model({ brake_position: "R+Mg", vehicles: [{ type: "et442" }] });
  assert.ok(fullBraking(mg, 120, { condition: "leaves" }).distance_m < fullBraking(model({ brake_position: "R", vehicles: [{ type: "et442" }] }), 120, { condition: "leaves" }).distance_m, "the magnetic track brake helps on leaves");
});

test("a run: as fast as the traction and the limits allow, braking for the stop, in less time than the limits forbid", () => {
  const re = model(RE);
  const p = runProfile(re, flat(8000, 160));
  assert.equal(p.stalled_at_m, null);
  assert.ok(p.time_s > 8000 / (160 / 3.6), "no faster than the line speed all the way");
  near(p.top_kmh, 160, 0.5, "reaches the line speed");
  assert.ok(p.top_at_m > 1000 && p.top_at_m < 4000, `top speed after ${p.top_at_m} m`);
  assert.ok(p.brake_from_m > p.top_at_m && p.brake_from_m < 8000, "brakes before the stop");
  assert.equal(p.samples[p.samples.length - 1].v, 0, "stops at the end");
  assert.ok(p.samples.every((q) => q.v <= 160 + 1e-6));
  assert.ok(p.samples.slice(1).every((q, i) => q.t >= p.samples[i].t), "time runs on");
  // a lower limit: the train brakes before it and keeps to it until its end has passed it
  const slow = runProfile(re, { length_m: 6000, sections: [{ s0: 0, s1: 3000, kmh: 160 }, { s0: 3000, s1: 3500, kmh: 60 }, { s0: 3500, s1: 6000, kmh: 160 }], power: "ac15" });
  for (const q of slow.samples) if (q.s >= 3000 && q.s <= 3500 + re.length_m - 10) assert.ok(q.v <= 60 + 1e-6, `${q.v} km/h at ${q.s} m`);
  assert.ok(slow.time_s > p.time_s * (6000 / 8000), "the limit costs time");
  // running on (no stop): ends at the limit
  assert.ok(runProfile(re, flat(8000, 160, { stop: false })).samples.at(-1).v > 150);
});

test("a heavy train stalls on a steep gradient; leaves make the start slow; a gradient costs time", () => {
  const heavy = model({ vehicles: [{ type: "br218" }, { type: "eanos", count: 25, loaded: true }] });
  const up = runProfile(heavy, { length_m: 3000, sections: [{ s0: 0, s1: 3000, kmh: 80, permille: 25 }] });
  assert.ok(up.stalled_at_m != null && up.time_s === Infinity, "stalls");
  const rb = model({ vehicles: [{ type: "et442s" }] });
  const dry = runProfile(rb, flat(4000, 120)), wet = runProfile(rb, { ...flat(4000, 120), sections: [{ s0: 0, s1: 4000, kmh: 120, condition: "leaves" }] });
  assert.ok(wet.time_s > dry.time_s + 10 && wet.top_at_m > dry.top_at_m, `leaves: ${wet.time_s} s, dry ${dry.time_s} s`);
  // uphill a powerful unit reaches its top speed later, and brakes for the stop later (the gradient
  // brakes too); a heavy freight train takes longer
  const hill = runProfile(rb, { length_m: 4000, sections: [{ s0: 0, s1: 4000, kmh: 120, permille: 15 }] });
  assert.ok(hill.top_at_m > dry.top_at_m && hill.brake_from_m > dry.brake_from_m);
  const f = model(FREIGHT);
  assert.ok(runProfile(f, { length_m: 8000, sections: [{ s0: 0, s1: 8000, kmh: 100, permille: 10 }] }).time_s > runProfile(f, flat(8000, 100)).time_s);
});

test("energy: the work at the wheel, fed back by braking, diesel and CO₂, per seat-km", () => {
  const re = model(RE);
  const p = runProfile(re, flat(8000, 160));
  const e = p.energy;
  // the kinetic energy at 160 km/h (with the rotating masses) is part of the work at the wheel
  const kinetic = (0.5 * re.mass_t * re.mass_factor * (160 / 3.6) ** 2) / 3600;
  assert.ok(e.traction_kwh > kinetic && e.traction_kwh < kinetic * 2.5, `${e.traction_kwh} kWh at the wheel, ${kinetic} kWh kinetic`);
  assert.ok(e.regen_kwh > 0 && e.regen_kwh < e.braking_kwh, "feeds back part of what the brakes take");
  assert.ok(e.net_kwh > e.traction_kwh / 0.85 - e.regen_kwh - 1e-6);
  near(e.per_km_kwh, e.net_kwh / 8, 1e-9, "per train-km");
  assert.ok(e.per_seat_km_wh > 0);
  // a DC line takes back only part of it
  assert.ok(runProfile(re, flat(8000, 160, { power: "dc3" })).energy.regen_kwh < e.regen_kwh);
  // diesel: litres and CO₂, nothing fed back
  const dmu = runProfile(model({ vehicles: [{ type: "br642" }] }), { ...flat(4000, 120), power: null });
  assert.equal(dmu.energy.electric, false);
  assert.equal(dmu.energy.regen_kwh, 0);
  near(dmu.energy.co2_kg, dmu.energy.fuel_l * 2.64, 1e-9, "CO₂ of the diesel");
});

test("coasting before the stop: less energy within the running-time supplement", () => {
  const rb = model({ vehicles: [{ type: "et442s" }] });
  const c = coastingRun(rb, flat(4000, 120), { supplement: 0.05 });
  assert.ok(c.coast && c.coast_m > 0 && c.coast_m < c.fast.brake_from_m, `coasts from ${c.coast_m} m`);
  assert.ok(c.saving_kwh > 0 && c.saving_share > 0.05, `saves ${c.saving_kwh} kWh`);
  assert.ok(c.extra_s > 0 && c.extra_s <= c.fast.time_s * 0.05 + 1e-6, `${c.extra_s} s longer`);
  // more supplement, more saved
  assert.ok(coastingRun(rb, flat(4000, 120), { supplement: 0.1 }).saving_kwh > c.saving_kwh);
  // no stop, no coasting
  assert.equal(coastingRun(rb, flat(4000, 120, { stop: false })).coast, null);
  // within the supplement at full resolution too (the search runs in coarser steps)
  for (const [type, L, kmh] of [["et442s", 4000, 120], ["et442", 4000, 120], ["br642", 2500, 80], ["et442s", 1500, 80]]) {
    for (const supplement of [0.03, 0.05, 0.1]) {
      const r = coastingRun(model({ vehicles: [{ type }] }), flat(L, kmh), { supplement });
      if (r.coast) assert.ok(r.extra_s <= r.fast.time_s * supplement + 1e-6, `${type}, ${L} m, ${supplement}: ${r.extra_s} s longer, ${r.fast.time_s * supplement} s allowed`);
    }
  }
  // the run as fast as possible, when it is known, is the one it compares with
  const fast = runProfile(rb, flat(4000, 120));
  const shared = coastingRun(rb, flat(4000, 120), { supplement: 0.05, fast });
  assert.ok(shared.fast === fast);
  near(shared.coast_m, c.coast_m, 1e-9, "the same coasting point");
});

test("a train without vehicles does not run, and has no energy", () => {
  const empty = model({ vehicles: [{ type: "no-such-type" }] });
  const p = runProfile(empty, flat(4000, 120));
  assert.equal(p.time_s, Infinity);
  assert.equal(p.stalled_at_m, 0);
  for (const [k, v] of Object.entries(p.energy)) if (typeof v === "number") assert.equal(v, 0, `energy ${k}`);
  assert.equal(coastingRun(empty, flat(4000, 120)).coast, null);
});

test("forces along the train: couplings, the run-in force in G and P, the load limit", () => {
  const f = model(FREIGHT);
  // standing still on 10 ‰: the first coupling holds what all the wagons need
  const hold = couplerForces(f, { accel: 0, permille: 10, traction_kn: null });
  assert.equal(hold.length, f.vehicles.length - 1);
  const wagons = f.vehicles.slice(1).reduce((s, v) => s + (v.mass_t * G * (2.5 + v.k * 1.2 * 1.2 + 10)) / 1000, 0);
  near(hold[0], wagons, 1e-6, "the first coupling");
  assert.ok(hold.every((x, i) => i === 0 || x < hold[i - 1]), "less towards the back");
  const start = startingForces(f, { permille: 10 });
  assert.equal(start.at, 0);
  assert.ok(start.max_kn > 200 && start.max_kn < 450, `${start.max_kn} kN behind the locomotive`);
  // a long freight train: the run-in force when braking is much smaller in G than in P
  assert.ok(runInForce(f, { position: "G" }) * 3 < runInForce(f, { position: "P" }));
  // the load limit of a BR 185 on 10 ‰: (0.331 · 85 t · g − its own needs) / what a tonne needs
  const ll = loadLimit(model({ vehicles: [{ type: "br185" }] }), 10);
  const perT = (G * 14) / 1000 + 1.04 * 0.02, own = 85 * ((G * 14) / 1000 + 1.15 * 0.02);
  near(ll.traction_t, (adhesion(0) * 85 * G - own) / perT, 1e-6, "by the adhesion");
  near(ll.coupler_t, 450 / perT, 1e-6, "by the coupling");
  assert.equal(ll.by, "adhesion");
  assert.ok(loadLimit(model({ vehicles: [{ type: "br185" }] }), 10, { condition: "leaves" }).limit_t < ll.limit_t / 4, "on leaves");
});

test("slippery rails make trains come in and leave slower", () => {
  const rb = model({ vehicles: [{ type: "et442s" }] });
  assert.equal(approachFactor(rb, "dry"), 1);
  const wet = approachFactor(rb, "wet"), leaves = approachFactor(rb, "leaves");
  assert.ok(wet >= 1 && leaves > wet && leaves < 10, `wet ${wet}, leaves ${leaves}`);
  // a train that cannot start on leaves at all: the most
  assert.equal(approachFactor(model(FREIGHT), "leaves"), 10);
});

test("running times of a line: from stop to stop with the dwells; the rail operations' run_min \"auto\"", async () => {
  const { lineRunningTime, drivingStyles } = await import("../../web/arail/index.js");
  const { normalizeOps, validateOps } = await import("../../web/arail/ops/config.js");
  const re = model(RE);
  const nonstop = lineRunningTime(re, { km: 30, kmh: 160 }), stopping = lineRunningTime(re, { km: 30, kmh: 160, stops: 5, dwell_s: 30 });
  assert.ok(stopping.minimum_s > nonstop.minimum_s + 5 * 30, "stops cost more than their dwells");
  near(stopping.planned_s - stopping.minimum_s, stopping.run_s * 6 * 0.05, 1e-6, "the supplement on the running");
  // the lab's lines with their times from the running dynamics
  const layout = readJSON("web/layouts/ebl-lab.json");
  const cfg = {
    stations: [{ id: "hbf", name: "Bahnhof", platforms: ["platform-1"] }, { id: "altstadt", name: "Altstadt" }],
    lines: [{ id: "RE 1", route: ["hbf", "altstadt"], km: 59, run_min: "auto", vmax_kmh: 160, stops: 6 }, { id: "RB 33", route: ["hbf", "altstadt"], km: 34, run_min: "auto", stops: 9 }],
  };
  const lines = normalizeOps(cfg, layout).lines;
  const [re1, rb33] = lines.map((l) => l.run_min[0]);
  assert.ok(re1 > 25 && re1 < 45 && Number.isInteger(re1 * 2), `RE 1: ${re1} min`);
  assert.ok(rb33 > 20 && rb33 < 45, `RB 33: ${rb33} min`);
  assert.deepEqual(validateOps({ ...cfg, lines: [{ ...cfg.lines[0], km: undefined }] }, layout).filter((p) => /auto/.test(p)).length, 1, "auto needs km");
  // a line whose train cannot run (a locomotive of the layout without power_kw): the distance at the
  // line speed with the supplement, and the validation says so
  const own = { ...layout, vehicle_types: { v100: { label: "V 100", kind: "locomotive", length_m: 12.1, mass_t: 62, axles: 4, vmax_kmh: 100, brake_t: { P: 50 } } }, consists: [...layout.consists, { id: "rb5", lines: ["RB 5"], vehicles: [{ type: "v100" }, { type: "bpmz", count: 2 }] }] };
  const rb5 = { stations: cfg.stations, lines: [{ id: "RB 5", route: ["hbf", "altstadt"], km: 20, run_min: "auto" }] };
  assert.deepEqual(normalizeOps(rb5, own).lines[0].run_min, [10.5], "20 km at 120 km/h and 5 %");
  assert.match(validateOps(rb5, own).join("\n"), /RB 5.*its train cannot run/);
  assert.deepEqual(normalizeOps(rb5, own).lines[0].energy, { electric: false, kwh_per_km: 0, diesel_l_per_km: 0 });
  // driving styles: the more supplement, the more coasting saves
  const styles = drivingStyles(model({ vehicles: [{ type: "et442s" }] }), flat(4000, 120)).styles.map((x) => x.run.saving_share);
  assert.ok(styles[0] < styles[1] && styles[1] < styles[2], styles.join(", "));
});
