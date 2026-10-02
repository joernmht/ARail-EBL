// Rolling-stock markers in the core: the second marker family in the detector (detectAll), the
// camera centre and plane homographies above the layout, and lifting tags to the deck plane.
import assert from "node:assert/strict";
import test from "node:test";

import { Camera } from "../../web/arail/core/camera.js";
import { acceptedBitErrors, MarkerDetector, markerBits } from "../../web/arail/core/detector.js";
import { FlyCamera } from "../../web/arail/core/flycam.js";
import { cameraCentre, planeHomography, poseFromHomography } from "../../web/arail/core/geometry.js";
import { applyH, toDeg, toRad, wrapAngle } from "../../web/arail/core/math.js";
import { MarkerMap, PlaneTracker } from "../../web/arail/core/tracker.js";
import { FIXTURE_HINT, fixtureImage, fixtureMeta, hasFixtures, loadAruco } from "./helpers.js";
import { rasterMarkers, squareCorners } from "./raster.js";

const skip = hasFixtures() ? false : FIXTURE_HINT;
const aruco = loadAruco();
const W = 1280, H = 720;
const ROLLING = { dictionary: "APRILTAG_36h11", codes: 64, maxBitErrors: 3 };
const DECK_MM = 15, TAG_MM = 20, MARKER_MM = 30;

/** Layout markers (ArUco Original, 30 mm, on the table): ID -> [x_mm, y_mm, rotation_deg]. */
const INFRA = { 0: [-200, -90, 10], 1: [190, -80, -25], 2: [-230, 170, 40], 3: [220, 160, 95] };
/** Rolling-stock tags (AprilTag 36h11, 20 mm, 15 mm above the table): ID -> [x_mm, y_mm, heading_deg]. */
const TAGS = {};
for (let k = 0; k < 6; k++) TAGS[k] = [-175 + 70 * k, 40 + (k % 2 ? 10 : -10), 5 + 13 * k];

/** Flyover camera at 500 mm, pitch 50°, and a real camera with the same focal length. */
function cameras() {
  const fly = new FlyCamera({ target: [0, 0], distance: 500, yaw: Math.PI / 2, pitch: toRad(50) });
  const camera = new Camera(W, H);
  camera.setManualFocal(fly.focal(H)); // after setSize, which resets it
  return { fly, camera };
}

/** True image corners of the layout markers and the tags. */
function truth(fly, infra = INFRA, tags = TAGS) {
  const markers = {}, rolling = {};
  for (const [id, [x, y, d]] of Object.entries(infra)) markers[id] = squareCorners(fly, [x, y], toRad(d), MARKER_MM, 0, W, H);
  for (const [id, [x, y, d]] of Object.entries(tags)) rolling[id] = squareCorners(fly, [x, y], toRad(d), TAG_MM, DECK_MM, W, H);
  return { markers, rolling };
}

/** Synthetic camera image of the scene (blurred and noisy, deterministic). */
function scene(fly, { infra = INFRA, tags = TAGS, seed = 1, blur = 0.7, noise = 3, bits = {} } = {}) {
  const t = truth(fly, infra, tags), markers = [];
  for (const id in t.markers) markers.push({ bits: markerBits(aruco.AR, "ARUCO", +id), corners: t.markers[id] });
  for (const id in t.rolling) markers.push({ bits: bits[id] || markerBits(aruco.AR, "APRILTAG_36h11", +id), corners: t.rolling[id] });
  return rasterMarkers({ width: W, height: H, markers, blur, noise, seed });
}

/** Largest corner distance (px) between detections and the truth, per ID. */
function cornerErrors(found, expected) {
  const out = {};
  for (const id in found) out[id] = Math.max(...found[id].map((p, k) => Math.hypot(p[0] - expected[id][k][0], p[1] - expected[id][k][1])));
  return out;
}

/** 30 tags in a grid, turned differently in every frame. */
function tagGrid(frame) {
  const tags = {};
  for (let k = 0; k < 30; k++) tags[k] = [-250 + 100 * (k % 6), -120 + 70 * Math.floor(k / 6), 17 * k + 7 * frame];
  return tags;
}

const ids = (o) => Object.keys(o).map(Number).sort((a, b) => a - b);

/* ---------------------------------------------------------------- detection */

test("detectAll reads layout markers and rolling-stock tags in their own namespaces", () => {
  const { fly } = cameras();
  const img = scene(fly), t = truth(fly);
  const det = new MarkerDetector({ ...aruco, dictionary: "ARUCO", rolling: ROLLING });
  assert.equal(det.rollingOptions, ROLLING);
  assert.equal(det.rolling.name, "APRILTAG_36h11");
  assert.equal(det.rolling.cells, 8);
  assert.ok(!det.dictionaries.includes(det.rolling), "the rolling family is not one of the layout's dictionaries");
  const found = det.detectAll(img);
  assert.deepEqual(ids(found.markers), [0, 1, 2, 3]);
  assert.deepEqual(ids(found.rolling), [0, 1, 2, 3, 4, 5]);
  // the IDs overlap: each one must be at the position of its own family's marker
  for (const [id, e] of Object.entries(cornerErrors(found.markers, t.markers))) assert.ok(e < 1, `marker ${id}: ${e.toFixed(2)} px`);
  for (const [id, e] of Object.entries(cornerErrors(found.rolling, t.rolling))) assert.ok(e < 1, `tag ${id}: ${e.toFixed(2)} px`);
  // scale applies to both families
  const scaled = det.detectAll(img, 2);
  assert.deepEqual(scaled.rolling[3], found.rolling[3].map((p) => [2 * p[0], 2 * p[1]]));
});

test("without rolling-stock tags configured, detect() is detectAll().markers and nothing else is read", () => {
  const { fly } = cameras();
  // in auto mode the tags would be the layout's markers (they outnumber the ArUco markers), as always
  for (const [dictionary, img] of [["ARUCO", scene(fly)], [null, scene(fly, { tags: {} })]]) {
    const a = new MarkerDetector({ ...aruco, dictionary }), b = new MarkerDetector({ ...aruco, dictionary });
    assert.equal(a.rolling, null);
    assert.equal(a.rollingOptions, null);
    const all = b.detectAll(img);
    assert.deepEqual(all, { markers: a.detect(img), rolling: {} });
    assert.deepEqual(ids(all.markers), [0, 1, 2, 3], `dictionary ${dictionary}`);
  }
});

test("ArUco Original and AprilTag 36h11 are never read as each other", () => {
  const { fly } = cameras();
  const layoutOnly = new MarkerDetector({ ...aruco, dictionary: "ARUCO" });
  const tagsOnly = new MarkerDetector({ ...aruco, dictionary: "APRILTAG_36h11", codes: 64 });
  for (let frame = 0; frame < 4; frame++) {
    const tags = tagGrid(frame), seed = 10 + frame;
    // 30 tags, no layout marker: the ArUco detector reads nothing
    assert.deepEqual(layoutOnly.detect(scene(fly, { infra: {}, tags, seed })), {}, `frame ${frame}`);
    // layout markers only: a detector for the tags reads nothing
    assert.deepEqual(tagsOnly.detect(scene(fly, { tags: {}, seed })), {}, `frame ${frame}`);
  }
});

test("a square read in both families keeps the read with fewer bit errors (a tie goes to the layout)", () => {
  const { fly } = cameras();
  const img = scene(fly, { infra: {}, tags: tagGrid(0), seed: 3 });
  // ArUco 4x4 misreads some 36h11 tags (their inner 4x4 cells happen to be near a 4x4 code)
  const misread = new MarkerDetector({ ...aruco, dictionary: "ARUCO_4X4_1000" }).detect(img);
  assert.ok(Object.keys(misread).length > 0, "the scene contains tags that read as ArUco 4x4 markers");
  const both = new MarkerDetector({ ...aruco, dictionary: "ARUCO_4X4_1000", rolling: ROLLING }).detectAll(img);
  assert.deepEqual(both.markers, {}, "as tags they have no bit errors: they stay tags");
  assert.equal(Object.keys(both.rolling).length, 30);
  // the same family for both (a configuration error): every read ties, the layout wins
  const same = new MarkerDetector({ ...aruco, dictionary: "APRILTAG_36h11", codes: 64, rolling: ROLLING }).detectAll(img);
  assert.equal(Object.keys(same.markers).length, 30);
  assert.deepEqual(same.rolling, {});
});

test("maxBitErrors caps the bit errors corrected in rolling-stock tags", () => {
  const AR = aruco.AR;
  const safe = acceptedBitErrors(AR, "APRILTAG_36h11", 64);
  assert.ok(safe > 3, `36h11 could correct ${safe} bit errors`);
  for (const maxBitErrors of [0, 1, 3, 6]) {
    const det = new MarkerDetector({ ...aruco, rolling: { ...ROLLING, maxBitErrors } });
    assert.equal(det.rolling.dict.tau, Math.min(safe, maxBitErrors) + 1, `maxBitErrors ${maxBitErrors}`);
  }
  assert.equal(new MarkerDetector({ ...aruco, rolling: { dictionary: "APRILTAG_36h11" } }).rolling.dict.tau, 4, "default: 3 bit errors");
  // the cap does not change the layout's dictionaries
  const plain = new MarkerDetector({ ...aruco }), capped = new MarkerDetector({ ...aruco, rolling: { ...ROLLING, maxBitErrors: 0 } });
  assert.deepEqual(capped.dictionaries.map((d) => d.dict.tau), plain.dictionaries.map((d) => d.dict.tau));
  // a tag printed with two wrong bits: read with a cap of 3, not with a cap of 1
  const { fly } = cameras();
  const bits = markerBits(AR, "APRILTAG_36h11", 4).map((r) => [...r]);
  bits[1][2] ^= 1;
  bits[4][3] ^= 1;
  const img = scene(fly, { bits: { 4: bits } });
  assert.ok(new MarkerDetector({ ...aruco, rolling: { ...ROLLING, maxBitErrors: 3 } }).detectAll(img).rolling[4]);
  const strict = new MarkerDetector({ ...aruco, rolling: { ...ROLLING, maxBitErrors: 1 } }).detectAll(img).rolling;
  assert.deepEqual(ids(strict), [0, 1, 2, 3, 5]);
  assert.throws(() => new MarkerDetector({ ...aruco, rolling: { dictionary: "NOPE" } }), /Unknown or unloaded dictionary: NOPE/);
});

test("missing, null or invalid rolling-stock options take their defaults one by one", () => {
  const entry = (rolling) => new MarkerDetector({ ...aruco, rolling }).rolling;
  const ref = entry({});
  assert.equal(ref.name, "APRILTAG_36h11");
  assert.equal(ref.dict.codeList.length, 64);
  assert.equal(ref.dict.tau, 4);
  for (const rolling of [{ dictionary: undefined, codes: undefined, maxBitErrors: undefined }, { dictionary: null, codes: null, maxBitErrors: null }, { codes: 0 }, { codes: -5 }, { codes: 2.5 }, { codes: "64" }]) {
    const e = entry(rolling);
    assert.equal(e.name, ref.name, JSON.stringify(rolling));
    assert.equal(e.dict.codeList.length, 64, JSON.stringify(rolling));
    assert.equal(e.dict.tau, ref.dict.tau, JSON.stringify(rolling));
  }
  // a given option is kept while the others take their defaults
  const some = entry({ codes: 16, maxBitErrors: undefined });
  assert.equal(some.dict.codeList.length, 16);
  assert.equal(some.dict.tau, 4);
  assert.equal(entry({ dictionary: "ARUCO_MIP_36h12", codes: null }).dict.codeList.length, 64);
});

test("in auto mode the rolling family never wins the vote, nor does a family that misreads its tags", () => {
  const { fly } = cameras();
  const det = new MarkerDetector({ ...aruco, dictionary: null, rolling: ROLLING });
  for (let frame = 0; frame < 10; frame++) {
    const found = det.detectAll(scene(fly, { infra: {}, tags: tagGrid(frame), seed: 20 + frame }));
    assert.equal(Object.keys(found.rolling).length, 30, `frame ${frame}`);
    assert.deepEqual(found.markers, {}, `frame ${frame}`);
  }
  assert.equal(det.autoDetecting, true);
  assert.equal(det.dictionaryName, null);
  assert.deepEqual(det.votes, {});
  // without the rolling option the tags settle the vote at once: they are then the layout's markers
  const plain = new MarkerDetector({ ...aruco, dictionary: null });
  plain.detect(scene(fly, { infra: {}, tags: tagGrid(0) }));
  assert.equal(plain.dictionaryName, "APRILTAG_36h11");
  // with layout markers in view the vote settles on their dictionary, next to 30 tags
  for (let frame = 0; frame < 3; frame++) det.detectAll(scene(fly, { tags: tagGrid(frame), seed: 30 + frame }));
  assert.equal(det.dictionaryName, "ARUCO");
  assert.equal(det.autoDetecting, false);
});

test("rolling-stock tags change nothing about the layout markers of the fixture images", { skip }, () => {
  const meta = fixtureMeta();
  const [pw, ph] = meta.flight_size, [lw, lh] = meta.lab_size;
  const images = [];
  for (let i = 0; i < meta.flight.length; i += 3) images.push(fixtureImage(`flight_${String(i).padStart(2, "0")}.rgba`, pw, ph));
  images.push(fixtureImage("lab.rgba", lw, lh));
  const plain = new MarkerDetector({ ...aruco, dictionary: "ARUCO" });
  const withTags = new MarkerDetector({ ...aruco, dictionary: "ARUCO", rolling: ROLLING });
  for (const [i, img] of images.entries()) {
    const markers = plain.detect(img);
    assert.deepEqual(plain.detectAll(img), { markers, rolling: {} }, `image ${i}`);
    assert.deepEqual(withTags.detectAll(img).markers, markers, `image ${i}`);
  }
  // the 36h11 fixture (made by OpenCV) as rolling-stock tags: same IDs and corner order as OpenCV
  const d = meta.dictionaries.DICT_APRILTAG_36h11;
  const found = withTags.detectAll(fixtureImage("dict_DICT_APRILTAG_36h11.rgba", d.size[0], d.size[1]));
  assert.deepEqual(found.markers, {});
  assert.deepEqual(ids(found.rolling), ids(d.corners));
  for (const [id, cv] of Object.entries(d.corners)) {
    const e = Math.max(...cv.map((c, k) => Math.hypot(found.rolling[id][k][0] - c[0], found.rolling[id][k][1] - c[1])));
    assert.ok(e < 1.5, `tag ${id}: ${e.toFixed(2)} px from OpenCV`);
  }
});

/* ---------------------------------------------------------------- geometry */

test("cameraCentre is the eye of the flyover camera", () => {
  const { fly } = cameras();
  for (const set of [{}, { yaw: 0.3, pitch: toRad(70), distance: 900, target: [120, -40] }, { pitch: toRad(90) }]) {
    fly.set(set);
    const eye = fly.basis().eye;
    const c = cameraCentre(fly.pose());
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(c[i] - eye[i]) < 1e-6, `${JSON.stringify(set)}: ${c} vs ${eye}`);
    // the same from the image homography, as the tracker has it
    const { H: Hz, focal } = fly.homography(W, H);
    const c2 = cameraCentre(poseFromHomography(Hz, { fx: focal, fy: focal, cx: W / 2, cy: H / 2 }));
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(c2[i] - eye[i]) < 1e-6, `${JSON.stringify(set)}: ${c2} vs ${eye}`);
  }
});

test("planeHomography maps points at a height exactly as the camera projects them", () => {
  const { fly } = cameras();
  const { H: Hz, focal } = fly.homography(W, H);
  const K = { fx: focal, fy: focal, cx: W / 2, cy: H / 2 };
  for (const height of [0, 15, -8, 120]) {
    const Hh = planeHomography(Hz, K, height);
    for (const p of [[0, 0], [-200, 150], [230, -120], [40, 300]]) {
      const a = applyH(Hh, p), b = fly.project([p[0], p[1], height], W, H);
      assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6, `height ${height}, point ${p}`);
    }
  }
});

/* ---------------------------------------------------------------- lifting */

/** Tracker on a locked map of the layout markers, posed from their corners in one still frame. */
function posedTracker(markers, camera) {
  const tracker = new PlaneTracker(new MarkerMap({ size: MARKER_MM, poses: INFRA, locked: true }), { survey: false });
  const state = tracker.update(markers, 0, camera, { still: true });
  assert.ok(state.H, "pose from the layout markers");
  return tracker;
}

test("liftMarkers puts exactly seen tags at their place on the deck plane", () => {
  const { fly, camera } = cameras();
  const t = truth(fly);
  const tracker = posedTracker(t.markers, camera);
  const lifted = tracker.liftMarkers(t.rolling, camera, DECK_MM);
  assert.deepEqual(ids(lifted), ids(TAGS));
  for (const [id, [x, y, d]] of Object.entries(TAGS)) {
    const m = lifted[id];
    assert.ok(Math.hypot(m.center[0] - x, m.center[1] - y) < 0.01, `tag ${id}: ${m.center} vs ${[x, y]}`);
    assert.ok(Math.abs(toDeg(wrapAngle(m.heading - toRad(d)))) < 0.01, `tag ${id} heading`);
    assert.ok(Math.abs(m.edge_mm - TAG_MM) < 0.01, `tag ${id} edge ${m.edge_mm}`);
    assert.equal(m.z, DECK_MM);
    assert.deepEqual(m.corners, t.rolling[id], "no lens distortion: the corners as given");
    // on the table plane the tag would appear far away from its place
    const p = t.rolling[id].map((c) => applyH(tracker.Hinv, c));
    const flat = [(p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4, (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4];
    assert.ok(Math.hypot(flat[0] - x, flat[1] - y) > 10, `tag ${id} projected to z = 0`);
  }
  // a height per tag: a wrong height gives the wrong size
  const perTag = tracker.liftMarkers(t.rolling, camera, (id) => (id === 2 ? 0 : id === 5 ? NaN : DECK_MM));
  assert.deepEqual(ids(perTag), [0, 1, 2, 3, 4], "tags without a finite height are left out");
  assert.equal(perTag[2].z, 0);
  assert.ok(perTag[2].edge_mm > 1.03 * TAG_MM, `edge ${perTag[2].edge_mm} at the wrong height`);
  assert.deepEqual(perTag[1], lifted[1]);
});

test("liftMarkers places detected tags within 1.5 mm and 1°", () => {
  const { fly, camera } = cameras();
  const det = new MarkerDetector({ ...aruco, dictionary: "ARUCO", rolling: ROLLING });
  const tracker = new PlaneTracker(new MarkerMap({ size: MARKER_MM, poses: INFRA, locked: true }), { survey: false });
  // a few frames of a still camera with fresh noise: the smoothed pose is used
  let lifted = null;
  for (let frame = 0; frame < 4; frame++) {
    const found = det.detectAll(scene(fly, { seed: 40 + frame }));
    tracker.update(found.markers, frame / 30, camera);
    lifted = tracker.liftMarkers(found.rolling, camera, DECK_MM);
  }
  assert.deepEqual(ids(lifted), ids(TAGS));
  for (const [id, [x, y, d]] of Object.entries(TAGS)) {
    const m = lifted[id];
    const e = Math.hypot(m.center[0] - x, m.center[1] - y), dh = Math.abs(toDeg(wrapAngle(m.heading - toRad(d))));
    assert.ok(e < 1.5, `tag ${id}: centre ${e.toFixed(2)} mm off`);
    assert.ok(dh < 1, `tag ${id}: heading ${dh.toFixed(2)}° off`);
    assert.ok(Math.abs(m.edge_mm - TAG_MM) < 0.03 * TAG_MM, `tag ${id}: edge ${m.edge_mm.toFixed(2)} mm`);
  }
});

test("liftMarkers returns nothing without a pose", () => {
  const { fly, camera } = cameras();
  const tracker = new PlaneTracker(new MarkerMap({ size: MARKER_MM, poses: INFRA, locked: true }), { survey: false });
  assert.deepEqual(tracker.liftMarkers(truth(fly).rolling, camera, DECK_MM), {});
  tracker.update({}, 0, camera);
  assert.deepEqual(tracker.liftMarkers(truth(fly).rolling, camera, DECK_MM), {});
});
