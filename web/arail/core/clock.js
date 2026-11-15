/**
 * Time of day: a fast clock ("Modellbahnuhr") that runs alongside the simulation, with
 * daylight for the day/night lighting and demand profiles for timetables and traffic.
 *
 * Simulated seconds (`world.time`) drive all movement; the clock shows a time of day that
 * runs `factor` times faster (12 = one clock hour per five simulated minutes). Movement
 * stays realistic while a whole day passes in a reasonable time.
 * @module arail/core/clock
 */
import { clamp, smoothstep } from "./math.js";

export const DAY_MINUTES = 24 * 60;

/** Defaults of the layout's `clock` section. */
export const DEFAULT_CLOCK = {
  /** Time of day when the layout is loaded ("HH:MM"). */
  start: "07:00",
  /** Clock seconds per simulated second. */
  factor: 12,
  /** Vary timetables, traffic and passenger numbers with the time of day. */
  profiles: true,
  /**
   * The date ("YYYY-MM-DD", or "MM-DD" in {@link DEFAULT_YEAR}), or null: no date, every day the same
   * day with the sun of {@link SUN}.
   */
  date: null,
  /** Latitude of the place (°N), for sunrise and sunset by the date (Dresden). */
  latitude: 51.05,
};

/** Sunrise and sunset (minutes after midnight) without a date, and the length of the twilight. */
export const SUN = { rise: 6 * 60, set: 20 * 60 + 30, twilight: 45 };

/** Days of the months (February of a common year). */
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** The days of the week, Monday first (as in Germany). */
export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Days of a common year (the sun and the climate go by these). */
export const YEAR_DAYS = 365;
/** The year of a date written without one ("12-06"). */
export const DEFAULT_YEAR = 2026;
/** Years the clock takes. */
const YEARS = [1900, 2200];

/** Is it a leap year (Gregorian)? */
export const isLeapYear = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
/** Days of a year (365 when the year is not known). */
export const yearDays = (year = null) => (year != null && isLeapYear(year) ? 366 : 365);
const monthDays = (month, year = null) => (month === 2 && year != null && isLeapYear(year) ? 29 : MONTH_DAYS[month - 1]);

/**
 * A date as it is written: "2026-12-06" (with the year) or "12-06" (without) -> {year (or null),
 * month, day}; a day of the year (1…366) -> {year: null, month, day}. What is no date -> null.
 */
export function parseDay(value) {
  if (typeof value === "number") return Number.isInteger(value) && value >= 1 && value <= YEAR_DAYS ? { year: null, ...monthDay(value) } : null;
  const m = String(value ?? "").trim().match(/^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const year = m[1] != null ? Number(m[1]) : null, month = Number(m[2]), day = Number(m[3]);
  if (year != null && (year < YEARS[0] || year > YEARS[1])) return null;
  // without a year, 29 February may be: the year it is set in decides (Clock.setDate)
  if (month < 1 || month > 12 || day < 1 || day > (year == null && month === 2 ? 29 : monthDays(month, year))) return null;
  return { year, month, day };
}

/** The day of the year (1 = 1 January) of a month and a day, in a year (a common year when null). */
export function dayOfYear(month, day, year = null) {
  let doy = day;
  for (let m = 1; m < month; m++) doy += monthDays(m, year);
  return doy;
}

/** "2026-12-06", "12-06" or a day of the year -> the day of the year (1 = 1 January); invalid -> null. */
export function parseDate(value) {
  const d = parseDay(value);
  const year = d?.year ?? DEFAULT_YEAR;
  return d && !(d.month === 2 && d.day === 29 && !isLeapYear(year)) ? dayOfYear(d.month, d.day, year) : null;
}

/** The month (1…12) and the day of the month of a day of the year (in a year: leap years have 29 February). */
export function monthDay(doy, year = null) {
  const n = yearDays(year);
  let d = ((Math.round(doy) - 1) % n + n) % n + 1, month = 1;
  while (d > monthDays(month, year)) d -= monthDays(month++, year);
  return { month, day: d };
}

/** A day of the year -> "12-06", with a year "2026-12-06". */
export function formatDate(doy, year = null) {
  const { month, day } = monthDay(doy, year);
  const md = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return year == null ? md : `${year}-${md}`;
}

/** The day of the week (0 = Monday … 6 = Sunday) of a day of a year (Gregorian calendar). */
export function dayOfWeek(year, doy) {
  // days since Monday, 1 January 2001 (a Monday), by whole years and leap days
  const y = year - 2001, days = 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + (doy - 1);
  return ((days % 7) + 7) % 7;
}

/** The meteorological season of a day of the year: winter (Dec–Feb), spring, summer, autumn. */
export function seasonOf(doy) {
  const { month } = monthDay(doy);
  return month === 12 || month <= 2 ? "winter" : month <= 5 ? "spring" : month <= 8 ? "summer" : "autumn";
}

/**
 * Summer time (clock + 1 h): from the last Sunday of March to the last Sunday of October, as days of
 * the year (in a year; without one about 29 March to 24 October).
 */
export function summerTime(year = null) {
  if (year == null) return [88, 298];
  // the last day of the month, back to its Sunday (6)
  const lastSunday = (month, days) => {
    const last = dayOfYear(month, days, year);
    return last - ((dayOfWeek(year, last) + 1) % 7);
  };
  return [lastSunday(3, 31), lastSunday(10, 31)];
}

/**
 * Sunrise and sunset on a day of the year at a latitude, in clock time (minutes after midnight) of
 * Central European Time with summer time, at the longitude of Dresden: from the sun's declination
 * and the equation of time, the sun's upper edge on the horizon with refraction (−0.833°). Where
 * the sun does not rise or set (polar night, midnight sun) the day has no length or all of it.
 * @param {number} doy day of the year (1 = 1 January)
 * @param {number} [latitude] °N
 * @param {{longitude?: number, zone_h?: number, summer?: boolean, year?: number | null}} [place] `summer`:
 *   with summer time (from the last Sunday of March to the last Sunday of October of the `year`)
 * @returns {{rise: number, set: number, noon: number, twilight: number}}
 */
export function sunTimes(doy, latitude = DEFAULT_CLOCK.latitude, { longitude = 13.74, zone_h = 1, summer: dst = true, year = null } = {}) {
  const rad = Math.PI / 180;
  const decl = -23.44 * rad * Math.cos((2 * Math.PI * (doy + 10)) / YEAR_DAYS);
  const B = (2 * Math.PI * (doy - 81)) / 364;
  const equation = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // minutes
  const lat = clamp(latitude, -89, 89) * rad;
  const cosH = (Math.sin(-0.833 * rad) - Math.sin(lat) * Math.sin(decl)) / (Math.cos(lat) * Math.cos(decl));
  const half = (Math.acos(clamp(cosH, -1, 1)) / rad) * 4; // minutes from noon to sunset
  const [from, to] = summerTime(year);
  const summer = dst && doy >= from && doy < to ? 60 : 0;
  const noon = 12 * 60 - equation - 4 * (longitude - 15 * zone_h) + summer;
  return { rise: noon - half, set: noon + half, noon, twilight: SUN.twilight };
}

/**
 * Demand over the day, as factors of the normal daytime level: [hour, factor] points,
 * interpolated linearly. Rail and bus have no service between about 01:00 and 04:30.
 */
export const PROFILES = {
  rail: [[0, 0.4], [0.75, 0.25], [1, 0], [4.5, 0], [5, 0.5], [6, 1], [6.5, 1.5], [8.5, 1.5], [9, 1], [15.5, 1], [16, 1.4], [18.5, 1.4], [19, 1], [21, 0.6], [24, 0.4]],
  bus: [[0, 0.3], [0.75, 0.2], [1, 0], [4.5, 0], [5, 0.5], [6, 1], [6.5, 1.5], [8.5, 1.5], [9, 1], [15.5, 1], [16, 1.4], [18.5, 1.4], [19, 1], [21, 0.5], [24, 0.3]],
  car: [[0, 0.15], [5, 0.15], [6, 0.6], [7, 1.4], [9, 1], [16, 1.2], [17, 1.5], [19, 0.8], [22, 0.4], [24, 0.15]],
  /** Passengers who are not part of a town simulation (random arrivals at stops). */
  passengers: [[0, 0.3], [1, 0.05], [4.5, 0.05], [5, 0.4], [6, 1], [6.5, 1.6], [8.5, 1.6], [9, 1], [15.5, 1], [16, 1.5], [18.5, 1.5], [19, 1], [21, 0.5], [24, 0.3]],
};

/** "07:30" -> 450 (minutes after midnight); numbers are taken as minutes. Invalid -> null. */
export function parseTime(value) {
  if (typeof value === "number") return Number.isFinite(value) ? wrapMinutes(value) : null;
  const m = String(value ?? "").trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2] || 0);
  if (h > 24 || min > 59) return null;
  return wrapMinutes(h * 60 + min);
}

/** 450 -> "07:30". */
export function formatTime(minutes) {
  const t = Math.floor(wrapMinutes(minutes));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function wrapMinutes(m) {
  return ((m % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

/** Interpolated value of a profile ([hour, factor] points) at a time of day (minutes). */
export function profileAt(points, minutes) {
  const h = wrapMinutes(minutes) / 60;
  for (let i = 1; i < points.length; i++) {
    const [h0, v0] = points[i - 1], [h1, v1] = points[i];
    if (h <= h1) return h1 > h0 ? v0 + ((v1 - v0) * (h - h0)) / (h1 - h0) : v1;
  }
  return points[points.length - 1][1];
}

/** Daylight 0 (night) .. 1 (day) at a time of day, with a smooth twilight. */
export function daylightAt(minutes, sun = SUN) {
  const t = wrapMinutes(minutes), w = sun.twilight;
  const up = smoothstep(clamp((t - (sun.rise - w)) / (2 * w), 0, 1));
  const down = 1 - smoothstep(clamp((t - (sun.set - w)) / (2 * w), 0, 1));
  return Math.min(up, down);
}

export class Clock {
  /** @param {Partial<typeof DEFAULT_CLOCK>} [config] the layout's `clock` section */
  constructor(config = {}) {
    this.configure(config);
  }

  /** Apply a configuration and set the time to its start time. */
  configure(config = {}) {
    const c = { ...DEFAULT_CLOCK, ...(config || {}) };
    this.start = parseTime(c.start) ?? parseTime(DEFAULT_CLOCK.start);
    this.factor = Number(c.factor) >= 0 ? Number(c.factor) : DEFAULT_CLOCK.factor;
    this.profiles = c.profiles !== false;
    const d = parseDay(c.date);
    /** The year (null: no date). */
    this.year = d ? d.year ?? DEFAULT_YEAR : null;
    /** The day of the year (1 = 1 January), or null: no date. It runs on at midnight, into the next year. */
    this.date = d ? dayOfYear(d.month, d.day, this.year) : null;
    /** The date the layout starts with ({year, doy}, or null: none). */
    this.startDate = d ? { year: this.year, doy: this.date } : null;
    this.latitude = Number.isFinite(Number(c.latitude)) ? clamp(Number(c.latitude), -89, 89) : DEFAULT_CLOCK.latitude;
    /** Minutes after midnight (fractional). */
    this.minutes = this.start;
    /** Days passed since the start (0 on the first day). */
    this.day = 0;
    /** While true, the time of day stands still (simulation and movement go on). */
    this.frozen = false;
  }

  /** Advance by `dt` simulated seconds. Returns true when midnight was passed. */
  advance(dt) {
    if (this.frozen || !(dt > 0)) return false;
    this.minutes += (dt * this.factor) / 60;
    if (this.minutes < DAY_MINUTES) return false;
    const days = Math.floor(this.minutes / DAY_MINUTES);
    this.day += days;
    if (this.date != null) {
      this.date += days;
      while (this.date > yearDays(this.year)) this.date -= yearDays(this.year++);
    }
    this.minutes = wrapMinutes(this.minutes);
    return true;
  }

  /**
   * Set the date ("2026-12-06"; "12-06" in the year it has, else {@link DEFAULT_YEAR}; null: no
   * date). Returns the day of the year, or null; undefined, and nothing changed, for what is no date
   * (also 29 February in a year that has none).
   */
  setDate(value) {
    if (value == null || value === "") {
      this.date = this.year = null;
      return null;
    }
    const d = parseDay(value);
    if (!d) return undefined;
    const year = d.year ?? this.year ?? DEFAULT_YEAR;
    if (d.month === 2 && d.day === 29 && !isLeapYear(year)) return undefined;
    this.year = year;
    this.date = dayOfYear(d.month, d.day, year);
    return this.date;
  }

  /** The month (1…12) and the day of the month, or null without a date. */
  monthDay() {
    return this.date == null ? null : monthDay(this.date, this.year);
  }

  /** The day of the week (0 = Monday … 6 = Sunday), or null without a date. */
  weekday() {
    return this.date == null ? null : dayOfWeek(this.year, this.date);
  }

  /**
   * The date in words: "Sun 6 Dec" (short), "Sunday, 6 December 2026" (`long`); "" without a date.
   * @param {{long?: boolean}} [options]
   */
  dateLabel({ long = false } = {}) {
    if (this.date == null) return "";
    const { month, day } = this.monthDay(), wd = this.weekday();
    return long ? `${DAY_NAMES[wd]}, ${day} ${MONTH_NAMES[month - 1]} ${this.year}` : `${DAYS[wd]} ${day} ${MONTHS[month - 1]}`;
  }

  /** The date as it is written ("2026-12-06"), or null. */
  dateString() {
    return this.date == null ? null : formatDate(this.date, this.year);
  }

  /** The season (winter, spring, summer, autumn), or null without a date. */
  season() {
    return this.date == null ? null : seasonOf(this.date);
  }

  /** Sunrise and sunset today (minutes after midnight): by the date and the latitude, else {@link SUN}. */
  sun() {
    if (this.date == null) return SUN;
    const key = `${this.year}|${this.date}|${this.latitude}`;
    if (this._sun?.key !== key) this._sun = { key, times: sunTimes(this.date, this.latitude, { year: this.year }) };
    return this._sun.times;
  }

  /** Jump to a time of day ("HH:MM" or minutes). */
  set(value) {
    const m = parseTime(value);
    if (m != null) this.minutes = m;
    return this.minutes;
  }

  get hours() {
    return this.minutes / 60;
  }

  /** "07:32" */
  label() {
    return formatTime(this.minutes);
  }

  /** Daylight 0 (night) .. 1 (day). */
  daylight() {
    return daylightAt(this.minutes, this.sun());
  }

  /** Darkness 0 (day) .. 1 (night), used for the lighting. */
  night() {
    return 1 - this.daylight();
  }

  /**
   * Demand factor for a kind of traffic at the current time ("rail", "bus", "car",
   * "passengers"); 1 when profiles are switched off or the kind is unknown.
   */
  demand(kind) {
    if (!this.profiles || !PROFILES[kind]) return 1;
    return profileAt(PROFILES[kind], this.minutes);
  }

  /** Simulated seconds until the clock shows `value` ("HH:MM" or minutes), at most one day. */
  secondsUntil(value) {
    const m = parseTime(value);
    if (m == null || !(this.factor > 0)) return Infinity;
    return (wrapMinutes(m - this.minutes) * 60) / this.factor;
  }

  /** The layout's `clock` section (the start time, not the current time). */
  toJSON() {
    return {
      start: formatTime(this.start), factor: this.factor, profiles: this.profiles,
      ...(this.startDate != null ? { date: formatDate(this.startDate.doy, this.startDate.year) } : {}),
      ...(this.latitude !== DEFAULT_CLOCK.latitude ? { latitude: this.latitude } : {}),
    };
  }
}
