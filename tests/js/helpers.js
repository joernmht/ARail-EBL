// Shared helpers for the JavaScript tests (node --test).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FIXTURES = join(ROOT, "tests", "fixtures");
const VENDOR = join(ROOT, "web", "vendor", "js-aruco2");
const VENDOR_FILES = [
  "cv.js", "aruco.js", "dictionaries/aruco_4x4_1000.js", "dictionaries/aruco_5x5_1000.js",
  "dictionaries/aruco_6x6_1000.js", "dictionaries/aruco_7x7_1000.js", "dictionaries/apriltag_36h11.js",
];

/** Load the vendored js-aruco2 scripts the way a browser does (as classic scripts). */
export function loadAruco() {
  const ctx = vm.createContext({ console, Math, Array, Object, Number, String, Uint8ClampedArray, Int32Array, Float32Array });
  ctx.window = ctx;
  for (const f of VENDOR_FILES) {
    const code = readFileSync(join(VENDOR, f), "utf8").replace(/require\([^)]*\)/g, "undefined");
    vm.runInContext(code, ctx, { filename: f });
  }
  return { AR: ctx.AR, CV: ctx.CV };
}

export function hasFixtures() {
  return existsSync(join(FIXTURES, "meta.json"));
}

export const FIXTURE_HINT = "fixtures missing: run  npm run fixtures  (needs the Python tools, see CONTRIBUTING.md)";

let meta = null;
export function fixtureMeta() {
  if (!meta) meta = JSON.parse(readFileSync(join(FIXTURES, "meta.json"), "utf8"));
  return meta;
}

/** Raw RGBA fixture image as an ImageData-like object. */
export function fixtureImage(name, width, height) {
  const data = new Uint8ClampedArray(readFileSync(join(FIXTURES, name)));
  if (data.length !== width * height * 4) throw new Error(`${name}: unexpected size`);
  return { width, height, data };
}

export const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return s[s.length >> 1];
};

export function readJSON(path) {
  return JSON.parse(readFileSync(join(ROOT, path), "utf8"));
}
