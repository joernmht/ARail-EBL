/**
 * The role games' entry, apart from the framework's (../index.js): the game core, the role
 * catalogue's checks, the career mode's model and the signaller's game. They need no world; the
 * framework never imports them, so a layout, a simulation or a plugin loads none of this, and a game
 * page loads only this (and what it imports: the framework's math).
 * @module arail/game
 */
export { Game, GAME_KINDS } from "./core.js";
export { ROLE_SETTINGS, GAME_EFFORTS, validateRoles, careerGraph, roleCounts } from "./roles.js";
export {
  SELECTIONS, QUALIFICATION_KINDS, qualificationsOf, startPoints, createCareer, ageOf, yearsIn, canStart, routeStatus, roleStatus, options as careerOptions,
  takeRole, study, work, missingText, prerequisiteTree, reachable,
} from "./career.js";
export {
  SignallerGame, STATION, TIMETABLE, CONNECTIONS, LEVELS, ZS1_REASONS, BRAKE, ACCEL, SIGHT_M, DISTANT_M, POINT_S, ZS1_MS, DWELL_S, END_S, clockOf,
} from "./signaller.js";
