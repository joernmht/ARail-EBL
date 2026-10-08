// Printable marker sheets and deck cards for model wagons (SVG in millimetres, so printing at
// 100 % gives exact sizes).
import { DICTIONARIES, markerBits } from "../arail/core/detector.js";
import { CARRIER_TYPES } from "../arail/terminal/model.js";
import { DECK_DICTIONARY, DECK_SCALES, PAGE_MARGIN, PAPER, deckCards, deckSheets, fmt, markerSvg, parseWagons, scaleBarSvg } from "./deck-cards.js";
import { LABEL_MIN_BORDER_MM, LABEL_SHEETS, labelSheet, labelSheets, largestMarker, spotTags } from "./label-sheets.js";

const $ = (id) => document.getElementById(id);
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

const rolling = () => $("kind").value === "rolling";
const onLabels = () => labelSheet($("paper").value) != null;

/** Label sheet: one marker per label (layout markers, or one wagon tag per container spot). */
function buildLabels() {
  const key = $("paper").value, sheet = labelSheet(key);
  const common = {
    sheet: key, labels: $("labels").checked, outlines: $("outlines").checked,
    skip: Number($("skip").value), shift: [Number($("shiftX").value), Number($("shiftY").value)],
  };
  let items, out, what;
  if (rolling()) {
    items = spotTags({ type: $("wagonType").value, numbers: parseWagons($("wagons").value), stride: Number($("stride").value) });
    const size = Number($("tagSize").value);
    out = labelSheets(items, { ...common, bitsOf: (id) => markerBits(window.AR, DECK_DICTIONARY, id), size_mm: size, border_mm: LABEL_MIN_BORDER_MM, caption: `AprilTag 36h11, ${size} mm · ${sheet.label}` });
    what = "tag";
  } else {
    const dict = $("dict").value, def = DICTIONARIES.find((d) => d.name === dict), size = Number($("size").value);
    items = parseIds($("ids").value, window.AR.DICTIONARIES[dict].codeList.length).map((id) => ({ id }));
    out = labelSheets(items, { ...common, bitsOf: (id) => markerBits(window.AR, dict, id), size_mm: size, border_mm: Number($("margin").value), caption: `${def.label}, ${size} mm · ${sheet.label}` });
    what = "marker";
  }
  const n = items.length, k = out.pages.length, left = k * out.perSheet - common.skip - n;
  return {
    pages: out.pages, bodies: out.sheets.map((s) => s.body), W: sheet.paper[0], H: sheet.paper[1],
    status: `${n} ${what}${n === 1 ? "" : "s"} on ${k} sheet${k === 1 ? "" : "s"} of ${sheet.label}; ${left} label${left === 1 ? "" : "s"} left over.`,
  };
}

function buildMarkers() {
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
      // the label sits in its own band below the white border, which must stay empty for detection
      if (labels) body += `<text x="${fmt(cx + cellW / 2)}" y="${fmt(cy + 2 * margin + size + 4.2)}" font-family="Archivo, Arial, sans-serif" font-size="3.4" font-weight="700" text-anchor="middle" fill="#222">ID ${id}</text>`;
    });
    // 100 mm scale bar to verify the print scale, in the 14 mm kept free at the bottom
    body += scaleBarSvg(H, `${def.label}, ${size} mm · ARail-EBL marker sheet ${p + 1}/${Math.ceil(ids.length / perPage)}`);
    bodies.push(body);
    pages.push(`<svg xmlns="${SVG_NS}" class="sheet" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" role="img" aria-label="Marker sheet ${p + 1}">${body}</svg>`);
  }
  const s = ids.length === 1 ? "" : "s";
  return { pages, bodies, W, H, status: `${ids.length} marker${s} on ${pages.length} sheet${pages.length === 1 ? "" : "s"}.` };
}

/** Deck cards for model wagons: one card per wagon, a tag on each container spot. */
function buildDeckCards() {
  if ($("wagonType").value === "all") throw new Error("“Every ID per wagon” is for label sheets: choose a wagon type for deck cards");
  const cards = deckCards({
    type: $("wagonType").value, numbers: parseWagons($("wagons").value),
    stride: Number($("stride").value), size_mm: Number($("tagSize").value), scale: Number($("scale").value),
  });
  const { pages, count, sheets } = deckSheets(cards, {
    paper: $("paper").value, labels: $("labels").checked, bitsOf: (id) => markerBits(window.AR, DECK_DICTIONARY, id),
  });
  const n = cards.length, k = pages.length;
  return {
    pages, bodies: sheets.map((s) => s.body), W: sheets[0].width_mm, H: sheets[0].height_mm,
    status: `${n} card${n === 1 ? "" : "s"} with ${count} marker${count === 1 ? "" : "s"} on ${k} sheet${k === 1 ? "" : "s"}.`,
  };
}

const build = () => (onLabels() ? buildLabels() : rolling() ? buildDeckCards() : buildMarkers());

/** All sheets in one SVG file, one below the other (each at its exact size). */
function combinedSvg({ bodies, W, H }) {
  const gap = 10, total = bodies.length * H + (bodies.length - 1) * gap;
  const groups = bodies.map((b, i) => `<g transform="translate(0 ${i * (H + gap)})">${b}</g>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="${SVG_NS}" width="${W}mm" height="${fmt(total)}mm" viewBox="0 0 ${W} ${fmt(total)}">${groups}</svg>\n`;
}

function render() {
  const status = $("status");
  try {
    const { pages, W, H, status: text } = build();
    document.documentElement.style.setProperty("--sheet-w", `${W}mm`);
    document.documentElement.style.setProperty("--sheet-h", `${H}mm`);
    // paper size for printing, so that a sheet is not split when the printer's default paper differs
    $("pageSize").textContent = `@page { size: ${W}mm ${H}mm; margin: 0; }`;
    $("sheets").innerHTML = pages.join("");
    status.classList.remove("error");
    status.textContent = text;
  } catch (err) {
    status.classList.add("error");
    status.textContent = err.message;
  }
}

/** Show the settings of the chosen kind of sheet and keep it in the address (?kind=rolling). */
function applyKind() {
  const kind = rolling() ? "rolling" : "markers", paper = onLabels() ? "labels" : "plain";
  for (const el of document.querySelectorAll("[data-kind], [data-paper]")) {
    el.hidden = (el.dataset.kind != null && el.dataset.kind !== kind) || (el.dataset.paper != null && el.dataset.paper !== paper);
  }
  const sheet = labelSheet($("paper").value);
  if (sheet) {
    const border = rolling() ? LABEL_MIN_BORDER_MM : Math.max(LABEL_MIN_BORDER_MM, Number($("margin").value) || 0);
    $("labelHelp").textContent = `${sheet.cols} × ${sheet.rows} labels of ${sheet.w} × ${sheet.h} mm. Markers up to ${Math.floor(largestMarker(sheet, border, $("labels").checked) * 10) / 10} mm with a ${border} mm border.`;
    $("skip").max = String(sheet.cols * sheet.rows - 1);
  }
  const url = new URL(location.href);
  if (kind === "rolling") url.searchParams.set("kind", kind);
  else url.searchParams.delete("kind");
  if (sheet) url.searchParams.set("paper", $("paper").value);
  else url.searchParams.delete("paper");
  if (url.href !== location.href) history.replaceState(history.state, "", url);
}

function addOptions(select, options) {
  for (const [value, label] of options) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    select.append(o);
  }
}

function init() {
  const params = new URLSearchParams(location.search);
  const sel = $("dict");
  addOptions(sel, DICTIONARIES.filter((d) => window.AR?.DICTIONARIES[d.name]).map((d) => [d.name, `${d.label} (OpenCV ${d.opencv})`]));
  sel.value = params.get("dict") || "ARUCO";
  // only wagons are model rolling stock (a truck chassis is not tracked by tags)
  const wagonTypes = Object.entries(CARRIER_TYPES).filter(([, t]) => t.kind === "wagon");
  addOptions($("wagonType"), [...wagonTypes.map(([key, t]) => [key, t.label]), ["all", "Every ID per wagon (label sheets)"]]);
  addOptions($("labelOptions"), Object.entries(LABEL_SHEETS).map(([key, s]) => [key, s.label]));
  if (labelSheet(params.get("paper")) || PAPER[params.get("paper")]) $("paper").value = params.get("paper");
  addOptions($("scale"), DECK_SCALES.map((s) => [String(s.scale), s.label]));
  $("kind").value = params.get("kind") === "rolling" ? "rolling" : "markers";
  // deck card settings from the address (the Terminal tab links here with the layout's values);
  // a bad stride or tag size is shown as an error by render(), not corrected
  const type = params.get("type"), scale = params.get("scale");
  if (wagonTypes.some(([key]) => key === type) || type === "all") $("wagonType").value = type;
  if (DECK_SCALES.some((s) => String(s.scale) === scale)) $("scale").value = scale;
  for (const [param, id] of [["wagons", "wagons"], ["stride", "stride"], ["size", rolling() ? "tagSize" : "size"], ["ids", "ids"], ["skip", "skip"]]) {
    if (params.has(param)) $(id).value = params.get(param);
  }
  applyKind();
  for (const id of ["kind", "paper", "labels", "margin"]) $(id).addEventListener("input", applyKind);
  const inputs = ["kind", "dict", "ids", "size", "margin", "paper", "labels", "cutlines", "wagons", "wagonType", "stride", "tagSize", "scale", "skip", "outlines", "shiftX", "shiftY"];
  for (const id of inputs) $(id).addEventListener("input", render);
  $("settings").addEventListener("submit", (e) => e.preventDefault());
  $("print").addEventListener("click", () => window.print());
  $("svg").addEventListener("click", () => {
    const blob = new Blob([combinedSvg(build())], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const labels = onLabels() ? `-${$("paper").value}` : "";
    a.download = rolling()
      ? (labels ? `arail-wagon-tags-${$("tagSize").value}mm${labels}.svg` : `arail-deck-cards-${$("wagonType").value}-1-${$("scale").value}.svg`)
      : `arail-markers-${$("dict").value.toLowerCase()}-${$("size").value}mm${labels}.svg`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  render();
}

init();
