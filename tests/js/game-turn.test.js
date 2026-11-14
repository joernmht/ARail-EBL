// A slow role's turn on the table (web/game/turn.js): the scenes the slow games give of their
// world, the board that draws them on the layout of Bf Neustadt without a word, and what an open
// decision is about, which can be clicked there.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Camera, FlyCamera, View, createWorld } from "../../web/arail/index.js";
import { AssetManagerGame } from "../../web/arail/game/asset-manager.js";
import { BudgetGame } from "../../web/arail/game/budget.js";
import { ContractGame } from "../../web/arail/game/contract-manager.js";
import { play } from "../../web/arail/game/index.js";
import { BOARDS, LiveScene, TABLE_VIEW } from "../../web/game/live.js";
import { TABLE_LAYOUT } from "../../web/game/table.js";
import { HIT_PX, PLACES, THINGS, TurnBoard, gradeColour, sceneProblems } from "../../web/game/turn.js";

const NEUSTADT = JSON.parse(readFileSync(new URL(`../../web/${TABLE_LAYOUT}`, import.meta.url), "utf8"));
const MISSIONS = new URL("../../web/game/missions/", import.meta.url);
const mission = (id) => JSON.parse(readFileSync(new URL(`${id}.json`, MISSIONS), "utf8"));
const W = 1280, H = 800;

/** A canvas context that draws nothing and counts what is filled and written. */
function countingContext() {
  const counts = { fill: 0, stroke: 0, text: [] };
  return new Proxy({ canvas: { width: W, height: H }, counts }, {
    get(t, key) {
      if (key in t) return t[key];
      if (key === "fill" || key === "stroke") return () => counts[key]++;
      if (key === "fillText" || key === "strokeText") return (s) => counts.text.push(String(s));
      if (key === "measureText") return (s) => ({ width: 6 * String(s).length });
      if (key === "createRadialGradient" || key === "createLinearGradient") return () => ({ addColorStop() {} });
      if (key === "getLineDash") return () => [];
      return () => {};
    },
    set(t, key, value) {
      t[key] = value;
      return true;
    },
  });
}

function viewOf(world, bounds, ctx = countingContext()) {
  const cam = new FlyCamera({ yaw: (270 * Math.PI) / 180, pitch: (48 * Math.PI) / 180 }).fit(bounds, W / H, 0.03);
  const pose = cam.homography(W, H), camera = new Camera(W, H);
  camera.setManualFocal(pose.focal);
  return new View({ ctx, camera, H: pose.H, pose: pose.pose, scale: world.scale, time: world.time, virtual: true, pulse: 1 });
}

function boardOf(game) {
  const world = createWorld(structuredClone(NEUSTADT), { seed: 1 });
  world.setLayers(TABLE_VIEW.layers);
  const board = new TurnBoard(world);
  board.show(game);
  return { world, board };
}

/** What a board draws of a scene: how much is filled, and what is written. */
function drawn(board, world, part = "all") {
  const ctx = countingContext(), view = viewOf(world, board.bounds(part), ctx);
  board.draw(view);
  view.render();
  return ctx.counts;
}

test("the slow games give a scene of their world: things the table knows, at places it has, in every phase of their missions", () => {
  assert.deepEqual(sceneProblems([{ thing: "condition", grade: 3 }, { thing: "ask", id: "x", at: "base" }]), []);
  assert.match(sceneProblems([{ thing: "weather" }])[0], /a thing the table does not know: weather/);
  assert.match(sceneProblems([{ thing: "ask", id: "x", at: "moon" }])[0], /a place the table does not have: moon/);
  for (const G of [AssetManagerGame, ContractGame, BudgetGame]) assert.equal(BOARDS[G.id], TurnBoard, G.id);
  // played by the computer through their missions: every scene on the way is sound, and every open decision is asked somewhere
  for (const id of ["budget-years", "malus-month", "night-session", "neustadt-years"]) {
    // (people on every seat: the session waits at each turn, and a turn that is ended takes the fallbacks)
    const m = mission(id), s = play(m, { seed: 1, seats: Object.fromEntries(m.roles.map((r) => [r.id ?? r.role, "human"])) }).start();
    const seen = new Set();
    for (let i = 0; i < 4000 && !s.over; i++) {
      if (s.phase.kind === "shift") {
        s.step(120);
        continue;
      }
      for (const seat of s.active) {
        if (BOARDS[seat.Game.id] !== TurnBoard) continue;
        const scene = seat.game.view().scene;
        assert.deepEqual(sceneProblems(scene), [], `${id}, ${seat.id}`);
        assert.deepEqual(scene.filter((x) => x.thing === "ask").map((x) => x.id).sort(), seat.game.open.map((d) => d.id).sort(), `${id}, ${seat.id}: every open decision is asked on the table`);
        for (const x of scene) seen.add(x.thing);
      }
      s.next();
    }
    assert.ok(s.over, `${id} is played to its end`);
    assert.ok(seen.size >= 2, `${id}: ${[...seen]}`);
  }
});

test("the asset manager's year: the condition, the staff plan, the renewals and the restrictions are its scene, and they follow what is decided", () => {
  const g = new AssetManagerGame({ seed: 1, level: "normal" });
  g.begin({ round: 1, rounds: 3, phase: { id: "plan", kind: "turn" } });
  const thing = (name) => g.view().scene.find((x) => x.thing === name), asks = () => g.view().scene.filter((x) => x.thing === "ask").map((x) => [x.id, x.at]);
  assert.deepEqual(thing("condition"), { thing: "condition", grade: 3, target: 3.2 });
  assert.deepEqual(thing("teams"), { thing: "teams", n: 2, on_call: true });
  assert.deepEqual(asks().slice(0, 4), [["strategy", "tracks"], ["renewals", "works"], ["teams", "base"], ["on-call", "base"]]);
  assert.equal(thing("faults"), undefined, "no year is settled yet");
  // decided, a thing changes and its question is gone from the table
  g.act("decide", "teams", "3");
  g.act("decide", "on-call", "no");
  g.act("decide", "renewals", "little");
  assert.deepEqual(thing("teams"), { thing: "teams", n: 3, on_call: false });
  assert.equal(thing("works").n, 1);
  assert.ok(!asks().some(([id]) => ["teams", "on-call", "renewals"].includes(id)));
  g.act("decide", "renewals", "all");
  assert.equal(thing("works").n, 1, "a decision is taken once");
  // the year's account: its faults flash at the assets from then on
  g.finish({ round: 1, rounds: 3, phase: { id: "plan", kind: "turn" } });
  g.begin({ round: 1, rounds: 3, phase: { id: "review", kind: "turn" } });
  g.finish({ round: 1, rounds: 3, phase: { id: "review", kind: "turn" } });
  assert.ok(thing("faults").n > 100, JSON.stringify(thing("faults")));
});

test("the board: it draws a scene thing by thing without a word; what a decision is about is found where it is, and a click there names the decision", () => {
  const g = new AssetManagerGame({ seed: 1, level: "normal" });
  g.begin({ round: 1, rounds: 3, phase: { id: "plan", kind: "turn" } });
  const { world, board } = boardOf(g);
  const all = drawn(board, world);
  assert.ok(all.fill > 40, String(all.fill));
  assert.deepEqual(all.text, []);
  // each thing adds to the picture
  const only = (scene) => drawn(boardOf({ view: () => ({ scene }) }).board, world).fill;
  assert.equal(only([]), 0);
  const fills = Object.fromEntries([
    ["condition", [{ thing: "condition", grade: 4.4 }]], ["teams", [{ thing: "teams", n: 2, on_call: true }]], ["works", [{ thing: "works", n: 2 }]], ["restrictions", [{ thing: "restrictions", n: 3 }]],
    ["faults", [{ thing: "faults", n: 300 }]], ["tally", [{ thing: "tally", at: "platform", parts: [{ tone: "ok", n: 17 }, { tone: "warn", n: 2 }, { tone: "bad", n: 1 }] }]], ["project", [{ thing: "project", stages: 4, built: 2 }]], ["ask", [{ thing: "ask", id: "x", at: "station" }]],
  ].map(([name, scene]) => [name, only(scene)]));
  assert.deepEqual(Object.keys(fills), THINGS);
  for (const [name, n] of Object.entries(fills)) assert.ok(n > 0, `${name} is drawn`);
  assert.ok(only([{ thing: "works", n: 3 }]) > fills.works && only([{ thing: "tally", at: "platform", parts: [{ tone: "ok", n: 5 }] }]) < fills.tally);
  // a thing the board does not know, a place it has not, a game whose view fails: nothing, and no error
  assert.equal(only([{ thing: "weather" }, { thing: "ask", id: "x", at: "moon" }]), 0);
  assert.equal(drawn(boardOf({ view: () => { throw new Error("no view"); } }).board, world).fill, 0);
  // the questions: two at the base stand side by side; a click names the decision, and the one in focus is chosen
  const asks = board.asks();
  assert.deepEqual(asks.map((a) => a.id), g.open.map((d) => d.id));
  const [teams, onCall] = [asks.find((a) => a.id === "teams"), asks.find((a) => a.id === "on-call")];
  assert.deepEqual(teams.at, PLACES.base);
  assert.deepEqual(onCall.at, [PLACES.base[0] + 150, PLACES.base[1]]);
  const view = viewOf(world, board.bounds("all")), px = (p) => view.project(p[0], p[1], 0);
  assert.deepEqual(board.hit(view, px(teams.at)), { ask: "teams" });
  assert.deepEqual(board.hit(view, px(PLACES.tracks).map((v, i) => v + (i ? HIT_PX.ask - 4 : 0))), { ask: "strategy" });
  assert.equal(board.hit(view, px([6000, 700])), null);
  assert.deepEqual(board.placeOf("ask-renewals"), PLACES.works);
  assert.equal(board.placeOf("ask-none"), null);
  assert.deepEqual([board.partOf(PLACES.base), board.partOf(PLACES.tracks), board.partOf(PLACES.asset)], ["west", "platforms", "east"]);
  // every place is where the table's camera may look, and in the picture of the whole
  const a = TABLE_VIEW.area;
  for (const [name, p] of Object.entries(PLACES)) {
    assert.ok(p[0] > a[0] && p[0] < a[2] && p[1] > a[1] && p[1] < a[3], name);
    const q = px(p);
    assert.ok(q && q[0] > 0 && q[0] < W && q[1] > 0 && q[1] < H, `${name} in the picture`);
  }
  // the colours of the condition: from good to bad
  assert.deepEqual([gradeColour(1.5), gradeColour(3), gradeColour(6)].map((c) => typeof c), ["string", "string", "string"]);
  assert.notEqual(gradeColour(2), gradeColour(4.5));
});

test("a turn in the live picture: the game's board is on the table with the decision in focus, and two slow games of one turn share it", async (t) => {
  const fetched = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(readFileSync(`web/${url}`, "utf8")) });
  t.after(() => (globalThis.fetch = fetched));
  const ctx = countingContext(), canvas = { width: W, height: H, clientWidth: W, clientHeight: H, getContext: () => ctx, addEventListener() {}, dispatchEvent() {} };
  const scene = new LiveScene(canvas);
  assert.ok(await scene.load(TABLE_LAYOUT, TABLE_LAYOUT));
  const am = new AssetManagerGame({ seed: 1 }), cm = new ContractGame({ seed: 1 });
  am.begin({ round: 1, rounds: 3, phase: { id: "plan", kind: "turn" } });
  assert.equal(scene.setTable(am, { active: true, picked: "ask-teams", others: [cm] }), true);
  assert.ok(scene.board instanceof TurnBoard);
  assert.deepEqual([scene.board.game, scene.board.picked, scene.boards.get("contract").game, scene.boards.get("contract").active], [am, "ask-teams", cm, false]);
  assert.equal(scene.boards.size, 2);
  scene.draw(1e9);
  assert.ok(ctx.counts.fill > 40);
  assert.equal(scene.setTable(null), false);
  assert.ok(!scene.world.simulations.some((s) => s instanceof TurnBoard));
});
