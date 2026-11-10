/**
 * The budget committee's rail rapporteur (Berichterstatter/in für den Verkehrsetat (Schiene) im
 * Haushaltsausschuss), "The Night Session" (Bereinigungssitzung): a turn game, one round a budget year.
 *
 * In the **night session** (every phase that is not the review) the rapporteur has the ministry's
 * draft of the rail lines on the table: replacement investment in the existing network (LuFV), the
 * maintenance contribution, the corridor refurbishments, new and upgraded lines (Bedarfsplan) with a
 * project in the rapporteur's own constituency, digitalisation, the track access charge subsidy, and
 * DB's capital need. A ceiling stands above them (the debt brake), the coalition partner wants one
 * line raised or kept, and the Bundesrechnungshof says which lines are padded: a line can only spend
 * what its projects can build with, and money beyond that stays unused. The rapporteur moves money
 * between the lines in steps, may put a qualified block (qualifizierter Sperrvermerk) on a line
 * until a report is delivered, ties money to the constituency's project, and chooses a grant or
 * equity for DB: equity is a financial transaction outside the debt brake, but it raises the capital
 * base on which the track access charges are calculated.
 *
 * In the **review** the year's account comes back: money spent against money granted on every line
 * (Mittelabfluss), projects stopped for lack of money, the network's condition, the higher charges of
 * the railway undertakings, the constituency's project, and the coalition partner's mood. A partner
 * whose demand is ignored two years running leaves: the coalition breaks over the budget, and the
 * game is lost whatever the score.
 *
 * In a session the adopted budget goes to the asset manager as the district's money (a fixed share
 * of the national lines), and the asset manager's report of the year replaces the game's own model
 * of the existing network. Alone, the game plays the year itself.
 *
 * Simplified from the catalogue's 20 to 30 lines to six and the capital need; one ceiling stands for
 * the debt brake of the core budget and the yearly plan of the special fund (which has its own, outside
 * the debt brake); every line is treated as investment money that can be carried over; the amounts
 * are of the order of the federal rail money (roughly €20–25 bn a year), not those of a real budget.
 * @module arail/game/budget
 */
import { Game, Player } from "./core.js";

/** One step of the night's bargaining (€): money moves between the lines in steps of €100 M. */
export const STEP_EUR = 100e6;
/** The first budget year of a game; its night session is in the November before. */
export const FIRST_YEAR = 2027;
/**
 * The district's share of the two national lines for the existing network: 0.5 %, a small district
 * of about 165 km of the 33,000 km of lines (simplified: by length alone, whatever the traffic and
 * the condition). With the draft adopted unchanged this is about €10 M for maintenance and about
 * €32 M for replacement a year.
 */
export const DISTRICT_SHARE = 0.005;
/** DB's capital need a year (€): paid as a grant under the ceiling, or as equity outside it. */
export const CAPITAL_EUR = 5e9;
/**
 * What equity adds to the track access charges, a year and for good (a share of the equity paid in):
 * the return the infrastructure manager has to earn on its capital base, simplified to 2 %. An
 * injection of €5 bn makes the railway undertakings' charges €100 M a year higher.
 */
export const EQUITY_RETURN = 0.02;
/** A qualified block holds back this share of a line's money (a fifth, as the texts say) until the committee releases it. */
export const BLOCK_SHARE = 0.2;
/**
 * The share of blocked money that is still spent in its year: after a block the auditors had a
 * reason for, the report comes in spring and the money is released; after a block without a
 * finding, the ministry has nothing to report on and the release comes in autumn.
 */
export const BLOCK_SPENT = { founded: 0.85, unfounded: 0.4 };
/** Money spent (Mittelabfluss): full marks from this share of the money available, none at or below the other. */
export const MITTELABFLUSS = { good: 0.99, bad: 0.9 };
/** What a finding of the auditors that no block answered takes from the marks for the money spent (each, of 1). */
export const UNANSWERED_FINDING = 0.1;
/** A project line that falls this share short of what it can build with stops one project; at `two`, two. */
export const STOP_SHORTFALL = { one: 0.1, two: 0.25 };
/** The track access charge subsidy: no marks when it falls this share short of what the undertakings' charges need. */
export const CHARGES_SHORTFALL = 0.4;
/**
 * The network's condition as a grade (1 very good … 6 unusable, as the flow `asset-condition`): where
 * it starts and has to stay, how much a fully paid year gains, what a year loses per share of the
 * existing network's money that is missing, and how far above the target no marks are left.
 */
export const GRADE = { start: 3.0, target: 3.0, gain: 0.03, per_shortfall: 1, span: 0.4 };
/** The project in the rapporteur's constituency, a part of the Bedarfsplan line: built in stages, one a year. */
export const PROJECT = { name: "Upgrade of the line Bergheim–Talsee", stages: 4, stage_eur: STEP_EUR };
/** The coalition partner's rapporteur (a bird name, see CONTRIBUTING.md). */
export const PARTNER = "E. Wiedehopf";

/**
 * The rail lines of the draft (simplified from the 20 to 30 of a real budget). `as`: its name inside a
 * sentence; `can_eur`: what the
 * line can spend in a usual year (each year it is a little more or less); `pad_steps`: by how much
 * the ministry pads it when it does (steps, from … to); `under_steps`: by how much the draft falls
 * short of the existing network's need; `condition`: the report a block on it can ask for.
 */
export const LINES = [
  {
    id: "renewal", name: "Replacement investment in the existing network (LuFV)", as: "the replacement investment (LuFV)", kind: "network", can_eur: 6.8e9, vary: 1, under_steps: [2, 3], condition: "condition-report",
    why: "The infrastructure condition report shows more worn assets due than the draft pays for.",
    finding: "DB InfraGO has not delivered this year's infrastructure condition report: nobody can check where the replacement money goes.",
  },
  {
    // the Bund's contribution to maintenance, possible since the amendment of the BSWAG; most maintenance money is the infrastructure manager's own, from track access charges
    id: "maintenance", name: "Maintenance contribution (Instandhaltung)", as: "the maintenance contribution", kind: "network", can_eur: 2.1e9, vary: 1, under_steps: [1, 1], condition: "condition-report",
    why: "The maintenance backlog needs more than the draft pays for.",
    finding: "The maintenance money is not shown by line and asset class: nobody can check what it buys.",
  },
  {
    id: "corridors", name: "Corridor refurbishments (Generalsanierung, special fund)", as: "the corridor refurbishments", kind: "project", can_eur: 3.6e9, vary: 1, pad_steps: [4, 6], condition: "cash-flow-plan",
    why: "Two corridor closures were moved to next year.", stop: "a corridor refurbishment is put off by a year",
    finding: "The corridors cost far more than first estimated, and no updated cost and cash-flow plan was delivered.",
  },
  {
    id: "bedarfsplan", name: "New and upgraded lines (Bedarfsplan)", as: "the new and upgraded lines (Bedarfsplan)", kind: "project", can_eur: 3.0e9, vary: 1, pad_steps: [4, 6], condition: "cash-flow-plan",
    why: "Two projects have no planning approval yet.", stop: "the construction of a new line stops for a year",
    finding: "Three projects have overrun their cost, and no updated cost and cash-flow plan was delivered.",
  },
  {
    id: "digital", name: "Digitalisation (ETCS, digital interlockings)", as: "digitalisation", kind: "project", can_eur: 1.4e9, vary: 1, pad_steps: [4, 5], condition: "cash-flow-plan",
    why: "The suppliers cannot deliver more interlockings and ETCS equipment this year.", stop: "a digital interlocking waits a year",
    finding: "The roll-out of ETCS has no agreed cost and cash-flow plan.",
  },
  {
    id: "charges", name: "Track access charge subsidy (Trassenpreisförderung)", as: "the track access charge subsidy", kind: "charges", can_eur: 0.5e9, vary: 0, condition: "charges-concept",
    why: "", finding: "",
  },
];

/** The reports a qualified block can wait for. */
export const CONDITIONS = [
  { id: "condition-report", label: "The infrastructure condition report (Infrastrukturzustands- und -entwicklungsbericht) is delivered" },
  { id: "cash-flow-plan", label: "An updated cost and cash-flow plan of the projects is delivered" },
  { id: "charges-concept", label: "A concept for the reform of the track access charges is delivered" },
];

/**
 * Levels. `ceiling`: what it is measured from ("draft": the draft's total; "needs": what the lines
 * can use, the partner's demand included), whether DB's capital need fits under it as a grant, and
 * the steps of room above that (below, when negative). `raise_every`: the partner wants a line
 * raised every so many years (0: never; it only wants a line kept), by `raise_steps` (from … to).
 * `audit_years`: the years (from … to) in which the auditors recommend a block. `delay`: whether the
 * constituency's project loses a year to an objection.
 */
export const LEVELS = {
  training: { label: "Training: the draft fits under the ceiling", ceiling: { from: "draft", capital: true, room_steps: 2 }, raise_every: 0, raise_steps: [0, 0], audit_years: [2, 2], delay: false },
  normal: { label: "Normal: a ceiling below the draft, a partner who wants more every other year", ceiling: { from: "needs", capital: true, room_steps: 1 }, raise_every: 2, raise_steps: [2, 2], audit_years: [2, 3], delay: true },
  hard: { label: "Hard: a tight ceiling, a partner who wants more every year", ceiling: { from: "needs", capital: false, room_steps: -3 }, raise_every: 1, raise_steps: [3, 4], audit_years: [1, 99], delay: true },
};

/** The short questions: budget law in a sentence each, asked when the night or the account brings them up. */
const QUESTIONS = {
  regionalisation: {
    title: "Why can you not move the Regionalisierungsmittel tonight?",
    options: [
      { id: "law", label: "They are not a title of the rail lines: the Regionalisierungsgesetz (RegG) fixes them as the Länder's share of the Bund's tax revenue", correct: true },
      { id: "db", label: "They are DB's own money, earned with track access charges" },
      { id: "fund", label: "They are a line of the special fund, and that is fixed for twelve years" },
    ],
  },
  block: {
    title: "What does a qualified blocking note (qualifizierter Sperrvermerk) on a line do?",
    options: [
      { id: "committee", label: "The money stays in the budget, but may only be spent once the budget committee has released it (Entsperrung), here: after the report", correct: true },
      { id: "finance", label: "The money stays in the budget, and the finance ministry alone releases it" },
      { id: "cut", label: "The money is taken out of the budget and has to be voted again next year" },
    ],
  },
  "carry-over": {
    title: "What happens to investment money that was not spent by the end of the year?",
    options: [
      { id: "remainder", label: "It can be carried over as a spending remainder (Ausgaberest) and be spent in a later year: nothing was built with it this year", correct: true },
      { id: "lapse", label: "It lapses at midnight and is lost to the railway for good" },
      { id: "db", label: "DB keeps it as a reserve of its own" },
    ],
  },
};

const toM = (eur) => Math.round(eur / 1e6) * 1e6;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lower = (s) => s[0].toLowerCase() + s.slice(1);
const isReview = (ctx) => ctx?.phase?.id === "review";
const lineDef = (id) => LINES.find((l) => l.id === id);
const pct = (share) => `${(100 * share).toFixed(1)} %`;

/** An amount in words: "€6.8 bn", "€300 M", "€32.5 M". */
export function money(eur) {
  if (Math.abs(eur) >= 1e9) return `€${(eur / 1e9).toFixed(Math.round(eur / 1e6) % 100 === 0 ? 1 : 2)} bn`;
  return `€${Math.round(eur / 1e5) / 10} M`;
}

/**
 * The computer's rapporteur, careful and by the auditors' figures: every line gets what it can use
 * (the padded lines are cut first, the existing network is paid in full), the coalition partner
 * gets its demand, DB's capital need is a grant when it fits under the ceiling and equity when it
 * does not, a block only where the auditors found a reason, the constituency's project by its
 * cash-flow plan, every question right. Under a ceiling too tight for all of that, the project
 * lines that can bear it best give a step each; the existing network is the last to give.
 */
export class BudgetPlayer extends Player {
  /** @param {BudgetGame} g */
  think(g) {
    for (const d of g.open) if (d.id.startsWith("quiz-")) g.act("decide", d.id, g.rightAnswer(d.id));
    const y = g.planning;
    if (!y) return;
    const open = (id) => g.open.some((d) => d.id === id);
    if (open(`constituency-${y.year}`)) g.act("decide", `constituency-${y.year}`, y.project.can ? "stage" : "wait");
    if (y.issue && !y.blocks[y.issue.line]) g.act("block", y.issue.line, y.issue.condition);
    // what each line can use, and the partner's demand
    const need = new Map(y.lines.map((l) => [l.id, l.hint_eur ?? l.asked_eur]));
    const want = new Map(need);
    want.set(y.demand.line, Math.max(want.get(y.demand.line), y.demand.target_eur));
    const sum = () => [...want.values()].reduce((a, b) => a + b, 0);
    const equity = sum() + y.capital.need_eur > y.ceiling_eur;
    if (open(`capital-${y.year}`)) g.act("decide", `capital-${y.year}`, equity ? "equity" : "grant");
    const limit = y.ceiling_eur - (y.capital.mode === "grant" ? y.capital.need_eur : 0);
    // too tight: a step from the line that loses the smallest share of what it can use
    const kept = 1 - BLOCK_SHARE * (1 - BLOCK_SPENT.founded);
    const short = (id) => 1 - ((want.get(id) - STEP_EUR) * (y.blocks[id] ? kept : 1)) / Math.max(STEP_EUR, need.get(id));
    while (sum() > limit) {
      const able = y.lines.filter((l) => want.get(l.id) >= STEP_EUR);
      const pool = [able.filter((l) => l.kind !== "network" && l.id !== y.demand.line), able.filter((l) => l.id !== y.demand.line), able].find((p) => p.length);
      if (!pool) break;
      const l = pool.reduce((a, b) => (short(b.id) < short(a.id) ? b : a));
      want.set(l.id, want.get(l.id) - STEP_EUR);
    }
    // equity makes the undertakings' charges higher: the subsidy takes that up as far as there is room
    const charges = need.get("charges") + g.charges(y);
    while (want.get("charges") + STEP_EUR <= charges && sum() + STEP_EUR <= limit) want.set("charges", want.get("charges") + STEP_EUR);
    // move the money: from the lines that get less to those that get more
    const diff = y.lines.map((l) => ({ id: l.id, n: Math.round((want.get(l.id) - l.now_eur) / STEP_EUR) }));
    const less = diff.filter((d) => d.n < 0), more = diff.filter((d) => d.n > 0);
    for (const a of less) {
      for (const b of more) {
        const n = Math.min(-a.n, b.n);
        if (n <= 0) continue;
        g.act("shift", a.id, b.id, n);
        a.n += n;
        b.n -= n;
      }
      if (a.n < 0) g.act("cut", a.id, -a.n);
    }
    for (const b of more) if (b.n > 0) g.act("raise", b.id, b.n);
  }
}

export class BudgetGame extends Game {
  static id = "budget";
  static title = "The Night Session";
  static role = "bundestag-budget-mp";
  static kind = "both";
  static description = "The budget committee's night session (Bereinigungssitzung), year after year: move money between the rail lines of the ministry's draft until it fits under the ceiling, weigh the auditors' hints against the coalition partner's demand, block money until a report is delivered, choose a grant or equity for DB, and read in the year's account what was spent and what stopped.";
  static scale = "years";
  static takes = [
    { flow: "performance-report", from: ["asset-manager"] },
  ];
  static gives = [
    { flow: "budget", to: ["asset-manager"] },
    { flow: "funding-decision" },
  ];
  static actions = {
    ...Game.actions,
    shift: { label: "Move money between two lines" },
    cut: { label: "Cut a line" },
    raise: { label: "Raise a line" },
    block: { label: "Set a qualified block" },
    unblock: { label: "Take a block back" },
  };
  static player = BudgetPlayer;

  /** @param {{seed?: number, level?: keyof LEVELS, conditions?: object, wired?: Iterable<string>}} [options] */
  constructor(options = {}) {
    super({ ...options, level: LEVELS[options.level] ? options.level : "normal" });
    /**
     * The budget years so far, the last one on the table or in its account. A year: `n` (1, 2, …),
     * `year`, `lines` (`{id, name, as, kind, asked_eur, now_eur, can_eur, carry_eur, hint_eur, hint}`),
     * `capital` (`{need_eur, mode: "grant" | "equity"}`), `ceiling_eur`, `demand` (`{line, kind:
     * "raise" | "keep", target_eur, text}`), `issue` (the auditors' finding that a block answers, or
     * null), `blocks` (line → condition), `project` (`{stage, can, earmark}`), then `adopted`,
     * `budget` (what the district got), `report` (the asset manager's) and `account`.
     * @type {object[]}
     */
    this.years = [];
    /** Answers to the short questions: id → correct. */
    this.answers = new Map();
    this._asked = new Set();
    /** Whether the coalition has broken over the budget. */
    this.broken = false;
    /** The year (1, 2, …) the constituency's project loses to an objection (0: none). */
    this.delayYear = LEVELS[this.level].delay ? 2 + this.rng("project").int(2) : 0;
    this._provisional = 0;
    this.log("The rapporteurs for the transport budget (Einzelplan 12) meet for the night session (Bereinigungssitzung).");
  }

  /** The last year: on the table, adopted, or in its account. */
  get current() {
    return this.years.at(-1) ?? null;
  }

  /** The year on the table in the night session, or null (adopted, in review, or the game over). */
  get planning() {
    const y = this.current;
    return y && !y.adopted && !this.over ? y : null;
  }

  /** What counts against the ceiling: the lines, and DB's capital need when it is a grant. */
  total(y = this.current) {
    if (!y) return 0;
    if (y.adopted) return y.adopted.total_eur;
    return y.lines.reduce((a, l) => a + l.now_eur, 0) + (y.capital.mode === "grant" ? y.capital.need_eur : 0);
  }

  /** What the equity paid in up to a year (that year's included) adds to the track access charges, a year (€). */
  charges(y = this.current) {
    if (!y) return 0;
    return Math.round(EQUITY_RETURN * this.years.filter((x) => x.n <= y.n && x.capital.mode === "equity").reduce((a, x) => a + x.capital.need_eur, 0));
  }

  /** The stages of the constituency's project built so far. */
  get built() {
    return this.years.reduce((a, y) => a + (y.account?.built ?? 0), 0);
  }

  /* ---------------------------------------------------------------- the phases of a year */

  begin(ctx) {
    if (this.over) return;
    if (isReview(ctx)) this._review();
    else this._plan();
  }

  finish(ctx) {
    if (isReview(ctx)) return; // the account was booked when the review began; a late report books it again (take)
    if (this.over) this._carryOn();
    else this._adopt();
  }

  /** The night session begins: the draft, the ceiling, the partner's demand, the auditors' notes, and the year's decisions. */
  _plan() {
    if (this.planning) return; // a second phase of the same night
    if (this.current && !this.current.account) {
      // a mission without a review: the year is settled before the next night
      this._review();
      if (this.over) return;
    }
    const y = this._draft(this.years.length + 1);
    this.years.push(y);
    const asked = y.lines.reduce((a, l) => a + l.asked_eur, 0) + y.capital.need_eur;
    this.log(`${y.year}: the ministry's draft of the rail lines comes to ${money(asked)}; the ceiling is ${money(y.ceiling_eur)}.`, "draft");
    this.log(`${y.year}: ${lower(y.demand.text)}`, "partner");
    if (y.issue) this.log(`${y.year}: Bundesrechnungshof on ${y.issue.as}: ${y.issue.text} It recommends a qualified block until ${lower(y.issue.label)}.`, "audit");
    this.ask({
      id: `capital-${y.year}`, title: `DB's capital need of ${money(y.capital.need_eur)} in ${y.year}: a grant or equity?`,
      text: "The draft has it as a grant. Decide before the night ends.",
      options: [
        { id: "grant", label: "A grant (Baukostenzuschuss)", hint: "Counts against the debt brake: it has to fit under the ceiling with the other lines. The track access charges stay as they are." },
        { id: "equity", label: "An equity injection into DB", hint: `A financial transaction: it does not count against the debt brake. But it raises DB InfraGO's capital base, on which the track access charges are calculated: about ${money(EQUITY_RETURN * y.capital.need_eur)} a year more for the railway undertakings, from now on.` },
      ],
      fallback: "grant",
      then: (o) => {
        y.capital.mode = o;
        this.log(`${y.year}: DB's capital need is paid as ${o === "equity" ? `equity, outside the ceiling; the track access charges rise by ${money(EQUITY_RETURN * y.capital.need_eur)} a year` : "a grant, under the ceiling"}.`, "capital");
      },
    });
    if (y.project.stage) {
      const one = money(PROJECT.stage_eur), two = money(2 * PROJECT.stage_eur);
      this.ask({
        id: `constituency-${y.year}`, title: `Your constituency: stage ${y.project.stage} of ${PROJECT.stages} of the ${lower(PROJECT.name)}`,
        text: y.project.can ? `The project's cash-flow plan: stage ${y.project.stage} has its planning approval and can build for ${one} this year, no more.` : `The project's cash-flow plan: an objection holds up the planning approval of stage ${y.project.stage}. Nothing can be built this year.`,
        options: [
          { id: "stage", label: `Tie ${one} of the Bedarfsplan line to the stage` },
          { id: "wait", label: "Tie nothing to it this year" },
          { id: "double", label: `Tie ${two} to it: two stages at once`, hint: "The money is taken from the other projects of the line." },
        ],
        fallback: "stage",
        then: (o) => {
          y.project.earmark = { stage: 1, wait: 0, double: 2 }[o];
        },
      });
    }
    if (y.n === 1) this._quiz("regionalisation", `${PARTNER}, the coalition partner's rapporteur, proposes to pay for the partner's demand from the Regionalisierungsmittel.`);
    if (y.issue) this._quiz("block", "The Bundesrechnungshof recommends one for the first time.");
  }

  /**
   * The draft of a year: what every line can spend, where the ministry padded it and where it fell
   * short, the remainders carried over, the ceiling, the partner's demand, the auditors' finding.
   * It does not depend on the player's moves, except for the remainders and the project's stage.
   */
  _draft(n) {
    const lv = LEVELS[this.level], r = this.rng("draft", n);
    const between = ([lo, hi]) => lo + r.int(hi - lo + 1);
    const year = FIRST_YEAR + n - 1, before = this.years[n - 2] ?? null;
    // two of the three project lines are padded
    const order = LINES.filter((l) => l.kind === "project").map((l) => ({ id: l.id, k: r.next() })).sort((a, b) => a.k - b.k).map((x) => x.id);
    const padded = new Set(order.slice(0, 2));
    const stage = this.built < PROJECT.stages ? this.built + 1 : 0, can = stage && n !== this.delayYear ? 1 : 0;
    const lines = LINES.map((def) => {
      const full = Math.round(def.can_eur / STEP_EUR) + (def.vary ? between([-1, 1]) : 0);
      const pad = def.pad_steps ? between(def.pad_steps) : 0, under = def.under_steps ? between(def.under_steps) : 0;
      const waits = def.id === "bedarfsplan" && stage && !can;
      const asked_eur = (full + (padded.has(def.id) ? pad : 0) - under) * STEP_EUR, can_eur = (full - (waits ? 1 : 0)) * STEP_EUR;
      const carry_eur = before?.account?.lines[def.id].unspent_eur ?? 0, fresh = Math.max(0, can_eur - carry_eur);
      const why = [
        ...(padded.has(def.id) || under ? [def.why] : []),
        ...(waits ? ["The stage in your constituency cannot be built this year."] : []),
        ...(carry_eur ? [`${money(carry_eur)} of remainders (Ausgabereste) from ${year - 1} are still there.`] : []),
      ];
      const hint_eur = fresh !== asked_eur ? fresh : null;
      return {
        id: def.id, name: def.name, as: def.as, kind: def.kind, asked_eur, now_eur: asked_eur, can_eur, carry_eur, hint_eur,
        hint: hint_eur == null ? "" : `Bundesrechnungshof: ${why.length ? `${why.join(" ")} ` : ""}The line can use ${money(fresh)} of fresh money this year.`,
      };
    });
    const by = Object.fromEntries(lines.map((l) => [l.id, l]));
    // the coalition partner: a line raised above the draft, or kept at it; never the same line two years running
    const rd = this.rng("demand", n), raise = lv.raise_every > 0 && (n - 1) % lv.raise_every === 0;
    const all = raise ? ["charges", order[2], "maintenance"] : ["charges", order[2]], pool = all.filter((id) => id !== before?.demand.line);
    const dl = by[rd.pick(pool.length ? pool : all)], steps = raise ? lv.raise_steps[0] + rd.int(lv.raise_steps[1] - lv.raise_steps[0] + 1) : 0;
    const target_eur = dl.asked_eur + steps * STEP_EUR;
    const demand = {
      line: dl.id, kind: raise ? "raise" : "keep", target_eur,
      text: raise
        ? `The coalition partner wants ${dl.as} raised by ${money(steps * STEP_EUR)} above the draft, to ${money(target_eur)} at least.`
        : `The coalition partner wants ${dl.as} kept at the draft's ${money(target_eur)} at least.`,
    };
    // the auditors' finding that a qualified block answers
    const ra = this.rng("audit", n);
    let issue = null;
    if (n >= lv.audit_years[0] && n <= lv.audit_years[1]) {
      const def = lineDef(ra.pick(["renewal", "corridors", "bedarfsplan", "digital"]));
      issue = { line: def.id, as: def.as, condition: def.condition, label: CONDITIONS.find((c) => c.id === def.condition).label, text: def.finding, waste_eur: (3 + ra.int(2)) * STEP_EUR };
    }
    // the ceiling
    const needs = lines.reduce((a, l) => a + (l.id === demand.line ? Math.max(l.can_eur, target_eur) : l.can_eur), 0);
    const asked = lines.reduce((a, l) => a + l.asked_eur, 0) + CAPITAL_EUR, c = lv.ceiling;
    let ceiling_eur = (c.from === "draft" ? asked : needs + (c.capital ? CAPITAL_EUR : 0)) + c.room_steps * STEP_EUR;
    if (c.from !== "draft") ceiling_eur = Math.min(ceiling_eur, asked - STEP_EUR);
    return { n, year, lines, capital: { need_eur: CAPITAL_EUR, mode: "grant" }, ceiling_eur, demand, issue, blocks: {}, project: { stage, can, earmark: stage ? 1 : 0 }, adopted: null, budget: null, report: null, account: null };
  }

  /**
   * The night ends: a budget within the ceiling is adopted as written; one above it is not, and the
   * committee cuts every line by the same share. The district's money goes to the asset manager.
   */
  _adopt() {
    const y = this.planning;
    if (!y) return;
    const fixed = y.capital.mode === "grant" ? y.capital.need_eur : 0, sum = y.lines.reduce((a, l) => a + l.now_eur, 0);
    const within = sum + fixed <= y.ceiling_eur, factor = within || !sum ? 1 : Math.max(0, (y.ceiling_eur - fixed) / sum);
    const lines = Object.fromEntries(y.lines.map((l) => [l.id, within ? l.now_eur : Math.floor((l.now_eur * factor) / 1e6) * 1e6]));
    const total_eur = Object.values(lines).reduce((a, b) => a + b, 0) + fixed;
    y.adopted = { within, factor, lines, total_eur, demand_met: lines[y.demand.line] >= y.demand.target_eur };
    if (within) this.log(`${y.year}: the budget of the rail lines is adopted: ${money(total_eur)} under a ceiling of ${money(y.ceiling_eur)}${fixed ? "" : `, and ${money(y.capital.need_eur)} of equity outside it`}.`, "adopted");
    else this.log(`${y.year}: ${money(sum + fixed)} do not fit under the ceiling of ${money(y.ceiling_eur)}. Your budget is not adopted: the committee cuts every line by ${pct(1 - factor)}.`, "cut");
    this.log(`${y.year}: ${y.adopted.demand_met ? "the coalition partner has what it asked for." : `the coalition partner did not get what it asked for. ${PARTNER}: "Not a second time."`}`, "partner");
    for (const [id, condition] of Object.entries(y.blocks)) {
      const def = lineDef(id), founded = y.issue?.line === id && y.issue.condition === condition;
      if (founded) this.log(`${y.year}: a fifth of ${def.as} is blocked until ${lower(CONDITIONS.find((c) => c.id === condition).label)}.`, "block");
      else if (def.kind === "network") this.violate("block-without-reason", `${y.year}: a qualified block on ${def.as} without a finding of the auditors: the works of the closure season wait for money the committee holds back, and the press pins the late trains on you.`, 2);
      else this.violate("block-without-reason", `${y.year}: a qualified block on ${def.as} without a finding of the auditors: the ministry has nothing to report on, and the money waits until autumn.`, 1);
    }
    if (y.project.earmark > 1) this.violate("pork-barrel", `${y.year}: two stages at once for the rapporteur's own constituency, taken from the other projects of the line: the press calls it pork-barrel politics.`, 1);
    // the district of the other role games: its share of the two lines for the existing network
    const block = y.blocks.renewal ? CONDITIONS.find((c) => c.id === y.blocks.renewal) : null;
    y.budget = {
      year: y.year, maintenance_eur: Math.round(DISTRICT_SHARE * lines.maintenance), renewal_eur: Math.round(DISTRICT_SHARE * lines.renewal),
      blocked_eur: block ? Math.round(DISTRICT_SHARE * BLOCK_SHARE * lines.renewal) : 0, condition: block ? block.label : null,
    };
    this.give("budget", y.budget);
    if (y.project.stage) this.give("funding-decision", { year: y.year, measure: `${PROJECT.name}, stage ${y.project.stage}`, eur: y.project.earmark * PROJECT.stage_eur, approved: y.project.earmark > 0 });
  }

  /** After the coalition has broken there is no budget: the district works on with last year's money. */
  _carryOn() {
    const last = this.years.findLast((y) => y.budget);
    if (!last) return;
    this._provisional += 1;
    const year = this.current.year + this._provisional;
    this.log(`${year}: no budget is adopted. Under provisional budget management (vorläufige Haushaltsführung) the existing network works on with last year's money; nothing new starts.`, "provisional");
    this.give("budget", { ...last.budget, year, blocked_eur: 0, condition: null });
  }

  /** The review begins: the year's account, the coalition partner's mood, and a question about it. */
  _review() {
    const y = this.current;
    if (!y?.adopted || y.account) return;
    y.account = this._account(y);
    this._tell(y);
    const before = this.years[y.n - 2];
    if (!y.adopted.demand_met && before && !before.adopted.demand_met) {
      this.broken = true;
      this.violate("coalition-broken", `${y.year}: two budgets running without what the coalition partner asked for. ${PARTNER} tells the press that the partner will not vote for another one.`, 3);
      this.end("The coalition breaks over the budget.");
      return;
    }
    this._quiz("carry-over", y.account.unspent_eur ? `${money(y.account.unspent_eur)} of the rail lines of ${y.year} were not spent by 31 December.` : "");
  }

  /**
   * The account of an adopted year, from what was granted, what each line could spend, the blocks
   * and, for the existing network, the asset manager's report when there is one. The district is
   * taken as a sample of the network: the share of its money that it spent is the share spent of
   * the two national lines, and its grade and target are the network's.
   */
  _account(y) {
    const before = this.years[y.n - 2]?.account ?? null, charges_eur = this.charges(y);
    const r = y.report, rep = r && r.spent_eur + r.unspent_eur > 0 ? r : null;
    const lines = {}, stopped = [];
    let built = 0;
    for (const l of y.lines) {
      const def = lineDef(l.id), granted_eur = y.adopted.lines[l.id], available_eur = granted_eur + l.carry_eur;
      const block = y.blocks[l.id] ?? null, founded = !!block && y.issue?.line === l.id && y.issue.condition === block;
      const blocked_eur = block ? toM(BLOCK_SHARE * granted_eur) : 0;
      const usable = available_eur - blocked_eur + toM(blocked_eur * (founded ? BLOCK_SPENT.founded : BLOCK_SPENT.unfounded));
      // the subsidy can take up what equity adds to the undertakings' charges
      const can_eur = l.can_eur + (l.id === "charges" ? charges_eur : 0);
      let spent_eur;
      if (rep && def.kind === "network") spent_eur = toM((available_eur * rep.spent_eur) / (rep.spent_eur + rep.unspent_eur));
      else if (l.id === "bedarfsplan") {
        // the money tied to the constituency's stage comes first, and only the stage can build with it
        const stage = y.project.can * PROJECT.stage_eur, tied = Math.min(y.project.earmark * PROJECT.stage_eur, usable), here = Math.min(tied, stage);
        built = stage > 0 && here >= stage ? 1 : 0;
        spent_eur = here + Math.max(0, Math.min(usable - tied, can_eur - stage));
      } else spent_eur = Math.min(usable, can_eur);
      const waste_eur = y.issue?.line === l.id && !founded ? Math.min(spent_eur, y.issue.waste_eur) : 0;
      const shortfall = can_eur > 0 ? Math.max(0, 1 - spent_eur / can_eur) : 0;
      const stops = def.kind === "project" ? (shortfall > STOP_SHORTFALL.two ? 2 : shortfall > STOP_SHORTFALL.one ? 1 : 0) : 0;
      for (let i = 0; i < stops; i++) stopped.push(def.stop);
      lines[l.id] = { granted_eur, carry_eur: l.carry_eur, available_eur, blocked_eur, founded, can_eur, spent_eur, unspent_eur: available_eur - spent_eur, waste_eur, shortfall, stops };
    }
    const sumOf = (k, f = () => true) => y.lines.filter(f).reduce((a, l) => a + lines[l.id][k], 0);
    const available_eur = sumOf("available_eur"), spent_eur = sumOf("spent_eur"), waste_eur = sumOf("waste_eur");
    const net = (l) => l.kind === "network", was = before?.grade ?? GRADE.start;
    const funded = Math.min(1, sumOf("spent_eur", net) / sumOf("can_eur", net));
    const grade = rep?.grade != null ? rep.grade : Math.round(100 * Math.max(1, Math.min(6, was - GRADE.gain + GRADE.per_shortfall * (1 - funded)))) / 100;
    const target = rep?.target ?? GRADE.target;
    // a block on the district's replacement money counts as lifted when the district spent into it
    const lifted = y.budget?.blocked_eur ? (rep ? rep.unspent_eur < y.budget.blocked_eur : lines.renewal.founded) : null;
    return {
      year: y.year, lines, available_eur, spent_eur, unspent_eur: available_eur - spent_eur, waste_eur, share: available_eur ? (spent_eur - waste_eur) / available_eur : 1,
      stopped, grade, target, was, network: clamp01(1 - (grade - target) / GRADE.span), charges_eur, relief: clamp01(1 - lines.charges.shortfall / CHARGES_SHORTFALL),
      built, lifted, reported: !!rep,
    };
  }

  /** The year's account in the log. */
  _tell(y) {
    const a = y.account, at = `${y.year}, the year's account:`;
    this.log(`${at} ${money(a.spent_eur)} of ${money(a.available_eur)} spent (${pct(a.spent_eur / (a.available_eur || 1))})${a.unspent_eur ? `; ${money(a.unspent_eur)} are carried over as remainders (Ausgabereste)` : ""}.`, "account");
    for (const l of y.lines) {
      const x = a.lines[l.id];
      if (x.blocked_eur) this.log(`${at} the block on ${l.as} was lifted ${l.id === "renewal" && a.reported ? (a.lifted ? "when the district met its condition" : "too late for the district to spend the money") : x.founded ? "in spring, when the report came" : "only in autumn"}.`, "block");
      if (x.waste_eur) this.log(`${at} ${l.as} paid ${money(x.waste_eur)} of cost overruns that nobody had to explain: the auditors' finding stayed unanswered.`, "audit");
    }
    if (a.stopped.length) this.log(`${at} for lack of money ${a.stopped.join(", ")}.`, "stopped");
    this.log(`${at} the network's grade is ${a.grade.toFixed(2)} (${a.grade < a.was ? "better than" : a.grade > a.was ? "worse than" : "as"} the year before; the target is ${a.target.toFixed(1)})${a.reported ? ", by the asset manager's report" : ""}.`, "network");
    if (a.charges_eur) this.log(`${at} the equity paid into DB makes the track access charges ${money(a.charges_eur)} a year higher for the railway undertakings; the subsidy covers ${pct(1 - a.lines.charges.shortfall)} of what they need.`, "charges");
    if (y.project.stage) this.log(`${at} ${a.built ? `stage ${y.project.stage} of the ${lower(PROJECT.name)} is built` : `nothing was built on the ${lower(PROJECT.name)}`}.`, "constituency");
  }

  /* ---------------------------------------------------------------- the player's moves */

  _line(id) {
    return this.planning?.lines.find((l) => l.id === id) ?? null;
  }

  _steps(steps) {
    const n = Math.round(Number(steps));
    return n >= 1 ? n : 0;
  }

  /**
   * Move money from one line to another, in steps of €100 M.
   * @returns {{ok: boolean, reason?: string}}
   */
  shift(from, to, steps = 1) {
    if (!this.planning) return { ok: false, reason: "No budget is on the table now." };
    const a = this._line(from), b = this._line(to), n = this._steps(steps);
    if (!a || !b) return { ok: false, reason: "There is no such line." };
    if (a === b) return { ok: false, reason: "Choose two different lines." };
    if (!n) return { ok: false, reason: `Move at least one step of ${money(STEP_EUR)}.` };
    if (a.now_eur < n * STEP_EUR) return { ok: false, reason: `${a.name} has only ${money(a.now_eur)}.` };
    a.now_eur -= n * STEP_EUR;
    b.now_eur += n * STEP_EUR;
    this.log(`${this.planning.year}: ${money(n * STEP_EUR)} moved from ${a.as} to ${b.as}.`, "move");
    return { ok: true };
  }

  /**
   * Cut a line, in steps of €100 M: the money goes back to the finance minister.
   * @returns {{ok: boolean, reason?: string}}
   */
  cut(line, steps = 1) {
    if (!this.planning) return { ok: false, reason: "No budget is on the table now." };
    const a = this._line(line), n = this._steps(steps);
    if (!a) return { ok: false, reason: "There is no such line." };
    if (!n) return { ok: false, reason: `Cut at least one step of ${money(STEP_EUR)}.` };
    if (a.now_eur < n * STEP_EUR) return { ok: false, reason: `${a.name} has only ${money(a.now_eur)}.` };
    a.now_eur -= n * STEP_EUR;
    this.log(`${this.planning.year}: ${a.as} cut by ${money(n * STEP_EUR)} to ${money(a.now_eur)}.`, "move");
    return { ok: true };
  }

  /**
   * Raise a line, in steps of €100 M: the total has to stay under the ceiling by the end of the night.
   * @returns {{ok: boolean, reason?: string}}
   */
  raise(line, steps = 1) {
    if (!this.planning) return { ok: false, reason: "No budget is on the table now." };
    const a = this._line(line), n = this._steps(steps);
    if (!a) return { ok: false, reason: "There is no such line." };
    if (!n) return { ok: false, reason: `Raise by at least one step of ${money(STEP_EUR)}.` };
    a.now_eur += n * STEP_EUR;
    this.log(`${this.planning.year}: ${a.as} raised by ${money(n * STEP_EUR)} to ${money(a.now_eur)}.`, "move");
    return { ok: true };
  }

  /**
   * Put a qualified block on a line: a fifth of its money waits until the report named is delivered
   * and the committee releases it.
   * @returns {{ok: boolean, reason?: string}}
   */
  block(line, condition) {
    const y = this.planning;
    if (!y) return { ok: false, reason: "No budget is on the table now." };
    const a = this._line(line), c = CONDITIONS.find((x) => x.id === condition);
    if (!a) return { ok: false, reason: "There is no such line." };
    if (!c) return { ok: false, reason: "A qualified block names the report it waits for." };
    y.blocks[a.id] = c.id;
    this.log(`${y.year}: a qualified block on ${a.as}, until ${lower(c.label)}.`, "block");
    return { ok: true };
  }

  /**
   * Take a block back before the night ends.
   * @returns {{ok: boolean, reason?: string}}
   */
  unblock(line) {
    const y = this.planning;
    if (!y) return { ok: false, reason: "No budget is on the table now." };
    if (!y.blocks[line]) return { ok: false, reason: "There is no block on this line." };
    delete y.blocks[line];
    this.log(`${y.year}: the block on ${lineDef(line).as} is taken back.`, "block");
    return { ok: true };
  }

  /* ---------------------------------------------------------------- flows */

  /**
   * The asset manager's report of a year (kind "infrastructure"): the money the district spent and
   * left, its grade and target. It replaces the game's own model of the existing network in that
   * year's account, also when it comes after the review.
   */
  take(msg) {
    const p = msg.payload ?? {};
    if (msg.flow !== "performance-report" || p.kind !== "infrastructure") return;
    const y = this.years.find((x) => x.adopted && x.year === p.year) ?? this.years.findLast((x) => x.adopted && !x.report);
    if (!y) return;
    y.report = p;
    if (!y.account) return;
    for (const z of this.years) if (z.n >= y.n && z.account) z.account = this._account(z);
    const a = y.account;
    this.log(`${y.year}: the asset manager's report has come. The existing network is booked by it: ${pct((a.lines.renewal.spent_eur + a.lines.maintenance.spent_eur) / (a.lines.renewal.available_eur + a.lines.maintenance.available_eur || 1))} of its money spent, grade ${a.grade.toFixed(2)} (target ${a.target.toFixed(1)}).`, "account");
  }

  /* ---------------------------------------------------------------- the questions */

  /** The right answer to a short question (a decision `quiz-…`), for computer players and tests. */
  rightAnswer(decisionId) {
    return QUESTIONS[decisionId.replace(/^quiz-/, "")]?.options.find((o) => o.correct)?.id ?? null;
  }

  /** Ask a short question once; nobody answering counts as a wrong answer. */
  _quiz(id, text = "") {
    if (this._asked.has(id)) return;
    this._asked.add(id);
    const q = QUESTIONS[id];
    // the options in a drawn order: the right one is not always the first
    const r = this.rng("quiz", id);
    const options = q.options.map(({ id: o, label }) => ({ id: o, label, k: r.next() })).sort((a, b) => a.k - b.k).map(({ id: o, label }) => ({ id: o, label }));
    this.ask({
      id: `quiz-${id}`, title: q.title, text, options, fallback: q.options.find((o) => !o.correct).id,
      then: (o) => {
        const ok = !!q.options.find((x) => x.id === o)?.correct;
        this.answers.set(id, ok);
        this.log(ok ? "Right." : `Not quite: ${lower(q.options.find((x) => x.correct).label)}.`, ok ? "right" : "wrong");
      },
    });
  }

  /* ---------------------------------------------------------------- the score */

  objectives() {
    // a year adopted but not yet in its account counts by the game's own model
    const ys = this.years.filter((y) => y.adopted).map((y) => ({ y, a: y.account ?? this._account(y) })), n = ys.length;
    const mean = (f) => (n ? ys.reduce((s, x) => s + f(x), 0) / n : 1);
    const within = ys.filter((x) => x.y.adopted.within).length;
    const available = ys.reduce((s, x) => s + x.a.available_eur, 0), used = ys.reduce((s, x) => s + x.a.spent_eur - x.a.waste_eur, 0), share = available ? used / available : 1;
    const stopped = ys.reduce((s, x) => s + x.a.stopped.length, 0), last = ys.at(-1)?.a ?? null;
    const findings = ys.filter((x) => x.y.issue), answered = findings.filter((x) => x.a.lines[x.y.issue.line].founded).length;
    const met = ys.filter((x) => x.y.adopted.demand_met).length;
    const due = ys.reduce((s, x) => s + x.y.project.can, 0), built = ys.reduce((s, x) => s + x.a.built, 0), pork = this.violations.filter((v) => v.rule === "pork-barrel").length;
    const asked = [...this.answers.values()];
    return [
      { id: "ceiling", label: "The budget adopted within the ceiling", weight: 20, value: n ? within / n : 1, note: `${within} of ${n} budgets adopted as you wrote them` },
      { id: "spending", label: "Money spent (Mittelabfluss)", weight: 25, value: clamp01((share - MITTELABFLUSS.bad) / (MITTELABFLUSS.good - MITTELABFLUSS.bad)) - UNANSWERED_FINDING * (findings.length - answered), note: `${pct(share)} of ${money(available)} spent on what it was granted for; ${answered} of ${findings.length} findings of the auditors answered` },
      {
        id: "railway", label: "Projects, the network and the charges", weight: 25,
        value: mean((x) => 0.4 * Math.max(0, 1 - 0.5 * x.a.stopped.length) + 0.4 * x.a.network + 0.2 * x.a.relief),
        note: `${stopped} project${stopped === 1 ? "" : "s"} stopped for lack of money; network grade ${(last?.grade ?? GRADE.start).toFixed(2)} (target ${(last?.target ?? GRADE.target).toFixed(1)}); track access charges ${money(last?.charges_eur ?? 0)} a year higher`,
      },
      {
        id: "politics", label: "The coalition and the constituency", weight: 20,
        value: 0.6 * (this.broken ? 0 : n ? met / n : 1) + 0.4 * clamp01((due ? built / due : 1) - 0.25 * pork),
        note: `${this.broken ? "the coalition has broken" : `the partner's demand met in ${met} of ${n} years`}; ${built} of ${due} stages built in the constituency`,
      },
      { id: "knowledge", label: "Questions", weight: 10, value: asked.length ? asked.filter(Boolean).length / asked.length : 1, note: `${asked.filter(Boolean).length} of ${asked.length} right` },
    ];
  }

  /* ---------------------------------------------------------------- for a page */

  /** The game for a page that does not know it: the lines on the table, the last account, the years, and the night's moves. */
  view() {
    const y = this.current, plan = this.planning, done = this.years.findLast((x) => x.account) ?? null, a = done?.account ?? null;
    const figures = [];
    if (y) {
      const total = this.total(y), extra = this.charges(y);
      figures.push(
        { label: "Budget year", value: y.year },
        { label: plan ? "Total against the ceiling" : "Budget against the ceiling", value: `${money(total)} of ${money(y.ceiling_eur)}`, tone: total <= y.ceiling_eur ? "ok" : "bad" },
        { label: "Coalition partner", value: this.broken ? "has left the coalition" : this.years.findLast((x) => x.adopted)?.adopted.demand_met === false ? "angry: ignored last time" : "on board", tone: this.broken ? "bad" : this.years.findLast((x) => x.adopted)?.adopted.demand_met === false ? "warn" : "ok" },
        { label: "Network grade", value: (a?.grade ?? GRADE.start).toFixed(2), tone: (a?.grade ?? GRADE.start) <= (a?.target ?? GRADE.target) ? "ok" : "warn" },
        ...(a ? [{ label: `Money spent in ${done.year} (Mittelabfluss)`, value: (100 * a.share).toFixed(1), unit: "%", tone: a.share >= MITTELABFLUSS.good ? "ok" : a.share > MITTELABFLUSS.bad ? "warn" : "bad" }] : []),
        { label: "Constituency project", value: `${this.built} of ${PROJECT.stages} stages built` },
        ...(extra ? [{ label: "Track access charges", value: `${money(extra)} a year higher`, tone: "warn" }] : []),
      );
    }
    const notes = (l) => [
      l.hint,
      ...(y.demand.line === l.id ? [y.demand.text] : []),
      ...(y.issue?.line === l.id ? [`Bundesrechnungshof: ${y.issue.text} It recommends a qualified block until ${lower(y.issue.label)}.`] : []),
      ...(y.blocks[l.id] ? [`Blocked: a fifth of it, until ${lower(CONDITIONS.find((c) => c.id === y.blocks[l.id]).label)}.`] : []),
    ].filter(Boolean).join(" ");
    const state = (l, x) => [
      ...(x.blocked_eur ? [x.founded ? "block lifted in spring" : "block lifted in autumn"] : []),
      ...(x.waste_eur ? [`${money(x.waste_eur)} of overruns unexplained`] : []),
      ...(x.stops ? [lineDef(l.id).stop] : []),
      ...(l.kind === "network" && a.reported ? ["by the asset manager's report"] : []),
      ...(x.unspent_eur ? ["the rest carried over"] : []),
    ].join("; ");
    const asked = y ? y.lines.reduce((s, l) => s + l.asked_eur, 0) + y.capital.need_eur : 0;
    const lines = y ? [...y.lines].map((l) => ({ id: l.id, label: l.name })) : [];
    const steps = { id: "steps", label: "Steps", type: "number", min: 1, max: 20, step: 1, value: 1, unit: `× ${money(STEP_EUR)}` };
    return {
      figures,
      tables: [
        {
          id: "lines", title: y ? `The rail lines of ${y.year}` : "The rail lines", columns: ["Line", "Draft", plan ? "Now" : "Adopted", "Notes"], empty: "The draft comes with the night session.",
          rows: y ? [
            ...y.lines.map((l) => [l.name, money(l.asked_eur), money(y.adopted ? y.adopted.lines[l.id] : l.now_eur), notes(l)]),
            ["DB's capital need", money(y.capital.need_eur), y.capital.mode === "equity" ? "equity, outside the ceiling" : `${money(y.capital.need_eur)} as a grant`, y.capital.mode === "equity" ? `Makes the track access charges ${money(EQUITY_RETURN * y.capital.need_eur)} a year higher.` : ""],
            ["Total against the ceiling", money(asked), money(this.total(y)), `The ceiling: ${money(y.ceiling_eur)}.`],
          ] : [],
        },
        {
          id: "account", title: done ? `The account of ${done.year}` : "The year's account", columns: ["Line", "Available", "Spent", "Not spent", "What happened"], empty: "No year is settled yet.",
          rows: done ? done.lines.map((l) => [l.name, money(a.lines[l.id].available_eur), money(a.lines[l.id].spent_eur), money(a.lines[l.id].unspent_eur), state(l, a.lines[l.id])]) : [],
        },
        {
          id: "years", title: "The years", columns: ["Year", "Budget", "Money spent", "Projects stopped", "Network grade", "Partner's demand"], empty: "No budget is adopted yet.",
          rows: this.years.filter((x) => x.adopted).map((x) => [x.year, x.adopted.within ? "adopted" : `cut by ${pct(1 - x.adopted.factor)}`, x.account ? pct(x.account.share) : "–", x.account ? x.account.stopped.length : "–", x.account ? x.account.grade.toFixed(2) : "–", x.adopted.demand_met ? "met" : "ignored"]),
        },
      ],
      actions: plan ? [
        { name: "shift", label: "Move money between two lines", primary: true, fields: [{ id: "from", label: "From", options: lines }, { id: "to", label: "To", options: lines }, steps] },
        { name: "cut", label: "Cut a line", fields: [{ id: "line", label: "Line", options: lines }, steps] },
        { name: "raise", label: "Raise a line", fields: [{ id: "line", label: "Line", options: lines }, steps] },
        {
          name: "block", label: "Set a qualified block (qualifizierter Sperrvermerk)", hint: `A fifth of the line waits until the report is delivered and the committee releases the money.`,
          fields: [{ id: "line", label: "Line", options: lines }, { id: "condition", label: "Until", options: CONDITIONS }],
        },
        ...(Object.keys(plan.blocks).length ? [{ name: "unblock", label: "Take a block back", fields: [{ id: "line", label: "Line", options: Object.keys(plan.blocks).map((id) => ({ id, label: lineDef(id).name })) }] }] : []),
      ] : [],
    };
  }
}
