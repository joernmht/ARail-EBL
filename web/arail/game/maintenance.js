/**
 * The maintenance dispatcher's game (Instandhaltungs- und Störungsdisponent/in), "Fault Night": a
 * shift in the maintenance control centre of the district around Bf Neustadt.
 *
 * Faults come in by their report paths: from the signaller, from a train driver, from a station's
 * diagnostics. A report says what is seen, not why: the cause, the trade that can repair it and the
 * time it takes are known only when a team has looked. The dispatcher has one or two emergency
 * teams, each of one trade (signalling or track), and a technician of each trade on call. The
 * dispatcher ranks the faults by safety and by the trains they hold, sends a team, asks the
 * signaller for a track closure before a team works in the track, and decides what the team does
 * with what it finds: repair it for good, repair it provisionally (faster, but it may fail again),
 * secure a danger until the right trade comes, or leave it. A team sent into the track without a
 * closure is a danger to people: the shift fails, whatever the score.
 *
 * Every choice gives something up: the nearest team may be of the wrong trade, a thorough repair
 * lets the next fault wait, a quick one may come back when the team is elsewhere, a team that
 * secures a crossing repairs nothing, and a technician on call costs overtime.
 *
 * In a session (session.js) the game is wired to other roles: the signaller's fault report arrives
 * as a flow, the team's steps go back as the repair status, the closure is asked of the signaller
 * and comes back as a track closure; the asset manager's staff plan sets the teams, the condition
 * of the assets how many faults the shift brings. Alone, the game plays those roles itself.
 * @module arail/game/maintenance
 */
import { Game, Player, clockAt as timeAt, secondsOf } from "./core.js";

/**
 * The district: line 6250 from Bergheim via Bf Neustadt to Talsee and the branch to Waldau, with the
 * kilometres by road from the maintenance base at Bf Neustadt (the roads follow the line), and where
 * each place lies on the district's map (`map`: x and y of the sketch; `list`: the side its faults are listed
 * on; `name`: where its name stands, above it or to its right; `teams`: where its teams stand, from the place).
 */
export const DISTRICT = {
  name: "District Neustadt",
  base: "Bf Neustadt",
  places: {
    "Bf Neustadt": { km: 0, map: [470, 120], list: "end", name: "above", teams: [0, -46] },
    Bergheim: { km: 10, map: [100, 120], list: "start", name: "above", teams: [0, -46] },
    Talsee: { km: 8, map: [800, 120], list: "end", name: "above", teams: [0, -46] },
    Waldau: { km: 9, map: [680, 270], list: "start", name: "right", teams: [62, -32] },
  },
};
/** The size of the district's map (sketch px). */
const MAP = { width: 900, height: 340 };
/** A van's time on the road (s): to another place, within a place, from the base to an asset at its own station. */
export const DRIVE = { base_s: 180, per_km_s: 40, local_s: 120, from_base_s: 300 };
/** The technicians on call, one of each trade: time until ready at the base (s), and the hours paid for a call-out. */
export const ON_CALL = { ready_s: 600, hours: 4 };
/** The trades of the teams (Gewerke): signalling (Leit- und Sicherungstechnik) and track (Fahrbahn). A cause of the trade "any" every team can repair. */
export const TRADES = ["signalling", "track"];
/**
 * The computer's dispatcher calls a technician only with so much of the shift left after their arrival (s), not for
 * a team that is free within so long (s), and for a single fault only when it has waited so long (s).
 */
const CALL_LEFT_S = 600, CALL_SOON_S = 240, CALL_WAIT_S = 180;
/** How long a team waits for the dispatcher to ask for the closure before it asks itself (s). */
const ASK_S = 90;
/** The game's own signallers close a track after this long (s, from … to). */
const CLOSURE_S = [60, 150];
/** A team on site needs this long to find the cause (s). */
export const DIAGNOSE_S = 60;
/** A team that has found the cause waits this long for the dispatcher's word on what to do (s). */
const PLAN_S = 90;
/** A provisional repair that does not hold fails again after this long (s, from … to). */
const RELAPSE_S = [240, 600];
/** Restoring a fault that holds trains: full marks within, none beyond (min out of order). */
export const RESTORE_MIN = { good: 15, bad: 42 };
/** A danger nobody guards: free up to, and at its worst from, so many minutes (the way there cannot be helped). */
export const EXPOSED_MIN = { free: 12, worst: 40 };

/** What a failed signal lamp can turn out to be. */
const LAMP_CAUSES = [
  { p: 0.45, text: "the lamp is burnt out", trade: "signalling", work_s: 240 },
  { p: 0.35, text: "water in the housing has corroded the lamp holder", trade: "signalling", work_s: 720, quick: { text: "Put in a new lamp only", work_s: 240, relapse: 0.55 } },
  { p: 0.2, text: "a wire of the signal's cable is broken", trade: "signalling", work_s: 840 },
];

/**
 * The faults a shift can bring, beside those the signaller reports. `holds`: how many trains an
 * hour it holds or slows; `track`: the work is in this track and needs it closed (by the signaller
 * who reported it, or by `closer` where somebody else reported it); `safety`: a
 * danger while nobody is there (`secure`: what a team of any trade does about it until the repair).
 * `causes`: what it can turn out to be, once a team has looked: `p` how often (from experience),
 * `trade` who can repair it ("any": every team), `work_s` the repair for good, and `quick` where
 * there is a provisional way: its work and how likely it fails again within the shift (`relapse`).
 */
export const FAULTS = [
  {
    id: "bue", asset: "Level crossing Brückenstraße", kind: "the barriers do not close", place: "Talsee", path: "The crossing's remote monitoring", safety: true, secure: "guard the crossing by hand", holds: 2, track: null,
    causes: [
      { p: 0.45, text: "a barrier's drive is stuck", trade: "signalling", work_s: 540, quick: { text: "Free the drive and grease it", work_s: 210, relapse: 0.5 } },
      { p: 0.35, text: "the switch-on contact in the track does not answer", trade: "signalling", work_s: 420 },
      { p: 0.2, text: "a branch lies in a barrier", trade: "any", work_s: 180 },
    ],
  },
  {
    id: "w12", asset: "Point W12", kind: "does not reach its end position", place: "Bergheim", path: "The signaller of Bergheim", safety: false, holds: 4, track: "Bergheim track 2",
    causes: [
      { p: 0.35, text: "a stone lies between the blade and the stock rail", trade: "any", work_s: 240 },
      { p: 0.4, text: "the point's lock is out of adjustment", trade: "track", work_s: 600, quick: { text: "Adjust it roughly", work_s: 240, relapse: 0.45 } },
      { p: 0.25, text: "the motor of the point machine is burnt", trade: "signalling", work_s: 900 },
    ],
  },
  {
    id: "azs", asset: "Axle counter section 21", kind: "shows occupied without a train", place: "Talsee", path: "The signaller of Talsee", safety: false, holds: 3, track: "Talsee track 1",
    causes: [
      { p: 0.4, text: "a miscount: the section is clear and can be reset", trade: "any", work_s: 240 },
      { p: 0.35, text: "a counting head is loose", trade: "signalling", work_s: 480, quick: { text: "Fasten it for now", work_s: 210, relapse: 0.45 } },
      { p: 0.25, text: "the evaluator's card is defective", trade: "signalling", work_s: 720 },
    ],
  },
  { id: "vsig", asset: "Distant signal Vf", kind: "dark", place: "Bergheim", path: "A train driver (by radio)", safety: false, holds: 3, track: null, causes: LAMP_CAUSES },
  {
    id: "rail", asset: "Track at km 12.4", kind: "a train driver felt a hard knock", place: "Talsee", path: "A train driver (by radio)", closer: "The signaller of Talsee", safety: false, holds: 4, track: "the line to Talsee",
    causes: [
      { p: 0.3, text: "nothing wrong with the track: it was the train's wheel", trade: "any", work_s: 120 },
      { p: 0.35, text: "the bolts of a fishplate are loose", trade: "track", work_s: 360 },
      { p: 0.35, text: "the rail is broken", trade: "track", work_s: 1080, quick: { text: "Emergency fishplates, 20 km/h over them", work_s: 480, relapse: 0.3 } },
    ],
  },
  {
    id: "fence", asset: "Fence at the halt", kind: "children at the track, a train driver reports", place: "Waldau", path: "A train driver (by radio)", safety: true, secure: "stand guard at the gap", holds: 2, track: null,
    causes: [
      { p: 0.6, text: "one panel of the fence is down", trade: "any", work_s: 360 },
      { p: 0.4, text: "the fence is cut open over twenty metres", trade: "track", work_s: 720, quick: { text: "Close the gap with barrier tape and wire", work_s: 240, relapse: 0.45 } },
    ],
  },
  {
    id: "lift", asset: "Lift at platform 2", kind: "out of order", place: "Bf Neustadt", path: "The station's service staff", safety: false, holds: 0, track: null,
    causes: [
      { p: 0.4, text: "a fuse has blown", trade: "any", work_s: 300 },
      { p: 0.6, text: "the controller is defective: a case for the maker's service, the team puts up notices", trade: "any", work_s: 120 },
    ],
  },
  {
    id: "dfi", asset: "Platform display", kind: "dark", place: "Waldau", path: "The station's diagnostics", safety: false, holds: 0, track: null,
    causes: [
      { p: 0.6, text: "it hangs and starts again", trade: "any", work_s: 180 },
      { p: 0.4, text: "its power supply is defective: a case for the telecoms service, the team puts up notices", trade: "any", work_s: 120 },
    ],
  },
];
/** The fault at Bf Neustadt that the game brings itself when no signaller reports it (the signaller's game: exit signal N2). */
const N2 = { id: "N2", asset: "Exit signal N2", kind: "lamp failure", place: "Bf Neustadt", path: "The signaller of Bf Neustadt", safety: false, holds: 4, track: "G2", causes: LAMP_CAUSES };

/** Levels: the teams on shift (the first a signalling team, the second a track team), whether technicians are on call, how many faults beside the signaller's. */
export const LEVELS = {
  training: { label: "Training: two teams, two faults", teams: 2, on_call: true, faults: 1 },
  normal: { label: "Normal: two teams, four faults", teams: 2, on_call: true, faults: 3 },
  hard: { label: "Hard: one team and the technicians on call, five faults", teams: 1, on_call: true, faults: 4 },
};

/** The people who lead the teams with their trades, and the technicians on call (bird names, see CONTRIBUTING.md). */
const LEADERS = [["M. Specht", "signalling"], ["L. Kranich", "track"], ["A. Reiher", "signalling"]];
const TECHNICIANS = { signalling: "S. Kartal", track: "J. Sokół" };

/** Seconds on the road between two places (a van at the base starts from Bf Neustadt). */
export function driveTime(from, to, atBase = false) {
  if (from === to) return atBase ? DRIVE.from_base_s : DRIVE.local_s;
  const a = DISTRICT.places[from]?.km ?? 0, b = DISTRICT.places[to]?.km ?? 0;
  // the places lie on different roads out of Bf Neustadt
  return DRIVE.base_s + DRIVE.per_km_s * (a + b);
}

/** From experience: how often a fault is a case for each trade ("any": every team), the most frequent first. */
export function likely(fault) {
  const by = new Map();
  for (const c of fault.causes) by.set(c.trade, (by.get(c.trade) ?? 0) + c.p);
  return [...by].map(([trade, p]) => ({ trade, p: Math.round(p * 100) / 100 })).sort((a, b) => b.p - a.p);
}

const minutes = (s) => Math.max(1, Math.round(s / 60));
const tradeText = (trade) => (trade === "any" ? "any team" : trade);

/**
 * The computer's maintenance dispatcher, by simple rules: the fault that matters most first (a
 * danger nobody guards, then the trains held, then the oldest); to it the nearest free team that can
 * repair it, as far as known, else that of the trade it most often needs; any free team to a danger,
 * to guard it. A repair for good, unless another fault that holds trains waits: then the quick one.
 * A technician on call when a fault that matters waits for a trade that has no team on shift, or
 * whose teams are all busy for a while yet (and the fault has waited some minutes, or a second one
 * waits too), as long as the shift is long enough for the way and the work.
 */
export class MaintenancePlayer extends Player {
  /** @param {MaintenanceGame} g */
  think(g) {
    const matters = (f) => f.holds > 0 || f.safety;
    const waiting = g.faults.filter((f) => f.state === "open" || f.state === "secured").sort((a, b) => Number(g.exposed(b)) - Number(g.exposed(a)) || b.holds - a.holds || a.since - b.since);
    for (const d of g.open) {
      if (d.id.startsWith("closure-")) g.act("decide", d.id, "ask");
      else if (d.id.startsWith("plan-")) {
        const has = (o) => d.options.some((x) => x.id === o);
        const others = waiting.some((f) => matters(f) && `plan-${f.id}` !== d.id);
        g.act("decide", d.id, has("full") ? (has("quick") && others ? "quick" : "full") : has("secure") ? "secure" : "leave");
      }
    }
    const needs = (f) => (f.known ? f.cause.trade : likely(f)[0].trade);
    const left = [];
    for (const f of waiting) {
      const need = needs(f);
      const free = g.teams.filter((tm) => tm.state === "ready").sort((a, b) => g.eta(a, f) - g.eta(b, f));
      const tm = free.find((x) => need === "any" || x.trade === need) ?? (g.exposed(f) ? free[0] : null);
      if (!tm || !g.act("send", tm.id, f.id).ok) left.push(f);
    }
    if (g.length - g.t < ON_CALL.ready_s + CALL_LEFT_S) return;
    for (const trade of TRADES) {
      const queue = left.filter((f) => matters(f) && needs(f) === trade);
      if (!queue.length || g.onCall[trade] !== "available") continue;
      const teams = g.teams.filter((x) => x.trade === trade);
      const soon = teams.some((x) => x.state === "ready" || (x.state === "working" && x.until - g.t < CALL_SOON_S));
      if (!teams.length || (!soon && (queue.length > 1 || g.t - queue[0].since >= CALL_WAIT_S))) g.act("callIn", trade);
    }
  }
}

export class MaintenanceGame extends Game {
  static id = "maintenance";
  static title = "Fault Night";
  static role = "maintenance-dispatcher";
  static kind = "simulation";
  static description = "A shift in the maintenance control centre: rank the faults, send the emergency teams of the right trade, ask the signaller for a closure before anybody works in the track, decide between a quick repair and one for good, and whether to wake a technician on call.";
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
    callIn: { label: "Call a technician on call" },
    recall: { label: "Call off a team that secures" },
  };
  static player = MaintenancePlayer;

  /** @param {{seed?: number, level?: keyof LEVELS, conditions?: object, wired?: Iterable<string>, length?: number, clock?: string}} [options] `clock`: when the shift begins ("HH:MM") */
  constructor(options = {}) {
    super({ ...options, level: LEVELS[options.level] ? options.level : "normal" });
    const lv = LEVELS[this.level];
    /** The start of the shift (s after midnight) and its length (s). */
    this.start = secondsOf(options.clock ?? "08:00");
    this.length = options.length ?? 2400;
    // the staff plan of the asset manager, or the level's
    const plan = this.conditions["staff-plan"] ?? {};
    const n = Math.max(1, Math.min(LEADERS.length, Math.round(plan.teams ?? lv.teams)));
    /** @type {Array<{id: string, name: string, trade: string, state: "ready" | "driving" | "waiting" | "diagnosing" | "deciding" | "working" | "securing", place: string, base: boolean, fault: string | null, from: string | null, left: number | null, until: number | null, overtime: boolean}>} */
    this.teams = [];
    for (let i = 0; i < n; i++) this.teams.push(this._team(`Team ${LEADERS[i][0]}`, LEADERS[i][1], false));
    /** The technicians on call by trade: "none" | "available" | "called" (on the way to the base) | "in" (a team of their own). */
    this.onCall = Object.fromEntries(TRADES.map((trade) => [trade, (plan.on_call ?? lv.on_call) ? "available" : "none"]));
    this._onCallAt = {};
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
    const on = TRADES.filter((trade) => this.onCall[trade] === "available");
    this.log(`${this.at(0)} The shift begins: ${this.teams.map((tm) => `${tm.name} (${tm.trade})`).join(" and ")} on shift${on.length ? `, a technician on call for ${on.join(" and for ")}` : ""}.`);
  }

  /** The time of day of a game time (now, if none is given), by the shift's clock. */
  at(t = this.t) {
    return timeAt(t, this.start);
  }

  _team(name, trade, overtime) {
    return { id: `T${this.teams.length + 1}`, name, trade, state: "ready", place: DISTRICT.base, base: true, fault: null, from: null, left: null, until: null, overtime };
  }

  /** A fault of the shift from its description: with the cause drawn that a team will find. */
  _fault(f, at, remote) {
    const r = this.rng("cause", f.id);
    let k = r.next() * f.causes.reduce((a, c) => a + c.p, 0), cause = f.causes.at(-1);
    for (const c of f.causes) {
      k -= c.p;
      if (k < 0) {
        cause = c;
        break;
      }
    }
    return {
      ...f, at, reported: null, since: null, out_s: 0, exposed_s: 0, remote, state: "coming", team: null, by: null, closure: f.track ? "none" : "not needed", closed: false, started: null, done: null,
      cause, known: false, secured: null, quick: false, provisional: false, relapses: 0, relapseAt: null,
    };
  }

  /** A fault by its id. */
  fault(id) {
    return this.faults.find((f) => f.id === id);
  }

  /** How long a team would need to a fault's place (s). */
  eta(team, fault) {
    return driveTime(team.place, fault.place, team.base);
  }

  /** Whether a team can repair a fault: yes for its trade and for what any team can do; not known (null) before a team has looked. */
  can(team, fault) {
    return fault.known ? fault.cause.trade === "any" || fault.cause.trade === team.trade : null;
  }

  /** Whether a fault is a danger that nobody guards now: reported, not repaired, no team there. */
  exposed(fault) {
    return !!fault.safety && !fault.secured && (fault.state === "open" || fault.state === "assigned");
  }

  /** How long a fault has been out of order so far (s): every time it failed until it was repaired, and since it failed last. */
  outage(fault, now = Math.min(this.t, this.length)) {
    return fault.reported == null ? 0 : fault.out_s + (fault.done == null ? Math.max(0, now - fault.since) : 0);
  }

  /* ---------------------------------------------------------------- the player's moves */

  /**
   * Send a free team to a fault that waits. A team that is known not to be of the fault's trade is
   * sent only to a danger nobody guards.
   * @returns {{ok: boolean, reason?: string}}
   */
  send(teamId, faultId) {
    const tm = this.teams.find((x) => x.id === teamId), f = this.fault(faultId);
    if (!tm) return { ok: false, reason: "There is no such team." };
    if (!f || f.state === "coming") return { ok: false, reason: "There is no such fault." };
    if (tm.state !== "ready") return { ok: false, reason: `${tm.name} is ${tm.state === "driving" ? "on the road" : tm.state === "securing" ? "securing a place" : "at work"}.` };
    if (f.state !== "open" && f.state !== "secured") return { ok: false, reason: f.state === "done" ? `${f.asset} is repaired.` : `${f.asset} already has a team.` };
    if (this.can(tm, f) === false && !this.exposed(f)) return { ok: false, reason: `${tm.name} is a ${tm.trade} team: ${f.asset} needs a ${f.cause.trade} team.` };
    const eta = this.eta(tm, f);
    Object.assign(tm, { state: "driving", fault: f.id, from: tm.place, left: this.t, until: this.t + eta });
    Object.assign(f, { state: "assigned", team: tm.id });
    this.log(`${this.at()} ${tm.name} drives to ${f.asset} (${f.place}), about ${minutes(eta)} min.`, "team");
    this.give("repair-status", { fault: f.id, asset: f.asset, place: f.place, state: "dispatched", eta_s: eta, team: tm.name, since_s: Math.round(this.t - f.since) });
    return { ok: true };
  }

  /**
   * Call the technician on call of a trade: ready at the base after a while, paid as overtime.
   * @param {string} [trade] signalling or track
   * @returns {{ok: boolean, reason?: string}}
   */
  callIn(trade = "signalling") {
    if (!TRADES.includes(trade)) return { ok: false, reason: "There is no such trade." };
    if (this.onCall[trade] !== "available") return { ok: false, reason: this.onCall[trade] === "none" ? "Nobody is on call this shift." : `The ${trade} technician on call is already called.` };
    this.onCall[trade] = "called";
    this._onCallAt[trade] = this.t + ON_CALL.ready_s;
    this.add("overtime", ON_CALL.hours);
    this.log(`${this.at()} The ${trade} technician on call, ${TECHNICIANS[trade]}, is called: at the base in ${minutes(ON_CALL.ready_s)} min (${ON_CALL.hours} h of overtime).`, "team");
    return { ok: true };
  }

  /**
   * Call off a team that secures a place: it is free again, and the place is a danger again.
   * @returns {{ok: boolean, reason?: string}}
   */
  recall(teamId) {
    const tm = this.teams.find((x) => x.id === teamId);
    if (!tm) return { ok: false, reason: "There is no such team." };
    if (tm.state !== "securing") return { ok: false, reason: `${tm.name} does not secure a place.` };
    const f = this.fault(tm.fault);
    this._free(tm);
    f.secured = null;
    if (f.state === "secured") f.state = "open";
    this.log(`${this.at()} ${tm.name} is called off from ${f.asset}: nobody guards it now.`, "team");
    return { ok: true };
  }

  /* ---------------------------------------------------------------- flows */

  take(msg) {
    const p = msg.payload ?? {};
    if (msg.flow === "fault-report") {
      if (this.fault(p.fault)) return;
      const f = this._fault({ id: p.fault, asset: p.asset ?? `Fault ${p.fault}`, kind: p.kind ?? "fault", place: DISTRICT.places[p.place] ? p.place : DISTRICT.base, path: "The signaller", safety: !!p.safety, holds: p.holds ?? 3, track: p.track ?? null, causes: LAMP_CAUSES }, this.t, true);
      this.faults.push(f);
      this._report(f);
    } else if (msg.flow === "track-closure") {
      for (const f of this.faults) {
        if (!f.remote || f.track !== p.track) continue;
        f.closed = !!p.closed;
        f.closure = p.closed ? "closed" : "none";
        if (f.state === "done") continue;
        const tm = this.teams.find((x) => x.fault === f.id && x.state !== "driving" && x.state !== "securing");
        if (p.closed && tm?.state === "waiting") this._look(tm, f);
        // the signaller opened the track with the team on it: their rule broken, the team's danger
        else if (!p.closed && tm && tm.state !== "waiting") this.log(`${this.at()} The signaller has opened ${f.track} while ${tm.name} is at ${f.asset}.`, "violation");
      }
    }
  }

  /* ---------------------------------------------------------------- the game's step */

  tick(dt = 0) {
    const now = this.t;
    for (const f of this.faults) {
      if (f.state === "coming" && now >= f.at) this._report(f);
      else if (f.state === "done" && f.relapseAt != null && now >= f.relapseAt) this._relapse(f);
      if (this.exposed(f)) f.exposed_s += dt;
    }
    for (const trade of TRADES) {
      if (this.onCall[trade] !== "called" || now < this._onCallAt[trade]) continue;
      this.onCall[trade] = "in";
      this.teams.push(this._team(TECHNICIANS[trade], trade, true));
      this.log(`${this.at(now)} ${TECHNICIANS[trade]} (${trade}) is at the base and ready.`, "team");
    }
    for (const tm of this.teams) {
      const f = tm.fault ? this.fault(tm.fault) : null;
      if (tm.state === "driving" && now >= tm.until) this._arrive(tm, f);
      else if (tm.state === "waiting" && f.closure === "asked" && !f.remote && now >= f.closeAt) {
        // the game's own signaller has closed the track
        f.closure = "closed";
        f.closed = true;
        this.log(`${this.at(now)} ${f.closer ?? f.path} has closed ${f.track}.`, "closure");
        this._look(tm, f);
      } else if (tm.state === "diagnosing" && now >= tm.until) this._diagnosed(tm, f);
      else if (tm.state === "working" && now >= tm.until) this._done(tm, f);
    }
    if (now >= this.length) this.end(`${this.at(this.length)}: the shift is over.`);
  }

  _report(f) {
    f.state = "open";
    f.reported = f.since = this.t;
    const from = likely(f).map((x) => `${tradeText(x.trade)} ${Math.round(x.p * 100)} %`).join(", ");
    this.log(`${this.at()} ${f.path} reports: ${f.asset} at ${f.place}, ${f.kind}${f.safety ? " (a danger while nobody is there)" : f.holds ? ` (holds about ${f.holds} trains an hour)` : ""}. From experience a case for: ${from}.`, "fault");
    this.emit("fault", { fault: f });
    // a fault of the district's own report paths has no fault report as a flow: its story begins with this status,
    // so that a fault no team is ever sent to is told too (the signaller's begins with the signaller's report)
    if (!f.remote) this.give("repair-status", { fault: f.id, asset: f.asset, place: f.place, state: "reported", safety: f.safety, holds: f.holds });
  }

  /** A team is free again, where it is. */
  _free(tm) {
    Object.assign(tm, { state: "ready", fault: null, from: null, left: null, until: null });
  }

  _arrive(tm, f) {
    Object.assign(tm, { place: f.place, base: false, until: null });
    f.state = "on site";
    this.give("repair-status", { fault: f.id, asset: f.asset, place: f.place, state: "arrived", team: tm.name });
    if (!f.track || f.closure === "closed") {
      this.log(`${this.at()} ${tm.name} is at ${f.asset}.`, "team");
      this._look(tm, f);
      return;
    }
    tm.state = "waiting";
    this.log(`${this.at()} ${tm.name} is at ${f.asset}: the work is in ${f.track}.`, "team");
    this.ask({
      id: `closure-${f.id}`, title: `${tm.name} is at ${f.asset}. The work is in ${f.track}.`,
      text: "Nobody goes into a track that trains can still run on: the signaller closes it first.",
      options: [{ id: "ask", label: `Ask the signaller to close ${f.track}` }, { id: "start", label: "Let the team start at once: it is a short job" }],
      within: ASK_S, fallback: "ask",
      then: (o) => {
        if (o === "ask") this._askClosure(tm, f);
        else {
          this.violate("track-without-closure", `${this.at()} ${tm.name} was sent into ${f.track} without a closure.`, 3);
          this._look(tm, f);
        }
      },
    });
  }

  _askClosure(tm, f) {
    if (f.closure === "closed") return;
    f.closure = "asked";
    this.give("closure-request", { fault: f.id, asset: f.asset, place: f.place, track: f.track, team: tm.name });
    if (f.remote) this.log(`${this.at()} The signaller is asked to close ${f.track}.`, "closure");
    else {
      f.closeAt = this.t + Math.round(this.rng("closure", f.id, f.relapses).uniform(...CLOSURE_S));
      this.log(`${this.at()} ${f.closer ?? f.path} is asked to close ${f.track}.`, "closure");
    }
  }

  /** A team at the asset (in the track: with the closure): it looks for the cause, unless that is known. */
  _look(tm, f) {
    const d = this.decisions.find((x) => x.id === `closure-${f.id}` && !x.made);
    if (d) this.decide(d.id, "ask");
    if (f.known) return this._plan(tm, f);
    Object.assign(tm, { state: "diagnosing", until: this.t + DIAGNOSE_S });
    this.log(`${this.at()} ${tm.name} looks for the cause at ${f.asset}.`, "team");
  }

  /** The cause is found: told to everybody, and the dispatcher is asked what to do. */
  _diagnosed(tm, f) {
    f.known = true;
    const c = f.cause;
    this.log(`${this.at()} ${tm.name} at ${f.asset}: ${c.text}. ${c.trade === "any" ? "Any team can do that" : `A case for a ${c.trade} team`}, about ${minutes(c.work_s)} min.`, "team");
    this.give("repair-status", { fault: f.id, asset: f.asset, place: f.place, state: "diagnosed", cause: c.text, trade: c.trade, eta_s: c.work_s, team: tm.name, since_s: DIAGNOSE_S });
    this._plan(tm, f);
  }

  /** What the team can do with what it found; with more than one way, the dispatcher decides. */
  _plan(tm, f) {
    const c = f.cause, options = [];
    if (this.can(tm, f)) {
      options.push({ id: "full", label: `Repair it for good: about ${minutes(c.work_s)} min` });
      if (c.quick) options.push({ id: "quick", label: `${c.quick.text}: about ${minutes(c.quick.work_s)} min, but it may fail again` });
    } else {
      if (f.safety && !f.secured) options.push({ id: "secure", label: `Stay and ${f.secure} until a ${c.trade} team comes` });
      options.push({ id: "leave", label: `Leave it to a ${c.trade} team and be free again` });
    }
    if (options.length === 1) return this._do(tm, f, options[0].id);
    Object.assign(tm, { state: "deciding", until: null });
    this.ask({
      id: `plan-${f.id}`, title: `${tm.name} at ${f.asset}: ${c.text}.`,
      text: this.can(tm, f) ? `${f.holds ? `It holds about ${f.holds} trains an hour. ` : ""}A provisional repair is quicker, and may not hold until the day shift.` : `${tm.name} is a ${tm.trade} team: this is a case for a ${c.trade} team.`,
      options, within: PLAN_S, fallback: options[0].id,
      then: (o) => this._do(tm, f, o),
    });
  }

  /** The team does what was decided: repairs for good or provisionally, secures the place, or leaves. */
  _do(tm, f, o) {
    if (o === "full" || o === "quick") return this._work(tm, f, o === "quick");
    if (o === "secure") {
      Object.assign(tm, { state: "securing", until: null });
      Object.assign(f, { state: "secured", secured: tm.id, team: null });
      this.log(`${this.at()} ${tm.name} stays at ${f.asset} to ${f.secure}; a ${f.cause.trade} team must repair it.`, "team");
      this.give("repair-status", { fault: f.id, asset: f.asset, place: f.place, state: "secured", needs: f.cause.trade, team: tm.name });
      return;
    }
    this._free(tm);
    Object.assign(f, { state: f.secured ? "secured" : "open", team: null });
    this.log(`${this.at()} ${tm.name} leaves ${f.asset}${f.track ? ` and ${f.track}` : ""}: a ${f.cause.trade} team must repair it.`, "team");
    this.give("repair-status", { fault: f.id, asset: f.asset, place: f.place, state: "left", needs: f.cause.trade, team: tm.name });
  }

  _work(tm, f, quick = false) {
    const work = quick ? f.cause.quick.work_s : f.cause.work_s;
    // the team that secured the place is free when the repair begins
    const guard = f.secured && f.secured !== tm.id ? this.teams.find((x) => x.id === f.secured) : null;
    if (guard) this._free(guard);
    Object.assign(tm, { state: "working", until: this.t + work });
    Object.assign(f, { state: "working", team: tm.id, started: this.t, quick, secured: null });
    this.log(`${this.at()} ${tm.name} starts on ${f.asset}${quick ? ", provisionally" : ""}: about ${minutes(work)} min.`, "team");
    this.give("repair-status", { fault: f.id, asset: f.asset, place: f.place, state: "working", eta_s: work, provisional: quick, team: tm.name });
  }

  _done(tm, f) {
    this._free(tm);
    Object.assign(f, { state: "done", done: this.t, out_s: f.out_s + this.t - f.since, provisional: f.quick, team: null, by: tm.id });
    if (f.quick && this.rng("relapse", f.id, f.relapses).next() < f.cause.quick.relapse) f.relapseAt = this.t + Math.round(this.rng("relapse-at", f.id, f.relapses).uniform(...RELAPSE_S));
    this.log(`${this.at()} ${tm.name} reports: ${f.asset} ${f.quick ? "repaired provisionally" : "repaired"}${f.track ? `, everybody has left ${f.track}` : ""}.`, "team");
    this.give("repair-status", { fault: f.id, asset: f.asset, place: f.place, state: "done", provisional: f.quick, team: tm.name });
  }

  /** A provisional repair did not hold: the fault is back, with its cause known. */
  _relapse(f) {
    Object.assign(f, { state: "open", since: this.t, done: null, started: null, relapseAt: null, relapses: f.relapses + 1, provisional: false, quick: false });
    if (f.track && !f.remote) Object.assign(f, { closure: "none", closed: false });
    this.log(`${this.at()} ${f.asset} at ${f.place} has failed again: the provisional repair did not hold.`, "fault");
    this.emit("fault", { fault: f });
    this.give("repair-status", { fault: f.id, asset: f.asset, place: f.place, state: "relapsed" });
  }

  /** The shift's account: the faults, how fast they were restored, the overtime. */
  finish() {
    const st = this.stats();
    this.give("performance-report", {
      scope: DISTRICT.name, kind: "maintenance", faults: st.reported, done: st.done, open: st.open, provisional: st.provisional, relapses: st.relapses, restore_min: st.restore_min, exposed_min: st.exposed_min,
      overtime_h: this.value("overtime"), teams: this.teams.filter((tm) => !tm.overtime).length, violations: this.violations.length, score: this.score().total, effects: this.effects(),
    });
  }

  /**
   * What each of the district's own faults did, in words (the signaller's failure is the signaller's to tell): the
   * trains held or slowed while it was out of order, a danger without anybody there, a repair left for the day shift.
   * @returns {Array<{fault: string, text: string}>}
   */
  effects() {
    const out = [];
    for (const f of this.faults) {
      if (f.reported == null || f.remote) continue;
      const min = this.outage(f) / 60;
      if (f.holds) out.push({ fault: f.id, text: `held or slowed about ${Math.max(1, Math.round((f.holds * min) / 60))} train${Math.round((f.holds * min) / 60) > 1 ? "s" : ""} (${f.holds} an hour, for ${Math.round(min)} min)` });
      if (f.exposed_s >= 60) out.push({ fault: f.id, text: `a danger without anybody there for ${Math.round(f.exposed_s / 60)} min` });
      if (f.done != null && f.provisional) out.push({ fault: f.id, text: "repaired provisionally: for the day shift to do again" });
      else if (f.done == null) out.push({ fault: f.id, text: "not repaired when the shift ended" });
    }
    return out;
  }

  /* ---------------------------------------------------------------- the score */

  /**
   * The faults reported so far: how many are done (provisionally among them), how often one came back, the mean
   * time out of order of those that hold trains (min, weighted by the trains), and the dangers: nobody there now,
   * and the minutes nobody was there.
   */
  stats() {
    const rep = this.faults.filter((f) => f.reported != null);
    const hold = rep.filter((f) => f.holds > 0 || f.safety);
    const w = hold.reduce((a, f) => a + (f.holds || 1), 0);
    const restore = w ? hold.reduce((a, f) => a + (f.holds || 1) * this.outage(f), 0) / w / 60 : null;
    return {
      reported: rep.length, done: rep.filter((f) => f.done != null).length, open: rep.filter((f) => f.done == null).length,
      provisional: rep.filter((f) => f.done != null && f.provisional).length, relapses: rep.reduce((a, f) => a + f.relapses, 0),
      restore_min: restore == null ? null : Math.round(restore * 10) / 10, danger: rep.filter((f) => this.exposed(f)).length,
      exposed_min: Math.round(rep.reduce((a, f) => a + f.exposed_s, 0) / 6) / 10,
    };
  }

  objectives() {
    const st = this.stats(), rep = this.faults.filter((f) => f.reported != null);
    const end = Math.min(this.t, this.length);
    // how well each fault that holds trains was restored: by the minutes it was out of order; one still open counts
    // by the minutes it will have taken at the best (a team at work or on its way), or not at all (no team sent)
    const mark = (min) => Math.max(0, Math.min(1, 1 - (min - RESTORE_MIN.good) / (RESTORE_MIN.bad - RESTORE_MIN.good)));
    const restored = (f) => {
      if (f.done != null) return mark(f.out_s / 60);
      const tm = this.teams.find((x) => x.fault === f.id && x.state !== "securing");
      if (!tm) return 0;
      const left = f.state === "working" ? Math.max(0, tm.until - end) : f.cause.work_s + (tm.state === "driving" ? Math.max(0, tm.until - end) : 0);
      return mark((this.outage(f, end) + left) / 60);
    };
    // a fault reported in the last minutes of the shift is the next shift's
    const hold = rep.filter((f) => (f.holds > 0 || f.safety) && (f.done != null || end - f.since >= 180));
    const hw = hold.reduce((a, f) => a + (f.holds || 1), 0);
    const restore = hw ? hold.reduce((a, f) => a + (f.holds || 1) * restored(f), 0) / hw : 1;
    const sev = this.violations.reduce((s, v) => s + (v.severity >= 3 ? 1 : v.severity === 2 ? 0.5 : 0.15), 0);
    const unguarded = Math.max(0, Math.min(1, (st.exposed_min - EXPOSED_MIN.free) / (EXPOSED_MIN.worst - EXPOSED_MIN.free)));
    const part = (f) => (f.done != null ? (f.provisional ? 0.6 : 1) : f.state === "working" ? 0.7 : f.state === "open" ? 0 : 0.4);
    const w = rep.reduce((a, f) => a + (f.holds || f.safety ? 1 : 0.5), 0);
    const closed = w ? rep.reduce((a, f) => a + (f.holds || f.safety ? 1 : 0.5) * part(f), 0) / w : 1;
    const hours = this.value("overtime"), calls = hours / ON_CALL.hours;
    const idle = rep.filter((f) => f.state === "open" && (f.holds > 0 || f.safety) && end - f.since >= 180).length;
    // a technician called in is worth the overtime when they repaired something
    const used = this.teams.filter((tm) => tm.overtime && rep.some((f) => f.by === tm.id)).length;
    return [
      { id: "restore", label: "Trains running again", weight: 40, value: restore, note: st.restore_min == null ? "no fault held trains" : `${st.restore_min} min out of order on average${st.relapses ? `, ${st.relapses} provisional repair${st.relapses === 1 ? "" : "s"} did not hold` : ""}` },
      { id: "safety", label: "Safety", weight: 30, value: this.violations.some((v) => v.severity >= 3) ? 0 : 1 - sev - 0.6 * unguarded, note: `${this.violations.length} rules broken${st.exposed_min ? `, a danger without anybody there for ${st.exposed_min} min` : ""}` },
      { id: "faults", label: "Faults dealt with", weight: 15, value: closed, note: `${st.done} of ${st.reported} repaired${st.provisional ? `, ${st.provisional} of them provisionally` : ""}` },
      { id: "cost", label: "Overtime", weight: 15, value: hours === 0 ? (idle ? 0.5 : 1) : Math.max(0, 0.85 - 0.25 * (calls - used) - 0.15 * (calls - 1)), note: hours ? `${hours} h${used < calls ? ", not all of it for a repair" : ""}` : idle ? "none, with faults waiting for a team" : "none" },
    ];
  }

  /* ---------------------------------------------------------------- for a page */

  view() {
    const st = this.stats();
    const waiting = this.faults.filter((f) => f.state === "open" || f.state === "secured"), ready = this.teams.filter((tm) => tm.state === "ready");
    const securing = this.teams.filter((tm) => tm.state === "securing"), on = TRADES.filter((trade) => this.onCall[trade] === "available");
    const cause = (f) => (f.known ? `${f.cause.text} (${tradeText(f.cause.trade)})` : `not known; from experience ${likely(f).map((x) => `${tradeText(x.trade)} ${Math.round(x.p * 100)} %`).join(", ")}`);
    const work = (f) => (f.known ? `${minutes(f.cause.work_s)} min${f.cause.quick ? `, provisionally ${minutes(f.cause.quick.work_s)} min` : ""}` : `${minutes(Math.min(...f.causes.map((c) => c.work_s)))} to ${minutes(Math.max(...f.causes.map((c) => c.work_s)))} min`);
    return {
      sketch: this._sketch(),
      figures: [
        { label: "Faults open", value: st.open, tone: st.open ? "warn" : "ok" },
        { label: "Dangers unguarded", value: st.danger, tone: st.danger ? "bad" : "ok" },
        { label: "Teams free", value: `${ready.length} of ${this.teams.length}` },
        { label: "Out of order", value: st.restore_min ?? "–", unit: st.restore_min == null ? "" : "min on average" },
        { label: "Overtime", value: this.value("overtime"), unit: "h" },
      ],
      tables: [
        {
          id: "faults", title: "Faults", columns: ["Asset", "Place", "Fault", "Since", "Matters", "Cause", "Work", "State"], empty: "No fault reported.",
          rows: this.faults.filter((f) => f.reported != null).map((f) => [f.asset, f.place, f.kind, this.at(f.since), f.safety ? "a danger" : f.holds ? `${f.holds} trains an hour` : "comfort", cause(f), work(f), this._state(f)]),
        },
        { id: "teams", title: "Teams", columns: ["Team", "Trade", "Doing"], rows: this.teams.map((tm) => [tm.name, tm.trade, this._doing(tm)]) },
      ],
      actions: [
        {
          name: "send", label: "Send a team", primary: true, disabled: !waiting.length ? "No fault waits for a team." : !ready.length ? "No team is free." : undefined,
          fields: [
            { id: "team", label: "Team", options: ready.map((tm) => ({ id: tm.id, label: `${tm.name} (${tm.trade})` })) },
            { id: "fault", label: "To", options: waiting.map((f) => ({ id: f.id, label: `${f.asset}, ${f.place}` })) },
          ],
        },
        ...(on.length ? [{ name: "callIn", label: "Call a technician on call", hint: `${ON_CALL.hours} h of overtime; ready at the base after ${minutes(ON_CALL.ready_s)} min.`, fields: [{ id: "trade", label: "Trade", options: on.map((trade) => ({ id: trade, label: `${TECHNICIANS[trade]} (${trade})` })) }] }] : []),
        ...(securing.length ? [{ name: "recall", label: "Call off a team that secures", hint: "The team is free again; the place is a danger again.", fields: [{ id: "team", label: "Team", options: securing.map((tm) => ({ id: tm.id, label: `${tm.name}, at ${this.fault(tm.fault).asset}` })) }] }] : []),
      ],
    };
  }

  /** Where a fault stands, in words. */
  _state(f) {
    const tm = f.team ? this.teams.find((x) => x.id === f.team) : null, guard = f.secured && f.secured !== f.team ? this.teams.find((x) => x.id === f.secured) : null;
    const guarded = guard ? `; ${guard.name} secures it` : "";
    if (f.state === "done") return f.provisional ? "repaired provisionally" : "repaired";
    if (f.state === "open") return `${f.relapses ? "failed again, " : ""}waits for ${f.known && f.cause.trade !== "any" ? `a ${f.cause.trade} team` : "a team"}`;
    if (f.state === "secured") return `secured by ${guard?.name ?? "a team"}, waits for a ${f.cause.trade} team`;
    if (f.state === "assigned") return `${tm.name} is on the way${guarded}`;
    if (f.state === "working") return `${tm.name} repairs it${f.quick ? " provisionally" : ""} until ${this.at(tm.until)}`;
    return `${tm.name} ${tm.state === "waiting" ? `waits for the closure of ${f.track}` : tm.state === "deciding" ? "waits for your word" : "looks for the cause"}${guarded}`;
  }

  /** What a team does, in words. */
  _doing(tm) {
    const f = tm.fault ? this.fault(tm.fault) : null;
    if (tm.state === "ready") return `ready${tm.base ? " at the base" : ` at ${tm.place}`}`;
    if (tm.state === "driving") return `drives to ${f.asset}, there at ${this.at(tm.until)}`;
    if (tm.state === "waiting") return `waits at ${f.asset} for the closure`;
    if (tm.state === "diagnosing") return `looks for the cause at ${f.asset}`;
    if (tm.state === "deciding") return `waits at ${f.asset} for your word`;
    if (tm.state === "securing") return `secures ${f.asset}`;
    return `works on ${f.asset} until ${this.at(tm.until)}`;
  }

  /** Where a team is on the map: at its place, or on the road from the place it left by way of Bf Neustadt. */
  _where(tm) {
    const at = (place) => DISTRICT.places[place].map;
    const f = tm.state === "driving" ? this.fault(tm.fault) : null;
    if (!f || tm.from === f.place) return at(tm.place);
    // the first minutes are the start; then the road, a kilometre in the same time everywhere
    const a = DISTRICT.places[tm.from].km, b = DISTRICT.places[f.place].km;
    const km = Math.max(0, Math.min(1, (this.t - tm.left - DRIVE.base_s) / (tm.until - tm.left - DRIVE.base_s))) * (a + b);
    const [from, to, part] = km < a ? [at(tm.from), at(DISTRICT.base), km / a] : [at(DISTRICT.base), at(f.place), b ? (km - a) / b : 1];
    return [from[0] + (to[0] - from[0]) * part, from[1] + (to[1] - from[1]) * part];
  }

  /**
   * The district as a sketch for a page that does not know the game: the line with its places, the
   * faults at their places (one that waits for a team has the free teams as its menu), the teams at
   * their places or on the road (a free team has the faults it can go to as its menu, one that secures
   * a place can be called off), and the base, where the technicians on call are called. A move that
   * needs a second thing of the picture names it (`target`: the team to send, the fault to go to), so
   * that a picture which shows both can offer it there.
   */
  _sketch() {
    const P = DISTRICT.places, base = P[DISTRICT.base].map, items = [];
    for (const [name, p] of Object.entries(P)) if (name !== DISTRICT.base) items.push({ kind: "line", x1: base[0], y1: base[1], x2: p.map[0], y2: p.map[1], tone: "free" });
    const ready = this.teams.filter((tm) => tm.state === "ready");
    const waits = (f) => f.state === "open" || f.state === "secured";
    const calls = TRADES.filter((trade) => this.onCall[trade] === "available").map((trade) => ({ label: `Call ${TECHNICIANS[trade]} (${trade}): ready in ${minutes(ON_CALL.ready_s)} min, ${ON_CALL.hours} h of overtime`, name: "callIn", args: [trade] }));
    for (const [name, p] of Object.entries(P)) {
      const [x, y] = p.map, end = p.list === "end";
      const text = name === DISTRICT.base ? `${name} (base)` : name;
      // the base can be chosen while a technician can still be called
      if (name === DISTRICT.base && calls.length) items.push({ id: "base", kind: "dot", x, y, r: 9, tone: "place", title: `The maintenance base at ${name}: the technicians on call are called from here`, menu: calls });
      else items.push({ kind: "dot", x, y, r: 9, tone: "place" });
      items.push(p.name === "right" ? { kind: "text", x: x + 16, y: y + 5, text } : { kind: "text", x, y: y - 18, text, anchor: "middle" });
      this.faults.filter((f) => f.reported != null && f.place === name).forEach((f, i) => {
        const fy = y + 34 + 24 * i, fx = x + (end ? -4 : 4);
        const can = ready.filter((tm) => this.can(tm, f) !== false || this.exposed(f));
        items.push({ kind: "text", x: fx + (end ? -14 : 14), y: fy + 5, text: f.asset, anchor: end ? "end" : "start", tone: f.state === "done" ? "muted" : undefined });
        items.push({
          id: `fault-${f.id}`, kind: "dot", x: fx, y: fy, r: 7, tone: f.state === "done" ? "ok" : f.state === "working" ? "route" : this.exposed(f) ? "bad" : f.holds || f.safety ? "warn" : "muted",
          // a fault that waits pulses on the page: a danger nobody guards red, one that holds trains or is a danger orange
          alert: !waits(f) ? undefined : this.exposed(f) ? "bad" : f.holds || f.safety ? "warn" : undefined,
          title: `${f.asset} at ${f.place}: ${f.kind}, ${f.safety ? "a danger while nobody is there" : f.holds ? `holds about ${f.holds} trains an hour` : "comfort"}; ${this._state(f)}`,
          menu: !waits(f) ? undefined : can.length
            ? can.map((tm) => ({ label: `Send ${tm.name} (${tm.trade}, ${minutes(this.eta(tm, f))} min)`, name: "send", args: [tm.id, f.id], target: `team-${tm.id}` }))
            : [{ label: "Send a team", name: "send", args: [null, f.id], disabled: ready.length ? `No free team is a ${f.cause.trade} team.` : "No team is free." }],
        });
      });
    }
    // the teams: those at one place one above the other, one on the road where it is
    const here = new Map();
    for (const tm of this.teams) {
      const [x, y] = this._where(tm), road = tm.state === "driving" && tm.from !== this.fault(tm.fault).place;
      const n = road ? 0 : here.get(tm.place) ?? 0;
      if (!road) here.set(tm.place, n + 1);
      // a free team has the faults it can go to as its menu, a team that secures a place can be called off
      const to = tm.state !== "ready" ? [] : this.faults.filter((f) => f.reported != null && waits(f) && (this.can(tm, f) !== false || this.exposed(f)));
      items.push({
        id: `team-${tm.id}`, kind: "tag", x: road ? x : x + P[tm.place].teams[0], y: road ? y : y + P[tm.place].teams[1] - 26 * n, text: `${tm.name.replace(/^Team /, "")} (${tm.trade[0].toUpperCase()})`, anchor: "middle",
        tone: tm.state === "driving" ? "train" : tm.state === "ready" ? "idle" : tm.state === "working" || tm.state === "diagnosing" ? "ok" : "warn",
        title: `${tm.name}, ${tm.trade}: ${this._doing(tm)}`,
        menu: tm.state === "securing" ? [{ label: `Call ${tm.name} off: nobody guards the place then`, name: "recall", args: [tm.id] }]
          : to.length ? to.map((f) => ({ label: `To ${f.asset} (${f.place}, ${minutes(this.eta(tm, f))} min)`, name: "send", args: [tm.id, f.id], target: `fault-${f.id}` })) : undefined,
      });
    }
    return { title: "The district", width: MAP.width, height: MAP.height, label: `Map of ${DISTRICT.name}: the line from Bergheim by Bf Neustadt to Talsee and the branch to Waldau, with the faults at their places and the teams (S: signalling, T: track)`, items };
  }
}
