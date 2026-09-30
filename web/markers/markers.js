// Printable marker sheets (SVG in millimetres, so printing at 100 % gives exact sizes).
import { DICTIONARIES, markerBits } from "../arail/core/detector.js";

const $ = (id) => document.getElementById(id);
const PAPER = { a4: [210, 297], letter: [215.9, 279.4], a3: [297, 420] };
const PAGE_MARGIN = 10; // mm
const SVG_NS = "http://www.w3.org/2000/svg";

function parseIds(text, max) {
  const out = new Set();
  for (const part of String(text).split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`“${part}” is not an ID or a range like 0-7`);
    const a = Number(m[1]), b = m[2] != null ? Number(m[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
      if (i >= max) throw new Error(`ID ${i} does not exist in this dictionary (0–${max - 1})`);
      out.add(i);
      if (out.size > 500) throw new Error("At most 500 markers at a time");
    }
  }
  return [...out];
}

function fmt(v) {
  return Number(v.toFixed(3));
}

/** One marker (black square with white cells) at (x, y) with edge `size` mm. */
function markerSvg(bits, x, y, size) {
  const n = bits.length + 2, c = size / n;
  let s = `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(size)}" height="${fmt(size)}" fill="#000"/>`;
  bits.forEach((row, i) => row.forEach((b, j) => {
    if (b) s += `<rect x="${fmt(x + (j + 1) * c)}" y="${fmt(y + (i + 1) * c)}" width="${fmt(c + 0.01)}" height="${fmt(c + 0.01)}" fill="#fff"/>`;
  }));
  return s;
}

function build() {
  const dict = $("dict").value;
  const def = DICTIONARIES.find((d) => d.name === dict);
  const size = Number($("size").value), margin = Number($("margin").value);
  const [W, H] = PAPER[$("paper").value];
  const labels = $("labels").checked, cut = $("cutlines").checked;
  const ids = parseIds($("ids").value, window.AR.DICTIONARIES[dict].codeList.length);
  if (!(size >= 5) || !(margin >= 0)) throw new Error("Enter a size and a border in millimetres");
  const labelH = labels ? 6 : 0;
  const cellW = size + 2 * margin, cellH = size + 2 * margin + labelH;
  const usableW = W - 2 * PAGE_MARGIN, usableH = H - 2 * PAGE_MARGIN - 14; // room for the scale bar
  const cols = Math.floor(usableW / cellW), rows = Math.floor(usableH / cellH);
  if (cols < 1 || rows < 1) throw new Error("The markers are too large for this paper");
  const perPage = cols * rows;
  const pages = [], bodies = [];
  for (let p = 0; p * perPage < ids.length; p++) {
    const chunk = ids.slice(p * perPage, (p + 1) * perPage);
    const x0 = PAGE_MARGIN + (usableW - cols * cellW) / 2;
    let body = `<rect width="${W}" height="${H}" fill="#fff"/>`;
    chunk.forEach((id, k) => {
      const cx = x0 + (k % cols) * cellW, cy = PAGE_MARGIN + Math.floor(k / cols) * cellH;
      if (cut) body += `<rect x="${fmt(cx)}" y="${fmt(cy)}" width="${fmt(cellW)}" height="${fmt(cellH)}" fill="none" stroke="#bbb" stroke-width="0.2" stroke-dasharray="1.5 1.5"/>`;
      body += markerSvg(markerBits(window.AR, dict, id), cx + margin, cy + margin, size);
      if (labels) body += `<text x="${fmt(cx + cellW / 2)}" y="${fmt(cy + margin + size + 4.2)}" font-family="Archivo, Arial, sans-serif" font-size="3.4" font-weight="700" text-anchor="middle" fill="#222">ID ${id}</text>`;
    });
    // 100 mm scale bar to verify the print scale
    const by = H - PAGE_MARGIN - 6;
    body += `<g font-family="Archivo, Arial, sans-serif" font-size="3" fill="#222">`;
    body += `<rect x="${PAGE_MARGIN}" y="${by}" width="100" height="2" fill="#222"/>`;
    for (let i = 0; i <= 10; i++) body += `<rect x="${fmt(PAGE_MARGIN + i * 10 - 0.15)}" y="${by - 2}" width="0.3" height="${i % 5 ? 2 : 3}" fill="#222"/>`;
    body += `<text x="${PAGE_MARGIN + 104}" y="${by + 2}">100 mm: check with a ruler · ${def.label}, ${size} mm · ARail-EBL marker sheet ${p + 1}/${Math.ceil(ids.length / perPage)}</text></g>`;
    bodies.push(body);
    pages.push(`<svg xmlns="${SVG_NS}" class="sheet" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" role="img" aria-label="Marker sheet ${p + 1}">${body}</svg>`);
  }
  return { pages, bodies, W, H, count: ids.length, perPage };
}

/** All sheets in one SVG file, one below the other (each at its exact size). */
function combinedSvg({ bodies, W, H }) {
  const gap = 10, total = bodies.length * H + (bodies.length - 1) * gap;
  const groups = bodies.map((b, i) => `<g transform="translate(0 ${i * (H + gap)})">${b}</g>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="${SVG_NS}" width="${W}mm" height="${fmt(total)}mm" viewBox="0 0 ${W} ${fmt(total)}">${groups}</svg>\n`;
}

function render() {
  const status = $("status");
  try {
    const { pages, W, H, count } = build();
    document.documentElement.style.setProperty("--sheet-w", `${W}mm`);
    document.documentElement.style.setProperty("--sheet-h", `${H}mm`);
    $("sheets").innerHTML = pages.join("");
    status.classList.remove("error");
    status.textContent = `${count} marker${count === 1 ? "" : "s"} on ${pages.length} sheet${pages.length === 1 ? "" : "s"}.`;
  } catch (err) {
    status.classList.add("error");
    status.textContent = err.message;
  }
}

function init() {
  const sel = $("dict");
  for (const d of DICTIONARIES) {
    if (!window.AR?.DICTIONARIES[d.name]) continue;
    const o = document.createElement("option");
    o.value = d.name;
    o.textContent = `${d.label} (OpenCV ${d.opencv})`;
    sel.append(o);
  }
  sel.value = new URLSearchParams(location.search).get("dict") || "ARUCO";
  for (const id of ["dict", "ids", "size", "margin", "paper", "labels", "cutlines"]) $(id).addEventListener("input", render);
  $("settings").addEventListener("submit", (e) => e.preventDefault());
  $("print").addEventListener("click", () => window.print());
  $("svg").addEventListener("click", () => {
    const blob = new Blob([combinedSvg(build())], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `arail-markers-${$("dict").value.toLowerCase()}-${$("size").value}mm.svg`;
    document.body.append(a);
    a.click();
    a.remove();
  });
  render();
}

init();
