// The hump yard on the table (web/arail/hump/object.js, issue #237): Bf Neustadt's module Hump yard (its table
// module, the push track meeting the table), the plan of the yard (a fan), train after train in the world
// (deterministic, a change of figures makes it anew, moving it keeps it), drawing in the flyover (ballast,
// wagons, retarders braking, only finite coordinates), its figures changed while paused, a run of hours (what is done
// forgotten, the card and the flashes as they were), its card and its German texts; the task of the app's
// example "Hump a train" (one train of its own, pushed at the speed chosen, its cuts chosen on the stage).
import assert from "node:assert/strict";
import test from "node:test";

import { CD, Camera, FlyCamera, HumpYardObject, OVERLAY, TASK_PUSH, View, createWorld, pickBoxes, registry, standardYard, toRad, validateLayout } from "../../web/arail/index.js";
import { withLayers } from "../../web/arail/core/layers.js";
import { DE } from "../../web/arail/i18n/de.js";
import { readJSON } from "./helpers.js";

const W = 1280, H = 720;
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not ${b} ± ${tol}`);
const hex = (c) => {
  const m = String(c).match(/rgba?\(([^)]+)\)/);
  return m ? m[1].split(",").slice(0, 3).map(Number) : [1, 3, 5].map((i) => parseInt(String(c).slice(i, i + 2), 16));
};
const same = (a, b) => hex(a).every((x, i) => Math.abs(x - hex(b)[i]) < 1.5);

/** A canvas context that records fills and strokes and insists on finite coordinates. */
function fakeContext() {
  const fills = [], strokes = [];
  let path = [];
  const noop = () => {};
  const point = (x, y) => {
    assert.ok(Number.isFinite(x) && Number.isFinite(y), "finite coordinates");
    path.push([x, y]);
  };
  const ctx = {
    canvas: { width: W, height: H }, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, globalAlpha: 1, globalCompositeOperation: "source-over",
    save: noop, restore: noop, setTransform: noop, transform: noop, fillRect: noop, closePath: noop, setLineDash: noop, clip: noop, drawImage: noop,
    arc: noop, ellipse: noop, quadraticCurveTo: noop, arcTo: noop, fillText: noop, strokeText: noop, rect: noop,
    beginPath() {
      path = [];
    },
    moveTo: point,
    lineTo: point,
    fill() {
      fills.push({ color: this.fillStyle, path: path.slice() });
    },
    stroke() {
      strokes.push({ color: this.strokeStyle, path: path.slice() });
    },
    measureText: (t) => ({ width: t.length * 6 }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
  };
  return { ctx, fills, strokes };
}

/** A view of the flyover camera, as the app builds it. */
function flyView(cam, { night = 0 } = {}) {
  const camera = new Camera(W, H);
  const { H: hom, focal, pose } = cam.homography(W, H);
  camera.setManualFocal(focal);
  const { ctx, fills, strokes } = fakeContext();
  return { view: new View({ ctx, camera, H: hom, pose, scale: 87, night, virtual: true }), fills, strokes };
}

/** A layout with one hump yard at the origin, its cuts rolling towards −x. */
const lone = (extra = {}) => createWorld({ scale: 87, objects: [{ id: "hump", type: "hump-yard", position: [0, 0], rotation_deg: 180, ...extra }] }, { seed: 3 });
const run = (world, seconds, dt = 0.1) => {
  for (let t = 0; t < seconds; t += dt) world.step(dt);
};

test("Bf Neustadt's module Hump yard: on its table module, the push track meeting the table at its west end", () => {
  const json = readJSON("web/layouts/ebl-neustadt.json");
  assert.deepEqual(validateLayout(json, registry), [], "valid with every module on");
  const layer = json.layers.find((l) => l.id === "hump");
  assert.ok(layer && layer.enabled === false, "a module, off by default");
  const world = createWorld(withLayers(json, ["hump"]), { seed: 7 });
  const hump = world.getObject("hump-yard"), table = world.getObject("table-hump"), lab = world.getObject("table-lab");
  assert.ok(hump instanceof HumpYardObject);
  assert.deepEqual(world.problemsOf(hump), [], "it stands on its table module");
  // the yard lies on its module
  const [a, , c] = hump.footprint(), t = table.footprint();
  const xs = t.map((p) => p[0]), ys = t.map((p) => p[1]);
  assert.ok(a[0] >= Math.min(...xs) && c[0] <= Math.max(...xs) && a[1] >= Math.min(...ys) && c[1] <= Math.max(...ys), "within its module");
  // the push track starts at the real table's west edge, at its level: the module lies 45 mm lower
  const yard = hump.yard, g = hump.geometry, start = yard.planAt([yard.root], 0);
  const [x0] = g.at(start.x, start.y), labWest = Math.min(...lab.footprint().map((p) => p[0]));
  near(x0, labWest, 40, "the push track begins at the table's edge");
  near(table.spec.level_mm + g.z(yard.height([yard.root], 0)), 0, 6, "and at its level");
  assert.ok(g.z(yard.height([yard.root], yard.crest_m)) > g.z(yard.height([yard.root], 0)), "the crest above it");
  // off by default: Bf Neustadt without the module has no hump
  assert.equal(createWorld(json, { seed: 7 }).getObject("hump-yard"), null);
});

test("the plan of the yard: a fan of tracks spacing_m apart, in the order of the tree, without crossings", () => {
  const yard = standardYard({ tracks: 6, track_m: 120 });
  const routes = yard.tracks.map((t) => yard.routeTo(t.name));
  const ends = routes.map((r, i) => yard.planAt(r, yard.tracks[i].s1 - 1).y);
  for (let i = 1; i < ends.length; i++) near(ends[i - 1] - ends[i], yard.spacing_m, 1e-9, `tracks ${i} and ${i + 1}`);
  near(yard.planAt([yard.root], yard.crest_m).y, 0, 1e-12, "the hump on its axis");
  // along the way, the tracks keep their order (never crossing) and run straight once they are parallel
  for (let s = yard.crest_m; s < Math.min(...yard.tracks.map((t) => t.s1)); s += 2) {
    const ys = routes.map((r) => yard.planAt(r, s).y);
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i - 1] >= ys[i] - 1e-9, `order at ${s}`);
  }
  const t1 = yard.tracks[0], p = yard.planAt(routes[0], t1.s0 + 50);
  near(p.heading, 0, 1e-12, "straight in the track");
  assert.equal(yard.planAt(routes[0], 10).y, 0, "on the axis before the first switch");
  // continuous where a segment ends and the next one begins
  for (const r of routes) {
    for (let i = 1; i < r.length; i++) {
      const s = yard.segment(r[i]).s0;
      near(yard.planAt(r, s - 1e-6).y, yard.planAt(r, s + 1e-6).y, 1e-3, `at the start of ${r[i]}`);
    }
  }
});

test("it humps train after train in the world: deterministic, made anew when its figures change, kept when moved", () => {
  const a = lone(), b = lone(), hump = a.getObject("hump");
  run(a, 900);
  run(b, 900);
  const ra = hump.sim.results(), rb = b.getObject("hump").sim.results();
  assert.ok(ra.trains >= 2 && ra.cuts > 20, `${ra.trains} trains, ${ra.cuts} cuts`);
  assert.ok(hump.sim.departures.length >= 1, "full tracks leave as trains");
  assert.equal(ra.derailed, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(ra)), JSON.parse(JSON.stringify(rb)), "the same seed, the same run");
  near(hump.sim.t, a.time, 0.2, "the simulation keeps up with the world's time");
  // another world's seed: another run
  const other = createWorld({ scale: 87, objects: [{ id: "hump", type: "hump-yard", position: [0, 0], rotation_deg: 180 }] }, { seed: 4 });
  run(other, 300);
  assert.notDeepEqual(other.getObject("hump").sim.cuts.map((c) => c.body.w), hump.sim.cuts.slice(0, other.getObject("hump").sim.cuts.length).map((c) => c.body.w));
  // moving it keeps its simulation; another number of tracks makes it anew
  const sim = hump.sim;
  hump.translate(100, 50);
  assert.equal(hump.sim, sim, "moved: the same run");
  hump.set({ tracks: 4 });
  assert.notEqual(hump.sim, sim, "other figures: a new run");
  assert.equal(hump.yard.tracks.length, 4);
  // its card
  run(a, 30);
  const rows = Object.fromEntries(hump.card().rows);
  assert.equal(rows["Classification tracks"], "4 × 120 m");
  assert.ok("Trains humped" in rows && "Cuts per hour" in rows && "Trains pulled out" in rows);
});

test("drawn in the flyover: formation, ballast and rails, wagons, retarders orange while they brake", () => {
  const world = lone();
  const hump = world.getObject("hump");
  const cam = new FlyCamera({ target: [-1800, 0], distance: 2600, yaw: toRad(100), pitch: toRad(35) });
  // before the first step: the yard without wagons
  const empty = flyView(cam);
  world.draw(empty.view);
  assert.ok(empty.fills.length > 50, `${empty.fills.length} fills`);
  // run until a cut is braked in a retarder, then draw: wagons in their red, a retarder in orange
  let braking = false;
  for (let i = 0; i < 6000 && !braking; i++) {
    world.step(0.1);
    braking = hump.yard.retarders.some((r) => r.hold_mps == null && hump.sim.retarderState(r.id).level > 0.05);
  }
  assert.ok(braking, "a retarder braked");
  const { view, fills, strokes } = flyView(cam);
  world.draw(view);
  assert.ok(fills.length > empty.fills.length, `wagons drawn: ${fills.length} fills against ${empty.fills.length}`);
  assert.ok(strokes.some((s) => same(s.color, CD.orange)), "a retarder in orange");
  // at night as well, without anything that is not finite (the context checks every point)
  const dark = flyView(cam, { night: 1 });
  world.draw(dark.view);
  assert.ok(dark.fills.length > 50);
});

test("its figures changed while the world is paused: drawn at once with the new yard and a new run, its card too", () => {
  const world = lone(), hump = world.getObject("hump");
  run(world, 300);
  assert.ok(hump.sim.bodies.some((c) => c.route.length > 2), "cuts on their way through the switches");
  world.paused = true;
  hump.set({ tracks: 4 });
  const cam = new FlyCamera({ target: [-1800, 0], distance: 2600, yaw: toRad(100), pitch: toRad(35) });
  world.draw(flyView(cam).view); // no step in between: draw and drawMoving must not use the old run on the new yard
  assert.equal(hump.sim.yard, hump.yard, "the run of the new yard");
  assert.equal(hump.sim.cuts.length, 0, "not started yet");
  const rows = Object.fromEntries(hump.card().rows);
  assert.equal(rows["Classification tracks"], "4 × 120 m");
  assert.equal(rows["Trains humped"], "0");
  // and on, once the world runs again
  world.paused = false;
  run(world, 120);
  world.draw(flyView(cam).view);
  assert.ok(hump.sim.cuts.length > 0);
});

test("for hours: what is done is forgotten, the card's figures and the flashes stay as they were; the cuts flashing are those counted", () => {
  // target braking and pushed fast: impacts too hard, and cuts catching up before their tracks (no impact too hard)
  const fast = { design: "target", push_mps: 2.5 };
  const whole = lone(fast), lean = lone(fast), a = whole.getObject("hump"), b = lean.getObject("hump");
  a.keep = { cuts: Infinity, trains: Infinity, departures: Infinity, log: Infinity };
  b.keep = { cuts: 5, trains: 1, departures: 1, log: 30 };
  const flashed = new Set();
  for (let t = 0; t < 900; t += 0.1) {
    whole.step(0.1);
    lean.step(0.1);
    assert.deepEqual(b._flashes, a._flashes, `the same flashes at ${t.toFixed(1)} s`);
    for (const f of a._flashes) flashed.add(f.cut);
  }
  assert.equal(a.sim.logStart, 0, "the one kept everything");
  assert.ok(b.sim.logStart > 0 && b.sim.cuts.length < a.sim.cuts.length && b.sim.departures.length <= 2, "the other forgot");
  // the cuts that flashed red are those the card counts as too hard
  const hard = a.sim.results();
  assert.ok(hard.hard > 0, "impacts too hard");
  assert.ok(a.sim.log.some((e) => e.type === "cut.caught-up" && e.v_mps > a.sim.options.impact_mps), "a cut caught up hard before its track");
  assert.deepEqual([...flashed].toSorted(), hard.perCut.filter((c) => c.impact_mps > a.sim.options.impact_mps + 1e-9).map((c) => c.id).toSorted());
  assert.equal(flashed.size, hard.hard);
  const rows = Object.fromEntries(a.card().rows);
  assert.ok(Number(rows["Trains pulled out"]) >= 2, `${rows["Trains pulled out"]} trains pulled out`);
  assert.deepEqual(b.card().rows, a.card().rows, "the same card");
});

test("a task: one train of its own into empty tracks, pushed at the speed chosen; what became of every cut; a cut chosen on the stage", () => {
  const world = lone(), hump = world.getObject("hump");
  run(world, 200); // train after train by itself first
  assert.ok(hump.sim.cuts.length > 5);
  const task = hump.startTask({ wagons: 20, seed: 2 });
  assert.equal(task.finished_s, null);
  assert.equal(task.push_mps, TASK_PUSH.start_mps);
  let st = hump.taskState();
  assert.ok(st.of >= 6 && st.done === 0 && !st.finished, `${st.of} cuts, none standing`);
  assert.deepEqual(hump.sim.bodies, [], "the tracks empty");
  assert.equal(st.cuts.reduce((n, c) => n + c.wagons.length, 0), 20, "the train's 20 wagons");
  assert.ok(st.cuts.every((c) => c.state === "waiting" && hump.yard.tracks.some((t) => t.name === c.track)));
  // the same world's seed and task: the same train
  const again = lone().getObject("hump");
  again.startTask({ wagons: 20, seed: 2 });
  assert.deepEqual(again.taskState().cuts.map((c) => [c.wagons, c.track]), st.cuts.map((c) => [c.wagons, c.track]));
  // stopped, the train waits before the crest; pushed again, faster, at once
  hump.setPush({ stopped: true });
  run(world, 30);
  assert.equal(hump.sim.pushing.v, 0);
  st = hump.taskState();
  assert.ok(st.stopped && st.cuts.every((c) => c.state === "pushed"), "nothing released while stopped");
  hump.setPush({ stopped: false, push_mps: 1.6 });
  assert.equal(hump.sim.pushing.v, 1.6);
  hump.setPush({ push_mps: 99 });
  assert.equal(hump.taskState().push_mps, TASK_PUSH.max_mps, "within its range");
  hump.setPush({ push_mps: 1.4 });
  run(world, 60);
  st = hump.taskState();
  assert.ok(st.cuts.some((c) => c.state === "rolling" || c.state === "standing"), "cuts released");
  // a cut picked on the stage: the boxes of its wagons; chosen, it is outlined
  const cam = new FlyCamera({ target: [-1800, 0], distance: 2600, yaw: toRad(100), pitch: toRad(35) });
  const { view } = flyView(cam);
  world.draw(view);
  const boxes = hump.boxes();
  assert.ok(boxes.length > 0 && boxes.every((b) => st.cuts.some((c) => c.id === b.id)), "the wagons of the task's cuts");
  const b = boxes.find((x) => view.project(x.center[0], x.center[1], x.z0 + x.height / 2));
  const [u, v] = view.project(b.center[0], b.center[1], b.z0 + b.height / 2);
  assert.equal(pickBoxes(view, boxes, u, v) != null, true, "a wagon picked where it is drawn");
  hump.choose(b.id);
  const chosen = flyView(cam);
  world.draw(chosen.view);
  assert.ok(chosen.strokes.some((s) => same(s.color, OVERLAY.selection)), "the cut chosen outlined");
  // to its end: every cut stands, the task finished; the count of cuts that stood never goes back
  let last = st.done;
  for (let i = 0; i < 9000 && !hump.taskState().finished; i++) {
    world.step(0.1);
    const now = hump.taskState();
    assert.ok(now.done >= last, `the count goes on: ${now.done} after ${last}`);
    last = now.done;
  }
  st = hump.taskState();
  // the time stops when the train is broken up
  const finishedAt = st.time_s;
  assert.ok(finishedAt > 0 && finishedAt < hump.sim.t - hump.task.since + 1e-9);
  run(world, 120);
  assert.equal(hump.taskState().time_s, finishedAt, "the time stays as it was when the last cut stood");
  assert.ok(st.finished, `${st.done} of ${st.of} standing`);
  assert.equal(hump.sim.trains.length, 1, "no train of its own");
  assert.ok(st.cuts.every((c) => c.state === "standing" && (c.stood === null || hump.yard.tracks.some((t) => t.name === c.stood))));
  assert.equal(st.misrouted, st.cuts.filter((c) => c.now !== c.track).length);
  assert.equal(st.short + st.derailed + st.cuts.filter((c) => c.stood).length, st.of, "every cut in a track, derailed or short of it");
  // stopped: train after train again, in empty tracks
  hump.stopTask();
  const t0 = world.time;
  run(world, 10);
  assert.equal(hump.taskState(), null);
  assert.equal(hump.sim.trains.length, 1);
  near(hump.sim.t, world.time - t0, 0.2, "a new run of its own");
});

test("a task pushed too fast: the yard backs up to the crest, the task still ends; derailed cuts counted as derailed, not as short of their tracks", () => {
  const world = lone({ design: "target" }), hump = world.getObject("hump");
  hump.startTask({ wagons: 30, seed: 3, push_mps: TASK_PUSH.max_mps });
  for (let i = 0; i < 20000 && !hump.taskState().finished; i++) world.step(0.1);
  const st = hump.taskState();
  assert.ok(st.finished);
  assert.equal(st.derailed, st.cuts.filter((c) => c.derailed).length);
  assert.ok(st.cuts.filter((c) => c.derailed).every((c) => c.state === "standing"), "a derailed cut stands");
  assert.equal(st.short, st.cuts.filter((c) => c.state === "standing" && !c.stood && !c.derailed).length);
  // the yard backed up to the crest: no held cut keeps a speed (it would roll for ever), the task ends
  assert.ok(hump.sim.bodies.every((b) => !b.held || b.v === 0), "held cuts stand");
  assert.equal(st.notHumped, st.cuts.filter((c) => c.state === "waiting" || c.state === "pushed").length);
  const at = st.time_s;
  run(world, 60);
  assert.equal(hump.taskState().time_s, at);
});

test("the hump yard's texts in German", () => {
  for (const key of [HumpYardObject.label, HumpYardObject.category, HumpYardObject.description, ...HumpYardObject.params.map((p) => p.label), "Speed-holding units", "Target braking", "Summer", "Trains humped"]) {
    assert.ok(DE[key], `no German for "${key}"`);
  }
  assert.equal(DE["Hump yard"], "Ablaufberg");
});

test("a run made elsewhere is shown instead of its own: drawn, not stepped; its own run again when it is let go of", async () => {
  const { HumpSimulation } = await import("../../web/arail/hump/index.js");
  const world = lone(), o = world.objects[0];
  run(world, 30);
  const own = o.sim, ownT = own.t;
  assert.ok(ownT > 20 && o.external === null);
  // a simulation on a yard of the object's figures, with a train on the hump and one wagon in a track
  const sim = new HumpSimulation(standardYard({ tracks: 6, track_m: 120, design: "speed", push_m: 100 }), { seed: 9, dt: 0.1 });
  sim.hump({ id: "G", push_mps: 1.2, wagons: [{ type: "eanos", loaded: 1, track: "2" }, { type: "hbbillns", loaded: 0, track: "5" }, { type: "eanos", loaded: 1, track: "2" }] });
  sim.run({ until_s: 40 });
  o.show(sim);
  assert.deepEqual([o.sim === sim, o.external === sim], [true, true]);
  // the world goes on: the run shown is not stepped by the object
  const at = sim.t;
  run(world, 20);
  assert.equal(sim.t, at);
  // its wagons are the ones drawn and picked: as many boxes as wagons on the hump and in the tracks
  const count = () => sim.bodies.reduce((n, b) => n + b.wagons.length, 0) + (sim.pushing?.cuts.reduce((n, c) => n + c.wagons.filter((w, i, all) => c.s - all.slice(0, i + 1).reduce((m, x) => m + x.length_m, 0) >= 0).length, 0) ?? 0);
  assert.equal(o.boxes().length, count());
  sim.run();
  assert.equal(o.boxes().length, 3);
  assert.equal(o.card().rows.find((r) => r[0] === "Trains humped")[1], "1");
  // an impact too hard in the run shown flashes on the object as its own would
  sim.note("cut.hard", { cut: sim.cuts[0].id, v_mps: 2 });
  run(world, 0.2);
  assert.deepEqual(o._flashes.map((f) => f.cut), [sim.cuts[0].id]);
  // a point of the yard on the layout: the crest is the object's position, a track's end lies beyond it in its direction
  const crest = o.pointAt(null, o.yard.crest_m), end = o.pointAt("3", o.yard.tracks[2].s1);
  near(crest[0], 0, 1e-6, "the crest's x");
  near(crest[1], 0, 1e-6, "the crest's y");
  assert.ok(end[0] < -3000 && crest[2] > end[2], "rotated by 180°: the tracks lie towards −x, below the crest");
  // a run of another yard is refused; let go of, the object runs its own again, from its start
  assert.throws(() => o.show(new HumpSimulation(standardYard({ tracks: 4, track_m: 120 }), { seed: 1 })), /of another yard/);
  o.show(null);
  assert.equal(o.external, null);
  assert.ok(o.sim !== sim && o.sim !== own && o.sim.t === 0);
  run(world, 5);
  assert.ok(o.sim.t > 4);
});
