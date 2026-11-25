// The undertaking's operations control on the table (web/game/control.js): its trains are those of
// the signaller's game on the same table; where each is marked, what pulses, what a click chooses.
// And the train dispatcher's board (web/game/dispatch.js), which marks every train of that table.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Camera, FlyCamera, View, createWorld } from "../../web/arail/index.js";
import { DispatcherGame } from "../../web/arail/game/dispatcher.js";
import { SignallerGame } from "../../web/arail/game/signaller.js";
import { TransportControlGame } from "../../web/arail/game/transport-control.js";
import { AHEAD_S, ControlBoard, HIT_PX } from "../../web/game/control.js";
import { DispatchBoard, LATE_S } from "../../web/game/dispatch.js";
import { BOARDS, TABLE_VIEW } from "../../web/game/live.js";
import { TABLE_LAYOUT, TableBoard } from "../../web/game/table.js";
import { WorkshopGame, WorkshopPlayer } from "../../web/arail/game/workshop.js";
import { HOLD_ASK_S, YardGame } from "../../web/arail/game/yard.js";
import { WorkshopBoard } from "../../web/game/workshop.js";
import { FAST_MPS, YardBoard } from "../../web/game/yard.js";

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

function viewOf(world, bounds, ctx = countingContext(), labels = true) {
  const cam = new FlyCamera({ yaw: (270 * Math.PI) / 180, pitch: (48 * Math.PI) / 180 }).fit(bounds, W / H, 0.03);
  const pose = cam.homography(W, H), camera = new Camera(W, H);
  camera.setManualFocal(pose.focal);
  return new View({ ctx, camera, H: pose.H, pose: pose.pose, scale: world.scale, time: world.time, virtual: true, pulse: 1, labels });
}

/** The morning on the table: the signaller's game with RB 33 six and a half minutes late, the operations control told of it by hand. */
function morning() {
  const world = createWorld(structuredClone(NEUSTADT), { seed: 1 });
  world.setLayers(TABLE_VIEW.layers);
  const sig = new SignallerGame({ level: "training", late: { "RB 33": 390 } }), tc = new TransportControlGame({ seed: 1, level: "training", wired: ["delay-notice"] });
  const table = new TableBoard(world), board = new ControlBoard(world), auto = new SignallerGame.player();
  table.show(sig);
  board.show(tc);
  const to = (t) => {
    while (sig.t < t) {
      auto.think(sig);
      sig.step(1);
      tc.step(1);
      for (const m of sig.outbox.splice(0)) if (m.flow === "delay-notice") tc.take(m);
    }
  };
  return { world, sig, tc, table, board, to };
}

test("the board of the operations control: it is a board of the table, and without a signaller's game it shows nothing", () => {
  assert.equal(BOARDS["transport-control"], ControlBoard);
  const world = createWorld(structuredClone(NEUSTADT), { seed: 1 }), board = new ControlBoard(world);
  board.show(new TransportControlGame({ seed: 1 }));
  assert.ok(world.simulations.includes(board));
  assert.equal(board.trains, null);
  assert.equal(board.where("RB 31"), null);
  const ctx = countingContext(), view = viewOf(world, board.bounds("all"), ctx);
  board.draw(view);
  view.render();
  assert.equal(ctx.counts.fill, 0);
  assert.equal(board.hit(view, [W / 2, H / 2]), null);
  // the picture is the station's, as the signaller's board shows it
  assert.deepEqual(board.bounds("east"), TableBoard.prototype.bounds.call({}, "east"));
  assert.equal(board.partOf([3000, 300]), "platforms");
  board.dispose();
  assert.ok(!world.simulations.includes(board));
});

test("the board of the operations control: a train is marked where it is on the table, at the table's end before it comes, and not once it has gone", () => {
  const { world, sig, tc, table, board, to } = morning();
  assert.equal(board.trains, table);
  // before its time a train is not there; from AHEAD_S before it, at the end of the table it comes in at (RB 31 from Bergheim: +x, RB 32 from Talsee)
  const enter = (id) => sig.trains.find((tr) => tr.id === id).enterAt;
  to(1);
  const [west, east] = [board.where("RB 31"), board.where("RB 32")];
  assert.ok(enter("RB 31") <= AHEAD_S && west[0] > 7000 && east[0] < -1500, JSON.stringify([west, east]));
  assert.equal(board.where("RB 35"), null);
  assert.equal(board.where("IC 2045"), null, "not a train of the undertaking's morning: no mark");
  // standing at the platform, its mark is the middle of the train; a click there chooses it
  const rb31 = sig.trains.find((tr) => tr.id === "RB 31");
  for (let t = 100; t < 400 && rb31.state !== "dwelling"; t += 5) to(t);
  assert.equal(rb31.state, "dwelling");
  const p = board.where("RB 31"), place = table.at.place(rb31, table.m);
  assert.ok(p[0] > 1560 && p[0] < 4296 && Math.abs(p[1] - 320) < 60, JSON.stringify(p));
  assert.ok(place.on);
  const ctx = countingContext(), view = viewOf(world, board.bounds("platforms"), ctx);
  board.active = true;
  board.draw(view);
  view.render();
  assert.ok(ctx.counts.fill >= 2);
  assert.deepEqual(ctx.counts.text, []);
  const px = view.project(p[0], p[1], 0);
  assert.deepEqual(board.hit(view, px), { item: "train-RB 31" });
  assert.deepEqual(board.hit(view, [px[0] + HIT_PX.train - 3, px[1]]), { item: "train-RB 31" });
  assert.equal(board.hit(view, [px[0] + 3 * HIT_PX.train, px[1] + 200]), null);
  assert.deepEqual(board.placeOf("train-RB 31"), p);
  assert.equal(board.placeOf("signal-A"), null);
  // a late train is marked as soon as it is known to be late, long before it comes
  assert.ok(enter("RB 33") - sig.t > AHEAD_S);
  assert.equal(board.where("RB 33"), null);
  to(605);
  assert.ok(tc.train("RB 33").delay_min >= 6 && enter("RB 33") - sig.t > AHEAD_S);
  assert.ok(board.where("RB 33")[0] > 7000);
  // the question is about RB 34 and its feeder: both are asked about; RB 33's passengers wait to be told
  assert.ok(tc.open.some((d) => d.id === "hold-RB 34"));
  assert.deepEqual([...board.asked()].sort(), ["RB 33", "RB 34"]);
  assert.ok(tc.train("RB 33").info_since != null && tc.train("RB 33").informed == null);
  // a train of later in the day that is cancelled: on platform 1 while its passengers must be told, and not once they are
  tc.trains.push({ id: "RB 38", dep: null, cancelled: true, info_since: tc.t, informed: null, info_text: "RB 38 is cancelled" });
  const p38 = board.where("RB 38");
  assert.ok(p38[0] > 1615 && p38[0] < 4161 && p38[1] > 370 && p38[1] < 430, JSON.stringify(p38));
  assert.deepEqual(board.hit(viewOf(world, board.bounds("platforms")), viewOf(world, board.bounds("platforms")).project(p38[0], p38[1], 0)), { item: "train-RB 38" });
  tc.act("inform", "RB 38");
  assert.equal(board.where("RB 38"), null);
  // gone, a train has no mark any more
  to(700);
  assert.equal(sig.trains.find((tr) => tr.id === "RB 31").state, "gone");
  assert.equal(board.where("RB 31"), null);
});

test("the board of the train dispatcher: every train of the signaller's table is marked, what a question is about is asked about, a click chooses a train", () => {
  assert.equal(BOARDS.dispatcher, DispatchBoard);
  assert.ok(new DispatchBoard(createWorld(structuredClone(NEUSTADT), { seed: 1 })) instanceof ControlBoard);
  const world = createWorld(structuredClone(NEUSTADT), { seed: 1 });
  world.setLayers(TABLE_VIEW.layers);
  // the morning of the mission: the signaller's trains late as told, the dispatcher's game wired to it by hand
  const sig = new SignallerGame({ seed: 1, level: "training", late: { "IC 2045": 300 }, wired: ["dispatching-order"] });
  const d = new DispatcherGame({ seed: 1, level: "training", wired: ["dispatching-order", "delay-notice"] });
  const table = new TableBoard(world), board = new DispatchBoard(world), auto = new SignallerGame.player();
  table.show(sig);
  board.show(d);
  const to = (t) => {
    while (sig.t < t) {
      auto.think(sig);
      sig.step(1);
      d.step(1);
      for (const m of sig.outbox.splice(0)) if (m.flow === "delay-notice") d.take(m);
      for (const m of d.outbox.splice(0)) if (m.flow === "dispatching-order") sig.receive(m);
    }
  };
  assert.deepEqual([d.own, d.world, board.trains, board.config.type], [false, null, table, "dispatch-board"]);
  // every train is the dispatcher's, also the intercity and the freight train; a train to come is at the table's end
  to(1);
  assert.ok(board.where("RB 31")[0] > 7000 && board.where("RB 32")[0] < -1500);
  to(290);
  assert.ok(d.open.some((x) => x.id === "first-GZ 47"));
  assert.deepEqual([...board.asked()].sort(), ["GZ 47", "IC 2045"]);
  assert.ok(d.train("IC 2045").in_s >= LATE_S && board.where("IC 2045")[0] > 7000, "a late train is marked as soon as it is known to be late");
  // (the freight train is out on the line, beyond the table's end: it is marked once it is on the table)
  for (let t = 300; t < 480 && !board.where("GZ 47"); t += 5) to(t);
  assert.ok(board.where("GZ 47") && d.open.some((x) => x.id === "first-GZ 47"), "the freight train is marked too");
  // drawn: rings and no text; a click on the freight train chooses it
  const ctx = countingContext(), view = viewOf(world, board.bounds("all"), ctx);
  board.draw(view);
  view.render();
  assert.ok(ctx.counts.fill >= 2);
  assert.deepEqual(ctx.counts.text, []);
  const p = board.where("GZ 47"), px = view.project(p[0], p[1], 0);
  assert.deepEqual(board.hit(view, px), { item: "train-GZ 47" });
  assert.deepEqual(board.placeOf("train-GZ 47"), p);
  // the order is kept on the same table: the freight train stands on G3 beyond its time, and is gone after its wait
  d.act("decide", "first-GZ 47", 2);
  assert.deepEqual([...board.asked()], []);
  to(650);
  const gz = sig.trains.find((tr) => tr.id === "GZ 47");
  assert.ok(gz.passed == null && gz.v === 0 && board.where("GZ 47")[0] > 1500 && board.where("GZ 47")[0] < 4300, JSON.stringify(board.where("GZ 47")));
  to(820);
  assert.ok(gz.passed != null && Math.abs(gz.passed - 700) < 45);
  to(1000);
  assert.equal(board.where("GZ 47"), null, "gone, a train has no mark any more");
  board.dispose();
  assert.ok(!world.simulations.includes(board));
});

test("the board of the yard master: the layout's hump yard draws the game's run; the crest, the tracks and a cut gone wrong can be chosen", () => {
  assert.equal(BOARDS.yard, YardBoard);
  assert.deepEqual([YardBoard.layers, YardBoard.parts.map((p) => p[0])], [["hump"], ["west", "platforms", "east", "all"]]);
  const world = createWorld(structuredClone(NEUSTADT), { seed: 1 });
  world.setLayers(YardBoard.layers);
  const board = new YardBoard(world), yard = world.objects.find((o) => o.type === "hump-yard"), g = new YardGame({ seed: 3 });
  assert.ok(yard && board.yard === yard && world.simulations.includes(board));
  board.show(g);
  assert.equal(yard.sim, g.sim, "the object draws the game's own simulation");
  // the first train over the hump, pushed fast: the crest is marked orange and full, the tracks with a train thin
  const to = (t, answer) => {
    while (g.t < t && !g.over) {
      for (const d of g.open) g.act("decide", d.id, answer(d));
      g.step(0.5);
    }
  };
  to(60, (d) => (d.id.startsWith("push-") ? 1.8 : d.options[0]?.id));
  assert.ok(g.v > FAST_MPS);
  const marks = board.marks();
  assert.deepEqual(marks.map((m) => m.item), ["hump", "track-1", "track-2", "track-3", "track-4", "track-5", "track-6"]);
  assert.deepEqual([marks[0].tone, marks[0].full, marks[1].tone, marks[5].faint], ["warn", true, "plan", true]);
  // where things are: the crest at the object's place, the tracks' ends beyond it to the west, the waiting trains before it
  const crest = board.placeOf("hump"), t1 = board.placeOf("track-1"), tr = board.placeOf("train-56034");
  assert.ok(Math.abs(crest[0] - yard.geometry.center[0]) < 1 && t1[0] < crest[0] - 4000 && tr[0] > crest[0]);
  assert.deepEqual([board.partOf(crest), board.partOf(t1), board.partOf([crest[0] - 1500, crest[1]]), board.placeOf("track-9"), board.placeOf("cut-none")], ["east", "west", "platforms", null, null]);
  // the picture: the whole yard within the camera's area, its parts side by side
  const all = board.bounds("all"), [a0, , a2] = YardBoard.area;
  assert.ok(all[0] >= a0 && all[2] <= a2 && all[2] - all[0] > 5000);
  assert.ok(board.bounds("west")[2] < board.bounds("east")[0] && board.bounds("platforms")[0] < board.bounds("platforms")[2]);
  // what a question is about is asked about; pushed fast, a cut goes wrong and is marked where it stands
  const standsWrong = () => [...g.wrong.entries()].find(([id, w]) => w.track && g.sim.bodies.some((b) => b.id === id))?.[0];
  for (let t = 60; t < 1500 && !standsWrong(); t += 2) to(t, (d) => (d.id.startsWith("push-") ? d.scale.max : d.id.startsWith("wrong-") ? null : g.advice(d.id)));
  const wrong = standsWrong();
  assert.ok(wrong, "a cut in a wrong track");
  assert.ok(board.marks().some((m) => m.item === `cut-${wrong}` && m.tone === "bad"));
  assert.ok([...board.asked()].some((x) => x === `cut-${wrong}` || x.startsWith("track-")));
  // drawn: rings and no text; a click on the crest chooses the hump, one on the cut the cut
  const ctx = countingContext(), view = viewOf(world, board.bounds("all"), ctx);
  board.draw(view);
  view.render();
  assert.ok(ctx.counts.fill >= 5);
  assert.deepEqual(ctx.counts.text, []);
  const at = (item) => {
    const p = board.placeOf(item);
    return view.project(p[0], p[1], p[2]);
  };
  assert.deepEqual(board.hit(view, at("hump")), { item: "hump" });
  assert.deepEqual(board.hit(view, at(`cut-${wrong}`)), { item: `cut-${wrong}` });
  assert.equal(board.hit(view, [5, 5]), null);
  // without a game nothing is marked; taken out of its world, the hump yard runs by itself again
  const px = at("hump");
  board.show(null);
  assert.deepEqual([board.marks(), board.hit(view, px), board.placeOf("hump"), yard.external], [[], null, null, null]);
  board.show(g);
  board.dispose();
  assert.ok(yard.external === null && !world.simulations.includes(board));
});

test("the board of the yard master marks a track due when the game does: orange from the game's own time before its cut-off while wagons are missing, as in the picture beside the table", () => {
  const world = createWorld(structuredClone(NEUSTADT), { seed: 1 });
  world.setLayers(YardBoard.layers);
  const board = new YardBoard(world), g = new YardGame({ seed: 3 }), o = g.outbound[0];
  board.show(g);
  let due = null;
  while (g.t < o.pull && !g.over) {
    for (const d of g.open) g.act("decide", d.id, g.advice(d.id));
    g.step(0.5);
    const tags = g.view().sketch.items.filter((it) => it.kind === "tag"), marks = board.marks().filter((m) => m.item.startsWith("track-"));
    for (const m of marks) assert.equal(m.tone === "warn", tags.find((it) => it.id === m.item)?.tone === "warn", `${m.item} at ${g.t} s`);
    if (due == null && marks.find((m) => m.item === `track-${o.track}`).tone === "warn") due = g.t;
  }
  assert.equal(due, o.pull - HOLD_ASK_S);
  board.dispose();
});

test("the workshop manager's board: the layout's hall draws the game's night; a unit and a free track are marked where they are, a click chooses them; nothing is written", () => {
  assert.equal(BOARDS.workshop, WorkshopBoard);
  assert.deepEqual(WorkshopBoard.layers, ["workshop"]);
  const world = createWorld(structuredClone(NEUSTADT), { seed: 1 });
  world.setLayers(WorkshopBoard.layers);
  const board = new WorkshopBoard(world), hall = world.objects.find((o) => o.type === "workshop-hall"), g = new WorkshopGame({ seed: 3 }), hands = new WorkshopPlayer();
  assert.ok(hall?.geometry && board.hall === hall && world.simulations.includes(board));
  // by itself the hall shows a quiet night of its own; with the board, the game's
  assert.equal(hall.picture().units.length, 3);
  board.show(g);
  assert.deepEqual(hall.picture().units.map((u) => u.id), ["105", "101"]);
  const to = (t, answer = (d) => g.advice(d.id)) => {
    while (g.t < t && !g.over) {
      for (const d of g.open) {
        const x = answer(d);
        if (x != null) g.act("decide", d.id, x);
      }
      hands.hands(g);
      g.step(0.5);
    }
  };
  // the shift begins: two units outside, every other track free and faint; the first question is about the pit and the units that can go in
  to(13, () => null);
  let marks = board.marks();
  assert.deepEqual(marks.map((m) => m.item), ["unit-105", "unit-101", "track-1", "track-2", "track-3", "track-C"]);
  assert.ok(marks.slice(2).every((m) => m.faint) && !marks[0].faint);
  assert.deepEqual([...board.asked()].sort(), ["track-1", "unit-101", "unit-105"]);
  // where things are: the units on the stabling tracks beside the hall, the hall's tracks side by side, the throat beyond the doors
  const P = hall.constructor.plan, u105 = board.placeOf("unit-105"), t1 = board.placeOf("track-1"), t3 = board.placeOf("track-3"), tA = board.placeOf("track-A");
  assert.ok(Math.hypot(u105[0] - tA[0], u105[1] - tA[1]) < 1, "a unit that stands on a track is at the track's place");
  assert.ok(Math.abs(Math.abs(t3[1] - t1[1]) - hall.mm(P.tracks[3] - P.tracks[1])) < 1);
  assert.deepEqual([board.partOf(t1), board.partOf(tA), board.partOf(hall.at(P.lead.x0 + 20, P.lead.y)), board.placeOf("track-9"), board.placeOf("unit-none"), board.placeOf("train-0")], ["east", "platforms", "west", null, null, null]);
  // the picture: the hall and the stabling tracks within the camera's area; its parts
  const all = board.bounds("all"), [a0, a1, a2, a3] = WorkshopBoard.area;
  assert.ok(all[0] >= a0 && all[1] >= a1 && all[2] <= a2 && all[3] <= a3 && all[2] - all[0] > 900);
  assert.ok(board.bounds("east")[2] < board.bounds("west")[2] && board.bounds("west")[2] > all[2], "the lead track is beyond the whole picture: a unit on the move leaves it there");
  // a unit on the move is where the hall draws it: on the way out of its track, then in the other
  g.act("decide", "free-1", "105");
  to(13 + 5);
  const moving = board.placeOf("unit-105");
  assert.ok(g.unit("105").moving && moving[0] > u105[0] + 50, "on its way to the throat");
  to(100);
  assert.ok(Math.hypot(board.placeOf("unit-105")[0] - t1[0], board.placeOf("unit-105")[1] - t1[1]) < 1);
  // raised on the jacks, a unit is marked where it is drawn: higher
  const j = new WorkshopGame({ seed: 1 });
  board.show(j);
  while (j.t < 160) {
    for (const d of j.open) j.act("decide", d.id, d.id === "free-1" ? "leave" : d.id === "free-2" ? "105" : j.advice(d.id));
    j.step(0.5);
  }
  assert.equal(j.unit("105").lift, 1);
  assert.ok(board.placeOf("unit-105")[2] > u105[2] + hall.mm(1));
  board.show(g);
  // a unit whose work waits for a word pulses orange; one that can be released is full
  to(1200, (d) => (d.id.startsWith("finding-") ? null : g.advice(d.id)));
  const waiting = g.units.find((u) => u.hold?.why === "decision");
  assert.ok(waiting, "a finding waits for a word");
  marks = board.marks();
  assert.deepEqual([marks.find((m) => m.item === `unit-${waiting.id}`).tone, marks.find((m) => m.item === `unit-${waiting.id}`).pulse], ["warn", true]);
  assert.ok(board.asked().has(`unit-${waiting.id}`));
  // drawn as the table draws it (a view without labels): the hall, rings and no text; a click on a unit chooses it, one on a free track the track
  const ctx = countingContext(), view = viewOf(world, board.bounds("all"), ctx, false);
  hall.draw(view);
  board.draw(view);
  view.render();
  assert.ok(ctx.counts.fill >= 20);
  assert.deepEqual(ctx.counts.text, []);
  const at = (item) => {
    const p = board.placeOf(item);
    return view.project(p[0], p[1], p[2]);
  };
  assert.deepEqual(board.hit(view, at(`unit-${waiting.id}`)), { item: `unit-${waiting.id}` });
  const free = board.marks().find((m) => m.faint);
  assert.deepEqual(board.hit(view, at(free.item)), { item: free.item });
  assert.equal(board.hit(view, [5, 5]), null);
  // without a game nothing is marked; taken out of its world, the hall shows its own night again
  const px = at(free.item);
  board.show(null);
  assert.deepEqual([board.marks(), board.hit(view, px), board.placeOf("track-1"), hall.external], [[], null, null, null]);
  board.show(g);
  assert.equal(typeof hall.external, "function");
  board.dispose();
  assert.ok(hall.external === null && !world.simulations.includes(board));
  assert.equal(hall.picture().units.length, 3);
});
