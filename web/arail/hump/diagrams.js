/**
 * The diagrams of hump design for a run, as one SVG (Node and browser alike, no DOM): the height of
 * the routes with every cut's energy line, every cut's speed over the distance from the crest, and
 * its distance over time. A cut is a line in the colour of its rolling class; what went wrong (an
 * impact too hard, a misroute, a cut stopped short) is marked in Rot with its label. Every cut's
 * line says what became of it on hover (`<title>`). Light and dark mode by the viewer's setting.
 *
 * Needs a run with `trace: true` (HumpSimulation options).
 * @module arail/hump/diagrams
 */
import { CD, CD_LIGHT, FONT } from "../core/colors.js";

/**
 * The colours: the rolling classes in a fixed order (Türkis, Brillantblau, Orange of the corporate
 * design; lighter variants on the dark surface), Rot for problems, the ink and surfaces of the app.
 */
export const DIAGRAM_COLOURS = {
  light: { good: CD.tuerkis, medium: CD.brillantblau, bad: CD.orange, problem: CD.rot, surface: "#ffffff", ink: "#0c1f3a", muted: "#566782", grid: "#d6e6e7", wash: "#e8f1f2" },
  dark: { good: CD_LIGHT.tuerkis, medium: "#8c8fdd", bad: CD_LIGHT.orange, problem: CD_LIGHT.rot, surface: "#00103a", ink: "#eaf1ff", muted: "#a0b4d8", grid: "#2a4a92", wash: "#0c2766" },
};

/** The rolling classes as the legend names them. */
export const CLASS_LABELS = { good: "Good runner", medium: "Medium runner", bad: "Bad runner" };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toString();

/** Round tick values between a and b, about n of them. */
export function niceTicks(a, b, n = 5) {
  const span = b - a;
  if (!(span > 0)) return [a];
  const raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= raw) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/** Fewer points with the same look: Ramer–Douglas–Peucker in pixels. */
export function simplify(points, tol = 0.4) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [x1, y1] = points[i], [x2, y2] = points[j];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    let best = -1, far = tol;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs(dy * (points[k][0] - x1) - dx * (points[k][1] - y1)) / len;
      if (d > far) [best, far] = [k, d];
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

/** The rolling class of a cut: the class of most of its mass. */
export function cutClass(cut) {
  const by = {};
  for (const w of cut.wagons) by[w.rolling] = (by[w.rolling] || 0) + w.mass_t;
  return ["bad", "medium", "good"].reduce((best, k) => ((by[k] || 0) > (by[best] || 0) ? k : best), "good");
}

/**
 * The diagrams of a run as an SVG string.
 * @param {import("./simulation.js").HumpSimulation} sim a run with `trace: true`
 * @param {{width?: number, title?: string}} [options]
 * @returns {string}
 */
export function humpDiagrams(sim, options = {}) {
  if (!sim.options.trace) throw new Error("the diagrams need a run with trace: true");
  const yard = sim.yard, crest = yard.crest_m;
  const cuts = sim.cuts.filter((c) => c.order != null && c.trace.length);
  const W = options.width ?? 960, L = 64, R = 24, plotW = W - L - R;
  const panelH = 220, gap = 64, top = 112;
  const routes = yard.tracks.map((t) => yard.routeTo(t.name));
  const sMax = Math.max(...yard.tracks.map((t) => t.s1)) - crest;
  const tMax = Math.max(1, ...cuts.map((c) => c.trace[c.trace.length - 1][0]));
  const results = new Map(sim.results().perCut.map((r) => [r.id, r]));
  const out = [];
  const panels = [];

  /** A panel: its frame, axes and the mapping from data to pixels. */
  const panel = (i, title, x0, x1, y0, y1, xLabel, yLabel) => {
    const py = top + i * (panelH + gap);
    const X = (v) => L + ((v - x0) / (x1 - x0)) * plotW;
    const Y = (v) => py + panelH - ((v - y0) / (y1 - y0)) * panelH;
    const g = [`<g class="panel"><text class="h" x="${L}" y="${py - 12}">${esc(title)}</text>`];
    for (const v of niceTicks(y0, y1, 4)) g.push(`<line class="grid" x1="${L}" x2="${L + plotW}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="tick" x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${num(v)}</text>`);
    for (const v of niceTicks(x0, x1, 8)) g.push(`<text class="tick" x="${X(v).toFixed(1)}" y="${py + panelH + 16}" text-anchor="middle">${num(v, 0)}</text>`);
    g.push(`<line class="axis" x1="${L}" x2="${L + plotW}" y1="${py + panelH}" y2="${py + panelH}"/>`);
    g.push(`<text class="label" x="${L + plotW}" y="${py + panelH + 32}" text-anchor="end">${esc(xLabel)}</text>`);
    g.push(`<text class="label" transform="translate(16 ${py + panelH / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`);
    const p = { X, Y, py, g, x0, x1 };
    panels.push(p);
    return p;
  };
  const band = (p, a, b, label) => {
    const xa = Math.max(L, p.X(a)), xb = Math.min(L + plotW, p.X(b));
    if (xb <= xa) return;
    p.g.push(`<rect class="band" x="${xa.toFixed(1)}" y="${p.py}" width="${(xb - xa).toFixed(1)}" height="${panelH}"/>`);
    if (label) p.g.push(`<text class="note" x="${((xa + xb) / 2).toFixed(1)}" y="${p.py + 12}" text-anchor="middle">${esc(label)}</text>`);
  };
  const retarderBands = (p, rows) => {
    const main = yard.retarders.filter((r) => r.kind === "main"), group = yard.retarders.filter((r) => r.kind === "group");
    if (rows) {
      // over time: the retarders are positions, drawn across
      for (const [list, label] of [[main, "Main retarder"], [group, "Group retarders"]]) {
        if (!list.length) continue;
        const a = Math.min(...list.map((r) => r.s0)) - crest, b = Math.max(...list.map((r) => r.s1)) - crest;
        p.g.push(`<rect class="band" x="${L}" y="${p.Y(b).toFixed(1)}" width="${plotW}" height="${(p.Y(a) - p.Y(b)).toFixed(1)}"/><text class="note" x="${L + plotW - 4}" y="${(p.Y(b) - 3).toFixed(1)}" text-anchor="end">${esc(label)}</text>`);
      }
      return;
    }
    if (main.length) band(p, Math.min(...main.map((r) => r.s0)) - crest, Math.max(...main.map((r) => r.s1)) - crest, "Main retarder");
    if (group.length) band(p, Math.min(...group.map((r) => r.s0)) - crest, Math.max(...group.map((r) => r.s1)) - crest, "Group retarders");
    // where the classification tracks begin: a line, the label beyond it
    const x = p.X(Math.max(...yard.tracks.map((t) => t.s0)) - crest);
    p.g.push(`<line class="grid" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${p.py}" y2="${p.py + panelH}"/><text class="note" x="${(x + 6).toFixed(1)}" y="${p.py + 26}">Classification tracks →</text>`);
  };

  // panel 1: heights of the routes and the cuts' energy lines
  let hMin = Infinity, hMax = -Infinity;
  const profiles = routes.map((r) => yard.profile(r, 5).filter((q) => q.s >= crest - 20));
  for (const pr of profiles) for (const q of pr) [hMin, hMax] = [Math.min(hMin, q.h), Math.max(hMax, q.h)];
  for (const c of cuts) for (const tr of c.trace) hMax = Math.max(hMax, tr[3]);
  const p1 = panel(0, "Height of the routes and energy line of each cut", -20, sMax, Math.floor(hMin - 0.2), Math.ceil(hMax + 0.2), "Distance from the crest (m)", "Height (m)");
  retarderBands(p1);
  for (const pr of profiles) {
    const pts = simplify(pr.map((q) => [p1.X(q.s - crest), p1.Y(q.h)]));
    p1.g.push(`<path class="ground" d="M${pts.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join("L")}"/>`);
  }
  // panel 2: speed over distance
  const vMax = Math.max(2, ...cuts.flatMap((c) => c.trace.map((tr) => tr[2])));
  const p2 = panel(1, "Speed of each cut over the distance", -20, sMax, 0, Math.ceil(vMax), "Distance from the crest (m)", "Speed (m/s)");
  retarderBands(p2);
  const lim = sim.options.impact_mps;
  p2.g.push(`<line class="ref" x1="${L}" x2="${L + plotW}" y1="${p2.Y(lim).toFixed(1)}" y2="${p2.Y(lim).toFixed(1)}"/><text class="note" x="${L + plotW - 4}" y="${(p2.Y(lim) - 4).toFixed(1)}" text-anchor="end">Impact limit ${num(lim, 2)} m/s</text>`);
  // panel 3: distance over time
  const p3 = panel(2, "Distance of each cut over time", 0, Math.ceil(tMax / 60) * 60, -20, Math.ceil(sMax / 100) * 100, "Time (s)", "Distance from the crest (m)");
  retarderBands(p3, true);

  const problems = [];
  for (const c of cuts) {
    const cls = cutClass(c), r = results.get(c.id);
    const tip = `${c.id} · ${c.wagons.map((w) => w.type).join("+")} · ${num(c.body.mass_t, 0)} t · ${num(c.body.w, 2)} N/kN → track ${r.ended ?? "–"}`
      + `${r.misrouted ? ` (for ${r.track}, misrouted)` : ""}${r.impact_mps != null ? ` · impact ${num(r.impact_mps, 2)} m/s` : ""}${r.stop && !r.ended ? " · stopped short" : ""}`;
    const line = (p, pts) => {
      const d = `M${simplify(pts).map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join("L")}`;
      p.g.push(`<g class="cut ${cls}"><title>${esc(tip)}</title><path class="hit" d="${d}"/><path class="line" d="${d}"/></g>`);
    };
    line(p1, c.trace.map(([, s, , he]) => [p1.X(s - crest), p1.Y(he)]));
    line(p2, c.trace.map(([, s, v]) => [p2.X(s - crest), p2.Y(v)]));
    line(p3, c.trace.map(([t, s]) => [p3.X(t), p3.Y(s - crest)]));
    // what went wrong, at the place it happened (as results() counts it)
    if (r.impact_mps != null && r.impact_mps > (c.careful ? sim.options.careful_mps : lim) + 1e-9) {
      const at = c.rec.impacts.find((i) => i.inTrack)?.s ?? c.rec.end?.s;
      problems.push({ x: at - crest, y: r.impact_mps, label: `${c.id} ${num(r.impact_mps, 2)} m/s` });
    }
    if (c.misrouted) {
      const s = yard.segment(c.misrouted.switch).s1;
      problems.push({ x: s - crest, y: speedAt(c, s), label: `${c.id} misrouted` });
    }
    if (r.stop && !r.ended) problems.push({ x: r.stop.s - crest, y: 0, label: `${c.id} stopped short` });
  }
  // a marker for each, a label only where it collides with no other (the marker's tooltip has it anyway)
  const placed = [];
  for (const q of problems) {
    const x = p2.X(q.x), y = p2.Y(q.y), w = q.label.length * 6.2, box = [x + 8, y - 16, x + 8 + w, y - 3];
    const free = box[2] < L + plotW && box[1] > p2.py && placed.every((b) => box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3])
      && problems.every((o) => { const ox = p2.X(o.x), oy = p2.Y(o.y); return ox < box[0] - 6 || ox > box[2] + 6 || oy < box[1] - 6 || oy > box[3] + 6; });
    if (free) placed.push(box);
    p2.g.push(`<g class="problem"><title>${esc(q.label)}</title><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5"/><path d="M${(x - 3).toFixed(1)},${(y - 3).toFixed(1)}l6,6m0,-6l-6,6"/>${free ? `<text class="tag" x="${box[0].toFixed(1)}" y="${(y - 6).toFixed(1)}">${esc(q.label)}</text>` : ""}</g>`);
  }

  const H = top + 3 * panelH + 2 * gap + 48;
  const counts = { good: 0, medium: 0, bad: 0 };
  for (const c of cuts) counts[cutClass(c)]++;
  const res = sim.results();
  const title = options.title ?? `${yard.name}: ${res.cuts} cuts of ${res.trains} train${res.trains === 1 ? "" : "s"}`;
  const sub = `${res.wagons} wagons, ${num(res.cuts_per_hour, 0)} cuts per hour · misrouted ${res.misrouted} · caught up ${res.caughtUp} · impacts too hard ${res.hard} · stopped short ${res.short} · gaps ${res.gaps}`;
  const legend = [];
  let lx = L;
  for (const k of ["good", "medium", "bad"]) {
    legend.push(`<g class="cut ${k}"><path class="line" d="M${lx},74h22"/></g><text class="legend" x="${lx + 28}" y="78">${CLASS_LABELS[k]} (${counts[k]})</text>`);
    lx += 170;
  }
  legend.push(`<g class="problem"><circle cx="${lx + 6}" cy="74" r="5"/><path d="M${lx + 3},71l6,6m0,-6l-6,6"/></g><text class="legend" x="${lx + 18}" y="78">Too hard, misrouted or stopped short</text>`);
  const css = (m) => `--good:${m.good};--medium:${m.medium};--bad:${m.bad};--problem:${m.problem};--surface:${m.surface};--ink:${m.ink};--muted:${m.muted};--grid:${m.grid};--wash:${m.wash}`;
  const style = `svg{${css(DIAGRAM_COLOURS.light)}}@media (prefers-color-scheme: dark){svg{${css(DIAGRAM_COLOURS.dark)}}}`
    + `text{font-family:${FONT.replace(/"/g, "'")};fill:var(--ink)}.t{font-size:18px;font-weight:600}.s,.legend,.h{font-size:13px}.h{font-weight:600}.tick,.label,.note,.tag{font-size:11px;fill:var(--muted)}.tag{fill:var(--ink)}`
    + `.bg{fill:var(--surface)}.grid{stroke:var(--grid);stroke-width:1}.axis{stroke:var(--muted);stroke-width:1}.ref{stroke:var(--problem);stroke-width:1}.band{fill:var(--wash)}.ground{fill:none;stroke:var(--muted);stroke-width:1}`
    + `.cut .line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round;opacity:.85}.cut .hit{fill:none;stroke:transparent;stroke-width:10}.cut:hover .line{stroke-width:3.5;opacity:1}`
    + `.good .line{stroke:var(--good)}.medium .line{stroke:var(--medium)}.bad .line{stroke:var(--bad)}.problem circle{fill:var(--problem);stroke:var(--surface);stroke-width:2}.problem path{stroke:var(--surface);stroke-width:1.6;fill:none}`;
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="hump-title hump-desc">`);
  out.push(`<title id="hump-title">${esc(title)}</title><desc id="hump-desc">${esc(`${sub}. Three diagrams: the height of the routes with each cut's energy line, each cut's speed over the distance from the crest, and its distance over time; each cut is a line in the colour of its rolling class.`)}</desc>`);
  out.push(`<style>${style}</style><rect class="bg" width="${W}" height="${H}"/>`);
  out.push(`<text class="t" x="${L}" y="30">${esc(title)}</text><text class="s" x="${L}" y="50">${esc(sub)}</text>`, ...legend);
  for (const p of panels) out.push(...p.g, "</g>");
  out.push("</svg>");
  return `${out.join("\n")}\n`;
}

/** A cut's speed where its front was at s (from its trace). */
function speedAt(cut, s) {
  const tr = cut.trace;
  for (let i = 1; i < tr.length; i++) if (tr[i][1] >= s) return tr[i - 1][2];
  return tr.length ? tr[tr.length - 1][2] : 0;
}
