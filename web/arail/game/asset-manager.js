/**
 * The asset manager's game (Anlagenmanager/in), "Budget Years" (Haushaltsjahre): three to five
 * budget years of the district around Bf Neustadt (the district of maintenance.js), a year a round.
 *
 * At the start of a year (the plan phase) the asset manager sets the maintenance strategy, commits
 * the federal replacement money before it is lost, sets the staff plan of the maintenance
 * dispatcher, and now and then approves, defers or declines a proposal of the asset responsible
 * (ALV). At the year's end (the review phase) the year plays out: faults, delay minutes, the money
 * paid under the performance regime, the wear and the renewals coming in. A known defect that was
 * deferred can cause an accident: the round ends at once.
 *
 * The model, small enough for a page (the constants below and `yearOf`, `minutesPerFault`,
 * `renewalsOf`); it is not the infrastructure engine of web/arail/infra/ but a compact model of
 * the same ideas, built to be wired to the other role games:
 *
 *   faults of a year    = 240 × 1.6^(grade − 3) × strategy (lean 1.15, thorough 0.9) × 0.88 with condition monitoring
 *   minutes per fault   = 3 × minutes to restore (1, 2, 3 teams: 20, 14, 12; nobody on call: × 1.2),
 *                         or from the shift's reports (see `minutesPerFault`)
 *   delay minutes       = faults × minutes per fault + 60 per €1 M of renewals built (120 beyond the
 *                         planned programme) + 450 per speed restriction
 *   performance regime  = €10 per delay minute, paid from the maintenance money
 *   grade next year     = grade + wear (lean 0.16, standard 0.10, thorough 0.07) − 0.10 per €24 M of
 *                         the renewals built the year before
 *   replacement money   that is not committed in its year is lost
 *
 * In a session (session.js) the money comes from the budget MP, the staff plan goes to the
 * maintenance dispatcher, the condition of the assets to the signaller and the dispatcher, and what
 * a fault cost in the shift comes back in their reports. Alone, the game plays those ends itself:
 * the level's money with its own rule (a missed target cuts next year's money by 10 %) and its own
 * model of the shift.
 * @module arail/game/asset-manager
 */
import { clamp } from "../core/math.js";
import { Game, Player } from "./core.js";
import { SCALE_S } from "./flows.js";
import { DISTRICT } from "./maintenance.js";

/** The district's track (km): line 6250 Bergheim – Bf Neustadt – Talsee, the Waldau branch and the station tracks. */
export const TRACK_KM = 150;
/** The target of the condition grade (school grades: 1 very good … 6 unusable), as in the catalogue's example; it stands in for the LuFV quality indicators. */
export const TARGET_GRADE = 3.2;
/** The share of inspections on time that the catalogue asks (%, the EBA's audit). */
export const INSPECTIONS_PCT = 95;
/** The game's own rule without a budget MP: the year after a missed target (the grade worse than the target) the level's money is cut by this share. */
export const MISSED_CUT = 0.1;

/**
 * The maintenance strategies: what the production unit (Produktionsdurchführung) does for the own
 * funds. `cost_eur` a year; `wear`: grade points a year; `faults`: factor on the faults of the
 * year; `inspections_pct`: the share of inspections on time.
 * Scaled from the catalogue's €50–150 M a year for 1,500–3,000 km of track to 150 km.
 */
export const STRATEGIES = {
  lean: { label: "Lean", cost_eur: 3_500_000, wear: 0.16, faults: 1.15, inspections_pct: 88 },
  standard: { label: "Standard", cost_eur: 4_300_000, wear: 0.1, faults: 1, inspections_pct: 96 },
  thorough: { label: "Thorough", cost_eur: 5_100_000, wear: 0.07, faults: 0.9, inspections_pct: 99 },
};

/**
 * The renewals: the programme the district's planners have ready to build (`planned_eur`), what
 * the planning capacity allows with measures pulled forward (`capacity_eur`), and the share of the
 * programme that "little" builds (only what is already under construction).
 * Scaled from the catalogue's €200–600 M of replacement money a year for a regional unit.
 */
export const PROGRAMME = { planned_eur: 24_000_000, capacity_eur: 30_000_000, little: 0.25 };
/** Grade points gained per €1 M of renewals, a year after they were built: the planned programme makes good a year of standard wear. */
export const GRADE_PER_MEUR = 0.1 / 24;

/**
 * The staff plan: an emergency team's share for fault response and the standby of a technician on
 * call (€ a year), an hour of overtime (€), and the game's own model of a shift: minutes to restore
 * a fault and hours of overtime per fault by the number of teams; nobody on call makes nights and
 * weekends slower (`no_on_call`).
 */
export const STAFF = {
  team_eur: 400_000, on_call_eur: 60_000, overtime_eur_h: 90,
  restore_min: { 1: 20, 2: 14, 3: 12 }, no_on_call: 1.2,
  overtime_h_per_fault: { 1: 1.3, 2: 0.5, 3: 0.2 },
};

/** The faults of a year at grade 3.0 (about 1.6 per km of track), and their growth per grade point. */
export const FAULTS_YEAR = { at_grade_3: 240, growth: 1.6 };
/** Speed restrictions (La): none up to `from_grade`, then `per_grade` for each grade point. */
export const RESTRICTIONS = { from_grade: 2.6, per_grade: 5 };

/**
 * Delay minutes (simplified): while a fault is open, about three trains wait or run late
 * (`per_restore_min` delay minutes per minute to restore); the delay a signaller counts at one
 * station spreads down the line (`network_per_station`); possessions for renewals
 * (`possession_min_per_meur`, twice that for measures pulled forward beyond the planned programme);
 * a speed restriction (`restriction_min` a year).
 */
export const DELAY = { per_restore_min: 3, network_per_station: 6, possession_min_per_meur: 60, restriction_min: 450 };
/** The performance regime (Anreizsystem): € per delay minute caused by the infrastructure; one rate standing in for the rates of the network statement (simplified). */
export const REGIME_EUR_PER_MIN = 10;

/** The known defects the asset responsible (ALV) can propose to repair. */
export const DEFECTS = [
  { id: "embankment", asset: "the embankment at km 12.4 between Bf Neustadt and Talsee", finding: "it is slipping after two wet winters", cost_eur: 380_000 },
  { id: "bridge", asset: "the bridge over the mill stream on the Waldau branch", finding: "cracks in its bearings", cost_eur: 450_000 },
  { id: "w12", asset: "point W12 at Bergheim", finding: "worn switch blades and a crack in the frog", cost_eur: 300_000 },
];
/** Deferring a defect: the closer watch (€ a year), how much dearer the repair gets each year, and the chance of an accident in each year it stays deferred. */
export const DEFER = { watch_eur: 20_000, dearer: 0.25, accident_chance: 0.15 };
/** Condition monitoring (switch diagnosis, remote monitoring of the level crossings): its cost, the factor on the faults from the next year, and the inspections it saves (points of the share on time). */
export const MONITORING = { cost_eur: 400_000, faults: 0.88, inspections_pct: 3 };
/** How likely a year brings a proposal of the ALV: a known defect, or condition monitoring. */
export const PROPOSALS = { defect: 0.45, monitoring: 0.3 };

/** The score: where nothing is left of an objective (the grade beyond the target, delay minutes above the starting level, the maintenance money overrun, replacement money unused, inspections on time). */
export const SCORE = { grade_span: 0.5, delay_span: 0.5, overrun_span: 0.1, unused_span: 0.5, inspections_none_pct: 85 };

/** Levels: the grade at the start and the money of a year (€; `blocked_eur` of the replacement money cannot be spent). */
export const LEVELS = {
  training: { label: "Training: a network in good order (grade 3.0) and ample money", grade: 3.0, maintenance_eur: 7_000_000, renewal_eur: 28_000_000, blocked_eur: 0 },
  normal: { label: "Normal: grade 3.0, €6 M for maintenance and €24 M of replacement money a year", grade: 3.0, maintenance_eur: 6_000_000, renewal_eur: 24_000_000, blocked_eur: 0 },
  hard: { label: "Hard: an older network (grade 3.4); the target was missed last year, so the money is cut by 10 %", grade: 3.4, maintenance_eur: 6_000_000, renewal_eur: 24_000_000, blocked_eur: 0 },
};

/** The asset responsible (Anlagenverantwortliche/r, ALV) of the district (a bird name, see CONTRIBUTING.md). */
const ALV = "E. Kiebitz";
/** Last year's plan: what a year's decisions fall back to in the first year. */
const LAST_YEAR = { strategy: "standard", renewals: "planned", teams: 2, on_call: true, proposal: null };
const RENEWALS = { little: "Little", planned: "The planned programme", all: "Everything the planning capacity allows" };

const num = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const eur = (v) => (Math.abs(v) >= 1e6 ? `€${(v / 1e6).toFixed(2)} M` : `€${num(v)}`);
const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;
const teamsText = (n, onCall) => `${n} emergency team${n === 1 ? "" : "s"}${onCall ? " and a technician on call" : ", nobody on call"}`;

/**
 * The replacement money (€) a choice of renewals commits, of the money available (not the blocked part).
 * @param {"little" | "planned" | "all"} option
 * @param {number} available_eur
 */
export function renewalsOf(option, available_eur) {
  const planned = Math.min(available_eur, PROGRAMME.planned_eur);
  if (option === "little") return Math.round(PROGRAMME.little * planned);
  return option === "all" ? Math.min(available_eur, PROGRAMME.capacity_eur) : planned;
}

/**
 * The delay minutes one fault costs, and the hours of overtime per fault.
 *
 * A shift is a sample of its year. With reports of the year's shifts, each gives an estimate:
 * an "operations" report (the signaller's) that had a fault, its delay minutes per fault ×
 * `DELAY.network_per_station`; a "maintenance" report (the dispatcher's), its `restore_min` ×
 * `DELAY.per_restore_min`. The minutes per fault are the mean of the estimates; the overtime per
 * fault is the dispatcher's overtime by its faults. Without an estimate, the game's own model: the
 * minutes to restore by the number of teams (`STAFF.restore_min`, × `STAFF.no_on_call` with nobody
 * on call) × `DELAY.per_restore_min`.
 * @param {{teams: number, on_call: boolean}} staff
 * @param {Array<object>} [reports] payloads of the performance reports of the year's shifts
 * @returns {{minutes: number, overtime_h: number, from: "shift" | "model", parts: Array<{kind: string, minutes: number, text: string}>}}
 */
export function minutesPerFault(staff, reports = []) {
  const parts = [];
  for (const r of reports) {
    if (r.kind === "operations" && r.faults > 0 && Number.isFinite(r.delay_min)) {
      const m = (DELAY.network_per_station * r.delay_min) / r.faults;
      parts.push({ kind: r.kind, minutes: m, text: `the signaller's ${r.delay_min} delay minutes for ${r.faults} fault${r.faults === 1 ? "" : "s"} × ${DELAY.network_per_station} for the network = ${round(m, 1)}` });
    } else if (r.kind === "maintenance" && Number.isFinite(r.restore_min)) {
      const m = DELAY.per_restore_min * r.restore_min;
      parts.push({ kind: r.kind, minutes: m, text: `the dispatcher's ${r.restore_min} min to restore × ${DELAY.per_restore_min} = ${round(m, 1)}` });
    }
  }
  const mnt = reports.filter((r) => r.kind === "maintenance" && Number.isFinite(r.overtime_h));
  const overtime_h = mnt.length
    ? mnt.reduce((a, r) => a + r.overtime_h, 0) / Math.max(1, mnt.reduce((a, r) => a + (r.faults || 0), 0))
    : staff.on_call ? STAFF.overtime_h_per_fault[staff.teams] : 0;
  if (parts.length) return { minutes: round(parts.reduce((a, p) => a + p.minutes, 0) / parts.length, 1), overtime_h, from: "shift", parts };
  return { minutes: round(DELAY.per_restore_min * STAFF.restore_min[staff.teams] * (staff.on_call ? 1 : STAFF.no_on_call), 1), overtime_h, from: "model", parts };
}

/**
 * A budget year of the district as numbers: the faults and speed restrictions from the grade, the
 * delay minutes and what they cost under the performance regime, the overtime, the share of
 * inspections on time, and the grade at the year's end.
 * @param {{grade: number, monitoring: boolean, permanent: number, arriving_eur: number}} state the grade at the year's start, whether condition monitoring works, the permanent speed restrictions, the renewals of the year before that come into the grade
 * @param {{strategy: keyof STRATEGIES, committed_eur: number, teams: number, on_call: boolean}} plan
 * @param {Array<object>} [reports] payloads of the performance reports of the year's shifts
 */
export function yearOf(state, plan, reports = []) {
  const s = STRATEGIES[plan.strategy];
  const faults = Math.round(FAULTS_YEAR.at_grade_3 * FAULTS_YEAR.growth ** (state.grade - 3) * s.faults * (state.monitoring ? MONITORING.faults : 1));
  const restrictions = Math.max(0, Math.round((state.grade - RESTRICTIONS.from_grade) * RESTRICTIONS.per_grade)) + state.permanent;
  const fault = minutesPerFault(plan, reports);
  const forward_eur = Math.max(0, plan.committed_eur - PROGRAMME.planned_eur);
  const delay = {
    faults: Math.round(faults * fault.minutes),
    possessions: Math.round(((plan.committed_eur + forward_eur) / 1e6) * DELAY.possession_min_per_meur),
    restrictions: restrictions * DELAY.restriction_min,
  };
  const delay_min = delay.faults + delay.possessions + delay.restrictions;
  const overtime_h = Math.round(faults * fault.overtime_h);
  // in hundredths of a grade, so that the year's account adds up as it is written
  const improved = round((state.arriving_eur / 1e6) * GRADE_PER_MEUR, 2);
  return {
    faults, restrictions, fault, delay, delay_min, regime_eur: delay_min * REGIME_EUR_PER_MIN,
    overtime_h, overtime_eur: overtime_h * STAFF.overtime_eur_h,
    inspections_pct: Math.min(100, s.inspections_pct + (state.monitoring ? MONITORING.inspections_pct : 0)),
    wear: s.wear, improved, grade: clamp(round(state.grade + s.wear - improved, 2), 1, 6),
  };
}

/**
 * The computer's asset manager, by the book: standard maintenance, the planned renewals (with
 * measures pulled forward when the programme alone would leave money unused), two emergency teams
 * and a technician on call, and what the ALV proposes is approved.
 */
export class AssetManagerPlayer extends Player {
  /** @param {AssetManagerGame} g */
  think(g) {
    const all = g.money.available_eur;
    const pick = { strategy: "standard", renewals: renewalsOf("planned", all) >= all ? "planned" : "all", teams: "2", "on-call": "yes", proposal: "approve" };
    for (const d of g.open) g.act("decide", d.id, pick[d.id] ?? d.fallback ?? d.options[0].id);
  }
}

export class AssetManagerGame extends Game {
  static id = "asset-manager";
  static title = "Budget Years";
  static role = "asset-manager";
  static kind = "simulation";
  static description = "Steer the condition of the district around Bf Neustadt through three to five budget years: choose the maintenance strategy, commit the federal replacement money before it is lost, set the emergency teams, and approve, defer or decline what the asset responsible proposes.";
  static scale = "years";
  static takes = [
    { flow: "budget", from: ["bundestag-budget-mp"] },
    { flow: "performance-report" },
  ];
  static gives = [
    { flow: "staff-plan", to: ["maintenance-dispatcher", "maintenance-district-manager"] },
    { flow: "asset-condition" },
    { flow: "performance-report" },
  ];
  static actions = {
    ...Game.actions,
    setPlan: { label: "Set the year's plan" },
  };
  static player = AssetManagerPlayer;

  /** @param {{seed?: number, level?: keyof LEVELS, conditions?: object, wired?: Iterable<string>}} [options] */
  constructor(options = {}) {
    super({ ...options, level: LEVELS[options.level] ? options.level : "normal" });
    const lv = LEVELS[this.level];
    /** The condition grade of the network (1 very good … 6 unusable). */
    this.grade = lv.grade;
    /** The budget year (the session's round), how many there are, and the year as the session names it (its calendar year, else the round). */
    this.year = 0;
    this.rounds = null;
    this.calendar = null;
    /** "idle" | "plan" (the decisions are open) | "planned" (the year runs) | "review" (the year is settled, its report not yet given) */
    this.stage = "idle";
    /** Whether last year's target was missed: the network begins worse than the target. */
    this.missed = lv.grade > TARGET_GRADE;
    /** The year's plan; before a decision, last year's choice. */
    this.plan = { ...LAST_YEAR };
    /** The ALV's proposal of this year, a defect that is deferred, the year condition monitoring was fitted, permanent speed restrictions. */
    this.proposal = null;
    this.deferred = null;
    this.monitoring = null;
    this.permanent = 0;
    this._seen = new Set();
    this._again = false;
    this._noMonitoring = false;
    /** The years: plan, money and, once settled, what the year brought. */
    this.years = [];
    this.resource("maintenance", "Maintenance money left", 0, "€");
    this.resource("replacement", "Replacement money not committed", 0, "€");
    this.resource("regime", "Paid under the performance regime", 0, "€");
    this._setMoney();
    /** The renewals built last year (€): they come into the grade this year. */
    this.arriving_eur = renewalsOf("planned", this.money.available_eur);
    /** The starting level of the delay minutes: what the first year brings with last year's plan. */
    this.reference_min = this._reference([]);
    this._read = 0;
    this.log(`${DISTRICT.name}: ${TRACK_KM} km of track at grade ${this.grade.toFixed(2)} (target ${TARGET_GRADE}); last year ${num(this.reference_min)} delay minutes came from the infrastructure.`);
  }

  /* ---------------------------------------------------------------- the money of the year */

  /** The year's money: the budget MP's (or the mission's), else the level's; without a budget MP, cut after a missed target. */
  _setMoney() {
    const lv = LEVELS[this.level], b = this.conditions.budget ?? {};
    const cut = !this.isWired("budget") && this.missed;
    const of = (v, d) => Math.max(0, Math.round((Number.isFinite(v) ? v : d) * (cut ? 1 - MISSED_CUT : 1)));
    const maintenance_eur = of(b.maintenance_eur, lv.maintenance_eur), renewal_eur = of(b.renewal_eur, lv.renewal_eur);
    const blocked_eur = clamp(Number.isFinite(b.blocked_eur) ? b.blocked_eur : lv.blocked_eur, 0, renewal_eur);
    /** @type {{maintenance_eur: number, renewal_eur: number, blocked_eur: number, available_eur: number, condition: string | null, cut: boolean}} */
    this.money = { maintenance_eur, renewal_eur, blocked_eur, available_eur: renewal_eur - blocked_eur, condition: b.condition ?? null, cut };
    this.resource("maintenance", "Maintenance money left", maintenance_eur, "€");
    this.resource("replacement", "Replacement money not committed", this.money.available_eur, "€");
  }

  _moneyText() {
    const m = this.money;
    return `${eur(m.maintenance_eur)} for maintenance (own funds) and ${eur(m.renewal_eur)} of replacement money (federal, LuFV)${m.blocked_eur ? `, ${eur(m.blocked_eur)} of it blocked${m.condition ? ` (${m.condition})` : ""}` : ""}${m.cut ? `; both cut by ${MISSED_CUT * 100} % because last year's target was missed` : ""}`;
  }

  _state() {
    return { grade: this.grade, monitoring: this.monitoring != null && this.monitoring < this.year, permanent: this.permanent, arriving_eur: this.arriving_eur };
  }

  /** The delay minutes of the first year with last year's plan, at what a fault costs (the shift's reports, or the model). */
  _reference(reports) {
    return yearOf({ grade: LEVELS[this.level].grade, monitoring: false, permanent: 0, arriving_eur: 0 }, { ...LAST_YEAR, committed_eur: renewalsOf("planned", this.money.available_eur) }, reports).delay_min;
  }

  /* ---------------------------------------------------------------- phases */

  begin(ctx) {
    if (this.over) return;
    if (ctx.phase?.id === "review") {
      // a mission without a plan phase: last year's plan again
      if (this.stage === "idle") this._plan(ctx);
      if (this.stage === "plan") this._book();
      if (this.stage === "planned") this._settle();
      return;
    }
    if (this.stage === "plan" || (this.stage === "planned" && this.year === ctx.round)) return;
    // a mission without a review phase: the year is settled when the next begins
    if (this.stage === "planned") this._settle();
    if (this.stage === "review") this._report();
    if (!this.over) this._plan(ctx);
  }

  finish(ctx) {
    if (ctx.phase?.id !== "review") {
      if (this.stage === "plan" && !this.over) this._book();
      return;
    }
    if (this.stage === "review") this._report();
    if (!this.over && ctx.rounds != null && ctx.round >= ctx.rounds) this.end(`Year ${this.year} is over: grade ${this.grade.toFixed(2)} (target ${TARGET_GRADE}).`);
  }

  /** The plan phase begins: the year's money, the ALV's proposal, the decisions. */
  _plan(ctx) {
    this.year = ctx.round;
    this.calendar = ctx.year ?? ctx.round;
    this.rounds = ctx.rounds ?? this.rounds;
    this.t = (this.year - 1) * SCALE_S.years;
    this.stage = "plan";
    this._setMoney();
    this.log(`Year ${this.year}${this.rounds ? ` of ${this.rounds}` : ""}: grade ${this.grade.toFixed(2)} (target ${TARGET_GRADE}). The money: ${this._moneyText()}.`, "year");
    this.proposal = this._propose();
    this.plan = { ...this.plan, proposal: this.proposal ? "defer" : null };
    const p = this.plan, yr = `Year ${this.year}`;
    this.ask({
      id: "strategy", title: `${yr}: the maintenance strategy`,
      text: `What the production unit (Produktionsdurchführung) does for the maintenance money. ${Object.values(STRATEGIES).map((s) => `${s.label}, ${eur(s.cost_eur)}: wear ${s.wear.toFixed(2)} of a grade a year, ${s.faults === 1 ? "" : `${Math.round(Math.abs(s.faults - 1) * 100)} % ${s.faults > 1 ? "more" : "fewer"} faults, `}${s.inspections_pct} % of inspections on time.`).join(" ")} The EBA asks ${INSPECTIONS_PCT} % on time.`,
      options: Object.entries(STRATEGIES).map(([id, s]) => ({ id, label: `${s.label}: ${eur(s.cost_eur)}` })),
      fallback: p.strategy, then: (o) => (this.plan.strategy = o),
    });
    this._askRenewals();
    this.ask({
      id: "teams", title: `${yr}: the emergency teams`,
      text: `The staff plan of the maintenance dispatcher. Fewer teams, longer until a fault is restored and the trains run again. A team costs ${eur(STAFF.team_eur)} a year.`,
      options: [1, 2, 3].map((n) => ({ id: String(n), label: `${n} team${n === 1 ? "" : "s"}: ${eur(n * STAFF.team_eur)}` })),
      fallback: String(p.teams), then: (o) => (this.plan.teams = Number(o)),
    });
    this.ask({
      id: "on-call", title: `${yr}: a technician on call`,
      text: `At night and at weekends a technician on call can be called in when the teams are not enough: ${eur(STAFF.on_call_eur)} a year for standing by, each call-out paid as overtime.`,
      options: [{ id: "yes", label: `A technician on call: ${eur(STAFF.on_call_eur)}` }, { id: "no", label: "Nobody on call" }],
      fallback: p.on_call ? "yes" : "no", then: (o) => (this.plan.on_call = o === "yes"),
    });
    const q = this.proposal;
    if (q?.kind === "defect") {
      this.ask({
        id: "proposal", title: `${yr}: ${ALV}, the asset responsible (ALV), proposes ${q.again ? "again " : ""}to repair ${q.asset}`,
        text: `The inspection found: ${q.finding}. The repair costs ${eur(q.cost_eur)} of the maintenance money${q.again ? " (more than last year: the damage grows)" : ""}. Deferred, it is watched more closely for ${eur(DEFER.watch_eur)}, and it can fail. Declined, a permanent speed restriction (La) takes its place: safe, and delay minutes every year.`,
        options: [
          { id: "approve", label: `Approve: repair it this year (${eur(q.cost_eur)})` },
          { id: "defer", label: `Defer it a year (${eur(DEFER.watch_eur)})` },
          { id: "decline", label: "Decline: a permanent speed restriction instead" },
        ],
        fallback: "defer", then: (o) => (this.plan.proposal = o),
      });
    } else if (q) {
      this.ask({
        id: "proposal", title: `${yr}: ${ALV}, the asset responsible (ALV), proposes ${q.again ? "again " : ""}to fit condition monitoring`,
        text: `Switch diagnosis on the district's points and remote monitoring of its level crossings: ${eur(q.cost_eur)} of the maintenance money, ${Math.round((1 - MONITORING.faults) * 100)} % fewer faults from next year, and fewer inspections by hand.`,
        options: [
          { id: "approve", label: `Approve: fit it this year (${eur(q.cost_eur)})` },
          { id: "defer", label: "Defer: ask again next year" },
          { id: "decline", label: "Decline: keep inspecting by hand" },
        ],
        fallback: "defer", then: (o) => (this.plan.proposal = o),
      });
    }
  }

  _askRenewals() {
    const m = this.money;
    this.ask({
      id: "renewals", title: `Year ${this.year}: the renewals`,
      text: `${eur(m.available_eur)} of replacement money (federal, LuFV) can be spent this year${m.blocked_eur ? `; ${eur(m.blocked_eur)} more are blocked` : ""}. What is not committed by the year's end is lost. Renewals need possessions this year (delay minutes) and show in the grade a year later.`,
      options: Object.entries(RENEWALS).map(([id, label]) => ({ id, label: `${label}: ${eur(renewalsOf(id, m.available_eur))}` })),
      fallback: this.plan.renewals, then: (o) => (this.plan.renewals = o),
    });
  }

  /** The ALV's proposal of the year, now and then: a defect deferred comes back; else the seed draws a known defect, condition monitoring, or nothing. */
  _propose() {
    if (this.deferred) return { ...this.deferred, cost_eur: Math.round(this.deferred.cost_eur * (1 + DEFER.dearer)), again: true };
    if (this._again) return { kind: "monitoring", cost_eur: MONITORING.cost_eur, again: true };
    const r = this.rng("proposal", this.year), u = r.next();
    const left = DEFECTS.filter((d) => !this._seen.has(d.id));
    if (u < PROPOSALS.defect && left.length) {
      const d = r.pick(left);
      this._seen.add(d.id);
      return { kind: "defect", ...d, again: false };
    }
    if (u < PROPOSALS.defect + PROPOSALS.monitoring && this.monitoring == null && !this._noMonitoring) return { kind: "monitoring", cost_eur: MONITORING.cost_eur, again: false };
    return null;
  }

  /** What the plan costs of the maintenance money, line by line. */
  _costs() {
    const p = this.plan, s = STRATEGIES[p.strategy], q = this.proposal;
    const rows = [
      { id: "strategy", label: "Maintenance strategy", choice: s.label, eur: s.cost_eur },
      { id: "teams", label: "Emergency teams", choice: String(p.teams), eur: p.teams * STAFF.team_eur },
      { id: "on-call", label: "Technician on call", choice: p.on_call ? "yes" : "no", eur: p.on_call ? STAFF.on_call_eur : 0 },
    ];
    if (q) rows.push({ id: "proposal", label: q.kind === "defect" ? `Repair of ${q.asset}` : "Condition monitoring", choice: p.proposal, eur: p.proposal === "approve" ? q.cost_eur : p.proposal === "defer" && q.kind === "defect" ? DEFER.watch_eur : 0 });
    return rows;
  }

  /** The plan phase ends: the plan's costs are booked, the staff plan and the condition of the assets are given. */
  _book() {
    for (const d of this.open) this.decide(d.id, d.fallback ?? d.options[0].id, { auto: true });
    const p = this.plan, m = this.money, q = this.proposal, yr = `Year ${this.year}`;
    const costs = this._costs(), planned = costs.reduce((a, c) => a + c.eur, 0);
    const committed = renewalsOf(p.renewals, m.available_eur);
    this.add("maintenance", -planned);
    this.add("replacement", -committed);
    this.log(`${yr}, the plan: ${STRATEGIES[p.strategy].label.toLowerCase()} maintenance (${eur(costs[0].eur)}), ${teamsText(p.teams, p.on_call)} (${eur(costs[1].eur + costs[2].eur)}): ${eur(planned)} of the ${eur(m.maintenance_eur)} for maintenance are planned${q ? ", the ALV's proposal included" : ""}.`, "plan");
    this.log(`${yr}, the renewals: ${eur(committed)} of the ${eur(m.available_eur)} available are committed (${RENEWALS[p.renewals].toLowerCase()}).`, "plan");
    if (q?.kind === "defect") {
      if (p.proposal === "approve") {
        this.deferred = null;
        this.log(`${yr}: ${q.asset} is repaired (${eur(q.cost_eur)}).`, "proposal");
      } else if (p.proposal === "defer") {
        this.deferred = { ...q };
        this.log(`${yr}: the repair of ${q.asset} is deferred; it is watched more closely (${eur(DEFER.watch_eur)}).`, "proposal");
      } else {
        this.deferred = null;
        this.permanent += 1;
        this.log(`${yr}: no repair of ${q.asset}: a permanent speed restriction (La) instead. A cut in capacity that is more than slight would need the EBA's approval (AEG § 11).`, "proposal");
      }
    } else if (q) {
      this._again = p.proposal === "defer";
      if (p.proposal === "approve") {
        this.monitoring = this.year;
        this.log(`${yr}: condition monitoring is fitted (${eur(q.cost_eur)}): ${Math.round((1 - MONITORING.faults) * 100)} % fewer faults from next year.`, "proposal");
      } else if (p.proposal === "decline") this._noMonitoring = true;
    }
    const exp = yearOf(this._state(), { ...p, committed_eur: committed });
    this.years.push({ year: this.year, label: this.calendar, grade: this.grade, money: { ...m }, plan: { ...p }, proposal: q ? { kind: q.kind, asset: q.asset ?? null } : null, planned_eur: planned, committed_eur: committed, settled: false });
    this.stage = "planned";
    this.give("staff-plan", { teams: p.teams, on_call: p.on_call });
    this.give("asset-condition", { grade: round(this.grade, 2), faults_year: exp.faults, restrictions: exp.restrictions });
    this.log(`${yr}: the maintenance dispatcher gets ${teamsText(p.teams, p.on_call)}; the condition report: grade ${this.grade.toFixed(2)}, about ${exp.faults} faults and ${exp.restrictions} speed restriction${exp.restrictions === 1 ? "" : "s"} (La) this year.`, "plan");
  }

  /** The review phase: the year plays out, line by line into the log. */
  _settle() {
    const y = this.years.at(-1), p = y.plan, m = y.money, yr = `Year ${y.year}`;
    this.t = y.year * SCALE_S.years;
    const reports = this.inbox.slice(this._read).filter((x) => x.flow === "performance-report").map((x) => x.payload ?? {}).filter((r) => r.kind === "operations" || r.kind === "maintenance");
    this._read = this.inbox.length;
    const state = this._state(), s = STRATEGIES[p.strategy];
    const r = yearOf(state, { ...p, committed_eur: y.committed_eur }, reports);
    if (!this.years.some((x) => x.settled)) this.reference_min = this._reference(reports);

    this.log(`${yr}: ${r.faults} faults at grade ${state.grade.toFixed(2)} (${FAULTS_YEAR.at_grade_3} at grade 3.0${s.faults === 1 ? "" : `; × ${s.faults} for ${s.label.toLowerCase()} maintenance`}${state.monitoring ? `; × ${MONITORING.faults} with condition monitoring` : ""}).`, "fault");
    this.log(r.fault.from === "shift"
      ? `${yr}: a fault cost ${r.fault.minutes} delay minutes, from the shift's reports: ${r.fault.parts.map((x) => x.text).join("; ")}${r.fault.parts.length > 1 ? "; their mean" : ""}.`
      : `${yr}: a fault cost ${r.fault.minutes} delay minutes (${teamsText(p.teams, p.on_call)}: ${round(r.fault.minutes / DELAY.per_restore_min, 1)} min to restore × ${DELAY.per_restore_min} trains held).`, "fault");
    this.log(`${yr}: ${num(r.delay_min)} delay minutes: ${num(r.delay.faults)} from the faults, ${num(r.delay.possessions)} from the possessions for ${eur(y.committed_eur)} of renewals, ${num(r.delay.restrictions)} from ${r.restrictions} speed restriction${r.restrictions === 1 ? "" : "s"} (starting level: ${num(this.reference_min)}).`, "delay");
    this.log(`${yr}: the performance regime (Anreizsystem): ${num(r.delay_min)} min × €${REGIME_EUR_PER_MIN} = ${eur(r.regime_eur)} paid to the railway undertakings.`, "money");
    this.log(`${yr}: ${num(r.overtime_h)} h of overtime${reports.some((x) => x.kind === "maintenance") ? " (the dispatcher's shift, by its faults)" : ""}: ${eur(r.overtime_eur)}.`, "money");
    this.add("maintenance", -(r.regime_eur + r.overtime_eur));
    this.add("regime", r.regime_eur);
    const left = this.value("maintenance"), over = Math.max(0, -left), unspent = this.value("replacement");
    this.log(`${yr}, the maintenance money: ${eur(m.maintenance_eur - left)} spent of ${eur(m.maintenance_eur)}: ${over ? `overrun by ${eur(over)}` : `${eur(left)} left`}.`, "money");
    this.log(`${yr}, the replacement money: ${eur(y.committed_eur)} drawn of ${eur(m.available_eur)}${unspent > 0 ? `; ${eur(unspent)} not spent are lost at the year's end` : ""}${m.blocked_eur ? `; ${eur(m.blocked_eur)} stayed blocked` : ""}.`, "money");
    if (r.inspections_pct < INSPECTIONS_PCT) this.violate("inspections-late", `${yr}: the EBA's audit finds only ${r.inspections_pct} % of the inspections on time (asked: ${INSPECTIONS_PCT} %).`, 2);
    else this.log(`${yr}: ${r.inspections_pct} % of the inspections on time (asked: ${INSPECTIONS_PCT} %).`, "audit");
    this.log(`${yr}, the grade: ${state.grade.toFixed(2)} + ${r.wear.toFixed(2)} wear (${s.label.toLowerCase()} maintenance) − ${r.improved.toFixed(2)} for last year's renewals of ${eur(state.arriving_eur)} = ${r.grade.toFixed(2)} (target ${TARGET_GRADE}).`, "grade");

    this.grade = r.grade;
    this.arriving_eur = y.committed_eur;
    this.missed = this.grade > TARGET_GRADE;
    Object.assign(y, {
      settled: true, faults: r.faults, restrictions: r.restrictions, minutes_per_fault: r.fault.minutes, from: r.fault.from,
      delay_min: r.delay_min, regime_eur: r.regime_eur, overtime_h: r.overtime_h, inspections_pct: r.inspections_pct,
      spent_eur: m.maintenance_eur - left, overrun_eur: over, unspent_eur: Math.max(0, unspent), grade_end: r.grade, missed: this.missed,
      value: {
        delay: clamp(1 - (r.delay_min / Math.max(1, this.reference_min) - 1) / SCORE.delay_span, 0, 1),
        budget: m.maintenance_eur > 0 ? clamp(1 - over / m.maintenance_eur / SCORE.overrun_span, 0, 1) : over ? 0 : 1,
        used: m.available_eur > 0 ? clamp(1 - unspent / m.available_eur / SCORE.unused_span, 0, 1) : 1,
        inspections: clamp((r.inspections_pct - SCORE.inspections_none_pct) / (INSPECTIONS_PCT - SCORE.inspections_none_pct), 0, 1),
      },
    });
    this.stage = "review";
    if (this.missed && !this.isWired("budget") && !(this.rounds && y.year >= this.rounds)) this.log(`${yr}: the target is missed (grade ${this.grade.toFixed(2)}, target ${TARGET_GRADE}): next year's money is cut by ${MISSED_CUT * 100} %.`, "money");
    // a known defect that was deferred: each year it stays, it can fail
    const d = this.deferred;
    if (d && p.proposal === "defer") {
      if (this.rng("accident", y.year).next() < DEFER.accident_chance) {
        this.violate("deferred-defect", `${yr}: a train derails at ${d.asset}. ${ALV} had reported the defect (${d.finding}); its repair was deferred.`, 3);
        this.end(`${yr}: an accident caused by a known defect that was deferred. The round ends at once; an investigation follows.`);
        // a session asks nothing more of a game that has ended: the year's report goes out now
        this._report();
      } else this.log(`${yr}: ${d.asset} held this year; the defect is still there.`, "proposal");
    }
  }

  /** The year's account for those who steer and pay. `spent_eur`: maintenance money spent and replacement money drawn; `unspent_eur`: replacement money that was available and is lost. */
  _report() {
    const y = this.years.at(-1);
    this.stage = "idle";
    this.give("performance-report", {
      scope: DISTRICT.name, kind: "infrastructure", year: y.label, grade: round(y.grade_end, 2), target: TARGET_GRADE,
      faults_year: y.faults, delay_min_year: y.delay_min, spent_eur: y.spent_eur + y.committed_eur, unspent_eur: y.unspent_eur,
      overtime_h: y.overtime_h, score: this.score().total,
    });
  }

  /* ---------------------------------------------------------------- flows, moves */

  /**
   * The budget of the year replaces the money to plan with while the plan is open. A budget for the
   * running year that arrives after the plan was booked (the budget MP decides in the same phase)
   * replaces the year's money too: the plan's choices stay. Any other budget is next year's. The
   * shift's reports are read at the year's end.
   */
  take(msg) {
    if (msg.flow !== "budget") return;
    if (this.stage === "plan") {
      this._setMoney();
      this.log(`Year ${this.year}: the budget has arrived: ${this._moneyText()}.`, "money");
      if (this.open.some((d) => d.id === "renewals")) this._askRenewals();
    } else if (this.stage === "planned" && msg.payload?.year != null && msg.payload.year === this.calendar) {
      const y = this.years.at(-1);
      this._setMoney();
      Object.assign(y, { money: { ...this.money }, committed_eur: renewalsOf(y.plan.renewals, this.money.available_eur) });
      this.add("maintenance", -y.planned_eur);
      this.add("replacement", -y.committed_eur);
      this.log(`Year ${this.year}: the budget has arrived after the plan: ${this._moneyText()}. The plan stays: ${eur(y.planned_eur)} of the maintenance money are planned, ${eur(y.committed_eur)} of renewals are committed.`, "money");
    }
  }

  /**
   * Set or change the year's plan in one move, while the plan phase is open.
   * @param {keyof STRATEGIES} strategy
   * @param {"little" | "planned" | "all"} renewals
   * @param {number | string} teams 1 to 3
   * @param {boolean | "yes" | "no"} onCall
   * @returns {{ok: boolean, reason?: string}}
   */
  setPlan(strategy, renewals, teams, onCall) {
    if (this.stage !== "plan") return { ok: false, reason: "The year's plan is set at the start of the year." };
    const n = Number(teams), call = onCall === true || onCall === "yes";
    if (!STRATEGIES[strategy]) return { ok: false, reason: "There is no such maintenance strategy." };
    if (!RENEWALS[renewals]) return { ok: false, reason: "There is no such choice of renewals." };
    if (![1, 2, 3].includes(n)) return { ok: false, reason: "The staff plan has 1, 2 or 3 emergency teams." };
    for (const [id, option] of [["strategy", strategy], ["renewals", renewals], ["teams", String(n)], ["on-call", call ? "yes" : "no"]]) {
      if (!this.decide(id, option)) {
        const d = this.decisions.findLast((x) => x.id === id);
        if (d) d.made = option;
      }
    }
    Object.assign(this.plan, { strategy, renewals, teams: n, on_call: call });
    return { ok: true };
  }

  /* ---------------------------------------------------------------- the score */

  objectives() {
    const done = this.years.filter((y) => y.settled), n = done.length;
    const mean = (f) => (n ? done.reduce((a, y) => a + f(y), 0) / n : 1);
    const overruns = done.filter((y) => y.overrun_eur > 0), lost = done.reduce((a, y) => a + y.unspent_eur, 0);
    return [
      { id: "grade", label: "Network condition", weight: 35, value: clamp(1 - (this.grade - TARGET_GRADE) / SCORE.grade_span, 0, 1), note: `grade ${this.grade.toFixed(2)}, target ${TARGET_GRADE}` },
      { id: "delay", label: "Delay minutes", weight: 25, value: mean((y) => y.value.delay), note: n ? `${num(mean((y) => y.delay_min))} a year on average, starting level ${num(this.reference_min)}` : `starting level ${num(this.reference_min)} a year` },
      { id: "money", label: "Money", weight: 25, value: 0.5 * mean((y) => y.value.budget) + 0.5 * mean((y) => y.value.used), note: `maintenance money overrun in ${overruns.length} of ${n} years${overruns.length ? ` (${eur(overruns.reduce((a, y) => a + y.overrun_eur, 0))})` : ""}; ${eur(lost)} of replacement money lost` },
      { id: "inspections", label: "Inspections on time", weight: 15, value: mean((y) => y.value.inspections), note: n ? `${round(mean((y) => y.inspections_pct), 1)} % on average, asked: ${INSPECTIONS_PCT} %` : `asked: ${INSPECTIONS_PCT} %` },
    ];
  }

  /* ---------------------------------------------------------------- for a page */

  view() {
    const m = this.money, p = this.plan, planning = this.stage === "plan" && !this.over;
    const done = this.years.filter((y) => y.settled), last = done.at(-1);
    const costs = this._costs(), planned = costs.reduce((a, c) => a + c.eur, 0);
    const left = planning ? m.maintenance_eur - planned : this.value("maintenance");
    const committed = planning ? renewalsOf(p.renewals, m.available_eur) : m.available_eur - this.value("replacement");
    const open = new Set(this.open.map((d) => d.id));
    const mark = (id, text) => (planning && open.has(id) ? `${text} (not decided yet)` : text);
    const tables = [];
    if (this.stage === "plan" || this.stage === "planned") {
      tables.push({
        id: "plan", title: `The plan of year ${this.year}`, columns: ["Decision", "Choice", "Cost"],
        rows: [
          ...costs.map((c) => [c.label, mark(c.id, c.choice), eur(c.eur)]),
          ["Maintenance money", `${eur(planned)} planned of ${eur(m.maintenance_eur)}`, left < 0 ? `${eur(-left)} too much` : `${eur(left)} left`],
          ["Renewals (replacement money)", mark("renewals", RENEWALS[p.renewals]), `${eur(committed)} of ${eur(m.available_eur)}`],
        ],
      });
    }
    if (last) {
      tables.push({
        id: "account", title: `The account of year ${last.year}`, columns: ["", "Year's end"],
        rows: [
          ["Faults", num(last.faults)],
          ["Delay minutes per fault", `${last.minutes_per_fault} (${last.from === "shift" ? "from the shift's reports" : "the model"})`],
          ["Delay minutes", `${num(last.delay_min)} (starting level ${num(this.reference_min)})`],
          ["Paid under the performance regime", eur(last.regime_eur)],
          ["Overtime", `${num(last.overtime_h)} h`],
          ["Maintenance money", `${eur(last.spent_eur)} of ${eur(last.money.maintenance_eur)}${last.overrun_eur ? ": overrun" : ""}`],
          ["Replacement money", `${eur(last.committed_eur)} of ${eur(last.money.available_eur)}${last.unspent_eur ? `, ${eur(last.unspent_eur)} lost` : ""}`],
          ["Inspections on time", `${last.inspections_pct} %`],
          ["Grade", `${last.grade.toFixed(2)} → ${last.grade_end.toFixed(2)}`],
        ],
      });
    }
    tables.push({
      id: "years", title: "The years", columns: ["Year", "Grade at the end", "Faults", "Delay minutes", "Maintenance money", "Replacement money lost", "Inspections on time"], empty: "No year is settled yet.",
      rows: done.map((y) => [y.year, y.grade_end.toFixed(2), y.faults, num(y.delay_min), `${eur(y.spent_eur)} of ${eur(y.money.maintenance_eur)}`, eur(y.unspent_eur), `${y.inspections_pct} %`]),
    });
    return {
      figures: [
        { label: "Year", value: this.rounds ? `${this.year} of ${this.rounds}` : Math.max(1, this.year) },
        { label: `Condition grade (target ${TARGET_GRADE})`, value: this.grade.toFixed(2), tone: this.grade <= TARGET_GRADE ? "ok" : this.grade <= TARGET_GRADE + SCORE.grade_span / 2 ? "warn" : "bad" },
        { label: "Maintenance money left", value: eur(Math.abs(left)), unit: left < 0 ? "too much" : "", tone: left < 0 ? "bad" : "ok" },
        { label: "Replacement money committed", value: `${eur(committed)} of ${eur(m.available_eur)}`, tone: committed < m.available_eur ? "warn" : "ok" },
        ...(last ? [
          { label: "Delay minutes last year", value: num(last.delay_min), unit: "min", tone: last.delay_min <= this.reference_min ? "ok" : "warn" },
          { label: "Inspections on time", value: last.inspections_pct, unit: "%", tone: last.inspections_pct >= INSPECTIONS_PCT ? "ok" : "bad" },
        ] : []),
        ...(this.deferred ? [{ label: "Known defect deferred", value: this.deferred.asset, tone: "bad" }] : []),
      ],
      tables,
      actions: planning ? [{
        name: "setPlan", label: "Set the year's plan", primary: true,
        fields: [
          { id: "strategy", label: "Maintenance strategy", value: p.strategy, options: Object.entries(STRATEGIES).map(([id, s]) => ({ id, label: `${s.label}: ${eur(s.cost_eur)}` })) },
          { id: "renewals", label: "Renewals", value: p.renewals, options: Object.entries(RENEWALS).map(([id, label]) => ({ id, label: `${label}: ${eur(renewalsOf(id, m.available_eur))}` })) },
          { id: "teams", label: "Emergency teams", value: String(p.teams), options: [1, 2, 3].map((n) => ({ id: String(n), label: `${n}: ${eur(n * STAFF.team_eur)}` })) },
          { id: "on_call", label: `A technician on call (${eur(STAFF.on_call_eur)})`, type: "check", value: p.on_call },
        ],
      }] : [],
    };
  }
}
