// The maintenance dispatcher's game (web/arail/game/maintenance.js) alone and wired to the
// signaller's: the roads of the district, faults by their report paths, teams sent, the closure
// asked for before work in the track (and the danger without it), the technician on call, the score;
// with the signaller: the fault report, the team's steps and the closure as flows, the staff plan
// and the condition of the assets as what a slower role left them with, a connection held on request.
import assert from "node:assert/strict";
import test from "node:test";

import {
  DISTRICT, FAULTS, GAMES, MAINTENANCE_LEVELS, MISSION_FORMAT, MaintenanceGame, MaintenancePlayer, ON_CALL, SignallerAutopilot, SignallerGame, driveTime, failureChance, normalizeMission, play,
} from "../../web/arail/game/index.js";

/** Play a game alone to its end with a player's `think` before every half second. */
function alone(g, player = new (g.constructor.player)()) {
  while (!g.over) {
    player.think(g);
    g.step(0.5);
  }
  return g;
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

test("alone: the computer's dispatcher passes every level; the same seed gives the same shift", () => {
  for (const level of Object.keys(MAINTENANCE_LEVELS)) {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const g = alone(new MaintenanceGame({ seed, level }));
      const res = g.result();
      assert.ok(res.passed && res.violations === 0, `${level} ${seed}: ${res.score}`);
      assert.ok(res.score >= { training: 90, normal: 70, hard: 55 }[level], `${level} ${seed}: ${res.score}`);
      // alone it brings the signaller's fault itself and closes the track itself (on hard, one team may not get to it)
      const n2 = g.fault("N2");
      assert.ok(n2 && !n2.remote, `${level} ${seed}`);
      if (level !== "hard") assert.ok(n2.closure === "closed" && n2.done != null, `${level} ${seed}`);
    }
  }
  const a = alone(new MaintenanceGame({ seed: 4, level: "hard" })), b = alone(new MaintenanceGame({ seed: 4, level: "hard" }));
  assert.deepEqual(a.result(), b.result());
  assert.deepEqual(a.logs, b.logs);
  assert.notDeepEqual(a.logs, alone(new MaintenanceGame({ seed: 5, level: "hard" })).logs);
});

test("a team in the track: the closure is asked for first; sent in without it, the shift fails", () => {
  const g = new MaintenanceGame({ seed: 1, level: "training" });
  g.step(800);
  const f = g.fault("N2");
  assert.equal(f.state, "open");
  assert.deepEqual(g.act("send", "T9", "N2"), { ok: false, reason: "There is no such team." });
  assert.deepEqual(g.act("send", "T1", "N2"), { ok: true });
  assert.match(g.act("send", "T1", "N2").reason, /on the road/);
  assert.match(g.act("send", "T2", "N2").reason, /already has a team/);
  assert.deepEqual(g.outbox.at(-1).payload, { fault: "N2", asset: "Exit signal N2", place: "Bf Neustadt", state: "dispatched", eta_s: 300, team: "Team M. Specht" });
  g.step(301);
  // on site, the work is in G2: a decision; nobody decides: after 90 s the team asks itself
  assert.equal(g.teams[0].state, "waiting");
  assert.deepEqual(g.open.map((d) => d.id), ["closure-N2"]);
  g.step(91);
  assert.equal(f.closure, "asked");
  assert.deepEqual(g.outbox.at(-1).flow, "closure-request");
  g.step(160);
  assert.equal(f.state, "working");
  g.step(f.work_s);
  assert.equal(f.state, "done");
  assert.deepEqual(g.violations, []);
  assert.deepEqual(g.outbox.filter((m) => m.payload.fault === "N2").map((m) => m.payload.state ?? m.flow), ["dispatched", "arrived", "closure-request", "working", "done"]);

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

test("the technician on call: ready at the base after a while, paid as overtime; a lazy dispatcher scores low", () => {
  const g = new MaintenanceGame({ seed: 2, level: "hard" });
  assert.equal(g.teams.length, 1);
  assert.deepEqual(g.act("callIn"), { ok: true });
  assert.match(g.act("callIn").reason, /already called/);
  assert.equal(g.value("overtime"), ON_CALL.hours);
  g.step(ON_CALL.ready_s + 1);
  assert.deepEqual(g.teams.map((tm) => [tm.name, tm.state, tm.overtime]), [["Team M. Specht", "ready", false], ["S. Kartal", "ready", true]]);
  // nobody sends anybody: the faults stay open
  const lazy = alone(new MaintenanceGame({ seed: 2, level: "normal" }), { think() {} });
  assert.ok(lazy.result().score < 45, String(lazy.result().score));
  assert.equal(lazy.stats().done, 0);
  assert.ok(lazy.result().score < alone(new MaintenanceGame({ seed: 2, level: "normal" })).result().score - 30);
});

test("the view for a page that does not know the game: figures, tables, moves with their fields", () => {
  const g = new MaintenanceGame({ seed: 3 });
  for (let i = 0; i < 1700; i++) {
    const v = g.view();
    assert.ok(v.figures.length && v.tables.length === 2);
    for (const a of v.actions) {
      assert.ok(Object.hasOwn(MaintenanceGame.actions, a.name), a.name);
      if (!a.disabled) for (const f of a.fields ?? []) assert.ok(f.options?.length, `${a.name}.${f.id}`);
    }
    // a person who always takes the first choice of every field
    const send = v.actions.find((a) => a.name === "send" && !a.disabled);
    if (send) assert.deepEqual(g.act("send", ...send.fields.map((f) => f.options[0].id)), { ok: true });
    for (const d of g.open) g.act("decide", d.id, "ask");
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
  assert.deepEqual(steps, ["fault-report", "repair-status:dispatched", "repair-status:arrived", "track-closure:true", "closure-request", "repair-status:working", "repair-status:done", "track-closure:false"]);
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
  assert.ok(reports[1].faults >= 2 && reports[1].restore_min > 0);
});

test("wired: a dispatcher who never sends a team leaves the signaller with the failure for the whole shift", () => {
  const s = play(MORNING, { seed: 1, seats: { "maintenance-dispatcher": "human" } }).start();
  while (!s.over) s.step(10);
  const sig = s.seat("signaller-relay").game;
  assert.equal(sig.team.state, "called");
  assert.equal(sig.failure.repaired, null);
  assert.equal(sig.signals.N2.failed, true);
  // the train in G2 got out on the substitute signal; the later ones were kept off G2 to the end
  assert.equal(sig.value("zs1"), 1);
  assert.ok(sig.trains.filter((tr) => tr.track && tr.track !== tr.plan).length >= 2);
  // the signaller did their part; the shift's loss is the dispatcher's, and the whole's
  const idle = s.result(), quick = play(MORNING, { seed: 1 }).run().result();
  const of = (res, seat) => res.seats.find((x) => x.seat === seat).score;
  assert.ok(of(idle, "signaller-relay") >= of(quick, "signaller-relay") - 3);
  assert.ok(of(idle, "maintenance-dispatcher") < 45 && of(quick, "maintenance-dispatcher") > 80, `${of(idle, "maintenance-dispatcher")}, ${of(quick, "maintenance-dispatcher")}`);
  assert.ok(idle.score < quick.score - 20);
});

test("what a slower role left them with: the staff plan sets the teams, the condition of the assets the faults", () => {
  const withConditions = (conditions, seed = 1) => {
    const s = play({ ...MORNING, conditions }, { seed }).run();
    return { sig: s.seat("signaller-relay").game, mt: s.seat("maintenance-dispatcher").game, res: s.result() };
  };
  const one = withConditions({ "staff-plan": { teams: 1, on_call: false } });
  assert.deepEqual([one.mt.teams.length, one.mt.onCall], [1, "none"]);
  const three = withConditions({ "staff-plan": { teams: 3, on_call: true } });
  assert.equal(three.mt.teams.filter((tm) => !tm.overtime).length, 3);
  assert.ok(three.mt.stats().restore_min < one.mt.stats().restore_min, `${three.mt.stats().restore_min} < ${one.mt.stats().restore_min}`);
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
