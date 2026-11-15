/**
 * The weather of the world (`world.weather`): one source for everybody (#254, part of #239).
 *
 * A **state**, not an event: the air (temperature, cloud, rain or snow, wind, fog) at any time of
 * day, and the **ground**, which remembers (how wet it is, how much snow lies). It comes from
 * - nothing (`mode: "off"`, the default): a mild dry day, and nobody is told anything, so a layout
 *   without weather behaves as it always did;
 * - the **typical weather of the day** (`"typical"`): from the climate of the place month by month
 *   ({@link CLIMATE}) and the date of the clock, the same for the same seed and date;
 * - a **fixed** weather (`"fixed"`): a preset ({@link WEATHER_PRESETS}) set by hand or by a scenario;
 * - a **course** of key frames over the day on top of either.
 *
 * What others read besides the state are a few derived quantities, so that not everybody invents
 * thresholds: {@link Weather#railCondition}, {@link Weather#walkFactor}, {@link Weather#cycleShare},
 * {@link Weather#driveFactor}, {@link Weather#comfort}. The weather knows nothing of trains or
 * bikes; each effect lives in the simulation it acts in.
 *
 * Drawing: {@link Weather#look} is what the view needs (snow cover, wet ground, the leaves of the
 * season), {@link drawWeather} the veil of cloud and fog and the rain and snow over the picture.
 *
 * Numbers marked "estimate" have no source yet (see #254).
 * @module arail/core/weather
 */
import { clamp, hashKey, lerp, smoothstep } from "./math.js";
import { DAY_MINUTES, PROFILES, YEAR_DAYS, monthDay, parseTime, profileAt, seasonOf, wrapMinutes } from "./clock.js";

/** The modes of the weather. */
export const WEATHER_MODES = { off: "Off", typical: "Typical for the date", fixed: "Fixed" };
/** The modes that may be written on their own, as a name (a fixed weather is named by its preset). */
const NAMED_MODES = ["off", "typical"];

/**
 * The climate of Dresden by month: mean temperature (°C), the range between night and afternoon
 * (K), the share of days with rain or snow, the share of fair days (the rest is cloudy), the mean
 * wind (m/s) and the share of calm mornings with fog. The temperatures and the wet days are
 * rounded so that the year gives the German Weather Service's figures for Dresden-Klotzsche
 * 1991–2020 (9.8 °C; about 640 mm on about 156 days); the split by month, the fair days, the wind
 * and the fog are estimates, to be replaced by the DWD's monthly normals.
 */
export const CLIMATE = {
  label: "Dresden",
  months: [
    { t: 0.6, range: 5, wet: 0.5, fair: 0.14, wind: 4.6, fog: 0.2 },
    { t: 1.5, range: 6, wet: 0.42, fair: 0.2, wind: 4.4, fog: 0.15 },
    { t: 4.9, range: 8, wet: 0.42, fair: 0.25, wind: 4.3, fog: 0.08 },
    { t: 9.9, range: 10, wet: 0.36, fair: 0.36, wind: 3.9, fog: 0.04 },
    { t: 14.2, range: 10, wet: 0.42, fair: 0.36, wind: 3.6, fog: 0.03 },
    { t: 17.4, range: 10, wet: 0.42, fair: 0.38, wind: 3.4, fog: 0.02 },
    { t: 19.5, range: 11, wet: 0.44, fair: 0.4, wind: 3.3, fog: 0.02 },
    { t: 19.3, range: 11, wet: 0.4, fair: 0.42, wind: 3.2, fog: 0.04 },
    { t: 14.8, range: 10, wet: 0.38, fair: 0.36, wind: 3.4, fog: 0.12 },
    { t: 10, range: 8, wet: 0.4, fair: 0.3, wind: 3.8, fog: 0.22 },
    { t: 5.1, range: 5, wet: 0.46, fair: 0.16, wind: 4.3, fog: 0.25 },
    { t: 1.7, range: 4, wet: 0.5, fair: 0.12, wind: 4.6, fog: 0.2 },
  ],
};

/** The air on a day without a date or with the weather off: mild and dry. */
export const MILD = { temperature_c: 15, cloud: 0.3, precipitation: "none", rate_mm_h: 0, wind_mps: 3, wind_deg: 250, fog: 0, thunder: false };

/**
 * Weather set by hand or by a scenario: what each preset fixes (the rest follows the date's
 * typical day, or the mild day). `min_c` and `max_c` bound the temperature; `wet` and `snow_cm`
 * are where the ground starts.
 */
export const WEATHER_PRESETS = {
  clear: { label: "Clear", cloud: 0.05, precipitation: "none", fog: 0 },
  cloudy: { label: "Cloudy", cloud: 0.6, precipitation: "none", fog: 0 },
  overcast: { label: "Overcast", cloud: 1, precipitation: "none", fog: 0 },
  rain: { label: "Rain", cloud: 0.95, precipitation: "rain", rate_mm_h: 1.5, min_c: 3, wet: 1, fog: 0 },
  "heavy-rain": { label: "Heavy rain", cloud: 1, precipitation: "rain", rate_mm_h: 8, wind_mps: 9, min_c: 5, wet: 1, fog: 0 },
  thunderstorm: { label: "Thunderstorm", cloud: 1, precipitation: "rain", rate_mm_h: 15, wind_mps: 13, min_c: 14, wet: 1, fog: 0, thunder: true },
  snow: { label: "Snowfall", cloud: 1, precipitation: "snow", rate_mm_h: 1.5, temperature_c: -2, snow_cm: 6, fog: 0 },
  frost: { label: "Frost", cloud: 0.1, precipitation: "none", temperature_c: -6, wet: 0.5, fog: 0 },
  fog: { label: "Fog", cloud: 0.8, precipitation: "none", fog: 0.8, wind_mps: 1, max_c: 6 },
  heat: { label: "Heat", cloud: 0.05, precipitation: "none", temperature_c: 33, fog: 0 },
};

/** The words for the sky (for people: the HUD, cards). */
export const SKY_WORDS = {
  clear: "clear", cloudy: "cloudy", overcast: "overcast", rain: "rain", "heavy-rain": "heavy rain", thunderstorm: "thunderstorm", sleet: "sleet", snow: "snow", fog: "fog",
};

/** Snow this deep (cm) covers the ground entirely in the picture. */
export const SNOW_COVER_CM = 4;

/**
 * What the weather does to those who read it (starting values, estimates unless noted; #254):
 * walking and driving speeds as factors, the share of cyclists against a mild dry day.
 */
export const WEATHER_EFFECTS = {
  walk: { snow: 0.85, ice: 0.7 },
  drive: { wet: 0.9, snow: 0.7, ice: 0.5 },
  cycle: { rain: 0.5, heavy_rain: 0.25, snow: 0.2, ice: 0.15, cold_c: -5, mild_c: 15, cold: 0.35 },
  /** The rails are slippery with leaves in the weeks the leaves fall, when it is at least this damp. */
  leaves_wet: 0.15,
  /**
   * How fast the traffic clears the snow off the streets: the share per hour at the normal daytime
   * traffic (snow tracks, then slush; less at night, more in the rush hours). Sidewalks are trodden
   * half as fast. (Estimate.)
   */
  clearing: 0.6,
};

/** The leaves of the deciduous trees through the year: [first day of the year, state]. */
const LEAF_YEAR = [[1, "bare"], [95, "leafing"], [125, "leaf"], [273, "colouring"], [304, "falling"], [335, "bare"]];

/**
 * The leaves on a day of the year: `state` (bare, leafing, leaf, colouring, falling), `share` (how
 * much foliage is on the trees, 0…1) and `colour` (0 green … 1 autumn colours). Without a date the
 * trees are in leaf.
 * @param {number | null} doy
 */
export function leafState(doy) {
  if (doy == null) return { state: "leaf", share: 1, colour: 0 };
  let i = 0;
  while (i + 1 < LEAF_YEAR.length && doy >= LEAF_YEAR[i + 1][0]) i++;
  const [from, state] = LEAF_YEAR[i], to = LEAF_YEAR[i + 1]?.[0] ?? YEAR_DAYS + 1;
  const f = clamp((doy - from) / (to - from), 0, 1);
  if (state === "bare") return { state, share: 0, colour: 0 };
  if (state === "leafing") return { state, share: f, colour: 0 };
  if (state === "colouring") return { state, share: 1 - 0.15 * f, colour: f };
  if (state === "falling") return { state, share: 0.85 * (1 - f), colour: 1 };
  return { state, share: 1, colour: 0 };
}

/** A number 0…1 from a key (the same for the same key). */
const h01 = (...key) => (hashKey(...key) % 100000) / 100000;

/**
 * The kind of a day in the typical weather: fair, cloudy or wet, the same for spells of three days
 * (tomorrow tends to be like today), by the shares of the month.
 */
function dayKind(seed, doy) {
  const m = CLIMATE.months[monthDay(doy).month - 1], u = h01(seed, "spell", Math.floor(doy / 3));
  return u < m.wet ? "wet" : u < m.wet + m.fair ? "fair" : "cloudy";
}

/** What a day of the typical weather is like as a whole: its kind, mean temperature, cloud, wind. */
function dayOf(seed, doy) {
  const d = ((Math.round(doy) - 1 + YEAR_DAYS) % YEAR_DAYS) + 1;
  const { month, day } = monthDay(d), M = CLIMATE.months;
  // the month's values hold in its middle; between the middles the days go from one to the next
  const half = day / 30 - 0.5, other = M[(month - 1 + (half < 0 ? 11 : 1)) % 12], own = M[month - 1], f = Math.abs(half);
  const mix = (k) => lerp(own[k], other[k], f);
  const kind = dayKind(seed, d);
  const winter = mix("t") < 5;
  // fair days are warmer in summer and colder in winter (clear nights); wet days the other way round
  const offset = { fair: winter ? -2.5 : 2, cloudy: 0, wet: winter ? 1.5 : -2 }[kind] + (h01(seed, "t", d) - 0.5) * 6;
  return {
    doy: d, kind, t: mix("t") + offset, range: mix("range") * { fair: 1.25, cloudy: 0.9, wet: 0.6 }[kind],
    cloud: { fair: 0.1 + 0.25 * h01(seed, "c", d), cloudy: 0.5 + 0.35 * h01(seed, "c", d), wet: 0.85 + 0.15 * h01(seed, "c", d) }[kind],
    wind: mix("wind") * (0.5 + h01(seed, "w", d)) * (kind === "wet" ? 1.3 : 1), wind_deg: 200 + 120 * h01(seed, "wd", Math.floor(d / 3)),
    fog: kind !== "wet" && h01(seed, "f", d) < mix("fog") * (kind === "fair" ? 1.6 : 1) ? 0.5 + 0.4 * h01(seed, "ff", d) : 0,
  };
}

/** Rain or snow in a two-hour slot of a wet day (mm/h; 0 in three of four slots: about 4 mm a wet day). */
function slotRate(seed, day, slot) {
  if (day.kind !== "wet" || h01(seed, "slot", day.doy, slot) > 0.25) return 0;
  const summer = day.t > 14;
  // showers in summer (short and hard), steady rain or snow otherwise
  return summer ? 0.4 + 4.5 * h01(seed, "rate", day.doy, slot) ** 2 : 0.2 + 0.9 * h01(seed, "rate", day.doy, slot);
}

/**
 * The air of the typical weather at a time of a day of the year, for a seed.
 * @param {number} seed
 * @param {number} doy day of the year (1 = 1 January)
 * @param {number} minutes after midnight
 */
export function typicalAir(seed, doy, minutes) {
  const m = wrapMinutes(minutes), today = dayOf(seed, doy);
  // from noon to noon the days go over into each other: no jump at midnight
  const before = m < 720, other = dayOf(seed, doy + (before ? -1 : 1)), f = before ? 0.5 - m / 1440 : (m - 720) / 1440;
  const mix = (k) => lerp(today[k], other[k], f);
  // the coldest at 04:30, the warmest at 15:30: up over the day, down over the evening and the night
  const warm = m >= 270 && m <= 930 ? -Math.cos((Math.PI * (m - 270)) / 660) : Math.cos((Math.PI * wrapMinutes(m - 930)) / 780);
  const temperature_c = mix("t") + (mix("range") / 2) * warm;
  // rain in two-hour slots, each fading in and out
  const slot = Math.floor(m / 120), within = (m % 120) / 120;
  const rate = slotRate(seed, today, slot) * smoothstep(Math.min(1, within * 5)) * smoothstep(Math.min(1, (1 - within) * 5));
  const precipitation = rate < 0.05 ? "none" : temperature_c < 0.5 ? "snow" : temperature_c < 2 ? "sleet" : "rain";
  // fog on calm mornings, gone by 10:00
  const fog = today.fog * (m < 480 ? 1 : clamp((600 - m) / 120, 0, 1));
  // a summer shower that pours down on a warm afternoon is a thunderstorm, with gusts
  const thunder = precipitation === "rain" && rate >= 3 && temperature_c >= 18;
  return {
    temperature_c: Math.round(temperature_c * 10) / 10, cloud: clamp(Math.max(mix("cloud"), rate > 0 ? 0.9 : 0, fog * 0.8), 0, 1),
    precipitation, rate_mm_h: precipitation === "none" ? 0 : Math.round(rate * 10) / 10,
    wind_mps: Math.round(mix("wind") * (thunder ? 2.2 : 1) * 10) / 10, wind_deg: Math.round(today.wind_deg), fog, thunder,
  };
}

/** The keys of the air a course or a fixed state may set. */
const AIR_KEYS = ["temperature_c", "cloud", "rate_mm_h", "wind_mps", "wind_deg", "fog"];
const KINDS = ["none", "rain", "sleet", "snow"];

/** A layout's `weather` section, normalised (unknown keys dropped, defaults filled in). */
export function normalizeWeather(config) {
  const c = config && typeof config === "object" && !Array.isArray(config) ? config
    : typeof config === "string" ? (NAMED_MODES.includes(config) ? { mode: config } : { preset: config }) : {};
  const preset = Object.hasOwn(WEATHER_PRESETS, c.preset) ? c.preset : null;
  const mode = Object.hasOwn(WEATHER_MODES, c.mode) ? c.mode : preset ? "fixed" : "off";
  const course = (Array.isArray(c.course) ? c.course : [])
    .map((k) => (Array.isArray(k) && parseTime(k[0]) != null && k[1] && typeof k[1] === "object" ? [parseTime(k[0]), airOf(k[1])] : null))
    .filter(Boolean).sort((a, b) => a[0] - b[0]);
  return { mode, preset: mode === "fixed" ? preset ?? "clear" : preset, state: airOf(c.state), course, seed: Number.isFinite(Number(c.seed)) ? Number(c.seed) : 1 };
}

/** The air's quantities of an object (numbers within their ranges; a preset's bounds and ground too). */
function airOf(o) {
  const out = {};
  if (!o || typeof o !== "object") return out;
  for (const k of [...AIR_KEYS, "min_c", "max_c", "wet", "snow_cm"]) if (Number.isFinite(Number(o[k])) && o[k] !== "" && o[k] != null) out[k] = Number(o[k]);
  if (KINDS.includes(o.precipitation)) out.precipitation = o.precipitation;
  if (typeof o.thunder === "boolean") out.thunder = o.thunder;
  for (const k of ["cloud", "fog", "wet"]) if (out[k] != null) out[k] = clamp(out[k], 0, 1);
  for (const k of ["rate_mm_h", "wind_mps", "snow_cm"]) if (out[k] != null) out[k] = Math.max(0, out[k]);
  return out;
}

/** Problems of a layout's `weather` section, in plain words (validateLayout). */
export function weatherProblems(config) {
  if (config == null) return [];
  // a preset's name, or "typical" and "off" (the modes that need no preset)
  if (typeof config === "string") return Object.hasOwn(WEATHER_PRESETS, config) || NAMED_MODES.includes(config) ? [] : [`weather "${config}" is no preset (${Object.keys(WEATHER_PRESETS).join(", ")}) and not typical or off`];
  if (typeof config !== "object" || Array.isArray(config)) return ["weather must be an object or the name of a preset"];
  const out = [];
  if (config.mode != null && !Object.hasOwn(WEATHER_MODES, config.mode)) out.push(`weather.mode "${config.mode}" must be one of ${Object.keys(WEATHER_MODES).join(", ")}`);
  if (config.preset != null && !Object.hasOwn(WEATHER_PRESETS, config.preset)) out.push(`weather.preset "${config.preset}" is no preset (${Object.keys(WEATHER_PRESETS).join(", ")})`);
  if (config.course != null && !Array.isArray(config.course)) out.push('weather.course must be a list of ["HH:MM", {…}]');
  (Array.isArray(config.course) ? config.course : []).forEach((k, i) => {
    if (!Array.isArray(k) || parseTime(k[0]) == null || !k[1] || typeof k[1] !== "object") out.push(`weather.course[${i}] must be ["HH:MM", {…}]`);
  });
  for (const o of [config.state, ...(Array.isArray(config.course) ? config.course.map((k) => k?.[1]) : [])]) {
    if (o && typeof o === "object" && o.precipitation != null && !KINDS.includes(o.precipitation)) out.push(`weather: precipitation "${o.precipitation}" must be one of ${KINDS.join(", ")}`);
  }
  return out;
}

export class Weather {
  /** @param {import("./world.js").World} world */
  constructor(world) {
    this.world = world;
    this.configure(null);
  }

  /** Apply a layout's `weather` section; the ground starts as that weather leaves it. */
  configure(config) {
    const c = normalizeWeather(config);
    /** "off" | "typical" | "fixed" */
    this.mode = c.mode;
    /** The preset of the fixed weather (a key of {@link WEATHER_PRESETS}), or null. */
    this.preset = c.preset;
    /** Quantities of the air set one by one on top of the preset. */
    this.state = c.state;
    /** Key frames over the day: [[minutes, {…}], …]. */
    this.course = c.course;
    this.seed = c.seed;
    /** The layout's section as it was loaded (toJSON writes it back; what is set by hand is not saved). */
    this._config = config ?? null;
    this.settle();
  }

  /** Is there weather (anything but "off")? */
  get on() {
    return this.mode !== "off";
  }

  /**
   * Set the weather by hand or from a scenario: a preset's name, "typical" or "off", or an object
   * `{mode?, preset?, course?, …quantities}`. Returns false (and changes nothing) for a name that is none.
   */
  set(value) {
    if (typeof value === "string") {
      if (NAMED_MODES.includes(value)) this.mode = value;
      else if (Object.hasOwn(WEATHER_PRESETS, value)) Object.assign(this, { mode: "fixed", preset: value, state: {} });
      else return false;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      if (weatherProblems(value).length) return false;
      const quantities = { ...airOf(value), ...airOf(value.state) }, some = Object.keys(quantities).length > 0;
      if (value.preset != null) Object.assign(this, { preset: value.preset, state: {} });
      if (some) this.state = { ...this.state, ...quantities };
      this.mode = value.mode ?? (value.preset != null || some ? "fixed" : this.mode);
      if (this.mode === "fixed" && !this.preset) this.preset = "clear";
      if (value.course != null) this.course = normalizeWeather({ course: value.course }).course;
      if (Number.isFinite(Number(value.seed))) this.seed = Number(value.seed);
    } else return false;
    this.settle();
    this.world.events.emit("weather.changed", { weather: this.now() });
    return true;
  }

  /** The seed of the typical weather: the layout's and the world's. */
  _seed() {
    return hashKey(this.world.seed ?? 1, "weather", this.seed);
  }

  /**
   * The air at a time of day (default: now) on a date (default: the clock's): temperature, cloud,
   * rain or snow, wind, fog.
   * @param {number} [minutes] after midnight
   * @param {number | null} [doy] day of the year
   */
  air(minutes = this.world.clock.minutes, doy = this.world.clock.date) {
    if (this.mode === "off") return { ...MILD };
    let air = doy == null ? { ...MILD } : typicalAir(this._seed(), doy, minutes), named = false;
    if (this.mode === "fixed") {
      const p = { ...WEATHER_PRESETS[this.preset], ...this.state };
      for (const k of AIR_KEYS) if (p[k] != null) air[k] = p[k];
      // a preset's bounds hold for the date's temperature, not for one set by hand
      if (p.min_c != null && this.state.temperature_c == null) air.temperature_c = Math.max(air.temperature_c, p.min_c);
      if (p.max_c != null && this.state.temperature_c == null) air.temperature_c = Math.min(air.temperature_c, p.max_c);
      air.precipitation = p.precipitation ?? "none";
      air.thunder = p.thunder === true;
      if (air.precipitation === "none") air.rate_mm_h = 0;
      else if (!(air.rate_mm_h > 0)) air.rate_mm_h = 1;
      named = air.precipitation !== "none";
    }
    if (this.course.length) {
      const c = this._courseAt(wrapMinutes(minutes));
      air = { ...air, ...c };
      if (c.precipitation && c.precipitation !== "none") named = true;
    }
    // what falls is rain, sleet or snow by the temperature, unless a preset or the course names it
    if (air.precipitation !== "none" && !named) air.precipitation = air.temperature_c < 0.5 ? "snow" : air.temperature_c < 2 ? "sleet" : "rain";
    return air;
  }

  /** The course's quantities at a time: between two key frames in proportion; before the first and after the last, theirs. */
  _courseAt(m) {
    const c = this.course;
    let i = 0;
    while (i + 1 < c.length && m >= c[i + 1][0]) i++;
    const a = c[i], b = m < a[0] ? a : c[i + 1] ?? a, f = b[0] > a[0] ? clamp((m - a[0]) / (b[0] - a[0]), 0, 1) : 0;
    const out = {};
    for (const k of AIR_KEYS) {
      if (a[1][k] != null && b[1][k] != null) out[k] = lerp(a[1][k], b[1][k], f);
      else if (a[1][k] != null) out[k] = a[1][k];
    }
    const thunder = (f < 0.5 ? a : b)[1].thunder ?? a[1].thunder;
    if (thunder != null) out.thunder = thunder;
    const kind = (f < 0.5 ? a : b)[1].precipitation ?? a[1].precipitation;
    if (kind) {
      out.precipitation = kind;
      if (kind === "none") out.rate_mm_h = 0;
      else if (!(out.rate_mm_h > 0)) out.rate_mm_h = 1;
    }
    return out;
  }

  /**
   * The ground as this weather leaves it now: for the typical weather the last day and a half gone
   * through in steps of a quarter of an hour, for a fixed one where its preset starts.
   */
  settle() {
    this.ground = { wet: 0, snow_cm: 0, cleared: 0 };
    this._memo = null;
    this._sky = null;
    if (this.mode === "off") return;
    if (this.mode === "fixed") {
      const p = { ...WEATHER_PRESETS[this.preset], ...this.state }, air = this.air();
      this.ground.wet = p.wet ?? (air.precipitation === "rain" ? 1 : 0);
      this.ground.snow_cm = p.snow_cm ?? (air.precipitation === "snow" ? SNOW_COVER_CM : 0);
      return;
    }
    const clock = this.world.clock;
    if (clock.date == null && !this.course.length) return;
    for (let back = 36 * 60; back > 0; back -= 15) {
      const m = clock.minutes - back, days = Math.floor(m / DAY_MINUTES);
      const doy = clock.date == null ? null : ((clock.date - 1 + days + 2 * YEAR_DAYS) % YEAR_DAYS) + 1;
      this._ground(this.air(wrapMinutes(m), doy), 0.25, this._daylight(wrapMinutes(m), doy), wrapMinutes(m));
    }
  }

  _daylight(minutes, doy) {
    const clock = this.world.clock;
    if (doy == null || doy === clock.date) {
      const s = clock.sun();
      return minutes > s.rise && minutes < s.set ? 1 : 0;
    }
    return minutes > 420 && minutes < 1080 ? 1 : 0;
  }

  /**
   * The ground over `hours` of this air at a time of day: rain wets it, sun and wind dry it; snow
   * settles and melts; the traffic clears the streets of it (`cleared`, 0…1) by the hour's traffic,
   * as the snow falling covers them again.
   */
  _ground(air, hours, daylight, minutes = this.world.clock.minutes) {
    const g = this.ground, T = air.temperature_c;
    if (g.snow_cm > 0.5) {
      const traffic = profileAt(PROFILES.car, minutes), falling = air.precipitation === "snow" ? air.rate_mm_h : 0;
      g.cleared = clamp(g.cleared + hours * (WEATHER_EFFECTS.clearing * traffic - 0.4 * falling + (T > 0 ? 0.3 : 0)), 0, 1);
    } else g.cleared = 0;
    if (air.precipitation === "rain" || air.precipitation === "sleet") g.wet = Math.min(1, g.wet + air.rate_mm_h * hours * 0.8);
    if (air.precipitation === "snow") g.snow_cm += air.rate_mm_h * hours; // 1 mm of water, about 1 cm of fresh snow
    if (g.snow_cm > 0 && T > 0) {
      const melt = Math.min(g.snow_cm, hours * (0.15 * T + (air.precipitation === "rain" ? 0.3 * air.rate_mm_h : 0)));
      g.snow_cm -= melt;
      g.wet = Math.min(1, g.wet + melt * 0.5);
    }
    // drying: slowly in still air, faster in sun and wind, hardly at all in frost or under snow
    if (air.precipitation === "none" && g.snow_cm <= 0) g.wet = Math.max(0, g.wet - hours * (T > 0 ? 0.06 + 0.25 * daylight * (1 - air.cloud) + 0.015 * air.wind_mps : 0.01));
  }

  /** Advance by `dt` simulated seconds (the ground follows the clock's time). */
  step(dt) {
    const clock = this.world.clock;
    // the ground goes with the clock: nothing while it stands (stopped, or a factor of 0)
    if (this.mode === "off" || clock.frozen || !(clock.factor > 0)) return;
    this._ground(this.air(), (dt * clock.factor) / 3600, this._daylight(clock.minutes, clock.date));
    this._memo = null;
    // told when it starts or stops raining or snowing, when ice forms, when snow lies or is gone
    const n = this.now(), key = `${n.sky}|${n.ice}|${n.snow_cm > 0.5}`;
    if (this._sky != null && key !== this._sky) this.world.events.emit("weather.changed", { weather: n });
    this._sky = key;
  }

  /**
   * The weather now: the air, the ground (`wet` 0…1, `snow_cm`, `frost`: the ground frozen, `ice`:
   * wet ground frozen), a word for the sky, the season and the leaves.
   */
  now() {
    const clock = this.world.clock, key = `${this.world.time}|${clock.minutes}|${clock.date}`;
    if (this._memo?.key === key) return this._memo.value;
    const air = this.air(), g = this.ground;
    const frost = this.on && air.temperature_c <= 0;
    const ice = frost && g.wet > 0.3 && g.snow_cm < 0.5;
    const sky = air.thunder && air.precipitation !== "none" ? "thunderstorm" : air.fog > 0.4 ? "fog" : air.precipitation === "snow" ? "snow" : air.precipitation === "sleet" ? "sleet"
      : air.precipitation === "rain" ? (air.rate_mm_h >= 4 ? "heavy-rain" : "rain") : air.cloud > 0.8 ? "overcast" : air.cloud > 0.35 ? "cloudy" : "clear";
    const value = {
      ...air, wet: g.wet, snow_cm: g.snow_cm, frost, ice, sky,
      season: clock.date == null ? null : seasonOf(clock.date), leaf: leafState(this.on ? clock.date : null),
    };
    this._memo = { key, value };
    return value;
  }

  /** "−2 °C · snow" (the minus sign as people write it), or "" while the weather is off. */
  describe() {
    if (!this.on) return "";
    const n = this.now(), t = Math.round(n.temperature_c);
    return `${t < 0 ? "−" : ""}${Math.abs(t)} °C · ${SKY_WORDS[n.sky]}`;
  }

  /* ---------------------------------------------------------------- what others read */

  /**
   * The rails under this weather: "ice" on wet rails in frost, "leaves" while the leaves fall and it
   * is damp, "wet" in rain, in snow and on wet ground, else "dry" (the keys of the rails'
   * conditions, rail/dynamics.js).
   */
  railCondition() {
    if (!this.on) return "dry";
    const n = this.now();
    if (n.ice) return "ice";
    if (n.leaf.state === "falling" && (n.wet > WEATHER_EFFECTS.leaves_wet || n.precipitation !== "none" || n.fog > 0.4)) return "leaves";
    // snow on the rails is run to water by the wheels: as wet (estimate)
    if (n.precipitation !== "none" || n.wet > 0.3 || n.snow_cm > 0.5) return "wet";
    return "dry";
  }

  /** How fast people walk against a dry day (1): slower on snow, slower still on ice. */
  walkFactor() {
    if (!this.on) return 1;
    const n = this.now();
    return n.ice ? WEATHER_EFFECTS.walk.ice : n.snow_cm > 1 ? WEATHER_EFFECTS.walk.snow : 1;
  }

  /** How fast cars and buses drive against a dry day (1): slower in the wet, on snow, on ice. */
  driveFactor() {
    if (!this.on) return 1;
    const n = this.now(), e = WEATHER_EFFECTS.drive;
    return n.ice ? e.ice : n.snow_cm > 1 ? e.snow : n.wet > 0.3 || n.precipitation !== "none" ? e.wet : 1;
  }

  /** The share of the cyclists of a mild dry day who ride now: fewer in the cold, in rain, on snow and ice. */
  cycleShare() {
    if (!this.on) return 1;
    const n = this.now(), e = WEATHER_EFFECTS.cycle;
    let share = lerp(e.cold, 1, clamp((n.temperature_c - e.cold_c) / (e.mild_c - e.cold_c), 0, 1));
    if (n.precipitation === "rain" || n.precipitation === "sleet") share *= n.rate_mm_h >= 4 ? e.heavy_rain : e.rain;
    if (n.ice) share *= e.ice;
    else if (n.snow_cm > 1 || n.precipitation === "snow") share *= e.snow;
    return share;
  }

  /**
   * How pleasant it is outside, −1 (awful) … 1 (lovely): best around 21 °C, worse in rain, snowfall
   * and wind. For moods of people waiting outside and the number of leisure trips. (Estimate.)
   */
  comfort() {
    if (!this.on) return 0.5;
    const n = this.now();
    let c = 1 - Math.abs(n.temperature_c - 21) / 18;
    if (n.precipitation !== "none") c -= n.precipitation === "snow" ? 0.25 : 0.4 + 0.05 * Math.min(8, n.rate_mm_h);
    c -= 0.03 * Math.max(0, n.wind_mps - 5);
    return clamp(c, -1, 1);
  }

  /**
   * What the picture needs: `snow` (the cover, 0…1), `wet`, `cloud`, `fog`, the precipitation with
   * its rate, the wind, the leaves and whether it is day. Null while the weather is off.
   */
  look() {
    if (!this.on) return null;
    const n = this.now();
    return {
      snow: clamp(n.snow_cm / SNOW_COVER_CM, 0, 1), cleared: this.ground.cleared, wet: n.snow_cm > 0.5 ? 0 : n.wet, cloud: n.cloud, fog: n.fog,
      precipitation: n.precipitation, rate: n.rate_mm_h, wind: n.wind_mps, thunder: n.sky === "thunderstorm", leaf: n.leaf, season: n.season,
      daylight: this.world.clock.daylight(), still: this.world.settings?.weatherStill === true,
    };
  }

  /** The layout's `weather` section (as loaded: what was set by hand or by a scenario is not saved). */
  toJSON() {
    return this._config;
  }
}

/* ================================================================ drawing */

/**
 * The colour of a deciduous crown through the year, from its summer green ([r, g, b]): light in
 * spring, yellow to red-brown in autumn, each tree in its own time (`u`, 0…1, its own number).
 * @param {number[]} rgb
 * @param {{state: string, colour: number} | null | undefined} leaf
 * @param {number} [u]
 */
export function leafTone(rgb, leaf, u = 0.5) {
  if (!leaf) return rgb;
  if (leaf.state === "leafing") return [0, 1, 2].map((i) => lerp(rgb[i], [150, 205, 95][i], 0.6));
  if (leaf.colour > 0) {
    // early trees turn first; the colours: yellow, orange, red-brown
    const f = clamp(leaf.colour * 1.6 - u * 0.6, 0, 1), autumn = [[214, 170, 40], [201, 110, 35], [150, 70, 45]][Math.floor(u * 2.999)];
    return [0, 1, 2].map((i) => lerp(rgb[i], autumn[i], f));
  }
  return rgb;
}

/* ---------------------------------------------------------------- rain and snow: layers of tiles */

/**
 * Rain and snow are drawn as a few **layers** over the picture, far to near: each a square tile with
 * its drops or flakes painted once (deterministic, seamless at its edges), then filled over the
 * whole picture as a repeating pattern that moves down (and sideways with the wind) with the real
 * time. A frame costs one fill per layer, whatever the number of flakes.
 * `size` (CSS px) of the tile, `count` drops or flakes in it, `speed` (CSS px/s) of the fall,
 * `r` their radius or length (CSS px), `alpha`, and for snow how far a layer sways (`sway`, px).
 */
export const PRECIPITATION_LAYERS = {
  snow: [
    { size: 220, count: 70, speed: 28, r: [0.7, 1.3], alpha: 0.75, sway: 6 },
    { size: 300, count: 40, speed: 55, r: [1.4, 2.4], alpha: 0.85, sway: 10 },
    { size: 420, count: 18, speed: 105, r: [2.8, 4.4], alpha: 0.9, sway: 16 },
  ],
  rain: [
    { size: 200, count: 55, speed: 900, r: [7, 11], alpha: 0.35 },
    { size: 280, count: 35, speed: 1300, r: [12, 18], alpha: 0.45 },
    { size: 360, count: 16, speed: 1800, r: [20, 30], alpha: 0.5 },
  ],
};

/**
 * The drops or flakes of a layer's tile: [{x, y, r, a}] in CSS px within the tile (the same every
 * time: the pattern is painted once).
 * @param {"snow" | "rain"} kind
 * @param {number} i the layer (0 far … 2 near)
 */
export function layerParticles(kind, i) {
  const L = PRECIPITATION_LAYERS[kind][i], out = [];
  for (let k = 0; k < L.count; k++) {
    const u = (j) => h01("particle", kind, i, k, j);
    out.push({ x: u(1) * L.size, y: u(2) * L.size, r: L.r[0] + (L.r[1] - L.r[0]) * u(3), a: L.alpha * (0.6 + 0.4 * u(4)) });
  }
  return out;
}

/** Tiles painted so far, by kind, layer, slant and pixel ratio (a few, kept for the page's life). */
const TILES = new Map();

/** A canvas to paint a tile on (null where there is none: in Node). */
function tileCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  if (globalThis.document?.createElement) return Object.assign(document.createElement("canvas"), { width: w, height: h });
  return null;
}

/** The tile of a layer, painted once: soft round flakes, or streaks slanted by the wind. */
function layerTile(kind, i, slant, px) {
  const key = `${kind}|${i}|${Math.round(slant * 10)}|${px}`;
  if (TILES.has(key)) return TILES.get(key);
  const L = PRECIPITATION_LAYERS[kind][i], n = Math.round(L.size * px), c = tileCanvas(n, n), g = c?.getContext?.("2d");
  if (!g) {
    TILES.set(key, null);
    return null;
  }
  // each particle also at its copies across the edges, so that the tile repeats without a seam
  const copies = (p, pad, fn) => {
    for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) if (p.x * px + dx > -pad && p.x * px + dx < n + pad && p.y * px + dy > -pad && p.y * px + dy < n + pad) fn(p.x * px + dx, p.y * px + dy);
  };
  for (const p of layerParticles(kind, i)) {
    if (kind === "snow") {
      const r = p.r * px;
      copies(p, r * 2, (x, y) => {
        // a soft flake: bright in the middle, fading out
        const grad = g.createRadialGradient(x, y, 0, x, y, r * 1.6);
        grad.addColorStop(0, `rgba(255,255,255,${p.a})`);
        grad.addColorStop(0.45, `rgba(255,255,255,${(p.a * 0.75).toFixed(3)})`);
        grad.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, r * 1.6, 0, 2 * Math.PI);
        g.fill();
      });
    } else {
      const len = p.r * px, dx = slant * len;
      g.lineCap = "round";
      g.lineWidth = Math.max(1, (0.6 + 0.4 * i) * px);
      copies(p, len + Math.abs(dx), (x, y) => {
        const grad = g.createLinearGradient(x, y, x + dx, y + len);
        grad.addColorStop(0, "rgba(220,232,245,0)");
        grad.addColorStop(1, `rgba(225,236,248,${p.a})`);
        g.strokeStyle = grad;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + dx, y + len);
        g.stroke();
      });
    }
  }
  TILES.set(key, c);
  return c;
}

/**
 * When lightning strikes in a thunderstorm: every 8 to 20 seconds, each strike 0.35 s with a
 * second, weaker pulse (never more than two flashes in a second). Null when none is lit at `t` (s);
 * else the strike's number and how bright it is now (0…1).
 */
export function lightningAt(t) {
  if (!(t > 0)) return null;
  // strikes at deterministic times: the n-th falls in the n-th window of 14 s, 3 to 9 s into it, so
  // that two strikes are 8 to 20 s apart
  const n = Math.floor(t / 14), at = n * 14 + 3 + 6 * h01("strike", n), d = t - at;
  if (d < 0 || d > 0.35) return null;
  const bright = d < 0.08 ? 1 : d < 0.18 ? 0.25 : d < 0.26 ? 0.7 : 0.2 * (1 - (d - 0.26) / 0.09);
  return { n, bright: clamp(bright, 0, 1) };
}

/**
 * The bolt of a strike: a jagged line from the top edge of the picture down into the upper fifth,
 * with a branch (fractions of the picture's width and height).
 */
function boltPaths(n) {
  const main = [[0.12 + 0.76 * h01("bolt", n, 0), 0]];
  for (let k = 1; k <= 8; k++) {
    const [x, y] = main[k - 1];
    main.push([x + (h01("bolt", n, k) - 0.5) * 0.035, y + 0.018 + 0.012 * h01("bolt", n, k, 1)]);
  }
  const from = main[3], side = h01("bolt", n, 20) < 0.5 ? -1 : 1, branch = [from];
  for (let k = 1; k <= 4; k++) {
    const [x, y] = branch[k - 1];
    branch.push([x + side * (0.008 + 0.012 * h01("bolt", n, 30 + k)), y + 0.012 + 0.01 * h01("bolt", n, 40 + k)]);
  }
  return [main, branch];
}

/**
 * The weather over the picture: a grey veil under cloud and in fog (thicker towards the distance),
 * rain or snow in three layers of tiles, and in a thunderstorm a darker sky with lightning now and
 * then. One overlay under the labels; nothing in the simple view. With `look.still` (reduced
 * motion) rain and snow stand still and no lightning flashes.
 * @param {import("./view.js").View} view
 * @param {ReturnType<Weather["look"]>} look
 */
export function drawWeather(view, look) {
  if (!look || view.simple) return;
  const storm = !!look.thunder, veil = (storm ? 0.45 : 0.2) * look.cloud * look.daylight * (1 - view.darkness), fog = look.fog;
  const kind = look.precipitation === "snow" ? "snow" : look.precipitation === "none" ? null : "rain", rate = look.rate;
  if (veil < 0.01 && fog < 0.02 && !kind) return;
  const t = look.still ? 0 : (globalThis.performance?.now?.() ?? view.time * 1000) / 1000;
  view.overlay((ctx) => {
    const W = ctx.canvas.width, H = ctx.canvas.height, px = view.px;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (veil >= 0.01) {
      ctx.fillStyle = storm ? `rgba(70,76,92,${veil.toFixed(3)})` : `rgba(128,136,146,${veil.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (fog >= 0.02) {
      // thicker towards the top of the picture, where the distance is
      const g = ctx.createLinearGradient(0, 0, 0, H), tone = view.darkness > 0.5 ? "70,78,96" : "226,230,233";
      g.addColorStop(0, `rgba(${tone},${(0.85 * fog).toFixed(3)})`);
      g.addColorStop(1, `rgba(${tone},${(0.3 * fog).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (kind && rate > 0 && typeof ctx.createPattern === "function") {
      // light rain or snow: the far layers only; more layers and more of them as it gets heavier
      const slant = clamp(look.wind / 14, 0, 0.9), layers = PRECIPITATION_LAYERS[kind];
      const heavy = clamp(rate / (kind === "snow" ? 2.5 : 6), 0.25, 1.6), night = view.darkness > 0.5 ? 0.7 : 1;
      for (let i = 0; i < layers.length; i++) {
        const L = layers[i], share = clamp(heavy * 1.6 - i * 0.55, 0, 1);
        if (share <= 0.02) continue;
        const tile = layerTile(kind, i, kind === "rain" ? slant : 0, px);
        const pattern = tile && ctx.createPattern(tile, "repeat");
        if (!pattern) continue;
        const fall = t * L.speed * px, sway = kind === "snow" ? Math.sin(t * (0.5 + 0.2 * i) + i) * L.sway * px : 0;
        const y = fall % (L.size * px), x = (fall * slant + sway) % (L.size * px);
        pattern.setTransform?.(new DOMMatrix([1, 0, 0, 1, x, y]));
        ctx.globalAlpha = share * night * (kind === "rain" && heavy > 1 ? 1 : 1);
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, W, H);
        // heavy: the same layer once more, shifted, for twice as many drops
        if (heavy > 1.1) {
          pattern.setTransform?.(new DOMMatrix([1, 0, 0, 1, x + L.size * px * 0.5, y + L.size * px * 0.37]));
          ctx.globalAlpha = clamp(heavy - 1, 0, 0.6) * night;
          ctx.fillRect(0, 0, W, H);
        }
      }
      ctx.globalAlpha = 1;
    }
    // lightning: a short bolt from the top edge and a faint brightening of the upper part of the picture
    const strike = storm && !look.still ? lightningAt(t) : null;
    if (strike) {
      const sky = ctx.createLinearGradient(0, 0, 0, H * 0.6);
      sky.addColorStop(0, `rgba(220,226,255,${(0.16 * strike.bright).toFixed(3)})`);
      sky.addColorStop(1, "rgba(220,226,255,0)");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H * 0.6);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(190,205,255,0.95)";
      ctx.shadowBlur = 18 * px;
      boltPaths(strike.n).forEach((path, j) => {
        ctx.strokeStyle = `rgba(248,250,255,${((j ? 0.6 : 0.95) * strike.bright).toFixed(3)})`;
        ctx.lineWidth = Math.max(1, (j ? 1.2 : 2.4) * px);
        ctx.beginPath();
        path.forEach(([x, y], k) => (k ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
        ctx.stroke();
      });
    }
  }, -1000);
}
