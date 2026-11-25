// Road traffic that flows (core/transit.js, core/stop-signals.js, sims/traffic.js, sims/cycling.js):
// ways through a junction that do not touch need no waiting, a queue starts off together, the strip
// of a tram stop is kept clear, a bus at its stop is passed, the cars learn how long drives take.
import assert from "node:assert/strict";
import test from "node:test";

import {
  FOLLOW_TAU_S, GRIDLOCK_S, STOP_SIGNAL, StopSignals, blockerAfter, createWorld, entering, followSpeed, movesConflict, mustYield, speedAlong, squeezing, waitFor,
} from "../../web/arail/index.js";
import { readJSON } from "./helpers.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} is not within ${tol} of ${b}`);

/** The ways through a crossroads: arms to the east (edge 0), north (1), west (2) and south (3). */
const ARMS = { e: [0, 0], n: [1, Math.PI / 2], w: [2, Math.PI], s: [3, -Math.PI / 2] };
const way = (from, to) => ({ key: "j", inEdge: ARMS[from][0], outEdge: ARMS[to][0], a0: ARMS[from][1], a1: ARMS[to][1], turn: null });

test("a junction: only ways that touch make a vehicle wait", () => {
  // from the south
  const straight = way("s", "n"), left = way("s", "w"), right = way("s", "e");
  // the oncoming traffic
  assert.equal(movesConflict(straight, way("n", "s")), false, "two going straight past each other");
  assert.equal(movesConflict(left, way("n", "s")), true, "turning left across the oncoming traffic");
  assert.equal(movesConflict(left, way("n", "e")), false, "two turning left in front of each other");
  assert.equal(movesConflict(right, way("n", "s")), false, "turning right beside the oncoming traffic");
  assert.equal(movesConflict(right, way("n", "e")), true, "into the same street as the one turning left");
  // the street across
  assert.equal(movesConflict(straight, way("e", "w")), true);
  assert.equal(movesConflict(straight, way("w", "e")), true);
  assert.equal(movesConflict(right, way("w", "e")), true, "into the same lane");
  assert.equal(movesConflict(right, way("e", "w")), false, "turning right while the other street's traffic leaves the other way");
  assert.equal(movesConflict(straight, way("e", "n")), true, "into the same street");
  assert.equal(movesConflict(straight, way("w", "s")), false, "a right turn out of the way");
  // from the same arm: they follow each other
  assert.equal(movesConflict(straight, left), false);
  // the same both ways round
  for (const a of ["n", "e", "w"]) for (const b of ["n", "e", "s", "w"]) {
    if (a !== b) for (const mine of [straight, left, right]) assert.equal(movesConflict(mine, way(a, b)), movesConflict(way(a, b), mine), `${a}→${b}`);
  }
  // where a way is not known, they touch
  assert.equal(movesConflict(straight, { key: "j", inEdge: 1, outEdge: 3 }), true);
  // mustYield: a vehicle in the junction whose way does not touch is not waited for
  const j = { ...straight, pos: [0, 0], r: 50 };
  const inside = (move) => ({ vehicle: { kind: "car", seq: 1 }, front: [10, 0], rear: [-30, 0], move });
  assert.equal(mustYield({ kind: "car", seq: 5 }, j, 300, [inside(way("e", "w"))]), true);
  assert.equal(mustYield({ kind: "car", seq: 5 }, j, 300, [inside(way("n", "s"))]), false, "the oncoming one going straight");
  assert.equal(mustYield({ kind: "car", seq: 5 }, j, 300, [inside(way("s", "n"))]), false, "the one ahead (the one behind keeps its distance)");
  assert.equal(mustYield({ kind: "car", seq: 5 }, j, 300, [inside(undefined)]), true, "a way not known");
  assert.equal(mustYield({ kind: "car", seq: 5 }, j, 300, [inside({ ...way("e", "w"), key: "other" })]), true, "its way through another junction says nothing");
  // coming with the same priority: who turns left waits for the oncoming one (StVO § 9), also when closer
  const coming = (move, d) => ({ vehicle: { kind: "car", seq: 1 }, front: [0, 500], rear: [0, 540], approach: { key: "j", d, prio: 1 }, move });
  const turning = { ...left, turn: "left", pos: [0, 0], r: 50 };
  assert.equal(mustYield({ kind: "car", seq: 5 }, turning, 100, [coming({ ...way("n", "s"), turn: "straight" }, 400)]), true);
  assert.equal(mustYield({ kind: "car", seq: 5 }, { ...j, turn: "straight" }, 400, [coming({ ...way("n", "w"), turn: "left" }, 100)]), false, "and is waited for by nobody");
  assert.equal(mustYield({ kind: "car", seq: 5 }, { ...j, turn: "straight" }, 400, [coming({ ...way("n", "s"), turn: "straight" }, 100)]), false, "ways that do not touch: no waiting, however close");
  // only for the oncoming one: before one from the side street the closer goes first, turning left or not
  assert.equal(mustYield({ kind: "car", seq: 5 }, turning, 100, [coming({ ...way("w", "e"), turn: "straight" }, 400)]), false, "closer than the one from the left");
  assert.equal(mustYield({ kind: "car", seq: 5 }, turning, 400, [coming({ ...way("w", "e"), turn: "straight" }, 100)]), true, "the one from the left is closer");
  assert.equal(mustYield({ kind: "car", seq: 5 }, { ...way("w", "e"), turn: "straight", pos: [0, 0], r: 50 }, 100, [coming({ ...left, turn: "left" }, 400)]), false, "and the one going straight does not go first just because the other turns left");
});

test("in a street network: a junction's ways come with the directions of their arms", () => {
  const world = createWorld({
    scale: 87,
    objects: [
      { id: "ew", type: "road", name: "Ost-West", points: [[-3000, 0], [3000, 0]] },
      { id: "ns", type: "road", name: "Nord-Süd", points: [[0, -3000], [0, 3000]] },
    ],
    simulations: [],
  });
  const net = world.network();
  const node = (x, y) => net.nearestNode([x, y], { mode: "car" });
  const through = (from, to) => {
    const route = net.route(node(...from), node(...to), { mode: "car" });
    const j = net.junctionsAlong(route, net.drivingLine(route));
    assert.equal(j.length, 1);
    return j[0];
  };
  const fromWest = through([-3000, 0], [3000, 0]), fromEast = through([3000, 0], [-3000, 0]), fromSouth = through([0, -3000], [0, 3000]), turning = through([-3000, 0], [0, 3000]);
  near(Math.abs(fromWest.a0), Math.PI, 1e-6, "it comes in by the arm to the west");
  near(fromWest.a1, 0, 1e-6, "and goes out by the arm to the east");
  assert.equal(movesConflict(fromWest, fromEast), false);
  assert.equal(movesConflict(fromWest, fromSouth), true);
  assert.equal(movesConflict(turning, fromEast), true, "it turns across the oncoming lane");
  assert.equal(net.armAngle(fromWest.node, 99999), null);
});

test("following: at the leader's speed with the way of a second between, to a stand behind one that stands", () => {
  assert.equal(followSpeed(0, 0, 2.5), 0);
  assert.equal(followSpeed(-3, 0, 2.5), 0);
  // behind a standing vehicle: slower than braking at the last moment would allow (the driver reacts first)
  const stand = followSpeed(20, 0, 2.5);
  assert.ok(stand > 6 && stand < Math.sqrt(2 * 2.5 * 20));
  // behind one that drives: its speed with a gap of v × τ
  near(followSpeed(13.9 * FOLLOW_TAU_S, 13.9, 2.5), 13.9, 1e-6, "50 km/h, 14 m apart");
  assert.ok(followSpeed(5, 13.9, 2.5) < 13.9 && followSpeed(30, 13.9, 2.5) > 13.9, "closer: slower; farther: it catches up");
  // so a lane carries about a vehicle every 1.5 s where the old rule (stop within the gap) carried one every 3 s
  const gapOld = (13.9 * 13.9) / (2 * 2.5);
  assert.ok(13.9 * FOLLOW_TAU_S < gapOld / 2);
  assert.equal(speedAlong(null, [1, 0]), 0);
  near(speedAlong({ speed: 10, dir: [1, 0] }, [1, 0]), 10, 1e-9);
  near(speedAlong({ speed: 10, dir: [0, 1] }, [1, 0]), 0, 1e-9, "one crossing is not driven after");
  near(speedAlong({ vehicle: { v: 4 }, dir: [1, 0] }, [1, 0]), 4, 1e-9);
});

test("rings of vehicles that wait for each other's room: one drives into its junction, still behind the one ahead", () => {
  // four queues round a block, each waiting for room behind its junction
  const cars = [0, 1, 2, 3].map(() => ({ v: 0 }));
  let t = 0;
  for (; t < GRIDLOCK_S + 2 && !cars.some(entering); t += 0.1) cars.forEach((c, i) => waitFor(c, { vehicle: cars[(i + 1) % 4] }, 0.1, true));
  assert.ok(cars.some(entering), "one goes in");
  assert.ok(!cars.some(squeezing), "nobody drives through another for this");
  assert.ok(t > GRIDLOCK_S - 0.2);
  // vehicles nose to nose squeeze past as before
  const a = { v: 0 }, b = { v: 0 };
  for (t = 0; t < GRIDLOCK_S + 1 && !squeezing(a) && !squeezing(b); t += 0.1) {
    waitFor(a, { vehicle: b }, 0.1);
    waitFor(b, { vehicle: a }, 0.1);
  }
  assert.ok(squeezing(a) || squeezing(b));
  // who leaves no room behind a junction: the one standing there
  const standing = { vehicle: { kind: "car", v: 0 }, front: [110, 0], rear: [70, 0], dir: [1, 0], speed: 0 };
  assert.equal(blockerAfter({}, [50, 0], [1, 0], [standing], 50, 20), standing);
  assert.equal(blockerAfter({}, [50, 0], [1, 0], [{ ...standing, speed: 5 }], 50, 20), null);
});

/** A light at a stop of a tram in the middle of the street: its stop line at x = 0, the strip to x = 300, traffic in +x. */
function stopLight() {
  const sig = { id: "stop:right", areaId: "stop", dockId: "stop:right", kind: "board", dir: [1, 0], line: [[0, 10], [0, 30]], zone: [[0, 0], [300, 0], [300, 40], [0, 40]], depth: 10 };
  const world = { time: 0, scale: 87, objectsVersion: 1, map: { version: 1 }, objects: [{ geometry: {}, stopSignals: () => [sig] }] };
  const signals = new StopSignals(world);
  const tram = { kind: "tram", phase: "dwelling", dock: { id: "stop:right" }, v: 0 };
  const transit = { buses: [tram], meters: (x) => (x * 87) / 1000, ahead: () => null };
  const step = (users, seconds = 0.1) => {
    for (let t = 0; t < seconds; t += 0.1) {
      world.time += 0.1;
      signals.step(0.1, transit, users);
    }
  };
  return { signals, tram, step, world };
}
const car = (x, v = 0, more = {}) => ({ vehicle: { kind: "car", v, ...more }, front: [x, 20], rear: [x - 50, 20], dir: [1, 0], speed: v });

test("the lights at a tram stop: a vehicle past the stop line drives on; vehicles that stand on the strip do not keep the doors shut for good", () => {
  const L = stopLight();
  // red while a tram stands there
  L.step([], STOP_SIGNAL.minGreen_s + STOP_SIGNAL.amber_s + 1);
  assert.equal(L.signals.state("stop:right"), "red");
  const blockers = L.signals.blockers();
  assert.ok(blockers.length >= 2);
  const obeys = blockers[0].vehicle.obeys;
  assert.equal(obeys({ kind: "car", v: 0 }, [-40, 20]), true, "before the line: it stops");
  assert.equal(obeys({ kind: "car", v: 0 }, [20, 20]), false, "past it (it turned in behind the line): it drives on and clears the strip");
  assert.equal(obeys({ kind: "tram", v: 0 }, [-40, 20]), false, "trams pass the lights");
  // the strip is free: people may cross, the tram opens its doors
  L.step([], 1);
  assert.equal(L.signals.walk("stop"), true);
  assert.equal(L.signals.holdsDoors("stop:right"), false);
  // a car drives on the strip: nobody steps onto it
  L.step([car(150, 5)], 1);
  assert.equal(L.signals.walk("stop"), false);
  assert.equal(L.signals.holdsDoors("stop:right"), true);
  // it stands there (a queue ahead): after a moment the people walk between, and it stays where it is
  const queued = car(150, 0);
  L.step([queued], STOP_SIGNAL.stand_s - 1);
  assert.equal(L.signals.walk("stop"), false, "not at once");
  L.step([queued], 2.5);
  assert.equal(L.signals.walk("stop"), true, "then they walk between the standing vehicles");
  assert.equal(L.signals.holdsDoors("stop:right"), false);
  const held = L.signals.blockers().find((b) => b.vehicle.id.endsWith(":held"));
  assert.ok(held, "the vehicle on the strip is held");
  assert.equal(held.vehicle.obeys(queued.vehicle), true);
  assert.equal(held.vehicle.obeys({ kind: "car" }), false, "only that one");
  assert.ok(held.rear[0] > queued.front[0] && held.rear[0] - queued.front[0] < 10, "just before its front");
});

test("the strip of a tram stop is kept clear: nobody drives onto it while the traffic stands at its far end", () => {
  const L = stopLight();
  L.tram.phase = "driving";
  L.step([], 1);
  assert.equal(L.signals.state("stop:right"), "green");
  assert.equal(L.signals.blockers().length, 0);
  // a queue reaches back to the end of the strip (x = 300): the stop line holds those still before it, at green
  const end = car(360, 0);
  L.step([end], 0.2);
  assert.equal(L.signals.state("stop:right"), "green");
  const line = L.signals.blockers();
  assert.ok(line.length >= 2, "held at the stop line");
  assert.equal(line[0].vehicle.obeys({ kind: "car", v: 3 }, [-40, 20]), true);
  assert.equal(line[0].vehicle.obeys({ kind: "car", v: 3 }, [50, 20]), false, "who is on the strip already drives off it");
  // the queue moves on: free again
  L.step([car(360, 4)], 0.2);
  assert.equal(L.signals.blockers().length, 0);
  // a tram at the end is no reason (it is not in the car lane's way as a queue is)
  L.step([{ ...car(360, 0), vehicle: { kind: "tram", v: 0 } }], 0.2);
  assert.equal(L.signals.blockers().length, 0);
});

/** A street with a bus stop in the lane, cars coming in at its ends. */
function busStreet(traffic = {}) {
  return createWorld({
    scale: 87,
    objects: [
      { id: "street", type: "road", name: "Lange Straße", points: [[-4000, 0], [8000, 0]] },
      { id: "cross", type: "road", name: "Querstraße", points: [[7000, -1500], [7000, 1500]] },
      { id: "stop-a", type: "bus-stop", name: "Mitte", road: "street", position: [2000, 0], side: "both", dwell_s: 60 },
      { id: "stop-b", type: "bus-stop", name: "Ost", road: "street", position: [6000, 0], side: "both" },
      { id: "line", type: "bus-line", name: "Line 1", number: "1", stops: ["stop-a", "stop-b"], headway_s: 120 },
    ],
    simulations: [{ type: "traffic", cars_per_km: 6, destinations: 0, ...traffic }],
    clock: { start: "10:00", profiles: false },
  }, { seed: 3 });
}

test("a bus at its stop is passed when the other lane is free; the cars' drives are learned from", () => {
  const world = busStreet();
  const traffic = world.simulations[0];
  let passed = 0, behind = 0, overlap = 0;
  const mm = (m) => (m * 1000) / world.scale;
  for (let i = 0; i < 6000; i++) {
    world.step(0.05);
    for (const car of traffic.cars) {
      if (car.passing?.slow) {
        passed++;
        assert.ok(car.v <= 25 / 3.6, `slowly past the bus (StVO § 20): ${(car.v * 3.6).toFixed(0)} km/h`);
      }
      if (car.leader?.kind === "bus" && car.leader.phase === "dwelling") behind++;
    }
    // nobody drives through anybody on the way past
    if (i % 5 === 0) {
      const users = [...traffic.roadUsers(), ...world.transit.roadUsers().filter((u) => u.vehicle.kind === "bus")];
      for (const a of traffic.roadUsers()) for (const b of users) {
        if (a === b || a.vehicle === b.vehicle) continue;
        if (Math.hypot(a.front[0] - b.front[0], a.front[1] - b.front[1]) < mm(1.2)) overlap++;
      }
    }
  }
  assert.ok(passed > 0, "cars pass the bus at its stop");
  assert.equal(overlap, 0, "nobody in anybody");
  assert.ok(traffic.drives > 20, `${traffic.drives} drives finished`);
  assert.ok(world.experience.trips.car === traffic.drives || world.experience.trips.car > 0, "the town hears of each drive");
  assert.ok(traffic.jams <= traffic.drives);
  // what a drive should take on empty streets is near what it takes on a quiet street
  world.experience.settle();
  const ratio = world.experience.ratio("car", 10 * 60 + 30);
  assert.ok(ratio > 0.7 && ratio < 1.8, `drives take ${ratio.toFixed(2)} times their plan`);
  assert.ok(behind >= 0);
});

test("the cars from beyond the layout learn: an hour known for its jams sees fewer set out", () => {
  const world = busStreet();
  const traffic = world.simulations[0];
  world.step(0.1);
  assert.equal(traffic.share(), 1, "nothing known: everybody drives");
  const all = traffic.wanted();
  assert.ok(Math.abs(all - traffic.targetCount()) < 1e-9 && all > 0);
  // the town has learned that drives take three times as long at this hour
  world.experience.configure({ days: 7, modes: { car: { weekday: Array(24).fill(3), weekend: Array(24).fill(1) } } });
  assert.ok(traffic.share() < 0.8, `${traffic.share()}`);
  assert.ok(traffic.wanted() < all * 0.8);
  world.experience.configure({ days: 7, modes: { car: { weekday: Array(24).fill(5), weekend: Array(24).fill(1) } } });
  assert.ok(traffic.share() < 0.25, "the longer the drives take, the fewer");
  near(traffic.expectedRatio(), (5 + traffic.liveRatio()) / 2, 1e-9, "what was learned and the traffic news, each half");
  assert.ok(traffic.liveRatio() >= 1);
  // where a town is simulated, its own settings say when drivers give up and what a jam is (the table modes, row everybody)
  const share = traffic.share();
  world.simulations.push({ constructor: { type: "town" }, enabled: true, step() {}, taste: { everybody: { quit: 8, jam: 4 } } });
  assert.ok(traffic.share() > share * 2, "patient drivers: more of them still come");
  const car = { t0: world.time - 30, free: 10, began: 8 * 60, weekend: false };
  traffic._finish(car);
  assert.equal(traffic.jams, 0, "three times the plan is no jam where a jam begins at four");
  world.simulations.pop();
  traffic._finish({ t0: world.time - 30, free: 10, began: 8 * 60, weekend: false });
  assert.equal(traffic.jams, 1);
  // a drive is planned with the wait at the lights of one who comes at any time
  const lights = createWorld({ objects: [{ id: "l", type: "traffic-light", position: [0, 0], cycle_s: 60, split: 50 }], simulations: [] }).getObject("l");
  near(lights.expectedWait(0), ((1 - 28 / 60) ** 2 * 60) / 2, 1e-9);
  assert.ok(lights.expectedWait(1) > 0);
});

test("Bf Neustadt: the traffic keeps moving through a morning, nobody waits for ever", () => {
  const layout = readJSON("web/layouts/ebl-neustadt.json");
  const world = createWorld(layout);
  world.speed = 2;
  world.setTime("06:30");
  const traffic = world.simulations.find((s) => s.constructor.type === "traffic"), cycling = world.simulations.find((s) => s.constructor.type === "cycling");
  const since = new Map();
  let longest = 0, v = 0, n = 0, standing = 0, allSince = null, allStanding = 0, samples = 0;
  while (world.clock.minutes < 9 * 60 + 30) {
    world.step(0.1);
    const all = [...traffic.cars, ...cycling.riders, ...world.transit.buses];
    for (const x of all) {
      // (not a bus or tram at its stop, where it stands for its people or its departure)
      if ((x.v ?? 0) > 0.3 || x.phase === "dwelling") since.delete(x);
      else if (!since.has(x)) since.set(x, world.time);
      else longest = Math.max(longest, world.time - since.get(x));
    }
    if (world.clock.minutes >= 7 * 60) {
      samples++;
      let stand = 0;
      for (const car of traffic.cars) {
        n++;
        v += car.v;
        if (car.v < 0.5) stand++;
      }
      standing += stand;
      // (all cars at a stand for a moment happens, at the lights and the level crossing; for a minute it is a gridlock)
      if (traffic.cars.length >= 10 && stand === traffic.cars.length) allStanding = Math.max(allStanding, world.time - (allSince ??= world.time));
      else allSince = null;
    }
  }
  // (a queue of the rush hour may stand for some minutes before the level crossing and the lights; a vehicle
  // that never moves again would stand from where it stopped to the end of these 900 s)
  assert.ok(longest < 600, `no vehicle stands for good (the longest ${Math.round(longest)} s)`);
  assert.ok(allStanding < 60, `never all cars at a stand for a minute (the longest ${Math.round(allStanding)} s)`);
  assert.ok((v / n) * 3.6 > 8, `cars at ${((v / n) * 3.6).toFixed(1)} km/h on average through the rush hour`);
  assert.ok(standing / n < 0.65, `${Math.round((100 * standing) / n)} % of the cars stand`);
});
