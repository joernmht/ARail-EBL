/**
 * Missions as data (issue #105): which roles are seated and who plays them, the phases of a round
 * and how many rounds, what the mission itself gives (conditions that hold, injects at a time), a
 * briefing and questions for the debrief. A mission is a JSON document (format "arail-mission/1",
 * web/game/missions/); a session (session.js) plays it.
 *
 * ```json
 * { "format": "arail-mission/1", "id": "neustadt-morning", "title": "…", "hook": "…", "place": "signal-box", "text": "…", "seed": 1,
 *   "roles": [ { "role": "signaller-relay", "game": "signaller", "seat": "human", "level": "normal" },
 *              { "role": "maintenance-dispatcher", "game": "maintenance", "seat": "computer" } ],
 *   "rounds": 1,
 *   "phases": [ { "id": "shift", "kind": "shift", "title": "A morning at Bf Neustadt", "roles": ["signaller-relay", "maintenance-dispatcher"], "length": 2400, "clock": "08:00" } ],
 *   "conditions": { "staff-plan": { "teams": 2 } },
 *   "injects": [ { "phase": "shift", "at": 600, "flow": "fault-report", "payload": { … } } ],
 *   "story": [ { "phase": "shift", "at": 2, "who": { "name": "R. Dohle", "role": "Train dispatcher" }, "say": "…" } ],
 *   "debrief": [ "…?" ] }
 * ```
 *
 * The `hook` is the mission in one or two lines, at most HOOK_CHARS characters: what a card shows
 * of it (the `text` is its briefing, read when asked for). The `place` names where it is played, on
 * the layout (kebab-case; the page has the places with their photos, and checks the name against
 * them). Both may be left out.
 *
 * The `story` is what people say to the players: lines at a moment of a phase (`at` seconds into a
 * shift; in a turn, at its beginning, in their order), each by `who` says it (a name, a role, the
 * kind of portrait; left out: whoever the page has for the seat's game), to the `seats` named or to
 * everybody, in the `rounds` named or in all. It tells and teaches; it changes nothing in a game.
 *
 * A seat's `id` is its role unless given (two seats of one role need ids). A phase is a `turn` (the
 * slow roles decide, no clock) or a `shift` (the fast roles work at the same time for `length`
 * seconds, in ticks of `tick` seconds). Without `phases`, a mission gets a plan turn, a shift and a
 * review turn, as far as it has roles for them.
 * @module arail/game/mission
 */
import { flowOf, playedIn } from "./flows.js";
import { SEATS, Session } from "./session.js";

export const MISSION_FORMAT = "arail-mission/1";
/** How a mission is meant to be played: one role alone, the roles with each other, or against each other. */
export const MISSION_MODES = ["solo", "cooperative", "competitive"];
/** The tick of a shift (s) where a mission gives none. */
export const TICK_S = 0.5;
/** The length of a shift (s) where a mission gives none. */
export const SHIFT_S = 2400;

/** The most characters of a mission's hook: one or two lines of a card. */
export const HOOK_CHARS = 110;

/** The most characters of a line of a mission's story. */
export const SAY_CHARS = 220;

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * A mission with its defaults filled in (the document is not changed).
 * @param {object} doc
 * @param {Map<string, Function>} [games] the game classes, to sort roles into turns and shifts when the mission names no phases
 */
export function normalizeMission(doc, games = null) {
  const m = structuredClone(doc ?? {});
  m.seed ??= 1;
  m.rounds ??= 1;
  m.year ??= 2027;
  m.mode ??= (m.roles?.length ?? 0) > 1 ? "cooperative" : "solo";
  m.roles = (m.roles ?? []).map((r) => ({ seat: "computer", level: "normal", ...r, id: r.id ?? r.role }));
  if (!m.phases?.length) {
    const kind = (r) => playedIn(games?.get(r.game)?.scale ?? "minutes");
    const slow = m.roles.filter((r) => kind(r) === "turn").map((r) => r.id), fast = m.roles.filter((r) => kind(r) === "shift").map((r) => r.id);
    m.phases = [];
    if (slow.length) m.phases.push({ id: "plan", kind: "turn", title: "The plan", roles: slow });
    if (fast.length) m.phases.push({ id: "shift", kind: "shift", title: "The shift", roles: fast });
    if (slow.length) m.phases.push({ id: "review", kind: "turn", title: "The account", roles: slow });
  }
  m.phases = m.phases.map((p) => ({ title: p.id, ...p, roles: p.roles ?? [], ...(p.kind === "shift" ? { length: p.length ?? SHIFT_S, tick: p.tick ?? TICK_S, clock: p.clock ?? "08:00" } : {}) }));
  m.conditions ??= {};
  m.injects ??= [];
  m.story ??= [];
  m.debrief ??= [];
  return m;
}

/**
 * Where each port of each seat is connected in a mission: to other seats, to the mission (a
 * condition or an inject), or to nothing (the game plays that end itself).
 * @returns {Array<{seat: string, role: string, flow: string, dir: "takes" | "gives", seats: string[], mission: boolean}>}
 */
export function wiring(mission, games) {
  const m = normalizeMission(mission, games);
  const s = new Session(m, { games });
  const out = [];
  for (const seat of s.seats.values()) {
    for (const tk of seat.Game.takes) {
      const from = [...s.seats.values()].filter((o) => o !== seat && o.Game.gives.some((g) => g.flow === tk.flow && (!tk.from || tk.from.includes(o.role)) && (!g.to || g.to.includes(seat.role))));
      const byMission = m.conditions[tk.flow] !== undefined || m.injects.some((i) => i.flow === tk.flow && (!i.to || i.to.includes(seat.role) || i.to.includes(seat.id)));
      out.push({ seat: seat.id, role: seat.role, flow: tk.flow, dir: "takes", seats: from.map((o) => o.id), mission: byMission });
    }
    for (const g of seat.Game.gives) {
      const to = [...s.seats.values()].filter((o) => o !== seat && o.Game.takes.some((tk) => tk.flow === g.flow && (!tk.from || tk.from.includes(seat.role)) && (!g.to || g.to.includes(o.role))));
      out.push({ seat: seat.id, role: seat.role, flow: g.flow, dir: "gives", seats: to.map((o) => o.id), mission: false });
    }
  }
  return out;
}

/**
 * Problems of a mission (empty when it is sound): its format and texts, seats with a known game of
 * their role, phases that fit the games' rhythms and seat every role, conditions and injects of
 * flows that a seated game takes, a story whose lines can be said.
 * @param {object} doc
 * @param {Map<string, Function>} games
 * @param {{places?: string[] | null}} [options] places: the places a page has pictures of; with them, a mission's `place` must be one of them
 * @returns {string[]}
 */
export function validateMission(doc, games, { places = null } = {}) {
  const out = [];
  if (doc?.format !== MISSION_FORMAT) out.push(`format must be "${MISSION_FORMAT}"`);
  if (!KEBAB.test(doc?.id ?? "")) out.push("id must be kebab-case");
  for (const k of ["title", "text"]) if (typeof doc?.[k] !== "string" || !doc[k].trim()) out.push(`${k} is missing`);
  if (doc?.hook != null && (typeof doc.hook !== "string" || !doc.hook.trim() || doc.hook.length > HOOK_CHARS)) out.push(`hook must be a line or two of at most ${HOOK_CHARS} characters`);
  if (doc?.place != null && !KEBAB.test(doc.place)) out.push("place must be kebab-case");
  else if (doc?.place != null && places && !places.includes(doc.place)) out.push(`place: there is no place "${doc.place}" (there are: ${places.join(", ")})`);
  if (doc?.mode != null && !MISSION_MODES.includes(doc.mode)) out.push(`mode must be one of ${MISSION_MODES.join(", ")}`);
  if (doc?.rounds != null && !(Number.isInteger(doc.rounds) && doc.rounds >= 1)) out.push("rounds must be a whole number, 1 or more");
  if (!Array.isArray(doc?.roles) || !doc.roles.length) return [...out, "roles: a mission seats at least one role"];
  const m = normalizeMission(doc, games);
  const seats = new Map();
  for (const r of m.roles) {
    const at = `seat ${r.id ?? "?"}`;
    if (seats.has(r.id)) out.push(`${at}: the id is used twice (two seats of one role need ids)`);
    seats.set(r.id, r);
    const G = games.get(r.game);
    if (!G) {
      out.push(`${at}: there is no game "${r.game}"`);
      continue;
    }
    if (G.role !== r.role) out.push(`${at}: the game "${r.game}" is the game of ${G.role}, not of ${r.role}`);
    if (!SEATS.includes(r.seat)) out.push(`${at}: seat must be one of ${SEATS.join(", ")}`);
  }
  const ids = new Set(), played = new Set();
  for (const p of m.phases) {
    const at = `phase ${p.id ?? "?"}`;
    if (!KEBAB.test(p.id ?? "")) out.push(`${at}: the id must be kebab-case`);
    if (ids.has(p.id)) out.push(`${at}: the id is used twice`);
    ids.add(p.id);
    if (p.kind !== "turn" && p.kind !== "shift") out.push(`${at}: kind must be turn or shift`);
    if (!p.roles.length) out.push(`${at}: no roles`);
    if (p.kind === "shift" && !(p.length > 0 && p.tick > 0)) out.push(`${at}: a shift needs a length and a tick of more than 0 s`);
    if (p.rounds && !(Array.isArray(p.rounds) && p.rounds.every((n) => Number.isInteger(n) && n >= 1 && n <= m.rounds))) out.push(`${at}: rounds must be a list of rounds of the mission`);
    for (const id of p.roles) {
      const r = seats.get(id), G = r && games.get(r.game);
      if (!r) out.push(`${at}: no seat "${id}"`);
      else if (G && playedIn(G.scale) !== p.kind) out.push(`${at}: ${id} decides in ${G.scale} and is played in a ${playedIn(G.scale)}, not in a ${p.kind}`);
      else if (G?.clock && p.kind === "shift" && (p.clock ?? "08:00") !== G.clock) out.push(`${at}: the shift begins at ${p.clock}, but ${id}'s game ("${G.id}") begins at ${G.clock}`);
      played.add(id);
    }
  }
  for (const id of seats.keys()) if (!played.has(id)) out.push(`seat ${id}: in no phase`);
  const takers = (flow) => m.roles.filter((r) => games.get(r.game)?.takes.some((t) => t.flow === flow));
  for (const [flow, payload] of Object.entries(m.conditions)) {
    if (!flowOf(flow)) out.push(`conditions: there is no flow "${flow}"`);
    else if (flowOf(flow).kind !== "state") out.push(`conditions: "${flow}" is an event; a condition is a state flow (give events as injects)`);
    else if (!takers(flow).length) out.push(`conditions: no seated game takes "${flow}"`);
    if (payload == null || typeof payload !== "object") out.push(`conditions: "${flow}" needs an object`);
  }
  m.injects.forEach((inj, i) => {
    const at = `inject ${i + 1}`;
    if (!flowOf(inj.flow)) out.push(`${at}: there is no flow "${inj.flow}"`);
    else if (!takers(inj.flow).length) out.push(`${at}: no seated game takes "${inj.flow}"`);
    if (!ids.has(inj.phase)) out.push(`${at}: no phase "${inj.phase}"`);
    if (inj.at != null && !(inj.at >= 0)) out.push(`${at}: at must be 0 s or more`);
    for (const id of inj.to ?? []) if (!seats.has(id) && !m.roles.some((r) => r.role === id)) out.push(`${at}: to names "${id}", which is not seated`);
  });
  if (!Array.isArray(m.story)) out.push("story must be a list of lines");
  else m.story.forEach((line, i) => {
    const at = `story ${i + 1}`;
    if (!ids.has(line?.phase)) out.push(`${at}: no phase "${line?.phase}"`);
    if (typeof line?.say !== "string" || !line.say.trim() || line.say.length > SAY_CHARS) out.push(`${at}: say must be a line of at most ${SAY_CHARS} characters`);
    if (line?.at != null && !(line.at >= 0)) out.push(`${at}: at must be 0 s or more`);
    if (line?.who != null && (typeof line.who.name !== "string" || !line.who.name.trim())) out.push(`${at}: who needs a name`);
    if (line?.rounds != null && !(Array.isArray(line.rounds) && line.rounds.every((n) => Number.isInteger(n) && n >= 1 && n <= m.rounds))) out.push(`${at}: rounds must be a list of rounds of the mission`);
    if (line?.seats != null && !Array.isArray(line.seats)) out.push(`${at}: seats must be a list of seats`);
    else for (const id of line?.seats ?? []) if (!seats.has(id)) out.push(`${at}: seats names "${id}", which is not seated`);
  });
  if (!Array.isArray(m.debrief) || m.debrief.some((q) => typeof q !== "string")) out.push("debrief must be a list of questions");
  return out;
}

/**
 * The lines of a mission's story for a phase of a round, in the order they are said (by `at`, then
 * as written), each with its place in the story (`index`).
 * @param {object} mission a mission with its defaults (normalizeMission)
 * @param {string} phase a phase's id
 * @param {number} round
 * @returns {Array<{index: number, phase: string, at: number, say: string, who?: object, seats?: string[]}>}
 */
export function storyOf(mission, phase, round) {
  return (mission.story ?? [])
    .map((line, index) => ({ ...line, at: line.at ?? 0, index }))
    .filter((line) => line.phase === phase && (!line.rounds || line.rounds.includes(round)))
    .sort((a, b) => a.at - b.at || a.index - b.index);
}

/**
 * The line of a phase's story that is said to a seat now, or null. Only lines for this seat count
 * (those that name no seats are for everybody), and those not heard yet. In a turn it is the first
 * of them; in a shift (`t`, seconds into it) the latest one that is due.
 * @param {ReturnType<typeof storyOf>} lines a phase's lines (storyOf)
 * @param {string} seat a seat's id
 * @param {Set<number>} heard the lines answered (their `index`)
 * @param {number | null} [t] seconds into a shift; null: a turn
 */
export function lineFor(lines, seat, heard, t = null) {
  const mine = lines.filter((l) => !l.seats || l.seats.includes(seat));
  if (t == null) return mine.find((l) => !heard.has(l.index)) ?? null;
  const last = mine.filter((l) => l.at <= t).at(-1);
  return last && !heard.has(last.index) ? last : null;
}

/**
 * The lines that count as heard once a line is answered at a seat: the line itself and, in a shift,
 * the earlier lines for that seat, which it took the place of. Lines for other seats stay.
 * @param {ReturnType<typeof storyOf>} lines a phase's lines (storyOf)
 * @param {string} seat a seat's id
 * @param {{index: number}} line the line answered
 * @param {number | null} [t] seconds into a shift; null: a turn
 * @returns {number[]} their `index`
 */
export function heardWith(lines, seat, line, t = null) {
  if (t == null) return [line.index];
  const mine = lines.filter((l) => !l.seats || l.seats.includes(seat));
  const at = mine.findIndex((l) => l.index === line.index);
  return at < 0 ? [line.index] : mine.slice(0, at + 1).map((l) => l.index);
}

/**
 * Play a mission with computer players on every seat: its test run. A mission is sound when the
 * run ends, and winnable when the computer passes it.
 * @param {object} doc
 * @param {Map<string, Function>} games
 * @param {{seed?: number}} [options]
 * @returns {{session: Session, result: object}}
 */
export function testRun(doc, games, { seed = null } = {}) {
  const m = normalizeMission(doc, games);
  const session = new Session(m, { games, seed, seats: Object.fromEntries(m.roles.map((r) => [r.id, "computer"])) });
  session.run();
  return { session, result: session.result() };
}
