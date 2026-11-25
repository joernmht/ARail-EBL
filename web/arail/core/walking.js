/**
 * People on foot among each other and among the vehicles (`world.walking`).
 *
 * The simulations walk their people along walks of the road network (core/network.js `walk`: on the
 * sidewalks, across the streets where they must). A walk is a line; people are not. `Walking` moves
 * a walker along its walk as a person does:
 *
 * - **Across a street** (wherever the walk leaves the sidewalk for a carriageway: at a zebra
 *   crossing, at the end of a street, across the mouth of a side street) the walker stops at the
 *   kerb and looks: it steps onto the street only when no vehicle stands in its way and none would
 *   reach it before it is across, with a margin ({@link WALKING}: the gap people accept). At a zebra
 *   crossing the vehicles that can still stop will stop (StVO § 26), so only those too close count,
 *   and trams, which need not stop. Who has waited long takes a smaller gap.
 * - **Vehicles brake for people** who are on the carriageway ahead of them all the same
 *   ({@link peopleAhead}): the driver who turns into a side street lets them cross (StVO § 9), and
 *   nobody is run over because a gap was misjudged. A vehicle that had to brake hard is a near miss
 *   (`nearMisses`).
 * - **On the sidewalk** people keep to the right of their line when somebody comes the other way,
 *   pass a slower one on the left when nobody comes, and walk behind them at their pace when there
 *   is no room: they do not walk through each other. A group walks as its formation says (`form`).
 *
 * A walker is any object with `path` (a walk), `s` (mm along it) and `speed` (m/s); `advance` keeps
 * its `pos`, `dir`, `lat` (mm to the right of the line), `kerb` (seconds waited at the kerb) and
 * `onRoad` on it. The simulations with people on foot list them with `pedestrians()`; that is what
 * the walkers see of each other (as they were a step ago).
 * @module arail/core/walking
 */
import { pointSegment, polylineAt, segmentDistance } from "./math.js";

/**
 * How people walk among others (m, s, m/s; estimates for teaching unless noted): `gap_s`: a vehicle
 * must be this much later at the crossing than the walker needs to be across (the critical gap of
 * pedestrians is about the crossing time plus 2 s, HCM 2010); after `patience_s` at the kerb
 * `hurried_gap_s` is enough, after `give_up_s` any gap
 * (never through a vehicle); a vehicle that stands (slower than `standing_mps`) is not waited for
 * unless its body is on the crossing (it sees the walker and stays); `body_m`: the room kept to a
 * vehicle's body; where vehicles stand on the crossing (a queue), people go round them, up to
 * `round` steps of `round_m` along the kerb to either side; a vehicle's way is followed `horizon_m` ahead in steps of `way_m` (it may turn
 * into the street the walker crosses); `keep_m`: to the right of the line when somebody comes;
 * `pass_m`: beside somebody to pass them (people are `body_w_m` wide, and stay within `edge_m` of the
 * walk's line, the middle of the sidewalk; who is within `beside_m` walks beside); `shift_mps`: how fast people step aside; `near_m`: behind
 * somebody this close ahead in the same lane people walk at their pace, closer than `close_m` they
 * fall back; `slot_m`: people waiting at a kerb stand this far
 * apart along it, up to `slots` beside each other, the next ones `row_m` behind them (`rows` at
 * most); a driver slower than `slow_mps` (a queue that creeps) lets people cross who have stood at the
 * kerb for `seen_s`, where the vehicle can still stop; a vehicle within
 * `turn_m` that has waited `turn_s` for people crossing goes before those who come to the kerb now:
 * the crossing is the vehicles' for `let_s`, then the people's for `people_s` at least.
 */
export const WALKING = Object.freeze({
  kerb_m: 0.4, sample_m: 0.5, gap_s: 2, hurried_gap_s: 0.5, patience_s: 15, give_up_s: 90, standing_mps: 0.5, body_m: 0.35, round_m: 1.2, round: 3, row_m: 0.7,
  horizon_m: 70, way_m: 2, brake: 3, keep_m: 0.4, pass_m: 0.6, shift_mps: 0.7, ahead_m: 4, near_m: 1.1, close_m: 0.7, lane_m: 0.45, body_w_m: 0.5, beside_m: 0.9, edge_m: 0.75, cell_m: 3, slower_mps: 0.15,
  slot_m: 0.5, slots: 9, rows: 40, turn_s: 6, turn_m: 12, let_s: 6, people_s: 10, slow_mps: 3, seen_s: 3,
});

/** Half the width of a vehicle by its kind (m): what its body takes of a crossing. */
const HALF_M = { bus: 1.3, tram: 1.35, car: 0.9, bike: 0.35, scooter: 0.3 };

/** A vehicle that brakes this hard (m/s²) for a person was a near miss. */
export const NEAR_MISS_BRAKE = 4;

export class Walking {
  /** @param {import("./world.js").World} world */
  constructor(world) {
    this.world = world;
    /** The people on a carriageway now (layout mm): what the vehicles brake for. */
    this.onRoad = [];
    this._onRoadNext = [];
    /** Vehicles that braked hard for a person, since the layout was loaded. */
    this.nearMisses = 0;
    this._cells = new Map();
    this._users = [];
    this._time = null;
    /** Whose turn it is at the crossings where vehicles have waited for people: place → {until: the vehicles' turn, again: no new one before}. */
    this._turns = new Map();
  }

  mm(m) {
    return (m * 1000) / this.world.scale;
  }

  /**
   * Once per step of the world, before the simulations move their people: what the walkers see of
   * each other and of the vehicles (as they were a step ago), and the people on the carriageways.
   */
  begin() {
    const w = this.world;
    this.onRoad = this._onRoadNext;
    this._onRoadNext = [];
    this._cells = new Map();
    this._users = null;
    this._time = w.time;
    if (this._turns.size > 200) for (const [k, t] of this._turns) if (t.again < w.time) this._turns.delete(k);
    const size = this.mm(WALKING.cell_m);
    for (const sim of w.simulations || []) {
      if (sim.enabled === false || typeof sim.pedestrians !== "function") continue;
      for (const p of sim.pedestrians()) {
        const key = `${Math.floor(p.pos[0] / size)},${Math.floor(p.pos[1] / size)}`, cell = this._cells.get(key);
        if (cell) cell.push(p);
        else this._cells.set(key, [p]);
      }
    }
  }

  /** The road users now: buses and trams, and the vehicles of the simulations (not the lights' stop lines). */
  users() {
    if (this._users) return this._users;
    const w = this.world, out = [];
    const add = (list) => {
      for (const u of list || []) if (u.vehicle?.phase !== "signal" && u.vehicle?.phase !== "block") out.push(u);
    };
    add(w.transit?.roadUsers?.());
    for (const s of w.simulations || []) if (s.enabled !== false && typeof s.roadUsers === "function") add(s.roadUsers());
    return (this._users = out);
  }

  /** The walkers near a point (as they were a step ago): those in the grid cells around it (`reach` cells to each side). */
  near(p, reach = 1) {
    const size = this.mm(WALKING.cell_m), out = [];
    const x = Math.floor(p[0] / size), y = Math.floor(p[1] / size);
    for (let i = x - reach; i <= x + reach; i++) {
      for (let j = y - reach; j <= y + reach; j++) {
        const cell = this._cells.get(`${i},${j}`);
        if (cell) for (const q of cell) out.push(q);
      }
    }
    return out;
  }

  /**
   * Move a walker along its walk for `dt` seconds: wait at the kerb for a gap, keep clear of the
   * people ahead, step aside for those who come. Sets `pos`, `dir`, `lat`, `kerb`, `onRoad`,
   * `held` on the walker.
   * @param {{path: object, s: number, speed: number, lat?: number, form?: {lat?: number, single?: number} | null, group?: object | null}} w
   *   `form`: where a member of a group walks (mm to the right of the line; `single`: when somebody
   *   comes the other way); `group`: the group (its members do not step aside for each other)
   * @param {number} dt simulated seconds
   * @param {number} [factor] of the speed (the weather)
   * @returns {boolean} true when the walker is at the end of its walk
   */
  advance(w, dt, factor = 1) {
    const path = w.path;
    if (!path) return true;
    const net = this._network(), mm = (m) => this.mm(m);
    let v = Math.max(0, w.speed * factor);
    const hidden = path.offstage || isHidden(path, w.s);
    w.held = false;
    if (!hidden && net) {
      // the street ahead: stop at the kerb until there is a gap
      const x = this._crossing(w, net);
      if (x && w.s < x.s1) {
        // (a place at the kerb is taken on coming near: beside the others who wait there, or behind them)
        if (x.slot == null && w.s >= x.s0 - mm(3)) this._slot(w, x);
        const kerb = x.s0 - mm(WALKING.kerb_m) - (x.row || 0) * mm(WALKING.row_m);
        if (w.s >= kerb && !x.go && x.slot != null) {
          x.go = (x.row || 0) === 0 && Math.abs((w.lat || 0) - x.slot) < mm(0.1) && this._clear(w, x);
          if (!x.go) {
            w.kerb = (w.kerb || 0) + dt;
            w.held = true;
            v = 0;
            // the row in front has gone: move up
            if (x.row > 0 && w.kerb > 1 && !this._taken(w, x.slot, x.row - 1)) x.row--;
          }
        }
        if (x.go && w.s >= x.s0 - mm(WALKING.kerb_m)) this._onRoadNext.push(w);
        w.onRoad = !!x.go && w.s >= x.s0;
      } else w.onRoad = false;
      if (!w.held) w.kerb = 0;
      /**
       * Lets the vehicles go: for a moment, as it is their turn, or because one of them is in the way
       * (a zebra crossing does not count it as about to cross: the vehicles drive on and clear it).
       */
      w.letting = w.held && !!x && (x.letUntil > this.world.time || !!x.blocked);
      // the people ahead and those who come; at the kerb and across the street in the place taken there
      if (x && x.slot != null && w.s < x.s1) {
        // to its place at the kerb: the queue's order keeps people apart there (keeping behind whoever
        // stands ahead as well would leave one of an earlier row stuck behind one of a later row, for good).
        // On the street itself nobody stops behind another: slower, at most by half, so the street is cleared.
        if (v > 0 && w.s >= x.s0) v = Math.max(v / 2, this._among(w, v, dt, x.slot));
        else this._ease(w, x.slot, dt);
      }
      else if (v > 0) v = this._among(w, v, dt);
      else this._ease(w, w.form?.lat ?? 0, dt);
    }
    w.s = Math.min(path.length, w.s + mm(v) * dt);
    const at = polylineAt(path.points, w.s, path.lengths), lat = w.lat || 0;
    w.dir = at.dir;
    w.pos = lat ? [at.point[0] - at.dir[1] * lat, at.point[1] + at.dir[0] * lat] : at.point;
    w.line = at.point;
    return w.s >= path.length;
  }

  _network() {
    try {
      return this.world.network?.() || null;
    } catch {
      return null;
    }
  }

  /**
   * The next stretch of the walk on a carriageway from where the walker is: {s0, s1, go}, found by
   * sampling the walk ahead as the walker goes (a little more each step), or null when none is near.
   */
  _crossing(w, net) {
    const path = w.path, step = this.mm(WALKING.sample_m);
    let c = w._cross;
    if (!c || c.path !== path) c = w._cross = { path, scanned: Math.max(0, w.s - step), s0: null, s1: null, go: false, slot: null, row: 0, zebra: null, letUntil: 0 };
    if (c.s1 != null && w.s >= c.s1) Object.assign(c, { s0: null, s1: null, go: false, slot: null, row: 0, zebra: null, letUntil: 0 });
    const until = Math.min(path.length, w.s + this.mm(WALKING.ahead_m));
    while (c.scanned < until && c.s1 == null) {
      const s = Math.min(path.length, c.scanned + step);
      c.scanned = s;
      if (isHidden(path, s)) continue;
      const on = !!net.carriageway(polylineAt(path.points, s, path.lengths).point);
      if (on && c.s0 == null) c.s0 = s - step / 2;
      else if (!on && c.s0 != null) c.s1 = s;
      if (c.s0 != null && c.s1 == null && s >= path.length) c.s1 = path.length;
      // a street is not wider than this: the walk runs along the carriageway (a street without sidewalks)
      if (c.s0 != null && c.s1 == null && s - c.s0 > this.mm(40)) Object.assign(c, { s0: null, s1: null, slot: null, row: 0, zebra: null });
    }
    // (in the middle of a crossing the far kerb is looked for at once)
    if (c.s0 != null && c.s1 == null) {
      let s = c.scanned;
      while (s < path.length && s - c.s0 <= this.mm(40) && net.carriageway(polylineAt(path.points, s, path.lengths).point)) s += step;
      c.s1 = Math.min(path.length, s);
      c.scanned = c.s1;
    }
    return c.s0 != null ? c : null;
  }

  /**
   * A place at the kerb for a walker who arrives there: beside those who wait already (`x.slot`, mm
   * to the right of the walk's line, which is along the kerb where the walk crosses the street), or
   * behind them (`x.row`): at the end of the shortest of the queues there, the nearest of them. Never
   * before somebody who waits already: that one could not move up, and the newcomer could not pass.
   */
  _slot(w, x) {
    const W = WALKING, gap = this.mm(W.slot_m), base = w.form?.lat ?? 0;
    const p = w.line || w.pos, d = w.dir;
    // how many wait in each queue: the last row taken of each place along the kerb
    const last = new Map();
    if (p && d) {
      for (const o of this.near(p, 3)) {
        const a = o.agent ?? o, c = a._cross;
        if (a === w || !c || c.slot == null || !(a.held || a.s < c.s0)) continue;
        const rx = o.pos[0] - p[0], ry = o.pos[1] - p[1];
        if (Math.abs(rx * d[0] + ry * d[1]) > this.mm(4 + W.rows * W.row_m) || (o.dir?.[0] ?? 0) * d[0] + (o.dir?.[1] ?? 0) * d[1] < 0.5) continue;
        const k = Math.round((-rx * d[1] + ry * d[0] - (a.lat || 0) + c.slot - base) / gap);
        last.set(k, Math.max(last.get(k) ?? -1, c.row || 0));
      }
    }
    let best = null;
    for (let n = 0; n < W.slots; n++) {
      const k = n % 2 ? (n + 1) / 2 : -n / 2, row = (last.get(k) ?? -1) + 1;
      if (!best || row < best.row) best = { k, row };
    }
    x.slot = base + best.k * gap;
    x.row = Math.min(W.rows, best.row);
  }

  /** Does somebody else wait at the walker's kerb in this place (the others' places as they took them)? */
  _taken(w, lat, row) {
    const p = w.line || w.pos, d = w.dir, gap = this.mm(WALKING.slot_m);
    if (!p || !d) return false;
    for (const o of this.near(p)) {
      const a = o.agent ?? o, c = a._cross;
      if (a === w || !c || c.slot == null || (c.row || 0) !== row || !(a.held || a.s < c.s0)) continue;
      // (at the same kerb: about level with the walker along its line, and facing the same way)
      const rx = o.pos[0] - p[0], ry = o.pos[1] - p[1];
      if (Math.abs(rx * d[0] + ry * d[1]) > this.mm(4) || (o.dir?.[0] ?? 0) * d[0] + (o.dir?.[1] ?? 0) * d[1] < 0.5) continue;
      const side = -rx * d[1] + ry * d[0] - (a.lat || 0) + c.slot;
      if (Math.abs(side - lat) < gap * 0.6) return true;
    }
    return false;
  }

  /**
   * May the walker step onto the street now: no vehicle there before the walker is across, and no
   * vehicle's body in the way? A vehicle's way ahead is followed where it has one (it may turn into
   * the street the walker crosses); else it is taken to drive straight on. Where vehicles stand on
   * the crossing (a queue), the walker goes round them: `x.slot` moves along the kerb to where the
   * way across is free, and the walker steps onto the street from there.
   */
  _clear(w, x) {
    const path = w.path, W = WALKING, mm = (m) => this.mm(m), metres = this.world.scale / 1000;
    const at0 = polylineAt(path.points, x.s0, path.lengths), at1 = polylineAt(path.points, x.s1, path.lengths);
    const line = (lat) => [[at0.point[0] - at0.dir[1] * lat, at0.point[1] + at0.dir[0] * lat], [at1.point[0] - at1.dir[1] * lat, at1.point[1] + at1.dir[0] * lat]];
    const [a, b] = line(x.slot ?? 0);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1e-6) return true;
    const waited = w.kerb || 0, anyway = waited > W.give_up_s;
    // it is the vehicles' turn at this crossing (see below): for a few seconds, then the people's again
    const now = this.world.time, place = `${Math.round((a[0] + b[0]) / 2 / mm(3))},${Math.round((a[1] + b[1]) / 2 / mm(3))}`;
    const turn = this._turns.get(place);
    x.blocked = false;
    x.letUntil = turn && turn.until > now ? turn.until : 0;
    if (x.letUntil) return false;
    const across = (length * metres) / Math.max(0.3, w.speed) + (w.form?.depth_s || 0);
    const margin = waited > W.patience_s ? W.hurried_gap_s : W.gap_s;
    const horizon = mm(W.horizon_m), step = mm(W.way_m), body = mm(W.body_m);
    const zebra = x.zebra ?? (x.zebra = this._zebra(a, b));
    const standing = [];
    for (const u of this.users()) {
      const fx = u.front[0] - a[0], fy = u.front[1] - a[1];
      if (Math.abs(fx) > horizon + length || Math.abs(fy) > horizon + length) continue;
      const kind = u.vehicle?.kind, half = mm(HALF_M[kind] ?? 0.9);
      const speed = u.speed ?? u.vehicle?.v ?? 0;
      // (a vehicle that stands sees the walker and stays: vehicles brake for people; its body may be in the way)
      if (speed < W.standing_mps) {
        if (segmentDistance(a, b, u.rear, u.front) < half + body + mm(W.round * W.round_m)) standing.push({ u, half });
        // one that has let people cross for a while goes next: who comes to the kerb now lets the vehicles go for a
        // moment, at a zebra crossing too (a stream of people would else hold them for good), but not for ever
        const hold = u.vehicle?.hold;
        if ((hold === "people" || hold === "zebra") && (u.vehicle.yielded || 0) > W.turn_s && !(turn && turn.again > now)) {
          const to = this._reach(u, a, b, half + body, mm(W.turn_m), step);
          if (to != null) {
            // the vehicles' turn, for everybody who comes to this crossing; then the people's for at least as long
            this._turns.set(place, { until: now + W.let_s, again: now + W.let_s + W.people_s });
            x.letUntil = now + W.let_s;
            return false;
          }
        }
        continue;
      }
      if (bodyDistance(a, b, u, half) < body) {
        x.blocked = true;
        return false;
      }
      // (who has waited very long takes any gap: the vehicles brake for people; but nobody walks into a vehicle)
      if (anyway) continue;
      // how far along its way it meets the walker's line
      const to = this._reach(u, a, b, half + body, horizon, step);
      if (to == null) continue;
      const metresTo = to * metres;
      // at a zebra crossing those who can still stop will (not trams); so does the driver in a queue that
      // creeps, for people who have stood at the kerb for a moment
      if ((zebra || (speed < W.slow_mps && waited > W.seen_s)) && kind !== "tram" && metresTo > (speed * speed) / (2 * W.brake) + 2) continue;
      if (metresTo / speed < across + margin) return false;
    }
    if (!standing.length) return true;
    // round the vehicles that stand there: the nearest place along the kerb from which the way across is free
    const net = this._network(), back = polylineAt(path.points, Math.max(0, x.s0 - mm(W.kerb_m)), path.lengths);
    const free = (lat) => {
      const [p, q] = line(lat);
      for (const { u, half } of standing) if (bodyDistance(p, q, u, half) < body) return false;
      return true;
    };
    if (free(x.slot ?? 0)) return true;
    for (let k = 1; k <= W.round; k++) {
      for (const sign of [1, -1]) {
        const lat = (x.slot ?? 0) + sign * k * mm(W.round_m);
        // (not from a place that is on a carriageway itself: the corner of a junction)
        if (net?.carriageway([back.point[0] - back.dir[1] * lat, back.point[1] + back.dir[0] * lat])) continue;
        if (!free(lat) || this._taken(w, lat, 0)) continue;
        x.slot = lat;
        return false; // from there, once the walker stands there
      }
    }
    x.blocked = true;
    return false;
  }

  /**
   * How far (mm) along its way a vehicle is from the line a–b (closer to it than `room`), or null
   * when its way does not come there within `horizon`.
   */
  _reach(u, a, b, room, horizon, step) {
    const way = this._way(u);
    if (way) {
      const { P, loop } = way, L = P.length;
      let prev = u.front;
      for (let d = step; d <= horizon; d += step) {
        let s = way.s + d;
        if (s > L) {
          if (!loop) break;
          s -= L;
        }
        const q = polylineAt(P.points, s, P.lengths).point;
        if (segmentDistance(a, b, prev, q) < room) return d - step;
        prev = q;
      }
      return null;
    }
    // straight on
    const end = [u.front[0] + u.dir[0] * horizon, u.front[1] + u.dir[1] * horizon];
    if (segmentDistance(a, b, u.front, end) >= room) return null;
    for (let d = step; d <= horizon; d += step) {
      const q = [u.front[0] + u.dir[0] * d, u.front[1] + u.dir[1] * d];
      if (segmentDistance(a, b, u.front, q) < room) return d - step;
    }
    return horizon;
  }

  /** The way a vehicle drives: its line and where it is on it ({P, s, loop}), or null where it is not known. */
  _way(u) {
    const v = u.vehicle;
    if (!v) return null;
    if (v.path?.points && v.path.lengths) return { P: v.path, s: v.s, loop: false };
    if (v.line && typeof v.line === "object" && v.line.points) return { P: v.line, s: v.s, loop: false };
    const c = v.lineId ? this.world.transit?.lines?.get(v.lineId)?.circuit : null;
    return c?.points ? { P: c, s: ((v.s % c.length) + c.length) % c.length, loop: true } : null;
  }

  /** Is the crossing from a to b on a zebra crossing (one of the network lies at its middle)? */
  _zebra(a, b) {
    const net = this._network();
    if (!net) return false;
    // the zebra crossings of the network, with where they are (kept for the network)
    let list = net._zebraPlaces;
    if (!list) {
      list = net._zebraPlaces = [];
      for (const e of net.edges || []) for (const z of e.zebras || []) list.push({ pos: polylineAt(e.points, z.s, e.lengths).point, half: z.width / 2 });
    }
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], reach = this.mm(3);
    return list.some((z) => Math.hypot(z.pos[0] - mid[0], z.pos[1] - mid[1]) < z.half + reach);
  }

  /**
   * Among the people on the sidewalk: to the right when somebody comes, to the left (or right) past a
   * slower one when nobody does, else behind them at their pace; never into somebody who walks
   * beside. Returns the speed (m/s). With a `place` (mm to the right of the line: the one taken at a
   * kerb) the walker keeps it and only keeps behind the one ahead.
   */
  _among(w, v, dt, place = null) {
    const W = WALKING, mm = (m) => this.mm(m);
    const p = w.pos || w.line, d = w.dir;
    let want = place ?? w.form?.lat ?? 0;
    if (!p || !d) {
      this._ease(w, want, dt);
      return v;
    }
    const ahead = mm(W.ahead_m), body = mm(W.body_w_m), beside = mm(W.beside_m), near = mm(W.near_m), tie = mm(0.15), lat = w.lat || 0;
    let coming = false, block = null, lo = -Infinity, hi = Infinity;
    for (const o of this.near(p)) {
      const a = o.agent ?? o;
      if (a === w || (w.group && a.group === w.group)) continue;
      const rx = o.pos[0] - p[0], ry = o.pos[1] - p[1];
      const along = rx * d[0] + ry * d[1];
      if (along < -beside || along > ahead) continue;
      const side = -rx * d[1] + ry * d[0]; // to the right of the walker
      if (Math.abs(side) > 2 * beside) continue;
      const facing = (o.dir?.[0] ?? 0) * d[0] + (o.dir?.[1] ?? 0) * d[1];
      if (facing < -0.3) {
        if (along > 0 && Math.abs(side) < beside) coming = true;
        continue;
      }
      // beside the walker (level with it, or just behind or ahead): no stepping into them
      if (Math.abs(along) < beside && Math.abs(side) >= body) {
        if (side > 0) hi = Math.min(hi, lat + side - mm(W.pass_m));
        else lo = Math.max(lo, lat + side + mm(W.pass_m));
        continue;
      }
      if (facing < 0.5 || Math.abs(side) >= body) continue;
      // in the way ahead; level with each other (they left a door together), one of the two counts as behind
      if (along <= tie && !(along > -tie && String(a.id ?? "") < String(w.id ?? ""))) continue;
      if (block && along >= block.along) continue;
      block = { along: Math.max(0, along), side, speed: a.held ? 0 : a.speed ?? 0 };
    }
    if (place == null) {
      if (coming) want = w.form?.single ?? Math.max(want, mm(W.keep_m));
      else if (block && block.along < mm(2.5) && (block.speed < w.speed - W.slower_mps || block.along < near)) {
        // past them: on the left where there is room (the walk's line is the middle of the sidewalk), else on the right
        const left = lat + block.side - mm(W.pass_m), right = lat + block.side + mm(W.pass_m), edge = mm(W.edge_m);
        want = left >= -edge && left >= lo ? left : right <= edge && right <= hi ? right : want;
      }
      // (between two who walk beside it there is no room to either side: as it is)
      want = lo <= hi ? Math.min(hi, Math.max(lo, want)) : lat;
      // somebody comes and there is no room to the right beside the one walking there: fall in behind them
      if (coming && want < mm(W.keep_m) - 1e-6 && hi < Infinity) v *= 0.6;
    }
    this._ease(w, want, dt);
    // not into the one ahead: at their pace behind them, falling back when too close
    if (block && block.along < near) v = Math.min(v, block.along < mm(W.close_m) ? block.speed * 0.5 : block.speed);
    return v;
  }

  /** Step aside towards `want` (mm to the right of the line), as fast as people do. */
  _ease(w, want, dt) {
    const lat = w.lat || 0, step = this.mm(WALKING.shift_mps) * dt;
    w.lat = Math.abs(want - lat) <= step ? want : lat + Math.sign(want - lat) * step;
  }
}

/**
 * The distance (mm) of the segment a–b from a vehicle's body: the rectangle about its line from rear
 * to front, `half` wide to either side (0 where the segment crosses it).
 */
function bodyDistance(a, b, u, half) {
  const r = u.rear, f = u.front;
  let dx = f[0] - r[0], dy = f[1] - r[1];
  const l = Math.hypot(dx, dy);
  if (l < 1e-9) return segmentDistance(a, b, r, f) - half;
  dx /= l;
  dy /= l;
  const nx = -dy * half, ny = dx * half;
  const c = [[r[0] + nx, r[1] + ny], [f[0] + nx, f[1] + ny], [f[0] - nx, f[1] - ny], [r[0] - nx, r[1] - ny]];
  let best = Infinity;
  for (let k = 0; k < 4 && best > 0; k++) best = Math.min(best, segmentDistance(a, b, c[k], c[(k + 1) % 4]));
  return best;
}

/** Is a walk out of sight at `s` (an underpass, off stage)? As core/network.js `hiddenAt`. */
function isHidden(path, s) {
  const h = path.hidden;
  if (!h || !h.length) return false;
  for (const [s0, s1] of h) if (s >= s0 && s <= s1) return true;
  return false;
}

/**
 * How far ahead of a vehicle (mm) the nearest person on the carriageway is in its lane, or Infinity:
 * vehicles brake for them (`world.walking.onRoad`). With the vehicle's `way` (its line and where it
 * is on it) the lane is followed round the corner it turns; else it is straight ahead.
 * @param {import("./world.js").World} world
 * @param {number[]} front the vehicle's front (layout mm)
 * @param {number[]} dir its direction (unit vector)
 * @param {number} lookMM how far it looks ahead
 * @param {number} laneMM half the width of what it sweeps
 * @param {{points: number[][], lengths: number[], length: number, s: number, loop?: boolean} | null} [way]
 */
export function peopleAhead(world, front, dir, lookMM, laneMM, way = null) {
  const list = world.walking?.onRoad;
  if (!list || !list.length) return Infinity;
  let best = Infinity;
  // (only the people near enough to matter)
  const reach = lookMM + laneMM;
  let near = null;
  for (const w of list) {
    const p = w.pos;
    if (!p) continue;
    const rx = p[0] - front[0], ry = p[1] - front[1];
    if (Math.abs(rx) > reach || Math.abs(ry) > reach) continue;
    if (way) {
      (near ||= []).push(p);
      continue;
    }
    const along = rx * dir[0] + ry * dir[1];
    if (along < 0 || along > lookMM || along >= best) continue;
    if (Math.abs(rx * dir[1] - ry * dir[0]) > laneMM) continue;
    best = along;
  }
  if (!near) return best;
  const step = Math.max(laneMM, lookMM / 12), L = way.length;
  let prev = front;
  for (let d = step; d <= lookMM + step && best === Infinity; d += step) {
    let s = way.s + d;
    if (s > L) {
      if (!way.loop) s = L;
      else s -= L;
    }
    const q = polylineAt(way.points, s, way.lengths).point;
    for (const p of near) if (pointSegment(p, prev, q).distance < laneMM) best = Math.min(best, Math.max(0, d - step));
    prev = q;
  }
  return best;
}
