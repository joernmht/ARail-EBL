/**
 * The role games' entry, apart from the framework's (../index.js): the game core, the flows between
 * roles, sessions and missions (the big game), the role catalogue's checks, the career mode's model
 * and the role games. They need no world; the framework never imports them, so a layout, a
 * simulation or a plugin loads none of this, and a game page loads only this (and what it imports:
 * the framework's math).
 * @module arail/game
 */
export { Game, GAME_KINDS, Player, clockAt } from "./core.js";
export { FLOWS, FLOW_GROUPS, FLOW_KINDS, PARTIES, PARTY_KINDS, SCALES, SCALE_S, flowOf, playedIn, validateFlows } from "./flows.js";
export { MISSION, SEATS, Session } from "./session.js";
export { MISSION_FORMAT, MISSION_MODES, SHIFT_S, TICK_S, normalizeMission, testRun, validateMission, wiring } from "./mission.js";
export { GAMES, gameOfRole, play } from "./games.js";
export { ROLE_SETTINGS, GAME_EFFORTS, validateRoles, careerGraph, roleCounts } from "./roles.js";
export {
  SELECTIONS, QUALIFICATION_KINDS, qualificationsOf, startPoints, createCareer, ageOf, yearsIn, canStart, routeStatus, roleStatus, options as careerOptions,
  takeRole, study, work, missingText, prerequisiteTree, reachable,
} from "./career.js";
export {
  SignallerAutopilot, SignallerGame, STATION, TIMETABLE, CONNECTIONS, LEVELS, ZS1_REASONS, BRAKE, ACCEL, SIGHT_M, DISTANT_M, POINT_S, ZS1_MS, DWELL_S, END_S, clockOf, failureChance,
} from "./signaller.js";
export { AssetManagerGame, AssetManagerPlayer, LEVELS as ASSET_MANAGER_LEVELS, TARGET_GRADE, minutesPerFault, renewalsOf, yearOf } from "./asset-manager.js";
export { BudgetGame, BudgetPlayer, LEVELS as BUDGET_LEVELS, LINES as BUDGET_LINES } from "./budget.js";
export { CHUNK_S, EblApi, LAG_S, LATE_MIN, LabGame, LabPlayer } from "./lab.js";
export { DISTRICT, DRIVE, FAULTS, LEVELS as MAINTENANCE_LEVELS, MaintenanceGame, MaintenancePlayer, ON_CALL, RESTORE_MIN, driveTime } from "./maintenance.js";
