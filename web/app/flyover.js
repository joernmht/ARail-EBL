// Flyover: look at and edit the layout with a virtual camera instead of the camera image.
// An orbit camera (arail/core/flycam.js) flies around the layout. The stage shows the lab (sky
// and floor), the table (table modules, or a default table around the markers and objects),
// the orthophoto of the table (layout `view.ortho`), a grid, the markers and everything virtual.
// Navigation: mouse, touch, keyboard and on-screen buttons. In Build the editor works as in the
// camera view, and placed or dragged things snap to the grid.
import {
  CD, CD_LIGHT, FONT, OVERLAY, PITCH_MAX, Camera, FlyCamera, SimpleView, View, applyH, defaultTableBounds, drawTable, gridLines, hasPhysicalTable, inv3, orthoOf, rgba, toRad,
} from "../arail/index.js";
import { $, storage, toast } from "./ui.js";

/** Widest canvas of the flyover (px); larger stages are scaled up by the browser. */
const MAX_WIDTH = 1920;
/** A pointer that moves less than this (CSS px) taps rather than drags. */
const TAP_PX = 6;
/** Duration of camera moves started by buttons and keys (ms). */
const MOVE_MS = 420;
/** Camera distance (mm) when it starts following something (a traveller): close enough to see a person. */
const FOLLOW_MM = 1100;
/** Orbit speed (radians per CSS px of pointer motion). */
const ORBIT_RAD_PER_PX = 0.0075;
/** Table drawn when a layout has nothing on it yet (mm). */
const EMPTY_TABLE = [-500, -300, 500, 300];

/** Background of the flyover by day: sky above the horizon, the lab floor below. */
export const SKY = { top: "#cfe4e6", horizon: "#eef5f5", floorFar: "#ccd3d6", floorNear: "#9ba5aa" };
/** ... and its night colours (the view darkens both further). */
const SKY_NIGHT = { top: "#020a24", horizon: "#16284f", floorFar: "#1b2438", floorNear: "#0b1122" };

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export class Flyover {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.cam = new FlyCamera();
    /** Pinhole camera of the canvas; its focal length follows the flyover camera. */
    this.camera = new Camera(1280, 720);
    /** Pointers on the canvas: id -> [x, y] canvas px. */
    this.pointers = new Map();
    this.gesture = null;
    this.anim = null;
    this.wheel = null;
    this.ortho = null;
    /** Followed by the camera: () => layout point or null (a traveller of the journeys), or null. */
    this.following = null;
    this._wire();
  }

  /* ---------------------------------------------------------------- mode */

  toggle() {
    if (this.active) this.leave();
    else this.enter();
  }

  /** Switch the stage to the virtual camera (video processing pauses, the source is kept). */
  enter() {
    if (this.active) return;
    const app = this.app, c = app.canvas;
    this.active = true;
    app.mode = "flyover";
    const src = app.source;
    this._resumeVideo = src?.kind === "video" && !app.frozen && !src.el.paused && !src.stale;
    if (this._resumeVideo) src.el.pause();
    c.classList.add("flyover");
    c.tabIndex = 0;
    c.setAttribute("aria-label", "Flyover of the layout with a virtual camera. Drag to turn, Shift-drag or right-drag to pan, scroll to zoom. Keys: arrows pan, plus and minus zoom, Q and E rotate, Page Up and Page Down tilt; in Build, while placing, Enter places a point in the middle. In Terminal, Enter picks the container or place in the middle; elsewhere Enter shows the info card of what is in the middle.");
    c.hidden = false;
    // a message on the empty stage (no image yet) comes back when the flyover is left
    this._emptyShown = !$("#emptyStage").hidden;
    $("#emptyStage").hidden = true;
    $("#flyNav").hidden = false;
    $("#btnFreeze").hidden = true;
    this.resize();
    this._restoreCamera();
    // switched on with the key F (nothing focused): the stage takes the keys; a focused button keeps the focus
    if (!document.activeElement || document.activeElement === document.body) {
      this._entering = true; // not a keyboard user's focus: no aim cross yet
      c.focus({ preventScroll: true });
      this._entering = false;
    }
    this._modeChanged();
  }

  /** Back to the camera view with the source that was shown before. */
  leave() {
    if (!this.active) return;
    const app = this.app, c = app.canvas;
    this.active = false;
    app.mode = "camera";
    this.gesture = null;
    this.pointers.clear();
    this.anim = null;
    this.wheel = null;
    this.following = null;
    this._keyAim = false;
    app.editor.cancelGesture();
    app.editor.hover(null);
    this._save(true);
    c.classList.remove("flyover", "dragging");
    c.removeAttribute("tabindex");
    c.setAttribute("aria-label", "Camera image with augmented reality");
    $("#flyNav").hidden = true;
    const src = app.source;
    if (src && !src.stale) {
      c.width = src.w;
      c.height = src.h;
      app.sizeCanvas();
      if (this._resumeVideo && src.kind === "video") src.el.play().catch(() => {});
    } else {
      // no image of this layout (a virtual layout, or none yet): the message of the empty stage
      app.ctx.clearRect(0, 0, c.width, c.height);
      if (!this._emptyShown) {
        $("#emptyStage").textContent = app.world.layout.view?.start === "flyover"
          ? "This layout is virtual: take a photo or start the camera to see it over the real layout."
          : "No image yet: take a photo, start the camera or open a file.";
        c.hidden = true;
      }
      $("#emptyStage").hidden = false;
    }
    this._resumeVideo = false;
    this._emptyShown = false;
    $("#btnFreeze").hidden = !src || src.kind === "image";
    app.fitCanvas();
    this._modeChanged();
  }

  /** Is the stage drawn in the simple view (flat layout, moving things as blocks)? */
  get simple() {
    return !!this.app.display.simple;
  }

  /**
   * Switch the simple view on or off. Switching it on opens the flyover; seen from straight above
   * (plan view) it is a map of the layout.
   * @param {boolean} on
   * @param {{plan?: boolean}} [options] plan: true looks straight down (map), false tilts the view (3D)
   */
  setSimple(on, { plan } = {}) {
    const app = this.app;
    app.display.simple = !!on;
    app.savePrefs();
    if (on && !this.active) this.enter();
    if (on && plan != null && plan !== this.planTarget()) this.command("plan");
    this._syncSimple();
    app.updateHud();
    app.panels.renderFlyover?.();
  }

  /** The Map and 2.5D buttons (`data-simple="map"` and `"3d"`): pressed for the view that is shown. */
  _syncSimple() {
    const on = this.simple && this.active, plan = this.planTarget();
    for (const b of document.querySelectorAll("[data-simple]")) {
      const pressed = on && (b.dataset.simple === "map" ? plan : !plan);
      b.setAttribute("aria-pressed", pressed ? "true" : "false");
    }
    this.app.canvas.classList.toggle("simple", on);
  }

  /** Does the camera look straight down, or will it when its move ends? */
  planTarget() {
    return this.anim ? this.anim.to.pitch > PITCH_MAX - toRad(0.5) : this.cam.isPlan;
  }

  /** A Map or 2.5D button: that simple view, or back to the full flyover when it is shown already. */
  simpleButton(which) {
    const pressed = this.simple && this.active && (which === "map") === this.planTarget();
    if (pressed) this.setSimple(false);
    else this.setSimple(true, { plan: which === "map" });
  }

  /** A video source loaded while in the flyover starts playing when the flyover is left. */
  resumeVideoOnLeave() {
    this._resumeVideo = true;
  }

  _modeChanged() {
    const app = this.app;
    $("#btnFlyover").setAttribute("aria-pressed", this.active ? "true" : "false");
    this._syncSimple();
    app.panels.renderFlyover?.();
    app.updateHud();
    if (app.activeTab === "build") app.editor.renderPlacing();
    else if (app.activeTab === "terminal") app.terminal.renderPlacing();
  }

  /** Canvas size: the whole stage, at the device's resolution (at most MAX_WIDTH wide). */
  resize() {
    const app = this.app, c = app.canvas, wrap = $("#stageWrap");
    const narrow = window.innerWidth < 1000;
    const cssW = Math.max(200, Math.floor(wrap.clientWidth));
    const cssH = document.fullscreenElement ? window.innerHeight
      : narrow ? Math.round(Math.min(window.innerHeight * 0.72, Math.max(260, cssW * 0.75)))
        : Math.max(200, Math.floor(wrap.clientHeight));
    const k = Math.min(window.devicePixelRatio || 1, MAX_WIDTH / cssW);
    const w = Math.max(2, Math.round(cssW * k)), h = Math.max(2, Math.round(cssH * k));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    c.style.width = `${cssW}px`;
    c.style.height = `${cssH}px`;
    this.camera.setSize(w, h);
    // the camera buttons wrap into two columns on short stages: the placing bar and messages keep clear of them
    wrap.style.setProperty("--fly-nav-w", `${$("#flyNav").offsetWidth}px`);
  }

  /** A layout was loaded: its own camera and orthophoto. */
  layoutChanged() {
    this.ortho = null;
    this.anim = null;
    if (this.active) {
      this._restoreCamera();
      this.app.updateHud();
    }
  }

  /* ---------------------------------------------------------------- camera */

  _key() {
    return `arail.flycam:${this.app.layoutUrl || "none"}`;
  }

  _restoreCamera() {
    const saved = storage.get(this._key());
    if (saved) this.cam = FlyCamera.fromJSON(saved);
    else {
      this.cam = new FlyCamera();
      this.cam.fit(this.sceneBounds(), this._aspect());
    }
  }

  /** Remember the camera of this layout (shortly after the last change, or now). */
  _save(now = false) {
    clearTimeout(this._saveTimer);
    const key = this._key(), json = this.cam.toJSON();
    if (now) storage.set(key, json);
    else this._saveTimer = setTimeout(() => storage.set(key, json), 400);
  }

  _aspect() {
    const c = this.app.canvas;
    return c.width / Math.max(1, c.height);
  }

  /** Homography, focal length and pose of the virtual camera for the current canvas. */
  pose() {
    const c = this.app.canvas;
    return this.cam.homography(c.width, c.height);
  }

  /** Layout point (z = 0) under canvas pixel (u, v), or null above the horizon. */
  groundPoint(u, v) {
    const c = this.app.canvas;
    return this.cam.groundPoint(u, v, c.width, c.height, 200 * this.cam.distance);
  }

  /** Everything on the layout: tables, objects, markers ([xmin, ymin, xmax, ymax] mm). */
  sceneBounds() {
    const w = this.app.world;
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    const add = (p) => {
      b[0] = Math.min(b[0], p[0]);
      b[1] = Math.min(b[1], p[1]);
      b[2] = Math.max(b[2], p[0]);
      b[3] = Math.max(b[3], p[1]);
    };
    const table = defaultTableBounds(w, 60);
    if (table) {
      add([table[0], table[1]]);
      add([table[2], table[3]]);
    }
    for (const o of w.objects) for (const p of (o.geometry && o.footprint()) || []) add(p);
    return b[2] >= b[0] ? b : EMPTY_TABLE;
  }

  /** The default table: around markers and objects, unless the layout has the outline of a real table. */
  _defaultTable() {
    const w = this.app.world;
    if (hasPhysicalTable(w)) return null;
    const b = defaultTableBounds(w) || EMPTY_TABLE;
    return [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
  }

  /** Footprints of all tables: the default table and the table modules. */
  _tables() {
    const out = [], def = this._defaultTable();
    if (def) out.push(def);
    for (const o of this.app.world.objects) if (o.type === "tabletop" && o.geometry) out.push(o.geometry.footprint);
    return out;
  }

  /** Animate the camera to the result of `op(camera)`; repeated calls add up. */
  move(op, ms = MOVE_MS) {
    const base = this.cam.clone();
    if (this.anim) base.set(this.anim.to);
    op(base);
    const to = base.state();
    if (reducedMotion() || ms <= 0) {
      this.anim = null;
      this.cam.set(to);
      this._save();
      return;
    }
    this.anim = { from: this.cam.state(), to, t0: performance.now(), ms };
  }

  /**
   * Keep a moving thing in the middle of the view: `where()` gives its layout point (null: the view
   * stays where it is). Moving the view by hand ends it.
   * @param {(() => number[] | null) | null} where
   */
  follow(where) {
    this.following = where;
    const p = where?.();
    if (p) this.move((k) => k.set({ target: p, distance: Math.min(k.distance, FOLLOW_MM) }));
  }

  /** On-screen buttons and keys. */
  command(name) {
    if (name === "fit") this.following = null;
    const c = this.app.canvas, W = c.width, H = c.height;
    const ops = {
      "zoom-in": (k) => k.zoomAt(1.6, null, null, W, H),
      "zoom-out": (k) => k.zoomAt(1 / 1.6, null, null, W, H),
      "rotate-left": (k) => k.orbit(toRad(45)),
      "rotate-right": (k) => k.orbit(toRad(-45)),
      plan: (k) => {
        // plan view, or back to the tilt before it
        if (k.isPlan) return k.set({ pitch: this._tilt || toRad(50) });
        this._tilt = k.pitch;
        return k.planView();
      },
      fit: (k) => k.fit(this.sceneBounds(), W / H),
    };
    if (ops[name]) this.move(ops[name]);
    if (name === "plan") this._syncSimple();
  }

  /** Keys while the stage (the canvas or its buttons) has the focus; returns true if the key was used. */
  key(e) {
    if (!this.active) return false;
    // elsewhere (also on the body, e.g. after a click on panel text) arrows and Page Up/Down scroll as usual
    const t = e.target, onStage = t === this.app.canvas || !!t.closest?.("#stageWrap");
    if (!onStage) return false;
    const c = this.app.canvas, W = c.width, H = c.height, s = e.shiftKey ? 3 : 1, d = 0.12 * Math.min(W, H) * s;
    const ed = this.app.editor, placing = this.app.activeTab === "build" && !!ed.placing;
    const terminal = this.app.activeTab === "terminal";
    // Terminal: Enter picks the container (or the place for it) at the cross in the middle
    if (e.key === "Enter" && terminal) {
      if (t !== c) return false;
      if (e.repeat) return true;
      this.app.terminal.keyAim = true;
      if (this.anim) this.cam.set(this.anim.to);
      this.anim = null;
      this.app.terminal.pickAt([W / 2, H / 2], { keyboard: true });
      return true;
    }
    // the info card of what is at the cross in the middle (outside Build and Terminal)
    if (e.key === "Enter" && !placing && this.app.activeTab !== "build" && t === c) {
      if (e.repeat) return true;
      if (this.anim) this.cam.set(this.anim.to);
      this.anim = null;
      this.app.inspector.inspectCentre();
      return true;
    }
    // placing with the keyboard: the keys move the view under the cross in the middle, Enter places a point there
    if (e.key === "Enter") {
      if (!placing || t !== c) return false;
      if (e.repeat) return true; // a held Enter places one point, not one per key repeat
      this._keyAim = true;
      if (this.anim) this.cam.set(this.anim.to); // where the last key move was going
      this.anim = null;
      const p = this.aimPoint();
      if (p) ed.placeAt(p, e);
      else toast("The middle of the view is not on the layout: tilt the view down (Page Down).");
      return true;
    }
    // zoom steps ignore Shift: on many keyboards "+" (or "_") needs it, and in and out must stay symmetric
    const ZOOM = 1.25;
    const ops = {
      ArrowLeft: (k) => k.pan(d, 0, W, H),
      ArrowRight: (k) => k.pan(-d, 0, W, H),
      ArrowUp: (k) => k.pan(0, d, W, H),
      ArrowDown: (k) => k.pan(0, -d, W, H),
      "+": (k) => k.zoomAt(ZOOM, null, null, W, H),
      "=": (k) => k.zoomAt(ZOOM, null, null, W, H),
      "-": (k) => k.zoomAt(1 / ZOOM, null, null, W, H),
      _: (k) => k.zoomAt(1 / ZOOM, null, null, W, H),
      q: (k) => k.orbit(toRad(15 * s)),
      e: (k) => k.orbit(toRad(-15 * s)),
      PageUp: (k) => k.orbit(0, toRad(10 * s)),
      PageDown: (k) => k.orbit(0, toRad(-10 * s)),
      Home: (k) => k.fit(this.sceneBounds(), W / H),
    };
    const op = ops[e.key.length === 1 ? e.key.toLowerCase() : e.key] || ops[e.key];
    if (!op) return false;
    // panning ends following; zooming and turning go on round it
    if (e.key.startsWith("Arrow") || e.key === "Home") this.following = null;
    this.move(op, 160);
    if (placing) this._keyAim = true;
    if (terminal) this.app.terminal.keyAim = true;
    this.app.inspector.keyAim = true;
    return true;
  }

  /** The layout point in the middle of the view (where a point is placed with Enter), or null above the horizon. */
  aimPoint() {
    const c = this.app.canvas;
    return this.groundPoint(c.width / 2, c.height / 2);
  }

  /** Advance animations and wheel zooming (once per frame). */
  step(dt) {
    // placing with the keyboard: the cross of the next point follows the middle of the view
    const ed = this.app.editor;
    if (this._keyAim && ed.placing && this.app.activeTab === "build") ed.hover(this.aimPoint());
    else this._keyAim = false;
    if (this.anim) {
      const a = this.anim, t = (performance.now() - a.t0) / a.ms;
      this.cam.set(FlyCamera.between(a.from, a.to, t));
      if (t >= 1) {
        this.anim = null;
        this._save();
      }
    }
    if (this.following && !this.anim && !this.gesture) {
      const p = this.following(), t = this.cam.target;
      if (p) {
        const k = 1 - Math.exp(-Math.max(dt, 1 / 120) / 0.35);
        this.cam.set({ target: [t[0] + (p[0] - t[0]) * k, t[1] + (p[1] - t[1]) * k] });
      }
    }
    if (this.wheel) {
      // ease in the zoom of wheel clicks (a trackpad sends many small steps, which pass straight through)
      const z = this.wheel, c = this.app.canvas;
      const part = Math.abs(z.log) < 0.002 ? z.log : z.log * (1 - Math.exp(-Math.max(dt, 1 / 120) / 0.06));
      this.cam.zoomAt(Math.exp(part), z.x, z.y, c.width, c.height);
      z.log -= part;
      if (!z.log) {
        this.wheel = null;
        this._save();
      }
    }
    const plan = this.cam.isPlan ? "true" : "false";
    if (this._planShown !== plan) {
      this._planShown = plan;
      for (const b of document.querySelectorAll("[data-fly=plan]")) b.setAttribute("aria-pressed", plan);
      this._syncSimple();
    }
  }

  /* ---------------------------------------------------------------- input */

  _wire() {
    const c = this.app.canvas;
    c.addEventListener("pointerdown", (e) => this.active && this._down(e));
    c.addEventListener("pointermove", (e) => this.active && this._move(e));
    c.addEventListener("pointerup", (e) => this.active && this._up(e, false));
    c.addEventListener("pointercancel", (e) => this.active && this._up(e, true));
    c.addEventListener("pointerleave", () => this.active && !this.pointers.size && !this._keyAim && this.app.editor.hover(null));
    c.addEventListener("pointerdown", () => this.active && this.app.inspector.clearHover());
    // reached with Tab while placing: the cross in the middle shows where Enter puts the point
    c.addEventListener("focus", () => {
      if (this.active && this.app.activeTab === "build" && this.app.editor.placing && c.matches(":focus-visible")) this._keyAim = true;
      if (this.active && !this._entering && c.matches(":focus-visible")) this.app.terminal.keyAim = true;
    });
    c.addEventListener("wheel", (e) => this.active && this._wheel(e), { passive: false });
    c.addEventListener("contextmenu", (e) => this.active && e.preventDefault());
    c.addEventListener("dblclick", (e) => {
      // Build and Terminal: taps select and pick there
      if (!this.active || this.app.activeTab === "build" || this.app.activeTab === "terminal") return;
      const [x, y] = this._point(e), W = c.width, H = c.height;
      this.move((k) => k.zoomAt(2, x, y, W, H));
    });
    $("#btnFlyover").addEventListener("click", () => this.toggle());
    document.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-simple]");
      if (b) this.simpleButton(b.dataset.simple);
    });
    document.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-fly]");
      if (b && this.active) this.command(b.dataset.fly);
    });
  }

  /** Canvas pixel of a pointer event. */
  _point(e) {
    const c = this.app.canvas, r = c.getBoundingClientRect();
    return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height];
  }

  _down(e) {
    const app = this.app, c = app.canvas, ed = app.editor;
    if (document.activeElement !== c) c.focus({ preventScroll: true });
    e.preventDefault();
    this.anim = null;
    this.following = null;
    const p = this._point(e);
    this.pointers.set(e.pointerId, p);
    capture(c, e.pointerId, true);
    app.terminal.keyAim = false; // the pointer takes over from the keyboard
    if (this.pointers.size === 2) {
      // a second finger: pan, pinch and twist; what the first finger started is dropped
      ed.cancelGesture();
      this.gesture = { type: "touch", ...this._fingers() };
      return;
    }
    if (this.pointers.size > 2) return;
    const panButton = e.button === 1 || e.button === 2 || e.shiftKey;
    const build = app.activeTab === "build", terminal = app.activeTab === "terminal";
    if (build && e.button === 0 && !panButton) {
      const g = this.groundPoint(p[0], p[1]);
      if (ed.placing) {
        this.gesture = { type: "place", start: p, ground: g, button: 0 };
        return;
      }
      if (g && ed.grab(g, e)) {
        this.gesture = { type: "drag" };
        c.classList.add("dragging");
        return;
      }
    }
    this.gesture = { type: panButton || build || terminal ? "pan" : "orbit", start: p, moved: false, button: e.button, shift: e.shiftKey };
    c.classList.add("dragging");
  }

  _move(e) {
    const app = this.app, ed = app.editor, c = app.canvas;
    const p = this._point(e);
    const prev = this.pointers.get(e.pointerId);
    if (!prev) {
      // hovering: where the next point would go (the mouse takes over from the keyboard), the tooltip
      this._keyAim = false;
      if (app.activeTab === "build" && ed.placing) ed.hover(this.groundPoint(p[0], p[1]), e);
      if (e.pointerType === "mouse") app.inspector.hoverAt(p);
      return;
    }
    this.pointers.set(e.pointerId, p);
    const g = this.gesture;
    if (!g) return;
    if (g.type === "touch") return this._touch(g);
    if (g.type === "drag") {
      const q = this.groundPoint(p[0], p[1]);
      if (q) ed.dragTo(q, e);
      return;
    }
    const far = Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) / app.px() >= TAP_PX;
    if (g.type === "place") {
      ed.hover(this.groundPoint(p[0], p[1]), e);
      if (!far) return;
      // dragging while placing: a table module is drawn by dragging, otherwise the view pans
      if (ed.placing?.cls.placement === "rect" && !ed.placing.points.length && g.ground) {
        ed.placeAt(g.ground, e);
        g.type = "rect";
      } else {
        g.type = "pan";
        g.moved = true;
        c.classList.add("dragging");
      }
    }
    if (g.type === "rect") return ed.hover(this.groundPoint(p[0], p[1]), e);
    g.moved ||= far;
    if (!g.moved) return;
    const W = c.width, H = c.height;
    if (g.type === "orbit") {
      const k = ORBIT_RAD_PER_PX / app.px();
      this.cam.orbit(-(p[0] - prev[0]) * k, (p[1] - prev[1]) * k);
    } else this.cam.pan(p[0] - prev[0], p[1] - prev[1], W, H, prev);
    this._save();
  }

  _up(e, cancelled) {
    const app = this.app, ed = app.editor, c = app.canvas;
    if (!this.pointers.has(e.pointerId)) return;
    const p = this._point(e);
    this.pointers.delete(e.pointerId);
    capture(c, e.pointerId, false);
    const g = this.gesture;
    if (g?.type === "touch") {
      // one finger left: it pans on
      const rest = [...this.pointers.values()][0];
      this.gesture = rest ? { type: "pan", start: rest, moved: true, button: 0 } : null;
      if (!rest) c.classList.remove("dragging");
      return;
    }
    if (this.pointers.size) return;
    this.gesture = null;
    c.classList.remove("dragging");
    if (!g) return;
    if (g.type === "drag") return ed.endDrag();
    if (cancelled) return;
    if (g.type === "place") {
      if (g.ground) ed.placeAt(g.ground, e);
      else toast("Tap on the table to place it (not on the sky).");
    } else if (g.type === "rect") {
      const q = this.groundPoint(p[0], p[1]);
      if (q) ed.placeAt(q, e);
    } else if (!g.moved && app.activeTab === "build" && g.button === 0 && !g.shift) ed.select(null); // a tap on empty space
    else if (!g.moved && app.activeTab === "terminal" && g.button === 0 && !g.shift) app.terminal.pickAt(p); // a container or a place
    else if (!g.moved && g.button === 0 && !g.shift) app.inspector.tapAt(p, { touch: e.pointerType !== "mouse" }); // the info card
  }

  /** Centre, spread and angle of the two fingers on the canvas. */
  _fingers() {
    const [a, b] = [...this.pointers.values()];
    return { c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d: Math.hypot(b[0] - a[0], b[1] - a[1]), a: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }

  _touch(g) {
    if (this.pointers.size < 2) return;
    const now = this._fingers(), c = this.app.canvas, W = c.width, H = c.height;
    this.cam.pan(now.c[0] - g.c[0], now.c[1] - g.c[1], W, H, g.c);
    if (g.d > 0 && now.d > 0) this.cam.zoomAt(now.d / g.d, now.c[0], now.c[1], W, H);
    let da = now.a - g.a;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    this.cam.turnAt(da, now.c[0], now.c[1], W, H);
    Object.assign(g, now);
    this._save();
  }

  _wheel(e) {
    e.preventDefault();
    this.anim = null;
    this.following = null;
    const [x, y] = this._point(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    // a pinch on a trackpad arrives as a wheel event with ctrlKey
    const log = -dy * (e.ctrlKey ? 0.01 : 0.0016);
    this.wheel = { log: (this.wheel?.log || 0) + Math.max(-1.5, Math.min(1.5, log)), x, y };
  }

  /* ---------------------------------------------------------------- drawing */

  /** Draw a frame of the flyover. */
  render() {
    const app = this.app, { ctx, canvas, world } = app;
    const W = canvas.width, H = canvas.height;
    if (this.camera.width !== W || this.camera.height !== H) this.camera.setSize(W, H);
    const pose = this.pose();
    this.camera.setManualFocal(pose.focal);
    // the simple view (core/simple.js): flat objects, plain blocks for what moves, always by day, no photo
    const simple = this.simple;
    const night = simple ? 0 : world.night();
    this._background(ctx, W, H, night);
    const view = new (simple ? SimpleView : View)({
      ctx, camera: this.camera, H: pose.H, pose: pose.pose, scale: world.scale, px: app.px(), time: world.time,
      labelScale: Math.min(1, Math.max(0.72, canvas.clientWidth / 1000)), night, virtual: true,
    });
    const table = this._defaultTable(); // table modules draw themselves (world.draw)
    if (table) drawTable(view, table, { surface: "grey" });
    if (!simple) this._drawOrtho(view, night);
    drawGrid(view, this._gridBounds(), world.layout.grid.size_mm);
    if (app.display.flyMarkers !== false) this._drawMarkers(view);
    world.draw(view, { selected: app.activeTab === "build" ? app.editor.selected : null });
    app.editor.drawOverlay(ctx, view);
    app.terminal.drawOverlay(ctx, view);
    app.lastView = view;
    app.inspector.drawOverlay(ctx, view);
  }

  /** Sky and floor of the lab, with the horizon where the camera's pitch puts it. */
  _background(ctx, W, H, night) {
    const mix = (a, b) => {
      const A = parseHex(a), B = parseHex(b);
      return rgba(A.map((v, i) => v + (B[i] - v) * night));
    };
    const c = Object.fromEntries(Object.keys(SKY).map((k) => [k, mix(SKY[k], SKY_NIGHT[k])]));
    const f = this.cam.focal(H);
    const yh = this.cam.isPlan ? -Infinity : H / 2 - f * Math.tan(this.cam.pitch);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (yh > 0) {
      const sky = ctx.createLinearGradient(0, 0, 0, yh);
      sky.addColorStop(0, c.top);
      sky.addColorStop(1, c.horizon);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, Math.ceil(yh));
      // dawn and dusk: a warm band along the horizon
      const d = this.app.world.clock.daylight?.() ?? 1;
      const warm = this.app.world.settings.lighting === false ? 0 : 0.5 * (1 - Math.abs(2 * d - 1));
      if (warm > 0.02) {
        const band = ctx.createLinearGradient(0, yh - 0.35 * H, 0, yh);
        band.addColorStop(0, rgba(CD_LIGHT.orange, 0));
        band.addColorStop(1, rgba(CD_LIGHT.orange, warm));
        ctx.fillStyle = band;
        ctx.fillRect(0, Math.max(0, yh - 0.35 * H), W, Math.min(yh, 0.35 * H));
      }
    }
    const top = Math.max(0, yh);
    if (top < H) {
      const floor = ctx.createLinearGradient(0, top, 0, H + (Number.isFinite(yh) ? 0 : H));
      floor.addColorStop(0, Number.isFinite(yh) ? c.floorFar : c.floorNear);
      floor.addColorStop(1, c.floorNear);
      ctx.fillStyle = floor;
      ctx.fillRect(0, Math.floor(top), W, H - Math.floor(top));
    }
    ctx.restore();
  }

  /** The grid covers the tables and a border around them (room for more table modules). */
  _gridBounds() {
    const size = this.app.world.layout.grid.size_mm;
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    const add = (x, y) => {
      b[0] = Math.min(b[0], x);
      b[1] = Math.min(b[1], y);
      b[2] = Math.max(b[2], x);
      b[3] = Math.max(b[3], y);
    };
    for (const fp of this._tables()) for (const p of fp) add(p[0], p[1]);
    // while placing, the grid also reaches the point looked at
    if (this.app.editor.placing) add(...this.cam.target);
    const m = Math.max(10 * size, 400);
    return [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
  }

  /** The orthophoto of the table, in perspective, as a mesh of small affine pieces. */
  _drawOrtho(view, night) {
    const app = this.app, o = orthoOf(app.world.layout);
    if (!o) return;
    const failed = () => toast(`The photo of the table (${o.image}) could not be loaded.`);
    let url;
    try {
      url = new URL(o.image, app.layoutUrl || location.href).href;
    } catch {
      // not a valid URL: the flyover is drawn without the photo (and says so once)
      if (this.ortho?.url !== o.image) failed();
      this.ortho = { url: o.image, ok: false };
      return;
    }
    if (this.ortho?.url !== url) {
      const img = new Image();
      // as for the camera images: a photo from another site must allow it, or the stage canvas can no longer be read or recorded
      img.crossOrigin = "anonymous";
      const entry = (this.ortho = { url, img, ok: false, levels: null });
      img.onload = () => {
        // the parts of the photo no frame covered are a flat grey: transparent, so tables show
        entry.img = clearUncovered(img);
        entry.levels = mipmaps(entry.img);
        entry.ok = true;
      };
      img.onerror = () => {
        if (this.ortho === entry) failed();
      };
      img.src = url;
    }
    if (!this.ortho.ok) return;
    const entry = this.ortho, b = o.bounds_mm;
    view.groundPhoto = b;
    // Drawn into a canvas of its own and kept while the camera stands still: roughly (three
    // pixels) while the camera moves, exactly once it stops.
    const c = this.app.canvas, key = `${view.H.map((v) => v.toPrecision(8)).join(",")}|${c.width}x${c.height}|${b.join(",")}`;
    const moving = key !== this._lastPoseKey;
    this._lastPoseKey = key;
    const cache = (entry.cache ||= { canvas: document.createElement("canvas"), key: null, exact: false });
    if (cache.key !== key || (!moving && !cache.exact)) {
      if (cache.canvas.width !== c.width || cache.canvas.height !== c.height) {
        cache.canvas.width = c.width;
        cache.canvas.height = c.height;
      }
      const g = cache.canvas.getContext("2d");
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
      drawGroundImage(g, view, entry.img, b, entry.levels, moving ? 3 : 0.5);
      cache.key = key;
      cache.exact = !moving;
    }
    view.ground(-90, (ctx) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(cache.canvas, 0, 0);
    });
    if (night > 0.01) {
      // as the view darkens the camera image at night
      view.polygon([[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]], { fill: `rgba(0,10,39,${(0.62 * Math.min(1, night)).toFixed(3)})`, emissive: true, order: -89 });
    }
  }

  /** The marker stickers: black squares on white paper, with their IDs. */
  _drawMarkers(view) {
    const map = this.app.world.map;
    const st = this.app.editor.surveyState;
    const seen = new Set(st?.running ? st.progress?.visible || [] : []);
    for (const id of map.ids()) {
      const e = map.get(id), s = map.sizeOf(id);
      const at = (dx, dy) => [e.x + dx * Math.cos(e.theta) - dy * Math.sin(e.theta), e.y + dx * Math.sin(e.theta) + dy * Math.cos(e.theta)];
      const sq = (h) => [at(-h, -h), at(h, -h), at(h, h), at(-h, h)];
      view.polygon(sq(0.7 * s), { fill: "#ffffff", order: -70, stroke: seen.has(id) ? OVERLAY.tracked : null, width: 2.5 });
      view.polygon(sq(0.5 * s), { fill: "#111111", order: -69.5 });
      const p = view.project(e.x, e.y, 0), q = view.project(...at(0.5 * s, 0), 0);
      if (!p || !q) continue;
      const r = Math.hypot(q[0] - p[0], q[1] - p[1]);
      view.ground(-69, (ctx) => {
        const px = view.px, size = Math.max(9 * px, Math.min(13 * px, r * 0.9));
        ctx.font = `700 ${size}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (r > size * 0.9) {
          ctx.fillStyle = view.dim("#ffffff", 0.5);
          ctx.fillText(String(id), p[0], p[1]);
        } else {
          const y = p[1] - Math.max(r * 1.6, size * 0.4) - size * 0.6;
          ctx.lineWidth = 3 * px;
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.strokeText(String(id), p[0], y);
          ctx.fillStyle = "#111111";
          ctx.fillText(String(id), p[0], y);
        }
      });
    }
  }
}

/** Capture (or release) a pointer; ignores pointers the browser no longer knows. */
function capture(el, id, on) {
  try {
    if (on) el.setPointerCapture?.(id);
    else el.releasePointerCapture?.(id);
  } catch {
    /* not an active pointer (e.g. synthetic events): nothing to capture */
  }
}

function parseHex(c) {
  const s = c.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

/**
 * Draw the layout grid into the ground layer: minor lines every `size` mm, major lines every
 * ten, the axes in CD colours (x: Rot, y: Türkis). Lines closer than a few pixels are left out.
 * @param {View} view
 * @param {number[]} bounds [xmin, ymin, xmax, ymax] mm
 * @param {number} size grid spacing (mm)
 * @param {{onImage?: boolean}} [options] onImage: light lines for the camera view (over the camera image)
 */
export function drawGrid(view, bounds, size, { onImage = false } = {}) {
  if (!(size > 0)) return;
  // spacing at the centre of the region decides the level of detail
  const cx = (bounds[0] + bounds[2]) / 2, cy = (bounds[1] + bounds[3]) / 2;
  const k = Math.max(view.pxPerMM(cx, cy, 0), centrePxPerMM(view));
  let step = size;
  while (step * k < 7 * view.px && step < 1e6) step *= 10;
  const lines = gridLines(snapBounds(bounds, step * 10), step, { maxLines: 300 });
  const style = onImage
    ? { minor: "rgba(255,255,255,0.32)", major: "rgba(255,255,255,0.62)", x: CD_LIGHT.rot, y: CD_LIGHT.tuerkis }
    : { minor: "rgba(0,20,80,0.13)", major: "rgba(0,20,80,0.3)", x: CD.rot, y: CD.tuerkis };
  const project = (seg) => {
    const pts = clipSegment(view, seg);
    return pts && view.projectAll(pts);
  };
  const path = (ctx, segs) => {
    ctx.beginPath();
    for (const s of segs) {
      const q = project(s);
      if (!q) continue;
      ctx.moveTo(q[0][0], q[0][1]);
      ctx.lineTo(q[1][0], q[1][1]);
    }
  };
  view.ground(-80, (ctx) => {
    ctx.lineCap = "butt";
    const dim = (c) => (onImage ? c : view.dim(c, 0.6));
    path(ctx, lines.minor);
    ctx.strokeStyle = dim(style.minor);
    ctx.lineWidth = 1 * view.px;
    ctx.stroke();
    path(ctx, lines.major);
    ctx.strokeStyle = dim(style.major);
    ctx.lineWidth = 1.3 * view.px;
    ctx.stroke();
    for (const [axis, colour] of [[lines.axes.x, style.x], [lines.axes.y, style.y]]) {
      if (!axis) continue;
      path(ctx, [axis]);
      ctx.strokeStyle = dim(colour);
      ctx.lineWidth = 2 * view.px;
      ctx.stroke();
    }
  });
}

/** Image scale (px per mm) at the layout point seen in the middle of the image; 0 above the horizon. */
function centrePxPerMM(view) {
  const Hinv = inv3(view.H);
  if (!Hinv) return 0;
  const p = applyH(Hinv, [view.camera.width / 2, view.camera.height / 2]);
  return p.every(Number.isFinite) && view.depth(p[0], p[1], 0) > 0 ? view.pxPerMM(p[0], p[1], 0) : 0;
}

/** Expand bounds outward to multiples of `m`. */
function snapBounds(b, m) {
  return [Math.floor(b[0] / m) * m, Math.floor(b[1] / m) * m, Math.ceil(b[2] / m) * m, Math.ceil(b[3] / m) * m];
}

/** The part of a ground segment in front of the camera (depth ≥ 2 mm), or null. */
function clipSegment(view, [a, b]) {
  const NEAR = 2;
  const da = view.depth(a[0], a[1], 0), db = view.depth(b[0], b[1], 0);
  if (da < NEAR && db < NEAR) return null;
  if (da >= NEAR && db >= NEAR) return [a, b];
  const t = (NEAR - da) / (db - da), c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return da < NEAR ? [c, b] : [a, c];
}

/**
 * Draw an image lying on the layout plane in perspective. The image is split into cells,
 * recursively and only where needed: a cell is drawn with one affine transform when that is
 * within `tolerance` of the true perspective at its corners; otherwise it is split in four.
 * A plan view is a single piece, an oblique view gets small pieces only near the camera. Each
 * piece overlaps its neighbours by a pixel (no seams) and is taken from a smaller copy of the
 * image when it is drawn much smaller (no aliasing). Image row 0 is at ymax, column 0 at xmin.
 * @param {CanvasRenderingContext2D} ctx
 * @param {View} view
 * @param {HTMLImageElement | HTMLCanvasElement} img
 * @param {number[]} bounds [xmin, ymin, xmax, ymax] mm
 * @param {Array<HTMLImageElement | HTMLCanvasElement>} [levels] the image and copies of half, quarter, ... the size ({@link mipmaps})
 * @param {number} [tolerance=0.5] largest deviation from the true perspective (canvas px)
 */
export function drawGroundImage(ctx, view, img, bounds, levels = [img], tolerance = 0.5) {
  const [x0, y0, x1, y1] = bounds;
  const IW = img.naturalWidth || img.width, IH = img.naturalHeight || img.height;
  if (!IW || !IH) return;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const NEAR = 2, MAX_DEPTH = 7;
  const project = (u, v) => {
    const x = x0 + ((x1 - x0) * u) / IW, y = y1 - ((y1 - y0) * v) / IH;
    return view.depth(x, y, 0) > NEAR ? view.project(x, y, 0) : null;
  };
  const cell = (u0, v0, u1, v1, depth) => {
    const src = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const dst = src.map(([u, v]) => project(u, v));
    const split = () => {
      if (depth >= MAX_DEPTH) return;
      const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      cell(u0, v0, um, vm, depth + 1);
      cell(um, v0, u1, vm, depth + 1);
      cell(u0, vm, um, v1, depth + 1);
      cell(um, vm, u1, v1, depth + 1);
    };
    const n = dst.filter(Boolean).length;
    if (!n) return; // depth is linear: all corners behind the camera = all of the cell
    if (n < 4) return split();
    const xs = dst.map((p) => p[0]), ys = dst.map((p) => p[1]);
    if (Math.max(...xs) < 0 || Math.min(...xs) > W || Math.max(...ys) < 0 || Math.min(...ys) > H) return;
    // least-squares affine map of the four corners (a rectangle: the fit decouples)
    const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2, hu = (u1 - u0) / 2, hv = (v1 - v0) / 2;
    const sign = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const fit = (i) => {
      const mean = dst.reduce((s, p) => s + p[i], 0) / 4;
      const du = dst.reduce((s, p, k) => s + sign[k][0] * p[i], 0) / (4 * hu);
      const dv = dst.reduce((s, p, k) => s + sign[k][1] * p[i], 0) / (4 * hv);
      return [du, dv, mean - du * mu - dv * mv];
    };
    const [a, c, e] = fit(0), [b, d, f] = fit(1);
    const err = Math.max(...src.map(([u, v], k) => Math.hypot(a * u + c * v + e - dst[k][0], b * u + d * v + f - dst[k][1])));
    if (err > tolerance && depth < MAX_DEPTH) return split();
    // pixels on the screen per image pixel: pick the copy of the image to draw from
    const scale = Math.sqrt(Math.abs(a * d - b * c)) || 1e-9;
    const level = Math.max(0, Math.min(levels.length - 1, Math.floor(Math.log2(1 / scale))));
    const k = 2 ** level, pad = 1 / scale; // a screen pixel of overlap
    const sx = Math.max(0, u0 - pad), sy = Math.max(0, v0 - pad), sw = Math.min(IW, u1 + pad) - sx, sh = Math.min(IH, v1 + pad) - sy;
    ctx.setTransform(a * k, b * k, c * k, d * k, e, f);
    ctx.drawImage(levels[level], sx / k, sy / k, sw / k, sh / k, sx / k, sy / k, sw / k, sh / k);
  };
  ctx.save();
  cell(0, 0, IW, IH, 0);
  ctx.restore();
}

/** The image and copies of half, quarter, ... its size (down to about 64 px), for {@link drawGroundImage}. */
/**
 * The orthophoto with its uncovered surroundings made transparent: `arail-survey` fills what no
 * frame showed with one flat grey. Flood-fills from the border over pixels close to the border's
 * most common grey, so grey things inside the covered table stay. Returns a canvas (or the image
 * itself when there is no such border).
 */
export function clearUncovered(img, tolerance = 10) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (!(w > 0 && h > 0)) return img;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  let data;
  try {
    data = g.getImageData(0, 0, w, h);
  } catch {
    return img; // a cross-origin image cannot be read: draw it as it is
  }
  const px = data.data;
  // the most common neutral grey on the border
  const counts = new Map();
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  for (const i of border) {
    const r = px[4 * i], gg = px[4 * i + 1], b = px[4 * i + 2];
    if (Math.max(r, gg, b) - Math.min(r, gg, b) > 6) continue;
    const k = Math.round((r + gg + b) / 12);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = null;
  for (const [k, n] of counts) if (!best || n > best.n) best = { k, n };
  if (!best || best.n < border.length * 0.05) return img;
  const level = best.k * 4;
  const empty = (i) => {
    const r = px[4 * i], gg = px[4 * i + 1], b = px[4 * i + 2];
    return Math.abs(r - level) <= tolerance && Math.abs(gg - level) <= tolerance && Math.abs(b - level) <= tolerance;
  };
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (const i of border) if (!seen[i] && empty(i)) {
    seen[i] = 1;
    stack.push(i);
  }
  while (stack.length) {
    const i = stack.pop();
    px[4 * i + 3] = 0;
    const x = i % w;
    for (const j of [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1]) {
      if (j < 0 || j >= w * h || seen[j] || !empty(j)) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  g.putImageData(data, 0, 0);
  return c;
}

export function mipmaps(img) {
  const out = [img];
  let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, prev = img;
  while (w > 128 && h > 128 && out.length < 7) {
    w = Math.ceil(w / 2);
    h = Math.ceil(h / 2);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(prev, 0, 0, w, h);
    out.push(c);
    prev = c;
  }
  return out;
}
