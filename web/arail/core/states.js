/**
 * The state of what the layout's simulations keep: assets, people, vehicles. Each simulation names
 * its own with `states()` (core/simulation.js): groups of one kind ("Signal", "People waiting"),
 * each item with a score from 0 (worst) to 1 (best). These functions put the groups of all
 * simulations together, sum them up (the mean score, a histogram with fixed bins) and search them.
 * @module arail/core/states
 */

/** Bins of the histograms: 0–10 %, …, 90–100 %. */
export const STATE_BINS = 10;

/**
 * @typedef {object} StateItem
 * @property {string} name what people read and search for ("Signal N2", "A. Berg")
 * @property {number} score 0 (worst) … 1 (best)
 * @property {string} [text] the state in words ("grade 4.9", "mood 70 %")
 * @property {string} [key] the key of its pickable (core/pick.js), to open its card
 *
 * @typedef {object} StateGroup
 * @property {string} id one per kind; groups of the same id from several simulations are joined
 * @property {string} label the kind, as people read it ("Signal")
 * @property {string} [measure] what the score measures ("condition", "mood")
 * @property {StateItem[]} items
 *
 * @typedef {StateGroup & {mean: number, bins: number[], worst: StateItem | null}} StateSummary
 */

/** The groups of all simulations that are on, joined by id; empty groups are left out. */
export function stateGroups(world) {
  const byId = new Map();
  for (const sim of world.simulations) {
    if (sim.enabled === false || typeof sim.states !== "function") continue;
    for (const g of sim.states() || []) {
      const items = (g.items || []).filter((x) => Number.isFinite(x.score));
      const known = byId.get(g.id);
      if (known) known.items.push(...items);
      else byId.set(g.id, { ...g, items });
    }
  }
  return [...byId.values()].filter((g) => g.items.length);
}

/** Clamp a score to 0 … 1. */
export function clampScore(x) {
  return Math.min(1, Math.max(0, x));
}

/** The mean score of a group, its histogram (counts per bin) and its worst item. */
export function summarizeStates(group) {
  const bins = new Array(STATE_BINS).fill(0);
  let sum = 0, worst = null;
  for (const it of group.items) {
    const s = clampScore(it.score);
    sum += s;
    bins[Math.min(STATE_BINS - 1, Math.floor(s * STATE_BINS))]++;
    if (!worst || s < worst.score) worst = { ...it, score: s };
  }
  return { ...group, mean: group.items.length ? sum / group.items.length : 1, bins, worst };
}

/**
 * The state of the whole layout: the mean of the groups' means (each kind counts once, however
 * many items it has), the groups from the worst to the best, and how many items there are.
 * @returns {{mean: number | null, count: number, groups: StateSummary[]}}
 */
export function overallState(world) {
  const groups = stateGroups(world).map(summarizeStates).sort((a, b) => a.mean - b.mean || a.label.localeCompare(b.label));
  const mean = groups.length ? groups.reduce((s, g) => s + g.mean, 0) / groups.length : null;
  return { mean, count: groups.reduce((n, g) => n + g.items.length, 0), groups };
}

/**
 * The items whose name or kind contains the query (case and accents aside), the worst first.
 * @param {StateSummary[]} groups
 * @param {string} query
 * @param {number} [limit]
 * @returns {Array<StateItem & {group: string}>}
 */
export function searchStates(groups, query, limit = 30) {
  const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const g of groups) {
    for (const it of g.items) {
      const text = fold(`${it.name} ${g.label}`);
      if (words.every((w) => text.includes(w))) out.push({ ...it, score: clampScore(it.score), group: g.label });
    }
  }
  return out.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name)).slice(0, limit);
}
