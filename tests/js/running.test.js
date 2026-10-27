// Train protection and the track ahead (rail/protection.js, rail/ahead.js) and the running dynamics
// on a train's card (rail/running.js): PZB train types and curves, the braking curves of ETCS, which
// system supervises a train, the path ahead over joined tracks with its line data, the signals and
// magnets on it, the card of the lab's RE 1 with its charts, a train of the control system too fast
// for its brakes before a signal, slippery rails as a disruption, and all of it in German.
import assert from "node:assert/strict";
import test from "node:test";

import {
  Consist, PZB, createWorld, etcsCurves, lineAlong, magnetsAhead, pathAhead, pzb1000, pzb500, pzbApproach, pzbType, railCondition, registry,
  signalsAhead, supervision, trackAheadOf, trackLength, trainModel, Translator,
} from "../../web/arail/index.js";
import { DE as APP_DE } from "../../web/app/lang/de.js";
import { readJSON } from "./helpers.js";

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not ${b} ± ${tol}`);

test("PZB 90: train types by brake percentage, the 1000 Hz curve over time, the 500 Hz curve over distance", () => {
  assert.equal(pzbType(65), "U");
  assert.equal(pzbType(66), "M");
  assert.equal(pzbType(110.9), "M");
  assert.equal(pzbType(111), "O");
  assert.equal(pzb1000("M", 0), 125);
  near(pzb1000("M", 14.5), (125 + 70) / 2, 1e-9, "halfway");
  assert.equal(pzb1000("M", 29), 70);
  assert.equal(pzb1000("U", 100), 55);
  assert.equal(pzb500("O", 0), 65);
  assert.equal(pzb500("O", 153), 45);
  assert.equal(pzb500("U", 400), 25);
  // a freight train braked in P (type M) passes the 1000 Hz magnet: from 120 km/h the curve (125 km/h,
  // falling 1.9 km/h a second) catches it within seconds when it brakes gently; from 100 km/h braking
  // as it should, it stops at the signal below the curves
  const freight = new Consist({ brake_position: "P", vehicles: [{ type: "br185" }, { type: "sgns", count: 20, loaded: true }] });
  assert.equal(pzbType(freight.brakePercentage), "M");
  const m = trainModel(freight);
  const soft = pzbApproach(m, { v0_kmh: 120, decel: 0.3 });
  assert.ok(soft.forced && soft.forced.t > 2 && soft.forced.t < PZB.M.t1000_s, `forced after ${soft.forced?.t} s`);
  const firm = pzbApproach(m, { v0_kmh: 100 });
  assert.equal(firm.forced, null);
  assert.ok(firm.stop_m <= 1000 + 1, `stops at ${firm.stop_m} m`);
});

test("ETCS braking curves: permitted below warning below intervention below the emergency braking curve", () => {
  const m = trainModel(new Consist({ vehicles: [{ type: "br193" }, { type: "bpmz", count: 6 }] }));
  const e = etcsCurves(m, 2000, { vmax_kmh: 160 });
  for (const q of e.points) {
    assert.ok(q.p <= q.w + 1e-9 && q.w <= q.ebi + 1e-9, `at ${q.s} m: P ${q.p}, W ${q.w}, EBI ${q.ebi}`);
    if (q.ebd > e.release_kmh) assert.ok(q.ebi <= q.ebd + 1e-9, `at ${q.s} m: EBI ${q.ebi}, EBD ${q.ebd}`);
    assert.ok(q.ebd <= 160 + 1e-9);
  }
  const end = e.points[e.points.length - 1];
  assert.equal(end.ebd, 0);
  near(end.p, e.release_kmh, 1e-9, "the release speed at the end of authority");
});

test("which system supervises a train: ETCS, LZB, PZB or another national one", () => {
  const re = new Consist({ vehicles: [{ type: "br146" }, { type: "dbpza", count: 4 }] });
  const ec = new Consist({ vehicles: [{ type: "br193" }, { type: "bpmz", count: 6 }] });
  assert.equal(supervision(re, {}).system, "pzb");
  assert.equal(supervision(re, { train_control: "pzb_lzb" }).system, "lzb");
  assert.equal(supervision(ec, { etcs: "l2" }).system, "etcs");
  assert.equal(supervision(re, { etcs: "l2" }).system, "pzb", "without ETCS on board, PZB");
  assert.deepEqual(supervision(ec, { country: "CZ" }), { system: "other", name: "LS" });
});

test("the path ahead: on over tracks that join end to end, in prototype metres; the line data as the train runs", () => {
  const world = createWorld({
    scale: 87,
    objects: [
      { id: "a", type: "track", track_id: "A", points: [[0, 0], [1000, 0]], gradient_permille: 10, max_speed_kmh: 80 },
      // joins the end of a with its own end: a train runs along it towards its first point
      { id: "b", type: "track", track_id: "B", points: [[2000, 0], [1000, 0]], gradient_permille: 5, length_m: 500, curve_radius_m: 400, rail_condition: "wet" },
    ],
  });
  const [a, b] = ["a", "b"].map((id) => world.getObject(id));
  near(trackLength(a), 87, 1e-9, "a track on the model, at the scale");
  assert.equal(trackLength(b), 500, "a track standing for a longer one");
  const p = pathAhead(world, a, 500, 1, 400);
  assert.equal(p.parts.length, 2);
  assert.equal(p.parts[1].track, b);
  assert.equal(p.parts[1].dir, -1);
  near(p.parts[0].s1, 43.5, 1e-9, "the rest of a");
  near(p.length_m, 400, 1e-9, "as far as asked");
  assert.equal(p.ends, false);
  const all = pathAhead(world, a, 500, 1, 2000);
  assert.ok(all.ends && Math.abs(all.length_m - 543.5) < 1e-6, "the tracks end");
  const line = lineAlong(world, all, { beyond_m: 1000 });
  assert.equal(line.sections[0].permille, 10, "rising as the train runs");
  assert.equal(line.sections[1].permille, -5, "b falls the way the train runs along it");
  assert.equal(line.sections[1].radius_m, 400);
  assert.equal(line.sections[1].condition, "wet");
  assert.equal(line.sections[0].kmh, 80);
  assert.ok(line.sections[2].beyond && line.length_m === all.length_m + 1000, "the line beyond the layout");
});

test("signals and PZB magnets ahead: those that face the train, the magnets they imply", () => {
  const world = createWorld({
    scale: 87,
    objects: [
      { id: "t", type: "track", track_id: "T", points: [[0, 0], [20000, 0]] },
      { id: "vs", type: "signal", name: "Distant signal", kind: "distant", position: [3000, -40], rotation_deg: 0 },
      { id: "hs", type: "signal", name: "Main signal", kind: "main", position: [14500, -40], rotation_deg: 0 },
      { id: "back", type: "signal", name: "The other way", kind: "main", position: [9000, 40], rotation_deg: 180 },
    ],
  });
  const t = world.getObject("t");
  const p = pathAhead(world, t, 1000, 1, 1500);
  const s = signalsAhead(world, p);
  assert.deepEqual(s.map((x) => x.signal.id), ["vs", "hs"]);
  near(s[0].s, (2000 * 87) / 1000, 1e-6, "the distant signal");
  const g = magnetsAhead(world, p, s);
  assert.deepEqual(g.map((x) => x.hz), ["1000", "500", "2000"]);
  near(g[1].s, s[1].s - 250, 1e-6, "500 Hz 250 m before the main signal");
  // running the other way, only the signal facing that way
  assert.deepEqual(signalsAhead(world, pathAhead(world, t, 19000, -1, 2000)).map((x) => x.signal.id), ["back"]);
});

/** The lab example with RE 1 standing at track G3 of platform 1, and the hit of it. */
function labRE(extra = []) {
  const json = readJSON("web/layouts/ebl-lab.json");
  for (const l of json.layers) l.enabled = false;
  json.objects.push(...extra);
  const world = createWorld(json);
  world.services.call("platform-1:right", { line: "RE 1" });
  for (let i = 0; i < 100; i++) world.step(0.1);
  const v = world.services.vehicles().find((x) => x.line === "RE 1" && x.dock.track === "G3");
  assert.ok(v, "RE 1 at G3");
  return { world, v, hit: { key: `vehicle:${v.id}`, kind: "train", label: v.line, outline: [], owner: world.services, ref: v } };
}

test("the card of a train: its run with charts, braking and PZB, adhesion and couplings, energy and coasting", () => {
  const { world, hit } = labRE();
  const card = world.card(hit);
  const titles = card.sections.map((s) => s.title);
  for (const t of ["Run", "Braking and train protection", "Adhesion and forces", "Energy and driving style"]) assert.ok(titles.includes(t), `${t} in ${titles}`);
  const run = card.sections.find((s) => s.title === "Run");
  const rows = Object.fromEntries(run.rows);
  assert.match(rows.Distance, /^From its stop to the next one · 4\.0 km · \d+ m on the layout$/);
  assert.match(rows["Minimum running time"], /^\d+:\d\d min$/);
  assert.equal(run.charts.length, 2);
  const vs = run.charts[0];
  assert.ok(vs.series.find((x) => x.tone === "train").points.length > 50 && vs.marks.some((m) => m.label === "end of the layout"));
  const braking = Object.fromEntries(card.sections.find((s) => s.title === "Braking and train protection").rows);
  assert.match(braking["Full braking from 120 km/h"], /^\d+ m · Minden formula$/);
  assert.equal(braking["Train protection here"], "PZB 90");
  assert.match(braking["Train type"], /^O \(upper\) · up to 165 km\/h$/);
  // the couplings of RE 1 on its strip: the one behind the locomotive pulls most
  assert.ok(card.strip[0].pull_kn > card.strip[3].pull_kn && card.strip[0].pull === "low");
  const energy = Object.fromEntries(card.sections.find((s) => s.title === "Energy and driving style").rows);
  assert.match(energy["Energy for the run"], /kWh from the contact line$/);
  assert.match(energy.Coasting, /^from .* to the stop · \d+ s longer · [\d.]+ kWh less \(\d+ %\)$/);
  // worked out once: the second card comes from what is kept on the train
  const t0 = performance.now();
  world.card(hit);
  assert.ok(performance.now() - t0 < 15, "the second card is quick");
  // the track ahead of it on the table: the run from its stop on, beyond the layout
  const a = trackAheadOf(world, hit);
  assert.equal(a.on.track.spec.track_id, "G3");
  assert.ok(a.path.ends && a.line.sections.at(-1).beyond);
  assert.equal(a.braking.standing, true, "standing: the braking distance from the line speed");
});

test("a train of the control system too fast for its brakes before a main signal: the card says so", () => {
  const signal = { id: "sig", type: "signal", name: "Signal A", kind: "main", position: [1100, -60], rotation_deg: 1.5 };
  const json = readJSON("web/layouts/ebl-lab.json");
  for (const l of json.layers) l.enabled = false;
  json.objects.push(signal);
  const world = createWorld(json);
  // RE 1 reported on G3, heading for its last point at 300 mm/s on the model (94 km/h)
  world.trains.apply({ type: "trains", trains: [{ id: "RE 1", name: "RE 1", track: "G3", offset_mm: 800, speed_mm_s: 300, direction: 1, length_mm: 1400 }] });
  const t = world.trains.trains.get("RE 1");
  const hit = { key: "feed:RE 1", kind: "train", label: "RE 1", outline: [], owner: world.trains, ref: t };
  const a = trackAheadOf(world, hit);
  near(a.v_kmh, (300 * 87 * 3.6) / 1000, 1e-6, "its speed in the prototype");
  assert.equal(a.main?.signal.id, "sig");
  assert.ok(a.braking.distance_m > a.main.s, "it does not stop before the signal");
  const card = world.card(hit);
  assert.equal(card.tone, "bad");
  assert.match(card.status, /too fast for its brakes/);
});

test("slippery rails: leaves on a platform's track slow its trains; the card uses them", () => {
  const { world, hit } = labRE();
  const g3 = world.objects.find((o) => o.spec.track_id === "G3");
  const before = trackAheadOf(world, hit).profile.time_s;
  const d = world.disruptions.start({ type: "low-adhesion", target: "platform-1:right", params: { condition: "leaves" } });
  assert.equal(railCondition(world, g3), "leaves");
  const area = world.stopAreas().find((x) => x.docks?.some((k) => k.id === "platform-1:right"));
  const fx = world.disruptions.effectsFor(area, area.docks.find((k) => k.id === "platform-1:right"));
  assert.ok(fx.slow > 1.5, `slow ${fx.slow}`);
  assert.ok(fx.messages.some((m) => /^Leaves on the rails · trains run slower/.test(m)));
  const card = world.card(hit);
  assert.match(Object.fromEntries(card.sections.find((s) => s.title === "Adhesion and forces").rows).Rails, /^Leaves on the rails · adhesion 0\.05/);
  assert.ok(trackAheadOf(world, hit).profile.time_s > before, "the run takes longer");
  world.disruptions.stop(d.id);
  assert.equal(railCondition(world, g3), "dry");
});

test("the running dynamics in German: every text of the card is translated", () => {
  const t = new Translator("de");
  for (const [l, entries] of registry.texts) t.add(l, entries);
  t.add("de", APP_DE);
  const { world, hit } = labRE();
  world.disruptions.start({ type: "low-adhesion", target: "platform-1:right", params: { condition: "wet" } });
  const card = world.card(hit);
  const texts = [card.status];
  for (const s of card.sections) {
    texts.push(s.title, ...(s.lines || []));
    for (const [k, v] of s.rows || []) texts.push(k, String(v));
    for (const c of s.charts || []) texts.push(c.label, ...c.series.map((x) => x.label), ...(c.marks || []).map((m) => m.label));
  }
  for (const s of texts.filter(Boolean)) t.translate(s);
  const names = ["RE 1", "BR 146.2", "DBpza", "Platform 1", "Track G3", "PZB 90", "EBD", "EBI"];
  const english = [...t.missing].filter((s) => {
    let rest = s;
    for (const n of names) rest = rest.split(n).join(" ");
    rest = rest.replace(/\b(mm|m|t|t\/m|km\/h|km|kN|kWh|Wh|s|min|kg|l|Hz|‰|in)\b/g, " ");
    return /\b[a-z]{3,}\b/.test(rest);
  });
  assert.deepEqual(english, [], `still English:\n${english.join("\n")}`);
});
