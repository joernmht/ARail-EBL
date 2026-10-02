// Terminal panel: the container terminal of the layout (its visits, containers, crane jobs and model
// wagons) and picking containers and their targets on the canvas, in the camera view and the flyover.
// Every canvas action is also in the panel: choose a container in the list and a place in "Move to".
import { applyH, CARRIER_TYPES, FONT, OVERLAY, PHASE_LABELS, pickBoxes, terminalOf } from "../arail/index.js";
import { $, h, morph, mount, toast } from "./ui.js";

const SPEEDS = [1, 2, 5, 10, 30];
/** A pointer that moves less than this (CSS px) between down and up taps (picks) rather than drags. */
const TAP_PX = 6;
/** How many crane jobs the table shows (the most recent ones). */
const JOBS_SHOWN = 12;
/** Container list filters: value, label, test of a carrier. */
const FILTERS = [
  ["all", "all places", () => true],
  ["trains", "trains", (c) => c.kind === "wagon" && c.number == null],
  ["wagons", "model wagons", (c) => c.number != null],
  ["barges", "barges", (c) => c.kind === "barge"],
  ["trucks", "trucks", (c) => c.kind === "truck"],
  ["yards", "yard blocks", (c) => c.kind === "yard"],
];
/** Quick targets of the Move form: carrier kind and button text. */
const QUICK = [["yard", "To the yard"], ["truck", "To a truck"], ["wagon", "To a train"], ["barge", "To the barge"]];
/** Icons of the arrival cards (24 × 24, drawn with the text colour). */
const ICONS = {
  train: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10h14M9 21l1.5-4M15 21l-1.5-4"/><circle cx="9" cy="13.5" r=".6"/><circle cx="15" cy="13.5" r=".6"/></svg>',
  barge: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 14h19l-3 6h-13z"/><path d="M6 14V9h5v5M11 11h6v3M8 9V5"/></svg>',
  truck: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 6h12v10H2zM14 9.5h4l3.5 3.5v3H14z"/><circle cx="6.5" cy="18" r="2"/><circle cx="17.5" cy="18" r="2"/></svg>',
};

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
/** Key of a slot (the value of an option of "Move to"). */
const slotKey = (at) => `${at.carrier}|${at.bay}|${at.row ?? 0}|${at.tier ?? 0}`;
/** Element id of a container's button in the list. */
const listId = (id) => `term-c-${String(id).replace(/\W+/g, "-")}`;

/** `type` if it is a wagon type, else null. */
const deckType = (type) => (typeof type === "string" && CARRIER_TYPES[type]?.kind === "wagon" ? type : null);

/** Wagon numbers as ranges, e.g. [1, 2, 3, 5] -> "1-3,5" (with `prefix` "W": "W1–W3, W5"). */
function numberList(numbers, prefix = "") {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b), parts = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${prefix}${sorted[i]}${prefix ? "–" : "-"}${prefix}${sorted[j]}` : `${prefix}${sorted[i]}`);
    i = j;
  }
  return parts.join(prefix ? ", " : ",");
}

export class TerminalPanel {
  /** @param {object} app the ARail app (app.js) */
  constructor(app) {
    this.app = app;
    /** Id of the selected container, or null. */
    this.selected = null;
    /** null, or "target" while the place for the selected container is picked on the canvas. */
    this.stage = null;
    /** Error of the Move form (shown under it). */
    this.error = "";
    /** Key of the place chosen in "Move to". */
    this.targetKey = null;
    this.filter = "all";
    /** A departure that was refused: {visit} (its card says why and offers "Depart anyway"). */
    this.refused = null;
    /** Values of the New arrival forms. */
    this.draft = { track: "", wagonType: "sgns60", wagons: 3, load: "random", quay: "", purpose: "pickup", size: "" };
    /** The cross in the middle of the flyover shows where Enter picks (after keys on the stage). */
    this.keyAim = false;
    this._sim = null;
    this.el = null;
    // camera view: a tap on the canvas picks (the flyover routes its own pointer, see flyover.js)
    const c = app.canvas, mine = (fn) => (e) => app.mode !== "flyover" && app.activeTab === "terminal" && fn(e);
    c.addEventListener("pointerdown", mine((e) => {
      this._tap = e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
    }));
    c.addEventListener("pointerup", mine((e) => {
      const t = this._tap;
      this._tap = null;
      if (!t || t.id !== e.pointerId || Math.hypot(e.clientX - t.x, e.clientY - t.y) > TAP_PX) return;
      const r = c.getBoundingClientRect();
      this.pickAt([((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height]);
    }));
    c.addEventListener("pointercancel", () => (this._tap = null));
  }

  /** The layout's container terminal, or null. @returns {import("../arail/terminal/operations.js").TerminalSimulation | null} */
  get sim() {
    const sim = terminalOf(this.app.world);
    if (sim !== this._sim) {
      // another layout (or the terminal was added): nothing of the old one stays selected
      this._sim = sim;
      this.selected = null;
      this.stage = null;
      this.error = "";
      this.refused = null;
      this.renderPlacing();
    }
    return sim;
  }

  get world() {
    return this.app.world;
  }

  /* ---------------------------------------------------------------- panel */

  /**
   * Draw the panel anew (a control that had the focus gets it back).
   * @param {HTMLElement} el the Terminal tab panel
   */
  render(el) {
    const focused = el.contains(document.activeElement) ? document.activeElement.id : null;
    this.el = {
      root: el, head: h("div", { class: "section" }), arrivals: h("div", { class: "section" }), add: h("div", { class: "section" }),
      containers: h("div", { class: "section" }), move: h("div", { class: "section term-move" }), jobs: h("div", { class: "section" }),
      wagons: h("div", { class: "section" }),
    };
    const e = this.el;
    mount(el, e.head, e.arrivals, e.add, e.containers, e.move, e.jobs, e.wagons);
    this.update();
    // a control that is gone (e.g. "Add a container terminal") hands the focus to the panel's heading
    if (focused) (document.getElementById(focused) || e.head.querySelector("h2"))?.focus();
  }

  /** Refresh the panel in place (every 400 ms while it is shown, and after every action). */
  update() {
    const e = this.el;
    if (!e?.root.isConnected) return;
    const sim = this.sim;
    if (sim && this.selected && !sim.inventory.get(this.selected)) {
      // it left the terminal (on a truck, or with its place)
      this.selected = this.stage = null;
      this.renderPlacing();
    }
    // a control that is replaced (e.g. Move, once the move is queued) hands the focus on; one on an
    // arrival card to its card (or the next one)
    const active = document.activeElement, inside = e.root.contains(active);
    const card = inside ? active.closest(".stop[data-id]")?.dataset.id : null;
    const cards = card ? [...e.arrivals.querySelectorAll(".stop[data-id]")].map((x) => x.dataset.id) : null;
    if (!sim) {
      this._show(e.head, this._noTerminal());
      for (const k of ["arrivals", "add", "containers", "move", "jobs", "wagons"]) this._show(e[k]);
    } else {
      const targets = this.selected ? sim.targets(this.selected) : null;
      this.syncHighlight(targets);
      this._show(e.head, this._head(sim));
      this._show(e.arrivals, this._arrivals(sim));
      this._show(e.add, this._newArrival(sim));
      this._show(e.containers, this._containers(sim));
      this._show(e.move, this.selected ? this._move(sim, targets) : null);
      this._show(e.jobs, this._jobs(sim));
      this._show(e.wagons, sim.rollingConfig() ? this._wagons(sim) : null);
    }
    if (card && (!active.isConnected || active.closest(".stop[data-id]")?.dataset.id !== card)) this._focusCard(cards, card);
    else if (inside && !active.isConnected) {
      const next = (active.id && document.getElementById(active.id)) || $("#termMoveCancel") || this._listButton(this.selected ?? this._previous) || $("#termFilter");
      next?.focus({ preventScroll: true });
    }
  }

  /**
   * Focus the first button of an arrival card: of `id`, else of the next card (in the order `ids` had),
   * else of the previous one, else the Arrivals heading (e.g. after Depart, while the card has no buttons).
   */
  _focusCard(ids, id) {
    const at = ids.indexOf(id), box = this.el.arrivals;
    for (const x of [id, ...ids.slice(at + 1), ...ids.slice(0, at).reverse()]) {
      const b = box.querySelector(`.stop[data-id="${CSS.escape(x)}"] button`);
      if (b) return b.focus();
    }
    box.querySelector("h2")?.focus();
  }

  /** The button of a container in the list (null if it is not listed). */
  _listButton(id) {
    return id ? document.getElementById(listId(id)) : null;
  }

  /** Morph a section box; an empty one is hidden. */
  _show(box, content = null) {
    const parts = [content].flat(Infinity).filter((c) => c != null && c !== false);
    box.hidden = !parts.length;
    morph(box, parts);
  }

  _noTerminal() {
    const app = this.app;
    return [
      h("h2", { tabindex: "-1" }, "Container terminal"),
      h("p", { class: "hint" }, "This layout has no container terminal."),
      h("div", { class: "row" },
        h("button", { class: "btn primary", type: "button", id: "termOpenExample", onclick: () => app.openExample("terminal") }, "Open the example terminal"),
        h("button", { class: "btn", type: "button", id: "termAdd", onclick: () => this.addTerminal() }, "Add a container terminal to this layout"),
      ),
      h("p", { class: "hint" }, "A terminal works with the objects of the group Terminal in Build: container yard blocks, gantry cranes, reach stackers, truck lanes and quays, with ordinary tracks as loading tracks."),
    ];
  }

  /** "Add a container terminal to this layout": a terminal entry with the default settings. */
  async addTerminal() {
    const app = this.app, json = this.world.toJSON();
    json.simulations = [...(json.simulations || []), { type: "terminal" }];
    try {
      await app._applyLayout(json);
    } catch (err) {
      toast(`The terminal could not be added: ${err.message}`, 7000);
      return;
    }
    app.saveLayout();
    toast("Container terminal added. Build → Terminal has its yard blocks, cranes, truck lanes and quays.", 7000);
  }

  _head(sim) {
    const w = this.world;
    const open = sim.moves.filter((m) => m.state === "queued" || m.state === "active").length;
    const busy = [...sim.handlers.values()].map((x) => `${x.name}: ${PHASE_LABELS[x.phase] ?? x.phase}`);
    return [
      h("h2", { tabindex: "-1" }, sim.name),
      h("p", { class: "term-status", id: "termStatus" }, [plural(open, "move"), ...busy].join(" · ")),
      h("div", { class: "row" },
        h("div", { class: "seg", role: "group", "aria-label": "Speed" },
          SPEEDS.map((s) => h("button", { type: "button", "aria-pressed": w.speed === s ? "true" : "false", onclick: () => { w.speed = s; this.app.panels.updateSimulateControls(); this.update(); } }, `${s}×`))),
        h("button", { class: "btn small", type: "button", id: "termReset", onclick: () => this.resetTerminal() }, "Reset terminal"),
        h("button", { class: "btn small", type: "button", id: "termSave", onclick: () => this.saveStart() }, "Save as start state"),
      ),
    ];
  }

  /** Reset the terminal to its start state; a pick and the selection end. */
  resetTerminal() {
    const sim = this.sim;
    if (!sim) return;
    this.cancelPick();
    this.select(null);
    this.refused = null;
    sim.reset();
    this.update();
    toast("Terminal reset to its start state.");
  }

  /** Save where the containers are now as the terminal's start state, in the layout stored in this browser. */
  saveStart() {
    const sim = this.sim;
    if (!sim) return;
    sim.saveStart();
    this.app.saveLayout();
    const n = sim.config.containers?.length ?? 0;
    toast(`Start state saved: ${plural(n, "container")} where they are now. Build → Reset to original restores the file.`, 6000);
  }

  /* ---------------------------------------------------------------- arrivals */

  _arrivals(sim) {
    const visits = [...sim.visits.values()];
    return [
      h("h2", { tabindex: "-1" }, "Arrivals"),
      visits.length
        ? h("div", { class: "board term-board", "aria-live": "off" }, visits.map((v) => this._visitCard(sim, v)))
        : h("p", { class: "hint" }, "No trains, barges or trucks yet. Call one below."),
    ];
  }

  _visitCard(sim, v) {
    const inv = sim.inventory;
    const used = v.carriers.reduce((n, c) => n + inv.usedTeu(c.id), 0), cap = v.carriers.reduce((n, c) => n + inv.capacityTeu(c.id), 0);
    // a refused departure is shown (with its current reason) until the visit leaves or has no moves left
    const moves = this._movesOf(sim, v);
    if (this.refused?.visit === v.id && (v.state === "away" || v.state === "departing" || v.leaveWhenDone || !moves.length)) this.refused = null;
    const refused = this.refused?.visit === v.id ? this._refusal(v, moves) : null;
    const btn = (label, fn) => h("button", { class: "btn", type: "button", onclick: fn }, label);
    const calls = [];
    if (v.state === "away") calls.push(btn("Call", () => this._act(sim.call(v.id))));
    else if (v.state !== "departing" && !v.leaveWhenDone) calls.push(btn("Depart", () => this.depart(v.id)));
    if (refused) calls.push(btn("Depart anyway", () => this.depart(v.id, true)));
    if (v.kind !== "truck" && v.state === "positioned" && !v.leaveWhenDone) {
      calls.push(btn("Unload to yard", () => this.bulk(sim.unload(v.id, { to: "yard" }))));
      calls.push(btn("Load from yard", () => this.bulk(sim.load(v.id, { from: "yard" }))));
    }
    const icon = h("div", { class: `num term-icon ${v.kind}` });
    icon.innerHTML = ICONS[v.kind] || "";
    const figures = [`${used} of ${cap} TEU`];
    if (v.kind === "train") figures.unshift(plural(v.carriers.length, "wagon"));
    if (v.kind === "truck") figures.unshift(v.purpose === "delivery" ? "delivery" : "pickup");
    return h("div", { class: "stop", "data-id": v.id },
      icon,
      h("div", { class: "title" }, v.name),
      h("div", { class: "figures" }, figures.map((f) => h("span", {}, f))),
      h("div", { class: "meter" }, h("i", { class: "teu", style: { width: `${cap ? Math.round((100 * used) / cap) : 0}%` } })),
      h("div", { class: `status${refused ? " warn" : ""}` }, refused || this._stateText(v)),
      calls.length ? h("div", { class: "calls" }, calls) : null,
    );
  }

  /** Where a visit is, in words ("at Loading track 1", "at the gate", "at position 2", …). */
  _stateText(v) {
    if (v.leaveWhenDone) return "leaving once the crane is done";
    const where = this.world.getObject(v.where)?.name || v.where;
    if (v.kind === "truck") {
      return { waiting: "at the gate", approaching: `coming to position ${v.position + 1}`, positioned: `at position ${v.position + 1}`, departing: "leaving" }[v.state] || v.state;
    }
    if (v.kind === "barge") return { away: "away", approaching: `approaching ${where}`, positioned: "at the quay", departing: "leaving" }[v.state] || v.state;
    return { away: "away", approaching: `approaching ${where}`, positioned: `at ${where}`, departing: "departing" }[v.state] || v.state;
  }

  /** The visit's queued and active moves. */
  _movesOf(sim, v) {
    const ids = new Set(v.carriers.map((c) => c.id));
    return sim.moves.filter((m) => (m.state === "queued" || m.state === "active") && (ids.has(m.from.carrier) || ids.has(m.to.carrier)));
  }

  /** Why a visit with these moves cannot leave now (as the simulation says it, with today's numbers). */
  _refusal(v, moves) {
    const waiting = moves.filter((m) => m.state === "queued").length;
    if (waiting === moves.length) return `${v.name} still has ${plural(waiting, "move")}`;
    return `A crane is working on ${v.name}${waiting ? `; ${plural(waiting, "more move")} waiting` : ""}`;
  }

  /**
   * A visit leaves (with `force`, its queued moves are cancelled and, while a crane works on it, it leaves
   * once the crane is done). A refusal is toasted; its card keeps it, offering "Depart anyway".
   */
  depart(visitId, force = false) {
    const sim = this.sim, why = sim?.depart(visitId, { force }), v = sim?.visits.get(visitId);
    this.refused = why && v ? { visit: visitId } : null;
    if (why) toast(why);
    else if (v?.leaveWhenDone) toast(`${v.name} leaves once the crane is done; its waiting moves are cancelled.`, 6000);
    this.update();
  }

  /** Toast the reason of a refusal (null: done). */
  _act(reason) {
    if (reason) toast(reason);
    this.update();
  }

  /** "Unload to yard" and "Load from yard": what was queued, and what not. */
  bulk({ moves, refused }) {
    const n = moves.length, k = refused.length;
    if (!n) toast(k ? `No moves queued: ${refused[0].reason}` : "Nothing to move.", 6000);
    else toast(`${plural(n, "move")} queued${k ? `; ${plural(k, "container")} ${k === 1 ? "is" : "are"} blocked` : ""}.`, 6000);
    this.update();
  }

  /* ---------------------------------------------------------------- new arrivals */

  _newArrival(sim) {
    const d = this.draft, w = this.world;
    const tracks = w.objects.filter((o) => o.type === "track" && o.geometry);
    const quays = w.objects.filter((o) => o.type === "quay" && o.geometry);
    const lane = w.objects.some((o) => o.type === "truck-lane" && o.geometry);
    if (!tracks.some((o) => o.id === d.track)) d.track = tracks[0]?.id ?? "";
    if (!quays.some((o) => o.id === d.quay)) d.quay = quays[0]?.id ?? "";
    const select = (id, label, key, options) => h("label", { class: "field", for: id }, h("span", {}, label),
      h("select", { id, onchange: (e) => { d[key] = key === "wagons" ? Number(e.target.value) : e.target.value; } },
        options.map(([v, t]) => h("option", { value: v, selected: String(d[key]) === String(v) }, t))));
    const wagonTypes = Object.entries(CARRIER_TYPES).filter(([, t]) => t.kind === "wagon").map(([k, t]) => [k, t.label]);
    return [
      h("h2", {}, "New arrival"),
      h("div", { class: "term-form" },
        h("h3", {}, "Train"),
        tracks.length ? [
          h("div", { class: "fields" },
            select("termTrack", "Track", "track", tracks.map((o) => [o.id, o.name])),
            select("termWagonType", "Wagons", "wagonType", wagonTypes),
            select("termWagonCount", "Number of wagons", "wagons", [1, 2, 3, 4, 5, 6].map((n) => [n, String(n)])),
            select("termLoad", "Load", "load", [["empty", "empty"], ["random", "random load"]]),
          ),
          h("div", { class: "row" }, h("button", { class: "btn small", type: "button", id: "termCallTrain", onclick: () => this._added(sim.addTrain({ track: d.track, wagons: Array(d.wagons).fill(d.wagonType), load: d.load })) }, "Call train")),
        ] : h("p", { class: "hint" }, "No track on this layout: add one in Build → Infrastructure → Track."),
      ),
      h("div", { class: "term-form" },
        h("h3", {}, "Barge"),
        quays.length ? h("div", { class: "row" },
          h("div", { class: "fields grow" }, select("termQuay", "Quay", "quay", quays.map((o) => [o.id, o.name]))),
          h("button", { class: "btn small", type: "button", id: "termCallBarge", onclick: () => this._added(sim.addBarge({ quay: d.quay })) }, "Call barge"),
        ) : h("p", { class: "hint" }, "No quay on this layout: add one in Build → Terminal."),
      ),
      h("div", { class: "term-form" },
        h("h3", {}, "Truck"),
        lane ? [
          h("div", { class: "fields" },
            select("termTruckPurpose", "Purpose", "purpose", [["pickup", "pickup"], ["delivery", "delivery"]]),
            select("termTruckSize", "Container", "size", [["", "any size"], ["20", "20 ft"], ["40", "40 ft"], ["45", "45 ft"]]),
          ),
          h("div", { class: "row" }, h("button", { class: "btn small", type: "button", id: "termSendTruck", onclick: () => this._added(sim.sendTruck({ purpose: d.purpose, size: d.size || null })) }, "Send truck")),
        ] : h("p", { class: "hint" }, "No truck lane on this layout: add one in Build → Terminal."),
      ),
    ];
  }

  _added(result) {
    if (result.error) toast(result.error);
    else {
      const v = result.visit;
      toast(v.kind === "truck" ? `${v.name} is on its way (${v.purpose}).` : `${v.name} called.`, 3000);
    }
    this.update();
  }

  /* ---------------------------------------------------------------- containers */

  _containers(sim) {
    const test = (FILTERS.find((f) => f[0] === this.filter) || FILTERS[0])[2];
    const groups = [];
    for (const c of sim.carriers()) {
      // what is here (model wagons out of view keep their containers: listed too)
      if (!test(c) || !(c.present || c.number != null)) continue;
      const boxes = sim.inventory.on(c.id);
      if (boxes.length) groups.push([c, boxes]);
    }
    const n = groups.reduce((s, [, b]) => s + b.length, 0);
    const list = h("div", { class: "term-list", id: "termList" },
      groups.length ? groups.map(([c, boxes]) => [
        h("h3", {}, c.label, c.present ? null : h("span", { class: "meta" }, " · not visible")),
        h("ul", { class: "list" }, boxes.map((box) => h("li", {}, h("button", {
          type: "button", id: listId(box.id), "aria-current": box.id === this.selected ? "true" : "false",
          onclick: () => this.select(box.id === this.selected ? null : box.id),
        }, h("span", {}, box.id), h("span", { class: "meta" }, this._boxText(c, box)))))),
      ]) : h("p", { class: "hint" }, "No containers here."));
    return [
      h("h2", {}, "Containers ", h("span", { class: "count" }, `(${n})`)),
      h("div", { class: "fields" },
        h("label", { class: "field", for: "termFilter" }, h("span", {}, "Show"),
          h("select", { id: "termFilter", onchange: (e) => { this.filter = e.target.value; this.update(); } },
            FILTERS.map(([v, t]) => h("option", { value: v, selected: v === this.filter }, t))))),
      list,
      h("p", { class: "hint" }, "Choose a container, or tap one on the layout; then tap a highlighted place or choose one under Move."),
    ];
  }

  /** "40 ft HC · bay 1–2 · row 2 · tier 1" */
  _boxText(carrier, box) {
    const at = box.at, bays = box.bays === 2 ? `bay ${at.bay + 1}–${at.bay + 2}` : `bay ${at.bay + 1}`;
    const parts = [`${box.size} ft${box.high ? " HC" : ""}`, bays];
    if (carrier.rows > 1) parts.push(`row ${(at.row ?? 0) + 1}`);
    if (carrier.tiers > 1) parts.push(`tier ${(at.tier ?? 0) + 1}`);
    return parts.join(" · ");
  }

  /**
   * Select a container (null: none). A pick on the canvas in progress ends.
   * @param {string | null} id
   */
  select(id) {
    if (id !== this.selected) {
      this.stage = null;
      this.error = "";
      this.targetKey = null;
      this.renderPlacing();
      if (this.selected) this._previous = this.selected; // its list button takes the focus from a closed Move form
    }
    this.selected = id;
    this.syncHighlight();
    if (this.el) this.update();
    if (id) this._scrollListTo(id);
  }

  /** Scroll the container list (only the list, not the page) to a container. */
  _scrollListTo(id) {
    const list = document.getElementById("termList"), b = list && this._listButton(id);
    if (!b) return;
    const top = b.offsetTop - list.offsetTop, bottom = top + b.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top - 24;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 8;
  }

  /* ---------------------------------------------------------------- move */

  _move(sim, targets) {
    const c = sim.inventory.get(this.selected);
    if (!c) return null;
    const ok = targets?.ok || [], refused = targets?.refused || [];
    const where = c.at ? sim.describe(c.at) : c.handler ? `on ${sim.handlers.get(c.handler)?.name ?? c.handler}` : "";
    const lift = !ok.length && refused.length === 1 && refused[0].label === c.id ? refused[0].reason : null;
    if (!ok.some((t) => slotKey(t.at) === this.targetKey)) this.targetKey = ok[0] ? slotKey(ok[0].at) : null;
    const groups = new Map();
    for (const t of ok) {
      if (!groups.has(t.carrier)) groups.set(t.carrier, []);
      groups.get(t.carrier).push(t);
    }
    const kinds = new Set(ok.map((t) => t.kind));
    const head = [
      h("h2", {}, `Move ${c.id}`),
      h("p", { class: "hint" }, `${c.size} ft${c.high ? " high cube" : ""}${where ? ` · ${where}` : ""}`),
    ];
    const done = h("button", { class: "btn small", type: "button", id: "termMoveCancel", onclick: () => this.select(null) }, "Done");
    const job = c.move ? sim.moves.find((m) => m.id === c.move) : null;
    if (job) {
      // on its way: what its crane or reach stacker is doing
      const hd = sim.handlers.get(job.handler), cancellable = job.state === "queued" || (hd?.move === job.id && hd.cancellable);
      return [...head,
        h("p", { class: "term-job" }, `Move ${job.id} to ${sim.describe(job.to)} by ${hd?.name ?? job.handler}: ${this._jobState(job, hd)}`),
        h("div", { class: "row" }, cancellable ? h("button", { class: "btn small", type: "button", id: "termJobCancel", onclick: () => this._act(sim.cancel(job.id)) }, `Cancel ${job.id}`) : null, done)];
    }
    const status = h("p", { class: "hint error", role: "status", id: "termMoveError" }, this.error || lift || "");
    if (lift) return [...head, status, h("div", { class: "row" }, done)];
    return [
      ...head,
      h("label", { class: "field", for: "termTarget" }, h("span", {}, "Move to"),
        h("select", { id: "termTarget", onchange: (e) => { this.targetKey = e.target.value; this.error = ""; } },
          [...groups].map(([id, list]) => h("optgroup", { label: sim.carrier(id)?.label ?? id },
            list.map((t) => h("option", { value: slotKey(t.at), selected: slotKey(t.at) === this.targetKey }, t.label)))),
          refused.length ? h("optgroup", { label: "Not possible now" },
            refused.map((r) => h("option", { value: "", disabled: true }, `${r.label} — ${r.reason}`))) : null,
        )),
      h("div", { class: "row", role: "group", "aria-label": "Quick targets" },
        QUICK.map(([kind, label]) => h("button", { class: "btn small", type: "button", disabled: !kinds.has(kind), onclick: () => this.moveTo(this._quick(c, ok, kind)) }, label))),
      h("div", { class: "row" },
        h("button", { class: "btn primary", type: "button", id: "termMove", disabled: !ok.length, onclick: () => this.moveTo(ok.find((t) => slotKey(t.at) === this.targetKey)) }, "Move"),
        h("button", { class: "btn", type: "button", id: "termPick", disabled: !ok.length, "aria-pressed": this.stage === "target" ? "true" : "false", onclick: () => (this.stage ? this.cancelPick() : this.startPick()) }, "Pick on the layout"),
        h("button", { class: "btn", type: "button", id: "termMoveCancel", onclick: () => this.select(null) }, "Cancel"),
      ),
      status,
    ];
  }

  /** First target of a kind, on another carrier than the container's own if there is one. */
  _quick(c, ok, kind) {
    const list = ok.filter((t) => t.kind === kind);
    return list.find((t) => t.carrier !== c.at?.carrier) || list[0];
  }

  /**
   * Queue the move of the selected container to a target; the result is toasted.
   * @param {import("../arail/terminal/types.js").Target | {at: object} | null} target
   * @returns {boolean} true if the move was queued
   */
  moveTo(target) {
    if (!target) {
      this.error = "Choose a place first.";
      this.update();
      return false;
    }
    return this._request(target.at);
  }

  /** Request a move of the selected container to `to` (slot, {carrier} or {kind}). */
  _request(to) {
    const sim = this.sim;
    if (!sim || !this.selected) return false;
    const r = sim.request(this.selected, to);
    if (r.error) {
      this.error = r.error;
      toast(r.error);
      this.update();
      return false;
    }
    const m = r.move;
    this.error = "";
    this.stage = null;
    this.renderPlacing();
    toast(`Move ${m.id} queued: ${sim.handlers.get(m.handler)?.name ?? m.handler}, from ${sim.describe(m.from)} to ${sim.describe(m.to)}`, 6000);
    this.update();
    return true;
  }

  /* ---------------------------------------------------------------- crane jobs */

  _jobs(sim) {
    const moves = sim.moves.slice(-JOBS_SHOWN);
    return [
      h("h2", {}, "Crane jobs ", h("span", { class: "count" }, sim.moves.length ? `(${sim.moves.length})` : "")),
      moves.length ? h("div", { class: "table-wrap" }, h("table", { class: "term-jobs" },
        h("thead", {}, h("tr", {}, ["#", "Container", "From → To", "By", "State", h("span", { class: "visually-hidden" }, "Action")].map((t) => h("th", {}, t)))),
        h("tbody", {}, moves.map((m) => {
          const hd = sim.handlers.get(m.handler);
          const cancellable = m.state === "queued" || (m.state === "active" && hd?.move === m.id && hd.cancellable);
          return h("tr", { "data-state": m.state },
            h("td", { class: "mono" }, m.id),
            h("td", {}, m.container),
            h("td", { class: "route" }, h("span", {}, sim.describe(m.from)), h("span", {}, `→ ${sim.describe(m.to)}`)),
            h("td", {}, hd?.name ?? m.handler),
            h("td", { class: `state ${m.state}` }, this._jobState(m, hd)),
            h("td", {}, cancellable ? h("button", { class: "btn small", type: "button", "aria-label": `Cancel ${m.id}`, onclick: () => this._act(sim.cancel(m.id)) }, "Cancel") : null),
          );
        })),
      )) : h("p", { class: "hint" }, "No crane jobs yet."),
    ];
  }

  _jobState(m, hd) {
    if (m.state === "queued") return m.waiting || "queued";
    if (m.state === "active") return m.waiting || (hd?.move === m.id && PHASE_LABELS[hd.phase]) || "active";
    if (m.state === "failed") return `failed: ${m.reason}`;
    return m.state;
  }

  /* ---------------------------------------------------------------- model wagons */

  _wagons(sim) {
    const stride = sim.rollingConfig()?.stride ?? 4, wagons = sim.markerWagons();
    return [
      h("h2", {}, "Model wagons"),
      wagons.length ? h("div", { class: "table-wrap" }, h("table", { class: "term-wagons" },
        h("thead", {}, h("tr", {}, ["Wagon", "Type", "Tags seen", "State", "Containers"].map((t) => h("th", {}, t)))),
        h("tbody", {}, wagons.map((c) => {
          const t = sim.rolling?.wagons.get(c.number);
          return h("tr", {}, h("td", {}, c.label), h("td", {}, c.type?.label ?? ""), h("td", {}, `${t ? t.tags.length : 0}/${Math.min(c.bays, stride)}`),
            h("td", {}, t?.state ?? "not seen"), h("td", {}, String(sim.inventory.on(c.id).length)));
        })))) : h("p", { class: "hint" }, "No model wagons seen yet. Show the camera a wagon with its deck card."),
      h("p", { class: "hint" }, "Model wagons are recognised by the tags of their deck cards. ", ...this._deckLinks(sim)),
    ];
  }

  /**
   * Links to the deck cards of the configured model wagons, one per wagon type (a print holds one
   * type), with the layout's stride, tag size and scale.
   */
  _deckLinks(sim) {
    const r = sim.rollingConfig(), def = deckType(sim.config.default_wagon) ?? "sgns60";
    const stock = (Array.isArray(sim.config.rolling_stock) ? sim.config.rolling_stock : [])
      .filter((w) => w && typeof w === "object" && Number.isInteger(w.number) && w.number >= 1);
    const byType = new Map();
    for (const w of stock) {
      const type = deckType(w.type) ?? def;
      byType.set(type, [...(byType.get(type) || []), w.number]);
    }
    // no rolling_stock: the wagons known so far, all of the default type
    if (!byType.size) {
      const known = sim.markerWagons().map((c) => c.number);
      byType.set(def, known.length ? known : [1]);
    }
    const link = ([type, numbers], label) => {
      const q = new URLSearchParams({ kind: "rolling", type, wagons: numberList(numbers), stride: r.stride, size: r.size_mm, scale: sim.world.scale });
      return h("a", { href: `../markers/?${q}`, target: "_blank", rel: "noopener" }, label);
    };
    if (byType.size === 1) return [link([...byType][0], "Print deck cards"), "."];
    const out = ["Print deck cards: "];
    [...byType].forEach((entry, i) => {
      if (i) out.push(" · ");
      out.push(link(entry, `${CARRIER_TYPES[entry[0]].label.replace(/ \(.*\)$/, "")} ${numberList(entry[1], "W")}`));
    });
    return [...out, "."];
  }

  /* ---------------------------------------------------------------- canvas picking */

  /**
   * What the simulation highlights: the selected container, its targets while picking, the yard slots.
   * @param {{ok: object[]} | null} [targets] the selected container's targets, if they are known already
   */
  syncHighlight(targets = null) {
    const sim = this.sim;
    if (!sim) return;
    const here = this.app.activeTab === "terminal";
    const selected = here && this.selected && sim.inventory.get(this.selected) ? this.selected : null;
    const picking = selected && this.stage === "target";
    sim.highlight = { selected, targets: picking ? (targets ?? sim.targets(selected)).ok : null, slots: here };
  }

  /** Start picking the place for the selected container on the canvas. */
  startPick() {
    if (!this.sim || !this.selected) return;
    this.stage = "target";
    this.renderPlacing();
    this.update();
  }

  /**
   * Pick at a canvas pixel: a container (to select it), or the place for the selected one.
   * @param {number[]} p [u, v] canvas px
   * @param {{keyboard?: boolean}} [options] keyboard: Enter at the cross in the middle of the flyover
   * @returns {boolean} true if something was picked
   */
  pickAt([u, v], { keyboard = false } = {}) {
    const sim = this.sim, view = this.app.lastView;
    if (!sim) return false;
    if (!view) {
      toast("The layout is not tracked yet. Show the markers to the camera first.");
      return false;
    }
    if (this.stage !== "target" || !this.selected) {
      const id = pickBoxes(view, sim.boxes(view), u, v);
      if (!id) {
        if (keyboard) toast("No container at the cross: move the view with the arrow keys.");
        else if (this.selected) this.select(null);
        return false;
      }
      const reason = sim.inventory.canLift(sim.inventory.get(id));
      this.select(id);
      if (reason) {
        toast(reason);
        return true;
      }
      this.startPick();
      return true;
    }
    // 1. a highlighted place; 2. a container (the free place on its carrier); 3. a carrier on the ground
    const hit = pickBoxes(view, sim.targetBoxes(this.selected, view).map((t) => t.box), u, v);
    if (hit) {
      const t = sim.targetBoxes(this.selected, view).find((x) => x.box.id === hit);
      if (t) return this._request(t.target.at);
    }
    const box = pickBoxes(view, sim.boxes(view), u, v);
    if (box === this.selected) {
      this.cancelPick();
      return true;
    }
    if (box) {
      const at = sim.inventory.get(box)?.at;
      if (at) return this._request({ carrier: at.carrier });
    }
    const g = this._groundPoint(u, v), carrier = g && sim.carrierAt(g, view);
    if (carrier) return this._request({ carrier });
    toast(keyboard ? "Nothing at the cross: move the view to a highlighted place with the arrow keys, or choose one in the panel." : "Tap a highlighted place, or choose one in the panel.");
    return false;
  }

  /** Layout point (z = 0) under a canvas pixel, or null. */
  _groundPoint(u, v) {
    const app = this.app;
    if (app.flyover.active) return app.flyover.groundPoint(u, v);
    const Hinv = app.tracker.state.Hinv;
    const p = Hinv ? applyH(Hinv, [u, v]) : null;
    return p && p.every(Number.isFinite) ? p : null;
  }

  /**
   * End a pick on the canvas (Escape, the Cancel button, leaving the tab).
   * @returns {boolean} true if a pick was cancelled
   */
  cancelPick() {
    if (!this.stage) return false;
    this.stage = null;
    this.renderPlacing();
    this.syncHighlight();
    if (this.el) this.update();
    return true;
  }

  /** The placing bar over the stage while a place is picked (the editor's while it places). */
  renderPlacing() {
    const app = this.app, bar = $("#placing");
    if (!bar || app.editor?.placing) return;
    const c = this.stage === "target" && this.selected ? this._sim?.inventory.get(this.selected) : null;
    if (!c) {
      if (bar.dataset.owner === "terminal") {
        bar.hidden = true;
        delete bar.dataset.owner;
      }
      return;
    }
    const keys = app.mode === "flyover" ? " Keyboard: Enter picks at the cross in the middle." : "";
    mount(bar,
      h("span", { class: "grow" }, h("strong", {}, `Move ${c.id} (${c.size} ft):`), " tap a highlighted place, or choose one in the panel.",
        keys ? h("span", { class: "keys" }, keys) : null),
      h("button", { class: "btn small", type: "button", onclick: () => this.cancelPick() }, "Cancel"),
    );
    bar.dataset.owner = "terminal";
    bar.hidden = false;
  }

  /**
   * The aim cross in the middle of the flyover while the stage has the keyboard (in the Terminal tab).
   * @param {CanvasRenderingContext2D} ctx
   * @param {import("../arail/core/view.js").View} view
   */
  drawOverlay(ctx, view) {
    const app = this.app, c = app.canvas;
    if (app.activeTab !== "terminal" || !app.flyover.active || document.activeElement !== c || !this.keyAim) return;
    const px = view.px, x = c.width / 2, y = c.height / 2, r = 11 * px;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineCap = "round";
    for (const [colour, w] of [["rgba(255,255,255,0.9)", 5], [OVERLAY.selection, 2.5]]) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = w * px;
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x - 4 * px, y);
      ctx.moveTo(x + 4 * px, y);
      ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r);
      ctx.lineTo(x, y - 4 * px);
      ctx.moveTo(x, y + 4 * px);
      ctx.lineTo(x, y + r);
      ctx.stroke();
    }
    ctx.font = `700 ${11 * px}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const text = this.stage === "target" ? "Enter: move here" : "Enter: pick";
    const w = ctx.measureText(text).width + 10 * px;
    ctx.fillStyle = OVERLAY.label;
    ctx.fillRect(x - w / 2, y + r + 5 * px, w, 17 * px);
    ctx.fillStyle = OVERLAY.labelText;
    ctx.fillText(text, x, y + r + 8 * px);
    ctx.restore();
  }
}
