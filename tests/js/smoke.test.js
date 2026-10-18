// Smoke tests: every example layout runs through the morning rush hour (05:30-09:30) without errors.
// Trains and buses come, passengers wait, board and get off, the town's people get to work and to
// the train, the container terminal finishes moves of its shift, and nothing turns into NaN.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createWorld, terminalOf } from "../../web/arail/index.js";
import { ROOT, readJSON } from "./helpers.js";

const LAYOUTS = readdirSync(join(ROOT, "web/layouts")).filter((f) => f.endsWith(".json")).sort();

const finite = (p) => Array.isArray(p) && p.every(Number.isFinite);

/** Everything that moves has a finite position. */
function assertFinite(world, label) {
  const pax = world.simulations.find((s) => s.constructor.type === "passengers");
  for (const c of pax?.crowds?.values() || []) for (const p of c.people) assert.ok(finite(p.pos), `${label}: a passenger at ${c.area.id} is at ${p.pos}`);
  for (const t of world.simulations.filter((s) => s.constructor.type === "town")) {
    for (const a of t.agents) if (a.pos != null) assert.ok(finite(a.pos), `${label}: ${a.id} is at ${a.pos}`);
  }
  for (const b of world.transit.buses) assert.ok(Number.isFinite(b.s ?? 0), `${label}: ${b.id} at s = ${b.s}`);
}

for (const file of LAYOUTS) {
  test(`smoke: ${file} runs through the morning`, () => {
    const world = createWorld(readJSON(`web/layouts/${file}`), { seed: 7 });
    const count = new Map();
    const on = (name, key = name, when = () => true) => world.events.on(name, (e) => when(e) && count.set(key, (count.get(key) || 0) + 1));
    on("vehicle.arrived", "rail", (e) => e.dock?.kind === "rail");
    on("vehicle.arrived", "bus", (e) => e.dock?.kind !== "rail");
    on("passenger.boarded");
    on("passenger.exited");
    on("terminal.move.finished");
    const pax = world.simulations.find((s) => s.constructor.type === "passengers");
    const town = world.simulations.find((s) => s.constructor.type === "town");
    const term = terminalOf(world);
    const shift = (world.layout.scenarios || []).find((s) => /shift/.test(s.id));

    world.step(0.1);
    world.setTime("05:30");
    if (term && shift) world.scenarios.play(shift.id);
    let waiting = 0, alighting = 0, atWork = 0, i = 0, fallback = false;
    while (world.clock.minutes < 9.5 * 60 && i++ < 1e5) {
      world.step(0.1);
      // a shift that works the model wagons needs the camera: without moves by 07:00 a train of the
      // terminal comes in and is unloaded to the yard
      if (term && !fallback && world.clock.minutes >= 7 * 60 && !count.get("terminal.move.finished")) {
        fallback = true;
        const visit = [...term.visits.keys()][0];
        term.call(visit);
        term.unload(visit);
      }
      if (i % 200) continue;
      for (const a of world.stopAreas()) {
        const s = pax?.stats(a.id);
        if (!s) continue;
        waiting = Math.max(waiting, s.count);
        alighting += s.outPerMin;
      }
      if (town) atWork = Math.max(atWork, town.townStats().work);
      assertFinite(world, `${file} at ${world.clock.label()}`);
    }
    assert.ok(world.clock.minutes >= 9.5 * 60, `${file}: the clock got to 09:30 (${world.clock.label()})`);

    const rail = world.stopAreas().some((a) => a.kind === "rail" && a.docks.some((d) => !d.managed));
    if (rail) assert.ok(count.get("rail") > 0, `${file}: trains came to the platforms`);
    if (world.transit.lines.size) assert.ok(count.get("bus") > 0 || world.transit.buses.length > 0, `${file}: buses or trams ran`);
    if (pax && world.stopAreas().length) {
      assert.ok(waiting > 0, `${file}: people waited at the stops`);
      assert.ok(alighting > 0, `${file}: people got off`);
    }
    if (town?.agents.length) {
      assert.ok(atWork > 0, `${file}: the town's people got to work`);
      if (rail) assert.ok(count.get("passenger.boarded") > 0 && count.get("passenger.exited") > 0, `${file}: the town's people boarded and got off: ${JSON.stringify([...count])}`);
      // nobody counted twice: the people inside are the occupancy of the buildings
      const inside = town.agents.filter((a) => a.state === "inside").length * town._personWeight();
      const occupancy = [...world.occupancy.values()].reduce((s, v) => s + v, 0);
      assert.ok(Math.abs(inside - occupancy) < 1e-6, `${file}: occupancy ${occupancy} vs ${inside} inside`);
    }
    if (term) {
      assert.ok(count.get("terminal.move.finished") > 0, `${file}: the terminal finished moves`);
      assert.deepEqual(term.inventory.check(), [], `${file}: the terminal's inventory is consistent`);
    }
  });
}
