// The budget committee's rail rapporteur (web/arail/game/budget.js), "The Night Session": the draft,
// the ceiling and the committee's cut; the district's budget for the asset manager; qualified blocks
// with and without a finding; a grant or equity for DB; the year's account by the game's own model and
// by the asset manager's report; the coalition that breaks; the computer's rapporteur and a careless
// one; the same game for the same moves; the game in a session.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { BLOCK_SHARE, BudgetGame, BudgetPlayer, CAPITAL_EUR, CONDITIONS, DISTRICT_SHARE, EQUITY_RETURN, FIRST_YEAR, LEVELS, LINES, PROJECT, STEP_EUR, money } from "../../web/arail/game/budget.js";
import { Game, Player } from "../../web/arail/game/core.js";
import { normalizeMission, testRun, validateMission } from "../../web/arail/game/mission.js";
import { Session } from "../../web/arail/game/session.js";

const ROLE = "bundestag-budget-mp", SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const phase = (id) => ({ id, kind: "turn" });

/** One phase of a game played alone: it begins, the player moves, what is open falls back, it ends. */
function turn(g, id, moves = null, round = 1, rounds = 3) {
  const ctx = { round, rounds, phase: phase(id) };
  g.begin(ctx);
  if (!g.over) moves ? moves(g, ctx) : new (g.constructor.player)().think(g);
  for (const d of g.open) g.decide(d.id, d.fallback ?? d.options[0].id, { auto: true });
  g.finish(ctx);
}

/** Budget years played alone: a night session and a review each. */
function play(g, rounds = 3, moves = null) {
  for (let round = 1; round <= rounds; round++) for (const id of ["plan", "review"]) turn(g, id, moves, round, rounds);
  return g;
}

/** Nobody at the table: every decision falls back, no money moves. */
const nobody = () => {};

/** Constituency first, the existing network cut, the partner ignored, the questions wrong. */
function careless(g) {
  for (const d of g.open) {
    if (d.id.startsWith("quiz-")) g.act("decide", d.id, d.options.find((o) => o.id !== g.rightAnswer(d.id)).id);
    else if (d.id.startsWith("constituency-")) g.act("decide", d.id, "double");
  }
  if (g.planning) g.act("shift", "renewal", "bedarfsplan", 3);
}

const mission = (roles, phases, rounds = 3) => ({ format: "arail-mission/1", id: "budget-years", title: "Budget years", text: "The rail lines of the federal budget, year after year.", rounds, roles, phases });
const ALONE = mission([{ role: ROLE, game: "budget" }], [{ id: "plan", kind: "turn", roles: [ROLE] }, { id: "review", kind: "turn", roles: [ROLE] }]);

test("the game's ports, moves and levels; a draft of the right order", () => {
  assert.equal(BudgetGame.id, "budget");
  assert.equal(BudgetGame.role, ROLE);
  assert.equal(BudgetGame.scale, "years");
  assert.deepEqual(BudgetGame.takes.map((t) => t.flow), ["performance-report"]);
  assert.deepEqual(BudgetGame.gives.map((t) => t.flow), ["budget", "funding-decision"]);
  assert.equal(BudgetGame.player, BudgetPlayer);
  for (const lv of Object.values(LEVELS)) assert.ok(lv.label);
  assert.equal(new BudgetGame({ level: "none" }).level, "normal");
  assert.ok(LINES.length >= 6 && LINES.length <= 8);
  assert.equal(money(6.8e9), "€6.8 bn");
  assert.equal(money(32.5e6), "€32.5 M");
  for (const level of Object.keys(LEVELS)) {
    for (const seed of SEEDS) {
      const g = new BudgetGame({ seed, level });
      g.begin({ round: 1, rounds: 3, phase: phase("plan") });
      const y = g.planning, asked = y.lines.reduce((a, l) => a + l.asked_eur, 0) + y.capital.need_eur;
      // the catalogue: rail titles of roughly €20–25 bn a year
      assert.ok(asked >= 20e9 && asked <= 25e9, `${level} ${seed}: ${asked}`);
      assert.equal(y.year, FIRST_YEAR);
      assert.ok(y.lines.every((l) => l.asked_eur % STEP_EUR === 0 && l.now_eur === l.asked_eur));
      // training: the draft fits; otherwise the ceiling is below it
      assert.equal(asked <= y.ceiling_eur, level === "training", `${level} ${seed}`);
      // hard: DB's capital need does not fit as a grant, whatever is cut from the padded lines
      const needs = y.lines.reduce((a, l) => a + (l.hint_eur ?? l.asked_eur), 0);
      assert.equal(needs + CAPITAL_EUR <= y.ceiling_eur, level !== "hard", `${level} ${seed}`);
      assert.ok(y.lines.some((l) => l.hint.startsWith("Bundesrechnungshof")));
    }
  }
});

test("the computer's rapporteur passes on every level, alone in a mission of a night session and a review a year", () => {
  const games = new Map([[BudgetGame.id, BudgetGame]]);
  assert.deepEqual(validateMission(ALONE, games), []);
  for (const level of Object.keys(LEVELS)) {
    for (const seed of SEEDS) {
      const doc = { ...ALONE, roles: [{ role: ROLE, game: "budget", level }] };
      const { session, result } = testRun(doc, games, { seed });
      const seat = result.seats[0], g = session.seat(ROLE).game;
      assert.equal(result.over, true);
      assert.equal(seat.rounds.length, 3);
      assert.ok(seat.passed && seat.score >= 85 && seat.worst < 3, `${level} ${seed}: ${seat.score}, worst ${seat.worst}`);
      assert.equal(g.violations.length, 0, `${level} ${seed}`);
      assert.ok(g.years.every((y) => y.adopted.within && y.adopted.demand_met && !y.account.stopped.length), `${level} ${seed}`);
      assert.ok([...g.answers.values()].every(Boolean) && g.answers.size >= 2);
      // each year the district's budget and the constituency's decision went out
      assert.deepEqual(result.flows, { budget: 3, "funding-decision": 3 });
    }
  }
  // four years by hand, as a page would
  for (const level of Object.keys(LEVELS)) {
    const res = play(new BudgetGame({ seed: 5, level }), 4).result();
    assert.ok(res.passed && res.score >= 85, `${level}: ${res.score}`);
  }
});

test("the same seed and moves give the same game; another seed another draft", () => {
  const a = play(new BudgetGame({ seed: 3, level: "hard" })), b = play(new BudgetGame({ seed: 3, level: "hard" }));
  assert.deepEqual(a.result(), b.result());
  assert.deepEqual(a.logs, b.logs);
  assert.deepEqual(a.outbox, b.outbox);
  assert.deepEqual(a.moves, b.moves);
  const c = play(new BudgetGame({ seed: 4, level: "hard" }));
  assert.notDeepEqual(a.years.map((y) => y.lines.map((l) => l.asked_eur)), c.years.map((y) => y.lines.map((l) => l.asked_eur)));
});

test("a careless rapporteur ends clearly worse; the coalition breaks when the partner is ignored two years running", () => {
  for (const level of Object.keys(LEVELS)) {
    for (const seed of [1, 4, 7]) {
      const good = play(new BudgetGame({ seed, level })).result(), bad = play(new BudgetGame({ seed, level }), 3, careless).result();
      assert.ok(bad.score <= good.score - 30, `${level} ${seed}: ${bad.score} against ${good.score}`);
    }
  }
  for (const seed of SEEDS) {
    const g = play(new BudgetGame({ seed, level: "hard" }), 3, careless), res = g.result();
    const v = g.violations.find((x) => x.rule === "coalition-broken");
    assert.equal(v?.severity, 3, `seed ${seed}`);
    assert.equal(res.passed, false);
    assert.equal(res.worst, 3);
    assert.ok(res.score < 50, `seed ${seed}: ${res.score}`);
    // it breaks in the second year's review: the game is over, no third night
    assert.equal(g.over, "The coalition breaks over the budget.");
    assert.equal(g.broken, true);
    assert.equal(g.years.length, 2);
    assert.deepEqual(g.act("cut", "digital", 1), { ok: false, reason: "The game is over." });
    // the district works on with last year's money (provisional budget management)
    const budgets = g.outbox.filter((m) => m.flow === "budget").map((m) => m.payload);
    assert.deepEqual(budgets.map((b) => b.year), [FIRST_YEAR, FIRST_YEAR + 1, FIRST_YEAR + 2]);
    assert.equal(budgets[2].renewal_eur, budgets[1].renewal_eur);
    assert.equal(g.view().actions.length, 0);
  }
  // the computer's rapporteur who gives the partner nothing: the same end, with everything else right
  const stubborn = (g) => {
    new BudgetPlayer().think(g);
    const y = g.planning;
    if (y) g.act("cut", y.demand.line, Math.round((y.lines.find((l) => l.id === y.demand.line).now_eur - y.demand.target_eur) / STEP_EUR) + 1);
  };
  const s = play(new BudgetGame({ seed: 2, level: "hard" }), 3, stubborn);
  assert.equal(s.years[0].adopted.demand_met, false);
  assert.equal(s.result().worst, 3);
  // one year ignored, the next not: the partner stays
  let n = 0;
  const once = play(new BudgetGame({ seed: 2, level: "hard" }), 3, (g) => (n++ === 0 ? stubborn(g) : new BudgetPlayer().think(g)));
  assert.equal(once.broken, false);
  assert.equal(once.result().worst, 0);
  assert.ok(once.result().parts.find((p) => p.id === "politics").value < 1);
});

test("a budget above the ceiling is not adopted: every line is cut by the same share, and the objective is lost", () => {
  const g = new BudgetGame({ seed: 2, level: "normal" });
  turn(g, "plan", nobody);
  const y = g.current;
  assert.equal(y.adopted.within, false);
  assert.ok(y.adopted.factor < 1 && y.adopted.factor > 0.9);
  for (const l of y.lines) assert.ok(Math.abs(y.adopted.lines[l.id] - l.asked_eur * y.adopted.factor) <= 1e6, l.id);
  assert.ok(y.adopted.total_eur <= y.ceiling_eur);
  assert.equal(g.objectives().find((p) => p.id === "ceiling").value, 0);
  assert.match(g.logs.map((l) => l.text).join("\n"), /not adopted: the committee cuts every line by/);
  // the partner's line was cut with the others
  assert.equal(y.adopted.demand_met, false);
  // within the ceiling: adopted as written
  const ok = new BudgetGame({ seed: 2, level: "normal" });
  turn(ok, "plan");
  assert.equal(ok.current.adopted.within, true);
  assert.deepEqual(ok.current.adopted.lines, Object.fromEntries(ok.current.lines.map((l) => [l.id, l.now_eur])));
  assert.equal(ok.objectives().find((p) => p.id === "ceiling").value, 1);
  assert.equal(ok.objectives().reduce((a, p) => a + p.weight, 0), 100);
});

test("the night gives the district's budget as the contract has it, and the constituency's funding decision", () => {
  for (const level of Object.keys(LEVELS)) {
    for (const seed of SEEDS) {
      // the draft adopted unchanged (training: it fits under the ceiling)
      const g = new BudgetGame({ seed, level: "training" });
      turn(g, "plan", nobody);
      const [b, f] = g.outbox;
      assert.equal(b.flow, "budget");
      assert.equal(b.from, ROLE);
      assert.deepEqual(Object.keys(b.payload), ["year", "maintenance_eur", "renewal_eur", "blocked_eur", "condition"]);
      assert.equal(b.payload.year, FIRST_YEAR);
      assert.ok(b.payload.maintenance_eur >= 8e6 && b.payload.maintenance_eur <= 12e6, `${seed}: ${b.payload.maintenance_eur}`);
      assert.ok(b.payload.renewal_eur >= 25e6 && b.payload.renewal_eur <= 40e6, `${seed}: ${b.payload.renewal_eur}`);
      assert.equal(b.payload.renewal_eur, DISTRICT_SHARE * g.current.adopted.lines.renewal);
      assert.equal(b.payload.blocked_eur, 0);
      assert.equal(b.payload.condition, null);
      assert.equal(f.flow, "funding-decision");
      assert.deepEqual(f.payload, { year: FIRST_YEAR, measure: `${PROJECT.name}, stage 1`, eur: PROJECT.stage_eur, approved: true });
      // with the computer's rapporteur the existing network is paid in full, on every level
      const c = new BudgetGame({ seed, level });
      turn(c, "plan");
      const p = c.outbox[0].payload, ren = c.current.lines.find((l) => l.id === "renewal");
      assert.ok(p.renewal_eur >= DISTRICT_SHARE * ren.asked_eur, `${level} ${seed}`);
      assert.ok(p.maintenance_eur >= 8e6 && p.maintenance_eur <= 13e6 && p.renewal_eur <= 40e6, `${level} ${seed}`);
    }
  }
  // the constituency's project left to wait: refused, nothing built
  const w = new BudgetGame({ seed: 1, level: "training" });
  turn(w, "plan", (g) => g.act("decide", `constituency-${FIRST_YEAR}`, "wait"));
  assert.deepEqual(w.outbox[1].payload, { year: FIRST_YEAR, measure: `${PROJECT.name}, stage 1`, eur: 0, approved: false });
  turn(w, "review", nobody);
  assert.equal(w.built, 0);
  // two stages at once: the press, and still one stage built
  const d = new BudgetGame({ seed: 1, level: "training" });
  turn(d, "plan", (g) => g.act("decide", `constituency-${FIRST_YEAR}`, "double"));
  turn(d, "review", nobody);
  assert.deepEqual(d.violations.map((v) => [v.rule, v.severity]), [["pork-barrel", 1]]);
  assert.equal(d.outbox[1].payload.eur, 2 * PROJECT.stage_eur);
  assert.equal(d.built, 1);
  assert.ok(d.current.account.lines.bedarfsplan.unspent_eur >= PROJECT.stage_eur);
});

test("a qualified block: with the auditors' finding it answers it; without one it only holds money back", () => {
  // without a finding, on the replacement money: a breach, and the district's money is blocked
  const g = new BudgetGame({ seed: 1, level: "training" });
  turn(g, "plan", (x) => {
    new BudgetPlayer().think(x);
    assert.equal(x.planning.issue, null);
    assert.deepEqual(x.act("block", "renewal", "condition-report"), { ok: true });
    assert.equal(x.act("block", "renewal", "soon").ok, false);
    assert.equal(x.act("block", "roads", "condition-report").ok, false);
  });
  assert.deepEqual(g.violations.map((v) => [v.rule, v.severity]), [["block-without-reason", 2]]);
  const b = g.outbox[0].payload;
  assert.equal(b.blocked_eur, BLOCK_SHARE * b.renewal_eur);
  assert.equal(b.condition, CONDITIONS.find((c) => c.id === "condition-report").label);
  turn(g, "review");
  const free = play(new BudgetGame({ seed: 1, level: "training" }), 1);
  assert.ok(g.current.account.lines.renewal.unspent_eur > free.current.account.lines.renewal.unspent_eur);
  assert.ok(g.current.account.grade > free.current.account.grade);
  assert.ok(g.result().score < free.result().score);
  // on a project line without a finding: a slip
  const slip = new BudgetGame({ seed: 1, level: "training" });
  turn(slip, "plan", (x) => {
    x.act("block", "digital", "cash-flow-plan");
    x.act("block", "corridors", "cash-flow-plan");
    assert.deepEqual(x.act("unblock", "corridors"), { ok: true });
    assert.equal(x.act("unblock", "corridors").ok, false);
  });
  assert.deepEqual(slip.violations.map((v) => [v.rule, v.severity]), [["block-without-reason", 1]]);
  assert.equal(slip.outbox[0].payload.blocked_eur, 0); // only a block on the replacement money reaches the district
  // the year the auditors recommend one (training: the second): blocked, the finding is answered; not blocked, the overruns are paid
  const with_ = play(new BudgetGame({ seed: 6, level: "training" }), 2);
  const without = play(new BudgetGame({ seed: 6, level: "training" }), 2, (x) => {
    new BudgetPlayer().think(x);
    if (x.planning?.issue) x.act("unblock", x.planning.issue.line);
  });
  const issue = with_.current.issue;
  assert.ok(issue && with_.current.blocks[issue.line] === issue.condition);
  assert.equal(with_.violations.length, 0);
  assert.equal(with_.current.account.waste_eur, 0);
  assert.ok(with_.current.account.lines[issue.line].blocked_eur > 0 && with_.current.account.lines[issue.line].founded);
  assert.equal(without.current.account.waste_eur, issue.waste_eur);
  assert.ok(without.current.account.share < with_.current.account.share);
  assert.ok(without.result().score < with_.result().score);
});

test("equity for DB stays outside the ceiling and makes the track access charges higher, year after year", () => {
  const g = new BudgetGame({ seed: 3, level: "normal" });
  g.begin({ round: 1, rounds: 3, phase: phase("plan") });
  const d = g.open.find((x) => x.id === `capital-${FIRST_YEAR}`);
  assert.equal(d.fallback, "grant");
  assert.match(d.options.find((o) => o.id === "equity").hint, /financial transaction: it does not count against the debt brake.*capital\s+base.*track access charges/);
  const before = g.total();
  assert.equal(g.charges(), 0);
  g.act("decide", d.id, "equity");
  assert.equal(g.total(), before - CAPITAL_EUR);
  assert.equal(g.charges(), EQUITY_RETURN * CAPITAL_EUR);
  // the draft fits now without a cut; the undertakings pay for it
  g.finish({ round: 1, rounds: 3, phase: phase("plan") });
  assert.equal(g.current.adopted.within, true);
  turn(g, "review", nobody);
  const a = g.current.account;
  assert.equal(a.charges_eur, 100e6);
  assert.ok(a.relief < 1);
  assert.match(g.logs.map((l) => l.text).join("\n"), /track access charges €100 M a year higher for the railway undertakings/);
  turn(g, "plan", (x) => x.act("decide", `capital-${FIRST_YEAR + 1}`, "equity"), 2);
  turn(g, "review", nobody, 2);
  assert.equal(g.current.account.charges_eur, 200e6);
  assert.ok(g.current.account.relief < a.relief);
  assert.ok(g.view().figures.some((f) => f.label === "Track access charges" && f.value === "€200 M a year higher"));
});

test("the year's account: money beyond what a line can spend stays unused and is carried over; a line cut too far stops a project", () => {
  // nobody moves money on training: the padded lines leave remainders, the existing network is short
  const g = new BudgetGame({ seed: 2, level: "training" });
  turn(g, "plan", nobody);
  turn(g, "review", nobody);
  const y = g.current, a = y.account;
  const padded = y.lines.filter((l) => l.kind === "project" && l.hint_eur != null);
  assert.equal(padded.length, 2);
  for (const l of padded) assert.equal(a.lines[l.id].unspent_eur, l.asked_eur - l.hint_eur, l.id);
  assert.ok(a.share < 0.98 && a.grade > 3.0 && a.stopped.length === 0);
  // next year the remainders are still there, and the auditors say so
  turn(g, "plan", nobody, 2);
  for (const l of padded) {
    const next = g.current.lines.find((x) => x.id === l.id);
    assert.equal(next.carry_eur, a.lines[l.id].unspent_eur);
    assert.match(next.hint, /remainders \(Ausgabereste\) from 2027 are still there/);
    assert.equal(next.hint_eur, Math.max(0, next.can_eur - next.carry_eur));
  }
  // a project line cut by a third: a project stops, and less of the money granted is missing than is spent
  const cut = new BudgetGame({ seed: 2, level: "training" });
  turn(cut, "plan", (x) => {
    new BudgetPlayer().think(x);
    const l = x.planning.lines.find((v) => v.id === "digital");
    assert.deepEqual(x.act("cut", "digital", Math.round(l.now_eur / STEP_EUR / 3)), { ok: true });
    assert.equal(x.act("cut", "digital", 99).ok, false);
    assert.equal(x.act("shift", "digital", "digital", 1).ok, false);
    assert.equal(x.act("raise", "digital", 0).ok, false);
  });
  turn(cut, "review");
  assert.equal(cut.current.account.stopped.length, 2);
  assert.ok(cut.objectives().find((p) => p.id === "railway").value < 0.7);
  // the existing network cut: the grade gets worse year by year
  const worn = play(new BudgetGame({ seed: 2, level: "training" }), 3, (x) => {
    new BudgetPlayer().think(x);
    if (x.planning) x.act("cut", "renewal", 10);
  });
  const grades = worn.years.map((v) => v.account.grade);
  assert.ok(grades[0] > 3.0 && grades[1] > grades[0] && grades[2] > grades[1], grades.join(" "));
});

test("the asset manager's report books the existing network, before the review and after it", () => {
  const report = (year, spent, unspent, grade = 3.5) => ({ flow: "performance-report", from: "asset-manager", t: 0, payload: { scope: "District Neustadt", kind: "infrastructure", year, grade, target: 3.2, faults_year: 60, delay_min_year: 9000, spent_eur: spent, unspent_eur: unspent, overtime_h: 120, score: 55 } });
  const own = play(new BudgetGame({ seed: 1, level: "normal" }), 1);
  // the report in the inbox when the review begins
  const g = new BudgetGame({ seed: 1, level: "normal" });
  turn(g, "plan");
  const b = g.outbox[0].payload, money_ = b.maintenance_eur + b.renewal_eur;
  g.receive(report(FIRST_YEAR, 0.75 * money_, 0.25 * money_));
  turn(g, "review");
  const a = g.current.account, o = own.current.account;
  assert.equal(a.reported, true);
  assert.equal(o.reported, false);
  assert.equal(a.grade, 3.5);
  assert.equal(a.target, 3.2);
  assert.equal(a.lines.renewal.spent_eur, 0.75 * a.lines.renewal.available_eur);
  assert.equal(a.lines.maintenance.unspent_eur, 0.25 * a.lines.maintenance.available_eur);
  assert.equal(o.lines.renewal.unspent_eur, 0);
  assert.equal(a.lines.digital.spent_eur, o.lines.digital.spent_eur); // the other lines stay the game's own
  assert.ok(g.result().score < own.result().score);
  assert.ok(g.view().tables.find((t) => t.id === "account").rows[0][4].includes("by the asset manager's report"));
  // the report after the review: the year is booked again
  const late = play(new BudgetGame({ seed: 1, level: "normal" }), 1);
  late.receive(report(FIRST_YEAR, 0.75 * money_, 0.25 * money_));
  assert.deepEqual(late.current.account, a);
  assert.deepEqual(late.result().parts, g.result().parts);
  assert.match(late.logs.at(-1).text, /the asset manager's report has come/);
  // a report of the year's money all spent and a grade at its target: as good as the game's own model, or better
  const fine = play(new BudgetGame({ seed: 1, level: "normal" }), 1);
  fine.receive(report(FIRST_YEAR, money_, 0, 3.1));
  assert.equal(fine.current.account.network, 1);
  assert.ok(fine.result().score >= own.result().score);
  // another kind of report, or one without a year adopted, changes nothing
  const other = play(new BudgetGame({ seed: 1, level: "normal" }), 1);
  other.receive({ flow: "performance-report", from: "signaller-relay", t: 0, payload: { scope: "Bf Neustadt", kind: "operations", trains: 9, delay_min: 30, score: 80 } });
  assert.deepEqual(other.current.account, o);
  const early = new BudgetGame({ seed: 1, level: "normal" });
  early.receive(report(FIRST_YEAR, 1, 1));
  assert.equal(early.inbox.length, 1);
  assert.equal(early.years.length, 0);
});

test("the questions: asked once at their moment, options in a drawn order, a right answer each", () => {
  const g = new BudgetGame({ seed: 1, level: "hard" });
  g.begin({ round: 1, rounds: 3, phase: phase("plan") });
  // hard: the partner points at the Regionalisierungsmittel, the auditors recommend a block in the first year
  assert.deepEqual(g.open.filter((d) => d.id.startsWith("quiz-")).map((d) => d.id), ["quiz-regionalisation", "quiz-block"]);
  assert.equal(g.rightAnswer("quiz-regionalisation"), "law");
  assert.equal(g.rightAnswer("quiz-block"), "committee");
  assert.equal(g.rightAnswer("quiz-carry-over"), "remainder");
  for (const d of g.open.filter((x) => x.id.startsWith("quiz-"))) {
    assert.equal(d.options.length, 3);
    assert.ok(d.fallback && d.fallback !== g.rightAnswer(d.id));
  }
  const orders = new Set(SEEDS.map((seed) => {
    const x = new BudgetGame({ seed, level: "hard" });
    x.begin({ round: 1, rounds: 3, phase: phase("plan") });
    return x.open.find((d) => d.id === "quiz-block").options.map((o) => o.id).join();
  }));
  assert.ok(orders.size > 1);
  // nobody answering counts as wrong; the computer answers right
  const silent = play(new BudgetGame({ seed: 1, level: "training" }), 2, nobody), right = play(new BudgetGame({ seed: 1, level: "training" }), 2);
  assert.deepEqual([...silent.answers], [["regionalisation", false], ["carry-over", false], ["block", false]]);
  assert.deepEqual([...right.answers], [["regionalisation", true], ["carry-over", true], ["block", true]]);
  assert.equal(silent.objectives().find((p) => p.id === "knowledge").value, 0);
  assert.equal(right.decisions.filter((d) => d.id.startsWith("quiz-")).length, 3);
});

test("the view: figures, tables and the night's moves; every move works through act with the first options", () => {
  const names = Object.keys(BudgetGame.actions);
  const check = (g) => {
    const v = g.view();
    assert.ok(Array.isArray(v.figures) && Array.isArray(v.tables) && Array.isArray(v.actions));
    for (const t of v.tables) assert.ok(t.id && t.title && t.columns.length && t.rows.every((r) => r.length === t.columns.length), t.id);
    for (const a of v.actions) {
      assert.ok(names.includes(a.name), a.name);
      for (const f of a.fields ?? []) if (f.options && !a.disabled) assert.ok(f.options.length > 0 && f.options.every((o) => o.id && o.label), `${a.name}.${f.id}`);
    }
    return v;
  };
  const g = new BudgetGame({ seed: 1, level: "normal" });
  assert.deepEqual(check(g).actions, []); // before the first night
  g.begin({ round: 1, rounds: 2, phase: phase("plan") });
  const v = check(g);
  assert.deepEqual(v.actions.map((a) => a.name), ["shift", "cut", "raise", "block"]);
  assert.equal(v.tables[0].rows.length, LINES.length + 2);
  assert.equal(v.figures.find((f) => f.label === "Total against the ceiling").tone, "bad");
  for (const a of v.actions) {
    const args = (a.fields ?? []).map((f) => (f.options ? f.options[0].id : f.type === "check" ? false : f.value));
    const res = g.act(a.name, ...args);
    assert.equal(typeof res.ok, "boolean", a.name);
    if (!res.ok) assert.ok(res.reason, a.name);
  }
  assert.deepEqual(g.act("shift", "digital", "renewal", 2), { ok: true });
  assert.deepEqual(g.moves.at(-1), { t: 0, name: "shift", args: ["digital", "renewal", 2] });
  // the block set above can be taken back
  const again = check(g);
  assert.deepEqual(again.actions.map((a) => a.name), ["shift", "cut", "raise", "block", "unblock"]);
  assert.deepEqual(g.act("unblock", again.actions.at(-1).fields[0].options[0].id), { ok: true });
  for (const d of g.open) assert.equal(g.act("decide", d.id, d.options[0].id), true);
  g.finish({ round: 1, rounds: 2, phase: phase("plan") });
  // adopted: nothing to move until the next night
  assert.deepEqual(check(g).actions, []);
  assert.equal(g.act("cut", "digital", 1).ok, false);
  turn(g, "review");
  const r = check(g);
  assert.equal(r.tables.find((t) => t.id === "account").rows.length, LINES.length);
  assert.equal(r.tables.find((t) => t.id === "years").rows.length, 1);
  assert.ok(r.figures.some((f) => f.label === `Money spent in ${FIRST_YEAR} (Mittelabfluss)`));
  assert.throws(() => g.act("adopt"), /no move "adopt"/);
});

test("phases as a mission may have them: a night of two phases, years without a review", () => {
  const g = new BudgetGame({ seed: 2, level: "normal" });
  const ctx = (id) => ({ round: 1, rounds: 2, phase: phase(id) });
  g.begin(ctx("budget"));
  g.begin(ctx("plan")); // the same night goes on
  assert.equal(g.years.length, 1);
  new BudgetPlayer().think(g);
  g.finish(ctx("budget"));
  g.finish(ctx("plan")); // adopted already
  assert.equal(g.outbox.filter((m) => m.flow === "budget").length, 1);
  // no review: the year is settled when the next night begins, and counts in the score before that
  assert.equal(g.current.account, null);
  assert.ok(g.result().score >= 85);
  g.begin(ctx("budget"));
  assert.equal(g.years.length, 2);
  assert.ok(g.years[0].account);
  assert.equal(g.years[1].year, FIRST_YEAR + 1);
});

/** A stand-in for the asset manager: takes the district's budget, spends nine tenths of what is not blocked, reports the year. */
class DistrictStub extends Game {
  static id = "district-stub";
  static role = "asset-manager";
  static scale = "years";
  static takes = [{ flow: "budget", from: [ROLE] }];
  static gives = [{ flow: "performance-report" }];

  finish(ctx) {
    const b = this.conditions.budget;
    if (ctx.phase.id !== "review" || !b) return;
    const all = b.maintenance_eur + b.renewal_eur, spent = Math.round(0.9 * (all - b.blocked_eur));
    this.give("performance-report", { scope: "District Neustadt", kind: "infrastructure", year: b.year, grade: 3.3, target: 3.2, faults_year: 40, delay_min_year: 6000, spent_eur: spent, unspent_eur: all - spent, overtime_h: 0, score: 70 });
  }
}

test("in a session with the asset manager's seat: the budget arrives there, the year's report comes back and is booked", () => {
  const games = new Map([[BudgetGame.id, BudgetGame], [DistrictStub.id, DistrictStub]]);
  const doc = mission(
    [{ role: ROLE, game: "budget", level: "hard" }, { role: "asset-manager", game: "district-stub" }],
    [{ id: "budget", kind: "turn", roles: [ROLE] }, { id: "plan", kind: "turn", roles: ["asset-manager"] }, { id: "review", kind: "turn", roles: ["asset-manager", ROLE] }],
  );
  assert.deepEqual(validateMission(doc, games), []);
  for (const seed of SEEDS) {
    const { session, result } = testRun(doc, games, { seed });
    assert.equal(result.over, true);
    assert.deepEqual(result.flows, { budget: 3, "funding-decision": 3, "performance-report": 3 });
    const g = session.seat(ROLE).game, stub = session.seat("asset-manager").game;
    assert.ok(g.isWired("budget") && g.isWired("performance-report") && !g.isWired("funding-decision"));
    const budgets = session.flows.filter((f) => f.flow === "budget");
    assert.ok(budgets.every((f) => f.seat === ROLE && f.to.join() === "asset-manager"));
    assert.deepEqual(budgets.map((f) => f.payload.year), [FIRST_YEAR, FIRST_YEAR + 1, FIRST_YEAR + 2]);
    assert.deepEqual(stub.conditions.budget, g.years[2].budget);
    // the first budget is what holds when the district's game begins; the later ones arrive as flows
    assert.equal(stub.inbox.filter((m) => m.flow === "budget").length, 2);
    assert.ok(session.flows.filter((f) => f.flow === "performance-report").every((f) => f.to.join() === ROLE));
    assert.equal(session.flows.find((f) => f.flow === "funding-decision").to.length, 0);
    for (const y of g.years) {
      assert.equal(y.report.year, y.year);
      assert.equal(y.account.reported, true);
      assert.equal(y.account.grade, 3.3);
      assert.ok(Math.abs(y.account.lines.renewal.spent_eur / y.account.lines.renewal.available_eur - y.report.spent_eur / (y.report.spent_eur + y.report.unspent_eur)) < 0.001);
      // a block on the district's replacement money is in the budget it got
      assert.equal(y.budget.blocked_eur > 0, !!y.blocks.renewal);
    }
    const seat = result.seats.find((s) => s.seat === ROLE);
    assert.ok(seat.passed && seat.score >= 50 && seat.worst < 3, `seed ${seed}: ${seat.score}`);
    // the district that leaves a tenth unspent costs the rapporteur money spent and the network's grade
    const alone = testRun({ ...ALONE, roles: [{ role: ROLE, game: "budget", level: "hard" }] }, new Map([[BudgetGame.id, BudgetGame]]), { seed }).result.seats[0];
    assert.ok(seat.score < alone.score, `seed ${seed}: ${seat.score} against ${alone.score}`);
  }
  // a person at the rapporteur's seat: the session waits for the night's moves and records them
  const s = new Session(normalizeMission(doc, games), { games, seed: 1, seats: { [ROLE]: "human" } }).start();
  assert.equal(s.waiting, true);
  assert.equal(s.phase.id, "budget");
  assert.deepEqual(s.act(ROLE, "cut", "digital", 2), { ok: true });
  s.next();
  assert.equal(s.phase.id, "review");
  assert.equal(s.record.length, 2);
  assert.equal(s.seat("asset-manager").game.conditions.budget.year, FIRST_YEAR);
});

test("with the asset manager's own game, when it is there", async (t) => {
  const file = fileURLToPath(new URL("../../web/arail/game/asset-manager.js", import.meta.url));
  if (!existsSync(file)) return t.skip("web/arail/game/asset-manager.js is not there yet");
  const mod = await import("../../web/arail/game/asset-manager.js");
  const Asset = Object.values(mod).find((x) => typeof x === "function" && x.role === "asset-manager" && x.prototype instanceof Game);
  assert.ok(Asset, "a game of the role asset-manager");
  const games = new Map([[BudgetGame.id, BudgetGame], [Asset.id, Asset]]);
  const doc = mission(
    [{ role: ROLE, game: "budget" }, { role: "asset-manager", game: Asset.id }],
    [{ id: "budget", kind: "turn", roles: [ROLE] }, { id: "plan", kind: "turn", roles: ["asset-manager"] }, { id: "review", kind: "turn", roles: ["asset-manager", ROLE] }],
  );
  const { session, result } = testRun(doc, games, { seed: 1 });
  assert.equal(result.over, true);
  const g = session.seat(ROLE).game, budgets = session.flows.filter((f) => f.flow === "budget");
  assert.equal(budgets.length, 3);
  assert.ok(budgets.every((f) => f.to.includes("asset-manager")));
  assert.deepEqual(session.seat("asset-manager").game.conditions.budget, g.years.at(-1).budget);
  // its yearly reports are booked in the rapporteur's accounts
  const reports = session.flows.filter((f) => f.flow === "performance-report" && f.payload.kind === "infrastructure" && f.to.includes(ROLE));
  assert.ok(reports.length >= 1, "the asset manager reports its year");
  assert.ok(g.years.some((y) => y.account?.reported));
  assert.ok(result.seats.find((s) => s.seat === ROLE).worst < 3);
});

test("the base player (every fallback) is no rapporteur: it passes training, not a ceiling below the draft", () => {
  const base = (g) => new Player().think(g);
  for (const seed of [1, 5]) {
    const t = play(new BudgetGame({ seed, level: "training" }), 3, base).result();
    assert.ok(t.passed && t.score < 80, `training ${seed}: ${t.score}`);
    const n = play(new BudgetGame({ seed, level: "normal" }), 3, base).result();
    assert.equal(n.passed, false, `normal ${seed}`);
  }
});
