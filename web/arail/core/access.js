/**
 * Street access: what people and vehicles come to by street must have a street that leads there.
 *
 * `accessProblems(world)` checks the layout on the road network (core/network.js):
 * - **bus stops and platforms**: people reach their access points from a street or footpath; buses
 *   stop at a bus stop on a street (`dock`);
 * - **bus terminals**: buses drive into the bus lane from a street and out onto one;
 * - **truck lanes** of the container terminal: trucks come from a street to the entry of the lane
 *   and leave onto one at its end;
 * - **buildings**: a street or footpath leads to each entrance; the maintenance base's vans need a
 *   street for cars; cars reach the way into a parking lot or garage;
 * - **tram stops** are at a tram track; **railway crossings**: a street that crosses a track at
 *   street level without a level crossing put there gets one, and trams never cross a railway at
 *   street level (BOStrab § 15): there the crossing becomes a bridge;
 * - **the streets themselves**: they form one network (a street that is not connected to the others
 *   is reached by no bus and no car), a street that ends just before another one is joined to it,
 *   and a street ends in the middle of the layout only on purpose (cars come and go at dead ends,
 *   as if the street went on beyond the layout).
 * What objects already report themselves (`problems()`: a bus stop not next to a street, a bus line
 * without a way) is not repeated. Each problem says where it is and, where one is plain, how to fix
 * it: a street or footpath to the nearest street (`street`), a street end moved onto the street it
 * almost meets (`join`), a railway crossing where a street crosses a track (`crossing`) or another
 * kind for one (`crossing-kind`). `applyFix` carries a fix out (the editor offers it as a button).
 * @module arail/core/access
 */
import { PLACE_MAX_M } from "./network.js";
import { polylineAt, polylineLengths, polylineProject, sub2, unit2 } from "./math.js";

/** Trucks reach a truck lane from a street this close to its entry (and leave onto one at its end), m. */
export const TRUCK_ACCESS_M = 20;
/** Buses drive into a bus terminal's lane from a street this close (as the road network connects it), m. */
export const LANE_ACCESS_M = 40;
/** A street end this close to another street, but not on it, is meant to join it (m). */
export const NEAR_MISS_M = 15;
/** A dead end this close to the edge of the layout leads out of it (m). */
export const EDGE_M = 10;
/** A fix draws a street at most this long (m); farther away the problem has no fix. */
export const FIX_MAX_M = 300;
/** A street out of the layout from a thing at its edge is this long (m). */
export const STUB_M = 30;

/**
 * @typedef {object} AccessProblem
 * @property {string} key stable and unique, e.g. "entrance:house-3:0"
 * @property {"error" | "warning"} level error: does not work (no bus stops, no truck comes); warning: works, but makes no sense
 * @property {string | null} id the object it is about
 * @property {string} text what is wrong, in English (translated by the patterns of the framework's catalogue)
 * @property {number[]} at where it is (layout mm)
 * @property {AccessFix | null} fix
 */

/**
 * @typedef {object} AccessFix
 * @property {"street" | "join" | "crossing" | "crossing-kind"} kind street: draw a street (or footpath)
 *   `points`; join: move end `end` (0 first, 1 last point) of street `id` to `to`; crossing: put a
 *   railway crossing of `crossingKind` at `to` (street `id`, track `track`); crossing-kind: give the
 *   railway crossing `id` the kind `crossingKind`
 * @property {string} text the button, e.g. "Add a footpath to Main Street"
 * @property {number[][]} [points] layout mm, from the thing to the street
 * @property {"street" | "path" | "underpass"} [roadKind] underpass: a footpath under the tracks (type `underpass`)
 * @property {string} [id]
 * @property {0 | 1} [end]
 * @property {number[]} [to]
 * @property {string} [track]
 * @property {string} [crossingKind]
 */

/** A parking lot or garage is reached by car from a street this close to its way in (m). */
export const PARKING_ACCESS_M = 30;

/** The name of an object for the texts: its name, else its kind and id. */
export function nameOf(obj) {
  const n = obj?.spec?.name || obj?.spec?.label || obj?.spec?.text;
  return n ? String(n) : `${obj?.constructor?.label || obj?.type || "Object"} ${obj?.id ?? ""}`.trim();
}

/** The streets of the world: {obj, info, pts, cum, L}, those with at least two points. */
function streets(world) {
  const out = [];
  for (const o of world.objects) {
    if (typeof o.roadInfo !== "function" || !o.geometry) continue;
    const info = o.roadInfo();
    const pts = info?.points || [];
    if (pts.length < 2 || info.hidden) continue; // an underpass is no street to come by
    const cum = polylineLengths(pts);
    out.push({ obj: o, info, pts, cum, L: cum[cum.length - 1] });
  }
  return out;
}

/**
 * The nearest point on a street to `p`: {road (object), point, distance (mm), s}, or null.
 * @param {import("./world.js").World} world
 * @param {number[]} p layout mm
 * @param {{car?: boolean, maxMM?: number, exclude?: string | null}} [options] car: only streets for cars
 */
export function nearestStreet(world, p, { car = false, maxMM = Infinity, exclude = null } = {}) {
  let best = null;
  for (const r of streets(world)) {
    if ((car && !r.info.car) || r.obj.id === exclude) continue;
    const pr = polylineProject(r.pts, p, r.cum);
    if (pr.distance <= maxMM && (!best || pr.distance < best.distance)) best = { road: r.obj, point: polylineAt(r.pts, pr.s, r.cum).point, distance: pr.distance, s: pr.s };
  }
  return best;
}

/**
 * The edge of the layout (layout mm, [x0, y0, x1, y1]): the table modules and the orthophoto,
 * else everything on it.
 */
export function layoutBounds(world) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (p) => {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
    b[0] = Math.min(b[0], p[0]);
    b[1] = Math.min(b[1], p[1]);
    b[2] = Math.max(b[2], p[0]);
    b[3] = Math.max(b[3], p[1]);
  };
  for (const o of world.objects) if (o.type === "tabletop") (o.geometry?.footprint || []).forEach(add);
  const ortho = world.layout?.view?.ortho?.bounds_mm;
  if (Array.isArray(ortho) && ortho.length === 4) {
    add([ortho[0], ortho[1]]);
    add([ortho[2], ortho[3]]);
  }
  if (b[0] <= b[2]) return b;
  for (const o of world.objects) {
    let fp = null;
    try {
      fp = typeof o.footprint === "function" ? o.footprint() : null;
    } catch {
      fp = null;
    }
    (fp || o.geometry?.points || []).forEach(add);
  }
  return b[0] <= b[2] ? b : null;
}

/**
 * What lacks street access in the layout, and the streets that make no sense.
 * @param {import("./world.js").World} world
 * @returns {AccessProblem[]} errors first, then warnings; within them by kind, then in the order of the objects
 */
export function accessProblems(world) {
  const net = world.network(), mm = (m) => (m * 1000) / world.scale, out = [];
  const roads = streets(world);
  const bounds = layoutBounds(world);
  /**
   * A street (or footpath) from a point to the nearest street; a footpath that would cross a track
   * goes under it (an underpass); without a street near, a street out to the edge of the layout.
   */
  const fixStreet = (from, { car, text, away = null }) => {
    const n = nearestStreet(world, from, { car, maxMM: mm(FIX_MAX_M) });
    if (n) {
      const under = !car && !net.empty && net.crossesBarrier(from, n.point);
      return {
        kind: "street", roadKind: car ? "street" : under ? "underpass" : "path", points: [[from[0], from[1]], n.point],
        text: (under ? "Add an underpass to {street}" : text).replace("{street}", nameOf(n.road)),
      };
    }
    if (!car || !bounds || roads.some((r) => r.info.car)) return null;
    // no street at all: one out to the nearest edge of the layout, where cars come from
    const edges = [[from[0] - bounds[0], [bounds[0], from[1]]], [bounds[2] - from[0], [bounds[2], from[1]]], [from[1] - bounds[1], [from[0], bounds[1]]], [bounds[3] - from[1], [from[0], bounds[3]]]];
    const [d, to] = edges.sort((a, b) => a[0] - b[0])[0];
    if (d > mm(STUB_M) / 2) return { kind: "street", roadKind: "street", points: [[from[0], from[1]], to], text: "Add a street to the edge of the layout" };
    // at the edge already: a short street on, out of the layout
    const out = away || unit2(sub2(from, [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]));
    const L = mm(STUB_M);
    return { kind: "street", roadKind: "street", points: [[from[0], from[1]], [from[0] + out[0] * L, from[1] + out[1] * L]], text: "Add a street out of the layout" };
  };
  const add = (p) => out.push({ fix: null, ...p });

  // stops: people come to the access points; buses stop at the docks of bus stops
  for (const area of world.stopAreas()) {
    const owner = area.owner, name = nameOf(owner);
    const lanes = typeof owner?.busLane === "function";
    // people get there if one of its ways in is connected; else the fix starts at the way in nearest a street
    if (area.access.length && !area.access.some((e, i) => net.place(`area:${area.id}:${i}`))) {
      const ways = area.access.map((e) => area.toLayout(e.s, e.t));
      const at = ways.map((w) => [w, nearestStreet(world, w)?.distance ?? Infinity]).sort((a, b) => a[1] - b[1])[0][0];
      add({
        key: `area:${area.id}`, level: "warning", id: owner?.id ?? null, at,
        text: `${name}: people cannot get there: no street or footpath within ${PLACE_MAX_M} m of its ways in`,
        fix: fixStreet(at, { car: false, text: "Add a footpath to {street}" }),
      });
    }
    if ((area.kind !== "bus" && area.kind !== "tram") || lanes || net.empty) continue;
    for (const dock of area.docks) {
      if (dock.kind !== area.kind || net.dock(dock.id)) continue;
      const text = area.kind === "tram" ? `${name}: trams cannot stop here: it is not at a tram track` : `${name}: buses cannot stop here: it is not right next to a street for buses`;
      add({ key: `dock:${dock.id}`, level: "error", id: owner?.id ?? null, at: area.toLayout((dock.s0 + dock.s1) / 2, 0), text });
    }
  }

  // railway crossings: a street across a track at street level needs a level crossing put there;
  // trams never cross a railway at street level (BOStrab § 15)
  const seenRail = new Set();
  for (const e of net.edges) {
    for (const r of e.rails || []) {
      if (!r.level) continue;
      const key = `${e.road}:${r.track}:${Math.round(r.pos[0])},${Math.round(r.pos[1])}`;
      if (seenRail.has(key)) continue;
      seenRail.add(key);
      const road = world.getObject(e.road), track = world.getObject(r.track);
      if (e.tramBlocked && e.tramBlocked === r) {
        add({
          key: `rail:${key}`, level: "error", id: e.road, at: r.pos,
          text: `${nameOf(road)}: trams cannot cross ${nameOf(track)} at street level (BOStrab § 15): a bridge or an underpass is needed`,
          fix: r.crossing?.obj
            ? { kind: "crossing-kind", id: r.crossing.id, crossingKind: "over", text: "Make it a bridge over the track" }
            : { kind: "crossing", id: e.road, track: r.track, to: r.pos, crossingKind: "over", text: "Build a bridge over the track" },
        });
      } else if (!r.crossing && e.car) {
        add({
          key: `rail:${key}`, level: "warning", id: e.road, at: r.pos,
          text: `${nameOf(road)} crosses ${nameOf(track)} at street level without a railway crossing`,
          fix: { kind: "crossing", id: e.road, track: r.track, to: r.pos, crossingKind: "half-barriers", text: "Add a level crossing with half barriers" },
        });
      }
    }
  }

  // parking lots and garages: cars drive in from a street
  for (const o of world.objects) {
    if (typeof o.parkingInfo !== "function" || !o.geometry || o.type === "road" || o.type === "supermarket") continue;
    for (const f of o.parkingInfo() || []) {
      if (!f.entry || nearestStreet(world, f.entry, { car: true, maxMM: mm(PARKING_ACCESS_M) })) continue;
      add({
        key: `parking:${f.id}`, level: "error", id: o.id, at: f.entry,
        text: `${nameOf(o)}: cars cannot get in: no street within ${PARKING_ACCESS_M} m of its way in`,
        fix: fixStreet(f.entry, { car: true, text: "Add a street to {street}" }),
      });
    }
  }

  // bus terminals: into the bus lane from a street, out onto one
  for (const o of world.objects) {
    if (typeof o.busLane !== "function" || !o.geometry) continue;
    const pts = o.busLane()?.points || [];
    if (pts.length < 2) continue;
    [[pts[0], 0, "drive in"], [pts[pts.length - 1], 1, "drive out"]].forEach(([p, k, how]) => {
      if (nearestStreet(world, p, { car: true, maxMM: mm(LANE_ACCESS_M) })) return;
      add({
        key: `lane:${o.id}:${k}`, level: "error", id: o.id, at: p,
        text: `${nameOf(o)}: buses cannot ${how}: no street within ${LANE_ACCESS_M} m of its bus lane`,
        fix: fixStreet(p, { car: true, text: "Add a street to {street}" }),
      });
    });
  }

  // truck lanes of the container terminal: from a street to the entry, from the end onto a street
  for (const o of world.objects) {
    if (o.type !== "truck-lane" || !o.geometry) continue;
    const pts = o.geometry.points, n = pts.length;
    [
      [pts[0], 0, "trucks cannot get to it: no street at its entry (its first point)", unit2(sub2(pts[0], pts[1]))],
      [pts[n - 1], 1, "trucks cannot leave it: no street at its end (its last point)", unit2(sub2(pts[n - 1], pts[n - 2]))],
    ].forEach(([p, k, what, away]) => {
      if (nearestStreet(world, p, { car: true, maxMM: mm(TRUCK_ACCESS_M) })) return;
      add({
        key: `truck:${o.id}:${k}`, level: "error", id: o.id, at: p, text: `${nameOf(o)}: ${what}`,
        fix: fixStreet(p, { car: true, text: "Add a street to {street}", away }),
      });
    });
  }

  // buildings: a street or footpath to each entrance; the vans of the maintenance base need a street
  for (const o of world.objects) {
    if (typeof o.entrances !== "function" || !o.geometry) continue;
    let list = [];
    try {
      list = o.entrances() || [];
    } catch {
      list = [];
    }
    const vans = o.type === "maintenance-base";
    list.forEach((e, i) => {
      if (!e?.pos) return;
      if (vans) {
        if (nearestStreet(world, e.pos, { car: true, maxMM: mm(PLACE_MAX_M) })) return;
        add({
          key: `entrance:${o.id}:${i}`, level: "error", id: o.id, at: e.pos,
          text: `${nameOf(o)}: its vans cannot drive out: no street for cars within ${PLACE_MAX_M} m of its gate`,
          fix: fixStreet(e.pos, { car: true, text: "Add a street to {street}" }),
        });
        return;
      }
      if (net.place(`building:${o.id}:${i}`)) return;
      add({
        key: `entrance:${o.id}:${i}`, level: "warning", id: o.id, at: e.pos,
        text: `${nameOf(o)}: no street or footpath within ${PLACE_MAX_M} m of its entrance`,
        fix: fixStreet(e.pos, { car: false, text: "Add a footpath to {street}" }),
      });
    });
  }

  // street ends: just before another street (join them), or a dead end in the middle of the layout
  const edge = mm(EDGE_M), nearMisses = [];
  for (const r of roads) {
    const own = net.edges.filter((e) => e.road === r.obj.id);
    if (!own.length) continue;
    for (const k of [0, 1]) {
      const p = k ? r.pts[r.pts.length - 1] : r.pts[0];
      // the edges of a street follow it from its first point to its last
      const node = net.nodes[k ? own[own.length - 1].b : own[0].a];
      if (node.degree !== 1) continue; // joined to another street
      let near = null;
      // a tram track of its own joins only what has tram tracks; a street does not join a tram track
      const tramOnly = (x) => x.info.kind === "tram", tracks = (x) => !!x.info.tram && x.info.tram !== "none";
      for (const q of roads) {
        if (q === r || (tramOnly(r) ? !tracks(q) : tramOnly(q))) continue;
        const pr = polylineProject(q.pts, p, q.cum), tol = Math.max(q.info.width / 2, mm(2));
        if (pr.distance > tol && pr.distance <= mm(NEAR_MISS_M) && (!near || pr.distance < near.distance)) near = { q, s: pr.s, distance: pr.distance };
      }
      if (near) {
        nearMisses.push({ r, q: near.q });
        add({
          key: `near:${r.obj.id}:${k}`, level: "warning", id: r.obj.id, at: p,
          text: `${nameOf(r.obj)} ends ${Math.round((near.distance * world.scale) / 1000)} m before ${nameOf(near.q.obj)}: join them`,
          fix: { kind: "join", id: r.obj.id, end: k, to: polylineAt(near.q.pts, near.s, near.q.cum).point, text: `Join it to ${nameOf(near.q.obj)}` },
        });
        continue;
      }
      if (!r.info.car || !bounds) continue;
      const inside = p[0] - bounds[0] > edge && bounds[2] - p[0] > edge && p[1] - bounds[1] > edge && bounds[3] - p[1] > edge;
      if (inside) add({ key: `dead:${r.obj.id}:${k}`, level: "warning", id: r.obj.id, at: p, text: `${nameOf(r.obj)}: dead end inside the layout: cars appear and vanish here. Lead it to the edge of the layout, or join it to another street` });
    }
  }

  // streets for cars that are not connected to the others: each group but the largest (unless one
  // of its streets just misses another group: joining them is the fix)
  if (!net.empty) {
    carGroups(net).slice(1).forEach((g) => {
      if (nearMisses.some((m) => g.roads.has(m.r.obj.id) !== g.roads.has(m.q.obj.id))) return;
      const mine = roads.filter((x) => g.roads.has(x.obj.id)), others = roads.filter((x) => x.info.car && !g.roads.has(x.obj.id));
      if (!mine.length) return;
      // the closest pair of an end of this group and a street of the others
      let best = null;
      for (const x of mine) {
        for (const p of [x.pts[0], x.pts[x.pts.length - 1]]) {
          for (const y of others) {
            const pr = polylineProject(y.pts, p, y.cum);
            if (!best || pr.distance < best.distance) best = { p, y, s: pr.s, distance: pr.distance };
          }
        }
      }
      add({
        key: `island:${[...g.roads].sort().join(",")}`, level: "warning", id: mine[0].obj.id, at: mine[0].pts[0],
        text: `${[...g.roads].map((id) => nameOf(world.getObject(id))).join(", ")}: not connected to the other streets: no bus and no car comes from them`,
        fix: best && best.distance <= mm(FIX_MAX_M)
          ? { kind: "street", roadKind: "street", points: [[best.p[0], best.p[1]], polylineAt(best.y.pts, best.s, best.y.cum).point], text: `Add a street to ${nameOf(best.y.obj)}` }
          : null,
      });
    });
  }

  // errors first; then what is cut off, streets on their own, ends to join, dead ends
  const rank = { error: 0, warning: 1 }, order = ["dock", "rail", "lane", "truck", "parking", "entrance", "area", "island", "near", "dead"];
  const kind = (p) => order.indexOf(p.key.split(":")[0]);
  return out.map((p, i) => [p, i]).sort((a, b) => rank[a[0].level] - rank[b[0].level] || kind(a[0]) - kind(b[0]) || a[1] - b[1]).map(([p]) => p);
}

/**
 * The groups of streets for cars that are connected to each other, the largest (by length) first:
 * [{roads: Set of street ids, length}].
 */
export function carGroups(net) {
  const seen = new Set(), groups = [];
  for (const start of net.nodes) {
    if (seen.has(start.id) || !start.edges.some((id) => net.edges[id].car)) continue;
    const roads = new Set(), stack = [start.id];
    let length = 0;
    seen.add(start.id);
    while (stack.length) {
      const n = net.nodes[stack.pop()];
      for (const id of n.edges) {
        const e = net.edges[id];
        if (!e.car && e.kind !== "lane") continue;
        if (e.car && e.road) roads.add(e.road);
        if (e.car && n.id === e.a) length += e.length; // each edge once
        for (const m of [e.a, e.b]) {
          if (!seen.has(m)) {
            seen.add(m);
            stack.push(m);
          }
        }
      }
    }
    if (roads.size) groups.push({ roads, length });
  }
  return groups.sort((a, b) => b.length - a.length);
}

/**
 * Carry a fix out: draw its street (footpath, underpass) or move the street end. Returns the object
 * added or changed, or null if the fix does not fit the layout any more.
 * @param {import("./world.js").World} world
 * @param {AccessFix} fix
 * @param {{name?: string}} [options] name: of a new street
 */
export function applyFix(world, fix, { name } = {}) {
  const round = (p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
  if (fix?.kind === "street" && fix.points?.length >= 2) {
    const points = fix.points.map(round);
    const spec = fix.roadKind === "underpass" ? { type: "underpass", points } : { type: "road", kind: fix.roadKind === "path" ? "path" : "street", points };
    if (name) spec.name = name;
    return world.addObject(spec);
  }
  if (fix?.kind === "crossing" && fix.to) {
    return world.addObject({ type: "rail-crossing", kind: fix.crossingKind || "half-barriers", position: round(fix.to), road: fix.id, track: fix.track });
  }
  if (fix?.kind === "crossing-kind") {
    const c = world.getObject(fix.id);
    if (!c) return null;
    c.set({ kind: fix.crossingKind });
    return c;
  }
  if (fix?.kind === "join") {
    const road = world.getObject(fix.id);
    const pts = Array.isArray(road?.spec.points) ? road.spec.points.slice() : null;
    if (!pts || pts.length < 2) return null;
    pts[fix.end ? pts.length - 1 : 0] = round(fix.to);
    road.set({ points: pts });
    return road;
  }
  return null;
}

