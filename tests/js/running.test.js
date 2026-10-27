// Train protection and the track ahead (rail/protection.js, rail/ahead.js) and the running dynamics
// on a train's card (rail/running.js): PZB train types and curves, the braking curves of ETCS, which
// system supervises a train, the path ahead over joined tracks with its line data (and at a joint of
// several), the signals and magnets on it (each signal of its nearest track), the card of the lab's
// RE 1 with its charts, a train coming in, trains that cannot run, a train of the control system too
// fast for its brakes before a signal, the track ahead drawn once a frame, slippery rails as a
// disruption, and all of it in German.
import assert from "node:assert/strict";
import test from "node:test";

import {
  Camera, Consist, FlyCamera, NEXT_STOP_M, PZB, View, createWorld, drawTrackAhead, etcsCurves, lineAlong, magnetsAhead, pathAhead, pzb1000, pzb500, pzbApproach,
  pzbType, railCondition, registry, signalsAhead, speedAt, supervision, toRad, trackAheadOf, trackLength, trainModel, Translator,
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
  assert.equal(line.sections[1].kmh, 120, "the open line's speed where a track has none");
  assert.ok(line.sections[2].beyond && line.length_m === all.length_m + 1000, "the line beyond the layout");
});

test("the path ahead at a joint of several tracks: on along the one that turns least, never back the way it came", () => {
  // a runs to the joint at (1000, 0); d ends there too, coming from the same side (it comes first in
  // the objects); b goes on, c branches off at a small angle
  const world = createWorld({
    scale: 87,
    objects: [
      { id: "a", type: "track", track_id: "A", points: [[0, 0], [1000, 0]] },
      { id: "d", type: "track", track_id: "D", points: [[0, 120], [600, 100], [1000, 0]] },
      { id: "c", type: "track", track_id: "C", points: [[1000, 0], [2000, 150]] },
      { id: "b", type: "track", track_id: "B", points: [[1000, 0], [2000, 0]] },
    ],
  });
  const p = pathAhead(world, world.getObject("a"), 500, 1, 500);
  assert.deepEqual(p.parts.map((x) => x.track.id), ["a", "b"]);
  assert.equal(p.parts[1].dir, 1);
  // coming the other way along b, it goes on along a, not back along c or d
  assert.deepEqual(pathAhead(world, world.getObject("b"), 500, -1, 500).parts.map((x) => x.track.id), ["b", "a"]);
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

test("PZB magnets per signal: a placed magnet stands for the one a signal implies there, the other signals keep theirs", () => {
  const world = createWorld({
    scale: 87,
    objects: [
      { id: "t", type: "track", track_id: "T", points: [[0, 0], [20000, 0]] },
      { id: "vs", type: "signal", name: "Distant signal", kind: "distant", position: [3000, -40], rotation_deg: 0 },
      { id: "hs", type: "signal", name: "Main signal", kind: "main", position: [14500, -40], rotation_deg: 0 },
      // the distant signal's magnet, placed 2 m before it
      { id: "m1", type: "balise", position: [2977, 0], pzb_hz: "1000" },
    ],
  });
  const p = pathAhead(world, world.getObject("t"), 1000, 1, 1500);
  const g = magnetsAhead(world, p);
  assert.deepEqual(g.map((x) => `${x.hz}${x.placed ? " placed" : ""}`), ["1000 placed", "500", "2000"]);
});

test("the braking distance on the gradient and the rails where the front is, not where the run begins", () => {
  // the front at the end of a, on the way onto b, which falls 20 ‰ the way the train runs and is wet
  const world = createWorld({
    scale: 87,
    consists: [{ lines: ["RE 1"], vehicles: [{ type: "br146" }, { type: "dbpza", count: 4 }] }],
    objects: [
      { id: "a", type: "track", track_id: "A", points: [[0, 0], [3000, 0]] },
      { id: "b", type: "track", track_id: "B", points: [[3000, 0], [9000, 0]], gradient_permille: -20, rail_condition: "wet" },
    ],
  });
  world.trains.apply({ type: "trains", trains: [{ id: "RE 1", name: "RE 1", track: "A", offset_mm: 3000, speed_mm_s: 300, direction: 1, length_mm: 1400 }] });
  const a = trackAheadOf(world, { key: "feed:RE 1", kind: "train", label: "RE 1", outline: [], owner: world.trains, ref: world.trains.trains.get("RE 1") });
  assert.equal(a.permille, -20);
  assert.equal(a.condition, "wet");
});

test("a signal belongs to the track nearest to it: the signal of the next track is not this train's", () => {
  const world = createWorld({
    scale: 87,
    objects: [
      { id: "t1", type: "track", track_id: "1", points: [[0, 0], [5000, 0]] },
      { id: "t2", type: "track", track_id: "2", points: [[0, 57.5], [5000, 57.5]] },
      // between the tracks (5 m apart), 2.2 m from track 2 and 2.8 m from track 1
      { id: "n2", type: "signal", name: "N2", kind: "main", position: [3000, 32.5], rotation_deg: 0 },
      { id: "b2", type: "balise", position: [2000, 57.5], pzb_hz: "1000" },
    ],
  });
  const on1 = pathAhead(world, world.getObject("t1"), 100, 1, 1000), on2 = pathAhead(world, world.getObject("t2"), 100, 1, 1000);
  assert.deepEqual(signalsAhead(world, on1), []);
  assert.deepEqual(signalsAhead(world, on2).map((x) => x.signal.id), ["n2"]);
  assert.deepEqual(magnetsAhead(world, on1, []), [], "the magnet of track 2");
  assert.deepEqual(magnetsAhead(world, on2, []).map((x) => x.hz), ["1000"]);
  // the lab's exit signals stand between its platform tracks, each nearer to its own
  const json = readJSON("web/layouts/ebl-lab.json");
  for (const l of json.layers) l.enabled = l.id === "infrastructure";
  const lab = createWorld(json);
  for (const [id, track, name] of [["RB 33", "G2", "Exit signal N2"], ["RE 1", "G1", "Exit signal N1"]]) {
    lab.trains.apply({ type: "trains", trains: [{ id, name: id, track, offset_mm: 300, speed_mm_s: 150, direction: 1, length_mm: 900 }] });
    const a = trackAheadOf(lab, { key: `feed:${id}`, kind: "train", label: id, outline: [], owner: lab.trains, ref: lab.trains.trains.get(id) });
    assert.deepEqual(a.signals.map((x) => x.signal.spec.name), [name], `${id} on ${track}`);
  }
});

test("PZB magnets on the track ahead only where PZB or LZB supervises the train", () => {
  const objects = (spec) => [
    { id: "t", type: "track", track_id: "T", points: [[0, 0], [20000, 0]], ...spec },
    { id: "vs", type: "signal", name: "Distant signal", kind: "distant", position: [3000, -40], rotation_deg: 0 },
  ];
  const ahead = (spec) => {
    const world = createWorld({ scale: 87, consists: [{ lines: ["EC 1"], vehicles: [{ type: "br193" }, { type: "bpmz", count: 6 }] }], objects: objects(spec) });
    world.trains.apply({ type: "trains", trains: [{ id: "EC 1", name: "EC 1", track: "T", offset_mm: 1000, speed_mm_s: 200, direction: 1, length_mm: 1400 }] });
    return trackAheadOf(world, { key: "feed:EC 1", kind: "train", label: "EC 1", outline: [], owner: world.trains, ref: world.trains.trains.get("EC 1") });
  };
  const pzb = ahead({});
  assert.equal(pzb.control.system, "pzb");
  assert.deepEqual(pzb.magnets.map((x) => x.hz), ["1000"]);
  const etcs = ahead({ etcs: "l2" });
  assert.equal(etcs.control.system, "etcs");
  assert.deepEqual(etcs.magnets, [], "ETCS: no magnets");
  assert.ok(etcs.etcs?.points.length, "its braking curves");
});

test("ETCS: the end of authority assumed at the train's next stop, not where the layout's tracks end", () => {
  // a short track of the lab (87 m), the train at 47 km/h, a main signal ahead
  const world = createWorld({
    scale: 87,
    consists: [{ lines: ["EC 1"], vehicles: [{ type: "br193" }, { type: "bpmz", count: 6 }] }],
    objects: [
      { id: "t", type: "track", track_id: "T", points: [[0, 0], [1000, 0]], etcs: "l2" },
      { id: "hs", type: "signal", name: "Main signal", kind: "main", position: [600, -40], rotation_deg: 0 },
    ],
  });
  world.trains.apply({ type: "trains", trains: [{ id: "EC 1", name: "EC 1", track: "T", offset_mm: 100, speed_mm_s: 150, direction: 1, length_mm: 1400 }] });
  const hit = { key: "feed:EC 1", kind: "train", label: "EC 1", outline: [], owner: world.trains, ref: world.trains.trains.get("EC 1") };
  const a = trackAheadOf(world, hit);
  assert.ok(a.eoa_m >= NEXT_STOP_M - 1, `end of authority in ${a.eoa_m} m`);
  const first = a.etcs.points[0], last = a.etcs.points.at(-1);
  assert.ok(first.p >= a.v_kmh && first.ebi > a.v_kmh, `permitted ${first.p}, intervention ${first.ebi} km/h at ${a.v_kmh} km/h`);
  near(last.s, a.eoa_m, 1, "the curves end at it");
  const rows = Object.fromEntries(world.card(hit).sections.find((s) => s.title === "Braking and train protection").rows);
  assert.match(rows["Movement authority"], /^\d+ m to its end · assumed at its next stop$/);
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
  const kept = hit.ref.aheadRun;
  assert.ok(kept?.profile && kept.extras, "the run and what takes long are kept on the train");
  world.card(hit);
  assert.equal(hit.ref.aheadRun, kept, "the second card uses them");
  // the track ahead of it on the table: the run from its stop on, beyond the layout
  const a = trackAheadOf(world, hit);
  assert.equal(a.on.track.spec.track_id, "G3");
  assert.ok(a.path.ends && a.line.sections.at(-1).beyond);
  assert.equal(a.braking.standing, true, "standing: the braking distance from the line speed");
});

test("a train coming in: on the curve of its service braking to the stop, also while its front is beyond the end of the track", () => {
  const json = readJSON("web/layouts/ebl-lab.json");
  for (const l of json.layers) l.enabled = false;
  const world = createWorld(json);
  world.services.call("platform-1:right", { line: "RE 1" });
  const speeds = [];
  for (let i = 0; i < 400; i++) {
    world.step(0.1);
    const v = world.services.vehicles().find((x) => x.line === "RE 1" && x.dock.track === "G3");
    if (v?.phase !== "arriving") {
      if (speeds.length) break;
      continue;
    }
    const a = trackAheadOf(world, { key: `vehicle:${v.id}`, kind: "train", label: v.line, outline: [], owner: world.services, ref: v });
    speeds.push({ beyond: (a.on.at_mm - a.path.parts[0].from_mm) * a.on.dir < 0, v: a.v_kmh, s: a.now_s, start: speedAt(a.profile, 0) });
  }
  assert.ok(speeds.some((x) => x.beyond) && speeds.some((x) => !x.beyond), "its front comes in from beyond the track");
  for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i].v <= speeds[i - 1].v + 1e-6, `slower as it comes in: ${speeds[i - 1].v} → ${speeds[i].v} km/h`);
  for (const x of speeds.filter((q) => q.beyond)) {
    assert.ok(x.v >= x.start - 1e-6, `beyond the track faster than where its run starts: ${x.v} km/h`);
    assert.equal(x.s, 0, "the dot at the start of its run");
  }
  assert.ok(speeds[0].v > 30, `coming in at ${speeds[0].v} km/h`);
});

test("trains that cannot run: no running dynamics without vehicles; without traction its run and brakes only", () => {
  const world = (consists, power) => {
    const w = createWorld({ scale: 87, consists, objects: [{ id: "t", type: "track", track_id: "T", points: [[0, 0], [3000, 0]], ...(power ? { power } : {}) }] });
    w.trains.apply({ type: "trains", trains: [{ id: "X", name: "X 1", track: "T", offset_mm: 100, speed_mm_s: 0, direction: 1, length_mm: 1400 }] });
    return { w, hit: { key: "feed:X", kind: "train", label: "X 1", outline: [], owner: w.trains, ref: w.trains.trains.get("X") } };
  };
  // a consist whose vehicle types are all unknown
  const none = world([{ lines: ["X 1"], vehicles: [{ type: "br146x" }] }]);
  assert.equal(trackAheadOf(none.w, none.hit), null);
  assert.deepEqual(none.w.card(none.hit).sections.filter((s) => /Run|Running dynamics|Braking|Energy/.test(s.title)), []);
  // an electric train on a track without a contact line
  const off = world([{ lines: ["X 1"], vehicles: [{ type: "br146" }, { type: "dbpza", count: 4 }] }], "none");
  const card = off.w.card(off.hit);
  const titles = card.sections.map((s) => s.title);
  assert.ok(titles.includes("Run") && titles.includes("Braking and train protection"), titles.join(", "));
  assert.ok(!titles.includes("Adhesion and forces") && !titles.includes("Energy and driving style"), titles.join(", "));
  assert.match(Object.fromEntries(card.sections.find((s) => s.title === "Run").rows).Traction, /^none here/);
  assert.ok(!card.strip?.some((x) => x.pull_kn != null), "no forces on its strip");
  assert.doesNotMatch(JSON.stringify(card), /NaN|Infinity/);
});

test("too fast for its brakes: the braking distance against the line's; a main signal ahead is information (its aspect is not known)", () => {
  const signal = { id: "sig", type: "signal", name: "Signal A", kind: "main", position: [1100, -60], rotation_deg: 1.5 };
  const reported = (speed_mm_s, braking_distance_m) => {
    const json = readJSON("web/layouts/ebl-lab.json");
    for (const l of json.layers) l.enabled = false;
    json.objects.push(signal);
    if (braking_distance_m) json.objects.find((o) => o.track_id === "G3").braking_distance_m = braking_distance_m;
    const world = createWorld(json);
    // RE 1 reported on G3, heading for its last point
    world.trains.apply({ type: "trains", trains: [{ id: "RE 1", name: "RE 1", track: "G3", offset_mm: 800, speed_mm_s, direction: 1, length_mm: 1400 }] });
    const hit = { key: "feed:RE 1", kind: "train", label: "RE 1", outline: [], owner: world.trains, ref: world.trains.trains.get("RE 1") };
    return { world, hit, a: trackAheadOf(world, hit) };
  };
  // 94 km/h on a main line: it stops within its 1000 m; the signal 26 m ahead is within its braking distance, which is no fault
  const main = reported(300);
  near(main.a.v_kmh, (300 * 87 * 3.6) / 1000, 1e-6, "its speed in the prototype");
  assert.equal(main.a.main?.signal.id, "sig");
  assert.ok(main.a.braking.distance_m > main.a.main.s && main.a.braking.distance_m < main.a.spacing_m);
  const card = main.world.card(main.hit);
  assert.notEqual(card.tone, "bad");
  assert.doesNotMatch(card.status, /too fast/);
  assert.match(Object.fromEntries(card.sections.find((s) => s.title === "Braking and train protection").rows)["Next main signal"], /^Signal A · in \d+ m · within its braking distance$/);
  // 125 km/h where the line's braking distance is 400 m: too fast for its brakes
  const branch = reported(400, 400);
  assert.ok(branch.a.braking.distance_m > 400, `${branch.a.braking.distance_m} m`);
  const fast = branch.world.card(branch.hit);
  assert.equal(fast.tone, "bad");
  assert.match(fast.status, /too fast for its brakes/);
});

/** A view of the lab from above, as a frame draws with it. */
function frameView(time) {
  const camera = new Camera(1280, 720);
  const { H, focal, pose } = new FlyCamera({ target: [700, 0], distance: 2600, yaw: Math.PI / 2, pitch: toRad(50) }).homography(1280, 720);
  camera.setManualFocal(focal);
  return new View({ ctx: null, camera, H, pose, scale: 87, virtual: true, time });
}

test("the track ahead on the table: worked out once a frame, also while paused; not again when the train has gone", () => {
  const json = readJSON("web/layouts/ebl-lab.json");
  for (const l of json.layers) l.enabled = false;
  const world = createWorld(json);
  const tracks = world.objects.filter((o) => o.type === "track" && o.geometry);
  world.trains.apply({ type: "trains", trains: [{ id: "RE 1", name: "RE 1", track: "G3", offset_mm: 200, speed_mm_s: 300, direction: 1, length_mm: 1400 }] });
  world.step(0.05);
  world.trackAhead = { hit: { key: "feed:RE 1", kind: "train", label: "RE 1", outline: [], owner: world.trains, ref: world.trains.trains.get("RE 1") } };
  const one = frameView(world.time);
  drawTrackAhead(one, tracks[0]);
  const first = world.trackAhead.result;
  assert.equal(first.on.at_mm, 200);
  for (const t of tracks) drawTrackAhead(one, t);
  assert.ok(world.trackAhead.result === first, "once a frame, for all its tracks");
  // paused, the control system reports it further on and standing: the next frame shows it there
  world.paused = true;
  world.trains.apply({ type: "trains", trains: [{ id: "RE 1", name: "RE 1", track: "G3", offset_mm: 900, speed_mm_s: 0, direction: 1, length_mm: 1400 }] });
  world.step(0.05);
  drawTrackAhead(frameView(world.time), tracks[0]);
  assert.equal(world.trackAhead.result.on.at_mm, 900);
  assert.ok(world.trackAhead.result.v_kmh < 1, "standing");
  // reported anew under its number, it is the new report's
  world.trains.apply({ type: "remove", ids: ["RE 1"] });
  world.trains.apply({ type: "trains", trains: [{ id: "RE 1", name: "RE 1", track: "G3", offset_mm: 500, speed_mm_s: 0, direction: 1, length_mm: 1400 }] });
  drawTrackAhead(frameView(world.time), tracks[0]);
  assert.equal(world.trackAhead.result.on.at_mm, 500);
  // the train has gone: nothing is drawn, and the other tracks do not look for it again
  world.trains.apply({ type: "remove", ids: ["RE 1"] });
  world.step(0.05);
  const gone = frameView(world.time);
  for (const t of tracks) drawTrackAhead(gone, t);
  assert.ok(world.trackAhead.result === null, "nothing to draw");
  assert.ok(world.trackAhead.view === gone, "worked out for this frame");
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
  // worked out once for its train and the rails
  assert.equal(world.disruptions.effectsFor(area, area.docks.find((k) => k.id === "platform-1:right")).slow, fx.slow);
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
