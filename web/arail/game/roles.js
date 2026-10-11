/**
 * The role catalogue: every role of the railway system, from the politician to the cleaning staff,
 * with what a game of it needs (docs/roles.md). The data is web/game/roles/roles.json (format
 * "arail-roles/1"), loaded where it is needed: the roles page, the docs generator, the tests, later the
 * career mode. This module checks it and reads it as a career graph.
 *
 * A role: `id`, `name`, `name_de`, `family`, `organisation`, `setting` (operational, field, office,
 * mixed), `summary`, `decisions`, `effects`, `resources`, `limits`, `risks`, `career` (`entry`,
 * `from`, `to`, `chances`), `kpis`, `timescale`, `interacts`, `game` (`title`, `kind`, `loop`, `win`,
 * `knowledge`, `arail`, `bigGame`, `effort`, and `page` where it can be played).
 * @module arail/game/roles
 */

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
  if (cat?.format !== "arail-roles/1") out.push(`format must be "arail-roles/1"`);
  const families = new Set((cat?.families || []).map((f) => f.id));
  const ids = new Set();
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
  for (const r of cat?.roles || []) {
    for (const k of ["from", "to"]) for (const x of r.career?.[k] || []) if (!ids.has(x)) out.push(`role ${r.id}: career ${k} names an unknown role "${x}"`);
    for (const x of r.interacts || []) if (!ids.has(x)) out.push(`role ${r.id}: interacts with an unknown role "${x}"`);
  }
  for (const f of families) if (!(cat.roles || []).some((r) => r.family === f)) out.push(`family ${f} has no roles`);
  return out;
}

/**
 * The career graph: an edge from a role to each role one can move on to, from both sides of the
 * catalogue (a role's `to`, and the roles that name it in their `from`).
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

/**
 * The shortest career from one role to another over the career graph (a list of role ids), or null.
 * @param {object} cat
 * @param {string} from
 * @param {string} to
 */
export function careerPath(cat, from, to) {
  const { next } = careerGraph(cat);
  if (!next.has(from) || !next.has(to)) return null;
  const back = new Map([[from, null]]), queue = [from];
  while (queue.length) {
    const a = queue.shift();
    if (a === to) break;
    for (const b of next.get(a)) {
      if (back.has(b)) continue;
      back.set(b, a);
      queue.push(b);
    }
  }
  if (!back.has(to)) return null;
  const path = [];
  for (let x = to; x != null; x = back.get(x)) path.unshift(x);
  return path;
}

/** Counts for an overview: roles per family, per setting, per kind of game and per effort. */
export function roleCounts(cat) {
  const count = (key) => cat.roles.reduce((m, r) => m.set(key(r), (m.get(key(r)) || 0) + 1), new Map());
  return { family: count((r) => r.family), setting: count((r) => r.setting), kind: count((r) => r.game?.kind), effort: count((r) => r.game?.effort) };
}
