import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("clock: the demand table of docs/day-and-night.md matches PROFILES", () => {
  // read the table itself, so that the docs and the profiles cannot drift apart
  const md = readFileSync(new URL("../../docs/day-and-night.md", import.meta.url), "utf8").split("\n");
  const head = md.findIndex((l) => l.startsWith("| Time | Trains and buses | Cars | Random passengers |"));
  assert.ok(head >= 0, "the demand table is in the docs");
  const rows = [];
  for (let i = head + 2; md[i]?.startsWith("|"); i++) rows.push(md[i].split("|").slice(1, -1).map((c) => c.trim()));
  assert.ok(rows.length >= 5, "the demand table has its rows");
  const minutes = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const COLUMNS = [null, ["rail", "bus"], ["car"], ["passengers"]], NAMES = { trains: "rail", buses: "bus" };
  const near = (v, x) => Math.abs(v - Number(x)) < 0.05; // the table rounds to one decimal
  for (const [time, ...cells] of rows) {
    const range = time.match(/^(\d\d:\d\d)–(\d\d:\d\d)$/) || time.match(/^from (\d\d:\d\d)()$/);
    assert.ok(range, `time range "${time}"`);
    const t0 = minutes(range[1]), t1 = Math.min(range[2] ? minutes(range[2]) : 1440, 1439.99);
    const samples = (kind) => Array.from({ length: Math.ceil((t1 - t0) / 15) + 1 }, (_, i) => profileAt(PROFILES[kind], Math.min(t0 + i * 15, t1)));
    cells.forEach((cell, i) => {
      // a cell is one claim for the column's kinds, or "trains …, buses …"
      const claims = /^(trains|buses) /.test(cell) ? cell.split(", ").map((part) => [[NAMES[part.split(" ")[0]]], part.replace(/^\w+ /, "")]) : [[COLUMNS[i + 1], cell]];
      for (const [kinds, claim] of claims) {
        for (const kind of kinds) {
          const v = samples(kind), what = `${time}, ${kind}: "${claim}" (profile ${v.map((x) => x.toFixed(2)).join(" ")})`;
          let m;
          if (claim === "no service") assert.ok(v.every((x) => x === 0), what);
          else if (claim === "almost none") assert.ok(v.every((x) => x <= 0.05), what);
          else if ((m = claim.match(/^up to ([\d.]+)$/))) assert.ok(near(Math.max(...v), m[1]), what);
          else if ((m = claim.match(/^([\d.]+) → ([\d.]+)$/))) assert.ok(near(v[0], m[1]) && near(v.at(-1), m[2]), what);
          else if ((m = claim.match(/^([\d.]+)$/))) assert.ok(v.every((x) => near(x, m[1])), what);
          else assert.fail(`unknown claim ${what}`);
        }
      }
    });
  }
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
