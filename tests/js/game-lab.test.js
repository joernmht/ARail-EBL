// The lab as a seat (web/arail/game/lab.js): the EBL's simulation behind its API as the world of a
// shift. A small lab of its own stands in for the API here: the requests the seat sends (the
// instance with the scripted failure, steps, interventions), the lab's events as flows, the flows
// of other roles as interventions, the clock that waits for the lab (also at the end of the shift:
// the lab is brought up to it before the shift closes), the instance deleted when the shift is over
// or given up, a lab that does not answer.
import assert from "node:assert/strict";
import test from "node:test";

import { CHUNK_S, EblApi, GAMES, LAG_S, LabGame, LabPlayer, MISSION_FORMAT, normalizeMission, Session, validateMission } from "../../web/arail/game/index.js";

const T0 = 8 * 3600;
const hms = (s) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const sec = (t) => t.split(":").reduce((a, x, i) => a + Number(x) * [3600, 60, 1][i], 0);

/**
 * A lab that answers like the API: trains that leave Neustadt (IN) at their planned time, later
 * when held, and from track 2 not before its failed exit signal is repaired.
 */
class SmallLab {
  constructor() {
    this.requests = [];
    this.t = T0;
    this.seq = 0;
    this.log = [];
    this.holds = new Map();
    this.failed = new Map(); // signal → since
    this.closed = new Set();
    this.plan = [
      { train: "26611", track: 2, dep: T0 + 300 }, { train: "4914", track: 1, dep: T0 + 600 }, { train: "26612", track: 2, dep: T0 + 900 },
      { train: "83716", track: 3, dep: T0 + 1200 }, { train: "26075", track: 2, dep: T0 + 1500 }, { train: "4915", track: 1, dep: T0 + 2000 },
    ].map((x) => ({ ...x, done: false }));
  }

  apply(c) {
    this.requests.push(["command", c.kind, c.train ?? c.signal ?? c.track]);
    if (c.kind === "hold" || c.kind === "delay") {
      const p = this.plan.find((y) => y.train === c.train);
      // the API refuses what it does not know: nothing is applied
      if (!p) throw Object.assign(new Error(`the commands have errors; none was applied (no train ${c.train})`), { status: 422 });
      if (c.kind === "delay") {
        this.holds.set(c.train, p.dep + c.seconds);
        return { ...c, ok: true, station: "IN", until: hms(p.dep + c.seconds) };
      }
      this.holds.set(c.train, sec(c.until));
    }
    else if (c.kind === "release") this.holds.delete(c.train);
    else if (c.kind === "failSignal") this.failed.set(c.signal, sec(c.at));
    else if (c.kind === "repairSignal") this.failed.delete(c.signal);
    else if (c.kind === "closeTrack") {
      if (this.busy?.has(c.track)) throw Object.assign(new Error(`the commands have errors; none was applied (track ${c.track} is occupied)`), { status: 409 });
      this.closed.add(c.track);
    }
    else if (c.kind === "openTrack") this.closed.delete(c.track);
  }

  async create(spec) {
    this.requests.push(["create", spec.start, spec.end, spec.timetable.version]);
    for (const c of spec.commands ?? []) this.apply(c);
    return { id: "sim-1" };
  }

  async step(id, s) {
    this.requests.push(["step", s]);
    for (let i = 0; i < s; i++) {
      this.t++;
      for (const p of this.plan) {
        if (p.done || this.t < p.dep) continue;
        if ((this.holds.get(p.train) ?? 0) > this.t) continue;
        // track 2 leaves by exit signal N2: not while it has failed (a closed track sends the train to another)
        const since = this.failed.get("ASig N2");
        if (p.track === 2 && since != null && this.t >= since && !this.closed.has(2)) continue;
        p.done = true;
        this.log.push({ seq: ++this.seq, t: this.t, time: hms(this.t), kind: "depart", train: p.train, station: "IN", planned: hms(p.dep), actual: hms(this.t), delayS: this.t - p.dep });
      }
    }
    return { advancedS: s, complete: true };
  }

  async events(id, after) {
    const events = this.log.filter((e) => e.seq > after);
    return { events, more: false, last: this.seq };
  }

  async commands(id, list) {
    return { applied: list.map((c) => this.apply(c) ?? { ...c, ok: true }) };
  }

  async remove(id) {
    this.requests.push(["remove", id]);
    return {};
  }
}

const FAILURE = { signal: "ASig N2", track: 2, at: 780 };

/** Play a game alone against its lab: the player thinks, the game steps, the lab is synced. */
async function alone(g, player = new LabPlayer()) {
  while (!g.over) {
    await g.sync();
    if (g.holding) continue;
    player.think(g);
    g.step(0.5);
  }
  return g;
}

test("alone: the instance with the scripted failure, the lab stepped along, late trains told, the failure handled", async () => {
  const lab = new SmallLab();
  const g = await alone(new LabGame({ api: lab, failure: FAILURE, length: 2400 }));
  assert.deepEqual(lab.requests[0], ["create", "08:00:00", "08:40:00", 5]);
  assert.deepEqual(lab.requests[1], ["command", "failSignal", "ASig N2"]);
  // the lab was advanced in chunks, to the end of the shift
  assert.ok(lab.requests.filter((r) => r[0] === "step").every((r) => r[1] >= 1 && r[1] <= LAG_S + CHUNK_S));
  assert.equal(lab.t, T0 + 2400);
  assert.equal(g.labT, 2400);
  // the shift ended in the exchange that brought the lab up to it; then the instance was deleted, once
  assert.deepEqual(lab.requests.at(-1), ["remove", "sim-1"]);
  await g.leave();
  assert.equal(lab.requests.filter((r) => r[0] === "remove").length, 1);
  // the computer reported the failure; the game's own team came, the track was closed, the signal repaired, the track opened
  assert.deepEqual(lab.requests.filter((r) => r[0] === "command").map((r) => r[1]), ["failSignal", "closeTrack", "repairSignal", "openTrack"]);
  assert.equal(g.failure.reported, 780);
  assert.ok(g.failure.repaired > 780 + 600 + 300);
  assert.equal(g.team.state, "left");
  assert.deepEqual(g.violations, []);
  // every train of the lab was seen; 26612 waited at the failed signal until the track was closed
  assert.deepEqual([...g.trains.keys()].sort(), ["26075", "26611", "26612", "4914", "4915", "83716"]);
  assert.ok(g.trains.get("26612").delay_s > 300);
  const notices = g.outbox.filter((m) => m.flow === "delay-notice").map((m) => [m.payload.train, m.payload.stage, m.payload.cause]);
  assert.deepEqual(notices, [["26612", "departed", "signal failure"]]);
  assert.deepEqual(g.outbox.filter((m) => m.flow !== "delay-notice").map((m) => m.flow), ["fault-report", "track-closure", "track-closure"]);
  g.finish();
  const rep = g.outbox.at(-1).payload;
  assert.deepEqual([rep.kind, rep.scope, rep.trains, rep.faults], ["operations", "Neustadt", 6, 1]);
  assert.ok(g.result().passed, String(g.result().score));
  const v = g.view();
  assert.equal(v.figures[0].value, "at 08:40");
  for (const a of v.actions) assert.ok(Object.hasOwn(LabGame.actions, a.name), a.name);
});

test("the player's moves become interventions; a held train leaves late and is told", async () => {
  const lab = new SmallLab();
  const g = new LabGame({ api: lab, length: 1200 });
  await g.sync();
  assert.deepEqual(g.act("hold", "4914", 5), { ok: true });
  assert.match(g.act("hold", "4914", 99).reason, /1 to 30 minutes/);
  assert.match(g.act("release", "9999").reason, /not held/);
  assert.match(g.act("openTrack", 3).reason, /not closed/);
  assert.deepEqual(g.act("closeTrack", "3"), { ok: true });
  // asked of the lab: until it has answered, the track is neither closed nor to be asked for again
  assert.match(g.act("closeTrack", 3).reason, /the lab has not answered yet/);
  assert.match(g.act("closeTrack", 2.5).reason, /no such track/);
  assert.deepEqual([g.closed.has(3), g.asked.get(3)], [false, "closing"]);
  await g.sync();
  assert.deepEqual([g.closed.has(3), g.asked.size], [true, 0]);
  assert.match(g.act("closeTrack", 3).reason, /already closed/);
  // a connection asked for by an undertaking: the train waits beyond its own departure (the lab's "delay")
  g.receive({ flow: "connection-request", from: "ru-control-dispatcher", t: 0, payload: { hold: "26611", for: "4914", minutes: 8 } });
  await alone(g, { think() {} });
  assert.deepEqual(lab.requests.filter((r) => r[0] === "command").map((r) => [r[1], r[2]]), [["hold", "4914"], ["closeTrack", 3], ["delay", "26611"]]);
  assert.equal(g.trains.get("4914").delay_s, 0); // held from 08:00 for 5 min, due at 08:10
  assert.equal(g.trains.get("26611").delay_s, 480); // due at 08:05, waits up to 8 min beyond it: until 08:13
  assert.deepEqual(g.outbox.filter((m) => m.flow === "delay-notice").map((m) => [m.payload.train, m.payload.delay_min]), [["26611", 8]]);
  assert.equal(g.value("commands"), 3);
});

test("in a session with the maintenance dispatcher: the lab's failure sends the team, its report repairs the signal in the lab", async () => {
  const lab = new SmallLab();
  const mission = normalizeMission({
    format: MISSION_FORMAT, id: "lab", title: "Lab", text: "A test.",
    roles: [{ role: "train-dispatcher", game: "lab", options: { failure: FAILURE } }, { role: "maintenance-dispatcher", game: "maintenance" }],
  }, GAMES);
  // a mission is data: the lab's API object is given to the seat beside it
  mission.roles[0].options.api = lab;
  const s = new Session(mission, { games: GAMES, seed: 1 });
  // the clock waits until the lab is there
  s.start();
  s.step(10);
  assert.equal(s.ticks, 0);
  assert.equal(s.holding, true);
  await s.runWith();
  assert.ok(s.over);
  const g = s.seat("train-dispatcher").game, mt = s.seat("maintenance-dispatcher").game;
  assert.equal(mt.fault("ASig N2").remote, true);
  const steps = s.flows.filter((f) => f.payload.fault === "ASig N2" || f.payload.track === "IN 2").map((f) => `${f.flow}${f.payload.state ? `:${f.payload.state}` : f.payload.closed != null ? `:${f.payload.closed}` : ""}`);
  // the track is closed for the others when the lab has closed it: after the team has asked
  assert.deepEqual(steps, ["fault-report", "repair-status:dispatched", "repair-status:arrived", "closure-request", "track-closure:true", "repair-status:diagnosed", "repair-status:working", "repair-status:done", "track-closure:false"]);
  assert.deepEqual(lab.requests.filter((r) => r[0] === "command").map((r) => r[1]), ["failSignal", "closeTrack", "repairSignal", "openTrack"]);
  assert.equal(g.failure.repaired, mt.fault("ASig N2").done);
  assert.ok(lab.failed.size === 0 && lab.closed.size === 0);
  assert.ok(s.result().passed, JSON.stringify(s.result().seats.map((x) => [x.seat, x.score])));
  assert.deepEqual(s.flows.filter((f) => f.flow === "performance-report").map((f) => f.payload.kind), ["operations", "maintenance"]);
  // the lab ran to the end of the shift before the shift closed, and its instance was deleted
  assert.deepEqual([g.labT, lab.t], [2400, T0 + 2400]);
  assert.deepEqual(lab.requests.filter((r) => r[0] === "remove"), [["remove", "sim-1"]]);
});

test("in a session, the end of the shift: the lab is brought up to it before the shift closes; a train of the last seconds and a move of the last tick count", async () => {
  const lab = new SmallLab();
  // a train that leaves five seconds before the end of the shift
  lab.plan.push({ train: "9999", track: 1, dep: T0 + 2395, done: false });
  const mission = normalizeMission({
    format: MISSION_FORMAT, id: "lab", title: "Lab", text: "A test.", roles: [{ role: "train-dispatcher", game: "lab", seat: "human", options: {} }],
    phases: [{ id: "shift", kind: "shift", roles: ["train-dispatcher"], length: 2400 }],
  }, GAMES);
  mission.roles[0].options.api = lab;
  const s = new Session(mission, { games: GAMES, seed: 1 }).start();
  const g = s.seat("train-dispatcher").game;
  // a page's loop: exchange with the lab, then a tick, until the shift's time is up
  while (s.t < 2400 - 0.5) {
    await s.sync();
    if (!s.holding) s.step(0.5);
  }
  // the last tick: the person closes track 3, with no exchange before the time is up
  assert.deepEqual(s.act("train-dispatcher", "closeTrack", 3), { ok: true });
  s.step(0.5);
  // the time is up, the lab is behind: the shift is not closed, nothing more is taken or stepped
  assert.deepEqual([s.t, s.over, s.holding, g.over], [2400, false, true, null]);
  assert.ok(g.labT < 2400 && lab.t < T0 + 2400);
  assert.equal(g.trains.has("9999"), false);
  assert.equal(lab.closed.has(3), false);
  assert.equal(s.flows.some((f) => f.flow === "performance-report"), false);
  assert.deepEqual(s.act("train-dispatcher", "openTrack", 3), { ok: false, reason: "The shift is over." });
  s.step(5);
  assert.equal(s.t, 2400);
  // the exchange: the move goes out, the lab runs to the end, its last events come in; then the shift closes
  await s.sync();
  assert.deepEqual([s.over, !!g.over, g.labT, lab.t], [true, true, 2400, T0 + 2400]);
  assert.equal(lab.closed.has(3), true);
  assert.equal(g.trains.has("9999"), true);
  const report = s.flows.find((f) => f.flow === "performance-report").payload;
  assert.equal(report.trains, 7);
  assert.deepEqual(lab.requests.slice(-1), [["remove", "sim-1"]]);
  assert.deepEqual(lab.requests.filter((r) => r[0] === "command").map((r) => r[1]), ["closeTrack"]);
});

test("a session given up: its lab instance is deleted; a lab without that request, or one that does not answer it, is left alone", async () => {
  const lab = new SmallLab();
  const mission = normalizeMission({ format: MISSION_FORMAT, id: "lab", title: "Lab", text: "A test.", roles: [{ role: "train-dispatcher", game: "lab", seat: "human", options: {} }] }, GAMES);
  mission.roles[0].options.api = lab;
  const s = new Session(mission, { games: GAMES, seed: 1 }).start();
  await s.sync();
  s.step(20);
  await s.leave();
  await s.leave();
  assert.deepEqual(lab.requests.filter((r) => r[0] === "remove"), [["remove", "sim-1"]]);
  // a game that was left exchanges nothing more with the lab, and does not hold the clock for it
  const n = lab.requests.length, t0 = s.t;
  for (let i = 0; i < 20; i++) {
    s.step(10);
    await s.sync();
  }
  assert.equal(lab.requests.length, n);
  assert.deepEqual([s.holding, s.t], [false, t0 + 200]);
  // left before the lab was ever asked: nothing to give back, and no instance is made afterwards
  const quiet = new SmallLab();
  const early = new LabGame({ api: quiet, length: 60 });
  await early.leave();
  await early.sync();
  assert.deepEqual([quiet.requests.length, early.instance], [0, null]);
  // left while the lab is still making the instance (the page is closed right after Start): deleted as soon as it is there
  const slow = new SmallLab();
  let answer = null;
  const create = slow.create.bind(slow);
  slow.create = (spec) => new Promise((done) => (answer = () => done(create(spec))));
  const g2 = new LabGame({ api: slow, failure: FAILURE, length: 60 });
  const pending = g2.sync();
  await g2.leave();
  assert.deepEqual(slow.requests, []);
  answer();
  await pending;
  assert.deepEqual(slow.requests.map((r) => r[0]), ["create", "command", "remove"]);
  assert.deepEqual(slow.requests.at(-1), ["remove", "sim-1"]);
  // nothing was stepped, nothing said of a lost lab, and it is deleted once
  assert.deepEqual([g2.labT, g2.link.state, g2.logs.some((l) => /does not answer/.test(l.text))], [0, "connecting", false]);
  await g2.leave();
  await g2.sync();
  assert.equal(slow.requests.filter((r) => r[0] === "remove").length, 1);
  // left while a step is on its way: the answer that comes later is not taken, and nothing is said of a lost lab
  const busy = new SmallLab();
  const g3 = new LabGame({ api: busy, length: 600 });
  await g3.sync();
  g3.step(20);
  let finish = null;
  const step = busy.step.bind(busy);
  busy.step = (id, sec) => new Promise((done) => (finish = () => done(step(id, sec))));
  const running = g3.sync();
  await g3.leave();
  finish();
  await running;
  assert.deepEqual([g3.labT, g3.link.state], [0, "ok"]);
  assert.deepEqual(busy.requests.filter((r) => r[0] === "remove"), [["remove", "sim-1"]]);
  // the request outlives the page that sends it
  const sent = [];
  const api = new EblApi({ url: "https://lab.example", key: "k", fetch: async (url, init) => (sent.push([url, init.method, init.keepalive]), { ok: true, status: 200, json: async () => ({}) }) });
  await api.remove("sim-7");
  assert.deepEqual(sent, [["https://lab.example/v1/instances/sim-7", "DELETE", true]]);
  // a lab that refuses: the game is left all the same
  const deaf = new SmallLab();
  deaf.remove = async () => {
    throw new Error("gone");
  };
  const g = new LabGame({ api: deaf, length: 60 });
  await g.sync();
  await g.leave();
  assert.equal(g.link.state, "ok");
});

test("a provisional repair that does not hold: the signal fails again in the lab, and is repaired again", async () => {
  const lab = new SmallLab();
  const g = new LabGame({ api: lab, failure: FAILURE, length: 2400, wired: ["repair-status"] });
  const player = new LabPlayer();
  const status = (state, more = {}) => g.receive({ flow: "repair-status", from: "maintenance-dispatcher", t: g.t, payload: { fault: "ASig N2", state, ...more } });
  const run = async (done) => {
    while (!g.over && !done()) {
      await g.sync();
      if (g.holding) continue;
      player.think(g);
      g.step(0.5);
    }
    await g.sync();
  };
  await run(() => g.failure.reported != null);
  status("dispatched");
  status("arrived");
  await run(() => g.closed.has(2));
  status("diagnosed", { cause: "water in the housing" });
  status("working", { provisional: true });
  assert.equal(g.team.state, "working");
  const t1 = g.t + 240;
  await run(() => g.t >= t1);
  status("done", { provisional: true });
  await run(() => g.t >= t1 + 60);
  assert.deepEqual([lab.failed.size, lab.closed.size, g.team.state], [0, 0, "left"]);
  // it does not hold
  status("relapsed");
  assert.deepEqual([g.failure.repaired, g.team.state], [null, "called"]);
  assert.match(g.logs.at(-1).text, /does not clear again: the provisional repair did not hold/);
  await run(() => g.t >= t1 + 120);
  assert.ok(lab.failed.has("ASig N2"));
  // a team of the other trade comes, looks and leaves; then the repair for good
  status("dispatched");
  status("arrived");
  await run(() => g.closed.has(2));
  status("left", { needs: "signalling" });
  assert.equal(g.team.state, "called");
  status("dispatched");
  status("arrived");
  status("working");
  status("done");
  await run(() => g.t >= t1 + 300);
  assert.deepEqual([lab.failed.size, lab.closed.size, g.team.state], [0, 0, "left"]);
  assert.deepEqual(lab.requests.filter((r) => r[0] === "command").map((r) => r[1]), ["failSignal", "closeTrack", "repairSignal", "openTrack", "failSignal", "closeTrack", "repairSignal", "openTrack"]);
  assert.deepEqual(g.violations, []);
});

test("questions whose occasion has passed are taken back: after a repair that did not hold, nobody is asked to open the track under the new team", async () => {
  const lab = new SmallLab();
  // a person at the seat: nobody answers the questions for them
  const g = new LabGame({ api: lab, failure: FAILURE, length: 2400, wired: ["repair-status"] });
  const status = (state, more = {}) => g.receive({ flow: "repair-status", from: "maintenance-dispatcher", t: g.t, payload: { fault: "ASig N2", state, ...more } });
  const open = () => g.open.map((d) => d.id);
  const run = async (s) => {
    const end = g.t + s;
    while (g.t < end) {
      await g.sync();
      if (!g.holding) g.step(0.5);
    }
    await g.sync();
  };
  await run(781);
  assert.deepEqual(open(), ["report"]);
  g.reportFault();
  status("dispatched");
  status("arrived");
  assert.deepEqual([g.team.state, open()], ["waiting", ["closure"]]);
  // closed by the move, not by the question: when the lab has closed it, the team goes onto it and the question is gone
  g.closeTrack(2);
  assert.deepEqual([g.team.state, open()], ["waiting", ["closure"]]);
  await g.sync();
  assert.deepEqual([g.team.state, open()], ["working", []]);
  status("working", { provisional: true });
  status("done", { provisional: true });
  assert.deepEqual([g.team.state, open()], ["done", ["reopen"]]);
  await run(60);
  status("relapsed");
  assert.deepEqual([g.team.state, open()], ["called", []]);
  assert.equal(g.decide("reopen", "open"), false);
  status("dispatched");
  status("arrived");
  status("working");
  await run(60);
  assert.deepEqual([g.team.state, g.closed.has(2), open(), g.violations], ["working", true, [], []]);
  // the track was closed once and never opened in the lab
  assert.deepEqual(lab.requests.filter((r) => r[0] === "command").map((r) => r[1]), ["failSignal", "closeTrack", "repairSignal", "failSignal"]);
  status("done");
  assert.deepEqual(open(), ["reopen"]);
  g.openTrack(2);
  await g.sync();
  assert.deepEqual([g.team.state, open()], ["left", []]);
});

test("a track counts as closed only when the lab has closed it: a refusal is said, the team keeps waiting, and the question comes again", async () => {
  const lab = new SmallLab();
  lab.busy = new Set([2]);
  const g = new LabGame({ api: lab, failure: FAILURE, length: 2400, wired: ["repair-status"] });
  const status = (state, more = {}) => g.receive({ flow: "repair-status", from: "maintenance-dispatcher", t: g.t, payload: { fault: "ASig N2", state, ...more } });
  const closures = () => g.outbox.filter((m) => m.flow === "track-closure").map((m) => [m.payload.track, m.payload.closed]);
  while (g.t < 800) {
    await g.sync();
    if (!g.holding) g.step(0.5);
  }
  g.reportFault();
  status("dispatched");
  status("arrived");
  // the person answers the question: the lab is asked; nothing is closed yet, nobody is told, the team waits
  assert.equal(g.decide("closure", "close"), true);
  assert.deepEqual([g.closed.size, g.asked.get(2), g.team.state, closures()], [0, "closing", "waiting", []]);
  assert.match(g.view().tables.find((t) => t.id === "interventions").rows[0].join(": "), /^Track 2: the lab is asked to close it$/);
  assert.equal(g.view().actions.find((a) => a.name === "closeTrack").fields[0].options.some((o) => o.id === "2"), false);
  // the lab refuses (a train stands in the track): said at the seat, nothing closed, the question again
  await g.sync();
  assert.deepEqual([g.closed.size, g.asked.size, g.team.state, closures(), g.link.state], [0, 0, "waiting", [], "ok"]);
  assert.ok(g.logs.some((l) => /The lab did not take "closeTrack" for track 2: .*track 2 is occupied/.test(l.text)));
  assert.deepEqual(g.open.map((d) => d.id), ["closure"]);
  // the dispatcher's team was never told the track is closed; nothing can be opened that was not closed
  assert.match(g.openTrack(2).reason, /not closed/);
  assert.deepEqual(g.violations, []);
  // the track is free now: asked again, the lab closes it, the team goes onto it, the others are told
  lab.busy.clear();
  g.decide("closure", "close");
  await g.sync();
  assert.deepEqual([g.closed.has(2), g.team.state, closures(), g.open.length], [true, "working", [["IN 2", true]], 0]);
  // opening: asked of the lab too; refused there, the track stays closed here
  status("done");
  const commands = lab.commands.bind(lab);
  lab.commands = async (id, list) => {
    if (list[0].kind === "openTrack") throw Object.assign(new Error("the commands have errors; none was applied (no closure of track 2)"), { status: 422 });
    return commands(id, list);
  };
  g.openTrack(2);
  assert.deepEqual([g.closed.has(2), g.asked.get(2), g.team.state], [true, "opening", "done"]);
  assert.match(g.openTrack(2).reason, /has not answered yet/);
  await g.sync();
  assert.deepEqual([g.closed.has(2), g.asked.size, g.team.state, closures()], [true, 0, "done", [["IN 2", true]]]);
  lab.commands = commands;
  g.openTrack(2);
  await g.sync();
  assert.deepEqual([g.closed.has(2), g.team.state, closures()], [false, "left", [["IN 2", true], ["IN 2", false]]]);
  assert.deepEqual(g.violations, []);
  // a lab that is gone: what was asked of it counts by the game's own word
  lab.commands = async () => {
    throw Object.assign(new Error("no instance sim-1"), { status: 404 });
  };
  g.closeTrack(3);
  await g.sync();
  assert.deepEqual([g.link.state, g.closed.has(3), g.asked.size], ["lost", true, 0]);
  // and without the lab, a track is closed at once
  assert.deepEqual(g.closeTrack(1), { ok: true });
  assert.equal(g.closed.has(1), true);
});

test("a track closure names the failure only on the failed signal's own track", async () => {
  const lab = new SmallLab();
  const g = new LabGame({ api: lab, failure: FAILURE, length: 2400, wired: ["repair-status"] });
  while (g.t < 800) {
    await g.sync();
    if (!g.holding) g.step(0.5);
  }
  assert.equal(g.failure.started, true);
  const closure = () => g.outbox.filter((m) => m.flow === "track-closure").at(-1).payload;
  const status = (state, more = {}) => g.receive({ flow: "repair-status", from: "maintenance-dispatcher", t: g.t, payload: { fault: "ASig N2", state, ...more } });
  g.closeTrack(3);
  await g.sync();
  assert.deepEqual([closure().closed, closure().fault], [true, null]);
  g.openTrack(3);
  await g.sync();
  assert.deepEqual([closure().closed, closure().fault], [false, null]);
  g.closeTrack("2");
  await g.sync();
  assert.deepEqual([closure().closed, closure().fault], [true, "ASig N2"]);
  // the repair, and the track given back: that opening is still the failure's
  g.reportFault();
  status("dispatched");
  status("arrived");
  status("working");
  status("done");
  g.openTrack(2);
  await g.sync();
  assert.deepEqual([closure().closed, closure().fault, g.team.state], [false, "ASig N2", "left"]);
  // closed again later, for another reason: not the failure's any more
  g.closeTrack(2);
  await g.sync();
  assert.deepEqual([closure().closed, closure().fault], [true, null]);
});

test("a session with the lab cannot be played again from its record, and says so", async () => {
  assert.equal(LabGame.replays, false);
  const lab = new SmallLab();
  const mission = normalizeMission({ format: MISSION_FORMAT, id: "lab", title: "Lab", text: "A test.", roles: [{ role: "train-dispatcher", game: "lab", seat: "human", options: {} }, { role: "maintenance-dispatcher", game: "maintenance" }] }, GAMES);
  mission.roles[0].options.api = lab;
  assert.equal(Session.replayable(mission, GAMES), false);
  const s = new Session(mission, { games: GAMES, seed: 1 }).start();
  await s.sync();
  s.step(30);
  s.act("train-dispatcher", "closeTrack", 3);
  // what was done in the lab at its time would all arrive at once in a new instance: refused, not guessed
  assert.throws(() => Session.replay(mission, s.save(), { games: GAMES }), /a session with "The lab's morning" cannot be played again from its record: its world is elsewhere and starts anew/);
  await s.leave();
  // the missions without the lab can
  const morning = normalizeMission({ format: MISSION_FORMAT, id: "m", title: "M", text: "A test.", roles: [{ role: "signaller-relay", game: "signaller" }, { role: "maintenance-dispatcher", game: "maintenance" }] }, GAMES);
  assert.equal(Session.replayable(morning, GAMES), true);
});

test("a closure request is the failure's only with its fault, or without one for its own track", async () => {
  const start = async () => {
    const g = new LabGame({ api: new SmallLab(), failure: FAILURE, length: 2400, wired: ["repair-status"] });
    while (g.t < 800) {
      await g.sync();
      if (!g.holding) g.step(0.5);
    }
    g.reportFault();
    return g;
  };
  const ask = (g, payload) => g.receive({ flow: "closure-request", from: "possession-planner", t: g.t, payload });
  // another fault, or no fault and another track: not this failure's team
  let g = await start();
  ask(g, { fault: "w12", track: "IN 2" });
  ask(g, { track: "IN 3" });
  assert.deepEqual([g.team.state, g.open.map((d) => d.id)], ["called", []]);
  // this failure by its id, or no fault and its own track, or neither
  ask(g, { fault: "ASig N2", track: "IN 2" });
  assert.deepEqual([g.team.state, g.open.map((d) => d.id)], ["waiting", ["closure"]]);
  g = await start();
  ask(g, { track: "IN 2" });
  assert.equal(g.team.state, "waiting");
  g = await start();
  ask(g, {});
  assert.equal(g.team.state, "waiting");
});

test("a connection request: the train waits beyond its own departure; one that cannot be followed is said at the seat", async () => {
  const lab = new SmallLab();
  const g = new LabGame({ api: lab, length: 1200 });
  await g.sync();
  const ask = (payload) => g.receive({ flow: "connection-request", from: "ru-control-dispatcher", t: g.t, payload });
  ask({ hold: "4914", for: "26611", minutes: 45 });
  assert.equal(g.holds.size, 0);
  assert.deepEqual(g.logs.at(-1), { ...g.logs.at(-1), kind: "request", text: "08:00 A request to hold 4914 for 45 min was not followed: Hold a train for 1 to 30 minutes." });
  ask({ minutes: 3 });
  assert.match(g.logs.at(-1).text, /A request to hold a train for 3 min was not followed: Which train\?/);
  // asked at 08:00 for 3 minutes: 4914 (departure 08:10) waits until 08:13, as at the signaller's, not until 08:03
  ask({ hold: "4914", for: "26611", minutes: 3 });
  assert.match(g.logs.at(-1).text, /^08:00 4914 waits at Neustadt up to 3 min beyond its departure, for the passengers of 26611\.$/);
  assert.deepEqual([...g.holds], [["4914", Infinity]]);
  assert.match(g.view().tables.find((t) => t.id === "interventions").rows[0][1], /beyond its departure, as asked/);
  await g.sync();
  assert.deepEqual(lab.requests.filter((r) => r[0] === "command"), [["command", "delay", "4914"]]);
  assert.deepEqual([...g.holds], [["4914", 600 + 180]]);
  assert.match(g.view().tables.find((t) => t.id === "interventions").rows[0][1], /^until 08:13$/);
  // a train the lab does not know: refused there, said here; the link holds, and the next intervention goes out
  ask({ hold: "RB 32", minutes: 3 });
  g.closeTrack(3);
  await g.sync();
  assert.deepEqual([g.link.state, g.holds.has("RB 32"), lab.closed.has(3)], ["ok", false, true]);
  assert.ok(g.logs.some((l) => /The lab did not take "delay" for RB 32: the commands have errors; none was applied \(no train RB 32\)/.test(l.text)));
  // the dispatcher's own hold is from now, as before
  assert.deepEqual(g.act("hold", "4915", 5), { ok: true });
  assert.deepEqual(g.holds.get("4915"), g.t + 300);
  // the train leaves at 08:13, three minutes beyond its time
  while (g.t < 900) {
    await g.sync();
    if (!g.holding) g.step(0.5);
  }
  await g.sync();
  assert.equal(g.trains.get("4914").delay_s, 180);
  assert.equal(g.holds.has("4914"), false);
});

test("the shift's clock reaches the lab: a mission that begins at 09:00 runs the lab from 09:00", async () => {
  const lab = new SmallLab();
  const mission = normalizeMission({
    format: MISSION_FORMAT, id: "lab", title: "Lab", text: "A test.",
    roles: [{ role: "train-dispatcher", game: "lab", options: { failure: FAILURE } }, { role: "maintenance-dispatcher", game: "maintenance" }],
    phases: [{ id: "shift", kind: "shift", roles: ["train-dispatcher", "maintenance-dispatcher"], length: 1200, clock: "09:00" }],
  }, GAMES);
  mission.roles[0].options.api = lab;
  assert.deepEqual(validateMission(mission, GAMES), []);
  const seen = [];
  const create = lab.create.bind(lab);
  lab.create = async (spec) => (seen.push(spec), create(spec));
  const s = new Session(mission, { games: GAMES, seed: 1 });
  s.start();
  await s.sync();
  // the instance covers the shift as the page shows it, and the scripted failure comes at its time of that day
  assert.deepEqual([seen[0].start, seen[0].end, seen[0].commands[0].at], ["09:00:00", "09:20:00", "09:13:00"]);
  const g = s.seat("train-dispatcher").game, mt = s.seat("maintenance-dispatcher").game;
  assert.equal(g.start, 9 * 3600);
  assert.match(g.logs[0].text, /^09:00 The shift begins/);
  // the dispatcher's game tells the time by the same clock
  assert.equal(mt.start, 9 * 3600);
  assert.match(mt.logs[0].text, /^09:00 The shift begins/);
  await s.leave();
});

test("a train is held in the lab or nowhere: when the lab is gone the holds end, and no new one is taken", async () => {
  const lab = new SmallLab();
  const g = new LabGame({ api: lab, length: 1200 });
  await g.sync();
  const ask = (payload) => g.receive({ flow: "connection-request", from: "ru-control-dispatcher", t: g.t, payload });
  // one hold confirmed by the lab, one of the seat's own
  ask({ hold: "4914", minutes: 3 });
  await g.sync();
  g.hold("4915", 5);
  await g.sync();
  assert.deepEqual([...g.holds.keys()], ["4914", "4915"]);
  // the lab stops answering while another request is on its way
  lab.commands = async () => {
    throw new Error("connection refused");
  };
  ask({ hold: "26612", minutes: 4 });
  assert.equal(g.holds.get("26612"), Infinity);
  await g.sync();
  assert.equal(g.link.state, "lost");
  // nothing is listed as held, and nothing is offered to be let go
  assert.equal(g.holds.size, 0);
  assert.ok(g.logs.some((l) => /Without the lab no train is held: 4914, 4915, 26612 are no longer held here\./.test(l.text)));
  assert.equal(g.view().actions.some((a) => a.name === "release"), false);
  assert.deepEqual(g.view().tables.find((t) => t.id === "interventions").rows, []);
  // a request that comes now is not kept for a lab that is gone: said at the seat
  ask({ hold: "83716", for: "4915", minutes: 3 });
  assert.equal(g.holds.size, 0);
  assert.match(g.logs.at(-1).text, /A request to hold 83716 for 3 min was not followed: The lab does not answer: a train cannot be held\./);
  assert.deepEqual(g.act("hold", "83716", 5), { ok: false, reason: "The lab does not answer: a train cannot be held." });
  // nothing waits to be sent, so the end of the shift is not held up
  g.step(1200);
  assert.deepEqual([g.holding, !!g.over], [false, true]);
  // without any lab, the same
  const none = new LabGame({ length: 60 });
  assert.equal(none.act("hold", "4914", 5).ok, false);
});

test("the API's refusal says what was wrong, and is told apart from a lab that does not answer", async () => {
  const answer = (status, body) => async () => ({ ok: false, status, json: async () => body });
  const refused = new EblApi({ url: "https://lab.example", key: "k", fetch: answer(422, { error: { code: "bad_commands", message: "the commands have errors; none was applied", details: [{ index: 0, error: "no train RB 32" }] } }) });
  await assert.rejects(refused.commands("sim-1", [{ kind: "delay", train: "RB 32" }]), (e) => e.status === 422 && e.message === "the commands have errors; none was applied (no train RB 32)");
  const gone = new EblApi({ url: "https://lab.example", key: "k", fetch: answer(404, { error: { code: "not_found", message: "no instance sim-1" } }) });
  await assert.rejects(gone.step("sim-1", 10), (e) => e.status === 404 && e.message === "no instance sim-1");
  // an instance that is gone is a lost lab, not a refused intervention
  const lab = new SmallLab();
  const g = new LabGame({ api: lab, length: 600 });
  await g.sync();
  lab.commands = async () => {
    throw Object.assign(new Error("no instance sim-1"), { status: 404 });
  };
  g.closeTrack(3);
  await g.sync();
  assert.deepEqual(g.link, { state: "lost", error: "no instance sim-1" });
});

test("a lab that does not answer: the seat says so and the shift goes on without it; without an address there is no lab", async () => {
  const dead = { create: async () => { throw new Error("connection refused"); } };
  const g = await alone(new LabGame({ api: dead, length: 60 }));
  assert.deepEqual(g.link, { state: "lost", error: "connection refused" });
  assert.equal(g.holding, false);
  assert.ok(g.logs.some((l) => /does not answer: connection refused/.test(l.text)));
  const none = new LabGame({ length: 60 });
  assert.deepEqual([none.link.state, none.holding], ["none", false]);
  assert.equal(none.view().figures[0].value, "no address");
  // the API's requests: the address, the key, the errors
  const calls = [];
  const api = new EblApi({ url: "http://lab.example/v1/", key: "ebl_k", fetch: async (url, init) => {
    calls.push([init.method, url, init.headers.Authorization, init.body]);
    return url.endsWith("/state") ? { ok: false, status: 404, json: async () => ({ error: { code: "not_found", message: "No such instance." } }) } : { ok: true, json: async () => ({ id: "i7" }) };
  } });
  assert.deepEqual(await api.create({ start: "08:00" }), { id: "i7" });
  await api.step("i7", 5);
  await api.commands("i7", [{ kind: "hold", train: "1" }]);
  await assert.rejects(api.state("i7"), /No such instance/);
  assert.deepEqual(calls.map((c) => [c[0], c[1].replace("http://lab.example", "")]), [["POST", "/v1/instances"], ["POST", "/v1/instances/i7/step"], ["POST", "/v1/instances/i7/commands"], ["GET", "/v1/instances/i7/state"]]);
  assert.ok(calls.every((c) => c[2] === "Bearer ebl_k"));
  assert.equal(calls[1][3], JSON.stringify({ seconds: 5 }));
  assert.ok(LabGame.settings.some((x) => x.id === "url") && LabGame.settings.some((x) => x.id === "key"));
});
