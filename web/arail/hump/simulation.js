/**
 * Humping trains over a yard: the hump locomotive pushes a train over the crest, its cuts run free
 * one by one when gravity pulls them faster than the train, roll down through the retarders and the
 * switch zone into their classification tracks and meet the wagons standing there. The control
 * (control.js) throws the switches and works the retarders; everything else is physics
 * (physics.js): cuts that touch push each other, a faster one catches up the one ahead, a cut that
 * meets another does so with a plastic impact, a cut stops where its energy runs out.
 *
 * Deterministic: the same yard, options, trains and seed give the same run. No DOM; the hump does not
 * belong to a world (yet): it runs on its own (see docs/hump-yard.md).
 * @module arail/hump/simulation
 */
import { createRng } from "../core/math.js";
import { HumpControl } from "./control.js";
import { cutsOf, makeWagon, wagonType } from "./cuts.js";
import { G, SEASONS, SPEEDS, START_EXTRA } from "./params.js";
import { cutBody, cutForces, energyHeight } from "./physics.js";

/**
 * Settings of a run: time step (s), seed, season, head wind (m/s; null: the season's), time between
 * two trains (s), how far before the crest a train's front starts (m), how far beyond the crest the
 * locomotive pushes a cut that does not run free (m), the space between two cuts that counts as a
 * gap (m), the impact limits (m/s), trace (s, v and energy height of every cut every `trace_s`), the
 * longest run (s), and `pull_below_m`: a track with less room than this at its entrance is pushed up
 * and, if still too full, pulled out as a train (null: only by hand, `pushUp` and `pullOut`).
 */
export const SIM_DEFAULTS = Object.freeze({
  dt: 0.05, seed: 1, season: "summer", wind_mps: null, train_gap_s: 120, start_m: 15, push_over_m: 25, gap_m: 1,
  impact_mps: SPEEDS.impact_mps, careful_mps: SPEEDS.careful_mps, trace: false, trace_s: 0.5, max_s: 4 * 3600, control: {},
  pull_below_m: null,
});

/** Closer than this (m), two cuts touch. */
const TOUCH_M = 1e-3;

/** A hump yard at work. */
export class HumpSimulation {
  /**
   * @param {import("./yard.js").HumpYard} yard
   * @param {Partial<typeof SIM_DEFAULTS>} [options]
   */
  constructor(yard, options = {}) {
    this.yard = yard;
    this.options = { ...SIM_DEFAULTS, ...options };
    const season = SEASONS[this.options.season] || SEASONS.summer;
    /** Head wind against the cuts (m/s). */
    this.wind_mps = this.options.wind_mps ?? season.wind_mps;
    this.rng = createRng(this.options.seed);
    // the control aims careful cuts at the limit the results judge them by, unless told otherwise
    this.control = new HumpControl(yard, { careful_mps: this.options.careful_mps, ...this.options.control });
    /** Time (s). */
    this.t = 0;
    /** Every cut, in the order of the trains and in each train from its hump end. */
    this.cuts = [];
    /** The cuts running free or standing (not pushed, not departed). */
    this.bodies = [];
    /** Trains waiting to be humped. */
    this.queue = [];
    /** The train being pushed: its record, the cuts still on it, its speed, whether a held cut blocks it. */
    this.pushing = null;
    /** The trains, as records. */
    this.trains = [];
    /** What happened: `{t, type, …}`. */
    this.log = [];
    /** Trains formed and pulled out of the classification tracks. */
    this.departures = [];
    this._nextStart = 0;
    this._order = 0;
    this._movers = [];
    this._switches = new Map();
    this._retarders = new Map();
    this._nextTrace = 0;
    /** The cuts of each train waiting, by its record. */
    this._waiting = new Map();
    /** Log entries forgotten (`forget`): an entry's place since the start is `logStart` + its index. */
    this.logStart = 0;
    /** The figures of what was forgotten, added to those of `results()`. */
    this._past = { ...NO_FIGURES, trains: 0, push_s: 0, overspeed: 0, departures: 0 };
    this._trainCount = 0;
  }

  /** The cuts being pushed or free (for the control). */
  get movers() {
    return this._movers;
  }

  /** Nothing waiting, nothing pushed, nothing moving. */
  get idle() {
    return !this.pushing && !this.queue.length && this.bodies.every((b) => b.v === 0);
  }

  /** A note in the log. */
  note(type, data = {}) {
    this.log.push({ t: Math.round(this.t * 100) / 100, type, ...data });
  }

  /** The state of a switch: its position (index of the child), whether it is moving. */
  switchState(id) {
    if (!this._switches.has(id)) this._switches.set(id, { pos: 0, moving: false, until: 0, target: 0, throws: 0, late: new Set() });
    return this._switches.get(id);
  }

  /** The state of a retarder: how far it is closed (0…1), the command, the cuts in it. */
  retarderState(id) {
    if (!this._retarders.has(id)) this._retarders.set(id, { level: 0, command: 0, cuts: new Set() });
    return this._retarders.get(id);
  }

  /**
   * Queue a train to be humped. A wagon of an unknown type or for a track the yard does not have
   * throws before anything changes.
   * @param {{id?: string, wagons: object[], sorting?: Record<string, string>, push_mps?: number, push_kmh?: number}} train
   *   wagons: specs from the end that goes over the hump first (see makeWagon); sorting: destination → track
   * @returns {object} the train's record
   */
  hump(train) {
    const id = String(train.id ?? `T${this._trainCount + 1}`);
    // the whole train checked first (types, tracks), so that a wrong one changes nothing: no cut, no random number
    // each wagon's track by its name, also where it was given by its segment's id ("t3" → "3")
    const specs = (train.wagons || []).map((w) => {
      wagonType(w.type);
      const track = w.track ?? (w.destination != null ? train.sorting?.[w.destination] : null);
      if (track == null) throw new Error(`wagon ${w.id ?? w.type} of train ${id}: no classification track for ${w.destination ?? "it"}`);
      return { ...w, track: this.yard.trackSegment(track).track.name };
    });
    const wagons = specs.map((w, i) => makeWagon({ ...w, id: w.id ?? `${id}.${i + 1}` }, this.rng, this.options.season));
    const push = train.push_mps ?? (train.push_kmh != null ? train.push_kmh / 3.6 : SPEEDS.push_mps);
    const rec = { id, wagons: wagons.length, cuts: [], push_mps: push, queued_t: this.t, started_t: null, humped_t: null, skipped: [] };
    const cuts = [];
    for (const g of cutsOf(wagons, train.sorting)) {
      if (g.noHump) {
        rec.skipped.push(...g.wagons.map((w) => w.id));
        this.note("cut.not-humped", { train: id, wagons: g.wagons.map((w) => w.id) });
        continue;
      }
      const cut = this._cut(`${id}/${rec.cuts.length + 1}`, id, g.wagons, g.track);
      cut.w_est = this.control.measure(cut, this.rng);
      rec.cuts.push(cut.id);
      this.cuts.push(cut);
      cuts.push(cut);
    }
    this._waiting.set(rec, cuts);
    this.trains.push(rec);
    this._trainCount++;
    this.queue.push(rec);
    return rec;
  }

  /** A cut of a train: its wagons as one body, for a track, not yet on the hump. */
  _cut(id, train, wagons, track) {
    const body = cutBody(wagons), last = body.parts[body.parts.length - 1];
    return {
      id, train, wagons, body, track, intended: track, plan: this.yard.routeTo(track), route: [this.yard.root],
      s: -Infinity, v: 0, a: 0, state: "queued", order: null, careful: wagons.some((w) => w.careful), misrouted: null, held: false,
      derailed: false, pushedOver: false, firstAxle: body.parts[0].axles[0], lastAxle: last.axles[last.axles.length - 1],
      need: new Map(), inRetarder: null, w_est: 0, f: null, F: 0,
      rec: { released_t: null, released_s: null, max_mps: 0, retarders: {}, impacts: [], hitBy: [], end: null, stop: null, judged: false }, trace: [],
    };
  }

  /** Advance by one time step. */
  step() {
    const dt = this.options.dt;
    this._startTrain();
    this._push(dt);
    this._movers = this.pushing ? [...this.pushing.cuts, ...this.bodies] : this.bodies;
    this._move(dt);
    this.control.switches(this);
    this.control.brakes(this, dt);
    this.t += dt;
    if (this.options.trace && this.t >= this._nextTrace) {
      this._nextTrace = this.t + this.options.trace_s;
      for (const c of this.bodies) if (c.v > 0) c.trace.push([this.t, c.s, c.v, energyHeight(this.yard, c.route, c.body, c.s, c.v)]);
    }
    if (this.options.pull_below_m != null && this.t >= (this._nextPull || 0)) {
      this._nextPull = this.t + 1;
      this._pullFull();
    }
  }

  /**
   * Every track with less than `pull_below_m` of room left at its entrance (also one whose last cut
   * sticks out of it): its wagons are first pushed up to its end (`pushUp`), closing the gaps; if
   * that leaves too little room, the track is pulled out as a train once no cut rolls in it: the
   * standing wagons leave from its far end, while cuts on their way roll on into the emptied track.
   * A track without wagons is never pulled out.
   */
  _pullFull() {
    const min = this.options.pull_below_m;
    for (const t of this.yard.tracks) {
      let c = this.trackContents(t.name);
      if (!c.cuts.length || c.free_m >= min) continue;
      // too little room at the entrance: first push the wagons up to the end (never past a cut still rolling)
      if (c.gaps.length || c.end_m > this.options.gap_m) {
        this.pushUp(t.name);
        c = this.trackContents(t.name);
      }
      // then pull them out if still full, once no cut rolls in the track any more
      const leaf = this.yard.trackSegment(t.name);
      const quiet = !this.bodies.some((b) => b.v > 0 && b.route[b.route.length - 1] === leaf.id && b.s >= leaf.track.s0);
      if (c.free_m < min && quiet) this.pullOut(t.name);
    }
  }

  /**
   * Push the cuts standing in a classification track up to its end, buffer to buffer (Beidrücken):
   * the gaps between them and the room before the end are closed, but no cut is pushed past one
   * still rolling in the track. Instant, like pulling out.
   * @param {string} name
   * @returns {number} the room gained at the entrance (m): how far the last cut was moved
   */
  pushUp(name) {
    const leaf = this.yard.trackSegment(name), tr = leaf.track;
    const here = this.bodies.filter((b) => b.route[b.route.length - 1] === leaf.id && b.s >= tr.s0 - 1e-6).sort((a, b) => b.s - a.s);
    let edge = leaf.s1, gained = 0;
    for (const b of here) {
      if (b.v > 0) {
        edge = Math.min(edge, b.s - b.body.length_m); // a cut still rolling: the ones behind it stay behind it
        gained = 0;
        continue;
      }
      gained = Math.max(0, edge - b.s); // the last one moved is the one at the entrance
      if (edge > b.s) b.s = edge;
      if (b.s >= leaf.s1 - 1e-9) b.held = true; // at the end, its stop holds it
      edge = b.s - b.body.length_m;
    }
    this.pushedUp_m = (this.pushedUp_m || 0) + gained;
    this.note("track.pushed-up", { track: tr.name, m: round(gained) });
    return gained;
  }

  /**
   * Run until the trains are humped and every cut stands (or `until_s`).
   * @param {{until_s?: number, max_s?: number}} [options]
   * @returns {ReturnType<HumpSimulation["results"]>}
   */
  run(options = {}) {
    const until = options.until_s ?? Infinity, stop = this.t + (options.max_s ?? this.options.max_s);
    while (this.t < until && this.t < stop && !this.idle) this.step();
    if (this.t >= stop && !this.idle && !this.limitReached) {
      /** The run stopped at its longest time with trains or cuts still to go. */
      this.limitReached = true;
      this.note("run.limit", { waiting: this.queue.length + (this.pushing ? 1 : 0) });
    }
    return this.results();
  }

  /** The next train starts when the one before is humped and the time between trains has passed. */
  _startTrain() {
    if (this.pushing || !this.queue.length || this.t < this._nextStart) return;
    const rec = this.queue.shift();
    const cuts = this._waiting.get(rec) || [];
    this._waiting.delete(rec);
    rec.started_t = this.t;
    let front = this.yard.crest_m - this.options.start_m;
    for (const c of cuts) {
      Object.assign(c, { s: front, v: rec.push_mps, state: "pushed", route: [this.yard.root] });
      front -= c.body.length_m;
    }
    this.pushing = { rec, cuts, v: rec.push_mps, blocked: false };
    this.note("train.started", { train: rec.id, cuts: cuts.length });
    if (!cuts.length) this._humped();
  }

  /**
   * The train moves on at its pushing speed; its first cut runs free once gravity pulls it faster. A
   * cut held ahead of it (the yard backed up to the crest, its cuts held at the end of a track or
   * derailed) cannot be pushed on: the train stops behind it (`blocked`, noted once) and releases nothing.
   */
  _push(dt) {
    const P = this.pushing;
    if (!P) return;
    const head = P.cuts[0], held = this._leader(head);
    const room = held?.held ? Math.max(0, held.s - held.body.length_m - head.s) : Infinity;
    const ds = Math.min(P.v * dt, room), blocked = P.v > 0 && ds < P.v * dt - 1e-9;
    if (blocked && !P.blocked) this.note("train.blocked", { train: P.rec.id, by: held.id });
    P.blocked = blocked;
    for (const c of P.cuts) {
      c.s += ds;
      c.v = blocked ? 0 : P.v;
      c.a = 0;
    }
    if (blocked) return;
    const first = P.cuts[0];
    // a cut standing just beyond the crest is pushed on by the train
    const ahead = this._leader(first);
    if (ahead && !ahead.held && ahead.s - ahead.body.length_m < first.s) {
      ahead.s = first.s + ahead.body.length_m;
      ahead.v = Math.max(ahead.v, P.v);
      ahead.state = "running";
    }
    const f = cutForces(this.yard, first.route, first.body, first.s, P.v, this._forceOptions());
    const a = (f.drive - f.resist - f.retard) / f.eff_t;
    const over = first.s - first.body.length_m >= this.yard.crest_m + this.options.push_over_m;
    if (a > 0 || over) {
      P.cuts.shift();
      Object.assign(first, { state: "running", order: this._order++, a, pushedOver: over && !(a > 0) });
      first.rec.released_t = this.t;
      first.rec.released_s = first.s;
      this.bodies.push(first);
      this.note(first.pushedOver ? "cut.pushed-over" : "cut.released", { cut: first.id, s: round(first.s), track: first.track });
      if (!P.cuts.length) this._humped();
    }
  }

  _humped() {
    const rec = this.pushing.rec;
    rec.humped_t = this.t;
    this.pushing = null;
    this._nextStart = this.t + this.options.train_gap_s;
    this.note("train.humped", { train: rec.id });
  }

  _forceOptions() {
    return this._fo ||= { wind_mps: this.wind_mps, level: (r) => this.retarderState(r.id).level };
  }

  /** The cut ahead of c on its way (the nearest whose rear is on c's route), or null. */
  _leader(c) {
    let best = null, bestRear = Infinity;
    for (const b of this.bodies) {
      if (b === c || b.s <= c.s) continue;
      const rear = b.s - b.body.length_m;
      if (rear >= bestRear) continue;
      if (c.route.includes(this.yard.segmentOn(b.route, rear).id)) [best, bestRear] = [b, rear];
    }
    return best;
  }

  /** Is the cut's front in the classification track at the end of its route? */
  _inTrack(c) {
    const seg = this.yard.segments.get(c.route[c.route.length - 1]);
    return !!seg.track && c.s >= seg.track.s0;
  }

  /** Forces, contacts, motion, switches passed, impacts and stops of the free cuts. */
  _move(dt) {
    const yard = this.yard, fo = this._forceOptions(), bodies = this.bodies;
    for (const c of bodies) {
      if (c.held) {
        c.F = 0;
        c.a = 0;
        c.f = { drive: 0, resist: 0, retard: 0, eff_t: c.body.eff_t };
        continue;
      }
      const f = cutForces(yard, c.route, c.body, c.s, c.v, fo);
      c.f = f;
      if (c.v > 0) c.F = f.drive - f.resist - f.retard;
      else {
        const hold = f.resist + f.retard + (c.body.mass_t * G * START_EXTRA) / 1000;
        c.F = f.drive > hold ? f.drive - f.resist - f.retard : Math.min(0, f.drive - hold);
      }
      c.a = c.F / f.eff_t;
    }
    // cuts that touch move together while the one behind would be faster (pool the accelerations)
    const follower = new Map();
    for (const c of bodies) {
      const L = this._leader(c);
      if (L && c.s >= L.s - L.body.length_m - TOUCH_M) follower.set(L, c);
    }
    const followed = new Set(follower.values());
    for (const head of bodies) {
      if (followed.has(head) || !follower.has(head)) continue;
      const stack = [];
      for (let c = head; c; c = follower.get(c)) {
        let g = { cuts: [c], F: c.F, m: c.f.eff_t, held: c.held };
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (g.F / g.m <= (top.held ? 0 : top.F / top.m) + 1e-12) break;
          stack.pop();
          g = { cuts: [...top.cuts, ...g.cuts], F: top.F + g.F, m: top.m + g.m, held: top.held || g.held };
        }
        stack.push(g);
      }
      for (const g of stack) for (const c of g.cuts) c.a = g.held ? 0 : g.F / g.m;
    }
    for (const c of bodies) {
      if (c.held) continue;
      const v0 = c.v, v1 = v0 + c.a * dt;
      let ds;
      if (v1 <= 0) {
        ds = c.a < 0 ? (v0 * v0) / (-2 * c.a) : 0;
        c.v = 0;
      } else {
        ds = ((v0 + v1) / 2) * dt;
        c.v = v1;
      }
      c.s += Math.max(0, ds);
      if (c.f.retard > 0 && c.inRetarder) {
        const r = c.rec.retarders[c.inRetarder];
        if (r) r.taken_m += (c.f.retard * ds) / (c.body.mass_t * G);
      }
      if (c.v > c.rec.max_mps) c.rec.max_mps = c.v;
      this._pass(c);
    }
    // impacts: from the front, so that a cut meets the one ahead where it now is
    for (const c of [...bodies].sort((a, b) => b.s - a.s)) {
      if (c.held || c.derailed) continue;
      const L = this._leader(c);
      if (!L) continue;
      const rear = L.s - L.body.length_m;
      if (c.s < rear) continue;
      c.s = rear;
      const dv = c.v - L.v;
      if (dv <= 1e-6) continue;
      const chain = [L];
      for (let x = L, n = this._leader(x); n && Math.abs(n.s - n.body.length_m - x.s) <= TOUCH_M; x = n, n = this._leader(n)) chain.push(n);
      const held = chain.some((x) => x.held);
      const M = chain.reduce((m, x) => m + x.body.eff_t, 0), m = c.body.eff_t;
      const v = held ? 0 : (m * c.v + M * L.v) / (m + M);
      const inTrack = this._inTrack(c) && L.route[L.route.length - 1] === c.route[c.route.length - 1];
      const hit = { t: round(this.t), s: round(c.s), with: L.id, v_mps: dv, inTrack, before_mps: [c.v, L.v], after_mps: v, masses_t: [m, M] };
      if (inTrack) this._judge(c, dv);
      c.rec.impacts.push(hit);
      L.rec.hitBy.push({ t: hit.t, by: c.id, v_mps: dv });
      this.note(inTrack ? "cut.impact" : "cut.caught-up", { cut: c.id, with: L.id, v_mps: round(dv) });
      c.v = v;
      for (const x of chain) if (!x.held) x.v = v;
      if (held) {
        c.held = true;
        c.v = 0;
      }
    }
    for (const c of bodies) {
      if (c.v === 0 && c.state === "running") {
        c.state = "stopped";
        const seg = yard.segments.get(c.route[c.route.length - 1]);
        const inTrack = this._inTrack(c) && c.s - c.body.length_m >= seg.track.s0 - 1e-6;
        c.rec.stop = { t: round(this.t), s: round(c.s), track: inTrack ? seg.track.name : null };
        this.note("cut.stopped", { cut: c.id, s: round(c.s), track: c.rec.stop.track });
      } else if (c.v > 0 && c.state === "stopped") c.state = "running";
    }
  }

  /** The front passed the end of its route's last segment: a switch (its child is taken), or the end of a track. */
  _pass(c) {
    const yard = this.yard;
    for (let seg = yard.segments.get(c.route[c.route.length - 1]); c.s > seg.s1;) {
      if (!seg.children.length) {
        c.rec.end = { t: round(this.t), s: seg.s1, v_mps: c.v };
        this.note("cut.end", { cut: c.id, track: seg.track.name, v_mps: round(c.v) });
        this._judge(c, c.v);
        Object.assign(c, { s: seg.s1, v: 0, held: true });
        return;
      }
      const st = this.switchState(seg.id);
      if (st.moving) {
        Object.assign(c, { s: seg.s1, v: 0, derailed: true, held: true });
        this.note("cut.derailed", { cut: c.id, switch: seg.id });
        return;
      }
      const next = seg.children[st.pos];
      c.route.push(next);
      const planned = c.plan[c.plan.indexOf(seg.id) + 1];
      if (next !== planned) this._misroute(c, seg.id, next);
      seg = yard.segments.get(next);
    }
  }

  /** A cut that took the wrong branch goes to the first track behind it. */
  _misroute(c, switchId, next) {
    let id = next;
    while (this.yard.segments.get(id).children.length) id = this.yard.segments.get(id).children[0];
    const name = this.yard.segments.get(id).track.name;
    c.misrouted = { switch: switchId, intended: c.track };
    this.note("cut.misrouted", { cut: c.id, switch: switchId, intended: c.track, now: name });
    c.track = name;
    c.plan = this.yard.pathTo(id);
  }

  /**
   * Where a cut's front should meet the wagons in its track: at the rear of the last one standing
   * there, less the length of the cuts on their way there before it; the end of an empty track.
   * @param {object} c
   */
  targetPoint(c) {
    const leaf = this.yard.trackSegment(c.track);
    let edge = leaf.s1, ahead = 0;
    for (const b of this.bodies) {
      if (b === c || b.track !== c.track) continue;
      const inLeaf = b.route[b.route.length - 1] === leaf.id;
      if (b.state === "stopped" && inLeaf) edge = Math.min(edge, b.s - b.body.length_m);
      else if (b.state === "running" && b.order < c.order) ahead += b.body.length_m;
    }
    return edge - ahead;
  }

  /** The control saw a cut enter a retarder. */
  enteredRetarder(c, r) {
    const need = c.need.get(r.id);
    c.rec.retarders[r.id] = { kind: r.kind, in_t: round(this.t), in_mps: c.v, need_mps: Math.max(need.at(r.s1), need.floor), out_t: null, out_mps: null, taken_m: 0 };
    if (c.v > r.vmax_in_mps) this.note("retarder.overspeed", { cut: c.id, retarder: r.id, v_mps: round(c.v) });
  }

  /** The control saw a cut leave a retarder. */
  leftRetarder(c, r) {
    const rec = c.rec.retarders[r.id];
    if (rec && rec.out_t == null) Object.assign(rec, { out_t: round(this.t), out_mps: c.v });
    this.retarderState(r.id).cuts.delete(c.id);
    if (c.inRetarder === r.id) c.inRetarder = null;
  }

  /**
   * The cuts standing in a classification track, from its end: those whose front is in it, also one
   * that stopped across its entrance (coupled to the last wagons, its rear still outside: it leaves
   * with them). Not a cut that stopped wholly in front of the track.
   * @param {import("./yard.js").Segment} leaf
   */
  _standing(leaf) {
    const tr = leaf.track;
    return this.bodies.filter((b) => b.route[b.route.length - 1] === leaf.id && b.v === 0 && b.s >= tr.s0 - 1e-6).sort((a, b) => b.s - a.s);
  }

  /**
   * The cuts standing in a classification track, from its end (`_standing`: also one across its
   * entrance): wagons, gaps between them, room left at its entrance (`free_m`), the length of its
   * wagons (`occupied_m`; more than the track's length when one sticks out of it).
   * @param {string} name
   */
  trackContents(name) {
    const leaf = this.yard.trackSegment(name), tr = leaf.track;
    const here = this._standing(leaf);
    const gaps = [];
    let edge = tr.s1;
    for (const b of here) {
      const gap = edge - b.s;
      if (edge < tr.s1 && gap > this.options.gap_m) gaps.push({ after: gaps.length, m: gap, before: b.id });
      edge = b.s - b.body.length_m;
    }
    return {
      name: tr.name, cuts: here.map((b) => b.id), wagons: here.reduce((n, b) => n + b.wagons.length, 0),
      end_m: here.length ? tr.s1 - here[0].s : null, gaps, gaps_m: gaps.reduce((m, g) => m + g.m, 0), free_m: Math.max(0, edge - tr.s0), length_m: tr.length_m,
      occupied_m: here.reduce((m, b) => m + b.body.length_m, 0),
    };
  }

  /**
   * Pull a formed train out of a classification track: the cuts standing in it (those of
   * `trackContents`, also one across its entrance), its wagons from the track's end, the gaps that
   * had to be closed (Beidrücken). The cuts leave the simulation; a cut stopped wholly in front of
   * the track stays.
   * @param {string} name
   * @returns {{track: string, t: number, cuts: string[], wagons: object[], length_m: number, gaps_m: number}}
   */
  pullOut(name) {
    const leaf = this.yard.trackSegment(name);
    const contents = this.trackContents(name);
    const here = this._standing(leaf);
    for (const b of here) b.state = "departed";
    this.bodies = this.bodies.filter((b) => b.state !== "departed");
    const out = {
      track: leaf.track.name, t: round(this.t), cuts: here.map((b) => b.id), wagons: here.flatMap((b) => b.wagons),
      length_m: here.reduce((m, b) => m + b.body.length_m, 0), gaps_m: contents.gaps_m,
    };
    this.departures.push(out);
    this.note("track.pulled", { track: out.track, wagons: out.wagons.length });
    return out;
  }

  /**
   * Where a cut set into a classification track by locomotive comes to stand: behind the wagons
   * standing there (at the track's end if it is empty); null when it does not fit, or while a cut
   * still rolls in the track.
   * @param {object} leaf the track's segment
   * @param {number} length_m the cut's length
   * @param {object} [but] a cut not counted (the one that is moved)
   */
  _place(leaf, length_m, but = null) {
    if (this.bodies.some((b) => b !== but && b.v > 0 && b.route[b.route.length - 1] === leaf.id)) return null;
    const here = this._standing(leaf).filter((b) => b !== but);
    const edge = here.length ? Math.min(...here.map((b) => b.s - b.body.length_m)) : leaf.s1;
    return edge - length_m < leaf.track.s0 - 1e-6 ? null : edge;
  }

  /**
   * The shunting locomotive takes a standing cut to a classification track (a cut that went into
   * the wrong one, or stopped before its own): it is put behind the wagons standing there, buffer
   * to buffer, and that track is its own from then on. Instant, like pushing up and pulling out; the
   * cut is not judged again.
   * @param {string} id the cut
   * @param {string} name the track
   * @returns {boolean} whether it was moved: not a cut that rolls, is pushed or has left, not into a
   *   track without room for it or with a cut still rolling in it
   */
  moveCut(id, name) {
    const c = this.bodies.find((b) => b.id === id), leaf = this.yard.trackSegment(name);
    if (!c || c.v > 0) return false;
    const s = this._place(leaf, c.body.length_m, c);
    if (s == null) return false;
    const from = c.rec.stop?.track ?? null;
    Object.assign(c, { route: this.yard.pathTo(leaf.id), plan: this.yard.pathTo(leaf.id), track: leaf.track.name, s, v: 0, a: 0, state: "stopped", held: s >= leaf.s1 - 1e-9, derailed: false });
    c.rec.stop = { t: round(this.t), s: round(s), track: leaf.track.name };
    this.note("cut.moved", { cut: c.id, from, track: leaf.track.name });
    return true;
  }

  /**
   * The shunting locomotive sets wagons into a classification track without humping them (wagons
   * that must not be humped, RID label 15): one cut, behind the wagons standing there. Instant.
   * @param {{id?: string, train?: string, wagons: object[]}} cut wagon specs (see makeWagon; `noHump` is not asked again)
   * @param {string} name the track
   * @returns {object | null} the cut, or null when the track has no room for it or a cut still rolls in it (nothing
   *   changes then: no cut, no random number drawn)
   */
  setOut({ id, train = "", wagons }, name) {
    const leaf = this.yard.trackSegment(name);
    // room first, from the types' lengths: a call that fails makes no wagon and draws no random number
    const s = this._place(leaf, wagons.reduce((m, w) => m + wagonType(w.type).length_m, 0));
    if (s == null) return null;
    const made = wagons.map((w, i) => makeWagon({ ...w, track: leaf.track.name, id: w.id ?? `${id ?? train}.${i + 1}` }, this.rng, this.options.season));
    const c = this._cut(String(id ?? `${train}/set${this.cuts.length + 1}`), String(train), made, leaf.track.name);
    // (without an order: it did not go over the hump, and the figures of the humping do not count it)
    Object.assign(c, { route: this.yard.pathTo(leaf.id), s, state: "stopped", held: s >= leaf.s1 - 1e-9 });
    c.rec.stop = { t: round(this.t), s: round(s), track: leaf.track.name };
    c.rec.judged = true;
    this.cuts.push(c);
    this.bodies.push(c);
    this.note("cut.set-out", { cut: c.id, track: leaf.track.name, wagons: made.map((w) => w.id) });
    return c;
  }

  /**
   * What became of every cut, the tracks, and the figures of the run: `trains` humped to their last
   * cut, `waiting` not (yet), `limit_reached` if `run` stopped at its longest time with work left,
   * `pulled_out` the trains formed. The figures count the whole run, also what `forget` dropped;
   * `perCut` lists the cuts kept.
   */
  results() {
    const p = this._past, perCut = this.cuts.filter((c) => c.order != null).map((c) => this._cutResult(c)), f = this._figures(perCut);
    const tracks = this.yard.tracks.map((t) => this.trackContents(t.name));
    // the time of pushing: the trains humped, and the one on the hump so far (its released cuts are counted)
    const pushing = p.push_s + this.trains.filter((r) => r.started_t != null).reduce((s, r) => s + ((r.humped_t ?? this.t) - r.started_t), 0);
    const done = this.trains.filter((r) => r.humped_t != null).length, cuts = p.cuts + f.cuts;
    return {
      t_s: round(this.t), trains: p.trains + done, waiting: this.trains.length - done, limit_reached: !!this.limitReached,
      cuts, wagons: p.wagons + f.wagons,
      push_s: round(pushing), cuts_per_hour: pushing > 0 ? (cuts / pushing) * 3600 : 0,
      misrouted: p.misrouted + f.misrouted, caughtUp: p.caughtUp + f.caughtUp, derailed: p.derailed + f.derailed, short: p.short + f.short,
      hard: p.hard + f.hard, max_impact_mps: Math.max(p.max_impact_mps, f.max_impact_mps),
      gaps: tracks.reduce((n, t) => n + t.gaps.length, 0), gaps_m: tracks.reduce((m, t) => m + t.gaps_m, 0), pushed_up_m: round(this.pushedUp_m || 0),
      overspeed: p.overspeed + this.log.filter((e) => e.type === "retarder.overspeed").length,
      pulled_out: p.departures + this.departures.length,
      perCut, tracks,
    };
  }

  /**
   * Forget what is done, for a run without end (the hump yard on the table): departed cuts but the
   * newest `cuts`, humped trains but the newest `trains`, departures but the newest `departures`, log
   * entries but the newest `log`. What they counted stays in the figures of `results()`; nothing the
   * run still needs goes (cuts not departed, trains not humped).
   * @param {{cuts?: number, trains?: number, departures?: number, log?: number}} [keep]
   */
  forget({ cuts = 0, trains = 0, departures = 0, log = 0 } = {}) {
    const p = this._past;
    const gone = this.cuts.filter((c) => c.state === "departed"), dropCuts = new Set(gone.slice(0, Math.max(0, gone.length - cuts)));
    if (dropCuts.size) {
      const f = this._figures([...dropCuts].filter((c) => c.order != null).map((c) => this._cutResult(c)));
      for (const k of Object.keys(NO_FIGURES)) p[k] = k === "max_impact_mps" ? Math.max(p[k], f[k]) : p[k] + f[k];
      this.cuts = this.cuts.filter((c) => !dropCuts.has(c));
    }
    const done = this.trains.filter((r) => r.humped_t != null), dropTrains = new Set(done.slice(0, Math.max(0, done.length - trains)));
    for (const r of dropTrains) {
      p.trains++;
      p.push_s += r.humped_t - r.started_t;
    }
    if (dropTrains.size) this.trains = this.trains.filter((r) => !dropTrains.has(r));
    const nd = Math.max(0, this.departures.length - departures);
    p.departures += nd;
    this.departures.splice(0, nd);
    const nl = Math.max(0, this.log.length - log);
    for (let i = 0; i < nl; i++) if (this.log[i].type === "retarder.overspeed") p.overspeed++;
    this.log.splice(0, nl);
    this.logStart += nl;
  }

  /**
   * A cut is judged by one impact: its first in its track, else at the track's end (then it is held, so
   * nothing follows). The first call for a cut is that one; too hard, it is noted (`cut.hard`), once.
   */
  _judge(c, v_mps) {
    if (c.rec.judged) return;
    c.rec.judged = true;
    if (this.tooHard(c.careful, v_mps)) this.note("cut.hard", { cut: c.id, v_mps: round(v_mps) });
  }

  /** Faster than a cut may meet the wagons in its track (its careful limit, if it has careful wagons). */
  tooHard(careful, v_mps) {
    return v_mps > (careful ? this.options.careful_mps : this.options.impact_mps) + 1e-9;
  }

  /** One cut's run, as `results().perCut` lists it. */
  _cutResult(c) {
    const ret = Object.values(c.rec.retarders);
    const main = ret.find((r) => r.kind === "main") || null, group = ret.find((r) => r.kind === "group") || null;
    const inTrack = c.rec.impacts.find((i) => i.inTrack);
    return {
      id: c.id, train: c.train, wagons: c.wagons.length, types: c.wagons.map((w) => w.type), mass_t: c.body.mass_t, length_m: c.body.length_m,
      w: c.body.w, w_est: c.w_est, track: c.intended, ended: c.rec.stop?.track ?? null, misrouted: !!c.misrouted, careful: c.careful,
      released_t: c.rec.released_t, pushedOver: c.pushedOver, max_mps: c.rec.max_mps, main, group,
      impact_mps: inTrack ? inTrack.v_mps : c.rec.end ? c.rec.end.v_mps : null, caughtUp: c.rec.impacts.some((i) => !i.inTrack),
      stop: c.rec.stop, derailed: c.derailed,
    };
  }

  /** The figures of cuts' runs (`_cutResult`): counts and the hardest impact. */
  _figures(perCut) {
    const impacts = perCut.filter((c) => c.impact_mps != null);
    return {
      cuts: perCut.length, wagons: perCut.reduce((n, c) => n + c.wagons, 0),
      misrouted: perCut.filter((c) => c.misrouted).length, caughtUp: perCut.filter((c) => c.caughtUp).length,
      derailed: perCut.filter((c) => c.derailed).length, short: perCut.filter((c) => c.stop && !c.ended).length,
      hard: impacts.filter((c) => this.tooHard(c.careful, c.impact_mps)).length,
      max_impact_mps: impacts.reduce((m, c) => Math.max(m, c.impact_mps), 0),
    };
  }
}

const round = (x) => Math.round(x * 100) / 100;
/** The figures of no cut at all (`_figures([])`). */
const NO_FIGURES = { cuts: 0, wagons: 0, misrouted: 0, caughtUp: 0, derailed: 0, short: 0, hard: 0, max_impact_mps: 0 };
