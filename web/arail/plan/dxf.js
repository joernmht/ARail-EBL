/**
 * A `rail-infra/1` document as a DXF drawing (ASCII, AutoCAD R12), for CAD programs: the plan in
 * model space at its true size (frame mm; a schematic plan at `frame.lane_mm` per lane, else 10 mm),
 * one layer per kind of thing, so a CAD user can switch them, restyle them and draw on.
 * @module arail/plan/dxf
 */
import { ELEMENT_TYPES, cleanInfra, infraBounds } from "./infra.js";

/** The DXF layers: name, ACI colour (7: black/white), line type. */
export const DXF_LAYERS = {
  AREAS: [8, "CONTINUOUS"], TRACKS: [7, "CONTINUOUS"], TRACKS_HIDDEN: [8, "DASHED"], LINKS: [7, "CONTINUOUS"],
  PLATFORMS: [3, "CONTINUOUS"], SIGNALS: [1, "CONTINUOUS"], SWITCHES: [5, "CONTINUOUS"], ELEMENTS: [6, "CONTINUOUS"],
  KM: [9, "CONTINUOUS"], NAMES: [7, "CONTINUOUS"], OPERATING_POINTS: [4, "DASHDOT"],
};

const n = (v) => (Math.round(v * 1000) / 1000).toString();

/**
 * A text for R12, which knows no UTF-8: the file says it is ANSI_1252 ($DWGCODEPAGE), and every
 * character beyond ASCII is written as \U+XXXX (AutoCAD, BricsCAD, LibreCAD and ezdxf read it).
 * Soft hyphens are left out, line breaks become spaces.
 */
export function dxfText(s) {
  let out = "";
  for (const ch of String(s ?? "").replace(/\u00ad/g, "").replace(/[\r\n]+/g, " ")) {
    const c = ch.codePointAt(0);
    out += c < 0x80 ? ch : c > 0xffff ? "?" : `\\U+${c.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return out;
}

/**
 * The DXF text of a document.
 * @param {object} doc
 * @param {{text_mm?: number}} [options] text height in model mm (by default 1/150 of the plan's width)
 * @returns {string}
 */
export function toDXF(doc, { text_mm } = {}) {
  doc = cleanInfra(doc);
  const f = doc.frame.unit === "lane" ? Number(doc.frame.lane_mm) || 10 : 1;
  const P = (p) => [p[0] * f, p[1] * f];
  const out = [];
  const g = (code, value) => out.push(String(code), String(value));
  // the extents of everything in it: tracks, rooms and tables, platforms, elements, names
  const b = infraBounds(doc) || [0, 0, 1000, 1000];
  const [x0, y0, x1, y1] = b.map((v) => v * f);
  const h = text_mm || Math.max(1, Math.max(x1 - x0, y1 - y0) / 150);

  g(0, "SECTION"); g(2, "HEADER");
  g(9, "$ACADVER"); g(1, "AC1009");
  g(9, "$DWGCODEPAGE"); g(3, "ANSI_1252");
  g(9, "$EXTMIN"); g(10, n(x0)); g(20, n(y0));
  g(9, "$EXTMAX"); g(10, n(x1)); g(20, n(y1));
  g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "TABLES");
  g(0, "TABLE"); g(2, "LTYPE"); g(70, 3);
  for (const [name, desc, pattern] of [["CONTINUOUS", "Solid line", []], ["DASHED", "__ __ __", [h * 2, -h]], ["DASHDOT", "__ . __ .", [h * 3, -h * 0.6, 0, -h * 0.6]]]) {
    g(0, "LTYPE"); g(2, name); g(70, 0); g(3, desc); g(72, 65); g(73, pattern.length); g(40, n(pattern.reduce((s, v) => s + Math.abs(v), 0)));
    for (const v of pattern) g(49, n(v));
  }
  g(0, "ENDTAB");
  g(0, "TABLE"); g(2, "LAYER"); g(70, Object.keys(DXF_LAYERS).length);
  for (const [name, [colour, ltype]] of Object.entries(DXF_LAYERS)) {
    g(0, "LAYER"); g(2, name); g(70, 0); g(62, colour); g(6, ltype);
  }
  g(0, "ENDTAB");
  g(0, "ENDSEC");

  g(0, "SECTION"); g(2, "ENTITIES");
  const polyline = (layer, pts, closed = false) => {
    if (!(pts?.length > 1)) return;
    g(0, "POLYLINE"); g(8, layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0);
    for (const p of pts) {
      const [x, y] = P(p);
      g(0, "VERTEX"); g(8, layer); g(10, n(x)); g(20, n(y)); g(30, 0);
    }
    g(0, "SEQEND"); g(8, layer);
  };
  const line = (layer, a, b) => {
    g(0, "LINE"); g(8, layer); g(10, n(a[0])); g(20, n(a[1])); g(30, 0); g(11, n(b[0])); g(21, n(b[1])); g(31, 0);
  };
  const circle = (layer, c, r) => {
    g(0, "CIRCLE"); g(8, layer); g(10, n(c[0])); g(20, n(c[1])); g(30, 0); g(40, n(r));
  };
  const text = (layer, p, s, size = h, rot = 0) => {
    if (!s) return;
    g(0, "TEXT"); g(8, layer); g(10, n(p[0])); g(20, n(p[1])); g(30, 0); g(40, n(size)); g(1, dxfText(s));
    if (rot) g(50, n(rot));
  };

  for (const a of doc.areas) {
    polyline("AREAS", a.points, true);
    for (const hole of a.holes || []) polyline("AREAS", hole, true);
  }
  for (const p of doc.platforms) polyline("PLATFORMS", p.points, true);
  for (const t of doc.tracks) {
    polyline(t.kind === "link" ? "LINKS" : t.virtual || t.hidden ? "TRACKS_HIDDEN" : "TRACKS", t.points);
    if (t.name && t.kind !== "link" && t.points?.length > 1) {
      const i = Math.floor((t.points.length - 1) / 2), a = P(t.points[i]), b = P(t.points[i + 1]);
      let rot = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      if (rot > 90) rot -= 180;
      if (rot < -90) rot += 180;
      text("NAMES", [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + h * 0.4], t.name, h * 0.8, rot);
    }
  }
  for (const e of doc.elements) {
    const layer = e.type === "signal" ? "SIGNALS" : e.type === "switch" ? "SWITCHES" : "ELEMENTS";
    if (e.points?.length > 1) {
      polyline(layer, e.points);
      continue;
    }
    if (!e.at) continue;
    const c = P(e.at), a = ((e.heading_deg || 0) * Math.PI) / 180, u = [Math.cos(a), Math.sin(a)];
    const at = (s, v = 0) => [c[0] + u[0] * s * h + u[1] * v * h, c[1] + u[1] * s * h - u[0] * v * h];
    if (e.type === "signal") {
      // the foot reaches from the mast to the track: to the left of a signal on the right of it
      line(layer, at(0), at(0, e.side === "left" ? 1 : -1));
      line(layer, at(0), at(1.5));
      circle(layer, at(2), h * 0.5);
    } else if (e.type === "switch") {
      const side = e.hand === "right" ? 1 : -1;
      line(layer, at(0), at(2.5, 1 * side));
    } else circle(layer, c, h * 0.35);
    const label = e.name || ELEMENT_TYPES[e.type]?.label || "";
    text("NAMES", [c[0] + h * 0.6, c[1] + h * 0.6], label, h * 0.7);
    if (Number.isFinite(e.km)) text("KM", [c[0] + h * 0.6, c[1] - h * 0.6], `km ${Number(e.km).toFixed(3)}`, h * 0.5);
  }
  for (const o of doc.operating_points) {
    if (o.box) polyline("OPERATING_POINTS", [[o.box[0], o.box[1]], [o.box[2], o.box[1]], [o.box[2], o.box[3]], [o.box[0], o.box[3]]], true);
    const at = o.at || (o.box ? [(o.box[0] + o.box[2]) / 2, o.box[3]] : null);
    if (at) text("OPERATING_POINTS", P(at), o.name ? `${o.name} (${o.id})` : o.id, h * 1.6);
  }
  for (const l of doc.labels) text("NAMES", P(l.at), l.text, h * 1.2);
  g(0, "ENDSEC");
  g(0, "EOF");
  return out.join("\n") + "\n";
}
