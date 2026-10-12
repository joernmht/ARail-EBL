/**
 * Rolling stock: units with their odometers, maintenance counters, wear and defects, and the
 * failure model.
 *
 * Failures are random events per trip. The expected number on a trip of `km` kilometres is
 *
 *   rate × km × A(age) × W(wear) × factor
 *
 * where `rate` is the type's failure rate (hard failures per 100 000 km, soft ones per 10 000 km),
 * A(age) = 1 + infant · e^(−age / infant_years) + ageing · max(0, age − ageing_from) is a bathtub
 * curve over the years, and W(wear) = (1 − w) + w · shape · (x / I)^(shape − 1) grows with the
 * kilometres x run since the wear was last taken away by maintenance (I: the shortest km interval of
 * the programme; w: the share of failures that come from wear). W averages 1 over one interval, so
 * a unit maintained on time fails at about its rate; one overdue fails more and more often.
 * Maintenance takes away a share of the wear: x ← x · (1 − quality · wear_reset).
 * @module arail/ops/fleet
 */
import { DAY } from "./util.js";

/** Minutes per year. */
const YEAR = 365.25 * DAY;

/** Unit states. */
export const UNIT_STATES = {
  ready: "ready",
  service: "in service",
  job: "in the workshop",
  waiting: "waiting for the workshop",
  failed: "failed",
  transfer: "on the way to the workshop",
  out: "out of service",
};

export class Unit {
  /**
   * @param {{id: string, type: object, built: number, km: number}} spec
   * @param {string} depot station of the depot
   */
  constructor({ id, type, built, km }, depot) {
    this.id = id;
    this.type = type;
    this.built = built;
    /** Odometer (km). */
    this.km = km;
    /** Last time each maintenance level was done: levelId -> {km, t}. */
    this.counters = {};
    /** Km of wear since maintenance last took it away (see the module comment). */
    this.wear = 0;
    /** Open soft defects: {kind, since, deadline, reported}. */
    this.defects = [];
    /** One of UNIT_STATES. */
    this.status = "ready";
    /** Station (or "depot", "workshop") where the unit is or will be when its current move ends. */
    this.at = depot;
    /** Time from which the unit is ready at `at`. */
    this.readyAt = -Infinity;
    /** Known as ready by the operator's dispatch (a release from the workshop arrives as a message). */
    this.released = true;
    /** Rotation instance of today (or null for a spare). */
    this.rotation = null;
    /** Workshop job (planned or running) or null. */
    this.job = null;
    /** Extra tolerance granted by the maintenance development: levelId -> share. */
    this.extensions = {};
    /** Until when the unit is out of service (damage), or null. */
    this.outUntil = null;
    /** End of the last workshop visit (for repeat failures). */
    this.lastWorkshop = -Infinity;
    /** Odometer readings [t, km] (for planners that see the mileage late). */
    this.odo = [[-Infinity, km]];
    /** Trip being run, or null. */
    this.trip = null;
  }

  /** Age in years at time t (day 0 is 1 January of `year`). */
  age(t, year) {
    return Math.max(0, year - this.built + t / YEAR);
  }

  /** Odometer reading as it was at time t. */
  kmAt(t) {
    const odo = this.odo;
    if (t >= odo[odo.length - 1][0]) return odo[odo.length - 1][1];
    let lo = 0, hi = odo.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (odo[mid][0] <= t) lo = mid;
      else hi = mid;
    }
    return odo[lo][1];
  }

  /** Run `km` kilometres, arriving at time t. */
  run(km, t) {
    this.km += km;
    this.wear += km;
    this.odo.push([t, this.km]);
    // keep a month of readings
    if (this.odo.length > 400) this.odo.splice(1, this.odo.length - 300);
  }

  /** Share used of a level's interval at time t with `km` on the odometer (the larger of km and days). */
  usage(level, t, km = this.km) {
    const c = this.counters[level.id] || { km: 0, t: 0 };
    const byKm = level.every_km ? (km - c.km) / level.every_km : 0;
    const byDays = level.every_days ? (t - c.t) / (level.every_days * DAY) : 0;
    return Math.max(byKm, byDays);
  }

  /** Largest share of the interval a level may reach (1 + tolerance + an extension granted). */
  limit(level) {
    return 1 + level.tolerance + (this.extensions[level.id] || 0);
  }

  /** The level whose limit is closest (largest usage / limit), with that ratio. */
  mostDue(program, t, km = this.km) {
    let best = null;
    for (const level of program) {
      const r = this.usage(level, t, km) / this.limit(level);
      if (!best || r > best.ratio) best = { level, ratio: r };
    }
    return best;
  }

  /** May the unit run at time t (no maintenance level past its limit)? */
  overdue(program, t) {
    return program.some((level) => this.usage(level, t) > this.limit(level));
  }

  /** Km the unit may still run before a level reaches its limit (Infinity without km intervals). */
  kmLeft(program, t, km = this.km) {
    let left = Infinity;
    for (const level of program) {
      if (!level.every_km) continue;
      const c = this.counters[level.id] || { km: 0, t: 0 };
      left = Math.min(left, c.km + level.every_km * this.limit(level) - km);
    }
    return left;
  }

  /** Days until a level reaches its limit by the calendar. */
  daysLeft(program, t) {
    let left = Infinity;
    for (const level of program) {
      if (!level.every_days) continue;
      const c = this.counters[level.id] || { km: 0, t: 0 };
      left = Math.min(left, (c.t + level.every_days * DAY * this.limit(level) - t) / DAY);
    }
    return left;
  }

  /** Record maintenance of a level (and the levels it includes) at time t. */
  maintained(level, program, t, quality) {
    const done = new Set([level.id, ...level.includes]);
    for (const l of program) if (done.has(l.id)) this.counters[l.id] = { km: this.km, t };
    for (const id of done) delete this.extensions[id];
    this.wear *= 1 - quality * level.wear_reset;
  }

  /** Does the unit have a defect that makes the train slower? Extra minutes per trip. */
  defectDelay(softKinds) {
    let d = 0;
    for (const def of this.defects) d = Math.max(d, softKinds.get(def.kind)?.delay_min || 0);
    return d;
  }

  /** Is a comfort defect open (air conditioning, toilet, door)? */
  hasComfortDefect(softKinds) {
    return this.defects.some((d) => softKinds.get(d.kind)?.comfort);
  }

  /** Short state text for the panel. */
  stateText() {
    return UNIT_STATES[this.status] || this.status;
  }
}

/**
 * Expected number of failures of a unit on `km` kilometres.
 * @param {Unit} unit
 * @param {number} km
 * @param {"hard" | "soft"} kind
 * @param {{t: number, year: number, interval: number, factor: number}} o interval: shortest km interval of the programme
 */
export function expectedFailures(unit, km, kind, { t, year, interval, factor }) {
  const f = unit.type.failure;
  const age = unit.age(t, year);
  const A = 1 + f.infant * Math.exp(-age / Math.max(0.05, f.infant_years)) + f.ageing * Math.max(0, age - f.ageing_from);
  const x = Math.max(0, unit.wear) / Math.max(1, interval);
  const W = 1 - f.wear_share + f.wear_share * f.shape * Math.pow(x, f.shape - 1);
  const rate = kind === "hard" ? f.hard_per_100k_km / 100000 : f.soft_per_10k_km / 10000;
  return rate * km * A * W * factor;
}

/** The shortest km interval of a programme (the scale of the wear), or 10 000 km. */
export function wearInterval(program) {
  const kms = program.map((l) => l.every_km).filter((v) => v > 0);
  return kms.length ? Math.min(...kms) : 10000;
}
