/**
 * The signaller's game (Fahrdienstleiter): one morning half hour at Bf Neustadt, worked from a relay
 * interlocking with a track diagram panel (Spurplanstellwerk), simplified for teaching.
 *
 * The station is that of the lab survey and of the maintenance story: platform tracks G1 (platform
 * 1), G2 and G3 (platform 2, the island), the double-track line from Bergheim (west) to Talsee
 * (east), the entry signals A and F, the exit signals N1–N3 (east) and P2, P3 (west), the points
 * W1–W6. The player sets routes from a start signal to a destination; the interlocking checks them
 * (the sections clear and not locked by another route, no point locked otherwise, no track closed),
 * moves the points, locks the route and clears the signal. Trains run by it: they brake for a
 * signal at stop, at a distant signal at caution, for the speed of the route and at their platform;
 * the sections behind them are released one by one.
 *
 * At 08:13 exit signal N2 fails (a lamp failure): its route can be set but the signal stays at stop.
 * The player gives the substitute signal (Zs 1) after checking that the route is set and locked and
 * that the track ahead is clear, records the reason, reports the fault to the maintenance dispatcher,
 * closes track G2 for the repair team and reopens it when the team reports that it has left the track.
 * Delays, connections, safety, the fault report and answers to short questions make the score.
 * @module arail/game/signaller
 */
import { Game } from "./core.js";

/** Braking and acceleration (m/s²), the sighting distance of a signal (m), the distant signal (m before the main signal). */
export const BRAKE = 0.6, ACCEL = 0.5, SIGHT_M = 400, DISTANT_M = 1000;
/** Time to throw a point (s); the speed on a substitute signal (m/s, 40 km/h); the shortest dwell (s). */
export const POINT_S = 6, ZS1_MS = 40 / 3.6, DWELL_S = 40;
/** Where a train stops before a signal at stop (m), and at its platform before the end of the track. */
const STOP_GAP_M = 10, PLATFORM_STOP_M = 40;
/** Transfer time between two trains at the same platform, and between platforms 1 and 2 (s). */
const TRANSFER_SAME_S = 30, TRANSFER_OTHER_S = 150;
/** The game ends when all trains have left, at the latest at 08:40 (s after 08:00). */
export const END_S = 40 * 60;

/**
 * Bf Neustadt as a track diagram. Sections with their length (m) and their lines on the panel (grid
 * units: x from west to east, y from top to bottom); `track`: a platform track; `line`: the open line.
 */
export const STATION = {
  name: "Bf Neustadt",
  west: "Bergheim",
  east: "Talsee",
  sections: {
    aw: { len: 1800, line: "Bergheim", label: "from Bergheim", draw: [[[0, 3], [5, 3]]] },
    bw: { len: 1800, line: "Bergheim", label: "to Bergheim", draw: [[[0, 2], [6, 2]]] },
    w1: { len: 100, draw: [[[5, 3], [7, 3]], [[6, 3], [7, 2.5]]] },
    w2: { len: 100, draw: [[[6, 2], [9, 2]], [[7, 2.5], [8, 2]]] },
    w3: { len: 100, draw: [[[9, 2], [11, 2]], [[10, 2], [11, 1]]] },
    g1: { len: 750, track: "G1", platform: 1, draw: [[[7, 3], [19, 3]]] },
    g2: { len: 750, track: "G2", platform: 2, draw: [[[11, 2], [17, 2]]] },
    g3: { len: 750, track: "G3", platform: 2, draw: [[[11, 1], [17, 1]]] },
    w6: { len: 100, draw: [[[17, 2], [19, 2]], [[17, 1], [18, 2]]] },
    w5: { len: 100, draw: [[[19, 2], [21, 2]], [[20, 2], [21, 2.5]]] },
    w4: { len: 100, draw: [[[19, 3], [23, 3]], [[21, 2.5], [22, 3]]] },
    ae: { len: 1800, line: "Talsee", label: "from Talsee", draw: [[[21, 2], [28, 2]]] },
    be: { len: 1800, line: "Talsee", label: "to Talsee", draw: [[[23, 3], [28, 3]]] },
  },
  /** Points: their section, where they are drawn, and their position at the start ("+" straight, "-" diverging). */
  points: {
    W1: { section: "w1", at: [6, 3], pos: "+" },
    W2: { section: "w2", at: [8, 2], pos: "+" },
    W3: { section: "w3", at: [10, 2], pos: "+" },
    W6: { section: "w6", at: [18, 2], pos: "+" },
    W5: { section: "w5", at: [20, 2], pos: "+" },
    W4: { section: "w4", at: [22, 3], pos: "+" },
  },
  /** Main signals at the end of a section in a direction (+1 east, -1 west); `kind`: entry or exit. */
  signals: {
    A: { section: "aw", dir: 1, kind: "entry", at: [5, 3] },
    N1: { section: "g1", dir: 1, kind: "exit", at: [19, 3] },
    N2: { section: "g2", dir: 1, kind: "exit", at: [17, 2] },
    N3: { section: "g3", dir: 1, kind: "exit", at: [17, 1] },
    F: { section: "ae", dir: -1, kind: "entry", at: [21, 2] },
    P2: { section: "g2", dir: -1, kind: "exit", at: [11, 2] },
    P3: { section: "g3", dir: -1, kind: "exit", at: [11, 1] },
  },
  /**
   * Routes (Fahrstraßen): start signal, destination, sections in the order of travel, the points with
   * their position, and the speed (m/s) through them. Entry routes end at a platform track, exit
   * routes on the line to the next station.
   */
  routes: [
    { id: "A-G1", from: "A", to: "G1", sections: ["w1", "g1"], points: { W1: "+" }, speed: 100 / 3.6 },
    { id: "A-G2", from: "A", to: "G2", sections: ["w1", "w2", "w3", "g2"], points: { W1: "-", W2: "-", W3: "+" }, speed: 60 / 3.6 },
    { id: "A-G3", from: "A", to: "G3", sections: ["w1", "w2", "w3", "g3"], points: { W1: "-", W2: "-", W3: "-" }, speed: 60 / 3.6 },
    { id: "N1-T", from: "N1", to: "Talsee", sections: ["w4", "be"], points: { W4: "+" }, speed: 100 / 3.6 },
    { id: "N2-T", from: "N2", to: "Talsee", sections: ["w6", "w5", "w4", "be"], points: { W6: "+", W5: "-", W4: "-" }, speed: 60 / 3.6 },
    { id: "N3-T", from: "N3", to: "Talsee", sections: ["w6", "w5", "w4", "be"], points: { W6: "-", W5: "-", W4: "-" }, speed: 60 / 3.6 },
    { id: "F-G2", from: "F", to: "G2", sections: ["w5", "w6", "g2"], points: { W5: "+", W6: "+" }, speed: 60 / 3.6 },
    { id: "F-G3", from: "F", to: "G3", sections: ["w5", "w6", "g3"], points: { W5: "+", W6: "-" }, speed: 60 / 3.6 },
    { id: "P2-B", from: "P2", to: "Bergheim", sections: ["w3", "w2", "bw"], points: { W3: "+", W2: "+" }, speed: 60 / 3.6 },
    { id: "P3-B", from: "P3", to: "Bergheim", sections: ["w3", "w2", "bw"], points: { W3: "-", W2: "+" }, speed: 60 / 3.6 },
  ],
};

/** The platform tracks by their name. */
const TRACKS = Object.fromEntries(Object.entries(STATION.sections).filter(([, s]) => s.track).map(([id, s]) => [s.track, id]));

/** Kinds of trains: length (m), top speed (m/s), weight in the punctuality score. */
const KINDS = {
  RB: { label: "Regional train", length: 70, vmax: 120 / 3.6, weight: 1 },
  IC: { label: "Intercity", length: 200, vmax: 160 / 3.6, weight: 2 },
  GZ: { label: "Freight train", length: 600, vmax: 80 / 3.6, weight: 0.5, accel: 0.25 },
};

/**
 * The timetable (s after 08:00): when a train comes onto the panel, its planned track (`plan`), and its
 * departure (stopping trains) or its passing time (through trains, at the exit signal). Pairs of
 * regional trains meet at platform 2 for passengers to change. `level`: from which level it runs.
 */
export const TIMETABLE = [
  { id: "RB 31", kind: "RB", dir: 1, enter: 30, plan: "G2", dep: 180, note: "connection to RB 32" },
  { id: "RB 32", kind: "RB", dir: -1, enter: 60, plan: "G3", dep: 210, note: "waits for RB 31" },
  { id: "GZ 47", kind: "GZ", dir: 1, enter: 230, plan: "G3", pass: 580, note: "waits in G3 for IC 2045 to pass" },
  { id: "IC 2045", kind: "IC", dir: 1, enter: 400, plan: "G1", pass: 470 },
  { id: "RB 33", kind: "RB", dir: 1, enter: 720, plan: "G2", dep: 870, note: "connection to RB 34" },
  { id: "RB 34", kind: "RB", dir: -1, enter: 750, plan: "G3", dep: 900, note: "waits for RB 33" },
  { id: "GZ 49", kind: "GZ", dir: -1, enter: 1080, plan: "G2", pass: 1215 },
  { id: "RB 35", kind: "RB", dir: 1, enter: 1440, plan: "G2", dep: 1590, note: "connection to RB 36" },
  { id: "RB 36", kind: "RB", dir: -1, enter: 1470, plan: "G3", dep: 1620, note: "waits for RB 35" },
  { id: "GZ 51", kind: "GZ", dir: 1, enter: 1500, plan: "G1", pass: 1700, level: "hard" },
];

/** The connections: the first train's passengers change to the second at platform 2. */
export const CONNECTIONS = [["RB 31", "RB 32"], ["RB 33", "RB 34"], ["RB 35", "RB 36"]];

/** Levels: which trains, how late they may come, and the failure of N2 with its repair. */
export const LEVELS = {
  training: { label: "Training: no failures", lateMax: 0, failure: null },
  normal: { label: "Normal: a signal fails", lateMax: 60, failure: { signal: "N2", at: 780 } },
  hard: { label: "Hard: late trains, a signal fails earlier, one more freight train", lateMax: 180, failure: { signal: "N2", at: 700 } },
};

/** Reasons for a substitute signal, as recorded with the counter reading. */
export const ZS1_REASONS = [
  { id: "lamp", label: "The signal cannot show a proceed aspect (lamp failure)" },
  { id: "track", label: "A track section shows occupied without a train" },
  { id: "point", label: "A point does not show its end position" },
  { id: "other", label: "Another reason" },
];

/** The repair team: minutes to come from the maintenance base, and to repair the signal. */
const TEAM_DRIVE_S = 300, TEAM_WORK_S = 360;

const QUESTIONS = {
  failure: {
    title: "Exit signal N2 cannot show a proceed aspect. How can RB 33 leave track G2?",
    options: [
      { id: "zs1", label: "With the substitute signal Zs 1, once its route is set and locked and the track ahead is clear", correct: true },
      { id: "driver", label: "The driver may pass the signal at stop on his own after a minute's wait" },
      { id: "none", label: "Not at all until the signal is repaired; RB 33 is cancelled" },
    ],
  },
  zs1: {
    title: "How fast may the driver go on the substitute signal Zs 1?",
    options: [
      { id: "40", label: "At most 40 km/h through the points that follow", correct: true },
      { id: "line", label: "At the speed of the line, as on a proceed aspect" },
      { id: "5", label: "At walking pace, only with a shunter in front" },
    ],
  },
  closure: {
    title: "The repair team wants to work at signal N2 on track G2. What comes first?",
    options: [
      { id: "close", label: "Close G2 in the interlocking (no route into it), then tell the team that it may go onto the track", correct: true },
      { id: "avoid", label: "Tell the team to go ahead and remember not to set routes into G2" },
      { id: "lookout", label: "Nothing: the team has its own lookout" },
    ],
  },
  reopen: {
    title: "When may track G2 be opened for trains again?",
    options: [
      { id: "report", label: "When the team has reported that it has finished and everybody has left the track", correct: true },
      { id: "due", label: "When the next train is due on G2" },
      { id: "time", label: "At the end of the agreed time of the works, whatever the team reports" },
    ],
  },
};

/** Time of day of a game time (s after 08:00). */
export const clockOf = (t) => {
  const s = Math.max(0, Math.round(8 * 3600 + t));
  return `${String(Math.floor(s / 3600) % 24).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** A train on the panel. */
class Train {
  constructor(spec, enterAt) {
    const k = KINDS[spec.kind];
    Object.assign(this, spec);
    this.label = k.label;
    this.length = k.length;
    this.vmax = k.vmax;
    this.accel = k.accel ?? ACCEL;
    this.weight = k.weight;
    this.stops = spec.dep != null;
    this.enterAt = enterAt;
    /** @type {"coming" | "running" | "dwelling" | "gone"} */
    this.state = "coming";
    /** Sections in the order of travel, as far as its routes go. */
    this.path = [];
    /** Distance of the head from the start of its path (m), and the speed (m/s). */
    this.head = 0;
    this.v = 0;
    this.arrived = null;
    this.departed = null;
    this.passed = null;
    this.left = null;
    this.dwell = 0;
    /** The signals it was warned of at their distant signal while they showed stop. */
    this.caution = new Set();
    /** The track it stopped or passed at, and the routes it ran on. */
    this.track = null;
    this.routes = [];
    this.zs1Until = -1;
  }

  /** Where each section of its path starts (m from the start of the path). */
  get starts() {
    let s = 0;
    return this.path.map((p) => {
      const at = s;
      s += STATION.sections[p].len;
      return at;
    });
  }

  get tail() {
    return this.head - this.length;
  }

  /** The time it is measured at: its departure (stopping trains) or its passing (through trains). */
  get due() {
    return this.stops ? this.dep : this.pass;
  }
}

export class SignallerGame extends Game {
  static id = "signaller";
  static title = "Signaller at Bf Neustadt";
  static role = "signaller-relay-interlocking";
  static kind = "both";
  static description = "Set the routes of a morning half hour in a relay interlocking: regional trains with their connections at the island platform, an intercity overtaking a freight train, and a signal that fails.";

  /** @param {{seed?: number, level?: keyof LEVELS}} [options] */
  constructor({ seed = 1, level = "normal" } = {}) {
    super({ seed, level: LEVELS[level] ? level : "normal" });
    const lv = LEVELS[this.level];
    this.points = Object.fromEntries(Object.entries(STATION.points).map(([id, p]) => [id, { id, pos: p.pos, target: p.pos, until: 0 }]));
    this.signals = Object.fromEntries(Object.entries(STATION.signals).map(([id]) => [id, { id, failed: false, zs1: false }]));
    /** @type {Map<string, {id: string, def: object, state: "setting" | "locked", train: string | null, sections: Set<string>, since: number}>} */
    this.routes = new Map();
    /** Closed tracks (Sperre): section id → since when. */
    this.closed = new Map();
    this.trains = TIMETABLE.filter((s) => !s.level || s.level === this.level).map((s) => {
      const late = lv.lateMax ? Math.round(this.rng("late", s.id).next() * lv.lateMax) : 0;
      return new Train(s, s.enter + late);
    });
    this.resource("zs1", "Substitute signals (counter)", 0);
    this.resource("cancel", "Routes cancelled", 0);
    this.failure = lv.failure ? { ...lv.failure, started: false, reported: null, repaired: null } : null;
    /** The repair team: "none" | "driving" | "waiting" (for the closure) | "working" | "done" (reported, off the track) | "left". */
    this.team = { state: "none", at: null, waited: 0 };
    /** Answers to the short questions: id → correct. */
    this.answers = new Map();
    this.log(`${clockOf(0)} The shift begins: ${this.trains.length} trains until ${clockOf(Math.max(...this.trains.map((tr) => tr.due))).slice(0, 5)}.`, "info");
  }

  /* ---------------------------------------------------------------- state of the panel */

  /** Sections occupied by trains: section → train id. */
  occupancy() {
    const occ = new Map();
    for (const tr of this.trains) {
      if (tr.state === "coming" || tr.state === "gone") continue;
      const starts = tr.starts;
      tr.path.forEach((sec, i) => {
        const a = starts[i], b = a + STATION.sections[sec].len;
        if (tr.head > a && tr.tail < b) occ.set(sec, tr.id);
      });
    }
    return occ;
  }

  /** The route that locks a section, or null. A point is locked with its section. */
  lockOf(section) {
    for (const r of this.routes.values()) if (r.sections.has(section)) return r;
    return null;
  }

  /** The route from a signal that no train has passed yet, or null. */
  routeFrom(signal) {
    for (const r of this.routes.values()) if (r.def.from === signal && !r.passed) return r;
    return null;
  }

  /** What a signal shows: "proceed", "stop" (and whether a substitute signal is lit). */
  aspect(id) {
    const s = this.signals[id];
    const r = this.routeFrom(id);
    const proceed = !!r && r.state === "locked" && !s.failed;
    return { id, aspect: proceed ? "proceed" : "stop", failed: s.failed, zs1: s.zs1, route: r?.id ?? null };
  }

  /** Why a route cannot be set now, or null. */
  blocked(routeId) {
    const def = STATION.routes.find((r) => r.id === routeId);
    if (!def) return "There is no such route.";
    if (this.routeFrom(def.from)) return `A route from ${def.from} is already set.`;
    const occ = this.occupancy();
    for (const sec of def.sections) {
      const s = STATION.sections[sec];
      if (this.closed.has(sec)) return `Track ${s.track} is closed.`;
      const lock = this.lockOf(sec);
      if (lock) return `${s.track ? `Track ${s.track}` : "A section of the route"} is locked by route ${lock.id}.`;
      if (occ.has(sec)) return `${s.track ? `Track ${s.track}` : s.line ? `The line ${s.label}` : "A section of the route"} is occupied (${occ.get(sec)}).`;
    }
    return null;
  }

  /** The routes from a signal and whether each can be set now. */
  routesFrom(signal) {
    return STATION.routes.filter((r) => r.from === signal).map((r) => ({ id: r.id, to: r.to, blocked: this.blocked(r.id) }));
  }

  /* ---------------------------------------------------------------- the player's moves */

  /**
   * Set a route (start signal and destination).
   * @returns {{ok: boolean, reason?: string}}
   */
  setRoute(routeId) {
    const why = this.blocked(routeId);
    if (why) return { ok: false, reason: why };
    const def = STATION.routes.find((r) => r.id === routeId);
    const r = { id: def.id, def, state: "setting", train: null, sections: new Set(def.sections), since: this.t, passed: false };
    this.routes.set(r.id, r);
    for (const [p, pos] of Object.entries(def.points)) {
      const pt = this.points[p];
      if (pt.pos !== pos) {
        pt.target = pos;
        pt.until = this.t + POINT_S;
      }
    }
    this.log(`${clockOf(this.t)} Route ${def.from} → ${def.to} set.`, "route");
    this.emit("route", { route: r });
    return { ok: true };
  }

  /**
   * Cancel a route that no train has taken. Once a train runs towards its signal on it, the route
   * stays locked until the train has passed (approach locking) and is released behind it.
   * @returns {{ok: boolean, reason?: string}}
   */
  cancelRoute(routeId) {
    const r = this.routes.get(routeId);
    if (!r) return { ok: false, reason: "There is no such route." };
    if (r.train && !r.passed) return { ok: false, reason: `${r.train} is approaching ${r.def.from} on this route: it stays locked until the train has passed (approach locking).` };
    if (r.train) return { ok: false, reason: `${r.train} runs on this route; it is released behind the train.` };
    this._release(r);
    this.add("cancel", 1);
    this.log(`${clockOf(this.t)} Route ${r.def.from} → ${r.def.to} cancelled.`, "route");
    return { ok: true };
  }

  /**
   * The substitute signal Zs 1 at a signal at stop. The player has checked (or not) that its route
   * is set and locked and that the track ahead is clear, and gives the reason for the record.
   * @param {string} signal
   * @param {{routeChecked?: boolean, trackChecked?: boolean, reason?: string}} checks
   * @returns {{ok: boolean, reason?: string}}
   */
  substitute(signal, { routeChecked = false, trackChecked = false, reason = "" } = {}) {
    const s = this.signals[signal];
    if (!s) return { ok: false, reason: "There is no such signal." };
    if (this.aspect(signal).aspect === "proceed") return { ok: false, reason: `${signal} shows proceed: no substitute signal is needed.` };
    const r = this.routeFrom(signal)?.state === "locked" ? this.routeFrom(signal) : null;
    const occ = this.occupancy();
    const busy = r ? r.def.sections.find((sec) => occ.has(sec)) : null;
    if (!routeChecked || !trackChecked) this.violate("zs1-checks", `${clockOf(this.t)} Zs 1 at ${signal} given without checking the route and the track ahead.`, 2);
    if (!r) this.violate("zs1-route", `${clockOf(this.t)} Zs 1 at ${signal} without a locked route: the points ahead were not secured.`, 3);
    else if (busy) this.violate("zs1-occupied", `${clockOf(this.t)} Zs 1 at ${signal} into an occupied section (${occ.get(busy)}).`, 3);
    const failed = this.failure?.signal === signal && s.failed;
    if (!reason) this.violate("zs1-record", `${clockOf(this.t)} Zs 1 at ${signal}: no reason recorded with the counter reading.`, 1);
    else if (failed && reason !== "lamp") this.violate("zs1-record", `${clockOf(this.t)} Zs 1 at ${signal}: the wrong reason recorded (the signal's lamp has failed).`, 1);
    s.zs1 = true;
    s.zs1Since = this.t;
    this.add("zs1", 1);
    this.log(`${clockOf(this.t)} Substitute signal Zs 1 at ${signal} (counter ${this.value("zs1")}).`, "zs1");
    if (!this.answers.has("zs1")) this._quiz("zs1");
    return { ok: true };
  }

  /** Report the failed signal to the maintenance dispatcher: the repair team drives out. */
  reportFault() {
    const f = this.failure;
    if (!f?.started || f.reported != null) return false;
    f.reported = this.t;
    this.team = { state: "driving", at: this.t + TEAM_DRIVE_S, waited: 0 };
    this.log(`${clockOf(this.t)} Fault of ${f.signal} reported to the maintenance dispatcher; the repair team drives out from the maintenance base.`, "fault");
    const d = this.decisions.find((x) => x.id === "report" && !x.made);
    if (d) this.decide("report", "now");
    return true;
  }

  /**
   * Close a platform track (Sperre): no route into it can be set.
   * @returns {{ok: boolean, reason?: string}}
   */
  closeTrack(track) {
    const sec = TRACKS[track];
    if (!sec) return { ok: false, reason: "There is no such track." };
    if (this.closed.has(sec)) return { ok: false, reason: `${track} is already closed.` };
    if (this.occupancy().has(sec)) return { ok: false, reason: `${track} is occupied.` };
    const lock = this.lockOf(sec);
    if (lock) return { ok: false, reason: `${track} is locked by route ${lock.id}.` };
    this.closed.set(sec, this.t);
    this.log(`${clockOf(this.t)} Track ${track} closed.`, "closure");
    if (this.team.state === "waiting" && track === "G2") this._teamStarts();
    return { ok: true };
  }

  /** Open a closed track again. With the repair team still on it, it is a danger to them. */
  openTrack(track) {
    const sec = TRACKS[track];
    if (!sec || !this.closed.has(sec)) return { ok: false, reason: `${track} is not closed.` };
    if (track === "G2" && this.team.state === "working") this.violate("closure-workers", `${clockOf(this.t)} Track G2 opened while the repair team works on it.`, 3);
    this.closed.delete(sec);
    if (track === "G2" && this.team.state === "done") this.team.state = "left";
    this.log(`${clockOf(this.t)} Track ${track} open.`, "closure");
    return { ok: true };
  }

  /* ---------------------------------------------------------------- the game's step */

  tick(dt) {
    // small steps keep the braking smooth whatever the page's speed
    const n = Math.max(1, Math.ceil(dt / 0.5)), h = dt / n;
    const t0 = this.t - dt;
    for (let i = 1; i <= n; i++) this._step(t0 + i * h, h);
    this._events();
    if (this.t >= END_S || this.trains.every((tr) => tr.state === "gone")) this.end(this.t >= END_S ? `${clockOf(END_S).slice(0, 5)}: the shift is over.` : `${clockOf(this.t)} All trains have left.`);
  }

  _step(now, h) {
    this.t = now;
    // points move, routes lock when their points are in position
    for (const p of Object.values(this.points)) if (p.pos !== p.target && now >= p.until) p.pos = p.target;
    for (const r of this.routes.values()) {
      if (r.state === "setting" && Object.entries(r.def.points).every(([p, pos]) => this.points[p].pos === pos)) {
        r.state = "locked";
        r.lockedAt = now;
      }
    }
    for (const tr of this.trains) this._move(tr, now, h);
  }

  _move(tr, now, h) {
    if (tr.state === "gone") return;
    if (tr.state === "coming") {
      if (now < tr.enterAt) return;
      const first = tr.dir > 0 ? "aw" : "ae";
      // the line section must be clear of the train before
      if (this.occupancy().has(first)) return;
      tr.state = "running";
      tr.path = [first];
      tr.head = Math.min(tr.length, 50);
      tr.v = Math.min(tr.vmax, 22);
      tr.came = now;
      this.log(`${clockOf(now)} ${tr.id} (${tr.label.toLowerCase()}) is coming from ${tr.dir > 0 ? STATION.west : STATION.east}${tr.enterAt > tr.enter ? `, ${Math.round((tr.enterAt - tr.enter) / 60)} min late` : ""}.`, "train");
    }
    this._extend(tr);
    if (tr.state === "dwelling") {
      tr.dwell += h;
      const ready = tr.dwell >= DWELL_S && now >= tr.dep;
      if (!ready) return;
      const sig = this.nextSignal(tr);
      if (sig && !this._mayPass(tr, sig)) return;
      tr.state = "running";
      tr.departed = now;
      this.log(`${clockOf(now)} ${tr.id} departs from ${tr.track}${now - tr.dep >= 60 ? `, ${Math.round((now - tr.dep) / 60)} min late` : ""}.`, "train");
    }
    const end = tr.starts.at(-1) + STATION.sections[tr.path.at(-1)].len;
    const exit = !!STATION.sections[tr.path.at(-1)].line && tr.path.length > 1;
    // the speed allowed now, from what lies ahead
    let allowed = tr.vmax;
    const lim = (v, d) => Math.sqrt(v * v + 2 * BRAKE * Math.max(0, d));
    if (!exit) allowed = Math.min(allowed, lim(0, end - STOP_GAP_M - tr.head));
    // a distant signal at caution: brake as for a stop until the main signal is in sight
    const sig = this.nextSignal(tr);
    if (sig) {
      const d = end - tr.head;
      if (d <= DISTANT_M && d > SIGHT_M && this.aspect(sig).aspect === "stop" && !this.signals[sig].zs1) tr.caution.add(sig);
      if (tr.caution.has(sig)) {
        if (d <= SIGHT_M && this._mayPass(tr, sig)) tr.caution.delete(sig);
        else allowed = Math.min(allowed, lim(0, d - STOP_GAP_M));
      }
    }
    // the platform stop
    const starts = tr.starts;
    if (tr.stops && tr.arrived == null) {
      const i = tr.path.findIndex((sec) => STATION.sections[sec].track);
      if (i >= 0) allowed = Math.min(allowed, lim(0, starts[i] + STATION.sections[tr.path[i]].len - PLATFORM_STOP_M - tr.head));
    }
    // speeds of the routes ahead (and of a substitute signal) until the tail has left them
    for (const r of tr.routes) {
      const i = tr.path.indexOf(r.def.sections[0]), j = tr.path.lastIndexOf(r.def.sections.at(-1));
      if (i < 0 || j < 0) continue;
      const a = starts[i], b = starts[j] + (STATION.sections[tr.path[j]].line ? 0 : STATION.sections[tr.path[j]].len);
      if (tr.tail >= b) continue;
      const v = r.zs1 ? ZS1_MS : r.def.speed;
      allowed = Math.min(allowed, tr.head >= a ? v : lim(v, a - tr.head));
    }
    tr.v = tr.v < allowed ? Math.min(allowed, tr.v + tr.accel * h) : allowed;
    const before = tr.head;
    tr.head = Math.min(tr.head + tr.v * h, exit ? Infinity : end - STOP_GAP_M + 0.01);
    // stopped at the platform
    if (tr.stops && tr.arrived == null) {
      const i = tr.path.findIndex((sec) => STATION.sections[sec].track);
      if (i >= 0 && tr.v < 0.05 && tr.head >= starts[i] + STATION.sections[tr.path[i]].len - PLATFORM_STOP_M - 1) {
        tr.state = "dwelling";
        tr.arrived = now;
        tr.dwell = 0;
        tr.v = 0;
        tr.track = STATION.sections[tr.path[i]].track;
        this.log(`${clockOf(now)} ${tr.id} has arrived at ${tr.track}${tr.track !== tr.plan ? ` (planned ${tr.plan})` : ""}.`, "train");
      }
    }
    // signals passed: they go back to stop, the substitute signal goes out
    for (const [id, s] of Object.entries(STATION.signals)) {
      const i = tr.path.indexOf(s.section);
      if (i < 0 || tr.path[i + 1] == null) continue;
      const at = starts[i] + STATION.sections[s.section].len;
      if (before < at && tr.head >= at) {
        const r = [...this.routes.values()].find((x) => x.def.from === id && x.train === tr.id);
        if (r) r.passed = true;
        this.signals[id].zs1 = false;
        if (s.kind === "exit" && !tr.stops && tr.passed == null) {
          tr.passed = now;
          tr.track = STATION.sections[s.section].track;
        }
      }
    }
    // sections behind the tail are released
    for (const r of [...this.routes.values()]) {
      if (r.train !== tr.id) continue;
      for (const sec of [...r.sections]) {
        const i = tr.path.indexOf(sec);
        if (i >= 0 && tr.tail >= starts[i] + STATION.sections[sec].len) r.sections.delete(sec);
      }
      if (!r.sections.size) this._release(r);
    }
    // off the panel
    if (exit && tr.tail >= end) {
      tr.state = "gone";
      tr.left = now;
      for (const r of [...this.routes.values()]) if (r.train === tr.id) this._release(r);
      const late = Math.round((this._measured(tr) - tr.due) / 60);
      this.log(`${clockOf(now)} ${tr.id} has left towards ${tr.dir > 0 ? STATION.east : STATION.west}${late > 0 ? `, ${late} min late` : ""}.`, "train");
    }
    if (tr.v < 0.05 && tr.state === "running") tr.v = 0;
  }

  /** The signal at the end of a train's path (the next it comes to), or null. */
  nextSignal(tr) {
    const last = tr.path.at(-1);
    if (!last) return null;
    const e = Object.entries(STATION.signals).find(([, s]) => s.section === last && s.dir === tr.dir);
    return e ? e[0] : null;
  }

  /** How far (m) a train's head is from a signal it comes to, or Infinity. */
  distanceTo(tr, signal) {
    if (this.nextSignal(tr) !== signal || tr.state === "coming") return Infinity;
    return tr.starts.at(-1) + STATION.sections[tr.path.at(-1)].len - tr.head;
  }

  /**
   * Whether a train may pass a signal now: the route from it is locked (and not another train's), and
   * the signal shows proceed or the substitute signal.
   */
  _mayPass(tr, signal) {
    const r = this.routeFrom(signal);
    if (!r || r.state !== "locked" || (r.train && r.train !== tr.id)) return false;
    return !this.signals[signal].failed || this.signals[signal].zs1;
  }

  /** A train at the end of its path takes the route from that signal when it may pass. */
  _extend(tr) {
    const sig = this.nextSignal(tr);
    const r = sig ? this.routeFrom(sig) : null;
    if (!r || r.train || !this._mayPass(tr, sig)) return;
    r.train = tr.id;
    r.zs1 = this.signals[sig].zs1;
    tr.routes.push(r);
    tr.path.push(...r.def.sections);
  }

  _release(r) {
    this.routes.delete(r.id);
  }

  /** When a train was measured: departed (stopping), passed (through); while it is still here, now. */
  _measured(tr) {
    return (tr.stops ? tr.departed : tr.passed) ?? this.t;
  }

  /** Events of the morning: the failure, the repair team, questions. */
  _events() {
    const f = this.failure;
    if (f && !f.started && this.t >= f.at) {
      f.started = true;
      this.signals[f.signal].failed = true;
      this.log(`${clockOf(this.t)} Signal ${f.signal} shows no proceed aspect: a lamp failure.`, "fault");
      this.ask({
        id: "report", title: `Signal ${f.signal} has failed. Report the fault to the maintenance dispatcher?`,
        text: "The dispatcher sends the repair team from the maintenance base; it needs the track closed for the repair.",
        options: [{ id: "now", label: "Report it now" }, { id: "later", label: "Later" }],
        then: (o) => {
          if (o === "now") this.reportFault();
          else this._again = this.t + 180;
        },
      });
      this._quiz("failure");
    }
    if (f?.started && f.reported == null && this._again != null && this.t >= this._again && !this.open.some((d) => d.id === "report")) {
      this._again = null;
      this.ask({
        id: "report", title: `Signal ${f.signal} is still out of order. Report the fault now?`,
        options: [{ id: "now", label: "Report it now" }, { id: "later", label: "Later" }],
        then: (o) => {
          if (o === "now") this.reportFault();
          else this._again = this.t + 180;
        },
      });
    }
    const team = this.team;
    if (team.state === "driving" && this.t >= team.at) {
      team.state = "waiting";
      team.since = this.t;
      this.log(`${clockOf(this.t)} The repair team is at signal ${f.signal} and asks for track G2 to be closed.`, "fault");
      this.ask({
        id: "closure", title: "The repair team asks for track G2 to be closed for the repair.",
        text: "Close G2 at the panel (Close track) once it is clear; the team then goes onto the track.",
        options: [{ id: "close", label: "Close G2 now" }, { id: "wait", label: "Ask the team to wait" }],
        then: (o) => {
          if (o === "close" && !this.closed.has("g2")) {
            const res = this.closeTrack("G2");
            if (!res.ok) this.log(`${clockOf(this.t)} G2 cannot be closed yet: ${res.reason}`, "fault");
          }
        },
      });
      this._quiz("closure");
    }
    if (team.state === "waiting") team.waited = this.t - team.since;
    if (team.state === "working" && this.t >= team.at) {
      team.state = "done";
      f.repaired = this.t;
      this.signals[f.signal].failed = false;
      this.log(`${clockOf(this.t)} The repair team reports: signal ${f.signal} repaired, everybody has left track G2.`, "fault");
      this.ask({
        id: "reopen", title: "The repair is done and the team has left the track. Open G2 again?",
        options: [{ id: "open", label: "Open G2" }, { id: "later", label: "Later" }],
        then: (o) => {
          if (o === "open") this.openTrack("G2");
        },
      });
      this._quiz("reopen");
    }
  }

  _teamStarts() {
    const team = this.team;
    team.state = "working";
    team.at = this.t + TEAM_WORK_S;
    team.waited = this.t - (team.since ?? this.t);
    this.log(`${clockOf(this.t)} The repair team goes onto track G2.`, "fault");
    const d = this.decisions.find((x) => x.id === "closure" && !x.made);
    if (d) this.decide("closure", "close");
  }

  _quiz(id) {
    const q = QUESTIONS[id];
    this.ask({
      id: `quiz-${id}`, title: q.title, options: q.options.map(({ id: o, label }) => ({ id: o, label })),
      then: (o) => {
        const ok = !!q.options.find((x) => x.id === o)?.correct;
        this.answers.set(id, ok);
        this.log(ok ? "Right." : `Not quite: ${q.options.find((x) => x.correct).label}.`, ok ? "right" : "wrong");
      },
    });
  }

  /* ---------------------------------------------------------------- the score */

  /** The trains with their delay (min, at departure or passing), track and connection. */
  report() {
    return this.trains.map((tr) => ({
      id: tr.id, kind: tr.kind, label: tr.label, plan: tr.plan, track: tr.track, state: tr.state, note: tr.note ?? "",
      due: tr.due, at: tr.stops ? tr.departed : tr.passed,
      delay: tr.state === "coming" && this.t < tr.due ? 0 : Math.max(0, (this._measured(tr) - tr.due) / 60),
    }));
  }

  /** Whether each connection worked: the second train left after the first train's passengers could change. */
  connections() {
    const by = new Map(this.trains.map((tr) => [tr.id, tr]));
    return CONNECTIONS.filter(([a, b]) => by.has(a) && by.has(b)).map(([a, b]) => {
      const from = by.get(a), to = by.get(b);
      // not yet known while the game runs; at its end, a train that did not run broke it
      if (from.arrived == null || to.departed == null) return { from: a, to: b, kept: this.over ? false : null };
      const need = from.track && to.track && STATION.sections[TRACKS[from.track]].platform === STATION.sections[TRACKS[to.track]].platform ? TRANSFER_SAME_S : TRANSFER_OTHER_S;
      return { from: a, to: b, kept: to.departed >= from.arrived + need };
    });
  }

  objectives() {
    const rep = this.report().filter((r) => r.state !== "coming" || this.over);
    const w = rep.reduce((s, r) => s + (KINDS[r.kind].weight || 1), 0) || 1;
    const avg = rep.reduce((s, r) => s + (KINDS[r.kind].weight || 1) * r.delay, 0) / w;
    const sev = this.violations.reduce((s, v) => s + (v.severity >= 3 ? 1 : v.severity === 2 ? 0.5 : 0.15), 0);
    const cons = this.connections().filter((c) => c.kept != null);
    const moved = this.trains.filter((tr) => tr.track && tr.track !== tr.plan).length;
    const f = this.failure;
    let upkeep = 1, note = "no failure";
    if (f?.started) {
      const late = f.reported == null ? null : (f.reported - f.at) / 60;
      upkeep = late == null ? 0 : late <= 2 ? 1 : late <= 6 ? 0.7 : 0.4;
      if (this.team.waited > 240) upkeep -= 0.2;
      note = late == null ? "not reported" : `reported after ${Math.round(late)} min${f.repaired != null ? ", repaired" : ""}`;
    }
    const asked = [...this.answers.values()];
    return [
      { id: "punctuality", label: "Punctuality", weight: 35, value: 1 - avg / 6, note: `${avg.toFixed(1)} min late on average` },
      { id: "safety", label: "Safety", weight: 30, value: this.violations.some((v) => v.severity >= 3) ? 0 : 1 - sev, note: `${this.violations.length} rules broken` },
      { id: "passengers", label: "Connections and platforms", weight: 15, value: (cons.length ? cons.filter((c) => c.kept).length / cons.length : 1) - 0.1 * moved, note: `${cons.filter((c) => c.kept).length} of ${cons.length} connections, ${moved} trains on another track` },
      { id: "upkeep", label: "The failure", weight: 10, value: upkeep, note },
      { id: "knowledge", label: "Questions", weight: 10, value: asked.length ? asked.filter(Boolean).length / asked.length : 1, note: `${asked.filter(Boolean).length} of ${asked.length} right` },
    ];
  }

  /** The result: a shift is only passed when every train has got through. */
  result() {
    const res = super.result();
    const stuck = this.trains.filter((tr) => tr.state !== "gone").map((tr) => tr.id);
    return { ...res, stuck, passed: res.passed && !stuck.length };
  }

  /** Everything a page draws, as plain data. */
  state() {
    const occ = this.occupancy();
    return {
      t: this.t, clock: clockOf(this.t), over: this.over, level: this.level,
      sections: Object.fromEntries(Object.keys(STATION.sections).map((id) => [id, { occupied: occ.get(id) ?? null, route: this.lockOf(id)?.id ?? null, closed: this.closed.has(id) }])),
      points: Object.fromEntries(Object.values(this.points).map((p) => [p.id, { pos: p.pos, moving: p.pos !== p.target, locked: !!this.lockOf(STATION.points[p.id].section) }])),
      signals: Object.fromEntries(Object.keys(STATION.signals).map((id) => [id, this.aspect(id)])),
      routes: [...this.routes.values()].map((r) => ({ id: r.id, from: r.def.from, to: r.def.to, state: r.state, train: r.train })),
      trains: this.trains.map((tr) => {
        const here = tr.state === "running" || tr.state === "dwelling";
        const at = here ? [...occ.entries()].filter(([, id]) => id === tr.id).map(([sec]) => sec) : [];
        // the section of the head and how far along it (0–1, in the direction of travel)
        let head = null;
        if (here) {
          const starts = tr.starts, i = Math.max(0, starts.findLastIndex((x) => x < tr.head));
          head = { section: tr.path[i], frac: Math.min(1, (tr.head - starts[i]) / STATION.sections[tr.path[i]].len) };
        }
        return { id: tr.id, kind: tr.kind, label: tr.label, dir: tr.dir, state: tr.state, plan: tr.plan, track: tr.track, speed: Math.round(tr.v * 3.6), at, head, due: tr.due, stops: tr.stops, note: tr.note ?? "", next: here ? this.nextSignal(tr) : null };
      }),
      team: { ...this.team },
      failure: this.failure ? { signal: this.failure.signal, started: this.failure.started, reported: this.failure.reported, repaired: this.failure.repaired } : null,
      counters: { zs1: this.value("zs1"), cancel: this.value("cancel") },
      decisions: this.open,
    };
  }
}
