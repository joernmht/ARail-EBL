// The maintenance dispatcher's game on the table (web/game/district.js): where the district's
// places and faults lie on the layout of Bf Neustadt, the way of a van along the layout's streets,
// what the board draws and takes clicks for, and the table shared with the signaller's board in the
// live picture.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Camera, FlyCamera, View, createWorld } from "../../web/arail/index.js";
import { DISTRICT, FAULTS, MaintenanceGame } from "../../web/arail/game/maintenance.js";
import { SignallerGame } from "../../web/arail/game/signaller.js";
import { DISTRICT_TABLE, DistrictBoard, HIT_PX, districtProblems } from "../../web/game/district.js";
import { BOARDS, LiveScene, TABLE_VIEW } from "../../web/game/live.js";
import { TABLE_LAYOUT, TableBoard, TableStation } from "../../web/game/table.js";

const NEUSTADT = JSON.parse(readFileSync(new URL(`../../web/${TABLE_LAYOUT}`, import.meta.url), "utf8"));
const W = 1280, H = 800;

/** A canvas context that draws nothing and counts what is filled and written. */
function countingContext() {
  const counts = { fill: 0, stroke: 0, text: [] };
  return new Proxy({ canvas: { width: W, height: H }, counts }, {
    get(t, key) {
      if (key in t) return t[key];
      if (key === "fill" || key === "stroke") return () => counts[key]++;
      if (key === "fillText" || key === "strokeText") return (s) => counts.text.push(String(s));
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

/** A view of the table from the windows, as the play page shows it: of a part of the layout. */
function viewOf(world, bounds, ctx = countingContext()) {
  const cam = new FlyCamera({ yaw: (270 * Math.PI) / 180, pitch: (48 * Math.PI) / 180 }).fit(bounds, W / H, 0.03);
  const pose = cam.homography(W, H), camera = new Camera(W, H);
  camera.setManualFocal(pose.focal);
  return new View({ ctx, camera, H: pose.H, pose: pose.pose, scale: world.scale, time: world.time, virtual: true, pulse: 1 });
}

/** The world of the table, as the live picture has it, with a board for a game. */
function boardOf(game) {
  const world = createWorld(structuredClone(NEUSTADT), { seed: 1 });
  world.setLayers(TABLE_VIEW.layers);
  const board = new DistrictBoard(world);
  board.show(game);
  return { world, board };
}

/** A shift with one fault of the catalogue (and the signaller's N2), reported at once. */
function gameWith(id, options = {}) {
  const g = new MaintenanceGame({ seed: 3, level: "training", ...options });
  g.faults = [g._fault(FAULTS.find((f) => f.id === id), 0, false)];
  g.step(1);
  return g;
}

/** Let a game and the board that watches it go on until something holds. */
function until(g, board, cond, most = 4000) {
  for (let i = 0; i < most && !cond() && !g.over; i++) {
    g.step(1);
    board.step();
  }
  assert.ok(cond(), "the moment came");
}

test("the district on the table: every place and every fault of the game has its spot, where the table's camera may look", () => {
  assert.deepEqual(districtProblems(DISTRICT_TABLE, { faults: FAULTS.map((f) => f.id), area: TABLE_VIEW.area }), []);
  assert.deepEqual(Object.keys(DISTRICT_TABLE.places).sort(), Object.keys(DISTRICT.places).sort());
  // a fault lies on the stretch of the table that leads to its place: Bergheim at the Bergheim end (+x), Talsee at the other, Waldau on the strip at the windows
  const station = new TableStation(), g2 = station.way("g2", "+", 1).points;
  for (const f of FAULTS) {
    const [x, y] = DISTRICT_TABLE.spots[f.id].at;
    if (f.place === "Bergheim") assert.ok(x > g2[0][0], `${f.id} beyond the platforms towards Bergheim`);
    if (f.place === "Talsee") assert.ok(x < g2.at(-1)[0], `${f.id} beyond the platforms towards Talsee`);
    if (f.place === "Waldau") assert.ok(y > 700, `${f.id} on the strip at the windows`);
    if (f.place === DISTRICT.base) assert.ok(x < g2[0][0] && x > g2.at(-1)[0], `${f.id} at the platforms`);
  }
  // the level crossing is the layout's own
  const crossing = NEUSTADT.objects.find((o) => o.type === "rail-crossing");
  assert.deepEqual(DISTRICT_TABLE.spots.bue.at, crossing.position);
  assert.match(FAULTS.find((f) => f.id === "bue").asset, /Brückenstraße/);
  // what is wrong is named
  assert.match(districtProblems({ ...DISTRICT_TABLE, places: {} })[0], /The place Bf Neustadt has no spot/);
  assert.match(districtProblems(DISTRICT_TABLE, { faults: ["nowhere"] })[0], /The fault nowhere has no spot/);
  assert.match(districtProblems(DISTRICT_TABLE, { area: [0, 0, 100, 100] })[0], /lies outside the table's picture/);
});

test("the board: exit signal N2 is where the signaller's table has it, a fault of another game at its place", () => {
  const { board } = boardOf(new MaintenanceGame({ seed: 1 }));
  const n2 = board.spot({ id: "N2", place: "Bf Neustadt" }), at = new TableStation().signal("N2").at;
  assert.deepEqual(n2.at, at);
  assert.equal(n2.track, "g2");
  assert.equal(board.spot({ id: "N2", place: "Bf Neustadt" }), n2);
  assert.equal(board.spot({ id: "somewhere", place: "Talsee" }), DISTRICT_TABLE.places.Talsee);
  assert.equal(board.spot({ id: "elsewhere", place: "Nowhere" }), DISTRICT_TABLE.places["Bf Neustadt"]);
});

test("the board: a van drives the layout's streets from the base to the fault, in the time the game gives it, and on from there", () => {
  const g = gameWith("bue"), { board } = boardOf(g), tm = g.teams[0], spot = DISTRICT_TABLE.spots.bue;
  // at the base each team has its slot in the yard
  assert.deepEqual(board.van(tm), { at: DISTRICT_TABLE.base.yard[0], dir: [0, 1], driving: false });
  assert.deepEqual(board.van(g.teams[1]).at, DISTRICT_TABLE.base.yard[1]);
  board.step();
  assert.deepEqual(g.act("send", tm.id, "bue"), { ok: true });
  const way = board.way("base", "bue", tm);
  assert.deepEqual(way.points[0], DISTRICT_TABLE.base.yard[0]);
  assert.deepEqual(way.points.at(-1), spot.stand);
  // along the streets: longer than the straight line, and by Brückenstraße (x = −560) at its end
  assert.ok(way.total > 1.05 * Math.hypot(spot.stand[0] - way.points[0][0], spot.stand[1] - way.points[0][1]), `${way.total} mm`);
  assert.ok(way.points.some(([x, y]) => Math.abs(x + 560) < 30 && y < 240));
  assert.equal(board.way("base", "bue", tm), way);
  // it gets ready first, then moves on without a step back, and is there when the game says so
  let last = 0, moved = 0;
  const s0 = board.van(tm);
  assert.deepEqual([s0.at, s0.driving], [way.points[0], false]);
  while (tm.state === "driving") {
    g.step(1);
    board.step();
    if (tm.state !== "driving") break;
    const v = board.van(tm), d = Math.hypot(v.at[0] - way.points[0][0], v.at[1] - way.points[0][1]);
    moved = Math.max(moved, d);
    last = d;
  }
  assert.ok(moved > 3000 && last > 3000, "it came far");
  assert.deepEqual(board.van(tm).at, spot.stand);
  assert.equal(board.last.get(tm.id), "bue");
  // on to the next fault from where it stands
  g.faults.push(g._fault(FAULTS.find((f) => f.id === "azs"), g.t, false));
  until(g, board, () => tm.state === "ready" && g.fault("azs").state === "open");
  assert.equal(board.from(tm), "bue");
  g.act("send", tm.id, "azs");
  const next = board.way("bue", "azs", tm);
  assert.deepEqual([next.points[0], next.points.at(-1)], [spot.stand, DISTRICT_TABLE.spots.azs.stand]);
  // a board that comes to a game later knows no stand: the van is at its place
  const late = boardOf(g).board;
  assert.equal(late.from(tm), tm.place);
});

test("the board: it draws the shift on the table without a word, and a fault, a van and the base can be chosen there", () => {
  const g = gameWith("bue"), { world, board } = boardOf(g), ctx = countingContext();
  const view = viewOf(world, board.bounds("all"), ctx);
  board.active = true;
  world.draw(view);
  assert.ok(ctx.counts.fill > 50);
  // a fault at its spot, a van in the yard, the base: each is found at its place, and near it
  const px = (p, z = 0) => view.project(p[0], p[1], z);
  const spot = DISTRICT_TABLE.spots.bue;
  assert.deepEqual(board.hit(view, px(spot.at)), { item: "fault-bue" });
  assert.deepEqual(board.hit(view, px(spot.at).map((v, i) => v + (i ? HIT_PX.fault - 4 : 0))), { item: "fault-bue" });
  assert.deepEqual(board.hit(view, px(DISTRICT_TABLE.base.yard[1])), { item: "team-T2" });
  assert.deepEqual(board.hit(view, px(DISTRICT_TABLE.base.at, 20)), { item: "base" });
  assert.equal(board.hit(view, px([3000, 700])), null);
  assert.deepEqual(board.placeOf("fault-bue"), spot.at);
  assert.deepEqual(board.placeOf("team-T1"), DISTRICT_TABLE.base.yard[0]);
  assert.deepEqual(board.placeOf("base"), DISTRICT_TABLE.base.at);
  assert.equal(board.placeOf("fault-none"), null);
  assert.deepEqual([board.partOf(spot.at), board.partOf(DISTRICT_TABLE.base.at), board.partOf([3000, 300])], ["east", "west", "platforms"]);
  // with the fault chosen, the vans its moves need make the move; chosen the other way round, the fault does
  const menu = (id) => g.view().sketch.items.find((it) => it.id === id).menu;
  const offers = (id) => menu(id).map((m, i) => ({ i, target: m.target ?? null, disabled: !!m.disabled }));
  board.picked = "fault-bue";
  board.offers = offers("fault-bue");
  assert.deepEqual(board.offers.map((o) => o.target), ["team-T1", "team-T2"]);
  assert.deepEqual(board.hit(view, px(DISTRICT_TABLE.base.yard[1])), { target: "team-T2" });
  assert.deepEqual(menu("fault-bue")[1].args, ["T2", "bue"]);
  board.picked = "team-T1";
  board.offers = offers("team-T1");
  assert.deepEqual(board.hit(view, px(spot.at)), { target: "fault-bue" });
  assert.deepEqual(menu("team-T1")[0], { label: "To Level crossing Brückenstraße (Talsee, 8 min)", name: "send", args: ["T1", "bue"], target: "fault-bue" });
  // what the board names is the thing the move needs, not its place in a menu that may have changed since it was drawn
  board.offers = [{ i: 3, target: "fault-bue" }];
  assert.deepEqual(board.hit(view, px(spot.at)), { target: "fault-bue" });
  // the base has the technicians on call as its moves
  assert.deepEqual(menu("base").map((m) => [m.name, m.args]), [["callIn", ["signalling"]], ["callIn", ["track"]]]);
  // nothing is written, whatever the shift's state: a danger, a team on the road, at work, securing, a closure, a repair done
  const player = new MaintenanceGame.player();
  const full = new MaintenanceGame({ seed: 2, level: "hard" }), b = boardOf(full);
  const tones = new Set();
  for (let i = 0; i < 2400 && !full.over; i++) {
    player.think(full);
    full.step(1);
    b.board.step();
    if (i % 40) continue;
    const c = countingContext(), v = viewOf(b.world, b.board.bounds("all"), c);
    b.board.draw(v);
    v.render();
    assert.ok(c.counts.fill > 5, "the board is drawn");
    assert.deepEqual(c.counts.text, [], `nothing written at ${full.at()}`);
    for (const f of b.board.shown()) tones.add(b.board.tone(f));
  }
  assert.deepEqual([...tones].sort(), ["danger", "done", "handled", "waits"]);
  // a fault repaired stays a while, then it is gone from the table (and cannot be chosen any more)
  const done = full.faults.find((f) => f.state === "done" && full.t - f.done > 200);
  assert.ok(done && !b.board.shown().includes(done));
});

test("the board: the track a team works in shows its closure, asked and then closed", () => {
  const g = gameWith("azs"), { world, board } = boardOf(g), azs = g.fault("azs");
  g.act("send", "T1", "azs");
  until(g, board, () => g.open.some((d) => d.id === "closure-azs"));
  const bands = () => {
    const ctx = countingContext(), view = viewOf(world, board.bounds("east"), ctx);
    let n = 0;
    const ribbon = view.ribbon.bind(view);
    view.ribbon = (...args) => {
      n++;
      return ribbon(...args);
    };
    board.draw(view);
    return n;
  };
  assert.equal(bands(), 0);
  g.act("decide", "closure-azs", "ask");
  assert.equal(azs.closure, "asked");
  assert.equal(bands(), 1);
  until(g, board, () => azs.closure === "closed");
  assert.equal(bands(), 1);
  until(g, board, () => azs.state === "done");
  assert.equal(bands(), 0);
});

test("the board: a platform track closed for a team is kept free of the world's own trains, unless a signaller's board plans the station", () => {
  // the dispatcher alone: the game's own fault at exit signal N2, whose work is in track G2
  const g = new MaintenanceGame({ seed: 3, level: "training" });
  g.faults = g.faults.filter((f) => f.id === "N2");
  const { world, board } = boardOf(g), n2 = g.fault("N2");
  const modes = () => Object.fromEntries([...world.services.docks.values()].filter((st) => ["G1", "G2", "G3"].includes(String(st.dock.track))).map((st) => [st.dock.track, st.mode]));
  until(g, board, () => n2.state === "open");
  g.act("send", "T1", "N2");
  until(g, board, () => g.open.some((d) => d.id === "closure-N2"));
  assert.deepEqual([[...board.closed], world.services.planner], [[], null]);
  assert.ok(Object.values(modes()).every((m) => m !== "plan"));
  g.act("decide", "closure-N2", "ask");
  until(g, board, () => n2.closure === "closed");
  board.step();
  assert.deepEqual([[...board.closed], world.services.planner], [["G2"], board]);
  assert.equal(modes().G2, "plan");
  assert.notEqual(modes().G1, "plan");
  // repaired, the track is the timetable's again
  until(g, board, () => n2.state === "done");
  board.step();
  assert.deepEqual([[...board.closed], world.services.planner], [[], null]);
  assert.notEqual(modes().G2, "plan");
  // with a signaller's board on the table, the station is its own: the dispatcher's board plans nothing
  const h = new MaintenanceGame({ seed: 3, level: "training" });
  h.faults = h.faults.filter((f) => f.id === "N2");
  const b = boardOf(h), table = new TableBoard(b.world);
  h.fault("N2").at = 0;
  until(h, b.board, () => h.fault("N2").state === "open");
  h.act("send", "T1", "N2");
  until(h, b.board, () => h.open.some((d) => d.id === "closure-N2"));
  h.act("decide", "closure-N2", "ask");
  until(h, b.board, () => h.fault("N2").closure === "closed");
  b.board.step();
  assert.deepEqual([[...b.board.closed], b.world.services.planner], [[], table]);
  // taken out of its world, a board lets go of what it planned
  const again = boardOf(g);
  again.board.closed = new Set();
  again.board._plan(new Set(["G3"]));
  assert.equal(again.world.services.planner, again.board);
  again.board.dispose();
  assert.equal(again.world.services.planner, null);
});

test("one table for the games of a shift: the seat shown chooses on its board, the others' games are drawn with it", async (t) => {
  const fetched = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(readFileSync(`web/${url}`, "utf8")) });
  t.after(() => (globalThis.fetch = fetched));
  const ctx = countingContext(), canvas = { width: W, height: H, clientWidth: W, clientHeight: H, getContext: () => ctx, addEventListener() {}, dispatchEvent() {} };
  const scene = new LiveScene(canvas);
  assert.ok(await scene.load(TABLE_LAYOUT, TABLE_LAYOUT));
  assert.deepEqual([BOARDS.signaller, BOARDS.maintenance], [TableBoard, DistrictBoard]);
  const world = scene.world, sig = new SignallerGame({ level: "normal" }), mt = new MaintenanceGame({ seed: 1 });
  const boards = () => world.simulations.filter((s) => s instanceof TableBoard || s instanceof DistrictBoard).map((s) => s.constructor.type).sort();
  // the dispatcher's seat: its board is the one chosen on, the signaller's shows its trains
  assert.equal(scene.setTable(mt, { active: true, picked: "base", offers: [{ i: 0, target: null }], others: [sig] }), true);
  assert.ok(scene.board instanceof DistrictBoard);
  assert.deepEqual([scene.board.game, scene.board.active, scene.board.picked, scene.board.offers.length], [mt, true, "base", 1]);
  const other = scene.boards.get("signaller");
  assert.deepEqual([other.game, other.active, other.picked, other.offers], [sig, false, null, []]);
  assert.deepEqual(boards(), ["district-board", "table-board"]);
  assert.equal(world.services.planner, other);
  scene.draw(1e9);
  // the camera shows the whole district: the base behind the station and the strip at the windows
  const view = scene.view, base = view.project(...DISTRICT_TABLE.base.at, 0), strip = view.project(...DISTRICT_TABLE.spots.dfi.at, 0);
  for (const p of [base, strip]) assert.ok(p && p[0] > 0 && p[0] < W && p[1] > 0 && p[1] < H, "in the picture");
  // the signaller's seat: the other way round, the same boards
  scene.setTable(sig, { active: true, picked: "signal-A", offers: [{ i: 0, route: "A-G1" }], others: [mt] });
  assert.equal(scene.board, other);
  assert.deepEqual([other.active, other.picked, scene.boards.get("maintenance").active, scene.boards.get("maintenance").picked], [true, "signal-A", false, null]);
  assert.equal(scene.boards.size, 2);
  // a dispatcher alone: the signaller's board leaves the world, and the platform tracks are the timetable's again
  scene.setTable(mt, { active: true });
  assert.deepEqual(boards(), ["district-board"]);
  assert.equal(world.services.planner, null);
  // a game without a board has no table; left, no board stays in the world
  assert.equal(scene.setTable({ constructor: { id: "lab" } }), false);
  assert.deepEqual([boards(), scene.board, scene.boards.size, scene.table], [[], null, 0, false]);
});
