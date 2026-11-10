// The play page of the big game (game/play/): a mission (missions/*.json) seats several roles of the
// railway, each seat one role's game, played by a person at this device or by the computer; the games
// are wired by flows (what one role gives another). The page lets a person choose a mission and the
// seats, play it in hot seat (the tabs are the seats), watch what the roles give each other, and
// read the result. It knows no game by name: every game is drawn from its view (figures, tables,
// the moves that can be made now with their fields), its open decisions, its messages and its score.
// The session itself is arail/game/session.js; this page passes the people's moves to it and draws it.
import { GAMES, MISSION, Session, flowOf, normalizeMission, validateMission, wiring } from "../../arail/game/index.js";
import { $, download, h, morph, mount, storage } from "../../app/ui.js";

const MISSIONS = "../missions/";
const SAVE_FORMAT = "arail-session/1";
/** Where a mission's session is kept in the browser, and what the seats' games were told (`Game.settings`; no passwords). */
const saveKey = (id) => `arail.play.${id}`;
const SETTINGS_KEY = "arail.play.settings";
const SPEEDS = [[0, "Pause"], [1, "1×"], [5, "5×"], [20, "20×"]];
/** The messages and flows shown; the panels are drawn every DRAW_MS, the session saved every SAVE_MS, a refusal shown for REFUSED_MS. */
const LOG_LINES = 40, FLOW_LINES = 60, DRAW_MS = 250, SAVE_MS = 5000, REFUSED_MS = 20000;
const SEVERITY = ["", "a slip", "a breach", "a danger to people"];

/** The time of day (HH:MM:SS) of a shift that began at `start` ("08:00"), `t` seconds in. */
function clockOf(start, t) {
  const [hh, mm] = String(start ?? "08:00").split(":").map(Number);
  const s = Math.max(0, Math.floor((hh || 0) * 3600 + (mm || 0) * 60 + t));
  const two = (n) => String(n).padStart(2, "0");
  return `${two(Math.floor(s / 3600) % 24)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
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
    this.speed = 1;
    this.lastSpeed = 1;
    /** The seat shown, the flow the list is filtered by, the phase the page has seen (index of the session's plan). */
    this.tab = null;
    this.filter = "";
    this.index = -1;
    /** What a person has filled into the forms (by input id), and the moves refused (by seat and move). */
    this.drafts = new Map();
    this.refused = new Map();
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
    $("#flowFilter").onchange = (e) => {
      this.filter = e.target.value;
      this.flows(true);
    };
    $("#tabs").addEventListener("keydown", (e) => this.tabKey(e));
    document.addEventListener("keydown", (e) => this.key(e));
    addEventListener("popstate", () => this.route());
    addEventListener("pagehide", () => this.save());
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

  /** The address: `?mission=<id>` opens that mission. */
  route() {
    this.open(this.missions.find((m) => m.id === new URLSearchParams(location.search).get("mission")) ?? null);
  }

  /** Choose a mission (null: back to the list of missions); the address follows. */
  choose(id) {
    const doc = this.missions.find((m) => m.id === id) ?? null;
    const url = new URL(location.href);
    if (doc) url.searchParams.set("mission", doc.id);
    else url.searchParams.delete("mission");
    if (url.href !== location.href) history.pushState(null, "", url);
    this.open(doc);
    (doc && this.choice ? $("#setupTitle") : $("#missionsTitle"))?.focus();
  }

  /** Show the first screen with a mission chosen (or none). A session that runs is saved and left. */
  open(doc) {
    if (this.session && !this.session.over) this.save();
    this.session = null;
    this.mission = null;
    this.doc = doc;
    this.choice = null;
    if (doc && !validateMission(doc, this.games).length) {
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
    for (const id of ["choose", "play", "result"]) $(`#${id}`).hidden = id !== screen;
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

  /** The first screen: the missions as cards, and the mission chosen with its seats. */
  chooser() {
    const note = $("#missionsNote");
    note.textContent = this.failed ?? (this.missions.length ? "" : this.ready ? "There are no missions yet." : "Loading the missions.");
    note.hidden = !note.textContent;
    mount($("#missions"), this.missions.map((doc) => h("li", {}, this.card(doc))));
    this.setup();
    this.fit($("#choose"));
  }

  /** A mission's card: title, text, rounds and phases, the seats with who is suggested for them. */
  card(doc) {
    const problems = validateMission(doc, this.games), m = normalizeMission(doc, this.games), chosen = this.doc === doc;
    return h("article", { class: "game-card play-mission", "aria-labelledby": `mission-${doc.id}` },
      h("h3", { id: `mission-${doc.id}` }, m.title ?? doc.id),
      h("p", {}, m.text),
      h("p", { class: "hint" }, this.outline(m)),
      h("ul", { class: "play-roles", "aria-label": "Seats" }, m.roles.map((r) => h("li", {}, this.roleText(r.role), ": ", r.seat === "human" ? "you" : "the computer"))),
      problems.length ? h("p", { class: "hint error" }, `This mission cannot be played here: ${problems.join("; ")}.`)
        : h("p", {}, h("a", {
          class: `btn${chosen ? "" : " primary"}`, href: `?mission=${encodeURIComponent(doc.id)}`, "aria-describedby": `mission-${doc.id}`, "aria-current": chosen ? "true" : null,
          onclick: (e) => {
            e.preventDefault();
            this.choose(doc.id);
          },
        }, chosen ? "Chosen" : "Choose this mission")));
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

  /** The mission chosen: who plays which seat, the seed, Start and Resume, and its wiring. */
  setup() {
    const el = $("#setup"), doc = this.doc, c = this.choice;
    el.hidden = !doc || !c;
    if (el.hidden) return void mount(el);
    const m = normalizeMission(doc, this.games), saved = this.saved(doc.id);
    mount(el,
      h("h2", { id: "setupTitle", tabindex: "-1" }, m.title),
      h("p", {}, m.text),
      h("p", { class: "hint" }, this.outline(m)),
      h("form", {
        class: "play-setup-form", id: "setupForm",
        onsubmit: (e) => {
          e.preventDefault();
          this.start();
        },
      },
      h("div", { class: "play-choices" }, m.roles.map((r) => h("fieldset", { class: "play-choice" },
        h("legend", {}, this.roleText(r.role), r.id !== r.role ? ` (${r.id})` : null),
        [["human", "You"], ["computer", "Computer"]].map(([by, label]) => h("label", { class: "field check", for: `by-${r.id}-${by}` },
          h("input", { type: "radio", name: `by-${r.id}`, id: `by-${r.id}-${by}`, value: by, checked: c.seats[r.id] === by, onchange: () => { c.seats[r.id] = by; } }), label)),
        (this.games.get(r.game).settings ?? []).map((x) => h("label", { class: "field play-setting", for: `set-${r.id}-${safe(x.id)}` }, h("span", {}, x.label),
          h("input", {
            type: x.type === "password" ? "password" : "text", id: `set-${r.id}-${safe(x.id)}`, autocomplete: "off", value: c.settings[r.id][x.id],
            oninput: (e) => {
              c.settings[r.id][x.id] = e.target.value;
              // kept in this browser for the next time, but never a key
              if (x.type !== "password") storage.set(SETTINGS_KEY, { ...storage.get(SETTINGS_KEY, {}), [`${r.game}.${x.id}`]: e.target.value });
            },
          }),
          x.hint ? h("small", { class: "help" }, x.hint) : null))))),
      h("details", {}, h("summary", {}, "More"),
        h("label", { class: "field", for: "seed" }, h("span", {}, "Seed"),
          h("input", {
            type: "number", id: "seed", min: "1", step: "1", value: c.seed,
            oninput: (e) => {
              const n = Math.round(Number(e.target.value));
              c.seed = e.target.value !== "" && Number.isFinite(n) && n >= 1 ? n : m.seed;
            },
          }),
          h("small", { class: "help" }, "The same seed and the same moves give the same session."))),
      h("div", { class: "row" },
        saved ? h("button", { class: "btn primary", type: "button", id: "resume", onclick: () => this.resume() }, "Resume") : null,
        h("button", { class: `btn${saved ? "" : " primary"}`, type: "submit", id: "start" }, "Start")),
      saved ? h("p", { class: "hint" }, `A session of this mission is saved in this browser (${this.standing(m, saved)}). Start begins a new one and replaces it.`) : null,
      this.note ? h("p", { class: "hint error" }, this.note) : null),
      this.wiringTable(doc, m));
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
    this.begin(session);
    // a session taken up again waits: the person finds their place first
    if (this.screen === "play" && session.phase.kind === "shift") this.setSpeed(0, true);
  }

  /** Take a session: build its tabs and panels, show the play screen. */
  begin(session) {
    this.session = session;
    this.mission = session.mission;
    this.index = -1;
    this.filter = "";
    this.note = "";
    this.savedAs = "";
    this.drafts.clear();
    this.refused.clear();
    this.setSpeed(1);
    // what happens in the session is drawn with the next frame
    session.on(() => {
      this.dirty = true;
    });
    const seats = [...session.seats.values()];
    this.tab = (seats.find((s) => s.by === "human") ?? seats[0]).id;
    this.panels = new Map(seats.map((s) => [s.id, this.panel(s)]));
    mount($("#panels"), [...this.panels.values()].map((p) => p.el));
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

  /** A phase has begun: show one of the people's seats at work in it, say so, save. */
  entered() {
    const s = this.session, ph = s.phase;
    const mine = (seat) => seat.by === "human" && s.active.includes(seat);
    if (!mine(s.seat(this.tab))) this.tab = s.active.find(mine)?.id ?? this.tab;
    this.say(`${s.rounds > 1 ? `Round ${s.round} of ${s.rounds}. ` : ""}${ph.title}: ${ph.kind === "shift" ? "a shift" : "a turn"}.`);
    this.save();
  }

  /** The session is over: its save is removed, the result is shown. */
  finish() {
    const s = this.session, r = s.result();
    storage.remove(saveKey(s.mission.id));
    this.show("result");
    this.result(r);
    this.say(`The session is over: ${r.score} of 100, ${r.passed ? "passed" : "not passed"}.`);
    $("#resultTitle").focus();
  }

  /** Keep the session in the browser (`session.save()`, under a key per mission). */
  save() {
    const s = this.session;
    this.lastSave = performance.now();
    if (!s || s.over || s.index < 0) return;
    const as = `${s.index}|${s.ticks}|${s.record.length}`;
    if (as === this.savedAs) return;
    this.savedAs = as;
    storage.set(saveKey(s.mission.id), s.save());
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
    for (const [id, p] of this.panels) p.el.hidden = id !== this.tab;
    this.seat(s.seat(this.tab), force);
    this.flows(force);
    this.hear();
    this.fit($("#play"));
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
    $("#stripTitle").textContent = m.title;
    $("#where").textContent = `${m.rounds > 1 ? `Round ${s.round} of ${m.rounds} · ` : ""}${ph.title}`;
    morph($("#phases"), s.plan.filter((p) => p.round === s.round).map((p) => h("li", { "aria-current": p === ph ? "step" : null }, p.title, " ", h("small", {}, `(${p.kind})`))));
    $("#shiftBar").hidden = !shift;
    $("#skipBar").hidden = !shift || s.waiting;
    $("#turnBar").hidden = shift;
    if (shift) return;
    const open = s.active.reduce((n, seat) => n + (seat.by === "human" && seat.game ? seat.game.open.length : 0), 0);
    const end = $("#endTurn");
    end.textContent = open ? `End the turn (${open} open)` : "End the turn";
    end.className = `btn${s.ready ? " primary" : ""}`;
    $("#turnNote").textContent = open
      ? `${open === 1 ? "1 of your decisions is" : `${open} of your decisions are`} still open. Ending the turn decides ${open === 1 ? "it by its" : "them by their"} fallback.`
      : "Nothing is left for you to decide in this turn.";
  }

  /** The seats as tabs: the role, who plays it, the decisions open. */
  tabs() {
    morph($("#tabs"), [...this.session.seats.values()].map((seat) => {
      const on = seat.id === this.tab, at = this.atWork(seat), n = at ? seat.game.open.length : 0;
      return h("button", { type: "button", role: "tab", id: `tab-${seat.id}`, "aria-controls": `seat-${seat.id}`, "aria-selected": String(on), tabindex: on ? "0" : "-1", onclick: () => this.select(seat.id) },
        h("span", { class: "name" }, this.seatName(seat.id)),
        h("span", { class: "who" }, seat.by === "human" ? "you" : "computer", at ? null : ", not at work",
          n ? [" ", h("span", { class: "tag warn" }, String(n)), h("span", { class: "visually-hidden" }, n === 1 ? " decision open" : " decisions open")] : null));
    }));
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
    const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i + n - 1) % n, Home: 0, End: n - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    this.select(ids[to], true);
  }

  /** The fixed parts of a seat's panel; `seat` draws into them. */
  panel(seat) {
    const p = {
      head: h("div", { class: "game-card play-head wide" }),
      decisionsTitle: h("h4", { tabindex: "-1" }, "Decisions"),
      decisionsNote: h("p", { class: "hint" }),
      decisions: h("div", { class: "play-keyed" }),
      movesTitle: h("h4", { tabindex: "-1" }, "Moves"),
      movesNote: h("div", { class: "play-moves-note" }),
      moves: h("div", { class: "play-keyed" }),
      tables: h("div", { class: "play-tables wide" }),
      score: h("div", { class: "play-score" }),
      log: h("div", {}),
    };
    p.el = h("div", { class: "play-seat", role: "tabpanel", id: `seat-${seat.id}`, "aria-labelledby": `tab-${seat.id}`, hidden: true },
      p.head,
      h("div", { class: "game-card play-decisions" }, p.decisionsTitle, p.decisionsNote, p.decisions),
      h("div", { class: "game-card play-moves" }, p.movesTitle, p.movesNote, p.moves),
      p.tables,
      h("div", { class: "game-card" }, h("h4", {}, "Score so far"), p.score),
      h("div", { class: "game-card play-log" }, h("h4", {}, "Messages"), p.log));
    return p;
  }

  /** What a game shows of itself (`view()`), or nothing where it has not begun or cannot say. */
  view(game) {
    try {
      const v = game?.view() ?? {};
      return { figures: v.figures ?? [], tables: v.tables ?? [], actions: v.actions ?? [] };
    } catch (e) {
      return { figures: [{ label: "This game cannot be shown", value: e.message, tone: "bad" }], tables: [], actions: [] };
    }
  }

  /**
   * A seat's panel: the game and its role, the figures, the open decisions, the moves as forms, the
   * tables, the score so far and the messages. A computer's seat and a seat not at work show the
   * same without forms and buttons.
   */
  seat(seat, force = false) {
    const p = this.panels.get(seat.id), s = this.session, g = seat.game;
    const active = s.active.includes(seat), mine = seat.by === "human", can = this.atWork(seat) && mine;
    const view = this.view(g), de = this.roles.get(seat.role)?.name_de;
    morph(p.head,
      h("h3", {}, seat.Game.title),
      h("p", { class: "play-role" }, "Role: ", h("a", { href: `../roles/#role-${seat.role}` }, this.seatName(seat.id)), de ? [" ", h("span", { class: "de", lang: "de" }, `(${de})`)] : null, ", played by ", h("strong", {}, mine ? "you" : "the computer"), "."),
      h("p", { class: "hint" }, seat.Game.description ?? ""),
      h("p", { class: "play-state" }, !g ? "Not at work in this phase. Its game has not begun yet." : !active ? "Not at work in this phase. This is its last state." : g.over ? `This game is over: ${g.over}` : mine ? "" : "The computer plays this seat. You can watch it, or take over."),
      h("dl", { class: "play-figures" }, view.figures.map((f) => h("div", { class: ["ok", "warn", "bad"].includes(f.tone) ? `tone-${f.tone}` : "" },
        h("dt", {}, f.label), h("dd", {}, typeof f.value === "number" ? num(f.value) : String(f.value ?? "–"), f.unit ? ` ${f.unit}` : null)))),
      h("div", { class: "row" }, h("button", { class: "btn small", type: "button", onclick: () => this.sit(seat.id, mine ? "computer" : "human") }, mine ? "Hand to the computer" : "Take over")));

    const open = g?.open ?? [];
    p.decisionsNote.textContent = open.length ? (can ? "" : mine ? "The seat is not at work: nothing can be decided now." : "The computer decides.") : "Nothing to decide just now.";
    keyed(p.decisions, open, (d) => d.id, () => h("div", { class: "play-decision" }), (el, d) => morph(el, ...this.decision(seat, d, can)));

    // a form a person is in stays as it is
    const at = document.activeElement;
    if (force || !(at?.matches?.("select, input") && p.moves.contains(at))) this.moves(seat, p, view.actions, can);

    morph(p.tables, view.tables.map((t) => h("div", { class: "game-card play-table" },
      h("h4", {}, t.title),
      t.rows?.length ? this.scroller(`${seat.id}|${t.id}`, t.title, this.table(t)) : h("p", { class: "hint" }, t.empty ?? "Nothing here."))));

    if (g) {
      const { total, parts } = g.score();
      morph(p.score, h("p", {}, h("span", { class: "score-total" }, String(total)), " of 100"), this.parts(parts));
    } else morph(p.score, h("p", { class: "hint" }, "No score yet."));

    const lines = g ? g.logs.slice(-LOG_LINES).reverse() : [];
    morph(p.log, lines.length
      ? h("div", { class: "play-scroll", tabindex: "0", role: "group", "aria-label": "Messages, the newest first" }, h("ol", {}, lines.map((l) => h("li", { class: `k-${safe(l.kind)}` }, l.text))))
      : h("p", { class: "hint" }, "No messages yet."));
  }

  /** An open decision: title, text, what happens without an answer, and its options (buttons for a person at work). */
  decision(seat, d, can) {
    const shift = this.session.phase.kind === "shift", label = (id) => d.options.find((o) => o.id === id)?.label ?? "";
    let left = "";
    if (shift && d.deadline != null) left = `${Math.max(0, Math.ceil(d.deadline - seat.game.t))} s left${d.fallback ? `, then: ${label(d.fallback)}` : ""}`;
    else if (!shift) left = `Still open at the end of the turn: ${label(d.fallback ?? d.options[0]?.id)}`;
    return [
      h("h5", {}, d.title),
      h("p", { class: "text" }, d.text ?? ""),
      h("p", { class: "hint" }, left),
      can ? h("div", { class: "row" }, d.options.map((o) => h("button", { class: "btn small", type: "button", onclick: () => this.decide(seat.id, d.id, o.id) }, o.label, o.hint ? h("small", {}, ` (${o.hint})`) : null)))
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

  /** A person's move at a seat, through the session. What a game throws is a refusal too, and is not kept in the record. */
  act(seatId, name, ...args) {
    const s = this.session, n = s.record.length;
    try {
      return s.act(seatId, name, ...args);
    } catch (e) {
      s.record.length = n;
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

  /** Take a decision at a seat. */
  decide(seatId, id, option) {
    const res = this.act(seatId, "decide", id, option);
    if (refusedBy(res)) this.say(res?.reason ?? "This decision is not open any more.");
    this.after();
    this.refocus(() => {
      const p = this.panels.get(seatId);
      return p.decisions.querySelector("button") ?? p.decisionsTitle;
    });
  }

  /** A seat changes hands: a person takes over, or hands it to the computer. */
  sit(seatId, by) {
    this.session.sit(seatId, by);
    this.say(`${by === "human" ? "You play" : "The computer plays"} ${this.seatName(seatId)} now.`);
    this.after();
    this.refocus(() => $("#stripTitle"));
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
    const flows = Object.entries(r.flows);
    mount($("#result"),
      h("div", { class: "game-card play-total" },
        h("h2", { id: "resultTitle", tabindex: "-1" }, `The result: ${m.title}`),
        h("p", {}, h("span", { class: "score-total" }, String(r.score)), " of 100 · ", tag(r.passed)),
        h("p", { class: "hint" }, `${r.rounds === 1 ? "1 round" : `${r.rounds} rounds`}, seed ${r.seed}. The whole is passed when every seat passed all its rounds: 50 points or more, and no danger to people.`),
        h("div", { class: "row" },
          h("button", { class: "btn primary", type: "button", onclick: () => this.again(false) }, "Play again"),
          h("button", { class: "btn", type: "button", onclick: () => this.again(true) }, "New seed"),
          h("button", { class: "btn", type: "button", onclick: () => this.file() }, "Save the session as a file"),
          h("button", { class: "btn", type: "button", onclick: () => this.choose(null) }, "Other missions"))),
      h("div", { class: "play-result-seats" }, r.seats.map(seat)),
      h("div", { class: "game-card" },
        h("h3", {}, "What the roles gave each other"),
        flows.length ? h("ul", { class: "play-counts" }, flows.map(([id, n]) => h("li", {}, flowOf(id)?.name ?? id, " ", h("span", { class: "tag" }, String(n))))) : h("p", { class: "hint" }, "Nothing passed between the roles.")),
      m.debrief.length ? h("div", { class: "game-card" }, h("h3", {}, "For the debrief"), h("ol", { class: "play-debrief" }, m.debrief.map((q) => h("li", {}, q)))) : null);
    this.fit($("#result"));
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
      if (!s.over && s.phase.kind === "shift" && this.speed > 0) s.step(dt * this.speed);
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

  /** P pauses a shift and lets it run again. */
  key(e) {
    if (e.target.closest?.("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.key === "p" || e.key === "P") && this.screen === "play" && this.session?.phase?.kind === "shift") this.setSpeed(this.speed ? 0 : this.lastSpeed, true);
  }
}

window.__play = new PlayPage();
