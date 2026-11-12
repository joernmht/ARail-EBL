// What a player has reached, kept in the browser: stars per mission, the ranks they add up to,
// badges, the railway terms met, the roles played, and a sheet per mission played (what was decided
// and what came of it), for the logbook. Data and plain functions only: no DOM, no storage, no
// clock; the pages keep the document (PROGRESS_KEY) and pass it in.

export const PROGRESS_FORMAT = "arail-progress/1";
/** Where the pages keep the progress in the browser. */
export const PROGRESS_KEY = "arail.game.progress";
/** The most stars of a mission, and the scores from which a passed mission gets two and three. */
export const MAX_STARS = 3;
export const STAR_SCORES = [70, 85];

/** The ranks, by the stars they need. */
export const RANKS = [
  { stars: 0, title: "Passenger" },
  { stars: 1, title: "Trainee" },
  { stars: 4, title: "Signaller" },
  { stars: 8, title: "Dispatcher" },
  { stars: 12, title: "Operations manager" },
  { stars: 17, title: "Head of the network" },
  { stars: 22, title: "Member of the board" },
  { stars: 27, title: "Minister of transport" },
];

/**
 * @typedef {object} Sheet what is kept of the last time a mission was played
 * @property {number} score
 * @property {boolean} passed
 * @property {number} stars
 * @property {string[]} roles the roles the person played (the seats that were a person's for at least half of their work)
 * @property {number} violations rules broken on the person's seats
 * @property {boolean} danger a danger to people among them
 * @property {Array<{who: string, title: string, chose: string, round: number}>} decisions
 * @property {string[]} terms the glossary terms met (their ids)
 *
 * @typedef {object} Progress
 * @property {string} format
 * @property {Record<string, {best: number, stars: number, plays: number, passed: boolean}>} missions
 * @property {Record<string, Sheet>} sheets
 * @property {string[]} terms every glossary term met
 * @property {string[]} roles every role sat in
 * @property {number} clean missions passed without a rule broken
 * @property {number} dangers sessions with a danger to people
 */

/** @returns {Progress} */
export function emptyProgress() {
  return { format: PROGRESS_FORMAT, missions: {}, sheets: {}, terms: [], roles: [], clean: 0, dangers: 0 };
}

/**
 * A progress document as it must be: what is missing or of another format is empty, and every
 * mission and sheet in it has all its parts (a damaged one, written by hand or by an older page,
 * breaks nothing).
 * @param {unknown} doc
 * @returns {Progress}
 */
export function readProgress(doc) {
  const e = emptyProgress();
  if (!doc || typeof doc !== "object" || doc.format !== PROGRESS_FORMAT) return e;
  const texts = (list) => (Array.isArray(list) ? list.filter((t) => typeof t === "string") : []);
  const entries = (o) => (o && typeof o === "object" && !Array.isArray(o) ? Object.entries(o).filter(([, v]) => v && typeof v === "object" && !Array.isArray(v)) : []);
  const stars = (n) => Math.max(0, Math.min(MAX_STARS, Math.round(Number(n)) || 0));
  return {
    ...e,
    // every entry as it must be, so that one that is damaged (written by hand, or by an older page) breaks nothing
    missions: Object.fromEntries(entries(doc.missions).map(([id, m]) => [id, { best: Number(m.best) || 0, stars: stars(m.stars), plays: Math.max(1, Math.round(Number(m.plays)) || 1), passed: !!m.passed }])),
    sheets: Object.fromEntries(entries(doc.sheets).map(([id, sh]) => [id, {
      score: Number(sh.score) || 0, passed: !!sh.passed, stars: stars(sh.stars), roles: texts(sh.roles), violations: Math.max(0, Number(sh.violations) || 0), danger: !!sh.danger,
      decisions: (Array.isArray(sh.decisions) ? sh.decisions : []).filter((d) => d && typeof d.title === "string" && typeof d.chose === "string")
        .map((d) => ({ who: typeof d.who === "string" ? d.who : "", title: d.title, chose: d.chose, round: Math.max(1, Math.round(Number(d.round)) || 1) })),
      terms: texts(sh.terms),
    }])),
    terms: texts(doc.terms),
    roles: texts(doc.roles),
    clean: Math.max(0, Number(doc.clean) || 0),
    dangers: Math.max(0, Number(doc.dangers) || 0),
  };
}

/**
 * The stars of a round: none when it is not passed, else one, two from 70 points, three from 85.
 * @param {number} score 0–100
 * @param {boolean} passed
 */
export function starsFor(score, passed) {
  if (!passed) return 0;
  return 1 + STAR_SCORES.filter((s) => score >= s).length;
}

/**
 * The progress after a mission was played (the document passed in is not changed). The best
 * score and the most stars of a mission are kept; its sheet is that of the last time.
 * @param {Progress} progress
 * @param {{mission: string, score: number, passed: boolean, roles?: string[], violations?: number, danger?: boolean, decisions?: Sheet["decisions"], terms?: string[]}} played
 * @returns {Progress}
 */
export function record(progress, played) {
  const p = structuredClone(readProgress(progress)), stars = starsFor(played.score, played.passed);
  const was = p.missions[played.mission] ?? { best: 0, stars: 0, plays: 0, passed: false };
  p.missions[played.mission] = { best: Math.max(was.best, played.score), stars: Math.max(was.stars, stars), plays: was.plays + 1, passed: was.passed || played.passed };
  const roles = played.roles ?? [], terms = played.terms ?? [];
  p.sheets[played.mission] = {
    score: played.score, passed: played.passed, stars, roles, violations: played.violations ?? 0, danger: !!played.danger,
    decisions: (played.decisions ?? []).slice(0, 200), terms,
  };
  p.roles = [...new Set([...p.roles, ...roles])];
  p.terms = [...new Set([...p.terms, ...terms])];
  if (played.passed && !(played.violations > 0)) p.clean += 1;
  if (played.danger) p.dangers += 1;
  return p;
}

/**
 * The progress with glossary terms met (the document passed in is not changed; with nothing new it
 * is returned as it is).
 * @param {Progress} progress
 * @param {string[]} terms
 */
export function meet(progress, terms) {
  const p = readProgress(progress), all = [...new Set([...p.terms, ...terms])];
  // nothing new: the document as it was passed in
  return all.length === p.terms.length && progress?.format === PROGRESS_FORMAT ? progress : { ...p, terms: all };
}

/** The stars of all missions. */
export function totalStars(progress) {
  return Object.values(readProgress(progress).missions).reduce((n, m) => n + (m.stars || 0), 0);
}

/**
 * The rank the stars add up to, and what the next one needs.
 * @param {number} stars
 * @returns {{title: string, index: number, next: string | null, need: number}}
 */
export function rankOf(stars) {
  let i = 0;
  while (i + 1 < RANKS.length && stars >= RANKS[i + 1].stars) i++;
  const next = RANKS[i + 1] ?? null;
  return { title: RANKS[i].title, index: i, next: next?.title ?? null, need: next ? next.stars - stars : 0 };
}

/**
 * The badges: what they are called, how they are earned, and whether a progress has earned them.
 * `missions` are the ids of all missions there are.
 * @type {Array<{id: string, title: string, how: string, earned: (p: Progress, missions: string[]) => boolean}>}
 */
export const BADGES = [
  { id: "first-shift", title: "First shift", how: "Play a mission to its end.", earned: (p) => Object.keys(p.missions).length > 0 },
  { id: "passed", title: "Signed off", how: "Pass a mission.", earned: (p) => Object.values(p.missions).some((m) => m.passed) },
  { id: "three-stars", title: "Three stars", how: "Pass a mission with 85 points or more.", earned: (p) => Object.values(p.missions).some((m) => m.stars >= 3) },
  { id: "clean-sheet", title: "By the book", how: "Pass a mission without breaking a rule.", earned: (p) => p.clean > 0 },
  { id: "many-hats", title: "Many hats", how: "Sit in four different roles.", earned: (p) => p.roles.length >= 4 },
  { id: "word-collector", title: "Speaks railway", how: "Meet ten railway terms.", earned: (p) => p.terms.length >= 10 },
  { id: "night-owl", title: "Night owl", how: "Pass The Night Session.", earned: (p) => !!p.missions["night-session"]?.passed },
  { id: "full-house", title: "Full house", how: "Pass Three years of Neustadt.", earned: (p) => !!p.missions["neustadt-years"]?.passed },
  { id: "all-aboard", title: "All aboard", how: "Play every mission.", earned: (p, missions) => missions.length > 0 && missions.every((id) => p.missions[id]) },
  { id: "perfectionist", title: "Perfectionist", how: "Three stars in every mission.", earned: (p, missions) => missions.length > 0 && missions.every((id) => p.missions[id]?.stars >= 3) },
  { id: "investigation", title: "The authority would like a word", how: "End a mission with a danger to people. Not a badge to be proud of.", earned: (p) => p.dangers > 0 },
];

/**
 * The badges a progress has earned (their ids).
 * @param {Progress} progress
 * @param {string[]} [missions] the ids of all missions
 */
export function badgesOf(progress, missions = []) {
  const p = readProgress(progress);
  return BADGES.filter((b) => b.earned(p, missions)).map((b) => b.id);
}

/**
 * The mission to play next: the first of the list that is not passed yet, else the first.
 * @param {Progress} progress
 * @param {string[]} missions the ids in their order
 */
export function nextMission(progress, missions) {
  const p = readProgress(progress);
  return missions.find((id) => !p.missions[id]?.passed) ?? missions[0] ?? null;
}
