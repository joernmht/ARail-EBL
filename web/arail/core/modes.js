/**
 * Modes of transport, how people choose between them, and what they learn from their trips.
 *
 * One list of modes for the people of every simulation ({@link MODES}: on foot, by bike, by car, by
 * bus or tram). A person who has a way to go weighs the modes they have by what the trip would cost
 * them: its parts in minutes (walking, waiting, riding, driving, parking), each as people feel it
 * (a minute of waiting counts more than one of riding; walking and cycling count more in rain and
 * cold, {@link exposure}), money as time, and a constant for what the minutes do not tell (a bike
 * has to be fetched and locked, walking needs nothing). The choice is a logit over these costs
 * ({@link chooseMode}): the cheapest mode is taken most often, the others now and then.
 *
 * Nobody knows the traffic before they have been in it. People plan with what a trip would take on
 * empty streets and with a timetable that holds, and learn what it really takes:
 *
 * - a **person** remembers for each of their ways and each mode how the last trips went against the
 *   plan ({@link TripMemory}: the ratio of the time it took to the time planned, and how often it
 *   went badly: a jam, a bus that left without them, soaked by rain), and has a habit;
 * - the **town** remembers the same for everybody, by mode and hour of the day, on working days and
 *   at weekends ({@link Experience}, `world.experience`): what one hears from the others. A person
 *   plans with the town's experience until their own says otherwise.
 *
 * So people who stand in a jam every morning come to expect it, are unhappy with the car, and some
 * take the tram or the bike instead, until the streets carry those who are left: the shares of the
 * modes settle at what the town's streets, stops and parking can take. It is a simple form of
 * reinforcement learning (a contextual bandit: a softmax over learned expected costs, updated by
 * what was experienced), the day-to-day learning of traffic assignment (Horowitz 1984; the
 * co-evolution of MATSim, Horni, Nagel and Axhausen 2016). The cars from beyond the layout learn the
 * same way, as one crowd ({@link carShare}): the more the drive is held up at an hour, the fewer
 * set out at that hour.
 *
 * What the town has learned can be worked out ahead (`tools/mobility-learn.mjs` runs a layout for
 * some weeks without the app) and kept in the layout (`experience`), so that the first morning
 * starts where the learning ends; in the app the learning goes on.
 *
 * Sources: MiD 2017 (Mobilität in Deutschland, infas for the BMVI): the shares of the modes by the
 * length of the trip, bikes per household; Wardman (2004): Public transport values of time,
 * Transport Policy 11; Abrantes and Wardman (2011): Meta-analysis of UK values of travel time,
 * Transportation Research A 45 (walking and waiting count about twice the time on board); Horowitz
 * (1984): The stability of stochastic equilibrium in a two-link transportation network,
 * Transportation Research B 18; Horni, Nagel, Axhausen (2016): The Multi-Agent Transport Simulation
 * MATSim. Values without a source are estimates for teaching.
 * @module arail/core/modes
 */
import { clamp } from "./math.js";

/** The modes of transport of people, in the order they are listed: a label and the words for a trip. */
export const MODES = Object.freeze({
  walk: Object.freeze({ label: "On foot", words: "on foot" }),
  bike: Object.freeze({ label: "Bike", words: "by bike" }),
  transit: Object.freeze({ label: "Bus and tram", words: "by bus or tram" }),
  car: Object.freeze({ label: "Car", words: "by car" }),
});

/** The keys of {@link MODES}. */
export const MODE_KEYS = Object.freeze(Object.keys(MODES));

const cell = (value, source, more = {}) => ({ default: value, source, ...more });
const COLUMNS = {
  constant: { label: "Constant", unit: "min", min: -60, max: 60, step: 0.5, help: "Minutes a trip by this mode costs besides its time (a bike is fetched and locked, the car is looked for a space; less than nothing: liked for itself)." },
  minute: { label: "A minute of it", unit: "factor", min: 0.1, max: 10, step: 0.05, help: "How long a minute of it feels, against a minute on board." },
  own: { label: "Has one", unit: "share", min: 0, max: 1, step: 0.01 },
  spread: { label: "Tastes differ", unit: "min", min: 0, max: 30, step: 0.5, help: "People differ in how they like the mode: the standard deviation of their constants." },
  eur_km: { label: "Costs", unit: "€ per km", min: 0, max: 5, step: 0.01 },
  fare_eur: { label: "Fare", unit: "€ per trip", min: 0, max: 20, step: 0.1 },
  sharpness: { label: "How sure the choice is", unit: "per min", min: 0.01, max: 5, step: 0.005, help: "The scale of the logit: at 0.07 a mode that costs 14 minutes less is taken e (2.7) times as often." },
  wait: { label: "A minute of waiting", unit: "factor", min: 0.1, max: 10, step: 0.05 },
  eur_min: { label: "A minute is worth", unit: "€", min: 0.01, max: 5, step: 0.01 },
  habit: { label: "Habit", unit: "min", min: 0, max: 30, step: 0.5, help: "The mode taken last time on a way counts as this much cheaper." },
  learn: { label: "Learning", unit: "share", min: 0.01, max: 1, step: 0.01, help: "How much the last trip counts in what a person expects of a mode on a way (0.3: about the last three trips)." },
  hearsay: { label: "What the others say", unit: "trips", min: 0, max: 20, step: 0.5, help: "The town's experience counts like this many trips of one's own." },
  anger: { label: "A bad trip", unit: "min", min: 0, max: 60, step: 0.5, help: "A mode that always goes badly (a jam, left behind at the stop) counts as this much more expensive." },
  jam: { label: "A jam", unit: "factor", min: 1.05, max: 5, step: 0.05, help: "A drive that takes this many times as long as on empty streets is a jam: it makes the driver unhappy." },
  quit: { label: "Half give up the car", unit: "factor", min: 1.1, max: 10, step: 0.05, help: "Of the people who come by car from beyond the layout, half come another way (or not at all) when the drive takes this many times as long as on empty streets." },
};

/**
 * The tastes of the people: a row for everybody and one per mode, as the town's setting `modes`
 * (a table like the people's, core/mobility.js: a layout sets only the cells it changes). The
 * constants and the sharpness are fitted to the shares of the modes by the length of the trip of MiD
 * 2017 for somebody who has all four ({@link typicalParts}: of 100 trips of half a kilometre about
 * 60 on foot, 13 by bike, 22 by car, 4 by bus or tram; of one and a half kilometres about 25, 22, 44
 * and 9; of three about 3, 23, 59 and 15; `tests/js/modes.test.js` holds them to it); the rest are the values of the sources and
 * estimates.
 */
export const MODE_TABLE = Object.freeze([
  ["everybody", "Everybody", {
    sharpness: cell(0.07, "Fitted to MiD 2017: how fast walking gives way to the bike between half a kilometre and one and a half"),
    wait: cell(2, "Wardman 2004; Abrantes and Wardman 2011: waiting counts about twice the time on board"),
    eur_min: cell(0.2, "12 € an hour, as the drivers of the road traffic weigh parking fees"),
    habit: cell(7, "Estimate"),
    learn: cell(0.3, "Estimate"),
    hearsay: cell(2, "Estimate"),
    anger: cell(14, "Estimate"),
    jam: cell(2, "Estimate: twice as long as on empty streets"),
    quit: cell(2.2, "Estimate"),
  }],
  ["walk", "On foot", {
    constant: cell(-30, "Fitted to MiD 2017: six of ten trips of half a kilometre are walked, one in four of one and a half"),
    minute: cell(1.6, "Abrantes and Wardman 2011: walking counts 1.5 to 2 times the time on board"),
    spread: cell(5, "Estimate"),
  }],
  ["bike", "Bike", {
    constant: cell(0, "The measure of the other constants"),
    minute: cell(1.3, "Estimate: exercise and exposure"),
    own: cell(0.8, "MiD 2017: 78 % of the households have a bike"),
    spread: cell(14, "Estimate: some ride every day, many never"),
  }],
  ["transit", "Bus and tram", {
    constant: cell(10, "Fitted to MiD 2017: 4 of 100 trips of half a kilometre, 9 of one and a half"),
    minute: cell(1, "The time on board is the measure of the others"),
    fare_eur: cell(0.6, "Estimate: a monthly ticket, per trip"),
    spread: cell(7, "Estimate"),
  }],
  ["car", "Car", {
    constant: cell(-7, "Fitted to MiD 2017: one trip in five of half a kilometre, nearly half of one and a half"),
    minute: cell(1, "As the time on board"),
    eur_km: cell(0.2, "Estimate: fuel and wear a kilometre in town"),
    spread: cell(10, "Estimate"),
  }],
].map(([key, label, cells]) => Object.freeze({
  key, label, cells: Object.freeze(Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, Object.freeze({ key: k, ...COLUMNS[k], ...c })]))),
})));

/**
 * The tastes with their defaults, each row of {@link MODE_TABLE} with the cells of `config` where
 * they are numbers in their range: `taste.car.constant`, `taste.everybody.sharpness`.
 * @param {object} [config] the table as a layout writes it, e.g. `{car: {constant: 6}}`
 * @returns {Readonly<Record<string, Readonly<Record<string, number>>>>}
 */
export function modeSettings(config = {}) {
  const out = {}, given = config && typeof config === "object" ? config : {};
  for (const row of MODE_TABLE) {
    const g = given[row.key] && typeof given[row.key] === "object" ? given[row.key] : {};
    out[row.key] = Object.freeze(Object.fromEntries(Object.values(row.cells).map((c) => {
      const v = Number(g[c.key]);
      return [c.key, g[c.key] != null && g[c.key] !== "" && typeof g[c.key] !== "boolean" && Number.isFinite(v) ? clamp(v, c.min, c.max) : c.default];
    })));
  }
  return Object.freeze(out);
}

/** The tastes with every default. */
export const DEFAULT_TASTE = modeSettings({});

/** Problems of a table of tastes as a layout writes it: rows and cells it does not know, cells that are no numbers. */
export function modeProblems(table) {
  if (table === undefined) return [];
  if (!table || typeof table !== "object" || Array.isArray(table)) return ["modes must be an object of rows, e.g. {\"car\": {\"constant\": 6}}"];
  const out = [];
  for (const [key, given] of Object.entries(table)) {
    const row = MODE_TABLE.find((r) => r.key === key);
    if (!row) {
      out.push(`modes: no row "${key}" (${MODE_TABLE.map((r) => r.key).join(", ")})`);
      continue;
    }
    if (!given || typeof given !== "object" || Array.isArray(given)) {
      out.push(`modes.${key} must be an object of cells (${Object.keys(row.cells).join(", ")})`);
      continue;
    }
    for (const [k, v] of Object.entries(given)) {
      if (!row.cells[k]) out.push(`modes.${key}: no cell "${k}" (${Object.keys(row.cells).join(", ")})`);
      else if (typeof v !== "number" || !Number.isFinite(v)) out.push(`modes.${key}.${k} must be a number`);
    }
  }
  return out;
}

/**
 * The parts of a trip of `km` kilometres in a town by each mode, as somebody plans it who knows no
 * more than the length (minutes): on foot at 1.34 m/s on a way 1.3 times the straight line; by bike
 * at 16 km/h, a minute and a half to unlock and lock it; by car at 30 km/h, two minutes to and from
 * it and to park; by bus or tram 200 m on foot, half the interval waiting (`waitMin`), the ride at
 * 25 km/h. What the constants are fitted on, and what a town expects of a way before anybody has
 * gone it (sims/town.js).
 * @param {number} km the straight line
 * @param {{waitMin?: number, taste?: object}} [o]
 * @returns {Record<string, object>} mode → parts
 */
export function typicalParts(km, { waitMin = 1.25, taste = DEFAULT_TASTE } = {}) {
  const way = km * 1.3 * 1000;
  return {
    walk: { walk: way / 80.4 },
    bike: { bike: way / (16000 / 60), fixed: 1.5 },
    transit: { walk: 2.5, wait: waitMin, ride: (km * 1000) / (25000 / 60), eur: taste.transit.fare_eur },
    car: { drive: way / 500, fixed: 2.2, eur: (taste.car.eur_km * way) / 1000 },
  };
}

/**
 * The shares of the modes for a trip of `km` kilometres among those who have them (`has`: the modes
 * a person has, all four by default), by the tastes: a logit over the costs of {@link typicalParts}.
 * @returns {Record<string, number>} mode → share (0 for a mode not had)
 */
export function typicalShares(km, { taste = DEFAULT_TASTE, has = MODE_KEYS, waitMin = 1.25, weather = null } = {}) {
  const parts = typicalParts(km, { waitMin, taste });
  const options = has.map((mode) => ({ mode, cost: perceived(mode, parts[mode], { taste, weather }) }));
  const p = choiceShares(options, taste.everybody.sharpness);
  return Object.fromEntries(MODE_KEYS.map((m) => [m, p[options.findIndex((o) => o.mode === m)] ?? 0]));
}

/** How the weather, the dark and the person change what a minute outside feels like (see {@link exposure}). */
export const EXPOSURE = Object.freeze({
  /** A minute on foot or at a stop in rain, in heavy rain, in snowfall, in frost, in heat (over `hot_c`), in the dark. */
  rain: 1.3, heavy_rain: 1.6, snow: 1.3, frost: 1.15, heat: 1.15, hot_c: 30, dark: 1.1,
  /** A minute on foot on snow that lies, on ice. */
  snow_ground: 1.15, ice: 1.4,
  /** A minute on the bike in the dark; children and old people mind the dark more. */
  bike_dark: 1.15, timid_dark: 1.5,
});

/**
 * What a minute outside feels like now, against a mild dry day (1): `walk` and `wait` as factors of
 * the minutes on foot and at a stop, `bike` as the share of the cyclists of a mild dry day who would
 * still ride (the weather's own figure, `Weather.cycleShare()`: half in rain, a fifth on snow), and
 * `dark`. All 1 while the weather is off.
 * @param {{now: Function, on: boolean, cycleShare: Function} | null} weather the world's weather
 * @param {boolean} [dark] is it night?
 * @returns {{walk: number, wait: number, bike: number, dark: boolean}}
 */
export function exposure(weather, dark = false) {
  const out = { walk: 1, wait: 1, bike: 1, dark: !!dark };
  if (dark) out.walk *= EXPOSURE.dark;
  if (!weather?.on) return out;
  const n = weather.now(), E = EXPOSURE;
  let f = 1;
  if (n.precipitation === "rain" || n.precipitation === "sleet") f *= n.rate_mm_h >= 4 ? E.heavy_rain : E.rain;
  else if (n.precipitation === "snow") f *= E.snow;
  if (n.temperature_c <= 0) f *= E.frost;
  else if (n.temperature_c >= E.hot_c) f *= E.heat;
  out.wait *= f;
  out.walk *= f * (n.ice ? E.ice : n.snow_cm > 1 ? E.snow_ground : 1);
  out.bike = clamp(weather.cycleShare(), 0.01, 1);
  return out;
}

/**
 * What a person brings to the choice: which modes they have at all, and how they feel about each.
 * A child rides a bike but drives no car; nobody rides a bike with a rollator, a wheelchair, a pram
 * or a suitcase; old people and those with an aid walk and wait less gladly.
 * @param {{age?: string, aid?: string, luggage?: string} | null} profile core/mobility.js
 * @returns {{walk: number, wait: number, bike: number, canBike: boolean}} factors of the minutes on foot,
 *   at a stop and on the bike
 */
export function personFactors(profile) {
  const p = profile || {};
  const aid = { stick: 1.4, rollator: 1.8, wheelchair: 1.5, pram: 1.2 }[p.aid] ?? 1;
  const load = p.luggage === "heavy" ? 1.5 : p.luggage === "bulky" ? 1.7 : 1;
  const old = p.age === "old" ? 1.2 : 1;
  return {
    walk: aid * load * old, wait: p.age === "old" || aid > 1 ? 1.2 : 1, bike: old * (p.age === "child" ? 1.1 : 1),
    canBike: !(aid > 1) && p.luggage !== "heavy" && p.luggage !== "bulky",
  };
}

/**
 * What a trip costs a person, in minutes as they feel them: the parts of the trip (minutes) by the
 * tastes, the weather and the person, money as time, and the mode's constant. The bike's cost also
 * carries the weather's share of cyclists as ln(share) / sharpness, so that the odds of riding fall
 * by just that share.
 * @param {string} mode a key of {@link MODES}
 * @param {{walk?: number, wait?: number, ride?: number, drive?: number, bike?: number, fixed?: number, eur?: number}} parts
 *   minutes on foot, at a stop, on board, driving, riding the bike; `fixed`: minutes that are what
 *   they are (unlocking the bike, loading the car, parking); `eur`: fares, fees and what the drive costs
 * @param {{taste?: object, weather?: {walk: number, wait: number, bike: number, dark: boolean}, person?: object,
 *   own?: number}} [ctx] the tastes ({@link modeSettings}), {@link exposure}, {@link personFactors}, and the
 *   person's own liking of the mode (minutes, less is liked)
 * @returns {number}
 */
export function perceived(mode, parts, { taste = DEFAULT_TASTE, weather = null, person = null, own = 0 } = {}) {
  const T = taste, W = weather || { walk: 1, wait: 1, bike: 1, dark: false }, P = person || { walk: 1, wait: 1, bike: 1 };
  const walkMin = T.walk.minute * W.walk * P.walk;
  let g = (parts.walk || 0) * walkMin + (parts.wait || 0) * T.everybody.wait * W.wait * P.wait + (parts.ride || 0) * T.transit.minute
    + (parts.drive || 0) * T.car.minute + (parts.fixed || 0) + (parts.eur || 0) / T.everybody.eur_min;
  if (parts.bike) g += parts.bike * T.bike.minute * P.bike * (W.dark ? EXPOSURE.bike_dark : 1);
  g += (T[mode]?.constant ?? 0) + own;
  if (mode === "bike" && W.bike < 1) g -= Math.log(W.bike) / T.everybody.sharpness;
  return g;
}

/**
 * The probabilities of a logit choice among options by their cost: p ∝ exp(−sharpness × cost).
 * @param {Array<{cost: number}>} options
 * @param {number} sharpness per minute
 * @returns {number[]}
 */
export function choiceShares(options, sharpness = DEFAULT_TASTE.everybody.sharpness) {
  if (!options.length) return [];
  const best = Math.min(...options.map((o) => o.cost));
  const w = options.map((o) => (Number.isFinite(o.cost) ? Math.exp(-sharpness * (o.cost - best)) : 0));
  const total = w.reduce((s, x) => s + x, 0);
  return total > 0 ? w.map((x) => x / total) : options.map((_, i) => (i === 0 ? 1 : 0));
}

/**
 * Choose among options by their cost (a logit, {@link choiceShares}), with one random number.
 * @template {{cost: number}} T
 * @param {{next: Function}} rng
 * @param {T[]} options
 * @param {number} [sharpness]
 * @returns {T | null}
 */
export function chooseMode(rng, options, sharpness = DEFAULT_TASTE.everybody.sharpness) {
  if (!options.length) return null;
  const p = choiceShares(options, sharpness);
  let u = rng.next();
  for (let i = 0; i < options.length; i++) {
    if (u < p[i]) return options[i];
    u -= p[i];
  }
  return options[options.length - 1];
}

/** A ratio of the time a trip took to the time planned is cut to this range before it is learned. */
const RATIO = [0.5, 6];

/**
 * What one person remembers of their ways: for each way (`key`, e.g. "home>office") and mode the
 * ratio of the time the last trips took to the time planned (`ratio`), how many trips (`n`), how
 * badly they went (`bad`, 0 … 1) and which mode was taken last. Kept small: the ways of a day.
 */
export class TripMemory {
  constructor() {
    /** @type {Map<string, {last: string | null, modes: Record<string, {ratio: number, n: number, bad: number}>}>} */
    this.ways = new Map();
  }

  /** What is remembered of a mode on a way, or null. */
  of(key, mode) {
    return this.ways.get(key)?.modes[mode] ?? null;
  }

  /** The mode taken last on a way, or null. */
  last(key) {
    return this.ways.get(key)?.last ?? null;
  }

  /**
   * A trip was made: learn its ratio (the time it took to the time planned) and whether it went badly.
   * @param {string} key the way
   * @param {string} mode
   * @param {number} ratio
   * @param {boolean} bad a jam, left behind at the stop, soaked by rain
   * @param {number} [rate] how much the last trip counts
   */
  learn(key, mode, ratio, bad = false, rate = DEFAULT_TASTE.everybody.learn) {
    let way = this.ways.get(key);
    if (!way) {
      // (the ways of a few days: the oldest goes)
      if (this.ways.size >= 12) this.ways.delete(this.ways.keys().next().value);
      this.ways.set(key, (way = { last: null, modes: {} }));
    }
    const r = clamp(Number.isFinite(ratio) ? ratio : 1, RATIO[0], RATIO[1]);
    const m = way.modes[mode] || (way.modes[mode] = { ratio: r, n: 0, bad: 0 });
    const a = m.n ? rate : 1;
    m.ratio += a * (r - m.ratio);
    m.bad += rate * ((bad ? 1 : 0) - m.bad);
    m.n++;
    way.last = mode;
  }
}

/** Hours of a day, and the kinds of day the town's experience tells apart. */
const HOURS = 24;
export const DAY_KINDS = Object.freeze(["weekday", "weekend"]);

/**
 * How the town's experience is learned: an hour's trips move what is expected of that hour by
 * `rate` (less when they were few: `few` trips count half), so a bad morning does not turn the town
 * round at once and a good one is not forgotten either (the method of successive averages of traffic
 * assignment, in spirit); while an hour runs, its trips so far count like `today` trips of before.
 */
export const LEARNING = Object.freeze({ rate: 0.35, few: 4, today: 8 });

/**
 * What the town has learned about its modes: for each mode, kind of day and hour of the day the
 * ratio of the time trips took to the time planned (1: as planned; 2: twice as long). Every trip
 * made is noted for the hour it began in (`learn`); when the hour is over, its trips move what the
 * town expects of that hour (`tick`, see {@link LEARNING}). `ratio` reads between the hours, with
 * the trips of the hour that runs. Kept in the layout as `experience` (`toJSON`):
 * `{days, modes: {car: {weekday: [24 ratios], weekend: […]}, …}}`; hours nobody travelled in stay at 1.
 */
export class Experience {
  /** @param {object | null} [saved] the layout's `experience` */
  constructor(saved = null) {
    this.configure(saved);
  }

  /** Take what a layout has kept (or forget everything). */
  configure(saved = null) {
    const s = saved && typeof saved === "object" ? saved : {};
    /** Days of learning behind it (a layout's: as worked out ahead; in the app the days run on). */
    this.days = Number.isFinite(+s.days) && +s.days > 0 ? +s.days : 0;
    /** Was it taken from a layout (worked out ahead)? */
    this.given = !!(s.modes && typeof s.modes === "object");
    /** @type {Record<string, Record<string, Float64Array>>} mode → kind of day → 24 ratios */
    this.table = {};
    /** The trips of the hours not yet over: mode → kind of day → hour → {sum, n}. */
    this.open = new Map();
    /** Trips learned from, by mode (since it was made). */
    this.trips = {};
    this._hour = null;
    this._day = null;
    for (const mode of MODE_KEYS) {
      this.table[mode] = {};
      this.trips[mode] = 0;
      for (const kind of DAY_KINDS) {
        const row = new Float64Array(HOURS).fill(1), given = s.modes?.[mode]?.[kind];
        if (Array.isArray(given)) for (let h = 0; h < HOURS; h++) if (Number.isFinite(+given[h])) row[h] = clamp(+given[h], RATIO[0], RATIO[1]);
        this.table[mode][kind] = row;
      }
    }
  }

  /**
   * The ratio the town expects of a mode at a time of day: read between the middles of the two
   * hours around it, each with its trips of today so far.
   * @param {string} mode
   * @param {number} minutes time of day (clock minutes)
   * @param {boolean} [weekend]
   */
  ratio(mode, minutes, weekend = false) {
    const kind = weekend ? "weekend" : "weekday", row = this.table[mode]?.[kind];
    if (!row) return 1;
    const x = (((minutes / 60 - 0.5) % HOURS) + HOURS) % HOURS, h = Math.floor(x), t = x - h;
    const at = (hour) => {
      const bin = this.open.size ? this.open.get(`${mode}|${kind}|${hour}`) : null;
      return bin ? (row[hour] * LEARNING.today + bin.sum) / (LEARNING.today + bin.n) : row[hour];
    };
    return at(h) * (1 - t) + at((h + 1) % HOURS) * t;
  }

  /**
   * A trip was made: noted for the hour it began in; the town learns from it when that hour is over.
   * @param {string} mode
   * @param {number} minutes time of day the trip began (clock minutes)
   * @param {boolean} weekend
   * @param {number} ratio the time it took to the time planned
   */
  learn(mode, minutes, weekend, ratio) {
    if (!this.table[mode] || !Number.isFinite(ratio)) return;
    const h = ((Math.floor(minutes / 60) % HOURS) + HOURS) % HOURS, key = `${mode}|${weekend ? "weekend" : "weekday"}|${h}`;
    let bin = this.open.get(key);
    if (!bin) this.open.set(key, (bin = { mode, kind: weekend ? "weekend" : "weekday", hour: h, sum: 0, n: 0 }));
    bin.sum += clamp(ratio, RATIO[0], RATIO[1]);
    bin.n++;
    this.trips[mode]++;
  }

  /**
   * The clock moved on: the hours that are over move what the town expects of them (a trip is noted
   * for the hour it began in, so the hour before the one that runs stays open for those still on the
   * way), and the days are counted.
   * @param {{minutes: number, day: number}} clock
   */
  tick(clock) {
    const hour = Math.floor(clock.minutes / 60) % HOURS;
    if (hour === this._hour && clock.day === this._day) return;
    if (this._day != null && clock.day !== this._day) this.days += Math.max(0, clock.day - this._day) || 1;
    this._hour = hour;
    this._day = clock.day;
    this.settle([hour, (hour + HOURS - 1) % HOURS]);
  }

  /** Learn from the noted trips of all hours but `keep` (see `tick`; none kept: all of them). */
  settle(keep = []) {
    for (const [key, bin] of this.open) {
      if (keep.includes(bin.hour)) continue;
      const row = this.table[bin.mode][bin.kind], mean = bin.sum / bin.n;
      row[bin.hour] += LEARNING.rate * (bin.n / (bin.n + LEARNING.few)) * (mean - row[bin.hour]);
      this.open.delete(key);
    }
  }

  /** Has it learned anything (from a layout, or from trips)? */
  get known() {
    return this.given || MODE_KEYS.some((m) => this.trips[m] > 0);
  }

  /** As a layout keeps it: `{days, modes}`, the ratios rounded to hundredths. */
  toJSON() {
    const modes = {};
    for (const mode of MODE_KEYS) {
      modes[mode] = {};
      for (const kind of DAY_KINDS) modes[mode][kind] = Array.from(this.table[mode][kind], (v) => Math.round(v * 100) / 100);
    }
    return { days: Math.round(this.days), modes };
  }
}

/** Problems of an `experience` as a layout writes it. */
export function experienceProblems(saved) {
  if (saved == null) return [];
  if (typeof saved !== "object" || Array.isArray(saved)) return ["experience must be an object: {days, modes}"];
  const out = [];
  if (saved.days != null && !(Number.isFinite(+saved.days) && +saved.days >= 0)) out.push("experience.days must be a number of days");
  if (saved.modes != null && (typeof saved.modes !== "object" || Array.isArray(saved.modes))) out.push("experience.modes must be an object of modes");
  for (const [mode, kinds] of Object.entries(saved.modes && typeof saved.modes === "object" ? saved.modes : {})) {
    if (!MODES[mode]) {
      out.push(`experience.modes: no mode "${mode}" (${MODE_KEYS.join(", ")})`);
      continue;
    }
    for (const [kind, row] of Object.entries(kinds && typeof kinds === "object" ? kinds : {})) {
      if (!DAY_KINDS.includes(kind)) out.push(`experience.modes.${mode}: no kind of day "${kind}" (${DAY_KINDS.join(", ")})`);
      else if (!Array.isArray(row) || row.length !== HOURS || row.some((v) => !Number.isFinite(+v) || +v <= 0)) out.push(`experience.modes.${mode}.${kind} must be 24 ratios, one per hour`);
    }
  }
  return out;
}

/**
 * The share of the people who would come by car on empty streets and still do when the drive takes
 * `ratio` times as long: a logit that leaves everybody at 1 and half at `quit`, as one crowd (the
 * cars from beyond the layout have no person each to remember their ways).
 * @param {number} ratio the time the drive takes to the time on empty streets
 * @param {number} [quit] the ratio at which half give up the car
 */
export function carShare(ratio, quit = DEFAULT_TASTE.everybody.quit) {
  const k = 3 / Math.max(0.1, quit - 1);
  const at = (r) => 1 / (1 + Math.exp(k * (r - quit)));
  return clamp(at(Math.max(1, ratio)) / at(1), CAR_SHARE_MIN, 1);
}

/** Some drive whatever they heard (they must, or they try their luck): through them the town learns when the streets are free again. */
export const CAR_SHARE_MIN = 0.1;
