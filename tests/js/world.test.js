import assert from "node:assert/strict";
import test from "node:test";

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createWorld, registry, validateLayout, loadPlugins, MockFeed, parseFeedMessage, LayoutObject, Registry, registerBuiltins, World,
} from "../../web/arail/index.js";
import { readJSON, ROOT } from "./helpers.js";

const LAB = readJSON("web/layouts/ebl-lab.json");
// the example layout uses the windmill plugin, loaded like the app does; the road-traffic example
// plugin (replaced in the example by the built-in traffic simulation) must keep loading, too
const pluginErrors = await loadPlugins([...LAB.plugins, "../plugins/road-traffic.js"], pathToFileURL(join(ROOT, "web/layouts/ebl-lab.json")).href);

test("example plugins load and register their types", () => {
  assert.deepEqual(LAB.plugins, ["../plugins/windmill.js"]);
  assert.deepEqual(pluginErrors, []);
  assert.ok(registry.objects.has("windmill"));
  assert.ok(registry.simulations.has("road-traffic"));
});

/** Run the simulation for `seconds` of simulated time. */
function run(world, seconds, dtReal = 0.05) {
  const steps = Math.ceil(seconds / (dtReal * world.speed));
  for (let i = 0; i < steps; i++) world.step(dtReal);
}

test("example layouts are valid and load completely", () => {
  for (const file of ["web/layouts/ebl-lab.json", "web/layouts/synthetic-demo.json"]) {
    const json = readJSON(file);
    assert.deepEqual(validateLayout(json, registry), [], file);
    const world = createWorld(json);
    assert.equal(world.objects.length, json.objects.length);
    assert.ok(!world.objects.some((o) => o.constructor.name === "UnknownObject"), "all object types known");
  }
  const world = createWorld(LAB);
  assert.deepEqual(world.simulations.map((s) => s.constructor.type), ["passengers", "town", "traffic"]);
  assert.equal(world.clock.label(), "07:00");
  for (const o of world.objects) assert.ok(o.geometry, `${o.id} has geometry (all markers are in the map)`);
  const areas = world.stopAreas();
  const stops = ["altmarkt", "schule", "siedlung"].flatMap((s) => [`bus-stop-${s}:left`, `bus-stop-${s}:right`]);
  assert.deepEqual(areas.map((a) => a.id).sort(), [...stops, "bus-terminal-1", "platform-1", "platform-2"].sort());
  const p1 = world.getObject("platform-1");
  assert.ok(Math.abs(p1.lengthM - 700.7 * 0.087) < 0.5, `platform 1 is ${p1.lengthM.toFixed(1)} m long`);
  // the timetable serves both tracks of each platform and one bus bay; the other two bays and the stops belong to the bus lines
  assert.equal(world.services.docks.size, 2 + 2 + 1, "two tracks per platform, one bus bay");
});

test("the lab example: a town in front of the real table, with streets, bus lines and houses", () => {
  const world = createWorld(LAB);
  const of = (type) => world.objects.filter((o) => o.type === type);
  // the town stands on table modules in front of the real table's near edge (y < -320 mm)
  const physical = of("tabletop").filter((t) => t.spec.kind === "physical");
  assert.equal(physical.length, 1, "the real table, drawn in the flyover");
  assert.ok(of("tabletop").length >= 5, "table modules extend the tabletop");
  const real = (o) => !["platform", "track", "tabletop"].includes(o.type);
  for (const o of world.objects.filter(real)) {
    const fp = o.footprint?.() || (o.anchorPoint?.() ? [o.anchorPoint()] : []);
    for (const p of fp) assert.ok(p[1] < -320, `${o.id} is in front of the real table (${p.map(Math.round)})`);
  }
  // German house types, greyscale
  for (const type of ["plattenbau", "altbau-block", "house-estate", "school", "supermarket", "office", "factory"]) assert.ok(of(type).length, type);
  // streets connected to the station: every building entrance and every stop has a way on foot
  const net = world.network();
  for (const a of world.stopAreas()) a.access.forEach((_, i) => assert.notEqual(net.place(`area:${a.id}:${i}`), null, `${a.id} access ${i}`));
  for (const o of world.objects) (o.entrances?.() || []).forEach((_, i) => assert.notEqual(net.place(`building:${o.id}:${i}`), null, `${o.id} entrance ${i}`));
  // two bus lines in CD colours, without problems, ending at the bus station "Bahnhof"
  world.transit.sync();
  const lines = [...world.transit.lines.values()];
  assert.deepEqual(lines.map((l) => [l.label, l.color]).sort(), [["62", "#0A777F"], ["85", "#C85000"]]);
  for (const l of lines) {
    assert.ok(l.ok && !l.problems.length, `line ${l.label}: ${l.problems.join("; ")}`);
    assert.equal(l.directions[0].stops[0].objectId, "bus-terminal-1");
    assert.ok(l.directions[0].stops.length >= 4, `line ${l.label} has several stops`);
  }
  assert.equal(world.getObject("bus-terminal-1").name, "Bahnhof");
  assert.deepEqual(world.objects.filter((o) => o.problems?.()?.length).map((o) => o.id), []);
});

test("layout JSON round trip keeps objects, markers and scenarios", () => {
  const world = createWorld(LAB);
  const json = JSON.parse(JSON.stringify(world.toJSON()));
  assert.deepEqual(json.objects, LAB.objects);
  assert.deepEqual(json.markers.poses, LAB.markers.poses);
  assert.deepEqual(json.scenarios, LAB.scenarios);
  const again = createWorld(json);
  assert.equal(again.objects.length, world.objects.length);
});

test("passengers arrive, trains come and people board and alight", () => {
  const world = createWorld(LAB, { seed: 7 });
  const events = {};
  world.events.on("*", (_, name) => (events[name] = (events[name] || 0) + 1));
  // at most one vehicle at a dock at a time (also at the docks of bus lines, which the timetable does not serve)
  const atDock = new Map();
  let crowded = 0;
  world.events.on("vehicle.arrived", (e) => {
    const n = (atDock.get(e.dock.id) || 0) + 1;
    atDock.set(e.dock.id, n);
    if (n > 1) crowded++;
  });
  world.events.on("vehicle.departed", (e) => atDock.set(e.dock.id, (atDock.get(e.dock.id) || 0) - 1));
  run(world, 400);
  assert.ok(events["vehicle.arrived"] >= 6, `vehicles arrived: ${events["vehicle.arrived"]}`);
  assert.equal(crowded, 0, "one vehicle at a dock at a time");
  const sim = world.simulations[0];
  for (const id of ["platform-1", "platform-2", "bus-terminal-1"]) {
    const s = sim.stats(id);
    assert.ok(s && s.count > 0, `${id}: people waiting (${s?.count})`);
    assert.ok(s.mood > 0.2 && s.mood <= 1, `${id}: mood ${s.mood}`);
  }
  const boardedOrAlighted = [...sim.crowds.values()].reduce((n, c) => n + c.outTimes.length, 0);
  assert.ok(boardedOrAlighted > 0, "people leave the stops (boarding or walking away)");
});

test("disruptions: a delay holds trains and makes passengers unhappy", () => {
  const calm = createWorld(LAB, { seed: 3 });
  const delayed = createWorld(LAB, { seed: 3 });
  delayed.disruptions.start({ type: "delay", target: "platform-1", params: { minutes: 20 } });
  let arrivals = 0;
  delayed.events.on("vehicle.arrived", (e) => e.area.id === "platform-1" && arrivals++);
  run(calm, 300);
  run(delayed, 300);
  assert.equal(arrivals, 0, "no trains at platform 1 during the delay");
  const moodCalm = calm.simulations[0].stats("platform-1").mood, moodDelayed = delayed.simulations[0].stats("platform-1").mood;
  assert.ok(moodDelayed < moodCalm - 0.1, `mood ${moodDelayed.toFixed(2)} (delayed) vs ${moodCalm.toFixed(2)}`);
  assert.equal(delayed.disruptions.effectsFor(delayed.getStopArea("platform-2")).hold, false, "other platforms unaffected");
});

test("disruptions: closure empties the platform, replacement buses run more often", () => {
  const world = createWorld(LAB, { seed: 5 });
  run(world, 120);
  assert.ok(world.simulations[0].stats("platform-2").count > 0);
  world.disruptions.start({ type: "closure", target: "platform-2", params: { minutes: 10 } });
  run(world, 200);
  assert.equal(world.simulations[0].stats("platform-2").count, 0, "everybody left the closed platform");

  const bus = createWorld(LAB, { seed: 5 });
  let buses = 0;
  bus.events.on("vehicle.arrived", (e) => e.dock.kind === "bus" && buses++);
  bus.disruptions.start({ type: "replacement-bus", target: "platform-2", params: { bus_terminal: "bus-terminal-1", minutes: 30 } });
  const fx = bus.disruptions.effectsFor(bus.getStopArea("bus-terminal-1"));
  assert.ok(fx.frequency > 1 && fx.demand > 1, "more buses and passengers at the terminal");
  assert.ok(bus.disruptions.effectsFor(bus.getStopArea("platform-2")).cancel, "trains cancelled at platform 2");
  run(bus, 400);
  const normal = createWorld(LAB, { seed: 5 });
  let normalBuses = 0;
  normal.events.on("vehicle.arrived", (e) => e.dock.kind === "bus" && normalBuses++);
  run(normal, 400);
  assert.ok(buses > normalBuses, `${buses} buses with replacement service vs ${normalBuses}`);
});

test("scenarios run their steps in order", () => {
  const world = createWorld(LAB, { seed: 1 });
  const messages = [];
  world.events.on("scenario.message", (e) => messages.push(e.text));
  world.scenarios.play("signal-failure");
  assert.equal(world.demand, 1.5);
  run(world, 40);
  assert.ok(world.disruptions.active.some((d) => d.id === "sf"), "signal failure started at 30 s");
  run(world, 200);
  assert.ok(world.disruptions.active.some((d) => d.id === "rb"), "replacement buses started at 210 s");
  run(world, 300);
  assert.equal(world.scenarios.running, false, "scenario finished");
  assert.equal(world.demand, 1);
  assert.equal(messages.length, 4);
});

test("control-system feed: a real train standing at a platform is boarded", () => {
  const world = createWorld(LAB, { seed: 2 });
  const feed = new MockFeed(world, { dwell: 30, pause: [1, 2] });
  feed.start();
  let feedArrivals = 0, timetableArrivals = 0;
  world.events.on("vehicle.arrived", (e) => (e.vehicle.source === "feed" ? feedArrivals++ : e.dock.kind === "rail" && timetableArrivals++));
  for (let i = 0; i < 20 * 60; i++) {
    feed.tick(0.05);
    world.step(0.05);
  }
  assert.ok(world.trains.active, "feed active");
  assert.ok(feedArrivals >= 2, `trains from the feed stopped at platforms: ${feedArrivals}`);
  assert.equal(timetableArrivals, 0, "the timetable does not send trains while the feed is active");
  const st = [...world.services.docks.values()].find((s) => s.dock.kind === "rail");
  assert.equal(st.mode, "feed");
  feed.stop();
  assert.equal(world.trains.active, false);
  assert.equal(st.mode, "timetable", "timetable takes over again");
});

test("feed protocol: track + offset and occupancy positions", () => {
  const world = createWorld(LAB);
  world.trains.apply({ type: "hello", protocol: "arail-feed/1", source: "test" });
  world.trains.apply({ type: "trains", trains: [{ id: "ICE 1", track: "G3", offset_mm: 600, speed_mm_s: 0 }] });
  const t = world.trains.trains.get("ICE 1");
  const track = world.getObject("track-g3");
  assert.ok(t.pos, "position from track and offset");
  assert.ok(Math.abs(t.pos[0] - (track.geometry.points[0][0] + 600 * Math.cos(Math.atan2(43.1, 1600)))) < 1);
  for (let i = 0; i < 40; i++) world.step(0.05);
  const st = world.services.docks.get("platform-1:right");
  assert.equal(st.vehicle?.source, "feed", "train on G3 (right track of platform 1) is at the platform");
  assert.equal(st.vehicle.trainId, "ICE 1");
  world.trains.apply({ type: "trains", trains: [{ id: "ICE 1", track: "G3", offset_mm: 900, speed_mm_s: 80 }] });
  for (let i = 0; i < 40; i++) world.step(0.05);
  assert.notEqual(st.vehicle?.phase, "dwelling", "moving train departs");
  // occupancy only
  world.trains.apply({ type: "trains", trains: [{ id: "RB 5", track: "G1" }] });
  for (let i = 0; i < 40; i++) world.step(0.05);
  assert.equal(world.services.docks.get("platform-2:right").vehicle?.trainId, "RB 5");
  assert.throws(() => parseFeedMessage({ type: "trains" }));
  assert.throws(() => parseFeedMessage("{\"trains\": []}"));
});

test("plugins can add object types with their own parameters", () => {
  class Signalbox extends LayoutObject {
    static type = "test-signalbox";
    static params = [{ key: "height_m", label: "Height", type: "number", default: 20 }];
    computeGeometry() {
      return this.spec.position ? { center: this.spec.position } : null;
    }
  }
  const reg = registerBuiltins(new Registry());
  reg.registerObject(Signalbox);
  const world = new World({ registry: reg, layout: LAB });
  const w = world.addObject({ type: "test-signalbox", position: [100, 100] });
  assert.equal(w.id, "test-signalbox-1");
  assert.equal(w.spec.height_m, 20, "defaults from params");
  w.set({ height_m: 30 });
  assert.equal(world.toJSON().objects.at(-1).height_m, 30);
  world.removeObject("test-signalbox-1");
  assert.equal(world.getObject("test-signalbox-1"), null);
  // objects of types this registry does not know (the windmill plugin) are kept verbatim
  assert.deepEqual(world.toJSON().objects.find((o) => o.id === "windmill-1"), LAB.objects.find((o) => o.id === "windmill-1"));
  // unknown types survive a round trip
  const w2 = createWorld({ ...LAB, objects: [...LAB.objects, { id: "x", type: "not-registered", foo: 1 }] });
  assert.deepEqual(w2.toJSON().objects.at(-1), { id: "x", type: "not-registered", foo: 1 });
});
