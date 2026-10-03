/**
 * Crews, planned: duties (Dienste) built from the pieces of work of the rotations, reserve duties,
 * and the staff with their contracts, route knowledge and homes.
 *
 * A duty starts with signing on (`sign_on_min`) and a walk to the train (`walk_min`); a driver who
 * takes a unit out of the depot needs `pull_out_min` more, one who brings it back `pull_in_min`.
 * Between two pieces on different trains a driver needs `transfer_min` (to walk to the other train,
 * with a buffer); staying on the same unit needs nothing. Duties keep the German working-time
 * rules (Arbeitszeitgesetz): at most 6 hours without a break, breaks of at least 15 minutes, 30
 * minutes in total for more than 6 hours of work and 45 for more than 9; and at most `max_duty_h`.
 * @module arail/ops/crew
 */
import { DAY, hashKey, stream } from "./util.js";
import { birdName } from "./names.js";

/** Longest work without a break (minutes), and the breaks needed for more work (ArbZG § 4). */
export const WORK_RULES = { continuous: 360, breakMin: 15, after6: 30, after9: 45 };

/** Shift of a duty by its start (minutes of the day). */
export function shiftOf(start) {
  const tod = ((start % DAY) + DAY) % DAY;
  if (tod >= 180 && tod < 540) return "early";
  if (tod >= 540 && tod < 780) return "day";
  if (tod >= 780 && tod < 1200) return "late";
  return "night";
}

export const SHIFT_LABELS = { early: "early", day: "day", late: "late", night: "night", reserve: "stand-by" };

/** Minutes a driver is busy with a piece before its first departure and after its last arrival. */
export function pieceBounds(piece, d) {
  return {
    from: piece.start - (piece.fromDepot ? d.pull_out_min : 0) - (piece.travelBefore || 0),
    to: piece.end + (piece.toDepot ? d.pull_in_min : 0) + (piece.travelAfter || 0),
  };
}

/**
 * Duties for the pieces of work of one kind of day, in two steps:
 *
 * 1. Blocks: the work of each rotation is cut into stretches of about equal length (at most about
 *    half a duty and 6 hours), at the stations where crews can change; a driver stays with the unit
 *    for a block.
 * 2. Duties: the blocks are taken in the order of their start, each into the duty where it fits
 *    with the shortest wait (time to change trains, breaks, length of the duty), or a new duty.
 * @param {object} model normalized settings
 * @param {object[]} pieces pieces of work (timetable.planPieces), sorted by start
 * @param {{role?: string, prefix?: string}} [options] role "driver" (all pieces) or "conductor" (pieces that need one)
 * @returns {object[]} duties {id, role, kind: "line", pieces, signOn, signOff, paid, drive, breaks, shift, lines}
 */
export function buildDuties(model, pieces, { role = "driver", prefix = "D" } = {}) {
  const c = model.crew, d = model.dispatch;
  const maxDuty = Math.max(...c.contracts.map((k) => k.max_duty_h)) * 60;
  const overhead = c.sign_on_min + c.sign_off_min + 2 * c.walk_min;
  const target = Math.max(60, Math.min(WORK_RULES.continuous - 15, (maxDuty - overhead - WORK_RULES.after6 - c.transfer_min) / 2));
  const byRotation = new Map();
  for (const p of pieces) {
    if (role === "conductor" && !p.conductor) continue;
    if (!byRotation.has(p.rotation)) byRotation.set(p.rotation, []);
    byRotation.get(p.rotation).push(p);
  }
  const blocks = [];
  for (const list of byRotation.values()) blocks.push(...cutBlocks(list.sort((a, b) => a.firstIndex - b.firstIndex), target, d));
  blocks.sort((a, b) => a.from - b.from || a.pieces[0].id.localeCompare(b.pieces[0].id));
  const open = [];
  for (const blk of blocks) {
    let best = null;
    for (const duty of open) {
      const last = duty.blocks[duty.blocks.length - 1];
      const same = last.rotation === blk.rotation && blk.firstIndex === last.lastIndex + 1;
      const gap = blk.from - last.to;
      if (gap < (same ? 0 : c.transfer_min) || gap > c.max_gap_min) continue;
      const pause = gap - (same ? 0 : c.transfer_min) >= WORK_RULES.breakMin ? gap - (same ? 0 : c.transfer_min) : 0;
      const signOff = blk.to + c.walk_min + c.sign_off_min, length = signOff - duty.signOn;
      if (length > maxDuty) continue;
      const continuous = pause ? blk.to - blk.from : duty.sinceBreak + gap + blk.to - blk.from;
      if (continuous > WORK_RULES.continuous) continue;
      const breaks = duty.breaks + pause, work = length - breaks;
      if ((work > 540 && breaks < WORK_RULES.after9) || (work > 360 && breaks < WORK_RULES.after6)) continue;
      const score = (same ? -1000 : 0) + gap;
      if (!best || score < best.score) best = { duty, score, pause, signOff, continuous };
    }
    if (best) {
      best.duty.blocks.push(blk);
      best.duty.breaks += best.pause;
      best.duty.sinceBreak = best.continuous;
      best.duty.signOff = best.signOff;
    } else {
      open.push({ blocks: [blk], breaks: 0, sinceBreak: blk.to - blk.from, signOn: blk.from - c.walk_min - c.sign_on_min, signOff: blk.to + c.walk_min + c.sign_off_min });
    }
  }
  open.sort((a, b) => a.signOn - b.signOn);
  return open.map((duty, i) => finishDuty({ ...duty, pieces: duty.blocks.flatMap((b) => b.pieces) }, `${prefix}${String(i + 1).padStart(2, "0")}`, role, model));
}

/**
 * Blocks of one rotation's pieces (in order): runs of pieces on the same unit without a stop at the
 * depot or a ride as a passenger, each cut into stretches of about equal length, at most `target`.
 */
function cutBlocks(list, target, d) {
  const runs = [];
  let cur = [];
  for (const p of list) {
    const prev = cur[cur.length - 1];
    if (prev && !(p.firstIndex === prev.lastIndex + 1 && !prev.toDepot && !prev.travelAfter)) {
      runs.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) runs.push(cur);
  const blocks = [];
  const make = (ps) => ({
    pieces: ps, rotation: ps[0].rotation, firstIndex: ps[0].firstIndex, lastIndex: ps[ps.length - 1].lastIndex,
    from: pieceBounds(ps[0], d).from, to: pieceBounds(ps[ps.length - 1], d).to,
  });
  for (const run of runs) {
    const span = pieceBounds(run[run.length - 1], d).to - pieceBounds(run[0], d).from;
    const len = span / Math.max(1, Math.ceil(span / target));
    let blk = [];
    for (const p of run) {
      if (blk.length) {
        const from = pieceBounds(blk[0], d).from, now = pieceBounds(blk[blk.length - 1], d).to - from, next = pieceBounds(p, d).to - from;
        if (next > target || (next > len && now >= 0.75 * len)) {
          blocks.push(make(blk));
          blk = [];
        }
      }
      blk.push(p);
    }
    if (blk.length) blocks.push(make(blk));
  }
  return blocks;
}

function finishDuty(duty, id, role, model) {
  const drive = duty.pieces.reduce((s, p) => s + p.drive, 0);
  const lines = new Set();
  for (const p of duty.pieces) for (const key of p.trips) lines.add(key.slice(0, key.lastIndexOf(":", key.lastIndexOf(":") - 1)));
  return {
    id, role, kind: "line", pieces: duty.pieces, signOn: duty.signOn, signOff: duty.signOff,
    paid: duty.signOff - duty.signOn - duty.breaks, drive, breaks: duty.breaks, shift: shiftOf(duty.signOn), lines: [...lines],
    base: model.crew.base,
  };
}

/** Reserve (stand-by) duties of a day: crews at the crew base, ready to take over. */
export function reserveDuties(model, role = "driver") {
  const out = [];
  for (const r of model.crew.reserve) {
    for (let i = 0; i < r.count; i++) {
      out.push({
        id: `${role === "driver" ? "R" : "RC"}${String(out.length + 1).padStart(2, "0")}`, role, kind: "reserve", pieces: [],
        signOn: r.from, signOff: r.to, paid: r.to - r.from, drive: 0, breaks: 0, shift: "reserve", lines: [], base: model.crew.base,
      });
    }
  }
  return out;
}

/* ---------------------------------------------------------------- staff */

/** Contracts for `n` people by their shares (largest remainder, in the order of the contracts). */
export function contractMix(contracts, n) {
  const total = contracts.reduce((s, k) => s + k.share, 0) || 1;
  const exact = contracts.map((k) => (k.share / total) * n);
  const counts = exact.map(Math.floor);
  let left = n - counts.reduce((s, v) => s + v, 0);
  const order = exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    counts[i]++;
    left--;
  }
  return contracts.flatMap((k, i) => Array.from({ length: counts[i] }, () => k));
}

/**
 * Staff of one role.
 * @param {object} model normalized settings
 * @param {number} count
 * @param {{role: string, seed: number, lines: string[], homes: Array<{id: string, name?: string, walkM: number, weight?: number}>,
 *   outer: Array<{station: string, line: string}>}} o homes: buildings on the layout (with the walk to the crew base);
 *   outer: stations beyond the layout where staff can live (and the line that brings them in)
 * @returns {object[]} people
 */
export function makeStaff(model, count, { role, seed, lines, homes = [], outer = [] }) {
  const c = model.crew;
  const contracts = contractMix(c.contracts, count);
  const people = [];
  const used = new Set();
  for (let i = 0; i < count; i++) {
    const rng = stream(seed, "person", role, i);
    const name = birdName(used, seed, role, i);
    // route knowledge: every line with probability route_knowledge, at least one
    const known = lines.filter((l) => rng.chance(c.route_knowledge));
    if (!known.length && lines.length) known.push(lines[hashKey(seed, role, i, "line") % lines.length]);
    let home;
    if (outer.length && rng.chance(c.off_layout_homes)) {
      const o = outer[rng.int(outer.length)];
      home = { kind: "station", station: o.station, line: o.line };
    } else if (homes.length) {
      const h = homes[rng.weighted(homes.map((x) => x.weight ?? 1))];
      home = { kind: "layout", building: h.id, name: h.name ?? h.id, walkM: h.walkM };
    } else {
      home = { kind: "away", minutes: Math.max(5, Math.round(c.commute.car_min * rng.uniform(0.5, 1.3))) };
    }
    people.push({
      id: `${role === "driver" ? "T" : "Z"}${String(i + 1).padStart(2, "0")}`, name, role, contract: contracts[i], lines: new Set(known), home,
    });
  }
  return people;
}

/** "A. Fink" */
export const shortName = (name) => {
  const [first, ...rest] = String(name).split(" ");
  return rest.length ? `${first[0]}. ${rest.join(" ")}` : name;
};

/**
 * How a person gets to the crew base: "walk", "car" or "train", and the minutes it takes (by train:
 * the walk from the platform; the train is chosen per duty).
 */
export function commuteOf(model, home) {
  const k = model.crew.commute;
  if (home.kind === "station") return { mode: "train", minutes: model.crew.walk_min };
  if (home.kind === "layout") {
    if (home.walkM <= k.walk_max_m) return { mode: "walk", minutes: Math.max(2, Math.round(home.walkM / 75)) };
    return { mode: "car", minutes: Math.max(4, Math.round(Math.min(k.car_min, 4 + home.walkM / 350))) };
  }
  return { mode: "car", minutes: home.minutes ?? k.car_min };
}
