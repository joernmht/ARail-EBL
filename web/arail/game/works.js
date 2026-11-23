/**
 * The maintenance district manager's game (Bezirksleiter/in Instandhaltung), "A week of works":
 * Monday 06:00 to Friday 06:00 in the district around Bf Neustadt. Four works are planned (a
 * tamping night at Bergheim, the inspection of two points at the station, a rail with a known
 * defect at Talsee, the vegetation on the branch to Waldau), and what nobody planned comes too: a
 * driver's report of a hard knock, a point that fails in the morning peak, a storm.
 *
 * The game teaches who must be told what, and when. Every piece of news has people who need it,
 * a latest moment (a notice period, a duty to report) and an earliest (once it will hold):
 *
 * - The possession planner, who speaks for the signal boxes and the undertakings, needs every
 *   possession outside the standing windows a day and a half ahead, and every change of one. Told
 *   later, the undertakings may claim compensation; told of what needs no possession, it is noise.
 * - The works council must consent to every shift outside the published rota, a day ahead, and
 *   before the people are told. Asked piece by piece it loses patience; not asked, it goes to the
 *   labour court.
 * - The people need two days to arrange their lives round a night: children, a mother to care
 *   for, an evening school, 45 km to drive home. Told and then changed, they arranged it for nothing.
 * - The town (the public order office, for the houses along the line) wants a night work announced
 *   one to three days ahead: earlier is forgotten, later is a fine, and a notice for a night that
 *   then moves is worse than none.
 * - The railway operations manager must hear of a dangerous event within the hour, and of a
 *   period that will be missed before it ends; woken for what is none, he says so.
 *
 * So early news is fragile and late news is unlawful, and the week's sudden events move what was
 * announced. Between the questions the plan is the player's: when each work is done, who is on it
 * (by trade and qualification, by where they live and what their week allows), who is told now,
 * who is sent to a fault. Works cost trains: a possession by day is single-line working in dense
 * traffic, one at night meets one train an hour and needs the night's notices.
 *
 * Four people count differently, their patience falls, they phone and ask for a promise, and at
 * the end of it they act. The team's strain is the fifth number.
 *
 * Simplified for teaching: a second of the shift is three minutes of the week (`PACE`); the notice
 * periods are scaled to a week and keep their order (in practice a possession is registered weeks
 * to months ahead, a rota change four days); a work has a few slots to choose from; one person
 * clears a fault; the traffic is a number of trains an hour by the time of day.
 * @module arail/game/works
 */
import { Game, Player } from "./core.js";

/** A second of the shift is so many seconds of the week: four days in 32 minutes. */
export const PACE = 180;
/** The week begins on Monday at this hour and is so many hours long (to Friday 06:00). */
const START_H = 6;
export const WEEK_H = 96;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
/** Seconds of the shift of hours of the week, and back. */
const S = (h) => (h * 3600) / PACE;
const hoursOf = (t) => (t * PACE) / 3600;
/** An hour of the week (hours since Monday 06:00) of a day and a time of day. */
export const at = (day, hh, mm = 0) => DAYS.indexOf(day) * 24 + hh + mm / 60 - START_H;
const two = (n) => String(n).padStart(2, "0");
const clock = (h) => {
  const m = Math.round((h + START_H) * 60);
  return `${two(Math.floor(m / 60) % 24)}:${two(m % 60)}`;
};
const dayOf = (h) => DAYS[Math.min(DAYS.length - 1, Math.max(0, Math.floor((h + START_H + 1e-9) / 24)))];
/** An hour of the week as it is said: "Wed 22:00". */
export const when = (h) => `${dayOf(h)} ${clock(h)}`;
const hourOfDay = (h) => (((h + START_H) % 24) + 24) % 24;
/** Whether an hour of the week is at night (20:00 to 05:00): work then is heard in the houses, and outside every day shift. */
const isNight = (h) => hourOfDay(h) >= 20 || hourOfDay(h) < 5;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const hrs = (v) => `${Math.round(v * 10) / 10} h`;
const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");
const cap = (s) => `${s[0].toUpperCase()}${s.slice(1)}`;

/**
 * The areas of the district: where the works and the faults are. `trains`: how much of the main
 * line's traffic passes (the station's track G3 half of it, the branch a third and nothing at
 * night); `houses`: whether people live beside the track there.
 */
export const AREAS = {
  west: { name: "Bergheim", line: "the line to Bergheim", trains: 1, houses: true },
  station: { name: "Bf Neustadt", line: "track G3 and its points", trains: 0.5, houses: false },
  east: { name: "Talsee", line: "the line to Talsee", trains: 1, houses: true },
  branch: { name: "Waldau", line: "the branch to Waldau", trains: 0.3, houses: false },
};
/** The trains an hour on the main line by the time of day: until the hour, so many. */
export const TRAFFIC = [[5, 1], [6, 3], [9, 8], [15, 5], [19, 8], [22, 4], [24, 1]];
/**
 * What a restriction costs a train (min): single-line working beside a possession, a closed track
 * (cancelled or sent round), running on sight after a driver's report, 20, 40 and 70 km/h over a
 * defect, a failed point at the station; and what a train costs that was replaced in good time
 * for a possession registered into the morning's traffic.
 */
export const EFFECT = { single: 4, closed: 12, sight: 3, slow20: 3, slow40: 1.2, slow70: 0.25, points: 8, planned: 6 };
/** The first train of the morning comes at this hour of the day: a night possession that is registered or runs beyond it meets it. */
const FIRST_TRAIN = 4 + 50 / 60;

/** The trains an hour through an area at an hour of the week. */
export function trainsAt(area, h) {
  const x = hourOfDay(h), a = AREAS[area];
  if (area === "branch" && (x >= 22 || x < 5)) return 0;
  return (TRAFFIC.find(([until]) => x < until)?.[1] ?? 1) * a.trains;
}

/** The day shift of the published rota (hours of the day), and the rest between two shifts the working-time law asks for (h). */
export const SHIFT = { from: 6.5, to: 15, rest_h: 11 };

/**
 * The technicians (bird names, see CONTRIBUTING.md): their trade and qualifications (`possession`:
 * may manage a possession on site; `weld`; `relay`: knows the relay interlocking's point circuits),
 * where they live and how long they drive from there to each area and to the base (min), the
 * nights they are on call by the published rota (0: Monday), and their life: what it is, when
 * they cannot work (hours of the week, from … to), and how long ahead they must be told to
 * arrange it (h).
 */
export const PEOPLE = [
  {
    id: "p1", name: "H. Bussard", trade: "track", quals: ["possession"], home: "Bergheim", drive: { west: 8, station: 15, east: 28, branch: 30 }, on_call: [],
    life: "two small children; the partner works nights at the hospital on Tuesday and Wednesday", no: [[at("Tue", 20), at("Wed", 6.5)], [at("Wed", 20), at("Thu", 6.5)]], notice_h: 48, way: "the grandmother comes, if she knows two days ahead",
  },
  {
    id: "p2", name: "D. Wróbel", trade: "track", quals: ["weld", "possession"], home: "Altenau", drive: { west: 60, station: 45, east: 35, branch: 55 }, on_call: [2, 3],
    life: "lives 45 km away; has his children from Friday noon", no: [], notice_h: 48, way: "a room at the site after a night saves the drive home",
  },
  {
    id: "p3", name: "T. Doğan", trade: "signalling", quals: [], home: "Neustadt", drive: { west: 15, station: 5, east: 12, branch: 14 }, on_call: [0, 1, 2, 3],
    life: "evening school for the master craftsman's certificate on Monday and Wednesday, 18:00 to 21:00; the exam is next week", no: [[at("Mon", 17), at("Mon", 22)], [at("Wed", 17), at("Wed", 22)]], notice_h: 72, way: "the school excuses one evening, asked three days ahead",
  },
  {
    id: "p4", name: "E. Schwalbe", trade: "signalling", quals: ["relay", "possession"], home: "Talsee", drive: { west: 27, station: 14, east: 6, branch: 25 }, on_call: [],
    life: "cares for her mother: at home from 16:00 until the carer comes at 19:00, every day", no: DAYS.slice(0, 4).map((d) => [at(d, 16), at(d, 19)]), notice_h: 24, way: "her sister takes over, asked a day ahead",
  },
  {
    id: "p5", name: "R. Pirol", trade: "track", quals: [], home: "Waldau", drive: { west: 28, station: 14, east: 25, branch: 5 }, on_call: [0, 1],
    life: "volunteer firefighter at Waldau: in a storm the brigade calls first", no: [], notice_h: 48, way: "",
  },
];

/**
 * The people who are told (bird names): who they are, what they count, and their periods (hours
 * before a work begins). `late_h`: told later than this, it is late; `least_h`: later than this,
 * it cannot be arranged at all; `early_h`: told earlier than this, it is forgotten by its night;
 * `answer_h`: how long the works council takes (from … to); `within_h`: a dangerous event is
 * reported within this; `apply_h`: an application to run on is made so long before the period ends.
 */
export const AUDIENCES = {
  ops: { name: "W. Kauz", role: "the possession planner", label: "Operations", counts: "trains held by works and faults, possessions registered late, changed or not used", late_h: 36, least_h: 6 },
  council: { name: "S. Leylek", role: "the works council's chair", label: "Works council", counts: "shifts outside the rota without consent, people told at short notice, rest cut", late_h: 24, answer_h: [2, 9] },
  town: { name: "M. Habicht", role: "the head of the town's public order office", label: "The town", counts: "nights that were not announced, notices that were wrong, notices for nothing", early_h: 72, late_h: 24 },
  safety: { name: "G. Adler", role: "the railway operations manager", label: "Safety", counts: "dangerous events reported late, periods missed, calls about what is none", within_h: 1, apply_h: 12 },
};
/** The people are told their shifts outside the rota so long ahead (h); told later than `least_h`, a life cannot be arranged any more. */
export const STAFF = { late_h: 48, least_h: 12 };
/** The work planner who hands the week over, and the contractor's machine operator. */
export const HANDS = { planner: "L. Zaunkönig", machine: "A. Storch" };

/**
 * The works of the week: where, how long (h), how many people and what one of them must be able
 * to do, the slots it can be done in (hours of the week) and the one the draft plan has (with the
 * people it has pencilled in for a work by day), whether
 * it needs a possession (`window`: the slots that lie in the station's standing maintenance
 * window and need no registration), whether it is loud, and its period (`due`: it must have
 * begun by then).
 */
export const WORKS = [
  {
    id: "tamp", name: "the tamping at Bergheim", short: "Tamping", area: "west", h: 6, crew: 2, qual: "possession", trade: "track", possession: true, loud: true,
    slots: [at("Wed", 22), at("Thu", 22)], draft: at("Wed", 22), registered: true, due: null,
    text: "the contractor's tamping machine is booked for the night of Wednesday; Thursday night is its only other free one",
  },
  {
    id: "points", name: "the inspection of points W3 and W4", short: "Points", area: "station", h: 3, crew: 2, qual: null, trade: "signalling", possession: true, loud: false,
    slots: [at("Tue", 10), at("Wed", 10), at("Thu", 10), at("Tue", 23), at("Wed", 23)], window: [at("Tue", 10), at("Wed", 10), at("Thu", 10)], draft: at("Thu", 10), pencilled: ["p3", "p4"], due: at("Thu", 24),
    text: "due by Thursday midnight by its period; from 10:00 to 13:00 track G3 has a standing maintenance window",
  },
  {
    id: "rail", name: "the rail change at Talsee", short: "Rail", area: "east", h: 5, crew: 2, qual: "weld", trade: "track", possession: true, loud: true,
    slots: [at("Tue", 23, 30), at("Wed", 23, 30), at("Thu", 23, 30), at("Wed", 9, 30), at("Thu", 9, 30)], draft: at("Thu", 23, 30), due: at("Thu", 24),
    text: "a rail with an internal defect, found by ultrasound: 70 km/h over it, and changed by Thursday midnight",
  },
  {
    id: "veg", name: "the vegetation on the branch to Waldau", short: "Vegetation", area: "branch", h: 5, crew: 2, qual: null, trade: null, possession: false, loud: false,
    slots: [at("Mon", 9), at("Tue", 9), at("Wed", 9), at("Thu", 9)], draft: at("Wed", 9), pencilled: ["p5", "p3"], due: null,
    text: "trees lean over the overhead line; beside a running track nobody works alone",
  },
];
/** The rail change: how long it may truly take (h, from … to in half hours), how far the first estimate is off either way and how far once the welder has looked, how long he needs for that look (h), and the scale of the possession. */
export const RAIL = { need: [3.5, 6.5], guess_h: 1, looked_h: 0.5, look_h: 3, min: 3, max: 8, step: 0.5 };
/** What the week's works cost beside the plan (EUR): the machine's night not used, the machine moved to its other night, a room at the site. */
export const COST = { machine: 9000, moved: 1500, room: 90 };
/** Whoever drives longer than this to a site (min) lives far away: after a night there, a room saves a tired drive. */
export const FAR_MIN = 30;
/** The routine inspection rounds the day shifts should make this week, one per person and day shift. */
export const ROUNDS_DUE = 9;

/**
 * The faults: what is reported and where; who can clear it (a trade, or anybody); what it can turn
 * out to be: how often, how long the repair takes (h, from … to), whether it is a dangerous event.
 */
export const FAULTS = {
  knock: {
    name: "the hard knock in the track", trade: "track", look_h: 0.4,
    causes: [
      { id: "nothing", p: 0.35, text: "nothing wrong with the track: it was the train's wheel", repair: [0, 0] },
      { id: "fishplate", p: 0.35, text: "the bolts of a fishplate are loose", repair: [0.8, 1.2] },
      { id: "break", p: 0.3, text: "the rail is broken", repair: [2, 4.5], dangerous: true },
    ],
  },
  points: { name: "the failure of point W2", trade: "signalling", look_h: 0.3, causes: [{ id: "circuit", p: 1, text: "a contact in the point's circuit of the relay interlocking", repair: [1.5, 2.6], relay: [0.6, 1.2] }] },
  tree: { name: "the tree in the overhead line", trade: null, look_h: 0.2, causes: [{ id: "tree", p: 1, text: "a birch lies in the overhead line of the branch", repair: [2, 3.5] }] },
  crossing: { name: "the barrier fault at Brückenstraße", trade: "signalling", look_h: 0.2, causes: [{ id: "power", p: 1, text: "the storm took the crossing's power supply; the barriers stay down and the road is shut", repair: [1, 2] }] },
  nearmiss: { name: "the trolley left in the track", trade: null, look_h: 0, causes: [{ id: "trolley", p: 1, text: "the first train's driver stopped before a trolley the crew left in the track", repair: [0, 0], dangerous: true }] },
};
/** When a fault may come (hours of the week), by its kind. */
const FAULT_AT = {
  knock: [at("Tue", 5, 36), at("Tue", 7, 12), at("Wed", 13)],
  points: [at("Tue", 6, 48), at("Wed", 7, 18), at("Thu", 7, 6)],
};
/**
 * The storm: when its forecast comes, until when the contractor keeps the machine's other night
 * free, when the storm hits and how long a strong one lasts (hours of the week), how often it is
 * strong, how often a strong one brings a tree down on the branch (with
 * the vegetation cut, and without) and takes the crossing's power, and how often the fire brigade
 * calls its volunteer.
 */
export const STORM = { forecast: at("Tue", 7), reserve_by: at("Tue", 18), from: at("Wed", 18), to: at("Wed", 23), strong: 0.45, tree: { cut: 0.15, uncut: 0.75 }, crossing: 0.5, brigade: 0.6 };
/** Without a word from the manager the rota's person on call sets off after this long (h). */
const AUTO_H = 0.5;

/**
 * Levels: which faults the week brings, whether the storm can be strong, how long the works
 * council takes (a factor), and how often a person whose life the plan cuts across says no.
 */
export const LEVELS = {
  training: { label: "Training: one fault, a storm that passes, a works council that answers fast", faults: ["points"], storm: false, answer: 0.5, refuse: 0.3 },
  normal: { label: "Normal: a driver's report, a failed point, a storm that may be strong", faults: ["knock", "points"], storm: true, answer: 1, refuse: 0.6 },
  hard: { label: "Hard: two drivers' reports, a failed point, a storm, a slow works council", faults: ["knock", "points", "knock"], storm: true, answer: 1.5, refuse: 0.8 },
};

/**
 * Patience (0 to 100): where it starts, below which somebody phones, below which they act; and
 * what moves it. For everybody: news in time, late, missing, for nothing (not needed), corrected
 * (inside its period, and in good time), told for a work that then did not happen, forgotten because it came too early. Operations: each
 * so many train-minutes lost, a possession not used, a quarter of an hour over, a forecast kept,
 * missed, not given. The works council: a request so soon after the last, people told before it
 * consented, a shift inside a day, a call outside the on-call rota, rest cut, an order against a
 * life, a tired drive home. The town: a crossing shut without a word. Safety: a dangerous event
 * reported in time, late, a call about what is none, a period missed, an application late, trains
 * let over a break. On the phone: a promise, a compromise, an explanation taken or not, a refusal,
 * a promise broken or kept.
 */
export const MOOD = {
  start: 85, call: 62, act: 35,
  in_time: 3, late: -12, missing: -24, unneeded: -5, correction: -8, correction_early: -3, wasted: -10, forgotten: -9,
  per_min: 40, unused: -10, over_quarter: -3, forecast_kept: 5, forecast_missed: -12, no_forecast: -6,
  again: -5, before_consent: -10, inside_day: -6, favour: -3, rest_cut: -20, ordered: -15, drive: -10,
  crossing: -10,
  reported: 4, reported_late: -25, false_alarm: -5, overdue: -20, applied_late: -10, over_break: -18,
  promise: 14, compromise: 7, explained: 10, refused: -6, declined: -8, broken: -24, kept: 6,
};
/** What a person's strain (0 to 100) rises by; from `no_favour` on they do no favours, from `sick` on they may be sick in the morning. */
export const STRAIN = { night: 12, short: 10, shorter: 20, changed: 10, life: 30, drive: 8, call: 12, favour: 8, rest_cut: 25, tired_drive: 25, no_favour: 60, sick: 70 };
/** How often a late notice ends in a formal step (a claim, a fine), an explanation on the phone is taken, a tired crew leaves something in the track, a tired drive home goes wrong. */
const CHANCE = { charge: 0.5, accept: 0.5, nearmiss: 0.35, drive: 0.25, sick: 0.03 };
/** How long a question waits (s of the shift): about a fault, on the phone, in the plan. */
const DECIDE_S = { fault: 40, call: 75, plan: 60 };
/** The shift's first seconds: the hand-over, nothing is asked. */
const FIRST_S = 14;

/** The way from the maintenance base at Bf Neustadt to each area (min). */
export const BASE_DRIVE = { west: 15, station: 5, east: 12, branch: 14 };
const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

/**
 * The computer's district manager, by the book: the draft plan staffed on Monday morning with the
 * people who fit by trade and rest, everything announced as early as its period allows (the
 * council first, the people on its consent), the storm's forecast answered by keeping the plan,
 * a driver's report by 20 km/h, a forecast with half an hour in hand, the compromise on the
 * phone. To a fault goes whoever the rota has on call. What falls through is planned again into
 * the next slot.
 */
/** The works in the order the computer plans them: what has a machine booked or a period first. */
const ORDER = ["tamp", "rail", "points", "veg"];

export class WorksPlayer extends Player {
  /** @param {WorksGame} g */
  think(g) {
    for (const d of g.open) g.act("decide", d.id, g.advice(d.id));
    this.hands(g);
  }

  /**
   * What is done without being asked: a work gets a slot its people can make (the draft's, else
   * the next), its crew is filled, the possession is registered, the council asked once the
   * week's crews stand, the people told on its consent, the town told once its window is open,
   * rooms booked, an application made for a period that cannot be kept.
   * @param {WorksGame} g
   */
  hands(g) {
    if (g.t < FIRST_S) return;
    const h = g.now;
    const planned = ORDER.map((id) => g.work(id)).filter((w) => w.state === "planned");
    for (const w of planned) {
      const less = planned.slice(planned.indexOf(w) + 1).map((x) => x.id);
      // whoever cannot any more comes off
      for (const id of [...w.crew]) {
        const p = g.person(id), x = g.item(id, w.id);
        if ((w.start != null && !g.fits(p, w).ok) || (x?.refused && !x.ordered) || (p.away_until != null && p.away_until > (w.start ?? h))) g.act("unassign", w.id, id);
      }
      // a slot where it can be staffed and announced: the one it has, else the next (the machine's night is not moved back)
      if (w.start == null || !this.crewFor(g, w, w.start, less).length) {
        const later = w.slots.filter((s) => s > h + 1 && s !== w.start && (w.id !== "tamp" || s > (w.start ?? 0))).sort((a, b) => a - b).filter((s) => this.crewFor(g, w, s, less).length && !(w.id === "tamp" && s !== w.draft && !w.moved && h > STORM.reserve_by));
        const next = later.find((s) => !this.registers(w, s) || s - h >= AUDIENCES.ops.late_h) ?? later.find((s) => !this.registers(w, s) || s - h >= AUDIENCES.ops.least_h + 1);
        if (next != null) {
          for (const id of [...w.crew]) if (!g.fits(g.person(id), w, next).ok) g.act("unassign", w.id, id);
          g.act("schedule", w.id, next);
        }
      }
      if (w.start == null) continue;
      for (const p of this.crewFor(g, w, w.start, less)) {
        if (w.crew.includes(p.id) || w.crew.length >= w.crew_n) continue;
        // (somebody on a work that matters less comes off it there)
        for (const o of planned.filter((x) => less.includes(x.id) && x.crew.includes(p.id) && !g.fits(p, w).ok)) g.act("unassign", o.id, p.id);
        g.act("assign", w.id, p.id);
      }
      if (g.needs(w, "ops") && g.stale(w, "ops") && w.start - h >= AUDIENCES.ops.least_h) g.act("tell", "ops", w.id);
      if (g.needs(w, "town") && g.stale(w, "town") && w.start - h <= AUDIENCES.town.early_h) g.act("tell", "town", w.id);
      if (w.room == null && g.outside(w) && w.crew.some((id) => g.person(id).drive[w.area] > FAR_MIN)) g.act("room", w.id);
    }
    // what was announced for a work that has no slot any more is taken back
    for (const w of g.works.filter((x) => x.state === "planned" && x.start == null)) for (const who of ["ops", "town"]) if (w.told[who]) g.act("tell", who, w.id);
    // the town hears of its crossing at once
    for (const f of g.faults.filter((x) => x.kind === "crossing" && x.state !== "done" && x.told.town == null)) g.act("tell", "town", `fault-${f.id}`);
    const open = g.rota.filter((x) => !x.done);
    if (open.some((x) => !x.council) && planned.every((w) => w.start == null || !g.outside(w) || w.crew.length >= w.crew_n || w.start - h < 30)) g.act("tell", "council");
    if (open.some((x) => x.told == null && x.council?.ok) && !open.some((x) => x.council && x.council.ok == null)) g.act("tell", "staff");
    // a period that the plan does not keep: applied for in good time
    for (const w of g.works.filter((x) => x.due != null && x.state === "planned" && !x.applied)) if (g.needs(w, "safety") && w.due - h <= 30) g.act("tell", "safety", w.id);
  }

  /** Whether a work at a slot needs its possession registered. */
  registers(w, slot) {
    return w.possession && !(w.window ?? []).includes(slot);
  }

  /**
   * The crew of a work at a slot, as the book would choose it: who is on it and still fits, then
   * the one who must be able to do it, one of its trade, and the rest by their way there; nobody
   * whose life stands against it without the notice it needs. Empty where it cannot be staffed.
   * @param {string[]} [less] the works that matter less: somebody on one of them can be taken off it
   * @returns {object[]} the people (the game's), as many as the work needs
   */
  crewFor(g, w, slot, less = []) {
    const h = g.now, end = slot + w.len;
    const can = g.people.filter((p) => g.fits(p, w, slot, less).ok && !(p.away_until != null && p.away_until > slot) && !(g.blocked(p, slot, end) && slot - h < p.notice_h)
      && !g.rota.some((x) => x.person === p.id && x.work === w.id && x.start === slot && x.refused && !x.ordered));
    const crew = can.filter((p) => w.crew.includes(p.id)).slice(0, w.crew_n);
    // (whoever is on call that night stays free for it, where somebody else can go)
    const call = (p) => Number(g.outside(w, slot) && p.on_call.includes(Math.floor((slot + START_H - SHIFT.to) / 24)));
    const rest = () => can.filter((p) => !crew.includes(p)).sort((a, b) => call(a) - call(b) || a.drive[w.area] - b.drive[w.area]);
    const add = (test) => {
      if (crew.some(test)) return true;
      const p = rest().find(test);
      if (!p) return false;
      if (crew.length >= w.crew_n) crew.pop();
      crew.push(p);
      return true;
    };
    if (w.qual && !add((p) => p.quals.includes(w.qual))) return [];
    if (w.trade && !add((p) => p.trade === w.trade)) return [];
    for (const p of rest()) if (crew.length < w.crew_n) crew.push(p);
    if (crew.length < w.crew_n || (w.qual && !crew.some((p) => p.quals.includes(w.qual))) || (w.trade && !crew.some((p) => p.trade === w.trade))) return [];
    return crew;
  }
}

export class WorksGame extends Game {
  static id = "works";
  static title = "A week of works";
  static role = "maintenance-district-manager";
  static kind = "simulation";
  static description = "A week in a maintenance district: four planned works, the faults nobody planned, five technicians with their homes and lives, and four people who must hear of it in time: not too late, not too early, and not for nothing.";
  static scale = "hours";
  static clock = "06:00";
  /** A second of the shift is so many seconds of the week (a mission's shift with this game has this pace). */
  static pace = PACE;
  static takes = [];
  static gives = [
    { flow: "possession-request", to: ["possession-planner"] },
    { flow: "staff-plan", to: ["works-council-member", "track-technician", "signalling-technician"] },
    { flow: "work-order", to: ["track-technician", "signalling-technician"] },
    { flow: "situation-report", to: ["possession-planner", "train-dispatcher"] },
    { flow: "press-report", to: ["resident", "mayor"] },
    { flow: "incident-report", to: ["im-operations-manager"] },
    { flow: "application", to: ["im-operations-manager"] },
    { flow: "performance-report", to: ["asset-manager"] },
  ];
  static actions = {
    ...Game.actions,
    schedule: { label: "Give a work its slot" },
    assign: { label: "Put a person on a work" },
    unassign: { label: "Take a person off a work" },
    tell: { label: "Tell somebody" },
    send: { label: "Send a person to a fault" },
    room: { label: "Book rooms at the site" },
  };
  static player = WorksPlayer;
  /**
   * What does not go to plan (`irregular`, with the texts a mission's story names): a fault
   * (`what`, `where`); a dangerous event (`what`); news that came late, was missing, was for
   * nothing or had to be corrected (`who`, `what`); a formal step: a claim, a fine, the labour
   * court, proceedings (`who`, `what`); a work that did not begin (`work`, `why`); a possession
   * that ran over (`work`, `min`); a person who says no (`person`, `why`); rest cut (`person`);
   * a period missed (`work`); a forecast missed (`who`); a promise not kept (`who`); a complaint
   * in writing (`who`); the storm (`what`).
   */
  static irregularities = ["fault", "dangerous", "late-news", "missing-news", "needless-news", "corrected", "charge", "work-missed", "overrun", "refusal", "rest-cut", "overdue", "forecast-missed", "promise-broken", "complaint", "storm"];

  /** @param {{seed?: number, level?: keyof LEVELS, conditions?: object, wired?: Iterable<string>, length?: number}} [options] */
  constructor(options = {}) {
    super({ ...options, level: LEVELS[options.level] ? options.level : "normal" });
    const lv = LEVELS[this.level];
    this.length = options.length ?? S(WEEK_H);
    /**
     * The works: their slot (`start`, an hour of the week; null: none), the length of their
     * possession (`len`), their crew (people's ids), who was told what (`told`: by audience, the
     * hour it was told and the slot and length it was told for), their state (planned, running,
     * done, off), and for the rail what it truly needs and what is estimated.
     * @type {Array<object>}
     */
    this.works = WORKS.map((spec) => this._work(spec));
    /**
     * The people: their strain, the times they were out (`busy`: from … to, hours of the week),
     * the fault they are at, whether they are sick or with the fire brigade (until an hour).
     * @type {Array<object>}
     */
    this.people = PEOPLE.map((p) => ({ ...p, strain: 0, busy: [], out: null, away_until: null, away_why: null, rounds: 0 }));
    /** The shifts outside the published rota: `{key, person, work, start, len, council: {asked, due, ok} | null, told: hour | null, refused}`. */
    this.rota = [];
    /** The faults, in the order they come: `{id, kind, area, at, state, mode, person, cause, …}`; those still to come are in `_coming`. */
    this.faults = [];
    this._coming = this._faultsOf(lv);
    /** The storm: whether it is strong, what was decided on its forecast, whether it is here. */
    this.storm = { strong: lv.storm && this.rng("storm").next() < STORM.strong, decided: null, on: false, over: false };
    for (const [id, a] of Object.entries(AUDIENCES)) this.resource(`mood-${id}`, `${a.label}: patience`, MOOD.start);
    /** Who phoned, who acted at the end of their patience, what was promised (`{who, what, kind, kept}`). */
    this.called = new Set();
    this.acted = new Set();
    this.promises = [];
    /** The things an open decision is about: its id → items of the picture. */
    this.about = new Map();
    /** What the week adds up: train-minutes lost, news in time, late, missing, for nothing, corrected; formal steps; requests to the council; extra cost (EUR); routine rounds made. */
    this.tally = { lost_min: 0, in_time: 0, late: 0, missing: 0, needless: 0, corrected: 0, charges: 0, requests: 0, cost: 0, rounds: 0, rest_cut: 0 };
    this._asked = new Set();
    this._day = -1;
    this._lostMood = 0;
    this._lastRequest = -Infinity;
    this.log(`${when(0)} The week begins: ${this.works.length} works in the plan, ${this.people.length} people on the rota.`);
    for (const w of this.works) this.log(`${when(0)} ${cap(w.name)}: ${w.text}. In the draft: ${when(w.start)}${w.crew.length ? `, with ${list(w.crew.map((id) => this.person(id).name))}` : ", nobody on it yet"}.`, "info");
  }

  /** A work from its spec: its slot from the draft, and what the seed has hidden in it. */
  _work(spec) {
    const w = { ...spec, crew_n: spec.crew, crew: [...(spec.pencilled ?? [])], start: spec.draft, len: spec.h, state: "planned", told: {}, t0: null, t1: null, until: null, room: null, misses: 0, applied: null, late_by: null, moved: false, need: spec.h, guess: null };
    if (spec.registered) w.told.ops = { at: -24 * 60, start: spec.draft, len: spec.h };
    if (spec.id === "rail") {
      const r = this.rng("rail"), steps = Math.round((RAIL.need[1] - RAIL.need[0]) / 0.5);
      w.need = RAIL.need[0] + Math.round(r.next() * steps) * 0.5;
      const off = Math.round((2 * r.next() - 1) * 2 * (RAIL.guess_h - 0.5)) / 2, mid = Math.min(RAIL.need[1] - RAIL.guess_h, Math.max(RAIL.need[0] + RAIL.guess_h, w.need + off));
      w.guess = [mid - RAIL.guess_h, mid + RAIL.guess_h];
      w.looked = false;
    }
    return w;
  }

  /** The faults of the week, by the seed: when each comes, where, and what it will turn out to be. */
  _faultsOf(lv) {
    const out = [], used = new Set();
    lv.faults.forEach((kind, i) => {
      const r = this.rng("fault", kind, i), times = FAULT_AT[kind].filter((x) => !used.has(x));
      const t = times[Math.min(times.length - 1, Math.floor(r.next() * times.length))];
      used.add(t);
      out.push({ id: `${kind}${i ? i + 1 : ""}`, kind, at: t, area: kind === "points" ? "station" : r.next() < 0.5 ? "west" : "east", u: r.next(), v: r.next() });
    });
    return out.sort((a, b) => a.at - b.at);
  }

  /** The hour of the week now (hours since Monday 06:00). */
  get now() {
    return hoursOf(this.t);
  }

  /** A work by its id ("tamp"). */
  work(id) {
    return this.works.find((w) => w.id === String(id)) ?? null;
  }

  /** A person by their id ("p1"). */
  person(id) {
    return this.people.find((p) => p.id === String(id)) ?? null;
  }

  /** A fault by its id ("knock"). */
  fault(id) {
    return this.faults.find((f) => f.id === String(id)) ?? null;
  }

  /** The patience of one of the four people (0 to 100). */
  mood(who) {
    return Math.round(this.value(`mood-${who}`));
  }

  _mood(who, by) {
    const r = this.resources.get(`mood-${who}`);
    r.value = Math.max(0, Math.min(100, r.value + by));
  }

  _strain(p, by) {
    p.strain = Math.max(0, Math.min(100, p.strain + by));
  }

  /* ---------------------------------------------------------------- the plan as it stands */

  /** Whether a slot of a work lies in the station's standing maintenance window (no registration needed). */
  inWindow(w, start = w.start) {
    return (w.window ?? []).includes(start);
  }

  /**
   * Whether somebody needs to hear of a work as it is planned: operations of a possession outside
   * the standing window, the town of a loud night beside houses, safety of a period the plan
   * does not keep.
   * @param {object} w a work
   * @param {"ops" | "town" | "safety"} who
   */
  needs(w, who) {
    if (w.state === "done" || w.state === "off") return false;
    if (who === "safety") return w.due != null && (w.start == null || w.start > w.due);
    if (w.start == null) return false;
    if (who === "ops") return w.possession && !this.inWindow(w);
    if (who === "town") return w.loud && AREAS[w.area].houses && isNight(w.start);
    return false;
  }

  /** Whether what somebody was told of a work is not what the plan says now (or nothing was told). */
  stale(w, who) {
    const n = w.told[who];
    return !n || n.start !== w.start || (who === "ops" && n.len !== w.len);
  }

  /** The shift outside the rota of a person on a work (its slot as planned now, or `start`), or null. */
  item(person, work, start = this.work(work)?.start) {
    return this.rota.find((x) => !x.done && x.person === person && x.work === work && x.start === start) ?? null;
  }

  /** Whether a work's hours are outside the day shifts of the published rota: a night, for which the council and the people must be asked. */
  outside(w, start = w.start) {
    return start != null && (hourOfDay(start) < SHIFT.from || hourOfDay(start) + w.len > SHIFT.to + 2);
  }

  /** Whether a person's life stands against hours of the week (from … to). */
  blocked(p, from, to) {
    return p.no.some(([a, b]) => overlaps(from, to, a, b));
  }

  /**
   * Whether a person can be put on a work at a slot: there, of use, rested (eleven hours between
   * two shifts), not on another work (`but`: works that are not counted).
   * @returns {{ok: boolean, reason?: string}}
   */
  fits(p, w, start = w.start, but = []) {
    const me = this.person(p.id), end = start + w.len, rest = SHIFT.rest_h;
    if (me.away_until != null && me.away_until > start && me.away_why === "sick") return { ok: false, reason: `${p.name} is off sick.` };
    for (const o of this.works) {
      if (o === w || o.start == null || !o.crew.includes(p.id) || o.state === "done" || o.state === "off" || but.includes(o.id)) continue;
      if (overlaps(start - rest, end + rest, o.start, o.start + o.len)) return { ok: false, reason: `${p.name} is on ${o.name} (${when(o.start)}): eleven hours of rest lie between two shifts.` };
    }
    // (what was done within a day shift does not stand against more work in that shift; against a night it does)
    const day = !this.outside(w, start), last = me.busy.filter((b) => b.to > start - rest && b.from < end && !(b.day && day)).at(-1);
    if (last && this.now >= last.from) return { ok: false, reason: `${p.name} was out until ${when(last.to)}: eleven hours of rest first.` };
    return { ok: true };
  }

  /** Keep the shifts outside the rota true to the plan: one for every person on a night; one that is gone and was told was arranged for nothing. */
  _syncRota() {
    const want = new Map();
    for (const w of this.works) {
      if (w.state !== "planned" || w.start == null || !this.outside(w)) continue;
      for (const id of w.crew) want.set(`${id}|${w.id}|${w.start}`, { person: id, work: w.id, start: w.start, len: w.len });
    }
    for (const x of [...this.rota]) {
      if (want.has(x.key) || x.done) continue;
      this.rota.splice(this.rota.indexOf(x), 1);
      const p = this.person(x.person), w = this.work(x.work);
      if (x.told != null && !x.refused && w.state !== "done") {
        this._strain(p, STRAIN.changed);
        this._mood("council", MOOD.correction_early);
        this.tally.corrected++;
        this.log(`${when(this.now)} ${p.name} had arranged ${when(x.start)} for ${w.name}: for nothing.`, "fault");
        this.irregular("corrected", `changed:${x.key}:${Math.round(this.now * 10)}`, { who: p.name, what: w.name });
        this._brokenIf("council", "change", `the plan of ${p.name} changed after it was announced`);
      }
    }
    for (const [key, x] of want) if (!this.rota.some((y) => y.key === key)) this.rota.push({ key, ...x, council: null, told: null, refused: false, done: false });
  }

  /* ---------------------------------------------------------------- the player's moves */

  /**
   * Give a work its slot (an hour of the week, one of its slots), or take it out of the plan
   * (null). What was announced for another time is then no longer true.
   * @param {string} work
   * @param {number | null} slot
   * @returns {{ok: boolean, reason?: string}}
   */
  schedule(work, slot) {
    const w = this.work(work), h = this.now;
    if (!w) return { ok: false, reason: "There is no such work." };
    if (w.state !== "planned") return { ok: false, reason: `${cap(w.name)} is ${w.state === "running" ? "under way" : w.state === "done" ? "done" : "off the plan"}.` };
    slot = slot == null || slot === "" ? null : Number(slot);
    if (slot != null && !w.slots.includes(slot)) return { ok: false, reason: `${cap(w.name)} has no such slot.` };
    if (slot != null && slot <= h) return { ok: false, reason: `${when(slot)} has passed.` };
    if (slot === w.start) return { ok: false, reason: `${cap(w.name)} is planned for then.` };
    if (w.id === "tamp" && slot != null && slot !== w.draft && !w.moved && h > STORM.reserve_by) return { ok: false, reason: `${HANDS.machine}, the machine's operator: "${when(slot)}? That night went to another site on Tuesday evening. You did not ask in time."` };
    for (const id of w.crew) {
      const p = this.person(id);
      if (slot != null && !this.fits(p, w, slot).ok) return { ok: false, reason: `${this.fits(p, w, slot).reason} Take ${p.name} off it first.` };
    }
    const was = w.start, told = Object.keys(w.told).filter((k) => k !== "safety");
    w.start = slot;
    if (w.id === "tamp" && slot != null && !w.moved) {
      w.moved = true;
      this.tally.cost += COST.moved;
    }
    this.log(`${when(h)} ${cap(w.name)}: ${slot == null ? "taken out of the plan" : `planned for ${when(slot)}`}${was != null && slot != null ? ` instead of ${when(was)}` : ""}.`, "request");
    if (told.length && was != null) this._brokenIf("ops", "change", `${w.name} was moved after it was registered`, w.told.ops != null);
    this._syncRota();
    return { ok: true };
  }

  /**
   * Put a person on a work.
   * @param {string} work
   * @param {string} person
   * @returns {{ok: boolean, reason?: string}}
   */
  assign(work, person) {
    const w = this.work(work), p = this.person(person);
    if (!w || !p) return { ok: false, reason: "There is no such work or person." };
    if (w.state !== "planned") return { ok: false, reason: `${cap(w.name)} is not to be planned any more.` };
    if (w.crew.includes(p.id)) return { ok: false, reason: `${p.name} is on it.` };
    if (w.crew.length >= w.crew_n) return { ok: false, reason: `${cap(w.name)} has its ${plural(w.crew_n, "person")}: take one off first.` };
    if (w.start != null) {
      const fit = this.fits(p, w);
      if (!fit.ok) return fit;
    }
    w.crew.push(p.id);
    this.give("work-order", { work: w.name, where: AREAS[w.area].name, when: w.start == null ? null : when(w.start), to: p.name });
    this.log(`${when(this.now)} ${p.name} is put on ${w.name}${w.start == null ? "" : ` (${when(w.start)})`}.`, "request");
    this._syncRota();
    return { ok: true };
  }

  /**
   * Take a person off a work.
   * @param {string} work
   * @param {string} person
   * @returns {{ok: boolean, reason?: string}}
   */
  unassign(work, person) {
    const w = this.work(work), p = this.person(person);
    if (!w || !p || !w.crew.includes(p.id)) return { ok: false, reason: "That person is not on that work." };
    if (w.state !== "planned") return { ok: false, reason: `${cap(w.name)} is not to be planned any more.` };
    w.crew.splice(w.crew.indexOf(p.id), 1);
    this.log(`${when(this.now)} ${p.name} is taken off ${w.name}.`, "request");
    this._syncRota();
    return { ok: true };
  }

  /**
   * Book rooms at the site for the people of a night work who live far away: nobody drives home
   * tired.
   * @param {string} work
   * @returns {{ok: boolean, reason?: string}}
   */
  room(work) {
    const w = this.work(work);
    if (!w || w.state !== "planned" || w.start == null) return { ok: false, reason: "There is no such work in the plan." };
    if (w.room != null) return { ok: false, reason: "The rooms are booked." };
    const far = w.crew.map((id) => this.person(id)).filter((p) => p.drive[w.area] > FAR_MIN);
    if (!far.length) return { ok: false, reason: "Nobody on it lives far away." };
    w.room = far.map((p) => p.id);
    this.tally.cost += COST.room * far.length;
    this.log(`${when(this.now)} ${plural(far.length, "room")} booked at ${AREAS[w.area].name} for ${list(far.map((p) => p.name))}.`, "request");
    return { ok: true };
  }

  /**
   * Tell somebody: operations ("ops"), the town or safety of a work or a fault (`about`: its id,
   * a fault's with "fault-" before it); the works council ("council") of every shift outside the
   * rota it has not been asked about; the people ("staff") of every such shift the council has
   * consented to and they have not been told (`about` "all": of every such shift, consented to or
   * not).
   * @param {"ops" | "council" | "town" | "safety" | "staff"} who
   * @param {string} [about]
   * @returns {{ok: boolean, reason?: string}}
   */
  tell(who, about = null) {
    if (who === "council") return this._tellCouncil();
    if (who === "staff") return this._tellStaff(about === "all");
    if (!AUDIENCES[who]) return { ok: false, reason: "There is nobody of that name to tell." };
    if (String(about).startsWith("fault-")) return this._tellFault(who, String(about).slice(6));
    const w = this.work(about);
    if (!w) return { ok: false, reason: "There is no such work." };
    return this._tellWork(who, w);
  }

  /** Operations, the town or safety are told of a work as it is planned now. */
  _tellWork(who, w) {
    const a = AUDIENCES[who], h = this.now, need = this.needs(w, who), old = w.told[who];
    if (w.state !== "planned") return { ok: false, reason: `${cap(w.name)} is ${w.state === "running" ? "under way" : w.state === "done" ? "done" : "off the plan"}: there is nothing to announce.` };
    if (who === "safety") return this._apply(w);
    if (w.start == null) {
      if (!old) return { ok: false, reason: `${cap(w.name)} has no slot: there is nothing to tell yet.` };
      // (called off: a correction of what was announced)
      delete w.told[who];
      this._news(who, "corrected", `${w.name} is off`, old.start - h >= a.late_h);
      return { ok: true };
    }
    if (old && !this.stale(w, who)) return { ok: false, reason: `${a.name} knows: ${w.name}, ${when(w.start)}.` };
    const lead = w.start - h;
    if (who === "ops" && need && lead < (this.acted.has("ops") ? 24 : a.least_h)) return { ok: false, reason: `${a.name}: "${when(w.start)} is ${hrs(lead)} away. No signal box and no undertaking can be told any more. Not that night."` };
    if (who === "ops" && w.id === "rail" && need && !this._asked.has("length")) {
      if (this.open.some((d) => d.id === "length-rail")) return { ok: false, reason: `${a.name} is asking for how many hours.` };
      if (w.look_at != null) return { ok: false, reason: `The welder is looking at the rail first: the registration waits until ${when(w.look_at)}.` };
      return this._askLength(w), { ok: true };
    }
    w.told[who] = { at: h, start: w.start, len: w.len };
    if (who === "ops") this.give("possession-request", { work: w.name, where: AREAS[w.area].line, from: when(w.start), hours: w.len, change: !!old });
    else this.give("press-report", { work: w.name, where: AREAS[w.area].name, night: when(w.start), hours: w.len, change: !!old });
    if (old) this._news(who, "corrected", `${w.name}: now ${when(w.start)}${who === "ops" ? `, ${hrs(w.len)}` : ""}`, Math.min(old.start, w.start) - h >= a.late_h);
    else if (!need) this._news(who, "needless", who === "ops" ? `${w.name} needs no possession ${this.inWindow(w) ? "outside the standing window" : "at all"}` : `${w.name} keeps nobody awake`);
    else this.log(`${when(h)} ${who === "ops" ? `Registered with ${a.name}` : `Announced to ${a.name} and the houses`}: ${w.name}, ${when(w.start)}${who === "ops" ? `, ${hrs(w.len)}` : ""}.`, "request");
    return { ok: true };
  }

  /** News that was for nothing, or a correction (`early`: in good time, before the period of what it corrects): said, counted, and what it does to patience. */
  _news(who, kind, what, early = false) {
    const a = AUDIENCES[who];
    if (kind === "needless") {
      this.tally.needless++;
      this._mood(who, MOOD.unneeded);
      this.log(`${when(this.now)} ${a.name}: "${cap(what)}. Why do I read this?"`, "fault");
      this.irregular("needless-news", `needless:${who}:${what}`, { who: a.name, what });
    } else {
      this.tally.corrected++;
      this._mood(who, early ? MOOD.correction_early : MOOD.correction);
      this.log(`${when(this.now)} Corrected to ${a.name}: ${what}. ${early ? `"Noted. Better now than on the day."` : `"Inside the period. Everything that was planned round it is planned again."`}`, "fault");
      this.irregular("corrected", `corrected:${who}:${what}`, { who: a.name, what });
    }
    this._patience(who);
  }

  /** An application to the railway operations manager to run on beyond a period: in good time, late, or for nothing. */
  _apply(w) {
    const a = AUDIENCES.safety, h = this.now;
    if (w.due == null || !this.needs(w, "safety")) {
      if (w.told.safety) return { ok: false, reason: `${a.name} has heard of ${w.name}.` };
      w.told.safety = { at: h, start: w.start, len: w.len };
      this._news("safety", "needless", w.due == null ? `${w.name} has no period to miss` : `${w.name} is planned within its period`);
      return { ok: true };
    }
    if (w.applied) return { ok: false, reason: `${a.name} has the application for ${w.name}.` };
    if (h >= w.due) return { ok: false, reason: `The period of ${w.name} ended ${when(w.due)}: there is nothing to apply for any more.` };
    const late = w.due - h < a.apply_h;
    w.applied = { at: h, late };
    w.told.safety = { at: h, start: w.start, len: w.len };
    this.give("application", { work: w.name, what: `to run on beyond ${when(w.due)}`, with: w.id === "rail" ? "40 km/h over the rail, a look at it every day" : "a look at the points every day", late });
    this.log(`${when(h)} Applied to ${a.name}: ${w.name} beyond its period, ${w.id === "rail" ? "with 40 km/h over the rail" : "with a look at the points every day"}.${late ? ` ${a.name}: "${hrs(w.due - h)} before it ends? I sign it, and I remember it."` : ""}`, "request");
    if (late) {
      this._mood("safety", MOOD.applied_late);
      this.tally.late++;
      this.irregular("late-news", `late:safety:${w.id}`, { who: a.name, what: `the application for ${w.name}` });
      this._patience("safety");
    } else this.tally.in_time++;
    return { ok: true };
  }

  /** The works council is asked for its consent to every shift outside the rota it has not been asked about: one request. */
  _tellCouncil() {
    const a = AUDIENCES.council, h = this.now, lv = LEVELS[this.level], items = this.rota.filter((x) => !x.done && !x.council);
    if (!items.length) return { ok: false, reason: `There is no shift outside the rota that ${a.name} has not been asked about.` };
    const due = h + (a.answer_h[0] + this.rng("council", this.tally.requests).next() * (a.answer_h[1] - a.answer_h[0])) * lv.answer;
    for (const x of items) x.council = { asked: h, due, ok: null };
    this.tally.requests++;
    this.give("staff-plan", { change: items.map((x) => ({ who: this.person(x.person).name, shift: when(x.start), hours: x.len, for: this.work(x.work).name })), to: "works council", for: "consent" });
    this.log(`${when(h)} Asked ${a.name} for consent: ${items.map((x) => `${this.person(x.person).name} on ${when(x.start)}`).join(", ")}.`, "request");
    if (h - this._lastRequest < 12) {
      this._mood("council", MOOD.again);
      this.log(`${when(h)} ${a.name}: "The next request already? Bring me the week, not a shift at a time."`, "fault");
      this.irregular("needless-news", `again:${this.tally.requests}`, { who: a.name, what: "another request within half a day" });
    }
    this._lastRequest = h;
    for (const x of items) if (x.start - h < a.late_h) this._brokenIf("council", "short", `a shift ${hrs(x.start - h)} ahead`);
    this._patience("council");
    return { ok: true };
  }

  /** The people are told the shifts outside the rota they have not been told (those the council consented to, or all of them): each says what their life says. */
  _tellStaff(all = false) {
    const h = this.now, lv = LEVELS[this.level], untold = this.rota.filter((x) => !x.done && x.told == null), items = all ? untold : untold.filter((x) => x.council?.ok);
    if (!untold.length) return { ok: false, reason: "Everybody knows their shifts." };
    if (!items.length) return { ok: false, reason: `${AUDIENCES.council.name} has not consented to any of the shifts that are not told yet.` };
    const unasked = items.filter((x) => !x.council?.ok);
    for (const x of items) {
      const p = this.person(x.person), w = this.work(x.work), lead = x.start - h;
      x.told = h;
      if (lead < STAFF.least_h) this._strain(p, STRAIN.shorter);
      else if (lead < STAFF.late_h) this._strain(p, STRAIN.short);
      if (lead < STAFF.late_h) {
        this.tally.late++;
        this._mood("council", MOOD.inside_day / 2);
      } else this.tally.in_time++;
      const against = this.blocked(p, x.start, x.start + x.len);
      if (against && lead < p.notice_h && this.rng("refuse", x.key).next() < lv.refuse) {
        x.refused = true;
        this.log(`${when(h)} ${p.name}: "${when(x.start)}? I cannot: ${p.life}. ${cap(p.way)}."`, "fault");
        this.irregular("refusal", `refusal:${x.key}`, { person: p.name, why: p.life, work: w.name });
        this._askRefusal(x);
      } else if (against && lead < p.notice_h) {
        this._strain(p, STRAIN.life);
        this.log(`${when(h)} ${p.name} takes ${when(x.start)}, and says what it costs at home: ${p.life}.`, "fault");
      } else this.log(`${when(h)} ${p.name} is told: ${w.name}, ${when(x.start)}${against ? ` (${p.way})` : ""}.`, "request");
    }
    this.give("staff-plan", { change: items.map((x) => ({ who: this.person(x.person).name, shift: when(x.start), hours: x.len })), to: "the people" });
    if (unasked.length) {
      this._mood("council", MOOD.before_consent);
      this.log(`${when(h)} ${AUDIENCES.council.name}: "You announce shifts I have not consented to. That is not how co-determination works."`, "fault");
      this.irregular("late-news", `before:${Math.round(h * 10)}`, { who: AUDIENCES.council.name, what: "shifts announced before the consent" });
    }
    for (const x of items) if (x.start - h < STAFF.late_h) this._brokenIf("council", "short", `${this.person(x.person).name} was told ${hrs(x.start - h)} ahead`);
    this._patience("council");
    return { ok: true };
  }

  /** Somebody is told of a fault: operations of what restricts the track, the town of the crossing, safety of a dangerous event. */
  _tellFault(who, id) {
    const f = this.fault(id), a = AUDIENCES[who], h = this.now;
    if (!f) return { ok: false, reason: "There is no such fault." };
    if (f.told[who] != null) return { ok: false, reason: `${a.name} has heard of it.` };
    if (f.state === "done" && !(who === "safety" && f.cause?.dangerous)) return { ok: false, reason: "It is cleared: there is nothing to tell any more." };
    f.told[who] = h;
    if (who === "ops") {
      this.give("situation-report", { fault: f.name, where: AREAS[f.area].line, restriction: f.mode });
      if (f.mode === "none" && f.known) this._news("ops", "needless", `${f.name} restricts no train`);
      else this.log(`${when(h)} Told ${a.name}: ${f.name} at ${AREAS[f.area].name}.`, "request");
      if (f.known && !f.forecast && f.state !== "done") this._askForecast(f);
    } else if (who === "town") {
      if (f.kind !== "crossing") this._news("town", "needless", `${f.name} is the railway's own business`);
      else {
        this.give("press-report", { fault: f.name, where: "Brückenstraße", what: "the crossing is shut; a diversion over the bridge" });
        const late = h - f.at > 1;
        this._mood("town", late ? MOOD.late / 2 : MOOD.in_time);
        this.tally[late ? "late" : "in_time"]++;
        this.log(`${when(h)} Told ${a.name}: Brückenstraße is shut at the crossing. ${late ? `"${hrs(h - f.at)} after the cars began to queue."` : "The town signs a diversion."}`, "request");
      }
    } else this._report(f);
    this._patience(who);
    return { ok: true };
  }

  /** A fault is reported to the railway operations manager: a dangerous event in time or late, a suspicion, or what is none. */
  _report(f) {
    const a = AUDIENCES.safety, h = this.now;
    this.give("incident-report", { what: f.name, where: AREAS[f.area].name, cause: f.known ? f.cause.text : "not known yet" });
    if (!f.known) return void this.log(`${when(h)} Reported to ${a.name} on suspicion: ${f.name} at ${AREAS[f.area].name}.`, "request");
    this._judgeReport(f);
  }

  /** What a report to safety was worth, once the cause is known. */
  _judgeReport(f) {
    const a = AUDIENCES.safety, h = this.now, told = f.told.safety;
    if (told == null || f.judged) return;
    f.judged = true;
    if (!f.cause.dangerous) {
      this.tally.needless++;
      this._mood("safety", isNight(told) ? MOOD.false_alarm * 1.6 : MOOD.false_alarm);
      this.log(`${when(h)} ${a.name}: "${cap(f.cause.text)}. That is no dangerous event${isNight(told) ? ", and it was the middle of the night" : ""}. The file is open now all the same."`, "fault");
      this.irregular("needless-news", `needless:safety:${f.id}`, { who: a.name, what: f.name });
    } else if (told - f.known_at <= a.within_h) {
      this.tally.in_time++;
      this._mood("safety", MOOD.reported);
      this.log(`${when(h)} ${a.name} has the dangerous event within the hour and reports it on.`, "request");
    } else {
      this.tally.late++;
      this._mood("safety", MOOD.reported_late);
      this._charge("safety", `${f.cause.text} at ${AREAS[f.area].name}, reported ${hrs(told - f.known_at)} after it was known`, "proceedings for a dangerous event reported late");
      this._brokenIf("safety", "report", "a dangerous event came late");
    }
  }

  /**
   * Send a person to a fault. By day whoever is on shift goes; at night the one on call by the
   * rota, or somebody who is asked a favour.
   * @param {string} fault
   * @param {string} person
   * @returns {{ok: boolean, reason?: string}}
   */
  send(fault, person) {
    const f = this.fault(fault), p = this.person(person), h = this.now;
    if (!f || !p) return { ok: false, reason: "There is no such fault or person." };
    if (f.state === "done") return { ok: false, reason: "That fault is cleared." };
    if (f.person) return { ok: false, reason: `${this.person(f.person).name} is on the way or there.` };
    const F = FAULTS[f.kind];
    if (F.trade && p.trade !== F.trade) return { ok: false, reason: `${cap(f.name)} is a case for a ${F.trade} technician; ${p.name} is a ${p.trade} technician.` };
    const free = this.freeFor(p, h);
    if (!free.ok) return free;
    const favour = !this.onShift(p, h) && !this.onCall(p, h);
    if (favour && (p.strain >= STRAIN.no_favour || this.blocked(p, h, h + 2))) return { ok: false, reason: `${p.name} is not on call${this.blocked(p, h, h + 2) ? ` and cannot leave: ${p.life}` : " and has had enough of this week"}.` };
    const min = this.driveMin(p, f.area, h);
    f.person = p.id;
    f.sent = h;
    f.arrive = h + min / 60;
    p.out = { fault: f.id, from: h, origin: this.whereabouts(p, h).at };
    this._strain(p, this.onShift(p, h) ? 0 : STRAIN.call + (favour ? STRAIN.favour : 0));
    if (favour) this._mood("council", MOOD.favour);
    this.log(`${when(h)} ${p.name} sets off for ${AREAS[f.area].name}${favour ? ", as a favour: not on call" : this.onShift(p, h) ? "" : ", on call"}: ${min} min on the road.`, "request");
    this._drop(`who-${f.id}`);
    return { ok: true };
  }

  /* ---------------------------------------------------------------- where the people are */

  /** Whether a person is on their day shift at an hour of the week (not sick, not resting after a night). */
  onShift(p, h) {
    const x = hourOfDay(h), me = this.person(p.id);
    if (x < SHIFT.from || x >= SHIFT.to || h >= WEEK_H) return false;
    if (me.away_until != null && me.away_until > h) return false;
    const from = h - (x - SHIFT.from), to = from + (SHIFT.to - SHIFT.from);
    return !this._nights(me).some(([a, b]) => overlaps(from - SHIFT.rest_h, to + SHIFT.rest_h, a, b));
  }

  /** The hours a person works or worked outside the day shifts: nights on a work, and call-outs. */
  _nights(p) {
    const out = p.busy.filter((b) => !b.day).map((b) => [b.from, b.to]);
    for (const w of this.works) if (w.crew.includes(p.id) && w.start != null && w.state !== "off" && this.outside(w) && !(w.state === "planned" && this.item(p.id, w.id)?.refused)) out.push([w.start, (w.t1 ?? w.start + w.len)]);
    return out;
  }

  /** Whether a person is on call by the published rota at an hour of the week (outside the day shift). */
  onCall(p, h) {
    const night = Math.floor((h + START_H - SHIFT.to) / 24);
    return !this.onShift(p, h) && p.on_call.includes(Math.max(0, night));
  }

  /** Whether a person can leave for a fault now, and why not. */
  freeFor(p, h) {
    const me = this.person(p.id);
    if (me.away_until != null && me.away_until > h) return { ok: false, reason: `${p.name} is ${me.away_why === "sick" ? "off sick" : "out with the fire brigade"}.` };
    if (me.out) return { ok: false, reason: `${p.name} is at another fault.` };
    const w = this.works.find((x) => x.state === "running" && x.crew.includes(p.id) && !x.absent?.includes(p.id));
    if (w) return { ok: false, reason: `${p.name} is in the possession of ${w.name}.` };
    return { ok: true };
  }

  /**
   * Where a person is at an hour of the week: at a fault or on the way to it, at a work or on the
   * way to it or home from it, at the base in the day shift (on the way there in the morning,
   * home in the afternoon), else at home.
   * @returns {{at: string, to?: string, u?: number}} `at`: "home", "base" or an area; on the way: where to, and how far (0 … 1)
   */
  whereabouts(p, h) {
    const me = this.person(p.id), min = (area) => (area === "base" ? p.drive.station : p.drive[area]) / 60;
    if (me.out) {
      const f = this.fault(me.out.fault);
      if (h < f.arrive) return { at: me.out.origin, to: f.area, u: (h - f.sent) / Math.max(1e-6, f.arrive - f.sent) };
      return { at: f.area };
    }
    for (const w of this.works) {
      if (!w.crew.includes(p.id) || w.start == null || w.absent?.includes(p.id)) continue;
      const end = w.t1 ?? w.start + w.len, d = min(w.area), day = !this.outside(w);
      if (w.state === "running" || (w.state === "done" && h < end)) return { at: w.area };
      if (w.state === "planned" && h >= w.start - d && h < w.start && this.item(p.id, w.id)?.told != null) return { at: day ? "base" : "home", to: w.area, u: (h - (w.start - d)) / d };
      if (w.state === "done" && h >= end && h < end + d) return { at: w.area, to: day ? "base" : w.room?.includes(p.id) ? w.area : "home", u: (h - end) / d };
    }
    if (me.away_until != null && me.away_until > h) return { at: me.away_why === "sick" ? "home" : "branch" };
    const x = hourOfDay(h), d = min("base"), day = h - (x - SHIFT.from);
    if (this.onShift(p, day + 0.01)) {
      if (x >= SHIFT.from - d && x < SHIFT.from) return { at: "home", to: "base", u: (x - (SHIFT.from - d)) / d };
      if (x >= SHIFT.from && x < SHIFT.to) return { at: "base" };
      if (x >= SHIFT.to && x < SHIFT.to + d) return { at: "base", to: "home", u: (x - SHIFT.to) / d };
    }
    return { at: "home" };
  }

  /** How long a person drives to an area from where they are (min). */
  driveMin(p, area, h) {
    const here = this.whereabouts(p, h).at;
    if (here === area) return 4;
    if (here === "home") return p.drive[area];
    if (here === "base") return BASE_DRIVE[area];
    // (from another area: by the base)
    return BASE_DRIVE[here] + BASE_DRIVE[area];
  }

  /* ---------------------------------------------------------------- the works */

  /** A work is due: does it begin? What stands against it is said, and it must be planned again. */
  _begin(w) {
    const h = this.now, why = [];
    const crew = w.crew.map((id) => this.person(id)), there = [];
    for (const p of crew) {
      const x = this.item(p.id, w.id);
      if (p.away_until != null && p.away_until > h) why.push(`${p.name} is ${p.away_why === "sick" ? "off sick" : "out with the fire brigade"}`);
      else if (p.out) why.push(`${p.name} is at a fault`);
      else if (x && x.told == null) why.push(`${p.name} was never told of the shift`);
      else if (x?.refused && !x.ordered) why.push(`${p.name} said no`);
      else there.push(p);
    }
    if (there.length < w.crew_n && !why.length) why.push(w.crew.length ? `it has ${plural(there.length, "person")} of ${w.crew_n}` : "nobody is on it");
    if (w.qual && there.length >= w.crew_n && !there.some((p) => p.quals.includes(w.qual))) why.push(w.qual === "weld" ? "nobody on it may weld a rail" : "nobody on it may manage a possession");
    if (w.trade && there.length >= w.crew_n && !there.some((p) => p.trade === w.trade)) why.push(`nobody on it is a ${w.trade} technician`);
    if (this.needs(w, "ops") && this.stale(w, "ops")) why.push(w.told.ops ? `the possession is registered for ${when(w.told.ops.start)}, not for now` : "no possession is registered");
    if (this.inWindow(w) && this.faults.some((f) => f.state !== "done" && f.area === "station")) why.push("the signaller gives no window while point W2 is out");
    if (w.id === "tamp" && this.storm.on && this.storm.strong) why.push("the machine cannot work in the storm");
    // (somebody whose rest was cut by a fault after the plan was made: asked about, once)
    const tired = why.length ? null : there.find((p) => p.busy.some((b) => b.to > h - SHIFT.rest_h && !b.day));
    if (tired && !this._asked.has(`rest:${w.id}`)) return void this._askRest(w, tired);
    if (why.length) return void this._missed(w, why);
    this._judge(w);
    w.state = "running";
    w.t0 = h;
    // (the possession is the registered one: from the slot, however late the work began)
    w.until = w.start + w.len;
    w.t1 = h + w.need;
    this.log(`${when(h)} ${cap(w.name)} begins: ${list(there.map((p) => p.name))}${w.possession ? `, the possession on ${AREAS[w.area].line} holds until ${when(w.until)}` : ""}.`, "train");
    for (const p of there) {
      if (this.outside(w)) this._strain(p, STRAIN.night);
      if (p.drive[w.area] > FAR_MIN) this._strain(p, STRAIN.drive);
    }
  }

  /** A work does not begin: its night is lost, what was announced was for nothing, and it has no slot until it is planned again. */
  _missed(w, why) {
    const h = this.now;
    w.misses++;
    this.log(`${when(h)} ${cap(w.name)} does not begin: ${why.join("; ")}.`, "fault");
    this.irregular("work-missed", `missed:${w.id}:${w.misses}`, { work: w.name, why: why[0] });
    for (const who of ["ops", "town"]) {
      if (!w.told[who] || w.told[who].start !== w.start) continue;
      this._mood(who, who === "ops" ? MOOD.unused : MOOD.wasted);
      this.log(`${when(h)} ${AUDIENCES[who].name}: "${who === "ops" ? "A possession held free for nothing: trains were planned round it." : "A night announced, and nothing came."}"`, "fault");
      delete w.told[who];
      this._patience(who);
    }
    if (w.id === "tamp") {
      this.tally.cost += COST.machine;
      this.log(`${when(h)} ${HANDS.machine}, the machine's operator: "We stand here with the machine. The night is on your bill: ${COST.machine} EUR."`, "fault");
    }
    for (const x of this.rota.filter((y) => y.work === w.id && y.start === w.start)) x.done = true;
    w.start = null;
    this._syncRota();
  }

  /** The news of a work, judged when it begins: was everybody who needed it told, in time, and the right thing? */
  _judge(w) {
    const h = this.now;
    for (const who of ["ops", "town"]) {
      const a = AUDIENCES[who], n = w.told[who];
      if (!this.needs(w, who)) continue;
      const what = who === "ops" ? `the possession for ${w.name}` : `the night of ${w.name}`;
      if (!n || n.start !== w.start) {
        this.tally.missing++;
        this._mood(who, MOOD.missing);
        this._charge(who, `${what}: ${n ? `announced for ${when(n.start)}, done ${when(w.start)}` : "never announced"}`, who === "town" ? "a fine for night work without notice" : "a claim of the undertakings");
        this.irregular("missing-news", `missing:${who}:${w.id}`, { who: a.name, what });
        this._brokenIf(who, "notice", `${what} was not announced`);
        continue;
      }
      const lead = w.start - n.at;
      if (lead < a.late_h) {
        this.tally.late++;
        this._mood(who, MOOD.late);
        this.log(`${when(h)} ${a.name}: "${cap(what)}, ${hrs(lead)} ahead. ${who === "ops" ? "The undertakings had printed their day." : "The notes were in the letter boxes when the lamps went on."}"`, "fault");
        this.irregular("late-news", `late:${who}:${w.id}`, { who: a.name, what });
        if (this.rng("charge", who, w.id).next() < CHANCE.charge) this._charge(who, `${what}, announced ${hrs(lead)} ahead`, who === "town" ? "a fine for night work announced too late" : "a claim of the undertakings for a possession inside the period");
      } else if (a.early_h && lead > a.early_h && this.rng("forgot", w.id).next() < 0.6) {
        this.tally.late++;
        this._mood(who, MOOD.forgotten);
        this.log(`${when(h)} ${a.name}: "The note came ${Math.round(lead / 24)} days ago. Nobody in those houses remembers it tonight; my phone does."`, "fault");
        this.irregular("late-news", `early:${who}:${w.id}`, { who: a.name, what: `${what}, announced too early` });
      } else {
        this.tally.in_time++;
        this._mood(who, MOOD.in_time);
      }
      if (who === "town" && lead < 48) this._brokenIf("town", "two-days", `${what} came ${hrs(lead)} ahead`);
      this._patience(who);
    }
    // the works council: a shift outside the rota without its consent goes to the labour court
    const mine = this.rota.filter((x) => x.work === w.id && x.start === w.start);
    const without = mine.filter((x) => !x.council || x.council.ok !== true);
    if (without.length) {
      this.tally.missing++;
      this._mood("council", MOOD.missing);
      this._charge("council", `${list(without.map((x) => this.person(x.person).name))} on ${w.name}, ${when(w.start)}, without the works council's consent`, "an application to the labour court");
      this.irregular("missing-news", `missing:council:${w.id}`, { who: AUDIENCES.council.name, what: `the night of ${w.name}` });
      this._patience("council");
    }
    for (const x of mine) x.done = true;
  }

  /** A formal step: a claim, a fine, the labour court, proceedings. */
  _charge(who, what, step) {
    const a = AUDIENCES[who];
    this.tally.charges++;
    this.violate("charge", `${when(this.now)} ${a.name}: ${step}. ${cap(what)}.`, 2);
    this.irregular("charge", `charge:${who}:${this.tally.charges}`, { who: a.name, what: step });
  }

  /** The works go on: one that is due begins, one that runs ends, one over its possession costs trains. */
  _works() {
    const h = this.now;
    for (const w of this.works) {
      if (w.state === "planned" && w.start != null && h >= w.start && !this.open.some((d) => d.id === `rest-${w.id}`)) this._begin(w);
      if (w.state !== "running" || h < w.t1) continue;
      w.state = "done";
      const over = Math.max(0, w.t1 - w.until);
      this.log(`${when(h)} ${cap(w.name)} is done${w.possession ? `, the track handed back${over > 0.01 ? ` ${Math.round(over * 60)} min after the possession ended` : ""}` : ""}.`, "train");
      if (over > 0.01) {
        w.late_by = over;
        this._mood("ops", MOOD.over_quarter * Math.round(over * 4));
        this.irregular("overrun", `overrun:${w.id}`, { work: w.name, min: String(Math.round(over * 60)), who: AUDIENCES.ops.name });
        this._brokenIf("ops", "change", `${w.name} ran ${Math.round(over * 60)} min over`);
        this._patience("ops");
      }
      this._after(w);
    }
  }

  /** After a work: the way home after a night, and what a tired crew may have left in the track. */
  _after(w) {
    const h = this.now, crew = w.crew.filter((id) => !w.absent?.includes(id)).map((id) => this.person(id));
    for (const p of crew) p.busy.push({ from: w.t0, to: w.t1, day: !this.outside(w), work: w.id });
    if (!this.outside(w)) return;
    for (const p of crew) {
      if (p.drive[w.area] <= FAR_MIN || w.room?.includes(p.id)) continue;
      if (this.rng("drive", w.id, p.id).next() < CHANCE.drive) {
        this._strain(p, STRAIN.tired_drive);
        this._mood("council", MOOD.drive);
        this.violate("care", `${when(h)} ${p.name} fell asleep at the wheel on the ${p.drive[w.area]} min home after the night and woke on the verge, unhurt. A room at the site costs ${COST.room} EUR.`, 2);
        this._patience("council");
      } else this.log(`${when(h)} ${p.name} drives the ${p.drive[w.area]} min home after the night.`, "info");
    }
    const tired = crew.find((p) => p.cut || p.strain >= STRAIN.sick);
    if (tired && w.possession && this.rng("nearmiss", w.id).next() < CHANCE.nearmiss) {
      const f = this._fault({ id: `nearmiss-${w.id}`, kind: "nearmiss", area: w.area, at: h, u: 0, v: 0 });
      f.mode = "none";
      f.known = true;
      f.known_at = h;
      f.cause = FAULTS.nearmiss.causes[0];
      f.state = "done";
      f.done = h;
      this.log(`${when(h)} At ${AREAS[w.area].name} ${f.cause.text}. ${tired.name} had ${tired.cut ? "no rest before the night" : "a week too hard"}.`, "fault");
      this.irregular("dangerous", `dangerous:${f.id}`, { what: f.cause.text, where: AREAS[w.area].name });
      this._askReport(f);
    }
  }

  /* ---------------------------------------------------------------- the faults */

  /** A fault begins: it is on the list, with what the seed has hidden in it. */
  _fault(spec) {
    const F = FAULTS[spec.kind];
    let u = spec.u, cause = F.causes.at(-1);
    for (const c of F.causes) {
      if (u < c.p) {
        cause = c;
        break;
      }
      u -= c.p;
    }
    const f = { ...spec, name: F.name, cause, known: false, known_at: null, state: "open", mode: spec.kind === "knock" ? "sight" : spec.kind === "points" ? "points" : spec.kind === "tree" ? "closed" : "none", person: null, sent: null, arrive: null, repair_h: null, done: null, told: {}, forecast: null, judged: false };
    this.faults.push(f);
    return f;
  }

  /** The faults come, are looked at, repaired; without a word the rota's person on call goes. */
  _faults() {
    const h = this.now;
    while (this._coming.length && h >= this._coming[0].at) {
      const f = this._fault(this._coming.shift()), a = AREAS[f.area];
      this.irregular("fault", `fault:${f.id}`, { what: f.name, where: a.name });
      if (f.kind === "knock") {
        this.log(`${when(h)} A driver reports a hard knock in the track on ${a.line}. The signaller lets the next trains run on sight.`, "fault");
        this._askKnock(f);
      } else {
        // (the signaller reports it: operations know)
        f.told.ops = h;
        this.log(`${when(h)} ${f.kind === "points" ? `The signaller of Bf Neustadt: point W2 does not reach its end position. ${trainsAt("station", h) >= 3 ? "The peak stands at the entry signals." : "Trains go round it by the other tracks."}` : f.kind === "tree" ? `The signaller of Waldau: a tree lies in the overhead line. The branch is shut.` : `The crossing's remote monitoring: the barriers of Brückenstraße stay down. The trains run, the road is shut.`}`, "fault");
      }
    }
    for (const f of this.faults) {
      if (f.state === "done") continue;
      const F = FAULTS[f.kind];
      if (!f.person && h - f.at >= AUTO_H && f.mode !== "watch") this._auto(f);
      if (!f.person || h < f.arrive) continue;
      const p = this.person(f.person);
      if (!f.known && h >= f.arrive + F.look_h) this._known(f, p);
      if (f.known && f.repair_at != null && h >= f.repair_at) this._cleared(f, p);
    }
    // a fault left at line speed is looked at by the next day shift
    for (const f of this.faults.filter((x) => x.mode === "watch" && !x.person && x.state !== "done")) {
      const p = this.people.filter((q) => q.trade === "track" && this.onShift(q, h) && this.freeFor(q, h).ok)[0];
      if (p && h - f.at >= AUTO_H) this.send(f.id, p.id);
    }
  }

  /** Nobody was sent: the rota's person on call sets off, by day whoever of the trade is nearest on shift. */
  _auto(f) {
    const h = this.now, F = FAULTS[f.kind];
    const soon = (p) => this.works.some((w) => w.state === "planned" && w.start != null && w.start - h < 4 && w.crew.includes(p.id));
    const can = this.people.filter((p) => (!F.trade || p.trade === F.trade) && this.freeFor(p, h).ok && (this.onShift(p, h) || this.onCall(p, h)));
    const p = can.sort((a, b) => Number(soon(a)) - Number(soon(b)) || Number(this.onCall(b, h)) - Number(this.onCall(a, h)) || this.driveMin(a, f.area, h) - this.driveMin(b, f.area, h))[0];
    if (!p) return;
    this.log(`${when(h)} No word from the district manager: by the rota ${p.name} goes.`, "info");
    this.send(f.id, p.id);
  }

  /** The person on site has looked: the cause is known, and with it what to do and whom to tell. */
  _known(f, p) {
    const h = this.now, c = f.cause, a = AREAS[f.area];
    f.known = true;
    f.known_at = h;
    this._drop(`fault-${f.id}`);
    const range = f.kind === "points" && p.quals.includes("relay") ? c.relay : c.repair;
    f.range = range;
    f.repair_h = range[0] + f.v * (range[1] - range[0] + (range[1] > 0 ? 0.5 : 0));
    f.repair_at = h + f.repair_h;
    this.log(`${when(h)} ${p.name} at ${a.name}: ${c.text}.${range[1] > 0 ? ` ${hrs(range[0])} to ${hrs(range[1])}, I would say.` : ""}`, c.dangerous ? "fault" : "train");
    if (f.kind === "knock") {
      if (c.id === "nothing") f.mode = "none";
      else if (c.id === "break") {
        if (f.mode === "watch") {
          // (left at line speed on a driver's report: what that was shows only now)
          this._mood("safety", MOOD.over_break);
          this.violate("danger", `${when(h)} Trains ran at line speed over ${a.line} for ${hrs(h - f.at)} after a driver's report: the rail was broken. A report from the track is answered by a restriction until somebody has looked.`, 3);
          this.give("incident-report", { what: "trains at line speed over a broken rail", where: a.name });
        } else if (f.mode !== "closed") {
          this._mood("safety", MOOD.over_break);
          this.log(`${when(h)} ${AUDIENCES.safety.name} will ask how many trains ran over a broken rail at ${f.mode === "sight" ? "sight" : "20 km/h"}.`, "fault");
        }
        f.mode = "closed";
        this.irregular("dangerous", `dangerous:${f.id}`, { what: c.text, where: a.name });
        if (f.told.safety == null) this._askReport(f);
      }
    }
    if (f.told.safety != null) this._judgeReport(f);
    if (f.told.ops != null && range[1] > 0 && f.mode !== "none") this._askForecast(f);
    else if (f.mode !== "none" && f.told.ops == null) {
      // (a track closed or slowed that operations were not told of: the signaller tells them, and they say so)
      f.told.ops = h;
      this._mood("ops", MOOD.late);
      this.tally.late++;
      this.log(`${when(h)} ${AUDIENCES.ops.name}: "I hear of ${f.name} from the signaller, not from you."`, "fault");
      this.irregular("late-news", `late:ops:${f.id}`, { who: AUDIENCES.ops.name, what: f.name });
      if (range[1] > 0) this._askForecast(f);
    }
  }

  /** A fault is cleared: the track is free, the person goes back, and a forecast is kept or not. */
  _cleared(f, p) {
    const h = this.now;
    f.state = "done";
    f.done = h;
    f.mode = "none";
    p.out = null;
    p.busy.push({ from: f.sent, to: h, day: this.onShift(p, f.sent) && this.onShift(p, Math.min(h, f.sent + 6)), fault: f.id });
    this.log(`${when(h)} ${cap(f.name)} at ${AREAS[f.area].name} is cleared${f.repair_h > 0 ? ` after ${hrs(f.repair_h)} of work` : ""}; ${p.name} goes back.`, "train");
    this._drop(`forecast-${f.id}`);
    this._drop(`who-${f.id}`);
    const fc = f.forecast;
    if (fc && fc.kept == null) {
      fc.kept = true;
      this._mood("ops", MOOD.forecast_kept);
      this.log(`${when(h)} ${AUDIENCES.ops.name}: "Open by ${when(fc.until)}, as you said."`, "request");
    }
    if (f.kind === "crossing" && f.told.town == null) {
      this._mood("town", MOOD.crossing);
      this.tally.missing++;
      this.log(`${when(h)} ${AUDIENCES.town.name}: "Brückenstraße was shut for ${hrs(h - f.at)} and the town heard it from the drivers in the queue."`, "fault");
      this.irregular("missing-news", `missing:town:${f.id}`, { who: AUDIENCES.town.name, what: "the crossing of Brückenstraße shut" });
      this._patience("town");
    }
    // (a dangerous event nobody reported: it is found in the morning's papers)
    if (f.cause.dangerous && f.told.safety == null && f.report_at == null && !this.open.some((d) => d.id === `report-${f.id}`)) this._unreported(f);
  }

  /** A dangerous event that was never reported comes out. */
  _unreported(f) {
    if (f.judged) return;
    f.judged = true;
    this.tally.missing++;
    this._mood("safety", MOOD.missing);
    this._charge("safety", `${f.cause.text} at ${AREAS[f.area].name}, never reported`, "proceedings for a dangerous event not reported");
    this.irregular("missing-news", `missing:safety:${f.id}`, { who: AUDIENCES.safety.name, what: f.cause.text });
    this._brokenIf("safety", "report", "a dangerous event was not reported");
    this._patience("safety");
  }

  /** The storm: its forecast, its hours, what it brings down. */
  _storm() {
    const h = this.now, st = this.storm, lv = LEVELS[this.level];
    if (!this._asked.has("storm") && h >= STORM.forecast) {
      this._asked.add("storm");
      this._askStorm();
    }
    if (!st.on && !st.over && h >= STORM.from) {
      st.on = true;
      this.log(`${when(h)} The storm is here${st.strong ? ": gusts of 110 km/h, branches on the roads" : ", weaker than forecast: by eight it has passed"}.`, st.strong ? "fault" : "info");
      this.irregular("storm", "storm", { what: st.strong ? "a strong storm" : "a storm that passes" });
      if (!st.strong) return;
      const r = this.rng("storm", "damage"), cut = this.work("veg").state === "done";
      if (r.next() < (cut ? STORM.tree.cut : STORM.tree.uncut)) this._coming.push({ id: "tree", kind: "tree", area: "branch", at: h + 0.6, u: 0, v: r.next() });
      if (r.next() < STORM.crossing) this._coming.push({ id: "crossing", kind: "crossing", area: "east", at: h + 1.2, u: 0, v: r.next() });
      this._coming.sort((a, b) => a.at - b.at);
      const p5 = this.person("p5");
      if (lv.storm && r.next() < STORM.brigade && !p5.out && !(p5.away_until > h)) {
        p5.away_until = STORM.to;
        p5.away_why = "brigade";
        this.log(`${when(h)} ${p5.name} is called out by the fire brigade of Waldau: back when the storm is over.`, "fault");
      }
    }
    if (st.on && h >= (st.strong ? STORM.to : STORM.from + 2)) {
      st.on = false;
      st.over = true;
      this.log(`${when(h)} The storm has passed.`, "info");
    }
  }

  /* ---------------------------------------------------------------- what is asked */

  /** Take back a question and what it is about. */
  _drop(id) {
    if (this.withdraw(id)) this.about.delete(id);
  }

  /** A driver's report of a hard knock: what holds on that track until somebody has looked? One of a few choices. */
  _askKnock(f) {
    const id = `fault-${f.id}`, a = AREAS[f.area], ops = AUDIENCES.ops, safety = AUDIENCES.safety, n = Math.round(trainsAt(f.area, this.now));
    this.about.set(id, [`fault-${f.id}`, "aud-ops", "aud-safety"]);
    this.ask({
      id, title: `A driver reports a hard knock on ${a.line}. Close the track on a suspicion, slow it, or wait for more than one report?`,
      text: `Closed, ${plural(n, "train")} an hour share the other track until somebody has looked; left open, a broken rail is run over. From experience such a report is a broken rail in three of ten cases, a loose fishplate in three or four, the train's own wheel in the rest. `
        + `The signaller lets trains run on sight until you decide. A broken rail is a dangerous event: ${safety.name} (${safety.role}) must have it within the hour of its being known, and reports it on. Reported on a suspicion that turns out to be none, the file is open all the same. `
        + `Whoever you send looks first; nobody is there yet: tap the fault, then the van of who should go.`,
      options: [
        { id: "close", label: `Close the track; tell ${ops.name} and report the suspicion to ${safety.name} now` },
        { id: "slow", label: `20 km/h over it; tell ${ops.name}; ${safety.name} hears when we know` },
        { id: "watch", label: "Line speed: one driver, one knock. The next day shift looks" },
      ],
      within: DECIDE_S.fault, fallback: "slow",
      then: (x) => {
        this.about.delete(id);
        const h = this.now;
        if (f.known) return;
        f.mode = x === "close" ? "closed" : x === "slow" ? "slow20" : "watch";
        if (x !== "watch") {
          f.told.ops = h;
          this.give("situation-report", { fault: f.name, where: a.line, restriction: x === "close" ? "closed" : "20 km/h" });
          this.log(`${when(h)} ${cap(a.line)}: ${x === "close" ? "closed" : "20 km/h over the spot"}. ${ops.name} is told.`, "request");
        } else this.log(`${when(h)} ${cap(a.line)} stays at line speed. Nobody is told.`, "request");
        if (x === "close") {
          f.told.safety = h;
          this._report(f);
        }
      },
    });
  }

  /** A dangerous event is known and safety has not heard: now, or later with the full picture? One of a few choices. */
  _askReport(f) {
    const id = `report-${f.id}`, a = AUDIENCES.safety, night = isNight(this.now);
    if (this.open.some((d) => d.id === id)) return;
    this.about.set(id, [`fault-${f.id}`, "aud-safety"]);
    this.ask({
      id, title: `${cap(f.cause.text)} at ${AREAS[f.area].name}${night ? `, and it is ${clock(this.now)}` : ""}. Does ${a.name} hear it now, or later with the full picture?`,
      text: `Now, the report is thin${night ? " and wakes him" : ""}; later, it is complete and late. A dangerous event is reported within the hour of its being known: ${a.name} (${a.role}) reports it on to the supervisory authority, and the hour is theirs to check. `
        + `Once the track is safe again you would know how it came about, and could say so in one call instead of three.`,
      options: [
        { id: "now", label: `Phone ${a.name} now` },
        { id: "later", label: "Later, with the full picture" },
      ],
      within: DECIDE_S.fault, fallback: "now",
      then: (x) => {
        this.about.delete(id);
        if (f.told.safety != null) return;
        if (x === "now") {
          f.told.safety = this.now;
          this._report(f);
        } else {
          // (told once the repair is done, and not before two hours have passed)
          f.report_at = Math.max(this.now + 2, f.repair_at ?? 0);
          this.log(`${when(this.now)} ${a.name} hears of it later, with the full picture.`, "request");
        }
        this._patience("safety");
      },
    });
  }

  /** Operations ask when the track is open again: a number of hours, before the repair is done. */
  _askForecast(f) {
    const id = `forecast-${f.id}`, a = AUDIENCES.ops, [lo, hi] = f.range ?? [0, 0];
    if (f.forecast || this.open.some((d) => d.id === id) || !(hi > 0) || f.state === "done") return;
    const value = Math.min(6, Math.max(0.5, Math.ceil(((lo + hi) / 2) * 2) / 2)), n = Math.round(trainsAt(f.area, this.now));
    this.about.set(id, [`fault-${f.id}`, "aud-ops"]);
    this.ask({
      id, title: `${a.name}, ${a.role}: “${cap(f.name)} at ${AREAS[f.area].name}. When is it open again? The undertakings plan by your word.”`,
      text: `Say too short a time and trains are sent into a track that is not open; too long and trains stay cancelled that could have run. ${this.person(f.person).name} on site reckons ${hrs(lo)} to ${hrs(hi)}, and it has taken longer before. `
        + `About ${plural(n, "train")} an hour pass there now. A time said and missed costs a second round of cancellations at short notice; no time at all leaves ${a.name} planning from hour to hour.`,
      scale: { min: 0.5, max: 6, step: 0.5, unit: "h", value, label: "Open again in" },
      options: [{ id: "none", label: "No time yet: “we are working on it”" }],
      within: DECIDE_S.call, fallback: value,
      then: (x) => {
        this.about.delete(id);
        if (f.state === "done") return;
        if (x === "none") {
          f.forecast = { until: null, kept: false, none: true };
          this._mood("ops", MOOD.no_forecast);
          this.log(`${when(this.now)} ${a.name}: "Then I plan from hour to hour, and so do six undertakings."`, "fault");
        } else {
          f.forecast = { until: this.now + Number(x), kept: null, from: this.now };
          this.log(`${when(this.now)} Said to ${a.name}: open again by ${when(f.forecast.until)}.`, "request");
        }
        this._patience("ops");
      },
    });
  }

  /** The rail change is registered: how long a possession? A number of hours, and beside it: let the welder look first. */
  _askLength(w) {
    const id = "length-rail", a = AUDIENCES.ops, [lo, hi] = w.guess, night = isNight(w.start);
    const value = Math.min(RAIL.max, Math.max(RAIL.min, Math.ceil(((lo + hi) / 2) * 2) / 2)), welder = PEOPLE.find((p) => p.quals.includes("weld"));
    const free = night ? Math.floor(((FIRST_TRAIN + 24 - hourOfDay(w.start)) % 24) * 2) / 2 : null;
    this.about.set(id, ["work-rail", "aud-ops"]);
    this.ask({
      id, title: `${a.name}, ${a.role}: “A possession on ${AREAS[w.area].line} from ${when(w.start)}. For how many hours?”`,
      text: `Too short and the work runs over into trains nobody warned; too long and trains are taken out that could have run. ${welder.name} (the welder) reckons ${hrs(lo)} to ${hrs(hi)}${w.looked ? ", having looked at the rail" : " from the ultrasound report alone"}: how the old rail comes out and what the rail's temperature allows shows only on the night. `
        + `${night ? `From ${when(w.start)} the line is free of trains for ${hrs(free)}: every registered half hour beyond that takes the morning's first trains out, used or not.` : `By day the other track carries both directions: about ${Math.round(trainsAt(w.area, w.start + 1))} trains an hour lose ${EFFECT.single} min each for every registered hour, used or not.`} `
        + `An hour over the possession costs three times an hour inside it.${w.looked ? "" : ` ${welder.name} can look at the rail on his round first: ${RAIL.look_h} h, and the registration waits that long.`}`,
      scale: { min: RAIL.min, max: RAIL.max, step: RAIL.step, unit: "h", value, label: "The possession is registered for" },
      options: w.looked ? [] : [{ id: "look", label: `${welder.name} looks at the rail first (${RAIL.look_h} h)` }],
      within: DECIDE_S.plan, fallback: value,
      then: (x) => {
        this.about.delete(id);
        if (x === "look") {
          w.look_at = this.now + RAIL.look_h;
          this.log(`${when(this.now)} ${welder.name} looks at the rail at km 12.4 on his round before the possession is registered.`, "request");
          return;
        }
        this._asked.add("length");
        w.len = Number(x);
        if (w.state === "planned" && w.start != null) {
          // (the answer may have come too late for the slot: said, not swallowed)
          const told = this._tellWork("ops", w);
          if (!told.ok) this.log(`${when(this.now)} ${told.reason} The possession is not registered.`, "fault");
        }
        this._syncRota();
      },
    });
  }

  /** The storm's forecast: keep the tamping night, move it, or call it off? One of a few choices. */
  _askStorm() {
    const w = this.work("tamp"), other = w.slots.find((s) => s !== w.start && s > this.now);
    this.log(`${when(this.now)} The weather service warns of a storm for Wednesday evening.`, "fault");
    if (w.state !== "planned" || w.start == null || !overlaps(w.start, w.start + w.len, STORM.from, STORM.to + 6)) return;
    const told = Object.keys(w.told).map((k) => AUDIENCES[k]?.name).filter(Boolean);
    this.about.set("storm", ["work-tamp"]);
    this.ask({
      id: "storm", title: `A storm is forecast for Wednesday evening, gusts of 70 to 110 km/h. The tamping machine is booked for ${when(w.start)}: keep the night, move it, or call it off?`,
      text: `Moved now, everybody can still be told in time; kept, it may be called off at nine with everybody told for nothing. Above 90 km/h the machine does not work, and whether the storm is that strong or has passed by ten, nobody knows before Wednesday evening: the service says it is as likely as not. `
        + `${other ? `The contractor's only other night is ${when(other)} (${COST.moved} EUR for moving it), and it is kept free until ${when(STORM.reserve_by)} only. ` : ""}A night not used is ${COST.machine} EUR and a possession held free for nothing. `
        + `${told.length ? `${list(told)} ${told.length === 1 ? "has" : "have"} been told ${when(w.start)}: moved, each must be told again, and the people of the night have arranged their lives round it.` : "Nobody has been told of the night yet."}`,
      options: [
        { id: "keep", label: `Keep ${when(w.start)}` },
        ...(other ? [{ id: "move", label: `Move it to ${when(other)}` }] : []),
        { id: "off", label: "Call it off for this week" },
      ],
      within: DECIDE_S.plan, fallback: "keep",
      then: (x) => {
        this.about.delete("storm");
        this.storm.decided = x;
        if (x === "move") {
          // (people who cannot make the other night come off it)
          for (const id of [...w.crew]) if (!this.fits(this.person(id), w, other).ok) this.unassign(w.id, id);
          this.schedule(w.id, other);
        } else if (x === "off") {
          const was = w.start;
          this.schedule(w.id, null);
          w.state = "off";
          w.off_from = was;
          this.tally.cost += COST.machine / 3;
          this.log(`${when(this.now)} The tamping is called off for this week: ${Math.round(COST.machine / 3)} EUR for the machine, and the track waits for its next free night in ${this.rng("next").next() < 0.5 ? "five" : "eight"} weeks.`, "request");
          for (const who of ["ops", "town"]) if (w.told[who]?.start === was) w.pending = [...(w.pending ?? []), who];
          this._syncRota();
        } else this.log(`${when(this.now)} The tamping stays on ${when(w.start)}.`, "request");
      },
    });
  }

  /** A person said no to a shift that cuts across their life: somebody else, an offer, or an order? One of a few choices. */
  _askRefusal(x) {
    const id = `refusal-${x.person}-${x.work}`, p = this.person(x.person), w = this.work(x.work), c = AUDIENCES.council;
    this.about.set(id, [`person-${p.id}`, `work-${w.id}`]);
    this.ask({
      id, title: `${p.name}, ${p.trade} technician: “${when(x.start)}? I cannot: ${p.life}.” ${cap(w.name)} needs ${plural(w.crew_n, "person")}.`,
      text: `Somebody else must then be found and told at shorter notice still; an order is lawful only with the works council's consent, and is remembered. ${cap(p.way)}: that was the notice ${p.name} needed, ${p.notice_h} h. `
        + `An offer (a day off in lieu and the cost of the help at home) may change the answer. ${c.name} hears of an order the same day.`,
      options: [
        { id: "else", label: `Take ${p.name} off it; I find somebody else` },
        { id: "offer", label: "Offer a day off in lieu and the cost of the help at home" },
        { id: "order", label: "Order it: the shift is needed" },
      ],
      within: DECIDE_S.plan, fallback: "else",
      then: (o) => {
        this.about.delete(id);
        if (w.state !== "planned" || !w.crew.includes(p.id) || w.start !== x.start) return;
        if (o === "else") this.unassign(w.id, p.id);
        else if (o === "offer") {
          const yes = this.rng("offer", x.key).next() < 0.6;
          this.tally.cost += 250;
          if (yes) {
            x.refused = false;
            this._strain(p, STRAIN.life / 2);
            this.log(`${when(this.now)} ${p.name}: "With the day off and the help paid, I can make it work. Once."`, "request");
          } else {
            this.log(`${when(this.now)} ${p.name}: "It is not about money. I cannot."`, "fault");
            this.unassign(w.id, p.id);
          }
        } else {
          x.refused = false;
          x.ordered = true;
          this._strain(p, STRAIN.life + STRAIN.shorter);
          this._mood("council", MOOD.ordered);
          this.log(`${when(this.now)} ${p.name} is ordered onto ${when(x.start)}. ${c.name} hears of it within the hour.`, "fault");
          this._patience("council");
        }
      },
    });
  }

  /** Somebody on a night was out at a fault and has not had their rest: home, somebody else, or work on? One of a few choices. */
  _askRest(w, p) {
    const id = `rest-${w.id}`, last = p.busy.filter((b) => !b.day).at(-1), h = this.now;
    this._asked.add(`rest:${w.id}`);
    const others = this.people.filter((q) => !w.crew.includes(q.id) && this.fits(q, w).ok && this.freeFor(q, h).ok && !this.blocked(q, h, h + w.len) && q.strain < STRAIN.no_favour && (!w.trade || q.trade === w.trade || w.crew.some((id2) => id2 !== p.id && this.person(id2).trade === w.trade)));
    const other = others.sort((a, b) => a.drive[w.area] - b.drive[w.area])[0] ?? null;
    this.about.set(id, [`work-${w.id}`, `person-${p.id}`]);
    this.ask({
      id, title: `${cap(w.name)} is about to begin, and ${p.name} was out at a fault until ${when(last.to)}: ${hrs(h - last.to)} of rest, not eleven. “I am fine,” ${p.name} says.`,
      text: `Sent home, the night stands or falls with who else can come; kept on, the working-time law is broken and a tired crew makes the mistakes that are found by the first train. `
        + `${other ? `${other.name} could be there in ${other.drive[w.area]} min, told now. ` : "Nobody else who fits is free tonight. "}Without ${p.name} and without a replacement ${w.name} does not begin: ${w.id === "tamp" ? `the machine's night is ${COST.machine} EUR, ` : ""}the possession is held free for nothing and what was announced was for nothing.`,
      options: [
        ...(other ? [{ id: "swap", label: `${p.name} goes home; ${other.name} steps in` }] : []),
        { id: "home", label: `${p.name} goes home; the night is off` },
        { id: "stay", label: `${p.name} works: “I am fine”` },
      ],
      within: DECIDE_S.fault, fallback: other ? "swap" : "home",
      then: (o) => {
        this.about.delete(id);
        if (w.state !== "planned") return;
        if (o === "stay") {
          p.cut = true;
          this.tally.rest_cut++;
          this._strain(p, STRAIN.rest_cut);
          this._mood("council", MOOD.rest_cut);
          this.violate("rest", `${when(this.now)} ${p.name} began ${w.name} after ${hrs(h - last.to)} of rest. The working-time law asks for eleven hours between two shifts.`, 2);
          this.irregular("rest-cut", `rest:${w.id}`, { person: p.name, who: AUDIENCES.council.name });
          this._patience("council");
        } else if (o === "swap") {
          w.crew.splice(w.crew.indexOf(p.id), 1, other.id);
          this._syncRota();
          const x = this.item(other.id, w.id);
          if (x) Object.assign(x, { told: this.now, council: { asked: this.now, due: this.now, ok: true } });
          this._strain(other, STRAIN.shorter);
          this._mood("council", MOOD.inside_day);
          this.log(`${when(this.now)} ${p.name} goes home. ${other.name} steps in at an hour's notice; ${AUDIENCES.council.name} is told and lets it pass for a fault.`, "request");
        } else {
          w.crew.splice(w.crew.indexOf(p.id), 1);
          this.log(`${when(this.now)} ${p.name} goes home.`, "request");
        }
      },
    });
  }

  /** One of the four is below the mark: the phone rings (once each). */
  _call(who) {
    if (this.over || this.called.has(who) || this.value(`mood-${who}`) >= MOOD.call || this.t < FIRST_S) return;
    const a = AUDIENCES[who], id = `call-${who}`, at = this.mood(who);
    this.called.add(who);
    this.about.set(id, [`aud-${who}`]);
    this.log(`${when(this.now)} ${a.name}, ${a.role}, is on the phone.`, "request");
    const acts = {
      ops: "takes no possession outside the standing windows any more that is not registered a full day ahead, and puts the week in writing",
      council: "consents to no further shift outside the rota this week, and puts the week in writing",
      town: "sends an officer with a sound meter to every night of the week, and writes to the mayor",
      safety: "orders an audit of the district's reporting, and puts the week in writing",
    }[who];
    const Q = {
      ops: {
        say: "What I registered for the undertakings on Monday is not what happens on Wednesday. Promise me: nothing that is registered moves any more this week.",
        text: "Promise it and the plan is frozen whatever the week brings; refuse and every further change is counted twice. What you promise here, the people and the town pay when a fault moves a night.",
        options: [["promise", "Promise: nothing registered moves any more"], ["try", "Offer: every change the same hour, with its reason"], ["explain", "Explain: faults move plans"]],
      },
      council: {
        say: "People hear on Tuesday what they work on Wednesday. Promise me: no shift outside the rota inside two days any more.",
        text: "Promise it and a fault's night cannot be staffed at short notice; refuse and the next request is read line by line. What you promise here, operations pay when a possession stands empty.",
        options: [["promise", "Promise: no shift inside two days any more"], ["try", "Offer: inside two days only for a fault, and you hear the same hour"], ["explain", "Explain: nobody planned the faults"]],
      },
      town: {
        say: "My phone rings at night because of your works. Promise me: no night beside houses without two days' notice.",
        text: "Promise it and a night moved by a fault or a storm cannot be done this week; refuse and every note is read with the law beside it. What you promise here, the period of the rail may pay.",
        options: [["promise", "Promise: two days' notice for every night"], ["try", "Offer: a note the same hour when a night moves"], ["explain", "Explain: the rail has a period too"]],
      },
      safety: {
        say: "I learn of your district's events late or not at all. From now on: every irregularity within the hour, day or night.",
        text: "Promise it and every loose bolt is a call at night; refuse and the next late report is on file. What you promise here, your own nights and his patience pay.",
        options: [["promise", "Promise: every irregularity within the hour"], ["try", "Offer: dangerous events at once, the rest in the morning report"], ["no", "Refuse: the rule is the rule, no more"]],
      },
    }[who];
    this.ask({
      id, title: `${a.name}, ${a.role}, is on the phone: “${Q.say}”`,
      text: `${Q.text} Below ${MOOD.act} of 100 ${a.name} ${acts}. ${a.name}'s patience is at ${at}.`,
      options: Q.options.map(([o, label]) => ({ id: o, label })),
      within: DECIDE_S.call, fallback: "try",
      then: (o) => {
        this.about.delete(id);
        const kinds = { ops: "change", council: "short", town: "two-days", safety: "report" };
        if (o === "promise") {
          this.promises.push({ who, what: Q.options[0][1].replace("Promise: ", ""), kind: kinds[who], strict: true, kept: null });
          this._mood(who, MOOD.promise);
          this.log(`${when(this.now)} Promised to ${a.name}: ${this.promises.at(-1).what}.`, "request");
        } else if (o === "try") {
          this._mood(who, MOOD.compromise);
          this.log(`${when(this.now)} ${a.name}: "Then I hold you to that."`, "request");
        } else if (o === "explain") {
          const taken = this.rng("call", who).next() < CHANCE.accept;
          this._mood(who, taken ? MOOD.explained : MOOD.refused);
          this.log(`${when(this.now)} ${a.name}: "${taken ? "I know. Then tell me first when it happens." : "Faults I understand. Hearing of them last I do not."}"`, "request");
        } else {
          this._mood(who, MOOD.declined);
          this.log(`${when(this.now)} ${a.name}: "Then I read every report of this week twice."`, "request");
        }
        this._act(who);
      },
    });
  }

  /** A promise of a kind is broken, if one is open (`when` false: it is not). */
  _brokenIf(who, kind, why, cond = true) {
    const p = this.promises.find((x) => x.who === who && x.kind === kind && x.kept == null);
    if (!p || !cond) return;
    p.kept = false;
    this._mood(who, MOOD.broken);
    this.violate("promise", `${when(this.now)} Promised to ${AUDIENCES[who].name}: ${p.what}. Not kept: ${why}.`, 2);
    this.irregular("promise-broken", `promise:${who}`, { who: AUDIENCES[who].name });
    this._act(who);
  }

  /** Somebody's patience is at its end: they put it in writing, and the rest of the week is harder with them. */
  _act(who) {
    if (this.value(`mood-${who}`) >= MOOD.act || this.acted.has(who)) return;
    this.acted.add(who);
    const a = AUDIENCES[who];
    const what = {
      ops: "takes no possession outside the standing windows any more that is not registered a full day ahead, and writes to the district's management",
      council: "consents to no further shift outside the rota this week, and writes to the district's management",
      town: "sends an officer with a sound meter to every night of the week, and writes to the mayor",
      safety: "orders an audit of the district's reporting",
    }[who];
    this.violate("complaint", `${when(this.now)} ${a.name} ${what}.`, 2);
    this.irregular("complaint", `complaint:${who}`, { who: a.name });
  }

  _patience(who) {
    this._call(who);
    this._act(who);
  }

  /** What the computer's district manager would decide (a decision's id → an option or a number). */
  advice(id) {
    const d = this.open.find((x) => x.id === id);
    if (!d) return null;
    if (id.startsWith("fault-")) return "slow";
    if (id.startsWith("report-")) return "now";
    if (id.startsWith("forecast-")) return Math.min(d.scale.max, d.scale.value + 0.5);
    if (id === "length-rail") return d.scale.value;
    if (id === "storm") return "keep";
    if (id.startsWith("refusal-")) return "else";
    if (id.startsWith("rest-")) return d.options.some((o) => o.id === "swap") ? "swap" : "home";
    if (id.startsWith("call-")) return "try";
    return d.fallback ?? d.options[0]?.id ?? null;
  }

  /* ---------------------------------------------------------------- what comes of it */

  /** The works council answers a request: consent, unless the shift cuts across a life that was given no time, or its patience is at its end. */
  _council() {
    const h = this.now, a = AUDIENCES.council;
    const due = this.rota.filter((x) => !x.done && x.council && x.council.ok == null && h >= x.council.due);
    if (!due.length) return;
    const no = [];
    for (const x of due) {
      const p = this.person(x.person), lead = x.start - x.council.asked;
      const against = this.blocked(p, x.start, x.start + x.len) && lead < p.notice_h;
      x.council.ok = !this.acted.has("council") && !(against && !x.ordered && this.rng("consent", x.key).next() < 0.5);
      if (!x.council.ok) no.push(x);
      if (lead < a.late_h) {
        this._mood("council", MOOD.inside_day);
        this.tally.late++;
      } else this.tally.in_time++;
    }
    const yes = due.filter((x) => x.council.ok);
    this.log(`${when(h)} ${a.name}: ${yes.length ? `"Consent: ${yes.map((x) => `${this.person(x.person).name} ${when(x.start)}`).join(", ")}."` : ""}${no.length ? ` "No consent: ${no.map((x) => `${this.person(x.person).name} ${when(x.start)} (${this.person(x.person).life.split(";")[0].split(":")[0]})`).join(", ")}."` : ""}`, no.length ? "fault" : "request");
    this._patience("council");
  }

  /** What a fault's restriction costs a train now (min): a closed track of the main line has the other track beside it, the branch has none. */
  _cost(f) {
    return f.mode === "closed" ? (f.area === "branch" ? EFFECT.closed : EFFECT.single * 1.25) : EFFECT[f.mode];
  }

  /** The trains: what every restriction costs now, and what operations make of it. */
  _traffic(dt) {
    const h = this.now, dh = hoursOf(dt);
    let lost = 0;
    const add = (area, effect, factor = 1) => (lost += trainsAt(area, h) * effect * factor * dh);
    for (const w of this.works) {
      // the rail's restriction until it is changed: 70 km/h, 40 once it runs on beyond its period
      if (w.id === "rail" && w.state !== "done") add(w.area, w.due != null && h >= w.due ? EFFECT.slow40 : EFFECT.slow70);
      if (!w.possession || w.start == null || w.state === "off") continue;
      if (w.state === "running") {
        const over = h > w.until;
        if (this.inWindow(w)) add(w.area, EFFECT.single, 0.5);
        else add(w.area, over ? EFFECT.closed : EFFECT.single, over ? 1.5 : 1);
      } else if (w.state === "done" && w.t0 != null && h < w.until && !this.inWindow(w)) {
        // (a possession longer than the work: the trains were planned round all of it; into the morning, taken out)
        add(w.area, isNight(w.start) && hourOfDay(h) >= FIRST_TRAIN && hourOfDay(h) < 12 ? EFFECT.planned : EFFECT.single, isNight(w.start) && hourOfDay(h) >= FIRST_TRAIN && hourOfDay(h) < 12 ? 1 : 0.5);
      }
    }
    for (const f of this.faults) {
      if (f.state === "done") continue;
      const fc = f.forecast;
      const k = fc?.none ? 1.25 : fc && fc.until != null && h > fc.until ? 1.5 : 1;
      if (f.mode !== "none" && f.mode !== "watch") add(f.area, this._cost(f), k);
      if (fc && fc.kept == null && fc.until != null && h > fc.until) {
        fc.kept = false;
        this._mood("ops", MOOD.forecast_missed);
        this.log(`${when(h)} ${AUDIENCES.ops.name}: "You said open by ${when(fc.until)}. The trains I sent stand in front of it."`, "fault");
        this.irregular("forecast-missed", `forecast:${f.id}`, { who: AUDIENCES.ops.name, what: f.name });
        this._patience("ops");
      }
    }
    // (a track that was said to be shut for longer than it was: the trains stay cancelled for half of what is left)
    for (const f of this.faults) {
      const fc = f.forecast;
      if (f.state === "done" && fc?.until != null && fc.kept && h < fc.until && h - f.done < (fc.until - f.done) / 2) add(f.area, f.area === "branch" ? EFFECT.closed : EFFECT.single, 0.75);
    }
    this.tally.lost_min += lost;
    const steps = Math.floor(this.tally.lost_min / MOOD.per_min);
    if (steps > this._lostMood) {
      this._mood("ops", -(steps - this._lostMood));
      this._lostMood = steps;
      this._patience("ops");
    }
  }

  /** The days: sick notes in the morning, the routine rounds in the afternoon, what is told in the morning, the welder's look. */
  _days() {
    const h = this.now, day = Math.floor((h + START_H - SHIFT.to) / 24);
    for (const f of this.faults) {
      if (f.report_at != null && h >= f.report_at && f.told.safety == null) {
        f.told.safety = h;
        f.report_at = null;
        this._report(f);
        this._patience("safety");
      }
    }
    const rail = this.work("rail");
    if (rail.look_at != null && h >= rail.look_at) {
      rail.look_at = null;
      rail.looked = true;
      rail.guess = [Math.max(RAIL.need[0], rail.need - RAIL.looked_h), Math.min(RAIL.need[1], rail.need + RAIL.looked_h)];
      this.log(`${when(h)} ${PEOPLE.find((p) => p.quals.includes("weld")).name} has looked at the rail: ${hrs(rail.guess[0])} to ${hrs(rail.guess[1])} for the change.`, "train");
      if (rail.state === "planned" && rail.start != null) this._askLength(rail);
    }
    const tamp = this.work("tamp");
    for (const who of tamp.pending ?? []) {
      // (called off: the planner and the town are told by the contractor's note; a correction each)
      delete tamp.told[who];
      this._news(who, "corrected", `${tamp.name} is off this week`, tamp.off_from - h >= AUDIENCES[who].late_h);
    }
    tamp.pending = null;
    if (day <= this._day) return;
    // the day shift is over: who made a routine round
    this._day = day;
    const d0 = day * 24 + SHIFT.from - START_H + 0.01;
    if (d0 < 0) return;
    for (const p of this.people) {
      const worked = this.onShift(p, d0) && !p.busy.some((b) => overlaps(b.from, b.to, d0, d0 + SHIFT.to - SHIFT.from) && b.to - b.from > 2);
      if (worked) {
        p.rounds++;
        this.tally.rounds++;
      }
      // (a week too hard: a sick note the next morning)
      if (p.strain >= STRAIN.sick && !(p.away_until > h) && this.rng("sick", p.id, day).next() < 0.5) {
        p.away_until = h + 15.5 + 24;
        p.away_why = "sick";
        this.log(`${when(h)} ${p.name} hands in a sick note for tomorrow.`, "fault");
        this.irregular("refusal", `sick:${p.id}:${day}`, { person: p.name, why: "a sick note after a week too hard", work: "tomorrow's shift" });
      }
    }
  }

  /** The periods: a rail or an inspection that passes its period without an application. */
  _periods() {
    const h = this.now;
    for (const w of this.works) {
      if (w.due == null || w.overdue || h < w.due || w.state === "done" || w.state === "running") continue;
      w.overdue = true;
      if (w.applied) {
        this.log(`${when(h)} ${cap(w.name)} runs on beyond its period, by ${AUDIENCES.safety.name}'s signature: ${w.id === "rail" ? "40 km/h over the rail" : "a look at the points every day"}.`, "info");
        continue;
      }
      this._mood("safety", MOOD.overdue);
      this.irregular("overdue", `overdue:${w.id}`, { work: w.name, who: AUDIENCES.safety.name });
      if (w.id === "rail") this.violate("period", `${when(h)} The rail at Talsee with its known defect is run over beyond its period, without a change and without an application: a danger to people. Its period ended ${when(w.due)}.`, 3);
      else this.violate("period", `${when(h)} ${cap(w.name)} is overdue: its period ended ${when(w.due)}, and nobody applied to run on.`, 2);
      this.give("incident-report", { what: `${w.name}: period missed`, where: AREAS[w.area].name });
      this._patience("safety");
    }
  }

  tick(dt) {
    this._faults();
    this._storm();
    this._works();
    this._council();
    this._traffic(dt);
    this._days();
    this._periods();
    for (const who of Object.keys(AUDIENCES)) this._patience(who);
    if (this.t >= this.length) {
      for (const f of this.faults) if (f.cause.dangerous && f.known && f.told.safety == null) this._unreported(f);
      for (const p of this.promises) {
        if (p.kept != null) continue;
        p.kept = true;
        this._mood(p.who, MOOD.kept);
      }
      this.end(`${when(WEEK_H)}: the week is over.`);
    }
  }

  /* ---------------------------------------------------------------- the account */

  /** The week in numbers: the works, the trains, the news, the people. */
  account() {
    const moods = Object.fromEntries(Object.keys(AUDIENCES).map((k) => [k, this.mood(k)]));
    const strain = this.people.reduce((s, p) => s + p.strain, 0) / this.people.length;
    return {
      works: this.works.length, done: this.works.filter((w) => w.state === "done").length, applied: this.works.filter((w) => w.applied && w.state !== "done").length, overdue: this.works.filter((w) => w.overdue && !w.applied).length,
      ...this.tally, lost_min: Math.round(this.tally.lost_min), cost: Math.round(this.tally.cost), moods, lowest: Math.min(...Object.values(moods)), strain: Math.round(strain), worst_strain: Math.max(...this.people.map((p) => p.strain)),
      promises: this.promises.length, broken: this.promises.filter((p) => p.kept === false).length,
    };
  }

  finish() {
    const a = this.account();
    this.give("performance-report", {
      scope: "District Neustadt, a week", kind: "maintenance", works_done: a.done, works: a.works, periods_missed: a.overdue, routine_rounds: a.rounds, train_minutes_lost: a.lost_min, news_in_time: a.in_time, news_late: a.late, news_missing: a.missing,
      news_for_nothing: a.needless, corrections: a.corrected, formal_steps: a.charges, extra_cost_eur: a.cost, patience: a.moods, strain: a.strain, violations: this.violations.length, score: this.score().total,
    });
  }

  objectives() {
    const a = this.account(), m = Object.values(a.moods), mean = m.reduce((s, v) => s + v, 0) / m.length;
    // a work: done 1; run on by an application in good time a little more than half; called off or left a quarter; its period missed nothing
    const worth = (w) => (w.state === "done" ? 1 : w.overdue && !w.applied ? 0 : w.applied ? (w.applied.late ? 0.45 : 0.6) : w.state === "running" ? 0.8 : this.over ? 0.2 : 0.5);
    const works = this.works.reduce((s, w) => s + worth(w), 0) / this.works.length;
    const news = a.in_time + a.late + a.missing;
    const names = Object.entries(AUDIENCES).map(([k, x]) => `${x.label} ${a.moods[k]}`).join(", ");
    return [
      { id: "works", label: "The week's works", weight: 25, value: 0.8 * works + 0.2 * Math.min(1, a.rounds / ROUNDS_DUE) - a.cost / 60000, note: `${a.done} of ${a.works} done${a.applied ? `, ${a.applied} running on by an application` : ""}${a.overdue ? `, ${plural(a.overdue, "period")} missed` : ""}, ${a.rounds} of ${ROUNDS_DUE} routine rounds, ${a.cost} EUR beside the plan` },
      { id: "trains", label: "Trains kept running", weight: 20, value: 1 - a.lost_min / 700, note: `${a.lost_min} train-minutes lost to works and faults` },
      { id: "news", label: "Told in time, and only who needs it", weight: 20, value: (news ? (a.in_time + 0.4 * a.late) / news : this.over ? 0 : 1) - 0.06 * a.needless - 0.05 * a.corrected - 0.1 * a.charges, note: `${a.in_time} in time, ${a.late} late, ${a.missing} missing, ${a.needless} for nothing, ${plural(a.corrected, "correction")}, ${plural(a.charges, "formal step")}` },
      // the one who is worst off counts most: a week that suits three of four is not good enough
      { id: "people", label: "The people you inform", weight: 25, value: (0.6 * a.lowest + 0.4 * mean) / 100, note: `patience of 100: ${names}` },
      { id: "team", label: "The team", weight: 10, value: 1 - (0.5 * a.strain + 0.5 * a.worst_strain) / 100 - 0.25 * a.rest_cut, note: `strain ${a.strain} of 100 on average, ${a.worst_strain} at the most${a.rest_cut ? `, rest cut ${a.rest_cut} time${a.rest_cut === 1 ? "" : "s"}` : ""}` },
    ];
  }

  /* ---------------------------------------------------------------- for a page */

  /** What is still missing for a work to begin as planned, in a few words each (empty: it is ready). */
  missing(w) {
    const out = [];
    if (w.state !== "planned") return out;
    if (w.start == null) return ["a slot"];
    const crew = w.crew.map((id) => this.person(id));
    if (crew.length < w.crew_n) out.push(`${plural(w.crew_n - crew.length, "person")}`);
    else if (w.qual && !crew.some((p) => p.quals.includes(w.qual))) out.push(w.qual === "weld" ? "a welder" : "a possession manager");
    else if (w.trade && !crew.some((p) => p.trade === w.trade)) out.push(`a ${w.trade} technician`);
    if (this.needs(w, "ops") && this.stale(w, "ops")) out.push(w.told.ops ? "the possession corrected" : "the possession");
    if (this.needs(w, "town") && this.stale(w, "town")) out.push(w.told.town ? "the town told again" : "the town");
    const mine = this.rota.filter((x) => !x.done && x.work === w.id && x.start === w.start);
    if (mine.some((x) => !x.council)) out.push("the council asked");
    else if (mine.some((x) => x.council.ok == null)) out.push("the council's answer");
    else if (mine.some((x) => x.council.ok === false)) out.push("consent");
    if (mine.some((x) => x.told == null)) out.push("the people told");
    if (mine.some((x) => x.refused && !x.ordered)) out.push("somebody who can");
    if (this.needs(w, "safety") && !w.applied) out.push("an application");
    return out;
  }

  /** What a work is doing, in a few words. */
  stateOf(w) {
    if (w.state === "done") return `done ${when(w.t1)}${w.late_by ? `, ${Math.round(w.late_by * 60)} min over` : ""}`;
    if (w.state === "off") return "off this week";
    if (w.state === "running") return `under way until about ${when(Math.max(w.t1, this.now))}`;
    const miss = this.missing(w);
    return w.start == null ? "no slot" : miss.length ? `missing: ${miss.join(", ")}` : "ready";
  }

  /** What a person is doing, in a few words. */
  doing(p) {
    const h = this.now, here = this.whereabouts(p, h), place = (k) => (k === "home" ? `home (${p.home})` : k === "base" ? "the base" : AREAS[k].name);
    if (p.away_until != null && p.away_until > h) return p.away_why === "sick" ? `off sick until ${when(p.away_until)}` : "out with the fire brigade";
    if (here.to) return `on the road to ${place(here.to)}`;
    if (p.out) return `at ${this.fault(p.out.fault).name}`;
    const w = this.works.find((x) => x.state === "running" && x.crew.includes(p.id));
    if (w) return `on ${w.name}`;
    return here.at === "base" ? "day shift" : this.onCall(p, h) ? "at home, on call" : "at home";
  }

  /** The moves a work offers in the picture: its slots, its rooms, its news. */
  _workMenu(w) {
    if (w.state !== "planned") return undefined;
    const h = this.now, out = [];
    for (const s of w.slots.filter((x) => x > h && x !== w.start).sort((a, b) => a - b)) out.push({ label: `Plan it for ${when(s)}${this.inWindow(w, s) ? " (standing window)" : isNight(s) ? " (night)" : ""}`, name: "schedule", args: [w.id, s] });
    for (const id of w.crew) out.push({ label: `Take ${this.person(id).name} off it`, name: "unassign", args: [w.id, id] });
    if (w.start != null && w.room == null && this.outside(w) && w.crew.some((id) => this.person(id).drive[w.area] > FAR_MIN)) out.push({ label: `Book a room at the site (${COST.room} EUR)`, name: "room", args: [w.id] });
    return out.length ? out : undefined;
  }

  /** The moves a person offers: onto a work, to a fault. */
  _personMenu(p) {
    const out = [], h = this.now;
    for (const f of this.faults.filter((x) => x.state !== "done" && !x.person && (!FAULTS[x.kind].trade || FAULTS[x.kind].trade === p.trade))) out.push({ label: `Send to ${f.name} (${this.driveMin(p, f.area, h)} min)`, name: "send", args: [f.id, p.id], target: `fault-${f.id}`, disabled: this.freeFor(p, h).ok ? undefined : this.freeFor(p, h).reason });
    for (const w of this.works.filter((x) => x.state === "planned" && !x.crew.includes(p.id) && x.crew.length < x.crew_n)) {
      const fit = w.start == null ? { ok: true } : this.fits(p, w);
      out.push({ label: `Put on ${w.name}${w.start == null ? "" : ` (${when(w.start)})`}`, name: "assign", args: [w.id, p.id], target: `work-${w.id}`, disabled: fit.ok ? undefined : fit.reason });
    }
    return out.length ? out : undefined;
  }

  /** The moves somebody who is told offers: what they have not heard, or not as it is planned now. */
  _audMenu(who) {
    const out = [];
    if (who === "council") {
      const n = this.rota.filter((x) => !x.done && !x.council).length;
      return n ? [{ label: `Ask for consent to ${plural(n, "shift")} outside the rota`, name: "tell", args: ["council"] }] : undefined;
    }
    if (who === "staff") {
      const untold = this.rota.filter((x) => !x.done && x.told == null), yes = untold.filter((x) => x.council?.ok).length;
      if (yes) out.push({ label: `Tell the people the ${plural(yes, "shift")} the works council consented to`, name: "tell", args: ["staff"] });
      if (untold.length > yes) out.push({ label: `Tell them ${untold.length > 1 ? `all ${untold.length} shifts` : "the shift"} now, before the works council has consented`, name: "tell", args: ["staff", "all"] });
      return out.length ? out : undefined;
    }
    for (const w of this.works.filter((x) => x.state === "planned")) {
      if (who === "safety" ? w.applied || w.told.safety : w.start == null ? !w.told[who] : w.told[who] && !this.stale(w, who)) continue;
      const verb = who === "ops" ? (w.told.ops ? "Correct the possession for" : "Register the possession for") : who === "town" ? (w.told.town ? "Correct the notice of" : "Announce") : "Apply to run on:";
      out.push({ label: `${verb} ${w.name}${w.start != null && who !== "safety" ? ` (${when(w.start)})` : ""}`, name: "tell", args: [who, w.id], target: `work-${w.id}` });
    }
    for (const f of this.faults.filter((x) => x.told[who] == null && (x.state !== "done" || (who === "safety" && x.cause.dangerous)))) out.push({ label: `${who === "safety" ? "Report" : "Tell of"} ${f.name}`, name: "tell", args: [who, `fault-${f.id}`], target: `fault-${f.id}` });
    return out.length ? out : undefined;
  }

  view() {
    const a = this.account(), h = this.now, tone = (v) => (v < MOOD.act ? "bad" : v < MOOD.call ? "warn" : "ok");
    const toldOf = (w) => ["ops", "town", "safety"].filter((k) => w.told[k]).map((k) => `${AUDIENCES[k].label} ${w.told[k].at < 0 ? "long ago" : when(w.told[k].at)}${k !== "safety" && this.stale(w, k) && w.state === "planned" ? " (for another time)" : ""}`).join("; ") || "–";
    const planned = this.works.filter((w) => w.state === "planned");
    return {
      sketch: this._sketch(),
      figures: [
        { label: "Day", value: dayOf(h) },
        { label: "Works done", value: `${a.done} of ${a.works}`, tone: a.overdue ? "bad" : "ok" },
        { label: "Train-min lost", value: a.lost_min, tone: a.lost_min > 450 ? "bad" : a.lost_min > 250 ? "warn" : "ok" },
        ...Object.entries(AUDIENCES).map(([k, x]) => ({ label: x.label, value: a.moods[k], tone: tone(a.moods[k]) })),
      ],
      tables: [
        {
          id: "works", title: "The week's works", window: true, columns: ["Work", "Where", "When", "Who", "Now"],
          rows: this.works.map((w) => [cap(w.short), AREAS[w.area].name, w.start == null ? "–" : `${when(w.start)}, ${hrs(w.len)}`, w.crew.map((id) => this.person(id).name).join(", ") || "–", this.stateOf(w)]),
        },
        {
          id: "people", title: "The people and their week", columns: ["Who", "Trade", "Lives", "Life", "Now", "Strain"],
          rows: this.people.map((p) => [p.name, `${p.trade}${p.quals.length ? ` (${p.quals.join(", ")})` : ""}`, `${p.home}: ${Object.entries(p.drive).map(([k, v]) => `${AREAS[k].name} ${v} min`).join(", ")}`, p.life, this.doing(p), `${Math.round(p.strain)} of 100`]),
        },
        {
          id: "news", title: "Who was told what", columns: ["About", "Told", "Shifts outside the rota"],
          rows: this.works.map((w) => [cap(w.short), toldOf(w), this.rota.filter((x) => x.work === w.id).map((x) => `${this.person(x.person).name} ${when(x.start)}: council ${!x.council ? "not asked" : x.council.ok == null ? "asked" : x.council.ok ? "consents" : "refuses"}, ${x.refused && !x.ordered ? "says no" : x.told == null ? "not told" : "told"}`).join("; ") || "–"]),
        },
        {
          id: "audiences", title: "The people you inform", columns: ["Who", "Counts", "Wants to hear", "Patience", "Promised"],
          rows: Object.entries(AUDIENCES).map(([k, x]) => [`${x.name}, ${x.role}`, x.counts, k === "ops" ? `a possession ${x.late_h} h ahead, a change at once` : k === "council" ? `a shift outside the rota ${x.late_h} h ahead, before the people` : k === "town" ? `a night beside houses ${x.early_h} to ${x.late_h} h ahead` : `a dangerous event within ${x.within_h} h, a period ${x.apply_h} h before it ends`, `${a.moods[k]} of 100`, this.promises.filter((p) => p.who === k).map((p) => `${p.what}: ${p.kept == null ? "open" : p.kept ? "kept" : "not kept"}`).join("; ") || "–"]),
        },
      ],
      actions: [
        {
          name: "schedule", label: "Give a work its slot", primary: true, hint: "A work has a few slots. What was announced for another time is then no longer true: whoever was told must be told again.",
          disabled: planned.length ? undefined : "No work is left to plan.",
          fields: [
            { id: "work", label: "Work", options: planned.map((w) => ({ id: w.id, label: cap(w.short) })) },
            { id: "slot", label: "Slot", options: [...new Set(planned.flatMap((w) => w.slots))].filter((s) => s > h).sort((x, y) => x - y).map((s) => ({ id: String(s), label: when(s) })) },
          ],
        },
        {
          name: "assign", label: "Put a person on a work", hint: `By trade and qualification, by rest (${SHIFT.rest_h} h between two shifts), by where they live and what their week allows.`,
          disabled: planned.length ? undefined : "No work is left to plan.",
          fields: [
            { id: "work", label: "Work", options: planned.map((w) => ({ id: w.id, label: cap(w.short) })) },
            { id: "person", label: "Person", options: this.people.map((p) => ({ id: p.id, label: `${p.name}, ${p.trade}` })) },
          ],
        },
        {
          name: "tell", label: "Tell somebody", hint: "Operations, the town and safety of a work; the works council and the people of every shift outside the rota they have not heard of.",
          fields: [
            { id: "who", label: "Whom", options: [...Object.entries(AUDIENCES).map(([k, x]) => ({ id: k, label: `${x.label}: ${x.name}` })), { id: "staff", label: "The people" }] },
            { id: "about", label: "About", options: [...planned.map((w) => ({ id: w.id, label: cap(w.short) })), ...this.faults.filter((f) => f.state !== "done").map((f) => ({ id: `fault-${f.id}`, label: cap(f.name) }))] },
          ],
        },
      ],
    };
  }

  /**
   * The district as the table shows it (no geometry: the board has that): the works with their
   * area, whether they run and what is missing; the possessions and restrictions on each area's
   * track and how many trains wait there; the faults; where every person is; how the four people
   * stand; the storm; the houses that were told of a night or lie awake.
   */
  district() {
    const h = this.now, areas = {};
    for (const k of Object.keys(AREAS)) areas[k] = { possession: null, mode: null, queue: 0, awake: false, told: false };
    for (const w of this.works) {
      const a = areas[w.area];
      if (w.possession && w.start != null && (w.state === "running" || (w.state === "done" && h < w.until))) a.possession = w.id;
      if (w.id === "rail" && w.state !== "done") a.mode ??= "slow";
      if (w.state === "planned" && w.start != null && this.needs(w, "town")) a.told = !!w.told.town && !this.stale(w, "town");
      if (w.state === "running" && this.needs(w, "town") && (!w.told.town || w.told.town.start !== w.start)) a.awake = true;
      if (w.state === "running") a.queue += (trainsAt(w.area, h) * (this.inWindow(w) ? 2 : h > w.until ? 12 : 4)) / 12;
    }
    for (const f of this.faults) {
      if (f.state === "done" || f.mode === "none" || f.mode === "watch") continue;
      const a = areas[f.area];
      a.mode = f.mode === "closed" ? "closed" : a.mode === "closed" ? "closed" : "slow";
      a.queue += (trainsAt(f.area, h) * this._cost(f)) / 12;
    }
    for (const a of Object.values(areas)) a.queue = Math.min(4, Math.round(a.queue));
    return {
      hour: h, night: isNight(h), storm: this.storm.on ? (this.storm.strong ? "strong" : "weak") : null,
      works: this.works.map((w) => ({ id: w.id, area: w.area, state: w.state, start: w.start, ready: !this.missing(w).length, night: w.start != null && isNight(w.start), people: w.state === "running" ? w.crew.length : 0, machine: w.id === "tamp" })),
      faults: this.faults.filter((f) => f.state !== "done" || h - f.done < 1.5).map((f) => ({ id: f.id, kind: f.kind, area: f.area, state: f.state, mode: f.mode, danger: !!f.cause.dangerous && f.known, attended: !!f.person && h >= f.arrive })),
      people: this.people.map((p) => ({ id: p.id, trade: p.trade, home: p.home, ...this.whereabouts(p, h), away: p.away_until != null && p.away_until > h ? p.away_why : null, strain: p.strain, on_call: this.onCall(p, h), beacon: !!p.out })),
      areas,
      moods: Object.fromEntries(Object.keys(AUDIENCES).map((k) => [k, this.mood(k)])),
    };
  }

  /**
   * The week as a sketch for a page that does not know the game: a chart of the four days with the
   * nights shaded and a line at now; a row for every work with its slot as a bar (and the
   * possession's length), a row for every person with their nights and call-outs; on the left the
   * works and people to choose, below the four people who are told and the team, each with what
   * they have not heard yet.
   */
  _sketch() {
    const W = 640, items = [], h = this.now, X0 = 176, X1 = W - 12, top = 32, row = 27;
    const x = (wh) => X0 + ((X1 - X0) * Math.max(0, Math.min(WEEK_H, wh))) / WEEK_H;
    const asked = new Set([...this.about.entries()].filter(([id]) => this.open.some((d) => d.id === id)).flatMap(([, ids]) => ids));
    const rows = this.works.length + this.people.length + (this.faults.length ? 1 : 0), bottom = top + rows * row + 6;
    // the days and their nights
    for (let d = 0; d < 4; d++) {
      items.push({ kind: "text", x: x(d * 24 + 1), y: 14, small: true, tone: "muted", text: DAYS[d] });
      items.push({ kind: "box", x: x(d * 24 + 14), y: top - 8, w: x(d * 24 + 23) - x(d * 24 + 14), h: bottom - top + 8, tone: "closed" });
    }
    items.push({ kind: "line", x1: x(h), y1: top - 10, x2: x(h), y2: bottom, tone: "route" });
    items.push({ kind: "text", x: Math.min(X1 - 60, x(h) + 4), y: bottom + 10, small: true, tone: "muted", text: when(h) });
    let y = top;
    for (const w of this.works) {
      const miss = this.missing(w), tone = w.state === "done" ? "ok" : w.state === "off" ? "muted" : w.state === "running" ? "train" : w.start == null ? "bad" : miss.length ? "warn" : "ok";
      items.push({ id: `work-${w.id}`, kind: "tag", x: 10, y: y + 4, anchor: "start", text: w.short, tone, alert: asked.has(`work-${w.id}`) ? "warn" : undefined, title: `${cap(w.name)} (${AREAS[w.area].name}): ${w.text}. ${cap(this.stateOf(w))}`, menu: this._workMenu(w) });
      if (w.start != null || w.t0 != null) {
        const s = w.t0 ?? w.start, e = w.state === "done" ? w.t1 : s + w.len;
        items.push({ kind: "box", x: x(s), y: y - 6, w: Math.max(3, x(e) - x(s)), h: 11, tone: w.state === "done" ? "ok" : w.state === "running" ? "train" : miss.length ? "warn" : "route" });
      }
      if (w.due != null && w.state !== "done") items.push({ kind: "line", x1: x(w.due), y1: y - 9, x2: x(w.due), y2: y + 8, tone: "bad" });
      items.push({ kind: "text", x: 100, y: y + 3, small: true, tone: "muted", text: w.state === "planned" && w.start != null ? (miss.length ? `${miss.length} missing` : "ready") : w.state === "planned" ? "no slot" : w.state === "running" ? "under way" : w.state });
      y += row;
    }
    for (const p of this.people) {
      const away = p.away_until != null && p.away_until > h;
      items.push({ id: `person-${p.id}`, kind: "tag", x: 10, y: y + 4, anchor: "start", text: p.name, tone: away ? "bad" : p.strain >= STRAIN.no_favour ? "warn" : p.trade === "track" ? "train" : "place", alert: asked.has(`person-${p.id}`) ? "warn" : undefined, title: `${p.name}, ${p.trade} technician${p.quals.length ? ` (${p.quals.join(", ")})` : ""}, lives at ${p.home}: ${p.life}. Now: ${this.doing(p)}. Strain ${Math.round(p.strain)} of 100`, menu: this._personMenu(p) });
      for (const [a, b] of p.no) items.push({ kind: "box", x: x(a), y: y - 7, w: Math.max(2, x(b) - x(a)), h: 3, tone: "bad" });
      for (const [a, b] of this._nights(p)) items.push({ kind: "box", x: x(a), y: y - 3, w: Math.max(3, x(b) - x(a)), h: 8, tone: "train" });
      if (p.out) items.push({ kind: "box", x: x(p.out.from), y: y - 3, w: Math.max(3, x(h) - x(p.out.from)), h: 8, tone: "warn" });
      y += row;
    }
    if (this.faults.length) {
      let fx = 10;
      for (const f of this.faults) {
        const done = f.state === "done";
        items.push({ id: `fault-${f.id}`, kind: "tag", x: fx, y: y + 4, anchor: "start", text: `${f.kind === "knock" ? "Knock" : f.kind === "points" ? "Point W2" : f.kind === "tree" ? "Tree" : f.kind === "crossing" ? "Crossing" : "Trolley"}`, tone: done ? "ok" : f.mode === "closed" || f.cause.dangerous && f.known ? "bad" : "warn", alert: !done && (asked.has(`fault-${f.id}`) || !f.person) ? (f.mode === "closed" ? "bad" : "warn") : undefined, title: `${cap(f.name)} at ${AREAS[f.area].name}, ${when(f.at)}: ${done ? `cleared ${when(f.done)}` : f.known ? f.cause.text : f.person ? `${this.person(f.person).name} is ${h < f.arrive ? "on the way" : "looking"}` : "nobody is there yet"}` });
        items.push({ kind: "box", x: x(f.at), y: y - 4, w: Math.max(3, x(done ? f.done : h) - x(f.at)), h: 8, tone: done ? "ok" : "bad" });
        fx += 82;
      }
      y += row;
    }
    // the people who are told
    y = bottom + 34;
    const each = (W - 20) / 5;
    [...Object.keys(AUDIENCES), "staff"].forEach((k, i) => {
      const a = AUDIENCES[k], menu = this._audMenu(k), mood = a ? this.mood(k) : null;
      items.push({ id: `aud-${k}`, kind: "tag", x: 10 + i * each, y, anchor: "start", text: a ? a.label : "The people", tone: mood == null ? "place" : mood < MOOD.act ? "bad" : mood < MOOD.call ? "warn" : "ok", alert: asked.has(`aud-${k}`) ? "warn" : undefined, title: a ? `${a.name}, ${a.role}: counts ${a.counts}. Patience ${mood} of 100` : `The team: told their shifts outside the rota ${STAFF.late_h} h ahead, after the works council consented`, menu });
      items.push({ kind: "text", x: 12 + i * each, y: y + 24, small: true, tone: "muted", text: `${a ? `${mood} of 100` : "the rota"}${menu ? ` · ${menu.length} to tell` : ""}` });
    });
    return {
      title: "The week", width: W, height: y + 34,
      label: "The week from Monday 06:00 to Friday 06:00 as a chart, the nights shaded and a line at now: a row for every work with its slot as a bar and a red line at its period's end, a row for every person with the hours their life forbids and their nights, the faults; below, the four people who are told and the team, each with what they have not heard yet",
      items,
    };
  }
}
