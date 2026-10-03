import assert from "node:assert/strict";
import test from "node:test";
import { LANGUAGES, OPS_DEFAULTS, Person, Population, createRng, makeStaff, normalizeOps, pickHome } from "../../web/arail/index.js";

test("people: names are two birds of one language, stable for a seed and key, unique in a population", () => {
  assert.equal(LANGUAGES.reduce((s, l) => s + l.weight, 0), 100, "the weights are per cent");
  const pop = new Population(7, "test");
  for (let i = 0; i < 400; i++) pop.add(["p", i]);
  const people = [...pop];
  assert.equal(new Set(people.map((p) => p.name)).size, 400, "names are unique");
  for (const p of people) {
    const birds = LANGUAGES.find((l) => l.lang === p.lang).birds;
    const [a, b] = p.name.split(" ");
    assert.ok(birds.includes(a) && birds.includes(b) && a !== b, p.name);
  }
  assert.ok(new Set(people.map((p) => p.lang)).size >= 8, "many languages");
  assert.ok(people.filter((p) => p.lang === "de").length > 200, "mostly German");
  const again = new Population(7, "test").add(["p", 3]);
  assert.equal(again.name, people[3].name, "same seed and key, same name");
  assert.equal(again.id, "p-3");
});

test("people: simulations extend Person; people made before keep their names", () => {
  class Worker extends Person {
    constructor(spec) {
      super(spec);
      this.busy = false;
    }
  }
  const first = new Population(1, "x");
  const a = first.add("a", { role: "driver", home: { kind: "away", minutes: 10 } }, Worker);
  assert.ok(a instanceof Worker && a instanceof Person);
  assert.equal(a.role, "driver");
  assert.equal(a.busy, false);
  const later = new Population(1, "x", [a]);
  for (let i = 0; i < 60; i++) assert.notEqual(later.add(["b", i]).name, a.name);
});

test("people: homes on the layout, beyond it by train, or away", () => {
  const homes = [{ id: "h1", walkM: 300, weight: 1 }];
  const outer = [{ station: "far", line: "RE 1" }];
  assert.equal(pickHome(createRng(1), { homes, outer, outerShare: 1 }).kind, "station");
  const h = pickHome(createRng(1), { homes, outer, outerShare: 0 });
  assert.deepEqual([h.kind, h.building, h.walkM], ["layout", "h1", 300]);
  assert.equal(pickHome(createRng(1), {}).kind, "away");
});

test("people: crews of all roles come from one population", () => {
  const model = normalizeOps(OPS_DEFAULTS);
  const pop = new Population(3, "person");
  const staff = [
    ...makeStaff(model, 30, { role: "driver", seed: 3, lines: ["a"], population: pop }),
    ...makeStaff(model, 30, { role: "conductor", seed: 3, lines: ["a"], population: pop }),
  ];
  assert.ok(staff.every((p) => p instanceof Person));
  assert.equal(new Set(staff.map((p) => p.name)).size, 60, "names unique over the roles");
  assert.equal(pop.size, 60);
});
