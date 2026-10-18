// The builder: a street and layout editor of its own, beside the app. The layout is a plan seen
// from above (plan.js); streets are drawn point by point and join where they meet, each with the
// cross-section and the widths chosen with the street tools (objects/street-profile.js), bus stops,
// truck lanes and buildings are put where a street reaches them (place.js), and the Problems tab
// lists what has no street to it (arail/core/access.js), each with its fix. Undo and redo keep the
// whole layout; unpushed changes are kept in the browser as a draft. A push commits the layout and
// the covered photos chosen in the Photos tab to GitHub in one commit (github.js), each file
// changed only where it was edited (json-text.js). The app's Build tab stays as it is.
import * as ARail from "../arail/index.js";
import { $, h, mount, morph, paramFields, readFile, storage, toast } from "../app/ui.js";
import { addTexts, chooseLanguage, setLanguage, tr, translateDocument } from "../app/i18n.js";
import { GitHub, GitHubError } from "./github.js";
import { History } from "./history.js";
import { formatNew, mergeChanges, sameJSON, stringifyLike } from "./json-text.js";
import { facesStreet, placeSpec, pointsOf, snapStreetPoint } from "./place.js";
import { PlanView } from "./plan.js";

/** Where pushes go. `?repo=owner/name&branch=…` for a fork. */
const params = new URLSearchParams(location.search);
const [OWNER, REPO] = (params.get("repo") || "joernmht/ARail-EBL").split("/");
const BRANCH = params.get("branch") || "main";
/** The site's root (web/ in the repository). */
const SITE = new URL("../", import.meta.url);
/** The example layouts (more are found on GitHub). */
const EXAMPLES = ["ebl-neustadt", "ebl-lab", "container-terminal", "ebl-container-train"];
/** The photo map, whose photos can have covered versions. */
const PHOTO_MAP = "web/lab-map/data.json";

const KEY = { draft: "arail.builder.draft", token: "arail.builder.token", last: "arail.builder.last", view: "arail.builder.view", street: "arail.builder.street" };

/** The repository path of a URL of the site ("web/…"), or null. */
export const repoPathOf = (url) => (String(url).startsWith(SITE.href) ? `web/${decodeURI(String(url).slice(SITE.href.length).split(/[?#]/)[0])}` : null);
/** The URL on the site of a repository path ("web/…"). */
export const siteUrlOf = (path) => new URL(String(path).replace(/^web\//, ""), SITE).href;

/**
 * The tools on the left: streets, then what needs a street. Without a label: the label of the type.
 * Types the registry does not have are left out.
 */
const TOOLS = [
  {
    group: "Streets", items: [
      { id: "select", label: "Select and move", key: "v" },
      { id: "road:street", type: "road", kind: "street", label: "Street", key: "s" },
      { id: "road:residential", type: "road", kind: "residential", label: "Residential street" },
      { id: "road:main", type: "road", kind: "main", label: "Main road" },
      { id: "road:path", type: "road", kind: "path", label: "Footpath or bike path", key: "f" },
      { id: "road:tram", type: "road", kind: "tram", label: "Tram track", key: "t" },
      { id: "underpass", type: "underpass" },
    ],
  },
  {
    group: "On the street", items: [
      { id: "traffic-sign", type: "traffic-sign" },
      { id: "traffic-light", type: "traffic-light" },
      { id: "zebra-crossing", type: "zebra-crossing" },
      { id: "rail-crossing", type: "rail-crossing" },
    ],
  },
  {
    group: "Needs a street", items: [
      { id: "bus-stop", type: "bus-stop", key: "b" },
      { id: "bus-terminal", type: "bus-terminal" },
      { id: "bus-line", type: "bus-line" },
      { id: "tram-stop", type: "tram-stop" },
      { id: "tram-line", type: "tram-line" },
      { id: "parking-lot", type: "parking-lot" },
      { id: "parking-garage", type: "parking-garage" },
      { id: "truck-lane", type: "truck-lane" },
      { id: "station-building", type: "station-building" },
      { id: "house", type: "house" },
      { id: "building", type: "building" },
    ],
  },
];

/** The settings of a new street the street tools offer (objects/road.js); the others keep their defaults. */
const STREET_SETTINGS = ["profile", "width_m", "lanes", "sidewalk_m", "bike_m", "tram", "tram_tracks", "parking", "parking_sides"];

/** Placing hints by placement. */
const HINTS = {
  street: "Click the points of the street. It joins other streets where it touches their ends or lines. Double-click or Enter finishes, Backspace takes the last point back, Esc stops. Shift: in steps of 15°.",
  point: "Click where it goes.",
  needsStreet: "Click next to a street: it is put on that street, facing it.",
  segment: "Click both ends.",
  rect: "Click two opposite corners.",
  polyline: "Click the points. Double-click or Enter finishes, Backspace takes the last point back, Esc stops.",
  polygon: "Click the corners. Double-click or Enter finishes, Backspace takes the last point back, Esc stops.",
  stops: "Click the bus stops (or bus terminals) in the order the buses serve them. Double-click or Enter finishes.",
  tramStops: "Click the tram stops in the order the trams serve them. Double-click or Enter finishes.",
  select: "Click an element to change it, drag it to move it. Drag the plan to move it, the wheel zooms.",
};

/** Placing hints of elements that go on a street, by type. */
const TYPE_HINTS = {
  "tram-stop": "Click on the tram tracks of a street (or on a tram track): the stop lines up with them.",
  "traffic-sign": "Click beside the street, on the side of the traffic it is for.",
  "traffic-light": "Click on the junction.",
  "zebra-crossing": "Click on the street where people cross.",
  "rail-crossing": "Click where the street crosses the railway track.",
};

const round1 = (v) => Math.round(v * 10) / 10;
const DRAG_PX = 4;
/** "1 error", "3 errors" (the German catalogue has both). */
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : word.endsWith("x") ? "es" : "s"}`;
/** The kinds of streets, as in Build (objects/road.js). */
const KIND_LABELS = { street: "street (50 km/h)", residential: "residential street (30 km/h)", main: "main road (50 km/h, wider)", path: "footpath (no cars)", tram: "tram track of its own (no street)" };

/** Names of the strips of a cross-section (objects/street-profile.js), with their width. */
const STRIP_NAMES = {
  "car-lane": "Car lanes {n} m", "tram-lane": "Tram lanes {n} m", "tram-bed": "Track bed {n} m", "advisory-lane": "Advisory bike lane {n} m",
  "bike-lane": "Bike lane {n} m", parking: "Parking {n} m", buffer: "Safety strip {n} m", "bike-path": "Bike path {n} m",
  "shared-path": "Shared path {n} m", sidewalk: "Sidewalk {n} m", path: "Path {n} m",
};
const metres = (m) => String(Math.round(m * 100) / 100);
const SVG_NS = "http://www.w3.org/2000/svg";

/** An SVG element. */
function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

/**
 * A street's cross-section as a figure: its strips side by side as seen in the direction it was
 * drawn (its left side on the left), raised where they are at sidewalk level, the rails of its tram
 * tracks; below, the strips with their widths in words and the width in all.
 * @param {object} cs a cross-section (ARail.crossSection)
 * @param {string} kind the street's kind
 */
export function crossSectionFigure(cs, kind) {
  const total = 2 * cs.half;
  if (!(total > 0)) return null;
  const strips = cs.strips.filter((st) => st.width > 1e-6);
  // across the street from its left edge (0) to its right edge (total), in metres
  const across = (st) => (st.side > 0 ? [cs.half - st.to, cs.half - st.from] : [cs.half + st.from, cs.half + st.to]);
  const W = 600, k = W / total, top = { sidewalk: 6, bed: 10, street: 12 }, H = 30;
  const shapes = strips.map((st) => {
    const [a, b] = across(st), y = top[st.level] ?? 12;
    return svg("rect", { x: (a * k).toFixed(1), y, width: Math.max(0.5, (b - a) * k).toFixed(1), height: H - y, fill: ARail.stripColour(st, kind) });
  });
  // the rails: two per track
  const rails = [];
  if (cs.tram !== "none") {
    const tracks = cs.tramTracks === "double" ? [-cs.tramOffset, cs.tramOffset] : [0];
    const y = cs.tram === "median" || cs.tram === "own" ? top.bed : top.street;
    for (const t of tracks) for (const r of [-ARail.GAUGE_M / 2, ARail.GAUGE_M / 2]) rails.push(svg("rect", { x: ((cs.half + t + r) * k - 1).toFixed(1), y: y - 1.5, width: 2, height: 2.5, fill: ARail.PALETTE.rail }));
  }
  // the parts in words, from the left edge: equal neighbours (the car lanes of both directions) as one
  const parts = [];
  for (const st of [...strips].filter((x) => x.type !== "curb").sort((a, b) => across(a)[0] - across(b)[0])) {
    const last = parts[parts.length - 1];
    if (last && last.type === st.type && st.type !== "sidewalk" && st.type !== "buffer" && Math.abs(last.to - across(st)[0]) < 1e-6) {
      last.to = across(st)[1];
      last.width += st.width;
    } else parts.push({ type: st.type, to: across(st)[1], width: st.width });
  }
  const words = parts.map((x) => (STRIP_NAMES[x.type] || `${x.type} {n} m`).replace("{n}", metres(x.width)));
  const label = `${words.join(" · ")}: ${metres(total)} m in all`;
  return h("figure", { class: "cross-section" },
    svg("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img", "aria-label": tr(label) }, shapes, rails),
    h("figcaption", {}, h("span", {}, words.join(" · ")), h("b", {}, `${metres(total)} m in all`)));
}

class Builder {
  constructor() {
    setLanguage(chooseLanguage());
    translateDocument(["#bar", ".plan-tools", "#panel > .tabs", ".skip-link", "#plan"]);
    $("#tools").setAttribute("aria-label", tr("Tools")); // its buttons are made in the language shown
    this.world = new ARail.World({ registry: ARail.registry, layout: {} });
    this.plan = new PlanView($("#plan"), { onRender: (ctx) => this.drawMarks(ctx) });
    this.history = new History();
    /** The file opened: {path, url, text, json, baseline, from}. */
    this.doc = null;
    this.tool = TOOLS[0].items[0];
    /** While placing: {cls, kind, points, hover}. */
    this.placing = null;
    /** The settings of new streets by kind (cross-section, widths, trams, parking), kept on this device. */
    this.streetSettings = storage.get(KEY.street, {}) || {};
    this.selectedId = null;
    /** The corner of the selected street being dragged or chosen: index, or null. */
    this.vertex = null;
    this.problems = [];
    this.tab = "element";
    /** Covered photos to push: key → {label, path, link, bytes, url (preview), apply(json)}. */
    this.covers = new Map();
    /** The photo map: {text, json} once read. */
    this.photoMap = null;
    this.github = new GitHub({ owner: OWNER, repo: REPO, branch: BRANCH, token: this._readToken() });
    this.pointers = new Map();
    const view = storage.get(KEY.view, {});
    if (view.simple) this.plan.simple = true;
    if (view.ortho === false) this.plan.showOrtho = false;
    if (view.grid === false) this.plan.grid = false;
    this._bind();
    this.renderTools();
    this.setTab("element");
    new ResizeObserver(() => document.documentElement.style.setProperty("--bar-h", `${$("#bar").offsetHeight}px`)).observe($("#bar"));
    window.__builder = this;
  }

  /* ---------------------------------------------------------------- the file */

  /** The layout to open first: ?layout=, else the one opened last, else Bf Neustadt. */
  start() {
    const url = params.get("layout");
    if (url) return this.open({ url: new URL(url, location.href).href });
    const last = storage.get(KEY.last, null);
    return this.open(last?.path ? { path: last.path } : { path: `web/layouts/${EXAMPLES[0]}.json` });
  }

  /**
   * Open a layout: from the site (or with a token from GitHub, the newest), from a file on this
   * device, or a new one. Unpushed changes of it kept in the browser come back.
   * @param {{url?: string, path?: string, file?: File, fresh?: {name: string, scale: number}, fromGitHub?: boolean}} what
   */
  async open(what) {
    let text, url, path, from;
    try {
      if (what.fresh) {
        const slug = slugOf(what.fresh.name) || "layout";
        path = `web/layouts/${slug}.json`;
        url = siteUrlOf(path);
        const json = newLayout(what.fresh);
        text = null;
        from = "new";
        await this._load({ json, text, url, path, from });
        this.changed({ keep: true });
        return true;
      }
      if (what.file) {
        text = await readFile(what.file);
        path = `web/layouts/${slugOf(what.file.name.replace(/\.json$/i, "")) || "layout"}.json`;
        url = siteUrlOf(path);
        from = "file";
      } else {
        path = what.path || repoPathOf(what.url);
        url = what.url || siteUrlOf(path);
        if ((what.fromGitHub || this.github.token) && path) {
          try {
            text = (await this.github.readText(path)).text;
            from = "github";
          } catch (err) {
            if (what.fromGitHub) throw err;
          }
        }
        if (text == null) {
          const res = await fetch(url, { cache: "no-cache" });
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          text = await res.text();
          from = "site";
        }
      }
      const json = JSON.parse(text);
      if (!ARail.isLayout(json)) throw new Error("This is not an ARail layout file.");
      await this._load({ json, text, url, path, from });
    } catch (err) {
      toast(`The layout could not be opened: ${err.message}`, 8000);
      return false;
    }
    // unpushed changes of this file, made on the version opened now
    const draft = storage.get(KEY.draft, null);
    if (draft && draft.path === this.doc.path && draft.text === this.doc.text && draft.current) {
      try {
        this._restore(JSON.stringify(draft.current));
        this.history.push(JSON.stringify(draft.current));
        this.changed({ keep: true });
        toast("Your unpushed changes to this layout were restored. Undo takes them back one by one.", 7000);
      } catch (err) {
        console.warn("The draft could not be restored:", err);
      }
    }
    return true;
  }

  async _load({ json, text, url, path, from }) {
    const plugins = ARail.layoutPlugins(json);
    if (plugins.length) {
      const errors = await ARail.loadPlugins(plugins, url);
      if (errors.length) toast(`Plugins could not be loaded: ${errors.join("; ")}`, 8000);
      addTexts();
    }
    this.world.load(json);
    const baseline = this.world.toJSON();
    this.doc = { path, url, text, json, baseline, from };
    this.history.reset(JSON.stringify(baseline));
    this.covers.clear();
    this.selectedId = null;
    this.vertex = null;
    this.cancelPlacing();
    storage.set(KEY.last, { path });
    $("#layoutName").textContent = this.world.layout.name || path;
    document.title = `${this.world.layout.name || path} · ${tr("ARail Builder")}`;
    $("#btnApp").href = `../app/?layout=${encodeURIComponent(new URL(url).href.startsWith(SITE.href) ? `../${new URL(url).href.slice(SITE.href.length)}` : url)}`;
    this.plan.setWorld(this.world, url);
    this.plan.fit(ARail.layoutBounds(this.world));
    this.photoMap = null;
    this.refresh();
  }

  /** Load a state of the layout (undo, redo, a draft): the modules on stay as they are. */
  _restore(state) {
    this.world.load(JSON.parse(state));
    if (this.selectedId && !this.world.getObject(this.selectedId)) this.selectedId = null;
    this.vertex = null;
  }

  /** The file's text with the changes, or null if nothing changed. */
  fileText() {
    const current = this.world.toJSON();
    // which modules are shown here is no change of the layout
    for (const l of current.layers || []) {
      const b = this.doc.baseline.layers?.find((x) => x.id === l.id);
      if (b) l.enabled = b.enabled;
    }
    const merged = mergeChanges(this.doc.json, this.doc.baseline, current);
    if (this.doc.text == null) return formatNew(merged); // a new file: without the defaults the world fills in
    return sameJSON(merged, this.doc.json) ? null : stringifyLike(this.doc.text, merged);
  }

  /** How many changes there are since the file was opened (undo steps). */
  get dirty() {
    return this.history.at > 0 || this.doc?.from === "new" || this.doc?.from === "file" || this.covers.size > 0;
  }

  /**
   * After every change: remember it (undo, the draft in the browser), check the layout again and
   * show it. `keep`: no new undo step (an undo, a redo, a draft restored).
   */
  changed({ keep = false } = {}) {
    if (!keep) this.history.push(JSON.stringify(this.world.toJSON()));
    if (this.doc) {
      if (this.history.at > 0 || this.doc.from === "new") storage.set(KEY.draft, { path: this.doc.path, text: this.doc.text, current: this.world.toJSON(), time: Date.now() });
      else storage.remove(KEY.draft);
    }
    this.refresh();
  }

  undo() {
    const s = this.history.undo();
    if (s == null) return;
    this._restore(s);
    this.changed({ keep: true });
  }

  redo() {
    const s = this.history.redo();
    if (s == null) return;
    this._restore(s);
    this.changed({ keep: true });
  }

  /** Check the layout and show everything again. */
  refresh() {
    this.problems = this.checkLayout();
    this.plan.selected = this.selected;
    this.plan.redraw();
    this.renderPanel();
    this.renderBar();
  }

  /**
   * What is wrong: the street access (arail/core/access.js), what elements say of themselves
   * (`problems()`), and the layout file. [{key, level, id, text, at, fix}]
   */
  checkLayout() {
    const out = [];
    try {
      out.push(...ARail.accessProblems(this.world));
    } catch (err) {
      console.warn("The street access could not be checked:", err);
    }
    for (const o of this.world.objects) {
      let list = [];
      try {
        list = typeof o.problems === "function" ? o.problems() || [] : [];
      } catch {
        list = [];
      }
      const at = o.anchorPoint?.() || o.geometry?.center || null;
      list.forEach((text, i) => out.push({ key: `object:${o.id}:${i}`, level: /not|cannot|no /i.test(text) ? "error" : "warning", id: o.id, text, at, fix: null }));
    }
    for (const text of ARail.validateLayout(this.world.toJSON(), this.world.registry)) out.push({ key: `layout:${text}`, level: "error", id: null, text, at: null, fix: null });
    return out;
  }

  get selected() {
    return this.selectedId ? this.world.getObject(this.selectedId) : null;
  }

  select(obj, { show = false } = {}) {
    this.selectedId = obj?.id ?? null;
    this.vertex = null;
    if (obj) this.setTab("element");
    if (obj && show) {
      const p = obj.anchorPoint?.() || obj.geometry?.center;
      if (p) this.plan.focus(p);
    }
    this.refresh();
  }

  /* ---------------------------------------------------------------- tools */

  /** Choose a tool: select, or place an element (a street of a kind). */
  useTool(tool) {
    this.tool = tool;
    this.cancelPlacing();
    if (tool.type) {
      const cls = this.world.registry.objects.get(tool.type);
      if (!cls) return;
      this.placing = { cls, kind: tool.kind || null, points: [], hover: null };
      this.select(null);
    }
    this.renderTools();
    this.renderHint();
    this.renderPanel();
    $("#plan").classList.toggle("select", !this.placing);
    $("#plan").focus({ preventScroll: true });
  }

  cancelPlacing() {
    this.placing = null;
    this.renderHint();
    this.plan.redraw();
  }

  /** Is the class placed like a street (its points join the streets)? */
  _isStreet(cls) {
    return typeof cls?.prototype?.roadInfo === "function";
  }

  /** Where the next point goes (snapped), for a pointer at the layout point p. */
  _placePoint(p, e) {
    const pl = this.placing, cls = pl.cls;
    if (cls.placement === "stops") return p;
    if (this._isStreet(cls) && !e?.altKey) {
      const own = pl.points;
      const snap = snapStreetPoint(this.world, p, { tolMM: this.plan.mmOfPx(12), grid: this._grid(e), own, angleFrom: e?.shiftKey && own.length ? own[own.length - 1] : null });
      pl.snap = snap.snap;
      return snap.point;
    }
    pl.snap = null;
    const g = this._grid(e);
    return g ? ARail.snapToGrid(p, g).map(round1) : p.map(round1);
  }

  /** The grid to snap to: while it is shown and the layout snaps (Alt: not). */
  _grid(e) {
    return !e?.altKey && this.plan.grid && this.world.layout.grid?.snap !== false ? this.world.layout.grid?.size_mm || 50 : null;
  }

  /** A click while placing. */
  _addPoint(p, e) {
    const pl = this.placing;
    if (pl.cls.placement === "stops") {
      const types = pl.cls.stopTypes || ["bus-stop", "bus-terminal"];
      const hit = this.hitTest(p, (o) => types.includes(o.type));
      if (!hit) return toast(types.includes("bus-stop") ? "Click a bus stop or a bus terminal." : "Click a tram stop.");
      if (pl.points[pl.points.length - 1] !== hit.id) pl.points.push(hit.id);
    } else {
      const q = this._placePoint(p, e), last = pl.points[pl.points.length - 1];
      if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < 0.5) return this.finishPlacing(); // the same point again: done
      pl.points.push(q);
    }
    const [, max] = pointsOf(pl.cls);
    if (pl.points.length >= max) this.finishPlacing();
    else {
      this.renderHint();
      this.plan.redraw();
    }
  }

  /** Make the element of the points placed. */
  finishPlacing() {
    const pl = this.placing;
    if (!pl) return;
    const spec = placeSpec(this.world, pl.cls, pl.points, { reachMM: this.world.scale ? (100 * 1000) / this.world.scale : Infinity });
    if (!spec) {
      const [min] = pointsOf(pl.cls);
      if (pl.cls.placement === "rect") pl.points.pop();
      return toast(`Place at least ${min} points.`);
    }
    if (pl.kind) spec.kind = pl.kind;
    if (pl.cls.type === "road") Object.assign(spec, this._streetSettings(pl.kind));
    let obj;
    try {
      obj = this.world.addObject(spec);
    } catch (err) {
      return toast(err.message, 7000);
    }
    // street after street: the tool stays; other elements are selected to be changed
    const again = this._isStreet(pl.cls);
    this.placing = again ? { ...pl, points: [], hover: null } : null;
    if (!again) {
      this.tool = TOOLS[0].items[0];
      this.renderTools();
      this.selectedId = obj.id;
      this.setTab("element");
    }
    this.renderHint();
    this.changed();
    toast(`${pl.cls.label} added.`, 2500, { minor: true });
  }

  /* ---------------------------------------------------------------- pointer and keys */

  _bind() {
    const canvas = $("#plan");
    canvas.addEventListener("pointerdown", (e) => this._down(e));
    canvas.addEventListener("pointermove", (e) => this._move(e));
    canvas.addEventListener("pointerup", (e) => this._up(e));
    canvas.addEventListener("pointercancel", (e) => this._up(e, true));
    canvas.addEventListener("dblclick", (e) => this._dblclick(e));
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      this.plan.zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016)), this.plan.pixelOf(e));
    }, { passive: false });
    canvas.addEventListener("pointerleave", () => {
      $("#coords").textContent = "";
      if (this.placing) this.placing.hover = null;
      this.plan.redraw();
    });
    document.addEventListener("keydown", (e) => this._key(e));
    for (const b of document.querySelectorAll("[data-plan]")) b.addEventListener("click", () => this._planButton(b));
    this._syncPlanButtons();
    $("#btnUndo").onclick = () => this.undo();
    $("#btnRedo").onclick = () => this.redo();
    $("#btnOpen").onclick = () => this.showOpen();
    $("#btnPush").onclick = () => this.showPush();
    for (const tab of document.querySelectorAll('[role="tab"]')) tab.addEventListener("click", () => this.setTab(tab.id.replace("tab-", "")));
    // unpushed changes stay as a draft; covered photos chosen would be lost
    addEventListener("beforeunload", (e) => {
      if (this.covers.size) e.preventDefault();
    });
  }

  _planButton(b) {
    const k = b.dataset.plan, plan = this.plan, c = $("#plan");
    if (k === "zoom-in") plan.zoomAt(1.4, [c.width / 2, c.height / 2]);
    else if (k === "zoom-out") plan.zoomAt(1 / 1.4, [c.width / 2, c.height / 2]);
    else if (k === "fit") plan.fit(ARail.layoutBounds(this.world));
    else if (k === "ortho") plan.showOrtho = !plan.showOrtho;
    else if (k === "grid") plan.grid = !plan.grid;
    else if (k === "simple") plan.simple = !plan.simple;
    storage.set(KEY.view, { simple: plan.simple, ortho: plan.showOrtho, grid: plan.grid });
    this._syncPlanButtons();
    plan.redraw();
  }

  _syncPlanButtons() {
    const on = { ortho: this.plan.showOrtho, grid: this.plan.grid, simple: this.plan.simple };
    for (const b of document.querySelectorAll("[data-plan]")) if (b.dataset.plan in on) b.setAttribute("aria-pressed", on[b.dataset.plan] ? "true" : "false");
  }

  /**
   * The element at a layout point (optionally only those `ok` accepts): the selected one, then small
   * ones before large ones, bus lines after the streets they run on, table modules only at their
   * edges unless selected (dragging over a table pans).
   */
  hitTest(p, ok = () => true) {
    const tol = this.plan.mmOfPx(8);
    // what is selected keeps the click; bus lines (along their streets) come after the streets
    const rank = (o) => (o.id === this.selectedId ? -1 : o.constructor.background ? 3 : o.constructor.placement === "point" ? 0 : o.constructor.placement === "stops" ? 2 : 1);
    const order = [...this.world.objects].reverse().sort((a, b) => rank(a) - rank(b));
    for (const o of order) {
      if (!o.geometry || !ok(o)) continue;
      if (o.constructor.background && o.id !== this.selectedId) {
        const fp = o.footprint?.();
        if (fp && fp.some((a, i) => ARail.pointSegment(p, a, fp[(i + 1) % fp.length]).distance <= 1.5 * tol)) return o;
        continue;
      }
      try {
        if (o.contains(p, tol)) return o;
      } catch {
        /* an element without an outline */
      }
    }
    return null;
  }

  /** The corner of the selected line under a pixel: its index, or null. */
  _vertexAt(px) {
    const o = this.selected;
    if (!Array.isArray(o?.spec.points)) return null;
    const pts = ARail.resolvePoints(this.world.map, o.spec.points) || [];
    const tol = 9 * this.plan.px;
    let best = null;
    pts.forEach((q, i) => {
      const s = this.plan.toScreen(q);
      const d = s ? Math.hypot(s[0] - px[0], s[1] - px[1]) : Infinity;
      if (d <= tol && (!best || d < best.d)) best = { i, d };
    });
    return best ? best.i : null;
  }

  _down(e) {
    const canvas = $("#plan");
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture?.(e.pointerId);
    const px = this.plan.pixelOf(e), p = this.plan.toLayout(px);
    this.pointers.set(e.pointerId, px);
    if (this.pointers.size === 2) {
      // two fingers: pinch and pan
      const [a, b] = [...this.pointers.values()];
      this.drag = { mode: "pinch", c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d: Math.hypot(a[0] - b[0], a[1] - b[1]) };
      return;
    }
    const start = { px, p, moved: false };
    if (e.button === 1 || e.button === 2 || this.spaceDown) this.drag = { mode: "pan", ...start, last: px };
    else if (this.placing) this.drag = { mode: "place", ...start, last: px };
    else {
      const v = this._vertexAt(px);
      if (v != null) {
        this.vertex = v;
        this.drag = { mode: "vertex", ...start, i: v };
      } else {
        const hit = p && this.hitTest(p);
        if (hit) {
          if (hit.id !== this.selectedId) this.select(hit);
          this.drag = { mode: "move", ...start, last: p, obj: hit };
        } else this.drag = { mode: "pan", ...start, last: px, deselect: true };
      }
    }
  }

  _move(e) {
    const px = this.plan.pixelOf(e), p = this.plan.toLayout(px);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, px);
    if (p) $("#coords").textContent = `${Math.round(p[0])}, ${Math.round(p[1])} mm`;
    const d = this.drag;
    if (d?.mode === "pinch") {
      const [a, b] = [...this.pointers.values()];
      if (!a || !b) return;
      const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      this.plan.pan(c[0] - d.c[0], c[1] - d.c[1], d.c);
      if (d.d > 0 && dist > 0) this.plan.zoomAt(dist / d.d, c);
      Object.assign(d, { c, d: dist });
      return;
    }
    if (d && !d.moved && Math.hypot(px[0] - d.px[0], px[1] - d.px[1]) > DRAG_PX * this.plan.px) d.moved = true;
    if (d?.moved && (d.mode === "pan" || d.mode === "place")) {
      $("#plan").classList.add("panning");
      this.plan.pan(px[0] - d.last[0], px[1] - d.last[1], d.last);
      d.last = px;
      return;
    }
    if (d?.moved && d.mode === "move" && p) {
      $("#plan").classList.add("moving");
      let dx = p[0] - d.last[0], dy = p[1] - d.last[1];
      const g = this._grid(e), anchor = this._anchor(d.obj);
      if (g && anchor) {
        d.anchor ??= anchor;
        d.startP ??= d.p;
        const goal = ARail.snapToGrid([d.anchor[0] + p[0] - d.startP[0], d.anchor[1] + p[1] - d.startP[1]], g);
        dx = goal[0] - anchor[0];
        dy = goal[1] - anchor[1];
      }
      if (Math.hypot(dx, dy) >= 0.1) {
        d.obj.translate(round1(dx), round1(dy));
        d.changed = true;
        this.plan.redraw();
      }
      d.last = p;
      return;
    }
    if (d?.moved && d.mode === "vertex" && p) {
      const o = this.selected, pts = (ARail.resolvePoints(this.world.map, o.spec.points) || []).map((q) => q.slice());
      const street = this._isStreet(o.constructor);
      const q = street && !e.altKey
        ? snapStreetPoint(this.world, p, { tolMM: this.plan.mmOfPx(12), grid: this._grid(e), exclude: o.id }).point
        : this._grid(e) ? ARail.snapToGrid(p, this._grid(e)).map(round1) : p.map(round1);
      pts[d.i] = q;
      o.set({ points: pts.map((x) => x.map(round1)) });
      d.changed = true;
      this.plan.redraw();
      return;
    }
    // hover
    if (this.placing && p) {
      this.placing.hover = this._placePoint(p, e);
      this.plan.redraw();
    } else if (!d && p) $("#plan").classList.toggle("over", !!(this._vertexAt(px) != null || this.hitTest(p)));
  }

  _up(e, cancelled = false) {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    $("#plan").classList.remove("panning", "moving");
    if (d?.mode === "pinch") {
      if (this.pointers.size === 0) this.drag = null;
      return;
    }
    this.drag = null;
    if (!d || cancelled) return;
    if (d.mode === "place" && !d.moved && d.p) this._addPoint(d.p, e);
    else if ((d.mode === "move" || d.mode === "vertex") && d.changed) this.changed();
    else if (d.mode === "pan" && !d.moved && d.deselect) this.select(null);
  }

  _dblclick(e) {
    const p = this.plan.toLayout(this.plan.pixelOf(e));
    if (this.placing) {
      // the double click's second click added the same point again: finish
      return this.finishPlacing();
    }
    const o = this.selected;
    if (!p || !Array.isArray(o?.spec.points) || this._vertexAt(this.plan.pixelOf(e)) != null) return;
    // a new corner on the selected line where it was double-clicked
    const pts = ARail.resolvePoints(this.world.map, o.spec.points) || [];
    let best = null;
    for (let i = 1; i < pts.length; i++) {
      const r = ARail.pointSegment(p, pts[i - 1], pts[i]);
      if (!best || r.distance < best.d) best = { i, d: r.distance, q: ARail.lerp2(pts[i - 1], pts[i], r.t) };
    }
    if (!best || best.d > this.plan.mmOfPx(10)) return;
    // on the line, at the grid where it crosses the line there
    const g = this._grid(e);
    if (g) {
      const a = pts[best.i - 1], b = pts[best.i], r = ARail.pointSegment(ARail.snapToGrid(p, g), a, b);
      best.q = ARail.lerp2(a, b, r.t);
    }
    const next = pts.map((q) => q.map(round1));
    next.splice(best.i, 0, best.q.map(round1));
    o.set({ points: next });
    this.vertex = best.i;
    this.changed();
  }

  /** The point of an element that snaps to the grid when it is moved. */
  _anchor(o) {
    if (o.snapPoint) return o.snapPoint();
    const s = o.spec, first = Array.isArray(s.points) ? s.points[0] : s.from ?? s.position;
    return (first != null && ARail.resolvePoint(this.world.map, first)) || o.anchorPoint?.() || null;
  }

  _key(e) {
    const tag = e.target?.tagName;
    if (e.target?.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(tag) || e.target?.closest?.("dialog")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      return e.shiftKey ? this.redo() : this.undo();
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      return this.redo();
    }
    if (mod || e.altKey) return;
    if (e.key === " " && !["BUTTON", "A"].includes(tag)) {
      this.spaceDown = true;
      addEventListener("keyup", (u) => u.key === " " && (this.spaceDown = false), { once: true });
      e.preventDefault();
      return;
    }
    if (["BUTTON", "A"].includes(tag) && (e.key === "Enter" || e.key === " ")) return;
    if (e.key === "Escape") {
      if (this.placing) this.useTool(TOOLS[0].items[0]);
      else this.select(null);
      return;
    }
    if (e.key === "Enter" && this.placing) return this.finishPlacing();
    if (e.key === "Backspace" && this.placing) {
      e.preventDefault();
      this.placing.points.pop();
      this.renderHint();
      return this.plan.redraw();
    }
    if ((e.key === "Delete" || e.key === "Backspace") && this.selected) {
      e.preventDefault();
      return this.vertex != null ? this.deleteVertex() : this.deleteSelected();
    }
    if (e.key === "r" || e.key === "R") return this.rotateSelected(e.shiftKey ? 90 : 15);
    if (e.key === "+" || e.key === "=") return this._planButton($('[data-plan="zoom-in"]'));
    if (e.key === "-") return this._planButton($('[data-plan="zoom-out"]'));
    if (e.key === "Home" || e.key === "0") return this._planButton($('[data-plan="fit"]'));
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      const o = this.selected;
      if (o) {
        const step = (this.world.layout.grid?.size_mm || 50) * (e.shiftKey ? 10 : 1) / 5;
        o.translate(dir[0] * step, dir[1] * step);
        return this.changed();
      }
      return this.plan.pan(-dir[0] * 60 * this.plan.px, dir[1] * 60 * this.plan.px);
    }
    const tool = TOOLS.flatMap((g) => g.items).find((x) => x.key === e.key.toLowerCase() && (!x.type || this.world.registry.objects.has(x.type)));
    if (tool) this.useTool(tool);
  }

  /* ---------------------------------------------------------------- editing the selection */

  deleteSelected() {
    const o = this.selected;
    if (!o) return;
    const name = o.name;
    this.world.removeObject(o.id);
    this.selectedId = null;
    this.changed();
    toast(`${name} deleted. Ctrl+Z brings it back.`, 3500);
  }

  /** Take the chosen corner out of the selected line (it keeps at least its first and last). */
  deleteVertex() {
    const o = this.selected, i = this.vertex;
    const pts = ARail.resolvePoints(this.world.map, o?.spec.points || []) || [];
    const min = o?.constructor.placement === "polygon" ? 3 : 2;
    if (i == null || pts.length <= min) return toast(`A line needs at least ${min} points.`);
    pts.splice(i, 1);
    o.set({ points: pts.map((q) => q.map(round1)) });
    this.vertex = null;
    this.changed();
  }

  rotateSelected(deg) {
    const o = this.selected;
    if (!o || !o.constructor.params?.some((p) => p.key === "rotation_deg")) return;
    let r = ((((+o.spec.rotation_deg || 0) + deg) % 360) + 360) % 360;
    if (r > 180) r -= 360;
    o.set({ rotation_deg: round1(r) });
    this.changed();
  }

  duplicateSelected() {
    const o = this.selected;
    if (!o) return;
    const spec = o.toJSON();
    delete spec.id;
    const copy = this.world.addObject(spec);
    const [dx, dy] = o.duplicateOffset?.() ?? [copy.mm(5), copy.mm(5)];
    copy.translate(dx, dy);
    this.selectedId = copy.id;
    this.changed();
  }

  /** Turn the selected line round: its first point becomes its last (a truck lane's entry, a street's sides). */
  reverseSelected() {
    const o = this.selected;
    if (!Array.isArray(o?.spec.points)) return;
    o.set({ points: o.spec.points.slice().reverse() });
    this.changed();
  }

  /** Turn a building's front to the nearest street. */
  faceStreet() {
    const o = this.selected, p = o && ARail.resolvePoint(this.world.map, o.spec.position);
    if (!p) return;
    const spec = placeSpec(this.world, o.constructor, [p]);
    if (spec?.rotation_deg != null && spec.rotation_deg !== o.spec.rotation_deg) {
      o.set({ rotation_deg: spec.rotation_deg });
      this.changed();
    }
  }

  /** Carry out a problem's fix. */
  fix(problem) {
    const obj = ARail.applyFix(this.world, problem.fix);
    if (!obj) return toast("This fix does not fit the layout any more.");
    this.selectedId = obj.id;
    this.changed();
    toast(`Done: ${problem.fix.text}`, 3000, { minor: true });
  }

  /* ---------------------------------------------------------------- drawing over the plan */

  drawMarks(ctx) {
    const plan = this.plan, px = plan.px, S = (p) => plan.toScreen(p);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // the ways from entrances and stops to their streets
    const net = this.world.network();
    ctx.setLineDash([4 * px, 4 * px]);
    ctx.strokeStyle = "rgba(10,119,127,0.9)";
    ctx.lineWidth = 1.5 * px;
    for (const e of net.edges) {
      if (e.kind !== "connector") continue;
      const a = S(e.points[0]), b = S(e.points[e.points.length - 1]);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // junctions and street ends
    for (const n of net.nodes) {
      if (n.kind === "place" || n.kind === "lane") continue;
      const s = S(n.pos);
      if (!s) continue;
      if (n.degree >= 3) {
        ctx.fillStyle = "rgba(10,119,127,0.95)";
        ctx.beginPath();
        ctx.arc(s[0], s[1], 3.5 * px, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    // the selected element: its outline and, for lines, its corners
    const o = this.selected;
    if (o) {
      const fp = safe(() => o.footprint?.());
      if (fp?.length) {
        ctx.strokeStyle = "#f0922e";
        ctx.lineWidth = 2.5 * px;
        polyPath(ctx, fp.map(S).filter(Boolean), true);
        ctx.stroke();
      }
      if (Array.isArray(o.spec.points)) {
        const pts = ARail.resolvePoints(this.world.map, o.spec.points) || [];
        pts.forEach((q, i) => {
          const s = S(q);
          if (!s) return;
          ctx.fillStyle = i === this.vertex ? "#f0922e" : "#ffffff";
          ctx.strokeStyle = "#001450";
          ctx.lineWidth = 1.5 * px;
          ctx.beginPath();
          ctx.rect(s[0] - 5 * px, s[1] - 5 * px, 10 * px, 10 * px);
          ctx.fill();
          ctx.stroke();
          if (i === 0) {
            // the first point: where a line starts (a truck lane's entry)
            ctx.fillStyle = "#001450";
            ctx.font = `700 ${11 * px}px ${ARail.FONT}`;
            ctx.fillText("1", s[0] + 7 * px, s[1] - 7 * px);
          }
        });
      }
    }
    // problems on the plan
    for (const p of this.problems) {
      const s = p.at && S(p.at);
      if (!s) continue;
      ctx.fillStyle = p.level === "error" ? "#c8102e" : "#f0922e";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.arc(s[0], s[1], 8 * px, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${12 * px}px ${ARail.FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("!", s[0], s[1] + 0.5 * px);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }
    // placing: the points so far and to the pointer
    const pl = this.placing;
    if (pl && pl.cls.placement !== "stops") {
      const pts = [...pl.points, ...(pl.hover ? [pl.hover] : [])].map(S).filter(Boolean);
      if (pts.length > 1) {
        const width = this._isStreet(pl.cls) ? Math.max(3 * px, plan.pxPerMM * this._streetWidth(pl)) : 2.5 * px;
        ctx.strokeStyle = "rgba(0,20,80,0.45)";
        ctx.lineWidth = width;
        polyPath(ctx, pts, pl.cls.placement === "polygon");
        ctx.stroke();
        ctx.strokeStyle = "#f0922e";
        ctx.lineWidth = 2 * px;
        ctx.stroke();
      }
      for (const s of pts) {
        ctx.fillStyle = "#f0922e";
        ctx.beginPath();
        ctx.arc(s[0], s[1], 4 * px, 0, 2 * Math.PI);
        ctx.fill();
      }
      if (pl.hover && pl.snap && pl.snap !== "grid") {
        const s = S(pl.hover);
        if (s) {
          ctx.strokeStyle = "#0A777F";
          ctx.lineWidth = 2.5 * px;
          ctx.beginPath();
          ctx.arc(s[0], s[1], 9 * px, 0, 2 * Math.PI);
          ctx.stroke();
        }
      }
    }
    if (pl?.cls.placement === "stops") {
      const pts = pl.points.map((id) => this.world.getObject(id)?.anchorPoint?.()).filter(Boolean).map(S).filter(Boolean);
      ctx.strokeStyle = "#f0922e";
      ctx.lineWidth = 3 * px;
      polyPath(ctx, pts, false);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The width of the street being drawn (mm): all of it, by its cross-section. */
  _streetWidth(pl) {
    const cs = pl.cls.type === "road" ? this._crossSection(pl.kind) : null;
    const m = cs ? 2 * cs.half : ({ street: 7, residential: 6, main: 10, path: 3 }[pl.kind || "street"] ?? 4);
    return (m * 1000) / this.world.scale;
  }

  /** The settings chosen for new streets of a kind (only those chosen: the others stay by kind). */
  _streetSettings(kind = "street") {
    const out = {};
    for (const [k, v] of Object.entries(this.streetSettings[kind] || {})) if (STREET_SETTINGS.includes(k) && v !== undefined && v !== "") out[k] = v;
    return out;
  }

  /** The values of a new street of a kind, as its form shows them (with the defaults). */
  _newStreetValues(kind = "street") {
    const cls = this.world.registry.objects.get("road");
    const v = { ...(cls?.defaults() || {}), kind, ...this._streetSettings(kind) };
    if (v.profile === undefined) v.profile = ARail.profileOf({ ...v, kind: ARail.roadKind(kind) });
    return v;
  }

  /** The cross-section of a new street of a kind (objects/street-profile.js). */
  _crossSection(kind = "street") {
    const k = ARail.roadKind(kind);
    return ARail.crossSection({ ...this._newStreetValues(kind), kind: k }, ARail.ROAD_KINDS[k]);
  }

  /** Choose a setting of new streets of the kind being drawn. */
  setStreetSetting(key, value) {
    const kind = this.placing?.kind || "street";
    const settings = { ...(this.streetSettings[kind] || {}) };
    if (value === undefined || value === "") delete settings[key];
    else settings[key] = value;
    this.streetSettings[kind] = settings;
    storage.set(KEY.street, this.streetSettings);
    // the fields change with the settings (a bike lane's width only with bike lanes): the field keeps the focus
    const focused = document.activeElement?.id;
    this.renderTools();
    this.renderPanel();
    this.plan.redraw();
    if (focused && document.activeElement?.id !== focused) document.getElementById(focused)?.focus();
  }

  /** The street settings for the kind being drawn: cross-section, widths (the standard ones to click), trams, parking. */
  _streetSettingsGroup(pl) {
    const cls = pl.cls, values = this._newStreetValues(pl.kind);
    const params = (cls.params || []).filter((p) => STREET_SETTINGS.includes(p.key));
    const cs = this._crossSection(pl.kind);
    return h("div", { class: "street-settings", role: "group", "aria-labelledby": "streetSettingsTitle" },
      h("h2", { id: "streetSettingsTitle" }, "The new street"),
      paramFields(params, values, (k, v) => this.setStreetSetting(k, v), { idPrefix: "new-street" }),
      h("p", { class: "street-width" }, `${metres(2 * cs.half)} m wide in all`),
      cs.warnings.map((w) => h("p", { class: "hint error" }, w)),
      Object.keys(this._streetSettings(pl.kind)).length ? h("button", { class: "btn small", type: "button", onclick: () => this._resetStreetSettings(pl.kind) }, "Standard street") : null);
  }

  _resetStreetSettings(kind) {
    delete this.streetSettings[kind];
    storage.set(KEY.street, this.streetSettings);
    this.renderTools();
    this.renderPanel();
    this.plan.redraw();
  }

  /* ---------------------------------------------------------------- the panels */

  renderBar() {
    $("#btnUndo").disabled = !this.history.canUndo;
    $("#btnRedo").disabled = !this.history.canRedo;
    const state = $("#saveState");
    const n = this.history.at + this.covers.size;
    state.classList.toggle("dirty", this.dirty);
    state.textContent = !this.doc ? "" : this.dirty ? tr(`Not pushed · ${plural(Math.max(1, n), "change")}`) : tr("No changes");
    const count = (level) => this.problems.filter((p) => p.level === level).length;
    const errors = count("error"), warnings = count("warning");
    const tab = $("#tab-problems");
    mount(tab, tr("Problems"), errors ? h("span", { class: "tab-count", "aria-label": plural(errors, "error") }, String(errors)) : warnings ? h("span", { class: "tab-count warn", "aria-label": plural(warnings, "warning") }, String(warnings)) : null);
  }

  renderTools() {
    const reg = this.world.registry;
    const button = (tool) => h("button", {
      class: "btn tool", type: "button", "aria-pressed": this.tool.id === tool.id ? "true" : "false",
      title: tool.type ? reg.objects.get(tool.type)?.description || null : null,
      onclick: () => this.useTool(tool),
    }, tool.label || reg.objects.get(tool.type)?.label, tool.key ? h("kbd", { "aria-hidden": "true", translate: "no" }, tool.key.toUpperCase()) : null);
    // all the other elements, by category
    const known = new Set(TOOLS.flatMap((g) => g.items.map((x) => x.type)).filter(Boolean));
    const byCat = new Map();
    for (const [type, cls] of reg.objects) {
      if (known.has(type) || cls.hidden) continue;
      const cat = cls.category || "Other";
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push([type, cls]);
    }
    const all = h("select", {
      id: "allElements", "aria-label": "Add another element",
      onchange: (e) => {
        const type = e.target.value;
        e.target.value = "";
        if (type) this.useTool({ id: type, type, label: reg.objects.get(type)?.label });
      },
    }, h("option", { value: "" }, "Other elements…"),
    [...byCat].sort(([a], [b]) => a.localeCompare(b)).map(([cat, list]) => h("optgroup", { label: tr(cat) }, list.sort((a, b) => a[1].label.localeCompare(b[1].label)).map(([type, cls]) => h("option", { value: type, selected: this.tool.type === type && !known.has(type) }, cls.label)))));
    // drawing a street: its cross-section and widths below the street tools
    const pl = this.placing, street = pl?.cls.type === "road" ? this._streetSettingsGroup(pl) : null;
    morph($("#tools"),
      ...TOOLS.map((g, i) => [
        h("div", { class: "group", role: "group", "aria-label": g.group }, h("h2", { "aria-hidden": "true" }, g.group), g.items.filter((x) => !x.type || reg.objects.has(x.type)).map(button)),
        i === 0 ? street : null,
      ]),
      h("div", { class: "group" }, h("h2", { "aria-hidden": "true" }, "More"), all));
  }

  renderHint() {
    const pl = this.placing;
    let text = HINTS.select;
    if (pl) {
      const cls = pl.cls;
      text = this._isStreet(cls) ? HINTS.street
        : TYPE_HINTS[cls.type] || (cls.placement === "point" ? (cls.type === "bus-stop" || facesStreet(cls) || cls.type === "bus-terminal" ? HINTS.needsStreet : HINTS.point)
          : cls.placement === "stops" && !(cls.stopTypes || ["bus-stop"]).includes("bus-stop") ? HINTS.tramStops : HINTS[cls.placement] || HINTS.polyline);
      text = `${tr(cls.label)}${pl.kind ? ` (${tr(KIND_LABELS[pl.kind] || pl.kind)})` : ""}: ${tr(text)}`;
    }
    $("#hint").textContent = pl ? text : tr(text);
    const [min] = pl ? pointsOf(pl.cls) : [0];
    mount($("#hintActions"),
      pl && pl.points.length >= min && min > 1 ? h("button", { class: "btn small primary", type: "button", onclick: () => this.finishPlacing() }, "Finish") : null,
      pl && pl.points.length ? h("button", { class: "btn small", type: "button", onclick: () => { pl.points.pop(); this.renderHint(); this.plan.redraw(); } }, "Undo point") : null,
      pl ? h("button", { class: "btn small", type: "button", onclick: () => this.useTool(TOOLS[0].items[0]) }, "Cancel") : null);
  }

  setTab(tab) {
    this.tab = tab;
    for (const b of document.querySelectorAll('[role="tab"]')) {
      const on = b.id === `tab-${tab}`;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      $(`#${b.getAttribute("aria-controls")}`).hidden = !on;
    }
    this.renderPanel();
  }

  renderPanel() {
    if (!this.doc) return;
    if (this.tab === "element") this.renderElement($("#panel-element"));
    else if (this.tab === "problems") this.renderProblems($("#panel-problems"));
    else if (this.tab === "photos") this.renderPhotos($("#panel-photos"));
    else this.renderLayout($("#panel-layout"));
  }

  /** A problem with its buttons: show it on the plan, carry out its fix. */
  _problem(p) {
    const obj = p.id ? this.world.getObject(p.id) : null;
    return h("li", { class: `problem ${p.level}` },
      h("span", { class: "level" }, p.level === "error" ? "Does not work" : "Makes no sense"),
      h("p", {}, p.text),
      h("div", { class: "row" },
        obj || p.at ? h("button", { class: "btn small", type: "button", onclick: () => (obj ? this.select(obj, { show: true }) : this.plan.focus(p.at)) }, "Show") : null,
        p.fix ? h("button", { class: "btn small primary", type: "button", onclick: () => this.fix(p) }, p.fix.text) : null));
  }

  renderElement(el) {
    const o = this.selected;
    const pl = this.placing;
    if (!o && pl?.cls.type === "road") {
      // drawing a street: what it will look like across, by the settings of the street tools
      const kind = ARail.roadKind(pl.kind);
      morph(el,
        h("section", { class: "section" }, h("h2", {}, `New ${tr(KIND_LABELS[kind] || kind)}`),
          crossSectionFigure(this._crossSection(pl.kind), kind),
          h("p", { class: "hint" }, "Choose the cross-section and the widths on the left: the standard widths of the German guidelines (RASt 06, ERA 2010, EFA 2002, BOStrab) to click, or any other. Bike lanes and paths, tram tracks and parking make the street wider; the car lanes keep their width.")),
        h("section", { class: "section" }, h("h2", {}, "How to"), h("p", { class: "hint" }, HINTS.street)));
      return;
    }
    if (!o) {
      mount(el,
        h("section", { class: "section" }, h("h2", {}, "Element"), h("p", { class: "hint" }, "Nothing selected. Click an element on the plan, or choose a tool to add one.")),
        h("section", { class: "section" }, h("h2", {}, "How to"),
          h("ul", { class: "hint" },
            h("li", {}, "Streets first: draw them so that they meet; where they touch, they join. Choose the kind of street and its widths with the street tools."),
            h("li", {}, "Then what needs a street: bus stops, tram stops, the bus terminal, parking, truck lanes, buildings. Put them next to a street: they line up with it."),
            h("li", {}, "The Problems tab lists what has no street to it, with a fix to click."),
            h("li", {}, "Push to GitHub when it is done: one commit to main, with only the lines you changed."))));
      return;
    }
    const cls = o.constructor;
    const mine = this.problems.filter((p) => p.id === o.id);
    const update = (key, value) => {
      o.set({ [key]: value });
      this.changed();
    };
    const values = { ...o.spec };
    const isLine = Array.isArray(o.spec.points);
    const point = cls.placement === "point" ? ARail.resolvePoint(this.world.map, o.spec.position) : null;
    const layer = this.world.layerOf(o.id);
    // a street: its cross-section as a figure, and what the guidelines say about its widths
    const xs = o.type === "road" ? o.geometry?.xs : null;
    morph(el,
      h("section", { class: "section" },
        h("h2", {}, cls.label, h("span", { class: "count", translate: "no" }, o.id)),
        layer ? h("p", { class: "hint" }, `In the module ${this.world.layers().find((l) => l.id === layer)?.name || layer}.`) : null,
        mine.length ? h("ul", { class: "problem-list" }, mine.map((p) => this._problem(p))) : null,
        xs ? crossSectionFigure(xs, ARail.roadKind(o.spec.kind)) : null,
        xs ? xs.warnings.map((w) => h("p", { class: "hint error" }, w)) : null,
        paramFields(cls.params || [], values, update, { idPrefix: "prop", world: this.world })),
      point ? h("section", { class: "section" }, h("h2", {}, "Place"),
        h("div", { class: "fields" },
          numberField("posX", "X (mm)", point[0], (v) => update("position", [v, point[1]])),
          numberField("posY", "Y (mm)", point[1], (v) => update("position", [point[0], v])))) : null,
      isLine ? h("section", { class: "section" }, h("h2", {}, "Line"),
        h("p", { class: "hint" }, `${plural(o.spec.points.length, "point")}. Drag a corner to move it; double-click on the line adds one; select a corner and press Delete to take it out. Point 1 is where it starts.`)) : null,
      h("section", { class: "section" },
        h("div", { class: "row" },
          cls.params?.some((p) => p.key === "rotation_deg") ? h("button", { class: "btn small", type: "button", onclick: () => this.rotateSelected(15) }, "Turn 15° (R)") : null,
          facesStreet(cls) ? h("button", { class: "btn small", type: "button", onclick: () => this.faceStreet() }, "Face the street") : null,
          isLine ? h("button", { class: "btn small", type: "button", onclick: () => this.reverseSelected() }, "Reverse direction") : null,
          h("button", { class: "btn small", type: "button", onclick: () => this.duplicateSelected() }, "Duplicate"),
          h("button", { class: "btn small danger", type: "button", onclick: () => this.deleteSelected() }, "Delete"))));
  }

  renderProblems(el) {
    const errors = this.problems.filter((p) => p.level === "error"), warnings = this.problems.filter((p) => p.level === "warning");
    const fixable = this.problems.filter((p) => p.fix);
    morph(el,
      h("section", { class: "section" },
        h("h2", {}, "Street access"),
        h("p", { class: "hint" }, "Everything people and vehicles come to needs a street to it: bus stops, bus terminals, truck lanes, the entrances of buildings. Streets join where they meet; a dead end inside the layout makes cars appear there."),
        h("p", { class: "counts" }, this.problems.length
          ? [h("span", {}, plural(errors.length, "error")), h("span", {}, plural(warnings.length, "warning"))]
          : h("span", { class: "ok" }, "Nothing to fix: every element has a street to it.")),
        fixable.length > 1 ? h("div", { class: "row" }, h("button", { class: "btn small", type: "button", onclick: () => this.fixAll() }, `Carry out all ${fixable.length} fixes`)) : null),
      this.problems.length ? h("ul", { class: "problem-list" }, this.problems.map((p) => this._problem(p))) : null);
  }

  /** Carry out every fix there is, one after another (each fix can change the others). */
  fixAll() {
    let n = 0;
    for (let round = 0; round < 50; round++) {
      const p = ARail.accessProblems(this.world).find((x) => x.fix);
      if (!p || !ARail.applyFix(this.world, p.fix)) break;
      n++;
    }
    this.changed();
    toast(`${plural(n, "fix")} done. Undo takes them back one by one.`, 3500);
  }

  renderLayout(el) {
    const L = this.world.layout, layers = this.world.layers();
    const set = (key, v) => {
      L[key] = v;
      if (key === "name") $("#layoutName").textContent = v;
      this.changed();
    };
    morph(el,
      h("section", { class: "section" }, h("h2", {}, "Layout"),
        h("div", { class: "fields" },
          h("label", { class: "field wide", for: "layoutNameField" }, h("span", {}, "Name"), h("input", { type: "text", id: "layoutNameField", value: L.name || "", translate: "no", onchange: (e) => set("name", e.target.value) })),
          h("label", { class: "field wide", for: "layoutDesc" }, h("span", {}, "Description"), h("textarea", { id: "layoutDesc", rows: 4, translate: "no", onchange: (e) => set("description", e.target.value) }, L.description || ""))),
        h("dl", { class: "kv" },
          h("dt", {}, "File"), h("dd", { translate: "no" }, this.doc.path || "—"),
          h("dt", {}, "Opened from"), h("dd", {}, { github: "GitHub (main)", site: "the website", file: "a file on this device", new: "new" }[this.doc.from] || "—"),
          h("dt", {}, "Scale"), h("dd", {}, `1:${this.world.scale}`),
          h("dt", {}, "Elements"), h("dd", {}, String(this.world.objects.length)))),
      layers.length ? h("section", { class: "section" }, h("h2", {}, "Modules"),
        h("p", { class: "hint" }, "Which modules are shown here. New elements go into the module chosen below; showing a module changes nothing in the file."),
        h("div", { class: "layers" }, layers.filter((l) => !l.layout).map((l) => h("label", { class: "field check", for: `layer-${l.id}` },
          h("input", { type: "checkbox", id: `layer-${l.id}`, checked: l.enabled, onchange: (e) => this.showLayer(l.id, e.target.checked) }), l.name))),
        h("label", { class: "field", for: "activeLayer" }, h("span", {}, "New elements go into"),
          h("select", { id: "activeLayer", onchange: (e) => { this.world.activeLayer = e.target.value || null; } },
            h("option", { value: "", selected: !this.world.activeLayer }, "the layout itself"),
            layers.filter((l) => l.enabled && !l.layout).map((l) => h("option", { value: l.id, selected: this.world.activeLayer === l.id }, l.name))))) : null,
      h("section", { class: "section" }, h("h2", {}, "Download"),
        h("div", { class: "row" }, h("button", { class: "btn small", type: "button", onclick: () => this.downloadLayout() }, "Download the layout file")),
        h("p", { class: "hint" }, "The file as it would be pushed, for a pull request of your own or to keep.")));
  }

  showLayer(id, on) {
    const ids = this.world.layers().filter((l) => (l.id === id ? on : l.enabled)).map((l) => l.id);
    const keepActive = this.world.activeLayer;
    this.world.setLayers(ids);
    if (ids.includes(keepActive)) this.world.activeLayer = keepActive;
    this.refresh();
  }

  downloadLayout() {
    const text = this.fileText() ?? this.doc.text;
    const a = h("a", { href: URL.createObjectURL(new Blob([text], { type: "application/json" })), download: (this.doc.path || "layout.json").split("/").pop() });
    document.body.append(a);
    a.click();
    a.remove();
  }

  /* ---------------------------------------------------------------- covered photos */

  /** The photos of this layout: its own (view.image) and those of the photo map with its digital layer. */
  async photosOfLayout() {
    const out = [], view = this.world.layout.view || {};
    if (view.image) {
      const url = new URL(view.image, this.doc.url).href;
      out.push({
        key: "layout", label: "The layout's photo", url, covered: view.image_covered ? new URL(view.image_covered, this.doc.url).href : null,
        path: repoPathOf(url),
        link: (rel) => {
          this.world.layout.view = { ...this.world.layout.view, image_covered: rel };
        },
        rel: (file) => coveredName(view.image, file),
      });
    }
    // the photo map: its layers whose layout is this file
    if (!this.photoMap) {
      try {
        const res = await fetch(siteUrlOf(PHOTO_MAP), { cache: "no-cache" });
        if (res.ok) {
          const text = await res.text();
          this.photoMap = { text, json: JSON.parse(text) };
        }
      } catch {
        this.photoMap = { text: null, json: null };
      }
    }
    const data = this.photoMap?.json;
    if (data) {
      const base = siteUrlOf(PHOTO_MAP);
      const layers = Object.entries(data.layers || {}).filter(([, l]) => new URL(l.layout, base).href === new URL(this.doc.url).href).map(([id]) => id);
      for (const p of (data.photos || []).filter((x) => layers.includes(x.layer))) {
        const url = new URL(p.image, base).href;
        out.push({
          key: `map:${p.id}`, label: `Photo map: ${data.groups?.[p.group]?.name || p.place || p.group || ""} (${p.id})`, url,
          covered: p.covered ? new URL(p.covered, base).href : null, path: repoPathOf(url), photo: p.id,
          rel: (file) => coveredName(p.image, file),
        });
      }
    }
    return out;
  }

  async renderPhotos(el) {
    const token = (this._photoToken = (this._photoToken || 0) + 1);
    const list = await this.photosOfLayout();
    if (token !== this._photoToken || this.tab !== "photos") return;
    const item = (ph) => {
      const pending = this.covers.get(ph.key);
      const input = h("input", { type: "file", id: `cover-${ph.key.replace(/\W/g, "-")}`, accept: "image/png,image/jpeg,image/webp", class: "visually-hidden", onchange: (e) => this.chooseCover(ph, e.target.files[0]) });
      return h("div", { class: "photo" },
        h("img", { src: pending?.url || ph.covered || ph.url, alt: "", loading: "lazy" }),
        h("div", { class: "section" },
          h("p", {}, h("strong", {}, ph.label)),
          h("p", { class: "hint" }, pending ? `New covered photo: ${pending.path.split("/").pop()} (pushed with the layout)` : ph.covered ? "Has a covered photo." : "No covered photo yet."),
          h("div", { class: "row" },
            h("label", { class: "btn small", for: input.id }, ph.covered || pending ? "Replace the covered photo…" : "Choose a covered photo…"), input,
            pending ? h("button", { class: "btn small", type: "button", onclick: () => this.dropCover(ph.key) }, "Keep the old one") : null)));
    };
    morph(el,
      h("section", { class: "section" }, h("h2", {}, "Covered photos"),
        h("p", { class: "hint" }, "A covered photo is the same photo with what is not the layout painted over (walls, windows, the floor), made in an image editor; transparent or blank parts are fine. The app shows it instead of the photo. Choose one for a photo here; it is pushed next to the photo with the layout.")),
      list.length ? h("div", { class: "photo-list" }, list.map(item)) : h("p", { class: "hint" }, "This layout has no photo."));
  }

  async chooseCover(ph, file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast("Choose a PNG, JPEG or WebP image.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const rel = ph.rel(file), path = rel && ph.path ? ph.path.replace(/[^/]+$/, rel.split("/").pop()) : null;
    if (!path) return toast("This photo is not in the repository: its covered photo cannot be pushed.");
    const old = this.covers.get(ph.key);
    if (old?.url) URL.revokeObjectURL(old.url);
    this.covers.set(ph.key, { ...ph, rel, path, bytes, url: URL.createObjectURL(file) });
    this.renderPhotos($("#panel-photos"));
    this.renderBar();
  }

  dropCover(key) {
    const old = this.covers.get(key);
    if (old?.url) URL.revokeObjectURL(old.url);
    this.covers.delete(key);
    this.renderPhotos($("#panel-photos"));
    this.renderBar();
  }

  /* ---------------------------------------------------------------- open and push */

  async showOpen() {
    const dlg = $("#openDialog");
    const names = new Set(EXAMPLES);
    const list = h("ul", { class: "layout-list" });
    const fill = () => mount(list, [...names].sort().map((n) => h("li", {}, h("button", {
      class: "btn", type: "button",
      onclick: async () => {
        if (this.dirty && !confirm(tr("Your changes are not pushed. Open another layout anyway? (They stay as a draft in this browser.)"))) return;
        dlg.close();
        await this.open({ path: `web/layouts/${n}.json` });
      },
    }, h("span", { translate: "no" }, `${n}.json`), this.doc?.path === `web/layouts/${n}.json` ? h("small", {}, "open now") : null))));
    fill();
    const name = h("input", { type: "text", id: "newName", placeholder: "e.g. EBL Waldhof" });
    const fileInput = h("input", { type: "file", id: "openFile", accept: ".json,application/json", class: "visually-hidden", onchange: async (e) => { dlg.close(); await this.open({ file: e.target.files[0] }); } });
    mount(dlg, h("div", { class: "body" },
      h("h2", { id: "openTitle" }, "Open a layout"),
      list,
      h("div", { class: "section" }, h("h2", {}, "New layout"),
        h("label", { class: "field", for: "newName" }, h("span", {}, "Name"), name),
        h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: async () => {
          if (!name.value.trim()) return name.focus();
          dlg.close();
          await this.open({ fresh: { name: name.value.trim(), scale: 87 } });
        } }, "Start a new layout"))),
      h("div", { class: "row" }, h("label", { class: "btn small", for: "openFile" }, "Open a file from this device…"), fileInput),
      h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, "Close"))));
    dlg.showModal();
    // the layouts on GitHub (new ones too); without it, the examples
    try {
      for (const f of await this.github.list("web/layouts")) if (f.type === "file" && f.name.endsWith(".json")) names.add(f.name.replace(/\.json$/, ""));
      fill();
    } catch {
      /* offline or rate limited: the examples */
    }
  }

  /** The files a push commits: the layout (if changed), the covered photos and the photo map with their links. */
  async filesToPush() {
    const files = [];
    // covered photos of the photo map are linked in its data
    const mapCovers = [...this.covers.values()].filter((c) => c.photo);
    const layoutCover = this.covers.get("layout");
    if (layoutCover) layoutCover.link(layoutCover.rel);
    const text = this.fileText();
    if (text != null) files.push({ path: this.doc.path, content: text, original: this.doc.text });
    for (const c of this.covers.values()) files.push({ path: c.path, content: c.bytes, original: undefined });
    if (mapCovers.length && this.photoMap?.json) {
      const json = structuredClone(this.photoMap.json);
      for (const c of mapCovers) {
        const p = json.photos.find((x) => x.id === c.photo);
        if (p) p.covered = c.rel;
      }
      files.push({ path: PHOTO_MAP, content: stringifyLike(this.photoMap.text, json), original: this.photoMap.text });
    }
    return files;
  }

  async showPush() {
    if (!this.doc) return;
    const dlg = $("#pushDialog");
    const files = await this.filesToPush();
    const errors = this.problems.filter((p) => p.level === "error").length;
    const token = h("input", { type: "password", id: "ghToken", autocomplete: "off", value: this.github.token || "", placeholder: "github_pat_…" });
    const remember = h("input", { type: "checkbox", id: "ghRemember", checked: !!this._storedToken() });
    const message = h("input", { type: "text", id: "commitMessage", value: this._message(files) });
    const status = h("p", { class: "hint", role: "status" });
    const push = h("button", { class: "btn primary", type: "submit", disabled: !files.length }, "Push to main");
    mount(dlg, h("form", { method: "dialog", onsubmit: (e) => { e.preventDefault(); this.push({ files, token: token.value.trim(), remember: remember.checked, message: message.value.trim(), status, button: push }); } },
      h("h2", { id: "pushTitle" }, "Push to GitHub"),
      h("p", { class: "hint" }, `One commit to ${BRANCH} of ${OWNER}/${REPO}, with these files:`),
      files.length ? h("ul", { class: "files" }, files.map((f) => h("li", { translate: "no" }, f.path))) : h("p", {}, "Nothing to push: there are no changes."),
      errors ? h("p", { class: "error" }, `${plural(errors, "error")} in the Problems tab: something does not work yet. You can push anyway.`) : null,
      h("label", { class: "field", for: "commitMessage" }, h("span", {}, "What changed"), message),
      h("label", { class: "field", for: "ghToken" }, h("span", {}, "GitHub token"), token,
        h("small", { class: "help" }, "A fine-grained personal access token with “Contents: read and write” on this repository only (GitHub → Settings → Developer settings). It is sent to GitHub only.")),
      h("label", { class: "field check", for: "ghRemember" }, remember, "Remember the token on this device"),
      status,
      h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, "Close"), push)));
    dlg.showModal();
    (token.value ? message : token).focus();
  }

  /** A commit message: the layout and what changed. */
  _message(files) {
    const name = this.world.layout.name || this.doc.path;
    const what = [];
    if (files.some((f) => f.path === this.doc.path)) what.push(this.doc.from === "new" ? "new layout" : `${Math.max(1, this.history.at)} change${this.history.at === 1 ? "" : "s"}`);
    const photos = this.covers.size;
    if (photos) what.push(`${photos} covered photo${photos === 1 ? "" : "s"}`);
    return `Builder: ${name}${what.length ? ` (${what.join(", ")})` : ""}`;
  }

  async push({ files, token, remember, message, status, button, overwrite = false }) {
    if (!token) return (status.textContent = tr("Enter a GitHub token."));
    this._storeToken(token, remember);
    this.github.token = token;
    button.disabled = true;
    status.className = "hint";
    status.textContent = tr("Pushing…");
    try {
      // what was opened must still be what GitHub has (else someone pushed meanwhile)
      const checked = [];
      for (const f of files) {
        let now = null;
        try {
          now = await this.github.readText(f.path);
        } catch (err) {
          if (err.kind !== "missing") throw err;
        }
        if (!overwrite && f.original !== undefined && now && now.text !== f.original && now.text !== f.content) {
          const err = new GitHubError(f.original === null ? `A file of this name is on GitHub already: ${f.path}.` : `Changed on GitHub since you opened it: ${f.path}.`, { kind: "conflict" });
          err.changed = [f.path];
          throw err;
        }
        checked.push({ path: f.path, content: f.content, base: now ? now.sha : null });
      }
      const res = await this.github.commit(checked, message || this._message(files), { overwrite });
      // pushed: what was pushed is the new file opened
      const pushed = files.find((f) => f.path === this.doc.path);
      if (pushed) {
        const json = JSON.parse(pushed.content), baseline = this.world.toJSON();
        // the modules shown here are still no change of the file
        for (const l of baseline.layers || []) l.enabled = json.layers?.find((x) => x.id === l.id)?.enabled ?? l.enabled;
        this.doc = { ...this.doc, text: pushed.content, json, baseline, from: "github" };
        this.history.reset(JSON.stringify(this.world.toJSON()));
      }
      const map = files.find((f) => f.path === PHOTO_MAP);
      if (map) this.photoMap = { text: map.content, json: JSON.parse(map.content) };
      for (const k of [...this.covers.keys()]) this.dropCover(k);
      storage.remove(KEY.draft);
      status.className = "ok";
      mount(status, h("span", {}, "Pushed."), " ", h("a", { href: res.url, target: "_blank", rel: "noopener" }, "See the commit on GitHub"), " ", h("span", {}, "The website shows it in a few minutes."));
      this.refresh();
    } catch (err) {
      button.disabled = false;
      status.className = "error";
      if (err.kind === "conflict" && err.changed) {
        mount(status, h("span", {}, err.message, " "),
          h("button", { class: "btn small", type: "button", onclick: () => { $("#pushDialog").close(); this.open({ path: this.doc.path, fromGitHub: true }); } }, "Open the version on GitHub (your changes stay as a draft)"),
          h("button", { class: "btn small danger", type: "button", onclick: () => this.push({ files, token, remember, message, status, button, overwrite: true }) }, "Push anyway, over it"));
      } else status.textContent = tr(err instanceof GitHubError ? err.message : `The push failed: ${err.message}`);
    }
  }

  _readToken() {
    try {
      return sessionStorage.getItem(KEY.token) || localStorage.getItem(KEY.token) || "";
    } catch {
      return "";
    }
  }

  _storedToken() {
    try {
      return localStorage.getItem(KEY.token);
    } catch {
      return null;
    }
  }

  /** Keep the token for this tab, or (remember) on this device. */
  _storeToken(token, remember) {
    try {
      sessionStorage.setItem(KEY.token, token);
      if (remember) localStorage.setItem(KEY.token, token);
      else localStorage.removeItem(KEY.token);
    } catch {
      /* storage unavailable: for this push only */
    }
  }
}

/* ---------------------------------------------------------------- helpers */

const safe = (f) => {
  try {
    return f();
  } catch {
    return null;
  }
};

function polyPath(ctx, pts, close) {
  ctx.beginPath();
  pts.forEach((s, i) => (i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1])));
  if (close) ctx.closePath();
}

function numberField(id, label, value, onChange) {
  return h("label", { class: "field", for: id }, h("span", {}, label),
    h("input", { type: "number", id, value: round1(value), step: "any", onchange: (e) => Number.isFinite(+e.target.value) && e.target.value !== "" && onChange(round1(+e.target.value)) }));
}

/** A file name from a name: "EBL Waldhof" → "ebl-waldhof". */
export function slugOf(name) {
  return String(name).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

/** The covered photo's name beside the photo: "../media/a.jpg" + a PNG → "../media/a-covered.png". */
export function coveredName(image, file) {
  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[file.type] || "png";
  return String(image).replace(/(-covered)?\.[a-z0-9]+$/i, "") + `-covered.${ext}`;
}

/** A new, empty layout: a table of 2 × 1 m. */
function newLayout({ name, scale = 87 }) {
  return {
    format: ARail.LAYOUT_FORMAT, name, description: "", scale,
    objects: [{ id: "table-1", type: "tabletop", name: "Table", position: [0, 0], width_mm: 2000, depth_mm: 1000 }],
  };
}

const builder = new Builder();
builder.start();
