/**
 * The running dynamics of a train on its info card: its run (speed over distance and time over
 * distance with the line's limits, the minimum running time and the timetable's with its
 * supplement), its braking distance against the line's and the train protection that supervises it
 * (PZB with its curves at a distant signal, the braking curves of ETCS and LZB to an end of
 * authority assumed at its next stop), the adhesion and the forces in its couplings (on the strip of
 * its vehicles too), its energy and what coasting before the stop saves. The figures come from rail/dynamics.js and rail/protection.js for the train on its
 * track (rail/ahead.js); what takes long to work out is kept on the train until its run changes.
 * @module arail/rail/running
 */
import { formatDistance, trackAheadOf } from "./ahead.js";
import {
  COUPLER_KN, RAIL_CONDITIONS, SUPPLEMENT, adhesion, brakingSpeed, drivingStyles, loadLimit, runInForce, slips, startingForces, tractiveEffort,
} from "./dynamics.js";
import { PZB, PZB_RULES, pzbApproach } from "./protection.js";
import { consistOfHit } from "./trains.js";

/** The gradient the load limit is given for when the run is level (‰). */
export const REFERENCE_GRADIENT = 10;

/** A time as minutes and seconds: "3:02 min". */
export function minutesSeconds(s) {
  if (!Number.isFinite(s)) return "–";
  const t = Math.round(s), m = Math.floor(t / 60), r = t % 60;
  return `${m}:${String(r).padStart(2, "0")} min`;
}

/** One decimal for small numbers, none for large ones. */
const fig = (x) => (Math.abs(x) >= 100 ? String(Math.round(x)) : x.toFixed(1));
/** A gradient: whole numbers without decimals. */
const grade = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
/** The energy of a run as people compare it: kWh from the contact line, or litres of diesel. */
const amount = (e) => (e.electric ? `${fig(e.net_kwh)} kWh` : `${fig(e.fuel_l)} l`);
/** A braking distance in metres, to 10 m. */
const metres = (x) => (Number.isFinite(x) ? `${Math.round(x / 10) * 10} m` : "–");

/**
 * What takes long to work out, kept on the train with its run: coasting, the PZB approach, the
 * forces when starting and the load limit.
 */
function extras(a, hit) {
  const kept = hit.ref.aheadRun;
  if (kept?.extras) return kept.extras;
  const m = a.model, steepest = Math.max(0, ...a.line.sections.map((x) => x.permille || 0));
  const grade = steepest > 0 ? steepest : REFERENCE_GRADIENT;
  // driving styles for the run from a stop to the next (a train coming in or on the move has no
  // such run); as fast as possible, it is the run of the track ahead
  const fromStop = a.on.phase === "standing" || a.on.phase === "departing";
  const styles = fromStop && m.power_kw > 0 ? drivingStyles(m, a.line, { fast: a.profile }) : null;
  const out = {
    styles,
    coast: styles?.styles.find((x) => x.supplement === SUPPLEMENT)?.run ?? { coast: null },
    pzb: a.pzb ? pzbApproach(m, { v0_kmh: Math.min(a.line_kmh, PZB[a.pzb].vmax_kmh), distant_m: a.spacing_m, permille: a.permille, condition: a.condition }) : null,
    start: startingForces(m, { permille: grade, condition: a.condition }),
    limit: loadLimit(m, grade, { condition: a.condition }),
    limitSand: a.condition !== "dry" ? loadLimit(m, grade, { condition: a.condition, sanding: true }) : null,
    grade,
  };
  if (kept) kept.extras = out;
  return out;
}

/**
 * Card provider (registry.registerCard): the running dynamics of a train pointed at, on its track.
 * @param {import("../core/world.js").World} world
 * @param {import("../core/pick.js").Pickable} hit
 * @param {import("../core/pick.js").Card} card changed in place
 */
export function runningCard(world, hit, card) {
  if (hit.kind !== "train") return;
  const a = trackAheadOf(world, hit);
  if (!a) {
    if (consistOfHit(world, hit)?.vehicles.length) card.sections.push({ title: "Running dynamics", lines: ["Not on a track of the layout: the running dynamics need the train on a track (its platform's, or the one the control system reports)."] });
    return;
  }
  const x = extras(a, hit);
  // a train that cannot draw power here does not run by itself: its run and its brakes only
  const runs = a.model.power_kw > 0;
  card.sections.push(runSection(a), brakingSection(a, x), ...(runs ? [forcesSection(a, x), energySection(a, x)] : []));
  // the forces in the couplings when it starts, on the strip of its vehicles
  if (runs && card.strip?.length === a.model.vehicles.length && x.start.forces.length) {
    x.start.forces.forEach((f, i) => {
      card.strip[i].pull_kn = Math.round(f);
      card.strip[i].pull = f > COUPLER_KN.screw ? "high" : f > 0.6 * COUPLER_KN.screw ? "mid" : "low";
    });
  }
  if (a.profile.stalled_at_m != null && a.model.power_kw > 0) {
    card.tone = "bad";
    card.status = `${card.status ? `${card.status} · ` : ""}stalls on the gradient`;
  } else if (a.braking.distance_m > a.spacing_m && !a.braking.standing) {
    // it cannot stop within the line's braking distance (from the distant signal to the main
    // signal): faster than its braking table allows; what the signals show is not known
    card.tone = "bad";
    card.status = `${card.status ? `${card.status} · ` : ""}too fast for its brakes`;
  }
}

/** The run: where to, its running time, top speed and where it brakes, as charts of speed and time over distance. */
function runSection(a) {
  const p = a.profile, on = a.on;
  const layout = a.path.length_m, L = a.line.length_m;
  const where = on.phase === "arriving" ? "Coming in to its stop" : on.stop_mm == null ? "From here to the next stop" : "From its stop to the next one";
  const rows = [["Distance", `${where} · ${formatDistance(L)}${L - layout > 1 ? ` · ${formatDistance(layout)} on the layout` : ""}`]];
  if (a.v_kmh > 1) rows.push(["Speed now", `${Math.round(a.v_kmh)} km/h`]);
  // a train whose traction vehicles cannot draw the line's power does not move by itself
  if (!(a.model.power_kw > 0)) return { title: "Run", collapsible: true, open: true, rows: [...rows, ["Traction", "none here · no vehicle can draw the line's power"]] };
  if (p.stalled_at_m != null) rows.push(["Stalls", `after ${formatDistance(p.stalled_at_m)} · its traction cannot pull it up the gradient`]);
  else {
    rows.push(["Minimum running time", minutesSeconds(p.time_s)]);
    rows.push([`With ${Math.round(SUPPLEMENT * 100)} % supplement`, minutesSeconds(p.time_s * (1 + SUPPLEMENT))]);
  }
  if (on.phase !== "arriving") rows.push(["Top speed", `${Math.round(p.top_kmh)} km/h · after ${formatDistance(p.top_at_m)}`]);
  if (p.brake_from_m != null) rows.push(["Braking from", formatDistance(p.brake_from_m)]);
  const f0 = tractiveEffort(a.model, 0, { condition: a.condition });
  rows.push(["Tractive effort at the start", `${Math.round(f0)} kN${slips(a.model, 0, { condition: a.condition }) ? ` · of ${Math.round(a.model.start_kn)} kN · the adhesion limits it` : ""}`]);
  const limits = [];
  for (const x of a.line.sections) {
    const kmh = Math.min(a.model.vmax_kmh, x.kmh ?? a.model.vmax_kmh);
    limits.push([x.s0, kmh], [x.s1, kmh]);
  }
  const top = Math.max(10, ...limits.map((q) => q[1]), p.top_kmh);
  const marks = L - layout > 1 ? [{ x: layout, label: "end of the layout" }] : [];
  return {
    title: "Run",
    collapsible: true,
    open: true,
    rows,
    charts: [
      {
        label: "Speed over distance", x: { label: "Distance", unit: "m", max: L }, y: { label: "Speed", unit: "km/h", max: top },
        series: [{ label: "Permitted speed", points: limits, tone: "limit" }, { label: "Speed of the train", points: p.samples.map((q) => [q.s, q.v]), tone: "train" }],
        marks, now: on.phase === "departing" || on.phase === "arriving" || a.v_kmh > 1 ? { x: a.now_s, y: a.v_kmh } : null,
      },
      {
        label: "Time over distance", x: { label: "Distance", unit: "m", max: L }, y: { label: "Time", unit: "min", max: Math.max(0.5, (p.samples[p.samples.length - 1]?.t ?? 0) / 60) },
        series: [{ label: "Running time", points: p.samples.map((q) => [q.s, q.t / 60]), tone: "train" }],
        marks, now: null,
      },
    ],
  };
}

/** Braking: the full braking distance, the line's braking distance and the speed for it, the next signal, the train protection. */
function brakingSection(a, x) {
  const c = a.on.consist, b = a.braking, lambda = c.brakePercentage;
  const rows = [
    [`Full braking from ${Math.round(b.from_kmh)} km/h`, `${metres(b.distance_m)} · Minden formula${b.limited ? " · the adhesion limits it" : ""}`],
    ["Braking distance of the line", `${Math.round(a.spacing_m)} m`],
  ];
  const v = brakingSpeed(a.spacing_m, lambda, a.permille);
  rows.push(["Highest speed for it", `${Math.floor(v)} km/h · with ${Math.round(lambda)} %${v < a.line_kmh ? ` · less than the line speed (${Math.round(a.line_kmh)} km/h)` : ""}`]);
  // information: what the signal shows is not known (if it showed stop, it would need to be farther)
  const within = a.main && !b.standing && b.distance_m > a.main.s;
  rows.push(["Next main signal", a.main ? `${a.main.signal.name} · in ${metres(a.main.s)}${within ? " · within its braking distance" : ""}` : "none ahead on the layout"]);
  rows.push(["Train protection here", a.control.name]);
  const charts = [];
  if (a.pzb && x.pzb) {
    const t = PZB[a.pzb];
    rows.push(["Train type", `${t.label} · up to ${t.vmax_kmh} km/h`]);
    rows.push(["After 1000 Hz", `${t.vmax_kmh} → ${t.v1000_kmh} km/h in ${t.t1000_s} s`]);
    rows.push(["After 500 Hz", `${t.v500_kmh[0]} → ${t.v500_kmh[1]} km/h in ${PZB_RULES.curve500_m} m`]);
    const z = x.pzb;
    rows.push(["Distant signal at caution", z.forced ? `PZB brakes it · faster than the curve after ${Math.round(z.forced.t)} s at ${Math.round(z.forced.v)} km/h` : `braking with ${z.decel.toFixed(2)} m/s² · it keeps below the curves`]);
    charts.push({
      label: "PZB from the distant signal to the main signal", x: { label: "Distance", unit: "m", max: Math.max(a.spacing_m, z.stop_m) }, y: { label: "Speed", unit: "km/h", max: t.vmax_kmh + 5 },
      series: [{ label: "PZB permits", points: z.samples.map((q) => [q.s, Math.min(q.limit, t.vmax_kmh)]), tone: "limit" }, { label: "Speed of the train", points: z.samples.map((q) => [q.s, q.v]), tone: z.forced ? "warn" : "train" }],
      marks: [{ x: 0, label: "1000 Hz" }, { x: Math.max(0, a.spacing_m - PZB_RULES.m500_before_m), label: "500 Hz" }, { x: a.spacing_m, label: "signal, 2000 Hz" }],
      now: null,
    });
  } else if (a.etcs) {
    const e = a.etcs, last = e.points[e.points.length - 1]?.s ?? 0;
    rows.push(["Movement authority", `${metres(last)} to its end · assumed at ${a.on.phase === "arriving" ? "its stop" : "its next stop"}`]);
    rows.push(["Permitted here", `${Math.round(e.points[0]?.p ?? 0)} km/h · intervention at ${Math.round(e.points[0]?.ebi ?? 0)} km/h`]);
    charts.push({
      label: `${a.control.name}: braking curves to the end of authority`, x: { label: "Distance", unit: "m", max: last }, y: { label: "Speed", unit: "km/h", max: Math.max(20, ...e.points.map((q) => q.ebd)) },
      series: [
        { label: "EBD", points: e.points.map((q) => [q.s, q.ebd]), tone: "muted" },
        { label: "EBI", points: e.points.map((q) => [q.s, q.ebi]), tone: "brake" },
        { label: "Warning", points: e.points.map((q) => [q.s, q.w]), tone: "warn" },
        { label: "Permitted speed", points: e.points.map((q) => [q.s, q.p]), tone: "limit" },
      ],
      marks: [{ x: last, label: "end of authority" }], now: { x: 0, y: a.v_kmh },
    });
  }
  return { title: "Braking and train protection", collapsible: true, open: false, rows, charts };
}

/** Adhesion and forces: the rails, the starting tractive effort, the load limit, the couplings, run-in when braking. */
function forcesSection(a, x) {
  const m = a.model, cond = RAIL_CONDITIONS[a.condition] ?? RAIL_CONDITIONS.dry;
  const rows = [["Rails", `${cond.label} · adhesion ${adhesion(0, a.condition).toFixed(2)} at a standstill`]];
  if (a.condition !== "dry") rows.push(["With sand", `adhesion ${adhesion(0, a.condition, { sanding: true }).toFixed(2)} · ${Math.round(tractiveEffort(m, 0, { condition: a.condition, sanding: true }))} kN at the start`]);
  const by = { adhesion: "by the adhesion", "tractive effort": "by its tractive effort", coupling: "by the coupling" }[x.limit.by];
  rows.push(["Load limit", `${Math.round(x.limit.limit_t)} t on ${grade(x.grade)} ‰ · ${by}`]);
  if (x.limitSand) rows.push(["Load limit with sand", `${Math.round(x.limitSand.limit_t)} t`]);
  if (x.start.at >= 0) rows.push(["Coupler force", `${Math.round(x.start.max_kn)} kN at coupling ${x.start.at + 1} · starting on ${grade(x.grade)} ‰ · ${COUPLER_KN.screw} kN allowed${x.start.max_kn > COUPLER_KN.screw ? " · the coupling would break (train parting)" : ""}`]);
  if (m.vehicles.length > 1) rows.push(["Run-in force", `when braking · ${Math.round(runInForce(m, { position: "G" }))} kN in G · ${Math.round(runInForce(m, { position: "P" }))} kN in P`]);
  return { title: "Adhesion and forces", collapsible: true, open: false, rows };
}

/** Energy: for the run, per train-km and seat-km, fed back, diesel and CO₂; coasting before the stop. */
function energySection(a, x) {
  const e = a.profile.energy, km = Math.max(0.001, a.line.length_m / 1000);
  const rows = [];
  if (e.electric) {
    rows.push(["Energy for the run", `${fig(e.net_kwh)} kWh from the contact line`]);
    rows.push(["Per train-km", `${fig(e.per_km_kwh)} kWh`]);
    if (e.per_seat_km_wh > 0) rows.push(["Per seat-km", `${fig(e.per_seat_km_wh)} Wh`]);
    if (e.regen_kwh > 0) rows.push(["Fed back by braking", `${fig(e.regen_kwh)} kWh`]);
  } else {
    rows.push(["Diesel for the run", `${fig(e.fuel_l)} l · ${fig(e.co2_kg)} kg CO₂`]);
    rows.push(["Per train-km", `${(e.fuel_l / km).toFixed(2)} l`]);
  }
  const c = x.coast, charts = [], lines = [];
  // the driving styles: as fast as possible, and coasting within more and more supplement
  if (x.styles) {
    const f = x.styles.fast;
    lines.push(`As fast as possible · ${minutesSeconds(f.time_s)} · ${amount(f.energy)}`);
    for (const st of x.styles.styles) {
      const r = st.run;
      if (!r.coast) continue;
      lines.push(`Coasting within ${Math.round(st.supplement * 100)} % supplement · ${minutesSeconds(r.coast.time_s)} · ${amount(r.coast.energy)} · ${Math.round(r.saving_share * 100)} % less`);
    }
  }
  if (c.coast) {
    const saved = a.model.electric ? `${fig(c.saving_kwh)} kWh` : `${fig(c.fast.energy.fuel_l - c.coast.energy.fuel_l)} l`;
    rows.push(["Coasting", `from ${formatDistance(c.coast_m)} to the stop · ${Math.round(c.extra_s)} s longer · ${saved} less (${Math.round(c.saving_share * 100)} %)`]);
    charts.push({
      label: "As fast as possible and with coasting", x: { label: "Distance", unit: "m", max: a.line.length_m }, y: { label: "Speed", unit: "km/h", max: Math.max(10, c.fast.top_kmh) },
      series: [{ label: "As fast as possible", points: c.fast.samples.map((q) => [q.s, q.v]), tone: "muted" }, { label: "With coasting", points: c.coast.samples.map((q) => [q.s, q.v]), tone: "train" }],
      marks: [{ x: c.coast_m, label: "coast" }], now: null,
    });
  }
  return { title: "Energy and driving style", collapsible: true, open: false, rows, lines, charts };
}
