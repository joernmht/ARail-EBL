// Label sheets (marker page, paper = a HERMA sheet): one marker per label at the label positions,
// one wagon tag per container spot, size limits, skipped labels and the printer shift.
import assert from "node:assert/strict";
import test from "node:test";

import { markerBits } from "../../web/arail/core/detector.js";
import { DECK_DICTIONARY } from "../../web/markers/deck-cards.js";
import { LABEL_SHEETS, labelSheet, labelSheets, largestMarker, spotTags } from "../../web/markers/label-sheets.js";
import { loadAruco } from "./helpers.js";

const { AR } = loadAruco();
const bitsOf = (id) => markerBits(AR, DECK_DICTIONARY, id);

/** Black squares (the markers) of an SVG body: rects filled black. */
const markers = (body) => [...body.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="[\d.]+" fill="#000"\/>/g)].map((m) => m.slice(1, 4).map(Number));

test("the sheets fit on A4 and only HERMA keys are label sheets", () => {
  for (const s of Object.values(LABEL_SHEETS)) {
    assert.ok(s.left + (s.cols - 1) * s.pitchX + s.w <= s.paper[0] + 1e-9);
    assert.ok(s.top + (s.rows - 1) * s.pitchY + s.h <= s.paper[1] + 1e-9);
  }
  assert.equal(labelSheet("a4"), null);
  assert.equal(labelSheet("herma4338").cols * labelSheet("herma4338").rows, 27);
  assert.equal(labelSheet("herma10109").cols * labelSheet("herma10109").rows, 12);
});

test("one tag per container spot; every ID with type all", () => {
  const sgns = spotTags({ type: "sgns60", numbers: [1, 2], stride: 4 });
  assert.deepEqual(sgns.map((t) => t.id), [0, 1, 2, 4, 5, 6]);
  assert.deepEqual(sgns[4].lines, ["ID 5", "W2 · spot 1", "Sgns"]);
  const all = spotTags({ type: "all", numbers: Array.from({ length: 25 }, (_, i) => i + 1), stride: 4 });
  assert.deepEqual(all.map((t) => t.id), Array.from({ length: 100 }, (_, i) => i));
  assert.throws(() => spotTags({ type: "sggrss80", numbers: [1], stride: 3 }), /4 container spots/);
});

test("100 tags on HERMA 4338: centred on their labels, 4 sheets", () => {
  const items = spotTags({ type: "all", numbers: Array.from({ length: 25 }, (_, i) => i + 1), stride: 4 });
  const { pages, sheets, perSheet } = labelSheets(items, { sheet: "herma4338", bitsOf, size_mm: 20 });
  assert.equal(perSheet, 27);
  assert.equal(pages.length, 4);
  const s = LABEL_SHEETS.herma4338, first = markers(sheets[0].body);
  assert.equal(first.length, 27);
  assert.deepEqual(first[0], [s.left + (s.w - 20) / 2, s.top + (s.h - 20) / 2, 20]);
  assert.deepEqual(first[4].slice(0, 2), [s.left + s.pitchX + (s.w - 20) / 2, s.top + s.pitchY + (s.h - 20) / 2]);
  assert.equal(markers(sheets[3].body).length, 100 - 3 * 27);
  assert.match(sheets[0].body, /W1 · spot 3/);
});

test("skip, shift, outlines and the size limit", () => {
  const items = [{ id: 0 }, { id: 1 }];
  const { sheets } = labelSheets(items, { sheet: "herma10109", bitsOf, size_mm: 40, border_mm: 6, skip: 11, shift: [1.5, -2], outlines: true });
  assert.equal(sheets.length, 2);
  assert.match(sheets[0].body, /translate\(1\.5 -2\)/);
  assert.equal(markers(sheets[0].body).length, 1);
  assert.equal((sheets[1].body.match(/stroke="#bbb"/g) || []).length, 12);
  assert.equal(largestMarker(LABEL_SHEETS.herma10109, 6, true), 43);
  assert.equal(largestMarker(LABEL_SHEETS.herma4338, 2.5, true), 24.6);
  assert.throws(() => labelSheets(items, { sheet: "herma10109", bitsOf, size_mm: 45, border_mm: 6 }), /at most 43 mm/);
  assert.throws(() => labelSheets(items, { sheet: "herma4338", bitsOf, size_mm: 20, skip: 27 }), /Skip 0 to 26/);
});
