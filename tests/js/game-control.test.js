// The undertaking's operations control on the table (web/game/control.js): its trains are those of
// the signaller's game on the same table; where each is marked, what pulses, what a click chooses.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Camera, FlyCamera, View, createWorld } from "../../web/arail/index.js";
import { SignallerGame } from "../../web/arail/game/signaller.js";
import { TransportControlGame } from "../../web/arail/game/transport-control.js";
import { AHEAD_S, ControlBoard, HIT_PX } from "../../web/game/control.js";
import { BOARDS, TABLE_VIEW } from "../../web/game/live.js";
import { TABLE_LAYOUT, TableBoard } from "../../web/game/table.js";

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

function viewOf(world, bounds, ctx = countingContext()) {
  const cam = new FlyCamera({ yaw: (270 * Math.PI) / 180, pitch: (48 * Math.PI) / 180 }).fit(bounds, W / H, 0.03);
  const pose = cam.homography(W, H), camera = new Camera(W, H);
  camera.setManualFocal(pose.focal);
  return new View({ ctx, camera, H: pose.H, pose: pose.pose, scale: world.scale, time: world.time, virtual: true, pulse: 1 });
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
