/**
 * The timetable of the operations simulation: the trips of a service day and the vehicle
 * rotations (Umläufe) that serve them.
 *
 * Every line runs from the first station of its route to the last one and back, at a fixed
 * headway (`takt_min`) from `first` to `last`; the trips back leave the far end a turnaround after
 * the first trip arrives there (or at `back_first`). On weekdays in the peak hours trains run with
 * `peak_units` units.
 *
 * Rotations are planned once per kind of day (which lines run, peak or not): trips are taken in
 * the order of their departures, and each takes the units that have waited longest at its
 * station (at least the line's turnaround); when there are none, a new rotation leaves the depot.
 * Every rotation starts and ends at the depot station (with an empty run when its first or last
 * trip is elsewhere), so every unit is at the depot at night.
 * @module arail/ops/timetable
 */
import { DAY } from "./util.js";

/** Minutes from the start of a line's route to each station (with dwell times), and km. */
export function lineProfile(line) {
  const at = [0], km = [0];
  for (let i = 0; i < line.run_min.length; i++) {
    at.push(at[i] + line.run_min[i] + (i > 0 ? line.dwell_min : 0));
    km.push(km[i] + line.km[i]);
  }
  return { at, km, run: at[at.length - 1], length: km[km.length - 1] };
}

/** Is a time of day (minutes, may exceed a day) in one of the peak windows? */
const inPeak = (line, tod) => line.peak.some(([a, b]) => (tod % DAY) >= a && (tod % DAY) < b);

/** Key of the kind of day (by its weekday, 0 = Monday): which lines run and which have peaks (same key = same trips and rotations). */
export function dayKind(model, wd) {
  return model.lines.map((l) => (l.days.has(wd) ? (l.peak_days.has(wd) && l.peak_units > l.units ? "P" : "R") : "-")).join("");
}

/**
 * The trips of a service day, as a template: times relative to the start of the day (they may
 * pass midnight), sorted by departure.
 * @param {object} model normalized settings
 * @param {number} wd weekday (0 = Monday)
 * @returns {object[]} trips {key, line, dir, k, from, to, stops: [{station, arr, dep}], dep, arr, km, units}
 */
export function tripTemplates(model, wd) {
  const out = [];
  for (const line of model.lines) {
    if (!line.days.has(wd)) continue;
    const peakDay = line.peak_days.has(wd);
    const prof = lineProfile(line);
    const count = Math.floor((line.last - line.first) / line.takt_min + 1e-9) + 1;
    const backFirst = line.back_first ?? line.first + prof.run + line.turn_min;
    for (const dir of [1, -1]) {
      const route = dir > 0 ? line.route : [...line.route].reverse();
      const offsets = dir > 0 ? prof.at : prof.at.map((a) => prof.run - a).reverse();
      for (let k = 0; k < count; k++) {
        const dep = (dir > 0 ? line.first : backFirst) + k * line.takt_min;
        const stops = route.map((station, i) => ({
          station,
          arr: i === 0 ? null : dep + offsets[i],
          dep: i === route.length - 1 ? null : dep + offsets[i] + (i > 0 ? line.dwell_min : 0),
        }));
        out.push({
          key: `${line.id}:${dir > 0 ? "out" : "back"}:${k}`, line: line.id, dir, k, from: route[0], to: route[route.length - 1],
          stops, dep, arr: dep + prof.run, km: prof.length, units: peakDay && inPeak(line, dep) ? line.peak_units : line.units,
          vehicle: line.vehicle, conductor: line.conductor,
        });
      }
    }
  }
  return out.sort((a, b) => a.dep - b.dep || a.key.localeCompare(b.key));
}

/**
 * Minutes of an empty run between two stations: along a line that serves both (the running
 * time between them), else an hour.
 */
export function emptyRunMin(model, from, to) {
  if (from === to) return 0;
  let best = Infinity;
  for (const line of model.lines) {
    const i = line.route.indexOf(from), j = line.route.indexOf(to);
    if (i < 0 || j < 0) continue;
    const prof = lineProfile(line);
    best = Math.min(best, Math.abs(prof.at[j] - prof.at[i]));
  }
  return Number.isFinite(best) ? best : 60;
}

/** Km of an empty run between two stations (along a line that serves both, else 40 km). */
export function emptyRunKm(model, from, to) {
  if (from === to) return 0;
  let best = Infinity;
  for (const line of model.lines) {
    const i = line.route.indexOf(from), j = line.route.indexOf(to);
    if (i < 0 || j < 0) continue;
    const prof = lineProfile(line);
    best = Math.min(best, Math.abs(prof.km[j] - prof.km[i]));
  }
  return Number.isFinite(best) ? best : 40;
}

/**
 * Rotations for a list of trip templates. Each rotation is the work of one unit for the day.
 * @param {object} model normalized settings
 * @param {object[]} trips trip templates (sorted by departure)
 * @param {string} depot id of the depot station
 * @returns {object[]} rotations {id, vehicle, trips: [key], start, end, pullOut, pullIn, km, emptyKm, layovers: [{station, from, to}]};
 *   each trip gets `rotations`, the ids of the rotations of its units (the leading unit first)
 */
export function planRotations(model, trips, depot) {
  const turn = new Map(model.lines.map((l) => [l.id, l.turn_min]));
  const stable = model.dispatch.stable_after_min;
  /** @type {Map<string, Array<{rot: object, ready: number}>>} units waiting at each station */
  const pools = new Map();
  const rotations = [];
  for (const trip of trips) {
    const at = `${trip.from}|${trip.vehicle}`;
    const pool = pools.get(at) || [];
    pools.set(at, pool);
    // the unit that came in last goes out first: the others stay at the station longer, so the units
    // that are only needed in the peaks wait at the depot between the peaks (time for maintenance)
    const ready = pool.filter((p) => p.ready <= trip.dep).sort((a, b) => b.ready - a.ready);
    const taken = ready.slice(0, trip.units);
    for (const p of taken) pool.splice(pool.indexOf(p), 1);
    while (taken.length < trip.units) {
      const empty = emptyRunMin(model, depot, trip.from);
      const rot = {
        id: `R${rotations.length + 1}`, vehicle: trip.vehicle, trips: [], start: trip.from, pullOut: trip.dep - empty - model.dispatch.pull_out_min,
        km: 0, emptyKm: emptyRunKm(model, depot, trip.from), layovers: [], last: null,
      };
      rotations.push(rot);
      taken.push({ rot, ready: trip.dep });
    }
    // the first unit leads the train (its rotation has the crew)
    trip.rotations = taken.map((p) => p.rot.id);
    for (const p of taken) {
      const rot = p.rot;
      if (rot.last) {
        const prev = rot.last;
        // a long wait at the depot station: the unit goes to the depot in between
        if (prev.to === trip.from && trip.dep - prev.arr >= stable) rot.layovers.push({ station: trip.from, from: prev.arr, to: trip.dep });
      }
      rot.trips.push(trip.key);
      rot.km += trip.km;
      rot.last = trip;
      // the unit waits at the destination for its turnaround
      const to = `${trip.to}|${trip.vehicle}`;
      const dest = pools.get(to) || [];
      pools.set(to, dest);
      dest.push({ rot, ready: trip.arr + (turn.get(trip.line) ?? 8) });
    }
  }
  for (const rot of rotations) {
    const last = rot.last;
    const back = emptyRunMin(model, last.to, depot);
    rot.end = last.to;
    rot.pullIn = last.arr + back + model.dispatch.pull_in_min;
    rot.emptyKm += emptyRunKm(model, last.to, depot);
    rot.layovers = rot.layovers.filter((l) => l.station === depot);
    delete rot.last;
  }
  return rotations;
}

/**
 * Minutes a crew member needs to ride as a passenger between two stations (deadheading): the
 * running time along a line serving both and, on average, half its headway waiting for the train.
 */
export function deadheadMin(model, from, to) {
  if (from === to) return 0;
  let wait = 30;
  for (const line of model.lines) if (line.route.includes(from) && line.route.includes(to)) wait = Math.min(wait, line.takt_min / 2);
  return emptyRunMin(model, from, to) + wait;
}

/**
 * Pieces of work for the crews: the trips of a rotation between two visits of a relief station
 * (where drivers can change). For a line out and back from the depot station a piece is one
 * round trip. Where a unit is parked for a long time away from a relief station (a unit for the
 * peaks waiting at the far end), the driver leaves it and rides back as a passenger, and another
 * one rides out to take it later (`travelAfter`, `travelBefore`). Only the leading unit of a train
 * has a crew: the trips where a rotation's unit is coupled behind another one are left out.
 * @param {object} model normalized settings
 * @param {object[]} rotations
 * @param {Map<string, object>} tripsByKey
 * @param {Set<string>} relief stations where crews can change
 * @param {string} base crew base station
 * @param {string} [depot] depot station (default: the crew base)
 * @returns {object[]} pieces {id, rotation, firstIndex, lastIndex, trips: [key], from, to, start, end, drive, conductor,
 *   fromDepot, toDepot, travelBefore, travelAfter} (the unit comes from / goes to the depot before / after the piece)
 */
export function planPieces(model, rotations, tripsByKey, relief, base, depot = base) {
  const stable = model.dispatch.stable_after_min;
  const pieces = [];
  for (const rot of rotations) {
    let cur = null, prev = null;
    const layoverAt = (t) => rot.layovers.some((l) => l.from === t || l.to === t);
    // a piece ends: the driver brings the unit to the depot at the end of the rotation (with the
    // empty run), leaves it at a relief station, or rides back as a passenger from anywhere else
    const close = (i, trip, next) => {
      cur.lastIndex = i;
      cur.toDepot = !next || layoverAt(trip.arr);
      cur.travelAfter = !next ? emptyRunMin(model, trip.to, depot) : relief.has(trip.to) ? 0 : deadheadMin(model, trip.to, base);
      pieces.push(cur);
      cur = null;
    };
    rot.trips.forEach((key, i) => {
      const trip = tripsByKey.get(key);
      // a unit coupled behind another one needs no crew of its own
      if (trip.rotations && trip.rotations[0] !== rot.id) {
        if (cur) close(i - 1, prev, trip);
        prev = trip;
        return;
      }
      if (!cur) {
        // the unit comes out of the depot at the start of the rotation (with an empty run) and after a long wait
        cur = {
          id: `${rot.id}/P${pieces.length + 1}`, rotation: rot.id, firstIndex: i, trips: [], from: trip.from, start: trip.dep, drive: 0, conductor: false,
          fromDepot: i === 0 || layoverAt(trip.dep),
          travelBefore: i === 0 ? emptyRunMin(model, depot, trip.from) : relief.has(trip.from) ? 0 : deadheadMin(model, base, trip.from),
        };
      }
      cur.trips.push(key);
      cur.drive += trip.arr - trip.dep;
      cur.conductor ||= !!trip.conductor;
      cur.to = trip.to;
      cur.end = trip.arr;
      const next = tripsByKey.get(rot.trips[i + 1]);
      const parked = !!next && !relief.has(trip.to) && next.dep - trip.arr >= stable;
      if (!next || relief.has(trip.to) || parked) close(i, trip, next);
      prev = trip;
    });
  }
  return pieces.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}
