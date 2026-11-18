// Marker detection in a worker of its own (a module worker), for the live page and the app's camera
// and clips: the frames come as RGBA pixel buffers, the markers found go back. The page's main thread
// meanwhile simulates and draws. js-aruco2 is loaded as the classic scripts it is (they define the
// globals AR and CV), with only the dictionaries the detector needs.
import { MarkerDetector } from "../arail/core/detector.js";

/** js-aruco2's dictionary scripts by the dictionary they define (ArUco Original and MIP 36h12 are in aruco.js). */
const DICTIONARY_FILES = {
  ARUCO_4X4_1000: "aruco_4x4_1000.js", ARUCO_5X5_1000: "aruco_5x5_1000.js", ARUCO_6X6_1000: "aruco_6x6_1000.js",
  ARUCO_7X7_1000: "aruco_7x7_1000.js", APRILTAG_36h11: "apriltag_36h11.js",
};
/** The tags of model wagons when the layout names no dictionary for them (DEFAULT_ROLLING). */
const ROLLING_DICTIONARY = "APRILTAG_36h11";

const loaded = new Set();

/**
 * Run js-aruco2's scripts in the worker's global scope, as a page's script tags would; each script once.
 * @param {string | null | undefined} dictionary the layout's ("auto" or none: all of them)
 * @param {string | null} [rolling] the dictionary of the wagons' tags, if they are read
 */
async function loadVendor(dictionary, rolling = null) {
  const files = ["cv.js", "aruco.js"];
  for (const d of [dictionary || "auto", rolling]) {
    if (d === "auto") files.push(...Object.values(DICTIONARY_FILES).map((f) => `dictionaries/${f}`));
    else if (DICTIONARY_FILES[d]) files.push(`dictionaries/${DICTIONARY_FILES[d]}`);
  }
  for (const f of files) {
    if (loaded.has(f)) continue;
    const res = await fetch(new URL(`../vendor/js-aruco2/${f}`, import.meta.url));
    if (!res.ok) throw new Error(`${f}: ${res.status}`);
    (0, eval)(await res.text()); // indirect eval: global scope, like a classic script
    loaded.add(f);
  }
}

let detector = null;

/**
 * One message: `init` sets up the detector (dictionary or "auto", codes, and the tags of model wagons,
 * `rolling`, as MarkerDetector takes them); `frame` searches a frame and answers with its markers, the
 * wagons' tags and the dictionary chosen (or voted for so far).
 */
async function handle(m) {
  try {
    if (m.type === "init") {
      await loadVendor(m.dictionary, m.rolling ? m.rolling.dictionary || ROLLING_DICTIONARY : null);
      detector = new MarkerDetector({ dictionary: m.dictionary === "auto" ? null : m.dictionary, codes: m.codes, rolling: m.rolling || null });
      self.postMessage({ type: "ready" });
    } else if (m.type === "frame") {
      const t0 = performance.now();
      const image = { width: m.width, height: m.height, data: new Uint8ClampedArray(m.buffer) };
      const found = detector.detectAll(image, m.scale);
      self.postMessage({
        type: "markers", id: m.id, markers: found.markers, rolling: found.rolling, ms: performance.now() - t0,
        selected: detector.selected?.name ?? null, last: detector.last?.name ?? null,
      });
    }
  } catch (err) {
    self.postMessage({ type: "error", id: m.id, message: err.message });
  }
}

// one message after the other: a frame sent right after `init` waits for the scripts to load
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(() => handle(data));
};
