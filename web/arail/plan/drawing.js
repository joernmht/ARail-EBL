/**
 * A `rail-infra/1` document drawn as a plan sheet, the way a CAD drawing is plotted: a trimmed sheet
 * of ISO paper (A4 to A0, landscape) with the drawing frame and its zone fields (ISO 5457), the title
 * block (ISO 7200), a legend of the symbols used, a scale bar, and the plan at a standard scale
 * (1:n). A schematic track plan (frame unit "lane") is drawn at so many millimetres per lane. Where
 * the plan does not fit one sheet at the scale chosen, it is cut into sheets.
 *
 * The result is a string of SVG in paper millimetres, so it works in Node and in the browser, and a
 * printer prints it at its true size. Black ink on white, line widths of ISO 128.
 * @module arail/plan/drawing
 */
import { CD, FONT, grey } from "../core/colors.js";
import { ELEMENT_TYPES, infraBounds } from "./infra.js";

/** Trimmed ISO sheets, landscape: width and height in mm. */
export const PAPERS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] };

/** Standard scales 1:n (ISO 5455) for frames in mm. */
export const SCALES = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];

/** Paper mm per lane for a schematic track plan; below the smallest the tracks run together. */
export const LANE_SCALES = [2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20];

/** Paper mm per lane of a schematic plan that needs more than one sheet, unless chosen. */
export const LANE_AUTO_MM = 4;

/** The layers of the drawing, which can be switched on and off. */
export const DRAWING_LAYERS = [
  { id: "areas", label: "Tables and rooms" },
  { id: "tracks", label: "Tracks" },
  { id: "platforms", label: "Platforms" },
  { id: "elements", label: "Signals, switches and other elements" },
  { id: "km", label: "Kilometres" },
  { id: "names", label: "Names" },
  { id: "grid", label: "Coordinate grid" },
];

/** Line widths in mm (ISO 128-20). */
export const LINE_MM = { fine: 0.13, thin: 0.18, narrow: 0.25, medium: 0.35, wide: 0.5, frame: 0.7 };

const INK = CD.black, PAPER_COLOUR = CD.white, SHADE = grey(0.88), VIRTUAL = grey(0.45);
/** Margins of the frame (ISO 5457): the filing margin at the left. */
const MARGIN = { left: 20, right: 10, top: 10, bottom: 10 };
const TITLE_W = 180, TITLE_H = 40, PAD = 4;

const f2 = (v) => (Math.round(v * 100) / 100).toString();
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const deg = (a) => (a * 180) / Math.PI;

/**
 * Where the parts of a sheet are on the paper (mm): the frame, the title block, the legend and the
 * viewport the plan is drawn in.
 * @param {string} paper a key of {@link PAPERS}
 */
export function sheetLayout(paper = "A3") {
  const [width, height] = PAPERS[paper] || PAPERS.A3;
  const frame = [MARGIN.left, MARGIN.top, width - MARGIN.right, height - MARGIN.bottom];
  const title = [frame[2] - TITLE_W, frame[3] - TITLE_H, frame[2], frame[3]];
  const legend = [frame[0], frame[3] - TITLE_H, title[0], frame[3]];
  const viewport = [frame[0] + PAD, frame[1] + PAD, frame[2] - PAD, frame[3] - TITLE_H - PAD];
  return { paper: PAPERS[paper] ? paper : "A3", width, height, frame, title, legend, viewport };
}

/**
 * The scale of the plan and how many sheets it needs: `k` is paper mm per unit of the frame.
 * "auto" chooses the largest standard scale at which the plan fits one sheet; a schematic plan
 * that would be too small for that keeps its lanes readable and is cut into sheets along x.
 * @param {number[]} bounds [x0, y0, x1, y1] in the frame's unit
 * @param {ReturnType<typeof sheetLayout>} layout
 * @param {string} unit "mm" or "lane"
 * @param {number|"auto"} [scale] 1:n for mm, paper mm per lane for "lane"
 * @returns {{k: number, scale: number, cols: number, rows: number}}
 */
export function fitScale(bounds, layout, unit, scale = "auto") {
  const [vx0, vy0, vx1, vy1] = layout.viewport, vw = vx1 - vx0, vh = vy1 - vy0;
  const w = Math.max(1e-9, bounds[2] - bounds[0]), h = Math.max(1e-9, bounds[3] - bounds[1]);
  let s = Number(scale);
  if (!(s > 0)) {
    const fit = Math.min(vw / w, vh / h); // paper mm per unit at which it just fits
    if (unit === "lane") {
      const fits = LANE_SCALES.filter((x) => x <= fit);
      // readable lanes: never below the smallest; too long for one sheet: cut into sheets along x
      // at LANE_AUTO_MM, or less where the height would not fit
      s = fits.length ? fits[fits.length - 1] : LANE_SCALES.filter((x) => x <= Math.min(LANE_AUTO_MM, vh / h)).pop() ?? LANE_SCALES[0];
    } else s = SCALES.find((n) => 1 / n <= fit) ?? SCALES[SCALES.length - 1];
  }
  const k = unit === "lane" ? s : 1 / s;
  return { k, scale: s, cols: Math.max(1, Math.ceil((w * k) / vw - 1e-9)), rows: Math.max(1, Math.ceil((h * k) / vh - 1e-9)) };
}

/** A nice step (1, 2 or 5 × 10^n) of at least `min`. */
function niceStep(min) {
  const p = 10 ** Math.floor(Math.log10(min));
  return [1, 2, 5, 10].map((m) => m * p).find((x) => x >= min - 1e-12);
}

/** Labels that keep clear of each other: a box is placed only where no other one is. */
class Clearance {
  constructor() {
    this.boxes = [];
  }

  /** Take the box [x0, y0, x1, y1] (paper mm) if it is free; true if it was. */
  take(b) {
    if (this.boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) return false;
    this.boxes.push(b);
    return true;
  }
}

/** The approximate width of a text in mm (Noto Sans: about 0.56 of its height per letter). */
const textWidth = (s, size) => String(s).length * size * 0.56;

/**
 * One sheet of the plan as SVG.
 * @param {object} doc a `rail-infra/1` document
 * @param {{paper?: string, scale?: number|"auto", sheet?: number, layers?: Iterable<string>,
 *   title?: Record<string, string>, tr?: (s: string) => string, date?: string}} [options]
 *   `sheet` counts from 1; `layers` the ids of {@link DRAWING_LAYERS} to draw (all by default);
 *   `title` fields of the title block over those from the document (owner, title, subtitle, type,
 *   status, number, revision, author); `tr` translates the sheet's own texts
 * @returns {{svg: string, sheet: number, sheets: number, scale: number, k: number, scaleText: string, paper: string, legend: string[]}}
 */
export function drawSheet(doc, options = {}) {
  const tr = options.tr || ((s) => s);
  const layout = sheetLayout(options.paper);
  const unit = doc.frame?.unit === "lane" ? "lane" : "mm";
  const on = new Set(options.layers ?? DRAWING_LAYERS.map((l) => l.id));
  const bounds = infraBounds(doc) || [0, 0, 1000, 1000];
  const fit = fitScale(bounds, layout, unit, options.scale);
  const { k, cols, rows } = fit;
  const sheets = cols * rows, sheet = Math.min(sheets, Math.max(1, Math.round(options.sheet || 1)));
  const [vx0, vy0, vx1, vy1] = layout.viewport, vw = vx1 - vx0, vh = vy1 - vy0;
  // the window of this sheet in the frame: the plan centred on all the sheets together
  const col = (sheet - 1) % cols, row = Math.floor((sheet - 1) / cols);
  const cx = (bounds[0] + bounds[2]) / 2, cy = (bounds[1] + bounds[3]) / 2;
  const wx0 = cx - (cols * vw) / k / 2 + (col * vw) / k, wy1 = cy + (rows * vh) / k / 2 - (row * vh) / k;
  const P = (p) => [vx0 + (p[0] - wx0) * k, vy0 + (wy1 - p[1]) * k];
  const scaleText = unit === "lane" ? tr("Schematic, not to scale") : `1:${fit.scale}`;
  const clear = new Clearance();
  const used = new Set();
  const out = [];
  const add = (s) => out.push(s);
  const path = (pts, close = false) => pts.map((p, i) => `${i ? "L" : "M"}${f2(P(p)[0])} ${f2(P(p)[1])}`).join("") + (close ? "Z" : "");
  const text = (x, y, s, size, extra = "") => `<text x="${f2(x)}" y="${f2(y)}" font-size="${f2(size)}"${extra}>${esc(s)}</text>`;
  /** A label at a paper point unless it would cover another one. */
  const label = (x, y, s, size, { anchor = "start", weight = "", rotate = 0 } = {}) => {
    if (!s) return false;
    const w = textWidth(s, size), x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    if (!rotate && !clear.take([x0 - 0.3, y - size, x0 + w + 0.3, y + size * 0.3])) return false;
    add(text(x, y, s, size, `${anchor !== "start" ? ` text-anchor="${anchor}"` : ""}${weight ? ` font-weight="${weight}"` : ""}${rotate ? ` transform="rotate(${f2(rotate)} ${f2(x)} ${f2(y)})"` : ""}`));
    return true;
  };

  add(`<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}mm" height="${layout.height}mm" viewBox="0 0 ${layout.width} ${layout.height}" font-family='${FONT}' fill="${INK}">`);
  add(`<title>${esc(options.title?.title || doc.name || "")}</title><desc>${esc(`${tr("Plan sheet")} ${sheet}/${sheets}, ${scaleText}, ${layout.paper}`)}</desc>`);
  add(`<defs><pattern id="hatch" width="1.2" height="1.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.2" stroke="${INK}" stroke-width="${LINE_MM.fine}"/></pattern>`
    + `<clipPath id="view"><rect x="${vx0}" y="${vy0}" width="${f2(vw)}" height="${f2(vh)}"/></clipPath></defs>`);
  add(`<rect width="${layout.width}" height="${layout.height}" fill="${PAPER_COLOUR}"/>`);

  // ---------------------------------------------------------------- the plan, clipped to the viewport
  add(`<g clip-path="url(#view)" stroke-linecap="round" stroke-linejoin="round">`);
  if (on.has("grid") && unit === "mm") {
    const step = niceStep(25 / k); // a line every 25 mm or more on the paper
    add(`<g stroke="${grey(0.75)}" stroke-width="${LINE_MM.fine}" fill="none">`);
    const gx0 = Math.ceil(wx0 / step) * step, gy0 = Math.ceil((wy1 - vh / k) / step) * step;
    for (let x = gx0; x <= wx0 + vw / k; x += step) add(`<path d="M${f2(P([x, 0])[0])} ${vy0}V${vy1}"/>`);
    for (let y = gy0; y <= wy1; y += step) add(`<path d="M${vx0} ${f2(P([0, y])[1])}H${vx1}"/>`);
    add(`</g><g font-size="1.8" fill="${grey(0.4)}">`);
    for (let x = gx0; x <= wx0 + vw / k; x += step) add(text(P([x, 0])[0] + 0.6, vy1 - 0.8, f2(x)));
    for (let y = gy0; y <= wy1; y += step) add(text(vx0 + 0.8, P([0, y])[1] - 0.6, f2(y)));
    add(`</g>`);
  }
  if (on.has("areas")) {
    for (const a of doc.areas || []) {
      if (!(a.points?.length > 2)) continue;
      const holes = (a.holes || []).filter((h) => h?.length > 2).map((h) => path(h, true)).join("");
      add(`<path d="${path(a.points, true)}${holes}" fill-rule="evenodd" fill="${a.kind === "room" ? "none" : SHADE}" stroke="${a.virtual ? VIRTUAL : INK}" stroke-width="${LINE_MM.thin}"${a.virtual ? ' stroke-dasharray="3 1.5"' : ""}/>`);
      used.add(a.kind === "room" ? "@room" : "@table");
    }
  }
  if (on.has("platforms")) {
    for (const p of doc.platforms || []) {
      if (!(p.points?.length > 2)) continue;
      add(`<path d="${path(p.points, true)}" fill="url(#hatch)" stroke="${INK}" stroke-width="${LINE_MM.narrow}"/>`);
      used.add("@platform");
    }
  }
  if (on.has("tracks")) {
    for (const t of doc.tracks || []) {
      if (!(t.points?.length > 1)) continue;
      const dashed = t.virtual || t.hidden;
      add(`<path d="${path(t.points)}" fill="none" stroke="${dashed ? VIRTUAL : INK}" stroke-width="${t.kind === "link" ? LINE_MM.medium : LINE_MM.wide}"${dashed ? ' stroke-dasharray="2.5 1"' : ""}/>`);
      used.add(dashed ? "@virtual" : "@track");
    }
  }
  if (on.has("km")) drawKilometres(doc, P, k, add, label, tr, used);
  const names = []; // the elements' names, placed after the more important ones
  if (on.has("elements")) {
    for (const e of doc.elements || []) {
      if (e.points?.length > 1) {
        const style = e.type === "catenary" ? `stroke-dasharray="4 1 0.5 1"` : e.type === "swing-bridge" ? `stroke-opacity="0.35" stroke-width="2.4"` : `stroke-dasharray="1.5 1"`;
        add(`<path d="${path(e.points)}" fill="none" stroke="${INK}" stroke-width="${LINE_MM.thin}" ${style}/>`);
        used.add(e.type);
        if (on.has("names") && e.name) {
          const m = P(e.points[Math.floor(e.points.length / 2)]);
          label(m[0] + 1, m[1] - 1.2, e.name, 1.8);
        }
        continue;
      }
      if (!e.at) continue;
      const [x, y] = P(e.at);
      if (x < vx0 - 5 || x > vx1 + 5 || y < vy0 - 5 || y > vy1 + 5) continue;
      const a = (-(e.heading_deg || 0) * Math.PI) / 180; // paper: y points down
      const type = ELEMENT_TYPES[e.type] ? e.type : "other";
      add(symbol(type, e, x, y, a, k, doc));
      used.add(type === "signal" ? `signal:${e.kind || "main"}` : type);
      if (on.has("names") && e.name) names.push([x, y, shortName(e)]);
    }
  }
  if (on.has("names")) {
    for (const o of doc.operating_points || []) {
      const at = o.at || (o.box ? [(o.box[0] + o.box[2]) / 2, (o.box[1] + o.box[3]) / 2] : null);
      if (o.box) {
        const [a, b] = [P([o.box[0], o.box[3]]), P([o.box[2], o.box[1]])];
        add(`<rect x="${f2(a[0])}" y="${f2(a[1])}" width="${f2(b[0] - a[0])}" height="${f2(b[1] - a[1])}" fill="none" stroke="${INK}" stroke-width="${LINE_MM.thin}" stroke-dasharray="6 1.5 1 1.5"/>`);
        used.add("@op");
      }
      if (at) {
        const [x, y] = o.box ? P([at[0], o.box[3]]) : P(at);
        label(x, y - 1.6, o.id && o.name && o.id !== o.name ? `${o.name} (${o.id})` : o.name || o.id, 3.5, { anchor: "middle", weight: "700" });
      }
    }
    for (const l of doc.labels || []) {
      const [x, y] = P(l.at);
      label(x, y, l.text, 2.5, { anchor: "middle", weight: "600" });
    }
    for (const t of doc.tracks || []) {
      if (t.kind === "link" || !t.name || !(t.points?.length > 1)) continue;
      const [a, b] = longestSegment(t.points);
      const pa = P(a), pb = P(b), len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      if (len < textWidth(t.name, 2) + 4) continue;
      let ang = deg(Math.atan2(pb[1] - pa[1], pb[0] - pa[0]));
      if (ang > 90) ang -= 180;
      if (ang < -90) ang += 180;
      const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2;
      if (Math.abs(ang) < 1) label(mx, my - 0.9, t.name, 2, { anchor: "middle" });
      else label(mx, my - 0.9, t.name, 2, { anchor: "middle", rotate: ang });
    }
    for (const [x, y] of names) clear.take([x - 1.2, y - 1.2, x + 1.2, y + 1.2]);
    for (const [x, y, n] of names) label(x + 1.6, y - 1.6, n, 1.8) || label(x + 1.6, y + 3.2, n, 1.8);
  }
  add(`</g>`);
  // where the plan goes on: the neighbouring sheets at the viewport's edges
  if (sheets > 1) {
    add(`<g font-size="2.2" fill="${INK}">`);
    const next = (dc, dr) => (col + dc >= 0 && col + dc < cols && row + dr >= 0 && row + dr < rows ? row * cols + col + 1 + dr * cols + dc : 0);
    const cont = (n) => tr("continued on sheet {n}").replace("{n}", n);
    if (next(-1, 0)) add(text(vx0 + 1, (vy0 + vy1) / 2, `← ${cont(next(-1, 0))}`, 2.2));
    if (next(1, 0)) add(text(vx1 - 1, (vy0 + vy1) / 2, `${cont(next(1, 0))} →`, 2.2, ` text-anchor="end"`));
    if (next(0, -1)) add(text((vx0 + vx1) / 2, vy0 + 3, `↑ ${cont(next(0, -1))}`, 2.2, ` text-anchor="middle"`));
    if (next(0, 1)) add(text((vx0 + vx1) / 2, vy1 - 1, `↓ ${cont(next(0, 1))}`, 2.2, ` text-anchor="middle"`));
    add(`</g>`);
  }

  // ---------------------------------------------------------------- the sheet: frame, zones, title block, legend
  add(sheetFrame(layout));
  const legend = legendEntries(used, tr);
  add(drawLegend(layout, legend, tr));
  add(scaleBar(layout, unit, k, doc, tr));
  const t = { ...titleFields(doc, tr, options.date), ...(options.title || {}) };
  add(titleBlock(layout, t, { scaleText, sheet, sheets, frame: frameText(doc, tr) }, tr));
  add(`</svg>`);
  return { svg: out.join(""), sheet, sheets, scale: fit.scale, k, scaleText, paper: layout.paper, legend: legend.map((l) => l.label) };
}

/** An element's name as it stands on the plan: a signal's name without its kind ("Exit signal N1", "ASig 3N1"), a switch's number. */
function shortName(e) {
  return String(e.name).replace(/^(Exit|Entry|Block|Distant|Shunting|Main) signal\s+/i, "").replace(/^(?:[A-Z][a-z]{0,3})?Sig\.?\s+/, "").replace(/^Switch\s+/i, "");
}

/** The longest segment of a polyline (where its name goes). */
function longestSegment(pts) {
  let best = [pts[0], pts[1]], len = -1;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (l > len) [best, len] = [[pts[i - 1], pts[i]], l];
  }
  return best;
}

/** Kilometre ticks along the tracks that know their kilometres (`kms`, one per point), labelled where there is room. */
function drawKilometres(doc, P, k, add, label, tr, used) {
  const tracks = (doc.tracks || []).filter((t) => t.kind !== "link" && Array.isArray(t.kms) && t.kms.length === t.points?.length);
  if (!tracks.length) return;
  // paper mm per km, from the tracks themselves
  let mm = 0, km = 0;
  for (const t of tracks) {
    for (let i = 1; i < t.points.length; i++) {
      const a = P(t.points[i - 1]), b = P(t.points[i]);
      mm += Math.hypot(b[0] - a[0], b[1] - a[1]);
      km += Math.abs(t.kms[i] - t.kms[i - 1]);
    }
  }
  if (!(km > 0)) return;
  const step = [0.1, 0.2, 0.5, 1, 2, 5, 10].find((s) => (s * mm) / km >= 12) ?? 10;
  add(`<g stroke="${INK}" stroke-width="${LINE_MM.thin}">`);
  for (const t of tracks) {
    for (let i = 1; i < t.points.length; i++) {
      const k0 = t.kms[i - 1], k1 = t.kms[i];
      if (k0 === k1) continue;
      const lo = Math.min(k0, k1), hi = Math.max(k0, k1);
      for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) {
        const f = (v - k0) / (k1 - k0);
        const p = P([t.points[i - 1][0] + (t.points[i][0] - t.points[i - 1][0]) * f, t.points[i - 1][1] + (t.points[i][1] - t.points[i - 1][1]) * f]);
        const a = P(t.points[i - 1]), b = P(t.points[i]), len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const n = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
        add(`<path d="M${f2(p[0] - n[0])} ${f2(p[1] - n[1])}L${f2(p[0] + n[0])} ${f2(p[1] + n[1])}"/>`);
        label(p[0] + 0.5, p[1] + 2.6, v.toFixed(step < 1 ? 1 : 0), 1.6);
        used.add("@km");
      }
    }
  }
  add(`</g>`);
}

/**
 * The symbol of an element at paper point (x, y), its heading `a` (radians, paper: y down).
 * Simplified after the symbols of track plans (DB Ril 819.9002): a signal's foot and mast, its
 * screen at the end; the legend tells them apart.
 */
function symbol(type, e, x, y, a, k, doc) {
  const c = Math.cos(a), s = Math.sin(a);
  const at = (u, v) => [x + c * u - s * v, y + s * u + c * v]; // u along the heading, v to its right (paper)
  const M = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${f2(p[0])} ${f2(p[1])}`).join("");
  const sw = `stroke="${INK}" stroke-width="${LINE_MM.narrow}"`;
  const circle = (p, r, fill) => `<circle cx="${f2(p[0])}" cy="${f2(p[1])}" r="${f2(r)}" fill="${fill}" ${sw}/>`;
  switch (type) {
    case "signal": {
      const side = e.side === "left" ? -1 : 1, foot = at(0, 0), top = at(2.6, 0), head = at(3.5, 0);
      let g = `<path d="${M([at(0, -0.8 * side), at(0, 0.8 * side)])}${M([foot, top])}" fill="none" ${sw}/>`;
      const kind = e.kind || "main";
      if (kind === "main" || kind === "block") g += circle(head, 0.9, INK);
      if (kind === "block") g += circle(head, 1.4, "none");
      if (kind === "distant") g += circle(head, 0.9, PAPER_COLOUR) + `<path d="${M([at(2.9, -0.65), at(4.1, 0.65)])}" ${sw}/>`;
      if (kind === "combined") g += circle(head, 0.9, INK) + circle(at(5.3, 0), 0.9, PAPER_COLOUR);
      if (kind === "shunting") g += `<path d="${M([at(2.6, -0.9), at(4.4, -0.9), at(4.4, 0.9), at(2.6, 0.9)])}Z" fill="${PAPER_COLOUR}" ${sw}/><path d="${M([at(2.6, -0.9), at(4.4, 0.9), at(2.6, 0.9)])}Z" fill="${INK}"/>`;
      return `<g>${g}</g>`;
    }
    case "switch": {
      // the frog side: a filled wedge at the switch's toe, opening to its branch
      const len = e.length_m && doc.frame?.unit === "mm" ? Math.max(2.5, Math.min(12, ((e.length_m * 1000) / (doc.frame.scale || 87)) * k)) : 3.5;
      // its branch to the left or the right; not known: both sides
      const tip = e.hand === "right" ? [0, 0.42] : e.hand === "left" ? [-0.42, 0] : [-0.21, 0.21];
      return `<path d="${M([at(0, 0), at(len, len * tip[0]), at(len, len * tip[1])])}Z" fill="${INK}" stroke="none"/>`;
    }
    case "buffer-stop":
      return `<path d="${M([at(0, -1.2), at(0, 1.2)])}${M([at(-0.6, -1.2), at(-0.6, 1.2)])}" fill="none" stroke="${INK}" stroke-width="${LINE_MM.medium}"/>`;
    case "km-post":
      return `<path d="${M([at(0, 0), at(0, 2)])}" ${sw}/>${circle(at(0, 2.5), 0.5, PAPER_COLOUR)}`;
    case "stop-board":
      return `<path d="${M([at(0, 0), at(0, 1.4)])}" ${sw}/><rect x="${f2(at(0, 1.4)[0] - 0.8)}" y="${f2(at(0, 1.4)[1] - 0.8)}" width="1.6" height="1.6" fill="${PAPER_COLOUR}" ${sw}/><text x="${f2(at(0, 1.4)[0])}" y="${f2(at(0, 1.4)[1] + 0.45)}" font-size="1.2" text-anchor="middle" font-weight="700">H</text>`;
    case "speed-sign":
      return `<path d="${M([at(0, 0), at(0, 1.4)])}${M([at(-0.9, 1.4), at(0.9, 1.4), at(0, 3)])}Z" fill="${PAPER_COLOUR}" ${sw}/>`;
    case "level-crossing":
      return `<path d="${M([at(-1.6, -1.6), at(1.6, 1.6)])}${M([at(-1.6, 1.6), at(1.6, -1.6)])}" fill="none" stroke="${INK}" stroke-width="${LINE_MM.medium}"/>`;
    case "balise":
      return `<path d="${M([at(-0.7, -0.4), at(0.7, -0.4), at(0.7, 0.4), at(-0.7, 0.4)])}Z" fill="${INK}"/>`;
    case "train-protection":
      return `<path d="${M([at(-0.8, 0), at(0, -0.8), at(0.8, 0), at(0, 0.8)])}Z" fill="${PAPER_COLOUR}" ${sw}/>`;
    case "derailer":
      return `<path d="${M([at(-0.8, -1.2), at(0.8, 1.2)])}" ${sw}/>${circle(at(0.8, 1.2), 0.4, INK)}`;
    case "catenary-end":
      return `<path d="${M([at(0, 0), at(0, 2)])}${M([at(-1, 2), at(1, 2)])}" fill="none" ${sw}/>`;
    case "section-insulator":
      return `<path d="${M([at(-0.4, -1), at(-0.4, 1)])}${M([at(0.4, -1), at(0.4, 1)])}" fill="none" ${sw}/>`;
    case "swing-bridge":
      return circle([x, y], 1.6, "none") + `<path d="${M([at(-1.6, 0), at(1.6, 0)])}" ${sw}/>`;
    case "system-change":
      return `<path d="${M([at(0, -1.2), at(1.2, 0), at(0, 1.2), at(-1.2, 0)])}Z" fill="${PAPER_COLOUR}" ${sw}/><path d="${M([at(0, -1.2), at(0, 1.2)])}" ${sw}/>`;
    case "interlocking":
      return `<path d="${M([[x - 2, y - 1.3], [x + 2, y - 1.3], [x + 2, y + 1.3], [x - 2, y + 1.3]])}Z" fill="${PAPER_COLOUR}" ${sw}/><path d="${M([[x - 2, y + 1.3], [x + 2, y - 1.3], [x + 2, y + 1.3]])}Z" fill="${INK}"/>`;
    case "passenger-display":
      return `<path d="${M([at(-1.2, -0.5), at(1.2, -0.5), at(1.2, 0.5), at(-1.2, 0.5)])}Z" fill="${PAPER_COLOUR}" ${sw}/><path d="${M([at(-0.8, 0), at(0.8, 0)])}" stroke="${INK}" stroke-width="${LINE_MM.fine}"/>`;
    case "gsmr-mast":
      return `<path d="${M([[x - 1.1, y + 1.2], [x, y - 1.6], [x + 1.1, y + 1.2]])}${M([[x - 0.6, y], [x + 0.6, y]])}" fill="none" ${sw}/>`;
    case "lift":
      return `<path d="${M([[x - 1.1, y - 1.1], [x + 1.1, y - 1.1], [x + 1.1, y + 1.1], [x - 1.1, y + 1.1]])}Z${M([[x - 1.1, y - 1.1], [x + 1.1, y + 1.1]])}${M([[x - 1.1, y + 1.1], [x + 1.1, y - 1.1]])}" fill="${PAPER_COLOUR}" ${sw}/>`;
    case "maintenance-base":
      return `<path d="${M([[x - 1.8, y - 1.3], [x + 1.8, y - 1.3], [x + 1.8, y + 1.3], [x - 1.8, y + 1.3]])}Z" fill="url(#hatch)" ${sw}/>`;
    default:
      return circle([x, y], 0.7, PAPER_COLOUR);
  }
}

/** The legend's entries: what the sheet shows, in a fixed order. */
function legendEntries(used, tr) {
  const fixed = [["@track", "Track"], ["@virtual", "Track not on the real layout (virtual, hidden)"], ["@platform", "Platform"], ["@table", "Table module"], ["@room", "Room (outline)"], ["@op", "Operating point (station limits)"], ["@km", "Line kilometre"]];
  const kinds = { main: "Main signal", distant: "Distant signal", combined: "Main signal with distant signal", shunting: "Shunting signal", block: "Block signal" };
  const out = fixed.filter(([id]) => used.has(id)).map(([id, l]) => ({ id, label: tr(l) }));
  for (const [kind, l] of Object.entries(kinds)) if (used.has(`signal:${kind}`)) out.push({ id: `signal:${kind}`, label: tr(l) });
  for (const [type, t] of Object.entries(ELEMENT_TYPES)) if (type !== "signal" && used.has(type)) out.push({ id: type, label: tr(t.label) });
  return out;
}

/** The legend in the band left of the title block, in as many columns as fit. */
function drawLegend(layout, entries, tr) {
  const [x0, y0, x1, y1] = layout.legend;
  const g = [`<g><path d="M${x0} ${y0}H${x1}V${y1}" fill="none" stroke="${INK}" stroke-width="${LINE_MM.medium}"/>`];
  g.push(`<text x="${x0 + 2}" y="${y0 + 4}" font-size="2.5" font-weight="700">${esc(tr("Legend"))}</text>`);
  const colW = 64, rowH = 4.6, perCol = Math.max(1, Math.floor((y1 - y0 - 7) / rowH));
  const room = Math.max(1, Math.floor((x1 - x0 - 46) / colW)); // keep room for the scale bar at the right
  const shown = entries.slice(0, room * perCol);
  shown.forEach((en, i) => {
    const cx = x0 + 3 + Math.floor(i / perCol) * colW, cy = y0 + 9 + (i % perCol) * rowH;
    g.push(legendSymbol(en.id, cx + 4, cy - 0.9));
    g.push(`<text x="${f2(cx + 10)}" y="${f2(cy)}" font-size="2">${esc(en.label)}</text>`);
  });
  if (shown.length < entries.length) g.push(`<text x="${x0 + 3}" y="${y1 - 1.5}" font-size="1.8">${esc(tr("{n} more symbols").replace("{n}", entries.length - shown.length))}</text>`);
  g.push(`</g>`);
  return g.join("");
}

/** A legend entry's symbol at (x, y). */
function legendSymbol(id, x, y) {
  const line = (extra) => `<path d="M${f2(x - 3.5)} ${f2(y)}H${f2(x + 3.5)}" fill="none" ${extra}/>`;
  switch (id) {
    case "@track": return line(`stroke="${INK}" stroke-width="${LINE_MM.wide}"`);
    case "@virtual": return line(`stroke="${VIRTUAL}" stroke-width="${LINE_MM.wide}" stroke-dasharray="2.5 1"`);
    case "@platform": return `<rect x="${f2(x - 3.5)}" y="${f2(y - 1)}" width="7" height="2" fill="url(#hatch)" stroke="${INK}" stroke-width="${LINE_MM.narrow}"/>`;
    case "@table": return `<rect x="${f2(x - 3.5)}" y="${f2(y - 1.2)}" width="7" height="2.4" fill="${SHADE}" stroke="${INK}" stroke-width="${LINE_MM.thin}"/>`;
    case "@room": return `<rect x="${f2(x - 3.5)}" y="${f2(y - 1.2)}" width="7" height="2.4" fill="none" stroke="${INK}" stroke-width="${LINE_MM.thin}"/>`;
    case "@op": return `<rect x="${f2(x - 3.5)}" y="${f2(y - 1.2)}" width="7" height="2.4" fill="none" stroke="${INK}" stroke-width="${LINE_MM.thin}" stroke-dasharray="3 1 0.5 1"/>`;
    case "@km": return line(`stroke="${INK}" stroke-width="${LINE_MM.wide}"`) + `<path d="M${f2(x)} ${f2(y - 1)}V${f2(y + 1)}" stroke="${INK}" stroke-width="${LINE_MM.thin}"/>`;
    default: {
      const [type, kind] = id.split(":");
      const e = { type, kind, hand: "left", side: "right" };
      const sx = type === "signal" ? x - 2.5 : type === "switch" ? x - 1.7 : x;
      return (type === "signal" || type === "switch" ? line(`stroke="${INK}" stroke-width="${LINE_MM.wide}"`) : "") + symbol(type, e, sx, y, 0, 1, { frame: { unit: "lane" } });
    }
  }
}

/** The trimmed edge, the drawing frame, the zone fields (letters down, numbers across) and the centring marks. */
function sheetFrame(layout) {
  const { width: W, height: H, frame: [x0, y0, x1, y1] } = layout;
  const g = [`<g fill="none" stroke="${INK}">`];
  g.push(`<rect x="0.15" y="0.15" width="${W - 0.3}" height="${H - 0.3}" stroke-width="${LINE_MM.fine}"/>`);
  g.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" stroke-width="${LINE_MM.frame}"/>`);
  // the zones: about 50 mm, an even number along each side
  const nx = Math.max(2, 2 * Math.round((x1 - x0) / 100)), ny = Math.max(2, 2 * Math.round((y1 - y0) / 100));
  const dx = (x1 - x0) / nx, dy = (y1 - y0) / ny, o = 5;
  const lines = [];
  for (let i = 1; i < nx; i++) lines.push(`M${f2(x0 + i * dx)} ${y0}V${y0 - o}M${f2(x0 + i * dx)} ${y1}V${y1 + o}`);
  for (let j = 1; j < ny; j++) lines.push(`M${x0} ${f2(y0 + j * dy)}H${x0 - o}M${x1} ${f2(y0 + j * dy)}H${x1 + o}`);
  g.push(`<path d="${lines.join("")}" stroke-width="${LINE_MM.narrow}"/>`);
  // centring marks
  g.push(`<path d="M${W / 2} 0V${y0 + 5}M${W / 2} ${H}V${y1 - 5}M0 ${H / 2}H${x0 + 5}M${W} ${H / 2}H${x1 - 5}" stroke-width="${LINE_MM.frame}"/>`);
  g.push(`</g><g font-size="3" text-anchor="middle">`);
  for (let i = 0; i < nx; i++) {
    g.push(`<text x="${f2(x0 + (i + 0.5) * dx)}" y="${f2(y0 - 1.6)}">${i + 1}</text><text x="${f2(x0 + (i + 0.5) * dx)}" y="${f2(y1 + 3.6)}">${i + 1}</text>`);
  }
  for (let j = 0; j < ny; j++) {
    const ch = String.fromCharCode(65 + j);
    g.push(`<text x="${f2(x0 - 2.5)}" y="${f2(y0 + (j + 0.5) * dy + 1)}">${ch}</text><text x="${f2(x1 + 2.5)}" y="${f2(y0 + (j + 0.5) * dy + 1)}">${ch}</text>`);
  }
  g.push(`</g>`);
  return g.join("");
}

/** A scale bar at the right of the legend band (mm frames): a nice length in five parts, also in the prototype. */
function scaleBar(layout, unit, k, doc, tr) {
  const [, y0, x1] = layout.legend;
  const x = x1 - 44, y = y0 + 14;
  if (unit === "lane") {
    const lane = doc.frame?.lane_mm;
    const s = [`<g><text x="${f2(x)}" y="${f2(y - 6)}" font-size="2" font-weight="700">${esc(tr("Scale"))}</text>`];
    s.push(`<text x="${f2(x)}" y="${f2(y - 1.5)}" font-size="2">${esc(tr("Schematic, not to scale"))}</text>`);
    s.push(`<text x="${f2(x)}" y="${f2(y + 2.5)}" font-size="2">${esc(tr("1 lane = {mm} mm on the sheet").replace("{mm}", f2(k)))}</text>`);
    if (lane) s.push(`<text x="${f2(x)}" y="${f2(y + 6.5)}" font-size="2">${esc(tr("1 lane = {mm} mm on the layout").replace("{mm}", f2(lane)))}</text>`);
    s.push(`</g>`);
    return s.join("");
  }
  const len = niceStep(30 / k / 2) * 1; // about 15–30 mm of paper
  const mm = len * k, parts = 5;
  const g = [`<g><text x="${f2(x)}" y="${f2(y - 6)}" font-size="2" font-weight="700">${esc(tr("Scale"))}</text>`];
  for (let i = 0; i < parts; i++) g.push(`<rect x="${f2(x + (i * mm) / parts)}" y="${f2(y - 3.6)}" width="${f2(mm / parts)}" height="1.4" fill="${i % 2 ? PAPER_COLOUR : INK}" stroke="${INK}" stroke-width="${LINE_MM.fine}"/>`);
  const fmt = (v) => (v >= 1000 ? `${f2(v / 1000)} m` : `${f2(v)} mm`);
  g.push(`<text x="${f2(x)}" y="${f2(y + 0.6)}" font-size="1.8">0</text><text x="${f2(x + mm)}" y="${f2(y + 0.6)}" font-size="1.8" text-anchor="middle">${esc(fmt(len))}</text>`);
  const model = Number(doc.frame?.scale);
  if (model > 1) {
    const proto = (len * model) / 1000;
    g.push(`<text x="${f2(x)}" y="${f2(y + 4.4)}" font-size="1.8">${esc(tr("model scale 1:{n}, {m} m in the prototype").replace("{n}", model).replace("{m}", f2(proto)))}</text>`);
  }
  g.push(`</g>`);
  return g.join("");
}

/** The title block's fields from the document. */
function titleFields(doc, tr, date) {
  const src = doc.source || {};
  return {
    owner: src.owner || "ARail-EBL",
    title: doc.name || tr("Untitled plan"),
    subtitle: doc.frame?.note || "",
    type: doc.frame?.unit === "lane" ? tr("Track plan") : tr("Site plan"),
    status: tr("Generated"),
    number: src.number || "",
    revision: src.revision || "",
    author: src.generator ? tr("generated by {name}").replace("{name}", src.generator) : "",
    source: [src.file, src.date].filter(Boolean).join(" · "),
    date: date || src.date || "",
  };
}

/** The frame of the plan in words: its id and unit. */
function frameText(doc, tr) {
  const f = doc.frame || {};
  return `${f.id || "–"} (${f.unit === "lane" ? tr("lanes") : "mm"})`;
}

/**
 * The title block (ISO 7200), 180 mm wide, in the frame's lower right corner: owner, document type
 * and status; title and supplementary title, drawing number; scale, frame, sheet size, date,
 * revision, sheet; author and source.
 */
function titleBlock(layout, t, { scaleText, sheet, sheets, frame }, tr) {
  const [x0, y0] = layout.title;
  const rows = [8, 16, 8, 8];
  const ys = rows.reduce((a, h) => [...a, a[a.length - 1] + h], [y0]);
  const cells = [
    [0, 0, 90, "Legal owner", t.owner, 2.5], [0, 90, 135, "Document type", t.type, 2.5], [0, 135, 180, "Document status", t.status, 2.5],
    [1, 0, 135, "Title", t.title, 4.2, t.subtitle], [1, 135, 180, "Drawing number", t.number, 2.8],
    [2, 0, 30, "Scale", scaleText, 2.5], [2, 30, 75, "Frame", frame, 2.2], [2, 75, 100, "Sheet size", layout.paper, 2.5], [2, 100, 135, "Date of issue", t.date, 2.5],
    [2, 135, 150, "Rev.", t.revision, 2.5], [2, 150, 180, "Sheet", `${sheet}/${sheets}`, 2.5],
    [3, 0, 60, "Created by", t.author, 2.2], [3, 60, 180, "Source", t.source, 2.2],
  ];
  const g = [`<g><rect x="${x0}" y="${y0}" width="${TITLE_W}" height="${TITLE_H}" fill="${PAPER_COLOUR}" stroke="${INK}" stroke-width="${LINE_MM.frame}"/>`];
  const lines = [];
  for (let i = 1; i < rows.length; i++) lines.push(`M${x0} ${ys[i]}H${x0 + TITLE_W}`);
  for (const [r, a] of cells) if (a) lines.push(`M${x0 + a} ${ys[r]}V${ys[r + 1]}`);
  g.push(`<path d="${lines.join("")}" stroke="${INK}" stroke-width="${LINE_MM.narrow}" fill="none"/>`);
  for (const [r, a, b, name, value, size, sub] of cells) {
    const w = b - a - 2.4;
    g.push(`<text x="${f2(x0 + a + 1.2)}" y="${f2(ys[r] + 2.4)}" font-size="1.6" fill="${grey(0.3)}">${esc(tr(name))}</text>`);
    const fit = Math.min(size, w / Math.max(1, String(value ?? "").length * 0.56));
    if (value) g.push(`<text x="${f2(x0 + a + 1.2)}" y="${f2(ys[r] + (sub ? 8 : rows[r] - 1.6))}" font-size="${f2(fit)}"${size > 4 ? ' font-weight="700"' : ""}>${esc(value)}</text>`);
    if (sub) g.push(`<text x="${f2(x0 + a + 1.2)}" y="${f2(ys[r] + 13.4)}" font-size="${f2(Math.min(2.2, w / Math.max(1, sub.length * 0.56)))}">${esc(sub)}</text>`);
  }
  g.push(`</g>`);
  return g.join("");
}
