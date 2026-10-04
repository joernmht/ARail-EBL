// The infrastructure simulation in the world (web/arail/infra/simulation.js, objects.js, disruptions.js):
// the example layout, the assets on the layout (its objects, tracks and platforms), the engine on the
// world's clock, faults at the station holding its trains (also those of rail operations), the vans'
// routes over the streets, drawing the state, saving and restoring a game, adding it to a layout.
import assert from "node:assert/strict";
import test from "node:test";

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  Camera, INFRA_OBJECTS, View, composeLayout, createWorld, infraOf, layoutPlugins, loadPlugins, opsOf, registry, validateLayout, withLayers,
} from "../../web/arail/index.js";
import { readJSON, ROOT } from "./helpers.js";

const DAY = 1440;
const LAB = readJSON("web/layouts/ebl-lab.json");
// the lab example with its layer "Infrastructure" on
const INFRA = withLayers(LAB, ["infrastructure"]);
await loadPlugins(layoutPlugins(INFRA), pathToFileURL(join(ROOT, "web/layouts/ebl-lab.json")).href);

const frames = (world, n, dt = 0.1) => {
  for (let i = 0; i < n; i++) world.step(dt);
};

/** A canvas context that records what is drawn. */
function recordingContext(width = 1280, height = 720) {
  const log = [];
  const ctx = new Proxy({}, {
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

/** A virtual view looking straight down at a layout point (mm) from `d` mm. */
function topView(ctx, [x, y], d = 2500) {
  const camera = new Camera(1280, 720);
  const { fx, cx, cy } = camera.intrinsics;
  return new View({ ctx, camera, H: [fx, 0, cx * d - fx * x, 0, -fx, cy * d + fx * y, 0, 0, d], scale: 87, virtual: true });
}

test("the infrastructure example is valid; its objects, tracks and platforms are assets of the station Bahnhof", () => {
  assert.deepEqual(validateLayout(INFRA), []);
  for (const cls of INFRA_OBJECTS) assert.ok(registry.objects.get(cls.type) === cls, cls.type);
  const world = createWorld(INFRA);
  const sim = infraOf(world);
  assert.ok(sim?.active);
  world.step(0.1);
  const e = sim.engine;
  const onLayout = [...e.assets.values()].filter((a) => a.on_layout);
  const ids = new Set(onLayout.map((a) => a.id));
  for (const id of ["signal-n1", "signal-n2", "signal-n3", "switch-w1", "balise-1", "crossing-1", "gsmr-1", "interlocking-bf", "track-g1", "track-g3", "platform-1", "lift-1", "display-1", "catenary-w2", "cable-w"]) {
    assert.ok(ids.has(id), `${id} is an asset`);
  }
  // linear referencing: the station's assets lie around km 21.0–21.3 of line 6250
  for (const a of onLayout) assert.ok(a.line === "6250" && a.km > 20.9 && a.km < 21.3, `${a.id} at km ${a.km}`);
  // the signals on the layout belong to its relay interlocking (which replaces the generated one): faults on its panel, no condition data
  const n2 = e.assets.get("signal-n2");
  assert.equal(n2.interlocking, "interlocking-bf");
  assert.equal(e.assets.get("interlocking-bf").generation, "relay");
  assert.equal(n2.reportPath(e.assets), "panel");
  assert.equal(n2.liveShare(e.assets), 0);
  assert.ok(![...e.assets.values()].some((a) => a.type === "interlocking" && a.station === "bahnhof" && a.id !== "interlocking-bf"));
  // the engine follows the world's clock (07:00 on 1 January of the start year)
  assert.equal(Math.round(e.now), 420);
  frames(world, 300); // 60 s at 2× and 1:12: 12 clock minutes
  assert.ok(Math.abs(e.now - 432) < 1.5, `engine at ${e.now}`);
});

test("a fault at the station: reported on the relay panel, trains held or at caution, a van drives out over the streets", () => {
  const world = createWorld(INFRA);
  const sim = infraOf(world);
  world.step(0.1);
  const e = sim.engine;
  // the vans' routes from the maintenance base over the streets
  const toCrossing = sim._travelMinutes(e.assets.get("crossing-1"));
  assert.ok(toCrossing > 0.5 && toCrossing < 15, `${toCrossing} min to the level crossing`);
  assert.ok(Number.isFinite(sim._travelMinutes(e.assets.get("signal-n2"))));
  assert.match(sim.failAsset("signal-n2"), /Exit signal N2 fails/);
  assert.match(sim.failAsset("no such thing"), /no asset/);
  frames(world, 200); // eight clock minutes: the panel shows it
  const f = e.assets.get("signal-n2").fault;
  assert.ok(f && f.knownAt <= e.now);
  const d = world.disruptions.active.find((x) => x.type === "infra-fault");
  assert.ok(d, "an infra-fault disruption at the station");
  assert.equal(d.params.hold, false);
  const area = world.stopAreas().find((a) => a.kind === "rail");
  assert.ok(world.disruptions.effectsFor(area).messages.some((m) => m.startsWith("Exit signal N2")));
  // somebody is on the way, or already there
  const busy = e.people.filter((p) => ["driving", "repairing", "alerted"].includes(e.activity(p).state));
  assert.ok(busy.length >= 1);
  // the repair ends the disruption
  sim.runTo(e.now + 12 * 60, { pause: false });
  assert.equal(e.assets.get("signal-n2").fault, null);
  assert.ok(!world.disruptions.active.some((x) => x.type === "infra-fault"));
  // the interlocking's fault holds every train of the station
  e.act("fail", "interlocking-bf");
  sim.runTo(e.now + 10, { pause: false });
  assert.ok(world.disruptions.active.some((x) => x.type === "infra-fault" && x.params.hold));
});

test("the disruptions of the infrastructure: offered only with it, they act on the engine", () => {
  const world = createWorld(INFRA);
  const sim = infraOf(world);
  world.step(0.1);
  const types = [...registry.disruptions.values()].filter((d) => d.requires === "infrastructure").map((d) => d.type);
  assert.deepEqual(types.sort(), ["asset-fault", "cable-theft", "storm"]);
  assert.equal(registry.disruptions.get("infra-fault").hidden, true);
  const d = world.disruptions.start({ type: "asset-fault", params: { asset: "crossing-1" } });
  assert.match(d.result, /Level crossing/);
  assert.ok(sim.engine.assets.get("crossing-1").fault);
  const storm = world.disruptions.start({ type: "storm", params: { count: 3 } });
  assert.match(storm.result, /Storm/);
  // the layout's scenario starts asset faults
  assert.ok(world.scenarios.scenarios.some((s) => s.id === "infra-faults"));
});

test("drawing: the assets show their state, faults pulse, vans and drones; nothing fails by night", () => {
  const world = createWorld(INFRA);
  const sim = infraOf(world);
  world.step(0.1);
  sim.failAsset("crossing-1");
  frames(world, 200);
  for (const [at, name] of [[[-700, -60], "line module"], [[800, 100], "station"], [[-930, -300], "base"], [[1800, -2010], "plant"]]) {
    const { ctx, log } = recordingContext();
    const view = topView(ctx, at);
    world.draw(view);
    assert.ok(log.length > 100, `${name}: ${log.length} drawing calls`);
  }
  // the colours: the state ring of a signal is in the colour of its known grade
  const st = sim.assetView("signal-n2");
  assert.ok(st && /^rgba\(/.test(st.colour) && ["fresh", "stale", "age"].includes(st.style));
  sim.display.mode = "off";
  assert.equal(sim.assetView("signal-n2"), null);
  sim.display.mode = "checked";
  assert.ok(sim.assetView("signal-n2"));
  sim.display.mode = "known";
  sim.selected = "signal-n2";
  assert.ok(sim.assetView("signal-n2").label?.[0] === "Exit signal N2");
  world.setTime("23:30");
  const { ctx } = recordingContext();
  world.draw(topView(ctx, [800, 100]));
});

test("running fast: to the next decision of a student role, to the year's end; the clock shows the engine's time", () => {
  const world = createWorld(INFRA);
  const sim = infraOf(world);
  world.step(0.1);
  const e = sim.engine;
  e.act("propose", "renew", ["switch-w1"]);
  const proposal = e.open("asset-manager")[0];
  const item = sim.runTo(e.now + 200 * DAY, { pause: true });
  // it stops at a new decision, or a minute before the asset manager's time is up
  assert.ok(item);
  assert.ok(e.now < proposal.deadline);
  assert.equal(proposal.decided, null);
  sim.runYear({ pause: false });
  assert.equal(e.years.length, 1);
  assert.ok(Math.abs((e.now % DAY) - world.clock.minutes) < 1, "the clock shows the engine's time of day");
  const before = e.now;
  frames(world, 50);
  assert.ok(e.now > before, "and runs on with the clock");
  // setting the clock back does not run the engine backwards
  world.setTime("05:00");
  frames(world, 5);
  assert.ok(e.now >= before);
});

test("a game is saved as its actions and restored; editing the layout keeps the game", () => {
  const world = createWorld(INFRA);
  const sim = infraOf(world);
  world.step(0.1);
  const e = sim.engine;
  e.act("plan", "catenary", "drone", 3);
  e.act("propose", "repair", ["signal-n1"]);
  sim.runTo(e.now + 90 * DAY, { pause: false });
  const saved = JSON.parse(JSON.stringify(sim.save()));
  assert.equal(saved.format, "arail-infra-game/1");
  assert.ok(saved.actions.length >= 2);
  const world2 = createWorld(INFRA);
  const sim2 = infraOf(world2);
  world2.step(0.1);
  assert.ok(sim2.load(saved));
  assert.equal(Math.round(sim2.engine.now), Math.round(saved.now));
  assert.deepEqual(sim2.engine.plans.catenary, { method: "drone", per_year: 3 });
  assert.equal(sim2.engine.logs.length, e.logs.length);
  // changing an asset on the layout rebuilds the engine with the game's actions
  world.getObject("signal-a").set({ built: 2020 });
  world.step(0.1);
  assert.notEqual(sim.engine, e);
  assert.equal(sim.engine.actions.length, saved.actions.length);
  assert.ok(sim.engine.now >= saved.now);
  assert.equal(sim.load({ format: "something else" }), false);
  // a new game
  const fresh = sim.newGame({ scenario: "storm" });
  assert.equal(fresh.actions.length, 0);
  assert.equal(fresh.scenario, "storm");
});

test("added to a layout without infrastructure objects: the platforms and tracks become assets", () => {
  const json = structuredClone(LAB);
  json.simulations.push({ type: "infrastructure" });
  assert.deepEqual(validateLayout(json), []);
  const world = createWorld(json);
  world.step(0.1);
  const e = infraOf(world).engine;
  const onLayout = [...e.assets.values()].filter((a) => a.on_layout).map((a) => a.type).sort();
  assert.deepEqual([...new Set(onLayout)], ["platform", "track"]);
  // the station keeps its generated interlocking
  assert.ok([...e.assets.values()].some((a) => a.type === "interlocking" && a.station === "bahnhof"));
  frames(world, 100);
  // the JSON keeps the settings only
  assert.deepEqual(world.toJSON().simulations.at(-1), { type: "infrastructure" });
});

test("with rail operations on the same layout: faults at the station's platforms hold the operations' trains", () => {
  // the lab example with rail operations, plus an infrastructure entry with the default settings
  const json = composeLayout(withLayers(LAB, ["operations"])).layout;
  json.simulations.push({ type: "infrastructure" });
  const world = createWorld(json);
  world.step(0.1);
  const sim = infraOf(world), ops = opsOf(world);
  assert.ok(sim.engine && ops);
  const il = [...sim.engine.assets.values()].find((a) => a.type === "interlocking" && a.station === "bahnhof");
  // the generated interlocking is not on the layout: its faults do not touch the platforms
  sim.engine.act("fail", il.id);
  sim.runTo(sim.engine.now + 10, { pause: false });
  assert.ok(!world.disruptions.active.some((d) => d.type === "infra-fault"));
  // a track of the layout is: a speed restriction at its platform
  sim.engine.act("fail", "track-g2");
  sim.runTo(sim.engine.now + 120, { pause: false });
  const d = world.disruptions.active.find((x) => x.type === "infra-fault");
  if (d) assert.equal(d.target, "platform-1");
  // a hold at the station reaches the operations' trains
  world.disruptions.start({ type: "infra-fault", target: "*", params: { hold: true, text: "test" } });
  assert.equal(ops._stationFx("hbf").hold, true);
});
