/**
 * Square fiducial marker detection (ArUco / AprilTag) on top of js-aruco2.
 *
 * js-aruco2 finds the candidate quadrilaterals and provides the dictionaries. On top of it,
 * for small and steeply viewed markers on a model railway:
 * - corners are refined to sub-pixel accuracy by fitting lines to the marker edges,
 * - bits are read from the centre of each cell only (cell margins are ignored, as in OpenCV),
 *   which tolerates blur and foreshortening much better than counting whole cells,
 * - dictionaries are limited to their first N codes and only errors that can be corrected
 *   safely are accepted (fewer false detections); with fewer codes than the default 50 (a locked
 *   marker map uses only up to its highest ID) more bit errors are corrected, but never so many
 *   that chance matches become more likely than with 50 codes,
 * - the dictionary can be detected automatically by voting over several frames,
 * - corner order (and thus marker orientation) matches OpenCV for every dictionary,
 * - a second marker family can be read in the same pass: *rolling-stock* tags on model wagons
 *   (option `rolling`, see {@link MarkerDetector#detectAll}), with an ID namespace of its own.
 *
 * js-aruco2 is loaded as classic scripts (globals `AR` and `CV`); tests inject them.
 * @module arail/core/detector
 */
import { homography4 } from "./math.js";

/** Supported dictionaries: js-aruco2 name, label and OpenCV name. */
export const DICTIONARIES = [
  { name: "ARUCO_4X4_1000", label: "ArUco 4x4", opencv: "DICT_4X4_1000" },
  { name: "ARUCO_5X5_1000", label: "ArUco 5x5", opencv: "DICT_5X5_1000" },
  { name: "ARUCO_6X6_1000", label: "ArUco 6x6", opencv: "DICT_6X6_1000" },
  { name: "ARUCO_7X7_1000", label: "ArUco 7x7", opencv: "DICT_7X7_1000" },
  { name: "ARUCO", label: "ArUco Original", opencv: "DICT_ARUCO_ORIGINAL" },
  { name: "ARUCO_MIP_36h12", label: "ArUco MIP 36h12", opencv: "DICT_ARUCO_MIP_36h12" },
  // js-aruco2 stores these codes rotated by 180 degrees relative to OpenCV and the official tags
  { name: "APRILTAG_36h11", label: "AprilTag 36h11", opencv: "DICT_APRILTAG_36h11", quarterTurns: 2 },
];

/* ---------------------------------------------------------------- sub-pixel corners */

function greyAt(g, w, h, x, y) {
  x = Math.min(Math.max(x, 0), w - 1.001);
  y = Math.min(Math.max(y, 0), h - 1.001);
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
  return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + w] * (1 - fx) + g[i + w + 1] * fx) * fy;
}

function fitLine(pts) {
  let mx = 0, my = 0;
  for (const p of pts) {
    mx += p[0];
    my += p[1];
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    const dx = p[0] - mx, dy = p[1] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { p: [mx, my], d: [Math.cos(a), Math.sin(a)] };
}

function intersect(l1, l2) {
  const det = l1.d[0] * -l2.d[1] - l1.d[1] * -l2.d[0];
  if (Math.abs(det) < 1e-9) return null;
  const rx = l2.p[0] - l1.p[0], ry = l2.p[1] - l1.p[1];
  const t = (rx * -l2.d[1] - ry * -l2.d[0]) / det;
  return [l1.p[0] + t * l1.d[0], l1.p[1] + t * l1.d[1]];
}

/**
 * Refine the four corners of a dark square on a light background to sub-pixel accuracy:
 * sample the grey-value profile across each edge, locate the strongest light-to-dark
 * transition, fit a line per edge and intersect neighbouring lines.
 * Returns the input unchanged if the refinement is not trustworthy.
 * @param {Uint8ClampedArray | number[]} g grey image data
 */
export function refineCorners(g, w, h, corners) {
  const cx = corners.reduce((s, p) => s + p[0], 0) / 4, cy = corners.reduce((s, p) => s + p[1], 0) / 4;
  const lines = [];
  for (let k = 0; k < 4; k++) {
    const a = corners[k], b = corners[(k + 1) % 4];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 8) return corners;
    let nx = -dy / len, ny = dx / len; // edge normal, pointing inwards
    if (nx * (cx - a[0]) + ny * (cy - a[1]) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const N = Math.max(5, Math.min(14, Math.floor(len / 3))), R = 3, S = 0.5, pts = [];
    for (let i = 0; i < N; i++) {
      const t = 0.12 + (0.76 * i) / (N - 1), px = a[0] + dx * t, py = a[1] + dy * t;
      const profile = [];
      for (let j = -R / S; j <= R / S; j++) profile.push(greyAt(g, w, h, px + nx * j * S, py + ny * j * S));
      let best = 0, bi = -1;
      for (let j = 2; j < profile.length - 2; j++) {
        const gradient = profile[j - 1] - profile[j + 1]; // light (outside) -> dark (inside)
        if (gradient > best) {
          best = gradient;
          bi = j;
        }
      }
      if (bi < 0 || best < 12) continue;
      const g0 = profile[bi - 2] - profile[bi], g2 = profile[bi] - profile[bi + 2];
      const den = g0 - 2 * best + g2, off = den !== 0 ? (0.5 * (g0 - g2)) / den : 0;
      const d = (bi + Math.max(-1, Math.min(1, off)) - R / S) * S;
      pts.push([px + nx * d, py + ny * d]);
    }
    if (pts.length < 4) return corners;
    lines.push(fitLine(pts));
  }
  const refined = [];
  for (let k = 0; k < 4; k++) {
    const p = intersect(lines[(k + 3) % 4], lines[k]);
    if (!p || Math.hypot(p[0] - corners[k][0], p[1] - corners[k][1]) > 4) return corners;
    refined.push(p);
  }
  return refined;
}

const UNIT_SQUARE = [[0, 0], [1, 0], [1, 1], [0, 1]];

/**
 * Mean grey value of each of the n x n cells of a marker (black border included).
 * Only the central part of each cell is sampled, so blur and small corner errors at
 * steep viewing angles do not mix neighbouring cells (OpenCV ignores cell margins, too).
 * Cell (i, j) is row i along corner 0 -> 3 and column j along corner 0 -> 1, like js-aruco2.
 */
function sampleCells(g, w, h, corners, n) {
  const H = homography4(UNIT_SQUARE, corners);
  if (!H || !H.every(Number.isFinite)) return null;
  const cells = new Float32Array(n * n);
  const offsets = [-0.22, 0, 0.22]; // in cells, around the cell centre
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (const dv of offsets) {
        for (const du of offsets) {
          const u = (j + 0.5 + du) / n, v = (i + 0.5 + dv) / n;
          const z = H[6] * u + H[7] * v + H[8];
          sum += greyAt(g, w, h, (H[0] * u + H[1] * v + H[2]) / z, (H[3] * u + H[4] * v + H[5]) / z);
        }
      }
      cells[i * n + j] = sum / 9;
    }
  }
  return cells;
}

/** Otsu threshold for a small set of values. */
function otsuThreshold(values) {
  const s = Array.from(values).sort((a, b) => a - b);
  const n = s.length;
  const total = s.reduce((a, b) => a + b, 0);
  let best = -1, threshold = (s[0] + s[n - 1]) / 2, sumBelow = 0;
  for (let k = 1; k < n; k++) {
    sumBelow += s[k - 1];
    const mBelow = sumBelow / k, mAbove = (total - sumBelow) / (n - k);
    const between = k * (n - k) * (mBelow - mAbove) ** 2;
    if (between > best) {
      best = between;
      threshold = (s[k - 1] + s[k]) / 2;
    }
  }
  return threshold;
}

/** Inner bits (1 = white) of sampled cells, or null if the cells do not look like a marker. */
function cellsToBits(cells, n) {
  const t = otsuThreshold(cells);
  let dark = 0, nDark = 0, light = 0, nLight = 0;
  for (const v of cells) {
    if (v > t) {
      light += v;
      nLight++;
    } else {
      dark += v;
      nDark++;
    }
  }
  if (!nLight || !nDark || light / nLight - dark / nDark < 25) return null; // too little contrast
  for (let k = 0; k < n; k++) {
    // the outer ring of cells is the black border
    if (cells[k] > t || cells[(n - 1) * n + k] > t || cells[k * n] > t || cells[k * n + n - 1] > t) return null;
  }
  const bits = [];
  for (let i = 1; i < n - 1; i++) {
    const row = [];
    for (let j = 1; j < n - 1; j++) row.push(cells[i * n + j] > t ? 1 : 0);
    bits.push(row);
  }
  return bits;
}

/* ---------------------------------------------------------------- detector */

/** Number of codes of the default configuration: fewer codes accept no more chance matches than these. */
const REFERENCE_CODES = 50;

/** Number of bit patterns within `errors` bit errors of one code of `bits` bits. */
function patternsWithin(bits, errors) {
  let sum = 0, c = 1;
  for (let k = 0; k <= errors; k++) {
    sum += c;
    c = (c * (bits - k)) / (k + 1);
  }
  return sum;
}

/** js-aruco2 dictionary of the first `codes` codes of `full` (its tau = their minimum distance). */
function firstCodes(AR, name, full, codes) {
  const shortName = `${name}_FIRST${codes}`;
  AR.DICTIONARIES[shortName] = { nBits: full.nBits, codeList: full.codeList.slice(0, codes) };
  return new AR.Dictionary(shortName);
}

/** A square bit string (row by row) turned by 90 degrees. */
function turned(bits) {
  const n = Math.round(Math.sqrt(bits.length));
  let out = "";
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out += bits[(n - 1 - j) * n + i];
  return out;
}

function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/**
 * Minimum distance of codes as the decoder sees them: between any two codes in all four
 * orientations, and between each code and its own turned versions (else a turned marker could be
 * read with a wrong orientation). js-aruco2's tau compares the codes only as they are.
 * @param {string[]} codes bit strings
 */
export function orientedDistance(codes) {
  let d = Infinity;
  for (let i = 0; i < codes.length; i++) {
    let t = codes[i];
    for (let k = 1; k < 4; k++) d = Math.min(d, hamming(codes[i], (t = turned(t))));
    for (let j = i + 1; j < codes.length; j++) {
      t = codes[j];
      for (let k = 0; k < 4; k++, t = turned(t)) d = Math.min(d, hamming(codes[i], t));
    }
  }
  return d;
}

/**
 * Bit errors to accept for the first `codes` codes of a dictionary: as many as the codes can
 * correct unambiguously (less than half their minimum distance). For fewer codes than
 * REFERENCE_CODES (a locked marker map), the codes are compared in all orientations, and only as
 * many errors are accepted as keep chance matches (a random pattern close enough to one of the
 * codes) as rare as with REFERENCE_CODES codes: a single code would otherwise accept anything.
 * Stickers with IDs beyond `codes` must then not be on the layout: they might be read as one of
 * the codes.
 * @param {object} AR js-aruco2 namespace
 * @param {string} name dictionary name
 * @param {number} codes number of codes used (IDs 0 ... codes-1)
 * @param {object} [dict] the js-aruco2 dictionary of these codes (made if not given)
 */
export function acceptedBitErrors(AR, name, codes, dict = null) {
  const full = AR.DICTIONARIES[name];
  dict ||= firstCodes(AR, name, full, codes);
  const safe = (distance) => Math.min(full.nBits, Math.floor((distance - 1) / 2));
  if (codes >= REFERENCE_CODES || full.codeList.length < REFERENCE_CODES) return safe(dict.tau);
  const budget = REFERENCE_CODES * patternsWithin(full.nBits, safe(firstCodes(AR, name, full, REFERENCE_CODES).tau));
  let e = safe(orientedDistance(dict.codeList));
  while (e > 0 && codes * patternsWithin(full.nBits, e) > budget) e--;
  return e;
}

/** Defaults of the `rolling` option (the same as `DEFAULT_ROLLING` of the layout format). */
const ROLLING_OPTIONS = { dictionary: "APRILTAG_36h11", codes: 64, maxBitErrors: 3 };

/** Bit errors of a read relative to the code length: reads in two families are compared by this. */
const errorRate = (read, entry) => read.distance / entry.dict.nBits;

export class MarkerDetector {
  /**
   * @param {object} [options]
   * @param {string | null} [options.dictionary="ARUCO"] js-aruco2 dictionary name, or null/"auto"
   * @param {number} [options.codes=50] number of codes used per dictionary (marker IDs 0..codes-1)
   * @param {{dictionary?: string, codes?: number, maxBitErrors?: number} | null} [options.rolling=null]
   *   rolling-stock tags, a second marker family read in the same pass (see {@link MarkerDetector#detectAll}):
   *   js-aruco2 dictionary name (default "APRILTAG_36h11"), number of codes (default 64, tag IDs
   *   0..codes-1) and the most bit errors corrected (default 3); a missing, null or invalid `codes` or
   *   `maxBitErrors` and a missing or null `dictionary` take the default. Null: layout markers only,
   *   exactly as without this option.
   * @param {object} [options.AR] js-aruco2 `AR` namespace (defaults to the global)
   * @param {object} [options.CV] js-aruco2 `CV` namespace (defaults to the global)
   */
  constructor({ dictionary = "ARUCO", codes = 50, rolling = null, AR = globalThis.AR, CV = globalThis.CV } = {}) {
    if (!AR || !CV) throw new Error("js-aruco2 is not loaded (globals AR and CV are missing)");
    this.AR = AR;
    this.CV = CV;
    this.codes = codes;
    this.det = new AR.Detector({ dictionaryName: "ARUCO" });
    this.dictionaries = [];
    for (const def of DICTIONARIES) {
      const full = AR.DICTIONARIES[def.name];
      if (!full) continue; // dictionary script not loaded
      const dict = firstCodes(AR, def.name, full, codes);
      dict.tau = acceptedBitErrors(AR, def.name, codes, dict) + 1; // find() accepts distances below tau
      this.dictionaries.push({ ...def, dict, cells: Math.round(Math.sqrt(full.nBits)) + 2 });
    }
    /** The `rolling` option as given (the app compares it to decide whether to build a new detector). */
    this.rollingOptions = rolling;
    /**
     * The rolling-stock family {name, label, dict, cells, quarterTurns}, or null. It is not one of
     * `dictionaries` and never takes part in the automatic choice of the layout's dictionary.
     */
    this.rolling = rolling ? this._rollingEntry(rolling) : null;
    this.selected = null;
    this.last = null;
    this.votes = {};
    this.setDictionary(dictionary);
  }

  /**
   * Dictionary entry of the rolling-stock family. Its tags identify moving wagons, so at most
   * `maxBitErrors` bit errors are corrected, even where {@link acceptedBitErrors} would allow more.
   * Each option falls back to its default on its own (see the constructor).
   */
  _rollingEntry({ dictionary = null, codes = null, maxBitErrors = null }) {
    const { AR } = this;
    dictionary ??= ROLLING_OPTIONS.dictionary;
    if (!(Number.isInteger(codes) && codes > 0)) codes = ROLLING_OPTIONS.codes;
    const def = DICTIONARIES.find((d) => d.name === dictionary), full = AR.DICTIONARIES[dictionary];
    if (!def || !full) throw new Error(`Unknown or unloaded dictionary: ${dictionary}`);
    const dict = firstCodes(AR, def.name, full, codes);
    const cap = Number.isFinite(maxBitErrors) ? Math.max(0, Math.floor(maxBitErrors)) : ROLLING_OPTIONS.maxBitErrors;
    dict.tau = Math.min(acceptedBitErrors(AR, def.name, codes, dict), cap) + 1;
    return { name: def.name, label: def.label, dict, cells: Math.round(Math.sqrt(full.nBits)) + 2, quarterTurns: def.quarterTurns || 0 };
  }

  /** Select a dictionary by js-aruco2 name; null or "auto" enables automatic detection. */
  setDictionary(name) {
    this.selected = name && name !== "auto" ? this.dictionaries.find((d) => d.name === name) || null : null;
    if (name && name !== "auto" && !this.selected) throw new Error(`Unknown or unloaded dictionary: ${name}`);
    this.votes = {};
  }

  /** Label of the dictionary in use (or the best guess while detecting automatically). */
  get dictionaryLabel() {
    const d = this.selected || this.last;
    return d ? d.label : null;
  }

  get dictionaryName() {
    const d = this.selected || this.last;
    return d ? d.name : null;
  }

  get autoDetecting() {
    return this.selected === null;
  }

  /** Match bits against a dictionary in all four rotations; corners are reordered to TL, TR, BR, BL. */
  _match(entry, bits, corners) {
    const det = this.det;
    const rotations = [bits];
    let best = null, rot = 0;
    for (let i = 0; i < 4; i++) {
      const f = entry.dict.find(rotations[i]);
      if (f && (!best || f.distance < best.distance)) {
        best = f;
        rot = i;
        if (!f.distance) break;
      }
      rotations[i + 1] = det.rotate(rotations[i]);
    }
    if (!best) return null;
    let c = det.rotate2(corners, 4 - rot);
    if (entry.quarterTurns) c = det.rotate2(c, entry.quarterTurns);
    return { id: best.id, corners: c, distance: best.distance };
  }

  /** Per candidate, its first matching attempt {id, corners, distance} in a dictionary, or null. */
  _decodeEach(entry, candidates) {
    return candidates.map((k) => {
      for (const attempt of k.attempts) {
        const bits = attempt.bits[entry.cells];
        const m = bits && this._match(entry, bits, attempt.corners);
        if (m) return m;
      }
      return null;
    });
  }

  /** Per ID the read with the fewest bit errors (a misread must not replace the real marker): ID -> corners. */
  _bestPerId(reads) {
    const best = {};
    for (const m of reads) if (m && (!best[m.id] || m.distance < best[m.id].distance)) best[m.id] = m;
    const found = {};
    for (const id in best) found[id] = best[id].corners;
    return found;
  }

  /** Decode all candidates in one dictionary: ID -> corners. */
  _decode(entry, candidates) {
    return this._bestPerId(this._decodeEach(entry, candidates));
  }

  /**
   * Candidates read in both families keep the read with fewer bit errors relative to the code
   * length; on a tie the layout marker wins. Returns the layout reads without the ones that lost and
   * marks the rolling-stock reads that lost in `lost` (by candidate).
   */
  _arbitrate(entry, reads, rollingReads, lost) {
    return reads.map((a, k) => {
      const b = rollingReads[k];
      if (!a || !b) return a;
      if (errorRate(a, entry) <= errorRate(b, this.rolling)) {
        lost[k] = true;
        return a;
      }
      return null;
    });
  }

  /**
   * Detect markers.
   * @param {{width: number, height: number, data: Uint8ClampedArray}} imageData RGBA image
   * @param {number} [scale=1] factor from `imageData` pixels to output pixels
   * @returns {Object<number, number[][]>} marker ID -> four corners (TL, TR, BR, BL) in output pixels
   */
  detect(imageData, scale = 1) {
    return this.detectAll(imageData, scale).markers;
  }

  /**
   * Detect the layout's markers and, with the `rolling` option, the rolling-stock tags, in one pass:
   * candidate squares are found and sampled once (with the rolling family's cell count as well).
   * A square that reads as a code in both families keeps the read with fewer bit errors relative to
   * the code length; on a tie it is a layout marker. While the layout's dictionary is detected
   * automatically, the rolling family is not a candidate, and the votes only count reads that are not
   * rolling-stock tags. Without `rolling`, `markers` is exactly what `detect()` always returned.
   * @param {{width: number, height: number, data: Uint8ClampedArray}} imageData RGBA image
   * @param {number} [scale=1] factor from `imageData` pixels to output pixels
   * @returns {{markers: Object<number, number[][]>, rolling: Object<number, number[][]>}} layout markers
   *   and rolling-stock tags (two ID namespaces): ID -> four corners (TL, TR, BR, BL) in output pixels
   */
  detectAll(imageData, scale = 1) {
    const { CV, det, rolling } = this;
    CV.grayscale(imageData, det.grey);
    CV.adaptiveThreshold(det.grey, det.thres, 2, 7);
    det.contours = CV.findContours(det.thres, det.binary);
    const g = det.grey.data, w = det.grey.width, h = det.grey.height;
    // js-aruco2's notTooNear() would drop the smaller of two nearby outlines. For small markers
    // the outline of the white paper border lies within a few pixels of the black square, so the
    // real marker would be dropped; instead all candidates are decoded and duplicates removed by ID.
    const raw = det.clockwiseCorners(det.findCandidates(det.contours, imageData.width * 0.01, 0.05, 10));
    // the rolling family never votes: its tags must not make it the layout's dictionary
    const voters = this.selected ? [this.selected] : rolling ? this.dictionaries.filter((d) => d.name !== rolling.name) : this.dictionaries;
    const sizes = [...new Set((rolling ? [...voters, rolling] : voters).map((d) => d.cells))];
    // Decode with sub-pixel corners first, then with the integer contour corners.
    const candidates = raw.map((c) => {
      const input = c.map((p) => [p.x, p.y]);
      const refined = refineCorners(g, w, h, input);
      const attempts = refined !== input ? [refined, input] : [input];
      return {
        attempts: attempts.map((corners) => {
          const bits = {};
          for (const n of sizes) {
            const cells = sampleCells(g, w, h, corners, n);
            bits[n] = cells && cellsToBits(cells, n);
          }
          return { corners, bits };
        }),
      };
    });

    const tagReads = rolling ? this._decodeEach(rolling, candidates) : null;
    const layoutReads = (entry) => {
      const reads = this._decodeEach(entry, candidates), lost = [];
      return { reads: tagReads ? this._arbitrate(entry, reads, tagReads, lost) : reads, lost };
    };
    let found = {}, tagsLost = [];
    if (this.selected) {
      const r = layoutReads(this.selected);
      found = this._bestPerId(r.reads);
      tagsLost = r.lost;
    } else {
      let best = null;
      for (const entry of voters) {
        const r = layoutReads(entry);
        const f = this._bestPerId(r.reads);
        if (Object.keys(f).length > Object.keys(found).length) {
          found = f;
          best = entry;
          tagsLost = r.lost;
        }
      }
      if (best) {
        this.last = best;
        this.votes[best.name] = (this.votes[best.name] || 0) + Object.keys(found).length;
        if (this.votes[best.name] >= 6) this.selected = best;
      }
    }
    const output = (corners) => refineCorners(g, w, h, corners).map((p) => [p[0] * scale, p[1] * scale]);
    const markers = {}, tags = {};
    for (const id in found) markers[id] = output(found[id]);
    if (tagReads) {
      const kept = this._bestPerId(tagReads.map((m, k) => (tagsLost[k] ? null : m)));
      for (const id in kept) tags[id] = output(kept[id]);
    }
    return { markers, rolling: tags };
  }
}

/**
 * Bits of a marker code as rows of 0/1 (1 = white), e.g. for printing markers.
 * @param {object} AR js-aruco2 namespace
 * @param {string} dictionaryName js-aruco2 dictionary name
 * @param {number} id marker ID
 * @returns {number[][]}
 */
export function markerBits(AR, dictionaryName, id) {
  const def = AR.DICTIONARIES[dictionaryName];
  if (!def) throw new Error(`Unknown or unloaded dictionary: ${dictionaryName}`);
  if (!(id >= 0 && id < def.codeList.length)) throw new Error(`Marker ID ${id} does not exist in ${dictionaryName}`);
  // Let js-aruco2 decode the code format, with a one-code dictionary (avoids computing tau
  // over the whole dictionary, which is slow for 1000 codes).
  const tmp = `${dictionaryName}__ID${id}`;
  AR.DICTIONARIES[tmp] = { nBits: def.nBits, tau: 1, codeList: [def.codeList[id]] };
  const code = new AR.Dictionary(tmp).codeList[0];
  delete AR.DICTIONARIES[tmp];
  const n = Math.round(Math.sqrt(def.nBits));
  let rows = [];
  for (let y = 0; y < n; y++) rows.push([...code.slice(y * n, y * n + n)].map(Number));
  const turns = DICTIONARIES.find((d) => d.name === dictionaryName)?.quarterTurns || 0;
  if (turns === 2) rows = rows.reverse().map((r) => r.reverse()); // match OpenCV's orientation
  return rows;
}
