// The undertaking's operations control (web/arail/game/transport-control.js) alone and with the
// signaller: a connection held or let go and what each costs, passenger information, the
// undertaking's own trouble with its lawful and its forbidden ways out, the contract's penalties,
// the score against play by the book; in a session, the delay notice in and the wish to hold a train out.
import assert from "node:assert/strict";
import test from "node:test";

import { Session } from "../../web/arail/game/session.js";
import { normalizeMission } from "../../web/arail/game/mission.js";
import { SignallerGame } from "../../web/arail/game/signaller.js";
import { CONTRACT, INFO, LEVELS, LINE_KM, NEXT_TRAIN_MIN, REST_H, TransportControlGame, TransportControlPlayer } from "../../web/arail/game/transport-control.js";

/** Play a game alone to its end with a player's `think` before every half second. */
function alone(g, player = new TransportControlPlayer()) {
  while (!g.over) {
    player.think(g);
    g.step(0.5);
  }
  return g;
}

test("alone: the computer's dispatcher plays by the book on every level; nobody at the desk, and a rash dispatcher", () => {
  for (const level of Object.keys(LEVELS)) {
    for (let seed = 1; seed <= 8; seed++) {
      const g = alone(new TransportControlGame({ seed, level }));
      const res = g.result(), a = g.account();
      assert.ok(res.passed && res.score >= 95 && res.violations === 0, `${level} ${seed}: ${res.score}`);
      assert.ok(a.minutes <= a.best.minutes + 10 && a.best.minutes <= a.base.minutes, `${level} ${seed}: ${a.minutes}, ${a.best.minutes}, ${a.base.minutes}`);
      assert.equal(a.informed_s, 0);
    }
  }
  // the same seed, the same shift
  const a = alone(new TransportControlGame({ seed: 4, level: "hard" })), b = alone(new TransportControlGame({ seed: 4, level: "hard" }));
  assert.deepEqual(a.result(), b.result());
  assert.deepEqual(a.logs, b.logs);
  // nobody decides: no train is held, every train in trouble is cancelled, nobody is told
  const empty = alone(new TransportControlGame({ seed: 2, level: "hard" }), { think() {} });
  const acc = empty.account();
  assert.deepEqual([acc.minutes, acc.eur], [acc.base.minutes, acc.base.eur]);
  assert.equal(acc.eur, LEVELS.hard.own * CONTRACT.cancel_eur_km * LINE_KM);
  assert.ok(empty.result().score < 30, String(empty.result().score));
  assert.ok(empty.decisions.every((d) => d.auto && (d.made === "go" || d.made === "cancel")));
  // a driver without the rest time, a unit that may not carry passengers: the round fails whatever the score
  const rash = alone(new TransportControlGame({ seed: 2, level: "hard" }), { think: (g) => g.open.forEach((d) => g.act("decide", d.id, d.id.startsWith("hold-") ? "go" : d.options.some((o) => o.id === "send") ? "send" : "freeday")) });
  assert.ok(rash.violations.some((v) => v.rule === "defective-unit" && v.severity === 3));
  assert.equal(rash.result().passed, false);
});

test("a connection: the feeder is announced late, the wish to hold goes out, the connecting train waits; let go, the changers wait half an hour", () => {
  const g = new TransportControlGame({ seed: 5, level: "training" });
  g.step(0.5);
  const a = g.train("RB 31"), b = g.train("RB 32");
  assert.ok(a.feeder && a.partner === "RB 32" && a.changers >= 8 && b.aboard >= 60);
  assert.ok(a.delay_min >= 3 && a.need_s === a.delay_min * 60 - 13, "RB 32 is due 13 s after the changers of a punctual RB 31 are aboard");
  const d = g.open.find((x) => x.id === "hold-RB 32");
  assert.deepEqual(d.options.map((o) => o.id), ["2", "4", "go"]);
  assert.match(d.text, new RegExp(`${a.changers} passengers of RB 31 want to change to RB 32`));
  assert.equal(g.act("decide", "hold-RB 32", "4"), true);
  assert.deepEqual(g.outbox.at(-1), { flow: "connection-request", from: "ru-control-dispatcher", to: null, t: 0.5, payload: { hold: "RB 32", for: "RB 31", minutes: 4 } });
  alone(g, { think() {} });
  assert.ok(Math.abs(b.left_min * 60 - a.need_s) <= 3, `${b.left_min} min for ${a.need_s} s`);
  assert.deepEqual(g.connections()[0], { from: "RB 31", to: "RB 32", need_s: a.need_s, kept: true, changers: a.changers });
  assert.equal(g.account().minutes, Math.round(b.aboard * b.left_min));
  // let go: the connection breaks
  const h = new TransportControlGame({ seed: 5, level: "training" });
  h.step(0.5);
  h.act("decide", "hold-RB 32", "go");
  alone(h, { think() {} });
  assert.equal(h.connections()[0].kept, false);
  assert.equal(h.account().minutes, h.train("RB 31").changers * NEXT_TRAIN_MIN);
  // held too short: the train is late and the connection breaks all the same
  const k = new TransportControlGame({ seed: 5, level: "training" });
  k.step(0.5);
  k.act("decide", "hold-RB 32", "2");
  alone(k, { think() {} });
  assert.equal(k.connections()[0].kept, false);
  assert.equal(k.account().minutes, k.train("RB 31").changers * NEXT_TRAIN_MIN + Math.round(k.train("RB 32").aboard * 2));
});

test("passenger information: due from three minutes, measured from the notice; trouble of its own with the contract's prices", () => {
  const g = new TransportControlGame({ seed: 1, level: "hard", conditions: { "transport-contract": { cancel_eur_km: 20, late_eur: 50, short_eur_km: 5, late_from_min: 4 } } });
  assert.equal(g.contract.cancel_eur_km, 20);
  g.step(0.5);
  assert.deepEqual(g.pending().map((tr) => tr.id), ["RB 31"]);
  assert.match(g.act("inform", "RB 36").reason, /nothing to tell/);
  g.step(200);
  assert.deepEqual(g.act("inform", "RB 31"), { ok: true });
  assert.match(g.act("inform", "RB 31").reason, /have been told/);
  assert.equal(g.outbox.at(-1).flow, "passenger-information");
  assert.match(g.outbox.at(-1).payload.text, /RB 31 about \d min late/);
  assert.equal(g.train("RB 31").informed - g.train("RB 31").info_since, 200);
  // the first sick call: the stand-by driver; the second, with nobody left: a driver on a free day only with the rest time, else the train is cancelled
  const p = new TransportControlPlayer();
  while (!g.over) {
    for (const d of g.open.filter((x) => !x.id.startsWith("hold-"))) g.act("decide", d.id, g.advice(d.id));
    for (const tr of g.pending()) g.act("inform", tr.id);
    g.step(0.5);
  }
  const by = Object.fromEntries(g.trouble.map((x) => [x.id, x]));
  assert.equal(by["sick-37"].choice, "standby");
  assert.equal(by["unit-38"].choice, "spare");
  assert.equal(by["sick-39"].choice, by["sick-39"].rest_h >= REST_H ? "freeday" : "cancel");
  assert.equal(by["unit-40"].choice, "send"); // not safety-relevant: it may run
  assert.equal(g.value("standby"), 0);
  assert.equal(g.value("spare"), 0);
  if (by["sick-39"].choice === "cancel") {
    assert.equal(g.value("penalties"), 20 * LINE_KM);
    assert.ok(g.trains.some((tr) => tr.id === "RB 39" && tr.cancelled && tr.informed != null), "a cancelled train is told to its passengers");
  }
  assert.deepEqual(g.violations, []);
  assert.ok(INFO.good_s < INFO.bad_s && p instanceof TransportControlPlayer);
  // the shift's account, as the contract between the games has it
  g.finish();
  const rep = g.outbox.at(-1).payload;
  assert.deepEqual(Object.keys(rep), ["scope", "kind", "trips", "cancelled", "cancelled_km", "late_trips", "short_km", "penalties_eur", "passenger_delay_min", "connections", "connections_kept", "informed_s", "violations", "score"]);
  assert.deepEqual([rep.kind, rep.trips, rep.connections], ["undertaking", 10, 3]);
});

test("the view for a page that does not know the game", () => {
  const g = new TransportControlGame({ seed: 3, level: "normal" });
  for (let i = 0; i < 2400; i++) {
    const v = g.view();
    assert.ok(v.figures.length === 5 && v.tables.length === 2);
    for (const a of v.actions) {
      assert.ok(Object.hasOwn(TransportControlGame.actions, a.name), a.name);
      if (!a.disabled) {
        for (const f of a.fields ?? []) assert.ok(f.options?.length, `${a.name}.${f.id}`);
        assert.deepEqual(g.act(a.name, ...a.fields.map((f) => f.options[0].id)), { ok: true });
      }
    }
    for (const d of g.open) g.act("decide", d.id, d.options[0].id);
    g.step(1);
  }
  assert.ok(g.over && g.view().tables[0].rows.length >= 6);
});

test("with the signaller: the delay notice comes in, the wish to hold the train goes out, and the signaller's train waits", () => {
  const games = new Map([SignallerGame, TransportControlGame].map((G) => [G.id, G]));
  const mission = normalizeMission({
    format: "arail-mission/1", id: "pair", title: "Pair", text: "A test.",
    roles: [{ role: "signaller-relay", game: "signaller", level: "training" }, { role: "ru-control-dispatcher", game: "transport-control", level: "training" }],
  }, games);
  const play = (seats = {}) => {
    const s = new Session(mission, { games, seed: 1, seats }).start();
    // RB 31 comes nearly three minutes late; RB 32 is on time
    s.seat("signaller-relay").game.trains.find((tr) => tr.id === "RB 31").enterAt = 200;
    while (!s.over) s.step(10);
    return s;
  };
  const s = play();
  const sig = s.seat("signaller-relay").game, ru = s.seat("ru-control-dispatcher").game;
  assert.equal(ru.own, false, "the delays are the signaller's, not the game's own");
  const flows = s.flows.filter((f) => ["delay-notice", "connection-request", "passenger-information"].includes(f.flow)).map((f) => [f.flow, f.from, f.to.join(), f.payload.train ?? f.payload.hold]);
  assert.deepEqual(flows.slice(0, 2), [["delay-notice", "signaller-relay", "ru-control-dispatcher", "RB 31"], ["connection-request", "ru-control-dispatcher", "signaller-relay", "RB 32"]]);
  assert.equal(sig.connections()[0].kept, true);
  assert.equal(ru.connections()[0].kept, true);
  assert.ok(ru.train("RB 32").left_min >= 2 && ru.train("RB 32").held.minutes === 4);
  assert.ok(s.result().passed, JSON.stringify(s.result().seats.map((x) => [x.seat, x.score])));
  // a dispatcher who does not answer: the fallback lets RB 32 go, and the signaller's connection breaks
  const idle = play({ "ru-control-dispatcher": "human" });
  assert.equal(idle.seat("signaller-relay").game.connections()[0].kept, false);
  assert.equal(idle.seat("ru-control-dispatcher").game.connections()[0].kept, false);
  assert.equal(idle.flows.filter((f) => f.flow === "connection-request").length, 0);
});
