#!/usr/bin/env node
// Compare setups of the operations simulation (fleet, maintenance, crews) on a layout, without the app.
//
//   node tools/ops-compare.mjs web/layouts/ebl-operations.json --days 28 --seeds 3 --stress flu
//   node tools/ops-compare.mjs my-layout.json --setups integrated,distributed --csv results.csv
//
// Options: --days N (measured days per run, default 28), --seeds N (runs per setup, default 3),
// --stress ID (a stress test: none, flu, shortage, heat, bus-strike, workshop-slow, bad-monday,
// unit-damage, or one of the layout's), --setups ID,ID (default: the layout's setups, else the
// presets), --csv FILE, --json FILE, --list (show the setups and stress tests).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { normalizeLayout } from "../web/arail/core/layout.js";
import { KPIS, runExperiment, setupsOf, stressOf, toCSV } from "../web/arail/ops/experiment.js";

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const file = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!file || args.includes("--help")) {
  console.log("Usage: node tools/ops-compare.mjs <layout.json> [--days 28] [--seeds 3] [--stress ID] [--setups ID,ID] [--csv FILE] [--json FILE] [--list]");
  process.exit(file ? 0 : 1);
}

const layout = normalizeLayout(JSON.parse(readFileSync(resolve(file), "utf8")));
const entry = layout.simulations.find((s) => s.type === "operations");
if (!entry) console.warn("The layout has no operations simulation; using the defaults (lines from the platforms).");
const config = entry || {};
const setups = setupsOf(config), stresses = stressOf(config);

if (args.includes("--list")) {
  console.log("Setups:");
  for (const s of setups) console.log(`  ${s.id.padEnd(16)} ${s.name}${s.description ? ` – ${s.description}` : ""}`);
  console.log("Stress tests:");
  for (const s of stresses) console.log(`  ${s.id.padEnd(16)} ${s.name}${s.description ? ` – ${s.description}` : ""}`);
  process.exit(0);
}

const wanted = opt("setups")?.split(",").map((s) => s.trim()).filter(Boolean);
const chosen = wanted ? wanted.map((id) => setups.find((s) => s.id === id) || fail(`no setup "${id}" (see --list)`)) : setups;
const stressId = opt("stress", "none");
const stress = stresses.find((s) => s.id === stressId) || fail(`no stress test "${stressId}" (see --list)`);
const days = Math.max(1, Number(opt("days", 28)) || 28);
const seeds = Array.from({ length: Math.max(1, Number(opt("seeds", 3)) || 3) }, (_, i) => i + 1);

function fail(text) {
  console.error(text);
  process.exit(1);
}

const started = Date.now();
let result = null;
for await (const step of runExperiment({ config, layout, setups: chosen, stress, days, seeds })) {
  if (step.done) result = step.result;
  else process.stderr.write(`\r${Math.round(step.progress * 100)} % (${step.setup}, seed ${step.seed})   `);
}
process.stderr.write(`\rDone in ${((Date.now() - started) / 1000).toFixed(1)} s.          \n`);

const fmt = (key, v) => (["cancelledPct", "punctualPct", "shortPct", "kmLostPct", "availabilityPct", "workshopPct", "avgDelay"].includes(key) ? v.toFixed(2) : Math.round(v).toLocaleString("en"));
const width = Math.max(12, ...result.rows.map((r) => r.name.length + 2));
console.log(`\n${layout.name}: ${stress.name}, ${days} days, ${seeds.length} seed${seeds.length === 1 ? "" : "s"} (mean)\n`);
console.log("".padEnd(36) + result.rows.map((r) => r.name.padStart(width)).join(""));
for (const [key, label, unit] of KPIS) {
  console.log(`${label}${unit ? ` (${unit})` : ""}`.padEnd(36) + result.rows.map((r) => fmt(key, r.values[key].mean).padStart(width)).join(""));
}
const parties = [...new Set(result.rows.flatMap((r) => Object.keys(r.parties)))];
for (const p of parties) console.log(`Net penalties: ${p}`.padEnd(36) + result.rows.map((r) => Math.round(r.parties[p]?.net ?? 0).toLocaleString("en").padStart(width)).join(""));

const csv = opt("csv"), json = opt("json");
if (csv) {
  writeFileSync(csv, toCSV(result));
  console.log(`\nCSV written to ${csv}`);
}
if (json) {
  writeFileSync(json, JSON.stringify(result, null, 2));
  console.log(`JSON written to ${json}`);
}
