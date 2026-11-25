#!/usr/bin/env node
// Work out ahead what a layout's town learns about its modes of transport, without the app: the
// people choose between walking, the bike, bus and tram and the car, stand in the jams they make
// and learn from them, until the shares have settled at what the streets, stops and parking can
// take. Run it after a layout's streets, lines, buildings or simulations were changed.
//
//   node tools/mobility-learn.mjs web/layouts/ebl-neustadt.json            # 14 days; shows what was learned
//   node tools/mobility-learn.mjs web/layouts/ebl-neustadt.json --write    # and keeps it in the layout ("experience")
//   node tools/mobility-learn.mjs my-layout.json --days 21 --date 2026-05-04 --weather typical --json learned.json
//   node tools/mobility-learn.mjs web/layouts/ebl-neustadt.json --check    # is the layout's experience still its own?
//
// Options: --days N (14), --seed N (the layout's), --date YYYY-MM-DD (a date on the clock: weekends
// have no rush hour; without one every day is a working day), --weather NAME (a preset, or
// "typical" for the date), --layers ID,ID (the layout's layers to switch on; default: those that
// are on), --from-scratch (forget the experience the layout has), --write, --json FILE, --check.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createWorld, withLayers } from "../web/arail/index.js";
import { experienceKey, layoutWithExperience, runLearning } from "../web/arail/sims/learning.js";

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const file = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--") || (!a.startsWith("--") && ["--write", "--check", "--from-scratch"].includes(args[i - 1])));
if (!file || flag("help")) {
  console.log("Usage: node tools/mobility-learn.mjs <layout.json> [--days 14] [--seed N] [--date YYYY-MM-DD] [--weather NAME] [--layers ID,ID] [--from-scratch] [--write] [--json FILE] [--check]");
  process.exit(file ? 0 : 1);
}
const path = resolve(file), text = readFileSync(path, "utf8");
let input = JSON.parse(text);
const layers = opt("layers")?.split(",").map((s) => s.trim()).filter(Boolean);
if (layers) input = withLayers(input, layers);
if (flag("from-scratch")) input = { ...input, experience: null };
const seed = opt("seed");
const world = createWorld(input, seed != null ? { seed: Number(seed) } : {});
world.step(0.1);

if (flag("check")) {
  const key = experienceKey(world), had = input.experience?.for ?? null;
  if (!had) fail(`${file} has no experience. Run: node tools/mobility-learn.mjs ${file} --write`);
  if (had !== key) fail(`The experience of ${file} was learned for another state of the layout (${had}, now ${key}): its streets, its lines or the settings of a simulation have changed${opt("layers") ? "" : ", or it was learned with --layers (then check with the same --layers)"}. Run: node tools/mobility-learn.mjs ${file}${opt("layers") ? ` --layers ${opt("layers")}` : ""} --write`);
  console.log(`The experience of ${file} is the layout's own (${key}, ${input.experience.days} days).`);
  process.exit(0);
}

if (opt("date") && world.setDate(opt("date")) === undefined) fail(`--date ${opt("date")} is no date (YYYY-MM-DD)`);
if (opt("weather") && !world.setWeather(opt("weather"))) fail(`--weather ${opt("weather")} is no weather (a preset's name, or "typical")`);
if (!world.simulations.some((s) => ["town", "traffic"].includes(s.constructor.type))) fail(`${file} has no town and no road traffic: nothing learns there`);

const days = Math.max(1, Number(opt("days", 14)) || 14);
const pct = (x) => `${Math.round(x * 100)} %`.padStart(5);
console.log(`${file}: learning for ${days} days${world.experience.given ? " (on from the layout's experience)" : ""}`);
console.log("day      cars: km/h  standing  jams of drives | on foot   bike  bus+tram   car | drives take × the plan, buses ×");
const t0 = Date.now();
const result = runLearning(world, {
  days,
  onDay: (d) => {
    const c = d.cars, s = d.split;
    console.log(`${String(d.day).padStart(3)}${d.weekend ? " we" : "   "}        ${c ? String(c.speed_kmh.toFixed(1)).padStart(5) : "    –"}     ${c ? pct(c.standing) : "    –"}   ${c ? `${String(c.jams).padStart(4)} of ${String(c.drives).padEnd(5)}` : "            –"} |   ${s?.trips ? `${pct(s.shares.walk)}  ${pct(s.shares.bike)}     ${pct(s.shares.transit)} ${pct(s.shares.car)}` : "    –      –         –     –"} | ${d.ratio.car.toFixed(2)}  ${d.ratio.transit.toFixed(2)}`);
  },
});
console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s. Learned for the layout as it is (${result.experience.for}).`);
if (opt("json")) writeFileSync(resolve(opt("json")), `${JSON.stringify(result, null, 2)}\n`);
if (flag("write")) {
  const next = layoutWithExperience(text, result.experience);
  if (!next) fail(`${file}: no place for the experience found (no "simulations" in the layout), or the file would not read as the same layout with it. Nothing was written. Use --json FILE and put its "experience" into the layout.`);
  writeFileSync(path, next);
  console.log(`Kept in ${file} ("experience").`);
} else console.log("Not kept (--write keeps it in the layout).");

function fail(message) {
  console.error(message);
  process.exit(1);
}
