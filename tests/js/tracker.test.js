import assert from "node:assert/strict";
import test from "node:test";

import { Camera } from "../../web/arail/core/camera.js";
import { MarkerDetector } from "../../web/arail/core/detector.js";
import { applyH, toDeg, wrapAngle } from "../../web/arail/core/math.js";
import { MarkerMap, PlaneTracker } from "../../web/arail/core/tracker.js";
import { FIXTURE_HINT, fixtureImage, fixtureMeta, hasFixtures, loadAruco, median } from "./helpers.js";

const skip = hasFixtures() ? false : FIXTURE_HINT;

/** Platform quad between two markers (as the platform object computes it), in layout mm. */
function platformQuad(a, b, width) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
  const n = [-dy / l, dx / l];
  const h = width / 2;
  return [
    [a[0] - n[0] * h, a[1] - n[1] * h], [b[0] - n[0] * h, b[1] - n[1] * h],
    [b[0] + n[0] * h, b[1] + n[1] * h], [a[0] + n[0] * h, a[1] + n[1] * h],
  ];
}

/** Run the synthetic camera flight through detector + tracker. */
function fly({ poses = {}, survey = true } = {}) {
  const meta = fixtureMeta();
  const [pw, ph] = meta.flight_size, [W, H] = meta.image_size;
  const detector = new MarkerDetector({ ...loadAruco(), dictionary: "ARUCO" });
  const map = new MarkerMap({ size: meta.marker_size_mm, poses, origin: 0 });
  const tracker = new PlaneTracker(map, { survey });
  const camera = new Camera(W, H);
  const errors = [[], []];
  let tracked = 0;
  const truth = meta.true_poses;
  const truePlatforms = [[truth[0], truth[1]], [truth[2], truth[3]]];
  meta.flight.forEach((frame, i) => {
    const detections = detector.detect(fixtureImage(`flight_${String(i).padStart(2, "0")}.rgba`, pw, ph), W / pw);
    const state = tracker.update(detections, i / 7.5, camera);
    if (!state.H) return;
    tracked++;
    [[0, 1], [2, 3]].forEach(([ia, ib], j) => {
      if (!map.has(ia) || !map.has(ib)) return;
      const ea = map.get(ia), eb = map.get(ib);
      const width = meta.platform_widths_mm[j];
      const est = platformQuad([ea.x, ea.y], [eb.x, eb.y], width).map((p) => applyH(state.H, p));
      const [ta, tb] = truePlatforms[j];
      const tru = platformQuad(ta, tb, width).map((p) => applyH(frame.H, p));
      errors[j].push(Math.max(...est.map((p, k) => Math.hypot(p[0] - tru[k][0], p[1] - tru[k][1]))));
    });
  });
  return { meta, map, tracker, camera, errors, tracked };
}

test("tracker surveys an unknown layout and follows it through occlusions", { skip }, () => {
  const { meta, map, camera, errors, tracked } = fly();
  assert.equal(tracked, meta.flight.length, "tracked in every frame, also while markers are hidden");
  const truth = meta.true_poses;
  for (const id of map.ids()) {
    const e = map.get(id), t = truth[id];
    const dPos = Math.hypot(e.x - t[0], e.y - t[1]);
    const dRot = Math.abs(toDeg(wrapAngle(e.theta - (t[2] * Math.PI) / 180)));
    assert.ok(dPos < 8, `marker ${id}: surveyed ${dPos.toFixed(1)} mm from its true position`);
    assert.ok(dRot < 1.5, `marker ${id}: rotation off by ${dRot.toFixed(2)} deg`);
  }
  for (const [j, e] of errors.entries()) {
    // an unknown marker must be seen in 3 frames before the survey uses it
    assert.ok(e.length >= meta.flight.length - 2, `platform ${j + 1} visible after the survey warm-up`);
    assert.ok(median(e) < 2, `platform ${j + 1}: median corner error ${median(e).toFixed(2)} px`);
    assert.ok(Math.max(...e) < 4, `platform ${j + 1}: max corner error ${Math.max(...e).toFixed(2)} px`);
  }
  assert.equal(camera.focalSource, "estimated");
  assert.ok(Math.abs(camera.focal - meta.f_true) / meta.f_true < 0.03, `focal length ${camera.focal.toFixed(0)} px`);
});

test("tracker with a known marker map is accurate from the first frame", { skip }, () => {
  const meta = fixtureMeta();
  const { errors, tracked, map } = fly({ poses: meta.true_poses, survey: false });
  assert.equal(tracked, meta.flight.length);
  assert.equal(map.get(1).fixed, true);
  for (const e of errors) {
    assert.ok(median(e) < 1.5, `median corner error ${median(e).toFixed(2)} px`);
    assert.ok(Math.max(...e) < 3, `max corner error ${Math.max(...e).toFixed(2)} px`);
  }
});

test("marker map JSON round trip and rebasing", () => {
  const map = new MarkerMap({ size: 30, poses: { 3: [100, 50, 90] } });
  map.set(5, { x: 200, y: 50, theta: Math.PI / 2 });
  const json = map.toJSON();
  assert.deepEqual(json[3], [100, 50, 90]);
  assert.deepEqual(json[5], [200, 50, 90]);
  map.rebase(3);
  const e = map.get(5);
  assert.ok(Math.abs(e.x - 0) < 1e-9 && Math.abs(e.y + 100) < 1e-9, `rebased: ${e.x}, ${e.y}`);
  map.clear();
  assert.deepEqual(map.ids(), [3], "fixed poses survive clear()");
});

test("a single photo is surveyed immediately", { skip }, () => {
  const meta = fixtureMeta();
  if (!meta.example_size) return;
  const [w, h] = meta.example_size;
  const detector = new MarkerDetector({ ...loadAruco(), dictionary: "ARUCO" });
  const detections = detector.detect(fixtureImage("example.rgba", w, h));
  const map = new MarkerMap({ size: 30, origin: 0 });
  const tracker = new PlaneTracker(map);
  const camera = new Camera(w, h);
  const state = tracker.update(detections, 0, camera, { still: true });
  assert.ok(state.H, "pose from a single frame");
  assert.ok(map.ids().length >= 6, `surveyed markers: ${map.ids()}`);
  const d01 = Math.hypot(map.get(1).x, map.get(1).y);
  assert.ok(Math.abs(d01 - meta.platform_length_mm) < 0.04 * meta.platform_length_mm, `platform length ${d01.toFixed(1)} mm`);
});

/* ---------------------------------------------------------------- locked map, moving markers */

/** Image corners of markers at layout poses (x, y, rotation_deg) under a homography (no image needed). */
function detectionsAt(H, poses, size = 30) {
  const out = {};
  for (const [id, [x, y, deg]] of Object.entries(poses)) {
    const th = (deg * Math.PI) / 180, h = size / 2;
    out[id] = [[-h, h], [h, h], [h, -h], [-h, -h]].map(([u, v]) => applyH(H, [x + u * Math.cos(th) - v * Math.sin(th), y + u * Math.sin(th) + v * Math.cos(th)]));
  }
  return out;
}

// a camera looking obliquely at the layout: layout (mm) -> image (px)
const VIEW_H = [0.9, 0.12, 420, 0.05, -0.55, 380, 0.00004, 0.0003, 1];
const KNOWN = { 0: [0, 0, 0], 1: [400, 0, 0], 2: [0, 250, 15], 3: [400, 250, -10] };

test("a locked marker map surveys nothing: unknown markers are ignored, fixed poses stay", () => {
  const map = new MarkerMap({ size: 30, poses: KNOWN, origin: 0, locked: true });
  const tracker = new PlaneTracker(map);
  const camera = new Camera(1280, 720);
  const scene = { ...KNOWN, 7: [220, 120, 40] }; // marker 7 is not in the map
  const before = map.toJSON(), version = map.version;
  for (let i = 0; i < 6; i++) {
    const state = tracker.update(detectionsAt(VIEW_H, scene), i / 30, camera);
    assert.deepEqual(state.used, [0, 1, 2, 3]);
    assert.deepEqual(state.visible, [0, 1, 2, 3, 7]);
  }
  assert.deepEqual(map.ids(), [0, 1, 2, 3], "marker 7 is not added");
  assert.deepEqual(map.toJSON(), before);
  assert.equal(map.version, version, "nothing was refined");
  // a misread or moved marker of the map is dropped from the pose as an outlier
  const misread = { ...scene, 2: [60, 210, 15] };
  const state = tracker.update(detectionsAt(VIEW_H, misread), 1, camera, { still: true });
  assert.deepEqual(state.used, [0, 1, 3]);
  // unlocked, marker 7 is surveyed again
  map.unlock();
  for (let i = 0; i < 4; i++) tracker.update(detectionsAt(VIEW_H, scene), 2 + i / 30, camera);
  assert.ok(map.has(7));
  const e = map.get(7);
  assert.ok(Math.hypot(e.x - 220, e.y - 120) < 1, `marker 7 surveyed at ${e.x.toFixed(1)}, ${e.y.toFixed(1)}`);
  // "Measure again" unlocks
  map.lock();
  tracker.resurvey();
  assert.equal(map.locked, false);
});

test("moving markers are never part of the map; their detections are reported on the layout plane", () => {
  const map = new MarkerMap({ size: 30, poses: { ...KNOWN, 40: [10, 10, 0] }, origin: 0, moving: [40, 41] });
  assert.deepEqual(map.ids(), [0, 1, 2, 3], "a pose of a moving marker in the file is ignored");
  const tracker = new PlaneTracker(map);
  const camera = new Camera(1280, 720);
  const scene = { ...KNOWN, 40: [250, -100, 45] };
  let state;
  for (let i = 0; i < 6; i++) state = tracker.update(detectionsAt(VIEW_H, scene), i / 30, camera);
  assert.deepEqual(map.ids(), [0, 1, 2, 3], "moving marker 40 is not surveyed");
  assert.deepEqual(state.used, [0, 1, 2, 3]);
  assert.deepEqual(state.visible, [0, 1, 2, 3], "moving markers are reported separately");
  const m = state.moving[40];
  assert.ok(m && m.corners.length === 4);
  assert.ok(Math.hypot(m.center[0] - 250, m.center[1] + 100) < 0.5, `centre ${m.center}`);
  assert.ok(Math.abs(toDeg(wrapAngle(m.heading - Math.PI / 4))) < 0.5, `heading ${toDeg(m.heading)}`);
  // without a pose, only the image corners
  const lost = new PlaneTracker(new MarkerMap({ size: 30, moving: [40] }), { survey: false });
  const s2 = lost.update(detectionsAt(VIEW_H, { 40: [0, 0, 0] }), 0, camera);
  assert.equal(s2.H, null);
  assert.deepEqual(s2.moving[40].center, null);
  // making a map marker a moving one removes it from the map
  assert.deepEqual(map.setMoving([1, 40]), [1]);
  assert.deepEqual(map.ids(), [0, 2, 3]);
  state = tracker.update(detectionsAt(VIEW_H, { ...KNOWN, 40: [250, -100, 45] }), 1, camera);
  assert.deepEqual(state.used, [0, 2, 3]);
  assert.deepEqual(Object.keys(state.moving).map(Number), [1, 40]);
});

test("a locked map needs only the detector codes up to its highest marker ID", () => {
  const map = new MarkerMap({ size: 30, poses: { 0: [0, 0, 0], 4: [100, 0, 0] } });
  assert.equal(map.detectionCodes(50), 50, "unlocked: all codes of the layout");
  map.lock();
  assert.equal(map.detectionCodes(50), 5);
  assert.ok([...map.entries.values()].every((e) => e.fixed), "Keep positions fixes, too");
  map.setMoving([40]);
  assert.equal(map.detectionCodes(50), 41, "moving markers must be detected, too");
  assert.equal(map.detectionCodes(30), 30, "never more than the layout's codes");
  map.unlock();
  assert.equal(map.detectionCodes(50), 50);
  assert.equal(new MarkerMap({ locked: true }).detectionCodes(50), 50, "an empty locked map keeps all codes");
});
