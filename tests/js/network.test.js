// The road network (core/network.js) and streets (objects/road.js): junctions (end to end, T, X),
// routing for people and vehicles, places connected to the streets, bus lanes of terminals,
// sidewalk offsets, walks on the sidewalks and around tracks, drawing, and road traffic
// (sims/traffic.js).
import assert from "node:assert/strict";
import test from "node:test";

import { Camera, createWorld, dot2, hiddenAt, LayoutObject, polylineAt, Registry, registerBuiltins, rectFootprint, resolvePoint, straightWalk, View, World } from "../../web/arail/index.js";

const K = 1000 / 87; // model mm per prototype metre (H0)

function world(objects, extra = {}) {
  return createWorld({ objects, simulations: [], clock: { start: "10:00", profiles: false }, ...extra }, { seed: 5 });
}

/** Nodes of the network near a point (mm). */
const nodesNear = (net, p, r = 1) => net.nodes.filter((n) => Math.hypot(n.pos[0] - p[0], n.pos[1] - p[1]) <= r);

/** Ids of the streets meeting at a node. */
const roadsAt = (net, n) => [...new Set(n.edges.map((id) => net.edges[id].road))].sort();

test("streets: kinds, widths and what the network gets from them", () => {
  const w = world([
    { id: "s", type: "road", points: [[0, 0], [1000, 0]] },
    { id: "old", type: "road", kind: "road", points: [[0, 500], [1000, 500]] },
    { id: "r", type: "road", kind: "residential", points: [[0, 1000], [1000, 1000]] },
    { id: "m", type: "road", kind: "main", width_m: 12, speed_kmh: 60, points: [[0, 1500], [1000, 1500]] },
    { id: "p", type: "road", kind: "path", points: [[0, 2000], [1000, 2000]] },
  ]);
  const info = Object.fromEntries(w.objects.map((o) => [o.id, o.roadInfo()]));
  assert.equal(info.s.kind, "street");
  assert.equal(info.old.kind, "street", "old layouts: road = street");
  assert.ok(Math.abs(info.s.width - 7 * K) < 1e-9);
  assert.ok(Math.abs(info.s.speed - 50 / 3.6) < 1e-9);
  assert.ok(Math.abs(info.r.speed - 30 / 3.6) < 1e-9);
  assert.ok(Math.abs(info.m.width - 12 * K) < 1e-9 && Math.abs(info.m.speed - 60 / 3.6) < 1e-9);
  assert.equal(info.p.car, false);
  assert.equal(info.p.sidewalk, 0);
  assert.ok(Math.abs(info.s.walkOffset - (3.5 + 1.25) * K) < 1e-9, "people walk in the middle of the sidewalk");
  assert.ok(Math.abs(info.s.laneOffset - 1.75 * K) < 1e-9, "cars on the right lane");
  // the footprint covers the sidewalks
  assert.ok(w.getObject("s").contains([500, (3.5 + 2.4) * K]) && !w.getObject("s").contains([500, 7 * K]));
  // round trip: kind "road" stays as it was
  assert.equal(w.getObject("old").toJSON().kind, "road");
});

test("network: junctions where street ends meet, where a street ends on another (T) and where streets cross (X)", () => {
  const w = world([
    // end to end at (1000, 0), at an angle
    { id: "a", type: "road", points: [[0, 0], [1000, 0]] },
    { id: "b", type: "road", points: [[1003, 2], [1500, 600]] },
    // T: c ends on a (within the half width), a is split there
    { id: "c", type: "road", points: [[400, -800], [400, -20]] },
    // X: d crosses a
    { id: "d", type: "road", points: [[700, -500], [700, 500]] },
  ]);
  const net = w.network();
  const end = nodesNear(net, [1000, 0], 5);
  assert.equal(end.length, 1, "one node where a and b meet");
  assert.deepEqual(roadsAt(net, end[0]), ["a", "b"]);
  assert.equal(end[0].degree, 2);
  const t = nodesNear(net, [400, 0], 1);
  assert.equal(t.length, 1, "T junction on the centre line of a");
  assert.deepEqual(roadsAt(net, t[0]), ["a", "c"]);
  assert.equal(t[0].degree, 3);
  const x = nodesNear(net, [700, 0], 1);
  assert.equal(x.length, 1);
  assert.deepEqual(roadsAt(net, x[0]), ["a", "d"]);
  assert.equal(x[0].degree, 4);
  assert.deepEqual(net.junctions().map((n) => n.degree).sort(), [3, 4]);
  // dead ends are where traffic enters and leaves
  const ends = net.boundaryNodes().map((n) => n.pos.map(Math.round).join(","));
  assert.deepEqual(ends.sort(), ["0,0", "1500,600", "400,-800", "700,-500", "700,500"]);
  // street c is drawn up to the junction; routes cross from c to b
  const r = net.route(nodesNear(net, [400, -800])[0], nodesNear(net, [1500, 600])[0], { mode: "car" });
  assert.ok(r);
  assert.deepEqual([...new Set(r.edges.map((e) => e.edge.road))], ["c", "a", "b"]);
});

test("network: routes for walking and driving; footpaths are for people only", () => {
  const w = world([
    { id: "south", type: "road", points: [[0, 0], [2000, 0]] },
    { id: "west", type: "road", points: [[0, 0], [0, 2000]] },
    { id: "north", type: "road", points: [[0, 2000], [2000, 2000]] },
    { id: "east", type: "road", points: [[2000, 2000], [2000, 0]] },
    { id: "short", type: "road", kind: "path", points: [[0, 0], [2000, 2000]] },
  ]);
  const net = w.network();
  const a = nodesNear(net, [0, 0])[0], b = nodesNear(net, [2000, 2000])[0];
  const walk = net.route(a, b, { mode: "walk" });
  assert.deepEqual([...new Set(walk.edges.map((e) => e.edge.road))], ["short"], "people take the footpath");
  assert.ok(Math.abs(walk.length - Math.hypot(2000, 2000)) < 1);
  const drive = net.route(a, b, { mode: "car" });
  assert.ok(Math.abs(drive.length - 4000) < 1, "cars go round");
  assert.ok(!drive.edges.some((e) => e.edge.kind === "path"));
  assert.equal(net.distance(a, b, "walk"), walk.length);
  assert.ok(net.distance(a, b, "car") > 0);
  // paths: points, cumulative lengths and the edges with their arc lengths
  assert.equal(drive.points.length, drive.lengths.length);
  assert.equal(drive.edges[0].s0, 0);
  assert.ok(Math.abs(drive.edges[drive.edges.length - 1].s1 - drive.length) < 1e-6);
  assert.equal(drive.nodes[0], a.id);
  assert.equal(drive.nodes[drive.nodes.length - 1], b.id);
  // routes that must turn around: a dead end is cheap, the middle of a street is not
  const one = world([{ id: "s", type: "road", points: [[0, 0], [1000, 0]] }]).network();
  const m = nodesNear(one, [0, 0])[0], e = nodesNear(one, [1000, 0])[0];
  const back = one.routeDirected(m, [1, 0], m, [-1, 0], { mode: "car" });
  assert.equal(back.uturns, 1);
  assert.ok(Math.abs(back.length - 2000) < 1, "to the end and back");
  assert.equal(one.routeDirected(m, [1, 0], e, [1, 0]).uturns, 0);
});

test("network: the driving line turns cleanly where streets of different widths meet", () => {
  // a main road (wider lane offset) and streets: every turn at the junctions changes the offset
  const w = world([
    { id: "main", type: "road", kind: "main", points: [[0, 0], [2000, 0]] },
    { id: "street", type: "road", points: [[1000, 0], [1000, -1500]] },
    { id: "res", type: "road", kind: "residential", points: [[0, -1500], [2000, -1500]] },
  ]);
  const net = w.network();
  const ends = [[0, 0], [2000, 0], [0, -1500], [2000, -1500]].map((p) => nodesNear(net, p)[0]);
  for (const a of ends) {
    for (const b of ends) {
      if (a === b) continue;
      const route = net.route(a, b, { mode: "car" });
      const line = net.drivingLine(route);
      // never backwards: consecutive pieces of the lane do not fold back on each other
      for (let i = 2; i < line.points.length; i++) {
        const p = line.points[i - 2], q = line.points[i - 1], r = line.points[i];
        const u = [q[0] - p[0], q[1] - p[1]], v = [r[0] - q[0], r[1] - q[1]];
        const cos = dot2(u, v) / (Math.hypot(...u) * Math.hypot(...v));
        assert.ok(cos > -0.2, `${a.pos} → ${b.pos}: the lane folds back at ${q.map(Math.round)}`);
      }
      assert.ok(Math.abs(line.length - route.length) < 0.05 * route.length, "about as long as the centre line");
    }
  }
});

/** A building with an entrance (the building API the network uses). */
class Box extends LayoutObject {
  static type = "test-box";
  computeGeometry() {
    const c = resolvePoint(this.world.map, this.spec.position);
    return c ? { center: c, footprint: rectFootprint(c, 100, 80) } : null;
  }
  footprint() {
    return this.geometry?.footprint || null;
  }
  entrances() {
    const c = this.geometry.center;
    return [{ pos: [c[0], c[1] - 40], dir: [0, -1] }, { pos: [c[0] + 40, c[1] - 40], dir: [0, -1] }];
  }
}

test("network: building entrances and stop access points are connected to the nearest street", () => {
  const registry = registerBuiltins(new Registry());
  registry.registerObject(Box);
  const w = new World({
    registry,
    layout: {
      objects: [
        { id: "s", type: "road", points: [[0, 0], [3000, 0]] },
        { id: "home", type: "test-box", position: [300, 200] },
        { id: "work", type: "test-box", position: [2600, -200] },
        { id: "far", type: "test-box", position: [300, 3000] },
        { id: "stop", type: "bus-stop", position: [1500, -60] },
      ],
      simulations: [],
    },
  });
  const net = w.network();
  const home = net.place("building:home:0"), work = net.place("building:work:0");
  assert.ok(home && work && net.place("building:home:1"));
  assert.equal(net.place("building:far:0"), null, "more than 80 m from a street");
  assert.equal(net.place("nothing"), null);
  assert.equal(net.place(null), null);
  assert.deepEqual(home.pos, [300, 160], "the place node is the entrance");
  const area = w.getStopArea("stop");
  area.access.forEach((_, i) => assert.ok(net.place(`area:stop:${i}`), `access ${i}`));
  // a walk from home to work: connector, along the street, connector
  const r = net.route(home, work, { mode: "walk" });
  assert.deepEqual(r.edges.map((e) => e.edge.kind).filter((k, i, a) => k !== a[i - 1]), ["connector", "road", "connector"]);
  assert.ok(Math.abs(r.length - (160 + 2300 + 240)) < 1, `length ${r.length}`);
  // on the street people walk on the sidewalk on their right; the offset changes smoothly
  const mid = net.pathAt(r, r.length / 2);
  assert.ok(Math.abs(mid.walkOffset - (3.5 + 1.25) * K) < 1e-6);
  assert.deepEqual(mid.dir.map((v) => Math.round(v) + 0), [1, 0]);
  assert.equal(net.pathAt(r, 1).walkOffset, 0);
  let last = 0;
  for (let s = 0; s <= r.length; s += 5) {
    const o = net.pathAt(r, s).walkOffset;
    assert.ok(Math.abs(o - last) < 6, `jump at ${s}: ${last} -> ${o}`);
    last = o;
  }
  // nearest node by mode
  assert.ok(net.nearestNode([300, 170], { mode: "walk" }) === home);
  assert.notEqual(net.nearestNode([300, 170], { mode: "car" }), home);
});

test("network: people walk on the sidewalks and cross a street at right angles", () => {
  const registry = registerBuiltins(new Registry());
  registry.registerObject(Box);
  const w = new World({
    registry,
    layout: {
      objects: [
        { id: "s", type: "road", points: [[0, 0], [3000, 0]] },
        { id: "home", type: "test-box", position: [300, 200] },
        { id: "work", type: "test-box", position: [2600, -200] },
        { id: "shop", type: "test-box", position: [2000, 200] },
      ],
      simulations: [],
    },
  });
  const net = w.network(), half = w.getObject("s").roadInfo().width / 2, side = (3.5 + 1.25) * K;
  const door = (id) => w.getObject(id).entrances()[0].pos;
  const walk = (a, b) => net.walk(door(a), door(b), { fromKey: `building:${a}:0`, toKey: `building:${b}:0` });
  /** Samples of a walk: point and direction every 5 mm. */
  const samples = (wk) => {
    const out = [];
    for (let s = 0; s <= wk.length; s += 5) out.push(polylineAt(wk.points, s, wk.lengths));
    return out;
  };
  // to the other side of the street: along the sidewalk on the home side, across at right angles
  const across = walk("home", "work");
  assert.ok(across.route, "over the network");
  assert.deepEqual(across.hidden, []);
  assert.deepEqual(across.points[0], door("home"));
  assert.deepEqual(across.points[across.points.length - 1], door("work"));
  let onStreet = 0;
  for (const { point, dir } of samples(across)) {
    if (Math.abs(point[1]) >= half - 1e-6) continue;
    onStreet++;
    assert.ok(Math.abs(dir[0]) < 1e-6, `on the carriageway only to cross it, at right angles (at ${point.map(Math.round)})`);
  }
  assert.ok(onStreet > 0 && onStreet * 5 <= 2 * half + 10, "one crossing");
  const along = samples(across).filter(({ dir }) => Math.abs(dir[1]) < 1e-6);
  assert.ok(along.length && along.every(({ point }) => Math.abs(point[1] - side) < 1e-6), "along the street in the middle of the sidewalk on the home side");
  // on the same side: never on the carriageway
  const same = walk("home", "shop");
  assert.ok(samples(same).every(({ point }) => point[1] >= half), "stays on its side");
  // the routes underneath are unchanged: the connector, the street, the connector
  assert.ok(Math.abs(across.route.length - (160 + 2300 + 240)) < 1);
});

test("network: people do not cross tracks on their own; where streets do not connect, a walk is out of sight", () => {
  const registry = registerBuiltins(new Registry());
  registry.registerObject(Box);
  const objects = [
    { id: "s", type: "road", points: [[0, 0], [3000, 0]] },
    { id: "g1", type: "track", virtual: true, points: [[0, 400], [3000, 400]] },
    { id: "near", type: "test-box", position: [500, 200] },
    { id: "beyond", type: "test-box", position: [1500, 700] },
  ];
  const make = (extra = []) => new World({ registry, layout: { objects: [...objects, ...extra], simulations: [] } });
  const w = make(), net = w.network();
  const beyond = w.getObject("beyond").entrances()[0].pos, near = w.getObject("near").entrances()[0].pos;
  assert.ok(net.place("building:near:0"));
  assert.equal(net.place("building:beyond:0"), null, "within 80 m of the street, but behind the track");
  assert.equal(net.crossesBarrier(beyond, [1500, 0]), true);
  assert.equal(net.crossesBarrier(near, [500, 0]), false);
  assert.equal(net.nearestNode(beyond, { mode: "walk" }), null, "no node to walk to without crossing the track");
  assert.ok(net.nearestNode(beyond, { mode: "car" }), "vehicles are not limited by it");
  const cut = net.walk(beyond, near, { fromKey: "building:beyond:0", toKey: "building:near:0" });
  assert.equal(cut.route, null);
  assert.equal(cut.offstage, true);
  assert.ok(hiddenAt(cut, 0) && hiddenAt(cut, cut.length / 2) && hiddenAt(cut, cut.length), "out of sight all the way");
  // a footpath over the track (a crossing): now the place is connected, and the walk is in sight
  const w2 = make([{ id: "crossing", type: "road", kind: "path", points: [[1500, 0], [1500, 800]] }]), net2 = w2.network();
  assert.ok(net2.place("building:beyond:0"));
  const walk = net2.walk(beyond, near, { fromKey: "building:beyond:0", toKey: "building:near:0" });
  assert.ok(walk.route && !walk.offstage && walk.hidden.length === 0);
  // two streets that do not meet: a walk between them is out of sight, not straight across
  const w3 = new World({
    registry,
    layout: {
      objects: [
        { id: "a", type: "road", points: [[0, 0], [1000, 0]] },
        { id: "b", type: "road", points: [[0, 1500], [1000, 1500]] },
        { id: "x", type: "test-box", position: [500, 200] },
        { id: "y", type: "test-box", position: [500, 1300] },
      ],
      simulations: [],
    },
  });
  const x = w3.getObject("x").entrances()[0].pos, y = w3.getObject("y").entrances()[0].pos;
  const apart = w3.network().walk(x, y, { fromKey: "building:x:0", toKey: "building:y:0" });
  assert.equal(apart.route, null);
  assert.ok(apart.offstage && hiddenAt(apart, apart.length / 2));
  // without any streets people walk straight, out of sight only over a track
  const open = straightWalk([0, 0], [100, 0]);
  assert.deepEqual(open.points, [[0, 0], [100, 0]]);
  assert.equal(hiddenAt(open, 50), false);
  assert.equal(hiddenAt(straightWalk([0, 0], [100, 0], true), 50), true);
});

test("network: without streets every query returns null; the network is rebuilt when objects change", () => {
  const w = world([{ id: "t", type: "tree", position: [0, 0] }]);
  const net = w.network();
  assert.ok(net.empty);
  assert.equal(net.place("building:x:0"), null);
  assert.equal(net.nearestNode([0, 0]), null);
  assert.equal(net.route(0, 1), null);
  assert.equal(w.network(), net, "cached");
  const road = w.addObject({ type: "road", points: [[0, 0], [500, 0]] });
  const net2 = w.network();
  assert.notEqual(net2, net);
  assert.equal(net2.edges.length, 1);
  road.set({ points: [[0, 0], [500, 0], [500, 500]] });
  assert.equal(w.network().edges.length, 2);
});

test("network: a bus terminal's lane is a one-way lane connected to the streets", () => {
  const w = world([
    { id: "s", type: "road", points: [[-500, 0], [2000, 0]] },
    { id: "t", type: "bus-terminal", position: [700, -120], bays: 2 },
    { id: "a", type: "bus-stop", position: [1700, 60], side: "both" },
    { id: "l", type: "bus-line", stops: ["t", "a"] },
  ]);
  const net = w.network();
  const lanes = net.edges.filter((e) => e.kind === "lane");
  assert.ok(lanes.length >= 3, "lane pieces and connectors");
  assert.ok(lanes.every((e) => e.oneway && e.bus && !e.car && !e.walk));
  assert.ok(net.dock("t:bay1") && net.dock("t:bay2") && net.dock("a:right"));
  const line = w.getObject("l").info();
  assert.ok(line.ok, line.problems.join("; "));
  assert.equal(line.visits[0].dockId, "t:bay1", "the line's bay");
  // cars do not drive through the terminal
  const s0 = nodesNear(net, [-500, 0])[0], s1 = nodesNear(net, [2000, 0])[0];
  assert.ok(!net.route(s0, s1, { mode: "car" }).edges.some((e) => e.edge.kind === "lane"));
});

/** A canvas context that only checks the coordinates and counts fills. */
function fakeContext(width, height) {
  const noop = () => {};
  let fills = 0;
  const ctx = {
    canvas: { width, height }, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, globalAlpha: 1, globalCompositeOperation: "source-over",
    save: noop, restore: noop, setTransform: noop, fillRect: noop, beginPath: noop, closePath: noop, stroke: noop, setLineDash: noop,
    arc: noop, ellipse: noop, quadraticCurveTo: noop, arcTo: noop, clip: noop, fillText: noop, drawImage: noop,
    moveTo(x, y) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y), "finite coordinates");
    },
    lineTo(x, y) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y), "finite coordinates");
    },
    fill() {
      fills++;
    },
    measureText: (t) => ({ width: t.length * 6 }),
    createRadialGradient: () => ({ addColorStop: noop }),
  };
  return { ctx, fills: () => fills };
}

test("streets, stops, lines, buses and cars draw without errors by day and by night", () => {
  const w = world([
    { id: "main", type: "road", kind: "main", points: [[0, 0], [3000, 0]] },
    { id: "side", type: "road", points: [[1500, 0], [1500, 1500]] },
    { id: "path", type: "road", kind: "path", points: [[500, 0], [500, 900]] },
    { id: "a", type: "bus-stop", position: [600, -70], side: "both" },
    { id: "b", type: "bus-stop", position: [1450, 900], side: "both" },
    { id: "nowhere", type: "bus-stop", position: [2500, 1500] },
    { id: "l", type: "bus-line", number: "62", headway_s: 60, stops: ["a", "b"] },
  ], { simulations: [{ type: "passengers", base_rate: 0 }, { type: "traffic", cars_per_km: 40 }] });
  w.speed = 1;
  for (let i = 0; i < 600; i++) w.step(0.1);
  assert.ok(w.transit.buses.length > 0);
  for (const night of [0, 1]) {
    const camera = new Camera(1280, 720);
    const { ctx, fills } = fakeContext(1280, 720);
    // a camera over the middle of the layout, looking down at 45°
    const H = [900, -300, 1500 * 640, 0, -650, 900 * 360 + 800 * 360, 0, -0.5, 1500];
    const view = new View({ ctx, camera, H, scale: 87, night });
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.map(String).join(" "));
    try {
      w.draw(view, { selected: w.getObject("l") });
    } finally {
      console.error = original;
    }
    assert.deepEqual(errors, []);
    assert.ok(fills() > 20);
  }
});

test("traffic: cars come in at the street ends, keep their distance and leave again", () => {
  const w = world([
    { id: "ew", type: "road", points: [[0, 0], [4000, 0]] },
    { id: "ns", type: "road", kind: "residential", points: [[2000, -2000], [2000, 2000]] },
  ], { simulations: [{ type: "traffic", cars_per_km: 60 }] });
  const traffic = w.simulations[0];
  w.speed = 1;
  const seen = new Set();
  let minGap = Infinity;
  // in the junction itself a car that has waited long enough goes anyway and may briefly
  // overlap a crossing one; along the streets cars keep their distance
  const inJunction = (p) => Math.hypot(p[0] - 2000, p[1]) < 8 * K;
  for (let i = 0; i < 3000; i++) {
    w.step(0.1);
    for (const c of traffic.cars) seen.add(c.id);
    if (i % 20) continue;
    const users = traffic.roadUsers();
    for (const u of users) {
      for (const o of users) {
        if (o === u || dot2(u.dir, o.dir) < 0.9) continue;
        const d = [o.rear[0] - u.front[0], o.rear[1] - u.front[1]];
        const along = dot2(d, u.dir), lateral = Math.abs(u.dir[0] * d[1] - u.dir[1] * d[0]);
        if (lateral > 10 || along < -60 || inJunction(u.front) || inJunction(o.rear)) continue;
        minGap = Math.min(minGap, along);
      }
    }
  }
  const target = traffic.targetCount();
  assert.ok(target > 10, `target ${target}`);
  assert.ok(traffic.cars.length > target * 0.5, `${traffic.cars.length} cars of ${target}`);
  assert.ok(seen.size > traffic.cars.length + 5, "cars left and new ones came");
  assert.ok(minGap > 0, `cars overlap: gap ${minGap} mm`);
  // all cars move along (none stuck for good)
  const before = traffic.cars.map((c) => [c, c.s]);
  for (let i = 0; i < 300; i++) w.step(0.1);
  const moved = before.filter(([c, s]) => !traffic.cars.includes(c) || c.s > s + 1).length;
  assert.ok(moved >= before.length * 0.8, `${moved} of ${before.length} moved`);
  // fewer cars at night
  w.clock.configure({ start: "03:00", profiles: true });
  assert.ok(traffic.targetCount() < target * 0.3);
  // the example plugin's simulation still works next to it
  assert.ok(w.registry.simulations.has("traffic"));
});
