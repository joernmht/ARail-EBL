// Infrastructure panel: the layout's infrastructure district as a game for teams. A role switcher (asset
// manager, ALV, maintenance dispatcher, planner, construction supervision, funding authority, instructor)
// decides what may be done; the views show the overview of the year, the line map of the network (km,
// assets in the colour of their known condition), the asset register with the asset information model,
// the decisions waiting for the role, the projects through the HOAI phases, the staff in shifts and the
// results of the years. Games are kept per layout in the browser and can be saved as files.
import {
  ASSET_TYPES, DISCIPLINES, DISCIPLINE_IDS, GENERATIONS, MEASURES, METHODS, PROCEDURES, PROJECT_STAGES, QUALITY, REPORTS, ROLES, ROLE_IDS,
  SUPERVISION, YEAR, assetRecord, durationText, eur, gradeColour, infraOf, kmLabel, roleLabel, scenariosOf, toGeoJSON,
} from "../arail/index.js";
import { download, h, morph, mount, readFile, storage, toast } from "./ui.js";

const VIEWS = [["overview", "Overview"], ["map", "Line map"], ["assets", "Assets"], ["decisions", "Decisions"], ["projects", "Projects"], ["staff", "Staff"], ["results", "Results"]];
const ROLE_CHOICES = [...ROLE_IDS, "instructor"];
const roleName = (r) => (r === "instructor" ? "Instructor (everything)" : ROLES[r]?.label ?? r);
/** "the ALV", "the asset manager". */
const theRole = (r) => (r === "alv" ? "the ALV" : `the ${(ROLES[r]?.label ?? r).toLowerCase()}`);
const DAY = 1440;
const LOG_KINDS = { fault: "bad", warn: "warn", fixed: "ok", good: "ok", decision: "accent", project: "accent", money: "", staff: "", work: "", plan: "" };
const SVGNS = "http://www.w3.org/2000/svg";

/** An SVG element. */
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, String(v));
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/** A table that scrolls sideways where it is too wide (a named region the keyboard can scroll). */
const scroller = (label, table) => h("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": label }, table);
const tile = (label, value, note, cls = "") => h("div", { class: `tile ${cls}` }, h("span", { class: "label" }, label), h("b", { class: "value" }, value), h("span", { class: "note" }, note));
/** A grade value with one decimal, rounded down (5.99 is still a 5). */
const gv = (v) => (Math.floor(v * 10 + 1e-9) / 10).toFixed(1);
/** Relative luminance of an "rgba(r,g,b,a)" or "#rrggbb" colour (WCAG). */
function luminance(c) {
  const m = String(c).match(/\d+(\.\d+)?/g)?.map(Number) ?? [0, 0, 0];
  const rgb = String(c).startsWith("#") ? [1, 3, 5].map((i) => parseInt(String(c).slice(i, i + 2), 16)) : m.slice(0, 3);
  const [r, g, b] = rgb.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Black or white on a background, whichever reads better (at least 4.5:1 on every grade colour). */
const inkOn = (bg) => {
  const l = luminance(bg);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#000000" : "#ffffff";
};
/** A grade chip: the number in the colour of the grade; a fault is grade 6 (restricting). */
const chip = (value, { fault = false, title = null } = {}) => {
  const bg = gradeColour(value);
  return h("span", { class: `grade-chip${fault ? " fault" : ""}`, title, style: fault ? null : { background: bg, color: inkOn(bg) } }, fault ? "6 fault" : gv(value));
};

export class InfraPanel {
  /** @param {object} app the ARail app */
  constructor(app) {
    this.app = app;
    this.view = VIEWS.some(([v]) => v === storage.get("arail.infraView")) ? storage.get("arail.infraView") : "overview";
    this.role = ROLE_CHOICES.includes(storage.get("arail.infraRole")) ? storage.get("arail.infraRole") : "asset-manager";
    // the tables and the line map need room: wide by default on large screens
    this.wide = storage.get("arail.infraWide", true) !== false;
    this.filter = { discipline: "", type: "", problems: false, layout: false, limit: 40 };
    this.assetChoice = null;
    this.projectChoice = null;
    this.scenario = "none";
    this.message = "";
    this.el = null;
  }

  get world() {
    return this.app.world;
  }

  get sim() {
    return infraOf(this.world);
  }

  /** May the current role do this? */
  can(what, item = null) {
    const r = this.role;
    if (r === "instructor") return true;
    switch (what) {
      case "decide": return item?.role === r;
      case "propose": case "plan": return r === "alv";
      case "inspect": return r === "alv" || r === "dispatcher";
      case "staff": return r === "asset-manager";
      case "oncall": case "pilots": return r === "asset-manager" || r === "dispatcher";
      default: return false;
    }
  }

  render(el) {
    this.el = { root: el, head: h("div", { class: "section" }), body: h("div", { class: "ops-body infra-body" }) };
    mount(el, this.el.head, this.el.body);
    this.update();
  }

  /** Refresh in place (every 400 ms while shown, and after actions). */
  update() {
    const e = this.el;
    if (!e?.root.isConnected) return;
    const sim = this.sim;
    if (!sim) {
      morph(e.head, h("h2", { tabindex: "-1" }, "Infrastructure"), h("p", { class: "hint" }, "This layout has no infrastructure simulation. Settings → Simulation adds it, or switches on the module of the lab example."));
      morph(e.body);
      return;
    }
    sim.step?.(0);
    if (sim !== this._shown) {
      this._shown = sim;
      this._restore(sim);
    }
    this._autosave(sim);
    sim.display.mode = this.role !== "instructor" && sim.display.mode === "true" ? "known" : sim.display.mode;
    morph(e.head, this._head(sim));
    const engine = sim.engine;
    if (!sim.active || !engine) {
      morph(e.body, h("p", { class: "hint" }, !sim.enabled ? "The infrastructure simulation of this layout is switched off (\"enabled\": false)." : "Another infrastructure entry of this layout runs."));
      return;
    }
    const views = { overview: this._overview, map: this._map, assets: this._assets, decisions: this._decisions, projects: this._projects, staff: this._staff, results: this._results };
    morph(e.body, views[this.view].call(this, sim, engine));
  }

  setView(v) {
    this.view = v;
    storage.set("arail.infraView", v);
    this.update();
    this.el?.body.querySelector("h2, h3")?.focus?.();
  }

  setRole(r) {
    this.role = r;
    storage.set("arail.infraRole", r);
    if (r !== "instructor" && this.sim?.display.mode === "true") this.sim.display.mode = "known";
    this.update();
  }

  setWide(on) {
    this.wide = on;
    storage.set("arail.infraWide", on);
    this.syncWidth();
    this.update();
  }

  syncWidth() {
    document.querySelector(".main")?.classList.toggle("wide", this.wide && this.app.activeTab === "infra");
  }

  /* ---------------------------------------------------------------- saving the game */

  _key() {
    return `arail.infraGame:${this.world.layout.name || "layout"}`;
  }

  /** A game kept in the browser for this layout is restored once. */
  _restore(sim) {
    const saved = storage.get(this._key());
    if (!saved?.actions?.length && !(saved?.now > DAY)) return;
    if (sim.load(saved)) toast(`Your infrastructure game was restored: ${sim.engine.timeText()}.`, 5000);
  }

  _autosave(sim) {
    const e = sim.engine;
    if (!e) return;
    const stamp = `${e.actions.length}:${Math.floor(e.now / DAY)}`;
    if (stamp === this._saved) return;
    this._saved = stamp;
    storage.set(this._key(), sim.save());
  }

  /** "Add infrastructure to this layout" (Settings → Simulation). */
  async addInfrastructure() {
    const app = this.app, json = this.world.toJSON();
    json.simulations = [...(json.simulations || []), { type: "infrastructure" }];
    try {
      await app._applyLayout(json);
    } catch (err) {
      toast(`The infrastructure could not be added: ${err.message}`, 7000);
      return;
    }
    app.saveLayout();
    app.openTab("infra");
    toast("Infrastructure added: the platforms and tracks of the layout are now assets of the station Bahnhof. Build → Infrastructure adds signals, switches and level crossings.", 7000);
  }

  /* ---------------------------------------------------------------- head */

  _head(sim) {
    const e = sim.engine;
    const year = e ? Math.min(e.model.years, Math.floor(e.now / YEAR) + 1) : 1;
    const open = e ? e.open(this.role === "instructor" ? null : this.role).filter((i) => i.pause !== false).length : 0;
    return [
      h("h2", { tabindex: "-1" }, sim.name),
      h("div", { class: "row ops-headline" },
        h("p", { class: "ops-status" }, e ? `${e.timeText()} · year ${year} of ${e.model.years}${e.finished ? " · game over" : ""}` : "Starting…"),
        h("button", { class: "btn small ops-widen", type: "button", id: "infraWide", "aria-pressed": this.wide ? "true" : "false", onclick: () => this.setWide(!this.wide) }, "Wide panel")),
      h("div", { class: "infra-role" },
        h("label", { class: "field", for: "infraRole" }, h("span", {}, "Your role"),
          h("select", { id: "infraRole", onchange: (ev) => this.setRole(ev.target.value) },
            ROLE_CHOICES.map((r) => h("option", { value: r, selected: r === this.role }, `${roleName(r)}${e && r !== "instructor" && e.roles[r] === "computer" ? " (computer)" : ""}`)))),
        h("p", { class: "hint" }, this.role === "instructor" ? "Sees the true condition, plays every role, starts new games." : `${ROLES[this.role].de}: ${ROLES[this.role].does}.`)),
      e ? h("div", { class: "row infra-run" },
        h("button", { class: "btn primary small", type: "button", id: "infraNext", disabled: e.finished, onclick: () => this._run("next") }, "Run to the next decision"),
        h("button", { class: "btn small", type: "button", id: "infraYear", disabled: e.finished, onclick: () => this._run("year") }, "Run to the year's end"),
        open ? h("button", { class: "btn small warn", type: "button", onclick: () => this.setView("decisions") }, `${open} decision${open === 1 ? "" : "s"} waiting`) : null,
      ) : null,
      this.message ? h("p", { class: "hint", role: "status" }, this.message, " ",
        this.waiting && this.waiting !== this.role && this.role !== "instructor" ? h("button", { class: "link", type: "button", onclick: () => { this.setRole(this.waiting); this.setView("decisions"); } }, `Take ${theRole(this.waiting)}'s role`) : null) : null,
      h("div", { class: "seg ops-views infra-views", role: "group", "aria-label": "Show" },
        VIEWS.map(([v, label]) => h("button", { type: "button", id: `infraView-${v}`, "aria-pressed": this.view === v ? "true" : "false", onclick: () => this.setView(v) }, label))),
    ];
  }

  /** Run fast to the next decision of a student role, or to the year's end. */
  _run(what) {
    const sim = this.sim, e = sim?.engine;
    if (!e || e.finished) return;
    const t0 = e.now;
    const end = (Math.floor(e.now / YEAR) + 1) * YEAR;
    const item = what === "next" ? sim.runTo(end, { pause: true }) : sim.runYear({ pause: false });
    const took = durationText(e.now - t0);
    this.waiting = item?.role ?? null;
    if (item) {
      this.message = `Ran ${took} to ${e.timeText()}: ${theRole(item.role)} has to decide.`;
      if (this.role === item.role || this.role === "instructor") this.setView("decisions");
    } else this.message = e.finished ? "The game is over: see the results." : `Ran ${took} to ${e.timeText()}.${e.years.length ? ` Year ${e.years[e.years.length - 1].year} is closed (Results).` : ""}`;
    this.update();
  }

  /* ---------------------------------------------------------------- Overview */

  _overview(sim, e) {
    const cur = e.current();
    const faults = [...e.faults.values()].filter((f) => f.knownAt <= e.now);
    const people = e.people.filter((p) => p.employed(e.now) && p.role !== "alv");
    const out = people.filter((p) => ["driving", "repairing", "working", "flying"].includes(e.activity(p).state)).length;
    const known = e.meanGrade({ known: true });
    const tiles = [
      ["Network grade", known.toFixed(2), `known; target ${e.model.funding.target_grade.toFixed(1)} or better`],
      ["Open faults", `${faults.length}`, faults.length ? faults.map((f) => e.assets.get(f.asset)?.name).slice(0, 2).join(", ") : "none known"],
      ["Delay minutes", cur.delayMin.toLocaleString("en"), `this year · ${eur(cur.perfEur)} performance regime`],
      ["Maintenance money", eur(e.balance.maintenance), `of ${eur(e.budget.maintenance)} this year`],
      ["Replacement money", eur(e.balance.replacement), `of ${eur(e.budget.replacement)}; unspent goes back`],
      ["Staff out", `${out} of ${people.length}`, `${cur.callouts} call-outs this year`],
      ["Inspections on time", `${Math.round(e.compliance() * 100)} %`, "EBO § 17"],
      ["Known well", `${Math.round(e.informed() * 100)} %`, "of the assets, to ±0.5 grade"],
    ];
    if (this.role === "instructor") tiles.splice(1, 0, ["True grade", e.meanGrade().toFixed(2), "only the instructor sees it"]);
    const log = e.logs.slice(-14).reverse();
    return [
      h("div", { class: "ops-tiles" }, tiles.map(([l, v, n]) => tile(l, v, n))),
      this._display(sim),
      h("div", { class: "section" },
        h("h2", {}, "What happened"),
        log.length ? h("div", { class: "ops-log infra-log", tabindex: "0", role: "region", "aria-label": "What happened, newest first" },
          h("ul", {}, log.map((l) => h("li", { class: LOG_KINDS[l.kind] ?? "" }, h("time", {}, e.timeText(l.t)), h("span", {}, l.text)))))
          : h("p", { class: "hint" }, "Nothing yet.")),
      h("div", { class: "section" },
        h("h2", {}, "Something happens"),
        h("div", { class: "row" },
          h("button", { class: "btn small", type: "button", id: "infraFail", onclick: () => this._say(sim.failAsset("")) }, "An asset at the station fails"),
          h("button", { class: "btn small", type: "button", id: "infraTheft", onclick: () => this._say(sim.inject({ type: "theft" })) }, "Cable theft"),
          h("button", { class: "btn small", type: "button", id: "infraStorm", onclick: () => this._say(sim.inject({ type: "storm", count: 4 })) }, "A storm")),
        h("p", { class: "hint" }, "On the layout: the emergency van drives out from the maintenance base, the trains at the station are held or pass at caution. More in the Disruptions tab (module Disruptions) and in scenarios.")),
    ];
  }

  /** How assets are coloured on the layout. */
  _display(sim) {
    const d = sim.display;
    const modes = [["known", "Known condition"], ["checked", "Last check"], ...(this.role === "instructor" ? [["true", "True condition"]] : []), ["off", "Off"]];
    return h("div", { class: "section infra-display" },
      h("h2", {}, "On the layout"),
      h("div", { class: "fields" },
        h("label", { class: "field", for: "infraColour" }, h("span", {}, "Colour the assets by"),
          h("select", { id: "infraColour", onchange: (ev) => { d.mode = ev.target.value; this.update(); } }, modes.map(([v, l]) => h("option", { value: v, selected: d.mode === v }, l)))),
        h("label", { class: "field", for: "infraLabels" }, h("span", {}, "Labels"),
          h("select", { id: "infraLabels", onchange: (ev) => { d.labels = ev.target.value; this.update(); } },
            [["faults", "Faults and the chosen asset"], ["all", "Every asset"], ["none", "None"]].map(([v, l]) => h("option", { value: v, selected: d.labels === v }, l))))),
      legend(d.mode));
  }

  _say(text) {
    toast(text ? `${text[0].toUpperCase()}${text.slice(1)}.` : "Nothing happened.");
    this.update();
  }

  /* ---------------------------------------------------------------- Line map */

  _map(sim, e) {
    const lines = [...e.net.lines.values()];
    const chosen = this.assetChoice ? e.assets.get(this.assetChoice) : null;
    return [
      h("p", { class: "hint" }, "The network as a line diagram (Streckenband): kilometres along each line, the assets in four rows by discipline, in the colour of their known condition. The layout is the station on the table. Choose an asset for its record."),
      ...lines.map((l) => this._lineDiagram(e, l)),
      legend(sim.display.mode === "true" ? "true" : "known"),
      h("div", { class: "row" },
        h("button", { class: "btn small", type: "button", id: "infraGeo", onclick: () => download(`${slug(e.model.name)}.geojson`, JSON.stringify(toGeoJSON(e), null, 1), "application/geo+json") }, "Download GeoJSON (for QGIS)"),
        h("button", { class: "btn small", type: "button", onclick: () => download(`${slug(e.model.name)}-assets.json`, JSON.stringify(e.active().map((a) => assetRecord(e, a)), null, 1)) }, "Download the asset register")),
      h("p", { class: "hint" }, `GIS: the layout's origin lies at an invented place in ETRS89 / UTM zone ${e.model.georef.epsg % 100} (EPSG:${e.model.georef.epsg}); the GeoJSON is in WGS 84 with each asset's line, km and known condition.`),
      chosen ? this._assetCard(sim, e, chosen) : null,
    ];
  }

  _lineDiagram(e, l) {
    const W = 720, left = 58, right = 12, rowH = 18, top = 30;
    const [k0, k1] = l.km;
    const x = (km) => left + ((km - k0) / Math.max(0.1, k1 - k0)) * (W - left - right);
    const rows = DISCIPLINE_IDS;
    const H = top + rows.length * rowH + 14;
    const marks = [];
    const used = new Map();
    const assets = e.active().filter((a) => a.line === l.id).sort((a, b) => a.km - b.km);
    for (const a of assets) {
      const k = e.known(a);
      const value = this.role === "instructor" && this.sim.display.mode === "true" ? (a.fault ? 6 : 1 + 4.99 * (1 - a.h)) : k.value;
      const fault = this.role === "instructor" && this.sim.display.mode === "true" ? !!a.fault : k.fault;
      const row = rows.indexOf(a.discipline), y = top + row * rowH + rowH / 2;
      const style = k.live >= 0.5 || k.sigma * 5 <= 0.35 ? "" : k.source === "age" || k.source === "unknown" ? "age" : "stale";
      const title = s("title", {}, `${a.name}, ${kmLabel(a.km)}: grade ${fault ? "6 (fault)" : gv(value)}`);
      const attrs = { class: `mark ${style}${fault ? " fault" : ""}${a.id === this.assetChoice ? " chosen" : ""}`, fill: fault ? "#001450" : gradeColour(value), "data-asset": a.id };
      const pick = () => this._choose(a.id);
      if (a.t.linear) {
        const el = s("rect", { ...attrs, x: x(a.km), y: y - 3, width: Math.max(2, x(a.km + a.length_km) - x(a.km) - 1), height: 6, rx: 1.5 }, title);
        el.onclick = pick;
        marks.push(el);
      } else {
        // marks at the same place stack upwards a little
        const key = `${row}:${Math.round(x(a.km) / 6)}`, n = used.get(key) || 0;
        used.set(key, n + 1);
        const el = s("circle", { ...attrs, cx: x(a.km) + (n % 3) * 3, cy: y - Math.floor(n / 3) * 3 + (n % 3 ? -1 : 0), r: a.type === "interlocking" ? 5.5 : 3.6 }, title);
        el.onclick = pick;
        marks.push(el);
      }
    }
    const ticks = [];
    for (let km = Math.ceil(k0 / 5) * 5; km <= k1; km += 5) {
      ticks.push(s("line", { class: "tick", x1: x(km), x2: x(km), y1: top - 4, y2: H - 10 }), s("text", { class: "km", x: x(km), y: H - 1, "text-anchor": "middle" }, `${km}`));
    }
    // the line's own stations, and a station of another line where this one begins (a junction)
    const start = e.net.at(l.id, k0)?.pos;
    const stations = [...e.net.stations.values()].filter((st) => {
      if (st.line === l.id) return true;
      const p = e.net.at(st.line, st.km)?.pos;
      return start && p && Math.hypot(start[0] - p[0], start[1] - p[1]) < 400;
    });
    const layout = e.active().filter((a) => a.on_layout && a.line === l.id);
    const span = layout.length ? [Math.min(...layout.map((a) => a.km)), Math.max(...layout.map((a) => a.km + (a.length_km || 0)))] : null;
    const svg = s("svg", { class: "line-map", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Line ${l.id}: ${assets.length} assets` },
      span ? s("rect", { class: "on-table", x: x(span[0]) - 3, y: top - 6, width: Math.max(6, x(span[1]) - x(span[0]) + 6), height: rows.length * rowH + 4, rx: 3 }, s("title", {}, "On the table: the station on the layout")) : null,
      rows.map((d, i) => [s("text", { class: "row-label", x: 4, y: top + i * rowH + rowH / 2 + 3 }, DISCIPLINES[d].short), s("line", { class: "row-line", x1: left, x2: W - right, y1: top + i * rowH + rowH / 2, y2: top + i * rowH + rowH / 2 })]),
      ticks,
      stations.map((st) => {
        const km = st.line === l.id ? st.km : l.km[0];
        return [s("line", { class: "station", x1: x(km), x2: x(km), y1: 12, y2: H - 10 }), s("text", { class: "station-name", x: x(km), y: 10, "text-anchor": km - k0 < 1.5 ? "start" : k1 - km < 1.5 ? "end" : "middle" }, st.name)];
      }),
      marks);
    return h("div", { class: "section" },
      h("h3", {}, `Line ${l.id} ${l.name}`, h("span", { class: "count" }, ` ${l.tracks === 2 ? "double" : "single"} track, ${l.electrified ? "electrified" : "not electrified"}, ${l.speed_kmh} km/h, ${l.trains_per_day} trains a day`)),
      h("div", { class: "line-map-wrap", tabindex: "0", role: "region", "aria-label": `Line diagram of line ${l.id}` }, svg));
  }

  _choose(id) {
    this.assetChoice = id;
    if (this.sim) this.sim.selected = id;
    this.update();
  }

  /* ---------------------------------------------------------------- Assets */

  _assets(sim, e) {
    const f = this.filter;
    let list = e.active();
    if (f.discipline) list = list.filter((a) => a.discipline === f.discipline);
    if (f.type) list = list.filter((a) => a.type === f.type);
    if (f.layout) list = list.filter((a) => a.on_layout);
    const rows = list.map((a) => ({ a, k: e.known(a) }));
    let shown = f.problems ? rows.filter((r) => r.k.grade >= 4) : rows;
    shown = shown.sort((x, y) => y.k.value - x.k.value || x.a.name.localeCompare(y.a.name));
    const chosen = this.assetChoice ? e.assets.get(this.assetChoice) : null;
    const types = [...new Set(e.active().map((a) => a.type))];
    return [
      h("div", { class: "fields" },
        h("label", { class: "field", for: "infraDisc" }, h("span", {}, "Discipline"),
          h("select", { id: "infraDisc", onchange: (ev) => { f.discipline = ev.target.value; this.update(); } },
            h("option", { value: "" }, "all"), DISCIPLINE_IDS.map((d) => h("option", { value: d, selected: f.discipline === d }, DISCIPLINES[d].label)))),
        h("label", { class: "field", for: "infraType" }, h("span", {}, "Type"),
          h("select", { id: "infraType", onchange: (ev) => { f.type = ev.target.value; this.update(); } },
            h("option", { value: "" }, "all"), types.map((t) => h("option", { value: t, selected: f.type === t }, ASSET_TYPES[t].plural)))),
        h("label", { class: "field check", for: "infraProblems" }, h("input", { type: "checkbox", id: "infraProblems", checked: f.problems, onchange: (ev) => { f.problems = ev.target.checked; this.update(); } }), "Grade 4 or worse"),
        h("label", { class: "field check", for: "infraOnLayout" }, h("input", { type: "checkbox", id: "infraOnLayout", checked: f.layout, onchange: (ev) => { f.layout = ev.target.checked; this.update(); } }), "On the layout")),
      h("p", { class: "hint" }, `${shown.length} of ${e.active().length} assets, worst first. Grade: what is known (± its uncertainty); the colour of the dot is the age of the last check.`),
      scroller("Assets", h("table", { class: "ops-table infra-assets" },
        h("thead", {}, h("tr", {}, ["Asset", "Known grade"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, shown.slice(0, f.limit).map(({ a, k }) => h("tr", { class: a.id === this.assetChoice ? "chosen" : null },
          h("th", { scope: "row" }, h("button", { class: "link", type: "button", onclick: () => this._choose(a.id) }, a.name),
            h("small", { class: "sub" }, `${a.t.label} · line ${a.line} ${kmLabel(a.km)}${a.on_layout ? " · on the layout" : ""}`),
            h("small", { class: "sub" }, `age ${Math.round(a.age(e.now, e.startYear))}${a.builtKnown ? "" : "?"} of ${a.life} years · ${a.failureRate(k.h, e.load(a.line)).toFixed(2)} faults a year`)),
          h("td", {}, chip(k.value, { fault: k.fault }), h("small", {}, ` ±${(k.sigma * 5).toFixed(1)}`),
            h("small", { class: "sub" }, h("span", { class: `status-dot ${freshClass(k, e)}` }), knownFrom(k, e)))))))),
      shown.length > f.limit ? h("button", { class: "btn small", type: "button", onclick: () => { f.limit += 60; this.update(); } }, `Show ${Math.min(60, shown.length - f.limit)} more`) : null,
      chosen ? this._assetCard(sim, e, chosen) : h("p", { class: "hint" }, "Choose an asset for its record, its condition and the measures."),
      this._plans(e),
    ];
  }

  /** The record of an asset (asset information model) with what the role can do. */
  _assetCard(sim, e, a) {
    const k = e.known(a), rec = assetRecord(e, a);
    const il = a.interlocking ? e.assets.get(a.interlocking) : null;
    const can = (m) => (m === "retrofit" ? !!a.t.retrofit && a.retrofit < (a.t.retrofit.share ?? 0) : m === "modernize" ? a.type === "interlocking" ? a.generation !== "digital" : !!a.t.retrofit : true);
    const pending = e.proposals.find((p) => p.assets.includes(a.id) && ["proposed", "approved"].includes(p.status));
    const project = [...e.desk.projects.values()].find((p) => p.assets.includes(a.id) && !["done", "stopped"].includes(p.stage));
    const kv = (obj) => Object.entries(obj).filter(([, v]) => v != null && typeof v !== "object").map(([key, v]) => [h("dt", {}, key), h("dd", {}, String(v))]);
    const missing = Object.values(rec.Pset_ManufacturerOccurrence).filter((v) => v == null).length;
    return h("div", { class: "section infra-card", "aria-label": `Asset ${a.name}` },
      h("h3", { tabindex: "-1" }, a.name, " ", chip(k.value, { fault: k.fault })),
      h("p", { class: "hint" }, `${a.t.label} (${a.t.de}), ${DISCIPLINES[a.discipline].label}. ${k.fault ? `Fault: ${a.t.effect.what}. ` : ""}Known: grade ${gv(k.value)} ± ${(k.sigma * 5).toFixed(1)}, ${knownFrom(k, e)}.${this.role === "instructor" ? ` True: ${gv(1 + 4.99 * (1 - a.h))}.` : ""}`),
      h("p", { class: "hint" }, a.t.field
        ? `Its interlocking ${il ? `${il.name} (${GENERATIONS[il.generation]?.label})` : "–"} reports ${Math.round(a.liveShare(e.assets) * 100)} % of its condition live; faults: ${REPORTS[a.reportPath(e.assets)]}.`
        : `${Math.round(a.liveShare(e.assets) * 100)} % of its condition is reported live; faults: ${REPORTS[a.reportPath(e.assets)]}.`),
      h("dl", { class: "kv" },
        h("dt", {}, "IFC class"), h("dd", {}, `${rec.Class}.${rec.PredefinedType}`),
        h("dt", {}, "GlobalId"), h("dd", { class: "mono" }, rec.GlobalId),
        h("dt", {}, "Placement"), h("dd", {}, `${rec.Placement.Alignment}, ${rec.Placement.Distance}${rec.Placement.Length ? `, ${rec.Placement.Length}` : ""}${rec.Placement.Latitude ? ` (${rec.Placement.Latitude.toFixed(5)}° N, ${rec.Placement.Longitude.toFixed(5)}° E)` : ""}`),
        kv(rec.Pset_ManufacturerOccurrence), kv(rec.Pset_ServiceLife), kv(rec.Pset_Condition), kv(rec.ARail_Maintenance)),
      missing ? h("p", { class: "hint" }, `${missing} attribute${missing === 1 ? "" : "s"} of the manufacturer's data missing in the register (data ${Math.round(a.data * 100)} % complete): a renewal with BIM hands over complete data.`) : null,
      pending || project ? h("p", { class: "hint" }, project ? `In project ${project.id}: ${e.desk.stateText(project)}.` : `Proposed (${MEASURES[pending.measure].label.toLowerCase()}), ${pending.status}.`) : null,
      this.can("propose") && !pending && !project ? h("div", { class: "row" },
        h("span", { class: "row-label" }, "Propose"),
        ["repair", "renew", "modernize", "retrofit"].filter(can).map((m) => h("button", { class: "btn small", type: "button", title: `${MEASURES[m].de}: about ${eur(e.estimate(m, [a.id]))}`, onclick: () => this._propose(m, [a.id]) }, `${MEASURES[m].label} (${eur(e.estimate(m, [a.id]))})`))) : null,
      this.can("inspect") ? h("div", { class: "row" },
        h("span", { class: "row-label" }, "Inspect now"),
        Object.entries(METHODS).filter(([id, M]) => id !== "train" && (!M.types || M.types.includes(a.type)) && (id !== "drone" || a.t.drone > 0))
          .map(([id, M]) => h("button", { class: "btn small", type: "button", onclick: () => this._act("inspect", [a.id, id], `${M.label} of ${a.name} ordered`) }, M.label))) : null,
      this.role === "instructor" && !a.fault ? h("div", { class: "row" }, h("button", { class: "btn small", type: "button", onclick: () => this._act("fail", [a.id], `${a.name} fails`) }, "Make it fail now")) : null,
      a.on_layout ? h("p", { class: "hint" }, "It is on the layout: its label is shown there while it is chosen.") : null,
    );
  }

  _propose(measure, ids, upgrade = null) {
    const ok = this.sim.engine.act("propose", measure, ids, upgrade);
    toast(ok ? "Proposed: the asset manager decides." : "This cannot be proposed (already proposed, or not possible).");
    this.update();
  }

  _act(name, args, text) {
    const ok = this.sim.engine.act(name, ...args);
    toast(ok ? `${text}.` : "Not possible.");
    this.update();
  }

  /** The inspection plan per asset type (the ALVs change it). */
  _plans(e) {
    const editable = this.can("plan");
    const types = [...new Set(e.active().map((a) => a.type))];
    return h("div", { class: "section" },
      h("h2", {}, "Inspection plan"),
      h("p", { class: "hint" }, "How each type is inspected and how often. The rules (EBO § 17, the guidelines) ask for a minimum; the EBA audits the records once a year. Drones are cheap but see only part of the condition; measurement trains measure track geometry, overhead lines and radio coverage."),
      scroller("Inspection plan", h("table", { class: "ops-table" },
        h("thead", {}, h("tr", {}, ["Type", "Method", "A year", "At least"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, types.map((t) => {
          const p = e.plans[t], T = ASSET_TYPES[t];
          const methods = Object.entries(METHODS).filter(([id, M]) => (!M.types || M.types.includes(t)) && (id !== "drone" || T.drone > 0));
          return h("tr", {},
            h("th", { scope: "row" }, T.plural),
            h("td", {}, editable ? h("select", { "aria-label": `${T.plural}: method`, onchange: (ev) => this._act("plan", [t, ev.target.value, p.per_year], "Plan changed") },
              methods.map(([id, M]) => h("option", { value: id, selected: p.method === id }, M.label))) : METHODS[p.method].label),
            h("td", { class: "num" }, editable ? h("input", { type: "number", min: "0", max: "52", step: "0.5", value: String(p.per_year), "aria-label": `${T.plural}: inspections a year`, class: "num-input",
              onchange: (ev) => this._act("plan", [t, p.method, Number(ev.target.value)], "Plan changed") }) : String(p.per_year)),
            h("td", { class: "num" }, String(T.min_per_year)));
        })))));
  }

  /* ---------------------------------------------------------------- Decisions */

  _decisions(sim, e) {
    const mine = (i) => this.role === "instructor" || i.role === this.role;
    const all = e.inbox.filter((i) => !i.decided && mine(i)).sort((a, b) => a.deadline - b.deadline);
    const open = all.filter((i) => i.pause !== false);
    const findings = all.filter((i) => i.pause === false);
    const done = e.inbox.filter((i) => i.decided && mine(i) && i.decided.by !== "computer").slice(-10).reverse();
    return [
      h("p", { class: "hint" }, this.role === "instructor" ? "All decisions waiting. Roles played by the computer decide at once." : `Decisions for ${theRole(this.role)}. When the time is up, the default is taken.`),
      open.length || findings.length ? open.map((i) => h("div", { class: "section infra-decision" },
        h("h3", {}, i.title),
        h("p", { class: "hint" }, `${roleName(i.role)} · since ${e.dateText(i.created)} · default “${i.options.find((o) => o.id === i.def)?.label}” on ${e.dateText(i.deadline)}`),
        i.text ? h("p", {}, i.text) : null,
        i.data?.asset ? h("button", { class: "link", type: "button", onclick: () => { this._choose(i.data.asset); this.setView("assets"); } }, "Show the asset") : null,
        i.project ? h("button", { class: "link", type: "button", onclick: () => { this.projectChoice = i.project; this.setView("projects"); } }, `Show project ${i.project}`) : null,
        h("div", { class: "row" }, i.options.map((o) => h("button", {
          class: `btn small${o.id === i.def ? " primary" : ""}`, type: "button", disabled: !this.can("decide", i), title: o.hint || null,
          onclick: () => this._act("decide", [i.id, o.id], `${o.label}`),
        }, o.label, o.hint ? h("small", {}, ` · ${o.hint}`) : null))))) : h("p", { class: "hint" }, "Nothing to decide now. Run to the next decision, or watch the day on the layout."),
      findings.length ? h("div", { class: "section" },
        h("h2", {}, "Inspection findings ", h("span", { class: "count" }, `${findings.length}`)),
        h("p", { class: "hint" }, "Findings of inspections for the ALVs: keep watching, or propose a measure to the asset manager. They do not stop the run; when their time is up, the default is taken."),
        h("ul", { class: "infra-findings" }, findings.slice(0, 30).map((i) => this._findingRow(i)))) : null,
      done.length ? h("div", { class: "section" },
        h("h2", {}, "Decided"),
        h("ul", { class: "infra-done" }, done.map((i) => h("li", {}, h("time", {}, e.dateText(i.decided.t)), ` ${i.title.replace(/\?$/, "")}: `, h("b", {}, i.options.find((o) => o.id === i.decided.choice)?.label ?? i.decided.choice), i.decided.by === "default" ? " (time up, default)" : "")))) : null,
    ];
  }

  /** A row of the findings list: the asset, what was found, the choices. */
  _findingRow(i) {
    const buttons = i.options.map((o) => h("button", {
      class: `btn small${o.id === i.def ? " primary" : ""}`, type: "button", disabled: !this.can("decide", i),
      onclick: () => this._act("decide", [i.id, o.id], o.label),
    }, o.label));
    return h("li", {},
      h("button", { class: "link", type: "button", onclick: () => { this._choose(i.data.asset); this.setView("assets"); } }, i.title.replace(/^Finding: /, "")),
      h("small", { class: "sub" }, i.text),
      h("div", { class: "row" }, buttons));
  }

  /* ---------------------------------------------------------------- Projects */

  _projects(sim, e) {
    const list = [...e.desk.projects.values()].sort((a, b) => (["done", "stopped"].includes(a.stage) - ["done", "stopped"].includes(b.stage)) || b.created - a.created);
    const chosen = e.desk.projects.get(this.projectChoice) ?? list.find((p) => !["done", "stopped"].includes(p.stage)) ?? null;
    const proposals = e.proposals.filter((p) => p.status === "proposed");
    return [
      h("p", { class: "hint" }, "Renewals and upgrades go through the service phases of the HOAI (LPH 1–9), with funding, planning approval (AEG § 18: not for a like-for-like renewal), procurement, construction in a possession, acceptance and commissioning. Fees per phase: HOAI § 47 (Verkehrsanlagen)."),
      list.length ? scroller("Projects", h("table", { class: "ops-table infra-projects" },
        h("thead", {}, h("tr", {}, ["Project", "Phase", "Money", "Funding"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, list.map((p) => h("tr", { class: p === chosen ? "chosen" : null },
          h("th", { scope: "row" }, h("button", { class: "link", type: "button", onclick: () => { this.projectChoice = p.id; this.update(); } }, `${p.id} ${p.name}`)),
          h("td", {}, phaseBar(p), h("small", { class: "sub" }, e.desk.stateText(p))),
          h("td", { class: "nowrap" }, eur(p.price ?? p.calculation ?? p.estimate ?? p.base), p.claims ? h("small", { class: "sub" }, `+${eur(p.claims)} claims`) : null),
          h("td", {}, p.funding === "federal" ? "federal (NKV)" : "replacement", p.lc ? h("small", { class: "sub" }, "EKrG shares") : null)))))) : h("p", { class: "hint" }, "No projects yet: the ALVs propose renewals, the asset manager approves them."),
      chosen ? this._projectCard(e, chosen) : null,
      proposals.length ? h("div", { class: "section" }, h("h2", {}, "Proposals waiting for the asset manager"),
        h("ul", { class: "infra-done" }, proposals.map((p) => h("li", {}, `${MEASURES[p.measure].label}: ${p.measure === "upgrade" ? e.model.upgrades.find((u) => u.id === p.upgrade)?.name : p.assets.map((id) => e.assets.get(id)?.name).join(", ")} · ${eur(p.cost)}`)))) : null,
      this._upgrades(e),
    ];
  }

  _projectCard(e, p) {
    const o = p.options;
    const stages = p.history.map((x) => [h("dt", {}, e.dateText(x.t)), h("dd", {}, PROJECT_STAGES[x.stage]?.label ?? x.stage)]);
    return h("div", { class: "section infra-card" },
      h("h3", { tabindex: "-1" }, `${p.id} ${p.name}`),
      h("p", { class: "hint" }, `${MEASURES[p.measure].label} (${MEASURES[p.measure].de}) · ${e.desk.stateText(p)}`),
      h("dl", { class: "kv" },
        h("dt", {}, "Cost estimate"), h("dd", {}, p.estimate ? eur(p.estimate) : "after LPH 2"),
        h("dt", {}, "Cost calculation"), h("dd", {}, p.calculation ? eur(p.calculation) : "after LPH 3"),
        h("dt", {}, "Contract"), h("dd", {}, p.price ? `${eur(p.price)} with ${e.model.contractors.find((c) => c.id === p.contractor)?.name}` : "not awarded yet"),
        p.ratio != null ? [h("dt", {}, "Benefit-cost ratio"), h("dd", {}, p.ratio.toFixed(2))] : null,
        h("dt", {}, "Paid"), h("dd", {}, `planning ${eur(p.paid.planning)}, construction ${eur(p.paid.construction)}${p.received ? `; Bund ${eur(p.received)}` : ""}${p.partners ? `; crossing partners ${eur(p.partners)}` : ""}`),
        h("dt", {}, "Planning"), h("dd", {}, `${QUALITY[o.quality]?.label}, ${o.bim ? "with BIM (AIA)" : "without BIM"}`),
        h("dt", {}, "Procurement"), h("dd", {}, o.procedure ? PROCEDURES[o.procedure].label : "chosen in LPH 6"),
        h("dt", {}, "Possession"), h("dd", {}, o.possession === "short" ? "short notice" : p.possessionBooked != null ? `booked on ${e.dateText(p.possessionBooked)}` : "booked in LPH 5"),
        h("dt", {}, "Supervision"), h("dd", {}, SUPERVISION[o.supervision]?.label),
        p.bids.length ? [h("dt", {}, "Bids"), h("dd", {}, p.bids.map((b) => `${b.name} ${eur(b.price)}`).join("; "))] : null),
      h("h3", {}, "History"),
      h("dl", { class: "kv" }, stages));
  }

  /** Upgrades of the settings that the ALVs can propose. */
  _upgrades(e) {
    const ups = e.model.upgrades;
    if (!ups.length) return null;
    const f = e.model.funding;
    const af = f.discount_rate > 0 ? (1 - (1 + f.discount_rate) ** -f.horizon_y) / f.discount_rate : f.horizon_y;
    return h("div", { class: "section" },
      h("h2", {}, "Upgrades"),
      h("p", { class: "hint" }, `Upgrades change the railway: they need planning approval and federal money, which needs a benefit-cost ratio (NKV) of at least ${f.min_ratio.toFixed(1)} (benefits over ${f.horizon_y} years at ${(f.discount_rate * 100).toFixed(1)} %).`),
      h("ul", { class: "infra-upgrades" }, ups.map((u) => {
        const ratio = (u.benefit_eur_y * af) / (u.cost_eur * (1 + e.model.hoai.fee_share));
        const taken = e.proposals.some((p) => p.upgrade === u.id && p.status !== "declined") || [...e.desk.projects.values()].some((p) => p.upgrade === u.id && p.stage !== "stopped");
        return h("li", {},
          h("b", {}, u.name), ` · ${eur(u.cost_eur)}, benefits ${eur(u.benefit_eur_y)} a year, NKV about ${ratio.toFixed(2)}`,
          h("p", { class: "hint" }, u.description || ""),
          this.can("propose") && !taken ? h("button", { class: "btn small", type: "button", onclick: () => this._propose("upgrade", [], u.id) }, "Propose") : taken ? h("small", {}, "proposed") : null);
      })));
  }

  /* ---------------------------------------------------------------- Staff */

  _staff(sim, e) {
    const now = e.now;
    const people = e.people.filter((p) => p.employed(now));
    const count = (d, role) => people.filter((p) => p.discipline === d && p.role === role && p.left == null).length;
    const editable = this.can("staff");
    const step = (d, role, n) => this._act("staff", [d, role, n], "Staffing changed");
    return [
      h("p", { class: "hint" }, `Day shift ${e.model.staff.day_shift.from}–${e.model.staff.day_shift.to} Mon–Fri: inspections and repairs. Emergency teams (Entstörer) work early, late and night shifts in a ten-day cycle: five people keep one van ready around the clock. Outside the shifts a technician of each discipline is on call from home (${e.model.staff.oncall_alert_min} min to set off); without anybody a contractor comes (${durationText(e.model.costs.contractor_callout_min)}).`),
      scroller("Staff per discipline", h("table", { class: "ops-table" },
        h("thead", {}, h("tr", {}, ["Discipline", "ALV", "Day shift", "Emergency team", "On call now"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, DISCIPLINE_IDS.map((d) => {
          const alv = people.find((p) => p.discipline === d && p.role === "alv");
          const oc = people.find((p) => p.discipline === d && p.role === "day" && e.activity(p).state === "oncall");
          const cell = (role) => {
            const n = count(d, role);
            return h("td", { class: "nowrap" }, editable ? [
              h("button", { class: "btn small icon", type: "button", "aria-label": `${DISCIPLINES[d].short} ${role}: one less`, disabled: n === 0, onclick: () => step(d, role, n - 1) }, "−"),
              h("span", { class: "count-num" }, ` ${n} `),
              h("button", { class: "btn small icon", type: "button", "aria-label": `${DISCIPLINES[d].short} ${role}: one more`, onclick: () => step(d, role, n + 1) }, "+"),
            ] : String(n));
          };
          return h("tr", {}, h("th", { scope: "row" }, DISCIPLINES[d].label), h("td", {}, alv?.name ?? "–"), cell("day"), cell("emergency"), h("td", {}, oc?.name ?? (e.model.staff.oncall ? "–" : "off")));
        })))),
      h("div", { class: "row" },
        h("label", { class: "field check", for: "infraOncall" }, h("input", { type: "checkbox", id: "infraOncall", checked: e.model.staff.oncall, disabled: !this.can("oncall"), onchange: (ev) => this._act("oncall", [ev.target.checked], ev.target.checked ? "On-call duty on" : "On-call duty off") }), "On-call duty outside the shifts"),
        h("span", {}, `Drone pilots: ${people.filter((p) => p.role === "pilot").length}`),
        this.can("pilots") ? h("button", { class: "btn small", type: "button", onclick: () => this._act("pilots", [people.filter((p) => p.role === "pilot").length + 1], "A drone pilot will be hired") }, "Hire a pilot") : null),
      h("p", { class: "hint" }, `New people start after about ${Math.round(e.model.staff.hire_days / 30)} months. A person costs ${eur(e.model.costs.person_year_eur)} a year; overtime ${Math.round(e.model.costs.overtime_factor * 100)} %.`),
      h("h3", {}, "Now"),
      scroller("Staff now", h("table", { class: "ops-table" },
        h("thead", {}, h("tr", {}, ["Name", "Role", "Doing"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, people.filter((p) => p.role !== "alv").map((p) => {
          const a = e.activity(p);
          return h("tr", {}, h("th", { scope: "row" }, p.name), h("td", {}, roleLabel(p)), h("td", {}, h("span", { class: `status-dot ${a.state === "repairing" || a.state === "alerted" ? "bad" : a.state === "driving" || a.state === "working" || a.state === "flying" ? "warn" : a.state === "base" ? "ok" : ""}` }), a.text));
        })))),
      this._plant(e),
    ];
  }

  _plant(e) {
    const f = e.factory;
    const orders = f.orders.filter((o) => o.stage !== "done").slice(0, 12);
    return h("div", { class: "section" },
      h("h2", {}, e.model.factory.name, h("span", { class: "count" }, ` ${f.lines} production lines · about ${f.leadWeeks()} weeks for a new order`)),
      h("p", { class: "hint" }, "Level crossing systems (half barriers, road lights, controller cabinet) are built to order: engineering, production, factory test (sometimes failed: rework), delivery. The plant also builds for other customers."),
      orders.length ? scroller("Plant orders", h("table", { class: "ops-table" },
        h("thead", {}, h("tr", {}, ["Order", "For", "Stage", "Until"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, orders.map((o) => h("tr", {}, h("th", { scope: "row" }, o.id), h("td", {}, o.project ? `${o.project} ${o.name}` : "another customer"), h("td", {}, o.stage === "queued" ? "waiting" : o.stage), h("td", {}, o.stageEnd ? e.dateText(o.stageEnd) : "–")))))) : h("p", { class: "hint" }, "No orders."));
  }

  /* ---------------------------------------------------------------- Results */

  _results(sim, e) {
    const years = e.years.slice();
    const cur = e.current();
    const showTrue = this.role === "instructor" || e.finished;
    const rows = [
      ["Network grade (true)", (y) => y.grade?.toFixed(2) ?? "–", showTrue],
      ["Network grade (known)", (y) => y.knownGrade?.toFixed(2) ?? "–", true],
      ["Faults", (y) => y.faults, true],
      ["Delay minutes", (y) => y.delayMin?.toLocaleString("en"), true],
      ["… by construction", (y) => (y.constructionDelayMin ?? 0).toLocaleString("en"), true],
      ["Speed restrictions", (y) => y.laSections, true],
      ["Performance regime", (y) => eur(y.perfEur), true],
      ["Station equipment out (h)", (y) => y.stationHours, true],
      ["Response time (min)", (y) => Math.round(y.response || 0), true],
      ["Time to repair", (y) => durationText(y.restore), true],
      ["Contractor call-outs", (y) => y.contractorCallouts, true],
      ["Overtime (h)", (y) => y.overtimeH, true],
      ["Inspections", (y) => y.inspections, true],
      ["Inspections on time", (y) => (y.compliance != null ? `${Math.round(y.compliance * 100)} %` : "–"), true],
      ["Known to ±0.5 grade", (y) => (y.informed != null ? `${Math.round(y.informed * 100)} %` : "–"), true],
      ["Projects completed", (y) => y.projectsDone ?? "–", true],
      ["Maintenance money left", (y) => eur(y.balance.maintenance), true],
      ["Replacement money unspent", (y) => (y.unspent != null ? eur(y.unspent) : eur(y.balance.replacement)), true],
      ["Score", (y) => (y.score ? Math.round(y.score.total) : "–"), true],
    ].filter((r) => r[2]);
    const cols = [...years, ...(e.finished ? [] : [{ ...cur, current: true }])];
    const scenarios = scenariosOf(sim.config);
    return [
      h("p", { class: "hint" }, "Per year: condition, reliability, money, rules and information. The score weighs them (condition 30, reliability 25, money 15, rules 15, information 15); teams that play the same scenario with the same seed meet the same random events."),
      scroller("Results per year", h("table", { class: "ops-table ops-compare" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Key figure"), cols.map((y) => h("th", { scope: "col" }, `${y.year}${y.current ? " so far" : ""}`)))),
        h("tbody", {}, rows.map(([label, f]) => h("tr", {}, h("th", { scope: "row" }, label), cols.map((y) => h("td", { class: "num" }, String(f(y) ?? "–")))))))),
      years.length ? h("div", { class: "section" }, h("h2", {}, "Score"), scroller("Score parts", h("table", { class: "ops-table" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Part"), years.map((y) => h("th", { scope: "col" }, String(y.year))))),
        h("tbody", {}, ["condition", "reliability", "money", "rules", "information", "total"].map((k) => h("tr", {}, h("th", { scope: "row" }, k), years.map((y) => h("td", { class: "num" }, String(Math.round(y.score[k])))))))))) : null,
      this._money(e),
      h("div", { class: "section" },
        h("h2", {}, "The game"),
        h("div", { class: "row" },
          h("button", { class: "btn small", type: "button", id: "infraCsv", onclick: () => download(`${slug(e.model.name)}-results.csv`, resultsCSV(e), "text/csv") }, "Download results (CSV)"),
          h("button", { class: "btn small", type: "button", id: "infraSave", onclick: () => download(`${slug(e.model.name)}-game.json`, JSON.stringify(sim.save(), null, 1)) }, "Save the game"),
          h("label", { class: "btn small", for: "infraLoad" }, "Load a game"),
          h("input", { type: "file", id: "infraLoad", accept: ".json,application/json", class: "visually-hidden", onchange: (ev) => this._loadGame(ev) })),
        this.role === "instructor" ? [
          h("div", { class: "fields" },
            h("label", { class: "field", for: "infraScenario" }, h("span", {}, "Scenario"),
              h("select", { id: "infraScenario", onchange: (ev) => { this.scenario = ev.target.value; this.update(); } }, scenarios.map((x) => h("option", { value: x.id, selected: x.id === this.scenario }, x.name))))),
          h("p", { class: "hint" }, scenarios.find((x) => x.id === this.scenario)?.description ?? ""),
          h("button", { class: "btn small", type: "button", id: "infraNew", onclick: () => this._newGame() }, "Start a new game"),
          h("h3", {}, "Who plays which role"),
          h("div", { class: "infra-roles" }, ROLE_IDS.map((r) => h("label", { class: "field check", for: `infraRoleWho-${r}` },
            h("input", { type: "checkbox", id: `infraRoleWho-${r}`, checked: e.roles[r] === "student", onchange: (ev) => this._act("role", [r, ev.target.checked ? "student" : "computer"], `${ROLES[r].label}: ${ev.target.checked ? "students" : "the computer"}`) }),
            `${ROLES[r].label} played by students`))),
        ] : h("p", { class: "hint" }, "The instructor starts new games and sets who plays which role.")),
    ];
  }

  _money(e) {
    const cur = e.current();
    const cats = Object.entries(cur.spent).sort((a, b) => b[1] - a[1]);
    return h("div", { class: "section" },
      h("h2", {}, `Money ${cur.year}`),
      h("dl", { class: "kv" },
        h("dt", {}, "Maintenance (own)"), h("dd", {}, `${eur(e.balance.maintenance)} left of ${eur(e.budget.maintenance)}`),
        h("dt", {}, "Replacement (federal, LuFV)"), h("dd", {}, `${eur(e.balance.replacement)} left of ${eur(e.budget.replacement)}`),
        h("dt", {}, "Own investment"), h("dd", {}, `${eur(e.balance.own)} left of ${eur(e.budget.own)}`),
        h("dt", {}, "From the Bund for upgrades"), h("dd", {}, eur(cur.received.federal || 0)),
        h("dt", {}, "From crossing partners (EKrG)"), h("dd", {}, eur(cur.received.partners || 0))),
      cats.length ? h("dl", { class: "kv" }, cats.map(([k, v]) => [h("dt", {}, k), h("dd", {}, eur(v))])) : null);
  }

  async _loadGame(ev) {
    const f = ev.target.files?.[0];
    ev.target.value = "";
    if (!f) return;
    try {
      const saved = JSON.parse(await readFile(f));
      if (!this.sim?.load(saved)) throw new Error("this is not a saved infrastructure game");
      toast(`Game loaded: ${this.sim.engine.timeText()}.`);
    } catch (err) {
      toast(`The game could not be loaded: ${err.message}`, 7000);
    }
    this.update();
  }

  _newGame() {
    const sim = this.sim;
    if (!sim) return;
    sim.newGame({ scenario: this.scenario === "none" ? null : this.scenario });
    storage.remove(this._key());
    this.message = "";
    toast(`A new game starts on ${sim.engine.dateText()}.`);
    this.update();
  }
}

/* ---------------------------------------------------------------- helpers */

const slug = (s) => String(s || "infrastructure").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Where the knowledge of an asset comes from, in words. */
function knownFrom(k, e) {
  if (k.fault) return "a fault is reported";
  const live = k.live >= 0.5 ? `live (${Math.round(k.live * 100)} %)` : null;
  if (k.source === "age") return live ?? "only its age";
  if (k.source === "unknown") return live ?? "a guess (year unknown)";
  const months = Math.round((e.now - k.t) / (30.4 * DAY));
  const what = METHODS[k.source]?.label.toLowerCase() ?? k.source;
  return `${live ? `${live}; ` : ""}${what} ${months < 1 ? "this month" : `${months} mo ago`}`;
}

function freshClass(k, e) {
  if (k.live >= 0.5) return "ok";
  if (k.t == null) return "bad";
  const months = (e.now - k.t) / (30.4 * DAY);
  return months <= 12 ? "ok" : months <= 24 ? "warn" : "bad";
}

/** The legend of the colours on the layout and the map. */
function legend(mode) {
  if (mode === "off") return null;
  if (mode === "checked") {
    return h("p", { class: "infra-legend" }, "Colour: age of the last check — ", [["live or this month", 1], ["6 months", 2], ["a year", 3], ["18 months", 4], ["2 years or never", 5]].map(([l, g]) => h("span", {}, h("i", { style: { background: gradeColour(g) } }), l)));
  }
  return h("p", { class: "infra-legend" },
    [1, 2, 3, 4, 5].map((g) => h("span", {}, h("i", { style: { background: gradeColour(g) } }), `${g}`)),
    h("span", {}, h("i", { class: "fault" }), "fault (6)"),
    h("span", {}, h("i", { class: "ring solid" }), "known well"), h("span", {}, h("i", { class: "ring dashed" }), "checked long ago"), h("span", {}, h("i", { class: "ring dotted" }), "only its age"));
}

/** The nine HOAI phases of a project: done, current, to come. */
function phaseBar(p) {
  const lph = PROJECT_STAGES[p.stage]?.lph ?? (p.stage === "done" ? 10 : p.stage === "lph9" ? 9 : null);
  const reached = Math.max(0, ...p.history.map((x) => PROJECT_STAGES[x.stage]?.lph ?? 0), p.stage === "done" ? 10 : 0);
  return h("span", { class: `phase-bar${p.stage === "stopped" ? " stopped" : ""}`, role: "img", "aria-label": `HOAI phase ${Math.min(9, reached)} of 9` },
    Array.from({ length: 9 }, (_, i) => h("i", { class: i + 1 < reached || p.stage === "done" ? "done" : i + 1 === (lph ?? reached) ? "now" : "" })));
}

/** The results of the years as CSV. */
function resultsCSV(e) {
  const keys = ["year", "grade", "knownGrade", "faults", "delayMin", "constructionDelayMin", "cancelled", "laSections", "perfEur", "stationHours", "response", "restore", "callouts", "nightCallouts", "contractorCallouts", "overtimeH", "inspections", "droneFlights", "trainRuns", "compliance", "informed", "projectsDone", "unspent", "withheld", "auditFine"];
  const lines = [[...keys, "score", "condition", "reliability", "money", "rules", "information"].join(",")];
  for (const y of e.years) lines.push([...keys.map((k) => (typeof y[k] === "number" ? Math.round(y[k] * 1000) / 1000 : y[k] ?? "")), ...["total", "condition", "reliability", "money", "rules", "information"].map((k) => Math.round(y.score[k] * 10) / 10)].join(","));
  return lines.join("\n") + "\n";
}
