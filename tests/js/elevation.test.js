// Heights (core/elevation.js): table modules at their levels, streets that ramp from one level to
// another and run as bridges between raised modules, how streets cross tracks by their heights,
// what is wrong with a street's heights, the view lifting what is drawn (the railway on the ground,
// the rest on the streets), pointing at raised things, and building only on table modules.
import assert from "node:assert/strict";
import test from "node:test";

import { Camera, FlyCamera, View, accessProblems, createWorld, offModules, surfacePoint, toRad } from "../../web/arail/index.js";

function world(objects, simulations = []) {
  return createWorld({ objects, simulations, clock: { start: "10:00", profiles: false } }, { seed: 4 });
}

/** The real table at the track level, from x = 0 to 6000, and table modules beside it. */
const TABLE = { id: "table", type: "tabletop", kind: "physical", position: [3000, 0], width_mm: 6000, depth_mm: 2000 };
const module = (id, x0, x1, level, extra = {}) => ({ id, type: "tabletop", position: [(x0 + x1) / 2, 0], width_mm: x1 - x0, depth_mm: 2000, level_mm: level, ...extra });

test("table modules lie at their levels; the highest counts where they overlap", () => {
  const w = world([TABLE, module("plateau", 1000, 2000, 80), module("hill", 1500, 1800, 120)]);
  const el = w.elevation.sync();
  assert.equal(el.flat, false);
  assert.deepEqual([500, 1200, 1600, 1900, 7000].map((x) => el.ground(x, 0)), [0, 80, 120, 80, 0]);
  assert.equal(el.moduleAt(1600, 0).obj.id, "hill");
  assert.equal(w.getObject("plateau").groundLevel(), 80);
  assert.equal(Object.fromEntries(w.getObject("plateau").card().rows).Level, "80 mm above the track level");
  assert.equal(Object.fromEntries(w.getObject("table").card().rows).Level, "the track level");
  // all at the track level: nothing to lift
  const flat = world([TABLE]).elevation.sync();
  assert.equal(flat.flat, true);
  assert.equal(flat.streetLift, null);
});

test("streets ramp from one level to another, and run straight as bridges between raised modules", () => {
  const profile = (w, id) => w.elevation.profile(id);
  const at = (w, id, x) => w.elevation.heightOn(id, x);
  // up onto a module 80 mm high: a ramp of 1000 mm (8 %) on the lower side, ending at its edge
  const w1 = world([TABLE, module("up", 3000, 6000, 80), { id: "r", type: "road", points: [[0, 0], [6000, 0]] }]);
  assert.deepEqual([0, 1900, 2000, 2500, 3000, 4000].map((x) => Math.round(at(w1, "r", x))), [0, 0, 0, 40, 80, 80]);
  assert.equal(profile(w1, "r").gradient, 0.08);
  assert.deepEqual(w1.getObject("r").problems(), []);
  // with tram tracks: 6 %, the ramp is longer
  const w2 = world([TABLE, module("up", 3000, 6000, 80), { id: "r", type: "road", tram: "street", points: [[0, 0], [6000, 0]] }]);
  assert.equal(Math.round(at(w2, "r", 3000 - 80 / 0.06)), 0);
  assert.equal(Math.round(at(w2, "r", 2500)), Math.round(80 - 500 * 0.06));
  // between two modules 80 mm high: straight over the lower part, as a bridge
  const bridge = world([TABLE, module("a", 0, 2500, 80), module("b", 3000, 6000, 80), { id: "r", type: "road", points: [[0, 0], [6000, 0]] }]);
  assert.deepEqual([1000, 2600, 2750, 2900, 5000].map((x) => Math.round(at(bridge, "r", x))), [80, 80, 80, 80, 80]);
  const decks = profile(bridge, "r").decks;
  assert.equal(decks.length, 1);
  assert.ok(Math.abs(decks[0].s0 - 2500) < 6 && Math.abs(decks[0].s1 - 3000) < 6, `${decks[0].s0}..${decks[0].s1}`);
  // where it is lifted the street level is its height; beside it the ground
  assert.equal(Math.round(bridge.elevation.street(2750, 0)), 80);
  assert.equal(bridge.elevation.street(2750, 600), 0);
  // a long way between them: down to the ground and up again (a valley)
  const valley = world([TABLE, module("a", 0, 1000, 80), module("b", 5000, 6000, 80), { id: "r", type: "road", points: [[0, 0], [6000, 0]] }]);
  assert.deepEqual([1000, 1500, 3000, 4500, 5000].map((x) => Math.round(at(valley, "r", x))), [80, 40, 0, 40, 80]);
});

test("streets cross tracks by their heights: over between raised modules, at street level, or into the track", () => {
  const TRACK = { id: "t", type: "track", track_id: "G1", points: [[2750, -900], [2750, 900]] };
  const road = { id: "r", type: "road", name: "Main", tram: "street", points: [[0, 0], [6000, 0]] };
  // between two modules 80 mm high: 6.96 m above the rails, enough for a bridge (6.7 m): trams pass
  const over = world([TABLE, TRACK, road, module("a", 0, 2500, 80), module("b", 3000, 6000, 80)]);
  const [c] = over.elevation.trackCrossings("r");
  assert.deepEqual([c.track, c.kind, Math.round(c.clear)], ["t", "over", 80]);
  const rails = over.network().edges.flatMap((e) => (e.road === "r" ? e.rails : []));
  assert.ok(rails.length && rails.every((r) => !r.level), "not at street level");
  assert.ok(over.network().edges.some((e) => e.road === "r" && e.tram), "trams pass over the track");
  assert.deepEqual(accessProblems(over).filter((p) => p.key.startsWith("rail:")), []);
  // modules only 40 mm high: the street meets the track 3.5 m above the rails
  const low = world([TABLE, TRACK, road, module("a", 0, 2500, 40), module("b", 3000, 6000, 40)]);
  assert.equal(low.elevation.trackCrossings("r")[0].kind, "clash");
  const [p] = accessProblems(low).filter((x) => x.key.startsWith("rail:"));
  assert.equal(p.level, "error");
  assert.equal(p.text, "Main meets Track t 3.5 m above the rails: not at their height, and too low for a bridge (6.7 m)");
  // all at the track level: a level crossing (no tram over it)
  const level = world([TABLE, TRACK, road]);
  assert.equal(level.elevation.trackCrossings("r")[0].kind, "level");
  assert.ok(level.network().edges.flatMap((e) => (e.road === "r" ? e.rails : [])).every((r) => r.level));
});

test("what is wrong with a street's heights: a ramp in a junction, an end in the air", () => {
  // a side street joins the main street on its ramp
  const w = world([
    TABLE, module("up", 3000, 6000, 80),
    { id: "main", type: "road", name: "Main", points: [[0, 0], [6000, 0]] },
    { id: "side", type: "road", name: "Side", points: [[2500, 0], [2500, -800]] },
  ]);
  assert.deepEqual(w.getObject("side").problems(), ["At the junction with Main: 40 mm lower than it. Streets meet at the same height: keep ramps away from junctions"]);
  assert.deepEqual(w.getObject("main").problems(), ["At the junction with Side: 40 mm higher than it. Streets meet at the same height: keep ramps away from junctions"]);
  // a street that ends in the air beyond the edge of a raised module
  const w2 = world([TABLE, module("up", 0, 3000, 80), { id: "r", type: "road", points: [[1000, 0], [3200, 0]] }]);
  assert.deepEqual(w2.getObject("r").problems(), ["Ends 64 mm above the ground: let it end on a table module at its height"]);
});

/** A view of the layout from the side and above (the camera in front of it, looking along +y). */
function sideView(target = [2750, 0]) {
  const camera = new Camera(1280, 720);
  const cam = new FlyCamera({ target, distance: 2500, yaw: Math.PI / 2, pitch: toRad(30) });
  const { H, focal, pose } = cam.homography(1280, 720);
  camera.setManualFocal(focal);
  return { view: new View({ ctx: null, camera, H, pose, scale: 87, virtual: true }), cam };
}

test("drawing at heights: things on modules and streets on bridges are lifted, the railway keeps to the ground", () => {
  const w = world([
    TABLE, module("a", 0, 2500, 80), module("b", 3000, 6000, 80),
    { id: "t", type: "track", track_id: "G1", points: [[2750, -900], [2750, 900]] },
    { id: "r", type: "road", points: [[0, 0], [6000, 0]] },
    { id: "h", type: "house", position: [1500, 400] },
  ]);
  const { view } = sideView();
  // what each object is lifted by while it draws: at the bridge, the street 80 mm, the track 0
  const lifted = {};
  for (const o of w.objects) {
    const draw = o.draw.bind(o);
    o.draw = (v) => {
      lifted[o.id] = v.lift ? Math.round(v.lift(2750, 0)) : null;
      return draw(v);
    };
  }
  const ctx = new Proxy({ canvas: { width: 1280, height: 720 } }, { get: (o, k) => (k in o ? o[k] : k === "measureText" ? () => ({ width: 10 }) : () => ({ addColorStop() {} })), set: (o, k, v) => ((o[k] = v), true) });
  view.ctx = ctx;
  w.draw(view);
  assert.deepEqual([lifted.r, lifted.h, lifted.t, lifted.a], [80, 80, 0, null]);
  // a point of a house on a module is drawn higher than the same point on the layout plane
  const { view: v2 } = sideView();
  const flatY = v2.project(1500, 400, 0)[1];
  v2.lift = w.elevation.streetLift;
  assert.ok(v2.project(1500, 400, 0)[1] < flatY - 5, "higher in the picture");
  // pointing at it: the pixel of a point on the raised module is that point again
  const px = v2.project(1500, 400, 0);
  const back = surfacePoint(w, v2, px);
  assert.ok(Math.hypot(back[0] - 1500, back[1] - 400) < 1, back.join(","));
});

test("houses, streets and the rest are built on table modules", () => {
  const w = world([
    TABLE,
    { id: "on", type: "house", position: [1500, 0] },
    { id: "off", type: "house", position: [1500, 2000] },
    { id: "edge", type: "tree", position: [10, 990] },
    { id: "street", type: "road", points: [[100, 0], [7000, 0]] },
    { id: "sign", type: "label", text: "Neustadt", style: "floating", position: [1500, 3000] },
    { id: "board", type: "label", text: "Neustadt", position: [1500, 3000] },
  ]);
  const text = "Not on a table module: move it onto one, or add a table module under it.";
  assert.equal(offModules(w, w.getObject("on")), null);
  assert.equal(offModules(w, w.getObject("off")), text);
  assert.equal(offModules(w, w.getObject("edge")), null, "a tree stands on its trunk");
  assert.equal(offModules(w, w.getObject("street")), text, "its end is beside the table");
  assert.equal(offModules(w, w.getObject("sign")), null, "floating text may be anywhere");
  assert.equal(offModules(w, w.getObject("board")), text, "a board stands on posts");
  assert.deepEqual(w.problemsOf(w.getObject("off")), [text]);
  assert.equal(offModules(w, w.getObject("table")), null);
  // without table modules the layout is the real table, wherever it is
  const free = world([{ id: "off", type: "house", position: [1500, 2000] }]);
  assert.deepEqual(free.problemsOf(free.getObject("off")), []);
});
