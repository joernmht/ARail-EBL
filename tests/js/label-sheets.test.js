// Markers and wagon tags on sticker sheets (marker page, paper = a sticker sheet): the grid of
// the products, the fit checks, the first free sticker, and the SVG.
import assert from "node:assert/strict";
import test from "node:test";

import { markerBits } from "../../web/arail/core/detector.js";
import { DECK_DICTIONARY, deckCards } from "../../web/markers/deck-cards.js";
import { EDGE_MM, LABEL_SHEETS, deckLabelSheets, labelGrid, markerLabelSheets, maxMarkerOnLabel, maxTagOnLabel } from "../../web/markers/label-sheets.js";
import { loadAruco } from "./helpers.js";

const { AR } = loadAruco();
const aruco = (id) => markerBits(AR, "ARUCO", id);
const tagBits = (id) => markerBits(AR, DECK_DICTIONARY, id);
const H0 = { stride: 4, size_mm: 20, scale: 87 };

function elements(svg, tag) {
  return [...svg.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "g"))].map((m) => Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])));
}
const black = (svg) => elements(svg, "rect").filter((r) => r.fill === "#000").map((r) => ({ x: Number(r.x), y: Number(r.y), size: Number(r.width) }));

test("the HERMA sheets lie on A4 with the advertised number of stickers", () => {
  const a = labelGrid(LABEL_SHEETS.herma10109), b = labelGrid(LABEL_SHEETS.herma4347);
  assert.equal(a.cells.length, 12);
  assert.equal(b.cells.length, 27);
  for (const [sheet, { W, H, cells }] of [[LABEL_SHEETS.herma10109, a], [LABEL_SHEETS.herma4347, b]]) {
    assert.deepEqual([W, H], [210, 297]);
    const last = cells.at(-1);
    assert.ok(last.x + sheet.width_mm <= W && last.y + sheet.height_mm <= H);
  }
  assert.deepEqual(b.cells[4], { x: 7.8 + 66.5, y: 15.5 + 29.6 });
  assert.throws(() => labelGrid({ ...LABEL_SHEETS.herma4347, pitch_x_mm: 60 }), /overlap/);
  assert.throws(() => labelGrid({ ...LABEL_SHEETS.herma4347, cols: 4 }), /beyond the paper/);
  assert.throws(() => labelGrid({ ...LABEL_SHEETS.herma4347, rows: 2.5 }), /whole number/);
});

test("largest marker and tag on a sticker", () => {
  assert.equal(maxMarkerOnLabel(LABEL_SHEETS.herma10109, 7, true), 40.5);
  assert.equal(maxMarkerOnLabel(LABEL_SHEETS.herma10109, 7, false), 44);
  assert.equal(maxTagOnLabel(LABEL_SHEETS.herma4347, 8), 21);
});

test("layout markers on HERMA 10109: one per sticker, centred, the border white", () => {
  const sheet = LABEL_SHEETS.herma10109;
  const { pages, sheets, perSheet } = markerLabelSheets([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], { sheet, size_mm: 40, bitsOf: aruco });
  assert.equal(perSheet, 12);
  assert.equal(pages.length, 2);
  const sq = black(sheets[0].body);
  assert.equal(sq.length, 12);
  const { cells } = labelGrid(sheet);
  sq.forEach((m, k) => {
    const c = cells[k], cell = 40 / 7;
    assert.ok(Math.abs(m.x - (c.x + 10)) < 1e-6, "centred across");
    assert.ok(m.y >= c.y + EDGE_MM + cell - 1e-6 && m.y + m.size <= c.y + 60 - EDGE_MM - 4.5 - cell + 1e-6, "a white cell above and below");
  });
  // the outlines are guides on screen only, not in the printed body
  assert.ok(!sheets[0].body.includes("stroke-dasharray"));
  assert.match(pages[0], /class="guide"/);
  assert.throws(() => markerLabelSheets([0], { sheet, size_mm: 41, bitsOf: aruco }), /^Error: Markers of 41 mm do not fit on these stickers \(at most 40\.5 mm\)$/);
});

test("first free sticker, printer correction and test print", () => {
  const sheet = LABEL_SHEETS.herma10109;
  const base = markerLabelSheets([0], { sheet, size_mm: 30, bitsOf: aruco });
  const late = markerLabelSheets([0, 1], { sheet, size_mm: 30, bitsOf: aruco, start: 12, offset_mm: [0.5, -1] });
  assert.equal(late.pages.length, 2);
  const { cells } = labelGrid(sheet);
  const a = black(base.sheets[0].body)[0], b = black(late.sheets[0].body)[0];
  assert.ok(Math.abs(b.x - a.x - (cells[11].x - cells[0].x) - 0.5) < 1e-6);
  assert.ok(Math.abs(b.y - a.y - (cells[11].y - cells[0].y) + 1) < 1e-6);
  assert.equal((late.sheets[0].guides.match(/fill-opacity="0.35"/g) || []).length, 11, "used stickers shaded");
  assert.throws(() => markerLabelSheets([0], { sheet, size_mm: 30, bitsOf: aruco, start: 13 }), /from 1 to 12/);
  assert.throws(() => markerLabelSheets([0], { sheet, size_mm: 30, bitsOf: aruco, offset_mm: [6, 0] }), /correction/);
  const t = markerLabelSheets([0], { sheet, size_mm: 30, bitsOf: aruco, test: true }).sheets[0].body;
  assert.equal((t.match(/stroke="#8a8a8a"/g) || []).length, 12);
  assert.match(t, /100 mm: check with a ruler/);
});

test("wagon tags on HERMA 4347: one sticker per spot, the tag on the sticker's centre", () => {
  const cards = deckCards({ type: "sgns60", numbers: [1, 2], ...H0 });
  const { sheets, count, warnings, perSheet } = deckLabelSheets(cards, { sheet: LABEL_SHEETS.herma4347, bitsOf: tagBits });
  assert.equal(perSheet, 27);
  assert.equal(count, 6);
  const sq = black(sheets[0].body);
  assert.equal(sq.length, 6);
  const { cells } = labelGrid(LABEL_SHEETS.herma4347);
  sq.forEach((m, k) => {
    assert.ok(Math.abs(m.x + 10 - (cells[k].x + 31.75)) < 1e-6 && Math.abs(m.y + 10 - (cells[k].y + 14.8)) < 1e-6);
  });
  const texts = [...sheets[0].body.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  assert.deepEqual(texts.filter((t) => /^(W\d|Spot|ID)/.test(t)).slice(0, 6), ["W1", "Spot 0", "ID 0", "W1", "Spot 1", "ID 1"]);
  assert.equal(texts.filter((t) => t === "A").length, 6, "an arrow on every sticker");
  // 29.6 mm stickers on a 28.0 mm deck; 63.5 mm stickers fit the 70.1 mm pitch
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /1\.6 mm wider than the deck/);
  assert.throws(() => deckLabelSheets(deckCards({ type: "sgns60", numbers: [1], ...H0, size_mm: 22 }), { sheet: LABEL_SHEETS.herma4347, bitsOf: tagBits }), /at most 21 mm/);
  // N scale: the pitch is shorter than the sticker
  const n = deckLabelSheets(deckCards({ type: "sgns60", numbers: [1], ...H0, size_mm: 10, scale: 160 }), { sheet: LABEL_SHEETS.herma4347, bitsOf: tagBits });
  assert.ok(n.warnings.some((w) => /trim each end by 12\.7 mm/.test(w)), n.warnings.join(" | "));
});
