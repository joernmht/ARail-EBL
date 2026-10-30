/**
 * The railway infrastructure as plain data for plans and for the exchange with other systems:
 * the format `rail-infra/1` (docs/rail-infra-format.md). ARail writes it from a layout; the EBL's
 * digital twin writes it from the lab files (its track plan and its hall plan). Both use the same
 * vocabulary of element types and the same keys: a track is named as in the control system, an
 * element by the name it carries on the layout, and where the line kilometre is known, an element
 * is at a kilometre on its track. The plan view (web/plan/) draws any such file as a sheet.
 * @module arail/plan/infra
 */
import { resolvePoint, resolvePoints, resolveSegment } from "../core/anchors.js";

/** The format identifier of the files. */
export const INFRA_FORMAT = "rail-infra/1";

/** Units of a frame: model or real millimetres, or lanes of a schematic track plan (one lane: the distance of two tracks). */
export const FRAME_UNITS = ["mm", "lane"];

/**
 * The element types, with what they are (and the German term of the rulebooks). Shared with the
 * EBL's digital twin (ebl_twin/infra.py): add a type in both.
 */
export const ELEMENT_TYPES = {
  signal: { label: "Signal", de: "Signal", kinds: ["main", "distant", "combined", "shunting", "block"] },
  switch: { label: "Switch", de: "Weiche" },
  "buffer-stop": { label: "Buffer stop", de: "Prellbock" },
  "km-post": { label: "Kilometre post", de: "Hektometertafel" },
  "stop-board": { label: "Stop board", de: "Haltetafel" },
  "speed-sign": { label: "Speed sign", de: "Geschwindigkeitssignal (Lf)" },
  "level-crossing": { label: "Level crossing", de: "Bahnübergang" },
  balise: { label: "Balise", de: "Balise / Gleismagnet" },
  "train-protection": { label: "Train protection point", de: "Zugbeeinflussung (Wechsel, Blockkennzeichen)" },
  derailer: { label: "Derailer", de: "Gleissperre" },
  "catenary-end": { label: "End of catenary", de: "Fahrleitungsende" },
  "section-insulator": { label: "Section insulator", de: "Streckentrenner" },
  "swing-bridge": { label: "Swing bridge", de: "Drehbrücke" },
  "system-change": { label: "System change", de: "Systemwechsel" },
  interlocking: { label: "Interlocking", de: "Stellwerk" },
  "passenger-display": { label: "Passenger display", de: "Zugzielanzeiger" },
  "gsmr-mast": { label: "GSM-R mast", de: "GSM-R-Mast" },
  lift: { label: "Lift", de: "Aufzug" },
  "maintenance-base": { label: "Maintenance base", de: "Instandhaltungsstützpunkt" },
  catenary: { label: "Overhead line", de: "Oberleitung", linear: true },
  "cable-route": { label: "Cable route", de: "Kabeltrasse", linear: true },
  other: { label: "Other", de: "Sonstiges" },
};

/** ARail's object types → element types (the rest of the layout is not infrastructure). */
const FROM_LAYOUT = {
  signal: "signal", switch: "switch", balise: "balise", "level-crossing": "level-crossing", "crossing-plant": "level-crossing",
  "gsmr-mast": "gsmr-mast", lift: "lift", "passenger-display": "passenger-display", interlocking: "interlocking",
  "maintenance-base": "maintenance-base", "system-change": "system-change", catenary: "catenary", "cable-route": "cable-route",
};

const r1 = (v) => Math.round(v * 10) / 10;
const pt = (p) => [r1(p[0]), r1(p[1])];
const finite = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** The marker map of a layout file: id → pose (mm, radians), from `markers.poses`. */
export function markerMapOf(json) {
  const map = new Map();
  for (const [id, p] of Object.entries(json?.markers?.poses || {})) {
    if (Array.isArray(p)) map.set(Number(id), { x: +p[0], y: +p[1], theta: ((+p[2] || 0) * Math.PI) / 180 });
  }
  return map;
}

/** The outline of a rectangle (centre, width, depth, rotation in degrees), counter-clockwise. */
function rectangle(c, w, d, deg = 0) {
  const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, y]) => pt([c[0] + cos * x - sin * y, c[1] + sin * x + cos * y]));
}

/**
 * The infrastructure of an ARail layout as a `rail-infra/1` document: tracks, platforms, signals,
 * switches and the other infrastructure objects, the table modules and the labels, in the layout
 * frame (model mm). Pass a composed layout (core/layers.js `composeLayout`) to have its modules in it.
 * @param {object} json the layout (a plain layout file, or `composeLayout(json).layout`)
 * @param {{name?: string, file?: string, date?: string}} [options] the document's name and where it came from
 */
export function layoutToInfra(json, { name, file = "", date = "" } = {}) {
  const map = markerMapOf(json);
  const objects = (Array.isArray(json?.objects) ? json.objects : []).filter((o) => o && typeof o.type === "string");
  const doc = {
    format: INFRA_FORMAT,
    name: name || json?.name || "Untitled layout",
    source: { generator: "arail", file, ...(date ? { date } : {}) },
    frame: { id: "layout", unit: "mm", scale: Number(json?.scale) || 87, note: "layout frame: model mm from the origin marker" },
    operating_points: [], tracks: [], platforms: [], elements: [], areas: [], labels: [],
  };
  for (const o of objects) {
    const at = o.position ? resolvePoint(map, o.position) : null;
    if (o.type === "track") {
      const points = resolvePoints(map, o.points);
      if (!points || points.length < 2) continue;
      doc.tracks.push({ id: o.id, name: o.name || o.track_id || "", track: o.track_id || "", points: points.map(pt), ...(o.virtual ? { virtual: true } : {}) });
    } else if (o.type === "platform") {
      const seg = resolveSegment(map, o);
      if (!seg) continue;
      const [a, b] = seg, len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], n = [-u[1], u[0]];
      const ext = +o.extend_mm || 0, off = +o.offset_mm || 0, w = +o.width_mm || 50;
      const p0 = [a[0] - u[0] * ext + n[0] * off, a[1] - u[1] * ext + n[1] * off], p1 = [b[0] + u[0] * ext + n[0] * off, b[1] + u[1] * ext + n[1] * off];
      const side = (p, s) => [p[0] + n[0] * s * w / 2, p[1] + n[1] * s * w / 2];
      doc.platforms.push({
        id: o.id, name: o.name || "", number: String(o.number ?? ""),
        tracks: [o.track_left, o.track_right].filter(Boolean),
        points: [side(p0, -1), side(p1, -1), side(p1, 1), side(p0, 1)].map(pt),
      });
    } else if (o.type === "tabletop") {
      const c = resolvePoint(map, o.position);
      if (c) doc.areas.push({ id: o.id, kind: "table", name: o.name || "", points: rectangle(c, +o.width_mm || 0, +o.depth_mm || 0, +o.rotation_deg || 0), ...(o.kind === "physical" ? {} : { virtual: true }) });
    } else if (o.type === "label" && at) {
      doc.labels.push({ id: o.id, text: String(o.text ?? ""), at: pt(at) });
    } else if (FROM_LAYOUT[o.type]) {
      const type = FROM_LAYOUT[o.type];
      const el = { id: o.id, type, name: o.name || "" };
      if (ELEMENT_TYPES[type].linear) {
        const points = resolvePoints(map, o.points);
        if (!points || points.length < 2) continue;
        el.points = points.map(pt);
      } else {
        if (!at) continue;
        el.at = pt(at);
        el.heading_deg = r1(+o.rotation_deg || 0);
      }
      if (type === "signal") Object.assign(el, { kind: o.kind || "main", side: o.side || "right" });
      if (type === "switch") Object.assign(el, { hand: o.hand || "left", length_m: +o.length_m || 33 });
      if (o.real) el.real = true;
      doc.elements.push(el);
    }
  }
  return doc;
}

/**
 * What is wrong with a `rail-infra/1` document: the format, the frame, unique ids, points that are
 * numbers, element types of the vocabulary, the tracks elements name. Empty if nothing is.
 * @param {object} doc
 * @returns {string[]}
 */
export function infraProblems(doc) {
  const out = [];
  if (!doc || typeof doc !== "object") return ["not a JSON object"];
  if (doc.format !== INFRA_FORMAT) out.push(`format is ${JSON.stringify(doc.format)}, not "${INFRA_FORMAT}"`);
  if (!FRAME_UNITS.includes(doc.frame?.unit)) out.push(`frame.unit must be one of ${FRAME_UNITS.join(", ")}`);
  const ids = new Set();
  const lists = ["operating_points", "tracks", "platforms", "elements", "areas", "labels"];
  for (const key of lists) {
    if (doc[key] === undefined) continue;
    if (!Array.isArray(doc[key])) {
      out.push(`${key} must be a list`);
      continue;
    }
    for (const [i, x] of doc[key].entries()) {
      const where = `${key}[${i}]${x?.id ? ` (${x.id})` : ""}`;
      if (!x || typeof x.id !== "string" || !x.id) out.push(`${where}: no id`);
      else if (ids.has(x.id)) out.push(`${where}: the id is used twice`);
      else ids.add(x.id);
      if (x?.at !== undefined && !finite(x.at)) out.push(`${where}: at is not [x, y]`);
      if (x?.points !== undefined && (!Array.isArray(x.points) || !x.points.every(finite))) out.push(`${where}: points are not [[x, y], …]`);
      if (x?.holes !== undefined && (!Array.isArray(x.holes) || !x.holes.every((h) => Array.isArray(h) && h.every(finite)))) out.push(`${where}: holes are not [[[x, y], …], …]`);
    }
  }
  const tracks = new Set((doc.tracks || []).map((t) => t.track).filter(Boolean));
  for (const t of doc.tracks || []) if (!(t.points?.length >= 2)) out.push(`tracks (${t.id}): fewer than two points`);
  for (const e of doc.elements || []) {
    if (!ELEMENT_TYPES[e.type]) out.push(`elements (${e.id}): unknown type ${JSON.stringify(e.type)}`);
    if (e.at === undefined && e.points === undefined) out.push(`elements (${e.id}): neither at nor points`);
    if (e.type === "signal" && e.kind && !ELEMENT_TYPES.signal.kinds.includes(e.kind)) out.push(`elements (${e.id}): unknown signal kind ${JSON.stringify(e.kind)}`);
    if (e.track && !tracks.has(String(e.track))) out.push(`elements (${e.id}): no track ${JSON.stringify(e.track)}`);
  }
  return out;
}

/**
 * The bounding box of everything drawn, [x0, y0, x1, y1] in the frame's unit; null if empty.
 * @param {object} doc
 */
export function infraBounds(doc) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p) => {
    if (!finite(p)) return;
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
  };
  for (const key of ["tracks", "platforms", "areas", "elements"]) for (const x of doc?.[key] || []) (x.points || []).forEach(add);
  for (const key of ["elements", "labels", "operating_points"]) for (const x of doc?.[key] || []) add(x.at);
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}
