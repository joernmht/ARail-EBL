// A mission's story (arail/game/mission.js): what people say to the players, as data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LANGUAGES } from "../../web/arail/core/people.js";
import { GAMES, SAY_CHARS, normalizeMission, storyOf, validateMission } from "../../web/arail/game/index.js";
import { PORTRAITS } from "../../web/game/cast.js";

const DIR = "web/game/missions/";
const missions = JSON.parse(readFileSync(`${DIR}missions.json`, "utf8")).missions.map((f) => JSON.parse(readFileSync(DIR + f, "utf8")));
const BIRDS = new Set(LANGUAGES.flatMap((l) => l.birds));

test("story: every mission has somebody who speaks first, with a bird's name and a portrait there is", () => {
  for (const doc of missions) {
    assert.deepEqual(validateMission(doc, GAMES), [], doc.id);
    const m = normalizeMission(doc, GAMES);
    assert.ok(m.story.length >= 1, `${doc.id}: no story`);
    for (const line of m.story) {
      assert.ok(line.say.length <= SAY_CHARS, `${doc.id}: a line of ${line.say.length} characters`);
      assert.match(line.who.name, /^\p{Lu}\. \p{L}+$/u, `${doc.id}: ${line.who.name}`);
      assert.ok(BIRDS.has(line.who.name.slice(3)), `${doc.id}: ${line.who.name} is not a bird of LANGUAGES`);
      assert.ok(PORTRAITS[line.who.portrait], `${doc.id}: portrait ${line.who.portrait}`);
    }
    const first = m.phases.find((p) => p.roles.some((id) => m.roles.find((r) => r.id === id)?.seat === "human"));
    assert.ok(storyOf(m, first.id, 1).length >= 1, `${doc.id}: nobody speaks in ${first.id}, the first phase a person is at work in`);
  }
});

test("storyOf: the lines of a phase and a round, by their time, then as written", () => {
  const m = { story: [
    { phase: "shift", at: 60, say: "b" }, { phase: "shift", say: "a" }, { phase: "plan", say: "p", rounds: [2] }, { phase: "shift", at: 60, say: "c" }, { phase: "shift", at: 5, say: "only once", rounds: [1] },
  ] };
  assert.deepEqual(storyOf(m, "shift", 1).map((l) => l.say), ["a", "only once", "b", "c"]);
  assert.deepEqual(storyOf(m, "shift", 2).map((l) => l.say), ["a", "b", "c"]);
  assert.deepEqual(storyOf(m, "plan", 1), []);
  assert.deepEqual(storyOf(m, "plan", 2).map((l) => [l.say, l.at, l.index]), [["p", 0, 2]]);
  assert.deepEqual(storyOf({}, "shift", 1), []);
});

test("story: lines that cannot be said are problems of the mission", () => {
  const doc = missions.find((m) => m.id === "first-shift");
  const bad = (story) => validateMission({ ...doc, story }, GAMES).join(" | ");
  assert.match(bad([{ phase: "nowhere", say: "Hello." }]), /story 1: no phase "nowhere"/);
  assert.match(bad([{ phase: "shift", say: "x".repeat(SAY_CHARS + 1) }]), /story 1: say/);
  assert.match(bad([{ phase: "shift", say: " " }]), /story 1: say/);
  assert.match(bad([{ phase: "shift", say: "Hello.", at: -1 }]), /story 1: at/);
  assert.match(bad([{ phase: "shift", say: "Hello.", who: { role: "Nobody" } }]), /story 1: who needs a name/);
  assert.match(bad([{ phase: "shift", say: "Hello.", rounds: [2] }]), /story 1: rounds/);
  assert.match(bad([{ phase: "shift", say: "Hello.", seats: ["nobody"] }]), /story 1: seats names "nobody"/);
  assert.match(bad("no list"), /story must be a list/);
  assert.deepEqual(validateMission({ ...doc, story: undefined }, GAMES), [], "a mission without a story is sound");
});
