// The photo tour (web/app/tour.js): the photo map's photos as a Street View of the lab: parts of
// the table round the ring, at most one photo per perspective, left and right in the same
// perspective where the next part has it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PERSPECTIVES, PhotoTour, perspectiveOf } from "../../web/app/tour.js";

const DATA = JSON.parse(readFileSync(new URL("../../web/lab-map/data.json", import.meta.url), "utf8"));

/** A small hall: two straight sides and an end, each part with photos from several sides. */
function hall() {
  const photo = (id, group, x, y, heading, extra = {}) => ({ id, group, x, y, heading, markers: 4, place: group, ...extra });
  return {
    layers: { a: { layout: "a.json", label: "A" } },
    groups: { W: { name: "West end" }, N1: { name: "North 1" }, N2: { name: "North 2" }, E: { name: "East end" }, S1: { name: "South 1" } },
    photos: [
      // the ends of the hall: their front looks out of it
      photo("w-front", "W", 0, -1000, 180),
      photo("e-front", "E", 10000, -1000, 0),
      // along the top (windows), the middle of the hall below: the front looks up (90°)
      photo("n1-front", "N1", 3000, 1000, 92),
      photo("n1-front-2", "N1", 3600, 1000, 80, { layer: "a" }),
      photo("n1-back", "N1", 3000, 1000, -88),
      photo("n1-fl", "N1", 3000, 1000, 45),
      photo("n2-front", "N2", 7000, 1000, 95),
      photo("n2-fr", "N2", 7000, 1000, 135),
      // along the bottom: the front looks down (-90°)
      photo("s1-front", "S1", 7000, -3000, -90),
      photo("s1-back", "S1", 7000, -3000, 90),
      photo("s1-none", "S1", 7000, -3000, null),
    ],
  };
}

test("a view direction belongs to one of six perspectives, 60° each", () => {
  assert.equal(PERSPECTIVES.length, 6);
  assert.deepEqual([0, 29, -30, 31, -60, 89, -91, 120, -150, 151, 180, -179].map(perspectiveOf),
    ["front", "front", "front", "front-right", "front-left", "front-right", "back-left", "back-right", "back", "back", "back", "back"]);
});

test("parts go round the ring clockwise, each with its front towards the middle of the hall", () => {
  const t = new PhotoTour(hall());
  assert.deepEqual(t.parts.map((p) => p.id), ["W", "N1", "N2", "E", "S1"]);
  assert.deepEqual(t.parts.map((p) => Math.round(p.front)), [180, 90, 90, 0, -90]);
  assert.equal(t.parts[1].name, "North 1");
});

test("one photo per perspective: the one with a digital layer, else the one looking most nearly that way", () => {
  const t = new PhotoTour(hall());
  const n1 = t.parts[1].views;
  assert.equal(n1.front.id, "n1-front-2"); // with the layer, though 10° off and not in the middle
  assert.equal(n1.back.id, "n1-back");
  assert.equal(n1["front-left"].id, "n1-fl"); // looking 45° to the right: the camera stands at the front left
  assert.ok(!t.photos().some((p) => p.id === "s1-none")); // a photo without a direction is not in the tour
});

test("left and right keep the perspective where the next part has it, else the nearest one", () => {
  const t = new PhotoTour(hall());
  // from the front, right is the next part clockwise
  assert.equal(t.step(1, "front", 1), 2);
  assert.deepEqual(t.view(2, "front"), { part: 2, photo: t.parts[2].views.front, perspective: "front", exact: true });
  // N2 has no front-left: the nearest on the same side is the front, not the back
  assert.equal(t.view(2, "front-left").perspective, "front");
  assert.equal(t.view(2, "front-left").exact, false);
  // from the back, right is the part before (the camera looks the other way); the ring is closed
  assert.equal(t.step(2, "back", 1), 1);
  assert.equal(t.step(0, "back", 1), 4);
  assert.equal(t.step(4, "front", 1), 0);
  assert.equal(t.view(4, "back").photo.id, "s1-back");
});

test("find a photo, and the home of a layer", () => {
  const t = new PhotoTour(hall());
  assert.deepEqual(t.find("n2-fr"), { part: 2, perspective: "front-right" }); // looking left
  assert.equal(t.find("s1-none"), null);
  assert.equal(t.home("a"), 1);
  assert.equal(t.home("nothing"), -1);
});

test("the lab: at most six photos per part, the parts in the order of the ring", () => {
  const t = new PhotoTour(DATA);
  for (const part of t.parts) {
    const views = Object.values(part.views);
    assert.ok(views.length >= 1 && views.length <= 6, part.id);
    assert.equal(new Set(views.map((p) => p.id)).size, views.length);
  }
  // round the ring (examples/ebl/topology.json, ring_order), starting anywhere
  const ring = ["S15", "S14", "S13", "S01", "S02", "S03", "S04", "S10", "S11", "S12", "S09", "S06", "S08", "S07", "S05"];
  const ids = t.parts.map((p) => p.id), k = ring.indexOf(ids[0]);
  assert.deepEqual(ids, [...ring.slice(k), ...ring.slice(0, k)]);
  // Bf Neustadt: its home is the part with the platforms, every photo of the tour there has the digital layer
  const home = t.home("neustadt");
  assert.equal(t.parts[home].id, "S03");
  for (const id of ["S01", "S02", "S03", "S04"]) assert.ok(Object.values(t.parts.find((p) => p.id === id).views).every((p) => p.layer === "neustadt"), id);
  assert.equal(t.parts[t.home("container")].id, "S12");
  // from the front, right goes towards Waldhof
  assert.equal(t.parts[t.step(home, "front", 1)].id, "S04");
  assert.equal(t.parts[t.step(home, "front", -1)].id, "S02");
});
