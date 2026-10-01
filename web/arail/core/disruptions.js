/**
 * Disruptions: delays, cancellations, closures, replacement buses, crowd surges, ...
 *
 * A disruption type is a plain definition object (register more with
 * `registry.registerDisruption(def)`):
 *
 *   {
 *     type: "delay",                        // unique name
 *     label: "Delay",                       // for the app
 *     description: "...",
 *     targets: "rail" | "bus" | "any",      // which stop areas it can target
 *     params: [ParamSpec],                  // editable parameters (like object params)
 *     duration(params) -> seconds | null,   // default duration (null = until stopped)
 *     appliesTo(area, d, world) -> bool,    // optional; default: target is "*" or the area's object
 *     effects(d, area, world) -> Effects,   // how the disruption changes services and passengers
 *     draw(view, d, world),                 // optional extra drawing (default: warning sign)
 *   }
 *
 * Effects (all optional) are merged over all active disruptions of a stop area:
 *   closed    (bool)    no passengers and no vehicles; waiting people leave
 *   hold      (bool)    vehicles do not arrive (held); they come soon after the hold ends
 *   cancel    (bool)    scheduled vehicles are cancelled
 *   leave     (bool)    waiting passengers give up and leave
 *   demand    (factor)  passenger arrival rate
 *   frequency (factor)  vehicle frequency (> 1 = more often)
 *   mood      (per s)   extra change of passenger mood per second (negative = worse)
 *   messages  (strings) shown on signs and boards
 * @module arail/core/disruptions
 */
import { OVERLAY, PALETTE, rgba, shade } from "./colors.js";

const minutes = (key = "minutes", def = 10) => ({ key, label: "Duration", type: "number", unit: "min (simulated)", min: 1, max: 240, step: 1, default: def });
const remaining = (d, world) => (d.until == null ? "" : ` (${Math.max(0, Math.ceil((d.until - world.time) / 60))} min left)`);

export const BUILTIN_DISRUPTIONS = [
  {
    type: "delay",
    label: "Delay",
    description: "Vehicles are held back; waiting passengers get annoyed. They arrive soon after the delay ends.",
    targets: "any",
    params: [minutes("minutes", 8)],
    duration: (p) => p.minutes * 60,
    effects: (d, area, world) => ({ hold: true, mood: -0.02, messages: [`Delay${remaining(d, world)}`] }),
  },
  {
    type: "cancellation",
    label: "Cancellations",
    description: "Scheduled vehicles do not run.",
    targets: "any",
    params: [minutes("minutes", 10)],
    duration: (p) => p.minutes * 60,
    effects: (d, area, world) => ({ cancel: true, mood: -0.01, messages: [`Services cancelled${remaining(d, world)}`] }),
  },
  {
    type: "closure",
    label: "Closure",
    description: "The stop is closed: nobody may enter, waiting passengers leave, vehicles do not stop.",
    targets: "any",
    params: [minutes("minutes", 10)],
    duration: (p) => p.minutes * 60,
    effects: (d, area, world) => ({ closed: true, leave: true, demand: 0, messages: [`Closed${remaining(d, world)}`] }),
    draw(view, d, world) {
      for (const area of affectedAreas(d, world)) drawHatch(view, area);
    },
  },
  {
    type: "replacement-bus",
    label: "Rail replacement bus",
    description: "Trains at the platform do not run; passengers are sent to a bus terminal where extra buses run.",
    targets: "rail",
    params: [
      { key: "bus_terminal", label: "Bus terminal", type: "object", objectType: "bus-terminal" },
      minutes("minutes", 15),
    ],
    duration: (p) => p.minutes * 60,
    appliesTo: (area, d) => area.owner?.id === d.target || (d.target === "*" && area.kind === "rail") || area.owner?.id === d.params.bus_terminal,
    effects(d, area, world) {
      if (area.owner?.id === d.params.bus_terminal) {
        return { frequency: 2.5, demand: 1.8, messages: ["Rail replacement service"] };
      }
      const terminal = d.params.bus_terminal ? world.getObject(d.params.bus_terminal) : null;
      return { cancel: true, leave: true, demand: 0.15, mood: -0.01, messages: [`Replacement buses${terminal ? ` → ${terminal.name}` : ""}${remaining(d, world)}`] };
    },
  },
  {
    type: "crowd",
    label: "Crowd surge",
    description: "Many more passengers than usual, e.g. after a football match.",
    targets: "any",
    params: [{ key: "factor", label: "Demand factor", type: "number", min: 1, max: 10, step: 0.5, default: 4 }, minutes("minutes", 6)],
    duration: (p) => p.minutes * 60,
    effects: (d, area, world) => ({ demand: d.params.factor, mood: -0.003, messages: [`Crowding${remaining(d, world)}`] }),
  },
  {
    type: "signal-failure",
    label: "Signal failure",
    description: "No trains can run on the affected platforms (all rail stops if no target is chosen).",
    targets: "rail",
    params: [minutes("minutes", 10)],
    duration: (p) => p.minutes * 60,
    appliesTo: (area, d) => area.kind === "rail" && (d.target === "*" || area.owner?.id === d.target),
    effects: (d, area, world) => ({ hold: true, mood: -0.025, messages: [`Signal failure${remaining(d, world)}`] }),
  },
];

/** Stop areas affected by a disruption. */
export function affectedAreas(d, world) {
  return world.stopAreas().filter((a) => appliesTo(d, a, world));
}

function appliesTo(d, area, world) {
  if (d.def.appliesTo) return d.def.appliesTo(area, d, world);
  if (d.def.targets && d.def.targets !== "any" && area.kind !== d.def.targets) return false;
  return d.target === "*" || area.owner?.id === d.target || area.id === d.target;
}

function drawHatch(view, area) {
  const h = area.W / 2;
  view.polygon(area.outline(), { fill: rgba(OVERLAY.danger, 0.28), stroke: rgba(OVERLAY.danger, 0.95), width: 2, order: 20 });
  const n = Math.max(2, Math.round(area.L / 3)), hatch = { stroke: rgba(OVERLAY.danger, 0.7), width: 2, order: 21 };
  for (let i = 0; i < n; i++) {
    const s = (area.L * (i + 0.5)) / n;
    view.line([area.toLayout(Math.max(0, s - h), -h), area.toLayout(Math.min(area.L, s + h), h)], hatch);
  }
}

let nextId = 1;

export class DisruptionManager {
  /** @param {import("./world.js").World} world */
  constructor(world) {
    this.world = world;
    /** @type {Array<{id: string, type: string, def: object, target: string, params: object, started: number, until: number | null}>} */
    this.active = [];
    this._cache = new Map();
  }

  reset() {
    for (const d of [...this.active]) this.stop(d.id);
  }

  /**
   * Start a disruption.
   * @param {{type: string, target?: string, params?: object, duration?: number | null, id?: string}} spec
   *   target: object ID or "*" (all); duration in simulated seconds (default from the type)
   */
  start({ type, target = "*", params = {}, duration, id }) {
    const def = this.world.registry.disruptions.get(type);
    if (!def) throw new Error(`Unknown disruption type: ${type}`);
    const p = {};
    for (const ps of def.params || []) if (ps.default !== undefined) p[ps.key] = ps.default;
    Object.assign(p, params);
    const dur = Number(duration !== undefined ? duration : def.duration ? def.duration(p) : null);
    const until = duration === null || !(dur > 0) ? null : this.world.time + dur;
    const d = { id: id || `d${nextId++}`, type, def, target: target || "*", params: p, started: this.world.time, until };
    this.stop(d.id);
    this.active.push(d);
    this._cache.clear();
    def.onStart?.(d, this.world);
    this.world.events.emit("disruption.started", { disruption: d });
    return d;
  }

  stop(id) {
    const i = this.active.findIndex((d) => d.id === id);
    if (i < 0) return false;
    const [d] = this.active.splice(i, 1);
    this._cache.clear();
    d.def.onStop?.(d, this.world);
    this.world.events.emit("disruption.ended", { disruption: d });
    return true;
  }

  step() {
    for (const d of [...this.active]) if (d.until != null && this.world.time >= d.until) this.stop(d.id);
    this._cache.clear();
  }

  /** Merged effects of all active disruptions on a stop area (cached per step). */
  effectsFor(area) {
    let fx = this._cache.get(area.id);
    if (fx) return fx;
    fx = { closed: false, hold: false, cancel: false, leave: false, demand: 1, frequency: 1, mood: 0, messages: [], disruptions: [] };
    for (const d of this.active) {
      if (!appliesTo(d, area, this.world)) continue;
      const e = d.def.effects ? d.def.effects(d, area, this.world) || {} : {};
      fx.closed ||= !!e.closed;
      fx.hold ||= !!e.hold;
      fx.cancel ||= !!e.cancel;
      fx.leave ||= !!e.leave;
      if (e.demand != null) fx.demand *= e.demand;
      if (e.frequency != null) fx.frequency *= e.frequency;
      if (e.mood) fx.mood += e.mood;
      if (e.messages) fx.messages.push(...e.messages);
      fx.disruptions.push(d);
    }
    this._cache.set(area.id, fx);
    return fx;
  }

  draw(view) {
    const world = this.world;
    const signed = new Set();
    for (const d of this.active) {
      d.def.draw?.(view, d, world);
      for (const area of affectedAreas(d, world)) {
        if (signed.has(area.id)) continue;
        signed.add(area.id);
        const fx = this.effectsFor(area);
        const at = area.toLayout(area.L * 0.5, 0);
        const blink = Math.floor(view.time * 2) % 2 === 0;
        view.label([at[0], at[1], view.m(9)], fx.messages.length ? fx.messages : [d.def.label], {
          size: 12, badge: "!", badgeColor: blink ? PALETTE.warning : shade(PALETTE.warning, 0.62), background: OVERLAY.dangerLabel, order: 5,
        });
      }
    }
  }
}
