/**
 * The consists of the trains the world shows, and their train data on the info card: a train at a
 * platform (of the timetable, of the rail operations) or of the control system gets the vehicles
 * of the layout's `consists` entry that matches it (by its train number or its line), else those
 * of its units (rail operations).
 * @module arail/rail/trains
 */
import { Consist, VEHICLE_TYPES, consistRows } from "./vehicles.js";
import { sectionSystems } from "./systems.js";
import { checkSection, compatibilitySection } from "./compat.js";

/** The vehicle types of a world: the catalogue and the layout's own (`vehicle_types`). */
export function vehicleTypes(world) {
  const own = world.layout?.vehicle_types;
  return own && Object.keys(own).length ? { ...VEHICLE_TYPES, ...own } : VEHICLE_TYPES;
}

/** Does a consist entry of the layout file match a train (its number or name, or its line)? */
function matches(entry, { train, line }) {
  const ids = [entry.trains, entry.lines].flat().filter((x) => typeof x === "string" && x);
  if (!ids.length) return false;
  const norm = (s) => String(s ?? "").trim().toLowerCase();
  if (train && (entry.trains || []).some((t) => norm(t) === norm(train))) return true;
  if (!line) return false;
  const l = norm(line);
  // "RE 1" matches "RE 1", "RE 1 → Altstadt 07:15" and "RE 1 from Altstadt"
  return (entry.lines || []).some((x) => {
    const n = norm(x);
    return l === n || l.startsWith(`${n} `);
  });
}

/**
 * The consist of a train the world shows, or null.
 * @param {import("../core/world.js").World} world
 * @param {{train?: string | null, line?: string | null, units?: Array<{type: string}> | null}} who its train
 *   number (control system), its line, its units (rail operations)
 * @returns {Consist | null}
 */
export function consistFor(world, who) {
  const types = vehicleTypes(world);
  const entry = (world.layout?.consists || []).find((e) => matches(e, who));
  if (entry) return new Consist(entry, types);
  if (who.units?.length) {
    const known = who.units.filter((u) => types[u.type]);
    if (known.length) return new Consist({ name: who.line, vehicles: known.map((u) => ({ type: u.type })) }, types);
  }
  return null;
}

/**
 * Layout check (registry.registerCheck): the consists name known vehicle types (of the catalogue or
 * the layout's own) and say which trains they are for; the layout's own types have what a train's
 * figures need.
 * @param {object} json a layout file
 * @returns {string[]}
 */
export function consistProblems(json) {
  const out = [];
  const own = json?.vehicle_types && typeof json.vehicle_types === "object" && !Array.isArray(json.vehicle_types) ? json.vehicle_types : {};
  if (json?.vehicle_types != null && own !== json.vehicle_types) out.push("vehicle_types must be an object: type id → vehicle");
  for (const [id, t] of Object.entries(own)) {
    for (const k of ["length_m", "mass_t", "axles", "vmax_kmh"]) if (!(Number(t?.[k]) > 0)) out.push(`vehicle_types.${id}: ${k} must be a positive number`);
    if (!t?.brake_t || typeof t.brake_t !== "object") out.push(`vehicle_types.${id}: brake_t must give the brake weights, e.g. {"P": 60}`);
  }
  if (json?.consists != null && !Array.isArray(json.consists)) return [...out, "consists must be a list"];
  (json?.consists || []).forEach((c, i) => {
    const where = `consists[${i}]${c?.id ? ` (${c.id})` : ""}`;
    if (!c || typeof c !== "object") return out.push(`${where} is not an object`);
    if (![c.lines, c.trains].flat().some((x) => typeof x === "string" && x)) out.push(`${where}: give the lines or train numbers it is for ("lines": ["RE 1"])`);
    if (!Array.isArray(c.vehicles) || !c.vehicles.length) return out.push(`${where}: vehicles must be a list, e.g. [{"type": "br146"}, {"type": "dbpza", "count": 4}]`);
    c.vehicles.forEach((v, k) => {
      if (!v?.type || !(VEHICLE_TYPES[v.type] || own[v.type])) out.push(`${where}.vehicles[${k}]: unknown vehicle type "${v?.type}"`);
    });
  });
  return out;
}

/**
 * The consist of a train that is pointed at (a vehicle at a platform, a train of the control
 * system), or null.
 * @param {import("../core/world.js").World} world
 * @param {import("../core/pick.js").Pickable} hit
 * @returns {Consist | null}
 */
export function consistOfHit(world, hit) {
  if (hit?.kind !== "train") return null;
  const r = hit.ref;
  const ops = r?.ops ? world.simulations.find((s) => s.constructor.type === "operations")?.engine : null;
  const trip = ops?.trips.get(r.ops.trip);
  return consistFor(world, {
    train: r?.trainId ?? (hit.key.startsWith("feed:") ? r.id : null),
    line: trip?.lineName ?? r?.line ?? r?.name ?? null,
    units: r?.ops?.units ? r.ops.units.map((id) => ({ type: ops?.units.get(id)?.type })) : null,
  });
}

/** The track (object) a vehicle at a dock stands on: the one with the dock's track name. */
function trackAt(world, dock) {
  if (!dock?.track) return null;
  return world.objects.find((o) => o.type === "track" && String(o.spec.track_id) === String(dock.track)) ?? null;
}

/**
 * Card provider (registry.registerCard): the train data of a train that is pointed at: its
 * consist with length, mass, axles, top speed, brake position and brake percentage (against the
 * one required on its track), axle and metre loads, and its vehicles as a strip; for every track of
 * the layout whether it may run there (rail/compat.js).
 * @param {import("../core/world.js").World} world
 * @param {import("../core/pick.js").Pickable} hit
 * @param {import("../core/pick.js").Card} card changed in place
 */
export function trainCard(world, hit, card) {
  if (hit.kind !== "train") return;
  const r = hit.ref;
  const c = consistOfHit(world, hit);
  if (!c) {
    card.sections.push({ title: "Train data", lines: ["No consist known: add one to the layout file (consists), by its line or train number."] });
    return;
  }
  const rows = consistRows(c);
  const track = trackAt(world, r?.dock) ?? r?.path?.track ?? null;
  const required = Number(track?.spec.min_brake_percentage) || null;
  if (required) {
    const ok = c.brakePercentage >= required;
    rows.splice(7, 0, ["Required on this track", `${required} % · ${ok ? "met" : "not met: the permitted speed is lower"}`]);
    if (!ok) {
      card.tone = "warn";
      card.status = `${card.status ? `${card.status} · ` : ""}brake percentage too low`;
    }
  }
  const speed = track ? sectionSystems(track.spec).values.max_speed_kmh : null;
  if (speed && c.vmax.kmh) rows.push(["Line speed here", `${speed} km/h${c.vmax.kmh < speed ? ` (the train ${c.vmax.kmh} km/h)` : ""}`]);
  card.sections.push({ title: "Train data", rows });
  card.strip = c.vehicles.map((v) => ({ label: v.t.label.split(" (")[0], kind: v.t.kind, length_m: v.t.length_m, isolated: v.isolated }));
  // may it run on its track, and on the other tracks of the layout?
  if (track) {
    const here = checkSection(c, track.spec);
    if (!here.ok) {
      card.tone = "bad";
      card.status = `${card.status ? `${card.status} · ` : ""}may not run on this track`;
    }
  }
  const compat = compatibilitySection(c, world);
  if (compat) {
    card.sections.push(compat);
    card.actions.push({ id: "compatibility", label: "Show where it may run" });
  }
}
