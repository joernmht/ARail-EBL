// ARail app: camera/photo/video in, markers tracked, virtual layout and simulations drawn on top.
import * as ARail from "../arail/index.js";
import { Editor } from "./editor.js";
import { drawGrid, Flyover } from "./flyover.js";
import { Panels } from "./panels.js";
import { $, h, morph, mount, storage, toast } from "./ui.js";

const params = new URLSearchParams(location.search);
const EXAMPLES = [
  { id: "lab", label: "Example: EBL lab photo", layout: "../layouts/ebl-lab.json" },
  { id: "synthetic", label: "Example: synthetic layout", layout: "../layouts/synthetic-demo.json" },
];
const TABS = ["view", "build", "simulate", "disrupt", "control"];

class App {
  constructor() {
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
    this.layoutUrl = null;
    this.recorder = null;
    this._loadToken = 0;
  }

  /* ---------------------------------------------------------------- start */

  async init() {
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
    this._wireUi();
    this._wireEvents();
    const layout = params.get("layout") || storage.get("arail.lastLayout") || EXAMPLES[0].layout;
    const image = params.get("image");
    await this.loadLayoutFromUrl(layout, { withImage: !image && params.get("camera") !== "1" });
    if (image) this.loadImage(new URL(image, location.href).href, "Image");
    else if (params.get("camera") === "1") this.startLive();
    if (params.get("mock") === "1") this.panels.startMock();
    else if (params.get("feed")) this.panels.connect();
    if (params.get("scenario")) setTimeout(() => this.world.scenarios.play(params.get("scenario")), 500);
    const tab = location.hash.slice(1);
    if (TABS.includes(tab)) this.selectTab(tab);
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
    for (const name of TABS) $(`#tab-${name}`).addEventListener("click", () => this.selectTab(name));
    $(".tabs").addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const i = TABS.indexOf(this.activeTab) + (e.key === "ArrowRight" ? 1 : -1);
      this.selectTab(TABS[(i + TABS.length) % TABS.length]);
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
    const sel = $("#exampleSelect");
    mount(sel, h("option", { value: "" }, "Layouts…"), EXAMPLES.map((x) => h("option", { value: x.layout }, x.label)));
    sel.addEventListener("change", async () => {
      if (!sel.value) return;
      const url = sel.value;
      sel.value = "";
      this.stopLive();
      await this.loadLayoutFromUrl(url, { withImage: true });
    });
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
    ev.on("disruption.started", (e) => toast(`${e.disruption.def.label} started${e.disruption.target !== "*" ? ` at ${this.world.getObject(e.disruption.target)?.name || e.disruption.target}` : ""}.`));
    ev.on("disruption.ended", (e) => toast(`${e.disruption.def.label} ended.`));
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
  }

  _key(e) {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea" || e.metaKey || e.ctrlKey || e.altKey) return;
    // Space and Enter activate focused buttons and links; they are not shortcuts there
    if ((e.key === " " || e.key === "Enter") && e.target.closest?.("button, a, summary, label, [role=button], [role=tab]")) return;
    if (this.flyover.key(e)) {
      e.preventDefault();
      return;
    }
    const w = this.world;
    if (e.key === "f" || e.key === "F") {
      this.flyover.toggle();
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
      else if (area && !w.services.call(area.id)) toast(`${area.owner.name}: no free ${area.kind === "bus" ? "bay" : "track"} right now.`);
    } else if (e.key === "Escape") {
      if (this.editor.placing) this.editor.cancel();
      else this.editor.select(null);
    } else if ((e.key === "Delete" || e.key === "Backspace") && this.activeTab === "build" && this.editor.selected) {
      this.editor.deleteSelected();
      e.preventDefault();
    } else if (e.key === "m" || e.key === "M") {
      this.display.markers = !this.display.markers;
      this.panels.renderView($("#panel-view"));
    }
  }

  selectTab(name) {
    this.activeTab = name;
    for (const t of TABS) {
      $(`#tab-${t}`).setAttribute("aria-selected", t === name ? "true" : "false");
      $(`#tab-${t}`).tabIndex = t === name ? 0 : -1;
      $(`#panel-${t}`).hidden = t !== name;
    }
    this.canvas.classList.toggle("editing", name === "build");
    if (name !== "build" && this.editor.placing) this.editor.cancel();
    this.renderPanel(name);
    history.replaceState(null, "", `${location.pathname}${location.search}#${name}`);
  }

  renderPanel(name) {
    const el = $(`#panel-${name}`);
    if (name === "view") this.panels.renderView(el);
    else if (name === "build") this.editor.render(el);
    else if (name === "simulate") this.panels.renderSimulate(el);
    else if (name === "disrupt") this.panels.renderDisruptions(el);
    else if (name === "control") this.panels.renderControl(el);
  }

  /** Periodic refresh of live figures in the visible panel. */
  refreshPanels() {
    this.updateHud();
    const t = this.activeTab;
    if (t === "view") this.panels.updateView();
    else if (t === "simulate") {
      this.panels.updateClock();
      this.panels.updateBoard();
    }
    else if (t === "disrupt") {
      this.panels.updateDisruptions();
      this.panels.updateScenarios();
    } else if (t === "control") this.panels.updateControl();
    else if (t === "build" && this._mapVersionShown !== this.world.map.ids().length) {
      this._mapVersionShown = this.world.map.ids().length;
      this.editor.renderMarkers();
    }
  }

  /* ---------------------------------------------------------------- layouts */

  async loadLayoutFromUrl(url, { withImage = !this.source || this.source.kind === "image" } = {}) {
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
    this.layoutUrl = new URL(url, location.href).href;
    this.originalLayout = json;
    storage.set("arail.lastLayout", url);
    const img = json.view?.image;
    // the layout's own image follows: the image shown until then belongs to the previous layout,
    // and markers detected in it must not be measured into this layout's marker map
    const options = { redetect: !(withImage && img) };
    const edited = storage.get(this._layoutKey());
    let restored = false;
    if (edited) {
      try {
        await this._applyLayout(edited, options);
        restored = true;
        toast("Your changes to this layout were restored. Use Build → Reset to original to discard them.");
      } catch (err) {
        console.warn("Saved changes could not be applied:", err);
      }
    }
    if (!restored) {
      try {
        await this._applyLayout(json, options);
      } catch (err) {
        toast(`The layout ${url} could not be loaded: ${err.message}`, 7000);
        await this._applyLayout({});
      }
    }
    if (withImage && img) this.loadImage(new URL(img, this.layoutUrl).href, json.name || "Example");
  }

  _layoutKey() {
    return `arail.layout:${this.layoutUrl}`;
  }

  /**
   * Load a layout into the world; on an error the previous layout stays loaded and the error is thrown.
   * @param {object} json
   * @param {{redetect?: boolean}} [options] redetect: look for markers in the current still image (false when the layout's own image follows)
   */
  async _applyLayout(json, { redetect = true } = {}) {
    if (json.plugins?.length) {
      const errors = await ARail.loadPlugins(json.plugins, this.layoutUrl || location.href);
      if (errors.length) toast(`Plugins could not be loaded: ${errors.join("; ")}`, 8000);
    }
    const problems = ARail.validateLayout(json, this.world.registry);
    const settings = { ...this.world.settings, ...storage.get("arail.settings", {}) };
    this.editor.reset();
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
      this.renderPanel(this.activeTab);
      if (redetect) this.redetect();
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
    await this._applyLayout(this.originalLayout || {});
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
    const { labels, trails, showTracks, feedVehicles, lighting, peopleColour } = this.world.settings;
    storage.set("arail.settings", { labels, trails, showTracks, feedVehicles, lighting, peopleColour });
  }

  showLayoutName() {
    $("#layoutName").textContent = this.world.layout.name;
    document.title = `${this.world.layout.name} · ARail App`;
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
    const { dictionary: d } = this.world.layout.markers;
    const codes = this.world.map.detectionCodes(this.world.layout.markers.codes);
    const found = keepType && d === "auto" ? this.detector.selected?.name ?? null : null;
    if (this.detector.codes !== codes) {
      try {
        this.detector = new ARail.MarkerDetector({ dictionary: "ARUCO", codes });
      } catch (err) {
        toast(`Marker detection could not be set up for ${codes} codes: ${err.message}`);
      }
    }
    try {
      this.detector.setDictionary(d === "auto" ? found : d);
    } catch {
      toast(`Unknown marker type “${d}”; detecting automatically.`);
      this.detector.setDictionary(null);
    }
  }

  /* ---------------------------------------------------------------- sources */

  setSource(el, kind, nw, nh, name, objectUrl = null) {
    const old = this.source;
    if (old?.kind === "live" && kind !== "live") this.stopLive();
    const s = Math.min(1, (kind === "image" ? 1600 : 1280) / Math.max(nw, nh));
    this.source = { el, kind, nw, nh, w: Math.round(nw * s), h: Math.round(nh * s), name, objectUrl };
    if (old && old.el !== el) this._release(old);
    // in the flyover the canvas belongs to the virtual camera: the new source is shown when leaving it
    if (!this.flyover.active) {
      this.canvas.width = this.source.w;
      this.canvas.height = this.source.h;
    }
    this.camera.setSize(this.source.w, this.source.h);
    this.tracker.reset();
    this.detections = {};
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
   */
  loadImage(src, name, objectUrl = null) {
    const token = ++this._loadToken;
    const img = new Image();
    img.crossOrigin = "anonymous"; // images from other sites must allow it, or the canvas cannot be read
    img.onload = () => {
      if (token === this._loadToken) this.setSource(img, "image", img.naturalWidth, img.naturalHeight, name, objectUrl);
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
    el.textContent = text;
    el.hidden = false;
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

  /** Layout point (mm) under a pointer event, or null (layout not tracked; the sky of the flyover). */
  eventToLayout(e) {
    const c = this.canvas, r = c.getBoundingClientRect();
    const u = ((e.clientX - r.left) * c.width) / r.width, v = ((e.clientY - r.top) * c.height) / r.height;
    if (this.flyover.active) return this.flyover.groundPoint(u, v);
    const Hinv = this.tracker.state.Hinv;
    if (!Hinv) return null;
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
    if (!this.source || !this.detector) return;
    if (this.source.kind !== "image") return; // video frames are processed continuously
    const { el, nw, nh } = this.source;
    toast("Looking for markers…", 1500);
    setTimeout(() => {
      if (this.source?.el !== el) return;
      const s = Math.min(1, 2000 / Math.max(nw, nh));
      const pw = Math.round(nw * s), ph = Math.round(nh * s);
      this.proc.width = pw;
      this.proc.height = ph;
      this.pctx.drawImage(el, 0, 0, pw, ph);
      try {
        this.detections = this.detector.detect(this.pctx.getImageData(0, 0, pw, ph), this.source.w / pw);
      } catch (err) {
        toast(`The image cannot be analysed: ${err.message}`, 7000);
        return;
      }
      const st = this.tracker.update(this.detections, this.clock, this.camera, { still: true });
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
      this.detections = this.detector.detect(this.pctx.getImageData(0, 0, pw, ph), this.source.w / pw);
    } catch (err) {
      if (!this._detectError) toast(`The video cannot be analysed: ${err.message}`, 7000);
      this._detectError = true;
      return;
    }
    const ms = performance.now() - t0;
    this.procMax = ms > 45 ? Math.max(480, this.procMax * 0.9) : ms < 20 ? Math.min(1600, this.procMax * 1.05) : this.procMax;
    this.tracker.update(this.detections, this.clock, this.camera);
  }

  /* ---------------------------------------------------------------- frame loop */

  frame(dt) {
    this.clock += dt;
    if (dt > 0) this.fps = 0.9 * this.fps + 0.1 / Math.max(dt, 1e-3);
    const fly = this.flyover.active;
    if (!fly && this.source && this.source.kind !== "image" && !this.frozen) this._processVideo();
    if (this.feed?.tick) this.feed.tick(dt);
    this.world.step(dt);
    if (fly) this.flyover.step(dt);
    this.render();
  }

  render() {
    if (this.flyover.active) return this.flyover.render();
    const { ctx, source } = this;
    if (!source) return;
    ctx.drawImage(this.frozenFrame || source.el, 0, 0, source.w, source.h);
    const { H } = this.pose();
    if (H) {
      const labelScale = Math.min(1, Math.max(0.72, this.canvas.clientWidth / 1000));
      const view = new ARail.View({ ctx, camera: this.camera, H, scale: this.world.scale, px: this.px(), opacity: this.display.opacity, time: this.world.time, labelScale });
      if (this.display.gridInCamera) drawGrid(view, this._cameraGridBounds(), this.world.layout.grid.size_mm, { onImage: true });
      this.world.draw(view, { selected: this.activeTab === "build" ? this.editor.selected : null });
      this.editor.drawOverlay(ctx, view);
    }
    if (this.display.markers) this._drawMarkers(ctx);
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
  }

  updateHud() {
    const st = this.tracker.state, chips = [];
    if (this.flyover.active) {
      const g = this.world.layout.grid;
      chips.push(["ok", `Flyover${this.flyover.cam.isPlan ? " · plan view" : ""}`]);
      chips.push(["info", `Grid ${g.size_mm} mm${g.snap ? " · snap" : ""}`]);
    } else if (!this.source) chips.push(["warn", "No image yet"]);
    else if (st.H && !st.holding) chips.push(["ok", `Tracking · ${st.used.length} marker${st.used.length === 1 ? "" : "s"}${this.world.map.locked ? " · locked" : ""}`]);
    else if (st.holding) chips.push(["warn", "Markers hidden · holding position"]);
    else if (st.visible.length) chips.push(["warn", `Markers ${st.visible.join(", ")} seen, ${this.world.map.locked ? "none in the locked marker map" : "none known yet"}`]);
    else chips.push(["bad", "No markers in view"]);
    chips.push(["info clock", `${this.world.clock.label()}${this.world.night() > 0.5 ? " · night" : ""}`]);
    if (this.world.paused) chips.push(["info", "Paused"]);
    if (this.world.speed !== 1) chips.push(["info", `${this.world.speed}× time`]);
    if (this.world.disruptions.active.length) chips.push(["bad", `${this.world.disruptions.active.length} disruption${this.world.disruptions.active.length > 1 ? "s" : ""}`]);
    if (this.world.trains.active) chips.push(["ok", `Control system · ${this.world.trains.trains.size} trains`]);
    if (this.frozen) chips.push(["info", "Frozen frame"]);
    if (this.recorder) chips.push(["bad", "Recording"]);
    morph($("#hud"), chips.map(([k, t]) => h("span", { class: `chip ${k}` }, t)));
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

const app = new App();
app.init();
