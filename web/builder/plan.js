// The builder's plan: the layout seen from straight above, drawn by the framework (the full view
// or the simple one), over the orthophoto of the table and a grid. North (+y) is up. A narrow lens
// from far away keeps it a map; drag to pan, the wheel or two fingers to zoom.
import { Camera, FlyCamera, PITCH_MAX, SimpleView, View, applyH, orthoOf, toRad } from "../arail/index.js";
import { drawGrid } from "../app/flyover.js";
import { tr } from "../app/i18n.js";

/** The floor around the layout. */
const FLOOR = "#dfe4e6";

export class PlanView {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{onRender?: (ctx: CanvasRenderingContext2D, view: View) => void}} [options] onRender:
   *   draws the builder's marks over the plan (screen pixels of the canvas)
   */
  constructor(canvas, { onRender = null } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onRender = onRender;
    this.cam = new FlyCamera({ yaw: Math.PI / 2, pitch: PITCH_MAX, fovY: toRad(10), distance: 20000, maxDistance: 600000, minDistance: 200 });
    this.camera = new Camera(1280, 720);
    /** @type {import("../arail/core/world.js").World | null} */
    this.world = null;
    this.simple = false;
    this.showOrtho = true;
    this.grid = true;
    this.selected = null;
    /** The orthophoto: {url, img, ok}. */
    this.ortho = null;
    this.view = null;
    this._queued = false;
    this._resize = new ResizeObserver(() => this.resize());
    this._resize.observe(canvas);
    this.resize();
  }

  /** Canvas pixels per CSS pixel. */
  get px() {
    return Math.max(1, this.canvas.width / Math.max(1, this.canvas.clientWidth));
  }

  resize() {
    const r = this.canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.redraw();
  }

  /** A layout was opened: its orthophoto (relative to `base`, the layout's URL). */
  setWorld(world, base) {
    this.world = world;
    const o = orthoOf(world.layout);
    const url = o ? new URL(o.image, base).href : null;
    if (url !== this.ortho?.url) {
      this.ortho = url ? { url, img: new Image(), ok: false } : null;
      if (this.ortho) {
        const entry = this.ortho;
        entry.img.onload = () => {
          entry.ok = true;
          this.redraw();
        };
        entry.img.src = url;
      }
    }
    this.redraw();
  }

  /** The canvas pixel of a CSS position in the canvas (e.g. of a pointer event). */
  pixelOf(e) {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) * this.canvas.width) / Math.max(1, r.width), ((e.clientY - r.top) * this.canvas.height) / Math.max(1, r.height)];
  }

  /** The layout point (mm) under a canvas pixel. */
  toLayout([u, v]) {
    return this.cam.groundPoint(u, v, this.canvas.width, this.canvas.height);
  }

  /** The canvas pixel of a layout point (mm). */
  toScreen(p) {
    return this.cam.project(p, this.canvas.width, this.canvas.height);
  }

  /** Canvas pixels per layout mm. */
  get pxPerMM() {
    return this.cam.pxPerMM(this.canvas.height);
  }

  /** Layout mm that make `n` CSS pixels on the screen. */
  mmOfPx(n) {
    return (n * this.px) / Math.max(1e-9, this.pxPerMM);
  }

  /** Show a region of the layout ([x0, y0, x1, y1] mm). */
  fit(bounds, margin = 0.06) {
    if (!bounds) return;
    this.cam.fit(bounds, this.canvas.width / Math.max(1, this.canvas.height), margin);
    this.redraw();
  }

  /** Show a point, at least this close (mm across the screen). */
  focus(p, span = 1500) {
    this.cam.set({ target: p });
    const want = (this.canvas.width / span) || this.pxPerMM;
    if (this.pxPerMM < want) this.cam.set({ distance: this.cam.focal(this.canvas.height) / want });
    this.redraw();
  }

  pan(dx, dy, at) {
    this.cam.pan(dx, dy, this.canvas.width, this.canvas.height, at);
    this.redraw();
  }

  zoomAt(factor, [u, v]) {
    this.cam.zoomAt(factor, u, v, this.canvas.width, this.canvas.height);
    this.redraw();
  }

  /** Draw at the next frame. */
  redraw() {
    if (this._queued) return;
    this._queued = true;
    requestAnimationFrame(() => {
      this._queued = false;
      this.render();
    });
  }

  render() {
    const { ctx, canvas, world } = this;
    const W = canvas.width, H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = FLOOR;
    ctx.fillRect(0, 0, W, H);
    if (!world) return;
    if (this.camera.width !== W || this.camera.height !== H) this.camera.setSize(W, H);
    const pose = this.cam.homography(W, H);
    this.camera.setManualFocal(pose.focal);
    const view = new (this.simple ? SimpleView : View)({
      ctx, camera: this.camera, H: pose.H, pose: pose.pose, scale: world.scale, px: this.px, time: world.time,
      labelScale: Math.min(1, Math.max(0.72, canvas.clientWidth / 1000)), night: 0, virtual: true, translate: tr,
    });
    this.view = view;
    // the photo of the table over the table modules (−95), under the grid (−80) and everything else
    if (this.showOrtho) view.ground(-90, () => this._drawOrtho(pose.H));
    if (this.grid) drawGrid(view, this._gridBounds(), world.layout.grid?.size_mm || 50);
    world.draw(view, { selected: this.selected });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.onRender?.(ctx, view);
  }

  /** The orthophoto: from straight above the layout maps to the screen by an affine transform. */
  _drawOrtho(H) {
    const o = orthoOf(this.world.layout);
    if (!o || !this.ortho?.ok) return;
    const [x0, y0, x1, y1] = o.bounds_mm, img = this.ortho.img;
    const a = applyH(H, [x0, y1]), b = applyH(H, [x1, y1]), c = applyH(H, [x0, y0]);
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.setTransform((b[0] - a[0]) / img.naturalWidth, (b[1] - a[1]) / img.naturalWidth, (c[0] - a[0]) / img.naturalHeight, (c[1] - a[1]) / img.naturalHeight, a[0], a[1]);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  /** The grid around everything on the layout. */
  _gridBounds() {
    const corners = [[0, 0], [this.canvas.width, 0], [0, this.canvas.height], [this.canvas.width, this.canvas.height]].map((q) => this.toLayout(q)).filter(Boolean);
    if (!corners.length) return [-1000, -1000, 1000, 1000];
    return [Math.min(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[1])), Math.max(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[1]))];
  }
}
