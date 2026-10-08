// Self-adhesive label sheets (A4, e.g. HERMA): one marker per label, at the label positions of the sheet.
// Layout markers get one marker per label; for model wagons each label is one container spot (a
// 40 ft spot covers two bays and so takes two labels). Pure functions (no DOM), like deck-cards.js.
import { CARRIER_TYPES } from "../arail/terminal/model.js";
import { encodeTag } from "../arail/terminal/rolling.js";
import { DECK_CODES, fmt, markerSvg } from "./deck-cards.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const FONT = 'font-family="Archivo, Arial, sans-serif"';

/**
 * Label sheets: A4 portrait, label size, grid, position of the first label's top left corner and
 * the pitch from label to label (mm). The positions are the nominal sheet layout; the shift of
 * {@link labelSheets} corrects a printer that prints off-centre.
 */
export const LABEL_SHEETS = Object.freeze({
  labels60x60: {
    label: "Labels 60 × 60 mm, 12 per A4 (e.g. HERMA 10109)", name: "60 × 60 mm labels", paper: [210, 297],
    w: 60, h: 60, cols: 3, rows: 4, left: 7.5, top: 17.25, pitchX: 67.5, pitchY: 67.5,
  },
  labels63x30: {
    label: "Labels 63.5 × 29.6 mm, 27 per A4 (e.g. HERMA 4338)", name: "63.5 × 29.6 mm labels", paper: [210, 297],
    w: 63.5, h: 29.6, cols: 3, rows: 9, left: 7.25, top: 15.3, pitchX: 66, pitchY: 29.6,
  },
});

/** Paper key of a label sheet measured by the user (see {@link customSheet}). */
export const CUSTOM_SHEET = "custom";

/** Narrowest white border between a marker and the edge of its label (mm). */
export const LABEL_MIN_BORDER_MM = 2.5;
/** Band below the marker for its ID on square labels (mm). */
const TEXT_BAND_MM = 5;
/** Side space needed to write beside the marker on wide labels (mm). */
const SIDE_TEXT_MM = 11;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The label sheet of a key, or null (a paper size like "a4" is not a label sheet). */
export function labelSheet(key) {
  return Object.hasOwn(LABEL_SHEETS, key) ? LABEL_SHEETS[key] : null;
}

/**
 * A label sheet of any make, from its measurements (mm, A4 portrait): label size, grid, top left
 * corner of the first label and the pitch from label to label (label size plus gap).
 * @param {{w: number, h: number, cols: number, rows: number, left: number, top: number, pitchX: number, pitchY: number}} m
 */
export function customSheet(m) {
  const v = Object.fromEntries(["w", "h", "cols", "rows", "left", "top", "pitchX", "pitchY"].map((k) => [k, Number(m[k])]));
  const paper = [210, 297];
  if (!(v.w >= 10 && v.h >= 10)) throw new Error("Enter the label size (at least 10 × 10 mm)");
  if (!(Number.isInteger(v.cols) && v.cols >= 1 && Number.isInteger(v.rows) && v.rows >= 1)) throw new Error("Enter the labels across and down as whole numbers");
  if (!(v.left >= 0 && v.top >= 0)) throw new Error("Enter where the first label starts");
  if ((v.cols > 1 && !(v.pitchX >= v.w)) || (v.rows > 1 && !(v.pitchY >= v.h))) throw new Error("The pitch is label size plus gap: at least the label size");
  const right = v.left + (v.cols - 1) * (v.cols > 1 ? v.pitchX : 0) + v.w, bottom = v.top + (v.rows - 1) * (v.rows > 1 ? v.pitchY : 0) + v.h;
  if (right > paper[0] + 0.05 || bottom > paper[1] + 0.05) throw new Error(`These labels do not fit on A4 (they reach ${fmt(right)} × ${fmt(bottom)} mm)`);
  const name = `${fmt(v.w)} × ${fmt(v.h)} mm labels`;
  return { label: `${name}, ${v.cols * v.rows} per A4`, name, paper, ...v };
}

/**
 * Rolling-stock tags of model wagons, one per container spot (label), wagon by wagon from the A
 * end. With `type` "all" every one of the `stride` IDs of a wagon is printed (spare tags, e.g. a
 * set of IDs 0–99 for W1–W25 at stride 4).
 * @param {{type: string, numbers: number[], stride: number}} options
 * @returns {{id: number, lines: string[], arrow: boolean}[]}
 */
export function spotTags({ type, numbers, stride }) {
  if (!(Number.isInteger(stride) && stride >= 1 && stride <= 8)) throw new Error("IDs per wagon must be a whole number from 1 to 8");
  let spots = stride, label = "";
  if (type !== "all") {
    const t = CARRIER_TYPES[type];
    if (!t?.bays_m?.length) throw new Error(`Unknown wagon type “${type}”`);
    spots = t.bays_m.length;
    if (spots > stride) throw new Error(`${t.label} has ${spots} container spots: use at least ${spots} IDs per wagon`);
    label = t.label.replace(/\s*\(.*\)$/, "");
  }
  const out = [];
  for (const number of numbers) {
    for (let slot = 0; slot < spots; slot++) {
      const id = encodeTag(number, slot, stride);
      if (id >= DECK_CODES) throw new Error(`Wagon ${number} needs ID ${id}; AprilTag 36h11 has ${DECK_CODES} IDs`);
      out.push({ id, lines: [`ID ${id}`, `W${number} · spot ${slot}`, label].filter(Boolean), arrow: true });
      if (out.length > 600) throw new Error("At most 600 labels at a time");
    }
  }
  return out;
}

/**
 * Largest marker that fits on a label with `border` mm of white around it.
 * @param {object} sheet entry of {@link LABEL_SHEETS}
 * @param {number} border white border (mm)
 * @param {boolean} text room for the ID on the label
 */
export function largestMarker(sheet, border, text) {
  const { w, h } = sheet;
  if (w - h >= 2 * SIDE_TEXT_MM) return h - 2 * border; // wide label: text beside the marker
  return Math.min(w, h - (text ? TEXT_BAND_MM : 0)) - 2 * border;
}

/**
 * Sheets of labels, one marker per label, as SVG in millimetres (print at 100 %).
 * On a square label the ID goes below the marker; on a wide label the text is left of the marker
 * and, for wagon tags, an "A ▶" arrow right of it points to the A end (the tag's x axis).
 * @param {{id: number, lines?: string[], arrow?: boolean}[]} items one per label, in order
 * @param {object} options
 * @param {string | object} options.sheet key of {@link LABEL_SHEETS}, or a sheet from {@link customSheet}
 * @param {(id: number) => number[][]} options.bitsOf cells of a marker
 * @param {number} options.size_mm black square of the markers
 * @param {number} [options.border_mm] least white border around a marker
 * @param {boolean} [options.labels] print the text
 * @param {boolean} [options.outlines] draw the label outlines (for a test print on plain paper)
 * @param {number} [options.skip] labels to leave empty at the start of the first sheet (already used)
 * @param {number[]} [options.shift] printer correction [right, down] in mm
 * @param {string} [options.caption] text in the top margin
 * @returns {{pages: string[], sheets: {width_mm: number, height_mm: number, body: string}[], perSheet: number}}
 */
export function labelSheets(items, { sheet: key, bitsOf, size_mm, border_mm = LABEL_MIN_BORDER_MM, labels = true, outlines = false, skip = 0, shift = [0, 0], caption = "" }) {
  const sheet = typeof key === "object" ? key : labelSheet(key);
  if (!sheet) throw new Error(`Unknown label sheet “${key}”`);
  if (!(size_mm > 0)) throw new Error("Enter the marker size in millimetres");
  const border = Math.max(border_mm, LABEL_MIN_BORDER_MM);
  const max = largestMarker(sheet, border, labels);
  if (size_mm > max + 1e-9) throw new Error(`Markers of ${size_mm} mm do not fit on ${sheet.name} with a ${border} mm border (at most ${Math.floor(max * 10) / 10} mm)`);
  const perSheet = sheet.cols * sheet.rows;
  if (!(Number.isInteger(skip) && skip >= 0 && skip < perSheet)) throw new Error(`Skip 0 to ${perSheet - 1} labels`);
  const [W, H] = sheet.paper, [dx, dy] = shift.map((v) => Number(v) || 0);
  const wide = sheet.w - sheet.h >= 2 * SIDE_TEXT_MM;
  const slots = [...Array(skip).fill(null), ...items];
  const total = Math.max(1, Math.ceil(slots.length / perSheet));
  const sheets = [];
  for (let p = 0; p < total; p++) {
    let body = `<rect width="${W}" height="${H}" fill="#fff"/><g transform="translate(${fmt(dx)} ${fmt(dy)})">`;
    for (let k = 0; k < perSheet; k++) {
      const x = sheet.left + (k % sheet.cols) * sheet.pitchX, y = sheet.top + Math.floor(k / sheet.cols) * sheet.pitchY;
      if (outlines) body += `<rect x="${fmt(x)}" y="${fmt(y)}" width="${sheet.w}" height="${sheet.h}" rx="1" fill="none" stroke="#bbb" stroke-width="0.2"/>`;
      const item = slots[p * perSheet + k];
      if (!item) continue;
      const lines = item.lines || [`ID ${item.id}`];
      const cx = x + sheet.w / 2, mx = cx - size_mm / 2;
      if (wide) {
        const my = y + (sheet.h - size_mm) / 2;
        body += markerSvg(bitsOf(item.id), mx, my, size_mm);
        if (labels) {
          // text left of the marker, centred in the free side space
          const tx = x + (sheet.w - size_mm) / 4, fs = 2.4, y0 = y + sheet.h / 2 - ((lines.length - 1) * fs * 1.25) / 2 + fs * 0.35;
          body += `<g ${FONT} font-size="${fs}" text-anchor="middle" fill="#222">`;
          lines.forEach((line, i) => (body += `<text x="${fmt(tx)}" y="${fmt(y0 + i * fs * 1.25)}"${i ? "" : ' font-weight="700"'}>${esc(line)}</text>`));
          body += "</g>";
        }
        if (item.arrow) {
          // "A ▶" right of the marker: this edge goes to the wagon's A end
          const ax = x + sheet.w - (sheet.w - size_mm) / 4 - 4, ay = y + sheet.h / 2;
          body += `<g ${FONT} fill="#222"><text x="${fmt(ax)}" y="${fmt(ay + 1.4)}" font-size="4" font-weight="700">A</text>`;
          body += `<path d="M${fmt(ax + 3.6)} ${fmt(ay - 2)}L${fmt(ax + 7.2)} ${fmt(ay)}L${fmt(ax + 3.6)} ${fmt(ay + 2)}Z"/></g>`;
        }
      } else {
        const band = labels ? TEXT_BAND_MM : 0, my = y + (sheet.h - band - size_mm) / 2;
        body += markerSvg(bitsOf(item.id), mx, my, size_mm);
        if (labels) body += `<text x="${fmt(cx)}" y="${fmt(my + size_mm + (sheet.h - band - size_mm) / 2 + 3.4)}" ${FONT} font-size="3.4" font-weight="700" text-anchor="middle" fill="#222">${esc(lines.join(" · "))}</text>`;
      }
    }
    body += "</g>";
    // a 50 mm check bar and the caption in the top margin of the sheet (outside the labels)
    if (sheet.top >= 12) {
      const by = Math.max(4, sheet.top - 8);
      body += `<g ${FONT} font-size="2.6" fill="#222"><rect x="${sheet.left}" y="${fmt(by)}" width="50" height="1.2"/>`;
      for (let i = 0; i <= 5; i++) body += `<rect x="${fmt(sheet.left + i * 10 - 0.15)}" y="${fmt(by - 1.2)}" width="0.3" height="1.2"/>`;
      body += `<text x="${fmt(sheet.left + 53)}" y="${fmt(by + 1.2)}">50 mm · ${esc(caption)} ${p + 1}/${total}</text></g>`;
    }
    sheets.push({ width_mm: W, height_mm: H, body });
  }
  const pages = sheets.map((sh, p) => `<svg xmlns="${SVG_NS}" class="sheet" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" role="img" aria-label="Label sheet ${p + 1}">${sh.body}</svg>`);
  return { pages, sheets, perSheet };
}
