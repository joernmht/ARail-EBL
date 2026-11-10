// The game engine (web/arail/game/): a game's ports and moves, the catalogue of flows, sessions
// (seats, turns and shifts, flows at tick boundaries, mail for games not at work, results per round),
// the people's moves recorded and played again, a seat taken over, missions as data (defaults,
// problems, wiring, the test run), and the missions that ship with the site.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  FLOWS, GAMES, Game, MISSION_FORMAT, Player, SCALES, STRETCHES, Session, clockAt, flowOf, gameOfRole, normalizeMission, play, playedIn, testRun, threads, validateFlows, validateMission, wiring,
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

test("what led to what: a fault's thread from the flows, each stretch of its time with whose it was", () => {
  // the flows of a made-up shift: a failure reported after a minute, a team sent after two more, the road, the
  // closure asked for and given, the cause, the word, a provisional repair that fails again, a second team to the end
  const line = (t, flow, seat, payload, to = []) => ({ phase: 0, round: 1, t, flow, seat, to, payload });
  const S = "signaller", D = "dispatcher";
  const flows = [
    line(100, "repair-status", D, { fault: "x", asset: "Point X", place: "Waldau", state: "dispatched", team: "Team A", since_s: 40 }),
    line(160, "fault-report", S, { fault: "N2", asset: "Exit signal N2", place: "Bf Neustadt", track: "G2", since_s: 60 }, [D]),
    line(280, "repair-status", D, { fault: "N2", state: "dispatched", team: "Team B", since_s: 120 }),
    line(400, "repair-status", D, { fault: "x", state: "arrived", team: "Team A" }),
    line(580, "repair-status", D, { fault: "N2", state: "arrived", team: "Team B" }),
    line(610, "closure-request", D, { fault: "N2", track: "G2" }),
    line(700, "track-closure", S, { fault: "N2", track: "G2", closed: true }),
    line(760, "repair-status", D, { fault: "N2", state: "diagnosed", cause: "water", team: "Team B", since_s: 60 }),
    line(800, "repair-status", D, { fault: "N2", state: "working", provisional: true, team: "Team B" }),
    line(1040, "repair-status", D, { fault: "N2", state: "done", provisional: true, team: "Team B" }),
    line(1100, "track-closure", S, { fault: "N2", track: "G2", closed: false }),
    line(1500, "repair-status", D, { fault: "N2", state: "relapsed" }),
    line(1700, "repair-status", D, { fault: "N2", state: "dispatched", team: "Team B" }),
    line(2400, "performance-report", S, { effects: [{ fault: "N2", text: "RB 33 left on Zs 1" }, { fault: "nothing", text: "not a fault of the shift" }] }),
    line(2400, "delay-notice", S, { train: "RB 33" }),
  ];
  const list = threads(flows, { endOf: () => 2400 });
  assert.deepEqual(list.map((th) => [th.fault, th.asset, th.place, th.track, th.state, th.relapses]), [["x", "Point X", "Waldau", null, "open", 0], ["N2", "Exit signal N2", "Bf Neustadt", "G2", "open", 1]]);
  const n2 = list[1];
  assert.deepEqual(n2.stretches.map((x) => [x.from, x.to, x.kind, x.by]), [
    [100, 160, "unreported", S],
    [160, 280, "unsent", D],
    [280, 580, "road", "road"],
    [580, 610, "unasked", D],
    [610, 700, "unclosed", S],
    [700, 760, "finding", "team"],
    [760, 800, "undecided", D],
    [800, 1040, "repair", "team"],
    [1040, 1100, "unopened", S],
    [1100, 1500, "held", null],
    [1500, 1700, "unsent", D],
    [1700, 2400, "road", "road"],
  ]);
  assert.deepEqual(n2.stretches.filter((x) => x.provisional || x.open).map((x) => [x.kind, x.provisional, x.open]), [["repair", true, false], ["road", false, true]]);
  // the minutes out of order (not while the repair held), by whose they were
  assert.equal(n2.out_s, 2400 - 100 - 400);
  assert.deepEqual(n2.by, { [S]: 60 + 90 + 60, [D]: 120 + 30 + 40 + 200, road: 300 + 700, team: 60 + 240 });
  assert.deepEqual([n2.from, n2.to], [100, 2400]);
  assert.deepEqual(n2.effects, ["RB 33 left on Zs 1"]);
  // while N2 waited for a team, the other team was at Point X (to the end: it was never done there)
  assert.deepEqual(n2.stretches.filter((x) => x.kind === "unsent").map((x) => x.meanwhile), [[{ team: "Team A", asset: "Point X" }], [{ team: "Team A", asset: "Point X" }]]);
  // the other fault: no report as a flow, the first team after forty seconds; no track, so the team looks at once
  assert.deepEqual(list[0].stretches.map((x) => [x.from, x.to, x.kind, x.by, x.open]), [[60, 100, "unsent", D, false], [100, 400, "road", "road", false], [400, 2400, "finding", "team", true]]);
  assert.deepEqual(list[0].stretches[0].meanwhile, []);
  // a closure of another track is not the fault's, whatever it is tagged with: the thread stays as it is
  const stray = [...flows, line(300, "track-closure", S, { fault: "N2", track: "G3", closed: true }), line(900, "track-closure", S, { fault: "N2", track: "G3", closed: false }), line(590, "closure-request", D, { fault: "N2", track: "G1" })].sort((a, b) => a.t - b.t);
  const same = threads(stray, { endOf: () => 2400 })[1];
  assert.deepEqual([same.track, same.stretches, same.by], [n2.track, n2.stretches, n2.by]);
  // the track closed before the fault was reported: the thread begins with the report, the track closed; nothing is asked or waited for
  const early = threads([line(120, "track-closure", S, { fault: "N2", track: "G2", closed: true }), ...flows.filter((f) => f.payload.fault === "N2" && f.flow !== "track-closure" && f.t <= 800)], { endOf: () => 900 })[0];
  assert.deepEqual([early.from, early.track, early.steps[0].kind], [100, "G2", "reported"]);
  assert.deepEqual(early.stretches.map((x) => [x.from, x.to, x.kind]), [[100, 160, "unreported"], [160, 280, "unsent"], [280, 580, "road"], [580, 760, "finding"], [760, 800, "undecided"], [800, 900, "repair"]]);
  // nothing that names a fault: no threads; a phase of its own per thread
  assert.deepEqual(threads([line(5, "budget", "mp", { eur: 1 })]), []);
  assert.deepEqual(threads([...flows, { ...flows[1], phase: 3, round: 2 }]).map((th) => [th.phase, th.fault]), [[0, "x"], [0, "N2"], [3, "N2"]]);
  for (const k of Object.values(STRETCHES)) assert.ok(k.text && (k.by === null || ["reporter", "dispatcher", "signaller", "road", "team"].includes(k.by)));
});

test("what led to what in a played morning: the threads add up to the games' own minutes, and name what the failure did", () => {
  for (const seed of [1, 4, 35]) {
    const s = play({ format: MISSION_FORMAT, id: "morning", title: "Morning", text: "A test.", roles: [{ role: "signaller-relay", game: "signaller" }, { role: "maintenance-dispatcher", game: "maintenance" }] }, { seed }).run();
    const sig = s.seat("signaller-relay").game, mt = s.seat("maintenance-dispatcher").game, list = s.threads();
    // a thread for every fault that got a team, and for the signaller's
    const got = mt.faults.filter((f) => f.reported != null && (f.remote || s.flows.some((x) => x.flow === "repair-status" && x.payload.fault === f.id)));
    assert.deepEqual(list.map((th) => th.fault).sort(), got.map((f) => f.id).sort(), `seed ${seed}`);
    for (const th of list) {
      const f = mt.fault(th.fault);
      // the stretches follow each other without a gap, from the failure to the last step or the end of the shift
      for (const [i, x] of th.stretches.entries()) assert.ok(x.to > x.from && (i === 0 || Math.abs(x.from - th.stretches[i - 1].to) < 6), `seed ${seed}, ${th.fault}: ${JSON.stringify(th.stretches.map((y) => [y.from, y.to, y.kind]))}`);
      // out of order as long as the dispatcher's game says (the signaller's: from the failure, and until the track is open again)
      if (!f.remote) assert.ok(Math.abs(th.out_s - mt.outage(f, 2400)) < 12, `seed ${seed}, ${th.fault}: ${th.out_s} against ${mt.outage(f, 2400)}`);
      assert.equal(th.state, f.done == null ? "open" : f.provisional ? "provisional" : "repaired");
      assert.equal(th.relapses, f.relapses);
      assert.equal(Object.values(th.by).reduce((a, b) => a + b, 0), th.out_s);
      for (const who of Object.keys(th.by)) assert.ok(["road", "team", "others", "signaller-relay", "maintenance-dispatcher"].includes(who), who);
    }
    const n2 = list.find((th) => th.fault === "N2");
    assert.ok(n2.effects.length >= 1 && n2.effects.every((e) => typeof e === "string"), `seed ${seed}`);
    assert.deepEqual(n2.effects, sig.effects().map((e) => e.text));
    assert.ok(Math.abs(n2.from - sig.failure.at) < 2, `${n2.from} against ${sig.failure.at}`);
  }
  // seed 35: the provisional repair of N2 did not hold; the trains that paid for the failure are named
  const s = play({ format: MISSION_FORMAT, id: "morning", title: "Morning", text: "A test.", roles: [{ role: "signaller-relay", game: "signaller" }, { role: "maintenance-dispatcher", game: "maintenance" }] }, { seed: 35 }).run();
  const n2 = s.threads().find((th) => th.fault === "N2");
  assert.deepEqual(n2.stretches.map((x) => x.kind), ["unsent", "road", "finding", "repair", "held", "unsent"]);
  assert.equal(n2.stretches[3].provisional, true);
  assert.equal(n2.stretches.at(-1).open, true);
  assert.ok(n2.stretches.at(-1).meanwhile.length >= 1);
  assert.deepEqual(n2.effects, ["RB 33 left G2 on the substitute signal Zs 1, 1 min late", "GZ 49 ran through G3 instead of G2", "the connection from RB 33 to RB 34 was kept"]);
});

test("a game whose world is elsewhere: the shift closes only when it has caught up; a game is left when its shift is over or the session is given up", async () => {
  const made = [];
  /** A role whose world is behind at the end of the shift, until the next exchange with it. */
  class Remote extends Game {
    static id = "remote";
    static role = "train-dispatcher";
    static scale = "minutes";
    static gives = [{ flow: "performance-report" }];
    static actions = { ...Game.actions, wave: { label: "Wave" } };

    constructor(options = {}) {
      super(options);
      Object.assign(this, { caught: false, left: 0, exchanges: 0 });
      made.push(this);
    }

    wave() {
      return { ok: true };
    }

    get holding() {
      return this.t >= 5 && !this.caught;
    }

    async sync() {
      this.exchanges++;
      if (this.t >= 5) this.caught = true;
    }

    async leave() {
      this.left++;
    }

    finish() {
      this.give("performance-report", { caught: this.caught, t: this.t });
    }
  }
  const mine = new Map([[Remote.id, Remote]]);
  const doc = {
    format: MISSION_FORMAT, id: "remote", title: "Remote", text: "A test.", rounds: 2, roles: [{ role: "train-dispatcher", game: "remote" }],
    phases: [{ id: "shift", kind: "shift", roles: ["train-dispatcher"], length: 5, tick: 0.5 }],
  };
  const make = (options = {}) => new Session(normalizeMission(doc, mine), { games: mine, ...options });
  // without the exchange the session stops where the world is waited for: the time is up, the shift not closed
  const s = make().run();
  assert.deepEqual([s.over, s.round, s.t, s.ticks, s.holding, s.flows.length], [false, 1, 5, 10, true, 0]);
  s.step(3);
  s.run();
  assert.deepEqual([s.t, s.ticks, made[0].t], [5, 10, 5]);
  assert.deepEqual(s.act("train-dispatcher", "wave"), { ok: false, reason: "The shift is over." });
  assert.equal(s.record.length, 0);
  // the exchange: the world has caught up, the shift closes with its account, the next round begins
  await s.sync();
  assert.deepEqual([s.round, s.t, s.holding, s.flows.map((f) => [f.round, f.payload.caught, f.payload.t])], [2, 0, false, [[1, true, 5]]]);
  assert.deepEqual(made.map((g) => [g.over, g.left]), [["The shift is over.", 1], [null, 0]]);
  assert.deepEqual(s.act("train-dispatcher", "wave"), { ok: true });
  // to the end with the exchanges between the ticks
  await s.runWith();
  assert.deepEqual([s.over, s.flows.length, made.map((g) => g.left)], [true, 2, [1, 1]]);
  assert.ok(s.result().seats[0].rounds.length === 2);
  // a session given up in a shift: its game is left; one that throws there does not stop the others
  const t = make().start();
  t.step(2);
  await t.leave();
  assert.equal(made.at(-1).left, 1);
  made.at(-1).leave = async () => {
    throw new Error("no answer");
  };
  await t.leave();
  // played again from its record, it stops where the world is waited for and goes on with the exchange
  const again = Session.replay(normalizeMission(doc, mine), s.save(), { games: mine });
  assert.deepEqual([again.over, again.round, again.t, again.holding], [false, 1, 5, true]);
  await again.runWith();
  assert.equal(again.over, true);
  assert.deepEqual(again.result(), s.result());
});

test("a seat handed to the computer in a turn: the computer decides, not the fallbacks", () => {
  /** A treasurer whose computer player always takes the full budget (the fallback is the lean one). */
  class Planner extends Treasurer {
    static id = "planner";
    static player = class extends Player {
      think(g) {
        for (const d of g.open) g.act("decide", d.id, "full");
      }
    };
  }
  const mine = new Map([...games, [Planner.id, Planner]]);
  const doc = { ...BIG, rounds: 1, roles: [{ role: "asset-manager", game: "planner", seat: "human" }, ...BIG.roles.slice(1)] };
  const s = new Session(normalizeMission(doc, mine), { games: mine }).start();
  assert.deepEqual([s.phase.id, s.waiting], ["plan", true]);
  // the person leaves the seat in the plan turn: the turn ends by itself, with the computer's decision
  s.sit("asset-manager", "computer");
  const g = s.seat("asset-manager").game;
  assert.deepEqual(g.decisions.map((d) => [d.made, !!d.auto]), [["full", false]]);
  assert.deepEqual(s.flows.filter((f) => f.flow === "budget").map((f) => f.payload.maintenance_eur), [20]);
  assert.equal(s.phase.id, "shift");
  s.run();
  assert.ok(s.over);
  // played again from its record, the same
  const again = Session.replay(normalizeMission(doc, mine), s.save(), { games: mine });
  assert.deepEqual(again.result(), s.result());
  assert.deepEqual(again.seat("asset-manager").game.decisions.map((d) => d.made), ["full"]);
  // a person who stays decides themselves; a turn left open takes the fallback
  const t = new Session(normalizeMission(doc, mine), { games: mine }).start();
  t.next();
  assert.deepEqual(t.seat("asset-manager").game.decisions.map((d) => [d.made, !!d.auto]), [["lean", true]]);
});

test("the game core: a decision whose occasion has passed is taken back; nobody decided it", () => {
  const g = new Game();
  const seen = [];
  g.on((name, payload) => seen.push([name, payload.decision?.id]));
  let answered = null;
  g.ask({ id: "open", title: "Open the track?", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }], within: 10, fallback: "yes", then: (o) => (answered = o) });
  g.ask({ id: "other", title: "Another", options: [{ id: "a", label: "A" }] });
  assert.equal(g.withdraw("open"), true);
  assert.deepEqual(g.open.map((d) => d.id), ["other"]);
  assert.deepEqual(seen.at(-1), ["withdrawn", "open"]);
  // not answered now, not at its deadline, and not by a late click
  assert.equal(g.decide("open", "yes"), false);
  g.step(11);
  assert.equal(answered, null);
  assert.equal(g.withdraw("open"), false);
  assert.equal(g.withdraw("nothing"), false);
  // a decision that was made stays in the record
  g.decide("other", "a");
  assert.equal(g.withdraw("other"), false);
  assert.deepEqual(g.decisions.map((d) => [d.id, d.made]), [["other", "a"]]);
  // asked again later, it is a new question
  g.ask({ id: "open", title: "Open the track?", options: [{ id: "yes", label: "Yes" }], then: (o) => (answered = o) });
  g.decide("open", "yes");
  assert.equal(answered, "yes");
});

test("people who play at random: every move a page offers, in any order; the morning ends, no question is stale, the chain adds up, and the record plays it again", () => {
  const doc = JSON.parse(readFileSync(join(ROOT, "web", "game", "missions", "neustadt-morning.json"), "utf8"));
  const mission = () => normalizeMission(doc, GAMES);
  const SIG = "signaller-relay", MT = "maintenance-dispatcher";
  let moves = 0, refused = 0, relapses = 0;
  for (let seed = 1; seed <= 10; seed++) {
    // a small generator of its own: the same people for the same seed
    let x = seed * 2654435761 % 4294967296;
    const rnd = () => (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    const s = new Session(mission(), { games: GAMES, seed, seats: { [SIG]: "human", [MT]: "human" } }).start();
    const act = (seat, name, ...args) => {
      const res = s.act(seat, name, ...args);
      moves++;
      if (res === false || res?.ok === false) refused++;
    };
    while (!s.over) {
      for (const seat of [...s.active]) {
        const g = seat.game;
        if (!g || g.over) continue;
        const v = g.view(), k = rnd();
        // what the page would draw is well formed
        for (const a of v.actions) assert.ok(Object.hasOwn(seat.Game.actions, a.name), `${seat.id}: ${a.name}`);
        for (const it of v.sketch?.items ?? []) for (const m of it.menu ?? []) assert.ok(it.id && Object.hasOwn(seat.Game.actions, m.name), `${seat.id}: ${it.id} ${m.name}`);
        if (k < 0.3 && g.open.length) {
          // a question answered, with any of its options
          const d = pick(g.open);
          act(seat.id, "decide", d.id, pick(d.options).id);
        } else if (k < 0.5) {
          // a move from its form: any choice of every field
          const a = pick(v.actions.filter((y) => !y.disabled));
          if (a) act(seat.id, a.name, ...(a.args ?? []), ...(a.fields ?? []).map((f) => (f.options ? pick(f.options)?.id ?? null : f.type === "check" ? rnd() < 0.5 : f.type === "number" ? f.min ?? 0 : "x")));
        } else if (k < 0.65) {
          // a move from the picture: any entry of any menu that is not disabled
          const it = pick((v.sketch?.items ?? []).filter((y) => y.menu?.length));
          const m = it && pick(it.menu);
          if (m && !m.disabled) act(seat.id, m.name, ...(m.args ?? []));
        }
      }
      // no question outlives its occasion
      const sig = s.seat(SIG).game, mt = s.seat(MT).game;
      const ids = sig.open.map((d) => d.id), g2 = sig.closed.has("g2");
      if (ids.includes("report")) assert.ok(sig.failure.started && sig.failure.reported == null, `seed ${seed}: report`);
      if (ids.includes("closure")) assert.ok(sig.team.state === "waiting" && !g2, `seed ${seed}: closure, the team is ${sig.team.state}`);
      if (ids.includes("reopen")) assert.ok(sig.team.state === "done" && g2, `seed ${seed}: reopen, the team is ${sig.team.state}`);
      for (const d of mt.open) {
        const [kind, ...rest] = d.id.split("-"), f = mt.fault(rest.join("-"));
        const tm = mt.teams.find((y) => y.fault === f?.id && y.state === (kind === "plan" ? "deciding" : "waiting"));
        assert.ok(f && tm, `seed ${seed}: ${d.id} without a team that waits for it`);
      }
      // a team is where its fault says, and a fault with a team has that team
      for (const tm of mt.teams) assert.equal(tm.state === "ready", tm.fault == null, `seed ${seed}: ${tm.name} ${tm.state} ${tm.fault}`);
      s.step(5);
    }
    // the morning ended, with a result for both
    const res = s.result();
    assert.ok(res.over && res.seats.length === 2 && res.seats.every((y) => Number.isFinite(y.score) && y.score >= 0 && y.score <= 100), `seed ${seed}`);
    // what led to what: stretches in their order within the shift, the minutes by whose they were add up
    for (const th of s.threads()) {
      let at = 0;
      for (const y of th.stretches) {
        assert.ok(y.from >= at - 1e-6 && y.to > y.from && y.to <= 2400 + 1e-6 && Object.hasOwn(STRETCHES, y.kind), `seed ${seed}, ${th.fault}: ${JSON.stringify(th.stretches.map((z) => [z.from, z.to, z.kind]))}`);
        at = y.to;
      }
      assert.ok(Math.abs(Object.values(th.by).reduce((a, b) => a + b, 0) - th.out_s) < 1e-6);
      assert.ok(th.out_s <= 2400 && ["open", "provisional", "repaired"].includes(th.state));
      relapses += th.relapses;
    }
    // the same people again, from the record: the same morning
    const again = Session.replay(mission(), s.save(), { games: GAMES });
    assert.deepEqual(again.result(), res, `seed ${seed}`);
    assert.equal(again.flows.length, s.flows.length);
  }
  // the people did play: many moves, some refused, and the hard paths were reached
  assert.ok(moves > 1500 && refused > 100 && refused < moves, `${moves} moves, ${refused} refused`);
  assert.ok(relapses >= 1, "a provisional repair that did not hold was among them");
});

test("a move that fails inside the game is kept in the record: played again, the session is the same", () => {
  /** A role whose move changes the game and then fails. */
  class Clumsy extends Game {
    static id = "clumsy";
    static role = "maintenance-dispatcher";
    static scale = "minutes";
    static actions = { ...Game.actions, spend: { label: "Spend" } };

    constructor(options = {}) {
      super(options);
      this.resource("money", "Money", 100, "€");
    }

    spend(n) {
      this.add("money", -n);
      if (n > 50) throw new Error("that was too much");
      return { ok: true };
    }
  }
  const mine = new Map([[Clumsy.id, Clumsy]]);
  const doc = { format: MISSION_FORMAT, id: "clumsy", title: "Clumsy", text: "A test.", roles: [{ role: "maintenance-dispatcher", game: "clumsy", seat: "human" }], phases: [{ id: "shift", kind: "shift", roles: ["maintenance-dispatcher"], length: 20, tick: 0.5 }] };
  const s = new Session(normalizeMission(doc, mine), { games: mine }).start();
  const seen = [];
  s.on((name, payload) => name === "move" && seen.push([payload.name, payload.result.ok, payload.result.reason ?? ""]));
  s.step(2);
  assert.deepEqual(s.act("maintenance-dispatcher", "spend", 10), { ok: true });
  s.step(2);
  // the move fails after it has taken the money: a refusal with the reason, and it stays in the record
  const res = s.act("maintenance-dispatcher", "spend", 60);
  assert.deepEqual([res.ok, res.reason, res.error instanceof Error], [false, "that was too much", true]);
  assert.equal(s.seat("maintenance-dispatcher").game.value("money"), 30);
  assert.deepEqual(s.record.map((m) => [m.tick, m.name, ...m.args]), [[4, "spend", 10], [8, "spend", 60]]);
  assert.deepEqual(seen, [["spend", true, ""], ["spend", false, "that was too much"]]);
  // a move the game does not have is the caller's mistake: thrown, and not recorded
  assert.throws(() => s.act("maintenance-dispatcher", "steal", 5), /no move "steal"/);
  assert.equal(s.record.length, 2);
  s.step(3);
  // played again from the record: the same money, the same session
  const again = Session.replay(normalizeMission(doc, mine), s.save(), { games: mine });
  assert.equal(again.seat("maintenance-dispatcher").game.value("money"), 30);
  assert.deepEqual([again.ticks, again.record.length], [s.ticks, 2]);
});

test("people who play at random, on every mission of the site: no move a page offers makes a game fail, every session ends and plays again the same", () => {
  const dir = join(ROOT, "web", "game", "missions");
  const index = JSON.parse(readFileSync(join(dir, "missions.json"), "utf8"));
  let played = 0, moves = 0;
  for (const file of index.missions) {
    const doc = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const mission = () => normalizeMission(doc, GAMES);
    // a session whose world is elsewhere cannot be played here
    if (!Session.replayable(mission(), GAMES)) continue;
    for (let seed = 1; seed <= 3; seed++) {
      let x = (seed * 2654435761 + file.length * 40503) % 4294967296;
      const rnd = () => (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296;
      const pick = (list) => list[Math.floor(rnd() * list.length)];
      const value = (f) => {
        if (f.options) return pick(f.options)?.id ?? null;
        if (f.type === "check") return rnd() < 0.5;
        if (f.type !== "number") return "x";
        const lo = f.min ?? 0, hi = f.max ?? lo + 10, step = f.step ?? 1;
        return Math.min(hi, lo + Math.round((rnd() * (hi - lo)) / step) * step);
      };
      const s = new Session(mission(), { games: GAMES, seed, seats: Object.fromEntries(mission().roles.map((r) => [r.id, "human"])) }).start();
      const act = (seat, what, name, ...args) => {
        const res = s.act(seat, name, ...args);
        moves++;
        // refused is fine; failing inside the game on what its own view offered is not
        assert.equal(res?.error, undefined, `${file}, seed ${seed}, ${seat}: ${what} ${name}(${JSON.stringify(args)}) failed: ${res?.error?.stack}`);
      };
      const people = () => {
        for (const seat of [...s.active]) {
          const g = seat.game;
          if (!g || g.over) continue;
          const v = g.view(), k = rnd();
          for (const a of v.actions) assert.ok(Object.hasOwn(seat.Game.actions, a.name), `${file}, ${seat.id}: ${a.name}`);
          if (k < 0.35 && g.open.length) {
            const d = pick(g.open);
            act(seat.id, "decision", "decide", d.id, pick(d.options).id);
          } else if (k < 0.7) {
            const a = pick(v.actions.filter((y) => !y.disabled));
            if (a) act(seat.id, "form", a.name, ...(a.args ?? []), ...(a.fields ?? []).map(value));
          } else if (k < 0.8) {
            const it = pick((v.sketch?.items ?? []).filter((y) => y.menu?.length));
            const m = it && pick(it.menu);
            if (m && !m.disabled) act(seat.id, "menu", m.name, ...(m.args ?? []));
          }
        }
      };
      for (let guard = 0; !s.over && guard < 20000; guard++) {
        people();
        if (s.phase.kind === "shift") s.step(10);
        // in a turn the people make a few moves, then end it (what is open takes its fallback)
        else if (rnd() < 0.3) s.next();
      }
      const res = s.result();
      assert.ok(res.over, `${file}, seed ${seed}: the session ends`);
      assert.ok(res.seats.every((y) => Number.isFinite(y.score) && y.score >= 0 && y.score <= 100), `${file}, seed ${seed}: ${JSON.stringify(res.seats.map((y) => [y.seat, y.score]))}`);
      s.threads();
      const again = Session.replay(mission(), s.save(), { games: GAMES });
      assert.deepEqual(again.result(), res, `${file}, seed ${seed}: played again`);
      played++;
    }
  }
  assert.ok(played >= 18 && moves > 2000, `${played} sessions, ${moves} moves`);
});
