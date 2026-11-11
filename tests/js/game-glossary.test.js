// The glossary of the game (web/game/glossary.js): terms in a line each, found in the games' texts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GAMES } from "../../web/arail/game/index.js";
import { TERMS, mark, termOf, termsIn } from "../../web/game/glossary.js";

test("terms: each has an id, a line of its own and a way to find it", () => {
  const ids = new Set();
  for (const t of TERMS) {
    assert.match(t.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(!ids.has(t.id), `${t.id} twice`);
    ids.add(t.id);
    assert.ok(t.term.trim(), t.id);
    assert.ok(t.line.length >= 40 && t.line.length <= 240, `${t.id}: a line or two (${t.line.length})`);
    assert.ok(t.find instanceof RegExp && !t.find.global, `${t.id}: a pattern without the g flag`);
    assert.equal(termOf(t.id), t);
  }
  assert.equal(termOf("no-such-term"), null);
});

test("mark: a text is cut at its terms, each once, in their order", () => {
  const parts = mark("E. Kiebitz, the asset responsible (ALV), proposes a permanent speed restriction; the EBA asks for inspections.");
  assert.deepEqual(parts.map((x) => (typeof x === "string" ? x : `[${x.term.id}:${x.text}]`)),
    ["E. Kiebitz, the ", "[alv:asset responsible]", " (ALV), proposes a permanent ", "[la:speed restriction]", "; the ", "[eba:EBA]", " asks for ", "[inspection:inspections]", "."]);
  assert.deepEqual(mark("Nothing railway here."), ["Nothing railway here."]);
  assert.deepEqual(mark(""), []);
  assert.deepEqual(mark(null), []);
  assert.equal(mark("Zs 1 and again Zs 1").filter((x) => typeof x !== "string").length, 1, "a term is marked where it comes first");
  assert.equal(parts.map((x) => (typeof x === "string" ? x : x.text)).join(""), "E. Kiebitz, the asset responsible (ALV), proposes a permanent speed restriction; the EBA asks for inspections.", "nothing of the text is lost");
});

test("termsIn: the terms of several texts, each once", () => {
  assert.deepEqual(termsIn("A track closure.", "The closure again, and Ril 408."), ["closure", "ril-408"]);
});

test("the games' own descriptions meet terms of the glossary", () => {
  const met = new Set([...GAMES.values()].flatMap((G) => termsIn(G.description ?? "", G.title ?? "")));
  assert.ok(met.size >= 3, `only ${met.size} terms in the games' descriptions`);
});
