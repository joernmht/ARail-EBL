// German mode (web/arail/game/german.js): the load rises until nothing moves, in the signal box and at the
// container terminal. Played by the computer on many seeds: nobody at the desk is stuck soon, the computer
// lasts much longer, on some seeds for hours of the game's clock. The signal box keeps a timetable: a train on
// another track than planned, or late, gives fewer points.
import assert from "node:assert/strict";
import test from "node:test";

import {
  AHEAD_S, GAMES, GAP_MIN_S, GERMAN_GAMES, GERMAN_POINTS as POINTS, GermanSignallerGame, GermanTerminalGame, JOBS_MAX, LOAD_MAX, QUEUE_MAX, STACKS, STAGE_S, TIERS, TRAIN_QUEUE_MAX, TRUCK_QUEUE_MAX, WAGONS, gapAt, germanPlaceAt, loadAt, stageAt, trainGapAt,
} from "../../web/arail/game/index.js";

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
/** The tests play a game no longer than this (s): played well, it goes on. */
const LONGEST_S = 60 * 60;

/** Play a game to its end: with nobody at the desk, or with the game's computer player. */
function play(G, seed, computer) {
  const g = new G({ seed }), p = new G.player();
  for (let i = 0; !g.over && g.t < LONGEST_S; i++) {
    if (computer && i % 2 === 0) p.think(g);
    g.step(1);
  }
  return g;
}

test("the load only rises: the trains come closer together, and fuller", () => {
  assert.equal(stageAt(0), 1);
  assert.equal(stageAt(STAGE_S), 2);
  for (let s = 1; s < 40; s++) {
    assert.ok(gapAt(s + 1) <= gapAt(s), `the signal box, stage ${s}`);
    assert.ok(trainGapAt(s + 1) <= trainGapAt(s), `the terminal, stage ${s}`);
    assert.ok(loadAt(s + 1) >= loadAt(s) && loadAt(s) <= LOAD_MAX, `a train's containers, stage ${s}`);
  }
  // and then stays where playing well still keeps up
  assert.ok(gapAt(2) < gapAt(1));
  assert.equal(gapAt(40), GAP_MIN_S);
  assert.ok(LOAD_MAX <= WAGONS && loadAt(40) === LOAD_MAX);
});

for (const [name, G] of Object.entries(GERMAN_GAMES)) {
  test(`${name}: the same seed gives the same game, another seed another`, () => {
    const a = play(G, 5, true), b = play(G, 5, true);
    assert.deepEqual(a.result(), b.result());
    assert.deepEqual(a.moves, b.moves);
    assert.ok(SEEDS.some((seed) => play(G, seed, true).result().t !== a.result().t), "the seed decides what comes");
  });

  test(`${name}: nobody at the desk is stuck soon; the computer lasts much longer, on some seeds for an hour and more`, () => {
    let long = 0;
    for (const seed of SEEDS) {
      const idle = play(G, seed, false), computer = play(G, seed, true);
      assert.match(idle.over, /Stuck/);
      long += computer.over ? 0 : 1;
      assert.equal(idle.result().points, 0, `seed ${seed}: nothing gets through by itself`);
      assert.ok(idle.t < 15 * 60, `seed ${seed}: nobody at the desk is stuck within a quarter of an hour (${Math.round(idle.t / 60)} min)`);
      assert.ok(computer.t > idle.t + 10 * 60, `seed ${seed}: the computer lasts longer (${Math.round(computer.t / 60)} min against ${Math.round(idle.t / 60)} min)`);
      assert.ok(computer.result().points >= 8, `seed ${seed}: the computer gets something through (${computer.result().points})`);
      assert.ok(computer.result().stage > idle.result().stage);
    }
    assert.ok(long >= 1 && long < SEEDS.length, `the game can last long, and does not always (${long} of ${SEEDS.length} seeds over an hour)`);
  });

  test(`${name}: it is no role game of a mission`, () => {
    assert.equal(GAMES.has(G.id), false);
    assert.ok(G.pace > 1);
  });
}

test("the signal box: trains wait behind an occupied line, and one too many ends the game", () => {
  const g = new GermanSignallerGame({ seed: 2 });
  while (!g.over) g.step(1);
  const st = g.state();
  assert.equal(Math.max(st.waiting.west.length, st.waiting.east.length), QUEUE_MAX + 1);
  assert.equal(st.limit, QUEUE_MAX);
  assert.deepEqual(g.act("setRoute", "A-G1"), { ok: false, reason: "The game is over." });
});

test("the signal box: a train let in and out counts, and is forgotten", () => {
  const g = new GermanSignallerGame({ seed: 1 });
  const p = new GermanSignallerGame.player();
  while (g.through < 3 && !g.over) {
    p.think(g);
    g.step(1);
  }
  assert.equal(g.result().through, 3);
  assert.equal(g.result().points, 3 * POINTS.through, "by the timetable: every point");
  assert.ok(g.trains.every((tr) => tr.state !== "gone"));
  // only routes are set here: nothing fails, nothing is asked
  assert.deepEqual([...new Set(g.moves.map((m) => m.name))], ["setRoute"]);
  assert.equal(g.failure, null);
  assert.equal(g.open.length, 0);
  assert.throws(() => g.act("substitute", "N2"), /no move/);
});

test("the signal box: the timetable is known ahead, and a train on another track than planned gives fewer points", () => {
  const g = new GermanSignallerGame({ seed: 1 });
  const table = g.timetable();
  assert.ok(table.length >= 4, "the trains of the next minutes are in the timetable");
  assert.ok(table.every((tr) => tr.enter <= AHEAD_S + 1 && ["G1", "G2", "G3"].includes(tr.plan) && tr.due > tr.enter));
  assert.deepEqual(table.map((tr) => tr.enter), table.map((tr) => tr.enter).sort((a, b) => a - b));
  assert.ok(table.filter((tr) => tr.dir < 0).every((tr) => tr.plan !== "G1"), "no train from Talsee is planned into G1");
  // the first train from Bergheim, sent to another track than its own
  const first = table.find((tr) => tr.dir > 0), other = first.plan === "G1" ? "G2" : "G1";
  const seen = [];
  g.on((name, e) => name === "through" && seen.push(e));
  while (!seen.some((e) => e.train === first.id) && !g.over) {
    if (g.t > first.enter - 20 && !g.blocked(`A-${other}`) && g.trains.find((tr) => tr.id === first.id)?.state === "coming") g.act("setRoute", `A-${other}`);
    const tr = g.trains.find((x) => x.id === first.id), next = tr && tr.state !== "coming" ? g.nextSignal(tr) : null;
    if (next && next !== "A" && !g.blocked(`${next}-T`)) g.act("setRoute", `${next}-T`);
    g.step(1);
  }
  const e = seen.find((x) => x.train === first.id);
  assert.ok(e, "the train got through");
  assert.equal(e.wrong, true);
  assert.equal(e.track, other);
  assert.equal(e.points, POINTS.through - POINTS.wrongTrack - e.late * POINTS.perMinute);
  assert.equal(g.result().wrong, 1);
});

test("the terminal: places along the crane's runway", () => {
  assert.equal(germanPlaceAt("W1"), 0);
  assert.ok(germanPlaceAt("S1") > germanPlaceAt(`W${WAGONS}`));
  assert.ok(germanPlaceAt("T") > germanPlaceAt(`S${STACKS}`));
  for (const bad of ["W0", `W${WAGONS + 1}`, `S${STACKS + 1}`, "X1", "", null]) assert.equal(germanPlaceAt(bad), null, String(bad));
});

test("the terminal: a move is checked against what the yard will be, and done by the crane in its turn", () => {
  const g = new GermanTerminalGame({ seed: 1 });
  assert.equal(g.act("move", "W1", "S1").ok, false, "no train yet");
  while (g.train?.state !== "here") g.step(1);
  const [a, b] = g.plan.wagons;
  assert.ok(a && b, "the first train brings two containers");
  assert.match(g.act("move", "W1", "W2").reason, /stack or to its truck/);
  assert.match(g.act("move", "W1", "T").reason, /No truck waits/);
  assert.match(g.act("move", "S1", "S2").reason, /empty/);
  // both onto one stack: the second is given while the first still stands on its wagon
  assert.deepEqual(g.act("move", "W1", "S1"), { ok: true });
  assert.deepEqual(g.act("move", "W2", "S1"), { ok: true });
  assert.deepEqual(g.plan.stacks[0], [a, b]);
  assert.deepEqual(g.real.stacks[0], []);
  assert.equal(g.top("S1"), b, "only the top one can be lifted");
  while (g.jobs.length) g.step(1);
  assert.deepEqual(g.real.stacks[0], [a, b]);
  assert.equal(g.lifts, 2);
  // the train leaves empty, and the trucks come for both
  while (g.trucks.length < 2 && !g.over) g.step(1);
  const first = g.trucks.find((k) => k.wants === a);
  assert.ok(first, "a truck comes for the container below");
  assert.match(g.act("move", "S1", "S1").reason, /already/);
  assert.equal(g.act("move", "S1", "T").ok, true, "the top one goes to its truck");
  assert.equal(g.act("move", "S1", "T").ok, true, "then the one below");
  while (g.jobs.length) g.step(1);
  assert.equal(g.result().points, 2);
  assert.equal(g.trucks.length, 0);
  assert.equal(g.trainsDone, 1);
});

test("the terminal: a stack is full at its height, the crane takes only so many moves ahead", () => {
  const g = new GermanTerminalGame({ seed: 1 });
  g.plan.stacks[0] = ["X1", "X2", "X3"].slice(0, TIERS);
  g.plan.stacks[1] = ["Y1"];
  assert.match(g.blocked("S2", "S1"), /full/);
  assert.equal(g.blocked("S2", "S3"), null);
  for (let i = 0; i < JOBS_MAX; i++) g.jobs.push({ id: `J${i}`, from: "S4", to: "S5", phase: 0, t0: 0, x0: 0 });
  assert.match(g.blocked("S2", "S3"), /moves waiting/);
});

test("the terminal: it ends with too many trains before it, or too many trucks at the gate", () => {
  for (const seed of SEEDS) for (const computer of [false, true]) {
    const g = play(GermanTerminalGame, seed, computer), st = g.state();
    if (!g.over) continue;
    assert.ok(st.queue.length > TRAIN_QUEUE_MAX || st.trucks.length > TRUCK_QUEUE_MAX || !g.movable(), g.over);
  }
});
