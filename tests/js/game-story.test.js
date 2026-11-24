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

test("the line said to a seat: lines for other seats neither show nor block; what is heard is kept seat by seat", async () => {
  const { lineFor, staleLines } = await import("../../web/arail/game/index.js");
  const lines = storyOf({ story: [
    { phase: "plan", say: "for the manager", seats: ["manager"] }, { phase: "plan", say: "for everybody" }, { phase: "plan", say: "for the planner", seats: ["planner"] }, { phase: "plan", say: "the last, for everybody" },
  ] }, "plan", 1);
  /** Two people at two seats of one phase: what each has answered. */
  const heard = { planner: new Set(), manager: new Set() };
  const said = (seat) => lineFor(lines, seat, heard[seat])?.say ?? null;
  const ok = (seat) => heard[seat].add(lineFor(lines, seat, heard[seat]).index);
  // a turn: a seat hears its own lines and those for everybody, in their order; a line for another seat does not stand in the way
  assert.equal(said("planner"), "for everybody");
  ok("planner");
  assert.equal(said("planner"), "for the planner");
  // a line for everybody is said at every seat: the planner's OK does not take it from the manager
  assert.equal(said("manager"), "for the manager");
  ok("manager");
  assert.equal(said("manager"), "for everybody", "answered at the planner's seat, still to be said at the manager's");
  ok("manager");
  assert.equal(said("manager"), "the last, for everybody");
  ok("planner");
  assert.equal(said("planner"), "the last, for everybody");
  ok("planner");
  ok("manager");
  assert.deepEqual([said("planner"), said("manager")], [null, null]);
  assert.equal(lineFor(lines, "somebody-else", new Set())?.say, "for everybody");
  // a shift: the lines whose moment has come, one at a time and in their order; none is passed over
  const shift = storyOf({ story: [
    { phase: "shift", at: 10, say: "a, for the signaller", seats: ["signaller"] }, { phase: "shift", at: 20, say: "b, for the dispatcher", seats: ["dispatcher"] },
    { phase: "shift", at: 30, say: "c, for everybody" }, { phase: "shift", at: 90, say: "d, later" },
  ] }, "shift", 1);
  const at = (seat, h, t) => lineFor(shift, seat, h, t)?.say ?? null;
  assert.equal(at("signaller", new Set(), 5), null, "nothing is due yet");
  assert.equal(at("signaller", new Set(), 15), "a, for the signaller");
  assert.equal(at("dispatcher", new Set(), 15), null);
  // two lines have come due without an answer (a decision was open): the earlier one is said first, then the next
  const signaller = new Set(), dispatcher = new Set();
  assert.equal(at("signaller", signaller, 40), "a, for the signaller", "the earlier line is not passed over");
  signaller.add(lineFor(shift, "signaller", signaller, 40).index);
  assert.equal(at("signaller", signaller, 40), "c, for everybody");
  signaller.add(lineFor(shift, "signaller", signaller, 40).index);
  assert.deepEqual([...signaller].sort(), [0, 2], "the signaller's lines, not the dispatcher's");
  assert.equal(at("signaller", signaller, 40), null);
  assert.equal(at("signaller", signaller, 95), "d, later");
  // the dispatcher has answered nothing: the line for everybody that the signaller answered is said there too
  assert.equal(at("dispatcher", dispatcher, 25), "b, for the dispatcher");
  dispatcher.add(lineFor(shift, "dispatcher", dispatcher, 25).index);
  assert.equal(at("dispatcher", dispatcher, 40), "c, for everybody");
  // a seat a person takes in the middle of a shift: the lines whose moment has passed are not said any more, but for the latest
  assert.deepEqual(staleLines(shift, "signaller", 5), []);
  assert.deepEqual(staleLines(shift, "signaller", 15), [], "the only line that is due is still said");
  assert.deepEqual(staleLines(shift, "signaller", 95), [0, 2], "all but the latest, of this seat's lines");
  assert.deepEqual(staleLines(shift, "dispatcher", 40), [1]);
  assert.equal(at("signaller", new Set(staleLines(shift, "signaller", 95)), 95), "d, later");
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

test("story: a line in a round its phase is not played in, a time that is no number, a portrait there is none of", async () => {
  const { PORTRAITS } = await import("../../web/game/cast.js");
  const doc = missions.find((m) => m.id === "budget-years"), first = doc.phases[0];
  const once = { ...doc, phases: doc.phases.map((p, i) => (i === 0 ? { ...p, rounds: [1] } : p)) };
  const bad = (d, line, options) => validateMission({ ...d, story: [line] }, GAMES, options).filter((x) => x.startsWith("story")).join(" | ");
  assert.match(bad(once, { phase: first.id, say: "Never.", rounds: [2] }), /story 1: rounds names none of the rounds the phase "\w[\w-]*" is played in/);
  assert.equal(bad(once, { phase: first.id, say: "In its round.", rounds: [1, 2] }), "");
  assert.equal(bad(doc, { phase: first.id, say: "Every round.", rounds: [2] }), "", "a phase played in every round");
  assert.match(bad(doc, { phase: first.id, say: "When?", at: "5" }), /story 1: at must be a number of seconds, 0 or more/);
  assert.match(bad(doc, { phase: first.id, say: "When?", at: Number.NaN }), /story 1: at must be a number/);
  const portraits = Object.keys(PORTRAITS);
  assert.match(bad(doc, { phase: first.id, say: "Who?", who: { name: "S. Fink", portrait: "astronaut" } }, { portraits }), /story 1: there is no portrait "astronaut"/);
  assert.equal(bad(doc, { phase: first.id, say: "Who?", who: { name: "S. Fink", portrait: "astronaut" } }), "", "without the page's portraits it is not checked");
  for (const m of missions) assert.deepEqual(validateMission(m, GAMES, { portraits }), [], m.id);
});

test("story: a line on a kind of irregularity is said each time a seat's game reports one, with its words; not at a time", async () => {
  const { answerFor, answersOf, staleAnswers, SignallerGame } = await import("../../web/arail/game/index.js");
  const doc = missions.find((m) => m.id === "first-shift"), m = normalizeMission(doc, GAMES), seat = doc.roles[0].role;
  // the first shift: a few lines that teach, then the dispatcher speaks only when something does not go to plan
  const timed = storyOf(m, "shift", 1), answers = answersOf(m, "shift", 1);
  assert.ok(timed.length >= 3 && timed.every((l) => l.on == null), "the tutorial is said at its times");
  assert.ok(answers.length >= 3 && answers.every((l) => SignallerGame.irregularities.includes(l.on)), "the rest answers what the signaller's game reports");
  // the calls are not kept for after the tutorial (an `at` would leave unanswered what came before it): they may come
  // between its lines, and the mission does not promise otherwise
  assert.ok(answers.every((l) => l.at === 0));
  assert.match(doc.text, /from the first train on, the dispatcher calls whenever something does not go to plan/);
  assert.doesNotMatch(timed.at(-1).say, /only when/);
  const heard = new Set();
  assert.equal(answerFor(answers, seat, heard, []), null, "nothing went wrong: nobody calls");
  const held = { t: 120, kind: "held-at-entry", key: "held:RB 31", train: "RB 31", signal: "A", track: "G2" };
  const line = answerFor(answers, seat, heard, [held]);
  assert.match(line.say, /^RB 31 is standing at signal A\. Set its route into G2/);
  assert.equal(line.key, `${line.index}|held:RB 31`);
  heard.add(line.key);
  assert.equal(answerFor(answers, seat, heard, [held]), null, "answered once, not again");
  const next = { t: 150, kind: "held-at-entry", key: "held:RB 32", train: "RB 32", signal: "F", track: "G3" };
  assert.match(answerFor(answers, seat, heard, [held, next]).say, /^RB 32 is standing at signal F/, "the same kind for another train is said again");
  // a placeholder the game has no word for stays as it is; a line from `at` on does not answer what came before
  assert.equal(answerFor([{ index: 0, at: 0, on: "x", say: "{train} {nothing}" }], seat, new Set(), [{ t: 1, kind: "x", key: "k", train: "T" }]).say, "T {nothing}");
  assert.equal(answerFor([{ index: 0, at: 100, on: "x", say: "late" }], seat, new Set(), [{ t: 1, kind: "x", key: "k" }]), null);
  assert.equal(answerFor([{ index: 0, at: 0, on: "x", say: "not yours", seats: ["other"] }], seat, new Set(), [{ t: 1, kind: "x", key: "k" }]), null);
  // a seat taken in the middle of a shift is not told what was reported before
  assert.deepEqual(staleAnswers(answers, seat, [held]), answers.filter((l) => l.on === "held-at-entry").map((l) => `${l.index}|held:RB 31`));
  // a line on a kind no game at work reports, or that is not a kind, is a problem of the mission
  const bad = (line) => validateMission({ ...doc, story: [line] }, GAMES).join(" | ");
  assert.match(bad({ phase: "shift", on: "rain", say: "Rain." }), /story 1: on "rain": no game at work there reports it/);
  assert.match(bad({ phase: "shift", on: "Held At Entry", say: "Held." }), /story 1: on must be the kebab-case kind/);
  assert.equal(bad({ phase: "shift", on: "late-departure", say: "{train} is late." }), "");
  // seats that are not a list: the problem of the mission, not a crash
  assert.match(bad({ phase: "shift", on: "held-at-entry", say: "Held.", seats: "signaller-relay" }), /story 1: seats must be a list of seats/);
  // in a turn nothing is answered: a line on a kind there could never be said
  const turns = missions.find((x) => x.id === "neustadt-years"), turn = turns.phases.find((p) => p.kind === "turn");
  assert.match(validateMission({ ...turns, story: [{ phase: turn.id, on: "signal-failed", say: "Failed." }] }, GAMES).join(" | "), new RegExp(`story 1: on is answered only in a shift, and "${turn.id}" is a turn`));
});
