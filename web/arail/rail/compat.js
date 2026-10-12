/**
 * May this train run here? The route compatibility check: a train's vehicles (their capability
 * profiles in the catalogue) against the systems of a section (rail/systems.js): traction power and
 * pantograph, train protection and ETCS, train radio, track gauge, line category (axle and metre
 * load) and the vehicles' authorisation for the section's country.
 * @module arail/rail/compat
 */
import { CD, OVERLAY, rgba } from "../core/colors.js";
import { ETCS, POWER, RADIO, TRAIN_CONTROL, routeClassLimits, sectionSystems } from "./systems.js";
import { VEHICLE_KINDS } from "./vehicles.js";

/** The overlay (View → Colour the tracks by) that colours the tracks by whether the chosen train may run there. */
export const COMPATIBILITY = "compatibility";

const ETCS_RANK = { none: 0, l1ls: 1, l1: 2, l2: 3 };
const short = (t) => t.label.split(" (")[0];
const name = (table, key) => table[key]?.label ?? key;

/**
 * What the train needs a section to have, checked one by one.
 * @param {import("./vehicles.js").Consist} consist
 * @param {object} spec the section's (track's) spec
 * @returns {{ok: boolean, problems: Array<{key: string, text: string}>, notes: string[]}}
 */
export function checkSection(consist, spec) {
  const { values: s } = sectionSystems(spec);
  const problems = [], notes = [];
  const add = (key, text) => problems.push({ key, text });
  const vehicles = consist.vehicles.map((v) => v.t);
  const traction = vehicles.filter((t) => VEHICLE_KINDS[t.kind]?.traction);
  // traction power: a diesel runs anywhere; an electric vehicle needs the section's system and a pantograph head it accepts
  if (traction.length) {
    const diesel = traction.filter((t) => !t.power?.length);
    const electric = traction.filter((t) => t.power?.length);
    if (s.power === "none") {
      if (!diesel.length) add("power", `Not electrified, and no diesel vehicle: ${electric.map(short).join(", ")} cannot run`);
    } else {
      const running = electric.filter((t) => t.power.includes(s.power));
      const pantographs = running.filter((t) => !s.pantograph_mm || t.pantograph_mm?.includes(Number(s.pantograph_mm)));
      if (!diesel.length && !running.length) add("power", `${name(POWER, s.power)}: no vehicle can draw this power (${electric.map((t) => `${short(t)}: ${t.power.map((p) => POWER[p]?.short ?? p).join(", ")}`).join("; ")})`);
      else if (!diesel.length && !pantographs.length) add("pantograph_mm", `Pantograph heads of ${s.pantograph_mm} mm are needed here; ${running.map((t) => `${short(t)} has ${t.pantograph_mm.join(", ")} mm`).join("; ")}`);
      for (const t of electric) if (!t.power.includes(s.power)) notes.push(`${short(t)} cannot draw ${name(POWER, s.power)}: hauled without power`);
    }
    // train protection: the leading vehicle needs the section's class B system, or ETCS at the section's level
    const lead = traction[0];
    const own = lead.train_control || [];
    const hasB = s.train_control !== "none" && (own.includes(s.train_control) || (s.train_control === "pzb_lzb" && own.includes("pzb")));
    const etcsOk = s.etcs !== "none" && ETCS_RANK[lead.etcs || "none"] >= ETCS_RANK[s.etcs];
    const unprotected = s.train_control === "none" && s.etcs === "none";
    if (!unprotected && !hasB && !etcsOk) add("train_control", `${name(TRAIN_CONTROL, s.train_control)}${s.etcs !== "none" ? ` or ${name(ETCS, s.etcs)}` : ""} needed; ${short(lead)} has ${[...(lead.train_control || []).map((k) => TRAIN_CONTROL[k]?.short ?? k), lead.etcs && lead.etcs !== "none" ? ETCS[lead.etcs]?.short : null].filter(Boolean).join(", ") || "none"}`);
    // train radio
    if (s.radio !== "none" && !traction.some((t) => (t.radio || []).includes(s.radio))) add("radio", `${name(RADIO, s.radio)} needed; no vehicle has it`);
  } else add("power", "No locomotive or multiple unit: the train cannot move by itself");
  // track gauge
  const gauge = Number(s.gauge_mm) || 1435;
  const wrongGauge = vehicles.filter((t) => (t.gauge_mm ?? 1435) !== gauge);
  if (wrongGauge.length) add("gauge_mm", `Track gauge ${gauge} mm; ${[...new Set(wrongGauge.map(short))].join(", ")} run on ${wrongGauge[0].gauge_mm ?? 1435} mm`);
  // line category: axle load and metre load
  const lim = routeClassLimits(s.route_class);
  const a = consist.maxAxleLoad, m = consist.maxMetreLoad;
  if (lim.axle_t != null && a.t > lim.axle_t + 1e-9) add("route_class", `Line category ${s.route_class} allows ${lim.axle_t} t per axle; ${short({ label: a.by })} has ${a.t.toFixed(1)} t`);
  if (lim.metre_t != null && m.t > lim.metre_t + 1e-9) add("route_class", `Line category ${s.route_class} allows ${lim.metre_t} t per metre; ${short({ label: m.by })} has ${m.t.toFixed(1)} t`);
  // authorisation for the country
  const unauthorised = [...new Set(vehicles.filter((t) => t.countries && !t.countries.includes(s.country)).map(short))];
  if (unauthorised.length) add("country", `Not authorised in ${s.country}: ${unauthorised.join(", ")}`);
  if (s.max_speed_kmh && consist.vmax.kmh && consist.vmax.kmh < s.max_speed_kmh) notes.push(`The line allows ${s.max_speed_kmh} km/h, the train ${consist.vmax.kmh} km/h`);
  return { ok: problems.length === 0, problems, notes };
}

/**
 * The check for every track of a world: [{track, ok, problems, notes}], in the order of the layout.
 * @param {import("./vehicles.js").Consist} consist
 * @param {import("../core/world.js").World} world
 */
export function checkTracks(consist, world) {
  return world.objects.filter((o) => o.type === "track").map((track) => ({ track, ...checkSection(consist, track.spec) }));
}

/** The card section of a train: for each track of the layout whether it may run there, and why not. */
export function compatibilitySection(consist, world) {
  const checks = checkTracks(consist, world);
  if (!checks.length) return null;
  const label = (t) => (t.spec.track_id ? `Track ${t.spec.track_id}` : t.name);
  return {
    title: "May it run here?",
    lines: checks.map((c) => (c.ok ? `${label(c.track)}: yes` : `${label(c.track)}: no · ${c.problems.map((p) => p.text).join(" · ")}`)),
  };
}

/**
 * Colour a track by whether the chosen train may run there (Türkis: yes, Rot: no), with the first
 * reason why not.
 * @param {import("../core/view.js").View} view
 * @param {object} track
 * @param {import("./vehicles.js").Consist} consist
 */
export function drawCompatibilityBand(view, track, consist) {
  const g = track.geometry;
  if (!g || !consist) return;
  const c = checkSection(consist, track.spec);
  const colour = c.ok ? CD.tuerkis : CD.rot;
  view.ribbon(g.points, view.m(3.6), { fill: rgba(colour, 0.62), order: 26 });
  view.line(g.points, { stroke: colour, width: 2, order: 27 });
  const mid = g.points[Math.floor((g.points.length - 1) / 2)], next = g.points[Math.floor((g.points.length - 1) / 2) + 1] ?? mid;
  const at = [(mid[0] + next[0]) / 2, (mid[1] + next[1]) / 2];
  const text = c.ok ? "may run" : `may not run: ${c.problems[0].key === "country" ? "not authorised" : c.problems[0].text.split(":")[0].split(";")[0]}`;
  view.label([at[0], at[1], view.m(1)], text, { size: 10, background: c.ok ? OVERLAY.label : OVERLAY.dangerLabel, optional: true, order: 2 });
}
