// The journeys story (web/arail/journeys/story.js) on Bf Neustadt: a traveller's journey to click
// through. Her times and her rights in numbers; the steps with the layout's names; the platform track
// and the bus bay kept free for the story's own train and bus; her walks, the bus over the streets;
// the vehicle events that let the passengers get on and off; the clock; drawing every step.
import assert from "node:assert/strict";
import test from "node:test";

import {
  Camera, CD, JOURNEY_PLAN, JourneyStory, OVERLAY, View, createWorld, formatTime, journeyTimes, parseRgba, refundShare, registry,
  storyOf, validateLayout, withLayers,
} from "../../web/arail/index.js";
import { readJSON } from "./helpers.js";

const NEUSTADT = readJSON("web/layouts/ebl-neustadt.json");
const JOURNEYS = withLayers(NEUSTADT, ["journeys"]);
const at = (id) => JourneyStory.STEPS.findIndex((s) => s.id === id);

const frames = (world, n, dt = 0.1) => {
  for (let i = 0; i < n; i++) world.step(dt);
};

/** The world with the journeys layer on, and its story at its first step. */
function journeys() {
  const world = createWorld(JOURNEYS);
  const s = storyOf(world, "journeys-story");
  world.step(0.1);
  return { world, s };
}

/** The story's disruptions as "type@target: message". */
const kept = (world) => world.disruptions.active.filter((d) => d.id.startsWith("story:")).map((d) => `${d.type}@${d.target}: ${d.params.text}`).sort();

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

/** WCAG contrast of a text colour on a label background, both over an opaque colour. */
function contrast(text, background, under) {
  const over = (c, u) => {
    const [r, g, b, a] = parseRgba(c), U = Array.isArray(u) ? u : parseRgba(u);
    return [r, g, b].map((v, i) => a * v + (1 - a) * U[i]);
  };
  const lum = ([r, g, b]) => [r, g, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const bg = over(background, under), L1 = lum(over(text, bg)), L2 = lum(bg);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

/* ---------------------------------------------------------------- her times and her rights */

test("her journey in numbers: the late train, the lost connection, the RE she would wait for, the refund", () => {
  const t = journeyTimes(20);
  assert.deepEqual([formatTime(t.late.dep), formatTime(t.late.arr)], ["08:02", "08:24"], "RB 31 20 min late, in Talsee at 08:24");
  assert.equal(t.lost, true, "the RE 3 leaves Talsee at 08:10");
  assert.deepEqual([formatTime(t.wait.dep), formatTime(t.wait.arr), t.waitLate], ["09:10", "09:46", 60]);
  assert.equal(t.busLate, 12, "the bus is in Altstadt at 08:58 instead of 08:46");
  assert.equal(t.refund, 25);
  // later: the RE an hour later still, 50 % back
  assert.deepEqual([formatTime(journeyTimes(70).wait.arr), journeyTimes(70).waitLate, journeyTimes(70).refund], ["10:46", 120, 50]);
  // a few minutes late: the change in Talsee still works
  assert.equal(journeyTimes(2).lost, false);
  assert.deepEqual([59, 60, 119, 120].map(refundShare), [0, 25, 25, 50]);
  assert.equal(JOURNEY_PLAN.rb.line, "RB 31");
  assert.equal(formatTime(JOURNEY_PLAN.rb.dep), "07:42");
});

/* ---------------------------------------------------------------- the story on Bf Neustadt */

test("the journeys story of Bf Neustadt: a layer of the layout, its steps name the layout's places and her times", () => {
  assert.deepEqual(validateLayout(JOURNEYS, registry), []);
  assert.ok(NEUSTADT.layers.some((l) => l.id === "journeys" && l.enabled === false), "the module is off until it is switched on");
  assert.equal(storyOf(createWorld(NEUSTADT), "journeys-story"), null);
  const { world, s } = journeys();
  assert.ok(s instanceof JourneyStory && s.active);
  assert.equal(s.name, "Ada's journey");
  assert.deepEqual(JourneyStory.params.map((p) => [p.key, p.default]), [
    ["traveller", "Ada"], ["home", "plattenbau-1"], ["track", "track-g1"], ["bus_terminal", "bus-terminal-1"], ["bus_street", "road-schulstrasse"], ["delay_min", 20],
  ]);
  assert.equal(s.home().id, "plattenbau-1");
  assert.equal(s.dock().dock.id, "platform-1:right");
  assert.equal(s.station().id, "station-1");
  assert.equal(s.bay().dock.id, "bus-terminal-1:bay2", "the last bay");
  assert.deepEqual(s.steps.map((x) => x.title), [
    "Ada sets off", "The departure board", "On platform 1", "RB 31 is 20 minutes late", "The connection in Talsee is lost", "Her app finds a bus",
    "To the bus station", "Bus 270 leaves with Ada", "Meanwhile: RB 31 comes in", "Ada in Altstadt: her journey in numbers", "Her rights as a passenger",
  ]);
  assert.ok(s.steps.length >= 8 && s.steps.length <= 12);
  for (const st of s.steps) {
    assert.doesNotMatch(`${st.title} ${st.text}`, /\{\w+\}/, "every placeholder is filled");
    assert.ok(st.text.split(/(?<=[.!?])\s+/).length <= 3, `at most three sentences: ${st.text}`);
  }
  assert.match(s.steps[0].text, /WBS 70 Bahnhofstraße at 07:30/);
  assert.match(s.steps[1].text, /Bahnhof Neustadt .* RB 31 to Talsee at 07:42 from platform 1/);
  assert.match(s.steps[4].text, /Talsee at 08:24, but the RE 3 leaves at 08:10\. .* at 09:46, 60 minutes late/);
  assert.match(s.steps[5].text, /Neustadt Bf at 07:48, in Altstadt at 08:58/);
  assert.match(s.steps[8].text, /At 08:02, 20 minutes late, RB 31 stops at track G1/);
  assert.match(s.steps[10].text, /25 % of the fare back, from 120 minutes 50 % \(paid from 4 €\)\. Had she waited, she would have got 25 % of her fare back/);
  // another delay, another story: the texts follow the settings
  s.config.delay_min = 70;
  assert.equal(s.steps[3].title, "RB 31 is 70 minutes late");
  assert.match(s.steps[10].text, /she would have got 50 % of her fare back/);
  // the steps can be retold in the layout, by id
  s.config.steps = [{ id: "rights", title: "Fahrgastrechte" }];
  assert.equal(s.steps[10].title, "Fahrgastrechte");
  void world;
});

test("her ways: walks over the sidewalks and through the underpass, the bus over the streets by Schulstraße", () => {
  const { s } = journeys();
  const p = s.places();
  const near = (a, b, mm = 2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < mm;
  const home = s.home().entrances()[0].pos;
  assert.ok(near(p.walks.station.points[0], home), "from her front door");
  assert.ok(p.walks.station.length > 1000, String(p.walks.station.length));
  assert.deepEqual(p.walks.station.hidden, [], "she stops where she is still seen, before the station's entrance");
  assert.ok(near(p.walks.station.points.at(-1), p.points.station));
  // to the platform: through the underpass (out of sight), then along the platform to her spot
  assert.ok(p.walks.platform.hidden.length >= 1 && p.walks.platform.hidden[0][0] === 0);
  assert.ok(near(p.walks.platform.points.at(-1), p.points.spot));
  const platform = s.world.stopAreas().find((a) => a.id === "platform-1"), [sp, tp] = platform.fromLayout(p.points.spot);
  assert.ok(sp > 0 && sp < platform.L && Math.abs(tp) < platform.W / 2 && tp * platform.docks[0].side < 0, "on the platform, away from the edge of her track");
  // to the bus: back along the platform (seen), the underpass, then along the street to the bay
  const back = p.walks.bus;
  assert.ok(back.hidden[0][0] > 0, "she is seen walking back along the platform");
  assert.ok(near(back.points.at(-1), p.points.bay));
  // the bus comes in and leaves by the end of Schulstraße at the edge of the layout
  const bus = s.busPath();
  const end = [5500, -2050];
  assert.ok(near(bus.points[0], end, 30) && near(bus.points.at(-1), end, 30), `${bus.points[0]} … ${bus.points.at(-1)}`);
  assert.ok(bus.stop > bus.bus && bus.stop < bus.length);
  assert.ok(near(polylinePoint(bus, bus.stop), bus.pose.front, 3), "it stops with its front at the front of the bay");
});

/** A point at arc length s of a path {points, lengths}. */
function polylinePoint(path, s) {
  let i = 1;
  while (i < path.lengths.length - 1 && path.lengths[i] < s) i++;
  const a = path.points[i - 1], b = path.points[i], t = (s - path.lengths[i - 1]) / (path.lengths[i] - path.lengths[i - 1] || 1);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

test("the journeys story step by step: Ada, her phone, the track and the bay kept free, the bus, the late train", () => {
  const { world, s } = journeys();
  const area = world.stopAreas().find((a) => a.id === "platform-1"), dock = area.docks[0];
  const bus = world.stopAreas().find((a) => a.id === "bus-terminal-1"), [bayA, bayB] = bus.docks;
  // at home: nothing kept free, Ada at her front door
  assert.deepEqual(kept(world), []);
  assert.equal(s.adaAt().walking, false);
  s.skip();
  assert.deepEqual(s.adaAt().point, s.places().points.station, "the walk ends at the station");
  s.goTo(at("board"));
  assert.equal(s.scene.phone, "plan");
  assert.deepEqual(s.state().focus, ["station-1"]);
  // on the platform: her track is kept for her train (no train in front of her), without a word
  s.goTo(at("platform"));
  assert.deepEqual(kept(world), ["story-train@platform-1:right: "]);
  // kept for her train, not closed: the people on the platform wait for it
  assert.deepEqual([world.disruptions.effectsFor(area, dock).reserved, world.disruptions.effectsFor(area, dock).closed], [true, false]);
  assert.deepEqual(world.disruptions.effectsFor(area).messages, [], "nothing to say yet");
  assert.equal(world.disruptions.effectsFor(area).closed, false, "the platform stays open");
  frames(world, 30); // 6 of 12 s: in the underpass
  assert.equal(s.adaAt().hidden, true);
  assert.equal(s.adaAt().where, "in the underpass");
  s.skip();
  assert.deepEqual(s.adaAt().point, s.places().points.spot);
  // the train is late: the platform shows it
  s.goTo(at("late"));
  assert.deepEqual(world.disruptions.effectsFor(area).messages, ["RB 31 to Talsee about 20 min late"]);
  assert.deepEqual(s.scene.display, { late: true, boarding: false });
  s.goTo(at("connection"));
  assert.equal(s.scene.phone, "lost");
  s.goTo(at("alternative"));
  assert.equal(s.scene.route, "plan");
  // to the bus station: its last bay is kept for her bus, and bay A, which her bus drives through, silently
  s.goTo(at("walk"));
  assert.deepEqual(kept(world), ["story-train@bus-terminal-1:bay1: ", "story-train@bus-terminal-1:bay2: ", "story-train@platform-1:right: RB 31 to Talsee about 20 min late"]);
  assert.equal(world.disruptions.effectsFor(bus, bayB).reserved, true);
  assert.equal(world.disruptions.effectsFor(bus, bayA).reserved, true);
  assert.equal(world.disruptions.effectsFor(bus).closed, false, "the bus station stays open");
  assert.deepEqual(world.disruptions.effectsFor(bus).messages, []);
  s.skip();
  assert.deepEqual(s.adaAt().point, s.places().points.bay);
  // the bus: over the streets to the bay, she gets on, it leaves
  s.goTo(at("bus"));
  assert.equal(s.scene.bus.phase, "arriving");
  const coming = s.busAt();
  assert.ok(coming && !coming.doors);
  frames(world, 70); // 14 of 32 s: at the bay, doors open, she walks to the door
  assert.equal(s.scene.bus.phase, "dwelling");
  assert.equal(s.busAt().doors, true);
  assert.ok(Math.hypot(s.busAt().front[0] - s.busPath().pose.front[0], s.busAt().front[1] - s.busPath().pose.front[1]) < 3);
  frames(world, 20);
  assert.equal(s.adaAt().where, "on bus 270");
  s.skip();
  assert.equal(s.busAt(), null, "gone");
  assert.equal(s.adaAt(), null);
  // meanwhile the late train: comes in, stands (the platform says so), leaves; then the track is free again
  s.goTo(at("train"));
  assert.equal(s.trainAt(), null, "not yet");
  frames(world, 30);
  assert.equal(s.trainAt().phase, "arriving");
  frames(world, 50);
  assert.equal(s.trainAt().phase, "dwelling");
  assert.equal(s.trainAt().line, "RB 31 Talsee");
  assert.deepEqual(world.disruptions.effectsFor(area).messages, ["RB 31 to Talsee boarding, 20 min late"]);
  assert.ok(world.services.placement(s.trainAt()), "it stands at track G1");
  s.skip();
  assert.equal(s.trainAt(), null);
  // at the end: her ways and the cards; nothing kept free any more
  s.goTo(at("arrive"));
  assert.deepEqual(kept(world), []);
  assert.deepEqual([s.scene.route, s.scene.card], ["trace", "arrive"]);
  s.goTo(at("rights"));
  assert.equal(s.scene.card, "rights");
  s.skip();
  assert.equal(s.finished, true);
  s.restart();
  assert.deepEqual(kept(world), []);
  assert.equal(s.index, 0);
  assert.equal(registry.disruptions.get("story-train").hidden, true, "not offered in the Disruptions tab");
  assert.equal(registry.disruptions.get("story-train").quiet, true, "a sign only with a message");
});

test("Back and a jump show the same as playing through: the scene, Ada, the bus, the train, the camera, what is kept free", () => {
  const { world, s } = journeys();
  const train = () => s.trainAt() && { phase: s.trainAt().phase, progress: s.trainAt().progress };
  const snap = () => JSON.stringify({ scene: s.scene, ada: s.adaAt(), bus: s.busAt(), train: train(), kept: kept(world), view: s.view() });
  // played through: each step halfway and at its end
  const played = new Map();
  s.play(true);
  for (let i = 0; i < 6000 && !s.finished; i++) {
    world.step(0.1);
    for (const k of [0.5, 1]) if (s.progress >= k && !played.has(`${s.index}:${k}`)) played.set(`${s.index}:${k}`, { index: s.index, t: s.t, snap: snap() });
  }
  assert.equal(played.size, 2 * s.steps.length);
  // the other way round, each step reached by a jump
  for (const { index, t, snap: want } of [...played.values()].reverse()) {
    s.goTo(index);
    s.t = t;
    s.refresh();
    assert.equal(snap(), want, `step ${index + 1} at ${t.toFixed(1)} s`);
  }
});

test("the story's train and bus tell the world when they stop and leave: passengers get on and off", () => {
  const { world, s } = journeys();
  const events = [];
  for (const name of ["vehicle.arriving", "vehicle.arrived", "vehicle.departing", "vehicle.departed"]) {
    world.events.on(name, (e) => e.vehicle.source === "story" && events.push(`${name} ${e.vehicle.kind} ${e.dock.id}`));
  }
  world.demand = 10; // a busy day: the small town alone sends few people to the stops
  frames(world, 400); // people come to the platforms and the bus station
  const passengers = world.simulations.find((x) => x.constructor.type === "passengers");
  const waiting = (id) => passengers.crowds.get(id).people.filter((p) => p.state === "waiting" || p.state === "arriving");
  // a jump does not tell anything: only a step that runs on
  s.goTo(at("bus"));
  s.skip();
  assert.deepEqual(events, []);
  s.goTo(at("bus"));
  frames(world, 62); // 12.4 of 32 s: the bus at the bay
  assert.deepEqual(events, ["vehicle.arrived bus bus-terminal-1:bay2"]);
  frames(world, 200);
  assert.deepEqual(events.slice(1), ["vehicle.departing bus bus-terminal-1:bay2", "vehicle.departed bus bus-terminal-1:bay2"]);
  events.length = 0;
  s.goTo(at("train"));
  const before = waiting("platform-1");
  assert.ok(before.length > 0, "people wait for the late train");
  frames(world, 60);
  assert.deepEqual(events, ["vehicle.arriving train platform-1:right", "vehicle.arrived train platform-1:right"]);
  const boarding = passengers.crowds.get("platform-1").people.filter((p) => p.state === "boarding" || p.state === "onboard").length;
  assert.ok(boarding > 0, "they go to its doors, others get off");
  frames(world, 100);
  assert.deepEqual(events.slice(2), ["vehicle.departing train platform-1:right", "vehicle.departed train platform-1:right"]);
  // those who waited have gone with it (others come for the next trains meanwhile)
  const left = before.filter((p) => waiting("platform-1").includes(p)).length;
  assert.ok(left < before.length, `${left} still waiting of ${before.length}`);
  // a jump while the train stands: it leaves with its step (nobody is left walking to its doors)
  events.length = 0;
  s.goTo(at("train"));
  frames(world, 60);
  assert.equal(s.scene.train.phase, "dwelling");
  s.next();
  assert.deepEqual(events, ["vehicle.arriving train platform-1:right", "vehicle.arrived train platform-1:right", "vehicle.departing train platform-1:right", "vehicle.departed train platform-1:right"]);
  assert.ok(!passengers.crowds.get("platform-1").people.some((p) => p.state === "boarding" && p.dock === "platform-1:right"), "nobody walks to its doors");
  // the step run to its end at once (skip): the bus has come and gone, and says so
  events.length = 0;
  s.goTo(at("bus"));
  frames(world, 62);
  s.skip();
  frames(world, 1);
  assert.deepEqual(events, ["vehicle.arrived bus bus-terminal-1:bay2", "vehicle.departing bus bus-terminal-1:bay2", "vehicle.departed bus bus-terminal-1:bay2"]);
});

test("timetable trains and buses keep off the story's track and bays; Clear passengers keeps them free", () => {
  const { world, s } = journeys();
  const on = (dock) => world.services.docks.get(dock)?.vehicle ?? null;
  s.play(true);
  // seconds since the story keeps the track (from the platform to the late train) and the bus station (her walk there, the bus)
  const since = { track: 0, bays: 0 };
  for (let i = 0; i < 4000 && s.index < at("arrive"); i++) {
    world.step(0.1);
    since.track = s.index >= at("platform") ? since.track + 0.1 : 0;
    since.bays = s.index === at("walk") || s.index === at("bus") ? since.bays + 0.1 : 0;
    // one there when the story begins to keep it comes in (at most 6 s) and leaves (6 s), as at a closed track
    if (since.track > 13) assert.equal(on("platform-1:right"), null, `${s.current.id}: a timetable train at track G1`);
    if (since.bays > 13) assert.ok(!on("bus-terminal-1:bay1") && !on("bus-terminal-1:bay2"), `${s.current.id}: a timetable bus in the bus station`);
  }
  assert.equal(s.index, at("arrive"), "Play went through the story");
  // Clear passengers takes off the scene's disruptions; the next world step starts them again
  s.goTo(at("walk"));
  const before = kept(world);
  s.clear();
  assert.deepEqual(kept(world), []);
  frames(world, 1);
  assert.deepEqual(kept(world), before);
});

test("each step sets the world's clock to its time when it is more than a few minutes away", () => {
  // the first step too, when the story begins: a night scene becomes the morning of her journey
  const night = createWorld(JOURNEYS);
  night.setTime("22:30");
  night.step(0.1);
  assert.equal(night.clock.label(), "07:30");
  const { world, s } = journeys();
  assert.equal(world.clock.label(), "07:30");
  s.goTo(at("late"));
  assert.equal(world.clock.label(), "07:38");
  frames(world, 50); // 10 s × 12 = 2 clock minutes
  s.next();
  assert.ok(world.clock.minutes > 459, "close enough: it runs on");
  s.goTo(at("train"));
  assert.equal(world.clock.label(), "08:00");
  s.goTo(at("arrive"));
  assert.equal(world.clock.label(), "08:58");
  s.restart();
  assert.equal(world.clock.label(), "07:30");
  // a train so late that it comes in after her bus is in Altstadt: the cards do not set the clock back
  s.config.delay_min = 90;
  s.goTo(at("train"));
  assert.equal(world.clock.label(), "09:10");
  s.goTo(at("arrive"));
  assert.equal(world.clock.label(), "09:10", "not back to 08:58: it runs on");
  s.restart();
  s.goTo(at("arrive"));
  assert.equal(world.clock.label(), "09:14");
});

test("the camera: her walk from home seen from the street, facing her front door; the rest facing the station's front", () => {
  const { s } = journeys();
  const yaw = () => Math.round(s.view().yaw_deg);
  assert.equal(yaw(), -90, "her house's door faces the station: the camera looks from there");
  for (const id of ["board", "platform", "walk", "bus", "train", "arrive"]) {
    s.goTo(at(id));
    assert.equal(yaw(), 90, id);
  }
  s.goTo(at("train"));
  assert.deepEqual(s.view().at, s.places().points.spot, "the train where she waited");
});

test("drawing the journeys story: every step, Ada with her name, legible labels, no sign for the bay kept free", () => {
  const { world, s } = journeys();
  const labels = [];
  const record = (view) => {
    const label = view.label.bind(view);
    view.label = (p, text, style = {}) => (labels.push({ text: [].concat(text), style }), label(p, text, style));
    return view;
  };
  for (let i = 0; i < s.steps.length; i++) {
    s.goTo(i);
    for (const k of [0.3, 0.6, 1]) {
      s.t = k * (s.current.seconds || 0);
      s.refresh();
      frames(world, 2);
      const v = s.view();
      assert.ok(v?.at && v.distance > 0, `step ${i + 1}: a view`);
      for (const p of [v.at, [3000, 0]]) {
        const { ctx, log } = recordingContext();
        world.draw(record(topView(ctx, p, 1500)));
        assert.ok(log.length > 0);
      }
    }
  }
  const texts = labels.map((l) => l.text.join(" | "));
  assert.ok(texts.some((t) => t === "Ada"), "her name");
  assert.ok(texts.some((t) => t === "Ada · in the underpass"));
  assert.ok(texts.some((t) => t.startsWith("Connection in Talsee lost")), "her phone");
  assert.ok(texts.some((t) => t.startsWith("Departures (Abfahrt) | 07:42 RB 31 Talsee +20")), "the board with the delay");
  assert.ok(texts.some((t) => t.startsWith("07:42 RB 31 Talsee | about 20 min later")), "the platform's display");
  assert.ok(texts.some((t) => t.startsWith("Ada: Neustadt → Altstadt")) && texts.some((t) => t.startsWith("Passenger rights")), "the cards");
  assert.ok(!texts.some((t) => t.includes("Kept free")), "the bay kept free has no sign");
  // every label is legible over a bright and a dark camera image
  for (const { style } of labels) {
    const background = style.background || OVERLAY.label;
    for (const text of [...(style.colors || []).filter(Boolean), style.color || OVERLAY.labelText]) {
      for (const under of ["#ffffff", "#000000"]) assert.ok(contrast(text, background, under) >= 4.5, `${text} on ${background} over ${under}`);
    }
    if (style.badge && style.badgeColor) assert.ok(contrast(OVERLAY.labelText, style.badgeColor, "#ffffff") >= 4.5, `badge on ${style.badgeColor}`);
  }
  assert.ok(labels.some((l) => l.style.background === CD.orange), "her name on Orange");
});
