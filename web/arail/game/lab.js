/**
 * The lab as a seat: the operations of a shift played by the EBL itself, for now by its timetable
 * simulation behind its HTTP API (the `ebl` repository, 5 Digitaler Zwilling/SIMULATION.md), later
 * by the lab's own systems. The seat is the infrastructure manager's dispatcher of the lab's
 * network: the trains run by the lab's timetable and are routed by the simulation's signal boxes;
 * the person (or the computer) at this seat reports a failed signal, closes a station track for the
 * repair team, opens it again, and holds trains.
 *
 * To the other roles the seat looks like any game: what happens in the lab goes out as flows (a
 * late train as a delay notice, the failed signal as a fault report, the track closed), and the
 * flows that come in become interventions in the lab (a connection request holds a train, the
 * repair team's report repairs the signal). The game's world is elsewhere: `sync` sends the
 * interventions and reads the lab's events between the session's ticks, and the session's clock
 * waits (`holding`) while the lab has not caught up.
 * @module arail/game/lab
 */
import { Game, Player, clockAt } from "./core.js";

/** How far the lab may lag behind the session's clock before the clock waits (s), and the step it is advanced by (s). */
export const LAG_S = 30;
export const CHUNK_S = 10;
/** How often a request is tried again when the API says that its limit of requests per second is reached. */
const TRIES = 6;
/** A delay is told to the undertakings from this many seconds on. */
const NOTICE_S = 60;
/** Lateness that counts nothing in the score (min), and the mean lateness at which nothing is left. */
export const LATE_MIN = { good: 1, bad: 8 };

/** HH:MM:SS of seconds after midnight. */
const hms = (s) => {
  const t = Math.max(0, Math.round(s));
  return `${String(Math.floor(t / 3600) % 24).padStart(2, "0")}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
/** Seconds after midnight of "HH:MM" or "HH:MM:SS". */
const seconds = (text) => String(text).split(":").reduce((a, x, i) => a + Number(x) * [3600, 60, 1][i], 0);

/**
 * The API of the EBL's timetable simulation, as far as the lab's seat needs it: an instance of a
 * timetable, stepped, with its events, its state and interventions (commands).
 */
export class EblApi {
  /** @param {{url: string, key?: string, fetch?: Function}} options the address up to and without `/v1`, an API key, and `fetch` (the browser's or Node's) */
  constructor({ url, key = "", fetch: f = globalThis.fetch } = {}) {
    this.url = String(url ?? "").replace(/\/+$/, "").replace(/\/v1$/, "");
    this.key = key;
    this.fetch = f;
  }

  /**
   * One request; the answer's JSON, or an error with the API's message. When the API's limit of
   * requests per second is reached (429 with Retry-After), it waits and tries again.
   */
  async request(method, path, body = null, init = {}) {
    for (let i = 1; ; i++) {
      const res = await this.fetch(`${this.url}/v1${path}`, {
        ...init, method, headers: { ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data;
      if (res.status === 429 && data?.error?.code === "rate_limited" && i < TRIES) {
        const wait = Math.min(5, Number(res.headers?.get?.("Retry-After")) || 1);
        await new Promise((done) => setTimeout(done, wait * 1000));
        continue;
      }
      throw new Error(data?.error?.message ?? `The lab's API answered ${res.status}.`);
    }
  }

  /** A new instance: `{timetable, start, end, options, commands, name}`. */
  create(spec) {
    return this.request("POST", "/instances", spec);
  }

  /** Advance an instance by simulated seconds. */
  step(id, s) {
    return this.request("POST", `/instances/${id}/step`, { seconds: s });
  }

  /** The events after a sequence number. */
  events(id, after = 0) {
    return this.request("GET", `/instances/${id}/events?after=${after}&limit=2000`);
  }

  /** The trains, the cleared signals, the waiting routes, the interventions. */
  state(id) {
    return this.request("GET", `/instances/${id}/state`);
  }

  /** Interventions: hold, release, closeTrack, openTrack, failSignal, repairSignal. */
  commands(id, list) {
    return this.request("POST", `/instances/${id}/commands`, { commands: list });
  }

  /** Planned against actual times of every run. */
  results(id) {
    return this.request("GET", `/instances/${id}/results`);
  }

  /** Delete the instance (a key has only a few). The request outlives the page that sends it. */
  remove(id) {
    return this.request("DELETE", `/instances/${id}`, null, { keepalive: true });
  }
}

/** The computer at the lab's seat: reports the failure at once, closes the track when the team asks, opens it after its report. */
export class LabPlayer extends Player {
  /** @param {LabGame} g */
  think(g) {
    for (const d of g.open) g.act("decide", d.id, d.options[0].id);
  }
}

export class LabGame extends Game {
  static id = "lab";
  static title = "The lab's morning";
  static role = "train-dispatcher";
  static kind = "simulation";
  static description = "The trains of the lab's timetable, run by the EBL's simulation: report the signal that fails, close the station track for the repair team and open it again, hold trains for a connection.";
  static scale = "minutes";
  static takes = [
    { flow: "repair-status", from: ["maintenance-dispatcher"] },
    // the seat also stands for the lab's signal boxes, which grant a closure
    { flow: "closure-request" },
    { flow: "connection-request", from: ["ru-control-dispatcher"] },
  ];
  static gives = [
    { flow: "fault-report", to: ["maintenance-dispatcher"] },
    { flow: "track-closure" },
    { flow: "delay-notice" },
    { flow: "performance-report" },
  ];
  static actions = {
    ...Game.actions,
    reportFault: { label: "Report the fault" },
    closeTrack: { label: "Close a station track" },
    openTrack: { label: "Open a station track" },
    hold: { label: "Hold a train" },
    release: { label: "Let a train go" },
  };
  static player = LabPlayer;
  static replays = false;
  static settings = [
    { id: "url", label: "Address of the lab's simulation API", type: "text", value: "http://127.0.0.1:8095", hint: "Start it with: python -m ebl_twin.sim api --keys api_keys.json --cors" },
    { id: "key", label: "API key", type: "password", hint: "From: python -m ebl_twin.sim apikey add <name>" },
  ];

  /**
   * @param {object} [options]
   * @param {string} [options.url] the API's address
   * @param {string} [options.key] the API key
   * @param {object} [options.api] an API object instead (tests)
   * @param {string} [options.station] the station the seat looks after (the lab's abbreviation), and `stationName`
   * @param {object} [options.timetable] the lab's timetable of the instance: `{version, day, trains?}`
   * @param {string} [options.clock] the start of the shift, "HH:MM"
   * @param {{signal: string, track: number, at: number}} [options.failure] a signal that fails `at` seconds into the shift; `track`: the station track it stands at
   * @param {number} [options.length] the shift (s)
   */
  constructor(options = {}) {
    super(options);
    this.api = options.api ?? (options.url ? new EblApi({ url: options.url, key: options.key }) : null);
    this.station = options.station ?? "IN";
    this.stationName = options.stationName ?? "Neustadt";
    this.timetable = options.timetable ?? { version: 5, day: 1 };
    /** The start of the shift (s after midnight) and its length (s). */
    this.start = seconds(options.clock ?? "08:00");
    this.length = options.length ?? 2400;
    /** The lab's instance, how far it has run (s into the shift), the last event read. */
    this.instance = null;
    this.labT = 0;
    this._seq = 0;
    this._busy = false;
    /** The game was left (`leave`): nothing more is exchanged; the instance was deleted at the lab (`_remove`). */
    this._left = false;
    this._removed = false;
    /** The link to the lab: "none" (no address) | "connecting" | "ok" | "lost", with the last error. */
    this.link = { state: this.api ? "connecting" : "none", error: this.api ? "" : "No address of the lab's simulation was given." };
    /** Interventions on their way to the lab. */
    this._out = [];
    /** The trains seen at the station: id → {train, category, last, planned, actual, delay_s}. */
    this.trains = new Map();
    /** Active holds (train → until, s into the shift) and closed station tracks. */
    this.holds = new Map();
    this.closed = new Set();
    const f = options.failure ?? null;
    this.failure = f ? { ...f, started: false, reported: null, repaired: null } : null;
    /** The repair team, as its steps arrive: "none" | "called" | "driving" | "waiting" | "working" | "done" | "left". */
    this.team = { state: "none" };
    this._workUntil = null;
    this.resource("commands", "Interventions", 0);
    this.log(`${clockAt(0, this.start)} The shift begins at ${this.stationName}: the trains run by the lab's timetable.`);
    if (!this.api) this.log(this.link.error, "fault");
  }

  /** The name a station track goes by in flows. */
  trackName(n) {
    return `${this.station} ${n}`;
  }

  /* ---------------------------------------------------------------- the lab */

  /** The clock waits while the lab is not there yet or lags too far behind. */
  get holding() {
    if (!this.api || this.link.state === "lost") return false;
    if (this.instance == null) return true;
    // at the end of the shift the lab is brought up to it, and what was ordered last is sent
    if (this.t >= this.length) return Math.floor(this.length - this.labT) > 0 || this._out.length > 0;
    return this.t - this.labT > LAG_S;
  }

  /** Send the interventions, advance the lab to the game's time, read what happened there. */
  async sync() {
    if (!this.api || this._busy || this._left || this.link.state === "lost") return;
    this._busy = true;
    try {
      if (this.instance == null) {
        const f = this.failure;
        const made = await this.api.create({
          name: "ARail session", timetable: this.timetable, start: hms(this.start), end: hms(this.start + this.length),
          commands: f ? [{ kind: "failSignal", signal: f.signal, station: this.station, at: hms(this.start + f.at) }] : [],
        });
        this.instance = made.id;
        // left while the lab was making the instance: it is given back at once
        if (this._left) return void (await this._remove());
        this.link = { state: "ok", error: "" };
        this.log(`${clockAt(this.t, this.start)} Connected to the lab's simulation (instance ${made.id}).`);
      }
      if (this._out.length) {
        const list = this._out.splice(0);
        await this.api.commands(this.instance, list);
        if (this._left) return;
        this.add("commands", list.length);
      }
      const due = Math.floor(Math.min(this.t, this.length) - this.labT);
      if (due >= CHUNK_S || (this.t >= this.length && due > 0)) {
        const res = await this.api.step(this.instance, due);
        if (this._left) return;
        this.labT += res.advancedS ?? due;
        const ev = await this.api.events(this.instance, this._seq);
        if (this._left) return;
        for (const e of ev.events ?? []) this._event(e);
        if (ev.last != null) this._seq = ev.last;
        else if (ev.events?.length) this._seq = ev.events.at(-1).seq;
      }
    } catch (e) {
      // a game that was left meanwhile has deleted its instance: what was still on its way fails, and says nothing
      if (this._left) return;
      this.link = { state: "lost", error: e.message };
      this.log(`${clockAt(this.t, this.start)} The lab's simulation does not answer: ${e.message}`, "fault");
    } finally {
      this._busy = false;
    }
    // the shift's time was up and the lab has caught up (or does not answer any more): now the shift is over
    if (this.t >= this.length && !this.over && !this.holding) {
      this.end(`${clockAt(this.length, this.start)}: the shift is over.`);
      await this.leave();
    }
  }

  /**
   * The shift is over or given up: nothing more is exchanged with the lab, and the instance is deleted there (a
   * key has only a few). Left while the instance is still being made, it is deleted as soon as it is there (`sync`).
   */
  async leave() {
    if (this._left) return;
    this._left = true;
    await this._remove();
  }

  /** Delete the instance at the lab, once. */
  async _remove() {
    if (!this.api?.remove || this.instance == null || this._removed) return;
    this._removed = true;
    try {
      await this.api.remove(this.instance);
    } catch {
      // the lab does not answer: its instance ends by itself when it has not been used for a day
    }
  }

  /** An event of the lab: a train at the station, a route that waits. */
  _event(e) {
    const at = (e.t ?? this.start) - this.start;
    if (["depart", "arrive", "pass"].includes(e.kind) && e.station === this.station) {
      const row = { train: e.train, last: e.kind, planned: e.planned ?? "", actual: e.actual ?? "", delay_s: e.delayS ?? 0 };
      this.trains.set(e.train, row);
      if (e.kind !== "arrive" && row.delay_s >= NOTICE_S) {
        this.give("delay-notice", { train: e.train, kind: "", place: this.stationName, stage: e.kind === "depart" ? "departed" : "passed", delay_min: Math.round(row.delay_s / 6) / 10, connection: null, cause: this.failure?.started && this.failure.repaired == null ? "signal failure" : "" });
      }
      this.log(`${clockAt(at, this.start)} ${e.train} ${e.kind === "depart" ? "departs from" : e.kind === "arrive" ? "arrives at" : "passes"} ${this.stationName}${row.delay_s >= NOTICE_S ? `, ${Math.round(row.delay_s / 60)} min late` : ""}.`, "train");
    } else if (e.kind === "stuck") {
      this.log(`${clockAt(at, this.start)} ${e.train} has waited ${Math.round((e.waitingS ?? 0) / 60)} min at ${e.signal}${e.blockedBy ? ` (${e.blockedBy})` : ""}.`, "train");
    }
  }

  /* ---------------------------------------------------------------- the player's moves */

  /** Report the failed signal to the maintenance dispatcher. */
  reportFault() {
    const f = this.failure;
    if (!f?.started || f.reported != null) return false;
    f.reported = this.t;
    this.team = { state: "called" };
    this.give("fault-report", { fault: f.signal, asset: `Signal ${f.signal}`, kind: "does not clear", place: this.stationName, track: this.trackName(f.track), holds: 4, since_s: Math.round(this.t - f.at) });
    this.log(`${clockAt(this.t, this.start)} Fault of ${f.signal} reported to the maintenance dispatcher.`, "fault");
    const d = this.decisions.find((x) => x.id === "report" && !x.made);
    if (d) this.decide("report", "now");
    return true;
  }

  /**
   * Close a station track in the lab: no route is set into it any more.
   * @returns {{ok: boolean, reason?: string}}
   */
  closeTrack(track) {
    const n = Number(track);
    if (!(n >= 1)) return { ok: false, reason: "There is no such track." };
    if (this.closed.has(n)) return { ok: false, reason: `Track ${n} is already closed.` };
    this.closed.add(n);
    this._out.push({ kind: "closeTrack", station: this.station, track: n });
    this.give("track-closure", { place: this.stationName, track: this.trackName(n), closed: true, fault: this._faultOf(n) });
    this.log(`${clockAt(this.t, this.start)} Track ${n} of ${this.stationName} closed.`, "closure");
    if (this.failure?.track === n && this.team.state === "waiting") this.team.state = "working";
    this._tidy();
    return { ok: true };
  }

  /** Open a closed station track again. With the repair team still on it, it is a danger to them. */
  openTrack(track) {
    const n = Number(track);
    if (!this.closed.has(n)) return { ok: false, reason: `Track ${n} is not closed.` };
    if (this.failure?.track === n && this.team.state === "working") this.violate("closure-workers", `${clockAt(this.t, this.start)} Track ${n} opened while the repair team works on it.`, 3);
    this.closed.delete(n);
    this._out.push({ kind: "openTrack", station: this.station, track: n });
    this.give("track-closure", { place: this.stationName, track: this.trackName(n), closed: false, fault: this._faultOf(n) });
    this.log(`${clockAt(this.t, this.start)} Track ${n} of ${this.stationName} open.`, "closure");
    if (this.failure?.track === n && this.team.state === "done") this.team.state = "left";
    this._tidy();
    return { ok: true };
  }

  /**
   * Hold a train at the station for some minutes: it gets no route out until then.
   * @returns {{ok: boolean, reason?: string}}
   */
  hold(train, minutes = 3) {
    const id = String(train ?? "").trim(), min = Number(minutes);
    if (!id) return { ok: false, reason: "Which train?" };
    if (!(min > 0 && min <= 30)) return { ok: false, reason: "Hold a train for 1 to 30 minutes." };
    const until = this.t + min * 60;
    this.holds.set(id, until);
    this._out.push({ kind: "hold", train: id, station: this.station, until: hms(this.start + until) });
    this.log(`${clockAt(this.t, this.start)} ${id} is held at ${this.stationName} until ${clockAt(until, this.start)}.`, "request");
    return { ok: true };
  }

  /** Let a held train go. */
  release(train) {
    const id = String(train ?? "").trim();
    if (!this.holds.has(id)) return { ok: false, reason: `${id} is not held.` };
    this.holds.delete(id);
    this._out.push({ kind: "release", train: id });
    this.log(`${clockAt(this.t, this.start)} ${id} may go.`, "request");
    return { ok: true };
  }

  /* ---------------------------------------------------------------- flows from the other roles */

  take(msg) {
    const p = msg.payload ?? {}, f = this.failure;
    if (msg.flow === "connection-request") {
      const res = this.hold(p.hold, p.minutes ?? 3);
      if (!res.ok) this.log(`${clockAt(this.t, this.start)} A request to hold ${p.hold ?? "a train"}${p.minutes != null ? ` for ${p.minutes} min` : ""} was not followed: ${res.reason}`, "request");
    } else if (msg.flow === "repair-status" && f?.started && (p.fault == null || p.fault === f.signal)) {
      if (p.state === "dispatched" && this.team.state === "called") this.team.state = "driving";
      else if (p.state === "arrived") this._teamArrived();
      else if (p.state === "diagnosed" || p.state === "working") this.team.state = "working";
      else if (p.state === "left" && f.repaired == null) this.team.state = "called";
      else if (p.state === "done") this._teamDone();
      else if (p.state === "relapsed") this._relapsed();
    } else if (msg.flow === "closure-request" && f?.started && (p.fault != null ? p.fault === f.signal : p.track == null || p.track === this.trackName(f.track))) {
      // a request that names another fault, or no fault and another track, is not for this failure's team
      this._teamArrived();
    }
    this._tidy();
  }

  _teamArrived() {
    const f = this.failure;
    if (["waiting", "working", "done", "left"].includes(this.team.state)) return;
    this.team.state = this.closed.has(f.track) ? "working" : "waiting";
    this.log(`${clockAt(this.t, this.start)} The repair team is at ${f.signal} and asks for track ${f.track} to be closed.`, "fault");
    if (this.closed.has(f.track)) return;
    this.ask({
      id: "closure", title: `The repair team asks for track ${f.track} of ${this.stationName} to be closed.`,
      text: "Closed in the lab, no route is set into it; a train already on its way in still arrives.",
      options: [{ id: "close", label: `Close track ${f.track}` }, { id: "wait", label: "Ask the team to wait" }],
      then: (o) => {
        if (o === "close") this.closeTrack(f.track);
      },
    });
  }

  /**
   * Questions whose occasion has passed are taken back: nobody is asked to report what is reported, to close the
   * track for a team that does not wait for it, or to open it when it is open or a team is on it.
   */
  _tidy() {
    const f = this.failure, team = this.team.state, closed = !!f && this.closed.has(f.track);
    if (!(f?.started && f.reported == null)) this.withdraw("report");
    if (team !== "waiting" || closed) this.withdraw("closure");
    if (team !== "done" || !closed) this.withdraw("reopen");
  }

  /** The failed signal whose track this is, or null: a track closed for another reason is not the failure's closure. */
  _faultOf(n) {
    const f = this.failure;
    return f?.started && Number(f.track) === Number(n) ? f.signal : null;
  }

  /** A provisional repair did not hold: the signal fails again in the lab; the maintenance dispatcher knows. */
  _relapsed() {
    const f = this.failure;
    if (f.repaired == null) return;
    f.repaired = null;
    this.team.state = "called";
    this._out.push({ kind: "failSignal", signal: f.signal, station: this.station, at: hms(this.start + this.t) });
    this.log(`${clockAt(this.t, this.start)} ${f.signal} does not clear again: the provisional repair did not hold.`, "fault");
  }

  _teamDone() {
    const f = this.failure;
    if (f.repaired != null) return;
    f.repaired = this.t;
    this.team.state = this.closed.has(f.track) ? "done" : "left";
    this._out.push({ kind: "repairSignal", signal: f.signal, station: this.station });
    this.log(`${clockAt(this.t, this.start)} The repair team reports: ${f.signal} repaired, everybody has left the track.`, "fault");
    if (!this.closed.has(f.track)) return;
    this.ask({
      id: "reopen", title: `The repair is done and the team has left the track. Open track ${f.track} again?`,
      options: [{ id: "open", label: `Open track ${f.track}` }, { id: "later", label: "Later" }],
      then: (o) => {
        if (o === "open") this.openTrack(f.track);
      },
    });
  }

  /* ---------------------------------------------------------------- the game's step */

  tick() {
    const f = this.failure;
    if (f && !f.started && this.t >= f.at) {
      f.started = true;
      this.log(`${clockAt(this.t, this.start)} Signal ${f.signal} at ${this.stationName} does not clear.`, "fault");
      this.ask({
        id: "report", title: `Signal ${f.signal} has failed. Report the fault to the maintenance dispatcher?`,
        options: [{ id: "now", label: "Report it now" }, { id: "later", label: "Later" }],
        then: (o) => {
          if (o === "now") this.reportFault();
        },
      });
    }
    if (f?.started && f.reported != null && !this.isWired("repair-status")) {
      // alone, the game plays the repair team itself: ten minutes to come, six to repair
      if (this.team.state === "called" && this.t >= f.reported + 600) this._teamArrived();
      if (this.team.state === "working" && this._workUntil == null) this._workUntil = this.t + 360;
      if (this.team.state === "working" && this.t >= this._workUntil) this._teamDone();
    }
    for (const [id, until] of this.holds) if (this.t >= until) this.holds.delete(id);
    this._tidy();
    // with the lab behind, the shift ends in `sync`, once the lab is brought up to its end
    if (this.t >= this.length && !this.holding) this.end(`${clockAt(this.length, this.start)}: the shift is over.`);
  }

  /** The shift's account. */
  finish() {
    const st = this.stats(), f = this.failure;
    this.give("performance-report", {
      scope: this.stationName, kind: "operations", trains: st.trains, delay_min: st.delay_min, late: st.late, connections: 0, connections_kept: 0,
      faults: f?.started ? 1 : 0, restore_min: f?.repaired != null ? Math.round((f.repaired - f.at) / 6) / 10 : null, violations: this.violations.length, score: this.score().total,
    });
  }

  /** The trains that left or passed the station so far: how many, their lateness in all (min), how many 3 min late or more. */
  stats() {
    const rows = [...this.trains.values()].filter((r) => r.last !== "arrive");
    const late = rows.map((r) => Math.max(0, r.delay_s) / 60);
    return { trains: rows.length, delay_min: Math.round(late.reduce((a, x) => a + x, 0) * 10) / 10, late: late.filter((x) => x >= 3).length, mean_min: rows.length ? late.reduce((a, x) => a + x, 0) / rows.length : 0 };
  }

  objectives() {
    const st = this.stats(), f = this.failure;
    let upkeep = 1, note = "no failure";
    if (f?.started) {
      const late = f.reported == null ? null : (f.reported - f.at) / 60;
      upkeep = late == null ? 0 : late <= 2 ? 1 : late <= 6 ? 0.7 : 0.4;
      note = late == null ? "not reported" : `reported after ${Math.round(late)} min${f.repaired != null ? ", repaired" : ""}`;
    }
    const sev = this.violations.reduce((s, v) => s + (v.severity >= 3 ? 1 : v.severity === 2 ? 0.5 : 0.15), 0);
    return [
      { id: "punctuality", label: "Punctuality", weight: 50, value: 1 - (st.mean_min - LATE_MIN.good) / (LATE_MIN.bad - LATE_MIN.good), note: `${st.trains} trains, ${st.mean_min.toFixed(1)} min late on average` },
      { id: "safety", label: "Safety", weight: 30, value: this.violations.some((v) => v.severity >= 3) ? 0 : 1 - sev, note: `${this.violations.length} rules broken` },
      { id: "upkeep", label: "The failure", weight: 20, value: upkeep, note },
    ];
  }

  view() {
    const st = this.stats(), f = this.failure;
    const rows = [...this.trains.values()];
    const known = [...new Set([...this.trains.keys(), ...this.holds.keys()])];
    const tracks = [1, 2, 3];
    return {
      figures: [
        { label: "The lab", value: { none: "no address", connecting: "connecting", ok: `at ${clockAt(this.labT, this.start)}`, lost: "lost" }[this.link.state], tone: this.link.state === "ok" ? "ok" : this.link.state === "connecting" ? "warn" : "bad" },
        { label: "Trains through", value: st.trains },
        { label: "Late on average", value: st.mean_min.toFixed(1), unit: "min", tone: st.mean_min >= 3 ? "warn" : "ok" },
        ...(f?.started ? [{ label: `Signal ${f.signal}`, value: f.repaired != null ? "repaired" : `failed${this.team.state !== "none" ? `; team ${this.team.state}` : ""}`, tone: f.repaired != null ? "ok" : "bad" }] : []),
      ],
      tables: [
        { id: "trains", title: `Trains at ${this.stationName}`, columns: ["Train", "Last", "Planned", "Actual", "Late"], empty: "No train yet.", rows: rows.map((r) => [r.train, r.last, r.planned, r.actual, r.delay_s >= 60 ? `+${Math.round(r.delay_s / 60)}` : "–"]) },
        { id: "interventions", title: "Interventions", columns: ["", "State"], empty: "None.", rows: [...[...this.closed].map((n) => [`Track ${n}`, "closed"]), ...[...this.holds].map(([id, until]) => [`Hold ${id}`, `until ${clockAt(until, this.start)}`])] },
      ],
      actions: [
        ...(f?.started && f.reported == null ? [{ name: "reportFault", label: `Report the failure of ${f.signal}`, primary: true }] : []),
        { name: "closeTrack", label: "Close a station track", fields: [{ id: "track", label: "Track", options: tracks.filter((n) => !this.closed.has(n)).map((n) => ({ id: String(n), label: String(n) })) }] },
        ...(this.closed.size ? [{ name: "openTrack", label: "Open a station track", fields: [{ id: "track", label: "Track", options: [...this.closed].map((n) => ({ id: String(n), label: String(n) })) }] }] : []),
        ...(known.length ? [{ name: "hold", label: "Hold a train", fields: [{ id: "train", label: "Train", options: known.map((id) => ({ id, label: id })) }, { id: "minutes", label: "For", type: "number", min: 1, max: 30, step: 1, value: 3, unit: "min" }] }] : []),
        ...(this.holds.size ? [{ name: "release", label: "Let a train go", fields: [{ id: "train", label: "Train", options: [...this.holds.keys()].map((id) => ({ id, label: id })) }] }] : []),
      ],
    };
  }
}
