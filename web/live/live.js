// ARail Live: a page of its own for live AR on XR glasses and phones, reduced to the town and its
// road traffic, and a test of how fast that can be. It uses the framework's modules (tracking, the
// world, the View, the objects, the road traffic) but loads none of the rest (live/scene.js).
//
// Per frame of the screen:
// - a new camera frame is searched for markers, in a worker (detect-worker.js) while the main thread
//   draws, or on the main thread; one frame at a time, so the newest frame is searched next;
// - the pose of the markers found comes with the frame it was found in (the camera image shown is
//   that frame, unless "as it comes" is chosen);
// - the town is not drawn again: its picture (live/cache.js) is fitted to the pose by a CSS matrix3d,
//   which the browser's compositor applies; it is drawn again only when the fit is off by more than a
//   few pixels, the image leaves it, or after a while;
// - what moves (cars, bikes, people on foot) is drawn on a canvas of its own over the picture, and
//   the outlines of the buildings that may hide some of it are cut out of it in depth order
//   (live/scene.js `occluders`, `cutOut`).
// "Draw the town once" off draws everything in every frame, as the app does: the numbers in the
// corner compare the two.
import { Camera } from "../arail/core/camera.js";
import { MarkerDetector } from "../arail/core/detector.js";
import { poseFromHomography } from "../arail/core/geometry.js";
import { PlaneTracker } from "../arail/core/tracker.js";
import { View } from "../arail/core/view.js";
import { CityCache, citySamples, cssMatrix, planeHomographyOf } from "./cache.js";
import { createLiveWorld, cutOut, occluders, Visitor } from "./scene.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

/** The clip of the lab and its layout (Bf Neustadt, a locked marker map). */
const CLIP = { video: "../media/ebl-station-trains.mp4", layout: "../layouts/ebl-neustadt.json" };
/** Lowest and highest size (px, the longer side) of the frames searched for markers, as in the app. */
const PROC_RANGE = [480, 1280];
/** The longer side (px) of the image the stage works in; the demo's image. */
const IMAGE_MAX = 1280, DEMO_SIZE = [1280, 720];
/** js-aruco2's scripts for marker detection on the main thread (the worker loads its own). */
const VENDOR = ["cv.js", "aruco.js", "dictionaries/aruco_4x4_1000.js", "dictionaries/aruco_5x5_1000.js", "dictionaries/aruco_6x6_1000.js", "dictionaries/aruco_7x7_1000.js", "dictionaries/apriltag_36h11.js"];
/** What the device keeps: the fit to the glasses, the camera chosen. */
const FIT_KEY = "arail.live.fit", DEVICE_KEY = "arail.live.device";
const FIT_DEFAULT = { x: 0, y: 0, scale: 100, turn: 0 };

/** localStorage that never throws (private windows, blocked storage). */
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // not kept
    }
  },
};

/* ---------------------------------------------------------------- settings (in the address) */

/** The settings with their defaults; `?name=value` in the address sets them (a link to a test). */
const DEFAULTS = {
  source: "camera", layout: CLIP.layout, video: CLIP.video, bg: "camera", sync: "synced", cache: true, error: 2, margin: 20, res: 100,
  occlusion: true, cars: null, bikes: false, worker: true, speed: 1, time: "", hud: true,
};
const RANGES = { error: [0.5, 6], margin: [5, 50], res: [50, 200], cars: [0, 200], speed: [0, 10] };
const CHOICES = { source: ["camera", "clip", "demo"], bg: ["camera", "black"], sync: ["synced", "direct"] };

function readSettings() {
  const s = { ...DEFAULTS };
  for (const [key, def] of Object.entries(DEFAULTS)) {
    if (!params.has(key)) continue;
    const raw = params.get(key);
    if (typeof def === "boolean") s[key] = raw !== "0" && raw !== "false";
    else if (RANGES[key]) {
      const v = Number(raw);
      if (raw !== "" && Number.isFinite(v)) s[key] = Math.min(RANGES[key][1], Math.max(RANGES[key][0], v));
    } else if (CHOICES[key]) {
      if (CHOICES[key].includes(raw)) s[key] = raw;
    } else s[key] = raw;
  }
  if (params.get("demo") === "1") s.source = "demo";
  return s;
}

/** The settings that differ from the defaults, as the address of this page. */
function writeSettings(s) {
  const q = new URLSearchParams();
  for (const [key, def] of Object.entries(DEFAULTS)) {
    const v = s[key];
    if (v === def || v == null || v === "") continue;
    q.set(key, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  }
  const query = q.toString();
  history.replaceState(null, "", query ? `?${query}` : location.pathname);
}

/* ---------------------------------------------------------------- numbers */

/** Events per second, over the last second. */
class Rate {
  constructor() {
    this.times = [];
  }

  tick(t = performance.now()) {
    this.times.push(t);
  }

  get(t = performance.now()) {
    while (this.times.length && this.times[0] < t - 1000) this.times.shift();
    return this.times.length;
  }
}

/** A running mean of a duration (ms), the latest values counting most. */
class Mean {
  constructor() {
    this.value = 0;
    this.n = 0;
  }

  add(v) {
    this.value = this.n++ ? 0.92 * this.value + 0.08 * v : v;
  }
}

/** The latest durations (ms) of something that happens now and then, and their median. */
class Recent {
  constructor(n = 30) {
    this.n = n;
    this.values = [];
  }

  add(v) {
    this.values.push(v);
    if (this.values.length > this.n) this.values.shift();
  }

  get value() {
    const s = [...this.values].sort((a, b) => a - b);
    return s.length ? s[s.length >> 1] : 0;
  }
}

/** Load classic scripts one after the other (js-aruco2 for detection on the main thread). */
function loadScripts(urls) {
  return urls.reduce((p, url) => p.then(() => new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = url;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`${url} could not be loaded`));
    document.head.append(el);
  })), Promise.resolve());
}

/* ---------------------------------------------------------------- the page */

class Live {
  constructor() {
    this.settings = readSettings();
    this.fit = { ...FIT_DEFAULT, ...store.get(FIT_KEY, {}) };
    this.stage = $("stage");
    this.video = $("video");
    this.canvas = { background: $("layer-background"), city: $("layer-city"), cars: $("layer-cars") };
    this.ctx = { background: this.canvas.background.getContext("2d"), city: this.canvas.city.getContext("2d"), cars: this.canvas.cars.getContext("2d") };
    /** The frame searched for markers, scaled down; and the same frame kept to be shown with its pose. */
    this.proc = document.createElement("canvas");
    this.pctx = this.proc.getContext("2d", { willReadFrequently: true });
    this.held = document.createElement("canvas");
    this.hctx = this.held.getContext("2d");
    this.camera = new Camera(...DEMO_SIZE);
    this.cache = new CityCache({ maxError: this.settings.error, margin: this.settings.margin / 100 });
    this.world = null;
    this.tracker = null;
    this.visitor = null;
    /** {kind: "camera" | "clip" | "demo", w, h (image px), nw, nh (of the video), el?} */
    this.source = null;
    /** The pose shown: {H, K, pose}, or null (no markers). */
    this.pose = null;
    /** Marker detection: a worker, or a detector on the main thread; busy while a frame is searched. */
    this.worker = null;
    this.detector = null;
    this.busy = false;
    this.newFrame = false;
    this.procMax = 960;
    /** Markers of a searched frame, applied in the next animation frame. */
    this.result = null;
    this.markers = { found: 0, used: 0, holding: false };
    /** CSS px per image px of the stage. */
    this.k = 1;
    this.clock = 0;
    this.last = null;
    this.stats = {
      count: 0, frames: new Rate(), frame: new Mean(), main: new Mean(), step: new Mean(), cars: new Mean(), detect: new Mean(), latency: new Mean(),
      detections: new Rate(), redraws: new Rate(), redraw: new Recent(), error: 0, reason: "", occluders: 0, why: {},
    };
    this.loop = this.loop.bind(this);
  }

  async init() {
    this._wireSettings();
    this._wireKeys();
    addEventListener("resize", () => this.layoutStage());
    document.addEventListener("fullscreenchange", () => this.layoutStage());
    this.applyFit();
    this.showHud(this.settings.hud);
    if (location.hash === "#settings") this.toggleSettings(true);
    const s = this.settings;
    await this.loadLayout(s.source === "clip" && s.video === CLIP.video ? CLIP.layout : s.layout);
    await this.setSource(this.settings.source);
    requestAnimationFrame(this.loop);
    window.__live = this; // for debugging and the browser tests
  }

  /* -------------------------------------------------------------- layout and world */

  async loadLayout(url) {
    try {
      const res = await fetch(new URL(url, location.href));
      if (!res.ok) throw new Error(`${res.status}`);
      this.json = await res.json();
    } catch (err) {
      this.message(`The layout ${url} could not be loaded (${err.message}).`);
      this.json = this.json || {};
    }
    this.buildWorld();
  }

  /** The world from the layout, with the settings of the traffic; tracking starts again. */
  buildWorld() {
    const s = this.settings;
    this.world = createLiveWorld(this.json, { simulations: s.bikes ? ["traffic", "cycling"] : ["traffic"], cars: s.cars });
    this.world.speed = s.speed;
    if (s.time) this.world.setTime(s.time);
    this.tracker = new PlaneTracker(this.world.map);
    this.visitor = new Visitor(this.world);
    this.cache.samples = citySamples(this.world);
    this.cache.reset();
    this.pose = null;
    if (s.cars == null) $("cars").value = $("carsOut").value = this.trafficCars();
    this.startDetection();
  }

  /** Version of the town: a change of its objects or the marker map asks for a new picture. */
  version() {
    const w = this.world;
    return `${w.objectsVersion}:${w.map.version}:${w.scale}`;
  }

  /* -------------------------------------------------------------- sources */

  async setSource(kind) {
    this.stopSource();
    this.settings.source = kind;
    const token = (this._sourceToken = (this._sourceToken || 0) + 1);
    if (kind === "demo") {
      this._useImage(...DEMO_SIZE, { kind });
      this.demoStart = this.clock;
      this.message("Demo without a camera: a visitor in front of the town looks around and steps aside now and then.", 6000);
      return;
    }
    const v = this.video;
    v.muted = true;
    v.playsInline = true;
    // the handlers first: a camera's stream may have its metadata before the next line runs
    v.onloadedmetadata = () => {
      if (token !== this._sourceToken) return;
      this._useImage(v.videoWidth, v.videoHeight, { kind, el: v });
      v.play().catch(() => this.message("The video cannot be played here."));
      this._watchFrames(token);
    };
    v.onerror = () => token === this._sourceToken && this.message("The video cannot be played here.");
    if (kind === "clip") {
      // the lab's clip with its layout; a clip of one's own (?video=) with the layout chosen
      if (this.settings.video === CLIP.video && this.settings.layout !== CLIP.layout) {
        this.settings.layout = CLIP.layout;
        $("layout").value = CLIP.layout;
        await this.loadLayout(CLIP.layout);
        if (token !== this._sourceToken) return;
      }
      v.loop = true;
      v.src = new URL(this.settings.video, location.href).href;
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      this.message("The camera needs https (or localhost). Showing the demo instead.");
      return this.setSource("demo");
    }
    try {
      const device = store.get(DEVICE_KEY, null);
      const video = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } };
      const stream = await navigator.mediaDevices.getUserMedia({ video: { ...video, ...(device ? { deviceId: { exact: device } } : { facingMode: "environment" }) }, audio: false })
        .catch((err) => (device ? navigator.mediaDevices.getUserMedia({ video: { ...video, facingMode: "environment" }, audio: false }) : Promise.reject(err)));
      if (token !== this._sourceToken) return stream.getTracks().forEach((t) => t.stop());
      v.loop = false;
      v.srcObject = stream;
      this.listDevices(stream);
      this._wakeLock = await navigator.wakeLock?.request("screen").catch(() => null);
    } catch (err) {
      if (token !== this._sourceToken) return;
      this.message(`No access to the camera (${err.message}). Showing the demo instead.`);
      return this.setSource("demo");
    }
  }

  /** The image of a source: its size (at most IMAGE_MAX px), the camera, the canvases, the stage. */
  _useImage(nw, nh, source) {
    const s = Math.min(1, IMAGE_MAX / Math.max(nw, nh));
    const w = Math.round(nw * s), h = Math.round(nh * s);
    this.source = { ...source, nw, nh, w, h };
    this.camera.setSize(w, h);
    this.tracker.reset();
    this.pose = null;
    this.cache.reset();
    for (const c of [this.canvas.background, this.held]) {
      c.width = w;
      c.height = h;
    }
    this.sizeCars();
    this.layoutStage();
    this.applyBackground();
    $("source").value = source.kind;
    $("deviceRow").hidden = source.kind !== "camera" || $("device").options.length < 2;
    if (source.kind !== "demo") this.message("Looking for markers…");
  }

  /** New frames of the video (requestVideoFrameCallback where there is one, else every frame of the screen). */
  _watchFrames(token) {
    const v = this.video;
    if (typeof v.requestVideoFrameCallback !== "function") return;
    const next = () => v.requestVideoFrameCallback(() => {
      if (token !== this._sourceToken) return;
      this.newFrame = true;
      next();
    });
    next();
  }

  stopSource() {
    this._sourceToken = (this._sourceToken || 0) + 1;
    const v = this.video;
    v.onloadedmetadata = v.onerror = null;
    v.srcObject?.getTracks?.().forEach((t) => t.stop());
    v.pause();
    v.srcObject = null;
    v.removeAttribute("src");
    v.load();
    this._wakeLock?.release?.().catch(() => {});
    this._wakeLock = null;
    this.busy = false;
    this.result = null;
    this.frameId = (this.frameId || 0) + 1;
  }

  /** The cameras of the device (after the permission: with their names), to choose the glasses' own. */
  async listDevices(stream) {
    const sel = $("device");
    const devices = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === "videoinput");
    const current = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
    sel.replaceChildren(...devices.map((d, i) => {
      const o = document.createElement("option");
      o.value = d.deviceId;
      o.textContent = d.label || `Camera ${i + 1}`;
      o.selected = d.deviceId === current;
      return o;
    }));
    $("deviceRow").hidden = devices.length < 2;
  }

  /* -------------------------------------------------------------- marker detection */

  /** The detector for the layout's markers: in a worker if chosen (and it starts), else on the main thread. */
  startDetection() {
    this.stopDetection();
    const m = this.world.layout.markers;
    const options = { dictionary: m.dictionary || "ARUCO", codes: this.world.map.detectionCodes(m.codes) };
    const generation = (this._detectGeneration = (this._detectGeneration || 0) + 1);
    const onMain = async () => {
      if (generation !== this._detectGeneration || this.detector) return;
      this.worker?.terminate();
      this.worker = null;
      try {
        if (!globalThis.AR) await loadScripts(VENDOR.map((f) => `../vendor/js-aruco2/${f}`));
        if (generation !== this._detectGeneration) return;
        this.detector = new MarkerDetector({ dictionary: options.dictionary === "auto" ? null : options.dictionary, codes: options.codes });
        this.detectorWhere = "main thread";
      } catch (err) {
        this.message(`Marker detection could not be loaded (${err.message}).`);
      }
    };
    if (!this.settings.worker || typeof Worker !== "function") return onMain();
    let worker;
    try {
      worker = new Worker(new URL("detect-worker.js", import.meta.url), { type: "module" });
    } catch {
      return onMain();
    }
    const fallback = setTimeout(onMain, 8000); // a worker that never answers
    worker.onmessage = ({ data: msg }) => {
      if (generation !== this._detectGeneration) return;
      if (msg.type === "ready") {
        clearTimeout(fallback);
        this.worker = worker;
        this.detectorWhere = "worker";
      } else if (msg.type === "markers") {
        if (msg.id !== this.frameId) return; // a frame of a source before
        this.busy = false;
        this.result = { markers: msg.markers, ms: msg.ms, late: performance.now() - this.capturedAt };
      } else if (msg.type === "error") {
        if (msg.id === this.frameId) this.busy = false;
        if (!this.worker) {
          clearTimeout(fallback);
          onMain();
        }
      }
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      clearTimeout(fallback);
      if (generation === this._detectGeneration) onMain();
    };
    this._pendingWorker = worker;
    worker.postMessage({ type: "init", ...options });
  }

  stopDetection() {
    this._detectGeneration = (this._detectGeneration || 0) + 1;
    this.worker?.terminate();
    this._pendingWorker?.terminate();
    this.worker = this._pendingWorker = this.detector = null;
    this.busy = false;
    this.result = null;
  }

  /** Search the newest frame: scaled down for the detector, and kept at full size to be shown with its pose. */
  capture() {
    const { el, nw, nh, w, h } = this.source;
    if (!el || el.readyState < 2 || !(this.worker || this.detector)) return;
    this.newFrame = false;
    const s = Math.min(1, this.procMax / Math.max(nw, nh));
    const pw = Math.round(nw * s), ph = Math.round(nh * s);
    if (this.proc.width !== pw || this.proc.height !== ph) {
      this.proc.width = pw;
      this.proc.height = ph;
    }
    this.pctx.drawImage(el, 0, 0, pw, ph);
    const image = this.pctx.getImageData(0, 0, pw, ph);
    if (this.showsHeldFrame()) this.hctx.drawImage(el, 0, 0, w, h);
    this.capturedAt = performance.now();
    const id = (this.frameId = (this.frameId || 0) + 1);
    if (this.worker) {
      this.busy = true;
      this.worker.postMessage({ type: "frame", id, width: pw, height: ph, scale: w / pw, buffer: image.data.buffer }, [image.data.buffer]);
    } else {
      const t0 = performance.now();
      const markers = this.detector.detect(image, w / pw), ms = performance.now() - t0;
      this.result = { markers, ms, late: ms };
    }
  }

  /** The markers of the frame searched: the pose, and that frame as the camera image. */
  applyResult() {
    const { markers, ms, late } = this.result;
    this.result = null;
    const st = this.stats;
    st.detect.add(ms);
    st.latency.add(late);
    st.detections.tick();
    const [lo, hi] = PROC_RANGE;
    this.procMax = ms > 45 ? Math.max(lo, this.procMax * 0.9) : ms < 20 ? Math.min(hi, this.procMax * 1.05) : this.procMax;
    const tracked = this.tracker.update(markers, this.clock, this.camera);
    this.markers = { found: Object.keys(markers).length, used: tracked.used.length, holding: tracked.holding };
    if (this.showsHeldFrame()) this.ctx.background.drawImage(this.held, 0, 0);
    const had = !!this.pose;
    this.setPose(tracked.H ? { H: tracked.H, K: this.camera.intrinsics } : null);
    if (!had && this.pose) this.message("");
    else if (had && !this.pose) this.message("No markers in view.");
  }

  setPose(p) {
    this.pose = p ? { ...p, pose: p.pose || poseFromHomography(p.H, p.K) } : null;
  }

  /** The demo's pose: the visitor's head at this moment. */
  demoPose() {
    const { w, h } = this.source;
    const { H, pose, focal } = this.visitor.at(this.clock - this.demoStart).homography(w, h);
    this.setPose({ H, pose, K: { fx: focal, fy: focal, cx: w / 2, cy: h / 2 } });
  }

  /* -------------------------------------------------------------- frame loop */

  loop(t) {
    requestAnimationFrame(this.loop);
    const dt = this.last == null ? 0 : Math.min(0.1, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    this.clock = t / 1000;
    const st = this.stats;
    st.frames.tick(t);
    st.count++;
    if (dt > 0) st.frame.add(dt * 1000);
    const t0 = performance.now();
    try {
      const src = this.source;
      // the markers of the frame searched first (it is shown with them), then the next frame
      if (this.result) this.applyResult();
      if (src?.el && !this.busy && (this.newFrame || typeof this.video.requestVideoFrameCallback !== "function")) this.capture();
      if (src?.kind === "demo") this.demoPose();
      const t1 = performance.now();
      this.world.step(dt);
      st.step.add(performance.now() - t1);
      this.drawCity();
      const t2 = performance.now();
      this.drawCars();
      st.cars.add(performance.now() - t2);
    } catch (err) {
      if (!this._failing) console.error("Frame failed:", err);
      this._failing = true;
    }
    st.main.add(performance.now() - t0);
    if (!(t - (this._hudAt ?? -1e9) < 250)) {
      this._hudAt = t;
      this.updateHud();
    }
  }

  /** The intrinsics of a canvas at `res` canvas px per image px whose origin is (mx, my) image px left of and above the image's. */
  static scaled(K, res, mx = 0, my = 0) {
    return { fx: K.fx * res, fy: K.fy * res, cx: (K.cx + mx) * res, cy: (K.cy + my) * res };
  }

  /** A View on a canvas of width × height px with the intrinsics K (a pinhole camera) and the pose. */
  makeView(ctx, width, height, K, pose, res) {
    const camera = new Camera(width, height);
    camera.setCalibration({ image_size: [width, height], camera_matrix: [[K.fx, 0, K.cx], [0, K.fy, K.cy], [0, 0, 1]] });
    return new View({
      ctx, camera, H: planeHomographyOf(pose, K), scale: this.world.scale, px: Math.max(1, res / this.k), time: this.world.time, pose,
      // the demo has no camera image: the table and what is real on it are drawn too
      virtual: this.source?.kind === "demo",
    });
  }

  /** The town: its picture fitted to the pose, drawn again when the fit does not do. */
  drawCity() {
    const p = this.pose, on = this.settings.cache && !!p;
    this.canvas.city.hidden = !on;
    if (!on) return;
    const { w, h } = this.source, version = this.version();
    let fit = this.cache.fit(p.pose, p.K, w, h, this.clock, version);
    if (fit.redraw) {
      const t0 = performance.now();
      this.renderCity(p, version);
      const st = this.stats;
      st.redraw.add(performance.now() - t0);
      st.redraws.tick();
      st.reason = fit.redraw;
      st.why[fit.redraw] = (st.why[fit.redraw] || 0) + 1;
      fit = this.cache.fit(p.pose, p.K, w, h, this.clock, version);
    }
    this.stats.error = fit.error;
    if (fit.M) this.canvas.city.style.transform = cssMatrix(fit.M, this.k);
  }

  renderCity(p, version) {
    const { w, h } = this.source, res = this.settings.res / 100;
    const size = this.cache.picture(w, h, res);
    const c = this.canvas.city;
    if (c.width !== size.width || c.height !== size.height) {
      c.width = size.width;
      c.height = size.height;
      c.style.width = `${size.width}px`;
      c.style.height = `${size.height}px`;
    }
    const ctx = this.ctx.city;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    const view = this.makeView(ctx, size.width, size.height, Live.scaled(p.K, res, size.mx, size.my), p.pose, res);
    this.world.draw(view, { moving: false });
    this.cache.drawn({ pose: p.pose, K: p.K, width: w, height: h, size, time: this.clock, version });
  }

  /** The canvas of what moves: the image's size at the resolution chosen. */
  sizeCars() {
    if (!this.source) return;
    const res = this.settings.res / 100, c = this.canvas.cars;
    const cw = Math.round(this.source.w * res), ch = Math.round(this.source.h * res);
    if (c.width !== cw || c.height !== ch) {
      c.width = cw;
      c.height = ch;
    }
  }

  /** What moves, with the outlines of the buildings that may hide it cut out; without the town's picture: everything. */
  drawCars() {
    const ctx = this.ctx.cars, c = this.canvas.cars, p = this.pose;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (!p) return;
    const res = c.width / this.source.w;
    const view = this.makeView(ctx, c.width, c.height, Live.scaled(p.K, res), p.pose, res);
    if (!this.settings.cache) return this.world.draw(view);
    const hiding = this.settings.occlusion ? occluders(this.world, view) : [];
    this.stats.occluders = hiding.length;
    cutOut(view, hiding);
    this.world.draw(view, { objects: [] });
  }

  /* -------------------------------------------------------------- stage */

  /** The stage: the image's shape, as large as the screen allows, in the middle. */
  layoutStage() {
    if (!this.source) return;
    const { w, h } = this.source;
    const W = innerWidth, H = innerHeight, k = Math.min(W / w, H / h);
    this.k = k;
    Object.assign(this.stage.style, { width: `${w * k}px`, height: `${h * k}px`, left: `${(W - w * k) / 2}px`, top: `${(H - h * k) / 2}px` });
  }

  /** Camera image or black; the camera image as the frames searched, or as the video comes. */
  applyBackground() {
    const s = this.settings, camera = s.bg === "camera" && !!this.source?.el;
    this.stage.classList.toggle("black", !camera);
    this.video.hidden = !(camera && s.sync === "direct");
    this.canvas.background.hidden = !this.showsHeldFrame();
    if (this.source?.kind === "demo") this.stage.classList.add("black");
  }

  showsHeldFrame() {
    return this.settings.bg === "camera" && this.settings.sync === "synced" && !!this.source?.el;
  }

  /** The fit to the glasses: shift, size and turn of the whole view, kept on the device. */
  applyFit() {
    const f = this.fit;
    $("view").style.transform = `translate(${f.x}px, ${f.y}px) rotate(${f.turn}deg) scale(${f.scale / 100})`;
    for (const [id, key] of [["fitX", "x"], ["fitY", "y"], ["fitScale", "scale"], ["fitTurn", "turn"]]) {
      $(id).value = f[key];
      $(`${id}Out`).value = f[key];
    }
    store.set(FIT_KEY, f);
  }

  message(text, ms = 0) {
    const el = $("message");
    el.textContent = text;
    clearTimeout(this._messageTimer);
    if (ms) this._messageTimer = setTimeout(() => el.textContent === text && (el.textContent = ""), ms);
  }

  showHud(on) {
    this.settings.hud = on;
    $("hud").hidden = !on;
  }

  /** The numbers in the corner. */
  updateHud() {
    if ($("hud").hidden) return;
    const st = this.stats, s = this.settings, now = performance.now(), r = (x, d = 1) => x.toFixed(d);
    const traffic = this.world.simulations.find((x) => x.constructor.type === "traffic");
    const rows = [["Display", `${st.frames.get(now)} fps · ${r(st.main.value)} ms busy`]];
    if (this.source?.kind === "demo") rows.push(["Camera", "demo (no markers)"]);
    else {
      rows.push(["Markers", `${st.detections.get(now)} Hz · ${r(st.detect.value)} ms · ${Math.round(this.procMax)} px · ${this.detectorWhere || "loading"}`]);
      rows.push(["", this.pose ? `${this.markers.found} found · ${this.markers.used} used${this.markers.holding ? " · holding" : ""} · ${r(st.latency.value)} ms late` : "no pose"]);
    }
    if (s.cache) {
      rows.push(["Town", `${st.redraws.get(now)} drawn/s · ${r(st.redraw.value)} ms · fit ${r(st.error, 2)} px`]);
      rows.push(["", Object.entries(st.why).map(([k, n]) => `${k} ${n}`).join(" · ") || "-"]);
    } else rows.push(["Town", "drawn in every frame"]);
    rows.push(["Cars", `${traffic?.cars.length ?? 0} driving · ${traffic?.parkedCars.length ?? 0} parked · ${r(st.cars.value)} ms${s.cache && s.occlusion ? ` · ${st.occluders} in front` : ""}`]);
    rows.push(["Simulation", `${r(st.step.value, 2)} ms`]);
    $("stats").replaceChildren(...rows.flatMap(([k, v]) => {
      const dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = k;
      dd.textContent = v;
      return [dt, dd];
    }));
  }

  /* -------------------------------------------------------------- settings and keys */

  setSetting(key, value) {
    const s = this.settings;
    s[key] = value;
    writeSettings(s);
    if (key === "cache") $("cache").checked = value;
    if (key === "error") this.cache.options.maxError = value;
    if (key === "margin") {
      this.cache.options.margin = value / 100;
      this.cache.reset();
    }
    if (key === "res") {
      this.cache.reset();
      this.sizeCars();
    }
    if (key === "bg" || key === "sync") {
      $("background-mode").value = s.bg;
      this.applyBackground();
    }
    if (key === "cars") {
      const traffic = this.world.simulations.find((x) => x.constructor.type === "traffic");
      if (traffic) traffic.config.cars_per_km = value;
    }
    if (key === "bikes") this.buildWorld();
    if (key === "worker") this.startDetection();
  }

  _wireSettings() {
    const s = this.settings;
    $("btnSettings").addEventListener("click", () => this.toggleSettings());
    $("btnFullscreen").addEventListener("click", () => this.toggleFullscreen());
    $("settings").addEventListener("submit", (e) => e.preventDefault());
    $("source").value = s.source;
    $("source").addEventListener("change", (e) => {
      writeSettings(Object.assign(s, { source: e.target.value }));
      this.setSource(e.target.value);
    });
    $("device").addEventListener("change", (e) => {
      store.set(DEVICE_KEY, e.target.value);
      this.setSource("camera");
    });
    $("layout").value = s.layout;
    if ($("layout").value !== s.layout) $("layout").append(Object.assign(document.createElement("option"), { value: s.layout, textContent: s.layout, selected: true }));
    $("layout").addEventListener("change", async (e) => {
      s.layout = e.target.value;
      writeSettings(s);
      await this.loadLayout(s.layout);
      if (s.source === "clip" && s.video === CLIP.video && s.layout !== CLIP.layout) this.setSource("camera");
      else if (this.source) this._useImage(this.source.nw, this.source.nh, { kind: this.source.kind, el: this.source.el });
    });
    $("background-mode").value = s.bg;
    $("background-mode").addEventListener("change", (e) => this.setSetting("bg", e.target.value));
    $("sync").value = s.sync;
    $("sync").addEventListener("change", (e) => this.setSetting("sync", e.target.value));
    for (const key of ["cache", "occlusion", "bikes", "worker"]) {
      $(key).checked = s[key];
      $(key).addEventListener("change", (e) => this.setSetting(key, e.target.checked));
    }
    const ranges = { error: s.error, margin: s.margin, res: s.res, cars: s.cars ?? this.trafficCars() };
    for (const [key, value] of Object.entries(ranges)) {
      $(key).value = value;
      $(`${key}Out`).value = value;
      $(key).addEventListener("input", (e) => {
        $(`${key}Out`).value = e.target.value;
        this.setSetting(key, Number(e.target.value));
      });
    }
    for (const [id, key] of [["fitX", "x"], ["fitY", "y"], ["fitScale", "scale"], ["fitTurn", "turn"]]) {
      $(id).addEventListener("input", (e) => {
        this.fit[key] = Number(e.target.value);
        this.applyFit();
      });
    }
    $("fitReset").addEventListener("click", () => {
      this.fit = { ...FIT_DEFAULT };
      this.applyFit();
    });
  }

  /** Cars per km of the layout's own traffic (before a world is built: the default). */
  trafficCars() {
    const own = (this.json?.simulations || []).find((x) => x?.type === "traffic");
    return own?.cars_per_km ?? 20;
  }

  toggleSettings(open = $("settings").hidden) {
    // closed with the focus in it: back to the button (keys would go to a hidden control)
    if (!open && $("settings").contains(document.activeElement)) $("btnSettings").focus();
    $("settings").hidden = !open;
    $("btnSettings").setAttribute("aria-expanded", String(open));
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => this.message("Full screen is not possible here.", 3000));
  }

  _wireKeys() {
    addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape" && !$("settings").hidden) return this.toggleSettings(false);
      if (e.target.closest?.("input, select, textarea")) return;
      const f = this.fit, step = e.shiftKey ? 10 : 2;
      const keys = {
        s: () => this.toggleSettings(),
        h: () => this.showHud($("hud").hidden),
        f: () => this.toggleFullscreen(),
        c: () => this.setSetting("cache", !this.settings.cache),
        b: () => this.setSetting("bg", this.settings.bg === "camera" ? "black" : "camera"),
        ArrowLeft: () => (f.x -= step),
        ArrowRight: () => (f.x += step),
        ArrowUp: () => (f.y -= step),
        ArrowDown: () => (f.y += step),
        "+": () => (f.scale += 1),
        "=": () => (f.scale += 1),
        "-": () => (f.scale -= 1),
        "[": () => (f.turn -= 0.25),
        "]": () => (f.turn += 0.25),
        0: () => Object.assign(f, FIT_DEFAULT),
      };
      const act = keys[e.key] ?? keys[e.key.toLowerCase()];
      if (!act) return;
      e.preventDefault();
      act();
      if (/^(Arrow|\+|=|-|\[|\]|0)/.test(e.key)) this.applyFit();
    });
  }
}

new Live().init();
