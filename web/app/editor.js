// Build mode: place, select, move and edit layout objects on the camera image or in the flyover.
import { applyH, dist2, FONT, OVERLAY, pointSegment, polylineAt, polylineProject, resolvePoint, rgba, snapToGrid, toDeg } from "../arail/index.js";
import { $, download, h, morph, mount, paramFields, readFile, section, toast } from "./ui.js";
import { markerPlotSvg, VideoSurvey } from "./survey.js";

const CATEGORIES = ["Transport", "Buildings", "Scenery", "Infrastructure", "Table"];
const HINTS = {
  point: "Tap on the layout where it should go.",
  segment: "Tap the start and the end. Tap on a marker to anchor the end to it.",
  polygon: "Tap the corners one after the other, then press Finish.",
  polyline: "Tap the points along the line, then press Finish.",
  rect: "Drag from one corner to the opposite one, or tap both corners.",
  stops: "Tap the stops in the order the buses serve them, then press Finish.",
};
const PLACEMENT_HINTS = { point: "tap once", segment: "two ends", polygon: "outline", polyline: "line", rect: "two corners", stops: "tap stops" };
export const SCALES = [
  [87, "H0 (1:87)"], [120, "TT (1:120)"], [160, "N (1:160)"], [220, "Z (1:220)"], [64, "S (1:64)"],
  [45, "0 (1:45)"], [32, "1 (1:32)"], [22.5, "G (1:22.5)"],
];
/** A rectangle dragged out by less than this (CSS px) is taken as a tap on its first corner. */
const RECT_DRAG_PX = 8;
/** An object starts to move when the pointer has moved this far (CSS px). */
const DRAG_PX = 3;

const round1 = (v) => Math.round(v * 10) / 10;

export class Editor {
  constructor(app) {
    this.app = app;
    this.selected = null;
    /** @type {{cls: any, points: Array<{xy?: number[], marker?: number}>, replace?: any} | null} */
    this.placing = null;
    this.drag = null;
    /** Where the next point would go while placing (snapped), for the preview. */
    this.hoverPoint = null;
    // in the flyover, the flyover routes the pointer (navigation or editing, see flyover.js)
    const c = app.canvas, mine = (fn) => (e) => app.mode !== "flyover" && fn(e);
    c.addEventListener("pointerdown", mine((e) => this._down(e)));
    c.addEventListener("pointermove", mine((e) => this._move(e)));
    c.addEventListener("pointerup", mine((e) => this._up(e)));
    c.addEventListener("pointercancel", mine((e) => this._up(e, true)));
  }

  get world() {
    return this.app.world;
  }

  get active() {
    return this.app.activeTab === "build";
  }

  /* ---------------------------------------------------------------- canvas interaction */

  /** Pointer event -> layout point (mm), or null where there is no layout (not tracked yet, the sky of the flyover). */
  toLayout(e) {
    return this.app.eventToLayout(e);
  }

  /** Image pixels per layout mm around a layout point. */
  pxPerMM(p) {
    const H = this.app.pose().H;
    if (!H) return 1;
    const a = applyH(H, p), b = applyH(H, [p[0] + 10, p[1]]), c = applyH(H, [p[0], p[1] + 10]);
    return (dist2(a, b) + dist2(a, c)) / 20 || 1e-6;
  }

  nearestMarker(p, radiusMM) {
    let best = null;
    for (const [id, e] of this.world.map.entries) {
      const d = Math.hypot(e.x - p[0], e.y - p[1]);
      if (d <= Math.max(radiusMM, this.world.map.sizeOf(id)) && (!best || d < best.d)) best = { id, d };
    }
    return best ? best.id : null;
  }

  /**
   * The object at a layout point. Small objects win over large ones; background objects (table
   * modules) only at their edges unless they are selected, so that dragging over a table pans.
   */
  hitTest(p) {
    const tol = (10 * this.app.px()) / Math.max(1e-6, this.pxPerMM(p));
    const rank = (o) => (o.constructor.background ? 2 : o.constructor.placement === "point" ? 0 : 1);
    const order = [...this.world.objects].reverse().sort((a, b) => rank(a) - rank(b));
    for (const o of order) {
      if (!o.geometry) continue;
      // the outline of a real table is only drawn in the flyover: over the camera image it is not picked (by accident)
      if (o.physical && this.app.mode !== "flyover") continue;
      if (o.constructor.background && o !== this.selected ? this._onEdge(o, p, 1.5 * tol) : o.contains(p, tol)) return o;
    }
    return null;
  }

  _onEdge(o, p, tol) {
    const fp = o.footprint();
    return !!fp && fp.some((a, i) => pointSegment(p, a, fp[(i + 1) % fp.length]).distance <= tol);
  }

  /* ---------------------------------------------------------------- grid snapping */

  /** Snapping is on while the grid is shown and enabled; Alt (Option) switches it off for one move. */
  snapping(e) {
    return !e?.altKey && this.world.layout.grid.snap !== false && this.app.gridVisible();
  }

  /** A layout point snapped to the grid (when snapping is on). */
  snap(p, e) {
    return this.snapping(e) ? snapToGrid(p, this.world.layout.grid.size_mm) : p;
  }

  /** Where a tap at p places the next point: on a marker (segment ends), on the grid, or at p. */
  _placePoint(p, e) {
    const cls = this.placing?.cls;
    if (cls?.placement === "stops") return { stopAt: p }; // bus lines pick stops, see _addStop
    const marker = cls?.placement === "segment" ? this.nearestMarker(p, 15) : null;
    if (marker != null) return { marker };
    // streets connect: snapping to street ends and centre lines wins over the grid
    if (typeof cls?.prototype.roadInfo === "function" && !e?.altKey) {
      const s = this._snapToStreets(p);
      if (s !== p) return { xy: [round1(s[0]), round1(s[1])] };
    }
    const q = this.snap(p, e);
    return { xy: [round1(q[0]), round1(q[1])] };
  }

  /* ---------------------------------------------------------------- pointer (also used by the flyover) */

  /** Add a placing point at the layout point p (snapped). */
  placeAt(p, e) {
    if (!this.placing || !p) return;
    this._addPoint(this._placePoint(p, e));
  }

  /** Preview of the next placing point (null: none). */
  hover(p, e) {
    this.hoverPoint = this.placing && p ? this._placePoint(p, e) : null;
  }

  /** Select the object at p and start dragging it; returns it, or null if there is nothing. */
  grab(p, e) {
    const hit = this.hitTest(p);
    if (!hit) return null;
    if (hit !== this.selected) this.select(hit);
    this.drag = { start: p, anchor: this._snapAnchor(hit), last: p, moved: false };
    this.app.canvas.classList.add("dragging");
    return hit;
  }

  /**
   * The point of an object that snaps to the grid when it is dragged: its own `snapPoint()`, else
   * the first point drawn of a line, outline or segment (points placed on the grid stay on it;
   * their centre is mostly between grid lines), else its anchor point.
   */
  _snapAnchor(o) {
    if (o.snapPoint) return o.snapPoint();
    const s = o.spec, first = Array.isArray(s.points) ? s.points[0] : s.from;
    return (first != null && resolvePoint(this.world.map, first)) || o.anchorPoint();
  }

  /** Drag the grabbed object so that it follows the pointer at p; its anchor snaps to the grid. */
  dragTo(p, e) {
    const d = this.drag, o = this.selected;
    if (!d || !o || !p) return;
    // a click that selects an object must not move it (nor snap it to the grid)
    if (!d.moved && Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) * this.pxPerMM(p) < DRAG_PX * this.app.px()) return;
    let dx = p[0] - d.last[0], dy = p[1] - d.last[1];
    if (this.snapping(e) && d.anchor) {
      const cur = this._snapAnchor(o);
      if (cur) {
        const goal = this.snap([d.anchor[0] + p[0] - d.start[0], d.anchor[1] + p[1] - d.start[1]], e);
        dx = goal[0] - cur[0];
        dy = goal[1] - cur[1];
      }
    }
    d.last = p;
    if (Math.hypot(dx, dy) < 0.2) return;
    o.translate(dx, dy);
    d.moved = true;
  }

  /** Stop dragging (and save if something moved). */
  endDrag() {
    const d = this.drag;
    this.drag = null;
    this.app.canvas.classList.remove("dragging");
    if (d?.moved) {
      this.app.saveLayout();
      this.renderInspector();
    }
  }

  /** Drop whatever the pointer started (a second finger takes over in the flyover). */
  cancelGesture() {
    this.endDrag();
    this.rectDrag = null;
  }

  _down(e) {
    if (!this.active || e.button > 0) return;
    const p = this.toLayout(e);
    if (!p) {
      toast("The layout is not tracked yet. Show the markers to the camera first.");
      return;
    }
    e.preventDefault();
    if (this.placing) {
      const rect = this.placing.cls.placement === "rect" && !this.placing.points.length;
      this.placeAt(p, e);
      // the opposite corner may follow by dragging
      if (rect && this.placing) {
        this.rectDrag = { x: e.clientX, y: e.clientY };
        this.app.canvas.setPointerCapture?.(e.pointerId);
      }
      return;
    }
    const hit = this.grab(p, e);
    if (hit) this.app.canvas.setPointerCapture?.(e.pointerId);
    else this.select(null);
  }

  _move(e) {
    if (!this.active) return;
    if (this.placing) {
      this.hover(this.toLayout(e), e);
      return;
    }
    if (this.drag) this.dragTo(this.toLayout(e), e);
  }

  _up(e, cancelled = false) {
    if (this.rectDrag) {
      const r = this.rectDrag;
      this.rectDrag = null;
      this.app.canvas.releasePointerCapture?.(e.pointerId);
      const p = this.toLayout(e);
      if (!cancelled && p && this.placing && Math.hypot(e.clientX - r.x, e.clientY - r.y) >= RECT_DRAG_PX) this.placeAt(p, e);
      return;
    }
    if (!this.drag) return;
    this.app.canvas.releasePointerCapture?.(e.pointerId);
    this.endDrag();
  }

  /* ---------------------------------------------------------------- placing */

  startPlacing(type, replace = null) {
    const cls = this.world.registry.objects.get(type);
    if (!cls) return;
    this.placing = { cls, points: [], replace };
    this.hoverPoint = null;
    if (!replace) this.select(null);
    this.renderPlacing();
    this.renderPalette();
  }

  cancel() {
    this.placing = null;
    this.hoverPoint = null;
    this.rectDrag = null;
    this.renderPlacing();
    this.renderPalette();
  }

  /** Forget placing, dragging and the selection (before another layout is loaded). */
  reset() {
    this.surveyState?.survey.cancel();
    this.placing = null;
    this.drag = null;
    this.rectDrag = null;
    this.hoverPoint = null;
    this.app.canvas.classList.remove("dragging");
    this.renderPlacing();
    this.select(null);
  }

  /** True if the object belongs to the loaded layout (not to one loaded before). */
  _inWorld(obj) {
    return !!obj && this.world.objects.includes(obj);
  }

  /** Add a placing point ({xy}, {marker} or, for bus lines, {stopAt}); point, segment and rect placements finish by themselves. */
  _addPoint(q) {
    const { cls, points } = this.placing;
    if (cls.placement === "stops") return this._addStop(q.stopAt);
    points.push(q);
    const n = points.length;
    if (cls.placement === "point" || ((cls.placement === "segment" || cls.placement === "rect") && n === 2)) this.finish();
    else this.renderPlacing();
  }

  /** Streets connect: a tap near the end or a corner of a street snaps to it, a tap on a street to its centre line. */
  _snapToStreets(p) {
    const tol = (12 * this.app.px()) / Math.max(1e-6, this.pxPerMM(p));
    let best = null;
    const near = (q) => {
      const d = dist2(p, q);
      if (d <= tol && (!best || d < best.d)) best = { d, q };
    };
    const streets = this.world.objects.filter((o) => typeof o.roadInfo === "function" && o.geometry);
    for (const o of streets) for (const q of o.geometry.points || []) near(q);
    for (const q of this.placing.points) if (q.xy) near(q.xy);
    if (best) return best.q.slice();
    for (const o of streets) {
      const info = o.roadInfo();
      const pr = info ? polylineProject(info.points, p) : null;
      if (pr && pr.distance <= info.width / 2) return polylineAt(info.points, pr.s).point;
    }
    return p;
  }

  /** Placement "stops" (bus lines): only stops can be tapped, in order. */
  _addStop(p) {
    const types = this.placing.cls.stopTypes || ["bus-stop", "bus-terminal"];
    const tol = (10 * this.app.px()) / Math.max(1e-6, this.pxPerMM(p));
    const hit = this.world.objects.find((o) => types.includes(o.type) && o.geometry && o.contains(p, tol));
    if (!hit) return toast("Tap a bus stop or a bus terminal.");
    const points = this.placing.points;
    if (points[points.length - 1]?.id !== hit.id) points.push({ id: hit.id });
    this.renderPlacing();
  }

  /** Rotation (degrees) of the nearest platform, so new objects line up with the tracks. */
  _alignedRotation(p) {
    let best = null;
    for (const o of this.world.objects) {
      if (o.type !== "platform" || !o.geometry) continue;
      const g = o.geometry, d = dist2(p, g.center);
      if (!best || d < best.d) best = { d, deg: toDeg(Math.atan2(g.u[1], g.u[0])) };
    }
    return best ? Math.round(best.deg * 2) / 2 : 0;
  }

  finish() {
    const { cls, points, replace } = this.placing;
    const asSpec = (q) => (q.marker != null ? { marker: q.marker, offset: [0, 0] } : q.xy);
    const geo = {};
    if (cls.placement === "point") {
      if (!points.length) return;
      geo.position = points[0].xy;
    } else if (cls.placement === "segment") {
      if (points.length < 2) return toast("Tap the second end point.");
      if (points.every((q) => q.marker != null) && points[0].marker !== points[1].marker) {
        geo.between = [points[0].marker, points[1].marker];
        geo.from = undefined;
        geo.to = undefined;
      } else {
        geo.from = asSpec(points[0]);
        geo.to = asSpec(points[1]);
        geo.between = undefined;
      }
    } else if (cls.placement === "rect") {
      if (points.length < 2) return toast("Tap the opposite corner.");
      const [a, b] = points.map((q) => q.xy);
      const w = round1(Math.abs(b[0] - a[0])), d = round1(Math.abs(b[1] - a[1]));
      if (w < 5 || d < 5) {
        points.pop();
        this.renderPlacing();
        return toast("That is too small: drag or tap to the opposite corner.");
      }
      Object.assign(geo, { position: [round1((a[0] + b[0]) / 2), round1((a[1] + b[1]) / 2)], width_mm: w, depth_mm: d, rotation_deg: 0 });
    } else if (cls.placement === "stops") {
      if (points.length < 2) return toast("Tap at least two stops.");
      geo.stops = points.map((q) => q.id);
    } else {
      const min = cls.placement === "polygon" ? 3 : 2;
      if (points.length < min) return toast(`Tap at least ${min} points.`);
      geo.points = points.map((q) => q.xy);
    }
    this.placing = null;
    this.hoverPoint = null;
    let obj;
    if (replace && !this._inWorld(replace)) {
      this.renderPlacing();
      this.renderPalette();
      return toast("That object is no longer on the layout.");
    }
    if (replace) {
      replace.set(geo);
      obj = replace;
    } else {
      const spec = { type: cls.type, ...Object.fromEntries(Object.entries(geo).filter(([, v]) => v !== undefined)) };
      if (cls.placement === "point" && this._rotatable(cls)) spec.rotation_deg = this._alignedRotation(geo.position);
      obj = this.world.addObject(spec);
      toast(cls.placement === "stops" ? `${cls.label} added. Change it on the right.` : `${cls.label} added. Drag it to move it, or change it on the right.`);
    }
    this.app.saveLayout();
    this.renderPlacing();
    this.renderPalette();
    this.select(obj);
  }

  select(obj) {
    this.selected = obj;
    this.renderObjects();
    this.renderInspector();
  }

  /** Can objects of this class be turned (do they have a `rotation_deg` parameter)? */
  _rotatable(cls) {
    return !!cls?.params?.some((p) => p.key === "rotation_deg");
  }

  /** Turn the selected object by `deg` degrees (positive = counter-clockwise seen from above). */
  rotateSelected(deg) {
    const o = this.selected;
    if (!this._inWorld(o) || !this._rotatable(o.constructor)) return false;
    let r = ((((+o.spec.rotation_deg || 0) + deg) % 360) + 360) % 360;
    if (r > 180) r -= 360;
    o.set({ rotation_deg: round1(r) });
    this.app.saveLayout();
    this.renderInspector();
    return true;
  }

  deleteSelected() {
    if (!this._inWorld(this.selected)) return this.select(null);
    if (this.placing?.replace === this.selected) this.cancel();
    const name = this.selected.name;
    this.world.removeObject(this.selected.id);
    this.select(null);
    this.app.saveLayout();
    toast(`${name} deleted`);
  }

  duplicateSelected() {
    const o = this.selected;
    if (!o) return;
    const spec = o.toJSON();
    delete spec.id;
    const copy = this.world.addObject(spec);
    // beside the original (table modules line up), or a little offset
    const [dx, dy] = o.duplicateOffset?.() ?? [copy.mm(5), copy.mm(5)];
    copy.translate(dx, dy);
    this.app.saveLayout();
    this.select(copy);
  }

  /** Placing preview and snap targets, in image pixels. */
  drawOverlay(ctx, view) {
    if (!this.active) return;
    const px = view.px;
    if (this.placing?.cls.placement === "segment") {
      for (const [id, e] of this.world.map.entries) {
        const q = view.project(e.x, e.y, 0);
        if (!q) continue;
        ctx.beginPath();
        ctx.arc(q[0], q[1], 14 * px, 0, 2 * Math.PI);
        ctx.strokeStyle = rgba(OVERLAY.selection, 0.95);
        ctx.lineWidth = 2 * px;
        ctx.stroke();
        ctx.fillStyle = OVERLAY.selection;
        ctx.font = `700 ${12 * px}px ${FONT}`;
        ctx.fillText(String(id), q[0] + 16 * px, q[1] - 10 * px);
      }
    }
    if (!this.placing) return;
    if (this.placing.cls.placement === "stops") this._drawStopTargets(ctx, view);
    const toXY = (q) => {
      if (q.marker != null) return this.world.map.get(q.marker);
      const xy = q.id ? this.world.getObject(q.id)?.anchorPoint() : q.xy;
      return xy ? { x: xy[0], y: xy[1] } : null;
    };
    const project = (q) => {
      const e = q && toXY(q);
      return e ? view.project(e.x, e.y, 0) : null;
    };
    const { points, cls } = this.placing;
    const hover = this.hoverPoint;
    ctx.save();
    ctx.strokeStyle = OVERLAY.selection;
    ctx.fillStyle = OVERLAY.selection;
    ctx.lineWidth = 2.5 * px;
    ctx.setLineDash([8 * px, 5 * px]);
    if (cls.placement === "rect") {
      // the rectangle from the first corner to the pointer, with its size
      const a = points[0]?.xy, b = hover?.xy;
      if (a && b) {
        const corners = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]].map((c) => view.project(c[0], c[1], 0));
        if (corners.every(Boolean)) {
          ctx.beginPath();
          corners.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
          ctx.closePath();
          ctx.fillStyle = rgba(OVERLAY.selection, 0.14);
          ctx.fill();
          ctx.stroke();
          const mid = view.project((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0);
          if (mid) tag(ctx, mid, `${round1(Math.abs(b[0] - a[0]))} × ${round1(Math.abs(b[1] - a[1]))} mm`, px);
        }
      }
    } else {
      const pts = points.map(project).filter(Boolean);
      const next = pts.length && cls.placement !== "point" ? project(hover) : null;
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
      if (next) ctx.lineTo(next[0], next[1]);
      if (cls.placement === "polygon" && pts.length + (next ? 1 : 0) > 2) ctx.closePath();
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = OVERLAY.selection;
    for (const q of points.map(project).filter(Boolean)) {
      ctx.beginPath();
      ctx.arc(q[0], q[1], 5 * px, 0, 2 * Math.PI);
      ctx.fill();
    }
    // where a tap would put the next point (on the grid when snapping)
    const h = project(hover);
    if (h) {
      const r = 7 * px;
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = OVERLAY.selection;
      ctx.beginPath();
      ctx.moveTo(h[0] - r, h[1]);
      ctx.lineTo(h[0] + r, h[1]);
      ctx.moveTo(h[0], h[1] - r);
      ctx.lineTo(h[0], h[1] + r);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(h[0], h[1], 3 * px, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** While picking the stops of a bus line: rings around the stops that can be tapped. */
  _drawStopTargets(ctx, view) {
    const types = this.placing.cls.stopTypes || ["bus-stop", "bus-terminal"];
    const picked = this.placing.points.map((q) => q.id);
    ctx.save();
    ctx.lineWidth = 2 * view.px;
    ctx.font = `700 ${12 * view.px}px ${FONT}`;
    for (const o of this.world.objects) {
      if (!types.includes(o.type) || !o.geometry) continue;
      const c = o.anchorPoint(), q = c && view.project(c[0], c[1], 0);
      if (!q) continue;
      ctx.beginPath();
      ctx.arc(q[0], q[1], 16 * view.px, 0, 2 * Math.PI);
      ctx.strokeStyle = rgba(OVERLAY.selection, 0.95);
      ctx.stroke();
      const n = picked.indexOf(o.id);
      if (n >= 0) {
        ctx.fillStyle = OVERLAY.selection;
        ctx.fillText(String(n + 1), q[0] + 18 * view.px, q[1] - 10 * view.px);
      }
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------- panel */

  render(container) {
    this.el = {
      palette: h("div", { class: "palette" }),
      objects: h("ul", { class: "list" }),
      inspector: h("div", { class: "section" }),
      layout: h("div", { class: "section" }),
      markers: h("div", { class: "section" }),
    };
    mount(container,
      section("Add to the layout", this.el.palette),
      section(h("span", {}, "Objects ", h("span", { class: "count", id: "objCount" })), this.el.objects),
      this.el.inspector,
      this.el.layout,
      this.el.markers,
    );
    this.renderAll();
  }

  renderAll() {
    if (!this.el) return;
    this.renderPalette();
    this.renderObjects();
    this.renderInspector();
    this.renderLayout();
    this.renderMarkers();
  }

  renderPalette() {
    if (!this.el) return;
    const reg = this.world.registry;
    const groups = {};
    for (const cls of reg.objects.values()) (groups[cls.category] ||= []).push(cls);
    const cats = [...CATEGORIES, ...Object.keys(groups).filter((c) => !CATEGORIES.includes(c))];
    mount(this.el.palette, cats.filter((c) => groups[c]).map((c) => [
      h("h3", {}, c),
      groups[c].map((cls) => h("button", {
        type: "button", "aria-pressed": this.placing?.cls === cls && !this.placing.replace ? "true" : "false", title: cls.description,
        onclick: () => (this.placing?.cls === cls ? this.cancel() : this.startPlacing(cls.type)),
      }, cls.label, h("small", {}, PLACEMENT_HINTS[cls.placement] || ""))),
    ]));
  }

  renderPlacing() {
    const bar = $("#placing");
    if (!this.placing) {
      bar.hidden = true;
      return;
    }
    const { cls, points, replace } = this.placing;
    const multi = cls.placement === "polygon" || cls.placement === "polyline" || cls.placement === "stops";
    const noun = cls.placement === "stops" ? "stop" : "point";
    const grid = this.snapping() && cls.placement !== "stops" ? ` Points snap to the ${this.world.layout.grid.size_mm} mm grid (hold Alt for free placement).` : "";
    mount(bar,
      h("span", { class: "grow" }, h("strong", {}, replace ? `Redraw ${replace.name}: ` : `${cls.label}: `), HINTS[cls.placement],
        points.length ? ` (${points.length} ${noun}${points.length > 1 ? "s" : ""})` : "", grid),
      multi ? h("button", { class: "btn small primary", type: "button", onclick: () => this.finish() }, "Finish") : null,
      points.length ? h("button", { class: "btn small", type: "button", onclick: () => { points.pop(); this.renderPlacing(); } }, `Undo ${noun}`) : null,
      h("button", { class: "btn small", type: "button", onclick: () => this.cancel() }, "Cancel"),
    );
    bar.hidden = false;
  }

  renderObjects() {
    if (!this.el) return;
    const objs = this.world.objects;
    $("#objCount").textContent = objs.length ? `(${objs.length})` : "";
    mount(this.el.objects, objs.length
      ? objs.map((o) => h("li", {}, h("button", {
        type: "button", "aria-current": o === this.selected ? "true" : "false", onclick: () => this.select(o === this.selected ? null : o),
      }, h("span", {}, o.name), h("span", { class: "meta" }, o.geometry ? o.type : `${o.type} · not placed`))))
      : h("li", { class: "item" }, h("span", { class: "hint" }, "Nothing placed yet. Pick an object type above and tap on the layout.")));
  }

  renderInspector() {
    if (!this.el) return;
    const o = this.selected;
    if (!o) {
      mount(this.el.inspector);
      return;
    }
    const cls = o.constructor;
    const change = (key, value) => {
      o.set({ [key]: value });
      this.app.saveLayout();
      if (key === "name" || key === "text") this.renderObjects();
    };
    const geo = this._geometryFields(o);
    const problems = typeof o.problems === "function" ? o.problems() : [];
    // the inspector is drawn anew after turning: the button keeps the focus (it can be pressed again)
    const rotateButton = (id, deg, title, symbol, words) => h("button", {
      class: "btn small", type: "button", id, title,
      onclick: () => {
        this.rotateSelected(deg);
        document.getElementById(id)?.focus();
      },
    }, h("span", { "aria-hidden": "true" }, symbol), " 90°", h("span", { class: "visually-hidden" }, words));
    mount(this.el.inspector,
      h("h2", {}, `Selected: ${cls.label}`),
      cls.description ? h("p", { class: "hint" }, cls.description) : null,
      problems.map((t) => h("p", { class: "hint error", role: "status" }, t)),
      paramFields(cls.params, o.spec, change, { idPrefix: `obj-${o.id}`, world: this.world }),
      geo,
      this._rotatable(cls) ? h("div", { class: "row", role: "group", "aria-label": "Rotate" },
        rotateButton(`rot-ccw-${o.id}`, 90, "Turn 90° counter-clockwise (Shift+R; R turns by 15°)", "↺", " counter-clockwise"),
        rotateButton(`rot-cw-${o.id}`, -90, "Turn 90° clockwise", "↻", " clockwise"),
      ) : null,
      h("div", { class: "row" },
        h("button", { class: "btn small", type: "button", onclick: () => this.startPlacing(o.type, o) }, cls.placement === "stops" ? "Pick the stops again" : "Redraw position"),
        h("button", { class: "btn small", type: "button", onclick: () => this.duplicateSelected() }, "Duplicate"),
        h("button", { class: "btn small danger", type: "button", onclick: () => this.deleteSelected() }, "Delete"),
        h("button", { class: "btn small", type: "button", onclick: () => this.select(null) }, "Done"),
      ),
    );
  }

  _geometryFields(o) {
    const s = o.spec;
    const num = (id, label, value, set) => h("label", { class: "field", for: id }, h("span", {}, label, h("small", {}, " (mm)")),
      h("input", { type: "number", id, step: "any", value: value, onchange: (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { set(v); this.app.saveLayout(); } } }));
    // setters read the current spec: another field may have changed it since this form was drawn
    if (Array.isArray(s.position)) {
      const setXY = (i, v) => { const p = [...o.spec.position]; p[i] = v; o.set({ position: p }); };
      return h("div", { class: "fields" },
        num(`geo-${o.id}-x`, "X", s.position[0], (v) => setXY(0, v)),
        num(`geo-${o.id}-y`, "Y", s.position[1], (v) => setXY(1, v)));
    }
    if (s.position && s.position.marker != null) {
      const off = s.position.offset || [0, 0];
      const setOffset = (i, v) => {
        const pos = o.spec.position, next = [...(pos.offset || [0, 0])];
        next[i] = v;
        o.set({ position: { ...pos, offset: next } });
      };
      return h("div", { class: "fields" },
        h("p", { class: "hint wide" }, `Anchored to marker ${s.position.marker}: moves with it.`),
        num(`geo-${o.id}-dx`, "Offset X", off[0], (v) => setOffset(0, v)),
        num(`geo-${o.id}-dy`, "Offset Y", off[1], (v) => setOffset(1, v)));
    }
    if (Array.isArray(s.between)) {
      const ids = this.world.map.ids();
      const sel = (i) => h("label", { class: "field", for: `geo-${o.id}-m${i}` }, h("span", {}, i ? "End marker" : "Start marker"),
        h("select", { id: `geo-${o.id}-m${i}`, onchange: (e) => { const b = [...o.spec.between]; b[i] = Number(e.target.value); o.set({ between: b }); this.app.saveLayout(); } },
          [...new Set([...ids, ...s.between])].map((m) => h("option", { value: m, selected: m === s.between[i] }, `Marker ${m}`))));
      return h("div", { class: "fields" }, sel(0), sel(1));
    }
    if (Array.isArray(s.points)) return h("p", { class: "hint" }, `${s.points.length} points. Use “Redraw position” to change the outline.`);
    if (Array.isArray(s.stops)) {
      const names = s.stops.map((id) => this.world.getObject(id)?.name || `${id} (missing)`);
      // a loop: which way round its buses go (the arrow on their signs)
      const ring = o.info?.()?.directions?.find((d) => d.loop);
      const round = ring ? ` The buses go round ${ring.destination.endsWith("↻") ? "clockwise" : ring.destination.endsWith("↺") ? "counter-clockwise" : "the loop"} (“${ring.destination}” on the signs).` : "";
      return h("p", { class: "hint" }, `Stops: ${names.join(" → ")}.${round}`);
    }
    return null;
  }

  renderLayout() {
    if (!this.el) return;
    const w = this.world, L = w.layout;
    const scaleOptions = SCALES.some(([v]) => v === w.scale) ? SCALES : [...SCALES, [w.scale, `1:${w.scale}`]];
    const dicts = [["auto", "detect automatically"], ...(this.app.detector?.dictionaries || []).map((d) => [d.name, d.label])];
    const importInput = h("input", { type: "file", id: "layoutImport", accept: ".json,application/json", class: "visually-hidden",
      onchange: async (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) this.app.importLayout(await readFile(f), f.name); } });
    mount(this.el.layout,
      h("h2", {}, "Layout"),
      h("div", { class: "fields" },
        h("label", { class: "field wide", for: "layoutNameField" }, h("span", {}, "Name"),
          h("input", { type: "text", id: "layoutNameField", value: L.name, onchange: (e) => { L.name = e.target.value; this.app.saveLayout(); this.app.showLayoutName(); } })),
        h("label", { class: "field", for: "layoutScale" }, h("span", {}, "Model scale"),
          h("select", { id: "layoutScale", onchange: (e) => { w.setScale(Number(e.target.value)); this.app.saveLayout(); } },
            scaleOptions.map(([v, t]) => h("option", { value: v, selected: v === w.scale }, t)))),
        h("label", { class: "field", for: "layoutMarkerSize" }, h("span", {}, "Marker size", h("small", {}, " (mm)")),
          h("input", { type: "number", id: "layoutMarkerSize", min: 5, max: 300, step: 0.5, value: w.map.size,
            onchange: (e) => { const v = Number(e.target.value); if (v > 0) { w.map.size = v; L.markers.size_mm = v; w.map.version++; this.app.tracker.reset(); this.app.redetect(); this.app.saveLayout(); } } })),
        h("label", { class: "field wide", for: "layoutDictionary" }, h("span", {}, "Marker type (dictionary)"),
          h("select", { id: "layoutDictionary", onchange: (e) => { L.markers.dictionary = e.target.value; this.app.applyDictionary(); this.app.redetect(); this.app.saveLayout(); } },
            dicts.map(([v, t]) => h("option", { value: v, selected: v === (L.markers.dictionary || "auto") }, t)))),
      ),
      h("div", { class: "row" },
        h("button", { class: "btn small", type: "button", onclick: () => download(`${slug(L.name)}.json`, JSON.stringify(w.toJSON(), null, 2) + "\n") }, "Export layout"),
        h("label", { class: "btn small", for: "layoutImport" }, "Import layout"), importInput,
        h("button", { class: "btn small", type: "button", onclick: () => this.app.resetLayout() }, "Reset to original"),
      ),
      h("p", { class: "hint" }, "Changes are kept in this browser. Export the layout to share it or to add it to the repository."),
    );
  }

  renderMarkers() {
    if (!this.el) return;
    const map = this.world.map;
    const rows = map.ids().map((id) => {
      const e = map.get(id);
      return h("tr", {}, h("td", {}, id), h("td", {}, e.x.toFixed(1)), h("td", {}, e.y.toFixed(1)), h("td", {}, `${toDeg(e.theta).toFixed(1)}°`),
        h("td", {}, id === map.anchor ? "origin" : e.fixed ? "fixed" : "surveyed"));
    });
    morph(this.el.markers,
      h("h2", {}, "Marker map ", h("span", { class: "count" }, `(${map.ids().length})`)),
      h("p", { class: "hint" }, "Positions of the markers on the layout (mm). Unknown markers are measured automatically when they are seen together with known ones."),
      rows.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["ID", "X", "Y", "Rotation", "Status"].map((t) => h("th", {}, t)))), h("tbody", {}, rows))) : h("p", { class: "hint" }, "No markers known yet."),
      h("div", { class: "row" },
        h("button", { class: "btn small", type: "button", onclick: () => { map.fixAll(); this.app.saveLayout(); this.renderMarkers(); toast("Marker positions kept."); } }, "Keep positions"),
        h("button", { class: "btn small", type: "button", onclick: () => { this.app.tracker.resurvey(); this.app.redetect(); this.app.saveLayout(); this.renderMarkers(); toast("Surveyed markers cleared. They are measured again."); } }, "Measure again"),
      ),
      this._surveyBlock(),
    );
  }

  /* ---------------------------------------------------------------- survey a video */

  _surveyBlock() {
    const st = this.surveyState;
    const input = h("input", { type: "file", id: "surveyVideo", accept: "video/*", class: "visually-hidden",
      onchange: (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) this.startSurvey(f); } });
    const head = [
      h("h3", { class: "subhead" }, "Survey a video"),
      h("p", { class: "hint" }, "Film the whole layout slowly with all markers in view now and then, then let the app measure every marker in the video. Afterwards press Keep positions and export the layout: it is then fixed. See the lab-session guide (docs/lab-session.md)."),
    ];
    if (!st) {
      return h("div", { class: "survey" }, head, h("div", { class: "row" }, h("label", { class: "btn small primary", for: "surveyVideo" }, "Survey a video…"), input));
    }
    const p = st.progress;
    const plot = h("div", { class: "plot" });
    plot.innerHTML = markerPlotSvg(this.world.map, st.survey.seen);
    if (st.running) {
      return h("div", { class: "survey", "aria-busy": "true" }, head,
        h("progress", { max: p?.total || 1, value: p?.frame || 0, "aria-label": "Survey progress" }),
        h("p", { class: "hint", role: "status" }, p ? `${st.name}: frame ${p.frame} of ${p.total} · ${p.markers} markers known · ${p.used.length} in view` : `${st.name}: opening the video…`),
        plot,
        h("div", { class: "row" }, h("button", { class: "btn small", type: "button", onclick: () => st.survey.cancel() }, "Cancel")),
      );
    }
    const r = st.result;
    const rare = r ? [...r.seen].filter(([, n]) => n < 5).map(([id]) => id) : [];
    return h("div", { class: "survey" }, head,
      st.error ? h("p", { class: "hint error", role: "alert" }, `${st.name}: ${st.error}`) : null,
      r ? h("p", { class: "hint", role: "status" },
        `${st.name}: ${r.cancelled ? "cancelled after" : "done,"} ${r.frames} frames analysed, ${r.tracked} with the layout in view; ${r.markers.length} markers known.`,
        rare.length ? ` Seen fewer than 5 times (check or film again): ${rare.join(", ")}.` : "") : null,
      plot,
      h("div", { class: "row" },
        h("button", { class: "btn small primary", type: "button", onclick: () => { this.world.map.fixAll(); this.app.saveLayout(); this.renderMarkers(); toast("Marker positions kept: the layout is fixed."); } }, "Keep positions"),
        h("button", { class: "btn small", type: "button", onclick: () => download(`${slug(this.world.layout.name)}.json`, JSON.stringify(this.world.toJSON(), null, 2) + "\n") }, "Export layout"),
        h("label", { class: "btn small", for: "surveyVideo" }, "Survey another video…"), input,
      ),
    );
  }

  /** Measure the marker map from a video file (Build → Marker map). */
  async startSurvey(file) {
    if (this.surveyState?.running) return;
    if (!this.app.detector) return toast("Marker detection is not available.");
    const survey = new VideoSurvey({
      world: this.world, detector: this.app.detector, source: file,
      onProgress: (p) => {
        st.progress = p;
        const now = performance.now();
        if (now - (st.drawn || 0) > 250) {
          st.drawn = now;
          this.renderMarkers();
        }
      },
    });
    const st = (this.surveyState = { running: true, survey, progress: null, result: null, error: null, name: file.name || "video" });
    this.renderMarkers();
    try {
      st.result = await survey.run();
      toast(st.result.cancelled ? "Survey cancelled." : `Survey done: ${st.result.markers.length} markers. Press Keep positions to fix them.`, 6000);
    } catch (err) {
      st.error = err.message;
      toast(`The video could not be surveyed: ${err.message}`, 7000);
    } finally {
      st.running = false;
      this.app.saveLayout();
      if (this.surveyState === st) this.renderMarkers();
    }
  }
}

/** A small label (Dunkelblau board, white text) centred at an image point. */
function tag(ctx, at, text, px) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.font = `700 ${12 * px}px ${FONT}`;
  const w = ctx.measureText(text).width + 12 * px, hgt = 20 * px;
  ctx.fillStyle = OVERLAY.label;
  ctx.beginPath();
  ctx.roundRect?.(at[0] - w / 2, at[1] - hgt / 2, w, hgt, 4 * px);
  if (!ctx.roundRect) ctx.rect(at[0] - w / 2, at[1] - hgt / 2, w, hgt);
  ctx.fill();
  ctx.fillStyle = OVERLAY.labelText;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, at[0], at[1]);
  ctx.restore();
}

function slug(s) {
  return String(s || "layout").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "layout";
}
