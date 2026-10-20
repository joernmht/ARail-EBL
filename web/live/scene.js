/**
 * The live page's scene (testable in Node): a layout reduced to its town (buildings, streets, trees,
 * parking, traffic signs and lights, table modules) and the road traffic on it, in a world with a
 * registry of only what that needs. Everything else of a layout (platforms and their passengers,
 * stops and lines, the terminal, the modules, scenarios, plugins) stays out, so the live page loads
 * and runs a fraction of the framework.
 *
 * What moves is drawn in every frame; the town is drawn into a picture of its own (live/cache.js),
 * under it. A car behind a building would be drawn over it, so the buildings that may hide a car
 * are cut out of the canvas of what moves, in depth order with the cars (`occluders`, `cutOut`).
 * @module live/scene
 */
import { FlyCamera } from "../arail/core/flycam.js";
import { Registry } from "../arail/core/registry.js";
import { World } from "../arail/core/world.js";
import { BUS, TRAIN, TRAM } from "../arail/core/vehicles.js";
import { movingPickables, objectPickable, projectedHull } from "../arail/core/pick.js";
import { registerObjects } from "../arail/objects/index.js";
import { TrafficSimulation } from "../arail/sims/traffic.js";
import { CyclingSimulation } from "../arail/sims/cycling.js";

/** Object types the live page keeps: the town, what the road traffic needs, and the heights of the table. */
export const CITY_TYPES = new Set([
  "road", "underpass", "traffic-sign", "traffic-light", "zebra-crossing", "rail-crossing", "parking-lot", "parking-garage",
  "bike-stand", "building", "station-building", "plattenbau", "altbau-block", "house", "house-estate", "office", "school",
  "supermarket", "factory", "tree", "forest", "area", "track", "tabletop",
]);

/** The simulations the live page can run: cars, and bikes and e-scooters. */
export const LIVE_SIMULATIONS = [TrafficSimulation, CyclingSimulation];

/** A registry with the object types of the framework and only the live page's simulations. */
export function liveRegistry() {
  const registry = registerObjects(new Registry());
  for (const cls of LIVE_SIMULATIONS) registry.registerSimulation(cls);
  for (const v of [TRAIN, BUS, TRAM]) registry.registerVehicle(v);
  return registry;
}

/**
 * A layout file reduced to its town and its road traffic: the objects of {@link CITY_TYPES} of its
 * base (its modules stay out), the simulations asked for with the layout's own settings of them.
 * @param {object} json layout file contents
 * @param {{simulations?: string[], cars?: number | null}} [options] simulations: types (of
 *   {@link LIVE_SIMULATIONS}); cars: cars per km of street instead of the layout's
 * @returns {object} a layout file
 */
export function liveLayout(json, { simulations = ["traffic"], cars = null } = {}) {
  const known = new Set(LIVE_SIMULATIONS.map((s) => s.type));
  const own = Array.isArray(json.simulations) ? json.simulations : [];
  const sims = simulations.filter((t) => known.has(t)).map((type) => ({ ...(own.find((s) => s?.type === type) || {}), type }));
  const traffic = sims.find((s) => s.type === "traffic");
  if (traffic && Number.isFinite(cars) && cars >= 0) traffic.cars_per_km = cars;
  return {
    format: json.format,
    name: json.name,
    scale: json.scale,
    markers: json.markers,
    services: json.services,
    clock: json.clock,
    grid: json.grid,
    simulations: sims,
    objects: (Array.isArray(json.objects) ? json.objects : []).filter((o) => CITY_TYPES.has(o?.type)),
  };
}

/**
 * The world of the live page: the reduced layout (see {@link liveLayout}) in a world with the live
 * registry, without labels, trails and the lighting of the clock (the town is drawn by day: a
 * picture drawn once cannot follow the light).
 * @param {object} json layout file contents
 * @param {{simulations?: string[], cars?: number | null, seed?: number}} [options]
 */
export function createLiveWorld(json, { seed, ...options } = {}) {
  const world = new World({ registry: liveRegistry(), layout: liveLayout(json, options), seed });
  Object.assign(world.settings, { labels: false, stopBoards: false, trails: false, lighting: false });
  return world;
}

/** Bounding box [x0, y0, x1, y1] of image points. */
function box(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return [x0, y0, x1, y1];
}

const overlap = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/** Do two convex polygons (image px) overlap? No edge of either separates them. */
function convexOverlap(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], nx = q[1] - p[1], ny = p[0] - q[0];
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const v of a) {
        const d = v[0] * nx + v[1] * ny;
        if (d < minA) minA = d;
        if (d > maxA) maxA = d;
      }
      for (const v of b) {
        const d = v[0] * nx + v[1] * ny;
        if (d < minB) minB = d;
        if (d > maxB) maxB = d;
      }
      if (maxA < minB || maxB < minA) return false;
    }
  }
  return true;
}

/** Nearest and farthest distance (mm along the view) of a pickable's outline from bottom to top. */
function depths(view, p) {
  let near = Infinity, far = -Infinity;
  for (const z of [p.z0 ?? 0, p.z1 ?? p.z0 ?? 0]) {
    for (const q of p.outline) {
      const d = view.depth(q[0], q[1], z);
      if (d < near) near = d;
      if (d > far) far = d;
    }
  }
  return [near, far];
}

/**
 * The tall layout objects (buildings) that may hide something that moves (cars, bikes, people on
 * foot) in a view: their outline in the picture (the convex hull of the footprint from the ground
 * to the top) overlaps its outline, and some of the building is nearer to the camera than the
 * farthest point of it. Each with its outline and its depth for sorting (the middle of the
 * footprint at half the height, as the View sorts a prism).
 * @param {World} world
 * @param {import("../arail/core/view.js").View} view
 * @returns {{object: import("../arail/core/object.js").LayoutObject, hull: number[][], depth: number}[]}
 */
export function occluders(world, view) {
  // seen at the street level, where they are drawn (on raised table modules and bridges)
  return view.withLift(world.elevation.sync().streetLift, () => {
    const moving = [];
    for (const p of movingPickables(world, view)) {
      const hull = projectedHull(view, p);
      if (hull?.length) moving.push({ hull, box: box(hull), far: depths(view, p)[1] });
    }
    if (!moving.length) return [];
    const out = [];
    for (const o of world.objects) {
      if (!o.geometry || typeof o.footprint !== "function" || !(o.pickHeight() > 0)) continue;
      const p = objectPickable(o);
      if (!p.outline.length) continue;
      const hull = projectedHull(view, p);
      if (!hull?.length) continue;
      const b = box(hull), near = depths(view, p)[0];
      if (!moving.some((m) => near < m.far && overlap(m.box, b) && convexOverlap(m.hull, hull))) continue;
      const n = p.outline.length, cx = p.outline.reduce((s, q) => s + q[0], 0) / n, cy = p.outline.reduce((s, q) => s + q[1], 0) / n;
      out.push({ object: o, hull, depth: view.depth(cx, cy, p.z1 / 2) });
    }
    return out;
  });
}

/**
 * Cut the outlines of buildings out of what moves: queued as solids of the view, they are drawn in
 * depth order with the cars, each erasing (destination-out) what was drawn before it, which is what
 * lies behind it. The town's picture under the canvas then shows the building there. One polygon
 * per building instead of drawing it again.
 * @param {import("../arail/core/view.js").View} view
 * @param {{hull: number[][], depth: number}[]} list see {@link occluders}
 */
export function cutOut(view, list) {
  for (const { hull, depth } of list) {
    view.solid(depth, (ctx) => {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "#000";
      ctx.beginPath();
      hull.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
      ctx.closePath();
      ctx.fill();
    });
  }
}

/**
 * A visitor's head in front of the town, for trying the page without a camera (`?demo=1`): standing
 * in front of the densest group of buildings, looking around it (the head turns: the picture of the
 * town only needs fitting), swaying a little and, every 15 s, stepping aside (the head moves: the
 * roofs shift against the ground and the town is drawn again).
 */
export class Visitor {
  /** @param {World} world */
  constructor(world) {
    const centres = world.objects.filter((o) => o.geometry && typeof o.footprint === "function" && o.pickHeight() > 0).map((o) => {
      const fp = o.footprint();
      return [fp.reduce((s, p) => s + p[0], 0) / fp.length, fp.reduce((s, p) => s + p[1], 0) / fp.length];
    });
    const near = (c, r) => centres.filter((d) => Math.hypot(d[0] - c[0], d[1] - c[1]) <= r);
    const R = world.scale > 0 ? 80000 / world.scale : 900; // 80 m around a building
    const best = centres.reduce((b, c) => (!b || near(c, R).length > near(b, R).length ? c : b), null) || [0, 0];
    const group = near(best, R);
    /** Middle of the town looked at (layout mm). */
    this.centre = group.length ? [group.reduce((s, c) => s + c[0], 0) / group.length, group.reduce((s, c) => s + c[1], 0) / group.length] : best;
    /** Its radius (mm). */
    this.radius = Math.max(300, ...group.map((c) => Math.hypot(c[0] - this.centre[0], c[1] - this.centre[1]) + 150));
    this.camera = new FlyCamera();
  }

  /**
   * The visitor's view at a time.
   * @param {number} t seconds
   * @returns {FlyCamera}
   */
  at(t) {
    const r = this.radius, wave = (period, phase = 0) => Math.sin((2 * Math.PI * t) / period + phase);
    const yaw = Math.PI / 2 + 0.22 * wave(11), pitch = 0.5 + 0.06 * wave(7.3, 1);
    const eye = [
      this.centre[0] + 0.35 * r * Math.tanh(3 * wave(30)) + 6 * wave(3.1),
      this.centre[1] - 1.6 * r + 4 * wave(4.3, 2),
      0.9 * r + 3 * wave(5.7, 3),
    ];
    const distance = eye[2] / Math.sin(pitch), ahead = distance * Math.cos(pitch);
    return this.camera.set({ target: [eye[0] + ahead * Math.cos(yaw), eye[1] + ahead * Math.sin(yaw)], distance, yaw, pitch });
  }
}
