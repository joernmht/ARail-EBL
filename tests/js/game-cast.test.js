// The cast of the game (web/game/cast.js): who asks the player, with a portrait that exists; bird names only.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { LANGUAGES } from "../../web/arail/core/people.js";
import { GAMES } from "../../web/arail/game/index.js";
import { GAME_CAST, NARRATOR, PORTRAITS, portraitFor, selfPortrait, speakerOf } from "../../web/game/cast.js";

const BIRDS = new Set(LANGUAGES.flatMap((l) => l.birds));

test("cast: every portrait is a picture that exists, with what it shows", () => {
  for (const [kind, p] of Object.entries(PORTRAITS)) {
    assert.ok(existsSync(`web/${p.picture}`), `${kind}: ${p.picture}`);
    assert.ok(p.alt?.trim(), `${kind}: alt`);
  }
  assert.ok(PORTRAITS[NARRATOR.portrait]);
});

test("cast: every game has somebody who asks, with a bird's name and portraits of the catalogue", () => {
  for (const id of GAMES.keys()) {
    const c = GAME_CAST[id];
    assert.ok(c, `the game ${id} has nobody who asks`);
    assert.match(c.name, /^\p{Lu}\. \p{L}+$/u, `${id}: an initial and a family name`);
    assert.ok(BIRDS.has(c.name.slice(3)), `${id}: ${c.name} is not a bird of LANGUAGES`);
    assert.ok(PORTRAITS[c.portrait] && PORTRAITS[c.self], `${id}: portraits`);
    assert.ok(c.role.trim());
    assert.equal(selfPortrait(id), PORTRAITS[c.self]);
  }
  for (const id of Object.keys(GAME_CAST)) assert.ok(GAMES.has(id), `no game ${id}`);
});

test("cast: a decision is asked by the person it names, else by the game's own", () => {
  const named = speakerOf("budget", { title: "Why can you not move the money tonight?", text: "T. Amsel, the ministry's auditor, proposes to pay for it from another line." });
  assert.deepEqual(named, { name: "T. Amsel", role: "Ministry's auditor", portrait: "suit" });
  const own = speakerOf("asset-manager", { title: "Year 1: E. Kiebitz, the asset responsible (ALV), proposes to repair the bridge" });
  assert.deepEqual(own, { name: "E. Kiebitz", role: "Asset responsible (ALV)", portrait: "hivis" });
  assert.equal(speakerOf("asset-manager", { title: "Year 1: the renewals", text: "€24.00 M of replacement money." }).name, "E. Kiebitz");
  assert.equal(speakerOf("signaller").portrait, "headset");
  assert.equal(speakerOf("no-such-game", { title: "A question" }).name, NARRATOR.name);
  assert.deepEqual(speakerOf("signaller", { who: { name: "L. Kranich", role: "Team leader, track", portrait: "hivis" } }), { name: "L. Kranich", role: "Team leader, track", portrait: "hivis" });
});

test("cast: the portrait that fits a role's words", () => {
  assert.equal(portraitFor("Team leader, signalling"), "hivis");
  assert.equal(portraitFor("Driver of RB 31"), "uniform");
  assert.equal(portraitFor("Train dispatcher"), "headset");
  assert.equal(portraitFor("The coalition partner's rapporteur"), "suit");
  assert.equal(portraitFor("Planner"), "office");
  assert.equal(portraitFor("Planner", "suit"), "suit");
});

test("cast: who is quoted in a message", async () => {
  const { quoteIn } = await import("../../web/game/cast.js");
  assert.deepEqual(quoteIn('2027: the coalition partner did not get what it asked for. E. Wiedehopf: "Not a second time."'),
    { before: "2027: the coalition partner did not get what it asked for. ", name: "E. Wiedehopf", quote: "Not a second time." });
  assert.equal(quoteIn("Year 1: 276 faults at grade 3.00."), null);
  assert.equal(quoteIn(null), null);
  assert.equal(speakerOf("budget", { who: { name: "E. Wiedehopf" } }).role, "The coalition partner's rapporteur");
  assert.equal(speakerOf("budget", { who: { name: "S. Fink" } }).portrait, "suit");
});

test("cast: a person's own picture, else the portrait of their kind", async () => {
  const { FACES, faceOf } = await import("../../web/game/cast.js");
  assert.equal(faceOf({ name: "E. Kiebitz", portrait: "hivis" }), PORTRAITS.hivis);
  assert.equal(faceOf({ name: "S. Fink", portrait: "no-such-kind" }), PORTRAITS.office);
  assert.equal(faceOf(null), PORTRAITS.office);
  for (const [name, face] of Object.entries(FACES)) {
    assert.ok(existsSync(`web/${face.picture}`), `${name}: ${face.picture}`);
    assert.ok(face.alt?.trim(), name);
  }
});
