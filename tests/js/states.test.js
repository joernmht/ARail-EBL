// The state of what the simulations keep (core/states.js, the Overview): the groups of all
// simulations joined by kind, their mean and histogram, the mean of the layout, the search; and
// the states of the passengers, the town, the maintenance story's assets and the infrastructure.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createWorld, overallState, searchStates, Simulation, STATE_BINS, STOP_CAPACITY_PER_M2, STOP_LOAD_EASY, stateGroups, stopLoad, summarizeStates, withLayers } from "../../web/arail/index.js";
import { ROOT } from "./helpers.js";

/** A world with simulations that report fixed states. */
function fake(...groupsPerSim) {
  const w = createWorld({ objects: [], simulations: [] }, { seed: 3 });
  for (const groups of groupsPerSim) {
    const sim = new Simulation(w, {});
    sim.states = () => groups;
    w.simulations.push(sim);
  }
  return w;
}

test("groups of the same kind are joined; empty groups and items without a score are left out", () => {
  const w = fake(
    [{ id: "signal", label: "Signal", items: [{ name: "N1", score: 0.9 }, { name: "N2", score: NaN }] }, { id: "empty", label: "Empty", items: [] }],
    [{ id: "signal", label: "Signal", items: [{ name: "N3", score: 0.2 }] }],
  );
  const groups = stateGroups(w);
  assert.deepEqual(groups.map((g) => [g.id, g.items.map((i) => i.name)]), [["signal", ["N1", "N3"]]]);
  // a simulation switched off says nothing
  w.simulations[1].enabled = false;
  assert.deepEqual(stateGroups(w)[0].items.map((i) => i.name), ["N1"]);
});

test("a kind: its mean, a histogram of fixed bins (0–10 % … 90–100 %), its worst item", () => {
  const s = summarizeStates({ id: "x", label: "X", items: [{ name: "a", score: 0 }, { name: "b", score: 0.55 }, { name: "c", score: 1 }, { name: "d", score: 1.4 }] });
  assert.equal(s.bins.length, STATE_BINS);
  assert.deepEqual(s.bins, [1, 0, 0, 0, 0, 1, 0, 0, 0, 2]); // 1 (and above) in the last bin
  assert.equal(s.mean, (0 + 0.55 + 1 + 1) / 4);
  assert.equal(s.worst.name, "a");
});

test("the layout: each kind counts once in the mean; the kinds from the worst; a search by name or kind, the worst first", () => {
  const w = fake([
    { id: "people", label: "Residents", items: Array.from({ length: 100 }, (_, i) => ({ name: `Person ${i}`, score: 1 })) },
    { id: "signal", label: "Signal", items: [{ name: "Exit signal N1", score: 0.5 }, { name: "Exit signal N2", score: 0 }] },
  ]);
  const st = overallState(w);
  assert.equal(st.count, 102);
  assert.equal(st.mean, (1 + 0.25) / 2);
  assert.deepEqual(st.groups.map((g) => g.id), ["signal", "people"]);
  assert.deepEqual(searchStates(st.groups, "signal").map((x) => x.name), ["Exit signal N2", "Exit signal N1"]);
  assert.deepEqual(searchStates(st.groups, "n1 exit").map((x) => [x.name, x.group]), [["Exit signal N1", "Signal"]]);
  assert.equal(searchStates(st.groups, "person", 5).length, 5);
  assert.deepEqual(searchStates(st.groups, "  "), []);
  assert.equal(overallState(fake()).mean, null);
});

test("Bf Neustadt with its maintenance story: the stops, the people, the residents and the station's assets by type", () => {
  const json = withLayers(JSON.parse(readFileSync(join(ROOT, "web/layouts/ebl-neustadt.json"), "utf8")), ["infrastructure"]);
  const w = createWorld(json, { seed: 2 });
  for (let i = 0; i < 120; i++) w.step(0.5);
  const st = overallState(w);
  const ids = st.groups.map((g) => g.id);
  for (const id of ["stops", "residents", "asset:signal", "asset:interlocking"]) assert.ok(ids.includes(id), `${id} in ${ids.join(", ")}`);
  for (const g of st.groups) for (const it of g.items) assert.ok(it.score >= 0 && it.score <= 1 && it.name, `${g.id}: ${it.name} ${it.score}`);
  // the signals: by their age, with the key of their card
  const signals = st.groups.find((g) => g.id === "asset:signal");
  assert.ok(signals.items.every((it) => /^grade \d\.\d$/.test(it.text) && it.key.startsWith("object:")));
  assert.equal(searchStates(st.groups, "N2")[0].name, "Exit signal N2");
  assert.ok(st.mean > 0 && st.mean < 1);
});

test("a stop is rated by its load and the mood of the people waiting: the mean of both", () => {
  const area = { L: 10, W: 2 }; // 20 m², 40 people when full
  assert.equal(STOP_CAPACITY_PER_M2 * 20, 40);
  assert.deepEqual(stopLoad(area, 0), { load: 0, score: 1 });
  assert.equal(stopLoad(area, 40 * STOP_LOAD_EASY).score, 1, "a quarter full is easy going");
  assert.equal(stopLoad(area, 40).score, 0, "full");
  assert.equal(stopLoad(area, 60).score, 0, "beyond full");
  assert.ok(Math.abs(stopLoad(area, 25).score - 0.5) < 1e-9, "halfway between easy and full");
  // in the world: a crowded tram stop scores lower than an empty one, its text says both
  const json = JSON.parse(readFileSync(join(ROOT, "web/layouts/ebl-neustadt.json"), "utf8"));
  const w = createWorld(json, { seed: 2 });
  w.step(0.5);
  const pax = w.simulations.find((x) => x.constructor.type === "passengers");
  const stops = () => pax.states().find((g) => g.id === "stops").items;
  const empty = stops().find((it) => it.name === "Lindenstraße · Stop A");
  assert.match(empty.text, /^\d+ waiting · \d+ % full · mood \d+ %$/);
  const a = w.stopAreas().find((x) => x.id === "tram-stop-lindenstrasse:right");
  for (let i = 0; i < 60; i++) pax.enter(a.id, { agent: { id: `p${i}` } });
  const full = stops().find((it) => it.key === `object:${a.owner.id}` && it.name === empty.name);
  assert.ok(full.score < empty.score, `${full.text} against ${empty.text}`);
});
