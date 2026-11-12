// The glossary of the game: railway terms the games use, each in a line. A term found in a
// question can be tapped to read it, and is kept as met (progress.js), so the logbook collects
// them as cards. Simplified for teaching, for Germany; `de` is the German word where the entry is
// an English one. Data and plain functions only: no DOM.

/**
 * @typedef {object} Term
 * @property {string} id kebab-case
 * @property {string} term as it is shown
 * @property {string} [de] the German word
 * @property {string} line what it is, in a line or two
 * @property {RegExp} find how it is written in the games' texts
 */

/** @type {Term[]} */
export const TERMS = [
  { id: "zs1", term: "Zs 1", de: "Ersatzsignal", line: "The substitute signal: three white lights below a main signal. It lets a train pass a signal that shows stop or has failed, without a written order, at low speed.", find: /\b(Zs ?1|substitute signals?)\b/ },
  { id: "ril-408", term: "Ril 408", de: "Fahrdienstvorschrift", line: "DB's rulebook for running trains and shunting: what a signaller and a driver may do, and in which order.", find: /\bRil 408\b/ },
  { id: "fdl", term: "Signaller", de: "Fahrdienstleiter/in (Fdl)", line: "Sets the routes and lets trains run in their station or section; alone responsible that a train's path is free and safe.", find: /\b(Fahrdienstleiter(?:\/in)?|Fdl)\b/ },
  { id: "route", term: "Route", de: "Fahrstraße", line: "A locked path from a start signal to a destination: the points are set and held, conflicting routes are shut out, then the signal clears.", find: /\b(routes?|Fahrstraße)\b/ },
  { id: "closure", term: "Track closure", de: "Sperrung", line: "A track taken out of use so that nobody is routed into it, for example while a team works there. Only the signaller sets and lifts it.", find: /\b(track closures?|closures?|Sperrung)\b/ },
  { id: "possession", term: "Possession", de: "Sperrpause", line: "A planned closure of a track for works; it costs the trains time or a detour, so it is agreed long before.", find: /\b(possessions?|Sperrpause)\b/ },
  { id: "la", term: "Speed restriction", de: "Langsamfahrstelle (La)", line: "A stretch where trains must run slower than the line allows, because of its condition or of works; every one costs minutes, every day.", find: /\b(speed restrictions?|Langsamfahrstelle)\b/ },
  { id: "alv", term: "Asset responsible", de: "Anlagenverantwortliche/r (ALV)", line: "The engineer who answers for the safe condition of the assets of an area: inspects them, and says what must be repaired, restricted or closed.", find: /\b(asset responsible|ALV|Anlagenverantwortliche)/ },
  { id: "lufv", term: "LuFV", de: "Leistungs- und Finanzierungsvereinbarung", line: "The agreement by which the federal government pays for replacing the existing network, against quality targets. Replacement money that is not spent in its year is lost.", find: /\bLuFV\b/ },
  { id: "replacement", term: "Replacement money", de: "Ersatzinvestitionen", line: "Federal money for renewing what exists (track, points, signals, bridges). Maintenance, by contrast, is paid from the infrastructure manager's own funds.", find: /\b(replacement money|renewals?)\b/ },
  { id: "grade", term: "Condition grade", de: "Zustandsnote", line: "The state of the network as a school grade, 1 very good to 6 unusable. It worsens by wear every year and improves only by renewals.", find: /\b(condition grade|grade)\b/ },
  { id: "eba", term: "EBA", de: "Eisenbahn-Bundesamt", line: "The federal railway authority: supervises the safety of the federal railways, approves works and vehicles, and can order restrictions.", find: /\bEBA\b/ },
  { id: "inspection", term: "Inspection", de: "Inspektion", line: "The regular check of an asset by fixed intervals. A missed interval is a breach, whatever the asset's state.", find: /\binspections?\b/ },
  { id: "hoai", term: "HOAI phases", de: "Leistungsphasen", line: "The nine steps of planning a building project, from the first idea to handing over; a project stopped between them loses time, not only money.", find: /\b(HOAI|Leistungsphasen?)\b/ },
  { id: "bereinigung", term: "Night session", de: "Bereinigungssitzung", line: "The budget committee's last sitting on the next federal budget, through the night: every line is settled, the total must fit under the ceiling.", find: /\b(night session|Bereinigungssitzung)\b/ },
  { id: "rapporteur", term: "Rapporteur", de: "Berichterstatter/in", line: "The member of the budget committee who works through one ministry's budget for their parliamentary group and negotiates its lines.", find: /\b(rapporteurs?|Berichterstatter)/ },
  { id: "sperrvermerk", term: "Qualified block", de: "qualifizierter Sperrvermerk", line: "Money in the budget that the ministry may spend only after the committee has released it, usually once a report is in.", find: /\b(qualified block|Sperrvermerk)\b/ },
  { id: "regionalisierung", term: "Regionalisation funds", de: "Regionalisierungsmittel", line: "Federal money that goes to the Länder by law, for ordering regional trains. The budget committee cannot move it in a night.", find: /\b(Regionalisierungsmittel|regionalisation funds)\b/ },
  { id: "bedarfsplan", term: "Requirement plan", de: "Bedarfsplan", line: "The law that lists the new and upgraded lines the federation means to build. A project not in it gets no federal construction money.", find: /\bBedarfsplan\b/ },
  { id: "grant", term: "Construction grant", de: "Baukostenzuschuss", line: "Federal money for building that is not paid back and earns no return; equity, by contrast, must earn one, through track access charges.", find: /\b(Baukostenzuschuss|construction grant)\b/ },
  { id: "access-charge", term: "Track access charge", de: "Trassenpreis", line: "What a railway undertaking pays the infrastructure manager for every kilometre a train runs on its path.", find: /\b(track access charges?|Trassenpreis)/ },
  { id: "authority", term: "Transport authority", de: "Aufgabenträger", line: "The public body that orders regional trains with tax money, by a contract of many years with a railway undertaking.", find: /\b(transport authority|Aufgabenträger)\b/ },
  { id: "contract", term: "Transport contract", de: "Verkehrsvertrag", line: "Says which trains the operator runs, what it is paid per train-km, and what is deducted when trains are late, dirty, short or cancelled.", find: /\b(transport contract|Verkehrsvertrag)\b/ },
  { id: "malus", term: "Penalty", de: "Malus / Pönale", line: "A deduction from the operator's payment for poor quality, by the contract's list. Too mild, and quality slides; too hard, and the operator runs out of money.", find: /\b(penalt(?:y|ies)|malus|Pönale)\b/i },
  { id: "train-km", term: "Train-km", de: "Zugkilometer", line: "One train run one kilometre: the unit regional services are ordered and paid in.", find: /\btrain-km\b/ },
  { id: "transportleitung", term: "Operations control", de: "Transportleitung", line: "The railway undertaking's own control room: follows its trains, crews and units through the day and decides what to do when one of them fails.", find: /\b(Transportleitung|operations control)\b/ },
  { id: "connection", term: "Connection", de: "Anschluss", line: "Passengers changing from one train to another. Holding the second train saves them an hour and makes everybody on it late.", find: /\bconnections?\b/ },
  { id: "stand-by", term: "Stand-by", de: "Bereitschaft", line: "A driver or a unit kept ready for the day's trouble. It costs money every day and saves a train on a few.", find: /\b(stand-by|spare units?)\b/ },
  { id: "driving-time", term: "Driving time", de: "Fahrzeit auf dem Führerstand", line: "How long a driver may drive in a shift is limited by law and agreement; a shift stretched beyond it is a breach, however late the trains are.", find: /\b(driving time|shift limit|rest period)\b/ },
  { id: "ecm", term: "ECM", de: "für die Instandhaltung zuständige Stelle", line: "The entity in charge of maintenance of a vehicle: decides whether a unit with a defect may run on, run restricted, or must stop.", find: /\bECM\b/ },
  { id: "emergency-team", term: "Emergency team", de: "Entstörtrupp", line: "Technicians on shift for faults, by trade: signalling or track. What is behind a fault is known only when a team has looked.", find: /\b(emergency teams?|Entstör)/ },
  { id: "on-call", term: "On call", de: "Rufbereitschaft", line: "A technician at home who can be called in when the teams on shift are not enough: paid for standing by, and overtime for every call-out.", find: /\bon call\b/ },
];

/** A term by its id, or null. */
export function termOf(id) {
  return TERMS.find((t) => t.id === id) ?? null;
}

/**
 * A text cut where it names terms of the glossary: plain stretches and terms in their order. Each
 * term is marked once, where it comes first; where two overlap, the one that begins first wins.
 * @param {string} text
 * @returns {Array<string | {term: Term, text: string}>}
 */
export function mark(text) {
  const t = String(text ?? ""), hits = [];
  for (const term of TERMS) {
    const m = term.find.exec(t);
    if (m) hits.push({ term, at: m.index, text: m[0] });
  }
  hits.sort((a, b) => a.at - b.at || b.text.length - a.text.length);
  const out = [];
  let i = 0;
  for (const hit of hits) {
    if (hit.at < i) continue;
    if (hit.at > i) out.push(t.slice(i, hit.at));
    out.push({ term: hit.term, text: hit.text });
    i = hit.at + hit.text.length;
  }
  if (i < t.length) out.push(t.slice(i));
  return out;
}

/**
 * The terms a text names (their ids).
 * @param {...string} texts
 */
export function termsIn(...texts) {
  return [...new Set(texts.flatMap((t) => mark(t).filter((x) => typeof x !== "string").map((x) => x.term.id)))];
}
