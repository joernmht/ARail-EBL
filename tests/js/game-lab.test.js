// The lab as a seat (web/arail/game/lab.js): the EBL's simulation behind its API as the world of a
// shift. A small lab of its own stands in for the API here: the requests the seat sends (the
// instance with the scripted failure, steps, interventions), the lab's events as flows, the flows
// of other roles as interventions, the clock that waits for the lab, a lab that does not answer.
import assert from "node:assert/strict";
import test from "node:test";

import { CHUNK_S, EblApi, GAMES, LAG_S, LabGame, LabPlayer, MISSION_FORMAT, normalizeMission, Session } from "../../web/arail/game/index.js";

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
    if (c.kind === "hold") this.holds.set(c.train, sec(c.until));
    else if (c.kind === "release") this.holds.delete(c.train);
    else if (c.kind === "failSignal") this.failed.set(c.signal, sec(c.at));
    else if (c.kind === "repairSignal") this.failed.delete(c.signal);
    else if (c.kind === "closeTrack") this.closed.add(c.track);
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
    for (const c of list) this.apply(c);
    return { applied: list };
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
  await g.sync();
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
  assert.match(g.act("closeTrack", 3).reason, /already closed/);
  // a connection asked for by an undertaking is a hold too
  g.receive({ flow: "connection-request", from: "ru-control-dispatcher", t: 0, payload: { hold: "26611", for: "4914", minutes: 8 } });
  await alone(g, { think() {} });
  assert.deepEqual(lab.requests.filter((r) => r[0] === "command").map((r) => [r[1], r[2]]), [["hold", "4914"], ["closeTrack", 3], ["hold", "26611"]]);
  assert.equal(g.trains.get("4914").delay_s, 0); // held from 08:00 for 5 min, due at 08:10
  assert.equal(g.trains.get("26611").delay_s, 180); // due at 08:05, held until 08:08
  assert.deepEqual(g.outbox.filter((m) => m.flow === "delay-notice").map((m) => [m.payload.train, m.payload.delay_min]), [["26611", 3]]);
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
  assert.deepEqual(steps, ["fault-report", "repair-status:dispatched", "repair-status:arrived", "track-closure:true", "closure-request", "repair-status:working", "repair-status:done", "track-closure:false"]);
  assert.deepEqual(lab.requests.filter((r) => r[0] === "command").map((r) => r[1]), ["failSignal", "closeTrack", "repairSignal", "openTrack"]);
  assert.equal(g.failure.repaired, mt.fault("ASig N2").done);
  assert.ok(lab.failed.size === 0 && lab.closed.size === 0);
  assert.ok(s.result().passed, JSON.stringify(s.result().seats.map((x) => [x.seat, x.score])));
  assert.deepEqual(s.flows.filter((f) => f.flow === "performance-report").map((f) => f.payload.kind), ["operations", "maintenance"]);
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
