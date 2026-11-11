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
  { id: "federal-government", name: "Federal government and Bundestag", name_de: "Bund: Bundesregierung (BMV) und Bundestag", kind: "state" },
  { id: "state-government", name: "Länder: state governments and planning authorities", name_de: "Länder: Landesregierungen und Landesplanungsbehörden", kind: "state" },
  { id: "municipality", name: "Municipalities and districts", name_de: "Kommunen: Städte, Gemeinden und Landkreise", kind: "state" },
  { id: "european-union", name: "European Union: Commission and Agency for Railways", name_de: "Europäische Union: Kommission und Eisenbahnagentur (ERA)", kind: "authority" },
  { id: "transport-authority", name: "Transport authorities and transport associations", name_de: "Aufgabenträger des SPNV und Verkehrsverbünde", kind: "authority" },
  { id: "safety-authority", name: "Supervisory and approval authorities (EBA, Land railway supervision, accident insurers)", name_de: "Aufsichts- und Genehmigungsbehörden (Eisenbahn-Bundesamt, Landeseisenbahnaufsicht, Unfallversicherungsträger)", kind: "authority" },
  { id: "regulator", name: "Regulatory body (Bundesnetzagentur)", name_de: "Regulierungsbehörde (Bundesnetzagentur)", kind: "authority" },
  { id: "independent-review", name: "Courts, Court of Auditors and accident investigation", name_de: "Gerichte, Bundesrechnungshof und Bundesstelle für Eisenbahnunfalluntersuchung", kind: "authority" },
  { id: "emergency-services", name: "Police, customs and emergency services", name_de: "Behörden und Organisationen mit Sicherheitsaufgaben (Bundespolizei, Zoll, Feuerwehr, Rettungsdienst)", kind: "authority" },
  { id: "infrastructure-manager", name: "Infrastructure manager (network and stations)", name_de: "Eisenbahninfrastrukturunternehmen (Netz und Personenbahnhöfe)", kind: "infrastructure" },
  { id: "terminal-operator", name: "Terminal and port railway operators", name_de: "Betreiber von Umschlagterminals und Hafenbahnen", kind: "infrastructure" },
  { id: "passenger-undertaking", name: "Passenger railway undertaking", name_de: "Eisenbahnverkehrsunternehmen im Personenverkehr", kind: "undertaking" },
  { id: "freight-undertaking", name: "Freight railway undertaking", name_de: "Eisenbahnverkehrsunternehmen im Güterverkehr", kind: "undertaking" },
  { id: "local-transport", name: "Local public transport and taxi operators", name_de: "Kommunale Verkehrsbetriebe, Bus- und Taxiunternehmen", kind: "undertaking" },
  { id: "ecm-and-workshop", name: "Entity in charge of maintenance and workshops", name_de: "Für die Instandhaltung zuständige Stelle (ECM) und Werkstätten", kind: "undertaking" },
  { id: "keeper-and-lessor", name: "Vehicle keepers and leasing companies", name_de: "Fahrzeughalter und Leasinggesellschaften (Wagenhalter, ROSCO)", kind: "industry" },
  { id: "manufacturer", name: "Rolling stock and signalling manufacturers", name_de: "Bahnindustrie (Fahrzeug- und Signaltechnikhersteller)", kind: "industry" },
  { id: "assessment-body", name: "Independent assessment and inspection bodies", name_de: "Unabhängige Prüf- und Bewertungsstellen (benannte und bestimmte Stellen, Bewertungsstellen, anerkannte Prüfer)", kind: "industry" },
  { id: "construction-company", name: "Construction and track safety companies", name_de: "Bahnbau- und Sicherungsunternehmen", kind: "industry" },
  { id: "engineering-office", name: "Engineering offices and consultancies", name_de: "Ingenieurbüros und Beratungsunternehmen", kind: "industry" },
  { id: "shipper-and-forwarder", name: "Shippers, forwarders and intermodal operators", name_de: "Verlader, Speditionen und KV-Operateure", kind: "industry" },
  { id: "service-provider", name: "Service providers and station tenants", name_de: "Dienstleister und Mieter (Reinigung, Sicherheit, medizinischer Dienst, Handel im Bahnhof)", kind: "industry" },
  { id: "passengers-and-public", name: "Passengers and residents", name_de: "Fahrgäste und Anwohner", kind: "public" },
  { id: "associations-and-media", name: "Unions, works councils, associations and media", name_de: "Gewerkschaften, Betriebsräte, Verbände und Medien", kind: "public" },
  { id: "education-and-research", name: "Universities, research and training", name_de: "Hochschulen, Forschung und Ausbildung", kind: "education" },
];

/**
 * The flows.
 * @type {Array<{id: string, name: string, name_de: string, kind: "event" | "state", scale: string, group: string, text: string}>}
 */
export const FLOWS = [
  { id: "budget", name: "Budget", name_de: "Budget (Haushaltsmittel, Mittelzuweisung)", kind: "state", scale: "years", group: "money", text: "Money assigned for a period with its conditions (titles, blocking notes, quality targets, a debt ceiling); the receiver plans its staff, measures and orders within it until the next budget." },
  { id: "funding-decision", name: "Funding decision", name_de: "Zuwendungsbescheid (Förderbescheid, Finanzierungsvereinbarung)", kind: "event", scale: "months", group: "money", text: "A grant or the financing of a measure approved, cut or refused, with the funder's share and conditions; the receiver starts the measure, re-plans it or drops it." },
  { id: "funds-drawdown", name: "Drawdown of funds", name_de: "Mittelabruf (mit Verwendungsnachweis)", kind: "event", scale: "months", group: "money", text: "Granted money called for costs incurred, later with the proof of how it was used; the funder pays, checks the proof and claims back what was not eligible." },
  { id: "payment", name: "Payment", name_de: "Zahlung (Entgelt, Vergütung, Rechnung)", kind: "event", scale: "months", group: "money", text: "Money paid for a service delivered (an authority's contract payment, track access and station charges, a contractor's invoice, a fare, a share of pooled fare revenue, compensation paid out); the receiver books it as revenue and the payer as cost." },
  { id: "penalty", name: "Penalty", name_de: "Pönale (Vertragsstrafe, Malus, Zahlung aus dem Anreizsystem)", kind: "event", scale: "months", group: "money", text: "Money deducted or claimed at an agreed rate for a failure under a contract or the performance regime (late or cancelled trains, short-formed units, a late release, a late delivery); the receiver pays, disputes it or passes it on down its chain of contracts." },
  { id: "claim", name: "Claim", name_de: "Nachtrag / Anspruch (Nachtragsforderung, Schadensersatz, Gewährleistung, Fahrgastrechte-Antrag)", kind: "event", scale: "days", group: "money", text: "A demand for money that the receiver must assess case by case (a contractor's supplementary claim, a damage or warranty claim, a passenger's compensation claim); it is paid, negotiated, passed on or refused." },
  { id: "legislation", name: "Law or regulation", name_de: "Gesetz / Verordnung (z. B. AEG, ERegG, BSWAG mit Bedarfsplan, RegG, TSI)", kind: "state", scale: "years", group: "law-and-supervision", text: "A law, ordinance or technical specification in force; every role it addresses plays under it until it is amended." },
  { id: "targets", name: "Steering targets", name_de: "Zielvorgaben (Steuerungsziele des Eigentümers, Qualitätsziele)", kind: "state", scale: "years", group: "law-and-supervision", text: "Targets and priorities that an owner or a management sets for the level below (network condition, punctuality, capacity for works, renewal priorities, debt); the receiver steers its own decisions by them and is measured against them." },
  { id: "application", name: "Application", name_de: "Antrag (auf Zulassung, Genehmigung, Planfeststellung oder Förderung)", kind: "event", scale: "months", group: "law-and-supervision", text: "A file submitted to an authority or funder for an authorisation, a permit, a planning approval, a charge approval or a grant; the receiver checks that it is complete, raises issues and decides within its deadline." },
  { id: "approval", name: "Approval", name_de: "Genehmigung / Zulassung (Fahrzeugzulassung, Inbetriebnahmegenehmigung, Sicherheitsbescheinigung, Unternehmensgenehmigung)", kind: "event", scale: "months", group: "law-and-supervision", text: "An authorisation, certificate, licence or permit granted, granted with conditions or refused by the competent authority; the receiver may then operate, commission or use what it applied for, within the conditions." },
  { id: "planning-approval", name: "Planning approval decision", name_de: "Planfeststellungsbeschluss (auch Plangenehmigung, Ergebnis der Raumverträglichkeitsprüfung)", kind: "event", scale: "years", group: "law-and-supervision", text: "The decision of a planning authority on a project's corridor or plan with its conditions (noise protection, compensation areas, construction hours); the project builds to it or changes its plan, and those affected accept it or go to court." },
  { id: "objection", name: "Objection or legal challenge", name_de: "Einwendung / Rechtsbehelf (Stellungnahme, Widerspruch, Rüge, Klage)", kind: "event", scale: "months", group: "law-and-supervision", text: "A formal objection, statement or legal challenge against a plan, a decision or an award; the receiver must weigh and answer it, and the measure is delayed, changed or confirmed." },
  { id: "ruling", name: "Ruling", name_de: "Urteil / Beschluss (Gericht, Beschlusskammer)", kind: "event", scale: "months", group: "law-and-supervision", text: "A court's or ruling chamber's decision on a challenge, a dispute or a proposed charge; the parties must follow it, and it sets the line for later cases." },
  { id: "supervisory-order", name: "Order of an authority", name_de: "Anordnung / Bescheid der Aufsichtsbehörde (auch Untersagung, Bußgeldbescheid)", kind: "event", scale: "months", group: "law-and-supervision", text: "An order with a deadline, a ban or a fine from a supervisory authority; the receiver must stop, change or prove something by the deadline, or appeal." },
  { id: "audit-finding", name: "Audit or supervision finding", name_de: "Prüfungsfeststellung (Aufsicht, Audit, Rechnungsprüfung)", kind: "event", scale: "months", group: "law-and-supervision", text: "A deviation or weakness found by an audit, a supervision visit or an audit of accounts, with a recommendation; the receiver answers with corrective actions, a repayment or a change of practice." },
  { id: "political-demand", name: "Political demand", name_de: "Politische Forderung (Positionspapier, Petition, Resolution)", kind: "event", scale: "months", group: "law-and-supervision", text: "A demand put to politicians or an administration by an association, a union, a town or citizens (more money, a reopening, noise protection, a rule change); the receiver weighs it against its budget and its voters." },
  { id: "transport-contract", name: "Transport contract", name_de: "Verkehrsvertrag", kind: "state", scale: "years", group: "contracts", text: "The terms a railway undertaking runs services under for a transport authority (train-km, price, gross or net, quality standards, penalties, index clauses); both sides settle every month by it for 10 to 15 years or until it is amended." },
  { id: "performance-report", name: "Performance report", name_de: "Leistungs- und Qualitätsbericht (Pünktlichkeit, Ausfälle, Netzzustand, Mittelabfluss)", kind: "event", scale: "months", group: "contracts", text: "A periodic account of results (punctuality, cancellations, delay minutes by cause, faults, condition, passenger counts, costs, money spent) to those who steer or pay; the receiver settles payments and penalties by it and resets targets and budgets." },
  { id: "access-terms", name: "Access conditions and charges", name_de: "Nutzungsbedingungen und Entgelte (Schienennetz-Nutzungsbedingungen, Trassen- und Stationspreise)", kind: "state", scale: "years", group: "contracts", text: "The conditions and price list under which a network or a service facility may be used; applicants calculate their paths, bids and prices with it until the next approved version." },
  { id: "tender", name: "Tender", name_de: "Ausschreibung (Vergabeunterlagen, Bieterfragen, Zuschlag)", kind: "event", scale: "months", group: "contracts", text: "A call for bids with its specification and award criteria, the answers to bidders' questions and in the end the award; bidders decide whether and how to bid, and the winner gets the contract." },
  { id: "bid", name: "Bid", name_de: "Angebot", kind: "event", scale: "months", group: "contracts", text: "A binding offer with price, dates and guarantees in answer to a tender or a request; the receiver evaluates it and awards, negotiates or rejects." },
  { id: "service-contract", name: "Contract for works, supplies or services", name_de: "Vertrag (Bau-, Liefer-, Dienstleistungs-, Transport-, Miet- oder Rahmenvertrag)", kind: "state", scale: "years", group: "contracts", text: "The terms agreed between a client and a contractor, supplier, lessor or carrier (scope, price, dates, service levels, liability); both sides work and pay under it until it ends or is changed." },
  { id: "acceptance", name: "Acceptance", name_de: "Abnahme (Bauabnahme, Fahrzeugabnahme, Abnahmeprüfung)", kind: "event", scale: "months", group: "contracts", text: "Works, an installation or a vehicle accepted as built to contract and rules, accepted with a list of defects, or refused; with it risk and payment pass to the client and the asset enters its register." },
  { id: "timetable", name: "Timetable", name_de: "Fahrplan (Jahresfahrplan, Baufahrplan, Notfahrplan)", kind: "state", scale: "months", group: "planning", text: "The planned trains with their times, tracks and connections; everyone who runs, staffs, dispatches or uses the trains works from it until it is replaced." },
  { id: "train-path", name: "Train path", name_de: "Trasse (Trassenanmeldung, Trassenangebot, Zuweisung)", kind: "event", scale: "days", group: "planning", text: "A path requested, offered or allocated for a train (annual, ad hoc, for a diversion, a test or an empty run); the applicant builds its timetable and production on it and pays the charge, the infrastructure manager fits it into the timetable." },
  { id: "service-concept", name: "Service concept", name_de: "Angebotskonzept (Leistungsbestellung, Nahverkehrsplan)", kind: "state", scale: "years", group: "planning", text: "The lines, frequencies, operating hours, connection nodes and train sizes an authority wants and pays for; tenders, timetables and vehicle numbers are derived from it." },
  { id: "possession-request", name: "Possession request", name_de: "Baubetriebliche Anmeldung (Anmeldung einer Sperrpause)", kind: "event", scale: "months", group: "planning", text: "A request for a planned closure or restriction of tracks for works, tests or the protection of a work site, with place, duration and constraints; construction-operations planning bundles it with others and fixes, moves or refuses the possession." },
  { id: "possession", name: "Possession", name_de: "Sperrpause (baubetriebliche Regelung, Betra)", kind: "state", scale: "days", group: "planning", text: "A planned closure of track for works with its window, operating rules (Betra), slow orders and replacement arrangements; timetable, signallers, contractors and undertakings plan around it until it is moved or cancelled." },
  { id: "design-documents", name: "Design documents", name_de: "Planunterlagen (Entwurfs-, Genehmigungs- und Ausführungsplanung, Projektierung)", kind: "event", scale: "months", group: "planning", text: "Plans, calculations, specifications or setting-out data from a planner or manufacturer; the receiver checks, approves, tenders or builds from them." },
  { id: "dispatching-order", name: "Dispatching order", name_de: "Dispositionsentscheidung (Zugreihenfolge, Überholung, Umleitung, Zurückhalten)", kind: "event", scale: "minutes", group: "operations", text: "The order of trains, holds, overtakings, diversions and inflow limits decided by the infrastructure manager's dispatcher (an undertaking's or bus operator's control centre decides likewise for its own trains and buses); signallers set routes by it and undertakings re-plan units and crews." },
  { id: "movement-authority", name: "Movement authority", name_de: "Zustimmung zur Fahrt (Fahrtstellung des Signals, Ersatzsignal, Befehl, Fahrerlaubnis, ETCS-Fahrterlaubnis)", kind: "event", scale: "minutes", group: "operations", text: "Permission for a train or a shunting move to run up to a point (a signal aspect, a substitute signal, a written order, a permission to run on a branch line, an ETCS movement authority); the driver may move only as far as it reaches." },
  { id: "train-report", name: "Train report", name_de: "Zugmeldung / Fertigmeldung (Anbieten, Annehmen, Rückmelden, Zuglaufmeldung, Abfahrauftrag)", kind: "event", scale: "minutes", group: "operations", text: "A report between operating posts about one train (offered, accepted, arrived complete, formed and brake-tested, ready to depart); the receiver may then admit, dispatch or take over the train." },
  { id: "delay-notice", name: "Delay or cancellation notice", name_de: "Verspätungs- und Ausfallmeldung (mit Prognose)", kind: "event", scale: "minutes", group: "operations", text: "A train's delay, cancellation or new forecast told to those who must react; dispatchers, connecting services, crews, information staff and customers re-plan by it." },
  { id: "connection-request", name: "Connection request", name_de: "Anschlusswunsch (Wartezeitanfrage, Anschlusssicherung)", kind: "event", scale: "minutes", group: "operations", text: "A request to hold a train or bus for connecting passengers; the receiver grants or refuses it within the waiting-time rules and what the network can take." },
  { id: "closure-request", name: "Closure request", name_de: "Antrag auf Gleissperrung (Sperrantrag)", kind: "event", scale: "minutes", group: "operations", text: "A request to the signaller to close a track or block an element, now or at the agreed time, for a repair, an inspection or works; the signaller grants it when traffic allows and secures the track." },
  { id: "track-closure", name: "Track closure", name_de: "Gleissperrung (Sperrung und Aufhebung der Sperrung)", kind: "event", scale: "minutes", group: "operations", text: "A track or line closed or reopened operationally; trains are held, diverted or run again, and the work crew may start or must be clear." },
  { id: "power-switching", name: "Switching of the overhead line", name_de: "Schaltantrag und Bestätigung der Schaltung (Ausschalten, Erden, Wiedereinschalten der Oberleitung)", kind: "event", scale: "hours", group: "operations", text: "A request to switch a section of the overhead line off or on, and the report that it is off, earthed or clear again; work or rescue starts only on the confirmation, and no electric train can run there meanwhile." },
  { id: "situation-report", name: "Situation report", name_de: "Lagemeldung (Störungslage, Prognose der Dauer)", kind: "event", scale: "hours", group: "operations", text: "The state of a disruption or incident with its extent, measures and expected duration, reported to control centres, management, authorities and press offices; they decide on contingency plans, information and statements." },
  { id: "handling-order", name: "Shunting or handling order", name_de: "Rangierauftrag (Rangierzettel, Zerlegeliste, Ladeplan, Umschlagauftrag)", kind: "event", scale: "hours", group: "operations", text: "An order to sort, hump, move or load wagons and loading units in a given sequence; the crew carries it out and reports the tracks sorted and the train formed or loaded." },
  { id: "operating-rule", name: "Operating rule", name_de: "Betriebsanweisung (betriebliche Regelung, örtliche Zusätze, Weisung)", kind: "state", scale: "months", group: "operations", text: "A company rule for operating staff, issued or changed by the operations manager or the district (a dispatch procedure, local supplements, winter measures, a temporary procedure, an operating restriction); staff work by it until it is withdrawn." },
  { id: "asset-condition", name: "Asset condition and restrictions", name_de: "Anlagenzustand (Zustandsnote, Langsamfahrstellen (La), Störanfälligkeit)", kind: "state", scale: "days", group: "maintenance", text: "The condition of infrastructure assets and the restrictions that follow from it (speed restrictions, load limits, blocked elements, failure rates); operations and the timetable run with the restrictions, and asset management and funders judge the network by it." },
  { id: "inspection-finding", name: "Inspection finding", name_de: "Inspektionsbefund (Mess- oder Prüfergebnis mit Maßnahmenvorschlag)", kind: "event", scale: "days", group: "maintenance", text: "A defect or condition found at an inspection, a measurement or a test, classified against the limits, with the deadline or measure proposed; the receiver decides on repair, restriction, monitoring or renewal." },
  { id: "fault-report", name: "Fault report", name_de: "Störungsmeldung (Mängelmeldung)", kind: "event", scale: "minutes", group: "maintenance", text: "A fault or defect of an installation, a vehicle or a station facility reported to those who repair it or dispatch the repair; they rank it and send a team or book the vehicle in." },
  { id: "work-order", name: "Work order", name_de: "Arbeitsauftrag (Entstör-, Inspektions-, Bau-, Werkstatt- oder Planungsauftrag)", kind: "event", scale: "hours", group: "maintenance", text: "An order to repair, inspect, build or plan something by a date (a team sent to a fault, a unit booked into the workshop, a renewal or planning commission, also a cleaning job); the receiver does the work and reports back." },
  { id: "repair-status", name: "Repair status", name_de: "Stand der Entstörung (Rückmeldung, Fertigmeldung der Arbeiten)", kind: "event", scale: "minutes", group: "maintenance", text: "Where a repair or a piece of work stands (team on its way, on site, interrupted, done and tested); dispatchers, signallers and planners forecast by it and reopen the track or release the vehicle." },
  { id: "material-supply", name: "Material supply", name_de: "Materialbestellung und -lieferung (Ersatzteile, Tauschteile, Baustoffe)", kind: "event", scale: "days", group: "maintenance", text: "Spare parts, repairable components or construction material ordered and delivered; the receiver can do the job, or the vehicle or site waits for the part." },
  { id: "vehicle-rotation", name: "Vehicle rotation plan", name_de: "Umlaufplan (Fahrzeugeinsatzplan)", kind: "state", scale: "months", group: "vehicles", text: "The chaining of trips into vehicle workings with turn times, stabling, spare units and maintenance windows; crews, dispatch and the workshop plan from it until the next timetable change." },
  { id: "maintenance-programme", name: "Maintenance programme", name_de: "Instandhaltungsprogramm (Fristen, Arbeitsumfänge, Grenzmaße)", kind: "state", scale: "months", group: "vehicles", text: "The intervals, tasks, wear limits and test methods for a vehicle type, with the released modifications and extensions; fleet planning, workshops and parts supply work to it until the next revision." },
  { id: "vehicle-release", name: "Vehicle release", name_de: "Betriebsfreigabe und Wiederinbetriebnahme (auch Abstellung eines Fahrzeugs)", kind: "event", scale: "days", group: "vehicles", text: "A vehicle released from the workshop and returned to operation, or withdrawn from service for a defect or a safety alert; dispatch and rotations count on it for the next pull-out." },
  { id: "vehicle-delivery", name: "Vehicle delivery", name_de: "Fahrzeugübergabe (Auslieferung, Überlassung, Rückgabe)", kind: "event", scale: "months", group: "vehicles", text: "New, leased or hired vehicles handed over to their operator or returned to their owner, with their documents and open items; the fleet grows or shrinks by them." },
  { id: "staff-plan", name: "Staff plan", name_de: "Personalplan (Stellen, Dienst- und Schichtplan, Rufbereitschaft)", kind: "state", scale: "months", group: "staff", text: "The posts, teams, duties, shifts and on-call arrangements a unit works with; dispatchers and planners deploy only the people it gives them, until the next plan." },
  { id: "qualification", name: "Qualification or fitness", name_de: "Befähigung und Tauglichkeit (Prüfung, Zusatzbescheinigung, Tauglichkeitsbescheinigung)", kind: "event", scale: "months", group: "staff", text: "A person confirmed trained, examined and fit for a function, or found unfit or due for retraining; planners may deploy them, or no longer." },
  { id: "collective-agreement", name: "Collective agreement", name_de: "Tarifvertrag", kind: "state", scale: "years", group: "staff", text: "Pay tables, working time and shift rules agreed between a union and an employer; rosters, personnel costs and bids are calculated with it until the next bargaining round." },
  { id: "works-council-consent", name: "Works council consent", name_de: "Zustimmung des Betriebsrats (Mitbestimmung, Betriebsvereinbarung)", kind: "event", scale: "months", group: "staff", text: "The works council's consent to a roster, overtime, a hiring or a technology, its refusal, or an agreement reached; the employer applies the measure, changes it or goes to the conciliation board." },
  { id: "strike-notice", name: "Strike notice", name_de: "Streikankündigung (Warnstreik, Streik, Notdienstvereinbarung)", kind: "event", scale: "months", group: "staff", text: "A warning strike or strike announced with its time and scope, and the emergency-work arrangement; undertakings and the network prepare emergency timetables and passenger information." },
  { id: "passenger-information", name: "Passenger information", name_de: "Reisendeninformation (Ansage, Anzeige, Störungsinformation)", kind: "event", scale: "minutes", group: "passengers-and-freight", text: "What passengers are told about a delay, a cancellation, a platform change or a replacement service (cause, expected duration, what to do); they re-plan their journeys by it." },
  { id: "fare", name: "Fare", name_de: "Tarif (Fahrpreise, Tarifzonen, Sparpreiskontingente)", kind: "state", scale: "months", group: "passengers-and-freight", text: "The prices and conditions passengers travel under (zones, season tickets, saver-fare quotas, the Deutschlandticket); passengers choose mode and ticket by it and sales staff apply it." },
  { id: "assistance-booking", name: "Assistance booking", name_de: "Anmeldung einer Hilfeleistung (Mobilitätsservice)", kind: "event", scale: "hours", group: "passengers-and-freight", text: "Boarding, alighting or transfer help booked for a passenger with reduced mobility and passed on as a task to station and train staff; they must be at the door with ramp or lift." },
  { id: "complaint", name: "Complaint", name_de: "Beschwerde (von Fahrgästen, Kunden, Mietern oder Anwohnern)", kind: "event", scale: "days", group: "passengers-and-freight", text: "A complaint of a passenger, customer, tenant or resident about a service, a station, noise or information; the receiver answers, fixes or escalates it, and its quality figures suffer." },
  { id: "replacement-transport-order", name: "Replacement transport order", name_de: "Bestellung von Ersatzverkehr (Schienenersatzverkehr, Taxi)", kind: "event", scale: "days", group: "passengers-and-freight", text: "Buses or taxis ordered to replace trains during a possession or a disruption, with routes, stops and times; the bus or taxi operator provides vehicles and drivers." },
  { id: "transport-order", name: "Transport order", name_de: "Transportauftrag (Wagenbestellung, Buchung, Frachtbrief)", kind: "event", scale: "days", group: "passengers-and-freight", text: "An order to carry a consignment (wagons ordered, a slot on an intermodal train booked, a truck leg commissioned), with its consignment note; the carrier plans wagons, trains and trucks for it." },
  { id: "consignment-handover", name: "Handover of wagons or loading units", name_de: "Übergabe von Wagen und Ladeeinheiten (Bereitstellung, Abholung, Freigabe oder Anhaltung)", kind: "event", scale: "hours", group: "passengers-and-freight", text: "Wagons or loading units handed over at an interface (siding, yard, terminal gate, border), with the result of the check there (accepted, set aside, held or released); the next link in the chain goes on or waits." },
  { id: "facility-slot", name: "Slot in a service facility", name_de: "Slot in einer Serviceeinrichtung (Zeitfenster am Ladegleis, am Gate, im Hafenbahnhof)", kind: "event", scale: "days", group: "passengers-and-freight", text: "A time window on a loading track, at a gate or on port tracks requested and allocated; trains and trucks must arrive within it or lose their turn." },
  { id: "emergency-call", name: "Emergency call", name_de: "Notruf (Notfallmeldung, Nothaltauftrag)", kind: "event", scale: "minutes", group: "safety", text: "An emergency reported with its place and the measures already taken (trains stopped, track closed, power off); the receiver stops trains, alerts rescue and police and sends the emergency manager." },
  { id: "incident-report", name: "Incident report", name_de: "Ereignismeldung (Unfall, gefährliches Ereignis, Sicherheitswarnung)", kind: "event", scale: "days", group: "safety", text: "An accident, a dangerous event, a precursor or a safety-relevant defect reported after the fact to those who must investigate, record or warn others; they decide the investigation and the measures." },
  { id: "safety-recommendation", name: "Safety recommendation", name_de: "Sicherheitsempfehlung (aus dem Untersuchungsbericht)", kind: "event", scale: "years", group: "safety", text: "A recommendation from an accident investigation with its addressee; the safety authority and the companies decide how to implement it and report back." },
  { id: "corrective-action", name: "Corrective action", name_de: "Korrektur- und Vorbeugemaßnahme (Nachschulung, Abzug vom Dienst, Auflage)", kind: "event", scale: "days", group: "safety", text: "A measure decided after an event, a finding or an audit, with its owner and deadline (retraining, a driver taken off duty, a changed procedure, a suspended contractor); the owner carries it out and reports it closed." },
  { id: "safety-plan", name: "Track safety plan", name_de: "Sicherungsplan (Sicherungsmaßnahmen für Arbeiten im Gleisbereich)", kind: "state", scale: "days", group: "safety", text: "The protection prescribed for a work site (closed track, fixed barrier, automatic warning system or lookouts, with posts and warning times); supervisors and lookouts set it up, and nobody works outside it." },
  { id: "expert-report", name: "Expert report", name_de: "Gutachten / Prüfbericht (Studie, Sicherheitsbewertungsbericht, Konformitätsbescheinigung)", kind: "event", scale: "months", group: "knowledge", text: "An independent expert's written judgement (a study, a benefit-cost assessment, a test or review report, a certificate, a safety assessment report); the receiver needs it as evidence for a funding, approval or policy decision." },
  { id: "press-report", name: "Press statement or report", name_de: "Pressemitteilung / Pressebericht", kind: "event", scale: "days", group: "knowledge", text: "What a press office or a source tells the media about an event, and what the media publish about it; reputation, ridership and political pressure on those named follow from it." },
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
