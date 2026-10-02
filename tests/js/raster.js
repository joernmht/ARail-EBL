// Synthetic camera images of square markers for the tests: deterministic (seeded noise), so the
// tests need no image fixtures. Markers are drawn with their exact perspective (each marker is a
// plane square, so a homography of its four image corners maps it exactly).
import { markerCorners } from "../../web/arail/core/geometry.js";
import { createRng, homography4, inv3 } from "../../web/arail/core/math.js";

/**
 * Grey image of markers, as an ImageData-like RGBA object.
 *
 * Every marker is its black square (border cells and bits) inside a white quiet zone one cell wide.
 * Pixel centres lie at integer coordinates, as in the detector; each pixel is the mean of
 * `supersample`² samples over its area. Then the image is blurred (Gaussian, `blur` = sigma in px)
 * and noise is added (Gaussian, `noise` = sigma in grey levels, from a seeded generator).
 * @param {object} options
 * @param {number} options.width image width (px)
 * @param {number} options.height image height (px)
 * @param {{bits: number[][], corners: number[][]}[]} [options.markers] inner bits (rows of 0/1, 1 = white,
 *   as `markerBits` returns them) and the image corners of the black square (TL, TR, BR, BL; px);
 *   later markers are drawn over earlier ones
 * @param {number | ((x: number, y: number) => number)} [options.background=150] grey value, or a function of the pixel
 * @param {number} [options.supersample=4] samples per pixel along each axis
 * @param {number} [options.blur=0] Gaussian blur, sigma in px
 * @param {number} [options.noise=0] Gaussian noise, sigma in grey levels
 * @param {number} [options.seed=1] seed of the noise
 * @param {number} [options.black=25] grey value of black print
 * @param {number} [options.white=230] grey value of white paper
 * @returns {{width: number, height: number, data: Uint8ClampedArray}}
 */
export function rasterMarkers({
  width, height, markers = [], background = 150, supersample = 4, blur = 0, noise = 0, seed = 1, black = 25, white = 230,
}) {
  const grey = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) grey[y * width + x] = typeof background === "function" ? background(x, y) : background;
  }
  const S = Math.max(1, Math.round(supersample));
  for (const { bits, corners } of markers) {
    const N = bits.length + 2; // cells along an edge, black border included
    const H = homography4([[0, 0], [N, 0], [N, N], [0, N]], corners); // cell coordinates -> image px
    const Hinv = H && inv3(H);
    if (!Hinv) continue;
    // image box of the marker with its quiet zone
    const box = [[-1, -1], [N + 1, -1], [N + 1, N + 1], [-1, N + 1]].map(([u, v]) => {
      const w = H[6] * u + H[7] * v + H[8];
      return [(H[0] * u + H[1] * v + H[2]) / w, (H[3] * u + H[4] * v + H[5]) / w];
    });
    const x0 = Math.max(0, Math.floor(Math.min(...box.map((p) => p[0])))), x1 = Math.min(width - 1, Math.ceil(Math.max(...box.map((p) => p[0]))));
    const y0 = Math.max(0, Math.floor(Math.min(...box.map((p) => p[1])))), y1 = Math.min(height - 1, Math.ceil(Math.max(...box.map((p) => p[1]))));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let sum = 0, inside = 0;
        for (let sy = 0; sy < S; sy++) {
          for (let sx = 0; sx < S; sx++) {
            const px = x - 0.5 + (sx + 0.5) / S, py = y - 0.5 + (sy + 0.5) / S;
            const w = Hinv[6] * px + Hinv[7] * py + Hinv[8];
            const u = (Hinv[0] * px + Hinv[1] * py + Hinv[2]) / w, v = (Hinv[3] * px + Hinv[4] * py + Hinv[5]) / w;
            if (!(u >= -1 && u < N + 1 && v >= -1 && v < N + 1)) continue;
            inside++;
            const j = Math.floor(u), i = Math.floor(v);
            const quiet = i < 0 || j < 0 || i >= N || j >= N;
            const border = !quiet && (i === 0 || j === 0 || i === N - 1 || j === N - 1);
            sum += quiet || (!border && bits[i - 1][j - 1] === 1) ? white : black;
          }
        }
        if (inside) {
          const k = y * width + x;
          grey[k] = (sum + (S * S - inside) * grey[k]) / (S * S);
        }
      }
    }
  }
  const out = blur > 0 ? gaussianBlur(grey, width, height, blur) : grey;
  const rng = createRng(seed);
  let spare = null; // Box-Muller gives two independent normal values per pair of uniform ones
  const gauss = () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    const r = Math.sqrt(-2 * Math.log(rng.next() + 1e-12)), a = 2 * Math.PI * rng.next();
    spare = r * Math.sin(a);
    return r * Math.cos(a);
  };
  const data = new Uint8ClampedArray(width * height * 4);
  for (let k = 0; k < width * height; k++) {
    const v = Math.round(out[k] + (noise > 0 ? noise * gauss() : 0));
    data[4 * k] = data[4 * k + 1] = data[4 * k + 2] = v;
    data[4 * k + 3] = 255;
  }
  return { width, height, data };
}

/** Separable Gaussian blur (sigma in px) with clamped edges. */
function gaussianBlur(src, width, height, sigma) {
  const r = Math.ceil(3 * sigma), kernel = [];
  let total = 0;
  for (let i = -r; i <= r; i++) total += kernel[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < kernel.length; i++) kernel[i] /= total;
  const tmp = new Float32Array(width * height), dst = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += kernel[i + r] * src[y * width + Math.min(width - 1, Math.max(0, x + i))];
      tmp[y * width + x] = s;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += kernel[i + r] * tmp[Math.min(height - 1, Math.max(0, y + i)) * width + x];
      dst[y * width + x] = s;
    }
  }
  return dst;
}

/**
 * Image corners (TL, TR, BR, BL; px) of a square marker lying flat at height z, seen by a camera.
 * @param {{project: (p: number[], width: number, height: number) => number[] | null}} cam e.g. a FlyCamera
 * @param {number[]} center marker centre [x, y] (layout mm)
 * @param {number} heading direction of the marker's x axis (rad)
 * @param {number} size edge of the black square (mm)
 * @param {number} z height above the layout (mm)
 * @param {number} W image width (px)
 * @param {number} H image height (px)
 * @returns {number[][] | null} null if a corner is behind the camera
 */
export function squareCorners(cam, center, heading, size, z, W, H) {
  const c = Math.cos(heading), s = Math.sin(heading);
  const corners = markerCorners(size).map(([x, y]) => cam.project([center[0] + c * x - s * y, center[1] + s * x + c * y, z], W, H));
  return corners.every(Boolean) ? corners : null;
}
