// The workshop manager's game (web/arail/game/workshop.js), "A night in the hall": maintenance
// delivery among the four functions of the entity in charge of maintenance. The hall's tracks and
// the one throat, the work that is ordered, a finding beyond the order, a value at its limit, the
// lathe's cut, the release to service and the return to operation, the one person authorised for
// brake tests, the three people who count differently, the account; the mission Fit to run.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  GAMES, LATE_MAX_MIN, LATHE, PULLOUTS, STANDING_MIN, WORKSHOP_HANDS, WORKSHOP_LEVELS, WORKSHOP_MOOD, WORKSHOP_MOVE, WORKSHOP_PACE, WORKSHOP_PEOPLE, WORKSHOP_TRACKS, WORKSHOP_UNITS, WORKSHOP_WORK,
  WorkshopGame, WorkshopPlayer, normalizeMission, testRun, validateMission,
} from "../../web/arail/game/index.js";
import { ROOT } from "./helpers.js";

const MISSION = JSON.parse(readFileSync(join(ROOT, "web", "game", "missions", "fit-to-run.json"), "utf8"));
/** Seconds of the shift of minutes of the night. */
const S = (min) => (min * 60) / WORKSHOP_PACE;
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);

/**
 * Play the game alone to its end (or `until`, s of the shift); `policy(game, decision)` answers what
 * is asked (undefined: as the computer would; null policy: nobody answers and nobody acts), `each(game)`
 * is called before every step. The hands are the computer's: what is done is released and put outside.
 */
function play(policy, { seed = 1, level = "normal", each = null, until = Infinity, hands = true } = {}) {
  const g = new WorkshopGame({ seed, level }), P = new WorkshopPlayer();
  while (!g.over && g.t < until) {
    if (policy) {
      for (const d of g.open) {
        const x = policy(g, d);
        if (x !== OPEN) g.act("decide", d.id, x ?? g.advice(d.id));
      }
      if (hands) P.hands(g);
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

const computer = () => undefined;
const has = (d, id) => d.options.some((o) => o.id === id);
/** One kind of question answered one way (where that is offered), everything else as the computer would. */
const always = (prefix, option) => (g, d) => (d.id.startsWith(prefix) && has(d, option) ? option : undefined);
/** Judgment: the brake pads on the jacks, the pit kept free for the inspection. */
const planner = (g, d) => (d.id === "free-1" ? (has(d, "103") ? "103" : "leave") : d.id === "free-2" && has(d, "105") ? "105" : d.id === "free-3" ? (has(d, "107") ? "107" : has(d, "101") && g.t < S(20) ? "101" : "leave") : undefined);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const score = (g) => g.result().score;

test("alone: the computer's workshop manager passes on every level; nobody at the desk fails, because nothing comes into the hall; the same seed, the same night", () => {
  for (const level of Object.keys(WORKSHOP_LEVELS)) {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const g = play(computer, { seed, level }), r = g.result();
      assert.ok(r.passed, `${level}, seed ${seed}: passed (${r.score})`);
      assert.ok(!g.violations.some((v) => v.severity >= 3), `${level}, seed ${seed}: no danger`);
      assert.ok(g.account().released >= 3, `${level}, seed ${seed}: at least three units released`);
    }
  }
  const idle = play(null, { seed: 3 });
  assert.ok(!idle.result().passed, "nobody at the desk fails");
  assert.equal(idle.account().released, 0, "nothing is released");
  assert.equal(idle.account().cancelled, PULLOUTS.length, "no train has a unit");
  assert.ok(idle.open.some((d) => d.id.startsWith("free-") && d.deadline == null), "the first question waits without a time: nothing comes into the hall without a word");
  const a = play(computer, { seed: 7 }), b = play(computer, { seed: 7 }), c = play(computer, { seed: 8 });
  assert.deepEqual(a.logs.map((l) => l.text), b.logs.map((l) => l.text), "the same seed gives the same night");
  assert.notDeepEqual(a.logs.map((l) => l.text), c.logs.map((l) => l.text), "another seed another");
});

test("the choices matter: planning the pit ahead beats the book; a reading taken, a finding repaired unasked and a finding left in the release each win on some nights and lose on others", () => {
  const book = SEEDS.map((seed) => score(play(computer, { seed })));
  const plan = SEEDS.map((seed) => score(play(planner, { seed })));
  assert.ok(mean(plan) > mean(book) + 3, `judgment about the tracks pays (${mean(plan).toFixed(1)} against ${mean(book).toFixed(1)})`);
  assert.ok(Math.min(...book) < 75 && Math.max(...book) > 88, "by the book, nights differ");
  for (const [name, policy] of [["the reading taken", always("limit-", "within")], ["repaired unasked", always("finding-", "do")], ["left in the release", always("finding-", "note")]]) {
    const other = SEEDS.map((seed) => score(play(policy, { seed })));
    assert.ok(other.some((x, i) => x > book[i]), `${name}: better than the book on some night`);
    assert.ok(other.some((x, i) => x < book[i]), `${name}: worse on another`);
  }
  // hasty all round (unasked, on one reading, a shallow cut, an early time, the unit handed over, no promise) is worse than the book
  const hasty = (g, d) => (d.id.startsWith("finding-") && has(d, "do") ? "do" : d.id.startsWith("limit-") && has(d, "within") ? "within" : d.id.startsWith("cut-") ? Math.max(LATHE.min, d.scale.value - 1) : d.id === "word" ? Math.max(10, d.scale.value - 10) : d.id.startsWith("door-") ? "go" : d.id.startsWith("call-") ? d.options.at(-1).id : undefined);
  assert.ok(mean(SEEDS.map((seed) => score(play(hasty, { seed })))) < mean(book) - 6, "haste does not pay");
});

test("what is asked: a free track as one of a few, a finding and a limit as one of a few, the lathe's cut and the time for the dispatcher as numbers", () => {
  const seen = new Map();
  for (const seed of SEEDS) {
    play((g, d) => {
      const kind = d.id.split("-")[0];
      if (!seen.has(kind)) seen.set(kind, structuredClone({ id: d.id, title: d.title, text: d.text, options: d.options, scale: d.scale, deadline: d.deadline, fallback: d.fallback }));
      return undefined;
    }, { seed });
  }
  for (const kind of ["free", "finding", "limit", "cut", "word", "brake", "door"]) assert.ok(seen.has(kind), `asked: ${kind}`);
  const free = seen.get("free");
  assert.equal(free.scale, null);
  assert.equal(free.deadline, null, "no time to answer by");
  assert.ok(free.options.some((o) => o.id === "leave") && free.options.length >= 2);
  assert.deepEqual(seen.get("finding").options.map((o) => o.id), ["ask", "do", "note"]);
  assert.match(seen.get("finding").text, new RegExp(`standing order covers findings up to ${STANDING_MIN} min`));
  const limit = seen.get("limit");
  assert.deepEqual(limit.options.map((o) => o.id).slice(0, 3), ["again", "change", "concession"]);
  assert.match(limit.text, /maintenance file/);
  const cut = seen.get("cut");
  assert.deepEqual([cut.scale.min, cut.scale.max, cut.scale.step, cut.scale.unit], [LATHE.min, LATHE.max, LATHE.step, "mm"]);
  assert.deepEqual(cut.options.map((o) => o.id), ["measure"], "a number, and beside it: measure first");
  const word = seen.get("word");
  assert.equal(word.scale.unit, "min");
  assert.ok(word.deadline != null, "the phone does not wait for ever");
  assert.deepEqual(seen.get("brake").options.map((o) => o.id), ["now", "after", "other"]);
  assert.deepEqual(seen.get("door").options.map((o) => o.id), ["phone", "wait", "go"]);
  // the dilemma is in the first sentence of each text: short enough to be read at once
  for (const [kind, d] of seen) {
    const first = d.text.slice(0, d.text.search(/[.!?](?=\s+[A-ZÄÖÜ0-9€"(])/) + 1);
    assert.ok(first.split(" ").length <= 22 && !/\b\p{Lu}\.$/u.test(first), `${kind}: a first sentence to read at once (${first})`);
  }
});

test("the lathe's cut is a number whose ends both cost: too shallow and it sets up again, too deep and wheel life is gone and the other wheelset follows; measuring first says it to half a millimetre", () => {
  const cutAt = (mm) => (g, d) => (d.id.startsWith("cut-") ? mm : undefined);
  let between = 0;
  for (const seed of SEEDS) {
    const depth = new WorkshopGame({ seed }).unit("107").tasks[0].depth;
    const shallow = play(cutAt(LATHE.min), { seed }), deep = play(cutAt(LATHE.max), { seed }), fit = play(cutAt(Math.min(LATHE.max, depth + LATHE.below_mm)), { seed });
    if (depth > LATHE.min) assert.equal(shallow.account().second, 1, `seed ${seed}: cut at ${LATHE.min} mm, the flat (${depth} mm) still shows`);
    assert.equal(fit.account().second, 0, `seed ${seed}: cut to below the damage, one pass`);
    assert.equal(fit.account().excess_mm, 0);
    assert.ok(deep.account().excess_mm > 0, `seed ${seed}: ${LATHE.max} mm is more than the flat needed`);
    assert.ok(deep.mood("development") < fit.mood("development"), "the maintenance development engineer counts the millimetres");
    assert.ok(deep.unit("107").tasks[0].pair, `more than ${LATHE.pair_mm} mm: the other wheelset of the bogie is cut too`);
    if (score(fit) > score(shallow) && score(fit) > score(deep)) between++;
  }
  assert.ok(between >= SEEDS.length / 2, `somewhere between is better than both ends on most nights (${between} of ${SEEDS.length})`);
  // measured first: ten minutes, and the guess is less than half a millimetre wide round the truth
  const g = play((game, d) => (d.id.startsWith("cut-") ? (has(d, "measure") ? "measure" : OPEN) : undefined), { seed: 4, until: S(120) });
  const d = g.open.find((x) => x.id === "cut-107"), task = g.unit("107").tasks[0];
  assert.ok(d && !d.options.length, "asked again, now without the measurement");
  assert.ok(task.measured && task.guess[1] - task.guess[0] <= 0.5 && task.guess[0] <= task.depth && task.depth <= task.guess[1]);
  assert.match(d.title, /measured/);
});

test("the moves: a unit to a track through the one throat, the release, the phone; each refused where it cannot be", () => {
  const g = new WorkshopGame({ seed: 1 });
  run(g, S(3));
  assert.deepEqual(g.units.filter((u) => u.track).map((u) => [u.id, u.track]), [["105", "A"], ["101", "B"]], "two units stand outside when the shift begins");
  assert.equal(g.act("move", "107", "3").ok, false, "a unit that is not in yet cannot be moved");
  assert.equal(g.act("move", "105", "B").ok, false, "a track with a unit on it is not free");
  assert.equal(g.act("move", "105", "9").ok, false);
  assert.deepEqual(g.act("move", "105", "1"), { ok: true });
  assert.equal(g.act("move", "101", "1").ok, false, "a track a unit is on its way to is not free");
  assert.deepEqual(g.act("move", "101", "2"), { ok: true });
  assert.equal(g.act("move", "105", "2").ok, false, "a unit on the move cannot be moved again");
  // one move at a time: the second waits for the first
  run(g, S(WORKSHOP_MOVE.shunt_min) + 2);
  assert.equal(g.unit("105").track, "1");
  assert.ok(g.unit("101").moving && g.unit("101").track === "B");
  run(g, S(WORKSHOP_MOVE.shunt_min));
  assert.equal(g.unit("101").track, "2");
  // the release: not before the work that must be done is done; a unit whose work may wait can be released as it is
  assert.equal(g.act("release", "105").ok, false);
  assert.match(g.act("release", "105").reason, /brake pads of 442 105 is not done|nothing to release/);
  assert.equal(g.act("phone", "101").ok, false, "nobody is phoned for a unit that is not released");
  assert.deepEqual(g.act("release", "101"), { ok: true });
  assert.equal(g.act("release", "101").ok, false);
  assert.equal(g.fit().length, 0, "released to service is not returned to operation");
  const calls = g.account().calls, before = g.mood("fleet");
  assert.deepEqual(g.act("phone", "101"), { ok: true });
  assert.equal(g.account().calls, calls + 1);
  assert.ok(g.mood("fleet") < before, "a call at night costs patience");
  assert.equal(g.act("phone", "101").ok, false, "once is enough");
  run(g, S(3));
  const u = g.unit("101");
  assert.ok(u.rto_t != null, "phoned for, the return to operation comes within two minutes");
  assert.deepEqual(u.restrictions, ["door 3 locked"], "its door was not repaired: it runs with the restriction");
  assert.deepEqual(g.fit().map((x) => x.id), ["101"]);
  assert.equal(g.outbox.filter((m) => m.flow === "vehicle-release").length, 1);
  // a wheelset in the lathe stays there until its cut is done
  const h = play((game, d) => (d.id === "free-3" && has(d, "107") ? "107" : d.id.startsWith("free-") ? "leave" : undefined), { seed: 1, until: S(75), hands: false });
  assert.ok(h.unit("107").tasks[0].done > 0);
  assert.match(h.act("move", "107", "C").reason, /wheelset in the lathe/);
});

test("released is not returned: fleet management returns a unit to operation; handed to its driver before that, the workshop has taken a decision that is not its own", () => {
  // every unit that leaves for a train was returned to operation first, some minutes after its release
  const g = play(computer, { seed: 2 });
  for (const u of g.units.filter((x) => x.gone_t != null)) assert.ok(u.rto_t > u.released_t && !u.handed, `${u.name}: released ${u.released_t}, returned ${u.rto_t}`);
  assert.ok(g.logs.some((l) => /returns 442 \d+ to operation/.test(l.text)));
  // the driver at the door of a unit that is released and not returned: find a night on which it is asked
  let asked = 0, handed = 0;
  for (const seed of Array.from({ length: 60 }, (_, i) => i + 1)) {
    const go = play(always("door-", "go"), { seed });
    if (!go.decisions.some((d) => d.id.startsWith("door-"))) continue;
    asked++;
    const u = go.units.find((x) => x.handed);
    if (!u) continue;
    handed++;
    assert.ok(go.violations.some((v) => v.rule === "return-to-operation" && v.severity === 2), `seed ${seed}: a rule broken`);
    assert.ok(go.irregulars.some((x) => x.kind === "bypassed" && x.who === WORKSHOP_PEOPLE.fleet.name));
    const waited = play(always("door-", "wait"), { seed });
    assert.ok(go.mood("fleet") < waited.mood("fleet"), `seed ${seed}: the fleet manager's patience falls`);
    assert.ok(!waited.violations.some((v) => v.rule === "return-to-operation"));
  }
  assert.ok(asked >= 3 && handed >= 3, `the driver stands at the door on some nights (${asked}), and is let go (${handed})`);
  // with a finding in the release that fleet management would have had repaired, the unit handed over runs unsafe: the round is failed
  const seed = SEEDS.find((x) => new WorkshopGame({ seed: x }).unit("105").tasks[0].checks[0].finding.must_have);
  const risky = play(always("finding-", "note"), { seed, each: (game) => {
    const u = game.unit("105");
    if (u.released_t != null && u.rto_t == null && !u.kept && !u.handed) game._handOver(u);
  } });
  assert.ok(risky.unit("105").handed);
  assert.ok(risky.violations.some((v) => v.rule === "unsafe" && v.severity >= 3), "it runs with what should have kept it in");
  assert.ok(!risky.result().passed);
  assert.ok(risky.outbox.some((m) => m.flow === "incident-report" && m.payload.ran));
  // the same for a unit whose brake test was signed without authorisation: handed over, it runs unsafe, and its train is worth what a cancelled one is
  const lapsed = Array.from({ length: 40 }, (_, i) => i + 1).find((x) => play(computer, { seed: x }).decisions.some((d) => d.id === "brake-test"));
  const voided = play(always("brake-test", "other"), { seed: lapsed, each: (game) => {
    const u = game.unit("105");
    if (u.released_t != null && u.rto_t == null && !u.kept && !u.handed) game._handOver(u);
  } });
  assert.ok(voided.unit("105").void && voided.unit("105").handed && voided.unit("105").gone_t != null);
  assert.ok(voided.violations.some((v) => v.rule === "unsafe" && /signed by V\. Ammer/.test(v.text)));
  const ran = voided.pullouts.find((p) => p.unit === "105"), trains = voided.objectives().find((o) => o.id === "trains").value;
  assert.ok(ran.unsafe && trains < 0.7, `the train it took is not a train served (${trains})`);
  // a unit that was phoned for is not phoned for again at the door: the question offers the wait and the hand-over only
  const g2 = new WorkshopGame({ seed: 1 });
  run(g2, S(3));
  g2.act("release", "101");
  g2.act("phone", "101");
  g2._askDoor(g2.pullouts[0], g2.unit("101"));
  const door = g2.open.find((d) => d.id === "door-101");
  assert.deepEqual(door.options.map((o) => o.id), ["wait", "go"]);
  assert.match(door.text, /has been phoned about it/);
  assert.equal(g2.advice("door-101"), "wait");
});

test("a finding beyond the order: asked, fleet management extends the order or lets the unit run with a restriction; repaired unasked, it is within the standing order or not; left in the release, it is decided when nothing can be repaired", () => {
  const found = (g) => g.units.flatMap((u) => u.findings).filter((f) => f.type === "extra");
  let repaired = 0, deferred = 0, within = 0, beyond = 0, kept = 0, restricted = 0;
  for (const seed of SEEDS) {
    const ask = play(always("finding-", "ask"), { seed });
    for (const f of found(ask)) {
      assert.ok(["repaired", "deferred", "task"].includes(f.state), `seed ${seed}: ${f.id} ${f.state}`);
      if (f.must_have) repaired++;
      else {
        deferred++;
        assert.ok(ask.unit(f.unit).restrictions.includes(f.restriction), "it runs with the restriction fleet management named");
      }
    }
    assert.ok(!ask.violations.some((v) => v.rule === "order"));
    const unasked = play(always("finding-", "do"), { seed });
    for (const f of found(unasked).filter((x) => x.state === "repaired")) {
      const broke = unasked.violations.some((v) => v.rule === "order" && v.text.includes(`${unasked.unit(f.unit).name}: ${f.real_min} min of work`));
      assert.equal(broke, f.real_min > STANDING_MIN, `seed ${seed}: ${f.real_min} min of work unasked`);
      if (broke) beyond++;
      else within++;
    }
    const note = play(always("finding-", "note"), { seed });
    for (const u of note.units) {
      const must = u.findings.some((f) => f.type === "extra" && f.must_have);
      if (u.released_t == null || u.rto_due > note.t) continue;
      if (must && !u.handed) {
        kept++;
        assert.ok(u.kept && u.rto_t == null, `seed ${seed}: ${u.name} is not returned to operation`);
      } else if (u.findings.some((f) => f.type === "extra")) restricted++;
    }
  }
  assert.ok(repaired > 5 && deferred > 5, `fleet management decides either way (${repaired} repaired, ${deferred} deferred)`);
  assert.ok(within > 3 && beyond > 3, `the repair is within the standing order on some nights (${within}) and beyond it on others (${beyond})`);
  assert.ok(kept > 3 && restricted > 3, `left in the release, the unit is kept in (${kept}) or runs restricted (${restricted})`);
  // while the answer is awaited nobody works on the unit
  const g = play((game, d) => (d.id.startsWith("finding-") ? OPEN : undefined), { seed: 1, until: S(110) });
  const u = g.unit("105"), done = u.tasks.find((t) => t.id === "pads").done;
  assert.equal(u.hold?.why, "decision");
  run(g, S(10));
  assert.equal(u.tasks.find((t) => t.id === "pads").done, done, "the track waits for the word");
  assert.equal(g.act("release", "105").ok, false);
});

test("a value at its limit: measured again it is clear or changed; a concession is maintenance development's to give; taken as read, a part that was truly under its limit fails in service", () => {
  let failed = 0, held = 0, conceded = 0, refused = 0, scrapped = 0;
  for (const seed of SEEDS) {
    const f0 = new WorkshopGame({ seed }).unit("103").tasks[0].checks.find((c) => c.finding.type === "limit").finding;
    const again = play(always("limit-", "again"), { seed }), fa = again.unit("103").findings.find((f) => f.type === "limit");
    if (fa && fa.state !== "asked") assert.ok(f0.truth >= 0 ? fa.state === "clear" : ["task", "repaired"].includes(fa.state), `seed ${seed}: measured again, truth ${f0.truth}: ${fa.state}`);
    const within = play(always("limit-", "within"), { seed }), fw = within.unit("103").findings.find((f) => f.type === "limit");
    if (fw?.state === "failed") {
      failed++;
      assert.ok(f0.truth < 0 && f0.reading >= 0);
      assert.equal(within.account().repeats, 1);
      assert.ok(within.irregulars.some((x) => x.kind === "repeat"));
      assert.ok(within.mood("development") < again.mood("development"));
    } else if (fw?.state === "within") held++;
    const asked = play(always("limit-", "concession"), { seed }), fc = asked.unit("103").findings.find((f) => f.type === "limit");
    if (fc?.state === "concession") {
      conceded++;
      assert.ok(asked.unit("103").restrictions.includes(fc.restriction));
    } else if (fc && ["task", "repaired"].includes(fc.state)) refused++;
    scrapped += play(always("limit-", "change"), { seed }).account().scrapped;
  }
  assert.ok(failed >= 2 && held >= 2, `a reading taken holds on some nights (${held}) and fails in service on others (${failed})`);
  assert.ok(conceded >= 2 && refused >= 2, `a concession is given (${conceded}) or refused (${refused})`);
  assert.ok(scrapped >= 2, "changed without a second look, a good part goes on the scrap pallet on some nights");
  // under its limit by the gauge, the reading cannot be taken
  const under = SEEDS.find((seed) => new WorkshopGame({ seed }).unit("103").tasks[0].checks[1].finding.reading < 0);
  let options = null;
  play((g, d) => {
    if (d.id.startsWith("limit-")) options = d.options.map((o) => o.id);
    return undefined;
  }, { seed: under });
  assert.deepEqual(options, ["again", "change", "concession"]);
});

test("one person may sign a brake test, and runs the lathe: one of the two waits; a signature without authorisation is no release", () => {
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1).filter((seed) => play(computer, { seed }).decisions.some((d) => d.id === "brake-test"));
  assert.ok(seeds.length >= 5, "the brake test meets the lathe on many nights");
  for (const seed of seeds.slice(0, 5)) {
    const now = play(always("brake-test", "now"), { seed }), after = play(always("brake-test", "after"), { seed });
    const done = (g, unit, task) => g.logs.find((l) => l.text.includes(`442 ${unit}: ${task}`))?.t ?? Infinity;
    assert.ok(done(now, "105", "brake test done") < done(after, "105", "brake test done"), `seed ${seed}: tested now, 442 105 is out sooner`);
    assert.ok(done(now, "107", "the wheelset is round again") > done(after, "107", "the wheelset is round again"), `seed ${seed}: and the lathe later`);
    for (const g of [now, after]) assert.ok(g.logs.some((l) => l.text.includes(`signed by ${WORKSHOP_HANDS.tester}`)));
    const other = play(always("brake-test", "other"), { seed });
    assert.ok(other.violations.some((v) => v.rule === "authorisation" && v.severity === 3));
    assert.ok(!other.result().passed, "the round is failed, whatever the score");
    assert.ok(other.unit("105").kept, "and fleet management does not return the unit to operation");
    assert.ok(other.irregulars.some((x) => x.kind === "void-release"));
  }
});

test("the three people: below the mark each phones once and asks for a promise; what is promised binds; at the end of their patience they act", () => {
  // the fleet manager, after work unasked: nothing without an order from now on
  const strict = (g, d) => (d.id.startsWith("finding-") && has(d, "do") ? "do" : d.id === "call-fleet" ? "promise" : undefined);
  const promised = SEEDS.map((seed) => play(strict, { seed })).filter((g) => g.promises.some((p) => p.who === "fleet"));
  assert.ok(promised.length >= 3, "the fleet manager phones after work that was not ordered");
  for (const g of promised) {
    const call = g.decisions.find((d) => d.id === "call-fleet"), later = g.decisions.filter((d) => d.id.startsWith("finding-") && d.at > call.at);
    assert.match(call.title, new RegExp(`^${WORKSHOP_PEOPLE.fleet.name}, the fleet manager on call, is on the phone`));
    for (const d of later) assert.ok(!has(d, "do"), "promised: the standing order is no longer offered");
  }
  // the compromise keeps the standing order, and the next repair beyond it breaks the word
  const two = (g, d) => (d.id.startsWith("finding-") && has(d, "do") ? "do" : d.id === "call-fleet" ? "two" : undefined);
  assert.ok(SEEDS.map((seed) => play(two, { seed })).some((g) => g.promises.some((p) => p.who === "fleet" && p.kept === false) && g.irregulars.some((x) => x.kind === "promise-broken")), "a promise not kept is a broken promise");
  // the maintenance development engineer: measure twice; then the flat is measured before the cut without being asked
  const g = new WorkshopGame({ seed: 5 });
  g._mood("development", WORKSHOP_MOOD.call - WORKSHOP_MOOD.start - 1);
  run(g, S(3));
  g._patience("development");
  assert.ok(g.open.some((d) => d.id === "call-development"));
  g.act("decide", "call-development", "promise");
  assert.ok(g.mood("development") > WORKSHOP_MOOD.call);
  const h = play((game, d) => (d.id.startsWith("cut-") ? OPEN : undefined), { seed: 5, until: S(120), each: (game) => {
    if (game.t === 0) {
      game._mood("development", WORKSHOP_MOOD.call - WORKSHOP_MOOD.start - 1);
      game.promises.push({ who: "development", what: "a second measurement before every cut and every limit", twice: true, kept: null });
      game.called.add("development");
    }
  } });
  assert.ok(h.unit("107").tasks[0].measured, "promised: the flat is measured before the cut");
  assert.ok(h.logs.some((l) => /measures the flat's damage/.test(l.text)));
  // the dispatcher: a time said and missed is a broken word; said too late, a train is cancelled in good time
  const early = (game, d) => (d.id === "word" ? 10 : undefined), late = (game, d) => (d.id === "word" ? 150 : undefined);
  const missed = SEEDS.map((seed) => play(early, { seed })).filter((x) => x.word?.kept === false);
  assert.ok(missed.length >= 3);
  for (const x of missed) assert.ok(x.violations.some((v) => v.rule === "promise") && x.mood("dispatch") < WORKSHOP_MOOD.start);
  const planned = SEEDS.map((seed) => play(late, { seed })).filter((x) => x.word);
  assert.ok(planned.length >= 3);
  for (const x of planned) assert.ok(x.pullouts.some((p) => p.cancelled === "planned"), "said later than the last train can use, a train is cancelled in good time");
  // at the end of their patience: the dispatcher orders buses, the fleet manager reads every release
  const worn = play(always("finding-", "note"), { seed: 1 });
  assert.ok(worn.acted.size > 0 && worn.violations.some((v) => v.rule === "complaint"));
  assert.ok(worn.irregulars.some((x) => x.kind === "complaint"));
  // the people's patience: the lowest counts most
  const o = worn.objectives().find((x) => x.id === "people"), a = worn.account();
  assert.ok(Math.abs(o.value - (0.6 * a.lowest + 0.4 * mean(Object.values(a.moods))) / 100) < 1e-9);
});

test("the trains of the morning: a unit returned to operation leaves for each, one without a restriction first; a train waits twelve minutes for its unit, then it is cancelled", () => {
  const g = play(planner, { seed: 12 });
  assert.equal(g.account().gone, PULLOUTS.length);
  assert.deepEqual(g.pullouts.map((p) => p.late_min), [0, 0, 0, 0]);
  assert.ok(g.pullouts.every((p) => g.unit(p.unit).gone_t >= p.at), "no unit leaves before its train's time");
  assert.ok(/Every unit is released and every train of the morning has its unit/.test(g.over));
  // a unit that runs with a restriction is the last to be taken
  const r = SEEDS.map((seed) => play(planner, { seed })).find((x) => x.pullouts.some((p) => p.restricted) && x.pullouts.some((p) => p.unit && !p.restricted));
  assert.ok(r);
  assert.ok(r.pullouts.findIndex((p) => p.restricted) > 0);
  // nothing fit at a train's time: it waits, and is cancelled after the wait
  const idle = play(null, { seed: 1 }), first = idle.pullouts[0];
  assert.equal(first.cancelled, true);
  assert.ok(idle.logs.some((l) => l.text.startsWith(`04:${24 + LATE_MAX_MIN} The 04:24 RB 31 to Talsee is cancelled`)));
  // late, a train costs the dispatcher's patience by the minute, and its worth in the score
  const lateNight = SEEDS.map((seed) => play(computer, { seed })).find((x) => x.pullouts.some((p) => p.late_min >= 1));
  assert.ok(lateNight, "by the book, a train leaves late on some night");
  assert.ok(lateNight.irregulars.some((x) => x.kind === "late"));
  assert.ok(lateNight.objectives().find((o) => o.id === "trains").value < 1);
});

test("the view for a page that does not know the game: figures, tables, the moves as forms, the depot as a picture, the hall for the table", () => {
  const g = play(computer, { seed: 3, until: S(100) }), v = g.view();
  assert.deepEqual(v.figures.map((f) => f.label), ["Trains with a unit", "Released", ...Object.values(WORKSHOP_PEOPLE).map((p) => p.label)]);
  assert.deepEqual(v.tables.map((t) => t.id), ["units", "trains", "people"]);
  assert.equal(v.tables[0].rows.length, WORKSHOP_UNITS.length);
  assert.deepEqual(v.actions.map((a) => a.name), ["move", "release"]);
  const sk = v.sketch, units = sk.items.filter((it) => it.id?.startsWith("unit-")), tracks = sk.items.filter((it) => it.id?.startsWith("track-"));
  assert.equal(tracks.length, WORKSHOP_TRACKS.length);
  assert.ok(units.length >= 3 && units.every((it) => it.title && (it.menu == null || it.menu.length)));
  assert.ok(sk.items.every((it) => (it.x ?? it.x1) >= 0 && (it.x ?? it.x2) <= sk.width && (it.y ?? it.y1) >= 0 && (it.y ?? it.y2) <= sk.height), "everything within the picture");
  assert.equal(sk.items.filter((it) => it.id?.startsWith("train-")).length, PULLOUTS.length);
  // a unit's moves: the free tracks; a free track's: the units that can come
  const menu = units.find((it) => it.menu)?.menu ?? [];
  assert.ok(menu.every((x) => ["move", "release", "phone"].includes(x.name)));
  const free = tracks.find((it) => it.menu);
  assert.ok(free && free.menu.every((x) => x.name === "move" && x.args[1] === free.id.slice(6)));
  // the hall for the table: every unit with its track and how far it is along the way there; no geometry
  const hall = g.hall();
  for (const u of hall.units) {
    assert.ok(WORKSHOP_TRACKS.some((t) => t.id === u.track) && u.at >= -1 && u.at <= 1 && u.lift >= 0 && u.lift <= 1);
    assert.ok(["idle", "work", "wait", "released", "fit", "bad"].includes(u.tone));
  }
  // a unit on the move: half the way out of its track, half the way into the other
  const m = new WorkshopGame({ seed: 1 });
  run(m, S(3));
  m.act("move", "105", "1");
  run(m, S(WORKSHOP_MOVE.shunt_min) * 0.25 + 0.5);
  let u = m.hall().units.find((x) => x.id === "105");
  assert.ok(u.moving && u.track === "A" && u.at > 0.3 && u.at < 0.7);
  run(m, S(WORKSHOP_MOVE.shunt_min) * 0.5);
  u = m.hall().units.find((x) => x.id === "105");
  assert.ok(u.track === "1" && u.at > 0.3 && u.at < 0.7);
  // work under the floor on the jacks: the unit is raised first, and lowered before it moves
  const j = play((game, d) => (d.id === "free-1" ? "leave" : d.id === "free-2" && has(d, "105") ? "105" : undefined), { seed: 1, until: S(30), hands: false });
  assert.equal(j.unit("105").track, "2");
  assert.equal(j.unit("105").lift, 1);
  assert.equal(j.hall().units.find((x) => x.id === "105").fitters, 3);
  j.act("move", "105", "C");
  run(j, S(1));
  assert.ok(!j.unit("105").moving && j.unit("105").lift < 1, "lowered before it moves");
  run(j, S(WORKSHOP_MOVE.lift_min));
  assert.ok(j.unit("105").moving);
});

test("the mission Fit to run: sound, at the game's pace, a line for everything that does not go to plan, passed by the computer", () => {
  const m = normalizeMission(MISSION, GAMES);
  assert.deepEqual(validateMission(m, GAMES), []);
  assert.equal(m.phases[0].clock, WorkshopGame.clock);
  assert.equal(m.phases[0].pace, WorkshopGame.pace);
  assert.equal(m.phases[0].length, new WorkshopGame().length);
  assert.match(m.text, /What you practise: /);
  // a shift at another pace than its game's is not sound; a shift of a game at the clock's pace need not name one
  const off = structuredClone(MISSION);
  delete off.phases[0].pace;
  assert.match(validateMission(normalizeMission(off, GAMES), GAMES).join("\n"), /the shift's pace is 1, but workshop-manager's game \("workshop"\) runs at 12/);
  // a shift with the wrong time and the wrong pace is told both at once
  const both = structuredClone(MISSION);
  both.phases[0].clock = "21:00";
  both.phases[0].pace = 6;
  const told = validateMission(normalizeMission(both, GAMES), GAMES).join("\n");
  assert.match(told, /begins at 21:00, but workshop-manager's game/);
  assert.match(told, /the shift's pace is 6, but workshop-manager's game/);
  // what the story says of a time of the night is said before that time: the hourly status before one o'clock, the dispatcher's question before ten past three
  const saidAt = (re) => m.story.find((x) => re.test(x.say)).at * m.phases[0].pace / 60;
  assert.ok(saidAt(/From one o'clock your status goes out/) < 180, "before 01:00");
  assert.ok(saidAt(/At ten past three/) < 310, "before 03:10");
  const zero = structuredClone(MISSION);
  zero.phases[0].pace = 0;
  assert.match(validateMission(normalizeMission(zero, GAMES), GAMES).join("\n"), /pace .* must be more than 0/);
  const said = new Set(m.story.filter((s) => s.on).map((s) => s.on));
  assert.deepEqual([...said].sort(), [...WorkshopGame.irregularities].sort(), "a line for every kind of irregularity");
  // every irregularity names what its line asks for
  const fields = { finding: ["unit"], limit: ["unit", "what"], "second-pass": ["unit"], bypassed: ["who", "unit"], kept: ["who", "unit", "what"], restricted: ["unit", "what", "who"], late: ["train", "min", "who"], cancelled: ["train", "who"], repeat: ["unit", "what", "who"], "promise-broken": ["who"], complaint: ["who"], "void-release": ["who", "unit"] };
  const seen = new Map();
  for (const seed of SEEDS) for (const policy of [computer, always("finding-", "note"), always("limit-", "within"), always("finding-", "do"), always("brake-test", "other"), always("door-", "go")]) for (const x of play(policy, { seed }).irregulars) seen.set(x.kind, x);
  for (const [kind, names] of Object.entries(fields)) {
    assert.ok(seen.has(kind), `seen: ${kind}`);
    for (const n of names) assert.ok(seen.get(kind)[n], `${kind}: ${n}`);
    const line = m.story.find((s) => s.on === kind).say;
    for (const [, n] of line.matchAll(/\{(\w+)\}/g)) assert.ok(names.includes(n), `${kind}: the line asks for {${n}}`);
  }
  for (const seed of [1, 2, 3]) {
    const { session, result } = testRun(MISSION, GAMES, { seed });
    const game = session.seat("workshop-manager").game, a = game.account();
    assert.ok(result.passed && game.over, `seed ${seed}: ${result.score}`);
    const report = game.outbox.find((x) => x.flow === "performance-report").payload;
    assert.deepEqual([report.kind, report.units_released, report.trains_with_a_unit, report.score], ["workshop", a.released, a.gone, game.score().total]);
    assert.equal(game.outbox.filter((x) => x.flow === "vehicle-release").length, a.released);
  }
});

test("the computer's workshop manager: a player like any other, and the game's own; the people have bird names", () => {
  assert.equal(WorkshopGame.player, WorkshopPlayer);
  assert.equal(GAMES.get("workshop"), WorkshopGame);
  assert.equal(WorkshopGame.role, "workshop-manager");
  assert.deepEqual(Object.keys(WorkshopGame.actions).filter((a) => a !== "decide").sort(), ["move", "phone", "release"]);
  assert.deepEqual(WorkshopGame.gives.map((x) => x.flow), ["vehicle-release", "incident-report", "performance-report"]);
  assert.ok(WORKSHOP_WORK.inspection_min > WORKSHOP_WORK.pads_min && WORKSHOP_WORK.pads_min > WORKSHOP_WORK.brake_test_min);
  for (const name of [...Object.values(WORKSHOP_PEOPLE).map((p) => p.name), ...Object.values(WORKSHOP_HANDS)]) assert.match(name, /^\p{Lu}\. \p{Lu}\p{L}+$/u);
});
