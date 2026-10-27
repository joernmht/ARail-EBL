/**
 * The track ahead of a train on the layout: where the train is (at a platform, of the timetable or
 * the rail operations, or reported by the control system), the path ahead of its front along its
 * track and on over the tracks that join it end to end, the line of its run (each section with its
 * line speed, gradient, curve and rail condition, then the line beyond the layout), the signals and
 * PZB magnets on the way; and what is drawn on the table for the train whose card is open
 * (`world.trackAhead`): its expected speed, where it reaches its top speed, starts braking and stops,
 * its braking distance against the next signal, the PZB magnets and the movement authority.
 *
 * Distances are prototype metres: a track is as long as its `length_m` says, else its length on the
 * model at the layout's scale. A lab whose short tracks stand for longer sections (shortened
 * distances) sets `length_m`; the bands are drawn shortened the same way. What runs beyond the
 * tracks is marked at their end.
 * @module arail/rail/ahead
 */
import { CD, OVERLAY, rgba } from "../core/colors.js";
import { polylineAt, polylineProject } from "../core/math.js";
import { RAIL_CONDITIONS, brakingSpeed, fullBraking, runProfile, serviceDeceleration, trainModel } from "./dynamics.js";
import { PZB_RULES, etcsCurves, pzbType, supervision } from "./protection.js";
import { trainPose } from "./stock.js";
import { sectionSystems } from "./systems.js";
import { consistFor, trainConsist } from "./trains.js";

/** The line data of a section (parameters of tracks): its length in the prototype, gradient, curve, rails and braking distance. */
export const LINE_PARAMS = [
  { key: "length_m", label: "Length in the prototype", type: "number", unit: "m", min: 0, max: 100000, step: 10, help: "Empty: its length on the model at the layout's scale. Larger where the track stands for a longer section (shortened distances)." },
  { key: "gradient_permille", label: "Gradient", type: "number", unit: "‰", min: -60, max: 60, step: 0.5, help: "Rising towards its last point; negative: falling. Empty: level." },
  { key: "curve_radius_m", label: "Curve radius", type: "number", unit: "m", min: 0, max: 20000, step: 10, help: "In the prototype (curves on the model are much tighter). Empty: straight." },
  { key: "rail_condition", label: "Rails", type: "select", default: "dry", options: Object.entries(RAIL_CONDITIONS).map(([k, c]) => [k, c.label]), help: "How well wheels grip the rails here: the adhesion for starting and braking." },
  { key: "braking_distance_m", label: "Braking distance of the line", type: "select", default: "1000", options: [["1000", "1000 m (main lines)"], ["700", "700 m"], ["400", "400 m (branch lines)"]], help: "From the distant signal to the main signal (Vorsignalabstand): the braking table of the line is for it." },
];

/** How far the open line beyond the layout runs to the next stop (m), where nothing says otherwise. */
export const NEXT_STOP_M = 4000;
/** Line speed beyond the layout where no track says one (km/h); at most the train's top speed. */
export const OPEN_LINE_KMH = 120;
/** Model millimetres within which the ends of two tracks join. */
const JOIN_MM = 25;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** A track's length in prototype metres: its own `length_m`, else its model length at the layout's scale. */
export function trackLength(track) {
  const g = track?.geometry;
  if (!g) return 0;
  const own = Number(track.spec.length_m);
  return own > 0 ? own : track.meters(g.total);
}

/** Prototype metres per model millimetre along a track. */
function metresPerMM(track) {
  return trackLength(track) / Math.max(1e-9, track.geometry.total);
}

/** The braking distance of the line on a track (m): `braking_distance_m`, else 1000 m. */
export function lineBrakingDistance(track) {
  const d = Number(track?.spec.braking_distance_m);
  return d > 0 ? d : 1000;
}

/**
 * The rail's condition on a track: a low-adhesion disruption on its platform track while it lasts,
 * else its own (`rail_condition`), else dry.
 * @param {import("../core/world.js").World} world
 * @param {object} track
 */
export function railCondition(world, track) {
  for (const d of world.disruptions?.active ?? []) {
    if (!d.def?.railCondition) continue;
    const dock = world.services?.docks.get(d.target)?.dock;
    if (dock?.track != null && String(dock.track) === String(track.spec.track_id)) return d.def.railCondition(d);
  }
  return RAIL_CONDITIONS[track.spec.rail_condition] ? track.spec.rail_condition : "dry";
}

/** The direction (unit) from an end of a track into it (`end` 0: from its first point, 1: from its last). */
function into(track, end) {
  const g = track.geometry, d = polylineAt(g.points, end ? Math.max(0, g.total - 1) : Math.min(g.total, 1), g.lengths).dir;
  return end ? [-d[0], -d[1]] : d;
}

/** The tracks whose end lies at an end of a track (`end` 0: its first point, 1: its last). */
function joining(world, track, end) {
  const p = track.geometry.points, at = end ? p[p.length - 1] : p[0];
  const out = [];
  for (const o of world.objects) {
    if (o === track || o.type !== "track" || !o.geometry) continue;
    const q = o.geometry.points;
    if (Math.hypot(q[0][0] - at[0], q[0][1] - at[1]) <= JOIN_MM) out.push({ track: o, end: 0 });
    else if (Math.hypot(q[q.length - 1][0] - at[0], q[q.length - 1][1] - at[1]) <= JOIN_MM) out.push({ track: o, end: 1 });
  }
  return out;
}

/**
 * The path ahead of a point on a track in a direction: the parts of the tracks it runs on (from_mm
 * and to_mm along each track, its direction there, s0 and s1 in metres from the start), as far as
 * `length_m` reaches or the tracks do; `ends`: the tracks end before (the rest lies beyond the layout).
 * Where several tracks join an end, it goes on along the one that turns least from the way the
 * train runs (never back the way it came).
 * @param {import("../core/world.js").World} world
 * @param {object} track
 * @param {number} at_mm
 * @param {number} dir +1 towards the track's last point, −1 towards its first
 * @param {number} length_m
 */
export function pathAhead(world, track, at_mm, dir, length_m) {
  const parts = [], seen = new Set();
  let cur = track, d = dir >= 0 ? 1 : -1, from = clamp(at_mm, 0, track.geometry.total), s = 0;
  while (cur?.geometry && s < length_m - 1e-6 && !seen.has(cur.id)) {
    seen.add(cur.id);
    const k = metresPerMM(cur), end = d > 0 ? cur.geometry.total : 0;
    const there = Math.abs(end - from) * k, take = Math.min(there, length_m - s);
    parts.push({ track: cur, from_mm: from, to_mm: from + (d * take) / k, dir: d, s0: s, s1: s + take });
    s += take;
    if (take < there - 1e-6) break;
    const out = d > 0 ? 1 : 0, way = into(cur, out).map((x) => -x);
    let next = null, best = 0;
    for (const x of joining(world, cur, out)) {
      if (seen.has(x.track.id)) continue;
      const v = into(x.track, x.end), dot = v[0] * way[0] + v[1] * way[1];
      if (dot > best) [next, best] = [x, dot];
    }
    if (!next) break;
    cur = next.track;
    d = next.end === 0 ? 1 : -1;
    from = next.end === 0 ? 0 : cur.geometry.total;
  }
  return { parts, length_m: s, ends: s < length_m - 1e-6 };
}

/** The layout point (mm) of a place along a path (m from its start), or null beyond it. */
export function pathPoint(path, s) {
  const p = path.parts.find((x) => s >= x.s0 - 1e-6 && s <= x.s1 + 1e-6);
  if (!p) return null;
  const g = p.track.geometry, mm = p.from_mm + (p.dir * (s - p.s0)) / metresPerMM(p.track);
  return polylineAt(g.points, mm, g.lengths);
}

/** The points (layout mm) of a stretch of a path, from s0 to s1 (m), part by part: [[points]…]. */
function stretch(path, s0, s1) {
  const out = [];
  for (const p of path.parts) {
    const a = Math.max(s0, p.s0), b = Math.min(s1, p.s1);
    if (b - a < 1e-6) continue;
    const g = p.track.geometry, k = metresPerMM(p.track);
    const mm0 = p.from_mm + (p.dir * (a - p.s0)) / k, mm1 = p.from_mm + (p.dir * (b - p.s0)) / k;
    // the track's own corners in between, in the direction of travel
    const corners = [];
    for (let i = 1; i < g.points.length - 1; i++) if ((g.lengths[i] - mm0) * (g.lengths[i] - mm1) < 0) corners.push(i);
    if (p.dir < 0) corners.reverse();
    out.push([polylineAt(g.points, mm0, g.lengths).point, ...corners.map((i) => g.points[i]), polylineAt(g.points, mm1, g.lengths).point]);
  }
  return out;
}

/**
 * The line of a run along a path (a rail/dynamics.js Line): a section per part with its track's line
 * speed (else {@link OPEN_LINE_KMH}), its gradient as the train runs, its curve and the rail's
 * condition; then `beyond_m` of line beyond the layout at `beyond_kmh` (else the last track's line speed).
 * @param {import("../core/world.js").World} world
 * @param {{parts: object[], length_m: number}} path
 * @param {{beyond_m?: number, beyond_kmh?: number | null, stop?: boolean}} [options]
 */
export function lineAlong(world, path, { beyond_m = 0, beyond_kmh = null, stop = true } = {}) {
  const sections = path.parts.map((p) => {
    const sp = p.track.spec, sys = sectionSystems(sp).values;
    return {
      s0: p.s0, s1: p.s1, kmh: sys.max_speed_kmh ?? OPEN_LINE_KMH, permille: (Number(sp.gradient_permille) || 0) * p.dir,
      radius_m: Number(sp.curve_radius_m) > 0 ? Number(sp.curve_radius_m) : null, condition: railCondition(world, p.track), power: sys.power, track: p.track.id,
    };
  });
  const L = path.length_m, last = sections[sections.length - 1];
  if (beyond_m > 0) sections.push({ s0: L, s1: L + beyond_m, kmh: beyond_kmh ?? last?.kmh ?? OPEN_LINE_KMH, permille: 0, radius_m: null, condition: "dry", power: last?.power ?? null, beyond: true });
  return { length_m: L + beyond_m, sections, stop, power: sections[0]?.power ?? null };
}

/** Each signal and PZB magnet of the layout on its nearest track, where along it (mm) and how far from it; kept until the layout changes. */
const BESIDE = new WeakMap();
function besideTracks(world) {
  const key = `${world.objectsVersion}:${world.map?.version}`, kept = BESIDE.get(world);
  if (kept?.key === key) return kept.list;
  const tracks = world.objects.filter((o) => o.type === "track" && o.geometry), list = [];
  for (const o of world.objects) {
    if (!o.geometry || !(o.type === "signal" || (o.type === "balise" && o.spec.pzb_hz))) continue;
    let best = null;
    for (const t of tracks) {
      const g = t.geometry, pr = polylineProject(g.points, o.geometry.center, g.lengths);
      if (!best || pr.distance < best.distance) best = { object: o, track: t, s_mm: pr.s, distance: pr.distance };
    }
    if (best) list.push(best);
  }
  BESIDE.set(world, { key, list });
  return list;
}

/** Where objects beside their nearest track (signals, magnets, within `within_m`) lie along a path (m), with the part of it. */
function alongPath(world, path, type, within_m) {
  const out = [];
  for (const b of besideTracks(world)) {
    if (b.object.type !== type || b.distance > b.track.mm(within_m)) continue;
    const p = path.parts.find((x) => x.track === b.track && b.s_mm >= Math.min(x.from_mm, x.to_mm) - 1e-6 && b.s_mm <= Math.max(x.from_mm, x.to_mm) + 1e-6);
    if (p) out.push({ ...b, part: p, s: p.s0 + Math.abs(b.s_mm - p.from_mm) * metresPerMM(p.track) });
  }
  return out;
}

/**
 * The signals beside a path that apply to the train: those of its tracks (each signal belongs to
 * the track nearest to it, within 8 m) whose local x, the direction they face, points along its
 * direction of travel; where they are along the path (m) and their kind, nearest first.
 * @param {import("../core/world.js").World} world
 * @param {{parts: object[]}} path
 * @returns {Array<{signal: object, s: number, kind: string}>}
 */
export function signalsAhead(world, path) {
  const out = [];
  for (const b of alongPath(world, path, "signal", 8)) {
    const g = b.track.geometry, dir = polylineAt(g.points, b.s_mm, g.lengths).dir, a = b.object.geometry.angle;
    if ((dir[0] * Math.cos(a) + dir[1] * Math.sin(a)) * b.part.dir <= 0) continue; // it faces the other way
    out.push({ signal: b.object, s: b.s, kind: b.object.spec.kind || "main" });
  }
  return out.sort((a, b) => a.s - b.s);
}

/**
 * The PZB magnets along a path: the balises placed on its tracks with a frequency (`pzb_hz`); where
 * none is placed on the path, those its signals imply: 1000 Hz at a distant signal (and at a main
 * signal with a distant signal for the next), 500 Hz 250 m before a main signal, 2000 Hz at it.
 * @returns {Array<{s: number, hz: string, placed: boolean}>}
 */
export function magnetsAhead(world, path, signals = signalsAhead(world, path)) {
  const out = alongPath(world, path, "balise", 3).map((b) => ({ s: b.s, hz: String(b.object.spec.pzb_hz), placed: true }));
  if (!out.length) {
    for (const sg of signals) {
      if (sg.kind === "distant" || sg.kind === "combined") out.push({ s: sg.s, hz: "1000", placed: false });
      if (sg.kind === "main" || sg.kind === "combined") {
        out.push({ s: sg.s, hz: "2000", placed: false });
        if (sg.s >= PZB_RULES.m500_before_m) out.push({ s: sg.s - PZB_RULES.m500_before_m, hz: "500", placed: false });
      }
    }
  }
  return out.sort((a, b) => a.s - b.s);
}

/* ---------------------------------------------------------------- a train on the layout */

/** The track object with a track id, or null. */
function trackById(world, id) {
  if (id == null) return null;
  return world.objects.find((o) => o.type === "track" && o.geometry && String(o.spec.track_id) === String(id)) ?? null;
}

/**
 * Where a train pointed at is on the layout: its track, its front (mm along the track), its
 * direction along it, its speed (km/h in the prototype) and its consist. A train at a platform comes
 * in braking to its stop, stands, and leaves accelerating (its speed from its run, not from the
 * animation); a train of the control system is where and as fast as it is reported.
 * @param {import("../core/world.js").World} world
 * @param {import("../core/pick.js").Pickable} hit
 * @returns {{track: object, at_mm: number, dir: number, v_kmh: number, consist: object, phase: string, stop_mm: number | null, approach_mm?: number} | null}
 *   phase: arriving, standing, departing (at a platform) or running, standing (control system)
 */
export function trainOnTrack(world, hit) {
  if (hit?.kind !== "train") return null;
  const r = hit.ref;
  if (hit.key.startsWith("feed:")) {
    const track = r?.path?.track;
    if (!track?.geometry || r.offset == null) return null;
    const consist = consistFor(world, { train: r.id, line: r.name });
    if (!consist?.vehicles.length) return null;
    const kmh = ((world.trains?._speed?.(r) ?? 0) * world.scale * 3.6) / 1000;
    return { track, at_mm: r.offset - (+track.spec.offset_start_mm || 0), dir: (r.direction ?? 1) >= 0 ? 1 : -1, v_kmh: kmh, consist, phase: kmh > 1 ? "running" : "standing", stop_mm: null };
  }
  if (!r?.dock) return null;
  const track = trackById(world, r.dock.track), consist = trainConsist(world, r);
  const pose = track ? trainPose(world, r) : null;
  if (!pose || !consist?.vehicles.length) return null;
  // it comes in over as far as it is long and 40 m more (rail/stock.js)
  return { track, at_mm: pose.head, dir: pose.dir, v_kmh: 0, consist, phase: r.phase === "arriving" ? "arriving" : r.phase === "departing" ? "departing" : "standing", stop_mm: pose.stop, approach_mm: (pose.length_m + 40) * pose.line.m };
}

/**
 * Everything about the track ahead of a train pointed at: where it is, its run from there (to a stop
 * beyond the layout {@link NEXT_STOP_M} on, or for a train coming in to its stop), its speed now,
 * its full braking distance from it (from the line speed while it stands), the next main signal and
 * the braking distance of the line, the system that supervises it there and, where that is PZB or
 * LZB, the PZB magnets. The run is kept on the train until it changes.
 * @param {import("../core/world.js").World} world
 * @param {import("../core/pick.js").Pickable} hit
 */
export function trackAheadOf(world, hit) {
  const on = trainOnTrack(world, hit);
  if (!on) return null;
  const { track, consist } = on;
  const sys = sectionSystems(track.spec).values;
  const model = trainModel(consist, { power: sys.power });
  const k = metresPerMM(track);
  const lineKmh = Math.min(model.vmax_kmh, sys.max_speed_kmh ?? OPEN_LINE_KMH);
  // the run: a train coming in to its stop; one at a platform from its stop on to the next stop
  // beyond the layout; a train of the control system from where it is
  let from = on.at_mm, reach = Math.max(NEXT_STOP_M, trackLength(track));
  if (on.phase === "arriving") {
    from = clamp(on.stop_mm - on.dir * on.approach_mm, 0, track.geometry.total);
    reach = Math.abs(on.stop_mm - from) * k;
  } else if (on.stop_mm != null) from = on.stop_mm;
  const path = pathAhead(world, track, from, on.dir, reach);
  const line = lineAlong(world, path, { beyond_m: on.phase === "arriving" || !path.ends ? 0 : Math.max(0, reach - path.length_m) });
  const condition = line.sections[0]?.condition ?? "dry";
  const permille = line.sections[0]?.permille ?? 0;
  // coming in, it is on the curve of its service braking to the stop
  const decel = serviceDeceleration(model, lineKmh, { condition });
  const onCurve = (m) => Math.min(lineKmh, Math.sqrt(2 * decel * Math.max(0, m)) * 3.6);
  const v0 = on.phase === "arriving" ? onCurve(reach) : on.phase === "running" ? on.v_kmh : 0;
  const key = `${world.objectsVersion}|${consist.summary}|${consist.brakePercentage.toFixed(1)}|${Math.round(v0)}|${JSON.stringify(line.sections.map((x) => [Math.round(x.s0), Math.round(x.s1), x.kmh, x.permille, x.radius_m, x.condition]))}`;
  if (hit.ref.aheadRun?.key !== key) hit.ref.aheadRun = { key, profile: runProfile(model, line, { v0_kmh: v0 }) };
  const profile = hit.ref.aheadRun.profile;
  // the speed now: where it is along its run (leaving its stop, coming in: on its braking curve,
  // also while its front is still beyond the end of the track), or as reported
  const moving = on.phase === "departing" || on.phase === "arriving";
  const s = moving ? (on.at_mm - from) * on.dir * k : 0;
  const v_kmh = on.phase === "arriving" && s < 0 ? onCurve(Math.abs(on.stop_mm - on.at_mm) * k) : moving ? speedAt(profile, s) : on.v_kmh;
  const reference = v_kmh > 1 ? v_kmh : lineKmh;
  const braking = fullBraking(model, reference, { permille, condition });
  // what lies ahead of the front: from where the train is now
  const ahead = pathAhead(world, track, on.at_mm, on.dir, Math.max(braking.distance_m, lineBrakingDistance(track)) + 50);
  const signals = signalsAhead(world, ahead);
  const main = signals.find((x) => x.kind === "main" || x.kind === "combined") ?? null;
  const control = supervision(consist, track.spec);
  return {
    on, model, line, profile, path, ahead, now_s: Math.max(0, s), v_kmh, condition, permille, line_kmh: lineKmh,
    braking: { from_kmh: reference, standing: !(v_kmh > 1), ...braking },
    // the PZB magnets where PZB supervises the train (on lines with LZB too)
    signals, main, magnets: control.system === "pzb" || control.system === "lzb" ? magnetsAhead(world, ahead, signals) : [], spacing_m: lineBrakingDistance(track),
    // the speed the line's braking distance allows the train (its braking table)
    table_kmh: brakingSpeed(lineBrakingDistance(track), consist.brakePercentage, permille),
    control, pzb: control.system === "pzb" ? pzbType(consist.brakePercentage) : null,
    etcs: control.system === "etcs" || control.system === "lzb" ? etcsCurves(model, main ? main.s : ahead.length_m, { permille, condition, vmax_kmh: lineKmh }) : null,
  };
}

/**
 * The pickable of a train as it is now, or null when it has gone. Its entry (`ref`) is kept up to
 * date in place; a train of the control system reported anew under its number has a new one.
 */
function trainNow(world, hit) {
  if (hit.key.startsWith("feed:")) {
    const t = world.trains?.trains.get(hit.key.slice(5));
    return !t ? null : t === hit.ref ? hit : { ...hit, ref: t };
  }
  if (hit.key.startsWith("vehicle:")) return world.services?.vehicles().includes(hit.ref) ? hit : null;
  return null;
}

/** The speed (km/h) of a run at a distance (m), between its samples. */
export function speedAt(profile, s) {
  const x = profile.samples;
  if (!x.length) return 0;
  if (s <= x[0].s) return x[0].v;
  for (let i = 1; i < x.length; i++) {
    if (x[i].s >= s) {
      const a = x[i - 1], b = x[i], f = (s - a.s) / Math.max(1e-9, b.s - a.s);
      return a.v + (b.v - a.v) * f;
    }
  }
  return x[x.length - 1].v;
}

/* ---------------------------------------------------------------- on the table */

/** The colour of a speed on the band: slow in Gelb, middle in Türkis, fast in Brillantblau. */
function speedColour(kmh, top) {
  const f = top > 0 ? kmh / top : 0;
  return f < 0.34 ? CD.gelb : f < 0.75 ? CD.tuerkis : CD.brillantblau;
}

/**
 * Draw the track ahead of the train whose card is open (`world.trackAhead`: {hit}), on the tracks it
 * runs on: the band of its expected speed with the marks top speed, braking and stop, its braking
 * distance (red where it reaches past the next main signal), the PZB magnets, the movement authority,
 * and a mark where its run goes on beyond the layout. Called by the tracks (objects/track.js) for
 * themselves, so each draws its own part.
 * @param {import("../core/view.js").View} view
 * @param {object} track
 */
export function drawTrackAhead(view, track) {
  const world = track.world, want = world.trackAhead;
  if (!want?.hit) return;
  // worked out once per frame (each frame draws with a new view) by the first track that draws,
  // also while the simulation is paused (a train of the control system moves on), and not again
  // when the train has gone
  if (want.view !== view) {
    want.view = view;
    const now = trainNow(world, want.hit);
    if (now) want.hit = now;
    want.result = now ? trackAheadOf(world, now) : null;
  }
  const a = want.result;
  if (!a) return;
  const m = view.m(1);
  const mine = (path) => ({ ...path, parts: path.parts.filter((p) => p.track === track) });
  // the expected speed of the run, in pieces of its colour, with its marks
  const run = mine(a.path), samples = a.profile.samples;
  if (run.parts.length) {
    const top = Math.max(1, a.profile.top_kmh);
    for (let i = 1; i < samples.length; i++) {
      for (const pts of stretch(run, samples[i - 1].s, samples[i].s)) view.ribbon(pts, m * 2.6, { fill: rgba(speedColour(samples[i].v, top), 0.55), order: 28 });
    }
    const mark = (s, text) => {
      if (!run.parts.some((p) => s >= p.s0 - 1e-6 && s <= p.s1 + 1e-6)) return;
      const at = pathPoint(a.path, s);
      if (at) view.label([at.point[0], at.point[1], m * 2], text, { size: 10, background: OVERLAY.label, optional: true, order: 3 });
    };
    if (a.profile.top_at_m > 0 && a.profile.top_at_m < a.path.length_m) mark(a.profile.top_at_m, `${Math.round(a.profile.top_kmh)} km/h`);
    if (a.profile.brake_from_m != null) mark(a.profile.brake_from_m, "braking");
    if (a.line.stop && a.line.length_m <= a.path.length_m + 1e-6) mark(a.line.length_m - 1e-3, "stop");
    // the driver advisory: where to coast (the card works it out, rail/running.js)
    const coast = want.hit.ref.aheadRun?.extras?.coast;
    if (coast?.coast_m != null) mark(coast.coast_m, "coast from here");
    // the run goes on beyond the tracks
    const last = a.path.parts[a.path.parts.length - 1];
    if (a.path.ends && last?.track === track) {
      const at = pathPoint(a.path, a.path.length_m);
      const rest = a.line.length_m - a.path.length_m;
      if (at && rest > 1) view.label([at.point[0], at.point[1], m * 3], `beyond the layout · ${formatDistance(rest)} more`, { size: 10, background: OVERLAY.label, order: 3 });
    }
  }
  // the braking distance from the train's front: red where it reaches past the next main signal
  const ahead = mine(a.ahead), b = a.braking;
  if (ahead.parts.length && Number.isFinite(b.distance_m)) {
    const limit = a.main ? a.main.s : a.spacing_m;
    const ok = Math.min(b.distance_m, limit), over = b.distance_m - limit;
    const style = { stroke: OVERLAY.selection, width: 3, order: 30, dash: b.standing ? [8, 6] : null };
    for (const pts of stretch(ahead, 0, ok)) view.line(pts, style);
    if (over > 0) for (const pts of stretch(ahead, limit, b.distance_m)) view.line(pts, { ...style, stroke: OVERLAY.danger, width: 4 });
    const end = pathPoint(a.ahead, Math.min(b.distance_m, a.ahead.length_m));
    if (end && ahead.parts.some((p) => Math.min(b.distance_m, a.ahead.length_m) <= p.s1 + 1e-6 && Math.min(b.distance_m, a.ahead.length_m) >= p.s0 - 1e-6)) {
      const text = `${b.standing ? `from ${Math.round(b.from_kmh)} km/h · ` : ""}stops in ${formatDistance(b.distance_m)}${over > 0 ? (a.main ? " · past the signal" : " · longer than the braking distance") : ""}`;
      view.label([end.point[0], end.point[1], m * 4], text, { size: 10, background: over > 0 ? OVERLAY.dangerLabel : OVERLAY.label, order: 4 });
    }
  }
  // where its brakes allow less than the line speed: the speed of the braking table, at its front
  if (ahead.parts[0]?.s0 === 0 && a.table_kmh < a.line_kmh - 0.5) {
    const at = pathPoint(a.ahead, 0);
    if (at) view.label([at.point[0], at.point[1], m * 6], `braking table: at most ${Math.floor(a.table_kmh)} km/h`, { size: 10, background: OVERLAY.dangerLabel, order: 4 });
  }
  // the PZB magnets and the end of the movement authority
  for (const g of a.magnets) {
    if (!ahead.parts.some((p) => g.s >= p.s0 - 1e-6 && g.s <= p.s1 + 1e-6)) continue;
    const at = pathPoint(a.ahead, g.s);
    if (!at) continue;
    const r = m * 1.4, [x, y] = at.point;
    view.polygon([[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]], { fill: rgba(CD.gelb, 0.95), stroke: "#000000", width: 1, order: 31 });
    view.label([x, y, m * 1.5], `${g.hz} Hz`, { size: 9, background: OVERLAY.label, optional: true, order: 2 });
  }
  // the movement authority of ETCS or LZB: a band to its end (the next main signal, else the tracks' end)
  if (a.etcs) for (const pts of stretch(ahead, 0, a.main ? a.main.s : a.ahead.length_m)) view.ribbon(pts, m * 4.4, { fill: rgba(CD.brillantblau, 0.22), order: 27 });
}

/** A distance as people read it: "820 m", "1.4 km". */
export function formatDistance(m) {
  if (!Number.isFinite(m)) return "–";
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;
}
