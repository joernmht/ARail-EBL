// The live page (web/live/): the layout reduced to the town and its road traffic, the town's picture
// fitted to new poses (exact for a camera that only turns, drawn again when it moves too far, cut
// at the horizon), its CSS transform, the buildings drawn again where they may hide a car, the demo's
// visitor, and World.draw drawing a part of the world.
import assert from "node:assert/strict";
import test from "node:test";

import { Camera, FlyCamera, View, applyH, toRad } from "../../web/arail/index.js";
import { CityCache, citySamples, cssMatrix, horizon, pictureSize, planeHomographyOf, projectPoint } from "../../web/live/cache.js";
import { CITY_TYPES, createLiveWorld, cutOut, liveLayout, liveRegistry, occluders, Visitor } from "../../web/live/scene.js";
import { readJSON } from "./helpers.js";

const NEUSTADT = readJSON("web/layouts/ebl-neustadt.json");
const W = 1280, H = 720;

/** The pose and intrinsics of a flyover camera for an image of W × H. */
function shot(cam) {
  const { H: Hm, pose, focal } = cam.homography(W, H);
  return { H: Hm, pose, K: { fx: focal, fy: focal, cx: W / 2, cy: H / 2 } };
}

/** A camera at `eye` (layout mm) looking in the direction yaw, pitch (radians). */
function headAt(eye, yaw, pitch) {
  const distance = eye[2] / Math.sin(pitch), ahead = distance * Math.cos(pitch);
  return new FlyCamera({ target: [eye[0] + ahead * Math.cos(yaw), eye[1] + ahead * Math.sin(yaw)], distance, yaw, pitch });
}

/** A canvas context that draws nothing and counts fills and strokes. */
function countingContext() {
  const counts = { fill: 0, stroke: 0 };
  const target = { canvas: { width: W, height: H }, counts };
  const ctx = new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      if (key === "fill" || key === "stroke") return () => counts[key]++;
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
  return ctx;
}

/** A View of a flyover camera on a counting context. */
function viewOf(world, cam, ctx = countingContext()) {
  const s = shot(cam), camera = new Camera(W, H);
  camera.setManualFocal(s.K.fx);
  return new View({ ctx, camera, H: s.H, scale: world.scale, pose: s.pose, time: world.time });
}

test("the layout reduced to its town and road traffic: city objects of the base, the layout's traffic settings", () => {
  const json = liveLayout(NEUSTADT);
  assert.ok(json.objects.length > 100 && json.objects.length < NEUSTADT.objects.length);
  assert.ok(json.objects.every((o) => CITY_TYPES.has(o.type)), "only the town's types");
  for (const type of ["platform", "bus-stop", "tram-line", "gantry-crane", "container-yard"]) assert.ok(!json.objects.some((o) => o.type === type), `no ${type}`);
  assert.equal(json.layers, undefined, "no modules");
  assert.deepEqual(json.simulations, [{ type: "traffic", cars_per_km: 18 }], "the layout's own traffic settings");
  assert.deepEqual(liveLayout(NEUSTADT, { simulations: ["traffic", "cycling", "terminal"], cars: 60 }).simulations, [{ type: "traffic", cars_per_km: 60 }, { type: "cycling" }]);
  const registry = liveRegistry();
  assert.deepEqual([...registry.simulations.keys()].sort(), ["cycling", "traffic"], "only the live page's simulations");
  assert.ok(registry.objects.has("plattenbau") && registry.objects.has("road"));
});

test("the live world: cars drive through the town, without labels or the clock's lighting", () => {
  const world = createLiveWorld(NEUSTADT);
  assert.deepEqual(world.simulations.map((s) => s.constructor.type), ["traffic"]);
  assert.equal(world.settings.lighting, false);
  assert.equal(world.settings.labels, false);
  for (let i = 0; i < 300; i++) world.step(1 / 30);
  const traffic = world.simulations[0];
  assert.ok(traffic.cars.length > 5, `cars driving (${traffic.cars.length})`);
  assert.ok(traffic.cars.every((c) => Number.isFinite(c.s)), "no NaN");
});

test("World.draw draws a part of the world: the objects and what moves add up to all of it", () => {
  const world = createLiveWorld(NEUSTADT);
  for (let i = 0; i < 300; i++) world.step(1 / 30);
  const cam = new Visitor(world).at(0);
  const count = (options) => {
    const ctx = countingContext();
    world.draw(viewOf(world, cam, ctx), options);
    return ctx.counts.fill + ctx.counts.stroke;
  };
  const all = count(), town = count({ moving: false }), moving = count({ objects: [] });
  assert.ok(town > 0 && moving > 0, `both parts draw (${town}, ${moving})`);
  assert.equal(town + moving, all);
  const one = world.objects.find((o) => o.type === "plattenbau");
  assert.ok(count({ objects: [one], moving: false }) > 0, "a chosen object alone");
});

test("the town's picture: a camera that turns needs no new drawing, one that moves does", () => {
  const world = createLiveWorld(NEUSTADT);
  const cache = new CityCache({ maxError: 2 });
  cache.samples = citySamples(world);
  assert.ok(cache.samples.length > 100 && cache.samples.length <= 600);
  assert.ok(cache.samples.some((p) => p[2] > 100), "roofs among the samples");
  const v = new Visitor(world), eye = v.at(0).basis().eye;
  const a = shot(headAt(eye, Math.PI / 2, 0.5));
  assert.equal(cache.fit(a.pose, a.K, W, H, 0, "1").redraw, "first");
  cache.drawn({ pose: a.pose, K: a.K, width: W, height: H, size: cache.picture(W, H), time: 0, version: "1" });
  // the same pose: the identity
  const same = cache.fit(a.pose, a.K, W, H, 0.1, "1");
  assert.equal(same.redraw, "");
  assert.ok(same.error < 1e-6 && Math.abs(same.zoom - 1) < 1e-6);
  // turned by 4° and tilted by 2°: exact, every plane gives the same warp
  const turned = shot(headAt(eye, Math.PI / 2 + toRad(4), 0.5 + toRad(2)));
  const t = cache.fit(turned.pose, turned.K, W, H, 0.2, "1");
  assert.equal(t.redraw, "");
  assert.ok(t.error < 0.01, `turning fits exactly (${t.error})`);
  // the warp takes a point of the town from where the picture has it to where the camera sees it now
  const p = cache.samples.find((q) => q[2] > 100 && projectPoint(turned.pose, turned.K, q));
  const size = cache.ref.size, before = projectPoint(a.pose, a.K, p);
  const inPicture = [(before[0] + size.mx) * size.res, (before[1] + size.my) * size.res];
  const now = projectPoint(turned.pose, turned.K, p), warped = applyH(t.M, inPicture);
  assert.ok(Math.hypot(warped[0] - now[0], warped[1] - now[1]) < 0.01);
  // a step of 15 cm aside: the roofs shift against the ground
  const moved = shot(headAt([eye[0] + 150, eye[1], eye[2]], Math.PI / 2, 0.5));
  const m = cache.fit(moved.pose, moved.K, W, H, 0.3, "1");
  assert.equal(m.redraw, "error");
  assert.ok(m.error > 2);
  // a small sway of 1 mm is within the error
  const sway = shot(headAt([eye[0] + 1, eye[1], eye[2]], Math.PI / 2, 0.5));
  assert.equal(cache.fit(sway.pose, sway.K, W, H, 0.4, "1").redraw, "");
  // turned far: the image leaves the picture; the town changed; after a while
  const far = shot(headAt(eye, Math.PI / 2 + toRad(30), 0.5));
  assert.equal(cache.fit(far.pose, far.K, W, H, 0.5, "1").redraw, "edge");
  assert.equal(cache.fit(a.pose, a.K, W, H, 0.6, "2").redraw, "changed");
  assert.equal(cache.fit(a.pose, a.K, W, H, 60, "1").redraw, "refresh");
  assert.equal(cache.fit(a.pose, a.K, 640, 360, 0.7, "1").redraw, "size");
});

test("the sky needs no picture: only the image below the horizon must lie in it", () => {
  const world = createLiveWorld(NEUSTADT);
  const cache = new CityCache({ margin: 0.05 }); // 36 px above and below: 2.4°
  cache.samples = citySamples(world);
  const v = new Visitor(world), eye = v.at(0).basis().eye;
  // looking across the table: the horizon is in the image
  const across = shot(headAt(eye, Math.PI / 2, toRad(16)));
  const l = horizon(across.pose, across.K);
  assert.ok(Math.abs(Math.hypot(l[0], l[1]) - 1) < 1e-9);
  const ground = projectPoint(across.pose, across.K, [eye[0], eye[1] + 3000, 0]);
  assert.ok(l[0] * ground[0] + l[1] * ground[1] + l[2] < 0, "the ground is on the negative side");
  const hv = -(l[0] * (W / 2) + l[2]) / l[1];
  assert.ok(hv > 0 && hv < H / 4, `the horizon at ${hv} px`);
  cache.drawn({ pose: across.pose, K: across.K, width: W, height: H, size: cache.picture(W, H), time: 0 });
  // looking up by 4°: the image's upper part lies beyond the picture, but it shows only the sky
  const up = shot(headAt(eye, Math.PI / 2, toRad(12)));
  const fit = cache.fit(up.pose, up.K, W, H, 0.1);
  assert.equal(fit.redraw, "");
  assert.ok(fit.error < 0.01);
  // looking down by 4°: the town at the bottom is missing from the picture
  const down = shot(headAt(eye, Math.PI / 2, toRad(20)));
  assert.equal(cache.fit(down.pose, down.K, W, H, 0.2).redraw, "edge");
  assert.deepEqual(cache.picture(W, H), pictureSize(W, H, 1, 0.05));
});

test("the CSS matrix3d of a warp maps the picture like the homography", () => {
  assert.equal(cssMatrix([1, 0, 0, 0, 1, 0, 0, 0, 1]), "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)");
  const M = [1.02, 0.01, -250, -0.02, 0.98, -140, 1e-5, -2e-5, 1];
  const css = cssMatrix(M, 0.5).match(/matrix3d\((.*)\)/)[1].split(",").map(Number);
  // column-major 4×4 applied to (x, y, 0, 1)
  const at = ([x, y]) => {
    const X = css[0] * x + css[4] * y + css[12], Y = css[1] * x + css[5] * y + css[13], Wh = css[3] * x + css[7] * y + css[15];
    return [X / Wh, Y / Wh];
  };
  for (const p of [[0, 0], [1500, 0], [700, 900]]) {
    const want = applyH(M, p).map((v) => v * 0.5), got = at(p);
    assert.ok(Math.hypot(want[0] - got[0], want[1] - got[1]) < 1e-3, `${p}: ${got} ≠ ${want}`);
  }
  // the homography of the layout plane is the flyover's
  const cam = new FlyCamera({ target: [100, 50], distance: 900, yaw: 1, pitch: 0.7 });
  const s = shot(cam), Hp = planeHomographyOf(s.pose, s.K);
  const a = applyH(Hp, [120, 80]), b = applyH(s.H, [120, 80]);
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6);
});

test("buildings that may hide a car are cut out of what moves, in depth order; those behind it are not", () => {
  const layout = {
    format: "arail-layout/1", scale: 87,
    objects: [
      { id: "near", type: "building", position: [0, 0], width_m: 20, depth_m: 10, floors: 5 },
      { id: "far", type: "building", position: [0, 600], width_m: 20, depth_m: 10, floors: 5 },
    ],
  };
  const world = createLiveWorld(layout, { simulations: [] });
  // looking along +y from in front of "near": a car between the buildings is behind "near" and in front of "far"
  const view = viewOf(world, new FlyCamera({ target: [0, 300], distance: 1200, yaw: Math.PI / 2, pitch: toRad(20) }));
  const car = { key: "car:1", kind: "car", label: "Car", outline: [[-20, 290], [20, 290], [20, 310], [-20, 310]], z0: 0, z1: 17 };
  world.simulations.push({ pickables: () => [car], draw() {}, step() {} });
  const list = occluders(world, view);
  assert.deepEqual(list.map((o) => o.object.id), ["near"]);
  assert.ok(list[0].hull.length >= 4 && list[0].depth < view.depth(0, 300, 0), "its outline, nearer than the car");
  // queued as a solid that erases what was drawn before it (what is behind it)
  const ops = [];
  view.ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ops.push(k)), set: (t, k, v) => ((t[k] = v), ops.push(`${k}=${v}`), true) });
  cutOut(view, list);
  assert.equal(view.items.length, 1);
  view.render();
  assert.ok(ops.includes("globalCompositeOperation=destination-out") && ops.includes("fill"));
  car.outline = car.outline.map(([x, y]) => [x + 2000, y]); // far to the side: nothing in front of it
  assert.deepEqual(occluders(world, view), []);
});

test("the demo's visitor looks at the town from in front of it", () => {
  const world = createLiveWorld(NEUSTADT);
  const v = new Visitor(world);
  assert.ok(v.radius > 300);
  for (const t of [0, 5, 14, 29]) {
    const s = shot(v.at(t)), c = projectPoint(s.pose, s.K, [...v.centre, 0]);
    assert.ok(c && c[0] > 0 && c[0] < W && c[1] > 0 && c[1] < H, `the town's middle in the image at ${t} s`);
  }
});
