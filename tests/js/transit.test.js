// Bus stops, bus lines and buses in operation (core/transit.js): stop geometry, routing through
// the stops, a bus serving every stop in order, boarding with the passenger simulation, managed
// docks, status texts, and town people riding a line to the right stop.
import assert from "node:assert/strict";
import test from "node:test";

import { createWorld, dot2, LayoutObject, Registry, registerBuiltins, rectFootprint, resolvePoint, World } from "../../web/arail/index.js";

/** A straight street from west to east (H0: 4000 mm = 348 m) with stops on both sides. */
const STREET = [
  { id: "main", type: "road", name: "Main street", points: [[0, 0], [4000, 0]] },
  { id: "a", type: "bus-stop", name: "West", position: [500, -70], side: "both" },
  { id: "b", type: "bus-stop", name: "Centre", position: [2000, -70], side: "both" },
  { id: "c", type: "bus-stop", name: "East", position: [3500, -70], side: "both" },
];

function world(objects, extra = {}) {
  return createWorld({
    objects,
    simulations: [{ type: "passengers", base_rate: 0 }],
    clock: { start: "10:00", profiles: false },
    ...extra,
  }, { seed: 7 });
}

function run(w, seconds, dt = 0.1) {
  w.speed = 1;
  for (let t = 0; t < seconds; t += dt) w.step(dt);
}

/** Record the vehicle events of line buses. */
function recordEvents(w) {
  const log = [];
  for (const name of ["vehicle.arriving", "vehicle.arrived", "vehicle.departing", "vehicle.departed"]) {
    w.events.on(name, (e) => {
      if (e.vehicle.source === "line") log.push({ name, bus: e.vehicle.id, dock: e.dock.id, area: e.area.id, t: w.time });
    });
  }
  return log;
}

test("bus stops: on both sides of the street, facing the direction of travel", () => {
  const w = world(STREET);
  const stop = w.getObject("a");
  assert.ok(stop.geometry.ok);
  const areas = w.stopAreas().filter((a) => a.owner === stop);
  assert.deepEqual(areas.map((a) => a.id).sort(), ["a:left", "a:right"]);
  const right = areas.find((a) => a.id === "a:right"), left = areas.find((a) => a.id === "a:left");
  // right side: south of the street (drawn west to east), buses drive east; left side: north, west
  assert.deepEqual(right.dir.map((v) => Math.round(v) + 0), [1, 0]);
  assert.deepEqual(left.dir.map((v) => Math.round(v) + 0), [-1, 0]);
  assert.ok(right.toLayout(right.L / 2, 0)[1] < 0 && left.toLayout(left.L / 2, 0)[1] > 0);
  for (const a of areas) {
    assert.equal(a.kind, "bus");
    assert.equal(a.docks.length, 1);
    const d = a.docks[0];
    assert.equal(d.managed, "line");
    assert.equal(d.side, 1, "dock on the street side");
    // the street side of the area is next to the carriageway (7 m street: 3.5 m from the centre)
    const curb = a.toLayout(a.L / 2, a.W / 2);
    assert.ok(Math.abs(Math.abs(curb[1]) - 3.5 * 1000 / 87) < 1, `curb at ${curb[1]}`);
    // access points on the outer side or at the ends, never on the street side
    for (const e of a.access) assert.ok(e.t <= 0.01, `access t=${e.t}`);
  }
  // the stop's position is projected onto the street: it slides along when moved
  stop.translate(100, -30);
  const moved = w.stopAreas().find((a) => a.id === "a:right");
  assert.ok(Math.abs(moved.toLayout(moved.L / 2, moved.W / 2)[1] + 3.5 * 1000 / 87) < 1);
  // one side only: the stop area has the object's id; far from a street: a problem, no stop area
  const w2 = world([STREET[0], { id: "s", type: "bus-stop", position: [800, 60], side: "left" }, { id: "far", type: "bus-stop", position: [800, 2000] }]);
  assert.deepEqual(w2.stopAreas().map((a) => a.id), ["s"]);
  assert.deepEqual(w2.stopAreas()[0].docks.map((d) => d.id), ["s:left"]);
  assert.equal(w2.getObject("far").geometry.ok, false);
  assert.equal(w2.getObject("far").problems().length, 1);
  assert.equal(w2.getObject("s").problems().length, 0);
});

test("bus lines: route through the stops in order, on the side of the direction of travel", () => {
  const w = world([...STREET, { id: "l", type: "bus-line", number: "62", stops: ["a", "b", "c"] }]);
  w.transit.sync();
  const line = w.transit.lines.get("l");
  assert.ok(line.ok, line.problems.join("; "));
  assert.deepEqual(line.visits.map((v) => v.dockId), ["a:right", "b:right", "c:right", "c:left", "b:left", "a:left"]);
  assert.deepEqual(line.visits.map((v) => v.start), [true, false, false, true, false, false]);
  assert.deepEqual(line.directions.map((d) => [d.dir, d.from, d.destination]), [[1, "West", "East"], [-1, "East", "West"]]);
  // visits in order along the circuit, which runs on the right lane of the street
  for (let i = 1; i < line.visits.length; i++) assert.ok(line.visits[i].s > line.visits[i - 1].s);
  const c = line.circuit;
  for (let i = 1; i < c.points.length; i++) {
    const [p, q] = [c.points[i - 1], c.points[i]];
    const dx = q[0] - p[0], y = (p[1] + q[1]) / 2;
    if (Math.abs(dx) > 1 && Math.abs(q[1] - p[1]) < 1e-6 && Math.abs(y) < 30) assert.ok(Math.sign(-y) === Math.sign(dx), "drives on the right");
  }
  // connections: from West to East eastbound, back westbound; not against the direction
  assert.deepEqual(w.transit.connections("a:right", "c:right").map((x) => [x.lineId, x.dir, x.fromDockId, x.toDockId, x.stops]), [["l", 1, "a:right", "c:right", 2]]);
  assert.deepEqual(w.transit.connections("c:left", "a:left").map((x) => [x.dir, x.toDockId]), [[-1, "a:left"]]);
  assert.equal(w.transit.connections("b:right", "a:left").length, 0, "would pass the terminus");
  const ride = w.transit.connections("a:right", "c:right")[0].rideMM;
  assert.ok(Math.abs(ride - 3000) < 60, `ride ${ride}`);
  // a loop: round in one direction
  const w2 = world([...STREET.slice(0, 1), { id: "n", type: "road", points: [[0, 0], [0, 1000], [4000, 1000], [4000, 0]] }, ...STREET.slice(1),
    { id: "loop", type: "bus-line", mode: "loop", stops: ["a", "c"] }]);
  w2.transit.sync();
  const loop = w2.transit.lines.get("loop");
  assert.ok(loop.ok, loop.problems.join("; "));
  assert.deepEqual(loop.visits.map((v) => v.dockId), ["a:right", "c:right"]);
  assert.equal(loop.directions.length, 1);
  assert.equal(w2.transit.connections("c:right", "a:right").length, 1, "round the loop back to the start");
});

test("bus lines: problems are reported (missing stop, one-sided stop, no street)", () => {
  const w = world([
    STREET[0],
    { id: "a", type: "bus-stop", name: "West", position: [500, -70], side: "right" },
    { id: "b", type: "bus-stop", name: "Centre", position: [2000, -70], side: "right" },
    { id: "c", type: "bus-stop", name: "East", position: [3500, -70], side: "right" },
    { id: "far", type: "bus-stop", name: "Nowhere", position: [500, 3000] },
    { id: "l", type: "bus-line", stops: ["a", "b", "c", "gone"] },
    { id: "bad", type: "bus-line", stops: ["a", "far"] },
  ]);
  const l = w.getObject("l"), bad = w.getObject("bad");
  assert.ok(l.problems().some((t) => t.includes("gone")), l.problems().join("; "));
  assert.ok(l.problems().some((t) => t.includes("Centre") && t.includes("both sides")), "Centre serves one direction only");
  assert.ok(l.info().ok, "the line still runs: back without stopping");
  assert.deepEqual(l.info().visits.map((v) => v.dockId), ["a:right", "b:right", "c:right"]);
  assert.equal(bad.info().ok, false);
  assert.ok(bad.problems().some((t) => t.includes("Nowhere")));
  assert.equal(l.lineLabel(), "l");
  l.set({ number: "62" });
  assert.equal(l.info().label, "62");
});

test("a bus serves every stop in order: arriving, arrived (doors open), departing, departed", () => {
  const w = world([...STREET, { id: "l", type: "bus-line", number: "62", headway_s: 600, stops: ["a", "b", "c"] }]);
  const log = recordEvents(w);
  run(w, 900);
  const buses = [...new Set(log.map((e) => e.bus))];
  assert.ok(buses.length >= 1);
  const bus = buses[0];
  const mine = log.filter((e) => e.bus === bus);
  const arrived = mine.filter((e) => e.name === "vehicle.arrived").map((e) => e.dock);
  const order = ["a:right", "b:right", "c:right", "c:left", "b:left", "a:left"];
  const first = order.indexOf(arrived[0]);
  assert.ok(first >= 0);
  assert.ok(arrived.length >= 4, `arrived ${arrived}`);
  arrived.forEach((d, i) => assert.equal(d, order[(first + i) % order.length], `stop ${i}`));
  // per stop: arriving -> arrived -> departing -> departed
  for (const dock of arrived.slice(0, -1)) {
    const seq = mine.filter((e) => e.dock === dock).map((e) => e.name);
    assert.deepEqual(seq.slice(0, 4), ["vehicle.arriving", "vehicle.arrived", "vehicle.departing", "vehicle.departed"], `${dock}: ${seq}`);
  }
  // the bus stands where the passenger simulation expects it: front at dock.s1 - 1.5 m
  const t = w.transit;
  run(w, 0); // no-op
  const lineInfo = t.lines.get("l");
  for (const v of lineInfo.visits) {
    const area = v.area, front = area.fromLayout(v.front);
    assert.ok(Math.abs(front[0] - (v.dock.s1 - 1.5)) < 0.01, `${v.dockId} front s=${front[0]}`);
    const p = lineInfo.circuit.points, at = lineInfo.circuit.lengths;
    // the circuit passes through the stop position
    const i = at.findIndex((s) => Math.abs(s - v.s) < 1e-6);
    assert.ok(i >= 0 && Math.hypot(p[i][0] - v.front[0], p[i][1] - v.front[1]) < 5, `${v.dockId} on the circuit`);
  }
});

test("a closed stop is passed: the next stop still gets vehicle.arriving before vehicle.arrived", () => {
  const w = world([...STREET, { id: "l", type: "bus-line", number: "62", headway_s: 120, stops: ["a", "b", "c"] }]);
  const log = recordEvents(w);
  w.disruptions.start({ type: "closure", target: "b", duration: null });
  // a bus is "arriving" (also on the boards) only on its last 60 m before a stop
  const line = () => w.transit.lines.get("l");
  let far = null;
  w.speed = 1;
  for (let t = 0; t < 900; t += 0.1) {
    w.step(0.1);
    for (const bus of w.transit.buses) {
      const m = w.transit.meters(w.transit._ahead(line(), bus.s, line().visits[bus.next].s));
      if (bus.phase === "arriving" && m > 61) far ||= `${bus.id} arriving at ${line().visits[bus.next].dockId} from ${m.toFixed(0)} m`;
    }
  }
  assert.equal(far, null);
  const arrivals = log.filter((e) => e.name === "vehicle.arrived");
  assert.ok(arrivals.length >= 4, `${arrivals.length} arrivals`);
  assert.ok(!arrivals.some((e) => e.area.startsWith("b:")), "no stop at the closed stop");
  for (const e of arrivals) {
    // the last event of this bus before it arrived announced this stop
    const before = log.slice(0, log.indexOf(e)).filter((x) => x.bus === e.bus && x.name !== "vehicle.departed");
    const last = before[before.length - 1];
    assert.ok(last && last.name === "vehicle.arriving" && last.dock === e.dock, `${e.bus} arrived at ${e.dock} after ${last?.name} ${last?.dock}`);
  }
});

test("passengers board line buses at a stop (with a line filter) and the timetable leaves managed docks alone", () => {
  const w = world([...STREET, { id: "l", type: "bus-line", number: "62", headway_s: 120, stops: ["a", "b", "c"] },
    { id: "term", type: "bus-terminal", position: [1500, 1500], bays: 2 }]);
  const pax = w.simulations.find((s) => s.constructor.type === "passengers");
  // the timetable does not serve bus stops of lines
  assert.ok(![...w.services.docks.keys()].some((id) => id.startsWith("a:") || id.startsWith("b:")));
  assert.equal(w.services.call("a"), null);
  assert.ok(w.services.docks.has("term:bay1"), "a terminal without lines keeps its timetable");
  const boarded = [];
  w.events.on("passenger.boarded", (e) => boarded.push(e));
  const agent = { id: "rider" }, other = { id: "other line" };
  pax.enter("b:right", { agent, dockId: "b:right", line: "l", at: [2000, -150] });
  pax.enter("b:right", { agent: other, dockId: "b:right", line: "l-99", at: [2000, -150] });
  run(w, 600);
  const mine = boarded.find((e) => e.agent === agent);
  assert.ok(mine, "boarded");
  assert.equal(mine.vehicle.kind, "bus");
  assert.equal(mine.vehicle.lineId, "l");
  assert.equal(mine.dock.id, "b:right");
  assert.ok(!boarded.some((e) => e.agent === other), "the other line never came");
  // the status of the stop comes from the line
  const status = w.transit.statusFor("b:right");
  assert.match(status, /^Bus 62 to East/);
  // a line that serves a terminal takes a bay away from the timetable
  w.addObject({ id: "l2", type: "bus-line", stops: ["term", "a"] });
  assert.equal(w.stopAreas().find((a) => a.id === "term").docks[0].managed, "line");
  w.step(0.1);
  assert.ok(!w.services.docks.has("term:bay1") && w.services.docks.has("term:bay2"));
});

test("bus stops and lines survive a round trip through the layout file", () => {
  const w = world([...STREET, { id: "l", type: "bus-line", number: "62", color: "#C85000", mode: "loop", stops: ["a", "c"] }]);
  const json = w.toJSON();
  const line = json.objects.find((o) => o.id === "l");
  assert.deepEqual(line, { id: "l", type: "bus-line", number: "62", color: "#C85000", mode: "loop", stops: ["a", "c"] });
  assert.deepEqual(json.objects.find((o) => o.id === "a"), { id: "a", type: "bus-stop", name: "West", position: [500, -70], side: "both" });
  const w2 = createWorld(json, { seed: 7 });
  w2.transit.sync();
  assert.deepEqual(w2.transit.lines.get("l").visits.map((v) => v.dockId), w.getObject("l").info().visits.map((v) => v.dockId));
});

test("no buses at night; the next bus is announced in clock minutes", () => {
  const w = world([...STREET, { id: "l", type: "bus-line", number: "7", stops: ["a", "c"] }], { clock: { start: "02:30" } });
  run(w, 600);
  assert.equal(w.transit.buses.length, 0);
  assert.match(w.transit.statusFor("a:right"), /no buses at night/);
  w.setTime("10:00");
  run(w, 400);
  assert.ok(w.transit.buses.length > 0);
  assert.match(w.transit.statusFor("c:left") + w.transit.statusFor("a:right"), /Bus 7 to (East|West)/);
  // deleting the line takes its buses out of service
  w.removeObject("l");
  w.step(0.1);
  assert.equal(w.transit.buses.length, 0);
});

/* ------------------------------------------------------------------ town people on the bus */

/** A minimal building with the building API the town needs. */
class Box extends LayoutObject {
  static type = "test-box";
  static params = [{ key: "use", type: "text", default: "residential" }, { key: "people", type: "number", default: 100 }];
  computeGeometry() {
    const c = resolvePoint(this.world.map, this.spec.position);
    return c ? { center: c, footprint: rectFootprint(c, 100, 80) } : null;
  }
  footprint() {
    return this.geometry?.footprint || null;
  }
  use() {
    return this.spec.use;
  }
  capacity() {
    const n = +this.spec.people;
    return this.spec.use === "work" ? { jobs: n } : { residents: n };
  }
  entrances() {
    const c = this.geometry.center;
    return [{ pos: [c[0], c[1] - 40], dir: [0, -1] }];
  }
}

test("town: people take the bus line, ride it and get off at their stop", () => {
  const registry = registerBuiltins(new Registry());
  registry.registerObject(Box);
  const w = new World({
    registry, seed: 11,
    layout: {
      objects: [
        ...STREET,
        { id: "home", type: "test-box", position: [400, 160], use: "residential", people: 300 },
        { id: "office", type: "test-box", position: [3600, 160], use: "work", people: 300 },
        { id: "l", type: "bus-line", number: "62", headway_s: 60, stops: ["a", "b", "c"] },
      ],
      simulations: [{ type: "passengers", base_rate: 0 }, { type: "town", people_per_100: 15, bus_share: 1, shopping: 0 }],
      clock: { start: "06:00" },
    },
  });
  const town = w.simulations.find((s) => s.constructor.type === "town");
  const pax = w.simulations.find((s) => s.constructor.type === "passengers");
  const boarded = new Map(), alighted = [];
  w.events.on("passenger.boarded", (e) => {
    if (e.vehicle?.source === "line") boarded.set(e.agent, e);
  });
  const alight = pax.alight.bind(pax);
  pax.alight = (vehicle, dock, agents) => {
    if (vehicle.source === "line") alighted.push({ vehicle, dock, agents: agents.slice() });
    return alight(vehicle, dock, agents);
  };
  let maxRiders = 0, ridersOk = true;
  w.speed = 10;
  while (w.clock.minutes < 9 * 60) {
    w.step(0.1);
    for (const bus of w.transit.buses) {
      maxRiders = Math.max(maxRiders, bus.riders.length);
      // on board are only people going to a stop further on: the eastbound stop at the office
      for (const r of bus.riders) if (r.toDockId !== "c:right") ridersOk = false;
    }
  }
  assert.ok(boarded.size >= 5, `${boarded.size} town people boarded a bus`);
  for (const e of boarded.values()) {
    assert.equal(e.vehicle.lineId, "l");
    assert.equal(e.dock.id, "a:right", "boarded at the stop near home, eastbound");
  }
  assert.ok(maxRiders >= 2, `riders ${maxRiders}`);
  assert.ok(ridersOk, "riders know their stop");
  const off = alighted.flatMap((x) => x.agents.map((a) => ({ a, dock: x.dock.id, vehicle: x.vehicle })));
  assert.ok(off.length >= 5, `${off.length} got off`);
  for (const { a, dock, vehicle } of off) {
    assert.equal(dock, "c:right", "got off at the stop near the office");
    assert.ok(boarded.has(a), "rode from the start");
    assert.ok(!vehicle.riders.some((r) => r.agent === a), "not on board any more");
  }
  // and walked on to work
  const atWork = [...boarded.keys()].filter((a) => a.state === "inside" && a.inside === "office");
  assert.ok(atWork.length >= off.length * 0.6, `${atWork.length} of ${off.length} at work`);
  assert.equal(town.agents.filter((a) => a.state === "riding").length, 0, "nobody left on a bus at 09:00");
});

test("traffic and buses share the street without running into each other", () => {
  const w = world([...STREET, { id: "l", type: "bus-line", number: "62", headway_s: 90, stops: ["a", "b", "c"] }], {
    simulations: [{ type: "passengers", base_rate: 0 }, { type: "traffic", cars_per_km: 40 }],
  });
  const traffic = w.simulations.find((s) => s.constructor.type === "traffic");
  let checks = 0;
  for (let i = 0; i < 6000; i++) {
    w.step(0.1);
    if (i % 50) continue;
    const users = traffic.roadUsers().concat(w.transit.roadUsers());
    for (const u of users) {
      for (const o of users) {
        if (o === u || dot2(u.dir, o.dir) < 0.9) continue;
        const d = [o.rear[0] - u.front[0], o.rear[1] - u.front[1]];
        const along = dot2(d, u.dir), lateral = Math.abs(u.dir[0] * d[1] - u.dir[1] * d[0]);
        if (lateral > 15) continue; // other lane
        const len = Math.hypot(o.front[0] - o.rear[0], o.front[1] - o.rear[1]);
        // o is ahead of u in the same lane: u's front must not be inside o
        assert.ok(!(along < 0 && along > -len), `${u.vehicle.id} runs into ${o.vehicle.id} (${along.toFixed(1)} mm)`);
        checks++;
      }
    }
  }
  assert.ok(checks > 100, `${checks} pairs checked`);
  assert.ok(traffic.cars.length > 3);
  assert.ok(w.transit.buses.length > 0);
});
