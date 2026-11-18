import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptedBitErrors, DICTIONARIES, greyscale, MarkerDetector, markerBits, orientedDistance, thresholdBordered, traceContours,
} from "../../web/arail/core/detector.js";
import { createRng } from "../../web/arail/core/math.js";
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

test("fewer codes (a locked map) correct more bit errors, but never accept chance matches more often", () => {
  const { AR } = loadAruco();
  const patterns = (bits, e) => {
    let sum = 0, c = 1;
    for (let k = 0; k <= e; k++) {
      sum += c;
      c = (c * (bits - k)) / (k + 1);
    }
    return sum;
  };
  for (const d of DICTIONARIES) {
    const bits = AR.DICTIONARIES[d.name].nBits;
    const at50 = acceptedBitErrors(AR, d.name, 50);
    for (const codes of [1, 2, 5, 10, 49]) {
      const e = acceptedBitErrors(AR, d.name, codes);
      assert.ok(Number.isInteger(e) && e >= at50 && e < bits / 2, `${d.name}, ${codes} codes: ${e} bit errors`);
      assert.ok(codes * patterns(bits, e) <= 50 * patterns(bits, at50), `${d.name}, ${codes} codes: chance matches`);
    }
  }
  // a single code: other markers are not read as it (it used to accept any bit pattern)
  const one = new MarkerDetector({ ...loadAruco(), dictionary: "ARUCO_4X4_1000", codes: 1 });
  const corners = [[0, 0], [10, 0], [10, 10], [0, 10]];
  for (let id = 1; id < 50; id++) assert.equal(one._match(one.selected, markerBits(one.AR, "ARUCO_4X4_1000", id), corners), null, `marker ${id}`);
  assert.equal(one._match(one.selected, markerBits(one.AR, "ARUCO_4X4_1000", 0), corners)?.id, 0);
  // codes are compared in all four orientations: a code turned by 90 degrees is 0 bits away
  assert.equal(orientedDistance(["1000000000000000", "0001000000000000"]), 0);
});

test("a sticker misread as a known ID does not replace the real marker (fewest bit errors win)", () => {
  const aruco = loadAruco();
  const name = "ARUCO_4X4_1000";
  // ID 499 is two bits from ID 0: with 5 codes (a locked map of markers 0-4) it is read as 0
  assert.equal(orientedDistance([0, 499].map((id) => markerBits(aruco.AR, name, id).flat().join(""))), 2);
  const W = 640, H = 320, cell = 20, data = new Uint8ClampedArray(W * H * 4).fill(255);
  [499, 0].forEach((id, k) => {
    const bits = markerBits(aruco.AR, name, id);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      const white = i > 0 && j > 0 && i < 5 && j < 5 && bits[i - 1][j - 1] === 1;
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const p = ((60 + i * cell + y) * W + 60 + k * 300 + j * cell + x) * 4;
          data.fill(white ? 255 : 0, p, p + 3);
        }
      }
    }
  });
  const found = new MarkerDetector({ ...aruco, dictionary: name, codes: 5 }).detect({ width: W, height: H, data });
  assert.deepEqual(Object.keys(found), ["0"]);
  const cx = found[0].reduce((s, p) => s + p[0], 0) / 4;
  assert.ok(Math.abs(cx - 420) < 2, `marker 0 found at x = ${cx.toFixed(1)} (the real one is at 420, the misread one at 120)`);
});

/* ---------------------------------------------------------------- the same as js-aruco2, to the bit */

/** Grey image, bordered threshold and contours of an image by js-aruco2's cv.js, as plain arrays. */
function byCv(CV, image) {
  const grey = new CV.Image(), thres = new CV.Image();
  CV.grayscale(image, grey);
  CV.adaptiveThreshold(grey, thres, 2, 7);
  const n = image.width * image.height, bordered = (image.width + 2) * (image.height + 2);
  const binary = Array.from(CV.binaryBorder(thres, []).slice(0, bordered));
  // Array.from: arrays of this realm (cv.js runs in a context of its own), to be compared deeply
  const contours = Array.from(CV.findContours(thres, []), (c) => ({ hole: c.hole, points: Array.from(c, (p) => [p.x, p.y]) }));
  return { grey: Array.from(grey.data.slice(0, n)), binary, contours };
}

/** The same by the detector's typed-array ports. */
function byPorts(image, minLength) {
  const { width: w, height: h } = image;
  const grey = greyscale(image, new Uint8Array(w * h));
  const binary = thresholdBordered(grey, w, h, new Int32Array((w + 2) * (h + 2)).fill(9)); // the border is written, too
  const contours = traceContours(binary.slice(), w, h, minLength).map((c) => ({ hole: c.hole, points: c.map((p) => [p.x, p.y]) }));
  return { grey: Array.from(grey), binary: Array.from(binary), contours };
}

test("grey image, threshold and contours are js-aruco2's to the bit, on random images of every shape", () => {
  const { CV } = loadAruco();
  const rng = createRng(7);
  for (let k = 0; k < 120; k++) {
    const w = 3 + rng.int(48), h = 3 + rng.int(48), cell = 1 + rng.int(6), blocks = rng.chance(0.5);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = blocks ? (((x / cell) | 0) * 7 + ((y / cell) | 0) * 13) % 5 < 2 ? 20 : 230 : rng.int(256);
        data.set([v, rng.int(256), v, 255], (y * w + x) * 4);
      }
    }
    const image = { width: w, height: h, data }, cv = byCv(CV, image);
    for (const min of [0, 6]) {
      const ported = byPorts(image, min);
      const label = `${w} × ${h}, contours of at least ${min} points`;
      assert.deepEqual(ported.grey, cv.grey, `grey ${label}`);
      assert.deepEqual(ported.binary, cv.binary, `threshold ${label}`);
      assert.deepEqual(ported.contours, cv.contours.filter((c) => c.points.length >= min), `contours ${label}`);
    }
  }
});

test("on a real frame, too: the same contours and the same markers as with js-aruco2's own steps", { skip }, () => {
  const meta = fixtureMeta();
  const [w, h] = meta.example_size;
  const image = fixtureImage("example.rgba", w, h), aruco = loadAruco();
  const cv = byCv(aruco.CV, image), ported = byPorts(image, w * 0.01);
  assert.deepEqual(ported.contours, cv.contours.filter((c) => c.points.length >= w * 0.01));
  assert.ok(ported.contours.length > 20, `${ported.contours.length} contours`);
  // the detector itself, frame after frame in the same buffers
  const det = new MarkerDetector({ ...aruco, dictionary: "ARUCO" });
  const first = det.detect(image), again = det.detect(image);
  assert.deepEqual(again, first);
  assert.ok(Object.keys(first).length > 0);
});
