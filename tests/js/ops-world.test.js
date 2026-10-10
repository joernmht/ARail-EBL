// Rail operations in the world (web/arail/ops/simulation.js, depot.js, disruptions.js): the example
// layout, the platforms run by the operations (mode "plan"), its trains at the platforms with their
// labels, the boards, crews walking to the depot, the depot drawing, the disruptions of the
// operations and of the platforms, the clock, saving, and another layout loaded.
import assert from "node:assert/strict";
import test from "node:test";

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  CREW_COLOURS, Camera, Depot, composeLayout, hiddenAt, OPS_DISRUPTIONS, View, createWorld, layoutPlugins, loadPlugins, opsOf, parseColor, polylineAt, registry, statusLines, validateLayout, withLayers,
} from "../../web/arail/index.js";
import { readJSON, ROOT } from "./helpers.js";

const DAY = 1440;

const LAB = readJSON("web/layouts/ebl-lab.json");
// the lab example with its layer "Rail operations" on
const OPS = withLayers(LAB, ["operations"]);
const pluginErrors = await loadPlugins(layoutPlugins(OPS), pathToFileURL(join(ROOT, "web/layouts/ebl-lab.json")).href);

/** Step the world by `n` frames of `dt` seconds (real time). */
function frames(world, n, dt = 0.1, each = null) {
  for (let i = 0; i < n; i++) {
    world.step(dt);
    each?.(i);
  }
}

/** Frames (of 0.1 s) for `minutes` on the world's clock at its speed. */
const framesFor = (world, minutes) => Math.ceil((minutes * 60) / (world.clock.factor * world.speed * 0.1));

/** A canvas context that records what is drawn (as in design.test.js). */
function recordingContext(width = 1280, height = 720) {
  const log = [], state = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key === "canvas") return { width, height };
      if (key === "measureText") return (s) => ({ width: 7 * String(s).length });
      if (/^create\w*Gradient$/.test(key)) return () => ({ addColorStop() {} });
      if (key in target) return target[key];
      return (...args) => log.push({ call: key, args });
    },
    set(target, key, value) {
      target[key] = value;
      log.push({ set: key, value });
      return true;
    },
  });
  return { ctx, log };
}

/** A view looking straight down at a layout point (mm) from 1.5 m. */
function topView(ctx, [x, y]) {
  const camera = new Camera(1280, 720);
  const { fx, cx, cy } = camera.intrinsics, d = 1500;
  return new View({ ctx, camera, H: [fx, 0, cx * d - fx * x, 0, -fx, cy * d + fx * y, 0, 0, d], scale: 87 });
}

test("the operations example is valid and loads; the platforms of its station are run by the operations", () => {
  assert.deepEqual(pluginErrors, []);
  assert.deepEqual(validateLayout(OPS, registry), []);
  const world = createWorld(OPS);
  const sim = opsOf(world);
  assert.ok(sim, "an operations simulation");
  assert.equal(world.services.planner, sim);
  assert.equal(sim.name, "EBL regional network");
  // the depot: a building with a door on the street network (where the crews sign on)
  const depot = world.getObject("depot-1");
  assert.ok(depot instanceof Depot);
  assert.ok(depot.geometry, "placed on the marker map");
  assert.ok(depot.entrances().length >= 1);
  assert.notEqual(world.network().place("building:depot-1:0"), null, "the depot's door is on the network");
  // the tracks of the station's platforms are in mode "plan", the bus bay keeps the timetable
  const modes = Object.fromEntries([...world.services.docks.values()].map((st) => [st.dock.id, st.mode]));
  for (const [id, mode] of Object.entries(modes)) assert.equal(mode, id.startsWith("platform-") ? "plan" : "timetable", id);
  frames(world, 2);
  const e = sim.engine;
  assert.ok(e, "the engine runs");
  assert.deepEqual([...e.lines.values()].map((l) => l.name).sort(), ["RB 33", "RE 1", "S 2", "S 8"]);
  assert.deepEqual([...e.stations.values()].filter((s) => s.on_layout).map((s) => s.id), ["hbf"]);
  assert.equal(world.clock.label(), "07:00");
  assert.ok(Math.abs((e.now % DAY) - 7 * 60) < 1, `the engine is at the clock's time (${e.timeText(e.now)})`);
});

test("its trains stand at the platforms with their units and driver; the boards show its departures", () => {
  const world = createWorld(OPS);
  const sim = opsOf(world);
  world.setTime("06:00");
  frames(world, 2);
  const departed = [];
  world.events.on("ops.trip.departed", (p) => departed.push(p.trip));
  let visits = 0, foreign = 0;
  const labels = new Set();
  frames(world, framesFor(world, 60), 0.1, () => {
    visits = Math.max(visits, sim.visits.size);
    for (const st of world.services.docks.values()) {
      if (st.mode !== "plan" || !st.vehicle) continue;
      if (!st.vehicle.ops) foreign++;
      if (st.vehicle.phase === "dwelling") labels.add(JSON.stringify([st.vehicle.line, st.vehicle.info]));
    }
  });
  assert.equal(foreign, 0, "the timetable sends no trains to the platforms of the operations");
  assert.ok(visits >= 2, `trains at the platforms (${visits} at most)`);
  assert.ok(departed.length >= 5, `${departed.length} trains departed from the station`);
  const all = [...labels].map((l) => JSON.parse(l));
  assert.ok(all.length >= 3);
  for (const [line, info] of all) {
    assert.match(line, /^(RE 1|RB 33|S 2|S 8) (→ \w+ \d\d:\d\d|from \w+)$/, line);
    assert.match(info[0], /^442 \d{3}( \+ 442 \d{3})*( · \p{Lu}\. (von |van |de )?[\p{L}-]+)?$/u, info[0]);
  }
  // the boards: the train at the platform, else the next departures of the operations
  for (const id of ["platform-1", "platform-2"]) {
    const area = world.stopAreas().find((a) => a.id === id);
    const lines = statusLines(world, area);
    assert.ok(lines.length >= 1, id);
    assert.ok(lines.every((l) => /^(RE 1|RB 33|S 2|S 8) /.test(l) || l === "No more trains today"), `${id}: ${lines.join(" | ")}`);
  }
});

test("crews who live in the town walk to the depot and sign on there", () => {
  const world = createWorld(OPS);
  const sim = opsOf(world);
  world.setTime("07:20");
  frames(world, 2);
  const signOns = [];
  world.events.on("ops.crew.signon", (p) => signOns.push(p.person));
  let walkers = 0, drawn = null;
  frames(world, framesFor(world, 45), 0.1, () => {
    walkers = Math.max(walkers, sim.walkers.length);
    // draw the walkers once one is in sight (not in the underpass): people in yellow vests
    const w = drawn ? null : sim.walkers.find((x) => !hiddenAt(x.path, x.s));
    if (w) {
      const { ctx, log } = recordingContext();
      const view = topView(ctx, polylineAt(w.path.points, w.s, w.path.lengths).point);
      sim.draw(view);
      view.render();
      drawn = log;
    }
  });
  assert.ok(walkers >= 1, "somebody walks to work");
  assert.ok(signOns.length >= 1, "and signs on");
  // in a yellow high-visibility vest
  const vest = parseColor(CREW_COLOURS.body);
  const fills = drawn.filter((x) => x.set === "fillStyle" && typeof x.value === "string").map((x) => parseColor(x.value));
  assert.ok(fills.some((c) => c && c.slice(0, 3).every((v, i) => Math.abs(v - vest[i]) <= 2)), "the vest is drawn");
});

test("the depot shows the units in its workshop and on its stabling tracks, and a board", () => {
  const world = createWorld(OPS);
  const sim = opsOf(world);
  world.setTime("01:30"); // at night most units are in the depot
  frames(world, 2);
  const depot = world.getObject("depot-1");
  const state = sim.depotState(depot);
  assert.ok(state);
  assert.equal(state.lines.length, 2);
  assert.match(state.lines[0], /^Workshop \d\/2 busy/);
  assert.match(state.lines[1], /^\d+ units? ready · \d+ crew on duty$/);
  const shown = state.bays.length + state.stabled.flat().length;
  assert.ok(shown >= 2, `${shown} units shown`);
  assert.ok(state.stabled.every((track) => track.length <= 2), "two units per stabling track");
  const { ctx, log } = recordingContext();
  const view = topView(ctx, depot.spec.position);
  depot.draw(view);
  view.render();
  const texts = log.filter((x) => x.call === "fillText").map((x) => String(x.args[0]));
  assert.ok(texts.some((t) => t.startsWith("Workshop")), `the board: ${texts.slice(0, 6).join(" | ")}`);
  assert.ok(log.filter((x) => x.call === "fill").length > 20, "the hall, the tracks and the units");
});

test("the disruptions of the operations act on its engine and are only offered with rail operations", () => {
  for (const def of OPS_DISRUPTIONS) {
    assert.equal(registry.disruptions.get(def.type), def, def.type);
    assert.equal(def.requires, "operations");
    assert.equal(def.targets, "none");
  }
  const world = createWorld(OPS);
  const sim = opsOf(world);
  frames(world, 2);
  const d = world.disruptions.start({ type: "crew-sick", params: { count: 2, notice_min: 30 } });
  assert.match(d.result, /^2 sick calls?$/);
  assert.ok(sim.engine.logs.some((l) => /called in sick/.test(l.text)));
  const closed = world.disruptions.start({ type: "workshop-closed", params: { hours: 6 } });
  assert.equal(closed.result, "workshop closed");
  assert.ok(sim.engine.logs.some((l) => /^Workshop closed until/.test(l.text)));
  const fail = world.disruptions.start({ type: "unit-failure", params: { kind: "hard" } });
  assert.match(fail.result, /^(442 \d{3} failed|no train running)$/);
  // the disruptions do not change the stops
  const area = world.stopAreas().find((a) => a.id === "platform-1");
  assert.deepEqual(world.disruptions.effectsFor(area).messages ?? [], []);
  // without rail operations nothing happens
  const lab = createWorld(LAB);
  const none = lab.disruptions.start({ type: "crew-sick" });
  assert.equal(none.result, "no rail operations on this layout");
});

test("a closed platform cancels the trains of the operations; the transport authority does not fine them", () => {
  const world = createWorld(OPS);
  const sim = opsOf(world);
  frames(world, 2);
  for (const id of ["platform-1", "platform-2"]) world.disruptions.start({ type: "closure", target: id, params: { minutes: 60 } });
  const cancelled = [];
  world.events.on("ops.trip.cancelled", (p) => cancelled.push(p));
  frames(world, framesFor(world, 30));
  assert.ok(cancelled.length >= 1, "trains cancelled");
  assert.ok(cancelled.some((c) => c.cause === "infrastructure"), cancelled.map((c) => c.cause).join(", "));
  const fined = sim.engine.ledger.entries.filter((x) => x.cause === "infrastructure" && x.contract === "transport");
  assert.deepEqual(fined, [], "infrastructure is exempt in the transport contract");
});

test("setting the clock moves the operations to that time; the layout keeps only its settings", () => {
  const world = createWorld(OPS);
  const sim = opsOf(world);
  frames(world, 2);
  const day0 = Math.floor(sim.engine.now / DAY);
  world.setTime("12:00");
  frames(world, 1);
  assert.equal(Math.floor(sim.engine.now / DAY), day0);
  assert.ok(Math.abs((sim.engine.now % DAY) - 720) < 2, sim.engine.timeText(sim.engine.now));
  // back to the morning: the operations go on to the next morning (they never run backwards)
  world.setTime("06:00");
  frames(world, 1);
  assert.equal(Math.floor(sim.engine.now / DAY), day0 + 1);
  assert.ok(Math.abs((sim.engine.now % DAY) - 360) < 2, sim.engine.timeText(sim.engine.now));
  // saved: the settings as written, no runtime state
  const saved = world.toJSON().simulations.find((s) => s.type === "operations");
  assert.deepEqual(saved, OPS.simulations.find((s) => s.type === "operations"));
});

test("another layout loaded hands the platforms back to the timetable", () => {
  const world = createWorld(OPS);
  frames(world, 2);
  world.load(LAB);
  assert.equal(opsOf(world), null);
  assert.equal(world.services.planner, null);
  frames(world, 2);
  for (const st of world.services.docks.values()) assert.equal(st.mode, "timetable", st.dock.id);
});

test("only the operations send trains to its platforms: a manual call goes nowhere", () => {
  const world = createWorld(OPS);
  frames(world, 2);
  for (const st of world.services.docks.values()) if (st.mode === "plan") st.vehicle = null;
  assert.equal(world.services.call("platform-1"), null, "no manual train at a platform of the operations");
  assert.equal(world.services.call("platform-1:left"), null);
  const v = world.services.call("platform-1:left", { source: "plan", line: "RE 1" });
  assert.ok(v, "the operations call their trains");
  assert.equal(v.source, "plan");
  // the bus bay keeps taking manual calls
  assert.ok(world.services.call("bus-terminal-1"));
});

test("one operations simulation per layout: a second entry is reported and stays idle", () => {
  const twice = composeLayout(OPS).layout;
  twice.simulations.push({ type: "operations", name: "Second" });
  const problems = validateLayout(twice, registry);
  assert.deepEqual(problems, [`simulations[${twice.simulations.length - 1}] (operations): only one rail operations entry per layout (the first one runs)`]);
  const world = createWorld(twice);
  const [first, second] = world.simulations.filter((s) => s.constructor.type === "operations");
  assert.equal(world.services.planner, first);
  assert.equal(opsOf(world), first);
  frames(world, 2);
  assert.ok(first.engine && !second.engine, "only the first one runs");
});
