/**
 * Projects: renewals and upgrades through the service phases of the HOAI (Leistungsphasen 1–9),
 * with the gates of the German process between them:
 *
 *   LPH 1 basic evaluation → LPH 2 preliminary design (cost estimate, Kostenschätzung)
 *   → [upgrade: federal funding, needs a benefit-cost ratio (NKV) of at least 1]
 *   → [level crossing: crossing agreement with the road authority (EKrG)]
 *   → LPH 3 design (cost calculation, Kostenberechnung) → LPH 4 approval planning
 *   → [upgrade: planning approval by the EBA (Planfeststellung, AEG § 18); signalling: plan check]
 *   → LPH 5 execution planning (the possession is booked) → LPH 6 tender documents
 *   → LPH 7 procurement (direct award, framework call-off, open or negotiated procedure; bids; award)
 *   → [level crossing: the plant builds the system] → construction in the possession, LPH 8
 *   → acceptance (Abnahme) → [signalling, level crossings: commissioning approval by the EBA]
 *   → in service; LPH 9 follow-up during the warranty.
 *
 * A like-for-like renewal needs no planning approval (AEG § 18: only a change of the plan or the
 * elevation is a change). Decisions go to the roles (planner, funding authority, supervision, asset
 * manager) through the engine's inbox; the computer decides for the roles nobody plays.
 * @module arail/infra/projects
 */
import { ASSET_TYPES, MEASURES } from "./catalog.js";
import { stream } from "../ops/util.js";

const MONTH = 30.4 * 1440, DAYM = 1440;

/** The phases and gates, in order, with their labels. */
export const STAGES = {
  lph1: { label: "LPH 1 Basic evaluation", de: "Grundlagenermittlung", lph: 1, months: [0.5, 1, 2] },
  lph2: { label: "LPH 2 Preliminary design", de: "Vorplanung", lph: 2, months: [1, 2.5, 5] },
  funding: { label: "Federal funding", de: "Finanzierungsvereinbarung", gate: true },
  agreement: { label: "Crossing agreement (EKrG)", de: "Kreuzungsvereinbarung", gate: true },
  lph3: { label: "LPH 3 Design", de: "Entwurfsplanung", lph: 3, months: [1, 3, 6] },
  lph4: { label: "LPH 4 Approval planning", de: "Genehmigungsplanung", lph: 4, months: [0.5, 2, 4] },
  approval: { label: "Planning approval (EBA)", de: "Planfeststellung", gate: true },
  plancheck: { label: "Plan check (signalling)", de: "Planprüfung", gate: true },
  lph5: { label: "LPH 5 Execution planning", de: "Ausführungsplanung", lph: 5, months: [1, 2.5, 5] },
  lph6: { label: "LPH 6 Tender documents", de: "Vorbereitung der Vergabe", lph: 6, months: [0.5, 1, 2] },
  lph7: { label: "LPH 7 Procurement", de: "Mitwirkung bei der Vergabe", lph: 7 },
  award: { label: "Award", de: "Zuschlag", gate: true },
  factory: { label: "Level crossing system in production", de: "Fertigung im Werk", gate: true },
  possession: { label: "Waiting for the possession", de: "Sperrpause", gate: true },
  construction: { label: "LPH 8 Construction", de: "Bauausführung / Bauoberleitung", lph: 8 },
  acceptance: { label: "Acceptance", de: "Abnahme", gate: true },
  commissioning: { label: "Commissioning approval (EBA)", de: "Inbetriebnahmegenehmigung", gate: true },
  lph9: { label: "LPH 9 Follow-up (warranty)", de: "Objektbetreuung", lph: 9 },
  done: { label: "Completed", de: "abgeschlossen" },
  stopped: { label: "Stopped", de: "eingestellt" },
  money: { label: "Waiting for money", de: "Finanzierung fehlt", gate: true },
};

/** Procurement procedures: days from the tender to the bids, who may bid. */
export const PROCEDURES = {
  direct: { label: "Direct award", de: "Direktvergabe", days: 14 },
  framework: { label: "Call-off from a framework contract", de: "Abruf aus Rahmenvertrag", days: 21 },
  open: { label: "Open procedure", de: "offenes Verfahren", days: 75 },
  negotiated: { label: "Negotiated procedure with competition", de: "Verhandlungsverfahren mit Teilnahmewettbewerb", days: 110 },
};

/** Planning depth: how far the cost estimate is off (bias, spread) and the fee factor. */
export const QUALITY = {
  lean: { label: "Lean", bias: 0.1, sigma: 0.16, fee: 0.8, claims: 0.08 },
  normal: { label: "Normal", bias: 0.04, sigma: 0.09, fee: 1, claims: 0.04 },
  thorough: { label: "Thorough", bias: 0, sigma: 0.05, fee: 1.2, claims: 0.015 },
};

/** Supervision intensity (LPH 8): fee factor, chance a defect stays hidden, as-built data completeness. */
export const SUPERVISION = {
  low: { label: "Low", fee: 0.7, hidden: 0.6, data: [0.45, 0.75] },
  normal: { label: "Normal", fee: 1, hidden: 0.35, data: [0.55, 0.85] },
  high: { label: "High", fee: 1.4, hidden: 0.15, data: [0.65, 0.95] },
};

/** Present value of a yearly amount over `years` at `rate`. */
export const annuityFactor = (rate, years) => (rate > 0 ? (1 - (1 + rate) ** -years) / rate : years);

export class ProjectDesk {
  /** @param {import("./engine.js").InfraEngine} engine */
  constructor(engine) {
    this.e = engine;
    /** @type {Map<string, object>} */
    this.projects = new Map();
    this.n = 0;
  }

  get model() {
    return this.e.model;
  }

  /** Size class 0 (< 1 M€), 1 (< 10 M€), 2. */
  _size(eur) {
    return eur < 1e6 ? 0 : eur < 1e7 ? 1 : 2;
  }

  /** Base cost (euros) of renewing an asset (modernize: with today's technology). */
  baseCost(a, measure) {
    const t = a.t;
    let c = (t.renew_per_unit ? t.renew_eur * Math.max(4, a.units) : t.renew_eur * a.size) * (this.model.costs.materials_factor ?? 1);
    if (measure === "modernize") c *= a.type === "turnout" ? 1.1 : a.type === "level-crossing" ? 1.1 : 1.25;
    return c;
  }

  /**
   * A new project for a measure: `assets` (ids) for renewals, or an upgrade of the settings.
   * @returns {object} the project
   */
  create({ measure, assets = [], upgrade = null, name = null, proposal = null }) {
    const e = this.e, m = this.model;
    const list = assets.map((id) => e.assets.get(id)).filter(Boolean);
    const up = upgrade ? m.upgrades.find((u) => u.id === upgrade) : null;
    const lc = list.some((a) => a.type === "level-crossing") || !!up?.ekrg;
    const roadOwner = up?.ekrg ? (e.assetAt("level-crossing", up.line, up.km)?.road_owner ?? "default") : list.find((a) => a.type === "level-crossing")?.road_owner ?? null;
    const base = up ? up.cost_eur : list.reduce((s, a) => s + this.baseCost(a, measure), 0);
    const id = `P-${String(++this.n).padStart(2, "0")}`;
    const discipline = up ? (up.adds?.[0] ? ASSET_TYPES[up.adds[0].type]?.discipline : "track") : list[0]?.discipline ?? "track";
    const data = list.length ? list.reduce((s, a) => s + a.data, 0) / list.length : 0.7;
    const p = {
      id, measure, name: name || (up ? up.name : `${MEASURES[measure].label}: ${list.map((a) => a.name).slice(0, 2).join(", ")}${list.length > 2 ? ` and ${list.length - 2} more` : ""}`),
      assets: list.map((a) => a.id), upgrade: up?.id ?? null, discipline, lc, roadOwner, proposal,
      funding: up ? "federal" : "replacement", line: up?.line ?? list[0]?.line ?? null,
      base, size: this._size(base), dataAtStart: data,
      options: { quality: "normal", bim: true, procedure: null, possession: "planned", supervision: "normal" },
      stage: "lph1", stageStart: e.now, stageEnd: null, created: e.now,
      estimate: null, calculation: null, trueCost: null, price: null, claims: 0, contractor: null, bids: [],
      paid: { planning: 0, construction: 0 }, received: 0, partners: 0, feesDone: [], history: [], ratio: null,
      possessionBooked: null, constructionStart: null, constructionEnd: null, defects: 0, hiddenDefects: 0, factoryOrder: null,
    };
    // the hidden truth: what it will really cost, with the planning depth chosen at LPH 1
    this.projects.set(id, p);
    e.log(`${p.id} ${p.name}: planning starts (LPH 1)`, "project");
    e.ask({ role: "planner", kind: "planning-depth", project: id, title: `${id}: how thorough should the planning be?`,
      text: "Thorough planning costs more fees but the cost estimate is closer to the real costs and there are fewer claims (Nachträge) during construction.",
      options: Object.entries(QUALITY).map(([k, q]) => ({ id: k, label: `${q.label} planning`, hint: `fees × ${q.fee}` })), def: "normal" });
    e.ask({ role: "planner", kind: "bim", project: id, title: `${id}: ask for BIM?`,
      text: "Employer's information requirements (AIA) with a BIM execution plan (BAP): the planners and the contractor hand over an as-built model with the asset data. It costs a little more and fills the asset register.",
      options: [{ id: "yes", label: "Yes, with AIA and as-built model", hint: `+${Math.round(m.hoai.bim_extra * 100)} % fees` }, { id: "no", label: "No, drawings and lists" }], def: "yes" });
    this._enter(p, "lph1");
    return p;
  }

  /** Months a phase of this project takes. */
  _months(p, stage) {
    const s = STAGES[stage];
    if (!s.months) return 0;
    const r = stream(this.e.seed, "phase", p.id, stage);
    return s.months[p.size] * Math.exp(0.2 * r.normal());
  }

  /** Enter a stage (schedules its end, or asks the role of a gate). */
  _enter(p, stage) {
    const e = this.e, m = this.model;
    p.history.push({ stage, t: e.now });
    p.stage = stage;
    p.stageStart = e.now;
    p.stageEnd = null;
    const end = (days) => {
      p.stageEnd = e.now + days * DAYM;
      e.schedule(p.stageEnd, "project", { id: p.id, stage });
    };
    if (stage === "lph5") {
      // the possession is booked now: a planned one needs about nine months, a short-notice one hurts the trains
      if (p.options.possession === "planned") p.possessionBooked = e.now;
      e.ask({ role: "planner", kind: "possession", project: p.id, title: `${p.id}: book the possession now?`,
        text: "Planned possessions (Sperrpausen) are booked with the timetable about nine months ahead, so the trains can be planned around them. A short-notice possession can start as soon as everything is ready, but delays the trains more (construction-caused delays cost the most in the performance regime) and night work costs about 10 % more.",
        options: [{ id: "planned", label: "Book a planned possession now", hint: "construction not before 9 months from now" }, { id: "short", label: "Short-notice possession later" }], def: "planned" });
    }
    if (stage === "lph6") {
      const ok = this.procedures(p);
      e.ask({ role: "planner", kind: "procedure", project: p.id, title: `${p.id}: which procurement procedure?`,
        text: `Cost calculation ${eur(p.calculation)}. Above the EU threshold for works (${eur(m.procurement.eu_works_eur)}) the tender is EU-wide; a direct award is possible up to ${eur(m.procurement.direct_max_eur)}, a framework call-off where a framework contract covers the work. Open procedures bring more bids and lower prices but take longer.`,
        options: ok.map((k) => ({ id: k, label: PROCEDURES[k].label, hint: `about ${PROCEDURES[k].days} days` })), def: this.defaultProcedure(p) });
    }
    if (STAGES[stage].months) return end((this._months(p, stage) * MONTH) / DAYM);
    switch (stage) {
      case "funding": {
        const r = this._ratio(p);
        p.ratio = r;
        e.ask({ role: "authority", kind: "funding", project: p.id, title: `${p.id}: federal funding for “${p.name}”?`,
          text: `Cost estimate ${eur(p.estimate)}, benefits ${eur(this._upgrade(p)?.benefit_eur_y ?? 0)} a year: benefit-cost ratio (NKV) ${r.toFixed(2)} over ${m.funding.horizon_y} years at ${(m.funding.discount_rate * 100).toFixed(1)} %. Federal money needs at least ${m.funding.min_ratio.toFixed(1)}.`,
          options: [{ id: "approve", label: "Grant the funding" }, { id: "reject", label: "Refuse" }], def: r >= m.funding.min_ratio ? "approve" : "reject" });
        return;
      }
      case "agreement":
        // the road authority signs the crossing agreement (played by the computer)
        return end(60 + 60 * stream(e.seed, "ekrg", p.id).next());
      case "approval":
        e.ask({ role: "authority", kind: "approval", project: p.id, title: `${p.id}: planning approval (Planfeststellung) for “${p.name}”`,
          text: "The upgrade changes the railway: the EBA hears the public and the authorities concerned and decides. Conditions (Auflagen) protect the neighbours but cost money.",
          options: [{ id: "approve", label: "Approve", hint: "about 6 months of procedure" }, { id: "conditions", label: "Approve with conditions", hint: "+5 % costs, 8 months" }, { id: "reject", label: "Refuse" }], def: "approve" });
        return;
      case "plancheck":
        // an EBA-recognised assessor checks the signalling plans
        return end(45);
      case "lph7": {
        const proc = PROCEDURES[p.options.procedure] || PROCEDURES.open;
        const r = stream(e.seed, "tender", p.id).next();
        return end(proc.days * (0.9 + 0.3 * r) + (p.options.procedure === "open" && p.calculation > m.procurement.eu_works_eur ? 20 : 0));
      }
      case "award":
        this._bids(p);
        if (!p.bids.length) {
          e.log(`${p.id}: nobody bid; the tender is repeated`, "warn");
          p.options.procedure = p.options.procedure === "framework" || p.options.procedure === "direct" ? "open" : p.options.procedure;
          return this._enter(p, "lph7");
        }
        e.ask({ role: "asset-manager", kind: "award", project: p.id, title: `${p.id}: award the contract for “${p.name}”`,
          text: `${p.bids.length} bid${p.bids.length === 1 ? "" : "s"} (${PROCEDURES[p.options.procedure].label.toLowerCase()}); cost calculation ${eur(p.calculation)}. The most economic bid weighs the price (70 %) and the quality (30 %).`,
          options: p.bids.map((b) => ({ id: b.firm, label: `${b.name}: ${eur(b.price)}`, hint: `quality ${Math.round(b.quality * 100)} %, score ${Math.round(b.score * 100)}` })),
          def: p.bids.slice().sort((a, b) => b.score - a.score)[0].firm });
        return;
      case "factory": {
        const o = e.factory.order(e.now, { project: p.id, name: p.name });
        p.factoryOrder = o.id;
        e.factoryStart();
        return;
      }
      case "possession": {
        const ready = p.options.possession === "planned" && p.possessionBooked != null ? Math.max(e.now, p.possessionBooked + 270 * DAYM) : e.now;
        return ready > e.now ? end((ready - e.now) / DAYM) : this._enter(p, "construction");
      }
      case "construction": {
        if (!this._pay(p, "construction", 0.3)) return;
        const days = this._constructionDays(p);
        p.constructionStart = e.now;
        p.constructionEnd = e.now + days * DAYM;
        e.ask({ role: "supervision", kind: "supervision", project: p.id, title: `${p.id}: how closely should the construction be supervised?`,
          text: "Close supervision finds more defects before acceptance and makes sure the as-built data reach the asset register.",
          options: Object.entries(SUPERVISION).map(([k, s]) => ({ id: k, label: `${s.label} supervision`, hint: `LPH 8 fees × ${s.fee}` })), def: "normal" });
        e.log(`${p.id}: construction starts (${Math.round(days)} days${p.options.possession === "short" ? ", short-notice possession" : ""})`, "project");
        return end(days);
      }
      case "acceptance": {
        const firm = this.model.contractors.find((c) => c.id === p.contractor);
        const r = stream(e.seed, "defects", p.id);
        const n = Math.round((1 - (firm?.quality ?? 0.7)) * 6 * (0.5 + r.next()));
        const hiddenP = SUPERVISION[p.options.supervision]?.hidden ?? 0.35;
        p.hiddenDefects = 0;
        for (let i = 0; i < n; i++) if (r.chance(hiddenP)) p.hiddenDefects++;
        p.defects = n - p.hiddenDefects;
        e.ask({ role: "supervision", kind: "acceptance", project: p.id, title: `${p.id}: accept the works?`,
          text: `${p.defects ? `${p.defects} defect${p.defects === 1 ? "" : "s"} found` : "No defects found"} with ${SUPERVISION[p.options.supervision].label.toLowerCase()} supervision. Refusing makes the contractor put them right first (about a month).`,
          options: [{ id: "accept", label: p.defects ? "Accept, defects to be put right" : "Accept" }, { id: "refuse", label: "Refuse until the defects are put right" }], def: p.defects > 2 ? "refuse" : "accept" });
        return;
      }
      case "commissioning":
        e.ask({ role: "authority", kind: "commissioning", project: p.id, title: `${p.id}: commissioning approval (Inbetriebnahmegenehmigung)?`,
          text: "The assessor's report (Prüfsachverständiger) is there. Without approval the new signalling may not go into service.",
          options: [{ id: "approve", label: "Approve commissioning" }, { id: "documents", label: "Ask for more documents", hint: "3 weeks" }], def: "approve" });
        return;
      case "lph9":
        this._complete(p);
        return end(365);
      case "money":
        e.log(`${p.id}: waits for money (${p.waitFor === "own" ? "own investment money" : "replacement money"} used up)`, "warn");
        return;
      default:
    }
  }

  /** A stage's time is over (event). */
  stageDone(id, stage) {
    const p = this.projects.get(id);
    if (!p || p.stage !== stage) return;
    const e = this.e, m = this.model;
    const lph = STAGES[stage].lph;
    if (lph && lph !== 8) this._fee(p, lph);
    switch (stage) {
      case "lph1": return this._enter(p, "lph2");
      case "lph2": {
        const q = QUALITY[p.options.quality];
        const r = stream(e.seed, "cost", p.id);
        // the estimate is what the base prices say; the truth differs by the planning depth and the data
        p.estimate = Math.round(p.base);
        p.trueCost = Math.round(p.base * Math.exp(q.bias + (q.sigma + (1 - p.dataAtStart) * 0.08) * r.normal()));
        e.log(`${p.id}: cost estimate (Kostenschätzung) ${eur(p.estimate)}`, "project");
        if (p.funding === "federal") return this._enter(p, "funding");
        return this._enter(p, p.lc ? "agreement" : "lph3");
      }
      case "agreement": e.log(`${p.id}: crossing agreement signed with the road authority`, "project"); return this._enter(p, "lph3");
      case "lph3": {
        const r = stream(e.seed, "calc", p.id);
        p.calculation = Math.round(p.trueCost * Math.exp(0.5 * QUALITY[p.options.quality].sigma * r.normal()));
        e.log(`${p.id}: cost calculation (Kostenberechnung) ${eur(p.calculation)}`, "project");
        return this._enter(p, "lph4");
      }
      case "lph4": return this._enter(p, p.funding === "federal" ? "approval" : p.discipline === "signal" ? "plancheck" : "lph5");
      case "approval": return this._enter(p, "lph5");
      case "plancheck": return this._enter(p, "lph5");
      case "lph5": return this._enter(p, "lph6");
      case "lph6": {
        p.options.procedure ||= this.defaultProcedure(p);
        e.log(`${p.id}: ${PROCEDURES[p.options.procedure].label.toLowerCase()}`, "project");
        return this._enter(p, "lph7");
      }
      case "lph7": return this._enter(p, "award");
      case "possession": return this._enter(p, "construction");
      case "construction": {
        if (!this._pay(p, "construction", 0.7, { claims: true })) return;
        this._fee(p, 8);
        this._constructionDelays(p);
        return this._enter(p, "acceptance");
      }
      case "acceptance": return this._enter(p, "acceptance"); // after rework
      case "commissioning": return this._enter(p, "lph9"); // after more documents
      case "lph9":
        p.stage = "done";
        p.history.push({ stage: "done", t: e.now });
        e.log(`${p.id}: warranty period over`, "project");
        return;
      case "money": return this._enter(p, p.resume);
      default:
    }
  }

  /** LPH 5 starts: the possession is booked (planned possessions need about nine months). */
  _book(p) {
    if (p.options.possession === "planned" && p.possessionBooked == null) p.possessionBooked = this.e.now;
  }

  /** A decision of a role about a project (from the inbox). */
  decide(item, choice) {
    const p = this.projects.get(item.project);
    if (!p) return;
    const e = this.e, m = this.model;
    switch (item.kind) {
      case "planning-depth": p.options.quality = QUALITY[choice] ? choice : "normal"; return;
      case "bim": p.options.bim = choice !== "no"; return;
      case "procedure": if (PROCEDURES[choice]) p.options.procedure = choice; return;
      case "possession":
        p.options.possession = choice === "short" ? "short" : "planned";
        if (p.options.possession === "short") p.possessionBooked = null;
        else this._book(p);
        return;
      case "supervision": p.options.supervision = SUPERVISION[choice] ? choice : "normal"; return;
      case "funding":
        if (p.stage !== "funding") return;
        if (choice === "approve") {
          e.log(`${p.id}: federal funding granted (NKV ${p.ratio.toFixed(2)})`, "good");
          return this._enter(p, p.lc ? "agreement" : "lph3");
        }
        e.log(`${p.id}: federal funding refused (NKV ${p.ratio.toFixed(2)}); the project stops`, "warn");
        return this._stop(p);
      case "approval":
        if (p.stage !== "approval") return;
        if (choice === "reject") {
          e.log(`${p.id}: planning approval refused; the project stops`, "warn");
          return this._stop(p);
        }
        if (choice === "conditions") {
          p.trueCost = Math.round(p.trueCost * 1.05);
          p.calculation = Math.round(p.calculation * 1.05);
        }
        p.stageEnd = e.now + (choice === "conditions" ? 8 : 6) * MONTH;
        e.schedule(p.stageEnd, "project", { id: p.id, stage: "approval" });
        e.log(`${p.id}: planning approval procedure ${choice === "conditions" ? "with conditions " : ""}under way`, "project");
        return;
      case "award": {
        if (p.stage !== "award") return;
        const b = p.bids.find((x) => x.firm === choice) || p.bids[0];
        p.contractor = b.firm;
        p.price = b.price;
        e.log(`${p.id}: contract awarded to ${b.name} for ${eur(b.price)}`, "project");
        return this._enter(p, p.lc && p.measure !== "upgrade" ? "factory" : "possession");
      }
      case "acceptance":
        if (p.stage !== "acceptance") return;
        if (choice === "refuse" && p.defects > 0) {
          e.log(`${p.id}: acceptance refused; the contractor puts ${p.defects} defect${p.defects === 1 ? "" : "s"} right`, "project");
          // closer looks at the rework find some of the hidden defects too
          p.hiddenDefects = Math.max(0, p.hiddenDefects - 1);
          p.defects = 0;
          p.stageEnd = e.now + 30 * DAYM;
          e.schedule(p.stageEnd, "project", { id: p.id, stage: "acceptance" });
          return;
        }
        e.log(`${p.id}: works accepted`, "project");
        return this._enter(p, p.discipline === "signal" || p.lc ? "commissioning" : "lph9");
      case "commissioning":
        if (p.stage !== "commissioning") return;
        if (choice === "documents") {
          p.stageEnd = e.now + 21 * DAYM;
          e.schedule(p.stageEnd, "project", { id: p.id, stage: "commissioning" });
          e.log(`${p.id}: the EBA asks for more documents`, "project");
          return;
        }
        e.log(`${p.id}: commissioning approved`, "good");
        return this._enter(p, "lph9");
      default:
    }
  }

  /** The level crossing system is delivered (factory event). */
  delivered(projectId) {
    const p = this.projects.get(projectId);
    if (p?.stage === "factory") {
      this.e.log(`${p.id}: the level crossing system arrived from the plant`, "project");
      this._enter(p, "possession");
    }
  }

  _stop(p) {
    p.stage = "stopped";
    p.history.push({ stage: "stopped", t: this.e.now });
  }

  /** The upgrade of a project's settings. */
  _upgrade(p) {
    return p.upgrade ? this.model.upgrades.find((u) => u.id === p.upgrade) : null;
  }

  /** Benefit-cost ratio (NKV) of an upgrade: present value of its benefits over its costs. */
  _ratio(p) {
    const f = this.model.funding, u = this._upgrade(p);
    const cost = (p.estimate || p.base) * (1 + this.model.hoai.fee_share);
    return u && cost > 0 ? (u.benefit_eur_y * annuityFactor(f.discount_rate, f.horizon_y)) / cost : 0;
  }

  /** Procedures allowed for a project's value, and the default one. */
  procedures(p) {
    const m = this.model, v = p.calculation ?? p.estimate ?? p.base;
    const framework = m.contractors.some((c) => c.framework && c.disciplines.includes(p.discipline));
    const out = [];
    if (v <= m.procurement.direct_max_eur) out.push("direct");
    if (framework && v <= m.procurement.eu_works_eur) out.push("framework");
    out.push("open", "negotiated");
    return out;
  }

  defaultProcedure(p) {
    const ok = this.procedures(p);
    return ok.includes("framework") ? "framework" : ok.includes("direct") ? "direct" : "open";
  }

  /** The contractors' bids (the computer plays them). */
  _bids(p) {
    const e = this.e, m = this.model;
    const r = stream(e.seed, "bids", p.id, p.history.length);
    const busy = (c) => [...this.projects.values()].filter((q) => q.contractor === c.id && ["possession", "factory", "construction", "acceptance"].includes(q.stage)).length;
    let firms = m.contractors.filter((c) => c.disciplines.includes(p.discipline) && busy(c) < c.capacity);
    const proc = p.options.procedure;
    if (proc === "framework" || proc === "direct") firms = firms.filter((c) => c.framework).slice(0, 1);
    if (proc === "negotiated") firms = firms.sort((a, b) => b.quality - a.quality).slice(0, 3);
    const load = [...this.projects.values()].filter((q) => q.stage === "construction").length / Math.max(1, m.contractors.reduce((s, c) => s + c.capacity, 0));
    const extra = proc === "framework" || proc === "direct" ? 1 + m.procurement.framework_extra : proc === "negotiated" ? 0.97 : 1;
    p.bids = firms.map((c) => ({ firm: c.id, name: c.name, quality: c.quality, price: Math.round(p.trueCost * c.price * (1 + 0.15 * load) * extra * Math.exp(0.06 * r.normal()) * (p.options.possession === "short" ? 1.1 : 1)) }));
    if (proc === "open" && r.chance(0.12)) p.bids = p.bids.slice(0, Math.max(0, p.bids.length - 1));
    const min = Math.min(...p.bids.map((b) => b.price));
    for (const b of p.bids) b.score = 0.7 * (min / b.price) + 0.3 * b.quality;
  }

  /**
   * The trains that the construction delayed: on the project's line, during the work, a share of them
   * by what is built (track, switches, overhead lines and level crossings all, signalling half, stations
   * none), 0.6 min each in a planned possession (the timetable is built around it), 4 min at short
   * notice. The performance regime charges construction-caused delays dearly.
   */
  _constructionDelays(p) {
    const e = this.e, c = this.model.costs;
    const kinds = p.assets.map((id) => e.assets.get(id)?.type).filter(Boolean);
    const share = p.upgrade ? 1 : kinds.some((t) => ["track", "turnout", "catenary", "level-crossing", "interlocking"].includes(t)) ? 1 : kinds.some((t) => ["signal", "balise", "cable"].includes(t)) ? 0.5 : 0;
    if (!share || !p.line || p.constructionStart == null) return;
    const trains = e._trainsBetween(p.line, p.constructionStart, e.now) * share * 0.5;
    const min = trains * (p.options.possession === "short" ? 4 : 0.6);
    if (!(min > 0)) return;
    e.stats.delayMin += min;
    e.stats.constructionDelayMin += min;
    e.stats.perfEur += min * c.construction_delay_eur_min;
    e.log(`${p.id}: the construction delayed trains by ${Math.round(min).toLocaleString("en")} minutes${p.options.possession === "short" ? " (short-notice possession)" : ""}`, "project");
  }

  /** Calendar days of construction. */
  _constructionDays(p) {
    const e = this.e, u = this._upgrade(p);
    if (u) return 120 + (u.cost_eur / 1e6) * 6;
    const days = p.assets.map((id) => e.assets.get(id)).filter(Boolean).map((a) => (a.t.renew_days || 1) * (a.t.linear ? a.length_km : 1));
    const work = Math.max(...days, 1) + 0.4 * (days.reduce((s, d) => s + d, 0) - Math.max(...days, 0));
    return Math.max(2, work * 1.4 + 2);
  }

  /** HOAI fee of a phase (k = 1..9), paid when the phase is done. */
  _fee(p, k) {
    if (p.feesDone.includes(k)) return;
    p.feesDone.push(k);
    const m = this.model, q = QUALITY[p.options.quality];
    const sup = k === 8 ? SUPERVISION[p.options.supervision].fee : 1;
    const fee = (p.calculation ?? p.estimate ?? p.base) * m.hoai.fee_share * (m.hoai.shares[k - 1] / 100) * q.fee * sup * (p.options.bim ? 1 + m.hoai.bim_extra / m.hoai.fee_share : 1);
    p.paid.planning += fee;
    const account = p.funding === "federal" ? "own" : "replacement";
    this.e.pay(account, fee, "planning", `${p.id} fee LPH ${k}`, { force: true });
  }

  /**
   * Pay a share of the construction price (with claims at the end). Federal projects: the Bund pays
   * its share; level crossings: the partners of the crossing agreement pay theirs (EKrG).
   * @returns {boolean} false when the money is not there (the project waits)
   */
  _pay(p, what, share, { claims = false } = {}) {
    const e = this.e, m = this.model;
    let amount = p.price * share;
    if (claims) {
      const q = QUALITY[p.options.quality], firm = m.contractors.find((c) => c.id === p.contractor);
      const r = stream(e.seed, "claims", p.id);
      p.claims = Math.round(p.price * Math.max(0, q.claims + (1 - (firm?.quality ?? 0.7)) * 0.06 + 0.03 * r.normal()));
      amount += p.claims;
      if (p.claims > 0) e.log(`${p.id}: claims (Nachträge) of ${eur(p.claims)}`, "project");
    }
    let railway = 1, partners = 0;
    if (p.lc) {
      const k = m.funding.ekrg[p.roadOwner === "municipal" ? "municipal" : "default"] || m.funding.ekrg.default;
      railway = k.railway;
      partners = 1 - railway;
    }
    let federal = 0;
    if (p.funding === "federal") {
      federal = p.lc ? partners : m.funding.federal_share;
      railway = 1 - federal;
      partners = 0;
    }
    const account = p.funding === "federal" ? "own" : "replacement";
    const own = amount * railway;
    if (!e.canPay(account, own)) {
      p.waitFor = account;
      p.resume = p.stage === "construction" && what === "construction" && share < 0.5 ? "construction" : p.stage;
      // a stage that cannot start waits for next year's money
      if (p.stage === "construction" && share < 0.5) {
        p.history.push({ stage: "money", t: e.now });
        p.stage = "money";
        p.resume = "construction";
        e.log(`${p.id}: construction waits for money (${account === "own" ? "own investment money" : "replacement money"} used up)`, "warn");
        return false;
      }
      // at the end of construction the bill is paid anyway (over the budget)
    }
    e.pay(account, own, "construction", `${p.id} construction${claims ? " (final)" : ""}`, { force: true });
    p.paid.construction += own;
    if (federal > 0) {
      p.received += amount * federal;
      e.receive("federal", amount * federal, `${p.id} federal share`);
      if (what === "construction" && share < 0.5) {
        const lump = p.price * m.funding.planning_share;
        p.received += lump;
        e.receive("own", lump, `${p.id} federal planning lump sum`);
      }
    }
    if (partners > 0) {
      p.partners += amount * partners;
      e.receive("partners", amount * partners, `${p.id} crossing partners (EKrG)`);
    }
    return true;
  }

  /** Money is there again (new year): projects waiting for it go on. */
  resumeWaiting() {
    for (const p of this.projects.values()) if (p.stage === "money") this._enter(p, p.resume || "construction");
  }

  /** The works are in service: assets renewed, upgraded, added or removed; as-built data handed over. */
  _complete(p) {
    const e = this.e, m = this.model;
    const sup = SUPERVISION[p.options.supervision];
    const data = sup.data[p.options.bim ? 1 : 0];
    const r = stream(e.seed, "complete", p.id);
    const u = this._upgrade(p);
    const touched = [];
    for (const id of p.assets) {
      const a = e.assets.get(id);
      if (!a) continue;
      touched.push(a);
      if (p.measure === "modernize") {
        if (a.type === "interlocking") {
          a.generation = "digital";
          for (const f of e.assets.values()) if (f.interlocking === a.id && (f.type === "signal" || f.type === "balise")) touched.push(f);
        } else if (a.t.retrofit) a.retrofit = Math.max(a.retrofit, a.t.retrofit.share);
      }
    }
    if (u) {
      for (const add of u.adds || []) for (const a of e.addAssets(add, p)) touched.push(a);
      for (const rem of u.removes || []) {
        const a = e.assetAt(rem.type, String(rem.line), +rem.km);
        if (a) e.removeAsset(a, `replaced (${p.id})`);
      }
    }
    const hidden = p.hiddenDefects;
    for (const a of touched) {
      if (a.removed) continue;
      const defect = hidden > 0 && r.chance(Math.min(0.9, hidden / Math.max(1, touched.length) + 0.2));
      a.renew(e.now, m.start_year, { h: defect ? 0.86 : 1, data });
      if (defect) a.defectUntil = e.now + 365 * DAYM;
      a.fault = null;
      a._rate = e.rateOf(a);
      a.observe(e.now, 0.02, "acceptance", r);
      a.lastRule = e.now;
      e.events("asset.renewed", { asset: a, project: p });
    }
    e.stats.projectsDone++;
    e.log(`${p.id} in service: ${touched.filter((a) => !a.removed).length} asset${touched.length === 1 ? "" : "s"}${p.measure === "modernize" ? " with new technology" : " renewed"}; as-built data ${Math.round(data * 100)} % complete`, "good");
  }

  /** Text of a project's state: "LPH 3 Design, until 12 Mar 2028". */
  stateText(p) {
    const s = STAGES[p.stage];
    return p.stageEnd && p.stage !== "done" ? `${s.label}, until ${this.e.dateText(p.stageEnd)}` : s.label;
  }
}

/** "1.2 M€", "350 k€", "900 €". */
export function eur(v) {
  if (!Number.isFinite(v)) return "–";
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)} M€`;
  if (a >= 1e4) return `${s}${Math.round(a / 1e3)} k€`;
  return `${s}${Math.round(a).toLocaleString("en")} €`;
}
