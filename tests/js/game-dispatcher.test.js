// The train dispatcher's game (web/arail/game/dispatcher.js), "Who goes first": the orders (a train
// waits for another at most so many minutes; a train takes another track), what they do to the
// signaller's trains, the undertakings' goodwill with its calls, promises and complaints, the
// account; a decision that is a number on a scale (the game core); the signaller's game as it takes
// a dispatcher's orders and tells forecasts that may be off; the mission Whose minutes?.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  DISPATCHER_LEVELS, DispatcherGame, DispatcherPlayer, GAMES, GOODWILL, Game, HOURS, Player, Session, SignallerGame, TransportControlGame, UNDERTAKINGS, WAIT_MAX_MIN, WAIT_RULE_MIN,
  behind, fallbackOf, normalizeMission, onScale, testRun, validateMission, wiring,
} from "../../web/arail/game/index.js";
import { ROOT } from "./helpers.js";

const MISSION = JSON.parse(readFileSync(join(ROOT, "web", "game", "missions", "whose-minutes.json"), "utf8"));

/** Play the game alone to its end; `policy(game, decision)` answers what is asked (null: nobody answers). */
function play(policy, { seed = 1, level = "normal", each = null } = {}) {
  const g = new DispatcherGame({ seed, level });
  while (!g.over) {
    if (policy) for (const d of g.open) g.act("decide", d.id, policy(g, d));
    each?.(g);
    g.step(0.5);
  }
  return g;
}

const byTheBook = (g, d) => g.advice(d.id);
/** As the regional undertaking asks, the freight train at its time, no promises. */
const asAsked = (g, d) => (d.id.startsWith("wait-") ? g.train(g.about.get(d.id)[0]).wish_min : d.id.startsWith("first-") ? 0 : d.id.startsWith("track-") ? "keep" : d.id === "hours" ? "effort" : "explain");

test("the game core: a decision can be a number on a scale, beside options or alone", () => {
  class Scales extends Game {
    static id = "scales";
  }
  const g = new Scales();
  assert.deepEqual([onScale({ min: 0, max: 8, step: 0.5 }, 2.74), onScale({ min: 0, max: 8, step: 0.5 }, 2.76), onScale({ min: 1, max: 3 }, 2.4), onScale({ min: 0, max: 1, step: 0.1 }, 0.1 + 0.2)], [2.5, 3, 2, 0.3]);
  assert.deepEqual([onScale({ min: 0, max: 8 }, 9), onScale({ min: 0, max: 8 }, -1), onScale({ min: 0, max: 8 }, "3"), onScale({ min: 0, max: 8 }, NaN), onScale(null, 3)], [null, null, null, null, null]);
  const got = [];
  const d = g.ask({ id: "wait", title: "How long?", scale: { min: 0, max: 8, step: 0.5, unit: "min", value: 3.2, label: "At most" }, options: [{ id: "never", label: "Not at all" }], then: (o) => got.push(o) });
  assert.deepEqual(d.scale, { step: 0.5, unit: "min", label: "At most", min: 0, max: 8, value: 3 });
  // a number outside the scale and a word that is no option are no decision
  assert.deepEqual([g.decide("wait", 9), g.decide("wait", "always"), g.decide("wait", "3"), g.open.length], [false, false, false, 1]);
  assert.equal(g.decide("wait", 2.3), true);
  assert.deepEqual([d.made, got, g.open.length], [2.5, [2.5], 0]);
  // nought is a decision like any other: taken, kept in the result, and not asked again
  g.ask({ id: "zero", title: "How long?", scale: { min: 0, max: 8 }, then: (o) => got.push(o) });
  assert.equal(g.decide("zero", 0), true);
  assert.deepEqual([g.open.length, got], [0, [2.5, 0]]);
  assert.deepEqual(g.result().decisions.map((x) => [x.id, x.option]), [["wait", 2.5], ["zero", 0]]);
  // an option beside the scale; a fallback that is a number, also nought, is taken at the deadline
  g.ask({ id: "word", title: "How long?", scale: { min: 0, max: 8 }, options: [{ id: "never", label: "Not at all" }] });
  assert.equal(g.decide("word", "never"), true);
  g.ask({ id: "late", title: "How long?", scale: { min: 0, max: 8 }, within: 10, fallback: 0, then: (o) => got.push(`fallback ${o}`) });
  g.step(11);
  assert.deepEqual([got.at(-1), g.decisions.at(-1).made, g.decisions.at(-1).auto], ["fallback 0", 0, true]);
  // what a decision comes to when nobody takes it: its fallback, its first option, where its scale stands
  assert.deepEqual([fallbackOf({ fallback: 0, options: [{ id: "a" }] }), fallbackOf({ options: [{ id: "a" }] }), fallbackOf({ options: [], scale: { min: 1, max: 5, value: 2 } }), fallbackOf({ options: [], scale: { min: 1, max: 5 } }), fallbackOf({})], [0, "a", 2, 1, null]);
  g.ask({ id: "alone", title: "How much?", scale: { min: 1, max: 5, value: 4 } });
  new Player().think(g);
  assert.equal(g.decisions.at(-1).made, 4);
  // a decision needs something to decide between
  assert.throws(() => g.ask({ id: "nothing", title: "?" }), /needs options or a scale/);
  assert.throws(() => g.ask({ id: "flat", title: "?", scale: { min: 2, max: 2 } }), /max above its min/);
});

test("the signaller: a forecast that may be off is told as it is announced, and once more when the train is on its way", () => {
  const off = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => new SignallerGame({ seed, level: "training", late: { "IC 2045": 300 }, spread: { "IC 2045": 150 } }).trains.find((tr) => tr.id === "IC 2045"));
  for (const tr of off) assert.ok(tr.told === 300 && Math.abs(tr.enterAt - tr.enter - 300) <= 150, `${tr.enterAt - tr.enter}`);
  assert.ok(new Set(off.map((tr) => tr.enterAt)).size >= 6, "the seed decides how far off");
  // without a spread a train comes as told, as before
  const exact = new SignallerGame({ seed: 4, level: "training", late: { "IC 2045": 300 } }).trains.find((tr) => tr.id === "IC 2045");
  assert.deepEqual([exact.enterAt - exact.enter, exact.told, exact.spread], [300, 300, 0]);
  const g = new SignallerGame({ seed: 4, level: "training", late: { "IC 2045": 300 }, spread: { "IC 2045": 150 }, wired: ["dispatching-order"] }), auto = new SignallerGame.player();
  const ic = g.trains.find((tr) => tr.id === "IC 2045"), real = ic.enterAt - ic.enter;
  assert.ok(Math.abs(real - 300) >= 30, `seed 4 is off by ${real - 300} s`);
  while (!g.over) {
    auto.think(g);
    g.step(1);
  }
  const told = g.outbox.filter((m) => m.flow === "delay-notice" && m.payload.train === "IC 2045").map((m) => m.payload);
  assert.deepEqual(told.slice(0, 2).map((p) => [p.stage, p.delay_min, p.spread_min ?? null, !!p.exact]), [["approaching", 5, 2.5, false], ["approaching", Math.round(real / 6) / 10, null, true]]);
  assert.equal(g.irregulars.find((x) => x.kind === "came-late").min, "5", "what was announced, not what came of it");
  // a dispatcher who is seated is told of every train as it leaves, also of one on time; nobody else is
  const ran = g.outbox.filter((m) => m.flow === "delay-notice" && ["departed", "passed"].includes(m.payload.stage));
  assert.equal(ran.length, g.trains.length);
  assert.ok(ran.filter((m) => m.payload.delay_min < 1).every((m) => m.to?.includes("train-dispatcher")) && ran.some((m) => m.payload.delay_min < 1));
  const alone = new SignallerGame({ seed: 4, level: "training" });
  while (!alone.over) {
    auto.think(alone);
    alone.step(1);
  }
  assert.equal(alone.outbox.filter((m) => m.flow === "delay-notice").length, 0, "without a dispatcher only delays are told");
});

test("the signaller: a train waits for another by the dispatcher's order, at most so long; a track is the dispatcher's to change", () => {
  const run = (orders, late = 420) => {
    const g = new SignallerGame({ seed: 1, level: "training", late: { "IC 2045": late }, wired: ["dispatching-order"] }), auto = new SignallerGame.player();
    while (!g.over) {
      for (const o of orders.filter((x) => x.at <= g.t && !x.done)) {
        o.done = true;
        g.receive({ flow: "dispatching-order", from: "train-dispatcher", to: null, t: g.t, payload: o.payload });
      }
      auto.think(g);
      g.step(1);
    }
    return { g, of: (id) => g.trains.find((tr) => tr.id === id) };
  };
  // by the timetable the freight train lets the intercity go first, however late it comes
  const plan = run([]);
  assert.ok(plan.of("GZ 47").passed > plan.of("IC 2045").passed && plan.of("GZ 47").passed - 580 > 300);
  // it does not wait: it goes at its own time, before the intercity
  const first = run([{ at: 300, payload: { hold: "GZ 47", for: "IC 2045", minutes: 0 } }]);
  assert.ok(first.of("GZ 47").passed < first.of("IC 2045").passed && first.of("GZ 47").passed - 580 < 60, `${first.of("GZ 47").passed}`);
  assert.ok(first.g.logs.some((l) => /The dispatcher orders: GZ 47 does not wait for IC 2045\./.test(l.text)));
  // it waits two minutes beyond its time, then goes; an intercity that comes within them passes first
  const some = run([{ at: 300, payload: { hold: "GZ 47", for: "IC 2045", minutes: 2 } }]);
  assert.ok(some.of("GZ 47").passed < some.of("IC 2045").passed && Math.abs(some.of("GZ 47").passed - 700) < 45, `${some.of("GZ 47").passed}`);
  const soon = run([{ at: 300, payload: { hold: "GZ 47", for: "IC 2045", minutes: 4 } }], 150);
  assert.ok(soon.of("GZ 47").passed > soon.of("IC 2045").passed && soon.of("GZ 47").passed < 580 + 4 * 60, "the wait ends when the other train has gone ahead");
  assert.ok(soon.g.logs.some((l) => /GZ 47 lets IC 2045 go first, until 08:13 at the latest/.test(l.text)));
  // a connecting train waits for the passengers, not beyond the minutes ordered; a later word takes the place of the first
  const held = run([{ at: 600, payload: { hold: "RB 34", for: "RB 33", minutes: 3 } }], 0);
  assert.ok(held.of("RB 34").departed - 900 < 60, "RB 33 is on time: nothing to wait for");
  const g = new SignallerGame({ seed: 1, level: "training", late: { "RB 33": 240 }, wired: ["dispatching-order"] });
  g.receive({ flow: "dispatching-order", from: "train-dispatcher", to: null, t: 0, payload: { hold: "RB 34", for: "RB 33", minutes: 5 } });
  assert.deepEqual([...g.holds], [["RB 34", { for: "RB 33", until: 1200 }]]);
  g.receive({ flow: "dispatching-order", from: "train-dispatcher", to: null, t: 0, payload: { hold: "RB 34", for: "RB 33", minutes: 0 } });
  assert.equal(g.holds.size, 0, "a train that stops and does not wait leaves as it is ready");
  // an undertaking's wish is the dispatcher's to grant when one is seated: it is not taken here
  g.receive({ flow: "connection-request", from: "ru-control-dispatcher", to: null, t: 0, payload: { hold: "RB 34", for: "RB 33", minutes: 4 } });
  assert.equal(g.holds.size, 0);
  const direct = new SignallerGame({ seed: 1, level: "training" });
  direct.receive({ flow: "connection-request", from: "ru-control-dispatcher", to: null, t: 0, payload: { hold: "RB 34", for: "RB 33", minutes: 4 } });
  assert.equal(direct.holds.get("RB 34").until, 900 + 240);
  // another track for a train that is still to come: where a route leads, and not once it is there
  const moved = run([{ at: 600, payload: { train: "RB 33", track: "G1" } }, { at: 600, payload: { train: "RB 34", track: "G1" } }, { at: 1000, payload: { train: "RB 35", track: "G3" } }, { at: 1560, payload: { train: "RB 36", track: "G2" } }]);
  assert.deepEqual(["RB 33", "RB 34", "RB 35", "RB 36"].map((id) => [moved.of(id).plan, moved.of(id).track]), [["G1", "G1"], ["G3", "G3"], ["G3", "G3"], ["G3", "G3"]]);
  assert.ok(!moved.g.irregulars.some((x) => x.kind === "wrong-track"), "the plan is the dispatcher's: a train on the track ordered is on its track");
  assert.ok(moved.g.logs.some((l) => /The dispatcher orders: RB 33 to G1 instead of G2\./.test(l.text)));
});

test("alone: the computer's dispatcher plays by the rules of the line and passes; nobody at the desk mostly does not; the same seed, the same morning", () => {
  for (const level of Object.keys(DISPATCHER_LEVELS)) {
    const scores = [1, 2, 3, 4, 5, 6].map((seed) => {
      const g = play(byTheBook, { seed, level }), r = g.result();
      assert.ok(g.over && g.trains.every((tr) => tr.out_s != null), `${level}, seed ${seed}: every train has left`);
      assert.equal(g.violations.filter((v) => v.rule !== "discrimination").length, 0, `${level}, seed ${seed}: ${g.violations.map((v) => v.text)}`);
      assert.ok(g.world.trains.every((tr) => (tr.stops ? tr.departed : tr.passed) != null) && !g.world.violations.length, `${level}, seed ${seed}: the signaller's morning`);
      return r.score;
    });
    assert.ok(scores.filter((x) => x >= 50).length >= 5 && scores.reduce((a, b) => a + b) / scores.length >= 62, `${level}: ${scores}`);
  }
  assert.equal(new DispatcherGame({ level: "no such level" }).level, "normal");
  const idle = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => play(null, { seed }));
  assert.ok(idle.reduce((a, g) => a + g.result().score, 0) / idle.length < 52, `${idle.map((g) => g.result().score)}`);
  assert.ok(idle.filter((g) => !g.result().passed).length >= 4);
  assert.ok(idle.every((g) => g.decisions.every((d) => d.auto)), "what nobody decides is decided by its fallback");
  assert.deepEqual(play(byTheBook, { seed: 5 }).result(), play(byTheBook, { seed: 5 }).result());
  assert.notDeepEqual(play(byTheBook, { seed: 5 }).account(), play(byTheBook, { seed: 6 }).account(), "another seed, another morning");
});

test("the choices matter: whose minutes they are depends on the orders, and no way of playing is best on every morning", () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const ways = {
    book: byTheBook,
    asked: asAsked,
    // the timetable's order whatever comes: the intercity first, nobody waits for passengers
    plan: (g, d) => (d.id.startsWith("first-") ? "after" : d.id.startsWith("wait-") ? 0 : g.advice(d.id)),
    // everybody waits for everybody, and everything is promised
    kind: (g, d) => (d.id.startsWith("first-") ? WAIT_RULE_MIN : d.id.startsWith("wait-") ? 6 : d.id.startsWith("track-") ? "keep" : "promise"),
  };
  const runs = Object.fromEntries(Object.entries(ways).map(([id, way]) => [id, seeds.map((seed) => play(way, { seed }))]));
  const mean = (id, of = (g) => g.result().score) => runs[id].reduce((a, g) => a + of(g), 0) / seeds.length;
  // the intercity first, whatever it costs: the freight undertaking pays, and complains with reason
  assert.ok(mean("plan", (g) => g.account().by.cargo) > mean("book", (g) => g.account().by.cargo) + 2);
  assert.ok(mean("plan", (g) => g.goodwill("cargo")) < mean("book", (g) => g.goodwill("cargo")) - 20);
  assert.ok(runs.plan.some((g) => g.violations.some((v) => v.rule === "discrimination")));
  // waits as the undertaking asks keep the connections, and cost its trains the minutes
  assert.ok(mean("asked", (g) => g.account().kept) > mean("book", (g) => g.account().kept) + 0.5);
  assert.ok(mean("asked", (g) => g.account().by.regio) > mean("book", (g) => g.account().by.regio) + 1);
  // waits beyond the rule and promises that cannot be kept are slips and breaches
  assert.ok(runs.kind.every((g) => g.violations.some((v) => v.rule === "waiting-time")) && runs.kind.some((g) => g.violations.some((v) => v.rule === "promise")));
  assert.ok(mean("book") > mean("plan") + 10 && mean("book") > mean("kind") + 5, JSON.stringify(Object.keys(ways).map((id) => [id, mean(id)])));
  // a person with judgment can beat the computer, and on some mornings the computer's way is the better one
  const better = seeds.filter((_, i) => runs.asked[i].result().score > runs.book[i].result().score).length;
  assert.ok(better >= 3 && better < seeds.length, `asked beats book on ${better} of ${seeds.length} mornings`);
  // three stars can be reached
  assert.ok(Math.max(...runs.asked.map((g) => g.result().score)) >= 85);
});

test("what is asked: a wait as a number of minutes, who goes first as minutes or however late, a track as one of a few, the phone", () => {
  const g = new DispatcherGame({ seed: 1 });
  const until = (cond) => {
    for (let i = 0; i < 6000 && !cond() && !g.over; i++) g.step(0.5);
    assert.ok(cond(), `not by ${g.t} s`);
  };
  // the intercity is announced late, with how far the forecast may be off: how long shall the freight train wait?
  until(() => g.open.some((d) => d.id === "first-GZ 47"));
  const first = g.open.find((d) => d.id === "first-GZ 47"), ic = g.train("IC 2045");
  assert.deepEqual([ic.told_s, ic.spread_s, ic.exact], [300, 150, false]);
  assert.match(first.title, /^IC 2045 comes about 5 min late; GZ 47 is on time\. How long shall GZ 47 wait/);
  assert.match(first.text, /^If GZ 47 goes first, IC 2045 may crawl behind it to Talsee; if it waits, it blocks G3 for RB 34\. /);
  assert.match(first.text, /may come 2\.5 to 7\.5 min late.*loses up to 4 min.*RB 34 is due on G3 at 08:14.*a train on time goes before a late one/s);
  assert.deepEqual([first.scale.min, first.scale.max, first.scale.step, first.scale.unit, first.scale.value, first.options.map((o) => o.id), first.fallback], [0, WAIT_MAX_MIN, 0.5, "min", 0, ["after"], "after"]);
  assert.deepEqual(g.about.get("first-GZ 47"), ["GZ 47", "IC 2045"]);
  assert.equal(g.act("decide", "first-GZ 47", 2.2), true);
  assert.deepEqual([g.train("GZ 47").order.minutes, g.train("GZ 47").order.until, g.outbox.at(-1).payload], [2, 580 + 120, { hold: "GZ 47", for: "IC 2045", minutes: 2 }]);
  assert.ok(g.world.holds.has("GZ 47"), "the order is the signaller's to keep");
  // the freight undertaking phones about its driver's time: a promise, a try, or a refusal
  until(() => g.open.some((d) => d.id === "hours"));
  const hours = g.open.find((d) => d.id === "hours");
  assert.match(hours.title, /^B\. Habicht, the freight undertaking's dispatcher, is on the phone: “The driver of GZ 49/);
  assert.match(hours.text, /^If GZ 49 loses more than 2 min here, its driver may not reach the relief, and the train is put aside\. /);
  assert.deepEqual([hours.options.map((o) => o.id), hours.fallback, hours.scale], [["promise", "effort", "no"], "effort", null]);
  g.act("decide", "hours", "promise");
  assert.deepEqual(g.promises, [{ undertaking: "cargo", train: "GZ 49", kept: null }]);
  // a feeder comes late: how long shall the connecting train wait? The undertaking asks for more than the rule gives
  until(() => g.open.some((d) => d.id === "wait-RB 34"));
  const wait = g.open.find((d) => d.id === "wait-RB 34");
  assert.match(wait.title, /^RB 33 comes about 4 min late\. How long shall RB 34 wait for its passengers\?$/);
  assert.match(wait.text, /^L\. Meise, the regional undertaking's dispatcher, asks for up to 5 min: \d+ want to change, \d+ are aboard RB 34\. Who misses RB 34 waits 30 min.*about 3\.8 min \(it may be 2\.5 to 5\.1\).*The rule of the line gives 3 min/s);
  assert.deepEqual([wait.scale.max, wait.scale.value, wait.options, wait.fallback, g.train("RB 34").wish_min], [WAIT_MAX_MIN, WAIT_RULE_MIN, [], 0, 5]);
  // two trains are expected on one track: which of them goes elsewhere?
  const track = g.open.find((d) => d.id === "track-GZ 49");
  assert.match(track.title, /^GZ 49 is due on G2 at 08:20, and RB 33 will still be there\. Which of them goes elsewhere\?$/);
  assert.deepEqual(track.options.map((o) => o.id), ["keep", "RB 33>G1", "RB 33>G3", "GZ 49>G3"]);
  assert.match(track.text, /^As planned, GZ 49 stands at the entry signal until G2 is free and the two trains' paths no longer cross\. /);
  assert.equal(track.options[1].hint, "platform 1: changing to RB 34 takes 2.5 min, not 0.5");
  assert.equal(track.options[3].hint, undefined);
  // RB 33 to the through track: its changers need longer, and its undertaking's goodwill pays for the other platform
  const before = [g.needed(g.train("RB 33"), 240), g.goodwill("regio")];
  g.act("decide", "track-GZ 49", "RB 33>G1");
  assert.deepEqual([g.train("RB 33").plan, g.world.trains.find((tr) => tr.id === "RB 33").plan], ["G1", "G1"]);
  assert.deepEqual([g.needed(g.train("RB 33"), 240) - before[0], g.goodwill("regio") - before[1]], [120, GOODWILL.moved]);
  // a wait beyond the rule and beyond what the undertaking asked for is a slip
  g.act("decide", "wait-RB 34", 6);
  assert.deepEqual(g.violations.map((v) => [v.rule, v.severity]), [["waiting-time", 1]]);
  until(() => g.over);
  assert.ok(g.promises[0].kept != null && g.decisions.every((d) => d.made != null));
});

test("the orders as moves: who can wait for whom, a wait cut short or made longer, a track only before a train comes", () => {
  const g = new DispatcherGame({ seed: 1 });
  for (let i = 0; i < 1210; i++) g.step(0.5);
  assert.equal(g.t, 605);
  // RB 34 can wait for its feeder; a freight train for the trains before it on its way; nobody for a train that has left
  assert.deepEqual(g.others(g.train("RB 34")).map((x) => x.id), ["RB 33"]);
  assert.deepEqual(g.others(g.train("GZ 49")).map((x) => x.id), ["RB 34"]);
  assert.deepEqual(g.others(g.train("RB 31")), []);
  assert.deepEqual([g.order("RB 34", "RB 33", 2).ok, g.train("RB 34").order.until, g.open.some((d) => d.id === "wait-RB 34")], [true, 900 + 120, false], "an order answers the question about the same train");
  assert.deepEqual([g.order("RB 34", "RB 33", 3.2).ok, g.train("RB 34").order.minutes], [true, 3]);
  assert.match(g.order("RB 34", "GZ 49", 2).reason, /cannot wait for GZ 49/);
  assert.match(g.order("RB 31", "RB 33", 2).reason, /RB 31 has left/);
  assert.match(g.order("RB 34", "RB 31", 2).reason, /RB 31 has left: there is nothing to wait for/);
  assert.match(g.order("RB 34", "RB 33", -1).reason, /between 0 and 8 min/);
  assert.match(g.order("RB 34", "RB 34", 1).reason, /no such pair/);
  assert.match(g.order("RB 99", "RB 33", 1).reason, /no such pair/);
  // the moves of a train in the picture: a minute more, no wait, another track
  const menu = (id) => g.view().sketch.items.find((it) => it.id === `train-${id}`).menu.map((m) => [m.label, m.name, m.args]);
  assert.deepEqual(menu("RB 34"), [["Wait for RB 33: 4 min at most", "order", ["RB 34", "RB 33", 4]], ["Do not wait for RB 33", "order", ["RB 34", "RB 33", 0]]]);
  assert.deepEqual(menu("GZ 49").slice(0, 2), [["Go at its time, before RB 34", "order", ["GZ 49", "RB 34", 0]], ["Wait 3 min for RB 34", "order", ["GZ 49", "RB 34", 3]]]);
  assert.ok(menu("RB 33").some(([label, name, args]) => label === "To G1 instead of G2" && name === "track" && args.join() === "RB 33,G1"));
  // tracks: where a route leads, where it is expected free, and only before the signaller sets the route
  for (let i = 0; i < 190; i++) g.step(0.5);
  assert.equal(g.t, 700);
  assert.deepEqual([g.movable(g.train("RB 33")), g.movable(g.train("RB 34")), g.movable(g.train("RB 31")), g.free(g.train("RB 35"))], [true, false, false, ["G1"]]);
  assert.match(g.track("RB 34", "G2").reason, /Too late for RB 34: the signaller sets its route 1\.5 min before it comes/);
  assert.match(g.track("RB 36", "G1").reason, /No route leads RB 36 to G1/);
  assert.match(g.track("RB 35", "G2").reason, /RB 35 is planned on G2/);
  assert.match(g.track("RB 35", "G3").reason, /G3 is not expected free when RB 35 comes/);
  assert.match(g.track("RB 99", "G2").reason, /no such train/);
  assert.match(g.track("RB 31", "G1").reason, /RB 31 has left/);
  assert.deepEqual([g.track("RB 35", "G1").ok, g.train("RB 35").plan, g.outbox.at(-1).payload], [true, "G1", { train: "RB 35", track: "G1" }]);
  // RB 36 on the island platform now waits for changers from platform 1: across the station
  assert.equal(g.change(g.train("RB 35"), g.train("RB 36")), 150);
});

test("what comes of it: minutes added, a wait that was too short, a train behind a slower one, goodwill, a call, a promise, a complaint", () => {
  // behind a slower train to the next loop: the faster one loses what the slower one needs more, less its gap
  assert.deepEqual([Math.round(behind("GZ", "IC", 0)), Math.round(behind("GZ", "IC", 120)), Math.round(behind("GZ", "IC", 400)), Math.round(behind("GZ", "RB", 0)), behind("IC", "GZ", 0), behind("RB", "RB", 0)], [240, 120, 0, 180, 0, 0]);
  // seed 4: the intercity comes sooner than announced; the freight train that went at its time is in its way
  const early = play(asAsked, { seed: 4 });
  const ic = early.train("IC 2045");
  assert.ok(ic.in_s < 240 && ic.knock_s >= 60 && ic.slow === "GZ 47", JSON.stringify([ic.in_s, ic.knock_s, ic.slow]));
  assert.ok(early.irregulars.some((x) => x.kind === "followed" && x.train === "IC 2045" && x.slow === "GZ 47"));
  assert.ok(early.irregulars.some((x) => x.kind === "forecast-off" && x.train === "IC 2045" && x.told === "5"));
  assert.ok(early.added(ic) >= 2 && early.goodwill("fern") < 100 - 2 * UNDERTAKINGS.fern.minute + 5);
  // the same morning with the freight train asked to wait the rule's three minutes: the intercity passes first, the freight train pays less than the intercity did
  const waited = play((g, d) => (d.id === "first-GZ 47" ? WAIT_RULE_MIN : asAsked(g, d)), { seed: 4 });
  assert.ok(waited.train("IC 2045").knock_s === 0 && waited.added(waited.train("GZ 47")) > 1 && waited.added(waited.train("GZ 47")) <= WAIT_RULE_MIN + 0.3);
  assert.ok(waited.goodwill("fern") > early.goodwill("fern") && waited.goodwill("cargo") < early.goodwill("cargo"));
  assert.equal(waited.deviations.cargo, 0, "three minutes are within the rule");
  // a wait that ends before the feeder is in costs the minutes and the connection
  const short = play((g, d) => (d.id === "wait-RB 34" ? 1.5 : asAsked(g, d)), { seed: 1 });
  const rb34 = short.train("RB 34");
  assert.deepEqual([rb34.kept, rb34.out_s >= 85, short.connections().find((c) => c.to === "RB 34").kept], [false, true, false]);
  assert.ok(short.irregulars.some((x) => x.kind === "wait-wasted" && x.train === "RB 34" && x.feeder === "RB 33"));
  assert.ok(short.goodwill("regio") < play(asAsked, { seed: 1 }).goodwill("regio") - 20);
  // minutes its own undertaking asked for, and that kept the connection, cost little goodwill
  const kept = play(asAsked, { seed: 1 });
  assert.ok(kept.train("RB 34").kept && kept.added(kept.train("RB 34")) > 3 && kept.goodwill("regio") > 85);
  // below its mark an undertaking phones; an explanation is taken, mostly, where the orders kept the rules
  const plan = play((g, d) => (d.id.startsWith("first-") ? "after" : asAsked(g, d)), { seed: 1 });
  assert.ok(plan.called.has("cargo") && plan.decisions.some((d) => d.id === "call-cargo" && d.made === "explain"));
  assert.match(plan.decisions.find((d) => d.id === "call-cargo").title, /^B\. Habicht, the freight undertaking's dispatcher, is on the phone: “GZ 47 stood \d+(\.\d)? min for somebody else's train/);
  assert.ok(plan.deviations.cargo >= 1, "an on-time train waited beyond the rule for a late one of another undertaking");
  // (the seed decides whether an explanation is taken: seldom, where the orders left the rules)
  const answers = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((seed) => play((g, d) => (d.id.startsWith("first-") ? "after" : asAsked(g, d)), { seed }).logs.filter((l) => /^\S+ B\. Habicht: "(Fair|That is not)/.test(l.text)));
  assert.ok(answers.filter((l) => /That is not what your network statement says/.test(l.text)).length > answers.length / 2 && answers.length >= 5, answers.map((l) => l.text).join("\n"));
  // a promise of a clear run binds: kept, it is worth goodwill; broken, it is a breach
  const promised = play((g, d) => (d.id === "hours" ? "promise" : asAsked(g, d)), { seed: 1 });
  assert.deepEqual(promised.promises.map((p) => [p.train, p.kept]), [["GZ 49", false]]);
  assert.ok(promised.violations.some((v) => v.rule === "promise" && v.severity === 2) && promised.irregulars.some((x) => x.kind === "promise-broken" && x.who === "B. Habicht"));
  // RB 34 does not wait and RB 33 goes to the through track: the freight train has its clear run, and the changers pay
  const clear = play((g, d) => (d.id === "hours" ? "promise" : d.id === "track-GZ 49" ? "RB 33>G1" : d.id === "wait-RB 34" ? 0 : asAsked(g, d)), { seed: 1 });
  assert.deepEqual(clear.promises.map((p) => [p.train, p.kept]), [["GZ 49", true]]);
  assert.ok(clear.added(clear.train("GZ 49")) <= 1 && clear.train("RB 34").kept === false && clear.goodwill("cargo") === 100);
  // a driver short of time: a freight train that stands may be put aside
  const aside = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((seed) => play(asAsked, { seed })).filter((g) => g.train("GZ 49").aside);
  assert.ok(aside.length >= 1 && aside.every((g) => g.added(g.train("GZ 49")) > HOURS.stand_min + HOURS.aside_min && g.irregulars.some((x) => x.kind === "put-aside")));
  // an undertaking that is always the one to wait complains; the regulator upholds it where the orders left the rules
  const unfair = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => play((g, d) => (d.id.startsWith("first-") ? "after" : d.id.startsWith("wait-") ? 0 : d.id === "hours" ? "no" : "sorry"), { seed }));
  const complaints = unfair.flatMap((g) => g.complaints);
  assert.ok(complaints.length >= 4 && complaints.some((c) => c.upheld), JSON.stringify(complaints));
  for (const g of unfair) {
    assert.equal(g.violations.filter((v) => v.rule === "discrimination").length, g.complaints.filter((c) => c.upheld).length);
    for (const c of g.complaints) assert.ok(g.goodwill(c.undertaking) < GOODWILL.complaint + 20 && g.irregulars.some((x) => x.kind === "complaint" && x.verdict === (c.upheld ? "upheld" : "not upheld")));
  }
});

test("the view for a page that does not know the game: figures, tables, the orders as forms, the tracks as a picture", () => {
  const g = new DispatcherGame({ seed: 1 });
  for (let i = 0; i < 1210; i++) g.step(0.5);
  const v = g.view();
  assert.deepEqual(v.figures.map((f) => f.label), ["Delay added", "Regional", "Long-distance", "Freight"]);
  assert.deepEqual(v.tables.map((t) => [t.id, t.rows.length]), [["trains", 9], ["undertakings", 3], ["connections", 3]]);
  assert.deepEqual(v.actions.map((a) => [a.name, a.fields.map((f) => f.id)]), [["order", ["train", "other", "minutes"]], ["track", ["train", "to"]]]);
  for (const a of v.actions) assert.ok(Object.hasOwn(DispatcherGame.actions, a.name));
  const sk = v.sketch, tags = sk.items.filter((it) => it.kind === "tag");
  assert.equal(sk.title, "The tracks");
  assert.deepEqual(tags.map((it) => it.id).sort(), g.trains.map((tr) => `train-${tr.id}`).sort());
  for (const it of sk.items) {
    for (const k of ["x", "y", "x1", "x2", "y1", "y2"]) if (it[k] != null) assert.ok(Number.isFinite(it[k]) && it[k] >= 0 && it[k] <= (k.startsWith("x") ? sk.width : sk.height), `${it.kind} ${it.id ?? ""} ${k}=${it[k]}`);
  }
  // the tags of one track stand side by side, also where their trains' times are close
  for (const y of new Set(tags.map((it) => it.y))) {
    const row = tags.filter((it) => it.y === y).sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) assert.ok(row[i].x >= row[i - 1].x + row[i - 1].text.length * 7.6 + 14, `${row[i - 1].text} and ${row[i].text}`);
  }
  // a train a question is about pulses; one that has left offers no moves; every train says what is known of it
  const tag = (id) => tags.find((it) => it.id === `train-${id}`);
  assert.deepEqual([tag("RB 34").alert, tag("RB 33").alert, tag("RB 31").alert, tag("RB 31").tone, tag("RB 31").menu], ["warn", "warn", undefined, "idle", undefined]);
  assert.match(tag("RB 33").title, /^RB 33: Regional, G2, departs 08:14; about 4 min late, give or take 1\.3$/);
  assert.match(tag("RB 31").title, /left on time/);
  // the rows are the tracks; a train sent to another track is drawn there
  const row = (id) => tag(id).y;
  assert.ok(row("RB 34") < row("RB 33") && row("RB 33") < row("IC 2045"));
  g.act("track", "RB 33", "G1");
  assert.equal(g.view().sketch.items.find((it) => it.id === "train-RB 33").y, row("IC 2045"));
  // nothing a page offers fails: every menu move and every form with its first options
  for (const it of g.view().sketch.items.filter((x) => x.menu)) for (const m of it.menu) assert.equal(typeof g.act(m.name, ...m.args).ok, "boolean", m.label);
});

test("the mission Whose minutes?: sound, wired to the signaller, its trains late as the dispatcher's level has them", () => {
  assert.deepEqual(validateMission(MISSION, GAMES), []);
  const m = normalizeMission(MISSION, GAMES), sig = m.roles.find((r) => r.game === "signaller");
  assert.deepEqual([sig.options.late, sig.options.spread], [DISPATCHER_LEVELS.normal.late, DISPATCHER_LEVELS.normal.spread], "alone and in the mission the morning is the same");
  const w = wiring(MISSION, GAMES), line = (seat, flow, dir) => w.find((x) => x.seat === seat && x.flow === flow && x.dir === dir).seats;
  assert.deepEqual([line("train-dispatcher", "dispatching-order", "gives"), line("train-dispatcher", "delay-notice", "takes"), line("signaller-relay", "connection-request", "takes")], [["signaller-relay"], ["signaller-relay"], []]);
  // every line on something that does not go to plan names a kind the dispatcher's game reports, and each kind has its line
  const kinds = m.story.filter((l) => l.on).map((l) => l.on);
  assert.deepEqual([...kinds].sort(), [...DispatcherGame.irregularities].sort());
  for (const seed of [1, 2, 3]) {
    const { session, result } = testRun(MISSION, GAMES, { seed });
    const d = session.seat("train-dispatcher").game, s = session.seat("signaller-relay").game;
    assert.ok(result.passed && d.own === false && d.world === null, `seed ${seed}`);
    // the orders went out as flows and the signaller kept them
    const orders = session.flows.filter((f) => f.flow === "dispatching-order");
    assert.ok(orders.length >= 3 && orders.every((f) => f.from === "train-dispatcher" && f.to.join() === "signaller-relay"));
    assert.ok(s.logs.some((l) => /The dispatcher orders: GZ 47 does not wait for IC 2045/.test(l.text)));
    // the dispatcher's count of the connections is the signaller's
    assert.deepEqual(d.connections().map((c) => [c.from, c.kept]), s.connections().map((c) => [c.from, c.kept]), `seed ${seed}`);
    // its minutes are the signaller's trains' minutes: what a train left late, less what it came late
    for (const tr of d.trains) {
      const real = s.trains.find((x) => x.id === tr.id), out = (real.stops ? real.departed : real.passed) - real.due;
      assert.ok(Math.abs(tr.out_s - Math.max(0, out)) <= 6 && Math.abs(tr.in_s - (real.enterAt - real.enter)) < 30, `seed ${seed}, ${tr.id}: ${tr.out_s} / ${out}`);
    }
    const report = session.flows.find((f) => f.flow === "performance-report" && f.from === "train-dispatcher")?.payload ?? d.outbox.find((x) => x.flow === "performance-report").payload;
    assert.deepEqual([report.kind, report.trains, report.delay_added_min, report.score], ["dispatching", 9, d.account().added_min, d.score().total]);
  }
});

test("with the undertaking's operations control seated: its wish to hold a train is the dispatcher's to grant, not the signaller's", () => {
  const games = new Map([DispatcherGame, SignallerGame, TransportControlGame].map((G) => [G.id, G]));
  const mission = normalizeMission({
    format: "arail-mission/1", id: "three", title: "Three", text: "A test.",
    roles: [
      { role: "train-dispatcher", game: "dispatcher", level: "training" },
      { role: "signaller-relay", game: "signaller", level: "training", options: { late: { "RB 33": 150 } } },
      { role: "ru-control-dispatcher", game: "transport-control", level: "training" },
    ],
  }, games);
  assert.deepEqual(validateMission(mission, games), []);
  const run = (seats = {}) => {
    const s = new Session(mission, { games, seed: 1, seats }).start();
    while (!s.over) s.step(10);
    return s;
  };
  const s = run(), d = s.seat("train-dispatcher").game, sig = s.seat("signaller-relay").game;
  assert.equal(d.wishes, false, "the wishes come by flow");
  const wish = s.flows.find((f) => f.flow === "connection-request");
  assert.deepEqual([wish.from, wish.to.includes("train-dispatcher"), wish.payload.hold, wish.payload.for], ["ru-control-dispatcher", true, "RB 34", "RB 33"]);
  assert.ok(!sig.logs.some((l) => /operations control asks/.test(l.text)), "the signaller takes the dispatcher's word, not the undertaking's");
  assert.equal(d.train("RB 34").wish_min, wish.payload.minutes);
  // granted by the rule: the order goes to the signaller, and the connection is kept
  const order = s.flows.find((f) => f.flow === "dispatching-order" && f.payload.hold === "RB 34");
  assert.ok(order && order.payload.minutes > 0 && order.payload.minutes <= WAIT_RULE_MIN);
  assert.equal(sig.connections().find((c) => c.to === "RB 34").kept, true);
  // a dispatcher who does not answer grants nothing: the train leaves, whatever the undertaking asked
  const idle = run({ "train-dispatcher": "human" });
  assert.ok(idle.flows.some((f) => f.flow === "connection-request") && !idle.flows.some((f) => f.flow === "dispatching-order" && f.payload.minutes > 0));
  assert.equal(idle.seat("signaller-relay").game.connections().find((c) => c.to === "RB 34").kept, false);
});

test("the computer's dispatcher: a player like any other, and the game's own", () => {
  assert.equal(DispatcherGame.player, DispatcherPlayer);
  assert.deepEqual([DispatcherGame.role, DispatcherGame.scale, DispatcherGame.clock, DispatcherGame.kind], ["train-dispatcher", "minutes", "08:00", "simulation"]);
  const g = new DispatcherGame({ seed: 1 });
  assert.equal(g.advice("no-such-decision"), null);
  assert.throws(() => g.act("setRoute", "A-G1"), /no move/);
});
