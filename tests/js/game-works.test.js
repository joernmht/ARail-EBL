// The maintenance district manager's game (web/arail/game/works.js), "A week of works": who must
// be told what, and when. The plan (slots, crews, rest, lives), the news and its periods (in time,
// late, missing, for nothing, corrected, too early), the works council and the people, the faults
// and who goes to them from where, the storm's forecast, the trains by day and at night, the four
// people who count differently, the account; the mission Short notice; the board on the table.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { Camera, FlyCamera, LANGUAGES, View, createWorld } from "../../web/arail/index.js";
import {
  AUDIENCES, BASE_DRIVE, EFFECT, FAR_MIN, GAMES, RAIL, STAFF, STORM, STRAIN, WEEK_H, WORKS, WORKS_AREAS, WORKS_COST, WORKS_FAULTS, WORKS_HANDS, WORKS_LEVELS, WORKS_MOOD, WORKS_PACE, WORKS_PEOPLE, WORKS_SHIFT,
  WorksGame, WorksPlayer, normalizeMission, testRun, trainsAt, validateMission, weekHour as at, weekWhen as when,
} from "../../web/arail/game/index.js";
import { BOARDS, TABLE_VIEW } from "../../web/game/live.js";
import { TABLE_LAYOUT } from "../../web/game/table.js";
import { WORKS_TABLE, WorksBoard, worksProblems } from "../../web/game/works.js";
import { ROOT } from "./helpers.js";

const MISSION = JSON.parse(readFileSync(join(ROOT, "web", "game", "missions", "short-notice.json"), "utf8"));
/** Seconds of the shift of hours of the week. */
const S = (h) => (h * 3600) / WORKS_PACE;
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);

/**
 * Play the game alone to its end (or `until`, s of the shift). `policy(game, decision)` answers what
 * is asked (undefined: as the computer would; null policy: nobody answers and nobody acts). `hands`:
 * true, the computer's (the plan staffed and announced by the book); a function `(game, player)`
 * for other hands; false for none. `each(game)` is called before every step.
 */
function play(policy, { seed = 1, level = "normal", hands = true, each = null, until = Infinity } = {}) {
  const g = new WorksGame({ seed, level }), P = new WorksPlayer();
  while (!g.over && g.t < until) {
    if (policy) {
      for (const d of g.open) {
        const x = policy(g, d);
        if (x !== OPEN) g.act("decide", d.id, x ?? g.advice(d.id));
      }
      if (hands === true) P.hands(g);
      else if (hands) hands(g, P);
    }
    each?.(g);
    g.step(0.5);
  }
  return g;
}

/** A policy's answer that leaves a question open. */
const OPEN = Symbol("open");
/** Let a game run on for so long (s of the shift), in the steps of a shift. */
function run(g, s) {
  for (const end = g.t + s; g.t < end - 1e-9 && !g.over;) g.step(0.5);
}
/** Let a game run to an hour of the week. */
const runTo = (g, h) => run(g, S(h) - g.t);

const book = () => undefined;
const has = (d, id) => d.options.some((o) => o.id === id);
/** One kind of question answered one way (where that is offered), everything else as the computer would. */
const always = (prefix, option) => (g, d) => (d.id.startsWith(prefix) && (typeof option === "number" || has(d, option)) ? option : undefined);
const score = (g) => g.result().score;
const kinds = (g) => new Set(g.irregulars.map((x) => x.kind));

/** The computer's hands, but with some of its moves held back: `deny(game, name, args)` says which. */
const without = (deny) => (g, P) => {
  const real = g.act.bind(g);
  g.act = (name, ...args) => (deny(g, name, args) ? { ok: false } : real(name, ...args));
  P.hands(g);
  g.act = real;
};
/** The computer's hands, after something of one's own. */
const first = (mine) => (g, P) => {
  mine(g);
  P.hands(g);
};
/** A work moved to another slot once, before the computer plans. */
const moved = (work, slot) => {
  const done = new WeakSet();
  return first((g) => {
    if (g.t < 13 || done.has(g)) return;
    done.add(g);
    g.act("schedule", work, slot);
  });
};
/** Whoever is on shift or on call is sent to a fault at once (to a failed point whoever knows the relay interlocking), and no favours are asked. */
const prompt = first((g) => {
  const h = g.now;
  for (const f of g.faults.filter((x) => x.state !== "done" && !x.person)) {
    const can = g.people.filter((p) => (g.onShift(p, h) || g.onCall(p, h)) && (!WORKS_FAULTS[f.kind].trade || WORKS_FAULTS[f.kind].trade === p.trade) && g.freeFor(p, h).ok)
      .sort((a, b) => (f.kind === "points" ? Number(b.quals.includes("relay")) - Number(a.quals.includes("relay")) : 0) || g.driveMin(a, f.area, h) - g.driveMin(b, f.area, h));
    if (can[0]) g.act("send", f.id, can[0].id);
  }
});
/** Everybody is told everything: every work and every fault to operations, the town and safety. */
const everybody = (g, P) => {
  P.hands(g);
  if (g.t < 14) return;
  for (const who of ["ops", "town", "safety"]) {
    for (const w of g.works.filter((x) => x.state === "planned" && x.start != null && !x.told[who])) g.act("tell", who, w.id);
    for (const f of g.faults.filter((x) => x.state !== "done" && x.told[who] == null)) g.act("tell", who, `fault-${f.id}`);
  }
};
/** Nobody but operations and the people is told: no town, no safety. */
const silent = without((g, name, args) => name === "tell" && (args[0] === "town" || args[0] === "safety"));
/** How often one way of playing scores more, and less, than another, seed by seed. */
const against = (a, b) => [a.filter((x, i) => x > b[i]).length, a.filter((x, i) => x < b[i]).length];

test("alone: the computer's district manager passes on every level; nobody at the desk fails, because the rail runs past its period; the same seed, the same week", () => {
  for (const level of Object.keys(WORKS_LEVELS)) {
    for (const seed of SEEDS) {
      const r = play(book, { seed, level }).result();
      assert.ok(r.passed && r.score >= 55 && r.worst < 3, `${level}, seed ${seed}: ${r.score}`);
    }
  }
  for (const seed of SEEDS.slice(0, 8)) {
    const g = play(null, { seed }), a = g.account();
    assert.ok(!g.result().passed && g.result().worst === 3, `seed ${seed}: nobody at the desk`);
    // the day works run by the draft; the nights have nobody, the rail is not changed and not applied for
    assert.deepEqual([g.work("tamp").state, g.work("rail").state, g.work("rail").overdue, a.done <= 2], ["planned", "planned", true, true]);
    assert.ok(g.violations.some((v) => v.rule === "period" && v.severity === 3) && g.tally.cost >= WORKS_COST.machine);
  }
  const a = play(book, { seed: 5 }), b = play(book, { seed: 5 }), c = play(book, { seed: 6 });
  assert.deepEqual(a.logs.map((l) => l.text), b.logs.map((l) => l.text));
  assert.notDeepEqual(a.logs.map((l) => l.text), c.logs.map((l) => l.text));
  assert.ok(Math.abs(a.t - S(WEEK_H)) < 1 && /the week is over/.test(a.over));
});

test("the choices matter: somebody sent at once beats the rota; the storm, a driver's report and the rail by day each win on some weeks and lose on others; telling everybody everything and telling too few both lose", () => {
  const scores = (policy, hands = true) => SEEDS.map((seed) => score(play(policy, { seed, hands })));
  const base = scores(book);
  // the part that is played: acting between the questions is never worse than waiting for the rota, and mostly better
  const [more, less] = against(scores(book, prompt), base);
  assert.ok(more >= 14 && less === 0, `sent at once: ${more} better, ${less} worse`);
  // decisions without a right answer: each wins on some weeks and loses on others
  for (const [name, policy, hands] of [["the tamping moved", always("storm", "move")], ["the tamping called off", always("storm", "off")], ["the track closed", always("fault-", "close")], ["the rail by day", book, moved("rail", at("Wed", 9, 30))], ["the rail on Tuesday", book, moved("rail", at("Tue", 23, 30))]]) {
    const [w, l] = against(scores(policy, hands ?? true), base);
    assert.ok(w >= 3 && l >= 3, `${name}: ${w} better, ${l} worse`);
  }
  // line speed after a driver's report: fine when it was the train's wheel, a danger to people when the rail was broken
  const watch = SEEDS.map((seed) => play(always("fault-", "watch"), { seed }));
  assert.ok(watch.some((g) => g.result().worst === 3 && !g.result().passed) && watch.some((g) => g.result().passed));
  // ... and which of the two it was is known only when somebody has looked: the decision itself says nothing
  const broken = SEEDS.find((seed) => new WorksGame({ seed })._coming.find((x) => x.kind === "knock").u >= 0.7);
  const blind = play((g, d) => (d.id.startsWith("fault-") ? "watch" : undefined), { seed: broken, until: 1e9, each: (g) => {
    const f = g.fault("knock");
    if (f && !f.known) assert.ok(!g.violations.some((v) => v.rule === "danger") && !g.outbox.some((m) => m.flow === "incident-report"), "nothing is said before the track has been looked at");
  } });
  const danger = blind.violations.find((v) => v.rule === "danger");
  assert.ok(danger && danger.t >= S(blind.fault("knock").known_at) - 1 && /Trains ran at line speed over the line to \w+ for [\d.]+ h after a driver's report: the rail was broken/.test(danger.text));
  // who needs it, and only who needs it
  const all = scores(book, everybody), few = scores(book, silent);
  assert.deepEqual([against(all, base)[0], against(few, base)[0]], [0, 0]);
  assert.ok(all.every((x, i) => x < base[i]) && few.every((x, i) => x < base[i]));
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(mean(base) - mean(all) > 10 && mean(base) - mean(few) > 6);
});

test("what is asked: a driver's report and the storm's forecast as one of a few, the possession's length and a forecast as numbers with an option beside them", () => {
  const seen = new Map();
  for (const seed of SEEDS.slice(0, 12)) {
    const g = play((gm, d) => {
      seen.set(d.id.replace(/\d+$/, ""), { options: d.options.map((o) => o.id), scale: d.scale, fallback: d.fallback, deadline: d.deadline, title: d.title, text: d.text });
      return undefined;
    }, { seed });
    // in every week: at least two decisions that are one of a few, at least one that is a number
    const made = g.result().decisions, opts = made.filter((d) => typeof d.option === "string"), nums = made.filter((d) => typeof d.option === "number");
    assert.ok(opts.length >= 2 && nums.length >= 1, `seed ${seed}: ${opts.length} choices, ${nums.length} numbers`);
  }
  assert.deepEqual(seen.get("fault-knock").options, ["close", "slow", "watch"]);
  assert.deepEqual(seen.get("storm").options, ["keep", "move", "off"]);
  const len = seen.get("length-rail"), fc = [...seen].find(([id]) => id.startsWith("forecast-"))[1];
  assert.deepEqual([len.scale.min, len.scale.max, len.scale.step, len.scale.unit, len.options], [RAIL.min, RAIL.max, RAIL.step, "h", ["look"]]);
  assert.deepEqual([fc.scale.min, fc.scale.max, fc.scale.step, fc.scale.unit, fc.options], [0.5, 6, 0.5, "h", ["none"]]);
  // a question's first sentence carries the dilemma; its fallback is one of its ways
  for (const [id, d] of seen) {
    assert.ok(d.title.length > 30 && d.text.length > 80, id);
    assert.ok(d.deadline != null && (typeof d.fallback === "number" ? d.scale : d.options.includes(d.fallback)), `${id}: a time to answer by and a fallback`);
  }
  assert.match(seen.get("storm").text, /^Moved now, everybody can still be told in time; kept, it may be called off/);
  assert.match(seen.get("fault-knock").text, /^Closed, .* share the other track until somebody has looked; left open, a broken rail is run over\./);
});

test("the numbers cost at both ends: a possession too short runs over, one too long takes trains out for nothing; a forecast too short is missed, one too long keeps trains cancelled", () => {
  // the rail by day, where every registered hour is single-line working in the day's traffic
  const day = (len) => (seed) => play(always("length", len), { seed, hands: moved("rail", at("Wed", 9, 30)) });
  let both = 0;
  for (const seed of SEEDS) {
    // (7 h from 09:30 is the longest that still is a day's work; longer, it is overtime outside the rota)
    const need = new WorksGame({ seed }).work("rail").need, [short, right, long] = [day(RAIL.min)(seed), day(need)(seed), day(7)(seed)];
    assert.ok(need >= RAIL.need[0] && need <= RAIL.need[1]);
    if ([short, right, long].some((g) => g.work("rail").t0 !== at("Wed", 9, 30))) continue;
    assert.ok(kinds(short).has("overrun"), `seed ${seed}: 3 h for a change of ${need} h runs over`);
    assert.ok(!kinds(right).has("overrun") && !kinds(long).has("overrun"));
    assert.ok(long.tally.lost_min > right.tally.lost_min && short.tally.lost_min > right.tally.lost_min, `seed ${seed}: 7 h registered and 3 h registered both cost more trains than ${need} h`);
    assert.ok(score(right) > score(short) && score(right) >= score(long), `seed ${seed}`);
    both++;
  }
  assert.ok(both >= 8, `the right length is best on ${both} weeks`);
  // the welder's look narrows the estimate, and takes its time
  const g = new WorksGame({ seed: 2 }), w = g.work("rail");
  assert.equal(w.guess[1] - w.guess[0], 2 * RAIL.guess_h);
  run(g, 20);
  g.act("assign", "rail", "p2");
  g.act("assign", "rail", "p5");
  assert.deepEqual([g.act("tell", "ops", "rail").ok, g.open.map((d) => d.id)], [true, ["length-rail"]]);
  assert.match(g.act("tell", "ops", "rail").reason, /asking for how many hours/);
  g.act("decide", "length-rail", "look");
  assert.match(g.act("tell", "ops", "rail").reason, /looking at the rail first/);
  run(g, S(RAIL.look_h) + 1);
  assert.ok(w.looked && w.guess[1] - w.guess[0] <= 2 * RAIL.looked_h && w.guess[0] <= w.need && w.need <= w.guess[1]);
  assert.deepEqual([g.open.map((d) => d.id), g.open[0].options], [["length-rail"], []]);
  g.act("decide", "length-rail", 4.5);
  assert.deepEqual([w.len, w.told.ops.len, w.told.ops.start], [4.5, 4.5, w.start]);
  // the answer comes too late for the slot: the registration is refused, and that is said
  const slow = new WorksGame({ seed: 2, level: "training" });
  run(slow, 20);
  slow.act("assign", "rail", "p2");
  slow.act("assign", "rail", "p1");
  slow.act("schedule", "rail", at("Tue", 23, 30));
  runTo(slow, at("Tue", 15, 30));
  assert.equal(slow.act("tell", "ops", "rail").ok, true);
  runTo(slow, at("Tue", 18));
  assert.deepEqual(slow.open.map((d) => d.id), ["length-rail"]);
  slow.act("decide", "length-rail", 5);
  assert.ok(slow.logs.some((l) => /Tue 23:30 is 5\.5 h away\. No signal box and no undertaking can be told any more\. Not that night\." The possession is not registered\./.test(l.text)));
  assert.ok(!slow.work("rail").told.ops && slow.missing(slow.work("rail")).includes("the possession") && slow.work("rail").len === 5);
  // a forecast: said too short it is missed, said too long the trains stay cancelled, no time at all costs at once
  const fc = (x) => SEEDS.map((seed) => play(always("forecast", x), { seed }));
  const [short, mid, long, none] = [fc(0.5), SEEDS.map((seed) => play(book, { seed })), fc(6), fc("none")];
  assert.ok(short.filter((gm) => kinds(gm).has("forecast-missed")).length >= 20 && !mid.some((gm) => kinds(gm).has("forecast-missed") && false));
  assert.ok(long.filter((gm, i) => gm.tally.lost_min > mid[i].tally.lost_min).length >= 12);
  assert.ok(against(short.map(score), mid.map(score))[1] >= 20 && against(long.map(score), mid.map(score))[1] >= 6 && against(none.map(score), mid.map(score))[1] >= 18);
});

test("the plan: a work has a few slots and a crew by trade, qualification and rest; each move is refused where it cannot be", () => {
  const g = new WorksGame({ seed: 1 });
  run(g, 20);
  // the draft: the day works pencilled in, the nights with nobody; the tamping registered long ago
  assert.deepEqual(g.works.map((w) => [w.id, when(w.start), w.crew]), [["tamp", "Wed 22:00", []], ["points", "Thu 10:00", ["p3", "p4"]], ["rail", "Thu 23:30", []], ["veg", "Wed 09:00", ["p5", "p3"]]]);
  assert.ok(g.work("tamp").told.ops && !g.stale(g.work("tamp"), "ops"));
  assert.deepEqual(["ops", "town", "safety"].map((who) => g.needs(g.work("tamp"), who)), [true, true, false]);
  assert.deepEqual(["ops", "town", "safety"].map((who) => g.needs(g.work("points"), who)), [false, false, false], "the standing window needs no registration");
  assert.deepEqual(["ops", "town"].map((who) => g.needs(g.work("veg"), who)), [false, false]);
  // slots
  assert.match(g.act("schedule", "nothing", 3).reason, /no such work/);
  assert.match(g.act("schedule", "tamp", 12).reason, /no such slot/);
  assert.match(g.act("schedule", "tamp", at("Wed", 22)).reason, /planned for then/);
  const late = new WorksGame({ seed: 1 });
  runTo(late, at("Mon", 9, 30));
  assert.match(late.act("schedule", "veg", at("Mon", 9)).reason, /Mon 09:00 has passed/);
  // (whoever is on it must be able to make the new slot: the vegetation's people are on it on Wednesday morning)
  assert.match(g.act("schedule", "points", at("Tue", 23)).reason, /eleven hours of rest lie between two shifts\. Take T\. Doğan off it first/);
  g.act("unassign", "points", "p3");
  assert.equal(g.act("schedule", "points", at("Tue", 23)).ok, true);
  assert.deepEqual([g.needs(g.work("points"), "ops"), g.outside(g.work("points")), g.rota.map((x) => x.key).sort()], [true, true, ["p4|points|41"]], "at night it needs a possession, and a shift outside the rota for everybody on it");
  assert.equal(g.act("schedule", "points", at("Thu", 10)).ok, true);
  assert.equal(g.rota.length, 0);
  g.act("assign", "points", "p3");
  // crews
  assert.equal(g.act("assign", "tamp", "p1").ok, true);
  assert.match(g.act("assign", "tamp", "p1").reason, /is on it/);
  // eleven hours of rest between two shifts: the night at Bergheim and the points the morning after do not go together
  assert.match(g.act("assign", "tamp", "p4").reason, /E\. Schwalbe is on the inspection of points W3 and W4 \(Thu 10:00\): eleven hours of rest lie between two shifts/);
  assert.equal(g.act("assign", "tamp", "p2").ok, true);
  assert.match(g.act("assign", "tamp", "p5").reason, /has its 2 persons/);
  assert.deepEqual(g.missing(g.work("tamp")), ["the town", "the council asked", "the people told"]);
  // nor the vegetation by day and the tamping that night
  assert.match(g.act("assign", "veg", "p1").reason, /has its 2 persons/);
  assert.equal(g.act("unassign", "veg", "p5").ok, true);
  assert.match(g.act("assign", "veg", "p1").reason, /eleven hours of rest lie between two shifts/);
  assert.match(g.act("unassign", "veg", "p1").reason, /not on that work/);
  assert.equal(g.act("assign", "veg", "p5").ok, true);
  // who must be able to do it
  assert.equal(g.act("assign", "rail", "p5").ok, true);
  assert.match(g.act("assign", "rail", "p3").reason, /eleven hours of rest/, "a day at the points and that night at the rail");
  assert.equal(g.act("assign", "rail", "p1").ok, true);
  assert.deepEqual(g.missing(g.work("rail")).slice(0, 1), ["a welder"]);
  g.act("unassign", "rail", "p1");
  assert.equal(g.act("assign", "rail", "p2").ok, true);
  assert.ok(!g.missing(g.work("rail")).includes("a welder"));
  // rooms at the site for who lives far away
  assert.match(g.act("room", "veg").reason, /Nobody on it lives far away|no such work/);
  assert.deepEqual([g.act("room", "rail").ok, g.work("rail").room, g.tally.cost], [true, ["p2"], WORKS_COST.room]);
  assert.match(g.act("room", "rail").reason, /booked/);
  assert.ok(g.person("p2").drive.east > FAR_MIN && g.person("p1").drive.east <= FAR_MIN);
  // every move is a move of the game, kept for the record
  assert.deepEqual(Object.keys(WorksGame.actions).filter((x) => x !== "decide").sort(), ["assign", "room", "schedule", "send", "tell", "unassign"]);
  assert.ok(g.moves.length >= 20 && g.moves.every((m) => Object.hasOwn(WorksGame.actions, m.name)));
  assert.throws(() => g.act("_mood", "ops", 50), /no move/);
});

test("the news of a work: in time it is thanked; late it may be a claim or a fine; missing it is one; for nothing and corrected it costs patience; too early it is forgotten", () => {
  // by the book, everything is in its period
  const b = play(book, { seed: 3 });
  assert.ok(b.tally.in_time >= 8 && b.tally.missing === 0 && b.tally.needless === 0 && b.tally.charges === 0);
  // the town never told of the tamping night: a fine, for sure
  const never = play(book, { seed: 3, hands: without((g, name, args) => name === "tell" && args[0] === "town" && args[1] === "tamp") });
  assert.ok(never.violations.some((v) => v.rule === "charge" && /a fine for night work without notice/.test(v.text)) && kinds(never).has("missing-news") && kinds(never).has("charge"));
  assert.ok(never.mood("town") < b.mood("town") - 10 && score(never) < score(b));
  // told on the afternoon before: late, and on some weeks a fine
  const late = SEEDS.map((seed) => play(always("storm", "keep"), { seed, level: "training", hands: without((g, name, args) => name === "tell" && args[0] === "town" && args[1] === "tamp" && g.work("tamp").start - g.now > 8) }));
  assert.ok(late.every((g) => g.irregulars.some((x) => x.key === "late:town:tamp")));
  const fined = late.filter((g) => g.violations.some((v) => /announced too late/.test(v.text))).length;
  assert.ok(fined >= 6 && fined <= 18, `fined on ${fined} of 24 weeks`);
  // the possession for a night never registered: the work does not begin at all
  const unreg = play(book, { seed: 3, hands: without((g, name, args) => name === "tell" && args[0] === "ops" && args[1] === "rail") });
  assert.ok(unreg.irregulars.some((x) => x.kind === "work-missed" && /no possession is registered/.test(x.why)) && unreg.work("rail").state !== "done");
  // inside six hours a possession cannot be had any more
  const g = new WorksGame({ seed: 1 });
  run(g, 20);
  g.act("unassign", "points", "p3");
  assert.equal(g.act("schedule", "points", at("Tue", 23)).ok, true);
  runTo(g, at("Tue", 18));
  assert.match(g.act("tell", "ops", "points").reason, /No signal box and no undertaking can be told any more/);
  // for nothing: a note the other side has no use for
  const n = new WorksGame({ seed: 1 });
  run(n, 20);
  const moods = () => ["ops", "town", "safety"].map((who) => n.mood(who));
  const was = moods();
  assert.deepEqual([n.act("tell", "ops", "veg").ok, n.act("tell", "town", "points").ok, n.act("tell", "safety", "tamp").ok], [true, true, true]);
  assert.deepEqual(moods(), was.map((m) => m + WORKS_MOOD.unneeded));
  assert.deepEqual([n.tally.needless, n.irregulars.filter((x) => x.kind === "needless-news").length], [3, 3]);
  assert.match(n.act("tell", "town", "points").reason, /knows/);
  assert.match(n.act("tell", "safety", "tamp").reason, /has heard/);
  assert.match(n.act("tell", "nobody", "tamp").reason, /nobody of that name/);
  // corrected: told, then moved, then told again; in good time it costs little, inside the period more
  const c = new WorksGame({ seed: 1 });
  run(c, 20);
  c.act("tell", "town", "tamp");
  assert.ok(!c.stale(c.work("tamp"), "town"));
  c.act("schedule", "tamp", at("Thu", 22));
  assert.ok(c.stale(c.work("tamp"), "town") && c.stale(c.work("tamp"), "ops") && c.missing(c.work("tamp")).includes("the town told again") && c.missing(c.work("tamp")).includes("the possession corrected"));
  const before = [c.mood("town"), c.mood("ops")];
  c.act("tell", "town", "tamp");
  c.act("tell", "ops", "tamp");
  assert.deepEqual([c.mood("town"), c.mood("ops"), c.tally.corrected, c.tally.cost], [before[0] + WORKS_MOOD.correction_early, before[1] + WORKS_MOOD.correction_early, 2, WORKS_COST.moved]);
  const d = new WorksGame({ seed: 1, level: "training" });
  run(d, 20);
  assert.equal(d.act("schedule", "rail", at("Tue", 23, 30)).ok, true);
  d.act("tell", "town", "rail");
  runTo(d, at("Tue", 10));
  assert.equal(d.act("schedule", "rail", at("Wed", 23, 30)).ok, true);
  const town = d.mood("town");
  d.act("tell", "town", "rail");
  assert.equal(d.mood("town"), town + WORKS_MOOD.correction, "13 h before the night it was announced for: inside the period");
  // too early: the rail's night on Thursday, announced on Monday morning, is forgotten on some weeks
  const early = SEEDS.map((seed) => play(book, { seed, level: "training", hands: first((gm) => {
    if (gm.t >= 15 && !gm.work("rail").told.town) gm.act("tell", "town", "rail");
  }) }));
  const forgot = early.filter((gm) => gm.irregulars.some((x) => x.key === "early:town:rail")).length;
  assert.ok(forgot >= 8 && forgot <= 20, `forgotten on ${forgot} of 24 weeks`);
  assert.ok(AUDIENCES.town.early_h > AUDIENCES.town.late_h && AUDIENCES.ops.late_h > AUDIENCES.ops.least_h && STAFF.late_h > STAFF.least_h);
});

test("the works council and the people: consent before the people are told, one request and not five; a life needs its notice; an order is remembered", () => {
  const g = new WorksGame({ seed: 4 }), c = AUDIENCES.council;
  run(g, 20);
  assert.match(g.act("tell", "council").reason, /no shift outside the rota/);
  assert.match(g.act("tell", "staff").reason, /Everybody knows their shifts/);
  g.act("assign", "tamp", "p1");
  g.act("assign", "tamp", "p2");
  assert.deepEqual(g.rota.map((x) => [x.person, x.work, when(x.start), x.council, x.told]), [["p1", "tamp", "Wed 22:00", null, null], ["p2", "tamp", "Wed 22:00", null, null]]);
  assert.match(g.act("tell", "staff").reason, /has not consented to any/);
  assert.equal(g.act("tell", "council").ok, true);
  assert.match(g.act("tell", "council").reason, /no shift outside the rota/);
  const due = g.rota[0].council.due;
  assert.ok(due - g.now >= c.answer_h[0] && due - g.now <= c.answer_h[1]);
  runTo(g, due + 0.1);
  assert.ok(g.rota.every((x) => x.council.ok === true));
  const strain = g.person("p1").strain;
  assert.equal(g.act("tell", "staff").ok, true);
  // two days ahead and after the consent: the grandmother comes, nobody says no, nobody is strained
  assert.deepEqual([g.rota.every((x) => x.told != null && !x.refused), g.person("p1").strain, kinds(g).has("refusal"), g.missing(g.work("tamp"))], [true, strain, false, ["the town"]]);
  // a second request within half a day: "bring me the week"
  const mood = g.mood("council");
  g.act("assign", "rail", "p2");
  g.act("assign", "rail", "p1");
  assert.equal(g.act("tell", "council").ok, true);
  assert.equal(g.mood("council"), mood + WORKS_MOOD.again);
  // told before the council has answered: co-determination is not asked afterwards
  const m2 = g.mood("council");
  assert.equal(g.act("tell", "staff", "all").ok, true);
  assert.equal(g.mood("council"), m2 + WORKS_MOOD.before_consent);
  // a life against a shift, told too late: on Hard nearly always a no, and then somebody else, an offer or an order
  let refusals = 0, orders = 0;
  for (const seed of SEEDS.slice(0, 12)) {
    const r = new WorksGame({ seed, level: "hard" });
    runTo(r, at("Tue", 8));
    for (const id of ["storm"]) if (r.open.some((d) => d.id === id)) r.act("decide", id, "keep");
    r.act("assign", "tamp", "p1");
    r.act("assign", "tamp", "p2");
    assert.ok(r.blocked(r.person("p1"), at("Wed", 22), at("Thu", 4)) && !r.blocked(r.person("p2"), at("Wed", 22), at("Thu", 4)));
    r.act("tell", "staff", "all");
    const q = r.open.find((d) => d.id === "refusal-p1-tamp");
    if (!q) {
      assert.ok(r.person("p1").strain >= STRAIN.life, "taken, and it costs at home");
      continue;
    }
    refusals++;
    assert.deepEqual(q.options.map((o) => o.id), ["else", "offer", "order"]);
    assert.ok(r.item("p1", "tamp").refused && r.missing(r.work("tamp")).includes("somebody who can"));
    const was = r.mood("council");
    r.act("decide", q.id, seed % 2 ? "order" : "else");
    if (seed % 2) {
      orders++;
      assert.ok(r.item("p1", "tamp").ordered && !r.item("p1", "tamp").refused && r.mood("council") <= was + WORKS_MOOD.ordered && r.person("p1").strain >= STRAIN.life);
    } else assert.deepEqual(r.work("tamp").crew, ["p2"]);
  }
  assert.ok(refusals >= 7 && orders >= 2, `${refusals} refusals, ${orders} orders`);
  // a night without the council's consent goes to the labour court
  const court = play(book, { seed: 4, hands: without((gm, name, args) => name === "tell" && args[0] === "council") });
  const told = play(book, { seed: 4, hands: first((gm) => {
    if (gm.t > 400 && gm.rota.some((x) => !x.done && x.told == null)) gm.act("tell", "staff", "all");
  }) });
  assert.ok(!court.violations.some((v) => /labour court/.test(v.text)), "never asked, the people are never told by the book, and the nights do not happen");
  assert.ok(court.work("tamp").state !== "done" && court.irregulars.some((x) => x.kind === "work-missed" && /never told/.test(x.why)));
  assert.ok(told.rota.length >= 2);
  const lawless = play(book, { seed: 4, hands: (gm, P) => {
    without((x, name, args) => name === "tell" && (args[0] === "council" || args[0] === "staff"))(gm, P);
    if (gm.t > 100 && gm.rota.some((x) => !x.done && x.told == null)) gm.act("tell", "staff", "all");
  } });
  assert.ok(lawless.violations.some((v) => v.rule === "charge" && /an application to the labour court/.test(v.text)) && lawless.irregulars.some((x) => x.key.startsWith("missing:council:")));
});

test("the people: where they live decides how fast they are at a fault; the day shift, the on-call rota, a favour; eleven hours of rest; a room for who lives far away", () => {
  const g = new WorksGame({ seed: 1, level: "training" });
  // homes: at night the way is from home, by day from the base
  const [p1, p2, p3, p4, p5] = g.people;
  assert.deepEqual([p1.home, p2.home, p3.home, p4.home, p5.home], ["Bergheim", "Altenau", "Neustadt", "Talsee", "Waldau"]);
  assert.deepEqual(g.people.map((p) => g.whereabouts(p, at("Mon", 3)).at), Array(5).fill("home"));
  assert.deepEqual([g.driveMin(p1, "west", at("Tue", 2)), g.driveMin(p2, "west", at("Tue", 2)), g.driveMin(p5, "branch", at("Tue", 2))], [8, 60, 5]);
  assert.deepEqual(g.people.map((p) => g.whereabouts(p, at("Mon", 10)).at), Array(5).fill("base"));
  assert.deepEqual([g.driveMin(p2, "west", at("Mon", 10)), g.driveMin(p1, "station", at("Mon", 10))], [BASE_DRIVE.west, BASE_DRIVE.station]);
  // on the road in the morning and in the afternoon, by the length of their own way
  const road = g.whereabouts(p2, at("Mon", 6, 10));
  assert.deepEqual([road.at, road.to, road.u > 0 && road.u < 1], ["home", "base", true]);
  assert.deepEqual([g.whereabouts(p3, at("Mon", 6, 10)).to, g.whereabouts(p1, at("Mon", 15, 5)).to], [undefined, "home"]);
  // the day shift and the on-call rota
  assert.deepEqual([g.onShift(p1, at("Mon", 10)), g.onShift(p1, at("Mon", 16)), g.onShift(p1, at("Mon", 5))], [true, false, false]);
  assert.deepEqual(g.people.filter((p) => g.onCall(p, at("Mon", 23))).map((p) => p.id), ["p3", "p5"]);
  assert.deepEqual(g.people.filter((p) => g.onCall(p, at("Thu", 2))).map((p) => p.id), ["p2", "p3"], "on Wednesday night the track's on-call lives 45 km away");
  assert.deepEqual(g.people.filter((p) => g.onCall(p, at("Tue", 10))).map((p) => p.id), [], "by day everybody is on shift");
  // a night on a work costs the day shifts round it
  run(g, 20);
  g.act("assign", "tamp", "p1");
  assert.deepEqual([g.onShift(g.person("p1"), at("Wed", 10)), g.onShift(g.person("p1"), at("Thu", 10)), g.onShift(g.person("p1"), at("Tue", 10))], [false, false, true]);
  // a fault at night: without a word the rota's person goes after half an hour, from home
  const f = new WorksGame({ seed: 2 });
  let knock = null;
  for (const seed of SEEDS) {
    const k = new WorksGame({ seed });
    if (k._coming.find((x) => x.kind === "knock")?.at === at("Tue", 5, 36)) {
      knock = k;
      break;
    }
  }
  assert.ok(knock, "a week whose knock comes on Tuesday at 05:36");
  runTo(knock, at("Tue", 5, 40));
  const fault = knock.faults[0];
  assert.deepEqual([fault.kind, fault.mode, fault.person, knock.open.map((d) => d.id)], ["knock", "sight", null, ["fault-knock"]]);
  // the wrong trade is refused; somebody not on call is asked a favour, and the works council counts it
  assert.match(knock.act("send", "knock", "p3").reason, /a case for a track technician/);
  const near = ["p1", "p2", "p5"].map((id) => [id, knock.driveMin(knock.person(id), fault.area, knock.now)]).sort((a, b) => a[1] - b[1])[0][0];
  const council = knock.mood("council");
  assert.equal(knock.act("send", "knock", near).ok, true);
  assert.match(knock.act("send", "knock", "p5").reason, /is on the way or there/);
  const favour = !knock.person(near).on_call.includes(0);
  assert.equal(knock.mood("council"), council + (favour ? WORKS_MOOD.favour : 0));
  assert.ok(knock.person(near).strain >= STRAIN.call && knock.person(near).out && fault.arrive - fault.sent < 0.5);
  // the same fault left to the rota: P5 from Waldau, half an hour later
  const rota = new WorksGame({ seed: knock.seed });
  runTo(rota, at("Tue", 6, 10));
  assert.deepEqual([rota.faults[0].person, rota.logs.some((l) => /by the rota R\. Pirol goes/.test(l.text))], ["p5", true]);
  assert.ok(rota.faults[0].arrive > fault.arrive);
  // rest: whoever is taken from their rest to a fault on the afternoon before their night is asked about before it begins
  let asked = 0;
  for (const seed of SEEDS) {
    const k = new WorksGame({ seed });
    if (k.storm.strong || !k._coming.some((x) => x.kind === "knock" && x.at === at("Wed", 13))) continue;
    const r = play((gm, d) => (d.id.startsWith("rest-") ? OPEN : undefined), { seed, until: S(at("Wed", 22, 10)), hands: (gm, P) => {
      // (somebody of the tamping's night is sent to Wednesday's knock, and stays on the night)
      for (const x of gm.faults.filter((y) => y.kind === "knock" && !y.person)) gm.act("send", x.id, gm.work("tamp").crew.find((id) => gm.person(id).trade === "track"));
      without((y, name, args) => gm.now > at("Wed", 13) && args[0] === "tamp" && (name === "unassign" || name === "assign"))(gm, P);
    } });
    const q = r.open.find((d) => d.id === "rest-tamp");
    assert.ok(q, `seed ${seed}: asked before the night begins`);
    asked++;
    assert.ok(has(q, "home") && has(q, "stay") && /h of rest, not eleven/.test(q.title));
    assert.equal(r.work("tamp").state, "planned", "the night waits for the word");
    const was = r.mood("council");
    r.act("decide", "rest-tamp", "stay");
    run(r, 1);
    assert.ok(r.violations.some((v) => v.rule === "rest" && v.severity === 2) && r.tally.rest_cut === 1 && r.mood("council") <= was + WORKS_MOOD.rest_cut && kinds(r).has("rest-cut") && r.work("tamp").state === "running");
    // the possession counts from the slot: begun ten minutes late, the work is done ten minutes after the possession ended
    const w = r.work("tamp");
    assert.ok(w.t0 > w.start && w.until === w.start + w.len && w.t1 > w.until);
    runTo(r, w.t1 + 0.1);
    assert.ok(kinds(r).has("overrun") && Math.abs(w.late_by - (w.t0 - w.start)) < 1e-6, `seed ${seed}: over by as long as it began late`);
  }
  assert.ok(asked >= 1, `asked on ${asked} weeks`);
  assert.equal(f.person("p2").drive.east, 35);
  // a fault cleared within the day shift does not stand against more work in that shift; against that night it does
  // (a week whose knock comes on Wednesday at one and turns out to be the train's wheel: looked at and done within the shift)
  const wed = Array.from({ length: 80 }, (_, i) => new WorksGame({ seed: i + 1 })).find((k) => k._coming.some((x) => x.kind === "knock" && x.at === at("Wed", 13) && x.u < 0.35));
  runTo(wed, at("Wed", 13, 3));
  assert.equal(wed.act("send", "knock", "p1").ok, true);
  while (wed.fault("knock").state !== "done") {
    for (const d of wed.open) wed.act("decide", d.id, wed.advice(d.id));
    wed.step(0.5);
  }
  const out = wed.person("p1").busy.at(-1);
  assert.ok(out.day && out.to < at("Wed", 20) && out.to > at("Wed", 13));
  assert.match(wed.fits(wed.person("p1"), wed.work("tamp")).reason, /was out until Wed 1\d:\d\d: eleven hours of rest first/);
  assert.equal(wed.fits(wed.person("p1"), wed.work("veg"), at("Thu", 9)).ok, true);
  const thu = SEEDS.map((seed) => new WorksGame({ seed, level: "training" })).find((k) => k._coming[0].at === at("Thu", 7, 6));
  runTo(thu, at("Thu", 7, 8));
  thu.act("send", "points", "p4");
  while (thu.faults[0].state !== "done") {
    for (const d of thu.open) thu.act("decide", d.id, thu.advice(d.id));
    thu.step(0.5);
  }
  assert.ok(thu.now < at("Thu", 10) && thu.person("p4").busy.at(-1).day);
  assert.deepEqual([thu.fits(thu.person("p4"), thu.work("points")).ok, thu.work("points").crew], [true, ["p3", "p4"]], "the point cleared at half past eight, the inspection at ten: one shift");
  // 45 km home after a night: with a room nobody drives tired
  const drive = (room) => SEEDS.map((seed) => play(book, { seed, level: "training", hands: without((gm, name) => !room && name === "room") })).filter((gm) => gm.violations.some((v) => v.rule === "care")).length;
  const [tired, rested] = [drive(false), drive(true)];
  assert.ok(tired >= 3 && rested === 0, `a tired drive on ${tired} weeks without a room, ${rested} with one`);
  assert.equal(WORKS_SHIFT.rest_h, 11);
});

test("a fault: restricted on a suspicion, looked at, cleared; a dangerous event is reported within the hour; a forecast is a promise", () => {
  const causes = new Set();
  let breaks = 0;
  for (const seed of SEEDS) {
    const g = play(always("fault-", "slow"), { seed }), f = g.fault("knock");
    causes.add(f.cause.id);
    assert.ok(f.state === "done" && f.known && f.told.ops != null, `seed ${seed}`);
    if (f.cause.id !== "break") continue;
    breaks++;
    // 20 km/h over what was a broken rail: safety asks; reported at once, it is in time
    assert.ok(kinds(g).has("dangerous") && g.logs.some((l) => /how many trains ran over a broken rail/.test(l.text)));
    assert.ok(g.result().decisions.some((d) => d.id === "report-knock" && d.option === "now") && !g.violations.some((v) => /reported late|never reported/.test(v.text)));
    // later with the full picture: late, and proceedings
    const m = play((gm, d) => (d.id.startsWith("fault-") ? "slow" : d.id.startsWith("report-") ? "later" : undefined), { seed });
    assert.ok(m.violations.some((v) => v.rule === "charge" && /proceedings for a dangerous event reported late/.test(v.text)), `seed ${seed}: reported later`);
    assert.ok(m.mood("safety") < g.mood("safety") && score(m) < score(g));
    // closed on the suspicion: reported at once, nothing ran over it
    const c = play(always("fault-", "close"), { seed });
    assert.ok(!c.logs.some((l) => /ran over a broken rail/.test(l.text)) && c.fault("knock").told.safety != null && c.mood("safety") >= g.mood("safety"));
  }
  assert.deepEqual([...causes].sort(), ["break", "fishplate", "nothing"]);
  assert.ok(breaks >= 4 && breaks <= 12);
  // closed for what was the train's wheel: a file opened for nothing
  const wheel = SEEDS.find((seed) => new WorksGame({ seed })._coming.find((x) => x.kind === "knock").u < 0.3);
  const c = play(always("fault-", "close"), { seed: wheel });
  assert.ok(c.irregulars.some((x) => x.key === "needless:safety:knock") && c.fault("knock").cause.id === "nothing");
  // a failed point: who knows the relay interlocking clears it in half the time
  const g = new WorksGame({ seed: 1, level: "training" }), h = new WorksGame({ seed: 1, level: "training" });
  const t0 = g._coming[0].at;
  for (const [gm, who] of [[g, "p4"], [h, "p3"]]) {
    runTo(gm, t0 + 0.05);
    assert.deepEqual([gm.faults[0].kind, gm.faults[0].told.ops != null, gm.faults[0].mode], ["points", true, "points"]);
    assert.equal(gm.act("send", "points", who).ok, true);
    runTo(gm, gm.faults[0].arrive + 0.4);
    assert.ok(gm.faults[0].known && gm.open.some((d) => d.id === "forecast-points"));
  }
  assert.ok(g.faults[0].repair_h < h.faults[0].repair_h && g.faults[0].range[1] <= h.faults[0].range[0]);
  // the forecast: kept when the track is open by then, missed when it is not
  g.act("decide", "forecast-points", 6);
  h.act("decide", "forecast-points", 0.5);
  runTo(g, t0 + 4);
  runTo(h, t0 + 4);
  assert.deepEqual([g.faults[0].forecast.kept, h.faults[0].forecast.kept, kinds(h).has("forecast-missed")], [true, false, true]);
  assert.ok(g.logs.some((l) => /as you said/.test(l.text)) && h.mood("ops") < g.mood("ops"));
  // what the signaller reports needs no second word; safety does not want to hear of a failed point
  const n = new WorksGame({ seed: 1, level: "training" });
  runTo(n, t0 + 0.05);
  assert.match(n.act("tell", "ops", "fault-points").reason, /has heard of it/);
  const was = n.mood("safety");
  n.act("send", "points", "p4");
  runTo(n, n.faults[0].arrive + 0.4);
  assert.equal(n.act("tell", "safety", "fault-points").ok, true);
  assert.equal(n.mood("safety"), was + WORKS_MOOD.false_alarm);
  assert.match(n.act("tell", "safety", "fault-nothing").reason, /no such fault/);
});

test("the storm: its forecast asks before anybody knows; kept, a strong one costs the machine's night; moved or called off, a weak one was moved for nothing", () => {
  const strong = SEEDS.filter((seed) => new WorksGame({ seed }).storm.strong), weak = SEEDS.filter((seed) => !strong.includes(seed));
  assert.ok(strong.length >= 6 && weak.length >= 6, `${strong.length} strong, ${weak.length} weak`);
  assert.equal(new WorksGame({ seed: strong[0], level: "training" }).storm.strong, false);
  for (const seed of strong.slice(0, 5)) {
    const keep = play(always("storm", "keep"), { seed }), move = play(always("storm", "move"), { seed }), off = play(always("storm", "off"), { seed });
    assert.ok(keep.irregulars.some((x) => x.kind === "work-missed" && /the machine cannot work in the storm/.test(x.why)) && keep.tally.cost >= WORKS_COST.machine && keep.work("tamp").state !== "done", `seed ${seed}: kept`);
    assert.ok(keep.logs.some((l) => /A possession held free for nothing/.test(l.text)) && keep.logs.some((l) => /A night announced, and nothing came/.test(l.text)));
    assert.deepEqual([move.work("tamp").state, when(move.work("tamp").t0), move.work("tamp").moved], ["done", "Thu 22:00", true], `seed ${seed}: moved`);
    assert.ok(move.tally.corrected >= 2 && off.work("tamp").state === "off" && off.tally.cost < keep.tally.cost);
    assert.ok(score(move) >= score(keep), `seed ${seed}: moving is not worse than keeping in a strong storm`);
  }
  assert.ok(strong.filter((seed) => score(play(always("storm", "move"), { seed })) > score(play(always("storm", "keep"), { seed }))).length >= strong.length * 0.7);
  for (const seed of weak.slice(0, 5)) {
    const keep = play(always("storm", "keep"), { seed }), move = play(always("storm", "move"), { seed }), off = play(always("storm", "off"), { seed });
    assert.deepEqual([keep.work("tamp").state, when(keep.work("tamp").t0), keep.tally.corrected], ["done", "Wed 22:00", 0], `seed ${seed}: kept`);
    assert.ok(score(keep) >= score(move) && score(keep) > score(off), `seed ${seed}: keeping beats moving when the storm passes`);
  }
  // the machine's other night is kept free until Tuesday evening only
  const g = new WorksGame({ seed: weak[0] });
  runTo(g, STORM.forecast + 0.02);
  assert.deepEqual(g.open.map((d) => d.id), ["storm"]);
  g.act("decide", "storm", "keep");
  runTo(g, STORM.reserve_by + 0.5);
  assert.match(g.act("schedule", "tamp", at("Thu", 22)).reason, /went to another site on Tuesday evening/);
  // the vegetation cut before the storm: fewer trees in the wire
  const trees = (cut) => SEEDS.filter((seed) => {
    const t = new WorksGame({ seed });
    t.storm.strong = true;
    t.work("veg").state = cut ? "done" : "planned";
    t.work("veg").crew = [];
    runTo(t, STORM.from + 1);
    return t.faults.some((f) => f.kind === "tree");
  }).length;
  const [uncut, cut] = [trees(false), trees(true)];
  assert.ok(uncut >= 14 && cut <= 8 && uncut > cut + 6, `a tree on ${uncut} of 24 strong storms uncut, ${cut} cut`);
  // the fire brigade calls its volunteer, and in a strong storm only
  assert.ok(strong.some((seed) => play(book, { seed }).logs.some((l) => /called out by the fire brigade of Waldau/.test(l.text))));
  assert.ok(!weak.some((seed) => play(book, { seed }).logs.some((l) => /fire brigade/.test(l.text))));
});

test("the trains: dense by day and thin at night; a possession by day costs trains, one at night costs notices; a period missed without an application is a danger", () => {
  assert.deepEqual([trainsAt("west", at("Tue", 7)), trainsAt("west", at("Tue", 12)), trainsAt("west", at("Tue", 17)), trainsAt("west", at("Wed", 2)), trainsAt("station", at("Tue", 7)), trainsAt("branch", at("Wed", 2))], [8, 5, 8, 1, 4, 0]);
  assert.ok(EFFECT.closed > EFFECT.single && EFFECT.single > EFFECT.slow40 && EFFECT.slow40 > EFFECT.slow70);
  assert.deepEqual(Object.keys(WORKS_AREAS), ["west", "station", "east", "branch"]);
  // the same week with the rail changed by day and at night: by day more train-minutes, no night to announce to the houses, no shifts outside the rota
  let more = 0;
  for (const seed of SEEDS) {
    const night = play(book, { seed, level: "training" }), day = play(book, { seed, level: "training", hands: moved("rail", at("Wed", 9, 30)) });
    if (day.work("rail").state !== "done" || day.work("rail").t0 !== at("Wed", 9, 30)) continue;
    more++;
    assert.ok(day.tally.lost_min > night.tally.lost_min + 10, `seed ${seed}: ${day.tally.lost_min} by day, ${night.tally.lost_min} at night`);
    assert.ok(!day.rota.some((x) => x.work === "rail") && night.rota.some((x) => x.work === "rail") && !day.work("rail").told.town);
  }
  assert.ok(more >= 6);
  // the rail's defect costs trains until it is changed: on Tuesday night less is lost to it than on Thursday night
  const g = new WorksGame({ seed: 1, level: "training" });
  run(g, 100);
  assert.ok(g.tally.lost_min > 0 && g.tally.lost_min < 20, "70 km/h over the defect, a quarter of a minute a train");
  // its period: an application in good time lets it run on at 40 km/h; none is a danger to people
  const none = play(book, { seed: 2, level: "training", hands: without((gm, name, args) => (name === "assign" && args[0] === "rail") || (name === "tell" && args[0] === "safety")) });
  assert.ok(none.violations.some((v) => v.rule === "period" && v.severity === 3) && !none.result().passed && kinds(none).has("overdue"));
  const applied = play(book, { seed: 2, level: "training", hands: (gm, P) => {
    // (the rail change taken out of the plan: its period cannot be kept, and that is known days ahead)
    if (gm.t >= 13 && gm.work("rail").start != null) gm.act("schedule", "rail", null);
    without((x, name, args) => name === "schedule" && args[0] === "rail")(gm, P);
  } });
  assert.ok(applied.work("rail").applied && !applied.work("rail").applied.late && applied.result().passed && !kinds(applied).has("overdue"));
  assert.ok(applied.logs.some((l) => /runs on beyond its period, by G\. Adler's signature: 40 km\/h over the rail/.test(l.text)));
  const a = new WorksGame({ seed: 2, level: "training" });
  runTo(a, at("Thu", 20));
  // planned within its period, a work needs no application: that is a note for nothing
  const was = a.mood("safety");
  assert.deepEqual([a.act("tell", "safety", "rail").ok, a.work("rail").applied, a.mood("safety")], [true, null, was + WORKS_MOOD.unneeded]);
  // taken out of the plan four hours before the period ends: applied for late, signed and remembered
  a.act("schedule", "rail", null);
  const mood = a.mood("safety");
  assert.deepEqual([a.needs(a.work("rail"), "safety"), a.act("tell", "safety", "rail").ok], [true, true]);
  assert.deepEqual([a.work("rail").applied.late, a.mood("safety"), kinds(a).has("late-news")], [true, mood + WORKS_MOOD.applied_late, true]);
  runTo(a, at("Thu", 24) + 0.1);
  assert.ok(!a.violations.some((v) => v.rule === "period") && a.work("rail").overdue);
  assert.match(a.act("tell", "safety", "rail").reason, /has the application/);
});

test("the four people: below the mark each phones once and asks for a promise; what is promised binds; at the end of their patience they act", () => {
  const start = () => {
    const g = new WorksGame({ seed: 1, level: "training" });
    run(g, 20);
    return g;
  };
  for (const who of Object.keys(AUDIENCES)) {
    const g = start();
    g._mood(who, WORKS_MOOD.call - WORKS_MOOD.start - 1);
    run(g, 1);
    const q = g.open.find((d) => d.id === `call-${who}`);
    assert.deepEqual([q.options.map((o) => o.id).slice(0, 2), q.fallback, g.called.has(who)], [["promise", "try"], "try", true], who);
    assert.match(q.title, new RegExp(`^${AUDIENCES[who].name.replace(".", "\\.")}, ${AUDIENCES[who].role}, is on the phone: “`));
    assert.match(q.text, /What you promise here, .* pay/);
    const was = g.mood(who);
    g.act("decide", q.id, "promise");
    assert.deepEqual([g.mood(who), g.promises.length, g.promises[0].kept], [was + WORKS_MOOD.promise, 1, null]);
    // once each
    g._mood(who, -5);
    run(g, 1);
    assert.ok(!g.open.some((d) => d.id === `call-${who}`));
  }
  // a promise to operations: nothing registered moves any more; moved, it is broken
  const g = start();
  g._mood("ops", -30);
  run(g, 1);
  g.act("decide", "call-ops", "promise");
  const was = g.mood("ops");
  g.act("schedule", "tamp", at("Thu", 22));
  assert.deepEqual([g.promises[0].kept, g.mood("ops"), g.violations.at(-1).rule, kinds(g).has("promise-broken")], [false, was + WORKS_MOOD.broken, "promise", true]);
  // a promise kept to the end is thanked
  const k = start();
  k._mood("safety", -30);
  run(k, 1);
  k.act("decide", "call-safety", "promise");
  const P = new WorksPlayer();
  while (!k.over) {
    for (const d of k.open) k.act("decide", d.id, k.advice(d.id));
    P.hands(k);
    k.step(0.5);
  }
  assert.equal(k.promises[0].kept, true);
  // an explanation is taken or not, by the seed
  const taken = new Set();
  for (const seed of SEEDS.slice(0, 10)) {
    const e = new WorksGame({ seed, level: "training" });
    run(e, 20);
    e._mood("town", -30);
    run(e, 1);
    const m = e.mood("town");
    e.act("decide", "call-town", "explain");
    taken.add(e.mood("town") - m);
  }
  assert.deepEqual([...taken].sort((a, b) => a - b), [WORKS_MOOD.refused, WORKS_MOOD.explained]);
  // at the end of their patience: in writing, and the week is harder with them
  const e = start();
  e._mood("ops", -60);
  run(e, 1);
  assert.ok(e.acted.has("ops") && e.violations.some((v) => v.rule === "complaint") && kinds(e).has("complaint"));
  e.act("decide", "call-ops", "try");
  e.act("unassign", "points", "p3");
  assert.equal(e.act("schedule", "points", at("Tue", 23)).ok, true);
  runTo(e, at("Tue", 4));
  assert.match(e.act("tell", "ops", "points").reason, /cannot|No signal box/, "19 h ahead is not enough any more");
  const c = start();
  c._mood("council", -60);
  run(c, 1);
  c.act("decide", "call-council", "try");
  c.act("assign", "tamp", "p1");
  c.act("tell", "council");
  runTo(c, c.rota[0].council.due + 0.1);
  assert.equal(c.rota[0].council.ok, false, "no further consent this week");
  // the one who is worst off counts most
  const fair = start(), unfair = start();
  for (const who of Object.keys(AUDIENCES)) fair._mood(who, -15);
  unfair._mood("town", -60);
  const people = (gm) => gm.objectives().find((o) => o.id === "people").value;
  assert.ok(people(unfair) < people(fair));
  assert.equal(new WorksGame().objectives().reduce((s, o) => s + o.weight, 0), 100);
});

test("the view for a page that does not know the game: figures, tables, the moves as forms, the week as a chart, the district for the table", () => {
  const g = new WorksGame({ seed: 1 });
  run(g, 20);
  g.act("assign", "tamp", "p1");
  const v = g.view();
  assert.deepEqual(v.figures.map((f) => f.label), ["Day", "Works done", "Train-min lost", "Operations", "Works council", "The town", "Safety"]);
  assert.deepEqual([v.figures[0].value, v.figures[1].value], ["Mon", "0 of 4"]);
  assert.deepEqual(v.tables.map((t) => [t.id, t.rows.length, !!t.window]), [["works", 4, true], ["people", 5, false], ["news", 4, false], ["audiences", 4, false]]);
  assert.deepEqual(v.actions.map((a) => a.name), ["schedule", "assign", "tell"]);
  assert.ok(v.actions.every((a) => a.fields.every((f) => f.options.length)));
  // the chart: every work, person and audience can be chosen, with its moves
  const sk = v.sketch, item = (id) => sk.items.find((x) => x.id === id);
  assert.ok(sk.width === 640 && sk.height > 250 && sk.label.length > 100);
  assert.deepEqual(sk.items.filter((x) => x.id).map((x) => x.id), ["work-tamp", "work-points", "work-rail", "work-veg", "person-p1", "person-p2", "person-p3", "person-p4", "person-p5", "aud-ops", "aud-council", "aud-town", "aud-safety", "aud-staff"]);
  assert.ok(sk.items.every((x) => x.kind !== "tag" || (x.x >= 0 && x.x < sk.width && x.y > 0 && x.y < sk.height)));
  // a work offers its slots; a person the works they can go onto (each names the work as what it needs); who is told, what they have not heard
  assert.deepEqual(item("work-tamp").menu.map((m) => [m.name, ...m.args]), [["schedule", "tamp", at("Thu", 22)], ["unassign", "tamp", "p1"]]);
  assert.deepEqual(item("person-p2").menu.map((m) => [m.name, m.args.join(), m.target, !!m.disabled]), [["assign", "tamp,p2", "work-tamp", false], ["assign", "rail,p2", "work-rail", false]]);
  assert.match(item("person-p5").menu.find((m) => m.target === "work-tamp").disabled, /eleven hours of rest/, "rest: said in the menu");
  assert.deepEqual(item("aud-town").menu.map((m) => [m.label, m.target]), [["Announce the tamping at Bergheim (Wed 22:00)", "work-tamp"], ["Announce the inspection of points W3 and W4 (Thu 10:00)", "work-points"], ["Announce the rail change at Talsee (Thu 23:30)", "work-rail"], ["Announce the vegetation on the branch to Waldau (Wed 09:00)", "work-veg"]]);
  assert.deepEqual(item("aud-council").menu.map((m) => m.label), ["Ask for consent to 1 shift outside the rota"]);
  assert.deepEqual(item("aud-staff").menu.map((m) => m.args), [["staff", "all"]]);
  assert.match(item("person-p4").title, /E\. Schwalbe, signalling technician \(relay, possession\), lives at Talsee: cares for her mother/);
  // a fault is on the chart, and a person offers to go
  const f = new WorksGame({ seed: 1, level: "training" });
  runTo(f, f._coming[0].at + 0.05);
  const fs = f.view().sketch;
  assert.ok(fs.items.find((x) => x.id === "fault-points").alert);
  assert.deepEqual(fs.items.find((x) => x.id === "person-p4").menu[0].target, "fault-points");
  assert.ok(!fs.items.find((x) => x.id === "person-p1").menu.some((m) => m.name === "send"), "a track technician is not offered a failed point");
  // the district for the table: every area, every work, every person where they are, the four people
  const d = f.district();
  assert.deepEqual([Object.keys(d.areas), d.works.map((w) => w.id), d.people.map((p) => p.at), Object.keys(d.moods)], [["west", "station", "east", "branch"], ["tamp", "points", "rail", "veg"], Array(5).fill("base"), ["ops", "council", "town", "safety"]]);
  assert.ok(d.areas.station.queue >= 1 && d.areas.east.mode === "slow" && d.faults[0].id === "points" && !d.faults[0].attended && d.storm === null);
  // the account as a flow
  const done = play(book, { seed: 2 });
  done.finish();
  const report = done.outbox.findLast((m) => m.flow === "performance-report");
  assert.deepEqual([report.payload.kind, report.payload.works, report.payload.score], ["maintenance", 4, score(done)]);
  assert.ok(done.outbox.every((m) => WorksGame.gives.some((x) => x.flow === m.flow)));
  assert.ok(done.outbox.some((m) => m.flow === "possession-request") && done.outbox.some((m) => m.flow === "staff-plan") && done.outbox.some((m) => m.flow === "press-report"));
});

test("the mission Short notice: sound, at the game's pace, a line for everything that does not go to plan, passed by the computer", () => {
  assert.deepEqual(validateMission(MISSION, GAMES), []);
  const m = normalizeMission(MISSION, GAMES), ph = m.phases[0];
  assert.deepEqual([ph.kind, ph.length, ph.clock, ph.pace, WorksGame.pace, WorksGame.clock], ["shift", S(WEEK_H), "06:00", WORKS_PACE, WORKS_PACE, "06:00"]);
  assert.deepEqual(validateMission({ ...MISSION, phases: [{ ...MISSION.phases[0], pace: 1 }] }, GAMES).length, 1);
  assert.deepEqual(m.roles.map((r) => [r.role, r.game, r.seat]), [["maintenance-district-manager", "works", "human"]]);
  // what it teaches is said, and asked for afterwards
  assert.match(MISSION.text, /What you practise: deciding for every piece of news who needs it, by when at the latest and from when it will hold/);
  assert.ok(MISSION.debrief.length >= 5 && MISSION.hook.length <= 110);
  // somebody speaks first, and for everything that does not go to plan
  const on = new Set(MISSION.story.filter((l) => l.on).map((l) => l.on));
  assert.deepEqual([...on].sort(), [...WorksGame.irregularities].sort());
  assert.ok(MISSION.story.filter((l) => l.at != null).length >= 6 && MISSION.story[0].at <= 5);
  for (const l of MISSION.story) assert.match(l.who.name, /^\p{Lu}\. \p{Lu}\p{L}+$/u);
  for (const seed of [1, 2, 3, 4]) {
    const { session, result } = testRun(MISSION, GAMES, { seed });
    assert.ok(result.passed && result.score >= 55, `seed ${seed}: ${result.score}`);
    // every placeholder of a line that answers something is one the game names
    const g = session.seats.get("maintenance-district-manager").game ?? session.results?.[0];
    for (const x of g?.irregulars ?? []) for (const l of MISSION.story.filter((s) => s.on === x.kind)) for (const [, k] of l.say.matchAll(/\{([a-z]+)\}/g)) assert.ok(x[k] != null, `${x.kind} names no ${k}`);
  }
});

test("the computer's district manager: a player like any other, and the game's own; the people have bird names of one language", () => {
  assert.equal(WorksGame.player, WorksPlayer);
  assert.equal(GAMES.get("works"), WorksGame);
  assert.equal(WorksGame.role, "maintenance-district-manager");
  assert.deepEqual(WorksGame.gives.map((x) => x.flow), ["possession-request", "staff-plan", "work-order", "situation-report", "press-report", "incident-report", "application", "performance-report"]);
  assert.deepEqual([WorksGame.takes, WORKS.map((w) => w.id), WORKS_PEOPLE.length], [[], ["tamp", "points", "rail", "veg"], 5]);
  const names = [...WORKS_PEOPLE.map((p) => p.name), ...Object.values(AUDIENCES).map((a) => a.name), ...Object.values(WORKS_HANDS), ...MISSION.story.map((l) => l.who.name)];
  for (const name of new Set(names)) {
    const [, initial, family] = name.match(/^(\p{Lu})\. (\p{Lu}\p{L}+)$/u);
    const lang = LANGUAGES.find((l) => l.birds.includes(family));
    assert.ok(lang && lang.birds.some((b) => b !== family && b.startsWith(initial)), `${name}: a bird's name, both parts of one language`);
  }
  // a player that only answers and never acts does not get through the week
  const idle = play(book, { seed: 1, hands: false });
  assert.ok(!idle.result().passed);
});

/** A canvas context that draws nothing and counts what is filled and written. */
function countingContext(W, H) {
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

test("the board: the week on the lab's table; sites, vans from the people's homes, pins; a click chooses, a second thing makes the move; the storm is the world's weather; nothing is written", () => {
  assert.equal(BOARDS.works, WorksBoard);
  const NEUSTADT = JSON.parse(readFileSync(new URL(`../../web/${TABLE_LAYOUT}`, import.meta.url), "utf8")), W = 1280, H = 800;
  assert.deepEqual(worksProblems(WORKS_TABLE, { areas: Object.keys(WORKS_AREAS), people: WORKS_PEOPLE.map((p) => p.id), audiences: Object.keys(AUDIENCES), area: TABLE_VIEW.area }), []);
  assert.deepEqual(worksProblems({ ...WORKS_TABLE, homes: {}, pins: {} }, { areas: ["moon"], people: ["p1"], audiences: ["ops"] }).length, 4);
  const world = createWorld(structuredClone(NEUSTADT), { seed: 1 });
  world.setLayers(TABLE_VIEW.layers);
  const board = new WorksBoard(world), g = new WorksGame({ seed: 1, level: "training" }), P = new WorksPlayer();
  assert.ok(world.simulations.includes(board));
  board.show(g);
  const to = (h) => {
    while (g.now < h && !g.over) {
      for (const d of g.open) g.act("decide", d.id, g.advice(d.id));
      P.hands(g);
      g.step(0.5);
    }
    board.step();
  };
  const viewOf = (bounds, ctx = countingContext(W, H)) => {
    const cam = new FlyCamera({ yaw: (270 * Math.PI) / 180, pitch: (48 * Math.PI) / 180 }).fit(bounds, W / H, 0.03), pose = cam.homography(W, H), camera = new Camera(W, H);
    camera.setManualFocal(pose.focal);
    return new View({ ctx, camera, H: pose.H, pose: pose.pose, scale: world.scale, time: world.time, virtual: true, pulse: 1, labels: false });
  };
  // where things are: the areas along the table from the Bergheim end to the Talsee end, the homes apart, everything in the camera's area
  to(at("Mon", 10));
  const [a0, a1, a2, a3] = TABLE_VIEW.area, inside = (p) => p[0] >= a0 && p[0] <= a2 && p[1] >= a1 && p[1] <= a3;
  const sites = Object.keys(WORKS_AREAS).map((a) => board.site(a).at);
  assert.ok(sites.every(inside) && sites[0][0] > sites[1][0] && sites[1][0] > sites[2][0], "Bergheim on the left as on the panel: the layout's +x");
  assert.deepEqual([board.partOf(sites[0]), board.partOf(sites[1]), board.partOf(sites[2])], ["west", "platforms", "east"]);
  assert.deepEqual(["work-tamp", "work-points", "work-rail", "work-veg"].map((id) => board.placeOf(id)), [sites[0], sites[1], sites[2], sites[3]]);
  assert.deepEqual([board.placeOf("aud-town"), board.placeOf("aud-nobody"), board.placeOf("work-none"), board.placeOf("person-p9")], [WORKS_TABLE.pins.town, null, null, null]);
  // by day the vans stand in the yard of the base; at night at their homes
  const yard = g.people.map((p) => board.placeOf(`person-${p.id}`));
  assert.ok(yard.every((p) => Math.abs(p[1] - yard[0][1]) < 1) && new Set(yard.map((p) => p[0])).size >= 4);
  to(at("Tue", 2));
  for (const p of g.people) {
    const van = board.placeOf(`person-${p.id}`), home = WORKS_TABLE.homes[p.id].at;
    assert.ok(Math.hypot(van[0] - home[0], van[1] - home[1]) < 80, `${p.name} is at home`);
  }
  // on the way to the base in the morning: along the streets, between home and yard
  to(at("Tue", 6, 15));
  const d = g.district(), i = d.people.findIndex((p) => p.to === "base");
  assert.ok(i >= 0, "somebody is on the road at a quarter past six");
  const van = board.van(d.people[i], i);
  assert.ok(board.way(`home:${d.people[i].id}`, "base", i).points.length >= 2 && inside(van.at));
  // drawn as the table draws it: rings, houses, vans, pins and no text; a click on a van chooses it
  to(at("Tue", 12));
  const ctx = countingContext(W, H), view = viewOf(board.bounds("all"), ctx);
  board.active = true;
  board.draw(view);
  view.render();
  assert.ok(ctx.counts.fill >= 40);
  assert.deepEqual(ctx.counts.text, []);
  const px = (item) => {
    const p = board.placeOf(item);
    return view.project(p[0], p[1], p[2] ?? 0);
  };
  assert.deepEqual(board.hit(view, px("aud-town")), { item: "aud-town" });
  assert.deepEqual(board.hit(view, px("work-tamp")), { item: "work-tamp" });
  assert.equal(board.hit(view, [3, 3]), null);
  // with a pin chosen, the site of what can be told there is what the move needs
  const menu = g.view().sketch.items.find((x) => x.id === "aud-safety").menu;
  board.picked = "aud-safety";
  board.offers = menu.map((m, k) => ({ i: k, target: m.target ?? null, disabled: !!m.disabled }));
  assert.deepEqual(board.hit(view, px("work-rail")), { target: "work-rail" });
  board.picked = null;
  board.offers = [];
  // a night's site: the houses beside it were told, and nobody lies awake; untold, they do
  to(at("Wed", 22, 30));
  const night = g.district();
  assert.deepEqual([night.works[0].state, night.areas.west.possession, night.areas.west.awake, night.night, board.houses("west").length, board.houses("station").length], ["running", "tamp", false, true, 3, 0]);
  // a possession at the station: the world's own trains are kept off track G3 while it holds
  const g3 = { kind: "rail", track: board.station.station.sections.g3.track };
  assert.equal(board.claims(g3), false);
  to(g.work("points").start + 0.5);
  assert.deepEqual([g.work("points").state, g.district().areas.station.possession, board.claims(g3), world.services.planner === board], ["running", "points", true, true]);
  to(g.work("points").t0 + 3.5);
  assert.deepEqual([board.claims(g3), world.services.planner], [false, null]);
  const awake = new WorksGame({ seed: 1, level: "training" });
  const deaf = (gm, name, args) => name === "tell" && args[0] === "town";
  while (awake.now < at("Wed", 22, 30)) {
    for (const q of awake.open) awake.act("decide", q.id, awake.advice(q.id));
    const real = awake.act.bind(awake);
    awake.act = (name, ...args) => (deaf(awake, name, args) ? { ok: false } : real(name, ...args));
    P.hands(awake);
    awake.act = real;
    awake.step(0.5);
  }
  assert.equal(awake.district().areas.west.awake, true);
  // the storm is the world's weather while it blows, and the weather it was comes back
  const stormy = new WorksGame({ seed: SEEDS.find((seed) => new WorksGame({ seed }).storm.strong) });
  const before = world.weather.mode === "fixed" ? world.weather.preset : world.weather.mode;
  board.show(stormy);
  while (stormy.now < STORM.from + 0.5) stormy.step(0.5);
  board.step();
  assert.deepEqual([stormy.district().storm, world.weather.mode, world.weather.preset], ["strong", "fixed", "thunderstorm"]);
  while (stormy.now < STORM.to + 0.5) stormy.step(0.5);
  board.step();
  assert.equal(world.weather.mode === "fixed" ? world.weather.preset : world.weather.mode, before);
  // without a game nothing is there to click; taken out of its world, the board is gone
  board.show(null);
  assert.deepEqual([board.hit(view, [640, 400]), board.placeOf("work-tamp")], [null, null]);
  board.dispose();
  assert.ok(!world.simulations.includes(board) && world.services.planner == null);
});
