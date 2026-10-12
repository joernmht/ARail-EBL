// The game core and the signaller's game (web/arail/game/): decisions with deadlines and the score;
// the interlocking of Bf Neustadt (routes, conflicts, points, signals, approach locking, release
// behind the train, closed tracks); trains braking for signals and stopping at their platform; the
// failed signal with the substitute signal, the fault report, the closure for the repair team; a
// careful and a careless signaller; the same game for the same moves.
import assert from "node:assert/strict";
import test from "node:test";

import { CONNECTIONS, Game, LEVELS, STATION, SignallerGame, TIMETABLE, ZS1_MS, clockOf } from "../../web/arail/game/index.js";

/** Step a game by `seconds` in steps of `dt`, calling `each` before every step. */
function run(g, seconds, each = null, dt = 1) {
  const end = g.t + seconds;
  while (g.t < end - 1e-9 && !g.over) {
    each?.(g);
    g.step(dt);
  }
}

/**
 * A careful signaller: routes as planned (G2 closed: another track), the freight train waits for the
 * intercity, departures at their time, the failure reported at once, Zs 1 with its checks, the
 * closure for the repair team and the track opened after the team's report, every question right.
 */
function careful(g) {
  for (const d of g.open) {
    if (d.id.startsWith("quiz-")) g.decide(d.id, d.options[0].id);
    else if (d.id === "report") g.decide("report", "now");
  }
  if (g.team.state === "waiting") g.closeTrack("G2");
  if (g.team.state === "done") g.openTrack("G2");
  for (const tr of g.trains) {
    if (tr.state === "gone") continue;
    const sig = tr.state === "coming" ? (tr.dir > 0 ? "A" : "F") : g.nextSignal(tr);
    if (!sig) continue;
    const r = g.routeFrom(sig);
    if (r) {
      const ready = tr.state !== "dwelling" || (tr.dwell >= 40 && g.t >= tr.dep);
      if (g.signals[sig].failed && !g.signals[sig].zs1 && tr.state !== "coming" && r.state === "locked" && ready && g.distanceTo(tr, sig) < 100) {
        g.substitute(sig, { routeChecked: true, trackChecked: true, reason: "lamp" });
      }
      continue;
    }
    if (tr.state === "coming" && (g.t < tr.enterAt - 60 || g.trains.some((x) => x !== tr && x.state === "running" && g.nextSignal(x) === sig))) continue;
    if (sig === "A" || sig === "F") {
      // G2 is kept free for the repair team from the report until the team has left
      const repair = g.failure?.reported != null && g.team.state !== "left";
      const plan = (repair || g.closed.has("g2")) && tr.plan === "G2" ? (tr.dir > 0 ? "G1" : "G3") : tr.plan;
      g.setRoute(`${sig}-${plan}`);
      continue;
    }
    if (tr.id === "GZ 47" && !g.trains.find((x) => x.id === "IC 2045").passed) continue;
    if (tr.stops && (tr.state !== "dwelling" || g.t < tr.dep - 20)) continue;
    g.setRoute(`${sig}-${tr.dir > 0 ? "T" : "B"}`);
  }
}

test("the game core: resources, decisions with a deadline and a fallback, rules broken, the score and the result", () => {
  class Quiz extends Game {
    static id = "quiz";
    static role = "student";
    objectives() {
      return [{ id: "a", label: "A", weight: 3, value: 1 }, { id: "b", label: "B", weight: 1, value: 0 }];
    }
  }
  const g = new Quiz({ seed: 7 });
  g.resource("money", "Budget", 1000, "€");
  assert.equal(g.add("money", -250), 750);
  assert.throws(() => g.add("time", 1), /Unknown resource/);
  let chosen = null;
  g.ask({ id: "pick", title: "Pick one", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }], within: 10, fallback: "y", then: (o) => (chosen = o) });
  assert.equal(g.open.length, 1);
  assert.equal(g.decide("pick", "z"), false); // no such option
  g.step(5);
  assert.equal(chosen, null);
  g.step(6);
  assert.equal(chosen, "y"); // the deadline passed: the fallback
  assert.equal(g.decisions[0].auto, true);
  assert.deepEqual(g.score(), { total: 75, parts: g.objectives() });
  g.violate("rule", "A slip", 1);
  assert.equal(g.result().passed, true);
  g.violate("danger", "A danger", 3);
  const res = g.result();
  assert.equal(res.passed, false); // a danger to people fails the round whatever the score
  assert.equal(res.worst, 3);
  assert.deepEqual(res.decisions, [{ id: "pick", option: "y", at: 10, auto: true }]);
  // random streams are the same for the same seed and keys
  assert.equal(new Quiz({ seed: 7 }).rng("a").next(), g.rng("a").next());
  g.end("done");
  g.step(10);
  assert.equal(g.t, 11); // over: no more steps
});

test("the station of the game: every route's sections and points exist, signals stand at their sections", () => {
  const secs = Object.keys(STATION.sections);
  for (const r of STATION.routes) {
    assert.ok(STATION.signals[r.from], r.id);
    for (const s of r.sections) assert.ok(secs.includes(s), `${r.id}: ${s}`);
    for (const p of Object.keys(r.points)) assert.ok(r.sections.includes(STATION.points[p].section), `${r.id}: ${p} in its sections`);
    // a route from a signal begins where the signal's section ends
    assert.notEqual(r.sections[0], STATION.signals[r.from].section, r.id);
  }
  for (const s of Object.values(STATION.signals)) assert.ok(secs.includes(s.section));
  // a 600 m freight train fits a platform track
  for (const t of ["g1", "g2", "g3"]) assert.ok(STATION.sections[t].len >= 600 + 50);
  assert.equal(clockOf(0), "08:00:00");
  assert.equal(clockOf(781.6), "08:13:02");
  assert.ok(TIMETABLE.every((t) => ["G1", "G2", "G3"].includes(t.plan)));
  assert.ok(CONNECTIONS.every(([a, b]) => TIMETABLE.some((t) => t.id === a) && TIMETABLE.some((t) => t.id === b)));
});

test("the interlocking: conflicting routes are refused, points move and lock, the signal clears", () => {
  const g = new SignallerGame({ level: "training" });
  assert.deepEqual(g.setRoute("A-G2"), { ok: true });
  assert.equal(g.aspect("A").aspect, "stop"); // the points are still moving
  assert.equal(g.state().points.W1.moving, true);
  g.step(7);
  assert.equal(g.aspect("A").aspect, "proceed");
  assert.equal(g.points.W1.pos, "-");
  // routes through the same sections, or from the same signal, are refused
  assert.match(g.setRoute("P2-B").reason, /locked by route A-G2/);
  assert.match(g.setRoute("F-G2").reason, /Track G2 is locked by route A-G2/);
  assert.match(g.setRoute("A-G1").reason, /A route from A is already set/);
  assert.deepEqual(g.setRoute("N1-T"), { ok: true }); // nothing in common
  // no train near A: the route can be cancelled; the signal goes back to stop
  assert.deepEqual(g.cancelRoute("A-G2"), { ok: true });
  assert.equal(g.aspect("A").aspect, "stop");
  assert.equal(g.value("cancel"), 1);
  // a closed track takes no route
  assert.deepEqual(g.closeTrack("G3"), { ok: true });
  assert.match(g.setRoute("A-G3").reason, /Track G3 is closed/);
  assert.deepEqual(g.openTrack("G3"), { ok: true });
  assert.deepEqual(g.setRoute("A-G3"), { ok: true });
});

test("a train brakes for a signal at stop, takes its route, stops at its platform, and the sections behind it are released", () => {
  const g = new SignallerGame({ level: "training" });
  run(g, 120);
  const rb = g.trains.find((t) => t.id === "RB 31");
  assert.equal(rb.state, "running");
  assert.equal(rb.v, 0); // in front of entry signal A, at stop
  assert.equal(g.distanceTo(rb, "A") <= 12, true);
  assert.ok(rb.caution.has("A")); // warned at the distant signal
  g.setRoute("A-G2");
  run(g, 120);
  assert.equal(rb.state, "dwelling");
  assert.equal(rb.track, "G2");
  // the entry route is released behind the train up to the platform track it stands on
  const r = g.routes.get("A-G2");
  assert.deepEqual([...r.sections], ["g2"]);
  assert.equal(g.state().points.W1.locked, false);
  // its exit: it waits for its departure time and the signal
  run(g, 60);
  assert.equal(rb.state, "dwelling");
  g.setRoute("N2-T");
  run(g, 30);
  assert.equal(rb.state, "running");
  assert.ok(rb.departed >= rb.dep);
  assert.equal(g.aspect("N2").aspect, "stop"); // back to stop behind the train's head
  run(g, 200);
  assert.equal(rb.state, "gone");
  assert.equal(g.routes.size, 0);
  // approach locking: with a train within reach of the distant signal, the route stays
  const g2 = new SignallerGame({ level: "training" });
  g2.setRoute("A-G2");
  run(g2, 75);
  assert.match(g2.cancelRoute("A-G2").reason, /approaching A/);
});

test("the failed signal: Zs 1 with its checks lets the train go at 40 km/h; without a route it is a danger", () => {
  const g = new SignallerGame({ level: "normal" });
  run(g, 940, careful);
  const f = g.failure;
  assert.equal(f.started, true);
  assert.equal(g.signals.N2.failed, true);
  assert.equal(f.reported, f.at); // reported at once
  assert.ok(g.value("zs1") >= 1);
  assert.deepEqual(g.violations, []);
  // the train passing on Zs 1 keeps to 40 km/h through the points
  const rb = g.trains.find((t) => t.id === "RB 33");
  assert.ok(rb.routes.some((r) => r.zs1));
  let top = 0;
  run(g, 40, () => {
    if (g.occupancy().get("w6") === "RB 33" || g.occupancy().get("w5") === "RB 33") top = Math.max(top, rb.v);
  });
  assert.ok(top > 0 && top <= ZS1_MS + 1e-6, `top ${top}`);

  // Zs 1 at a signal without a locked route: a danger to people
  const bad = new SignallerGame({ level: "training" });
  bad.substitute("N1", { routeChecked: true, trackChecked: true, reason: "other" });
  assert.equal(bad.violations.at(-1).rule, "zs1-route");
  assert.equal(bad.violations.at(-1).severity, 3);
  // and without checks or reason: a breach and a slip
  const slip = new SignallerGame({ level: "training" });
  slip.setRoute("N1-T");
  slip.step(7);
  slip.signals.N1.failed = true;
  slip.substitute("N1", {});
  assert.deepEqual(slip.violations.map((v) => [v.rule, v.severity]), [["zs1-checks", 2], ["zs1-record", 1]]);
  // a working signal at proceed needs no Zs 1
  const fine = new SignallerGame({ level: "training" });
  fine.setRoute("N1-T");
  fine.step(7);
  assert.match(fine.substitute("N1", { routeChecked: true, trackChecked: true, reason: "lamp" }).reason, /no substitute signal is needed/);
});

test("the repair team: it comes after the report, waits for the closure, works, and reports; opening G2 early is a danger", () => {
  const g = new SignallerGame({ level: "normal" });
  run(g, 790, careful);
  assert.equal(g.team.state, "driving");
  run(g, 330, careful);
  assert.ok(["working", "done", "left"].includes(g.team.state));
  assert.ok(g.closed.has("g2") || g.team.state === "left");
  run(g, 600, careful);
  assert.equal(g.team.state, "left");
  assert.equal(g.signals.N2.failed, false);
  assert.ok(!g.closed.has("g2"));
  assert.deepEqual(g.violations, []);

  const rash = new SignallerGame({ level: "normal" });
  run(rash, 790, careful);
  run(rash, 400, (x) => {
    careful(x);
    if (x.team.state === "working") x.openTrack("G2");
  });
  assert.ok(rash.violations.some((v) => v.rule === "closure-workers" && v.severity === 3));
  assert.equal(rash.result().passed, false);
});

test("a careful signaller passes with a high score; a careless one fails; the same moves give the same game", () => {
  const scores = {};
  for (const level of Object.keys(LEVELS)) {
    const g = new SignallerGame({ level });
    run(g, 2600, careful);
    assert.ok(g.over, level);
    const res = g.result();
    scores[level] = res.score;
    assert.equal(res.violations, 0, level);
    assert.equal(res.passed, true, level);
    assert.ok(g.trains.every((t) => t.state === "gone"), `${level}: ${g.trains.filter((t) => t.state !== "gone").map((t) => `${t.id} ${t.state}`)}`);
  }
  assert.ok(scores.training >= 95, JSON.stringify(scores));
  assert.ok(scores.normal >= 85, JSON.stringify(scores));
  assert.ok(scores.hard >= 65, JSON.stringify(scores));
  // careless: Zs 1 without checks, the failure not reported, the questions wrong
  const careless = new SignallerGame({ level: "normal" });
  run(careless, 2600, (x) => {
    for (const d of x.open) x.decide(d.id, d.id === "report" ? "later" : d.options[1].id);
    for (const sig of Object.keys(x.signals)) {
      if (!x.signals[sig].failed || x.signals[sig].zs1) continue;
      const tr = x.trains.find((t) => t.state === "dwelling" && x.nextSignal(t) === sig && x.t >= t.dep);
      if (tr && x.routeFrom(sig)?.state === "locked") x.substitute(sig, {});
    }
    careful(x);
  });
  const res = careless.result();
  assert.ok(res.score < 60, `careless ${res.score}`);
  assert.ok(res.violations >= 2);
  assert.equal(careless.failure.reported, null);
  // determinism
  const a = new SignallerGame({ level: "hard", seed: 3 }), b = new SignallerGame({ level: "hard", seed: 3 });
  run(a, 2600, careful);
  run(b, 2600, careful);
  assert.deepEqual(a.result(), b.result());
  assert.deepEqual(a.logs, b.logs);
});
