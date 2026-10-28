/**
 * Rail lines: trains that run along a chain of tracks from platform to platform, e.g. a regional
 * train from Waldhof to Neustadt. The tracks are given in the order the trains run along them; where
 * two of them meet end to end the trains run on, where they do not (the line leaves the table, runs
 * round the hall and comes back) the trains run out of view for `hidden_km` of line in between.
 *
 * A train comes in at the start of the first track every `headway_s` (outside the rush hours; more
 * often in them, none at night), runs to the last platform on its tracks, turns there and runs back,
 * and leaves where it came in. At every platform on its tracks it stops in both directions: when it
 * reaches the point from which the platform's train comes in, it hands over to the services (the
 * dock's train comes in, the people get on and off, it leaves; rail/stock.js draws it), and runs on
 * from where that train left; while another train stands there it waits, and goes before the
 * timetable's next one. A platform that lists only
 * its line (`lines`) is its own (mode "line" of core/services.js): the timetable sends no trains
 * there; at the others the timetable's trains run as well. While a planner (the operations plan, the
 * journeys' trains) or the control system runs a platform, the line's trains pass it without stopping.
 *
 * The tracks between two gaps (a stretch) are one track for both directions: a train enters a
 * stretch only when no train comes the other way on it, keeps its distance to the one ahead, and a
 * stretch where the trains turn takes one train at a time. Out of view any number of trains wait; one
 * waiting to enter goes before those that would enter the other way, the one that waited longest first.
 * @module arail/rail/lines
 */
import { LayoutObject } from "../core/object.js";
import { dist2, polylineLengths, polylineProject } from "../core/math.js";
import { OVERLAY, rgba } from "../core/colors.js";
import { carsLength, drawTrain, turnCars } from "./draw.js";
import { STOP_MARGIN_M, carsOf, dockLine } from "./stock.js";
import { trainConsist } from "./trains.js";

/** Track ends closer than this (layout mm) meet: the trains run on from one to the other. */
export const MEET_MM = 30;
/** Acceleration and braking of the line's trains (m/s²). */
const ACCEL = 0.6, BRAKE = 0.7;
/** Metres a train keeps behind the tail of the train ahead on the same stretch. */
const SPACING_M = 150;
/** Metres beyond its length a train at a platform comes in from and leaves to (as rail/stock.js draws it). */
const APPROACH_EXTRA_M = 40;

export class RailLine extends LayoutObject {
  static type = "rail-line";
  /** Its trains are on the table module, never on a street's bridge (core/elevation.js). */
  static elevation = "ground";
  /** A route over tracks, which stand on the table modules themselves. */
  static anywhere = true;
  static label = "Rail line";
  static category = "Transport";
  /** Tap the tracks in order: they are written to `tracks` (the editors' placement "stops"). */
  static placement = "stops";
  static stopTypes = ["track"];
  static stopsKey = "tracks";
  static stopsHint = "Tap the tracks in the order the trains run along them, then press Finish. Where two tracks do not meet, the trains run out of view in between.";
  static description = "Trains that run along the tracks from platform to platform, stop at every platform on them, turn at the last one and run back. Tap the tracks in the order the trains run along them; where two do not meet, the trains run out of view in between.";
  static params = [
    { key: "name", label: "Name", type: "text", default: "" },
    { key: "number", label: "Line", type: "text", default: "RB", help: "Shown on the trains and boards, e.g. \"RB 31\"; its letters choose the train (RE, RB, S) unless the layout names one for it." },
    { key: "destination", label: "Towards (outward)", type: "text", default: "", help: "Where the trains go on their way out, e.g. \"Neustadt\". Empty: the platform where they turn." },
    { key: "origin", label: "Towards (back)", type: "text", default: "", help: "Where they go on the way back. Empty: the first platform." },
    { key: "color", label: "Colour", type: "color", default: "#0A777F" },
    { key: "headway_s", label: "A train every", type: "number", unit: "s (simulated)", min: 60, max: 7200, step: 10, default: 600, help: "Outside the rush hours; more often in them, no trains at night." },
    { key: "speed_kmh", label: "Top speed", type: "number", unit: "km/h", min: 20, max: 300, step: 10, default: 120 },
    { key: "hidden_km", label: "Out of view", type: "number", unit: "km", min: 0, max: 200, step: 0.1, default: 2, help: "Kilometres of line between two tracks that do not meet: the trains run there out of view." },
    { key: "show_route", label: "Show the route", type: "boolean", default: false },
  ];

  constructor(world, spec) {
    super(world, spec);
    /** The trains of the line (run-time only, never saved). */
    this.trains = [];
    this._timer = 0;
    this._next = 1;
    this._route = null;
  }

  /** The route, worked out anew when any object changed (its tracks may have). */
  get geometry() {
    if (this._objectsVersion !== this.world.objectsVersion) {
      this._objectsVersion = this.world.objectsVersion;
      this._cacheKey = null;
    }
    return super.geometry;
  }

  /** The tracks of the line that exist, in order. */
  trackObjects() {
    return (Array.isArray(this.spec.tracks) ? this.spec.tracks : []).map((id) => this.world.getObject(id)).filter((o) => o?.type === "track");
  }

  /**
   * The route: the tracks oriented the way the trains run, joined into stretches where they meet,
   * with the gaps out of view between them. {stretches: [{points, lengths, total, line, tracks:
   * [{track, o, x0, x1}]}], segments: [{kind: "stretch", i} | {kind: "hidden", length_m}], problems}.
   */
  computeGeometry() {
    const tracks = this.trackObjects().filter((t) => t.geometry);
    if (!tracks.length) return null;
    const problems = [];
    const ids = Array.isArray(this.spec.tracks) ? this.spec.tracks : [];
    if (tracks.length < ids.length) problems.push("A track of the line is missing.");
    const ends = (t) => [t.geometry.points[0], t.geometry.points[t.geometry.points.length - 1]];
    // where neighbours meet: the end of one, the start of the next
    const meet = [];
    for (let i = 0; i + 1 < tracks.length; i++) {
      const a = ends(tracks[i]), b = ends(tracks[i + 1]);
      let best = null;
      for (let ea = 0; ea < 2; ea++) for (let eb = 0; eb < 2; eb++) {
        const d = dist2(a[ea], b[eb]);
        if (d <= MEET_MM && (!best || d < best.d)) best = { d, ea, eb };
      }
      meet.push(best);
    }
    // the way each track is run: towards the end where it meets the next, from the end where it meets the one before
    const o = tracks.map((_, i) => {
      if (meet[i]) return meet[i].ea === 1 ? 1 : -1;
      if (i > 0 && meet[i - 1]) return meet[i - 1].eb === 0 ? 1 : -1;
      return 1;
    });
    for (let i = 0; i + 1 < tracks.length; i++) {
      if (meet[i] && (meet[i].eb === 0 ? 1 : -1) !== o[i + 1]) problems.push(`${tracks[i + 1].name} meets both its neighbours at the same end.`);
    }
    const stretches = [], segments = [], m = this.mm(1);
    let cur = null;
    tracks.forEach((t, i) => {
      if (!cur) {
        cur = { points: [], tracks: [] };
        stretches.push(cur);
        segments.push({ kind: "stretch", i: stretches.length - 1 });
      }
      const pts = o[i] > 0 ? t.geometry.points : [...t.geometry.points].reverse();
      const x0 = cur.points.length ? polylineLengths(cur.points).at(-1) : 0;
      cur.points.push(...(cur.points.length ? pts.slice(1) : pts));
      cur.tracks.push({ track: t, o: o[i], x0, x1: x0 + t.geometry.total });
      if (!meet[i] && i + 1 < tracks.length) {
        cur = null;
        segments.push({ kind: "hidden", length_m: Math.max(0, Number(this.spec.hidden_km) || 0) * 1000 });
      }
    });
    for (const s of stretches) {
      s.lengths = polylineLengths(s.points);
      s.total = s.lengths.at(-1);
      s.line = { points: s.points, lengths: s.lengths, total: s.total, m };
    }
    // what the trains run on: when it changes, the trains on the old route are gone
    const key = JSON.stringify([tracks.map((t) => [t.id, t.geometry.points]), segments]);
    return { stretches, segments, problems, key, points: stretches.flatMap((s) => s.points) };
  }

  problems() {
    const g = this.geometry;
    if (!g) return ["Tap the tracks the trains run along, in order."];
    const out = [...g.problems];
    if (!this.route().stops[1].length) out.push("No platform on its tracks: the trains do not stop anywhere.");
    return out;
  }

  /** Is this dock on one of the line's tracks? Its trains stop there. */
  onTracks(dock) {
    if (dock.kind !== "rail" || !dock.track) return false;
    return this.trackObjects().some((t) => t.geometry && String(t.spec.track_id) === String(dock.track));
  }

  /**
   * Is this dock the line's own: on its tracks, at a platform whose `lines` name only this line? Only
   * its trains come there (core/services.js, mode "line").
   */
  servesDock(dock) {
    if (!this.onTracks(dock)) return false;
    const norm = (x) => String(x ?? "").trim().toLowerCase();
    const lines = String(dock.area.owner?.spec?.lines ?? "").split(",").map(norm).filter(Boolean);
    return lines.length > 0 && lines.every((l) => l === norm(this.spec.number));
  }

  /**
   * The stops along the route, worked out once per layout: for each direction (1: out, -1: back) the
   * docks on its tracks in the order the trains reach them, each with the stretch, where the train's
   * front stands (`x`, mm along the stretch) and the direction the dock's train goes (`d`, along the
   * platform). `turn`: the last stop on the way out, where the trains turn.
   */
  route() {
    const g = this.geometry, key = `${this.world.objectsVersion}:${this.world.map.version}:${this.world.scale}`;
    if (this._route?.key === key && this._route.g === g) return this._route;
    const stops = { 1: [], [-1]: [] };
    if (g) {
      const docks = this.world.stopAreas().flatMap((a) => a.docks).filter((d) => d.kind === "rail" && d.track);
      g.stretches.forEach((s, i) => {
        const k = g.segments.findIndex((seg) => seg.kind === "stretch" && seg.i === i);
        for (const part of s.tracks) {
          for (const dock of docks.filter((d) => String(d.track) === String(part.track.spec.track_id))) {
            const { at, sign } = dockLine(this.world, dock);
            for (const r of [1, -1]) {
              const d = r * part.o * sign;
              const t = at(d > 0 ? dock.s1 - STOP_MARGIN_M : dock.s0 + STOP_MARGIN_M);
              stops[r].push({ k, x: part.x0 + (part.o > 0 ? t : part.track.geometry.total - t), dock, d });
            }
          }
        }
      });
    }
    stops[1].sort((a, b) => a.k - b.k || a.x - b.x);
    stops[-1].sort((a, b) => b.k - a.k || b.x - a.x);
    this._route = { key, g, stops, turn: stops[1].at(-1) ?? null };
    return this._route;
  }

  /** The line's label on a train: its number and where it goes. */
  label(r) {
    const { stops } = this.route(), first = stops[1][0], last = stops[1].at(-1);
    const to = r > 0 ? this.spec.destination || last?.dock.area.owner?.name : this.spec.origin || first?.dock.area.owner?.name;
    const n = String(this.spec.number || this.spec.name || "Train").trim();
    return to ? `${n} → ${to}` : n;
  }

  /* ---------------------------------------------------------------- running */

  /** Advance the trains (called by the world every step). */
  update(dt) {
    const g = this.geometry;
    if ((g?.key ?? null) !== this._running) {
      // a new route: the trains on the old one are gone (one at a platform leaves there)
      this._running = g?.key ?? null;
      this.trains = [];
    }
    if (!g || !g.segments.length) return;
    const route = this.route();
    for (const t of [...this.trains]) this._run(t, dt, g, route);
    this.trains = this.trains.filter((t) => t.state !== "gone");
    // a new train comes in: as often as the headway says, more in the rush hours, none at night
    this._timer -= dt * Math.max(0, this.world.clock.demand("rail"));
    if (this._timer <= 0 && this._mayEnter(null, 0, 1)) {
      this._timer = Math.max(60, Number(this.spec.headway_s) || 600);
      this._spawn(g);
    }
  }

  _spawn(g) {
    const demand = this.world.clock.demand("rail");
    // its consist: the layout's for the line, else the default fleet; coupled in the rush hours as far as the shortest platform takes it
    const docks = this.route().stops[1].map((s) => s.dock);
    const shortest = docks.length ? docks.reduce((a, b) => (b.s1 - b.s0 < a.s1 - a.s0 ? b : a)) : null;
    const consist = trainConsist(this.world, { line: this.label(1), demand, dock: shortest, source: "line" });
    if (!consist?.vehicles.length) return;
    const cars = carsOf(consist);
    const t = {
      id: `${this.id}-${this._next++}`, k: 0, x: 0, r: 1, v: (this.spec.speed_kmh / 3.6) * 0.6, state: "run",
      consist, cars, length_m: carsLength(cars), demand, done: new Set(), stop: null, vehicle: null, turned: false,
      spec: { name: consist.name, vehicles: consist.vehicles.map((x) => ({ type: x.type, loaded: x.loaded, isolated: x.isolated })) },
    };
    this.trains.push(t);
  }

  /** The stretch a train is on (index into the stretches), or -1 out of view. */
  _stretchOf(t) {
    const seg = this.geometry?.segments[t.k];
    return seg?.kind === "stretch" ? seg.i : -1;
  }

  /**
   * May a train (null: a new one) enter the stretch of segment k going r: nobody comes the other way
   * or waits longer to come, the one ahead is far enough, and where the trains turn nobody else is there.
   */
  _mayEnter(self, k, r) {
    const g = this.geometry, seg = g.segments[k];
    if (!seg || seg.kind !== "stretch") return true;
    const s = g.stretches[seg.i], entry = r > 0 ? 0 : s.total, m = this.mm(1);
    const turnHere = this.route().turn?.k === k, since = self?.waiting?.since ?? Infinity;
    for (const o of this.trains) {
      if (o === self || o.state === "gone") continue;
      if (o.waiting?.k === k && o.r !== r && (!self || o.waiting.since < since)) return false;
      if (o.k !== k) continue;
      if (turnHere || o.r !== r) return false;
      if ((o.x - entry) * r < (o.length_m + SPACING_M) * m) return false;
    }
    return true;
  }

  _run(t, dt, g, route) {
    const m = this.mm(1), vmax = Math.max(1, (Number(this.spec.speed_kmh) || 120) / 3.6);
    if (t.state === "dock") return this._atDock(t, route, m);
    const seg = g.segments[t.k];
    if (seg.kind === "hidden") {
      // out of view: at top speed, then wait at its end until the stretch ahead may be entered
      t.v = vmax;
      t.x += t.r * t.v * dt;
      const out = t.r > 0 ? t.x - seg.length_m : -t.x;
      if (out >= 0) this._leave(t, out, g);
      return;
    }
    const s = g.stretches[seg.i];
    // the next stop on this stretch: the point from which the platform's train comes in
    const stop = route.stops[t.r].find((p) => p.k === t.k && !t.done.has(p.dock.id) && (p.x - t.x) * t.r >= -1);
    const travel = (t.length_m + APPROACH_EXTRA_M) * m;
    const target = stop ? stop.x - t.r * travel : null;
    const gap = target == null ? Infinity : ((target - t.x) * t.r) / m; // metres to it
    if (target != null && gap <= Math.max(0.5, t.v * dt)) {
      if (gap > 0) t.x = target; // (a train that came onto the stretch past it does not go back)
      t.v = 0;
      this._arrive(t, stop);
      return;
    }
    t.v = gap <= (t.v * t.v) / (2 * BRAKE) + 1 ? Math.max(2, t.v - BRAKE * dt) : Math.min(vmax, t.v + ACCEL * dt);
    t.x += t.r * Math.min(t.v * dt, gap) * m;
    const out = t.r > 0 ? (t.x - s.total) / m : -t.x / m;
    if (out >= 0) this._leave(t, out, g);
  }

  /** Past the end of its segment: into the next one (if it may), or off the route. */
  _leave(t, overshoot, g) {
    const seg = g.segments[t.k], k = t.k + t.r;
    const endX = (sg) => (sg.kind === "hidden" ? (t.r > 0 ? sg.length_m : 0) : t.r > 0 ? g.stretches[sg.i].total : 0);
    if (k < 0) {
      t.state = "gone"; // back where it came in
      return;
    }
    if (k >= g.segments.length) {
      // the end of the route without a platform to turn at: it turns there
      t.x = endX(seg);
      this._turn(t);
      return;
    }
    const next = g.segments[k];
    if (next.kind === "stretch" && !this._mayEnter(t, k, t.r)) {
      t.x = endX(seg);
      t.v = 0;
      t.waiting ??= { k, since: this.world.time };
      return;
    }
    t.waiting = null;
    t.k = k;
    const startX = next.kind === "hidden" ? (t.r > 0 ? 0 : next.length_m) : t.r > 0 ? 0 : g.stretches[next.i].total;
    t.x = startX + t.r * (next.kind === "hidden" ? overshoot : overshoot * this.mm(1));
  }

  _turn(t) {
    t.r = -t.r;
    t.cars = turnCars(t.cars);
    t.turned = true;
    t.done = new Set();
  }

  /** At the point from which the platform's train comes in: hand over to the services, or pass, or wait. */
  _arrive(t, stop) {
    const services = this.world.services, st = services.docks.get(stop.dock.id);
    if (!st || st.mode === "plan" || st.mode === "feed") {
      t.done.add(stop.dock.id); // a planner or the control system runs the platform now: pass it
      return;
    }
    if (st.vehicle) {
      services.defer(stop.dock.id, 2); // another train is there: wait, before the timetable's next one
      return;
    }
    const v = services.call(stop.dock.id, { source: "line", line: this.label(t.r), direction: stop.d });
    if (!v) {
      t.done.add(stop.dock.id); // closed (a track closure): pass it
      return;
    }
    v.consistSpec = t.spec;
    v.demand = t.demand;
    v.railLine = this.id;
    v.lineTrain = t.id;
    t.state = "dock";
    t.stop = stop;
    t.vehicle = v;
  }

  /** While the platform's train is there: on when it has left; where the line turns, already when it leaves. */
  _atDock(t, route, m) {
    const services = this.world.services, stop = t.stop, v = t.vehicle;
    const st = services.docks.get(stop.dock.id);
    const gone = !st || st.vehicle !== v;
    const turning = route.turn && stop.dock.id === route.turn.dock.id && !t.turned;
    if (turning && (gone || v.phase === "departing")) {
      if (!gone) services.free(stop.dock.id);
      // it stands with its front at the stop: its tail is the new front
      t.x = stop.x - t.r * t.length_m * m;
      this._turn(t);
      t.done.add(stop.dock.id);
      t.state = "run";
      t.v = 0;
      t.vehicle = null;
      return;
    }
    if (!gone) return;
    t.done.add(stop.dock.id);
    t.state = "run";
    t.vehicle = null;
    const travel = (t.length_m + APPROACH_EXTRA_M) * m;
    t.x = stop.x + t.r * travel;
    t.v = Math.min((Number(this.spec.speed_kmh) || 120) / 3.6, travel / m / Math.max(1, this.world.layout.services.approach_s));
    const s = this.geometry.stretches[this._stretchOf(t)];
    const out = t.r > 0 ? (t.x - s.total) / m : -t.x / m;
    if (out >= 0) this._leave(t, out, this.geometry);
  }

  /* ---------------------------------------------------------------- boards and cards */

  /** Is a dock of a stop area the line's own (its board shows the line's trains)? */
  servesArea(area) {
    return area.docks.some((d) => this.servesDock(d));
  }

  /**
   * Board lines of a stop area: the line's next trains there ("RB 31 → Neustadt in 40 s"), at most two.
   * @returns {string[]}
   */
  statusLines(area) {
    const g = this.geometry;
    if (!g) return [];
    const route = this.route(), vmax = Math.max(1, (Number(this.spec.speed_kmh) || 120) / 3.6);
    const out = [];
    for (const t of this.trains) {
      if (t.state === "dock") continue;
      // its next stops on this pass, then on the way back
      let metres = 0, k = t.k, x = t.x, r = t.r, done = t.done, found = null;
      for (let pass = 0; pass < 2 && !found; pass++) {
        for (const p of route.stops[r]) {
          if (done.has(p.dock.id) || (p.k - k) * r < 0 || (p.k === k && (p.x - x) * r < 0)) continue;
          metres += this._between(k, x, p.k, p.x, r);
          [k, x] = [p.k, p.x];
          if (p.dock.area.id === area.id) {
            found = { r, metres };
            break;
          }
        }
        if (found || t.turned || r < 0) break;
        r = -r;
        done = new Set([route.turn?.dock.id]);
      }
      if (found) out.push({ s: found.metres / vmax, text: this.label(found.r) });
    }
    out.sort((a, b) => a.s - b.s);
    return out.slice(0, 2).map((x) => `${x.text} in ${Math.max(0, Math.round(x.s / (this.world.speed || 1)))} s`);
  }

  /** Metres along the route from (k, x) to (k2, x2) going r. */
  _between(k, x, k2, x2, r) {
    const g = this.geometry, m = this.mm(1);
    const len = (sg) => (sg.kind === "hidden" ? sg.length_m : g.stretches[sg.i].total / m);
    const pos = (sg, xx) => (sg.kind === "hidden" ? xx : xx / m);
    if (k === k2) return Math.abs(pos(g.segments[k], x2) - pos(g.segments[k], x));
    let d = r > 0 ? len(g.segments[k]) - pos(g.segments[k], x) : pos(g.segments[k], x);
    for (let j = k + r; j !== k2; j += r) d += len(g.segments[j]);
    return d + (r > 0 ? pos(g.segments[k2], x2) : len(g.segments[k2]) - pos(g.segments[k2], x2));
  }

  card() {
    const card = super.card();
    const route = this.route();
    card.rows.push(["Line", this.label(1)]);
    card.rows.push(["Stops", route.stops[1].map((p) => `${p.dock.area.owner?.name || p.dock.area.id}${p.dock.label ? ` (${p.dock.label})` : ""}`).join(" → ") || "none"]);
    card.rows.push(["A train every", `${Math.round(Number(this.spec.headway_s) || 600)} s (simulated)`]);
    const hidden = (this.geometry?.segments || []).filter((s) => s.kind === "hidden").length;
    if (hidden) card.rows.push(["Out of view", `${hidden} × ${Number(this.spec.hidden_km) || 0} km`]);
    card.rows.push(["Trains on the line", String(this.trains.length)]);
    return card;
  }

  /* ---------------------------------------------------------------- pointing and drawing */

  anchorPoint() {
    const s = this.geometry?.stretches[0];
    return s ? s.points[Math.floor(s.points.length / 2)] : null;
  }

  footprint() {
    return null;
  }

  /** Lines are selected by tapping their route. */
  contains(p, toleranceMM = 0) {
    return (this.geometry?.stretches || []).some((s) => polylineProject(s.points, p, s.lengths).distance <= toleranceMM + this.mm(2));
  }

  /** The route, when it is to be shown (the trains are drawn with what moves, `drawMoving`). */
  draw(view) {
    if (!this.spec.show_route) return;
    for (const s of this.geometry?.stretches || []) view.line(s.points, { stroke: rgba(this.spec.color || "#0A777F", 0.85), width: 3, order: 1.2 });
  }

  drawSelection(view) {
    for (const s of this.geometry?.stretches || []) view.line(s.points, { stroke: OVERLAY.selection, width: 4, dash: [6, 4], order: 100, layer: "overlay" });
  }

  /** The trains running between the platforms (at a platform the services draw them). */
  drawMoving(view) {
    const g = this.geometry;
    if (!g) return;
    for (const t of this.trains) {
      const i = this._stretchOf(t);
      if (t.state !== "run" || i < 0) continue;
      drawTrain(view, g.stretches[i].line, { head: t.x, dir: t.r, cars: t.cars, doors: 0 });
    }
  }
}
