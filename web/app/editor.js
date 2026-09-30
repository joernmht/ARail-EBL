// Build mode: place, select, move and edit layout objects on the camera image.
import { applyH, dist2, toDeg } from "../arail/index.js";
import { $, download, h, mount, paramFields, readFile, section, toast } from "./ui.js";

const CATEGORIES = ["Transport", "Scenery", "Infrastructure"];
const HINTS = {
  point: "Tap on the layout where it should go.",
  segment: "Tap the start and the end. Tap on a marker to anchor the end to it.",
  polygon: "Tap the corners one after the other, then press Finish.",
  polyline: "Tap the points along the line, then press Finish.",
};
export const SCALES = [
  [87, "H0 (1:87)"], [120, "TT (1:120)"], [160, "N (1:160)"], [220, "Z (1:220)"], [64, "S (1:64)"],
  [45, "0 (1:45)"], [32, "1 (1:32)"], [22.5, "G (1:22.5)"],
];

const round1 = (v) => Math.round(v * 10) / 10;

export class Editor {
  constructor(app) {
    this.app = app;
    this.selected = null;
    /** @type {{cls: any, points: Array<{xy?: number[], marker?: number}>, replace?: any} | null} */
    this.placing = null;
    this.drag = null;
    const c = app.canvas;
    c.addEventListener("pointerdown", (e) => this._down(e));
    c.addEventListener("pointermove", (e) => this._move(e));
    c.addEventListener("pointerup", (e) => this._up(e));
    c.addEventListener("pointercancel", (e) => this._up(e));
  }

  get world() {
    return this.app.world;
  }

  get active() {
    return this.app.activeTab === "build";
  }

  /* ---------------------------------------------------------------- canvas interaction */

  /** Pointer event -> layout point (mm), or null while the layout is not tracked. */
  toLayout(e) {
    const Hinv = this.app.tracker.state.Hinv;
    if (!Hinv) return null;
    const c = this.app.canvas, r = c.getBoundingClientRect();
    const u = ((e.clientX - r.left) * c.width) / r.width, v = ((e.clientY - r.top) * c.height) / r.height;
    const p = applyH(Hinv, [u, v]);
    return p.every(Number.isFinite) ? p : null;
  }

  /** Image pixels per layout mm around a layout point. */
  pxPerMM(p) {
    const H = this.app.tracker.state.H;
    const a = applyH(H, p), b = applyH(H, [p[0] + 10, p[1]]), c = applyH(H, [p[0], p[1] + 10]);
    return (dist2(a, b) + dist2(a, c)) / 20;
  }

  nearestMarker(p, radiusMM) {
    let best = null;
    for (const [id, e] of this.world.map.entries) {
      const d = Math.hypot(e.x - p[0], e.y - p[1]);
      if (d <= Math.max(radiusMM, this.world.map.sizeOf(id)) && (!best || d < best.d)) best = { id, d };
    }
    return best ? best.id : null;
  }

  hitTest(p) {
    const tol = (10 * this.app.px()) / Math.max(1e-6, this.pxPerMM(p));
    const objs = this.world.objects;
    // small objects on top of large ones: test point-like objects first
    const order = [...objs].reverse().sort((a, b) => (a.constructor.placement === "point" ? 0 : 1) - (b.constructor.placement === "point" ? 0 : 1));
    for (const o of order) if (o.geometry && o.contains(p, tol)) return o;
    return null;
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
      this._addPoint(p);
      return;
    }
    const hit = this.hitTest(p);
    this.select(hit);
    if (hit) {
      this.drag = { last: p, moved: false };
      this.app.canvas.setPointerCapture?.(e.pointerId);
      this.app.canvas.classList.add("dragging");
    }
  }

  _move(e) {
    if (!this.drag || !this.selected) return;
    const p = this.toLayout(e);
    if (!p) return;
    const dx = p[0] - this.drag.last[0], dy = p[1] - this.drag.last[1];
    if (Math.hypot(dx, dy) < 0.2) return;
    this.selected.translate(dx, dy);
    this.drag.last = p;
    this.drag.moved = true;
  }

  _up(e) {
    if (!this.drag) return;
    this.app.canvas.releasePointerCapture?.(e.pointerId);
    this.app.canvas.classList.remove("dragging");
    if (this.drag.moved) {
      this.app.saveLayout();
      this.renderInspector();
    }
    this.drag = null;
  }

  /* ---------------------------------------------------------------- placing */

  startPlacing(type, replace = null) {
    const cls = this.world.registry.objects.get(type);
    if (!cls) return;
    this.placing = { cls, points: [], replace };
    if (!replace) this.select(null);
    this.renderPlacing();
    this.renderPalette();
  }

  cancel() {
    this.placing = null;
    this.renderPlacing();
    this.renderPalette();
  }

  _addPoint(p) {
    const { cls } = this.placing;
    const marker = cls.placement === "segment" ? this.nearestMarker(p, 15) : null;
    this.placing.points.push(marker != null ? { marker } : { xy: [round1(p[0]), round1(p[1])] });
    const n = this.placing.points.length;
    if (cls.placement === "point" || (cls.placement === "segment" && n === 2)) this.finish();
    else this.renderPlacing();
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
    } else {
      const min = cls.placement === "polygon" ? 3 : 2;
      if (points.length < min) return toast(`Tap at least ${min} points.`);
      geo.points = points.map((q) => q.xy);
    }
    this.placing = null;
    let obj;
    if (replace) {
      replace.set(geo);
      obj = replace;
    } else {
      const spec = { type: cls.type, ...Object.fromEntries(Object.entries(geo).filter(([, v]) => v !== undefined)) };
      if (cls.params.some((p) => p.key === "rotation_deg") && geo.position) spec.rotation_deg = this._alignedRotation(geo.position);
      obj = this.world.addObject(spec);
      toast(`${cls.label} added. Drag it to move it, or change it on the right.`);
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

  deleteSelected() {
    if (!this.selected) return;
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
    copy.translate(this.world.scale > 0 ? copy.mm(5) : 20, copy.mm(5));
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
        ctx.strokeStyle = "rgba(242,169,59,0.95)";
        ctx.lineWidth = 2 * px;
        ctx.stroke();
        ctx.fillStyle = "#f2a93b";
        ctx.font = `700 ${12 * px}px Archivo, sans-serif`;
        ctx.fillText(String(id), q[0] + 16 * px, q[1] - 10 * px);
      }
    }
    if (!this.placing?.points.length) return;
    const pts = this.placing.points
      .map((q) => (q.marker != null ? this.world.map.get(q.marker) : { x: q.xy[0], y: q.xy[1] }))
      .map((e) => view.project(e.x, e.y, 0))
      .filter(Boolean);
    ctx.save();
    ctx.strokeStyle = "#f2a93b";
    ctx.fillStyle = "#f2a93b";
    ctx.lineWidth = 2.5 * px;
    ctx.setLineDash([8 * px, 5 * px]);
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    if (this.placing.cls.placement === "polygon" && pts.length > 2) ctx.closePath();
    ctx.stroke();
    for (const q of pts) {
      ctx.beginPath();
      ctx.arc(q[0], q[1], 5 * px, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------- panel */

  render(container) {
    this.el = {
      palette: h("div", { class: "palette" }),
      objects: h("div", { class: "list", role: "list" }),
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
      h("h4", {}, c),
      groups[c].map((cls) => h("button", {
        type: "button", "aria-pressed": this.placing?.cls === cls && !this.placing.replace ? "true" : "false", title: cls.description,
        onclick: () => (this.placing?.cls === cls ? this.cancel() : this.startPlacing(cls.type)),
      }, cls.label, h("small", {}, { point: "tap once", segment: "two ends", polygon: "outline", polyline: "line" }[cls.placement]))),
    ]));
  }

  renderPlacing() {
    const bar = $("#placing");
    if (!this.placing) {
      bar.hidden = true;
      return;
    }
    const { cls, points, replace } = this.placing;
    const multi = cls.placement === "polygon" || cls.placement === "polyline";
    mount(bar,
      h("span", { class: "grow" }, h("strong", {}, replace ? `Redraw ${replace.name}: ` : `${cls.label}: `), HINTS[cls.placement],
        points.length ? ` (${points.length} point${points.length > 1 ? "s" : ""})` : ""),
      multi ? h("button", { class: "btn small primary", type: "button", onclick: () => this.finish() }, "Finish") : null,
      points.length ? h("button", { class: "btn small", type: "button", onclick: () => { points.pop(); this.renderPlacing(); } }, "Undo point") : null,
      h("button", { class: "btn small", type: "button", onclick: () => this.cancel() }, "Cancel"),
    );
    bar.hidden = false;
  }

  renderObjects() {
    if (!this.el) return;
    const objs = this.world.objects;
    $("#objCount").textContent = objs.length ? `(${objs.length})` : "";
    mount(this.el.objects, objs.length
      ? objs.map((o) => h("button", {
        type: "button", role: "listitem", "aria-current": o === this.selected ? "true" : "false", onclick: () => this.select(o === this.selected ? null : o),
      }, h("span", {}, o.name), h("span", { class: "meta" }, o.geometry ? o.type : `${o.type} · not placed`)))
      : h("div", { class: "item" }, h("span", { class: "hint" }, "Nothing placed yet. Pick an object type above and tap on the layout.")));
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
    mount(this.el.inspector,
      h("h3", {}, `Selected: ${cls.label}`),
      cls.description ? h("p", { class: "hint" }, cls.description) : null,
      paramFields(cls.params, o.spec, change, { idPrefix: `obj-${o.id}`, world: this.world }),
      geo,
      h("div", { class: "row" },
        h("button", { class: "btn small", type: "button", onclick: () => this.startPlacing(o.type, o) }, "Redraw position"),
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
    if (Array.isArray(s.position)) {
      return h("div", { class: "fields" },
        num(`geo-${o.id}-x`, "X", s.position[0], (v) => o.set({ position: [v, s.position[1]] })),
        num(`geo-${o.id}-y`, "Y", s.position[1], (v) => o.set({ position: [s.position[0], v] })));
    }
    if (s.position && s.position.marker != null) {
      const off = s.position.offset || [0, 0];
      return h("div", { class: "fields" },
        h("p", { class: "hint wide" }, `Anchored to marker ${s.position.marker}: moves with it.`),
        num(`geo-${o.id}-dx`, "Offset X", off[0], (v) => o.set({ position: { ...s.position, offset: [v, off[1]] } })),
        num(`geo-${o.id}-dy`, "Offset Y", off[1], (v) => o.set({ position: { ...s.position, offset: [off[0], v] } })));
    }
    if (Array.isArray(s.between)) {
      const ids = this.world.map.ids();
      const sel = (i) => h("label", { class: "field", for: `geo-${o.id}-m${i}` }, h("span", {}, i ? "End marker" : "Start marker"),
        h("select", { id: `geo-${o.id}-m${i}`, onchange: (e) => { const b = [...s.between]; b[i] = Number(e.target.value); o.set({ between: b }); this.app.saveLayout(); } },
          [...new Set([...ids, ...s.between])].map((m) => h("option", { value: m, selected: m === s.between[i] }, `Marker ${m}`))));
      return h("div", { class: "fields" }, sel(0), sel(1));
    }
    if (Array.isArray(s.points)) return h("p", { class: "hint" }, `${s.points.length} points. Use “Redraw position” to change the outline.`);
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
      h("h3", {}, "Layout"),
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
    mount(this.el.markers,
      h("h3", {}, "Marker map ", h("span", { class: "count" }, `(${map.ids().length})`)),
      h("p", { class: "hint" }, "Positions of the markers on the layout (mm). Unknown markers are measured automatically when they are seen together with known ones."),
      rows.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["ID", "X", "Y", "Rotation", "Status"].map((t) => h("th", {}, t)))), h("tbody", {}, rows))) : h("p", { class: "hint" }, "No markers known yet."),
      h("div", { class: "row" },
        h("button", { class: "btn small", type: "button", onclick: () => { map.fixAll(); this.app.saveLayout(); this.renderMarkers(); toast("Marker positions kept."); } }, "Keep positions"),
        h("button", { class: "btn small", type: "button", onclick: () => { this.app.tracker.resurvey(); this.app.redetect(); this.app.saveLayout(); this.renderMarkers(); toast("Surveyed markers cleared. They are measured again."); } }, "Measure again"),
      ),
    );
  }
}

function slug(s) {
  return String(s || "layout").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "layout";
}
