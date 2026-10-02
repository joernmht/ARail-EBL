// Terminal operations: moves between trains, trucks, barges and yards by the gantry crane and the
// reach stacker, visits (call, depart, the truck gate and passing lane), model wagons from their
// tags, scenario requests, the start state, validation, determinism and isolation.
import assert from "node:assert/strict";
import test from "node:test";

import { createWorld, registry, validateLayout, Camera, View } from "../../web/arail/index.js";
import { TerminalSimulation, terminalOf } from "../../web/arail/terminal/operations.js";
import { PathMover, trapezoid } from "../../web/arail/terminal/movers.js";
import { CRANE } from "../../web/arail/terminal/handlers.js";
import { TRUCK } from "../../web/arail/terminal/visits.js";
import { createRng, toRad } from "../../web/arail/core/math.js";
import { CARRIER_TYPES, makeBic } from "../../web/arail/terminal/model.js";
import { encodeTag } from "../../web/arail/terminal/rolling.js";
import { readJSON } from "./helpers.js";

const EXAMPLE = readJSON("web/layouts/container-terminal.json");
const LAB = readJSON("web/layouts/ebl-lab.json");
const mm = (m) => (m * 1000) / 87;
const ID = (n) => makeBic("TSTU", n);

/** The example's infrastructure: two loading tracks, a truck lane, Block A under the crane, Block B beside it, a quay, a reach stacker. */
const OBJECTS = [
  { id: "track-1", type: "track", points: [[-250, 228.7], [1750, 228.7]] },
  { id: "track-2", type: "track", points: [[-250, 280.5], [1750, 280.5]] },
  { id: "lane-1", type: "truck-lane", points: [[-250, 332.2], [1750, 332.2]], positions: 3, passing_side: "left" },
  { id: "yard-a", type: "container-yard", name: "Block A", position: [750, 467.8], width_mm: 952, depth_mm: 134, rotation_deg: 0, tiers: 3 },
  { id: "yard-b", type: "container-yard", name: "Block B", position: [1560, 467.8], width_mm: 318, depth_mm: 134, rotation_deg: 0, tiers: 2 },
  { id: "crane-1", type: "gantry-crane", name: "Crane", position: [750, 378.2], width_mm: 1149.4, depth_mm: 356.3, rotation_deg: 0, outreach_m: 11, lift_m: 15 },
  { id: "quay-1", type: "quay", points: [[-400, 633.9], [1250, 633.9]], berth_m: 60, water_m: 16, quay_side: "right" },
  { id: "reach-stacker-1", type: "reach-stacker", name: "Stacker", position: [1560, 600], rotation_deg: 180 },
];

const at = (carrier, bay, row = 0, tier = 0) => ({ carrier, bay, row, tier });
const BASE = {
  trains: [
    { id: "K1", name: "K 1", track: "track-1", direction: 1, stop_mm: 1597, start: "positioned", wagons: ["sgns60", "sgns60", "sggrss80"] },
    { id: "K2", name: "K 2", track: "track-2", direction: -1, stop_mm: 1525, start: "positioned", wagons: ["sgns60", "sgns60", "lgns40"] },
  ],
  barges: [{ id: "B1", name: "Barge 1", quay: "quay-1", length_m: 55, tiers: 2, start: "positioned" }],
  trucks: { lane: "lane-1" },
  rolling_stock: [{ number: 3, type: "sggrss80" }],
  containers: [
    { id: ID(1), size: "20", at: at("K1/1", 0) },
    { id: ID(2), size: "40", at: at("K1/2", 0) },
    { id: ID(3), size: "20", at: at("K2/1", 0) },
    { id: ID(4), size: "20", at: at("yard-a", 0, 0, 0) },
    { id: ID(5), size: "20", high: true, at: at("yard-a", 0, 0, 1) },
    { id: ID(6), size: "40", at: at("yard-a", 2, 1, 0) },
    { id: ID(7), size: "20", at: at("B1", 0, 0, 0) },
    { id: ID(8), size: "20", at: at("yard-b", 0, 0, 0) },
    { id: ID(9), size: "45", at: at("yard-a", 4, 2, 0) },
  ],
};

/** A layout with the test infrastructure and a terminal entry (BASE with overrides). */
function layout(term = {}, objects = OBJECTS) {
  return {
    format: "arail-layout/1", name: "Terminal test", scale: 87,
    markers: {
      dictionary: "ARUCO", size_mm: 30, codes: 4, origin: 0,
      rolling: { dictionary: "APRILTAG_36h11", codes: 64, size_mm: 20, height_mm: 15, stride: 4, max_bit_errors: 3 },
      locked: true, poses: { "0": [0, 0, 0] },
    },
    simulations: [{ type: "terminal", name: "Test terminal", ...structuredClone(BASE), ...structuredClone(term) }],
    objects: structuredClone(objects),
  };
}

/** A world with the test layout, its terminal and a log of the terminal's events. */
function setup(term = {}, { seed = 1, objects } = {}) {
  const world = createWorld(layout(term, objects), { seed });
  world.speed = 20;
  const sim = terminalOf(world);
  const log = [];
  world.events.on("*", (p, name) => {
    if (name.startsWith("terminal.") && !name.startsWith("terminal.request.")) log.push({ name, p, time: world.time });
  });
  return { world, sim, log };
}

/** Run until `done()` (or fail after `max` simulated seconds). */
function runUntil(world, done, max = 2000, dtReal = 0.1) {
  const end = world.time + max;
  while (!done()) {
    if (world.time > end) throw new Error(`not done after ${max} s`);
    world.step(dtReal);
  }
}

function run(world, seconds, dtReal = 0.1) {
  const end = world.time + seconds;
  while (world.time < end - 1e-9) world.step(dtReal);
}

const names = (log, filter = () => true) => log.filter(filter).map((e) => e.name.replace("terminal.", ""));

/** Run a move to its end; returns it with the container's slot at the moment it finished. */
function finish(world, sim, log, move) {
  let landed = null;
  const off = world.events.on("terminal.move.finished", ({ move: m }) => {
    if (m === move) landed = { ...sim.inventory.get(m.container).at };
  });
  runUntil(world, () => move.state !== "queued" && move.state !== "active");
  off();
  assert.equal(move.state, "done", `${move.id}: ${move.reason}`);
  assert.deepEqual(names(log, (e) => e.p.move === move), ["move.queued", "move.started", "container.moved", "move.finished"]);
  assert.deepEqual(sim.inventory.check(), []);
  return landed;
}

/** Send a truck and wait until it stands at its position. */
function truck(world, sim, options) {
  const { visit, error } = sim.sendTruck(options);
  assert.equal(error, undefined);
  runUntil(world, () => visit.state === "positioned");
  return visit;
}

/* ---------------------------------------------------------------- movers */

test("trapezoid times match the closed forms", () => {
  assert.equal(trapezoid(0, 2, 1), 0);
  // short: never reaches v (|d| ≤ v²/a)
  assert.ok(Math.abs(trapezoid(4, 2, 1) - 2 * Math.sqrt(4)) < 1e-12);
  assert.ok(Math.abs(trapezoid(-1, 2, 1) - 2) < 1e-12, "the sign is ignored");
  // long: accelerate, cruise, brake
  assert.ok(Math.abs(trapezoid(100, 2, 1) - (100 / 2 + 2 / 1)) < 1e-12);
  // continuous at |d| = v²/a
  assert.ok(Math.abs(trapezoid(4 - 1e-9, 2, 1) - trapezoid(4 + 1e-9, 2, 1)) < 1e-6);
});

test("PathMover drives to its target, backs up, keeps behind a limit and extrapolates beyond the ends", () => {
  const points = [[0, 0], [1000, 0], [1000, 1000]];
  const m = new PathMover({ points, vmax: 50, accel: 10, brake: 10 });
  assert.equal(m.total, 2000);
  m.setTarget(1500);
  let t = 0, vmax = 0;
  while (!m.step(0.1)) {
    t += 0.1;
    vmax = Math.max(vmax, m.v);
    assert.ok(m.s <= 1500 + 1e-9, "never overshoots");
    assert.ok(t < 200);
  }
  assert.equal(m.s, 1500);
  assert.equal(m.v, 0);
  assert.ok(Math.abs(vmax - 50) < 1e-9);
  assert.ok(Math.abs(t - trapezoid(1500, 50, 10)) < 3, `${t.toFixed(1)} s`);
  const p = m.at(1500, 10);
  assert.deepEqual(p.point.map((v) => Math.round(v * 1e6) / 1e6), [990, 500]);
  // backing up
  m.setTarget(200);
  while (!m.step(0.25)) assert.ok(m.v <= 0);
  assert.equal(m.s, 200);
  // a limit: it stops behind it and goes on when the limit moves
  m.setTarget(1900);
  for (let i = 0; i < 400; i++) m.step(0.1, { limit: 600 });
  assert.ok(m.s <= 600 && m.s > 590, `stops at the limit (${m.s})`);
  assert.equal(m.v, 0);
  while (!m.step(0.1)) assert.ok(m.s <= 1900);
  // beyond the ends: straight on
  assert.deepEqual(m.at(-100).point, [-100, 0]);
  assert.deepEqual(m.at(2100).point, [1000, 1100]);
  // driving off the end
  m.setTarget(2500);
  while (!m.step(0.25));
  assert.equal(m.s, 2500);
});

/* ---------------------------------------------------------------- loading */

test("the terminal builds carriers, visits and handlers from the layout", () => {
  const { sim } = setup();
  assert.ok(sim instanceof TerminalSimulation);
  assert.deepEqual([...sim.visits.keys()], ["K1", "K2", "B1"]);
  assert.deepEqual([...sim.handlers.values()].map((h) => [h.id, h.kind, h.phase, h.move]), [["crane-1", "crane", "idle", null], ["reach-stacker-1", "reach-stacker", "idle", null]]);
  assert.deepEqual(sim.carriers().map((c) => c.id), ["K1/1", "K1/2", "K1/3", "K2/1", "K2/2", "K2/3", "W3", "B1", "yard-a", "yard-b"]);
  assert.equal(sim.inventory.containers.size, 9);
  assert.deepEqual(sim.inventory.check(), []);
  for (const id of ["K1/1", "K2/3", "B1", "yard-a", "yard-b"]) assert.ok(sim.carrier(id).present && sim.carrier(id).available, id);
  assert.ok(!sim.carrier("W3").present, "a model wagon is there once it is seen");
  assert.equal(sim.carrier("yard-a").bays, 12);
  assert.equal(sim.carrier("yard-a").rows, 4);
  assert.equal(sim.carrier("B1").bays, 5);
  // KT 41's stop: the head at x 1347
  const k1 = sim.visits.get("K1");
  assert.ok(Math.abs(k1.loco.center[0] + mm(9.5) - 1347) < 0.01);
  assert.equal(sim.describe(at("yard-a", 3, 1, 0)), "Block A · bay 4 · row 2 · tier 1");
  assert.equal(sim.describe(at("K1/1", 1)), "K 1 · wagon 1 · bay 2");
  assert.equal(sim.describe(at("B1", 0, 2, 1)), "Barge 1 · bay 1 · row 3 · tier 2");
  // boxes: positions on their carriers, z on top of each other
  const boxes = new Map(sim.boxes().map((b) => [b.id, b]));
  assert.equal(boxes.size, 9);
  assert.equal(boxes.get(ID(4)).z0, 0);
  assert.ok(Math.abs(boxes.get(ID(5)).z0 - mm(2.591)) < 1e-9);
  assert.ok(Math.abs(boxes.get(ID(1)).z0 - mm(1.155)) < 1e-9);
  assert.equal(sim.carrierAt(boxes.get(ID(6)).center), "yard-a");
  assert.equal(sim.carrierAt(boxes.get(ID(1)).center), "K1/1");
  assert.equal(sim.carrierAt([5000, 5000]), null);
});

/* ---------------------------------------------------------------- transfers */

const TRANSFERS = [
  ["train → train", ID(1), { carrier: "K2/2" }, "K2/2"],
  ["train → yard", ID(1), { carrier: "yard-a" }, "yard-a"],
  ["yard → train", ID(5), { carrier: "K1/1", bay: 1 }, "K1/1"],
  ["train → truck", ID(1), { kind: "truck" }, "T1", { purpose: "pickup" }],
  ["truck → yard", makeBic("TRKU", 100001), { kind: "yard" }, "yard-a", { purpose: "delivery", size: "20" }],
  ["yard → truck", ID(5), { carrier: "T1" }, "T1", { purpose: "pickup" }],
  ["truck → train", makeBic("TRKU", 100001), { carrier: "K1/1", bay: 1 }, "K1/1", { purpose: "delivery", size: "20" }],
  ["barge → train", ID(7), { carrier: "K1/1", bay: 2 }, "K1/1"],
  ["train → barge", ID(1), { carrier: "B1" }, "B1"],
  ["barge → yard", ID(7), { kind: "yard" }, "yard-a"],
  ["yard → barge", ID(5), { kind: "barge" }, "B1"],
  ["barge → truck", ID(7), { kind: "truck" }, "T1", { purpose: "pickup" }],
  ["yard → yard", ID(5), { carrier: "yard-a", bay: 6, row: 3 }, "yard-a"],
  ["Block B → Block B (reach stacker)", ID(8), { carrier: "yard-b", bay: 2, row: 2 }, "yard-b", null, "reach-stacker-1"],
  ["train → Block B (reach stacker)", ID(1), { carrier: "yard-b" }, "yard-b", null, "reach-stacker-1"],
  ["Block B → train (reach stacker)", ID(8), { carrier: "K1/1", bay: 1 }, "K1/1", null, "reach-stacker-1"],
];

for (const [label, id, to, carrier, truckOptions, handler = "crane-1"] of TRANSFERS) {
  test(`transfer ${label}`, () => {
    const { world, sim, log } = setup();
    if (truckOptions) truck(world, sim, truckOptions);
    const r = sim.request(id, to);
    assert.equal(r.error, undefined);
    assert.equal(r.move.handler, handler);
    assert.equal(r.move.source, "user");
    assert.deepEqual(r.move.from, { ...sim.inventory.get(id).at });
    const landed = finish(world, sim, log, r.move);
    assert.equal(landed.carrier, carrier);
    assert.deepEqual(landed, r.move.to);
    if (to.bay != null) assert.equal(landed.bay, to.bay);
    const h = sim.handlers.get(handler);
    assert.equal(h.move, null);
    assert.ok(h.phase === "idle" || h.phase === "park");
  });
}

/* ---------------------------------------------------------------- refusals */

test("requests are refused with a reason", () => {
  const { world, sim } = setup({ trains: [BASE.trains[0], { ...BASE.trains[1], start: "away" }] });
  const err = (...a) => sim.request(...a).error;
  assert.equal(err("XXXU 000000 0", { carrier: "yard-a" }), 'Unknown container "XXXU 000000 0"');
  // no crane reaches Block B, and a reach stacker does not serve barges
  assert.match(err(ID(8), { carrier: "B1" }), /^No crane or reach stacker can move it from Block B · bay 1 · row 1 · tier 1 to Barge 1/);
  assert.match(err(ID(8), { kind: "barge" }), /^No crane or reach stacker can move it from Block B · bay 1 · row 1 · tier 1 to Barge 1/);
  assert.equal(err(ID(8), { kind: "truck" }), `No free place for ${ID(8)} on a truck`, "no truck is here");
  // occupied, reserved
  assert.equal(err(ID(1), { carrier: "yard-a", bay: 2, row: 1, tier: 0 }), `Occupied by ${ID(6)}`);
  assert.equal(sim.request(ID(1), at("yard-a", 7, 3, 0)).error, undefined);
  assert.equal(err(ID(7), at("yard-a", 7, 3, 0)), "Reserved for move M1");
  assert.equal(err(ID(1), { carrier: "yard-a" }), `${ID(1)} is already being moved (M1)`);
  // blocked source, nothing to stand on, unknown places
  assert.equal(err(ID(4), { carrier: "yard-a" }), `Blocked by ${ID(5)} on top: move that first`);
  assert.equal(err(ID(7), at("yard-a", 8, 0, 1)), "Nothing to stand on");
  assert.equal(err(ID(7), { carrier: "nowhere" }), 'Unknown place "nowhere"');
  assert.equal(err(ID(9), { carrier: "K1/3" }), "Sggrss (80 ft) takes no 45 ft containers");
  // the target visit is away, or leaving
  assert.equal(err(ID(7), { carrier: "K2/1" }), "K 2 · wagon 1 is not here");
  assert.equal(sim.call("K2"), null);
  assert.equal(sim.call("K2"), "K 2 is already here");
  run(world, 20);
  assert.equal(sim.depart("K2"), null);
  assert.equal(err(ID(7), { carrier: "K2/1" }), "K 2 is leaving");
  // targets: what is possible and why the rest is not
  const { ok, refused } = sim.targets(ID(7));
  assert.ok(ok.length > 0 && ok.every((t) => t.handler === "crane-1"));
  assert.ok(ok.some((t) => t.carrier === "yard-a" && t.kind === "yard" && t.label.startsWith("Block A")));
  assert.ok(!ok.some((t) => t.carrier === "yard-b"));
  assert.deepEqual(refused.find((r) => r.carrier === "K2/1"), { carrier: "K2/1", label: "K 2 · wagon 1", reason: "K 2 is leaving" });
  assert.match(refused.find((r) => r.carrier === "yard-b").reason, /^No crane or reach stacker/);
  assert.deepEqual(sim.targets(ID(4)), { ok: [], refused: [{ carrier: "yard-a", label: ID(4), reason: `Blocked by ${ID(5)} on top: move that first` }] });
  // targetBoxes: a box per target, on the stack there
  const boxes = sim.targetBoxes(ID(7));
  assert.equal(boxes.length, ok.length);
  const onTop = boxes.find((b) => b.target.at.carrier === "yard-a" && b.target.at.tier === 2);
  assert.ok(Math.abs(onTop.box.z0 - mm(2.591 + 2.896)) < 1e-9, "on top of the stack there");
});

/* ---------------------------------------------------------------- waiting, depart, call */

test("a move to an approaching train starts only after it arrived", () => {
  const { world, sim, log } = setup({ trains: [BASE.trains[0], { ...BASE.trains[1], start: "away" }] });
  assert.equal(sim.call("K2"), null);
  assert.equal(sim.visits.get("K2").state, "approaching");
  assert.ok(sim.carrier("K2/1").present && !sim.carrier("K2/1").available);
  const { move } = sim.request(ID(7), { carrier: "K2/1" });
  assert.equal(move.handler, "crane-1", "assigned for the train's stop");
  world.step(0.1);
  assert.equal(move.state, "queued");
  assert.equal(move.waiting, "waiting for K 2 · wagon 1");
  finish(world, sim, log, move);
  const order = names(log, (e) => e.p.visit?.id === "K2" || e.p.move === move);
  assert.deepEqual(order, ["visit.arriving", "move.queued", "visit.arrived", "move.started", "container.moved", "move.finished"]);
});

test("handlers for an approaching train are assigned for its stop on the track where the track is now", () => {
  const { world, sim } = setup({ trains: [BASE.trains[0], { ...BASE.trains[1], start: "away" }] });
  assert.equal(sim.call("K2"), null);
  run(world, 3);
  const v = sim.visits.get("K2");
  assert.ok(sim.targets(ID(5)).ok.some((t) => t.carrier === "K2/1" && t.handler === "crane-1"));
  // the track moves 2 m away from the crane, its length stays the same
  const track = world.getObject("track-2");
  track.set({ points: track.spec.points.map(([x, y]) => [x, y + 2000]) });
  const ok = sim.targets(ID(5)).ok.filter((t) => t.carrier === "K2/1");
  assert.ok(Math.abs(v.homePose(v.carriers[0], sim).center[1] - 2280.5) < 1e-6, "the stop on the moved track");
  assert.ok(ok.length > 0 && ok.every((t) => t.handler === "reach-stacker-1"), "the crane no longer reaches it");
});

test("depart is refused while moves are queued or running; force cancels queued ones; a train called again brings its load", () => {
  const { world, sim, log } = setup();
  const a = sim.request(ID(1), { carrier: "yard-a" }).move;
  const b = sim.request(ID(2), { carrier: "yard-a" }).move;
  assert.equal(sim.depart("K1"), "K 1 still has 2 moves");
  world.step(0.1);
  assert.equal(a.state, "active");
  assert.equal(sim.depart("K1"), "A crane is working on K 1");
  finish(world, sim, log, a);
  runUntil(world, () => b.state === "done");
  const c = sim.request(ID(7), { carrier: "K1/1", bay: 1 }).move;
  assert.equal(sim.depart("K1"), "K 1 still has 1 move");
  assert.equal(sim.depart("K1", { force: true }), null);
  assert.equal(c.state, "cancelled");
  assert.ok(names(log).includes("move.cancelled"));
  assert.equal(sim.inventory.get(ID(7)).move, null);
  const load = sim.inventory.on("K1/3").map((x) => x.id);
  assert.equal(sim.visits.get("K1").state, "departing");
  assert.ok(sim.carrier("K1/1").present && !sim.carrier("K1/1").available);
  runUntil(world, () => sim.visits.get("K1").state === "away");
  assert.deepEqual(names(log, (e) => e.p.visit?.id === "K1"), ["visit.departing", "visit.departed"]);
  assert.ok(!sim.carrier("K1/1").present);
  assert.equal(sim.depart("K1"), "K 1 is not here");
  assert.equal(sim.call("K1"), null);
  runUntil(world, () => sim.visits.get("K1").state === "positioned");
  assert.deepEqual(sim.inventory.on("K1/3").map((x) => x.id), load);
  assert.ok(sim.carrier("K1/3").available);
  assert.equal(sim.call("nope"), 'Unknown visit "nope"');
});

test("depart forced while a crane works on a visit cancels its queued moves; it leaves once the crane is done", () => {
  const { world, sim, log } = setup();
  const a = sim.request(ID(1), { carrier: "yard-a" }).move;
  const b = sim.request(ID(2), { carrier: "yard-a" }).move;
  world.step(0.1);
  assert.equal(a.state, "active");
  assert.equal(sim.depart("K1", { force: true }), null);
  assert.equal(b.state, "cancelled");
  assert.equal(a.state, "active", "the crane's move goes on");
  const v = sim.visits.get("K1");
  assert.equal(v.state, "positioned");
  assert.ok(v.leaveWhenDone);
  assert.equal(sim.depart("K1"), "K 1 is already leaving");
  // no new moves from or to it
  assert.match(sim.request(ID(7), { carrier: "K1/1" }).error, /K 1 is leaving/);
  assert.equal(sim.unload("K1", { to: "yard" }).moves.length, 0);
  finish(world, sim, log, a);
  world.step(0.1);
  assert.equal(v.state, "departing");
  assert.ok(!v.leaveWhenDone);
  runUntil(world, () => v.state === "away");
  assert.deepEqual(names(log, (e) => e.p.visit?.id === "K1"), ["visit.departing", "visit.departed"]);
  assert.deepEqual(sim.inventory.check(), []);
});

test("visits whose track or quay is missing cannot be called", () => {
  const objects = OBJECTS.filter((o) => o.id !== "track-2");
  const { sim } = setup({ trains: [BASE.trains[0], { ...BASE.trains[1], start: "away" }] }, { objects });
  assert.equal(sim.call("K2"), 'K 2: no track "track-2"');
  assert.ok(!sim.carrier("K2/1").present);
  // a second train for an occupied track
  assert.equal(sim.addTrain({ track: "track-1" }).error, "K 1 is on track track-1");
  const r = sim.addTrain({ track: "track-2" });
  assert.equal(r.error, 'No track "track-2"');
});

test("trains and barges created at run time come in with random loads", () => {
  const { world, sim, log } = setup({ trains: [BASE.trains[0], { ...BASE.trains[1], start: "away" }], barges: [] });
  const t = sim.addTrain({ track: "track-2", wagons: ["sgns60", "lgns40"], load: "random" });
  assert.equal(t.visit.id, "train-1");
  assert.equal(t.visit.state, "approaching");
  assert.deepEqual(t.visit.carriers.map((c) => c.id), ["train-1/1", "train-1/2"]);
  assert.ok(sim.inventory.on("train-1/1").length + sim.inventory.on("train-1/2").length > 0);
  assert.ok(names(log).includes("container.added"));
  assert.equal(sim.addTrain({ track: "track-2", wagons: ["nope"] }).error, 'Unknown wagon type "nope"');
  const b = sim.addBarge({ quay: "quay-1", load: "random" });
  assert.equal(b.visit.id, "barge-1");
  assert.equal(sim.addBarge({ quay: "track-1" }).error, 'No quay "track-1"');
  runUntil(world, () => t.visit.state === "positioned" && b.visit.state === "positioned");
  assert.deepEqual(sim.inventory.check(), []);
  // a barge leaves astern
  assert.equal(sim.depart("barge-1"), null);
  runUntil(world, () => b.visit.state === "away", 3000);
  assert.ok(sim.inventory.on("barge-1").length > 0, "the load stays aboard");
});

/* ---------------------------------------------------------------- trucks */

/** Do two convex polygons overlap (more than touching)? */
function overlap(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], n = [q[1] - p[1], p[0] - q[0]];
      const pa = a.map((v) => v[0] * n[0] + v[1] * n[1]), pb = b.map((v) => v[0] * n[0] + v[1] * n[1]);
      const len = Math.hypot(...n);
      if (Math.min(...pa) >= Math.max(...pb) - 1e-6 * len || Math.min(...pb) >= Math.max(...pa) - 1e-6 * len) return false;
    }
  }
  return true;
}

test("trucks queue at the gate, pass in the passing lane, never overlap and leave when loaded", () => {
  const { world, sim, log } = setup();
  world.speed = 2.5; // one sub-step per world step: every step is checked
  const trucks = [1, 2, 3, 4].map(() => sim.sendTruck({ purpose: "pickup" }).visit);
  assert.deepEqual(trucks.map((t) => t.id), ["T1", "T2", "T3", "T4"]);
  assert.deepEqual([...sim.visits.keys()], ["K1", "K2", "B1", "T1", "T2", "T3", "T4"]);
  let worst = 0, sawQueue = false;
  const check = () => {
    const on = trucks.filter((t) => t.carriers[0].pose && sim.visits.has(t.id));
    for (let i = 0; i < on.length; i++) {
      for (let j = i + 1; j < on.length; j++) {
        const a = on[i].carriers[0].footprint(87), b = on[j].carriers[0].footprint(87);
        assert.ok(!overlap(a, b), `${on[i].id} and ${on[j].id} overlap at ${world.time.toFixed(2)} s`);
      }
    }
    worst = Math.max(worst, sim.visits.size);
    if (trucks.slice(0, 3).every((t) => t.state === "positioned") && trucks[3].state === "waiting") sawQueue = true;
  };
  const steps = (cond, max = 3000) => {
    const end = world.time + max;
    while (!cond()) {
      assert.ok(world.time < end, "timed out");
      world.step(0.1);
      check();
    }
  };
  steps(() => trucks.slice(0, 3).every((t) => t.state === "positioned"));
  assert.ok(sawQueue, "the fourth truck waits at the gate while all positions are taken");
  assert.equal(trucks[3].state, "waiting");
  assert.ok(!trucks[3].carriers[0].present);
  // the first comes to the farthest position
  assert.deepEqual(trucks.slice(0, 3).map((t) => t.position), [2, 1, 0]);
  // load the middle truck: it leaves past the one ahead; the fourth comes in to its position
  const m1 = sim.request(ID(5), { carrier: "T2" }).move;
  const m2 = sim.request(ID(6), { carrier: "T3" }).move;
  steps(() => m1.state === "done");
  steps(() => !sim.visits.has("T2"));
  const left = log.find((e) => e.name === "terminal.container.left");
  assert.equal(left.p.container.id, ID(5));
  assert.equal(left.p.visit.id, "T2");
  assert.equal(left.p.reason, "truck");
  assert.equal(sim.inventory.get(ID(5)), null, "the container left with the truck");
  steps(() => m2.state === "done" && trucks[3].state === "positioned");
  assert.equal(trucks[3].position, 1);
  steps(() => !sim.visits.has("T3"));
  assert.equal(sim.inventory.get(ID(6)), null);
  assert.deepEqual(names(log, (e) => e.p.visit?.id === "T3"), ["visit.arriving", "visit.arrived", "visit.departing", "container.left", "visit.departed"]);
  // an empty pickup truck stays until it is sent away
  run(world, 60);
  assert.equal(trucks[0].state, "positioned");
  assert.equal(sim.depart("T1"), null);
  steps(() => !sim.visits.has("T1"));
  assert.equal(worst, 7);
  assert.deepEqual(sim.inventory.check(), []);
});

test("random trucks with random departures never overlap and never get stuck, also on a lane bent by up to 10°", () => {
  // the whole truck (cab and chassis, 2.55 m wide) around the loading centre of its pose
  const front = TRUCK.front_m, rear = TRUCK.front_m - TRUCK.length_m, half = 2.55 / 2;
  const outline = ({ center, heading }) => {
    const c = Math.cos(heading), s = Math.sin(heading);
    return [[front, half], [rear, half], [rear, -half], [front, -half]].map(([a, b]) => [center[0] + mm(c * a - s * b), center[1] + mm(s * a + c * b)]);
  };
  // the example's straight lane, and bent by ±10° just after its middle truck position
  const runs = [[0, 1], [0, 4], [0, 7], [0, 9], [0, 11], [0, 15], [10, 1], [10, 4], [-10, 7], [-10, 9]];
  for (const [bend, seed] of runs) {
    const json = structuredClone(EXAMPLE), lane = json.objects.find((o) => o.type === "truck-lane");
    if (bend) {
      const [[x0, y], [x1]] = lane.points, at = (x0 + x1) / 2 + 30, r = toRad(bend);
      lane.points = [[x0, y], [at, y], [at + (x1 - at) * Math.cos(r), y + (x1 - at) * Math.sin(r)]];
    }
    const world = createWorld(json, { seed });
    world.speed = 2.5; // one sub-step per world step: every step is checked
    const sim = terminalOf(world), rng = createRng(seed * 77);
    const leave = seed % 2 ? 0.03 : 0.08;
    const check = () => {
      const on = [...sim.visits.values()].filter((v) => v.kind === "truck" && v.carriers[0].pose && v.visible(sim));
      for (let i = 0; i < on.length; i++) {
        for (let j = i + 1; j < on.length; j++) {
          assert.ok(!overlap(outline(on[i].carriers[0].pose), outline(on[j].carriers[0].pose)), `bend ${bend}°, seed ${seed}: ${on[i].id} and ${on[j].id} overlap at ${world.time.toFixed(1)} s`);
        }
      }
    };
    for (let i = 0; i < 6000; i++) {
      if (rng.chance(0.015)) sim.sendTruck({ purpose: rng.chance(0.5) ? "pickup" : "delivery" });
      if (rng.chance(leave)) {
        const ts = [...sim.visits.values()].filter((v) => v.kind === "truck" && v.state !== "departing");
        if (ts.length) sim.depart(ts[Math.floor(rng.next() * ts.length)].id, { force: true });
      }
      world.step(0.1);
      check();
    }
    // without new trucks, every truck on the move gets to its position or off the lane
    for (let i = 0; i < 3000; i++) {
      world.step(0.1);
      check();
    }
    const moving = [...sim.visits.values()].filter((v) => v.kind === "truck" && (v.state === "approaching" || v.state === "departing"));
    assert.deepEqual(moving.map((v) => v.id), [], `bend ${bend}°, seed ${seed}: trucks stuck on the lane`);
    assert.deepEqual(sim.inventory.check(), []);
  }
});

test("a delivery truck brings a container and leaves when it is emptied", () => {
  const { world, sim, log } = setup();
  const t = sim.sendTruck({ purpose: "delivery", size: "40" }).visit;
  const added = log.find((e) => e.name === "terminal.container.added");
  assert.equal(added.p.carrier, "T1");
  const box = added.p.container;
  assert.equal(box.id, makeBic("TRKU", 100001));
  assert.equal(box.size, "40");
  assert.deepEqual(box.at, at("T1", 0));
  assert.equal(t.state, "waiting", "at the gate until the next step");
  world.step(0.1);
  assert.equal(t.state, "approaching", "the lane is free");
  assert.equal(sim.sendTruck({ size: "53" }).error, 'Unknown container size "53"');
  const { move } = sim.request(box.id, { carrier: "yard-a" });
  finish(world, sim, log, move);
  runUntil(world, () => !sim.visits.has("T1"));
  assert.equal(sim.inventory.get(box.id).at.carrier, "yard-a");
  assert.ok(!log.some((e) => e.name === "terminal.container.left"));
  // random sizes come from the terminal's own random numbers
  const sizes = new Set();
  for (let i = 0; i < 30; i++) sizes.add(sim.inventory.on(sim.sendTruck({ purpose: "delivery" }).visit.id)[0].size);
  assert.deepEqual([...sizes].sort(), ["20", "40", "45"]);
  const t2 = sim.visits.get("T3");
  assert.equal(t2.state, "waiting");
  assert.equal(sim.depart("T3"), null, "a truck at the gate can be sent away");
  assert.ok(!sim.visits.has("T3"));
});

test("nothing is lifted from a leaving truck; a truck that is gone takes no moves with it", () => {
  const { world, sim, log } = setup();
  const t = truck(world, sim, { purpose: "delivery", size: "20" });
  const box = sim.inventory.on(t.id)[0];
  assert.equal(sim.depart(t.id), null);
  assert.equal(t.state, "departing");
  assert.equal(sim.request(box.id, { carrier: "yard-a" }).error, `${t.name} is leaving`);
  assert.deepEqual(sim.targets(box.id).refused, [{ carrier: t.id, label: box.id, reason: `${t.name} is leaving` }]);
  assert.equal(sim.unload(t.id).moves.length, 0);
  runUntil(world, () => !sim.visits.has(t.id));
  assert.ok(!sim.moves.some((m) => m.state === "queued" || m.state === "active"));
  assert.equal(sim.inventory.get(box.id), null, "the container left with the truck");
  assert.ok(log.some((e) => e.name === "terminal.container.left" && e.p.container === box));
  assert.deepEqual(sim.inventory.check(), []);
});

/* ---------------------------------------------------------------- cranes */

test("the crane runs through its phases in order", () => {
  const { world, sim, log } = setup();
  const crane = sim.handlers.get("crane-1"), phases = [];
  const set = crane._set.bind(crane);
  crane._set = (phase, ...rest) => {
    phases.push(phase);
    return set(phase, ...rest);
  };
  const { move } = sim.request(ID(1), { carrier: "yard-a" });
  finish(world, sim, log, move);
  assert.deepEqual(phases, ["raise", "travel", "lower", "lock", "lift", "carry", "set-down", "release"]);
  assert.equal(crane.phase, "idle");
  // the reach stacker
  const rs = sim.handlers.get("reach-stacker-1"), rsPhases = [];
  const rsSet = rs._set.bind(rs);
  rs._set = (phase, ...rest) => {
    rsPhases.push(phase);
    return rsSet(phase, ...rest);
  };
  finish(world, sim, log, sim.request(ID(8), { carrier: "yard-b", bay: 3, row: 3 }).move);
  assert.deepEqual(rsPhases, ["drive", "lower", "lock", "lift", "drive", "set-down", "release"]);
  run(world, 30);
  assert.equal(rsPhases.at(-1), "park", "it drives back to its place");
  run(world, 200);
  assert.equal(rs.phase, "idle");
  const home = world.getObject("reach-stacker-1").geometry;
  assert.ok(Math.hypot(rs.x - home.center[0], rs.y - home.center[1]) < 1e-6);
});

test("the crane travels clear of the highest stack and never above its lifting height", () => {
  const stack = [0, 1, 2].map((tier) => ({ id: ID(20 + tier), size: "20", high: true, at: at("yard-a", 5, 1, tier) }));
  for (const lift_m of [15, 10]) {
    const objects = OBJECTS.map((o) => (o.id === "crane-1" ? { ...o, lift_m } : o));
    const { world, sim, log } = setup({ containers: [...BASE.containers, ...stack] }, { objects });
    const crane = sim.handlers.get("crane-1"), lift = mm(lift_m);
    const top = 3 * mm(2.896), clear = mm(CRANE.clearance_m);
    const { move } = sim.request(ID(1), { carrier: "yard-a", bay: 10, row: 3 });
    let carried = Infinity, empty = Infinity;
    while (move.state !== "done") {
      world.step(0.1);
      assert.ok(crane.z <= lift + 1e-9, `z ${crane.z} > lift ${lift}`);
      if (crane.phase === "carry") carried = Math.min(carried, crane.z);
      if (crane.phase === "travel") empty = Math.min(empty, crane.z);
    }
    assert.ok(empty >= Math.min(lift, top + clear) - 1e-6, `empty: ${empty} vs ${top + clear}`);
    assert.ok(carried >= Math.min(lift, top + clear + mm(2.591)) - 1e-6, `loaded: ${carried} vs ${top + clear + mm(2.591)}`);
    if (lift_m === 10) assert.ok(Math.abs(carried - lift) < 1e-6, "capped at the lifting height");
    assert.ok(names(log).includes("move.finished"));
  }
});

test("speed 2 halves the duration of a move", () => {
  const duration = (speed) => {
    const objects = OBJECTS.map((o) => (o.id === "crane-1" ? { ...o, speed } : o));
    const { world, sim, log } = setup({}, { objects });
    world.speed = 2.5;
    const { move } = sim.request(ID(1), { carrier: "yard-a", bay: 11, row: 3 });
    finish(world, sim, log, move);
    return move.doneAt - move.startedAt;
  };
  const one = duration(1), two = duration(2);
  assert.ok(Math.abs(two / one - 0.5) < 0.05, `${one.toFixed(1)} s and ${two.toFixed(1)} s`);
});

test("cancel: queued moves and active ones before the lock; not once the container is locked", () => {
  const { world, sim, log } = setup();
  const a = sim.request(ID(1), { carrier: "yard-a", bay: 9 }).move;
  const b = sim.request(ID(7), { carrier: "yard-a", bay: 10 }).move;
  assert.equal(sim.cancel(b.id), null);
  assert.equal(b.state, "cancelled");
  assert.equal(sim.inventory.get(ID(7)).move, null);
  assert.equal(sim.inventory.reservedBy("yard-a", 0, 10, 0), null);
  assert.equal(sim.cancel(b.id), "Move M2 has already been cancelled");
  assert.equal(sim.cancel("M99"), 'Unknown move "M99"');
  // active, before the lock
  const crane = sim.handlers.get("crane-1");
  runUntil(world, () => crane.phase === "travel");
  assert.equal(sim.cancel(a.id), null);
  assert.equal(crane.phase, "idle");
  assert.equal(crane.move, null);
  assert.deepEqual(sim.inventory.get(ID(1)).at, at("K1/1", 0));
  // active, after the lock
  const c = sim.request(ID(1), { carrier: "yard-a", bay: 9 }).move;
  runUntil(world, () => crane.phase === "lift");
  assert.equal(sim.cancel(c.id), `The crane is carrying ${ID(1)}; it finishes the move`);
  finish(world, sim, log, c);
  assert.equal(sim.cancel(c.id), "Move M3 has already finished");
  assert.deepEqual(names(log, (e) => e.name === "terminal.move.cancelled").length, 2);
  assert.deepEqual(sim.moves.map((m) => m.state), ["cancelled", "cancelled", "done"]);
});

/* ---------------------------------------------------------------- bulk operations */

test("unload a train to the yard and load another from the yard; the inventory stays consistent", () => {
  const world = createWorld(EXAMPLE, { seed: 3 });
  world.speed = 30;
  const sim = terminalOf(world);
  const kt41 = new Set(["KT41/1", "KT41/2", "KT41/3"].flatMap((id) => sim.inventory.on(id).map((c) => c.id)));
  assert.equal(kt41.size, 6);
  const un = sim.unload("KT41");
  assert.equal(un.moves.length, 6);
  assert.deepEqual(un.refused, []);
  assert.deepEqual(sim.unload("KT52"), { moves: [], refused: [{ carrier: "KT52", label: "KT 52 Duisburg", reason: "KT 52 Duisburg is not here" }] });
  assert.equal(sim.unload("nope").refused[0].reason, 'Unknown visit "nope"');
  // a barge: the containers below wait
  const barge = sim.unload("BG1", { to: "yard" });
  assert.deepEqual(barge.refused.map((r) => [r.label, r.carrier]), [["ARLU 100005 0", "BG1"]]);
  assert.match(barge.refused[0].reason, /^Blocked by move M\d+|^Blocked by ARLU 100006 6/);
  assert.equal(sim.call("KT52"), null);
  const step = () => {
    world.step(0.1);
    assert.deepEqual(sim.inventory.check(), []);
  };
  while (sim.moves.some((m) => m.state === "queued" || m.state === "active") || sim.visits.get("KT52").state !== "positioned") step();
  for (const id of kt41) assert.equal(sim.carrier(sim.inventory.get(id).at.carrier).kind, "yard", id);
  // load KT 52 from the yard: as full as the sizes allow
  const ld = sim.load("KT52");
  assert.ok(ld.moves.length >= 3);
  assert.ok(ld.moves.every((m) => !m.to.carrier.startsWith("KT41")));
  while (sim.moves.some((m) => m.state === "queued" || m.state === "active")) step();
  const wagons = ["KT52/1", "KT52/2", "KT52/3"];
  const yardBoxes = [...sim.inventory.containers.values()].filter((c) => c.at && sim.carrier(c.at.carrier).kind === "yard" && !sim.inventory.canLift(c));
  for (const w of wagons) {
    for (const c of yardBoxes) assert.equal(sim.inventory.freeSlots(c, w).filter((r) => sim.targets(c.id).ok.some((t) => t.carrier === w)).length, 0, `${c.id} would still fit ${w}`);
  }
  assert.ok(wagons.reduce((n, w) => n + sim.inventory.usedTeu(w), 0) >= 6);
  assert.equal(sim.load("KT52").refused[0].reason, "KT 52 Duisburg has no free place");
});

/* ---------------------------------------------------------------- scenario requests */

test("scenario requests drive the terminal; refusals become messages", () => {
  const { world, sim } = setup({ trains: [BASE.trains[0], { ...BASE.trains[1], start: "away" }] });
  const messages = [];
  world.events.on("scenario.message", (p) => messages.push(p.text));
  world.events.emit("terminal.request.call", { visit: "K2" });
  assert.equal(sim.visits.get("K2").state, "approaching");
  world.events.emit("terminal.request.move", { container: ID(1), to: { carrier: "yard-a" } });
  assert.equal(sim.moves[0].source, "scenario");
  world.events.emit("terminal.request.truck", { purpose: "delivery", size: "20" });
  assert.equal(sim.visits.get("T1").purpose, "delivery");
  world.events.emit("terminal.request.move", { container: "nope", to: { kind: "yard" } });
  world.events.emit("terminal.request.call", { visit: "K2" });
  world.events.emit("terminal.request.depart", { visit: "B1", force: true });
  assert.equal(sim.visits.get("B1").state, "departing");
  world.events.emit("terminal.request.train", { track: "nowhere" });
  world.events.emit("terminal.request.unload", { visit: "nope" });
  assert.deepEqual(messages, ['Terminal: Unknown container "nope"', "Terminal: K 2 is already here", 'Terminal: No track "nowhere"', 'Terminal: Unknown visit "nope"']);
  world.events.emit("terminal.request.load", { visit: "K1", from: "yard" });
  assert.ok(sim.moves.filter((m) => m.source === "scenario").length >= 2);
  // played from a scenario
  world.layout.scenarios.push({ id: "s", steps: [{ at: 0, emit: { name: "terminal.request.reset" } }, { at: 1, emit: { name: "terminal.request.barge", payload: { quay: "quay-1" } } }] });
  world.scenarios.load(world.layout.scenarios);
  let resets = 0;
  world.events.on("terminal.reset", () => resets++);
  world.scenarios.play("s");
  assert.equal(resets, 1);
  assert.deepEqual(sim.moves, []);
  run(world, 2);
  assert.equal(messages.at(-1), "Terminal: Barge 1 is at the quay");
  // dispose unsubscribes
  sim.dispose();
  world.events.emit("terminal.request.call", { visit: "K2" });
  assert.equal(sim.visits.get("K2").state, "away");
});

/* ---------------------------------------------------------------- start state */

test("toJSON keeps the start state; saveStart makes the current state the start state", () => {
  const json = layout({ fill: { "yard-a": 0.3 }, trains: [BASE.trains[0], { ...BASE.trains[1], start: "away" }] });
  const world = createWorld(json, { seed: 4 });
  world.speed = 20;
  const sim = terminalOf(world);
  assert.deepEqual(world.toJSON().simulations, json.simulations);
  const { move } = sim.request(ID(1), { carrier: "yard-a" });
  sim.addTrain({ track: "track-2" });
  runUntil(world, () => move.state === "done");
  sim.sendTruck({ purpose: "delivery" });
  assert.deepEqual(world.toJSON().simulations, json.simulations, "runtime changes are not saved");
  sim.saveStart();
  const snap = sim.snapshot();
  assert.deepEqual(world.toJSON().simulations[0], snap);
  assert.equal(snap.fill, undefined);
  assert.ok(!snap.containers.some((c) => c.at.carrier.startsWith("T")), "containers on trucks are not saved");
  assert.equal(snap.containers.find((c) => c.id === ID(1)).at.carrier, "yard-a");
  assert.equal(sim.visits.get("train-1").state, "positioned");
  assert.deepEqual(snap.trains.map((t) => [t.id, t.start]), [["K1", "positioned"], ["K2", "away"], ["train-1", "positioned"]]);
  assert.deepEqual(snap.trains[2], { id: "train-1", name: "Train 1", track: "track-2", direction: 1, wagons: ["sgns60", "sgns60", "sgns60"], start: "positioned" });
  // the saved state loads again as it was
  const again = terminalOf(createWorld(world.toJSON(), { seed: 4 }));
  assert.deepEqual(again.inventory.snapshot(), sim.inventory.snapshot().filter((c) => !c.at.carrier.startsWith("T")));
  assert.deepEqual(again.snapshot(), snap);
  // saved while a crane carries a container to a truck: it is saved where it came from
  const t = truck(world, sim, { purpose: "pickup" });
  const m = sim.request(ID(2), { carrier: t.id }).move;
  const from = { ...m.from };
  runUntil(world, () => sim.handlers.get(m.handler).phase === "carry");
  assert.equal(sim.inventory.get(ID(2)).at, null);
  sim.saveStart();
  assert.deepEqual(validateLayout(world.toJSON()), []);
  assert.deepEqual(sim.config.containers.find((c) => c.id === ID(2)).at, from);
});

test("a container carried to a truck is saved where it came from, even when a queued move refers to that place", () => {
  const cases = [
    // the box it stood on has a queued move; another move reserved its old place
    [ID(5), (sim) => sim.request(ID(4), { carrier: "K1/3" })],
    [ID(6), (sim, from) => sim.request(ID(1), from)],
  ];
  for (const [box, queue] of cases) {
    const { world, sim } = setup();
    const t = truck(world, sim, { purpose: "pickup" });
    const m = sim.request(box, { carrier: t.id }).move;
    const from = { ...m.from };
    runUntil(world, () => sim.handlers.get(m.handler).phase === "carry");
    assert.equal(queue(sim, from).error, undefined);
    const snap = sim.snapshot();
    assert.deepEqual(snap.containers.find((c) => c.id === box)?.at, from, box);
    assert.equal(snap.containers.length, sim.inventory.containers.size);
    const again = terminalOf(createWorld({ ...layout(), simulations: [snap] }));
    assert.equal(again.inventory.containers.size, snap.containers.length, "loads back with nothing skipped");
    assert.deepEqual(again.inventory.check(), []);
  }
});

test("reset restores the start state, including the fill", () => {
  const { world, sim, log } = setup({ fill: { "yard-a": 0.4, "yard-b": 0.5 } }, { seed: 7 });
  const start = structuredClone(sim.snapshot()), before = sim.inventory.snapshot();
  assert.ok(before.length > 20, "the fill adds containers");
  assert.ok(before.some((c) => c.size === "45") && before.some((c) => c.at.tier > 0));
  assert.ok(before.filter((c) => c.id.startsWith("TSTU")).length === 9);
  sim.request(ID(1), { carrier: "yard-a" });
  sim.sendTruck({ purpose: "delivery" });
  sim.addTrain({ track: "track-2" }); // refused: K2 is there
  run(world, 200);
  sim.reset();
  assert.deepEqual(sim.inventory.snapshot(), before);
  assert.deepEqual(sim.snapshot(), start);
  assert.deepEqual(sim.moves, []);
  assert.deepEqual([...sim.visits.keys()], ["K1", "K2", "B1"]);
  assert.equal(log.at(-1).name, "terminal.reset");
  assert.equal(log.at(-1).p.terminal, sim);
  // the same seed gives the same fill; another seed another
  assert.deepEqual(terminalOf(createWorld(layout({ fill: { "yard-a": 0.4, "yard-b": 0.5 } }), { seed: 7 })).inventory.snapshot(), before);
  assert.notDeepEqual(terminalOf(createWorld(layout({ fill: { "yard-a": 0.4, "yard-b": 0.5 } }), { seed: 8 })).inventory.snapshot(), before);
  // clear() (Simulate → Clear passengers) leaves the terminal alone
  sim.clear();
  assert.deepEqual(sim.inventory.snapshot(), before);
});

/* ---------------------------------------------------------------- model wagons */

test("model wagons appear from their tags, take containers and keep them while lost", () => {
  const { world, sim, log } = setup();
  const type = CARRIER_TYPES.sggrss80;
  const frame = (center, heading = 0, slots = [0, 1, 2]) => Object.fromEntries(slots.map((slot) => {
    const a = mm(type.bays_m[slot]);
    return [encodeTag(3, slot, 4), { center: [center[0] + a * Math.cos(heading), center[1] + a * Math.sin(heading)], heading, edge_mm: 20 }];
  }));
  let time = 0;
  sim.observe(frame([700, 228.7]), time);
  const w3 = sim.carrier("W3");
  assert.equal(sim.markerWagons()[0], w3);
  assert.ok(w3.present && !w3.available, "seen, still moving");
  assert.deepEqual(names(log), ["wagon.seen"]);
  assert.equal(log[0].p.carrier, w3);
  for (; time < 1.3; time += 0.1) sim.observe(frame([700, 228.7]), time);
  assert.ok(w3.available, "standing after standing_s");
  assert.ok(Math.abs(w3.pose.center[0] - 700) < 0.01 && Math.abs(w3.pose.center[1] - 228.7) < 0.01);
  // a move onto it
  const { move } = sim.request(ID(5), { carrier: "W3" });
  assert.equal(move.handler, "crane-1");
  const landed = finish(world, sim, log, move);
  assert.equal(landed.carrier, "W3");
  let box = sim.boxes().find((b) => b.id === ID(5));
  assert.equal(box.z0, 15, "on the deck card");
  const x0 = box.center[0];
  // the wagon moves: its container follows
  for (let i = 1; i <= 20; i++, time += 0.1) sim.observe(frame([700 + i * 5, 228.7]), time);
  assert.ok(!w3.available, "moving");
  for (let i = 0; i < 10; i++, time += 0.1) sim.observe(frame([800, 228.7]), time);
  box = sim.boxes().find((b) => b.id === ID(5));
  assert.ok(Math.abs(box.center[0] - x0 - 100) < 2, `followed to ${box.center[0] - x0}`);
  // lost: its containers stay with it; seen again: back
  sim.observe({}, time + 5);
  assert.ok(!w3.present);
  assert.equal(log.at(-1).name, "terminal.wagon.lost");
  assert.deepEqual(sim.inventory.on("W3").map((c) => c.id), [ID(5)]);
  assert.ok(!sim.boxes().some((b) => b.id === ID(5)), "not where it cannot be seen");
  assert.match(sim.request(ID(6), { carrier: "W3" }).error, /^W3 is not here/);
  sim.observe(frame([800, 228.7]), time + 6);
  assert.equal(log.at(-1).name, "terminal.wagon.seen");
  assert.ok(sim.boxes().some((b) => b.id === ID(5)));
  sim.forgetObservations();
  assert.equal(log.at(-1).name, "terminal.wagon.lost");
  assert.ok(!w3.present);
  // saved with the start state, and back on W3 after loading
  const json = { ...layout(), simulations: [sim.snapshot()] };
  const again = terminalOf(createWorld(json));
  assert.equal(again.inventory.get(ID(5)).at.carrier, "W3");
  assert.equal(again.tagHeight(encodeTag(3, 0, 4)), 15);
});

test("a moving model wagon hidden for a moment is not available; a standing one is", () => {
  const { world, sim } = setup();
  const type = CARRIER_TYPES.sggrss80;
  const frame = (x) => Object.fromEntries([0, 1, 2].map((slot) => [encodeTag(3, slot, 4), { center: [x + mm(type.bays_m[slot]), 228.7], heading: 0, edge_mm: 20 }]));
  const w3 = sim.carrier("W3");
  let time = 0;
  for (; time < 2; time += 0.1) sim.observe(frame(700 + 20 * time), time);
  assert.equal(w3.tracked, "moving");
  const { move } = sim.request(ID(5), { carrier: "W3" });
  world.step(0.01);
  assert.equal(move.state, "queued");
  assert.equal(move.waiting, "waiting for W3");
  // its tags hidden for 0.3 s: held, but it may still be moving
  for (let i = 0; i < 3; i++, time += 0.1) {
    sim.observe({}, time);
    world.step(0.01);
    assert.equal(w3.tracked, "held");
    assert.ok(w3.present && !w3.available);
  }
  assert.equal(move.state, "queued", "the move still waits");
  // a standing wagon that is hidden stays available
  for (const end = time + 1.5; time < end; time += 0.1) sim.observe(frame(800), time);
  assert.equal(w3.tracked, "standing");
  sim.observe({}, time + 1);
  assert.equal(w3.tracked, "held");
  assert.ok(w3.available);
});

test("rejected tags create no model wagon", () => {
  const { sim } = setup();
  const before = sim.markerWagons().map((c) => c.id);
  assert.deepEqual(before, ["W3"]);
  sim.observe({
    [encodeTag(5, 3, 4)]: { center: [700, 228.7], heading: 0, edge_mm: 20 }, // slot 3: an Sgns has 3 spots
    [encodeTag(6, 0, 4)]: { center: [700, 228.7], heading: 0, edge_mm: 40 }, // fails the size gate
    [encodeTag(7, 0, 4)]: { center: null, heading: null, edge_mm: null }, // unknown and without a pose
  }, 0);
  assert.deepEqual(sim.markerWagons().map((c) => c.id), before);
  assert.deepEqual([...sim.rolling.wagons.keys()], []);
  // a tag that passes: W8 is created, as an Sgns
  sim.observe({ [encodeTag(8, 0, 4)]: { center: [700, 228.7], heading: 0, edge_mm: 20 } }, 0.1);
  assert.deepEqual(sim.markerWagons().map((c) => c.id), ["W3", "W8"]);
  assert.equal(sim.carrier("W8").type.label, "Sgns (60 ft)");
});

/* ---------------------------------------------------------------- object edits */

test("object edits: a removed yard drops its containers; a resized crane keeps its state", () => {
  const { world, sim, log } = setup();
  const crane = sim.handlers.get("crane-1");
  const { move } = sim.request(ID(1), { carrier: "B1" });
  runUntil(world, () => crane.phase === "carry");
  const state = { s: crane.s, t: crane.t, z: crane.z, phase: crane.phase, move: crane.move };
  world.getObject("crane-1").set({ width_mm: 1200 });
  sim.carriers(); // reads the objects again
  assert.equal(sim.handlers.get("crane-1"), crane, "the same handler");
  assert.deepEqual({ s: crane.s, t: crane.t, z: crane.z, phase: crane.phase, move: crane.move }, state);
  assert.equal(crane.object.geometry.length, 1200);
  finish(world, sim, log, move);
  // a move into Block A, then Block A is deleted
  const m2 = sim.request(ID(7), { carrier: "yard-a", bay: 11 }).move;
  const yardBoxes = sim.inventory.on("yard-a").map((c) => c.id);
  world.removeObject("yard-a");
  world.step(0.01);
  assert.equal(m2.state, "cancelled");
  const left = log.filter((e) => e.name === "terminal.container.left");
  assert.deepEqual(left.map((e) => e.p.container.id).sort(), yardBoxes.sort());
  assert.ok(left.every((e) => e.p.reason === "place removed" && e.p.visit === null));
  assert.equal(sim.carrier("yard-a"), null);
  assert.deepEqual(sim.inventory.check(), []);
  assert.ok(!sim.carriers().some((c) => c.id === "yard-a"));
  // a shrunk Block B drops the containers in its vanished bays
  world.getObject("yard-b").set({ width_mm: 160 });
  world.step(0.01);
  assert.equal(sim.carrier("yard-b").bays, 2);
  assert.ok(sim.inventory.get(ID(8)), "bay 1 is still there");
  world.getObject("yard-b").set({ tiers: 1 });
  world.step(0.01);
  assert.equal(sim.carrier("yard-b").tiers, 1);
  // a removed crane: its moves are cancelled, the container on its spreader goes back
  const m3 = sim.request(ID(3), { carrier: "B1" }).move;
  runUntil(world, () => crane.phase === "lift");
  world.removeObject("crane-1");
  world.step(0.01);
  assert.equal(m3.state, "cancelled");
  assert.deepEqual(sim.inventory.get(ID(3)).at, at("K2/1", 0));
  assert.deepEqual([...sim.handlers.keys()], ["reach-stacker-1"]);
  assert.deepEqual(sim.inventory.check(), []);
});

test("a container on a spreader whose move is cancelled stays in the terminal when its old place was taken", () => {
  const carry = (box, to, then, remove) => {
    const { world, sim, log } = setup();
    const m = sim.request(box, to).move;
    runUntil(world, () => sim.handlers.get("crane-1").phase === "carry");
    const from = { ...m.from }, n = sim.inventory.containers.size - (remove === "yard-a" ? sim.inventory.on("yard-a").length : 0);
    assert.equal(then(sim, from).error, undefined);
    world.removeObject(remove);
    world.step(0.01);
    assert.equal(m.state, "cancelled");
    assert.ok(!log.some((e) => e.name === "terminal.container.left" && e.p.container.id === box), `${box} stays`);
    assert.equal(sim.inventory.containers.size, n);
    assert.deepEqual(sim.inventory.check(), []);
    return { at: sim.inventory.get(box).at, m };
  };
  // its old place is reserved by another move: it goes to its target
  let r = carry(ID(1), { carrier: "yard-a" }, (sim, from) => sim.request(ID(3), from), "crane-1");
  assert.deepEqual(r.at, r.m.to);
  // the box it stood on has a move queued: it goes to its target
  r = carry(ID(5), { carrier: "yard-a", bay: 9, row: 0 }, (sim) => sim.request(ID(4), { carrier: "K1/3" }), "crane-1");
  assert.deepEqual(r.at, r.m.to);
  // the yard it came from is deleted: it is not put back there (it goes to its target)
  r = carry(ID(5), { carrier: "K1/3" }, () => ({}), "yard-a");
  assert.deepEqual(r.at, r.m.to);
});

/**
 * Record, each time a handler takes a container off or sets it down, how far (mm) its spreader (a
 * crane) or its stand point (a reach stacker) is from where it should be for the slot.
 */
function aim(sim) {
  const out = [];
  for (const [name, ref] of [["_detach", "from"], ["_attach", "to"]]) {
    const orig = sim[name].bind(sim);
    sim[name] = (h) => {
      const box = sim._slotBox(h._move[ref], h.load), stand = h.kind === "crane" ? null : h._stand(sim, box);
      const [p, want] = stand ? [[h.x, h.y], [stand.x, stand.y]] : [h.point(), box.center];
      out.push({ what: name.slice(1), handler: h.id, off: Math.hypot(p[0] - want[0], p[1] - want[1]) });
      return orig(h);
    };
  }
  return out;
}

test("moves are given to another handler, or fail, when their crane no longer reaches their places", () => {
  const { world, sim, log } = setup();
  const toBarge = sim.request(ID(1), { carrier: "B1" }).move, toYard = sim.request(ID(2), { carrier: "yard-a" }).move;
  assert.deepEqual([toBarge.handler, toYard.handler], ["crane-1", "crane-1"]);
  // the crane is narrowed so that it reaches neither track
  world.getObject("crane-1").set({ depth_mm: 100, outreach_m: 0 });
  world.step(0.01);
  assert.equal(toBarge.state, "failed");
  assert.match(toBarge.reason, /^No crane or reach stacker can move it from K 1 · wagon 1 · bay 1 to Barge 1/);
  assert.deepEqual(names(log, (e) => e.p.move === toBarge), ["move.queued", "move.failed"]);
  assert.equal(toYard.handler, "reach-stacker-1");
  const shots = aim(sim);
  assert.equal(finish(world, sim, log, toYard).carrier, "yard-a");
  assert.ok(shots.every((s) => s.handler === "reach-stacker-1" && s.off < 0.01), JSON.stringify(shots));
  assert.deepEqual(sim.inventory.check(), []);
});

test("a crane aims again where an edited object is now; after the lock it waits for a target out of its reach", () => {
  // before the lock: the place moves out of reach, the move goes to the reach stacker and starts again
  let { world, sim, log } = setup();
  let m = sim.request(ID(1), { carrier: "yard-a", bay: 5, row: 0 }).move;
  runUntil(world, () => sim.handlers.get("crane-1").phase === "travel");
  world.getObject("track-1").set({ points: [[-250, 1228.7], [1750, 1228.7]] });
  world.step(0.01);
  assert.equal(m.handler, "reach-stacker-1");
  assert.equal(sim.handlers.get("crane-1").busy, false);
  let shots = aim(sim);
  runUntil(world, () => m.state === "done");
  assert.deepEqual(names(log, (e) => e.p.move === m), ["move.queued", "move.started", "move.started", "container.moved", "move.finished"]);
  assert.ok(shots.every((s) => s.off < 0.01), JSON.stringify(shots));
  // after the lock: the yard moves 100 mm (within reach) while the crane carries, then while it sets down
  for (const phase of ["carry", "set-down"]) {
    ({ world, sim, log } = setup());
    m = sim.request(ID(1), { carrier: "yard-a", bay: 5, row: 0 }).move;
    runUntil(world, () => sim.handlers.get("crane-1").phase === phase);
    world.getObject("yard-a").set({ position: [850, 467.8] });
    shots = aim(sim);
    finish(world, sim, log, m);
    assert.ok(shots.length === 1 && shots[0].off < 0.01, `${phase}: ${JSON.stringify(shots)}`);
  }
  // after the lock: the yard moves out of reach; the crane holds the container until it is back
  ({ world, sim, log } = setup());
  m = sim.request(ID(1), { carrier: "yard-a", bay: 5, row: 0 }).move;
  runUntil(world, () => sim.handlers.get("crane-1").phase === "carry");
  world.getObject("yard-a").set({ position: [750, 967.8] });
  run(world, 60);
  assert.equal(m.state, "active");
  assert.equal(m.waiting, "waiting for Block A to come within reach");
  assert.equal(sim.inventory.get(ID(1)).handler, "crane-1");
  world.getObject("yard-a").set({ position: [750, 467.8] });
  shots = aim(sim);
  finish(world, sim, log, m);
  assert.ok(shots.length === 1 && shots[0].off < 0.01, JSON.stringify(shots));
});

/* ---------------------------------------------------------------- model wagons pushed while handled */

/** A model wagon (W3, sggrss80) for the test layout: `put(x, y)` shows its tags there for `frames` frames. */
function modelWagon(world, sim) {
  const type = CARRIER_TYPES.sggrss80;
  let time = 0;
  const frame = (x, y) => Object.fromEntries([0, 1, 2].map((slot) => [encodeTag(3, slot, 4), { center: [x + mm(type.bays_m[slot]), y], heading: 0, edge_mm: 20 }]));
  return {
    /** Show it at (x, y) for `frames` frames of 0.1 s, stepping the world by `dt` real seconds after each. */
    put(x, y, frames = 1, dt = 0) {
      for (let i = 0; i < frames; i++, time += 0.1) {
        sim.observe(frame(x, y), time);
        if (dt) world.step(dt);
      }
    },
    /** Push it from x0 to x1 (frames while it moves, then while it stands again). */
    push(x0, x1, y, dt = 0) {
      for (let i = 1; i <= 6; i++) this.put(x0 + ((x1 - x0) * i) / 6, y, 1, dt);
      this.put(x1, y, 13, dt);
    },
  };
}

test("a crane and a reach stacker follow a model wagon that was pushed while they handled it", () => {
  const y = 228.7;
  // a crane takes a container off W3; W3 is pushed 60 mm while the spreader is lowered onto it
  let { world, sim, log } = setup();
  let w = modelWagon(world, sim);
  w.put(700, y, 15);
  assert.equal(sim.request(ID(5), { carrier: "W3" }).error, undefined);
  let m = sim.moves[0];
  finish(world, sim, log, m);
  m = sim.request(ID(5), { carrier: "yard-a" }).move;
  runUntil(world, () => sim.handlers.get("crane-1").phase === "lower");
  let shots = aim(sim);
  w.push(700, 760, y, 0.01);
  finish(world, sim, log, m);
  assert.ok(shots.length === 2 && shots.every((s) => s.off < 0.01), JSON.stringify(shots));
  // a crane sets a container down on W3; W3 is pushed while the crane carries (it never waits)
  for (const phase of ["carry", "set-down"]) {
    ({ world, sim, log } = setup());
    w = modelWagon(world, sim);
    w.put(700, y, 15);
    m = sim.request(ID(5), { carrier: "W3" }).move;
    runUntil(world, () => sim.handlers.get("crane-1").phase === phase);
    shots = aim(sim);
    w.push(700, 760, y, phase === "carry" ? 0 : 0.01);
    finish(world, sim, log, m);
    assert.ok(shots.length === 1 && shots[0].off < 0.01, `${phase}: ${JSON.stringify(shots)}`);
    assert.ok(Math.abs(sim.boxes().find((b) => b.id === ID(5)).center[0] - sim.handlers.get("crane-1").point()[0]) < 1e-6);
  }
  // a reach stacker sets a container down on W3 (beyond the crane); W3 is pushed while it sets down
  ({ world, sim, log } = setup());
  w = modelWagon(world, sim);
  w.put(1500, y, 15);
  m = sim.request(ID(8), { carrier: "W3" }).move;
  assert.equal(m.handler, "reach-stacker-1");
  runUntil(world, () => sim.handlers.get("reach-stacker-1").phase === "set-down");
  shots = aim(sim);
  w.push(1500, 1560, y, 0.01);
  finish(world, sim, log, m);
  assert.ok(shots.length === 1 && shots[0].off < 0.01, JSON.stringify(shots));
  // pushed out of the crane's reach before its move starts: the reach stacker takes the move
  ({ world, sim, log } = setup());
  w = modelWagon(world, sim);
  w.put(700, y, 15);
  const busy = sim.request(ID(1), { carrier: "yard-a" }).move;
  m = sim.request(ID(5), { carrier: "W3" }).move;
  assert.equal(m.handler, "crane-1");
  w.push(700, 1500, y);
  world.step(0.01);
  assert.equal(m.handler, "reach-stacker-1");
  finish(world, sim, log, busy);
  finish(world, sim, log, m);
});

/* ---------------------------------------------------------------- drawing */

test("draw builds the scene in the camera view and the flyover without errors", () => {
  const { world, sim } = setup({ fill: { "yard-a": 0.3 } });
  sim.observe({ [encodeTag(3, 0, 4)]: { center: [700, 228.7], heading: 0, edge_mm: 20 } }, 0);
  sim.request(ID(1), { carrier: "yard-a" });
  sim.sendTruck({ purpose: "delivery" });
  run(world, 60);
  sim.highlight = { selected: ID(6), targets: sim.targets(ID(6)).ok, slots: true };
  // a canvas that accepts every call (gradients included)
  const gradient = { addColorStop() {} };
  const special = { measureText: () => ({ width: 10 }), createRadialGradient: () => gradient, createLinearGradient: () => gradient, getLineDash: () => [] };
  const ctx = new Proxy({ canvas: { width: 1280, height: 720 } }, {
    get: (o, k) => (k in o ? o[k] : special[k] ?? (() => {})),
    set: (o, k, v) => ((o[k] = v), true),
  });
  const camera = new Camera(1280, 720);
  const { fx, cx, cy } = camera.intrinsics, d = 3000;
  const errors = [], error = console.error;
  console.error = (...a) => errors.push(a.join(" "));
  try {
    for (const virtual of [false, true]) {
      for (const night of [0, 0.8]) world.draw(new View({ ctx, camera, H: [fx, 0, cx * d, 0, -fx, cy * d, 0, 0, d], scale: 87, virtual, night }));
    }
    sim.forgetObservations(); // a ghost over the camera image
    world.draw(new View({ ctx, camera, H: [fx, 0, cx * d, 0, -fx, cy * d, 0, 0, d], scale: 87 }));
  } finally {
    console.error = error;
  }
  assert.deepEqual(errors, []);
  sim.highlight = { selected: null, targets: null, slots: false };
});

/* ---------------------------------------------------------------- validation */

test("rolling_stock heights: 0 to 200 mm, else markers.rolling.height_mm", () => {
  const heights = ["abc", -5, "", 5000, true, 18, 0];
  const json = layout({ rolling_stock: heights.map((height_mm, i) => ({ number: i + 4, height_mm })) });
  const problems = validateLayout(json, registry);
  assert.deepEqual(problems.filter((p) => p.includes("height_mm")).map((p) => p.replace(/^.*rolling_stock/, "rolling_stock")),
    [0, 1, 2, 3, 4].map((i) => `rolling_stock[${i}]: height_mm must be a number from 0 to 200 (mm)`));
  const sim = terminalOf(createWorld(json));
  assert.deepEqual(heights.map((_, i) => sim.tagHeight(encodeTag(i + 4, 0, 4))), [15, 15, 15, 15, 15, 18, 0]);
  // a number given as text is not a wagon number, so its height is not used either
  assert.equal(terminalOf(createWorld(layout({ rolling_stock: [{ number: "4", height_mm: 18 }] }))).tagHeight(encodeTag(4, 0, 4)), 15);
});

test("validate reports every problem of a terminal entry", () => {
  assert.deepEqual(validateLayout(EXAMPLE, registry), []);
  assert.deepEqual(validateLayout(layout(), registry), []);
  const bad = layout({
    default_wagon: "boxcar",
    trains: [
      { id: "K1", track: "track-1", wagons: ["sgns60", "flat"], direction: 2, stop_mm: -5 },
      { id: "K1", track: "track-2" }, { name: "no id" }, { id: "W3", track: "track-1" }, { id: "a/b", track: "track-1" },
      { id: "K3", track: "lane-1" },
    ],
    barges: [{ id: "B1", quay: "nowhere", length_m: 200 }],
    trucks: { lane: "track-1" },
    rolling_stock: [{ number: 0 }, { number: 3, type: "sggrss80" }, { number: 3, type: "x" }, { number: 20, type: "sggrss80" }],
    containers: [
      { id: ID(1), size: "20", at: at("K1/1", 0) },
      { id: ID(1), size: "20", at: at("K1/1", 1) },
      { id: ID(2), size: "53", at: at("K1/1", 1) },
      { id: "ARLU 100001 4", size: "20", at: at("yard-a", 0) },
      { id: ID(3), size: "20", at: at("T1", 0) },
      { id: ID(4), size: "20", at: at("K1/1", 0) },
      { id: ID(5), size: "20", at: at("yard-a", 1, 0, 1) },
      { id: ID(6), size: "45", at: at("K1/2", 0) },
    ],
    fill: { "yard-a": 2, "track-1": 0.5 },
  });
  bad.markers.rolling.codes = 64;
  bad.simulations.push({ type: "terminal" });
  const problems = validateLayout(bad, registry);
  const expect = [
    'simulations[0] (terminal): default_wagon: unknown wagon type "boxcar"',
    'trains[0] (K1): unknown wagon type "flat"',
    "trains[0] (K1): direction must be 1 or -1",
    "trains[0] (K1): stop_mm must be a number ≥ 0",
    'duplicate visit id "K1"',
    "trains[2] has no id",
    'visit id "W3" must not contain "/" or look like W1 or T1',
    'visit id "a/b" must not contain "/" or look like W1 or T1',
    'trains[5] (K3): no track "lane-1"',
    'barges[0] (B1): no quay "nowhere"',
    "barges[0] (B1): length_m must be 25–110",
    'trucks.lane: no truck lane "track-1"',
    "rolling_stock[0]: number must be a whole number ≥ 1",
    "rolling_stock[2]: duplicate number 3",
    'rolling_stock[2]: unknown type "x"',
    "rolling_stock[3]: wagon 20 needs tag IDs up to 79, but markers.rolling.codes is 64",
    `containers[1]: duplicate id "${ID(1)}"`,
    `containers[2] (${ID(2)}): unknown size "53"`,
    "containers[3] (ARLU 100001 4): check digit should be 9",
    `containers[4] (${ID(3)}): unknown place "T1"`,
    `containers[5] (${ID(4)}): Occupied by ${ID(1)}`,
    `containers[6] (${ID(5)}): Nothing to stand on`,
    `containers[7] (${ID(6)}): Sgns (60 ft) takes no 45 ft containers`,
    'fill: no container yard "track-1"',
    "fill.yard-a must be 0–1",
    "simulations[1] (terminal): only one container terminal per layout",
  ];
  for (const e of expect) assert.ok(problems.some((p) => p.includes(e)), `missing: ${e}\n${problems.join("\n")}`);
  assert.ok(!problems.some((p) => p.startsWith("simulations[0] (terminal): only one")));
  // list shapes and missing rolling-stock markers
  const shapes = layout({ trains: {}, barges: 1, containers: "x", rolling_stock: {} });
  delete shapes.markers.rolling;
  const p2 = validateLayout(shapes, registry);
  for (const e of ["trains must be a list", "barges must be a list", "containers must be a list", "rolling_stock must be a list"]) assert.ok(p2.some((p) => p.endsWith(e)), e);
  const noRolling = layout();
  delete noRolling.markers.rolling;
  assert.ok(validateLayout(noRolling, registry).some((p) => p.endsWith("rolling_stock: markers.rolling is missing, so model wagons cannot be seen")));
  // invalid entries do not stop the terminal from loading
  const warn = console.warn;
  console.warn = () => {};
  try {
    const sim = terminalOf(createWorld(bad));
    assert.ok(sim.inventory.get(ID(1)));
    assert.deepEqual(sim.inventory.check(), []);
  } finally {
    console.warn = warn;
  }
});

/* ---------------------------------------------------------------- determinism and isolation */

test("determinism: the same seed gives the same events, inventory and crane positions", () => {
  const play = (seed) => {
    const world = createWorld(EXAMPLE, { seed });
    const sim = terminalOf(world), log = [];
    world.events.on("*", (p, name) => {
      if (name.startsWith("terminal.")) log.push(`${world.time.toFixed(2)} ${name} ${p.move?.id ?? p.visit?.id ?? p.container?.id ?? p.carrier?.id ?? ""}`);
    });
    world.scenarios.play("morning-shift");
    for (let i = 0; i < 600 / (0.1 * 2); i++) world.step(0.1); // speed 10 from the scenario: 600 s and more
    const crane = sim.handlers.get("crane-1");
    return { log, inventory: sim.inventory.snapshot(), crane: [crane.s, crane.t, crane.z, crane.phase], time: world.time };
  };
  const a = play(9), b = play(9);
  assert.ok(a.time >= 600);
  assert.ok(a.log.length > 20);
  assert.ok(a.log.some((l) => l.includes("move.finished")));
  assert.deepEqual(a.log, b.log);
  assert.deepEqual(a.inventory, b.inventory);
  assert.deepEqual(a.crane, b.crane);
  const c = play(10);
  assert.notDeepEqual(c.inventory, a.inventory, "another seed fills the yards differently");
});

test("isolation: a terminal entry leaves the passenger simulation unchanged", () => {
  const stats = (json) => {
    const world = createWorld(json, { seed: 5 });
    for (let i = 0; i < 60 / (0.1 * world.speed); i++) world.step(0.1);
    const p = world.simulations[0];
    return { stats: world.stopAreas().map((a) => p.stats(a.id)), next: world.rng.next(), time: world.time };
  };
  const plain = stats(LAB);
  const withTerminal = stats({ ...LAB, simulations: [...LAB.simulations, { type: "terminal", fill: {} }] });
  assert.ok(plain.stats.some((s) => s && s.count > 0));
  assert.deepEqual(withTerminal, plain);
});
