/**
 * Mobility of people: what a person is like (a **profile** of characteristics) and what that changes
 * when they walk, get on and off a vehicle, take up room in it and choose their way. Every person
 * of the simulations is one kind of person with a profile, never a subclass per group: the people
 * at the stops (sims/passengers.js), the town's residents (sims/town.js), the journeys' travellers
 * (journeys/) and the people in the cars (sims/traffic.js).
 *
 * A profile is `{age, aid, luggage, licence, car, base_mps}`:
 * - `age`: child | adult | old (65 and older)
 * - `aid`: none | stick (a walking stick) | rollator | wheelchair | pram (Kinderwagen)
 * - `luggage`: none | light (a bag, a backpack) | heavy (a suitcase) | bulky (a bike, skis)
 * - `licence`: has a driving licence; `car`: has a car available (household car, car sharing)
 * - `base_mps`: the walking speed the person would have without their traits (m/s), drawn from a
 *   normal distribution (Weidmann 1993: 1.34 m/s, standard deviation 0.26 m/s), cut to 0.5–2.2 m/s
 *
 * The traits combine: an old person with a rollator and a suitcase walks at
 * base × 0.83 × 0.46 × 0.85. The shares of the traits and every effect are settings
 * ({@link MOBILITY_PARAMS}), each with a default and its source; the passenger simulation holds
 * them for the whole layout (`mobilityOf(world)`). Profiles are drawn from a seeded random stream
 * (always the same five random numbers and one normal one), so a run is reproducible.
 *
 * Sources: Weidmann, U. (1993): Transporttechnik der Fussgänger, IVT ETH Zürich, Schriftenreihe 90;
 * Weidmann, U. (1994): Der Fahrgastwechsel im öffentlichen Personenverkehr, IVT ETH Zürich,
 * Schriftenreihe 99; Knoblauch, Pietrucha, Nitzburg (1996): Field studies of pedestrian walking
 * speed and start-up time, Transportation Research Record 1538; Boyce, Shields, Silcock (1999):
 * Toward the characterization of building occupancies for fire safety engineering: capabilities of
 * disabled people moving horizontally and on an incline, Fire Technology 35; Young (1999):
 * Evaluation of pedestrian walking speeds in airport terminals, Transportation Research Record 1674;
 * TCQSM (2013): Transit Capacity and Quality of Service Manual, 3rd ed., TCRP Report 165; MiD 2017:
 * Mobilität in Deutschland (infas for the BMVI); Destatis (2023): population by age. Values without
 * a source are estimates, rounded for teaching.
 * @module arail/core/mobility
 */
import { clamp } from "./math.js";

/** Age groups, in words. */
export const AGES = { child: "child", adult: "adult", old: "old" };
/** Walking aids (and a pram, which is pushed), in words. */
export const AIDS = { none: "no aid", stick: "walking stick", rollator: "rollator", wheelchair: "wheelchair", pram: "pram" };
/** Luggage classes, in words. */
export const LUGGAGE = { none: "no luggage", light: "light luggage", heavy: "heavy luggage", bulky: "bulky luggage" };

/** The walking speed of a person is cut to this range (m/s). */
export const MIN_MPS = 0.3;
export const MAX_MPS = 2.2;
/** The base speed is drawn in this range (m/s). */
const BASE_MPS = [0.5, 2.2];
/** Step-free (level boarding): the step between platform and floor and the gap at most this (m), as for tram stops (BOStrab, DIN 18040-3). */
export const STEP_FREE_M = 0.05;
/** The highest step a vehicle's folding ramp bridges (m): about 1 m long at a slope of at most 25 %. */
export const RAMP_MAX_M = 0.25;
/** A trip this long or longer (km) has the share of heavy luggage of a long trip; up to 5 km that of a short one. */
const LONG_KM = 100, SHORT_KM = 5;

const share = (key, label, value, help, source, unit = "share") => ({ key, label, type: "number", unit, min: 0, max: 1, step: 0.01, default: value, help, source, group: "people" });
const factor = (group, key, label, value, source, max = 10) => ({ key, label, type: "number", unit: "factor", min: 0.05, max, step: 0.05, default: value, source, group });
const seconds = (group, key, label, value, source, max = 600) => ({ key, label, type: "number", unit: "s", min: 0, max, step: 0.5, default: value, source, group });
const spaces = (key, label, value, source, min = 0, max = 4) => ({ key, label, type: "number", unit: "spaces", min, max, step: 0.05, default: value, source, group: "space" });

/**
 * The characteristics of people as settings (ParamSpecs of the passenger simulation, see
 * sims/passengers.js): `group` people (shares), walking (speed), boarding, space and car; `source`
 * where the default comes from.
 */
export const MOBILITY_PARAMS = Object.freeze([
  share("share_child", "Children", 0.15, "Share of the people.", "Destatis 2023: 14 % are younger than 15"),
  share("share_old", "Old people", 0.22, "Share of the people who are 65 or older.", "Destatis 2023: 22 %"),
  share("share_wheelchair", "Wheelchair users", 0.01, "Share of the people.", "About 1.6 million wheelchair users in Germany (2 %); fewer of them travel"),
  share("share_rollator", "Rollator", 0.06, "Share of the old people (of the others a tenth of it).", "Estimate: about 2 million rollators in Germany"),
  share("share_stick", "Walking stick", 0.1, "Share of the old people (of the others a tenth of it).", "Estimate"),
  share("share_pram", "Pram", 0.03, "Share of the adults pushing a pram (Kinderwagen; of the old a third of it).", "Estimate"),
  share("share_light", "Light luggage", 0.45, "Share of the people with a bag or a backpack.", "Estimate"),
  share("share_heavy", "Heavy luggage on short trips", 0.03, "Share with a suitcase on trips up to 5 km (half of it to work or school).", "Estimate"),
  share("share_heavy_long", "Heavy luggage on long trips", 0.35, "Share with a suitcase on trips of 100 km and more; in between it grows with the length of the trip.", "Estimate (long-distance trains, holidays, weekend commuters)"),
  share("share_bulky", "Bulky luggage", 0.02, "Share with a bike, skis or something as large.", "Estimate"),
  share("licence_adult", "Driving licence", 0.87, "Share of the adults with a driving licence.", "MiD 2017"),
  share("licence_old", "Driving licence of the old", 0.75, "Share of the old people with a driving licence.", "MiD 2017 (fewer among the very old)"),
  share("car_share", "Car available", 0.75, "Share of the people with a driving licence who have a car available.", "MiD 2017"),
  { key: "walk_mean_mps", label: "Walking speed", type: "number", unit: "m/s", min: 0.5, max: 2, step: 0.01, default: 1.34, help: "The mean of the normal distribution the base speed is drawn from.", source: "Weidmann 1993", group: "walking" },
  { key: "walk_sd_mps", label: "Spread of the walking speed", type: "number", unit: "m/s", min: 0, max: 0.6, step: 0.01, default: 0.26, help: "Its standard deviation (cut to 0.5–2.2 m/s).", source: "Weidmann 1993", group: "walking" },
  factor("walking", "speed_child", "Walking speed of children", 0.9, "Estimate after Weidmann 1993"),
  factor("walking", "speed_old", "Walking speed of old people", 0.83, "Knoblauch et al. 1996: 1.25 of 1.51 m/s"),
  factor("walking", "speed_stick", "Walking speed with a stick", 0.65, "Boyce et al. 1999: 0.81 of 1.24 m/s"),
  factor("walking", "speed_rollator", "Walking speed with a rollator", 0.46, "Boyce et al. 1999: 0.57 of 1.24 m/s"),
  factor("walking", "speed_wheelchair", "Speed in a wheelchair", 0.7, "Boyce et al. 1999: 0.69 (manual) to 0.89 m/s (electric) of 1.24 m/s"),
  factor("walking", "speed_pram", "Walking speed with a pram", 0.9, "Estimate"),
  factor("walking", "speed_heavy", "Walking speed with heavy luggage", 0.85, "Young 1999 (airport terminals)"),
  factor("walking", "speed_bulky", "Walking speed with bulky luggage", 0.8, "Estimate"),
  seconds("boarding", "board_s", "Boarding time", 1.5, "Weidmann 1994: 1.2–2 s a person and door stream at level boarding", 10),
  seconds("boarding", "board_step_s", "Boarding time per 10 cm of step", 0.4, "Estimate after Weidmann 1994", 5),
  factor("boarding", "board_child", "Boarding of children, level", 1.2, "Estimate"),
  factor("boarding", "board_child_step", "Boarding of children, with a step", 1.6, "Estimate"),
  factor("boarding", "board_old", "Boarding of old people, level", 1.3, "Estimate after Weidmann 1994"),
  factor("boarding", "board_old_step", "Boarding of old people, with a step", 2.5, "Estimate after Weidmann 1994"),
  factor("boarding", "board_stick", "Boarding with a stick, level", 1.5, "Estimate"),
  factor("boarding", "board_stick_step", "Boarding with a stick, with a step", 3, "Estimate"),
  factor("boarding", "board_rollator", "Boarding with a rollator, level", 2, "Estimate"),
  factor("boarding", "board_rollator_step", "Boarding with a rollator, with a step", 4, "Estimate: the rollator is lifted in"),
  factor("boarding", "board_pram", "Boarding with a pram, level", 2, "Estimate"),
  factor("boarding", "board_pram_step", "Boarding with a pram, with a step", 5, "Estimate: lifted in, often with help", 20),
  factor("boarding", "board_wheelchair", "Boarding in a wheelchair, level", 2.5, "Estimate"),
  seconds("boarding", "ramp_s", "Ramp", 60, "TCQSM 2013: 30–60 s for a ramp the driver puts out"),
  seconds("boarding", "lift_s", "Lift or ramp of the station staff", 120, "TCQSM 2013: 60–200 s for a lift"),
  seconds("boarding", "load_heavy_s", "Loading heavy luggage", 3, "Estimate (twice as long with a step)", 60),
  seconds("boarding", "load_bulky_s", "Loading bulky luggage", 8, "Estimate (twice as long with a step)", 120),
  spaces("space_child", "Space of a child", 0.7, "Estimate", 0.1, 1),
  spaces("space_heavy", "Space of heavy luggage", 0.5, "Estimate (none in a train's luggage racks)"),
  spaces("space_rollator", "Space of a rollator", 0.7, "Estimate"),
  spaces("space_pram", "Space of a pram", 1.5, "Estimate"),
  spaces("space_wheelchair", "Space of a wheelchair", 1.5, "Estimate (in a wheelchair place; not squeezed)"),
  spaces("space_bulky", "Space of bulky luggage", 1.5, "Estimate (not squeezed)"),
  spaces("squeeze_person", "Squeezed person", 0.8, "Estimate: standing closer", 0.1, 1),
  spaces("squeeze_heavy", "Squeezed heavy luggage", 0.2, "Estimate: on the lap, between the legs"),
  spaces("squeeze_rollator", "Squeezed rollator", 0.3, "Estimate: folded"),
  spaces("squeeze_pram", "Squeezed pram", 1.2, "Estimate: a pram with a baby is not folded"),
  { key: "standing_per_m2", label: "Standing room", type: "number", unit: "people per m²", min: 1, max: 8, step: 0.5, default: 4, help: "People standing per m² of a vehicle's standing room (its capacity in spaces: seats and standing room).", source: "VDV: 4 people per m² for planning", group: "space" },
  { key: "onboard_share", label: "Riding through", type: "number", unit: "share of the spaces", min: 0, max: 1, step: 0.05, default: 0.25, help: "A vehicle comes in with the people who get off, its riders of the town and the journeys, and this share of its spaces taken by people riding on (at the normal daytime level; more in the rush hours).", source: "Estimate", group: "space" },
  { key: "squeeze_mood", label: "Mood lost by squeezing", type: "number", unit: "per space and minute", min: 0, max: 1, step: 0.01, default: 0.05, help: "Every space a person is squeezed out of costs this much mood per minute of the ride (0 … 1).", source: "Estimate", group: "space" },
  seconds("car", "car_luggage_s", "Luggage into the boot", 20, "Estimate"),
  seconds("car", "car_pram_s", "Pram into the car", 60, "Estimate: folded, the child in its seat"),
  seconds("car", "car_wheelchair_s", "Wheelchair into the car", 120, "Estimate: into the seat, the wheelchair folded"),
]);

/** The keys of the settings. */
export const MOBILITY_KEYS = Object.freeze(MOBILITY_PARAMS.map((p) => p.key));

/**
 * The settings of mobility with their defaults: a value of `config` where it is a number in its
 * range (else the default).
 * @param {object} [config] e.g. the passenger simulation's config
 * @returns {Readonly<Record<string, number>>}
 */
export function mobilitySettings(config = {}) {
  const out = {};
  for (const p of MOBILITY_PARAMS) {
    const raw = config?.[p.key], v = Number(raw);
    out[p.key] = raw !== undefined && raw !== null && raw !== "" && Number.isFinite(v) ? clamp(v, p.min, p.max) : p.default;
  }
  return Object.freeze(out);
}

/** The settings with every default. */
export const DEFAULT_MOBILITY = mobilitySettings({});

/**
 * The settings of mobility of a world: those of the simulation that holds them (the passenger
 * simulation, `mobility`), else the defaults.
 * @param {object} world
 */
export function mobilityOf(world) {
  for (const s of world?.simulations || []) if (s.enabled !== false && s.mobility) return s.mobility;
  return DEFAULT_MOBILITY;
}

/** The first key of `shares` ([[key, share], …]) whose cumulative share passes `u` (0 … 1), else `rest`. */
function pick(u, shares, rest) {
  let sum = 0;
  for (const [key, s] of shares) {
    sum += Math.max(0, s);
    if (u < sum) return key;
  }
  return rest;
}

/** The aids people of an age group have: [[aid, share], …]. */
export function aidShares(age, mob = DEFAULT_MOBILITY) {
  const k = age === "old" ? 1 : age === "adult" ? 0.1 : 0;
  return [["wheelchair", mob.share_wheelchair], ["rollator", mob.share_rollator * k], ["stick", mob.share_stick * k], ["pram", age === "adult" ? mob.share_pram : age === "old" ? mob.share_pram / 3 : 0]];
}

/**
 * The luggage people carry on a trip: [[class, share], …]. Heavy luggage grows with the length of
 * the trip (from `share_heavy` up to 5 km to `share_heavy_long` at 100 km), half of it to work or
 * school; children carry a third as much heavy and bulky luggage.
 * @param {{km?: number, purpose?: string | null}} [trip]
 * @param {string} [age]
 */
export function luggageShares({ km = SHORT_KM, purpose = null } = {}, age = "adult", mob = DEFAULT_MOBILITY) {
  const long = clamp((Number(km) - SHORT_KM) / (LONG_KM - SHORT_KM), 0, 1) || 0;
  let heavy = mob.share_heavy + (mob.share_heavy_long - mob.share_heavy) * long;
  if (purpose === "work" || purpose === "school") heavy *= 0.5;
  const kid = age === "child" ? 1 / 3 : 1;
  const bulky = mob.share_bulky * kid;
  heavy *= kid;
  return [["bulky", bulky], ["heavy", heavy], ["light", Math.min(mob.share_light, Math.max(0, 1 - bulky - heavy))]];
}

/**
 * A profile drawn from a random stream. What `ctx` fixes is taken as it is (a town's pupil is a
 * child), the rest is drawn by the shares of the settings (the aids by the age); the same random
 * numbers are taken in either case, so what is drawn from the stream afterwards does not depend on
 * what was fixed.
 * @param {{next: Function, truncNormal: Function}} rng
 * @param {{age?: string, aid?: string, luggage?: string, licence?: boolean, car?: boolean, base_mps?: number,
 *   km?: number, purpose?: string | null, driver?: boolean}} [ctx] fixed traits; the trip (`km`, `purpose`)
 *   the luggage depends on; `driver`: an adult or old person with a licence and a car
 * @param {Readonly<Record<string, number>>} [mob] the settings
 * @returns {{age: string, aid: string, luggage: string, licence: boolean, car: boolean, base_mps: number}}
 */
export function drawProfile(rng, ctx = {}, mob = DEFAULT_MOBILITY) {
  const u = [rng.next(), rng.next(), rng.next(), rng.next(), rng.next()];
  const base = rng.truncNormal(mob.walk_mean_mps, mob.walk_sd_mps, BASE_MPS[0], BASE_MPS[1]);
  const driver = !!ctx.driver;
  let age = ctx.age;
  if (!AGES[age]) {
    if (driver) age = u[0] < mob.share_old / Math.max(1e-9, 1 - mob.share_child) ? "old" : "adult";
    else age = pick(u[0], [["child", mob.share_child], ["old", mob.share_old]], "adult");
  }
  const aid = AIDS[ctx.aid] ? ctx.aid : pick(u[1], aidShares(age, mob), "none");
  const luggage = LUGGAGE[ctx.luggage] ? ctx.luggage : pick(u[2], luggageShares(ctx, age, mob), "none");
  const licence = typeof ctx.licence === "boolean" ? ctx.licence : driver || (age !== "child" && u[3] < (age === "old" ? mob.licence_old : mob.licence_adult));
  const car = typeof ctx.car === "boolean" ? ctx.car && licence : driver || (licence && u[4] < mob.car_share);
  const speed = Number(ctx.base_mps);
  return { age, aid, luggage, licence, car, base_mps: Math.round((Number.isFinite(speed) && speed > 0 ? clamp(speed, ...BASE_MPS) : base) * 100) / 100 };
}

/**
 * A profile as it is written (a traveller's chosen traits, a layout file): its known traits, the
 * rest as for an adult without aids or luggage, at the mean walking speed; a licence for adults
 * and old people unless it says otherwise, a car only when it says so.
 * @param {object} [spec]
 */
export function normalizeProfile(spec = {}, mob = DEFAULT_MOBILITY) {
  const s = spec && typeof spec === "object" ? spec : {};
  const age = AGES[s.age] ? s.age : "adult";
  const licence = typeof s.licence === "boolean" ? s.licence && age !== "child" : age !== "child";
  const speed = Number(s.base_mps);
  return {
    age, aid: AIDS[s.aid] ? s.aid : "none", luggage: LUGGAGE[s.luggage] ? s.luggage : "none", licence, car: s.car === true && licence,
    base_mps: Math.round((s.base_mps != null && Number.isFinite(speed) && speed > 0 ? clamp(speed, ...BASE_MPS) : mob.walk_mean_mps) * 100) / 100,
  };
}

/** The factor of the walking speed of a profile's traits (its age, aid and luggage). */
export function speedFactor(profile, mob = DEFAULT_MOBILITY) {
  const f = (trait) => mob[`speed_${trait}`] ?? 1;
  return f(profile?.age) * f(profile?.aid) * f(profile?.luggage);
}

/** How fast a person walks (m/s): the base speed × the factors of their traits, cut to 0.3–2.2 m/s. */
export function walkingSpeed(profile, mob = DEFAULT_MOBILITY) {
  const base = Number.isFinite(profile?.base_mps) ? profile.base_mps : mob.walk_mean_mps;
  return Math.round(clamp(base * speedFactor(profile, mob), MIN_MPS, MAX_MPS) * 100) / 100;
}

/** Is boarding level (step-free): the step (up or down) and the gap at most {@link STEP_FREE_M}? */
export function isLevel(step_m = 0, gap_m = 0) {
  return Math.abs(step_m) <= STEP_FREE_M + 1e-9 && gap_m <= STEP_FREE_M + 1e-9;
}

/**
 * How long a person takes to get on (or off) a vehicle through a door, and whether they can:
 * `board_s`, plus `board_step_s` per 10 cm of step, × the larger of the factors of their age and
 * their aid (level or with a step: an old person with a rollator is as slow as the rollator makes
 * them, not slower again for their age), plus the loading time of their luggage (twice as long with
 * a step). A wheelchair
 * gets on only at level boarding or with help: a ramp the driver puts out (`ramp_s`, for a step of
 * at most {@link RAMP_MAX_M}) or the lift of the station's staff (`lift_s`).
 * @param {object} profile
 * @param {{step_m?: number, gap_m?: number, assist?: "ramp" | "lift" | null}} [access] the step between the
 *   platform (or the kerb) and the floor at the door (m, up or down), the gap (m), the help there is
 * @returns {{s: number, ok: boolean, level: boolean, assist: string | null, help: number, why: string | null,
 *   extra: {age: number, aid: number, luggage: number}}} `help`: the seconds of the help in `s` (a ramp
 *   once out serves the next one too); `extra`: the seconds each adds to a person without traits (the
 *   help in `aid`)
 */
export function boardingTime(profile, { step_m = 0, gap_m = 0, assist = null } = {}, mob = DEFAULT_MOBILITY) {
  const p = profile || {}, level = isLevel(step_m, gap_m);
  const factorOf = (trait) => {
    const lv = mob[`board_${trait}`];
    return lv == null ? 1 : level ? lv : mob[`board_${trait}_step`] ?? lv;
  };
  let base = mob.board_s + (level ? 0 : (Math.abs(step_m) / 0.1) * mob.board_step_s);
  const fAge = factorOf(p.age);
  let fAid = factorOf(p.aid), help = 0, used = null;
  if (p.aid === "wheelchair" && !level) {
    const helped = assist === "lift" || (assist === "ramp" && Math.abs(step_m) <= RAMP_MAX_M + 1e-9);
    if (!helped) return { s: 0, ok: false, level, assist: null, help: 0, why: assist === "ramp" ? "the step is too high for the ramp" : "no level boarding", extra: { age: 0, aid: 0, luggage: 0 } };
    used = assist;
    help = assist === "ramp" ? mob.ramp_s : mob.lift_s;
    // on the ramp or the lift: as at level boarding
    base = mob.board_s;
    fAid = mob.board_wheelchair;
  }
  const load = (p.luggage === "heavy" ? mob.load_heavy_s : p.luggage === "bulky" ? mob.load_bulky_s : 0) * (level ? 1 : 2);
  const round = (x) => Math.round(x * 10) / 10;
  const f = Math.max(fAge, fAid);
  const s = base * f + help + load;
  return { s: round(s), ok: true, level, assist: used, help, why: null, extra: { age: round(base * (fAge - 1)), aid: round(base * (f - fAge) + help), luggage: round(load) } };
}

/**
 * The room a person takes in a vehicle, in spaces (a person alone 1, a child `space_child`), with
 * what their aid and luggage add; `min`: squeezed as far as it goes (a wheelchair and bulky luggage
 * are not squeezed); `wheelchair`: needs a wheelchair place. In `racks` (a train's luggage racks)
 * heavy luggage takes no room.
 * @param {object} profile
 * @param {{racks?: boolean}} [where]
 * @returns {{space: number, min: number, wheelchair: boolean}}
 */
export function spaceOf(profile, { racks = false } = {}, mob = DEFAULT_MOBILITY) {
  const p = profile || {};
  const own = p.age === "child" ? mob.space_child : 1;
  let space = own, min = own * mob.squeeze_person;
  const add = (s, m) => {
    space += s;
    min += Math.min(s, m);
  };
  if (p.aid === "rollator") add(mob.space_rollator, mob.squeeze_rollator);
  else if (p.aid === "pram") add(mob.space_pram, mob.squeeze_pram);
  else if (p.aid === "wheelchair") add(mob.space_wheelchair, mob.space_wheelchair);
  if (p.luggage === "heavy" && !racks) add(mob.space_heavy, mob.squeeze_heavy);
  else if (p.luggage === "bulky") add(mob.space_bulky, mob.space_bulky);
  const round = (x) => Math.round(x * 100) / 100;
  return { space: round(space), min: round(min), wheelchair: p.aid === "wheelchair" };
}

/**
 * Seconds at each end of a trip by car besides the walk to and from the car: luggage into (or out
 * of) the boot, a pram folded and the child in its seat, a wheelchair user into the seat and the
 * wheelchair folded. For the people of a car together: the sum of theirs.
 * @param {object | object[]} profiles
 */
export function carLegTime(profiles, mob = DEFAULT_MOBILITY) {
  let s = 0;
  for (const p of [profiles].flat().filter(Boolean)) {
    if (p.luggage === "heavy" || p.luggage === "bulky") s += mob.car_luggage_s;
    if (p.aid === "pram") s += mob.car_pram_s;
    if (p.aid === "wheelchair") s += mob.car_wheelchair_s;
  }
  return s;
}

/** May a person drive: a driving licence and a car? */
export const canDrive = (profile) => !!(profile?.licence && profile?.car);

/** The characteristics of a profile in words ("old · rollator · heavy luggage"), "no special needs" without any. */
export function profileWords(profile) {
  if (!profile) return "";
  const parts = [profile.age !== "adult" ? AGES[profile.age] : null, profile.aid !== "none" ? AIDS[profile.aid] : null, profile.luggage !== "none" ? LUGGAGE[profile.luggage] : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "no special needs";
}

/** Driving in words: "driving licence and a car", "driving licence, no car", "no driving licence"; "" for children. */
export function drivingWords(profile) {
  if (!profile || profile.age === "child") return "";
  return profile.licence ? (profile.car ? "driving licence and a car" : "driving licence, no car") : "no driving licence";
}

/** The groups the statistics count people in, in words (see {@link profileGroups}). */
export const GROUPS = {
  all: "everybody", child: "children", adult: "adults", old: "old people", stick: "walking stick", rollator: "rollator",
  wheelchair: "wheelchair", pram: "pram", luggage: "heavy or bulky luggage", captive: "no licence or no car",
};

/**
 * The groups of the statistics a person belongs to: all, their age group, their aid, heavy or bulky
 * luggage, and captive (an adult or old person without a licence or a car: public transport or on foot).
 */
export function profileGroups(profile) {
  if (!profile) return ["all"];
  const out = ["all", profile.age];
  if (profile.aid && profile.aid !== "none") out.push(profile.aid);
  if (profile.luggage === "heavy" || profile.luggage === "bulky") out.push("luggage");
  if (profile.age !== "child" && !canDrive(profile)) out.push("captive");
  return out;
}
