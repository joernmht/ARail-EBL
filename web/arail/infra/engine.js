/**
 * The infrastructure simulation's engine: a discrete-event simulation of an infrastructure
 * manager's district over years (minutes since 00:00 on 1 January of the start year).
 *
 * Every day the assets wear and may fail; faults become known by the path their asset reports on
 * (the panel of the interlocking, diagnosis, remote monitoring, a train driver, passengers) and the
 * dispatcher sends somebody: the emergency team on shift, a day technician, the technician on call
 * from home, or a contractor. Faults delay trains (performance regime) or close station equipment.
 * Day technicians do the planned work (inspections, repairs, retrofits), drone pilots fly
 * inspections, measurement trains run. ALVs propose measures; the asset manager approves them;
 * renewals and upgrades go through the HOAI phases (projects.js) with funding, approval,
 * procurement and the level crossing plant (factory.js). Decisions go to roles (an inbox); the
 * computer decides for the roles nobody plays, and for every decision whose time is up.
 *
 * The engine knows nothing of the layout's drawing: the world simulation (simulation.js) gives it
 * the assets on the layout and the driving times there, and shows what it does. Everything that
 * players do goes through `act(name, …)`, which is recorded: a game is saved as its actions and
 * restored by running them again (the engine is deterministic for a seed).
 * @module arail/infra/engine
 */
import {
  ASSET_TYPES, DISCIPLINES, DISCIPLINE_IDS, GENERATIONS, MEASURES, METHODS, REPAIR_FACTOR, REPAIR_GAIN, REPORTS, gradeOf, gradeValue,
} from "./catalog.js";
import { ROLES, normalizeInfra } from "./config.js";
import { Asset, generateAssets, healthAtAge, wearRate } from "./assets.js";
import { Network } from "./network.js";
import { SHIFTS, hirePerson, makePeople, onCallPerson, shiftOf, weekdayOf } from "./staff.js";
import { Plant } from "./factory.js";
import { ProjectDesk, eur } from "./projects.js";
import { DAY, EventQueue, clockMinutes, exponential, hashKey, lognormal, stream } from "../ops/util.js";

export const YEAR = 365 * DAY;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Health below which a track or switch gets a permanent speed restriction (Langsamfahrstelle). */
const LA_HEALTH = 0.2;
/** Minutes a technician needs at the base before driving out, and after coming back. */
const BRIEF_MIN = 15;

/** Words for the kinds of planned work. */
export const TASK_WORDS = { inspect: "inspection", repair: "repair", retrofit: "retrofit", fault: "fault repair" };

export class InfraEngine {
  /**
   * @param {object} config the layout's `infrastructure` entry
   * @param {object} [options]
   * @param {object} [options.layout] the normalized layout (scale)
   * @param {number} [options.seed]
   * @param {object[]} [options.layoutAssets] assets on the layout: {id, type, object, name, built, generation, interlocking, pos (network m), km, length_km, road_owner}
   * @param {{travel?: Function, event?: Function}} [options.hooks] travel(asset) → minutes from the base on the layout (or null);
   *   event(name, payload) for the world
   * @param {number[]|null} [options.base] the maintenance base (network m); default: the layout's station
   * @param {object|null} [options.scenario] a scenario (config.js) whose events happen
   */
  constructor(config = {}, { layout = null, seed = 1, layoutAssets = [], hooks = {}, base = null, scenario = null } = {}) {
    this.config = config;
    this.model = normalizeInfra(config, layout);
    this.seed = this.model.seed ?? seed;
    this.hooks = hooks;
    this.net = new Network(this.model);
    this.queue = new EventQueue();
    this.now = 0;
    this.startYear = this.model.start_year;
    this.endT = this.model.years * YEAR;
    /** @type {Map<string, Asset>} */
    this.assets = new Map();
    /** Inspection plan per asset type: {method, per_year}. */
    this.plans = {};
    for (const [id, t] of Object.entries(this.model.types)) this.plans[id] = { method: t.inspect.method, per_year: t.inspect.per_year };
    this.logs = [];
    /** Decisions waiting for roles and taken. */
    this.inbox = [];
    this.nItem = 0;
    /** Proposals of the ALVs. */
    this.proposals = [];
    /** Recorded actions (for saving and replaying a game). */
    this.actions = [];
    /** Work waiting for a technician or pilot: tasks {id, kind, asset, method, due, prio, discipline}. */
    this.backlog = [];
    this.nTask = 0;
    /** Open faults by id. */
    this.faults = new Map();
    this.nFault = 0;
    /** Results of finished years. */
    this.years = [];
    this.roles = { ...this.model.roles };
    this.people = makePeople(this.model, this.seed);
    this.factory = new Plant(this.model.factory);
    this.desk = new ProjectDesk(this);
    this._buildAssets(layoutAssets);
    this.base = base ?? this._stationPos(this.model.placement.station);
    for (const p of this.people) p.at = this.base;
    this._startYear(0);
    this._initKnowledge();
    this.queue.push(0, "day", {}, 0);
    for (const ev of scenario?.events || []) {
      const t = (Number(ev.day) || 0) * DAY + (clockMinutes(ev.at) ?? 360);
      this.queue.push(t, "scenario", { ev }, 3);
    }
    if (scenario) this.scenario = scenario.id;
  }

  /* ---------------------------------------------------------------- calendar */

  get today() {
    return Math.floor(this.now / DAY);
  }

  /** Year index (0 = the start year) of a time. */
  yearOf(t = this.now) {
    return Math.min(this.model.years - 1, Math.max(0, Math.floor(t / YEAR)));
  }

  /** Calendar year of a time. */
  calendarYear(t = this.now) {
    return this.startYear + Math.floor(t / YEAR);
  }

  /** "Tue 14 Mar 2028" (a year of 365 days; no leap days in the game). */
  dateText(t = this.now) {
    const d = Math.floor(t / DAY), y = Math.floor(d / 365);
    let rest = d - y * 365, m = 0;
    while (m < 11 && rest >= MONTH_DAYS[m]) rest -= MONTH_DAYS[m++];
    return `${WEEKDAYS[weekdayOf(d, this.startYear)]} ${rest + 1} ${MONTHS[m]} ${this.startYear + y}`;
  }

  /** "07:05". */
  clockText(t = this.now) {
    const m = ((Math.floor(t) % DAY) + DAY) % DAY;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }

  /** "Tue 14 Mar 2028 07:05". */
  timeText(t = this.now) {
    return `${this.dateText(t)} ${this.clockText(t)}`;
  }

  /** Has the game reached its end? */
  get finished() {
    return this.now >= this.endT;
  }

  /* ---------------------------------------------------------------- assets */

  _stationPos(id) {
    const s = this.net.stations.get(id);
    return s ? this.net.at(s.line, s.km)?.pos ?? [0, 0] : [0, 0];
  }

  rateOf(a) {
    return wearRate(a.life);
  }

  _buildAssets(layoutAssets) {
    const m = this.model;
    const onLayout = (layoutAssets || []).filter((a) => a && this.model.types[a.type]);
    // the layout's tracks cover this part of the station's line
    const tracks = onLayout.filter((a) => a.type === "track" && Number.isFinite(a.km));
    const span = tracks.length ? [Math.min(...tracks.map((a) => a.km)), Math.max(...tracks.map((a) => a.km + (a.length_km || 0)))] : null;
    const specs = generateAssets(m, this.net, { seed: this.seed, skipStation: onLayout.length ? m.placement.station : null, layoutSpan: span });
    const station = m.placement.station;
    const rng = stream(this.seed, "layout-built");
    for (const a of onLayout) {
      const spec = {
        ...a, line: a.line ?? m.placement.line, station: a.station ?? station, on_layout: true,
        built: Number.isFinite(+a.built) && +a.built > 1800 ? +a.built : Math.round(this.startYear - rng.uniform(0.1, 1.1) * (this.model.types[a.type].life_y ?? 40)),
      };
      // the interlocking on the layout replaces the generated one of its station
      if (a.type === "interlocking") {
        const gen = specs.findIndex((s) => s.type === "interlocking" && s.station === spec.station);
        if (gen >= 0) specs.splice(gen, 1);
      }
      specs.push(spec);
    }
    for (const spec of specs) {
      const type = this.model.types[spec.type];
      if (!type) continue;
      if (spec.type === "interlocking" && !GENERATIONS[spec.generation]) spec.generation = "relay";
      this.assets.set(spec.id, new Asset(spec, type));
    }
    // field elements belong to the interlocking of their station, else the nearest one
    const ils = [...this.assets.values()].filter((a) => a.type === "interlocking");
    for (const a of this.assets.values()) {
      if (!a.t.field && a.type !== "balise") continue;
      if (a.interlocking && this.assets.has(a.interlocking)) continue;
      let best = ils.find((i) => i.station && i.station === a.station) || null;
      if (!best) {
        let bd = Infinity;
        for (const i of ils) {
          const d = a.pos && i.pos ? Math.hypot(a.pos[0] - i.pos[0], a.pos[1] - i.pos[1]) : Infinity;
          if (d < bd) [bd, best] = [d, i];
        }
      }
      a.interlocking = best?.id ?? null;
    }
    for (const i of ils) i.units = [...this.assets.values()].filter((a) => a.interlocking === i.id && a.t.field).length;
    const r = stream(this.seed, "initial");
    for (const a of this.assets.values()) {
      a._rate = this.rateOf(a);
      const age = a.age(0, this.startYear);
      a.h = Math.min(1, Math.max(0.05, healthAtAge(age, a.life) + 0.07 * r.normal()));
      // older assets have gaps in their data; the oldest lost their year of construction
      a.data = Math.min(0.95, Math.max(0.2, 0.95 - 0.012 * age + 0.08 * r.normal()));
      a.builtKnown = age < 45 || r.chance(0.5);
      a.lastRule = null;
    }
  }

  /** The asset of a type nearest to a km of a line (within 300 m), or null. */
  assetAt(type, line, km) {
    let best = null, bd = 0.3;
    for (const a of this.assets.values()) {
      if (a.type !== type || a.line !== line || a.removed) continue;
      const d = Math.abs(a.km - km);
      if (d <= bd) [bd, best] = [d, a];
    }
    return best;
  }

  /** New assets of an upgrade (`{type, line, from_km, to_km}`): linear assets in sections of 5 km. */
  addAssets(spec, project) {
    const t = this.model.types[spec.type];
    if (!t) return [];
    const out = [];
    const step = t.linear ? 5 : Infinity;
    for (let a = +spec.from_km || +spec.km || 0; a < (+spec.to_km || a + 0.001) - 1e-6; a += step) {
      const b = Math.min(+spec.to_km || a, a + step);
      const id = `${spec.type === "catenary" ? "OL" : spec.type.toUpperCase().slice(0, 3)}-${spec.line}-${a.toFixed(1)}-new`;
      const asset = new Asset({
        id, type: spec.type, name: `${t.label} line ${spec.line} km ${a.toFixed(1)}–${b.toFixed(1)} (new)`, line: String(spec.line), km: a,
        length_km: b - a, built: this.calendarYear() + (this.now % YEAR) / YEAR, pos: this.net.at(String(spec.line), (a + b) / 2)?.pos ?? null,
      }, t);
      asset._rate = this.rateOf(asset);
      this.assets.set(id, asset);
      out.push(asset);
      this.log(`New: ${asset.name} (${project?.id ?? "upgrade"})`, "good");
    }
    if (spec.type === "catenary") {
      const line = this.net.lines.get(String(spec.line));
      if (line) line.electrified = true;
    }
    return out;
  }

  removeAsset(a, why) {
    a.removed = true;
    a.fault = null;
    this.log(`${a.name} ${why}`, "project");
  }

  /** Assets in service. */
  active() {
    return [...this.assets.values()].filter((a) => !a.removed);
  }

  /** What is known of an asset now (see Asset.known). */
  known(a, t = this.now) {
    return a.known(t, { assets: this.assets, startYear: this.startYear, seed: this.seed });
  }

  /** Load factor of a line (trains a day against 100). */
  load(line) {
    const l = this.net.lines.get(line);
    return Math.sqrt(Math.max(0.1, (l?.trains_per_day ?? 100) / 100));
  }

  /* ---------------------------------------------------------------- the knowledge at the start */

  /**
   * Before the game starts, every asset was inspected as its plan says: its last observation lies
   * somewhere in its last interval (never, for assets whose plan inspects them less than once in
   * ten years).
   */
  _initKnowledge() {
    const r = stream(this.seed, "knowledge");
    for (const a of this.assets.values()) {
      const plan = this.plans[a.type];
      const interval = plan.per_year > 0 ? 365 / plan.per_year : Infinity;
      if (!Number.isFinite(interval) || interval > 3650) continue;
      const ago = r.uniform(0.05, 1) * interval * DAY;
      const t = -ago;
      const h = a.h;
      const sigma = METHODS[plan.method]?.sigma ?? 0.05;
      const visible = plan.method === "drone" ? a.t.drone ?? 0 : 1;
      if (visible > 0) {
        a.obs = { h: Math.min(1, Math.max(0, h + ((this.now - t) / YEAR) * a._rate + sigma * r.normal())), sigma: visible >= 1 ? sigma : 0.12, t, source: plan.method };
      }
      a.lastRule = this._counts(plan.method, a) ? t : -Infinity;
      a.serviced = METHODS[plan.method]?.servicing ? t : -r.uniform(0, 365) * DAY;
      a.nextInspect = t + interval * DAY;
    }
  }

  /** Does an inspection by this method count for the rules (EBO § 17: inspecting the installations)? */
  _counts(method, a) {
    if (method === "walk" || method === "diagnose" || method === "train") return true;
    return method === "drone" && (a.type === "catenary" || a.type === "gsmr" || a.type === "cable");
  }

  /* ---------------------------------------------------------------- money */

  _startYear(y) {
    const b = this.model.budgets;
    const withheld = this.years[y - 1]?.withheld || 0;
    // what was overspent last year (bills that had to be paid) comes off this year's money
    const debt = (k) => Math.min(0, this.balance?.[k] ?? 0);
    this.balance = { maintenance: b.maintenance_eur + debt("maintenance"), replacement: b.replacement_eur - withheld + debt("replacement"), own: b.own_eur + debt("own") };
    this.budget = { ...this.balance };
    this.stats = {
      year: this.startYear + y, faults: 0, faultsByType: {}, delayMin: 0, cancelled: 0, stationHours: 0, stationEur: 0, perfEur: 0, constructionDelayMin: 0,
      responses: [], restores: [], callouts: 0, nightCallouts: 0, contractorCallouts: 0, overtimeH: 0, inspections: 0, droneFlights: 0, trainRuns: 0,
      laDays: 0, laSections: new Set(), projectsDone: 0, spent: {}, received: { federal: 0, partners: 0, own: 0 }, ledger: [], withheld: 0,
    };
  }

  /** Can an account pay this much? (The maintenance budget can be overspent; the others cannot.) */
  canPay(account, amount) {
    return account === "maintenance" || (this.balance[account] ?? 0) >= amount - 0.5;
  }

  /** Pay from an account (`force`: also beyond the balance). */
  pay(account, amount, cat, text, { force = false } = {}) {
    if (!(amount > 0)) return true;
    if (!force && !this.canPay(account, amount)) return false;
    this.balance[account] -= amount;
    this.stats.spent[cat] = (this.stats.spent[cat] || 0) + amount;
    this.stats.ledger.push({ t: this.now, account, amount: -amount, cat, text });
    return true;
  }

  /** Money received: from the Bund or the crossing partners (paid to the contractors), or into the own account. */
  receive(source, amount, text) {
    if (!(amount > 0)) return;
    this.stats.received[source] = (this.stats.received[source] || 0) + amount;
    if (source === "own") this.balance.own += amount;
    this.stats.ledger.push({ t: this.now, account: source, amount, cat: "received", text });
  }

  /* ---------------------------------------------------------------- log, events, decisions */

  log(text, kind = "info", t = this.now) {
    this.logs.push({ t, text, kind });
    if (this.logs.length > 600) this.logs.splice(0, this.logs.length - 500);
    this.events("log", { t, text, kind });
  }

  /** Tell the world (and plugins) what happened. */
  events(name, payload) {
    this.hooks.event?.(name, payload);
  }

  schedule(t, type, data, prio = 5) {
    return this.queue.push(Math.max(t, this.now), type, data, prio);
  }

  /**
   * A decision for a role: decided at once by the default rule when the computer plays the role,
   * else it waits for the role until its deadline (then the default is taken).
   * @param {{role: string, kind: string, title: string, text?: string, options: {id, label, hint?}[], def: string, project?: string, data?: object}} q
   */
  ask(q) {
    const days = q.days ?? this.model.decision_days;
    const item = { id: `D-${++this.nItem}`, created: this.now, deadline: this.now + days * DAY, decided: null, ...q };
    this.inbox.push(item);
    if (this.roles[item.role] === "computer" || !(this.model.decision_days > 0)) {
      this._resolve(item, item.def, "computer");
      return item;
    }
    this.schedule(item.deadline, "deadline", { id: item.id }, 4);
    // findings wait in the ALV's list: running fast does not stop for them
    if (item.pause !== false) this._newDecision = item;
    this.events("decision", { item });
    return item;
  }

  /** Decisions still open (for a role, or all). */
  open(role = null) {
    return this.inbox.filter((i) => !i.decided && (!role || i.role === role));
  }

  _resolve(item, choice, by) {
    if (item.decided) return false;
    if (!item.options.some((o) => o.id === choice)) choice = item.def;
    item.decided = { choice, by, t: this.now };
    if (by !== "computer" || this.roles[item.role] !== "computer") {
      const label = item.options.find((o) => o.id === choice)?.label ?? choice;
      this.log(`${ROLES[item.role]?.label ?? item.role}${by === "default" ? " (time up, default)" : ""}: ${item.title.replace(/\?$/, "")} → ${label}`, "decision");
    }
    if (item.project) this.desk.decide(item, choice);
    else if (item.kind === "proposal") this._decideProposal(item, choice);
    else if (item.kind === "finding") this._decideFinding(item, choice);
    return true;
  }

  /* ---------------------------------------------------------------- actions of the players */

  /**
   * Do something as a player (recorded for saving): `decide`, `propose`, `plan`, `staff`, `pilots`,
   * `oncall`, `inspect`, `option`, `role`.
   * @returns {string|boolean} what happened (text), or false if it was not possible
   */
  act(name, ...args) {
    const fn = ACTIONS[name];
    if (!fn) throw new Error(`Unknown action "${name}"`);
    const out = fn.call(this, ...args);
    if (out !== false) this.actions.push({ t: this.now, name, args: structuredClone(args) });
    return out;
  }

  /** Changes since a saved game: its actions, run again at their times. */
  replay(actions) {
    for (const a of actions || []) {
      if (!ACTIONS[a.name]) continue;
      this.runTo(a.t);
      this.act(a.name, ...(a.args || []));
    }
  }

  /** A saved game: seed, scenario and actions (the state follows from them). */
  save() {
    return { format: "arail-infra-game/1", seed: this.seed, scenario: this.scenario ?? null, now: this.now, actions: this.actions };
  }

  /* ---------------------------------------------------------------- running */

  /**
   * Run the simulation to time t.
   * @param {number} t minutes
   * @param {{pause?: boolean}} [options] pause: stop when a decision for a student role comes up
   * @returns {object|null} the decision it stopped for
   */
  runTo(t, { pause = false } = {}) {
    t = Math.min(t, this.endT);
    this._newDecision = null;
    // a decision that waits for a student role is not run past: running stops a minute before its time is up
    let due = null;
    if (pause) {
      for (const i of this.inbox) if (!i.decided && i.pause !== false && i.deadline - 1 > this.now && i.deadline - 1 <= t && (!due || i.deadline < due.deadline)) due = i;
      if (due) t = due.deadline - 1;
    }
    while (this.queue.peekTime() <= t) {
      const ev = this.queue.pop();
      this.now = Math.max(this.now, ev.t);
      this._handle(ev);
      if (pause && this._newDecision) return this._newDecision;
    }
    this.now = Math.max(this.now, t);
    return due && !due.decided ? due : null;
  }

  /** Run to the end of the current year (or to the next decision of a student role with `pause`). */
  runYear(options) {
    const end = (Math.floor(this.now / YEAR) + 1) * YEAR;
    return this.runTo(end, options);
  }

  _handle(ev) {
    const d = ev.data;
    switch (ev.type) {
      case "day": return this._day();
      case "plan": return this._planDay();
      case "fail": return this._fail(this.assets.get(d.asset), d);
      case "known": return this._known(this.faults.get(d.id));
      case "arrive": return this._arrive(this.faults.get(d.id));
      case "fixed": return this._fixed(this.faults.get(d.id));
      case "task": return this._taskDone(d.task, d.token);
      case "train": return this._measurementRun(d.line);
      case "project": return this.desk.stageDone(d.id, d.stage);
      case "factory": return this._factoryStage(d.id);
      case "deadline": {
        const item = this.inbox.find((i) => i.id === d.id);
        if (item && !item.decided) this._resolve(item, item.def, "default");
        return;
      }
      case "hire": {
        const p = hirePerson(this.model, this.seed, this.people, d.discipline, d.role, this.now);
        p.at = this.base;
        this.people.push(p);
        this.log(`${p.name} starts (${d.role === "pilot" ? "drone pilot" : `${DISCIPLINES[d.discipline]?.short ?? d.discipline}, ${d.role === "emergency" ? "emergency team" : "day shift"}`})`, "staff");
        return;
      }
      case "month": return this._month();
      case "scenario": return this._scenario(d.ev);
      case "audit": return this._audit();
      default:
    }
  }

  /* ---------------------------------------------------------------- a day */

  _day() {
    const d = this.today, t0 = d * DAY;
    if (t0 >= this.endT) {
      if (this.years.length < this.model.years) this._closeYear(this.model.years - 1);
      return;
    }
    const yd = d % 365;
    if (yd === 0 && d > 0) this._closeYear(d / 365 - 1);
    if (yd === 0) this._openYear(d / 365);
    const r = stream(this.seed, "day", d);
    for (const a of this.assets.values()) {
      if (a.removed) continue;
      const plan = this.plans[a.type];
      const interval = Math.max(365 / Math.max(a.t.min_per_year || 0.2, 0.05), plan.per_year > 0 ? 365 / plan.per_year : 0);
      const overdue = (t0 - a.serviced) / DAY > 1.5 * interval && !(a.liveShare(this.assets) >= 0.5);
      a.wear(a._rate, r, { overdue, load: this.load(a.line) });
      // faults (more likely the worse the condition; hidden construction defects for a year)
      if (!a.fault) {
        const rate = a.failureRate(a.h, this.load(a.line)) * (t0 < a.defectUntil ? 3 : 1) * (this._factor ?? 1);
        const theft = (a.t.theft_per_y || 0) * a.size;
        if (r.chance(Math.min(0.5, rate / 365))) this.schedule(t0 + r.uniform(0, DAY - 1), "fail", { asset: a.id, kind: "wear" }, 2);
        else if (theft > 0 && r.chance(theft / 365)) this.schedule(t0 + r.uniform(0, 300), "fail", { asset: a.id, kind: "theft" }, 2);
      }
      // permanent speed restrictions on worn track and switches (the LuFV's Infrastrukturmängel)
      if ((a.type === "track" || a.type === "turnout") && a.h < LA_HEALTH) {
        const trains = this._trainsBetween(a.line, t0, t0 + DAY) * (a.t.effect.share ?? 0.5);
        this.stats.delayMin += trains * 1;
        this.stats.perfEur += trains * this.model.costs.delay_eur_min;
        this.stats.laDays++;
        if (!this.stats.laSections.has(a.id)) {
          this.stats.laSections.add(a.id);
          this.log(`Speed restriction (La) on ${a.name}: the track is worn out`, "warn");
          this.events("asset.restricted", { asset: a });
        }
      }
      // planned inspections that are due go to the work list (measurement trains run by themselves)
      if (plan.per_year > 0 && plan.method !== "train" && a.nextInspect <= t0 + DAY && !a.inspectTask) this._queueInspection(a, plan.method);
    }
    this.pay("maintenance", this.stats.perfEur - (this._perfPaid || 0), "performance regime", "delay minutes (Anreizsystem)", { force: true });
    this._perfPaid = this.stats.perfEur;
    // other customers order level crossing systems too
    if (r.chance((this.model.factory.external_per_year || 0) / 365)) {
      this.factory.order(this.now, { name: `Order of another infrastructure manager` });
      this.factoryStart();
    }
    if (weekdayOf(d, this.startYear) < 5) this.schedule(t0 + (clockMinutes(this.model.staff.day_shift.from) ?? 420) - 5, "plan", {}, 1);
    if (yd % 7 === 0) this.pay("maintenance", this.model.costs.oncall_week_eur * DISCIPLINE_IDS.filter((x) => onCallPerson(x, t0, this.model, this.people)).length, "on-call", "on-call allowances");
    this.schedule(t0 + DAY, "day", {}, 0);
  }

  _openYear(y) {
    if (y > 0) this._startYear(y);
    const m = this.model;
    this.log(`Budget year ${this.startYear + y}: maintenance ${eur(this.balance.maintenance)}, replacement ${eur(this.balance.replacement)}, own investment ${eur(this.balance.own)}`, "money");
    const t0 = y * YEAR;
    for (let k = 0; k < 12; k++) this.schedule(t0 + k * 30.4 * DAY + 60, "month", {}, 1);
    // measurement trains: evenly over the year on every line, as often as the plans of the types they measure say
    const runs = Math.max(0, ...Object.entries(this.plans).filter(([, p]) => p.method === "train").map(([, p]) => Math.round(p.per_year)));
    for (const line of this.net.lines.keys()) {
      for (let i = 0; i < runs; i++) this.schedule(t0 + Math.round(((i + 0.5) * 365) / runs + (hashKey(line) % 9)) * DAY + 600, "train", { line }, 3);
    }
    this.schedule(t0 + (60 + (hashKey(this.seed, y, "audit") % 240)) * DAY + 600, "audit", {}, 3);
    this.desk.resumeWaiting();
  }

  _month() {
    const n = this.people.filter((p) => p.employed(this.now) && p.role !== "alv").length;
    this.pay("maintenance", (n * this.model.costs.person_year_eur) / 12, "staff", `salaries (${n} people)`, { force: true });
    const alv = this.people.filter((p) => p.employed(this.now) && p.role === "alv").length;
    this.pay("maintenance", (alv * this.model.costs.person_year_eur * 1.15) / 12, "staff", "salaries (ALV)", { force: true });
  }

  /** Trains on a line between two times (evenly over the service hours of each day). */
  _trainsBetween(line, t0, t1) {
    const l = this.net.lines.get(line);
    if (!l || !(t1 > t0)) return 0;
    const from = clockMinutes(this.model.trains.from) ?? 300, to = clockMinutes(this.model.trains.to) ?? 1440;
    const per = l.trains_per_day / Math.max(1, to - from);
    let n = 0;
    for (let d = Math.floor(t0 / DAY); d * DAY < t1; d++) {
      const a = Math.max(t0, d * DAY + from), b = Math.min(t1, d * DAY + to);
      if (b > a) n += (b - a) * per;
    }
    return n;
  }

  /* ---------------------------------------------------------------- faults */

  _fail(a, { kind = "wear", cause = null } = {}) {
    if (!a || a.removed || a.fault) return;
    const id = `F-${++this.nFault}`;
    const path = kind === "theft" ? "panel" : a.reportPath(this.assets);
    const delay = this._detectDelay(a, path);
    const f = { id, asset: a.id, t: this.now, knownAt: this.now + delay, kind, cause, path, accrued: this.now, responder: null };
    a.fault = f;
    a.faults++;
    this.faults.set(id, f);
    this.stats.faults++;
    this.stats.faultsByType[a.type] = (this.stats.faultsByType[a.type] || 0) + 1;
    // a cable cut takes the signals near it with it
    if (kind === "theft") f.what = "cable cut: signals dark";
    this.schedule(f.knownAt, "known", { id }, 2);
  }

  /** Minutes until a fault is known, by its report path. */
  _detectDelay(a, path) {
    const r = stream(this.seed, "detect", a.id, Math.floor(this.now));
    const base = { panel: 3, diagnosis: 1, monitoring: 2 }[path];
    if (base != null) return base + r.uniform(0, base);
    const from = clockMinutes(this.model.trains.from) ?? 300, to = clockMinutes(this.model.trains.to) ?? 1440;
    const tod = this.now % DAY;
    const waitService = tod < from ? from - tod : tod >= to ? DAY - tod + from : 0;
    if (path === "passengers") return waitService + exponential(r, 60);
    const l = this.net.lines.get(a.line);
    const headway = (to - from) / Math.max(1, (l?.trains_per_day ?? 40) / Math.max(1, l?.tracks ?? 1));
    return waitService + r.uniform(0, headway) + 5;
  }

  _known(f) {
    if (!f || f.done) return;
    const a = this.assets.get(f.asset);
    const e = a.t.effect;
    this.log(`Fault: ${a.name}${f.kind === "theft" ? " (cable theft)" : ""}: ${e.what}; ${REPORTS[f.path] ?? f.path}${f.knownAt - f.t > 20 ? ` after ${Math.round(f.knownAt - f.t)} min` : ""}`, "fault");
    this.events("fault", { fault: f, asset: a });
    this._dispatch(f);
  }

  /** People who can repair a fault of a discipline at time t, best first: [{person, start, how}]. */
  _responders(discipline, t) {
    const out = [];
    for (const p of this.people) {
      if (p.discipline !== discipline || !p.employed(t) || (p.role !== "emergency" && p.role !== "day")) continue;
      const s = shiftOf(p, t, this.model, this.people);
      if (p.busyUntil > t && p.task?.kind === "fault") continue;
      if (s.on && p.role === "emergency" && p.busyUntil <= t) out.push({ person: p, start: t, how: "emergency" });
      else if (s.on && p.role === "day") out.push({ person: p, start: t + (p.busyUntil > t ? 10 : 0), how: "day" });
      else if (s.kind === "oncall" && p.busyUntil <= t) out.push({ person: p, start: t + this.model.staff.oncall_alert_min, how: "oncall" });
    }
    const rank = { emergency: 0, day: 1, oncall: 2 };
    return out.sort((a, b) => rank[a.how] - rank[b.how] || a.start - b.start);
  }

  /** Minutes by car from the base to an asset (on the layout: over its streets). */
  travelMinutes(a, from = this.base) {
    if (a.on_layout && from === this.base) {
      const m = this.hooks.travel?.(a);
      if (Number.isFinite(m)) return m;
      return 8;
    }
    return this.net.driveMinutes(from, a.pos ?? this.base);
  }

  _dispatch(f) {
    const a = this.assets.get(f.asset), t = this.now, m = this.model;
    const r = stream(this.seed, "repair", f.id);
    const [best] = this._responders(a.discipline, t);
    let start, travel, who;
    if (best) {
      const p = best.person;
      who = p;
      // a day technician leaves the planned work; it goes back to the work list
      if (best.how === "day") this._dropPlan(p);
      start = best.start;
      travel = this.travelMinutes(a) + (best.how === "oncall" ? 15 : 0);
      f.how = best.how;
      this.stats.callouts++;
      if (best.how === "oncall" || (t % DAY) < 360 || (t % DAY) >= 1320) this.stats.nightCallouts += best.how === "oncall" ? 1 : 0;
    } else {
      // nobody of our own: the framework contractor of the discipline comes out
      start = t + m.costs.contractor_callout_min;
      travel = this.travelMinutes(a);
      f.how = "contractor";
      this.stats.contractorCallouts++;
    }
    const work = lognormal(r, (a.t.repair_h || 2) * 60 * (a.t.possession ? 1.15 : 1), 0.5);
    f.responder = who?.id ?? null;
    f.leave = start;
    f.arrive = start + travel;
    f.end = f.arrive + work;
    f.back = f.end + travel;
    if (who) {
      who.busyUntil = f.back;
      who.task = { kind: "fault", asset: a.id, fault: f.id, leave: f.leave, arrive: f.arrive, end: f.end, back: f.back, oncall: f.how === "oncall" };
    }
    this.stats.responses.push(f.arrive - f.t);
    this.schedule(f.arrive, "arrive", { id: f.id }, 2);
    this.schedule(f.end, "fixed", { id: f.id }, 2);
    this.events("dispatch", { fault: f, asset: a, person: who });
  }

  _arrive(f) {
    if (!f || f.done) return;
    const a = this.assets.get(f.asset), p = this.people.find((x) => x.id === f.responder);
    this.log(`${p ? p.name : "Contractor"} at ${a.name}${f.how === "oncall" ? " (called out from home)" : ""}`, "work");
  }

  _fixed(f) {
    if (!f || f.done) return;
    const a = this.assets.get(f.asset), m = this.model;
    f.done = true;
    this._accrue(f, this.now);
    a.fault = null;
    a.repair(a.t.fix_gain ?? 0.05, this.now, this.startYear);
    const r = stream(this.seed, "fixed", f.id);
    a.observe(this.now, 0.05, "repair", r);
    a.serviced = this.now;
    this.faults.delete(f.id);
    this.stats.restores.push(this.now - f.t);
    // costs: materials, and the hours (overtime beyond the shift; contractors by the hour)
    this.pay("maintenance", a.t.repair_eur * (m.costs.materials_factor ?? 1), "repairs", `${a.name}: fault repair`, { force: true });
    const hours = (f.back - f.leave) / 60;
    if (f.how === "contractor") this.pay("maintenance", hours * m.costs.contractor_hour_eur, "contractors", `${a.name}: contractor call-out`, { force: true });
    else {
      const p = this.people.find((x) => x.id === f.responder);
      const s = p ? shiftOf(p, f.leave, m, this.people) : null;
      const over = f.how === "oncall" ? hours : s?.on ? Math.max(0, (f.back - s.to) / 60) : hours;
      if (over > 0) {
        this.stats.overtimeH += over;
        this.pay("maintenance", over * m.costs.hour_eur * m.costs.overtime_factor, "overtime", `${a.name}: overtime`, { force: true });
      }
      if (p?.task?.fault === f.id) p.task.done = true;
    }
    this.log(`Repaired: ${a.name} after ${durationText(this.now - f.t)}`, "fixed");
    this.events("fixed", { fault: f, asset: a });
  }

  /** Delays and outages of an open fault up to time t. */
  _accrue(f, t) {
    if (!(t > f.accrued)) return;
    const a = this.assets.get(f.asset), e = a.t.effect, c = this.model.costs;
    if (e.station_eur_h) {
      const h = (t - f.accrued) / 60;
      this.stats.stationHours += h;
      this.stats.stationEur += h * e.station_eur_h;
      this.pay("maintenance", h * e.station_eur_h, "station outages", `${a.name} out of order`, { force: true });
    } else {
      const trains = this._trainsBetween(a.line, f.accrued, t) * (e.share ?? 0.5);
      const min = e.hold ? trains * c.cancel_min : trains * (e.delay_min ?? 1) * (f.kind === "theft" ? 2 : 1);
      if (e.hold) this.stats.cancelled += trains;
      this.stats.delayMin += min;
      this.stats.perfEur += min * c.delay_eur_min;
    }
    f.accrued = t;
  }

  /* ---------------------------------------------------------------- planned work */

  _queueInspection(a, method) {
    const task = { id: `T-${++this.nTask}`, kind: "inspect", asset: a.id, method, due: a.nextInspect, discipline: method === "drone" ? "drone" : a.discipline, prio: a.nextInspect < this.now - 30 * DAY ? 1 : 2 };
    a.inspectTask = task.id;
    this.backlog.push(task);
    return task;
  }

  /** Put the planned work of a person (not started) back on the work list. */
  _dropPlan(p) {
    for (const item of p.plan) if (item.start > this.now && !item.done) {
      item.cancelled = true;
      this.backlog.push(item.task);
    }
    p.plan = p.plan.filter((i) => !i.cancelled);
  }

  /**
   * The work of the day for the day technicians and pilots: the most urgent tasks of their
   * discipline, one after the other, as long as they fit into the shift (with the drives).
   */
  _planDay() {
    const m = this.model, t = this.now, d = this.today;
    const flyable = stream(this.seed, "weather", d).chance(m.drones.flyable);
    const order = (x, y) => x.prio - y.prio || x.due - y.due;
    this.backlog.sort(order);
    for (const p of this.people) {
      if (p.role !== "day" && p.role !== "pilot") continue;
      p.plan = [];
      const s = shiftOf(p, t + 10, m, this.people);
      if (!s.on || p.busyUntil > t + 60) continue;
      if (p.role === "pilot" && !flyable) continue;
      let cursor = Math.max(t, s.from) + BRIEF_MIN, at = this.base;
      for (let i = 0; i < this.backlog.length; i++) {
        const task = this.backlog[i];
        if (task.discipline !== p.discipline) continue;
        const a = this.assets.get(task.asset);
        if (!a || a.removed) {
          this.backlog.splice(i--, 1);
          continue;
        }
        const drive = at === this.base ? this.travelMinutes(a) : this.net.driveMinutes(at, a.pos ?? this.base);
        const work = this._workMinutes(task, a);
        const back = this.travelMinutes(a);
        if (cursor + drive + work + back > s.to) continue;
        const item = { task, start: cursor, arrive: cursor + drive, end: cursor + drive + work, asset: a.id, token: `${task.id}:${d}` };
        item.task.token = item.token;
        p.plan.push(item);
        this.backlog.splice(i--, 1);
        this.schedule(item.end, "task", { task, token: item.token, person: p.id }, 3);
        cursor = item.end;
        at = a.pos ?? this.base;
        if (p.plan.length >= 8) break;
      }
      if (p.plan.length) {
        const last = p.plan[p.plan.length - 1];
        p.busyUntil = last.end + this.travelMinutes(this.assets.get(last.asset));
        p.task = { kind: "plan", items: p.plan, back: p.busyUntil };
      }
    }
  }

  _workMinutes(task, a) {
    const t = a.t, size = t.linear ? a.length_km : 1;
    if (task.kind === "inspect") {
      if (task.method === "drone") return this.model.drones.setup_min + (t.linear ? (size / this.model.drones.km_per_h) * 60 : 8);
      return (t.inspect_min || 30) * size * (t.possession ? 1.3 : 1);
    }
    if (task.kind === "repair") return (t.repair_h || 2) * 60 * 2 * size ** 0.5;
    if (task.kind === "retrofit") return 240;
    return 60;
  }

  _taskDone(task, token) {
    if (!task || task.token !== token || task.cancelled) return;
    const p = this.people.find((x) => x.plan.some((i) => i.task === task && !i.cancelled));
    const item = p?.plan.find((i) => i.task === task);
    if (item) item.done = true;
    const a = this.assets.get(task.asset);
    if (!a || a.removed) return;
    const r = stream(this.seed, "task", task.id);
    if (task.kind === "inspect") this._inspected(a, task.method, r);
    else if (task.kind === "repair") {
      a.repair(REPAIR_GAIN, this.now, this.startYear);
      a.observe(this.now, 0.04, "repair", r);
      a.serviced = this.now;
      this.pay("maintenance", a.t.repair_eur * REPAIR_FACTOR * a.size ** 0.5, "repairs", `${a.name}: planned repair`, { force: true });
      this.log(`Repair done: ${a.name}`, "work");
      if (task.proposal) this._proposalDone(task.proposal);
    } else if (task.kind === "retrofit") {
      a.retrofit = Math.max(a.retrofit, a.t.retrofit?.share ?? 0.4);
      a.data = Math.min(1, a.data + 0.1);
      this.pay("maintenance", a.t.retrofit?.eur ?? 20000, "retrofits", `${a.name}: condition monitoring`, { force: true });
      this.log(`Condition monitoring added: ${a.name} now reports ${Math.round(a.liveShare(this.assets) * 100)} % of its condition live`, "good");
      if (task.proposal) this._proposalDone(task.proposal);
    }
  }

  /** An inspection's result: the observation, the rules' clock, servicing, and a finding for the ALV. */
  _inspected(a, method, r, { quiet = false } = {}) {
    const M = METHODS[method];
    const visible = method === "drone" ? a.t.drone ?? 0 : method === "train" && a.type === "turnout" ? 0.5 : 1;
    a.observe(this.now, M.sigma, method, r, { visible });
    if (this._counts(method, a)) a.lastRule = this.now;
    if (M.servicing) a.serviced = this.now;
    a.inspectTask = null;
    const plan = this.plans[a.type];
    if (plan.method === method || !a.nextInspect || a.nextInspect < this.now) a.nextInspect = this.now + (plan.per_year > 0 ? (365 / plan.per_year) * DAY : Infinity);
    this.stats.inspections++;
    if (method === "drone") {
      this.stats.droneFlights++;
      this.pay("maintenance", this.model.costs.drone_flight_eur, "inspections", `drone flight: ${a.name}`, { force: true });
    }
    const k = this.known(a);
    if (!quiet) this.events("inspected", { asset: a, method, known: k });
    // a finding for the ALV when the known grade is 4 or worse and worse than at the last finding
    if (k.grade >= 4 && k.grade > (a.findingGrade ?? 3) && !this.proposals.some((p) => p.assets.includes(a.id) && !["declined", "done"].includes(p.status)) && !this.open("alv").some((i) => i.data?.asset === a.id)) {
      a.findingGrade = k.grade;
      const old = a.age(this.now, this.startYear) >= a.life * 0.9;
      const options = [{ id: "watch", label: "Keep watching" }, { id: "repair", label: "Propose a repair" }];
      if (a.t.retrofit && a.liveShare(this.assets) < 0.3) options.push({ id: "retrofit", label: "Propose condition monitoring" });
      options.push({ id: "renew", label: "Propose a renewal" });
      this.ask({ role: "alv", kind: "finding", data: { asset: a.id, discipline: a.discipline }, title: `Finding: ${a.name} grade ${k.grade} (${METHODS[method].label.toLowerCase()})`,
        text: `${DISCIPLINES[a.discipline].label}. Age ${Math.round(a.age(this.now, this.startYear))} of ${a.life} years; known condition ${gradeValue(k.h).toFixed(1)} ± ${(k.sigma * 5).toFixed(1)}.`,
        options, def: k.grade >= 5 ? (old ? "renew" : "repair") : "watch", pause: false, days: Math.max(30, this.model.decision_days * 3) });
    }
  }

  /** A measurement train runs over a line: track geometry, overhead line and radio coverage. */
  _measurementRun(lineId) {
    const l = this.net.lines.get(lineId);
    if (!l) return;
    const r = stream(this.seed, "train", lineId, this.today);
    let n = 0;
    for (const a of this.assets.values()) {
      if (a.removed || a.line !== lineId) continue;
      const plan = this.plans[a.type];
      if (plan.method === "train" || (a.type === "turnout" && plan.per_year > 0)) {
        this._inspected(a, "train", r, { quiet: true });
        n++;
      }
    }
    if (!n) return;
    this.stats.trainRuns++;
    this.pay("maintenance", this.model.costs.train_eur_km * (l.km[1] - l.km[0]) * l.tracks, "inspections", `measurement train line ${lineId}`, { force: true });
    this.log(`Measurement train on line ${lineId}: ${n} assets measured`, "work");
  }

  /* ---------------------------------------------------------------- proposals (ALV → asset manager) */

  /** Estimated costs of a measure for assets (or an upgrade). */
  estimate(measure, assetIds = [], upgrade = null) {
    if (measure === "upgrade") return this.model.upgrades.find((u) => u.id === upgrade)?.cost_eur ?? 0;
    const list = assetIds.map((id) => this.assets.get(id)).filter(Boolean);
    if (measure === "repair") return list.reduce((s, a) => s + a.t.repair_eur * REPAIR_FACTOR * a.size ** 0.5, 0);
    if (measure === "retrofit") return list.reduce((s, a) => s + (a.t.retrofit?.eur ?? 0), 0);
    return list.reduce((s, a) => s + this.desk.baseCost(a, measure) * (1 + this.model.hoai.fee_share), 0);
  }

  _decideProposal(item, choice) {
    const pr = this.proposals.find((p) => p.id === item.data.proposal);
    if (!pr || pr.status !== "proposed") return;
    if (choice !== "approve") {
      pr.status = "declined";
      return;
    }
    pr.status = "approved";
    const M = MEASURES[pr.measure];
    if (M.project) {
      const p = this.desk.create({ measure: pr.measure, assets: pr.assets, upgrade: pr.upgrade, proposal: pr.id });
      pr.project = p.id;
      return;
    }
    for (const id of pr.assets) {
      const a = this.assets.get(id);
      if (!a) continue;
      this.backlog.push({ id: `T-${++this.nTask}`, kind: pr.measure, asset: id, due: this.now, discipline: a.discipline, prio: 0, proposal: pr.id });
    }
  }

  _proposalDone(id) {
    const pr = this.proposals.find((p) => p.id === id);
    if (!pr) return;
    pr.left = (pr.left ?? pr.assets.length) - 1;
    if (pr.left <= 0) pr.status = "done";
  }

  _decideFinding(item, choice) {
    if (choice === "watch") return;
    this.propose(choice, [item.data.asset], { by: "alv", note: "after an inspection" });
  }

  /**
   * An ALV proposes a measure; it goes to the asset manager.
   * @returns {object|false} the proposal
   */
  propose(measure, assets = [], { upgrade = null, by = "alv", note = "" } = {}) {
    const M = MEASURES[measure];
    if (!M) return false;
    const ids = (assets || []).filter((id) => this.assets.get(id) && !this.assets.get(id).removed);
    if (measure !== "upgrade" && !ids.length) return false;
    if (measure === "upgrade" && !this.model.upgrades.some((u) => u.id === upgrade)) return false;
    if (measure === "retrofit" && !ids.every((id) => this.assets.get(id).t.retrofit)) return false;
    // nothing twice: not a measure proposed or under way, nor an asset in a running project
    if (this.proposals.some((p) => !["declined", "done"].includes(p.status) && p.measure === measure && (measure === "upgrade" ? p.upgrade === upgrade : p.assets.join() === ids.join()))) return false;
    if ([...this.desk.projects.values()].some((p) => !["done", "stopped"].includes(p.stage) && (measure === "upgrade" ? p.upgrade === upgrade : ids.some((id) => p.assets.includes(id))))) return false;
    const cost = this.estimate(measure, ids, upgrade);
    const pr = { id: `V-${this.proposals.length + 1}`, measure, assets: ids, upgrade, cost, t: this.now, by, note, status: "proposed", funding: M.funding };
    this.proposals.push(pr);
    const names = measure === "upgrade" ? this.model.upgrades.find((u) => u.id === upgrade).name : ids.map((id) => this.assets.get(id).name).join(", ");
    const account = M.funding === "lufv" ? "replacement" : M.funding === "federal" ? "own" : "maintenance";
    const left = this.balance[account];
    // the computer approves what this year's and next year's money can carry beside the projects already running
    const free = left + (account === "maintenance" ? 0 : this.budget[account]) - this.committed(account);
    // an upgrade costs the infrastructure manager the planning until the Bund pays (the rest is federal money)
    const own = M.funding === "federal" ? cost * this.model.hoai.fee_share : cost;
    const fits = account === "maintenance" ? left - cost > this.budget.maintenance * 0.1 : free >= own;
    this.ask({ role: "asset-manager", kind: "proposal", data: { proposal: pr.id }, title: `${M.label}: ${names.length > 70 ? `${names.slice(0, 68)}…` : names}?`,
      text: `Proposed by the ALV${note ? ` ${note}` : ""}. Estimated ${eur(cost)} (${M.funding === "lufv" ? "replacement money, over the project's years" : M.funding === "federal" ? "federal money if the benefit-cost ratio is at least 1; planning from own money" : "maintenance budget"}); ${eur(left)} left this year.`,
      options: [{ id: "approve", label: "Approve" }, { id: "decline", label: "Decline" }], def: fits ? "approve" : "decline" });
    return pr;
  }

  /** Money still to be paid this and next year for the running projects of an account (their remaining estimate). */
  committed(account) {
    let sum = 0;
    for (const p of this.desk.projects.values()) {
      if (["done", "stopped", "lph9"].includes(p.stage)) continue;
      if ((p.funding === "federal" ? "own" : "replacement") !== account) continue;
      const total = (p.price ?? p.calculation ?? p.estimate ?? p.base) * (p.funding === "federal" ? 1 - this.model.funding.federal_share : 1) + (p.funding === "federal" ? 0 : p.base * this.model.hoai.fee_share);
      sum += Math.max(0, total - p.paid.construction - p.paid.planning);
    }
    return sum;
  }

  /* ---------------------------------------------------------------- the factory */

  factoryStart() {
    for (const o of this.factory.start(this.now)) this.schedule(o.stageEnd, "factory", { id: o.id }, 3);
  }

  _factoryStage(id) {
    const o = this.factory.orders.find((x) => x.id === id);
    if (!o || o.stage === "done" || o.stageEnd > this.now + 1e-6) return;
    const before = o.stage;
    this.factory.advance(o, this.now, stream(this.seed, "factory", o.id, before, o.failedTest || 0));
    if (o.stage === "rework") this.log(`Plant: ${o.id} failed its factory test; rework`, o.project ? "warn" : "info");
    if (o.stage === "done") {
      if (o.project) this.desk.delivered(o.project);
    } else this.schedule(o.stageEnd, "factory", { id: o.id }, 3);
    if (before === "test" || before === "rework" || o.stage === "delivery") this.factoryStart();
  }

  /* ---------------------------------------------------------------- scenario events */

  _scenario(ev) {
    const r = stream(this.seed, "scenario", ev.type, this.now);
    if (ev.type === "storm") {
      const pool = this.active().filter((a) => a.line === String(ev.line ?? a.line) && ["catenary", "signal", "gsmr", "cable", "track"].includes(a.type));
      for (let i = 0; i < (ev.count || 4) && pool.length; i++) {
        const a = pool.splice(Math.floor(r.next() * pool.length), 1)[0];
        a.h = Math.max(0.05, a.h - 0.15);
        this._fail(a, { kind: "storm" });
      }
      this.log(`Storm: trees on the line, ${ev.count || 4} assets damaged`, "fault");
    } else if (ev.type === "theft") {
      const cables = this.active().filter((a) => a.type === "cable" && !a.fault);
      if (cables.length) this._fail(cables[Math.floor(r.next() * cables.length)], { kind: "theft" });
    } else if (ev.type === "staff_loss") {
      const pool = this.people.filter((p) => p.discipline === ev.discipline && p.role === "day" && p.employed(this.now));
      for (let i = 0; i < (ev.count || 1) && pool.length; i++) {
        const p = pool.pop();
        p.left = this.now;
        this.log(`${p.name} leaves the company`, "staff");
      }
    } else if (ev.type === "failure") {
      const a = this.assets.get(ev.asset);
      if (a) this._fail(a, { kind: "wear" });
    }
  }

  /* ---------------------------------------------------------------- the EBA's audit and the year's end */

  /** Rule compliance: assets inspected as often as the rules ask (with 10 % tolerance). */
  compliance(t = this.now) {
    const list = this.active().filter((a) => (a.t.min_per_year || 0) > 0);
    if (!list.length) return 1;
    const ok = list.filter((a) => a.lastRule != null && t - a.lastRule <= (365 / a.t.min_per_year) * 1.1 * DAY).length;
    return ok / list.length;
  }

  /** The EBA inspects the inspection records once a year (EBO § 17); overdue inspections cost a fine. */
  _audit() {
    const c = this.compliance();
    if (c >= 0.95) {
      this.log(`EBA audit: inspection records in order (${Math.round(c * 100)} % on time)`, "good");
      return;
    }
    const fine = Math.round((0.95 - c) * 400_000);
    this.stats.auditFine = fine;
    this.pay("maintenance", fine, "fines", "EBA audit: inspections overdue", { force: true });
    this.log(`EBA audit: only ${Math.round(c * 100)} % of the inspections on time; the EBA orders the backlog cleared (${eur(fine)})`, "warn");
  }

  /** Information quality: share of assets whose condition is known to ±0.5 grade. */
  informed(t = this.now) {
    const list = this.active();
    return list.filter((a) => this.known(a, t).sigma * 5 <= 0.5).length / Math.max(1, list.length);
  }

  /** Mean grade value of the network (true or known), weighted by replacement value. */
  meanGrade({ known = false, t = this.now } = {}) {
    let s = 0, w = 0;
    for (const a of this.active()) {
      const v = Math.max(1, a.t.renew_per_unit ? a.t.renew_eur * Math.max(4, a.units) : a.t.renew_eur * a.size);
      s += v * (known ? gradeValue(this.known(a, t).h) : gradeValue(a.h));
      w += v;
    }
    return w ? s / w : 0;
  }

  _closeYear(y) {
    const st = this.stats, m = this.model, t = this.now;
    for (const f of this.faults.values()) this._accrue(f, t);
    this.pay("maintenance", this.stats.perfEur - (this._perfPaid || 0), "performance regime", "delay minutes (Anreizsystem)", { force: true });
    this._perfPaid = 0;
    const grade = this.meanGrade();
    const known = this.meanGrade({ known: true });
    if (grade > m.funding.target_grade) {
      st.withheld = m.funding.target_penalty_eur;
      this.log(`Quality target missed: network grade ${grade.toFixed(2)} (target ${m.funding.target_grade.toFixed(2)}); ${eur(st.withheld)} replacement money withheld next year`, "warn");
    }
    if (this.balance.replacement > 1000) this.log(`${eur(this.balance.replacement)} replacement money not spent: it goes back to the Bund`, "money");
    const list = this.active();
    const res = {
      year: this.startYear + y, grade, knownGrade: known, share5: list.filter((a) => gradeOf(a.h) >= 5).length / Math.max(1, list.length),
      faults: st.faults, faultsByType: st.faultsByType, delayMin: Math.round(st.delayMin), constructionDelayMin: Math.round(st.constructionDelayMin), cancelled: Math.round(st.cancelled), perfEur: Math.round(st.perfEur),
      stationHours: Math.round(st.stationHours), laSections: st.laSections.size,
      response: mean(st.responses), restore: mean(st.restores), callouts: st.callouts, nightCallouts: st.nightCallouts, contractorCallouts: st.contractorCallouts,
      overtimeH: Math.round(st.overtimeH), inspections: st.inspections, droneFlights: st.droneFlights, trainRuns: st.trainRuns,
      compliance: this.compliance(), informed: this.informed(), projectsDone: st.projectsDone,
      budget: { ...this.budget }, balance: { ...this.balance }, spent: { ...st.spent }, received: { ...st.received },
      unspent: Math.max(0, this.balance.replacement), withheld: st.withheld, auditFine: st.auditFine || 0,
      staff: this.people.filter((p) => p.employed(t)).length,
    };
    res.score = this.score(res);
    this.years.push(res);
    this.log(`Year ${res.year} closed: network grade ${grade.toFixed(2)} (known ${known.toFixed(2)}), ${res.faults} faults, ${res.delayMin.toLocaleString("en")} delay minutes, score ${Math.round(res.score.total)}`, "money");
    this.events("year", { result: res });
  }

  /**
   * The score of a year (0–100 per part, weighted): condition (the true network grade), reliability
   * (delay minutes against what the network had at the start), money (budgets kept, replacement
   * money used), rules (inspections on time), information (conditions known to ±0.5 grade).
   */
  score(res) {
    const w = this.model.score;
    const ref = this._refDelay ??= this._referenceDelay();
    const over = Math.max(0, -(res.balance.maintenance)) / Math.max(1, res.budget.maintenance);
    const used = 1 - res.unspent / Math.max(1, res.budget.replacement);
    const parts = {
      condition: clamp((4 - res.grade) / 2) * 100,
      reliability: clamp(1.5 - res.delayMin / Math.max(1, ref)) * 100,
      money: clamp(1 - 3 * over) * 70 + clamp(used) * 30,
      rules: clamp((res.compliance - 0.7) / 0.3) * 100,
      information: clamp(res.informed) * 100,
    };
    const sum = Object.values(w).reduce((s, v) => s + v, 0) || 1;
    return { ...parts, total: Object.entries(parts).reduce((s, [k, v]) => s + v * (w[k] || 0), 0) / sum };
  }

  /**
   * Delay minutes a year the network would cause in its condition at the start: expected faults
   * (repaired in the usual time) and the speed restrictions on worn track.
   */
  _referenceDelay() {
    let min = 0;
    for (const a of this.assets.values()) {
      const e = a.t.effect;
      if (e.station_eur_h) continue;
      const h0 = healthAtAge(a.age(0, this.startYear), a.life);
      if ((a.type === "track" || a.type === "turnout") && h0 < LA_HEALTH) min += 365 * (this.net.lines.get(a.line)?.trains_per_day ?? 50) * (e.share ?? 0.5);
      const rate = a.failureRate(healthAtAge(a.age(0, this.startYear), a.life), this.load(a.line));
      const l = this.net.lines.get(a.line);
      const trainsPerH = (l?.trains_per_day ?? 50) / 19;
      const hours = (a.t.repair_h || 2) + 1.5;
      min += rate * trainsPerH * hours * 0.6 * (e.share ?? 0.5) * (e.hold ? this.model.costs.cancel_min : e.delay_min ?? 1);
    }
    return Math.max(1000, min);
  }

  /* ---------------------------------------------------------------- views for the panel and the world */

  /** The year's figures so far (like a closed year). */
  current() {
    const st = this.stats;
    return {
      year: st.year, grade: this.meanGrade(), knownGrade: this.meanGrade({ known: true }), compliance: this.compliance(), informed: this.informed(),
      projectsDone: st.projectsDone, faults: st.faults, delayMin: Math.round(st.delayMin), constructionDelayMin: Math.round(st.constructionDelayMin), cancelled: Math.round(st.cancelled), perfEur: Math.round(st.perfEur),
      stationHours: Math.round(st.stationHours), callouts: st.callouts, contractorCallouts: st.contractorCallouts, overtimeH: Math.round(st.overtimeH),
      inspections: st.inspections, droneFlights: st.droneFlights, response: mean(st.responses), restore: mean(st.restores), laSections: st.laSections.size,
      budget: { ...this.budget }, balance: { ...this.balance }, spent: { ...st.spent }, received: { ...st.received },
    };
  }

  /** What a person is doing at time t: {state, text, asset, phase, from, to, t0, t1}. */
  activity(p, t = this.now) {
    if (!p.employed(t)) return { state: "gone", text: "has left" };
    const task = p.task;
    if (task?.kind === "fault" && t < task.back && !(task.done && t >= task.back)) {
      const a = this.assets.get(task.asset);
      if (t < task.leave) return { state: "alerted", text: `called out to ${a?.name}`, asset: task.asset, oncall: task.oncall };
      if (t < task.arrive) return { state: "driving", text: `driving to ${a?.name}`, asset: task.asset, phase: "out", t0: task.leave, t1: task.arrive };
      if (t < task.end) return { state: "repairing", text: `repairing ${a?.name}`, asset: task.asset, phase: "work" };
      return { state: "driving", text: "driving back to the base", asset: task.asset, phase: "back", t0: task.end, t1: task.back };
    }
    if (task?.kind === "plan") {
      let prev = null;
      for (const item of task.items) {
        const a = this.assets.get(item.asset);
        if (t < item.start) break;
        const verb = item.task.kind === "inspect" ? (item.task.method === "drone" ? "flying a drone over" : "inspecting") : item.task.kind === "repair" ? "repairing" : "fitting monitoring to";
        if (t < item.arrive) return { state: "driving", text: `driving to ${a?.name}`, asset: item.asset, from: prev, phase: "out", t0: item.start, t1: item.arrive, drone: item.task.method === "drone" };
        if (t < item.end) return { state: item.task.method === "drone" ? "flying" : "working", text: `${verb} ${a?.name}`, asset: item.asset, phase: "work", t0: item.arrive, t1: item.end, drone: item.task.method === "drone" };
        prev = item.asset;
      }
      if (prev && t < task.back) return { state: "driving", text: "driving back to the base", asset: prev, phase: "back", t0: task.items[task.items.length - 1].end, t1: task.back };
    }
    const s = shiftOf(p, t, this.model, this.people);
    if (s.on) return { state: "base", text: `at the base (${SHIFTS[s.kind]?.label ?? "day"} shift)` };
    if (s.kind === "oncall") return { state: "oncall", text: "on call at home" };
    return { state: "off", text: "off duty" };
  }
}

/* ---------------------------------------------------------------- actions */

const ACTIONS = {
  /** A role decides an open item. */
  decide(id, choice) {
    const item = this.inbox.find((i) => i.id === id);
    if (!item || item.decided) return false;
    this._resolve(item, choice, "player");
    return true;
  },
  /** An ALV proposes a measure. */
  propose(measure, assets, upgrade = null, note = "") {
    return this.propose(measure, assets, { upgrade, by: "alv", note }) ? true : false;
  },
  /** An ALV changes the inspection plan of a type. */
  plan(type, method, perYear) {
    if (!this.plans[type] || !METHODS[method]) return false;
    const types = METHODS[method].types;
    if (types && !types.includes(type)) return false;
    if (method === "drone" && !(this.model.types[type].drone > 0)) return false;
    const before = this.plans[type];
    this.plans[type] = { method, per_year: Math.max(0, Math.min(52, +perYear || 0)) };
    for (const a of this.assets.values()) {
      if (a.type !== type) continue;
      const last = a.obs?.t ?? -YEAR;
      a.nextInspect = this.plans[type].per_year > 0 ? last + (365 / this.plans[type].per_year) * DAY : Infinity;
      if (a.inspectTask && before.method !== method) {
        this.backlog = this.backlog.filter((x) => x.id !== a.inspectTask);
        a.inspectTask = null;
      }
    }
    this.log(`Inspection plan: ${ASSET_TYPES[type].plural.toLowerCase()} ${METHODS[method].label.toLowerCase()} ${this.plans[type].per_year}× a year`, "plan");
    return true;
  },
  /** The asset manager staffs a discipline (hiring takes time; people leave at once). */
  staff(discipline, role, count) {
    if (!DISCIPLINES[discipline] || (role !== "day" && role !== "emergency")) return false;
    const now = this.people.filter((p) => p.discipline === discipline && p.role === role && p.employed(this.now) && !(p.left > this.now));
    const coming = this.queue.items.filter((e) => e.type === "hire" && e.data.discipline === discipline && e.data.role === role).length;
    const want = Math.max(0, Math.min(40, Math.round(count)));
    if (want > now.length + coming) {
      for (let i = now.length + coming; i < want; i++) this.schedule(this.now + this.model.staff.hire_days * DAY, "hire", { discipline, role }, 1);
      this.log(`${want - now.length - coming} ${DISCIPLINES[discipline].short} ${role === "emergency" ? "emergency team members" : "technicians"} to be hired (start in about ${Math.round(this.model.staff.hire_days / 30)} months)`, "staff");
    } else if (want < now.length) {
      for (const p of now.slice(want)) p.left = this.now + 90 * DAY;
      this.log(`${now.length - want} ${DISCIPLINES[discipline].short} ${role === "emergency" ? "emergency team members" : "technicians"} leave in three months`, "staff");
    }
    return true;
  },
  /** Drone pilots. */
  pilots(count) {
    const now = this.people.filter((p) => p.role === "pilot" && p.employed(this.now) && !(p.left > this.now));
    const want = Math.max(0, Math.min(10, Math.round(count)));
    for (let i = now.length; i < want; i++) this.schedule(this.now + 60 * DAY, "hire", { discipline: "drone", role: "pilot" }, 1);
    for (const p of now.slice(want)) p.left = this.now + 30 * DAY;
    return true;
  },
  /** On-call duty outside the shifts on or off. */
  oncall(on) {
    this.model.staff.oncall = !!on;
    this.log(`On-call duty ${on ? "on" : "off"}`, "staff");
    return true;
  },
  /** The dispatcher sends somebody to inspect an asset today (or a drone). */
  inspect(assetId, method) {
    const a = this.assets.get(assetId);
    if (!a || a.removed || !METHODS[method] || method === "train") return false;
    if (METHODS[method].types && !METHODS[method].types.includes(a.type)) return false;
    if (method === "drone" && !(a.t.drone > 0)) return false;
    const task = this._queueInspection(a, method);
    task.prio = 0;
    this.log(`Inspection ordered: ${a.name} (${METHODS[method].label.toLowerCase()})`, "plan");
    return true;
  },
  /** The planner or the supervision sets an option of a project. */
  option(projectId, key, value) {
    const p = this.desk.projects.get(projectId);
    if (!p || !(key in p.options)) return false;
    p.options[key] = value;
    return true;
  },
  /** Something happens now (a scenario event: `storm`, `theft`, `staff_loss`, `failure`); returns what happened. */
  inject(ev) {
    if (!ev || !["storm", "theft", "staff_loss", "failure"].includes(ev.type)) return false;
    const before = this.logs.length;
    this._scenario(ev);
    return this.logs.slice(before).map((l) => l.text).join("; ") || "nothing happened";
  },
  /** An asset fails now. */
  fail(assetId) {
    const a = this.assets.get(assetId);
    if (!a || a.removed || a.fault) return false;
    this._fail(a, { kind: "wear" });
    return true;
  },
  /** Who plays a role. */
  role(role, who) {
    if (!ROLES[role]) return false;
    this.roles[role] = who === "computer" ? "computer" : "student";
    if (this.roles[role] === "computer") for (const item of this.open(role)) this._resolve(item, item.def, "computer");
    return true;
  },
};

export { ACTIONS as INFRA_ACTIONS };

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const clamp = (v) => Math.min(1, Math.max(0, v));

/** "2:05 h", "3 d 4 h". */
export function durationText(min) {
  if (!Number.isFinite(min)) return "–";
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  if (m < 2 * DAY) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h`;
  return `${Math.floor(m / DAY)} d ${Math.round((m % DAY) / 60)} h`;
}
