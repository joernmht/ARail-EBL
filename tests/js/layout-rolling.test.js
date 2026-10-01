// Contracts of the container terminal: rolling-stock marker settings (`markers.rolling`), the
// generic `static validate` hook for simulation settings, the BIC (ISO 6346) helpers, and the
// terminal's registered types and placeholder simulation with the example layout.
import assert from "node:assert/strict";
import test from "node:test";

import {
  BAY_M, CARRIER_TYPES, DEFAULT_ROLLING, PHASE_LABELS, Registry, ROW_M, Simulation, TERMINAL_EVENTS, TERMINAL_REQUESTS, TerminalSimulation,
  bargeType, bicCheckDigit, bicProblem, createWorld, decodeTag, encodeTag, makeBic, normalizeLayout, normalizeRollingMarkers, parseBic,
  registerBuiltins, registry, terminalOf, trapezoid, validateLayout, yardGrid, yardType,
} from "../../web/arail/index.js";
import { readJSON } from "./helpers.js";

const EXAMPLE = readJSON("web/layouts/container-terminal.json");
const ROLLING = { dictionary: "APRILTAG_36h11", codes: 64, size_mm: 20, height_mm: 15, stride: 4, max_bit_errors: 3 };

test("rolling-stock markers: defaults fill in, invalid values fall back to them", () => {
  assert.equal(normalizeRollingMarkers(undefined), null);
  assert.equal(normalizeRollingMarkers(null), null);
  assert.equal(normalizeRollingMarkers(5), null);
  assert.equal(normalizeRollingMarkers([1, 2]), null);
  assert.deepEqual(normalizeRollingMarkers({}), ROLLING);
  assert.deepEqual({ ...DEFAULT_ROLLING }, ROLLING);
  assert.ok(Object.isFrozen(DEFAULT_ROLLING));
  assert.deepEqual(
    normalizeRollingMarkers({ dictionary: "ARUCO_5X5_1000", codes: "128", size_mm: 18.5, height_mm: 0, stride: 3, max_bit_errors: 0 }),
    { dictionary: "ARUCO_5X5_1000", codes: 128, size_mm: 18.5, height_mm: 0, stride: 3, max_bit_errors: 0 },
  );
  assert.deepEqual(
    normalizeRollingMarkers({ dictionary: "nope", codes: 0, size_mm: 4, height_mm: -1, stride: 2.5, max_bit_errors: 7 }),
    ROLLING,
    "every invalid value is replaced by its default",
  );
  assert.deepEqual(normalizeRollingMarkers({ codes: 1001, size_mm: "x", height_mm: 201, stride: 9, max_bit_errors: true }), ROLLING);
  // in normalizeLayout: only when given, right after sizes_mm
  assert.ok(!("rolling" in normalizeLayout({}).markers));
  assert.ok(!("rolling" in normalizeLayout({ markers: { rolling: "yes" } }).markers));
  const keys = Object.keys(normalizeLayout({ markers: { rolling: { size_mm: 22 } } }).markers);
  assert.equal(keys[keys.indexOf("sizes_mm") + 1], "rolling");
  assert.equal(normalizeLayout({ markers: { rolling: { size_mm: 22 } } }).markers.rolling.size_mm, 22);
});

test("rolling-stock markers are kept in layout files, before locked, moving and poses", () => {
  const json = { markers: { dictionary: "ARUCO", rolling: { size_mm: 18, extra: 1 }, locked: true, moving: [40], poses: { 0: [0, 0, 0], 1: [500, 0, 0] } } };
  const world = createWorld(json);
  const m = world.toJSON().markers;
  assert.deepEqual(m.rolling, { ...ROLLING, size_mm: 18 }, "written with all six keys (unknown keys dropped)");
  assert.deepEqual(Object.keys(m.rolling), Object.keys(ROLLING));
  assert.deepEqual(Object.keys(m).slice(-3), ["locked", "moving", "poses"]);
  assert.ok(Object.keys(m).indexOf("rolling") < Object.keys(m).indexOf("locked"));
  // round trip
  assert.deepEqual(createWorld(world.toJSON()).toJSON().markers, m);
  assert.deepEqual(createWorld(world.toJSON()).toJSON(), world.toJSON());
  // without rolling-stock markers nothing is written
  assert.ok(!("rolling" in createWorld({ markers: { poses: { 0: [0, 0, 0] } } }).toJSON().markers));
});

test("rolling-stock markers: every problem is reported", () => {
  const problems = (markers) => validateLayout({ markers });
  const has = (list, text) => assert.ok(list.some((p) => p.includes(text)), `"${text}" in ${JSON.stringify(list)}`);
  assert.deepEqual(problems({ dictionary: "ARUCO", rolling: ROLLING }), []);
  assert.deepEqual(problems({ rolling: {} }), [], "the defaults are valid with the default layout marker type");
  assert.deepEqual(problems({ dictionary: "APRILTAG_36h11", rolling: { dictionary: "ARUCO" } }), []);

  has(problems({ rolling: 5 }), 'markers.rolling must be an object like {"dictionary": "APRILTAG_36h11", "size_mm": 20}');
  has(problems({ rolling: [] }), "markers.rolling must be an object");
  has(problems({ rolling: { dictionary: "QR" } }), 'markers.rolling.dictionary: unknown marker type "QR"');
  has(problems({ rolling: { dictionary: "auto" } }), 'markers.rolling.dictionary: unknown marker type "auto"');
  has(
    problems({ dictionary: "ARUCO", rolling: { dictionary: "ARUCO" } }),
    'markers.rolling.dictionary: rolling-stock markers need their own marker type; "ARUCO" is the layout\'s marker type',
  );
  has(problems({ rolling: { dictionary: "ARUCO" } }), "need their own marker type"); // the layout's marker type defaults to ARUCO
  has(problems({ dictionary: "APRILTAG_36h11", rolling: {} }), '"APRILTAG_36h11" is the layout\'s marker type');
  for (const d of ["ARUCO_4X4_1000", "ARUCO_MIP_36h12"]) {
    for (const layout of ["ARUCO", "auto"]) {
      has(problems({ dictionary: layout, rolling: { dictionary: d } }), `markers.rolling.dictionary: ${d} is misread as ArUco Original and the other way round; use APRILTAG_36h11`);
    }
    assert.ok(!problems({ dictionary: "ARUCO_5X5_1000", rolling: { dictionary: d } }).some((p) => p.includes("misread")));
  }
  has(problems({ dictionary: "auto", rolling: {} }), 'markers.dictionary: choose the layout\'s marker type (not "auto") when rolling-stock markers are used');
  assert.ok(!problems({ dictionary: "auto" }).some((p) => p.includes("auto")), "auto is fine without rolling-stock markers");

  const ranges = {
    codes: [0, 1001, 2.5, "x"], size_mm: [4, 101, "big"], height_mm: [-1, 201], stride: [0, 9, 1.5], max_bit_errors: [-1, 7, 0.5, true],
  };
  for (const [key, bad] of Object.entries(ranges)) {
    for (const v of bad) has(problems({ rolling: { [key]: v } }), `markers.rolling.${key} must be `);
  }
  has(problems({ rolling: { codes: 0 } }), "markers.rolling.codes must be a whole number from 1 to 1000");
  has(problems({ rolling: { size_mm: 4 } }), "markers.rolling.size_mm must be a number from 5 to 100 (mm)");
  has(problems({ rolling: { height_mm: 201 } }), "markers.rolling.height_mm must be a number from 0 to 200 (mm)");
  has(problems({ rolling: { stride: 9 } }), "markers.rolling.stride must be a whole number from 1 to 8");
  has(problems({ rolling: { max_bit_errors: 7 } }), "markers.rolling.max_bit_errors must be a whole number from 0 to 6");
  for (const [key, v] of [["codes", 1], ["codes", 1000], ["size_mm", 5], ["size_mm", 100], ["height_mm", 0], ["height_mm", 200], ["stride", 1], ["stride", 8], ["max_bit_errors", 0], ["max_bit_errors", 6]]) {
    assert.deepEqual(problems({ rolling: { [key]: v } }), [], `${key} = ${v} is valid`);
  }
});

test("simulation settings are checked by the simulation's static validate", () => {
  class Checked extends Simulation {
    static type = "x";
    static validate(cfg, layout) {
      const out = [];
      if (cfg.rate != null && !(cfg.rate > 0)) out.push("rate must be positive");
      if (layout.markers.rolling == null) out.push(`no rolling-stock markers at scale ${layout.scale}`);
      return out;
    }
  }
  class Broken extends Simulation {
    static type = "broken";
    static validate() {
      throw new Error("boom");
    }
  }
  class Plain extends Simulation {
    static type = "plain";
  }
  const reg = new Registry();
  for (const Sim of [Checked, Broken, Plain]) reg.registerSimulation(Sim);
  const json = { simulations: [{ type: "x", rate: -1 }, { type: "plain" }, { type: "broken" }, { type: "missing" }, "junk"] };
  assert.deepEqual(validateLayout(json, reg), [
    "simulations[0] (x): rate must be positive",
    "simulations[0] (x): no rolling-stock markers at scale 87",
    "simulations[2] (broken): could not be checked (boom)",
  ]);
  // it receives the normalized layout
  assert.deepEqual(validateLayout({ markers: { rolling: {} }, simulations: [{ type: "x" }] }, reg), []);
  // without a registry simulations are not checked
  assert.deepEqual(validateLayout(json), []);
});

test("BIC codes (ISO 6346): check digit, parsing, problems and new numbers", () => {
  assert.equal(bicCheckDigit("CSQU305438"), 3);
  assert.equal(bicCheckDigit("CSQU 305438"), 3);
  assert.equal(bicCheckDigit("ARLU100001"), 9);
  assert.equal(bicCheckDigit("ARLU000012"), 2);
  assert.equal(bicCheckDigit("ARLU123456"), 8);
  assert.ok(Number.isNaN(bicCheckDigit("CSQU30543")));
  assert.ok(Number.isNaN(bicCheckDigit("C5QU305438")));
  // letter values skip multiples of 11: K = 21, L = 23, U = 32, V = 34
  assert.equal(bicCheckDigit("KLUV000000"), (21 + 23 * 2 + 32 * 4 + 34 * 8) % 11 % 10);

  for (const id of ["CSQU 305438 3", "CSQU3054383", "CSQU 305438-3", " csqu305438 - 3 "]) {
    assert.deepEqual(parseBic(id), { owner: "CSQU", serial: "305438", check: 3 }, id);
  }
  for (const id of ["", "Block A", "CSQU 30543 3", "CSQU 305438", "CSQ 305438 3", null, undefined, 42]) assert.equal(parseBic(id), null, String(id));

  assert.equal(bicProblem("CSQU 305438 3"), null);
  assert.equal(bicProblem("ARLU 100001 4"), "check digit should be 9");
  assert.equal(bicProblem("my box"), null, "not shaped like a container number: no problem");

  assert.equal(makeBic("TRKU", 123), "TRKU 000123 9");
  assert.equal(makeBic("ARLU", 100001), "ARLU 100001 9");
  assert.equal(makeBic("arlu", 500000), `ARLU 500000 ${bicCheckDigit("ARLU500000")}`);
  for (const n of [0, 7, 99999, 100000, 999999]) assert.equal(bicProblem(makeBic("EBLU", n)), null);
});

test("every container of the example layout has a valid BIC code", () => {
  const term = EXAMPLE.simulations.find((s) => s.type === "terminal");
  assert.ok(term.containers.length >= 10);
  for (const c of term.containers) {
    assert.ok(parseBic(c.id), `${c.id} is shaped like a container number`);
    assert.equal(bicProblem(c.id), null, c.id);
  }
  assert.equal(new Set(term.containers.map((c) => c.id)).size, term.containers.length, "ids are unique");
  // the scenario moves containers of the example
  const ids = new Set(term.containers.map((c) => c.id));
  const moved = EXAMPLE.scenarios.flatMap((s) => s.steps).map((st) => st.emit?.payload?.container).filter(Boolean);
  assert.ok(moved.length > 0 && moved.every((id) => ids.has(id)), moved.join(", "));
});

test("terminal types: registered with the built-ins, frozen parameters", () => {
  const types = ["container-yard", "gantry-crane", "truck-lane", "quay", "reach-stacker"];
  for (const t of types) {
    const cls = registry.objects.get(t);
    assert.ok(cls, t);
    assert.equal(cls.category, "Terminal");
    assert.ok(cls.description.length > 20, t);
    assert.equal(cls.params[0].key, "name");
    for (const p of cls.params.filter((q) => q.type === "number")) assert.ok(p.min < p.max && p.default >= p.min && p.default <= p.max, `${t}.${p.key}`);
  }
  assert.ok(registry.simulations.get("terminal") === TerminalSimulation);
  assert.ok(registerBuiltins(new Registry()).objects.has("quay"));
  const placement = Object.fromEntries(types.map((t) => [t, registry.objects.get(t).placement]));
  assert.deepEqual(placement, { "container-yard": "rect", "gantry-crane": "rect", "truck-lane": "polyline", quay: "polyline", "reach-stacker": "point" });
  assert.deepEqual(types.filter((t) => registry.objects.get(t).background), ["gantry-crane", "quay"]);
  const defaults = Object.fromEntries(types.map((t) => [t, registry.objects.get(t).defaults()]));
  assert.deepEqual(defaults, {
    "container-yard": { name: "", width_mm: 476, depth_mm: 134, rotation_deg: 0, tiers: 3 },
    "gantry-crane": { name: "", width_mm: 1150, depth_mm: 345, rotation_deg: 0, outreach_m: 8, lift_m: 15, speed: 1 },
    "truck-lane": { name: "", positions: 3, passing_side: "left" },
    quay: { name: "", berth_m: 60, water_m: 16, quay_side: "right" },
    "reach-stacker": { name: "", rotation_deg: 0, tiers: 3, speed: 1 },
  });
  // the editor's rect contract
  for (const t of ["container-yard", "gantry-crane"]) {
    const keys = registry.objects.get(t).params.map((p) => p.key);
    for (const k of ["width_mm", "depth_mm", "rotation_deg"]) assert.ok(keys.includes(k), `${t}.${k}`);
  }

  assert.deepEqual(yardGrid(952, 134, 87), { bays: 12, rows: 4 });
  assert.deepEqual(yardGrid(318, 134, 87), { bays: 4, rows: 4 });
  assert.deepEqual(yardGrid(10, 10, 87), { bays: 1, rows: 1 });
  const yard = yardType({ bays: 2, rows: 3, tiers: 4 });
  assert.equal(yard.kind, "yard");
  assert.deepEqual(yard.bays_m.map((b) => +b.toFixed(6)), [-BAY_M / 2, BAY_M / 2]);
  assert.deepEqual(yard.rows_m.map((r) => +r.toFixed(6)), [-ROW_M, 0, ROW_M]);
  assert.equal(yard.length_m, 2 * BAY_M);
  assert.equal(bargeType({}).bays_m.length, 5, "a 55 m barge has 5 bays");
  assert.equal(bargeType({ length_m: 25 }).bays_m.length, 1);
  assert.deepEqual(Object.keys(CARRIER_TYPES), ["sgns60", "lgns40", "sggrss80", "chassis40"]);

  assert.deepEqual(decodeTag(9, 4), { number: 3, slot: 1 });
  for (const stride of [3, 4]) for (let id = 0; id < 40; id++) {
    const { number, slot } = decodeTag(id, stride);
    assert.equal(encodeTag(number, slot, stride), id);
  }
  assert.equal(trapezoid(0, 1, 1), 0);
  assert.ok(Math.abs(trapezoid(-4, 2, 1) - 4) < 1e-12, "triangle: 2·sqrt(4/1)");
  assert.ok(Math.abs(trapezoid(10, 2, 1) - 7) < 1e-12, "trapezoid: 10/2 + 2/1");
  assert.equal(TERMINAL_REQUESTS.unload, "terminal.request.unload");
  assert.equal(TERMINAL_REQUESTS.load, "terminal.request.load");
  assert.ok(Object.values(TERMINAL_EVENTS).every((n) => n.startsWith("terminal.")));
  assert.equal(PHASE_LABELS["set-down"], "setting down");
});

test("the example terminal layout validates and loads with the placeholder terminal", () => {
  assert.deepEqual(validateLayout(EXAMPLE, registry), []);
  const world = createWorld(EXAMPLE);
  assert.equal(world.objects.length, EXAMPLE.objects.length);
  assert.ok(!world.objects.some((o) => o.constructor.name === "UnknownObject"), "all object types known");
  const term = terminalOf(world);
  assert.ok(term instanceof TerminalSimulation);
  assert.equal(term.name, "KV terminal");
  assert.equal(terminalOf(createWorld({})), null);
  assert.deepEqual(world.toJSON().markers.rolling, ROLLING);
  assert.deepEqual(world.toJSON().simulations, EXAMPLE.simulations, "the terminal entry is kept verbatim");
  assert.deepEqual(world.toJSON().view, { start: "flyover" });

  // inert: refuses with a reason, never throws
  const NOT = "The terminal is not implemented yet";
  assert.deepEqual(term.request("ARLU 100001 9", { carrier: "yard-a" }), { error: NOT });
  assert.deepEqual(term.addTrain({ track: "track-1" }), { error: NOT });
  assert.deepEqual(term.sendTruck(), { error: NOT });
  assert.equal(term.call("KT52"), NOT);
  assert.equal(term.depart("KT41", { force: true }), NOT);
  assert.equal(term.cancel("M1"), NOT);
  assert.deepEqual(term.targets("ARLU 100001 9"), { ok: [], refused: [] });
  assert.deepEqual(term.unload("KT41"), { moves: [], refused: [] });
  assert.deepEqual(term.load("KT52", { from: "yard" }), { moves: [], refused: [] });
  assert.deepEqual(term.carriers(), []);
  assert.equal(term.inventory.canPlace(null, null), NOT);
  assert.equal(term.tagHeight(9), 15);
  term.saveStart();
  term.clear();
  term.observe({}, 0);
  term.forgetObservations();
  for (let i = 0; i < 20; i++) world.step(0.1);
  world.scenarios.play("morning-shift");
  for (let i = 0; i < 20; i++) world.step(0.5);
  assert.deepEqual(world.toJSON().simulations, EXAMPLE.simulations);
});
