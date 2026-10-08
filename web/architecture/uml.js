/**
 * UML diagrams as SVG for the architecture page: packages, data flow, classes and activities.
 *
 * The diagrams are laid out with dagre (web/vendor/dagre, a layered graph layout) and drawn with
 * CSS classes (see architecture.css), so that they follow the page's light and dark colours. Text is
 * measured with the page's fonts (call `fontsReady()` first). Every diagram is an `<svg role="img">`
 * with a title and a description; activities also come as a list of steps (`activitySteps`).
 *
 * Notation (UML 2.5): packages as folders with «use» dependencies; data flow in the Gane–Sarson
 * style (external entities, processes, data stores); classes with attributes and operations,
 * generalisation (hollow triangle), composition (filled diamond), aggregation (hollow diamond),
 * association (arrow) and «create» dependencies (dashed); activities with initial and final nodes,
 * actions, decisions and merges with guards, forks and joins, send-signal and accept-event actions
 * (the events of the world's event bus).
 * @module architecture/uml
 */
import dagre from "../vendor/dagre/dagre.esm.js";

const NS = "http://www.w3.org/2000/svg";
const SANS = '"Noto Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = '"Noto Sans Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';

/** Text styles: canvas font for measuring, line height, and the CSS class that draws it the same way. */
const TEXT = {
  body: { font: `400 13px ${SANS}`, line: 17, cls: "t-body" },
  bold: { font: `700 13px ${SANS}`, line: 17, cls: "t-bold" },
  title: { font: `700 14px ${SANS}`, line: 18, cls: "t-title" },
  small: { font: `400 11px ${SANS}`, line: 14, cls: "t-small" },
  caps: { font: `700 10px ${SANS}`, line: 13, cls: "t-caps" },
  mono: { font: `400 11.5px ${MONO}`, line: 15, cls: "t-mono" },
};

/** Wait for the fonts the diagrams are measured with. */
export async function fontsReady() {
  if (!document.fonts?.load) return;
  await Promise.all([TEXT.body, TEXT.bold, TEXT.title, TEXT.caps, TEXT.mono].map((t) => document.fonts.load(t.font).catch(() => null)));
}

let ctx = null;
/** Width of a text in px. */
function measure(text, style) {
  ctx ??= document.createElement("canvas").getContext("2d");
  ctx.font = style.font;
  // caps are drawn upper case with letter spacing (see architecture.css)
  if (style === TEXT.caps) return ctx.measureText(String(text).toUpperCase()).width + 0.6 * String(text).length;
  return ctx.measureText(String(text)).width;
}

/** A list as lines of at most `max` px, the items separated by `sep` within a line (never at its start). */
function wrapList(items, style, max, sep = " · ") {
  const lines = [];
  let line = "";
  for (const item of items) {
    const next = line ? `${line}${sep}${item}` : item;
    if (line && measure(next, style) > max) {
      lines.push(line);
      line = item;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Lines of at most `max` px (words longer than that stay on a line of their own). */
function wrap(text, style, max) {
  const lines = [];
  for (const para of String(text ?? "").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next, style) > max) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function el(name, attrs = {}, ...children) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, String(v));
  for (const c of children.flat()) if (c != null) e.append(typeof c === "string" ? document.createTextNode(c) : c);
  return e;
}

/** A text of several lines; `x` is its left edge, its centre or its right edge (`anchor`), `y` its top. */
function text(lines, style, x, y, anchor = "middle", cls = "") {
  const t = el("text", { class: `${style.cls}${cls ? ` ${cls}` : ""}`, x, y, "text-anchor": anchor });
  lines.forEach((line, i) => t.append(el("tspan", { x, dy: i === 0 ? style.line * 0.78 : style.line }, style === TEXT.caps ? String(line).toUpperCase() : line)));
  return t;
}

const r1 = (v) => Math.round(v * 10) / 10;

/* ---------------------------------------------------------------- layout and drawing */

/**
 * Lay out and draw a diagram.
 * @param {object} spec
 * @param {Array<{id: string, width: number, height: number, shape?: string, cluster?: string, draw: (x: number, y: number, n: object) => SVGElement}>} spec.nodes
 *   nodes with their size; `draw` draws one with its top left corner at (x, y)
 * @param {Array<{from: string, to: string, label?: string, start?: string, end?: string, dashed?: boolean, reverse?: boolean, minlen?: number, weight?: number, cls?: string}>} spec.edges
 *   edges; `reverse` lays one out from `to` to `from` (a parent above its children); `start`/`end`: decorations
 * @param {Array<{id: string, label: string}>} [spec.clusters] groups of nodes (drawn as frames with a tab)
 * @param {string} spec.title the accessible name
 * @param {string} [spec.desc] a description for screen readers
 */
function diagram({ nodes, edges, clusters = [], rankdir = "TB", nodesep = 28, ranksep = 36, edgesep = 14, title, desc = "", cls = "" }) {
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: clusters.length > 0 });
  // margins: curves and arrowheads of edges that go round the outside stay inside the image
  g.setGraph({ rankdir, nodesep, ranksep, edgesep, marginx: 24, marginy: clusters.length ? 34 : 20 });
  g.setDefaultEdgeLabel(() => ({}));
  // clusters get ids of their own (a group may have the name of a node)
  const cid = (id) => `cluster:${id}`;
  for (const c of clusters) g.setNode(cid(c.id), {});
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    g.setNode(n.id, { width: n.width, height: n.height });
    if (n.cluster) g.setParent(n.id, cid(n.cluster));
  }
  const labels = edges.map((e) => (e.label ? wrap(e.label, TEXT.small, 150) : null));
  edges.forEach((e, i) => {
    if (!byId.has(e.from) || !byId.has(e.to)) throw new Error(`${title}: edge ${e.from} → ${e.to} to a node that is not in the diagram`);
    const lab = labels[i];
    const [v, w] = e.reverse ? [e.to, e.from] : [e.from, e.to];
    g.setEdge(v, w, {
      width: lab ? Math.max(...lab.map((l) => measure(l, TEXT.small))) + 8 : 0, height: lab ? lab.length * TEXT.small.line + 4 : 0,
      labelpos: "c", minlen: e.minlen ?? 1, weight: e.weight ?? 1,
    }, `e${i}`);
  });
  dagre.layout(g);
  const { width, height } = g.graph();
  const svg = el("svg", {
    class: `uml ${cls}`, viewBox: `0 0 ${Math.ceil(width)} ${Math.ceil(height)}`, width: Math.ceil(width), height: Math.ceil(height),
    role: "img", "aria-labelledby": null,
  });
  const id = `d${Math.random().toString(36).slice(2, 9)}`;
  svg.setAttribute("aria-labelledby", `${id}-t`);
  if (desc) svg.setAttribute("aria-describedby", `${id}-d`);
  svg.append(el("title", { id: `${id}-t` }, title));
  if (desc) svg.append(el("desc", { id: `${id}-d` }, desc));
  // clusters (behind), then edges, then nodes, then the edge labels on top
  for (const c of clusters) {
    const n = g.node(cid(c.id));
    if (!n?.width) continue;
    const x = n.x - n.width / 2, y = n.y - n.height / 2, tw = measure(c.label, TEXT.caps) + 16;
    svg.append(el("g", { class: "cluster" },
      el("path", { class: "cluster-tab", d: `M${r1(x)},${r1(y)} v-18 h${r1(tw)} v18 z` }),
      el("rect", { class: "cluster-box", x: r1(x), y: r1(y), width: r1(n.width), height: r1(n.height), rx: 4 }),
      text([c.label], TEXT.caps, r1(x + 8), r1(y - 15), "start", "cluster-label")));
  }
  const edgeLayer = el("g", { class: "edges" }), labelLayer = el("g", { class: "edge-labels" });
  edges.forEach((e, i) => {
    const [v, w] = e.reverse ? [e.to, e.from] : [e.from, e.to];
    const ge = g.edge({ v, w, name: `e${i}` });
    let pts = ge.points.map((p) => ({ x: p.x, y: p.y }));
    if (e.reverse) pts.reverse();
    // dagre ends edges on the nodes' boxes: round and diamond nodes get the end on their outline
    const from = g.node(e.from), to = g.node(e.to);
    pts[0] = clip(byId.get(e.from).shape, from, pts[1] ?? to);
    pts[pts.length - 1] = clip(byId.get(e.to).shape, to, pts[pts.length - 2] ?? from);
    const deco = [];
    if (e.start && e.start !== "none") deco.push(decoration(e.start, pts[0], pts[1], (p) => (pts[0] = p)));
    if (e.end && e.end !== "none") deco.push(decoration(e.end, pts[pts.length - 1], pts[pts.length - 2], (p) => (pts[pts.length - 1] = p)));
    edgeLayer.append(el("g", { class: `edge${e.dashed ? " dashed" : ""}${e.cls ? ` ${e.cls}` : ""}` },
      el("path", { class: "edge-line", d: curve(pts) }), deco.map((d) => d.node)));
    const lab = labels[i];
    if (lab && ge.x != null) {
      const w = Math.max(...lab.map((l) => measure(l, TEXT.small))) + 8, h = lab.length * TEXT.small.line + 4;
      labelLayer.append(el("g", { class: `edge-label${e.cls ? ` ${e.cls}` : ""}` },
        el("rect", { x: r1(ge.x - w / 2), y: r1(ge.y - h / 2), width: r1(w), height: r1(h), rx: 3 }),
        text(lab, TEXT.small, r1(ge.x), r1(ge.y - h / 2 + 2))));
    }
  });
  svg.append(edgeLayer);
  const nodeLayer = el("g", { class: "nodes" });
  for (const n of nodes) {
    const p = g.node(n.id);
    nodeLayer.append(n.draw(p.x - n.width / 2, p.y - n.height / 2, n));
  }
  svg.append(nodeLayer, labelLayer);
  return svg;
}

/** The point where the line from the centre of a node (laid out at c) to `towards` leaves its outline. */
function clip(shape, c, towards) {
  const dx = towards.x - c.x, dy = towards.y - c.y, len = Math.hypot(dx, dy) || 1;
  if (shape === "circle") return { x: c.x + (dx / len) * (c.width / 2), y: c.y + (dy / len) * (c.height / 2) };
  if (shape === "diamond") {
    const t = 1 / (Math.abs(dx) / (c.width / 2) + Math.abs(dy) / (c.height / 2) || 1);
    return { x: c.x + dx * t, y: c.y + dy * t };
  }
  // boxes: where the line leaves the box
  const sx = Math.abs(dx) > 1e-9 ? (c.width / 2) / Math.abs(dx) : Infinity, sy = Math.abs(dy) > 1e-9 ? (c.height / 2) / Math.abs(dy) : Infinity;
  const t = Math.min(sx, sy);
  return Number.isFinite(t) ? { x: c.x + dx * t, y: c.y + dy * t } : { x: c.x, y: c.y };
}

/**
 * The end of an edge: an arrowhead, a hollow triangle (generalisation), a filled or hollow diamond
 * (composition, aggregation). The edge is shortened to where the decoration begins (`setEnd`).
 */
function decoration(kind, tip, prev, setEnd) {
  const dx = tip.x - prev.x, dy = tip.y - prev.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, px = -uy, py = ux;
  const at = (back, side) => `${r1(tip.x - ux * back + px * side)},${r1(tip.y - uy * back + py * side)}`;
  if (kind === "arrow") {
    return { node: el("path", { class: "deco-arrow", d: `M${at(10, -5)} L${r1(tip.x)},${r1(tip.y)} L${at(10, 5)}` }) };
  }
  if (kind === "triangle") {
    setEnd({ x: tip.x - ux * 13, y: tip.y - uy * 13 });
    return { node: el("path", { class: "deco-hollow", d: `M${r1(tip.x)},${r1(tip.y)} L${at(13, 7)} L${at(13, -7)} Z` }) };
  }
  if (kind === "diamond" || kind === "odiamond") {
    setEnd({ x: tip.x - ux * 18, y: tip.y - uy * 18 });
    return { node: el("path", { class: kind === "diamond" ? "deco-filled" : "deco-hollow", d: `M${r1(tip.x)},${r1(tip.y)} L${at(9, 5)} L${at(18, 0)} L${at(9, -5)} Z` }) };
  }
  return { node: null };
}

/** A smooth line through the points (a cubic B-spline, as d3's curveBasis). */
function curve(pts) {
  if (pts.length < 3) return `M${pts.map((p) => `${r1(p.x)},${r1(p.y)}`).join(" L")}`;
  let d = `M${r1(pts[0].x)},${r1(pts[0].y)}`;
  let x0 = pts[0].x, y0 = pts[0].y, x1 = pts[1].x, y1 = pts[1].y;
  d += ` L${r1((5 * x0 + x1) / 6)},${r1((5 * y0 + y1) / 6)}`;
  const bez = (x, y) => {
    d += ` C${r1((2 * x0 + x1) / 3)},${r1((2 * y0 + y1) / 3)} ${r1((x0 + 2 * x1) / 3)},${r1((y0 + 2 * y1) / 3)} ${r1((x0 + 4 * x1 + x) / 6)},${r1((y0 + 4 * y1 + y) / 6)}`;
  };
  for (let i = 2; i < pts.length; i++) {
    bez(pts[i].x, pts[i].y);
    x0 = x1; y0 = y1; x1 = pts[i].x; y1 = pts[i].y;
  }
  bez(x1, y1);
  d += ` L${r1(x1)},${r1(y1)}`;
  return d;
}

/**
 * Fit a diagram's viewBox to what was drawn (an edge that goes round the outside can leave the
 * box dagre gives): call it once the SVG is in the document.
 */
export function fitViewBox(svg, pad = 6) {
  let b;
  try {
    b = svg.getBBox();
  } catch {
    return;
  }
  const [x0, y0, w0, h0] = svg.getAttribute("viewBox").split(" ").map(Number);
  const x = Math.min(x0, Math.floor(b.x) - pad), y = Math.min(y0, Math.floor(b.y) - pad);
  const w = Math.max(x0 + w0, Math.ceil(b.x + b.width) + pad) - x, h = Math.max(y0 + h0, Math.ceil(b.y + b.height) + pad) - y;
  if (x === x0 && y === y0 && w === w0 && h === h0) return;
  svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
}

/* ---------------------------------------------------------------- packages */

/**
 * A package diagram: packages (folders) with their modules and «use» dependencies. With `only`, the
 * packages of those groups; a dependency on a package of another group goes to one box for that
 * group. Dependencies on utility packages (used by nearly all) and those of a hub (`hub`: imports
 * everything) are left out: their boxes say so. Other ties (scripts, messages) are dashed with a label.
 * @param {{groups: Array<{id: string, name: string}>, packages: Array<{id: string, name: string, group: string, summary: string, files: string[], uses?: string[], links?: Array<[string, string]>, utility?: boolean, hub?: boolean, external?: boolean}>}} spec
 * @param {string} title
 * @param {{only?: string[]}} [opts]
 */
export function packageDiagram(spec, title = "Package diagram", { only = null } = {}) {
  const inside = (p) => !only || only.includes(p.group);
  const shown = spec.packages.filter(inside);
  const byId = new Map(spec.packages.map((p) => [p.id, p]));
  // a dependency outside: to the box of its group
  const target = (id) => {
    const p = byId.get(id);
    if (!p) return null;
    return inside(p) ? p.id : `group:${p.group}`;
  };
  const nodes = shown.map((p) => {
    const files = wrapList(p.files.map((f) => f.split("/").pop()), TEXT.mono, 250);
    const summary = wrap(p.summary, TEXT.small, 250);
    const w = Math.max(measure(p.name, TEXT.title) + 24, ...files.map((l) => measure(l, TEXT.mono)), ...summary.map((l) => measure(l, TEXT.small))) + 24;
    const h = 16 + TEXT.title.line + 8 + summary.length * TEXT.small.line + 6 + files.length * TEXT.mono.line + 12;
    return {
      id: p.id, width: Math.ceil(w), height: Math.ceil(h), cluster: only && only.length === 1 ? null : p.group,
      draw: (x, y, n) => {
        const tab = Math.min(n.width - 20, measure(p.name, TEXT.title) + 24);
        return el("g", { class: `node package${p.external ? " external-package" : ""}${p.utility ? " utility" : ""}` },
          el("path", { class: "shape", d: `M${r1(x)},${r1(y + 16)} v-16 h${r1(tab)} v16 h${r1(n.width - tab)} v${r1(n.height - 16)} h${r1(-n.width)} z` }),
          text([p.name], TEXT.title, r1(x + 12), r1(y + 20), "start"),
          text(summary, TEXT.small, r1(x + 12), r1(y + 20 + TEXT.title.line + 6), "start", "muted"),
          text(files, TEXT.mono, r1(x + 12), r1(y + 20 + TEXT.title.line + 6 + summary.length * TEXT.small.line + 6), "start", "files"));
      },
    };
  });
  const utility = new Set(spec.packages.filter((p) => p.utility).map((p) => p.id));
  const edges = [], seen = new Set();
  const add = (from, to, e) => {
    const key = `${from}>${to}>${e.label || ""}`;
    if (from === to || seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, ...e });
  };
  for (const p of shown) {
    if (!p.hub) for (const u of p.uses || []) if (!utility.has(u) && target(u)) add(p.id, target(u), { end: "arrow", dashed: true, cls: "dep" });
    for (const [to, lab] of p.links || []) if (target(to)) add(p.id, target(to), { end: "arrow", dashed: true, label: lab, cls: "link" });
  }
  // the boxes of other groups that dependencies go to
  for (const g of spec.groups) {
    const id = `group:${g.id}`;
    if (!edges.some((e) => e.to === id)) continue;
    const w = measure(g.name, TEXT.bold) + 28, h = 16 + TEXT.bold.line + 14;
    nodes.push({ id, width: Math.ceil(w), height: h, draw: (x, y, n) => el("g", { class: "node package external-package" },
      el("path", { class: "shape", d: `M${r1(x)},${r1(y + 12)} v-12 h${r1(Math.min(n.width - 20, 60))} v12 h${r1(n.width - Math.min(n.width - 20, 60))} v${r1(n.height - 12)} h${r1(-n.width)} z` }),
      text([g.name], TEXT.bold, r1(x + n.width / 2), r1(y + 18))) });
  }
  const groups = only && only.length === 1 ? [] : spec.groups.filter((g) => shown.some((p) => p.group === g.id));
  const name = (id) => byId.get(id)?.name ?? spec.groups.find((g) => `group:${g.id}` === id)?.name ?? id;
  return diagram({
    nodes, edges, clusters: groups.map((g) => ({ id: g.id, label: g.name })), rankdir: "TB", nodesep: 22, ranksep: 46, title, cls: "packages",
    desc: shown.map((p) => `${p.name}: ${p.summary}${p.uses?.length ? ` Uses ${p.uses.map(name).join(", ")}.` : ""}`).join(" "),
  });
}

/* ---------------------------------------------------------------- data flow */

/**
 * A data-flow diagram: external entities (boxes), processes (rounded, numbered) and data stores
 * (open boxes, numbered), with the data on the flows.
 * @param {{nodes: Array<{id: string, kind: "external"|"process"|"store", label: string, no?: string}>, flows: Array<{from: string, to: string, label: string}>}} spec
 */
export function dataFlowDiagram(spec, title = "Data flow") {
  const nodes = spec.nodes.map((d) => {
    const lines = wrap(d.label, d.kind === "external" ? TEXT.bold : TEXT.body, 150);
    const style = d.kind === "external" ? TEXT.bold : TEXT.body;
    const tw = Math.max(...lines.map((l) => measure(l, style)));
    if (d.kind === "store") {
      const w = tw + 52, h = lines.length * style.line + 16;
      return { id: d.id, width: Math.ceil(w), height: Math.ceil(h), draw: (x, y, n) => el("g", { class: "node store" },
        el("rect", { class: "fill", x: r1(x), y: r1(y), width: n.width, height: n.height }),
        el("path", { class: "shape", d: `M${r1(x + n.width)},${r1(y)} H${r1(x)} V${r1(y + n.height)} H${r1(x + n.width)} M${r1(x + 32)},${r1(y)} V${r1(y + n.height)}` }),
        text([d.no || ""], TEXT.caps, r1(x + 16), r1(y + n.height / 2 - 6), "middle", "muted"),
        text(lines, style, r1(x + 32 + (n.width - 32) / 2), r1(y + 8))) };
    }
    if (d.kind === "process") {
      const w = Math.max(tw, measure(d.no || "", TEXT.caps)) + 28, h = 22 + lines.length * style.line + 12;
      return { id: d.id, width: Math.ceil(w), height: Math.ceil(h), draw: (x, y, n) => el("g", { class: "node process" },
        el("rect", { class: "shape", x: r1(x), y: r1(y), width: n.width, height: n.height, rx: 12 }),
        el("path", { class: "divider", d: `M${r1(x)},${r1(y + 20)} H${r1(x + n.width)}` }),
        text([d.no || ""], TEXT.caps, r1(x + n.width / 2), r1(y + 4), "middle", "muted"),
        text(lines, style, r1(x + n.width / 2), r1(y + 26))) };
    }
    const w = tw + 28, h = lines.length * style.line + 22;
    return { id: d.id, width: Math.ceil(w), height: Math.ceil(h), draw: (x, y, n) => el("g", { class: "node external" },
      el("rect", { class: "shape", x: r1(x), y: r1(y), width: n.width, height: n.height }),
      text(lines, style, r1(x + n.width / 2), r1(y + 11))) };
  });
  const edges = spec.flows.map((f) => ({ from: f.from, to: f.to, label: f.label, end: "arrow", cls: "flow" }));
  return diagram({
    nodes, edges, rankdir: spec.rankdir || "LR", nodesep: 18, ranksep: 54, edgesep: 12, title, cls: "dataflow",
    desc: spec.flows.map((f) => `${label(spec, f.from)} to ${label(spec, f.to)}: ${f.label}.`).join(" "),
  });
}

const label = (spec, id) => spec.nodes.find((n) => n.id === id)?.label ?? id;

/* ---------------------------------------------------------------- classes */

/** "name: type — meaning" or "name(params) — meaning": the part before " — ". */
export const memberSignature = (m) => String(m).split(" — ")[0].trim();
/** The identifier of a member ("step(dt)" → "step", "count: number" → "count"). */
export const memberName = (m) => memberSignature(m).replace(/^static\s+|^get\s+/, "").match(/^[#\w$]+/)?.[0] ?? "";

/**
 * A class diagram: the model's classes with their attributes and operations, the classes of other
 * models they relate to (names only), and the relations.
 * @param {{classes: object[], relations?: object[]}} model
 * @param {(name: string) => {package?: string} | null} [external] where a class of another model is
 */
export function classDiagram(model, title, external = () => null) {
  const own = new Map(model.classes.map((c) => [c.name, c]));
  const names = new Set(own.keys());
  for (const r of model.relations || []) for (const n of [r.from, r.to]) names.add(n);
  for (const c of model.classes) if (c.extends && c.extends !== "-") names.add(c.extends);
  const nodes = [...names].map((name) => {
    const c = own.get(name);
    if (!c) {
      const ext = external(name);
      const sub = ext?.package ? `(${ext.package})` : "";
      const w = Math.max(measure(name, TEXT.bold), measure(sub, TEXT.small)) + 24, h = 14 + TEXT.bold.line + (sub ? TEXT.small.line : 0);
      return { id: name, width: Math.ceil(w), height: Math.ceil(h), draw: (x, y, n) => el("g", { class: "node class external-class" },
        el("rect", { class: "shape", x: r1(x), y: r1(y), width: n.width, height: n.height, rx: 3 }),
        text([name], TEXT.bold, r1(x + n.width / 2), r1(y + 7)),
        sub ? text([sub], TEXT.small, r1(x + n.width / 2), r1(y + 7 + TEXT.bold.line), "middle", "muted") : null) };
    }
    const stereo = c.kind === "module" ? "«module»" : c.stereotype ? `«${c.stereotype}»` : "";
    const attrs = (c.attributes || []).map((a) => `${visibility(a)} ${memberSignature(a)}`);
    const ops = (c.operations || []).map((o) => `${visibility(o)} ${memberSignature(o)}`);
    const head = (stereo ? TEXT.small.line : 0) + TEXT.bold.line + 12;
    const w = Math.max(measure(c.name, TEXT.bold) + 24, stereo ? measure(stereo, TEXT.small) + 24 : 0, ...attrs.map((a) => measure(a, TEXT.mono) + 20), ...ops.map((o) => measure(o, TEXT.mono) + 20), 120);
    const ha = attrs.length ? attrs.length * TEXT.mono.line + 10 : 8, ho = ops.length ? ops.length * TEXT.mono.line + 10 : 8;
    return {
      id: name, width: Math.ceil(w), height: Math.ceil(head + ha + ho),
      draw: (x, y, n) => el("g", { class: `node class${c.kind === "module" ? " module" : ""}` },
        el("rect", { class: "shape", x: r1(x), y: r1(y), width: n.width, height: n.height, rx: 3 }),
        el("rect", { class: "head", x: r1(x), y: r1(y), width: n.width, height: head, rx: 3 }),
        stereo ? text([stereo], TEXT.small, r1(x + n.width / 2), r1(y + 6), "middle", "muted") : null,
        text([c.name], TEXT.bold, r1(x + n.width / 2), r1(y + 6 + (stereo ? TEXT.small.line : 0))),
        el("path", { class: "divider", d: `M${r1(x)},${r1(y + head)} H${r1(x + n.width)} M${r1(x)},${r1(y + head + ha)} H${r1(x + n.width)}` }),
        attrs.length ? text(attrs, TEXT.mono, r1(x + 10), r1(y + head + 5), "start") : null,
        ops.length ? text(ops, TEXT.mono, r1(x + 10), r1(y + head + ha + 5), "start") : null),
    };
  });
  const edges = [];
  for (const c of model.classes) {
    if (c.extends && c.extends !== "-") edges.push({ from: c.name, to: c.extends, start: "none", end: "triangle", reverse: true, cls: "generalisation" });
  }
  for (const r of model.relations || []) {
    const lab = r.label || null;
    if (r.kind === "inherits") edges.push({ from: r.from, to: r.to, end: "triangle", reverse: true, label: lab, cls: "generalisation" });
    else if (r.kind === "composes") edges.push({ from: r.from, to: r.to, start: "diamond", end: "arrow", label: lab, cls: "composition" });
    else if (r.kind === "aggregates") edges.push({ from: r.from, to: r.to, start: "odiamond", end: "arrow", label: lab, cls: "aggregation" });
    else if (r.kind === "creates") edges.push({ from: r.from, to: r.to, end: "arrow", dashed: true, label: lab ? `«create» ${lab}` : "«create»", cls: "dependency" });
    else if (r.kind === "depends") edges.push({ from: r.from, to: r.to, end: "arrow", dashed: true, label: lab ? `«use» ${lab}` : "«use»", cls: "dependency" });
    else edges.push({ from: r.from, to: r.to, end: "arrow", label: lab, cls: "association" });
  }
  return diagram({
    nodes, edges, rankdir: "TB", nodesep: 26, ranksep: 44, title, cls: "classes",
    desc: model.classes.map((c) => `${c.name}${c.extends && c.extends !== "-" ? `, a ${c.extends}` : ""}: ${c.role || ""}`).join(" "),
  });
}

const visibility = (m) => (memberName(m).startsWith("_") || memberName(m).startsWith("#") ? "−" : "+");

/* ---------------------------------------------------------------- activities */

/** The kinds of activity nodes. */
export const ACTIVITY_KINDS = ["start", "end", "flowfinal", "action", "decision", "merge", "fork", "join", "send", "receive"];

/**
 * An activity diagram.
 * @param {{name: string, nodes: Array<[string, string, string?, string?]>, edges: Array<[string, string, string?]>, lanes?: object}} activity
 *   nodes as [id, kind, label, ref]: `ref` is the code that does an action ("Class.method"), shown under it;
 *   edges as [from, to, guard]
 */
export function activityDiagram(activity) {
  const nodes = activity.nodes.map(([id, kind, labelText = "", ref = null, lane = null]) => activityNode(id, kind, labelText, ref, lane));
  const edges = activity.edges.map(([from, to, guard]) => ({ from, to, label: guard ? `[${guard}]` : null, end: "arrow", cls: "control" }));
  return diagram({ nodes, edges, rankdir: activity.rankdir || "TB", nodesep: 26, ranksep: 30, edgesep: 16, title: activity.name, desc: activitySteps(activity).map((s) => s.text).join(" "), cls: "activity" });
}

function activityNode(id, kind, labelText, ref, lane) {
  if (kind === "start") return { id, shape: "circle", width: 18, height: 18, draw: (x, y) => el("circle", { class: "node initial", cx: r1(x + 9), cy: r1(y + 9), r: 8 }) };
  if (kind === "end") {
    return { id, shape: "circle", width: 24, height: 24, draw: (x, y) => el("g", { class: "node final" },
      el("circle", { class: "ring", cx: r1(x + 12), cy: r1(y + 12), r: 11 }), el("circle", { class: "dot", cx: r1(x + 12), cy: r1(y + 12), r: 6.5 })) };
  }
  if (kind === "flowfinal") {
    return { id, shape: "circle", width: 22, height: 22, draw: (x, y) => el("g", { class: "node flowfinal" },
      el("circle", { class: "ring", cx: r1(x + 11), cy: r1(y + 11), r: 10 }),
      el("path", { class: "cross", d: `M${r1(x + 4)},${r1(y + 4)} L${r1(x + 18)},${r1(y + 18)} M${r1(x + 18)},${r1(y + 4)} L${r1(x + 4)},${r1(y + 18)}` })) };
  }
  if (kind === "fork" || kind === "join") {
    return { id, width: 110, height: 6, draw: (x, y, n) => el("rect", { class: "node bar", x: r1(x), y: r1(y), width: n.width, height: n.height, rx: 2 }) };
  }
  if (kind === "merge" || (kind === "decision" && !labelText)) {
    return { id, shape: "diamond", width: 26, height: 26, draw: (x, y) => el("path", { class: "node diamond shape", d: `M${r1(x + 13)},${r1(y)} L${r1(x + 26)},${r1(y + 13)} L${r1(x + 13)},${r1(y + 26)} L${r1(x)},${r1(y + 13)} Z` }) };
  }
  if (kind === "decision") {
    const lines = wrap(labelText, TEXT.body, 150), tw = Math.max(...lines.map((l) => measure(l, TEXT.body)));
    const w = tw + 64, h = lines.length * TEXT.body.line + 30;
    return { id, shape: "diamond", width: Math.ceil(w), height: Math.ceil(h), draw: (x, y, n) => el("g", { class: "node decision" },
      el("path", { class: "shape", d: `M${r1(x + n.width / 2)},${r1(y)} L${r1(x + n.width)},${r1(y + n.height / 2)} L${r1(x + n.width / 2)},${r1(y + n.height)} L${r1(x)},${r1(y + n.height / 2)} Z` }),
      text(lines, TEXT.body, r1(x + n.width / 2), r1(y + (n.height - lines.length * TEXT.body.line) / 2))) };
  }
  // actions, send-signal and accept-event actions
  const lines = wrap(labelText, TEXT.body, 200);
  const refLines = ref ? wrap(ref, TEXT.mono, 220) : [];
  const laneText = lane ? String(lane) : "";
  const tw = Math.max(...lines.map((l) => measure(l, TEXT.body)), ...refLines.map((l) => measure(l, TEXT.mono)), laneText ? measure(laneText, TEXT.caps) : 0);
  const notch = kind === "send" || kind === "receive" ? 14 : 0;
  const w = Math.max(tw + 28 + notch, 110), h = 18 + (laneText ? TEXT.caps.line + 2 : 0) + lines.length * TEXT.body.line + (refLines.length ? refLines.length * TEXT.mono.line + 3 : 0);
  return {
    id, width: Math.ceil(w), height: Math.ceil(h),
    draw: (x, y, n) => {
      const W = n.width, H = n.height;
      let shape;
      if (kind === "send") shape = el("path", { class: "shape", d: `M${r1(x)},${r1(y)} H${r1(x + W - notch)} L${r1(x + W)},${r1(y + H / 2)} L${r1(x + W - notch)},${r1(y + H)} H${r1(x)} Z` });
      else if (kind === "receive") shape = el("path", { class: "shape", d: `M${r1(x)},${r1(y)} H${r1(x + W)} V${r1(y + H)} H${r1(x)} L${r1(x + notch)},${r1(y + H / 2)} Z` });
      else shape = el("rect", { class: "shape", x: r1(x), y: r1(y), width: W, height: H, rx: 12 });
      const cx = x + (kind === "receive" ? notch / 2 : kind === "send" ? -notch / 2 : 0) + W / 2;
      let ty = y + 9;
      const parts = [shape];
      if (laneText) {
        parts.push(text([laneText], TEXT.caps, r1(cx), r1(ty), "middle", "lane"));
        ty += TEXT.caps.line + 2;
      }
      parts.push(text(lines, TEXT.body, r1(cx), r1(ty)));
      if (refLines.length) parts.push(text(refLines, TEXT.mono, r1(cx), r1(ty + lines.length * TEXT.body.line + 3), "middle", "ref"));
      return el("g", { class: `node ${kind}` }, parts);
    },
  };
}

/**
 * The steps of an activity as text, in the order of a walk from its start: each step with where it
 * goes next (the guards of a decision with the steps they lead to).
 * @returns {Array<{n: number, id: string, kind: string, text: string}>}
 */
export function activitySteps(activity) {
  const nodes = new Map(activity.nodes.map((n) => [n[0], n]));
  const out = new Map();
  for (const [from, to, guard] of activity.edges) out.set(from, [...(out.get(from) || []), { to, guard }]);
  // order: depth first from the start, following the edges in the order they are written
  const order = [], seen = new Set();
  const visit = (id) => {
    if (seen.has(id) || !nodes.has(id)) return;
    seen.add(id);
    order.push(id);
    for (const e of out.get(id) || []) visit(e.to);
  };
  for (const n of activity.nodes) if (n[1] === "start") visit(n[0]);
  for (const n of activity.nodes) visit(n[0]); // anything not reachable comes last
  const no = new Map(order.map((id, i) => [id, i + 1]));
  const name = ([, kind, labelText]) => {
    if (kind === "start") return "Start";
    if (kind === "end") return "End";
    if (kind === "flowfinal") return "This flow ends";
    if (kind === "fork") return "In parallel";
    if (kind === "join") return "When all parallel flows are done";
    if (kind === "merge") return "Flows meet";
    if (kind === "send") return `Send the event ${labelText}`;
    if (kind === "receive") return `Wait for the event ${labelText}`;
    if (kind === "decision") return labelText ? `Decide: ${labelText}` : "Decide";
    return labelText;
  };
  return order.map((id) => {
    const n = nodes.get(id), next = out.get(id) || [];
    const ref = n[3] ? ` (${n[3]})` : "";
    const lane = n[4] ? `${n[4]}: ` : "";
    const goes = next.length === 0 ? "" : next.length === 1 && !next[0].guard ? ` Next: step ${no.get(next[0].to)}.`
      : ` ${next.map((e) => `${e.guard ? `If ${e.guard}` : "Then"}: step ${no.get(e.to)}`).join("; ")}.`;
    return { n: no.get(id), id, kind: n[1], text: `${no.get(id)}. ${lane}${name(n)}${ref}.${goes}`.replace(/\.\./g, ".").replace(/\?\./g, "?") };
  });
}
