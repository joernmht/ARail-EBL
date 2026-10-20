// The trains at the platforms (rail/stock.js, rail/trains.js): the default fleet by the kind of the
// line, coupled in the rush hours where the platform takes it, their places, where they stop, their
// doors along the platform, and the people who do not get on a full train.
import assert from "node:assert/strict";
import test from "node:test";

import { polylineAt } from "../../web/arail/core/math.js";
import { Consist, DEFAULT_FLEET, PEAK_DEMAND, STOP_MARGIN_M, consistRows, createWorld, fleetEntry, trainConsist, trainDoors, trainOutline, trainPose } from "../../web/arail/index.js";
import { readJSON } from "./helpers.js";

/** A train of the timetable at a platform of `length` m, without a world around it. */
const train = (line, length, demand = 1, more = {}) => ({ id: `v-${line}`, line, demand, source: "timetable", dock: { s0: 0, s1: length }, ...more });

/** Run the simulation for `seconds` of simulated time. */
function run(world, seconds, dtReal = 0.05) {
  const steps = Math.ceil(seconds / (dtReal * world.speed));
  for (let i = 0; i < steps; i++) world.step(dtReal);
}

test("the default fleet: by the kind of the line, with its places", () => {
  assert.equal(fleetEntry("RE 2"), DEFAULT_FLEET.RE);
  assert.equal(fleetEntry("rb 71 → Talsee 07:15"), DEFAULT_FLEET.RB);
  assert.equal(fleetEntry("S1"), DEFAULT_FLEET.S, "the letters the line begins with");
  assert.equal(fleetEntry("ICE 70"), DEFAULT_FLEET[""]);
  assert.equal(fleetEntry(null), DEFAULT_FLEET[""]);
  const s = new Consist(DEFAULT_FLEET.S);
  assert.deepEqual([s.seats, s.standing, s.capacity], [200, 240, 440]);
  assert.equal(Object.fromEntries(consistRows(s)).Places, "200 seats · 240 standing");
  assert.ok(new Consist(DEFAULT_FLEET.RB).length_m < 50 && new Consist(DEFAULT_FLEET.RE).length_m > 120, "a short unit, a long train");
  assert.equal(Object.fromEntries(consistRows(new Consist({ vehicles: [{ type: "br185" }] }))).Places, undefined, "no places: no row");
});

test("coupled in the rush hours, as often as the platform takes it", () => {
  const world = createWorld({});
  const one = new Consist(DEFAULT_FLEET.S).length_m;
  assert.equal(trainConsist(world, train("S 1", 150)).length_m, one, "outside the rush hours: one unit");
  assert.equal(trainConsist(world, train("S 1", 150, PEAK_DEMAND)).length_m, 2 * one, "in the rush hours: two");
  assert.equal(trainConsist(world, train("S 1", 120, 1.5)).length_m, one, "the platform takes only one");
  assert.equal(trainConsist(world, train("RE 2", 400, 1.5)).vehicles.length, 5, "a train without peak: as it is");
  // the layout's consists, with their own peak
  const layout = createWorld({ consists: [{ id: "rb", lines: ["RB 71"], vehicles: [{ type: "br642" }], peak: 3 }] });
  assert.equal(trainConsist(layout, train("RB 71", 200, 1.5)).vehicles.length, 3);
  assert.equal(trainConsist(layout, train("RB 71", 200)).vehicles.length, 1);
  // a planner's consist comes first; a train of the control system has none of the fleet
  assert.equal(trainConsist(world, train("S 1", 200, 1, { consistSpec: { vehicles: [{ type: "br642" }] } })).vehicles[0].type, "br642");
  assert.equal(trainConsist(world, train("S 1", 200, 1, { source: "feed" })), null);
  // worked out once
  const v = train("S 1", 150);
  assert.equal(trainConsist(world, v), trainConsist(world, v));
});

test("a train at the platform: its front near the end it heads for, its doors along the platform", () => {
  const world = createWorld(readJSON("web/layouts/ebl-neustadt.json"), { seed: 3 });
  const seen = new Map();
  world.events.on("vehicle.arriving", ({ vehicle }) => {
    if (vehicle.kind !== "train" || seen.has(vehicle.id)) return;
    const pose = trainPose(world, vehicle);
    seen.set(vehicle.id, { vehicle, far: Math.abs(pose.head - pose.stop) / pose.line.m - pose.length_m });
  });
  run(world, 20 * 60);
  assert.ok(seen.size >= 3, `${seen.size} trains came`);
  for (const { vehicle: v, far } of seen.values()) {
    assert.ok(Math.abs(far - 40) < 1e-6, `${v.line}: comes in from as far back as it is long and 40 m`);
  }
  // the next one standing at its platform
  const standing = () => world.services.vehicles().find((x) => x.kind === "train" && x.phase === "dwelling");
  for (let i = 0; i < 20 && !standing(); i++) run(world, 30);
  const v = standing();
  assert.ok(v, "a train at a platform");
  const pose = trainPose(world, v), dock = v.dock, area = dock.area;
  assert.equal(pose.head, pose.stop, "it stands at its stop");
  const front = area.fromLayout(polylineAt(pose.line.points, pose.head, pose.line.lengths).point)[0];
  const end = v.direction > 0 ? dock.s1 - STOP_MARGIN_M : dock.s0 + STOP_MARGIN_M;
  assert.ok(Math.abs(front - end) < 0.5, `${v.line}: its front ${front.toFixed(1)} m along the platform, the stop ${end.toFixed(1)} m`);
  assert.equal(Math.round(pose.length_m), Math.round(trainConsist(world, v).length_m), "as long as its consist");
  const doors = trainDoors(world, v);
  assert.deepEqual(world.services.doors(v), doors, "the passengers use its doors");
  assert.ok(doors.length >= 4 && doors.every((s) => s >= dock.s0 && s <= dock.s1), `${doors.length} doors along the platform`);
  assert.ok(trainOutline(pose).length >= 4, "an outline to point at");
});

test("a full train: nobody else gets on, the people left behind are counted", () => {
  const world = createWorld(readJSON("web/layouts/ebl-neustadt.json"), { seed: 5 });
  const svc = world.services;
  // every train comes in more than full
  world.events.on("vehicle.arriving", ({ vehicle }) => {
    const cap = svc.capacityOf(vehicle);
    if (cap != null) vehicle.onboard = 10 * cap;
  });
  const boarded = [];
  world.events.on("vehicle.arrived", ({ vehicle }) => boarded.push(vehicle));
  run(world, 30 * 60);
  const trains = boarded.filter((v) => svc.capacityOf(v) != null);
  assert.ok(trains.length >= 3, `${trains.length} trains came`);
  const left = trains.reduce((n, v) => n + v.leftBehind, 0);
  assert.ok(left > 0, "people stayed on the platform");
  const v = trains.find((x) => x.leftBehind);
  const card = svc.card({ ref: v });
  const rows = Object.fromEntries(card.rows);
  assert.match(rows["Left behind"], /^\d+ \(full\)$/);
  assert.match(rows["On board"], /^\d+ of \d+ \(\d+ %\)$/);
  assert.match(card.status, /· full$/);
  // a train that is not full takes them: room for the people on the platform
  const free = createWorld(readJSON("web/layouts/ebl-neustadt.json"), { seed: 5 });
  const came = [];
  free.events.on("vehicle.arrived", ({ vehicle }) => came.push(vehicle));
  run(free, 30 * 60);
  const counted = came.filter((x) => free.services.capacityOf(x) != null);
  assert.ok(counted.length >= 3);
  assert.equal(counted.reduce((n, x) => n + x.leftBehind, 0), 0, "nobody left behind");
});
