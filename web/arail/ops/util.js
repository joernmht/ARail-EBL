/**
 * Helpers of the operations simulation: clock times and weekdays, working hours, random streams
 * keyed by names (the same event draws the same numbers in every setup that is compared), a few
 * distributions, an event queue and merging of settings.
 *
 * Times are clock minutes since 00:00 of day 0 (`t`); `t % 1440` is the time of day and
 * `(startWeekday + day) % 7` the weekday (0 = Monday).
 * @module arail/ops/util
 */
import { createRng, hashKey } from "../core/math.js";
import { formatTime } from "../core/clock.js";

export const DAY = 1440;
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Day index of a time. */
export const dayOf = (t) => Math.floor(t / DAY);
/** Time of day (minutes) of a time. */
export const todOf = (t) => ((t % DAY) + DAY) % DAY;

/**
 * Minutes after midnight of "HH:MM" (also "24:30" or "25:10" for times after midnight), or of a
 * number of minutes; null if invalid.
 */
export function clockMinutes(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const m = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h <= 47 && min <= 59 ? h * 60 + min : null;
}

/** "07:05" for a time (minutes since day 0 or of a day). */
export const hhmm = (t) => formatTime(todOf(t));

/** "Tue 07:05" for a time, with the weekday of day 0. */
export function dayTime(t, startWeekday = 0) {
  return `${WEEKDAY_LABELS[(startWeekday + dayOf(t)) % 7]} ${hhmm(t)}`;
}

/** Weekday index (0 = Monday) of "mon", "Tuesday", 3, …; `fallback` if unknown. */
export function weekdayIndex(v, fallback = 0) {
  if (Number.isInteger(v) && v >= 0 && v < 7) return v;
  const i = WEEKDAYS.indexOf(String(v ?? "").trim().slice(0, 3).toLowerCase());
  return i >= 0 ? i : fallback;
}

/**
 * The weekdays of a day set: "daily", "mon-fri", "weekdays", "weekend", "sat,sun", ["mon", "wed"]
 * or numbers (0 = Monday). Returns a set of weekday indices, or null if it cannot be read.
 */
export function weekdaySet(v) {
  if (v == null || v === "") return new Set([0, 1, 2, 3, 4, 5, 6]);
  const words = { daily: "mon-sun", all: "mon-sun", weekdays: "mon-fri", workdays: "mon-fri", weekend: "sat-sun" };
  const parts = Array.isArray(v) ? v : String(words[String(v).trim().toLowerCase()] ?? v).split(",");
  const out = new Set();
  for (const raw of parts) {
    if (Number.isInteger(raw)) {
      if (raw < 0 || raw > 6) return null;
      out.add(raw);
      continue;
    }
    const p = String(raw).trim().toLowerCase();
    if (!p) continue;
    const range = p.split("-").map((s) => WEEKDAYS.indexOf(s.trim().slice(0, 3)));
    if (range.some((i) => i < 0) || range.length > 2) return null;
    if (range.length === 1) out.add(range[0]);
    else for (let i = range[0]; ; i = (i + 1) % 7) {
      out.add(i);
      if (i === range[1]) break;
    }
  }
  return out;
}

/* ---------------------------------------------------------------- working hours */

/**
 * Working hours: "24/7" (always) or {days: "mon-fri", from: "07:00", to: "16:00"}; `to` before `from`
 * means over midnight (the night belongs to the day it starts on). Normalized to
 * `{always: true}` or `{always: false, days: Set, from, to}` (minutes).
 */
export function normalizeHours(h) {
  if (h == null || h === "24/7" || h === "always") return { always: true };
  if (typeof h !== "object") return { always: true };
  const days = weekdaySet(h.days) ?? new Set([0, 1, 2, 3, 4, 5, 6]);
  const from = clockMinutes(h.from) ?? 0, to = clockMinutes(h.to) ?? DAY;
  if (days.size === 7 && from === 0 && (to === DAY || to === 0)) return { always: true };
  return { always: false, days, from: from % DAY, to: to === from ? from + DAY : to < from ? to + DAY : to };
}

/** The open intervals [a, b) (absolute minutes) of working hours that touch day `d`. */
function openIntervals(hours, d, startWeekday) {
  const out = [];
  // a night shift that starts on the day before reaches into day d
  for (const day of [d - 1, d]) {
    if (!hours.days.has((((startWeekday + day) % 7) + 7) % 7)) continue;
    const a = day * DAY + hours.from, b = day * DAY + hours.to;
    if (b > d * DAY && a < (d + 1) * DAY) out.push([a, b]);
  }
  return out;
}

/** Is a party with these working hours at work at time t? */
export function isOpen(hours, t, startWeekday = 0) {
  if (hours.always) return true;
  return openIntervals(hours, dayOf(t), startWeekday).some(([a, b]) => t >= a && t < b);
}

/** The earliest time ≥ t inside the working hours (Infinity if they have no day at all). */
export function nextOpen(hours, t, startWeekday = 0) {
  if (hours.always) return t;
  if (!hours.days.size) return Infinity;
  for (let d = dayOf(t); d < dayOf(t) + 9; d++) {
    for (const [a, b] of openIntervals(hours, d, startWeekday)) {
      if (t < b) return Math.max(t, a);
    }
  }
  return Infinity;
}

/**
 * When `minutes` of working time are done if work starts at t (work only goes on inside the
 * working hours; a job that does not fit today goes on the next working day).
 */
export function addWork(hours, t, minutes, startWeekday = 0) {
  if (hours.always) return t + minutes;
  if (!hours.days.size) return Infinity;
  let left = minutes, now = t;
  for (let d = dayOf(t); d < dayOf(t) + 400; d++) {
    for (const [a, b] of openIntervals(hours, d, startWeekday)) {
      if (b <= now) continue;
      const s = Math.max(now, a), take = Math.min(left, b - s);
      left -= take;
      now = s + take;
      if (left <= 1e-9) return now;
    }
    now = Math.max(now, (d + 1) * DAY);
  }
  return Infinity;
}

/** Minutes of working time between t0 and t1. */
export function workBetween(hours, t0, t1, startWeekday = 0) {
  if (!(t1 > t0)) return 0;
  if (hours.always) return t1 - t0;
  let sum = 0;
  const first = dayOf(t0);
  for (let d = first; d <= dayOf(t1); d++) {
    for (const [a, b] of openIntervals(hours, d, startWeekday)) {
      // an interval over midnight touches two days: count it on the first of them looked at
      if (d !== Math.max(dayOf(a), first)) continue;
      sum += Math.max(0, Math.min(b, t1) - Math.max(a, t0));
    }
  }
  return sum;
}

/** Working hours as text: "always", "Mon–Fri 07:00–16:00". */
export function hoursLabel(hours) {
  if (hours.always) return "around the clock";
  const days = [...hours.days].sort((a, b) => a - b);
  let dayText = days.map((d) => WEEKDAY_LABELS[d]).join(", ");
  const run = days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (days.length === 7) dayText = "daily";
  else if (run) dayText = `${WEEKDAY_LABELS[days[0]]}–${WEEKDAY_LABELS[days[days.length - 1]]}`;
  return `${dayText} ${formatTime(hours.from)}–${formatTime(hours.to % DAY)}`;
}

/* ---------------------------------------------------------------- random numbers */

export { hashKey };

/**
 * A random stream for one purpose and thing (e.g. ("fail", unitId, day, tripId)): the same keys
 * give the same numbers in every run with the same seed, whatever else happens.
 */
export function stream(seed, ...parts) {
  const rng = createRng(hashKey(seed, ...parts));
  rng.next();
  return rng;
}

/** A log-normal number with this median and spread (σ of the logarithm). */
export function lognormal(rng, median, sigma) {
  if (!(median > 0)) return 0;
  return median * Math.exp(sigma * rng.normal());
}

/** An exponentially distributed number with this mean. */
export function exponential(rng, mean) {
  return -Math.log(1 - rng.next()) * mean;
}

/* ---------------------------------------------------------------- event queue */

/** A priority queue of events ordered by time, then priority, then insertion. */
export class EventQueue {
  constructor() {
    this.items = [];
    this.seq = 0;
  }

  get size() {
    return this.items.length;
  }

  /** Time of the next event (Infinity when empty). */
  peekTime() {
    return this.items.length ? this.items[0].t : Infinity;
  }

  /**
   * @param {number} t time
   * @param {string} type
   * @param {object} [data]
   * @param {number} [prio] lower first at the same time
   */
  push(t, type, data = {}, prio = 5) {
    const e = { t, prio, seq: this.seq++, type, data };
    const a = this.items;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
    return e;
  }

  pop() {
    const a = this.items;
    if (!a.length) return null;
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && before(a[l], a[m])) m = l;
        if (r < a.length && before(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

const before = (x, y) => x.t < y.t || (x.t === y.t && (x.prio < y.prio || (x.prio === y.prio && x.seq < y.seq)));

/* ---------------------------------------------------------------- settings */

export const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** `patch` merged into a copy of `base`: objects merge, everything else (lists too) replaces. */
export function deepMerge(base, patch) {
  if (!isObject(patch)) return patch === undefined ? structuredClone(base) : structuredClone(patch);
  const out = isObject(base) ? structuredClone(base) : {};
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isObject(v) && isObject(out[k]) ? deepMerge(out[k], v) : structuredClone(v);
  }
  return out;
}

/** A number within [min, max], or the fallback when it is not a finite number. */
export function num(v, fallback, min = -Infinity, max = Infinity) {
  const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** "1:05 h" for minutes. */
export function durationLabel(minutes) {
  if (!Number.isFinite(minutes)) return "–";
  const m = Math.max(0, Math.round(minutes));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h`;
}
