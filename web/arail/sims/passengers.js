/**
 * Example simulation: passengers at stop areas (platforms, bus terminals).
 *
 * People arrive through the entrances of a stop area, wait near the edge where their
 * vehicle will stop, board through the doors, or alight and walk to an exit. A simple
 * social-force model keeps them apart. Their colour shows their mood (green = happy,
 * red = annoyed): waiting, crowding and disruptions make it worse, boarding makes it better.
 *
 * Everything is in prototype metres and simulated seconds. The simulation only uses the
 * generic stop-area/dock/vehicle interfaces, so it works for new object types, too.
 * @module arail/sims/passengers
 */
import { Simulation } from "../core/simulation.js";
import { moodColor, OVERLAY } from "../core/colors.js";

class Person {
  constructor(rng, pos, target, state, mood, dock) {
    this.pos = pos.slice();
    this.vel = [0, 0];
    this.target = target.slice();
    /** @type {"arriving" | "waiting" | "boarding" | "onboard" | "leaving"} */
    this.state = state;
    this.mood = Math.min(1, Math.max(0, mood));
    this.wait = 0;
    this.speed = rng.uniform(1.0, 1.5);
    this.height = rng.uniform(1.62, 1.92);
    this.trail = [];
    this.trailT = 0;
    this.delay = 0;
    this.phase = rng.uniform(0, 2 * Math.PI);
    /** ID of the dock whose vehicle this person wants to take (null = none). */
    this.dock = dock;
  }
}

class Crowd {
  constructor(area, rng) {
    this.area = area;
    this.people = [];
    this.t = 0;
    this.wavePhase = rng.uniform(0, 2 * Math.PI);
    this.inTimes = [];
    this.outTimes = [];
  }

  /** Slowly varying demand (0.3 .. 1.0), period 3 minutes. */
  wave() {
    return 0.3 + 0.7 * (0.5 + 0.5 * Math.sin((2 * Math.PI * this.t) / 180 + this.wavePhase));
  }

  visible() {
    return this.people.filter((p) => p.state !== "onboard");
  }
}

export class PassengerSimulation extends Simulation {
  static type = "passengers";
  static label = "Passengers";
  static description = "Passengers arrive, wait, board and alight; their colour shows their mood.";
  static params = [
    { key: "base_rate", label: "Arrivals", type: "number", unit: "people/s per 25 m", min: 0, max: 5, step: 0.05, default: 0.5 },
    { key: "max_per_area", label: "Max. people per stop", type: "number", min: 10, max: 500, step: 10, default: 140 },
  ];

  constructor(world, config) {
    super(world, config);
    /** @type {Map<string, Crowd>} */
    this.crowds = new Map();
    const on = (name, fn) => world.events.on(name, fn);
    this._unsubscribe = [
      on("vehicle.arrived", (e) => this._arrived(e)),
      on("vehicle.departing", (e) => this._departing(e)),
      on("vehicle.cancelled", (e) => this._cancelled(e)),
    ];
  }

  get rng() {
    return this.world.rng;
  }

  dispose() {
    this._unsubscribe.forEach((off) => off());
  }

  clear() {
    for (const c of this.crowds.values()) c.people = [];
  }

  _sync() {
    const areas = this.world.stopAreas();
    const seen = new Set();
    for (const area of areas) {
      seen.add(area.id);
      const c = this.crowds.get(area.id);
      if (c) c.area = area;
      else this.crowds.set(area.id, new Crowd(area, this.rng));
    }
    for (const id of [...this.crowds.keys()]) if (!seen.has(id)) this.crowds.delete(id);
  }

  stats(areaId) {
    const c = this.crowds.get(areaId);
    if (!c) return null;
    const vis = c.visible();
    return {
      count: vis.length,
      mood: vis.length ? vis.reduce((s, p) => s + p.mood, 0) / vis.length : 1,
      inPerMin: c.inTimes.length,
      outPerMin: c.outTimes.length,
    };
  }

  /* ---------------------------------------------------------------- places */

  _access(c) {
    const a = c.area;
    const i = this.rng.weighted(a.access.map((x) => x.weight ?? 1));
    const e = a.access[i];
    const jitter = Math.abs(e.t) > 0.1 ? 0.1 : 0.25;
    return [e.s + (e.s < 1 || e.s > a.L - 1 ? 0 : this.rng.uniform(-0.5, 0.5)), e.t + this.rng.uniform(-jitter, jitter) * a.W];
  }

  _exit(c, pos) {
    const a = c.area;
    const w = a.access.map((e) => Math.exp(-Math.abs(e.s - pos[0]) / 6) * (e.weight ?? 1));
    const e = a.access[this.rng.weighted(w)];
    return [e.s, e.t + this.rng.uniform(-0.2, 0.2) * a.W * (Math.abs(e.t) > 0.1 ? 0.2 : 1)];
  }

  _waitingSpot(c, dockId) {
    const a = c.area;
    const dock = a.docks.find((d) => d.id === dockId);
    if (!dock) return [this.rng.uniform(0.06, 0.94) * a.L, this.rng.uniform(-0.38, 0.38) * a.W];
    const s = this.rng.uniform(dock.s0 + 0.06 * (dock.s1 - dock.s0), dock.s1 - 0.06 * (dock.s1 - dock.s0));
    const both = a.docks.some((d) => d.side !== dock.side);
    const [lo, hi] = both ? (dock.side > 0 ? [0.02, 0.38] : [-0.38, -0.02]) : dock.side > 0 ? [-0.1, 0.38] : [-0.38, 0.1];
    return [s, this.rng.uniform(lo, hi) * a.W];
  }

  _doorSpot(dock, doors, s) {
    let best = doors[0];
    for (const d of doors) if (Math.abs(d - s) < Math.abs(best - s)) best = d;
    return [best + this.rng.uniform(-0.3, 0.3), dock.side * (dock.area.W / 2 - 0.15)];
  }

  /* ---------------------------------------------------------------- events */

  _board(p, dock, doors, delay) {
    p.state = "boarding";
    p.delay = delay ?? this.rng.uniform(0.3, 6);
    p.target = this._doorSpot(dock, doors, p.pos[0]);
    p.mood = Math.min(1, p.mood + 0.15); // finally!
  }

  _arrived({ vehicle, dock }) {
    this._sync();
    const c = this.crowds.get(dock.area.id);
    if (!c) return;
    const doors = this.world.services.doors(vehicle);
    if (!doors.length) return;
    const rng = this.rng, a = c.area;
    const fx = this.world.disruptions.effectsFor(a);
    const len = dock.s1 - dock.s0;
    const bus = dock.kind === "bus";
    const tod = this.world.clock.demand("passengers");
    const n = fx.closed ? 0 : rng.poisson(((bus ? 1 : 2) + (bus ? 3 : 6) * this.world.demand * c.wave() * (len / 25)) * Math.min(1, 0.25 + tod));
    const late = vehicle.delayMin > 0.5;
    for (let i = 0; i < n && c.people.length < this.config.max_per_area; i++) {
      const s = rng.pick(doors) + rng.uniform(-0.4, 0.4);
      const p = new Person(rng, [s, dock.side * (a.W / 2 - 0.2)], [0, 0], "onboard", rng.uniform(0.6, 0.92) - (late ? 0.35 : 0), null);
      p.delay = rng.uniform(0, 7);
      p.target = this._exit(c, p.pos);
      c.people.push(p);
    }
    for (const p of c.people) {
      if ((p.state === "waiting" || p.state === "arriving") && p.dock === dock.id && rng.chance(0.95)) this._board(p, dock, doors);
    }
  }

  _departing({ dock }) {
    const c = this.crowds.get(dock.area.id);
    if (!c) return;
    for (const p of c.people) {
      if (p.state === "boarding" && p.dock === dock.id) {
        // missed it
        p.state = "waiting";
        p.target = p.pos.slice();
        p.mood = Math.max(0, p.mood - 0.35);
      } else if (p.state === "onboard") {
        p.delay = 0;
      }
    }
  }

  _cancelled({ dock }) {
    const c = this.crowds.get(dock.area.id);
    if (!c) return;
    for (const p of c.people) if ((p.state === "waiting" || p.state === "arriving") && p.dock === dock.id) p.mood = Math.max(0, p.mood - 0.15);
  }

  /* ---------------------------------------------------------------- simulation step */

  step(dt) {
    if (!this.enabled) return;
    this._sync();
    for (const c of this.crowds.values()) this._stepCrowd(c, dt);
  }

  _stepCrowd(c, dt) {
    const rng = this.rng, a = c.area, world = this.world;
    const fx = world.disruptions.effectsFor(a);
    c.t += dt;
    const disrupted = fx.hold || fx.cancel;
    const rate = fx.closed ? 0 : this.config.base_rate * world.demand * fx.demand * c.wave() * (a.L / 25) * world.clock.demand("passengers");
    const n = rng.poisson(rate * dt);
    for (let i = 0; i < n && c.people.length < this.config.max_per_area; i++) {
      const dock = a.docks.length ? rng.pick(a.docks).id : null;
      const p = new Person(rng, this._access(c), [0, 0], "arriving", rng.uniform(0.62, 0.95) - (disrupted ? 0.3 : 0), dock);
      p.target = this._waitingSpot(c, dock);
      c.people.push(p);
      c.inTimes.push(c.t);
    }
    // give up and leave (closures, replacement services)
    if (fx.leave) {
      for (const p of c.people) {
        if ((p.state === "waiting" || p.state === "arriving") && rng.chance(0.25 * dt)) {
          p.state = "leaving";
          p.target = this._exit(c, p.pos);
        }
      }
    }
    this._move(c, dt, fx);
    for (const q of [c.inTimes, c.outTimes]) while (q.length && q[0] < c.t - 60) q.shift();
  }

  _move(c, dt, fx) {
    const rng = this.rng, a = c.area, L = a.L, W = a.W;
    for (const p of c.people) {
      if (p.state === "onboard") {
        p.delay -= dt;
        if (p.delay <= 0) {
          p.state = "leaving";
          c.inTimes.push(c.t);
        }
      }
    }
    const active = c.visible(), n = active.length;
    if (!n) return;
    // neighbours and repulsion (social forces)
    const neighbours = new Array(n).fill(0), push = active.map(() => [0, 0]), R = 0.6;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = active[i].pos[0] - active[j].pos[0], dy = active[i].pos[1] - active[j].pos[1];
        const d = Math.max(Math.hypot(dx, dy), 1e-6);
        if (d < 1.3) {
          neighbours[i]++;
          neighbours[j]++;
        }
        if (d < R) {
          const w = (((R - d) / R) * 1.4) / d;
          push[i][0] += dx * w;
          push[i][1] += dy * w;
          push[j][0] -= dx * w;
          push[j][1] -= dy * w;
        }
      }
    }
    const services = this.world.services;
    const gone = new Set();
    active.forEach((p, i) => {
      const density = Math.max(0, neighbours[i] - 2);
      const zx = p.target[0] - p.pos[0], zy = p.target[1] - p.pos[1], dist = Math.hypot(zx, zy);
      const walking = p.state === "arriving" || p.state === "leaving" || (p.state === "boarding" && p.delay <= 0);
      let vx, vy;
      if (walking) {
        const k = (p.speed * Math.min(1, dist / 0.8)) / (1 + 0.12 * density) / Math.max(dist, 1e-6);
        vx = zx * k + push[i][0];
        vy = zy * k + push[i][1];
      } else {
        vx = zx * 0.6 + 0.7 * push[i][0];
        vy = zy * 0.6 + 0.7 * push[i][1];
      }
      const acc = Math.min(1, 4 * dt);
      p.vel[0] += (vx - p.vel[0]) * acc;
      p.vel[1] += (vy - p.vel[1]) * acc;
      p.pos[0] += p.vel[0] * dt;
      p.pos[1] += p.vel[1] * dt;
      const margin = p.state === "boarding" ? 0.12 : 0.22;
      p.pos[0] = Math.min(Math.max(p.pos[0], 0.1), L - 0.1);
      p.pos[1] = Math.min(Math.max(p.pos[1], -W / 2 + margin), W / 2 - margin);
      const speed = Math.hypot(p.vel[0], p.vel[1]);
      p.phase += speed * dt * 5;
      // walking trail
      p.trailT += dt;
      if (speed > 0.3) {
        if (p.trailT > 0.4) {
          p.trail.push(p.pos.slice());
          if (p.trail.length > 12) p.trail.shift();
          p.trailT = 0;
        }
      } else if (p.trail.length && p.trailT > 0.3) {
        p.trail.shift();
        p.trailT = 0;
      }
      // state changes
      if (p.state === "arriving") {
        if (dist < 0.4) {
          const st = p.dock ? services.docks.get(p.dock) : null;
          const v = st?.vehicle;
          if (v && v.phase === "dwelling" && (v.dwellLeft > 6 || v.source === "feed")) this._board(p, st.dock, services.doors(v), 0);
          else p.state = "waiting";
        }
      } else if (p.state === "waiting") {
        p.wait += dt;
        if (rng.next() < 0.04 * dt) {
          // shifting from one foot to the other
          p.target = [Math.min(Math.max(p.target[0] + 0.4 * rng.normal(), 0.5), L - 0.5), Math.min(Math.max(p.target[1] + 0.4 * rng.normal(), -0.38 * W), 0.38 * W)];
        }
      } else if (p.state === "boarding") {
        if (p.delay > 0) p.delay -= dt;
        else if (dist < 0.35) {
          gone.add(p);
          c.outTimes.push(c.t);
        }
      } else if (p.state === "leaving" && dist < 0.5) {
        gone.add(p);
        c.outTimes.push(c.t);
      }
      // mood
      if (p.state === "arriving" || p.state === "waiting") {
        p.mood -= (0.002 + 0.005 * density + (p.wait > 60 ? 0.006 : 0) - (fx.mood || 0)) * dt;
      } else if (p.state === "boarding") p.mood += 0.02 * dt;
      else p.mood += (0.008 - 0.004 * density) * dt;
      p.mood = Math.min(1, Math.max(0, p.mood));
    });
    if (gone.size) c.people = c.people.filter((p) => !gone.has(p));
  }

  /* ---------------------------------------------------------------- drawing */

  draw(view) {
    if (!this.enabled) return;
    const settings = this.world.settings;
    for (const c of this.crowds.values()) {
      const a = c.area;
      if (!a.owner?.geometry) continue;
      const vis = c.visible();
      const mood = vis.length ? vis.reduce((s, p) => s + p.mood, 0) / vis.length : 1;
      view.polygon(a.outline(), { fill: moodColor(mood), alpha: 0.3, order: 5 });
      this._drawPeople(view, a, vis, settings.trails);
      if (settings.labels) this._drawSign(view, c, vis.length, mood);
    }
  }

  _drawPeople(view, a, people, trails) {
    const P = (s, t, z = 0) => {
      const [x, y] = a.toLayout(s, t);
      const q = view.project(x, y, view.m(z));
      return q;
    };
    for (const p of people) {
      const [s, t] = p.pos;
      const [x, y] = a.toLayout(s, t);
      if (!view.inImage(x, y, 0)) continue;
      const sp = Math.hypot(p.vel[0], p.vel[1]);
      const [dx, dy] = sp > 0.15 ? [p.vel[0] / sp, p.vel[1] / sp] : [1, 0];
      const qx = -dy, qy = dx;
      const amp = 0.3 * Math.min(1, sp) * Math.sin(p.phase);
      const h = p.height;
      const foot = P(s, t), side = P(s + 0.3, t), top = P(s, t, h);
      const hip = P(s, t, 0.5 * h), shoulder = P(s, t, 0.8 * h), head = P(s, t, 0.91 * h);
      const fl = P(s + dx * amp + qx * 0.1, t + dy * amp + qy * 0.1), fr = P(s - dx * amp - qx * 0.1, t - dy * amp - qy * 0.1);
      if (!foot || !side || !top || !hip || !shoulder || !head || !fl || !fr) continue;
      const vertical = Math.hypot(top[0] - foot[0], top[1] - foot[1]) / h;
      const ground = Math.hypot(side[0] - foot[0], side[1] - foot[1]) / 0.3;
      const ref = Math.max(vertical, 0.5 * ground); // px per prototype metre
      // shadow and trail on the ground
      view.ground(7, (ctx) => {
        ctx.globalAlpha *= 0.45;
        ctx.fillStyle = "#141414";
        const r = Math.hypot(side[0] - foot[0], side[1] - foot[1]);
        ctx.beginPath();
        ctx.ellipse(foot[0], foot[1], r, r * 0.45, 0, 0, 2 * Math.PI);
        ctx.fill();
      });
      if (trails && p.trail.length) {
        const pts = p.trail.concat([p.pos]).map((q) => a.toLayout(q[0], q[1]));
        view.line(pts, { stroke: moodColor(p.mood, 1, 0.8), width: 2, alpha: 0.6, order: 8 });
      }
      const colour = view.dim(moodColor(p.mood), 0.5), legs = view.dim(moodColor(p.mood, 1, 0.55), 0.5);
      view.solid(view.depth(x, y, 0), (ctx) => {
        const body = Math.max(2, ref * 0.42), leg = Math.max(1, ref * 0.14), headR = Math.max(1.6, ref * 0.15);
        ctx.lineCap = "round";
        const line = (u, v, w, style) => {
          ctx.beginPath();
          ctx.moveTo(u[0], u[1]);
          ctx.lineTo(v[0], v[1]);
          ctx.lineWidth = w;
          ctx.strokeStyle = style;
          ctx.stroke();
        };
        for (const f of [fl, fr]) {
          line(hip, f, leg + 2, "#191919");
          line(hip, f, leg, legs);
        }
        line(hip, shoulder, body + 2, "#191919");
        line(hip, shoulder, body, colour);
        ctx.beginPath();
        ctx.arc(head[0], head[1], headR + 1, 0, 2 * Math.PI);
        ctx.fillStyle = "#191919";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(head[0], head[1], headR, 0, 2 * Math.PI);
        ctx.fillStyle = colour;
        ctx.fill();
      });
    }
  }

  _drawSign(view, c, count, mood) {
    const a = c.area;
    const owner = a.owner;
    const at = a.toLayout(0, 0);
    const lines = [`${owner.name}: ${count} ${count === 1 ? "person" : "people"} · ${(mood * 100).toFixed(0)} %`];
    const fx = this.world.disruptions.effectsFor(a);
    const status = fx.messages.length ? fx.messages[0] : dockStatus(this.world, a);
    if (status) lines.push(status);
    const badge = owner.spec.number || (a.kind === "bus" ? "H" : null);
    // the bus badge keeps the green of the German bus stop sign ("H"), platforms get CD Türkis
    view.label([at[0], at[1], view.m(4.5)], lines, {
      size: 12, anchor: "bottom", badge: badge || undefined, badgeColor: a.kind === "bus" ? "#1f8a3b" : OVERLAY.sign,
      colors: [null, fx.messages.length ? OVERLAY.alert : OVERLAY.status], bar: mood, barColor: moodColor(mood), order: 1,
    });
  }
}

/** Short status text for the docks of an area ("Train arriving", "Next train in 25 s", ...). */
export function dockStatus(world, area) {
  const states = world.services.forArea(area.id);
  if (!states.length) return "";
  const noun = area.kind === "bus" ? "Bus" : "Train";
  const busy = states.find((st) => st.vehicle);
  if (busy) {
    const v = busy.vehicle;
    const verb = { arriving: "arriving", dwelling: "boarding", departing: "departing" }[v.phase];
    return `${v.line || noun} ${verb}${states.length > 1 && busy.dock.label ? ` (${busy.dock.label})` : ""}`;
  }
  if (states.every((st) => st.mode === "feed")) return "Waiting for the next train";
  const next = Math.min(...states.map((st) => st.timer)) / (world.speed || 1);
  return `Next ${noun.toLowerCase()} in ${Math.max(0, next).toFixed(0)} s`;
}
