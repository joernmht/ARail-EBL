// Deck cards for model wagons: one card per wagon with one rolling-stock tag (AprilTag 36h11) per
// container spot, at the exact spot pitch of the wagon type. Pure functions (no DOM), so that the
// geometry and the SVG text can be tested in Node; the marker page puts the SVG on screen.
import { CARRIER_TYPES, CONTAINER_WIDTH_M } from "../arail/terminal/model.js";
import { encodeTag } from "../arail/terminal/rolling.js";

/** Paper sizes in mm (portrait). */
export const PAPER = { a4: [210, 297], letter: [215.9, 279.4], a3: [297, 420] };
/** Free border of every sheet (mm). */
export const PAGE_MARGIN = 10;
/** Marker family of the deck cards, fixed: the only one never misread as ArUco Original. */
export const DECK_DICTIONARY = "APRILTAG_36h11";
/** Number of IDs of AprilTag 36h11. */
export const DECK_CODES = 587;
/** Model scales offered for deck cards. */
export const DECK_SCALES = [
  { scale: 87, label: "H0 (1:87)" },
  { scale: 120, label: "TT (1:120)" },
  { scale: 160, label: "N (1:160)" },
];

const SVG_NS = "http://www.w3.org/2000/svg";
const FONT = 'font-family="Archivo, Arial, sans-serif"';
const ARROW_W = 12; // room right of a card for the "A ▶" arrow (mm)
const LABEL_H = 7; // band below a card for its label (mm)
const GAP = 6; // between cards (mm)

/** Round to 0.001 mm for the SVG text. */
export function fmt(v) {
  return Number(v.toFixed(3));
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * One marker (black square with white cells) at (x, y) with edge `size` mm.
 * @param {number[][]} bits rows of 0/1 cells (without the black border)
 */
export function markerSvg(bits, x, y, size) {
  const n = bits.length + 2, c = size / n;
  let s = `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(size)}" height="${fmt(size)}" fill="#000"/>`;
  bits.forEach((row, i) => row.forEach((b, j) => {
    if (b) s += `<rect x="${fmt(x + (j + 1) * c)}" y="${fmt(y + (i + 1) * c)}" width="${fmt(c + 0.01)}" height="${fmt(c + 0.01)}" fill="#fff"/>`;
  }));
  return s;
}

/**
 * The 100 mm scale bar and a caption, in the 14 mm kept free at the bottom of a sheet.
 * @param {number} H sheet height (mm)
 * @param {string} caption
 */
export function scaleBarSvg(H, caption) {
  const by = H - PAGE_MARGIN - 9;
  let s = `<g ${FONT} font-size="3" fill="#222">`;
  s += `<rect x="${PAGE_MARGIN}" y="${by}" width="100" height="2" fill="#222"/>`;
  for (let i = 0; i <= 10; i++) s += `<rect x="${fmt(PAGE_MARGIN + i * 10 - 0.15)}" y="${by - 2}" width="0.3" height="${i % 5 ? 2 : 3}" fill="#222"/>`;
  s += `<text x="${PAGE_MARGIN + 104}" y="${by + 2}">100 mm: check with a ruler</text>`;
  return `${s}<text x="${PAGE_MARGIN}" y="${by + 7}">${esc(caption)}</text></g>`;
}

/**
 * Wagon numbers from text like "1-6" or "1, 3, 8-10" (a leading W is allowed).
 * @param {string} text
 * @returns {number[]} ascending, without duplicates
 */
export function parseWagons(text) {
  const out = new Set();
  const parts = String(text).split(/[,;\s]+/).filter(Boolean);
  if (!parts.length) throw new Error("Enter wagon numbers, for example 1-6");
  for (const part of parts) {
    const m = part.match(/^W?(\d+)(?:-W?(\d+))?$/i);
    if (!m) throw new Error(`“${part}” is not a wagon number or a range like 1-6`);
    const a = Number(m[1]), b = m[2] != null ? Number(m[2]) : a;
    if (Math.min(a, b) < 1) throw new Error("Wagon numbers start at 1");
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) {
      out.add(n);
      if (out.size > 200) throw new Error("At most 200 cards at a time");
    }
  }
  return [...out].sort((x, y) => x - y);
}

/**
 * Deck cards of model wagons. A card is as wide as a container; along it (x from the B end, so
 * slot 0 at the A end is on the right) it spans the outer spot centres plus a tag and a white
 * margin at each end. Each tag sits at its spot centre, with its x axis towards the A end.
 * @param {object} options
 * @param {string | object} options.type key of `CARRIER_TYPES` or a carrier type
 * @param {number[]} options.numbers wagon numbers (from 1)
 * @param {number} options.stride IDs per wagon
 * @param {number} options.size_mm black square of a tag
 * @param {number} options.scale model scale (87 = H0)
 * @param {number} [options.margin_mm] white margin around the tags at the card's ends
 * @returns {{number: number, width_mm: number, length_mm: number, tags: {id: number, slot: number, x_mm: number, y_mm: number}[],
 *   label: string, size_mm: number, scale: number, typeLabel: string}[]}
 */
export function deckCards({ type, numbers, stride, size_mm, scale, margin_mm = 2.5 }) {
  const t = typeof type === "string" ? CARRIER_TYPES[type] : type;
  if (!t?.bays_m?.length) throw new Error(`Unknown wagon type “${type}”`);
  if (!(Number.isInteger(stride) && stride >= 1 && stride <= 8)) throw new Error("IDs per wagon must be a whole number from 1 to 8");
  const bays = t.bays_m.length, last = bays - 1;
  if (bays > stride) throw new Error(`${t.label} has ${bays} container spots: use at least ${bays} IDs per wagon`);
  if (!(scale > 0)) throw new Error("Choose a model scale");
  if (!(size_mm > 0)) throw new Error("Enter the tag size in millimetres");
  const mm = (m) => (m * 1000) / scale;
  const width = mm(CONTAINER_WIDTH_M);
  let pitch = Infinity;
  for (let k = 1; k < bays; k++) pitch = Math.min(pitch, mm(t.bays_m[k - 1] - t.bays_m[k]));
  const max = Math.min(width, pitch) - 2 * margin_mm;
  if (size_mm > max + 1e-9) throw new Error(`Tags of ${size_mm} mm do not fit on the deck (at most ${Math.floor(max * 10) / 10} mm)`);
  const length = mm(t.bays_m[0] - t.bays_m[last]) + size_mm + 2 * margin_mm;
  return numbers.map((number) => {
    const ids = t.bays_m.map((_, slot) => encodeTag(number, slot, stride));
    if (ids[last] >= DECK_CODES) throw new Error(`Wagon ${number} needs ID ${ids[last]}; AprilTag 36h11 has ${DECK_CODES} IDs`);
    return {
      number, width_mm: width, length_mm: length,
      tags: ids.map((id, slot) => ({ id, slot, x_mm: margin_mm + size_mm / 2 + mm(t.bays_m[slot] - t.bays_m[last]), y_mm: width / 2 })),
      label: `W${number} · ${t.label} · ${bays > 1 ? `IDs ${ids[0]}–${ids[last]}` : `ID ${ids[0]}`}`,
      size_mm, scale, typeLabel: t.label,
    };
  });
}

/**
 * Sheets of deck cards as SVG in millimetres (printing at 100 % gives exact sizes). Each card is
 * a white rectangle with a grey outline (cut along it) holding only its tags; the arrow to the A
 * end is right of the card and the label below it. Cards longer than the usable width of a
 * portrait sheet make the sheets landscape.
 * @param {ReturnType<typeof deckCards>} cards
 * @param {object} options
 * @param {string | number[]} [options.paper] key of {@link PAPER} or [width, height] in mm (portrait)
 * @param {(id: number) => number[][]} options.bitsOf cells of a tag
 * @param {boolean} [options.labels] print the labels below the cards
 * @returns {{pages: string[], count: number, sheets: {width_mm: number, height_mm: number, landscape: boolean, body: string}[]}}
 *   pages: one `<svg>` per sheet; count: tags on all cards; sheets: size and content of each sheet
 */
export function deckSheets(cards, { paper = "a4", bitsOf, labels = true }) {
  if (!cards.length) return { pages: [], count: 0, sheets: [] };
  const [PW, PH] = Array.isArray(paper) ? paper : PAPER[paper] || PAPER.a4;
  const blockW = Math.max(0, ...cards.map((c) => c.length_mm)) + ARROW_W;
  const blockH = Math.max(0, ...cards.map((c) => c.width_mm)) + (labels ? LABEL_H : 0);
  const landscape = blockW > PW - 2 * PAGE_MARGIN;
  const [W, H] = landscape ? [PH, PW] : [PW, PH];
  const usableW = W - 2 * PAGE_MARGIN, usableH = H - 2 * PAGE_MARGIN - 14; // room for the scale bar
  const cols = Math.floor((usableW + GAP) / (blockW + GAP)), rows = Math.floor((usableH + GAP) / (blockH + GAP));
  if (cols < 1 || rows < 1) throw new Error("The cards are too large for this paper");
  const perPage = cols * rows, total = Math.ceil(cards.length / perPage);
  const x0 = PAGE_MARGIN + (usableW - cols * blockW - (cols - 1) * GAP) / 2;
  const sheets = [];
  for (let p = 0; p < total; p++) {
    let body = `<rect width="${W}" height="${H}" fill="#fff"/>`;
    cards.slice(p * perPage, (p + 1) * perPage).forEach((card, k) => {
      const x = x0 + (k % cols) * (blockW + GAP), y = PAGE_MARGIN + Math.floor(k / cols) * (blockH + GAP);
      const L = card.length_mm, w = card.width_mm, s = card.size_mm;
      body += `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(L)}" height="${fmt(w)}" fill="#fff" stroke="#8a8a8a" stroke-width="0.2"/>`;
      for (const tag of card.tags) body += markerSvg(bitsOf(tag.id), x + tag.x_mm - s / 2, y + tag.y_mm - s / 2, s);
      // the arrow to the A end (slot 0) and the label stay outside the card, off the tags' white margin
      const ax = x + L + 2, ay = y + w / 2;
      body += `<g ${FONT} fill="#222"><text x="${fmt(ax)}" y="${fmt(ay + 1.4)}" font-size="4" font-weight="700">A</text>`;
      body += `<path d="M${fmt(ax + 3.6)} ${fmt(ay - 2)}L${fmt(ax + 7.2)} ${fmt(ay)}L${fmt(ax + 3.6)} ${fmt(ay + 2)}Z"/></g>`;
      if (labels) body += `<text x="${fmt(x)}" y="${fmt(y + w + 4.6)}" ${FONT} font-size="3.4" font-weight="700" fill="#222">${esc(card.label)}</text>`;
    });
    const first = cards[0];
    body += scaleBarSvg(H, `AprilTag 36h11, ${first.size_mm} mm · ${first.typeLabel} at 1:${first.scale} · ARail-EBL deck cards ${p + 1}/${total}`);
    sheets.push({ width_mm: W, height_mm: H, landscape, body });
  }
  const pages = sheets.map((sh, p) => `<svg xmlns="${SVG_NS}" class="sheet" width="${sh.width_mm}mm" height="${sh.height_mm}mm" viewBox="0 0 ${sh.width_mm} ${sh.height_mm}" role="img" aria-label="Deck card sheet ${p + 1}">${sh.body}</svg>`);
  return { pages, count: cards.reduce((n, c) => n + c.tags.length, 0), sheets };
}
