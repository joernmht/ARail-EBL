/**
 * The hump's automation (Ablaufsteuerung): it measures each cut's rolling resistance on the ramp
 * (with an error), throws the switches between the cuts, and closes the retarders while a cut is
 * faster than it needs to be. The main retarder (Talbremse) lets a cut go at the speed that brings it
 * to its group retarder at `SPEEDS.group_in_mps`; the group retarder (Richtungsgleisbremse) at the
 * speed that brings it to the wagons already in its track, or to the end of an empty one, at
 * `SPEEDS.couple_mps` (Laufzielbremsung). Both speeds come from the control's own run of the cut,
 * backwards from where it should arrive, with the measured resistance; the main retarder never below
 * `SPEEDS.main_out_mps` (so that the next cut does not catch up), a group retarder never below the
 * coupling speed, and no faster than lets it meet a cut still rolling ahead of it in its track gently
 * (`safeExit`). Into a track with speed-holding units the group retarder lets a cut go at their
 * speed, or as fast as its free run needs; the units need no control: they brake by themselves
 * (physics.js).
 * @module arail/hump/control
 */
import { CONTROL, SPEEDS } from "./params.js";
import { requiredSpeeds, timeRun } from "./physics.js";

/** The control of a hump simulation (state lives in the simulation). */
export class HumpControl {
  /**
   * @param {import("./yard.js").HumpYard} yard
   * @param {{estimate_sd?: number, band_mps?: number, group_in_mps?: number, couple_mps?: number, careful_mps?: number}} [options]
   */
  constructor(yard, options = {}) {
    this.yard = yard;
    this.options = {
      ...CONTROL, group_in_mps: SPEEDS.group_in_mps, couple_mps: SPEEDS.couple_mps, careful_mps: SPEEDS.careful_mps, main_out_mps: SPEEDS.main_out_mps, ...options,
    };
  }

  /**
   * The rolling resistance the control measures for a cut (N/kN): the true one, by weight, with a
   * normal error; never below 0.3.
   * @param {{body: {w: number}}} cut
   * @param {{normal: Function}} rng
   */
  measure(cut, rng) {
    return Math.max(0.3, cut.body.w + rng.normal(0, this.options.estimate_sd));
  }

  /**
   * The speeds a cut needs through a retarder (see requiredSpeeds): to its group retarder for the
   * main retarder, to the wagons in its track for a group retarder. Into a track with speed-holding
   * units, at their speed, or faster where a free run to the target needs it (a bad runner in the
   * cold): the units take the rest. `floor`: the retarder brakes no cut below it.
   * @param {import("./simulation.js").HumpSimulation} sim
   * @param {object} cut
   * @param {import("./yard.js").Retarder} r
   * @returns {{at: (s: number) => number, floor: number}}
   */
  need(sim, cut, r) {
    const o = this.options, opts = { w: cut.w_est, wind_mps: sim.wind_mps };
    const ahead = this.yard.retardersOn(cut.plan).filter((x) => x.s0 > r.s1);
    if (r.kind === "main") {
      const g = ahead.find((x) => x.kind === "group");
      if (g) return { ...requiredSpeeds(this.yard, cut.plan, cut.body, r.s0, g.s0, o.group_in_mps, opts), floor: o.main_out_mps };
    }
    const v = cut.careful ? Math.min(o.couple_mps, o.careful_mps) : o.couple_mps;
    const target = Math.max(sim.targetPoint(cut), r.s1 + 1);
    const free = requiredSpeeds(this.yard, cut.plan, cut.body, r.s0, target, v, opts);
    const units = ahead.find((x) => x.hold_mps != null);
    if (!units) {
      const cap = this.safeExit(sim, cut, r, free.at(r.s1), v);
      return { at: (s) => Math.min(free.at(s), cap), floor: Math.min(v, cap) };
    }
    // into speed-holding units: at their speed, or as fast as a free run to the target needs (the units take the rest)
    const hold = Math.min(units.hold_mps, v);
    return { at: (s) => Math.max(hold, free.at(s)), floor: hold };
  }

  /**
   * The fastest a cut may leave a group retarder without catching up the cut ahead of it in its track
   * harder than the coupling speed, while that one still rolls: both runs predicted over time (with
   * the measured resistances), the exit speed halved down to `floor` until the follower meets the
   * leader gently or not at all. Infinity when nothing rolls ahead or `v_exit` is safe.
   * @param {import("./simulation.js").HumpSimulation} sim
   * @param {object} cut
   * @param {import("./yard.js").Retarder} r
   * @param {number} v_exit the speed its free run to the target needs
   * @param {number} floor the coupling speed
   */
  safeExit(sim, cut, r, v_exit, floor) {
    const leaf = cut.plan[cut.plan.length - 1];
    let leader = null;
    for (const b of sim.bodies) {
      if (b === cut || b.v <= 0 || b.order > cut.order || b.plan[b.plan.length - 1] !== leaf) continue;
      if (b.s > cut.s && (!leader || b.s < leader.s)) leader = b;
    }
    if (!leader) return Infinity;
    const end = this.yard.segments.get(leaf).s1, wind = sim.wind_mps;
    const lead = timeRun(this.yard, leader.plan, leader.body, leader.s, leader.v, end, { w: leader.w_est, wind_mps: wind });
    const safe = (v0) => {
      const t0 = (r.s1 - cut.s) / Math.max(0.5, (cut.v + v0) / 2);
      const run = timeRun(this.yard, cut.plan, cut.body, r.s1, v0, end, { w: cut.w_est, wind_mps: wind });
      for (let k = 0; k < run.s.length; k++) {
        const l = lead.at(t0 + k * run.dt);
        if (run.s[k] >= l.s - leader.body.length_m) return run.v[k] - l.v <= this.options.couple_mps + 1e-9;
      }
      return true;
    };
    if (!(v_exit > floor) || safe(v_exit)) return Infinity;
    let lo = floor, hi = v_exit;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      if (safe(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /**
   * One step of the retarders: a cut entering one gets its needed speeds; the retarder closes while a
   * cut in it is faster than needed (plus a band), and opens otherwise, as fast as its response time.
   * @param {import("./simulation.js").HumpSimulation} sim
   * @param {number} dt
   */
  brakes(sim, dt) {
    for (const r of this.yard.retarders) {
      if (r.hold_mps != null) continue; // speed-holding units work by themselves (physics.js)
      const st = sim.retarderState(r.id);
      let close = false;
      const inside = [];
      for (const c of sim.bodies) {
        if (!c.route.includes(r.seg)) continue;
        const first = c.s - c.firstAxle, last = c.s - c.lastAxle;
        if (first < r.s0 || last >= r.s1) {
          if (st.cuts.has(c.id) && last >= r.s1) sim.leftRetarder(c, r);
          continue;
        }
        inside.push(c);
        if (!st.cuts.has(c.id)) {
          st.cuts.add(c.id);
          c.need.set(r.id, this.need(sim, c, r));
          sim.enteredRetarder(c, r);
        }
        c.inRetarder = r.id;
        const need = c.need.get(r.id);
        // never below the floor: a cut braked to a stop would stay in the retarder
        if (c.v > Math.max(need.at(c.s), need.floor) + (st.level > 0 ? 0 : this.options.band_mps)) close = true;
      }
      st.command = close ? 1 : 0;
      const rate = dt / Math.max(1e-6, r.response_s);
      st.level = st.command > st.level ? Math.min(1, st.level + rate) : Math.max(0, st.level - rate);
      if (!inside.length) st.cuts.clear();
    }
  }

  /**
   * One step of the switches: each one free (no cut in its detection section) is thrown for the next
   * cut that needs it, if the throw is done before that cut reaches the section.
   * @param {import("./simulation.js").HumpSimulation} sim
   */
  switches(sim) {
    const sw = this.yard.switches;
    for (const id of this.yard.switchIds) {
      const st = sim.switchState(id), seg = this.yard.segments.get(id), p = seg.s1;
      if (st.moving && sim.t >= st.until) {
        st.moving = false;
        st.pos = st.target;
      }
      if (st.moving) continue;
      let occupied = false, next = null;
      for (const c of sim.movers) {
        if (c.route.includes(id) && c.s > p - sw.guard_m && c.s - c.body.length_m < p + sw.clear_m) occupied = true;
        if (c.s < p && c.plan.includes(id) && c.plan.includes(c.route[c.route.length - 1]) && (!next || c.s > next.s)) next = c;
      }
      if (occupied || !next) continue;
      const want = seg.children.indexOf(next.plan[next.plan.indexOf(id) + 1]);
      if (want < 0 || want === st.pos) continue;
      const d = p - sw.guard_m - next.s;
      const a = Math.max(0, next.a || 0), v = Math.max(0, next.v);
      const tArr = d <= 0 ? 0 : a > 1e-9 ? (-v + Math.sqrt(v * v + 2 * a * d)) / a : v > 1e-9 ? d / v : Infinity;
      if (tArr > sw.throw_s + sw.margin_s) {
        Object.assign(st, { moving: true, until: sim.t + sw.throw_s, target: want, throws: st.throws + 1 });
        sim.note("switch.thrown", { switch: id, to: seg.children[want], for: next.id });
      } else if (!st.late.has(next.id)) {
        st.late.add(next.id);
        sim.note("switch.late", { switch: id, for: next.id });
      }
    }
  }
}
