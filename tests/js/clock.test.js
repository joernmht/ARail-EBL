import assert from "node:assert/strict";
import test from "node:test";

import { Clock, createWorld, daylightAt, formatTime, parseTime, profileAt, PROFILES } from "../../web/arail/index.js";

test("clock: times are parsed, formatted and wrapped", () => {
  assert.equal(parseTime("07:30"), 450);
  assert.equal(parseTime("7"), 420);
  assert.equal(parseTime("24:00"), 0);
  assert.equal(parseTime("25:00"), null);
  assert.equal(parseTime("noon"), null);
  assert.equal(formatTime(450), "07:30");
  assert.equal(formatTime(-30), "23:30");
  assert.equal(formatTime(1440 + 61), "01:01");
});

test("clock: the fast clock runs `factor` times faster and counts days", () => {
  const c = new Clock({ start: "23:00", factor: 12 });
  assert.equal(c.label(), "23:00");
  assert.equal(c.advance(150), false); // 150 s * 12 = 30 min
  assert.equal(c.label(), "23:30");
  assert.equal(c.advance(300), true); // past midnight
  assert.equal(c.label(), "00:30");
  assert.equal(c.day, 1);
  c.frozen = true;
  c.advance(1000);
  assert.equal(c.label(), "00:30");
  assert.ok(Math.abs(new Clock({ start: "06:00", factor: 12 }).secondsUntil("07:00") - 300) < 1e-9);
});

test("clock: daylight, night and demand profiles", () => {
  assert.equal(daylightAt(12 * 60), 1);
  assert.equal(daylightAt(2 * 60), 0);
  const dusk = daylightAt(20 * 60 + 30);
  assert.ok(dusk > 0.3 && dusk < 0.7, `twilight ${dusk}`);
  assert.equal(profileAt(PROFILES.rail, 3 * 60), 0, "no trains at night");
  assert.equal(profileAt(PROFILES.rail, 7 * 60), 1.5, "rush hour");
  assert.equal(profileAt(PROFILES.rail, 12 * 60), 1);
  const c = new Clock({ start: "03:00" });
  assert.equal(c.demand("rail"), 0);
  assert.equal(new Clock({ start: "03:00", profiles: false }).demand("rail"), 1);
  assert.equal(c.demand("unknown"), 1);
});

test("clock: layouts carry their clock settings; no trains during the night break", () => {
  const world = createWorld({
    objects: [{ id: "p", type: "platform", from: [0, 0], to: [800, 0], sides: "both" }],
    simulations: [],
    clock: { start: "02:00", factor: 12 },
  });
  assert.equal(world.clock.label(), "02:00");
  assert.deepEqual(world.toJSON().clock, { start: "02:00", factor: 12, profiles: true });
  let arrivals = 0;
  world.events.on("vehicle.arrived", () => arrivals++);
  world.speed = 10;
  for (let i = 0; i < 600; i++) world.step(0.1); // 600 s simulated = 2 clock hours
  assert.equal(world.clock.label(), "04:00");
  assert.equal(arrivals, 0);
  assert.ok(world.night() > 0.99);
  world.settings.lighting = false;
  assert.equal(world.night(), 0);
});
