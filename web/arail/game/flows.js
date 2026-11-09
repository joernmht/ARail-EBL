/**
 * The flows of the big game: what the roles of the railway give each other (a budget, a timetable, a
 * train path, a fault report, a work order, a penalty), as types with a name, so that role games can
 * be wired together (core.js: a game's `takes` and `gives`; session.js: the bus that carries them)
 * and the role catalogue can say who gives what to whom (roles.js, `gives`).
 *
 * A flow is an event or a state. Events are single messages or handovers that queue up at the
 * receiver (a fault report, an order, an invoice). A state is a standing arrangement that holds
 * until it is replaced (a budget, a timetable, a contract, a staff plan): the receiver always works
 * with the latest. A flow's scale says how often it typically passes; the scales also sort the role
 * games into those played in shifts (seconds to hours) and those played in turns (days to years).
 * @module arail/game/flows
 */

/** The rhythms of decisions, from the signaller's seconds to the minister's years, with their length in seconds. */
export const SCALES = ["seconds", "minutes", "hours", "days", "months", "years"];
export const SCALE_S = { seconds: 1, minutes: 60, hours: 3600, days: 86400, months: 30 * 86400, years: 365 * 86400 };

/** Whether a scale is played in shifts (a clock runs, the roles act at the same time) or in turns. */
export const playedIn = (scale) => (SCALES.indexOf(scale) <= SCALES.indexOf("hours") ? "shift" : "turn");

export const FLOW_KINDS = ["event", "state"];

/** What the flows are about. */
export const FLOW_GROUPS = [
  { id: "money", name: "Money" },
  { id: "law-and-supervision", name: "Law and supervision" },
  { id: "contracts", name: "Contracts" },
  { id: "planning", name: "Planning" },
  { id: "operations", name: "Operations" },
  { id: "maintenance", name: "Maintenance" },
  { id: "vehicles", name: "Vehicles" },
  { id: "staff", name: "Staff" },
  { id: "passengers-and-freight", name: "Passengers and freight" },
  { id: "safety", name: "Safety" },
  { id: "knowledge", name: "Knowledge" },
];

/** What kind of body a party is. */
export const PARTY_KINDS = ["state", "authority", "infrastructure", "undertaking", "industry", "public", "education"];

/**
 * The parties: the organisations and groups the roles belong to.
 * @type {Array<{id: string, name: string, name_de: string, kind: string}>}
 */
export const PARTIES = [
  { id: "infrastructure-manager", name: "Infrastructure manager", name_de: "Eisenbahninfrastrukturunternehmen", kind: "infrastructure" },
];

/**
 * The flows.
 * @type {Array<{id: string, name: string, name_de: string, kind: "event" | "state", scale: string, group: string, text: string}>}
 */
export const FLOWS = [
  { id: "budget", name: "Budget", name_de: "Haushaltsmittel", kind: "state", scale: "years", group: "money", text: "Money assigned for a period, with its conditions; the receiver plans and spends within it." },
  { id: "funding-decision", name: "Funding decision", name_de: "Förderbescheid", kind: "event", scale: "months", group: "money", text: "A grant or funding approved or refused for a measure; the receiver can start, change or drop it." },
  { id: "payment", name: "Payment", name_de: "Zahlung", kind: "event", scale: "months", group: "money", text: "Money paid for a service delivered: contract payments, track access charges, invoices." },
  { id: "penalty", name: "Penalty", name_de: "Pönale", kind: "event", scale: "months", group: "money", text: "Money deducted or claimed for a failure under a contract or the performance regime." },
  { id: "transport-contract", name: "Transport contract", name_de: "Verkehrsvertrag", kind: "state", scale: "years", group: "contracts", text: "The terms a railway undertaking runs services under for a transport authority: what is ordered, what is paid, what a failure costs." },
  { id: "performance-report", name: "Performance report", name_de: "Leistungsbericht", kind: "event", scale: "months", group: "contracts", text: "A periodic account of results (punctuality, cancellations, faults, costs) to those who steer or pay." },
  { id: "timetable", name: "Timetable", name_de: "Fahrplan", kind: "state", scale: "months", group: "planning", text: "The planned trains with their times and tracks; operations run by it and are measured against it." },
  { id: "train-path", name: "Train path", name_de: "Trasse", kind: "event", scale: "days", group: "planning", text: "A path requested, offered or allocated for a train on the network." },
  { id: "possession", name: "Possession", name_de: "Sperrpause", kind: "state", scale: "months", group: "planning", text: "A planned closure of track for works; timetables and operations are arranged around it." },
  { id: "staff-plan", name: "Staff plan", name_de: "Stellen- und Bereitschaftsplan", kind: "state", scale: "years", group: "staff", text: "Posts, teams and on-call arrangements a unit works with." },
  { id: "asset-condition", name: "Asset condition", name_de: "Anlagenzustand", kind: "state", scale: "years", group: "maintenance", text: "The condition of infrastructure assets and what follows from it: failure rates and speed restrictions." },
  { id: "fault-report", name: "Fault report", name_de: "Störungsmeldung", kind: "event", scale: "minutes", group: "maintenance", text: "A fault or defect reported to those who repair it." },
  { id: "work-order", name: "Work order", name_de: "Arbeitsauftrag", kind: "event", scale: "hours", group: "maintenance", text: "An order to repair, inspect or build." },
  { id: "repair-status", name: "Repair status", name_de: "Stand der Entstörung", kind: "event", scale: "minutes", group: "maintenance", text: "Where a repair stands: the team on its way, on site, at work, done." },
  { id: "closure-request", name: "Closure request", name_de: "Antrag auf Gleissperrung", kind: "event", scale: "minutes", group: "maintenance", text: "A request to close a track for work on it; the signaller closes it when it is clear." },
  { id: "track-closure", name: "Track closure", name_de: "Gleissperrung", kind: "event", scale: "minutes", group: "operations", text: "A track closed or opened again in operations; those who work on it or plan trains over it act on it." },
  { id: "delay-notice", name: "Delay notice", name_de: "Verspätungsmeldung", kind: "event", scale: "minutes", group: "operations", text: "A train's delay or cancellation told to those who must react to it." },
  { id: "dispatching-order", name: "Dispatching order", name_de: "Dispositionsentscheidung", kind: "event", scale: "minutes", group: "operations", text: "The order of trains, holds and diversions decided by the infrastructure manager's dispatcher." },
  { id: "connection-request", name: "Connection request", name_de: "Anschlusswunsch", kind: "event", scale: "minutes", group: "operations", text: "A request to hold a train for connecting passengers." },
  { id: "movement-authority", name: "Movement authority", name_de: "Fahrerlaubnis", kind: "event", scale: "seconds", group: "operations", text: "Permission for a train to run: a signal aspect, a written order, an ETCS movement authority." },
  { id: "passenger-information", name: "Passenger information", name_de: "Reisendeninformation", kind: "event", scale: "minutes", group: "passengers-and-freight", text: "What passengers are told about a disruption and their alternatives." },
  { id: "emergency-call", name: "Emergency call", name_de: "Notfallmeldung", kind: "event", scale: "seconds", group: "safety", text: "An emergency reported, with the measures taken at once." },
];

const BY_ID = new Map();

/** A flow by its id (undefined if there is none). */
export function flowOf(id) {
  if (BY_ID.size !== FLOWS.length) {
    BY_ID.clear();
    for (const f of FLOWS) BY_ID.set(f.id, f);
  }
  return BY_ID.get(id);
}

/**
 * Problems of the catalogue of flows and parties (empty when it is sound).
 * @returns {string[]}
 */
export function validateFlows(flows = FLOWS, parties = PARTIES) {
  const out = [], ids = new Set(), groups = new Set(FLOW_GROUPS.map((g) => g.id));
  const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  for (const f of flows) {
    const at = `flow ${f?.id ?? "?"}`;
    if (ids.has(f.id)) out.push(`${at}: the id is used twice`);
    ids.add(f.id);
    if (!kebab.test(f.id ?? "")) out.push(`${at}: the id must be kebab-case`);
    for (const k of ["name", "name_de", "text"]) if (typeof f[k] !== "string" || !f[k].trim()) out.push(`${at}: ${k} is missing`);
    if (!FLOW_KINDS.includes(f.kind)) out.push(`${at}: kind must be event or state`);
    if (!SCALES.includes(f.scale)) out.push(`${at}: scale must be one of ${SCALES.join(", ")}`);
    if (!groups.has(f.group)) out.push(`${at}: unknown group "${f.group}"`);
  }
  const pids = new Set();
  for (const p of parties) {
    const at = `party ${p?.id ?? "?"}`;
    if (pids.has(p.id)) out.push(`${at}: the id is used twice`);
    pids.add(p.id);
    if (!kebab.test(p.id ?? "")) out.push(`${at}: the id must be kebab-case`);
    for (const k of ["name", "name_de"]) if (typeof p[k] !== "string" || !p[k].trim()) out.push(`${at}: ${k} is missing`);
    if (!PARTY_KINDS.includes(p.kind)) out.push(`${at}: kind must be one of ${PARTY_KINDS.join(", ")}`);
  }
  return out;
}
