// Drawing performance without visible change: drawings outside the image are not queued, runs of
// the view's own ("plain") drawings share one save/restore, and the crowd's social forces skip
// pairs that are far apart. Each is checked against the plain, slow way of doing it.
import assert from "node:assert/strict";
import test from "node:test";

import { Camera, FlyCamera, View, createRng, createWorld, drawTree, prismFaces, rgba, toRad } from "../../web/arail/index.js";
import { crowdForces } from "../../web/arail/sims/passengers.js";
import { readJSON } from "./helpers.js";

const W = 1280, H = 720;

/** A recorded canvas gradient (compared by its numbers and colour stops). */
class Gradient {
  constructor(a) {
    this.a = a;
    this.stops = [];
  }

  addColorStop(offset, colour) {
    this.stops.push([offset, colour]);
  }
}

/**
 * A canvas context that keeps a real state stack (save/restore) and records every fill and stroke
 * with the state and path it is drawn with.
 */
function stateContext(width = W, height = H) {
  const ops = [];
  let saves = 0, depth = 0, path = [];
  const KEYS = ["fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin", "globalAlpha", "globalCompositeOperation", "font", "textAlign", "textBaseline"];
  const base = {
    fillStyle: "#000000", strokeStyle: "#000000", lineWidth: 1, lineCap: "butt", lineJoin: "miter", globalAlpha: 1,
    globalCompositeOperation: "source-over", font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic",
  };
  const stack = [];
  const ctx = {
    canvas: { width, height },
    ...base,
    dash: [],
    transform: [1, 0, 0, 1, 0, 0],
    save() {
      saves++;
      depth++;
      stack.push({ ...Object.fromEntries(KEYS.map((k) => [k, this[k]])), dash: this.dash, transform: this.transform });
    },
    restore() {
      depth--;
      Object.assign(this, stack.pop());
    },
    setLineDash(d) {
      this.dash = d.slice();
    },
    getLineDash() {
      return this.dash.slice();
    },
    setTransform(...m) {
      this.transform = m;
    },
    beginPath() {
      path = [];
    },
    moveTo(x, y) {
      path.push({ pts: [[x, y]], closed: false, curve: false });
    },
    lineTo(x, y) {
      if (!path.length) path.push({ pts: [], closed: false, curve: false });
      path.at(-1).pts.push([x, y]);
    },
    closePath() {
      if (path.length) path.at(-1).closed = true;
    },
    arc(x, y, r, a0, a1) {
      path.push({ pts: [[x, y, r, a0, a1]], closed: false, curve: true });
    },
    ellipse(x, y, rx, ry, rot, a0, a1) {
      path.push({ pts: [[x, y, rx, ry, rot, a0, a1]], closed: false, curve: true });
    },
    arcTo(...a) {
      if (!path.length) path.push({ pts: [], closed: false, curve: true });
      path.at(-1).pts.push(a);
    },
    rect(...a) {
      path.push({ pts: [a], closed: true, curve: false });
    },
    quadraticCurveTo(...a) {
      path.at(-1)?.pts.push(a);
    },
    fill() {
      ops.push({ op: "fill", path: structuredClone(path), fillStyle: this.fillStyle, globalAlpha: this.globalAlpha, composite: this.globalCompositeOperation, transform: this.transform });
    },
    stroke() {
      // caps and joins always count: a thin outline (under a pixel) gets its caps even on a closed path
      ops.push({
        op: "stroke", path: structuredClone(path), strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, globalAlpha: this.globalAlpha,
        composite: this.globalCompositeOperation, transform: this.transform, dash: this.dash, lineJoin: this.lineJoin, lineCap: this.lineCap,
      });
    },
    fillRect(...a) {
      ops.push({ op: "fillRect", a, fillStyle: this.fillStyle, globalAlpha: this.globalAlpha, composite: this.globalCompositeOperation, transform: this.transform });
    },
    fillText(text, x, y) {
      ops.push({ op: "fillText", text, x, y, fillStyle: this.fillStyle, font: this.font, align: this.textAlign, baseline: this.textBaseline, globalAlpha: this.globalAlpha });
    },
    strokeText(text, x, y) {
      ops.push({ op: "strokeText", text, x, y, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, font: this.font });
    },
    measureText: (t) => ({ width: String(t).length * 6 }),
    createRadialGradient: (...a) => new Gradient(a),
    createLinearGradient: (...a) => new Gradient(a),
    clip() {},
    drawImage() {},
  };
  return { ctx, ops, stats: () => ({ saves, depth }) };
}

/** A view looking straight down on the layout from 1 m (x to the right, y up the image). */
function topView(ctx, options = {}) {
  const camera = new Camera(W, H);
  const { fx, cx, cy } = camera.intrinsics, d = 1000;
  return new View({ ctx, camera, H: [fx, 0, cx * d, 0, -fx, cy * d, 0, 0, d], scale: 87, ...options });
}

/** Layout x (mm) seen at image column u in `topView`. */
function xAt(view, u) {
  return ((u - view.camera.intrinsics.cx) * 1000) / view.camera.intrinsics.fx;
}

/* ---------------------------------------------------------------- not queued outside the image */

test("polygons and lines entirely outside the image are not queued; anything reaching into it is", () => {
  const { ctx } = stateContext();
  const view = topView(ctx);
  const square = (u0, u1) => [[xAt(view, u0), -10], [xAt(view, u1), -10], [xAt(view, u1), 10], [xAt(view, u0), 10]];
  view.polygon(square(-300, -100), { fill: "#ff0000" });
  view.polygon(square(W + 100, W + 300), { fill: "#ff0000" });
  assert.equal(view.items.length, 0, "left and right of the image");
  view.polygon(square(-300, 2), { fill: "#ff0000" });
  assert.equal(view.items.length, 1, "one pixel inside");
  // a wide outline reaches further out than the points
  view.polygon(square(-300, -12), { fill: "#ff0000" });
  assert.equal(view.items.length, 1, "12 px outside, no outline");
  view.polygon(square(-300, -12), { fill: "#ff0000", stroke: "#000000", width: 10 });
  assert.equal(view.items.length, 2, "12 px outside, with a 10 px outline");
  // a line along the image edge, and a line whose pieces are all outside
  view.line([[xAt(view, -50), 0], [xAt(view, 50), 0]], { stroke: "#000000" });
  view.line([[xAt(view, -500), 0], [xAt(view, -50), 0]], { stroke: "#000000" });
  assert.equal(view.items.length, 3);
  // NaN points are left out, as the canvas ignores them
  assert.equal(view.offImage([[NaN, NaN], [-100, 5]]), true);
  assert.equal(view.offImage([[NaN, 5], [100, 5]]), false);
});

test("faces outside the image are left out, unless a decal reaches into it", () => {
  const { ctx } = stateContext();
  const view = topView(ctx);
  const x0 = xAt(view, -200), x1 = xAt(view, -100);
  const box = prismFaces([[x0, -20], [x1, -20], [x1, 20], [x0, 20]], 0, 30, { side: "#cccccc", top: "#eeeeee" });
  view.faces(box, [(x0 + x1) / 2, 0, 15]);
  assert.equal(view.items.length, 0, "the whole box is outside");
  // the top face with a decal (say, a sign) that sticks out into the image
  const top = box.at(-1);
  top.decals = [{ pts: [[x1, -5, 30], [xAt(view, 20), -5, 30], [xAt(view, 20), 5, 30], [x1, 5, 30]], color: "#ff0000" }];
  view.faces(box, [(x0 + x1) / 2, 0, 15]);
  assert.equal(view.items.length, 1);
  const rec = stateContext();
  view.ctx = rec.ctx;
  view.render();
  assert.deepEqual(rec.ops.map((o) => o.op), ["fill", "fill"], "the face and its decal");
});

test("lights and trees outside the image are not queued", () => {
  const { ctx } = stateContext();
  const view = topView(ctx, { night: 1 });
  const out = xAt(view, -400), inside = xAt(view, 300);
  view.glow([out, 0, 5], 5);
  view.lightPool([out, 0], 20);
  assert.equal(view.items.length, 0);
  view.glow([inside, 0, 5], 5);
  view.lightPool([inside, 0], 20);
  assert.equal(view.items.length, 2);
  view.items = [];
  // a tree far outside: no shadow, no trunk and crown; one just outside whose crown reaches in: drawn
  drawTree(view, [out, 0], 12);
  assert.equal(view.items.length, 0);
  const r = view.pxPerMM(xAt(view, 0), 0, view.m(7.2)) * view.m(12 * 0.3);
  drawTree(view, [xAt(view, -r / 2), 0], 12);
  assert.equal(view.items.filter((it) => it.layer === 1).length, 1, "trunk and crown");
});

/* ---------------------------------------------------------------- one save/restore for runs of plain drawings */

test("plain drawings share a save/restore; every other drawing still starts from the state before", () => {
  const { ctx, ops, stats } = stateContext();
  const view = topView(ctx, { opacity: 0.8 });
  const seen = [];
  const custom = (ctx) => {
    seen.push({ lineCap: ctx.lineCap, lineJoin: ctx.lineJoin, lineWidth: ctx.lineWidth, fillStyle: ctx.fillStyle, globalAlpha: ctx.globalAlpha, dash: ctx.getLineDash() });
    ctx.lineCap = "square";
    ctx.globalCompositeOperation = "lighter";
  };
  const sq = (x) => [[x, -5], [x + 10, -5], [x + 10, 5], [x, 5]];
  view.polygon(sq(0), { fill: "#ff0000", stroke: "#0000ff", width: 3, alpha: 0.5, order: 1 });
  view.polygon(sq(20), { fill: "#00ff00", alpha: 0.5, order: 2 });
  view.ground(3, custom);
  view.line([[0, 0], [30, 0]], { stroke: "#123456", dash: [4, 2], order: 4 });
  view.ground(5, custom);
  view.line([[0, 10], [30, 10]], { stroke: "#654321", order: 6 });
  view.render();
  const { saves, depth } = stats();
  assert.equal(depth, 0, "balanced");
  assert.equal(saves, 5, "the first two polygons share one save/restore, the dashed line has its own");
  const base = { lineCap: "butt", lineJoin: "miter", lineWidth: 1, fillStyle: "#000000", globalAlpha: 0.8, dash: [] };
  assert.deepEqual(seen, [base, base], "custom drawings see the state from before");
  const fills = ops.filter((o) => o.op === "fill");
  assert.deepEqual(fills.map((o) => o.globalAlpha), [0.4, 0.4], "the opacity is set anew for each drawing");
  const strokes = ops.filter((o) => o.op === "stroke");
  assert.deepEqual(strokes.map((o) => o.dash), [[], [4, 2], []]);
  assert.deepEqual(strokes.map((o) => o.composite), ["source-over", "source-over", "source-over"]);
  assert.equal(ctx.globalCompositeOperation, "source-over");
  assert.equal(ctx.lineCap, "butt");
});

/** Draw the EBL example's world at night, with people and buses, and record every drawing operation. */
function drawWorld(world, cam, { plain }) {
  const rec = stateContext();
  const camera = new Camera(W, H);
  const { H: hom, focal, pose } = cam.homography(W, H);
  camera.setManualFocal(focal);
  const view = new View({ ctx: rec.ctx, camera, H: hom, pose, scale: world.scale, night: 0.7, virtual: true, px: 2 });
  if (!plain) {
    const render = view.render.bind(view);
    view.render = () => {
      for (const it of view.items) it.plain = false;
      return render();
    };
  }
  world.draw(view);
  return { ...rec, items: view.seq };
}

test("a frame of the example town draws exactly the same with shared save/restores", (t) => {
  t.mock.method(console, "warn", () => {});
  const world = createWorld(readJSON("web/layouts/ebl-lab.json"));
  world.setTime("07:20");
  world.speed = 30;
  for (let i = 0; i < 60; i++) world.step(0.1); // crowds at the stops, buses and cars on the streets
  world.setTime("21:40"); // lit windows, street lamps
  for (let i = 0; i < 20; i++) world.step(0.1);
  world.paused = true;
  for (const cam of [
    new FlyCamera({ target: [700, -900], distance: 2600, yaw: Math.PI / 2, pitch: toRad(50) }), // the town and the station
    new FlyCamera({ target: [700, -1300], distance: 450, yaw: Math.PI / 2, pitch: toRad(25) }), // close-up: much is outside
  ]) {
    const fast = drawWorld(world, cam, { plain: true }), slow = drawWorld(world, cam, { plain: false });
    assert.ok(fast.ops.length > 500, `${fast.ops.length} drawing operations`);
    assert.equal(fast.ops.length, slow.ops.length);
    for (let i = 0; i < fast.ops.length; i++) assert.deepEqual(fast.ops[i], slow.ops[i], `operation ${i}`);
    assert.equal(fast.stats().depth, 0);
    assert.ok(fast.stats().saves < slow.stats().saves / 2, `${fast.stats().saves} instead of ${slow.stats().saves} saves`);
  }
});

test("faces are filled with the shaded colour, darkened at night unless they are lit", () => {
  const { ctx, ops } = stateContext();
  const view = topView(ctx, { night: 0.5 });
  const dim = (c, n) => c.map((v, i) => v * (1 - 0.62 * n) + [0, 20, 80][i] * 0.3 * n);
  const normal = [0.2, -0.3, 0.9];
  const k = view.light(normal);
  view.faces([{ pts: [[0, 0, 0], [10, 0, 0], [10, 10, 0]], normal, color: "#806040", alpha: 0.7, twoSided: true, decals: [{ pts: [[1, 1, 0], [2, 1, 0], [2, 2, 0]], color: "#ffd27a", emissive: true }] }], [5, 5, 0]);
  view.render();
  assert.deepEqual(ops.filter((o) => o.op === "fill").map((o) => o.fillStyle), [rgba(dim([128 * k, 96 * k, 64 * k], 0.5), 0.7), rgba([255, 210, 122], 0.7)]);
});

/* ---------------------------------------------------------------- crowd forces */

/** The social forces between all pairs, as computed before pairs far apart were skipped. */
function allPairs(people) {
  const n = people.length, R = 0.6;
  const neighbours = new Array(n).fill(0), push = people.map(() => [0, 0]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = people[i].pos[0] - people[j].pos[0], dy = people[i].pos[1] - people[j].pos[1];
      const d = Math.max(Math.hypot(dx, dy), 1e-6);
      if (d < 1.3) {
        neighbours[i]++;
        neighbours[j]++;
      }
      if (d < R) {
        const w = (((R - d) / R) * 1.4) / d;
        push[i][0] += dx * w;
        push[i][1] += dy * w;
        push[j][0] -= dx * w;
        push[j][1] -= dy * w;
      }
    }
  }
  return { neighbours, push };
}

test("crowd forces: the same numbers as for all pairs, also at the thresholds", () => {
  const rng = createRng(7);
  for (const [n, L, Wd] of [[0, 10, 3], [1, 10, 3], [40, 8, 2], [140, 120, 4], [140, 6, 2]]) {
    const people = Array.from({ length: n }, () => ({ pos: [rng.uniform(0, L), rng.uniform(-Wd / 2, Wd / 2)] }));
    assert.deepEqual(crowdForces(people), allPairs(people), `${n} people on ${L} x ${Wd} m`);
  }
  // exactly 1.3 m and 0.6 m apart, on the same spot, and just within the thresholds
  const edge = [[0, 0], [1.3, 0], [0, 1.3], [0, 0], [0.6, 0], [1.2999999, 0.0001], [-0.5999999, 0], [0.9192, 0.9192]].map((pos) => ({ pos }));
  assert.deepEqual(crowdForces(edge), allPairs(edge));
});

/* ---------------------------------------------------------------- colours at night */

test("dimmed colours are remembered per view and darkness, and stay right when the darkness changes", () => {
  const { ctx } = stateContext();
  const view = topView(ctx, { night: 0.5 });
  const fresh = (colour, night, amount = 1) => topView(stateContext().ctx, { night }).dim(colour, amount);
  const a = view.dim("#a0b0c0");
  assert.equal(a, fresh("#a0b0c0", 0.5));
  assert.equal(view.dim("#a0b0c0"), a, "again");
  assert.equal(view.dim("#a0b0c0", 0.5), fresh("#a0b0c0", 0.5, 0.5), "half as dark");
  assert.equal(view.dim("rgba(10,20,30,0.4)"), fresh("rgba(10,20,30,0.4)", 0.5));
  assert.equal(view.dim("not a colour"), "not a colour");
  // the night is set later (World.draw does that for views made without it)
  view.night = 0.9;
  assert.equal(view.dim("#a0b0c0"), fresh("#a0b0c0", 0.9));
  view.night = 0;
  assert.equal(view.dim("#a0b0c0"), "#a0b0c0", "by day colours are kept");
  view.night = 0.5;
  assert.equal(view.dim("#a0b0c0"), a);
  // colours given as arrays may change between calls: not remembered
  view.night = 0.8;
  const c = [200, 100, 50];
  const first = view.dim(c);
  c[0] = 0;
  assert.notEqual(view.dim(c), first);
  assert.equal(view.dim(c), fresh([0, 100, 50], 0.8));
  // a view used for many frames does not collect colours without end
  for (let i = 0; i < 10000; i++) view.dim(`rgb(${i % 256},${(i >> 8) % 256},7)`);
  assert.ok(view._dimmed.get(view.darkness).size <= 4097);
});
