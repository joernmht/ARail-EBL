import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { LANGUAGES, OPS_DEFAULTS, Person, Population, createRng, makeStaff, normalizeOps, pickHome } from "../../web/arail/index.js";
import { ROOT } from "./helpers.js";

test("people: names are two birds of one language (shown as S. Fink), stable for a seed and key, unique in a population", () => {
  assert.equal(LANGUAGES.reduce((s, l) => s + l.weight, 0), 100, "the weights are per cent");
  const pop = new Population(7, "test");
  for (let i = 0; i < 400; i++) pop.add(["p", i]);
  const people = [...pop];
  assert.equal(new Set(people.map((p) => p.name)).size, 400, "names are unique");
  for (const p of people) {
    const birds = LANGUAGES.find((l) => l.lang === p.lang).birds;
    const rest = p.family.split(" ");
    const b = rest.pop();
    assert.ok(birds.includes(p.given) && birds.includes(b) && p.given !== b, `${p.given} ${p.family}`);
    assert.ok(rest.length === 0 || (rest.length === 1 && rest[0] in LANGUAGES.find((l) => l.lang === p.lang).particles), p.family);
    assert.equal(p.name, `${p.given[0]}. ${p.family}`, "named by the initial and the family name");
  }
  assert.ok(new Set(people.map((p) => p.lang)).size >= 8, "many languages");
  assert.ok(people.filter((p) => p.lang === "de").length > 200, "mostly German");
  const big = new Population(2, "test");
  for (let i = 0; i < 4000; i++) big.add(["p", i]);
  const names = [...big].map((p) => p.name);
  assert.ok(names.some((n) => / von /.test(n)) && names.some((n) => / van /.test(n)) && names.some((n) => / de /.test(n)), "von, van, de");
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

/** Is it a name made of birds: "S. Fink", "M. van Kraai" or a bare "Fink", initial and family of one language? */
function isBirdName(name) {
  const m = /^(?:(\p{L})\. )?(?:(\p{L}+) )?(\p{L}+)$/u.exec(name);
  if (!m) return false;
  const [, initial, particle, family] = m;
  return LANGUAGES.some((l) => l.birds.includes(family)
    && (!particle || Object.hasOwn(l.particles ?? {}, particle))
    && (!initial || l.birds.some((b) => b[0] === initial && b !== family)));
}

/** The JSON files of a folder and its subfolders. */
const jsonFiles = (dir) => readdirSync(join(ROOT, dir), { recursive: true }).filter((f) => f.endsWith(".json")).map((f) => join(dir, f));

/** The names of the people in some JSON: the `name` of each entry of an array under a key for people. */
function peopleNames(value, out = [], key = "") {
  if (Array.isArray(value)) {
    for (const v of value) {
      if (PEOPLE_KEYS.has(key) && v && typeof v === "object" && typeof v.name === "string") out.push(v.name);
      peopleNames(v, out);
    }
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) peopleNames(v, out, k);
  }
  return out;
}

/** The names of the people in JSON text, also a fragment: each `"name"` in an array under a key for people. */
function peopleNamesInText(text) {
  const out = [];
  for (const m of text.matchAll(/"([a-z]+)"\s*:\s*\[/g)) {
    if (!PEOPLE_KEYS.has(m[1])) continue;
    // the array up to its closing bracket (brackets inside strings skipped)
    let depth = 0, end = text.length, inString = false;
    for (let i = m.index + m[0].length - 1; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === "\\") i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "[") depth++;
      else if (c === "]" && --depth === 0) {
        end = i;
        break;
      }
    }
    for (const n of text.slice(m.index, end).matchAll(/"name"\s*:\s*"([^"]*)"/g)) out.push(n[1]);
  }
  return out;
}
const PEOPLE_KEYS = new Set(["drivers", "conductors", "crew", "crews", "staff", "people", "persons", "residents", "members", "workers"]);

test("people: names written by hand (layouts, examples, the guides) are birds too, so nobody resembles a real person", () => {
  assert.ok(isBirdName("S. Fink") && isBirdName("M. van Kraai") && isBirdName("W. Sokół") && isBirdName("Fink"));
  assert.ok(!isBirdName("Weber") && !isBirdName("A. Berg") && !isBirdName("A. van Fink"), "real names, or a particle of another language");
  assert.ok(!isBirdName("D. constructor Amsel") && !isBirdName("S. toString Kartal"), "only the language's own particles");
  assert.deepEqual(peopleNamesInText('"drivers": [{"name": "D. Amsel"}, ...],\r\n "trains": [{"name": "S 1"}]'), ["D. Amsel"], "fragments too");
  const found = [];
  for (const f of [...jsonFiles("web/layouts"), ...jsonFiles("examples")]) {
    for (const name of peopleNames(JSON.parse(readFileSync(join(ROOT, f), "utf8")))) found.push([f, name]);
  }
  // the JSON in the guides is often a fragment that does not parse, so its people are read from the text
  for (const f of readdirSync(join(ROOT, "docs")).filter((x) => x.endsWith(".md"))) {
    for (const [, block] of readFileSync(join(ROOT, "docs", f), "utf8").matchAll(/```json\r?\n([\s\S]*?)```/g)) {
      for (const name of peopleNamesInText(block)) found.push([`docs/${f}`, name]);
    }
  }
  assert.ok(found.some(([f]) => f.endsWith("ebl-neustadt.json")), "the drivers of the operations plan are checked");
  assert.ok(found.some(([f]) => f === "docs/operations.md"), "the drivers in the guide to operations are checked");
  const wrong = found.filter(([, name]) => !isBirdName(name));
  assert.deepEqual(wrong, [], "use bird names of one language (LANGUAGES in core/people.js), e.g. \"S. Fink\"");
});
