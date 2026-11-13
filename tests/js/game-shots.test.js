// The camera positions of the game's virtual pictures (web/game/shots.js), and the camera's way between them; and
// that the game's pictures carry no information boxes: the live backdrop draws no labels, no place is the AR screenshot.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { BACKDROPS, PLACES, backdropAt, wideOf } from "../../web/game/places.js";
import { View } from "../../web/arail/index.js";
import { LiveScene } from "../../web/game/live.js";
import { SignallerGame } from "../../web/arail/game/signaller.js";
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

/** A canvas that draws nothing, as large as a window. */
function blankCanvas() {
  const ctx = new Proxy({}, {
    get(t, key) {
      if (key in t) return t[key];
      if (key === "measureText") return (text) => ({ width: 6 * String(text).length });
      if (key === "createRadialGradient" || key === "createLinearGradient") return () => ({ addColorStop() {} });
      if (key === "getLineDash") return () => [];
      return () => {};
    },
    set: (t, key, value) => ((t[key] = value), true),
  });
  const canvas = { width: 1280, height: 720, clientWidth: 1280, clientHeight: 720, getContext: () => ctx, addEventListener() {} };
  ctx.canvas = canvas;
  return canvas;
}

test("the game's pictures carry no information boxes: the live backdrop draws no labels from any shot", async (t) => {
  const fetched = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(readFileSync(`web/${url}`, "utf8")) });
  // every label asked for, and how many of them were drawn (put on the view to be drawn)
  const label = View.prototype.label, asked = [];
  View.prototype.label = function (at, text, style) {
    const before = this.items.length;
    label.call(this, at, text, style);
    asked.push({ text: [text].flat().join(" "), drawn: this.items.length - before });
  };
  t.after(() => {
    View.prototype.label = label;
    globalThis.fetch = fetched;
  });
  for (const layout of new Set(SHOTS.map((s) => s.layout))) {
    const scene = new LiveScene(blankCanvas());
    assert.ok(await scene.load(layout, layout), layout);
    for (const shot of SHOTS.filter((s) => s.layout === layout)) {
      scene.look(shot);
      for (let i = 0; i < 40; i++) scene.world.step(0.25);
      scene.draw(1e9);
    }
  }
  // the table, the signaller's game on the layout (web/game/table.js): no labels either, of the world or of the game
  const scene = new LiveScene(blankCanvas());
  await scene.load("layouts/ebl-neustadt.json", "layouts/ebl-neustadt.json");
  const game = new SignallerGame({ seed: 3, level: "training" }), player = new SignallerGame.player();
  assert.equal(scene.setTable(game, { active: true }), true);
  for (let i = 0; i < 400; i++) {
    player.think(game);
    game.step(1);
    scene.world.step(0.25);
    if (i % 50 === 0) scene.draw(1e9 + i);
  }
  // the world would have labelled its trains, stops and stacks: asked for, none drawn
  assert.ok(asked.length > 10, `${asked.length} labels asked for`);
  assert.deepEqual(asked.filter((a) => a.drawn).map((a) => a.text), []);
  // a view of the app still draws them
  const view = new View({ ctx: blankCanvas().getContext(), camera: { width: 100, height: 100, project: () => [50, 50], intrinsics: { fx: 1, fy: 1, cx: 0, cy: 0 } }, H: [1, 0, 0, 0, 1, 0, 0, 0, 1], scale: 87, pose: { a1: [1, 0, 0], a2: [0, 1, 0], a3: [0, 0, 1000], n: [0, 0, 1] } });
  view.label([0, 0, 0], "RB 31");
  assert.equal(asked.at(-1).drawn, 1);
});

test("the game's pictures carry no information boxes: no place or backdrop is the AR screenshot with its labels", () => {
  for (const p of [...PLACES, ...BACKDROPS]) {
    for (const pic of [p.photo, p.wide].filter(Boolean)) assert.doesNotMatch(pic, /-ar\.jpg$/, `${p.id}: ${pic}`);
  }
});
