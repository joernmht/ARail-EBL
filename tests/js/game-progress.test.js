// What a player has reached (web/game/progress.js): stars, ranks, badges, the sheet of a mission.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BADGES, MAX_STARS, PROGRESS_FORMAT, RANKS, badgesOf, emptyProgress, meet, nextMission, rankOf, readProgress, record, starsFor, totalStars } from "../../web/game/progress.js";

const MISSIONS = JSON.parse(readFileSync("web/game/missions/missions.json", "utf8")).missions.map((f) => f.replace(/\.json$/, ""));

test("stars: none without passing, one for passing, two from 70, three from 85", () => {
  assert.equal(starsFor(99, false), 0);
  assert.equal(starsFor(50, true), 1);
  assert.equal(starsFor(69, true), 1);
  assert.equal(starsFor(70, true), 2);
  assert.equal(starsFor(85, true), 3);
  assert.equal(starsFor(100, true), MAX_STARS);
});

test("record: the best score and the most stars are kept, the sheet is that of the last time; the document passed in is not changed", () => {
  const empty = emptyProgress();
  const a = record(empty, { mission: "fault-night", score: 88, passed: true, roles: ["maintenance-dispatcher"], decisions: [{ who: "Dispatcher", title: "A team asks", chose: "Yes", round: 1 }], terms: ["closure"] });
  assert.deepEqual(empty, emptyProgress());
  assert.deepEqual(a.missions["fault-night"], { best: 88, stars: 3, plays: 1, passed: true });
  assert.equal(a.clean, 1);
  const b = record(a, { mission: "fault-night", score: 40, passed: false, roles: ["maintenance-dispatcher"], violations: 2, danger: true });
  assert.deepEqual(b.missions["fault-night"], { best: 88, stars: 3, plays: 2, passed: true });
  assert.equal(b.sheets["fault-night"].score, 40);
  assert.equal(b.sheets["fault-night"].stars, 0);
  assert.equal(b.dangers, 1);
  assert.deepEqual(b.roles, ["maintenance-dispatcher"]);
  assert.deepEqual(b.terms, ["closure"]);
  assert.equal(totalStars(b), 3);
});

test("progress: what is not a progress document reads as empty; terms met are added once", () => {
  assert.deepEqual(readProgress(null), emptyProgress());
  assert.deepEqual(readProgress({ format: "something-else/1", missions: { x: { stars: 3 } } }), emptyProgress());
  assert.equal(readProgress({ format: PROGRESS_FORMAT, terms: "no" }).terms.length, 0);
  const p = meet(emptyProgress(), ["zs1", "lufv"]);
  assert.deepEqual(p.terms, ["zs1", "lufv"]);
  assert.equal(meet(p, ["zs1"]), p, "nothing new: the same document");
  assert.deepEqual(meet(p, ["alv", "zs1"]).terms, ["zs1", "lufv", "alv"]);
});

test("ranks: they rise with the stars, and the last can be reached with every mission at three stars", () => {
  assert.equal(RANKS[0].stars, 0);
  for (let i = 1; i < RANKS.length; i++) assert.ok(RANKS[i].stars > RANKS[i - 1].stars);
  assert.ok(RANKS.at(-1).stars <= MISSIONS.length * MAX_STARS, "the highest rank can be reached");
  assert.deepEqual(rankOf(0), { title: "Passenger", index: 0, next: "Trainee", need: 1 });
  assert.equal(rankOf(1).title, "Trainee");
  assert.equal(rankOf(3).need, 1);
  assert.equal(rankOf(999).next, null);
  assert.equal(rankOf(999).need, 0);
});

test("badges: earned by what was reached; the missions they name exist", () => {
  const ids = new Set();
  for (const b of BADGES) {
    assert.ok(!ids.has(b.id), b.id);
    ids.add(b.id);
    assert.ok(b.title.trim() && b.how.trim());
  }
  assert.deepEqual(badgesOf(emptyProgress(), MISSIONS), []);
  for (const id of ["night-session", "neustadt-years"]) assert.ok(MISSIONS.includes(id), `the mission ${id} of a badge`);
  let p = record(emptyProgress(), { mission: "night-session", score: 90, passed: true, roles: ["a", "b", "c", "d"], terms: Array.from({ length: 10 }, (_, i) => `t${i}`) });
  assert.deepEqual(badgesOf(p, MISSIONS), ["first-shift", "passed", "three-stars", "clean-sheet", "many-hats", "word-collector", "night-owl"]);
  for (const id of MISSIONS) p = record(p, { mission: id, score: 100, passed: true });
  assert.ok(badgesOf(p, MISSIONS).includes("all-aboard"));
  assert.ok(badgesOf(p, MISSIONS).includes("perfectionist"));
  assert.ok(!badgesOf(p, MISSIONS).includes("investigation"));
  assert.ok(badgesOf(record(p, { mission: "fault-night", score: 10, passed: false, danger: true }), MISSIONS).includes("investigation"));
});

test("next mission: the first that is not passed, else the first", () => {
  assert.equal(nextMission(emptyProgress(), MISSIONS), MISSIONS[0]);
  const p = record(emptyProgress(), { mission: MISSIONS[0], score: 60, passed: true });
  assert.equal(nextMission(p, MISSIONS), MISSIONS[1]);
  assert.equal(nextMission(record(p, { mission: MISSIONS[1], score: 20, passed: false }), MISSIONS), MISSIONS[1]);
  assert.equal(nextMission(emptyProgress(), []), null);
});

test("progress: a damaged mission or sheet is made whole when it is read, so that nothing that draws it breaks", () => {
  const p = readProgress({
    format: PROGRESS_FORMAT,
    missions: { "fault-night": { best: "88", stars: 9, passed: 1 }, broken: null, list: [] },
    sheets: { "fault-night": {}, "budget-years": { score: 70, decisions: [{ title: "A question", chose: "Yes" }, { title: 3 }, null, "no"], terms: ["zs1", 5], roles: "nobody" }, gone: null },
    terms: ["zs1", null], roles: "x", clean: -3, dangers: "2",
  });
  assert.deepEqual(p.missions, { "fault-night": { best: 88, stars: MAX_STARS, plays: 1, passed: true } });
  assert.deepEqual(p.sheets["fault-night"], { score: 0, passed: false, stars: 0, roles: [], violations: 0, danger: false, decisions: [], terms: [] });
  assert.deepEqual(p.sheets["budget-years"].decisions, [{ who: "", title: "A question", chose: "Yes", round: 1 }]);
  assert.deepEqual(p.sheets["budget-years"].terms, ["zs1"]);
  assert.deepEqual(p.sheets["budget-years"].roles, []);
  assert.deepEqual(Object.keys(p.sheets).sort(), ["budget-years", "fault-night"]);
  assert.deepEqual([p.terms, p.roles, p.clean, p.dangers], [["zs1"], [], 0, 2]);
  // what record writes reads back as it was
  const whole = record(emptyProgress(), { mission: "fault-night", score: 88, passed: true, roles: ["maintenance-dispatcher"], decisions: [{ who: "Dispatcher", title: "A team asks", chose: "Yes", round: 2 }], terms: ["closure"] });
  assert.deepEqual(readProgress(JSON.parse(JSON.stringify(whole))), whole);
});
