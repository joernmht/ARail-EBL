/**
 * Drawing of the container terminal: containers, wagons, locomotives, trucks, barges, cranes,
 * reach stackers, yard ground, lanes, quays and highlights. Everything goes through the View
 * display list; positions are layout mm, prototype dimensions metres.
 *
 * The colours, `colourFor` and `boxCorners` are final; the draw functions are placeholders (they
 * draw nothing) until the terminal drawing is implemented.
 * @module arail/terminal/draw
 */
import { CD, PALETTE, grey, mix, parseColor } from "../core/colors.js";
import { hash01, hashString } from "../objects/building-kit.js";

/** Colours of containers without a colour of their own: muted, derived from the CD; never pure Orange or Rot. */
export const CONTAINER_COLOURS = Object.freeze([
  mix(CD.tuerkis, grey(0.5), 0.25), mix(CD.dunkelblau, grey(0.5), 0.2), mix(CD.brillantblau, grey(0.5), 0.4),
  mix(CD.rot, grey(0.4), 0.45), mix(CD.orange, grey(0.45), 0.45), mix(CD.gelb, grey(0.6), 0.35),
  grey(0.9), grey(0.62), grey(0.4), mix(CD.tuerkis, grey(0.3), 0.5),
]);

/** Colours of the terminal's infrastructure and vehicles. */
export const TERMINAL_COLOURS = Object.freeze({
  concrete: "#c9c6bd", yardLine: PALETTE.busBay, rail: "#5b5f64", craneGirder: grey(0.78), craneLeg: grey(0.62),
  craneTrolley: grey(0.5), spreader: CD.gelb, rope: grey(0.25), wagonFrame: grey(0.32), running: grey(0.2),
  chassis: grey(0.25), wheels: grey(0.12), hull: mix(CD.dunkelblau, grey(0.4), 0.3), hullDeck: grey(0.45),
  wheelhouse: grey(0.88), reachStacker: grey(0.35), card: grey(0.97),
});

/**
 * Body colour of a container as [r, g, b]: its own `colour`, or one of {@link CONTAINER_COLOURS}
 * chosen by its id (the same container always gets the same colour).
 * @param {{id: string, colour?: string|number[]|null}} container
 * @returns {number[]}
 */
export function colourFor(container) {
  if (container.colour) return parseColor(container.colour);
  const i = Math.floor(hash01(hashString(String(container.id)), 0) * CONTAINER_COLOURS.length);
  return parseColor(CONTAINER_COLOURS[Math.min(i, CONTAINER_COLOURS.length - 1)]);
}

/**
 * The 8 corners [x, y, z] (layout mm) of a box: the bottom 4 (counter-clockwise, starting at the
 * back right) then the top 4 in the same order.
 * @param {import("./types.js").Box} box
 * @returns {number[][]}
 */
export function boxCorners(box) {
  const c = Math.cos(box.heading), s = Math.sin(box.heading);
  const l = box.length / 2, w = box.width / 2;
  const base = [[-l, -w], [l, -w], [l, w], [-l, w]].map(([a, b]) => [box.center[0] + a * c - b * s, box.center[1] + a * s + b * c]);
  const z1 = box.z0 + box.height;
  return [...base.map(([x, y]) => [x, y, box.z0]), ...base.map(([x, y]) => [x, y, z1])];
}

/**
 * Containers standing on something (`ref`: the sort reference of what they stand on).
 * @param {import("../core/view.js").View} view
 * @param {import("./types.js").DrawBox[]} boxes
 * @param {number[]} ref
 */
export function drawContainers(view, boxes, ref, { alpha = 1 } = {}) {}

/**
 * Yard stacks, each bottom to top.
 * @param {import("./types.js").DrawBox[][]} stacks
 */
export function drawYardStacks(view, stacks, { alpha = 1 } = {}) {}

/**
 * A container wagon and its containers.
 * @param {{type: object, center: number[], heading: number, deck: number, alpha: number, tags: {slot: number, id: number}[] | null}} wagon
 * @param {import("./types.js").DrawBox[]} boxes
 */
export function drawWagon(view, wagon, boxes) {}

/**
 * A locomotive.
 * @param {{center: number[], heading: number, length_m: number, alpha: number, lit: boolean, label: string}} loco
 */
export function drawLocomotive(view, loco) {}

/**
 * A truck (tractor and chassis) and its containers.
 * @param {{id: string, type: object, center: number[], heading: number, alpha: number, lit: boolean, label: string}} truck
 * @param {import("./types.js").DrawBox[]} boxes
 */
export function drawTruck(view, truck, boxes) {}

/**
 * An inland barge and its containers, per bay.
 * @param {{type: object, center: number[], heading: number, alpha: number, lit: boolean, name: string}} barge
 * @param {import("./types.js").DrawBox[][]} boxesByBay
 */
export function drawBarge(view, barge, boxesByBay) {}

/**
 * A gantry crane: legs, girders, trolley, ropes, spreader and the hanging box.
 * @param {{geometry: object, s: number, t: number, z: number, spreader_m: number, load: import("./types.js").DrawBox | null, name: string, lit: boolean}} crane
 */
export function drawCrane(view, crane) {}

/**
 * A reach stacker with its boom and load.
 * @param {{center: number[], heading: number, boom: number, lift: number, spreader_m: number, load: import("./types.js").DrawBox | null, name: string, lit: boolean}} rs
 */
export function drawReachStacker(view, rs) {}

/** Ground of a yard block: surface, cell lines and the block name. */
export function drawYardGround(view, geometry, { name = "" } = {}) {}

/** Bay and row numbers of a yard block. */
export function drawYardLabels(view, geometry) {}

/** Rails and runway of a gantry crane. */
export function drawCraneRails(view, geometry) {}

/** A truck lane, its passing lane and the outlines of the truck positions (arc lengths, mm). */
export function drawTruckLane(view, geometry, { positions = [] } = {}) {}

/** Water and quay wall. */
export function drawQuay(view, geometry) {}

/** The selected container, possible targets and empty slots (overlay layer). */
export function drawHighlights(view, { selected = null, targets = [], empties = [] } = {}) {}

/** A dashed outline at height z with a label (e.g. a model wagon that is not visible). */
export function drawGhost(view, footprint, z, label) {}

/**
 * The box under a canvas point (CSS px): the one whose projected outline contains it (+3 px
 * tolerance); the box nearest to the camera wins.
 * @param {import("./types.js").Box[]} boxes
 * @returns {string | null} its id
 */
export function pickBoxes(view, boxes, u, v) {
  return null;
}
