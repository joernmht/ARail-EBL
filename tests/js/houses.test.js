// German house types and the building kit: geometry, capacity, entrances, the estate's plots,
// JSON round trips and drawing (greyscale by day, lit windows at night) through a fake canvas.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  Camera, View, createWorld, registry, pointInPolygon, polygonArea, PALETTE, parseColor, parseRgba,
  BuildingBase, PLATTENBAU_SERIES, defaultOccupancy, lightWindows, hash01, polygonNormal,
} from "../../web/arail/index.js";

const TYPES = ["building", "plattenbau", "altbau-block", "house", "house-estate", "office", "school", "supermarket", "factory"];
const K = 1000 / 87; // model mm per prototype metre (H0)

/** One object of each type, spread out on the layout. */
const ALL = [
  { id: "p1", type: "plattenbau", position: [0, 0] },
  { id: "p2", type: "plattenbau", position: [0, 700], series: "wbs70-11", sections: 3 },
  { id: "p3", type: "plattenbau", position: [0, 1300], series: "qp61", balconies: false },
  { id: "p4", type: "plattenbau", position: [0, 1900], series: "p2", floors: 7 },
  { id: "a1", type: "altbau-block", position: [1200, 0] },
  { id: "a2", type: "altbau-block", position: [1200, 1000], form: "u", rear_wings: true, roof: "pitched" },
  { id: "a3", type: "altbau-block", position: [1200, 1900], form: "row", rear_wings: true, seed: 7 },
  { id: "h1", type: "house", position: [2200, 0] },
  { id: "h2", type: "house", position: [2200, 300], style: "hip", floors: 2 },
  { id: "h3", type: "house", position: [2200, 600], style: "bungalow", garage: false },
  { id: "h4", type: "house", position: [2200, 900], style: "semi", width_m: 16 },
  { id: "e1", type: "house-estate", points: [[2600, -200], [3800, -200], [3800, 800], [2600, 800]] },
  { id: "o1", type: "office", position: [3200, 1300] },
  { id: "s1", type: "school", position: [3200, 1800] },
  { id: "m1", type: "supermarket", position: [4300, 0] },
  { id: "f1", type: "factory", position: [4300, 800] },
  { id: "b1", type: "building", position: [4300, 1500] },
  { id: "b2", type: "building", position: [4300, 1800], roof: "flat", use: "work", floors: 4 },
];

/** Homography of a pinhole camera at `eye` looking at `target` (layout mm). */
function lookAt(camera, eye, target) {
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const norm = (a) => {
    const l = Math.hypot(...a);
    return a.map((v) => v / l);
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const f = norm(sub(target, eye)), r = norm(cross(f, [0, 0, 1])), d = cross(f, r);
  const R = [r, d, f];
  const t = R.map((row) => -(row[0] * eye[0] + row[1] * eye[1] + row[2] * eye[2]));
  const { fx, fy, cx, cy } = camera.intrinsics;
  const K3 = (c) => [fx * c[0] + cx * c[2], fy * c[1] + cy * c[2], c[2]];
  const c0 = K3([R[0][0], R[1][0], R[2][0]]), c1 = K3([R[0][1], R[1][1], R[2][1]]), c2 = K3(t);
  return [c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]];
}

/** A canvas context that records the fill colours and catches drawing errors. */
function fakeContext(width, height) {
  const fills = [];
  const noop = () => {};
  const ctx = {
    canvas: { width, height }, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, globalAlpha: 1,
    save: noop, restore: noop, setTransform: noop, fillRect: noop, beginPath: noop, closePath: noop, stroke: noop, setLineDash: noop,
    arc: noop, ellipse: noop, quadraticCurveTo: noop, arcTo: noop, clip: noop, fillText: noop, drawImage: noop,
    moveTo(x, y) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y), "finite coordinates");
    },
    lineTo(x, y) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y), "finite coordinates");
    },
    fill() {
      fills.push(this.fillStyle);
    },
    measureText: (t) => ({ width: t.length * 6 }),
    createRadialGradient: () => ({ addColorStop: noop }),
  };
  return { ctx, fills };
}

/** Draw a world through a fake view; returns the fill colours. Fails on drawing errors. */
function drawWorld(world, { eye = [2000, -3500, 2600], target = [2000, 900, 0], night = null } = {}) {
  const camera = new Camera(1600, 900);
  const { ctx, fills } = fakeContext(1600, 900);
  const view = new View({ ctx, camera, H: lookAt(camera, eye, target), scale: world.scale, night });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.map(String).join(" "));
  try {
    world.draw(view);
  } finally {
    console.error = original;
  }
  assert.deepEqual(errors, []);
  return { fills, view };
}

const rgb = (css) => (Array.isArray(css) ? css : typeof css === "string" ? parseColor(css) : null);
const isGrey = (css) => {
  const c = rgb(css);
  return !!c && c[0] === c[1] && c[1] === c[2];
};

test("house types are registered as buildings with a use", () => {
  for (const type of TYPES) {
    const cls = registry.objects.get(type);
    assert.ok(cls, type);
    assert.ok(cls.prototype instanceof BuildingBase, `${type} extends BuildingBase`);
    assert.equal(cls.category, "Buildings", type);
    assert.ok(["residential", "work", "school", "shop", "other"].includes(cls.use), type);
  }
  const world = createWorld({ objects: ALL });
  const use = Object.fromEntries(world.objects.map((o) => [o.id, o.use()]));
  assert.deepEqual([use.p1, use.a1, use.h1, use.e1, use.o1, use.s1, use.m1, use.f1, use.b1, use.b2],
    ["residential", "residential", "residential", "residential", "work", "school", "shop", "work", "residential", "work"]);
});

test("Plattenbau: footprint, floors and height follow the series", () => {
  const world = createWorld({ objects: ALL.slice(0, 4) });
  const [p1, p2, p3, p4] = world.objects;
  const size = (o) => {
    const fp = o.footprint();
    return [Math.hypot(fp[1][0] - fp[0][0], fp[1][1] - fp[0][1]) / K, Math.hypot(fp[2][0] - fp[1][0], fp[2][1] - fp[1][1]) / K];
  };
  // WBS 70: 6.0 m grid, 12 m sections, 12 m deep, 6 floors of 2.8 m
  assert.deepEqual(size(p1).map((v) => +v.toFixed(3)), [48, 12]);
  assert.equal(p1.floorsCount(), 6);
  assert.ok(Math.abs(p1.heightMM() / K - (1.2 + 6 * 2.8 + 0.6)) < 1e-6, `height ${p1.heightMM() / K} m`);
  assert.equal(p2.floorsCount(), 11);
  assert.ok(p2.heightMM() > 1.6 * p1.heightMM(), "11 floors with lift motor rooms");
  assert.deepEqual(size(p2).map((v) => +v.toFixed(3)), [36, 12]);
  // QP 61: 3.6 m transverse-wall grid, 10.8 m deep, 8 floors
  assert.equal(p3.floorsCount(), 8);
  assert.ok(Math.abs(size(p3)[1] - 10.8) < 1e-9);
  assert.ok(Math.abs(size(p3)[0] - 4 * 3 * 3.6) < 1e-9);
  assert.equal(p4.floorsCount(), 7, "floors override the series");
  assert.equal(PLATTENBAU_SERIES.p2.floors, 5);
  // residents: about 2 per 60 m² of floor area
  assert.equal(p1.capacity().residents, Math.round((48 * 12 * 6) / 30));
  // an entrance per section on the front (−y)
  const es = p1.entrances();
  assert.equal(es.length, 4);
  for (const e of es) {
    assert.ok(Math.abs(e.pos[1] / K + 6) < 1e-9, "on the front wall");
    assert.deepEqual(e.dir.map((v) => +v.toFixed(9)), [0, -1]);
  }
  // loggias are drawn only while the garden side faces the camera, canopies with the front
  assert.ok(p1.geometry.parts.some((p) => p.facing), "parts that depend on the side seen");
  assert.ok(p1.geometry.windows.length > p3.geometry.windows.length * 0.5);
});

test("entrances lie on the outline and point outwards, also when rotated", () => {
  for (const rotation of [0, 30, -135]) {
    const objects = ALL.filter((o) => o.position).map((o) => ({ ...o, rotation_deg: rotation }));
    const world = createWorld({ objects });
    for (const o of world.objects) {
      const es = o.entrances(), fp = o.footprint(), c = o.anchorPoint();
      assert.ok(es.length >= 1, `${o.id}: has an entrance`);
      const front = [Math.sin((rotation * Math.PI) / 180), -Math.cos((rotation * Math.PI) / 180)];
      for (const e of es) {
        assert.ok(Math.abs(Math.hypot(...e.dir) - 1) < 1e-9, "unit direction");
        assert.ok((e.pos[0] - c[0]) * e.dir[0] + (e.pos[1] - c[1]) * e.dir[1] > 0, `${o.id}: points away from the middle`);
        const out = [e.pos[0] + e.dir[0] * 2 * K, e.pos[1] + e.dir[1] * 2 * K], back = [e.pos[0] - e.dir[0] * 0.5 * K, e.pos[1] - e.dir[1] * 0.5 * K];
        assert.ok(pointInPolygon(back, fp), `${o.id}: inside behind the door`);
        // (the supermarket's outline includes its parking lot in front of the door)
        if (o.type !== "supermarket") assert.ok(!pointInPolygon(out, fp), `${o.id}: outside in front of the door`);
      }
      // all types but the perimeter block have their doors on the front (local −y)
      if (o.type !== "altbau-block") for (const e of es) assert.ok(e.dir[0] * front[0] + e.dir[1] * front[1] > 0.999, `${o.id} faces the front`);
    }
  }
});

test("capacity fits the use", () => {
  const world = createWorld({ objects: ALL });
  const cap = (id) => world.getObject(id).capacity();
  for (const id of ["p1", "p2", "p3", "p4", "a1", "a2", "a3", "h1", "h2", "h3", "h4", "e1", "b1"]) {
    assert.ok(cap(id).residents > 0, `${id} has residents`);
    assert.equal(cap(id).pupils, 0);
  }
  assert.ok(cap("a1").jobs > 0, "shops on the ground floor of the Altbau");
  assert.equal(cap("h4").residents >= 4, true, "two households in a semi-detached house");
  assert.ok(cap("e1").residents >= 2 * world.getObject("e1").geometry.houses.length);
  for (const id of ["o1", "f1", "b2"]) {
    assert.ok(cap(id).jobs > 0, `${id} has jobs`);
    assert.equal(cap(id).residents, 0);
  }
  assert.deepEqual([cap("s1").pupils, cap("s1").jobs], [300, 30]);
  assert.ok(cap("m1").visitors > 50 && cap("m1").jobs === 15, JSON.stringify(cap("m1")));
});

test("estate: plots only inside the polygon, one entrance per house", () => {
  // an L-shaped (non-convex) area
  const L = [[0, 0], [1600, 0], [1600, 500], [700, 500], [700, 1200], [0, 1200]];
  const world = createWorld({ objects: [{ id: "e", type: "house-estate", points: L, seed: 3 }] });
  const e = world.objects[0], g = e.geometry;
  assert.ok(g.plots.length >= 6, `plots: ${g.plots.length}`);
  for (const plot of g.plots) {
    const c = plot.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4], [0, 0]);
    for (const p of plot) {
      const q = [p[0] + (c[0] - p[0]) * 0.001, p[1] + (c[1] - p[1]) * 0.001];
      assert.ok(pointInPolygon(q, L), `plot corner ${p.map((v) => v.toFixed(1))} inside`);
    }
    assert.ok(!L.some((v) => pointInPolygon(v, plot) && !plot.some((p) => Math.hypot(p[0] - v[0], p[1] - v[1]) < 1e-6)), "no polygon corner inside a plot");
    assert.ok(Math.abs(Math.abs(polygonArea(plot)) / K ** 2 - 16 * 28) < 1e-6, "plots of 16 × 28 m");
  }
  for (const h of g.houses) assert.ok(pointInPolygon(h.center, L), "houses inside");
  assert.equal(e.entrances().length, g.houses.length);
  assert.ok(g.houses.length >= Math.floor(0.5 * g.plots.length) && g.houses.length <= g.plots.length);
  // the rows run along the longest edge (y = 0): fronts of the first row face −y
  assert.ok(g.houses.some((h) => h.front === -1) && g.houses.some((h) => h.front === 1), "rows back to back");
  // all plots built, and no plots at all in a too small area
  e.set({ density: 1 });
  assert.equal(e.geometry.houses.length, e.geometry.plots.length);
  e.set({ points: [[0, 0], [100, 0], [100, 100], [0, 100]] });
  assert.equal(e.geometry.plots.length, 0);
  assert.deepEqual(e.entrances(), []);
  assert.deepEqual(e.footprint(), [[0, 0], [100, 0], [100, 100], [0, 100]]);
});

test("Altbau block: forms, parcels and a fallback to a row when there is no room for a courtyard", () => {
  const world = createWorld({ objects: ALL.filter((o) => o.type === "altbau-block") });
  const [closed, u, row] = world.objects;
  assert.equal(closed.geometry.form, "closed");
  assert.equal(u.geometry.form, "u");
  assert.equal(row.geometry.form, "row");
  // closed 60 × 50 m: four corners, front and back wings of two parcels, side wings of one
  assert.ok(closed.geometry.pieces >= 8, `pieces: ${closed.geometry.pieces}`);
  const fp = closed.footprint();
  assert.ok(Math.abs(Math.abs(polygonArea(fp)) / K ** 2 - 60 * 50) < 1e-6, "outer footprint for selection");
  assert.ok(closed.heightMM() / K > 4 + 4 * 3.3 && closed.heightMM() / K < 4.4 + 4 * 3.75 + 3.4, `height ${closed.heightMM() / K}`);
  assert.ok(closed.entrances().length >= 6, "doors on all four streets");
  const narrow = createWorld({ objects: [{ id: "n", type: "altbau-block", position: [0, 0], width_m: 30, depth_m: 18 }] }).objects[0];
  assert.equal(narrow.geometry.form, "row");
  // the same seed gives the same block; another seed another one
  const again = createWorld({ objects: [ALL.find((o) => o.id === "a1")] }).objects[0];
  assert.equal(again.geometry.windows.length, closed.geometry.windows.length);
  closed.set({ seed: 2 });
  assert.notEqual(closed.geometry.windows.map((w) => w.d.pts[0][0].toFixed(3)).join(), again.geometry.windows.map((w) => w.d.pts[0][0].toFixed(3)).join());
});

test("layout JSON round trip keeps all house types", () => {
  const world = createWorld({ objects: ALL });
  const json = JSON.parse(JSON.stringify(world.toJSON()));
  assert.deepEqual(json.objects, ALL);
  const again = createWorld(json);
  assert.deepEqual(again.toJSON().objects, ALL);
  for (const o of again.objects) assert.deepEqual(o.footprint(), world.getObject(o.id).footprint(), o.id);
});

test("the generic building keeps its parameters and old layouts' colours", () => {
  const world = createWorld({ objects: [
    { id: "b", type: "building", position: [0, 0] },
    { id: "old", type: "building", position: [300, 0], color: "#e8d5b5", roof_color: "#a0472f", floors: 3, roof: "gable" },
  ] });
  const [b, old] = world.objects;
  assert.equal(b.spec.color, "#f2f2f2");
  assert.equal(b.spec.roof_color, "#a6a6a6");
  assert.equal(b.use(), "residential");
  // (face colours are shaded once when the geometry is made: the colour times a brightness 0.75 .. 1)
  const shadeOf = (f, css) => {
    const c = parseColor(css), k = f.color[0] / c[0];
    return k >= 0.75 - 1e-9 && k <= 1 + 1e-9 && f.color.every((v, i) => Math.abs(v - c[i] * k) < 1e-6);
  };
  assert.ok(b.geometry.parts[0].faces.some((f) => shadeOf(f, "#f2f2f2")));
  assert.ok(old.geometry.parts[0].faces.some((f) => shadeOf(f, "#e8d5b5")));
  assert.ok(old.geometry.parts[0].faces.some((f) => shadeOf(f, "#a0472f")));
  assert.deepEqual(old.toJSON(), { id: "old", type: "building", position: [300, 0], color: "#e8d5b5", roof_color: "#a0472f", floors: 3, roof: "gable" });
  b.set({ use: "shop" });
  assert.ok(b.capacity().visitors > 0 && b.capacity().residents === 0);
});

test("drawing: greyscale by day, lit windows (the only colour) at night", () => {
  const world = createWorld({ objects: ALL.filter((o) => o.type !== "building") });
  world.clock.set("12:00");
  const day = drawWorld(world);
  assert.ok(day.fills.length > 500, `fills: ${day.fills.length}`);
  const coloured = day.fills.filter((f) => typeof f === "string" && !isGrey(f));
  assert.deepEqual([...new Set(coloured)], [], "only neutral greys by day");
  world.clock.set("21:30");
  const night = drawWorld(world);
  const lit = parseColor(PALETTE.litWindow);
  const litFills = night.fills.filter((f) => {
    const c = rgb(f);
    return c && c[0] === lit[0] && c[1] === lit[1] && c[2] === lit[2];
  });
  assert.ok(litFills.length > 100, `lit windows: ${litFills.length}`);
  // the night view darkens everything else towards Dunkelblau; no other warm colour appears
  const warm = night.fills.filter((f) => {
    const c = rgb(f);
    return c && c[0] > c[2] + 20 && !(c[0] === lit[0] && c[1] === lit[1] && c[2] === lit[2]);
  });
  assert.deepEqual(warm, []);
});

test("lit windows follow the occupancy from the town simulation", () => {
  const world = createWorld({ objects: [{ id: "p", type: "plattenbau", position: [0, 0] }] });
  const p = world.objects[0], g = p.geometry;
  world.clock.set("21:00");
  const count = () => g.windows.filter((w) => w.d.emissive).length;
  lightWindows(g, p.litShare(0));
  assert.equal(count(), 0, "no lights by day");
  lightWindows(g, p.litShare(1));
  const typical = count();
  assert.ok(typical > 0.5 * g.windows.length, `${typical} of ${g.windows.length}`);
  world.occupancy = new Map([["p", 0]]);
  assert.equal(p.occupancy(), 0);
  lightWindows(g, p.litShare(1));
  assert.equal(count(), 0, "nobody at home");
  world.occupancy.set("p", p.capacity().residents / 4);
  assert.ok(Math.abs(p.occupancy() - 0.25) < 1e-9);
  lightWindows(g, p.litShare(1));
  assert.ok(count() > 0 && count() < typical, `${count()} lit for a quarter of the residents`);
  world.occupancy.set("p", 10 * p.capacity().residents);
  assert.equal(p.occupancy(), 1, "clamped");
  // lit windows are emissive and warm; unlit ones grey again
  const w = g.windows.find((x) => x.d.emissive);
  assert.deepEqual(w.d.color, parseColor(PALETTE.litWindow));
  lightWindows(g, { main: 0, shop: 0 });
  assert.ok(isGrey(w.d.color) && !w.d.emissive);
  // the same windows light up every time (no flicker)
  assert.equal(hash01(5, 17), hash01(5, 17));
});

test("occupancy by time of day when no town simulation runs", () => {
  const at = (use, hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return defaultOccupancy(use, h * 60 + m);
  };
  assert.ok(at("residential", "23:00") > 0.8 && at("residential", "11:00") < 0.5);
  assert.ok(at("work", "10:00") > 0.8 && at("work", "23:00") < 0.1);
  assert.ok(at("school", "10:00") > 0.8 && at("school", "19:00") < 0.05);
  assert.ok(at("shop", "18:00") > 0.8 && at("shop", "23:00") < 0.05);
  const world = createWorld({ objects: [{ id: "o", type: "office", position: [0, 0] }] });
  world.clock.set("22:30");
  assert.ok(world.objects[0].occupancy() < 0.1);
  assert.deepEqual(world.objects[0].litShare(0.1), { main: 0, shop: 0 }, "no lights at dusk below the threshold");
});

test("level of detail: no windows when they would be tiny, all details close up", () => {
  const world = createWorld({ objects: [{ id: "p", type: "plattenbau", position: [0, 0] }] });
  const front = world.objects[0].geometry.parts[0].faces.find((f) => f.lod && f.normal[1] < -0.99);
  drawWorld(world, { eye: [0, -300000, 200000], target: [0, 0, 0] });
  assert.equal(front.decals, front.lod[0], "far away: only coarse details (plinth, doors)");
  assert.ok(front.lod[0].length < 20);
  drawWorld(world, { eye: [0, -900, 400], target: [0, 0, 0] });
  assert.equal(front.decals, front.lod[2], "close up: windows and panel joints");
  assert.ok(front.lod[2].length > front.lod[1].length && front.lod[1].length > front.lod[0].length);
});

test("faces of the models point outwards (culling and shading rely on it)", () => {
  const world = createWorld({ objects: ALL });
  for (const o of world.objects) {
    const g = o.geometry;
    let bottomUp = 0;
    for (const part of g.parts) {
      for (const f of part.faces) {
        assert.ok(Math.abs(Math.hypot(...f.normal) - 1) < 1e-9, `${o.id}: unit normal`);
        assert.deepEqual(f.normal, polygonNormal(f.pts));
        if (f.normal[2] < -0.5) bottomUp++;
      }
    }
    assert.equal(bottomUp, 0, `${o.id}: no faces looking down`);
    // walls face away from the middle of their part (parts with several boxes, like chimneys, are added after their building)
    for (const part of g.parts.filter((p) => !p.after)) {
      const pts = part.faces.flatMap((f) => f.pts);
      const c = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
      for (const f of part.faces) {
        if (Math.abs(f.normal[2]) > 1e-9 || f.pts.length < 4 || Math.min(...f.pts.map((p) => p[2])) > 1e-6) continue; // walls standing on the ground
        const m = f.pts.reduce((s, p) => [s[0] + p[0] / f.pts.length, s[1] + p[1] / f.pts.length], [0, 0]);
        assert.ok((m[0] - c[0]) * f.normal[0] + (m[1] - c[1]) * f.normal[1] > -1e-6, `${o.id}: wall faces outwards`);
      }
    }
  }
});

test("level of detail: panel joints only when they are about a pixel wide", () => {
  const world = createWorld({ objects: [{ id: "p", type: "plattenbau", position: [0, 0] }] });
  const front = world.objects[0].geometry.parts[0].faces.find((f) => f.lod && f.normal[1] < -0.99);
  // 0.27 px per mm: the windows (14 mm) are 3.7 px, the joints (1.15 mm) only 0.3 px
  drawWorld(world, { eye: [0, -4000, 1800], target: [0, 0, 0] });
  assert.equal(front.decals, front.lod[1], "windows, but no sub-pixel joints");
});

test("by day the buildings stay in the greys from about mid grey up to white, seen from every side", () => {
  const world = createWorld({ objects: ALL });
  world.clock.set("12:00");
  for (const eye of [[2000, -3500, 2600], [2000, 5000, 2600], [-2500, 900, 2600], [6500, 900, 2600]]) {
    const { fills } = drawWorld(world, { eye, target: [2000, 900, 0] });
    let n = 0;
    for (const f of fills) {
      const c = typeof f === "string" ? parseRgba(f) : null;
      if (!c || c[3] < 0.5) continue; // soft shadows
      n++;
      // the darkest: windows and doors in the shade (0.47 × 0.75)
      assert.ok(Math.min(c[0], c[1], c[2]) >= 0.33 * 255, `too dark: ${f} (eye ${eye})`);
    }
    assert.ok(n > 300, `fills: ${n}`);
  }
  // walls in the shade are light grey, not mid grey
  for (const o of world.objects) {
    if (o.type === "building") continue; // (colours from the layout)
    for (const f of o.geometry.parts[0].faces) {
      const wall = Math.abs(f.normal[2]) < 1e-9 && f.pts.length === 4 && Math.min(...f.pts.map((p) => p[2])) === 0;
      if (wall) assert.ok(f.color[0] >= 0.6 * 255, `${o.id}: wall ${f.color[0].toFixed(0)}`);
    }
  }
});

/** Run module code in a child process (a regression that hangs fails instead of blocking the tests). */
function isolated(body) {
  const index = new URL("../../web/arail/index.js", import.meta.url).href;
  const code = `import { createWorld } from ${JSON.stringify(index)};\n${body}`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { timeout: 20_000, encoding: "utf8" });
  assert.equal(r.signal, null, "finished in time");
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("estate: an outline whose points coincide (three taps on one spot) gives no plots and no hang", () => {
  const out = isolated(`
    const out = [];
    for (const points of [[[100, 100], [100, 100], [100, 100]], [[0, 0], [500, 0], [1000, 0]], [[0, 0], [0, 0], [500, 500]]]) {
      const o = createWorld({ objects: [{ id: "e", type: "house-estate", points }] }).objects[0];
      out.push({ plots: o.geometry.plots.length, entrances: o.entrances().length, anchor: o.anchorPoint().every(Number.isFinite) });
    }
    console.log(JSON.stringify(out));`);
  assert.deepEqual(out, Array(3).fill({ plots: 0, entrances: 0, anchor: true }));
});

test("estate: no plot across a narrow notch of the outline", () => {
  // 1600 × 700 mm with a slit 20 mm (1.7 m) wide, cut in from the long edge, narrower than a plot
  const P = [[0, 0], [690, 0], [690, 600], [710, 600], [710, 0], [1600, 0], [1600, 700], [0, 700]];
  const world = createWorld({ objects: [{ id: "e", type: "house-estate", points: P, density: 1 }] });
  const g = world.objects[0].geometry;
  // (proper crossings only: plots may lie along the outline; 1e-6 mm² for rounding)
  const side = (o, a, b) => {
    const c = (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    return Math.abs(c) < 1e-6 ? 0 : Math.sign(c);
  };
  const crosses = (a, b, c, d) => side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
  assert.ok(g.plots.length >= 8, `plots: ${g.plots.length}`);
  for (const plot of g.plots) {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < P.length; j++) assert.ok(!crosses(plot[i], plot[(i + 1) % 4], P[j], P[(j + 1) % P.length]), "plot edge crosses the outline");
    }
  }
  for (const h of g.houses) assert.ok(Math.abs(h.center[0] - 700) > 50, "no house on the slit");
});

test("neighbouring blocks and estates are not clones; another seed gives another variant", () => {
  const block = { type: "altbau-block", position: [0, 0] };
  const area = (x) => [[x, 0], [x + 1200, 0], [x + 1200, 700], [x, 700]];
  const world = createWorld({ objects: [
    { id: "a1", ...block }, { id: "a2", ...block, position: [800, 0] },
    { id: "e1", type: "house-estate", points: area(0) }, { id: "e2", type: "house-estate", points: area(1300) },
  ] });
  const look = (o) => o.geometry.parts.map((p) => p.faces.map((f) => rgb(f.color).map(Math.round).join("/")).join()).join("|");
  const lit = (o) => o.geometry.windows.map((w) => w.h.toFixed(6)).join();
  const [a1, a2, e1, e2] = world.objects;
  assert.notEqual(look(a1), look(a2), "parcels of two blocks differ");
  assert.notEqual(lit(a1), lit(a2), "other windows lit");
  assert.notEqual(e1.geometry.houses.map((h) => h.style).join() + look(e1), e2.geometry.houses.map((h) => h.style).join() + look(e2));
  // the same layout always looks the same; a new seed gives another block
  const again = createWorld({ objects: [{ id: "a1", ...block }] }).objects[0];
  assert.equal(look(again), look(a1));
  const before = look(a1);
  a1.set({ seed: 2 });
  assert.notEqual(look(a1), before);
});

test("absurd sizes stay within the parameter ranges (a mistyped number must not hang the app)", () => {
  const out = isolated(`
    const world = createWorld({ objects: [
      { id: "b", type: "building", position: [0, 0], width_m: 1e6, depth_m: -50, floors: 1e4, floor_height_m: 0 },
      { id: "o", type: "office", position: [0, 0], floors: 1e6 },
      { id: "h", type: "house", position: [0, 0], floors: 1e6 },
    ] });
    const [b, o, h] = world.objects;
    const fp = b.footprint(), k = 1000 / 87;
    console.log(JSON.stringify({
      size: [Math.hypot(fp[1][0] - fp[0][0], fp[1][1] - fp[0][1]) / k, Math.hypot(fp[2][0] - fp[1][0], fp[2][1] - fp[1][1]) / k],
      height: b.heightMM() / k,
      floors: [b.floorsCount(), o.floorsCount(), h.floorsCount()],
      officeHeight: o.heightMM() / k,
      down: world.objects.some((x) => x.geometry.parts.some((p) => p.faces.some((f) => f.normal[2] < -0.5))),
    }));`);
  assert.ok(Math.abs(out.size[0] - 120) < 1e-6 && Math.abs(out.size[1] - 3) < 1e-6, `width at most 120 m, depth at least 3 m: ${out.size}`);
  assert.ok(Math.abs(out.height - 30 * 3 - Math.tan((35 * Math.PI) / 180) * 1.5) < 1e-6, "30 floors of 3 m (0 = default)");
  assert.deepEqual(out.floors, [30, 20, 2]);
  assert.ok(Math.abs(out.officeHeight - (20 * 3.6 + 0.9)) < 1e-6);
  assert.equal(out.down, false, "no faces turned inside out");
});
