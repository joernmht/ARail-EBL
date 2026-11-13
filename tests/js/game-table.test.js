// The signaller's game on the table (web/game/table.js): the station on the layout of Bf Neustadt,
// where a train of the game is, what the board draws and takes clicks for, and how it tells the
// world's services that a train stands at a platform.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Camera, FlyCamera, View, createWorld, orthoOf, polylineAt } from "../../web/arail/index.js";
import { STATION, SignallerGame } from "../../web/arail/game/signaller.js";
import { CROSSING, HIT_PX, TABLE, TABLE_LAYOUT, TABLE_TRAIN, TableBoard, TableStation, tableProblems } from "../../web/game/table.js";

const NEUSTADT = JSON.parse(readFileSync(new URL(`../../web/${TABLE_LAYOUT}`, import.meta.url), "utf8"));
const W = 1280, H = 800, MM = 1000 / 87;

/** A canvas context that draws nothing and counts what is filled and written. */
function countingContext() {
  const counts = { fill: 0, stroke: 0, text: [] };
  return new Proxy({ canvas: { width: W, height: H }, counts }, {
    get(t, key) {
      if (key in t) return t[key];
      if (key === "fill" || key === "stroke") return () => counts[key]++;
      if (key === "fillText") return (s) => counts.text.push(String(s));
      if (key === "measureText") return (s) => ({ width: 6 * String(s).length });
      if (key === "createRadialGradient" || key === "createLinearGradient") return () => ({ addColorStop() {} });
      if (key === "getLineDash") return () => [];
      return () => {};
    },
    set(t, key, value) {
      t[key] = value;
      return true;
    },
  });
}

/** A view of the table from the windows, as the play page shows it: of a part of the station. */
function viewOf(world, bounds, ctx = countingContext()) {
  const cam = new FlyCamera({ yaw: (270 * Math.PI) / 180, pitch: (48 * Math.PI) / 180 }).fit(bounds, W / H, 0.03);
  const pose = cam.homography(W, H), camera = new Camera(W, H);
  camera.setManualFocal(pose.focal);
  return new View({ ctx, camera, H: pose.H, pose: pose.pose, scale: world.scale, time: world.time, virtual: true, pulse: 1 });
}

/** A shift played by the computer up to a time (s), in steps of a second. */
function playTo(g, until, each = null) {
  const player = new SignallerGame.player();
  while (g.t < until && !g.over) {
    player.think(g);
    g.step(1);
    each?.();
  }
  return g;
}

test("the table: every section of the station has its way on the layout, and the ways of every route meet", () => {
  assert.deepEqual(tableProblems(), []);
  assert.deepEqual(Object.keys(TABLE.sections).sort(), Object.keys(STATION.sections).sort());
  const ortho = orthoOf(NEUSTADT).bounds_mm;
  for (const [id, ways] of Object.entries(TABLE.sections)) {
    assert.equal(!!ways["-"], Object.values(STATION.points).some((p) => p.section === id), `${id}: a diverging way exactly where it has a point`);
    for (const pts of Object.values(ways)) {
      // from the Bergheim end of the table (+x) to the Talsee end, on the table's photo
      for (let i = 1; i < pts.length; i++) assert.ok(pts[i][0] < pts[i - 1][0], `${id}: x falls along the way`);
      for (const [x, y] of pts) assert.ok(x > ortho[0] && x < ortho[2] && y > ortho[1] && y < ortho[3], `${id}: on the photo of the table`);
    }
  }
  // what is wrong is named
  assert.match(tableProblems({ ...TABLE, sections: { ...TABLE.sections, g2: {} } })[0], /Section g2 has no way/);
  assert.match(tableProblems({ ...TABLE, sections: { ...TABLE.sections, w1: { "+": TABLE.sections.w1["+"] } } })[0], /w1 has a point, but no way for its diverging position/);
  const apart = tableProblems({ ...TABLE, sections: { ...TABLE.sections, g3: { "+": TABLE.sections.g3["+"].map(([x, y]) => [x, y - 60]) } } });
  assert.ok(apart.some((p) => /Route A-G3: w3 and g3 do not meet \(60 mm apart\)/.test(p)), apart.join(" "));
});

test("the table: the platform tracks set the scale; signals stand at the ends of their sections, on the right of their trains", () => {
  const t = new TableStation();
  assert.ok(Math.abs(t.k - 3.65) < 0.05, `${t.k} mm of table per metre of the game`);
  // the three platform tracks lie beside the two platforms of the layout
  for (const [track, platform] of [["G1", "platform-1"], ["G2", "platform-2"], ["G3", "platform-2"]]) {
    const p = NEUSTADT.objects.find((o) => o.id === platform), mid = t.trackMiddle(track);
    assert.ok(mid[0] > p.from[0] && mid[0] < p.to[0], `${track} along ${platform}`);
    assert.ok(Math.abs(mid[1] - (p.from[1] + p.to[1]) / 2) < 110, `${track} beside ${platform}`);
  }
  for (const [id, sig] of Object.entries(STATION.signals)) {
    const s = t.signal(id), w = t.way(sig.section, "+", sig.dir);
    assert.deepEqual(s.foot, w.points.at(-1), `${id} at the end of ${sig.section}`);
    // the game's east is the layout's −x: a train to Talsee has the windows (+y) on its right
    assert.ok(sig.dir > 0 ? s.at[1] > s.foot[1] : s.at[1] < s.foot[1], `${id} on the right of its trains`);
    assert.ok(Math.abs(Math.hypot(s.at[0] - s.foot[0], s.at[1] - s.foot[1]) - TABLE.signal_mm) < 1e-6);
  }
  // a way against the direction to Talsee is the same way, reversed
  assert.deepEqual(t.way("g2", "+", -1).points, [...t.way("g2", "+", 1).points].reverse());
  assert.equal(t.way("g2", "-", 1), t.way("g2", "-", 1), "kept");
});

test("the table: a train moves along its way without a step back or a jump, and is on the table only near the station", () => {
  const t = new TableStation(), g = new SignallerGame({ seed: 3, level: "training" }), last = new Map(), seen = new Set();
  playTo(g, 2400, () => {
    for (const tr of g.trains) {
      if (tr.state !== "running" && tr.state !== "dwelling") continue;
      const place = t.place(tr, MM), before = last.get(tr.id);
      assert.ok(Number.isFinite(place.head), `${tr.id} at ${g.t}`);
      if (before != null) assert.ok(place.head - before > -0.01 && place.head - before < 900, `${tr.id} at ${g.t}: ${before} → ${place.head}`);
      last.set(tr.id, place.head);
      if (place.on) seen.add(tr.id);
      // still beyond the table on the open line, and gone from it before it leaves the game
      if (tr.path.length === 1 && tr.head < 1000) assert.equal(place.on, false, `${tr.id} is far out on the line`);
      // standing at a platform it is where the game says: 40 m before the end of its track
      if (tr.state === "dwelling") {
        const at = polylineAt(place.line.points, place.head, place.line.lengths).point, end = t.signal(tr.dir > 0 ? `N${tr.track[1]}` : `P${tr.track[1]}`).foot;
        assert.ok(Math.abs(Math.hypot(at[0] - end[0], at[1] - end[1]) - 40 * t.k) < 4, `${tr.id} stands 40 m before its exit signal`);
      }
    }
  });
  assert.ok(g.over && g.trains.every((tr) => tr.state === "gone"));
  assert.equal(seen.size, g.trains.length, "every train was on the table");
});

test("the table: the cars of a train are together as long as the train is on the table", () => {
  const t = new TableStation(), g = new SignallerGame({ level: "hard" });
  for (const tr of g.trains) {
    const cars = t.cars(tr, MM), length = cars.reduce((n, c, i) => n + c.length_m + (i < cars.length - 1 ? c.gap_m : 0), 0);
    assert.ok(Math.abs(length * MM - tr.length * t.k) < 2, `${tr.id}: ${length * MM} mm for ${tr.length} m`);
    assert.equal(cars[0].kind, { RB: "railcar", IC: "locomotive", GZ: "locomotive" }[tr.kind]);
    assert.equal(cars.some((c) => c.doors.length), tr.kind !== "GZ", `${tr.id}: doors where people travel`);
    assert.equal(cars.at(-1).gap_m, 0);
  }
});

test("the board: it is a simulation of the layout's world, and the station's platform tracks are its own", () => {
  const world = createWorld(NEUSTADT, { seed: 1 }), sims = world.simulations.length;
  world.step(0.05);
  const board = new TableBoard(world);
  assert.equal(world.simulations.at(-1), board);
  assert.equal(world.services.planner, board);
  assert.equal(world.registry.vehicles.get(TABLE_TRAIN.kind), TABLE_TRAIN);
  const rail = [...world.services.docks.values()].filter((st) => st.dock.kind === "rail");
  for (const track of ["G1", "G2", "G3"]) assert.equal(board.dockOf(track)?.track, track);
  for (const st of rail) assert.equal(st.mode === "plan", ["G1", "G2", "G3"].includes(String(st.dock.track)), `${st.dock.id}: ${st.mode}`);
  // without a game it draws nothing and nothing can be chosen
  const ctx = countingContext(), view = viewOf(world, board.bounds("all"), ctx);
  board.draw(view);
  assert.equal(view.items.length, 0);
  assert.equal(board.hit(view, [W / 2, H / 2]), null);
  board.dispose();
  assert.equal(world.simulations.length, sims);
  assert.equal(world.services.planner, null);
  assert.ok(rail.every((st) => st.mode !== "plan"));
});

test("the board: a train that stands at a platform is there for the world's people, with its doors along the platform", () => {
  const world = createWorld(NEUSTADT, { seed: 1 });
  world.step(0.05);
  const board = new TableBoard(world), g = new SignallerGame({ seed: 3, level: "training" });
  board.show(g);
  let stood = 0;
  const events = [];
  world.events.on("vehicle.arrived", (e) => events.push(["arrived", e.vehicle.trainId, e.vehicle.kind]));
  world.events.on("vehicle.departing", (e) => events.push(["departing", e.vehicle.trainId]));
  playTo(g, 300, () => {
    board.step();
    for (const tr of g.trains) {
      const here = board.standing.get(tr.id);
      assert.equal(!!here, tr.state === "dwelling", `${tr.id} at ${g.t}`);
      if (!here) continue;
      stood++;
      const v = here.vehicle, doors = world.services.doors(v);
      assert.equal(v.kind, TABLE_TRAIN.kind);
      assert.equal(v.source, "feed");
      assert.equal(here.dock.track, tr.track);
      assert.equal(world.services.placement(v), null, "the services draw nothing: the board draws its trains");
      assert.equal(doors.length, 2, `${tr.id}: a railcar's two doors`);
      for (const s of doors) assert.ok(s > here.dock.s0 && s < here.dock.s1, `${tr.id}: a door at ${s} m along the platform`);
      assert.equal(world.services.capacityOf(v), 120);
    }
  });
  assert.ok(stood > 20, "RB 31 and RB 32 stood at the platform");
  assert.deepEqual(events.slice(0, 4).map((e) => e.slice(0, 2)).sort(), [["arrived", "RB 31"], ["arrived", "RB 32"], ["departing", "RB 31"], ["departing", "RB 32"]]);
  assert.equal(events[0][2], TABLE_TRAIN.kind);
  // another game: the trains of the one before are gone from the platforms
  // (the world's time goes on: the trains that left are gone from their docks)
  for (let i = 0; i < 30; i++) world.step(0.1);
  playTo(g, 899);
  board.step();
  assert.ok(board.standing.size > 0);
  board.show(new SignallerGame({ level: "training" }));
  assert.equal(board.standing.size, 0);
  assert.ok([...world.services.docks.values()].every((st) => !st.vehicle || st.vehicle.phase === "departing" || st.vehicle.kind !== TABLE_TRAIN.kind));
});

test("the board: it draws the game on the table, and a signal, a track and where a route goes can be chosen there", () => {
  const world = createWorld(NEUSTADT, { seed: 1 });
  world.step(0.05);
  const board = new TableBoard(world), g = new SignallerGame({ seed: 3, level: "training" });
  board.show(g);
  board.active = true;
  playTo(g, 200);
  board.step();
  const ctx = countingContext(), view = viewOf(world, board.bounds("all"), ctx);
  view.groundPhoto = orthoOf(NEUSTADT).bounds_mm;
  board.draw(view);
  view.render();
  assert.ok(ctx.counts.fill > 50, "bands, cars, signals");
  for (const text of ["RB 31", "RB 32", "A", "N2", "P3", "G2", "Bergheim", "Talsee"]) assert.ok(ctx.counts.text.some((x) => x.includes(text)), `${text} is written on the table`);
  // without the table's photo the track itself is drawn as well
  const bare = countingContext(), virtual = viewOf(world, board.bounds("all"), bare);
  board.draw(virtual);
  virtual.render();
  assert.ok(bare.counts.fill + bare.counts.stroke > ctx.counts.fill + ctx.counts.stroke + 30, "track beds");

  // a signal is chosen where it stands, a track along its rails
  const px = (p, z = 0) => view.project(p[0], p[1], z);
  for (const id of Object.keys(STATION.signals)) assert.deepEqual(board.hit(view, px(board.at.signal(id).at)), { item: `signal-${id}` });
  assert.deepEqual(board.hit(view, px(board.at.trackMiddle("G1"))), { item: "track-G1" });
  const near = px(board.at.signal("F").at);
  assert.equal(board.hit(view, [near[0] + HIT_PX.signal * 3, near[1] - 200]), null, "nothing there");
  assert.deepEqual(board.hit(view, [near[0] + HIT_PX.signal * 1.4, near[1]], 1.7), { item: "signal-F" }, "a finger may be farther away");
  // with a signal chosen, the track is where its route goes, and so is the mark at the route's end
  board.picked = "signal-F";
  board.offers = [{ route: "F-G2" }, { route: "F-G3", disabled: true }];
  assert.deepEqual(board.hit(view, px(board.at.trackMiddle("G2"))), { route: "F-G2" });
  assert.deepEqual(board.hit(view, px(board.at.trackMiddle("G1"))), { item: "track-G1" }, "no route from F to G1");
  board.offers = [{ route: "N1-T" }];
  assert.deepEqual(board.hit(view, px(board.at.destination(STATION.routes.find((r) => r.id === "N1-T")))), { route: "N1-T" });
  const marks = countingContext(), chosen = viewOf(world, board.bounds("all"), marks);
  board.draw(chosen);
  chosen.render();
  assert.ok(marks.counts.text.some((x) => x.includes("→ Talsee")));
  // where the items of the game's picture are, and which part of the station shows them
  assert.deepEqual(board.placeOf("signal-A"), board.at.signal("A").at);
  assert.deepEqual(board.placeOf("track-G3"), board.at.trackMiddle("G3"));
  assert.equal(board.placeOf("signal-X"), null);
  assert.deepEqual(["signal-A", "track-G2", "signal-F", "signal-P3"].map((it) => board.partOf(board.placeOf(it))), ["west", "platforms", "east", "platforms"], "the exit signals stand at the platforms' ends");
  for (const part of ["all", "west", "platforms", "east"]) {
    const [x0, y0, x1, y1] = board.bounds(part);
    assert.ok(x1 > x0 && y1 > y0, part);
  }
});

test("the board: the level crossing on the line to Talsee closes for the game's trains, and no longer by the clock", () => {
  const world = createWorld(NEUSTADT, { seed: 1 });
  world.step(0.05);
  const crossing = world.getObject("rail-crossing-bruecke"), at = crossing.geometry.pos;
  // without the board it closes by the clock (a line beyond the layout): four times an hour, on the quarter
  let asked = 0;
  const byClock = (time) => {
    world.setTime(time);
    return crossing.closed(--asked);
  };
  assert.deepEqual([byClock("08:05"), byClock("08:00")], [false, true], "by the clock");
  const board = new TableBoard(world), g = new SignallerGame({ seed: 3, level: "training" });
  assert.equal(board.trainsNear(at), null, "no game: the board answers for no train");
  board.show(g);
  // RB 31 leaves for Talsee at about 08:03:10 and RB 32 comes from there at about 08:02; in between and before, no train is near
  const closed = [], when = (t) => closed.filter((c) => c.v).some((c) => c.t >= t[0] && c.t <= t[1]);
  playTo(g, 330, () => closed.push({ t: g.t, v: crossing.closed(1e6 + g.t), near: board.trainsNear(at) }));
  assert.ok(closed.every((c) => c.v === c.near), "the crossing is closed exactly while the board says a train is near");
  assert.equal(closed.find((c) => c.t === 20).v, false, "08:00:20: no train yet, and no closing by the clock (which would close it now)");
  assert.ok(when([60, 140]), "RB 32 from Talsee");
  assert.ok(when([200, 320]), "RB 31 to Talsee");
  const spans = closed.reduce((n, c, i) => n + (c.v && !closed[i - 1]?.v ? 1 : 0), 0);
  assert.equal(spans, 2, "it closes once for each of the two trains");
  // it opens again behind a train: from 250 m of the game before the crossing to the train's end past it
  const first = closed.filter((c) => c.v && c.t < 180);
  assert.ok(first.length * 1 < 60, `closed for ${first.length} s for RB 32`);
  assert.ok(CROSSING.before_m === 250 && CROSSING.beside_mm > 30);
  // a place off the trains' ways is never near
  assert.equal(board.trainsNear([at[0], at[1] + 400]), false);
  board.dispose();
  assert.equal(byClock("08:00"), true, "by the clock again");
});
