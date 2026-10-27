/**
 * Train protection on the track ahead: which system supervises a train on a section, PZB 90 with its
 * train types and monitoring curves, and the braking curves of continuous supervision (ETCS, LZB) to
 * the end of a movement authority, simplified for teaching.
 *
 * **PZB 90** (Punktförmige Zugbeeinflussung): the train type follows from the brake percentage (O, M,
 * U) and gives its supervised top speed. At a distant signal showing caution the 1000 Hz magnet asks
 * the driver to acknowledge within 4 s; then the permitted speed falls with time from the train
 * type's top speed to its 1000 Hz speed (O 165 → 85 km/h in 23 s, M 125 → 70 in 29 s, U 105 → 55
 * in 38 s) and stays there for 1250 m. The 500 Hz magnet 250 m before the main signal lowers it
 * again over 153 m (O 65 → 45, M 50 → 35, U 40 → 25 km/h); the 2000 Hz magnet at a main signal
 * showing stop brakes the train at once. In the restrictive mode (after the train stood or crept
 * in the supervision) 45 km/h after 1000 Hz and 25 km/h after 500 Hz. Exceeding a curve brakes the
 * train (forced braking).
 *
 * **ETCS** (and LZB, supervised the same way here): from the end of authority back, the emergency
 * brake deceleration curve (EBD) of the train's full braking, the emergency brake intervention
 * (EBI) the brake build-up time earlier, the warning (W) 2 s and the permitted speed (P) 4 s before
 * the intervention; a release speed near the end. After the braking curves of ETCS (UNISIG
 * SUBSET-026, chapter 3.13), without its safety margins and its correction factors.
 * @module arail/rail/protection
 */
import { fullBraking, SERVICE_BRAKE } from "./dynamics.js";
import { sectionSystems } from "./systems.js";

/** PZB 90 train types: from which brake percentage, the top speed, after 1000 Hz and after 500 Hz. */
export const PZB = {
  O: { label: "O (upper)", from_percentage: 111, vmax_kmh: 165, v1000_kmh: 85, t1000_s: 23, v500_kmh: [65, 45] },
  M: { label: "M (middle)", from_percentage: 66, vmax_kmh: 125, v1000_kmh: 70, t1000_s: 29, v500_kmh: [50, 35] },
  U: { label: "U (lower)", from_percentage: 0, vmax_kmh: 105, v1000_kmh: 55, t1000_s: 38, v500_kmh: [40, 25] },
};

/** PZB 90: acknowledging, how long and how far the supervision lasts, where the magnets lie, the restrictive mode. */
export const PZB_RULES = { acknowledge_s: 4, m1000_m: 1250, release_m: 700, m500_before_m: 250, curve500_m: 153, restrictive_kmh: { 1000: 45, 500: 25 } };

/** ETCS (and LZB) supervision, simplified: brake build-up time by brake position, warning and driver times, release speed. */
export const ETCS_CURVES = { build_s: { G: 12, P: 4, R: 3, "R+Mg": 3 }, warning_s: 2, driver_s: 4, release_kmh: 15 };

/** Seconds a driver takes to react (and acknowledge) at a distant signal. */
export const REACTION_S = 2;

/**
 * The PZB 90 train type of a brake percentage: O from 111, M from 66, else U (whole brake hundredths).
 * @param {number} percentage
 * @returns {"O" | "M" | "U"}
 */
export function pzbType(percentage) {
  const p = Math.floor(Number(percentage) || 0);
  return p >= PZB.O.from_percentage ? "O" : p >= PZB.M.from_percentage ? "M" : "U";
}

/**
 * The speed PZB permits (km/h) a time after a 1000 Hz influence: falling from the train type's top
 * speed to its 1000 Hz speed.
 * @param {"O" | "M" | "U"} type
 * @param {number} t_s seconds since the magnet
 */
export function pzb1000(type, t_s) {
  const p = PZB[type] ?? PZB.U;
  if (t_s <= 0) return p.vmax_kmh;
  return t_s >= p.t1000_s ? p.v1000_kmh : p.vmax_kmh - ((p.vmax_kmh - p.v1000_kmh) * t_s) / p.t1000_s;
}

/**
 * The speed PZB permits (km/h) some metres after a 500 Hz influence: falling over 153 m.
 * @param {"O" | "M" | "U"} type
 * @param {number} s_m metres since the magnet
 */
export function pzb500(type, s_m) {
  const [a, b] = (PZB[type] ?? PZB.U).v500_kmh;
  if (s_m <= 0) return a;
  return s_m >= PZB_RULES.curve500_m ? b : a - ((a - b) * s_m) / PZB_RULES.curve500_m;
}

/**
 * Which system supervises a train on a section: ETCS where the section has it and the leading
 * traction vehicle runs that level, LZB on a line with LZB for a vehicle with it, PZB where the
 * section has PZB; another national system (LS, SHP, …) is named but not modelled.
 * @param {import("./vehicles.js").Consist} consist
 * @param {object} spec the section's (track's) spec
 * @returns {{system: "etcs" | "lzb" | "pzb" | "other" | "none", level?: string, name: string}}
 */
export function supervision(consist, spec) {
  const { values: s } = sectionSystems(spec);
  const lead = consist.vehicles.find((v) => v.t.kind === "locomotive" || v.t.kind === "multiple-unit" || v.t.kind === "railcar")?.t;
  const rank = { none: 0, l1ls: 1, l1: 2, l2: 3 };
  if (s.etcs && s.etcs !== "none" && lead && rank[lead.etcs || "none"] >= rank[s.etcs]) return { system: "etcs", level: s.etcs, name: s.etcs === "l2" ? "ETCS Level 2" : s.etcs === "l1" ? "ETCS Level 1" : "ETCS Level 1 LS" };
  const own = lead?.train_control || [];
  if (s.train_control === "pzb_lzb" && own.includes("pzb_lzb")) return { system: "lzb", name: "LZB" };
  if ((s.train_control === "pzb" || s.train_control === "pzb_lzb") && (own.includes("pzb") || own.includes("pzb_lzb"))) return { system: "pzb", name: "PZB 90" };
  if (s.train_control && s.train_control !== "none") return { system: "other", name: String(s.train_control).toUpperCase() };
  return { system: "none", name: "none" };
}

/**
 * A train approaching a main signal showing stop under PZB, from its distant signal: it passes the
 * 1000 Hz magnet at the distant signal at v0, the driver acknowledges and brakes (service braking,
 * or more where the distance needs it) to stop at the signal; the 500 Hz magnet lies 250 m before
 * it. Every step is checked against the curves: where the train is faster, PZB brakes it.
 * @param {object} model rail/dynamics.js `trainModel`
 * @param {{v0_kmh: number, distant_m?: number, permille?: number, condition?: string, decel?: number | null}} options
 *   distant_m: from the distant signal to the main signal; decel: the driver's braking (m/s²)
 * @returns {{type: string, samples: Array<{s: number, t: number, v: number, limit: number}>, forced: {s: number, t: number, v: number} | null,
 *   stop_m: number, decel: number, at500_kmh: number}}
 */
export function pzbApproach(model, { v0_kmh, distant_m = 1000, permille = 0, condition = "dry", decel = null }) {
  const type = pzbType(model.brake.percentage);
  const v0 = Math.min(Math.max(0, v0_kmh), PZB[type].vmax_kmh) / 3.6;
  const at500 = Math.max(0, distant_m - PZB_RULES.m500_before_m);
  // the driver brakes so as to stop at the signal: at least the service brake, at most full braking
  const full = fullBraking(model, v0 * 3.6, { permille, condition }).decel;
  const need = v0 > 0 ? (v0 * v0) / (2 * Math.max(1, distant_m - v0 * REACTION_S)) : 0;
  const a = decel ?? Math.min(full, Math.max(need, Math.min(SERVICE_BRAKE[model.brake.position] ?? 0.5, full)));
  const samples = [];
  let s = 0, t = 0, v = v0, forced = null;
  const dt = 0.25;
  const limitAt = (sm, ts) => Math.min(pzb1000(type, ts), sm >= at500 ? pzb500(type, sm - at500) : Infinity);
  while (s < distant_m + 50 && t < 600) {
    const limit = limitAt(s, t);
    samples.push({ s, t, v: v * 3.6, limit });
    if (v <= 0) break;
    if (!forced && v * 3.6 > limit + 1e-6) forced = { s, t, v: v * 3.6 };
    // braking: after the reaction time the driver's, after a forced braking full braking
    const b = forced ? full : t >= REACTION_S ? a : 0;
    const v1 = Math.max(0, v - b * dt);
    s += ((v + v1) / 2) * dt;
    t += dt;
    v = v1;
  }
  return { type, samples, forced, stop_m: s, decel: a, at500_kmh: samples.find((x) => x.s >= at500)?.v ?? 0 };
}

/**
 * The braking curves of continuous supervision (ETCS, LZB) to the end of authority: for points from
 * the train to it, the speeds of the emergency brake deceleration (EBD), of the intervention (EBI),
 * of the warning (W) and the permitted speed (P), at most the train's and the line's top speed, at
 * least the release speed near the end (not EBD).
 * @param {object} model rail/dynamics.js `trainModel`
 * @param {number} eoa_m distance from the train to the end of authority
 * @param {{permille?: number, condition?: string, vmax_kmh?: number | null, points?: number}} [options]
 * @returns {{decel: number, release_kmh: number, points: Array<{s: number, ebd: number, ebi: number, w: number, p: number}>}}
 */
export function etcsCurves(model, eoa_m, { permille = 0, condition = "dry", vmax_kmh = null, points = 80 } = {}) {
  const top = Math.min(model.vmax_kmh || 160, vmax_kmh || Infinity) / 3.6;
  const a = Math.max(0.05, fullBraking(model, Math.min(top * 3.6, 160), { permille, condition }).decel);
  const T = ETCS_CURVES.build_s[model.brake.position] ?? ETCS_CURVES.build_s.P;
  const release = ETCS_CURVES.release_kmh / 3.6;
  // the speed from which a train stops within d when it first runs `lag` seconds unbraked
  const speed = (d, lag) => (d <= 0 ? 0 : -a * lag + Math.sqrt(a * a * lag * lag + 2 * a * d));
  const out = [];
  const n = Math.max(2, points);
  for (let i = 0; i <= n; i++) {
    const s = (eoa_m * i) / n, d = eoa_m - s;
    const ebd = Math.min(top, Math.sqrt(2 * a * Math.max(0, d)));
    const ebi = Math.min(top, Math.max(release, speed(d, T)));
    const w = Math.min(top, Math.max(release, speed(d, T + ETCS_CURVES.warning_s)));
    const p = Math.min(top, Math.max(release, speed(d, T + ETCS_CURVES.driver_s)));
    out.push({ s, ebd: ebd * 3.6, ebi: ebi * 3.6, w: w * 3.6, p: p * 3.6 });
  }
  return { decel: a, release_kmh: ETCS_CURVES.release_kmh, points: out };
}
