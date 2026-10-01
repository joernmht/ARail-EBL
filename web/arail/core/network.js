/**
 * Road network: streets, footpaths and bus lanes as a graph for people, buses and cars.
 *
 * `world.network()` builds it from the objects of the layout and keeps it until objects, the
 * marker map or the scale change:
 * - **nodes** at the vertices of streets, where street ends meet, where a street ends on another
 *   one (T junction: that street is split) and where streets cross (X junction: both are split);
 * - **edges** along the streets (`kind` "road", or "path" for footpaths);
 * - **places**: every building entrance and every access point of a stop area is connected to the
 *   nearest street or footpath (within 80 m) by a short footpath (`kind` "connector"); keys
 *   `"building:<objectId>:<i>"` and `"area:<areaId>:<i>"`;
 * - **bus stops**: a node on the street where the front of a bus stopping at a bus dock is
 *   (`dock(dockId)`);
 * - **bus terminals**: their bus lane as one-way `lane` edges, connected to the nearest streets.
 *
 * Objects take part through duck-typed methods, so plugins can add their own: `roadInfo()`
 * (streets, see objects/road.js), `entrances()` (buildings), `stopAreas()` (stops) and
 * `busLane()` (bus lanes). Lengths are layout mm, speeds prototype m/s.
 *
 * Routes (`route`, `routeDirected`) are {@link Path}s. Without streets every query returns null,
 * and callers walk or drive straight.
 * @module arail/core/network
 */
import { clamp, dist2, dot2, lerp, polylineAt, polylineLengths, polylineProject, smoothstep, sub2, unit2 } from "./math.js";

/**
 * @typedef {object} Edge
 * @property {number} id
 * @property {number} a first node
 * @property {number} b second node
 * @property {number[][]} points polyline from a to b (layout mm)
 * @property {number[]} lengths cumulative lengths of `points` (mm)
 * @property {number} length mm
 * @property {string | null} road id of the street (or bus terminal for lanes); null for connectors
 * @property {"road" | "path" | "connector" | "lane"} kind
 * @property {boolean} car cars may drive here
 * @property {boolean} bus buses may drive here (streets and bus lanes)
 * @property {boolean} walk people may walk here
 * @property {boolean} oneway only from a to b
 * @property {number} speed speed limit (prototype m/s; walking speed for footpaths)
 * @property {number} width carriageway width (mm)
 * @property {number} walkOffset centre of the sidewalk from the centre line (mm), 0 for paths and connectors
 * @property {number} laneOffset centre of the right lane from the centre line (mm), 0 for single-lane roads
 */

/**
 * @typedef {object} Path
 * @property {number[][]} points polyline (layout mm)
 * @property {number[]} lengths cumulative lengths (mm)
 * @property {number} length mm
 * @property {number[]} nodes node ids along the path
 * @property {Array<{edge: Edge, forward: boolean, s0: number, s1: number}>} edges with their arc lengths on the path
 */

/** Split points closer than this (prototype m) become one node. */
const MERGE_M = 0.3;
/** Longest connector from a building entrance or stop access point to a street (m). */
export const PLACE_MAX_M = 80;
/** Longest distance from the front of a stopping bus to the centre of its street (m). */
const DOCK_MAX_M = 12;
/** Longest connector from a bus lane to a street (m). */
const LANE_MAX_M = 40;
/** Length over which lateral offsets (sidewalks, lanes) change (m). */
const BLEND_M = 4;
/** U-turn penalties (seconds): at a dead end (turning loop) and anywhere else. */
const UTURN_DEAD_END_S = 30;
const UTURN_S = 600;
/** Speed in bus lanes (m/s). */
const LANE_SPEED = 20 / 3.6;
/** Size of the cache of shortest-path trees. */
const TREE_CACHE = 400;

/**
 * Where a bus stands at a dock: front and rear point (layout mm) on its centre line, the
 * direction of travel and the lateral position (m, stop-area `t`).
 * @param {import("./stops.js").Dock} dock
 * @param {{extent: Function, gap_m?: number, width_m?: number}} def vehicle definition (BUS)
 */
export function dockPose(dock, def) {
  const area = dock.area;
  const [rear, front] = def.extent(dock);
  const t = dock.side * (area.W / 2 + (def.gap_m ?? 0.4) + (def.width_m ?? 2.55) / 2);
  return { front: area.toLayout(front, t), rear: area.toLayout(rear, t), dir: area.dir, t, length: front - rear };
}

/** Drop repeated points of a polyline. */
function dedupe(points) {
  const out = [];
  for (const p of points) if (!out.length || dist2(p, out[out.length - 1]) > 1e-6) out.push([p[0], p[1]]);
  return out;
}

/** Intersection of segments p1-p2 and q1-q2: {t, u, p} with t, u in [0, 1], or null. */
function segmentIntersection(p1, p2, q1, q2) {
  const r = sub2(p2, p1), s = sub2(q2, q1);
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const qp = sub2(q1, p1);
  const t = (qp[0] * s[1] - qp[1] * s[0]) / den, u = (qp[0] * r[1] - qp[1] * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, p: [p1[0] + r[0] * t, p1[1] + r[1] * t] };
}

/** Binary min-heap of (id, key) pairs for Dijkstra. */
class Heap {
  constructor() {
    this.ids = [];
    this.keys = [];
  }

  get size() {
    return this.ids.length;
  }

  push(id, key) {
    const { ids, keys } = this;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }

  /** Remove the smallest entry; returns [id, key]. */
  pop() {
    const { ids, keys } = this;
    const top = [ids[0], keys[0]];
    const id = ids.pop(), key = keys.pop();
    const n = ids.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = key;
        if (l < n && keys[l] < mk) {
          m = l;
          mk = keys[l];
        }
        if (r < n && keys[r] < mk) m = r;
        if (m === i) break;
        ids[i] = ids[m];
        keys[i] = keys[m];
        i = m;
      }
      ids[i] = id;
      keys[i] = key;
    }
    return top;
  }
}

export class RoadNetwork {
  /** @param {import("./world.js").World} world */
  constructor(world) {
    this.world = world;
    this.scale = world.scale;
    /** @type {Array<{id: number, pos: number[], edges: number[], kind: string, key?: string, degree: number, carDegree: number}>} */
    this.nodes = [];
    /** @type {Edge[]} */
    this.edges = [];
    /** Place key ("building:<id>:<i>", "area:<id>:<i>") -> node id. */
    this.places = new Map();
    /** Dock id -> {node, dir, pose}: where buses stop (front of the bus). */
    this.docks = new Map();
    /** Changes only when what vehicles drive on changes (streets, bus stops, bus lanes), not with buildings. */
    this.carKey = "";
    this._trees = new Map();
    this._build();
  }

  /** Prototype metres -> layout mm. */
  mm(m) {
    return (m * 1000) / this.scale;
  }

  /** Layout mm -> prototype metres. */
  meters(mm) {
    return (mm * this.scale) / 1000;
  }

  /* ---------------------------------------------------------------- building */

  _build() {
    const world = this.world, mm = (m) => this.mm(m);
    const roads = [];
    for (const o of world.objects) {
      if (typeof o.roadInfo !== "function" || !o.geometry) continue;
      const info = o.roadInfo();
      const pts = info?.points ? dedupe(info.points) : [];
      if (pts.length < 2) continue;
      const cum = polylineLengths(pts);
      roads.push({ id: o.id, info, pts, cum, L: cum[cum.length - 1], tol: Math.max(info.width / 2, mm(2)), splits: [] });
    }
    // split points along the streets; they are united into nodes (union-find)
    const pos = [], rank = [], parent = [];
    const split = (r, s, rk, p = null) => {
      const id = pos.length;
      pos.push(p || polylineAt(r.pts, s, r.cum).point);
      rank.push(rk);
      parent.push(id);
      r.splits.push({ s, id });
      return id;
    };
    const find = (i) => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]];
      return i;
    };
    const union = (a, b) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    };
    // rank: 3 = vertex inside a street (keeps its position), 2 = point on a street, 1 = street end
    for (const r of roads) {
      r.ends = [split(r, 0, 1, r.pts[0]), split(r, r.L, 1, r.pts[r.pts.length - 1])];
      for (let i = 1; i < r.pts.length - 1; i++) split(r, r.cum[i], 3, r.pts[i]);
    }
    // street ends that meet
    const ends = roads.flatMap((r) => r.ends.map((id) => ({ r, id })));
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        const a = ends[i], b = ends[j];
        if (a.r === b.r && a.r.L < 3 * a.r.tol) continue;
        if (dist2(pos[a.id], pos[b.id]) <= Math.max(a.r.tol, b.r.tol)) union(a.id, b.id);
      }
    }
    // T junctions: a street end on another street
    for (const r of roads) {
      r.ends.forEach((id, k) => {
        const p = pos[id];
        for (const q of roads) {
          const pr = polylineProject(q.pts, p, q.cum);
          if (pr.distance > q.tol) continue;
          if (q === r && Math.abs(pr.s - (k ? r.L : 0)) < 3 * r.tol) continue; // its own end
          if (pr.s <= q.tol) union(id, q.ends[0]);
          else if (pr.s >= q.L - q.tol) union(id, q.ends[1]);
          else union(id, split(q, pr.s, 2));
        }
      });
    }
    // X junctions: streets that cross (away from their ends)
    for (let i = 0; i < roads.length; i++) {
      for (let j = i + 1; j < roads.length; j++) {
        const r = roads[i], q = roads[j];
        for (let a = 1; a < r.pts.length; a++) {
          for (let b = 1; b < q.pts.length; b++) {
            const x = segmentIntersection(r.pts[a - 1], r.pts[a], q.pts[b - 1], q.pts[b]);
            if (!x) continue;
            const sr = r.cum[a - 1] + x.t * (r.cum[a] - r.cum[a - 1]), sq = q.cum[b - 1] + x.u * (q.cum[b] - q.cum[b - 1]);
            if (sr < r.tol || sr > r.L - r.tol || sq < q.tol || sq > q.L - q.tol) continue;
            union(split(r, sr, 2, x.p), split(q, sq, 2, x.p));
          }
        }
      }
    }
    const nearest = (p, maxMM, ok) => {
      let best = null;
      for (const r of roads) {
        if (!ok(r)) continue;
        const pr = polylineProject(r.pts, p, r.cum);
        if (pr.distance <= maxMM && (!best || pr.distance < best.distance)) best = { r, s: pr.s, distance: pr.distance };
      }
      return best;
    };
    const walkable = (r) => r.info.walk !== false, drivable = (r) => !!r.info.car;
    // places: building entrances and access points of stop areas
    const places = [];
    const addPlace = (key, p) => {
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
      const n = nearest(p, mm(PLACE_MAX_M), walkable);
      if (n) places.push({ key, pos: [p[0], p[1]], split: split(n.r, n.s, 2) });
    };
    for (const o of world.objects) {
      if (typeof o.entrances !== "function" || !o.geometry) continue;
      let list = [];
      try {
        list = o.entrances() || [];
      } catch {
        list = [];
      }
      list.forEach((e, i) => addPlace(`building:${o.id}:${i}`, e?.pos));
    }
    const areas = world.stopAreas();
    for (const area of areas) area.access.forEach((e, i) => addPlace(`area:${area.id}:${i}`, area.toLayout(e.s, e.t)));
    // bus terminals: lanes, connected to the nearest streets
    const lanes = [];
    for (const o of world.objects) {
      if (typeof o.busLane !== "function" || !o.geometry) continue;
      const l = o.busLane();
      const pts = l?.points ? dedupe(l.points) : [];
      if (pts.length < 2) continue;
      const a = nearest(pts[0], mm(LANE_MAX_M), drivable), b = nearest(pts[pts.length - 1], mm(LANE_MAX_M), drivable);
      lanes.push({ o, pts, cum: polylineLengths(pts), width: l.width || mm(3.5), in: a ? split(a.r, a.s, 2) : null, out: b ? split(b.r, b.s, 2) : null });
    }
    const laneOwners = new Set(lanes.map((l) => l.o));
    // bus stops on streets: a node where the front of a stopping bus is
    const def = world.registry?.vehicles?.get("bus");
    const dockSplits = [];
    if (def) {
      for (const area of areas) {
        if (area.kind !== "bus" || laneOwners.has(area.owner)) continue;
        for (const dock of area.docks) {
          if (dock.kind !== "bus") continue;
          const pose = dockPose(dock, def);
          const n = nearest(pose.front, mm(DOCK_MAX_M), drivable);
          if (n) dockSplits.push({ dock, pose, split: split(n.r, n.s, 2) });
        }
      }
    }
    // split points very close to each other are one node
    const eps = mm(MERGE_M);
    for (const r of roads) {
      r.splits.sort((a, b) => a.s - b.s);
      for (let i = 1; i < r.splits.length; i++) if (r.splits[i].s - r.splits[i - 1].s < eps) union(r.splits[i].id, r.splits[i - 1].id);
    }
    // nodes: the position of the highest-ranked member (street ends only: their mean)
    const groups = new Map();
    for (let i = 0; i < pos.length; i++) {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(i);
    }
    const nodeOf = new Map();
    for (const [root, members] of groups) {
      const best = Math.max(...members.map((m) => rank[m]));
      let p;
      if (best > 1) p = pos[members.find((m) => rank[m] === best)];
      else p = [members.reduce((s, m) => s + pos[m][0], 0) / members.length, members.reduce((s, m) => s + pos[m][1], 0) / members.length];
      nodeOf.set(root, this._node(p, best === 1 ? "end" : "street"));
    }
    const node = (splitId) => nodeOf.get(find(splitId));
    // street edges between consecutive nodes
    for (const r of roads) {
      const info = r.info;
      const attrs = {
        road: r.id, kind: info.car ? "road" : "path", car: !!info.car, bus: !!info.car, walk: info.walk !== false, oneway: false,
        speed: info.speed || 1.3, width: info.width, walkOffset: info.walkOffset || 0, laneOffset: info.laneOffset || 0,
      };
      let last = null;
      for (const sp of r.splits) {
        const n = node(sp.id);
        if (last && n === last.n && sp.s - last.s < 2 * eps) {
          last.s = sp.s;
          continue;
        }
        if (last) {
          const pts = [this.nodes[last.n].pos];
          for (let i = 1; i < r.pts.length - 1; i++) if (r.cum[i] > last.s + 1e-6 && r.cum[i] < sp.s - 1e-6) pts.push(r.pts[i]);
          pts.push(this.nodes[n].pos);
          this._edge(last.n, n, dedupe(pts), attrs);
        }
        last = { n, s: sp.s };
      }
    }
    // connectors from the places to their street
    for (const pl of places) {
      const n = node(pl.split);
      if (dist2(pl.pos, this.nodes[n].pos) < mm(0.2)) {
        this.places.set(pl.key, n);
        continue;
      }
      const p = this._node(pl.pos, "place");
      this.nodes[p].key = pl.key;
      this._edge(p, n, [pl.pos, this.nodes[n].pos], {
        road: null, kind: "connector", car: false, bus: false, walk: true, oneway: false, speed: 1.3, width: mm(2), walkOffset: 0, laneOffset: 0,
      });
      this.places.set(pl.key, p);
    }
    for (const d of dockSplits) this.docks.set(d.dock.id, { node: node(d.split), dir: d.pose.dir, pose: d.pose });
    this.carKey = JSON.stringify([
      roads.filter((r) => r.info.car).map((r) => [r.id, r.pts, r.info.width, r.info.speed, r.info.laneOffset]),
      dockSplits.map((d) => [d.dock.id, d.pose.front, d.pose.dir]),
      lanes.map((l) => [l.o.id, l.pts, l.width]),
    ]);
    // bus lanes: one-way edges past the bays, connected to the streets
    if (def) for (const l of lanes) this._addLane(l, def, node);
    for (const n of this.nodes) {
      n.degree = 0;
      n.carDegree = 0;
      for (const id of n.edges) {
        const e = this.edges[id];
        const k = e.a === e.b ? 2 : 1;
        if (e.kind === "road" || e.kind === "path") n.degree += k;
        if (e.kind === "road" && e.car) n.carDegree += k;
      }
    }
  }

  _addLane(l, def, node) {
    const lane = {
      road: l.o.id, kind: "lane", car: false, bus: true, walk: false, oneway: true,
      speed: LANE_SPEED, width: l.width, walkOffset: 0, laneOffset: 0,
    };
    const L = l.cum[l.cum.length - 1];
    const stops = [{ s: 0 }, { s: L }];
    for (const area of l.o.stopAreas()) {
      for (const dock of area.docks) {
        if (dock.kind !== "bus") continue;
        const pose = dockPose(dock, def);
        stops.push({ s: clamp(polylineProject(l.pts, pose.front, l.cum).s, 0, L), dock, pose });
      }
    }
    stops.sort((a, b) => a.s - b.s);
    const eps = this.mm(MERGE_M);
    let last = null;
    const ids = [];
    for (const st of stops) {
      if (!last || st.s - last.s >= eps) {
        const n = this._node(polylineAt(l.pts, st.s, l.cum).point, "lane");
        if (last) {
          const pts = [this.nodes[last.n].pos];
          for (let i = 1; i < l.pts.length - 1; i++) if (l.cum[i] > last.s + 1e-6 && l.cum[i] < st.s - 1e-6) pts.push(l.pts[i]);
          pts.push(this.nodes[n].pos);
          this._edge(last.n, n, pts, lane);
        }
        last = { n, s: st.s };
      }
      ids.push(last.n);
      if (st.dock) this.docks.set(st.dock.id, { node: last.n, dir: st.pose.dir, pose: st.pose });
    }
    const first = ids[0], end = ids[ids.length - 1];
    if (l.in != null) this._edge(node(l.in), first, [this.nodes[node(l.in)].pos, this.nodes[first].pos], lane);
    if (l.out != null) this._edge(end, node(l.out), [this.nodes[end].pos, this.nodes[node(l.out)].pos], lane);
  }

  _node(p, kind) {
    const n = { id: this.nodes.length, pos: [p[0], p[1]], edges: [], kind, degree: 0, carDegree: 0 };
    this.nodes.push(n);
    return n.id;
  }

  _edge(a, b, points, attrs) {
    const lengths = polylineLengths(points);
    const length = lengths[lengths.length - 1];
    const n = points.length;
    const e = {
      id: this.edges.length, a, b, points, lengths, length, ...attrs,
      dirA: unit2(sub2(points[Math.min(1, n - 1)], points[0])), dirB: unit2(sub2(points[n - 1], points[Math.max(0, n - 2)])),
    };
    this.edges.push(e);
    this.nodes[a].edges.push(e.id);
    if (b !== a) this.nodes[b].edges.push(e.id);
    return e;
  }

  /* ---------------------------------------------------------------- queries */

  /** Is there anything to route on? */
  get empty() {
    return !this.edges.length;
  }

  _id(n) {
    if (n == null) return null;
    const id = typeof n === "object" ? n.id : n;
    return Number.isInteger(id) && id >= 0 && id < this.nodes.length ? id : null;
  }

  node(id) {
    const i = this._id(id);
    return i == null ? null : this.nodes[i];
  }

  /** The node of a place ("building:<id>:<i>" or "area:<areaId>:<i>"), or null if it is not connected. */
  place(key) {
    if (key == null) return null;
    const id = this.places.get(key);
    return id == null ? null : this.nodes[id];
  }

  /** Where buses stop at a dock: {node, dir, pose}, or null if the dock is not on a street or lane. */
  dock(dockId) {
    const d = this.docks.get(dockId);
    return d ? { ...d, node: this.nodes[d.node] } : null;
  }

  _usable(e, mode) {
    return mode === "walk" ? e.walk : mode === "bus" ? e.bus : e.car;
  }

  /** Cost of an edge: length (mm) for walking, travel time (s) for vehicles. */
  _cost(e, mode) {
    return mode === "walk" ? e.length : this.meters(e.length) / Math.max(0.5, e.speed);
  }

  /**
   * The node nearest to a layout point that can be used in a mode, or null.
   * @param {number[]} p
   * @param {{mode?: "walk" | "car" | "bus"}} [options]
   */
  nearestNode(p, { mode = "walk" } = {}) {
    if (!p) return null;
    let best = null, bd = Infinity;
    for (const n of this.nodes) {
      if (!n.edges.some((id) => this._usable(this.edges[id], mode))) continue;
      const d = dist2(p, n.pos);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  /** Dead ends of the streets: where cars enter and leave the layout. */
  boundaryNodes() {
    if (!this._boundary) this._boundary = this.nodes.filter((n) => n.carDegree === 1);
    return this._boundary;
  }

  /** Junctions of three or more streets or footpaths. */
  junctions() {
    if (!this._junctions) this._junctions = this.nodes.filter((n) => n.degree >= 3);
    return this._junctions;
  }

  /** Shortest-path tree from a node (cached). */
  _tree(src, mode) {
    const key = `${mode}:${src}`;
    let t = this._trees.get(key);
    if (t) {
      // most recently used last
      this._trees.delete(key);
      this._trees.set(key, t);
      return t;
    }
    const n = this.nodes.length;
    const dist = new Float64Array(n).fill(Infinity), via = new Int32Array(n).fill(-1);
    const heap = new Heap();
    dist[src] = 0;
    heap.push(src, 0);
    while (heap.size) {
      const [u, d] = heap.pop();
      if (d > dist[u]) continue;
      for (const id of this.nodes[u].edges) {
        const e = this.edges[id];
        if (e.a === e.b || !this._usable(e, mode)) continue;
        const forward = e.a === u;
        if (!forward && e.oneway) continue;
        const v = forward ? e.b : e.a, nd = d + this._cost(e, mode);
        if (nd < dist[v]) {
          dist[v] = nd;
          via[v] = id;
          heap.push(v, nd);
        }
      }
    }
    t = { dist, via };
    this._trees.set(key, t);
    if (this._trees.size > TREE_CACHE) this._trees.delete(this._trees.keys().next().value);
    return t;
  }

  /**
   * Shortest route between two nodes (node objects or ids).
   * @param {{mode?: "walk" | "car" | "bus"}} [options] walking: shortest; vehicles: fastest
   * @returns {Path | null}
   */
  route(from, to, { mode = "walk" } = {}) {
    const a = this._id(from), b = this._id(to);
    if (a == null || b == null) return null;
    if (a === b) return this._path(a, []);
    const t = this._tree(a, mode);
    if (!Number.isFinite(t.dist[b])) return null;
    const seq = [];
    for (let v = b; v !== a;) {
      const e = this.edges[t.via[v]];
      const forward = e.b === v;
      seq.push({ e, forward });
      v = forward ? e.a : e.b;
    }
    return this._path(a, seq.reverse());
  }

  /** Length (mm, walking) or travel time (s, vehicles) of the shortest route; Infinity if there is none. */
  distance(from, to, mode = "walk") {
    const a = this._id(from), b = this._id(to);
    if (a == null || b == null) return Infinity;
    return this._tree(a, mode).dist[b];
  }

  /**
   * Route for a vehicle that leaves `from` heading `fromDir` and reaches `to` heading `toDir`
   * (from one bus stop to the next). Turning around costs a penalty: little at a dead end (a
   * turning loop), a lot anywhere else.
   * @returns {(Path & {cost: number, uturns: number}) | null}
   */
  routeDirected(from, fromDir, to, toDir, { mode = "bus" } = {}) {
    const a = this._id(from), b = this._id(to);
    if (a == null || b == null) return null;
    const E = this.edges;
    // arcs: 2 * edge id (+1 when driven from b to a)
    const leaving = (u) => {
      const out = [];
      for (const id of this.nodes[u].edges) {
        const e = E[id];
        if (!this._usable(e, mode)) continue;
        if (e.a === u) out.push(2 * id);
        if (e.b === u && !e.oneway) out.push(2 * id + 1);
      }
      return out;
    };
    const head = (arc) => (arc & 1 ? E[arc >> 1].a : E[arc >> 1].b);
    const startDir = (arc) => (arc & 1 ? [-E[arc >> 1].dirB[0], -E[arc >> 1].dirB[1]] : E[arc >> 1].dirA);
    const endDir = (arc) => (arc & 1 ? [-E[arc >> 1].dirA[0], -E[arc >> 1].dirA[1]] : E[arc >> 1].dirB);
    const aligned = (d, want) => !want || dot2(d, want) > 0.2;
    let starts = leaving(a).filter((arc) => aligned(startDir(arc), fromDir));
    if (!starts.length) starts = leaving(a);
    const goal = (arc) => head(arc) === b && aligned(endDir(arc), toDir);
    let anyGoal = false;
    for (const id of this.nodes[b].edges) {
      const e = E[id];
      if (!this._usable(e, mode)) continue;
      if ((e.b === b && goal(2 * id)) || (e.a === b && !e.oneway && goal(2 * id + 1))) anyGoal = true;
    }
    const isGoal = anyGoal ? goal : (arc) => head(arc) === b;
    const dist = new Map(), prev = new Map(), heap = new Heap();
    for (const arc of starts) {
      const c = this._cost(E[arc >> 1], mode);
      if (c < (dist.get(arc) ?? Infinity)) {
        dist.set(arc, c);
        prev.set(arc, -1);
        heap.push(arc, c);
      }
    }
    let found = -1;
    while (heap.size) {
      const [x, d] = heap.pop();
      if (d > dist.get(x)) continue;
      if (isGoal(x)) {
        found = x;
        break;
      }
      const v = head(x), dx = endDir(x);
      for (const y of leaving(v)) {
        let c = d + this._cost(E[y >> 1], mode);
        if ((y >> 1) === (x >> 1) && E[y >> 1].a !== E[y >> 1].b) c += this.nodes[v].carDegree <= 1 && this.nodes[v].kind !== "lane" ? UTURN_DEAD_END_S : UTURN_S;
        else if (dot2(dx, startDir(y)) < -0.95) c += UTURN_S;
        if (c < (dist.get(y) ?? Infinity)) {
          dist.set(y, c);
          prev.set(y, x);
          heap.push(y, c);
        }
      }
    }
    if (found < 0) return null;
    const arcs = [];
    for (let x = found; x !== -1; x = prev.get(x)) arcs.push(x);
    arcs.reverse();
    let uturns = 0;
    for (let i = 1; i < arcs.length; i++) if ((arcs[i] >> 1) === (arcs[i - 1] >> 1) || dot2(endDir(arcs[i - 1]), startDir(arcs[i])) < -0.95) uturns++;
    const path = this._path(a, arcs.map((x) => ({ e: E[x >> 1], forward: !(x & 1) })));
    path.cost = dist.get(found);
    path.uturns = uturns;
    return path;
  }

  /** Build a Path from a start node and a sequence of edges. */
  _path(start, seq) {
    const points = [this.nodes[start].pos], nodes = [start], edges = [];
    let s = 0;
    for (const { e, forward } of seq) {
      const pts = forward ? e.points : [...e.points].reverse();
      for (let i = 1; i < pts.length; i++) points.push(pts[i]);
      edges.push({ edge: e, forward, s0: s, s1: s + e.length });
      s += e.length;
      nodes.push(forward ? e.b : e.a);
    }
    const lengths = polylineLengths(points);
    return { points, lengths, length: lengths[lengths.length - 1], nodes, edges };
  }

  /**
   * Point, direction and sidewalk offset at arc length `s` (mm) of a path. `walkOffset` (mm,
   * to the right of the walking direction) changes smoothly where the path changes from a
   * street to a connector or footpath.
   * @param {Path} path
   * @param {number} s
   */
  pathAt(path, s) {
    const at = polylineAt(path.points, s, path.lengths);
    return { point: at.point, dir: at.dir, walkOffset: this.offsetAt(path, s, "walkOffset") };
  }

  /** Lateral offset (`walkOffset` or `laneOffset` of the edges, mm) at arc length `s` of a path, blended at changes. */
  offsetAt(path, s, key = "walkOffset") {
    const E = path?.edges;
    if (!E?.length) return 0;
    const val = (k) => E[k].edge[key] || 0;
    const i = edgeIndex(E, s), o = val(i);
    // the run of edges with this offset, and the runs before and after it
    let a = i, b = i;
    while (a > 0 && val(a - 1) === o) a--;
    while (b < E.length - 1 && val(b + 1) === o) b++;
    const run = E[b].s1 - E[a].s0, blend = this.mm(BLEND_M);
    if (a > 0) {
      let p = a - 1;
      while (p > 0 && val(p - 1) === val(a - 1)) p--;
      const B = Math.min(blend, run / 2, (E[a - 1].s1 - E[p].s0) / 2);
      if (B > 1e-9 && s - E[a].s0 < B) return lerp(val(a - 1), o, 0.5 + (0.5 * (s - E[a].s0)) / B);
    }
    if (b < E.length - 1) {
      let n = b + 1;
      while (n < E.length - 1 && val(n + 1) === val(b + 1)) n++;
      const B = Math.min(blend, run / 2, (E[n].s1 - E[b + 1].s0) / 2);
      if (B > 1e-9 && E[b].s1 - s < B) return lerp(val(b + 1), o, 0.5 + (0.5 * (E[b].s1 - s)) / B);
    }
    return o;
  }

  /** The edge of a path at arc length `s`: {edge, forward, s0, s1}. */
  edgeAt(path, s) {
    const E = path?.edges;
    return E?.length ? E[edgeIndex(E, s)] : null;
  }

  /**
   * The line a vehicle drives along a path: on the right lane (`laneOffset` of the edges), with
   * a turning loop where the path turns back and pull-ins at stops.
   * @param {Path} path centre-line path (from `route`, `routeDirected` or joined paths)
   * @param {{pulls?: Array<{s: number, offset: number, before: number, after: number}>, minLoop?: number}} [options]
   *   pulls: keep the lateral `offset` (mm, + = right of the direction of travel) from `s - before`
   *   to `s + after` (arc lengths on the path, mm), e.g. at a bus stop; minLoop: smallest radius
   *   of a turning loop (mm)
   * @returns {{points: number[][], lengths: number[], length: number, speeds: number[], marks: number[], centre: number[]}}
   *   speeds: speed limit (m/s) of each segment; marks: arc length on the driving line of each pull's `s`;
   *   centre: arc length on the path of each point
   */
  drivingLine(path, { pulls = [], minLoop = this.mm(3) } = {}) {
    const P = path.points, cum = path.lengths, n = P.length;
    const ramp = this.mm(BLEND_M * 3), step = this.mm(2);
    const offset = (s) => {
      let o = this.offsetAt(path, s, "laneOffset");
      for (const p of pulls) {
        const a = p.s - p.before, b = p.s + p.after;
        if (s >= a && s <= b) return p.offset;
        if (s > a - ramp && s < a) o = lerp(o, p.offset, smoothstep((s - (a - ramp)) / ramp));
        else if (s > b && s < b + ramp) o = lerp(p.offset, o, smoothstep((s - b) / ramp));
      }
      return o;
    };
    // where the offset changes, sample more densely
    const extra = [];
    for (const p of pulls) {
      for (let s = p.s - p.before - ramp; s <= p.s + p.after + ramp; s += step) extra.push(s);
      extra.push(p.s - p.before, p.s + p.after);
    }
    for (let i = 1; i < (path.edges || []).length; i++) {
      const E = path.edges;
      if ((E[i].edge.laneOffset || 0) !== (E[i - 1].edge.laneOffset || 0)) {
        for (let s = E[i].s0 - this.mm(BLEND_M); s <= E[i].s0 + this.mm(BLEND_M); s += step / 2) extra.push(s);
      }
    }
    extra.sort((x, y) => x - y);
    const out = [], speeds = [], outS = [];
    const speedAt = (s) => this.edgeAt(path, s)?.edge.speed ?? LANE_SPEED;
    const push = (p, s) => {
      if (out.length && dist2(p, out[out.length - 1]) < 1e-6) return;
      out.push(p);
      outS.push(s);
    };
    const right = (d) => [d[1], -d[0]];
    // the lane's corner point stands in for the samples close to a vertex where the path turns:
    // offset samples there would fold the lane back on itself (e.g. where a main road with a wider
    // lane offset meets a street), and a vehicle on such a fold blocks the others for good
    const setback = (j, o) => {
      if (j <= 0 || j >= n - 1) return 0;
      const a = unit2(sub2(P[j], P[j - 1])), b = unit2(sub2(P[j + 1], P[j]));
      const c = clamp(dot2(a, b), -1, 1);
      if (c > 0.9995) return 0;
      return Math.max(Math.abs(o), Math.abs(offset(cum[j]))) * Math.tan(Math.min(Math.acos(c) / 2, 1.3));
    };
    let k = 0;
    for (let i = 0; i < n; i++) {
      const s = cum[i], o = offset(s);
      const dIn = i > 0 ? unit2(sub2(P[i], P[i - 1])) : null, dOut = i < n - 1 ? unit2(sub2(P[i + 1], P[i])) : null;
      if (dIn && dOut && dot2(dIn, dOut) < -0.95) {
        // turning back: a loop around the vertex from the right lane in to the right lane out
        const r = Math.max(Math.abs(o), minLoop), rIn = right(dIn);
        const c = [P[i][0] + dIn[0] * r * 0.6, P[i][1] + dIn[1] * r * 0.6];
        push([P[i][0] + rIn[0] * o, P[i][1] + rIn[1] * o], s);
        for (let j = 0; j <= 10; j++) {
          const a = Math.PI * (j / 10);
          // from the right side over the front to the left side
          const ca = Math.cos(a), sa = Math.sin(a);
          push([c[0] + (rIn[0] * ca + dIn[0] * sa) * r, c[1] + (rIn[1] * ca + dIn[1] * sa) * r], s);
        }
        const rOut = right(dOut);
        push([P[i][0] + rOut[0] * offset(s + 1e-6), P[i][1] + rOut[1] * offset(s + 1e-6)], s);
      } else {
        const rIn = dIn ? right(dIn) : null, rOut = dOut ? right(dOut) : null;
        let m = rIn && rOut ? unit2([rIn[0] + rOut[0], rIn[1] + rOut[1]]) : rIn || rOut || [0, 0];
        const f = rIn && rOut ? 1 / Math.max(0.35, dot2(m, rIn)) : 1;
        if (!rIn && !rOut) m = [0, 0];
        push([P[i][0] + m[0] * o * f, P[i][1] + m[1] * o * f], s);
      }
      if (i < n - 1) {
        const r = right(dOut);
        while (k < extra.length && extra[k] <= s) k++;
        for (; k < extra.length && extra[k] < cum[i + 1]; k++) {
          const t = extra[k], q = polylineAt(P, t, cum).point, oo = offset(t);
          if (t - s < setback(i, oo) || cum[i + 1] - t < setback(i + 1, oo)) continue;
          push([q[0] + r[0] * oo, q[1] + r[1] * oo], t);
        }
      }
    }
    if (out.length < 2) out.push(out[0] ? out[0].slice() : [0, 0]);
    const lengths = polylineLengths(out);
    for (let i = 1; i < out.length; i++) speeds.push(speedAt((outS[i - 1] + (outS[i] ?? outS[i - 1])) / 2));
    // driving-line arc length of each pull's centre-line position
    const marks = pulls.map((p) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i < outS.length; i++) {
        const d = Math.abs(outS[i] - p.s);
        if (d < bd || (d === bd && out[i] && p.at && dist2(out[i], p.at) < dist2(out[best], p.at))) {
          bd = d;
          best = i;
        }
      }
      return lengths[best];
    });
    return { points: out, lengths, length: lengths[lengths.length - 1], speeds, marks, centre: outS };
  }

  /**
   * The junctions a vehicle crosses on a path, located on its driving line:
   * [{key, pos, r (radius, mm), s (arc length of the centre on the driving line)}].
   * @param {Path} path
   * @param {{lengths: number[], centre: number[]}} drive result of {@link drivingLine} for the path
   */
  junctionsAlong(path, drive) {
    const out = [];
    let k = 0;
    path.nodes.forEach((id, i) => {
      if (i === 0 || i === path.nodes.length - 1) return;
      const n = this.nodes[id];
      if (n.carDegree < 3) return;
      const cs = path.edges[i - 1].s1;
      while (k < drive.centre.length - 1 && drive.centre[k] < cs - 1e-6) k++;
      let r = 0;
      for (const e of n.edges) r = Math.max(r, this.edges[e].width / 2);
      out.push({ key: `${Math.round(n.pos[0])},${Math.round(n.pos[1])}`, pos: n.pos, r: r + this.mm(1), s: drive.lengths[k] });
    });
    return out;
  }
}

/** Index of the path edge containing arc length s (binary search over s0). */
function edgeIndex(E, s) {
  let lo = 0, hi = E.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (E[mid].s0 <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Join paths end to end into one path (the end node of each path is the start node of the next).
 * @param {Path[]} paths
 * @returns {Path}
 */
export function joinPaths(paths) {
  const points = [], nodes = [], edges = [];
  let s = 0;
  for (const p of paths) {
    if (!p) continue;
    const skip = points.length ? 1 : 0;
    for (let i = skip; i < p.points.length; i++) points.push(p.points[i]);
    for (let i = nodes.length ? 1 : 0; i < p.nodes.length; i++) nodes.push(p.nodes[i]);
    for (const e of p.edges) edges.push({ ...e, s0: e.s0 + s, s1: e.s1 + s });
    s += p.length;
  }
  const lengths = polylineLengths(points.length ? points : [[0, 0]]);
  return { points, lengths, length: lengths[lengths.length - 1], nodes, edges };
}
