/**
 * Pinhole camera with an estimated, manual or calibrated focal length and optional
 * lens distortion (OpenCV model: k1, k2, p1, p2, k3).
 * @module arail/core/camera
 */
import { median } from "./math.js";

/** File format written by `arail-calibrate` (see docs/calibration.md). */
export const CALIBRATION_FORMAT = "arail-camera/1";

/**
 * Parse and validate a camera calibration (JSON object as written by `arail-calibrate`).
 * @returns {{width: number, height: number, fx: number, fy: number, cx: number, cy: number,
 *   dist: number[], rms: number | null}}
 */
export function parseCalibration(json) {
  const [width, height] = json.image_size || [];
  const K = json.camera_matrix;
  if (!(width > 0 && height > 0) || !Array.isArray(K) || K.length !== 3) {
    throw new Error("Not a camera calibration: expected image_size and camera_matrix");
  }
  const dist = (json.distortion || []).slice(0, 5).map(Number);
  while (dist.length < 5) dist.push(0);
  const cal = { width, height, fx: +K[0][0], fy: +K[1][1], cx: +K[0][2], cy: +K[1][2], dist, rms: json.rms_px ?? null };
  if (![cal.fx, cal.fy, cal.cx, cal.cy, ...dist].every(Number.isFinite) || cal.fx <= 0 || cal.fy <= 0) {
    throw new Error("Camera calibration contains invalid numbers");
  }
  return cal;
}

export class Camera {
  constructor(width = 1280, height = 720) {
    this.width = 0;
    this.height = 0;
    /** Calibration in its own resolution, see {@link parseCalibration}. */
    this.calibration = null;
    this.manualFocal = null;
    this.autoFocal = null;
    this.samples = [];
    this.setSize(width, height);
  }

  /** Change the image size; resets focal estimates. Returns true if the size changed. */
  setSize(width, height) {
    if (width === this.width && height === this.height) return false;
    this.width = width;
    this.height = height;
    this.samples = [];
    this.autoFocal = null;
    this.manualFocal = null;
    return true;
  }

  /** Calibration scaled to the current image size, or null (none, or other aspect ratio). */
  get scaledCalibration() {
    const c = this.calibration;
    if (!c) return null;
    const sx = this.width / c.width, sy = this.height / c.height;
    if (Math.abs(sx - sy) > 0.02 * sx) return null;
    return { fx: c.fx * sx, fy: c.fy * sy, cx: c.cx * sx, cy: c.cy * sy, dist: c.dist };
  }

  get calibrated() {
    return this.scaledCalibration !== null;
  }

  /** Intrinsics {fx, fy, cx, cy} in pixels of the current image size. */
  get intrinsics() {
    const c = this.scaledCalibration;
    if (c) return { fx: c.fx, fy: c.fy, cx: c.cx, cy: c.cy };
    const f = this.focal;
    return { fx: f, fy: f, cx: this.width / 2, cy: this.height / 2 };
  }

  get focal() {
    const c = this.scaledCalibration;
    if (c) return c.fx;
    return this.manualFocal || this.autoFocal || 0.8 * Math.max(this.width, this.height);
  }

  /** Where the focal length comes from: "calibrated", "manual", "estimated" or "default". */
  get focalSource() {
    if (this.calibrated) return "calibrated";
    if (this.manualFocal) return "manual";
    if (this.autoFocal) return "estimated";
    return "default";
  }

  /** Accept only calibrations; aspect ratio mismatches are reported, not applied. */
  setCalibration(json) {
    this.calibration = json ? parseCalibration(json) : null;
    return this.calibrated;
  }

  setManualFocal(f) {
    this.manualFocal = f > 0 ? f : null;
  }

  /** Add a focal length estimate (px); the median of the latest estimates is used. */
  addFocalSample(f) {
    this.samples.push(f);
    if (this.samples.length > 600) this.samples.shift();
    this.autoFocal = median(this.samples);
  }

  /** Remove lens distortion from image points (px), keeping the camera matrix. */
  undistortPoints(points) {
    const c = this.scaledCalibration;
    if (!c || c.dist.every((v) => v === 0)) return points;
    const [k1, k2, p1, p2, k3] = c.dist;
    return points.map(([u, v]) => {
      const x0 = (u - c.cx) / c.fx, y0 = (v - c.cy) / c.fy;
      let x = x0, y = y0;
      for (let i = 0; i < 10; i++) {
        const r2 = x * x + y * y;
        const radial = 1 + r2 * (k1 + r2 * (k2 + r2 * k3));
        const dx = 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
        const dy = p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
        x = (x0 - dx) / radial;
        y = (y0 - dy) / radial;
      }
      return [c.fx * x + c.cx, c.fy * y + c.cy];
    });
  }

  /**
   * Project a point in camera coordinates (mm, z forward) to pixels.
   * @returns {number[] | null} null if the point is behind the camera
   */
  project(X) {
    if (!(X[2] > 1e-3)) return null;
    const c = this.scaledCalibration;
    let x = X[0] / X[2], y = X[1] / X[2];
    if (c && c.dist.some((v) => v !== 0)) {
      const [k1, k2, p1, p2, k3] = c.dist;
      // The polynomial model is only valid near the image; clamp far-away points.
      const r2 = Math.min(x * x + y * y, 2.5);
      const radial = 1 + r2 * (k1 + r2 * (k2 + r2 * k3));
      const xd = x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
      const yd = y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
      x = xd;
      y = yd;
      return [c.fx * x + c.cx, c.fy * y + c.cy];
    }
    const K = this.intrinsics;
    return [K.fx * x + K.cx, K.fy * y + K.cy];
  }
}
