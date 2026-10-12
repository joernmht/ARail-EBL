/**
 * The infrastructure simulation in the world (`{"type": "infrastructure", …}` in the layout's
 * `simulations`): the engine (engine.js) runs with the world's fast clock, and what it does is shown
 * on the layout:
 *
 * - every asset on the layout (its infrastructure objects, tracks and platforms) in the colour of
 *   its known condition (or the true one, or the age of its last check: `display.mode`);
 * - the emergency vans and technicians' vans driving over the streets from the maintenance base to
 *   the assets and back (to the edge of the layout for assets beyond it), technicians at work,
 *   drones flying from the base's pad;
 * - the orders in the level crossing plant;
 * - faults at the station on the layout hold its trains or let them pass at caution (an
 *   "infra-fault" disruption on its platforms), which also holds the trains of rail operations.
 *
 * Players change the game with `act(name, …)` (engine.js); the panel fast-forwards with
 * `runTo` / `runYear`. A game is saved as its actions (`save()`), and restored by running them again.
 * Runtime state stays out of the layout: `toJSON()` returns the settings.
 * @module arail/infra/simulation
 */
import { Simulation } from "../core/simulation.js";
import { CD, OVERLAY, grey, rgba, shade } from "../core/colors.js";
import { polylineAt, polylineLengths } from "../core/math.js";
import { drawPerson } from "../sims/passengers.js";
import { boxFaces } from "../core/transit.js";
import { InfraEngine, YEAR } from "./engine.js";
import { applyScenario, normalizeInfra, scenariosOf, validateInfra } from "./config.js";
import { ASSET_OBJECTS } from "./objects.js";
import { Network } from "./network.js";
import { gradeColour } from "./catalog.js";
import { STAGE_LABELS } from "./factory.js";
import { DAY } from "../ops/util.js";

/** Colours of the maintenance staff on foot: an orange high-visibility vest. */
export const STAFF_COLOURS = { body: CD.orange, legs: CD.dunkelblau };
/** Colour of the vans (DB-like white with an orange stripe is too much detail: white with orange roof). */
const VAN = { body: "#f2f2ef", top: CD.orange };
const DRIVE_KMH = 30, WALK_MPS = 1.2;

export class InfrastructureSimulation extends Simulation {
  static type = "infrastructure";
  static label = "Infrastructure (assets and maintenance)";
  static description = "Railway assets with their condition, failures and how well they are known; maintenance staff in shifts, emergency vans and drones; renewals through the HOAI phases with funding and tenders.";
  static params = [];

  static validate(cfg, layout) {
    return validateInfra(cfg, layout);
  }

  constructor(world, config = {}) {
    super(world, config);
    /** @type {InfraEngine | null} */
    this.engine = null;
    /** How assets are drawn: mode "known" | "true" | "checked" | "off"; labels "faults" | "all" | "none". */
    this.display = { mode: "known", labels: "faults" };
    /** The asset selected in the panel (its label is shown). */
    this.selected = null;
    /** Engine minutes minus the world clock's minutes (since its day 0). */
    this.offset = 0;
    /** A saved game to restore when the engine is built ({seed, scenario, actions, now}). */
    this.restore = null;
    this._dirty = true;
    this._key = null;
    this._disruptions = new Map();
    this._paths = new Map();
    this._offs = [
      world.events.on("object.removed", () => (this._dirty = true)),
      world.events.on("object.added", () => (this._dirty = true)),
      world.events.on("object.changed", (e) => { if (ASSET_OBJECTS[e.object?.type] || e.object?.type === "maintenance-base") this._dirty = true; }),
      world.events.on("clock.set", () => this._clockJump()),
    ];
    // one infrastructure simulation per layout: the first one runs
    this.primary = !world.simulations?.some((s) => s.constructor.type === "infrastructure");
  }

  get active() {
    return this.enabled && this.primary;
  }

  get name() {
    return this.config.name || "Infrastructure district";
  }

  dispose() {
    this._offs.forEach((off) => off());
    for (const id of this._disruptions.values()) this.world.disruptions.stop(id);
    this._disruptions.clear();
  }

  /* ---------------------------------------------------------------- the engine */

  _layout() {
    return { ...this.world.layout, scale: this.world.scale, objects: this.world.objects.map((o) => o.spec) };
  }

  /** The network of the settings (for placing the layout's assets before the engine exists). */
  _net() {
    return new Network(normalizeInfra(this.config, this._layout()));
  }

  /** The assets on the layout: its infrastructure objects, tracks and platforms. */
  layoutAssets(net = this._net()) {
    const out = [];
    for (const o of this.world.objects) {
      const type = ASSET_OBJECTS[o.type];
      if (!type || !o.geometry) continue;
      const s = o.spec;
      const at = o.anchorPoint?.();
      if (!at) continue;
      const spec = { id: o.id, type, object: o.id, name: s.name || defaultName(o), built: +s.built || null, pos: net.fromLayout(at), km: net.kmOfLayout(at), on_layout: true };
      if (type === "track") {
        const pts = o.geometry.points;
        const xs = pts.map((p) => net.kmOfLayout(p));
        spec.km = Math.min(...xs);
        spec.length_km = Math.max(0.01, this.world.scale * o.geometry.total / 1e6);
        spec.name = s.name || `Track ${s.track_id || o.id}`;
        spec.track_id = s.track_id;
      } else if (type === "catenary" || type === "cable") {
        spec.length_km = Math.max(0.01, (this.world.scale * o.geometry.total) / 1e6);
        spec.km = Math.min(...o.geometry.points.map((p) => net.kmOfLayout(p)));
      } else if (type === "platform") {
        spec.name = s.name || `Platform ${s.number || o.id}`;
        spec.tracks = [s.track_left, s.track_right].filter(Boolean);
      } else if (type === "interlocking") spec.generation = s.generation || "relay";
      if (s.interlocking) spec.interlocking = s.interlocking;
      if (type === "level-crossing") spec.road_owner = s.road_owner || "municipal";
      out.push(spec);
    }
    return out;
  }

  /** Build the engine anew when the layout's assets or the settings changed (the game is kept: its actions run again). */
  _ensure() {
    if (!this._dirty && this.engine) return;
    this._dirty = false;
    const net = this._net();
    const assets = this.layoutAssets(net);
    const key = JSON.stringify([this.config, assets.map((a) => [a.id, a.type, a.built, a.generation, a.interlocking, Math.round(a.km * 1000)]), this._baseId()]);
    if (this.engine && key === this._key) return;
    this._key = key;
    const saved = this.engine ? { ...this.engine.save(), roles: this.engine.roles } : this.restore;
    this.restore = null;
    this._build(assets, net, saved);
  }

  _baseId() {
    return this.world.objects.find((o) => o.type === "maintenance-base" && o.geometry)?.id ?? null;
  }

  _build(assets, net, saved) {
    for (const id of this._disruptions.values()) this.world.disruptions.stop(id);
    this._disruptions.clear();
    this._paths.clear();
    const base = this._baseObject();
    const basePos = base ? net.fromLayout(base.geometry.center) : null;
    const scenario = saved?.scenario ? scenariosOf(this.config).find((s) => s.id === saved.scenario) ?? null : null;
    const config = scenario ? applyScenario(this.config, scenario) : this.config;
    const quiet = { on: true };
    this.engine = new InfraEngine(config, {
      layout: this._layout(), seed: saved?.seed ?? this.world.seed, layoutAssets: assets, base: basePos, scenario,
      hooks: { travel: (a) => this._travelMinutes(a), event: (name, payload) => !quiet.on && this._event(name, payload) },
    });
    if (saved?.roles) Object.assign(this.engine.roles, saved.roles);
    if (saved?.actions?.length) this.engine.replay(saved.actions);
    // a new game starts on 1 January at the clock's time of day
    const now = Math.max(saved?.now ?? this.world.clock.minutes, this.engine.now);
    this.engine.runTo(now);
    quiet.on = false;
    // the clock shows the engine's time of day
    this.offset = this.engine.now - this._clockAbs();
    this._syncFaults();
    this.version = (this.version || 0) + 1;
  }

  /** Start a new game (a scenario of the settings, another seed); returns the engine. */
  newGame({ scenario = null, seed = null } = {}) {
    this._dirty = false;
    const net = this._net();
    this._key = null;
    this._build(this.layoutAssets(net), net, { seed: seed ?? this.world.seed, scenario, actions: [] });
    this._key = JSON.stringify([this.config, this.layoutAssets(net).map((a) => [a.id, a.type, a.built, a.generation, a.interlocking, Math.round(a.km * 1000)]), this._baseId()]);
    return this.engine;
  }

  /** A saved game (to store or download). */
  save() {
    return this.engine ? { ...this.engine.save(), roles: this.engine.roles, layout: this.world.layout.name } : null;
  }

  /** Restore a saved game. */
  load(saved) {
    if (!saved || saved.format !== "arail-infra-game/1") return false;
    this.restore = saved;
    this.engine = null;
    this._dirty = true;
    this._ensure();
    return true;
  }

  _clockAbs() {
    const c = this.world.clock;
    return c.day * DAY + c.minutes;
  }

  _engineTime() {
    return this.offset + this._clockAbs();
  }

  /** The clock was set: the engine never runs backwards; it goes on from where it is. */
  _clockJump() {
    if (!this.engine) return;
    const t = this._engineTime();
    if (t < this.engine.now) this.offset = this.engine.now - this._clockAbs();
  }

  step(dt) {
    if (!this.active) return;
    this._ensure();
    const e = this.engine;
    if (!e || e.finished) return;
    let t = this._engineTime();
    if (t < e.now - 1) {
      this.offset = e.now - this._clockAbs();
      t = e.now;
    }
    e.runTo(t);
  }

  /**
   * Run fast (without the clock) to time t, or until a decision of a student role comes up
   * (`pause`). The world's clock then shows the engine's time of day.
   * @returns {object|null} the decision it stopped at
   */
  runTo(t, { pause = true } = {}) {
    this._ensure();
    const e = this.engine;
    if (!e) return null;
    const item = e.runTo(t, { pause });
    this._afterJump();
    return item;
  }

  /** Run to the end of the year (or the next decision). */
  runYear({ pause = true } = {}) {
    return this.runTo((Math.floor(this.engine.now / YEAR) + 1) * YEAR, { pause });
  }

  /** After a jump: the clock shows the engine's time of day; faults on the layout are shown. */
  _afterJump() {
    const e = this.engine;
    const tod = e.now % DAY;
    if (Math.abs(tod - this.world.clock.minutes) > 0.5) this.world.setTime(tod);
    this.offset = e.now - this._clockAbs();
    this._syncFaults();
  }

  /** Disruptions for the open faults at the station on the layout (after a jump, or a rebuild). */
  _syncFaults() {
    const e = this.engine;
    const open = new Set();
    for (const f of e.faults.values()) {
      if (f.knownAt > e.now) continue;
      open.add(f.id);
      if (!this._disruptions.has(f.id)) this._startDisruption(f, e.assets.get(f.asset));
    }
    for (const [fid, did] of [...this._disruptions]) {
      if (open.has(fid)) continue;
      this.world.disruptions.stop(did);
      this._disruptions.delete(fid);
    }
  }

  /** The engine reports: faults at the station stop or slow its trains; events go to the world (`infra.*`). */
  _event(name, payload) {
    this.world.events.emit(`infra.${name}`, { simulation: this, ...payload });
    if (name === "fault") this._startDisruption(payload.fault, payload.asset);
    else if (name === "fixed") {
      const id = this._disruptions.get(payload.fault.id);
      if (id) this.world.disruptions.stop(id);
      this._disruptions.delete(payload.fault.id);
    }
  }

  _startDisruption(f, a) {
    if (!a?.on_layout || a.t.effect.station_eur_h || this._disruptions.has(f.id)) return;
    if (!this.world.registry.disruptions.has("infra-fault")) return;
    let target = "*";
    if (a.type === "track" && a.track_id) {
      const p = this.world.objects.find((o) => o.type === "platform" && (o.spec.track_left === a.track_id || o.spec.track_right === a.track_id));
      if (p) target = p.id;
    } else if (a.type === "platform") target = a.object;
    const e = a.t.effect;
    const text = e.hold ? `${a.name}: ${e.what}` : `${a.name}: ${e.what} (+${e.delay_min} min)`;
    const d = this.world.disruptions.start({ type: "infra-fault", target, params: { hold: !!e.hold, text: text.length > 60 ? `${text.slice(0, 58)}…` : text } });
    this._disruptions.set(f.id, d.id);
  }

  /* ---------------------------------------------------------------- driving on the layout */

  _baseObject() {
    return this.world.objects.find((o) => o.type === "maintenance-base" && o.geometry) ?? null;
  }

  _roads() {
    try {
      return this.world.network?.() || null;
    } catch {
      return null;
    }
  }

  /**
   * The drive from the base to an asset on the layout: the route over the streets (to the street
   * node nearest the asset; the last bit on foot), or to the edge of the layout for assets beyond it.
   * Cached until the layout changes. Returns {points, lengths, length (mm), walk (mm), end} or null.
   */
  _pathTo(a) {
    const key = `${this.world.objectsVersion}:${this.world.map.version}:${a.id}`;
    if (this._paths.has(key)) return this._paths.get(key);
    let path = null;
    const base = this._baseObject(), net = this._roads();
    const from = base?.entrances?.()[0]?.pos;
    if (base && net && from) {
      // the place of the door is for walking; vans start at the street node nearest to the yard
      const start = net.nearestNode(from, { mode: "car" });
      let target = null, end = null;
      if (a.on_layout) {
        end = this.world.getObject(a.object)?.anchorPoint?.() ?? null;
        target = end ? net.nearestNode(end, { mode: "car" }) : null;
      } else {
        // towards the edge of the layout on the side of the asset
        const dir = this._layoutDir(a);
        let best = -Infinity;
        for (const n of net.boundaryNodes()) {
          const v = (n.pos[0] - from[0]) * dir[0] + (n.pos[1] - from[1]) * dir[1];
          if (v > best) [best, target] = [v, n];
        }
      }
      const route = start && target ? net.route(start, target, { mode: "car" }) : null;
      if (route?.points?.length >= 2) {
        const points = [from, ...route.points];
        const lengths = polylineLengths(points);
        path = { points, lengths, length: lengths[lengths.length - 1], walk: end ? Math.hypot(end[0] - target.pos[0], end[1] - target.pos[1]) : 0, end, park: target.pos, away: !a.on_layout };
      }
    }
    this._paths.set(key, path);
    if (this._paths.size > 400) this._paths.delete(this._paths.keys().next().value);
    return path;
  }

  /** Unit direction (layout frame) from the layout's station towards an asset beyond the layout. */
  _layoutDir(a) {
    const net = this.engine.net, f = net._layoutFrame();
    if (!f || !a.pos) return [1, 0];
    const d = [a.pos[0] - f.origin[0], a.pos[1] - f.origin[1]];
    const x = d[0] * f.ux[0] + d[1] * f.ux[1], y = d[0] * f.uy[0] + d[1] * f.uy[1], l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  }

  /** Minutes from the base to an asset on the layout: the drive over its streets and the walk (null without streets). */
  _travelMinutes(a) {
    const p = this._pathTo(a);
    if (!p) return null;
    const m = (mm) => (mm * this.world.scale) / 1000;
    return (m(p.length) / (DRIVE_KMH / 3.6)) / 60 + (m(p.walk) / WALK_MPS) / 60 + 2;
  }

  /* ---------------------------------------------------------------- what the objects show */

  /**
   * The state of an asset for drawing (or null): its colour, the style of its ring (live/fresh,
   * stale, age only), a fault, its label lines and badge.
   */
  assetView(id) {
    if (!this.active || !this.engine || this.display.mode === "off") return null;
    const e = this.engine, a = e.assets.get(id);
    if (!a || a.removed) return null;
    const k = e.known(a);
    const months = k.t == null ? null : Math.max(0, Math.round((e.now - k.t) / (30.4 * DAY)));
    const style = k.live >= 0.5 || k.sigma * 5 <= 0.35 ? "fresh" : k.source === "age" || k.source === "unknown" ? "age" : "stale";
    let value = k.value, colour;
    if (this.display.mode === "true") {
      value = a.fault ? 6 : 1 + 4.99 * (1 - a.h);
      colour = gradeColour(value);
    } else if (this.display.mode === "checked") {
      // colour by the age of the knowledge: live/this month Türkis … two years or never Rot
      const age = k.live >= 0.5 ? 0 : months == null ? 30 : months;
      colour = gradeColour(1 + Math.min(4, age / 6));
    } else colour = gradeColour(value);
    const fault = this.display.mode === "true" ? !!a.fault : k.fault;
    const selected = this.selected === id;
    const show = fault || selected || this.display.labels === "all";
    const check = k.live >= 0.5 ? `live ${Math.round(k.live * 100)} %` : months == null ? "never checked" : months < 1 ? "checked this month" : `checked ${months} mo ago`;
    const label = show && this.display.labels !== "none"
      ? [a.name, fault ? `Fault: ${a.t.effect.what}` : `${this.display.mode === "true" ? "true " : ""}grade ${(Math.floor(value * 10 + 1e-9) / 10).toFixed(1)} · ${check}`]
      : null;
    return { colour, style, fault, value, label, badge: fault ? "!" : String(Math.min(6, Math.floor(value))), selected, labelZ: a.type === "gsmr" ? 32 : a.type === "signal" ? 7 : 5 };
  }

  /* ---------------------------------------------------------------- drawing */

  draw(view) {
    if (!this.active || !this.engine) return;
    const e = this.engine, t = e.now;
    // the tracks and platforms of the layout show their state (their objects do not draw it)
    for (const o of this.world.objects) {
      if ((o.type !== "track" && o.type !== "platform") || !o.geometry) continue;
      const st = this.assetView(o.id);
      if (!st) continue;
      if (o.type === "track") drawBand(view, o, o.geometry.points, st, 2.4);
      else {
        const c = o.geometry.corners;
        view.polygon(c, { stroke: st.fault ? OVERLAY.danger : st.colour, width: 2.4, dash: st.style === "stale" ? [8, 5] : st.style === "age" ? [2, 5] : null, order: 40, emissive: true });
        if (st.label) view.label([o.geometry.center[0], o.geometry.center[1], o.mm(4)], st.label, { size: 10, anchor: "bottom", order: st.fault ? 6 : 2, optional: !st.fault && !st.selected, badge: st.badge, badgeColor: st.fault ? OVERLAY.danger : st.colour });
      }
    }
    const base = this._baseObject();
    if (!base) return;
    for (const p of e.people) {
      if (p.role === "alv") continue;
      const act = e.activity(p, t);
      if (!act.asset || (act.state !== "driving" && act.state !== "repairing" && act.state !== "working" && act.state !== "flying")) continue;
      const a = e.assets.get(act.asset);
      if (!a) continue;
      if (act.drone) this._drawDrone(view, base, a, act, t);
      else this._drawVan(view, a, act, t, p);
    }
  }

  /** A van on its way (or parked at the asset, with its technician at work). */
  _drawVan(view, a, act, t, p) {
    const path = this._pathTo(a);
    if (!path) return;
    if (act.state === "driving") {
      const k = act.t1 > act.t0 ? Math.min(1, Math.max(0, (t - act.t0) / (act.t1 - act.t0))) : 1;
      // the drive on the layout takes its share of the time; beyond the layout the van is out of sight
      const share = a.on_layout ? 1 : Math.min(1, ((path.length * this.world.scale) / 1000 / (DRIVE_KMH / 3.6) / 60) / Math.max(1, act.t1 - act.t0));
      let s = act.phase === "back" ? (a.on_layout ? 1 - k : (k - (1 - share)) / share) : k / share;
      if (s < 0 || s > 1) return;
      if (act.phase === "back" && !a.on_layout) s = 1 - s;
      const at = polylineAt(path.points, s * path.length, path.lengths);
      drawVan(view, at.point, act.phase === "back" ? [-at.dir[0], -at.dir[1]] : at.dir, p.role === "emergency");
      return;
    }
    if (!a.on_layout) return;
    const end = polylineAt(path.points, path.length, path.lengths);
    drawVan(view, path.park, end.dir, p.role === "emergency");
    if (path.end) drawPerson(view, path.end, { dir: [1, 0], height: 1.8, colour: STAFF_COLOURS.body, legs: STAFF_COLOURS.legs, phase: t * 3, speed: 0.4 });
  }

  /** A drone flying from the base's pad to the asset and over it. */
  _drawDrone(view, base, a, act, t) {
    const pad = base.slots?.()?.pad;
    if (!pad) return;
    const target = a.on_layout ? this.world.getObject(a.object)?.anchorPoint?.() : null;
    const dir = this._layoutDir(a);
    const far = target ?? [pad[0] + dir[0] * view.m(400), pad[1] + dir[1] * view.m(400)];
    let pos;
    const k = act.t1 > act.t0 ? Math.min(1, Math.max(0, (t - act.t0) / (act.t1 - act.t0))) : 1;
    if (act.phase === "out") pos = [pad[0] + (far[0] - pad[0]) * k, pad[1] + (far[1] - pad[1]) * k];
    else if (act.phase === "back") pos = [far[0] + (pad[0] - far[0]) * k, far[1] + (pad[1] - far[1]) * k];
    else if (target) {
      const ang = t * 0.6;
      pos = [target[0] + view.m(12) * Math.cos(ang), target[1] + view.m(12) * Math.sin(ang)];
    } else return;
    const z = view.m(act.phase === "work" ? 25 : 35 * Math.sin(Math.PI * Math.min(1, k)) + 2);
    drawDrone(view, pos, z, t, act.phase === "work" ? target : null);
  }

  /** The base shows its vans in the yard (those not out) and the drones on the pad. */
  drawBase(view, base) {
    if (!this.active || !this.engine) return;
    const s = base.slots?.();
    if (!s) return;
    const e = this.engine;
    const out = e.people.filter((p) => (p.role === "day" || p.role === "emergency") && ["driving", "repairing", "working"].includes(e.activity(p).state)).length;
    const vans = Math.max(0, Math.min(5, 5 - out));
    const dir = [Math.cos(s.angle), Math.sin(s.angle)];
    for (let i = 0; i < vans; i++) drawVan(view, s.vans[i], dir, i === 0);
    const flying = e.people.some((p) => p.role === "pilot" && e.activity(p).drone);
    if (!flying && e.people.some((p) => p.role === "pilot" && p.employed(e.now))) drawDrone(view, s.pad, view.m(0.3), 0, null);
  }

  /** The plant shows its production lines: the orders being built and the queue. */
  drawPlant(view, plant) {
    if (!this.active || !this.engine || !this.world.settings.labels) return;
    const f = this.engine.factory, g = plant.geometry;
    const lines = [];
    for (let i = 0; i < f.lines; i++) {
      const o = f.active.find((x) => x.line === i);
      lines.push(o ? `Line ${i + 1}: ${o.id}${o.project ? ` (${o.project})` : ""} · ${STAGE_LABELS[o.stage]}` : `Line ${i + 1}: free`);
    }
    const queue = f.queued.length, delivery = f.orders.filter((o) => o.stage === "delivery").length;
    if (queue || delivery) lines.push(`${queue} waiting${delivery ? ` · ${delivery} on the way` : ""}`);
    view.label([g.center[0], g.center[1], plant.mm(14)], [plant.spec.name || "Level crossing plant", ...lines], { size: 10, anchor: "bottom", order: 1, optional: true });
  }

  /* ---------------------------------------------------------------- actions for the panel and the disruptions */

  /** Something happens now (storm, theft); returns what happened. */
  inject(ev) {
    this._ensure();
    const out = this.engine?.act("inject", ev);
    return typeof out === "string" ? out : "nothing happened";
  }

  /** An asset fails now: by name or id (empty: one by chance, on the layout if there is one). */
  failAsset(nameOrId = "") {
    this._ensure();
    const e = this.engine;
    if (!e) return "no infrastructure";
    const q = String(nameOrId || "").trim().toLowerCase();
    let list = e.active().filter((a) => !a.fault);
    if (q) list = list.filter((a) => a.id.toLowerCase() === q || a.name.toLowerCase().includes(q));
    else if (list.some((a) => a.on_layout && !a.t.effect.station_eur_h)) list = list.filter((a) => a.on_layout && !a.t.effect.station_eur_h);
    if (!list.length) return q ? `no asset "${nameOrId}" without a fault` : "no asset can fail";
    const a = list[Math.floor((e.now * 7919) % list.length)];
    e.act("fail", a.id);
    return `${a.name} fails`;
  }

  toJSON() {
    return { ...this.config };
  }
}

/** The layout's infrastructure simulation, or null. */
export function infraOf(world) {
  return world?.simulations?.find((s) => s.constructor.type === InfrastructureSimulation.type) ?? null;
}

/** A default name for an object without one ("Signal signal-3"). */
function defaultName(o) {
  return `${o.constructor.label ?? o.type} ${o.spec.track_id || o.spec.number || o.id}`;
}

/** The state of a track: a band along it. */
function drawBand(view, o, points, st, widthM) {
  view.ribbon(points, o.mm(widthM), { fill: rgba(st.colour, st.fault ? 0.55 : 0.38), order: 39, emissive: true });
  view.line(points, { stroke: st.fault ? OVERLAY.danger : st.style === "age" ? "rgba(150,156,166,0.95)" : st.colour, width: st.fault ? 3 : 1.8, dash: st.style === "stale" ? [8, 5] : st.style === "age" ? [2, 5] : null, order: 40, emissive: true });
  if (st.label) {
    const L = polylineLengths(points);
    const mid = polylineAt(points, L[L.length - 1] * 0.35, L).point;
    view.label([mid[0], mid[1], o.mm(2)], st.label, { size: 10, anchor: "bottom", order: st.fault ? 6 : 2, optional: !st.fault && !st.selected, badge: st.badge, badgeColor: st.fault ? OVERLAY.danger : st.colour, background: st.fault ? OVERLAY.dangerLabel : OVERLAY.label });
  }
}

/** A maintenance van (5.5 m) at a layout point, heading `dir`. */
export function drawVan(view, at, dir, emergency = false) {
  if (!view.inImage(at[0], at[1], 0, 60)) return;
  const m = (x) => view.m(x);
  const l = Math.hypot(dir[0], dir[1]) || 1, u = [dir[0] / l, dir[1] / l];
  const rear = [at[0] - u[0] * m(2.75), at[1] - u[1] * m(2.75)], front = [at[0] + u[0] * m(2.75), at[1] + u[1] * m(2.75)];
  const faces = boxFaces(rear, front, m(2), m(0.3), m(2.4), { side: VAN.body, top: emergency ? CD.orange : grey(0.85), end: shade(VAN.body, 0.9) });
  view.faces(faces, [at[0], at[1], m(1.2)]);
  if (emergency) view.glow([at[0], at[1], m(2.5)], m(0.6), CD.orange, 0.9);
}

/** A quadcopter drone at height z (mm) over a layout point; at work its camera looks at `target`. */
export function drawDrone(view, at, z, t, target) {
  if (!view.inImage(at[0], at[1], z, 60)) return;
  const m = (x) => view.m(x);
  // its shadow on the ground, and the camera's view cone at work
  view.polygon(circle(at, m(0.8), 10), { fill: "rgba(0,0,0,0.18)", order: 9 });
  if (target) view.polygon([[at[0], at[1]], ...circle(target, m(4), 8)], { fill: rgba(CD.orange, 0.14), order: 9 });
  const arms = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const faces = [];
  for (const [sx, sy] of arms) {
    const c = [at[0] + sx * m(0.45), at[1] + sy * m(0.45)];
    faces.push({ pts: circle(c, m(0.32), 8).map((p) => [p[0], p[1], z + m(0.12)]), normal: [0, 0, 1], color: grey(0.35), alpha: 0.5 + 0.2 * Math.sin(t * 40 + sx) });
  }
  faces.push({ pts: [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]].map(([x, y]) => [at[0] + m(x), at[1] + m(y), z]), normal: [0, 0, 1], color: grey(0.18) });
  view.faces(faces, [at[0], at[1], z]);
}

function circle(c, r, n) {
  const out = [];
  for (let k = 0; k < n; k++) out.push([c[0] + r * Math.cos((2 * Math.PI * k) / n), c[1] + r * Math.sin((2 * Math.PI * k) / n)]);
  return out;
}

