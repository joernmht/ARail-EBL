// The cast of the game: who talks to the player. A decision is asked by somebody (a team leader on
// the radio, the coalition partner's rapporteur across the table), and the play page shows that
// person beside the question. The portraits are placeholders, silhouettes in web/game/cast/, to be
// replaced by pictures: put the picture there and name it in PORTRAITS. Data and plain functions
// only: no DOM. People have bird names (arail/core/people.js).

/** The portraits by kind: the picture's path below web/, and what it shows. */
export const PORTRAITS = {
  office: { picture: "game/cast/office.svg", alt: "A person in office clothes (placeholder silhouette)" },
  suit: { picture: "game/cast/suit.svg", alt: "A person in a suit (placeholder silhouette)" },
  hivis: { picture: "game/cast/hivis.svg", alt: "A person in a helmet and a high-visibility vest (placeholder silhouette)" },
  uniform: { picture: "game/cast/uniform.svg", alt: "A person in a railway uniform with a cap (placeholder silhouette)" },
  headset: { picture: "game/cast/headset.svg", alt: "A person with a headset (placeholder silhouette)" },
};

/**
 * @typedef {object} Speaker
 * @property {string} name "E. Kiebitz"
 * @property {string} role what they are, in a few words
 * @property {string} portrait a kind of PORTRAITS
 */

/**
 * Who asks the player in each game (by `Game.id`), where a decision names nobody, and the portrait
 * of the player's own role (`self`), for the seats.
 * @type {Record<string, Speaker & {self: string}>}
 */
export const GAME_CAST = {
  signaller: { name: "R. Dohle", role: "Train dispatcher, on the line", portrait: "headset", self: "uniform" },
  maintenance: { name: "M. Specht", role: "Team leader, signalling", portrait: "hivis", self: "headset" },
  lab: { name: "J. Reiher", role: "Signaller in the lab", portrait: "uniform", self: "headset" },
  "transport-control": { name: "A. Schwalbe", role: "Driver, on the radio", portrait: "uniform", self: "headset" },
  "asset-manager": { name: "E. Kiebitz", role: "Asset responsible (ALV)", portrait: "hivis", self: "office" },
  contract: { name: "T. Lerche", role: "The operator's contract manager", portrait: "office", self: "office" },
  budget: { name: "E. Wiedehopf", role: "The coalition partner's rapporteur", portrait: "suit", self: "suit" },
};

/** Who speaks where no game is known. */
export const NARRATOR = { name: "The railway", role: "", portrait: "office" };

/** Words in a person's role that say which portrait fits. */
const KINDS = [
  [/team|technician|track|asset responsible|inspector|worker|foreman/i, "hivis"],
  [/driver|signaller|guard|conductor|shunter/i, "uniform"],
  [/dispatcher|control|centre|center|radio|phone/i, "headset"],
  [/rapporteur|minister|member|committee|partner|mayor|auditor|politic/i, "suit"],
];

/** A person named in a text: "E. Kiebitz, the asset responsible (ALV), proposes …". */
const PERSON = /\b(\p{Lu}\. (?:(?:von|van|de) )?\p{Lu}[\p{L}-]+), (?:the |an? )?([^,.:(]{3,60})/u;

/**
 * The portrait that fits a role's words; `fallback` where none of them says.
 * @param {string} role
 * @param {string} [fallback]
 */
export function portraitFor(role, fallback = "office") {
  return KINDS.find(([re]) => re.test(role))?.[1] ?? fallback;
}

/**
 * Who asks a decision: the person its title or text names, else the game's own (GAME_CAST).
 * @param {string} game a game's id
 * @param {{title?: string, text?: string, who?: Speaker}} [decision]
 * @returns {Speaker}
 */
export function speakerOf(game, decision = {}) {
  const own = GAME_CAST[game] ?? NARRATOR;
  if (decision.who?.name) return decision.who.name === own.name ? { name: own.name, role: own.role, portrait: own.portrait, ...decision.who } : { role: "", portrait: own.portrait, ...decision.who };
  const m = PERSON.exec(decision.title ?? "") ?? PERSON.exec(decision.text ?? "");
  if (!m) return { name: own.name, role: own.role, portrait: own.portrait };
  if (m[1] === own.name) return { name: own.name, role: own.role, portrait: own.portrait };
  const role = m[2].trim().replace(/^./, (c) => c.toUpperCase());
  return { name: m[1], role, portrait: portraitFor(role, own.portrait) };
}

/** A person quoted in a message: `E. Wiedehopf: "Not a second time."`, with what stands before. */
const QUOTE = /^(.*?)(\p{Lu}\. (?:(?:von|van|de) )?\p{Lu}[\p{L}-]+): "(.+)"\s*$/u;

/**
 * Who is quoted in a message, and what they say; null where nobody is.
 * @param {string} text
 * @returns {{name: string, before: string, quote: string} | null}
 */
export function quoteIn(text) {
  const m = QUOTE.exec(String(text ?? ""));
  return m ? { before: m[1], name: m[2], quote: m[3] } : null;
}

/**
 * The portrait of the player's own role in a game.
 * @param {string} game a game's id
 */
export function selfPortrait(game) {
  return PORTRAITS[GAME_CAST[game]?.self ?? NARRATOR.portrait];
}
