// Plans (arail/plan): a layout's infrastructure as rail-infra/1 data, the checks of such data, the
// plan sheet (ISO paper, a standard scale, the frame and its zones, the title block, the legend, sheets
// cut along a long plan), its texts in German, and the DXF for CAD.
import assert from "node:assert/strict";
import test from "node:test";

import { Translator, composeLayout, registry } from "../../web/arail/index.js";
import { DRAWING_LAYERS, LANE_AUTO_MM, PAPERS, drawSheet, fitScale, sheetLayout } from "../../web/arail/plan/drawing.js";
import { DXF_LAYERS, toDXF } from "../../web/arail/plan/dxf.js";
import { ELEMENT_TYPES, INFRA_FORMAT, infraBounds, infraProblems, layoutToInfra } from "../../web/arail/plan/infra.js";
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
