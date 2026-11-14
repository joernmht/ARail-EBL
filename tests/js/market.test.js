// The market square with its stalls, signs, gates, Christmas tree and rides (objects/market.js), and its visitors
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

/** Draw a world through a fake canvas: the fill colours, the lights that glowed, the texts painted (signs). Fails on non-finite coordinates. */
function draw(world, night = null) {
  const fills = [], texts = [];
  let glows = 0;
  const noop = () => {};
  const finite = (x, y) => assert.ok(Number.isFinite(x) && Number.isFinite(y), "finite coordinates");
  const ctx = {
    canvas: { width: 1600, height: 900 }, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, globalAlpha: 1,
    save: noop, restore: noop, setTransform: noop, fillRect: noop, beginPath: noop, closePath: noop, stroke: noop, setLineDash: noop,
    arc: noop, ellipse: noop, quadraticCurveTo: noop, arcTo: noop, clip: noop, drawImage: noop, transform: noop, strokeRect: noop,
    fillText(t) { texts.push(t); },
    moveTo: finite, lineTo: finite, fill() { fills.push(this.fillStyle); }, measureText: (t) => ({ width: t.length * 6 }),
    createRadialGradient: () => (glows++, { addColorStop: noop }),
  };
  const camera = new Camera(1600, 900);
  const view = new View({ ctx, camera, H: lookAt(camera, [-560, -1900, 900], [-560, -780, 0]), scale: world.scale, night });
  world.draw(view);
  return { fills, glows, texts };
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
  // the signs: the goods on the stalls' boards, the market's name on its gates
  for (const t of ["Glühwein", "Handbrot", "Strickwaren", "Striezelmarkt"]) assert.ok(day.texts.includes(t), `no sign "${t}" in ${day.texts.join(", ")}`);
  assert.ok(!day.texts.includes("Kakao"), "a sign turned away from the camera is not painted (the Kakao stall faces the tree)");
  const gate = world.getObject("market-gate");
  assert.equal(gate.spec.text, "Striezelmarkt");
  assert.ok(!world.getObject("market-square").contents().includes(gate), "a gate is no obstacle: people walk through it");
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
  // 6 December, a quarter to four, in snow: dusk at four
  assert.equal(world.clock.label().slice(0, 4), "15:4");
  assert.equal(world.clock.dateLabel(), "6 Dec");
  assert.equal(world.weather.now().sky, "snow");
  assert.ok(world.clock.sun().set < 16 * 60 + 5, "the sun sets at about four");
  assert.ok(marketOf(world).visitors.length > 100, "the clock was set: the market is full");
  const { layout } = composeLayout(withLayers(LAB, ["striezelmarkt"]));
  assert.ok(layout.scenarios.some((s) => s.id === "striezelmarkt-evening") && !layout.scenarios.some((s) => s.id === "market-closing"));
});

test("editing the layout while the market runs: queues and tables stay consistent, the stalls keep serving", () => {
  const world = lab(MARKET, "18:00");
  const market = marketOf(world);
  run(world, 60);
  // moving something (Build), or a new photo: the squares are made anew
  world.objectChanged(world.getObject("tree-1"));
  run(world, 0.2);
  const before = Object.values(market.marketStats().sold).reduce((a, b) => a + b, 0);
  run(world, 90);
  const after = Object.values(market.marketStats().sold).reduce((a, b) => a + b, 0);
  assert.ok(after > before + 30, `${after - before} sold after the change`);
  // everybody in a queue is there once, wants that stall, and is still at the market
  const seen = new Set();
  for (const [id, s] of market.stalls) {
    for (const v of s.queue) {
      assert.ok(market.visitors.includes(v), `${v.name} left but is in the queue of ${id}`);
      assert.equal(v.task?.type, "queue", `${v.name} in the queue of ${id} does something else`);
      assert.equal(v.task.stall, id);
      assert.ok(!seen.has(v), `${v.name} is in two queues`);
      seen.add(v);
    }
  }
  for (const [key, holders] of market.tables) for (const v of holders) assert.equal(v.table, key, `${v.name} holds a place at ${key}`);
});

test("a full queue sends people to the next best stall; at midnight the stalls' figures start again", () => {
  const world = lab(MARKET, "18:00");
  const market = marketOf(world);
  run(world, 30);
  const venue = market.venues()[0];
  const drinks = venue.stalls.filter((o) => MARKET_GOODS[o.spec.goods].kind === "drink");
  const free = drinks.find((o) => o.spec.goods === "punsch");
  for (const o of drinks) if (o !== free) market._stall(o.id).queue.push(...Array.from({ length: 12 }, () => ({})));
  const v = market.visitors.find((x) => x.state === "market" && x.profile.age !== "child");
  market._leaveQueues(v);
  v.plan = ["drink"];
  const task = market._nextTask(v, venue);
  assert.deepEqual(task, { type: "queue", stall: free.id }, "the one stall of the kind with room");
  market.clear();
  // midnight
  run(world, 30);
  const sold = () => [...market.stalls.values()].reduce((a, s) => a + s.sold, 0);
  market._stall("stall-1").sold += 3;
  assert.ok(sold() > 0);
  world.events.emit("clock.day", { day: 1 });
  assert.equal(sold(), 0);
  assert.ok([...market.stalls.values()].every((s) => s.takings === 0 && s.waits.length === 0));
  assert.deepEqual(market.today.sold, {});
});

test("setting the clock fills the market once: the first step keeps those people", () => {
  const world = lab(MARKET, "19:00");
  const market = marketOf(world);
  const ids = market.visitors.map((v) => v.id);
  assert.ok(ids.length > 100);
  world.step(0.1);
  for (const id of ids.slice(0, 20)) assert.ok(market.visitors.some((v) => v.id === id), `${id} was replaced`);
});

test("a ride removed while it runs: its riders are back on the square and go home at closing time", () => {
  const world = lab(MARKET, "21:20");
  const market = marketOf(world);
  const wheel = world.getObject("ferris-wheel");
  for (let i = 0; i < 1200 && wheel.ride.phase !== "running"; i++) world.step(0.1);
  const riders = market.visitors.filter((v) => v.state === "riding" && v.ride === "ferris-wheel");
  assert.equal(wheel.ride.phase, "running");
  assert.ok(riders.length > 0, "people on the ferris wheel");
  world.removeObject("ferris-wheel");
  run(world, 0.2);
  for (const v of riders) if (market.visitors.includes(v)) assert.notEqual(v.state, "riding", `${v.name} is still on a ride that is gone`);
  run(world, 30);
  while (world.clock.minutes < 23 * 60 + 15) world.step(0.1); // closed at 22:00, the last rides over; not yet midnight, when the day's figures start again
  assert.ok(!market.isOpen());
  assert.equal(market.visitors.filter((v) => v.state === "riding" || v.state === "market").length, 0, "everybody has left the square");
  // every visitor who came has left, or is still on the way
  const st = market.marketStats();
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  assert.equal(sum(st.came), sum(st.left) + market.visitors.length, `came ${JSON.stringify(st.came)}, left ${JSON.stringify(st.left)}, here ${market.visitors.length}`);
});

test("a scenario's time that is no time of day: the step fails and says so, the clock and the people stay; the layout check finds it", () => {
  const world = lab(MARKET, "18:00");
  const market = marketOf(world);
  run(world, 5);
  const ids = market.visitors.map((v) => v.id), minutes = world.clock.minutes;
  assert.equal(world.setTime("7:45 pm"), null);
  assert.equal(world.clock.minutes, minutes);
  const messages = [];
  world.events.on("scenario.message", ({ text }) => messages.push(text));
  world.scenarios.load([{ id: "bad", steps: [{ at: 0, set: { time: "19.45" } }] }]);
  world.scenarios.play("bad");
  world.step(0.1);
  assert.ok(Math.abs(world.clock.minutes - minutes) < 1, "the clock did not jump");
  assert.ok(messages.some((m) => /19\.45/.test(m) && /no time of day/.test(m)), messages.join(" | "));
  assert.ok(ids.slice(0, 20).every((id) => market.visitors.some((v) => v.id === id)), "nobody was put anew");
  const json = withLayers(LAB, []);
  json.scenarios = [...json.scenarios, { id: "bad", steps: [{ at: 0, set: { time: "7:45 pm" } }] }];
  assert.ok(validateLayout(json, registry).some((p) => /set\.time "7:45 pm" is no time of day/.test(p)));
});

test("the flow fields a square keeps stay few; opening hours that are no time of day are reported", () => {
  const world = lab(MARKET, "18:00");
  const market = marketOf(world);
  const venue = market.venues()[0];
  for (let i = 0; i < 400; i++) venue.field(venue.randomPoint(market.rng));
  assert.ok(venue.fields.size <= 160, `${venue.fields.size} fields`);
  const p = venue.randomPoint(market.rng);
  assert.equal(venue.field(p), venue.field([p[0] + 0.01, p[1]]), "the same cell, the same field");
  run(world, 30);
  assert.ok(Object.values(market.marketStats().sold).length > 0, "people still find their way");
  const json = withLayers(LAB, MARKET);
  json.layers.find((l) => l.id === "market-visitors").simulations[0].close = "23.30";
  assert.ok(validateLayout(json, registry).some((x) => /\(market\): close "23\.30" is no time of day/.test(x)), validateLayout(json, registry).join("\n"));
});
