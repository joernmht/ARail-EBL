/**
 * The role games that can be seated in a session, by their id, and the session of a mission with
 * them. A new role game is added here (one per line) and exported from index.js.
 * @module arail/game/games
 */
import { MaintenanceGame } from "./maintenance.js";
import { normalizeMission } from "./mission.js";
import { Session } from "./session.js";
import { SignallerGame } from "./signaller.js";

/** @type {Map<string, Function>} */
export const GAMES = new Map([
  SignallerGame,
  MaintenanceGame,
].map((G) => [G.id, G]));

/** The game of a role (an id of the role catalogue), or undefined. */
export const gameOfRole = (role) => [...GAMES.values()].find((G) => G.role === role);

/**
 * A session of a mission (a document of format arail-mission/1) with the role games of ARail.
 * @param {object} mission
 * @param {{seed?: number, seats?: Record<string, "human" | "computer">}} [options]
 * @returns {Session}
 */
export function play(mission, options = {}) {
  return new Session(normalizeMission(mission, GAMES), { games: GAMES, ...options });
}
