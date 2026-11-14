/**
 * The transport authority's contract manager (Vertragsmanager/in Verkehrsvertrag beim
 * Aufgabenträger), "Malus Month" (Pönale): a turn game, one round an accounting period of the
 * transport contract for the regional trains through Bf Neustadt.
 *
 * In the **review** the period's incident list is on the desk: train-km cancelled for lack of a
 * driver, after a unit failure or for an infrastructure fault, late trips caused by the operator or
 * by others, km run short-formed. For each class the contract manager decides what follows. The
 * rule to learn: train-km not run are not paid, whatever the cause ("no service, no pay"); a
 * penalty on top applies only to causes in the operator's sphere. The operator may object; an
 * objection with evidence that the cause lay outside its sphere is justified. A penalty waived
 * without a reason is found by the auditor; a penalty for a cause outside the operator's sphere is
 * lost in the dispute. The operator's finances react: deductions beyond the contract bring it
 * down, first to cuts in its own reserves (more failures), in the end to insolvency and an emergency
 * award. Leniency is no way out: an operator who learns that failures cost nothing lets the quality
 * slide.
 *
 * In the **plan** phase the contract's penalty catalogue goes out (to the undertaking's operations
 * control, in a session), and one question of the period ahead is decided: quality checks, or the
 * operator's request for a reduced emergency timetable.
 *
 * In a session the incident list follows the reports of the period's sampled shift (the
 * undertaking's and the signaller's), blended with the usual rates: one morning is a small sample.
 * Alone, the game draws the list itself.
 *
 * Simplified: one price per train-km, six classes of incidents, the catalogue's illustrative
 * penalty rates; the operator's finances are one number.
 * @module arail/game/contract-manager
 */
import { Game, Player } from "./core.js";

/** The penalty catalogue of the contract (the role catalogue's illustrative values). */
export const CONTRACT = { cancel_eur_km: 12, late_eur: 40, short_eur_km: 4, late_from_min: 4 };
/** The contract: train-km ordered a month, the price of one, the length of a trip (1.5 M train-km a year at €16: €24 M a year). */
export const TERMS = { km_month: 125_000, price_eur_km: 16, trip_km: 30 };

/**
 * The classes of the incident list: counted in km or trips; whether the km were not run; whether
 * the cause is in the operator's sphere; the usual share of the period's km or trips.
 */
export const CLASSES = [
  { id: "no-driver", label: "Cancelled for lack of a driver", unit: "km", cancelled: true, operator: true, rate: 0.006 },
  { id: "unit-failure", label: "Cancelled after a unit failure", unit: "km", cancelled: true, operator: true, rate: 0.005 },
  { id: "infrastructure", label: "Cancelled for an infrastructure fault", unit: "km", cancelled: true, operator: false, rate: 0.006 },
  { id: "late-own", label: "Late trips caused by the operator", unit: "trips", cancelled: false, operator: true, rate: 0.03 },
  { id: "late-others", label: "Late trips caused by the infrastructure or by others", unit: "trips", cancelled: false, operator: false, rate: 0.05 },
  { id: "short", label: "Run short-formed", unit: "km", cancelled: false, operator: true, rate: 0.01 },
];
/** What can follow for a class: for km not run, and for late or short-formed trains. */
const CANCELLED = [{ id: "penalty", label: "Not paid, and a penalty" }, { id: "unpaid", label: "Not paid, no penalty" }, { id: "paid", label: "Paid in full" }];
const DELIVERED = [{ id: "penalty", label: "A penalty" }, { id: "none", label: "No penalty" }];

/**
 * The operator's finances (0 insolvent … 1 sound): what a period restores, what the contract's
 * penalties and deductions beyond the contract take (per share of the period's payment), below
 * which it cuts its own reserves, and what that does to its failures.
 */
export const HEALTH = { recover: 0.05, per_penalty: 3, per_excess: 10, cuts_below: 0.35, cuts: 1.5 };
/** Leniency: the operator's failures grow by this per share of the period's payment that was wrongly not deducted, up to `LENIENCY_MOST` times as many. */
export const LENIENCY = 20;
export const LENIENCY_MOST = 3;
/** Quality checks: their cost (€) and what they do to late and short-formed trains in the next period. */
export const CHECKS = { cost_eur: 5000, effect: 0.9 };
/** A reduced emergency timetable: the share of train-km taken out, and what is left of the cancellations for lack of a driver. */
export const EMERGENCY = { km: 0.04, no_driver: 0.3 };
/** How much a sampled shift's rates count against the usual ones. */
export const SAMPLE_WEIGHT = 0.25;
/** The share of a class an objection is about. */
const OBJECTED = 0.4;

/** Levels: the operator's finances at the start, a staff shortage (cancellations for lack of a driver times this), objections. */
export const LEVELS = {
  training: { label: "Training: a quiet contract, no objections", health: 0.8, shortage: 1, objections: 0 },
  normal: { label: "Normal: the operator objects now and then", health: 0.7, shortage: 1.3, objections: 0.6 },
  hard: { label: "Hard: a staff shortage and a tight operator that objects", health: 0.45, shortage: 2.5, objections: 0.9 },
};

/** The objections an operator can raise, each about a class in its sphere; with the evidence it is justified, without it not. */
const OBJECTIONS = [
  { class: "unit-failure", claim: "a part of the unit failures followed stone-throwing at the trains", proof: "The police reports are attached, and the unit numbers match.", none: "No report is attached; the workshop's log shows worn parts." },
  { class: "late-own", claim: "a part of its late trips were held by the infrastructure manager's dispatcher for another operator's connection", proof: "The dispatcher's log is attached and names the trains.", none: "The dispatcher's log shows no such order; the trains left their depot late." },
  { class: "no-driver", claim: "a part of the drivers missing were kept away by a closed line on their way to work", proof: "The infrastructure manager's closure notice and the rosters are attached.", none: "The rosters show that the shifts were never filled." },
];

const isReview = (ctx) => ctx?.phase?.id === "review";
const euro = (v) => `€${Math.round(v).toLocaleString("en-GB")}`;

/** What follows from a choice for a class with an amount: the payment withheld for km not run and the penalty (€). */
export function consequence(cls, amount, choice, contract = CONTRACT) {
  const unpaid = cls.cancelled && choice !== "paid" ? amount * TERMS.price_eur_km : 0;
  const rate = cls.cancelled ? contract.cancel_eur_km : cls.unit === "trips" ? contract.late_eur : contract.short_eur_km;
  return { unpaid, penalty: choice === "penalty" ? amount * rate : 0 };
}

/** The choice the contract's rule gives for a class: no service, no pay; a penalty only in the operator's sphere. */
export const ruleFor = (cls) => (cls.operator ? "penalty" : cls.cancelled ? "unpaid" : "none");

/** The computer's contract manager: applies the rule, accepts an objection that has its evidence, orders the checks, accepts an emergency timetable. */
export class ContractPlayer extends Player {
  /** @param {ContractGame} g */
  think(g) {
    for (const d of g.open) g.act("decide", d.id, g.advice(d.id));
  }
}

export class ContractGame extends Game {
  static id = "contract";
  static title = "Malus Month";
  static role = "transport-authority-contract-manager";
  static kind = "both";
  static description = "A transport contract, period after period: the incident list with its causes, what is paid and what a penalty applies to, the operator's objections, and an operator that must neither be bled nor spoiled.";
  static scale = "months";
  static takes = [
    { flow: "performance-report" },
  ];
  static gives = [
    { flow: "transport-contract" },
    { flow: "penalty" },
    { flow: "payment" },
    { flow: "performance-report" },
  ];
  static player = ContractPlayer;

  /** @param {{seed?: number, level?: keyof LEVELS, period?: "month" | "year", conditions?: object, wired?: Iterable<string>}} [options] */
  constructor(options = {}) {
    super({ ...options, level: LEVELS[options.level] ? options.level : "normal" });
    const lv = LEVELS[this.level];
    /** What a round stands for: a month, or a year (twelve times the km and the money). */
    this.period = options.period === "year" ? "year" : "month";
    this.km = TERMS.km_month * (this.period === "year" ? 12 : 1);
    /** The operator's finances, 0 insolvent … 1 sound. */
    this.health = lv.health;
    /** Leniency so far: shares of a period's payment wrongly not deducted. */
    this.soft = 0;
    /** The periods so far: the list, the choices, the account. The last is the one in work. */
    this.periods = [];
    this.round = 0;
    this.rounds = null;
    this._gave = false;
    this._read = 0;
    this._checks = false;
    this._emergency = false;
    this.resource("budget", "Spent on quality checks", 0, "€");
    this.log("A transport contract for the regional trains through Bf Neustadt: 1.5 million train-km a year, and a penalty catalogue.");
  }

  /** The period in work, or null. */
  get current() {
    return this.periods.at(-1) ?? null;
  }

  /* ---------------------------------------------------------------- the phases of a period */

  begin(ctx) {
    if (this.over) return;
    this.rounds = ctx.rounds ?? this.rounds;
    if (!this._gave) {
      this._gave = true;
      this.give("transport-contract", { ...CONTRACT });
    }
    if (isReview(ctx)) this._review(ctx);
    else this._plan(ctx);
  }

  finish(ctx) {
    if (isReview(ctx)) this._settle(ctx);
  }

  /** The period ahead: one question, drawn by the seed. */
  _plan(ctx) {
    this.round = ctx.round;
    const lv = LEVELS[this.level], r = this.rng("plan", ctx.round);
    this._checks = false;
    this._emergency = false;
    if (lv.shortage >= 1.3 && r.next() < (this.level === "hard" ? 0.8 : 0.4)) {
      this.ask({
        id: `emergency-${ctx.round}`, title: "The operator asks for a reduced emergency timetable for the period.",
        text: `It is short of drivers. ${Math.round(EMERGENCY.km * 100)} % of the train-km would be taken out, planned and announced: not run and not paid, without a penalty. Without it the trains are cancelled at short notice.`,
        options: [{ id: "accept", label: "Accept the emergency timetable" }, { id: "reject", label: "Reject it: the full timetable is owed" }], fallback: "reject",
        then: (o) => (this._emergency = o === "accept"),
      });
    } else {
      this.ask({
        id: `checks-${ctx.round}`, title: "Order quality checks for the period?",
        text: `Mystery travellers and cleanliness audits for ${euro(CHECKS.cost_eur)}: the operator's late and short-formed trains fall by a tenth in the period after.`,
        options: [{ id: "yes", label: "Order the checks" }, { id: "no", label: "Not this period" }], fallback: "no",
        then: (o) => {
          this._checks = o === "yes";
          if (this._checks) this.add("budget", CHECKS.cost_eur);
        },
      });
    }
  }

  /** The rates of the period by class: the usual ones, the level's shortage, the operator's cuts and its learning, the checks, the sampled shift. */
  _rates(reports) {
    const lv = LEVELS[this.level], prev = this.periods.at(-1);
    const und = reports.find((p) => p.kind === "undertaking"), ops = reports.find((p) => p.kind === "operations");
    const out = {};
    for (const c of CLASSES) {
      let rate = c.rate;
      if (c.id === "no-driver") rate *= lv.shortage * (this._emergency ? EMERGENCY.no_driver : 1);
      if (c.operator) rate *= (this.health < HEALTH.cuts_below ? HEALTH.cuts : 1) * Math.min(LENIENCY_MOST, 1 + LENIENCY * this.soft);
      if ((c.id === "late-own" || c.id === "short") && prev?.checks) rate *= CHECKS.effect;
      // a sampled shift: its own rates count a quarter
      let sample = null;
      if (und?.trips > 0) {
        if (c.id === "no-driver" || c.id === "unit-failure") sample = (und.cancelled_km ?? 0) / (und.trips * TERMS.trip_km) / 2;
        else if (c.id === "short") sample = (und.short_km ?? 0) / (und.trips * TERMS.trip_km);
        else if (c.id === "late-own") sample = (und.late_trips ?? 0) / und.trips;
      }
      if (ops?.trains > 0) {
        if (c.id === "late-others") sample = (ops.late ?? 0) / ops.trains;
        else if (c.id === "infrastructure") sample = (ops.faults ?? 0) > 0 && (ops.restore_min ?? 99) > 20 ? 2 * c.rate : c.rate / 2;
      }
      out[c.id] = sample == null ? rate : (1 - SAMPLE_WEIGHT) * rate + SAMPLE_WEIGHT * sample;
    }
    return out;
  }

  /** The period's incident list is on the desk: a decision per class, and the operator's objection. */
  _review(ctx) {
    this.round = ctx.round;
    const lv = LEVELS[this.level], r = this.rng("period", ctx.round);
    // the reports that came in since the last review
    const reports = this.inbox.slice(this._read).filter((m) => m.flow === "performance-report").map((m) => m.payload ?? {});
    this._read = this.inbox.length;
    const km = this.km * (this._emergency ? 1 - EMERGENCY.km : 1), trips = km / TERMS.trip_km, rates = this._rates(reports);
    const list = CLASSES.map((c) => ({ id: c.id, amount: Math.round((c.unit === "km" ? km : trips) * rates[c.id] * r.uniform(0.85, 1.15)), choice: null }));
    const p = { n: ctx.round, year: ctx.year ?? ctx.round, km, trips: Math.round(trips), list, checks: this._checks, emergency: this._emergency, sampled: reports.length > 0, objection: null, account: null };
    if (r.next() < lv.objections) {
      const o = OBJECTIONS[r.int(OBJECTIONS.length)];
      if (list.find((x) => x.id === o.class).amount > 0) p.objection = { ...o, justified: r.next() < 0.5, choice: null };
    }
    this.periods.push(p);
    this.log(`Period ${p.n}: ${Math.round(km).toLocaleString("en-GB")} train-km ordered${p.emergency ? " (the emergency timetable)" : ""}; the operator's incident list is in${p.sampled ? ", with the reports of the sampled morning" : ""}.`);
    for (const x of list) {
      const c = CLASSES.find((y) => y.id === x.id);
      if (!x.amount) continue;
      this.ask({
        id: `class-${p.n}-${c.id}`, title: `${c.label}: ${x.amount.toLocaleString("en-GB")} ${c.unit}`,
        text: c.cancelled ? `These train-km were not run. A train-km is paid ${euro(TERMS.price_eur_km)}; the penalty is ${euro(CONTRACT.cancel_eur_km)} a km.` : c.unit === "trips" ? `These trips left ${CONTRACT.late_from_min} min late or more. The penalty is ${euro(CONTRACT.late_eur)} a trip.` : `These train-km were run with fewer cars than ordered. The penalty is ${euro(CONTRACT.short_eur_km)} a km.`,
        options: c.cancelled ? CANCELLED : DELIVERED, fallback: c.cancelled ? "unpaid" : "none",
        then: (o) => (x.choice = o),
      });
    }
    if (p.objection) {
      const o = p.objection, c = CLASSES.find((y) => y.id === o.class);
      this.ask({
        id: `objection-${p.n}`, title: `The operator objects: ${o.claim}.`,
        text: `It concerns ${Math.round(OBJECTED * 100)} % of "${c.label}". ${o.justified ? o.proof : o.none}`,
        options: [{ id: "accept", label: "Accept: the cause was outside its sphere" }, { id: "reject", label: "Reject the objection" }], fallback: "reject",
        then: (x) => (o.choice = x),
      });
    }
  }

  /** The period's account: the player's against the rule's, the rules broken, the operator's finances. */
  _settle(ctx) {
    const p = this.current;
    if (!p || p.account) return;
    const full = p.km * TERMS.price_eur_km;
    let mine = 0, right = 0, penalties = 0, rightPenalties = 0, correct = 0, asked = 0;
    for (const x of p.list) {
      if (!x.amount) continue;
      const c = CLASSES.find((y) => y.id === x.id), rule = ruleFor(c);
      const choice = x.choice ?? (c.cancelled ? "unpaid" : "none");
      // the share an objection is about: outside the operator's sphere when it is justified (for the rule) or accepted (for the player)
      const o = p.objection?.class === c.id ? p.objection : null, part = o ? Math.round(x.amount * OBJECTED) : 0;
      const outside = { ...c, operator: false };
      const a = consequence(c, x.amount - (o?.choice === "accept" ? part : 0), choice), a2 = o?.choice === "accept" ? consequence(outside, part, ruleFor(outside)) : { unpaid: 0, penalty: 0 };
      const b = consequence(c, x.amount - (o?.justified ? part : 0), rule), b2 = o?.justified ? consequence(outside, part, ruleFor(outside)) : { unpaid: 0, penalty: 0 };
      mine += a.unpaid + a.penalty + a2.unpaid + a2.penalty;
      right += b.unpaid + b.penalty + b2.unpaid + b2.penalty;
      penalties += a.penalty + a2.penalty;
      rightPenalties += b.penalty + b2.penalty;
      asked++;
      if (choice === rule) correct++;
      else if (c.cancelled && choice === "paid") this.violate("paid-not-run", `Period ${p.n}: ${c.label.toLowerCase()}: train-km not run were paid in full.`, 2);
      else if (c.operator) this.violate("penalty-waived", `Period ${p.n}: ${c.label.toLowerCase()}: the auditor finds a penalty waived without a reason.`, 2);
      else this.violate("penalty-outside-sphere", `Period ${p.n}: ${c.label.toLowerCase()}: a penalty for a cause outside the operator's sphere; the dispute is lost and the money goes back.`, 1);
    }
    if (p.objection) {
      const o = p.objection, choice = o.choice ?? "reject";
      asked++;
      if ((choice === "accept") === o.justified) correct++;
      else if (choice === "accept") this.violate("objection-accepted", `Period ${p.n}: an objection without evidence was accepted: the auditor finds a penalty waived without a reason.`, 2);
      else this.violate("objection-rejected", `Period ${p.n}: a justified objection was rejected; the dispute is lost and the money goes back.`, 1);
    }
    const excess = Math.max(0, mine - right), under = Math.max(0, right - mine);
    const before = this.health;
    // what the operator really pays: the penalties charged, as far as the contract has them, and every euro deducted beyond the contract
    this.health = Math.max(0, Math.min(1, this.health + HEALTH.recover - HEALTH.per_penalty * Math.min(penalties, rightPenalties) / full - HEALTH.per_excess * excess / full));
    this.soft += under / full;
    const amount = (id) => p.list.find((x) => x.id === id).amount;
    const cancelled = (amount("no-driver") + amount("unit-failure") + amount("infrastructure")) / p.km, late = (amount("late-own") + amount("late-others")) / p.trips;
    const own = (amount("no-driver") + amount("unit-failure")) / p.km + amount("late-own") / p.trips + amount("short") / p.km;
    p.account = { full, payment: full - mine, right: full - right, penalties, correct, asked, excess, under, cancelled_share: cancelled, punctual_share: 1 - late, own, health: this.health };
    this.log(`Period ${p.n}: paid ${euro(full - mine)} of ${euro(full)} (by the contract ${euro(full - right)}); penalties ${euro(penalties)}; ${correct} of ${asked} decisions by the rule.`);
    this.log(`Period ${p.n}: ${(100 * (1 - late)).toFixed(1)} % of the trips on time, ${(100 * cancelled).toFixed(2)} % of the train-km cancelled. The operator's finances: ${this._healthText()}${this.health < before - 0.005 ? " (worse)" : this.health > before + 0.005 ? " (better)" : ""}.`);
    if (penalties > 0) this.give("penalty", { year: p.year, eur: Math.round(penalties), for: "the period's cancelled, late and short-formed trains" });
    this.give("payment", { year: p.year, eur: Math.round(full - mine), for: "the period's train-km" });
    this.give("performance-report", { scope: "Transport contract, regional trains through Bf Neustadt", kind: "contract", year: p.year, punctual_share: Math.round((1 - late) * 1000) / 1000, cancelled_share: Math.round(cancelled * 10000) / 10000, penalties_eur: Math.round(penalties), operator_health: Math.round(this.health * 100) / 100, score: this.score().total });
    if (this.health <= 0) {
      this.violate("operator-insolvent", `Period ${p.n}: the operator is insolvent. The trains stop; an emergency award (Notvergabe) for up to two years will cost about a fifth more.`, 3);
      this.end("The operator is insolvent.");
    } else if (this.rounds && p.n >= this.rounds) this.end(`${this.rounds} periods are settled.`);
  }

  _healthText() {
    const h = this.health;
    return h <= 0 ? "insolvent" : h < HEALTH.cuts_below ? "cutting its own reserves" : h < 0.5 ? "tight" : "sound";
  }

  /** What the computer's contract manager would decide (a decision's id → an option). */
  advice(id) {
    const p = this.current;
    if (id.startsWith("class-")) return ruleFor(CLASSES.find((c) => id === `class-${p.n}-${c.id}`));
    if (id.startsWith("objection-")) return p.objection.justified ? "accept" : "reject";
    if (id.startsWith("checks-")) return "yes";
    if (id.startsWith("emergency-")) return "accept";
    return this.decisions.find((d) => d.id === id)?.fallback ?? null;
  }

  /* ---------------------------------------------------------------- the score */

  objectives() {
    const done = this.periods.filter((p) => p.account);
    const asked = done.reduce((a, p) => a + p.account.asked, 0), correct = done.reduce((a, p) => a + p.account.correct, 0);
    // the operator's own failures (cancelled and late by its causes, short-formed) in the last period against the first
    const first = done[0]?.account.own, last = done.at(-1)?.account.own;
    const sev = this.violations.reduce((s, v) => s + (v.severity >= 3 ? 1 : v.severity === 2 ? 0.25 : 0.08), 0);
    return [
      { id: "correct", label: "The account by the contract", weight: 40, value: asked ? correct / asked : 1, note: `${correct} of ${asked} decisions by the rule` },
      { id: "quality", label: "The quality's trend", weight: 20, value: done.length > 1 && first > 0 ? 2 - last / first : 1, note: done.length > 1 ? `the operator's own failures: ${(100 * last).toFixed(1)} % in the last period, ${(100 * first).toFixed(1)} % in the first` : "one period so far" },
      { id: "operator", label: "The operator", weight: 25, value: this.health / 0.5, note: this._healthText() },
      { id: "rules", label: "Rules", weight: 15, value: this.violations.some((v) => v.severity >= 3) ? 0 : 1 - sev, note: `${this.violations.length} findings and lost disputes` },
    ];
  }

  /* ---------------------------------------------------------------- for a page */

  view() {
    const p = this.current, done = this.periods.filter((x) => x.account), last = done.at(-1)?.account;
    const said = (c, x) => (x.choice ? (c.cancelled ? CANCELLED : DELIVERED).find((o) => o.id === x.choice).label.toLowerCase() : "to decide");
    return {
      scene: this._scene(),
      figures: [
        { label: "The operator's finances", value: this._healthText(), tone: this.health < HEALTH.cuts_below ? "bad" : this.health < 0.5 ? "warn" : "ok" },
        { label: "Trips on time", value: last ? (100 * last.punctual_share).toFixed(1) : "–", unit: last ? "%" : "" },
        { label: "Train-km cancelled", value: last ? (100 * last.cancelled_share).toFixed(2) : "–", unit: last ? "%" : "" },
        { label: "Penalties of the last period", value: last ? Math.round(last.penalties) : "–", unit: last ? "€" : "" },
      ],
      tables: [
        {
          id: "list", title: p && !p.account ? `The incident list of period ${p.n}` : "The incident list", columns: ["Class", "Amount", "What follows"], empty: "The list comes with the period's account.",
          rows: p && !p.account ? p.list.filter((x) => x.amount).map((x) => {
            const c = CLASSES.find((y) => y.id === x.id);
            return [c.label, `${x.amount.toLocaleString("en-GB")} ${c.unit}`, said(c, x)];
          }) : [],
        },
        {
          id: "periods", title: "The periods so far", columns: ["Period", "On time", "Cancelled", "Paid", "Penalties", "By the rule"], empty: "No period is settled yet.",
          rows: done.map((x) => [x.n, `${(100 * x.account.punctual_share).toFixed(1)} %`, `${(100 * x.account.cancelled_share).toFixed(2)} %`, euro(x.account.payment), euro(x.account.penalties), `${x.account.correct} of ${x.account.asked}`]),
        },
      ],
      actions: [],
    };
  }

  /**
   * The contract's period as things a picture of the station can show (the table: web/game/turn.js):
   * the trips of the last period as a tally (on time, late, cancelled), and what each open decision
   * is about: the operator's wishes at its trains, the incident list and the checks at the station.
   * @returns {Array<{thing: string}>}
   */
  _scene() {
    const last = this.periods.filter((x) => x.account).at(-1)?.account, n = 20;
    const things = [];
    if (last) {
      // (a cancelled share of half a percent or more shows as one trip of the twenty)
      const cancelled = last.cancelled_share >= 0.005 ? Math.max(1, Math.round(n * last.cancelled_share)) : 0, late = Math.min(n - cancelled, Math.round(n * (1 - last.punctual_share)));
      things.push({ thing: "tally", at: "platform", parts: [{ tone: "ok", n: n - late - cancelled }, { tone: "warn", n: late }, { tone: "bad", n: cancelled }] });
    }
    const about = (id) => (id.startsWith("emergency-") ? "trains" : id.startsWith("checks-") ? "platform" : "station");
    return [...things, ...this.open.map((d) => ({ thing: "ask", id: d.id, at: about(d.id) }))];
  }
}
