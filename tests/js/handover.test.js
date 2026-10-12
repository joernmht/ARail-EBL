import assert from "node:assert/strict";
import test from "node:test";

import { createWorld } from "../../web/arail/index.js";

const LAYOUT = {
  objects: [{ id: "p1", type: "platform", from: [0, 0], to: [800, 0], width_mm: 60, sides: "both", lines: "S 1" }],
  simulations: [{ type: "passengers", base_rate: 0 }],
  clock: { start: "10:00", profiles: false },
};

function setup() {
  const world = createWorld(LAYOUT, { seed: 7 });
  const sim = world.simulations.find((s) => s.constructor.type === "passengers");
  const events = [];
  for (const name of ["passenger.boarded", "passenger.exited", "passenger.removed"]) world.events.on(name, (e) => events.push({ name, ...e }));
  return { world, sim, events };
}

function run(world, seconds, dt = 0.1) {
  world.speed = 1;
  for (let t = 0; t < seconds; t += dt) world.step(dt);
}

test("hand-over: an agent waits, boards any train and is reported", () => {
  const { world, sim, events } = setup();
  const agent = { id: "a1", colour: "#0A777F" };
  const p = sim.enter("p1", { agent, at: [10, 0] });
  assert.ok(p, "person created");
  assert.equal(p.agent, agent);
  assert.equal(p.anyDock, true);
  run(world, 400);
  const boarded = events.find((e) => e.name === "passenger.boarded" && e.agent === agent);
  assert.ok(boarded, "boarded");
  assert.ok(boarded.vehicle, "with its vehicle");
  assert.equal(boarded.vehicle.kind, "train");
  assert.ok(!sim.crowds.get("p1").people.includes(p), "gone from the platform");
});

test("hand-over: a line filter keeps an agent off other vehicles", () => {
  const { world, sim, events } = setup();
  const agent = { id: "a2" };
  sim.enter("p1", { agent, dockId: "p1:left", line: "bus-line-9" });
  run(world, 400);
  assert.equal(events.filter((e) => e.name === "passenger.boarded").length, 0, "trains have no lineId 'bus-line-9'");
  const p = sim.crowds.get("p1").people.find((q) => q.agent === agent);
  assert.equal(p.state, "waiting");
  // giving up: the person walks to an exit and is reported there
  assert.equal(sim.release(p), true);
  run(world, 120);
  const exited = events.find((e) => e.name === "passenger.exited" && e.agent === agent);
  assert.ok(exited, "exited");
  assert.equal(exited.pos.length, 2);
});

test("hand-over: agents alight at the doors and leave the platform", () => {
  const { world, sim, events } = setup();
  let done = false;
  world.events.on("vehicle.arrived", (e) => {
    if (done) return;
    done = true;
    const out = sim.alight(e.vehicle, e.dock, [{ id: "x" }, { id: "y" }]);
    assert.equal(out.length, 2);
  });
  run(world, 400);
  assert.ok(done, "a train came");
  const exited = events.filter((e) => e.name === "passenger.exited").map((e) => e.agent.id).sort();
  assert.deepEqual(exited, ["x", "y"]);
});

test("hand-over: clearing reports removed agents; removeAgents is silent", () => {
  const { sim, events } = setup();
  sim.enter("p1", { agent: { id: "r1" } });
  sim.enter("p1", { agent: { id: "r2" } });
  sim.clear();
  assert.deepEqual(events.filter((e) => e.name === "passenger.removed").map((e) => e.agent.id).sort(), ["r1", "r2"]);
  sim.enter("p1", { agent: { id: "r3" } });
  sim.removeAgents();
  assert.equal(events.filter((e) => e.name === "passenger.removed").length, 2);
  assert.equal(sim.crowds.get("p1").people.length, 0);
  assert.equal(sim.enter("nowhere", { agent: {} }), null);
});
