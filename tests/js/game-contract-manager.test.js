// The transport authority's contract manager (web/arail/game/contract-manager.js): the rule of the
// account (no service, no pay; a penalty only in the operator's sphere), the incident list of a
// period and its decisions, objections, the auditor and lost disputes, the operator's finances
// under a harsh and under a lenient hand, the contract and the account as flows, the sampled shift.
import assert from "node:assert/strict";
import test from "node:test";

import { Game } from "../../web/arail/game/core.js";
import { CLASSES, CONTRACT, ContractGame, ContractPlayer, HEALTH, LEVELS, TERMS, consequence, ruleFor } from "../../web/arail/game/contract-manager.js";
import { normalizeMission, testRun } from "../../web/arail/game/mission.js";
import { Session } from "../../web/arail/game/session.js";

const ME = "transport-authority-contract-manager";
const games = new Map([[ContractGame.id, ContractGame]]);
const solo = (level, rounds = 6, extra = {}) => normalizeMission({
  format: "arail-mission/1", id: "malus", title: "Malus", text: "A test.", rounds,
  roles: [{ role: ME, game: "contract", level, ...extra }],
  phases: [{ id: "plan", kind: "turn", roles: [ME] }, { id: "review", kind: "turn", roles: [ME] }],
}, games);

/** Play a mission with a person's hand: `choose(game, decision)` for every open decision, then the turn ends. */
function play(mission, seed, choose, lib = games) {
  const s = new Session(mission, { games: lib, seed, seats: { [ME]: "human" } }).start();
  while (!s.over) {
    const g = s.seat(ME).game;
    for (const d of g.open) s.act(ME, "decide", d.id, choose(g, d));
    s.next();
  }
  return s;
}
const harsh = (g, d) => (d.id.startsWith("class-") ? "penalty" : d.id.startsWith("objection") ? "reject" : d.options[0].id);
const lenient = (g, d) => (d.id.startsWith("class-") ? d.options.at(-1).id : d.id.startsWith("objection") ? "accept" : d.options.at(-1).id);

test("the rule of the account: km not run are not paid whatever the cause; a penalty only in the operator's sphere", () => {
  const by = Object.fromEntries(CLASSES.map((c) => [c.id, c]));
  assert.deepEqual(CLASSES.map((c) => [c.id, ruleFor(c)]), [["no-driver", "penalty"], ["unit-failure", "penalty"], ["infrastructure", "unpaid"], ["late-own", "penalty"], ["late-others", "none"], ["short", "penalty"]]);
  assert.deepEqual(consequence(by["no-driver"], 100, "penalty"), { unpaid: 100 * TERMS.price_eur_km, penalty: 100 * CONTRACT.cancel_eur_km });
  assert.deepEqual(consequence(by.infrastructure, 100, "unpaid"), { unpaid: 1600, penalty: 0 });
  assert.deepEqual(consequence(by.infrastructure, 100, "paid"), { unpaid: 0, penalty: 0 });
  assert.deepEqual(consequence(by["late-own"], 10, "penalty"), { unpaid: 0, penalty: 10 * CONTRACT.late_eur });
  assert.deepEqual(consequence(by.short, 50, "penalty"), { unpaid: 0, penalty: 50 * CONTRACT.short_eur_km });
  assert.deepEqual(consequence(by.short, 50, "none"), { unpaid: 0, penalty: 0 });
  assert.ok(Math.abs(CLASSES.reduce((a, c) => a + c.rate, 0) - 0.107) < 1e-9);
});

test("alone: the computer applies the rule on every level and keeps the operator solvent; the same seed, the same periods", () => {
  for (const level of Object.keys(LEVELS)) {
    for (let seed = 1; seed <= 8; seed++) {
      const { session, result } = testRun(solo(level), games, { seed });
      const g = session.seat(ME).game;
      assert.ok(result.passed && result.seats[0].rounds.at(-1).score >= 90, `${level} ${seed}: ${result.seats[0].rounds.at(-1).score}`);
      assert.equal(g.periods.length, 6);
      assert.deepEqual(g.violations, []);
      assert.ok(g.health >= LEVELS[level].health - 0.02, `${level} ${seed}: ${g.health}`);
      for (const p of g.periods) {
        assert.equal(p.account.correct, p.account.asked);
        assert.equal(p.account.payment, p.account.right);
        assert.ok(p.account.payment > 0.95 * p.account.full && p.account.payment < p.account.full);
      }
    }
  }
  assert.deepEqual(testRun(solo("hard"), games, { seed: 3 }).result, testRun(solo("hard"), games, { seed: 3 }).result);
  assert.ok(new ContractPlayer() && ContractGame.scale === "months");
});

test("a harsh hand bleeds a tight operator dry; a lenient one is found by the auditor and spoils the quality", () => {
  for (const seed of [1, 2, 3]) {
    const h = play(solo("hard"), seed, harsh), g = h.seat(ME).game;
    assert.equal(g.health, 0, `seed ${seed}`);
    assert.ok(g.violations.some((v) => v.rule === "operator-insolvent" && v.severity === 3));
    assert.ok(g.violations.some((v) => v.rule === "penalty-outside-sphere" && v.severity === 1));
    assert.ok(g.over && g.periods.length <= 6);
    assert.equal(h.result().passed, false);
    // an ended game is asked nothing more, and the session still comes to its end
    assert.ok(h.over);
    const l = play(solo("normal"), seed, lenient), s = l.seat(ME).game;
    assert.ok(s.violations.some((v) => v.rule === "paid-not-run" && v.severity === 2));
    assert.ok(s.violations.some((v) => v.rule === "penalty-waived" && v.severity === 2));
    assert.ok(s.periods.at(-1).account.own > 2 * s.periods[0].account.own, "the operator's failures more than double");
    assert.ok(s.health > 0.9, "nothing is deducted: the operator is well");
    assert.ok(l.result().seats[0].rounds.at(-1).score < 45, String(l.result().seats[0].rounds.at(-1).score));
  }
  // below the threshold the operator cuts its own reserves: more failures of its own
  const cut = play(solo("hard"), 1, harsh).seat(ME).game;
  assert.ok(cut.periods.some((p) => p.account.health < HEALTH.cuts_below));
});

test("an objection: accepted with its evidence, rejected without; the other way round costs a finding or a lost dispute", () => {
  let seen = 0;
  for (let seed = 1; seed <= 30 && seen < 4; seed++) {
    const s = new Session(solo("hard", 1), { games, seed, seats: { [ME]: "human" } }).start();
    s.next();
    const g = s.seat(ME).game, p = g.current, o = p.objection;
    if (!o) continue;
    seen++;
    const d = g.open.find((x) => x.id === `objection-${p.n}`);
    assert.match(d.text, o.justified ? /attached/ : /No report|shows no such order|never filled/);
    assert.equal(g.advice(d.id), o.justified ? "accept" : "reject");
    // by the rule everywhere, but the objection decided the wrong way
    for (const x of g.open) s.act(ME, "decide", x.id, x.id === d.id ? (o.justified ? "reject" : "accept") : g.advice(x.id));
    s.next();
    assert.equal(p.account.correct, p.account.asked - 1);
    assert.deepEqual(g.violations.map((v) => [v.rule, v.severity]), [o.justified ? ["objection-rejected", 1] : ["objection-accepted", 2]]);
    assert.ok(o.justified ? p.account.payment < p.account.right : p.account.payment > p.account.right);
  }
  assert.ok(seen >= 3, `${seen} objections in 30 seeds`);
});

test("in a session: the contract goes out, the account goes out, and a sampled shift's reports shape the incident list", () => {
  /** An undertaking that reports its morning and takes the contract. */
  class Undertaking extends Game {
    static id = "undertaking";
    static role = "ru-control-dispatcher";
    static scale = "minutes";
    static takes = [{ flow: "transport-contract" }, { flow: "penalty" }, { flow: "payment" }];
    static gives = [{ flow: "performance-report" }];

    constructor(options = {}) {
      super(options);
      this.bad = !!options.bad;
      this.got = [];
    }

    take(msg) {
      this.got.push(msg.flow);
    }

    tick() {
      if (this.t >= 10) this.end("done");
    }

    finish() {
      this.give("performance-report", { kind: "undertaking", trips: 10, cancelled_km: this.bad ? 90 : 0, late_trips: this.bad ? 4 : 0, short_km: this.bad ? 60 : 0 });
    }
  }
  const lib = new Map([ContractGame, Undertaking].map((G) => [G.id, G]));
  const mission = (bad) => normalizeMission({
    format: "arail-mission/1", id: "years", title: "Years", text: "A test.", rounds: 2, year: 2030,
    roles: [{ role: ME, game: "contract", level: "training", options: { period: "year" } }, { role: "ru-control-dispatcher", game: "undertaking", options: { bad } }],
    phases: [{ id: "plan", kind: "turn", roles: [ME] }, { id: "shift", kind: "shift", roles: ["ru-control-dispatcher"], length: 20 }, { id: "review", kind: "turn", roles: [ME] }],
  }, lib);
  const good = testRun(mission(false), lib, { seed: 4 }).session, bad = testRun(mission(true), lib, { seed: 4 }).session;
  const g = good.seat(ME).game, b = bad.seat(ME).game;
  // a year: twelve times the km; the sampled morning's rates count a quarter
  assert.equal(g.periods[0].km, 12 * TERMS.km_month);
  assert.ok(g.periods[0].sampled && b.periods[0].sampled);
  const amount = (game, id) => game.periods[0].list.find((x) => x.id === id).amount;
  assert.ok(amount(b, "no-driver") > 5 * amount(g, "no-driver"), `${amount(b, "no-driver")} against ${amount(g, "no-driver")} km`);
  assert.ok(amount(b, "late-own") > 3 * amount(g, "late-own"));
  assert.ok(amount(b, "short") > 3 * amount(g, "short"));
  // the flows: the contract before the first shift; the penalty, the payment and the account after each review
  const flows = good.flows.map((f) => [f.flow, f.from, f.payload.kind ?? f.payload.year ?? ""]);
  assert.deepEqual(flows[0], ["transport-contract", ME, ""]);
  assert.deepEqual(good.flows[0].payload, CONTRACT);
  assert.deepEqual(flows.filter((f) => f[1] === ME).map((f) => f[0]), ["transport-contract", "penalty", "payment", "performance-report", "penalty", "payment", "performance-report"]);
  const rep = good.flows.filter((f) => f.flow === "performance-report" && f.from === ME).map((f) => f.payload);
  assert.deepEqual(rep.map((r) => [r.kind, r.year]), [["contract", 2030], ["contract", 2031]]);
  assert.ok(rep[0].punctual_share > 0.85 && rep[0].cancelled_share < 0.03 && rep[0].operator_health > 0.7 && rep[0].penalties_eur > 0);
  // the undertaking's shift begins with the contract as what holds (a state), and with the last period's money as its mail
  const und = good.seat("ru-control-dispatcher").game;
  assert.deepEqual(und.conditions["transport-contract"], CONTRACT);
  assert.deepEqual(und.got, ["penalty", "payment"]);
});

test("the view: the incident list while it is decided, the periods settled", () => {
  const s = new Session(solo("normal", 2), { games, seed: 2, seats: { [ME]: "human" } }).start();
  let v = s.seat(ME).game.view();
  assert.deepEqual([v.figures.length, v.tables.map((t) => t.rows.length), v.actions], [4, [0, 0], []]);
  s.next();
  const g = s.seat(ME).game;
  v = g.view();
  assert.equal(v.tables[0].rows.length, g.current.list.filter((x) => x.amount).length);
  assert.ok(v.tables[0].rows.every((r) => r[2] === "to decide"));
  assert.match(v.tables[0].title, /period 1/);
  for (const d of g.open) s.act(ME, "decide", d.id, g.advice(d.id));
  assert.ok(g.view().tables[0].rows.some((r) => r[2] === "not paid, and a penalty"));
  s.next();
  v = g.view();
  assert.equal(v.tables[1].rows.length, 1);
  assert.match(v.tables[1].rows[0].join(" | "), /^1 \| \d\d\.\d % \| \d\.\d\d % \| €1,9\d\d,\d\d\d \| €\d\d,\d\d\d \| \d of \d$/);
  assert.equal(v.figures[0].value, "sound");
});
