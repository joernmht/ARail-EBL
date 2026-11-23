/**
 * The role games' entry, apart from the framework's (../index.js): the game core, the flows between
 * roles, sessions and missions (the big game), the role catalogue's checks, the career mode's model
 * and the role games. They need no world; the framework never imports them, so a layout, a
 * simulation or a plugin loads none of this, and a game page loads only this (and what it imports:
 * the framework's math, and for the yard master's game the hump's simulation, which runs on its own).
 * @module arail/game
 */
export { Game, GAME_KINDS, Player, clockAt, fallbackOf, onScale, secondsOf } from "./core.js";
export { FLOWS, FLOW_GROUPS, FLOW_KINDS, PARTIES, PARTY_KINDS, SCALES, SCALE_S, flowOf, playedIn, validateFlows } from "./flows.js";
export { MISSION, SEATS, Session } from "./session.js";
export { STRETCHES, threads } from "./chain.js";
export { HOOK_CHARS, MISSION_FORMAT, MISSION_MODES, SAY_CHARS, SHIFT_S, TICK_S, answerFor, answersOf, lineFor, normalizeMission, staleAnswers, staleLines, storyOf, testRun, validateMission, wiring } from "./mission.js";
export { GAMES, gameOfRole, gamesOfRole, play } from "./games.js";
export { ROLE_SETTINGS, GAME_EFFORTS, validateRoles, careerGraph, flowGraph, roleCounts, takesOf } from "./roles.js";
export {
  SELECTIONS, QUALIFICATION_KINDS, qualificationsOf, startPoints, createCareer, ageOf, yearsIn, canStart, routeStatus, roleStatus, options as careerOptions,
  takeRole, study, work, missingText, prerequisiteTree, reachable,
} from "./career.js";
export {
  SignallerAutopilot, SignallerGame, STATION, TIMETABLE, CONNECTIONS, KINDS, LEVELS, ZS1_REASONS, BRAKE, ACCEL, SIGHT_M, DISTANT_M, POINT_S, ZS1_MS, DWELL_S, END_S, clockOf, failureChance,
} from "./signaller.js";
export { AssetManagerGame, AssetManagerPlayer, LEVELS as ASSET_MANAGER_LEVELS, TARGET_GRADE, minutesPerFault, renewalsOf, yearOf } from "./asset-manager.js";
export { BudgetGame, BudgetPlayer, LEVELS as BUDGET_LEVELS, LINES as BUDGET_LINES } from "./budget.js";
export { CLASSES as CONTRACT_CLASSES, ContractGame, ContractPlayer, LEVELS as CONTRACT_LEVELS, consequence, ruleFor } from "./contract-manager.js";
export { LEVELS as TRANSPORT_CONTROL_LEVELS, TransportControlGame, TransportControlPlayer } from "./transport-control.js";
export { DispatcherGame, DispatcherPlayer, GOODWILL, HOURS, LEVELS as DISPATCHER_LEVELS, UNDERTAKINGS, WAIT_MAX_MIN, WAIT_RULE_MIN, behind } from "./dispatcher.js";
export { CHUNK_S, EblApi, LAG_S, LATE_MIN, LabGame, LabPlayer } from "./lab.js";
export { DIAGNOSE_S, DISTRICT, DRIVE, EXPOSED_MIN, FAULTS, LEVELS as MAINTENANCE_LEVELS, MaintenanceGame, MaintenancePlayer, ON_CALL, RESTORE_MIN, TRADES, driveTime, likely } from "./maintenance.js";
export {
  FINDINGS as WORKSHOP_FINDINGS, FLEET, HANDS as WORKSHOP_HANDS, LATE_MAX_MIN, LATHE, LEVELS as WORKSHOP_LEVELS, LIMITS as WORKSHOP_LIMITS, MOOD as WORKSHOP_MOOD, MOVE as WORKSHOP_MOVE,
  ON_CALL as WORKSHOP_ON_CALL, PACE as WORKSHOP_PACE, PEOPLE as WORKSHOP_PEOPLE, PULLOUTS, STANDING_MIN, TRACKS as WORKSHOP_TRACKS, UNITS as WORKSHOP_UNITS, WORK as WORKSHOP_WORK, WorkshopGame, WorkshopPlayer,
} from "./workshop.js";
export {
  AREAS as WORKS_AREAS, AUDIENCES, BASE_DRIVE, COST as WORKS_COST, EFFECT, FAR_MIN, FAULTS as WORKS_FAULTS, HANDS as WORKS_HANDS, LEVELS as WORKS_LEVELS, MOOD as WORKS_MOOD, PACE as WORKS_PACE, PEOPLE as WORKS_PEOPLE, RAIL, ROUNDS_DUE, SHIFT as WORKS_SHIFT,
  STAFF, STORM, STRAIN, TRAFFIC, WEEK_H, WORKS, WorksGame, WorksPlayer, at as weekHour, trainsAt, when as weekWhen,
} from "./works.js";
export { HOLD, INBOUND, LEVELS as YARD_LEVELS, LOCO, MOOD, NEXT_PATH, OUTBOUND, PEOPLE as YARD_PEOPLE, PUSH, SIDINGS, WRONG_MIN, YARD, YardGame, YardPlayer } from "./yard.js";
