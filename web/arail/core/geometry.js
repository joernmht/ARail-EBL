/**
 * Plane geometry from square markers, without camera calibration.
 *
 * Each detected marker gives a homography H (marker plane in mm -> image pixels).
 * From these we derive
 * - the relative position of two markers on the same plane (see {@link relativeMarkerPose}),
 * - the focal length of the camera (see {@link focalFromHomography}),
 * - the camera pose of the plane (see {@link poseFromHomography}), the camera position
 *   ({@link cameraCentre}) and the image of planes above the layout ({@link planeHomography}).
 * @module arail/core/geometry
 */
import { applyH, cross3, dot3, homography4, inv3, len2 } from "./math.js";

/**
 * Marker corners in the marker frame (mm): top-left, top-right, bottom-right, bottom-left.
 * The marker frame has x to the right and y "up" as printed; this matches the corner
 * order of OpenCV and js-aruco2.
 */
export function markerCorners(size) {
  const h = size / 2;
  return [[-h, h], [h, h], [h, -h], [-h, -h]];
}

/** Homography marker (mm) -> image (px) from the four detected image corners. */
export function markerHomography(imageCorners, size) {
  return homography4(markerCorners(size), imageCorners);
}

/** Image position of the marker centre. */
export const markerCenter = (H) => [H[2] / H[8], H[5] / H[8]];

/** Jacobian of a homography at the origin of its source frame (2x2, row-major). */
export function jacobianAtOrigin(H) {
  const s = 1 / H[8];
  const h = H.map((v) => v * s);
  return [h[0] - h[2] * h[6], h[1] - h[2] * h[7], h[3] - h[5] * h[6], h[4] - h[5] * h[7]];
}

function solve2(J, r) {
  const det = J[0] * J[3] - J[1] * J[2];
  return [(J[3] * r[0] - J[1] * r[1]) / det, (-J[2] * r[0] + J[0] * r[1]) / det];
}

const unit = (v) => {
  const l = len2(v) || 1;
  return [v[0] / l, v[1] / l];
};

/**
 * Relative position of marker b with respect to marker a (both on the same plane),
 * without any camera parameters.
 *
 * Along the image line through both marker centres, the perspective is a 1D
 * projectivity. For such a map the true distance is
 *   distance = pixelDistance / sqrt(localScale_a * localScale_b),
 * where the local scales (px per mm along the line) are well determined by each marker.
 *
 * @param {number[]} Ha homography of marker a (mm -> px)
 * @param {number[]} Hb homography of marker b (mm -> px)
 * @returns {{distance: number, dirA: number[], dirB: number[]} | null}
 *   distance between the centres in mm, and the unit direction a -> b expressed in the
 *   frame of marker a (`dirA`) and in the frame of marker b (`dirB`).
 */
export function relativeMarkerPose(Ha, Hb) {
  const ca = markerCenter(Ha), cb = markerCenter(Hb);
  const D = Math.hypot(cb[0] - ca[0], cb[1] - ca[1]);
  if (D < 1) return null;
  const r = [(cb[0] - ca[0]) / D, (cb[1] - ca[1]) / D];
  const Ja = jacobianAtOrigin(Ha), Jb = jacobianAtOrigin(Hb);
  const dirA = unit(solve2(Ja, r)), dirB = unit(solve2(Jb, r));
  const sa = len2([Ja[0] * dirA[0] + Ja[1] * dirA[1], Ja[2] * dirA[0] + Ja[3] * dirA[1]]);
  const sb = len2([Jb[0] * dirB[0] + Jb[1] * dirB[1], Jb[2] * dirB[0] + Jb[3] * dirB[1]]);
  const distance = D / Math.sqrt(sa * sb);
  return Number.isFinite(distance) ? { distance, dirA, dirB } : null;
}

/**
 * Focal length from a plane homography, assuming square pixels and the principal point
 * at (cx, cy). Uses the orthonormality of the first two rotation columns.
 * @returns {{f: number, tiltDeg: number} | null} focal length in px and the tilt of the
 *   plane against the image plane (0 = camera looks straight down).
 */
export function focalFromHomography(H, cx, cy) {
  const G = [
    H[0] - cx * H[6], H[1] - cx * H[7], H[2] - cx * H[8],
    H[3] - cy * H[6], H[4] - cy * H[7], H[5] - cy * H[8],
    H[6], H[7], H[8],
  ];
  const h1 = [G[0], G[3], G[6]], h2 = [G[1], G[4], G[7]];
  const a1 = h1[0] * h2[0] + h1[1] * h2[1], b1 = h1[2] * h2[2];
  const a2 = h1[0] ** 2 + h1[1] ** 2 - h2[0] ** 2 - h2[1] ** 2, b2 = h1[2] ** 2 - h2[2] ** 2;
  const denom = a1 * a1 + a2 * a2;
  if (denom <= 0) return null;
  const x = -(a1 * b1 + a2 * b2) / denom; // x = 1 / f^2
  if (!(x > 0)) return null;
  const f = 1 / Math.sqrt(x);
  const r1 = [h1[0] / f, h1[1] / f, h1[2]], r2 = [h2[0] / f, h2[1] / f, h2[2]];
  const n = cross3(r1, r2), nn = Math.hypot(...n);
  if (!nn) return null;
  return { f, tiltDeg: (Math.acos(Math.min(1, Math.abs(n[2]) / nn)) * 180) / Math.PI };
}

/**
 * Square root of the smallest eigenvalue of the covariance of 2D points: how far the
 * points spread in their "thinnest" direction (small = nearly on a line).
 */
export function spread(points) {
  const n = points.length;
  if (n < 2) return 0;
  let mx = 0, my = 0;
  for (const p of points) {
    mx += p[0];
    my += p[1];
  }
  mx /= n;
  my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of points) {
    const dx = p[0] - mx, dy = p[1] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= n;
  syy /= n;
  sxy /= n;
  const lmin = (sxx + syy) / 2 - Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
  return Math.sqrt(Math.max(lmin, 0));
}

/**
 * Camera pose of a plane from its homography (plane mm -> px) and the intrinsics.
 *
 * A point (x, y, z) on/above the plane (mm, z up) has camera coordinates
 *   X = x * a1 + y * a2 + a3 + z * n.
 * @param {number[]} H homography plane -> image
 * @param {{fx: number, fy: number, cx: number, cy: number}} K intrinsics
 * @returns {{a1: number[], a2: number[], a3: number[], n: number[]}}
 */
export function poseFromHomography(H, K) {
  const { fx, fy, cx, cy } = K;
  const M = [
    (H[0] - cx * H[6]) / fx, (H[1] - cx * H[7]) / fx, (H[2] - cx * H[8]) / fx,
    (H[3] - cy * H[6]) / fy, (H[4] - cy * H[7]) / fy, (H[5] - cy * H[8]) / fy,
    H[6], H[7], H[8],
  ];
  const m1 = [M[0], M[3], M[6]], m2 = [M[1], M[4], M[7]], m3 = [M[2], M[5], M[8]];
  let lambda = 2 / (Math.hypot(...m1) + Math.hypot(...m2));
  if (M[8] * lambda < 0) lambda = -lambda; // plane origin in front of the camera
  const a1 = m1.map((v) => v * lambda), a2 = m2.map((v) => v * lambda), a3 = m3.map((v) => v * lambda);
  let n = cross3(a1, a2);
  const nn = Math.hypot(...n) || 1;
  n = n.map((v) => v / nn);
  if (dot3(n, a3) > 0) n = n.map((v) => -v); // normal points towards the camera ("up")
  return { a1, a2, a3, n };
}

/** Camera coordinates (mm) of a layout point (x, y, z) for a pose from {@link poseFromHomography}. */
export function toCamera(pose, x, y, z = 0) {
  const { a1, a2, a3, n } = pose;
  return [
    x * a1[0] + y * a2[0] + a3[0] + z * n[0],
    x * a1[1] + y * a2[1] + a3[1] + z * n[1],
    x * a1[2] + y * a2[2] + a3[2] + z * n[2],
  ];
}

/**
 * Position of the camera in the layout frame for a pose from {@link poseFromHomography}: the point
 * with camera coordinates 0, C = −[a1 a2 n]⁻¹·a3.
 * @param {{a1: number[], a2: number[], a3: number[], n: number[]}} pose
 * @returns {number[] | null} [x, y, z] in layout mm (z above the plane), null for a degenerate pose
 */
export function cameraCentre(pose) {
  const { a1, a2, a3, n } = pose;
  const Minv = inv3([a1[0], a2[0], n[0], a1[1], a2[1], n[1], a1[2], a2[2], n[2]]);
  if (!Minv) return null;
  return [0, 1, 2].map((i) => -(Minv[i * 3] * a3[0] + Minv[i * 3 + 1] * a3[1] + Minv[i * 3 + 2] * a3[2]));
}

/**
 * Homography of the plane at `height` mm above the layout plane (layout x, y in mm -> image px),
 * e.g. for markers on wagons: K·[a1, a2, a3 + height·n] with the pose of `H`. Points are found on
 * that plane with its inverse; the z = 0 homography would shift them away from the camera.
 * Like {@link poseFromHomography}, it assumes that the layout origin is in front of the camera.
 * @param {number[]} H homography layout plane (mm) -> image (px)
 * @param {{fx: number, fy: number, cx: number, cy: number}} K intrinsics
 * @param {number} height height of the plane above the layout (mm)
 * @returns {number[]} 3x3 homography, row-major
 */
export function planeHomography(H, K, height) {
  const { a1, a2, a3, n } = poseFromHomography(H, K);
  const t = [a3[0] + height * n[0], a3[1] + height * n[1], a3[2] + height * n[2]];
  const { fx, fy, cx, cy } = K;
  return [
    fx * a1[0] + cx * a1[2], fx * a2[0] + cx * a2[2], fx * t[0] + cx * t[2],
    fy * a1[1] + cy * a1[2], fy * a2[1] + cy * a2[2], fy * t[1] + cy * t[2],
    a1[2], a2[2], t[2],
  ];
}

/** Map an image point to the plane using the inverse homography (plane -> image). */
export function imageToPlane(Hinv, p) {
  return applyH(Hinv, p);
}
