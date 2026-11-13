#!/usr/bin/env node
// Hump random trains over a standard hump yard, without the app, and print what became of every cut.
//
//   node tools/hump.mjs                                   # one train of 30 wagons, 8 tracks, summer
//   node tools/hump.mjs --trains 3 --season winter --push 1.6
//   node tools/hump.mjs --design target --estimate-sd 0.2 --json run.json
//
// Options: --tracks N (classification tracks, default 8), --wagons N (per train, default 30),
// --trains N (default 1), --seed N (default 1), --push M/S (pushing speed, default 1.2),
// --season summer|winter, --design speed|target (how the tracks bring the cuts to the wagons in
// them, see docs/hump-yard.md), --estimate-sd N/KN (error of the measured rolling resistance),
// --pull-below M (pull a track out as a train when it has less room than this), --quiet (only the
// figures), --json FILE (the whole result), --svg FILE (the diagrams of hump design: height and
// energy line, speed over distance, distance over time).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createRng } from "../web/arail/core/math.js";
import { HumpSimulation, SEASONS, TRACK_DESIGNS, humpDiagrams, randomTrain, standardYard } from "../web/arail/hump/index.js";

const args = process.argv.slice(2);
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
/** The value after --name; a value that is missing or is another option is an error. */
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1];
  if (v == null || v.startsWith("--")) fail(`--${name} needs a value`);
  return v;
};
if (args.includes("--help")) {
  console.log("Usage: node tools/hump.mjs [--tracks 8] [--wagons 30] [--trains 1] [--seed 1] [--push 1.2] [--season summer|winter] [--design speed|target] [--estimate-sd 0.4] [--pull-below M] [--quiet] [--json FILE] [--svg FILE]");
  process.exit(0);
}
/** A number of an option; `kind`: "count" a whole number from 1, "positive" above 0, "nonnegative" from 0. */
const num = (name, fallback, kind) => {
  const v = Number(opt(name, fallback));
  if (!Number.isFinite(v)) fail(`--${name} needs a number`);
  if (kind === "count" && !(Number.isInteger(v) && v >= 1)) fail(`--${name} needs a whole number from 1`);
  if (kind === "positive" && !(v > 0)) fail(`--${name} needs a number above 0`);
  if (kind === "nonnegative" && !(v >= 0)) fail(`--${name} needs a number from 0`);
  return v;
};
// every option read before the run, so that a wrong one fails at once
const tracks = num("tracks", 8, "count"), wagons = num("wagons", 30, "count"), trains = num("trains", 1, "count"), seed = num("seed", 1);
const push = num("push", 1.2, "positive");
const season = opt("season", "summer"), design = opt("design", "speed");
if (!SEASONS[season] || !TRACK_DESIGNS[design]) fail(`--season is one of ${Object.keys(SEASONS).join(", ")}; --design one of ${Object.keys(TRACK_DESIGNS).join(", ")}`);
const control = opt("estimate-sd") != null ? { estimate_sd: num("estimate-sd", 0, "nonnegative") } : {};
const pull = opt("pull-below") != null ? num("pull-below", 0, "nonnegative") : null;
const svg = opt("svg"), file = opt("json");

const yard = standardYard({ tracks, design });
// time enough for every train: an hour per train at the least, as for a long train pushed slowly
const sim = new HumpSimulation(yard, { seed, season, control, trace: !!svg, pull_below_m: pull, max_s: Math.max(4, trains + 1) * 3600 });
const rng = createRng(seed + 1000);
for (let i = 0; i < trains; i++) sim.hump({ id: `T${i + 1}`, push_mps: push, wagons: randomTrain(rng, { wagons, tracks: yard.tracks.map((t) => t.name) }) });
const r = sim.run();

const f = (x, d = 1) => (x == null ? "–" : x.toFixed(d));
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
console.log(`${yard.name}: ${yard.tracks.length} tracks of ${f(yard.tracks[0].length_m, 0)} m (${TRACK_DESIGNS[design].label.toLowerCase()}), ${f(yard.height_m, 2)} m high; ${SEASONS[season].label}, pushed at ${f(push, 1)} m/s`);
if (!args.includes("--quiet")) {
  console.log("");
  console.log(`${pad("Cut", 7)}${pad("Wagons", 26)}${lpad("t", 6)}${lpad("N/kN", 6)}${lpad("est", 6)}  ${pad("Track", 9)}${lpad("main in>out", 13)}${lpad("group in>out", 14)}${lpad("impact", 8)}  Notes`);
  for (const c of r.perCut) {
    const notes = [c.misrouted && `misrouted (for ${c.track})`, c.caughtUp && "caught up", c.derailed && "derailed", c.stop && !c.ended && "stopped short", c.pushedOver && "pushed over"].filter(Boolean).join(", ");
    const types = c.types.join("+");
    const ret = (x) => (x ? `${f(x.in_mps)}>${f(x.out_mps)}` : "–");
    console.log(`${pad(c.id, 7)}${pad(types.length > 25 ? `${types.slice(0, 24)}…` : types, 26)}${lpad(f(c.mass_t, 0), 6)}${lpad(f(c.w, 2), 6)}${lpad(f(c.w_est, 2), 6)}  ${pad(c.ended ?? "–", 9)}${lpad(ret(c.main), 13)}${lpad(ret(c.group), 14)}${lpad(f(c.impact_mps, 2), 8)}  ${notes}`);
  }
  console.log("");
  console.log(`${pad("Track", 7)}${lpad("Wagons", 7)}${lpad("Gaps", 6)}${lpad("Gap m", 7)}${lpad("Free m", 8)}`);
  for (const t of r.tracks) console.log(`${pad(t.name, 7)}${lpad(t.wagons, 7)}${lpad(t.gaps.length, 6)}${lpad(f(t.gaps_m, 0), 7)}${lpad(f(t.free_m, 0), 8)}`);
}
console.log("");
console.log(`${r.trains} train(s), ${r.cuts} cuts, ${r.wagons} wagons in ${f(r.push_s / 60)} min of pushing: ${f(r.cuts_per_hour, 0)} cuts per hour`);
if (r.limit_reached) console.warn(`Stopped after ${f(r.t_s / 3600)} h with ${r.waiting} train(s) not humped (or cuts still rolling).`);
if (sim.departures.length) console.log(`Pulled out: ${sim.departures.map((d) => `track ${d.track} (${d.wagons.length} wagon${d.wagons.length === 1 ? "" : "s"})`).join(", ")}`);
if (r.pushed_up_m > 0) console.log(`Pushed up: ${f(r.pushed_up_m, 0)} m`);
console.log(`Misrouted ${r.misrouted}, caught up ${r.caughtUp}, derailed ${r.derailed}, stopped short ${r.short}; impacts too hard ${r.hard} (highest ${f(r.max_impact_mps, 2)} m/s); gaps ${r.gaps} (${f(r.gaps_m, 0)} m to push up); retarders entered too fast ${r.overspeed}`);
if (svg) {
  writeFileSync(resolve(svg), humpDiagrams(sim));
  console.log(`Written: ${svg}`);
}
if (file) {
  writeFileSync(resolve(file), `${JSON.stringify({ yard: { name: yard.name, tracks: yard.tracks, height_m: yard.height_m, crest_m: yard.crest_m }, options: { tracks, wagons, trains, seed, push, season, design, control, pull }, results: r, departures: sim.departures.map((d) => ({ ...d, wagons: d.wagons.map((w) => w.id) })), log: sim.log }, null, 2)}\n`);
  console.log(`Written: ${file}`);
}
