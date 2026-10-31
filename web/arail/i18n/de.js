/**
 * The framework's texts in German: what it shows people (object types and their settings, cards,
 * labels, railway systems, trains). English text → German; see ./index.js. Railway terms follow
 * the German rulebooks (EBO, Ril 408): Bahnsteig, Gleis, Zugbeeinflussung, Bremshundertstel, …
 *
 * The texts are kept in one file per area (./de/*.js), so that changes in different areas do not
 * touch the same file; a text belongs in the area that shows it, and no text is in two of them.
 * @module arail/i18n/de
 */
import { TEXTS as GENERAL } from "./de/general.js";
import { TEXTS as TYPES } from "./de/types.js";
import { TEXTS as SETTINGS } from "./de/settings.js";
import { TEXTS as RAIL_SYSTEMS } from "./de/rail-systems.js";
import { TEXTS as RAIL_TRAINS } from "./de/rail-trains.js";
import { TEXTS as RAIL_DYNAMICS } from "./de/rail-dynamics.js";
import { TEXTS as CARDS } from "./de/cards.js";
import { TEXTS as TOWN } from "./de/town.js";
import { TEXTS as ACCESS } from "./de/access.js";
import { TEXTS as STREETS } from "./de/streets.js";
import { TEXTS as TRAFFIC_SIGNS } from "./de/traffic-signs.js";
import { TEXTS as CROSSINGS } from "./de/crossings.js";
import { TEXTS as PARKING } from "./de/parking.js";
import { TEXTS as TRAFFIC } from "./de/traffic.js";
import { TEXTS as TRAMS } from "./de/trams.js";
import { TEXTS as MOBILITY } from "./de/mobility.js";
import { TEXTS as RAIL_LINES } from "./de/rail-lines.js";
import { TEXTS as INTRO } from "./de/intro.js";
import { TEXTS as PLAN } from "./de/plan.js";

/** The parts by their file, for the checks of the catalogues. */
export const DE_PARTS = {
  "web/arail/i18n/de/general.js": GENERAL,
  "web/arail/i18n/de/types.js": TYPES,
  "web/arail/i18n/de/settings.js": SETTINGS,
  "web/arail/i18n/de/rail-systems.js": RAIL_SYSTEMS,
  "web/arail/i18n/de/rail-trains.js": RAIL_TRAINS,
  "web/arail/i18n/de/rail-dynamics.js": RAIL_DYNAMICS,
  "web/arail/i18n/de/cards.js": CARDS,
  "web/arail/i18n/de/town.js": TOWN,
  "web/arail/i18n/de/access.js": ACCESS,
  "web/arail/i18n/de/streets.js": STREETS,
  "web/arail/i18n/de/traffic-signs.js": TRAFFIC_SIGNS,
  "web/arail/i18n/de/crossings.js": CROSSINGS,
  "web/arail/i18n/de/parking.js": PARKING,
  "web/arail/i18n/de/traffic.js": TRAFFIC,
  "web/arail/i18n/de/trams.js": TRAMS,
  "web/arail/i18n/de/mobility.js": MOBILITY,
  "web/arail/i18n/de/rail-lines.js": RAIL_LINES,
  "web/arail/i18n/de/intro.js": INTRO,
  "web/arail/i18n/de/plan.js": PLAN,
};

/** The framework's German texts. */
export const DE = Object.assign({}, ...Object.values(DE_PARTS));
