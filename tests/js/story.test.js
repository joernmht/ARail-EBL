// Stories (web/arail/core/story.js): steps to click through, with Back, Next, Play and a jump to any
// step that always give the same picture; a closure of one track of a platform (core/disruptions.js);
// the maintenance story of the infrastructure (web/arail/infra/story.js) on Bf Neustadt (the survey).
import assert from "node:assert/strict";
import test from "node:test";

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  Camera, MaintenanceStory, Registry, Story, View, createWorld, layoutPlugins, loadPlugins, registerBuiltins, registry, storyOf, validateLayout, withLayers,
} from "../../web/arail/index.js";
import { readJSON, ROOT } from "./helpers.js";

const NEUSTADT = readJSON("web/layouts/ebl-neustadt.json");
const INFRA = withLayers(NEUSTADT, ["infrastructure"]);
await loadPlugins(layoutPlugins(INFRA), pathToFileURL(join(ROOT, "web/layouts/ebl-neustadt.json")).href);

const frames = (world, n, dt = 0.1) => {
  for (let i = 0; i < n; i++) world.step(dt);
};

/** A canvas context that records the calls made. */
function recordingContext(width = 1280, height = 720) {
  const log = [];
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key === "canvas") return { width, height };
      if (key === "measureText") return (s) => ({ width: 7 * String(s).length });
      if (/^create\w*Gradient$/.test(key)) return () => ({ addColorStop() {} });
      if (key in target) return target[key];
      return (...args) => log.push({ call: key, args });
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx, log };
}

/** A virtual view looking straight down at a layout point (mm) from `d` mm. */
function topView(ctx, [x, y], d = 2500) {
  const camera = new Camera(1280, 720);
  const { fx, cx, cy } = camera.intrinsics;
  return new View({ ctx, camera, H: [fx, 0, cx * d - fx * x, 0, -fx, cy * d + fx * y, 0, 0, d], scale: 87, virtual: true });
}

/* ---------------------------------------------------------------- the story player */

/** A story whose scene is its step and progress; it closes a platform from its second step on. */
class Walk extends Story {
  static type = "walk";
  static STEPS = [
    { id: "a", title: "First", text: "One", seconds: 0 },
    { id: "b", title: "Second", text: "Two", seconds: 10 },
    { id: "c", title: "Third", text: "Three", seconds: 4 },
  ];

  compose(index, k) {
    return { at: [index, k], focus: [`o${index}`], disruptions: index >= 1 ? [{ id: "shut", type: "closure", target: "p1" }] : [] };
  }
}

/** A replay story: it counts what it did, as a story that drives an engine would. */
class Replay extends Story {
  static type = "replay";
  static replay = true;
  static STEPS = [{ id: "a", title: "A", text: "", seconds: 2 }, { id: "b", title: "B", text: "", seconds: 2 }, { id: "c", title: "C", text: "", seconds: 2 }];

  constructor(world, config) {
    super(world, config);
    this.log = [];
  }

  reset() {
    this.log = [];
  }

  enter(i) {
    this.log.push(`enter ${i}`);
  }

  settle(i) {
    this.log.push(`settle ${i}`);
  }
}

function storyWorld(...stories) {
  const reg = registerBuiltins(new Registry());
  for (const s of stories) reg.registerSimulation(s);
  const layout = {
    markers: { 0: { center: [0, 0], size: 30 }, 1: { center: [600, 0], size: 30 } },
    objects: [{ id: "p1", type: "platform", between: [0, 1], width_mm: 40, sides: "both", track_left: "1", track_right: "2" }],
    simulations: stories.map((s) => ({ type: s.type })),
  };
  return createWorld(layout, { registry: reg });
}

test("a story: Next, Back, a jump and Play; its scene is a function of the step and the progress", () => {
  const world = storyWorld(Walk);
  const s = storyOf(world, "walk");
  assert.ok(s instanceof Story && s.active);
  world.step(0.1);
  assert.deepEqual(s.state().steps.map((x) => x.title), ["First", "Second", "Third"]);
  assert.equal(s.index, 0);
  assert.equal(s.progress, 1, "a step without seconds is at its end at once");
  assert.equal(world.disruptions.active.length, 0);
  const steps = [];
  world.events.on("story.step", (e) => steps.push(e.index));
  s.next();
  assert.equal(s.index, 1);
  assert.deepEqual(s.scene.at, [1, 0]);
  assert.deepEqual(world.disruptions.active.map((d) => [d.id, d.type, d.until]), [["story:walk:shut", "closure", null]], "the scene's disruptions run until the scene drops them");
  frames(world, 25); // 25 × 0.1 s × speed 2 = 5 s of 10
  assert.ok(Math.abs(s.progress - 0.5) < 0.02, String(s.progress));
  frames(world, 40);
  assert.equal(s.progress, 1);
  // a jump and back give the same picture again
  s.goTo(2);
  s.skip();
  assert.deepEqual(s.scene.at, [2, 1]);
  assert.equal(s.finished, true);
  s.back();
  assert.deepEqual([s.index, s.t, s.scene.at], [1, 0, [1, 0]]);
  s.back();
  assert.equal(world.disruptions.active.length, 0, "back at the first step the closure is gone");
  assert.deepEqual(steps, [1, 2, 1, 0]);
  // the steps' texts can be retold in the layout
  s.config.steps = [{ id: "b", title: "Retold" }];
  assert.deepEqual(s.state().steps.map((x) => x.title), ["First", "Retold", "Third"]);
  // Play goes on by itself (each step to its end, a pause, the next), and stops at the last step
  s.play(true);
  frames(world, 400);
  assert.equal(s.index, 2);
  assert.equal(s.playing, false);
  assert.equal(s.finished, true);
  s.restart();
  assert.equal(s.index, 0);
  s.clear();
  assert.equal(world.disruptions.active.length, 0);
});

test("a replay story starts again and replays the steps before the one it goes to", () => {
  const world = storyWorld(Replay);
  const s = storyOf(world);
  world.step(0.1);
  assert.deepEqual(s.log, ["enter 0"], "its first step is begun in the first world step");
  s.next();
  assert.deepEqual(s.log, ["enter 0", "settle 0", "enter 1"], "Next runs the step on to its end and begins the next");
  s.goTo(2);
  assert.deepEqual(s.log, ["enter 0", "settle 0", "enter 1", "settle 1", "enter 2"]);
  s.back();
  assert.deepEqual(s.log, ["enter 0", "settle 0", "enter 1"], "Back starts again and replays");
  s.restart();
  assert.deepEqual(s.log, ["enter 0"]);
});

/* ---------------------------------------------------------------- one track of a platform closed */

test("a track closure acts on one track of a platform; the platform shows its message", () => {
  const world = createWorld(INFRA);
  world.step(0.1);
  const area = world.stopAreas().find((a) => a.id === "platform-2");
  const [left, right] = area.docks;
  assert.deepEqual([left.id, left.track, right.id, right.track], ["platform-2:left", "G2", "platform-2:right", "G3"]);
  const def = registry.disruptions.get("track-closure");
  assert.equal(def.targets, "track");
  const d = world.disruptions.start({ type: "track-closure", target: left.id, params: { minutes: 5 } });
  assert.equal(world.disruptions.effectsFor(area, left).closed, true);
  assert.equal(world.disruptions.effectsFor(area, right).closed, false, "the other track runs");
  const fx = world.disruptions.effectsFor(area);
  assert.equal(fx.closed, false, "the platform as a whole stays open");
  assert.match(fx.messages[0], /^Track G2 closed \(5 min left\)$/);
  // no train comes to the closed track; the other one goes on
  world.services.call(left.id);
  frames(world, 600);
  assert.equal(world.services.docks.get(left.id).vehicle, null);
  assert.ok(world.services.docks.get(left.id).heldFor > 0);
  world.disruptions.stop(d.id);
  assert.equal(world.disruptions.effectsFor(area, left).closed, false);
  // the built-in types act on one track too, when their target is its dock
  const one = (type) => {
    const x = world.disruptions.start({ type, target: right.id, params: { minutes: 3 } });
    const fx = [world.disruptions.effectsFor(area, right), world.disruptions.effectsFor(area, left), world.disruptions.effectsFor(area)];
    world.disruptions.stop(x.id);
    return fx;
  };
  const [delayed, other, platform] = one("delay");
  assert.ok(delayed.hold && !other.hold && !platform.hold, "a delay of track G3 holds its trains only");
  assert.match(platform.messages[0], /^Delay \(3 min left\)$/, "the platform shows it");
  assert.ok(one("cancellation")[0].cancel && !one("cancellation")[1].cancel);
  assert.ok(one("closure")[0].closed && !one("closure")[2].closed, "a closed track, the platform open");
  // a platform's other disruptions still act on both of its tracks
  world.disruptions.start({ type: "signal-failure", target: "platform-2", params: { minutes: 3 } });
  assert.ok(world.disruptions.effectsFor(area, left).hold && world.disruptions.effectsFor(area, right).hold);
});

/* ---------------------------------------------------------------- the maintenance story */

test("the maintenance story of Bf Neustadt: its steps name the layout's signal, tracks and base", () => {
  assert.deepEqual(validateLayout(INFRA, registry), []);
  const world = createWorld(INFRA);
  const s = storyOf(world, "maintenance-story");
  assert.ok(s instanceof MaintenanceStory);
  assert.deepEqual(MaintenanceStory.params.map((p) => [p.key, p.default]), [["signal", "signal-n2"], ["renewal", "track-g3"], ["year", 2026]]);
  world.step(0.1);
  assert.equal(s.signal().id, "signal-n2");
  assert.equal(s.dock().dock.id, "platform-2:left");
  assert.equal(s.renewal().id, "track-g3");
  assert.equal(s.renewalDock().dock.id, "platform-2:right");
  assert.equal(s.base().id, "maintenance-base-1");
  const titles = s.steps.map((x) => x.title);
  assert.deepEqual(titles, [
    "The station in normal service", "Exit signal N2 fails", "The signaller closes track G2", "The repair team drives out",
    "The team repairs the signal", "…and exchanges the old signal", "Track G2 reopens", "A planned renewal: track G3 is closed",
    "The construction train arrives", "The old track comes out", "The new track goes in", "Acceptance: track G3 reopens",
  ]);
  for (const st of s.steps) assert.doesNotMatch(`${st.title} ${st.text}`, /\{\w+\}/, "every placeholder is filled");
  assert.match(s.steps[0].text, /built in 1993/);
  assert.match(s.steps[1].text, /electronic interlocking reports the fault/);
  assert.match(s.steps[4].text, /33 years old/);
  assert.match(s.steps[7].text, /built in 1984 .* no train stops there, the other track at Platform 2 runs as usual/);
  // the van's way over the streets from the base's yard, and the technicians' walk to the signal
  const van = s.vanPath();
  assert.ok(van.length > 1500 && van.points.length >= 3, String(van.length));
  assert.ok(van.walk.length > 0 && van.walk.points.length >= 2);
  // the works on track G3, and the construction train beyond them
  const w = s.works();
  assert.ok(w.s0 > 0 && w.s0 < w.s1 && w.s1 < w.L, JSON.stringify(w, ["s0", "s1", "L"]));
});

test("the maintenance story step by step: the fault, the closed track, the repair, the new signal, the renewed track", () => {
  const world = createWorld(INFRA);
  const s = storyOf(world, "maintenance-story");
  world.step(0.1);
  const area = world.stopAreas().find((a) => a.id === "platform-2");
  const closed = () => [world.disruptions.effectsFor(area, area.docks[0]).closed, world.disruptions.effectsFor(area, area.docks[1]).closed];
  const signal = () => s.assetView("signal-n2");
  // the old signal: grade 4 by its age (1993), the newer N3 (2004) better
  assert.equal(Math.floor(signal().value), 4);
  assert.ok(s.assetView("signal-n3").value < signal().value);
  assert.deepEqual(signal().label, ["Exit signal N2", "grade 4.9 · built 1993"]);
  assert.equal(s.assetView("table-stuetzpunkt"), null, "only assets have a state");
  const at = (id) => s.constructor.STEPS.findIndex((x) => x.id === id);
  s.goTo(at("fault"));
  assert.equal(signal().fault, true);
  assert.deepEqual(world.disruptions.active.map((d) => [d.type, d.target]), [["infra-fault", "platform-2:left"]]);
  assert.deepEqual(closed(), [false, false], "a written order: the trains still run");
  s.goTo(at("close"));
  assert.deepEqual(closed(), [true, false], "track G2 closed, G3 runs");
  s.goTo(at("drive"));
  assert.equal(s.scene.van.phase, "out");
  assert.ok(s.vanAt());
  s.skip();
  assert.deepEqual(s.vanAt().point, s.vanPath().park, "parked at the end of its drive");
  s.goTo(at("repair"));
  assert.equal(s.scene.repairers.walk, 0, "a technician walks to the signal");
  assert.equal(signal().fault, true);
  s.skip();
  assert.equal(signal().fault, false, "repaired");
  assert.equal(Math.floor(signal().value), 4, "but still old");
  s.goTo(at("exchange"));
  s.skip();
  assert.equal(signal().value, 1, "the new signal: as new");
  s.goTo(at("reopen"));
  assert.deepEqual(closed(), [false, false]);
  assert.deepEqual(signal().label, ["Exit signal N2", "New · grade 1.0"]);
  // the renewal of track G3: closed at platform 2, the construction train comes in from its far end
  s.goTo(at("possession"));
  assert.equal(signal().label, null, "the renewal is the story now");
  assert.equal(s.assetView("track-g3").label[1], "Closed for its renewal");
  assert.deepEqual(closed(), [false, true], "track G3 closed, G2 runs");
  assert.equal(s.trainAt(), null);
  s.goTo(at("arrive"));
  frames(world, 25);
  const coming = s.trainAt();
  assert.ok(coming && coming.head < s.works().L);
  s.skip();
  assert.ok(s.trainAt().head < coming.head && s.trainAt().head > s.works().s1, "it waits beyond the works");
  assert.equal(s.trainAt().cars.length, 3);
  s.goTo(at("remove"));
  frames(world, 35); // 7 of 14 s
  const mid = s.scene.renewal.removed;
  assert.ok(mid > 0.3 && mid < 0.6, String(mid));
  s.goTo(at("build"));
  s.skip();
  assert.deepEqual([s.scene.renewal.laid, s.scene.renewal.tamped], [1, 1]);
  s.goTo(at("done"));
  s.skip();
  assert.equal(s.assetView("track-g3").value, 1);
  assert.equal(s.scene.renewal.closed, false);
  assert.equal(s.finished, true);
  assert.deepEqual(closed(), [false, false]);
  // back to the start: everything as it was
  s.restart();
  assert.equal(world.disruptions.active.length, 0);
  assert.equal(signal().fault, false);
  assert.equal(Math.floor(signal().value), 4);
});

test("drawing the maintenance story: every step at the station, the base and the street, by day and by night", () => {
  const world = createWorld(INFRA);
  const s = storyOf(world, "maintenance-story");
  world.step(0.1);
  for (const time of ["10:00", "23:00"]) {
    world.setTime(time);
    for (let i = 0; i < s.steps.length; i++) {
      s.goTo(i);
      frames(world, 20);
      for (const at of [[2520, 350], [4780, -418], [3000, 220], [2500, -232]]) {
        const { ctx, log } = recordingContext();
        world.draw(topView(ctx, at));
        assert.ok(log.length > 0, `step ${i} at ${at}`);
      }
    }
  }
  // the van is drawn on its way: the scene at half the drive differs from its start
  s.goTo(s.constructor.STEPS.findIndex((x) => x.id === "drive"));
  const draw = () => {
    const { ctx, log } = recordingContext();
    world.draw(topView(ctx, [3000, -100], 4000));
    return JSON.stringify(log.filter((l) => l.call === "lineTo" || l.call === "moveTo").slice(0, 4000));
  };
  const start = draw();
  frames(world, 40);
  assert.notEqual(draw(), start);
});
