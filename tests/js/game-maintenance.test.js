// The maintenance dispatcher's game (web/arail/game/maintenance.js) alone and wired to the
// signaller's: the roads of the district, faults by their report paths, teams of two trades, the
// closure asked for before work in the track (and the danger without it), what a team finds (the
// cause, not known before), the dispatcher's word on it (for good, provisionally, secure, leave), a
// provisional repair that does not hold, the technicians on call, the score, and that the choices
// matter; with the signaller: the fault report, the team's steps and the closure as flows, the
// signal that fails again, the staff plan and the condition of the assets as what a slower role
// left them with, a connection held on request.
import assert from "node:assert/strict";
import test from "node:test";

import {
  DIAGNOSE_S, DISTRICT, FAULTS, GAMES, MAINTENANCE_LEVELS, MISSION_FORMAT, MaintenanceGame, MaintenancePlayer, ON_CALL, SignallerAutopilot, SignallerGame, TRADES, driveTime, failureChance, likely, normalizeMission, play, validateMission,
} from "../../web/arail/game/index.js";

/** Play a game alone to its end with a player's `think` before every half second. */
function alone(g, player = new (g.constructor.player)()) {
  while (!g.over) {
    player.think(g);
    g.step(0.5);
  }
  return g;
}

/** Step a game until `done` says so (or the game is over). */
function until(g, done, dt = 1) {
  while (!g.over && !done()) g.step(dt);
  return g;
}

/** A game of a level whose shift brings the fault `id`: the first seed that does. */
function gameWith(id, level = "normal", options = {}) {
  for (let seed = 1; seed < 200; seed++) {
    const g = new MaintenanceGame({ seed, level, ...options });
    if (g.fault(id)) return g;
  }
  throw new Error(`no shift with ${id}`);
}

/** What a team will find at a fault, set for a test: the cause with this text, with a provisional repair that holds or does not. */
function cause(g, id, text, relapse = null) {
  const f = g.fault(id), c = f.causes.find((x) => x.text.includes(text));
  assert.ok(c, `${id}: ${text}`);
  f.cause = relapse == null || !c.quick ? c : { ...c, quick: { ...c.quick, relapse } };
  return f;
}

const MORNING = {
  format: MISSION_FORMAT, id: "morning", title: "Morning", text: "A test.",
  roles: [{ role: "signaller-relay", game: "signaller" }, { role: "maintenance-dispatcher", game: "maintenance" }],
};

test("the district: every fault's place is on the map; the roads from the base and between places", () => {
  for (const f of FAULTS) assert.ok(DISTRICT.places[f.place], f.place);
  assert.equal(new Set(FAULTS.map((f) => f.id)).size, FAULTS.length);
  assert.equal(driveTime("Bf Neustadt", "Bf Neustadt", true), 300); // from the base to the station's own signal: the signaller's five minutes
  assert.equal(driveTime("Talsee", "Talsee"), 120);
  assert.equal(driveTime("Bf Neustadt", "Bergheim", true), 180 + 40 * 10);
  assert.equal(driveTime("Talsee", "Waldau"), 180 + 40 * 17); // by way of Bf Neustadt
});

test("the faults: what each can turn out to be adds up; the trades from experience", () => {
  for (const f of FAULTS) {
    assert.ok(Math.abs(f.causes.reduce((a, c) => a + c.p, 0) - 1) < 1e-9, f.id);
    for (const c of f.causes) {
      assert.ok(c.trade === "any" || TRADES.includes(c.trade), `${f.id}: ${c.trade}`);
      assert.ok(c.work_s >= 120 && (!c.quick || (c.quick.work_s < c.work_s && c.quick.relapse > 0 && c.quick.relapse < 1)), `${f.id}: ${c.text}`);
    }
    // a danger can be secured by any team
    assert.equal(!!f.secure, f.safety, f.id);
  }
  assert.deepEqual(likely(FAULTS.find((f) => f.id === "w12")), [{ trade: "track", p: 0.4 }, { trade: "any", p: 0.35 }, { trade: "signalling", p: 0.25 }]);
  assert.deepEqual(likely(FAULTS.find((f) => f.id === "bue")), [{ trade: "signalling", p: 0.8 }, { trade: "any", p: 0.2 }]);
  // over many shifts a fault's causes come as often as experience says
  const seen = new Map();
  for (let seed = 1; seed <= 400; seed++) {
    const f = new MaintenanceGame({ seed, level: "training" }).fault("N2");
    seen.set(f.cause.text, (seen.get(f.cause.text) ?? 0) + 1);
  }
  for (const c of new MaintenanceGame({ seed: 1 }).fault("N2").causes) assert.ok(Math.abs(seen.get(c.text) / 400 - c.p) < 0.08, `${c.text}: ${seen.get(c.text)} of 400`);
});

test("alone: the computer's dispatcher breaks no rule and passes nearly every shift; the same seed gives the same shift", () => {
  for (const level of Object.keys(MAINTENANCE_LEVELS)) {
    let passed = 0, sum = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const g = alone(new MaintenanceGame({ seed, level }));
      const res = g.result();
      assert.equal(res.violations, 0, `${level} ${seed}`);
      passed += res.passed ? 1 : 0;
      sum += res.score;
      // alone it brings the signaller's fault itself
      const n2 = g.fault("N2");
      assert.ok(n2 && !n2.remote, `${level} ${seed}`);
    }
    // a night with more faults than teams is not always won, least of all with one team
    assert.ok(passed >= { training: 20, normal: 18, hard: 15 }[level], `${level}: ${passed} of 20 passed`);
    assert.ok(sum / 20 >= { training: 78, normal: 68, hard: 58 }[level], `${level}: ${sum / 20} on average`);
  }
  const a = alone(new MaintenanceGame({ seed: 4, level: "hard" })), b = alone(new MaintenanceGame({ seed: 4, level: "hard" }));
  assert.deepEqual(a.result(), b.result());
  assert.deepEqual(a.logs, b.logs);
  assert.notDeepEqual(a.logs, alone(new MaintenanceGame({ seed: 5, level: "hard" })).logs);
});

test("a team in the track: the closure is asked for first, then the team looks for the cause; sent in without it, the shift fails", () => {
  const g = new MaintenanceGame({ seed: 1, level: "training" });
  const f = cause(g, "N2", "burnt out");
  g.step(800);
  assert.equal(f.state, "open");
  assert.deepEqual(g.act("send", "T9", "N2"), { ok: false, reason: "There is no such team." });
  assert.deepEqual(g.act("send", "T1", "N2"), { ok: true });
  assert.match(g.act("send", "T1", "N2").reason, /on the road/);
  assert.match(g.act("send", "T2", "N2").reason, /already has a team/);
  assert.deepEqual(g.outbox.at(-1).payload, { fault: "N2", asset: "Exit signal N2", place: "Bf Neustadt", state: "dispatched", eta_s: 300, team: "Team M. Specht", since_s: 0 });
  g.step(301);
  // on site, the work is in G2: a decision; nobody decides: after 90 s the team asks itself
  assert.equal(g.teams[0].state, "waiting");
  assert.deepEqual(g.open.map((d) => d.id), ["closure-N2"]);
  g.step(91);
  assert.equal(f.closure, "asked");
  assert.deepEqual(g.outbox.at(-1).flow, "closure-request");
  // closed: the team looks for the cause; what it finds has one way only, so it starts
  until(g, () => f.closure === "closed");
  assert.deepEqual([g.teams[0].state, f.known, g.can(g.teams[0], f)], ["diagnosing", false, null]);
  g.step(DIAGNOSE_S);
  assert.deepEqual([f.state, f.known, g.can(g.teams[0], f), g.can(g.teams[1], f)], ["working", true, true, false]);
  g.step(f.cause.work_s);
  assert.equal(f.state, "done");
  assert.deepEqual(g.violations, []);
  assert.deepEqual(g.outbox.filter((m) => m.payload.fault === "N2").map((m) => m.payload.state ?? m.flow), ["reported", "dispatched", "arrived", "closure-request", "diagnosed", "working", "done"]);
  // the district's own fault is a status from its report on: its story has a beginning also when no team is ever sent
  assert.deepEqual(g.outbox.find((m) => m.payload.fault === "N2").payload, { fault: "N2", asset: "Exit signal N2", place: "Bf Neustadt", state: "reported", safety: false, holds: 4 });
  assert.deepEqual(g.outbox.find((m) => m.payload.state === "diagnosed").payload, { fault: "N2", asset: "Exit signal N2", place: "Bf Neustadt", state: "diagnosed", cause: "the lamp is burnt out", trade: "signalling", eta_s: 240, team: "Team M. Specht", since_s: DIAGNOSE_S });
  // the account of the shift names what the fault did
  g.finish();
  assert.deepEqual(g.outbox.at(-1).payload.effects.filter((e) => e.fault === "N2"), [{ fault: "N2", text: `held or slowed about 1 train (4 an hour, for ${Math.round(g.outage(f) / 60)} min)` }]);

  const rash = new MaintenanceGame({ seed: 1, level: "training" });
  rash.step(800);
  rash.act("send", "T1", "N2");
  rash.step(301);
  rash.act("decide", "closure-N2", "start");
  assert.deepEqual(rash.violations.map((v) => [v.rule, v.severity]), [["track-without-closure", 3]]);
  alone(rash);
  assert.equal(rash.result().passed, false);
  assert.equal(rash.objectives().find((o) => o.id === "safety").value, 0);
});

test("what a team finds is the dispatcher's to decide: for good or provisionally; a provisional repair may not hold", () => {
  const start = (relapse) => {
    const g = new MaintenanceGame({ seed: 1, level: "training" });
    const f = cause(g, "N2", "water in the housing", relapse);
    until(g, () => f.state === "open");
    g.act("send", "T1", "N2");
    until(g, () => g.open.some((d) => d.id === "closure-N2"));
    g.act("decide", "closure-N2", "ask");
    until(g, () => g.open.some((d) => d.id === "plan-N2"));
    return { g, f };
  };
  // before the team has looked, nobody knows; the table says what experience says
  const fresh = new MaintenanceGame({ seed: 1, level: "training" });
  until(fresh, () => fresh.fault("N2").state === "open");
  const row = fresh.view().tables[0].rows.find((r) => r[0] === "Exit signal N2");
  assert.deepEqual(row.slice(5, 8), ["not known; from experience signalling 100 %", "4 to 14 min", "waits for a team"]);
  assert.match(fresh.logs.at(-1).text, /From experience a case for: signalling 100 %\.$/);

  // the plan: for good (12 min) or provisionally (4 min, may fail again); the team waits for the word
  const { g, f } = start(0);
  const d = g.open.find((x) => x.id === "plan-N2");
  assert.equal(d.title, "Team M. Specht at Exit signal N2: water in the housing has corroded the lamp holder.");
  assert.deepEqual(d.options, [{ id: "full", label: "Repair it for good: about 12 min" }, { id: "quick", label: "Put in a new lamp only: about 4 min, but it may fail again" }]);
  assert.deepEqual([g.teams[0].state, d.fallback], ["deciding", "full"]);
  assert.match(g.view().tables[1].rows[0][2], /waits at Exit signal N2 for your word/);
  const t0 = g.t;
  assert.equal(g.act("decide", "plan-N2", "quick"), true);
  assert.deepEqual([f.state, f.quick, g.teams[0].until], ["working", true, t0 + 240]);
  until(g, () => f.state === "done");
  assert.deepEqual([f.provisional, f.relapseAt, g.stats().provisional], [true, null, 1]);
  assert.match(g.logs.at(-1).text, /repaired provisionally/);
  assert.equal(g.outbox.at(-1).payload.provisional, true);
  // it held: but it is left for the day shift, and counts less than a repair for good
  const dealt = (x) => x.objectives().find((o) => o.id === "faults");
  alone(g, { think() {} });
  assert.match(dealt(g).note, /1 of them provisionally/);

  // nobody decides: the team repairs it for good
  const slow = start(0);
  until(slow.g, () => slow.f.state === "working");
  assert.deepEqual([slow.f.quick, slow.g.decisions.find((x) => x.id === "plan-N2").auto], [false, true]);

  // it does not hold: the fault is back, its cause known; the minutes out of order add up
  const bad = start(1);
  bad.g.act("decide", "plan-N2", "quick");
  until(bad.g, () => bad.f.state === "done");
  const first = bad.f.out_s, again = bad.f.relapseAt;
  assert.ok(first > 0 && again >= bad.g.t + 240 && again <= bad.g.t + 600);
  assert.equal(bad.g.outage(bad.f), first);
  until(bad.g, () => bad.f.state === "open");
  assert.deepEqual([bad.f.relapses, bad.f.known, bad.f.done, bad.f.since, bad.f.closure], [1, true, null, again, "none"]);
  assert.equal(bad.g.outbox.at(-1).payload.state, "relapsed");
  assert.match(bad.g.logs.at(-1).text, /has failed again: the provisional repair did not hold/);
  assert.match(bad.g.view().tables[0].rows.find((r) => r[0] === "Exit signal N2")[7], /^failed again, waits for a signalling team$/);
  bad.g.step(120);
  assert.equal(bad.g.outage(bad.f), first + 120);
  // the team that comes knows the cause: after the closure the word is asked for at once
  bad.g.act("send", "T1", "N2");
  until(bad.g, () => bad.g.open.some((x) => x.id === "closure-N2"));
  bad.g.act("decide", "closure-N2", "ask");
  until(bad.g, () => bad.f.closure === "closed");
  assert.deepEqual(bad.g.open.map((x) => x.id), ["plan-N2"]);
  bad.g.act("decide", "plan-N2", "full");
  until(bad.g, () => bad.f.state === "done");
  assert.deepEqual([bad.f.provisional, bad.f.relapseAt, bad.g.stats().relapses], [false, null, 1]);
  assert.match(bad.g.objectives().find((o) => o.id === "restore").note, /1 provisional repair did not hold/);
});

test("the trades: a team of the other trade finds the cause and leaves; a danger it can secure until the right team comes", () => {
  // a track team at the failed signal: it can only say what it is
  const g = new MaintenanceGame({ seed: 1, level: "training" });
  const n2 = cause(g, "N2", "burnt out");
  assert.deepEqual(g.teams.map((tm) => [tm.name, tm.trade]), [["Team M. Specht", "signalling"], ["Team L. Kranich", "track"]]);
  until(g, () => n2.state === "open");
  g.act("send", "T2", "N2");
  until(g, () => g.open.some((d) => d.id === "closure-N2"));
  g.act("decide", "closure-N2", "ask");
  until(g, () => n2.known);
  assert.deepEqual([n2.state, g.teams[1].state, g.teams[1].place, g.open.length], ["open", "ready", "Bf Neustadt", 0]);
  assert.match(g.logs.at(-1).text, /Team L\. Kranich leaves Exit signal N2 and G2: a signalling team must repair it\./);
  assert.equal(g.outbox.at(-1).payload.state, "left");
  // now it is known: the track team is not sent again, and the map does not offer it
  assert.equal(g.act("send", "T2", "N2").reason, "Team L. Kranich is a track team: Exit signal N2 needs a signalling team.");
  const dot = () => g.view().sketch.items.find((it) => it.id === "fault-N2");
  assert.deepEqual(dot().menu.map((m) => m.label), ["Send Team M. Specht (signalling, 5 min)"]);
  g.act("send", "T1", "N2");
  // the closure still holds: the signalling team starts at once on what is known
  until(g, () => n2.state === "working");
  assert.equal(g.open.length, 0);
  assert.equal(dot().menu, undefined);

  // a danger: the crossing at Waldau, a signalling fault; the track team is the first there
  const x = gameWith("bue", "normal", { length: 6000 });
  const bue = cause(x, "bue", "switch-on contact");
  until(x, () => bue.state === "open");
  assert.equal(x.exposed(bue), true);
  assert.equal(x.view().figures.find((f) => f.label === "Dangers unguarded").value, x.faults.filter((f) => x.exposed(f)).length);
  x.act("send", "T2", "bue");
  until(x, () => x.open.some((d) => d.id === "plan-bue"));
  const exposed = bue.exposed_s;
  assert.ok(Math.abs(exposed - (x.t - bue.reported - DIAGNOSE_S)) < 2, `${exposed} s unguarded on the way`);
  assert.deepEqual(x.open.find((d) => d.id === "plan-bue").options.map((o) => [o.id, o.label]), [["secure", "Stay and guard the crossing by hand until a signalling team comes"], ["leave", "Leave it to a signalling team and be free again"]]);
  x.act("decide", "plan-bue", "secure");
  assert.deepEqual([bue.state, bue.secured, x.teams[1].state, x.exposed(bue)], ["secured", "T2", "securing", false]);
  x.step(200);
  assert.equal(bue.exposed_s, exposed);
  assert.match(x.view().tables[0].rows.find((r) => r[0] === "Level crossing Waldau")[7], /^secured by Team L\. Kranich, waits for a signalling team$/);
  // called off, the place is a danger again; a team that secures cannot be sent elsewhere
  assert.match(x.act("send", "T2", "bue").reason, /securing a place/);
  assert.ok(x.view().actions.some((a) => a.name === "recall" && a.fields[0].options[0].id === "T2"));
  assert.deepEqual(x.act("recall", "T2"), { ok: true });
  assert.deepEqual([bue.state, bue.secured, x.teams[1].state, x.exposed(bue)], ["open", null, "ready", true]);
  assert.match(x.act("recall", "T2").reason, /does not secure a place/);
  // sent again to the danger (it cannot repair it, but it can guard it), it stays; the signalling team repairs, and the guard is free
  assert.deepEqual(x.act("send", "T2", "bue"), { ok: true });
  until(x, () => x.open.some((d) => d.id === "plan-bue"));
  x.act("decide", "plan-bue", "secure");
  until(x, () => x.teams[0].state === "ready");
  assert.deepEqual(x.act("send", "T1", "bue"), { ok: true });
  assert.match(x.view().tables[0].rows.find((r) => r[0] === "Level crossing Waldau")[7], /is on the way; Team L\. Kranich secures it$/);
  until(x, () => bue.state === "working");
  assert.deepEqual([bue.team, bue.secured, x.teams[1].state, x.teams[1].fault], ["T1", null, "ready", null]);
  until(x, () => bue.state === "done");
  assert.equal(bue.by, "T1");
});

test("the technicians on call: one of each trade, ready at the base after a while, paid as overtime; a lazy dispatcher scores low", () => {
  const g = new MaintenanceGame({ seed: 2, level: "hard" });
  assert.deepEqual([g.teams.length, g.onCall], [1, { signalling: "available", track: "available" }]);
  assert.deepEqual(g.view().actions.find((a) => a.name === "callIn").fields[0].options, [{ id: "signalling", label: "S. Kartal (signalling)" }, { id: "track", label: "J. Sokół (track)" }]);
  assert.deepEqual(g.act("callIn", "track"), { ok: true });
  assert.match(g.act("callIn", "track").reason, /already called/);
  assert.match(g.act("callIn", "catenary").reason, /no such trade/);
  assert.equal(g.value("overtime"), ON_CALL.hours);
  assert.deepEqual(g.view().actions.find((a) => a.name === "callIn").fields[0].options.map((o) => o.id), ["signalling"]);
  g.step(ON_CALL.ready_s + 1);
  assert.deepEqual(g.teams.map((tm) => [tm.name, tm.trade, tm.state, tm.overtime]), [["Team M. Specht", "signalling", "ready", false], ["J. Sokół", "track", "ready", true]]);
  assert.deepEqual(g.act("callIn"), { ok: true });
  assert.deepEqual([g.value("overtime"), g.onCall], [2 * ON_CALL.hours, { signalling: "called", track: "in" }]);
  assert.equal(g.view().actions.some((a) => a.name === "callIn"), false);
  // overtime that repaired nothing costs more than overtime that did
  const cost = (x) => x.objectives().find((o) => o.id === "cost");
  assert.match(cost(g).note, /^8 h, not all of it for a repair$/);
  assert.ok(cost(g).value < 0.5);
  // nobody sends anybody: the faults stay open
  const lazy = alone(new MaintenanceGame({ seed: 2, level: "normal" }), { think() {} });
  assert.ok(lazy.result().score < 45, String(lazy.result().score));
  assert.equal(lazy.stats().done, 0);
  assert.ok(lazy.result().score < alone(new MaintenanceGame({ seed: 2, level: "normal" })).result().score - 30);
});

test("the choices matter: the nearest team whatever its trade, and nobody called in, loses to the computer's simple rules", () => {
  /** The nearest free team to whatever waits, the first way with whatever it finds, no technician. */
  class Nearest extends MaintenancePlayer {
    think(g) {
      for (const d of g.open) g.act("decide", d.id, d.id.startsWith("closure-") ? "ask" : d.options[0].id);
      for (const f of g.faults.filter((x) => x.state === "open" || x.state === "secured")) {
        for (const tm of g.teams.filter((x) => x.state === "ready").sort((a, b) => g.eta(a, f) - g.eta(b, f))) if (g.act("send", tm.id, f.id).ok) break;
      }
    }
  }
  let rules = 0, nearest = 0, done = 0, doneNearest = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const a = alone(new MaintenanceGame({ seed, level: "hard" })), b = alone(new MaintenanceGame({ seed, level: "hard" }), new Nearest());
    rules += a.result().score;
    nearest += b.result().score;
    done += a.stats().done;
    doneNearest += b.stats().done;
  }
  assert.ok(rules / 20 > nearest / 20 + 10, `${rules / 20} against ${nearest / 20}`);
  assert.ok(done > doneNearest + 10, `${done} against ${doneNearest} faults repaired`);
});

test("the view for a page that does not know the game: figures, tables, moves with their fields", () => {
  const g = new MaintenanceGame({ seed: 3 });
  while (!g.over) {
    const v = g.view();
    assert.ok(v.figures.length && v.tables.length === 2);
    assert.deepEqual(v.tables.map((t) => t.columns.length), [8, 3]);
    for (const t of v.tables) for (const row of t.rows) assert.equal(row.length, t.columns.length);
    for (const a of v.actions) {
      assert.ok(Object.hasOwn(MaintenanceGame.actions, a.name), a.name);
      if (!a.disabled) for (const f of a.fields ?? []) assert.ok(f.options?.length, `${a.name}.${f.id}`);
    }
    // a person who tries the choices of the fields in their order (a team of the wrong trade is refused), and takes the first way
    const send = v.actions.find((a) => a.name === "send" && !a.disabled);
    if (send) send.fields[1].options.some((f) => send.fields[0].options.some((tm) => g.act("send", tm.id, f.id).ok));
    for (const d of g.open) g.act("decide", d.id, d.options[0].id);
    g.step(1);
  }
  assert.ok(g.stats().done >= 2);
  assert.match(g.view().tables[0].rows[0].join(" | "), /\d\d:\d\d/);
});

test("wired to the signaller: the fault report, the team's steps and the closure travel as flows", () => {
  const s = play(MORNING, { seed: 1 }).run();
  const sig = s.seat("signaller-relay").game, mt = s.seat("maintenance-dispatcher").game;
  // each plays the other's part no longer
  assert.equal(sig.team.remote, true);
  assert.equal(mt.fault("N2").remote, true);
  assert.ok(!mt.faults.some((f) => f.id !== "N2" && f.asset === "Exit signal N2"));
  const steps = s.flows.filter((f) => f.payload.fault === "N2" || f.payload.track === "G2").map((f) => `${f.flow}${f.payload.state ? `:${f.payload.state}` : f.payload.closed != null ? `:${f.payload.closed}` : ""}`);
  assert.deepEqual(steps, ["fault-report", "repair-status:dispatched", "repair-status:arrived", "track-closure:true", "closure-request", "repair-status:diagnosed", "repair-status:working", "repair-status:done", "track-closure:false"]);
  // the signaller hears what the team found, and how long the repair takes
  assert.ok(sig.logs.some((l) => l.text.includes(`The repair team at N2: ${mt.fault("N2").cause.text}; a repair for good takes about`)));
  // the signal was repaired by the dispatcher's team, at the time the dispatcher's game says
  assert.equal(sig.failure.repaired, mt.fault("N2").done);
  assert.equal(sig.team.state, "left");
  assert.equal(sig.signals.N2.failed, false);
  const res = s.result();
  assert.ok(res.passed, JSON.stringify(res.seats.map((x) => [x.seat, x.score])));
  // both give their account of the shift
  const reports = s.flows.filter((f) => f.flow === "performance-report").map((f) => f.payload);
  assert.deepEqual(reports.map((r) => r.kind), ["operations", "maintenance"]);
  assert.ok(reports[0].faults === 1 && reports[0].restore_min > 5 && reports[0].trains === 9);
  assert.ok(reports[1].faults >= 2 && reports[1].restore_min > 0 && reports[1].exposed_min >= 0 && reports[1].relapses === 0);
  // the dispatcher's closure requests for other signallers' tracks are not this signaller's
  assert.ok(s.flows.some((f) => f.flow === "closure-request" && f.payload.track !== "G2") || mt.faults.every((f) => f.id === "N2" || !f.track || f.closure === "none"));
  assert.equal(sig.logs.filter((l) => l.text.includes("asks for track G2 to be closed")).length, 1);
});

test("wired: a provisional repair that does not hold; the signal fails again, the signaller's shift goes on until it is dealt with", () => {
  const s = play(MORNING, { seed: 1, seats: { "maintenance-dispatcher": "human" } }).start();
  const sig = s.seat("signaller-relay").game, mt = s.seat("maintenance-dispatcher").game;
  // a dispatcher who takes the quick way with a signal that will not hold the first time, and holds the second
  const dispatcher = () => {
    const n2 = mt.fault("N2");
    if (n2 && n2.state !== "working") cause(mt, "N2", "water in the housing", n2.relapses ? 0 : 1);
    for (const d of mt.open) s.act("maintenance-dispatcher", "decide", d.id, d.id === "plan-N2" ? "quick" : d.id.startsWith("closure-") ? "ask" : d.options[0].id);
    if (n2?.state === "open" && mt.teams[0].state === "ready") s.act("maintenance-dispatcher", "send", "T1", "N2");
  };
  while (!s.over) {
    dispatcher();
    s.step(1);
  }
  const n2 = mt.fault("N2");
  assert.deepEqual([n2.relapses, n2.state, n2.provisional], [1, "done", true]);
  const states = s.flows.filter((f) => f.flow === "repair-status" && f.payload.fault === "N2").map((f) => f.payload.state);
  assert.deepEqual(states, ["dispatched", "arrived", "diagnosed", "working", "done", "relapsed", "dispatched", "arrived", "working", "done"], mt.logs.map((l) => l.text).join("\n"));
  // the signaller: repaired provisionally, failed again, repaired; the track closed and opened twice; no rule broken
  const told = sig.logs.filter((l) => l.kind === "fault").map((l) => l.text).join("\n");
  assert.match(told, /signal N2 repaired provisionally \(it may fail again\)/);
  assert.match(told, /Signal N2 shows no proceed aspect again: the provisional repair did not hold/);
  assert.deepEqual(s.flows.filter((f) => f.flow === "track-closure").map((f) => f.payload.closed), [true, false, true, false]);
  assert.deepEqual([sig.failure.relapses, sig.failure.provisional, sig.signals.N2.failed, sig.team.state], [1, true, false, "left"]);
  assert.match(sig.view().figures.at(-1).value, /^repaired provisionally$/);
  assert.equal(sig.failure.repaired, n2.done);
  assert.deepEqual(sig.violations, []);
  // the last train left long before: the shift went on to its end, since a provisional repair may not hold
  assert.ok(Math.max(...sig.trains.map((tr) => tr.departed ?? tr.passed ?? 0)) < 2000);
  assert.equal(sig.t, 2400);
  // the questions about the closure were asked once
  assert.equal(sig.decisions.filter((d) => d.id === "quiz-closure").length, 1);
});

test("wired: a dispatcher who never sends a team leaves the signaller with the failure for the whole shift", () => {
  const s = play(MORNING, { seed: 1, seats: { "maintenance-dispatcher": "human" } }).start();
  while (!s.over) s.step(10);
  const sig = s.seat("signaller-relay").game;
  // what led to what tells every fault, also those no team was ever sent to: all of their time was the dispatcher's
  const mt0 = s.seat("maintenance-dispatcher").game, told = s.threads();
  assert.deepEqual(told.map((th) => th.fault).sort(), mt0.faults.filter((f) => f.reported != null).map((f) => f.id).sort());
  assert.ok(told.length >= 3);
  for (const th of told) {
    const f = mt0.fault(th.fault);
    assert.equal(th.state, "open");
    assert.deepEqual(th.stretches.map((x) => [x.kind, x.by, x.open, x.to]), [["unsent", "maintenance-dispatcher", true, 2400]], th.fault);
    assert.ok(Math.abs(th.out_s - mt0.outage(f, 2400)) < 2 || f.remote, `${th.fault}: ${th.out_s}`);
    if (!f.remote) assert.ok(th.effects.includes("not repaired when the shift ended"), th.fault);
    if (!f.remote && f.safety) assert.ok(th.effects.some((e) => /^a danger without anybody there for \d+ min$/.test(e)), th.fault);
    if (!f.remote && f.holds) assert.ok(th.effects.some((e) => /^held or slowed about \d+ trains?/.test(e)), th.fault);
  }
  assert.equal(sig.team.state, "called");
  assert.equal(sig.failure.repaired, null);
  assert.equal(sig.signals.N2.failed, true);
  // the shift went to its end, the failure open
  assert.equal(sig.t, 2400);
  // the train in G2 got out on the substitute signal; the later ones were kept off G2 to the end
  assert.equal(sig.value("zs1"), 1);
  assert.ok(sig.trains.filter((tr) => tr.track && tr.track !== tr.plan).length >= 2);
  // the signaller did their part; the shift's loss is the dispatcher's, and the whole's
  const idle = s.result(), quick = play(MORNING, { seed: 1 }).run().result();
  const of = (res, seat) => res.seats.find((x) => x.seat === seat).score;
  assert.ok(of(idle, "signaller-relay") >= of(quick, "signaller-relay") - 3);
  assert.ok(of(idle, "maintenance-dispatcher") < 45 && of(quick, "maintenance-dispatcher") > 65, `${of(idle, "maintenance-dispatcher")}, ${of(quick, "maintenance-dispatcher")}`);
  assert.ok(idle.score < quick.score - 20);
});

test("what a slower role left them with: the staff plan sets the teams, the condition of the assets the faults", () => {
  const withConditions = (conditions, seed = 1) => {
    const s = play({ ...MORNING, conditions }, { seed }).run();
    return { sig: s.seat("signaller-relay").game, mt: s.seat("maintenance-dispatcher").game, res: s.result() };
  };
  const one = withConditions({ "staff-plan": { teams: 1, on_call: false } });
  assert.deepEqual([one.mt.teams.map((tm) => tm.trade), one.mt.onCall], [["signalling"], { signalling: "none", track: "none" }]);
  assert.match(one.mt.callIn("track").reason, /Nobody is on call/);
  const three = withConditions({ "staff-plan": { teams: 3, on_call: true } });
  assert.deepEqual(three.mt.teams.filter((tm) => !tm.overtime).map((tm) => tm.trade), ["signalling", "track", "signalling"]);
  // more teams repair more
  let few = 0, many = 0;
  for (let seed = 1; seed <= 10; seed++) {
    few += withConditions({ "staff-plan": { teams: 1, on_call: false } }, seed).mt.stats().done;
    many += withConditions({ "staff-plan": { teams: 3, on_call: true } }, seed).mt.stats().done;
  }
  assert.ok(many > few + 8, `${many} faults repaired with three teams, ${few} with one`);
  // good assets: hardly a failed signal, few faults; worn assets: nearly always, many
  assert.equal(failureChance(1.5), 0.05);
  assert.equal(failureChance(2.75), 0.5);
  assert.equal(failureChance(5), 0.95);
  let good = 0, worn = 0, fGood = 0, fWorn = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const a = withConditions({ "asset-condition": { grade: 1.8 } }, seed), b = withConditions({ "asset-condition": { grade: 4.2 } }, seed);
    good += a.sig.failure ? 1 : 0;
    worn += b.sig.failure ? 1 : 0;
    fGood += a.mt.faults.length;
    fWorn += b.mt.faults.length;
  }
  assert.ok(good <= 3 && worn >= 17, `${good} of 20 with good assets, ${worn} of 20 with worn ones`);
  assert.ok(fWorn > fGood + 40, `${fGood} faults with good assets, ${fWorn} with worn ones`);
});

test("the signaller's ports alone: delays told, a train held on request, the account of the shift", () => {
  const p = new SignallerAutopilot();
  // RB 31 comes three minutes late, RB 32 on time
  const late = () => {
    const x = new SignallerGame({ seed: 3, level: "training" });
    x.trains.find((tr) => tr.id === "RB 31").enterAt = 210;
    return x;
  };
  const g = late();
  // the undertaking asks to hold RB 32 for RB 31
  g.receive({ flow: "connection-request", from: "ru-control-dispatcher", t: 0, payload: { hold: "RB 32", for: "RB 31", minutes: 8 } });
  assert.deepEqual(g.state().holds, [{ train: "RB 32", for: "RB 31", until: 210 + 480 }]); // up to 8 min beyond its departure at 08:03:30
  while (!g.over) {
    p.think(g);
    g.step(0.5);
  }
  const by = Object.fromEntries(g.trains.map((tr) => [tr.id, tr]));
  assert.ok(by["RB 32"].departed >= by["RB 31"].arrived + 30, "RB 32 waited for the passengers of RB 31");
  assert.ok(by["RB 32"].departed < by["RB 31"].arrived + 60, "and left once they had changed");
  assert.equal(g.connections()[0].kept, true);
  // without the request the computer's signaller lets RB 32 go at its time
  const h = late();
  while (!h.over) {
    p.think(h);
    h.step(0.5);
  }
  assert.equal(h.connections()[0].kept, false);
  // the delays went out as notices, the account at the end
  const notices = g.outbox.filter((m) => m.flow === "delay-notice").map((m) => m.payload);
  assert.ok(notices.some((n) => n.train === "RB 31" && n.stage === "approaching" && n.connection === "RB 32" && n.delay_min >= 1));
  assert.ok(notices.some((n) => n.train === "RB 32" && n.stage === "departed"));
  g.finish();
  const rep = g.outbox.at(-1);
  assert.deepEqual([rep.flow, rep.payload.kind, rep.payload.scope, rep.payload.trains], ["performance-report", "operations", "Bf Neustadt", 9]);
  // the moves of a page go through `act` and are kept
  const m = new SignallerGame({ level: "training" });
  assert.deepEqual(m.act("setRoute", "A-G2"), { ok: true });
  assert.deepEqual(m.act("zs1", "N1", true, true, "lamp").ok, true);
  assert.deepEqual(m.moves.map((x) => x.name), ["setRoute", "zs1"]);
  const v = m.view();
  assert.ok(v.actions.some((a) => a.name === "setRoute" && a.fields[0].options.length > 3));
  for (const a of v.actions) assert.ok(Object.hasOwn(SignallerGame.actions, a.name), a.name);
  assert.equal(GAMES.get("signaller"), SignallerGame);
  assert.deepEqual(normalizeMission(MORNING, GAMES).phases.map((ph) => [ph.kind, ph.roles]), [["shift", ["signaller-relay", "maintenance-dispatcher"]]]);
});

test("the district as a sketch: a fault that waits has the free teams as its menu; the team is on the road, then at the place", () => {
  const g = new MaintenanceGame({ seed: 3 });
  const tags = () => g.view().sketch.items.filter((it) => it.kind === "tag");
  const dots = () => g.view().sketch.items.filter((it) => it.id?.startsWith("fault-"));
  const base = DISTRICT.places[DISTRICT.base].map;
  assert.equal(dots().length, 0);
  assert.deepEqual(tags().map((it) => [it.text, it.tone, it.x]), [["M. Specht (S)", "idle", base[0]], ["L. Kranich (T)", "idle", base[0]]]);
  until(g, () => g.faults.some((f) => f.state === "open" && f.place !== DISTRICT.base));
  const f = g.faults.find((x) => x.state === "open" && x.place !== DISTRICT.base);
  let dot = dots().find((it) => it.id === `fault-${f.id}`);
  assert.deepEqual(dot.menu.map((m) => m.name), ["send", "send"]);
  assert.match(dot.menu[0].label, /^Send Team M\. Specht \(signalling, \d+ min\)$/);
  assert.match(dot.title, /waits for a team$/);
  // the move from the menu, as the page makes it
  assert.deepEqual(g.act(dot.menu[0].name, ...dot.menu[0].args), { ok: true });
  dot = dots().find((it) => it.id === `fault-${f.id}`);
  assert.equal(dot.menu, undefined);
  assert.match(dot.title, /is on the way$/);
  // on the road: between the base and the place, nearer to the place with the time
  const [px, py] = DISTRICT.places[f.place].map, far = (it) => Math.hypot(it.x - px, it.y - py);
  const tm = g.teams.find((x) => x.fault === f.id);
  const van = () => tags().find((it) => it.text.startsWith(tm.name.replace("Team ", "")));
  g.step(1);
  assert.equal(van().tone, "train");
  const d0 = far(van());
  for (let i = 0; i < 300; i++) g.step(1);
  assert.ok(far(van()) < d0 && far(van()) > 0, `${d0} → ${far(van())}`);
  until(g, () => tm.state !== "driving");
  assert.ok(["warn", "ok"].includes(van().tone));
  // every item lies on the map
  const sk = g.view().sketch;
  for (const it of sk.items) for (const k of ["x", "y", "x1", "y1", "x2", "y2"]) if (k in it) assert.ok(it[k] >= 0 && it[k] <= (k.startsWith("x") ? sk.width : sk.height), `${it.kind} ${k} ${it[k]}`);
  // no team free: the fault's menu says so
  const hard = new MaintenanceGame({ seed: 3, level: "hard" });
  const open = () => hard.faults.filter((x) => x.state === "open");
  until(hard, () => open().length > 0);
  hard.act("send", "T1", open()[0].id);
  until(hard, () => open().length > 0);
  assert.equal(hard.view().sketch.items.find((it) => it.id === `fault-${open()[0].id}`).menu[0].disabled, "No team is free.");
});

test("the shift's clock: the dispatcher's game tells the time by it; a mission cannot move the signaller's morning", () => {
  const night = alone(new MaintenanceGame({ seed: 2, level: "training", clock: "02:30" }));
  assert.equal(night.start, 2.5 * 3600);
  assert.match(night.logs[0].text, /^02:30 The shift begins/);
  assert.match(night.logs.at(-1).text, /^03:10: the shift is over\.$/);
  assert.ok(night.logs.every((l) => /^0[23]:\d\d/.test(l.text)), night.logs.find((l) => !/^0[23]:\d\d/.test(l.text))?.text);
  assert.match(night.view().tables[0].rows[0][3], /^0[23]:\d\d$/);
  // without one, 08:00 as before
  assert.match(new MaintenanceGame({ seed: 2 }).logs[0].text, /^08:00 /);
  // in a session the clock is the phase's
  const doc = { format: MISSION_FORMAT, id: "night", title: "Night", text: "A test.", roles: [{ role: "maintenance-dispatcher", game: "maintenance" }], phases: [{ id: "shift", kind: "shift", roles: ["maintenance-dispatcher"], length: 600, clock: "22:15" }] };
  assert.deepEqual(validateMission(doc, GAMES), []);
  const s = play(doc, { seed: 1 }).run();
  assert.match(s.seat("maintenance-dispatcher").game.logs[0].text, /^22:15 The shift begins/);
  // the signaller's timetable is the morning's: a shift with it at another time is not sound
  assert.equal(SignallerGame.clock, "08:00");
  const late = { ...MORNING, phases: [{ id: "shift", kind: "shift", roles: ["signaller-relay", "maintenance-dispatcher"], length: 2400, clock: "09:00" }] };
  assert.deepEqual(validateMission(late, GAMES), ['phase shift: the shift begins at 09:00, but signaller-relay\'s game ("signaller") begins at 08:00']);
  assert.deepEqual(validateMission({ ...late, phases: [{ ...late.phases[0], clock: "08:00" }] }, GAMES), []);
  assert.deepEqual(validateMission(MORNING, GAMES), []);
});
