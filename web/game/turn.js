// A slow role's turn on the table. The asset manager, the transport authority's contract manager
// and the budget rapporteur decide for a year or a month, not for a minute: their games have no
// trains to run. But what they decide about lies on the lab's layout, and a board shows it there
// from the game's own account of its scene (`view().scene`, a list of things in a small
// vocabulary): the condition of the track as a tint on the rails, the teams of the staff plan as
// vans at the maintenance base, the renewals as building sites, the speed restrictions as yellow
// stretches, last year's faults as lamps that flash at the assets, the trips of a period as a tally
// along the platform, a project as the stages built of a line. What an open decision is about
// pulses where it is, and a click there brings that decision up. Nothing is written on the table.
// The board knows no game: it draws things. Data, geometry and drawing on a View: no DOM.
import { CD, CD_LIGHT, OVERLAY, STAFF_COLOURS, drawPerson, grey, polylineAt, polylineProject, prismFaces, rectFootprint, rgba } from "../arail/index.js";
import { DISTRICT_TABLE, drawBase, drawTeamVan } from "./district.js";
import { TABLE, TableStation } from "./table.js";

/**
 * The places a scene can name (`at` of an "ask" or a "tally"), on the layout (mm): the maintenance
 * base, the platform tracks, where the renewals build, an asset out on the line, the station
 * building, platform 1, the undertaking's trains at platform 2, the line a project upgrades, the town.
 */
export const PLACES = {
  base: [4780, -392],
  tracks: [3000, 330],
  works: [2500, 222],
  asset: [-1750, 485],
  station: [2930, -107],
  platform: [2900, 416],
  trains: [3300, 268],
  project: [7250, 322],
  town: [1500, -420],
};

/** The things a scene can have: the vocabulary of `view().scene`. */
export const THINGS = ["condition", "teams", "works", "restrictions", "faults", "tally", "project", "ask"];

/** The colours of a scene: the tones of a tally, the grades of the condition from good to bad, a restriction, what is asked. */
const TONE = { ok: "#3ed37a", warn: CD_LIGHT.orange, bad: CD.rot, muted: grey(0.6), choice: OVERLAY.task, slow: "#f2c400", built: CD_LIGHT.tuerkis };
const GRADES = [[2, "#3ed37a"], [3, "#a5d84a"], [3.6, "#f2c400"], [4.3, CD_LIGHT.orange], [5, CD.rot]];
/** Where the renewals build (a section of the table and how far along it, 0 … 1), and where speed restrictions lie. */
const SITES = [["g3", 0.45], ["bw", 0.5], ["ae", 0.45]], SLOW = [["aw", 0.4], ["be", 0.35], ["ae", 0.8], ["bw", 0.15], ["g1", 0.5]];
/** The most faults flashing at a time, the faults of a year that make one flash more, and how long a set of them stays (s of the world). */
const FLASH = { most: 8, per: 45, every_s: 5 };
/** How near a click must be to what a decision is about (CSS px). */
export const HIT_PX = { ask: 30 };

const circle = ([x, y], r, n = 22) => Array.from({ length: n }, (_, i) => [x + r * Math.cos((i * 2 * Math.PI) / n), y + r * Math.sin((i * 2 * Math.PI) / n)]);
const atLeast = (view, at, mm, px) => Math.max(mm, (px * view.px) / Math.max(1e-6, view.pxPerMM(at[0], at[1], at[2] ?? 0)));

/** The colour of a condition grade (1 very good … 6 unusable). */
export function gradeColour(grade) {
  for (const [most, colour] of GRADES) if (grade <= most) return colour;
  return GRADES.at(-1)[1];
}

/**
 * What is wrong with a scene: a thing the board does not know, an "ask" or a "tally" at a place it has not.
 * @param {Array<{thing: string, at?: string}>} scene
 * @returns {string[]}
 */
export function sceneProblems(scene) {
  const problems = [];
  for (const x of scene ?? []) {
    if (!THINGS.includes(x.thing)) problems.push(`The scene has a thing the table does not know: ${x.thing}.`);
    else if ((x.thing === "ask" || x.thing === "tally") && !PLACES[x.at]) problems.push(`The scene names a place the table does not have: ${x.at}.`);
  }
  return problems;
}

/**
 * The board of a slow role's turn on the layout's world: one of the world's simulations (drawn
 * with everything else). It shows the scene of its game and says which decision is asked at a pixel.
 */
export class TurnBoard {
  static elevation = "ground";
  static type = "turn-board";

  /** @param {import("../arail/index.js").World} world the world of the layout the table lies on */
  constructor(world) {
    this.world = world;
    this.station = new TableStation();
    this.enabled = true;
    this.config = { type: TurnBoard.type };
    /** @type {{view: () => {scene?: object[]}} | null} the game shown: any game whose view has a scene */
    this.game = null;
    /** What is chosen (the decision in focus: "ask-teams"), and the moves offered from it (none: a decision's choices are asked beside the table). */
    this.picked = null;
    this.offers = [];
    /** Whether a person can choose (else the board only shows). */
    this.active = false;
    world.simulations.push(this);
  }

  /** Show a game (null: none). */
  show(game) {
    this.game = game ?? null;
  }

  /** Take the board out of its world again. */
  dispose() {
    const sims = this.world.simulations, i = sims.indexOf(this);
    if (i >= 0) sims.splice(i, 1);
  }

  /** The scene of the game shown: the things it names that the board knows. */
  scene() {
    // (a game's own scene(), cheap enough for every frame; a game without one gives it with its view)
    let scene = [];
    try {
      scene = (typeof this.game?.scene === "function" ? this.game.scene() : this.game?.view().scene) ?? [];
    } catch (e) {
      // said once: the table is blank, and the error is not lost
      if (!this.failed) console.error("The table cannot show this game's scene:", e);
      this.failed = true;
      scene = [];
    }
    return scene.filter((x) => THINGS.includes(x.thing));
  }

  /** A point of the table's rails: so far (0 … 1) along a section of the signaller's station. */
  on(section, share) {
    const w = this.station.way(section, "+", 1);
    return polylineAt(w.points, w.total * share, w.lengths);
  }

  /**
   * Where the open decisions are asked: each at the place its scene names, those at one place side by side.
   * @returns {Array<{id: string, at: number[]}>}
   */
  asks(scene = this.scene()) {
    const here = new Map(), out = [];
    for (const x of scene) {
      if (x.thing !== "ask" || !PLACES[x.at]) continue;
      const n = here.get(x.at) ?? 0, p = PLACES[x.at];
      here.set(x.at, n + 1);
      out.push({ id: x.id, at: [p[0] + n * 150, p[1]] });
    }
    return out;
  }

  step() {}

  pickables() {
    return [];
  }

  states() {
    return [];
  }

  describeObject() {}

  describeVehicle() {}

  toJSON() {
    return { ...this.config };
  }

  /**
   * Draw the scene on the table, thing by thing, and what the open decisions are about. No text.
   * @param {import("../arail/index.js").View} view
   */
  draw(view) {
    if (!this.game) return;
    const scene = this.scene();
    for (const x of scene) this[`_${x.thing}`]?.(view, x);
    this._asks(view, scene);
  }

  /** The condition of the track: every rail of the station and its lines tinted by the grade. */
  _condition(view, x) {
    const colour = gradeColour(x.grade);
    for (const [id, ways] of Object.entries(TABLE.sections)) {
      for (const pos of Object.keys(ways)) view.ribbon(this.station.way(id, pos, 1).points, 24, { fill: rgba(colour, 0.55), order: 5, emissive: true });
    }
  }

  /** The staff plan: the maintenance base with a van for every team, and a smaller one for the technician on call. */
  _teams(view, x) {
    const b = DISTRICT_TABLE.base;
    drawBase(view, b);
    for (let i = 0; i < Math.min(b.yard.length - 1, x.n ?? 0); i++) drawTeamVan(view, b.yard[i], [0, 1], { trade: i % 2 ? "track" : "signalling" });
    if (x.on_call) drawTeamVan(view, b.yard.at(-1), [0, 1], { trade: "signalling", small: true });
  }

  /** The renewals: building sites on the rails, more of them the more is built: barriers, a machine and people at work. */
  _works(view, x) {
    const m = (v) => view.m(v), t = view.time ?? 0;
    SITES.slice(0, Math.max(0, Math.min(SITES.length, x.n ?? 0))).forEach(([section, share], k) => {
      const w = this.station.way(section, "+", 1), mid = w.total * share, a = polylineAt(w.points, Math.max(0, mid - 190), w.lengths).point, b = polylineAt(w.points, Math.min(w.total, mid + 190), w.lengths).point;
      const p = polylineAt(w.points, mid, w.lengths), n = [-p.dir[1], p.dir[0]];
      view.ribbon([a, p.point, b], 30, { fill: rgba(CD_LIGHT.orange, 0.5), order: 6, emissive: true });
      // the barriers at both ends, the machine on the rails
      for (const q of [a, b]) view.faces(prismFaces(rectFootprint(q, m(0.5), m(4.5), Math.atan2(p.dir[1], p.dir[0])), 0, m(1.3), { side: CD.rot, top: CD.white }), [q[0], q[1], m(1)]);
      const at = polylineAt(w.points, mid + 60 * Math.sin(t * 0.25 + k), w.lengths).point;
      view.faces(prismFaces(rectFootprint(at, m(9), m(2.8), Math.atan2(p.dir[1], p.dir[0])), m(0.6), m(3.4), { side: "#f2c400", top: "#d9ad00" }), [at[0], at[1], m(2)]);
      for (const i of [0, 1]) {
        const s = p.point, r = m(4 + 3 * i), ang = t * 0.9 + i * 2 + k;
        drawPerson(view, [s[0] + n[0] * m(3.5) + p.dir[0] * r * Math.cos(ang), s[1] + n[1] * m(3.5) + p.dir[1] * r * Math.cos(ang)], { dir: [p.dir[0] * -Math.sin(ang), p.dir[1] * -Math.sin(ang)], speed: 0.6, phase: t * 5 + i, height: 1.8, colour: STAFF_COLOURS.body, legs: STAFF_COLOURS.legs });
      }
    });
  }

  /** The speed restrictions: a yellow stretch of rail each, with the sign's board on a post beside it. */
  _restrictions(view, x) {
    const m = (v) => view.m(v);
    SLOW.slice(0, Math.max(0, Math.min(SLOW.length, x.n ?? 0))).forEach(([section, share]) => {
      const w = this.station.way(section, "+", 1), mid = w.total * share, lo = Math.max(0, mid - 130), hi = Math.min(w.total, mid + 130);
      view.ribbon([polylineAt(w.points, lo, w.lengths).point, polylineAt(w.points, mid, w.lengths).point, polylineAt(w.points, hi, w.lengths).point], 26, { fill: rgba(TONE.slow, 0.75), order: 6, emissive: true });
      const p = polylineAt(w.points, lo, w.lengths), at = [p.point[0] - p.dir[1] * 30, p.point[1] + p.dir[0] * 30];
      view.faces([...prismFaces(rectFootprint(at, m(0.25), m(0.25)), 0, m(3), { side: grey(0.35), top: grey(0.35) }), ...prismFaces(rectFootprint(at, m(0.3), m(1.6)), m(3), m(4.6), { side: TONE.slow, top: TONE.slow })], [at[0], at[1], m(2)]);
    });
  }

  /** The assets a fault can flash at: the signals of the station, its points, the level crossing. */
  assets() {
    if (!this._assets) {
      const st = this.station.station, out = Object.keys(st.signals).map((id) => this.station.signal(id).at);
      for (const p of Object.values(st.points)) out.push(this.on(p.section, 0.5).point);
      out.push(DISTRICT_TABLE.spots.bue.at, DISTRICT_TABLE.spots.lift.at);
      this._assets = out;
    }
    return this._assets;
  }

  /** Last year's faults: red lamps that flash at the assets, a few at a time, more of them the more faults the year had. */
  _faults(view, x) {
    const all = this.assets(), n = Math.max(1, Math.min(FLASH.most, Math.round((x.n ?? 0) / FLASH.per))), t = view.time ?? 0, set = Math.floor(t / FLASH.every_s), beat = view.pulse ?? 1;
    for (let i = 0; i < n; i++) {
      // (which assets: another few every few seconds, the same for everybody who looks)
      const at = all[(set * 7 + i * 5) % all.length], r = atLeast(view, at, view.m(2.4), 6);
      view.polygon(circle(at, r * (1 + 0.5 * beat)), { fill: rgba(TONE.bad, 0.15 + 0.3 * beat), stroke: rgba(TONE.bad, 0.9), width: 1.6, order: 7, emissive: true });
      view.glow([at[0], at[1], view.m(2)], view.m(2), TONE.bad, 0.4 + 0.6 * beat);
    }
  }

  /** A tally: a row of discs along the platform, as many of each tone as the scene says (the trips on time, late, cancelled). */
  _tally(view, x) {
    const c = PLACES[x.at];
    if (!c) return;
    const tones = (x.parts ?? []).flatMap((p) => Array.from({ length: Math.max(0, Math.round(p.n ?? 0)) }, () => p.tone)), w = this.station.way("g1", "+", 1);
    // (along the track beside the place, as far from the rails as the place is)
    const on = polylineProject(w.points, c, w.lengths), off = c[1] - polylineAt(w.points, on.s, w.lengths).point[1], gap = Math.min(70, (w.total * 0.8) / Math.max(1, tones.length));
    tones.forEach((tone, i) => {
      const p = polylineAt(w.points, Math.max(0, Math.min(w.total, on.s + (i - (tones.length - 1) / 2) * gap)), w.lengths), at = [p.point[0], p.point[1] + off];
      const r = atLeast(view, at, view.m(1.9), 4), colour = TONE[tone] ?? TONE.muted;
      view.polygon(circle(at, r, 14), { fill: tone === "bad" ? rgba(colour, 0.15) : rgba(colour, 0.85), stroke: colour, width: tone === "bad" ? 2 : 1, order: 8, emissive: true });
    });
  }

  /** A project in stages along its line: the stages built are a band on the rails, the next one an outline that pulses, the rest faint. */
  _project(view, x) {
    const w = this.station.way("aw", "+", 1), n = Math.max(1, x.stages ?? 1), beat = view.pulse ?? 1;
    for (let i = 0; i < n; i++) {
      // (from the station outwards: the first stage is the one next to it)
      const hi = w.total * (1 - i / n) - 12, lo = w.total * (1 - (i + 1) / n) + 12, pts = [polylineAt(w.points, lo, w.lengths).point, ...w.points.filter((_, k) => w.lengths[k] > lo && w.lengths[k] < hi), polylineAt(w.points, hi, w.lengths).point];
      const built = i < (x.built ?? 0), next = i === (x.built ?? 0);
      view.ribbon(pts, 34, { fill: built ? rgba(TONE.built, 0.8) : next ? rgba(TONE.built, 0.15 + 0.25 * beat) : rgba(grey(0.6), 0.25), order: 6, emissive: true });
      if (!built) continue;
      // a new mast beside every stage built
      const mid = polylineAt(w.points, (lo + hi) / 2, w.lengths), at = [mid.point[0] + mid.dir[1] * 34, mid.point[1] - mid.dir[0] * 34], m = (v) => view.m(v);
      view.faces([...prismFaces(rectFootprint(at, m(0.4), m(0.4)), 0, m(8), { side: grey(0.5), top: grey(0.5) }), ...prismFaces(rectFootprint([at[0] - mid.dir[1] * m(1.4), at[1] + mid.dir[0] * m(1.4)], m(0.25), m(3.2), Math.atan2(mid.dir[1], mid.dir[0])), m(7.2), m(7.6), { side: grey(0.5), top: grey(0.5) })], [at[0], at[1], m(4)]);
    }
  }

  /** What the open decisions are about: a ring and a pin at each place, pulsing; the one in focus is filled. */
  _asks(view, scene) {
    const beat = view.pulse ?? 1, m = (v) => view.m(v);
    for (const a of this.asks(scene)) {
      const [x, y] = a.at;
      if (!view.inImage(x, y, 0, 200)) continue;
      const chosen = this.picked === `ask-${a.id}`, r = atLeast(view, a.at, m(3.4), 9) * (chosen ? 1.25 : 1 + 0.35 * beat);
      view.polygon(circle(a.at, r), { fill: rgba(TONE.choice, chosen ? 0.6 : 0.18 + 0.3 * beat), stroke: TONE.choice, width: chosen ? 2.6 : 1.8, order: 9, emissive: true });
      view.faces([...prismFaces(rectFootprint(a.at, m(0.3), m(0.3)), 0, m(6), { side: grey(0.25), top: grey(0.25) }), ...prismFaces(rectFootprint(a.at, m(1.5), m(1.5), Math.PI / 4), m(6), m(7.6), { side: TONE.choice, top: TONE.choice })], [x, y, m(4)], { emissive: true });
      view.glow([x, y, m(7)], m(2.6), TONE.choice, 0.5 + 0.5 * beat);
    }
  }

  /* ---------------------------------------------------------------- choosing */

  /**
   * What of the board is at a pixel: what an open decision is about (`{ask}`, the decision's id), or null.
   * @param {import("../arail/index.js").View} view the view of the frame drawn last
   * @param {number[]} pixel [u, v] canvas px
   * @param {number} [scale] how many CSS px it may be away, as a factor (a finger: more)
   * @returns {{ask: string} | null}
   */
  hit(view, [u, v], scale = 1) {
    if (!this.game) return null;
    const mz = view.m(1);
    let best = null;
    for (const a of this.asks()) {
      for (const z of [0, 3.5, 7]) {
        const p = view.project(a.at[0], a.at[1], z * mz), d = p ? Math.hypot(p[0] - u, p[1] - v) : Infinity;
        if (d <= HIT_PX.ask * view.px * scale && (!best || d < best.d)) best = { d, id: a.id };
      }
    }
    return best ? { ask: best.id } : null;
  }

  /** Where an item is on the table ("ask-teams": what that decision is about), or null. */
  placeOf(item) {
    const [kind, id] = String(item ?? "").split(/-(.*)/s);
    return kind === "ask" ? this.asks().find((a) => a.id === id)?.at ?? null : null;
  }

  /** The part of the table a place lies in (`bounds`): "west", "platforms" or "east". */
  partOf([x]) {
    return x > 4300 ? "west" : x < 1500 ? "east" : "platforms";
  }

  /**
   * The part of the layout a turn needs in the picture (layout mm, [x0, y0, x1, y1]): the station with the base and the town's edge behind it, or a part of it.
   * @param {"all" | "west" | "platforms" | "east"} [part]
   */
  bounds(part = "all") {
    const x = { all: [-2000, 7800], west: [4100, 7900], platforms: [1200, 4700], east: [-2100, 1700] }[part] ?? [-2000, 7800];
    return [x[0], -480, x[1], 560];
  }
}
