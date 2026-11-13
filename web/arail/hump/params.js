/**
 * The figures of the hump yard, from the literature on hump design (Ablaufbergbemessung). Each
 * constant names its source; docs/hump-yard.md lists the sources in full. "Estimate" marks a value
 * no source was found for. Values are typical and simplified for teaching: a real yard is
 * dimensioned with its own measurements.
 *
 * Units: m, s, m/s, t, kN; resistances in N per kN of weight (= ‰, = m of energy height per km).
 * @module arail/hump/params
 */

/** Gravity (m/s²). */
export const G = 9.81;

/** Density of air (kg/m³) at about 10 °C. */
export const AIR_DENSITY = 1.25;

/**
 * Rotating masses: the equivalent mass of a wheelset's rotation (t per axle). Estimate: a freight
 * wheelset of 920 mm with J ≈ 90 kg·m² behaves as J/r² ≈ 0.43 t more mass in a straight line; an
 * empty 4-axle wagon of 23 t then has a mass factor of 1.07, a loaded one of 90 t 1.02 (hump design
 * writes this as a reduced gravity g' = g / factor).
 */
export const ROTATING_T_PER_AXLE = 0.43;

/**
 * Rolling resistance of freight wagons on straight, level track (N/kN): a normal distribution per
 * class, cut at its limits, drawn for every wagon. Hump design takes a good runner at 1.8 and a bad
 * runner at 4.2 N/kN at normal temperature (Pachl, Systemtechnik des Schienenverkehrs, ch. 9);
 * Davis' formula gives about 1.2 for a loaded 90 t wagon and 2.9 for an empty 23 t one (FRA 1977);
 * Siemens' classes: good 0.5–4, bad 4–8 (WO 2004/074067). The classes: loaded 4-axle wagons `good`,
 * empty 4-axle wagons and loaded 2-axle ones `medium`, empty 2-axle wagons `bad`.
 */
export const ROLLING = {
  good: { mean: 1.4, sd: 0.35, lo: 0.5, hi: 3.0 },
  medium: { mean: 2.4, sd: 0.5, lo: 1.0, hi: 4.0 },
  bad: { mean: 3.4, sd: 0.7, lo: 2.0, hi: 8.0 },
};

/**
 * Seasons: what they add to the rolling resistance (N/kN), and the head wind against the cuts
 * (m/s). At −10 °C the good runner has 3.7 and the bad one 6.5 N/kN instead of 1.8 and 4.2 (Pachl,
 * ch. 9): about 2 more. The design wind is an estimate (no source found: 4–6 m/s).
 */
export const SEASONS = {
  summer: { label: "Summer", rolling_add: 0, wind_mps: 0 },
  winter: { label: "Winter (−10 °C)", rolling_add: 2.0, wind_mps: 5 },
};

/** Starting resistance (N/kN) on top of the rolling resistance: what a standing cut needs to start rolling (estimate). */
export const START_EXTRA = 2;

/**
 * Air resistance F = ρ/2 · cwA · (v + v_wind)². `cwA` (m², per wagon type in WAGONS) is the drag area
 * of a wagon at the head of a cut: Davis' coefficient for a leading freight car over about 8 m² of
 * front gives about 7.5 m² (FRA 1977); empty open wagons more (estimate). A wagon behind another one
 * in the same cut has `FOLLOWING` of it (Davis: 0.0005 against 0.0024).
 */
export const AIR = { FOLLOWING: 0.2 };

/**
 * Curve resistance after Röckl for standard gauge (N/kN): 650/(r − 55) for r ≥ 300 m, 500/(r − 30)
 * below; 3.1 N/kN in the 190 m curve of a hump switch.
 * @param {number} r radius (m); 0 or less: straight
 */
export function curveResistance(r) {
  if (!(r > 0)) return 0;
  return r >= 300 ? 650 / (r - 55) : 500 / Math.max(1, r - 30);
}

/**
 * Hump switches (EW 49-190-1:7.5): the energy height a wagon loses in passing one (m; about 7.6 mm
 * for a 100 t car, SRI for the US DOT; no German figure found), taken as a resistance over the
 * turnout; the time to throw one (s; 0.6–0.8 for the fast drives of the first levels); its detection
 * section, which a wagon locks it in: `guard_m` before the tip, `clear_m` behind it (US track
 * circuits of 27–65 ft, 38 ft typical; the split is an estimate); the margin the control keeps
 * between a throw and the next cut (s, estimate).
 */
export const SWITCHES = { loss_m: 0.008, throw_s: 0.6, guard_m: 8, clear_m: 4, margin_s: 0.3 };

/**
 * Retarders (Gleisbremsen) by where they are: the energy height they take from a wagon fully
 * braked over their whole length (m), how fast they close or open (s), the highest speed a cut should
 * enter at (m/s). Beam retarders take 20–50 kJ per metre and 22.5 t axle, 0.09–0.23 m of energy
 * height per metre (FFG StilvA); a full-capability US retarder 0.11 m per m (SRI): the main retarder
 * here 0.15, a group retarder 0.11 m per m. The main retarder (Talbremse) is entered at 6–8 m/s, the
 * group retarder (Richtungsgleisbremse) at about 4.5 m/s (EP 0313771). The closing time is an
 * estimate (Siemens: 100 ms between braking stages).
 * `speed` are speed-holding units along a track (Kolbengleisbremsen, Dowty): they brake by themselves
 * whatever is faster than `hold_mps` (Nürnberg holds the wagons at 1 m/s), with `w_nkn` N/kN (an
 * estimate: about 1.4 kJ per unit and wheel, a unit about every metre).
 */
export const RETARDERS = {
  main: { label: "Main retarder", capacity_m: 3.6, response_s: 0.5, vmax_in_mps: 8 },
  group: { label: "Group retarder", capacity_m: 2.0, response_s: 0.5, vmax_in_mps: 6 },
  speed: { label: "Speed control units", w_nkn: 6, response_s: 0, vmax_in_mps: 5, hold_mps: 1.0 },
};

/**
 * Speeds (m/s). The pushing speed: 0.8–1.4 m/s with computer-controlled routing (Wikipedia,
 * Rangierbahnhof). The impact a cut may meet the wagons in its track with: DB allows 1.25 m/s,
 * formerly 1.5 (Pachl, § 9.4.3.2). Wagons marked "shunt with care" (RID label 13): 1.0, an estimate
 * (no figure found; set it from the local rules). The speed the control aims for when a cut meets
 * the wagons in its track or the end of an empty one, and when it enters its group retarder
 * (about 4.5 m/s, EP 0313771). The main retarder lets no cut go slower than `main_out_mps`, so that
 * the next one does not catch it up (US master retarders release at 6–8 mph, PRR 1965).
 */
export const SPEEDS = { push_mps: 1.2, impact_mps: 1.25, careful_mps: 1.0, couple_mps: 1.0, group_in_mps: 4.5, main_out_mps: 3.0 };

/**
 * The control (Ablaufsteuerung): how far above the required speed a retarder closes (m/s), and the
 * error of the rolling resistance it measures on the ramp (N/kN, standard deviation). Both are
 * estimates.
 */
export const CONTROL = { band_mps: 0.05, estimate_sd: 0.4 };

/**
 * Wagons as humping sees them, per type of the vehicle catalogue (rail/vehicles.js): the drag area
 * empty and loaded (m², see AIR) and the rolling class empty and loaded (see ROLLING). The hump's own
 * types fill a gap of the catalogue: the 2-axle sliding wall wagon Hbbillns, 15.5 m, 16 t empty, 45 t
 * at most (Rail Cargo data sheet).
 */
export const WAGONS = {
  sgns: { cwA_empty: 6, cwA_loaded: 8, rolling: ["medium", "good"] },
  eanos: { cwA_empty: 10, cwA_loaded: 7.5, rolling: ["medium", "good"] },
  habbins: { cwA_empty: 8, cwA_loaded: 8, rolling: ["medium", "good"] },
  zacns: { cwA_empty: 7.5, cwA_loaded: 7.5, rolling: ["medium", "good"] },
  hbbillns: { label: "Hbbillns (sliding wall wagon, 2 axles)", length_m: 15.5, mass_t: 16, load_t: 29, axles: 2, cwA_empty: 8, cwA_loaded: 8, rolling: ["bad", "medium"] },
};

/**
 * Distance between the centre lines of neighbouring classification tracks (m), for the plan: 4.5 m,
 * an estimate (the EBO asks at least 4.0 m between tracks in stations; yards keep room for the staff).
 */
export const TRACK_SPACING_M = 4.5;

/**
 * How the classification tracks bring the cuts to the wagons in them.
 * - `speed`: speed-holding units along the whole track, which falls 3 ‰, more than most wagons'
 *   rolling resistance; the group retarder lets a cut go at the units' speed (where a track falls
 *   more than a wagon's resistance, it needs such units: EP 0758604).
 * - `target`: target braking alone (Laufzielbremsung): the group retarder lets a cut go at the speed
 *   that brings it to the wagons in the track; the track falls 2 ‰, then 1 ‰ (older yards 1.5–3 ‰,
 *   sometimes stepped: Organ 1931). The error of the measured resistance grows with the distance:
 *   hard impacts and gaps.
 */
export const TRACK_DESIGNS = {
  speed: { label: "Speed-holding units", speed_control_m: Infinity, track_grades: [[0, -3]] },
  target: { label: "Target braking", speed_control_m: 0, track_grades: [[0, -2], [100, -1]] },
};

/**
 * The standard yard (`standardYard`): lengths (m), grades (‰, negative downhill), radii (m).
 * - Approach at 20 ‰ or more (Pachl); crest rounded at 300 m (Maschen; TSI WAG: wagons pass 250 m).
 * - Steep ramp 40–70 ‰ (Deine Bahn 5/2012; Maschen 61 ‰ over 53 m): 50 ‰ over 40 m.
 * - Main retarder on 10–25 ‰ (PRR: 18 ‰): 15 ‰.
 * - Switch zone 10–15 ‰ (Pachl; Deine Bahn): 10 ‰, switches EW 49-190-1:7.5 every 32 m; the tracks
 *   brought parallel again by curves of 250 m.
 * - Group retarders on 8 ‰ (PRR).
 * - Classification tracks of 700 m (Halle (Saale)), of the design `design` (TRACK_DESIGNS); its
 *   `speed_control_m` and `track_grades` can be given on their own.
 * - One main retarder serves 6–12 tracks, mostly 8.
 * The hump is then 4.5 m high to the start of the middle tracks (large yards 3.5–4.5 m).
 */
export const STANDARD_YARD = {
  name: "Standard hump",
  tracks: 8,
  push_m: 120, push_grade: 20, crest_radius_m: 300,
  ramp_m: 40, ramp_grade: -50,
  before_main_m: 6, main_m: 24, main_grade: -15, after_main_m: 24,
  switch_grade: -10, switch_spacing_m: 32,
  turnout_radius_m: 190, turnout_angle_rad: Math.atan(1 / 7.5), counter_radius_m: 250,
  lead_m: 32, group_m: 18, group_grade: -8, after_group_m: 8,
  track_m: 700, design: "speed",
  switches: {},
};
