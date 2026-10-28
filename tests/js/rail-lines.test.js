// Rail lines (rail/lines.js): trains that run along a chain of tracks from platform to platform, out
// of view where the tracks do not meet, stop at every platform in both directions, turn at the last
// one and leave where they came in; a platform of the line's own and one it shares with the
// timetable; one track for both directions; what the Waldhof module of the EBL layout makes of it.
import assert from "node:assert/strict";
import test from "node:test";

import { MEET_MM, RailLine, createWorld, registry } from "../../web/arail/index.js";
import { placeSpec } from "../../web/builder/place.js";
import { statusLines } from "../../web/arail/sims/passengers.js";
import { readJSON } from "./helpers.js";

/**
 * Station A (its platform lists only RB 9: the line's own), a track on, a gap out of view, a track
 * on to station B (its platform shares the RB 9 with the RE 1 of the timetable).
 */
function layout(more = {}) {
  return {
    format: "arail-layout/1", scale: 87,
    services: { approach_s: 4, rail_dwell_s: 10, auto_interval: false },
    objects: [
      { id: "a1", type: "track", track_id: "A1", points: [[0, 0], [3000, 0]] },
      { id: "l1", type: "track", track_id: "L1", points: [[3000, 0], [6000, 0]] },
      { id: "l2", type: "track", track_id: "L2", points: [[10000, 0], [13000, 0]] },
      { id: "b1", type: "track", track_id: "B1", points: [[13000, 0], [16000, 0]] },
      { id: "pa", type: "platform", name: "A", from: [500, 40], to: [2500, 40], width_mm: 40, sides: "right", track_right: "A1", lines: "RB 9" },
      { id: "pb", type: "platform", name: "B", from: [13500, 40], to: [15500, 40], width_mm: 40, sides: "right", track_right: "B1", lines: "RB 9, RE 1" },
      { id: "line", type: "rail-line", number: "RB 9", destination: "B", origin: "A", tracks: ["a1", "l1", "l2", "b1"], hidden_km: 1, headway_s: 300 },
      ...(more.objects || []),
    ],
  };
}

/** Run `seconds` of simulated time, calling `each` after every step. */
function run(world, seconds, each = () => {}) {
  world.speed = 4;
  for (let t = 0; t < seconds; t += 0.4) {
    world.step(0.1);
    each();
  }
}

test("the route: the tracks oriented the way the trains run, joined where they meet, out of view where they do not", () => {
  assert.equal(registry.objects.get("rail-line"), RailLine);
  assert.equal(MEET_MM, 30);
  const world = createWorld(layout());
  const line = world.getObject("line");
  const g = line.geometry;
  assert.deepEqual(g.segments, [{ kind: "stretch", i: 0 }, { kind: "hidden", length_m: 1000 }, { kind: "stretch", i: 1 }]);
  assert.deepEqual(g.stretches.map((s) => [s.tracks.map((t) => [t.track.id, t.o]), Math.round(s.total)]), [[[["a1", 1], ["l1", 1]], 6000], [[["l2", 1], ["b1", 1]], 6000]]);
  assert.deepEqual(line.problems(), []);
  // a track drawn the other way is run from its other end
  const turned = createWorld(layout());
  turned.getObject("l1").set({ points: [[6000, 0], [3000, 0]] });
  assert.deepEqual(turned.getObject("line").geometry.stretches[0].tracks.map((t) => t.o), [1, -1]);
  // what is wrong
  const broken = createWorld(layout());
  broken.getObject("line").set({ tracks: ["l1", "gone"] });
  assert.deepEqual(broken.getObject("line").problems(), ["A track of the line is missing.", "No platform on its tracks: the trains do not stop anywhere."]);
  assert.deepEqual(createWorld({ objects: [{ id: "x", type: "rail-line" }] }).getObject("x").problems(), ["Tap the tracks the trains run along, in order."]);
});

test("the stops in both directions, where the trains turn; a platform of its own and one it shares", () => {
  const world = createWorld(layout());
  const line = world.getObject("line"), route = line.route();
  assert.deepEqual(route.stops[1].map((p) => [p.dock.id, p.k, p.d]), [["pa:right", 0, 1], ["pb:right", 2, 1]]);
  assert.deepEqual(route.stops[-1].map((p) => [p.dock.id, p.k, p.d]), [["pb:right", 2, -1], ["pa:right", 0, -1]], "back: the docks' trains go the other way");
  assert.equal(route.turn.dock.id, "pb:right");
  assert.ok(route.stops[1][0].x > 2000 && route.stops[1][0].x < 2500, "the front near the end of the platform it heads for");
  assert.equal(line.label(1), "RB 9 → B");
  assert.equal(line.label(-1), "RB 9 → A");
  // A lists only the RB 9: only its trains come there; B is shared with the timetable
  assert.equal(world.services.docks.get("pa:right").mode, "line");
  assert.equal(world.services.docks.get("pb:right").mode, "timetable");
  assert.equal(world.services.call("pa:right", { source: "manual" }), null, "a platform of the line takes no other trains");
  // a train sent the other way
  const v = world.services.call("pb:right", { source: "line", line: "RB 9 → A", direction: -1 });
  assert.equal(v.direction, -1);
  assert.equal(world.services.call("pb", { source: "manual" }), null, "taken");
  // without the line its platform goes back to the timetable
  world.removeObject("line");
  assert.equal(world.services.docks.get("pa:right").mode, "timetable");
});

test("a train runs out, stops, turns at the last platform, runs back and leaves; one track for both directions", () => {
  const world = createWorld(layout(), { seed: 3 });
  const line = world.getObject("line");
  line.set({ headway_s: 60 });
  const seen = [], timetable = [];
  world.events.on("vehicle.arrived", ({ vehicle, dock }) => {
    if (vehicle.lineTrain === "line-1") seen.push([vehicle.railLine, dock.id, vehicle.direction, vehicle.line]);
    if (vehicle.source !== "line" && dock.id === "pa:right") timetable.push(vehicle.line);
  });
  let met = 0, most = 0;
  run(world, 1500, () => {
    most = Math.max(most, line.trains.length);
    // never two trains coming towards each other on a stretch
    for (const k of [0, 2]) {
      const dirs = new Set(line.trains.filter((t) => t.k === k && t.state !== "gone").map((t) => t.r));
      if (dirs.size > 1) met++;
    }
  });
  assert.equal(met, 0, "nobody comes the other way");
  assert.ok(most >= 2, "several trains on the line");
  assert.deepEqual(seen, [["line", "pa:right", 1, "RB 9 → B"], ["line", "pb:right", 1, "RB 9 → B"], ["line", "pa:right", -1, "RB 9 → A"]], "the first train");
  assert.deepEqual(timetable, [], "no timetable trains at the line's own platform");
  // trains that came back left the line
  const first = line.trains.map((t) => t.id);
  assert.ok(!first.includes("line-1"), "the first train has left");
  // the boards of its own platform show its next trains
  const area = world.getStopArea("pa");
  const lines = statusLines(world, area);
  assert.ok(lines.length && /^RB 9 → [AB]( in \d+ s| (arriving|boarding|departing))$/.test(lines[0]), lines.join(" | "));
});

test("a platform run by a planner is passed; the trains turn at the end of the route then", () => {
  const world = createWorld(layout(), { seed: 4 });
  const line = world.getObject("line");
  world.services.planner = { claims: (dock) => dock.id === "pb:right" };
  world.services.refreshModes();
  const docks = [];
  world.events.on("vehicle.arrived", ({ vehicle, dock }) => vehicle.source === "line" && docks.push(dock.id));
  let turned = false;
  run(world, 900, () => (turned ||= line.trains.some((t) => t.turned)));
  assert.ok(turned, "the trains turned");
  assert.ok(docks.length && docks.every((d) => d === "pa:right"), docks.join(", "));
});

test("placing a rail line: the tracks tapped in order go to `tracks`", () => {
  const world = createWorld(layout());
  assert.deepEqual(placeSpec(world, RailLine, ["a1", "l1"]), { type: "rail-line", tracks: ["a1", "l1"] });
  assert.equal(placeSpec(world, RailLine, ["a1"]), null);
  assert.equal(RailLine.stopsKey, "tracks");
  assert.deepEqual(RailLine.stopTypes, ["track"]);
});

test("the EBL layout: the RB 30 from Waldhof to Neustadt, Waldhof's platform its own, Bf Neustadt shared", () => {
  const json = readJSON("web/layouts/ebl-neustadt.json");
  const world = createWorld(json, { seed: 2 });
  const line = world.getObject("line-rb30");
  assert.ok(line, "the Waldhof module is on");
  assert.deepEqual(line.problems(), []);
  assert.deepEqual(line.geometry.segments.map((s) => s.kind), ["stretch", "hidden", "stretch"], "out of view round the hall");
  const route = line.route();
  assert.deepEqual(route.stops[1].map((p) => p.dock.id), ["platform-wh-1:right", "platform-2:left"]);
  assert.equal(route.turn.dock.id, "platform-2:left");
  assert.equal(world.services.docks.get("platform-wh-1:right").mode, "line");
  assert.equal(world.services.docks.get("platform-2:left").mode, "timetable");
  // the Waldhof photos are tracked with the layout's markers: those of Waldhof south and Waldhof are in its marker map
  const poses = json.markers.poses;
  for (const id of [88, 89, 90, 91, 104, 106, 107, 110, 111, 112, 146, 163, 164]) assert.ok(poses[id], `marker ${id}`);
  const map = readJSON("web/lab-map/data.json");
  const waldhof = map.photos.filter((p) => p.layer === "neustadt" && (p.group === "S10" || p.group === "S11")).map((p) => p.id);
  assert.ok(waldhof.length >= 10, waldhof.join(", "));
  // the S-Bahn on its strip along the windows: Pirna and Heidenau, the strip raised at the Pirna end
  const s1 = world.getObject("line-s1");
  assert.deepEqual(s1.problems(), []);
  assert.deepEqual(s1.route().stops[1].map((p) => p.dock.id), ["platform-pirna:right", "platform-heidenau:right"]);
  assert.equal(world.services.docks.get("platform-pirna:right").mode, "line");
  const lift = (x, y) => world.elevation.sync().ground(x, y);
  assert.ok(Math.abs(lift(3500, 870)) < 1 && lift(600, 900) === 50, "the strip at the table's level, 50 mm at Pirna");
  // the exclusive modules show the station alone, as before
  const plan = createWorld(json, { seed: 2 });
  plan.setLayers(["plan"]);
  assert.equal(plan.getObject("line-rb30"), null);
});
