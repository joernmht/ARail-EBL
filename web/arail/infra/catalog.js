/**
 * The catalogue of the infrastructure simulation: condition grades, disciplines, asset types with
 * their IFC 4.3 class, service life, costs, failure behaviour and how their state can be known,
 * the generations of interlockings, the inspection methods and the kinds of measures.
 *
 * Numbers are plausible orders of magnitude for teaching, not figures of a real infrastructure
 * manager; the layout's `infrastructure` entry can change all of them (`types`, see config.js).
 * @module arail/infra/catalog
 */
import { moodColor } from "../core/colors.js";

/* ---------------------------------------------------------------- condition grades */

/**
 * Condition grades like those of DB InfraGO's condition report (InfraGO-Zustandsbericht): a
 * continuous grade value from 1.0 (as new) to 5.99 (deficient); grade 6 is the special category of
 * an asset that restricts operations (here: an asset with an open fault). The true condition of an
 * asset is its health h (1 = new … 0 = worn out); its grade value is 1 + 4.99 (1 − h), its grade
 * the whole number of it.
 */
export const GRADES = [
  { grade: 1, label: "as new", de: "neuwertig" },
  { grade: 2, label: "good", de: "gut" },
  { grade: 3, label: "fair", de: "mittelmäßig" },
  { grade: 4, label: "poor", de: "schlecht" },
  { grade: 5, label: "deficient", de: "mangelhaft" },
  { grade: 6, label: "restricting", de: "einschränkend" },
];

/** Grade value 1.0 … 5.99 of a health 1 … 0. */
export const gradeValue = (h) => 1 + 4.99 * (1 - Math.min(1, Math.max(0, h)));
/** Grade 1 … 5 of a health (grade 6 is given to assets with an open fault, see `assetGrade`). */
export const gradeOf = (h) => Math.min(5, Math.max(1, Math.floor(gradeValue(h))));
/** Health of a grade value. */
export const healthOf = (g) => Math.min(1, Math.max(0, 1 - (g - 1) / 4.99));
/** "4 poor". */
export const gradeLabel = (g) => (g >= 1 && g <= 6 ? `${g} ${GRADES[g - 1].label}` : "unknown");

/**
 * Colour of a grade (value) on the mood scale of the corporate design: Türkis (1) → Gelb (3) → Rot (5
 * and 6).
 * @param {number} g grade or grade value; null for unknown (grey)
 */
export function gradeColour(g, alpha = 1, k = 1) {
  if (g == null || !Number.isFinite(g)) return `rgba(150,156,166,${alpha})`;
  return moodColor(1 - (Math.min(5, Math.max(1, g)) - 1) / 4, alpha, k);
}

/* ---------------------------------------------------------------- disciplines */

/** Disciplines (Fachdienste): each has its Anlagenverantwortliche (ALV) and its technicians. */
export const DISCIPLINES = {
  track: { label: "Track", de: "Fahrbahn", short: "Track" },
  signal: { label: "Signalling and telecoms", de: "Leit- und Sicherungstechnik, Telekommunikation", short: "LST" },
  electric: { label: "Electrical", de: "Energieanlagen, Oberleitung", short: "Electric" },
  station: { label: "Stations", de: "Verkehrsstationen", short: "Station" },
};
export const DISCIPLINE_IDS = Object.keys(DISCIPLINES);

/* ---------------------------------------------------------------- interlockings */

/**
 * Generations of interlockings (Stellwerke). The field elements (signals, switches, level
 * crossings) of an interlocking report as much as their interlocking can: a mechanical one nothing
 * (a train driver reports a fault), a relay interlocking the fault on its panel, an electronic one
 * faults and some diagnosis, a digital one live condition data of the electronics.
 * `share`: the part of a field element's condition it reports live; `detect_min`: how long until a
 * fault is known.
 */
export const GENERATIONS = {
  mechanical: { label: "Mechanical", de: "mechanisches Stellwerk", life_y: 80, share: 0, report: "driver", detect_min: 40, renew_factor: 1.2 },
  relay: { label: "Relay", de: "Relaisstellwerk (Spurplan)", life_y: 50, share: 0, report: "panel", detect_min: 3, renew_factor: 1.1 },
  electronic: { label: "Electronic (ESTW)", de: "elektronisches Stellwerk", life_y: 20, share: 0.3, report: "diagnosis", detect_min: 1, renew_factor: 1 },
  digital: { label: "Digital (DSTW)", de: "digitales Stellwerk", life_y: 20, share: 0.6, report: "diagnosis", detect_min: 1, renew_factor: 1 },
};
export const GENERATION_IDS = Object.keys(GENERATIONS);

/** How faults become known, by the path they are reported on. */
export const REPORTS = {
  driver: "a train driver reports it",
  panel: "the interlocking's panel shows it",
  diagnosis: "the diagnosis reports it",
  monitoring: "remote monitoring reports it",
  passengers: "passengers report it",
};

/* ---------------------------------------------------------------- asset types */

/**
 * Asset types. Costs in euros (per piece, or per km for linear assets), times in hours, rates per
 * year (per piece or per km). The failure rate is that of an asset in good condition at mid-life;
 * it grows as the condition falls (see `hazardFactor`).
 *
 * - `ifc`: the IFC 4.3 (IFC4X3_ADD2) entity and predefined type of the asset's main element. IFC has
 *   no class of its own for an interlocking (here its logic, IfcController PROGRAMMABLE, in the
 *   signal box, an IfcBuilding) nor for a platform (IfcSlab, user-defined);
 * - service lives follow the ABBV (the redemption ordinance of the EKrG) where it has them;
 * - `renew_per_unit`: an interlocking's renewal costs `renew_eur` per operated unit (Stelleinheit:
 *   each signal, switch and level crossing it controls);
 * - `life_y`: service life (Nutzungsdauer); `renew_eur`, `renew_days` (on site); `repair_eur`,
 *   `repair_h` (a fault), `fix_gain` (health a fault repair gives back);
 * - `fail_per_y`, `effect`: what a fault does to the trains (`delay_min` per train, `share` of the
 *   line's trains affected, `hold`: trains stop at the station until it is repaired) or the
 *   station (`station_eur_h`: an outage of a lift or display, per hour);
 * - `report`: how its faults become known unless an interlocking reports them (field elements);
 *   `field`: a field element of an interlocking, with the share of its condition its interlocking
 *   can report (`field_share`);
 * - `live`: the share of its condition known live from its own monitoring (GSM-R network
 *   management, substation SCADA, lift remote monitoring); `retrofit`: condition monitoring that
 *   can be added (share, cost);
 * - `drone`: the share of its condition a drone can see; `inspect`: the default inspection
 *   (method and times a year), `min_per_year` the minimum the rules ask for, `inspect_min` the
 *   minutes on site (per piece or km);
 * - `possession`: work on it needs a track possession (Sperrpause).
 */
export const ASSET_TYPES = {
  track: {
    label: "Track section", plural: "Track sections", de: "Gleis (Oberbau)", discipline: "track", linear: true,
    ifc: ["IfcRailwayPart", "PLAINTRACK"], life_y: 30, renew_eur: 800_000, renew_days: 6, repair_eur: 12_000, repair_h: 4, fix_gain: 0.06,
    fail_per_y: 0.6, load: true, effect: { delay_min: 1.5, share: 0.5, what: "speed restriction (La)" },
    report: "driver", drone: 0.4, inspect: { method: "train", per_year: 2 }, min_per_year: 2, inspect_min: 50, possession: true,
  },
  turnout: {
    label: "Switch", plural: "Switches", de: "Weiche", discipline: "track", field: true, field_share: 0.8,
    ifc: ["IfcRailwayPart", "TURNOUTTRACK"], life_y: 20, renew_eur: 280_000, renew_days: 3, repair_eur: 6_000, repair_h: 3, fix_gain: 0.08,
    fail_per_y: 0.9, load: true, effect: { delay_min: 4, share: 0.5, what: "route not available" },
    report: "driver", drone: 0.3, retrofit: { share: 0.5, eur: 25_000, label: "switch diagnosis (Weichendiagnose)" },
    inspect: { method: "walk", per_year: 4 }, min_per_year: 4, inspect_min: 45, possession: true,
  },
  signal: {
    label: "Signal", plural: "Signals", de: "Signal", discipline: "signal", field: true, field_share: 1,
    ifc: ["IfcSignal", "VISUAL"], life_y: 30, renew_eur: 90_000, renew_days: 1, repair_eur: 2_500, repair_h: 2, fix_gain: 0.1,
    fail_per_y: 0.25, effect: { delay_min: 3, share: 0.5, what: "trains pass on the substitute signal (Zs 1)" },
    report: "driver", drone: 0.35, inspect: { method: "walk", per_year: 1 }, min_per_year: 1, inspect_min: 30,
  },
  balise: {
    label: "Balise", plural: "Balises", de: "Balise / PZB-Gleismagnet", discipline: "signal",
    ifc: ["IfcCommunicationsAppliance", "TRANSPONDER"], life_y: 20, renew_eur: 9_000, renew_days: 0.2, repair_eur: 1_500, repair_h: 1, fix_gain: 0.2,
    fail_per_y: 0.05, effect: { delay_min: 1, share: 0.5, what: "train protection restricted" },
    report: "driver", drone: 0, inspect: { method: "diagnose", per_year: 0.5 }, min_per_year: 0.5, inspect_min: 20, possession: true,
  },
  interlocking: {
    label: "Interlocking", plural: "Interlockings", de: "Stellwerk", discipline: "signal",
    ifc: ["IfcController", "PROGRAMMABLE"], life_y: null, renew_eur: 400_000, renew_per_unit: true, renew_days: 10, repair_eur: 8_000, repair_h: 3, fix_gain: 0.05,
    fail_per_y: 0.4, effect: { delay_min: 12, share: 1, hold: true, what: "no routes can be set" },
    report: "panel", drone: 0, inspect: { method: "walk", per_year: 2 }, min_per_year: 1, inspect_min: 120,
  },
  "level-crossing": {
    label: "Level crossing", plural: "Level crossings", de: "Bahnübergang (BÜ-Sicherungsanlage)", discipline: "signal", field: true, field_share: 0.8,
    ifc: ["IfcFacilityPart", "LEVELCROSSING"], life_y: 30, renew_eur: 1_000_000, renew_days: 4, repair_eur: 5_000, repair_h: 3, fix_gain: 0.08,
    fail_per_y: 0.8, effect: { delay_min: 5, share: 1, what: "trains stop and pass at walking pace" },
    report: "driver", drone: 0.45, retrofit: { share: 0.4, eur: 60_000, label: "remote monitoring and diagnosis" },
    inspect: { method: "walk", per_year: 2 }, min_per_year: 1, inspect_min: 90,
  },
  cable: {
    label: "Cable route", plural: "Cable routes", de: "Kabeltrasse (Kabelkanal, Kabel)", discipline: "signal", linear: true,
    ifc: ["IfcCableCarrierSegment", "CABLETRUNKINGSEGMENT"], life_y: 40, renew_eur: 140_000, renew_days: 3, repair_eur: 9_000, repair_h: 6, fix_gain: 0.05,
    fail_per_y: 0.06, theft_per_y: 0.04, effect: { delay_min: 6, share: 1, what: "signals dark" },
    report: "panel", drone: 0.5, inspect: { method: "walk", per_year: 0.5 }, min_per_year: 0.2, inspect_min: 25,
  },
  gsmr: {
    label: "GSM-R site", plural: "GSM-R sites", de: "GSM-R-Standort (Mast, Basisstation, Antennen)", discipline: "signal",
    ifc: ["IfcMobileTelecommunicationsAppliance", "BASETRANSCEIVERSTATION"], life_y: 15, renew_eur: 300_000, renew_days: 2, repair_eur: 4_000, repair_h: 4, fix_gain: 0.08,
    fail_per_y: 0.3, effect: { delay_min: 2, share: 0.6, what: "no train radio in the cell" },
    report: "monitoring", live: 0.7, drone: 0.4, inspect: { method: "walk", per_year: 1 }, min_per_year: 1, inspect_min: 60,
  },
  catenary: {
    label: "Overhead line section", plural: "Overhead line sections", de: "Oberleitung (Speiseabschnitt)", discipline: "electric", linear: true,
    ifc: ["IfcCableSegment", "CONTACTWIRESEGMENT"], life_y: 30, renew_eur: 900_000, renew_days: 5, repair_eur: 15_000, repair_h: 5, fix_gain: 0.05,
    fail_per_y: 0.1, load: true, effect: { delay_min: 20, share: 1, hold: true, what: "electric trains cannot run" },
    report: "monitoring", drone: 0.9, inspect: { method: "drone", per_year: 2 }, min_per_year: 1, inspect_min: 40, possession: true,
  },
  substation: {
    label: "Substation", plural: "Substations", de: "Unterwerk", discipline: "electric",
    ifc: ["IfcTransformer", "VOLTAGE"], life_y: 40, renew_eur: 6_000_000, renew_days: 15, repair_eur: 20_000, repair_h: 6, fix_gain: 0.05,
    fail_per_y: 0.15, effect: { delay_min: 3, share: 1, what: "less power for the trains" },
    report: "monitoring", live: 0.7, drone: 0.15, inspect: { method: "walk", per_year: 1 }, min_per_year: 1, inspect_min: 180,
  },
  platform: {
    label: "Platform", plural: "Platforms", de: "Bahnsteig", discipline: "station",
    ifc: ["IfcSlab", "USERDEFINED (PLATFORM)"], life_y: 50, renew_eur: 2_500_000, renew_days: 20, repair_eur: 8_000, repair_h: 6, fix_gain: 0.06,
    fail_per_y: 0.06, effect: { station_eur_h: 60, what: "part of the platform closed" },
    report: "passengers", drone: 0.6, inspect: { method: "walk", per_year: 1 }, min_per_year: 1, inspect_min: 60,
  },
  lift: {
    label: "Lift", plural: "Lifts", de: "Aufzug", discipline: "station",
    ifc: ["IfcTransportElement", "ELEVATOR"], life_y: 15, renew_eur: 380_000, renew_days: 15, repair_eur: 2_500, repair_h: 4, fix_gain: 0.1,
    fail_per_y: 2, effect: { station_eur_h: 40, what: "no step-free access" },
    report: "monitoring", live: 0.6, drone: 0, inspect: { method: "walk", per_year: 2 }, min_per_year: 1, inspect_min: 90,
  },
  pis: {
    label: "Passenger display", plural: "Passenger displays", de: "Fahrgastinformationsanzeiger", discipline: "station",
    ifc: ["IfcAudioVisualAppliance", "DISPLAY"], life_y: 12, renew_eur: 45_000, renew_days: 1, repair_eur: 1_200, repair_h: 2, fix_gain: 0.15,
    fail_per_y: 0.7, effect: { station_eur_h: 15, what: "no departure information" },
    report: "monitoring", live: 0.8, drone: 0, inspect: { method: "walk", per_year: 1 }, min_per_year: 0.5, inspect_min: 20,
  },
};
export const TYPE_IDS = Object.keys(ASSET_TYPES);

/**
 * Failure rate factor of a health: 0.25 for a new asset, about 1 at grade 3–4, 4.25 for one worn out.
 * @param {number} h health 0..1
 */
export const hazardFactor = (h) => 0.25 + 4 * Math.pow(1 - Math.min(1, Math.max(0, h)), 2.5);

/** Highest health a repair can bring an asset back to, by its age (a renewal brings it to 1). */
export const repairCap = (ageY, lifeY) => Math.max(0.45, 0.95 - 0.5 * Math.min(1.5, Math.max(0, ageY) / Math.max(1, lifeY)));

/* ---------------------------------------------------------------- inspections */

/**
 * Inspection methods. `sigma`: the error of the health found; `types`: what they can inspect
 * (all types when missing); drones see only the share `drone` of a type's condition.
 */
export const METHODS = {
  walk: { label: "On-site inspection", de: "Inspektion vor Ort", sigma: 0.04, staff: true, servicing: true },
  diagnose: { label: "Diagnostic test", de: "Messung / Prüfung", sigma: 0.05, staff: true, servicing: true, types: ["signal", "balise", "level-crossing", "interlocking", "turnout", "gsmr"] },
  drone: { label: "Drone flight", de: "Drohnenbefliegung", sigma: 0.07, pilot: true },
  train: { label: "Measurement train", de: "Messzug", sigma: 0.03, types: ["track", "catenary", "gsmr", "turnout"], eur_km: 70 },
};

/* ---------------------------------------------------------------- measures */

/**
 * Kinds of measures an ALV can propose:
 * - `repair` (Instandsetzung): own staff or a framework contractor, from the maintenance budget;
 * - `renew` (Ersatzinvestition, like for like): a project through the HOAI phases, LuFV money;
 * - `modernize`: renewal with today's technology (an interlocking becomes digital, a switch gets a
 *   diagnosis): a project, LuFV money, more live information afterwards;
 * - `retrofit`: condition monitoring added to an asset (maintenance budget);
 * - `upgrade` (Ausbau): a project of the layout's `upgrades` that changes the infrastructure; it
 *   needs planning approval and federal money, which needs a benefit-cost ratio above 1.
 */
export const MEASURES = {
  repair: { label: "Repair", de: "Instandsetzung", project: false, funding: "maintenance" },
  renew: { label: "Renewal (like for like)", de: "Ersatzinvestition", project: true, funding: "lufv" },
  modernize: { label: "Renewal with new technology", de: "Ersatzinvestition mit neuer Technik", project: true, funding: "lufv" },
  retrofit: { label: "Add condition monitoring", de: "Zustandsüberwachung nachrüsten", project: false, funding: "maintenance" },
  upgrade: { label: "Upgrade", de: "Ausbau (Neu- und Ausbauvorhaben)", project: true, funding: "federal" },
};

/** Health a planned repair gives back (up to the repair cap). */
export const REPAIR_GAIN = 0.3;
/** Repairs cost this multiple of a fault repair. */
export const REPAIR_FACTOR = 5;
