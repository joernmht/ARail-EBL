// The market square with its stalls, Christmas tree and rides (objects/market.js), and its visitors
// (sims/market.js): the lab example's modules Striezelmarkt and Market visitors.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  Camera, MARKET_GOODS, Ride, View, composeLayout, createWorld, marketOpen, pointInPolygon, registry, validateLayout, withLayers,
} from "../../web/arail/index.js";
import registerWindmill from "../../web/plugins/windmill.js";
import { ROOT } from "./helpers.js";

registerWindmill({ ...await import("../../web/arail/index.js") });

const LAB = JSON.parse(readFileSync(join(ROOT, "web/layouts/ebl-lab.json"), "utf8"));
const MARKET = ["striezelmarkt", "market-visitors"];
const marketOf = (world) => world.simulations.find((s) => s.constructor.type === "market");

/** The lab with these modules on, at a time of day. */
function lab(layers = MARKET, time = null) {
  const world = createWorld(withLayers(LAB, layers));
  if (time) world.setTime(time);
  return world;
}

/** Run a world for some simulated seconds. */
function run(world, seconds, dt = 0.1) {
  for (let t = 0; t < seconds; t += dt) world.step(dt);
}

/** Homography of a pinhole camera at `eye` looking at `target` (layout mm). */
function lookAt(camera, eye, target) {
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const norm = (a) => a.map((v) => v / Math.hypot(...a));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const f = norm(sub(target, eye)), r = norm(cross(f, [0, 0, 1])), d = cross(f, r);
  const R = [r, d, f];
  const t = R.map((row) => -(row[0] * eye[0] + row[1] * eye[1] + row[2] * eye[2]));
  const { fx, fy, cx, cy } = camera.intrinsics;
  const K3 = (c) => [fx * c[0] + cx * c[2], fy * c[1] + cy * c[2], c[2]];
  const c0 = K3([R[0][0], R[1][0], R[2][0]]), c1 = K3([R[0][1], R[1][1], R[2][1]]), c2 = K3(t);
  return [c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]];
}

/** Draw a world through a fake canvas; the fill colours, and whether lights glowed. Fails on non-finite coordinates. */
function draw(world, night = null) {
  const fills = [];
  let glows = 0;
  const noop = () => {};
  const finite = (x, y) => assert.ok(Number.isFinite(x) && Number.isFinite(y), "finite coordinates");
  const ctx = {
    canvas: { width: 1600, height: 900 }, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, globalAlpha: 1,
    save: noop, restore: noop, setTransform: noop, fillRect: noop, beginPath: noop, closePath: noop, stroke: noop, setLineDash: noop,
    arc: noop, ellipse: noop, quadraticCurveTo: noop, arcTo: noop, clip: noop, fillText: noop, drawImage: noop,
    moveTo: finite, lineTo: finite, fill() { fills.push(this.fillStyle); }, measureText: (t) => ({ width: t.length * 6 }),
    createRadialGradient: () => (glows++, { addColorStop: noop }),
  };
  const camera = new Camera(1600, 900);
  const view = new View({ ctx, camera, H: lookAt(camera, [-560, -1900, 900], [-560, -780, 0]), scale: world.scale, night });
  world.draw(view);
  return { fills, glows };
}

test("the lab's market: the square is in the base, the Striezelmarkt and its visitors are modules", () => {
  assert.deepEqual(validateLayout(withLayers(LAB, MARKET), registry), []);
  const base = lab([]);
  const square = base.getObject("market-square");
  assert.ok(square?.geometry, "the Marktplatz is always there");
  assert.ok(!base.getObject("christmas-tree") && !marketOf(base));
  assert.ok(square.entrances().length >= 3, "gates where streets meet the square");
  for (const g of square.entrances()) assert.ok(Math.abs(Math.hypot(...g.dir) - 1) < 1e-9);
  const world = lab();
  const sq = world.getObject("market-square");
  const things = sq.contents();
  for (const type of ["christmas-tree", "ferris-wheel", "carousel", "mini-train"]) assert.equal(things.filter((o) => o.type === type).length, 1, type);
  const stalls = things.filter((o) => o.type === "market-stall");
  assert.ok(stalls.length >= 20, `${stalls.length} stalls`);
  // every kind of goods is sold, Glühwein at several stalls, the Pilze from a steam locomotive
  const goods = stalls.map((o) => o.spec.goods);
  for (const id of Object.keys(MARKET_GOODS)) assert.ok(goods.includes(id), `nobody sells ${id}`);
  assert.ok(goods.filter((g) => g === "gluehwein").length >= 4, "lots of Glühwein");
  assert.ok(stalls.some((o) => o.spec.goods === "pilze" && o.spec.style === "locomotive"));
  // nothing overlaps: stalls, rides and the tree stand apart
  for (const a of things) {
    for (const b of things) {
      if (a === b) continue;
      assert.ok(!pointInPolygon(a.anchorPoint(), b.footprint()), `${a.id} stands in ${b.id}`);
    }
  }
});

test("stalls, the tree and the rides: what the market simulation needs, cards, day and night", () => {
  const world = lab(MARKET, "13:00");
  const glueh = world.getObject("stall-1"), loco = world.getObject("stall-14");
  const info = glueh.marketInfo();
  assert.equal(info.kind, "stall");
  assert.equal(info.goods, "gluehwein");
  assert.equal(info.tables.length, 2, "drinks get standing tables");
  assert.equal(world.getObject("stall-7").marketInfo().tables.length, 0, "crafts do not");
  assert.ok(Math.abs(Math.hypot(...info.out) - 1) < 1e-9);
  assert.ok(!pointInPolygon(info.counter, glueh.footprint()), "people queue in front of the counter");
  const card = loco.card();
  assert.ok(card.rows.some(([k, v]) => k === "Sells" && v === "Pilze"));
  assert.ok(card.rows.some(([k, v]) => k === "Built like" && v === "a steam locomotive"));
  assert.equal(world.getObject("christmas-tree").marketInfo().kind, "sight");
  for (const id of ["ferris-wheel", "carousel", "mini-train"]) {
    const r = world.getObject(id);
    assert.ok(r instanceof Ride && r.marketInfo().kind === "ride" && r.places() > 0, id);
    assert.ok(!pointInPolygon(r.marketInfo().gate, r.footprint()), `${id}: the gate is outside`);
  }
  assert.ok(marketOpen(world));
  // by day: drawn without errors; at night the lights glow
  const day = draw(world, 0);
  const night = draw(world, 1);
  assert.ok(day.fills.length > 500);
  assert.ok(night.glows > day.glows + 50, `${night.glows} lights at night, ${day.glows} by day`);
});

test("a ride boards, runs and lets its riders off; it runs without riders too", () => {
  const world = lab(["striezelmarkt"], "13:00");
  const wheel = world.getObject("ferris-wheel");
  const a = { id: "a" }, b = { id: "b" };
  assert.ok(wheel.canBoard());
  assert.ok(wheel.board(a) && wheel.board(b));
  assert.deepEqual(wheel.takeAlighted(), []);
  const board = wheel.spec.board_s ?? 60, ride = wheel.runSeconds();
  wheel.update(board + 0.1);
  assert.equal(wheel.ride.phase, "running");
  assert.ok(!wheel.canBoard() && !wheel.board({ id: "c" }), "nobody gets on while it runs");
  wheel.update(ride + 0.1);
  assert.equal(wheel.ride.phase, "boarding");
  assert.deepEqual(wheel.takeAlighted(), [a, b]);
  assert.deepEqual(wheel.takeAlighted(), [], "each once");
  assert.equal(wheel.ride.carried, 2);
  // empty, it waits twice as long, then turns anyway
  wheel.update(board + 1);
  assert.equal(wheel.ride.phase, "boarding");
  wheel.update(board);
  assert.equal(wheel.ride.phase, "running");
  // the mini train runs whole laps
  const train = world.getObject("mini-train");
  const lap = train.meters(train.geometry.length) / (6 / 3.6);
  assert.ok(Math.abs(train.runSeconds() / lap - Math.round(train.runSeconds() / lap)) < 1e-9);
});

test("visitors: they come, queue, buy (lots of Glühwein), stay at the tables, ride and go home, some by train", () => {
  const world = lab(MARKET, "17:00");
  const market = marketOf(world);
  assert.ok(market.visitors.length > 100, "setting the clock fills the market");
  run(world, 400);
  const st = market.marketStats();
  assert.ok(st.open);
  assert.ok(st.market > 100, `${st.market} on the square`);
  const sold = Object.values(st.sold).reduce((a, b) => a + b, 0);
  assert.ok(sold > 200, `${sold} sold`);
  const top = Object.entries(st.sold).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(top, "gluehwein", "Glühwein sells best");
  assert.ok(st.rides > 5, "people ride");
  assert.ok(st.came.train > 10 && st.came.home > 10 && st.came.street > 10, JSON.stringify(st.came));
  assert.ok(market.today.left.train > 0 || market.visitors.some((v) => v.state === "station"), "some go back to the station");
  // nobody walks through a stall or a ride; people on the square stay on it
  const venue = market.venues()[0], square = world.getObject("market-square");
  const blocks = venue.stalls.concat(venue.rides).map((o) => o.footprint());
  for (const v of market.visitors.filter((x) => x.state === "market")) {
    assert.ok(pointInPolygon(v.pos, square.geometry.points), `${v.name} is off the square`);
    for (const f of blocks) assert.ok(!pointInPolygon(v.pos, f), `${v.name} is inside a stall or ride`);
  }
  // queues stay short of the limit, and the stalls' cards say so
  const card = world.getObject("stall-1").card();
  market.describeObject(world.getObject("stall-1"), card);
  assert.ok(card.rows.some(([k]) => k === "Queue now") && card.rows.some(([k]) => k === "Takings today"));
  const groups = market.states();
  assert.deepEqual(groups.map((g) => g.id), ["market-stalls", "market-visitors"]);
  for (const g of groups) for (const it of g.items) assert.ok(it.score >= 0 && it.score <= 1);
  // a visitor's card
  const v = market.visitors.find((x) => x.state === "market");
  const c = market.describeAgent(v);
  assert.equal(c.title, v.name);
  assert.match(v.name, /^\S\. \S/, "a bird name: initial and family name");
  assert.ok(c.status && c.rows.some(([k]) => k === "From"));
  // in the streets they walk on the sidewalks, are seen and can be pointed at
  const walking = market.visitors.filter((x) => x.state === "coming" || x.state === "going");
  assert.ok(walking.length > 0);
  for (const x of walking) assert.ok(Array.isArray(x.pos) && x.pos.every(Number.isFinite), `${x.name} at ${JSON.stringify(x.pos)}`);
  // the stalls and the visitors are drawn
  assert.ok(draw(world, 0.8).fills.length > 1000);
});

test("the same seed gives the same market", () => {
  const counts = [0, 1].map(() => {
    const world = lab(MARKET, "18:00");
    run(world, 120);
    const st = marketOf(world).marketStats();
    return [st.total, st.sold.gluehwein, st.takings, st.rides];
  });
  assert.deepEqual(counts[0], counts[1]);
});

test("closing time: nobody comes, everybody goes; closed, the market is empty", () => {
  const world = lab(MARKET, "21:40");
  const market = marketOf(world);
  assert.equal(market.target(), 0, "no one comes in the last half hour");
  assert.ok(market.visitors.length > 100, "at 21:40 the market is still full");
  run(world, 900);
  assert.ok(!market.isOpen(), world.clock.label());
  assert.equal(market.visitors.filter((v) => ["market", "riding", "coming"].includes(v.state)).length, 0);
  // closed at night: none come
  const night = lab(MARKET, "03:00");
  run(night, 60);
  assert.equal(marketOf(night).visitors.length, 0);
});

test("clear() takes everybody off; a market without a square does nothing", () => {
  const world = lab(MARKET, "18:30");
  run(world, 60);
  const market = marketOf(world);
  assert.ok(market.visitors.length > 0);
  market.clear();
  assert.equal(market.visitors.length, 0);
  for (const id of ["ferris-wheel", "carousel", "mini-train"]) assert.equal(world.getObject(id).ride.riders.length, 0);
  // the stalls without their square
  const json = withLayers(LAB, MARKET);
  json.objects = json.objects.filter((o) => o.id !== "market-square");
  const bare = createWorld(json);
  bare.setTime("18:00");
  run(bare, 30);
  assert.equal(marketOf(bare).visitors.length, 0);
  assert.deepEqual(marketOf(bare).venues(), []);
});

test("scenarios set the time of day; the Striezelmarkt's evening", () => {
  const world = lab(MARKET);
  assert.ok(world.scenarios.scenarios.some((s) => s.id === "striezelmarkt-evening"));
  world.scenarios.play("striezelmarkt-evening");
  world.step(0.1);
  assert.equal(world.clock.label().slice(0, 4), "19:4");
  assert.ok(marketOf(world).visitors.length > 100, "the clock was set: the market is full");
  const { layout } = composeLayout(withLayers(LAB, ["striezelmarkt"]));
  assert.ok(layout.scenarios.some((s) => s.id === "striezelmarkt-evening") && !layout.scenarios.some((s) => s.id === "market-closing"));
});
