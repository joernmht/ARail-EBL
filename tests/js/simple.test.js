// The simple view (core/simple.js): objects flat, what moves as plain blocks.
import assert from "node:assert/strict";
import test from "node:test";

import { Camera, FlyCamera, LAYER, SimpleView, View, convexHull, createWorld, prismFaces, toRad } from "../../web/arail/index.js";
import { readJSON } from "./helpers.js";

const W = 1280, H = 720;

/** A canvas context that draws nothing. */
function nullContext() {
  return new Proxy({ canvas: { width: W, height: H } }, {
    get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {}, width: 10 })),
    set: (t, k, v) => ((t[k] = v), true),
  });
}

/** A view of the layout around (0, 0) from a tilted virtual camera. */
function makeView(Cls, { pitch = 50, distance = 1500 } = {}) {
  const cam = new FlyCamera({ target: [0, 0], distance, yaw: toRad(20), pitch: toRad(pitch) });
  const pose = cam.homography(W, H);
  const camera = new Camera(W, H);
  camera.setManualFocal(pose.focal);
  return new Cls({ ctx: nullContext(), camera, H: pose.H, pose: pose.pose, scale: 87, virtual: true });
}

test("convex hull: counter-clockwise, inner points dropped", () => {
  const hull = convexHull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5], [5, 0]]);
  assert.equal(hull.length, 4);
  let area = 0;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i], q = hull[(i + 1) % hull.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  assert.equal(area / 2, 100);
});

test("simple view: a detailed shape becomes one block, flat while static things are drawn", () => {
  const view = makeView(SimpleView);
  // a box with decals (windows) and a second part on top: one solid item
  const faces = prismFaces([[-50, -10], [50, -10], [50, 10], [-50, 10]], 5, 40, { side: "#0a777f", top: "#ffffff" });
  faces[0].decals = [{ pts: faces[0].pts, color: "#ffe2a0", emissive: true }];
  const roof = prismFaces([[-20, -5], [20, -5], [20, 5], [-20, 5]], 40, 60, { side: "#333333" });
  view.flat = false;
  view.faces([...faces, ...roof], [0, 0, 20]);
  assert.equal(view.items.length, 1);
  assert.equal(view.items[0].layer, LAYER.solid);
  view.items = [];
  // static: a flat polygon on the ground
  view.flat = true;
  view.faces(faces, [0, 0, 20]);
  assert.equal(view.items.length, 1);
  assert.equal(view.items[0].layer, LAYER.ground);
  // no lights; always by day
  view.items = [];
  view.glow([0, 0, 10], 20);
  view.lightPool([0, 0], 20);
  assert.equal(view.items.length, 0);
  assert.equal(view.darkness, 0);
});

test("simple view of the lab: objects are flat, people and vehicles are blocks", () => {
  const world = createWorld(readJSON("web/layouts/ebl-lab.json"));
  world.setTime("07:30");
  for (let i = 0; i < 300; i++) world.step(0.1);
  // the full drawing of objects is not used
  const drawn = new Set();
  for (const o of world.objects) {
    const draw = o.draw.bind(o);
    o.draw = (v) => {
      drawn.add(o.type);
      return draw(v);
    };
  }
  const view = makeView(SimpleView, { pitch: 60, distance: 3000 });
  const solids = [];
  const add = view.add.bind(view);
  view.add = (layer, key, draw) => {
    if (layer === LAYER.solid) solids.push(key);
    return add(layer, key, draw);
  };
  const flat = [];
  const objectsDone = new Set();
  const polygon = view.polygon.bind(view);
  view.polygon = (pts, style) => {
    if (view.flat && !objectsDone.size) flat.push(style);
    return polygon(pts, style);
  };
  const servicesDraw = world.services.draw.bind(world.services);
  world.services.draw = (v) => {
    objectsDone.add(true);
    return servicesDraw(v);
  };
  world.draw(view);
  // bus lines and labels draw their own (flat) simple form; no other object draws in full
  assert.deepEqual([...drawn].filter((t) => t !== "bus-line" && t !== "label"), []);
  assert.ok(flat.length >= world.objects.filter((o) => o.geometry && o.footprint()).length * 0.9, "every object drawn flat");
  assert.ok(solids.length > 10, `moving things as blocks (${solids.length})`);
  assert.equal(view.flat, true);
  // and the full view draws many more pieces
  const full = makeView(View, { pitch: 60, distance: 3000 });
  let n = 0;
  const addFull = full.add.bind(full);
  full.add = (...a) => {
    n++;
    return addFull(...a);
  };
  world.draw(full);
  assert.ok(n > solids.length + flat.length, `the full view draws more (${n})`);
});
