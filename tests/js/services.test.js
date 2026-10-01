import assert from "node:assert/strict";
import test from "node:test";

import { createWorld, PlaneTracker, Registry, registerBuiltins, WebSocketFeed, World } from "../../web/arail/index.js";
import { readJSON } from "./helpers.js";

// the example layout without its plugins and simulations: services only, fast to run
// (and with the clock's day profiles switched off: the timetable runs at its set interval)
const LAB = { ...readJSON("web/layouts/ebl-lab.json"), plugins: [], simulations: [], clock: { profiles: false } };

/** Run the simulation for `seconds` of simulated time. */
function run(world, seconds, dtReal = 0.05) {
  const steps = Math.ceil(seconds / (dtReal * world.speed));
  for (let i = 0; i < steps; i++) world.step(dtReal);
}

function countArrivals(world, filter = () => true) {
  const arrivals = [];
  world.events.on("vehicle.arrived", (e) => filter(e) && arrivals.push({ time: world.time, dock: e.dock.id, delayMin: e.vehicle.delayMin }));
  return arrivals;
}

test("timetable: the headway is the time between arrivals", () => {
  const world = createWorld(LAB, { seed: 4 });
  world.speed = 10;
  const arrivals = countArrivals(world, (e) => e.dock.id === "platform-1:left");
  run(world, 4 * 3600);
  const headway = LAB.services.rail_headway_s ?? 70;
  const mean = (arrivals.at(-1).time - arrivals[0].time) / (arrivals.length - 1);
  assert.ok(Math.abs(mean - headway) < 0.1 * headway, `a train every ${mean.toFixed(1)} s (headway ${headway} s)`);
});

test("timetable: a short hold does not bring later vehicles forward", () => {
  const world = createWorld(LAB, { seed: 4 });
  const st = world.services.docks.get("platform-1:left");
  st.timer = 300;
  const arrivals = countArrivals(world, (e) => e.dock.id === "platform-1:left");
  world.disruptions.start({ type: "delay", target: "platform-1", duration: 10 });
  run(world, 250);
  assert.equal(arrivals.length, 0, "the next train is due at 300 s");
  run(world, 70);
  assert.equal(arrivals.length, 1);
  assert.ok(arrivals[0].time > 300, `arrived at ${arrivals[0].time.toFixed(0)} s`);
  assert.equal(arrivals[0].delayMin, 0, "not delayed");
});

test("timetable: a due vehicle waits during a hold and arrives late", () => {
  const world = createWorld(LAB, { seed: 4 });
  const st = world.services.docks.get("platform-1:left");
  st.timer = 20;
  const arrivals = countArrivals(world, (e) => e.dock.id === "platform-1:left");
  world.disruptions.start({ type: "delay", target: "platform-1", duration: 120 });
  run(world, 110);
  assert.equal(arrivals.length, 0);
  run(world, 30);
  assert.equal(arrivals.length, 1);
  assert.ok(Math.abs(arrivals[0].delayMin - 100 / 60) < 0.1, `${arrivals[0].delayMin.toFixed(2)} min late`);
});

test("disruptions: frequency 0 stops all vehicles", () => {
  const reg = registerBuiltins(new Registry());
  reg.registerDisruption({ type: "no-service", targets: "any", effects: () => ({ frequency: 0 }) });
  const world = new World({ registry: reg, layout: LAB, seed: 4 });
  world.disruptions.start({ type: "no-service" });
  // the buses of the bus lines that were already on their way when the layout was opened finish
  // their round; no new ones depart
  const arrivals = countArrivals(world, (e) => e.vehicle.source !== "line");
  let lineDepartures = 0;
  world.events.on("vehicle.departing", (e) => e.vehicle.source === "line" && e.dock.id.startsWith("bus-terminal-1") && lineDepartures++);
  run(world, 600);
  assert.equal(arrivals.length, 0);
  assert.equal(lineDepartures, 0, "no bus line departs from the bus station");
});

test("simulations of missing plugins are kept when saving", () => {
  const sims = [{ type: "passengers" }, { type: "not-installed", foo: 1 }];
  const world = createWorld({ ...LAB, simulations: sims });
  assert.equal(world.simulations.length, 1);
  assert.deepEqual(
    world.toJSON().simulations.map((s) => s.type),
    ["passengers", "not-installed"],
  );
  assert.deepEqual(world.toJSON().simulations[1], { type: "not-installed", foo: 1 });
});

test("loading a layout resets demand and keeps the marker map object", () => {
  const world = createWorld(readJSON("web/layouts/ebl-lab.json"));
  const map = world.map;
  const tracker = new PlaneTracker(map);
  tracker.acc.set(3, { n: 5 });
  world.scenarios.play("signal-failure");
  assert.equal(world.demand, 1.5);
  world.load(readJSON("web/layouts/synthetic-demo.json"));
  assert.equal(world.demand, 1);
  assert.equal(world.map, map, "trackers built on world.map keep working");
  assert.equal(map.ids().length, 0, "the synthetic example has no known marker poses");
  tracker.update({}, 0, null);
  assert.equal(tracker.acc.size, 0, "the tracker starts its survey afresh");
});

test("docks follow the marker survey without a passenger simulation", () => {
  const world = createWorld({ ...LAB, markers: { ...LAB.markers, poses: {} } });
  assert.equal(world.services.docks.size, 1, "no marker known yet: only the bus bay of the timetable (placed by coordinates; the other bays belong to the bus lines)");
  for (const [id, p] of Object.entries(LAB.markers.poses)) world.map.set(Number(id), { x: p[0], y: p[1], theta: (p[2] * Math.PI) / 180 });
  const arrivals = countArrivals(world, (e) => e.dock.kind === "rail");
  run(world, 300);
  assert.equal(world.services.docks.size, 5);
  assert.ok(arrivals.length > 4, `${arrivals.length} trains arrived`);
});

test("feed: speed is estimated for fast position-only feeds; quiet trains stand", () => {
  const world = createWorld(LAB);
  const send = (x) => world.trains.apply({ type: "train", train: { id: "T", x_mm: x, y_mm: 500 } });
  for (let i = 0; i <= 120; i++) {
    send(i * (100 / 60)); // 100 mm/s at 60 messages per second
    world.step(1 / 60);
  }
  const t = world.trains.trains.get("T");
  assert.ok(Math.abs(world.trains._speed(t) - 100) < 10, `speed ${world.trains._speed(t)} mm/s`);
  for (let i = 0; i < 4 * 60; i++) world.step(1 / 60);
  assert.equal(world.trains._speed(t), 0, "no news for 3 s: standing");
});

test("feed: a train on a track that lost its position is still drawn", () => {
  const world = createWorld(LAB);
  world.addObject({ type: "track", track_id: "M", points: [{ marker: 0, offset: [0, 20] }, { marker: 1, offset: [0, 20] }] });
  world.trains.apply({ type: "trains", trains: [{ id: "ICE 1", track: "M", offset_mm: 300, speed_mm_s: 0 }] });
  assert.ok(world.trains.trains.get("ICE 1").path, "placed on the marker-anchored track");
  world.map.clear(true); // "Measure again": the track has no geometry until markers are seen
  const drawn = [];
  const view = { m: (x) => x, ribbon: () => drawn.push("ribbon"), polygon: () => drawn.push("polygon"), label: () => drawn.push("label") };
  assert.doesNotThrow(() => world.trains.draw(view));
  assert.ok(drawn.includes("label"));
});

test("feed: disruption durations are converted to numbers", () => {
  const world = createWorld(LAB);
  world.trains.apply({ type: "disruption", action: "start", disruption: "delay", target: "platform-1", duration_s: "300", id: "d1" });
  world.trains.apply({ type: "disruption", action: "start", disruption: "delay", target: "platform-2", duration_s: null, id: "d2" });
  world.trains.apply({ type: "disruption", action: "start", disruption: "delay", target: "platform-2", duration_s: "soon", id: "d3" });
  const [d1, d2, d3] = world.disruptions.active;
  assert.equal(d1.until, world.time + 300);
  assert.equal(d2.until, null, "null: until stopped");
  assert.equal(d3.until, world.time + 8 * 60, "invalid: the type's default");
  run(world, 10);
  assert.equal(world.disruptions.active.length, 3);
});

test("feed: a train leaving when the feed stops departs once", () => {
  const world = createWorld(LAB);
  world.trains.apply({ type: "trains", trains: [{ id: "RB 5", track: "G1" }] });
  for (let i = 0; i < 40; i++) world.step(0.05);
  let departing = 0;
  world.events.on("vehicle.departing", () => departing++);
  world.trains.reset();
  assert.equal(departing, 1);
});

test("websocket feed: a new connection replaces the old socket", async () => {
  const sockets = [];
  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.open = true;
      sockets.push(this);
    }
    send() {}
    close() {
      this.open = false;
      setTimeout(() => this.onclose?.(), 0);
    }
  }
  const world = createWorld(LAB);
  const feed = new WebSocketFeed(world, { url: "ws://test", WebSocketImpl: FakeSocket });
  feed.connect();
  sockets[0].onopen();
  feed.connect();
  assert.equal(sockets[0].open, false, "the first socket is closed");
  sockets[0].onmessage({ data: JSON.stringify({ type: "train", train: { id: "old", x_mm: 0, y_mm: 0 } }) });
  assert.equal(world.trains.trains.size, 0, "messages of the old socket are ignored");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(feed.ws, sockets[1], "the old socket's close event does not disturb the new one");
  feed.close();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(sockets.length, 2, "no reconnect after close()");
  assert.ok(sockets.every((s) => !s.open));
  assert.equal(feed.status, "idle");
});
