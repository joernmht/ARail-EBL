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
 */

/** @type {Place[]} */
export const PLACES = [
  {
    id: "signal-box", name: "Signal box, Bf Neustadt", line: "Three platform tracks, two lines, one panel.",
    photo: "media/ebl-neustadt.jpg", alt: "Bf Neustadt in the lab: its platform tracks with a freight train, seen from the side of the signal box", focus: "50% 72%",
  },
  {
    id: "track", name: "The line at Neustadt", line: "Signals, points and rails: what the teams go out to.",
    photo: "media/ebl-lab.jpg", alt: "The tracks of the lab with signals and a container train, seen along the line", focus: "50% 45%",
  },
  {
    id: "district", name: "The district around Bf Neustadt", line: "Every asset of the district, with its condition.",
    photo: "assets/ebl-lab-ar.jpg", alt: "Bf Neustadt in the lab with its digital layer: platforms, trains and their labels", focus: "50% 40%",
  },
  {
    id: "trains", name: "On the trains, Bf Neustadt", line: "The undertaking's units, drivers and passengers.",
    photo: "media/ebl-container-train.jpg", alt: "Trains side by side in the lab: an intercity and a container train", focus: "50% 35%",
  },
  {
    id: "lab", name: "The EBL lab, from above", line: "The real lab: its own simulation runs these trains.",
    photo: "media/ebl-lab-ortho.jpg", alt: "The lab's layout from above: parallel tracks with trains", focus: "40% 50%",
  },
  {
    id: "terminal", name: "The container terminal", line: "Crane, yard and the line to Pirna.",
    photo: "media/ebl-terminal.jpg", alt: "The container terminal of the lab with its crane and a container train", focus: "50% 70%",
  },
  {
    id: "town", name: "Neustadt, the town", line: "Offices with a view of the station they pay for.",
    photo: "assets/town-day.jpg", alt: "The town around the layout in the flyover: houses, streets and buses beside the tracks", focus: "50% 55%",
  },
  {
    id: "town-night", name: "Neustadt at night", line: "One committee room is still lit.",
    photo: "assets/town-night.jpg", alt: "The town around the layout at night, its windows and street lamps lit", focus: "55% 50%",
  },
];

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
