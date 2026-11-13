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
// --quiet (only the figures), --json FILE (the whole result).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createRng } from "../web/arail/core/math.js";
import { HumpSimulation, SEASONS, TRACK_DESIGNS, randomTrain, standardYard } from "../web/arail/hump/index.js";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
if (args.includes("--help")) {
  console.log("Usage: node tools/hump.mjs [--tracks 8] [--wagons 30] [--trains 1] [--seed 1] [--push 1.2] [--season summer|winter] [--design speed|target] [--estimate-sd 0.4] [--quiet] [--json FILE]");
  process.exit(0);
}
const num = (name, fallback) => {
  const v = Number(opt(name, fallback));
  if (!Number.isFinite(v)) {
    console.error(`--${name} needs a number`);
    process.exit(1);
  }
  return v;
};
const tracks = num("tracks", 8), wagons = num("wagons", 30), trains = num("trains", 1), seed = num("seed", 1), push = num("push", 1.2);
const season = opt("season", "summer"), design = opt("design", "speed");
if (!SEASONS[season] || !TRACK_DESIGNS[design]) {
  console.error(`--season is one of ${Object.keys(SEASONS).join(", ")}; --design one of ${Object.keys(TRACK_DESIGNS).join(", ")}`);
  process.exit(1);
}
const control = opt("estimate-sd") != null ? { estimate_sd: num("estimate-sd") } : {};

const yard = standardYard({ tracks, design });
const sim = new HumpSimulation(yard, { seed, season, control });
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
console.log(`Misrouted ${r.misrouted}, caught up ${r.caughtUp}, derailed ${r.derailed}, stopped short ${r.short}; impacts too hard ${r.hard} (highest ${f(r.max_impact_mps, 2)} m/s); gaps ${r.gaps} (${f(r.gaps_m, 0)} m to push up); retarders entered too fast ${r.overspeed}`);
const file = opt("json");
if (file) {
  writeFileSync(resolve(file), `${JSON.stringify({ yard: { name: yard.name, tracks: yard.tracks, height_m: yard.height_m, crest_m: yard.crest_m }, options: { tracks, wagons, trains, seed, push, season, design, control }, results: r, log: sim.log }, null, 2)}\n`);
  console.log(`Written: ${file}`);
}
