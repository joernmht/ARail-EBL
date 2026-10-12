// Deck cards for model wagons (marker page, ?kind=rolling): card geometry at the exact spot
// pitch, tag IDs, errors, and the SVG sheets.
import assert from "node:assert/strict";
import test from "node:test";

import { markerBits } from "../../web/arail/core/detector.js";
import { decodeTag } from "../../web/arail/terminal/rolling.js";
import { DECK_CODES, DECK_DICTIONARY, deckCards, deckSheets, parseWagons } from "../../web/markers/deck-cards.js";
import { loadAruco } from "./helpers.js";

const { AR } = loadAruco();
const bitsOf = (id) => markerBits(AR, DECK_DICTIONARY, id);
const H0 = { stride: 4, size_mm: 20, scale: 87 };

/** Attributes of every `<tag …>` element of an SVG string, in document order. */
function elements(svg, tag) {
  return [...svg.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "g"))].map((m) => Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])));
}

test("Sgns at H0: card size, tag pitch and IDs", () => {
  const cards = deckCards({ type: "sgns60", numbers: [1, 2], ...H0 });
  assert.equal(cards.length, 2);
  const [w1, w2] = cards;
  assert.ok(Math.abs(w1.width_mm - 28.0) <= 0.05, `width ${w1.width_mm}`);
  assert.ok(Math.abs(w1.length_mm - 165.2) <= 0.1, `length ${w1.length_mm}`);
  assert.deepEqual(w1.tags.map((t) => t.id), [0, 1, 2]);
  assert.deepEqual(w2.tags.map((t) => t.id), [4, 5, 6]);
  assert.deepEqual(w2.tags.map((t) => decodeTag(t.id, 4)), [0, 1, 2].map((slot) => ({ number: 2, slot })));
  // slot 0 (A end) on the right, the pitch of 6.1 m at 1:87
  const x = w1.tags.map((t) => t.x_mm);
  assert.ok(x[0] > x[1] && x[1] > x[2]);
  assert.ok(Math.abs(x[0] - x[1] - 70.11) <= 0.05 && Math.abs(x[1] - x[2] - 70.11) <= 0.05);
  // a 2.5 mm white margin beyond the outer tags, and the tags centred across the card
  assert.ok(Math.abs(x[2] - 10 - 2.5) < 1e-9 && Math.abs(w1.length_mm - x[0] - 10 - 2.5) < 1e-9);
  for (const t of w1.tags) assert.equal(t.y_mm, w1.width_mm / 2);
  assert.equal(w1.label, "W1 · Sgns (60 ft) · IDs 0–2");
  assert.equal(deckCards({ type: "sgns60", numbers: [3], ...H0, stride: 3 })[0].label, "W3 · Sgns (60 ft) · IDs 6–8");
});

test("other wagon types and scales", () => {
  const sggrss = deckCards({ type: "sggrss80", numbers: [1], ...H0 })[0];
  assert.ok(Math.abs(sggrss.length_mm - 246.8) <= 0.5, `length ${sggrss.length_mm}`);
  assert.deepEqual(sggrss.tags.map((t) => t.slot), [0, 1, 2, 3]);
  const lgns = deckCards({ type: "lgns40", numbers: [5], ...H0, stride: 2 })[0];
  assert.deepEqual(lgns.tags.map((t) => t.id), [8, 9]);
  const n = deckCards({ type: "sgns60", numbers: [1], ...H0, size_mm: 10, scale: 160 })[0];
  assert.ok(Math.abs(n.width_mm - 15.24) < 0.01);
  assert.ok(Math.abs(n.tags[0].x_mm - n.tags[1].x_mm - 38.125) < 0.001);
});

test("errors: tag size, IDs beyond the dictionary, stride, wagon lists", () => {
  assert.throws(() => deckCards({ type: "sgns60", numbers: [1], ...H0, size_mm: 24 }), /^Error: Tags of 24 mm do not fit on the deck \(at most 23 mm\)$/);
  assert.doesNotThrow(() => deckCards({ type: "sgns60", numbers: [1], ...H0, size_mm: 23 }));
  assert.throws(() => deckCards({ type: "sgns60", numbers: [1], ...H0, scale: 120 }), /at most 15\.3 mm/);
  assert.equal(DECK_CODES, AR.DICTIONARIES[DECK_DICTIONARY].codeList.length);
  assert.doesNotThrow(() => deckCards({ type: "sggrss80", numbers: [146], ...H0 }));
  assert.throws(() => deckCards({ type: "sggrss80", numbers: [146, 147], ...H0 }), /^Error: Wagon 147 needs ID 587; AprilTag 36h11 has 587 IDs$/);
  assert.throws(() => deckCards({ type: "sggrss80", numbers: [1], ...H0, stride: 3 }), /4 container spots/);
  assert.throws(() => deckCards({ type: "tank", numbers: [1], ...H0 }), /Unknown wagon type/);
  assert.deepEqual(parseWagons("1-3, 7 W9 5-4"), [1, 2, 3, 4, 5, 7, 9]);
  assert.throws(() => parseWagons(""), /Enter wagon numbers/);
  assert.throws(() => parseWagons("one"), /is not a wagon number/);
  assert.throws(() => parseWagons("0-2"), /start at 1/);
  assert.throws(() => parseWagons("1-500"), /At most 200/);
});

test("sheets: the first black square is a tag, labels and arrows outside the cards", () => {
  const cards = deckCards({ type: "sgns60", numbers: [1, 2, 3, 4, 5, 6], ...H0 });
  const { pages, count, sheets } = deckSheets(cards, { paper: "a4", bitsOf });
  assert.equal(count, 18);
  assert.equal(pages.length, 1);
  assert.deepEqual([sheets[0].width_mm, sheets[0].height_mm, sheets[0].landscape], [210, 297, false]);
  assert.match(pages[0], /^<svg [^>]*width="210mm" height="297mm" viewBox="0 0 210 297"/);
  const rects = elements(pages[0], "rect");
  const cardRects = rects.filter((r) => r.fill === "#fff" && r.stroke);
  assert.equal(cardRects.length, 6);
  const card = cardRects[0], cx = Number(card.x), cy = Number(card.y);
  const black = rects.filter((r) => r.fill === "#000");
  assert.equal(black.length, 18);
  // the first black square is the A-end tag (slot 0) of W1, inside its card
  const first = black[0];
  assert.ok(Math.abs(Number(first.width) - 20) < 1e-9);
  assert.ok(Math.abs(Number(first.x) + 20 + 2.5 - (cx + Number(card.width))) < 0.002, "2.5 mm margin at the A end");
  assert.ok(Math.abs(Number(first.y) - (cy + 4.01)) < 0.01, "centred across the card");
  assert.ok(Math.abs(Number(first.x) - Number(black[1].x) - 70.11) < 0.01, "exact pitch in the SVG");
  assert.ok(Math.abs(Number(black[2].x) - (cx + 2.5)) < 0.002, "2.5 mm margin at the B end");
  // the label lies below the card, the arrow right of it
  const texts = [...pages[0].matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].map((m) => ({ ...elements(`<text${m[1]}>`, "text")[0], text: m[2] }));
  const label = texts.find((t) => t.text === "W1 · Sgns (60 ft) · IDs 0–2");
  assert.ok(label);
  assert.ok(Number(label.y) - 3.4 >= cy + Number(card.height));
  const arrow = texts.find((t) => t.text === "A");
  assert.ok(Number(arrow.x) >= cx + Number(card.width) + 1);
  assert.ok(texts.some((t) => t.text.startsWith("100 mm")), "scale bar");
  // without labels: no label text
  assert.ok(!deckSheets(cards, { paper: "a4", bitsOf, labels: false }).pages[0].includes("IDs 0–2"));
  // more cards: more sheets
  assert.equal(deckSheets(deckCards({ type: "sgns60", numbers: parseWagons("1-20"), ...H0 }), { paper: "a4", bitsOf }).pages.length, 4);
});

test("sheets: long cards make the page landscape", () => {
  const cards = deckCards({ type: "sggrss80", numbers: [1, 2], ...H0 });
  const { pages, sheets } = deckSheets(cards, { paper: "a4", bitsOf });
  assert.equal(sheets[0].landscape, true);
  assert.match(pages[0], /width="297mm" height="210mm"/);
  assert.throws(() => deckSheets(cards, { paper: [150, 200], bitsOf }), /too large for this paper/);
  assert.deepEqual(deckSheets([], { bitsOf }), { pages: [], count: 0, sheets: [] });
});
