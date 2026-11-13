/**
 * Wagons, cuts and trains of the hump: a wagon's figures from the vehicle catalogue (rail/vehicles.js)
 * and the hump's own types, its rolling resistance drawn by its class and the season; the cuts of a
 * train (consecutive wagons for the same classification track run as one); random trains for tests.
 * @module arail/hump/cuts
 */
import { VEHICLE_TYPES } from "../rail/vehicles.js";
import { ROLLING, ROTATING_T_PER_AXLE, SEASONS, WAGONS } from "./params.js";

/** Bogie wheelbase of a 4-axle wagon (m); overhang from the buffer face to the bogie pivot or the axle (m). */
const BOGIE_M = 1.8, OVERHANG_BOGIE_M = 2.6, OVERHANG_AXLE_M = 3;

/**
 * The figures of a wagon type: the catalogue's (length over buffers, empty mass, load, axles) with
 * the hump's (drag area, rolling class), or the hump's own type.
 * @param {string} type
 * @returns {{type: string, label: string, length_m: number, mass_t: number, load_t: number, axles: number,
 *   cwA_empty: number, cwA_loaded: number, rolling: string[]}}
 */
export function wagonType(type) {
  const hump = WAGONS[type];
  const cat = VEHICLE_TYPES[type]?.kind === "wagon" ? VEHICLE_TYPES[type] : null;
  if (!hump && !cat) throw new Error(`no wagon type ${type}`);
  const base = cat || hump;
  return {
    type, label: base.label, length_m: base.length_m, mass_t: base.mass_t, load_t: base.load_t || 0, axles: base.axles,
    cwA_empty: hump?.cwA_empty ?? 4, cwA_loaded: hump?.cwA_loaded ?? 4, rolling: hump?.rolling ?? ["medium", "good"],
  };
}

/** The wagon types the hump knows (those of the catalogue that are freight wagons, and its own). */
export function wagonTypes() {
  const ids = new Set([...Object.keys(VEHICLE_TYPES).filter((k) => VEHICLE_TYPES[k].kind === "wagon"), ...Object.keys(WAGONS)]);
  return [...ids].filter((k) => VEHICLE_TYPES[k]?.kind === "wagon" || WAGONS[k].length_m);
}

/**
 * Axle positions of a wagon, m from its front buffer.
 * @param {number} length_m length over buffers
 * @param {number} axles 2 or 4 (other counts: spread evenly between the bogies' places)
 */
export function axlePositions(length_m, axles) {
  if (axles === 2) return [OVERHANG_AXLE_M, length_m - OVERHANG_AXLE_M];
  if (axles === 4) {
    const a = OVERHANG_BOGIE_M, b = length_m - OVERHANG_BOGIE_M;
    return [a - BOGIE_M / 2, a + BOGIE_M / 2, b - BOGIE_M / 2, b + BOGIE_M / 2];
  }
  const a = OVERHANG_AXLE_M, b = length_m - OVERHANG_AXLE_M;
  return Array.from({ length: axles }, (_, i) => (axles > 1 ? a + ((b - a) * i) / (axles - 1) : length_m / 2));
}

/**
 * A wagon as the hump simulates it.
 * @typedef {{id: string, type: string, label: string, length_m: number, mass_t: number, axles: number[], rot_t: number,
 *   w: number, rolling: string, cwA: number, loaded: number, destination: string|null, track: string|null,
 *   noHump: boolean, careful: boolean}} Wagon
 *   axles: positions from its front buffer (m); rot_t: equivalent mass of the rotating wheelsets; w: rolling resistance (N/kN)
 */

/**
 * A wagon from its spec: `{type, loaded (0…1 or true), load_t?, w_nkn?, cwA_m2?, destination?, track?, noHump?, careful?, id?}`.
 * Its rolling resistance is drawn from its class (the type's, empty or loaded) plus what the season adds, unless `w_nkn` gives it.
 * @param {object} spec
 * @param {{truncNormal: Function}} rng
 * @param {string} [season] a key of SEASONS
 * @returns {Wagon}
 */
export function makeWagon(spec, rng, season = "summer") {
  const t = wagonType(spec.type);
  const loaded = spec.load_t != null ? Math.max(0, Math.min(1, spec.load_t / (t.load_t || 1))) : spec.loaded === true ? 1 : Math.max(0, Math.min(1, Number(spec.loaded) || 0));
  const mass_t = t.mass_t + (spec.load_t != null ? Number(spec.load_t) : loaded * t.load_t);
  const rolling = t.rolling[loaded >= 0.5 ? 1 : 0];
  const add = (SEASONS[season] || SEASONS.summer).rolling_add;
  const c = ROLLING[rolling];
  const w = spec.w_nkn != null ? Number(spec.w_nkn) : rng.truncNormal(c.mean + add, c.sd, c.lo + add, c.hi + add);
  return {
    id: String(spec.id ?? ""), type: t.type, label: t.label, length_m: t.length_m, mass_t, axles: axlePositions(t.length_m, t.axles),
    rot_t: t.axles * ROTATING_T_PER_AXLE, w, rolling, cwA: spec.cwA_m2 != null ? Number(spec.cwA_m2) : loaded >= 0.5 ? t.cwA_loaded : t.cwA_empty, loaded,
    destination: spec.destination ?? null, track: spec.track != null ? String(spec.track) : null, noHump: !!spec.noHump, careful: !!spec.careful,
  };
}

/**
 * The cuts of a train: consecutive wagons for the same classification track run as one cut (a wagon
 * that must not be humped is a cut of its own). The track comes from the wagon (`track`) or from the
 * sorting plan by its destination.
 * @param {Wagon[]} wagons from the end that goes over the hump first
 * @param {Record<string, string>} [sorting] destination → classification track
 * @returns {{wagons: Wagon[], track: string, noHump: boolean}[]}
 */
export function cutsOf(wagons, sorting = {}) {
  const cuts = [];
  for (const w of wagons) {
    const track = w.track ?? (w.destination != null ? sorting[w.destination] : null);
    if (track == null) throw new Error(`wagon ${w.id || w.type}: no classification track for ${w.destination ?? "it"}`);
    const last = cuts[cuts.length - 1];
    if (last && last.track === String(track) && !last.noHump && !w.noHump) last.wagons.push(w);
    else cuts.push({ wagons: [w], track: String(track), noHump: w.noHump });
  }
  return cuts;
}

/** Wagons per cut and how often (the usual mix: most cuts are single wagons). */
export const CUT_SIZES = [[1, 0.55], [2, 0.25], [3, 0.12], [4, 0.08]];

/**
 * A random train as a list of wagon specs, for tests and the command line: cuts of 1–4 wagons, each
 * for a random track other than the one before.
 * @param {{next: Function, pick: Function, chance: Function}} rng
 * @param {{wagons?: number, tracks: string[], types?: string[], loaded?: number}} options
 *   wagons: about how many (the last cut is whole); loaded: the share of loaded wagons
 * @returns {object[]} wagon specs with `track` and no id (`HumpSimulation.hump` numbers them by train)
 */
export function randomTrain(rng, { wagons = 30, tracks, types = ["eanos", "habbins", "zacns", "sgns", "hbbillns"], loaded = 0.5 }) {
  if (!tracks?.length) throw new Error("randomTrain needs the tracks");
  const out = [];
  let last = null, n = 0;
  while (n < wagons) {
    const u = rng.next();
    let size = CUT_SIZES[CUT_SIZES.length - 1][0];
    for (let i = 0, acc = 0; i < CUT_SIZES.length; i++) {
      acc += CUT_SIZES[i][1];
      if (u < acc) {
        size = CUT_SIZES[i][0];
        break;
      }
    }
    const choices = tracks.length > 1 ? tracks.filter((t) => t !== last) : tracks;
    const track = rng.pick(choices);
    for (let i = 0; i < size; i++, n++) out.push({ type: rng.pick(types), loaded: rng.chance(loaded) ? 1 : 0, track });
    last = track;
  }
  return out;
}
