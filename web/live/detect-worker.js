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
/** The canvas a bitmap is read on (the app's frames), kept for the next one of the same size. */
let canvas = null;

/** Can this worker draw a bitmap and read its pixels (OffscreenCanvas with a 2D context)? */
function drawsBitmaps() {
  try {
    return typeof OffscreenCanvas === "function" && !!new OffscreenCanvas(1, 1).getContext("2d");
  } catch {
    return false;
  }
}

/** The pixels of a bitmap at a size (the processing size). */
function pixelsOf(bitmap, width, height) {
  if (!canvas || canvas.width !== width || canvas.height !== height) canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/**
 * One message: `init` sets up the detector (dictionary or "auto", codes, and the tags of model wagons,
 * `rolling`, as MarkerDetector takes them) and answers whether bitmaps can be sent; `frame` searches a
 * frame's pixels and answers with its markers, the wagons' tags and the dictionary chosen (or voted for
 * so far); `bitmap` does so for a bitmap of the frame, read here at the processing size, and sends the
 * bitmap back with them (it is the picture shown with its markers). What fails is answered with an
 * `error` naming the message (`of`, and the frame's `id`); an `init` that fails leaves no detector, so
 * that no frame is searched with the settings of before (it errs until an `init` succeeds).
 */
async function handle(m) {
  try {
    if (m.type === "init") {
      detector = null;
      await loadVendor(m.dictionary, m.rolling ? m.rolling.dictionary || ROLLING_DICTIONARY : null);
      detector = new MarkerDetector({ dictionary: m.dictionary === "auto" ? null : m.dictionary, codes: m.codes, rolling: m.rolling || null });
      self.postMessage({ type: "ready", bitmaps: drawsBitmaps() });
    } else if (m.type === "frame" || m.type === "bitmap") {
      if (!detector) throw new Error("not set up");
      const image = m.type === "bitmap" ? pixelsOf(m.bitmap, m.width, m.height) : { width: m.width, height: m.height, data: new Uint8ClampedArray(m.buffer) };
      const t0 = performance.now();
      const found = detector.detectAll(image, m.scale);
      const msg = {
        type: "markers", id: m.id, markers: found.markers, rolling: found.rolling, ms: performance.now() - t0,
        selected: detector.selected?.name ?? null, last: detector.last?.name ?? null,
      };
      if (m.bitmap) {
        msg.bitmap = m.bitmap;
        self.postMessage(msg, [m.bitmap]);
      } else self.postMessage(msg);
    }
  } catch (err) {
    m.bitmap?.close();
    self.postMessage({ type: "error", of: m.type, id: m.id, message: err.message });
  }
}

// one message after the other: a frame sent right after `init` waits for the scripts to load
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(() => handle(data));
};
