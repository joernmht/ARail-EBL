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
import { Platform } from "../objects/platform.js";
import { Tabletop } from "../objects/tabletop.js";
import { Switch } from "../infra/objects.js";

/** The format identifier of the files. */
export const INFRA_FORMAT = "rail-infra/1";

/** Units of a frame: model or real millimetres, or lanes of a schematic track plan (one lane: the distance of two tracks). */
export const FRAME_UNITS = ["mm", "lane"];

/**
 * The element types: what they are (their German names are the framework's translations of the
 * labels, web/arail/i18n/de/plan.js). Shared with the EBL's digital twin (ebl_twin/infra.py): add a
 * type in both.
 */
export const ELEMENT_TYPES = {
  signal: { label: "Signal", kinds: ["main", "distant", "combined", "shunting", "block"] },
  switch: { label: "Switch" },
  "buffer-stop": { label: "Buffer stop" },
  "km-post": { label: "Kilometre post" },
  "stop-board": { label: "Stop board" },
  "speed-sign": { label: "Speed sign" },
  "level-crossing": { label: "Level crossing" },
  balise: { label: "Balise" },
  "train-protection": { label: "Train protection point" },
  derailer: { label: "Derailer" },
  "catenary-end": { label: "End of catenary" },
  "section-insulator": { label: "Section insulator" },
  "swing-bridge": { label: "Swing bridge" },
  "system-change": { label: "System change" },
  interlocking: { label: "Interlocking" },
  "passenger-display": { label: "Passenger display" },
  "gsmr-mast": { label: "GSM-R mast" },
  lift: { label: "Lift" },
  "maintenance-base": { label: "Maintenance base" },
  catenary: { label: "Overhead line", linear: true },
  "cable-route": { label: "Cable route", linear: true },
  other: { label: "Other" },
};

/** ARail's object types → element types (the rest of the layout is not infrastructure). */
const FROM_LAYOUT = {
  signal: "signal", switch: "switch", balise: "balise", "level-crossing": "level-crossing", "crossing-plant": "level-crossing",
  "gsmr-mast": "gsmr-mast", lift: "lift", "passenger-display": "passenger-display", interlocking: "interlocking",
  "maintenance-base": "maintenance-base", "system-change": "system-change", catenary: "catenary", "cable-route": "cable-route",
};

/** The lists of a document. */
const LISTS = ["operating_points", "tracks", "platforms", "elements", "areas", "labels"];

const r1 = (v) => Math.round(v * 10) / 10;
const pt = (p) => [r1(p[0]), r1(p[1])];
const finite = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const isObject = (x) => !!x && typeof x === "object" && !Array.isArray(x);
/** A list of a document as it can be drawn: its entries that are objects. */
const entries = (list) => (Array.isArray(list) ? list.filter(isObject) : []);
/** The default of a setting of an ARail object type, as the app uses it. */
const defaultOf = (Type, key) => Type.params.find((p) => p.key === key)?.default;

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
  let unplaced = 0; // objects whose markers are not in the marker map (moving markers): not on the plan
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
    if (o.position && !at) unplaced++;
    if (o.type === "track") {
      const points = resolvePoints(map, o.points);
      if (!points) unplaced++;
      if (!points || points.length < 2) continue;
      doc.tracks.push({ id: o.id, name: o.name || o.track_id || "", track: o.track_id || "", points: points.map(pt), ...(o.virtual ? { virtual: true } : {}) });
    } else if (o.type === "platform") {
      const seg = resolveSegment(map, o);
      if (!seg) {
        unplaced++;
        continue;
      }
      const [a, b] = seg, len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], n = [-u[1], u[0]];
      const ext = +o.extend_mm || 0, off = +o.offset_mm || 0, w = +o.width_mm || defaultOf(Platform, "width_mm");
      const p0 = [a[0] - u[0] * ext + n[0] * off, a[1] - u[1] * ext + n[1] * off], p1 = [b[0] + u[0] * ext + n[0] * off, b[1] + u[1] * ext + n[1] * off];
      const side = (p, s) => [p[0] + n[0] * s * w / 2, p[1] + n[1] * s * w / 2];
      doc.platforms.push({
        id: o.id, name: o.name || "", number: String(o.number ?? ""),
        tracks: [o.track_left, o.track_right].filter(Boolean),
        points: [side(p0, -1), side(p1, -1), side(p1, 1), side(p0, 1)].map(pt),
      });
    } else if (o.type === "tabletop") {
      if (at) {
        const w = +o.width_mm || defaultOf(Tabletop, "width_mm"), d = +o.depth_mm || defaultOf(Tabletop, "depth_mm");
        doc.areas.push({ id: o.id, kind: "table", name: o.name || "", points: rectangle(at, w, d, +o.rotation_deg || 0), ...(o.kind === "physical" ? {} : { virtual: true }) });
      }
    } else if (o.type === "label" && at) {
      doc.labels.push({ id: o.id, text: String(o.text ?? ""), at: pt(at) });
    } else if (FROM_LAYOUT[o.type]) {
      const type = FROM_LAYOUT[o.type];
      const el = { id: o.id, type, name: o.name || "" };
      if (ELEMENT_TYPES[type].linear) {
        const points = resolvePoints(map, o.points);
        if (!points) unplaced++;
        if (!points || points.length < 2) continue;
        el.points = points.map(pt);
      } else {
        if (!at) continue;
        el.at = pt(at);
        el.heading_deg = r1(+o.rotation_deg || 0);
      }
      if (type === "signal") Object.assign(el, { kind: o.kind || "main", side: o.side || "right" });
      if (type === "switch") Object.assign(el, { hand: o.hand || "left", length_m: +o.length_m || defaultOf(Switch, "length_m") });
      if (o.real) el.real = true;
      doc.elements.push(el);
    }
  }
  if (unplaced) doc.source.unplaced = unplaced;
  return doc;
}

/**
 * What is wrong with a `rail-infra/1` document: the format, the frame, lists of objects with unique
 * ids, points and numbers that are numbers, element types of the vocabulary, the tracks elements
 * name. Empty if nothing is. It never throws, whatever the file holds.
 * @param {object} doc
 * @returns {string[]}
 */
export function infraProblems(doc) {
  const out = [];
  if (!isObject(doc)) return ["not a JSON object"];
  if (doc.format !== INFRA_FORMAT) out.push(`format is ${JSON.stringify(doc.format)}, not "${INFRA_FORMAT}"`);
  if (!FRAME_UNITS.includes(doc.frame?.unit)) out.push(`frame.unit must be one of ${FRAME_UNITS.join(", ")}`);
  const ids = new Set();
  const number = (x, key, where) => {
    if (x[key] !== undefined && !Number.isFinite(x[key])) out.push(`${where}: ${key} is not a number`);
  };
  for (const key of LISTS) {
    if (doc[key] === undefined) continue;
    if (!Array.isArray(doc[key])) {
      out.push(`${key} must be a list`);
      continue;
    }
    for (const [i, x] of doc[key].entries()) {
      if (!isObject(x)) {
        out.push(`${key}[${i}]: not an object`);
        continue;
      }
      const where = `${key}[${i}]${x.id ? ` (${x.id})` : ""}`;
      if (typeof x.id !== "string" || !x.id) out.push(`${where}: no id`);
      else if (ids.has(x.id)) out.push(`${where}: the id is used twice`);
      else ids.add(x.id);
      if (x.at !== undefined && !finite(x.at)) out.push(`${where}: at is not [x, y]`);
      if (x.points !== undefined && (!Array.isArray(x.points) || !x.points.every(finite))) out.push(`${where}: points are not [[x, y], …]`);
      if (x.holes !== undefined && (!Array.isArray(x.holes) || !x.holes.every((h) => Array.isArray(h) && h.every(finite)))) out.push(`${where}: holes are not [[[x, y], …], …]`);
      if (key === "elements") for (const k of ["km", "heading_deg", "length_m", "speed_kmh"]) number(x, k, where);
      if (key === "operating_points" && x.km !== undefined && !(Array.isArray(x.km) && x.km.length === 2 && x.km.every(Number.isFinite))) out.push(`${where}: km is not [from, to]`);
    }
  }
  const tracks = new Set(entries(doc.tracks).map((t) => t.track).filter(Boolean).map(String));
  for (const t of entries(doc.tracks)) {
    if (!(Array.isArray(t.points) && t.points.length >= 2)) out.push(`tracks (${t.id}): fewer than two points`);
    if (t.kms !== undefined && (!Array.isArray(t.kms) || t.kms.length !== t.points?.length || !t.kms.every(Number.isFinite))) out.push(`tracks (${t.id}): kms must be one number per point`);
  }
  for (const e of entries(doc.elements)) {
    if (!ELEMENT_TYPES[e.type]) out.push(`elements (${e.id}): unknown type ${JSON.stringify(e.type)}`);
    if (e.at === undefined && e.points === undefined) out.push(`elements (${e.id}): neither at nor points`);
    if (e.type === "signal" && e.kind && !ELEMENT_TYPES.signal.kinds.includes(e.kind)) out.push(`elements (${e.id}): unknown signal kind ${JSON.stringify(e.kind)}`);
    if (e.track && !tracks.has(String(e.track))) out.push(`elements (${e.id}): no track ${JSON.stringify(e.track)}`);
  }
  return out;
}

/**
 * A document as it can be drawn, whatever the file holds: its lists as lists of objects, points
 * that are numbers, polylines of two points or more, numbers that are numbers (else left out).
 * The plan sheet and the DXF draw this; {@link infraProblems} says what was wrong.
 * @param {object} doc
 */
export function cleanInfra(doc) {
  const d = isObject(doc) ? doc : {};
  const points = (p, min) => {
    const q = Array.isArray(p) ? p.filter(finite) : [];
    return q.length >= min ? q : null;
  };
  const num = (v) => (Number.isFinite(v) ? v : undefined);
  const out = { ...d, frame: isObject(d.frame) ? d.frame : {} };
  for (const key of LISTS) {
    out[key] = entries(d[key]).flatMap((x) => {
      const y = { ...x };
      if (x.at !== undefined) y.at = finite(x.at) ? x.at : undefined;
      if (x.points !== undefined) y.points = points(x.points, key === "areas" || key === "platforms" ? 3 : 2) ?? undefined;
      if (x.holes !== undefined) y.holes = Array.isArray(x.holes) ? x.holes.map((h) => points(h, 3)).filter(Boolean) : [];
      if (x.box !== undefined) y.box = Array.isArray(x.box) && x.box.length === 4 && x.box.every(Number.isFinite) ? x.box : undefined;
      if (x.kms !== undefined) y.kms = Array.isArray(x.kms) && y.points && x.kms.length === y.points.length && x.kms.every(Number.isFinite) ? x.kms : undefined;
      if (key === "elements") for (const k of ["km", "heading_deg", "length_m", "speed_kmh"]) if (x[k] !== undefined) y[k] = num(x[k]);
      if (["tracks", "platforms", "areas"].includes(key) && !y.points) return [];
      if (key === "elements" && !y.at && !y.points) return [];
      if (key === "labels" && !y.at) return [];
      return [y];
    });
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
  for (const key of ["tracks", "platforms", "areas", "elements"]) for (const x of entries(doc?.[key])) if (Array.isArray(x.points)) x.points.forEach(add);
  for (const key of ["elements", "labels", "operating_points"]) for (const x of entries(doc?.[key])) add(x.at);
  for (const o of entries(doc?.operating_points)) if (Array.isArray(o.box)) [[o.box[0], o.box[1]], [o.box[2], o.box[3]]].forEach(add);
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}
