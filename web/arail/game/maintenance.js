/**
 * The maintenance dispatcher's game (Instandhaltungs- und Störungsdisponent/in), "Fault Night": a
 * shift in the maintenance control centre of the district around Bf Neustadt.
 *
 * Faults come in by their report paths: from the signaller, from a train driver, from a station's
 * diagnostics. The dispatcher has one or two emergency teams with their vans and a technician on
 * call, ranks the faults by safety and by the trains they hold, sends a team, and asks the signaller
 * for a track closure before a team works in the track. A team sent into the track without a
 * closure is a danger to people: the shift fails, whatever the score.
 *
 * In a session (session.js) the game is wired to other roles: the signaller's fault report arrives
 * as a flow, the team's steps go back as the repair status, the closure is asked of the signaller
 * and comes back as a track closure; the asset manager's staff plan sets the teams, the condition
 * of the assets how many faults the shift brings. Alone, the game plays those roles itself.
 * @module arail/game/maintenance
 */
import { Game, Player, clockAt } from "./core.js";

/**
 * The district: line 6250 from Bergheim via Bf Neustadt to Talsee and the branch to Waldau, with the
 * kilometres by road from the maintenance base at Bf Neustadt (`via`: by way of this place).
 */
export const DISTRICT = {
  name: "District Neustadt",
  base: "Bf Neustadt",
  places: {
    "Bf Neustadt": { km: 0 },
    Bergheim: { km: 10 },
    Talsee: { km: 9 },
    Waldau: { km: 8 },
  },
};
/** A van's time on the road (s): to another place, within a place, from the base to an asset at its own station. */
export const DRIVE = { base_s: 180, per_km_s: 40, local_s: 120, from_base_s: 300 };
/** The technician on call: time until ready at the base (s), and the hours paid for a call-out. */
export const ON_CALL = { ready_s: 600, hours: 4 };
/** How long a team waits for the dispatcher to ask for the closure before it asks itself (s). */
const ASK_S = 90;
/** The game's own signallers close a track after this long (s, from … to). */
const CLOSURE_S = [60, 150];
/** Restoring a fault that holds trains: full marks within, none beyond (min from the report). */
export const RESTORE_MIN = { good: 12, bad: 32 };

/**
 * The faults a shift can bring, beside those the signaller reports. `holds`: how many trains an
 * hour it holds or slows; `track`: the work is in this track and needs it closed; `safety`: a
 * danger while it is open (a crossing, a dark signal); `work_s`: the repair.
 */
export const FAULTS = [
  { id: "bue", asset: "Level crossing Waldau", kind: "the barriers do not close", place: "Waldau", path: "The crossing's remote monitoring", safety: true, holds: 2, work_s: 480, track: null },
  { id: "w12", asset: "Point W12", kind: "does not reach its end position", place: "Bergheim", path: "The signaller of Bergheim", safety: false, holds: 4, work_s: 420, track: "Bergheim track 2" },
  { id: "azs", asset: "Axle counter section 21", kind: "shows occupied without a train", place: "Talsee", path: "The signaller of Talsee", safety: false, holds: 3, work_s: 300, track: "Talsee track 1" },
  { id: "vsig", asset: "Distant signal Vf", kind: "dark", place: "Bergheim", path: "A train driver (by radio)", safety: true, holds: 2, work_s: 360, track: null },
  { id: "lift", asset: "Lift at platform 2", kind: "out of order", place: "Bf Neustadt", path: "The station's service staff", safety: false, holds: 0, work_s: 540, track: null },
  { id: "dfi", asset: "Platform display", kind: "dark", place: "Talsee", path: "The station's diagnostics", safety: false, holds: 0, work_s: 240, track: null },
];
/** The fault at Bf Neustadt that the game brings itself when no signaller reports it (the signaller's game: exit signal N2). */
const N2 = { id: "N2", asset: "Exit signal N2", kind: "lamp failure", place: "Bf Neustadt", path: "The signaller of Bf Neustadt", safety: false, holds: 4, work_s: 360, track: "G2" };

/** Levels: the teams on shift, whether a technician is on call, how many faults beside the signaller's. */
export const LEVELS = {
  training: { label: "Training: two teams, two faults", teams: 2, on_call: true, faults: 1 },
  normal: { label: "Normal: two teams, four faults", teams: 2, on_call: true, faults: 3 },
  hard: { label: "Hard: one team and the technician on call, five faults", teams: 1, on_call: true, faults: 4 },
};

/** The people who lead the teams (bird names, see CONTRIBUTING.md). */
const LEADERS = ["M. Specht", "L. Kranich", "A. Reiher"], TECHNICIAN = "S. Kartal";

/** Seconds on the road between two places (a van at the base starts from Bf Neustadt). */
export function driveTime(from, to, atBase = false) {
  if (from === to) return atBase ? DRIVE.from_base_s : DRIVE.local_s;
  const a = DISTRICT.places[from]?.km ?? 0, b = DISTRICT.places[to]?.km ?? 0;
  // the places lie on different roads out of Bf Neustadt
  return DRIVE.base_s + DRIVE.per_km_s * (a + b);
}

/**
 * The computer's maintenance dispatcher: the fault that matters most first (a danger, then the
 * trains held, then the oldest), the nearest free team to it, the closure asked for before a team
 * goes into the track, the technician on call when more faults hold trains than teams are free.
 */
export class MaintenancePlayer extends Player {
  /** @param {MaintenanceGame} g */
  think(g) {
    for (const d of g.open) if (d.id.startsWith("closure-")) g.act("decide", d.id, "ask");
    const waiting = g.faults.filter((f) => f.state === "open").sort((a, b) => Number(b.safety) - Number(a.safety) || b.holds - a.holds || a.reported - b.reported);
    for (const f of waiting) {
      const free = g.teams.filter((tm) => tm.state === "ready").sort((a, b) => g.eta(a, f) - g.eta(b, f));
      if (free.length) g.act("send", free[0].id, f.id);
    }
    const left = g.faults.filter((f) => f.state === "open" && (f.holds > 0 || f.safety)).length;
    if (left > 0 && g.onCall === "available" && !g.teams.some((tm) => tm.state === "ready")) g.act("callIn");
  }
}

export class MaintenanceGame extends Game {
  static id = "maintenance";
  static title = "Fault Night";
  static role = "maintenance-dispatcher";
  static kind = "simulation";
  static description = "A shift in the maintenance control centre: rank the faults, send the emergency teams, ask the signaller for a closure before anybody works in the track, and decide whether to wake the technician on call.";
  static scale = "minutes";
  static takes = [
    { flow: "staff-plan" },
    { flow: "asset-condition" },
    { flow: "fault-report" },
    { flow: "track-closure" },
  ];
  static gives = [
    { flow: "repair-status" },
    { flow: "closure-request" },
    { flow: "performance-report" },
  ];
  static actions = {
    ...Game.actions,
    send: { label: "Send a team" },
    callIn: { label: "Call the technician on call" },
  };
  static player = MaintenancePlayer;

  /** @param {{seed?: number, level?: keyof LEVELS, conditions?: object, wired?: Iterable<string>, length?: number}} [options] */
  constructor(options = {}) {
    super({ ...options, level: LEVELS[options.level] ? options.level : "normal" });
    const lv = LEVELS[this.level];
    /** The length of the shift (s). */
    this.length = options.length ?? 2400;
    // the staff plan of the asset manager, or the level's
    const plan = this.conditions["staff-plan"] ?? {};
    const n = Math.max(1, Math.min(LEADERS.length, Math.round(plan.teams ?? lv.teams)));
    /** @type {Array<{id: string, name: string, state: "ready" | "driving" | "waiting" | "working", place: string, base: boolean, fault: string | null, until: number | null, overtime: boolean}>} */
    this.teams = Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, name: `Team ${LEADERS[i]}`, state: "ready", place: DISTRICT.base, base: true, fault: null, until: null, overtime: false }));
    /** The technician on call: "none" | "available" | "called" (on the way to the base) | "in" (a team of their own). */
    this.onCall = (plan.on_call ?? lv.on_call) ? "available" : "none";
    this._onCallAt = null;
    /** @type {Array<object>} the faults: reported or still to come (`at` > t) */
    this.faults = [];
    // more faults the worse the assets (grade 1 very good … 6 unusable); the level's number without a grade
    const grade = this.conditions["asset-condition"]?.grade;
    const count = grade == null ? lv.faults : Math.max(0, Math.min(FAULTS.length, Math.round((grade - 1.5) * 1.6)));
    const r = this.rng("faults");
    const pool = FAULTS.map((f) => ({ f, k: r.next() })).sort((a, b) => a.k - b.k).slice(0, count).map((x) => x.f);
    // the signaller's fault: reported by its flow, or brought by the game itself
    if (!this.isWired("fault-report")) pool.push(N2);
    pool.forEach((f, i) => {
      const at = f === N2 ? Math.min(780, this.length * 0.3) : Math.round((0.04 + 0.6 * ((i + r.next()) / Math.max(1, pool.length))) * this.length);
      this.faults.push(this._fault(f, at, false));
    });
    this.faults.sort((a, b) => a.at - b.at);
    this.resource("overtime", "Overtime", 0, "h");
    this.log(`${clockAt(0)} The shift begins: ${n} emergency team${n === 1 ? "" : "s"} on shift${this.onCall === "available" ? ", a technician on call" : ""}.`);
  }

  _fault(f, at, remote) {
    return { ...f, at, reported: null, remote, state: "coming", team: null, closure: f.track ? "none" : "not needed", closed: false, started: null, done: null };
  }

  /** A fault by its id. */
  fault(id) {
    return this.faults.find((f) => f.id === id);
  }

  /** How long a team would need to a fault's place (s). */
  eta(team, fault) {
    return driveTime(team.place, fault.place, team.base);
  }

  /* ---------------------------------------------------------------- the player's moves */

  /**
   * Send a free team to an open fault.
   * @returns {{ok: boolean, reason?: string}}
   */
  send(teamId, faultId) {
    const tm = this.teams.find((x) => x.id === teamId), f = this.fault(faultId);
    if (!tm) return { ok: false, reason: "There is no such team." };
    if (!f || f.state === "coming") return { ok: false, reason: "There is no such fault." };
    if (tm.state !== "ready") return { ok: false, reason: `${tm.name} is ${tm.state === "driving" ? "on the road" : "at work"}.` };
    if (f.state !== "open") return { ok: false, reason: f.state === "done" ? `${f.asset} is repaired.` : `${f.asset} already has a team.` };
    const eta = this.eta(tm, f);
    Object.assign(tm, { state: "driving", fault: f.id, until: this.t + eta });
    Object.assign(f, { state: "assigned", team: tm.id });
    this.log(`${clockAt(this.t)} ${tm.name} drives to ${f.asset} (${f.place}), about ${Math.round(eta / 60)} min.`, "team");
    this.give("repair-status", { fault: f.id, asset: f.asset, place: f.place, state: "dispatched", eta_s: eta, team: tm.name });
    return { ok: true };
  }

  /**
   * Call the technician on call: ready at the base after a while, paid as overtime.
   * @returns {{ok: boolean, reason?: string}}
   */
  callIn() {
    if (this.onCall !== "available") return { ok: false, reason: this.onCall === "none" ? "Nobody is on call this shift." : "The technician on call is already called." };
    this.onCall = "called";
    this._onCallAt = this.t + ON_CALL.ready_s;
    this.add("overtime", ON_CALL.hours);
    this.log(`${clockAt(this.t)} The technician on call, ${TECHNICIAN}, is called: at the base in ${Math.round(ON_CALL.ready_s / 60)} min (${ON_CALL.hours} h of overtime).`, "team");
    return { ok: true };
  }

  /* ---------------------------------------------------------------- flows */

  take(msg) {
    const p = msg.payload ?? {};
    if (msg.flow === "fault-report") {
      if (this.fault(p.fault)) return;
      const f = this._fault({ id: p.fault, asset: p.asset ?? `Fault ${p.fault}`, kind: p.kind ?? "fault", place: DISTRICT.places[p.place] ? p.place : DISTRICT.base, path: "The signaller", safety: !!p.safety, holds: p.holds ?? 3, work_s: p.work_s ?? N2.work_s, track: p.track ?? null }, this.t, true);
      this.faults.push(f);
      this._report(f);
    } else if (msg.flow === "track-closure") {
      for (const f of this.faults) {
        if (!f.remote || f.track !== p.track || f.state === "done") continue;
        f.closed = !!p.closed;
        if (p.closed) {
          f.closure = "closed";
          const tm = this.teams.find((x) => x.fault === f.id && x.state === "waiting");
          if (tm) this._work(tm, f);
        } else if (f.started != null && f.done == null) {
          // the signaller opened the track with the team on it: their rule broken, the team's danger
          this.log(`${clockAt(this.t)} The signaller has opened ${f.track} while the team works on ${f.asset}.`, "violation");
        }
      }
    }
  }

  /* ---------------------------------------------------------------- the game's step */

  tick() {
    const now = this.t;
    for (const f of this.faults) if (f.state === "coming" && now >= f.at) this._report(f);
    if (this.onCall === "called" && now >= this._onCallAt) {
      this.onCall = "in";
      this.teams.push({ id: `T${this.teams.length + 1}`, name: TECHNICIAN, state: "ready", place: DISTRICT.base, base: true, fault: null, until: null, overtime: true });
      this.log(`${clockAt(now)} ${TECHNICIAN} is at the base and ready.`, "team");
    }
    for (const tm of this.teams) {
      const f = tm.fault ? this.fault(tm.fault) : null;
      if (tm.state === "driving" && now >= tm.until) this._arrive(tm, f);
      else if (tm.state === "waiting" && f.closure === "asked" && !f.remote && now >= f.closeAt) {
        // the game's own signaller has closed the track
        f.closure = "closed";
        f.closed = true;
        this.log(`${clockAt(now)} ${f.path} has closed ${f.track}.`, "closure");
        this._work(tm, f);
      } else if (tm.state === "working" && now >= tm.until) this._done(tm, f);
    }
    if (now >= this.length) this.end(`${clockAt(this.length)}: the shift is over.`);
  }

  _report(f) {
    f.state = "open";
    f.reported = this.t;
    this.log(`${clockAt(this.t)} ${f.path} reports: ${f.asset} at ${f.place}, ${f.kind}${f.safety ? " (a danger while it is open)" : f.holds ? ` (holds about ${f.holds} trains an hour)` : ""}.`, "fault");
    this.emit("fault", { fault: f });
  }

  _arrive(tm, f) {
    Object.assign(tm, { place: f.place, base: false, until: null });
    this.give("repair-status", { fault: f.id, asset: f.asset, place: f.place, state: "arrived", team: tm.name });
    if (!f.track || f.closure === "closed") {
      this.log(`${clockAt(this.t)} ${tm.name} is at ${f.asset}.`, "team");
      this._work(tm, f);
      return;
    }
    tm.state = "waiting";
    f.state = "on site";
    this.log(`${clockAt(this.t)} ${tm.name} is at ${f.asset}: the work is in ${f.track}.`, "team");
    this.ask({
      id: `closure-${f.id}`, title: `${tm.name} is at ${f.asset}. The work is in ${f.track}.`,
      text: "Nobody goes into a track that trains can still run on: the signaller closes it first.",
      options: [{ id: "ask", label: `Ask the signaller to close ${f.track}` }, { id: "start", label: "Let the team start at once: it is a short job" }],
      within: ASK_S, fallback: "ask",
      then: (o) => {
        if (o === "ask") this._askClosure(tm, f);
        else {
          this.violate("track-without-closure", `${clockAt(this.t)} ${tm.name} was sent into ${f.track} without a closure.`, 3);
          this._work(tm, f);
        }
      },
    });
  }

  _askClosure(tm, f) {
    if (f.closure === "closed") return;
    f.closure = "asked";
    this.give("closure-request", { fault: f.id, asset: f.asset, place: f.place, track: f.track, team: tm.name });
    if (f.remote) this.log(`${clockAt(this.t)} The signaller is asked to close ${f.track}.`, "closure");
    else {
      f.closeAt = this.t + Math.round(this.rng("closure", f.id).uniform(...CLOSURE_S));
      this.log(`${clockAt(this.t)} ${f.path} is asked to close ${f.track}.`, "closure");
    }
  }

  _work(tm, f) {
    Object.assign(tm, { state: "working", until: this.t + f.work_s });
    Object.assign(f, { state: "working", started: this.t });
    const d = this.decisions.find((x) => x.id === `closure-${f.id}` && !x.made);
    if (d) this.decide(d.id, "ask");
    this.log(`${clockAt(this.t)} ${tm.name} starts on ${f.asset}, about ${Math.round(f.work_s / 60)} min.`, "team");
    this.give("repair-status", { fault: f.id, asset: f.asset, place: f.place, state: "working", eta_s: f.work_s, team: tm.name });
  }

  _done(tm, f) {
    Object.assign(tm, { state: "ready", fault: null, until: null });
    Object.assign(f, { state: "done", done: this.t });
    this.log(`${clockAt(this.t)} ${tm.name} reports: ${f.asset} repaired${f.track ? `, everybody has left ${f.track}` : ""}.`, "team");
    this.give("repair-status", { fault: f.id, asset: f.asset, place: f.place, state: "done", team: tm.name });
  }

  /** The shift's account: the faults, how fast they were restored, the overtime. */
  finish() {
    const st = this.stats();
    this.give("performance-report", { scope: DISTRICT.name, kind: "maintenance", faults: st.reported, done: st.done, open: st.open, restore_min: st.restore_min, overtime_h: this.value("overtime"), teams: this.teams.filter((tm) => !tm.overtime).length, violations: this.violations.length, score: this.score().total });
  }

  /* ---------------------------------------------------------------- the score */

  /** The faults reported so far: how many are done, and the mean time to restore those that hold trains (min, weighted by the trains). */
  stats() {
    const rep = this.faults.filter((f) => f.reported != null);
    const end = Math.min(this.t, this.length);
    const hold = rep.filter((f) => f.holds > 0 || f.safety);
    const w = hold.reduce((a, f) => a + (f.holds || 1), 0);
    const restore = w ? hold.reduce((a, f) => a + (f.holds || 1) * ((f.done ?? end) - f.reported), 0) / w / 60 : null;
    return { reported: rep.length, done: rep.filter((f) => f.done != null).length, open: rep.filter((f) => f.done == null).length, restore_min: restore == null ? null : Math.round(restore * 10) / 10, danger: rep.filter((f) => f.safety && f.done == null && f.state === "open").length };
  }

  objectives() {
    const st = this.stats(), rep = this.faults.filter((f) => f.reported != null);
    const restore = st.restore_min == null ? 1 : 1 - (st.restore_min - RESTORE_MIN.good) / (RESTORE_MIN.bad - RESTORE_MIN.good);
    const sev = this.violations.reduce((s, v) => s + (v.severity >= 3 ? 1 : v.severity === 2 ? 0.5 : 0.15), 0);
    // a fault that came in late cannot be done by the end: it counts by how far it got
    const part = (f) => (f.done != null ? 1 : f.state === "working" ? 0.7 : f.state === "open" ? 0 : 0.4);
    const w = rep.reduce((a, f) => a + (f.holds || f.safety ? 1 : 0.5), 0);
    const closed = w ? rep.reduce((a, f) => a + (f.holds || f.safety ? 1 : 0.5) * part(f), 0) / w : 1;
    const hours = this.value("overtime"), needed = rep.filter((f) => f.holds > 0 || f.safety).length > this.teams.filter((tm) => !tm.overtime).length;
    return [
      { id: "restore", label: "Trains running again", weight: 40, value: restore, note: st.restore_min == null ? "no fault held trains" : `${st.restore_min} min from the report to the repair, on average` },
      { id: "safety", label: "Safety", weight: 30, value: this.violations.some((v) => v.severity >= 3) ? 0 : 1 - sev - 0.25 * st.danger, note: `${this.violations.length} rules broken${st.danger ? `, ${st.danger} danger${st.danger === 1 ? "" : "s"} left without a team` : ""}` },
      { id: "faults", label: "Faults dealt with", weight: 15, value: closed, note: `${st.done} of ${st.reported} repaired` },
      { id: "cost", label: "Overtime", weight: 15, value: hours === 0 ? 1 : needed ? 0.8 : 0.4, note: hours ? `${hours} h${needed ? "" : ", with teams enough on shift"}` : "none" },
    ];
  }

  /* ---------------------------------------------------------------- for a page */

  view() {
    const st = this.stats();
    const open = this.faults.filter((f) => f.state === "open"), ready = this.teams.filter((tm) => tm.state === "ready");
    const state = (f) => (f.state === "open" ? "waits for a team" : f.state === "assigned" ? "team on its way" : f.state === "on site" ? (f.closure === "asked" ? "team waits for the closure" : "team on site") : f.state === "working" ? "being repaired" : "repaired");
    const where = (tm) => (tm.state === "ready" ? `ready${tm.base ? " at the base" : ` at ${tm.place}`}` : tm.state === "driving" ? `drives to ${this.fault(tm.fault).asset}, there at ${clockAt(tm.until)}` : tm.state === "waiting" ? `waits at ${this.fault(tm.fault).asset} for the closure` : `works on ${this.fault(tm.fault).asset} until ${clockAt(tm.until)}`);
    return {
      figures: [
        { label: "Faults open", value: st.open, tone: st.open ? "warn" : "ok" },
        { label: "Teams free", value: `${ready.length} of ${this.teams.length}` },
        { label: "Restored after", value: st.restore_min ?? "–", unit: st.restore_min == null ? "" : "min" },
        { label: "Overtime", value: this.value("overtime"), unit: "h" },
      ],
      tables: [
        {
          id: "faults", title: "Faults", columns: ["Asset", "Place", "Fault", "Since", "Matters", "State"], empty: "No fault reported.",
          rows: this.faults.filter((f) => f.reported != null).map((f) => [f.asset, f.place, f.kind, clockAt(f.reported), f.safety ? "a danger" : f.holds ? `${f.holds} trains an hour` : "comfort", state(f)]),
        },
        { id: "teams", title: "Teams", columns: ["Team", "Doing"], rows: this.teams.map((tm) => [tm.name, where(tm)]) },
      ],
      actions: [
        {
          name: "send", label: "Send a team", primary: true, disabled: !open.length ? "No fault waits for a team." : !ready.length ? "No team is free." : undefined,
          fields: [
            { id: "team", label: "Team", options: ready.map((tm) => ({ id: tm.id, label: tm.name })) },
            { id: "fault", label: "To", options: open.map((f) => ({ id: f.id, label: `${f.asset}, ${f.place}` })) },
          ],
        },
        ...(this.onCall === "available" ? [{ name: "callIn", label: `Call the technician on call (${ON_CALL.hours} h of overtime)` }] : []),
      ],
    };
  }
}
