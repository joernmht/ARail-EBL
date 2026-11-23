/**
 * The role games that can be seated in a session, by their id, and the session of a mission with
 * them. A new role game is added here (one per line) and exported from index.js.
 * @module arail/game/games
 */
import { AssetManagerGame } from "./asset-manager.js";
import { BudgetGame } from "./budget.js";
import { ContractGame } from "./contract-manager.js";
import { DispatcherGame } from "./dispatcher.js";
import { LabGame } from "./lab.js";
import { MaintenanceGame } from "./maintenance.js";
import { normalizeMission } from "./mission.js";
import { Session } from "./session.js";
import { SignallerGame } from "./signaller.js";
import { TransportControlGame } from "./transport-control.js";
import { WorkshopGame } from "./workshop.js";
import { YardGame } from "./yard.js";

/** @type {Map<string, Function>} */
export const GAMES = new Map([
  SignallerGame,
  MaintenanceGame,
  DispatcherGame,
  LabGame,
  TransportControlGame,
  YardGame,
  WorkshopGame,
  AssetManagerGame,
  ContractGame,
  BudgetGame,
].map((G) => [G.id, G]));

/**
 * The games of a role (an id of the role catalogue). Most roles have one; the train dispatcher has
 * its own ("Who goes first") and the lab's seat, the same role with the lab as its world.
 * @returns {Function[]}
 */
export const gamesOfRole = (role) => [...GAMES.values()].filter((G) => G.role === role);

/** The game of a role (an id of the role catalogue): the first of its games, or undefined. */
export const gameOfRole = (role) => gamesOfRole(role)[0];

/**
 * A session of a mission (a document of format arail-mission/1) with the role games of ARail.
 * @param {object} mission
 * @param {{seed?: number, seats?: Record<string, "human" | "computer">}} [options]
 * @returns {Session}
 */
export function play(mission, options = {}) {
  return new Session(normalizeMission(mission, GAMES), { games: GAMES, ...options });
}
