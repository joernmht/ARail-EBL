/**
 * The maintenance staff of the infrastructure manager: per discipline technicians on day shift
 * (planned work: inspections, repairs; faults in their shift), an emergency team (Entstörer) in a
 * rotating three-shift system around the clock, a technician on call outside the shifts
 * (Rufbereitschaft), the Anlagenverantwortliche (ALV) and the drone pilots.
 *
 * Shifts: day shift Mon–Fri (`staff.day_shift`); emergency team early 06–14, late 14–22, night
 * 22–06 in a ten-day cycle (2 early, 2 late, 2 nights, 4 days off): five people cover one post
 * around the clock. The on-call duty goes round the day technicians of a discipline week by week.
 * @module arail/infra/staff
 */
import { DISCIPLINE_IDS, DISCIPLINES } from "./catalog.js";
import { DAY, clockMinutes, hashKey } from "../ops/util.js";

const FIRST = [
  "Anja", "Bernd", "Carsten", "Dana", "Erik", "Franziska", "Gerd", "Heiko", "Ines", "Jörg", "Karin", "Lars", "Maik", "Nadine", "Oliver",
  "Peggy", "René", "Sandra", "Torsten", "Ulrike", "Volker", "Yvonne", "Silke", "Mirko", "Doreen", "Ronny", "Steffi", "Enrico", "Katja", "Marco",
];
const LAST = [
  "Lehmann", "Seidel", "Hentschel", "Kühn", "Ullrich", "Pietsch", "Böhme", "Hering", "Schreiber", "Barth", "Kretzschmar", "Fiedler",
  "Mehnert", "Lindner", "Pfeifer", "Rößler", "Thiele", "Ebert", "Großmann", "Haase", "Kunze", "Martin", "Voigt", "Winkler", "Ziegler",
];

/** Shift kinds and their clock times (minutes after midnight). */
export const SHIFTS = {
  early: { label: "early", from: 360, to: 840 },
  late: { label: "late", from: 840, to: 1320 },
  night: { label: "night", from: 1320, to: 1800 },
};
/** Emergency rota: the shift of position 0–9 of the ten-day cycle. */
const CYCLE = ["early", "early", "late", "late", "night", "night", null, null, null, null];

/** Weekday (0 = Monday) of day d of the game (day 0 = 1 January of the start year). */
export function weekdayOf(d, startYear) {
  const w0 = (new Date(Date.UTC(startYear, 0, 1)).getUTCDay() + 6) % 7;
  return (((w0 + d) % 7) + 7) % 7;
}

/** A person of the maintenance staff. */
export class Person {
  constructor(spec) {
    Object.assign(this, spec);
    /** Busy until (minutes) with `task`. */
    this.busyUntil = -Infinity;
    this.task = null;
    /** Where the person is (network position, m): at the base unless working. */
    this.at = null;
    /** Planned work of today: [{task, start, end}]. */
    this.plan = [];
  }

  /** Is the person employed at time t? */
  employed(t) {
    return t >= (this.joined ?? -Infinity) && t < (this.left ?? Infinity);
  }
}

/**
 * The staff for the settings: names are stable for a seed and position.
 * @param {object} model normalized settings
 * @param {number} seed
 */
export function makePeople(model, seed) {
  const people = [];
  const used = new Set();
  const name = (...key) => {
    for (let k = 0; ; k++) {
      const n = `${FIRST[hashKey(seed, ...key, k, "f") % FIRST.length]} ${LAST[hashKey(seed, ...key, k, "l") % LAST.length]}`;
      if (!used.has(n) || k > 40) {
        used.add(n);
        return n;
      }
    }
  };
  for (const d of DISCIPLINE_IDS) {
    people.push(new Person({ id: `alv-${d}`, name: name("alv", d), discipline: d, role: "alv" }));
    const s = model.staff[d];
    for (let i = 0; i < s.day; i++) people.push(new Person({ id: `${d}-day-${i + 1}`, name: name(d, "day", i), discipline: d, role: "day", index: i }));
    for (let i = 0; i < s.emergency; i++) people.push(new Person({ id: `${d}-em-${i + 1}`, name: name(d, "em", i), discipline: d, role: "emergency", rota: i }));
  }
  for (let i = 0; i < model.staff.drone_pilots; i++) people.push(new Person({ id: `pilot-${i + 1}`, name: name("pilot", i), discipline: "drone", role: "pilot", index: i }));
  return people;
}

/** A new person (hired). */
export function hirePerson(model, seed, people, discipline, role, t) {
  const same = people.filter((p) => p.discipline === discipline && p.role === role);
  const n = same.length + 1;
  const used = new Set(people.map((p) => p.name));
  let nm = "";
  for (let k = 0; k < 60 && (!nm || used.has(nm)); k++) nm = `${FIRST[hashKey(seed, "hire", discipline, role, n, k) % FIRST.length]} ${LAST[hashKey(seed, "hire", discipline, role, n, k, "l") % LAST.length]}`;
  const base = discipline === "drone" ? "pilot" : `${discipline}-${role === "emergency" ? "em" : "day"}`;
  let k = n;
  while (people.some((q) => q.id === `${base}-${k}`)) k++;
  const p = new Person({ id: `${base}-${k}`, name: nm, discipline, role, joined: t });
  if (role === "emergency") p.rota = Math.max(-1, ...same.map((q) => q.rota ?? -1)) + 1;
  else p.index = Math.max(-1, ...same.map((q) => q.index ?? -1)) + 1;
  return p;
}

/**
 * The shift of a person at time t: {on, kind, from, to} (absolute minutes) where `on` means at
 * work; `kind` "day", "early", "late", "night", "oncall" (at home, can be called) or "off".
 * @param {Person} p
 * @param {number} t minutes
 * @param {object} model
 * @param {Person[]} people all staff (for the on-call rotation)
 */
export function shiftOf(p, t, model, people) {
  const d = Math.floor(t / DAY), tod = t - d * DAY, wd = weekdayOf(d, model.start_year);
  if (!p.employed(t)) return { on: false, kind: "off" };
  if (p.role === "emergency") {
    // the night shift that began yesterday reaches into the morning
    for (const day of [d, d - 1]) {
      const kind = CYCLE[(((day + 2 * p.rota) % 10) + 10) % 10];
      if (!kind) continue;
      const s = SHIFTS[kind], from = day * DAY + s.from, to = day * DAY + s.to;
      if (t >= from && t < to) return { on: true, kind, from, to };
    }
    return { on: false, kind: "off" };
  }
  const ds = model.staff.day_shift, from = clockMinutes(ds.from) ?? 420, to = clockMinutes(ds.to) ?? 930;
  const workday = wd < 5;
  if (workday && tod >= from && tod < to) return { on: true, kind: "day", from: d * DAY + from, to: d * DAY + to };
  if (p.role === "day" && model.staff.oncall && onCallPerson(p.discipline, t, model, people) === p) return { on: false, kind: "oncall" };
  return { on: false, kind: "off" };
}

/** The day technician on call for a discipline at time t (weekly rotation, Monday to Monday), or null. */
export function onCallPerson(discipline, t, model, people) {
  if (!model.staff.oncall) return null;
  const pool = people.filter((p) => p.discipline === discipline && p.role === "day" && p.employed(t));
  if (!pool.length) return null;
  const d = Math.floor(t / DAY), week = Math.floor((d + weekdayOf(0, model.start_year)) / 7);
  return pool[week % pool.length];
}

/** "Signalling and telecoms, day shift" and the like. */
export function roleLabel(p) {
  const what = p.role === "alv" ? "ALV" : p.role === "emergency" ? "emergency team" : p.role === "pilot" ? "drone pilot" : "day shift";
  return p.discipline === "drone" ? what : `${DISCIPLINES[p.discipline]?.short ?? p.discipline} · ${what}`;
}
