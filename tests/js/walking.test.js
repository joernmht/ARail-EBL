// People on foot among each other and among the vehicles (core/walking.js): the kerb and the gap,
// vehicles that brake for people, passing on the sidewalk; the carriageway of the road network.
import assert from "node:assert/strict";
import test from "node:test";

import { NEAR_MISS_BRAKE, WALKING, Walking, createWorld, crossSection, peopleAhead, roadKind, ROAD_KINDS, segmentDistance } from "../../web/arail/index.js";

const SCALE = 87, mm = (m) => (m * 1000) / SCALE, metres = (x) => (x * SCALE) / 1000;

/**
 * A world as the walkers need it: a street across the walkers' line from x = 30 m to 37 m, the
 * walkers themselves, and the road users given.
 */
function scene({ users = [], zebra = false, street = [30, 37] } = {}) {
  const walkers = [];
  const edge = { zebras: zebra ? [{ s: 0, width: mm(4) }] : [], points: [[mm((street[0] + street[1]) / 2), 0], [mm((street[0] + street[1]) / 2), mm(10)]], lengths: [0, mm(10)] };
  const world = {
    scale: SCALE, time: 0, transit: null,
    simulations: [{ pedestrians: () => walkers.filter((w) => w.pos).map((w) => ({ pos: w.pos, dir: w.dir, agent: w })) }, { roadUsers: () => users }],
    network: () => ({ edges: [edge], carriageway: (p) => (p[0] > mm(street[0]) && p[0] < mm(street[1]) ? edge : null) }),
  };
  const walking = new Walking(world);
  world.walking = walking;
  const path = { points: [[0, 0], [mm(80), 0]], lengths: [0, mm(80)], length: mm(80), hidden: [] };
  const walker = (id, at, speed = 1.3, more = {}) => {
    const w = { id, path, s: mm(at), speed, lat: 0, ...more };
    walkers.push(w);
    return w;
  };
  const run = (seconds, each = null) => {
    for (let t = 0; t < seconds; t += 0.1) {
      world.time += 0.1;
      walking.begin();
      for (const w of walkers) if (w.s < w.path.length) walking.advance(w, 0.1);
      each?.(world.time);
    }
  };
  return { world, walking, walkers, walker, run, path };
}

/** A vehicle on the street (it runs along x = 33.5 m, in +y), its front `back` metres before the walkers' line. */
const vehicle = (back, speed, more = {}) => ({ vehicle: { kind: "car", v: speed, ...more.vehicle }, front: [mm(33.5), mm(-back)], rear: [mm(33.5), mm(-back - 4.4)], dir: [0, 1], speed });

test("at the kerb: people wait while a vehicle comes, and cross when the gap is long enough", () => {
  // a car 20 m away at 30 km/h is there in 2.4 s: no gap for a street of 7 m
  const car = vehicle(20, 8.3);
  const s = scene({ users: [car] });
  const w = s.walker("a", 20);
  s.run(12);
  assert.ok(w.held && !w.onRoad, "waits");
  near(metres(w.s), 30 - WALKING.kerb_m, 0.3, "at the kerb, not on the street");
  assert.ok(w.kerb > 3, "and counts how long");
  assert.equal(s.walking.onRoad.length, 0, "nobody on the street for the vehicles to brake for");
  // the car is gone: across
  car.front = [mm(33.5), mm(200)];
  car.rear = [mm(33.5), mm(195.6)];
  s.run(3);
  assert.ok(w.onRoad && !w.held);
  assert.deepEqual(s.walking.onRoad, [w], "on the street: the vehicles brake for it");
  s.run(8);
  assert.ok(!w.onRoad && metres(w.s) > 38 && w.kerb === 0);
  // a car far enough away is no reason to wait: the street takes 5.4 s, the margin is 2 s
  const far = scene({ users: [vehicle(100, 8.3)] }), v = far.walker("b", 28);
  far.run(4);
  assert.ok(v.onRoad, "a gap of 12 s");
  // one that drives away from the crossing, or beside it, is no reason either
  const away = scene({ users: [{ ...vehicle(-10, 8.3) }] }), u = away.walker("c", 28);
  away.run(4);
  assert.ok(u.onRoad);
});

test("at the kerb: a standing vehicle is not waited for, but nobody walks through one; people go round it", () => {
  // a car that stands 6 m before the crossing sees the walker: across in front of it
  const s = scene({ users: [vehicle(6, 0)] }), w = s.walker("a", 28);
  s.run(4);
  assert.ok(w.onRoad, "in front of a standing car");
  // a car that stands on the crossing: round it, a few steps along the kerb
  const on = { vehicle: { kind: "car", v: 0 }, front: [mm(33.5), mm(2.2)], rear: [mm(33.5), mm(-2.2)], dir: [0, 1], speed: 0 };
  const t = scene({ users: [on] }), a = t.walker("b", 26);
  let closest = Infinity;
  t.run(25, () => {
    if (a.pos) closest = Math.min(closest, metres(segmentDistance(a.pos, a.pos, on.rear, on.front)));
  });
  assert.ok(metres(a.s) > 38, "it got across");
  assert.ok(Math.abs(metres(a._cross?.slot ?? a.lat)) >= 0 && closest > 0.9 + WALKING.body_m - 0.05, `not through the car (${closest.toFixed(2)} m from its middle)`);
  // a tram that stands across the whole crossing: no way round it, however long it takes
  const tram = { vehicle: { kind: "tram", v: 0 }, front: [mm(33.5), mm(15)], rear: [mm(33.5), mm(-15)], dir: [0, 1], speed: 0 };
  const x = scene({ users: [tram] }), b = x.walker("c", 26);
  x.run(WALKING.give_up_s + 30);
  assert.ok(b.held && metres(b.s) < 30, "waits, also beyond all patience");
});

test("at the kerb: who has waited long takes a smaller gap; a queue that creeps lets people cross", () => {
  // a car always 16 m away at 20 km/h (as in a steady stream): 2.9 s, less than the street and the margin
  const stream = vehicle(16, 5.6);
  const s = scene({ users: [stream] }), w = s.walker("a", 28);
  s.run(WALKING.patience_s - 2);
  assert.ok(w.held, "no gap");
  // …beyond all patience any gap is taken (the vehicles brake for people)
  s.run(WALKING.give_up_s);
  assert.ok(metres(w.s) > 31, "gone");
  // a queue that creeps at walking pace, 8 m away: after a moment at the kerb the driver lets people cross
  const creep = scene({ users: [vehicle(8, 1.5)] }), v = creep.walker("b", 28);
  creep.run(1.5);
  assert.ok(v.held, "it looks first");
  creep.run(WALKING.seen_s + 2);
  assert.ok(v.onRoad || metres(v.s) > 31, "then goes");
  // a car that has stood for people for a while goes next: who comes to the kerb now lets it
  const waiting = vehicle(4, 0, { vehicle: { hold: "people", yielded: WALKING.turn_s + 1 } });
  const turn = scene({ users: [waiting] }), u = turn.walker("c", 28);
  turn.run(4);
  assert.ok(u.held && u.letting, "the vehicles' turn at this crossing");
  // …for everybody who comes there, for a few seconds; then it is the people's turn again
  const late = turn.walker("d", 26);
  turn.run(2);
  assert.ok(late.held || metres(late.s) < 30, "the next one waits too");
  waiting.vehicle.yielded = 0;
  turn.run(WALKING.let_s + 2);
  assert.ok(u.onRoad || metres(u.s) > 31, "then the people go: a car that has only just stopped is crossed in front of");
  // a walker who cannot cross (a vehicle is in the way) lets the vehicles go too: a zebra crossing does not wait for it
  const tram = { vehicle: { kind: "tram", v: 0 }, front: [mm(33.5), mm(15)], rear: [mm(33.5), mm(-15)], dir: [0, 1], speed: 0 };
  const stuck = scene({ users: [tram], zebra: true }), x = stuck.walker("e", 28);
  stuck.run(3);
  assert.ok(x.held && x.letting);
});

test("a zebra crossing: the vehicles that can still stop will, so people go; not before one too close, not before a tram", () => {
  // 20 m away at 30 km/h: it can stop (11.5 m of braking and 2 m): the walker goes, as it would not without the zebra
  const s = scene({ users: [vehicle(20, 8.3)], zebra: true }), w = s.walker("a", 28);
  s.run(3);
  assert.ok(w.onRoad, "the car will stop");
  const close = scene({ users: [vehicle(8, 8.3)], zebra: true }), v = close.walker("b", 28);
  close.run(1.2);
  assert.ok(v.held, "too close to stop");
  const tram = scene({ users: [vehicle(20, 8.3, { vehicle: { kind: "tram" } })], zebra: true }), u = tram.walker("c", 28);
  tram.run(3);
  assert.ok(u.held, "a tram need not stop (StVO § 26)");
});

test("at the kerb: people wait beside each other, the next ones behind them, and cross as they stood", () => {
  const car = vehicle(16, 5.6);
  const s = scene({ users: [car] });
  for (let k = 0; k < 14; k++) s.walker(`w${String(k).padStart(2, "0")}`, 22 - k * 1.5, 1.2 + 0.02 * k);
  s.run(40);
  const closest = () => {
    // (those at the end of their walk are in their house: they stand on no sidewalk)
    const out = s.walkers.filter((w) => w.s < w.path.length - 1);
    let d = Infinity;
    for (const a of out) for (const b of out) if (a.id < b.id) d = Math.min(d, metres(Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1])));
    return d;
  };
  assert.ok(s.walkers.every((w) => metres(w.s) < 30), "all wait");
  assert.ok(closest() >= WALKING.slot_m - 0.06, `nobody stands in another (${closest().toFixed(2)} m)`);
  const front = s.walkers.filter((w) => w._cross.row === 0), behind = s.walkers.filter((w) => w._cross.row > 0);
  assert.equal(front.length, WALKING.slots, "the kerb is full");
  assert.equal(new Set(front.map((w) => Math.round(metres(w._cross.slot) * 10))).size, WALKING.slots, "each a place of its own");
  assert.ok(behind.length === 14 - WALKING.slots && behind.every((w) => w.s < Math.min(...front.map((f) => f.s))), "the others behind them");
  // the car is gone: all cross, nobody through another
  car.front = [mm(33.5), mm(500)];
  car.rear = [mm(33.5), mm(495)];
  let min = Infinity;
  s.run(30, () => (min = Math.min(min, closest())));
  assert.ok(s.walkers.every((w) => metres(w.s) > 37), "all across");
  assert.ok(min > 0.3, `nobody through another on the way (${min.toFixed(2)} m)`);
});

test("on the sidewalk: past a slower one where there is room, to the right when somebody comes, never through each other", () => {
  const s = scene({ street: [900, 901] });
  const slow = s.walker("a", 4, 1.0), fast = s.walker("b", 0, 1.7);
  let closest = Infinity, leftmost = 0;
  s.run(25, () => {
    closest = Math.min(closest, metres(Math.hypot(slow.pos[0] - fast.pos[0], slow.pos[1] - fast.pos[1])));
    leftmost = Math.max(leftmost, metres(fast.pos[1]));
  });
  assert.ok(fast.s > slow.s, "the faster one is past");
  // (walking along +x, the left is +y: the right of a direction d is (d[1], -d[0]), as for the streets)
  assert.ok(leftmost >= WALKING.pass_m - 0.05, `on the left (${leftmost.toFixed(2)} m)`);
  assert.ok(closest >= WALKING.pass_m - 0.05, `beside, not through (${closest.toFixed(2)} m)`);
  assert.ok(Math.abs(metres(fast.lat)) < 0.05, "and back on its line");
  // two who come towards each other each keep to their right
  const t = scene({ street: [900, 901] });
  const there = t.walker("a", 0, 1.3), back = t.walker("b", 0, 1.3, { path: { points: [[mm(30), 0], [0, 0]], lengths: [0, mm(30)], length: mm(30), hidden: [] } });
  let apart = Infinity, sides = null;
  t.run(20, () => {
    const d = metres(Math.hypot(there.pos[0] - back.pos[0], there.pos[1] - back.pos[1]));
    if (d < apart) sides = [metres(there.pos[1]), metres(back.pos[1])];
    apart = Math.min(apart, d);
  });
  assert.ok(apart >= 2 * WALKING.keep_m - 0.1, `they pass each other (${apart.toFixed(2)} m)`);
  assert.ok(sides[0] < -0.25 && sides[1] > 0.25, `each on their right: the one along +x at -y, the one coming at +y (${sides.map((y) => y.toFixed(2))})`);
  // no room to pass (somebody comes): behind the slower one at their pace
  const u = scene({ street: [900, 901] });
  const front = u.walker("a", 3, 0.9), behind = u.walker("b", 0, 1.8);
  const stream = [];
  for (let k = 0; k < 12; k++) stream.push(u.walker(`c${k}`, 0, 1.3, { path: { points: [[mm(20 + 4 * k), 0], [mm(-40), 0]], lengths: [0, mm(60 + 4 * k)], length: mm(60 + 4 * k), hidden: [] } }));
  let d = Infinity;
  u.run(10, () => (d = Math.min(d, metres(Math.hypot(front.pos[0] - behind.pos[0], front.pos[1] - behind.pos[1])))));
  assert.ok(d > 0.4, `not into the one ahead (${d.toFixed(2)} m)`);
  // the members of a group do not step aside for each other, and walk where their formation says
  const g = scene({ street: [900, 901] }), group = {};
  const lead = g.walker("a", 2, 1.2, { group, form: { lat: -mm(0.35) } }), mate = g.walker("b", 2, 1.2, { group, form: { lat: mm(0.35) } });
  g.run(6);
  near(metres(lead.lat), -0.35, 0.02);
  near(metres(mate.lat), 0.35, 0.02);
  near(metres(mate.s - lead.s), 0, 0.05, "side by side");
});

test("vehicles brake for the people on the street ahead of them: straight on, and round the corner they turn", () => {
  const world = { walking: { onRoad: [{ pos: [mm(10), mm(0.5)] }, { pos: [mm(30), mm(8)] }] } };
  near(metres(peopleAhead(world, [0, 0], [1, 0], mm(40), mm(1.5))), 10, 1e-6, "the nearest in the lane");
  assert.equal(peopleAhead(world, [0, 0], [1, 0], mm(8), mm(1.5)), Infinity, "beyond what it looks at");
  assert.equal(peopleAhead(world, [0, 0], [-1, 0], mm(40), mm(1.5)), Infinity, "behind it");
  assert.equal(peopleAhead(world, [0, mm(5)], [1, 0], mm(40), mm(1.5)), Infinity, "beside its lane");
  assert.equal(peopleAhead({ walking: { onRoad: [] } }, [0, 0], [1, 0], mm(40), mm(1.5)), Infinity);
  // a car that turns left at x = 30 m: the person round the corner is in its way, the one straight on is not
  const way = { points: [[0, 0], [mm(30), 0], [mm(30), mm(40)]], lengths: [0, mm(30), mm(70)], length: mm(70), s: mm(20) };
  const round = peopleAhead(world, [mm(20), 0], [1, 0], mm(30), mm(1.5), way);
  assert.ok(metres(round) > 12 && metres(round) < 19, `${metres(round)} m along its way`);
  assert.equal(peopleAhead({ walking: { onRoad: [{ pos: [mm(40), 0] }] } }, [mm(20), 0], [1, 0], mm(30), mm(1.5), way), Infinity, "straight on is not its way");
  assert.ok(NEAR_MISS_BRAKE > 3);
});

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} is not within ${tol} of ${b}`);

test("the carriageway of a street: its lanes, not its sidewalks; beside a street without sidewalks people walk on the verge", () => {
  const world = createWorld({
    scale: 87,
    objects: [
      { id: "main", type: "road", name: "Hauptstraße", points: [[0, 0], [6000, 0]] },
      { id: "plain", type: "road", name: "Feldweg", profile: "plain", width_m: 6.5, points: [[3000, 0], [3000, 4000]] },
      { id: "path", type: "road", kind: "path", name: "Fußweg", points: [[1000, 0], [1000, -2000]] },
    ],
    simulations: [],
  });
  const net = world.network();
  const info = world.getObject("main").roadInfo(), plain = world.getObject("plain").roadInfo();
  assert.equal(net.carriageway([1500, 0])?.road, "main", "the middle of the street");
  assert.equal(net.carriageway([1500, info.width / 2 - 5])?.road, "main", "its lanes");
  assert.equal(net.carriageway([1500, info.walkOffset]), null, "the sidewalk");
  assert.equal(net.carriageway([1000, -1000]), null, "a footpath");
  assert.equal(net.carriageway([1500, 3000]), null, "no street there");
  // a street without sidewalks: people walk beside it, clear of a bus that is as wide as its lane
  const xs = crossSection({ profile: "plain", width_m: 6.5, kind: roadKind("street") }, ROAD_KINDS[roadKind("street")]);
  assert.ok(xs.walkOffset > 3.25 + 0.3, "on the verge");
  assert.equal(net.carriageway([3000 + plain.walkOffset, 2000]), null);
  assert.equal(net.carriageway([3000 + plain.width / 2 - 10, 2000])?.road, "plain");
  const busHalf = mm(2.55 / 2), lane = plain.laneOffset;
  assert.ok(plain.walkOffset - (lane + busHalf) > mm(0.4), "a bus in its lane does not reach them");
  // a walk along the plain street does not count as on it; one across the main street does, for its width
  const walk = net.walk([2900, 200], [2900, 3800]);
  const walking = world.walking, w = { id: "w", path: walk, s: 0, speed: 1.3, lat: 0 };
  let on = 0;
  for (let t = 0; t < 6000 && w.s < walk.length; t++) {
    walking.begin();
    walking.advance(w, 0.1);
    if (w.onRoad) on++;
  }
  assert.ok(w.s >= walk.length - 1 && on < 80, `along the street it is not in the vehicles' way (${on} steps on a carriageway)`);
});
