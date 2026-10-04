// Markers and wagon tags on die-cut sticker sheets: one marker per sticker, placed on the grid
// of a label product (HERMA 10109, HERMA 4347 or a sheet you measure yourself). Pure functions
// (no DOM), so that the geometry and the SVG text can be tested in Node.
import { PAPER, fmt, markerSvg, scaleBarSvg } from "./deck-cards.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const FONT = 'font-family="Archivo, Arial, sans-serif"';
/** Distance kept free at every sticker edge, for the printer's feed tolerance (mm). */
export const EDGE_MM = 1.5;
/** Band at the bottom of a layout sticker for its ID label (mm). */
const TEXT_BAND_MM = 4.5;
/** Room right of a wagon tag for the "A ▶" arrow (mm). */
const ARROW_MM = 9;

/**
 * Sticker sheets. Lengths in mm: the sticker, the grid (columns × rows), the distance from the
 * paper's top left corner to the first sticker and the pitch from one sticker to the next.
 * `source` says where the numbers come from; `estimated` sheets must be checked with a test print.
 */
export const LABEL_SHEETS = {
  herma10109: {
    label: "HERMA 10109 · 60 × 60 mm, 12 per A4", use: "markers",
    paper: "a4", width_mm: 60, height_mm: 60, cols: 3, rows: 4, left_mm: 10, top_mm: 21, pitch_x_mm: 65, pitch_y_mm: 65,
    estimated: true, source: "estimated: the grid centred on A4 with 5 mm gaps",
  },
  herma4347: {
    label: "HERMA 4347 · 63.5 × 29.6 mm, 27 per A4", use: "rolling",
    paper: "a4", width_mm: 63.5, height_mm: 29.6, cols: 3, rows: 9, left_mm: 7.8, top_mm: 15.5, pitch_x_mm: 66.5, pitch_y_mm: 29.6,
    estimated: false, source: "gLabels template HERMA 4098, which 4347 shares",
  },
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Top left corners of all stickers of a sheet, row by row; checks the geometry.
 * @param {object} sheet see {@link LABEL_SHEETS}
 * @returns {{W: number, H: number, cells: {x: number, y: number}[]}} paper size (mm) and stickers
 */
export function labelGrid(sheet) {
  const [W, H] = PAPER[sheet.paper] || PAPER.a4;
  const { width_mm: w, height_mm: h, cols, rows, left_mm: x0, top_mm: y0, pitch_x_mm: px, pitch_y_mm: py } = sheet;
  if (!(w > 0 && h > 0)) throw new Error("Enter the sticker's width and height in millimetres");
  for (const [n, what] of [[cols, "columns"], [rows, "rows"]]) {
    if (!(Number.isInteger(n) && n >= 1 && n <= 30)) throw new Error(`The number of ${what} must be a whole number from 1 to 30`);
  }
  if (!(x0 >= 0 && y0 >= 0)) throw new Error("Enter the left and top margins in millimetres");
  if ((cols > 1 && !(px >= w - 1e-9)) || (rows > 1 && !(py >= h - 1e-9))) throw new Error("The pitch must be at least the sticker size, or the stickers overlap");
  const right = x0 + (cols - 1) * (cols > 1 ? px : 0) + w, bottom = y0 + (rows - 1) * (rows > 1 ? py : 0) + h;
  if (right > W + 0.05 || bottom > H + 0.05) throw new Error(`The stickers reach beyond the paper (${fmt(right)} × ${fmt(bottom)} mm on ${W} × ${H} mm)`);
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ x: x0 + c * px, y: y0 + r * py });
  return { W, H, cells };
}

/**
 * The largest marker that fits on a layout sticker with a white border of one cell inside the
 * edge tolerance, and the ID label below it.
 * @param {object} sheet
 * @param {number} cells cells across a marker, black border included (7 for ArUco Original)
 * @param {boolean} labels with the ID label
 */
export function maxMarkerOnLabel(sheet, cells, labels) {
  const k = cells / (cells + 2);
  const avail = Math.min(sheet.width_mm - 2 * EDGE_MM, sheet.height_mm - 2 * EDGE_MM - (labels ? TEXT_BAND_MM : 0));
  return Math.floor(avail * k * 2) / 2;
}

/**
 * The largest wagon tag on a sticker: centred, with a white border of one cell inside the edge
 * tolerance, and the arrow to the A end beside it.
 * @param {object} sheet
 * @param {number} cells cells across a tag (8 for AprilTag 36h11)
 */
export function maxTagOnLabel(sheet, cells) {
  const k = cells / (cells + 2);
  const across = (sheet.height_mm - 2 * EDGE_MM) * k;
  const along = (sheet.width_mm - 2 * (EDGE_MM + ARROW_MM)) * k;
  return Math.floor(Math.min(across, along) * 2) / 2;
}

/**
 * Lays items out on the stickers of as many sheets as needed, starting at a free sticker.
 * @param {any[]} items one per sticker
 * @param {object} sheet
 * @param {(item: any, x: number, y: number) => string} draw SVG of one sticker's content
 * @param {object} options
 * @param {number} [options.start] first free sticker on the first sheet (from 1)
 * @param {number[]} [options.offset_mm] printer correction [dx, dy], added to the content
 * @param {boolean} [options.test] test print on plain paper: sticker outlines and the scale bar
 * @param {(p: number, total: number) => string} options.caption
 */
function layOut(items, sheet, draw, { start = 1, offset_mm = [0, 0], test = false, caption }) {
  const { W, H, cells } = labelGrid(sheet);
  const per = cells.length;
  if (!(Number.isInteger(start) && start >= 1 && start <= per)) throw new Error(`The first free sticker must be a whole number from 1 to ${per}`);
  const [dx, dy] = offset_mm;
  if (!(Math.abs(dx) <= 5 && Math.abs(dy) <= 5)) throw new Error("The printer correction must be between −5 and 5 mm");
  const total = Math.max(1, Math.ceil((items.length + start - 1) / per));
  const sheets = [];
  for (let p = 0; p < total; p++) {
    let body = `<rect width="${W}" height="${H}" fill="#fff"/>`, guides = "";
    const outline = (c) => `<rect x="${fmt(c.x)}" y="${fmt(c.y)}" width="${fmt(sheet.width_mm)}" height="${fmt(sheet.height_mm)}"`;
    cells.forEach((c, k) => {
      const i = p * per + k - (start - 1);
      if (test) body += `${outline(c)} fill="none" stroke="#8a8a8a" stroke-width="0.2"/>`;
      else guides += `${outline(c)} fill="none" stroke="#5b8def" stroke-width="0.3" stroke-dasharray="1.2 1"/>`;
      // stickers already used on the first sheet: shaded on screen only
      if (i < 0) guides += `${outline(c)} fill="#9aa3ad" fill-opacity="0.35"/>`;
      else if (i < items.length) body += draw(items[i], c.x + dx, c.y + dy);
    });
    if (test) body += `<rect x="0" y="${fmt(H - 23)}" width="${W}" height="23" fill="#fff" fill-opacity="0.85"/>${scaleBarSvg(H, `Test print: hold against the sticker sheet · ${caption(p, total)}`)}`;
    sheets.push({ width_mm: W, height_mm: H, body, guides: `<g class="guide">${guides}</g>` });
  }
  return { sheets, perSheet: per, pages: sheets.map((s, p) => pageSvg(s, p)) };
}

function pageSvg(sh, p) {
  return `<svg xmlns="${SVG_NS}" class="sheet" width="${sh.width_mm}mm" height="${sh.height_mm}mm" viewBox="0 0 ${sh.width_mm} ${sh.height_mm}" role="img" aria-label="Sticker sheet ${p + 1}">${sh.body}${sh.guides}</svg>`;
}

/**
 * Layout markers on stickers: one marker per sticker, centred above its ID label.
 * @param {number[]} ids
 * @param {object} options
 * @param {object} options.sheet see {@link LABEL_SHEETS}
 * @param {number} options.size_mm black square
 * @param {(id: number) => number[][]} options.bitsOf cells of a marker (without the black border)
 * @param {boolean} [options.labels]
 * @param {string} [options.typeLabel] marker type, for the caption
 */
export function markerLabelSheets(ids, { sheet, size_mm, bitsOf, labels = true, typeLabel = "", ...rest }) {
  if (!(size_mm > 0)) throw new Error("Enter the marker size in millimetres");
  const cells = (ids.length ? bitsOf(ids[0]).length : 5) + 2;
  const max = maxMarkerOnLabel(sheet, cells, labels);
  if (size_mm > max + 1e-9) throw new Error(`Markers of ${size_mm} mm do not fit on these stickers (at most ${max} mm)`);
  const w = sheet.width_mm, band = labels ? TEXT_BAND_MM : 0;
  const draw = (id, x, y) => {
    // centred in the sticker above the label band
    const mx = x + (w - size_mm) / 2, my = y + EDGE_MM + (sheet.height_mm - 2 * EDGE_MM - band - size_mm) / 2;
    let s = markerSvg(bitsOf(id), mx, my, size_mm);
    if (labels) s += `<text x="${fmt(x + w / 2)}" y="${fmt(y + sheet.height_mm - EDGE_MM - 1)}" ${FONT} font-size="3.4" font-weight="700" text-anchor="middle" fill="#222">ID ${id}</text>`;
    return s;
  };
  return layOut(ids, sheet, draw, { ...rest, caption: (p, n) => `${typeLabel}, ${size_mm} mm · ARail-EBL markers ${p + 1}/${n}` });
}

/**
 * Wagon tags on stickers: one sticker per container spot, its centre on the spot centre. The tag
 * is centred on the sticker, the wagon and spot are left of it and the arrow to the A end right.
 * @param {ReturnType<import("./deck-cards.js").deckCards>} cards
 * @param {object} options
 * @param {object} options.sheet see {@link LABEL_SHEETS}
 * @param {(id: number) => number[][]} options.bitsOf
 * @param {boolean} [options.labels]
 * @returns {ReturnType<typeof layOut> & {count: number, warnings: string[]}}
 */
export function deckLabelSheets(cards, { sheet, bitsOf, labels = true, ...rest }) {
  const tags = cards.flatMap((card) => card.tags.map((t) => ({ ...t, number: card.number, size_mm: card.size_mm })));
  const first = cards[0];
  const s = first?.size_mm ?? 20;
  const cells = (tags.length ? bitsOf(tags[0].id).length : 6) + 2;
  const max = maxTagOnLabel(sheet, cells);
  if (s > max + 1e-9) throw new Error(`Tags of ${s} mm do not fit on these stickers with the A arrow (at most ${max} mm)`);
  const w = sheet.width_mm, h = sheet.height_mm, quiet = s / cells;
  const left = w / 2 - s / 2 - quiet - EDGE_MM; // room for the text left of the tag
  const draw = (t, x, y) => {
    const cx = x + w / 2, cy = y + h / 2;
    let out = markerSvg(bitsOf(t.id), cx - s / 2, cy - s / 2, s);
    const ax = cx + s / 2 + quiet + 1;
    out += `<g ${FONT} fill="#222"><text x="${fmt(ax)}" y="${fmt(cy + 1.4)}" font-size="4" font-weight="700">A</text>`;
    out += `<path d="M${fmt(ax + 3.6)} ${fmt(cy - 2)}L${fmt(ax + 7.2)} ${fmt(cy)}L${fmt(ax + 3.6)} ${fmt(cy + 2)}Z"/></g>`;
    if (labels && left >= 9) {
      const tx = x + EDGE_MM + left / 2;
      out += `<g ${FONT} fill="#222" text-anchor="middle"><text x="${fmt(tx)}" y="${fmt(cy - 1.5)}" font-size="5.5" font-weight="800">W${t.number}</text>`;
      out += `<text x="${fmt(tx)}" y="${fmt(cy + 2.6)}" font-size="2.8">Spot ${t.slot}</text><text x="${fmt(tx)}" y="${fmt(cy + 6)}" font-size="2.8">ID ${t.id}</text></g>`;
    }
    return out;
  };
  const out = layOut(tags, sheet, draw, { ...rest, caption: (p, n) => `AprilTag 36h11, ${s} mm · ${first?.typeLabel ?? ""} at 1:${first?.scale ?? ""} · ARail-EBL wagon tags ${p + 1}/${n}` });
  const warnings = [];
  if (first) {
    const wider = h - first.width_mm;
    if (wider > 0.4) warnings.push(`The stickers are ${fmt(Math.round(wider * 10) / 10)} mm wider than the deck (${fmt(Math.round(first.width_mm * 10) / 10)} mm): trim their long edges or let them overhang.`);
    let pitch = Infinity;
    for (const c of cards) for (let k = 1; k < c.tags.length; k++) pitch = Math.min(pitch, Math.abs(c.tags[k - 1].x_mm - c.tags[k].x_mm));
    if (w > pitch + 1e-9) warnings.push(`The stickers are longer than the spot pitch (${fmt(Math.round(pitch * 10) / 10)} mm): trim each end by ${fmt(Math.ceil((w - pitch) * 5) / 10)} mm.`);
  }
  return { ...out, count: tags.length, warnings };
}
