/**
 * Crews at work: the daily roster, absences, the way to work, signing on and off, and the
 * dispatcher who finds a replacement when a driver is missing (Personaldisposition).
 *
 * The roster for a day is made at noon the day before: every duty goes to a qualified person who
 * has had the minimum rest, has not worked `max_days_row` days in a row and still needs hours this
 * week (part of the deficit first, overtime only when nobody else can). Absences: vacation (planned
 * long before), sickness (spells that start on the day, reported `sick_notice_min` before signing
 * on; known for the following days) and vacant positions. A sick call is covered by a person on
 * stand-by whose stand-by covers the duty, else by somebody called in on a free day (who accepts
 * with `overtime_accept`), else its pieces of work are left open. At each departure the dispatcher
 * takes the planned driver, or the one who can be at the train first: a driver on stand-by, a
 * driver waiting for their next piece, or the planned one if they arrive within `wait_crew_min`.
 * @module arail/ops/crewdesk
 */
import { DAY, dayOf, lognormal, stream } from "./util.js";
import { commuteOf, pieceBounds } from "./crew.js";
import { deadheadMin } from "./timetable.js";

/** A person may stay this much longer than `max_duty_h` when trains are late (minutes). */
const EXTEND_MIN = 30;
/** Minutes a call to a person on a free day takes until they set off. */
const CALL_MIN = 10;

export class CrewDesk {
  /**
   * @param {import("./engine.js").OpsEngine} engine
   * @param {object[]} people static people (crew.makeStaff), all roles
   */
  constructor(engine, people) {
    this.e = engine;
    this.model = engine.model;
    /** @type {Map<string, object>} */
    this.people = new Map();
    for (const p of people) {
      this.people.set(p.id, {
        ...p, commute: commuteOf(this.model, p.home),
        sickFrom: null, sickUntil: -1, left: null, plan: new Map(), today: null, present: false, at: null, freeAt: -Infinity,
        lastEnd: -Infinity, lastEndPlanned: -Infinity, week: new Map(), onTrip: null, work: new Set(),
      });
    }
    /** Duty instances by id. */
    this.duties = new Map();
  }

  get c() {
    return this.model.crew;
  }

  /** Week index of a day (weeks start on Monday). */
  weekOf(day) {
    return Math.floor((day + this.e.wd0) / 7);
  }

  /** Is a person on vacation on a day (blocks of `vacation_days`, `vacation_rate` of the time)? */
  onVacation(p, day) {
    const c = this.c;
    if (!(c.vacation_rate > 0)) return false;
    const span = 28, w = Math.floor(day / span);
    for (const k of [w - 1, w]) {
      const rng = stream(this.e.seed, "vacation", p.id, k);
      if (!rng.chance(Math.min(1, (c.vacation_rate * span) / c.vacation_days))) continue;
      const start = k * span + rng.int(span);
      if (day >= start && day < start + c.vacation_days) return true;
    }
    return false;
  }

  /** Is a person known to be sick on a day (a spell that started before)? */
  sickOn(p, day) {
    return day >= (p.sickFrom ?? Infinity) && day <= p.sickUntil;
  }

  /** Can a person work at all on a day (not left, not on vacation, not known sick)? */
  available(p, day) {
    return (p.left == null || day < p.left) && !this.onVacation(p, day) && !this.sickOn(p, day);
  }

  contractOf(p) {
    return p.contract;
  }

  /* ---------------------------------------------------------------- roster */

  /**
   * Roster a day: give its duties to people (made the day before at noon).
   * @param {number} day
   * @param {object[]} duties duty instances of the day (line duties, then stand-by)
   */
  roster(day, duties) {
    const week = this.weekOf(day);
    const assigned = new Set();
    const order = [...duties].sort((a, b) => (a.kind === b.kind ? a.signOn - b.signOn : a.kind === "line" ? -1 : 1));
    for (const duty of order) {
      this.duties.set(duty.id, duty);
      let best = null;
      for (const pass of [0, 1]) {
        for (const p of this.people.values()) {
          if (p.role !== duty.role || assigned.has(p.id) || !this.available(p, day) || !this._fits(p, duty, day)) continue;
          const deficit = p.contract.hours_week * 60 - (p.week.get(week) || 0);
          if (pass === 0 && deficit < duty.paid * 0.5) continue;
          const tie = stream(this.e.seed, "roster", p.id, duty.id).next();
          const score = Math.min(deficit, duty.paid) - 0.1 * Math.max(0, duty.paid - deficit) + tie * 5;
          if (!best || score > best.score) best = { p, score };
        }
        if (best) break;
      }
      if (!best) {
        duty.state = "open";
        this.e.stat("dutiesOpen", 1);
        continue;
      }
      this._assign(best.p, duty, day);
      assigned.add(best.p.id);
    }
  }

  /** Can a person take a duty on a day (rest, days in a row, contract, qualification)? */
  _fits(p, duty, day, { now = null } = {}) {
    const k = p.contract;
    if (duty.signOff - duty.signOn > k.max_duty_h * 60 + 1) return false;
    if (k.earliest != null && (duty.signOn % DAY) < k.earliest) return false;
    if (k.latest_end != null && duty.signOff - day * DAY > k.latest_end) return false;
    if (duty.lines.some((l) => !p.lines.has(l))) return false;
    // rest since the last duty (planned or actual end, whichever is later)
    const last = Math.max(p.lastEnd, p.lastEndPlanned);
    if (duty.signOn - last < k.min_rest_h * 60) return false;
    // the next planned duty still gets its rest
    const next = p.plan.get(day + 1);
    if (next && next.signOn - duty.signOff < k.min_rest_h * 60) return false;
    if (p.plan.get(day) && p.plan.get(day) !== duty) return false;
    let row = 0;
    while (row < 14 && p.plan.has(day - row - 1)) row++;
    if (row >= k.max_days_row) return false;
    if (now != null && p.present === false && p.onTrip) return false;
    return true;
  }

  _assign(p, duty, day) {
    duty.person = p.id;
    duty.state = "planned";
    for (const pi of duty.pieces) this._give(pi, p);
    p.plan.set(day, duty);
    p.lastEndPlanned = Math.max(p.lastEndPlanned, duty.signOff);
    const week = this.weekOf(day);
    p.week.set(week, (p.week.get(week) || 0) + duty.paid);
  }

  _unassign(p, duty, day) {
    if (p.plan.get(day) === duty) p.plan.delete(day);
    for (const pi of duty.pieces) if (pi.person === p.id && pi.state === "planned") this._give(pi, null);
    const week = this.weekOf(day);
    p.week.set(week, Math.max(0, (p.week.get(week) || 0) - duty.paid));
    p.lastEndPlanned = -Infinity;
    for (const d of p.plan.values()) p.lastEndPlanned = Math.max(p.lastEndPlanned, d.signOff);
  }

  /* ---------------------------------------------------------------- absences and the way to work */

  /**
   * After the roster: new sick spells of the day (the people with a duty call in before signing
   * on), and the way to work of everybody with a duty.
   */
  prepare(day, duties) {
    const c = this.c;
    // a spell starting on a day: chance so that `sick_rate` of all days are sick days
    const start = c.sick_rate > 0 ? c.sick_rate / (c.sick_days * (1 - Math.min(0.95, c.sick_rate))) : 0;
    for (const p of this.people.values()) {
      if (this.sickOn(p, day) || !this.available(p, day)) continue;
      const rng = stream(this.e.seed, "sick", p.id, day);
      if (!rng.chance(start)) continue;
      const len = Math.max(1, Math.round(-Math.log(1 - rng.next()) * c.sick_days));
      p.sickFrom = day;
      p.sickUntil = day + len - 1;
      const duty = p.plan.get(day);
      if (duty) {
        const notice = c.sick_notice_min * rng.uniform(0.4, 1.4);
        this.e.queue.push(Math.max(this.e.now, duty.signOn - notice), "crew.sick", { person: p.id, duty: duty.id }, 3);
      }
    }
    for (const duty of duties) {
      if (duty.person) this._planCommute(this.people.get(duty.person), duty);
    }
  }

  /**
   * When a person sets off for a duty and when they arrive (`duty.commute`); by train the arrival
   * follows the train they ride in on.
   */
  _planCommute(p, duty) {
    const c = this.c, e = this.e;
    const k = c.commute;
    const rng = stream(e.seed, "commute", p.id, duty.day);
    const late = rng.chance(k.late_p) ? lognormal(rng, k.late_min, 0.6) : 0;
    const target = duty.signOn - k.margin_min;
    const plan = { person: p.id, late, trip: null, leaveAt: null, arriveAt: null };
    duty.commute = plan;
    if (p.commute.mode === "train") {
      const trip = e.commuteTrip(p.home.station, c.base, target - c.walk_min, duty.day);
      if (trip && trip.arr >= target - 90) {
        plan.trip = trip.id;
        plan.leaveAt = trip.dep - 10;
        plan.arriveAt = trip.arr + c.walk_min;
        return;
      }
    }
    const minutes = p.commute.mode === "train" ? k.car_min : p.commute.minutes;
    plan.leaveAt = target - minutes + late;
    plan.arriveAt = target + late;
    // live: a person who walks on the layout reports the arrival; a check in case they never arrive
    if (e.live && p.home.kind === "layout" && p.commute.mode === "walk") e.queue.push(duty.signOn + 120, "crew.noshow", { person: p.id, duty: duty.id }, 4);
    else e.queue.push(plan.arriveAt, "crew.arrive", { person: p.id, duty: duty.id }, 3);
  }

  /** Is this person (still) the one for this duty? */
  _isFor(p, duty) {
    return duty.person === p.id && p.plan.get(duty.day) === duty && duty.state !== "done" && duty.state !== "cancelled";
  }

  /** A person arrives at the crew base. */
  arrive(pid, dutyId, t) {
    const p = this.people.get(pid), duty = this.duties.get(dutyId);
    if (!p || !duty || !this._isFor(p, duty) || (p.present && p.today === duty) || this.sickOn(p, duty.day)) return;
    if (p.today && p.today !== duty && p.today.state !== "done") return;
    p.today = duty;
    p.present = true;
    p.at = this.c.base;
    const on = Math.max(t, duty.signOn);
    p.signedOn = on;
    p.freeAt = on + this.c.sign_on_min;
    if (t > duty.signOn + 1) {
      this.e.stat("lateSignOns", 1);
      this.e.stat("lateSignOnMin", t - duty.signOn);
      this.e.log(`${p.name} signs on ${Math.round(t - duty.signOn)} min late (${duty.tpl.id})`, "crew");
    }
    if (duty.state === "planned") duty.state = "active";
    this.e.emit("crew.signon", { person: p, duty });
    if (duty.kind === "reserve") this.e.queue.push(Math.max(duty.signOff, t), "crew.end", { person: p.id, duty: duty.id }, 8);
    else if (!duty.pieces.length) this.e.queue.push(Math.max(duty.signOff, t), "crew.end", { person: p.id, duty: duty.id }, 8);
  }

  /** Live: a person did not arrive two hours after the start of their duty: absent for the day. */
  noShow(pid, dutyId) {
    const p = this.people.get(pid), duty = this.duties.get(dutyId);
    if (!p || !duty || !this._isFor(p, duty) || (p.present && p.today === duty)) return;
    this.e.log(`${p.name} did not come to work (${duty.tpl.id})`, "crew");
    this._release(p, duty, "commute");
  }

  /** A sick call: the duty needs somebody else. */
  sickCall(pid, dutyId) {
    const p = this.people.get(pid), duty = this.duties.get(dutyId);
    if (!p || !duty || duty.person !== p.id) return;
    this.e.stat("sickCalls", 1);
    this.e.log(`${p.name} called in sick (${duty.tpl.id}, ${this.e.timeText(duty.signOn)})`, "crew");
    this.e.emit("crew.sick", { person: p, duty });
    this._release(p, duty, "sick");
  }

  /** Take a person off a duty (sick, absent): the dispatcher covers it if possible. */
  _release(p, duty, cause) {
    if (p.today === duty) {
      p.present = false;
      p.today = null;
    }
    this._unassign(p, duty, duty.day);
    duty.person = null;
    duty.absentCause = cause;
    if (duty.kind === "reserve") {
      duty.state = "cancelled";
      return;
    }
    duty.state = "open";
    this.cover(duty, cause);
  }

  /**
   * Cover a whole duty: a person on stand-by whose stand-by covers it, else somebody on a free day.
   * @param {object} duty
   * @param {string} cause why its person is missing
   * @param {{quiet?: boolean}} [options] quiet: nobody found is not counted (the caller keeps the duty's person)
   * @returns {boolean}
   */
  cover(duty, cause, { quiet = false } = {}) {
    const e = this.e, now = e.now;
    // stand-by (also somebody whose stand-by has not started yet)
    for (const p of this.people.values()) {
      const r = p.present && p.today?.kind === "reserve" ? p.today : p.plan.get(duty.day);
      if (!r || r.kind !== "reserve" || r.used || r.person !== p.id || r.state === "cancelled" || r.state === "done" || p.role !== duty.role) continue;
      if (this.sickOn(p, duty.day)) continue;
      if (duty.lines.some((l) => !p.lines.has(l))) continue;
      if (r.signOn > duty.signOn + 1 || duty.signOff - r.signOn > p.contract.max_duty_h * 60) continue;
      r.used = true;
      r.takenDuty = duty.id;
      this._takeOver(p, duty);
      e.stat("coveredByReserve", 1);
      e.log(`${p.name} (stand-by) takes over ${duty.tpl.id}`, "crew");
      return true;
    }
    // a call to somebody on a free day
    if (this.c.call_in && duty.signOn - now > 30) {
      const week = this.weekOf(duty.day);
      const candidates = [...this.people.values()].filter((p) => {
        if (p.role !== duty.role || p.plan.has(duty.day) || !this.available(p, duty.day) || (p.today && p.today.state !== "done")) return false;
        const k = p.contract;
        if ((p.week.get(week) || 0) + duty.paid > (k.hours_week + k.max_overtime_h_week) * 60) return false;
        return this._fits(p, duty, duty.day);
      });
      candidates.sort((a, b) => (a.week.get(week) || 0) - (b.week.get(week) || 0) || a.id.localeCompare(b.id));
      for (const p of candidates) {
        if (!stream(e.seed, "callin", p.id, duty.id).chance(p.contract.overtime_accept)) continue;
        this._assign(p, duty, duty.day);
        duty.state = "planned";
        duty.calledIn = true;
        e.stat("coveredByCallIn", 1);
        e.log(`${p.name} comes in on a free day for ${duty.tpl.id}`, "crew");
        this._planCommute(p, duty);
        // they set off after the call
        const earliest = now + CALL_MIN + (p.commute.mode === "train" ? this.c.commute.car_min : p.commute.minutes);
        if (duty.commute.arriveAt < earliest) {
          duty.commute.arriveAt = earliest;
          duty.commute.leaveAt = now + CALL_MIN;
          duty.commute.trip = null;
          if (!(e.live && p.home.kind === "layout" && p.commute.mode === "walk")) e.queue.push(earliest, "crew.arrive", { person: p.id, duty: duty.id }, 3);
        }
        return true;
      }
    }
    if (quiet) return false;
    e.stat("dutiesUncovered", 1);
    e.log(`Nobody for ${duty.tpl.id} (${e.timeText(duty.signOn)}): its trains need drivers on the day`, "crew");
    return false;
  }

  /**
   * Give a person's planned duty to somebody else (stand-by, or a call on a free day); when nobody
   * can take it, the person keeps it.
   * @returns {boolean} whether somebody else took it
   */
  _swap(p, duty, cause) {
    this._unassign(p, duty, duty.day);
    duty.person = null;
    duty.state = "open";
    if (this.cover(duty, cause, { quiet: true })) return true;
    this._assign(p, duty, duty.day);
    return false;
  }

  /** A person on stand-by takes over a duty (their stand-by becomes this duty). */
  _takeOver(p, duty) {
    const reserve = p.plan.get(duty.day);
    if (reserve && reserve !== duty && reserve.kind === "reserve") reserve.state = "taken";
    duty.person = p.id;
    for (const pi of duty.pieces) if (!pi.person && pi.state === "planned") this._give(pi, p);
    p.plan.set(duty.day, duty);
    const week = this.weekOf(duty.day);
    p.week.set(week, (p.week.get(week) || 0) + duty.paid - (reserve?.paid || 0));
    if (p.present && p.today === reserve) {
      p.today = duty;
      duty.state = "active";
      p.freeAt = Math.max(p.freeAt, this.e.now);
      return;
    }
    // not there yet: they come for this duty instead
    duty.state = "planned";
    duty.commute = { ...(reserve?.commute || {}), person: p.id };
    const at = duty.commute.arriveAt;
    if (at != null && !(this.e.live && p.home.kind === "layout" && p.commute.mode === "walk") && !duty.commute.trip) {
      this.e.queue.push(Math.max(this.e.now, at), "crew.arrive", { person: p.id, duty: duty.id }, 3);
    }
  }

  /** Live: a person reached the crew base; which duty they came for. */
  arrivedAtBase(pid, t) {
    const p = this.people.get(pid);
    if (!p) return;
    let best = null;
    for (const duty of p.plan.values()) {
      if (!this._isFor(p, duty) || (p.present && p.today === duty)) continue;
      if (Math.abs(duty.signOn - t) > 720) continue;
      if (!best || duty.signOn < best.signOn) best = duty;
    }
    if (best) this.arrive(pid, best.id, t);
  }

  /* ---------------------------------------------------------------- at the train */

  /** Give a piece of work to a person (or to nobody). */
  _give(pi, p) {
    const old = pi.person ? this.people.get(pi.person) : null;
    if (old && old !== p) old.work.delete(pi);
    pi.person = p ? p.id : null;
    if (p) p.work.add(pi);
  }

  /** Pieces a person still has to do in their current duty (its own and those taken over). */
  *_current(p) {
    for (const pi of p.work) {
      if (pi.state !== "planned" && pi.state !== "running") {
        p.work.delete(pi);
        continue;
      }
      if (pi.duty === p.today || (pi.substitute && pi.duty.day <= (p.today?.day ?? -Infinity))) yield pi;
    }
  }

  /** Number of pieces a person still has to do in their current duty. */
  _open(p) {
    let n = 0;
    for (const pi of this._current(p)) if (pi) n++;
    return n;
  }

  /** Minutes a person needs from where they are to the first train of a piece. */
  _toPiece(p, pi) {
    const c = this.c, d = this.model.dispatch, piece = pi.tpl;
    if (p.onTrain === piece.rotation && p.onTrainIndex === piece.firstIndex - 1) return 0;
    const fromBase = p.at === c.base || p.at == null;
    let need = piece.travelBefore ? piece.travelBefore : 0;
    if (piece.fromDepot) need += d.pull_out_min;
    else need += fromBase ? c.walk_min : c.transfer_min;
    return need;
  }

  /** When a person can be at the train for a trip of a piece. */
  _readyFor(p, pi, trip, { called = false } = {}) {
    if (!p.present || p.today == null) {
      const plan = pi.duty.person === p.id ? pi.duty.commute : null;
      return plan?.arriveAt != null ? Math.max(plan.arriveAt, pi.duty.signOn) + this.c.sign_on_min + this._toPiece(p, pi) : Infinity;
    }
    const i = pi.trips.indexOf(trip);
    if (i > 0) {
      // the next trip of the piece: the same train, after its turnaround
      if (!p.onTrip) return p.freeAt;
      const prev = this.e.trips.get(p.onTrip);
      if (prev && prev === pi.trips[i - 1] && Number.isFinite(prev.arrE)) return prev.arrE + (this.e.lines.get(trip.line)?.turn_min ?? 5);
      return Infinity;
    }
    if (p.onTrip) {
      // still on another train: free at its arrival
      const prev = this.e.trips.get(p.onTrip);
      return prev && Number.isFinite(prev.arrE) ? prev.arrE + this._toPiece({ ...p, at: prev.to }, pi) : Infinity;
    }
    // the planned person sets off as soon as they are free; somebody called now sets off now
    return (called ? Math.max(p.freeAt, this.e.now) : p.freeAt) + this._toPiece(p, pi);
  }

  /**
   * Who drives (or accompanies) a trip: the planned person if they can be at the train in time,
   * else the one who can be there first.
   * @param {object} trip trip instance
   * @param {"driver" | "conductor"} role
   * @returns {{person: object | null, ready: number, cause: string | null, substitute: boolean}}
   */
  crewFor(trip, role) {
    const pi = trip.pieces?.[role];
    if (!pi) return { person: null, ready: -Infinity, cause: null, substitute: false };
    const now = this.e.now;
    const first = pi.trips.indexOf(trip) === 0 || !pi.trips.slice(0, pi.trips.indexOf(trip)).some((t) => t.state === "done" || t.state === "running");
    // somebody already called for this piece is on the way
    const called = pi.pending ? this.people.get(pi.pending.person) : null;
    if (called && called.present && !called.onTrip && called.reservedFor === pi) return { person: called, ready: pi.pending.ready, cause: null, substitute: true };
    const planned = pi.person ? this.people.get(pi.person) : null;
    if (planned && (!first || this._withinDuty(planned, pi, trip))) {
      const ready = this._readyFor(planned, pi, trip);
      if (ready <= Math.max(now, trip.dep)) return { person: planned, ready, cause: null, substitute: false };
      // late by more than a few minutes: somebody else may be at the train clearly earlier (only at the start of a piece)
      const slack = this.model.dispatch.short_wait_min;
      const sub = first && ready > trip.dep + slack ? this._substitute(trip, pi, role) : null;
      if (sub && sub.ready < ready - 3) return this._call(pi, sub);
      const cause = planned.present && planned.today ? this._lateCause(planned) : "commute";
      return { person: Number.isFinite(ready) ? planned : null, ready, cause, substitute: false };
    }
    const sub = first ? this._substitute(trip, pi, role) : null;
    if (sub) return this._call(pi, sub);
    return { person: null, ready: Infinity, cause: planned ? "rest" : pi.duty.absentCause || "crew", substitute: false };
  }

  /** The dispatcher calls somebody for a piece: they set off now and are kept for it. */
  _call(pi, sub) {
    pi.pending = { person: sub.p.id, ready: sub.ready };
    sub.p.reservedFor = pi;
    return { person: sub.p, ready: sub.ready, cause: null, substitute: true };
  }

  /** Cause of a present person being late for their next piece: the delay of their previous train. */
  _lateCause(p) {
    return p.lateCause || "crew";
  }

  /** May a person do a piece without going beyond their longest duty (with a little leeway for delays)? */
  _withinDuty(p, pi, trip) {
    const start = p.present && p.today ? p.signedOn : pi.duty.signOn;
    const end = Math.max(this.e.now, trip.dep) + (pieceBounds(pi.tpl, this.model.dispatch).to - pi.tpl.start) + this.c.walk_min + this.c.sign_off_min;
    return end - start <= p.contract.max_duty_h * 60 + EXTEND_MIN;
  }

  /** The person who can be at the start of a piece first: on stand-by, or waiting for their next piece. */
  _substitute(trip, pi, role) {
    const now = this.e.now;
    const end = pieceBounds(pi.tpl, this.model.dispatch).to;
    let best = null;
    for (const p of this.people.values()) {
      if (p.role !== role || !p.present || !p.today || p.onTrip || !p.lines.has(trip.line) || pi.person === p.id) continue;
      // called for another piece that has not left yet
      if (p.reservedFor && p.reservedFor !== pi && p.reservedFor.state === "planned") continue;
      const ready = this._readyFor(p, pi, trip, { called: true });
      if (ready > trip.dep + this.model.dispatch.wait_crew_min) continue;
      // free until this piece is done (and the way to the next one)
      let clash = false;
      for (const x of this._current(p)) {
        if (x.state === "running" || x.trips[0].dep - this._toPiece(p, x) < end + this.c.transfer_min) clash = true;
      }
      if (clash) continue;
      const presence = Math.max(end, ready) + this.c.walk_min + this.c.sign_off_min - p.signedOn;
      if (presence > p.contract.max_duty_h * 60) continue;
      const score = ready + (p.today.kind === "reserve" ? 0 : 1);
      if (!best || score < best.score) best = { p, ready, score };
    }
    return best;
  }

  /**
   * A trip departs with this person: they take over the piece if they were not planned for it.
   * @param {object} trip
   * @param {"driver" | "conductor"} role
   * @param {object} p person
   * @param {boolean} substitute
   */
  depart(trip, role, p, substitute) {
    const pi = trip.pieces[role];
    if (pi.pending) {
      const called = this.people.get(pi.pending.person);
      if (called?.reservedFor === pi) called.reservedFor = null;
      pi.pending = null;
    }
    if (substitute && pi.person !== p.id) {
      const old = pi.person ? this.people.get(pi.person) : null;
      this._give(pi, p);
      pi.substitute = true;
      this.e.stat("coveredAdHoc", 1);
      if (p.today?.kind === "reserve") {
        p.today.used = true;
        this.e.stat("reserveCalls", 1);
      }
      this.e.log(`${p.name} takes over ${trip.lineName} ${this.e.timeText(trip.dep)}${old ? ` from ${old.name}` : ""}`, "crew");
      if (old && !old.onTrip) this._checkEnd(old);
    }
    pi.state = "running";
    p.onTrip = trip.id;
    p.onTrain = pi.tpl.rotation;
    p.at = null;
    if (role === "driver") trip.driver = p.id;
    else trip.conductor = p.id;
  }

  /** A trip arrived: its crew is free at the station (or after bringing the unit to the depot, or riding back). */
  arrived(trip, role, t, lateCause) {
    const pi = trip.pieces?.[role];
    const pid = role === "driver" ? trip.driver : trip.conductor;
    const p = pid ? this.people.get(pid) : null;
    if (!pi || !p) return;
    p.onTrip = null;
    p.lateCause = lateCause;
    p.onTrainIndex = trip.rotIndex;
    const i = pi.trips.indexOf(trip);
    const more = pi.trips.slice(i + 1).some((x) => x.state === "planned" || x.state === "waiting");
    if (more) {
      p.freeAt = t;
      p.at = trip.to;
      return;
    }
    pi.state = "done";
    p.work.delete(pi);
    const d = this.model.dispatch, piece = pi.tpl;
    const complete = pi.trips[pi.trips.length - 1] === trip;
    if (complete) {
      p.freeAt = t + (piece.toDepot ? d.pull_in_min : 0) + (piece.travelAfter || 0);
      p.at = piece.toDepot || piece.travelAfter ? this.c.base : trip.to;
      p.onTrain = !piece.toDepot && !piece.travelAfter ? piece.rotation : null;
    } else {
      // the rest of the piece was cancelled: back to the crew base (as a passenger where crews do not change)
      const away = !this.e.relief.has(trip.to);
      p.freeAt = t + (away ? deadheadMin(this.model, trip.to, this.c.base) : 0);
      p.at = away ? this.c.base : trip.to;
      p.onTrain = null;
    }
    this._checkEnd(p);
  }

  /** A piece of work that will not run (its trips cancelled): its person is free again. */
  pieceDropped(pi) {
    if (pi.state === "done" || pi.state === "cancelled") return;
    pi.state = "cancelled";
    if (pi.pending) {
      const called = this.people.get(pi.pending.person);
      if (called?.reservedFor === pi) called.reservedFor = null;
      pi.pending = null;
    }
    const p = pi.person ? this.people.get(pi.person) : null;
    if (!p) return;
    p.work.delete(pi);
    if (!p.onTrip) {
      p.onTrain = null;
      this._checkEnd(p);
    }
  }

  /** A line duty ends when the person has no piece left to do. */
  _checkEnd(p) {
    const duty = p.today;
    if (!duty || !p.present || this._open(p) > 0 || p.onTrip) return;
    if (duty.kind === "reserve" && this.e.now < duty.signOff) return;
    const t = Math.max(this.e.now, p.freeAt) + (p.at === this.c.base ? 0 : this.c.walk_min) + this.c.sign_off_min;
    this.e.queue.push(duty.kind === "reserve" ? Math.max(t, duty.signOff) : t, "crew.end", { person: p.id, duty: duty.id }, 8);
  }

  /** Sign off: the duty is over. */
  end(pid, dutyId, t) {
    const p = this.people.get(pid), duty = this.duties.get(dutyId);
    if (!p || !duty || p.today !== duty || duty.state === "done") return;
    if (duty.kind === "reserve" && t < duty.signOff) return;
    // somebody who still has work (also pieces taken over) stays until it is done
    if (this._open(p) > 0 || p.onTrip) return;
    const start = p.signedOn ?? duty.signOn;
    const paid = t - start - (duty.kind === "line" ? duty.breaks : 0);
    duty.state = "done";
    duty.end = t;
    p.present = false;
    p.today = null;
    p.at = null;
    p.onTrain = null;
    p.lastEnd = t;
    const week = this.weekOf(duty.day);
    p.week.set(week, (p.week.get(week) || 0) - duty.paid + paid);
    const over = Math.max(0, t - Math.max(duty.signOff, start + (duty.signOff - duty.signOn)));
    if (over > 0) this.e.stat("overtimeMin", over);
    this.e.stat("paidMin", paid);
    if (duty.kind === "reserve") this.e.stat("standbyMin", paid);
    if (t - start > p.contract.max_duty_h * 60 + 0.5) {
      this.e.stat("longDuties", 1);
      this.e.log(`${p.name} worked ${(Math.round((t - start) / 6) / 10).toFixed(1)} h (${duty.tpl.id})`, "crew");
    }
    // the next duty gets its rest? else the dispatcher gives it to somebody else, if anybody can take it
    const next = p.plan.get(duty.day + 1);
    if (next && next.signOn - t < p.contract.min_rest_h * 60) {
      if (next.kind === "line" && next.state === "planned" && this._swap(p, next, "rest")) {
        this.e.log(`${p.name} needs the full rest: ${next.tpl.id} tomorrow goes to somebody else`, "crew");
      } else {
        this.e.stat("restConflicts", 1);
        this.e.log(`${p.name} cannot have the full rest before ${next.tpl.id} tomorrow`, "crew");
        next.restConflict = true;
      }
    }
    this.e.emit("crew.signoff", { person: p, duty });
  }

  /** Duties of the days kept whose crew rides in on a trip. */
  *_riding(tripId) {
    for (const duty of this.duties.values()) if (duty.commute?.trip === tripId && duty.person) yield duty;
  }

  /** Trip arrived: people riding it in to work arrive at the crew base after the walk. */
  tripArrived(trip, t) {
    for (const duty of this._riding(trip.id)) {
      const p = this.people.get(duty.person);
      duty.commute.trip = null;
      duty.commute.arriveAt = t + this.c.walk_min;
      if (!this.e.live) this.e.queue.push(duty.commute.arriveAt, "crew.arrive", { person: p.id, duty: duty.id }, 3);
      else this.e.emit("crew.alighted", { person: p, duty, trip });
    }
  }

  /** Trip cancelled: people who wanted to ride it to work take the next one of the line (or a taxi). */
  tripCancelled(trip) {
    for (const duty of [...this._riding(trip.id)]) {
      const p = this.people.get(duty.person);
      // the next train if it still gets them there in time, else whatever is quicker (a taxi)
      const next = this.e.nextTripLike(trip);
      const byTrain = next ? next.arr + this.c.walk_min : Infinity, byTaxi = this.e.now + this.c.commute.car_min;
      if (next && (byTrain <= duty.signOn - this.c.commute.margin_min || byTrain <= byTaxi)) {
        duty.commute.trip = next.id;
        duty.commute.arriveAt = byTrain;
      } else {
        duty.commute.trip = null;
        duty.commute.arriveAt = this.e.now + this.c.commute.car_min;
        if (!this.e.live) this.e.queue.push(duty.commute.arriveAt, "crew.arrive", { person: p.id, duty: duty.id }, 3);
      }
    }
  }

  /** A person is stuck with a broken-down train until `until`, then back at the crew base. */
  stuck(pid, until) {
    const p = this.people.get(pid);
    if (!p) return;
    p.onTrip = null;
    p.onTrain = null;
    p.freeAt = until;
    p.at = this.c.base;
    p.lateCause = "failure";
  }

  /** People who leave for good (long-term shortage). */
  leave(count, day, role = "driver") {
    const staff = [...this.people.values()].filter((p) => p.role === role && p.left == null);
    staff.sort((a, b) => stream(this.e.seed, "leave", a.id).next() - stream(this.e.seed, "leave", b.id).next());
    for (const p of staff.slice(0, count)) p.left = day;
    return Math.min(count, staff.length);
  }

  /** Sick calls now (a stress test): people with a line duty today that has not started yet, the earliest first. */
  sickNow(count, notice) {
    const e = this.e, now = e.now, day = dayOf(now);
    const list = [];
    for (const p of this.people.values()) {
      for (const d of [day, day + 1]) {
        const duty = p.plan.get(d);
        if (duty && duty.kind === "line" && this._isFor(p, duty) && duty.signOn > now && !(p.present && p.today === duty)) list.push({ p, duty });
      }
    }
    list.sort((a, b) => a.duty.signOn - b.duty.signOn || a.p.id.localeCompare(b.p.id));
    const seen = new Set();
    let n = 0;
    for (const { p, duty } of list) {
      if (n >= count || seen.has(p.id)) continue;
      seen.add(p.id);
      p.sickFrom = dayOf(now);
      p.sickUntil = Math.max(p.sickUntil, dayOf(now) + 2);
      e.queue.push(Math.max(now, Math.min(duty.signOn - 1, now + (notice ?? 0))), "crew.sick", { person: p.id, duty: duty.id }, 3);
      n++;
    }
    return n;
  }
}
