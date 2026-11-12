// The play page of the big game (game/play/): a mission (missions/*.json) seats several roles of the
// railway, each seat one role's game, played by a person at this device or by the computer; the games
// are wired by flows (what one role gives another). The page lets a person choose a mission and the
// seats, play it in hot seat (the tabs are the seats), watch what the roles give each other, and
// read the result, with what led to what: each fault's time out of order and whose it was. It knows no game by name: every game is drawn from its view (a sketch of its world
// with what can be chosen in it, figures, tables, the moves that can be made now with their fields),
// its open decisions, its messages and its score.
// The session itself is arail/game/session.js; this page passes the people's moves to it and draws it.
import { GAMES, MISSION, Session, flowOf, lineFor, normalizeMission, staleLines, storyOf, validateMission, wiring } from "../../arail/game/index.js";
import { $, download, h, morph, mount, storage } from "../../app/ui.js";
import { PORTRAITS, faceOf, quoteIn, selfPortrait, speakerOf } from "../cast.js";
import { mark, termOf } from "../glossary.js";
import { PLACES, backdropAt, missionFacts, nightAt, placeOf, placeOfGame, placeOfMission, wideOf } from "../places.js";
import { BADGES, MAX_STARS, PROGRESS_KEY, badgesOf, meet, nextMission, rankOf, readProgress, record, starsFor, totalStars } from "../progress.js";
import { factChips } from "../scene.js";
import { NEUSTADT, shotOf } from "../shots.js";
import { hasMore, lead } from "../short.js";
import { SOUND_KEY, Sound } from "../sound.js";

/** What a mission is checked against beyond its games: the places and the portraits the game has pictures of. */
const CHECKS = { places: PLACES.map((p) => p.id), portraits: Object.keys(PORTRAITS) };
/** The way from this page to web/, for the places' photos. */
const BASE = "../../";
/** Where the page keeps whether the backdrop is live (live.js), and the narrowest window it runs in (px). */
const LIVE_KEY = "arail.game.live", LIVE_MIN_PX = 700;

const MISSIONS = "../missions/";
const SAVE_FORMAT = "arail-session/1";
/** Where a mission's session is kept in the browser, and what the seats' games were told (`Game.settings`; no passwords). */
const saveKey = (id) => `arail.play.${id}`;
const SETTINGS_KEY = "arail.play.settings";
const SPEEDS = [[0, "Pause"], [1, "1×"], [5, "5×"], [20, "20×"]];
/** How long a message stays up as a pop-up (one at a time; all of them are under the bell). */
const TOAST_MS = 5000;
/**
 * The icons of the rail: drawn as lines in a 24 × 24 box (the stroke takes the button's colour). A
 * button with an icon names itself with `aria-label`, and its `title` says the same on hover.
 */
const ICONS = {
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  pin: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  flows: "M4 8h13l-3-3M20 16H7l3 3",
  sound: "M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11",
  live: "M4 6h12v12H4zM16 10l5-3v10l-5-3",
  picture: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01",
  leave: "M10 4H5v16h5M14 8l-4 4 4 4M10 12h11",
  desk: "M8 4h8v3H8zM6 6H5v15h14V6h-1M8 11h8M8 15h6",
  moves: "M14.5 5.5a4 4 0 0 0 5 5L11 19a2.1 2.1 0 0 1-3-3l8.5-8.5zM5 5l3 3",
  computer: "M5 5h14v10H5zM9 19h6M12 15v4",
  person: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
};

/** An icon of the rail as SVG, hidden from screen readers (its button is named). */
function icon(name) {
  return s("svg", { class: "icon", viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" }, s("path", { d: ICONS[name] ?? "" }));
}
/** The messages and flows shown; the panels are drawn every DRAW_MS, the session saved every SAVE_MS, a refusal shown for REFUSED_MS. */
const LOG_LINES = 40, FLOW_LINES = 60, BUMP_MS = 1200,
  /** Of a game met with many messages already (a session taken up again), the last ones are read; a word comes in every WORD_MS; a decision with less than LOW_SHARE of its time left hurries. */
  STORY_MOST = 3, WORD_MS = 26, LOW_SHARE = 0.34,
  /** A seat is a person's, for the logbook, when a person held it for at least this part of its work (Session.heldByPeople). */
  HELD_SHARE = 0.5,
  /** On the verdict a star comes in every STAR_MS. */
  STAR_MS = 380, DRAW_MS = 250, SAVE_MS = 5000, REFUSED_MS = 20000;
const SEVERITY = ["", "a slip", "a breach", "a danger to people"];

/** The time of day (HH:MM:SS) of a shift that began at `start` ("08:00"), `t` seconds in. */
function clockOf(start, t) {
  const [hh, mm] = String(start ?? "08:00").split(":").map(Number);
  const s = Math.max(0, Math.floor((hh || 0) * 3600 + (mm || 0) * 60 + t));
  const two = (n) => String(n).padStart(2, "0");
  return `${two(Math.floor(s / 3600) % 24)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

/** The time of day (minutes after midnight) of a shift that began at `start` ("08:00"), `t` seconds in. */
function dayMinutes(start, t) {
  const [hh, mm] = String(start ?? "08:00").split(":").map(Number);
  return (((hh || 0) * 60 + (mm || 0) + t / 60) % 1440 + 1440) % 1440;
}

/** A number to read: rounded (one decimal below 100), large ones with separators. */
function num(v) {
  if (!Number.isFinite(v)) return String(v);
  const r = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return Math.abs(r) >= 10000 ? r.toLocaleString("en-GB") : String(r);
}

/** A unit at the end of a payload's key (CONTRIBUTING.md, units in names): `eta_s: 300` reads "eta: 300 s". */
const UNIT = /_(s|min|h|m|km|mm|deg|eur)$/;
const UNIT_TEXT = { deg: "°", eur: "€" };

/** A value of a payload in a few words. */
function valueText(v, deep = false) {
  if (typeof v === "number") return num(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return deep ? `${v.length} items` : `${v.slice(0, 4).map((x) => valueText(x, true)).join("; ")}${v.length > 4 ? "; …" : ""}`;
  if (v && typeof v === "object") return deep ? "…" : `(${Object.entries(v).slice(0, 4).map(([k, x]) => `${k.replaceAll("_", " ")}: ${valueText(x, true)}`).join("; ")})`;
  const s = String(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

/** A flow's payload in one line: `key: value` pairs, numbers rounded, yes and no, nothing for what is empty. */
function payloadLine(payload, most = 8) {
  const parts = [];
  for (const [k, v] of Object.entries(payload ?? {})) {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    const unit = typeof v === "number" ? UNIT.exec(k)?.[1] : null;
    parts.push(`${(unit ? k.replace(UNIT, "") : k).replaceAll("_", " ")}: ${valueText(v)}${unit ? ` ${UNIT_TEXT[unit] ?? unit}` : ""}`);
  }
  return parts.length > most ? `${parts.slice(0, most).join(" · ")} · …` : parts.join(" · ");
}

const SVG = "http://www.w3.org/2000/svg";
/** An SVG element, made as `h` makes the others (handlers as properties, so that `morph` carries them over); its texts are names and stay as they are. */
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      el[k] = v;
      (el._handlers ||= []).push(k);
    } else el.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
/** The width of a text in a sketch (px), near enough for a box around it. */
const textWidth = (text, small = false) => String(text).length * (small ? 6.2 : 7.6);

/** A sentence, for the list of what is announced. */
const sentence = (text) => (/[.?!…]$/.test(text) ? text : `${text}.`);
/** A part of an element id. */
const safe = (x) => String(x).replace(/[^A-Za-z0-9_-]/g, "_");
/** Whether a move was refused: `false`, or `{ok: false, reason}`. */
const refusedBy = (res) => res === false || res?.ok === false;

/**
 * Keep the children of `el` as one element per item, by its key. An element stays the same element
 * while its item is there, whatever comes or goes before it (a decision answered, a move that
 * appears): a click or the focus never lands on another item's button.
 * @param {Element} el
 * @param {object[]} items
 * @param {(item: object) => string} keyOf
 * @param {(item: object) => HTMLElement} make the element of a new item
 * @param {(el: HTMLElement, item: object, key: string) => void} fill draw the item into its element
 */
function keyed(el, items, keyOf, make, fill) {
  const old = new Map([...el.children].map((c) => [c.dataset.key, c])), seen = new Map();
  const next = items.map((item) => {
    let key = String(keyOf(item));
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n) key = `${key}#${n}`;
    let c = old.get(key);
    if (c) old.delete(key);
    else {
      c = make(item);
      c.dataset.key = key;
    }
    fill(c, item, key);
    return c;
  });
  for (const c of old.values()) c.remove();
  let at = el.firstElementChild;
  for (const c of next) {
    if (c === at) at = at.nextElementSibling;
    else el.insertBefore(c, at);
  }
}

class PlayPage {
  /** @param {{games?: Map<string, Function>}} [options] the role games that can be seated (a test adds its own) */
  constructor({ games = GAMES } = {}) {
    this.games = games;
    /** The missions of missions.json (their documents), and the roles of the catalogue by id (for their names). */
    this.missions = [];
    this.roles = new Map();
    this.ready = false;
    /** The mission chosen (its document), and who sits where with which seed, as chosen for its next session. */
    this.doc = null;
    this.choice = null;
    /** @type {Session | null} the session played, or read as a result */
    this.session = null;
    this.mission = null;
    /** @type {"choose" | "play" | "result"} */
    this.screen = "choose";
    /** The decision in focus per seat (its id). */
    this.focus = new Map();
    /** The decisions whose whole text is shown (their ids). */
    this.whole = new Set();
    /** When a decision with a deadline was first shown (seat|id → the game's time), for its countdown; those that have hurried. */
    this.asked = new Map();
    this.hurried = new Set();
    /** What the player has reached (progress.js), kept in the browser; what the last session added to it. */
    this.progress = readProgress(storage.get(PROGRESS_KEY, null));
    this.gained = null;
    /** Of the session that ended: the seats that were a person's for most of their work, and whether no person ever held one. */
    this.yours = new Set();
    this.watched = true;
    /** What a person decided in this session, for the mission's sheet, and the railway terms met in it. */
    this.diary = [];
    this.met = new Set();
    /** How many of a game's messages a person has read, in turns (by game). */
    this.read = new WeakMap();
    /**
     * The lines of the mission's story for the phase played (storyOf); those answered, seat by seat (a line for
     * everybody is said at every seat); those said aloud (seat|index); and, of a saved session taken up again, the
     * lines answered in the phase it stood in.
     */
    this.beats = [];
    /** @type {Map<string, Set<number>>} */
    this.heardLines = new Map();
    this.saidLines = new Set();
    this.keptHeard = null;
    /** The railway term explained (its id), or null. */
    this.term = null;
    /**
     * The live backdrop (live.js, loaded when first wanted): whether the player wants it, the scene
     * once it runs, and the picture shown now with whether it may be live and at what time of day.
     */
    this.liveOn = storage.get(LIVE_KEY, true) !== false;
    this.live = null;
    this.liveLoading = false;
    this.pic = null;
    /** Only the picture is shown (H). */
    this.bare = false;
    this.sound = new Sound({ on: storage.get(SOUND_KEY, true) !== false });
    this.speed = 1;
    this.lastSpeed = 1;
    /** The seat shown, the flow the list is filtered by, the phase the page has seen (index of the session's plan). */
    this.tab = null;
    this.filter = "";
    this.index = -1;
    /** What a person has filled into the forms (by input id), and the moves refused (by seat and move). */
    this.drafts = new Map();
    this.refused = new Map();
    /** What is chosen in a seat's sketch (the id of the item, by seat id). */
    this.picked = new Map();
    /** The decisions already announced. */
    this.heard = new WeakSet();
    /** The table frames that scroll sideways now (they can be reached with the keyboard). */
    this.wide = new Set();
    /** The seats' panels with their parts, by seat id. */
    this.panels = new Map();
    this.words = [];
    this.note = "";
    this.dirty = false;
    this.prev = null;
    this.lastDraw = 0;
    this.lastSave = 0;
    /** What is open at the side (the id of its panel), or null; the pop-up shown, and until when. */
    this.opened = null;
    this.toastUntil = 0;
    /** Of each game, how many of its messages have been seen (under the bell, or read in a turn). */
    this.seen = new WeakMap();
    this.savedAs = "";
    this.exchanging = false;
    this.controls();
    this.loaded = this.load();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** The handlers of the page's own markup (index.html). */
  controls() {
    mount($("#speed"), SPEEDS.map(([v, label]) => h("button", { type: "button", "aria-pressed": String(this.speed === v), onclick: () => this.setSpeed(v) }, label)));
    $("#endTurn").onclick = () => this.endTurn();
    $("#skip").onclick = () => this.skip();
    $("#leave").onclick = () => this.choose(null);
    $("#showFlows").onclick = () => this.openFlows();
    $("#closeFlows").onclick = () => $("#flowsDialog").close();
    $("#sound").onclick = () => this.setSound(!this.sound.on);
    $("#sound").setAttribute("aria-pressed", String(this.sound.on));
    $("#liveBtn").onclick = () => this.setLive(!this.liveOn);
    $("#liveBtn").setAttribute("aria-pressed", String(this.liveOn));
    $("#bare").onclick = () => this.setBare(true);
    $("#bareBack").onclick = () => this.setBare(false);
    // the rail: every button an icon; three of them open what is behind them, one at a time
    for (const b of document.querySelectorAll("#rail [data-icon]")) b.prepend(icon(b.dataset.icon));
    for (const id of ["missionBtn", "placeBtn", "bellBtn"]) $(`#${id}`).onclick = () => this.flyout($(`#${id}`).getAttribute("aria-controls"));
    $("#toast").onclick = () => this.flyout("bellPanel", true);
    // a click elsewhere closes what is open at the side
    document.addEventListener("pointerdown", (e) => {
      if (this.opened && !e.target.closest?.("#rail")) this.flyout(null);
    });
    $("#flowFilter").onchange = (e) => {
      this.filter = e.target.value;
      this.flows(true);
    };
    $("#tabs").addEventListener("keydown", (e) => this.tabKey(e));
    document.addEventListener("keydown", (e) => this.key(e));
    addEventListener("popstate", () => this.route());
    // the little train stands at its stop also after the window has changed its size
    addEventListener("resize", () => this.screen === "choose" && this.train());
    addEventListener("pagehide", () => {
      this.save();
      // also a page the browser keeps for "back": it may be thrown away later without another word, and what a
      // game holds elsewhere (the lab's instance) must be given back before
      this.leave();
    });
    addEventListener("pageshow", (e) => {
      if (e.persisted) this.back();
    });
  }

  /* ---------------------------------------------------------------- 1: missions and seats */

  /** Load the missions (missions.json and each mission it lists) and the role catalogue, then open what the address names. */
  async load() {
    const json = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json();
    };
    try {
      const [list, cat] = await Promise.all([json(`${MISSIONS}missions.json`), json("../roles/roles.json").catch(() => null)]);
      for (const r of cat?.roles ?? []) this.roles.set(r.id, r);
      const docs = await Promise.all((list.missions ?? []).map((file) => json(MISSIONS + file).catch(() => null)));
      this.missions = docs.filter((d) => d?.id);
      const lost = docs.length - this.missions.length;
      if (lost) this.failed = `${lost === 1 ? "1 mission" : `${lost} missions`} could not be loaded.`;
    } catch (e) {
      this.failed = `The missions could not be loaded (${e.message}).`;
    }
    this.ready = true;
    this.route();
  }

  /** The address: `?mission=<id>` opens that mission; without one, the mission to play next. */
  route() {
    const id = new URLSearchParams(location.search).get("mission");
    this.open(this.missions.find((m) => m.id === id) ?? this.suggested());
  }

  /** The mission to play next (progress.js): the first that is not passed yet. */
  suggested() {
    const id = nextMission(this.progress, this.missions.map((m) => m.id));
    return this.missions.find((m) => m.id === id) ?? null;
  }

  /** Choose a mission (null: back to the line of missions, with the mission that was chosen); the address follows. */
  choose(id) {
    this.note = "";
    const doc = this.missions.find((m) => m.id === id) ?? this.doc ?? this.suggested();
    const url = new URL(location.href);
    if (doc) url.searchParams.set("mission", doc.id);
    else url.searchParams.delete("mission");
    if (url.href !== location.href) history.pushState(null, "", url);
    this.open(doc);
    (doc ? $("#setupTitle") : $("#missionsTitle"))?.focus();
  }

  /** The mission before or after the one chosen, on the line (the arrow keys). */
  stepMission(by) {
    const i = this.missions.indexOf(this.doc), n = this.missions.length;
    if (!n) return;
    this.choose(this.missions[(Math.max(0, i) + by + n) % n].id);
  }

  /** Show the first screen with a mission chosen (or none). A session that runs is saved and left. */
  open(doc) {
    if (this.session && !this.session.over) this.save();
    this.leave();
    this.session = null;
    this.mission = null;
    this.doc = doc;
    this.choice = null;
    if (doc && !validateMission(doc, this.games, CHECKS).length) {
      const m = normalizeMission(doc, this.games), told = storage.get(SETTINGS_KEY, {}) ?? {};
      // what a seat's game must be told before it begins (the address of its world): as told last time, else its default
      const settings = Object.fromEntries(m.roles.map((r) => [r.id, Object.fromEntries((this.games.get(r.game).settings ?? []).map((x) => [x.id, told[`${r.game}.${x.id}`] ?? x.value ?? ""]))]));
      this.choice = { seats: Object.fromEntries(m.roles.map((r) => [r.id, r.seat])), seed: m.seed, settings };
    }
    this.show("choose");
    this.chooser();
  }

  /** @param {"choose" | "play" | "result"} screen */
  show(screen) {
    this.screen = screen;
    $("#main").dataset.screen = screen;
    // the page around the game knows the screen too (its styles follow it)
    document.body.dataset.screen = screen;
    if (screen !== "play" && this.bare) this.setBare(false);
    for (const id of ["choose", "play", "result"]) $(`#${id}`).hidden = id !== screen;
  }

  /**
   * The picture behind the screen: it fades to another one (two images, one over the other). While
   * a mission is played it can be live instead: where the picture has a shot of the layout that
   * runs, the live backdrop shows that, its camera flying there; the still picture stays below it.
   * @param {{photo: string, alt: string, focus: string, shot?: string | null}} pic a picture of places.js
   * @param {{live?: boolean, time?: number | null}} [options] live: it may be live; time: the time of day to show (minutes)
   */
  backdrop(pic, { live = false, time = null } = {}) {
    const el = $("#backdrop");
    if (!pic) return;
    this.pic = { pic, live, time };
    if (el.dataset.photo !== pic.photo) {
      el.dataset.photo = pic.photo;
      const [a, b] = el.children, next = a.classList.contains("on") ? b : a, prev = next === a ? b : a;
      next.style.objectPosition = pic.focus;
      next.onload = () => {
        if (el.dataset.photo !== pic.photo) return;
        next.classList.add("on");
        prev.classList.remove("on");
      };
      next.src = BASE + pic.photo;
    }
    const shot = live && this.wantsLive() ? shotOf(pic.shot) : null;
    if (shot && !this.live && !this.liveLoading) this.loadLive();
    const shown = !!shot && !!this.live?.can(shot);
    if (shown) {
      this.live.look(shot, { time });
      this.live.start();
    } else this.live?.stop();
    el.classList.toggle("live", shown);
  }

  /**
   * Whether the backdrop may be live: the player wants it, the window is wide enough, the system
   * does not ask for less motion, and the browser is a person's (a test's browser gets the still
   * pictures, unless the address asks for it with ?live).
   */
  wantsLive() {
    return this.liveOn && innerWidth >= LIVE_MIN_PX && !matchMedia("(prefers-reduced-motion: reduce)").matches
      && (!navigator.webdriver || new URLSearchParams(location.search).has("live"));
  }

  /** Load the live backdrop: the module with the framework behind it, then the layout; the picture shown then goes live. */
  async loadLive() {
    this.liveLoading = true;
    try {
      const { LiveScene } = await import("../live.js");
      const scene = new LiveScene($("#liveScene"));
      // too slow on this device: the still pictures stay
      scene.canvas.addEventListener("livefailed", () => $("#backdrop").classList.remove("live"));
      if (await scene.load(BASE + NEUSTADT, NEUSTADT)) this.live = scene;
    } catch {
      this.live = null;
    }
    if (this.live && this.pic) this.backdrop(this.pic.pic, this.pic);
  }

  /** The live backdrop on or off (kept in the browser). */
  setLive(on) {
    this.liveOn = !!on;
    storage.set(LIVE_KEY, this.liveOn);
    $("#liveBtn").setAttribute("aria-pressed", String(this.liveOn));
    if (this.pic) this.backdrop(this.pic.pic, this.pic);
  }

  /** Stars as they are shown: filled and empty, with their number for who does not see them. */
  stars(n, most = MAX_STARS, pop = false) {
    const got = pop ? Array.from({ length: n }, (_, i) => h("b", { style: `animation-delay: ${300 + i * STAR_MS}ms` }, "★")) : "★".repeat(n);
    return h("span", { class: `stars${pop ? " pop" : ""}` }, h("span", { "aria-hidden": "true" }, got, h("i", {}, "★".repeat(most - n))), h("span", { class: "visually-hidden" }, `${n} of ${most} stars`));
  }

  /** The sound on or off (kept in the browser). */
  setSound(on) {
    this.sound.set(on);
    storage.set(SOUND_KEY, !!on);
    $("#sound").setAttribute("aria-pressed", String(!!on));
  }

  /** Only the picture (H): the game's interface out of the way, and back. */
  setBare(on) {
    this.bare = !!on;
    if (this.bare) this.flyout(null);
    document.body.classList.toggle("bare", this.bare);
    $("#bare").setAttribute("aria-pressed", String(this.bare));
    $("#bareBack").hidden = !this.bare;
    (this.bare ? $("#bareBack") : $("#bare")).focus();
  }

  /** The name of a role of the catalogue. */
  roleName(id) {
    return this.roles.get(id)?.name ?? id;
  }

  /** A role's name with its German name. */
  roleText(id) {
    const de = this.roles.get(id)?.name_de;
    return [this.roleName(id), de ? [" ", h("span", { class: "de", lang: "de" }, `(${de})`)] : null];
  }

  /** A seat's name: its role (with the seat's id where a mission seats a role twice). */
  seatName(id, roles = null) {
    const seat = roles ? roles.find((r) => r.id === id) : this.session?.seat(id);
    return seat ? `${this.roleName(seat.role)}${seat.id !== seat.role ? ` (${seat.id})` : ""}` : id;
  }

  /** A mission in a line: its rounds and the phases of a round. */
  outline(m) {
    const phases = m.phases.map((p) => `${p.title} (${p.kind === "shift" ? `a shift of ${num(p.length / 60)} min` : "a turn"})`);
    return `${m.rounds === 1 ? "1 round" : `${m.rounds} rounds`}: ${phases.join(", ")}.`;
  }

  /**
   * The first screen: the missions as stops on a line, the mission chosen with its seats and Play,
   * and behind them the place where it plays. The rank the stars add up to leads to the logbook.
   */
  chooser() {
    const note = $("#missionsNote");
    note.textContent = this.failed ?? (this.missions.length ? "" : this.ready ? "There are no missions yet." : "Loading the missions.");
    note.hidden = !note.textContent;
    const next = nextMission(this.progress, this.missions.map((m) => m.id)), stars = totalStars(this.progress), rank = $("#rank");
    rank.hidden = !this.ready;
    mount(rank, h("span", { class: "n" }, h("span", { "aria-hidden": "true" }, "★ "), String(stars), h("span", { class: "visually-hidden" }, stars === 1 ? " star" : " stars")), h("strong", {}, rankOf(stars).title), h("span", { class: "go" }, "Logbook"));
    mount($("#missions"), this.missions.map((doc, i) => h("li", {}, this.stop(doc, i + 1, doc.id === next))));
    this.train();
    this.backdrop(wideOf(this.doc ? placeOfMission(normalizeMission(this.doc, this.games)) : placeOf()));
    this.setup();
    this.fit($("#choose"));
  }

  /** The little train on the line stands at the stop chosen (it runs there when another one is chosen). */
  train() {
    const line = $("#missions"), at = line.querySelector(".lv-stop.on")?.parentElement;
    let train = line.parentElement.querySelector(".lv-train");
    if (!train) {
      train = s("svg", { class: "lv-train", viewBox: "0 0 44 18", "aria-hidden": "true", focusable: "false" },
        s("path", { class: "body", d: "M2 3h30l9 7v4H2z" }), s("path", { class: "glass", d: "M5 5h6v4H5zM13 5h6v4h-6zM21 5h6v4h-6zM30 5h2l5 4h-7z" }),
        s("circle", { cx: 10, cy: 15, r: 2.4 }), s("circle", { cx: 32, cy: 15, r: 2.4 }));
      train.addEventListener("click", () => this.honk());
      line.parentElement.append(train);
    }
    train.style.display = at ? "" : "none";
    if (!at) return;
    train.style.left = `${at.offsetLeft + at.offsetWidth / 2}px`;
    // on a narrow screen the line scrolls sideways: the stop chosen is brought into view
    const box = line.parentElement;
    if (box.scrollWidth > box.clientWidth) box.scrollLeft = at.offsetLeft + at.offsetWidth / 2 - box.clientWidth / 2;
  }

  /** The little train sounds its horn (a click on it, or T): for no reason at all. */
  honk() {
    const train = document.querySelector(".lv-train");
    if (!train) return;
    this.sound.play("horn");
    train.classList.remove("honk");
    // the class again, so that the hop starts anew
    void train.getBoundingClientRect();
    train.classList.add("honk");
  }

  /** A mission as a stop on the line: its number, its name, the stars reached; the one to play next is marked. */
  stop(doc, no, next) {
    const chosen = this.doc === doc, got = this.progress.missions[doc.id];
    return h("a", {
      class: `lv-stop${chosen ? " on" : ""}${got?.passed ? " done" : ""}${next ? " next" : ""}`, id: `mission-${doc.id}`, href: `?mission=${encodeURIComponent(doc.id)}`, "aria-current": chosen ? "true" : null,
      onclick: (e) => {
        e.preventDefault();
        this.choose(doc.id);
      },
    },
    h("span", { class: "no" }, String(no).padStart(2, "0")),
    h("span", { class: "dot", "aria-hidden": "true" }),
    h("span", { class: "name" }, doc.title ?? doc.id),
    this.stars(got?.stars ?? 0),
    next ? h("span", { class: "tag ok" }, "next") : null);
  }

  /** The session of a mission kept in the browser, or null. */
  saved(id) {
    const s = storage.get(saveKey(id), null);
    return s?.format === SAVE_FORMAT && s.mission === id && Array.isArray(s.record) ? s : null;
  }

  /** Where a saved session stands, in words. */
  standing(m, saved) {
    try {
      const ph = new Session(m, { games: this.games }).plan[saved.at?.phase ?? 0];
      return `${m.rounds > 1 ? `round ${ph.round} of ${m.rounds}, ` : ""}${ph.title}${ph.kind === "shift" ? `, ${clockOf(ph.clock, (saved.at?.tick ?? 0) * ph.tick)}` : ""}`;
    } catch {
      return "its place is unknown";
    }
  }

  /**
   * The mission chosen, ready to play: its number and stars, its hook and facts, its seats as faces
   * to take (a seat taken is played by the person, the others by the computer), Play and Resume. Its
   * briefing, its phases, the seed and the wiring open below.
   */
  setup() {
    const el = $("#setup"), doc = this.doc, c = this.choice;
    el.hidden = !doc;
    if (el.hidden) return void mount(el);
    const problems = validateMission(doc, this.games, CHECKS), m = normalizeMission(doc, this.games);
    const no = this.missions.indexOf(doc) + 1, got = this.progress.missions[doc.id];
    const head = [
      h("p", { class: "play-no" }, `Mission ${String(no).padStart(2, "0")}`, got ? [" · ", this.stars(got.stars), ` · best ${got.best}`] : null),
      h("h2", { id: "setupTitle", tabindex: "-1" }, m.title ?? doc.id),
      h("p", { class: "play-hook" }, m.hook ?? lead(m.text)),
      factChips(missionFacts(m)),
    ];
    if (problems.length || !c) return void mount(el, head, h("p", { class: "hint error" }, `This mission cannot be played here: ${problems.join("; ")}.`));
    const again = Session.replayable(m, this.games);
    // a session that cannot be played again from its record is not kept (one kept by an earlier version goes)
    if (!again) storage.remove(saveKey(doc.id));
    const saved = again ? this.saved(doc.id) : null;
    const settings = m.roles.flatMap((r) => (this.games.get(r.game).settings ?? []).map((x) => [r, x]));
    mount(el, head,
      h("form", {
        class: "play-setup-form", id: "setupForm",
        onsubmit: (e) => {
          e.preventDefault();
          this.start();
        },
      },
      h("fieldset", { class: "lv-seats" }, h("legend", {}, m.roles.length > 1 ? "Take your seats" : "Your seat"),
        m.roles.map((r) => h("label", { class: "lv-seat", for: `by-${r.id}`, title: this.roles.get(r.role)?.name_de ?? null },
          h("input", { type: "checkbox", id: `by-${r.id}`, checked: c.seats[r.id] === "human", onchange: (e) => { c.seats[r.id] = e.target.checked ? "human" : "computer"; } }),
          h("img", { class: "face", src: BASE + selfPortrait(r.game).picture, alt: "" }),
          h("span", { class: "name" }, this.roleName(r.role), r.id !== r.role ? ` (${r.id})` : null),
          h("span", { class: "who", "aria-hidden": "true" })))),
      settings.map(([r, x]) => h("label", { class: "field play-setting", for: `set-${r.id}-${safe(x.id)}` }, h("span", {}, x.label),
        h("input", {
          type: x.type === "password" ? "password" : "text", id: `set-${r.id}-${safe(x.id)}`, autocomplete: "off", value: c.settings[r.id][x.id],
          oninput: (e) => {
            c.settings[r.id][x.id] = e.target.value;
            // kept in this browser for the next time, but never a key
            if (x.type !== "password") storage.set(SETTINGS_KEY, { ...storage.get(SETTINGS_KEY, {}), [`${r.game}.${x.id}`]: e.target.value });
          },
        }),
        x.hint ? h("small", { class: "help" }, x.hint) : null)),
      h("div", { class: "row play-go-row" },
        saved ? h("button", { class: "btn primary play-big", type: "button", id: "resume", onclick: () => this.resume() }, "Resume") : null,
        h("button", { class: `btn play-big${saved ? "" : " primary"}`, type: "submit", id: "start" }, h("span", { class: "play-go", "aria-hidden": "true" }, "▶"), saved ? "Start anew" : "Play"))),
      saved ? h("p", { class: "hint" }, `A session of this mission is saved in this browser (${this.standing(m, saved)}). Start begins a new one and replaces it.`) : null,
      again ? null : h("p", { class: "hint", id: "noResume" }, "A session of this mission cannot be taken up again once this page is closed: the world of one of its seats is elsewhere and would start anew."),
      this.note ? h("p", { class: "hint error" }, this.note) : null,
      // what nobody needs to start: the briefing, the phases, the seed, the wiring
      h("details", { class: "play-more" }, h("summary", {}, "Briefing and settings"),
        h("p", {}, m.text),
        h("p", { class: "hint" }, this.outline(m)),
        h("label", { class: "field", for: "seed" }, h("span", {}, "Seed"),
          h("input", {
            type: "number", id: "seed", min: "1", step: "1", value: c.seed,
            oninput: (e) => {
              const n = Math.round(Number(e.target.value));
              c.seed = e.target.value !== "" && Number.isFinite(n) && n >= 1 ? n : m.seed;
            },
          }),
          h("small", { class: "help" }, "The same seed and the same moves give the same session.")),
        this.wiringTable(doc, m)));
  }

  /** The mission's wiring: per seat the flows it takes and gives, and what is at their other end. */
  wiringTable(doc, m) {
    const ports = wiring(doc, this.games);
    const end = (p) => [...p.seats.map((id) => this.seatName(id, m.roles)), ...(p.mission ? ["the mission"] : [])].join(", ") || "itself";
    const cell = (seat, dir) => {
      const list = ports.filter((p) => p.seat === seat && p.dir === dir);
      return list.length ? h("ul", {}, list.map((p) => h("li", {}, h("strong", {}, flowOf(p.flow)?.name ?? p.flow), dir === "takes" ? " from " : " to ", end(p)))) : "–";
    };
    return h("div", { class: "play-wiring" },
      h("h3", {}, "The wiring of this mission"),
      h("p", { class: "hint" }, "What each seat takes from and gives to the others. Itself: no seat is at the other end, so the game plays that end itself."),
      this.scroller("wiring", "The wiring of this mission", h("table", { class: "game-table" },
        h("thead", {}, h("tr", {}, ["Seat", "Takes", "Gives"].map((c) => h("th", { scope: "col" }, c)))),
        h("tbody", {}, m.roles.map((r) => h("tr", {}, h("th", { scope: "row" }, this.seatName(r.id, m.roles)), h("td", {}, cell(r.id, "takes")), h("td", {}, cell(r.id, "gives"))))))));
  }

  /** A table in a frame that scrolls sideways where the table is too wide (then the frame can be reached with the keyboard, `fit`). */
  scroller(key, label, table) {
    return h("div", { class: "table-scroll", "data-scroll": key, role: "group", "aria-label": label, tabindex: this.wide.has(key) ? "0" : null }, table);
  }

  /** Find out which table frames scroll sideways now. */
  fit(root) {
    for (const el of root.querySelectorAll("[data-scroll]")) {
      const key = el.dataset.scroll, wide = el.scrollWidth > el.clientWidth + 1;
      if (wide === this.wide.has(key) && wide === el.hasAttribute("tabindex")) continue;
      if (wide) {
        this.wide.add(key);
        el.setAttribute("tabindex", "0");
      } else {
        this.wide.delete(key);
        el.removeAttribute("tabindex");
      }
    }
  }

  /* ---------------------------------------------------------------- a session begins, goes on, ends */

  /** The session shown is dropped (another begins, the missions are shown, the page is closed): its games give back what they hold elsewhere. */
  leave() {
    this.session?.leave().catch(() => {});
  }

  /**
   * The page is shown again from the browser's cache ("back"). A session all of whose games are here goes on as it
   * was. One with a seat whose world is elsewhere cannot: that world was given back when the page was left, so the
   * mission is shown again from its start, with a note.
   */
  back() {
    const s = this.session;
    if (!s || s.over || Session.replayable(s.mission, this.games)) return;
    this.note = "The session ended when this page was left: the world of one of its seats is elsewhere and was given back. Start begins a new one.";
    this.open(this.doc);
    this.say(this.note);
    $("#setupTitle")?.focus();
  }

  /** The mission chosen as a session plays it, each seat's game told what was entered for it (as options of its seat). */
  told() {
    const m = normalizeMission(this.doc, this.games);
    for (const r of m.roles) {
      const values = this.choice.settings?.[r.id] ?? {}, told = (this.games.get(r.game).settings ?? []).filter((x) => values[x.id] != null && values[x.id] !== "");
      if (told.length) r.options = { ...r.options, ...Object.fromEntries(told.map((x) => [x.id, values[x.id]])) };
    }
    return m;
  }

  /** A new session of the mission chosen, with the seats and the seed chosen. It replaces the mission's save. */
  start() {
    const m = this.told();
    this.begin(new Session(m, { games: this.games, seed: this.choice.seed, seats: { ...this.choice.seats } }).start());
    this.save();
  }

  /** The saved session of the mission chosen, played again from its record up to where it stood. */
  resume() {
    const doc = this.doc, saved = this.saved(doc.id);
    if (!saved) return;
    let session;
    try {
      session = Session.replay(this.told(), saved, { games: this.games });
    } catch (e) {
      storage.remove(saveKey(doc.id));
      this.note = `The saved session could not be played again (${e.message}). It was removed.`;
      this.say(this.note);
      this.setup();
      return;
    }
    this.choice = { ...this.choice, seats: { ...session.seated }, seed: session.seed };
    // with what the page knew of it when it was saved (the decisions a person took, the terms met, the lines of
    // the story answered in the phase it stood in): there before the session taken up again is saved for the first time
    this.begin(session, {
      diary: Array.isArray(saved.diary) ? saved.diary.filter((d) => d && typeof d.title === "string" && typeof d.chose === "string") : [],
      met: Array.isArray(saved.met) ? saved.met.filter((t) => typeof t === "string") : [],
      heard: saved.heard && Number.isInteger(saved.heard.phase) && saved.heard.seats && typeof saved.heard.seats === "object"
        ? { phase: saved.heard.phase, seats: Object.fromEntries(Object.entries(saved.heard.seats).filter(([, lines]) => Array.isArray(lines)).map(([seat, lines]) => [seat, lines.filter(Number.isInteger)])) } : null,
    });
    // a session taken up again waits: the person finds their place first
    if (this.screen === "play" && session.phase.kind === "shift") this.setSpeed(0, true);
  }

  /**
   * Take a session: build its tabs and panels, show the play screen.
   * @param {Session} session
   * @param {{diary: object[], met: string[], heard: {phase: number, seats: Record<string, number[]>} | null} | null} [kept] what the page knew of a saved session taken up again
   */
  begin(session, kept = null) {
    if (this.session !== session) this.leave();
    this.session = session;
    this.mission = session.mission;
    this.index = -1;
    this.filter = "";
    this.note = "";
    this.savedAs = "";
    this.drafts.clear();
    this.refused.clear();
    this.picked.clear();
    this.focus.clear();
    this.whole.clear();
    this.asked.clear();
    this.hurried.clear();
    this.diary = kept?.diary ?? [];
    this.met = new Set(kept?.met ?? []);
    this.keptHeard = kept?.heard ?? null;
    this.read = new WeakMap();
    this.term = null;
    this.setSpeed(1);
    // what happens in the session is drawn with the next frame
    session.on(() => {
      this.dirty = true;
    });
    const seats = [...session.seats.values()];
    this.tab = (seats.find((s) => s.by === "human") ?? seats[0]).id;
    this.panels = new Map(seats.map((s) => [s.id, this.panel(s)]));
    mount($("#panels"), [...this.panels.values()].map((p) => p.el));
    // a seat's figures and the note on its state stand in the line at the top, its tools at the side, its messages
    // under the bell: those of the seat shown are seen
    const parts = [...this.panels.values()];
    mount($("#hudFigures"), parts.map((p) => p.gauges));
    mount($("#hudNotes"), parts.map((p) => p.decisionsNote));
    mount($("#railTools"), parts.map((p) => p.tools));
    mount($("#bellLists"), parts.map((p) => p.log));
    this.flyout(null);
    this.hideToast();
    mount($("#tabs"));
    this.show("play");
    this.draw(true);
    if (this.screen === "play") $("#stripTitle").focus();
  }

  /** After time has passed or a move was made: the end of the session, a new phase. */
  sync() {
    const s = this.session;
    if (!s) return;
    if (s.over) {
      if (this.screen !== "result") this.finish();
    } else if (s.index !== this.index) {
      this.index = s.index;
      this.entered();
    }
  }

  /** A phase has begun: show one of the people's seats at work in it, say so (its name over the whole screen), save. */
  entered() {
    const s = this.session, ph = s.phase;
    const mine = (seat) => seat.by === "human" && s.active.includes(seat);
    // nobody of the people at work in it: a seat at work to watch, one with a picture first (the signaller's panel)
    if (!mine(s.seat(this.tab))) this.tab = (s.active.find(mine) ?? s.active.find((seat) => this.view(seat.game).sketch) ?? s.active[0])?.id ?? this.tab;
    this.say(`${s.rounds > 1 ? `Round ${s.round} of ${s.rounds}. ` : ""}${ph.title}: ${ph.kind === "shift" ? "a shift" : "a turn"}.`);
    this.beats = storyOf(this.mission, ph.id, s.round);
    // of a session taken up again in this phase, the lines answered before stay answered (and are not said aloud again)
    this.heardLines = new Map(this.keptHeard?.phase === s.index ? Object.entries(this.keptHeard.seats).map(([seat, lines]) => [seat, new Set(lines)])
      // (taken up in the middle of a shift with nothing kept of it: only the latest line that is due is said)
      : ph.kind === "shift" && s.t > 0 ? s.active.filter(mine).map((seat) => [seat.id, new Set(staleLines(this.beats, seat.id, s.t))]) : []);
    this.saidLines = new Set([...this.heardLines].flatMap(([seat, lines]) => [...lines].map((i) => `${seat}|${i}`)));
    this.keptHeard = null;
    const you = s.active.filter(mine).map((seat) => this.seatName(seat.id));
    this.chapter(s.rounds > 1 ? `Round ${s.round} of ${s.rounds}` : this.mission.title, ph.title, you.length ? `You: ${you.join(", ")}` : "The computer plays this one");
    this.sound.play("chapter");
    this.save();
  }

  /**
   * The session is over: its save is removed, what was reached is kept (the mission's stars and
   * sheet, the roles sat in; only where a seat was a person's for at least half of its work), the
   * result is shown. The stars are for the score of the person's own seats, given when the mission
   * as a whole is passed; the sheet's decisions and rule breaks are those of these seats.
   */
  finish() {
    const s = this.session, r = s.result(), ids = this.missions.map((m) => m.id);
    storage.remove(saveKey(s.mission.id));
    // whose seats: a person's who held one for at least half of its work, whoever holds it at the end (a seat
    // handed to the computer for the last stretch still counts, one taken over just before the end does not)
    const held = s.heldByPeople();
    this.yours = new Set(r.seats.filter((x) => held[x.seat] >= HELD_SHARE).map((x) => x.seat));
    this.watched = Object.values(held).every((share) => share === 0);
    // the progress as it is kept now, not as it was when the page was opened (another tab may have emptied the logbook)
    const mine = r.seats.filter((x) => this.yours.has(x.seat)), before = readProgress(storage.get(PROGRESS_KEY, null));
    this.progress = before;
    this.gained = null;
    if (mine.length) {
      // the score that counts for the person is that of their own seats (by the seats' weights), so that the computer's
      // play at the other seats neither earns nor costs stars; passed is the mission as a whole: it is passed together
      const own = Math.round(mine.reduce((n, x) => n + x.weight * x.score, 0) / (mine.reduce((n, x) => n + x.weight, 0) || 1));
      this.progress = record(before, {
        mission: s.mission.id, score: own, passed: r.passed, roles: mine.map((x) => x.role),
        violations: mine.reduce((n, x) => n + (x.violations || 0), 0), danger: mine.some((x) => x.worst >= 3),
        // of the decisions, those taken at these seats (a seat held for a turn and handed on is not the person's)
        decisions: this.diary.filter((d) => !d.seat || this.yours.has(d.seat)).map(({ seat, ...d }) => d), terms: [...this.met],
      });
      storage.set(PROGRESS_KEY, this.progress);
      const rank = rankOf(totalStars(this.progress)), had = badgesOf(before, ids);
      this.gained = {
        score: own, stars: starsFor(own, r.passed), best: own > (before.missions[s.mission.id]?.best ?? -1),
        rank: rank.index > rankOf(totalStars(before)).index ? rank.title : null,
        badges: badgesOf(this.progress, ids).filter((b) => !had.includes(b)).map((b) => BADGES.find((x) => x.id === b).title),
      };
    }
    this.show("result");
    this.result(r);
    this.say(`The session is over: ${r.score} of 100, ${r.passed ? "passed" : "not passed"}.`);
    this.sound.play(r.passed ? "passed" : "failed");
    // a cue for every star, as it comes in
    for (let i = 0; i < (this.gained?.stars ?? 0); i++) setTimeout(() => this.screen === "result" && this.sound.play("star"), 900 + i * STAR_MS);
    $("#resultTitle").focus();
  }

  /** Keep the session in the browser (`session.save()`, under a key per mission). */
  save() {
    const s = this.session;
    this.lastSave = performance.now();
    if (!s || s.over || s.index < 0 || !Session.replayable(s.mission, this.games)) return;
    const as = `${s.index}|${s.ticks}|${s.record.length}`;
    if (as === this.savedAs) return;
    this.savedAs = as;
    // with what the page itself knows of the session: what a person decided and the terms met, for the mission's sheet
    // (and the lines of the story answered in the phase it stands in)
    storage.set(saveKey(s.mission.id), { ...s.save(), diary: this.diary, met: [...this.met], heard: { phase: s.index, seats: Object.fromEntries([...this.heardLines].map(([seat, lines]) => [seat, [...lines]])) } });
  }

  /** Say something to those who do not see the page (the live region; what is said in one go is said together). */
  say(text) {
    if (!this.words.length) setTimeout(() => ($("#live").textContent = this.words.splice(0).join(" ")), 60);
    this.words.push(sentence(text));
  }

  /* ---------------------------------------------------------------- 2: play */

  /** Whether a seat's game is at work now: in the current phase, begun and not over. */
  atWork(seat) {
    const s = this.session;
    return !s.over && s.active.includes(seat) && !!seat.game && !seat.game.over;
  }

  /**
   * Draw the play screen: the header strip, the tabs, the panel of the seat shown, the flows. A form
   * a person is in is left alone, unless `force` (after a move).
   */
  draw(force = false) {
    this.sync();
    const s = this.session;
    if (!s || this.screen !== "play") return;
    this.dirty = false;
    this.lastDraw = performance.now();
    this.clock();
    this.strip();
    this.tabs();
    for (const [id, p] of this.panels) {
      const off = id !== this.tab;
      p.el.hidden = p.gauges.hidden = p.tools.hidden = p.log.hidden = off;
      p.decisionsNote.hidden = off;
    }
    this.seat(s.seat(this.tab), force);
    this.side();
    this.flows(force);
    this.hear();
    this.fit($("#play"));
  }

  /** At the side: where the seat shown works, and how many of its messages are new (the bell). */
  side() {
    const seat = this.session.seat(this.tab), g = seat?.game, place = placeOfGame(seat.Game.id);
    morph($("#placePanel"), h("p", { class: "vn-where" }, h("span", { class: "place-label" }, "Where you work"), " ", h("strong", {}, place.name)), h("p", { class: "hint" }, place.line));
    const logs = g?.logs ?? [];
    if (g && this.opened === "bellPanel") this.seen.set(g, logs.length);
    const fresh = g ? Math.max(0, logs.length - (this.seen.get(g) ?? 0)) : 0, badge = $("#bellBadge");
    badge.hidden = !fresh;
    badge.textContent = fresh > 99 ? "99+" : String(fresh);
    $("#bellBtn").setAttribute("aria-label", fresh ? `Messages, ${fresh} new` : "Messages");
    if ($("#toast").hidden === false && performance.now() > this.toastUntil) this.hideToast();
  }

  /** The clock and the progress of a shift (every frame). */
  clock() {
    const s = this.session, ph = s.phase;
    if (ph?.kind !== "shift") return;
    const text = clockOf(ph.clock, s.t), el = $("#clock");
    if (el.textContent === text) return;
    el.textContent = text;
    const pct = Math.round((100 * Math.min(s.t, ph.length)) / ph.length), bar = $("#progress");
    bar.setAttribute("aria-valuenow", String(pct));
    bar.setAttribute("aria-valuetext", `${num(s.t / 60)} of ${num(ph.length / 60)} minutes`);
    bar.firstElementChild.style.width = `${pct}%`;
  }

  /** The header strip: the mission, the round, the phases of the round, and what the phase needs (the speed of a shift, the end of a turn). */
  strip() {
    const s = this.session, ph = s.phase, m = this.mission, shift = ph.kind === "shift";
    // the mission's name is said once: in the panel of the mission at the side (and to screen readers as the line's heading)
    $("#stripTitle").textContent = m.title;
    $("#missionName").textContent = m.title;
    $("#where").textContent = `${m.rounds > 1 ? `Round ${s.round} of ${m.rounds} · ` : ""}${ph.title}`;
    morph($("#phases"), s.plan.filter((p) => p.round === s.round).map((p) => h("li", { "aria-current": p === ph ? "step" : null }, p.title, " ", h("small", {}, `(${p.kind})`))));
    $("#shiftBar").hidden = !shift;
    $("#skipBar").hidden = !shift || s.waiting;
    $("#turnBar").hidden = shift;
    if (shift) return;
    const open = s.active.reduce((n, seat) => n + (seat.by === "human" && seat.game ? seat.game.open.length : 0), 0);
    const end = $("#endTurn");
    end.textContent = open ? `End the turn (${open} open)` : "End the turn";
    end.className = `btn small${s.ready ? " primary" : ""}`;
    $("#turnNote").textContent = open
      ? `${open === 1 ? "1 of your decisions is" : `${open} of your decisions are`} still open. Ending the turn decides ${open === 1 ? "it by its" : "them by their"} fallback.`
      : "Nothing is left for you to decide in this turn.";
  }

  /** The seats as tabs: the role, who plays it, the decisions open. */
  tabs() {
    morph($("#tabs"), [...this.session.seats.values()].map((seat) => {
      const on = seat.id === this.tab, at = this.atWork(seat), n = at ? seat.game.open.length : 0;
      return h("button", { type: "button", role: "tab", class: seat.by === "human" ? "mine" : "theirs", id: `tab-${seat.id}`, title: `${this.seatName(seat.id)}: ${seat.by === "human" ? "you" : "the computer"}`, "aria-controls": `seat-${seat.id}`, "aria-selected": String(on), tabindex: on ? "0" : "-1", onclick: () => this.select(seat.id) },
        h("img", { class: "face", src: BASE + selfPortrait(seat.Game.id).picture, alt: "" }),
        // (a face only: its name and who plays it are its tooltip and are said to screen readers)
        h("span", { class: "name visually-hidden" }, this.seatName(seat.id)),
        h("span", { class: "who visually-hidden" }, seat.by === "human" ? "you" : "computer", at ? null : ", not at work"),
        n ? [h("span", { class: "tag warn", "aria-hidden": "true" }, String(n)), h("span", { class: "visually-hidden" }, n === 1 ? " 1 decision open" : ` ${n} decisions open`)] : null);
    }));
  }

  /** Put a decision of a seat in focus: it is shown in full, the others as their titles. */
  look(seatId, id) {
    this.focus.set(seatId, id);
    this.draw(true);
    // the title that was pressed is gone: the focus goes on into the decision now shown
    this.panels.get(seatId)?.decisions.querySelector(".play-decision:not(.waiting) .play-options-row .btn, .play-decision:not(.waiting) button")?.focus();
  }

  /**
   * Open a seat's desk, a dialog: its role, its moves as forms, its tables, its score and its messages.
   * @param {string} seatId
   * @param {"moves" | null} [part] where to begin
   */
  openDesk(seatId, part = null) {
    const p = this.panels.get(seatId);
    if (!p) return;
    if (!p.desk.open) p.desk.showModal();
    this.draw(true);
    const at = part === "moves" ? p.movesTitle : p.deskTitle;
    at.scrollIntoView({ block: "start" });
    at.focus({ preventScroll: true });
  }

  /** Open what the roles give each other, a dialog. */
  openFlows() {
    const d = $("#flowsDialog");
    if (!d.open) d.showModal();
    this.flows(true);
  }

  /**
   * A phase has begun: its name over the whole screen for a moment, as the chapter of a story.
   * It takes no clicks and goes by itself (not shown where less motion is asked for).
   */
  chapter(over, title, under) {
    const el = $("#chapter");
    mount(el, h("div", { class: "vn-chapter" }, h("p", { class: "over" }, over), h("p", { class: "title" }, title), h("p", { class: "under" }, under)));
    el.firstElementChild.addEventListener("animationend", () => mount(el), { once: true });
  }

  /**
   * Open a panel at the side (the mission, where you work, the messages), or close it (`id` null, or
   * the one that is open). One at a time; the focus goes into it, and back to its button when it closes.
   * @param {string | null} id
   * @param {boolean} [open] open it even if it is open
   */
  flyout(id, open = false) {
    const was = this.opened, inside = was && document.activeElement?.closest?.(`#${was}`);
    const next = id && (id !== was || open) ? id : null;
    for (const panel of document.querySelectorAll("#rail .rail-panel")) panel.hidden = panel.id !== next;
    for (const b of document.querySelectorAll("#rail [aria-controls]")) b.setAttribute("aria-expanded", String(b.getAttribute("aria-controls") === next));
    this.opened = next;
    if (next === "bellPanel") this.hideToast();
    if (next) {
      this.draw(true);
      const panel = $(`#${next}`);
      panel.setAttribute("tabindex", "-1");
      panel.focus();
    } else if (inside) $(`#rail [aria-controls="${was}"]`)?.focus();
  }

  /** The pop-up goes. */
  hideToast() {
    this.toastUntil = 0;
    $("#toast").hidden = true;
  }

  /** Show a seat's panel. */
  select(id, focus = false) {
    this.tab = id;
    this.draw(true);
    if (focus) document.getElementById(`tab-${id}`)?.focus();
  }

  /** The arrow keys, Home and End in the tabs. */
  tabKey(e) {
    if (!e.target.closest?.('[role="tab"]')) return;
    const ids = [...this.session.seats.keys()], i = ids.indexOf(this.tab), n = ids.length;
    const to = { ArrowRight: (i + 1) % n, ArrowDown: (i + 1) % n, ArrowLeft: (i + n - 1) % n, ArrowUp: (i + n - 1) % n, Home: 0, End: n - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    this.select(ids[to], true);
  }

  /**
   * The fixed parts of a seat's panel; `seat` draws into them. The stage, over the picture: where
   * the role works, the gauges, the game's picture if it has one, and the talk, a band across the
   * bottom: who speaks with what they ask and its choices, or what happened line by line, a railway
   * term explained, the newest message, and the tools. The desk, a dialog opened from the stage: the role, the moves as forms, the tables, the
   * score and the messages.
   */
  panel(seat) {
    const p = {
      head: h("div", { class: "game-card play-head" }),
      /** The seat's own heading, for who does not see the stage: whose seat it is, and who plays it. */
      title: h("h3", { class: "visually-hidden" }),
      sketch: h("div", { class: "play-sketch", hidden: true }),
      gauges: h("dl", { class: "vn-gauges", "data-seat": seat.id }),
      speaker: h("figure", { class: "vn-speaker" }),
      name: h("p", { class: "vn-name" }),
      story: h("div", { class: "vn-story", hidden: true }),
      decisionsTitle: h("h4", { class: "vn-count visually-hidden", tabindex: "-1" }, "Decisions"),
      decisionsNote: h("p", { class: "vn-note", "data-seat": seat.id }),
      decisions: h("div", { class: "play-keyed vn-decisions" }),
      term: h("div", { class: "vn-term", role: "note", hidden: true }),
      tools: h("div", { class: "vn-tools", "data-seat": seat.id }),
      deskTitle: h("h3", { id: `desk-${seat.id}`, tabindex: "-1" }),
      movesTitle: h("h4", { tabindex: "-1" }, "Moves"),
      movesNote: h("div", { class: "play-moves-note" }),
      moves: h("div", { class: "play-keyed" }),
      tables: h("div", { class: "play-tables" }),
      score: h("div", { class: "play-score" }),
      log: h("div", { class: "play-log", "data-seat": seat.id }),
      /** The gauges' values as shown last, and until when one that changed shows it. */
      gauged: new Map(),
    };
    // the talk: a band across the bottom of the screen, as a visual novel has it; the speaker stands at its left, taller
    // than the band. In its box only who speaks, what they say or ask, and the choices; it is there while somebody speaks
    p.talk = h("div", { class: "vn-talk", hidden: true }, p.speaker,
      h("div", { class: "vn-box" }, p.name, p.story, p.decisionsTitle, p.decisions, p.term));
    p.desk = h("dialog", { class: "play-dialog play-desk", "aria-labelledby": `desk-${seat.id}` },
      h("div", { class: "play-dialog-head" }, p.deskTitle, h("button", { class: "btn small", type: "button", onclick: () => p.desk.close() }, "Close")),
      p.head,
      h("div", { class: "game-card play-moves" }, p.movesTitle, p.movesNote, p.moves),
      p.tables,
      h("div", { class: "game-card" }, h("h4", {}, "Score so far"), p.score));
    p.el = h("div", { class: "play-seat", role: "tabpanel", id: `seat-${seat.id}`, "aria-labelledby": `tab-${seat.id}`, hidden: true },
      h("div", { class: "vn-stage" },
        p.title,
        p.sketch,
        p.talk),
      p.desk);
    return p;
  }

  /** What a game shows of itself (`view()`), or nothing where it has not begun or cannot say. */
  view(game) {
    try {
      const v = game?.view() ?? {};
      return { sketch: v.sketch?.items?.length ? v.sketch : null, figures: v.figures ?? [], tables: v.tables ?? [], actions: v.actions ?? [] };
    } catch (e) {
      return { figures: [{ label: "This game cannot be shown", value: e.message, tone: "bad" }], tables: [], actions: [] };
    }
  }

  /**
   * A seat's panel. On the stage: the figures as gauges, the game's picture; in a turn, what
   * happened, line by line, to read on from; then the decision in focus, asked by its speaker with
   * its choices (the others wait as their titles); the newest message; the tools. Behind it the
   * picture that fits what is spoken of. In the desk: the role, the moves as forms, the tables, the
   * score so far and the messages. A computer's seat and a seat not at work show the same without
   * forms and buttons.
   */
  seat(seat, force = false) {
    const p = this.panels.get(seat.id), s = this.session, g = seat.game;
    const active = s.active.includes(seat), mine = seat.by === "human", can = this.atWork(seat) && mine;
    const view = this.view(g), de = this.roles.get(seat.role)?.name_de, name = this.seatName(seat.id);
    const turn = s.phase.kind === "turn", logs = g?.logs ?? [];
    const state = !g ? "Not at work in this phase. Its game has not begun yet." : !active ? "Not at work in this phase. This is its last state." : g.over ? `This game is over: ${g.over}` : mine ? "" : "The computer plays this seat. You can watch it, or take over.";

    p.title.textContent = `${name}, played by ${mine ? "you" : "the computer"}`;
    // a gauge whose value has just changed shows it for a moment (BUMP_MS); a figure about something in the
    // picture (`asset`, an item of the sketch) is not written: the item shows it, in colour, and tells it when chosen
    const now = performance.now(), drawn = new Set((view.sketch?.items ?? []).map((it) => it.id).filter(Boolean));
    morph(p.gauges, view.figures.filter((f) => !(f.asset && drawn.has(f.asset))).map((f) => {
      const value = `${typeof f.value === "number" ? num(f.value) : String(f.value ?? "–")}${f.unit ? ` ${f.unit}` : ""}`, was = p.gauged.get(f.label);
      if (was && was.value !== value) was.until = now + BUMP_MS;
      p.gauged.set(f.label, { value, until: was?.until ?? 0 });
      return h("div", { class: `${["ok", "warn", "bad"].includes(f.tone) ? `tone-${f.tone}` : ""}${p.gauged.get(f.label).until > now ? " bump" : ""}` }, h("dt", {}, f.label), h("dd", {}, value));
    }));

    p.sketch.hidden = !view.sketch;
    if (view.sketch) this.sketch(seat, p, view.sketch, can, view.figures);

    // in a turn a person reads what happened line by line (the game's messages not read yet); in a shift
    // they pass in the ticker, and what passed there or at a computer's seat counts as read
    const tells = !!g && mine && active && turn;
    if (g && !this.read.has(g)) this.read.set(g, Math.max(0, logs.length - STORY_MOST));
    if (g && !tells) this.read.set(g, logs.length);
    // what was read line by line in a turn is seen
    if (g && tells) this.seen.set(g, Math.max(this.seen.get(g) ?? 0, this.read.get(g)));
    const at = g ? this.read.get(g) : 0, line = tells && at < logs.length ? logs[at] : null, quote = line ? quoteIn(line.text) : null;

    // one decision at a time: the one in focus in full, asked by its speaker; the others as their titles
    const open = g?.open ?? [];
    // what somebody says to the players (the mission's story): in a turn before the decisions, in a shift when nothing is asked
    const beat = mine && active && !line && (turn || !open.length) ? this.beat(seat.id) : null;
    const focus = line || beat ? null : open.find((d) => d.id === this.focus.get(seat.id)) ?? open[0];
    const who = quote ? speakerOf(seat.Game.id, { who: { name: quote.name } }) : beat ? speakerOf(seat.Game.id, { who: beat.who }) : focus ? speakerOf(seat.Game.id, focus)
      : { name: line ? s.phase.title : mine ? "You" : "The computer", role: line ? "" : name, portrait: null };
    const face = who.portrait ? faceOf(who) : selfPortrait(seat.Game.id);
    p.talk.classList.toggle("telling", !!line && !quote);
    p.speaker.classList.toggle("self", !focus && !quote && !beat);
    morph(p.speaker, h("img", { src: BASE + face.picture, alt: face.alt }));
    morph(p.name, h("strong", {}, who.name), who.role ? h("span", {}, who.role) : null);

    p.story.hidden = !line;
    if (line) {
      const left = logs.length - at;
      morph(p.story,
        h("p", { class: `vn-line k-${safe(line.kind)}` }, this.rich(quote ? `${quote.before}“${quote.quote}”` : line.text, true)),
        h("div", { class: "row" },
          h("button", { class: "btn primary", type: "button", onclick: () => this.readOn(seat.id, 1) }, left > 1 ? "Next" : open.length ? "To the decisions" : "Go on", h("kbd", { "aria-hidden": "true" }, "Space")),
          left > 2 ? h("button", { class: "btn", type: "button", onclick: () => this.readOn(seat.id, left) }, `Skip ${left - 1} more`) : null));
    } else if (beat) {
      if (!this.saidLines.has(`${seat.id}|${beat.index}`)) {
        this.saidLines.add(`${seat.id}|${beat.index}`);
        this.say(`${who.name}: ${beat.say}`);
        this.sound.play("next");
      }
      p.story.hidden = false;
      morph(p.story,
        h("p", { class: "vn-line" }, this.rich(beat.say, true)),
        h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", onclick: () => this.heardBeat(seat.id, beat) }, "OK", h("kbd", { "aria-hidden": "true" }, "Space"))));
    } else mount(p.story);

    p.decisionsTitle.textContent = line || beat ? "" : open.length > 1 ? `Decision ${open.indexOf(focus) + 1} of ${open.length}` : open.length ? "A decision" : "";
    p.decisions.hidden = !!line || !!beat;
    keyed(p.decisions, open, (d) => d.id, () => h("div", { class: "play-decision" }), (el, d) => {
      el.classList.toggle("waiting", d !== focus);
      // (one that waits is a dot to press: its title is its name, and shows on it)
      morph(el, ...(d === focus ? this.decision(seat, d, can) : [h("button", { class: "play-next", type: "button", title: d.title, onclick: () => this.look(seat.id, d.id) }, h("span", { class: "visually-hidden" }, d.title))]));
    });
    const idle = !open.length && !line && !beat;
    // that nothing is asked needs no words on the screen (they are there for who does not see it); a seat's state does
    p.decisionsNote.classList.toggle("visually-hidden", idle && !state);
    p.decisionsNote.textContent = line || beat ? "" : state || (open.length ? (can ? "" : mine ? "The seat is not at work: nothing can be decided now." : "The computer decides.")
      : turn ? "Nothing left to decide here. End the turn when you are ready." : view.sketch ? "Nothing to decide just now. Watch the picture: choose something in it to act." : "Nothing to decide just now.");

    // a railway term asked for: what it is, in a line
    const term = this.term && !p.el.hidden ? termOf(this.term) : null;
    p.term.hidden = !term;
    morph(p.term, term ? [
      h("p", {}, h("strong", {}, term.term), term.de ? [" ", h("span", { class: "de", lang: "de" }, term.de)] : null),
      h("p", {}, term.line),
      h("button", { class: "btn small", type: "button", onclick: () => this.explain(term.id) }, "Got it"),
    ] : null);

    // a new message of the seat shown pops up, one at a time (a newer one takes the place of the one before); not
    // what is read line by line in a turn, nor with the messages open under the bell
    const last = logs.at(-1) ?? null;
    if (seat.id === this.tab && last && p.lastLine !== last && !tells && this.opened !== "bellPanel" && !this.bare) {
      const toast = $("#toast");
      toast.textContent = last.text;
      toast.className = `play-toast k-${safe(last.kind)}`;
      toast.setAttribute("aria-label", `${last.text} (all messages)`);
      toast.hidden = false;
      this.toastUntil = now + TOAST_MS;
    }
    if (seat.id === this.tab) p.lastLine = last;
    // the talk's band is there while somebody speaks or asks (or a term is explained): else the picture has the room
    p.talk.hidden = !(line || beat || focus || term);

    // the seat's tools, at the side as icons (the end of a turn is in the line at the top)
    const tool = (name, label, onclick, extra = {}, ...more) => h("button", { class: "rail-btn", type: "button", "aria-label": label, title: label, onclick, ...extra }, icon(name), ...more);
    const moves = view.actions.length === 1 ? view.actions[0].label ?? "A move" : `Moves (${view.actions.length})`;
    morph(p.tools,
      can && view.actions.length ? tool("moves", moves, () => this.openDesk(seat.id, "moves"), { "aria-haspopup": "dialog" }, view.actions.length > 1 ? h("span", { class: "tag", "aria-hidden": "true" }, String(view.actions.length)) : null) : null,
      tool("desk", "Desk", () => this.openDesk(seat.id), { "aria-haspopup": "dialog", title: "Desk (D)" }),
      tool(mine ? "computer" : "person", mine ? "Hand to the computer" : "Take over", () => this.sit(seat.id, mine ? "computer" : "human")));

    // behind it all: the picture that fits what is read or asked, else the place where the role works
    // (a shift by day gets no picture of the night; in a turn of months or years the time is open); it may be
    // live, in a shift at the shift's own time of day
    const night = turn ? null : nightAt(s.phase.clock, s.t);
    this.backdrop((line ? backdropAt(night, line.text) : beat ? null : focus ? backdropAt(night, focus.title, focus.text) : null) ?? wideOf(placeOfGame(seat.Game.id)),
      { live: true, time: turn ? null : dayMinutes(s.phase.clock, s.t) });

    // the desk (a dialog): drawn also while it is closed, so that it is true when it opens
    p.deskTitle.textContent = seat.Game.title;
    morph(p.head,
      h("p", { class: "play-role" }, h("a", { href: `../roles/#role-${seat.role}` }, name), de ? [" ", h("span", { class: "de", lang: "de" }, `(${de})`)] : null, ", played by ", h("strong", {}, mine ? "you" : "the computer"), "."),
      h("p", { class: "hint" }, seat.Game.description ?? ""),
      h("p", { class: "play-state" }, state));

    // a form a person is in stays as it is
    const inForm = document.activeElement;
    if (force || !(inForm?.matches?.("select, input") && p.moves.contains(inForm))) this.moves(seat, p, view.actions, can);

    morph(p.tables, view.tables.map((t) => h("div", { class: "game-card play-table" },
      h("h4", {}, t.title),
      t.rows?.length ? this.scroller(`${seat.id}|${t.id}`, t.title, this.table(t)) : h("p", { class: "hint" }, t.empty ?? "Nothing here."))));

    if (g) {
      const { total, parts } = g.score();
      morph(p.score, h("p", {}, h("span", { class: "score-total" }, String(total)), " of 100"), this.parts(parts));
    } else morph(p.score, h("p", { class: "hint" }, "No score yet."));

    const lines = g ? logs.slice(-LOG_LINES).reverse() : [];
    morph(p.log, lines.length
      ? h("div", { class: "play-scroll", tabindex: "0", role: "group", "aria-label": "Messages, the newest first" }, h("ol", {}, lines.map((l) => h("li", { class: `k-${safe(l.kind)}` }, l.text))))
      : h("p", { class: "hint" }, "No messages yet."));
  }

  /**
   * A text with its railway terms as buttons (glossary.js): a term tapped is explained, and every
   * term shown counts as met. `reveal`: the words come in one after the other.
   * @param {string} text
   * @param {boolean} [reveal]
   */
  rich(text, reveal = false) {
    const parts = mark(text);
    this.meets(parts.filter((x) => typeof x !== "string").map((x) => x.term.id));
    let i = 0;
    const delay = () => (reveal ? `animation-delay: ${Math.min(i++ * WORD_MS, 1600)}ms` : null);
    return parts.flatMap((part) => {
      if (typeof part !== "string") {
        const on = this.term === part.term.id;
        return [h("button", { class: `term${reveal ? " w" : ""}${on ? " on" : ""}`, type: "button", "aria-expanded": String(on), title: "What is this?", style: delay(), onclick: () => this.explain(part.term.id) }, part.text)];
      }
      return reveal ? part.split(/(\s+)/).map((w) => (/^\s*$/.test(w) ? w : h("span", { class: "w", style: delay() }, w))) : [part];
    });
  }

  /** Railway terms were shown: they count as met, in this session (for its sheet) and for good (the logbook). */
  meets(ids) {
    const fresh = ids.filter((id) => !this.met.has(id));
    if (!fresh.length) return;
    for (const id of fresh) this.met.add(id);
    // the session's save holds the terms met: it is due again (the next save writes it, also when the page is left)
    this.savedAs = "";
    // the progress as it is kept now (another tab may have played on, or emptied the logbook), with these terms
    const kept = readProgress(storage.get(PROGRESS_KEY, null)), p = meet(kept, fresh);
    this.progress = p;
    if (p !== kept) storage.set(PROGRESS_KEY, p);
  }

  /** Explain a railway term (again: close it). */
  explain(id) {
    this.term = this.term === id ? null : id;
    if (this.term) this.sound.play("term");
    this.draw(true);
  }

  /**
   * The line of the mission's story that is said to a seat now, or null (lineFor): the first of the
   * lines for this seat that is not answered yet, in a shift of those whose moment has come.
   */
  beat(seatId) {
    const s = this.session;
    return lineFor(this.beats, seatId, this.heardLines.get(seatId) ?? new Set(), s.phase.kind === "turn" ? null : s.t);
  }

  /**
   * Whether somebody of the mission's story is speaking to the person at the seat shown, in a shift:
   * the clock waits for the answer (OK), so that no line is passed over. Not while the stage is out
   * of the way (only the picture, a dialog), nor while a decision is open there: then the line
   * waits, and the clock runs.
   */
  listening() {
    const s = this.session, seat = s?.seat(this.tab);
    if (!seat || s.over || s.phase.kind !== "shift" || this.bare || document.querySelector("dialog[open]")) return false;
    return seat.by === "human" && s.active.includes(seat) && !seat.game?.open.length && !!this.beat(seat.id);
  }

  /** A line of the story was answered at a seat (OK): the stage goes on. At the other seats it stays to be said, if it is for them too. */
  heardBeat(seatId, beat) {
    // at this seat: a line for everybody is still to be said at the others
    const heard = this.heardLines.get(seatId) ?? new Set();
    heard.add(beat.index);
    this.heardLines.set(seatId, heard);
    this.term = null;
    // the session's save holds the lines answered: it is due again
    this.savedAs = "";
    this.after();
    this.refocus(() => {
      const p = this.panels.get(seatId);
      return p.story.querySelector(".btn") ?? p.decisions.querySelector(".play-options-row button") ?? p.tools.querySelector("button");
    });
  }

  /** Read on in what happened at a seat: `n` lines further. */
  readOn(seatId, n = 1) {
    const g = this.session?.seat(seatId)?.game;
    if (!g) return;
    this.read.set(g, Math.min(g.logs.length, (this.read.get(g) ?? 0) + n));
    this.term = null;
    this.sound.play("next");
    this.draw(true);
    this.refocus(() => {
      const p = this.panels.get(seatId);
      return p.story.querySelector(".btn") ?? p.decisions.querySelector(".play-options-row button") ?? p.tools.querySelector("button");
    });
  }

  /**
   * The sketch of a game's world (`view().sketch`): its shapes as they are, and on top what can be
   * chosen (an item with a menu) as buttons for a person at work; below, what is chosen with its moves.
   * A computer's seat and a seat not at work show the picture only.
   */
  sketch(seat, p, sk, can, figures = []) {
    // what is about something in the picture: a figure that names it (`asset`), or the item's own `alert`. It pulses
    // in its colour (a problem red, a worry orange), and it can be chosen to read what is known of it
    const about = new Map(figures.filter((f) => f.asset).map((f) => [f.asset, f]));
    const alertOf = (it) => it.alert ?? (["bad", "warn"].includes(about.get(it.id)?.tone) ? about.get(it.id).tone : null);
    const picks = sk.items.filter((it) => it.id && ((can && it.menu?.length) || about.has(it.id) || alertOf(it)));
    if (!p.board) {
      p.sketchTitle = h("h4", {});
      p.shapes = s("g", { "aria-hidden": "true" });
      p.picks = s("g", {});
      p.svg = s("svg", { focusable: "false" }, p.shapes, p.picks);
      p.board = h("div", { class: "play-board", "data-scroll": `sketch|${seat.id}` }, p.svg);
      p.pick = h("div", { class: "play-pick" });
      mount(p.sketch, p.sketchTitle, p.board, p.pick);
    }
    p.sketchTitle.textContent = sk.title ?? "The picture";
    p.svg.setAttribute("viewBox", `0 0 ${sk.width} ${sk.height}`);
    p.svg.style.minWidth = `${Math.round(sk.width * 0.62)}px`;
    p.board.setAttribute("role", picks.length ? "group" : "img");
    p.board.setAttribute("aria-label", sk.label ?? sk.title ?? "The picture");
    morph(p.shapes, sk.items.filter((it) => !picks.includes(it)).map((it) => this.shape(it)));
    const chosen = picks.find((it) => it.id === this.picked.get(seat.id)) ?? null;
    keyed(p.picks, picks, (it) => it.id, () => s("g", { class: "pick", role: "button", tabindex: "0" }), (el, it) => {
      el.setAttribute("aria-label", it.title ?? it.text ?? it.id);
      el.setAttribute("aria-pressed", String(it === chosen));
      el.onclick = () => this.pick(seat.id, it.id);
      el.onkeydown = (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        this.pick(seat.id, it.id);
      };
      const [x, y, w, hh] = it.kind === "dot" ? [it.x - 16, it.y - 16, 32, 32] : [it.x - (it.anchor === "middle" ? textWidth(it.text) / 2 : it.anchor === "end" ? textWidth(it.text) : 0) - 8, it.y - 19, textWidth(it.text) + 16, 28];
      const alert = alertOf(it);
      el.classList.toggle("alert", !!alert);
      el.dataset.id = it.id;
      morph(el,
        alert ? s("circle", { class: `pulse pulse-${alert}`, cx: x + w / 2, cy: y + hh / 2, r: Math.max(w, hh) / 2 }) : null,
        s("rect", { class: "hit", x, y, width: w, height: hh, rx: 6 }), this.shape(it));
    });
    const refused = this.refused.get(`${seat.id}|sketch`), known = chosen && about.get(chosen.id);
    morph(p.pick,
      chosen && (!can || !chosen.menu?.length)
        ? [h("p", { class: "play-picked" }, chosen.title ?? chosen.text ?? ""), known ? h("p", { class: `play-asset tone-${safe(known.tone ?? "plain")}` }, h("strong", {}, known.label), ": ", String(known.value)) : null]
        : !can ? null : chosen
        ? [h("p", { class: "play-picked" }, chosen.title ?? chosen.text ?? ""), known ? h("p", { class: `play-asset tone-${safe(known.tone ?? "plain")}` }, h("strong", {}, known.label), ": ", String(known.value)) : null, h("div", { class: "row" }, chosen.menu.map((m) => h("button", { class: "btn small", type: "button", "aria-disabled": m.disabled ? "true" : null, onclick: () => this.pickMove(seat.id, chosen.id, m) }, m.label)))]
        : picks.length ? h("p", { class: "hint" }, "Choose something in the picture: its moves appear here.") : null,
      h("p", { class: "play-refused", role: "status" }, can && refused && performance.now() - refused.at < REFUSED_MS ? refused.text : ""));
  }

  /** A shape of a sketch: a line, a box, a dot, a text, or a tag (a text in a box); its `title` is its tooltip. */
  shape(it) {
    const tone = `t-${safe(it.tone ?? "plain")}`, tip = it.title ? s("title", {}, it.title) : null;
    if (it.kind === "line") return s("line", { class: `${tone}${it.faint ? " faint" : ""}${it.thin ? " thin" : ""}`, x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2 });
    if (it.kind === "box") return s("rect", { class: tone, x: it.x, y: it.y, width: it.w, height: it.h, rx: 3 });
    if (it.kind === "dot") return s("circle", { class: tone, cx: it.x, cy: it.y, r: it.r ?? 6 }, tip);
    if (it.kind === "tag") {
      const w = textWidth(it.text) + 14, x = it.anchor === "end" ? it.x - w : it.anchor === "middle" ? it.x - w / 2 : it.x;
      return s("g", { class: `tag ${tone}` }, tip, s("rect", { x, y: it.y - 12, width: w, height: 24, rx: 4 }), s("text", { x: x + w / 2, y: it.y + 5, "text-anchor": "middle" }, it.text));
    }
    return s("text", { class: `${tone}${it.small ? " small" : ""}`, x: it.x, y: it.y, "text-anchor": it.anchor ?? null }, it.text, tip);
  }

  /** Choose an item of a seat's sketch: its moves appear below the picture, and the focus goes to the first of them. */
  pick(seatId, id) {
    this.picked.set(seatId, id);
    this.refused.delete(`${seatId}|sketch`);
    this.draw(true);
    this.panels.get(seatId).pick.querySelector("button")?.focus({ preventScroll: true });
  }

  /** A move from the menu of the item chosen in a sketch; after it the focus is back on the item. */
  pickMove(seatId, id, m) {
    const k = `${seatId}|sketch`;
    const res = m.disabled ? { ok: false, reason: m.disabled } : this.act(seatId, m.name, ...(m.args ?? []));
    if (refusedBy(res)) {
      const text = res?.reason ?? "That is not possible now.", last = this.refused.get(k)?.text;
      this.refused.set(k, { text: last === text ? `${text} ` : text, at: performance.now() });
      this.after();
      return;
    }
    this.refused.delete(k);
    this.after();
    const p = this.panels.get(seatId);
    ([...p.picks.children].find((el) => el.dataset.key === id) ?? p.sketchTitle).focus({ preventScroll: true });
  }

  /**
   * An open decision: what is asked (its railway terms can be tapped), the lead of its text with the
   * rest behind More, how much time is left, what happens without an answer, and its options: large
   * buttons for a person at work, numbered as their keys.
   */
  decision(seat, d, can) {
    const shift = this.session.phase.kind === "shift", label = (id) => d.options.find((o) => o.id === id)?.label ?? "";
    const key = `${seat.id}|${d.id}`, whole = this.whole.has(key);
    // how much of its time is left, from when it was first shown
    if (shift && d.deadline != null && !this.asked.has(key)) this.asked.set(key, seat.game.t);
    const t0 = this.asked.get(key), share = shift && d.deadline != null && d.deadline > t0 ? Math.max(0, Math.min(1, (d.deadline - seat.game.t) / (d.deadline - t0))) : null;
    if (can && share != null && share < LOW_SHARE && !this.hurried.has(key)) {
      this.hurried.add(key);
      this.sound.play("hurry");
    }
    let left = "";
    if (shift && d.deadline != null) left = `${Math.max(0, Math.ceil(d.deadline - seat.game.t))} s left${d.fallback ? `, then: ${label(d.fallback)}` : ""}`;
    else if (!shift) left = `If you skip it: ${label(d.fallback ?? d.options[0]?.id)}`;
    return [
      h("h5", {}, this.rich(d.title, true)),
      h("p", { class: "text" }, this.rich(whole ? d.text ?? "" : lead(d.text)), " ",
        hasMore(d.text) ? h("button", { class: "play-why", type: "button", "aria-expanded": String(whole), onclick: () => { this.whole[whole ? "delete" : "add"](key); this.draw(true); } }, whole ? "Less" : "More") : null),
      share != null ? h("div", { class: `vn-countdown${share < LOW_SHARE ? " low" : ""}`, "aria-hidden": "true" }, h("i", { style: { width: `${Math.round(share * 1000) / 10}%` } })) : null,
      // (what happens to a decision that is skipped in a turn is said to who does not see the page; the time left in a shift to all)
      h("p", { class: shift ? "hint" : "hint visually-hidden" }, left),
      can ? h("div", { class: "row play-options-row" }, d.options.map((o, i) => h("button", { class: "btn", type: "button", onclick: () => this.decide(seat.id, d.id, o.id) },
        i < 9 ? h("kbd", { "aria-hidden": "true" }, String(i + 1)) : null, h("span", {}, o.label, o.hint ? h("small", {}, ` (${o.hint})`) : null))))
        : h("ul", { class: "play-options" }, d.options.map((o) => h("li", {}, o.label))),
    ];
  }

  /** The moves of a seat: a form per action for a person at work, else their names. */
  moves(seat, p, actions, can) {
    keyed(p.moves, can ? actions : [], (a) => `${a.name}${a.args?.length ? `:${JSON.stringify(a.args)}` : ""}`, () => h("form", { class: "play-move", novalidate: true }), (form, a, key) => {
      form._action = a;
      form._ids = (a.fields ?? []).map((f) => `f-${safe(seat.id)}-${safe(key)}-${safe(f.id)}`);
      form.onsubmit = (e) => {
        e.preventDefault();
        this.submit(seat.id, form);
      };
      morph(form, ...this.form(seat, a, key, form._ids));
      // a select shows the option meant, also when its options have just changed
      for (const sel of form.querySelectorAll("select")) if (sel !== document.activeElement && sel.value !== sel.dataset.value) sel.value = sel.dataset.value;
    });
    const at = this.atWork(seat);
    morph(p.movesNote, can
      ? (actions.length ? null : h("p", { class: "hint" }, "No move can be made just now."))
      : [
        h("p", { class: "hint" }, !at ? "The seat is not at work: no moves." : actions.length ? "The computer makes the moves. Take over to make them yourself:" : "The computer makes the moves."),
        at && actions.length ? h("ul", { class: "play-options" }, actions.map((a) => h("li", {}, a.label, a.disabled ? ` (${a.disabled})` : null))) : null,
      ]);
  }

  /** The form of a move: its fields, its button, and why it was refused. A disabled move shows its reason instead of its fields. */
  form(seat, a, key, ids) {
    const fields = a.fields ?? [], refused = this.refused.get(`${seat.id}|${key}`);
    const inner = [
      h("p", { class: "hint" }, a.hint ?? ""),
      a.disabled ? h("p", { class: "play-why" }, a.disabled) : fields.map((f, i) => this.field(f, ids[i])),
    ];
    return [
      fields.length ? h("fieldset", {}, h("legend", {}, a.label), inner) : h("div", { class: "play-plain" }, inner),
      h("div", { class: "row" }, h("button", { class: `btn${a.primary ? " primary" : ""}`, type: "submit", "aria-disabled": a.disabled ? "true" : null }, a.label)),
      h("p", { class: "play-refused", role: "status" }, refused && performance.now() - refused.at < REFUSED_MS ? refused.text : ""),
    ];
  }

  /** A field of a move: a select for options (one option is chosen, of several a person chooses), a number, a checkbox, or a text. */
  field(f, id) {
    const draft = this.drafts.get(id);
    if (f.options) {
      const has = (v) => v != null && f.options.some((o) => String(o.id) === String(v));
      const value = has(draft) ? String(draft) : has(f.value) ? String(f.value) : f.options.length === 1 ? String(f.options[0].id) : "";
      return h("label", { class: "field", for: id }, h("span", {}, f.label),
        h("select", { id, "data-value": value, onchange: (e) => this.drafts.set(id, e.target.value) },
          h("option", { value: "", selected: !value }, "Choose"),
          f.options.map((o) => h("option", { value: String(o.id), selected: String(o.id) === value }, o.label))));
    }
    if (f.type === "check") {
      return h("label", { class: "field check", for: id }, h("input", { type: "checkbox", id, checked: draft ?? !!f.value, onchange: (e) => this.drafts.set(id, e.target.checked) }), h("span", {}, f.label));
    }
    const number = f.type === "number";
    return h("label", { class: "field", for: id }, h("span", {}, f.label, f.unit ? h("small", {}, ` (${f.unit})`) : null),
      h("input", { type: number ? "number" : "text", id, value: draft ?? f.value ?? "", min: number ? f.min : null, max: number ? f.max : null, step: number ? f.step ?? "any" : null, oninput: (e) => this.drafts.set(id, e.target.value) }));
  }

  /** A table of a game's view. */
  table(t) {
    const cell = (v) => (typeof v === "number" ? num(v) : v == null ? "" : String(v));
    return h("table", { class: "game-table" },
      h("thead", {}, h("tr", {}, t.columns.map((c) => (c ? h("th", { scope: "col" }, c) : h("td", {}))))),
      h("tbody", {}, t.rows.map((row) => h("tr", {}, row.map((v, i) => (i === 0 && cell(v) ? h("th", { scope: "row" }, cell(v)) : h("td", {}, cell(v))))))));
  }

  /** The parts of a score as meters with their notes. */
  parts(parts) {
    return h("ul", { class: "score-parts" }, parts.map((x) => {
      const pct = Math.round(Math.max(0, Math.min(1, x.value)) * 100);
      return h("li", {},
        h("span", {}, `${x.label} (${x.weight})`),
        h("span", { class: "meter", role: "img", "aria-label": `${pct} %` }, h("i", { style: { width: `${pct}%` } })),
        h("span", { class: "note" }, x.note ?? ""));
    }));
  }

  /** What the roles give each other: how often each flow has passed, and the last flows (of one kind, if chosen), the newest first. */
  flows(force = false) {
    const s = this.session, counts = new Map();
    for (const f of s.flows) counts.set(f.flow, (counts.get(f.flow) ?? 0) + 1);
    const name = (id) => flowOf(id)?.name ?? id;
    $("#flowBadge").textContent = String(s.flows.length);
    morph($("#flowCounts"), [...counts].map(([id, n]) => h("li", {}, name(id), " ", h("span", { class: "tag" }, String(n)))));
    const sel = $("#flowFilter");
    if (force || sel !== document.activeElement) {
      morph(sel, h("option", { value: "" }, "All flows"), [...counts.keys()].map((id) => h("option", { value: id }, name(id))));
      if (sel.value !== this.filter) sel.value = this.filter;
      if (sel.value !== this.filter) this.filter = sel.value;
    }
    const lines = s.flows.filter((f) => !this.filter || f.flow === this.filter).slice(-FLOW_LINES).reverse();
    $("#flowEmpty").hidden = lines.length > 0;
    $("#flowScroll").hidden = !lines.length;
    morph($("#flowList"), lines.map((f) => {
      const ph = s.plan[f.phase];
      const when = ph?.kind === "shift" ? `${s.rounds > 1 ? `Round ${f.round} · ` : ""}${clockOf(ph.clock, f.t)}` : `Round ${f.round}${ph ? ` · ${ph.title}` : ""}`;
      const to = f.to.length ? f.to.map((id) => this.seatName(id)).join(", ") : "no seat";
      return h("li", {},
        h("span", { class: "when" }, when),
        h("strong", {}, name(f.flow)),
        h("span", { class: "who" }, `${f.seat === MISSION ? "the mission" : this.seatName(f.seat)} → ${to}`),
        h("span", { class: "what" }, payloadLine(f.payload)));
    }));
  }

  /** Announce the decisions that are new for the people. */
  hear() {
    const fresh = [];
    for (const seat of this.session.active) {
      if (seat.by !== "human" || !this.atWork(seat)) continue;
      for (const d of seat.game.open) {
        if (this.heard.has(d)) continue;
        this.heard.add(d);
        fresh.push(sentence(`${this.seatName(seat.id)}: ${d.title}`));
      }
    }
    if (fresh.length) this.say(`${fresh.length === 1 ? "A decision to take" : `${fresh.length} decisions to take`}. ${fresh.join(" ")}`);
  }

  /* ---------------------------------------------------------------- the people's moves */

  /** A person's move at a seat, through the session (which keeps it, also when it fails inside the game). What the session itself throws is a refusal too. */
  act(seatId, name, ...args) {
    try {
      return this.session.act(seatId, name, ...args);
    } catch (e) {
      // not a move of the game, or arguments that cannot be kept: nothing was recorded, nothing changed
      return { ok: false, reason: e.message };
    }
  }

  /** After a move: save, and draw everything anew. */
  after() {
    this.save();
    this.draw(true);
  }

  /** After a move that took away what had the focus: the focus goes to what is next, not to the top of the page. */
  refocus(next) {
    const a = document.activeElement;
    if (this.screen === "play" && (!a || a === document.body || !a.isConnected || a.closest("[hidden]"))) next()?.focus();
  }

  /** Submit the form of a move: its values in the order of its fields. */
  submit(seatId, form) {
    const a = form._action, k = `${seatId}|${form.dataset.key}`, values = [];
    let problem = a.disabled || null;
    for (const [i, f] of (problem ? [] : a.fields ?? []).entries()) {
      const el = document.getElementById(form._ids[i]);
      if (f.options) {
        const o = f.options.find((x) => String(x.id) === el.value);
        if (!o) problem = `Choose: ${f.label}.`;
        else values.push(o.id);
      } else if (f.type === "check") values.push(el.checked);
      else if (f.type === "number") {
        const n = el.value.trim() === "" ? NaN : Number(el.value), unit = f.unit ? ` ${f.unit}` : "";
        if (!Number.isFinite(n)) problem = `Enter a number: ${f.label}.`;
        else if (f.min != null && n < f.min) problem = `${f.label}: at least ${f.min}${unit}.`;
        else if (f.max != null && n > f.max) problem = `${f.label}: at most ${f.max}${unit}.`;
        else values.push(n);
      } else values.push(el.value);
      if (problem) break;
    }
    const res = problem ? { ok: false, reason: problem } : this.act(seatId, a.name, ...(a.args ?? []), ...values);
    if (refusedBy(res)) {
      // the same reason again is told again: the text differs by a space
      const text = res?.reason ?? "That is not possible now.", last = this.refused.get(k)?.text;
      this.refused.set(k, { text: last === text ? `${text} ` : text, at: performance.now() });
    } else {
      this.refused.delete(k);
      for (const id of form._ids) this.drafts.delete(id);
    }
    this.after();
    this.refocus(() => this.panels.get(seatId).movesTitle);
  }

  /** Take a decision at a seat; what a person decided goes into the session's diary (with its seat), for the mission's sheet. */
  decide(seatId, id, option) {
    const seat = this.session.seat(seatId), d = seat?.game?.open.find((x) => x.id === id), o = d?.options.find((x) => x.id === option);
    const res = this.act(seatId, "decide", id, option);
    if (refusedBy(res)) {
      this.say(res?.reason ?? "This decision is not open any more.");
      this.sound.play("refuse");
    } else {
      if (d && o && seat.by === "human") this.diary.push({ seat: seatId, who: this.seatName(seatId), title: d.title, chose: o.label, round: this.session.round });
      this.sound.play("choose");
    }
    this.term = null;
    this.after();
    this.refocus(() => {
      const p = this.panels.get(seatId);
      return p.story.querySelector(".btn") ?? p.decisions.querySelector(".play-options-row button, button") ?? p.tools.querySelector("button") ?? p.decisionsTitle;
    });
  }

  /** A seat changes hands: a person takes over, or hands it to the computer. */
  sit(seatId, by) {
    const s = this.session;
    s.sit(seatId, by);
    // a seat taken in the middle of a shift: the lines whose moment has passed are not said any more, but for the latest
    if (by === "human" && s.phase?.kind === "shift") this.heardLines.set(seatId, new Set([...(this.heardLines.get(seatId) ?? []), ...staleLines(this.beats, seatId, s.t)]));
    this.say(`${by === "human" ? "You play" : "The computer plays"} ${this.seatName(seatId)} now.`);
    this.after();
    // the tools are drawn anew, more or fewer of them: the focus stays on the seat's switch (the last of them)
    const hand = this.panels.get(seatId)?.tools.querySelector("button:last-of-type");
    if (hand && !hand.closest("[hidden]")) hand.focus();
    else this.refocus(() => $("#stripTitle"));
  }

  /** End the turn: what is still open is decided by its fallback. */
  endTurn() {
    const s = this.session;
    if (!s || s.over || s.phase.kind !== "turn") return;
    s.next();
    this.after();
    this.refocus(() => $("#stripTitle"));
  }

  /** A shift with nobody of the people at work: step to its end. */
  skip() {
    const s = this.session, i = s?.index;
    if (!s || s.over || s.phase.kind !== "shift" || s.waiting) return;
    for (let n = 0; !s.over && s.index === i && !s.holding && n < 1e6; n++) s.step(s.phase.tick * 100);
    this.after();
    this.refocus(() => $("#stripTitle"));
  }

  /** The speed of a shift (0: paused). */
  setSpeed(v, tell = false) {
    if (v) this.lastSpeed = v;
    this.speed = v;
    for (const [i, b] of [...$("#speed").children].entries()) b.setAttribute("aria-pressed", String(SPEEDS[i][0] === v));
    if (tell) this.say(v ? `Running at ${v}×` : "Paused");
  }

  /* ---------------------------------------------------------------- 3: the result */

  /** The result: the score of the whole, each seat with its rounds, objectives and rules broken, the flows, the debrief. */
  result(r = this.session.result()) {
    const s = this.session, m = this.mission, tag = (passed) => h("span", { class: `tag ${passed ? "ok" : "bad"}` }, passed ? "passed" : "not passed");
    const seat = (x) => {
      const last = x.rounds.at(-1), rules = s.seat(x.seat).game?.violations ?? [], name = this.seatName(x.seat);
      const changed = s.record.some((mv) => mv.name === "@seat" && mv.seat === x.seat);
      return h("div", { class: "game-card" },
        h("h3", {}, name),
        h("p", {}, `${x.title}, played by ${x.by === "human" ? "you" : "the computer"}${changed ? " at the end (the seat changed hands)" : ""}.`),
        h("p", {}, h("span", { class: "score-total" }, String(x.score)), " of 100 · ", tag(x.passed)),
        h("h4", {}, "Score per round"),
        x.rounds.length ? this.scroller(`result|${x.seat}`, `Score per round: ${name}`, h("table", { class: "game-table" },
          h("thead", {}, h("tr", {}, ["Round", "Phase", "Score", "Passed", "Rules broken"].map((c) => h("th", { scope: "col" }, c)))),
          h("tbody", {}, x.rounds.map((row) => h("tr", {}, h("th", { scope: "row" }, String(row.round)), h("td", {}, m.phases.find((ph) => ph.id === row.phase)?.title ?? "the whole round"),
            h("td", {}, String(row.score)), h("td", {}, row.passed ? "passed" : "not passed"), h("td", {}, String(row.violations))))))) : h("p", { class: "hint" }, "This seat was never at work."),
        last ? [h("h4", {}, x.rounds.length > 1 ? `Objectives of round ${last.round}` : "Objectives"), this.parts(last.parts)] : null,
        h("h4", {}, "Rules broken"),
        x.violations
          ? [h("p", {}, `${x.violations} in all${x.worst >= 3 ? ", a danger to people among them" : ""}.`), rules.length ? h("ul", {}, rules.map((v) => h("li", {}, `${v.text} (${SEVERITY[v.severity] ?? "a breach"})`))) : null]
          : h("p", { class: "hint" }, "None."));
    };
    const flows = Object.entries(r.flows), place = placeOfMission(m);
    // the report (a dialog): every seat's rounds and objectives, what led to what, the flows, the debrief
    const report = h("dialog", { class: "play-dialog play-report", "aria-labelledby": "reportTitle" },
      h("div", { class: "play-dialog-head" }, h("h3", { id: "reportTitle", tabindex: "-1" }, "The full report"), h("button", { class: "btn small", type: "button", onclick: () => report.close() }, "Close")),
      h("p", { class: "hint" }, `${r.rounds === 1 ? "1 round" : `${r.rounds} rounds`}, seed ${r.seed}. The whole is passed when every seat passed all its rounds: 50 points or more, and no danger to people.`),
      h("div", { class: "play-result-seats" }, r.seats.map(seat)),
      this.chain(s.threads()),
      h("div", { class: "game-card" },
        h("h3", {}, "What the roles gave each other"),
        flows.length ? h("ul", { class: "play-counts" }, flows.map(([id, n]) => h("li", {}, flowOf(id)?.name ?? id, " ", h("span", { class: "tag" }, String(n))))) : h("p", { class: "hint" }, "Nothing passed between the roles.")),
      m.debrief.length ? h("div", { class: "game-card" }, h("h3", {}, "For the debrief"), h("ol", { class: "play-debrief" }, m.debrief.map((q) => h("li", {}, q)))) : null,
      h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => this.file() }, "Save the session as a file")));
    // the verdict, over the picture of the mission's place: the stars, the score, passed or not, what was gained, the cast with their scores, a question to take along
    const won = this.gained;
    // passed: on to the next stop of the line that is not passed yet
    const onward = r.passed ? this.missions.find((d) => d.id === nextMission(this.progress, this.missions.map((x) => x.id)) && d.id !== m.id && !this.progress.missions[d.id]?.passed) : null;
    this.backdrop(wideOf(place));
    mount($("#result"),
      h("div", { class: `vn-verdict ${r.passed ? "passed" : "failed"}` },
        h("div", { class: "vn-verdict-box" },
          h("p", { class: "vn-over" }, r.passed ? "Mission passed" : "Mission not passed"),
          h("h2", { id: "resultTitle", tabindex: "-1" }, `The result: ${m.title}`),
          h("p", { class: "vn-score" }, won ? this.stars(won.stars, MAX_STARS, true) : null, h("span", { class: "score-total" }, String(r.score)), h("span", { class: "of" }, " of 100 · "), tag(r.passed)),
          won && (won.best || won.rank || won.badges.length) ? h("ul", { class: "vn-gained" },
            won.rank ? h("li", { class: "rank" }, "Promoted: ", h("strong", {}, won.rank)) : null,
            won.badges.map((b) => h("li", {}, "Badge: ", h("strong", {}, b))),
            won.best && r.passed ? h("li", {}, "Your best so far") : null) : null,
          won && won.score !== r.score ? h("p", { class: "hint vn-own" }, `Your stars are for your own ${this.yours.size > 1 ? "seats" : "seat"}: ${won.score} of 100.`) : null,
          !won ? h("p", { class: "hint" }, this.watched ? "The computer played every seat: nothing goes into your logbook." : "No seat was yours for most of its work: nothing goes into your logbook.") : null,
          h("ul", { class: "vn-cast", "aria-label": "The seats" }, r.seats.map((x) => h("li", { class: x.passed ? "ok" : "bad" },
            h("img", { class: "face", src: BASE + selfPortrait(s.seat(x.seat).Game.id).picture, alt: "" }),
            h("span", { class: "name" }, this.seatName(x.seat)),
            h("span", { class: "pts" }, h("strong", {}, String(x.score)), ` · ${this.yours.has(x.seat) ? "you" : "computer"}`)))),
          m.debrief.length ? h("p", { class: "vn-question" }, h("span", { class: "place-label" }, "To take along"), " ", m.debrief[0]) : null,
          h("div", { class: "row" },
            onward ? h("button", { class: "btn primary play-big", type: "button", onclick: () => this.choose(onward.id) }, h("span", { class: "play-go", "aria-hidden": "true" }, "▶"), `Next stop: ${onward.title}`) : null,
            h("button", { class: `btn${onward ? "" : " primary play-big"}`, type: "button", onclick: () => this.again(false) }, "Play again"),
            h("button", { class: "btn", type: "button", onclick: () => this.again(true) }, "New seed"),
            won ? h("a", { class: "btn", href: `../logbook/#sheet-${encodeURIComponent(m.id)}` }, "Your sheet") : null,
            h("button", { class: "btn", type: "button", "aria-haspopup": "dialog", onclick: () => { report.showModal(); this.fit(report); } }, "The full report"),
            h("button", { class: "btn", type: "button", onclick: () => this.choose(null) }, "The line")))),
      report);
    this.fit($("#result"));
  }

  /**
   * What led to what: every fault of the shifts on one time line, from its failure to its repair, each stretch of
   * its time out of order in the colour of whose it was (a seat, the road, the team's work, somebody outside the
   * game), what the teams did while it waited, and what it did in the games' worlds; and the minutes by whose they were.
   */
  chain(threads) {
    if (!threads.length) return null;
    const s = this.session, seats = [...s.seats.keys()];
    const min = (sec) => `${num(sec / 60)} min`;
    const who = (by) => (by === "road" ? "on the road" : by === "team" ? "the team's work" : by === "others" ? "somebody outside this game" : by ? this.seatName(by) : "");
    const tone = (by) => (by === "road" || by === "team" || by === "others" ? `by-${by}` : by ? `by-seat-${seats.indexOf(by) % 4}` : "by-none");
    const total = new Map();
    for (const th of threads) for (const [by, sec] of Object.entries(th.by)) total.set(by, (total.get(by) ?? 0) + sec);
    const order = [...seats.filter((id) => total.has(id)), ...["road", "team", "others"].filter((k) => total.has(k))];
    const all = [...total.values()].reduce((a, b) => a + b, 0);
    const phases = [...new Set(threads.map((th) => th.phase))];
    const thread = (th) => {
      const ph = s.plan[th.phase], length = ph.length || Math.max(1, th.to), at = (t) => clockOf(ph.clock, t).slice(0, 5);
      const pct = (t) => `${Math.round((1000 * Math.max(0, Math.min(length, t))) / length) / 10}%`;
      const state = th.state === "repaired" ? ["ok", "repaired"] : th.state === "provisional" ? ["warn", "repaired provisionally"] : ["bad", "not repaired"];
      const parts = Object.entries(th.by).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([by, sec]) => `${who(by)} ${min(sec)}`).join(", ");
      const sum = `Out of order for ${min(th.out_s)}${th.relapses ? `, failed again ${th.relapses === 1 ? "once" : `${th.relapses} times`}` : ""}`;
      return h("section", { class: "play-thread" },
        h("h4", {}, `${th.asset}${th.place ? `, ${th.place}` : ""} `, h("span", { class: `tag ${state[0]}` }, state[1])),
        h("p", {}, `${sum}: ${parts}.`),
        h("div", { class: "play-line", role: "img", "aria-label": `${th.asset}: ${sum}, from ${at(th.from)} to ${at(th.to)}` },
          th.stretches.map((x) => h("i", { class: `${tone(x.by)}${x.kind === "held" ? " held" : ""}`, title: `${at(x.from)}–${at(x.to)}: ${x.text}`, style: { left: pct(x.from), width: `calc(${pct(x.to)} - ${pct(x.from)})` } }))),
        h("div", { class: "play-line-ends", "aria-hidden": "true" }, h("span", {}, at(0)), h("span", {}, at(length))),
        h("ol", { class: "play-stretches" }, th.stretches.map((x) => h("li", {},
          h("span", { class: "when" }, `${at(x.from)}–${at(x.to)}`),
          h("span", { class: `key ${tone(x.by)}${x.kind === "held" ? " held" : ""}`, "aria-hidden": "true" }),
          h("span", {}, h("strong", {}, min(x.to - x.from)), ` ${x.text}${x.provisional ? " (provisional)" : ""}${x.open ? ", to the end of the shift" : ""}`, x.by && x.by !== "road" && x.by !== "team" ? [": ", h("em", {}, who(x.by))] : null,
            x.meanwhile?.length ? h("span", { class: "hint" }, ` Meanwhile: ${x.meanwhile.map((m) => `${m.team} at ${m.asset}`).join(", ")}.`) : null)))),
        th.effects.length ? [h("p", { class: "play-effects-title" }, "What it did:"), h("ul", { class: "play-effects" }, th.effects.map((e) => h("li", {}, sentence(e[0].toUpperCase() + e.slice(1)))))] : null);
    };
    return h("div", { class: "game-card play-chain" },
      h("h3", {}, "What led to what"),
      h("p", { class: "hint" }, "Every fault from its failure to its repair, on the time line of the shift: whose each stretch of its time out of order was."),
      h("ul", { class: "play-keys" }, order.map((by) => h("li", {}, h("span", { class: `key ${tone(by)}`, "aria-hidden": "true" }), `${who(by)}: `, h("strong", {}, min(total.get(by))), all ? ` (${Math.round((100 * total.get(by)) / all)} %)` : ""))),
      phases.map((i) => [
        phases.length > 1 ? h("h4", { class: "play-chain-phase" }, `Round ${s.plan[i].round} · ${s.plan[i].title}`) : null,
        threads.filter((th) => th.phase === i).map(thread),
      ]));
  }

  /** The mission once more with the same seats: with the same seed, or a new one. */
  again(fresh) {
    const s = this.session;
    let seed = s.seed;
    while (fresh && seed === s.seed) seed = 1 + Math.floor(Math.random() * 99999);
    this.choice = { ...this.choice, seats: { ...s.seated }, seed };
    this.start();
  }

  /** The session as a file: what `save` gives, with the result. */
  file() {
    const s = this.session;
    download(`${s.mission.id}-seed-${s.seed}.json`, JSON.stringify({ ...s.save(), result: s.result() }, null, 1));
  }

  /* ---------------------------------------------------------------- time and keys */

  /** A frame: a shift goes on at the speed chosen; the panels are drawn about 4 times a second, the session saved every few seconds. */
  frame(t) {
    const dt = this.prev == null ? 0 : Math.min(0.25, (t - this.prev) / 1000);
    this.prev = t;
    const s = this.session;
    if (s && this.screen === "play") {
      // while somebody speaks to the person at the seat shown, the shift's clock waits for the answer
      const held = this.listening();
      if (!s.over && s.phase.kind === "shift" && this.speed > 0 && !held) s.step(dt * this.speed);
      $("#shiftBar").classList.toggle("held", held);
      // games whose world is elsewhere exchange with it between the steps, one exchange at a time
      if (!s.over && !this.exchanging && typeof s.sync === "function") {
        this.exchanging = true;
        s.sync().catch(() => {}).finally(() => (this.exchanging = false));
      }
      this.sync();
      if (this.screen === "play") {
        this.clock();
        if (this.dirty || t - this.lastDraw > DRAW_MS) this.draw();
        if (t - this.lastSave > SAVE_MS) this.save();
      }
    }
    requestAnimationFrame((x) => this.frame(x));
  }

  /**
   * The keys. Choosing: the arrows go along the line of missions, T sounds the little train's horn. Playing: P pauses a shift and lets
   * it run again, 1 to 9 take an option of the decision in focus, Space reads on, D opens the desk,
   * H shows only the picture, M switches the sound, L the live backdrop.
   */
  key(e) {
    if (e.target.closest?.("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey || document.querySelector("dialog[open]")) return;
    const k = e.key;
    if (this.screen === "choose" && (k === "ArrowRight" || k === "ArrowLeft") && !e.target.closest?.("summary, [role=tab]")) {
      e.preventDefault();
      return void this.stepMission(k === "ArrowRight" ? 1 : -1);
    }
    if (this.screen === "choose" && (k === "t" || k === "T")) return void this.honk();
    if (this.screen !== "play" || !this.session) return;
    // Escape closes what is open at the side
    if (k === "Escape" && this.opened) return void this.flyout(null);
    if (k === "h" || k === "H") return void this.setBare(!this.bare);
    if (k === "m" || k === "M") return void this.setSound(!this.sound.on);
    if (k === "l" || k === "L") return void this.setLive(!this.liveOn);
    if (this.bare) return;
    if ((k === "p" || k === "P") && this.session.phase?.kind === "shift") return void this.setSpeed(this.speed ? 0 : this.lastSpeed, true);
    const p = this.panels.get(this.tab);
    if (!p) return;
    if (k === "d" || k === "D") return void this.openDesk(this.tab);
    if (/^[1-9]$/.test(k) && !p.decisions.hidden) {
      const b = p.decisions.querySelectorAll(".play-decision:not(.waiting) .play-options-row .btn")[Number(k) - 1];
      if (b) {
        e.preventDefault();
        b.click();
      }
    } else if (k === " " && !e.target.closest?.("button, a, summary, [role=button], [role=tab]")) {
      const next = p.story.querySelector(".btn");
      if (next) {
        e.preventDefault();
        next.click();
      }
    }
  }
}

window.__play = new PlayPage();
