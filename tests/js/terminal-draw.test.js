// Drawing of the container terminal (web/arail/terminal/draw.js): every drawing in a top view and in
// the flyover by day and at night, the colours of the corporate design, legible labels, the plain
// contract of the view, culling, level of detail, picking, sort keys and the drawing budget.
import assert from "node:assert/strict";
import test from "node:test";

import { CD, Camera, FlyCamera, OVERLAY, View, createRng, grey, mix, offsetPolyline, parseColor, parseRgba, polylineAt, polylineLengths, rectFootprint, toRad } from "../../web/arail/index.js";
import {
  CONTAINER_COLOURS, TERMINAL_COLOURS, beamFaces, boxCorners, colourFor, drawBarge, drawContainers, drawCrane, drawCraneRails, drawGhost,
  drawHighlights, drawLocomotive, drawQuay, drawReachStacker, drawTruck, drawTruckLane, drawWagon, drawYardGround, drawYardLabels,
  drawYardStacks, pickBoxes,
} from "../../web/arail/terminal/draw.js";
import { CARRIER_TYPES, CONTAINER_SIZES, bargeType, makeBic, yardType } from "../../web/arail/terminal/model.js";
import { yardGrid } from "../../web/arail/terminal/objects.js";
import { readJSON } from "./helpers.js";

const W = 1280, H = 720;

/* ---------------------------------------------------------------- recording contexts (as in view.test and design.test) */

class Gradient {
  constructor(a) {
    this.a = a;
    this.stops = [];
  }

  addColorStop(offset, colour) {
    this.stops.push([offset, colour]);
  }
}

/** A canvas context with a real state stack that records every fill and stroke with its state and path. */
function stateContext(width = W, height = H) {
  const ops = [];
  let saves = 0, depth = 0, path = [];
  const KEYS = ["fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin", "globalAlpha", "globalCompositeOperation", "font", "textAlign", "textBaseline"];
  const stack = [];
  const ctx = {
    canvas: { width, height },
    fillStyle: "#000000", strokeStyle: "#000000", lineWidth: 1, lineCap: "butt", lineJoin: "miter", globalAlpha: 1,
    globalCompositeOperation: "source-over", font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic",
    dash: [],
    transform: [1, 0, 0, 1, 0, 0],
    save() {
      saves++;
      depth++;
      stack.push({ ...Object.fromEntries(KEYS.map((k) => [k, this[k]])), dash: this.dash, transform: this.transform });
    },
    restore() {
      depth--;
      Object.assign(this, stack.pop());
    },
    setLineDash(d) {
      this.dash = d.slice();
    },
    getLineDash() {
      return this.dash.slice();
    },
    setTransform(...m) {
      this.transform = m;
    },
    beginPath() {
      path = [];
    },
    moveTo(x, y) {
      path.push({ pts: [[x, y]], closed: false });
    },
    lineTo(x, y) {
      if (!path.length) path.push({ pts: [], closed: false });
      path.at(-1).pts.push([x, y]);
    },
    closePath() {
      if (path.length) path.at(-1).closed = true;
    },
    arc(x, y, r, a0, a1) {
      path.push({ pts: [[x, y, r, a0, a1]], closed: false, curve: true });
    },
    arcTo(...a) {
      if (!path.length) path.push({ pts: [], closed: false });
      path.at(-1).pts.push(a);
    },
    rect(...a) {
      path.push({ pts: [a], closed: true });
    },
    fill() {
      ops.push({ op: "fill", path: structuredClone(path), fillStyle: this.fillStyle, globalAlpha: this.globalAlpha, composite: this.globalCompositeOperation });
    },
    stroke() {
      ops.push({ op: "stroke", path: structuredClone(path), strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, globalAlpha: this.globalAlpha, dash: this.dash, lineJoin: this.lineJoin, lineCap: this.lineCap });
    },
    fillRect(...a) {
      ops.push({ op: "fillRect", a, fillStyle: this.fillStyle, globalAlpha: this.globalAlpha });
    },
    fillText(text, x, y) {
      ops.push({ op: "fillText", text, x, y, fillStyle: this.fillStyle, font: this.font });
    },
    measureText: (t) => ({ width: String(t).length * 6 }),
    createRadialGradient: (...a) => new Gradient(a),
    createLinearGradient: (...a) => new Gradient(a),
    clip() {},
    drawImage() {},
  };
  return { ctx, ops, stats: () => ({ saves, depth }) };
}

/** A view looking straight down on the layout from `d` mm, centred on `c` (x to the right, y up the image). */
function topView(ctx, { c = [750, 420], d = 2200, ...options } = {}) {
  const camera = new Camera(W, H);
  const { fx, cx, cy } = camera.intrinsics;
  return new View({ ctx, camera, H: [fx, 0, cx * d - fx * c[0], 0, -fx, cy * d + fx * c[1], 0, 0, d], scale: 87, ...options });
}

/** A view through a flyover camera. */
function flyView(ctx, cam, options = {}) {
  const camera = new Camera(W, H);
  const { H: hom, focal, pose } = cam.homography(W, H);
  camera.setManualFocal(focal);
  return new View({ ctx, camera, H: hom, pose, scale: 87, virtual: true, ...options });
}

/** Record the faces calls of a view: {faces, ref, key} in queue order. */
function recordFaces(view) {
  const calls = [];
  const faces = view.faces.bind(view);
  view.faces = (f, ref, style) => {
    calls.push({ faces: f, ref, key: view.depth(ref[0], ref[1], ref[2] || 0), n: view.items.length });
    return faces(f, ref, style);
  };
  return calls;
}

/* ---------------------------------------------------------------- the example scene, built from the layout's data */

const LAYOUT = readJSON("web/layouts/container-terminal.json");
const SCALE = LAYOUT.scale;
const mm = (m) => (m * 1000) / SCALE;
const objectSpec = (id) => LAYOUT.objects.find((o) => o.id === id);

function craneGeometry(o) {
  const c = o.position, a = toRad(o.rotation_deg || 0), u = [Math.cos(a), Math.sin(a)], n = [-u[1], u[0]];
  const len = o.width_mm, span = o.depth_mm;
  const at = (s, t) => [c[0] + u[0] * s + n[0] * t, c[1] + u[1] * s + n[1] * t];
  return {
    center: c, angle: a, u, n, length: len, span, outreach: mm(o.outreach_m), lift: mm(o.lift_m), footprint: rectFootprint(c, len, span, a),
    railA: [at(-len / 2, -span / 2), at(len / 2, -span / 2)], railB: [at(-len / 2, span / 2), at(len / 2, span / 2)],
  };
}

function yardGeometry(o) {
  const a = toRad(o.rotation_deg || 0);
  return { center: o.position, angle: a, width: o.width_mm, depth: o.depth_mm, footprint: rectFootprint(o.position, o.width_mm, o.depth_mm, a), ...yardGrid(o.width_mm, o.depth_mm, SCALE), tiers: o.tiers };
}

function laneGeometry(o) {
  const lengths = polylineLengths(o.points), side = o.passing_side === "right" ? -1 : 1;
  return { points: o.points, lengths, total: lengths.at(-1), side, passingOffset: side * mm(3.5) };
}

function lanePositions(g, n) {
  return Array.from({ length: n }, (_, i) => Math.min(g.total - mm(10), Math.max(mm(10), g.total / 2 + (i - (n - 1) / 2) * mm(19))));
}

function quayGeometry(o) {
  const lengths = polylineLengths(o.points), total = lengths.at(-1), side = o.quay_side === "left" ? 1 : -1;
  const quayOffset = side * mm(5.25);
  const ribbon = (pts, d0, d1) => offsetPolyline(pts, d0).concat(offsetPolyline(pts, d1).reverse());
  const berth = [total - mm(o.berth_m), total];
  const part = [polylineAt(o.points, berth[0], lengths).point, o.points.at(-1)];
  return {
    points: o.points, lengths, total, side, quayOffset, berth,
    water: ribbon(o.points, quayOffset, quayOffset - side * mm(o.water_m)), wall: ribbon(part, quayOffset, quayOffset + side * mm(3)),
  };
}

/** A DrawBox on a carrier pose at carrier-local metres. */
function drawBox(id, size, high, pose, along, across, z0, colour = null) {
  const c = Math.cos(pose.heading), s = Math.sin(pose.heading);
  return {
    id, size, high, colour: colourFor({ id, colour }), heading: pose.heading, z0,
    center: [pose.center[0] + mm(c * along - s * across), pose.center[1] + mm(s * along + c * across)],
    length: mm(CONTAINER_SIZES[size].length_m), width: mm(2.438), height: mm(high ? 2.896 : 2.591),
  };
}

function slotBox(type, pose, id, size, bay, row = 0, below = 0, high = false) {
  const along = CONTAINER_SIZES[size].bays === 2 ? (type.bays_m[bay] + type.bays_m[bay + 1]) / 2 : type.bays_m[bay];
  return drawBox(id, size, high, pose, along, type.rows_m[row], mm(type.deck_m) + below);
}

/** The example: positioned train KT 41, the barge, Block A and B with their fill, idle handlers. */
function exampleScene({ extras = false } = {}) {
  const sim = LAYOUT.simulations[0];
  const crane = craneGeometry(objectSpec("crane-1"));
  const yards = { "yard-a": yardGeometry(objectSpec("yard-a")), "yard-b": yardGeometry(objectSpec("yard-b")) };
  const laneSpec = objectSpec("lane-1"), lane = laneGeometry(laneSpec);
  const quay = quayGeometry(objectSpec("quay-1"));
  // KT 41 at its stop
  const kt = sim.trains.find((t) => t.id === "KT41"), track = objectSpec(kt.track);
  const tl = polylineLengths(track.points);
  const pose = (s) => {
    const p = polylineAt(track.points, s, tl);
    return { center: p.point, heading: Math.atan2(p.dir[1], p.dir[0]) };
  };
  const loco = { ...pose(kt.stop_mm - mm(9.5)), length_m: 19, alpha: 1, lit: false, label: kt.name };
  const carriers = {};
  let s = kt.stop_mm - mm(19);
  const wagons = kt.wagons.map((t, k) => {
    const type = CARRIER_TYPES[t];
    const w = { id: `KT41/${k + 1}`, type, ...pose(s - mm(type.length_m) / 2), deck: mm(type.deck_m), alpha: 1, tags: null, boxes: [] };
    s -= mm(type.length_m);
    carriers[w.id] = w;
    return w;
  });
  // the barge with its bow at the end of the quay
  const bs = sim.barges[0], btype = bargeType({ length_m: bs.length_m, tiers: bs.tiers });
  const bp = polylineAt(quay.points, quay.total - mm(bs.length_m / 2), quay.lengths);
  const barge = { id: bs.id, type: btype, center: bp.point, heading: Math.atan2(bp.dir[1], bp.dir[0]), alpha: 1, lit: false, name: bs.name, byBay: btype.bays_m.map(() => []) };
  carriers[bs.id] = barge;
  // yards: stacks by (bay, row)
  const stacks = {};
  for (const [id, g] of Object.entries(yards)) {
    carriers[id] = { id, type: yardType(g), center: g.center, heading: g.angle, grid: new Map() };
    stacks[id] = carriers[id].grid;
  }
  const place = (id, size, high, at, colour = null) => {
    const c = carriers[at.carrier], row = at.row || 0, tier = at.tier || 0;
    if (c.grid) {
      const key = `${at.bay},${row}`;
      const st = c.grid.get(key) || [];
      c.grid.set(key, st);
      const below = st.slice(0, tier).reduce((h, b) => h + b.height, 0);
      st.push(slotBox(c.type, c, id, size, at.bay, row, below, high));
      if (CONTAINER_SIZES[size].bays === 2) c.grid.set(`${at.bay + 1},${row}`, "taken");
    } else if (c.byBay) {
      const below = c.byBay[at.bay].filter((b) => Math.abs(b.center[1] - (c.center[1] + mm(c.type.rows_m[row]))) < 1e-6).reduce((h, b) => h + b.height, 0);
      c.byBay[at.bay].push(slotBox(c.type, c, id, size, at.bay, row, below, high));
    } else {
      c.boxes.push(slotBox(c.type, c, id, size, at.bay, row, 0, high));
    }
  };
  for (const ct of sim.containers) place(ct.id, String(ct.size), !!ct.high, ct.at, ct.colour);
  const rng = createRng(9);
  let n = 0;
  for (const [id, f] of Object.entries(sim.fill)) {
    const g = yards[id], grid = stacks[id];
    for (let b = 0; b < g.bays; b++) {
      for (let r = 0; r < g.rows; r++) {
        if (grid.has(`${b},${r}`) || rng.next() >= f) continue;
        let size = rng.next() < 0.55 ? "20" : rng.next() < 0.78 ? "40" : "45";
        if (size !== "20" && (b + 1 >= g.bays || grid.has(`${b + 1},${r}`))) size = "20";
        const owner = rng.pick(["ARLU", "EBLU", "TUDU", "DBCU"]);
        for (let t = 0; t < g.tiers && (t === 0 || rng.next() < f * 0.5); t++) place(makeBic(owner, 500000 + n++), size, rng.next() < 0.3, { carrier: id, bay: b, row: r, tier: t });
      }
    }
  }
  const rsSpec = objectSpec("reach-stacker-1");
  const scene = {
    crane, yards, lane, positions: lanePositions(lane, laneSpec.positions), quay, loco, wagons, barge,
    stacks: Object.fromEntries(Object.entries(stacks).map(([id, grid]) => [id, [...grid.values()].filter(Array.isArray)])),
    craneState: { geometry: crane, s: 0, t: 0, z: mm(objectSpec("crane-1").lift_m), spreader_m: 6.058, load: null, name: "Portal crane 1", lit: false },
    rs: { center: rsSpec.position, heading: toRad(rsSpec.rotation_deg), boom: 0, lift: mm(2), spreader_m: 6.058, load: null, name: "Reach stacker", lit: false },
    trucks: [],
  };
  if (extras) {
    const ttype = CARRIER_TYPES.chassis40, at = polylineAt(lane.points, scene.positions[1], lane.lengths).point;
    const truck = { id: "T1", type: ttype, center: at, heading: 0, alpha: 1, lit: false, label: "T1" };
    truck.boxes = [slotBox(ttype, truck, "TRKU 100001 5", "40", 0)];
    scene.trucks.push(truck);
    scene.craneState.s = mm(3);
    scene.craneState.t = 280.5 - crane.center[1];
    scene.craneState.z = mm(8);
    scene.craneState.load = drawBox("CSQU 305438 3", "20", false, { center: [0, 0], heading: 0 }, 0, 0, 0);
    scene.rs.load = drawBox("DBCU 400010 5", "20", true, { center: [0, 0], heading: 0 }, 0, 0, 0);
    scene.rs.boom = 0.5;
    scene.rs.lift = mm(4);
  }
  return scene;
}

/** Queue the whole scene, in the order the terminal simulation queues it. */
function queueScene(view, sc, { slots = false, highlights = null } = {}) {
  for (const g of Object.values(sc.yards)) drawYardGround(view, g, { name: "Block" });
  drawCraneRails(view, sc.crane);
  drawTruckLane(view, sc.lane, { positions: sc.positions });
  drawQuay(view, sc.quay);
  drawCrane(view, sc.craneState);
  drawReachStacker(view, sc.rs);
  for (const st of Object.values(sc.stacks)) drawYardStacks(view, st);
  if (slots) for (const g of Object.values(sc.yards)) drawYardLabels(view, g);
  drawLocomotive(view, sc.loco);
  for (const w of sc.wagons) drawWagon(view, w, w.boxes);
  for (const t of sc.trucks) drawTruck(view, t, t.boxes);
  drawBarge(view, sc.barge, sc.barge.byBay);
  if (highlights) drawHighlights(view, highlights);
}

/** The flyover camera of the example: the default direction, fitted to the layout. */
function fitCamera() {
  return new FlyCamera().fit([-460, -60, 1810, 880], W / H);
}

/* ---------------------------------------------------------------- tests */

test("terminal draw: container colours are muted CD colours; a container keeps its colour", () => {
  const rgb = (c) => parseRgba(c).slice(0, 3).map(Math.round);
  assert.equal(CONTAINER_COLOURS.length, 10);
  for (const c of CONTAINER_COLOURS) {
    assert.notDeepEqual(rgb(c), rgb(CD.orange));
    assert.notDeepEqual(rgb(c), rgb(CD.rot));
  }
  const a = colourFor({ id: "ARLU 100001 9" });
  assert.deepEqual(a, colourFor({ id: "ARLU 100001 9" }), "the same container, the same colour");
  assert.ok(CONTAINER_COLOURS.some((c) => rgb(c).join() === a.map(Math.round).join()));
  assert.deepEqual(colourFor({ id: "X", colour: "#102030" }), [16, 32, 48]);
  const used = new Set(Array.from({ length: 200 }, (_, i) => colourFor({ id: makeBic("TEST", i) }).join()));
  assert.ok(used.size >= 8, `${used.size} colours for 200 containers`);
  assert.deepEqual(boxCorners({ center: [10, 20], heading: 0, z0: 5, length: 4, width: 2, height: 3 }), [
    [8, 19, 5], [12, 19, 5], [12, 21, 5], [8, 21, 5], [8, 19, 8], [12, 19, 8], [12, 21, 8], [8, 21, 8],
  ]);
});

test("terminal draw: every drawing works in a top view and in the flyover, by day and at night", (t) => {
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  const sc = exampleScene({ extras: true });
  const sel = sc.wagons[0].boxes[0];
  const cams = [
    ["top", (ctx, night) => topView(ctx, { night })],
    ["fit", (ctx, night) => flyView(ctx, fitCamera(), { night })],
    ["crane", (ctx, night) => flyView(ctx, new FlyCamera({ target: [780, 330], distance: 650, yaw: toRad(60), pitch: toRad(35) }), { night })],
    ["low", (ctx, night) => flyView(ctx, new FlyCamera({ target: [780, 380], distance: 650, yaw: toRad(200), pitch: toRad(15) }), { night })],
  ];
  const model = { type: CARRIER_TYPES.sggrss80, center: [400, 280.5], heading: Math.PI, deck: 15, alpha: 1, tags: [{ slot: 0, id: 8 }, { slot: 3, id: 11 }] };
  for (const [name, make] of cams) {
    for (const night of [0, 1]) {
      const { ctx, ops, stats } = stateContext();
      const view = make(ctx, night);
      queueScene(view, sc, { slots: true, highlights: { selected: sel, targets: [{ ...sel, center: [sel.center[0], 470], z0: 0 }], empties: [{ ...sel, z0: 15 }] } });
      drawWagon(view, model, [drawBox("EBLU 300020 0", "40", true, model, 6.6, 0, 15)]);
      drawContainers(view, [drawBox("TUDU 200001 5", "20", false, { center: [200, 250], heading: 0 }, 0, 0, 15)], [200, 250, 0], { alpha: 0.35 });
      drawGhost(view, rectFootprint([200, 280.5], mm(19.74), mm(2.9)), 15, "W5 not visible");
      const solids = view.items.filter((it) => it.layer === 1).length;
      view.render();
      assert.deepEqual(errors, [], `${name}, night ${night}`);
      assert.equal(stats().depth, 0);
      assert.ok(solids > 40, `${name}, night ${night}: ${solids} solids`);
      assert.ok(ops.filter((o) => o.op === "fill").length > 200, `${name}, night ${night}: ${ops.length} operations`);
      const lights = ops.filter((o) => o.composite === "lighter").length;
      if (night) assert.ok(lights > 0, `${name}: lights at night`);
      else assert.equal(lights, 0, `${name}: no lights by day`);
    }
  }
});

// colours of the design before the CD (see design.test.js)
const OLD_COLOURS = [
  [0, 229, 255], [255, 92, 240], [242, 169, 59], [29, 79, 156], [15, 26, 43], [0, 70, 90], [229, 50, 45], [156, 28, 25],
  [60, 10, 10], [90, 160, 205], [60, 115, 150], [80, 140, 180], [232, 179, 33], [243, 210, 122], [217, 164, 27], [255, 138, 128],
];

function luminance([r, g, b]) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function over(c, under) {
  const [r, g, b, a] = parseRgba(c), u = parseRgba(under);
  return [r, g, b].map((v, i) => a * v + (1 - a) * u[i]);
}

function contrast(text, background, under) {
  const L1 = luminance(over(text, over(background, under))), L2 = luminance(over(background, under));
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

test("terminal draw: container bodies are CD colours, nothing of the old design, labels are legible", () => {
  const sc = exampleScene({ extras: true });
  const { ctx, ops } = stateContext();
  const view = flyView(ctx, new FlyCamera({ target: [750, 420], distance: 900, yaw: toRad(70), pitch: toRad(40) }));
  const calls = recordFaces(view);
  const labels = [];
  const label = view.label.bind(view);
  view.label = (at, text, style = {}) => (labels.push(style), label(at, text, style));
  queueScene(view, sc, { slots: true, highlights: { selected: sc.wagons[0].boxes[0] } });
  view.render();
  // the faces of containers: every body colour (sides) is one of CONTAINER_COLOURS, the top a shade of it
  const palette = CONTAINER_COLOURS.map((c) => parseColor(c).map(Math.round).join());
  const boxes = [...sc.wagons.flatMap((w) => w.boxes), ...Object.values(sc.stacks).flat(2), ...sc.barge.byBay.flat(), ...sc.trucks.flatMap((t) => t.boxes)];
  assert.ok(boxes.length > 25, `${boxes.length} containers`);
  const bodies = new Set(boxes.map((b) => b.colour.map(Math.round).join()));
  for (const c of bodies) assert.ok(palette.includes(c), `container body ${c}`);
  let containerFaces = 0;
  for (const call of calls) {
    for (const f of call.faces) {
      const c = parseColor(f.color).map(Math.round).join();
      if (bodies.has(c)) containerFaces++;
      assert.notEqual(c, parseColor(CD.orange).join(), "no pure Orange");
      assert.notEqual(c, parseColor(CD.rot).join(), "no pure Rot");
    }
  }
  assert.ok(containerFaces > 50, `${containerFaces} container faces`);
  const colours = ops.flatMap((o) => [o.fillStyle, o.strokeStyle]).filter((v) => typeof v === "string");
  assert.ok(colours.length > 300);
  for (const c of colours) {
    const v = parseRgba(c);
    if (!v) continue;
    assert.equal(OLD_COLOURS.find((o) => o.every((x, i) => Math.round(v[i]) === x)), undefined, `colour of the old design: ${c}`);
  }
  assert.ok(labels.length >= 10, `${labels.length} labels`);
  for (const l of labels) {
    for (const under of ["#ffffff", "#000000"]) {
      const c = contrast(l.color || OVERLAY.labelText, l.background || OVERLAY.label, under);
      assert.ok(c >= 4.5, `label on ${l.background} over ${under}: ${c.toFixed(2)}`);
    }
  }
});

test("terminal draw: the example scene draws exactly the same with shared save/restores (plain drawings)", () => {
  const sc = exampleScene({ extras: true });
  for (const cam of [fitCamera(), new FlyCamera({ target: [780, 380], distance: 500, yaw: toRad(120), pitch: toRad(20) })]) {
    const draw = (plain) => {
      const rec = stateContext();
      const view = flyView(rec.ctx, cam, { night: 0.7, px: 2 });
      queueScene(view, sc, { slots: true, highlights: { selected: sc.wagons[0].boxes[0], targets: [sc.wagons[1].boxes[0]] } });
      if (!plain) for (const it of view.items) it.plain = false;
      view.render();
      return rec;
    };
    const fast = draw(true), slow = draw(false);
    assert.ok(fast.ops.length > 500, `${fast.ops.length} operations`);
    assert.equal(fast.ops.length, slow.ops.length);
    for (let i = 0; i < fast.ops.length; i++) assert.deepEqual(fast.ops[i], slow.ops[i], `operation ${i}`);
    assert.equal(fast.stats().depth, 0);
    assert.ok(fast.stats().saves < slow.stats().saves / 2, `${fast.stats().saves} instead of ${slow.stats().saves} saves`);
  }
});

test("terminal draw: a yard and its stacks entirely outside the image queue nothing", () => {
  const sc = exampleScene();
  const { ctx } = stateContext();
  // looking at a place far away from the terminal
  const view = topView(ctx, { c: [9000, 9000], d: 1500 });
  for (const g of Object.values(sc.yards)) {
    drawYardGround(view, g, { name: "Block" });
    drawYardLabels(view, g);
  }
  for (const st of Object.values(sc.stacks)) drawYardStacks(view, st);
  drawCrane(view, sc.craneState);
  drawCraneRails(view, sc.crane);
  drawQuay(view, sc.quay);
  drawTruckLane(view, sc.lane, { positions: sc.positions });
  drawLocomotive(view, sc.loco);
  for (const w of sc.wagons) drawWagon(view, w, w.boxes);
  drawBarge(view, sc.barge, sc.barge.byBay);
  drawReachStacker(view, sc.rs);
  assert.equal(view.items.length, 0);
  // the same yard in the image queues its ground and stacks
  const near = topView(stateContext().ctx);
  drawYardGround(near, sc.yards["yard-a"]);
  drawYardStacks(near, sc.stacks["yard-a"]);
  assert.ok(near.items.length > 10);
});

test("terminal draw: level of detail: corrugation and doors from 25 px, corner castings from 60 px, a plain box below", () => {
  const box = drawBox("ARLU 100001 9", "20", false, { center: [0, 0], heading: 0 }, 0, 0, 0);
  const detail = (d) => {
    const view = topView(stateContext().ctx, { c: [0, 0], d });
    const calls = recordFaces(view);
    drawContainers(view, [box], [0, 0, 0]);
    const a = view.project(-box.length / 2, 0, 0), b = view.project(box.length / 2, 0, 0);
    const px = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const decals = calls.flatMap((c) => c.faces).flatMap((f) => f.decals || []);
    return { px, decals: decals.length, castings: decals.filter((d) => d.pts.length === 4).length };
  };
  const far = detail(60000), mid = detail(2400), near = detail(800);
  assert.ok(far.px < 6, `${far.px} px`);
  assert.equal(far.decals, 0, "below 6 px: a plain box");
  assert.ok(mid.px >= 25 && mid.px < 60, `${mid.px} px`);
  assert.ok(mid.decals > 0, "corrugation from 25 px");
  assert.equal(mid.castings, 0, "no corner castings below 60 px");
  assert.ok(near.px >= 60, `${near.px} px`);
  assert.ok(near.castings >= 4, `${near.castings} corner castings`);
  // a box between 6 and 25 px has no decals either
  const small = detail(9000);
  assert.ok(small.px >= 6 && small.px < 25, `${small.px} px`);
  assert.equal(small.decals, 0);
});

test("terminal draw: pickBoxes finds the box under a point, the nearest of overlapping boxes, nothing outside", () => {
  const view = flyView(stateContext().ctx, new FlyCamera({ target: [0, 0], distance: 600, yaw: toRad(90), pitch: toRad(40) }));
  const pose = { center: [0, 0], heading: 0 };
  const low = drawBox("LOW", "20", false, pose, 0, 0, 0), high = drawBox("HIGH", "20", false, pose, 0, 0, mm(2.591));
  const behind = drawBox("BEHIND", "40", false, { center: [0, 60], heading: 0 }, 0, 0, 0);
  const at = (b, z = b.z0 + b.height / 2) => view.project(b.center[0], b.center[1], z);
  // the top box covers the one below it and the one behind it
  const p = at(high);
  assert.equal(pickBoxes(view, [low, behind, high], p[0], p[1]), "HIGH");
  assert.equal(pickBoxes(view, [behind, low], ...at(low)), "LOW");
  assert.equal(pickBoxes(view, [behind], ...at(behind)), "BEHIND");
  // within 3 px of the outline, and not further
  const corners = boxCorners(low).map((c) => view.project(...c));
  const right = Math.max(...corners.map((c) => c[0]));
  const y = corners.find((c) => c[0] === right)[1];
  assert.equal(pickBoxes(view, [low], right + 2.5, y), "LOW");
  assert.equal(pickBoxes(view, [low], right + 4, y), null);
  assert.equal(pickBoxes(view, [low, high, behind], 5, 5), null);
  assert.equal(pickBoxes(view, [], 640, 360), null);
});

test("terminal draw: the containers of a wagon are queued after its frame with the same key; spreader and load go together", () => {
  const sc = exampleScene({ extras: true });
  const view = flyView(stateContext().ctx, new FlyCamera({ target: [780, 330], distance: 700, yaw: toRad(60), pitch: toRad(35) }));
  const calls = recordFaces(view);
  const frame = parseColor(TERMINAL_COLOURS.wagonFrame).join();
  const w = sc.wagons[0];
  drawWagon(view, w, w.boxes);
  const isFrame = (c) => c.faces.some((f) => parseColor(f.color).join() === frame);
  const frames = calls.filter(isFrame), boxes = calls.filter((c) => !isFrame(c));
  assert.ok(frames.length >= 2 && boxes.length >= 3, `${frames.length} frame and ${boxes.length} container items`);
  for (const b of boxes) {
    const f = frames.find((x) => x.key === b.key);
    assert.ok(f, "a frame piece with the same key");
    assert.ok(f.n < b.n, "queued before the container");
  }
  // the crane: the spreader (Gelb) and the hanging box are drawn together, piece by piece, above the
  // carriers: each piece holds both, with its reference at the middle of the load
  const crane = flyView(stateContext().ctx, new FlyCamera({ target: [780, 330], distance: 700, yaw: toRad(60), pitch: toRad(35) }));
  const cc = recordFaces(crane);
  drawCrane(crane, sc.craneState);
  const gelb = parseColor(CD.gelb).join(), load = sc.craneState.load.colour.join();
  const has = (c, colour) => c.faces.some((f) => parseColor(f.color).join() === colour);
  const hanging = cc.filter((c) => has(c, gelb) || has(c, load));
  assert.ok(hanging.length >= 1);
  for (const c of hanging) {
    assert.ok(has(c, gelb) && has(c, load), "spreader and load in the same item");
    assert.ok(Math.abs(c.ref[2] - (sc.craneState.z - sc.craneState.load.height / 2)) < 1e-6, "reference at the middle of the load");
  }
  const trolley = cc.find((c) => has(c, parseColor(TERMINAL_COLOURS.craneTrolley).join()) && !has(c, gelb));
  const girder = parseColor(TERMINAL_COLOURS.craneGirder).join();
  const segment = cc.find((c) => has(c, girder) && c.key === trolley.key);
  assert.ok(segment && segment.n < trolley.n, "the trolley follows the girder segment under it");
  assert.ok(crane.items.some((it) => it.layer === 1 && Math.abs(it.key - trolley.key - 1e-3) < 1e-9 && it.plain), "the ropes: just before the trolley, plain");
});

test("terminal draw: wagons on parallel tracks are sorted right where they overlap, also seen at an angle", () => {
  // a long model wagon on track 2, further along than the wagon on track 1 in front of it (the camera
  // looks along the tracks at an angle): where they overlap, the near one is drawn last
  for (const yaw of [20, 45, 60, 120, 160]) {
    const view = flyView(stateContext().ctx, new FlyCamera({ target: [400, 280], distance: 300, yaw: toRad(yaw), pitch: toRad(30) }));
    const calls = recordFaces(view);
    const near = { type: CARRIER_TYPES.sggrss80, center: [523, 228.7], heading: 0, alpha: 1 };
    const far = { type: CARRIER_TYPES.sggrss80, center: [400, 280.5], heading: Math.PI, alpha: 1 };
    const farBox = drawBox("FAR", "40", true, far, 6.6, 0, mm(1.155));
    const nearBox = drawBox("NEAR", "40", false, near, 6.6, 0, mm(1.155));
    const [first, second] = yaw < 90 ? [far, near] : [near, far];
    drawWagon(view, first, [first === far ? farBox : nearBox]);
    const split = calls.length;
    drawWagon(view, second, [second === far ? farBox : nearBox]);
    const farCalls = first === far ? calls.slice(0, split) : calls.slice(split), nearCalls = first === far ? calls.slice(split) : calls.slice(0, split);
    // pieces at the same place along the tracks (their x ranges overlap): the far track's piece has
    // the larger key (drawn first)
    const range = (c) => {
      const xs = c.faces.flatMap((f) => f.pts.map((p) => p[0]));
      return [Math.min(...xs), Math.max(...xs)];
    };
    let pairs = 0;
    for (const a of nearCalls) {
      for (const b of farCalls) {
        const [a0, a1] = range(a), [b0, b1] = range(b);
        if (Math.min(a1, b1) - Math.max(a0, b0) < 1) continue;
        pairs++;
        assert.ok(b.key > a.key, `yaw ${yaw}: the far piece at x ${b0.toFixed(1)}..${b1.toFixed(1)} is drawn before the near one`);
      }
    }
    assert.ok(pairs >= 3, `yaw ${yaw}: ${pairs} pairs`);
  }
});

test("terminal draw: at the edge of a wide view the pieces of a container nearer to the camera are drawn last", () => {
  // the camera stands beside the wagon's end (further along x) but looks a little along +x: the view's
  // depth alone would put the nearer pieces behind the farther ones
  const cam = new FlyCamera({ target: [780, 400], distance: 800, yaw: toRad(75), pitch: toRad(35) });
  const eye = cam.basis().eye;
  const view = flyView(stateContext().ctx, cam);
  const calls = recordFaces(view);
  const wagon = { type: CARRIER_TYPES.sggrss80, center: [400, 280.5], heading: Math.PI, alpha: 1 };
  const box = drawBox("EDGE", "40", true, wagon, 6.6, 0, mm(1.155));
  assert.ok(eye[0] > box.center[0] + box.length / 2, "the camera is beside the box's end");
  drawWagon(view, wagon, [box]);
  const colour = box.colour.join();
  const pieces = calls.filter((c) => c.faces.some((f) => parseColor(f.color).join() === colour)).map((c) => ({ x: Math.max(...c.faces.flatMap((f) => f.pts.map((p) => p[0]))), key: c.key }));
  assert.ok(pieces.length >= 2, `${pieces.length} pieces`);
  pieces.sort((a, b) => a.x - b.x);
  for (let i = 1; i < pieces.length; i++) assert.ok(pieces[i].key < pieces[i - 1].key, "nearer to the camera, drawn later");
});

test("terminal draw: highlights are overlays in the CD roles and are never darkened", () => {
  const sc = exampleScene();
  const { ctx, ops } = stateContext();
  const view = topView(ctx, { night: 1 });
  const sel = sc.wagons[0].boxes[0];
  drawHighlights(view, { selected: sel, targets: [sc.wagons[1].boxes[0]], empties: [{ ...sel, z0: 15 }] });
  drawGhost(view, rectFootprint([200, 280.5], mm(19.74), mm(2.9)), 15, "W3 not visible");
  assert.ok(view.items.every((it) => it.layer === 2), "overlay layer");
  assert.deepEqual([...new Set(view.items.map((it) => it.key))].sort((a, b) => a - b), [20, 30, 90, 100]);
  view.render();
  const strokes = ops.filter((o) => o.op === "stroke");
  const sel100 = strokes.find((o) => o.strokeStyle === OVERLAY.selection);
  assert.ok(sel100, "the selected container in Orange");
  assert.equal(sel100.lineWidth, 2.5);
  const target = strokes.find((o) => o.strokeStyle === OVERLAY.tracked && o.dash.length && o.lineWidth === 2 && o.globalAlpha === 1);
  assert.deepEqual(target.dash, [6, 4]);
  assert.ok(strokes.some((o) => o.strokeStyle.startsWith("rgba(54,184,191,0.8") && o.lineWidth === 1.5), "empty slots");
  assert.ok(strokes.some((o) => o.globalAlpha === 0.5 && o.dash.length), "ghost at half opacity");
  const texts = ops.filter((o) => o.op === "fillText").map((o) => o.text);
  assert.ok(texts.includes(sel.id) && texts.includes("W3 not visible"));
});

test("terminal draw: ground: concrete yard, one batched path of cell lines, lanes, rails and water", () => {
  const sc = exampleScene();
  const view = topView(stateContext().ctx);
  const g = sc.yards["yard-a"];
  drawYardGround(view, g, { name: "Block A" });
  const ground = view.items.filter((it) => it.layer === 0);
  assert.deepEqual(ground.map((it) => it.key), [2.5, 4], "surface and all cell lines in one path");
  const labels = view.items.filter((it) => it.layer === 2);
  assert.equal(labels.length, 1, "the block's name");
  view.items = [];
  drawYardLabels(view, g);
  assert.equal(view.items.length, g.bays, "bay numbers; rows are closer than 20 px");
  const near = topView(stateContext().ctx, { c: g.center, d: 1200 });
  drawYardLabels(near, g);
  assert.equal(near.items.length, g.bays + g.rows, "bay and row numbers");
  view.items = [];
  drawTruckLane(view, sc.lane, { positions: sc.positions });
  assert.deepEqual(view.items.map((it) => it.key).sort((a, b) => a - b), [2, 2.2, 2.3, 2.3, 2.3]);
  view.items = [];
  drawCraneRails(view, sc.crane);
  assert.deepEqual(view.items.map((it) => it.key).sort((a, b) => a - b), [3, 3, 6, 6, 6, 6], "runways, rail heads and hairlines");
  view.items = [];
  drawQuay(view, sc.quay);
  assert.deepEqual(view.items.map((it) => it.key).sort((a, b) => a - b), [0.6, 3, 3.1]);
  // a beam between two points has four sides and two ends
  assert.equal(beamFaces([0, 0, 0], [10, 0, 5], 1, 1, { side: [1, 2, 3] }).length, 6);
});

test("terminal draw: slot numbers move no other label and are left out where they would overlap one", () => {
  const sc = exampleScene({ extras: true });
  const texts = (cam, slots) => {
    const { ctx, ops } = stateContext();
    const view = flyView(ctx, cam);
    queueScene(view, sc, { slots });
    view.render();
    return { view, texts: ops.filter((o) => o.op === "fillText").map((o) => ({ text: o.text, x: o.x, y: o.y })) };
  };
  const cams = [
    ["fit", fitCamera()],
    ["35°", new FlyCamera({ target: [750, 415], distance: 2000, yaw: toRad(90), pitch: toRad(35) })],
    ["Block A", new FlyCamera({ target: [330, 470], distance: 700, yaw: toRad(90), pitch: toRad(70) })],
  ];
  for (const [name, cam] of cams) {
    const without = texts(cam, false).texts, { view, texts: all } = texts(cam, true);
    const named = all.filter((t) => !/^\d+$/.test(t.text));
    assert.deepEqual(named, without, `${name}: the vehicle and block labels stay where they are`);
    // every slot number is drawn at its anchor (none is moved up out of order)
    const g = sc.yards["yard-a"], k = mm(1), ha = (g.bays * 6.9) / 2, ht = (g.rows * 2.9) / 2;
    const rows = Array.from({ length: g.rows }, (_, j) => view.project(g.center[0] - (ha + 2.2) * k, g.center[1] + (-ht + 2.9 * (j + 0.5)) * k, 0));
    const drawn = rows.map((p, j) => all.find((t) => t.text === String(j + 1) && Math.abs(t.y - (p[1] - 5)) < 0.5 && Math.abs(t.x - (p[0] - 3)) < 12));
    if (name === "Block A") assert.ok(drawn.every(Boolean), `${name}: rows 1-${g.rows} at their places: ${JSON.stringify(all.filter((t) => /^\d$/.test(t.text)))}`);
    else assert.ok(drawn.every((t) => !t), `${name}: no row numbers where rows are closer than 20 px`);
  }
});

test("terminal draw: close flyover cameras over the yard, the runway and the crane give thin strokes", () => {
  const sc = exampleScene({ extras: true });
  const crane = { ...sc.craneState, s: 288, t: 280.5 - sc.crane.center[1], z: 100 };
  const cameras = [
    ...[300, 290, 280, 270, 260].map((ty) => ({ target: [750, ty], distance: 200, yaw: 270, pitch: 20 })),
    { target: [1560, 270], distance: 200, yaw: 270, pitch: 20 },
    { target: [1050, 260], distance: 300, yaw: 300, pitch: 45 },
    { target: [1038, -400], distance: 780, yaw: 270, pitch: 10 },
    { target: [1038, 0], distance: 400, yaw: 270, pitch: 15 },
    { target: [1038, 150], distance: 300, yaw: 270, pitch: 30 },
  ];
  for (const c of cameras) {
    const { ctx, ops } = stateContext();
    const view = flyView(ctx, new FlyCamera({ target: c.target, distance: c.distance, yaw: toRad(c.yaw), pitch: toRad(c.pitch) }));
    for (const g of Object.values(sc.yards)) drawYardGround(view, g, { name: "A" });
    drawCraneRails(view, sc.crane);
    drawCrane(view, crane);
    view.render();
    const widest = Math.max(0, ...ops.filter((o) => o.op === "stroke").map((o) => o.lineWidth));
    assert.ok(widest <= 3, `${JSON.stringify(c)}: a stroke of ${widest} px`);
  }
});

test("terminal draw: the example at the fit-view camera stays within the drawing budget", () => {
  const sc = exampleScene();
  const { ctx, ops } = stateContext();
  const view = flyView(ctx, fitCamera());
  queueScene(view, sc);
  const solids = view.items.filter((it) => it.layer === 1).length;
  view.render();
  const drawing = ops.length;
  if (process.env.ARAIL_BUDGET) console.log(`${solids} solid items, ${drawing} drawing operations`);
  assert.ok(solids <= 450, `${solids} solid items`);
  assert.ok(drawing <= 2500, `${drawing} drawing operations`);
  assert.ok(solids > 50 && drawing > 300, `${solids} solids, ${drawing} operations: the scene is drawn`);
});

test("terminal draw: colours of the terminal are fixed per role", () => {
  assert.equal(TERMINAL_COLOURS.spreader, CD.gelb);
  assert.equal(TERMINAL_COLOURS.craneGirder, grey(0.78));
  assert.equal(TERMINAL_COLOURS.hull, mix(CD.dunkelblau, grey(0.4), 0.3));
});
