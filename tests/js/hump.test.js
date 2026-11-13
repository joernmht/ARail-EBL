// The hump yard on its own (web/arail/hump/, issue #236): the yard's geometry, the physics of a cut
// checked against the energy balance, separating at the crest, switches, retarders and their limits,
// impacts with the momentum kept, misroutes when the train is pushed too fast, winter, target braking
// against speed-holding units, wagons that must not be humped, determinism, pulling a train out (by
// hand and when a track is full), and the diagrams of a run.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

import { createRng } from "../../web/arail/core/math.js";
import { ROOT } from "./helpers.js";
import {
  G, HumpSimulation, HumpYard, RETARDERS, ROLLING, ROTATING_T_PER_AXLE, SEASONS, SPEEDS, STANDARD_YARD, SWITCHES, axlePositions, coast, curveResistance,
  cutBody, cutForces, cutsOf, energyHeight, makeWagon, randomTrain, requiredSpeeds, standardYard, wagonType, wagonTypes,
  CLASS_LABELS, cutClass, humpDiagrams, niceTicks, simplify, timeRun,
} from "../../web/arail/hump/index.js";

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not ${b} ± ${tol}`);
const rng = createRng(5);
/** A straight yard of one segment at a constant grade (‰). */
const slope = (grade, length_m = 2000) => new HumpYard({ segments: [{ id: "s", length_m, grades: [[0, grade]], track: { name: "1" } }] });
const wagon = (spec) => makeWagon({ cwA_m2: 0, ...spec }, rng);
const humped = (sim) => sim.cuts.filter((c) => c.order != null);

test("the standard yard: a tree of switches, every track reached, the crest and the height", () => {
  const yard = standardYard();
  assert.deepEqual(yard.problems, []);
  assert.equal(yard.tracks.length, STANDARD_YARD.tracks);
  assert.equal(yard.switchIds.length, STANDARD_YARD.tracks - 1, "a binary tree of switches");
  // the crest lies in the vertical curve at the end of the push track; the hump is 3.5–5 m high
  assert.ok(Math.abs(yard.crest_m - STANDARD_YARD.push_m) < 10, `crest at ${yard.crest_m}`);
  assert.ok(yard.height_m > 3.5 && yard.height_m < 5, `height ${yard.height_m}`);
  const names = yard.tracks.map((t) => t.name);
  assert.deepEqual(names, ["1", "2", "3", "4", "5", "6", "7", "8"]);
  const curve = (route) => yard.profile(route, 1).filter((p) => p.r > 0).reduce((a, p) => a + 1 / p.r, 0);
  for (const t of yard.tracks) {
    const route = yard.routeTo(t.name);
    assert.equal(route[0], yard.root);
    assert.equal(route.length, 4, "three switch levels for 8 tracks");
    const kinds = yard.retardersOn(route).map((r) => r.kind);
    assert.deepEqual(kinds.slice(0, 2), ["main", "group"]);
    assert.ok(kinds.slice(2).every((k) => k === "speed"), "speed-holding units in the tracks of the default design");
    // downhill from the crest to the end of every track
    const p = yard.profile(route, 5).filter((x) => x.s > yard.crest_m + 5);
    for (let i = 1; i < p.length; i++) assert.ok(p[i].h <= p[i - 1].h + 1e-9, `track ${t.name} rises at ${p[i].s}`);
    assert.equal(t.length_m, STANDARD_YARD.track_m);
  }
  // the outer tracks turn more than the middle ones (curve resistance), and are reached by longer routes
  assert.ok(curve(yard.routeTo("1")) > curve(yard.routeTo("4")) && curve(yard.routeTo("8")) > curve(yard.routeTo("5")));
  assert.ok(yard.trackSegment("1").track.s0 > yard.trackSegment("4").track.s0);
  // all group retarders of the inner tracks line up
  assert.equal(yard.retardersOn(yard.routeTo("4"))[1].s0, yard.retardersOn(yard.routeTo("5"))[1].s0);
  assert.equal(standardYard({ tracks: 5 }).tracks.length, 5);
  assert.equal(standardYard({ tracks: 1 }).switchIds.length, 0);
  assert.ok(standardYard({ design: "target" }).retarders.every((r) => r.kind !== "speed"));
  assert.throws(() => standardYard({ design: "nonsense" }), /track design/);
});

test("a yard from segments: heights from the grades, vertical curves, checks", () => {
  // up 10 ‰ for 50 m, a vertical curve of 10 m to −40 ‰, then down
  const yard = new HumpYard({ h0_m: 1, segments: [
    { id: "a", length_m: 100, grades: [[0, 10], [50, 10], [60, -40]] },
    { id: "b", parent: "a", length_m: 50, track: { name: "B", from_m: 10 } },
    { id: "c", parent: "a", length_m: 50, grades: [[0, -5]], curves: [[0, 20, 190]], turnout_m: 20, track: { name: "C" } },
  ] });
  const a = yard.segment("a");
  near(yard.heightAt(a, 50), 1.5, 1e-12, "50 m at 10 ‰");
  near(yard.heightAt(a, 60), 1.5 + (10 * 10 - (50 * 10 * 10) / 10 / 2) / 1000, 1e-12, "through the vertical curve");
  near(yard.gradeAt(a, 55), -15, 1e-12, "the grade turns linearly");
  near(yard.crest_m, 52, 1e-9, "the top where the grade passes zero");
  near(yard.heightAt(yard.segment("b"), 100), yard.heightAt(a, 100), 1e-12, "a child starts where its parent ends");
  near(yard.heightAt(yard.segment("c"), 110), yard.heightAt(a, 100) - 0.05, 1e-12, "−5 ‰ for 10 m");
  assert.equal(yard.radiusAt(yard.segment("c"), 105), 190);
  assert.equal(yard.radiusAt(yard.segment("c"), 125), 0);
  assert.ok(yard.inTurnout(yard.segment("c"), 110) && !yard.inTurnout(yard.segment("b"), 110));
  assert.deepEqual(yard.routeTo("C"), ["a", "c"]);
  assert.equal(yard.trackSegment("B").track.s0, 110);
  assert.equal(yard.segmentOn(["a", "b"], 120).id, "b");
  assert.throws(() => new HumpYard({ segments: [{ id: "a", length_m: 10 }, { id: "b", length_m: 10 }] }), /exactly one root/);
  assert.throws(() => new HumpYard({ segments: [{ id: "a", length_m: 10 }, { id: "b", parent: "x", length_m: 10 }] }), /no parent x/);
  assert.throws(() => new HumpYard({ segments: [{ id: "a", length_m: 0 }] }), /positive/);
  assert.throws(() => yard.trackSegment("Z"), /no classification track/);
  // a switch closer to its parent's start than its detection section
  const short = new HumpYard({ segments: [{ id: "a", length_m: 5 }, { id: "b", parent: "a", length_m: 2 }, { id: "c", parent: "a", length_m: 20 }] });
  assert.equal(short.problems.length, 2, short.problems.join("; "));
});

test("wagons and cuts: the catalogue's figures, the hump's own types, rolling classes, cuts by track", () => {
  const e = wagonType("eanos");
  assert.equal(e.axles, 4);
  assert.ok(e.length_m > 15 && e.length_m < 16.5, "Eanos over buffers");
  assert.ok(wagonTypes().includes("hbbillns") && wagonTypes().includes("sgns"));
  assert.throws(() => wagonType("br185"), /no wagon type/, "a locomotive is no wagon");
  const loaded = makeWagon({ type: "eanos", loaded: 1 }, createRng(1));
  const empty = makeWagon({ type: "eanos", loaded: 0 }, createRng(1));
  assert.equal(loaded.mass_t, e.mass_t + e.load_t);
  assert.equal(loaded.rolling, "good");
  assert.equal(empty.rolling, "medium");
  assert.equal(makeWagon({ type: "hbbillns" }, createRng(1)).rolling, "bad", "an empty 2-axle wagon");
  assert.equal(loaded.rot_t, 4 * ROTATING_T_PER_AXLE);
  assert.equal(makeWagon({ type: "eanos", w_nkn: 3.3 }, createRng(1)).w, 3.3);
  // drawn within the class's limits; winter adds to it
  const r = createRng(9);
  const summer = Array.from({ length: 200 }, () => makeWagon({ type: "hbbillns" }, r).w);
  const winter = Array.from({ length: 200 }, () => makeWagon({ type: "hbbillns" }, r, "winter").w);
  assert.ok(summer.every((w) => w >= ROLLING.bad.lo && w <= ROLLING.bad.hi));
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  near(mean(summer), ROLLING.bad.mean, 0.2, "the mean of the bad class");
  near(mean(winter) - mean(summer), SEASONS.winter.rolling_add, 0.25, "winter");
  assert.deepEqual(axlePositions(15.5, 2), [3, 12.5]);
  assert.equal(axlePositions(20, 4).length, 4);
  // consecutive wagons for the same track are one cut; destinations through the sorting plan
  const ws = ["A", "A", "B", "A", "B", "B"].map((d) => makeWagon({ type: "sgns", destination: d }, createRng(1)));
  const cuts = cutsOf(ws, { A: "3", B: "7" });
  assert.deepEqual(cuts.map((c) => [c.track, c.wagons.length]), [["3", 2], ["7", 1], ["3", 1], ["7", 2]]);
  assert.throws(() => cutsOf(ws, { A: "3" }), /no classification track/);
  const stop = cutsOf([makeWagon({ type: "sgns", track: 1 }, rng), makeWagon({ type: "sgns", track: 1, noHump: true }, rng), makeWagon({ type: "sgns", track: 1 }, rng)]);
  assert.deepEqual(stop.map((c) => c.noHump), [false, true, false], "a wagon that must not be humped is a cut of its own");
  // random trains: whole cuts, never the same track twice in a row
  const train = randomTrain(createRng(3), { wagons: 40, tracks: ["1", "2", "3"] });
  assert.ok(train.length >= 40 && train.length < 44);
  const groups = cutsOf(train.map((w) => makeWagon(w, rng)));
  for (let i = 1; i < groups.length; i++) assert.notEqual(groups[i].track, groups[i - 1].track);
  assert.deepEqual(randomTrain(createRng(3), { wagons: 40, tracks: ["1", "2", "3"] }), train, "deterministic");
});

test("physics: a free run agrees with the energy balance; the needed speeds run it back", () => {
  assert.equal(curveResistance(0), 0);
  near(curveResistance(190), 500 / 160, 1e-12, "Röckl below 300 m");
  near(curveResistance(400), 650 / 345, 1e-12, "Röckl from 300 m");
  // one loaded Eanos, 2 N/kN, no air, on −5 ‰: it gains (5 − 2) ‰ of its weight, less its rotating masses
  const yard = slope(-5);
  const w = wagon({ type: "eanos", loaded: 1, w_nkn: 2 });
  const body = cutBody([w]);
  const factor = body.eff_t / body.mass_t;
  const run = coast(yard, ["s"], body, 100, 1, 300);
  near(run.v * run.v, 1 + (2 * G * 0.003 * 200) / factor, 1e-6, "v² = v0² + 2 g (i − w) s / factor");
  // uphill it stops where its energy runs out
  const up = coast(slope(2), ["s"], body, 100, 3, 1000);
  assert.equal(up.reached, false);
  near(up.stop_m - 100, (9 * factor) / (2 * G * 0.004), 0.5, "stopping distance");
  // the speeds needed to arrive at 1 m/s, run forwards again, arrive at 1 m/s
  const need = requiredSpeeds(slope(1), ["s"], body, 50, 450, 1);
  const back = coast(slope(1), ["s"], body, 50, need.at(50), 450);
  near(back.v, 1, 0.01, "forwards and backwards agree");
  assert.ok(need.at(50) > need.at(250) && need.at(250) > need.at(450), "it needs more the farther it has to go");
  // on a steep fall any speed would do: it needs nothing
  near(requiredSpeeds(slope(-20), ["s"], body, 50, 450, 1).at(50), 0, 1e-9, "downhill");
  // air: the wagon behind has a share of the drag area, the wind adds to the speed
  const a = makeWagon({ type: "eanos", loaded: 1, w_nkn: 2 }, rng), b = makeWagon({ type: "eanos", loaded: 1, w_nkn: 2 }, rng);
  const two = cutBody([a, b]);
  const still = cutForces(slope(0), ["s"], two, 500, 4), windy = cutForces(slope(0), ["s"], two, 500, 4, { wind_mps: 4 });
  near(-still.drive, (0.5 * 1.25 * (a.cwA + 0.2 * b.cwA) * 16) / 1000, 1e-9, "air on a level track");
  near(windy.drive / still.drive, 4, 1e-9, "a head wind as fast as the cut: four times the air resistance");
  // a cut over the crest: gravity of the part beyond it only
  const crest = new HumpYard({ segments: [{ id: "c", length_m: 200, grades: [[0, 20], [100, 20], [100.001, -40]] }] });
  const f = cutForces(crest, ["c"], body, 100 + body.length_m / 2, 0);
  near(f.drive, (body.mass_t * G * (40 - 20)) / 2 / 1000, 0.05, "half the wagon on each side of the crest");
  // energy height: the height of the centre of mass and the speed height with the rotating masses
  near(energyHeight(yard, ["s"], body, 300, 2) - energyHeight(yard, ["s"], body, 300, 0), (4 * factor) / (2 * G), 1e-9, "speed height");
});

test("a cut runs free at the crest when gravity pulls it faster than the train", () => {
  const yard = standardYard();
  const sim = new HumpSimulation(yard, { seed: 1 });
  sim.hump({ id: "A", wagons: [
    { type: "eanos", loaded: 1, track: "4" }, { type: "habbins", loaded: 1, track: "5" }, { type: "habbins", loaded: 1, track: "5" }, { type: "sgns", loaded: 0, track: "4" },
  ] });
  for (let i = 0; i < 4000 && (sim.queue.length || sim.pushing); i++) sim.step();
  const cuts = humped(sim);
  assert.equal(cuts.length, 3);
  for (const c of cuts) {
    // its centre of mass has just passed the crest: the front is about half its length beyond it
    const ahead = c.rec.released_s - yard.crest_m;
    assert.ok(ahead > 0 && ahead < c.body.length_m, `${c.id}: front ${ahead} m beyond the crest, ${c.body.length_m} m long`);
    assert.ok(!c.pushedOver);
  }
  // the train moves at its pushing speed until its last cut is free: the second cut's front was the first one's length behind
  for (let i = 1; i < cuts.length; i++) {
    const [a, b] = [cuts[i - 1], cuts[i]];
    near(b.rec.released_t - a.rec.released_t, (b.rec.released_s - a.rec.released_s + a.body.length_m) / SPEEDS.push_mps, 0.06, "time between two cuts");
  }
  assert.equal(sim.log.filter((e) => e.type === "cut.released").length, 3);
});

test("humping a train on the standard yard: every cut in its track, gently, no switch under a cut", () => {
  const yard = standardYard();
  const sim = new HumpSimulation(yard, { seed: 2 });
  sim.hump({ id: "A", wagons: randomTrain(createRng(102), { wagons: 30, tracks: yard.tracks.map((t) => t.name) }) });
  const r = sim.run();
  assert.equal(r.trains, 1);
  assert.ok(r.wagons >= 30 && r.wagons < 34, `${r.wagons} wagons: the last cut whole`);
  assert.equal(r.misrouted, 0);
  assert.equal(r.derailed, 0);
  assert.equal(r.short, 0);
  assert.equal(r.overspeed, 0, "no cut enters a retarder too fast");
  assert.ok(r.hard <= 1, `${r.hard} hard impacts`);
  assert.ok(r.max_impact_mps < 1.7, `max impact ${r.max_impact_mps}`);
  assert.ok(r.cuts_per_hour > 100 && r.cuts_per_hour < 250, `${r.cuts_per_hour} cuts per hour`);
  for (const c of r.perCut) {
    assert.equal(c.ended, c.track, `${c.id} ended in ${c.ended}, not ${c.track}`);
    assert.ok(c.main && c.group, `${c.id} passed both retarders`);
    assert.ok(c.main.in_mps >= 4 && c.main.in_mps <= RETARDERS.main.vmax_in_mps, `${c.id} enters the main retarder at ${c.main.in_mps}`);
    assert.ok(c.main.out_mps >= SPEEDS.main_out_mps - 0.4, `${c.id} leaves the main retarder at ${c.main.out_mps}`);
    assert.ok(c.main.taken_m <= RETARDERS.main.capacity_m + 1e-6, `${c.id}: the main retarder took ${c.main.taken_m} m`);
    assert.ok(c.group.in_mps <= RETARDERS.group.vmax_in_mps, `${c.id} enters its group retarder at ${c.group.in_mps}`);
  }
  // the tracks hold every wagon, the cuts in them do not overlap
  assert.equal(r.tracks.reduce((n, t) => n + t.wagons, 0), r.wagons);
  for (const t of r.tracks) {
    const cuts = t.cuts.map((id) => sim.cuts.find((c) => c.id === id));
    for (let i = 1; i < cuts.length; i++) assert.ok(cuts[i].s <= cuts[i - 1].s - cuts[i - 1].body.length_m + 1e-6, `track ${t.name}: overlap`);
    assert.ok(t.free_m >= 0 && t.free_m <= t.length_m);
  }
  // every switch was thrown only while no cut was in its detection section (no derailment), and cuts were sorted
  assert.ok(sim.log.some((e) => e.type === "switch.thrown"));
  assert.ok(r.tracks.filter((t) => t.wagons > 0).length >= 6);
});

test("impacts are plastic: the momentum is kept", () => {
  const yard = standardYard({ design: "target" });
  const sim = new HumpSimulation(yard, { seed: 3 });
  sim.hump({ id: "A", wagons: randomTrain(createRng(103), { wagons: 30, tracks: ["2", "3"] }) });
  sim.run();
  const hits = humped(sim).flatMap((c) => c.rec.impacts);
  assert.ok(hits.length >= 5, `${hits.length} impacts`);
  for (const h of hits) {
    const [m, M] = h.masses_t, [v1, v2] = h.before_mps;
    near(h.v_mps, v1 - v2, 1e-9, "the impact speed is the difference");
    if (h.after_mps > 0) near((m + M) * h.after_mps, m * v1 + M * v2, 1e-6, "momentum");
  }
});

test("pushed too fast: a good runner catches up a bad one and is misrouted", () => {
  const yard = standardYard();
  const train = (push) => ({ id: "A", push_mps: push, wagons: [
    { type: "hbbillns", w_nkn: 4.2, track: "4" }, { type: "eanos", loaded: 1, w_nkn: 1, track: "5" }, { type: "eanos", loaded: 1, w_nkn: 1, track: "5" },
    { type: "hbbillns", w_nkn: 4.2, track: "1" }, { type: "habbins", loaded: 1, w_nkn: 1, track: "2" },
  ] });
  const slow = new HumpSimulation(yard, { seed: 1 });
  slow.hump(train(1.2));
  const ok = slow.run();
  assert.equal(ok.misrouted, 0);
  assert.equal(ok.caughtUp, 0);
  const fast = new HumpSimulation(yard, { seed: 1 });
  fast.hump(train(3));
  const bad = fast.run();
  assert.ok(bad.misrouted >= 1 && bad.caughtUp >= 1, `misrouted ${bad.misrouted}, caught up ${bad.caughtUp}`);
  assert.equal(bad.derailed, 0, "a switch is never thrown under a cut");
  const m = bad.perCut.find((c) => c.misrouted);
  assert.notEqual(m.ended, m.track);
  assert.ok(fast.log.some((e) => e.type === "cut.misrouted" && e.intended === m.track && e.now === m.ended));
  assert.ok(fast.log.some((e) => e.type === "cut.caught-up"));
  assert.ok(bad.cuts_per_hour > 2 * ok.cuts_per_hour, "but it is faster");
});

test("target braking alone: the error of the measured resistance makes hard impacts and gaps", () => {
  const yard = standardYard({ design: "target" });
  const run = (sd) => {
    const sim = new HumpSimulation(yard, { seed: 4, control: { estimate_sd: sd } });
    sim.hump({ id: "A", wagons: randomTrain(createRng(104), { wagons: 30, tracks: yard.tracks.map((t) => t.name) }) });
    return sim.run();
  };
  const exact = run(0), rough = run(0.6);
  assert.ok(exact.hard <= 3, `${exact.hard} hard impacts with the true resistance`);
  assert.ok(rough.hard + rough.gaps > exact.hard + exact.gaps + 4, `rough ${rough.hard} + ${rough.gaps}, exact ${exact.hard} + ${exact.gaps}`);
  for (const c of exact.perCut) assert.ok(c.group.out_mps >= SPEEDS.couple_mps - 0.3, "a group retarder lets no cut go below the coupling speed");
});

test("winter: more resistance and a head wind; more gaps, cuts still in their tracks", () => {
  const yard = standardYard();
  const run = (season) => {
    const sim = new HumpSimulation(yard, { seed: 5, season });
    sim.hump({ id: "A", wagons: randomTrain(createRng(105), { wagons: 30, tracks: yard.tracks.map((t) => t.name) }) });
    return { sim, r: sim.run() };
  };
  const summer = run("summer"), winter = run("winter");
  assert.equal(winter.sim.wind_mps, SEASONS.winter.wind_mps);
  assert.ok(winter.r.gaps > summer.r.gaps, `gaps: winter ${winter.r.gaps}, summer ${summer.r.gaps}`);
  assert.equal(winter.r.misrouted, 0);
  // the main retarder has less to do in the cold
  const taken = (r) => r.perCut.reduce((s, c) => s + c.main.taken_m, 0);
  assert.ok(taken(winter.r) < taken(summer.r));
});

test("wagons that must not be humped stay out; wagons to shunt with care aim lower", () => {
  const yard = standardYard();
  const sim = new HumpSimulation(yard, { seed: 1, control: { couple_mps: 1.2, careful_mps: 0.8 } });
  const rec = sim.hump({ id: "A", wagons: [
    { type: "zacns", loaded: 1, track: "3", careful: true }, { type: "zacns", loaded: 1, track: "3", noHump: true }, { type: "eanos", loaded: 1, track: "6" },
  ] });
  assert.equal(rec.skipped.length, 1);
  assert.equal(rec.cuts.length, 2);
  const r = sim.run();
  const [careful, plain] = r.perCut;
  assert.ok(careful.careful && !plain.careful);
  near(careful.group.need_mps, 0.8, 1e-9, "the careful wagon's aim");
  near(plain.group.need_mps, Math.min(1.2, RETARDERS.speed.hold_mps), 1e-9, "the others' aim");
  assert.ok(sim.log.some((e) => e.type === "cut.not-humped"));
});

test("several trains, deterministic runs, pulling a formed train out", () => {
  const yard = standardYard({ tracks: 4 });
  const make = (seed) => {
    const sim = new HumpSimulation(yard, { seed, dt: 0.1, train_gap_s: 60 });
    const r = createRng(seed);
    for (const id of ["A", "B"]) sim.hump({ id, wagons: randomTrain(r, { wagons: 12, tracks: ["1", "2", "3", "4"] }) });
    return sim;
  };
  const one = make(7), two = make(7), other = make(8);
  const a = one.run(), b = two.run();
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), "the same seed, the same run");
  assert.notDeepEqual(other.run().perCut.map((c) => c.w), a.perCut.map((c) => c.w));
  assert.equal(a.trains, 2);
  const [ra, rb] = one.trains;
  assert.ok(rb.started_t >= ra.humped_t + 60, "the second train starts after the first one and the time between them");
  // the track with the most wagons is pulled out as a train
  const full = [...a.tracks].sort((x, y) => y.wagons - x.wagons)[0];
  const out = one.pullOut(full.name);
  assert.equal(out.wagons.length, full.wagons);
  assert.equal(out.track, full.name);
  near(out.gaps_m, full.gaps_m, 1e-9, "the gaps closed");
  assert.equal(one.trackContents(full.name).wagons, 0);
  assert.equal(one.departures.length, 1);
  assert.ok(humped(one).filter((c) => c.state === "departed").length === out.cuts.length);
  // the first wagon of the train is the one at the end of the track
  const first = humped(one).find((c) => c.id === out.cuts[0]);
  assert.ok(out.cuts.every((id) => humped(one).find((c) => c.id === id).s <= first.s));
  assert.ok(SWITCHES.throw_s > 0 && STANDARD_YARD.track_m > 0);
});

test("full tracks are pulled out as trains, so that train after train can be humped", () => {
  const yard = standardYard({ tracks: 4, track_m: 250 });
  const run = (pull) => {
    const sim = new HumpSimulation(yard, { seed: 9, dt: 0.1, train_gap_s: 60, pull_below_m: pull });
    const r = createRng(9);
    for (const id of ["A", "B", "C", "D"]) sim.hump({ id, wagons: randomTrain(r, { wagons: 15, tracks: ["1", "2", "3", "4"] }) });
    return { sim, r: sim.run() };
  };
  const kept = run(null), pulled = run(60);
  assert.equal(kept.sim.departures.length, 0);
  assert.ok(kept.r.short > 0, `${kept.r.short} cuts stopped short in full tracks`);
  assert.ok(pulled.sim.departures.length >= 3, `${pulled.sim.departures.length} trains pulled out`);
  assert.equal(pulled.r.short, 0, "room again for every cut");
  assert.ok(pulled.sim.log.some((e) => e.type === "track.pulled"));
  for (const d of pulled.sim.departures) assert.ok(d.length_m > yard.tracks[0].length_m - 60 - 30, `a train of ${d.length_m} m`);
});

test("the diagrams of a run: one line per cut in each panel, the problems marked, light and dark", () => {
  assert.deepEqual(niceTicks(0, 1000, 5), [0, 200, 400, 600, 800, 1000]);
  assert.deepEqual(niceTicks(-4.2, 2.7, 4), [-4, -2, 0, 2]);
  assert.deepEqual(simplify([[0, 0], [1, 0.01], [2, 0], [3, 5]]), [[0, 0], [2, 0], [3, 5]]);
  const yard = standardYard();
  const wagons = [
    { type: "hbbillns", w_nkn: 4.2, track: "4" }, { type: "eanos", loaded: 1, w_nkn: 1, track: "5" }, { type: "eanos", loaded: 1, w_nkn: 1, track: "5" },
    { type: "hbbillns", w_nkn: 4.2, track: "1" }, { type: "habbins", loaded: 1, w_nkn: 1, track: "2" },
  ];
  const fast = new HumpSimulation(yard, { seed: 1, trace: true, trace_s: 1 });
  fast.hump({ id: "A", push_mps: 3, wagons });
  const r = fast.run();
  const svg = humpDiagrams(fast);
  assert.ok(svg.startsWith("<svg") && svg.trim().endsWith("</svg>"));
  assert.match(svg, /<title id="hump-title">Standard hump: 4 cuts of 1 train<\/title>/);
  const cuts = fast.cuts.filter((c) => c.order != null);
  assert.equal((svg.match(/<g class="cut (good|medium|bad)"><title>/g) || []).length, 3 * cuts.length, "a line per cut in each of the three panels");
  assert.equal((svg.match(/<g class="problem"><title>/g) || []).length, r.misrouted + r.hard + r.short);
  assert.ok(r.misrouted >= 1 && svg.includes("misrouted"));
  for (const k of Object.keys(CLASS_LABELS)) assert.ok(svg.includes(CLASS_LABELS[k]));
  assert.match(svg, /prefers-color-scheme: dark/);
  assert.equal(cutClass(cuts[0]), "bad");
  assert.equal(cutClass(cuts[1]), "good");
  // the same run, the same picture; a run without a trace has none
  const again = new HumpSimulation(yard, { seed: 1, trace: true, trace_s: 1 });
  again.hump({ id: "A", push_mps: 3, wagons });
  again.run();
  assert.equal(humpDiagrams(again), svg);
  assert.throws(() => humpDiagrams(new HumpSimulation(yard)), /trace: true/);
  // timeRun agrees with the simulation's free run on a slope
  const body = cutBody([makeWagon({ type: "eanos", loaded: 1, w_nkn: 2, cwA_m2: 0 }, rng)]);
  const tr = timeRun(slope(-5), ["s"], body, 100, 1, 2000, { dt: 0.1 });
  const a = (G * 0.003 * body.mass_t) / body.eff_t;
  near(tr.at(20).v, 1 + a * 20, 0.01, "v = v0 + a t");
  near(tr.at(20).s, 100 + 20 + (a * 400) / 2, 0.1, "s = s0 + v0 t + a t²/2");
});

test("pulling out takes the cuts of the track's contents, never an empty track; the run's limit and the wagons' ids", () => {
  const yard = standardYard();
  // winter: cuts stop short in front of their tracks; they are no part of the track's train
  const sim = new HumpSimulation(yard, { seed: 1, season: "winter" });
  const r = createRng(1001);
  for (const id of ["T1", "T2"]) sim.hump({ id, push_mps: 1.2, wagons: randomTrain(r, { wagons: 30, tracks: yard.tracks.map((t) => t.name) }) });
  const res = sim.run();
  assert.ok(res.short > 0, "cuts stopped short");
  const ids = sim.cuts.flatMap((c) => c.wagons.map((w) => w.id));
  assert.equal(new Set(ids).size, ids.length, "every wagon's id is its own, also across trains");
  assert.ok(ids.includes("T2.1") && !ids.includes("W1"));
  const short = new Set(res.perCut.filter((c) => c.stop && !c.ended).map((c) => c.id));
  for (const t of yard.tracks) {
    const before = sim.trackContents(t.name);
    const out = sim.pullOut(t.name);
    assert.deepEqual(out.cuts, before.cuts, `track ${t.name}: the cuts of its contents`);
    assert.equal(out.wagons.length, before.wagons);
    assert.equal(out.gaps_m, before.gaps_m);
    assert.ok(out.cuts.every((id) => !short.has(id)));
  }
  assert.equal(sim.bodies.filter((b) => short.has(b.id)).length, short.size, "the cuts stopped short stay");
  // a threshold above the tracks' length pulls out tracks with wagons only
  const eager = new HumpSimulation(yard, { seed: 1, pull_below_m: 800 });
  eager.hump({ id: "A", wagons: randomTrain(createRng(2), { wagons: 20, tracks: yard.tracks.map((t) => t.name) }) });
  eager.run();
  assert.ok(eager.departures.length > 0 && eager.departures.every((d) => d.wagons.length > 0));
  assert.equal(eager.log.filter((e) => e.type === "track.pulled").length, eager.departures.length);
  // stopped at its longest time: the trains not humped are not counted as humped
  const short2 = new HumpSimulation(yard, { seed: 1, max_s: 200 });
  for (const id of ["A", "B"]) short2.hump({ id, wagons: randomTrain(createRng(3), { wagons: 30, tracks: yard.tracks.map((t) => t.name) }) });
  const cut = short2.run();
  assert.ok(cut.limit_reached);
  assert.equal(cut.trains + cut.waiting, 2);
  assert.ok(cut.waiting >= 1, `${cut.waiting} trains waiting`);
  assert.ok(short2.log.some((e) => e.type === "run.limit"));
});

test("the command line refuses an option without its value", () => {
  const run = (...args) => spawnSync(process.execPath, [join(ROOT, "tools/hump.mjs"), ...args], { cwd: ROOT, encoding: "utf8" });
  for (const args of [["--json", "--quiet"], ["--quiet", "--svg"], ["--trains"], ["--push", "fast"]]) {
    const p = run(...args);
    assert.equal(p.status, 1, `${args.join(" ")}: ${p.stdout}`);
    assert.match(p.stderr, /needs a (value|number)/);
  }
  const ok = run("--wagons", "6", "--tracks", "2", "--quiet");
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /1 train\(s\), \d+ cuts/);
});
