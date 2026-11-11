// The asset manager's game, "Budget Years" (web/arail/game/asset-manager.js): the model of a budget
// year (faults, delay minutes, the performance regime, wear and renewals); the computer's asset
// manager on every level, alone and in a session; a careless one, and the accident after a known
// defect was deferred; the flows it takes (the budget, the shift's reports) and gives (the staff
// plan, the condition of the assets, the year's report); its view; and a district session with the
// maintenance dispatcher and the signaller in a shift between the plan and the account.
import assert from "node:assert/strict";
import test from "node:test";

import {
  AssetManagerGame, AssetManagerPlayer, DEFER, DELAY, INSPECTIONS_PCT, LEVELS, MISSED_CUT, MONITORING, PROGRAMME, REGIME_EUR_PER_MIN, STAFF, STRATEGIES, TARGET_GRADE,
  minutesPerFault, renewalsOf, yearOf,
} from "../../web/arail/game/asset-manager.js";
import { MaintenanceGame } from "../../web/arail/game/maintenance.js";
import { normalizeMission, testRun } from "../../web/arail/game/mission.js";
import { Session } from "../../web/arail/game/session.js";
import { SignallerGame } from "../../web/arail/game/signaller.js";

const games = new Map([AssetManagerGame, MaintenanceGame, SignallerGame].map((G) => [G.id, G]));
const PLAN = { id: "plan", kind: "turn", roles: ["asset-manager"] }, REVIEW = { id: "review", kind: "turn", roles: ["asset-manager"] };
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

/** The computer's asset manager, and a careless one: lean, hardly any renewals, one team, nobody on call, everything deferred. */
const computer = (g) => new AssetManagerPlayer().think(g);
const CARELESS = { strategy: "lean", renewals: "little", teams: "1", "on-call": "no", proposal: "defer" };
const careless = (g) => {
  for (const d of g.open) g.act("decide", d.id, CARELESS[d.id]);
};

/** Play a game alone: a plan phase and a review phase a year, nothing between them. */
function play(options, rounds, each = computer) {
  const g = new AssetManagerGame(options);
  for (let round = 1; round <= rounds && !g.over; round++) {
    g.begin({ round, rounds, phase: PLAN });
    each(g, round);
    g.finish({ round, rounds, phase: PLAN });
    g.begin({ round, rounds, phase: REVIEW });
    g.finish({ round, rounds, phase: REVIEW });
  }
  return g;
}

/** A game in the plan phase of its first year whose ALV proposes this kind of thing (the seed draws it). */
function proposing(kind) {
  for (let seed = 1; seed <= 40; seed++) {
    const g = new AssetManagerGame({ seed });
    g.begin({ round: 1, rounds: 4, phase: PLAN });
    if (g.proposal?.kind === kind) return g;
  }
  throw new Error(`no seed with a proposal of kind ${kind}`);
}

const solo = (level, rounds = 4) => ({
  id: "budget-years", roles: [{ role: "asset-manager", game: "asset-manager", level }], rounds, phases: [PLAN, REVIEW],
});
const district = (level = "normal") => ({
  id: "district-years", rounds: 3,
  roles: [{ role: "asset-manager", game: "asset-manager", level }, { role: "signaller-relay", game: "signaller" }, { role: "maintenance-dispatcher", game: "maintenance" }],
  phases: [PLAN, { id: "shift", kind: "shift", roles: ["signaller-relay", "maintenance-dispatcher"], length: 2400, tick: 1 }, REVIEW],
});

test("the model of a year: faults from the grade, delay minutes, the performance regime, wear and the renewals coming in", () => {
  const state = { grade: 3, monitoring: false, permanent: 0, arriving_eur: 24e6 };
  const plan = { strategy: "standard", committed_eur: 24e6, teams: 2, on_call: true };
  const y = yearOf(state, plan);
  assert.equal(y.faults, 240);
  assert.equal(y.restrictions, 2);
  assert.equal(y.fault.minutes, DELAY.per_restore_min * STAFF.restore_min[2]);
  assert.deepEqual(y.delay, { faults: 240 * 42, possessions: 24 * DELAY.possession_min_per_meur, restrictions: 2 * DELAY.restriction_min });
  assert.equal(y.delay_min, 12420);
  assert.equal(y.regime_eur, y.delay_min * REGIME_EUR_PER_MIN);
  // the planned programme makes good a year of standard wear
  assert.equal(y.grade, 3);
  assert.equal(yearOf({ ...state, arriving_eur: 6e6 }, { ...plan, strategy: "lean" }).grade, 3.13);
  assert.equal(yearOf(state, { ...plan, strategy: "thorough" }).grade, 2.97);
  // a worse network, lean maintenance: more faults; condition monitoring: fewer, and fewer inspections by hand
  assert.ok(yearOf({ ...state, grade: 3.4 }, plan).faults > 280);
  assert.equal(yearOf(state, { ...plan, strategy: "lean" }).faults, 276);
  assert.equal(yearOf({ ...state, monitoring: true }, plan).faults, Math.round(240 * MONITORING.faults));
  assert.ok(yearOf(state, { ...plan, strategy: "lean" }).inspections_pct < INSPECTIONS_PCT);
  assert.equal(yearOf({ ...state, monitoring: true }, plan).inspections_pct, STRATEGIES.standard.inspections_pct + MONITORING.inspections_pct);
  // a permanent speed restriction costs delay minutes every year; measures pulled forward need extra possessions
  assert.equal(yearOf({ ...state, permanent: 1 }, plan).delay_min, y.delay_min + DELAY.restriction_min);
  assert.equal(yearOf(state, { ...plan, committed_eur: 28e6 }).delay.possessions, (24 + 2 * 4) * DELAY.possession_min_per_meur);
  // fewer teams, longer; nobody on call: no overtime, slower at night
  assert.ok(minutesPerFault({ teams: 1, on_call: true }).minutes > minutesPerFault({ teams: 2, on_call: true }).minutes);
  assert.ok(minutesPerFault({ teams: 3, on_call: true }).minutes < minutesPerFault({ teams: 2, on_call: true }).minutes);
  assert.deepEqual([minutesPerFault({ teams: 2, on_call: false }).minutes, minutesPerFault({ teams: 2, on_call: false }).overtime_h], [42 * STAFF.no_on_call, 0]);
  // the shift's reports instead of the model: the mean of what each says a fault cost
  const shift = minutesPerFault({ teams: 2, on_call: true }, [
    { kind: "operations", delay_min: 9, faults: 1 }, { kind: "maintenance", restore_min: 20, overtime_h: 4, faults: 4 }, { kind: "undertaking", trips: 12 },
  ]);
  assert.deepEqual([shift.from, shift.minutes, shift.overtime_h], ["shift", (9 * DELAY.network_per_station + 20 * DELAY.per_restore_min) / 2, 1]);
  // a shift without a fault at the signaller's, and nothing that held trains: the model
  assert.equal(minutesPerFault({ teams: 2, on_call: true }, [{ kind: "operations", delay_min: 3, faults: 0 }, { kind: "maintenance", restore_min: null, overtime_h: 0, faults: 1 }]).from, "model");
  // the renewals: only money that is available, the programme, the planning capacity
  assert.deepEqual(["little", "planned", "all"].map((o) => renewalsOf(o, 28e6)), [PROGRAMME.little * 24e6, 24e6, 28e6]);
  assert.deepEqual(["little", "planned", "all"].map((o) => renewalsOf(o, 40e6)), [6e6, PROGRAMME.planned_eur, PROGRAMME.capacity_eur]);
  assert.equal(renewalsOf("planned", 18e6), 18e6);
});

test("the computer's asset manager passes every level, alone and in a session, and gives its flows with the payloads of the contract", () => {
  for (const level of Object.keys(LEVELS)) {
    assert.ok(LEVELS[level].label);
    for (const seed of SEEDS) {
      for (const rounds of [3, 5]) {
        const g = play({ level, seed }, rounds);
        const res = g.result();
        assert.ok(g.over, `${level} ${seed}`);
        assert.equal(res.passed, true, `${level} ${seed}: ${res.score}`);
        assert.ok(res.score >= (level === "hard" ? 65 : 90), `${level} ${seed} ${rounds}: ${res.score}`);
        assert.equal(res.worst, 0);
        assert.ok(g.years.every((y) => y.unspent_eur === 0 && y.inspections_pct >= INSPECTIONS_PCT));
      }
      const s = new Session(normalizeMission(solo(level), games), { games, seed }).run();
      const r = s.result();
      assert.equal(s.over && r.passed, true, `${level} ${seed} in a session`);
      assert.ok(r.score >= 50);
      assert.equal(r.seats[0].rounds.length, 4);
      assert.deepEqual(r.flows, { "staff-plan": 4, "asset-condition": 4, "performance-report": 4 });
    }
  }
  assert.equal(play({ level: "normal" }, 4).grade <= TARGET_GRADE, true);
  // the flows of a year, in their order
  const g = play({ level: "normal", seed: 1 }, 3);
  assert.deepEqual(g.outbox.map((m) => m.flow), Array(3).fill(["staff-plan", "asset-condition", "performance-report"]).flat());
  assert.deepEqual(g.outbox[0].payload, { teams: 2, on_call: true });
  assert.deepEqual(g.outbox[1].payload, { grade: 3, faults_year: 240, restrictions: 2 });
  const rep = g.outbox[2].payload, y = g.years[0];
  assert.deepEqual(Object.keys(rep), ["scope", "kind", "year", "grade", "target", "faults_year", "delay_min_year", "spent_eur", "unspent_eur", "overtime_h", "score"]);
  assert.deepEqual([rep.scope, rep.kind, rep.year, rep.grade, rep.target, rep.faults_year, rep.unspent_eur], ["District Neustadt", "infrastructure", 1, 3, TARGET_GRADE, 240, 0]);
  assert.equal(rep.delay_min_year, y.delay_min);
  assert.equal(rep.spent_eur, y.spent_eur + y.committed_eur);
  assert.equal(rep.overtime_h, Math.round(240 * STAFF.overtime_h_per_fault[2]));
  // every line of the year's account is in the log, with its numbers
  for (const part of [/Year 1: 240 faults at grade 3\.00/, /a fault cost 42 delay minutes/, /12,420 delay minutes: 10,080 from the faults/, /12,420 min × €10 = €124,200/, /h of overtime/, /the maintenance money: €[\d.]+ M spent of €6\.00 M/, /the replacement money: €24\.00 M drawn of €24\.00 M/, /96 % of the inspections on time/, /the grade: 3\.00 \+ 0\.10 wear .* − 0\.10 .* = 3\.00/]) {
    assert.ok(g.logs.some((l) => part.test(l.text)), String(part));
  }
  // a mission without a review phase: a year is settled when the next begins
  const h = new AssetManagerGame();
  for (const round of [1, 2]) {
    h.begin({ round, rounds: 2, phase: PLAN });
    h.finish({ round, rounds: 2, phase: PLAN });
  }
  assert.deepEqual([h.years[0].settled, h.years[1].settled, h.outbox.filter((m) => m.flow === "performance-report").length], [true, false, 1]);
});

test("the same seed and the same moves give the same game", () => {
  for (const each of [computer, careless]) {
    const a = play({ level: "hard", seed: 5 }, 4, each), b = play({ level: "hard", seed: 5 }, 4, each);
    assert.deepEqual(a.result(), b.result());
    assert.deepEqual(a.logs, b.logs);
    assert.deepEqual(a.outbox, b.outbox);
  }
  assert.notDeepEqual(play({ seed: 1 }, 5).logs, play({ seed: 2 }, 5).logs);
});

test("a careless asset manager ends clearly worse; a known defect that was deferred can end the round at once", () => {
  let accidents = 0;
  for (const seed of SEEDS) {
    const g = play({ level: "normal", seed }, 4, careless), res = g.result();
    const good = play({ level: "normal", seed }, 4).result();
    assert.ok(res.score <= good.score - 30, `seed ${seed}: ${res.score} against ${good.score}`);
    assert.equal(res.passed, false, `seed ${seed}: ${res.score}`);
    // late inspections are a breach every year
    assert.ok(g.violations.filter((v) => v.rule === "inspections-late" && v.severity === 2).length === g.years.length);
    assert.ok(g.years.every((y) => y.unspent_eur > 0 && y.delay_min > g.reference_min));
    const crash = g.violations.find((v) => v.rule === "deferred-defect");
    if (crash) {
      accidents++;
      assert.equal(crash.severity, 3);
      assert.equal(res.worst, 3);
      assert.match(g.over, /accident caused by a known defect that was deferred/);
      assert.ok(g.years.length < 4, "the round ends at once");
      // the year of the accident is still reported; nothing can be done any more
      assert.equal(g.outbox.at(-1).payload.year, g.years.length);
      assert.deepEqual(g.act("decide", "strategy", "standard"), { ok: false, reason: "The game is over." });
      const flows = g.outbox.length;
      g.begin({ round: 4, rounds: 4, phase: PLAN });
      g.finish({ round: 4, rounds: 4, phase: PLAN });
      assert.equal(g.outbox.length, flows);
    } else {
      assert.ok(g.grade > TARGET_GRADE, `seed ${seed}: grade ${g.grade}`);
      assert.ok(res.score < 50);
    }
  }
  assert.ok(accidents >= 1, "a deferred defect fails for at least one seed");
  assert.ok(DEFER.accident_chance > 0 && DEFER.accident_chance <= 0.2);
  // a turn that nobody decides: last year's plan again, and the proposal deferred
  const idle = play({ level: "normal", seed: 2 }, 1, () => {});
  assert.deepEqual(idle.years[0].plan, { strategy: "standard", renewals: "planned", teams: 2, on_call: true, proposal: idle.proposal ? "defer" : null });
  assert.ok(idle.result().decisions.every((d) => d.auto));
});

test("the ALV's proposals: a defect repaired, deferred or declined; condition monitoring", () => {
  const cost = (g) => g.proposal.cost_eur;
  // approve: paid from the maintenance money, and done
  let g = proposing("defect");
  const first = cost(g);
  g.act("decide", "proposal", "approve");
  g.finish({ round: 1, rounds: 4, phase: PLAN });
  assert.equal(g.years[0].planned_eur, STRATEGIES.standard.cost_eur + 2 * STAFF.team_eur + STAFF.on_call_eur + first);
  assert.equal(g.deferred, null);
  // defer: cheap now, the defect stays and the ALV asks again, the repair dearer
  g = proposing("defect");
  g.act("decide", "proposal", "defer");
  g.finish({ round: 1, rounds: 4, phase: PLAN });
  assert.equal(g.years[0].planned_eur, STRATEGIES.standard.cost_eur + 2 * STAFF.team_eur + STAFF.on_call_eur + DEFER.watch_eur);
  assert.equal(g.deferred.cost_eur, first);
  g.begin({ round: 1, rounds: 4, phase: REVIEW });
  if (!g.over) {
    g.finish({ round: 1, rounds: 4, phase: REVIEW });
    g.begin({ round: 2, rounds: 4, phase: PLAN });
    assert.equal(g.proposal.again, true);
    assert.equal(cost(g), Math.round(first * (1 + DEFER.dearer)));
  }
  // decline: no repair and no risk, a permanent speed restriction with its delay minutes
  g = proposing("defect");
  g.act("decide", "proposal", "decline");
  g.finish({ round: 1, rounds: 4, phase: PLAN });
  assert.deepEqual([g.permanent, g.deferred, g.outbox.at(-1).payload.restrictions], [1, null, 3]);
  g.begin({ round: 1, rounds: 4, phase: REVIEW });
  assert.equal(g.years[0].delay_min, g.reference_min + DELAY.restriction_min);
  assert.equal(g.over, null);
  // condition monitoring: an investment now, fewer faults from the next year
  g = proposing("monitoring");
  g.act("decide", "proposal", "approve");
  for (const round of [1, 2]) {
    if (round > 1) g.begin({ round, rounds: 4, phase: PLAN });
    g.finish({ round, rounds: 4, phase: PLAN });
    g.begin({ round, rounds: 4, phase: REVIEW });
    g.finish({ round, rounds: 4, phase: REVIEW });
  }
  assert.deepEqual(g.years.map((y) => y.faults), [240, Math.round(240 * MONITORING.faults)]);
  assert.ok(g.years[0].planned_eur > g.years[1].planned_eur || g.years[1].proposal);
});

test("the budget: the level's money and the game's own rule alone, the budget MP's money in a session", () => {
  // alone: a missed target (the grade worse than the target) cuts the next year's money by 10 %
  const hard = new AssetManagerGame({ level: "hard" });
  assert.deepEqual([hard.money.cut, hard.money.maintenance_eur, hard.money.renewal_eur], [true, 6e6 * (1 - MISSED_CUT), 24e6 * (1 - MISSED_CUT)]);
  const g = play({ level: "normal", seed: 1 }, 5, careless);
  if (!g.violations.some((v) => v.severity === 3)) {
    const miss = g.years.findIndex((y) => y.missed);
    assert.ok(miss >= 1 && miss < 4, `the first missed year: ${miss + 1}`);
    assert.deepEqual([g.years[miss].money.maintenance_eur, g.years[miss + 1].money.maintenance_eur], [6e6, 5.4e6]);
    assert.ok(g.logs.some((l) => /the target is missed .* next year's money is cut by 10 %/.test(l.text)));
  }
  // with a budget MP in the session the money is theirs, and so is the answer to a missed target
  const wired = new AssetManagerGame({ level: "hard", wired: ["budget"] });
  assert.deepEqual([wired.money.cut, wired.money.maintenance_eur], [false, 6e6]);
  // the budget flow: the money to plan with, and its blocked part
  const budget = { year: 1, maintenance_eur: 5_500_000, renewal_eur: 20_000_000, blocked_eur: 4_000_000, condition: "until the report on the district's condition is in" };
  for (const early of [true, false]) {
    const b = new AssetManagerGame({ wired: ["budget"], conditions: early ? { budget } : {} });
    b.begin({ round: 1, rounds: 3, phase: PLAN });
    if (!early) {
      assert.equal(b.money.available_eur, 24e6);
      b.receive({ flow: "budget", from: "bundestag-budget-mp", t: 0, payload: budget });
    }
    assert.deepEqual(b.money, { maintenance_eur: 5.5e6, renewal_eur: 20e6, blocked_eur: 4e6, available_eur: 16e6, condition: budget.condition, cut: false });
    assert.match(b.open.find((d) => d.id === "renewals").options[1].label, /€16\.00 M/);
    computer(b);
    b.finish({ round: 1, rounds: 3, phase: PLAN });
    b.begin({ round: 1, rounds: 3, phase: REVIEW });
    const y = b.years[0];
    // the blocked part cannot be spent and is not counted as unused
    assert.deepEqual([y.committed_eur, y.unspent_eur, y.money.maintenance_eur], [16e6, 0, 5.5e6]);
    assert.ok(b.logs.some((l) => /€4\.00 M stayed blocked/.test(l.text)));
    // a budget of another year that arrives after the plan is next year's
    b.receive({ flow: "budget", from: "bundestag-budget-mp", t: 0, payload: { ...budget, year: 2, blocked_eur: 0 } });
    assert.equal(b.money.available_eur, 16e6);
    b.finish({ round: 1, rounds: 3, phase: REVIEW });
    b.begin({ round: 2, rounds: 3, phase: PLAN });
    assert.equal(b.money.available_eur, 20e6);
  }
  // the budget MP decides in the same phase: the running year's budget arrives after the plan was booked and still counts
  const late = new AssetManagerGame({ wired: ["budget"] });
  late.begin({ round: 1, rounds: 3, year: 2027, phase: PLAN });
  computer(late);
  late.finish({ round: 1, rounds: 3, year: 2027, phase: PLAN });
  assert.equal(late.years[0].committed_eur, 24e6);
  late.receive({ flow: "budget", from: "bundestag-budget-mp", t: 0, payload: { ...budget, year: 2027 } });
  assert.deepEqual([late.years[0].committed_eur, late.years[0].money.maintenance_eur, late.value("replacement")], [16e6, 5.5e6, 0]);
  assert.equal(late.value("maintenance"), 5.5e6 - late.years[0].planned_eur);
  late.begin({ round: 1, rounds: 3, year: 2027, phase: REVIEW });
  late.finish({ round: 1, rounds: 3, year: 2027, phase: REVIEW });
  // the report names the year as the session does
  assert.deepEqual([late.outbox.at(-1).payload.year, late.outbox.at(-1).payload.unspent_eur, late.years[0].year], [2027, 0, 1]);
});

test("the shift's reports decide what a fault cost in the year; other reports are ignored", () => {
  const year = (reports) => {
    const g = new AssetManagerGame({ seed: 4 });
    g.begin({ round: 1, rounds: 3, phase: PLAN });
    computer(g);
    g.finish({ round: 1, rounds: 3, phase: PLAN });
    for (const [from, payload] of reports) g.receive({ flow: "performance-report", from, t: 0, payload });
    g.begin({ round: 1, rounds: 3, phase: REVIEW });
    g.finish({ round: 1, rounds: 3, phase: REVIEW });
    return g;
  };
  const alone = year([]).years[0];
  assert.deepEqual([alone.from, alone.minutes_per_fault], ["model", 42]);
  // reports of other kinds change nothing
  const other = year([["ru-control-dispatcher", { scope: "RB 3", kind: "undertaking", trips: 12, cancelled: 1 }], ["contract-manager", { kind: "contract", year: 1, punctual_share: 0.9 }]]).years[0];
  assert.deepEqual(other, alone);
  // the signaller's: its delay minutes per fault, spread over the network
  const ops = year([["signaller-relay", { scope: "Bf Neustadt", kind: "operations", trains: 9, delay_min: 30, late: 4, faults: 1, restore_min: 25 }]]).years[0];
  assert.deepEqual([ops.from, ops.minutes_per_fault], ["shift", 30 * DELAY.network_per_station]);
  assert.equal(ops.delay_min, alone.delay_min + 240 * (180 - 42));
  assert.equal(ops.regime_eur, ops.delay_min * REGIME_EUR_PER_MIN);
  // the dispatcher's: its minutes to restore, and its overtime by its faults
  const g = year([["maintenance-dispatcher", { scope: "District Neustadt", kind: "maintenance", faults: 4, done: 4, open: 0, restore_min: 10, overtime_h: 4, teams: 2 }]]);
  const mnt = g.years[0];
  assert.deepEqual([mnt.from, mnt.minutes_per_fault, mnt.overtime_h], ["shift", 10 * DELAY.per_restore_min, 240]);
  assert.ok(mnt.delay_min < alone.delay_min && mnt.spent_eur !== alone.spent_eur);
  assert.ok(g.logs.some((l) => /from the shift's reports: the dispatcher's 10 min to restore × 3 = 30/.test(l.text)));
  // both: the mean; a year later without reports: the model again
  assert.equal(year([["signaller-relay", { kind: "operations", delay_min: 6, faults: 1 }], ["maintenance-dispatcher", { kind: "maintenance", faults: 3, restore_min: 14, overtime_h: 0 }]]).years[0].minutes_per_fault, 39);
  g.begin({ round: 2, rounds: 3, phase: PLAN });
  g.finish({ round: 2, rounds: 3, phase: PLAN });
  g.begin({ round: 2, rounds: 3, phase: REVIEW });
  assert.equal(g.years[1].from, "model");
});

test("the view: figures, tables and the plan as a move with its fields", () => {
  const check = (g) => {
    const v = g.view();
    for (const k of ["figures", "tables", "actions"]) assert.ok(Array.isArray(v[k]), k);
    assert.ok(v.figures.length >= 4 && v.figures.every((f) => f.label && f.value !== undefined));
    for (const t of v.tables) assert.ok(t.id && t.title && t.rows.every((r) => r.length === t.columns.length), t.id);
    for (const a of v.actions) {
      assert.ok(Object.hasOwn(AssetManagerGame.actions, a.name), a.name);
      for (const f of a.fields ?? []) if (f.options && !a.disabled) assert.ok(f.options.length > 0, `${a.name}.${f.id}`);
    }
    return v;
  };
  const g = new AssetManagerGame({ seed: 3 });
  assert.deepEqual(check(g).actions, []); // before the first year
  g.begin({ round: 1, rounds: 3, phase: PLAN });
  let v = check(g);
  assert.deepEqual(v.actions.map((a) => a.name), ["setPlan"]);
  assert.ok(v.tables.find((t) => t.id === "plan").rows.some((r) => /not decided yet/.test(r[1])));
  // acting with the first option of every field
  const a = v.actions[0];
  const args = a.fields.map((f) => (f.options ? f.options[0].id : f.type === "check" ? true : f.min ?? 0));
  assert.deepEqual(g.act(a.name, ...args), { ok: true });
  assert.deepEqual(g.plan, { strategy: "lean", renewals: "little", teams: 1, on_call: true, proposal: g.proposal ? "defer" : null });
  assert.deepEqual(g.open.map((d) => d.id), g.proposal ? ["proposal"] : []);
  // the plan can be changed until the turn ends; the decisions record the last choice
  assert.deepEqual(g.act("setPlan", "thorough", "all", "3", "no"), { ok: true });
  assert.deepEqual([g.plan.strategy, g.plan.teams, g.plan.on_call], ["thorough", 3, false]);
  assert.equal(g.result().decisions.find((d) => d.id === "strategy").option, "thorough");
  assert.equal(g.act("setPlan", "none", "all", 3, true).ok, false);
  assert.equal(g.act("setPlan", "lean", "all", 4, true).ok, false);
  v = check(g);
  // thorough maintenance and three teams are more than the maintenance money
  assert.equal(v.figures.find((f) => f.label === "Maintenance money left").tone, "bad");
  g.finish({ round: 1, rounds: 3, phase: PLAN });
  assert.deepEqual(check(g).actions, []);
  assert.equal(g.act("setPlan", "lean", "little", 1, false).ok, false);
  g.begin({ round: 1, rounds: 3, phase: REVIEW });
  v = check(g);
  assert.ok(v.tables.find((t) => t.id === "account").rows.length >= 8);
  assert.equal(v.tables.find((t) => t.id === "years").rows.length, 1);
  assert.ok(g.years[0].overrun_eur > 0);
  // the objectives: weights of 100, each with its numbers in words
  const parts = g.objectives();
  assert.equal(parts.reduce((s, p) => s + p.weight, 0), 100);
  assert.deepEqual(parts.map((p) => p.id), ["grade", "delay", "money", "inspections"]);
  assert.ok(parts.every((p) => p.value >= 0 && p.value <= 1 && /\d/.test(p.note)));
  assert.ok(parts.find((p) => p.id === "money").value < 1);
  // the statics of a role game
  assert.deepEqual([AssetManagerGame.id, AssetManagerGame.role, AssetManagerGame.scale, AssetManagerGame.kind], ["asset-manager", "asset-manager", "years", "simulation"]);
  assert.deepEqual(AssetManagerGame.takes.map((x) => x.flow), ["budget", "performance-report"]);
  assert.deepEqual(AssetManagerGame.gives.map((x) => x.flow), ["staff-plan", "asset-condition", "performance-report"]);
  assert.equal(AssetManagerGame.player, AssetManagerPlayer);
});

test("in a session with the maintenance dispatcher and the signaller: the staff plan, the condition and the shift's reports arrive", () => {
  // the computer on every seat: three years, a shift in each
  for (const [level, seed] of [["normal", 1], ["hard", 2]]) {
    const { session, result } = testRun(district(level), games, { seed });
    const seat = result.seats.find((s) => s.seat === "asset-manager");
    assert.equal(session.over && seat.passed, true, `${level}: ${seat.score}`);
    assert.deepEqual([result.flows["staff-plan"], result.flows["asset-condition"], result.flows["performance-report"]], [3, 3, 9]);
    const to = (flow) => session.flows.find((f) => f.flow === flow && f.seat === "asset-manager").to;
    assert.deepEqual(to("staff-plan"), ["maintenance-dispatcher"]);
    assert.deepEqual(to("asset-condition"), ["signaller-relay", "maintenance-dispatcher"]);
    // each year's delay minutes come from that year's shift
    const g = session.seat("asset-manager").game;
    assert.deepEqual(g.years.map((y) => y.from), ["shift", "shift", "shift"]);
    for (const y of g.years) {
      const reports = session.flows.filter((f) => f.flow === "performance-report" && f.round === y.year && f.seat !== "asset-manager").map((f) => f.payload);
      assert.deepEqual(reports.map((r) => r.kind).sort(), ["maintenance", "operations"]);
      assert.equal(y.minutes_per_fault, minutesPerFault(y.plan, reports).minutes);
    }
  }
  // a person as asset manager: one team and nobody on call, or three teams
  const shift = (level, teams) => {
    const s = new Session(normalizeMission(district(level), games), { games, seed: 1, seats: { "asset-manager": "human" } }).start();
    assert.equal(s.waiting, true);
    assert.deepEqual(s.act("asset-manager", "setPlan", "standard", "planned", teams, false), { ok: true });
    for (const d of s.seat("asset-manager").game.open) s.act("asset-manager", "decide", d.id, "approve");
    s.next();
    assert.equal(s.phase.id, "shift");
    const dispatcher = s.seat("maintenance-dispatcher").game, signaller = s.seat("signaller-relay").game;
    const at = { teams: dispatcher.teams.length, onCall: dispatcher.onCall, faults: dispatcher.faults.length, grade: signaller.conditions["asset-condition"].grade };
    s.run();
    assert.equal(s.phase.id, "review");
    return { s, at, year: s.seat("asset-manager").game.years[0] };
  };
  const one = shift("normal", 1), three = shift("normal", 3), old = shift("hard", 1);
  // the staff plan sets the dispatcher's teams
  assert.deepEqual([one.at.teams, one.at.onCall, three.at.teams], [1, { signalling: "none", track: "none" }, 3]);
  // the condition of the assets sets the faults of the shift
  assert.deepEqual([one.at.grade, old.at.grade], [3, 3.4]);
  assert.ok(old.at.faults > one.at.faults, `${old.at.faults} faults at grade 3.4, ${one.at.faults} at 3.0`);
  // and the shift's reports the year's delay minutes: one team restores more slowly than three
  for (const x of [one, three]) {
    const reports = x.s.flows.filter((f) => f.flow === "performance-report").map((f) => f.payload);
    assert.equal(x.year.from, "shift");
    assert.equal(x.year.delay_min, yearOf({ grade: 3, monitoring: false, permanent: 0, arriving_eur: 24e6 }, { ...x.year.plan, committed_eur: 24e6 }, reports).delay_min);
    assert.notEqual(x.year.minutes_per_fault, minutesPerFault(x.year.plan).minutes);
  }
  assert.ok(one.year.delay_min > three.year.delay_min, `${one.year.delay_min} min with one team, ${three.year.delay_min} with three`);
  // the person's session goes on into the next year
  one.s.next();
  assert.deepEqual([one.s.round, one.s.phase.id, one.s.seat("asset-manager").game.year], [2, "plan", 2]);
});
