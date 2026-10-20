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
 * base × 0.83 × 0.46 × 0.85. The shares of the traits and every effect are the cells of one
 * table, a row per trait ({@link PEOPLE}), each with a default and its source; the passenger
 * simulation holds it for the whole layout (`people`, `mobilityOf(world)`). Profiles are drawn
 * from a seeded random stream (always the same five random numbers and one normal one), so a run
 * is reproducible.
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

/**
 * The columns of the table of the people ({@link PEOPLE}): what a value of a row does, its unit and
 * range (a cell may have its own). For an age group `space` is its own room (a person 1), for an aid
 * or luggage the room it adds.
 */
const COLUMNS = {
  share: { label: "Share", unit: "share", min: 0, max: 1, step: 0.01 },
  share_long: { label: "Share on long trips", unit: "share", min: 0, max: 1, step: 0.01 },
  licence: { label: "Driving licence", unit: "share", min: 0, max: 1, step: 0.01 },
  speed: { label: "Walking speed", unit: "factor", min: 0.05, max: 10, step: 0.05 },
  board: { label: "Boarding, level", unit: "factor", min: 0.05, max: 10, step: 0.05 },
  board_step: { label: "Boarding, with a step", unit: "factor", min: 0.05, max: 20, step: 0.05 },
  load_s: { label: "Loading", unit: "s", min: 0, max: 120, step: 0.5 },
  ramp_s: { label: "Ramp", unit: "s", min: 0, max: 600, step: 0.5 },
  lift_s: { label: "Lift or ramp of the station staff", unit: "s", min: 0, max: 600, step: 0.5 },
  space: { label: "Room", unit: "spaces", min: 0, max: 4, step: 0.05 },
  squeeze: { label: "Room squeezed", unit: "spaces", min: 0, max: 4, step: 0.05 },
  car_s: { label: "At the car", unit: "s", min: 0, max: 600, step: 0.5 },
  walk_mps: { label: "Walking speed", unit: "m/s", min: 0.5, max: 2, step: 0.01 },
  walk_sd_mps: { label: "Spread of the walking speed", unit: "m/s", min: 0, max: 0.6, step: 0.01 },
  board_s: { label: "Boarding time", unit: "s", min: 0, max: 10, step: 0.1 },
  board_step_s: { label: "Boarding time per 10 cm of step", unit: "s", min: 0, max: 5, step: 0.1 },
  squeeze_mood: { label: "Mood lost by squeezing", unit: "per space and minute", min: 0, max: 1, step: 0.01 },
  car: { label: "Car available", unit: "share", min: 0, max: 1, step: 0.01 },
};

const cell = (value, source, more = {}) => ({ default: value, source, ...more });
const OF_THE_OLD = "Share of the old people (of the adults a tenth of it).";

/**
 * The table of the people, the passenger simulation's setting `people` (see sims/passengers.js):
 * a row for everybody (a person without traits) and one per trait (age, aid, luggage), its cells
 * the effects of the trait, each with its default and `source`. A layout sets only the cells it
 * changes: `"people": {"wheelchair": {"share": 0.02}, "everybody": {"walk_mps": 1.3}}`.
 * @type {ReadonlyArray<{key: string, label: string, cells: Readonly<Record<string, {key: string, label: string,
 *   unit: string, min: number, max: number, step: number, default: number, source: string, help?: string}>>}>}
 */
export const PEOPLE = Object.freeze([
  ["everybody", "Everybody", {
    walk_mps: cell(1.34, "Weidmann 1993", { help: "The mean of the normal distribution the base speed is drawn from." }),
    walk_sd_mps: cell(0.26, "Weidmann 1993", { help: "Its standard deviation (cut to 0.5–2.2 m/s)." }),
    board_s: cell(1.5, "Weidmann 1994: 1.2–2 s a person and door stream at level boarding", { help: "At a door at level boarding." }),
    board_step_s: cell(0.4, "Estimate after Weidmann 1994", { help: "More per 10 cm of step." }),
    squeeze: cell(0.8, "Estimate: standing closer", { unit: "of its room", min: 0.1, max: 1, help: "A person squeezed takes this much of its room." }),
    squeeze_mood: cell(0.05, "Estimate", { help: "Every space a person is squeezed out of costs this much mood per minute of the ride (0 … 1)." }),
    car: cell(0.75, "MiD 2017", { help: "Share of the people with a driving licence who have a car available." }),
  }],
  ["child", "Children", {
    share: cell(0.15, "Destatis 2023: 14 % are younger than 15", { help: "Share of the people." }),
    speed: cell(0.9, "Estimate after Weidmann 1993"),
    board: cell(1.2, "Estimate"),
    board_step: cell(1.6, "Estimate"),
    space: cell(0.7, "Estimate", { min: 0.1, max: 1, help: "Its own room (a person 1)." }),
  }],
  ["adult", "Adults", {
    licence: cell(0.87, "MiD 2017"),
  }],
  ["old", "Old people (65 and older)", {
    share: cell(0.22, "Destatis 2023: 22 %", { help: "Share of the people." }),
    speed: cell(0.83, "Knoblauch et al. 1996: 1.25 of 1.51 m/s"),
    board: cell(1.3, "Estimate after Weidmann 1994"),
    board_step: cell(2.5, "Estimate after Weidmann 1994"),
    licence: cell(0.75, "MiD 2017 (fewer among the very old)"),
  }],
  ["stick", "Walking stick", {
    share: cell(0.1, "Estimate", { help: OF_THE_OLD }),
    speed: cell(0.65, "Boyce et al. 1999: 0.81 of 1.24 m/s"),
    board: cell(1.5, "Estimate"),
    board_step: cell(3, "Estimate"),
  }],
  ["rollator", "Rollator", {
    share: cell(0.06, "Estimate: about 2 million rollators in Germany", { help: OF_THE_OLD }),
    speed: cell(0.46, "Boyce et al. 1999: 0.57 of 1.24 m/s"),
    board: cell(2, "Estimate"),
    board_step: cell(4, "Estimate: the rollator is lifted in"),
    space: cell(0.7, "Estimate"),
    squeeze: cell(0.3, "Estimate: folded"),
  }],
  ["wheelchair", "Wheelchair", {
    share: cell(0.01, "About 1.6 million wheelchair users in Germany (2 %); fewer of them travel", { help: "Share of the people." }),
    speed: cell(0.7, "Boyce et al. 1999: 0.69 (manual) to 0.89 m/s (electric) of 1.24 m/s"),
    board: cell(2.5, "Estimate", { help: "At level boarding, and on a ramp or a lift." }),
    ramp_s: cell(60, "TCQSM 2013: 30–60 s for a ramp the driver puts out", { help: "A vehicle's folding ramp, for a step of at most 25 cm." }),
    lift_s: cell(120, "TCQSM 2013: 60–200 s for a lift", { help: "Where the platform has assistance (06:00–22:00)." }),
    space: cell(1.5, "Estimate (in a wheelchair place; not squeezed)"),
    car_s: cell(120, "Estimate: into the seat, the wheelchair folded"),
  }],
  ["pram", "Pram", {
    share: cell(0.03, "Estimate", { help: "Share of the adults pushing a pram (Kinderwagen; of the old a third of it)." }),
    speed: cell(0.9, "Estimate"),
    board: cell(2, "Estimate"),
    board_step: cell(5, "Estimate: lifted in, often with help"),
    space: cell(1.5, "Estimate"),
    squeeze: cell(1.2, "Estimate: a pram with a baby is not folded"),
    car_s: cell(60, "Estimate: folded, the child in its seat"),
  }],
  ["light", "Light luggage", {
    share: cell(0.45, "Estimate", { help: "Share of the people with a bag or a backpack." }),
  }],
  ["heavy", "Heavy luggage", {
    share: cell(0.03, "Estimate", { help: "Share with a suitcase on trips up to 5 km (half of it to work or school)." }),
    share_long: cell(0.35, "Estimate (long-distance trains, holidays, weekend commuters)", { help: "On trips of 100 km and more; in between it grows with the length of the trip." }),
    speed: cell(0.85, "Young 1999 (airport terminals)"),
    load_s: cell(3, "Estimate (twice as long with a step)"),
    space: cell(0.5, "Estimate (none in a train's luggage racks)"),
    squeeze: cell(0.2, "Estimate: on the lap, between the legs"),
    car_s: cell(20, "Estimate: into the boot"),
  }],
  ["bulky", "Bulky luggage", {
    share: cell(0.02, "Estimate", { help: "Share with a bike, skis or something as large." }),
    speed: cell(0.8, "Estimate"),
    load_s: cell(8, "Estimate (twice as long with a step)"),
    space: cell(1.5, "Estimate (not squeezed)"),
    car_s: cell(20, "Estimate: into the boot"),
  }],
].map(([key, label, cells]) => Object.freeze({
  key, label, cells: Object.freeze(Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, Object.freeze({ key: k, ...COLUMNS[k], ...c })]))),
})));

/**
 * The characteristics of people as settings (ParamSpecs of the passenger simulation, see
 * sims/passengers.js): the table of the people ({@link PEOPLE}; no default of its own, so a layout
 * keeps only the cells it changes) and the room in the vehicles.
 */
export const MOBILITY_PARAMS = Object.freeze([
  { key: "people", label: "People", type: "table", rows: PEOPLE, help: "Per trait (age, aid, luggage) its share and what it changes: walking speed, boarding, room, the car; a row for everybody. A layout sets only the cells it changes." },
  { key: "standing_per_m2", label: "Standing room", type: "number", unit: "people per m²", min: 1, max: 8, step: 0.5, default: 4, help: "People standing per m² of a vehicle's standing room (its capacity in spaces: seats and standing room).", source: "VDV: 4 people per m² for planning" },
  { key: "onboard_share", label: "Riding through", type: "number", unit: "share of the spaces", min: 0, max: 1, step: 0.05, default: 0.25, help: "A vehicle comes in with the people who get off, its riders of the town and the journeys, and this share of its spaces taken by people riding on (at the normal daytime level; more in the rush hours).", source: "Estimate" },
]);

/** The keys of the settings. */
export const MOBILITY_KEYS = Object.freeze(MOBILITY_PARAMS.map((p) => p.key));

/** A value of a setting where it is a number, cut to its range; else its default. */
function numberIn(raw, spec) {
  const v = Number(raw);
  return raw !== undefined && raw !== null && raw !== "" && typeof raw !== "boolean" && Number.isFinite(v) ? clamp(v, spec.min, spec.max) : spec.default;
}

/**
 * The settings of mobility with their defaults: each row of the table of the people
 * (`mob.old.speed`, `mob.everybody.walk_mps`) with the cells of `config.people` where they are
 * numbers in their range (else the default), and the room in the vehicles (`mob.standing_per_m2`,
 * `mob.onboard_share`).
 * @param {object} [config] e.g. the passenger simulation's config
 * @returns {Readonly<Record<string, any>>}
 */
export function mobilitySettings(config = {}) {
  const out = {}, people = config?.people && typeof config.people === "object" ? config.people : {};
  for (const row of PEOPLE) {
    const given = people[row.key] && typeof people[row.key] === "object" ? people[row.key] : {};
    out[row.key] = Object.freeze(Object.fromEntries(Object.values(row.cells).map((c) => [c.key, numberIn(given[c.key], c)])));
  }
  for (const p of MOBILITY_PARAMS) if (p.type === "number") out[p.key] = numberIn(config?.[p.key], p);
  return Object.freeze(out);
}

/** The settings with every default. */
export const DEFAULT_MOBILITY = mobilitySettings({});

/**
 * Problems of a table of the people as a layout writes it (`people`): rows and cells it does not
 * know (a typo would be lost silently), cells that are not numbers.
 * @param {*} people
 * @returns {string[]}
 */
export function peopleProblems(people) {
  if (people === undefined) return [];
  if (!people || typeof people !== "object" || Array.isArray(people)) return ["people must be an object of rows, e.g. {\"wheelchair\": {\"share\": 0.02}}"];
  const out = [];
  for (const [key, given] of Object.entries(people)) {
    const row = PEOPLE.find((r) => r.key === key);
    if (!row) {
      out.push(`people: no row "${key}" (${PEOPLE.map((r) => r.key).join(", ")})`);
      continue;
    }
    if (!given || typeof given !== "object" || Array.isArray(given)) {
      out.push(`people.${key} must be an object of cells (${Object.keys(row.cells).join(", ")})`);
      continue;
    }
    for (const [k, v] of Object.entries(given)) {
      if (!row.cells[k]) out.push(`people.${key}: no cell "${k}" (${Object.keys(row.cells).join(", ")})`);
      else if (typeof v !== "number" || !Number.isFinite(v)) out.push(`people.${key}.${k} must be a number`);
    }
  }
  return out;
}

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
  return [["wheelchair", mob.wheelchair.share], ["rollator", mob.rollator.share * k], ["stick", mob.stick.share * k], ["pram", age === "adult" ? mob.pram.share : age === "old" ? mob.pram.share / 3 : 0]];
}

/**
 * The luggage people carry on a trip: [[class, share], …]. Heavy luggage grows with the length of
 * the trip (from `heavy.share` up to 5 km to `heavy.share_long` at 100 km), half of it to work or
 * school; children carry a third as much heavy and bulky luggage.
 * @param {{km?: number, purpose?: string | null}} [trip]
 * @param {string} [age]
 */
export function luggageShares({ km = SHORT_KM, purpose = null } = {}, age = "adult", mob = DEFAULT_MOBILITY) {
  const long = clamp((Number(km) - SHORT_KM) / (LONG_KM - SHORT_KM), 0, 1) || 0;
  let heavy = mob.heavy.share + (mob.heavy.share_long - mob.heavy.share) * long;
  if (purpose === "work" || purpose === "school") heavy *= 0.5;
  const kid = age === "child" ? 1 / 3 : 1;
  const bulky = mob.bulky.share * kid;
  heavy *= kid;
  return [["bulky", bulky], ["heavy", heavy], ["light", Math.min(mob.light.share, Math.max(0, 1 - bulky - heavy))]];
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
 * @param {Readonly<Record<string, any>>} [mob] the settings
 * @returns {{age: string, aid: string, luggage: string, licence: boolean, car: boolean, base_mps: number}}
 */
export function drawProfile(rng, ctx = {}, mob = DEFAULT_MOBILITY) {
  const u = [rng.next(), rng.next(), rng.next(), rng.next(), rng.next()];
  const base = rng.truncNormal(mob.everybody.walk_mps, mob.everybody.walk_sd_mps, BASE_MPS[0], BASE_MPS[1]);
  const driver = !!ctx.driver;
  let age = ctx.age;
  if (!AGES[age]) {
    if (driver) age = u[0] < mob.old.share / Math.max(1e-9, 1 - mob.child.share) ? "old" : "adult";
    else age = pick(u[0], [["child", mob.child.share], ["old", mob.old.share]], "adult");
  }
  const aid = AIDS[ctx.aid] ? ctx.aid : pick(u[1], aidShares(age, mob), "none");
  const luggage = LUGGAGE[ctx.luggage] ? ctx.luggage : pick(u[2], luggageShares(ctx, age, mob), "none");
  const licence = typeof ctx.licence === "boolean" ? ctx.licence : driver || (age !== "child" && u[3] < mob[age].licence);
  const car = typeof ctx.car === "boolean" ? ctx.car && licence : driver || (licence && u[4] < mob.everybody.car);
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
    base_mps: Math.round((s.base_mps != null && Number.isFinite(speed) && speed > 0 ? clamp(speed, ...BASE_MPS) : mob.everybody.walk_mps) * 100) / 100,
  };
}

/** The factor of the walking speed of a profile's traits (its age, aid and luggage). */
export function speedFactor(profile, mob = DEFAULT_MOBILITY) {
  const f = (trait) => mob[trait]?.speed ?? 1;
  return f(profile?.age) * f(profile?.aid) * f(profile?.luggage);
}

/** How fast a person walks (m/s): the base speed × the factors of their traits, cut to 0.3–2.2 m/s. */
export function walkingSpeed(profile, mob = DEFAULT_MOBILITY) {
  const base = Number.isFinite(profile?.base_mps) ? profile.base_mps : mob.everybody.walk_mps;
  return Math.round(clamp(base * speedFactor(profile, mob), MIN_MPS, MAX_MPS) * 100) / 100;
}

/** Is boarding level (step-free): the step (up or down) and the gap at most {@link STEP_FREE_M}? */
export function isLevel(step_m = 0, gap_m = 0) {
  return Math.abs(step_m) <= STEP_FREE_M + 1e-9 && gap_m <= STEP_FREE_M + 1e-9;
}

/**
 * How long a person takes to get on (or off) a vehicle through a door, and whether they can:
 * `everybody.board_s`, plus `everybody.board_step_s` per 10 cm of step, × the larger of the factors
 * of their age and their aid (`board` level, `board_step` with a step: an old person with a rollator
 * is as slow as the rollator makes them, not slower again for their age), plus the loading time of
 * their luggage (`load_s`, twice as long with a step). A wheelchair gets on only at level boarding
 * or with help: a ramp the driver puts out (`wheelchair.ramp_s`, for a step of at most
 * {@link RAMP_MAX_M}) or the lift of the station's staff (`wheelchair.lift_s`).
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
    const row = mob[trait], lv = row?.board;
    return lv == null ? 1 : level ? lv : row.board_step ?? lv;
  };
  const every = mob.everybody;
  let base = every.board_s + (level ? 0 : (Math.abs(step_m) / 0.1) * every.board_step_s);
  const fAge = factorOf(p.age);
  let fAid = factorOf(p.aid), help = 0, used = null;
  if (p.aid === "wheelchair" && !level) {
    const helped = assist === "lift" || (assist === "ramp" && Math.abs(step_m) <= RAMP_MAX_M + 1e-9);
    if (!helped) return { s: 0, ok: false, level, assist: null, help: 0, why: assist === "ramp" ? "the step is too high for the ramp" : "no level boarding", extra: { age: 0, aid: 0, luggage: 0 } };
    used = assist;
    help = assist === "ramp" ? mob.wheelchair.ramp_s : mob.wheelchair.lift_s;
    // on the ramp or the lift: as at level boarding
    base = every.board_s;
    fAid = mob.wheelchair.board;
  }
  const load = (mob[p.luggage]?.load_s ?? 0) * (level ? 1 : 2);
  const round = (x) => Math.round(x * 10) / 10;
  const f = Math.max(fAge, fAid);
  const s = base * f + help + load;
  return { s: round(s), ok: true, level, assist: used, help, why: null, extra: { age: round(base * (fAge - 1)), aid: round(base * (f - fAge) + help), luggage: round(load) } };
}

/**
 * The room a person takes in a vehicle, in spaces: their own (a person 1, the `space` of their age
 * group: a child 0.7) and the `space` their aid and luggage add; `min`: squeezed as far as it goes
 * (their own room × `everybody.squeeze`, an aid or luggage its `squeeze`; without one, as a
 * wheelchair and bulky luggage, it is not squeezed); `wheelchair`: needs a wheelchair place. In
 * `racks` (a train's luggage racks) heavy luggage takes no room.
 * @param {object} profile
 * @param {{racks?: boolean}} [where]
 * @returns {{space: number, min: number, wheelchair: boolean}}
 */
export function spaceOf(profile, { racks = false } = {}, mob = DEFAULT_MOBILITY) {
  const p = profile || {};
  const own = mob[p.age]?.space ?? 1;
  let space = own, min = own * mob.everybody.squeeze;
  for (const trait of [p.aid, p.luggage]) {
    const row = mob[trait];
    if (!row?.space || (trait === "heavy" && racks)) continue;
    space += row.space;
    min += Math.min(row.space, row.squeeze ?? row.space);
  }
  const round = (x) => Math.round(x * 100) / 100;
  return { space: round(space), min: round(min), wheelchair: p.aid === "wheelchair" };
}

/**
 * Seconds at each end of a trip by car besides the walk to and from the car (the `car_s` of the
 * aid and the luggage): luggage into (or out of) the boot, a pram folded and the child in its seat,
 * a wheelchair user into the seat and the wheelchair folded. For the people of a car together: the
 * sum of theirs.
 * @param {object | object[]} profiles
 */
export function carLegTime(profiles, mob = DEFAULT_MOBILITY) {
  let s = 0;
  for (const p of [profiles].flat().filter(Boolean)) s += (mob[p.aid]?.car_s ?? 0) + (mob[p.luggage]?.car_s ?? 0);
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
