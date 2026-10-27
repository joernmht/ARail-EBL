/**
 * Running dynamics of trains: the forces on a train (tractive effort, running resistance, gradients
 * and curves, brakes, adhesion), its speed along a line, its running time, the forces in its
 * couplings and the energy it takes. Deterministic and without the DOM, so it runs in Node too.
 *
 * The methods are those of running-time calculations, simplified for teaching, with typical values:
 * - **Tractive effort** of a traction vehicle: its starting tractive effort (`tractive_kn`) up to the
 *   speed where its power (`power_kw`, at the wheel) is reached, then power / speed (the hyperbola of
 *   the tractive effort–speed diagram); never more than the adhesion carries on its driven axles.
 * - **Running resistance** of every vehicle by Strahl's formula, w = 2.5 + k·((v + Δv)/10)² N/kN with
 *   v and Δv = 12 km/h (head wind) in km/h; k by the kind of vehicle and its load ({@link STRAHL}).
 * - **Gradients**: i ‰ is i N/kN (positive uphill); **curves** by Röckl's formula for standard gauge,
 *   650/(r − 55) N/kN for r ≥ 300 m, 500/(r − 30) N/kN below.
 * - **Rotating masses**: a mass factor per vehicle ({@link MASS_FACTORS}), averaged by mass.
 * - **Adhesion** after Curtius and Kniffler, μ = 7.5/(v + 44) + 0.161 on dry, clean rails, a share of
 *   it on wet rails, leaves and ice ({@link RAIL_CONDITIONS}).
 * - **Braking**: a service braking deceleration for running times ({@link SERVICE_BRAKE}); the full
 *   braking distance by the Minden formula ({@link brakingDistance}).
 * - **Energy**: traction from force × distance, auxiliary power over time, regenerative braking fed
 *   back where the line takes it ({@link ENERGY}).
 *
 * Distances are prototype metres along the run, speeds km/h at the interfaces and m/s inside,
 * forces kN, masses t (so kN / t = m/s²).
 * @module arail/rail/dynamics
 */
import { Consist, VEHICLE_KINDS } from "./vehicles.js";

/** Gravity (m/s²). */
export const G = 9.81;

/**
 * Mass factors for the rotating masses (wheelsets, motors, gears) by the kind of vehicle; a wagon goes
 * from `wagon` loaded to `empty_wagon` empty. Typical ranges: locomotives 1.15–1.30, multiple units
 * and railcars 1.08–1.14, coaches and loaded wagons 1.02–1.04, empty wagons 1.05–1.12.
 */
export const MASS_FACTORS = { locomotive: 1.15, "multiple-unit": 1.1, railcar: 1.1, coach: 1.04, wagon: 1.04, empty_wagon: 1.08 };

/**
 * Strahl's formula, w = base + k·((v + wind)/10)² N/kN. k after Strahl for coaches with four axles and
 * loaded freight wagons 0.025, mixed freight trains 0.05, empty wagons 0.1 (a wagon goes from `wagon`
 * loaded to `empty_wagon` empty); for locomotives and units typical values of the same form.
 */
export const STRAHL = { base: 2.5, wind_kmh: 12, k: { locomotive: 0.05, "multiple-unit": 0.03, railcar: 0.03, coach: 0.025, wagon: 0.025, empty_wagon: 0.1 } };

/**
 * The rail's condition: its adhesion as a share of that of dry, clean rails (typical values; at a
 * standstill about 0.33 dry, 0.2 wet, 0.05 with leaves, 0.08 on ice).
 */
export const RAIL_CONDITIONS = {
  dry: { label: "Dry", factor: 1 },
  wet: { label: "Wet", factor: 0.6 },
  leaves: { label: "Leaves on the rails", factor: 0.15 },
  ice: { label: "Ice", factor: 0.25 },
};

/** Sand raises a low adhesion by this factor, at most to that of dry rails. */
export const SANDING = 1.6;

/** Service braking for running times (m/s², typical) by brake position. */
export const SERVICE_BRAKE = { G: 0.3, P: 0.5, R: 0.6, "R+Mg": 0.6 };

/**
 * The Minden formula of the braking distance (Mindener Bremswegformel, after Sauthoff, for
 * conventional brakes): s = a·v² / (b·ψ·(1 + λ/10) + i) m, v in km/h, λ the brake percentage, i the
 * gradient in ‰; ψ by the kind of brake, about 0.9 to 1.1 (1 here).
 */
export const MINDEN = { a: 3.85, b: 6.1, psi: 1 };

/**
 * Seconds the brake cylinders take to fill, by brake position (typical: G 18–30 s, P 3–5 s), for
 * the run-in force; the braking curves of ETCS take an equivalent build-up time instead
 * (rail/protection.js `ETCS_CURVES.build_s`).
 */
export const BRAKE_FILL_S = { G: 22, P: 4, R: 3, "R+Mg": 3 };

/** Speed (m/s) at which the brake signal travels along the brake pipe. */
export const BRAKE_SIGNAL_MPS = 250;

/** Working limits of couplings (kN): the UIC screw coupling, a reinforced one, automatic couplers. */
export const COUPLER_KN = { screw: 450, reinforced: 500, automatic: 850 };

/** Starting resistance of a train (N/kN, typical for roller bearings). */
export const START_RESISTANCE = 4;

/**
 * Energy: the efficiency of electric traction (from the contact line to the wheel), of feeding back
 * when braking (from the wheel to the contact line), the share of it the line takes (AC: the
 * substations feed back; DC: only when another train takes it), and for diesel traction the
 * efficiency of the engine and of the transmission, the energy and the CO₂ of a litre of diesel.
 */
export const ENERGY = {
  electric: 0.85,
  regen: 0.8,
  receptive: { ac: 1, dc: 0.5 },
  diesel: { engine: 0.36, transmission: 0.8, kwh_per_l: 9.9, co2_kg_per_l: 2.64 },
};

/** Running-time supplement (share of the minimum running time) the timetable plans with. */
export const SUPPLEMENT = 0.05;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const kindOf = (v) => (v.t.kind === "wagon" && v.t.load_t > 0 && v.loaded < 0.5 ? "empty_wagon" : v.t.kind);

/**
 * Can a traction vehicle draw power here? A diesel always; an electric one where the line's power
 * is one of its systems (`power` null: not known, it can).
 */
function draws(t, power) {
  if (!t.power?.length) return true;
  if (power == null || power === "") return true;
  return power !== "none" && t.power.includes(power);
}

/**
 * The figures of a consist that its running dynamics need: mass and mass factor, the tractive
 * effort and power of the traction vehicles that can draw the line's power, the mass on their driven
 * axles, the regenerative brake force, the auxiliary power, the brakes and every vehicle's mass,
 * mass factor and Strahl coefficient.
 * @param {Consist} consist
 * @param {{power?: string | null}} [options] the traction power of the line ("ac15"); null: every
 *   traction vehicle draws power
 */
export function trainModel(consist, { power = null } = {}) {
  let mass = 0, effective = 0, power_kw = 0, start_kn = 0, adhesion_t = 0, regen_kn = 0, aux_kw = 0, traction_t = 0;
  let electric = false, diesel = false, mg = 0;
  const vehicles = [];
  for (const v of consist.vehicles) {
    const t = v.t, m = Consist.massOf(v);
    // wagons from loaded to empty: the mass factor and Strahl's k go up as the load goes down
    const empty = t.kind === "wagon" && t.load_t > 0 ? 1 - v.loaded : 0;
    const factor = t.kind === "wagon" ? MASS_FACTORS.wagon + (MASS_FACTORS.empty_wagon - MASS_FACTORS.wagon) * empty : MASS_FACTORS[t.kind] ?? 1.05;
    const k = t.kind === "wagon" ? STRAHL.k.wagon + (STRAHL.k.empty_wagon - STRAHL.k.wagon) * empty : STRAHL.k[t.kind] ?? 0.03;
    const traction = !!VEHICLE_KINDS[t.kind]?.traction;
    const works = traction && draws(t, power) && t.power_kw > 0;
    const driven = works ? m * clamp((t.driven_axles ?? t.axles) / t.axles, 0, 1) : 0;
    const kn = works ? (t.tractive_kn > 0 ? t.tractive_kn : 0.3 * driven * G) : 0;
    mass += m;
    effective += m * factor;
    aux_kw += t.aux_kw || 0;
    if (works) {
      power_kw += t.power_kw;
      start_kn += kn;
      adhesion_t += driven;
      if (t.power?.length) {
        electric = true;
        regen_kn += t.regen_kn || 0;
      } else diesel = true;
    }
    if (traction) traction_t += m;
    if (consist.brakePosition === "R+Mg" && !v.isolated && t.brake_t?.["R+Mg"] != null && t.brake_t.R != null) mg += t.brake_t["R+Mg"] - t.brake_t.R;
    vehicles.push({ label: t.label.split(" (")[0], kind: kindOf(v), mass_t: m, factor, k, length_m: t.length_m, traction: works ? kn : 0, traction_vehicle: traction });
  }
  const brakeWeight = consist.brakeWeight_t;
  return {
    name: consist.name,
    mass_t: mass,
    mass_factor: mass > 0 ? effective / mass : 1,
    length_m: consist.length_m,
    seats: consist.seats,
    vmax_kmh: consist.vmax.kmh || 100,
    power_kw, start_kn, adhesion_t, regen_kn, aux_kw, traction_t, electric, diesel,
    brake: { position: consist.brakePosition, percentage: consist.brakePercentage, mg_share: brakeWeight > 0 ? mg / brakeWeight : 0 },
    vehicles,
  };
}

/* ---------------------------------------------------------------- forces */

/**
 * The adhesion coefficient at a speed on rails in a condition: Curtius and Kniffler for dry rails,
 * a share of it for the others; sand raises a low one.
 * @param {number} v_kmh
 * @param {string} [condition] dry, wet, leaves or ice ({@link RAIL_CONDITIONS})
 * @param {{sanding?: boolean}} [options]
 */
export function adhesion(v_kmh, condition = "dry", { sanding = false } = {}) {
  const dry = 7.5 / (Math.max(0, v_kmh) + 44) + 0.161;
  const f = (RAIL_CONDITIONS[condition] ?? RAIL_CONDITIONS.dry).factor;
  return dry * (sanding && f < 1 ? Math.min(1, f * SANDING) : f);
}

/**
 * The tractive effort (kN) the train can exert at a speed: the starting tractive effort, then power /
 * speed, at most the adhesion on the driven axles.
 * @param {object} model {@link trainModel}
 * @param {number} v_kmh
 * @param {{condition?: string, sanding?: boolean}} [options]
 */
export function tractiveEffort(model, v_kmh, { condition = "dry", sanding = false } = {}) {
  if (!(model.power_kw > 0) || !(model.start_kn > 0)) return 0;
  const v = Math.max(0, v_kmh) / 3.6;
  const byPower = v > 0.01 ? model.power_kw / v : Infinity;
  const grip = adhesion(v_kmh, condition, { sanding }) * model.adhesion_t * G;
  return Math.max(0, Math.min(model.start_kn, byPower, grip));
}

/** Does the adhesion, not the traction, limit the tractive effort at this speed? */
export function slips(model, v_kmh, { condition = "dry", sanding = false } = {}) {
  if (!(model.power_kw > 0)) return false;
  const v = Math.max(0, v_kmh) / 3.6;
  const traction = Math.min(model.start_kn, v > 0.01 ? model.power_kw / v : Infinity);
  return adhesion(v_kmh, condition, { sanding }) * model.adhesion_t * G < traction - 1e-9;
}

/**
 * Running resistance (kN) at a speed: Strahl's formula for each vehicle.
 * @param {object} model
 * @param {number} v_kmh
 */
export function runningResistance(model, v_kmh) {
  const x = (Math.max(0, v_kmh) + STRAHL.wind_kmh) / 10;
  let kn = 0;
  for (const v of model.vehicles) kn += (v.mass_t * G * (STRAHL.base + v.k * x * x)) / 1000;
  return kn;
}

/**
 * Curve resistance (N/kN) by Röckl's formula for standard gauge; 0 on straight track.
 * @param {number | null | undefined} radius_m
 */
export function curveResistance(radius_m) {
  const r = Number(radius_m);
  if (!(r > 0)) return 0;
  return r >= 300 ? 650 / (r - 55) : 500 / Math.max(10, r - 30);
}

/**
 * The force (kN) of a gradient and a curve on the whole train: mass × g × (i + curve resistance).
 * @param {object} model
 * @param {number} [permille] gradient, positive uphill
 * @param {number | null} [radius_m]
 */
export function lineResistance(model, permille = 0, radius_m = null) {
  return (model.mass_t * G * ((Number(permille) || 0) + curveResistance(radius_m))) / 1000;
}

/** The regenerative brake force (kN) at a speed: the vehicles' own, at most their power / speed. */
export function regenForce(model, v_kmh) {
  if (!(model.regen_kn > 0)) return 0;
  const v = Math.max(0.1, v_kmh / 3.6);
  return Math.min(model.regen_kn, model.power_kw / v);
}

/* ---------------------------------------------------------------- braking */

/** The deceleration the brakes give in the Minden formula (N/kN of weight): b·ψ·(1 + λ/10). */
function mindenDecel(lambda, psi = MINDEN.psi) {
  return MINDEN.b * psi * (1 + Math.max(0, Number(lambda) || 0) / 10);
}

/**
 * The full braking distance (m) from a speed by the Minden formula, s = 3.85·v² / (6.1·ψ·(1 + λ/10) + i):
 * v in km/h, λ the brake percentage, i the gradient in ‰ (negative downhill), ψ about 1.
 * @param {number} v_kmh
 * @param {number} lambda brake percentage
 * @param {number} [permille]
 * @param {number} [psi]
 */
export function brakingDistance(v_kmh, lambda, permille = 0, psi = MINDEN.psi) {
  const d = mindenDecel(lambda, psi) + (Number(permille) || 0);
  if (!(d > 0)) return Infinity;
  return (MINDEN.a * v_kmh * v_kmh) / d;
}

/**
 * The highest speed (km/h) from which a train stops within a distance: the Minden formula solved for
 * v, the speed a braking table gives for a brake percentage and a braking distance.
 * @param {number} distance_m
 * @param {number} lambda brake percentage
 * @param {number} [permille]
 * @param {number} [psi]
 */
export function brakingSpeed(distance_m, lambda, permille = 0, psi = MINDEN.psi) {
  const d = mindenDecel(lambda, psi) + (Number(permille) || 0);
  if (!(d > 0) || !(distance_m > 0)) return 0;
  return Math.sqrt((distance_m * d) / MINDEN.a);
}

/**
 * The brake percentage a train needs to stop from a speed within a distance (the Minden formula
 * solved for λ): the minimum brake percentage of a braking table.
 * @param {number} v_kmh
 * @param {number} distance_m
 * @param {number} [permille]
 * @param {number} [psi]
 */
export function requiredBrakePercentage(v_kmh, distance_m, permille = 0, psi = MINDEN.psi) {
  if (!(distance_m > 0)) return Infinity;
  const d = (MINDEN.a * v_kmh * v_kmh) / distance_m - (Number(permille) || 0);
  return Math.max(0, (d / (MINDEN.b * psi) - 1) * 10);
}

/**
 * Full braking of a train from a speed, as the Minden formula has it, within the adhesion of the
 * rails: the brakes on the wheels cannot decelerate more than the adhesion at half the speed allows;
 * a magnetic track brake (R+Mg) brakes on the rail itself.
 * @param {object} model
 * @param {number} v_kmh
 * @param {{permille?: number, condition?: string, sanding?: boolean}} [options]
 * @returns {{distance_m: number, decel: number, limited: boolean}} the distance, the mean
 *   deceleration (m/s²) and whether the adhesion limits it
 */
export function fullBraking(model, v_kmh, { permille = 0, condition = "dry", sanding = false } = {}) {
  const brakes = mindenDecel(model.brake.percentage);
  const mg = clamp(model.brake.mg_share || 0, 0, 1);
  // what the wheels brake needs the adhesion (μ · 1000 N/kN); the magnetic track brake does not
  const grip = adhesion(v_kmh / 2, condition, { sanding }) * 1000;
  const d = Math.min(brakes * (1 - mg), grip) + brakes * mg;
  const total = d + (Number(permille) || 0);
  if (!(total > 0) || !(v_kmh > 0)) return { distance_m: v_kmh > 0 ? Infinity : 0, decel: Math.max(0, total) / 99.8, limited: d < brakes - 1e-9 };
  return { distance_m: (MINDEN.a * v_kmh * v_kmh) / total, decel: total / 99.8, limited: d < brakes - 1e-9 };
}

/**
 * The deceleration (m/s²) of service braking: by the brake position, within what the brakes can do
 * and the adhesion (a service braking does not use the magnetic track brake).
 * @param {object} model
 * @param {number} v_kmh
 * @param {{condition?: string, sanding?: boolean}} [options]
 */
export function serviceDeceleration(model, v_kmh, { condition = "dry", sanding = false } = {}) {
  const want = SERVICE_BRAKE[model.brake.position] ?? SERVICE_BRAKE.P;
  const brakes = mindenDecel(model.brake.percentage) / 99.8;
  return Math.max(0.05, Math.min(want, brakes, adhesion(v_kmh, condition, { sanding }) * G));
}

/* ---------------------------------------------------------------- a run along a line */

/**
 * A line for a run: its length and its sections, each from s0 to s1 (m along the run) with a speed
 * limit (km/h; none: the train's top speed), a gradient (‰, positive uphill), a curve radius (m;
 * none: straight), the rail's condition and the traction power.
 * @typedef {object} Line
 * @property {number} length_m
 * @property {Array<{s0: number, s1: number, kmh?: number | null, permille?: number, radius_m?: number | null, condition?: string}>} sections
 * @property {boolean} [stop] the train stops at the end (default); false: it runs on at the limit
 * @property {string | null} [power] the traction power ("ac15"; null: not known)
 */

/** The section of a line at s (the last one beyond its end), or null. */
export function sectionAt(line, s) {
  const list = line.sections || [];
  for (const x of list) if (s >= x.s0 - 1e-9 && s < x.s1) return x;
  return list[list.length - 1] ?? null;
}

/** Thin a list of samples to at most `n` points (keeping the first and the last). */
function thin(points, n) {
  if (points.length <= n) return points;
  const out = [];
  const step = (points.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/**
 * A train's run along a line: its speed over the distance, as fast as its traction and the limits
 * allow (each limit until the end of the train has passed it), braking with the service brake for
 * lower limits ahead and for the stop at the end; with `coast_m` without traction from there
 * (coasting before the stop). Integrated in steps of distance.
 * @param {object} model {@link trainModel}
 * @param {Line} line
 * @param {{v0_kmh?: number, coast_m?: number | null, step_m?: number | null, sanding?: boolean, samples?: number}} [options]
 *   v0_kmh: the speed at the start; samples: at most that many points in `samples`
 * @returns {{length_m: number, time_s: number, stalled_at_m: number | null, top_kmh: number, top_at_m: number,
 *   brake_from_m: number | null, samples: Array<{s: number, t: number, v: number, phase: string}>,
 *   energy: object}} samples: s m, t s, v km/h; phase: traction, cruise, coast or brake
 */
export function runProfile(model, line, { v0_kmh = 0, coast_m = null, step_m = null, sanding = false, samples = 400 } = {}) {
  const L = Math.max(1, Number(line.length_m) || 1);
  // a train without vehicles does not run
  if (!(model.mass_t > 0)) {
    const energy = energyFigures(model, line, { traction_kj: 0, braking_kj: 0, regen_kj: 0, aux_kj: 0, length_m: 0 });
    return { length_m: L, time_s: Infinity, stalled_at_m: 0, top_kmh: 0, top_at_m: 0, brake_from_m: null, samples: [{ s: 0, t: 0, v: 0, phase: "traction" }], energy };
  }
  const n = Math.max(2, Math.ceil(L / (step_m ?? clamp(L / 800, 1, 10)))), d = L / n;
  const xs = Array.from({ length: n + 1 }, (_, i) => i * d);
  const sec = xs.map((s) => sectionAt(line, Math.min(L - 1e-6, s)));
  const top = (model.vmax_kmh || 100) / 3.6;
  const own = sec.map((x) => Math.min(top, x?.kmh > 0 ? x.kmh / 3.6 : top));
  // a limit holds until the end of the train has passed it: the lowest over the train's length behind
  const back = Math.max(0, Math.round((model.length_m || 0) / d));
  const lim = own.map((_, i) => {
    let v = own[i];
    for (let j = Math.max(0, i - back); j < i; j++) v = Math.min(v, own[j]);
    return v;
  });
  const m = model.mass_t * model.mass_factor;
  const slope = sec.map((x) => lineResistance(model, x?.permille, x?.radius_m));
  const coasting = (i) => coast_m != null && xs[i] >= coast_m;
  // forward: as fast as the traction and the limits allow (no traction from coast_m on)
  const vf = new Float64Array(n + 1);
  vf[0] = Math.min(lim[0], Math.max(0, (Number(v0_kmh) || 0) / 3.6));
  for (let i = 0; i < n; i++) {
    const v = vf[i], kmh = v * 3.6;
    const ft = coasting(i) ? 0 : tractiveEffort(model, kmh, { condition: sec[i]?.condition, sanding });
    const a = (ft - runningResistance(model, kmh) - slope[i]) / m;
    vf[i + 1] = Math.min(lim[i + 1], Math.sqrt(Math.max(0, v * v + 2 * a * d)));
  }
  // backward: braking for the stop at the end and for lower limits ahead
  const vb = new Float64Array(n + 1);
  vb[n] = line.stop === false ? lim[n] : 0;
  for (let i = n - 1; i >= 0; i--) {
    const v = vb[i + 1], kmh = v * 3.6;
    const decel = serviceDeceleration(model, kmh, { condition: sec[i]?.condition, sanding }) + (runningResistance(model, kmh) + slope[i]) / m;
    vb[i] = Math.min(lim[i], Math.sqrt(v * v + 2 * Math.max(0.02, decel) * d));
  }
  const v = Array.from({ length: n + 1 }, (_, i) => Math.min(vf[i], vb[i]));
  // times, phases and energy (kJ = kN·m)
  const out = [{ s: 0, t: 0, v: v[0] * 3.6, phase: "traction" }];
  let t = 0, stalled = null, topV = 0, topAt = 0, brakeFrom = null;
  let trac = 0, brake = 0, regen = 0, aux = 0;
  for (let i = 0; i < n; i++) {
    const a0 = v[i], a1 = v[i + 1], vm = (a0 + a1) / 2;
    if (vm < 0.03 && (i + 1 < n || line.stop === false)) {
      stalled = xs[i];
      break;
    }
    const dt = d / Math.max(vm, 0.03);
    t += dt;
    const acc = (a1 * a1 - a0 * a0) / (2 * d);
    const need = m * acc + runningResistance(model, vm * 3.6) + slope[i];
    const braking = vb[i + 1] < vf[i + 1] - 1e-6;
    const phase = braking ? "brake" : coasting(i) ? "coast" : a0 >= lim[i] - 0.01 && a1 >= lim[i + 1] - 0.01 ? "cruise" : "traction";
    if (phase === "brake" || need < 0) {
      // the brakes take what the resistances do not; the electric brake feeds back what it can
      const f = Math.max(0, -need);
      brake += f * d;
      regen += Math.min(f, regenForce(model, vm * 3.6)) * d;
      if (phase === "brake" && brakeFrom == null) brakeFrom = xs[i];
    } else if (phase !== "coast") trac += need * d;
    if (phase !== "brake") brakeFrom = null;
    aux += model.aux_kw * dt;
    if (a1 > topV + 1e-9) {
      topV = a1;
      topAt = xs[i + 1];
    }
    out.push({ s: xs[i + 1], t, v: a1 * 3.6, phase });
  }
  const energy = energyFigures(model, line, { traction_kj: trac, braking_kj: brake, regen_kj: regen, aux_kj: aux, length_m: stalled ?? L });
  return { length_m: L, time_s: stalled == null ? t : Infinity, stalled_at_m: stalled, top_kmh: topV * 3.6, top_at_m: topAt, brake_from_m: brakeFrom, samples: thin(out, samples), energy };
}

/**
 * The energy of a run (kWh): at the wheel for traction, for the auxiliaries, taken by the brakes and
 * fed back by the electric brake; from the contact line (electric) or as diesel (litres, CO₂); per
 * train-km and per seat-km.
 */
function energyFigures(model, line, { traction_kj, braking_kj, regen_kj, aux_kj, length_m }) {
  const kwh = (kj) => kj / 3600;
  const km = Math.max(0.001, length_m / 1000);
  const wheel = kwh(traction_kj), auxiliary = kwh(aux_kj), braking = kwh(braking_kj);
  const out = { electric: model.electric, traction_kwh: wheel, aux_kwh: auxiliary, braking_kwh: braking, regen_kwh: 0, net_kwh: 0, fuel_l: 0, co2_kg: 0, per_km_kwh: 0, per_seat_km_wh: 0 };
  if (model.electric) {
    const receptive = receptivity(line.power);
    out.regen_kwh = kwh(regen_kj) * ENERGY.regen * receptive;
    out.net_kwh = wheel / ENERGY.electric + auxiliary - out.regen_kwh;
  } else {
    const fuel = (wheel / ENERGY.diesel.transmission + auxiliary) / ENERGY.diesel.engine;
    out.net_kwh = fuel;
    out.fuel_l = fuel / ENERGY.diesel.kwh_per_l;
    out.co2_kg = out.fuel_l * ENERGY.diesel.co2_kg_per_l;
  }
  out.per_km_kwh = out.net_kwh / km;
  out.per_seat_km_wh = model.seats > 0 ? (out.net_kwh * 1000) / (km * model.seats) : 0;
  return out;
}

/** The share of the regenerated energy the line takes: AC lines feed it back, DC lines only to other trains. */
export function receptivity(power) {
  if (!power) return ENERGY.receptive.ac;
  return String(power).startsWith("dc") ? ENERGY.receptive.dc : power === "none" ? 0 : ENERGY.receptive.ac;
}

/**
 * Energy-efficient driving: the run as fast as possible and the run that coasts before the stop
 * from the earliest point that keeps the running time within the supplement (Ausrollen), found by
 * halving the distance with runs in coarser steps (to about a metre), then checked at full
 * resolution and moved later where the run would take longer than the supplement allows; the
 * coasting point is the driver advisory's hint.
 * @param {object} model
 * @param {Line} line
 * @param {{supplement?: number, v0_kmh?: number, sanding?: boolean, fast?: object | null}} [options]
 *   fast: the run as fast as possible when it is known (runProfile with the same v0_kmh and sanding)
 * @returns {{fast: object, coast: object | null, coast_m: number | null, saving_kwh: number, saving_share: number, extra_s: number}}
 */
export function coastingRun(model, line, { supplement = SUPPLEMENT, v0_kmh = 0, sanding = false, fast = null } = {}) {
  fast ??= runProfile(model, line, { v0_kmh, sanding });
  const none = { fast, coast: null, coast_m: null, saving_kwh: 0, saving_share: 0, extra_s: 0 };
  if (!Number.isFinite(fast.time_s) || line.stop === false) return none;
  // the search in coarser steps, against the time of the fast run in the same steps
  const coarse = { v0_kmh, sanding, samples: 2, step_m: clamp(line.length_m / 200, 1, 25) };
  const target = runProfile(model, line, coarse).time_s * (1 + Math.max(0, supplement));
  // the later the train coasts, the shorter the run: find the earliest point within the target
  let lo = 0, hi = fast.brake_from_m ?? line.length_m;
  if (!(hi > 0)) return none;
  for (let k = 0; k < 14; k++) {
    const mid = (lo + hi) / 2;
    const p = runProfile(model, line, { ...coarse, coast_m: mid });
    if (Number.isFinite(p.time_s) && p.time_s <= target) hi = mid;
    else lo = mid;
  }
  // at full resolution it may take a little longer than allowed: then coast later, doubling the
  // step until it keeps within, and halve back between the last point over and the first within
  const allowed = fast.time_s * (1 + Math.max(0, supplement)), end = fast.brake_from_m ?? line.length_m;
  const at = (x) => runProfile(model, line, { v0_kmh, sanding, coast_m: x });
  let coast = at(hi);
  if (!(coast.time_s <= allowed)) {
    let over = hi;
    for (let step = coarse.step_m; ; step *= 2) {
      hi = Math.min(end, over + step);
      coast = at(hi);
      if (coast.time_s <= allowed || hi >= end) break;
      over = hi;
    }
    for (let k = 0; k < 4 && hi - over > 1; k++) {
      const mid = (over + hi) / 2, p = at(mid);
      if (p.time_s <= allowed) [hi, coast] = [mid, p];
      else over = mid;
    }
  }
  if (!Number.isFinite(coast.time_s)) return none;
  const saving = fast.energy.net_kwh - coast.energy.net_kwh;
  return { fast, coast, coast_m: hi, saving_kwh: saving, saving_share: fast.energy.net_kwh > 0 ? saving / fast.energy.net_kwh : 0, extra_s: coast.time_s - fast.time_s };
}

/* ---------------------------------------------------------------- forces along the train */

/**
 * Coupler forces along a train (kN; positive: pulled, negative: pushed), quasi-static: each coupling
 * carries what the vehicles behind it need (their mass × the acceleration with their mass factor,
 * their running resistance, the gradient and the curve) less what the traction vehicles among them
 * pull themselves. One value per coupling, from the front.
 * @param {object} model
 * @param {{v_kmh?: number, accel?: number, permille?: number, radius_m?: number | null, traction_kn?: number | null}} [options]
 *   accel m/s²; traction_kn: the tractive effort exerted (default: what the acceleration needs)
 * @returns {number[]}
 */
export function couplerForces(model, { v_kmh = 0, accel = 0, permille = 0, radius_m = null, traction_kn = null } = {}) {
  const x = (Math.max(0, v_kmh) + STRAHL.wind_kmh) / 10, w = (Number(permille) || 0) + curveResistance(radius_m);
  const need = model.vehicles.map((v) => v.mass_t * v.factor * accel + (v.mass_t * G * (STRAHL.base + v.k * x * x + w)) / 1000);
  const total = need.reduce((s, f) => s + f, 0);
  const pull = traction_kn ?? total;
  const share = model.vehicles.reduce((s, v) => s + v.traction, 0);
  const own = model.vehicles.map((v) => (share > 0 ? (pull * v.traction) / share : 0));
  const out = [];
  let behind = 0;
  for (let i = model.vehicles.length - 1; i > 0; i--) {
    behind += need[i] - own[i];
    out.unshift(behind);
  }
  return out;
}

/**
 * The couplings when the train starts with its full tractive effort on a gradient: the force at
 * each one and the highest (kN, with the index of the coupling from the front).
 * @param {object} model
 * @param {{permille?: number, condition?: string, sanding?: boolean}} [options]
 */
export function startingForces(model, { permille = 0, condition = "dry", sanding = false } = {}) {
  const ft = tractiveEffort(model, 5, { condition, sanding });
  const accel = Math.max(0, (ft - runningResistance(model, 5) - lineResistance(model, permille)) / (model.mass_t * model.mass_factor));
  const forces = couplerForces(model, { v_kmh: 5, accel, permille, traction_kn: ft });
  let max = 0, at = -1;
  forces.forEach((f, i) => {
    if (f > max) {
      max = f;
      at = i;
    }
  });
  return { forces, max_kn: max, at, accel };
}

/**
 * A rough estimate of the run-in force (kN, compressive) while braking from the front: the brake
 * signal travels along the train at about 250 m/s while the brake cylinders fill (G about 22 s,
 * P 4 s), so for a while the back half of the train runs into the front. The longer the train and
 * the faster its brakes, the larger it is: why long freight trains brake in G.
 * @param {object} model
 * @param {{position?: string, decel?: number}} [options] the brake position, the deceleration (m/s²;
 *   default: of full braking)
 */
export function runInForce(model, { position = model.brake.position, decel = mindenDecel(model.brake.percentage) / 99.8 } = {}) {
  const fill = BRAKE_FILL_S[position] ?? BRAKE_FILL_S.P;
  const share = clamp(model.length_m / BRAKE_SIGNAL_MPS / fill, 0, 1);
  let rear = 0, along = 0;
  for (const v of [...model.vehicles].reverse()) {
    if (along >= model.length_m / 2) break;
    rear += v.mass_t;
    along += v.length_m;
  }
  return rear * decel * share;
}

/**
 * The load limit (Grenzlast) of the traction vehicles on a gradient: the heaviest train behind them
 * they can start and accelerate a little, from their starting tractive effort within the adhesion
 * (`traction_t`), and the heaviest train the first coupling holds (`coupler_t`).
 * @param {object} model
 * @param {number} permille the decisive gradient
 * @param {{condition?: string, sanding?: boolean, coupler_kn?: number, accel?: number}} [options]
 * @returns {{traction_t: number, coupler_t: number, limit_t: number, by: "adhesion" | "tractive effort" | "coupling"}}
 */
export function loadLimit(model, permille, { condition = "dry", sanding = false, coupler_kn = COUPLER_KN.screw, accel = 0.02 } = {}) {
  const f = tractiveEffort(model, 0, { condition, sanding });
  const perT = (G * ((Number(permille) || 0) + START_RESISTANCE)) / 1000 + MASS_FACTORS.wagon * accel;
  const locos = model.traction_t || 0;
  const own = locos * ((G * ((Number(permille) || 0) + START_RESISTANCE)) / 1000 + MASS_FACTORS.locomotive * accel);
  const traction_t = perT > 0 ? Math.max(0, (f - own) / perT) : Infinity;
  const coupler_t = perT > 0 ? coupler_kn / perT : Infinity;
  const by = coupler_t < traction_t ? "coupling" : slips(model, 0, { condition, sanding }) ? "adhesion" : "tractive effort";
  return { traction_t, coupler_t, limit_t: Math.min(traction_t, coupler_t), by };
}

/**
 * How much longer a train takes to come in and leave on rails in a condition than on dry rails:
 * the time to brake from a speed to a stop with the service brake and to start and accelerate back
 * to it, both within the adhesion, in the condition and on dry rails (a ratio, at least 1).
 * @param {object} model
 * @param {string} condition
 * @param {{v_kmh?: number, sanding?: boolean}} [options]
 */
export function approachFactor(model, condition, { v_kmh = 60, sanding = false } = {}) {
  const time = (cond) => {
    const m = model.mass_t * model.mass_factor, top = v_kmh / 3.6, dt = 0.1;
    let t = 0, v = 0;
    // accelerating: the tractive effort within the adhesion, less the running resistance
    while (v < top && t < 600) {
      const a = (tractiveEffort(model, v * 3.6, { condition: cond, sanding }) - runningResistance(model, v * 3.6)) / m;
      if (!(a > 1e-4)) return Infinity;
      v += a * dt;
      t += dt;
    }
    // braking: the service brake within the adhesion
    for (v = top; v > 0 && t < 1200; t += dt) v -= serviceDeceleration(model, v * 3.6, { condition: cond, sanding }) * dt;
    return t;
  };
  const dry = time("dry"), here = time(condition);
  if (!Number.isFinite(here)) return 10;
  return Math.max(1, dry > 0 ? here / dry : 1);
}

/**
 * The running time of a line between two stations: its distance in equal runs from stop to stop
 * (`stops` stops on the way, each with its dwell), each as fast as possible at the line speed; the
 * minimum and the timetable's with the running-time supplement (s).
 * @param {object} model
 * @param {{km: number, kmh?: number, stops?: number, dwell_s?: number, supplement?: number, power?: string | null}} options
 * @returns {{run_s: number, minimum_s: number, planned_s: number}} run_s: one run from stop to stop
 */
export function lineRunningTime(model, { km, kmh = 120, stops = 0, dwell_s = 30, supplement = SUPPLEMENT, power = null }) {
  const n = Math.max(0, Math.round(Number(stops) || 0)) + 1, L = (Math.max(0.1, Number(km) || 0) * 1000) / n;
  const one = runProfile(model, { length_m: L, sections: [{ s0: 0, s1: L, kmh }], power }, { samples: 2 });
  return { run_s: one.time_s, minimum_s: one.time_s * n + dwell_s * (n - 1), planned_s: one.time_s * n * (1 + supplement) + dwell_s * (n - 1) };
}

/**
 * Driving styles compared: as fast as possible, and coasting before the stop within each
 * running-time supplement (the later the train must arrive, the earlier it coasts and the less
 * energy it takes).
 * @param {object} model
 * @param {Line} line
 * @param {{supplements?: number[], fast?: object | null}} [options] supplements: shares of the
 *   minimum running time; fast: the run as fast as possible from a standstill when it is known
 * @returns {{fast: object, styles: Array<{supplement: number, run: ReturnType<typeof coastingRun>}>}}
 */
export function drivingStyles(model, line, { supplements = [0.03, SUPPLEMENT, 0.1], fast = null } = {}) {
  const run = fast ?? runProfile(model, line);
  return { fast: run, styles: supplements.map((supplement) => ({ supplement, run: coastingRun(model, line, { supplement, fast: run }) })) };
}

/**
 * The energy a train takes per km on a line between two stations: one run from stop to stop (its
 * distance in `stops` + 1 equal runs) at the line speed, as fast as possible or coasting before the
 * stop within the running-time supplement.
 * @param {object} model
 * @param {{km: number, kmh?: number, stops?: number, coasting?: boolean, supplement?: number, power?: string | null}} options
 * @returns {{electric: boolean, kwh_per_km: number, diesel_l_per_km: number}} kWh from the contact
 *   line (electric) or litres of diesel per km
 */
export function runEnergyPerKm(model, { km, kmh = 120, stops = 0, coasting = false, supplement = SUPPLEMENT, power = null }) {
  const n = Math.max(0, Math.round(Number(stops) || 0)) + 1, L = (Math.max(0.1, Number(km) || 0) * 1000) / n;
  const line = { length_m: L, sections: [{ s0: 0, s1: L, kmh }], power };
  const run = coasting ? coastingRun(model, line, { supplement }) : null;
  const e = (run?.coast ?? runProfile(model, line, { samples: 2 })).energy;
  return { electric: e.electric, kwh_per_km: e.electric ? e.net_kwh / (L / 1000) : 0, diesel_l_per_km: e.electric ? 0 : e.fuel_l / (L / 1000) };
}
