/**
 * Working out ahead what a town learns about its modes of transport (core/modes.js `Experience`):
 * a layout is run for some weeks without the app, its people choose their modes, stand in the jams
 * they make and learn from them, until the shares of the modes have settled at what its streets,
 * stops and parking can take. What the town has learned by then is kept in the layout
 * (`experience`), so that the first morning in the app starts where the learning ends.
 * `tools/mobility-learn.mjs` does this from the command line, after a layout was changed.
 * @module arail/sims/learning
 */
import { hashKey } from "../core/math.js";
import { MODE_KEYS } from "../core/modes.js";

/**
 * What a town's experience was learned for: a key of the streets (as the cars see them), the lines
 * with their stops, the settings of the simulations and the scale. When it is no more the layout's
 * (`experience.for`), the layout was changed since: the experience should be worked out again.
 * @param {import("../core/world.js").World} world
 * @returns {string}
 */
export function experienceKey(world) {
  let net = null;
  try {
    net = world.network?.() || null;
  } catch {
    net = null;
  }
  world.transit?.sync?.();
  const lines = [...(world.transit?.lines?.values?.() || [])].map((l) => `${l.id}:${l.signature}`).sort();
  const sims = (world.simulations || []).map((s) => JSON.stringify({ type: s.constructor.type, ...s.config })).sort();
  return hashKey(world.scale, net?.carKey ?? "", lines.join("|"), sims.join("|")).toString(36);
}

/**
 * Run a world for some days and let its town learn (the world's `experience` is what is learned).
 * @param {import("../core/world.js").World} world at the layout's start, with a town or road traffic
 * @param {{days?: number, start?: string, step_s?: number, onDay?: (day: object) => void}} [o] days: how many
 *   (14); start: the time of day the first begins ("03:00"); step_s: the simulated seconds a step
 *   takes (0.25); onDay: called after each day with what it was like
 * @returns {{days: object[], experience: object}} the days ({day, weekend, cars: {speed_kmh, standing, drives,
 *   jams}, split, ratio: mode → the mean of the hours 6 to 20}), and the experience as a layout keeps it (with `for`)
 */
export function runLearning(world, { days = 14, start = "03:00", step_s = 0.25, onDay = null } = {}) {
  const sim = (type) => world.simulations.find((s) => s.enabled !== false && s.constructor.type === type) || null;
  const traffic = sim("traffic"), town = sim("town");
  world.speed = 1;
  world.setTime(start);
  const out = [];
  let drives = traffic?.drives ?? 0, jams = traffic?.jams ?? 0, trips = 0;
  for (let d = 0; d < days; d++) {
    const day = world.clock.day, weekend = world.clock.weekend();
    let v = 0, n = 0, standing = 0, k = 0;
    while (world.clock.day === day) {
      // (World.step takes at most 0.1 s of real time: at this speed a step is `step_s` simulated seconds)
      world.speed = step_s / 0.1;
      world.step(0.1);
      if (++k % 8 || !traffic) continue;
      const h = world.clock.minutes / 60;
      if (h < 6 || h >= 20) continue;
      for (const car of traffic.cars) {
        n++;
        v += car.v;
        if (car.v < 0.5) standing++;
      }
    }
    const split = town?.modalSplit ? splitSince(town, trips) : null;
    trips = town?.tripLog?.length ?? 0;
    const kind = weekend ? "weekend" : "weekday", ratio = {};
    for (const mode of MODE_KEYS) {
      const row = world.experience.table[mode][kind];
      let sum = 0;
      for (let h = 6; h < 20; h++) sum += row[h];
      ratio[mode] = Math.round((sum / 14) * 100) / 100;
    }
    const info = {
      day: d + 1, weekend,
      cars: traffic ? { speed_kmh: n ? Math.round((v / n) * 36) / 10 : 0, standing: n ? Math.round((standing / n) * 100) / 100 : 0, drives: traffic.drives - drives, jams: traffic.jams - jams } : null,
      split, ratio,
    };
    drives = traffic?.drives ?? 0;
    jams = traffic?.jams ?? 0;
    out.push(info);
    onDay?.(info);
  }
  world.experience.settle();
  return { days: out, experience: { ...world.experience.toJSON(), for: experienceKey(world) } };
}

/** The shares of the modes of the town's trips from the `from`-th of its log on (the trips of a day; the log keeps the latest only). */
function splitSince(town, from) {
  const log = town.tripLog, all = town.modalSplit();
  if (log.length < from || log.length >= 5000) return all;
  const kept = log.slice(0, from);
  town.tripLog = log.slice(from);
  const split = town.modalSplit();
  town.tripLog = kept.concat(town.tripLog);
  return split;
}

/**
 * A layout file's text with an experience in it: the layout's top-level `experience` on one line,
 * in the place of the one it had (however that was written: on one line or over many), else before
 * its simulations; the rest of the text as it is (a layout file is kept by hand, an object a line).
 * Null where the text is no layout with a place for it, or where the text made would not read as
 * the same layout with just this experience: nothing is to be written then.
 * @param {string} text the layout file
 * @param {object} experience as `runLearning` gives it
 * @returns {string | null}
 */
export function layoutWithExperience(text, experience) {
  const parse = (t) => {
    try {
      const o = JSON.parse(t);
      return o && typeof o === "object" && !Array.isArray(o) ? o : null;
    } catch {
      return null;
    }
  };
  const layout = parse(text);
  if (!layout) return null;
  const value = JSON.stringify(experience).replace(/,"/g, ', "').replace(/":/g, '": ');
  const had = topLevelKey(text, "experience"), before = had ? null : topLevelKey(text, "simulations");
  let next = null;
  if (had) next = text.slice(0, had.valueStart) + value + text.slice(had.valueEnd);
  else if (before) {
    // (on a line of its own where the simulations are, with their indent)
    const lineStart = text.lastIndexOf("\n", before.keyStart) + 1, indent = text.slice(lineStart, before.keyStart);
    next = `${text.slice(0, before.keyStart)}"experience": ${value},${/^\s*$/.test(indent) && lineStart > 0 ? `\n${indent}` : " "}${text.slice(before.keyStart)}`;
  }
  // only a text that reads as the same layout with this experience
  const made = next && parse(next), rest = (o) => JSON.stringify({ ...o, experience: undefined });
  return made && JSON.stringify(made.experience) === JSON.stringify(experience) && rest(made) === rest(layout) ? next : null;
}

/**
 * Where a key of the outermost object stands in a JSON text, and its value: found by reading the
 * text (strings, brackets), not by its layout on the lines.
 * @returns {{keyStart: number, valueStart: number, valueEnd: number} | null}
 */
function topLevelKey(text, name) {
  const n = text.length;
  // the end of the string that opens at i (the index after its closing quote)
  const stringEnd = (i) => {
    for (i++; i < n; i++) {
      if (text[i] === "\\") i++;
      else if (text[i] === '"') return i + 1;
    }
    return n;
  };
  // the end of the value that begins at i
  const valueEnd = (i) => {
    if (text[i] === '"') return stringEnd(i);
    if (text[i] !== "{" && text[i] !== "[") {
      while (i < n && !/[,}\]\s]/.test(text[i])) i++;
      return i;
    }
    for (let depth = 0; i < n; i++) {
      const c = text[i];
      if (c === '"') i = stringEnd(i) - 1;
      else if (c === "{" || c === "[") depth++;
      else if ((c === "}" || c === "]") && --depth === 0) return i + 1;
    }
    return n;
  };
  let i = text.indexOf("{");
  if (i < 0) return null;
  for (i++; i < n; ) {
    while (i < n && /[\s,]/.test(text[i])) i++;
    if (text[i] !== '"') return null;
    const keyStart = i, keyEnd = stringEnd(i);
    i = keyEnd;
    while (i < n && /\s/.test(text[i])) i++;
    if (text[i] !== ":") return null;
    for (i++; i < n && /\s/.test(text[i]); ) i++;
    const end = valueEnd(i);
    if (text.slice(keyStart + 1, keyEnd - 1) === name) return { keyStart, valueStart: i, valueEnd: end };
    i = end;
  }
  return null;
}
