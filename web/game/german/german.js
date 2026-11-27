// German mode (game/german/): an endless game, in the signal box of Bf Neustadt or at the crane of the
// container terminal. The load rises until nothing moves; what counts is how much got through, and the
// best of it is kept in the browser. The games are arail/game/german.js; this page draws one of them as
// SVG (a view per place: SignalBox, Terminal), passes the player's moves to it (by `act`) and runs it at
// the game's pace. ?game=signaller|terminal chooses the place, ?seed= what comes (else every game anew).
import { GERMAN_GAMES, STACKS, STATION, TIERS, WAGONS, clockOf, germanPlaceAt as placeAt } from "../../arail/game/index.js";
import { $, h, mount, storage } from "../../app/ui.js";

const NS = "http://www.w3.org/2000/svg";
/** What the browser keeps: the best score of each place. */
export const BEST_KEY = "arail.german.best";

/** An SVG element. */
function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/** A group of the picture that is a button: a click, Enter or the space bar. */
function button(attrs, act, ...children) {
  const g = svg("g", { role: "button", tabindex: "0", ...attrs }, ...children);
  g.addEventListener("click", act);
  g.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    act();
  });
  return g;
}

/** Put new children into a layer and keep the focus on the thing it was on (by its `data-id`). */
function refill(layer, children) {
  const focused = layer.contains(document.activeElement) ? document.activeElement.getAttribute("data-id") : null;
  layer.replaceChildren(...children);
  if (focused) [...layer.querySelectorAll("[data-id]")].find((g) => g.getAttribute("data-id") === focused)?.focus();
}

/* ------------------------------------------------------------------------------------------------ the signal box */

/** Panel grid units to SVG px (as on the signaller's page). */
const X = (x) => 30 + x * 40, Y = (y) => y * 70 - 25;

/** The signal box: the panel of Bf Neustadt, a start signal and its destination. */
class SignalBox {
  static id = "signaller";
  static label = "Signal box";
  static points = "Points";
  static hook = "Bf Neustadt by a timetable that gets denser and denser.";
  static intro = "Every train needs a route into its planned track and a route out again: 10 points a train, 5 off on another track, 1 off for every minute late. A train that finds its line occupied waits behind it: with more than three waiting on one line, it is over.";
  static backdrop = ["../../media/ebl-neustadt.jpg", "40% 72%"];
  static viewBox = "0 -32 1180 334";
  static picture = "Track diagram of Bf Neustadt: the line from Bergheim on the left, the platform tracks G1, G2 and G3, the line to Talsee on the right; signals are buttons.";
  static how = [
    ["Click the entry signal ", ["A"], " or ", ["F"], ", then the track the train goes to: its planned track stands on its tag and in the timetable. Trains from Talsee reach G2 and G3 only."],
    ["Click an exit signal (N1 to N3, P2, P3) to let a train out: a regional train stops for 40 seconds and leaves at its time."],
    ["Another track than planned costs 5 of a train's 10 points. A line that fills up costs the game. Which is it worth?"],
    ["Keys: ", ["A"], " or ", ["F"], " then ", ["1"], " to ", ["3"], " lets a train in; ", ["1"], " to ", ["3"], " alone lets the train of that track out."],
    ["The timetable never gets thinner. Played well, a game lasts long: the computer manages half an hour to an hour and a half of its clock."],
  ];

  constructor(page) {
    this.page = page;
    /** The start signal chosen, or null. */
    this.chosen = null;
  }

  /** The panel's fixed parts (their state is set in `draw`). */
  build(desk) {
    this.secEls = {};
    this.legEls = {};
    this.sigEls = {};
    const platforms = svg("g", { "aria-hidden": "true" },
      svg("rect", { class: "platform", x: X(9), y: Y(3) + 14, width: X(17) - X(9), height: 22, rx: 3 }),
      svg("rect", { class: "platform", x: X(11.6), y: Y(1) + 15, width: X(16.4) - X(11.6), height: Y(2) - Y(1) - 30, rx: 3 }));
    const sections = svg("g", { "aria-hidden": "true" });
    for (const [id, s] of Object.entries(STATION.sections)) {
      const legs = s.draw.map(([[x1, y1], [x2, y2]]) => svg("line", { class: "sec", x1: X(x1), y1: Y(y1), x2: X(x2), y2: Y(y2) }));
      this.secEls[id] = legs;
      sections.append(...legs);
      if (s.track) sections.append(svg("text", { x: X((s.draw[0][0][0] + s.draw[0][1][0]) / 2) + (s.track === "G1" ? -120 : -70), y: Y(s.draw[0][0][1]) - 10 }, s.track));
    }
    const labels = svg("g", { "aria-hidden": "true" },
      svg("text", { x: X(0), y: Y(2) - 14 }, `← ${STATION.west}`),
      svg("text", { x: X(28), y: Y(2) - 14, "text-anchor": "end" }, `${STATION.east} →`));
    for (const [id, p] of Object.entries(STATION.points)) this.legEls[id] = { straight: this.secEls[p.section][0], diverging: this.secEls[p.section][1] };
    const signals = svg("g");
    for (const [id, s] of Object.entries(STATION.signals)) {
      const x = X(s.at[0]), y = Y(s.at[1]);
      // the signal stands to the right of its track in the direction of travel: below (east), above (west)
      const side = s.dir > 0 ? 1 : -1, ly = y + side * 22, lx = x - s.dir * 6;
      const g = button({ class: "sig", "data-signal": id }, () => this.choose(id),
        svg("rect", { class: "hit", x: lx - 18, y: ly - 16, width: 36, height: 32 }),
        svg("line", { class: "mast", x1: x - s.dir * 6, y1: y + side * 6, x2: lx, y2: ly - side * 7 }),
        svg("circle", { class: "ring", cx: lx, cy: ly, r: 11, fill: "none" }),
        svg("circle", { class: "lamp stop", cx: lx, cy: ly, r: 7 }),
        svg("text", { x: lx - s.dir * 16, y: ly + 5, "text-anchor": s.dir > 0 ? "end" : "start" }, id));
      this.sigEls[id] = g;
      signals.append(g);
    }
    this.trainLayer = svg("g", { "aria-hidden": "true" });
    this.queueLayer = svg("g", { class: "queue", "aria-hidden": "true" });
    this.destLayer = svg("g");
    desk.replaceChildren(svg("desc", { id: "deskDesc" }, SignalBox.picture), platforms, sections, labels, signals, this.trainLayer, this.queueLayer, this.destLayer);
  }

  draw(st) {
    this.st = st;
    const preview = new Set(this.chosen ? STATION.routes.filter((r) => r.from === this.chosen).flatMap((r) => r.sections) : []);
    for (const [id, legs] of Object.entries(this.secEls)) {
      const s = st.sections[id];
      const cls = `sec${s.occupied ? " occ" : s.route ? " route" : preview.has(id) ? " preview" : ""}`;
      for (const l of legs) l.setAttribute("class", cls);
    }
    for (const [id, p] of Object.entries(st.points)) {
      this.legEls[id].straight.classList.toggle("leg-off", p.pos === "-");
      this.legEls[id].diverging.classList.toggle("leg-off", p.pos === "+");
    }
    for (const [id, g] of Object.entries(this.sigEls)) {
      const a = st.signals[id];
      g.querySelector(".lamp").setAttribute("class", `lamp ${a.aspect}`);
      g.classList.toggle("chosen", this.chosen === id);
      const train = st.trains.find((tr) => tr.next === id);
      g.setAttribute("aria-label", `Signal ${id}: ${a.aspect === "proceed" ? "proceed" : "stop"}${a.route ? `, route ${a.route}` : ""}${train ? `, ${train.id} before it` : ""}`);
      g.setAttribute("aria-pressed", this.chosen === id ? "true" : "false");
    }
    // trains: a tag at the head
    this.trainLayer.replaceChildren(...st.trains.filter((tr) => tr.head).map((tr) => {
      const [[x1, y1], [x2, y2]] = STATION.sections[tr.head.section].draw[0];
      const f = tr.dir > 0 ? tr.head.frac : 1 - tr.head.frac;
      const x = X(x1 + (x2 - x1) * f), y = Y(y1 + (y2 - y1) * f);
      const name = tr.track ? tr.id : `${tr.id} · ${tr.plan}`;
      const label = `${tr.dir > 0 ? "" : "← "}${name}${tr.dir > 0 ? " →" : ""}`, w = label.length * 7.4 + 10, ox = tr.dir > 0 ? -w : 0;
      return svg("g", { class: `train${tr.state === "running" && tr.speed === 0 ? " late" : ""}` },
        svg("rect", { x: x + ox, y: y - 9, width: w, height: 18, rx: 4 }),
        svg("text", { x: x + ox + w / 2, y: y + 4, "text-anchor": "middle" }, label));
    }));
    // who waits before the station: beside the line they come on, the first to come nearest to it
    const queue = [];
    for (const [side, ids] of Object.entries(st.waiting)) {
      const west = side === "west", y0 = Y(west ? 3 : 2) + (west ? 30 : -62);
      ids.forEach((train, i) => {
        const id = `${train} · ${st.timetable.find((x) => x.id === train)?.plan ?? ""}`, w = id.length * 7.4 + 12, x = west ? X(0) : X(28) - w, y = y0 + (west ? i : -i) * 22;
        queue.push(svg("g", { class: "tag" }, svg("rect", { x, y, width: w, height: 18, rx: 4 }), svg("text", { x: x + w / 2, y: y + 13, "text-anchor": "middle" }, id)));
      });
    }
    this.queueLayer.replaceChildren(...queue);
    // the destinations of the start signal chosen
    const routes = this.chosen ? this.page.game.routesFrom(this.chosen) : [];
    const key = `${this.chosen}|${routes.map((r) => `${r.id}${r.blocked ? "x" : ""}`).join()}`;
    if (key !== this.destKey) {
      this.destKey = key;
      refill(this.destLayer, routes.map((r) => {
        const def = STATION.routes.find((x) => x.id === r.id), last = STATION.sections[def.sections.at(-1)];
        const [[x1, y1], [x2, y2]] = last.draw[0];
        const east = STATION.signals[def.from].dir > 0;
        const x = last.line ? X(east ? 26.6 : 1.4) : X((x1 + x2) / 2 + (east ? 1.8 : -1.8)), y = Y(last.line ? y1 : y2) - 22;
        return button({ class: "dest", "data-id": r.id, "aria-label": `To ${r.to}${r.blocked ? `: not now. ${r.blocked}` : ""}`, "aria-disabled": r.blocked ? "true" : null, opacity: r.blocked ? 0.4 : null }, () => this.set(r.id),
          svg("rect", { x: x - 34, y: y - 11, width: 68, height: 22, rx: 11 }),
          svg("text", { x, y: y + 5, "text-anchor": "middle" }, r.to));
      }));
    }
  }

  /** A signal: an exit signal sets its route at once, an entry signal shows its tracks (again: no choice). */
  choose(id) {
    if (!this.page.running) return;
    const routes = this.page.game.routesFrom(id);
    if (routes.length === 1) return this.set(routes[0].id);
    this.chosen = this.chosen === id ? null : id;
    this.page.hint(this.chosen ? `${id}: into which track? (${routes.map((r) => r.to).join(", ")})` : "");
    this.page.draw();
    if (this.chosen && document.activeElement?.closest?.(".sig")) this.destLayer.querySelector(".dest:not([aria-disabled])")?.focus();
  }

  set(routeId) {
    const res = this.page.game.act("setRoute", routeId), def = STATION.routes.find((r) => r.id === routeId);
    this.page.hint(res.ok ? `Route ${def.from} → ${def.to} set.` : res.reason, !res.ok);
    if (res.ok) {
      const from = this.chosen;
      this.chosen = null;
      this.page.draw();
      if (from && this.destLayer.contains(document.activeElement)) this.sigEls[from]?.focus();
    }
  }

  /** A or F: the entry signal; 1 to 3: its track, or without a signal chosen the way out of that track; Escape: no choice. */
  key(e) {
    const k = e.key.toLowerCase();
    if (k === "escape" && this.chosen) this.choose(this.chosen);
    else if (k === "a" || k === "f") this.choose(k.toUpperCase());
    else if (["1", "2", "3"].includes(k)) {
      if (this.chosen) return this.set(`${this.chosen}-G${k}`);
      const tr = this.st?.trains.find((x) => x.next === `N${k}` || x.next === `P${k}`);
      if (tr) this.set(`${tr.next}-${tr.dir > 0 ? "T" : "B"}`);
      else this.page.hint(`No train in G${k}.`, true);
    } else return false;
    return true;
  }

  meters(st) {
    return [
      { label: `Waiting from ${STATION.west}`, n: st.waiting.west.length, max: st.limit },
      { label: `Waiting from ${STATION.east}`, n: st.waiting.east.length, max: st.limit },
    ];
  }

  /** The timetable beside the panel: the next trains with their planned track and their time. */
  side(st) {
    const rows = st.timetable.slice(0, 9), at = (t) => clockOf(t).slice(0, 5);
    return [
      h("h2", { id: "sideTitle" }, "Timetable"),
      h("div", { class: "table-scroll" }, h("table", { class: "game-table" },
        h("thead", {}, h("tr", {}, ["Train", "From", "Track", "Time", "Now"].map((c) => h("th", { scope: "col" }, c)))),
        h("tbody", {}, rows.map((tr) => h("tr", { class: tr.waiting ? "waits" : "" },
          h("th", { scope: "row", translate: "no" }, tr.id),
          h("td", {}, tr.from),
          h("td", {}, tr.track && tr.track !== tr.plan ? h("span", { class: "late" }, `${tr.plan} (in ${tr.track})`) : tr.plan),
          h("td", {}, `${tr.stops ? "dep" : "pass"} ${at(tr.due)}`),
          h("td", { class: tr.late ? "late" : "" }, `${tr.waiting ? "waits before the station" : tr.state === "coming" ? `comes ${at(tr.enter)}` : tr.state === "dwelling" ? `at ${tr.track}` : "running"}${tr.late ? ` · +${tr.late} min` : ""}`)))))),
    ];
  }

  /** A train has left: what it gave. */
  through(e) {
    this.page.hint(`${e.train}: +${e.points}${e.wrong ? ` (in ${e.track}, planned ${e.plan})` : ""}${e.late ? ` (${e.late} min late)` : ""}`, e.wrong || e.late > 0);
  }

  result(points, r) {
    return `${points} points · ${r.through} ${r.through === 1 ? "train" : "trains"} through, ${r.wrong} on another track`;
  }
}

/* ------------------------------------------------------------------------------------------------ the container terminal */

/** The terminal's picture: a position along the runway to px, the ground, a container's size. */
const PX = (pos) => 96 + pos * 86, GROUND = 285, BOX_W = 72, BOX_H = 32, BEAM = 50;
/** The keys of the wagons, from the first. */
const WAGON_KEYS = ["q", "w", "e", "r"];

/** The container terminal: wagons, stacks and trucks under one crane; a container and where it goes. */
class Terminal {
  static id = "terminal";
  static label = "Container terminal";
  static points = "Containers out";
  static hook = "One crane, six stacks: the trains come closer together, and fuller.";
  static intro = "Trains bring containers, and a truck comes for each of them. Unload the train onto the stacks, give every truck its container: a point for each. With more than two trains or five trucks waiting, it is over.";
  static backdrop = ["../../media/ebl-terminal.jpg", "50% 60%"];
  static viewBox = "0 0 1180 330";
  static picture = "The container terminal from the side: the train on the loading track at the left, six stacks of the yard in the middle, the truck lane at the right, the crane above them; containers that can be lifted are buttons.";
  static how = [
    ["Click a container on the train, then the stack it goes to. Only the top container of a stack can be lifted."],
    ["A container a truck waits for is orange: one click sends it to its truck, if nothing lies on it."],
    ["The crane does one move after the other, up to four ahead. Short ways are fast ways."],
    ["Keys: ", ["Q"], ["W"], ["E"], ["R"], " a wagon, ", ["1"], " to ", ["6"], " a stack: first where from, then where to."],
  ];

  constructor(page) {
    this.page = page;
    /** The place whose container is chosen ("W2", "S3"), or null. */
    this.chosen = null;
  }

  build(desk) {
    const zone = (a, b, label) => [
      svg("rect", { class: "zone", x: PX(a) - BOX_W / 2 - 8, y: GROUND + 6, width: PX(b) - PX(a) + BOX_W + 16, height: 24, rx: 4 }),
      svg("text", { class: "muted", x: (PX(a) + PX(b)) / 2, y: GROUND + 23, "text-anchor": "middle" }, label),
    ];
    const fixed = svg("g", { "aria-hidden": "true" },
      svg("line", { class: "ground", x1: 20, y1: GROUND, x2: 1160, y2: GROUND }),
      zone(0, WAGONS - 1, "Loading track"), zone(WAGONS + 0.5, WAGONS + STACKS - 0.5, "Yard"), zone(WAGONS + STACKS + 1, WAGONS + STACKS + 1, "Trucks"),
      Array.from({ length: STACKS }, (_, i) => svg("text", { class: "key", x: PX(placeAt(`S${i + 1}`)), y: GROUND - (BOX_H + 2) * TIERS - 8, "text-anchor": "middle" }, String(i + 1))),
      svg("path", { class: "gantry", d: `M40 ${GROUND} V${BEAM} H1140 V${GROUND}` }));
    this.trainLayer = svg("g");
    this.stackLayer = svg("g");
    this.slotLayer = svg("g");
    this.truckLayer = svg("g", { "aria-hidden": "true" });
    this.queueText = svg("text", { class: "muted", x: 60, y: 28 });
    this.rope = svg("line", { class: "rope" });
    this.trolley = svg("rect", { class: "trolley", y: BEAM - 8, width: 40, height: 16, rx: 3 });
    this.carried = svg("g", { class: "box moving", "aria-hidden": "true" });
    desk.replaceChildren(svg("desc", { id: "deskDesc" }, Terminal.picture), fixed, this.queueText, this.trainLayer, this.stackLayer, this.truckLayer, this.slotLayer,
      svg("g", { "aria-hidden": "true" }, this.rope, this.trolley, this.carried));
  }

  /** A container as it is drawn; one that can be lifted is a button. */
  box(b, place, x, y, liftable, tier) {
    const cls = `box${b.wanted ? " wanted" : ""}${b.moving ? " moving" : ""}${liftable ? "" : " covered"}${liftable && this.chosen === place ? " chosen" : ""}`;
    const shape = [svg("rect", { x: x - BOX_W / 2, y, width: BOX_W, height: BOX_H, rx: 3 }), svg("text", { x, y: y + 21, "text-anchor": "middle" }, b.wanted ? `${b.id} → ${b.wanted}` : b.id)];
    if (!liftable) return svg("g", { class: cls, "aria-hidden": "true" }, shape);
    const where = place[0] === "W" ? `on wagon ${place.slice(1)}` : `on top of stack ${place.slice(1)}`;
    return button({ class: cls, "data-id": `${place}:${tier}`, "aria-pressed": this.chosen === place ? "true" : "false", "aria-label": `Container ${b.id} ${where}${b.wanted ? `: truck ${b.wanted} waits for it` : ""}` }, () => this.pick(place), shape);
  }

  draw(st) {
    this.st = st;
    const g = this.page.game;
    if (this.chosen && !g.top(this.chosen)) this.chosen = null;
    // the train rolls in from the left and out again
    const tr = st.train, off = tr ? (tr.state === "in" ? (1 - tr.f) * -520 : tr.state === "out" ? tr.f * -520 : 0) : 0;
    this.trainLayer.setAttribute("transform", `translate(${off} 0)`);
    this.queueText.textContent = st.queue.length ? `Waiting before the terminal: ${st.queue.join(", ")}` : "";
    // what is drawn anew only when it changes: a click needs its element to stay
    const key = JSON.stringify([st.stacks, st.wagons, tr?.id, tr?.state, st.trucks, this.chosen, st.jobs.length]);
    if (key !== this.drawn) {
      this.drawn = key;
      const lift = (place) => g.top(place);
      refill(this.trainLayer, tr ? [
        svg("g", { "aria-hidden": "true" },
          svg("line", { class: "rail", x1: PX(0) - 60, y1: GROUND - 4, x2: PX(WAGONS - 1) + 60, y2: GROUND - 4, opacity: 0 }),
          svg("text", { class: "muted", x: PX(0) - BOX_W / 2, y: GROUND - 62 }, tr.id),
          Array.from({ length: WAGONS }, (_, i) => svg("rect", { class: "wagon", x: PX(i) - BOX_W / 2 - 4, y: GROUND - 12, width: BOX_W + 8, height: 10, rx: 2 })),
          Array.from({ length: WAGONS }, (_, i) => svg("text", { class: "key", x: PX(i), y: GROUND - 50, "text-anchor": "middle" }, WAGON_KEYS[i].toUpperCase()))),
        ...st.wagons.map((b, i) => (b ? this.box(b, `W${i + 1}`, PX(i), GROUND - 12 - BOX_H, lift(`W${i + 1}`) === b.id, 0) : null)).filter(Boolean),
      ] : []);
      refill(this.stackLayer, st.stacks.flatMap((s, i) => s.map((b, k) => this.box(b, `S${i + 1}`, PX(placeAt(`S${i + 1}`)), GROUND - (BOX_H + 2) * (k + 1), k === s.length - 1 && lift(`S${i + 1}`) === b.id, k))));
      // where the container chosen can go: the stacks with room
      refill(this.slotLayer, this.chosen ? Array.from({ length: STACKS }, (_, i) => {
        const to = `S${i + 1}`, n = g.plan.stacks[i].length;
        if (g.blocked(this.chosen, to)) return null;
        return button({ class: "slot", "data-id": to, "aria-label": `Onto stack ${i + 1}` }, () => this.put(to),
          svg("rect", { x: PX(placeAt(to)) - BOX_W / 2, y: GROUND - (BOX_H + 2) * (n + 1), width: BOX_W, height: BOX_H, rx: 3 }),
          svg("text", { x: PX(placeAt(to)), y: GROUND - (BOX_H + 2) * (n + 1) + 21, "text-anchor": "middle" }, "here"));
      }).filter(Boolean) : []);
      const tx = PX(placeAt("T"));
      this.truckLayer.replaceChildren(
        st.trucks.length ? svg("rect", { class: "lorry", x: tx - BOX_W / 2 - 4, y: GROUND - 14, width: BOX_W + 26, height: 12, rx: 3 }) : null,
        ...st.trucks.map((k, i) => svg("g", { class: `truck-tag${k.served ? " served" : ""}` },
          svg("rect", { x: tx - 40, y: 70 + i * 26, width: 104, height: 22, rx: 4 }),
          svg("text", { x: tx + 12, y: 86 + i * 26, "text-anchor": "middle" }, `${k.id} wants ${k.wants}`))).filter(Boolean));
    }
    // the crane, every frame
    const cx = PX(st.crane.x);
    this.trolley.setAttribute("x", cx - 20);
    const hang = st.crane.carries ? 92 : 70;
    for (const [k, v] of Object.entries({ x1: cx, y1: BEAM + 8, x2: cx, y2: hang })) this.rope.setAttribute(k, v);
    this.carried.replaceChildren(...(st.crane.carries ? [svg("rect", { x: cx - BOX_W / 2, y: hang, width: BOX_W, height: BOX_H, rx: 3 }), svg("text", { x: cx, y: hang + 21, "text-anchor": "middle" }, st.crane.carries)] : []));
  }

  /** A container: to its truck at once when one waits for it; else it is chosen, and a stack is next. */
  pick(place) {
    if (!this.page.running) return;
    const g = this.page.game, id = g.top(place);
    if (!id) return this.page.hint(place[0] === "W" ? "No container on that wagon." : "That stack is empty.", true);
    if (!g.blocked(place, "T")) return this.put("T", place);
    this.chosen = this.chosen === place ? null : place;
    this.page.hint(this.chosen ? `${id}: onto which stack?` : "");
    this.page.draw();
  }

  put(to, from = this.chosen) {
    const g = this.page.game, id = g.top(from);
    const res = g.act("move", from, to);
    this.page.hint(res.ok ? (to === "T" ? `${id} goes to its truck.` : `${id} goes onto stack ${to.slice(1)}.`) : res.reason, !res.ok);
    if (res.ok) this.chosen = null;
    this.page.draw();
  }

  /** Q W E R: a wagon; 1 to 6: a stack (first where from, then where to); Escape: no choice. */
  key(e) {
    const k = e.key.toLowerCase(), w = WAGON_KEYS.indexOf(k);
    if (k === "escape" && this.chosen) this.pick(this.chosen);
    else if (w >= 0) this.pick(`W${w + 1}`);
    else if (/^[1-6]$/.test(k)) {
      if (this.chosen && this.chosen !== `S${k}`) this.put(`S${k}`);
      else this.pick(`S${k}`);
    } else return false;
    return true;
  }

  meters(st) {
    return [
      { label: "Trains waiting", n: st.queue.length, max: st.queueMax },
      { label: "Trucks at the gate", n: st.trucks.length, max: st.trucksMax },
    ];
  }

  result(points) {
    return `${points} ${points === 1 ? "container" : "containers"} out`;
  }
}

/* ------------------------------------------------------------------------------------------------ the page */

const VIEWS = { signaller: SignalBox, terminal: Terminal };

class GermanPage {
  constructor() {
    const params = new URLSearchParams(location.search);
    this.View = VIEWS[params.get("game")] ?? SignalBox;
    /** The seed the address asks for (every game the same), or null: every game anew. */
    this.fixed = /^\d+$/.test(params.get("seed") ?? "") ? Number(params.get("seed")) : null;
    this.best = storage.get(BEST_KEY, {});
    if (typeof this.best !== "object" || !this.best) this.best = {};
    /** Whether the game runs: started, not paused, not over. */
    this.started = false;
    this.paused = false;
    this.desk = $("#desk");
    const V = this.View;
    document.title = `German mode: ${V.label.toLowerCase()} · ARail Game`;
    mount($("#places"), Object.values(VIEWS).map((W) => h("a", { href: `?game=${W.id}`, "aria-current": W === V ? "page" : null }, W.label)));
    $("#hook").textContent = V.hook;
    $("#pointsLabel").textContent = V.points;
    const [src, at] = V.backdrop;
    Object.assign($("#backdrop"), { src }).style.objectPosition = at;
    mount($("#how"), V.how.map((line) => h("li", {}, line.map((part) => (Array.isArray(part) ? h("kbd", {}, part[0]) : part)))));
    this.desk.setAttribute("viewBox", V.viewBox);
    this.desk.setAttribute("aria-label", V.label);
    $("#startBtn").onclick = () => this.start();
    $("#againBtn").onclick = () => this.start();
    $("#pauseBtn").onclick = () => this.pause();
    document.addEventListener("keydown", (e) => this.key(e));
    this.newGame();
    this.card("Ready?", V.intro, null, "Start");
    requestAnimationFrame((t) => this.frame(t));
  }

  get running() {
    return this.started && !this.paused && !this.game.over;
  }

  /** A new game, not yet started. */
  newGame() {
    const G = GERMAN_GAMES[this.View.id];
    this.game = new G({ seed: this.fixed ?? 1 + Math.floor(Math.random() * 1e9) });
    this.pace = G.pace;
    this.view = new this.View(this);
    this.view.build(this.desk);
    this.game.on((name, e) => name === "through" && this.view.through?.(e));
    this.sideKey = null;
    this.started = false;
    this.paused = false;
    this.ended = false;
    this.hint("");
    this.draw();
  }

  start() {
    if (this.started || this.game.over) this.newGame();
    this.started = true;
    $("#over").hidden = true;
    $("#pauseBtn").setAttribute("aria-pressed", "false");
    $("#deskScroll").focus({ preventScroll: true });
    this.draw();
  }

  pause(on = !this.paused) {
    if (!this.started || this.game.over) return;
    this.paused = on;
    $("#pauseBtn").setAttribute("aria-pressed", String(on));
    this.hint(on ? "Paused. P goes on." : "");
  }

  /** The card over the picture: before a game, and when it is over. */
  card(title, text, result, button) {
    $("#overTitle").textContent = title;
    $("#overText").textContent = text;
    $("#overResult").textContent = result ?? "";
    $("#overResult").hidden = !result;
    $("#startBtn").textContent = button;
    $("#over").hidden = false;
    $("#startBtn").focus({ preventScroll: true });
  }

  /** The game is over: the score, and the best one kept. */
  finish() {
    this.ended = true;
    const id = this.View.id, points = this.game.result().points, before = Number(this.best[id]) || 0;
    if (points > before) {
      this.best[id] = points;
      storage.set(BEST_KEY, this.best);
    }
    // the reason without its time of day
    const reason = String(this.game.over).replace(/^(\d\d:\d\d:\d\d )?Stuck: /, "").replace(/^./, (c) => c.toUpperCase());
    this.card("Stuck.", reason.split(". ")[0] + ".", `${this.view.result(points, this.game.result())}${points > before && before > 0 ? " · a new best" : before > points ? ` · best ${before}` : ""}`, "Again");
    this.draw();
  }

  hint(text, bad = false) {
    const el = $("#hint");
    el.textContent = text;
    el.classList.toggle("sig-reason", bad);
  }

  draw() {
    const st = this.game.state();
    this.view.draw(st);
    $("#points").textContent = String(st.points);
    $("#best").textContent = String(Math.max(Number(this.best[this.View.id]) || 0, st.points));
    $("#time").textContent = `${Math.floor(st.t / 60)}:${String(Math.floor(st.t % 60)).padStart(2, "0")}`;
    $("#stage").textContent = String(st.stage);
    // the view's card beside the picture (the timetable), when what it shows has changed
    const side = this.view.side?.(st), sideKey = side ? JSON.stringify(st.timetable.slice(0, 9)) : "";
    $("#side").hidden = !side;
    if (side && sideKey !== this.sideKey) {
      this.sideKey = sideKey;
      mount($("#side"), side);
    }
    const meters = this.view.meters(st), key = JSON.stringify(meters);
    if (key !== this.meterKey) {
      this.meterKey = key;
      mount($("#meters"), meters.map((m) => h("p", { class: `ger-meter${m.n >= m.max ? " full" : ""}` },
        h("span", { class: "k" }, m.label),
        h("span", { class: "v pips", role: "img", "aria-label": `${m.n} of ${m.max}` }, Array.from({ length: m.max }, (_, i) => h("i", { class: i < m.n ? "on" : "" }))))));
    }
  }

  frame(t) {
    const dt = this.prev == null ? 0 : Math.min(0.25, (t - this.prev) / 1000);
    this.prev = t;
    if (this.running) {
      this.game.step(dt * this.pace);
      this.draw();
    }
    if (this.game.over && !this.ended) this.finish();
    requestAnimationFrame((x) => this.frame(x));
  }

  /** Space or Enter: start (again); P: pause; the rest is the view's. */
  key(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target.closest?.("input, select, textarea")) return;
    const onButton = !!e.target.closest?.("a, button, [role=button], summary");
    if ((e.key === " " || e.key === "Enter") && !onButton && !this.running && !this.paused) {
      e.preventDefault();
      this.start();
    } else if (e.key === "p" || e.key === "P") this.pause();
    else if (this.running && this.view.key(e)) e.preventDefault();
  }
}

window.__german = new GermanPage();
