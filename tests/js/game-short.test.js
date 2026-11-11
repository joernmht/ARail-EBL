// Short texts by rule (web/game/short.js): a lead is the first sentence, cut at a word when long.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GAMES } from "../../web/arail/game/index.js";
import { BUDGET, LEAD_WORDS, hasMore, lead, wordCount } from "../../web/game/short.js";

test("lead: the first sentence; a number's point and an abbreviation do not end it", () => {
  assert.equal(lead("Lean costs €3.50 M a year. Thorough costs more."), "Lean costs €3.50 M a year.");
  assert.equal(lead("One sentence only"), "One sentence only");
  assert.equal(lead("  Spaces   are\nflattened. Next."), "Spaces are flattened.");
  assert.equal(lead(""), "");
  assert.equal(lead(null), "");
});

test("lead: a long sentence is cut at a word, with an ellipsis", () => {
  const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
  const cut = lead(long);
  assert.equal(wordCount(cut), LEAD_WORDS);
  assert.ok(cut.endsWith("…"));
  assert.ok(hasMore(long));
  assert.ok(!hasMore("Short."));
});

test("lead: every game's description has a lead within the budget of words", () => {
  for (const G of GAMES.values()) assert.ok(wordCount(lead(G.description ?? "")) <= LEAD_WORDS, G.id);
  assert.ok(BUDGET.setup < BUDGET.seat);
});
