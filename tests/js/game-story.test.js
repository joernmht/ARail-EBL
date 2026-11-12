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

test("the line said to a seat: lines for other seats neither show nor block; in a turn the first not heard, in a shift the latest that is due", async () => {
  const { heardWith, lineFor } = await import("../../web/arail/game/index.js");
  const lines = storyOf({ story: [
    { phase: "plan", say: "for the manager", seats: ["manager"] }, { phase: "plan", say: "for everybody" }, { phase: "plan", say: "for the planner", seats: ["planner"] }, { phase: "plan", say: "the last, for everybody" },
  ] }, "plan", 1);
  const said = (seat, heard) => lineFor(lines, seat, heard)?.say ?? null;
  // a turn: a seat hears its own lines and those for everybody, in their order; a line for another seat does not stand in the way
  const heard = new Set();
  assert.equal(said("planner", heard), "for everybody");
  for (const i of heardWith(lines, "planner", lineFor(lines, "planner", heard))) heard.add(i);
  assert.equal(said("planner", heard), "for the planner");
  assert.equal(said("manager", heard), "for the manager", "the manager's own line is still to be said");
  for (const i of heardWith(lines, "manager", lineFor(lines, "manager", heard))) heard.add(i);
  assert.equal(said("manager", heard), "the last, for everybody", "what everybody heard at the planner's seat is not said again");
  assert.equal(said("somebody-else", new Set()), "for everybody");
  // a shift: the latest line that is due; answered, the earlier ones of that seat are heard with it, another seat's are not
  const shift = storyOf({ story: [
    { phase: "shift", at: 10, say: "a, for the signaller", seats: ["signaller"] }, { phase: "shift", at: 20, say: "b, for the dispatcher", seats: ["dispatcher"] },
    { phase: "shift", at: 30, say: "c, for everybody" }, { phase: "shift", at: 90, say: "d, later" },
  ] }, "shift", 1);
  const at = (seat, h, t) => lineFor(shift, seat, h, t)?.say ?? null;
  assert.equal(at("signaller", new Set(), 5), null, "nothing is due yet");
  assert.equal(at("signaller", new Set(), 15), "a, for the signaller");
  assert.equal(at("dispatcher", new Set(), 15), null);
  assert.equal(at("signaller", new Set(), 40), "c, for everybody");
  const h = new Set(heardWith(shift, "signaller", lineFor(shift, "signaller", new Set(), 40), 40));
  assert.deepEqual([...h].sort(), [0, 2], "the signaller's earlier line with it, not the dispatcher's");
  assert.equal(at("signaller", h, 40), null);
  assert.equal(at("signaller", h, 95), "d, later");
  assert.equal(at("dispatcher", h, 25), "b, for the dispatcher", "the dispatcher's line stays to be said");
  assert.deepEqual(heardWith(shift, "nobody", { index: 7 }, 40), [7]);
});

test("story: seats that are not a list are a problem of the mission, not a crash", () => {
  const doc = missions.find((m) => m.id === "first-shift");
  const bad = (seats) => validateMission({ ...doc, story: [{ phase: "shift", say: "Hello.", seats }] }, GAMES).join(" | ");
  assert.match(bad("signaller-relay"), /story 1: seats must be a list of seats/);
  assert.match(bad(1), /story 1: seats must be a list of seats/);
  assert.match(bad({}), /story 1: seats must be a list of seats/);
  assert.equal(bad(["signaller-relay"]), "");
});

test("story: a line that could never be said is a problem: after the end of its shift, or to a seat not at work in its phase", () => {
  const doc = missions.find((m) => m.id === "neustadt-years"), shift = doc.phases.find((p) => p.kind === "shift"), turn = doc.phases.find((p) => p.kind === "turn");
  const bad = (line) => validateMission({ ...doc, story: [line] }, GAMES).join(" | ");
  assert.match(bad({ phase: shift.id, at: shift.length + 1, say: "Too late." }), /story 1: at is \d+ s, after the end of the shift \(\d+ s\)/);
  assert.equal(bad({ phase: shift.id, at: shift.length, say: "At the very end." }), "");
  assert.equal(bad({ phase: turn.id, at: 99999, say: "In a turn the time does not count." }), "");
  const idle = doc.roles.map((r) => r.id ?? r.role).find((id) => !shift.roles.includes(id));
  assert.ok(idle, "a seat that is not at work in the shift");
  assert.match(bad({ phase: shift.id, say: "Nobody is there.", seats: [idle] }), new RegExp(`story 1: seats names "${idle}", which is not at work in the phase "${shift.id}"`));
  assert.equal(bad({ phase: shift.id, say: "Somebody is there.", seats: [shift.roles[0]] }), "");
  for (const m of missions) assert.deepEqual(validateMission(m, GAMES), [], m.id);
});
