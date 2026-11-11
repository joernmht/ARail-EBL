// The places of the game: where a role works "outside", on the lab's layout. Every game and every
// mission has one, so that each of its pages can show a photo of the place and name it in a line
// (scene.js draws them). Also what a mission is in a few words: its facts, shown as chips beside its
// hook. Data and plain functions only: no DOM, so the Node tests read it too.

/**
 * @typedef {object} Place
 * @property {string} id kebab-case
 * @property {string} name the place, as on a sign
 * @property {string} line what is there, in one line
 * @property {string} photo the photo's path below web/
 * @property {string} alt what the photo shows
 * @property {string} [focus] the part of the photo kept when it is cropped (CSS object-position)
 * @property {string} [wide] a larger photo for the whole screen (the backdrop), where the close-up is too small
 * @property {string} [wideFocus] the part of the larger photo kept when it is cropped
 */

/**
 * The photos are close-ups in web/game/places/: cut from the lab's photos, or taken in the flyover
 * with everything in view virtual (trains, town; drawn without the table's photo, which blurs up
 * close): their names end in -fly. A close-up cut from a lab photo names that photo as `wide`, for
 * the whole screen.
 * @type {Place[]}
 */
export const PLACES = [
  {
    id: "signal-box", name: "Signal box, Bf Neustadt", line: "Three platform tracks, two lines, one panel.",
    photo: "game/places/signal-box.jpg", alt: "Bf Neustadt in the lab, close up: its tracks with signals and a freight train",
    wide: "media/ebl-neustadt.jpg", wideFocus: "40% 72%",
  },
  {
    id: "track", name: "The line at Neustadt", line: "Signals, points and rails: what the teams go out to.",
    photo: "game/places/track.jpg", alt: "Signals between the tracks of the lab, close up, a container train beside them",
    wide: "media/ebl-lab.jpg", wideFocus: "70% 30%",
  },
  {
    id: "district", name: "The district around Bf Neustadt", line: "Every asset of the district, with its condition.",
    photo: "game/places/district.jpg", alt: "The platforms of Bf Neustadt in the lab with their digital layer: people waiting, trains and their labels",
    wide: "assets/ebl-lab-ar.jpg", wideFocus: "60% 38%",
  },
  {
    id: "trains", name: "On the trains, Bf Neustadt", line: "The undertaking's units, drivers and passengers.",
    photo: "game/places/platform-fly.jpg", alt: "Regional trains at the platform of Bf Neustadt, in the flyover",
  },
  {
    id: "lab", name: "The EBL lab", line: "The real lab: its own simulation runs these trains.",
    photo: "game/places/lab-trains.jpg", alt: "Container wagons with their markers on the tracks of the lab, close up",
    wide: "media/ebl-container-train.jpg", wideFocus: "40% 35%",
  },
  {
    id: "terminal", name: "The container terminal", line: "Crane, yard and the line to Pirna.",
    photo: "game/places/terminal.jpg", alt: "The crane of the lab's container terminal over its tracks, close up",
    wide: "media/ebl-terminal.jpg", wideFocus: "35% 70%",
  },
  {
    id: "town", name: "Neustadt, the station forecourt", line: "Buses and trains: what the authority orders and pays.",
    photo: "game/places/forecourt-fly.jpg", alt: "The forecourt of Bf Neustadt in the flyover: buses at their bays, trains behind them",
  },
  {
    id: "town-hall", name: "Neustadt, the town", line: "A working life starts here, at school.",
    photo: "game/places/town-fly.jpg", alt: "The town of Neustadt in the flyover: houses, a car park and streets, the station behind them",
  },
  {
    id: "town-night", name: "Neustadt at night", line: "One committee room is still lit.",
    photo: "game/places/night-office-fly.jpg", alt: "A block of flats and offices in Neustadt at night, some windows lit, a tram at its stop",
  },
];

/**
 * @typedef {object} Backdrop
 * @property {string} id kebab-case
 * @property {string} photo the photo's path below web/
 * @property {string} alt what the photo shows
 * @property {RegExp} words what a text speaks of when this picture fits it
 * @property {boolean} [night] a picture of the night: not shown behind a shift by day
 */

/**
 * More pictures for the stage: what a question is about decides which one stands behind it
 * (backdropFor). All taken in the flyover, everything in view virtual; the first that fits wins, so
 * the narrower words come first.
 * @type {Backdrop[]}
 */
export const BACKDROPS = [
  { id: "night-crossing", night: true, photo: "game/places/night-crossing-fly.jpg", alt: "The level crossing at night: street lamps, a car waiting at the barriers", words: /\b(on call|at night|weekends?|night shift|overtime)\b/i },
  { id: "crossing", photo: "game/places/crossing-fly.jpg", alt: "The level crossing of Brückenstraße in the flyover: barriers, trees, a car and a cyclist", words: /\b(level crossing|barriers?|bridge|branch|speed restriction|fence|trespass)/i },
  { id: "night-office", night: true, photo: "game/places/night-office-fly.jpg", alt: "A block of flats and offices in Neustadt at night, some windows lit, a tram at its stop", words: /\b(night session|ceiling|draft|coalition|rapporteur|committee|ministry|block|grant|equity|capital|special fund)/i },
  { id: "night-town", night: true, photo: "game/places/night-town-fly.jpg", alt: "The town of Neustadt at night in the flyover: lit windows and street lamps", words: /\b(constituency|voters?|election|mayor|press|public)\b/i },
  { id: "terminal", photo: "game/places/terminal-fly.jpg", alt: "The container terminal in the flyover: the crane over the train, the yard and a barge at the quay", words: /\b(containers?|crane|terminal|barge|quay|trucks?|freight)\b/i },
  { id: "tram", photo: "game/places/tram-fly.jpg", alt: "A tram at its stop in Bahnhofstraße in the flyover, the station behind it", words: /\b(trams?|bus(es)?|replacement service|stop)\b/i },
  { id: "station", photo: "game/places/station-fly.jpg", alt: "The station building of Bf Neustadt in the flyover, a regional train at the platform in front", words: /\b(drivers?|units?|defect|sick|stand-by|spare|workshop|crew|roster)\b/i },
  { id: "platform", photo: "game/places/platform-fly.jpg", alt: "Regional trains at the platform of Bf Neustadt, in the flyover", words: /\b(passengers?|connections?|change|hold|wait|late|delay|punctual)/i },
  { id: "forecourt", photo: "game/places/forecourt-fly.jpg", alt: "The forecourt of Bf Neustadt in the flyover: buses at their bays, trains behind them", words: /\b(operator|contract|penalt|malus|incident|train-km|timetable|emergency timetable|auditor)/i },
  { id: "school", photo: "game/places/school-fly.jpg", alt: "A school in Neustadt in the flyover, a street in front of it", words: /\b(school|apprentice|training|exam|students?|teach)/i },
  { id: "overview", photo: "game/places/overview-fly.jpg", alt: "Neustadt from above in the flyover: the station, the tracks and the town around them", words: /\b(district|network|grade|renewals?|strategy|replacement money|programme)\b/i },
  { id: "night-line", night: true, photo: "game/places/night-line-fly.jpg", alt: "The line at Neustadt at night in the flyover, a train's lit windows in the distance", words: /\b(teams?|technician|faults?|repair|closure|closed)\b/i },
  { id: "track", photo: "media/ebl-lab.jpg", alt: "The tracks of the lab with signals and a container train, seen along the line", words: /\b(teams?|technician|faults?|failed|repair|closure|closed|substitute signal)\b/i },
];

/**
 * The picture for the whole screen behind a place: its larger photo where it has one.
 * @param {Place} place
 * @returns {{photo: string, alt: string, focus: string}}
 */
export function wideOf(place) {
  return { photo: place.wide ?? place.photo, alt: place.alt, focus: (place.wide ? place.wideFocus : place.focus) ?? "50% 50%" };
}

/** The hours of the night, as the lab's clock has them: from sunset (20:30) to sunrise (06:00). */
export const NIGHT = { from: 20.5, to: 6 };

/**
 * Whether it is night at a moment of a shift.
 * @param {string} clock when the shift begins ("08:00")
 * @param {number} [t] seconds into it
 */
export function nightAt(clock, t = 0) {
  const [h, m] = String(clock ?? "08:00").split(":").map(Number);
  const hour = ((((h || 0) + (m || 0) / 60 + t / 3600) % 24) + 24) % 24;
  return hour >= NIGHT.from || hour < NIGHT.to;
}

/**
 * The picture that fits what a text speaks of (a question's title first, then its text), or null.
 * @param {...string} texts
 * @returns {{photo: string, alt: string, focus: string} | null}
 */
export function backdropFor(...texts) {
  return backdropAt(null, ...texts);
}

/**
 * The picture that fits what a text speaks of at a time of day: by day (`night` false) no picture
 * of the night, at night or where the time is open (null: a turn of months or years) any.
 * @param {boolean | null} night
 * @param {...string} texts
 * @returns {{photo: string, alt: string, focus: string} | null}
 */
export function backdropAt(night, ...texts) {
  for (const text of texts) {
    const b = text ? BACKDROPS.find((x) => x.words.test(text) && (night !== false || !x.night)) : null;
    if (b) return { photo: b.photo, alt: b.alt, focus: b.id === "track" ? "70% 30%" : "50% 50%" };
  }
  return null;
}

/** The place of each game (by `Game.id`): where its role works. */
export const GAME_PLACES = {
  signaller: "signal-box",
  maintenance: "track",
  lab: "lab",
  "transport-control": "trains",
  "asset-manager": "district",
  contract: "town",
  budget: "town-night",
};

/** The place shown where nothing names one. */
export const DEFAULT_PLACE = "district";

/**
 * A place by its id; the default place for an id that is unknown or missing.
 * @param {string} [id]
 * @returns {Place}
 */
export function placeOf(id) {
  return PLACES.find((p) => p.id === id) ?? PLACES.find((p) => p.id === DEFAULT_PLACE);
}

/**
 * Where a game's role works.
 * @param {string} game a game's id
 * @returns {Place}
 */
export function placeOfGame(game) {
  return placeOf(GAME_PLACES[game]);
}

/**
 * Where a mission plays: the place it names, else that of its first seat's game.
 * @param {{place?: string, roles?: Array<{game: string}>}} mission
 * @returns {Place}
 */
export function placeOfMission(mission) {
  return placeOf(mission?.place ?? GAME_PLACES[mission?.roles?.[0]?.game]);
}

/** A number of minutes or hours, short: "40 min", "1.5 h". */
function span(seconds) {
  const min = seconds / 60;
  return min < 90 ? `${Math.round(min)} min` : `${Math.round(min / 6) / 10} h`;
}

/**
 * A mission in a few words, for its chips: how many roles, how long (the shifts of a round on
 * their clock, the rounds), and how it is played.
 * @param {{roles: object[], rounds: number, phases: Array<{kind: string, length?: number}>, mode: string}} m a mission with its defaults (normalizeMission)
 * @returns {string[]}
 */
export function missionFacts(m) {
  const roles = m.roles.length, shifts = m.phases.filter((p) => p.kind === "shift"), turns = m.phases.length - shifts.length;
  const shift_s = shifts.reduce((s, p) => s + (p.length ?? 0), 0);
  const round = [shift_s ? `${span(shift_s)} on the clock` : null, turns ? (turns === 1 ? "1 turn" : `${turns} turns`) : null].filter(Boolean).join(" + ");
  return [
    roles === 1 ? "1 role" : `${roles} roles`,
    m.rounds > 1 ? `${m.rounds} rounds` : null,
    m.rounds > 1 ? `${round} each` : round,
    m.mode === "solo" ? "solo" : m.mode === "competitive" ? "against each other" : "together",
  ].filter(Boolean);
}
