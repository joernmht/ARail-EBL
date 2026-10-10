// Vehicles and trains (rail/vehicles.js, rail/trains.js): the catalogue, a consist's length, mass,
// axles, top speed, brake position and brake percentage (Bremshundertstel), axle and metre loads,
// isolated brakes, the layout's consists and own vehicle types, and the train data on the info card.
import assert from "node:assert/strict";
import test from "node:test";

import { Camera, Consist, FlyCamera, View, VEHICLE_TYPES, consistFor, consistRows, createWorld, movingPickables, registry, toRad, validateLayout } from "../../web/arail/index.js";
import { readJSON } from "./helpers.js";

test("the catalogue: every vehicle has what the figures of a train need", () => {
  for (const [id, t] of Object.entries(VEHICLE_TYPES)) {
    assert.ok(t.label && t.kind, `${id}: label and kind`);
    for (const k of ["length_m", "mass_t", "axles", "vmax_kmh"]) assert.ok(t[k] > 0, `${id}: ${k}`);
    assert.ok(t.brake_t && Object.values(t.brake_t).every((b) => b > 0), `${id}: brake weights`);
    if (t.kind === "wagon") assert.ok(t.load_t > 0 && t.brake_loaded_t, `${id}: load and the load-dependent brake`);
    // axle loads within line category E (25 t) when fully loaded
    assert.ok((t.mass_t + (t.load_t || 0)) / t.axles <= 25, `${id}: axle load`);
  }
});

test("a passenger train: length, mass, axles, top speed, brake percentage in R", () => {
  const c = new Consist({ vehicles: [{ type: "br146" }, { type: "dbpza", count: 4 }] });
  assert.equal(c.vehicles.length, 5);
  assert.equal(c.brakePosition, "R", "coaches with an R brake weight: R");
  assert.ok(Math.abs(c.length_m - (18.9 + 4 * 26.8)) < 1e-9);
  assert.equal(c.mass_t, 85 + 4 * 49);
  assert.equal(c.axles, 20);
  assert.equal(c.vmax.kmh, 160);
  assert.equal(new Consist({ vehicles: [{ type: "br193" }, { type: "eanos" }] }).vmax.by, VEHICLE_TYPES.eanos.label, "the slowest vehicle limits it");
  // brake weights / mass × 100
  assert.ok(Math.abs(c.brakePercentage - ((105 + 4 * 75) / (85 + 4 * 49)) * 100) < 1e-9);
  assert.equal(c.summary, "BR 146.2 + 4 × DBpza");
  const rows = Object.fromEntries(consistRows(c));
  assert.equal(rows["Brake percentage"], `${Math.round(c.brakePercentage)} %`);
  assert.equal(rows.Axles, "20");
});

test("a freight train: G by default, load-dependent brakes, isolated brakes lower the brake percentage", () => {
  const empty = new Consist({ vehicles: [{ type: "br185" }, { type: "sgns", count: 20 }] });
  const full = new Consist({ vehicles: [{ type: "br185" }, { type: "sgns", count: 20, loaded: true }] });
  assert.equal(full.brakePosition, "G");
  assert.equal(full.mass_t, 85 + 20 * 90);
  assert.ok(Math.abs(full.brakeWeight_t - (64 + 20 * 58)) < 1e-9);
  assert.ok(empty.brakePercentage > full.brakePercentage, "an empty train brakes better per tonne");
  assert.ok(Math.abs(full.maxAxleLoad.t - 22.5) < 1e-9, "a full Sgns: 22.5 t per axle");
  const isolated = new Consist({ vehicles: [{ type: "br185" }, { type: "sgns", count: 20, loaded: true, isolated: 2 }] });
  assert.equal(isolated.isolated, 2);
  assert.ok(Math.abs(full.brakePercentage - isolated.brakePercentage - (2 * 58 / full.mass_t) * 100) < 1e-9);
  assert.match(Object.fromEntries(consistRows(isolated))["Brake percentage"], /2 brakes isolated/);
  // half loaded: between the two
  const half = new Consist({ vehicles: [{ type: "sgns", loaded: 0.5 }] });
  assert.equal(half.mass_t, 20 + 35);
  assert.equal(Consist.brakeWeightOf(half.vehicles[0], "G"), 20 + (58 - 20) / 2);
  // a position a vehicle does not have: the nearest slower one, else the nearest faster one
  assert.equal(Consist.brakeWeightOf(new Consist({ vehicles: [{ type: "dbpza" }] }).vehicles[0], "G"), 55);
  assert.equal(Consist.brakeWeightOf(new Consist({ vehicles: [{ type: "dbpza" }] }).vehicles[0], "R+Mg"), 75);
  // unknown types are reported
  assert.deepEqual(new Consist({ vehicles: [{ type: "nope" }] }).unknown, ["nope"]);
});

test("the layout's consists by line and train number, the units of the rail operations, its own vehicle types", () => {
  const world = createWorld({
    vehicle_types: { mytype: { label: "My railcar", kind: "railcar", length_m: 20, mass_t: 40, axles: 4, vmax_kmh: 100, brake_t: { R: 50 } } },
    consists: [
      { id: "re", lines: ["RE 1"], vehicles: [{ type: "br146" }, { type: "dbpza", count: 3 }] },
      { id: "ice", trains: ["ICE 70"], vehicles: [{ type: "mytype", count: 2 }] },
    ],
  });
  assert.equal(consistFor(world, { line: "RE 1" }).id, "re");
  assert.equal(consistFor(world, { line: "RE 1 → Altstadt 07:15" }).id, "re", "the label of a train of the rail operations");
  assert.equal(consistFor(world, { line: "RE 10" }), null);
  assert.equal(consistFor(world, { train: "ICE 70" }).mass_t, 80, "the layout's own type");
  assert.equal(consistFor(world, { units: [{ type: "et442" }, { type: "et442" }] }).vehicles.length, 2);
  // kept in the layout file
  const json = world.toJSON();
  assert.equal(json.consists.length, 2);
  assert.equal(json.vehicle_types.mytype.label, "My railcar");
  assert.equal(createWorld({}).toJSON().consists, undefined, "not written when there are none");
  // validation names unknown vehicle types
  const problems = validateLayout({ consists: [{ id: "x", lines: ["S 1"], vehicles: [{ type: "unknown-loco" }] }], objects: [] }, registry);
  assert.ok(problems.some((p) => /unknown-loco/.test(p)), problems.join("\n"));
});

test("the info card of a train of the lab example: its train data, against the brake percentage its track requires", () => {
  const json = readJSON("web/layouts/ebl-lab.json");
  const world = createWorld(json);
  world.getObject("track-g2").set({ min_brake_percentage: 400 });
  world.services.call("platform-1:left");
  for (let i = 0; i < 100; i++) world.step(0.1);
  const camera = new Camera(1280, 720);
  const cam = new FlyCamera({ target: [700, 0], distance: 2000, yaw: Math.PI / 2, pitch: toRad(50) });
  const { H, focal, pose } = cam.homography(1280, 720);
  camera.setManualFocal(focal);
  const view = new View({ ctx: null, camera, H, pose, scale: 87, virtual: true });
  const trains = movingPickables(world, view).filter((p) => p.kind === "train");
  assert.ok(trains.length, "a train at a platform");
  for (const p of trains) {
    const card = world.card(p);
    const data = card.sections.find((s) => s.title === "Train data");
    assert.ok(data?.rows?.length, `${p.label}: train data`);
    assert.ok(card.strip?.length, "the consist as a strip");
    const rows = Object.fromEntries(data.rows);
    assert.ok(rows.Mass && rows["Brake percentage"] && rows.Consist);
    if (p.ref.dock.track === "G2") {
      assert.match(rows["Required on this track"], /400 % · not met/);
      assert.equal(card.tone, "warn");
    }
  }
});
