// The operations story (web/arail/ops/story.js) on Bf Neustadt (the survey): RB 31 breaks down at
// track G3, the spare unit comes in at track G2, the broken unit goes to the depot's workshop; and
// what holds a track for a story's own train ("story-train", core/story.js): no timetable train comes
// there, one standing there is taken away, the platform shows the story's message.
import assert from "node:assert/strict";
import test from "node:test";

import {
  Camera, DEFAULT_CONTRACTS, OpsStory, STORY_DISRUPTIONS, View, createWorld, normalizeLayers, registry, statusLines, storyOf, toggleLayer, validateLayout,
  withLayers,
} from "../../web/arail/index.js";
import { readJSON } from "./helpers.js";

const NEUSTADT = readJSON("web/layouts/ebl-neustadt.json");
const OPS = withLayers(NEUSTADT, ["operations"]);
const at = (id) => OpsStory.STEPS.findIndex((s) => s.id === id);

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

/** The texts drawn as labels (fillText) in a view of the layout at a point. */
function labelsAt(world, p, d = 1500) {
  const { ctx, log } = recordingContext();
  const view = topView(ctx, p, d);
  world.draw(view);
  return log.filter((l) => l.call === "fillText").map((l) => String(l.args[0]));
}

/* ---------------------------------------------------------------- a story's train holds its track */

test("a story's train holds its track: no timetable train comes, one there is taken away, the platform shows the message", () => {
  const world = createWorld(NEUSTADT);
  frames(world, 2);
  const area = world.getStopArea("platform-2"), [g2, g3] = area.docks;
  const def = registry.disruptions.get("story-train");
  assert.ok(STORY_DISRUPTIONS.includes(def) && def.hidden && def.quiet && def.targets === "track");
  // a timetable train standing at G3 is taken away at once when a story takes the track
  assert.ok(world.services.call(g3.id), "a train sent to G3");
  const departed = [];
  world.events.on("vehicle.departed", (e) => departed.push(e.dock.id));
  frames(world, 80); // it stands there now
  assert.equal(world.services.docks.get(g3.id).vehicle?.phase, "dwelling");
  const d = world.disruptions.start({ id: "story:test:rb", type: "story-train", target: g3.id, duration: null });
  assert.equal(world.services.docks.get(g3.id).vehicle, null);
  assert.deepEqual(departed, [g3.id]);
  // closed for the timetable and for calls (keys 1–9, the Stops board); the other track runs
  assert.equal(world.disruptions.effectsFor(area, g3).closed, true);
  assert.equal(world.disruptions.effectsFor(area, g2).closed, false);
  assert.equal(world.services.call(g3.id), null);
  frames(world, 1500);
  assert.equal(world.services.docks.get(g3.id).vehicle, null, "no train came to G3");
  // without a message: no message at the platform and no warning sign
  assert.deepEqual(world.disruptions.effectsFor(area).messages, []);
  assert.ok(!labelsAt(world, area.toLayout(area.L / 2, 0)).some((t) => /story/i.test(t)));
  // with one: the platform's board shows it
  world.disruptions.start({ id: d.id, type: "story-train", target: g3.id, params: { text: "RB 31 Talsee 07:42: delayed" }, duration: null });
  assert.deepEqual(world.disruptions.effectsFor(area).messages, ["RB 31 Talsee 07:42: delayed"]);
  assert.ok(labelsAt(world, area.toLayout(10, 0)).includes("RB 31 Talsee 07:42: delayed"));
});

test("a train taken away for a story's train: the people on their way to its doors missed it and wait at the other track", () => {
  const world = createWorld(NEUSTADT, { seed: 3 });
  const area = world.getStopArea("platform-2");
  const sim = world.simulations.find((s) => s.constructor.type === "passengers");
  const boarding = (id) => (sim.crowds.get(area.id)?.people ?? []).filter((p) => p.state === "boarding" && p.dock === id);
  let dock = null;
  for (let i = 0; i < 6000 && !dock; i++) {
    world.step(0.1);
    dock = area.docks.find((d) => world.services.docks.get(d.id).vehicle?.phase === "dwelling" && boarding(d.id).length >= 2) ?? null;
  }
  assert.ok(dock, "people boarding a train at platform 2");
  const people = boarding(dock.id);
  world.disruptions.start({ id: "story:test:rb", type: "story-train", target: dock.id, duration: null });
  assert.equal(world.services.docks.get(dock.id).vehicle, null);
  assert.deepEqual(boarding(dock.id), [], "nobody boards a train taken away");
  frames(world, 2);
  for (const p of people) assert.ok(p.state !== "boarding" && p.dock !== dock.id, `${p.state} for ${p.dock}`);
});

test("the people waiting for a held track go over to the other one, or leave when both are held; the board shows no next train then", () => {
  const world = createWorld(NEUSTADT, { seed: 3 });
  frames(world, 600);
  const area = world.getStopArea("platform-2"), [g2, g3] = area.docks;
  const sim = world.simulations.find((s) => s.constructor.type === "passengers");
  const crowd = sim.crowds.get(area.id);
  const waiting = (dock) => crowd.people.filter((p) => (p.state === "waiting" || p.state === "arriving") && p.dock === dock.id).length;
  assert.ok(waiting(g3) > 0, "people wait for G3");
  world.disruptions.start({ id: "a", type: "story-train", target: g3.id, duration: null });
  frames(world, 2);
  assert.equal(waiting(g3), 0, "nobody waits for G3 now");
  world.disruptions.start({ id: "b", type: "story-train", target: g2.id, duration: null });
  frames(world, 600);
  assert.equal(crowd.people.filter((p) => p.state === "waiting" || p.state === "arriving").length, 0, "nobody waits at a platform whose tracks are both held");
  // a held track's timer has run out: no "Next train in 0 s" on the board, nor any next train
  assert.deepEqual(statusLines(world, area), []);
  world.disruptions.stop("b");
  assert.match(statusLines(world, area)[0], /^Next train in \d+ s$/);
});

/* ---------------------------------------------------------------- the operations story */

test("the operations story of Bf Neustadt: its steps name the layout's tracks, units, depot and the penalties", () => {
  assert.deepEqual(validateLayout(OPS, registry), []);
  // the module alone: its story takes over platform 2, where the maintenance story closes and renews tracks
  const layers = normalizeLayers(NEUSTADT.layers);
  assert.deepEqual(toggleLayer(layers, ["infrastructure"], "operations"), ["operations"]);
  assert.deepEqual(toggleLayer(layers, ["operations"], "infrastructure"), ["infrastructure"]);
  const world = createWorld(OPS);
  const s = storyOf(world, "ops-story");
  assert.ok(s instanceof OpsStory);
  assert.deepEqual(OpsStory.params.map((p) => [p.key, p.default]), [
    ["track", "track-g3"], ["spare_track", "track-g2"], ["depot", "depot-neustadt"], ["line", "RB 31"], ["destination", "Talsee"],
    ["departure", "07:42"], ["unit", "442 101"], ["spare", "442 108"], ["km", 22],
  ]);
  world.step(0.1);
  assert.equal(s.dock().dock.id, "platform-2:right");
  assert.equal(s.spareDock().dock.id, "platform-2:left");
  assert.equal(s.depot().id, "depot-neustadt");
  assert.equal(s.heading(), -1, "the depot is at the tracks' last points: the trains run to their first points");
  const titles = s.steps.map((x) => x.title);
  assert.deepEqual(titles, [
    "RB 31 to Talsee boards at track G3", "442 101 reports a fault", "The driver calls the operations control", "The passengers get off and wait",
    "The spare unit leaves the depot", "442 108 comes in at track G2", "Passengers change trains; RB 31 leaves late", "442 101 runs empty to the workshop",
    "In the workshop: diagnosis and repair", "Back to normal service",
  ]);
  assert.ok(titles.length >= 8 && titles.length <= 12);
  for (const st of s.steps) {
    assert.doesNotMatch(`${st.title} ${st.text}`, /\{\w+\}/, "every placeholder is filled");
    assert.ok(st.text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).length <= 3, `at most three sentences: ${st.text}`);
  }
  assert.match(s.steps[0].text, /due out at 07:42, stands at track G3 of Platform 2, the two-car electric multiple unit 442 101/);
  assert.match(s.steps[1].text, /At 07:41 .* traction converter \(Stromrichter\)/);
  assert.match(s.steps[2].text, /operations control \(Transportleitung\).* spare unit 442 108 from Betriebswerk Neustadt/);
  assert.match(s.steps[4].text, /At 07:57 it leaves/);
  assert.match(s.steps[5].text, /At 08:03 the spare unit stops at track G2/);
  assert.match(s.steps[6].text, /At 08:07 RB 31 leaves for Talsee, 25 minutes late/);
  // the penalties of the operations' default transport contract
  const p = DEFAULT_CONTRACTS.find((c) => c.id === "transport").penalties;
  assert.match(s.steps[8].text, new RegExp(`more than ${p.late_threshold_min} minutes late: .* 2 × ${p.late_trip} € = ${2 * p.late_trip} €`));
  assert.match(s.steps[8].text, new RegExp(`44 train-km × ${p.cancelled_km} € = ${44 * p.cancelled_km} €`));
  // another departure moves every time of the story
  s.config.departure = "16:12";
  assert.match(s.steps[6].text, /At 16:37 RB 31 leaves/);
});

test("the operations story step by step: the tracks held, the units, the passengers, the display and the depot", () => {
  const world = createWorld(OPS);
  const s = storyOf(world, "ops-story");
  world.step(0.1);
  const a = s.dock(), b = s.spareDock(), area = a.area;
  const held = () => world.disruptions.active.filter((d) => d.type === "story-train").map((d) => `${d.target}${d.params.text ? `: ${d.params.text}` : ""}`).sort();
  const go = (id, k = 1) => {
    s.goTo(at(id));
    s.t = k * (s.current.seconds || 0);
    s.refresh();
  };
  // 1. boarding: both tracks of the story held from the start, without a message; the passengers walk to the doors
  go("normal", 0);
  assert.deepEqual(held(), ["platform-2:left", "platform-2:right"]);
  assert.equal(s.trainAt().head, s.stopAt(a));
  assert.equal(s.trainAt().doors, 1);
  assert.equal(s.passengers().length, 14);
  assert.deepEqual(s.scene.display.lines, ["07:42  RB 31  Talsee", "On time"]);
  assert.match(s.depotState(s.depot()).lines[0], /^Spare unit 442 108 ready/);
  go("normal", 1);
  assert.equal(s.passengers().length, 0, "all on board");
  // the unit stands at the front end of the platform (the trains run towards the tracks' first points)
  const head = area.fromLayout(s._cab(s.trainAt()))[0];
  assert.ok(head < 8, `the cab ${head.toFixed(1)} m from the platform's start`);
  // 2. the fault: the platform's message and the display
  go("fault");
  assert.deepEqual(held(), ["platform-2:left", "platform-2:right: RB 31 Talsee 07:42: delayed, fault on the train"]);
  assert.deepEqual(world.disruptions.effectsFor(area).messages, ["RB 31 Talsee 07:42: delayed, fault on the train"]);
  assert.equal(s.scene.display.alert, true);
  // 3. the reset: pantograph down and up again, the fault back, the spare ordered
  go("call", 0.4);
  assert.ok(s.trainAt().pantograph < 1 && !s.trainAt().powered && s.scene.radio === "reset");
  go("call", 1);
  assert.ok(s.trainAt().pantograph === 1 && s.trainAt().fault && s.scene.radio === "decision");
  assert.match(s.depotState(s.depot()).lines[0], /ordered for RB 31/);
  // 4. off the train and across the platform, to the spare's track
  go("alight", 1);
  const people = s.passengers();
  assert.equal(people.length, 14);
  for (const p of people) assert.ok(area.fromLayout(p.at)[1] * b.dock.side > 0, "waiting on the spare's side");
  assert.match(s.scene.display.lines[1], /^Now from track G2, about \+25 min$/);
  // 5. the spare unit: stabled in the depot, then out along the lead track; a stand-by driver walks to it
  go("spare", 0);
  assert.ok(s.spareAt().line === s.depotLines().stable && !s.spareAt().powered);
  assert.ok(s.walkerAt().speed > 0);
  // he is in the cab before the pantograph rises, and does not stay behind when the unit leaves
  for (let k = 0; k <= 1; k += 0.02) {
    go("spare", k);
    if (s.spareAt().pantograph > 0) assert.equal(s.walkerAt(), null, `in the cab at ${k.toFixed(2)}`);
  }
  go("spare", 1);
  assert.ok(s.spareAt().head < 0, "gone beyond the module's edge");
  assert.equal(s.walkerAt(), null);
  // 6. in at G2 from the depot's end, braking to its stop opposite the broken unit
  go("arrive", 0.3);
  const coming = s.spareAt();
  assert.ok(coming.line.total - coming.head < coming.line.total - s.stopAt(b) && coming.head > s.stopAt(b), "on its way from the tracks' last point");
  go("arrive", 1);
  assert.ok(Math.abs(s.spareAt().head - s.stopAt(b)) < 1e-6);
  assert.equal(s.spareAt().doors, 1);
  // 7. across the platform and on board; off to Talsee, the track free again for the timetable
  go("change", 0.2);
  assert.ok(s.passengers().length > 0 && s.passengers().length < 14);
  go("change", 1);
  assert.equal(s.passengers().length, 0);
  assert.ok(s.spareAt().head < -s.spareAt().line.m * 40, "gone beyond the tracks' first point");
  assert.deepEqual(held(), ["platform-2:right"]);
  assert.deepEqual(s.scene.display.lines, ["08:42  RB 31  Talsee", "On time"]);
  // 8. the empty run: the other way round, off the table, into the depot's workshop
  go("empty", 0.1);
  assert.match(held()[0], /^platform-2:right: Track G3: empty train, do not board$/);
  go("empty", 0.45);
  assert.ok(s.trainAt().reversed && s.trainAt().dir === 1 && s.trainAt().head > s.stopAt(a));
  go("empty", 1);
  assert.deepEqual(held(), [], "track G3 is free again");
  assert.equal(s.trainAt().line, s.depotLines().bay);
  assert.equal(s.spareAt(), null);
  // 9. the repair in the workshop
  go("workshop", 0.5);
  assert.deepEqual(s.depotState(s.depot()).lines, ["No spare unit: 442 108 runs RB 31", "Workshop: 442 101 · repair 50 %"]);
  assert.equal(s.trainAt().pantograph, 0);
  // 10. the next morning: as at the start, the spare back in the depot, track G2 free
  go("back", 0);
  assert.deepEqual(held(), ["platform-2:right"]);
  assert.equal(s.spareAt().line, s.depotLines().stable);
  assert.equal(s.finished, false);
  s.skip();
  assert.equal(s.finished, true);
  // back to the start: the same picture as before
  s.restart();
  assert.deepEqual(held(), ["platform-2:left", "platform-2:right"]);
  assert.equal(s.passengers().length, 14);
  // the module off: nothing held any more
  s.clear();
  assert.deepEqual(held(), []);
});

test("while the story plays, no timetable train ever stands where its trains are", () => {
  const world = createWorld(OPS, { seed: 9 });
  const s = storyOf(world, "ops-story");
  frames(world, 2);
  const area = s.dock().area, [g2, g3] = area.docks;
  world.speed = 4;
  s.play(true);
  let seen = 0;
  for (let i = 0; i < 6000 && !s.finished; i++) {
    world.step(0.1);
    for (const d of world.disruptions.active.filter((x) => x.type === "story-train")) {
      const v = world.services.docks.get(d.target)?.vehicle;
      assert.equal(v ?? null, null, `a timetable train at ${d.target} in step ${s.index + 1}`);
      seen++;
    }
  }
  assert.ok(s.finished, "played to the end");
  assert.ok(seen > 400, String(seen));
  // the module off: the platform's tracks run again (a timetable train stands there now and then;
  // when exactly follows the random intervals of the timetable)
  s.enabled = false;
  s.clear();
  let again = 0;
  for (let i = 0; i < 1200; i++) {
    world.step(0.1);
    if ([g2, g3].some((k) => world.services.docks.get(k.id).vehicle)) again++;
  }
  assert.ok(again > 100, `timetable trains at platform 2 again (${again} of 1200 steps)`);
});

test("drawing the operations story: every step at the station and the depot, by day and by night", () => {
  const world = createWorld(OPS);
  const s = storyOf(world, "ops-story");
  world.step(0.1);
  for (const time of ["10:00", "23:00"]) {
    world.setTime(time);
    for (let i = 0; i < s.steps.length; i++) {
      s.goTo(i);
      frames(world, 20);
      const v = s.view();
      assert.ok(v.at && v.distance > 0 && v.pitch_deg > 0, `step ${i + 1}: a view`);
      for (const p of [[1900, 290], [4900, 935], [3000, 230], v.at]) {
        const { ctx, log } = recordingContext();
        world.draw(topView(ctx, p, 1500));
        assert.ok(log.length > 0, `step ${i + 1} at ${p}`);
      }
    }
  }
  // the display at the platform says what the step says
  s.goTo(at("fault"));
  assert.ok(labelsAt(world, s._platformPoint(), 1200).includes("Delayed: fault on the train"));
  // the spare unit is drawn on its way in: the picture changes as it comes
  s.goTo(at("arrive"));
  const draw = () => {
    const { ctx, log } = recordingContext();
    world.draw(topView(ctx, [3000, 300], 3000));
    return JSON.stringify(log.filter((l) => l.call === "lineTo" || l.call === "moveTo").slice(0, 4000));
  };
  const start = draw();
  frames(world, 30);
  assert.notEqual(draw(), start);
});

test("the operations story without its places: nothing to draw, nothing held, no error", () => {
  const layout = {
    markers: { 0: { center: [0, 0], size: 30 }, 1: { center: [600, 0], size: 30 } },
    objects: [{ id: "p1", type: "platform", between: [0, 1], width_mm: 40, sides: "both", track_left: "1", track_right: "2" }],
    simulations: [{ type: "ops-story" }],
  };
  const world = createWorld(layout);
  const s = storyOf(world, "ops-story");
  frames(world, 2);
  assert.equal(s.dock(), null);
  for (let i = 0; i < s.steps.length; i++) {
    s.goTo(i);
    s.skip();
    assert.equal(s.view(), null);
    assert.deepEqual(s.passengers(), []);
    const { ctx } = recordingContext();
    world.draw(topView(ctx, [300, 0]));
  }
  assert.equal(world.disruptions.active.length, 0);
  assert.match(s.steps[0].title, /^RB 31 to Talsee boards at the platform track$/);
});
