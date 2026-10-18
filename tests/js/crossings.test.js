// Railway crossings (objects/crossings.js): one object whose type is a class of its own by its kind
// (a bridge, an underpass, level crossings by their protection), the height a bridge needs and the
// ramps of its street (or none between raised table modules), ramps that do not fit, level
// crossings that close, trams that never cross a railway at street level, and the street access
// check with its fixes (core/access.js).
import assert from "node:assert/strict";
import test from "node:test";

import {
  AtGrade, CROSSING_NORMS, CROSSING_TYPES, CrossbuckOnly, CrossingType, FullBarriers, HalfBarriers, FlashingLights, OverTrack, UnderTrack, accessProblems, applyFix, createWorld,
} from "../../web/arail/index.js";

const TRACK = { id: "track", type: "track", track_id: "G1", points: [[2000, -3000], [2000, 3000]] };
const MAIN = { id: "main", type: "road", name: "Main", points: [[0, 0], [4000, 0]] };
/** The real table with the track at the track level, and table modules raised 80 mm on both sides of it. */
const MODULES = [
  { id: "table", type: "tabletop", kind: "physical", position: [2000, 0], width_mm: 600, depth_mm: 6000 },
  { id: "west", type: "tabletop", position: [850, 0], width_mm: 1700, depth_mm: 1000, level_mm: 80 },
  { id: "east", type: "tabletop", position: [3150, 0], width_mm: 1700, depth_mm: 1000, level_mm: 80 },
];

function world(objects) {
  return createWorld({ objects, simulations: [], clock: { start: "10:00", profiles: false } }, { seed: 6 });
}

const crossing = (extra, objects = [TRACK, MAIN]) => {
  const w = world([...objects, { id: "x", type: "rail-crossing", name: "X", position: [2000, 0], ...extra }]);
  return { w, x: w.getObject("x") };
};
const round = (v, k = 10) => Math.round(v * k) / k;

test("railway crossings: a class for each kind, changed with the kind", () => {
  assert.deepEqual(Object.keys(CROSSING_TYPES), ["over", "under", "crossbuck", "lights", "half-barriers", "full-barriers"]);
  const classes = { over: OverTrack, under: UnderTrack, crossbuck: CrossbuckOnly, lights: FlashingLights, "half-barriers": HalfBarriers, "full-barriers": FullBarriers };
  for (const [kind, C] of Object.entries(classes)) {
    assert.equal(CROSSING_TYPES[kind], C);
    assert.ok(C.prototype instanceof CrossingType);
    assert.equal(C.prototype instanceof AtGrade, !["over", "under"].includes(kind), kind);
  }
  const { w, x } = crossing({ kind: "over" });
  assert.ok(x.crossingType instanceof OverTrack);
  assert.equal(x.crossingType.level, false);
  const info = x.railCrossingInfo();
  assert.deepEqual([info.road, info.track, info.level, info.kind], ["main", "track", false, "over"]);
  // the kind can be changed at any time: the type follows
  x.set({ kind: "half-barriers" });
  assert.ok(x.crossingType instanceof HalfBarriers);
  assert.equal(x.crossingType.level, true);
  assert.equal(x.railCrossingInfo().level, true);
  // the road network knows where the street crosses the track, and at which crossing
  const rails = w.network().edges.flatMap((e) => (e.road === "main" ? e.rails || [] : []));
  assert.equal(rails.length, 1);
  assert.equal(rails[0].crossing?.id, "x");
  const card = Object.fromEntries(w.card({ kind: "object", ref: x, owner: x, label: x.name }).rows);
  assert.equal(card.Kind, "Light signals and half barriers");
  assert.equal(card.Protection, "Light signals and half barriers");
});

test("bridges and underpasses: the clearance, and ramps by the gradients where the modules do not make up the height", () => {
  // over an electrified railway: the street 5.70 m clear above the rails and a 1.0 m deck; ramps at 8 %
  const over = crossing({ kind: "over" }).x.constraints();
  assert.equal(round(over.clearance), CROSSING_NORMS.railClearance);
  assert.equal(round(over.low - over.rails, 1), Math.round((6.7 * 1000) / 87));
  assert.equal(Math.round(over.ramps.before), Math.round(6.7 / 0.08));
  assert.equal(Math.round(over.ramps.after), Math.round(6.7 / 0.08));
  assert.equal(over.gradient, 0.08);
  // under the railway: 4.70 m for the street and a 1.5 m railway deck
  const under = crossing({ kind: "under" }).x.constraints();
  assert.equal(round(under.clearance), CROSSING_NORMS.roadClearance);
  assert.equal(Math.round(under.ramps.before), Math.round(6.2 / 0.08));
  // with trams in the street: 6 %
  const tram = crossing({ kind: "over" }, [TRACK, { ...MAIN, tram: "street" }]).x.constraints();
  assert.equal(Math.round(tram.ramps.after), Math.round(6.7 / 0.06));
  // the street between two table modules raised 80 mm: straight over the track, no ramps
  const raised = crossing({ kind: "over" }, [TRACK, MAIN, ...MODULES]).x;
  const c = raised.constraints();
  assert.deepEqual([c.rails, c.low, c.high, c.ramps.before, c.ramps.after], [0, 80, 80, 0, 0]);
  assert.equal(round(c.clearance), round((80 * 87) / 1000 - 1));
  assert.deepEqual(raised.problems(), []);
  const rows = Object.fromEntries(raised.card().rows);
  assert.equal(rows.Ramps, "none: the table modules make up the height");
  assert.equal(rows.Clearance, "6.0 m (at least 5.7 m)");
  // the room for the ramps: the street on both sides up to its ends
  assert.ok(over.room.before > 170 && over.room.after > 170, JSON.stringify(over.room));
});

test("ramps that do not fit, and level crossings that make no sense", () => {
  // a short street: 84 m of ramp do not fit before its ends
  const short = crossing({ kind: "over" }, [TRACK, { ...MAIN, points: [[1500, 0], [2500, 0]] }]).x;
  assert.deepEqual(short.problems(), ["X: the street needs 84 m of ramp (8 %), but there are only 44 m to the next junction or end. Change the levels of the table modules, or choose another kind"]);
  // a level crossing on a street between raised modules: down to the rails and up again, 87 m each side
  const level = crossing({ kind: "half-barriers" }, [TRACK, MAIN, ...MODULES]).x.constraints();
  assert.deepEqual([level.low, level.high], [0, 0]);
  assert.equal(level.clearance, null);
  assert.ok(level.ramps.before > 80 && level.ramps.after > 80, JSON.stringify(level.ramps));
  // a St Andrew's cross alone is no crossing for a main road (EBO § 11)
  const main = crossing({ kind: "crossbuck" }, [TRACK, { ...MAIN, kind: "main" }]).x;
  assert.deepEqual(main.problems(), ["X: a main road needs a level crossing with lights or barriers (EBO § 11: St Andrew's crosses only for little traffic)"]);
  assert.deepEqual(crossing({ kind: "crossbuck" }).x.problems(), []);
  // not where a street crosses a track
  const away = world([TRACK, MAIN, { id: "x", type: "rail-crossing", position: [800, 900] }]).getObject("x");
  assert.deepEqual(away.problems(), ["Not where a street crosses a track: move it onto the crossing."]);
});

test("level crossings close while trains pass; without trains trains_per_hour times for closed_min", () => {
  const { w, x } = crossing({ kind: "half-barriers", trains_per_hour: 4, closed_min: 1.5 });
  let closed = 0, n = 0;
  for (let m = 0; m < 60; m += 0.1) {
    w.clock.set(600 + m);
    n++;
    if (x.closed(m)) closed++;
  }
  assert.ok(Math.abs(closed / n - (4 * 1.5) / 60) < 0.02, `closed ${closed} of ${n}`);
  // a bridge never closes; a St Andrew's cross has nothing to close
  assert.equal(crossing({ kind: "over" }).x.closed(0), false);
  const cross = crossing({ kind: "crossbuck" });
  for (let m = 0; m < 60; m += 0.5) {
    cross.w.clock.set(600 + m);
    assert.equal(cross.x.closed(m), false);
  }
});

test("trams never cross a railway at street level; the street access check offers a bridge", () => {
  // a level crossing on a street with tram tracks is an error (BOStrab § 15); the fix makes it a bridge
  const { w, x } = crossing({ kind: "half-barriers" }, [TRACK, { ...MAIN, tram: "street" }]);
  assert.deepEqual(x.problems(), ["X: trams cannot cross the railway at street level (BOStrab § 15). Make it a bridge or an underpass"]);
  const rail = accessProblems(w).filter((p) => p.key.startsWith("rail:"));
  assert.equal(rail.length, 1);
  assert.equal(rail[0].level, "error");
  assert.equal(rail[0].text, "Main: trams cannot cross Track track at street level (BOStrab § 15): a bridge or an underpass is needed");
  assert.deepEqual(rail[0].fix, { kind: "crossing-kind", id: "x", crossingKind: "over", text: "Make it a bridge over the track" });
  applyFix(w, rail[0].fix);
  assert.equal(x.spec.kind, "over");
  assert.ok(x.crossingType instanceof OverTrack);
  assert.deepEqual(accessProblems(w).filter((p) => p.key.startsWith("rail:")), []);
  // without a crossing: trams cannot pass there; the fix builds a bridge
  const w2 = world([TRACK, { ...MAIN, tram: "street" }]);
  const [p2] = accessProblems(w2).filter((p) => p.key.startsWith("rail:"));
  assert.equal(p2.level, "error");
  assert.equal(p2.fix.text, "Build a bridge over the track");
  applyFix(w2, p2.fix);
  const added = w2.objects.find((o) => o.type === "rail-crossing");
  assert.equal(added.spec.kind, "over");
  assert.deepEqual([added.spec.road, added.spec.track], ["main", "track"]);
  assert.deepEqual(accessProblems(w2).filter((p) => p.key.startsWith("rail:")), []);
  // a street without trams that crosses a track without a crossing: a warning, the fix a level crossing
  const w3 = world([TRACK, MAIN]);
  const [p3] = accessProblems(w3).filter((p) => p.key.startsWith("rail:"));
  assert.equal(p3.level, "warning");
  assert.equal(p3.text, "Main crosses Track track at street level without a railway crossing");
  assert.equal(p3.fix.crossingKind, "half-barriers");
  applyFix(w3, p3.fix);
  assert.equal(w3.objects.find((o) => o.type === "rail-crossing").spec.kind, "half-barriers");
  assert.deepEqual(accessProblems(w3).filter((p) => p.key.startsWith("rail:")), []);
  // a footpath over the track makes no problem
  assert.deepEqual(accessProblems(world([TRACK, { ...MAIN, kind: "path" }])).filter((p) => p.key.startsWith("rail:")), []);
});
