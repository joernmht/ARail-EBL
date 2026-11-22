/**
 * The train dispatcher's game (Zugdisponent/in in der Betriebszentrale), "Who goes first": the
 * morning of the signaller's game (08:00 to 08:40 at Bf Neustadt) from the desk above the signal
 * box. The trains belong to three undertakings: the regional trains RB 31 to RB 36, the intercity
 * IC 2045 and the freight trains GZ 47 and GZ 49. Some come late, and how late is a forecast.
 *
 * The dispatcher has two orders. A train waits for another, at most so many minutes: that keeps a
 * connection (RB 34 waits for the passengers of RB 33) and decides who goes first (GZ 47 waits in
 * G3 to let IC 2045 pass, or goes at its own time). And a train that is still to come takes another
 * platform track than the timetable's. Every order moves minutes from one train to another, and so
 * from one undertaking to another: a wait that is too short costs the minutes and the connection, a
 * freight train that goes first may have an intercity behind it all the way to the next loop, one
 * that waits stands in a track the next train needs, and a train sent to the other platform sends
 * its passengers across the station. The undertakings count
 * their minutes; their goodwill falls with each one, they phone, and one that is always the one to
 * wait files a complaint with the regulator, which holds where the orders left the rules of the
 * line. So no order is right for everybody: the morning asks for compromise.
 *
 * In a session the trains are the signaller's: delays arrive as delay notices, the orders go out
 * as dispatching orders, and an undertaking's wish to hold a train (a connection request) is the
 * dispatcher's to grant. Alone, the game runs the signaller's game itself, with the computer's
 * signaller, and plays the undertakings.
 *
 * Simplified for teaching: the rules of the line stand for the dispatching rules of a network
 * statement (a train on time before a late one; a wait of up to three minutes for connecting
 * passengers or to let a train pass); goodwill stands for what undertakings say and write; beyond
 * the station a faster train behind a slower one loses time as far as the next loop.
 * @module arail/game/dispatcher
 */
import { Game, Player, clockAt } from "./core.js";
import { CONNECTIONS, DWELL_S, KINDS, STATION, SignallerGame, TIMETABLE, TRANSFER_OTHER_S, TRANSFER_SAME_S } from "./signaller.js";
import { NEXT_TRAIN_MIN, RUN_S } from "./transport-control.js";

/** The rule of the line: how long a train may be asked to wait, for connecting passengers or to let another pass (min). */
export const WAIT_RULE_MIN = 3;
/** The longest wait that can be ordered (min). */
export const WAIT_MAX_MIN = 8;
/** The step of a wait's scale (min). */
export const WAIT_STEP_MIN = 0.5;
/** "However late it comes": a wait without an end within the shift (min). */
export const WHATEVER_MIN = 90;
/** The next loop beyond the station, where a faster train can pass a slower one (m). */
export const LOOP_M = 8000;
/** The time between two trains on the line (s). */
export const BLOCK_S = 60;
/** Time to decide (s): on a wait, on who goes first, on a track, on the phone. */
export const DECIDE_S = { wait: 80, first: 90, track: 80, call: 70 };
/** The platform of each platform track, and the tracks a train can be sent to by where it comes from (1: Bergheim, -1: Talsee). */
export const PLATFORMS = Object.fromEntries(Object.values(STATION.sections).filter((x) => x.track).map((x) => [x.track, x.platform]));
export const TRACKS_FROM = Object.fromEntries([[1, "A"], [-1, "F"]].map(([dir, signal]) => [dir, STATION.routes.filter((r) => r.from === signal).map((r) => r.to)]));
/** A track must be ordered this long before the train comes, when the signaller sets its route (s). */
export const TRACK_LEAD_S = 90;
/** Two trains on one track need this long between them (s). */
export const BETWEEN_S = 60;
/** The delay added in the area, as an average over its trains, that leaves nothing of that objective (min). */
export const DELAY_NONE_MIN = 2;
/** A forecast that is off by this much is worth a word (s). */
const OFF_S = 60;
/** A train that leaves this soon after its time is on time (s). */
const ON_TIME_S = 30;
/** A forecast is told in tenths of a minute: this much is no difference (s). */
const SLACK_S = 6;

/**
 * Goodwill of an undertaking (0 to 100): where it starts, below which it phones, below which it
 * files a complaint with the regulator; what a train on time gives back, what a promise and an
 * explanation that is accepted are worth, what a refused explanation, a shrug and a broken promise
 * cost, and a train that stops at another platform than its passengers were told.
 */
export const GOODWILL = { start: 100, call: 62, complaint: 28, on_time: 2, promise: 14, explained: 12, refused: -6, sorry: 3, broken: -26, declined: -8, moved: -5 };

/**
 * The undertakings: whose trains (by kind), who phones (people are named with birds, see
 * CONTRIBUTING.md), what a minute added to one of their trains costs their goodwill, and what
 * else does: a trip that leaves late enough for a penalty in the transport contract, a missed
 * connection (and each passenger left behind), a train that is put aside.
 */
export const UNDERTAKINGS = {
  regio: { name: "Regional", long: "the regional undertaking", kinds: ["RB"], who: "L. Meise", minute: 7, late_from_min: 4, late: 6, missed: 12, changer: 0.6 },
  fern: { name: "Long-distance", long: "the long-distance undertaking", kinds: ["IC"], who: "H. Kranich", minute: 14 },
  cargo: { name: "Freight", long: "the freight undertaking", kinds: ["GZ"], who: "B. Habicht", minute: 10, aside: 30 },
};

/** A freight train's driver near the end of the driving time: from this wait on (min) the train may be put aside, how likely, and what that adds (min). */
export const HOURS = { stand_min: 2, chance: 0.6, aside_min: 8 };
/** A promise of a clear run is kept when the train gets no more than this (min). */
export const PROMISE_MIN = 1;
/** The share of a minute's cost that is left when the train's own undertaking asked for the wait and it kept the connection. */
const ASKED = 0.3;
/** An explanation is accepted this often: when the orders kept the rules of the line, and when they did not. */
const ACCEPT = { kept: 0.85, left: 0.2 };

/**
 * Levels: which trains come late (seconds), how far each forecast may be off (seconds either way),
 * whether the freight undertaking phones about its driver's time, and at what time (s).
 */
export const LEVELS = {
  training: { label: "Training: one late intercity, the forecast holds", late: { "IC 2045": 300 }, spread: {}, hours: null },
  normal: { label: "Normal: three late trains, forecasts that may be off, a driver short of time", late: { "IC 2045": 300, "RB 33": 240, "RB 35": 150 }, spread: { "IC 2045": 150, "RB 33": 80, "RB 35": 60 }, hours: { train: "GZ 49", at: 520 } },
  hard: { label: "Hard: later trains, wider forecasts", late: { "IC 2045": 330, "RB 33": 270, "RB 35": 180 }, spread: { "IC 2045": 210, "RB 33": 120, "RB 35": 90 }, hours: { train: "GZ 49", at: 520 } },
};

/** How wide a page draws a train's tag in the picture of the tracks (px of the sketch). */
const TAG_PX = (text) => text.length * 7.6 + 14;

/** Minutes as they are said: "2", "2.5". */
const mins = (s) => String(Math.round(s / 6) / 10);
/** A time of day without its seconds, of a time of the shift (s). */
const hm = (t) => clockAt(t).slice(0, 5);
/** A time of day with its seconds where it has some ("08:09:40"), of a time of the shift (s). */
const hms = (t) => (Math.round(t) % 60 ? `${hm(t)}:${String(Math.round(t) % 60).padStart(2, "0")}` : hm(t));

/**
 * How long a faster train loses behind a slower one beyond the station (s): the slower one needs its
 * time to the next loop and a block behind it, and the faster one cannot be there before.
 * @param {string} slow the slower train's kind
 * @param {string} fast the faster train's kind
 * @param {number} gap how long after the slower train the faster one leaves the station (s)
 */
export function behind(slow, fast, gap) {
  const vs = KINDS[slow].vmax, vf = KINDS[fast].vmax;
  return vf > vs && gap >= 0 ? Math.max(0, LOOP_M / vs + BLOCK_S - LOOP_M / vf - gap) : 0;
}

/**
 * The computer's dispatcher, by the rules of the line: a connection is worth a wait of up to three
 * minutes where the changers' half hour outweighs the minutes of those aboard; a train on time goes
 * at its time and does not wait for a late one of another kind; on the phone it explains, and it
 * promises nothing.
 */
export class DispatcherPlayer extends Player {
  /** @param {DispatcherGame} g */
  think(g) {
    for (const d of g.open) g.act("decide", d.id, g.advice(d.id));
  }
}

export class DispatcherGame extends Game {
  static id = "dispatcher";
  static title = "Who goes first";
  static role = "train-dispatcher";
  static kind = "simulation";
  static description = "The morning from the desk above the signal box: three undertakings' trains, some late by a forecast that may be off. Order who waits for whom and how long: every minute you give one train, another one pays.";
  static scale = "minutes";
  // the morning's trains through Bf Neustadt are bound to it
  static clock = "08:00";
  static takes = [
    { flow: "delay-notice", from: ["signaller-relay", "signaller-electronic", "signaller-digital", "signaller-mechanical"] },
    { flow: "connection-request", from: ["ru-control-dispatcher"] },
  ];
  static gives = [
    { flow: "dispatching-order", to: ["signaller-relay", "signaller-electronic", "signaller-digital", "signaller-mechanical"] },
    { flow: "performance-report" },
  ];
  static actions = {
    ...Game.actions,
    order: { label: "Order a train to wait" },
    track: { label: "Send a train to another track" },
  };
  static player = DispatcherPlayer;
  /**
   * What does not go to plan (`irregular`, with the texts a mission's story names): a train that comes
   * otherwise than announced (`train`, `min`, `told`); a train that waited and left without the
   * passengers it waited for (`train`, `feeder`, `min`); a train that runs behind a slower one to the
   * next loop (`train`, `slow`, `min`); an undertaking's complaint to the regulator (`who`,
   * `undertaking`, `verdict`); a promise that was not kept (`who`, `train`); a freight train put aside
   * because its driver's time was up (`train`).
   */
  static irregularities = ["forecast-off", "wait-wasted", "followed", "complaint", "promise-broken", "put-aside"];

  /** @param {{seed?: number, level?: keyof LEVELS, conditions?: object, wired?: Iterable<string>, length?: number}} [options] */
  constructor(options = {}) {
    super({ ...options, level: LEVELS[options.level] ? options.level : "normal" });
    const lv = LEVELS[this.level];
    this.length = options.length ?? 2400;
    /**
     * The trains of the morning, as the dispatcher knows them: the timetable, the passengers aboard
     * (a feeder: those who change to its `partner`), what is announced (`told_s`, `spread_s`), how
     * late it came into the area (`in_s`), when it stopped at its platform (`arrived_at`), how late it
     * left (`out_s`, at `left_at`), what was ordered (`order`).
     * @type {Array<object>}
     */
    this.trains = [];
    for (const spec of TIMETABLE.filter((x) => !x.level)) this._add(spec);
    for (const [id, u] of Object.entries(UNDERTAKINGS)) this.resource(`goodwill-${id}`, `${u.name}: goodwill`, GOODWILL.start);
    /** What each undertaking was promised (`{undertaking, train, kept}`), and how often an order against it left the rules of the line. */
    this.promises = [];
    this.deviations = { regio: 0, fern: 0, cargo: 0 };
    /** Which undertakings phoned, which complained (and whether the regulator upheld it). */
    this.called = new Set();
    this.complaints = [];
    /** The trains an open decision is about: its id → their ids. */
    this.about = new Map();
    /** The pairs asked about already ("GZ 47|IC 2045"). */
    this._asked = new Set();
    /** The freight train whose driver is short of time, once its undertaking has phoned: `{train, promised}`. */
    this.hours = lv.hours ? { ...lv.hours, asked: false, answer: null } : null;
    /**
     * Alone, the game runs the morning itself: the signaller's game with the computer's signaller,
     * whose notices it reads and who takes its orders.
     */
    this.own = !this.isWired("dispatching-order");
    this.world = this.own ? new SignallerGame({ seed: this.seed, level: "training", late: lv.late, spread: lv.spread, wired: ["dispatching-order", "delay-notice"] }) : null;
    this._pilot = this.own ? new SignallerGame.player() : null;
    this._read = 0;
    /** The regional undertaking's wishes come by flow when its operations control is seated; else the game makes them. */
    this.wishes = !this.isWired("connection-request");
    this.log(`${clockAt(0)} The shift begins: ${this.trains.length} trains of three undertakings through Bf Neustadt until ${hm(this.length)}.`);
  }

  /** A train of the timetable becomes one the desk follows. */
  _add(spec) {
    const r = this.rng("passengers", spec.id), pair = CONNECTIONS.find((c) => c.includes(spec.id));
    const ru = Object.keys(UNDERTAKINGS).find((id) => UNDERTAKINGS[id].kinds.includes(spec.kind));
    const tr = {
      id: spec.id, kind: spec.kind, ru, dir: spec.dir, plan: spec.plan, stops: spec.dep != null, enter: spec.enter, arr: spec.arr ?? null, due: spec.dep ?? spec.pass,
      aboard: spec.kind === "RB" ? 70 + r.int(90) : spec.kind === "IC" ? 260 + r.int(120) : 0,
      feeder: pair?.[0] === spec.id, partner: pair ? pair.find((id) => id !== spec.id) : null, changers: pair?.[0] === spec.id ? 10 + r.int(30) : 0,
      told_s: null, spread_s: 0, exact: false, in_s: 0, delay_min: 0, arrived_at: null, waiting_s: null, out_s: null, left_at: null, knock_s: 0, aside: false, order: null, wish_min: null, kept: null,
    };
    this.trains.push(tr);
    return tr;
  }

  /** A train of the morning by its id. */
  train(id) {
    return this.trains.find((x) => x.id === id);
  }

  /** The goodwill of an undertaking (0 to 100). */
  goodwill(ru) {
    return Math.round(this.value(`goodwill-${ru}`));
  }

  /** How long passengers need to change between two trains (s): at one platform, or across to the other. */
  change(a, b) {
    return PLATFORMS[a.plan] === PLATFORMS[b.plan] ? TRANSFER_SAME_S : TRANSFER_OTHER_S;
  }

  /** How long the connecting train of a feeder would have to wait beyond its time, if the feeder comes `late_s` late (s; 0: the connection holds anyway). */
  needed(feeder, late_s) {
    const b = this.train(feeder.partner);
    return Math.max(0, late_s - (b.due - (feeder.enter + RUN_S) - this.change(feeder, b)));
  }

  /**
   * When a train is expected to leave or pass (s of the shift): when it did, else from how late it
   * comes, how long it stops, what it was ordered to wait for, and whether it stands beyond its time.
   */
  expect(tr) {
    if (tr.out_s != null) return tr.due + tr.out_s;
    let at = tr.stops ? Math.max(tr.due, tr.enter + tr.in_s + RUN_S + DWELL_S) : tr.due + tr.in_s;
    const other = tr.order && this.train(tr.order.for);
    if (other && other.out_s == null) {
      const done = tr.stops && other.stops ? other.enter + other.in_s + RUN_S + this.change(other, tr) : this.expect(other) + 20;
      at = Math.max(at, Math.min(tr.order.until, done));
    } else if (!tr.order && tr.kind === "GZ") {
      // by the timetable a freight train lets the trains planned before it go first
      for (const x of this.before(tr)) at = Math.max(at, this.expect(x) + 20);
    }
    if (tr.waiting_s != null) at = Math.max(at, this.t);
    return at;
  }

  /** The trains planned before a train in its direction that have not left yet: those it could wait for, or go before. */
  before(tr) {
    return this.trains.filter((x) => x !== tr && x.dir === tr.dir && x.due < tr.due && x.out_s == null);
  }

  /**
   * When each train is on its platform track, as it is expected now: from shortly before it stops (or
   * passes) until it has left (s of the shift). `late`: as if it came so late (0: as planned).
   */
  span(tr, late = tr.in_s) {
    const a = (tr.stops ? tr.arr - 25 : Math.min(tr.due - 40, tr.enter + 150)) + late;
    return { tr, a, b: late === tr.in_s ? Math.max(a + 30, this.expect(tr) + 25) : tr.due + late + 25 };
  }

  /** Whether a train's track can still be changed: the signaller has not set its route yet (it comes no earlier than its forecast allows). */
  movable(tr) {
    return tr.out_s == null && this.t <= tr.enter + Math.max(0, tr.in_s - tr.spread_s) - TRACK_LEAD_S;
  }

  /** The other tracks a train could take that are expected free while it is there. */
  free(tr) {
    const s = this.span(tr), others = this.trains.filter((x) => x !== tr && x.out_s == null).map((x) => this.span(x));
    return TRACKS_FROM[tr.dir].filter((g) => g !== tr.plan && !others.some((o) => o.tr.plan === g && o.a < s.b + BETWEEN_S && o.b + BETWEEN_S > s.a));
  }

  /** The trains a train could be ordered to wait for: its feeder, and the trains before it in its direction. */
  others(tr) {
    if (tr.out_s != null) return [];
    const a = !tr.feeder && tr.partner ? this.train(tr.partner) : null;
    return [...(a && a.out_s == null ? [a] : []), ...this.before(tr)];
  }

  /* ---------------------------------------------------------------- what comes in */

  take(msg) {
    const p = msg.payload ?? {};
    if (msg.flow === "delay-notice") this._noticed(p);
    else if (msg.flow === "connection-request") this._wished(p);
  }

  /** A delay notice: a forecast, the forecast made exact, a train that stands beyond its time, a train that has left. */
  _noticed(p) {
    const spec = TIMETABLE.find((x) => x.id === p.train), tr = this.train(p.train) ?? (spec ? this._add(spec) : null);
    if (!tr) return;
    const late = Math.round((p.delay_min ?? 0) * 60);
    if (p.stage === "approaching") {
      const first = tr.told_s == null;
      if (first) tr.told_s = late;
      tr.spread_s = p.exact ? 0 : Math.round((p.spread_min ?? 0) * 60);
      tr.exact = !!p.exact || !tr.spread_s;
      tr.in_s = late;
      tr.delay_min = late / 60;
      if (first) this.log(`${clockAt(this.t)} ${tr.id} is announced about ${mins(late)} min late${tr.spread_s ? ` (it may be ${mins(Math.max(0, late - tr.spread_s))} to ${mins(late + tr.spread_s)})` : ""}.`, "train");
      else {
        this.log(`${clockAt(this.t)} ${tr.id} is on its way: ${mins(late)} min late, not ${mins(tr.told_s)}.`, "train");
        if (Math.abs(late - tr.told_s) >= OFF_S) this.irregular("forecast-off", `off:${tr.id}`, { train: tr.id, min: mins(late), told: mins(tr.told_s) });
      }
      this._conflicts();
    } else if (p.stage === "waiting") tr.waiting_s = late;
    else if (p.stage === "arrived") tr.arrived_at = p.at_s ?? this.t;
    else if (p.stage === "departed" || p.stage === "passed") this._left(tr, p.at_s != null ? Math.max(0, Math.round(p.at_s - tr.due)) : late, p.at_s ?? tr.due + late);
  }

  /** The regional undertaking's operations control asks to hold a train (a connection request). */
  _wished(p) {
    const b = this.train(p.hold), a = this.train(p.for);
    if (!b || !a || b.out_s != null) return;
    b.wish_min = Math.max(0, Number(p.minutes) || 0);
    this._askWait(b, a);
  }

  /** Look for what must be asked now: a feeder that comes late, a train that will not be gone when the freight train behind it is due. */
  _conflicts() {
    if (this.over) return;
    for (const a of this.trains.filter((x) => x.feeder && x.told_s != null && x.out_s == null)) {
      const b = this.train(a.partner);
      if (this.wishes && b.out_s == null && this.needed(a, a.in_s + a.spread_s) > 0) this._askWait(b, a);
    }
    for (const f of this.trains.filter((x) => x.kind === "GZ" && x.out_s == null && this.t >= x.enter - 300)) {
      for (const x of this.before(f)) {
        if (x.kind === f.kind || this.expect(x) < f.due - 30) continue;
        this._askFirst(f, x);
      }
    }
    // two trains expected on one track at once: the later one will stand at the signal, unless one of them goes elsewhere
    const spans = this.trains.filter((x) => x.out_s == null).map((x) => this.span(x));
    for (const s of spans) {
      const o = spans.find((y) => y !== s && y.tr.plan === s.tr.plan && y.a < s.a && y.b + BETWEEN_S > s.a);
      if (o && this.t >= s.a - 600) this._askTrack(o.tr, s.tr);
    }
  }

  /** Two trains are expected on one track at once: which of them goes elsewhere, if any? One of a few choices. */
  _askTrack(first, second) {
    const key = `track|${second.id}|${first.id}`;
    if (this._asked.has(key)) return;
    const moves = [first, second].filter((tr) => this.movable(tr)).flatMap((tr) => this.free(tr).map((to) => ({ tr, to })));
    if (!moves.length) return;
    this._asked.add(key);
    const id = `track-${second.id}`, track = second.plan;
    const what = ({ tr, to }) => {
      const pair = tr.partner ? this.train(tr.partner) : null;
      if (!tr.stops) return "";
      return PLATFORMS[to] === PLATFORMS[tr.plan] ? "the other side of its platform" : `platform ${PLATFORMS[to]}${pair ? `: changing ${tr.feeder ? "to" : "from"} ${pair.id} takes ${mins(TRANSFER_OTHER_S)} min, not ${mins(TRANSFER_SAME_S)}` : ": its passengers are sent across"}`;
    };
    this.about.set(id, [second.id, first.id]);
    this.ask({
      id, title: `${second.id} is due on ${track} at ${hm(this.span(second).a + 25)}, and ${first.id} will still be there. Which of them goes elsewhere?`,
      text: `As planned, ${second.id} stands at the entry signal until ${track} is free and the two trains' paths no longer cross. ${first.id} is expected on ${track} until about ${hm(this.span(first).b)}. `
        + `A train that is still to come can take another track; one that stops at the other platform sends its passengers across the station. G1 is the through track: a train on it crosses nobody at the island platform. `
        + `The signaller needs the word ${mins(TRACK_LEAD_S)} min before a train comes.`,
      options: [
        { id: "keep", label: `As planned: ${second.id} waits for ${track}` },
        ...moves.map((m) => ({ id: `${m.tr.id}>${m.to}`, label: `${m.tr.id} to ${m.to}`, hint: what(m) || undefined })),
      ],
      within: DECIDE_S.track, fallback: "keep",
      then: (o) => {
        this.about.delete(id);
        const [train, to] = String(o).split(">");
        const res = to ? this.track(train, to) : null;
        if (!res?.ok) this.log(`${clockAt(this.t)} ${second.id} keeps ${track}, behind ${first.id}${res ? `: ${res.reason}` : "."}`, "request");
      },
    });
  }

  /** A feeder comes late: how long shall the connecting train wait? A number of minutes. */
  _askWait(b, a) {
    const key = `${b.id}|${a.id}`;
    if (this._asked.has(key) || b.out_s != null) return;
    this._asked.add(key);
    const u = UNDERTAKINGS[b.ru], mid = this.needed(a, a.in_s), lo = this.needed(a, Math.max(0, a.in_s - a.spread_s)), hi = this.needed(a, a.in_s + a.spread_s);
    // the undertaking asks for what the forecast needs and a minute more
    b.wish_min ??= Math.min(WAIT_MAX_MIN, Math.ceil(mid / 60 + 1));
    b.rule_need_s = mid;
    const id = `wait-${b.id}`, next = this.trains.find((x) => x !== b && x.plan === b.plan && x.due > b.due && x.out_s == null);
    this.about.set(id, [b.id, a.id]);
    this.ask({
      id, title: `${a.id} comes about ${mins(a.in_s)} min late. How long shall ${b.id} wait for its passengers?`,
      text: `${u.who}, ${u.long}'s dispatcher, asks for up to ${b.wish_min} min: ${a.changers} want to change, ${b.aboard} are aboard ${b.id}. Who misses ${b.id} waits ${NEXT_TRAIN_MIN} min for the next train. `
        + `As the forecast stands, ${b.id} would have to wait about ${mins(mid)} min${a.spread_s ? ` (it may be ${mins(lo)} to ${mins(hi)})` : ""}: a wait that ends before ${a.id} is in costs the minutes and the connection. `
        + `The rule of the line gives ${WAIT_RULE_MIN} min; more only as far as the undertaking asks.${next ? ` ${next.id} is due on ${b.plan} at ${hm(next.arr ?? next.due)}.` : ""}`,
      scale: { min: 0, max: WAIT_MAX_MIN, step: WAIT_STEP_MIN, unit: "min", value: Math.min(WAIT_RULE_MIN, Math.ceil(mid / 30) / 2), label: `${b.id} waits at most` },
      within: DECIDE_S.wait, fallback: 0,
      then: (n) => this._order(b, a, n),
    });
  }

  /** A train will not be gone when the freight train planned behind it is due: how long shall the freight train wait to let it go first? Minutes, or however late it comes. */
  _askFirst(f, x) {
    const key = `${f.id}|${x.id}`;
    if (this._asked.has(key) || f.out_s != null || f.order?.for === x.id) return;
    this._asked.add(key);
    const id = `first-${f.id}`, to = f.dir > 0 ? "Talsee" : "Bergheim", late = x.in_s >= 60;
    const next = this.trains.find((y) => y !== f && y.plan === f.plan && y.due > f.due && y.out_s == null);
    const lost = mins(behind(f.kind, x.kind, 0));
    this.about.set(id, [f.id, x.id]);
    this.ask({
      id, title: late ? `${x.id} comes about ${mins(x.in_s)} min late; ${f.id} is on time. How long shall ${f.id} wait to let it go first?` : `${x.id} is still at its platform when ${f.id} is due. How long shall ${f.id} wait to let it go first?`,
      text: `If ${f.id} goes first, ${x.id} may crawl behind it to ${to}; if it waits, it ${next ? `blocks ${f.plan} for ${next.id}` : `stands on ${f.plan}`}. `
        + `By the timetable ${x.id} goes first and ${f.id} follows at ${hms(f.due)}. `
        + `${late && x.spread_s ? `The forecast may be off: ${x.id} may come ${mins(Math.max(0, x.in_s - x.spread_s))} to ${mins(x.in_s + x.spread_s)} min late. ` : ""}`
        + `Behind a freight train ${x.id} cannot pass before the loop at ${to}, 8 km on, and loses up to ${lost} min. `
        + `${next ? `${next.id} is due on ${f.plan} at ${hm(next.arr ?? next.due)}. ` : ""}`
        + `The rule of the line: a train on time goes before a late one; it may be asked to wait up to ${WAIT_RULE_MIN} min.`,
      scale: { min: 0, max: WAIT_MAX_MIN, step: WAIT_STEP_MIN, unit: "min", value: 0, label: `${f.id} waits at most` },
      options: [{ id: "after", label: `${x.id} first, however late it comes` }],
      within: DECIDE_S.first, fallback: "after",
      then: (o) => this._order(f, x, o === "after" ? WHATEVER_MIN : o),
    });
  }

  /* ---------------------------------------------------------------- the player's moves */

  /**
   * Order a train to wait for another, at most so many minutes beyond its own time (0: it does not
   * wait): for the other train's passengers, or to let it go first.
   * @param {string} train the train that waits
   * @param {string} other the train it waits for
   * @param {number} minutes
   * @returns {{ok: boolean, reason?: string}}
   */
  order(train, other, minutes) {
    const tr = this.train(train), x = this.train(other), n = Number(minutes);
    if (!tr || !x || tr === x) return { ok: false, reason: "There is no such pair of trains." };
    if (tr.out_s != null) return { ok: false, reason: `${tr.id} has left.` };
    if (x.out_s != null) return { ok: false, reason: `${x.id} has left: there is nothing to wait for.` };
    if (!this.others(tr).includes(x)) return { ok: false, reason: `${tr.id} cannot wait for ${x.id}: no passengers change between them, and ${x.id} is not before it on its way.` };
    if (!Number.isFinite(n) || n < 0 || n > WHATEVER_MIN) return { ok: false, reason: `A wait is between 0 and ${WAIT_MAX_MIN} min.` };
    // an order given answers the question about the same train, if one is open
    const kind = tr.stops && x.stops ? "wait" : "first";
    this.withdraw(`${kind}-${tr.id}`);
    this.about.delete(`${kind}-${tr.id}`);
    this._order(tr, x, n > WAIT_MAX_MIN ? WHATEVER_MIN : Math.round(n / WAIT_STEP_MIN) * WAIT_STEP_MIN);
    return { ok: true };
  }

  /**
   * Send a train that is still to come to another platform track than planned.
   * @param {string} train
   * @param {string} to the track ("G1")
   * @returns {{ok: boolean, reason?: string}}
   */
  track(train, to) {
    const tr = this.train(train);
    if (!tr) return { ok: false, reason: "There is no such train." };
    if (tr.out_s != null) return { ok: false, reason: `${tr.id} has left.` };
    if (!TRACKS_FROM[tr.dir].includes(to)) return { ok: false, reason: `No route leads ${tr.id} to ${to}.` };
    if (to === tr.plan) return { ok: false, reason: `${tr.id} is planned on ${to}.` };
    if (!this.movable(tr)) return { ok: false, reason: `Too late for ${tr.id}: the signaller sets its route ${mins(TRACK_LEAD_S)} min before it comes.` };
    if (!this.free(tr).includes(to)) return { ok: false, reason: `${to} is not expected free when ${tr.id} comes.` };
    const across = tr.stops && PLATFORMS[to] !== PLATFORMS[tr.plan];
    this.log(`${clockAt(this.t)} Order: ${tr.id} to ${to} instead of ${tr.plan}${across ? `: its passengers are sent to platform ${PLATFORMS[to]}` : ""}.`, "request");
    tr.plan = to;
    tr.moved = true;
    this._give({ train: tr.id, track: to });
    // passengers told of another platform at short notice
    if (across) this._good(tr.ru, GOODWILL.moved);
    this._mood(tr.ru);
    this._conflicts();
    return { ok: true };
  }

  /** The order goes to the signaller, and is checked against the rules of the line. */
  _order(tr, x, minutes) {
    const u = UNDERTAKINGS[tr.ru], until = Math.max(this.t, tr.due) + minutes * 60, passengers = tr.stops && x.stops;
    tr.order = { for: x.id, minutes, until, at: this.t };
    this.about.delete(`${passengers ? "wait" : "first"}-${tr.id}`);
    this._give({ hold: tr.id, for: x.id, minutes });
    this.log(`${clockAt(this.t)} Order: ${!minutes ? `${tr.id} does not wait for ${x.id}` : minutes >= WHATEVER_MIN ? `${tr.id} lets ${x.id} go first, however late it comes` : `${tr.id} waits for ${passengers ? `the passengers of ${x.id}` : x.id}, until ${hms(until)} at the latest`}.`, "request");
    // a connecting train held longer than the rule gives and than its undertaking asked for
    if (passengers && minutes > Math.max(WAIT_RULE_MIN, tr.wish_min ?? 0) && !tr.over_rule) {
      tr.over_rule = true;
      this.violate("waiting-time", `${clockAt(this.t)} ${tr.id} is held up to ${minutes} min: more than the ${WAIT_RULE_MIN} min of the rule, and more than ${u.long} asked for.`, 1);
    }
  }

  /** A dispatching order to the signaller: the session's, or the game's own. */
  _give(payload) {
    const msg = this.give("dispatching-order", payload);
    this.world?.receive({ ...msg, payload: { ...payload } });
  }

  /** What the computer's dispatcher would decide (a decision's id → an option or a number of minutes). */
  advice(id) {
    const d = this.open.find((x) => x.id === id), [one, two] = (this.about.get(id) ?? []).map((x) => this.train(x));
    if (id.startsWith("wait-") && one && two) {
      const need = this.needed(two, two.in_s) / 60;
      // the rule's three minutes where they are enough and the changers' half hour outweighs the minutes of those aboard
      const n = Math.min(WAIT_RULE_MIN, Math.ceil((need + 0.4) / WAIT_STEP_MIN) * WAIT_STEP_MIN);
      return need > 0 && need <= WAIT_RULE_MIN && one.aboard * need < two.changers * NEXT_TRAIN_MIN ? n : 0;
    }
    // a train on time does not wait for a late one; for one that is itself held, the rule's three minutes
    if (id.startsWith("first-") && two) return two.in_s >= 60 ? 0 : WAIT_RULE_MIN;
    // a freight train that would stand goes by a free track of its own; a train with passengers keeps its platform
    if (id.startsWith("track-")) return d?.options.find((o) => o.id.includes(">") && !this.train(o.id.split(">")[0])?.stops)?.id ?? "keep";
    if (id.startsWith("call-")) return "explain";
    if (id === "hours") return "effort";
    return d?.fallback ?? d?.options[0]?.id ?? null;
  }

  /* ---------------------------------------------------------------- what comes of it */

  /** Goodwill lost or won by an undertaking; below its marks it phones, then complains. */
  _good(ru, by) {
    const r = this.resources.get(`goodwill-${ru}`);
    r.value = Math.max(0, Math.min(100, r.value + by));
  }

  /** A train has left the station (or passed it), so late: what was added in the area, and what its undertaking makes of it. */
  _left(tr, late_s, at = tr.due + late_s) {
    if (tr.out_s != null) return;
    const u = UNDERTAKINGS[tr.ru];
    tr.out_s = late_s;
    tr.left_at = at;
    tr.waiting_s = null;
    // behind a slower train to the next loop
    for (const s of this.trains.filter((x) => x !== tr && x.dir === tr.dir && x.out_s != null)) {
      const lost = behind(s.kind, tr.kind, at - s.left_at);
      if (lost > tr.knock_s) Object.assign(tr, { knock_s: Math.round(lost + (lost > 0 ? this.rng("behind", tr.id).int(40) : 0)), slow: s.id });
    }
    if (tr.knock_s >= 30) {
      this.log(`${clockAt(this.t)} ${tr.id} runs behind ${tr.slow} as far as the next loop: about ${mins(tr.knock_s)} min more.`, "train");
      this.irregular("followed", `followed:${tr.id}`, { train: tr.id, slow: tr.slow, min: mins(tr.knock_s) });
    }
    // a freight train whose driver is short of time
    if (this.hours?.train === tr.id && this.added(tr) > HOURS.stand_min && this.rng("hours", tr.id).next() < HOURS.chance) {
      tr.aside = true;
      this.log(`${clockAt(this.t)} ${tr.id} is put aside at the next station: its driver's time is up, and another driver must come.`, "fault");
      this.irregular("put-aside", `aside:${tr.id}`, { train: tr.id });
    }
    // a connection: was the wait enough for the feeder's passengers?
    const a = !tr.feeder && tr.partner ? this.train(tr.partner) : null, waited = a && tr.order?.for === a.id && tr.order.minutes > 0;
    // (the feeder was in, and its passengers had the time to change before this train left)
    if (a) tr.kept = a.arrived_at != null && at >= a.arrived_at + this.change(a, tr);
    const added = this.added(tr), stood = added - (tr.aside ? HOURS.aside_min : 0);
    // the minutes of a wait its own undertaking asked for, and that kept the connection, are mostly its own
    const asked = waited && tr.kept && tr.order.minutes <= (tr.wish_min ?? 0);
    if (added < 0.5) this._good(tr.ru, GOODWILL.on_time);
    else this._good(tr.ru, -(stood * u.minute * (asked ? ASKED : 1) + (!asked && u.late_from_min && late_s / 60 >= u.late_from_min ? u.late : 0) + (tr.aside ? u.aside ?? 0 : 0)));
    tr.why = tr.aside ? "aside" : tr.knock_s >= 30 ? "behind" : "late";
    // an on-time train that waited for a late one of another undertaking beyond the rule: the orders left the rules of the line
    const x = tr.order && this.train(tr.order.for), limit = tr.order?.minutes ?? (tr.kind === "GZ" ? WHATEVER_MIN : 0);
    if (tr.in_s < 60 && !tr.stops && added > WAIT_RULE_MIN + 0.5 && limit > WAIT_RULE_MIN && (!x || x.ru !== tr.ru)) this.deviations[tr.ru]++;
    if (a && !tr.kept) {
      this._good(tr.ru, -(u.missed + a.changers * u.changer));
      this.log(`${clockAt(this.t)} ${tr.id} has left without the ${a.changers} passengers of ${a.id}: they wait ${NEXT_TRAIN_MIN} min.`, "train");
      tr.why = "missed";
      // less than the forecast needed, where the rule's wait would have been enough by the forecast
      if (tr.rule_need_s != null && tr.rule_need_s <= WAIT_RULE_MIN * 60 && (tr.order?.minutes ?? 0) * 60 + SLACK_S < tr.rule_need_s) this.deviations[tr.ru]++;
      if (waited && late_s >= 30) this.irregular("wait-wasted", `wasted:${tr.id}`, { train: tr.id, feeder: a.id, min: mins(late_s) });
    } else if (a && this.needed(a, a.in_s) > 0) this._good(tr.ru, GOODWILL.on_time);
    // a promise of a clear run
    for (const p of this.promises.filter((y) => y.train === tr.id && y.kept == null)) {
      p.kept = added <= PROMISE_MIN;
      if (p.kept) {
        this._good(tr.ru, GOODWILL.on_time * 3);
        this.log(`${clockAt(this.t)} ${tr.id} had its clear run: the promise to ${u.who} is kept.`, "request");
      } else {
        this._good(tr.ru, GOODWILL.broken);
        this.violate("promise", `${clockAt(this.t)} ${tr.id} was promised a clear run and got ${mins(added * 60)} min more: a promise to ${u.long} not kept.`, 2);
        this.irregular("promise-broken", `promise:${tr.id}`, { who: u.who, train: tr.id });
      }
    }
    this.last = { ...(this.last ?? {}), [tr.ru]: tr.id };
    this._mood(tr.ru);
    this._conflicts();
  }

  /** The minutes added to a train in the area: how late it left less how late it came, and what it loses beyond (min). */
  added(tr) {
    const out = tr.out_s ?? Math.max(0, Math.min(this.t, this.length) - tr.due, tr.waiting_s ?? 0);
    if (tr.out_s == null && this.t < tr.due) return 0;
    // (a train that leaves within half a minute of its time, or of the time it could have made, is on time)
    const here = Math.max(0, out - tr.in_s);
    return (here < ON_TIME_S ? 0 : here) / 60 + tr.knock_s / 60 + (tr.aside ? HOURS.aside_min : 0);
  }

  /** An undertaking below its marks: it phones (once), then it files a complaint (once). */
  _mood(ru) {
    const u = UNDERTAKINGS[ru], g = this.value(`goodwill-${ru}`);
    if (g < GOODWILL.complaint && !this.complaints.some((c) => c.undertaking === ru)) {
      const upheld = this.deviations[ru] > 0;
      this.complaints.push({ undertaking: ru, upheld, t: this.t });
      // (who has written to the regulator does not phone any more)
      this.called.add(ru);
      if (this.withdraw(`call-${ru}`)) this.about.delete(`call-${ru}`);
      if (upheld) this.violate("discrimination", `${clockAt(this.t)} ${u.who} of ${u.long} files a complaint with the regulator, and it is upheld: an on-time train of theirs was made to wait beyond the rules of the line.`, 2);
      else this.log(`${clockAt(this.t)} ${u.who} of ${u.long} files a complaint with the regulator. It finds your orders within the rules of the line.`, "request");
      this.irregular("complaint", `complaint:${ru}`, { who: u.who, undertaking: u.long, verdict: upheld ? "upheld" : "not upheld" });
    } else if (g < GOODWILL.call && !this.called.has(ru)) this._call(ru);
  }

  /** An undertaking phones: explain, promise, or say sorry. */
  _call(ru) {
    const u = UNDERTAKINGS[ru], tr = this.train(this.last?.[ru]), id = `call-${ru}`;
    this.called.add(ru);
    const a = tr && !tr.feeder && tr.partner ? this.train(tr.partner) : null;
    const says = !tr ? "This is not how we were told the line is run."
      : tr.why === "missed" ? `${a?.changers ?? "Our"} passengers stand on the platform for half an hour because ${tr.id} did not wait.`
      : tr.why === "aside" ? `${tr.id} is put aside without a driver. That is a day's work lost.`
      : tr.why === "behind" ? `${tr.id} is crawling behind a freight train. ${tr.aboard} people are aboard.`
      : tr.kind === "GZ" ? `${tr.id} stood ${mins(this.added(tr) * 60)} min for somebody else's train. What do I tell my customer?`
      : `${tr.id} left ${mins(tr.out_s)} min late, and not for our doing.`;
    const next = this.trains.find((x) => x.ru === ru && x.out_s == null && !this.promises.some((p) => p.train === x.id) && x.enter > this.t - 60);
    this.about.set(id, tr ? [tr.id] : []);
    this.log(`${clockAt(this.t)} ${u.who}, ${u.long}'s dispatcher, is on the phone.`, "request");
    this.ask({
      id, title: `${u.who}, ${u.long}'s dispatcher, is on the phone: “${says}”`,
      text: `The goodwill of ${u.long} is at ${this.goodwill(ru)} of 100. An explanation is taken where your orders kept the rules of the line, mostly. A promise helps now, and binds you: ${next ? `${next.id} (${hm(next.due)}) must then get through with no more than ${PROMISE_MIN} min added` : "there is no later train of theirs to promise for"}. Below ${GOODWILL.complaint} an undertaking writes to the regulator.`,
      options: [
        { id: "explain", label: "Explain your orders by the rules of the line" },
        ...(next ? [{ id: "promise", label: `Promise ${next.id} a clear run` }] : []),
        { id: "sorry", label: "Say sorry and get back to the trains" },
      ],
      within: DECIDE_S.call, fallback: "sorry",
      then: (o) => {
        this.about.delete(id);
        if (o === "promise" && next) {
          this.promises.push({ undertaking: ru, train: next.id, kept: null });
          this._good(ru, GOODWILL.promise);
          this.log(`${clockAt(this.t)} Promised to ${u.who}: ${next.id} gets a clear run.`, "request");
        } else if (o === "explain") {
          const taken = this.rng("call", ru).next() < (this.deviations[ru] ? ACCEPT.left : ACCEPT.kept);
          this._good(ru, taken ? GOODWILL.explained : GOODWILL.refused);
          this.log(`${clockAt(this.t)} ${u.who}: "${taken ? "Fair enough. By the rules, then." : "That is not what your network statement says."}"`, "request");
        } else {
          this._good(ru, GOODWILL.sorry);
          this.log(`${clockAt(this.t)} ${u.who}: "Sorry does not move my train."`, "request");
        }
      },
    });
  }

  /** The freight undertaking phones about its driver's time: promise a clear run, promise to try, or refuse. */
  _hours() {
    const h = this.hours, tr = this.train(h.train), u = UNDERTAKINGS[tr.ru];
    h.asked = true;
    if (tr.out_s != null) return;
    const x = this.before(tr).filter((y) => y.kind !== tr.kind).at(-1), on = this.trains.find((y) => y !== tr && y.plan === tr.plan && y.due < tr.due && y.out_s == null);
    this.about.set("hours", [tr.id]);
    this.log(`${clockAt(this.t)} ${u.who}, ${u.long}'s dispatcher, is on the phone about ${tr.id}.`, "request");
    this.ask({
      id: "hours", title: `${u.who}, ${u.long}'s dispatcher, is on the phone: “The driver of ${tr.id} is near the end of the driving time. Can we count on a run through Neustadt without a stop?”`,
      text: `If ${tr.id} loses more than ${HOURS.stand_min} min here, its driver may not reach the relief, and the train is put aside. It then stands at the next station until another driver comes. ${tr.id} comes at ${hm(tr.enter)} and is due through ${tr.plan} at ${hms(tr.due)}. `
        + `${on ? `${on.id} uses ${tr.plan} before it. ` : ""}${x ? `${x.id} goes the same way before it, if it has left by then. ` : ""}A promise binds you: no more than ${PROMISE_MIN} min added. What you promise to one, another train may have to pay.`,
      options: [
        { id: "promise", label: `Promise ${tr.id} a clear run` },
        { id: "effort", label: "Promise to try, and no more" },
        { id: "no", label: `Refuse: ${tr.id} runs as the morning allows` },
      ],
      within: DECIDE_S.call, fallback: "effort",
      then: (o) => {
        this.about.delete("hours");
        h.answer = o;
        if (o === "promise") {
          this.promises.push({ undertaking: tr.ru, train: tr.id, kept: null });
          this._good(tr.ru, GOODWILL.promise);
          this.log(`${clockAt(this.t)} Promised to ${u.who}: ${tr.id} gets a clear run.`, "request");
        } else if (o === "no") {
          this._good(tr.ru, GOODWILL.declined);
          this.log(`${clockAt(this.t)} ${u.who}: "Then it is on you if the driver does not make it."`, "request");
        } else this.log(`${clockAt(this.t)} ${u.who}: "Trying is not a clear run. But all right."`, "request");
      },
    });
  }

  /* ---------------------------------------------------------------- the game's step */

  tick(dt) {
    // alone: the morning itself, with the computer's signaller
    if (this.world && !this.world.over) {
      this._pilot.think(this.world);
      this.world.step(dt);
      for (const msg of this.world.outbox.slice(this._read)) if (msg.flow === "delay-notice") this._noticed(msg.payload);
      this._read = this.world.outbox.length;
    }
    if (this.hours && !this.hours.asked && this.t >= this.hours.at) this._hours();
    // (a train held by an order may still be there when the freight train behind it comes)
    if (Math.floor(this.t / 15) !== Math.floor((this.t - dt) / 15)) this._conflicts();
    // questions whose trains have left are taken back
    for (const d of this.open) {
      const [one] = (this.about.get(d.id) ?? []).map((x) => this.train(x));
      if ((d.id.startsWith("wait-") || d.id.startsWith("first-") || d.id.startsWith("track-") || d.id === "hours") && one?.out_s != null) {
        this.withdraw(d.id);
        this.about.delete(d.id);
      }
    }
    if (this.t >= this.length) this.end(`${hm(this.length)}: the shift is over.`);
    else if (this.trains.every((tr) => tr.out_s != null) && !this.open.length) this.end(`${clockAt(this.t)} All trains have left the area.`);
  }

  /* ---------------------------------------------------------------- the account */

  /** The connections of the morning: kept, missed, or open while the connecting train stands. */
  connections() {
    return CONNECTIONS.map(([a, b]) => [this.train(a), this.train(b)]).filter(([a, b]) => a && b).map(([a, b]) => ({ from: a.id, to: b.id, changers: a.changers, kept: b.kept }));
  }

  /** The morning in numbers: the minutes added in the area (by undertaking), the connections, the goodwill, the rules. */
  account() {
    const by = Object.fromEntries(Object.keys(UNDERTAKINGS).map((ru) => [ru, 0]));
    let added = 0;
    for (const tr of this.trains) {
      const m = this.added(tr);
      added += m;
      by[tr.ru] += m;
    }
    const cons = this.connections().filter((c) => c.kept != null), all = cons.reduce((s, c) => s + c.changers, 0);
    const good = Object.fromEntries(Object.keys(UNDERTAKINGS).map((ru) => [ru, this.goodwill(ru)]));
    const round = (v) => Math.round(v * 10) / 10;
    return {
      added_min: round(added), by: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, round(v)])), trains: this.trains.length,
      connections: cons.length, kept: cons.filter((c) => c.kept).length, changers: all, changed: cons.filter((c) => c.kept).reduce((s, c) => s + c.changers, 0),
      goodwill: good, lowest: Math.min(...Object.values(good)), complaints: this.complaints.length, upheld: this.complaints.filter((c) => c.upheld).length,
      promises: this.promises.length, broken: this.promises.filter((p) => p.kept === false).length,
    };
  }

  /** The shift's account for the performance regime and the district. */
  finish() {
    const a = this.account();
    this.give("performance-report", {
      scope: "Dispatching at Bf Neustadt", kind: "dispatching", trains: a.trains, delay_added_min: a.added_min, delay_by: a.by,
      connections: a.connections, connections_kept: a.kept, goodwill: a.goodwill, complaints: a.complaints, complaints_upheld: a.upheld, promises_broken: a.broken,
      violations: this.violations.length, score: this.score().total,
    });
  }

  objectives() {
    const a = this.account(), g = Object.values(a.goodwill), mean = g.reduce((s, v) => s + v, 0) / g.length;
    const sev = this.violations.reduce((s, v) => s + (v.severity >= 3 ? 1 : v.severity === 2 ? 0.5 : 0.15), 0);
    const names = Object.entries(UNDERTAKINGS).map(([ru, u]) => `${u.name} ${a.goodwill[ru]}`).join(", ");
    return [
      { id: "delay", label: "Delay added", weight: 30, value: 1 - a.added_min / a.trains / DELAY_NONE_MIN, note: `${a.added_min} min added to ${a.trains} trains in your area: ${Object.entries(UNDERTAKINGS).map(([ru, u]) => `${u.name} ${a.by[ru]}`).join(", ")}` },
      { id: "connections", label: "Connections", weight: 20, value: a.changers ? a.changed / a.changers : 1, note: a.connections ? `${a.kept} of ${a.connections} connections kept: ${a.changed} of ${a.changers} passengers got their train` : "none decided yet" },
      // the one who waits most counts most: an order that is good for two of three is not good enough
      { id: "undertakings", label: "The undertakings", weight: 30, value: (0.6 * a.lowest + 0.4 * mean) / 100, note: `goodwill of 100: ${names}` },
      { id: "rules", label: "Rules and promises", weight: 20, value: 1 - sev, note: `${a.upheld} complaints upheld, ${a.broken} promises not kept, ${this.violations.filter((v) => v.rule === "waiting-time").length} waits beyond the rule` },
    ];
  }

  /* ---------------------------------------------------------------- for a page */

  view() {
    const a = this.account();
    const tone = (v) => (v < GOODWILL.complaint ? "bad" : v < GOODWILL.call ? "warn" : "ok");
    const orderable = this.trains.filter((tr) => this.others(tr).length);
    const targets = [...new Set(orderable.flatMap((tr) => this.others(tr)))], movable = this.trains.filter((tr) => this.movable(tr));
    const state = (tr) => (tr.out_s != null ? (tr.aside ? "put aside" : `left${tr.out_s >= 60 ? ` +${mins(tr.out_s)}` : ""}`) : tr.waiting_s != null ? "stands beyond its time" : tr.told_s != null ? `announced +${mins(tr.in_s)}${tr.spread_s ? ` (±${mins(tr.spread_s)})` : ""}` : this.t >= tr.enter ? "in the station" : "to come");
    const said = (tr) => (!tr.order ? "–" : !tr.order.minutes ? `does not wait for ${tr.order.for}` : tr.order.minutes >= WHATEVER_MIN ? `after ${tr.order.for}` : `for ${tr.order.for} until ${hms(tr.order.until)}`);
    return {
      sketch: this._sketch(),
      figures: [
        { label: "Delay added", value: a.added_min, unit: "min", tone: a.added_min / a.trains > 1.5 ? "bad" : a.added_min ? "warn" : "ok" },
        ...Object.entries(UNDERTAKINGS).map(([ru, u]) => ({ label: u.name, value: a.goodwill[ru], tone: tone(a.goodwill[ru]) })),
      ],
      tables: [
        {
          id: "trains", title: "The trains", columns: ["Train", "Undertaking", "Track", "Time", "Now", "Order", "Added"],
          rows: this.trains.map((tr) => [tr.id, UNDERTAKINGS[tr.ru].name, tr.plan, tr.stops ? hm(tr.due) : `${hms(tr.due)} pass`, state(tr), said(tr), this.added(tr) >= 0.1 ? `+${mins(this.added(tr) * 60)}` : "–"]),
        },
        {
          id: "undertakings", title: "The undertakings", columns: ["Undertaking", "On the phone", "Goodwill", "Minutes added", "Promised"],
          rows: Object.entries(UNDERTAKINGS).map(([ru, u]) => [u.name, u.who, `${a.goodwill[ru]} of 100`, a.by[ru], this.promises.filter((p) => p.undertaking === ru).map((p) => `${p.train}: ${p.kept == null ? "open" : p.kept ? "kept" : "not kept"}`).join("; ") || "–"]),
        },
        { id: "connections", title: "Connections", columns: ["From", "To", "Change", "State"], rows: this.connections().map((c) => [c.from, c.to, c.changers, c.kept == null ? "open" : c.kept ? "kept" : "missed"]) },
      ],
      actions: [
        {
          name: "order", label: "Order a train to wait", primary: true, hint: "A train waits for another, at most so many minutes beyond its own time: for its passengers, or to let it go first. 0: it does not wait.",
          disabled: orderable.length ? undefined : "No train can be ordered to wait just now.",
          fields: [
            { id: "train", label: "Train", options: orderable.map((tr) => ({ id: tr.id, label: tr.id })) },
            { id: "other", label: "Waits for", options: targets.map((tr) => ({ id: tr.id, label: tr.id })) },
            { id: "minutes", label: "At most", type: "number", min: 0, max: WAIT_MAX_MIN, step: WAIT_STEP_MIN, value: WAIT_RULE_MIN, unit: "min" },
          ],
        },
        ...(movable.length ? [{
          name: "track", label: "Send a train to another track", hint: `A train that is still to come takes another platform track than planned. The signaller needs the word ${mins(TRACK_LEAD_S)} min before it comes.`,
          fields: [
            { id: "train", label: "Train", options: movable.map((tr) => ({ id: tr.id, label: `${tr.id} (planned ${tr.plan})` })) },
            { id: "to", label: "To", options: Object.keys(PLATFORMS).map((g) => ({ id: g, label: `${g}, platform ${PLATFORMS[g]}` })) },
          ],
        }] : []),
      ],
    };
  }

  /** What is known of a train, in words. */
  _about(tr) {
    const parts = [`${UNDERTAKINGS[tr.ru].name}, ${tr.plan}, ${tr.stops ? `departs ${hm(tr.due)}` : `passes ${hms(tr.due)}`}`];
    if (tr.out_s != null) parts.push(tr.aside ? "put aside beyond the station" : tr.out_s >= 60 ? `left ${mins(tr.out_s)} min late` : "left on time");
    else if (tr.told_s != null) parts.push(`about ${mins(tr.in_s)} min late${tr.spread_s ? `, give or take ${mins(tr.spread_s)}` : ""}`);
    if (tr.out_s == null && tr.order) parts.push(!tr.order.minutes ? `does not wait for ${tr.order.for}` : tr.order.minutes >= WHATEVER_MIN ? `lets ${tr.order.for} go first` : `waits for ${tr.order.for} until ${hms(tr.order.until)}`);
    if (this.added(tr) >= 0.5) parts.push(`${mins(this.added(tr) * 60)} min added here`);
    return `${tr.id}: ${parts.join("; ")}`;
  }

  /** The moves offered from a train: a minute more or no wait for its feeder; before or after a train ahead of it. */
  _menu(tr) {
    const menu = [];
    for (const x of this.others(tr)) {
      const cur = tr.order?.for === x.id ? tr.order.minutes : null;
      if (tr.stops && x.stops) {
        const more = Math.min(WAIT_MAX_MIN, (cur ?? 0) + 1);
        if (more > (cur ?? 0)) menu.push({ label: `Wait for ${x.id}: ${more} min at most`, name: "order", args: [tr.id, x.id, more], target: `train-${x.id}` });
        if (cur) menu.push({ label: `Do not wait for ${x.id}`, name: "order", args: [tr.id, x.id, 0] });
      } else {
        if (cur !== 0) menu.push({ label: `Go at its time, before ${x.id}`, name: "order", args: [tr.id, x.id, 0] });
        if (cur == null || cur < WAIT_RULE_MIN) menu.push({ label: `Wait ${WAIT_RULE_MIN} min for ${x.id}`, name: "order", args: [tr.id, x.id, WAIT_RULE_MIN] });
        if (cur != null && cur < WHATEVER_MIN) menu.push({ label: `Let ${x.id} go first`, name: "order", args: [tr.id, x.id, WHATEVER_MIN], target: `train-${x.id}` });
      }
    }
    if (this.movable(tr)) for (const to of this.free(tr)) menu.push({ label: `To ${to} instead of ${tr.plan}`, name: "track", args: [tr.id, to] });
    return menu;
  }

  /**
   * The tracks of the station over the morning, as a sketch for a page that does not know the game:
   * a row for each platform track, the time from left to right; for every train the time it is
   * planned on its track (a thin line) and the time it is expected there now (a thick one: green as
   * planned, orange late, red where two trains are expected on one track at once), and a line at
   * now. A train is a tag at the start of its time: one a question is about pulses, and its orders
   * are its moves.
   */
  _sketch() {
    const W = 640, left = 44, right = 14, top = 34, row = 46, items = [];
    const x = (t) => Math.round((left + (Math.max(0, Math.min(this.length, t)) / this.length) * (W - left - right)) * 10) / 10;
    const tracks = ["G3", "G2", "G1"], y = (track) => top + 30 + row * tracks.indexOf(track);
    for (let t = 0; t <= this.length; t += 300) {
      items.push({ kind: "text", x: x(t), y: 16, anchor: "middle", small: true, tone: "muted", text: hm(t) });
      items.push({ kind: "line", x1: x(t), y1: 24, x2: x(t), y2: top + row * tracks.length + 4, thin: true, faint: true });
    }
    for (const track of tracks) items.push({ kind: "text", x: 8, y: y(track) + 10, text: track });
    const asked = new Set([...this.about.entries()].filter(([id]) => this.open.some((d) => d.id === id)).flatMap(([, ids]) => ids));
    // (in the order of their times, so that the tags of a track stand side by side where their times are close)
    const spans = this.trains.map((tr) => this.span(tr)).sort((a, b) => a.a - b.a), end = {};
    for (const s of spans) {
      const { tr } = s, yy = y(tr.plan), gone = tr.out_s != null, planned = this.span(tr, 0);
      const clash = !gone && spans.some((o) => o !== s && o.tr.plan === tr.plan && o.tr.out_s == null && o.a < s.a && o.b + BETWEEN_S > s.a);
      items.push({ kind: "line", x1: x(planned.a), y1: yy + 18, x2: x(planned.b), y2: yy + 18, thin: true, faint: true });
      items.push({ kind: "line", x1: x(s.a), y1: yy + 10, x2: x(s.b), y2: yy + 10, tone: gone ? "muted" : clash ? "occupied" : this.expect(tr) - tr.due >= 60 ? "warn" : "route", faint: gone });
      const tx = Math.min(Math.max(x(s.a), (end[tr.plan] ?? 0) + 4), W - right - TAG_PX(tr.id));
      end[tr.plan] = tx + TAG_PX(tr.id);
      items.push({
        id: `train-${tr.id}`, kind: "tag", x: tx, y: yy - 8, anchor: "start", text: tr.id,
        tone: gone ? "idle" : tr.order && tr.order.minutes > 0 ? "ok" : clash || this.expect(tr) - tr.due >= 60 ? "warn" : undefined,
        alert: asked.has(tr.id) && !gone ? "warn" : undefined, title: this._about(tr), menu: gone ? undefined : this._menu(tr),
      });
    }
    const now = x(this.t);
    items.push({ kind: "line", x1: now, y1: 24, x2: now, y2: top + row * tracks.length + 4, thin: true, tone: "route" });
    return {
      title: "The tracks", width: W, height: top + row * tracks.length + 14,
      label: "The platform tracks G3, G2 and G1 of Bf Neustadt from 08:00 to 08:40: for every train when it is planned on its track and when it is expected there now; a line marks the time now",
      items,
    };
  }
}
