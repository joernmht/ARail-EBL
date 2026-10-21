// The live page's marker detection in a worker of its own (a module worker): the frames come as
// RGBA pixel buffers, the markers found go back. The page's main thread meanwhile simulates and
// draws. js-aruco2 is loaded as the classic scripts it is (they define the globals AR and CV), with
// only the dictionary the layout uses.
import { MarkerDetector } from "../arail/core/detector.js";

/** js-aruco2's dictionary scripts by the dictionary they define (ArUco Original and MIP 36h12 are in aruco.js). */
const DICTIONARY_FILES = {
  ARUCO_4X4_1000: "aruco_4x4_1000.js", ARUCO_5X5_1000: "aruco_5x5_1000.js", ARUCO_6X6_1000: "aruco_6x6_1000.js",
  ARUCO_7X7_1000: "aruco_7x7_1000.js", APRILTAG_36h11: "apriltag_36h11.js",
};

/** Run js-aruco2's scripts in the worker's global scope, as a page's script tags would. */
async function loadVendor(dictionary) {
  const files = ["cv.js", "aruco.js"];
  const extra = !dictionary || dictionary === "auto" ? Object.values(DICTIONARY_FILES) : [DICTIONARY_FILES[dictionary]].filter(Boolean);
  for (const f of extra) files.push(`dictionaries/${f}`);
  for (const f of files) {
    const res = await fetch(new URL(`../vendor/js-aruco2/${f}`, import.meta.url));
    if (!res.ok) throw new Error(`${f}: ${res.status}`);
    (0, eval)(await res.text()); // indirect eval: global scope, like a classic script
  }
}

let detector = null;

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === "init") {
      if (!globalThis.AR) await loadVendor(m.dictionary);
      detector = new MarkerDetector({ dictionary: m.dictionary === "auto" ? null : m.dictionary, codes: m.codes });
      self.postMessage({ type: "ready" });
    } else if (m.type === "frame") {
      const t0 = performance.now();
      const image = { width: m.width, height: m.height, data: new Uint8ClampedArray(m.buffer) };
      const markers = detector.detect(image, m.scale);
      self.postMessage({ type: "markers", id: m.id, markers, ms: performance.now() - t0 });
    }
  } catch (err) {
    self.postMessage({ type: "error", id: m.id, message: err.message });
  }
};
