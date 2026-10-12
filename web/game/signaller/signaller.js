// The signaller's game page: the panel of Bf Neustadt as SVG (sections, points, signals, trains), the
// routes to set from a start signal to a destination (on the panel or in the form), the substitute
// signal with its checks, the tracks to close and open, the decisions and questions of the game, the
// trains with their delays, the messages and the score. The game itself is arail/game/signaller.js;
// this page passes the player's moves to it and draws its state.
import { CONNECTIONS, LEVELS, STATION, SignallerGame, ZS1_REASONS, clockOf } from "../../arail/game/index.js";
import { $, h, morph, mount, storage } from "../../app/ui.js";

const NS = "http://www.w3.org/2000/svg";
/** Panel grid units to SVG px. */
const X = (x) => 30 + x * 40, Y = (y) => y * 70 - 25;
const SPEEDS = [[0, "Pause"], [1, "1×"], [5, "5×"], [10, "10×"]];

/** An SVG element. */
function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

const hhmm = (t) => clockOf(t).slice(0, 5);

class SignallerPage {
  constructor() {
    this.level = storage.get("arail.signaller.level", "normal");
    if (!LEVELS[this.level]) this.level = "normal";
    this.speed = 1;
    /** The start signal chosen on the panel, or null. */
    this.chosen = null;
    this.reason = "";
    this.lastDraw = 0;
    this.lastSide = 0;
    this.desk = $("#desk");
    this.build();
    this.newGame();
    document.addEventListener("keydown", (e) => this.key(e));
    requestAnimationFrame((t) => this.frame(t));
  }

  newGame() {
    this.game = new SignallerGame({ level: this.level, seed: 1 });
    this.chosen = null;
    this.reason = "";
    this.checks = { route: false, track: false };
    this.zs1For = null;
    this.speed = 1;
    this.drawControls();
    this.draw(true);
    this.side();
  }

  /* ---------------------------------------------------------------- the panel */

  /** The panel's fixed parts: platforms, sections, points and signals (their state is set in `draw`). */
  build() {
    const d = this.desk;
    this.secEls = {};
    this.legEls = {};
    this.sigEls = {};
    const platforms = svg("g", { "aria-hidden": "true" },
      svg("rect", { class: "platform", x: X(9), y: Y(3) + 14, width: X(17) - X(9), height: 22, rx: 3 }),
      svg("text", { class: "muted", x: X(13), y: Y(3) + 30, "text-anchor": "middle" }, "Platform 1"),
      svg("rect", { class: "platform", x: X(11.6), y: Y(1) + 15, width: X(16.4) - X(11.6), height: Y(2) - Y(1) - 30, rx: 3 }),
      svg("text", { class: "muted", x: X(14), y: (Y(1) + Y(2)) / 2 + 5, "text-anchor": "middle" }, "Platform 2"),
    );
    const sections = svg("g", { "aria-hidden": "true" });
    for (const [id, s] of Object.entries(STATION.sections)) {
      const legs = s.draw.map(([[x1, y1], [x2, y2]]) => svg("line", { class: "sec", x1: X(x1), y1: Y(y1), x2: X(x2), y2: Y(y2) }));
      this.secEls[id] = legs;
      sections.append(...legs);
      if (s.track) sections.append(svg("text", { x: X((s.draw[0][0][0] + s.draw[0][1][0]) / 2) + (s.track === "G1" ? -120 : -70), y: Y(s.draw[0][0][1]) - 10 }, s.track));
    }
    const labels = svg("g", { "aria-hidden": "true" },
      svg("text", { x: X(0), y: Y(2) - 14 }, `← ${STATION.west}`),
      svg("text", { x: X(28), y: Y(2) - 14, "text-anchor": "end" }, `${STATION.east} →`),
    );
    const points = svg("g", { "aria-hidden": "true" });
    for (const [id, p] of Object.entries(STATION.points)) {
      const s = STATION.sections[p.section];
      this.legEls[id] = { straight: this.secEls[p.section][0], diverging: this.secEls[p.section][1] };
      const below = p.at[1] >= 3 || (p.at[1] === 2 && s.draw[1][1][1] < 2);
      points.append(svg("text", { class: "muted point-label", x: X(p.at[0]), y: Y(p.at[1]) + (below ? 24 : -12), "text-anchor": "middle" }, id));
    }
    this.trainLayer = svg("g", { "aria-hidden": "true" });
    this.destLayer = svg("g");
    const signals = svg("g");
    for (const [id, s] of Object.entries(STATION.signals)) {
      const x = X(s.at[0]), y = Y(s.at[1]);
      // the signal stands to the right of its track in the direction of travel: below (east), above (west)
      const side = s.dir > 0 ? 1 : -1, ly = y + side * 22, lx = x - s.dir * 6;
      const g = svg("g", { class: "sig", role: "button", tabindex: "0", "data-signal": id },
        svg("rect", { class: "hit", x: lx - 16, y: ly - 14, width: 32, height: 28 }),
        svg("line", { class: "mast", x1: x - s.dir * 6, y1: y + side * 6, x2: lx, y2: ly - side * 7 }),
        svg("circle", { class: "ring", cx: lx, cy: ly, r: 11, fill: "none" }),
        svg("circle", { class: "lamp stop", cx: lx, cy: ly, r: 7 }),
        svg("polygon", { class: "zs1", points: `${lx + 12},${ly - 6} ${lx + 20},${ly - 6} ${lx + 16},${ly + 1}`, visibility: "hidden" }),
        svg("text", { x: lx - s.dir * 16, y: ly + 5, "text-anchor": s.dir > 0 ? "end" : "start" }, id),
      );
      g.addEventListener("click", () => this.choose(id));
      g.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.choose(id);
        }
      });
      this.sigEls[id] = g;
      signals.append(g);
    }
    mount(d, $("#deskDesc"), platforms, sections, labels, points, signals, this.trainLayer, this.destLayer);
  }

  /** Draw the state of the game on the panel. */
  draw(force = false) {
    const st = this.game.state();
    this.st = st;
    const preview = new Set(this.chosen ? STATION.routes.filter((r) => r.from === this.chosen).flatMap((r) => r.sections) : []);
    for (const [id, legs] of Object.entries(this.secEls)) {
      const s = st.sections[id];
      const cls = `sec${s.occupied ? " occ" : s.route ? " route" : s.closed ? " closed" : preview.has(id) ? " preview" : ""}`;
      for (const l of legs) l.setAttribute("class", cls);
    }
    for (const [id, p] of Object.entries(st.points)) {
      const legs = this.legEls[id];
      legs.straight.classList.toggle("leg-off", p.pos === "-");
      legs.diverging.classList.toggle("leg-off", p.pos === "+");
    }
    for (const [id, g] of Object.entries(this.sigEls)) {
      const a = st.signals[id];
      const lamp = g.querySelector(".lamp");
      lamp.setAttribute("class", `lamp ${a.failed ? "failed" : a.aspect}`);
      g.querySelector(".zs1").setAttribute("visibility", a.zs1 ? "visible" : "hidden");
      g.classList.toggle("chosen", this.chosen === id);
      g.setAttribute("aria-label", `Signal ${id}: ${a.failed ? "failed, " : ""}${a.aspect === "proceed" ? "proceed" : "stop"}${a.zs1 ? ", substitute signal lit" : ""}${a.route ? `, route ${a.route}` : ""}. ${this.chosen === id ? "Chosen as start." : "Choose as start."}`);
      g.setAttribute("aria-pressed", this.chosen === id ? "true" : "false");
    }
    // trains: a tag at the head
    const tags = [];
    for (const tr of st.trains) {
      if (!tr.head) continue;
      const sec = STATION.sections[tr.head.section];
      const [[x1, y1], [x2, y2]] = sec.draw[0];
      const f = tr.dir > 0 ? tr.head.frac : 1 - tr.head.frac;
      const x = X(x1 + (x2 - x1) * f), y = Y(y1 + (y2 - y1) * f);
      const late = (tr.state === "dwelling" || tr.state === "running") && st.t > tr.due + 60;
      const label = `${tr.dir > 0 ? "" : "← "}${tr.id}${tr.dir > 0 ? " →" : ""}`;
      const w = label.length * 7.4 + 10;
      const ox = tr.dir > 0 ? -w : 0;
      tags.push(svg("g", { class: `train${late ? " late" : ""}` },
        svg("rect", { x: x + ox, y: y - 9, width: w, height: 18, rx: 4 }),
        svg("text", { x: x + ox + w / 2, y: y + 4, "text-anchor": "middle" }, label)));
    }
    this.trainLayer.replaceChildren(...tags);
    // destinations of the chosen start signal
    const dests = [];
    if (this.chosen) {
      for (const r of this.game.routesFrom(this.chosen)) {
        const def = STATION.routes.find((x) => x.id === r.id);
        const last = STATION.sections[def.sections.at(-1)];
        const [[x1, y1], [x2, y2]] = last.draw[0];
        const east = STATION.signals[def.from].dir > 0;
        const x = last.line ? X(east ? 26.6 : 1.4) : X((x1 + x2) / 2 + (east ? 1.8 : -1.8)), y = Y(last.line ? y1 : y2) - 22;
        const g = svg("g", { class: "dest", role: "button", tabindex: "0", "aria-label": `Destination ${r.to}${r.blocked ? `: not possible, ${r.blocked}` : ""}`, "aria-disabled": r.blocked ? "true" : null, opacity: r.blocked ? 0.45 : 1 },
          svg("rect", { x: x - 34, y: y - 11, width: 68, height: 22, rx: 11 }),
          svg("text", { x, y: y + 5, "text-anchor": "middle" }, r.to));
        const go = () => this.set(r.id);
        g.addEventListener("click", go);
        g.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            go();
          }
        });
        dests.push(g);
      }
    }
    if (force || this.destKey !== `${this.chosen}|${dests.map((g) => g.getAttribute("aria-label")).join()}`) {
      this.destKey = `${this.chosen}|${dests.map((g) => g.getAttribute("aria-label")).join()}`;
      const focused = document.activeElement?.closest?.(".dest")?.getAttribute("aria-label");
      this.destLayer.replaceChildren(...dests);
      if (focused) [...this.destLayer.children].find((g) => g.getAttribute("aria-label") === focused)?.focus();
    }
    $("#clock").textContent = st.clock;
  }

  /** A signal on the panel: the start of a route (again: cancel the choice). */
  choose(id) {
    if (this.game.over) return;
    if (this.chosen === id) {
      this.chosen = null;
      this.hint("Choose a start signal on the panel or in Routes, then its destination.");
    } else {
      this.chosen = id;
      const rs = this.game.routesFrom(id);
      this.hint(rs.length ? `Start ${id}: now its destination (${rs.map((r) => r.to).join(", ")}).` : `${id}: no route starts here.`);
    }
    this.draw(true);
    this.side();
    // to the first destination (keyboard)
    if (this.chosen && document.activeElement?.closest?.(".sig")) this.destLayer.querySelector(".dest")?.focus();
  }

  set(routeId) {
    const res = this.game.setRoute(routeId);
    if (res.ok) {
      this.hint(`Route ${routeId.replace("-", " → ")} set: the points move, then the signal clears.`);
      const from = this.chosen;
      this.chosen = null;
      this.draw(true);
      if (from) this.sigEls[from]?.focus();
    } else this.hint(res.reason, true);
    this.side();
  }

  hint(text, bad = false) {
    const el = $("#deskHint");
    el.textContent = text;
    el.classList.toggle("sig-reason", bad);
  }

  /* ---------------------------------------------------------------- controls and side panels */

  drawControls() {
    mount($("#speed"), SPEEDS.map(([v, label]) => h("button", { type: "button", "aria-pressed": this.speed === v ? "true" : "false", onclick: () => this.setSpeed(v) }, label)));
    mount($("#level"), Object.entries(LEVELS).map(([id, l]) => h("option", { value: id, selected: id === this.level }, l.label)));
    $("#level").onchange = (e) => {
      this.level = e.target.value;
      storage.set("arail.signaller.level", this.level);
      this.newGame();
    };
    $("#newGame").onclick = () => this.newGame();
  }

  setSpeed(v) {
    this.speed = v;
    for (const b of $("#speed").children) b.setAttribute("aria-pressed", b.textContent === SPEEDS.find((s) => s[0] === v)[1] ? "true" : "false");
  }

  /** The side panels (3 times a second, and after a move). */
  side() {
    const g = this.game, st = this.st ?? g.state();
    this.decisions(g, st);
    this.routes(g, st);
    this.signals(g, st);
    this.trains(g, st);
    this.messages(g);
    this.score(g);
  }

  decisions(g) {
    const open = g.open;
    morph($("#decisions"),
      h("h2", { id: "decisionsTitle" }, "Decisions"),
      open.length ? open.map((d) => {
        const quiz = d.id.startsWith("quiz-");
        return h("div", { class: `decision${quiz ? " quiz" : ""}` },
          h("h3", {}, quiz ? `Question: ${d.title}` : d.title),
          d.text ? h("p", {}, d.text) : null,
          h("div", { class: "row" }, d.options.map((o) => h("button", { class: `btn small${!quiz && o === d.options[0] ? " primary" : ""}`, type: "button", onclick: () => { g.decide(d.id, o.id); this.draw(true); this.side(); } }, o.label))));
      }) : h("p", { class: "hint" }, g.over ? "The game is over." : "Nothing to decide just now."),
    );
  }

  routes(g, st) {
    const starts = Object.keys(STATION.signals);
    const from = this.chosen ?? "";
    const list = from ? g.routesFrom(from) : [];
    morph($("#routes"),
      h("h2", { id: "routesTitle" }, "Routes"),
      h("div", { class: "sig-form" },
        h("div", { class: "row" },
          h("label", { class: "field", for: "routeFrom" }, h("span", {}, "Start signal"),
            h("select", { id: "routeFrom", onchange: (e) => this.choose(e.target.value || this.chosen) },
              h("option", { value: "", selected: !from }, "Choose"),
              starts.map((s) => h("option", { value: s, selected: s === from }, s)))),
          from ? list.map((r) => h("button", { class: "btn small", type: "button", disabled: !!r.blocked, title: r.blocked ?? `Set the route ${from} → ${r.to}`, onclick: () => this.set(r.id) }, `→ ${r.to}`)) : null),
        from && list.some((r) => r.blocked) ? h("p", { class: "hint" }, list.filter((r) => r.blocked).map((r) => `${r.to}: ${r.blocked}`).join(" ")) : null),
      st.routes.length ? h("ul", { class: "sig-list", "aria-label": "Routes set" }, st.routes.map((r) =>
        h("li", {}, h("span", {}, `${r.from} → ${r.to}`, " ", h("span", { class: `tag${r.state === "locked" ? " ok" : ""}` }, r.train ? r.train : r.state === "locked" ? "locked" : "points moving")),
          r.train ? null : h("button", { class: "btn small", type: "button", onclick: () => this.cancel(r.id) }, "Cancel")))) : h("p", { class: "hint" }, "No route set."),
    );
  }

  cancel(id) {
    const res = this.game.cancelRoute(id);
    this.hint(res.ok ? `Route ${id.replace("-", " → ")} cancelled.` : res.reason, !res.ok);
    this.draw(true);
    this.side();
  }

  signals(g, st) {
    const failed = st.failure?.started ? st.failure : null;
    // the substitute signal: at failed signals, and at signals at stop with a train standing in front
    const waiting = Object.keys(STATION.signals).filter((id) => st.signals[id].aspect === "stop" && !st.signals[id].zs1 && (st.signals[id].failed || st.trains.some((tr) => tr.next === id && tr.speed === 0)));
    const zs = this.zs1For && waiting.includes(this.zs1For) ? this.zs1For : null;
    morph($("#signals"),
      h("h2", { id: "signalsTitle" }, "Signals and tracks"),
      failed && failed.reported == null ? h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", onclick: () => { g.reportFault(); this.side(); } }, `Report the failure of ${failed.signal}`)) : null,
      failed ? h("p", { class: "hint" }, `${failed.signal}: ${failed.repaired != null ? `repaired at ${hhmm(failed.repaired)}` : failed.reported != null ? `reported at ${hhmm(failed.reported)}; repair team ${({ driving: "on its way", waiting: "waits for the track closure", working: "at work on G2", done: "has finished", left: "has left" })[st.team.state] ?? ""}` : "failed, not reported"}.`) : null,
      waiting.length ? h("div", { class: "row" }, h("span", {}, "Substitute signal (Zs 1) at:"), waiting.map((id) => h("button", { class: "btn small", type: "button", "aria-pressed": zs === id ? "true" : "false", onclick: () => { this.zs1For = zs === id ? null : id; this.checks = { route: false, track: false }; this.reason = ""; this.side(); } }, id))) : null,
      zs ? this.zs1Form(zs) : null,
      h("ul", { class: "sig-list", "aria-label": "Platform tracks" }, ["G1", "G2", "G3"].map((t) => {
        const sec = Object.keys(STATION.sections).find((k) => STATION.sections[k].track === t), s = st.sections[sec];
        return h("li", {}, h("span", {}, `Track ${t} `, h("span", { class: `tag${s.closed ? " warn" : s.occupied ? " bad" : ""}` }, s.closed ? "closed" : s.occupied ? `occupied (${s.occupied})` : s.route ? "in a route" : "free")),
          h("button", { class: "btn small", type: "button", onclick: () => this.track(t, s.closed) }, s.closed ? `Open ${t}` : `Close ${t}`));
      })),
    );
  }

  /** The checks before a substitute signal, and the record of its reason. */
  zs1Form(id) {
    return h("fieldset", { class: "sig-zs1" },
      h("legend", {}, `Substitute signal Zs 1 at ${id}`),
      h("label", { class: "field check", for: "zs1Route" }, h("input", { type: "checkbox", id: "zs1Route", checked: this.checks.route, onchange: (e) => { this.checks.route = e.target.checked; } }), "I have checked: the route from this signal is set and locked, the points are in their position."),
      h("label", { class: "field check", for: "zs1Track" }, h("input", { type: "checkbox", id: "zs1Track", checked: this.checks.track, onchange: (e) => { this.checks.track = e.target.checked; } }), "I have checked: the track ahead is clear up to the next main signal."),
      h("label", { class: "field", for: "zs1Reason" }, h("span", {}, "Reason, recorded with the counter reading"),
        h("select", { id: "zs1Reason", onchange: (e) => { this.reason = e.target.value; } },
          h("option", { value: "", selected: !this.reason }, "Choose"),
          ZS1_REASONS.map((r) => h("option", { value: r.id, selected: this.reason === r.id }, r.label)))),
      h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", onclick: () => this.giveZs1(id) }, "Give Zs 1")),
    );
  }

  giveZs1(id) {
    const res = this.game.substitute(id, { routeChecked: this.checks.route, trackChecked: this.checks.track, reason: this.reason });
    this.hint(res.ok ? `Zs 1 at ${id}: the train may pass at up to 40 km/h.` : res.reason, !res.ok);
    this.zs1For = null;
    this.reason = "";
    this.checks = { route: false, track: false };
    this.draw(true);
    this.side();
  }

  track(t, closed) {
    const res = closed ? this.game.openTrack(t) : this.game.closeTrack(t);
    this.hint(res.ok ? `Track ${t} ${closed ? "open" : "closed"}.` : res.reason, !res.ok);
    this.draw(true);
    this.side();
  }

  trains(g, st) {
    const rows = g.report();
    const where = (tr) => {
      if (tr.state === "coming") return st.t >= g.trains.find((x) => x.id === tr.id).enter - 60 ? "due" : "later";
      if (tr.state === "gone") return "gone";
      if (tr.state === "dwelling") return `at ${tr.track}`;
      return tr.next ? `to ${tr.next} · ${tr.speed} km/h` : `${tr.speed} km/h`;
    };
    const conns = Object.fromEntries(CONNECTIONS.flat().map((id) => [id, true]));
    morph($("#trains"),
      h("h2", { id: "trainsTitle" }, "Trains"),
      h("div", { class: "table-scroll" }, h("table", { class: "game-table" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Train"), h("th", { scope: "col" }, "From – to"), h("th", { scope: "col" }, "Planned"), h("th", { scope: "col" }, "Due"), h("th", { scope: "col" }, "Where"), h("th", { scope: "col" }, "Late"), h("th", { scope: "col" }, "Note"))),
        h("tbody", {}, st.trains.map((tr) => {
          const r = rows.find((x) => x.id === tr.id);
          return h("tr", {},
            h("th", { scope: "row" }, tr.id),
            h("td", {}, tr.dir > 0 ? `${STATION.west} – ${STATION.east}` : `${STATION.east} – ${STATION.west}`),
            h("td", {}, tr.track && tr.track !== tr.plan ? `${tr.plan} (${tr.track})` : tr.plan),
            h("td", {}, `${tr.stops ? "dep" : "pass"} ${hhmm(tr.due)}`),
            h("td", {}, where(tr)),
            h("td", { class: r.delay >= 1 ? "late" : "" }, r.delay >= 1 ? `+${Math.round(r.delay)}` : "–"),
            h("td", {}, tr.note || (conns[tr.id] ? "connection" : "")));
        })))),
    );
  }

  messages(g) {
    const lines = g.logs.slice(-40).reverse();
    morph($("#log"),
      h("h2", { id: "logTitle" }, "Messages"),
      h("ol", { "aria-live": "off" }, lines.map((l) => h("li", { class: l.kind }, l.text))),
    );
  }

  score(g) {
    const { total, parts } = g.score();
    const res = g.over ? g.result() : null;
    morph($("#score"),
      h("h2", { id: "scoreTitle" }, g.over ? "Your half hour" : "Score so far"),
      h("p", {}, h("span", { class: "score-total" }, String(total)), " of 100", res ? h("span", {}, " · ", h("span", { class: `tag ${res.passed ? "ok" : "bad"}` }, res.passed ? "passed" : "not passed")) : null),
      h("ul", { class: "score-parts" }, parts.map((p) => h("li", {},
        h("span", {}, `${p.label} (${p.weight})`),
        h("span", { class: "meter", role: "img", "aria-label": `${Math.round(Math.max(0, Math.min(1, p.value)) * 100)} %` }, h("i", { style: { width: `${Math.round(Math.max(0, Math.min(1, p.value)) * 100)}%` } })),
        h("span", { class: "note" }, p.note)))),
      res ? h("div", { class: "sig-debrief" },
        h("p", {}, res.worst >= 3 ? "A danger to people: in the career mode this ends the shift with an investigation, whatever the score." : res.passed ? "In the career mode this shift counts towards the next step (dispatcher in an operations centre, or instructor)." : "Not passed: in the career mode, a second training shift with an instructor."),
        res.stuck.length ? h("p", {}, `Not through by the end of the shift: ${res.stuck.join(", ")}.`) : null,
        g.violations.length ? h("ul", {}, g.violations.map((v) => h("li", {}, v.text))) : null,
        h("button", { class: "btn primary", type: "button", onclick: () => this.newGame() }, "Play again")) : null,
    );
  }

  /* ---------------------------------------------------------------- time and keys */

  frame(t) {
    const dt = this.prev == null ? 0 : Math.min(0.25, (t - this.prev) / 1000);
    this.prev = t;
    if (this.speed > 0 && !this.game.over) this.game.step(dt * this.speed);
    if (t - this.lastDraw > 80) {
      this.lastDraw = t;
      this.draw();
    }
    // the side panels: not while the player is choosing in them
    const busy = document.activeElement?.matches?.("select, input") && document.activeElement.closest(".sig-side");
    if (t - this.lastSide > 300 && !busy) {
      this.lastSide = t;
      this.side();
    }
    requestAnimationFrame((x) => this.frame(x));
  }

  key(e) {
    if (e.target.closest?.("input, select, textarea")) return;
    if (e.key === "Escape" && this.chosen) {
      this.chosen = null;
      this.hint("Choose a start signal on the panel or in Routes, then its destination.");
      this.draw(true);
      this.side();
    }
    if (e.key === "p" || e.key === "P") this.setSpeed(this.speed ? 0 : 1);
  }
}

window.__signaller = new SignallerPage();
