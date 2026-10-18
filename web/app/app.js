// ARail's pages with a stage: camera/photo/video in, markers tracked, virtual layout and simulations
// drawn on top, and the panels. The app (main.js) shows the modules as stories to click through; the
// game page (../game/main.js) has the games and exercises in the same tabs. A page says which panels
// its tabs have, which simulation shows each module tab, and its examples (see `Page`).
import * as ARail from "../arail/index.js";
import { Editor } from "./editor.js";
import { Inspector } from "./inspect.js";
import { drawGrid, Flyover, SKY } from "./flyover.js";
import { Panels } from "./panels.js";
import { TourNav } from "./tour-nav.js";
import { $, h, morph, mount, storage, toast } from "./ui.js";
import { addTexts, chooseLanguage, i18n, setLanguage, tr } from "./i18n.js";

const params = new URLSearchParams(location.search);
/**
 * A page with a stage (the app, the game page):
 * - `id`: "app" or "game" (the game page keeps what it remembers in the browser apart);
 * - `panels`: the panel of each module tab (`terminal`, `ops`, `infra`, `journeys`, …), made for the
 *   app: `(app) => panel` with `render(el)`, `update()` and optionally `syncWidth()`, `key(e)`;
 * - `shows`: the simulation type that shows each module tab (the tab is there while the layout has it);
 * - `examples`: example layouts `{id, label, layout, image?, video?, tab?, home?}` (`home`: the layout
 *   it is a module of; `image` or `video`: opened with this photo or clip; `tab`: the tab shown), the
 *   first one opened when nothing else was;
 * - `exampleLayers`: examples that are a module (layer) of another example, opened with it on;
 * - `tour`: the photo tour of the lab ({data: the photo map's data.json}): its buttons on the stage
 *   choose what is shown, and the examples are listed in the View panel; a page without it has the
 *   list of layouts (Layouts…) in its bar.
 * @typedef {{id: string, panels: Object<string, (app: App) => object>, shows: Object<string, string>,
 *   examples: object[], exampleLayers: Object<string, {layout: string, layer: string}>, tour?: {data: string}}} Page
 */
/** Former example files that are layers of the lab example now (old links keep working). */
const LEGACY = { "layouts/ebl-operations.json": "operations", "layouts/ebl-infrastructure.json": "infrastructure" };
/** Former tabs that are views of the Settings tab now (their links keep working): tab → [tab, view]. */
const TAB_VIEWS = { simulate: ["settings", "simulate"], control: ["settings", "control"] };
/** Tabs of a feature of the layout: another feature's tab when the layout does not have it, else View. */
const FEATURE_TABS = {
  terminal: ["ops", "infra", "journeys"], ops: ["infra", "journeys", "terminal"], infra: ["ops", "journeys", "terminal"], journeys: ["ops", "infra", "terminal"],
};
/**
 * Modules of the app, offered for every layout next to the layout's own modules (layers): switched
 * on and off in the View panel like those, without loading the layout again. `tab`: the tab it shows;
 * `on`: whether it is on for a layout nobody has switched it for.
 */
const APP_MODULES = [
  {
    id: "build", name: "Build", tab: "build", icon: "build", on: true,
    description: "Place and edit the objects of the layout, its settings and its marker map; survey the markers from a video. Off, nobody changes the layout by mistake.",
  },
  {
    id: "disruptions", name: "Disruptions", tab: "disrupt", icon: "disruptions", on: false,
    description: "Delays, signal failures, cancellations, closures and replacement buses at the stops, and the scenarios of the layout: timelines of disruptions for an exercise.",
  },
];
/** Lowest and highest resolution (px) of the video frames searched for markers; rolling-stock tags are small. */
const PROC_RANGE = [480, 1600], PROC_RANGE_ROLLING = [1280, 1600];

export class App {
  /** @param {Page} page */
  constructor(page) {
    this.page = page;
    /** The tabs of the page, in their order (View, Build, the modules' tabs, Disruptions, Settings). */
    this.tabNames = [...document.querySelectorAll(".tabs [role=tab]")].map((b) => b.id.replace(/^tab-/, ""));
    /** The panels of the module tabs, by tab. */
    this.tabPanels = {};
    this.canvas = $("#stage");
    this.ctx = this.canvas.getContext("2d");
    this.proc = document.createElement("canvas");
    this.pctx = this.proc.getContext("2d", { willReadFrequently: true });
    this.camera = new ARail.Camera(1280, 720);
    this.world = ARail.createWorld({});
    this.tracker = new ARail.PlaneTracker(this.world.map);
    this.detector = null;
    this.source = null;
    this.detections = {};
    /** Rolling-stock tags of the last frame (image corners by tag ID; see MarkerDetector.detectAll). */
    this.rollingDetections = {};
    /** The View of the last frame drawn (null while the layout is not tracked): for picking on the canvas. */
    this.lastView = null;
    this.procMax = 960;
    this.frozen = false;
    this.fps = 0;
    this.clock = 0;
    this.feed = null;
    this.feedUrl = params.get("feed") || storage.get("arail.feedUrl", "ws://localhost:8765/feed");
    this.activeTab = "view";
    this.display = { markers: false, opacity: 1, gridInCamera: false, flyMarkers: true, ...storage.get("arail.display", {}) };
    /** "camera": the camera image (or photo, video) with AR; "flyover": the virtual camera (see flyover.js). */
    this.mode = "camera";
    /** The app's modules that are on, per layout (see _appModulesKey); also kept in the browser. */
    this.appModules = new Map();
    this.layoutUrl = null;
    this.recorder = null;
    this._loadToken = 0;
    /** Where the HUD's chips lie over the canvas (canvas px, measured with the HUD): the stage's labels keep clear of them. */
    this.hudRects = [];
  }

  /* ---------------------------------------------------------------- start */

  async init() {
    setLanguage(chooseLanguage());
    try {
      this.detector = new ARail.MarkerDetector({ dictionary: "ARUCO" });
    } catch (err) {
      this.showEmpty(`Marker detection could not be loaded (${err.message}). Check that the files in web/vendor are present.`);
    }
    const cal = storage.get("arail.calibration");
    if (cal) {
      try {
        this.camera.setCalibration(cal);
      } catch {
        storage.remove("arail.calibration");
      }
    }
    this.flyover = new Flyover(this);
    this.editor = new Editor(this);
    this.panels = new Panels(this);
    for (const [tab, make] of Object.entries(this.page.panels)) this.tabPanels[tab] = make(this);
    /** The panels by their module: the terminal's picking, the journeys' following and Settings use them. */
    this.terminal = this.tabPanels.terminal ?? null;
    this.operations = this.tabPanels.ops ?? null;
    this.infra = this.tabPanels.infra ?? null;
    this.journeys = this.tabPanels.journeys ?? null;
    this.inspector = new Inspector(this);
    /** The photo tour on the stage (the app), or null (the game page). */
    this.tourNav = this.page.tour && $("#tour") ? new TourNav(this, this.page.tour) : null;
    this._wireUi();
    this._wireEvents();
    const tourReady = this.tourNav?.load();
    // ?photo=: a photo of the photo tour, with the layout of its digital layer
    const photo = params.has("photo") && (await tourReady) ? params.get("photo") : null;
    const tourPhoto = !!photo && this.tourNav.byId.has(photo);
    if (photo && !tourPhoto) toast(`There is no photo “${photo}” on the photo map.`, 7000);
    const photoLayout = tourPhoto ? this.tourNav.layoutOf(photo) : null;
    // ?example=: an example with its own photo or clip (a link from the project page)
    const example = this.page.examples.find((x) => x.id === params.get("example")) || null;
    const layout = photoLayout || example?.layout || params.get("layout") || storage.get(this.key("lastLayout")) || this.page.examples[0].layout;
    const image = params.get("image");
    const media = !image && (example?.image || example?.video) ? example : null;
    const layers = params.has("layers") ? params.get("layers").split(",").filter(Boolean) : null;
    await this.loadLayoutFromUrl(layout, { withImage: !tourPhoto && !image && !media && params.get("camera") !== "1", layers });
    if (tourPhoto) this.tourNav.showPhoto(photo);
    else if (image) this.loadImage(new URL(image, location.href).href, "Image");
    else if (media) this._loadExampleMedia(media);
    else if (params.get("camera") === "1") this.startLive();
    if (params.get("mock") === "1") this.panels.startMock();
    else if (params.get("feed")) this.panels.connect();
    const scenario = params.get("scenario");
    if (scenario) {
      this.setAppModule("disruptions", true); // a scenario is played in the module Disruptions
      setTimeout(() => {
        if (this.world.scenarios.scenarios.some((s) => s.id === scenario)) this.world.scenarios.play(scenario);
        else toast(`This layout has no scenario “${scenario}” (see the Disruptions tab).`, 7000);
      }, 500);
    }
    const tab = location.hash.slice(1) || example?.tab || "";
    // a link to the tab of a module of the app (Build, Disruptions) switches it on
    const linked = APP_MODULES.find((m) => m.tab === tab);
    if (linked) this.setAppModule(linked.id, true);
    if (this.tabs().includes(TAB_VIEWS[tab]?.[0] ?? tab)) this.selectTab(tab);
    let last = performance.now(), failing = false;
    const loop = (t) => {
      requestAnimationFrame(loop); // first, so that an error in one frame does not stop the app
      const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
      last = t;
      try {
        this.frame(dt);
        failing = false;
      } catch (err) {
        if (!failing) console.error("Frame failed:", err);
        failing = true;
      }
    };
    requestAnimationFrame(loop);
    setInterval(() => this.refreshPanels(), 400);
    window.__arail = this; // for debugging and end-to-end tests
  }

  _wireUi() {
    // tabs
    for (const name of this.tabNames) $(`#tab-${name}`).addEventListener("click", () => this.selectTab(name));
    $(".tabs").addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const tabs = this.tabs(), i = tabs.indexOf(this.activeTab) + (e.key === "ArrowRight" ? 1 : -1);
      this.selectTab(tabs[(i + tabs.length) % tabs.length]);
      $(`#tab-${this.activeTab}`).focus();
    });
    // sources
    const onFile = (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f) return;
      this.flyover.leave(); // show what was just chosen
      const url = URL.createObjectURL(f);
      if (f.type.startsWith("video")) this.loadVideo(url, f.name, null, url);
      else this.loadImage(url, f.name, url);
    };
    for (const id of ["filePhoto", "fileVideo", "fileOpen"]) $(`#${id}`).addEventListener("change", onFile);
    if (navigator.mediaDevices?.getUserMedia && window.isSecureContext) {
      $("#btnLive").hidden = false;
      $("#btnLive").addEventListener("click", () => {
        this.flyover.leave();
        this.startLive();
      });
    }
    // the list of layouts in the bar (the game page; the app has the photo tour and its examples in the View panel)
    const sel = $("#exampleSelect");
    if (sel) {
      mount(sel, h("option", { value: "" }, "Layouts…"), this.page.examples.map((x) => h("option", { value: x.id }, x.label)));
      sel.addEventListener("change", async () => {
        if (!sel.value) return;
        const id = sel.value;
        sel.value = "";
        await this.openExample(id);
      });
    }
    $("#btnFreeze").addEventListener("click", () => this.setFrozen(!this.frozen));
    $("#btnFullscreen").addEventListener("click", () => {
      const el = $("#stageWrap");
      if (document.fullscreenElement) document.exitFullscreen?.();
      else el.requestFullscreen?.().catch(() => toast("Full screen is not available here."));
    });
    window.addEventListener("resize", () => this.fitCanvas());
    document.addEventListener("fullscreenchange", () => this.fitCanvas());
    new ResizeObserver(() => this.fitCanvas()).observe($("#stageWrap"));
    document.addEventListener("keydown", (e) => this._key(e));
  }

  _wireEvents() {
    const ev = this.world.events;
    ev.on("scenario.message", (e) => toast(e.text));
    ev.on("disruption.started", (e) => {
      const d = e.disruption;
      // a simulation's own disruptions (the infrastructure's faults at the station) and a story's speak for themselves
      if (d.def.hidden || d.id.startsWith("story:")) return;
      // disruptions of the rail operations say what they did ("3 drivers call in sick: …")
      if (typeof d.result === "string") toast(`${d.def.label}: ${d.result}.`);
      else toast(`${d.def.label} started${d.target !== "*" ? ` at ${this.world.getObject(d.target)?.name || this._trackName(d.target) || d.target}` : ""}.`);
    });
    ev.on("disruption.ended", (e) => !e.disruption.def.hidden && !e.disruption.id.startsWith("story:") && toast(`${e.disruption.def.label} ended.`));
    // a story went on (Play, a clicker, a scenario): its tab shows the new step at once
    ev.on("story.step", () => this.storyPanel()?.stepped());
    // journeys: a traveller at its aim
    ev.on("journeys.traveller.arrived", (e) => {
      const late = e.delay >= 1 ? `, ${e.delay} min late` : e.delay <= -1 ? `, ${-e.delay} min early` : ", on time";
      toast(`${e.traveller.name} arrived${late}.`, 3500, { minor: true });
    });
    ev.on("scenario.started", (e) => toast(`Scenario started: ${e.scenario.name || e.scenario.id}`));
    ev.on("feed.status", () => this.panels.updateControl());
    for (const name of ["disruption.started", "disruption.ended", "scenario.started", "scenario.ended"]) {
      ev.on(name, () => {
        this.panels.updateDisruptions();
        this.panels.updateScenarios();
      });
    }
    ev.on("object.added", () => this.panels.renderNewDisruption());
    ev.on("object.removed", () => this.panels.renderNewDisruption());
    // the container terminal
    const T = ARail.TERMINAL_EVENTS;
    ev.on(T.moveFailed, (e) => toast(`${e.move.id}: ${e.move.reason}`));
    ev.on(T.visitArrived, (e) => toast(`${e.visit.name} arrived.`, 3000, { minor: true }));
    ev.on(T.containerLeft, (e) => toast(e.reason === "truck" && e.visit ? `${e.container.id} left the terminal on ${e.visit.name}.` : `${e.container.id} left the terminal (${e.reason}).`, 3000, { minor: true }));
    ev.on(T.wagonLost, (e) => toast(`${e.carrier.label} is out of view; its containers stay on it.`, 3000, { minor: true }));
    // rail operations
    ev.on("ops.unit.failed", (e) => toast(`${e.unit.id} broke down${e.trip ? ` (${e.trip.lineName})` : ""}.`, 3000, { minor: true }));
  }

  _key(e) {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea" || e.metaKey || e.ctrlKey || e.altKey) return;
    // Space and Enter activate focused buttons and links; they are not shortcuts there
    if ((e.key === " " || e.key === "Enter") && e.target.closest?.("button, a, summary, label, [role=button], [role=tab]")) return;
    // a presenter's clicker (Page Down, Page Up) goes through the story of the tab shown
    if (this.storyPanel()?.key(e)) {
      e.preventDefault();
      return;
    }
    if (this.flyover.key(e) || this.tourNav?.key(e)) {
      e.preventDefault();
      return;
    }
    const w = this.world;
    if (e.key === "f" || e.key === "F") {
      this.flyover.toggle();
      e.preventDefault();
    } else if (e.key === "s" || e.key === "S") {
      // the simple view: Shift+S the map, S the 2.5D view (or back to the full flyover)
      this.flyover.simpleButton(e.shiftKey ? "map" : "3d");
      e.preventDefault();
    } else if ((e.key === "r" || e.key === "R") && this.activeTab === "build" && this.editor.selected) {
      if (this.editor.rotateSelected(e.shiftKey ? 90 : 15)) e.preventDefault();
    } else if (e.key === " ") {
      w.paused = !w.paused;
      this.panels.updateSimulateControls();
      e.preventDefault();
    } else if (/^[1-9]$/.test(e.key)) {
      const area = w.stopAreas()[Number(e.key) - 1];
      if (area && area.docks.length && area.docks.every((d) => d.managed)) toast(`${area.owner.name} is served by its bus lines.`);
      else if (area && area.docks.length && area.docks.every((d) => w.services.docks.get(d.id)?.mode === "plan")) toast(`${area.owner.name}: its trains run to the timetable of the rail operations.`);
      else if (area && !w.services.call(area.id)) toast(`${area.owner.name}: no free ${area.kind === "bus" ? "bay" : "track"} right now.`);
    } else if (e.key === "Escape") {
      if (this.terminal?.cancelPick()) return;
      if (this.inspector.close()) return;
      if (this.activeTab === "terminal" && this.terminal?.selected) this.terminal.select(null);
      else if (this.editor.placing) this.editor.cancel();
      else this.editor.select(null);
    } else if ((e.key === "Delete" || e.key === "Backspace") && this.activeTab === "build" && this.editor.selected) {
      this.editor.deleteSelected();
      e.preventDefault();
    } else if (e.key === "m" || e.key === "M") {
      this.display.markers = !this.display.markers;
      this.panels.renderView($("#panel-view"));
    }
  }

  /**
   * The tabs shown: View and Settings always; Build and Disruptions with the app's modules of those
   * names (Build on unless switched off); the tab of a module when the layout has the simulation the
   * page shows it for (the app: Infrastructure with the maintenance story, Journeys with the journeys
   * story; the game page: with the infrastructure game, the journeys exercise).
   */
  tabs() {
    const has = (type) => this.world.simulations.some((s) => s.constructor.type === type);
    const shown = { view: true, settings: true, build: this.appModuleOn("build"), disrupt: this.appModuleOn("disruptions") };
    // a module tab without a panel on this page is not shown
    for (const [tab, type] of Object.entries(this.page.shows)) shown[tab] = !!this.tabPanels[tab] && has(type);
    return this.tabNames.filter((t) => shown[t]);
  }

  /** The key of something the page remembers in the browser ("lastLayout": the app's "arail.lastLayout", the game page's "arail.game.lastLayout"). */
  key(name) {
    return this.page.id === "app" ? `arail.${name}` : `arail.${this.page.id}.${name}`;
  }

  /** Show the tabs of the layout's features; a tab no longer shown hands over to another one. */
  _syncTabs() {
    const shown = this.tabs();
    for (const t of this.tabNames) $(`#tab-${t}`).hidden = !shown.includes(t);
    if (shown.includes(this.activeTab)) return false;
    const next = (FEATURE_TABS[this.activeTab] || []).find((t) => shown.includes(t));
    this.selectTab(next || "view");
    return true;
  }

  /** Show a tab (or a former tab that is a view of Settings now: "simulate", "control"). */
  selectTab(name) {
    if (TAB_VIEWS[name]) {
      this.panels.settingsView = TAB_VIEWS[name][1];
      storage.set("arail.settingsView", TAB_VIEWS[name][1]);
      name = TAB_VIEWS[name][0];
    }
    // another tab opens at its top: the panels share one scrolling column (on a phone, the page)
    if (name !== this.activeTab) this._scrollPanelToTop();
    this.activeTab = name;
    for (const t of this.tabNames) {
      $(`#tab-${t}`).setAttribute("aria-selected", t === name ? "true" : "false");
      $(`#tab-${t}`).tabIndex = t === name ? 0 : -1;
      $(`#panel-${t}`).hidden = t !== name;
    }
    this._scrollTabIntoView($(`#tab-${name}`));
    this.canvas.classList.toggle("editing", name === "build" || name === "terminal");
    if (name !== "build" && this.editor.placing) this.editor.cancel();
    if (name !== "terminal") this.terminal?.cancelPick();
    this.terminal?.syncHighlight();
    // a wide panel (the tables of a game) only while its tab is shown
    document.querySelector(".main")?.classList.remove("wide");
    this.tabPanels[name]?.syncWidth?.();
    this.renderPanel(name);
    // Settings is linked by its view (#simulate, #control), as the tabs were before
    history.replaceState(null, "", `${location.pathname}${location.search}#${name === "settings" ? this.panels.settingsView : name}`);
  }

  /** Show a tab after an action elsewhere (e.g. a simulation added in Settings): its heading takes the keyboard focus. */
  openTab(name) {
    this.selectTab(name);
    const head = $(`#panel-${name} h2`);
    if (!head) return;
    if (!head.hasAttribute("tabindex")) head.tabIndex = -1;
    head.focus();
  }

  /** Scroll the panel column back to its top (on a phone: the page, as far as the tabs, if it is scrolled past them). */
  _scrollPanelToTop() {
    const panel = $("#panel");
    panel.scrollTop = 0;
    const top = panel.getBoundingClientRect().top;
    if (top < 0) window.scrollBy(0, top);
  }

  /** On narrow screens the tabs scroll sideways: the selected one is kept in view (the page does not scroll). */
  _scrollTabIntoView(tab) {
    const bar = tab.parentElement;
    if (bar.scrollWidth <= bar.clientWidth) return;
    const left = tab.getBoundingClientRect().left - bar.getBoundingClientRect().left + bar.scrollLeft, right = left + tab.offsetWidth;
    if (left < bar.scrollLeft) bar.scrollLeft = left - 16;
    else if (right > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = right - bar.clientWidth + 16;
  }

  /** "Platform 1, Track G2" for the id of a platform's track (a dock), or null. */
  _trackName(id) {
    for (const a of this.world.stopAreas()) for (const k of a.docks) if (k.id === id) return `${a.owner.name}, ${k.label}`;
    return null;
  }

  /** The panel of the module tab shown when it tells a story (the app's Infrastructure, …), or null. */
  storyPanel() {
    const p = this.tabPanels[this.activeTab];
    return typeof p?.stepped === "function" ? p : null;
  }

  renderPanel(name) {
    const el = $(`#panel-${name}`);
    if (name === "view") this.panels.renderView(el);
    else if (name === "build") this.editor.render(el);
    else if (name === "settings") this.panels.renderSettings(el);
    else if (name === "disrupt") this.panels.renderDisruptions(el);
    else this.tabPanels[name]?.render(el);
  }

  /** Periodic refresh of live figures in the visible panel. */
  refreshPanels() {
    this.updateHud();
    this.inspector.update();
    const t = this.activeTab;
    if (t === "view") this.panels.updateView();
    else if (t === "settings") this.panels.updateSettings();
    else if (this.tabPanels[t]) this.tabPanels[t].update();
    else if (t === "disrupt") {
      this.panels.updateDisruptions();
      this.panels.updateScenarios();
    } else if (t === "build" && this._mapVersionShown !== this.world.map.ids().length) {
      this._mapVersionShown = this.world.map.ids().length;
      this.editor.renderMarkers();
    }
  }

  /* ---------------------------------------------------------------- layouts */

  /**
   * Open a layout from the list of layouts (or a panel) with its own image; the live camera stops.
   * @param {string[] | null} [layers] the layers to switch on (default: as last time, else as in the file)
   */
  async openLayout(url, layers = null) {
    this.stopLive();
    await this.loadLayoutFromUrl(url, { withImage: true, layers });
  }

  /**
   * Open one of the example layouts by its id (e.g. "terminal", or "operations": the lab with that
   * module on), with its own photo or clip if it has one, and its tab.
   */
  async openExample(id) {
    const x = this.page.examples.find((e) => e.id === id);
    if (x && (x.image || x.video)) {
      this.stopLive();
      // the photo or clip shown until now belongs to the previous layout
      if (this.source) this.source.stale = true;
      await this.loadLayoutFromUrl(x.layout, { withImage: false });
      this._loadExampleMedia(x);
    } else if (x) await this.openLayout(x.layout);
    if (x?.tab && this.tabs().includes(x.tab)) this.selectTab(x.tab);
    if (x) return;
    const l = this.page.exampleLayers[id];
    if (!l) return;
    // the layout is open already: switch the module on
    if (this.world.layers().some((y) => y.id === l.layer)) return this.switchOnModule(l.layer);
    return this.openLayout(l.layout, [l.layer]);
  }

  /** The photo or clip of an example (shown over the camera image, not in the flyover). */
  _loadExampleMedia(x) {
    if (this._autoFlyover) {
      this._autoFlyover = false;
      this.flyover.leave();
    }
    const src = new URL(x.video || x.image, location.href).href;
    if (x.video) this.loadVideo(src, x.label.replace(/^Example: /, ""));
    else this.loadImage(src, x.label.replace(/^Example: /, ""));
  }

  /**
   * Show a photo of the photo tour: with the layout of its digital layer (opened first when another
   * one is open), which tracks it; without a layout (`track: false`) as the photo only: its markers
   * are not looked for, and the layout stays.
   * @param {string} src
   * @param {string} name
   * @param {{layout?: string | null, track?: boolean, current?: () => boolean}} [options] current:
   *   false once another photo was asked for (while the layout loaded)
   */
  async openPhoto(src, name, { layout = null, track = true, current = () => true } = {}) {
    this.stopLive();
    if (layout && layout !== this.layoutUrl) {
      // the photo or clip shown until now belongs to the previous layout
      if (this.source) this.source.stale = true;
      await this.loadLayoutFromUrl(layout, { withImage: false });
      if (!current()) return;
    }
    if (this._autoFlyover) {
      this._autoFlyover = false;
      this.flyover.leave();
    }
    this.loadImage(src, name, null, { track });
  }

  /** The module (layer, off) of this layout that opens an example (e.g. "terminal": the lab's container terminal), or null. */
  moduleOpening(exampleId) {
    const x = this.page.examples.find((e) => e.id === exampleId), id = this.page.exampleLayers[exampleId]?.layer;
    return this.world.layers().find((l) => !l.enabled && (l.id === id || (x && l.layout && new URL(l.layout, this.layoutUrl || location.href).href === new URL(x.layout, location.href).href))) || null;
  }

  /** Ids of the layers (modules) that are on. */
  layersOn() {
    return this.world.layers().filter((l) => l.enabled).map((l) => l.id);
  }

  /**
   * The modules shown in the View panel: the layers of this layout (in a layout that is a module of
   * another one, a layout of its own like the container terminal: the modules of that one), then the
   * app's modules (Build, Disruptions).
   * @returns {Array<{id: string, name: string, description: string, enabled: boolean, exclusive: boolean, layout: string | null, app?: boolean}>}
   */
  modules() {
    const own = this.world.layers(), home = this.moduleHome;
    const layers = own.length || !home ? own : home.modules.map((m) => ({ ...m, enabled: m.id === home.module }));
    return [...layers, ...APP_MODULES.map((m) => ({ ...m, enabled: this.appModuleOn(m.id), exclusive: false, layout: null, app: true }))];
  }

  /** Where the app's modules switched for a layout are kept: per layout, a module layout (the terminal) with its home. */
  _appModulesKey() {
    return `arail.appModules:${this.moduleHome?.url || this.layoutUrl}`;
  }

  /** The ids of the app's modules that are on for this layout: as switched (kept in the browser), else as by default. */
  _appModulesOn() {
    const key = this._appModulesKey();
    if (!this.appModules.has(key)) {
      const saved = storage.get(key, {});
      const switched = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
      this.appModules.set(key, APP_MODULES.filter((m) => (typeof switched[m.id] === "boolean" ? switched[m.id] : m.on)).map((m) => m.id));
    }
    return this.appModules.get(key);
  }

  /** Is this module of the app (e.g. "disruptions") on? */
  appModuleOn(id) {
    return this._appModulesOn().includes(id);
  }

  /**
   * Switch a module of the app on or off. Disruptions off: the disruptions started from its panel and
   * the scenario stop (those the simulations start themselves, e.g. faults of the infrastructure, go on).
   * Build off: an object being placed is dropped, the selection cleared.
   */
  setAppModule(id, on) {
    const m = APP_MODULES.find((x) => x.id === id);
    if (!m || this.appModuleOn(id) === on) return;
    const ids = this._appModulesOn().filter((x) => x !== id);
    if (on) ids.push(id);
    this.appModules.set(this._appModulesKey(), ids);
    // only what differs from the defaults is kept
    storage.set(this._appModulesKey(), Object.fromEntries(APP_MODULES.filter((x) => ids.includes(x.id) !== x.on).map((x) => [x.id, ids.includes(x.id)])));
    if (id === "build" && !on) {
      if (this.editor.placing) this.editor.cancel();
      this.editor.selected = null;
    }
    if (id === "disruptions" && !on) {
      const w = this.world;
      if (w.scenarios.current) w.scenarios.stop();
      for (const d of [...w.disruptions.active]) if (!d.def.hidden) w.disruptions.stop(d.id);
    }
    if (!this._syncTabs() && this.activeTab === "view") this.renderPanel("view");
  }

  /**
   * Switch a module on or off (View panel). Rail operations, infrastructure and journeys are combined;
   * an exclusive module switches the others off, and a module that is a layout of its own (the
   * container terminal) opens that layout. In such a layout, any other choice goes back to its home.
   * The app's modules (Build, Disruptions) go with every choice.
   */
  toggleModule(id) {
    if (APP_MODULES.some((m) => m.id === id)) return this.setAppModule(id, !this.appModuleOn(id));
    const home = this.moduleHome;
    if (home && !this.world.layers().length) return this.openLayout(home.url, ARail.toggleLayer(home.modules, [home.module], id));
    return this.chooseModules(ARail.toggleLayer(this.world.layers(), this.layersOn(), id));
  }

  /** Switch a module of the layout on (Settings, an example), with the others that go with it: an exclusive one alone, or without the exclusive ones. */
  switchOnModule(id) {
    const on = this.layersOn();
    return this.chooseModules(on.includes(id) ? on : ARail.toggleLayer(this.world.layers(), on, id));
  }

  /** Exactly these modules on (exclusive ones alone); a module that is a layout of its own opens it. */
  chooseModules(ids) {
    const layers = this.world.layers();
    const on = ARail.layerChoice(layers, ids);
    const own = layers.find((l) => l.layout && on.includes(l.id));
    if (own) return this._openModuleLayout(own, { url: this.layoutUrl, name: this.world.layout.name, layers });
    return this.setLayers(on);
  }

  /** Open the layout of a module; its home (the layout whose module it is) is remembered for the way back. */
  _openModuleLayout(layer, home) {
    const url = new URL(layer.layout, home.url).href;
    // the home keeps nothing else on: the module was chosen alone
    storage.set(`arail.layers:${home.url}`, []);
    storage.set(`arail.moduleHome:${url}`, moduleHomeRecord(home, layer.id));
    this.stopLive();
    return this.loadLayoutFromUrl(url, { withImage: true });
  }

  /** Switch the layout's layers: exactly these are on. Edits are kept; the simulations start again. */
  async setLayers(ids) {
    const json = ARail.withLayers(this.world.toJSON(), ids);
    storage.set(this._layersKey(), [...ids]);
    const edited = this._pendingSave != null || storage.get(this._layoutKey()) != null;
    try {
      await this._applyLayout(json);
    } catch (err) {
      toast(`The modules could not be switched: ${err.message}`, 7000);
      return;
    }
    if (edited) this.saveLayout();
  }

  async loadLayoutFromUrl(url, { withImage = !this.source || this.source.kind === "image", layers = null } = {}) {
    const legacy = Object.keys(LEGACY).find((f) => url.endsWith(f));
    if (legacy) {
      // a former example file: the lab example with that layer on
      url = url.replace(legacy, "layouts/ebl-lab.json");
      layers = layers || [LEGACY[legacy]];
    }
    this.flushSave(); // pending edits belong to the current layout
    let json;
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      json = await res.json();
      if (!ARail.isLayout(json)) throw new Error("this is not an ARail layout file");
    } catch (err) {
      toast(`Could not load the layout ${url}: ${err.message}`);
      json = {};
    }
    const absolute = new URL(url, location.href).href;
    // a module that is a layout of its own (asked for, or chosen last time): that layout, with this one as its home
    const fileLayers = ARail.normalizeLayers(json.layers);
    const wanted = ARail.layerChoice(fileLayers, layers || storage.get(`arail.layers:${absolute}`) || []);
    const own = fileLayers.find((l) => l.layout && wanted.includes(l.id));
    if (own) return this._openModuleLayout(own, { url: absolute, name: json.name || "Layout", layers: fileLayers });
    // its modules that are layouts of their own know their home (for the way back)
    for (const l of fileLayers) if (l.layout) storage.set(`arail.moduleHome:${new URL(l.layout, absolute).href}`, moduleHomeRecord({ url: absolute, name: json.name || "Layout", layers: fileLayers }, l.id));
    this.layoutUrl = absolute;
    this.originalLayout = json;
    storage.set(this.key("lastLayout"), url);
    this.moduleHome = await this._moduleHome(absolute);
    // layers: as asked for, else as last time, else as the file has them
    if (layers) storage.set(this._layersKey(), layers);
    const chosen = layers || storage.get(this._layersKey()) || null;
    // (an exclusive module alone)
    const pick = (j) => (chosen && Array.isArray(j.layers) ? ARail.withLayers(j, ARail.layerChoice(ARail.normalizeLayers(j.layers), chosen)) : j);
    // a covered photo (the room painted over, made in an image editor) is shown instead of the photo
    const img = json.view?.image_covered || json.view?.image;
    // the layout's own image follows: the photo or video shown until then belongs to the previous
    // layout, and markers detected in it must not be measured into this layout's marker map
    if (withImage && img && this.source) this.source.stale = true;
    // a virtual layout opens in the flyover: the photo or video shown until then does not belong to it
    const virtual = json.view?.start === "flyover";
    if (virtual && this.source) this.source.stale = true;
    let edited = storage.get(this._layoutKey());
    // changes saved before the layout had layers: they keep the file's layers
    if (edited && edited.layers == null && Array.isArray(json.layers)) edited = { ...edited, layers: json.layers };
    let restored = false;
    if (edited) {
      try {
        await this._applyLayout(pick(edited));
        restored = true;
        toast("Your changes to this layout were restored. Use Build → Reset to original to discard them.");
      } catch (err) {
        console.warn("Saved changes could not be applied:", err);
      }
    }
    if (!restored) {
      try {
        await this._applyLayout(pick(json));
      } catch (err) {
        toast(`The layout ${url} could not be loaded: ${err.message}`, 7000);
        await this._applyLayout({});
      }
    }
    if (virtual) {
      this.flyover.enter();
      this._autoFlyover = true;
    } else if (withImage && img && this._autoFlyover) {
      // back from a virtual layout to one with its own photo: the photo is shown
      this._autoFlyover = false;
      this.flyover.leave();
    }
    if (withImage && img) this.loadImage(new URL(img, this.layoutUrl).href, json.name || "Example");
  }

  _layoutKey() {
    return `arail.layout:${this.layoutUrl}`;
  }

  /**
   * The home of a layout that is a module of another one ({url, name, module, modules}), or null: as
   * remembered when it was opened as a module, else for an example its example home.
   */
  async _moduleHome(url) {
    const saved = storage.get(`arail.moduleHome:${url}`);
    if (saved?.url && Array.isArray(saved.modules)) return saved;
    const x = this.page.examples.find((e) => e.home && new URL(e.layout, location.href).href === url);
    if (!x) return null;
    try {
      const homeUrl = new URL(x.home, location.href).href;
      const res = await fetch(homeUrl, { cache: "no-cache" });
      const json = res.ok ? await res.json() : null;
      const layers = ARail.normalizeLayers(json?.layers);
      const layer = layers.find((l) => l.layout && new URL(l.layout, homeUrl).href === url);
      if (!layer) return null;
      const home = moduleHomeRecord({ url: homeUrl, name: json.name || "Layout", layers }, layer.id);
      storage.set(`arail.moduleHome:${url}`, home);
      return home;
    } catch {
      return null;
    }
  }

  /** Where the choice of layers of this layout is kept (it is no change of the layout). */
  _layersKey() {
    return `arail.layers:${this.layoutUrl}`;
  }

  /** Load a layout into the world; on an error the previous layout stays loaded and the error is thrown. */
  async _applyLayout(json) {
    const plugins = ARail.layoutPlugins(json); // also those of layers that are off
    if (plugins.length) {
      const errors = await ARail.loadPlugins(plugins, this.layoutUrl || location.href);
      if (errors.length) toast(`Plugins could not be loaded: ${errors.join("; ")}`, 8000);
      addTexts(); // the plugins' texts in other languages
    }
    const problems = ARail.validateLayout(json, this.world.registry);
    const settings = { ...this.world.settings, ...storage.get("arail.settings", {}) };
    this.editor.reset();
    this.inspector?.reset();
    const previous = this.world.toJSON();
    try {
      this.world.load(json);
    } catch (err) {
      this.world.load(previous);
      throw err;
    } finally {
      Object.assign(this.world.settings, settings);
      this.tracker = new ARail.PlaneTracker(this.world.map);
      this.applyDictionary();
      this.showLayoutName();
      this.flyover.layoutChanged();
      if (!this._syncTabs()) this.renderPanel(this.activeTab);
      this.sizeCanvas(); // view.extend_below of this layout
      this.redetect();
    }
    if (problems.length) console.warn("Layout problems:", problems);
  }

  async importLayout(text, name) {
    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      toast(`${name} is not valid JSON: ${err.message}`);
      return;
    }
    if (!ARail.isLayout(json)) {
      toast(`${name} is not an ARail layout file (expected "format": "${ARail.LAYOUT_FORMAT}"). Nothing was changed.`, 7000);
      return;
    }
    this.flushSave();
    try {
      await this._applyLayout(json);
    } catch (err) {
      toast(`${name} could not be loaded: ${err.message}. Nothing was changed.`, 7000);
      return;
    }
    const problems = ARail.validateLayout(json, this.world.registry);
    this.saveLayout();
    toast(problems.length ? `Layout loaded with warnings: ${problems[0]}` : `Layout “${this.world.layout.name}” loaded.`);
  }

  async resetLayout() {
    this.cancelSave();
    storage.remove(this._layoutKey());
    const on = this.layersOn();
    await this._applyLayout(ARail.withLayers(this.originalLayout || {}, on));
    toast("Layout reset to the original file.");
  }

  /** Save the layout in this browser (shortly after the last change). */
  saveLayout() {
    clearTimeout(this._saveTimer);
    const key = this._layoutKey(); // the layout being edited now, even if another one is loaded meanwhile
    this._pendingSave = () => {
      this._pendingSave = null;
      storage.set(key, this.world.toJSON());
    };
    this._saveTimer = setTimeout(this._pendingSave, 300);
  }

  /** Save a pending change now (before another layout is loaded). */
  flushSave() {
    clearTimeout(this._saveTimer);
    this._pendingSave?.();
  }

  cancelSave() {
    clearTimeout(this._saveTimer);
    this._pendingSave = null;
  }

  savePrefs() {
    storage.set("arail.display", this.display);
    const { labels, trails, showTracks, feedVehicles, lighting, peopleColour, coverMarkers, trackSystems } = this.world.settings;
    // where a train may run belongs to that train: not kept
    storage.set("arail.settings", { labels, trails, showTracks, feedVehicles, lighting, peopleColour, coverMarkers, trackSystems: trackSystems === "compatibility" ? "" : trackSystems });
  }

  /**
   * Show the app in another language (View → Language), kept on this device: the page's markup,
   * the panel, the HUD and an open card are made again.
   * @param {string} lang
   */
  changeLanguage(lang) {
    setLanguage(lang, { keep: true });
    this.showLayoutName();
    this.renderPanel(this.activeTab);
    this.updateHud();
    this.inspector.render();
    toast(lang === "de" ? "Die App ist jetzt auf Deutsch. Was noch nicht übersetzt ist, bleibt Englisch." : "The app is in English now.");
  }

  /** The language the app is shown in ("en", "de"). */
  get language() {
    return i18n.lang;
  }

  showLayoutName() {
    const on = this.world.layers().filter((l) => l.enabled).map((l) => tr(l.name));
    $("#layoutName").textContent = [tr(this.world.layout.name), ...on].join(" · ");
    document.title = `${tr(this.world.layout.name)} · ${tr("ARail App")}`;
  }

  /** Follow a traveller of the journeys with the flyover's camera (it opens the flyover). */
  followTraveller(id) {
    const sim = ARail.journeysOf(this.world);
    if (!sim) return;
    sim.selected = id;
    if (!this.flyover.active) this.flyover.enter();
    this.flyover.follow(() => sim.positionOf(id));
  }

  /**
   * Set up the marker detector for the layout: its marker type and number of codes (a locked
   * marker map needs only the codes up to its highest ID, see MarkerMap.detectionCodes). Call it
   * again when the map is locked or unlocked or its moving markers change, with `keepType`: a
   * marker type that was detected automatically is then kept.
   * @param {{keepType?: boolean}} [options]
   */
  applyDictionary({ keepType = false } = {}) {
    if (!this.detector) return;
    const { dictionary: d, rolling: r } = this.world.layout.markers;
    const codes = this.world.map.detectionCodes(this.world.layout.markers.codes);
    const found = keepType && d === "auto" ? this.detector.selected?.name ?? null : null;
    // rolling-stock tags (markers.rolling): a second marker family, read in the same pass
    const rolling = r ? { dictionary: r.dictionary, codes: r.codes, maxBitErrors: r.max_bit_errors } : null;
    if (this.detector.codes !== codes || JSON.stringify(this.detector.rollingOptions ?? null) !== JSON.stringify(rolling)) {
      try {
        this.detector = new ARail.MarkerDetector({ dictionary: "ARUCO", codes, rolling });
      } catch (err) {
        toast(`Marker detection could not be set up for ${codes} codes: ${err.message}`);
      }
    }
    // the small tags need a sharper image
    if (rolling) this.procMax = Math.max(this.procMax, PROC_RANGE_ROLLING[0]);
    try {
      this.detector.setDictionary(d === "auto" ? found : d);
    } catch {
      toast(`Unknown marker type “${d}”; detecting automatically.`);
      this.detector.setDictionary(null);
    }
  }

  /* ---------------------------------------------------------------- sources */

  /**
   * @param {{track?: boolean}} [options] track: false shows a photo without looking for its markers
   *   (a photo of the photo tour without a digital layer: `source.untracked`)
   */
  setSource(el, kind, nw, nh, name, objectUrl = null, { track = true } = {}) {
    const old = this.source;
    if (old?.kind === "live" && kind !== "live") this.stopLive();
    const s = Math.min(1, (kind === "image" ? 1600 : 1280) / Math.max(nw, nh));
    this.source = { el, kind, nw, nh, w: Math.round(nw * s), h: Math.round(nh * s), name, objectUrl, untracked: !track };
    if (old && old.el !== el) this._release(old);
    // in the flyover the canvas belongs to the virtual camera: the new source is shown when leaving it
    if (!this.flyover.active) this.sizeCanvas();
    this.camera.setSize(this.source.w, this.source.h);
    this.tracker.reset();
    this.detections = {};
    this.rollingDetections = {};
    ARail.terminalOf(this.world)?.forgetObservations();
    if (this.world.layout.markers.dictionary === "auto") this.detector?.setDictionary(null);
    this.setFrozen(false);
    $("#emptyStage").hidden = true;
    this.canvas.hidden = false;
    this.fitCanvas();
    if (kind === "image") this.redetect();
  }

  /**
   * Load an image as the source. A source requested later wins, even if it loads faster.
   * @param {string} src URL
   * @param {string} name shown in the app
   * @param {string | null} [objectUrl] object URL to revoke when the source is replaced
   * @param {{track?: boolean}} [options] track: false shows it without looking for markers (see setSource)
   */
  loadImage(src, name, objectUrl = null, { track = true } = {}) {
    const token = ++this._loadToken;
    const img = new Image();
    img.crossOrigin = "anonymous"; // images from other sites must allow it, or the canvas cannot be read
    img.onload = () => {
      if (token === this._loadToken) this.setSource(img, "image", img.naturalWidth, img.naturalHeight, name, objectUrl, { track });
      else if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    img.onerror = () => token === this._loadToken && toast(`The image ${name} could not be loaded.`);
    img.src = src;
  }

  loadVideo(url, name, stream = null, objectUrl = null) {
    const token = ++this._loadToken;
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.loop = !stream;
    v.setAttribute("playsinline", "");
    if (stream) v.srcObject = stream;
    else v.src = url;
    v.onloadedmetadata = () => {
      if (token !== this._loadToken) return this._release({ el: v, kind: stream ? "live" : "video", objectUrl });
      this.setSource(v, stream ? "live" : "video", v.videoWidth, v.videoHeight, name, objectUrl);
      if (this.flyover.active && !stream) {
        this.flyover.resumeVideoOnLeave(); // shown (and played) when leaving the flyover
        return;
      }
      v.play().catch(() => toast("The video cannot be played here. Take a photo instead."));
    };
    v.onerror = () => token === this._loadToken && toast("The video cannot be played here. Take a photo instead.");
  }

  /** Stop a source that is replaced: camera stream, video decoding, object URL. */
  _release(src) {
    if (src.kind !== "image") {
      const v = src.el;
      v.onloadedmetadata = v.onerror = null;
      v.srcObject?.getTracks?.().forEach((t) => t.stop());
      v.pause();
      v.srcObject = null;
      v.removeAttribute("src");
      v.load();
    }
    if (src.objectUrl) URL.revokeObjectURL(src.objectUrl);
  }

  async startLive() {
    if (this._startingLive) return;
    this._startingLive = true;
    try {
      this.stopLive(); // phones cannot open the camera twice
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
      });
      this.loadVideo(null, "Live camera", stream);
      this._wakeLock = await navigator.wakeLock?.request("screen").catch(() => null);
    } catch (err) {
      toast(`No access to the camera: ${err.message}. Allow camera access, or use “Take photo”.`, 7000);
    } finally {
      this._startingLive = false;
    }
  }

  stopLive() {
    if (this.source?.kind === "live") this.source.el.srcObject?.getTracks().forEach((t) => t.stop());
    this._wakeLock?.release?.().catch(() => {});
    this._wakeLock = null;
  }

  setFrozen(on) {
    this.frozen = on && !!this.source && this.source.kind !== "image";
    const btn = $("#btnFreeze");
    btn.hidden = !this.source || this.source.kind === "image" || this.flyover.active;
    btn.setAttribute("aria-pressed", this.frozen ? "true" : "false");
    if (this.source?.kind === "video") this.frozen ? this.source.el.pause() : this.source.el.play().catch(() => {});
    if (this.frozen && this.source) {
      // keep a still copy of the current frame
      const still = document.createElement("canvas");
      still.width = this.source.w;
      still.height = this.source.h;
      still.getContext("2d").drawImage(this.source.el, 0, 0, still.width, still.height);
      this.frozenFrame = still;
    } else this.frozenFrame = null;
  }

  showEmpty(text) {
    const el = $("#emptyStage");
    el.textContent = tr(text);
    el.hidden = false;
  }

  /**
   * The canvas for the source: the photo or video, and below it the share of its height that the
   * layout extends the picture by (`view.extend_below`, not for the live camera). The camera stays
   * the source's, so the virtual parts of the layout in front of the table are drawn below it.
   */
  sizeCanvas() {
    const s = this.source;
    if (!s || this.flyover.active) return;
    const below = s.kind === "live" ? 0 : Math.round(s.h * ARail.extendBelowOf(this.world.layout));
    if (this.canvas.width !== s.w || this.canvas.height !== s.h + below) {
      this.canvas.width = s.w;
      this.canvas.height = s.h + below;
      this.fitCanvas();
    }
  }

  /** Fit the canvas into the stage while keeping its aspect ratio (the flyover fills the stage). */
  fitCanvas() {
    document.documentElement.style.setProperty("--bar-h", `${$("#bar").offsetHeight}px`);
    if (this.flyover?.active) return this.flyover.resize();
    const wrap = $("#stageWrap");
    const W = this.canvas.width, H = this.canvas.height;
    const maxW = wrap.clientWidth;
    const narrow = window.innerWidth < 1000;
    const maxH = document.fullscreenElement ? window.innerHeight : narrow ? window.innerHeight * 0.72 : wrap.clientHeight;
    const k = Math.min(maxW / W, maxH / H);
    this.canvas.style.width = `${Math.floor(W * k)}px`;
    this.canvas.style.height = `${Math.floor(H * k)}px`;
  }

  /**
   * The current camera pose: homography layout (mm) -> canvas (px) and its inverse. From the
   * virtual camera in the flyover, else from the marker tracking (H is null while not tracked).
   * @returns {{H: number[] | null, Hinv: number[] | null}}
   */
  pose() {
    return this.flyover.active ? this.flyover.pose() : this.tracker.state;
  }

  /**
   * Layout point (mm) under a pointer event, or null (layout not tracked; the sky of the flyover): on
   * what lies there, a raised table module or a bridge (core/elevation.js), as drawn in the last frame.
   */
  eventToLayout(e) {
    const c = this.canvas, r = c.getBoundingClientRect();
    const u = ((e.clientX - r.left) * c.width) / r.width, v = ((e.clientY - r.top) * c.height) / r.height;
    if (this.flyover.active) return this.flyover.surfacePoint(u, v);
    const Hinv = this.tracker.state.Hinv;
    if (!Hinv) return null;
    const view = this.lastView;
    if (view && view.H === this.tracker.state.H) return ARail.surfacePoint(this.world, view, [u, v]);
    const p = ARail.applyH(Hinv, [u, v]);
    return p.every(Number.isFinite) ? p : null;
  }

  /** Is the grid shown? Always in the flyover, in the camera view only if chosen (View panel). */
  gridVisible() {
    return this.flyover.active || !!this.display.gridInCamera;
  }

  /** Canvas pixels per CSS pixel (line widths and fonts). */
  px() {
    return Math.max(1, this.canvas.width / Math.max(1, this.canvas.clientWidth));
  }

  /** Detect markers in a still image once, at high resolution. */
  redetect() {
    if (!this.source || !this.detector || this.source.stale || this.source.untracked) return;
    if (this.source.kind !== "image") return; // video frames are processed continuously
    const { el, nw, nh } = this.source;
    toast("Looking for markers…", 1500, { minor: true }); // e.g. "Your changes to this layout were restored" stays
    setTimeout(() => {
      if (this.source?.el !== el || this.source.stale) return;
      const s = Math.min(1, 2000 / Math.max(nw, nh));
      const pw = Math.round(nw * s), ph = Math.round(nh * s);
      this.proc.width = pw;
      this.proc.height = ph;
      this.pctx.drawImage(el, 0, 0, pw, ph);
      try {
        this._detect(this.pctx.getImageData(0, 0, pw, ph), this.source.w / pw);
      } catch (err) {
        toast(`The image cannot be analysed: ${err.message}`, 7000);
        return;
      }
      const st = this.tracker.update(this.detections, this.clock, this.camera, { still: true });
      this._observeRolling(true);
      const n = Object.keys(this.detections).length;
      if (!n) toast("No markers found. Get closer, look from above at an angle, use good light, and check the marker type in Build → Layout.", 7000);
      else if (!st.H) toast(`${n} markers found, but none of them is in the marker map of this layout.`, 6000);
      this.world.objectChanged(null);
      this.updateHud();
    }, 30);
  }

  _processVideo() {
    const { el, nw, nh } = this.source;
    if (el.readyState < 2 || !this.detector) return;
    const s = Math.min(1, this.procMax / Math.max(nw, nh));
    const pw = Math.round(nw * s), ph = Math.round(nh * s);
    if (this.proc.width !== pw || this.proc.height !== ph) {
      this.proc.width = pw;
      this.proc.height = ph;
    }
    this.pctx.drawImage(el, 0, 0, pw, ph);
    const t0 = performance.now();
    try {
      this._detect(this.pctx.getImageData(0, 0, pw, ph), this.source.w / pw);
    } catch (err) {
      if (!this._detectError) toast(`The video cannot be analysed: ${err.message}`, 7000);
      this._detectError = true;
      return;
    }
    const ms = performance.now() - t0;
    const [lo, hi] = this.detector.rolling ? PROC_RANGE_ROLLING : PROC_RANGE;
    this.procMax = ms > 45 ? Math.max(lo, this.procMax * 0.9) : ms < 20 ? Math.min(hi, this.procMax * 1.05) : this.procMax;
    this.tracker.update(this.detections, this.clock, this.camera);
    this._observeRolling(false);
  }

  /** Find the markers in an image: the layout's markers and (with `detectAll`) the rolling-stock tags. */
  _detect(imageData, scale) {
    if (typeof this.detector.detectAll === "function") {
      const found = this.detector.detectAll(imageData, scale);
      this.detections = found.markers;
      this.rollingDetections = found.rolling || {};
    } else {
      this.detections = this.detector.detect(imageData, scale);
      this.rollingDetections = {};
    }
  }

  /**
   * Model wagons: the rolling-stock tags of this frame, lifted to their deck height, go to the
   * terminal. Without a camera pose they go without a pose: they keep a known wagon held.
   */
  _observeRolling(still) {
    const term = ARail.terminalOf(this.world);
    if (!term?.rollingConfig() || typeof this.tracker.liftMarkers !== "function") return;
    const tags = this.tracker.liftMarkers(this.rollingDetections, this.camera, (id) => term.tagHeight(id));
    if (!this.tracker.H) for (const id of Object.keys(this.rollingDetections)) tags[id] ??= { center: null, heading: null, edge_mm: null };
    term.observe(tags, this.clock, { still });
  }

  /* ---------------------------------------------------------------- frame loop */

  frame(dt) {
    this.clock += dt;
    if (dt > 0) this.fps = 0.9 * this.fps + 0.1 / Math.max(dt, 1e-3);
    const fly = this.flyover.active;
    if (!fly && this.source && this.source.kind !== "image" && !this.frozen && !this.source.stale) this._processVideo();
    if (this.feed?.tick) this.feed.tick(dt);
    this.world.step(dt);
    if (fly) this.flyover.step(dt);
    this.render();
  }

  render() {
    if (this.flyover.active) return this.flyover.render();
    this.lastView = null;
    const { ctx, source } = this;
    if (!source || source.stale) return;
    if (this.canvas.height > source.h) {
      // the picture extended below the source (view.extend_below): only virtual things there
      ctx.fillStyle = SKY.floorNear; // the lab floor of the flyover
      ctx.fillRect(0, source.h, this.canvas.width, this.canvas.height - source.h);
    }
    // behind a covered photo's transparent parts: the floor, as below the photo
    if (source.kind === "image") {
      ctx.fillStyle = SKY.floorNear;
      ctx.fillRect(0, 0, source.w, source.h);
    }
    ctx.drawImage(this.frozenFrame || source.el, 0, 0, source.w, source.h);
    const { H } = this.pose();
    if (H) {
      const labelScale = Math.min(1, Math.max(0.72, this.canvas.clientWidth / 1000));
      const view = new ARail.View({ ctx, camera: this.camera, H, scale: this.world.scale, px: this.px(), opacity: this.display.opacity, time: this.world.time, labelScale, translate: tr });
      view.placed.push(...this.hudRects); // the labels keep clear of the HUD
      if (this.display.gridInCamera) drawGrid(view, this._cameraGridBounds(), this.world.layout.grid.size_mm, { onImage: true });
      if (this.world.settings.coverMarkers) this._drawMarkerCovers(view);
      this.world.draw(view, { selected: this.activeTab === "build" ? this.editor.selected : null });
      this.editor.drawOverlay(ctx, view);
      this.terminal?.drawOverlay(ctx, view);
      this.lastView = view;
      this.inspector.drawOverlay(ctx, view);
    }
    if (this.display.markers) this._drawMarkers(ctx);
  }

  /**
   * Grey plates over the markers of the map, each with its number painted on it (View → Show →
   * Cover the markers, world setting `coverMarkers`): the stickers disappear from the picture. A
   * plate covers the marker and its white paper (1.6 times the marker's size); it lies on the
   * table, under the virtual objects. A marker under a raised table module needs none: the module
   * covers it.
   */
  _drawMarkerCovers(view) {
    const map = this.world.map, el = this.world.elevation.sync(), fill = ARail.grey(0.62), stroke = ARail.grey(0.5), textColour = ARail.grey(0.93);
    for (const id of map.ids()) {
      const e = map.get(id), s = map.sizeOf(id);
      if (e && !(el.ground(e.x, e.y) > 0.5)) view.plate([e.x, e.y], e.theta, 1.6 * s, 1.6 * s, { fill, stroke, text: String(id), textColour, textSize: 0.7 * s, order: -60 });
    }
  }

  /** Where the grid is drawn over the camera image: around the markers, objects and table modules. */
  _cameraGridBounds() {
    const b = ARail.defaultTableBounds(this.world, 200) || [-500, -300, 500, 300];
    for (const o of this.world.objects) {
      if (o.type !== "tabletop" || !o.geometry) continue;
      for (const p of o.geometry.footprint) {
        b[0] = Math.min(b[0], p[0] - 200);
        b[1] = Math.min(b[1], p[1] - 200);
        b[2] = Math.max(b[2], p[0] + 200);
        b[3] = Math.max(b[3], p[1] + 200);
      }
    }
    return b;
  }

  _drawMarkers(ctx) {
    const px = this.px();
    const used = new Set(this.tracker.state.used);
    for (const [id, c] of Object.entries(this.detections)) {
      ctx.beginPath();
      c.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = used.has(Number(id)) ? ARail.OVERLAY.tracked : ARail.OVERLAY.selection;
      ctx.stroke();
      const cx = c.reduce((s, p) => s + p[0], 0) / 4, cy = c.reduce((s, p) => s + p[1], 0) / 4;
      ctx.font = `700 ${13 * px}px ${ARail.FONT}`;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.textAlign = "center";
      ctx.fillText(id, cx, cy - 12 * px);
    }
    // rolling-stock tags: dashed, with wagon and slot (W3·1)
    const stride = this.world.layout.markers.rolling?.stride ?? 4;
    ctx.save();
    ctx.setLineDash([5 * px, 4 * px]);
    ctx.strokeStyle = ctx.fillStyle = ARail.OVERLAY.tracked;
    ctx.lineWidth = 2 * px;
    ctx.font = `700 ${12 * px}px ${ARail.FONT}`;
    ctx.textAlign = "center";
    for (const [id, c] of Object.entries(this.rollingDetections)) {
      ctx.beginPath();
      c.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.stroke();
      const { number, slot } = ARail.decodeTag(Number(id), stride);
      const cx = c.reduce((s, p) => s + p[0], 0) / 4, cy = c.reduce((s, p) => s + p[1], 0) / 4;
      ctx.fillText(`W${number}·${slot}`, cx, cy - 10 * px);
    }
    ctx.restore();
  }

  updateHud() {
    const st = this.tracker.state, chips = [];
    // on a phone the chips would cover the picture: fewer of them (no grid, no terminal without moves,
    // the speed and a pause with the clock)
    const narrow = this.canvas.clientWidth > 0 && this.canvas.clientWidth <= 640;
    if (this.flyover.active) {
      const g = this.world.layout.grid;
      chips.push(["ok", this.flyover.simple ? (this.flyover.cam.isPlan ? "Map" : "Simple 2.5D") : `Flyover${this.flyover.cam.isPlan ? " · plan view" : ""}`]);
      if (!narrow) chips.push(["info", `Grid ${g.size_mm} mm${g.snap ? " · snap" : ""}`]);
    } else if (!this.source) chips.push(["warn", "No image yet"]);
    else if (this.source.untracked) {
      // a photo of the photo tour without a digital layer: its chip says so (TourNav.hudChips)
    } else if (st.H && !st.holding) chips.push(["ok", `Tracking · ${st.used.length} marker${st.used.length === 1 ? "" : "s"}${this.world.map.locked ? " · locked" : ""}`]);
    else if (st.holding) chips.push(["warn", "Markers hidden · holding position"]);
    else if (st.visible.length) chips.push(["warn", `Markers ${st.visible.join(", ")} seen, ${this.world.map.locked ? "none in the locked marker map" : "none known yet"}`]);
    else chips.push(["bad", "No markers in view"]);
    // the clock's night (between sunset and sunrise), also while the day/night lighting is switched off
    const pace = [this.world.paused ? "Paused" : null, this.world.speed !== 1 ? `${this.world.speed}× time` : null].filter(Boolean);
    chips.push(["info clock", [`${this.world.clock.label()}${this.world.clock.night() > 0.5 ? " · night" : ""}`, ...(narrow ? pace : [])].join(" · ")]);
    if (!narrow) for (const t of pace) chips.push(["info", t]);
    // a quiet disruption without a message (a story's train holding its track) is none to speak of
    const disrupted = this.world.disruptions.active.filter((d) => !d.def.quiet || d.def.effects?.(d, null, this.world)?.messages?.length).length;
    if (disrupted) chips.push(["bad", `${disrupted} disruption${disrupted > 1 ? "s" : ""}`]);
    if (this.world.trains.active) chips.push(["ok", `Control system · ${this.world.trains.trains.size} trains`]);
    const term = ARail.terminalOf(this.world);
    if (term) {
      const n = term.moves.filter((m) => m.state === "queued" || m.state === "active").length;
      if (n || !narrow) chips.push(["info", `Terminal · ${n} move${n === 1 ? "" : "s"}`]);
    }
    const ops = ARail.opsOf(this.world)?.engine;
    if (ops) {
      const n = ops.tripsRunning().size, failed = [...ops.units.values()].filter((u) => u.status === "failed").length;
      chips.push([failed ? "warn" : "info", `Operations · ${n} train${n === 1 ? "" : "s"}${failed ? ` · ${failed} unit${failed === 1 ? "" : "s"} failed` : ""}`]);
    }
    for (const story of this.world.simulations.filter((x) => x instanceof ARail.Story && x.active)) {
      const st = story.state();
      if (st.count) chips.push(["info", `${story.name} · step ${st.index + 1} of ${st.count}${st.playing ? " · playing" : ""}`]);
    }
    const journeys = ARail.journeysOf(this.world);
    if (journeys?.travellers.length) {
      const all = journeys.travellers, done = all.filter((t) => t.state === "arrived").length, going = all.filter((t) => t.state !== "home" && t.state !== "arrived").length;
      chips.push(["info", `Journeys · ${going} travelling · ${done} of ${all.length} arrived`]);
    }
    if (this.frozen) chips.push(["info", "Frozen frame"]);
    if (this.tourNav && !this.flyover.active) chips.unshift(...this.tourNav.hudChips());
    if (this.recorder) chips.push(["bad", "Recording"]);
    this.tourNav?.sync();
    const hud = $("#hud");
    morph(hud, chips.map(([k, t]) => h("span", { class: `chip ${k}` }, t)));
    // the labels keep clear of the chips and of the buttons on the stage (a label pulled in at the top
    // edge of the picture, a depot's board out of view, goes below the chips; a stop board under a
    // button becomes a badge)
    const c = this.canvas.getBoundingClientRect(), s = this.canvas.width / Math.max(1, c.width);
    const controls = document.querySelectorAll("#tour:not([hidden]) .tour-views, #tour:not([hidden]) .tour-step, .stage-tools .btn, #flyNav:not([hidden]) .btn");
    this.hudRects = [...hud.children, ...controls].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0).map((r) => ({ x: (r.left - c.left) * s, y: (r.top - c.top) * s, w: r.width * s, h: r.height * s }));
  }

  /* ---------------------------------------------------------------- recording */

  toggleRecording() {
    // the View panel may be rendered anew while recording: always use the current button
    const setPressed = (on) => $("#btnRecord")?.setAttribute("aria-pressed", on ? "true" : "false");
    if (this.recorder) {
      this.recorder.stop();
      return;
    }
    if (!this.canvas.captureStream || !window.MediaRecorder) return toast("Recording is not supported by this browser.");
    const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(this.canvas.captureStream(30), type ? { mimeType: type, videoBitsPerSecond: 6e6 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      this.recorder = null;
      setPressed(false);
      const blob = new Blob(chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = h("a", { href: url, download: `arail-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.webm` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast("Recording saved.");
    };
    rec.start(1000);
    this.recorder = rec;
    setPressed(true);
    toast("Recording… press the button again to stop.");
  }
}

/** What is kept of the home of a module that is a layout of its own: its address, name and modules. */
function moduleHomeRecord(home, module) {
  const modules = home.layers.map(({ id, name, description, exclusive, layout, simulations }) => ({
    id, name, description, exclusive, layout: layout ?? null,
    // the types of the simulations the module adds (world.layers() has them already; a layout file's layers have the entries)
    simulations: (simulations || []).map((s) => (typeof s === "string" ? s : s.patch === true ? null : s.type)).filter(Boolean),
  }));
  return { url: home.url, name: home.name, module, modules };
}

