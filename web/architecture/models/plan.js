/**
 * Models of the architecture page: plan documents and the exchange format rail-infra/1. See ../model.js.
 * @module architecture/models/plan
 */
export const PLAN = [
  {
    id: "plans", group: "plans", title: "Plan documents and rail-infra/1",
    summary: "The infrastructure as plain data in the exchange format rail-infra/1, which the EBL's digital twin writes too, drawn as a plan sheet like a CAD drawing: ISO paper, a standard scale, the drawing frame with its zones, the title block, a legend; printed at its true size, or saved as SVG, as DXF for CAD, or as the data itself.",
    description: "layoutToInfra turns a layout (with the modules chosen, composed by core/layers.js) into a rail-infra/1 document: its tracks under their names in the control system (track_id), its platforms as outlines, its signals, switches and the other infrastructure objects as elements of the format's vocabulary (ELEMENT_TYPES), its table modules and labels, in the layout frame (model mm). The EBL's digital twin (ebl_twin/infra.py in the lab's repository) writes the same format from the lab files: the schematic track plan in kilometre order (unit: lanes) and the hall plan (mm in the hall frame of the survey), its elements at a kilometre on their track and with their operating point (IN, IW, …). infraProblems checks a document by the format's rules. drawSheet draws one sheet of a document as SVG in paper millimetres (Node and browser alike): fitScale chooses the largest standard scale (1:n) at which it fits one sheet, or, for a schematic plan, a number of mm per lane; what does not fit is cut into sheets, which say where the plan goes on. The page web/plan/ chooses the source (ARail's layouts, a file, ?src= a URL such as the twin's /api/infra), the paper, the scale, the sheet, the drawing layers and the fields of the title block; it prints the sheet (CSS @page at the paper's size) and saves SVG, DXF (toDXF: R12, one layer per kind of thing, model space at true size) and the rail-infra data.",
    files: ["web/arail/plan/infra.js", "web/arail/plan/drawing.js", "web/arail/plan/dxf.js", "web/plan/plan.js"],
    classes: [
      {
        name: "infra", file: "web/arail/plan/infra.js", kind: "module", role: "The format rail-infra/1: its vocabulary, a layout as such a document, the checks.",
        attributes: ["INFRA_FORMAT — \"rail-infra/1\"", "FRAME_UNITS — mm, lane", "ELEMENT_TYPES — signal (main, distant, combined, shunting, block), switch, buffer stop, …; shared with the twin"],
        operations: ["markerMapOf(json) — the marker map from markers.poses", "layoutToInfra(json, options) — tracks, platforms, elements, table modules (the defaults of the object types), labels; source.unplaced: objects on markers not in the map", "infraProblems(doc) — format, frame, lists of objects, unique ids, points and numbers, element types, the tracks named; never throws", "cleanInfra(doc) — what can be drawn of it", "infraBounds(doc)"],
      },
      {
        name: "drawing", file: "web/arail/plan/drawing.js", kind: "module", role: "One plan sheet as SVG in paper mm.",
        attributes: ["PAPERS — A4 … A0, landscape", "SCALES — 1:1 … 1:10000 (ISO 5455)", "LANE_SCALES — mm per lane of a schematic plan", "LANE_AUTO_MM — 4: a schematic plan on several sheets", "OVERLAP_MM — 10: neighbouring sheets overlap, the match line in the middle", "FIT_PAD_MM — 4: room round the plan at the scale chosen automatically", "MAX_SHEETS — 100: scales that need more are not offered", "DRAWING_LAYERS — areas, tracks, platforms, elements, km, names, grid", "LINE_MM — line widths of ISO 128"],
        operations: ["sheetLayout(paper) — frame (ISO 5457), title block, legend, viewport", "fitScale(bounds, layout, unit, scale) — k, scale, cols, rows", "drawSheet(doc, options) — svg, sheet, sheets, scale, legend"],
      },
      { name: "Clearance", file: "web/arail/plan/drawing.js", kind: "class", role: "Labels that keep clear of each other: the most important placed first.", attributes: ["boxes: number[][] — the boxes taken (paper mm)"], operations: ["take(b) — true if the box was free"] },
      { name: "dxf", file: "web/arail/plan/dxf.js", kind: "module", role: "The document as DXF for CAD.", attributes: ["DXF_LAYERS — name → colour, line type"], operations: ["toDXF(doc, options) — R12, model space at true size, extents of everything", "dxfText(s) — ANSI_1252 with \\U+XXXX beyond ASCII"] },
      { name: "plan page", file: "web/plan/plan.js", kind: "module", role: "The page: source, sheet, layers, title block, print and downloads.", operations: ["load(url)", "open(json, name) — a layout (its modules as by default) or rail-infra data", "convert() — the document drawn, and its problems", "draw()", "save(text, name, type)"] },
    ],
    relations: [
      { from: "plan page", to: "infra", kind: "uses" },
      { from: "plan page", to: "drawing", kind: "uses" },
      { from: "plan page", to: "dxf", kind: "uses" },
      { from: "drawing", to: "infra", kind: "uses" },
      { from: "drawing", to: "Clearance", kind: "creates" },
      { from: "dxf", to: "infra", kind: "uses" },
    ],
    activities: [{
      id: "sheet", name: "A plan sheet",
      nodes: [
        ["s", "start"],
        ["d1", "decision", "rail-infra data?"],
        ["a1", "action", "The layout with the modules ticked, as rail-infra/1", "layoutToInfra"],
        ["m1", "merge"],
        ["a2", "action", "The problems of the data shown; what can be drawn of it", "cleanInfra"],
        ["a3", "action", "Frame, title block, legend and viewport of the paper", "sheetLayout"],
        ["d2", "decision", "Frame in lanes?"],
        ["a4", "action", "The largest standard scale 1:n at which it fits one sheet", "fitScale"],
        ["a5", "action", "So many mm per lane; too long: cut into sheets along x", "fitScale"],
        ["m2", "merge"],
        ["a6", "action", "The sheet's window: the plan centred on all the sheets, which overlap; only what lies on it", "drawSheet"],
        ["a7", "action", "Tables, platforms, tracks, kilometres, symbols", "drawSheet"],
        ["a8", "action", "Names where they keep clear: operating points, labels, tracks, then elements", "Clearance.take"],
        ["a10", "action", "Match lines with the neighbouring sheets", "drawSheet"],
        ["a9", "action", "Frame with zones, legend of what is drawn, scale bar, title block", "drawSheet"],
        ["e", "end"],
      ],
      edges: [["s", "d1"], ["d1", "a1", "no: a layout"], ["d1", "m1", "yes"], ["a1", "m1"], ["m1", "a2"], ["a2", "a3"], ["a3", "d2"], ["d2", "a4", "no: mm"], ["d2", "a5", "yes"], ["a4", "m2"], ["a5", "m2"], ["m2", "a6"], ["a6", "a7"], ["a7", "a8"], ["a8", "a10"], ["a10", "a9"], ["a9", "e"]],
    }],
    parameters: [
      { key: "?layout=, ?src=", default: "Bf Neustadt", meaning: "The layout or rail-infra file opened (a URL, e.g. the twin's /api/infra?frame=plan)." },
      { key: "?layers=", default: "the layout's", meaning: "The layout's modules (Bf Neustadt: with Infrastructure)." },
      { key: "?paper=, ?scale=, ?sheet=", default: "A3, auto, 1", meaning: "The sheet." },
    ],
    rules: [
      "Element types and keys are the same in ARail and in the EBL's twin: a track by its name in the control system, an element by its name and, where known, at a kilometre on its track.",
      "The frame of the drawing: 20 mm filing margin at the left, 10 mm elsewhere; the title block 180 mm wide in the lower right corner.",
      "A file with mistakes is drawn as far as it can be, and its problems are shown; a scale is never taken over from a plan in the other unit.",
      "Black ink on white, line widths of ISO 128; the sheet is the same every time it is drawn.",
      "The EBL's data stay in its own repository; the page loads them from a file or a URL.",
    ],
  },
];
