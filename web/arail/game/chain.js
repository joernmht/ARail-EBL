/**
 * What led to what: the story of each fault of a shift, read from the flows the roles gave each
 * other. A fault report, the steps of the repair (a team sent, there, the cause found, at work,
 * done, left, failed again) and the closures name their fault; in the order they passed they are
 * its thread. Between two steps time went by, and somebody or something was waited for: the
 * signaller to report or to close the track, the dispatcher to send a team or to say what to do,
 * the road, the work itself. The thread says for every stretch of the time out of order whose it
 * was, what the teams were doing meanwhile, and what the outage did in the games' own worlds (the
 * effects their accounts name). It knows no game: only the flows and their payloads.
 * @module arail/game/chain
 */

/**
 * The stretches of a fault's time: what was waited for, and whose the time was (`reporter`: who gave the fault
 * report; `dispatcher`: who gives the repair status; `signaller`: who gives the track closure; `road` and `team`:
 * nobody's decision; `held`: a repair that held for a while, no outage).
 */
export const STRETCHES = {
  unreported: { text: "until it was reported", by: "reporter" },
  unsent: { text: "until a team was sent", by: "dispatcher" },
  road: { text: "on the road", by: "road" },
  unasked: { text: "until the closure was asked for", by: "dispatcher" },
  unclosed: { text: "until the track was closed", by: "signaller" },
  finding: { text: "finding the cause", by: "team" },
  undecided: { text: "until the word on what to do", by: "dispatcher" },
  repair: { text: "the repair", by: "team" },
  unopened: { text: "until the track was opened again", by: "signaller" },
  held: { text: "the repair held", by: null },
};
/** Stretches shorter than this are left out (s). */
const SHORT_S = 5;

/** A flow as a step of a fault's story, or null. */
function stepOf(line) {
  const p = line.payload ?? {};
  if (p.fault == null) return null;
  if (line.flow === "fault-report") return "reported";
  if (line.flow === "repair-status") return typeof p.state === "string" ? p.state : null;
  if (line.flow === "closure-request") return "asked";
  if (line.flow === "track-closure") return p.closed ? "closed" : "opened";
  return null;
}

/**
 * What a fault waits for now, by where its repair stands (the last step of the repair: reported, a team sent,
 * there, the cause found, at work, done, left, secured, failed again) and its track (closed or not, the closure
 * asked for or not).
 */
function waiting(th) {
  const s = th.stage;
  if (s === "reported" || s === "relapsed" || s === "left" || s === "secured") return "unsent";
  if (s === "dispatched") return "road";
  if (s === "arrived") return th.track && !th.closed ? (th.asked ? "unclosed" : "unasked") : th.known ? "undecided" : "finding";
  if (s === "diagnosed") return "undecided";
  if (s === "working") return "repair";
  if (s === "done") return th.closed ? "unopened" : "held";
  return "held";
}

/**
 * The threads of the faults in a list of flows (a session's `flows`).
 * @param {object[]} flows the lines of a session: `{phase, round, t, flow, seat, to, payload}`
 * @param {{endOf?: (phase: number) => number}} [options] when each phase ended (s), for what was still open
 * @returns {Array<{fault: string, asset: string, place: string | null, track: string | null, round: number, phase: number, from: number, to: number, state: "repaired" | "provisional" | "open", relapses: number, steps: object[], stretches: object[], out_s: number, by: object, effects: string[]}>}
 */
export function threads(flows, { endOf = null } = {}) {
  const by = new Map(), before = new Map();
  for (const line of flows) {
    const kind = stepOf(line), p = line.payload ?? {};
    // what a game says a fault did in its world (its account of the shift)
    if (line.flow === "performance-report") {
      for (const e of p.effects ?? []) by.get(`${line.phase}|${e.fault}`)?.effects.push(e.text);
      continue;
    }
    if (!kind) continue;
    const key = `${line.phase}|${p.fault}`, closure = line.flow === "track-closure" || line.flow === "closure-request";
    let th = by.get(key);
    // a closure of another track is not this fault's, whatever it is tagged with
    if (th && closure && th.track && p.track && p.track !== th.track) continue;
    // nor one after the repair was done and the track opened again: it is closed for another reason
    if (th && closure && th.released) continue;
    if (!th && closure) {
      // closed before the fault was reported or a team sent: the thread begins with that, the track as it is then
      if (line.flow === "track-closure") before.set(key, { track: p.track ?? null, closed: !!p.closed });
      continue;
    }
    if (!th) {
      th = {
        fault: p.fault, asset: p.asset ?? String(p.fault), place: p.place ?? null, track: null, round: line.round, phase: line.phase, from: line.t - (p.since_s ?? 0), to: line.t,
        state: "open", relapses: 0, steps: [], stretches: [], out_s: 0, by: {}, effects: [],
        roles: { reporter: null, dispatcher: null, signaller: null }, stage: null, closed: false, asked: false, known: false, provisional: false, released: false, now: null,
      };
      by.set(key, th);
      const was = before.get(key);
      if (was && (!p.track || !was.track || was.track === p.track)) th.closed = was.closed;
    }
    if (p.track && !th.track) th.track = p.track;
    if (line.flow === "fault-report") Object.assign(th.roles, { reporter: line.seat, dispatcher: th.roles.dispatcher ?? line.to?.[0] ?? null });
    else if (line.flow === "repair-status" || line.flow === "closure-request") th.roles.dispatcher = line.seat;
    else if (line.flow === "track-closure") th.roles.signaller = line.seat;
    // what was waited for until this step
    const was = th.now;
    if (!was) {
      // the time before the first step: from the failure to its report, or from the report to the first team
      if (p.since_s > 0) stretch(th, th.from, line.t, kind === "reported" ? "unreported" : "unsent");
    }
    // the step: where the repair stands now, and the track
    if (kind === "closed") th.closed = true;
    else if (kind === "opened") {
      th.closed = false;
      // repaired, and the track given back: what is closed from now on is not this fault's (until it fails again)
      th.released = th.stage === "done";
    } else if (kind === "asked") th.asked = !th.closed;
    else {
      th.stage = kind;
      if (kind === "arrived") th.asked = false;
      else if (kind === "diagnosed") th.known = true;
      else if (kind === "relapsed") th.relapses += 1;
      if (kind !== "done") th.released = false;
      if (kind === "done") th.state = p.provisional ? "provisional" : "repaired";
      else if (kind === "relapsed") th.state = "open";
    }
    const next = waiting(th);
    if (was && (next !== was.kind || kind === "diagnosed" || kind === "working")) {
      // the looking for the cause took its own time, at the end of the wait before it
      const own = kind === "diagnosed" && p.since_s > 0 && was.kind !== "finding" ? Math.min(p.since_s, line.t - was.from) : 0;
      // a track closed without being asked for: the signaller knew of the team, the time was theirs
      stretch(th, was.from, line.t - own, was.kind === "unasked" && kind === "closed" ? "unclosed" : was.kind);
      if (own) stretch(th, line.t - own, line.t, "finding");
    }
    if (kind === "working") th.provisional = !!p.provisional;
    if (!was || next !== was.kind || kind === "diagnosed" || kind === "working") th.now = { kind: next, from: line.t };
    th.steps.push({ t: line.t, kind, flow: line.flow, seat: line.seat, team: p.team ?? null, cause: p.cause ?? null, provisional: !!p.provisional });
    th.to = line.t;
  }
  const list = [...by.values()].sort((a, b) => a.phase - b.phase || a.from - b.from);
  for (const th of list) {
    // what was still open when the phase ended
    const end = endOf?.(th.phase) ?? th.to;
    if (th.now && end > th.now.from) {
      if (th.now.kind !== "held") stretch(th, th.now.from, end, th.now.kind, true);
      th.to = Math.max(th.to, end);
    }
    for (const s of th.stretches) {
      if (s.kind === "held") continue;
      th.out_s += s.to - s.from;
      const who = s.by ?? "others";
      th.by[who] = (th.by[who] ?? 0) + s.to - s.from;
    }
    for (const k of ["stage", "closed", "asked", "known", "provisional", "released", "now"]) delete th[k];
  }
  // while a fault waited for a team: where the teams were
  const busy = list.flatMap((th) => engagements(th));
  for (const th of list) {
    for (const s of th.stretches) {
      if (s.kind !== "unsent") continue;
      s.meanwhile = busy.filter((b) => b.phase === th.phase && b.fault !== th.fault && b.from < s.to - SHORT_S && b.to > s.from + SHORT_S).map((b) => ({ team: b.team, asset: b.asset }));
    }
  }
  return list;
}

/** A stretch of a thread's time, unless it is too short to tell; `open`: it went on to the end of the phase. */
function stretch(th, from, to, kind, open = false) {
  if (to - from < SHORT_S) return;
  const role = STRETCHES[kind].by;
  const who = role === "road" || role === "team" ? role : role ? th.roles[role] ?? "others" : null;
  const last = th.stretches.at(-1);
  const provisional = kind === "repair" && th.provisional;
  // the same wait goes on (a step in between did not end it)
  if (last && last.kind === kind && last.by === who && last.provisional === provisional && Math.abs(last.to - from) < 1e-6) {
    last.to = to;
    last.open = open;
    return;
  }
  th.stretches.push({ from, to, kind, text: STRETCHES[kind].text, by: who, open, provisional });
}

/** When each team was bound by a thread's fault: from being sent until it was done there or left; one that secures the place, until the repair begins. */
function engagements(th) {
  const out = [];
  let on = null, guard = null;
  for (const s of th.steps) {
    if (s.kind === "dispatched" && s.team) {
      on = { phase: th.phase, fault: th.fault, asset: th.asset, team: s.team, from: s.t, to: th.to };
      out.push(on);
    } else if (s.kind === "secured" && on) {
      guard = on;
      on = null;
    } else if (s.kind === "working" && guard) {
      guard.to = s.t;
      guard = null;
    } else if ((s.kind === "done" || s.kind === "left") && on) {
      on.to = s.t;
      on = null;
    }
  }
  return out;
}
