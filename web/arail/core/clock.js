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
};

/** Sunrise and sunset (minutes after midnight) and the length of the twilight. */
export const SUN = { rise: 6 * 60, set: 20 * 60 + 30, twilight: 45 };

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
    this.day += Math.floor(this.minutes / DAY_MINUTES);
    this.minutes = wrapMinutes(this.minutes);
    return true;
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
    return daylightAt(this.minutes);
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
    return { start: formatTime(this.start), factor: this.factor, profiles: this.profiles };
  }
}
