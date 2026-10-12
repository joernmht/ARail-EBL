/**
 * Pointing at things: what is under a pixel of the stage, and an info card about it.
 *
 * Everything the world draws can be pointed at:
 * - **layout objects**: on the ground (their footprint, `contains`) and, when they are tall (a
 *   building, a signal mast; `pickHeight()`), also on their walls and roof;
 * - **what moves**, offered by the simulations and managers that draw it: each may have a
 *   `pickables(view)` that lists its {@link Pickable}s (people at the stops and on the sidewalks,
 *   trains and buses, cars, vans, containers).
 *
 * Who offers a pickable describes it: `owner.card(hit)` gives a {@link Card}; layout objects
 * describe themselves (`LayoutObject.card()`). Cards are data: the app shows them as a tooltip
 * (title, subtitle, status) and as an info card. Picking works in image pixels, so tall and lifted
 * things are found where they are seen, also in a tilted view.
 * @module arail/core/pick
 */
import { applyH, inv3, polygonArea } from "./math.js";
import { convexHull } from "./simple.js";

/**
 * Something on the stage that can be pointed at.
 * @typedef {object} Pickable
 * @property {string} key unique and stable while it exists, e.g. "object:platform-1", "person:town:r-12"
 * @property {string} kind "object" | "person" | "train" | "bus" | "car" | "van" | "drone" | "container" | …
 * @property {string} label its name, short
 * @property {number[][]} outline its footprint on the layout (mm)
 * @property {number} [z0] bottom above the layout (mm), default 0
 * @property {number} [z1] top above the layout (mm), default z0
 * @property {{card: (hit: Pickable) => Card}} owner who describes it: `owner.card(hit)`
 * @property {*} [ref] the thing itself (for its owner)
 */

/**
 * What there is to say about a pickable: shown as a tooltip (title, subtitle, status) and as an
 * info card (everything).
 * @typedef {object} Card
 * @property {string} title its name
 * @property {string} [subtitle] what it is ("Signal · relay interlocking")
 * @property {string} [status] one line about now ("4 min late", "Waiting for RE 1")
 * @property {"" | "ok" | "warn" | "bad"} [tone] of the status
 * @property {Array<[string, string | number]>} [rows] label and value
 * @property {Array<{title: string, lines?: string[], rows?: Array<[string, string | number]>}>} [sections] lists
 *   (next departures, …) and groups of rows (the train data)
 * @property {Array<{label: string, kind: string, length_m: number, isolated?: boolean}>} [strip] the vehicles of a
 *   train in order (its consist)
 * @property {string} [text] a description
 * @property {string[]} [related] ids of layout objects shown with it (the interlocking of a signal)
 * @property {Array<{id: string, label: string}>} [actions] what the app may do with it ("follow")
 */

/** Tolerance around outlines, in CSS pixels: a mouse is precise, a finger is not. */
export const PICK_TOLERANCE = { mouse: 4, touch: 12 };

/**
 * The layout point (mm) seen at an image pixel, or null (above the horizon).
 * @param {import("./view.js").View} view
 * @param {number[]} pixel [u, v]
 */
export function groundPoint(view, pixel) {
  const Hinv = view?.H ? inv3(view.H) : null;
  if (!Hinv) return null;
  const p = applyH(Hinv, pixel);
  if (!p.every(Number.isFinite)) return null;
  // the sky of a tilted view maps to the plane behind the camera
  return view.depth(p[0], p[1], 0) > 0 ? p : null;
}

/** The pickable of a layout object. */
export function objectPickable(o) {
  const z1 = typeof o.pickHeight === "function" ? o.pickHeight() || 0 : 0;
  return { key: `object:${o.id}`, kind: "object", label: o.name, outline: o.footprint() || [], z0: 0, z1, owner: o, ref: o };
}

/**
 * The pickables of what moves (not the layout objects), from the managers of the world
 * (timetable vehicles, line buses, trains of the control system) and its simulations.
 * @param {import("./world.js").World} world
 * @param {import("./view.js").View} view
 * @returns {Pickable[]}
 */
export function movingPickables(world, view) {
  const out = [];
  for (const source of [world.services, world.transit, world.trains, ...world.simulations]) {
    if (typeof source?.pickables !== "function") continue;
    for (const p of source.pickables(view) || []) if (p?.outline?.length) out.push(p);
  }
  return out;
}

/** The image outline (convex hull, px) of a pickable seen in a view, or null when it is not in front of the camera. */
export function projectedHull(view, p) {
  const z0 = p.z0 ?? 0, z1 = p.z1 ?? z0;
  const pts = p.outline.map((q) => [q[0], q[1], z0]);
  if (z1 !== z0) pts.push(...p.outline.map((q) => [q[0], q[1], z1]));
  const img = view.projectAll(pts);
  return img ? convexHull(img) : null;
}

/** Distance (px) of an image point from a convex polygon: 0 inside. */
function hullDistance(hull, u, v) {
  const n = hull.length;
  if (!n) return Infinity;
  if (n < 3) return Math.min(...hull.map((p) => Math.hypot(p[0] - u, p[1] - v)));
  let inside = true;
  for (let i = 0; i < n; i++) {
    const a = hull[i], b = hull[(i + 1) % n];
    if ((b[0] - a[0]) * (v - a[1]) - (b[1] - a[1]) * (u - a[0]) < 0) {
      inside = false;
      break;
    }
  }
  if (inside) return 0;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const a = hull[i], b = hull[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((u - a[0]) * dx + (v - a[1]) * dy) / l2));
    best = Math.min(best, Math.hypot(a[0] + dx * t - u, a[1] + dy * t - v));
  }
  return best;
}

/** Distance of a pickable's middle from the camera (mm). */
function depthOf(view, p) {
  const o = p.outline;
  const x = o.reduce((s, q) => s + q[0], 0) / o.length, y = o.reduce((s, q) => s + q[1], 0) / o.length;
  return view.depth(x, y, ((p.z0 ?? 0) + (p.z1 ?? p.z0 ?? 0)) / 2);
}

/**
 * The layout object at an image pixel: on the ground (its footprint, with a tolerance), or on the
 * walls and roof of a tall one. Small objects (placed at a point) win over long and large ones;
 * table modules only at their edges, and real tables never over the camera image (they are the
 * table itself), as in the editor.
 * @param {import("./world.js").World} world
 * @param {import("./view.js").View} view
 * @param {number[]} pixel [u, v]
 * @param {number[] | null} ground the layout point at the pixel
 * @param {number} tol tolerance (image px)
 * @returns {Pickable | null}
 */
export function pickObject(world, view, [u, v], ground, tol) {
  const k = ground ? view.pxPerMM(ground[0], ground[1], 0) : 0;
  const tolMM = k > 0 ? tol / k : 0;
  const rank = (o) => (o.constructor.background ? 2 : o.constructor.placement === "point" ? 0 : 1);
  let best = null;
  for (const o of world.objects) {
    if (!o.geometry || typeof o.footprint !== "function") continue;
    if (o.physical && !view.virtual) continue;
    const fp = o.footprint();
    if (!fp?.length) continue;
    let hit = false;
    if (o.constructor.background) hit = !!ground && onEdge(fp, ground, 1.5 * tolMM);
    else {
      hit = !!ground && o.contains(ground, tolMM);
      const z1 = typeof o.pickHeight === "function" ? o.pickHeight() || 0 : 0;
      if (!hit && z1 > 0) {
        const hull = projectedHull(view, { outline: fp, z0: 0, z1 });
        hit = !!hull && hullDistance(hull, u, v) <= tol;
      }
    }
    if (!hit) continue;
    const score = [rank(o), Math.abs(polygonArea(fp))];
    if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) best = { o, score };
  }
  return best ? objectPickable(best.o) : null;
}

function onEdge(fp, p, tol) {
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i], b = fp[(i + 1) % fp.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    if (Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]) <= tol) return true;
  }
  return false;
}

/**
 * What is at an image pixel: the nearest thing that moves whose outline is there (a person in front
 * of a bus wins), else a layout object, else null.
 * @param {import("./world.js").World} world
 * @param {import("./view.js").View} view the view of the last frame drawn
 * @param {number[]} pixel [u, v] image px
 * @param {{tolerance?: number, ground?: number[] | null}} [options] tolerance in CSS px
 *   ({@link PICK_TOLERANCE}); ground: the layout point at the pixel if it is known already
 * @returns {Pickable | null}
 */
export function pickAt(world, view, pixel, { tolerance = PICK_TOLERANCE.mouse, ground } = {}) {
  const [u, v] = pixel, tol = tolerance * (view.px || 1);
  let best = null;
  for (const p of movingPickables(world, view)) {
    const hull = projectedHull(view, p);
    if (!hull) continue;
    const d = hullDistance(hull, u, v);
    if (d > tol) continue;
    const score = [d > 0 ? 1 : 0, depthOf(view, p)];
    if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) best = { p, score };
  }
  if (best) return best.p;
  const g = ground === undefined ? groundPoint(view, pixel) : ground;
  return pickObject(world, view, pixel, g, tol);
}

/**
 * The pickable with this key now (it moves on), or null when it is gone.
 * @param {import("./world.js").World} world
 * @param {import("./view.js").View | null} view
 * @param {string} key
 */
export function findPickable(world, view, key) {
  if (key.startsWith("object:")) {
    const o = world.getObject(key.slice(7));
    return o?.geometry ? objectPickable(o) : null;
  }
  if (!view) return null;
  return movingPickables(world, view).find((p) => p.key === key) || null;
}

/**
 * The card of a pickable (its owner's `card`), with the fields every card has.
 * @param {Pickable} hit
 * @returns {Card}
 */
export function cardOf(hit) {
  const card = hit.owner?.card?.(hit) || {};
  return { title: hit.label, subtitle: "", status: "", tone: "", rows: [], sections: [], text: "", related: [], actions: [], ...card };
}
