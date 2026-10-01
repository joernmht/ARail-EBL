// Bus lines in daily operation (core/transit.js, sims/traffic.js, sims/town.js): lay-overs that
// do not block the street or the terminal lane, as many buses as needed (none at night), cars put
// back on the streets after an edit, riders whose stop disappears, loop lines ("Ring ↻"), one board
// per stop with a small badge from far away, overlapping streets, and commuters by bus.
import assert from "node:assert/strict";
import test from "node:test";

import {
  BOARD_MIN_PX, Camera, createWorld, dockStatus, dot2, FlyCamera, gapAhead, LayoutObject, rectFootprint, Registry, registerBuiltins, resolvePoint,
  ringName, toRad, turningNumber, View, World,
} from "../../web/arail/index.js";

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

/**
 * Run for `seconds` of simulated time and return the longest time (s) a vehicle stood still
 * while not at a stop (buses of lines and cars of the traffic simulation).
 */
function runAndWatch(w, seconds, dt = 0.25) {
  const traffic = w.simulations.find((s) => s.constructor.type === "traffic");
  const standing = new Map();
  let worst = { t: 0 };
  w.speed = 1;
  for (let t = 0; t < seconds; t += dt) {
    w.step(dt);
    for (const v of [...w.transit.buses, ...(traffic?.cars || [])]) {
      const still = v.v < 0.1 && v.phase !== "dwelling" && v.phase !== "departing";
      const s = still ? (standing.get(v) || 0) + dt : 0;
      standing.set(v, s);
      if (s > worst.t) worst = { t: s, id: v.id, at: v._pose?.front.map(Math.round) };
    }
  }
  return worst;
}

/* ------------------------------------------------------------------ review fixes */

test("a bus laying over does not block the street or the terminal lane", () => {
  // two lines start at the same terminal: the bus of one line laying over in the first bay stood
  // in the way of the other line's buses (and the cars behind them) until its departure
  const w = world([
    { id: "main", type: "road", points: [[-500, 0], [5000, 0]] },
    { id: "t", type: "bus-terminal", name: "Station", position: [700, -150], bays: 2 },
    { id: "e", type: "bus-stop", name: "East", position: [3000, -70], side: "both" },
    { id: "f", type: "bus-stop", name: "Far", position: [4500, -70], side: "both" },
    { id: "l1", type: "bus-line", number: "1", headway_s: 300, stops: ["t", "e"] },
    { id: "l2", type: "bus-line", number: "2", headway_s: 300, stops: ["t", "f"] },
  ], { simulations: [{ type: "passengers", base_rate: 0 }, { type: "traffic", cars_per_km: 25 }] });
  w.transit.sync();
  assert.deepEqual([...w.transit.lines.values()].map((l) => l.visits[0].dockId), ["t:bay1", "t:bay2"]);
  const laidOver = new Set();
  w.events.on("vehicle.arrived", (e) => e.vehicle.waiting && laidOver.add(e.vehicle.lineId));
  const worst = runAndWatch(w, 2400);
  assert.deepEqual([...laidOver].sort(), ["l1", "l2"], "buses of both lines laid over");
  assert.ok(worst.t < 60, `${worst.id} stood still for ${worst.t.toFixed(0)} s at ${worst.at}`);
});

test("as many buses as the timetable needs: extra buses go to the depot, none at night", () => {
  const w = world([...STREET, { id: "l", type: "bus-line", number: "62", headway_s: 60, stops: ["a", "c"] }], {
    clock: { start: "17:00", profiles: true },
  });
  const t = w.transit, line = () => t.lines.get("l");
  const counts = {};
  w.speed = 10;
  let notInService = 0;
  w.events.on("vehicle.arrived", (e) => e.vehicle.source === "line" && e.vehicle.outOfService && notInService++);
  while (!(w.clock.minutes >= 3 * 60 && w.clock.minutes < 4 * 60)) {
    w.step(0.1);
    const h = Math.floor(w.clock.minutes / 60);
    counts[h] = Math.max(counts[h] || 0, t.buses.length);
    // never more than one bus above what the timetable needs (a bus in the depot comes back at once)
    assert.ok(t.buses.filter((b) => !b.outOfService).length <= t._needed(line()) + 1 || w.clock.minutes < 17 * 60 + 30,
      `${t.buses.length} buses at ${w.clock.label()} (${t._needed(line())} needed)`);
  }
  assert.ok(counts[17] >= 3, `rush hour: ${counts[17]} buses`);
  assert.ok(counts[22] < counts[17], `evening ${counts[22]} < rush hour ${counts[17]}`);
  assert.ok(notInService > 0, "buses went to the depot at the end of a trip");
  assert.equal(t.buses.length, 0, "no buses at night");
  // a bus that was waiting to come in when the night began stays in the depot
  line().starts[0].pending = 1;
  for (let i = 0; i < 100; i++) w.step(0.1);
  assert.equal(t.buses.length, 0);
  assert.equal(line().starts[0].pending, 0);
});

test("at night, without buses or trains, nobody waits at the stops", () => {
  const w = world([...STREET, { id: "l", type: "bus-line", number: "62", stops: ["a", "c"] },
    { id: "p", type: "platform", from: [0, 1000], to: [800, 1000], width_mm: 60, sides: "both" }], {
    simulations: [{ type: "passengers", base_rate: 2 }], clock: { start: "00:00", profiles: true },
  });
  const pax = w.simulations[0];
  const waiting = (kind) => [...pax.crowds.values()].filter((c) => c.area.kind === kind).reduce((s, c) => s + c.people.length, 0);
  w.speed = 10;
  while (w.clock.minutes < 50) w.step(0.1);
  assert.ok(waiting("bus") > 3 && waiting("rail") > 3, `${waiting("bus")} at the bus stops, ${waiting("rail")} on the platform before 01:00`);
  while (w.clock.minutes < 3 * 60) w.step(0.1);
  assert.equal(waiting("bus") + waiting("rail"), 0, "they went home");
  // in the morning they come again
  while (w.clock.minutes < 6 * 60) w.step(0.1);
  assert.ok(waiting("bus") + waiting("rail") > 3);
});

test("two vehicles on one spot do not wait for each other", () => {
  const u = { vehicle: { id: "u" }, front: [100, 0], rear: [100, 0], dir: [1, 0] };
  const v = { vehicle: { id: "v" }, front: [100, 0], rear: [100, 0], dir: [1, 0] };
  assert.equal(gapAhead(u.vehicle, u.front, u.dir, [u, v], 200, 15), Infinity);
  assert.equal(gapAhead(v.vehicle, v.front, v.dir, [u, v], 200, 15), Infinity);
  // one just ahead: the other waits
  const ahead = { ...v, front: [130, 0], rear: [101, 0] };
  assert.equal(gapAhead(u.vehicle, u.front, u.dir, [u, ahead], 200, 15), 1);
  assert.equal(gapAhead(ahead.vehicle, ahead.front, ahead.dir, [u, ahead], 200, 15), Infinity);
});

test("cars stay where they are when the streets or the scale change, and keep moving", () => {
  const w = world([
    { id: "ew", type: "road", points: [[0, 0], [4000, 0]] },
    { id: "ns", type: "road", points: [[2000, -2000], [2000, 2000]] },
    { id: "ring", type: "road", points: [[0, 0], [0, 1500], [4000, 1500], [4000, 0]] },
  ], { simulations: [{ type: "traffic", cars_per_km: 30 }] });
  const traffic = w.simulations[0];
  runAndWatch(w, 120);
  const before = new Map(traffic.cars.map((c) => [c.id, traffic._pose(c).front]));
  // a stop added: the streets are the same, only where buses stop changed
  w.addObject({ id: "s", type: "bus-stop", position: [1000, -70], side: "both" });
  w.step(0.01);
  let kept = 0;
  for (const c of traffic.cars) {
    const p = before.get(c.id);
    if (p && Math.hypot(p[0] - c._pose.front[0], p[1] - c._pose.front[1]) < 5) kept++;
  }
  assert.ok(kept >= before.size * 0.7, `${kept} of ${before.size} cars kept their place`);
  // the scale: back and forth (the cars used to pile up on the junctions and block each other for good)
  w.setScale(120);
  runAndWatch(w, 60);
  w.setScale(87);
  const worst = runAndWatch(w, 240);
  assert.ok(worst.t < 60, `${worst.id} stood still for ${worst.t.toFixed(0)} s at ${worst.at}`);
  const fronts = traffic.cars.map((c) => traffic._pose(c));
  for (let i = 0; i < fronts.length; i++) {
    for (let j = i + 1; j < fronts.length; j++) {
      const d = Math.hypot(fronts[i].front[0] - fronts[j].front[0], fronts[i].front[1] - fronts[j].front[1]);
      assert.ok(d > 3 || dot2(fronts[i].dir, fronts[j].dir) < 0.5, `${fronts[i].vehicle.id} and ${fronts[j].vehicle.id} on one spot`);
    }
  }
});

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

function townWorld(objects, extra = {}) {
  const registry = registerBuiltins(new Registry());
  registry.registerObject(Box);
  return new World({
    registry, seed: 11,
    layout: {
      objects,
      simulations: [{ type: "passengers", base_rate: 0 }, { type: "town", people_per_100: 15, bus_share: 1, shopping: 0 }],
      clock: { start: "06:00" },
      ...extra,
    },
  });
}

test("town: riders whose stop is taken off the line get off at the next stop", () => {
  const w = townWorld([
    ...STREET,
    { id: "home", type: "test-box", position: [400, 160], use: "residential", people: 300 },
    { id: "office", type: "test-box", position: [3600, 160], use: "work", people: 300 },
    { id: "l", type: "bus-line", number: "62", headway_s: 60, stops: ["a", "b", "c"] },
  ]);
  const town = w.simulations.find((s) => s.constructor.type === "town");
  w.speed = 10;
  while (!w.transit.buses.some((b) => b.riders.length >= 2) && w.clock.minutes < 9 * 60) w.step(0.1);
  const riders = town.agents.filter((a) => a.state === "riding");
  assert.ok(riders.length >= 2, `${riders.length} riding`);
  w.removeObject("c"); // their stop
  for (let i = 0; i < 1500; i++) w.step(0.1);
  for (const a of riders) assert.notEqual(a.state, "riding", `${a.id} still on the bus`);
  assert.ok(riders.some((a) => a.inside === "office"), "walked on to work from the stop before");
});

test("town: riders whose stop is removed while their bus closes its doors get off at the next stop, not this one", () => {
  const w = townWorld([
    ...STREET,
    { id: "home", type: "test-box", position: [400, 160], use: "residential", people: 300 },
    { id: "office", type: "test-box", position: [3600, 160], use: "work", people: 300 },
    { id: "l", type: "bus-line", number: "62", headway_s: 60, stops: ["a", "b", "c"] },
  ]);
  const town = w.simulations.find((s) => s.constructor.type === "town");
  w.speed = 10;
  // a bus with riders for East (c) closes its doors at Centre (b)
  const closing = () => w.transit.buses.find((b) => b.phase === "departing" && b.doorsLeft > 0 && b.dock?.id === "b:right" && b.riders.some((r) => r.toDockId?.startsWith("c:")));
  while (!closing() && w.clock.minutes < 10 * 60) w.step(0.05);
  const bus = closing();
  assert.ok(bus, "a bus with riders for East closing its doors at Centre");
  w.removeObject("c");
  w.transit.sync();
  town._sanity();
  const riders = bus.riders.filter((r) => town.agents.includes(r.agent));
  assert.ok(riders.length > 0);
  // Centre's people got off already: the riders get off at the stop after it
  for (const r of riders) assert.notEqual(r.toDockId, "b:right", "the stop the bus is leaving");
});

test("the doors of a bus open towards the stop: on the right at a bus stop, on the left in a terminal bay", () => {
  const w = world([
    { id: "main", type: "road", points: [[-500, 0], [5000, 0]] },
    { id: "t", type: "bus-terminal", name: "Station", position: [700, -150], bays: 2 },
    { id: "e", type: "bus-stop", name: "East", position: [3000, -70], side: "both" },
    { id: "l", type: "bus-line", number: "1", headway_s: 120, stops: ["t", "e"] },
  ]);
  const seen = new Set();
  const both = () => [...seen].some((id) => id.startsWith("t:")) && [...seen].some((id) => id.startsWith("e:"));
  w.speed = 1;
  for (let i = 0; i < 6000 && !both(); i++) {
    w.step(0.25);
    const bus = w.transit.buses.find((b) => b.doorsOpen && !seen.has(b.dock.id));
    if (!bus) continue;
    const { view } = viewAt(bus._pose.front, 800);
    const faces = [];
    view.faces = (f) => faces.push(...f);
    w.transit._drawBus(view, bus, w.transit.lines.get("l"));
    // the face with the doors (dark decals down to the floor) looks towards the waiting area
    const face = faces.find((f) => (f.side === "left" || f.side === "right") && (f.decals || []).some((d) => d.color === "#292929"));
    assert.ok(face, `doors drawn at ${bus.dock.id}`);
    const area = bus.dock.area, c = area.toLayout(area.L / 2, 0), mid = [(bus._pose.front[0] + bus._pose.rear[0]) / 2, (bus._pose.front[1] + bus._pose.rear[1]) / 2];
    assert.ok(dot2(face.normal, [c[0] - mid[0], c[1] - mid[1]]) > 0, `doors of the bus at ${bus.dock.id} face the stop (${face.side})`);
    seen.add(bus.dock.id);
    assert.equal(face.side, bus.dock.id.startsWith("t:") ? "left" : "right");
  }
  assert.ok(both(), [...seen].join(", "));
});

/* ------------------------------------------------------------------ loop lines */

test("loop lines: the buses go round clockwise or counter-clockwise (Ring ↻ / Ring ↺)", () => {
  const square = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]];
  assert.equal(turningNumber(square), 1, "counter-clockwise");
  assert.equal(turningNumber([...square].reverse()), -1, "clockwise");
  assert.equal(turningNumber([[0, 0], [100, 100], [100, 0], [0, 100], [0, 0]]), 0, "figure eight");
  // repeated points (e.g. where two pieces of a route meet) do not hide the corners between them
  const repeated = [[0, 0], [100, 0], [100, 0], [100, 100], [100, 100], [0, 100], [0, 100], [0, 0], [0, 0]];
  assert.equal(turningNumber(repeated), 1);
  assert.equal(turningNumber([...repeated].reverse()), -1);
  assert.ok(Object.is(turningNumber([[0, 0], [100, 0], [0, 0]]), 0), "there and back: no way round");
  assert.deepEqual([ringName(-1), ringName(1), ringName(0)], ["Ring ↻", "Ring ↺", "Ring"]);
  // east on the main street (the stops are on its right side), back on the northern street
  const block = [...STREET.slice(0, 1), { id: "n", type: "road", points: [[0, 0], [0, 1000], [4000, 1000], [4000, 0]] }, ...STREET.slice(1)];
  const w = world([...block, { id: "loop", type: "bus-line", number: "62", mode: "loop", headway_s: 120, stops: ["a", "c"] }]);
  w.transit.sync();
  const line = w.transit.lines.get("loop");
  assert.ok(line.ok, line.problems.join("; "));
  assert.equal(line.turns, 1);
  assert.deepEqual(line.directions.map((d) => [d.destination, d.loop]), [["Ring ↺", true]]);
  w.speed = 1;
  for (let i = 0; i < 1200; i++) w.step(0.25);
  assert.match(w.transit.statusFor("c:right"), /^Bus 62 Ring ↺ (in \d+ min|arriving|boarding|departing|waiting)$/);
  assert.ok(w.transit.buses.every((b) => b.destination === "Ring ↺"), "on the destination sign");
  // the other way round: the stops on the other side
  const w2 = world([...block.map((o) => (o.type === "bus-stop" ? { ...o, side: "left" } : o)),
    { id: "loop", type: "bus-line", number: "85", mode: "loop", stops: ["c", "a"] }]);
  w2.transit.sync();
  assert.equal(w2.transit.lines.get("loop").directions[0].destination, "Ring ↻");
  assert.match(w2.transit.statusFor("a:left"), /^Bus 85 Ring ↻/);
  // back and forth: "to <terminus>"
  const w3 = world([...STREET, { id: "l", type: "bus-line", number: "7", stops: ["a", "c"] }]);
  assert.match(w3.transit.statusFor("a:right"), /^Bus 7 to East/);
  assert.ok(w3.getObject("l").info().directions.every((d) => !d.loop));
});

/* ------------------------------------------------------------------ boards over the stops */

/** A flyover-like view looking at a point from a distance (mm); labels are recorded. */
function viewAt(target, distance) {
  const W = 1280, H = 720;
  const cam = new FlyCamera({ target, distance, yaw: toRad(-90), pitch: toRad(50) });
  const camera = new Camera(W, H);
  const { H: hom, focal, pose } = cam.homography(W, H);
  camera.setManualFocal(focal);
  const noop = () => {};
  const ctx = new Proxy({ canvas: { width: W, height: H }, measureText: (t) => ({ width: t.length * 6 }) }, {
    get: (o, k) => (k in o ? o[k] : typeof k === "string" && /^[a-z]/.test(k) && !/Style|Width|Alpha|font|text|line/.test(k) ? noop : undefined),
    set: (o, k, v) => ((o[k] = v), true),
  });
  const view = new View({ ctx, camera, H: hom, pose, scale: 87, virtual: true });
  const labels = [];
  view.label = (at, text, style) => labels.push({ at, lines: Array.isArray(text) ? text : [text], style });
  return { view, labels };
}

test("one board per stop; from far away only a badge with the people waiting", () => {
  const w = world([...STREET, { id: "l", type: "bus-line", number: "62", headway_s: 120, stops: ["a", "b", "c"] }]);
  const pax = w.simulations[0];
  w.speed = 1;
  for (let i = 0; i < 600; i++) w.step(0.25);
  for (let i = 0; i < 3; i++) pax.enter("b:right", { agent: { id: `p${i}` }, dockId: "b:right" });
  pax.enter("b:left", { agent: { id: "q" }, dockId: "b:left" });
  // close: one board over both sides of the street, with the next bus on each side
  const close = viewAt([2000, 0], 700);
  pax.draw(close.view);
  const centre = close.labels.filter((l) => l.lines[0].startsWith("Centre"));
  assert.equal(centre.length, 1, "one board for both sides");
  const [title, ...status] = centre[0].lines;
  assert.equal(title, "Centre · 4 people · 85 %".replace("85", title.match(/(\d+) %/)[1]));
  assert.equal(status.length, 2, status.join(" | "));
  assert.ok(status.some((s) => /^Bus 62 to East/.test(s)) && status.some((s) => /^Bus 62 to West/.test(s)), status.join(" | "));
  assert.equal(centre[0].style.badge, "H");
  // the stop's board stands between both sides (above the street)
  assert.ok(Math.abs(centre[0].at[1]) < 5 && Math.abs(centre[0].at[0] - 2000) < 5, `at ${centre[0].at}`);
  // far away: small badges ("H" and the number of people), no long boards
  const far = viewAt([2000, 0], 9000);
  pax.draw(far.view);
  const badges = far.labels.filter((l) => l.style.badge === "H");
  assert.equal(badges.length, 3, "one badge per stop");
  assert.ok(badges.every((l) => l.lines.length === 1 && /^\d+$/.test(l.lines[0])), badges.map((l) => l.lines.join("/")).join(", "));
  assert.ok(badges.some((l) => l.lines[0] === "4"));
  assert.ok(BOARD_MIN_PX >= 25);
});

test("a disruption at a stop on both sides of the street has one warning label, like the stop has one board", () => {
  const w = world(STREET);
  w.disruptions.start({ type: "closure", target: "b", params: { minutes: 10 } });
  const close = viewAt([2000, 0], 700);
  w.disruptions.draw(close.view);
  const warnings = close.labels.filter((l) => l.style?.badge === "!");
  assert.deepEqual(warnings.map((l) => l.lines), [["Closed (10 min left)"]]);
  // one side only (a disruption of one stop area): its label
  w.disruptions.reset();
  w.disruptions.start({ type: "delay", target: "b:left", params: { minutes: 5 } });
  const one = viewAt([2000, 0], 700);
  w.disruptions.draw(one.view);
  assert.deepEqual(one.labels.filter((l) => l.style?.badge === "!").map((l) => l.lines), [["Delay (5 min left)"]]);
});

test("the board of a bus terminal shows the next bus of every line that starts there; timetable buses say Bus", () => {
  // two lines lay over in their own bays, the third bay keeps the terminal's timetable buses ("305")
  const w = world([
    { id: "main", type: "road", points: [[-500, 0], [5000, 0]] },
    { id: "t", type: "bus-terminal", name: "Station", position: [700, -150], bays: 3, lines: "305" },
    { id: "e", type: "bus-stop", name: "East", position: [3000, -70], side: "both" },
    { id: "f", type: "bus-stop", name: "Far", position: [4500, -70], side: "both" },
    { id: "l1", type: "bus-line", number: "1", headway_s: 300, stops: ["t", "e"] },
    { id: "l2", type: "bus-line", number: "2", headway_s: 300, stops: ["t", "f"] },
  ]);
  const pax = w.simulations[0];
  const area = w.stopAreas().find((a) => a.owner.id === "t");
  const board = () => {
    const { view, labels } = viewAt([700, -150], 700);
    pax.draw(view);
    return labels.find((l) => l.lines[0].startsWith("Station"));
  };
  const seen = new Set(), timetable = new Set();
  w.speed = 1;
  for (let i = 0; i < 4800; i++) {
    w.step(0.25);
    if (i % 8) continue;
    const b = board();
    assert.ok(b, "a board over the terminal");
    for (const s of b.lines.slice(1)) seen.add(s.replace(/ (in \d+ min|arriving|waiting|boarding|departing)$/, ""));
    const busy = w.services.forArea(area.id).some((st) => st.vehicle);
    if (busy) timetable.add(dockStatus(w, area));
  }
  // both lines on the board (the board used to show only the first bay's line)
  assert.ok(seen.has("Bus 1 to East") && seen.has("Bus 2 to Far"), [...seen].join(" | "));
  // the timetable buses of the third bay: "Bus 305 boarding", like the buses of the lines
  assert.ok(timetable.size > 0, "a timetable bus came");
  for (const s of timetable) assert.match(s, /^Bus 305 (arriving|boarding|departing)$/);
});

/* ------------------------------------------------------------------ streets */

test("overlapping streets are filled together: no darker patch where they cross", () => {
  const w = world([
    { id: "ew", type: "road", points: [[0, 0], [2000, 0]] },
    { id: "ns", type: "road", kind: "main", points: [[1000, -800], [1000, 800]] },
  ], { simulations: [] });
  const { view } = viewAt([1000, 0], 2500);
  const asphalt = [];
  const ground = view.ground.bind(view);
  view.ground = (order, draw) => {
    if (order === 1.1) asphalt.push(draw);
    ground(order, draw);
  };
  for (const o of w.objects) o.draw(view);
  assert.equal(asphalt.length, 1, "the carriageways of both streets in one fill");
});

/* ------------------------------------------------------------------ commuters by bus */

test("town: commuters take the bus to the station when it is far, and home again", () => {
  // the homes are far from the platform (about 390 m); a bus line runs from the station's bus
  // terminal next to the platform to a stop near the homes
  const w = townWorld([
    { id: "p1", type: "platform", from: [0, 0], to: [800, 0], width_mm: 60, sides: "both" },
    { id: "main", type: "road", points: [[-200, -300], [5000, -300]] },
    { id: "t", type: "bus-terminal", name: "Station", position: [400, -150], bays: 2 },
    { id: "far", type: "bus-stop", name: "Siedlung", position: [4500, -370], side: "both" },
    { id: "home", type: "test-box", position: [4500, -480], use: "residential", people: 300 },
    { id: "l", type: "bus-line", number: "62", headway_s: 120, stops: ["t", "far"] },
  ], { clock: { start: "05:00" } });
  const town = w.simulations.find((s) => s.constructor.type === "town");
  const line = w.getObject("l").info();
  assert.ok(line.ok, line.problems.join("; "));
  const byBus = new Set(), trainAfterBus = new Set(), homeByBus = new Set();
  w.events.on("passenger.boarded", (e) => {
    const a = e.agent;
    if (!town.agents.includes(a)) return;
    if (e.vehicle?.source === "line" && a.trip?.station) byBus.add(a);
    else if (e.vehicle?.source === "line" && a.trip?.legs[0]?.type === "train-off") homeByBus.add(a);
    else if (e.vehicle?.kind === "train" && byBus.has(a)) trainAfterBus.add(a);
  });
  w.speed = 10;
  while (w.clock.minutes < 9 * 60) w.step(0.1);
  const commuters = town.agents.filter((a) => a.role === "commuter");
  assert.ok(commuters.length >= 5, `${commuters.length} commuters`);
  assert.ok(byBus.size >= 3, `${byBus.size} took the bus to the station`);
  assert.ok(trainAfterBus.size >= byBus.size * 0.7, `${trainAfterBus.size} of them then took a train`);
  assert.ok([...trainAfterBus].every((a) => a.state === "away"));
  // in the evening they come back by train and take the bus home
  while (w.clock.minutes < 20 * 60) w.step(0.1);
  assert.ok(homeByBus.size >= 3, `${homeByBus.size} took the bus home from the train`);
  assert.ok([...homeByBus].filter((a) => a.state === "inside" && a.inside === "home").length >= homeByBus.size * 0.7, "and are home");
  assert.equal(town.agents.filter((a) => a.state === "riding").length, 0);
});
