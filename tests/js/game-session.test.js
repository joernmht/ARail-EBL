// The game engine (web/arail/game/): a game's ports and moves, the catalogue of flows, sessions
// (seats, turns and shifts, flows at tick boundaries, mail for games not at work, results per round),
// the people's moves recorded and played again, a seat taken over, missions as data (defaults,
// problems, wiring, the test run), and the missions that ship with the site.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  FLOWS, GAMES, Game, MISSION_FORMAT, Player, SCALES, Session, clockAt, flowOf, gameOfRole, normalizeMission, play, playedIn, testRun, validateFlows, validateMission, wiring,
} from "../../web/arail/game/index.js";
import { ROOT } from "./helpers.js";

/** A slow role: each plan turn it sets the budget (asked as a decision), each review turn it counts the reports. */
class Treasurer extends Game {
  static id = "treasurer";
  static role = "asset-manager";
  static scale = "years";
  static takes = [{ flow: "performance-report" }];
  static gives = [{ flow: "budget" }];
  static actions = { ...Game.actions, bonus: { label: "Give a bonus" } };

  constructor(options = {}) {
    super(options);
    this.resource("money", "Money", 100, "€");
    this.reports = [];
    this.phases = [];
  }

  begin(ctx) {
    this.phases.push(`${ctx.round}:${ctx.phase.id}`);
    if (ctx.phase.id === "plan") this.ask({ id: `budget-${ctx.round}`, title: "The budget", options: [{ id: "lean", label: "Lean" }, { id: "full", label: "Full" }], fallback: "lean", then: (o) => (this.choice = o) });
  }

  bonus(n) {
    this.add("money", -n);
    return { ok: true };
  }

  take(msg) {
    if (msg.flow === "performance-report") this.reports.push(msg.payload.done);
  }

  finish(ctx) {
    if (ctx.phase.id === "plan") this.give("budget", { year: ctx.round, maintenance_eur: this.choice === "full" ? 20 : 10 });
  }

  objectives() {
    return [{ id: "reports", label: "Reports", weight: 100, value: this.reports.length ? 1 : 0.6 }];
  }
}

/** A fast role: works off jobs at a rate set by the budget; reports at the end of the shift. */
class Worker extends Game {
  static id = "worker";
  static role = "maintenance-dispatcher";
  static scale = "minutes";
  static takes = [{ flow: "budget" }, { flow: "fault-report" }];
  static gives = [{ flow: "performance-report" }, { flow: "repair-status" }];
  static actions = { ...Game.actions, hurry: { label: "Hurry" } };

  constructor(options = {}) {
    super(options);
    this.length = options.length ?? 60;
    this.rate = (this.conditions.budget?.maintenance_eur ?? 5) / 10;
    this.done = 0;
    this.got = [];
  }

  hurry() {
    this.done += 10;
    return { ok: true };
  }

  take(msg) {
    if (msg.flow === "fault-report") {
      this.got.push([this.t, msg.payload.fault]);
      this.give("repair-status", { fault: msg.payload.fault, state: "dispatched" });
    }
  }

  tick(dt) {
    this.done += this.rate * dt;
  }

  finish() {
    this.give("performance-report", { kind: "maintenance", done: Math.round(this.done) });
  }

  objectives() {
    return [{ id: "done", label: "Done", weight: 100, value: this.done / 200 }];
  }
}

/** A second fast role that reports a fault at 10 s and counts the answers. */
class Caller extends Game {
  static id = "caller";
  static role = "signaller-relay";
  static scale = "seconds";
  static takes = [{ flow: "repair-status", from: ["maintenance-dispatcher"] }];
  static gives = [{ flow: "fault-report", to: ["maintenance-dispatcher"] }];

  constructor(options = {}) {
    super(options);
    this.answers = [];
  }

  tick() {
    if (!this.called && this.t >= 10) {
      this.called = true;
      this.give("fault-report", { fault: "X1" });
    }
  }

  take(msg) {
    this.answers.push([this.t, msg.payload.state]);
  }
}

const games = new Map([Treasurer, Worker, Caller].map((G) => [G.id, G]));
const BIG = {
  format: MISSION_FORMAT, id: "test-years", title: "Years", text: "A test.", rounds: 2,
  roles: [{ role: "asset-manager", game: "treasurer" }, { role: "maintenance-dispatcher", game: "worker" }, { role: "signaller-relay", game: "caller" }],
  phases: [
    { id: "plan", kind: "turn", roles: ["asset-manager"] },
    { id: "shift", kind: "shift", roles: ["maintenance-dispatcher", "signaller-relay"], length: 60, tick: 0.5 },
    { id: "review", kind: "turn", roles: ["asset-manager"] },
  ],
};
const session = (doc, options = {}) => new Session(normalizeMission(doc, games), { games, ...options });

test("the game core: ports, moves by name, flows received, the clock", () => {
  const g = new Worker({ seed: 3, conditions: { budget: { maintenance_eur: 20 } }, wired: ["budget"] });
  assert.equal(g.rate, 2);
  assert.ok(g.isWired("budget") && !g.isWired("fault-report"));
  assert.throws(() => g.give("budget", {}), /does not give "budget"/);
  assert.throws(() => g.act("tick", 1), /no move "tick"/);
  assert.deepEqual(g.act("hurry"), { ok: true });
  assert.deepEqual(g.moves, [{ t: 0, name: "hurry", args: [] }]);
  // an event queues up; a state replaces what held before
  g.receive({ flow: "fault-report", from: "signaller-relay", t: 0, payload: { fault: "N2" } });
  assert.deepEqual(g.inbox.map((m) => m.flow), ["fault-report"]);
  assert.deepEqual(g.outbox.map((m) => [m.flow, m.from, m.payload.state]), [["repair-status", "maintenance-dispatcher", "dispatched"]]);
  g.receive({ flow: "budget", from: "asset-manager", t: 0, payload: { maintenance_eur: 30 } });
  assert.equal(g.conditions.budget.maintenance_eur, 30);
  g.end("over");
  assert.deepEqual(g.act("hurry"), { ok: false, reason: "The game is over." });
  assert.equal(clockAt(0), "08:00");
  assert.equal(clockAt(125 * 60), "10:05");
  assert.equal(clockAt(90, 22 * 3600), "22:01");
  // the default computer player takes the fallback, or the first option
  const q = new Game();
  q.ask({ id: "a", title: "A", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }], fallback: "y" });
  q.ask({ id: "b", title: "B", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }] });
  new Player().think(q);
  assert.deepEqual(q.decisions.map((d) => d.made), ["y", "x"]);
  assert.deepEqual(new Game().view(), { figures: [], tables: [], actions: [] });
});

test("the flows: a sound catalogue; events and states; scales played in shifts or turns", () => {
  assert.deepEqual(validateFlows(), []);
  for (const id of ["budget", "timetable", "fault-report", "repair-status", "closure-request", "track-closure", "delay-notice", "connection-request", "performance-report", "staff-plan", "asset-condition", "transport-contract", "penalty", "payment"]) assert.ok(flowOf(id), id);
  assert.equal(flowOf("budget").kind, "state");
  assert.equal(flowOf("fault-report").kind, "event");
  assert.equal(flowOf("no-such-flow"), undefined);
  assert.deepEqual(SCALES.map(playedIn), ["shift", "shift", "shift", "turn", "turn", "turn"]);
  assert.ok(validateFlows([{ id: "Bad Id", name: "", name_de: "x", kind: "thing", scale: "weeks", group: "none", text: "x" }]).length >= 5);
  // every game's ports are flows of the catalogue; its role has one game
  for (const G of GAMES.values()) {
    for (const p of [...G.takes, ...G.gives]) assert.ok(flowOf(p.flow), `${G.id}: ${p.flow}`);
    assert.ok(SCALES.includes(G.scale), G.id);
    assert.equal(gameOfRole(G.role), G);
    for (const name of Object.keys(G.actions)) assert.equal(typeof G.prototype[name], "function", `${G.id}: the move ${name} is a method`);
  }
  assert.equal(new Set(FLOWS.map((f) => f.id)).size, FLOWS.length);
});

test("a session: turns and shifts round by round; a turn's state reaches the shift, the shift's report the next turn", () => {
  const s = session(BIG).run();
  assert.ok(s.over);
  const tr = s.seat("asset-manager").game;
  // the slow role's game lives through the rounds and is asked in every phase it is in
  assert.deepEqual(tr.phases, ["1:plan", "1:review", "2:plan", "2:review"]);
  assert.deepEqual(tr.decisions.map((d) => [d.id, d.made, d.auto]), [["budget-1", "lean", false], ["budget-2", "lean", false]]);
  // the budget (a state) set the workers' rate: 1 per second for 60 s
  assert.deepEqual(tr.reports, [60, 60]);
  const res = s.result();
  assert.deepEqual(res.seats.map((x) => [x.seat, x.rounds.map((r) => r.round)]), [["asset-manager", [1, 2]], ["maintenance-dispatcher", [1, 2]], ["signaller-relay", [1, 2]]]);
  assert.equal(res.seats[1].score, 30);
  assert.equal(res.flows.budget, 2);
  assert.equal(res.flows["performance-report"], 2);
  // the flows are kept with their phase, round and receivers
  const budget = s.flows.find((f) => f.flow === "budget");
  assert.deepEqual([budget.from, budget.to, budget.round, budget.payload.maintenance_eur], ["asset-manager", ["maintenance-dispatcher"], 1, 10]);
  // every seat's score weighs into the whole
  assert.equal(res.score, Math.round(res.seats.reduce((a, x) => a + x.score, 0) / 3));
  assert.equal(res.passed, res.seats.every((x) => x.passed));
});

test("a session: flows travel at tick boundaries, only between the roles a port names", () => {
  const s = session({ ...BIG, rounds: 1 }).start();
  assert.equal(s.phase.id, "shift"); // the plan turn of a computer is over at once
  const w = s.seat("maintenance-dispatcher").game, c = s.seat("signaller-relay").game;
  assert.deepEqual([...w.wired].sort(), ["budget", "fault-report", "performance-report", "repair-status"]);
  s.step(10); // 20 ticks: the caller gives the report in the tick that ends at 10 s
  assert.equal(c.outbox.length, 1);
  assert.deepEqual(w.got, []);
  s.step(0.5); // delivered at the start of the next tick; the answer is given on receiving
  assert.deepEqual(w.got, [[10, "X1"]]);
  assert.deepEqual(c.answers, []);
  s.step(0.5); // and travels at the tick after
  assert.deepEqual(c.answers, [[10.5, "dispatched"]]);
  // the report did not go to the slow role (its game takes no fault report); the repair status not to itself
  assert.deepEqual(s.flows.filter((f) => f.flow !== "budget").map((f) => [f.flow, f.to]), [["fault-report", ["maintenance-dispatcher"]], ["repair-status", ["signaller-relay"]]]);
  // time passes in the mission's ticks whatever the page's steps are
  s.step(0.2);
  s.step(0.2);
  assert.equal(s.ticks, 22);
  s.step(0.2);
  assert.equal(s.ticks, 23);
});

test("a session: the mission gives what no seat gives (conditions, injects); an event waits as mail for a game not at work", () => {
  const doc = {
    ...BIG, rounds: 1, roles: BIG.roles.slice(1), phases: [BIG.phases[1]],
    conditions: { budget: { maintenance_eur: 40 } },
    injects: [{ phase: "shift", at: 20, flow: "fault-report", payload: { fault: "M7" } }, { phase: "shift", at: 30, flow: "fault-report", payload: { fault: "M8" }, to: ["signaller-relay"] }],
  };
  assert.deepEqual(validateMission(doc, games), []);
  const s = session(doc).run();
  const w = s.seat("maintenance-dispatcher");
  assert.equal(w.game.rate, 4);
  assert.deepEqual(w.game.got, [[10, "X1"], [20, "M7"]]); // M8 was addressed to a role that does not take it
  assert.deepEqual(s.flows.filter((f) => f.from === "mission").map((f) => [f.payload.fault, f.to]), [["M7", ["maintenance-dispatcher"]], ["M8", []]]);
  // a report for a slow role that has not begun yet waits; a state is what holds when it begins
  const late = session({ ...BIG, rounds: 1, phases: [BIG.phases[1], BIG.phases[2]] }).run();
  assert.deepEqual(late.seat("asset-manager").game.reports, [30]);
  assert.deepEqual(late.seat("asset-manager").game.phases, ["1:review"]);
});

test("a session with people: a turn waits for its decisions, a shift for its clock; moves are recorded and played again", () => {
  const seats = { "asset-manager": "human", "maintenance-dispatcher": "human" };
  const s = session(BIG, { seats, seed: 5 }).start();
  assert.deepEqual([s.phase.id, s.waiting, s.ready], ["plan", true, false]);
  assert.deepEqual(s.act("signaller-relay", "decide", "x", "y"), { ok: false, reason: "This role is not at work now." });
  assert.equal(s.act("asset-manager", "decide", "budget-1", "full"), true);
  assert.equal(s.ready, true);
  s.act("asset-manager", "bonus", 7);
  s.next();
  assert.equal(s.phase.id, "shift");
  assert.throws(() => s.act("maintenance-dispatcher", "tick"), /no move/);
  s.step(12.3);
  s.act("maintenance-dispatcher", "hurry");
  s.step(30);
  s.act("maintenance-dispatcher", "hurry");
  const saved = JSON.parse(JSON.stringify(s.save()));
  assert.deepEqual(saved.record.map((m) => [m.phase, m.tick, m.seat, m.name]), [
    [0, 0, "asset-manager", "decide"], [0, 0, "asset-manager", "bonus"], [0, 0, null, "@next"], [1, 24, "maintenance-dispatcher", "hurry"], [1, 84, "maintenance-dispatcher", "hurry"],
  ]);
  assert.deepEqual(saved.at, { phase: 1, tick: 84 });
  // played again: the same state, and it goes on from there to the same end
  const again = Session.replay(normalizeMission(BIG, games), saved, { games });
  const state = (x) => [x.index, x.ticks, x.seat("maintenance-dispatcher").game.done, x.seat("asset-manager").game.value("money"), x.flows.length, x.record];
  assert.deepEqual(state(again), state(s));
  const finish = (x, dt) => {
    while (!x.over) {
      if (x.phase.kind === "shift") x.step(dt);
      else x.next();
    }
    return x.result();
  };
  const a = finish(s, 1), b = finish(again, 0.7);
  assert.deepEqual(a, b);
  // the budget "full" doubled the rate in round 1; the turn left open in round 2 was decided by its fallback
  assert.deepEqual(s.seat("asset-manager").game.reports, [140, 60]);
  assert.deepEqual(s.seat("asset-manager").game.decisions.map((d) => [d.made, !!d.auto]), [["full", false], ["lean", true]]);
  assert.equal(s.seat("asset-manager").game.value("money"), 93);
});

test("a session: a seat changes hands; a shift of computers runs on its own", () => {
  const s = session({ ...BIG, rounds: 1 }, { seats: { "maintenance-dispatcher": "human" } }).start();
  assert.equal(s.waiting, true);
  s.step(5);
  assert.equal(s.sit("maintenance-dispatcher", "computer"), true);
  assert.equal(s.sit("maintenance-dispatcher", "nobody"), false);
  assert.equal(s.waiting, false);
  s.run();
  assert.ok(s.over);
  assert.deepEqual(s.save().record.map((m) => m.name), ["@seat"]);
  assert.deepEqual(s.save().seats, { "asset-manager": "computer", "maintenance-dispatcher": "human", "signaller-relay": "computer" });
  // before the start, a seat is simply set
  const t = session(BIG);
  t.sit("asset-manager", "human");
  assert.deepEqual([t.record.length, t.seated["asset-manager"]], [0, "human"]);
  assert.throws(() => session(BIG, { seats: { "asset-manager": "robot" } }), /must be played by/);
  assert.throws(() => new Session(normalizeMission(BIG, games), { games: new Map() }), /no game "treasurer"/);
});

test("missions: defaults, problems, wiring", () => {
  const m = normalizeMission({ ...BIG, phases: undefined, rounds: undefined }, games);
  assert.deepEqual(m.phases.map((p) => [p.id, p.kind, p.roles]), [["plan", "turn", ["asset-manager"]], ["shift", "shift", ["maintenance-dispatcher", "signaller-relay"]], ["review", "turn", ["asset-manager"]]]);
  assert.deepEqual([m.rounds, m.seed, m.mode, m.phases[1].length, m.phases[1].tick, m.phases[1].clock], [1, 1, "cooperative", 2400, 0.5, "08:00"]);
  assert.deepEqual(validateMission(BIG, games), []);
  const bad = validateMission({
    format: "arail-mission/0", id: "Bad Id", title: "", mode: "war", rounds: 0,
    roles: [{ role: "asset-manager", game: "treasurer" }, { role: "train-driver", game: "worker" }, { role: "x", game: "nothing" }, { id: "asset-manager", role: "asset-manager", game: "treasurer", seat: "robot" }],
    phases: [{ id: "one", kind: "shift", roles: ["asset-manager", "ghost"], length: 0 }, { id: "one", kind: "pause", roles: [] }],
    conditions: { "fault-report": {}, "no-flow": {}, timetable: {} },
    injects: [{ phase: "nowhere", flow: "no-flow", at: -1, to: ["ghost"] }],
    debrief: "why",
  }, games);
  for (const part of [
    "format must be", "id must be kebab-case", "title is missing", "text is missing", "mode must be", "rounds must be",
    "seat train-driver: the game \"worker\" is the game of maintenance-dispatcher", "seat x: there is no game \"nothing\"", "seat asset-manager: the id is used twice", "seat must be one of",
    "phase one: asset-manager decides in years and is played in a turn, not in a shift", "phase one: no seat \"ghost\"", "phase one: a shift needs a length", "phase one: the id is used twice", "kind must be turn or shift", "phase one: no roles",
    "seat train-driver: in no phase", "\"fault-report\" is an event", "there is no flow \"no-flow\"", "no seated game takes \"timetable\"",
    "inject 1: there is no flow", "inject 1: no phase \"nowhere\"", "inject 1: at must be", "inject 1: to names \"ghost\"", "debrief must be a list",
  ]) assert.ok(bad.some((p) => p.includes(part)), `${part}\n${bad.join("\n")}`);
  assert.deepEqual(validateMission({ format: MISSION_FORMAT, id: "x", title: "X", text: "X" }, games), ["roles: a mission seats at least one role"]);
  const w = wiring({ ...BIG, conditions: { budget: {} }, roles: BIG.roles.slice(1), phases: [BIG.phases[1]] }, games);
  const line = (seat, flow, dir) => w.find((x) => x.seat === seat && x.flow === flow && x.dir === dir);
  assert.deepEqual([line("maintenance-dispatcher", "budget", "takes").seats, line("maintenance-dispatcher", "budget", "takes").mission], [[], true]);
  assert.deepEqual(line("maintenance-dispatcher", "fault-report", "takes").seats, ["signaller-relay"]);
  assert.deepEqual(line("maintenance-dispatcher", "performance-report", "gives").seats, []);
  assert.deepEqual(line("signaller-relay", "repair-status", "takes").seats, ["maintenance-dispatcher"]);
});

test("the missions of the site: listed, sound, their roles in the catalogue, and passed by the computer on every seat", () => {
  const dir = join(ROOT, "web", "game", "missions");
  const index = JSON.parse(readFileSync(join(dir, "missions.json"), "utf8"));
  assert.equal(index.format, "arail-missions/1");
  assert.deepEqual([...index.missions].sort(), readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "missions.json").sort(), "missions.json lists every mission file");
  const roles = new Set(JSON.parse(readFileSync(join(ROOT, "web", "game", "roles", "roles.json"), "utf8")).roles.map((r) => r.id));
  const ids = new Set();
  for (const file of index.missions) {
    const doc = JSON.parse(readFileSync(join(dir, file), "utf8"));
    assert.equal(`${doc.id}.json`, file, "a mission's file is named by its id");
    assert.ok(!ids.has(doc.id));
    ids.add(doc.id);
    assert.deepEqual(validateMission(doc, GAMES), [], file);
    for (const r of doc.roles) assert.ok(roles.has(r.role), `${file}: ${r.role} is a role of the catalogue`);
    assert.ok(doc.debrief?.length >= 2, `${file}: questions for the debrief`);
    assert.ok(doc.roles.some((r) => r.seat === "human"), `${file}: a seat for a person`);
    // a mission with a seat whose world is elsewhere (the lab's simulation) cannot be run here: tests/js/game-lab.test.js plays such a seat
    if (doc.roles.some((r) => GAMES.get(r.game).settings.length)) continue;
    for (const seed of [1, 2, 3]) {
      const { result } = testRun(doc, GAMES, { seed });
      assert.ok(result.over, `${file}, seed ${seed}: the run ends`);
      assert.ok(result.passed, `${file}, seed ${seed}: ${result.seats.map((x) => `${x.seat} ${x.score}${x.passed ? "" : " (not passed)"}`).join(", ")}`);
    }
    // the same seed, the same session
    assert.deepEqual(testRun(doc, GAMES, { seed: 2 }).result, testRun(doc, GAMES, { seed: 2 }).result, file);
    // a session is made by `play` with the mission's own seats
    const s = play(doc);
    assert.deepEqual([...s.seats.values()].map((x) => x.by), doc.roles.map((r) => r.seat ?? "computer"));
  }
});
