/**
 * The role catalogue: every role of the railway system, from the politician to the cleaning staff,
 * with what a game of it needs (docs/roles.md). The data is web/game/roles/roles.json (format
 * "arail-roles/2"), loaded where it is needed: the roles page, the docs generator, the tests and the
 * career mode (career.js). This module checks it and reads its typical moves as a graph.
 *
 * Format "arail-roles/1" has the roles without their careers (no qualifications, no access).
 *
 * A role: `id`, `name`, `name_de`, `family`, `organisation`, `setting` (operational, field, office,
 * mixed), `summary`, `decisions`, `effects`, `resources`, `limits`, `risks`, `career` (`entry` in
 * words, the typical moves `from` and `to`, `chances`), `access` (how one gets in: `job`, `selection`,
 * `age_min`, `fitness`, `routes` of qualifications and experience, `gains`; see career.js), `kpis`,
 * `timescale`, `interacts`, `game` (`title`, `kind`, `loop`, `win`, `knowledge`, `arail`, `bigGame`,
 * `effort`, and `page` where it can be played). The catalogue's `qualifications`: school
 * certificates, apprenticeships, degrees, trainings, licences, certificates and exams, each with
 * `kind`, `months`, `requires` (alternatives of sets), `while_working`, `provider`, `note`.
 * @module arail/game/roles
 */
import { QUALIFICATION_KINDS, SELECTIONS } from "./career.js";

/** Where a role works. */
export const ROLE_SETTINGS = ["operational", "field", "office", "mixed"];
/** How much it takes to build a role's game on ARail. */
export const GAME_EFFORTS = ["small", "medium", "large"];

const LISTS = ["decisions", "effects", "resources", "limits", "risks", "kpis"];
const TEXTS = ["id", "name", "name_de", "family", "organisation", "summary", "timescale"];

/**
 * Problems of a catalogue (empty when it is sound): unique ids, known families and settings, every
 * field filled, career paths and interactions naming roles of the catalogue.
 * @param {{format?: string, families: Array<{id: string, name: string}>, roles: object[]}} cat
 * @returns {string[]}
 */
export function validateRoles(cat) {
  const out = [];
  // format 1: roles without careers (no qualifications, no access); format 2: with them
  const careers = cat?.format === "arail-roles/2";
  if (!careers && cat?.format !== "arail-roles/1") out.push(`format must be "arail-roles/2" (or "arail-roles/1" without careers)`);
  const families = new Set((cat?.families || []).map((f) => f.id));
  const ids = new Set(), quals = new Set();
  for (const q of cat?.qualifications || []) {
    const at = `qualification ${q?.id ?? "?"}`;
    if (quals.has(q.id)) out.push(`${at}: the id is used twice`);
    quals.add(q.id);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(q.id ?? "")) out.push(`${at}: the id must be kebab-case`);
    for (const k of ["name", "name_de", "provider"]) if (typeof q[k] !== "string" || !q[k].trim()) out.push(`${at}: ${k} is missing`);
    if (!QUALIFICATION_KINDS.includes(q.kind)) out.push(`${at}: kind must be one of ${QUALIFICATION_KINDS.join(", ")}`);
    if (!(q.months >= 0)) out.push(`${at}: months must be 0 or more`);
    if (!Array.isArray(q.requires) || q.requires.some((s) => !Array.isArray(s))) out.push(`${at}: requires must be a list of sets`);
    if (typeof q.while_working !== "boolean") out.push(`${at}: while_working must be true or false`);
  }
  for (const r of cat?.roles || []) {
    const at = `role ${r?.id ?? "?"}`;
    if (ids.has(r.id)) out.push(`${at}: the id is used twice`);
    ids.add(r.id);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.id ?? "")) out.push(`${at}: the id must be kebab-case`);
    for (const k of TEXTS) if (typeof r[k] !== "string" || !r[k].trim()) out.push(`${at}: ${k} is missing`);
    for (const k of LISTS) if (!Array.isArray(r[k]) || !r[k].length) out.push(`${at}: ${k} is missing`);
    if (!families.has(r.family)) out.push(`${at}: unknown family "${r.family}"`);
    if (!ROLE_SETTINGS.includes(r.setting)) out.push(`${at}: setting must be one of ${ROLE_SETTINGS.join(", ")}`);
    if (!r.career?.entry || !r.career?.chances || !Array.isArray(r.career?.from) || !Array.isArray(r.career?.to)) out.push(`${at}: career needs entry, from, to and chances`);
    const g = r.game;
    if (!g?.title || !g?.loop || !g?.win || !g?.knowledge || !g?.bigGame || !Array.isArray(g?.arail)) out.push(`${at}: game needs title, loop, win, knowledge, arail and bigGame`);
    if (g && !["knowledge", "simulation", "both"].includes(g.kind)) out.push(`${at}: game kind must be knowledge, simulation or both`);
    if (g && !GAME_EFFORTS.includes(g.effort)) out.push(`${at}: game effort must be one of ${GAME_EFFORTS.join(", ")}`);
  }
  for (const q of cat?.qualifications || []) for (const x of (q.requires || []).flat()) if (!quals.has(x)) out.push(`qualification ${q.id}: requires an unknown qualification "${x}"`);
  for (const r of cat?.roles || []) {
    for (const k of ["from", "to"]) for (const x of r.career?.[k] || []) if (!ids.has(x)) out.push(`role ${r.id}: career ${k} names an unknown role "${x}"`);
    for (const x of r.interacts || []) if (!ids.has(x)) out.push(`role ${r.id}: interacts with an unknown role "${x}"`);
    const a = r.access, at = `role ${r.id}: access`;
    if (!careers) continue;
    if (!a) {
      out.push(`${at} is missing`);
      continue;
    }
    if (typeof a.job !== "boolean") out.push(`${at}: job must be true or false`);
    if (!SELECTIONS.includes(a.selection)) out.push(`${at}: selection must be one of ${SELECTIONS.join(", ")}`);
    if (a.job && !a.routes?.length) out.push(`${at}: a job needs at least one route in`);
    for (const rt of a.routes || []) {
      for (const x of rt.qualifications || []) if (!quals.has(x)) out.push(`${at}: route "${rt.label}" needs an unknown qualification "${x}"`);
      for (const e of rt.experience || []) {
        if (!(e.years > 0)) out.push(`${at}: route "${rt.label}": years of experience must be more than 0`);
        for (const x of e.roles || []) if (!ids.has(x)) out.push(`${at}: route "${rt.label}" needs experience in an unknown role "${x}"`);
      }
    }
    for (const x of a.gains || []) if (!quals.has(x)) out.push(`${at}: gains an unknown qualification "${x}"`);
  }
  for (const f of families) if (!(cat.roles || []).some((r) => r.family === f)) out.push(`family ${f} has no roles`);
  return out;
}

/**
 * The typical moves between roles: an edge from a role to each role one often moves on to, from both
 * sides of the catalogue (a role's `to`, and the roles that name it in their `from`). Hints, not
 * rules: what is possible is what the roles' access allows (career.js).
 * @returns {{edges: Array<[string, string]>, next: Map<string, string[]>, prev: Map<string, string[]>}}
 */
export function careerGraph(cat) {
  const seen = new Set(), edges = [];
  const add = (a, b) => {
    const k = `${a}>${b}`;
    if (a === b || seen.has(k)) return;
    seen.add(k);
    edges.push([a, b]);
  };
  for (const r of cat.roles) {
    for (const x of r.career?.to || []) add(r.id, x);
    for (const x of r.career?.from || []) add(x, r.id);
  }
  const next = new Map(), prev = new Map();
  for (const r of cat.roles) {
    next.set(r.id, []);
    prev.set(r.id, []);
  }
  for (const [a, b] of edges) {
    next.get(a)?.push(b);
    prev.get(b)?.push(a);
  }
  return { edges, next, prev };
}

/** Counts for an overview: roles per family, per setting, per kind of game and per effort. */
export function roleCounts(cat) {
  const count = (key) => cat.roles.reduce((m, r) => m.set(key(r), (m.get(key(r)) || 0) + 1), new Map());
  return { family: count((r) => r.family), setting: count((r) => r.setting), kind: count((r) => r.game?.kind), effort: count((r) => r.game?.effort) };
}
