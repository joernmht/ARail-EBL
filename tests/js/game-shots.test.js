// The camera positions of the game's virtual pictures (web/game/shots.js), and the camera's way between them.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { BACKDROPS, PLACES, backdropAt, wideOf } from "../../web/game/places.js";
import { DAY, NEUSTADT, NIGHT, SEEN, SHOTS, between, seenFrom, shotOf } from "../../web/game/shots.js";

test("shots: each has a picture, a layout that exists and a camera that looks down at the table", () => {
  const names = new Set();
  for (const s of SHOTS) {
    assert.ok(!names.has(s.name), `${s.name} twice`);
    names.add(s.name);
    assert.match(s.name, /^[a-z]+(-[a-z]+)*-fly$/);
    assert.ok(existsSync(`web/game/places/${s.name}.jpg`), `${s.name}.jpg`);
    assert.ok(existsSync(`web/${s.layout}`), s.layout);
    assert.ok(s.distance_mm > 0 && s.pitch_deg >= 8 && s.pitch_deg <= 90, s.name);
    assert.ok(s.time === DAY || s.time === NIGHT, `${s.name}: by day or at night`);
    assert.equal(shotOf(s.name), s);
  }
  assert.equal(shotOf("no-such-shot"), null);
  assert.equal(shotOf(null), null);
});

test("shots: the pictures of the night are taken at night, and a place's live shot is one of the layout that runs", () => {
  for (const s of SHOTS) assert.equal(s.time === NIGHT, s.name.startsWith("night-"), s.name);
  for (const p of PLACES) {
    const w = wideOf(p);
    if (p.live) assert.equal(shotOf(p.live)?.layout, NEUSTADT, `${p.id}: live ${p.live}`);
    if (w.shot) assert.ok(shotOf(w.shot), `${p.id}: shot ${w.shot}`);
  }
  for (const b of BACKDROPS) {
    const pic = backdropAt(null, b.id === "track" ? "a fault" : "");
    if (/-fly\.jpg$/.test(b.photo)) assert.ok(shotOf(b.photo.replace(/^.*\//, "").replace(/\.jpg$/, "")), b.id);
    if (pic) assert.ok(pic.shot === null || shotOf(pic.shot), b.id);
  }
  assert.equal(backdropAt(false, "Signal N2 has failed.").shot, "line-fly", "the lab's photo of the line has a live shot");
  assert.equal(backdropAt(null, "RB 31 comes late").shot, "platform-fly");
  assert.equal(wideOf(PLACES.find((p) => p.id === "signal-box")).shot, "throat-fly");
  assert.equal(wideOf(PLACES.find((p) => p.id === "lab")).shot, null, "the real lab is not shown live");
});

test("between: from one shot to another, the direction the short way round, the distance by its logarithm", () => {
  const a = { target: [0, 0], distance_mm: 500, yaw_deg: 350, pitch_deg: 10 }, b = { target: [1000, 200], distance_mm: 2000, yaw_deg: 10, pitch_deg: 30 };
  const start = between(a, b, 0);
  assert.deepEqual([start.target, start.yaw_deg, start.pitch_deg], [[0, 0], 350, 10]);
  assert.ok(Math.abs(start.distance_mm - 500) < 1e-6);
  const end = between(a, b, 1);
  assert.deepEqual(end.target, [1000, 200]);
  assert.ok(Math.abs(end.distance_mm - 2000) < 1e-6);
  assert.equal(end.yaw_deg, 370, "20° on, not 340° back");
  const mid = between(a, b, 0.5);
  assert.deepEqual(mid.target, [500, 100]);
  assert.ok(Math.abs(mid.distance_mm - 1000) < 1e-6, "half way of a zoom is the geometric mean");
  assert.equal(mid.yaw_deg, 360);
  assert.equal(mid.pitch_deg, 20);
  assert.deepEqual(between(a, b, -1), start);
  assert.deepEqual(between(a, b, 7).target, [1000, 200]);
});

test("seenFrom: a square on the ground from behind the camera to several distances ahead", () => {
  const far = seenFrom({ target: [0, 0], distance_mm: 1000, yaw_deg: 0 }), r = SEEN.near * 1000;
  assert.deepEqual(far.map(Math.round), [r / 2 - r, -r, r / 2 + r, r]);
  const close = seenFrom({ target: [100, 100], distance_mm: 10, yaw_deg: 90 });
  assert.equal(Math.round(close[2] - close[0]), 2 * SEEN.min_mm, "never smaller than the least");
  assert.ok(close[3] - 100 > 100 - close[1], "more ahead than behind");
});
