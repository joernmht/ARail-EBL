// Plans (arail/plan): a layout's infrastructure as rail-infra/1 data, the checks of such data, the
// plan sheet (ISO paper, a standard scale, the frame and its zones, the title block, the legend, sheets
// cut along a long plan), its texts in German, and the DXF for CAD.
import assert from "node:assert/strict";
import test from "node:test";

import { Translator, composeLayout, registry } from "../../web/arail/index.js";
import { DRAWING_LAYERS, FIT_PAD_MM, LANE_AUTO_MM, OVERLAP_MM, PAPERS, drawSheet, fitScale, sheetLayout } from "../../web/arail/plan/drawing.js";
import { DXF_LAYERS, dxfText, toDXF } from "../../web/arail/plan/dxf.js";
import { ELEMENT_TYPES, INFRA_FORMAT, cleanInfra, infraBounds, infraProblems, layoutToInfra } from "../../web/arail/plan/infra.js";
import { readJSON } from "./helpers.js";

/** Bf Neustadt with its module Infrastructure (the signals, the interlocking). */
function neustadt() {
  const json = readJSON("web/layouts/ebl-neustadt.json");
  const layers = json.layers.map((l) => ({ ...l, enabled: l.enabled || l.id === "infrastructure" }));
  return layoutToInfra(composeLayout({ ...json, layers }).layout, { file: "web/layouts/ebl-neustadt.json" });
}

/** A schematic plan (lanes) with one of every element type, 300 lanes long. */
function everything() {
  const types = Object.keys(ELEMENT_TYPES);
  const elements = types.map((type, i) => (ELEMENT_TYPES[type].linear
    ? { id: `e${i}`, type, name: `${type} ${i}`, points: [[i * 5, 2], [i * 5 + 4, 2]] }
    : { id: `e${i}`, type, name: `${type} ${i}`, track: "11", km: i / 10, at: [i * 5, 0.6], heading_deg: 0 }));
  for (const kind of ELEMENT_TYPES.signal.kinds) elements.push({ id: `s-${kind}`, type: "signal", kind, name: kind, at: [150, 0.6], heading_deg: 180 });
  return {
    format: INFRA_FORMAT, name: "Everything", source: { generator: "test" },
    frame: { id: "test", unit: "lane", lane_mm: 35 },
    operating_points: [{ id: "IN", name: "Neustadt", kind: "station", box: [100, -2, 200, 4] }],
    tracks: [
      { id: "t1", name: "Strecke 11", track: "11", points: [[0, 0], [150, 0], [300, 0]], kms: [0, 10, 20] },
      { id: "t2", name: "Strecke 12", track: "12", points: [[0, 1], [300, 1]], kms: [0, 20], hidden: true },
      { id: "l1", kind: "link", points: [[150, 0], [151, 1]] },
    ],
    platforms: [{ id: "p1", name: "1", points: [[120, -0.3], [180, -0.3], [180, -0.7], [120, -0.7]] }],
    areas: [{ id: "a1", kind: "table", name: "Ring", points: [[-5, -5], [305, -5], [305, 5], [-5, 5]], holes: [[[10, -1], [290, -1], [290, -0.9], [10, -0.9]]] }, { id: "a2", kind: "room", points: [[-6, -6], [306, -6], [306, 6], [-6, 6]] }],
    elements,
    labels: [{ id: "lb", text: "Label", at: [50, 3] }],
  };
}

test("a layout as rail-infra/1: tracks by their control-system names, platforms, signals, the interlocking, table modules", () => {
  const doc = neustadt();
  assert.equal(doc.format, INFRA_FORMAT);
  assert.deepEqual(doc.frame, { id: "layout", unit: "mm", scale: 87, note: "layout frame: model mm from the origin marker" });
  assert.deepEqual(infraProblems(doc), []);
  assert.ok(doc.tracks.length >= 10, `${doc.tracks.length} tracks`);
  const g16 = doc.tracks.find((t) => t.id === "track-g16");
  assert.equal(g16.track, "G16", "the track's name in the control system");
  assert.deepEqual(g16.points[0], [-60, 46]);
  const p1 = doc.platforms.find((p) => p.id === "platform-1");
  assert.equal(p1.points.length, 4);
  assert.deepEqual(p1.tracks, ["G1"]);
  // the platform is its width wide (34 mm), across its centre line
  const [a, , , d] = p1.points;
  assert.ok(Math.abs(Math.hypot(a[0] - d[0], a[1] - d[1]) - 34) < 0.2);
  const n2 = doc.elements.find((e) => e.id === "signal-n2");
  assert.deepEqual({ type: n2.type, kind: n2.kind, side: n2.side, real: n2.real, heading: n2.heading_deg }, { type: "signal", kind: "main", side: "right", real: true, heading: 180 });
  assert.ok(doc.elements.some((e) => e.type === "interlocking"), "the interlocking");
  assert.ok(doc.areas.some((x) => x.kind === "table" && !x.virtual) && doc.areas.some((x) => x.virtual), "the real table and the virtual table modules");
  assert.ok(doc.labels.some((l) => l.text === "Neustadt"));
  // nothing that is not infrastructure: no buildings, trees, streets
  assert.ok(doc.elements.every((e) => ELEMENT_TYPES[e.type]));
});

test("a layout as rail-infra/1: points given relative to a marker are placed by the marker map", () => {
  const doc = layoutToInfra({
    name: "Markers", markers: { poses: { 4: [1000, 500, 90] } },
    objects: [
      { id: "t", type: "track", track_id: "1", points: [{ marker: 4, offset: [0, 0] }, { marker: 4, offset: [100, 0] }] },
      { id: "s", type: "signal", position: { marker: 4, offset: [0, -20] }, rotation_deg: 90 },
      { id: "x", type: "signal", position: { marker: 9, offset: [0, 0] } }, // a marker that is not in the map
      { id: "p", type: "platform", between: [4, 4] },
    ],
  });
  assert.deepEqual(doc.tracks[0].points, [[1000, 500], [1000, 600]]);
  assert.deepEqual(doc.elements.map((e) => [e.id, e.at]), [["s", [1020, 500]]]);
  assert.equal(doc.source.unplaced, 1, "the signal on marker 9 is not on the plan, and counted");
  assert.deepEqual(infraProblems(doc), []);
});

test("the checks of rail-infra data: format, frame, unique ids, points, element types, the tracks named", () => {
  assert.deepEqual(infraProblems(everything()), []);
  assert.deepEqual(infraProblems(null), ["not a JSON object"]);
  const bad = everything();
  bad.format = "rail-infra/0";
  bad.frame.unit = "inch";
  bad.tracks.push({ id: "t1", points: [[0, 0]] });
  bad.elements.push({ id: "z", type: "tunnel", at: [0, "x"] }, { id: "y", type: "signal", kind: "red", track: "99", at: [0, 0] }, { id: "w", type: "balise" });
  const p = infraProblems(bad).join("\n");
  for (const want of ["format is \"rail-infra/0\"", "frame.unit", "tracks[3] (t1): the id is used twice", "fewer than two points", "elements (z): unknown type \"tunnel\"", "at is not [x, y]", "unknown signal kind \"red\"", "no track \"99\"", "elements (w): neither at nor points"]) {
    assert.ok(p.includes(want), `${want} in\n${p}`);
  }
  assert.deepEqual(infraBounds({}), null);
  assert.deepEqual(infraBounds(everything()), [-6, -6, 306, 6]);
});

test("the scale: the largest standard scale at which it fits one sheet; a long schematic plan cut into sheets", () => {
  const a3 = sheetLayout("A3");
  assert.deepEqual([a3.width, a3.height], PAPERS.A3);
  assert.deepEqual(a3.frame, [20, 10, 410, 287], "the frame: 20 mm filing margin at the left, 10 mm elsewhere");
  assert.deepEqual(a3.title, [230, 247, 410, 287], "the title block: 180 mm wide in the lower right corner");
  // Bf Neustadt, about 20 m × 5 m of table: 1:100 on A3, 1:50 on A1
  const b = infraBounds(neustadt());
  assert.deepEqual(fitScale(b, a3, "mm"), { k: 0.01, scale: 100, cols: 1, rows: 1 });
  assert.equal(fitScale(b, sheetLayout("A1"), "mm").scale, 50);
  // a chosen scale that does not fit: the sheets it needs
  assert.deepEqual(fitScale(b, a3, "mm", 20), { k: 0.05, scale: 20, cols: 3, rows: 2 });
  // the schematic plan: too long for one sheet, so cut along x at LANE_AUTO_MM per lane
  const lane = fitScale(infraBounds(everything()), a3, "lane");
  assert.equal(lane.scale, LANE_AUTO_MM);
  assert.equal(lane.rows, 1);
  assert.equal(lane.cols, Math.ceil((312 * LANE_AUTO_MM) / (a3.viewport[2] - a3.viewport[0])));
});

test("a plan sheet: true size in mm, the frame's zones, the title block, the legend of what is drawn, the sheets", () => {
  const doc = neustadt();
  const r = drawSheet(doc, { paper: "A3", date: "2026-10-30" });
  assert.ok(r.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 420 297"'));
  assert.ok(r.svg.endsWith("</svg>"));
  assert.equal((r.svg.match(/<g\b/g) || []).length, (r.svg.match(/<\/g>/g) || []).length, "groups closed");
  assert.deepEqual([r.sheet, r.sheets, r.scaleText, r.paper], [1, 1, "1:100", "A3"]);
  for (const t of ["EBL Bf Neustadt and terminal (example)", "Site plan", "1:100", "2026-10-30", "1/1", "generated by arail", "web/layouts/ebl-neustadt.json"]) assert.ok(r.svg.includes(`>${t}<`), t);
  for (const l of ["Track", "Platform", "Table module", "Main signal", "Interlocking"]) assert.ok(r.legend.includes(l), `legend: ${l}`);
  assert.ok(r.svg.includes(">A<") && r.svg.includes(">8<"), "zone fields: letters down, numbers across");
  // the same every time
  assert.equal(drawSheet(doc, { paper: "A3", date: "2026-10-30" }).svg, r.svg);
  // the fields of the title block chosen, layers switched off
  const t = drawSheet(doc, { title: { title: "Lageplan Bf Neustadt", number: "EBL-001", revision: "B" }, layers: ["tracks"] });
  for (const s of ["Lageplan Bf Neustadt", "EBL-001", ">B<"]) assert.ok(t.svg.includes(s), s);
  assert.deepEqual(t.legend, ["Track"]);
  // at 1:20 the plan needs 3 × 2 sheets; each says where it goes on
  const s2 = drawSheet(doc, { scale: 20, sheet: 2 });
  assert.deepEqual([s2.sheet, s2.sheets], [2, 6]);
  for (const n of [1, 3, 5]) assert.ok(s2.svg.includes(`continued on sheet ${n}`), `sheet ${n}`);
  assert.equal(drawSheet(doc, { scale: 20, sheet: 9 }).sheet, 6, "a sheet beyond the last: the last");
});

test("a schematic plan sheet: every element type with its symbol in the legend, kilometres, not to scale", () => {
  const r = drawSheet(everything(), { paper: "A1", scale: 2 });
  assert.equal(r.scaleText, "Schematic, not to scale");
  assert.ok(r.svg.includes("1 lane = 2 mm on the sheet") && r.svg.includes("1 lane = 35 mm on the layout"));
  for (const t of Object.values(ELEMENT_TYPES)) assert.ok(r.legend.includes(t.label) || t.label === "Signal", `legend: ${t.label}`);
  for (const k of ["Main signal", "Distant signal", "Main signal with distant signal", "Shunting signal", "Block signal", "Line kilometre", "Operating point (station limits)", "Room (outline)"]) assert.ok(r.legend.includes(k), k);
  assert.ok(r.svg.includes('fill-rule="evenodd"'), "a table ring with its hole");
  assert.ok(r.svg.includes(">Neustadt (IN)<"));
  assert.ok(/>1[05]<\/text>/.test(r.svg), "kilometre labels");
});

test("every text of the sheet has a German translation", () => {
  const de = new Translator("de");
  for (const [l, entries] of registry.texts) de.add(l, entries);
  const asked = new Set();
  const tr = (s) => (asked.add(s), de.translate(s));
  for (const unit of ["lane", "mm"]) {
    const doc = everything();
    doc.frame = { ...doc.frame, unit, scale: 87 };
    drawSheet(doc, { tr, paper: "A0", scale: unit === "mm" ? 100 : 2, sheet: 2 });
  }
  drawSheet({ format: INFRA_FORMAT, frame: { unit: "mm" } }, { tr });
  for (const l of DRAWING_LAYERS) asked.add(l.label);
  for (const t of Object.values(ELEMENT_TYPES)) asked.add(t.label);
  const missing = [...asked].filter((s) => /[A-Za-z]{2}/.test(s) && !de.has(s));
  assert.deepEqual(missing, []);
  assert.ok(drawSheet(neustadt(), { tr: (s) => de.translate(s) }).svg.includes(">Lageplan<"));
});

test("DXF: R12 with a layer for each kind of thing, the plan at its true size, a schematic plan in lanes of lane_mm", () => {
  const dxf = toDXF(neustadt());
  const lines = dxf.split("\n");
  assert.deepEqual(lines.slice(0, 6), ["0", "SECTION", "2", "HEADER", "9", "$ACADVER"]);
  assert.equal(lines[6], "1");
  assert.equal(lines[7], "AC1009");
  assert.ok(dxf.endsWith("0\nEOF\n"));
  for (const l of Object.keys(DXF_LAYERS)) assert.ok(dxf.includes(`\n2\n${l}\n70\n0\n62\n`), `layer ${l}`);
  // group codes and values in pairs: every code a number
  for (let i = 0; i < lines.length - 1; i += 2) assert.ok(/^-?\d+$/.test(lines[i]), `line ${i + 1}: ${lines[i]}`);
  assert.equal((dxf.match(/\nPOLYLINE\n/g) || []).length, (dxf.match(/\nSEQEND\n/g) || []).length);
  assert.ok(dxf.includes("\nTRACKS\n10\n-60\n20\n46\n"), "the first point of track G16 at its true place (mm)");
  // a schematic plan: lanes of 35 mm
  const lane = toDXF(everything());
  assert.ok(lane.includes("\n10\n10500\n20\n0\n"), "lane 300 at 10.5 m");
  assert.ok(lane.includes("Neustadt (IN)"));
});

test("a file with mistakes: the checks never throw, the sheet and the DXF draw what they can", () => {
  const base = { format: INFRA_FORMAT, frame: { unit: "mm" } };
  const cases = [
    [{ ...base, tracks: {} }, "tracks must be a list"],
    [{ ...base, elements: [null] }, "elements[0]: not an object"],
    [{ ...base, tracks: [null, { id: "t", points: [[0, 0], [1000, 0]], kms: [1] }] }, "tracks[0]: not an object"],
    [{ ...base, elements: [{ id: "w", type: "switch", at: [0, 0], length_m: "long", km: "x" }] }, "elements[0] (w): length_m is not a number"],
  ];
  for (const [doc, want] of cases) {
    const p = infraProblems(doc);
    assert.ok(p.includes(want), `${want} in ${p.join("; ")}`);
    const r = drawSheet(doc);
    assert.ok(!r.svg.includes("NaN"), "no NaN in the sheet");
    assert.ok(!toDXF(doc).includes("NaN"), "no NaN in the DXF");
  }
  assert.ok(infraProblems(cases[2][0]).includes("tracks (t): kms must be one number per point"));
  assert.deepEqual(cleanInfra(cases[2][0]).tracks.map((t) => [t.id, t.kms]), [["t", undefined]]);
});

test("DXF: umlauts as \\U+ escapes of a file that says it is ANSI_1252; the extents of everything", () => {
  const doc = { format: INFRA_FORMAT, frame: { unit: "mm" }, tracks: [{ id: "t", name: "Gleis Süd", points: [[0, 0], [3000, 0]] }], labels: [{ id: "l", text: "Bahn­übergang", at: [0, 0] }], areas: [{ id: "r", kind: "room", points: [[-500, -500], [3500, -500], [3500, 800]] }] };
  const dxf = toDXF(doc);
  assert.ok(dxf.includes("\n9\n$DWGCODEPAGE\n3\nANSI_1252\n"));
  assert.ok(dxf.includes("\n1\nGleis S\\U+00FCd\n") && dxf.includes("\n1\nBahn\\U+00FCbergang\n"));
  assert.ok(/^[\x00-\x7f]*$/.test(dxf), "only ASCII in the file");
  assert.equal(dxfText("Weiche W60 → Gleis 5"), "Weiche W60 \\U+2192 Gleis 5");
  assert.ok(dxf.includes("$EXTMIN\n10\n-500\n20\n-500\n") && dxf.includes("$EXTMAX\n10\n3500\n20\n800\n"), "the room is inside the extents");
});

test("the legend on A4: in its column beside the scale bar, and the last place for what is left out", () => {
  const long = { ...everything(), tracks: [...everything().tracks, { id: "v", points: [[0, 3], [300, 3]], virtual: true }] };
  const r = drawSheet(long, { paper: "A4", scale: 2 });
  const { legend: [x0, y0, x1, y1] } = sheetLayout("A4");
  const texts = [...r.svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="2"(?: font-style="italic")?>([^<]*)<\/text>/g)]
    .map((m) => ({ x: +m[1], y: +m[2], s: m[3] })).filter((t) => t.x > x0 && t.x < x1 && t.y > y0 && t.y < y1);
  const bar = x1 - 44;
  for (const t of texts) if (t.x < bar) assert.ok(t.x + t.s.length * 2 * 0.56 <= bar, `"${t.s}" runs into the scale bar`);
  const places = texts.filter((t) => t.x < bar).map((t) => `${t.x},${t.y}`);
  assert.equal(new Set(places).size, places.length, "no text on top of another");
  assert.ok(texts.some((t) => /^\d+ more symbols$/.test(t.s)), "how many are left out");
  assert.ok(texts.some((t) => t.s.endsWith("…")), "a long label cut short");
  assert.ok(drawSheet(long, { paper: "A4", scale: 2, tr: (s) => (s === "Level crossing" ? "Bahn­übergang" : s) }).svg.indexOf("­") < 0, "no soft hyphens");
});

test("the sheets overlap, with a match line; each holds only what lies on it; auto keeps room round the plan", () => {
  const doc = neustadt();
  const one = drawSheet(doc), first = drawSheet(doc, { scale: 20, sheet: 1 });
  assert.ok(first.svg.includes('stroke-dasharray="8 1.5 1 1.5"'), "the match line");
  assert.ok(first.legend.includes("Match line"));
  const paths = (svg) => (svg.match(/<path /g) || []).length;
  assert.ok(paths(first.svg) < paths(one.svg) - 10, `${paths(first.svg)} paths on sheet 1 of 6, ${paths(one.svg)} on the whole plan`);
  // at 1:20 the windows of neighbouring sheets overlap by 10 mm of paper: 200 mm of the layout
  const a3 = sheetLayout("A3"), vw = a3.viewport[2] - a3.viewport[0];
  assert.equal(OVERLAP_MM, 10);
  assert.equal(fitScale([0, 0, (2 * vw - OVERLAP_MM - 2 * FIT_PAD_MM) * 20, 1000], a3, "mm", 20).cols, 2);
  assert.equal(fitScale([0, 0, (2 * vw - OVERLAP_MM - 2 * FIT_PAD_MM) * 20 + 40, 1000], a3, "mm", 20).cols, 3);
  // auto: the plan with FIT_PAD_MM round it fits
  const b = [0, 0, (vw - 2) * 100, 1000];
  assert.equal(fitScale(b, a3, "mm").scale, 200, "too tight for 1:100 with room round it");
});

test("symbols: a signal's foot towards its track; kilometre ticks once at a point; numbers in the language shown", () => {
  const sig = (side) => drawSheet({ format: INFRA_FORMAT, frame: { unit: "lane" }, elements: [{ id: "s", type: "signal", side, at: [0, 0], heading_deg: 0 }] }, { layers: ["elements"] }).svg;
  assert.notEqual(sig("left"), sig("right"));
  const doc = { format: INFRA_FORMAT, frame: { unit: "lane" }, tracks: [{ id: "t", points: [[0, 0], [10, 0], [20, 0]], kms: [0, 0.5, 1] }] };
  const r = drawSheet(doc, { layers: ["km"], scale: 20, number: (v, d) => v.toFixed(d).replace(".", ",") });
  const ticks = [...r.svg.matchAll(/<path d="(M[\d.]+ [\d.]+L[\d.]+ [\d.]+)"\/>/g)].map((m) => m[1]);
  assert.ok(ticks.length >= 3);
  assert.equal(new Set(ticks).size, ticks.length, "no tick twice");
  assert.ok(r.svg.includes(">0,5<"), "0,5 in German");
});

test("a layout's table modules take the app's defaults; objects on markers not in the map are counted", () => {
  const doc = layoutToInfra({ objects: [{ id: "t", type: "tabletop", position: [0, 0] }, { id: "m", type: "signal", position: { marker: 40, offset: [0, 0] } }] });
  const [a, b, c] = doc.areas[0].points;
  assert.deepEqual([b[0] - a[0], c[1] - b[1]], [1000, 600]);
  assert.equal(doc.source.unplaced, 1);
});

test("second review: only what would be on the plan is counted; null for a number not known; km ticks per sheet; match texts along their line", () => {
  // a tree, a building and a wagon on markers not in the map are no infrastructure: not counted
  const lost = { marker: 77, offset: [0, 0] };
  const j = { objects: [{ id: "a", type: "tree", position: lost }, { id: "b", type: "building", position: lost }, { id: "c", type: "wagon", position: lost }, { id: "s", type: "signal", position: lost }] };
  assert.equal(layoutToInfra(j).source.unplaced, 1);
  // null: a number not known
  assert.deepEqual(infraProblems({ format: INFRA_FORMAT, frame: { unit: "lane" }, tracks: [{ id: "t", track: "1", points: [[0, 0], [1, 0]], kms: null }], elements: [{ id: "e", type: "signal", track: "1", km: null, at: [0, 0] }], operating_points: [{ id: "IN", km: null, at: [0, 0] }] }), []);
  // a 0–10 km line on several sheets: each sheet has only its own ticks, at the same step
  const line = { format: INFRA_FORMAT, frame: { unit: "lane" }, tracks: [{ id: "t", name: "Strecke 1", points: [[0, 0], [1000, 0]], kms: [0, 10] }] };
  const labels = (sheet) => [...drawSheet(line, { sheet, layers: ["km", "tracks"], scale: 2 }).svg.matchAll(/font-size="1.6">([\d.]+)</g)].map((m) => +m[1]);
  const one = labels(1), two = labels(2);
  assert.ok(one.length > 3 && two.length > 3);
  assert.ok(one.length < 101 / 2, `${one.length} ticks on sheet 1`);
  assert.ok(Math.max(...one) < Math.min(...two) + 1, "sheet 2 goes on where sheet 1 ends");
  const steps = (v) => new Set(v.slice(1).map((x, i) => Math.round((x - v[i]) * 10)));
  assert.deepEqual(steps(one), steps(two), "the same step on both sheets");
  // the match line's text runs along the line, near its top, not across the track in the middle
  const svg = drawSheet(line, { sheet: 2, scale: 2 }).svg;
  assert.ok(/<text [^>]*transform="rotate\(-90 [^"]+\)">continued on sheet 1 ↑<\/text>/.test(svg));
  assert.ok(/<text [^>]*transform="rotate\(-90 [^"]+\)">continued on sheet 3 ↓<\/text>/.test(svg));
});
