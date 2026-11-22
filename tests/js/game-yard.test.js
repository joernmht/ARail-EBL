// The yard master's game (web/arail/game/yard.js), "Before the cut-off": the hump of the lab's table
// as the game's world (arail/hump), which train goes next and how fast it is pushed, the one
// locomotive and its jobs, the outbound trains at their cut-offs, the three people who count
// differently, the account; the mission The last wagon.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  GAMES, HOLD, INBOUND, LOCO, MOOD, NEXT_PATH, OUTBOUND, PUSH, YARD, YARD_LEVELS, YARD_PEOPLE, YardGame, YardPlayer, normalizeMission, testRun, validateMission,
} from "../../web/arail/game/index.js";
import { ROOT } from "./helpers.js";

const MISSION = JSON.parse(readFileSync(join(ROOT, "web", "game", "missions", "last-wagon.json"), "utf8"));

/**
 * Play the game alone to its end (or `until`, s); `policy(game, decision)` answers what is asked
 * (null: nobody answers), `each(game)` is called before every step.
 */
function play(policy, { seed = 1, level = "normal", each = null, until = Infinity } = {}) {
  const g = new YardGame({ seed, level });
  while (!g.over && g.t < until) {
    if (policy) for (const d of g.open) g.act("decide", d.id, policy(g, d));
    each?.(g);
    g.step(0.5);
  }
  return g;
}

/** The locomotive closes up what needs it, as the computer's yard master does. */
const tidy = (g) => {
  for (const t of g.full()) g.act("close", t);
};
const computer = (g, d) => g.advice(d.id);
/** By the yard's instructions: in the order the trains came, at the instructions' speed, every train out at its cut-off, the locomotive's jobs when no train waits. */
const onTheMinute = (g, d) => (d.id === "next" ? d.options[0].id : d.id.startsWith("push-") ? Math.min(d.scale.max, PUSH.rule) : d.id.startsWith("hold-") ? 0 : d.id.startsWith("round-") || d.id.startsWith("wrong-") ? "free" : g.advice(d.id));
/** The same, but every train waits the three minutes its path allows. */
const threeMinutes = (g, d) => (d.id.startsWith("hold-") ? HOLD.slot_min : onTheMinute(g, d));
/** The same as by the instructions, but pushed at `v`. */
const pushedAt = (v) => (g, d) => (d.id.startsWith("push-") ? Math.min(d.scale.max, v) : onTheMinute(g, d));
/** Pushed as fast as it goes, whatever the hump operator says. */
const flatOut = (g, d) => (d.id.startsWith("push-") ? d.scale.max : d.id === "call-hump" ? "insist" : d.id.startsWith("wrong-") || d.id.startsWith("round-") ? "now" : onTheMinute(g, d));

/** One train goes over the hump, and no other: what is asked about the next one stays open (and the wagon that must not be humped stays where it is). */
const oneTrain = (rest) => (g, d) => (d.id === "next" && g.inbound.some((x) => x.state !== "waiting" && x.state !== "coming") ? null : d.id.startsWith("push-") && g.inbound.some((x) => x.state === "done") ? null : rest(g, d));

/** Shifts played once and kept (a shift takes half a second). */
const kept = new Map();
const shift = (name, policy, seed, level = "normal") => {
  const key = `${name}|${seed}|${level}`;
  if (!kept.has(key)) kept.set(key, play(policy, { seed, level, each: tidy }));
  return kept.get(key);
};

test("alone: the computer's yard master passes; nobody at the desk fails, because nothing goes over the hump; the same seed, the same shift", () => {
  for (const level of Object.keys(YARD_LEVELS)) {
    for (const seed of level === "normal" ? [1, 2, 3, 4, 5, 6] : [1, 2]) {
      const g = shift("computer", computer, seed, level), r = g.result(), a = g.account();
      assert.ok(r.passed && r.score >= 55, `${level}, seed ${seed}: ${r.score}`);
      assert.deepEqual([a.humped, a.gone, a.booked], [INBOUND.length, OUTBOUND.length, 26], `${level}, seed ${seed}`);
    }
  }
  // training: a summer night without a late train and without a wagon that must not be humped
  const easy = shift("computer", computer, 1, "training");
  assert.ok(easy.result().score >= 85 && !easy.decisions.some((d) => d.id.startsWith("round-")));
  // nobody at the desk: no train is humped, every outbound train waits as long as it may and loses its path
  const idle = play(null, { seed: 2 }), a = idle.account();
  assert.equal(idle.result().passed, false);
  assert.deepEqual([a.humped, a.made, a.lost], [0, 0, OUTBOUND.length]);
  assert.ok(idle.open.some((d) => d.id === "next" && d.deadline == null), "the hump waits for the yard master's word");
  assert.deepEqual(play(computer, { seed: 5, each: tidy }).result(), shift("computer", computer, 5).result());
  assert.notDeepEqual(shift("computer", computer, 5).account(), shift("computer", computer, 6).account(), "another seed, another shift");
});

test("the choices matter: out on the minute, three minutes for the wagons and a faster push each win on some mornings; flat out fails", () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], ways = { minute: onTheMinute, three: threeMinutes, faster: pushedAt(1.6) };
  const scores = Object.fromEntries(Object.entries(ways).map(([id, way]) => [id, seeds.map((seed) => shift(id, way, seed).result().score)]));
  const best = seeds.map((_, i) => Object.keys(ways).reduce((b, id) => (scores[id][i] > scores[b][i] ? id : b)));
  for (const id of Object.keys(ways)) assert.ok(best.includes(id), `${id} is never the best way: ${JSON.stringify(scores)}`);
  // every one of them is defensible: it passes on most mornings
  for (const id of Object.keys(ways)) assert.ok(scores[id].filter((s) => s >= 50).length >= 8, `${id}: ${scores[id]}`);
  // waiting gets wagons onto their trains and costs minutes; leaving on the minute the other way round
  const sum = (id, f) => seeds.reduce((s, seed) => s + f(shift(id, ways[id], seed).account()), 0);
  assert.ok(sum("three", (a) => a.made) > sum("minute", (a) => a.made) && sum("three", (a) => a.late_min) > sum("minute", (a) => a.late_min));
  assert.equal(sum("minute", (a) => a.late_min + a.lost), 0);
  // faster pushing: cuts in the wrong track, which the instructions' speed does not have
  assert.ok(sum("faster", (a) => a.misrouted) > sum("minute", (a) => a.misrouted) + 3);
  // flat out, against the hump operator: the hump is stopped, the shift fails
  const wild = [1, 2, 3, 4].map((seed) => shift("flat", flatOut, seed));
  assert.ok(wild.filter((g) => !g.result().passed).length >= 3, String(wild.map((g) => g.result().score)));
  assert.ok(wild.some((g) => g.irregulars.some((x) => x.kind === "hump-stopped")));
  for (const g of wild) assert.ok(g.account().misrouted >= 3 && g.mood("hump") < MOOD.call);
});

test("what is asked: the next train as one of a few, its speed as a number, a wait as a number of minutes, the locomotive's way as one of two", () => {
  const g = new YardGame({ seed: 1 });
  // the shift's first seconds: nothing is asked while the yard is handed over
  for (let i = 0; i < 20; i++) g.step(0.5);
  assert.deepEqual(g.open, []);
  for (let i = 0; i < 20; i++) g.step(0.5);
  const next = g.open[0];
  assert.deepEqual([g.open.length, next.id, next.deadline, next.fallback], [1, "next", null, "56012"]);
  assert.deepEqual(next.options.map((o) => o.id), ["56012", "56034", "56058"], "in the order they came in");
  assert.match(next.title, /^56012, 56034 and 56058 wait in the arrival tracks\. Which goes over the hump next\?$/);
  assert.match(next.options[1].hint, /06:10: 3 \(1 not to be humped\)/);
  assert.deepEqual(g.about.get("next"), ["train-56012", "train-56034", "train-56058"]);
  g.act("decide", "next", "56034");
  g.step(0.5);
  // how fast: a scale, no time to answer by (no train goes without the word), the careful speed if somebody else answers
  const push = g.open.find((d) => d.id === "push-56034");
  assert.deepEqual(push.scale, { min: PUSH.min, max: PUSH.max, step: PUSH.step, unit: "m/s", value: PUSH.rule, label: "56034 is pushed at" });
  assert.deepEqual([push.deadline, push.fallback, push.options.length], [null, PUSH.auto, 0]);
  assert.match(push.text, /^Faster, its wagons are in sooner; above 1\.4 m\/s a switch may not get between two cuts, and wagons meet too hard\./);
  // a number between the steps is taken to the nearest: 1.37 is 1.4
  g.act("decide", push.id, 1.37);
  g.step(0.5);
  assert.deepEqual([g.loco.state, g.loco.train, g.v, g.train("56034").state], ["push", "56034", 1.4, "hump"]);
  assert.equal(g.sim.pushing?.v ?? g.sim.queue[0].push_mps, 1.4);
  // the next question comes when the train is over the hump: the wagon that must not be humped, and the next train
  while (!g.open.some((d) => d.id === "round-56034")) g.step(0.5);
  const round = g.open.find((d) => d.id === "round-56034");
  assert.deepEqual([round.options.map((o) => o.id), round.fallback, round.deadline - g.t], [["now", "free"], "free", 60]);
  assert.match(round.title, /must not be humped \(label 15\)/);
  assert.ok(g.open.some((d) => d.id === "next"), "the next train is asked for while the locomotive runs back");
  // a wait: asked a minute and a half before the cut-off, as a number of minutes; without a word the train waits as long as it may
  for (const d of g.open) g.act("decide", d.id, d.id === "next" ? "56012" : "free");
  while (!g.open.some((d) => d.id.startsWith("hold-"))) {
    for (const d of g.open) g.act("decide", d.id, g.advice(d.id));
    g.step(0.5);
  }
  const hold = g.open.find((d) => d.id === "hold-51204");
  assert.deepEqual([hold.scale.min, hold.scale.max, hold.scale.step, hold.scale.unit, hold.fallback, g.t], [0, HOLD.max_min, HOLD.step_min, "min", HOLD.max_min, OUTBOUND[0].pull - 90]);
  assert.match(hold.title, /^\d wagons? for the 06:10 to the port (is|are) not in track 1 yet\. How long shall the train wait\?$/);
  assert.match(hold.text, /^Its path waits 3 min; held longer, the train loses it and goes 10 or 25 min late\./);
  assert.deepEqual(g.about.get(hold.id), ["track-1"]);
});

test("the moves: the speed while a train is pushed, the next train, a wait, the locomotive's jobs; each refused where it cannot be", () => {
  const g = new YardGame({ seed: 1 });
  assert.match(g.act("push", 1.2).reason, /No train is on the hump/);
  // the next train can be chosen in the picture before it is asked for: the question is not asked then
  assert.deepEqual(g.act("hump", "56058"), { ok: true });
  assert.match(g.act("hump", "99999").reason, /no such train/);
  while (!g.open.length) g.step(0.5);
  assert.deepEqual(g.open.map((d) => d.id), ["push-56058"]);
  g.act("decide", "push-56058", 1.2);
  for (let i = 0; i < 60; i++) g.step(0.5);
  assert.match(g.act("hump", "56058").reason, /is on the hump/);
  // faster, slower, stop and on again: the train on the hump follows at once; the cuts already free roll on
  assert.deepEqual([g.act("push", 1.6), g.v, g.sim.pushing.v, g.train("56058").vmax], [{ ok: true }, 1.6, 1.6, 1.6]);
  assert.match(g.act("push", 2.4).reason, /0\.8 to 2\.0 m\/s, or stopped/);
  assert.match(g.act("push", 0.3).reason, /0\.8 to 2\.0/);
  const at = g.sim.pushing.cuts.at(-1).s, free = g.sim.bodies.filter((b) => b.v > 0).length;
  assert.deepEqual(g.act("push", 0), { ok: true });
  for (let i = 0; i < 20; i++) g.step(0.5);
  assert.ok(Math.abs(g.sim.pushing.cuts.at(-1).s - at) < 0.2 && free > 0 && g.loco.state === "push", "the train stands; what is free rolls on");
  assert.deepEqual(g.act("push", 1), { ok: true });
  // what the hump operator has agreed to is the most
  g.cap = PUSH.limit;
  assert.match(g.act("push", 1.6).reason, /S\. Pirol pushes at 1\.4 m\/s at most/);
  // a wait said before it is asked for answers the question
  assert.deepEqual(g.act("hold", "51208", 2), { ok: true });
  assert.deepEqual([g.train("51208").hold_min, g.train("51208").asked], [2, true]);
  assert.match(g.act("hold", "51208", 9).reason, /held 0 to 8 min/);
  assert.match(g.act("hold", "56012", 1).reason, /no such outbound train/);
  // the locomotive: an empty track is not closed up, a cut that is where it belongs is not fetched
  assert.match(g.act("close", "4").reason, /Track 4 is empty|on the locomotive's list/);
  assert.match(g.act("close", "9").reason, /no such track/);
  assert.match(g.act("fetch", "56058/1").reason, /No such cut stands in a wrong track/);
  // closing up a track with wagons in it: the locomotive's job once its train is over the hump, a minute long, and room is won
  while (g.loco.state === "push") g.step(0.5);
  while (g.sim.bodies.some((b) => b.v > 0)) g.step(0.5);
  const t = g.sim.yard.tracks.map((x) => x.name).find((name) => g.sim.trackContents(name).cuts.length);
  assert.deepEqual(g.act("close", t), { ok: true });
  assert.match(g.act("close", t).reason, /on the locomotive's list/);
  while (!g.loco.job) g.step(0.5);
  assert.deepEqual([g.loco.job.kind, g.loco.job.track, g.loco.until - g.t], ["close", t, LOCO.close_s]);
  while (g.loco.job) g.step(0.5);
  assert.ok(g.sim.trackContents(t).end_m < 0.01 && g.sim.trackContents(t).gaps_m < 0.01 && g.logs.some((l) => new RegExp(`Track ${t} is closed up: \\d+ m won`).test(l.text)));
  assert.throws(() => g.act("setRoute", "A-G1"), /no move/);
});

test("what comes of it: a wagon left behind, a path lost, a cut fetched from the wrong track, a wagon taken round the hump", () => {
  // out on the minute: wagons that are not in stay behind, and the customer service agent counts them
  const strict = [1, 2, 3, 4].map((seed) => shift("minute", onTheMinute, seed)).find((g) => g.account().missed > 0);
  const o = strict.outbound.find((x) => x.missed > 0);
  assert.ok(o.pulled_t === o.pull && o.late_min === 0 && !o.lost, "it left at its cut-off");
  assert.ok(strict.irregulars.some((x) => x.kind === "missed" && /wagons?$/.test(x.wagons) && x.who === YARD_PEOPLE.customers.name));
  assert.ok(strict.mood("customers") < MOOD.start && strict.mood("production") === MOOD.start);
  assert.ok(strict.outbox.some((m) => m.flow === "delay-notice" && m.payload.wagons_left_behind === o.missed));
  assert.equal([...strict.wagons.values()].filter((w) => w.out === o.id && w.made === false).length, o.missed);
  // a train held beyond the three minutes of its path loses it: ten or twenty-five minutes late, and the production dispatcher phones
  // (only the first train is humped: the wagons of the others never come, and the train waits its five minutes for them)
  const late = play(oneTrain((g, d) => (d.id === "hold-51204" ? 5 : onTheMinute(g, d))), { seed: 1, until: 1000 });
  const first = late.train("51204");
  assert.deepEqual([first.lost, first.pulled_t, NEXT_PATH.min.includes(first.late_min), first.made, first.missed], [true, first.pull + 300, true, 2, 5]);
  assert.ok(late.irregulars.some((x) => x.kind === "path-lost" && x.train === "06:10 to the port" && x.who === YARD_PEOPLE.production.name));
  assert.equal(late.mood("production"), MOOD.start + MOOD.lost);
  // within the three minutes it keeps its path, and is as late as it waited
  const short = play(oneTrain((g, d) => (d.id === "hold-51204" ? 2.5 : onTheMinute(g, d))), { seed: 1, until: 800 }).train("51204");
  assert.deepEqual([short.lost, short.late_min, short.pulled_t], [false, 2.5, short.pull + 150]);
  // pushed fast: a cut in the wrong track; fetched before the next train, it stands in its own track again
  const fast = play((g, d) => (d.id.startsWith("push-") ? d.scale.max : d.id.startsWith("wrong-") ? "now" : onTheMinute(g, d)), { seed: 3, until: 900 });
  const wrong = fast.irregulars.find((x) => x.kind === "misrouted");
  assert.ok(wrong && /for track \d$/.test(wrong.cut) && wrong.track !== wrong.intended);
  assert.ok(fast.decisions.some((d) => d.id.startsWith("wrong-") && d.made === "now") && fast.logs.some((l) => /The locomotive fetches the/.test(l.text)));
  assert.ok(fast.logs.some((l) => /stands in track \d now\.$/.test(l.text)) && fast.sim.log.some((e) => e.type === "cut.moved"));
  assert.ok(fast.mood("hump") < MOOD.start);
  // the wagon that must not be humped: taken round at once it stands in track 1; the next train waits for the locomotive meanwhile
  const round = (answer) => play((g, d) => (d.id === "round-56034" ? answer : onTheMinute(g, d)), { seed: 1, until: 640 });
  const now = round("now"), later = round("free");
  const tank = (g) => [...g.wagons.values()].find((w) => w.noHump);
  // (taken round, it was in for the 06:10; left for later, it stayed behind)
  assert.deepEqual([tank(now).made, tank(later).made], [true, false]);
  assert.ok(now.sim.log.some((e) => e.type === "cut.set-out" && e.track === "1") && now.train("56058").started_t - later.train("56058").started_t >= LOCO.round_s);
});

test("the three people: the hump operator's limit, a stop of the hump, a promise to the production dispatcher and what breaks it", () => {
  // flat out: the hump operator phones; "1.4 at most" is kept by the game from then on
  const meet = play((g, d) => (d.id.startsWith("push-") ? d.scale.max : d.id === "call-hump" ? "limit" : onTheMinute(g, d)), { seed: 2, each: tidy });
  const call = meet.decisions.find((d) => d.id === "call-hump");
  assert.match(call.title, /^S\. Pirol, the hump operator, is on the phone: “/);
  assert.deepEqual([call.options.map((o) => o.id), call.made, meet.cap], [["rule", "limit", "insist"], "limit", PUSH.limit]);
  const after = meet.decisions.filter((d) => d.id.startsWith("push-") && d.at > call.at);
  for (const d of after) assert.equal(d.scale.max, PUSH.limit, d.id);
  // insisting: the next impact or wrong cut ends the operator's patience; the hump stands four minutes and is pushed at 1.0 from then on
  const stopped = [1, 2, 3, 4].map((seed) => shift("flat", flatOut, seed)).find((g) => g.irregulars.some((x) => x.kind === "hump-stopped"));
  assert.ok(stopped.cap === PUSH.auto && stopped.mood("hump") < MOOD.act);
  assert.ok(stopped.logs.some((l) => /S\. Pirol stops the hump: the retarders are inspected until/.test(l.text)));
  // the production dispatcher: after a path lost, a promise that no train waits; a longer wait breaks it
  const g = play(oneTrain((game, d) => (d.id === "hold-51204" ? 5 : d.id === "call-production" ? "promise" : d.id.startsWith("hold-") ? 2 : onTheMinute(game, d))), { seed: 1, until: 1300 });
  const p = g.promises.find((x) => x.who === "production");
  assert.deepEqual([p.what, p.kept], ["no train waits more than 0.5 min", false]);
  assert.ok(g.violations.some((v) => v.rule === "promise" && v.severity === 2 && /Promised to D\. Turna/.test(v.text)));
  assert.ok(g.irregulars.some((x) => x.kind === "promise-broken" && x.who === "D. Turna"));
  // the one who is worst off counts most
  const part = g.result().parts.find((x) => x.id === "people"), moods = Object.values(g.account().moods);
  assert.ok(Math.abs(part.value - (0.6 * Math.min(...moods) + 0.4 * (moods.reduce((s, v) => s + v, 0) / 3)) / 100) < 1e-9);
});

test("the view for a page that does not know the game: figures, tables, the moves as forms, the yard as a picture", () => {
  const g = play(computer, { seed: 1, until: 420, each: tidy });
  const v = g.view();
  assert.deepEqual(v.figures.map((f) => f.label), ["Wagons on their trains", "Pushing", "Hump operator", "Production dispatcher", "Customer service"]);
  assert.deepEqual(v.tables.map((t) => [t.id, t.rows.length, !!t.window]), [["outbound", 4, true], ["inbound", 4, false], ["people", 3, false]]);
  assert.deepEqual(v.actions.map((a) => [a.name, a.fields.map((f) => f.id)]), [["push", ["v"]], ["hold", ["train", "minutes"]], ["close", ["track"]]]);
  for (const a of v.actions) assert.ok(Object.hasOwn(YardGame.actions, a.name));
  const sk = v.sketch, tags = sk.items.filter((it) => it.kind === "tag");
  assert.equal(sk.title, "The yard");
  for (const id of ["hump", "track-1", "track-2", "track-3", "track-4", "track-5", "track-6", "train-56071"]) assert.ok(tags.some((it) => it.id === id), id);
  for (const it of sk.items) {
    for (const k of ["x", "y", "x1", "x2", "y1", "y2"]) if (it[k] != null) assert.ok(Number.isFinite(it[k]) && it[k] >= 0 && it[k] <= (k.startsWith("x") ? sk.width : sk.height), `${it.kind} ${it.id ?? ""} ${k}=${it[k]}`);
    if (it.kind === "box") assert.ok(it.x + it.w <= sk.width + 1 && it.w > 0 && it.h > 0);
  }
  // a tag's text fits in the picture
  for (const it of tags.filter((x) => x.anchor === "start")) assert.ok(it.x + it.text.length * 7.6 + 14 <= sk.width, it.text);
  // every wagon in the yard is a box; a track's tag says its cut-off and how many of its booked wagons are in
  const wagons = g.sim.bodies.reduce((n, b) => n + b.wagons.length, 0) + (g.sim.pushing?.cuts.reduce((n, c) => n + c.wagons.length, 0) ?? 0);
  assert.ok(sk.items.filter((it) => it.kind === "box").length >= wagons);
  const o = g.train("51204"), tag = tags.find((it) => it.id === "track-1");
  assert.equal(tag.text, `06:10 ${g.booked(o).length - g.missing(o).length}/7`);
  assert.match(tag.title, /^Track 1: the 06:10 to the port; \d wagons?, \d+ m free at its entrance/);
  assert.equal(tags.find((it) => it.id === "track-5").text, "sidings");
  // nothing a page offers fails: every menu move
  for (const it of g.view().sketch.items.filter((x) => x.menu)) for (const m of it.menu.filter((x) => !x.disabled)) assert.equal(typeof g.act(m.name, ...m.args).ok, "boolean", m.label);
  // while a train is pushed the hump offers faster, slower and stop; stopped, it offers to push on
  const h = play(computer, { seed: 1, until: 80 });
  const menu = () => h.view().sketch.items.find((it) => it.id === "hump").menu.map((m) => m.label);
  assert.deepEqual(menu(), ["Faster: 1.4 m/s", "Slower: 1.0 m/s", "Stop the train"]);
  h.act("push", 0);
  assert.deepEqual(menu(), ["Push on at 1.2 m/s"]);
});

test("the mission The last wagon: sound, a line for everything that does not go to plan, passed by the computer", () => {
  assert.deepEqual(validateMission(MISSION, GAMES), []);
  const m = normalizeMission(MISSION, GAMES);
  assert.deepEqual([m.roles.map((r) => [r.role, r.game, r.seat]), m.phases[0].length, m.phases[0].clock], [[["yard-master", "yard", "human"]], 2100, YardGame.clock]);
  const kinds = m.story.filter((l) => l.on).map((l) => l.on);
  assert.deepEqual([...kinds].sort(), [...YardGame.irregularities].sort());
  assert.ok(m.debrief.length >= 2 && /What you practise:/.test(m.text));
  for (const seed of [1, 2, 3]) {
    const { session, result } = testRun(MISSION, GAMES, { seed });
    const g = session.seat("yard-master").game, a = g.account();
    assert.ok(result.passed && g.over, `seed ${seed}: ${result.score}`);
    const report = g.outbox.find((x) => x.flow === "performance-report").payload;
    assert.deepEqual([report.kind, report.wagons_booked, report.wagons_on_their_trains, report.trains_out, report.score], ["yard", 26, a.made, 4, g.score().total]);
    assert.equal(g.outbox.filter((x) => x.flow === "train-report").length, OUTBOUND.length);
    assert.ok(g.outbox.some((x) => x.flow === "handling-order" && x.payload.push_mps > 0));
  }
});

test("the computer's yard master: a player like any other, and the game's own; the yard is that of the lab's table", () => {
  assert.equal(YardGame.player, YardPlayer);
  assert.deepEqual([YardGame.role, YardGame.scale, YardGame.clock, YardGame.kind], ["yard-master", "minutes", "06:00", "simulation"]);
  assert.deepEqual(YARD, { tracks: 6, track_m: 120, design: "speed", push_m: 100 });
  const g = new YardGame({ seed: 1 });
  assert.equal(g.advice("no-such-decision"), null);
  assert.equal(g.sim.yard.tracks.length, 6);
  // every track's wagons fit in it, and every wagon for a track with an outbound train is booked on it
  for (const t of g.sim.yard.tracks) assert.ok(INBOUND.reduce((n, tr) => n + (tr.groups[t.name] ?? 0), 0) <= 7, `track ${t.name}`);
  assert.equal([...g.wagons.values()].filter((w) => w.out).length, 26);
  assert.equal([...g.wagons.values()].filter((w) => w.priority).length, 5);
});
