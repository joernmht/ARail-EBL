/**
 * The undertaking's operations control (Disponent/in in der Transportleitung), "Transportleitung":
 * the morning of the signaller's game (08:00 to 08:40 at Bf Neustadt) from the railway
 * undertaking's side. The regional trains RB 31 to RB 36 are its trains; the pairs RB 31 → 32,
 * 33 → 34 and 35 → 36 are connections at platform 2.
 *
 * Three things compete for the dispatcher's attention. A feeder is announced late: ask the
 * infrastructure manager to hold the connecting train, or let it go (who misses it waits half an
 * hour; who sits in a held train loses the minutes, and a trip that leaves four minutes late costs a
 * penalty). Every delay of three minutes or more must be told to the passengers, quickly. And the
 * undertaking's own trouble comes in for the trains later in the day: a driver calls in sick, a
 * unit reports a defect; each has a lawful way out and a tempting one (a driver without the rest
 * time, a unit that may not carry passengers).
 *
 * In a session the delays arrive as flows from the signaller or the lab, the wish to hold a train
 * goes out as a connection request, and the transport contract's penalty catalogue comes from the
 * transport authority. Alone, the game brings the morning's delays itself and plays the
 * infrastructure manager: a hold asked for is kept.
 *
 * Simplified: the connection's arithmetic is that of the signaller's game (a train needs 137 s
 * from the edge of the panel to its platform, changing at one platform takes 30 s); passengers are
 * counted per train, not followed.
 * @module arail/game/transport-control
 */
import { Game, Player, clockAt } from "./core.js";
import { CONNECTIONS, DWELL_S, TIMETABLE } from "./signaller.js";

/** The penalty catalogue where no transport authority gives one (the role catalogue's illustrative values). */
export const CONTRACT = { cancel_eur_km: 12, late_eur: 40, short_eur_km: 4, late_from_min: 4 };
/** The length of a trip (km): line 6250 from Bergheim via Bf Neustadt to Talsee and on. */
export const LINE_KM = 30;
/** Who misses a train waits for the next (min). */
export const NEXT_TRAIN_MIN = 30;
/** A train's run from the edge of the signaller's panel to its stop at the platform (s), as the signaller's game runs it. */
export const RUN_S = 137;
/** Changing between two trains at one platform (s). */
export const CHANGE_S = 30;
/** Passenger information: due from this delay (min); full marks when published within, none beyond (s). */
export const INFO = { from_min: 3, good_s: 120, bad_s: 600 };
/** The rest a driver must have had between two shifts (h; simplified from the working-time law). */
export const REST_H = 11;
/** Time to decide (s): on a connection, on the undertaking's own trouble. */
export const DECIDE_S = { hold: 60, own: 240 };
/** What a short-formed train costs each of its passengers, counted as minutes. */
export const SHORT_MIN = 3;
/** A late train is told this long before its planned time on the signaller's panel (s), as the signaller's game does. */
const FORECAST_S = 120;

/**
 * Levels: the delays the game brings itself when no signaller tells them (train, minutes), how much
 * trouble of its own, and the reserves.
 */
export const LEVELS = {
  training: { label: "Training: one late train, no trouble of your own", late: [["RB 31", 3]], own: 0, standby: 1, spare: 1 },
  normal: { label: "Normal: late trains, a sick call and a defect", late: [["RB 31", 3], ["RB 33", 6], ["RB 35", 2]], own: 2, standby: 1, spare: 1 },
  hard: { label: "Hard: later trains, more trouble than reserves", late: [["RB 31", 4], ["RB 33", 7], ["RB 35", 3]], own: 4, standby: 1, spare: 1 },
};

/** The undertaking's own trouble, for trains later in the day (people are named with birds, see CONTRIBUTING.md). */
const TROUBLE = [
  { id: "sick-37", kind: "sick", train: "RB 37", text: "The driver of RB 37 (09:10 from Bergheim) has called in sick.", driver: "F. Zeisig" },
  { id: "unit-38", kind: "unit", train: "RB 38", text: "The unit for RB 38 (09:40) reports a door that does not lock.", safe: false, defect: "a door that does not lock: the unit may not carry passengers" },
  { id: "sick-39", kind: "sick", train: "RB 39", text: "The driver of RB 39 (10:10 from Talsee) is stuck on a late train and will not make it.", driver: "K. Dohle" },
  { id: "unit-40", kind: "unit", train: "RB 40", text: "The unit for RB 40 (10:40) reports a failed air conditioning in one car.", safe: true, defect: "a failed air conditioning in one car: not safety-relevant" },
];

/**
 * The computer's dispatcher: holds a connection when the changers' half hour outweighs the held
 * passengers' minutes and the penalty, informs at once, and takes the lawful and cheapest way out
 * of its own trouble.
 */
export class TransportControlPlayer extends Player {
  /** @param {TransportControlGame} g */
  think(g) {
    for (const d of g.open) g.act("decide", d.id, g.advice(d.id));
    for (const tr of g.pending()) g.act("inform", tr.id);
  }
}

export class TransportControlGame extends Game {
  static id = "transport-control";
  static title = "Transportleitung";
  static role = "ru-control-dispatcher";
  static kind = "simulation";
  static description = "The morning from the railway undertaking's side: hold a connection or let the train go, tell the passengers of every delay, and find a lawful way out when a driver calls in sick or a unit reports a defect.";
  static scale = "minutes";
  // the morning's trains through Bf Neustadt are bound to it
  static clock = "08:00";
  static takes = [
    { flow: "delay-notice" },
    { flow: "transport-contract" },
  ];
  static gives = [
    { flow: "connection-request" },
    { flow: "passenger-information" },
    { flow: "performance-report" },
  ];
  static actions = {
    ...Game.actions,
    inform: { label: "Publish passenger information" },
  };
  static player = TransportControlPlayer;

  /** @param {{seed?: number, level?: keyof LEVELS, conditions?: object, wired?: Iterable<string>, length?: number}} [options] */
  constructor(options = {}) {
    super({ ...options, level: LEVELS[options.level] ? options.level : "normal" });
    const lv = LEVELS[this.level];
    this.length = options.length ?? 2400;
    /** The penalty catalogue of the transport contract. */
    this.contract = { ...CONTRACT, ...(this.conditions["transport-contract"] ?? {}) };
    const r = this.rng("passengers");
    /**
     * The undertaking's trains of the morning: planned departure (s), passengers aboard, for a
     * feeder the passengers who change to its `partner`; what is known of its delay.
     * @type {Array<object>}
     */
    this.trains = TIMETABLE.filter((x) => x.kind === "RB").map((x) => {
      const pair = CONNECTIONS.find((c) => c.includes(x.id));
      return {
        id: x.id, dep: x.dep, enter: x.enter, aboard: 60 + r.int(100), feeder: pair?.[0] === x.id, partner: pair ? pair.find((id) => id !== x.id) : null,
        changers: pair?.[0] === x.id ? 8 + r.int(30) : 0, delay_min: null, left_min: null, held: null, info_since: null, informed: null, info_text: "",
      };
    });
    /** The delays the game brings itself (alone): train → seconds; and what follows from them, at their times. */
    this.own = !this.isWired("delay-notice");
    this._script = [];
    if (this.own) {
      for (const [id, min] of lv.late) {
        const tr = this.train(id), late = (min + this.rng("late", id).int(2)) * 60;
        this._script.push({ at: Math.max(0, tr.enter - FORECAST_S), run: () => this._noticed({ train: id, kind: "RB", stage: "approaching", delay_min: late / 60, connection: tr.partner }) });
        tr._late = late;
      }
    }
    /** The undertaking's own trouble of the shift, each a decision when its time comes. */
    const pool = TROUBLE.slice(0, lv.own);
    this.trouble = pool.map((x, i) => ({
      ...x, at: Math.round((0.12 + 0.7 * ((i + this.rng("trouble", x.id).next()) / Math.max(1, pool.length))) * this.length),
      passengers: 80 + this.rng("trouble", x.id, "pax").int(60), rest_h: 8 + this.rng("trouble", x.id, "rest").int(8), asked: false, choice: null,
    }));
    this.resource("standby", "Stand-by drivers", lv.standby);
    this.resource("spare", "Spare units", lv.spare);
    this.resource("penalties", "Penalties", 0, "€");
    /** Passenger minutes lost through this desk's decisions: by missed connections, held trains, cancelled and short-formed trains. */
    this.lost = { missed: 0, held: 0, cancelled: 0, short: 0 };
    /** Train-km cancelled and run short-formed. */
    this.km = { cancelled: 0, short: 0 };
    this.log(`${clockAt(0)} The shift begins: ${this.trains.length} regional trains through Bf Neustadt until 08:40, ${lv.standby} stand-by driver${lv.standby === 1 ? "" : "s"} and ${lv.spare} spare unit${lv.spare === 1 ? "" : "s"}.`);
  }

  /** A train of the morning by its id. */
  train(id) {
    return this.trains.find((x) => x.id === id);
  }

  /** How long the connecting train would have to wait for a feeder that comes `late_s` late (s; 0: the connection holds anyway). */
  needed(feeder, late_s) {
    const b = this.train(feeder.partner);
    const slack = b.dep - (feeder.enter + RUN_S) - CHANGE_S;
    return Math.max(0, late_s - slack);
  }

  /** The trains whose passengers have not been told yet. */
  pending() {
    return this.trains.filter((tr) => tr.info_since != null && tr.informed == null);
  }

  /* ---------------------------------------------------------------- what comes in */

  take(msg) {
    if (msg.flow === "transport-contract") this.contract = { ...CONTRACT, ...msg.payload };
    else if (msg.flow === "delay-notice") this._noticed(msg.payload ?? {});
  }

  /** A delay notice: from the signaller or the lab, or the game's own. */
  _noticed(p) {
    const tr = this.train(p.train);
    // other undertakings' trains (the intercity, the freight trains) are not this desk's
    if (!tr) return;
    const min = Math.round((p.delay_min ?? 0) * 10) / 10;
    tr.delay_min = Math.max(tr.delay_min ?? 0, min);
    if (p.stage === "departed" || p.stage === "passed") tr.left_min = min;
    this.log(`${clockAt(this.t)} ${tr.id} ${p.stage === "approaching" ? `comes about ${min} min late` : p.stage === "waiting" ? `stands at its platform, ${min} min beyond its time` : `left ${min} min late`}${p.cause ? ` (${p.cause})` : ""}.`, "train");
    if (min >= INFO.from_min) this._needInfo(tr, `${tr.id} about ${Math.round(min)} min late${p.cause ? `: ${p.cause}` : ""}`);
    if (p.stage === "approaching" && tr.feeder) this._connection(tr, min * 60);
  }

  /** A feeder is announced late: does its connection hold, and if not, shall the connecting train wait? */
  _connection(a, late_s) {
    const b = this.train(a.partner), need = this.needed(a, late_s);
    a.need_s = need;
    if (!need || b.left_min != null || this.decisions.some((d) => d.id === `hold-${b.id}`)) return;
    const min = Math.ceil(need / 6) / 10, c = this.contract;
    this.ask({
      id: `hold-${b.id}`, title: `${a.id} comes late. Shall ${b.id} wait for its passengers?`,
      text: `${a.changers} passengers of ${a.id} want to change to ${b.id}, which would have to wait about ${min} min; ${b.aboard} passengers are aboard ${b.id}. Who misses it waits ${NEXT_TRAIN_MIN} min for the next train. A trip that leaves ${c.late_from_min} min late or more costs €${c.late_eur}.`,
      options: [{ id: "2", label: `Ask to hold ${b.id} up to 2 min` }, { id: "4", label: `Ask to hold ${b.id} up to 4 min` }, { id: "go", label: `Let ${b.id} go on time` }],
      within: DECIDE_S.hold, fallback: "go",
      then: (o) => {
        if (o === "go") {
          this.log(`${clockAt(this.t)} ${b.id} is not held.`, "request");
          return;
        }
        b.held = { for: a.id, minutes: Number(o) };
        this.give("connection-request", { hold: b.id, for: a.id, minutes: Number(o) });
        this.log(`${clockAt(this.t)} The infrastructure manager is asked to hold ${b.id} for ${a.id}, ${o} min at the most.`, "request");
      },
    });
  }

  _needInfo(tr, text) {
    if (tr.info_since != null) return;
    tr.info_since = this.t;
    tr.info_text = text;
    this.emit("info", { train: tr.id });
  }

  /* ---------------------------------------------------------------- the player's moves */

  /**
   * Publish the passenger information of a train that is late or cancelled.
   * @returns {{ok: boolean, reason?: string}}
   */
  inform(train) {
    const tr = this.train(train);
    if (!tr || tr.info_since == null) return { ok: false, reason: "There is nothing to tell about this train." };
    if (tr.informed != null) return { ok: false, reason: `The passengers of ${train} have been told.` };
    tr.informed = this.t;
    this.give("passenger-information", { train, text: tr.info_text, delay_min: tr.delay_min ?? 0 });
    this.log(`${clockAt(this.t)} Passenger information: ${tr.info_text}.`, "info");
    return { ok: true };
  }

  /** What the computer's dispatcher would decide (a decision's id → an option). */
  advice(id) {
    if (id.startsWith("hold-")) {
      const b = this.train(id.slice(5)), a = this.trains.find((x) => x.partner === b.id && x.feeder);
      const need = (a.need_s ?? 0) / 60;
      return this._holdPays(a, b) ? (need <= 2 ? "2" : "4") : "go";
    }
    const x = this.trouble.find((y) => y.id === id);
    if (!x) return this.decisions.find((d) => d.id === id)?.fallback ?? null;
    if (x.kind === "sick") return this.value("standby") > 0 ? "standby" : x.rest_h >= REST_H ? "freeday" : "cancel";
    return this.value("spare") > 0 ? "spare" : x.safe ? "send" : "short";
  }

  /** Whether holding `b` for the feeder `a` costs less than letting it go: the held passengers' minutes and a penalty (a euro counted as a minute) against the changers' wait. */
  _holdPays(a, b) {
    const need = (a.need_s ?? 0) / 60, c = this.contract;
    return need > 0 && need <= 4 && b.aboard * need + (need >= c.late_from_min ? c.late_eur : 0) < a.changers * NEXT_TRAIN_MIN;
  }

  /* ---------------------------------------------------------------- the game's step */

  tick() {
    const now = this.t;
    // the game's own morning: the late trains, and what the infrastructure manager makes of a hold
    const due = this._script.filter((x) => x.at <= now);
    this._script = this._script.filter((x) => x.at > now);
    for (const x of due) x.run();
    if (this.own) {
      for (const a of this.trains.filter((x) => x._late && !x._gone)) {
        const arr = a.enter + RUN_S + a._late, dep = Math.max(a.dep, arr + DWELL_S);
        if (now >= dep) {
          a._gone = true;
          this._noticed({ train: a.id, kind: "RB", stage: "departed", delay_min: (dep - a.dep) / 60 });
        }
        const b = this.train(a.partner);
        if (a.feeder && !b._gone) {
          // a train held waits until the changers are aboard, at the most as long as asked
          const leaves = b.held ? Math.min(b.dep + b.held.minutes * 60, Math.max(b.dep, arr + CHANGE_S)) : b.dep;
          if (now >= leaves) {
            b._gone = true;
            b.left_min = (leaves - b.dep) / 60;
            if (leaves - b.dep >= 60) this._noticed({ train: b.id, kind: "RB", stage: "departed", delay_min: (leaves - b.dep) / 60 });
          }
        }
      }
    }
    for (const x of this.trouble) if (!x.asked && now >= x.at) this._trouble(x);
    if (now >= this.length) this.end(`${clockAt(this.length)}: the shift is over.`);
  }

  /** The undertaking's own trouble: a decision with a deadline; nobody decides, the train is cancelled. */
  _trouble(x) {
    x.asked = true;
    const c = this.contract;
    this.log(`${clockAt(this.t)} ${x.text}`, "fault");
    const cancel = { id: "cancel", label: `Cancel ${x.train} (${LINE_KM} km not run: not paid, and €${c.cancel_eur_km * LINE_KM} penalty)` };
    const options = x.kind === "sick"
      ? [
        ...(this.value("standby") > 0 ? [{ id: "standby", label: "Send the stand-by driver" }] : []),
        { id: "freeday", label: `Ask ${x.driver} on a free day (${x.rest_h} h since the last shift ended)` },
        cancel,
      ]
      : [
        ...(this.value("spare") > 0 ? [{ id: "spare", label: "Bring the spare unit out of the depot" }] : []),
        { id: "short", label: `Run ${x.train} with one unit instead of two (short-formed: €${c.short_eur_km * LINE_KM} penalty)` },
        { id: "send", label: "Send the unit out as it is" },
        cancel,
      ];
    this.ask({
      id: x.id, title: x.text,
      text: x.kind === "sick" ? `${x.passengers} passengers are expected on ${x.train}. A driver needs ${REST_H} h of rest between two shifts.` : `${x.passengers} passengers are expected on ${x.train}. The defect: ${x.defect}.`,
      options, within: DECIDE_S.own, fallback: "cancel", then: (o) => this._settle(x, o),
    });
  }

  _settle(x, o) {
    const c = this.contract;
    x.choice = o;
    if (o === "standby") {
      this.add("standby", -1);
      this.log(`${clockAt(this.t)} The stand-by driver takes ${x.train}.`, "team");
    } else if (o === "freeday") {
      if (x.rest_h < REST_H) this.violate("rest-time", `${clockAt(this.t)} ${x.driver} was asked to drive ${x.train} after ${x.rest_h} h of rest: a broken rest time.`, 3);
      else this.log(`${clockAt(this.t)} ${x.driver} comes in on a free day and takes ${x.train}.`, "team");
    } else if (o === "spare") {
      this.add("spare", -1);
      this.log(`${clockAt(this.t)} The spare unit runs as ${x.train}; the other goes to the workshop.`, "team");
    } else if (o === "short") {
      this.km.short += LINE_KM;
      this.lost.short += x.passengers * SHORT_MIN;
      this.add("penalties", c.short_eur_km * LINE_KM);
      this.log(`${clockAt(this.t)} ${x.train} runs with one unit: crowded, and €${c.short_eur_km * LINE_KM} penalty.`, "team");
    } else if (o === "send") {
      if (!x.safe) this.violate("defective-unit", `${clockAt(this.t)} A unit with ${x.defect.split(":")[0]} was sent out as ${x.train}.`, 3);
      else this.log(`${clockAt(this.t)} ${x.train} runs with the defect; the workshop takes the unit in the evening.`, "team");
    } else {
      this.km.cancelled += LINE_KM;
      this.lost.cancelled += x.passengers * NEXT_TRAIN_MIN;
      this.add("penalties", c.cancel_eur_km * LINE_KM);
      // a cancelled train must be told to its passengers too
      this.trains.push({ id: x.train, dep: null, aboard: x.passengers, feeder: false, partner: null, changers: 0, delay_min: null, left_min: null, held: null, cancelled: true, info_since: this.t, informed: null, info_text: `${x.train} is cancelled` });
      this.log(`${clockAt(this.t)} ${x.train} is cancelled.`, "team");
    }
  }

  /* ---------------------------------------------------------------- the account */

  /**
   * The connections of the morning: whether each was kept. Kept when the connecting train left late
   * enough for the changers (as its delay notice says), or was held for a wait too short to be told
   * as a delay; a train that is still to leave counts as it stands.
   */
  connections() {
    return CONNECTIONS.map(([a, b]) => [this.train(a), this.train(b)]).filter(([a, b]) => a && b).map(([a, b]) => {
      const need = a.need_s ?? 0;
      // delays are told in tenths of a minute: 6 s of tolerance
      const kept = !need || (b.left_min ?? 0) * 60 + 6 >= need || (!!b.held && need < 60 && b.held.minutes * 60 >= need);
      return { from: a.id, to: b.id, need_s: need, kept, changers: a.changers };
    });
  }

  /**
   * What the morning costs by the book (hold where it pays, the lawful and cheapest way out of the
   * undertaking's own trouble, with the reserves as they are) and by the built-in rule (never hold,
   * cancel when in doubt): passenger minutes and euros each.
   */
  reference() {
    const c = this.contract, lv = LEVELS[this.level];
    let standby = lv.standby, spare = lv.spare;
    const best = { minutes: 0, eur: 0 }, base = { minutes: 0, eur: 0 };
    for (const [ia, ib] of CONNECTIONS) {
      const a = this.train(ia), b = this.train(ib), need = (a?.need_s ?? 0) / 60;
      if (!need) continue;
      const miss = a.changers * NEXT_TRAIN_MIN;
      base.minutes += miss;
      if (this._holdPays(a, b)) {
        best.minutes += b.aboard * need;
        best.eur += need >= c.late_from_min ? c.late_eur : 0;
      } else best.minutes += miss;
    }
    for (const x of this.trouble.filter((y) => y.asked)) {
      base.minutes += x.passengers * NEXT_TRAIN_MIN;
      base.eur += c.cancel_eur_km * LINE_KM;
      if (x.kind === "sick") {
        if (standby > 0) standby--;
        else if (x.rest_h < REST_H) {
          best.minutes += x.passengers * NEXT_TRAIN_MIN;
          best.eur += c.cancel_eur_km * LINE_KM;
        }
      } else if (spare > 0) spare--;
      else if (!x.safe) {
        best.minutes += x.passengers * SHORT_MIN;
        best.eur += c.short_eur_km * LINE_KM;
      }
    }
    return { best: { minutes: Math.round(best.minutes), eur: best.eur }, base };
  }

  /** The morning in numbers: passenger minutes lost and penalties through this desk's decisions, the connections, the passenger information. */
  account() {
    const c = this.contract, cons = this.connections();
    const missed = cons.filter((x) => !x.kept).reduce((a, x) => a + x.changers * NEXT_TRAIN_MIN, 0);
    const held = this.trains.filter((tr) => tr.held && tr.left_min).reduce((a, tr) => a + tr.aboard * tr.left_min, 0);
    const late = this.trains.filter((tr) => (tr.left_min ?? 0) >= c.late_from_min);
    const duties = this.trains.filter((tr) => tr.info_since != null);
    const end = Math.min(this.t, this.length);
    return {
      minutes: Math.round(missed + held + this.lost.cancelled + this.lost.short), eur: this.value("penalties") + late.filter((tr) => tr.held).length * c.late_eur, ...this.reference(),
      connections: cons.length, kept: cons.filter((x) => x.kept).length, late_trips: late.length,
      informed_s: duties.length ? Math.round(duties.reduce((a, tr) => a + ((tr.informed ?? end) - tr.info_since), 0) / duties.length) : 0, duties: duties.length,
    };
  }

  /** The shift's account for the undertaking's managers and the transport authority. */
  finish() {
    const a = this.account();
    this.give("performance-report", {
      scope: "Regional trains through Bf Neustadt", kind: "undertaking", trips: this.trains.filter((tr) => !tr.cancelled).length + this.trouble.filter((x) => x.asked).length,
      cancelled: this.km.cancelled / LINE_KM, cancelled_km: this.km.cancelled, late_trips: a.late_trips, short_km: this.km.short, penalties_eur: a.eur,
      passenger_delay_min: a.minutes, connections: a.connections, connections_kept: a.kept, informed_s: a.informed_s, violations: this.violations.length, score: this.score().total,
    });
  }

  objectives() {
    const a = this.account();
    // by the book is full marks, the built-in rule none; where the two cost the same, every minute or euro beyond counts against a span
    const against = (mine, best, base, span) => (base > best ? 1 - (mine - best) / (base - best) : 1 - Math.max(0, mine - best) / span);
    const sev = this.violations.reduce((s, v) => s + (v.severity >= 3 ? 1 : v.severity === 2 ? 0.5 : 0.15), 0);
    return [
      { id: "passengers", label: "Passengers", weight: 35, value: against(a.minutes, a.best.minutes, a.base.minutes, 600), note: `${a.minutes} passenger minutes lost; by the book ${a.best.minutes}, never holding and always cancelling ${a.base.minutes}` },
      { id: "penalties", label: "Penalties", weight: 25, value: against(a.eur, a.best.eur, a.base.eur, 400), note: `€${a.eur}; by the book €${a.best.eur}, always cancelling €${a.base.eur}` },
      { id: "information", label: "Passenger information", weight: 20, value: a.duties ? 1 - (a.informed_s - INFO.good_s) / (INFO.bad_s - INFO.good_s) : 1, note: a.duties ? `${a.duties} trains to tell of, after ${a.informed_s} s on average` : "nothing to tell" },
      { id: "rules", label: "Rules", weight: 20, value: this.violations.some((v) => v.severity >= 3) ? 0 : 1 - sev, note: `${this.violations.length} rules broken` },
    ];
  }

  /* ---------------------------------------------------------------- for a page */

  view() {
    const a = this.account(), todo = this.pending();
    const note = (tr) => [tr.cancelled ? "cancelled" : "", tr.held ? `held for ${tr.held.for}, up to ${tr.held.minutes} min` : "", tr.informed != null ? "passengers told" : tr.info_since != null ? "passengers not told yet" : ""].filter(Boolean).join("; ");
    const way = { standby: "the stand-by driver", freeday: "a driver on a free day", spare: "the spare unit", short: "one unit instead of two", send: "sent out as it is", cancel: "cancelled" };
    return {
      figures: [
        { label: "Penalties", value: a.eur, unit: "€", tone: a.eur ? "warn" : "ok" },
        { label: "Passenger minutes lost", value: a.minutes, tone: a.minutes > a.base.minutes ? "bad" : a.minutes ? "warn" : "ok" },
        { label: "To tell the passengers", value: todo.length, tone: todo.length ? "warn" : "ok" },
        { label: "Stand-by drivers", value: this.value("standby") },
        { label: "Spare units", value: this.value("spare") },
      ],
      tables: [
        {
          id: "trains", title: "Our trains", columns: ["Train", "Departs", "Late", "Connection", "Note"],
          rows: this.trains.map((tr) => [tr.id, tr.dep == null ? "–" : clockAt(tr.dep), tr.delay_min ? `+${tr.delay_min}` : "–", tr.partner ? (tr.feeder ? `to ${tr.partner} (${tr.changers} change)` : `from ${tr.partner}`) : "–", note(tr)]),
        },
        { id: "trouble", title: "Drivers and units", columns: ["What", "Way out"], empty: "No trouble so far.", rows: this.trouble.filter((x) => x.asked).map((x) => [x.text, x.choice ? way[x.choice] : "to decide"]) },
      ],
      actions: [
        { name: "inform", label: "Publish passenger information", primary: true, disabled: todo.length ? undefined : "Nothing to tell just now.", fields: [{ id: "train", label: "Train", options: todo.map((tr) => ({ id: tr.id, label: `${tr.id}: ${tr.info_text}` })) }] },
      ],
    };
  }
}
