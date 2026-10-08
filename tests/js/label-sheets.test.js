// Label sheets (marker page, paper = an A4 label sheet): one marker per label at the label positions,
// one wagon tag per container spot, size limits, skipped labels and the printer shift.
import assert from "node:assert/strict";
import test from "node:test";

import { markerBits } from "../../web/arail/core/detector.js";
import { DECK_DICTIONARY } from "../../web/markers/deck-cards.js";
import { LABEL_SHEETS, customSheet, labelSheet, labelSheets, largestMarker, spotTags } from "../../web/markers/label-sheets.js";
import { loadAruco } from "./helpers.js";

const { AR } = loadAruco();
const bitsOf = (id) => markerBits(AR, DECK_DICTIONARY, id);

/** Black squares (the markers) of an SVG body: rects filled black. */
const markers = (body) => [...body.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="[\d.]+" fill="#000"\/>/g)].map((m) => m.slice(1, 4).map(Number));

test("the sheets fit on A4 and only label keys are label sheets", () => {
  for (const s of Object.values(LABEL_SHEETS)) {
    assert.ok(s.left + (s.cols - 1) * s.pitchX + s.w <= s.paper[0] + 1e-9);
    assert.ok(s.top + (s.rows - 1) * s.pitchY + s.h <= s.paper[1] + 1e-9);
  }
  assert.equal(labelSheet("a4"), null);
  assert.equal(labelSheet("labels63x30").cols * labelSheet("labels63x30").rows, 27);
  assert.equal(labelSheet("labels60x60").cols * labelSheet("labels60x60").rows, 12);
});

test("one tag per container spot; every ID with type all", () => {
  const sgns = spotTags({ type: "sgns60", numbers: [1, 2], stride: 4 });
  assert.deepEqual(sgns.map((t) => t.id), [0, 1, 2, 4, 5, 6]);
  assert.deepEqual(sgns[4].lines, ["ID 5", "W2 · spot 1", "Sgns"]);
  const all = spotTags({ type: "all", numbers: Array.from({ length: 25 }, (_, i) => i + 1), stride: 4 });
  assert.deepEqual(all.map((t) => t.id), Array.from({ length: 100 }, (_, i) => i));
  assert.throws(() => spotTags({ type: "sggrss80", numbers: [1], stride: 3 }), /4 container spots/);
});

test("100 tags on 63.5 × 29.6 mm labels: centred on their labels, 4 sheets", () => {
  const items = spotTags({ type: "all", numbers: Array.from({ length: 25 }, (_, i) => i + 1), stride: 4 });
  const { pages, sheets, perSheet } = labelSheets(items, { sheet: "labels63x30", bitsOf, size_mm: 20 });
  assert.equal(perSheet, 27);
  assert.equal(pages.length, 4);
  const s = LABEL_SHEETS.labels63x30, first = markers(sheets[0].body);
  assert.equal(first.length, 27);
  assert.deepEqual(first[0], [s.left + (s.w - 20) / 2, s.top + (s.h - 20) / 2, 20]);
  assert.deepEqual(first[4].slice(0, 2), [s.left + s.pitchX + (s.w - 20) / 2, s.top + s.pitchY + (s.h - 20) / 2]);
  assert.equal(markers(sheets[3].body).length, 100 - 3 * 27);
  assert.match(sheets[0].body, /W1 · spot 3/);
});

test("skip, shift, outlines and the size limit", () => {
  const items = [{ id: 0 }, { id: 1 }];
  const { sheets } = labelSheets(items, { sheet: "labels60x60", bitsOf, size_mm: 40, border_mm: 6, skip: 11, shift: [1.5, -2], outlines: true });
  assert.equal(sheets.length, 2);
  assert.match(sheets[0].body, /translate\(1\.5 -2\)/);
  assert.equal(markers(sheets[0].body).length, 1);
  assert.equal((sheets[1].body.match(/stroke="#bbb"/g) || []).length, 12);
  assert.equal(largestMarker(LABEL_SHEETS.labels60x60, 6, true), 43);
  assert.equal(largestMarker(LABEL_SHEETS.labels63x30, 2.5, true), 24.6);
  assert.throws(() => labelSheets(items, { sheet: "labels60x60", bitsOf, size_mm: 45, border_mm: 6 }), /at most 43 mm/);
  assert.throws(() => labelSheets(items, { sheet: "labels63x30", bitsOf, size_mm: 20, skip: 27 }), /Skip 0 to 26/);
});

test("a custom sheet from its measurements", () => {
  const s = customSheet({ w: "70", h: "37", cols: "3", rows: "8", left: "0", top: "0.5", pitchX: "70", pitchY: "37" });
  assert.equal(s.name, "70 × 37 mm labels");
  assert.equal(s.label, "70 × 37 mm labels, 24 per A4");
  const { sheets, perSheet } = labelSheets([{ id: 5 }], { sheet: s, bitsOf, size_mm: 20 });
  assert.equal(perSheet, 24);
  assert.deepEqual(markers(sheets[0].body)[0], [25, 0.5 + 8.5, 20]);
  assert.throws(() => customSheet({ w: 70, h: 37, cols: 3, rows: 9, left: 0, top: 0, pitchX: 70, pitchY: 37 }), /do not fit on A4/);
  assert.throws(() => customSheet({ w: 70, h: 37, cols: 3, rows: 2, left: 0, top: 0, pitchX: 60, pitchY: 37 }), /at least the label size/);
  assert.throws(() => customSheet({ w: 70, h: 37, cols: 2.5, rows: 2, left: 0, top: 0, pitchX: 70, pitchY: 37 }), /whole numbers/);
});
