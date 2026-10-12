// The flyover: the virtual orbit camera (projection, pose, navigation, fit, files), the layout
// grid, table modules and the default table, and drawing for a virtual camera (near-plane
// clipping, platform and track surfaces, trains of the control system).
import assert from "node:assert/strict";
import test from "node:test";

import {
  Camera, FlyCamera, PITCH_MAX, PITCH_MIN, Tabletop, View, applyH, createWorld, defaultTableBounds, drawTable, gridLines,
  extendBelowOf, hasPhysicalTable, normalizeLayout, orthoOf, poseFromHomography, snapToGrid, toRad, validateLayout, TABLE_SURFACES,
} from "../../web/arail/index.js";

const W = 1280, H = 720;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} vs ${b} (±${tol})`);

/** Independent pinhole projection: camera at `eye` looking at `target`, horizon level. */
function pinhole(eye, target, f, p) {
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const norm = (a) => a.map((v) => v / Math.hypot(...a));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const fwd = norm(sub(target, eye));
  const right = Math.hypot(fwd[0], fwd[1]) > 1e-9 ? norm(cross(fwd, [0, 0, 1])) : null;
  const down = cross(fwd, right);
  const v = sub([p[0], p[1], p[2] || 0], eye);
  return [W / 2 + (f * dot(v, right)) / dot(v, fwd), H / 2 + (f * dot(v, down)) / dot(v, fwd)];
}

/** A canvas context that checks coordinates and records filled paths. */
function fakeContext(width = W, height = H) {
  const fills = [], strokes = [];
  let path = [];
  const noop = () => {};
  const point = (x, y) => {
    assert.ok(Number.isFinite(x) && Number.isFinite(y), "finite coordinates");
    path.push([x, y]);
  };
  const ctx = {
    canvas: { width, height }, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, globalAlpha: 1, globalCompositeOperation: "source-over",
    save: noop, restore: noop, setTransform: noop, fillRect: noop, closePath: noop, setLineDash: noop, clip: noop, drawImage: noop,
    arc: noop, ellipse: noop, quadraticCurveTo: noop, arcTo: noop, fillText: noop, strokeText: noop,
    beginPath() {
      path = [];
    },
    moveTo: point,
    lineTo: point,
    fill() {
      fills.push({ color: this.fillStyle, path: path.slice() });
    },
    stroke() {
      strokes.push({ color: this.strokeStyle, path: path.slice() });
    },
    measureText: (t) => ({ width: t.length * 6 }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
  };
  return { ctx, fills, strokes };
}

/** A View of the flyover camera, as the app builds it. */
function flyView(cam, { night = 0, virtual = true } = {}) {
  const camera = new Camera(W, H);
  const { H: hom, focal, pose } = cam.homography(W, H);
  camera.setManualFocal(focal);
  const { ctx, fills, strokes } = fakeContext();
  const view = new View({ ctx, camera, H: hom, pose, scale: 87, night, virtual });
  return { view, fills, strokes, H: hom };
}

/* ---------------------------------------------------------------- camera geometry */

test("the flyover homography projects like a pinhole camera at the eye", () => {
  for (const [yaw, pitch, distance, target] of [[90, 50, 1500, [600, 100]], [10, 20, 800, [-300, 50]], [-135, 75, 3000, [0, 0]], [200, 8, 400, [1000, 500]]]) {
    const cam = new FlyCamera({ target, distance, yaw: toRad(yaw), pitch: toRad(pitch) });
    const { H: hom, focal } = cam.homography(W, H);
    const { eye } = cam.basis();
    close(Math.hypot(eye[0] - target[0], eye[1] - target[1], eye[2]), distance, 1e-6, "eye distance");
    for (const p of [[0, 0], [500, -200], [target[0] + 120, target[1] - 80], [target[0], target[1]]]) {
      const expected = pinhole(eye, [...target, 0], focal, p);
      const viaH = applyH(hom, p), direct = cam.project(p, W, H);
      for (let i = 0; i < 2; i++) {
        close(viaH[i], expected[i], 1e-6, "H");
        close(direct[i], expected[i], 1e-6, "project");
      }
    }
    // the target is in the middle of the image
    const c = cam.project(target, W, H);
    close(c[0], W / 2, 1e-6);
    close(c[1], H / 2, 1e-6);
  }
});

test("poseFromHomography recovers the flyover pose, also with the origin behind the camera", () => {
  const cam = new FlyCamera({ target: [300, 200], distance: 1800, yaw: toRad(70), pitch: toRad(40) });
  const { H: hom, focal, pose } = cam.homography(W, H);
  const recovered = poseFromHomography(hom, { fx: focal, fy: focal, cx: W / 2, cy: H / 2 });
  for (const k of ["a1", "a2", "a3", "n"]) for (let i = 0; i < 3; i++) close(recovered[k][i], pose[k][i], 1e-6, k);
  // looking away from the origin, close to the table: the origin is behind the camera (a long
  // layout filmed far from marker 0); the top of the image shows the sky
  const away = new FlyCamera({ target: [1400, 0], distance: 300, yaw: 0, pitch: toRad(15) });
  const { view } = flyView(away);
  assert.ok(view.depth(0, 0, 0) < 0, "origin behind the camera");
  const seen = away.homography(W, H);
  const fromH = poseFromHomography(seen.H, { fx: seen.focal, fy: seen.focal, cx: W / 2, cy: H / 2 });
  for (const k of ["a1", "a2", "a3", "n"]) for (let i = 0; i < 3; i++) close(fromH[k][i], seen.pose[k][i], 1e-6, `${k} (origin behind)`);
  // the same homography with the opposite sign gives the same pose
  const flipped = poseFromHomography(seen.H.map((v) => -v), { fx: seen.focal, fy: seen.focal, cx: W / 2, cy: H / 2 });
  for (const k of ["a1", "a2", "a3", "n"]) for (let i = 0; i < 3; i++) close(flipped[k][i], seen.pose[k][i], 1e-6, `${k} (-H)`);
  for (const p of [[1400, 0, 0], [1500, 30, 20], [1350, -40, 0]]) {
    const a = view.project(...p), b = away.project(p, W, H);
    close(a[0], b[0], 1e-6);
    close(a[1], b[1], 1e-6);
  }
  assert.equal(view.project(0, 0, 0), null);
  // the height axis points up: a point above the table appears higher in the image
  assert.ok(view.project(1400, 0, 50)[1] < view.project(1400, 0, 0)[1]);
});

test("ground points: the inverse of the projection, nothing above the horizon", () => {
  const cam = new FlyCamera({ target: [100, -50], distance: 1200, yaw: toRad(120), pitch: toRad(15) });
  for (const p of [[100, -50], [300, 100], [-200, -300]]) {
    const q = cam.project(p, W, H), g = cam.groundPoint(q[0], q[1], W, H);
    close(g[0], p[0], 1e-6);
    close(g[1], p[1], 1e-6);
  }
  assert.equal(cam.groundPoint(W / 2, 0, W, H), null, "the top of the image shows the sky at 15° pitch");
  assert.equal(cam.groundPoint(W / 2, H / 2 + 5, W, H, 10), null, "beyond maxRange");
});

/* ---------------------------------------------------------------- navigation */

test("panning keeps the grabbed point under the pointer", () => {
  for (const [pitch, at, d] of [[50, [400, 500], [80, -30]], [90, [900, 200], [-150, 60]], [15, [640, 600], [20, -40]]]) {
    const cam = new FlyCamera({ target: [500, 100], distance: 1500, yaw: toRad(80), pitch: toRad(pitch) });
    const grabbed = cam.groundPoint(at[0], at[1], W, H);
    cam.pan(d[0], d[1], W, H, at);
    const now = cam.project(grabbed, W, H);
    close(now[0], at[0] + d[0], 1e-6, `pitch ${pitch}`);
    close(now[1], at[1] + d[1], 1e-6, `pitch ${pitch}`);
  }
  // above the horizon the view still moves, by a limited amount
  const cam = new FlyCamera({ target: [0, 0], distance: 1000, yaw: 0, pitch: toRad(10) });
  cam.pan(0, 50, W, H, [W / 2, 2]);
  assert.ok(Math.hypot(...cam.target) > 0 && Math.hypot(...cam.target) <= 4000);
});

test("zooming keeps the point under the pointer and stays within the distance limits", () => {
  const cam = new FlyCamera({ target: [0, 0], distance: 2000, yaw: toRad(90), pitch: toRad(45) });
  const at = [300, 450], g = cam.groundPoint(at[0], at[1], W, H);
  cam.zoomAt(2, at[0], at[1], W, H);
  close(cam.distance, 1000, 1e-9);
  const q = cam.project(g, W, H);
  close(q[0], at[0], 1e-6);
  close(q[1], at[1], 1e-6);
  cam.zoomAt(1e6, at[0], at[1], W, H);
  assert.equal(cam.distance, cam.minDistance);
  cam.zoomAt(1e-9, null, null, W, H);
  assert.equal(cam.distance, cam.maxDistance);
});

test("orbit, twist and plan view", () => {
  const cam = new FlyCamera({ target: [0, 0], distance: 1000, yaw: 0, pitch: toRad(30) });
  cam.orbit(toRad(30), toRad(200));
  close(cam.pitch, PITCH_MAX, 1e-12);
  assert.ok(cam.isPlan);
  cam.orbit(0, -10);
  close(cam.pitch, PITCH_MIN, 1e-12);
  close(cam.yaw, toRad(30), 1e-12);
  // a twist keeps the point under the fingers
  const at = [800, 500], g = cam.groundPoint(at[0], at[1], W, H);
  cam.turnAt(toRad(40), at[0], at[1], W, H);
  const q = cam.project(g, W, H);
  close(q[0], at[0], 1e-6);
  close(q[1], at[1], 1e-6);
  close(cam.yaw, toRad(70), 1e-12);
  cam.planView();
  assert.ok(cam.isPlan);
  // plan view: the layout is seen like a map, x to the right and y up (yaw 90°)
  const map = new FlyCamera({ target: [0, 0], distance: 1000, yaw: toRad(90), pitch: PITCH_MAX });
  const o = map.project([0, 0], W, H), x = map.project([100, 0], W, H), y = map.project([0, 100], W, H);
  assert.ok(x[0] > o[0] && Math.abs(x[1] - o[1]) < 1e-6);
  assert.ok(y[1] < o[1] && Math.abs(y[0] - o[0]) < 1e-6);
});

test("fit shows the whole rectangle, as large as possible", () => {
  const bounds = [-150, -400, 1550, 680];
  for (const [yaw, pitch, aspect] of [[90, 50, 16 / 9], [30, 25, 4 / 3], [90, 90, 0.6], [-60, 70, 2]]) {
    const cam = new FlyCamera({ yaw: toRad(yaw), pitch: toRad(pitch) });
    cam.fit(bounds, aspect, 0.06);
    const h = 1000, w = h * aspect;
    const pts = [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]].map((p) => cam.project(p, w, h));
    assert.ok(pts.every(Boolean), "all corners in front");
    for (const p of pts) {
      assert.ok(p[0] >= 0.06 * w - 1 && p[0] <= 0.94 * w + 1 && p[1] >= 0.06 * h - 1 && p[1] <= 0.94 * h + 1, `inside: ${p}`);
    }
    // tight: some corner touches the margin
    const slack = Math.min(...pts.flatMap((p) => [p[0] - 0.06 * w, 0.94 * w - p[0], p[1] - 0.06 * h, 0.94 * h - p[1]]));
    assert.ok(slack < 0.02 * h, `slack ${slack}`);
  }
});

test("camera files and animation steps", () => {
  const cam = new FlyCamera({ target: [12.34, -5.67], distance: 987.65, yaw: toRad(33.333), pitch: toRad(44.444), fovY: toRad(50) });
  const json = cam.toJSON();
  assert.deepEqual(json, { target: [12.3, -5.7], distance_mm: 987.7, yaw_deg: 33.33, pitch_deg: 44.44, fov_deg: 50 });
  assert.deepEqual(FlyCamera.fromJSON(JSON.parse(JSON.stringify(json))).toJSON(), json);
  const junk = FlyCamera.fromJSON({ target: ["a", 1], distance_mm: -5, pitch_deg: 400, yaw_deg: "x" });
  assert.deepEqual(junk.target, [0, 0]);
  assert.equal(junk.distance, junk.minDistance);
  close(junk.pitch, PITCH_MAX, 1e-12);
  assert.ok(Number.isFinite(junk.yaw));
  assert.ok(FlyCamera.fromJSON(null) instanceof FlyCamera);
  // in between: the shorter way round, geometric zoom
  const a = { target: [0, 0], distance: 100, yaw: toRad(170), pitch: toRad(30), fovY: 1 };
  const b = { target: [100, 50], distance: 400, yaw: toRad(-170), pitch: toRad(60), fovY: 1 };
  assert.deepEqual(FlyCamera.between(a, b, 0), a);
  const mid = FlyCamera.between(a, b, 0.5);
  close(mid.distance, 200, 1e-9);
  close(Math.abs(Math.cos(mid.yaw) + 1), 0, 1e-9, "turns through 180°, not through 0°");
  const end = FlyCamera.between(a, b, 1);
  close(end.pitch, b.pitch, 1e-12);
  assert.deepEqual(end.target, b.target);
});

/* ---------------------------------------------------------------- grid */

test("grid lines, axes and snapping", () => {
  const g = gridLines([-100, -60, 120, 60], 10);
  assert.equal(g.step, 10);
  assert.deepEqual(g.axes.y, [[0, -60], [0, 60]]);
  assert.deepEqual(g.axes.x, [[-100, 0], [120, 0]]);
  const xs = [...g.minor, ...g.major].filter((s) => s[0][0] === s[1][0]).map((s) => s[0][0]);
  assert.equal(xs.length + 1, 23); // -100 .. 120 every 10, the axis x = 0 apart
  assert.deepEqual(g.major.filter((s) => s[0][0] === s[1][0]).map((s) => s[0][0]).sort((a, b) => a - b), [-100, 100]);
  // too many lines: a coarser level
  assert.equal(gridLines([0, 0, 100000, 100000], 10, { maxLines: 300 }).step, 1000);
  assert.deepEqual(gridLines([0, 0, 0, 10], 10).minor, []);
  assert.deepEqual(snapToGrid([24.9, -26], 50), [0, -50]);
  assert.deepEqual(snapToGrid([0.3, 0.7], 0.1), [0.3, 0.7]);
  assert.deepEqual(snapToGrid([3, 4], 0), [3, 4]);
});

test("layouts have a grid (with defaults) and an optional orthophoto", () => {
  assert.deepEqual(normalizeLayout({}).grid, { size_mm: 50, snap: true });
  assert.deepEqual(normalizeLayout({ grid: { size_mm: 25, snap: false } }).grid, { size_mm: 25, snap: false });
  assert.deepEqual(normalizeLayout({ grid: { size_mm: -3, snap: "yes" } }).grid, { size_mm: 50, snap: true });
  assert.deepEqual(validateLayout({ grid: { size_mm: 0 } }), ["grid.size_mm must be a number above 0 and at most 10000 (mm)"]);
  // what normalizeLayout replaces is reported, too
  assert.equal(normalizeLayout({ grid: { size_mm: 20000 } }).grid.size_mm, 50);
  assert.equal(validateLayout({ grid: { size_mm: 20000 } }).length, 1);
  assert.deepEqual(validateLayout({ grid: { size_mm: "25" } }), []);
  assert.equal(validateLayout({ grid: 5 }).length, 1);
  const ortho = { image: "../media/ortho.jpg", bounds_mm: [-100, -200, 1500, 700] };
  assert.deepEqual(orthoOf({ view: { ortho } }), ortho);
  assert.deepEqual(validateLayout({ view: { ortho } }), []);
  for (const bad of [{ image: "", bounds_mm: [0, 0, 1, 1] }, { image: "a.jpg", bounds_mm: [0, 0, 0, 1] }, { image: "a.jpg", bounds_mm: [0, 0, 1] }, { image: "a.jpg" }]) {
    assert.equal(orthoOf({ view: { ortho: bad } }), null);
    assert.equal(validateLayout({ view: { ortho: bad } }).length, 1);
  }
  // the picture extended below the photo: a share of its height, 0 to 2
  assert.equal(extendBelowOf({ view: { extend_below: 0.5 } }), 0.5);
  assert.deepEqual(validateLayout({ view: { extend_below: 0.5 } }), []);
  assert.deepEqual(validateLayout({ view: { extend_below: 0 } }), []);
  for (const bad of [-0.2, 2.5, "0.5", null]) assert.equal(extendBelowOf({ view: { extend_below: bad } }), 0);
  for (const bad of [-0.2, 2.5, "0.5"]) assert.equal(validateLayout({ view: { extend_below: bad } }).length, 1, String(bad));
  // the grid and the orthophoto are written back
  const world = createWorld({ grid: { size_mm: 100, snap: false }, view: { ortho, extend_below: 0.5 } });
  const json = world.toJSON();
  assert.deepEqual(json.grid, { size_mm: 100, snap: false });
  assert.deepEqual(json.view.ortho, ortho);
  assert.equal(json.view.extend_below, 0.5);
  assert.deepEqual(createWorld(JSON.parse(JSON.stringify(json))).toJSON(), json);
});

/* ---------------------------------------------------------------- table modules */

test("table modules: geometry, snapping corner, file entry", () => {
  const world = createWorld({ objects: [{ id: "t1", type: "tabletop", position: [1500, 200], width_mm: 600, depth_mm: 400 }] });
  const t = world.getObject("t1");
  assert.ok(t instanceof Tabletop);
  assert.equal(Tabletop.placement, "rect");
  assert.equal(Tabletop.category, "Table");
  assert.deepEqual(t.footprint(), [[1200, 0], [1800, 0], [1800, 400], [1200, 400]]);
  assert.deepEqual(t.snapPoint(), [1200, 0]);
  assert.deepEqual(t.anchorPoint(), [1500, 200]);
  assert.ok(t.contains([1500, 200]) && !t.contains([1900, 200]));
  assert.deepEqual(t.toJSON(), { id: "t1", type: "tabletop", position: [1500, 200], width_mm: 600, depth_mm: 400 });
  assert.deepEqual(t.duplicateOffset(), [600, 0], "a copy goes right beside it");
  t.set({ rotation_deg: 90 });
  const fp = t.footprint();
  close(fp[0][0], 1700, 1e-9);
  close(fp[0][1], -100, 1e-9);
  t.translate(10, -20);
  assert.deepEqual(t.spec.position, [1510, 180]);
  assert.equal(hasPhysicalTable(world), false);
  t.set({ kind: "physical" });
  assert.equal(hasPhysicalTable(world), true);
  const copy = createWorld(JSON.parse(JSON.stringify(world.toJSON())));
  assert.deepEqual(copy.getObject("t1").toJSON(), t.toJSON());
});

test("table modules are drawn in the flyover, extensions also over the camera image", () => {
  const world = createWorld({
    objects: [
      { id: "ext", type: "tabletop", position: [0, 0], width_mm: 800, depth_mm: 400, surface: "green" },
      { id: "real", type: "tabletop", position: [0, 900], width_mm: 800, depth_mm: 400, kind: "physical" },
    ],
  });
  // in front of both modules, between their side edges: each shows its top and its front edge
  const front = new FlyCamera({ target: [0, 400], distance: 2500, yaw: toRad(90), pitch: toRad(35) });
  const fill = (fills, colour) => fills.filter((f) => colourIs(f.color, colour)).length;
  {
    const { view, fills } = flyView(front);
    world.draw(view);
    assert.equal(fill(fills, TABLE_SURFACES.green.top), 1, "extension top");
    assert.equal(fill(fills, TABLE_SURFACES.grey.top), 1, "real table top");
    assert.equal(fills.length, 4, "two tops, two front edges");
  }
  {
    const { view, fills } = flyView(front, { virtual: false });
    world.draw(view);
    assert.equal(fill(fills, TABLE_SURFACES.green.top), 1, "the extension is drawn over the camera image");
    assert.equal(fill(fills, TABLE_SURFACES.grey.top), 0, "the real table is in the camera image");
    assert.equal(fills.length, 2);
  }
});

/** Is a fill colour (#hex or rgba()) the given #hex colour? */
function colourIs(colour, hex) {
  const m = String(colour).match(/rgba?\(([^)]+)\)/);
  const v = m ? m[1].split(",").map(Number) : [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
  const h = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return v.slice(0, 3).every((x, i) => Math.abs(x - h[i]) < 1.5);
}

test("a table's edges: only those facing the camera, and the near edge is cut at the camera", () => {
  const fp = [[-500, -300], [500, -300], [500, 300], [-500, 300]];
  const edgesSeen = (cam) => {
    const { view, fills } = flyView(cam);
    drawTable(view, fp);
    view.render();
    return fills.length - 1; // all but the top
  };
  // from the front (−y), above the table: the front edge only
  assert.equal(edgesSeen(new FlyCamera({ target: [0, 0], distance: 3000, yaw: toRad(90), pitch: toRad(40) })), 1);
  // from a corner: two edges
  assert.equal(edgesSeen(new FlyCamera({ target: [0, 0], distance: 3000, yaw: toRad(45), pitch: toRad(40) })), 2);
  // straight down: no edge
  assert.equal(edgesSeen(new FlyCamera({ target: [0, 0], distance: 3000, yaw: toRad(90), pitch: PITCH_MAX })), 0);
  // standing on the table, looking along it: the top is cut off at the camera but still drawn
  const { view, fills } = flyView(new FlyCamera({ target: [0, 100], distance: 60, yaw: toRad(90), pitch: toRad(10) }));
  drawTable(view, fp);
  view.render();
  const top = fills.find((f) => colourIs(f.color, TABLE_SURFACES.grey.top));
  assert.ok(top, "top drawn");
  assert.ok(top.path.length >= 4);
});

test("the default table covers markers and objects, not table extensions and what stands on them", () => {
  assert.equal(defaultTableBounds(createWorld({})), null);
  const world = createWorld({
    markers: { size_mm: 30, poses: { 0: [0, 0, 0], 1: [700, 20, 0] } },
    objects: [
      { id: "tree", type: "tree", position: [300, 300] },
      { id: "ext", type: "tabletop", position: [1500, 0], width_mm: 600, depth_mm: 600 },
      { id: "house", type: "house", position: [1500, 0] },
    ],
  });
  const b = defaultTableBounds(world, 100);
  close(b[0], -15 - 100, 0.11, "xmin: marker 0's edge");
  close(b[2], 715 + 100, 0.11, "xmax: marker 1's edge");
  assert.ok(b[3] > 300 + 100, "the tree is on the table");
  assert.ok(b[2] < 1200, "the extension and the house on it are not");
  // the orthophoto of the table counts, too
  world.layout.view = { ortho: { image: "x.jpg", bounds_mm: [-300, -200, 900, 600] } };
  assert.deepEqual(defaultTableBounds(world, 0).map(Math.round), [-300, -200, 900, 600]);
});

/* ---------------------------------------------------------------- drawing for a virtual camera */

test("flat things are cut off at the camera instead of disappearing", () => {
  const cam = new FlyCamera({ target: [0, 200], distance: 80, yaw: toRad(90), pitch: toRad(12) });
  const { view, fills, strokes } = flyView(cam);
  const big = [[-2000, -2000], [2000, -2000], [2000, 2000], [-2000, 2000]];
  assert.ok(big.some((p) => view.depth(p[0], p[1], 0) < 0), "part of it is behind the camera");
  view.polygon(big, { fill: "#123456" });
  view.line([[0, -3000], [0, 3000]], { stroke: "#654321" });
  view.line([[-100, -3000], [-100, -2000]], { stroke: "#abcdef" }); // all behind
  view.render();
  const poly = fills.find((f) => f.color === "rgba(18,52,86,1)" || f.color === "#123456");
  assert.ok(poly && poly.path.length >= 3, "polygon drawn");
  assert.equal(strokes.length, 1, "the visible line only");
  // ... while the camera view is unchanged (everything in front)
  const front = flyView(new FlyCamera({ target: [0, 0], distance: 3000, yaw: toRad(90), pitch: toRad(50) }));
  front.view.polygon(big.map((p) => [p[0] / 4, p[1] / 4]), { fill: "#123456" });
  front.view.render();
  assert.equal(front.fills[0].path.length, 4);
});

test("platforms and tracks draw their real surface for a virtual camera, unless a photo of the table shows it", () => {
  const world = createWorld({
    markers: { size_mm: 30, poses: { 0: [0, 0, 0], 1: [600, 0, 0] } },
    objects: [
      { id: "p", type: "platform", between: [0, 1], width_mm: 60 },
      { id: "g", type: "track", track_id: "G1", points: [[-100, 60], [800, 60]] },
    ],
  });
  const cam = new FlyCamera({ target: [300, 50], distance: 900, yaw: toRad(90), pitch: toRad(50) });
  const count = (opts, photo = null) => {
    const { view, fills, strokes } = flyView(cam, opts);
    view.groundPhoto = photo;
    world.draw(view);
    return { fills: fills.length, strokes: strokes.length };
  };
  const ar = count({ virtual: false }), fly = count({}), photo = count({}, [-500, -500, 1500, 500]);
  assert.ok(fly.fills > ar.fills + 3, `surfaces and sleepers (${ar.fills} -> ${fly.fills})`);
  assert.ok(fly.strokes >= ar.strokes + 2, "rails");
  assert.deepEqual(photo, ar, "the photo shows the real platform and track");
  const { view } = flyView(cam);
  assert.equal(view.showsReal([[0, 0]]), false);
  view.groundPhoto = [-10, -10, 10, 10];
  assert.equal(view.showsReal([[0, 0], [5, 5]]), true);
  assert.equal(view.showsReal([[0, 0], [50, 5]]), false);
});

test("trains of the control system are drawn as solid trains in the flyover", () => {
  const world = createWorld({ objects: [{ id: "g", type: "track", track_id: "G1", points: [[0, 0], [2000, 0]] }] });
  world.trains.apply({ type: "trains", trains: [{ id: "RE 1", track: "G1", offset_mm: 1200, speed_mm_s: 80 }] });
  const cam = new FlyCamera({ target: [1000, 0], distance: 1500, yaw: toRad(90), pitch: toRad(45) });
  const train = (opts, style = "outline") => {
    world.settings.feedVehicles = style;
    const { view, fills } = flyView(cam, opts);
    world.draw(view);
    // Türkis faces, shaded
    return fills.filter((f) => {
      const m = String(f.color).match(/rgba\((\d+),(\d+),(\d+)/);
      return m && +m[1] < 0.3 * m[2] && Math.abs(m[2] - m[3]) < 0.2 * m[2];
    }).length;
  };
  assert.ok(train({}) >= 3, "box faces in the flyover");
  assert.ok(train({}, "none") >= 3, "also when hidden over the camera image");
  assert.equal(train({ virtual: false }, "none"), 0);
});
