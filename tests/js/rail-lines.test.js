// Rail lines (rail/lines.js): trains that run along a chain of tracks from platform to platform, out
// of view where the tracks do not meet, stop at every platform in both directions, turn at the last
// one and leave where they came in; a platform of the line's own and one it shares with the
// timetable; one track for both directions; what the Waldhof module of the EBL layout makes of it.
import assert from "node:assert/strict";
import test from "node:test";

import { MEET_MM, RailLine, createWorld, registry, trainConsist } from "../../web/arail/index.js";
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
  const v = world.services.call("pb:right", { source: "rail-line", line: "RB 9 → A", direction: -1 });
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
  const seen = [], timetable = [], shared = new Set();
  world.events.on("vehicle.arrived", ({ vehicle, dock }) => {
    if (vehicle.lineTrain === "line-1") seen.push([vehicle.railLine, dock.id, vehicle.direction, vehicle.line]);
    if (vehicle.source !== "rail-line" && dock.id === "pa:right") timetable.push(vehicle.line);
    if (vehicle.source !== "rail-line" && dock.id === "pb:right") shared.add(vehicle.line);
  });
  const m = line.mm(1), speeds = new Map();
  const sim = world.simulations.find((x) => x.constructor.type === "passengers"), keys = new Set();
  let met = 0, most = 0, close = 0, dead = 0, waitingBoard = 0, sharedBoard = 0;
  run(world, 1500, () => {
    most = Math.max(most, line.trains.length);
    for (const k of [0, 2]) {
      const on = line.trains.filter((t) => t.k === k && t.state !== "gone");
      // never two trains coming towards each other on a stretch
      if (new Set(on.map((t) => t.r)).size > 1) met++;
      // the one behind keeps its distance to the tail of the one ahead
      for (const a of on) for (const b of on) if (a !== b && (b.x - a.x) * a.r > 0 && ((b.x - a.x) * a.r) / m - b.length_m < 149) close++;
    }
    // nobody in view stops dead: from the running speed to standing only by braking (out of view they wait at its end)
    for (const t of line.trains) {
      const seen = t.state === "run" && line._stretchOf(t) >= 0;
      if (seen && t.v === 0 && (speeds.get(t.id) ?? 0) > 3) dead++;
      speeds.set(t.id, seen ? t.v : 0);
    }
    // while a train stands where the trains turn, the first platform's board shows it coming back
    if (line.trains.some((t) => t.state === "dock" && t.stop.dock.id === "pb:right") && !world.services.docks.get("pa:right").vehicle) {
      if (statusLines(world, world.getStopArea("pa"))[0] === "Waiting for the next train") waitingBoard++;
    }
    // the shared platform's board shows the line's trains with the timetable's
    if (!world.services.docks.get("pb:right").vehicle && statusLines(world, world.getStopArea("pb")).some((l) => l.startsWith("RB 9 → "))) sharedBoard++;
    // its trains at the platforms are the services' vehicles in the Overview
    for (const x of sim.states().find((g) => g.id === "vehicles").items) if (x.name.startsWith("RB 9")) keys.add(x.key.split(":")[0]);
  });
  assert.equal(met, 0, "nobody comes the other way");
  assert.equal(close, 0, "nobody closer than 150 m behind the one ahead");
  assert.equal(dead, 0, "nobody stops dead");
  assert.equal(waitingBoard, 0, "the board knows the train that turns");
  assert.ok(sharedBoard > 0, "the shared platform's board shows the RB 9");
  assert.deepEqual([...keys], ["vehicle"], "picked as the dock's vehicle");
  assert.ok(shared.size && !shared.has("RB 9"), `the timetable sends no RB 9 of its own: ${[...shared]}`);
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
  world.events.on("vehicle.arrived", ({ vehicle, dock }) => vehicle.source === "rail-line" && docks.push(dock.id));
  // it turns where it stands: its tail, near the end of the track, is its new front
  const m = line.mm(1), end = line.geometry.stretches[1].total, before = new Map();
  let turned = false;
  run(world, 900, () => {
    for (const t of line.trains) {
      if (t.turned && before.get(t.id) === false) {
        turned = true;
        assert.equal(t.r, -1);
        assert.ok(Math.abs(t.x - (end - t.length_m * m)) < 5 * m, `${t.x} at ${end - t.length_m * m}`);
      }
      before.set(t.id, t.turned);
    }
  });
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
  const s10 = world.getObject("line-s10");
  assert.deepEqual(s10.problems(), []);
  assert.deepEqual(s10.route().stops[1].map((p) => p.dock.id), ["platform-pirna:right", "platform-heidenau:left"]);
  // the platforms have their edge only on the line's track: the timetable sends no trains of its own there
  assert.deepEqual(["platform-pirna", "platform-heidenau"].flatMap((id) => world.getStopArea(id).docks.map((d) => [d.id, world.services.docks.get(d.id).mode])),
    [["platform-pirna:right", "line"], ["platform-heidenau:left", "line"]]);
  assert.equal(trainConsist(world, { line: "S 10 → Heidenau", source: "rail-line" }).vehicles[0].type, "et442s", "the short unit the platforms take");
  const lift = (x, y) => world.elevation.sync().ground(x, y);
  assert.ok(Math.abs(lift(3500, 850)) < 1 && Math.abs(lift(5000, 760)) < 1, "the strip at the table's level along Bf Neustadt and Heidenau");
  assert.ok(lift(-245, 870) === 56 && lift(375, 868) === 56, "Pirna's platform on one level, 56 mm up");
  // the exclusive modules show the station alone, as before
  const plan = createWorld(json, { seed: 2 });
  plan.setLayers(["plan"]);
  assert.equal(plan.getObject("line-rb30"), null);
});
