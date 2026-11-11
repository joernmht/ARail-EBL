// The places of the game (web/game/places.js): every game and every mission has a place with a
// photo that exists, and every mission a hook short enough for its card.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { GAMES, HOOK_CHARS, normalizeMission, validateMission } from "../../web/arail/game/index.js";
import { DEFAULT_PLACE, GAME_PLACES, PLACES, missionFacts, placeOf, placeOfGame, placeOfMission } from "../../web/game/places.js";

const DIR = "web/game/missions/";
const missions = JSON.parse(readFileSync(`${DIR}missions.json`, "utf8")).missions.map((f) => JSON.parse(readFileSync(DIR + f, "utf8")));

test("places: each has a name, a line, a photo that exists and what it shows", () => {
  const ids = new Set();
  for (const p of PLACES) {
    assert.match(p.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(!ids.has(p.id), `${p.id} twice`);
    ids.add(p.id);
    for (const k of ["name", "line", "alt"]) assert.ok(p[k]?.trim(), `${p.id}: ${k}`);
    assert.ok(p.line.length <= 60, `${p.id}: its line is one line`);
    assert.ok(existsSync(`web/${p.photo}`), `${p.id}: ${p.photo}`);
  }
  assert.ok(ids.has(DEFAULT_PLACE));
  assert.equal(placeOf("nowhere").id, DEFAULT_PLACE);
  assert.equal(placeOf().id, DEFAULT_PLACE);
});

test("places: every game has one", () => {
  for (const id of GAMES.keys()) {
    assert.ok(GAME_PLACES[id], `the game ${id} has no place`);
    assert.equal(placeOfGame(id).id, GAME_PLACES[id]);
  }
  for (const [game, place] of Object.entries(GAME_PLACES)) {
    assert.ok(GAMES.has(game), `no game ${game}`);
    assert.ok(PLACES.some((p) => p.id === place), `${game}: no place ${place}`);
  }
});

test("missions: each has a hook of a line or two and a place of the catalogue", () => {
  for (const doc of missions) {
    assert.deepEqual(validateMission(doc, GAMES), [], doc.id);
    assert.ok(doc.hook && doc.hook.length <= HOOK_CHARS, `${doc.id}: hook`);
    assert.ok(doc.hook.length < doc.text.length / 2, `${doc.id}: the hook is not the briefing`);
    assert.ok(PLACES.some((p) => p.id === doc.place), `${doc.id}: place ${doc.place}`);
    assert.equal(placeOfMission(doc).id, doc.place);
  }
});

test("missions: a hook too long and a place not in kebab-case are problems; without them a mission is sound", () => {
  const doc = missions.find((m) => m.id === "fault-night");
  assert.match(validateMission({ ...doc, hook: "x".repeat(HOOK_CHARS + 1) }, GAMES).join(), /hook/);
  assert.match(validateMission({ ...doc, hook: " " }, GAMES).join(), /hook/);
  assert.match(validateMission({ ...doc, place: "The Track" }, GAMES).join(), /place/);
  const { hook, place, ...bare } = doc;
  assert.deepEqual(validateMission(bare, GAMES), []);
  assert.equal(placeOfMission(bare).id, "track", "the place of its first seat's game");
});

test("missions: the facts of a mission, for its chips", () => {
  const facts = (id) => missionFacts(normalizeMission(missions.find((m) => m.id === id), GAMES));
  assert.deepEqual(facts("fault-night"), ["1 role", "40 min on the clock", "solo"]);
  assert.deepEqual(facts("neustadt-morning"), ["2 roles", "40 min on the clock", "together"]);
  assert.deepEqual(facts("neustadt-years"), ["6 roles", "3 rounds", "40 min on the clock + 3 turns each", "together"]);
  assert.deepEqual(facts("night-session"), ["1 role", "4 rounds", "2 turns each", "solo"]);
  assert.deepEqual(missionFacts({ roles: [{}, {}], rounds: 1, mode: "competitive", phases: [{ kind: "shift", length: 7200 }] }), ["2 roles", "2 h on the clock", "against each other"]);
});

test("backdrops: each is a picture that exists; what a text speaks of decides", async () => {
  const { BACKDROPS, backdropFor, wideOf } = await import("../../web/game/places.js");
  const ids = new Set();
  for (const b of BACKDROPS) {
    assert.ok(!ids.has(b.id), `${b.id} twice`);
    ids.add(b.id);
    assert.ok(existsSync(`web/${b.photo}`), `${b.id}: ${b.photo}`);
    assert.ok(b.alt?.trim() && b.words instanceof RegExp && !b.words.global, b.id);
  }
  assert.match(backdropFor("Year 1: a technician on call").photo, /night-crossing/);
  assert.match(backdropFor("RB 31 comes late. Shall RB 32 wait for its passengers?").photo, /platform/);
  assert.match(backdropFor("Year 1: the renewals").photo, /overview/);
  assert.match(backdropFor("Nothing that fits", "but the crane does").photo, /terminal/);
  assert.equal(backdropFor("Nothing that fits"), null);
  assert.equal(backdropFor(), null);
  for (const p of PLACES) {
    const w = wideOf(p);
    assert.ok(existsSync(`web/${w.photo}`), `${p.id}: ${w.photo}`);
    assert.ok(w.alt && w.focus);
  }
});
