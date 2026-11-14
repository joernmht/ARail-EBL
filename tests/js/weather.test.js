// The date and the sun on the clock (core/clock.js) and the weather (core/weather.js, #254): the
// typical weather of a date, fixed weather and courses, the ground's memory, what others read
// (rails, walking, cycling, the market), scenarios, the layout file, and the weather in the picture.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  Camera, Clock, RAIL_CONDITIONS, SimpleView, SUN, View, WEATHER_PRESETS, createWorld, formatDate, formatTime, leafState, leafTone, parseDate, registry, seasonOf, sunTimes,
  typicalAir, validateLayout, weatherProblems, withLayers,
} from "../../web/arail/index.js";
import { railCondition } from "../../web/arail/rail/ahead.js";
import registerWindmill from "../../web/plugins/windmill.js";
import { ROOT } from "./helpers.js";

registerWindmill({ ...await import("../../web/arail/index.js") });

const LAB = JSON.parse(readFileSync(join(ROOT, "web/layouts/ebl-lab.json"), "utf8"));
const lab = (layers = [], extra = {}) => createWorld({ ...withLayers(LAB, layers), ...extra });
const run = (world, seconds, dt = 0.1) => {
  for (let t = 0; t < seconds; t += dt) world.step(dt);
};
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

test("dates: MM-DD and the day of the year, seasons; what is no date is null", () => {
  assert.equal(parseDate("01-01"), 1);
  assert.equal(parseDate("12-06"), 340);
  assert.equal(parseDate("12-31"), 365);
  assert.equal(parseDate(340), 340);
  for (const bad of ["13-01", "02-30", "6.12.", "", null, 0, 366, "12-6-2026"]) assert.equal(parseDate(bad), null, String(bad));
  assert.equal(formatDate(340), "12-06");
  assert.equal(formatDate(parseDate("2-9")), "02-09");
  assert.deepEqual(["01-15", "04-15", "07-15", "10-15", "12-01"].map((d) => seasonOf(parseDate(d))), ["winter", "spring", "summer", "autumn", "winter"]);
});

test("the sun by the date in Dresden: short days in December, long ones in June", () => {
  const near = (value, hhmm, tol = 6) => assert.ok(Math.abs(value - minutes(hhmm)) <= tol, `${formatTime(value)} is not about ${hhmm}`);
  const winter = sunTimes(parseDate("12-21")), summer = sunTimes(parseDate("06-21")), spring = sunTimes(parseDate("03-20"));
  near(winter.rise, "08:05");
  near(winter.set, "15:58");
  near(summer.rise, "04:50"); // summer time
  near(summer.set, "21:21");
  near(spring.rise, "06:11");
  near(spring.set, "18:15");
  // further north the winter day is shorter; where the sun does not rise the day has no length
  assert.ok(sunTimes(355, 60).set - sunTimes(355, 60).rise < winter.set - winter.rise);
  assert.equal(sunTimes(355, 80).set, sunTimes(355, 80).rise);
});

test("the clock: without a date as ever; with one the sun of that day, running on at midnight", () => {
  const plain = new Clock();
  assert.equal(plain.date, null);
  assert.equal(plain.sun(), SUN);
  assert.equal(plain.dateLabel(), "");
  assert.equal(plain.season(), null);
  assert.deepEqual(plain.toJSON(), { start: "07:00", factor: 12, profiles: true }, "the layout file is as it was");
  const c = new Clock({ date: "12-31", start: "23:50" });
  assert.equal(c.dateLabel(), "31 Dec");
  assert.equal(c.season(), "winter");
  c.set("16:30");
  assert.ok(c.night() > 0.5, "dark at half past four in December");
  assert.ok(new Clock({ date: "06-21", start: "16:30" }).night() < 0.01);
  c.set("23:50");
  assert.ok(c.advance(100)); // 20 clock minutes
  assert.equal(c.dateLabel(), "1 Jan");
  assert.deepEqual(c.toJSON(), { start: "23:50", factor: 12, profiles: true, date: "12-31" }, "the start date is kept, not the current one");
  assert.equal(c.setDate("nonsense"), c.date, "what is no date changes nothing");
  assert.equal(c.setDate(null), null);
});

test("no weather unless asked for: a mild dry day, every factor 1, nothing in the picture", () => {
  const world = lab();
  const w = world.weather;
  assert.equal(w.mode, "off");
  assert.ok(!w.on);
  assert.equal(w.describe(), "");
  assert.equal(w.look(), null);
  assert.deepEqual([w.walkFactor(), w.driveFactor(), w.cycleShare(), w.railCondition()], [1, 1, 1, "dry"]);
  assert.equal(w.now().precipitation, "none");
  assert.equal(world.toJSON().weather, undefined, "and nothing in the layout file");
  // a date alone moves the sun and the leaves' season, not the weather
  world.setDate("12-06");
  assert.ok(!w.on);
  assert.equal(w.now().leaf.state, "leaf", "without weather the trees stay as they were");
});

test("the typical weather: the same for the same seed and date, a year like Dresden's", () => {
  assert.deepEqual(typicalAir(5, 200, 600), typicalAir(5, 200, 600));
  assert.notDeepEqual([1, 2, 3, 4, 5, 6].map((d) => typicalAir(5, d * 30, 720).temperature_c), [1, 2, 3, 4, 5, 6].map((d) => typicalAir(6, d * 30, 720).temperature_c));
  let mean = 0, mm = 0, wet = 0, snowSummer = 0, frost = 0;
  for (let d = 1; d <= 365; d++) {
    let rained = false, froze = false;
    for (let m = 0; m < 1440; m += 30) {
      const a = typicalAir(1, d, m);
      mean += a.temperature_c / 48 / 365;
      mm += a.rate_mm_h / 2;
      if (a.precipitation !== "none") rained = true;
      if (a.precipitation === "snow" && d > 150 && d < 270) snowSummer++;
      if (a.temperature_c < 0) froze = true;
      assert.ok(a.cloud >= 0 && a.cloud <= 1 && a.fog >= 0 && a.fog <= 1 && a.rate_mm_h >= 0 && a.wind_mps >= 0);
    }
    wet += rained;
    frost += froze;
  }
  assert.ok(mean > 8.5 && mean < 11, `mean ${mean.toFixed(1)} °C (Dresden: 9.8)`);
  assert.ok(mm > 450 && mm < 850, `${Math.round(mm)} mm (Dresden: about 640)`);
  assert.ok(wet > 120 && wet < 190, `${wet} wet days (Dresden: about 156)`);
  assert.equal(snowSummer, 0, "no snow in summer");
  assert.ok(frost > 20, `${frost} days with frost`);
  // the days go over into each other: no jump at midnight; warmer in the afternoon than before sunrise
  for (const d of [10, 100, 200, 300]) {
    assert.ok(Math.abs(typicalAir(1, d, 1439).temperature_c - typicalAir(1, d + 1, 0).temperature_c) < 0.6, `day ${d}`);
    assert.ok(typicalAir(1, d, 930).temperature_c > typicalAir(1, d, 270).temperature_c);
  }
});

test("the leaves through the year, and a crown's colour", () => {
  assert.deepEqual(["01-10", "04-20", "07-01", "10-15", "11-10", "12-20"].map((d) => leafState(parseDate(d)).state), ["bare", "leafing", "leaf", "colouring", "falling", "bare"]);
  assert.deepEqual(leafState(null), { state: "leaf", share: 1, colour: 0 });
  assert.equal(leafState(parseDate("01-10")).share, 0);
  const green = [76, 140, 63];
  assert.deepEqual(leafTone(green, leafState(parseDate("07-01"))), green);
  const autumn = leafTone(green, leafState(parseDate("10-28")), 0.1);
  assert.ok(autumn[0] > green[0] + 50 && autumn[2] < green[2] + 5, `autumn colours: ${autumn.map(Math.round)}`);
  assert.ok(leafTone(green, leafState(parseDate("04-20")))[1] > green[1], "light green in spring");
});

test("fixed weather: the presets, the ground they leave, and what others read", () => {
  const world = lab();
  const w = world.weather;
  assert.equal(world.setWeather("nonsense"), false);
  assert.ok(!w.on, "what is no weather changes nothing");
  for (const name of Object.keys(WEATHER_PRESETS)) {
    assert.ok(world.setWeather(name), name);
    assert.equal(w.mode, "fixed");
    assert.ok(w.describe().includes("°C"));
  }
  world.setWeather("snow");
  assert.equal(w.now().sky, "snow");
  assert.ok(w.now().snow_cm >= 4 && w.look().snow === 1, "snow lies");
  assert.deepEqual([w.walkFactor(), w.driveFactor(), w.railCondition()], [0.85, 0.7, "wet"]);
  assert.ok(w.cycleShare() < 0.15, "hardly anybody cycles in snow at −2 °C");
  world.setWeather("frost");
  assert.ok(w.now().ice && w.now().frost);
  assert.deepEqual([w.walkFactor(), w.driveFactor(), w.railCondition()], [0.7, 0.5, "ice"]);
  world.setWeather("rain");
  assert.equal(w.describe().split(" · ")[1], "rain");
  assert.deepEqual([w.walkFactor(), w.driveFactor(), w.railCondition()], [1, 0.9, "wet"]);
  const rain = w.cycleShare();
  world.setWeather("heavy-rain");
  assert.equal(w.now().sky, "heavy-rain");
  assert.ok(w.cycleShare() < rain);
  world.setWeather("heat");
  assert.equal(Math.round(w.now().temperature_c), 33);
  assert.deepEqual([w.cycleShare(), w.railCondition()], [1, "dry"]);
  assert.ok(w.comfort() < 0.5, "33 °C is not comfortable");
  world.setWeather("fog");
  assert.equal(w.now().sky, "fog");
  // quantities one by one, over a preset: rain that freezes
  world.setWeather({ preset: "rain", temperature_c: -3 });
  assert.equal(w.now().precipitation, "rain", "a named kind is kept (freezing rain)");
  assert.equal(w.railCondition(), "ice");
  world.setWeather({ temperature_c: 25, cloud: 0 });
  assert.equal(Math.round(w.now().temperature_c), 25);
  // off again: as if there had never been any
  world.setWeather("off");
  assert.deepEqual([w.on, w.walkFactor(), w.railCondition(), w.look()], [false, 1, "dry", null]);
  assert.equal(world.toJSON().weather, undefined, "what is set by hand is not saved");
});

test("the ground remembers: rain wets it and it dries; snow settles and melts", () => {
  const world = lab();
  const w = world.weather;
  world.setTime("12:00");
  world.setWeather({ preset: "clear", temperature_c: 18, wet: 0 });
  assert.equal(w.now().wet, 0);
  world.setWeather({ preset: "rain", wet: 0 });
  run(world, 120); // 24 clock minutes of rain
  const wet = w.now().wet;
  assert.ok(wet > 0.3, `wet ${wet.toFixed(2)}`);
  w.preset = "clear";
  w.state = { temperature_c: 18 };
  run(world, 600); // two clock hours of sun
  assert.ok(w.now().wet < wet - 0.2, "it dries in the sun");
  world.setWeather({ preset: "snow", snow_cm: 0 });
  assert.equal(w.now().snow_cm, 0);
  run(world, 600);
  const snow = w.now().snow_cm;
  assert.ok(snow > 2, `${snow.toFixed(1)} cm after two hours of snowfall`);
  w.preset = "clear";
  w.state = { temperature_c: 8 };
  run(world, 600);
  assert.ok(w.now().snow_cm < snow - 1.5, "it melts at 8 °C");
  assert.ok(w.now().wet > 0.3, "and leaves the ground wet");
});

test("a course over the day: key frames, in proportion between them; told when it starts to snow", () => {
  const world = lab([], { clock: { start: "04:00", date: "01-20" }, weather: { mode: "typical", course: [["05:00", { temperature_c: 1, precipitation: "none", cloud: 1 }], ["07:00", { temperature_c: -3, precipitation: "snow", rate_mm_h: 2 }], ["10:00", { temperature_c: -1, precipitation: "none" }]] } });
  const w = world.weather;
  assert.equal(w.air(minutes("06:00")).temperature_c, -1, "half way from 1 to −3");
  assert.equal(w.air(minutes("04:00")).temperature_c, 1, "before the first key frame: its values");
  assert.equal(w.air(minutes("08:00")).precipitation, "snow");
  assert.equal(w.air(minutes("11:00")).precipitation, "none");
  const told = [];
  world.events.on("weather.changed", ({ weather }) => told.push(weather.sky));
  world.speed = 30;
  while (world.clock.minutes < minutes("09:00")) world.step(0.1);
  assert.ok(told.includes("snow"), `told: ${told.join(", ")}`);
  assert.ok(w.now().snow_cm > 1, "snow lies by nine");
  // the layout's weather is saved as it was written
  assert.deepEqual(world.toJSON().weather, { mode: "typical", course: [["05:00", { temperature_c: 1, precipitation: "none", cloud: 1 }], ["07:00", { temperature_c: -3, precipitation: "snow", rate_mm_h: 2 }], ["10:00", { temperature_c: -1, precipitation: "none" }]] });
  assert.equal(world.toJSON().clock.date, "01-20");
});

test("the rails take the weather: wet in rain, leaves in November when damp, ice; a track's own condition and a disruption too", () => {
  const world = lab();
  const track = world.getObject("track-g1");
  assert.equal(railCondition(world, track), "dry");
  world.setWeather("rain");
  assert.equal(railCondition(world, track), "wet");
  world.setDate("11-10");
  assert.equal(world.weather.now().leaf.state, "falling");
  assert.equal(railCondition(world, track), "leaves", "leaf-fall weeks, damp");
  world.setWeather("clear");
  world.weather.ground.wet = 0;
  assert.equal(railCondition(world, track), "dry", "dry leaves do not stick");
  world.setDate("07-10");
  world.setWeather("rain");
  // the worse of the track's own and the weather's
  track.set({ rail_condition: "ice" });
  assert.equal(railCondition(world, track), "ice");
  track.set({ rail_condition: "dry" });
  assert.equal(railCondition(world, track), "wet");
  assert.ok(RAIL_CONDITIONS.wet.factor < RAIL_CONDITIONS.dry.factor);
});

test("fewer cyclists and fewer market visitors in rain; hot drinks in the cold; slower on snow", () => {
  const world = lab(["striezelmarkt", "market-visitors"]);
  world.setTime("18:00");
  const cycling = world.simulations.find((s) => s.constructor.type === "cycling");
  const market = world.simulations.find((s) => s.constructor.type === "market");
  const dryVisitors = market.present();
  const dryRiders = cycling ? cycling.targetCount() : null;
  assert.equal(market.weatherShare(), 1);
  assert.equal(market.hotDrinks(), 1);
  world.setWeather({ preset: "rain", temperature_c: 10 });
  assert.ok(market.present() < dryVisitors * 0.7, `${market.present()} of ${dryVisitors} visitors in rain`);
  if (cycling) assert.ok(cycling.targetCount() < dryRiders * 0.7, "fewer riders in rain");
  world.setWeather("snow");
  assert.equal(market.weatherShare(), 1, "snow keeps nobody from a Christmas market");
  assert.equal(market.hotDrinks(), 1.5);
  assert.equal(world.weather.walkFactor(), 0.85);
  // the town's people cover less ground on snow in the same time
  const walk = (preset) => {
    const w = lab();
    w.setTime("07:30");
    if (preset) w.setWeather(preset);
    const town = w.simulations.find((s) => s.constructor.type === "town");
    run(w, 30);
    const a = town.agents.find((x) => x.state === "walking" && x.path && x.s > 0);
    const s0 = a.s;
    town._walk(a, 1);
    return (a.s - s0) / a.speed;
  };
  assert.ok(Math.abs(walk("frost") / walk(null) - 0.7) < 1e-6, "× 0.7 on ice");
});

test("scenarios set the date and the weather; what is neither fails the step, and the layout check finds it", () => {
  const world = lab();
  const messages = [];
  world.events.on("scenario.message", ({ text }) => messages.push(text));
  world.scenarios.load([{ id: "winter", steps: [{ at: 0, set: { date: "12-06", time: "15:45", weather: "snow" } }] }]);
  world.scenarios.play("winter");
  world.step(0.1);
  assert.equal(world.clock.dateLabel(), "6 Dec");
  assert.equal(world.clock.label().slice(0, 4), "15:4");
  assert.equal(world.weather.now().sky, "snow");
  assert.deepEqual(messages, []);
  world.scenarios.load([{ id: "bad", steps: [{ at: 0, set: { date: "6 December" } }, { at: 1, set: { weather: "blizzard" } }] }]);
  world.scenarios.play("bad");
  run(world, 2);
  assert.equal(world.clock.dateLabel().slice(-3), "Dec", "the date stays");
  assert.equal(world.weather.preset, "snow", "the weather stays");
  assert.ok(messages.some((m) => /no date/.test(m)) && messages.some((m) => /no weather/.test(m)), messages.join(" | "));
  // the layout check
  const json = { ...withLayers(LAB, []), clock: { date: "31-12" }, weather: { mode: "sunny", preset: "blizzard", course: [["25:00", {}]], state: { precipitation: "hail" } } };
  json.scenarios = [{ id: "bad", steps: [{ at: 0, set: { date: "6.12.", weather: "blizzard" } }] }];
  const problems = validateLayout(json, registry).join("\n");
  for (const text of ['clock.date "31-12" is no date', 'weather.mode "sunny"', 'weather.preset "blizzard"', "weather.course[0]", 'precipitation "hail"', 'set.date "6.12." is no date', 'set.weather "blizzard" is no preset']) assert.ok(problems.includes(text), `${text} in\n${problems}`);
  assert.deepEqual(weatherProblems("snow"), []);
  assert.deepEqual(weatherProblems({ mode: "typical" }), []);
  // the lab example and its modules are sound
  assert.deepEqual(validateLayout(withLayers(LAB, ["striezelmarkt", "market-visitors"]), registry), []);
});

/** Homography of a pinhole camera at `eye` looking at `target` (layout mm). */
function lookAt(camera, eye, target) {
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const norm = (a) => a.map((v) => v / Math.hypot(...a));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const f = norm(sub(target, eye)), r = norm(cross(f, [0, 0, 1])), d = cross(f, r);
  const R = [r, d, f];
  const t = R.map((row) => -(row[0] * eye[0] + row[1] * eye[1] + row[2] * eye[2]));
  const { fx, fy, cx, cy } = camera.intrinsics;
  const K3 = (c) => [fx * c[0] + cx * c[2], fy * c[1] + cy * c[2], c[2]];
  const c0 = K3([R[0][0], R[1][0], R[2][0]]), c1 = K3([R[0][1], R[1][1], R[2][1]]), c2 = K3(t);
  return [c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]];
}

/** Draw a world through a fake canvas: the fill colours, the arcs (snowflakes) and line segments drawn in overlays. */
function draw(world) {
  const fills = [];
  let arcs = 0, lines = 0, rects = 0;
  const noop = () => {};
  const ctx = {
    canvas: { width: 1600, height: 900 }, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, globalAlpha: 1,
    save: noop, restore: noop, setTransform: noop, transform: noop, beginPath: noop, closePath: noop, stroke: noop, setLineDash: noop, strokeRect: noop,
    ellipse: noop, quadraticCurveTo: noop, arcTo: noop, clip: noop, fillText: noop, drawImage: noop, moveTo: noop,
    fillRect() { rects++; }, arc() { arcs++; }, lineTo() { lines++; }, fill() { fills.push(this.fillStyle); }, measureText: (t) => ({ width: t.length * 6 }),
    createRadialGradient: () => ({ addColorStop: noop }), createLinearGradient: () => ({ addColorStop: noop }),
  };
  const camera = new Camera(1600, 900);
  const view = new View({ ctx, camera, H: lookAt(camera, [500, -2600, 1500], [500, -900, 0]), scale: world.scale });
  world.draw(view);
  return { fills, arcs, lines, rects, view };
}

test("the weather in the picture: snow whitens the ground and the roofs, flakes and rain fall, the trees follow the season", () => {
  const white = (fills) => fills.filter((f) => {
    const m = String(f).match(/^rgba?\((\d+),(\d+),(\d+)/);
    return m && Number(m[1]) > 232 && Number(m[2]) > 236 && Number(m[3]) > 240;
  }).length;
  const world = lab();
  world.setTime("12:00");
  const plain = draw(world);
  assert.equal(plain.view.weather, null, "no weather: nothing for the view");
  world.setWeather("snow");
  const snow = draw(world);
  assert.equal(snow.view.weather.snow, 1);
  assert.ok(white(snow.fills) > white(plain.fills) + 100, `${white(snow.fills)} white fills in snow, ${white(plain.fills)} without`);
  assert.ok(snow.arcs > plain.arcs + 60, "snowflakes");
  // the view's tone: snow by the share a surface takes, wet darkens; no weather, no change
  assert.equal(plain.view.tone("#4a4f57"), "#4a4f57");
  assert.match(snow.view.tone("#4a4f57"), /^rgba\(244,247,250/);
  assert.notEqual(snow.view.tone("#4a4f57", 0.5), snow.view.tone("#4a4f57"));
  world.setWeather("heavy-rain");
  const rain = draw(world);
  assert.ok(rain.view.weather.wet > 0.9 && rain.view.weather.snow === 0);
  assert.ok(rain.lines > plain.lines + 100, "streaks of rain");
  assert.match(rain.view.tone("#808080"), /^rgba\(1\d\d,/, "wet ground is darker");
  // with reduced motion the rain stands still: two frames, the same streaks
  world.settings.weatherStill = true;
  assert.equal(world.weather.look().still, true);
  // the Map and 2.5D show no weather
  world.setWeather("snow");
  const camera = new Camera(800, 600), simple = new SimpleView({ ctx: snow.view.ctx, camera, H: [1, 0, 0, 0, 1, 0, 0, 0, 1], scale: world.scale });
  world.draw(simple);
  assert.equal(simple.weather, null);
  // the season: bare trees in January, coloured ones in October (the lab has deciduous trees)
  world.setWeather("clear");
  world.setDate("01-15");
  assert.equal(draw(world).view.weather.leaf.state, "bare");
  world.setDate("10-25");
  const october = draw(world);
  assert.equal(october.view.weather.season, "autumn");
  const autumnal = (fills) => fills.filter((f) => {
    const m = String(f).match(/^rgba?\((\d+),(\d+),(\d+)/);
    return m && Number(m[1]) > 150 && Number(m[1]) > Number(m[2]) + 15 && Number(m[3]) < 90;
  }).length;
  assert.ok(autumnal(october.fills) > autumnal(plain.fills) + 5, "yellow and orange crowns");
});
