import assert from "node:assert/strict";
import test from "node:test";

import { DICTIONARIES, MarkerDetector, markerBits } from "../../web/arail/core/detector.js";
import { FIXTURE_HINT, fixtureImage, fixtureMeta, hasFixtures, loadAruco } from "./helpers.js";

const skip = hasFixtures() ? false : FIXTURE_HINT;

test("js-aruco2 finds the same IDs and corner order as OpenCV for every dictionary", { skip }, () => {
  const meta = fixtureMeta();
  const aruco = loadAruco();
  for (const [cvName, d] of Object.entries(meta.dictionaries)) {
    const det = new MarkerDetector({ ...aruco, dictionary: d.js });
    const found = det.detect(fixtureImage(`dict_${cvName}.rgba`, d.size[0], d.size[1]));
    assert.deepEqual(Object.keys(found).map(Number).sort(), [0, 1, 2, 3, 4, 5, 6, 7], cvName);
    for (const [id, cvCorners] of Object.entries(d.corners)) {
      for (let k = 0; k < 4; k++) {
        const e = Math.hypot(found[id][k][0] - cvCorners[k][0], found[id][k][1] - cvCorners[k][1]);
        assert.ok(e < 1.5, `${cvName} id ${id} corner ${k}: ${e.toFixed(2)} px from OpenCV`);
      }
    }
  }
});

test("printable marker bits equal OpenCV's markers", { skip }, () => {
  const meta = fixtureMeta();
  const { AR } = loadAruco();
  for (const [cvName, d] of Object.entries(meta.dictionaries)) {
    for (const [id, bits] of Object.entries(d.bits)) {
      assert.deepEqual(markerBits(AR, d.js, Number(id)), bits, `${cvName} id ${id}`);
    }
  }
});

test("dictionary is detected automatically", { skip }, () => {
  const meta = fixtureMeta();
  const aruco = loadAruco();
  const det = new MarkerDetector({ ...aruco, dictionary: null });
  assert.equal(det.autoDetecting, true);
  const d = meta.dictionaries.DICT_4X4_50;
  const img = fixtureImage("dict_DICT_4X4_50.rgba", d.size[0], d.size[1]);
  det.detect(img);
  assert.equal(det.dictionaryLabel, "ArUco 4x4");
  assert.equal(det.autoDetecting, false, "8 markers are enough votes to settle");
});

test("all dictionaries are available in the vendored js-aruco2", () => {
  const { AR } = loadAruco();
  for (const d of DICTIONARIES) assert.ok(AR.DICTIONARIES[d.name], d.name);
});

test("markers are found on the real photo of the lab layout", { skip }, () => {
  const meta = fixtureMeta();
  if (!meta.lab_size) return;
  const det = new MarkerDetector({ ...loadAruco(), dictionary: "ARUCO" });
  const [w, h] = meta.lab_size;
  const found = det.detect(fixtureImage("lab.rgba", w, h));
  for (const [id, cv] of Object.entries(meta.lab_opencv)) {
    assert.ok(found[id], `marker ${id} (found: ${Object.keys(found)})`);
    const e = Math.max(...cv.map((c, k) => Math.hypot(found[id][k][0] - c[0], found[id][k][1] - c[1])));
    assert.ok(e < 2, `marker ${id}: corners ${e.toFixed(2)} px from OpenCV`);
  }
});
