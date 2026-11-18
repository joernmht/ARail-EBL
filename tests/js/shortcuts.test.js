// The simulation's shortcuts against the plain way they replace, to the bit: the search for the
// junction ahead that goes on where it ended, the bisection of polylineAt and polylinePoint, the
// lengths of walks the road network keeps, and the offsets along a path worked out once per run of
// edges. The plain ways are written out here as they were before (the simulation's results must not
// change by these shortcuts; see docs/architecture.md).
import assert from "node:assert/strict";
import test from "node:test";

import { createRng, createWorld, lerp, lerp2, polylineAt, polylineLengths, polylinePoint, sub2, unit2 } from "../../web/arail/index.js";
import { junctionAhead } from "../../web/arail/core/transit.js";
import { readJSON } from "./helpers.js";

const NEUSTADT = readJSON("web/layouts/ebl-neustadt.json");

/** polylineAt as it was: the segment found by walking along the cumulative lengths. */
function plainPolylineAt(pts, s, cum = polylineLengths(pts)) {
  const total = cum[cum.length - 1];
  if (pts.length < 2) return { point: pts[0] || [0, 0], dir: [1, 0] };
  s = Math.min(Math.max(s, 0), total);
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (s - cum[i - 1]) / seg;
  return { point: lerp2(pts[i - 1], pts[i], t), dir: unit2(sub2(pts[i], pts[i - 1])) };
}

test("junctionAhead is the first junction whose far side is ahead, also when the search goes back", () => {
  const rng = createRng(3);
  for (let k = 0; k < 200; k++) {
    let s0 = 0;
    const junctions = Array.from({ length: rng.int(8) }, () => ({ s: (s0 += rng.uniform(0, 300)), r: rng.uniform(0, 40) }));
    const other = Array.from({ length: 3 }, (_, i) => ({ s: 100 * i, r: 20 }));
    let s = rng.uniform(-50, 50);
    for (let step = 0; step < 60; step++) {
      // mostly forward, at times standing, at times back (a vehicle set back on its line)
      const r = rng.next();
      s += r < 0.15 ? -rng.uniform(0, 400) : r < 0.25 ? 0 : rng.uniform(0, 120);
      assert.equal(junctionAhead(junctions, s), junctions.find((x) => x.s + x.r > s), `list ${k}, s = ${s}`);
      // another list searched in between keeps its own place
      const t = rng.uniform(-20, 260);
      assert.equal(junctionAhead(other, t), other.find((x) => x.s + x.r > t));
    }
  }
});

test("polylineAt and polylinePoint find the same segment by bisection as by walking along, repeated points too", () => {
  const rng = createRng(5);
  for (let k = 0; k < 300; k++) {
    const pts = [];
    for (let i = 0, n = 1 + rng.int(9); i < n; i++) {
      // repeated points: segments of length 0
      pts.push(i && rng.chance(0.25) ? [...pts[i - 1]] : [rng.uniform(-500, 500), rng.uniform(-500, 500)]);
    }
    const cum = polylineLengths(pts), total = cum.at(-1);
    const where = [-10, 0, total, total + 10, ...cum, ...Array.from({ length: 12 }, () => rng.uniform(0, total))];
    for (const s of where) {
      const plain = plainPolylineAt(pts, s, cum);
      assert.deepEqual(polylineAt(pts, s, cum), plain, `polyline ${k}, s = ${s}`);
      assert.deepEqual(polylinePoint(pts, s, cum), plain.point, `polyline ${k}, s = ${s}`);
    }
  }
});

test("the road network's walk lengths are those of the walks, and the walk kept is the walk", () => {
  const world = createWorld(NEUSTADT), net = world.network();
  const fresh = createWorld(NEUSTADT).network(); // nothing kept: every walk worked out
  const rng = createRng(7);
  const roads = world.objects.filter((o) => o.constructor.type === "road" && o.geometry?.points?.length);
  const somewhere = () => {
    const pts = rng.pick(roads).geometry.points, p = rng.pick(pts);
    return [p[0] + rng.uniform(-60, 60), p[1] + rng.uniform(-60, 60)];
  };
  const places = Object.keys(net.places || {}).slice(0, 40);
  for (let k = 0; k < 120; k++) {
    const from = somewhere(), to = somewhere();
    const keys = places.length && rng.chance(0.3) ? { fromKey: rng.pick(places), toKey: null } : {};
    const length = net.walkLength(from, to, keys);
    assert.equal(length, fresh.walk(from, to, keys).length, `walk ${k}`);
    assert.equal(net.walkLength(from, to, keys), length, "asked again: the length kept");
    // the walk made for the length is handed to the next walk with the same ends: it is that walk
    // (the edges of its route are each network's own objects: compared by where they lie on it)
    const plain = (w) => ({ ...w, route: w.route && { ...w.route, edges: w.route.edges.map(({ s0, s1 }) => [s0, s1]) } });
    assert.deepEqual(plain(net.walk(from, to, keys)), plain(fresh.walk(from, to, keys)), `walk ${k}`);
  }
});

test("a path's offsets, worked out once per run of edges, are those of the plain offsetAt", () => {
  const world = createWorld(NEUSTADT), net = world.network();
  const rng = createRng(11);
  /** offsetAt as it was: the run of edges around `s` and its blends, found anew for every point. */
  const plainOffsetAt = (path, s, key) => {
    const E = path?.edges;
    if (!E?.length) return 0;
    const val = typeof key === "function" ? (k) => key(E[k].edge) || 0 : (k) => E[k].edge[key] || 0;
    let i = 0;
    while (i < E.length - 1 && E[i + 1].s0 <= s) i++;
    const o = val(i);
    let a = i, b = i;
    while (a > 0 && val(a - 1) === o) a--;
    while (b < E.length - 1 && val(b + 1) === o) b++;
    const run = E[b].s1 - E[a].s0, blend = net.mm(4);
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
  };
  const roads = world.objects.filter((o) => o.constructor.type === "road" && o.geometry?.points?.length);
  const somewhere = () => rng.pick(rng.pick(roads).geometry.points);
  let checked = 0;
  for (const [mode, key] of [["walk", "walkOffset"], ["car", "laneOffset"], ["bike", "bikeOffset"], ["car", (e) => (e.laneOffset || 0) / 2]]) {
    for (let k = 0; k < 40; k++) {
      const a = net.nearestNode(somewhere(), { mode }), b = net.nearestNode(somewhere(), { mode });
      const path = a && b ? net.route(a, b, { mode }) : null;
      if (!path?.edges?.length) continue;
      const at = net.offsets(path, key);
      const where = [0, path.length, ...path.edges.flatMap((e) => [e.s0, e.s1, (e.s0 + e.s1) / 2]), ...Array.from({ length: 20 }, () => rng.uniform(0, path.length))];
      for (const s of where) {
        assert.equal(at(s), plainOffsetAt(path, s, key), `${mode}, path ${k}, s = ${s}`);
        assert.equal(net.offsetAt(path, s, key), at(s));
        checked++;
      }
    }
  }
  assert.ok(checked > 1000, `${checked} points checked`);
});
