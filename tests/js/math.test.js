import assert from "node:assert/strict";
import test from "node:test";

import {
  applyH, createRng, homography4, homographyLS, inv3, isConvex, meanAngle, pointInPolygon, polygonArea,
  polylineAt, polylineProject, poseApply, poseCompose, poseInverse, poseInverseApply, similarity, solve, wrapAngle,
} from "../../web/arail/core/math.js";
import {
  focalFromHomography, markerCorners, markerHomography, poseFromHomography, relativeMarkerPose, spread, toCamera,
} from "../../web/arail/core/geometry.js";
import { Camera, parseCalibration } from "../../web/arail/core/camera.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} != ${b} (±${tol})`);

/** Homography plane -> image of a pinhole camera looking at the plane z = 0 from above. */
function planeCamera({ f = 900, cx = 640, cy = 360, tiltDeg = 45, dist = 800, yawDeg = 10 } = {}) {
  const t = (tiltDeg * Math.PI) / 180, y = (yawDeg * Math.PI) / 180;
  // world -> camera rotation: yaw about z, then tilt about x (camera looks down at the plane)
  const Rz = [[Math.cos(y), -Math.sin(y), 0], [Math.sin(y), Math.cos(y), 0], [0, 0, 1]];
  const Rx = [[1, 0, 0], [0, -Math.cos(t), -Math.sin(t)], [0, Math.sin(t), -Math.cos(t)]];
  const R = Rx.map((r) => [0, 1, 2].map((j) => r[0] * Rz[0][j] + r[1] * Rz[1][j] + r[2] * Rz[2][j]));
  const T = [0, 0, dist];
  const K = [f, 0, cx, 0, f, cy, 0, 0, 1];
  const M = [R[0][0], R[0][1], T[0], R[1][0], R[1][1], T[1], R[2][0], R[2][1], T[2]];
  const H = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) H.push(K[i * 3] * M[j] + K[i * 3 + 1] * M[3 + j] + K[i * 3 + 2] * M[6 + j]);
  return { H: H.map((v) => v / H[8]), R, T, K: { fx: f, fy: f, cx, cy } };
}

test("solve and inverse", () => {
  const x = solve([[2, 1, 0], [1, 3, 1], [0, 1, 4]], [3, 5, 5]);
  assert.deepEqual(x.map((v) => Math.round(v * 1e9) / 1e9), [1, 1, 1]);
  assert.equal(solve([[1, 2], [2, 4]], [1, 2]), null);
  const m = [2, 0, 1, 0, 3, 0, 1, 0, 1];
  const mi = inv3(m);
  close(mi[0] * m[0] + mi[1] * m[3] + mi[2] * m[6], 1, 1e-12);
});

test("homographies: exact and least squares agree on noise-free data", () => {
  const { H } = planeCamera();
  const src = [[-100, -50], [120, -40], [130, 90], [-90, 110], [0, 0], [50, 20], [-60, 30]];
  const dst = src.map((p) => applyH(H, p));
  const H4 = homography4(src.slice(0, 4), dst.slice(0, 4));
  const HL = homographyLS(src, dst);
  for (const p of [[10, 10], [-200, 150], [300, -100]]) {
    const a = applyH(H, p), b = applyH(H4, p), c = applyH(HL, p);
    close(b[0], a[0], 1e-6);
    close(c[1], a[1], 1e-6);
  }
});

test("similarity transform", () => {
  const src = [[0, 0], [10, 0], [0, 10]];
  const dst = src.map(([x, y]) => [2 * (x * Math.cos(1) - y * Math.sin(1)) + 5, 2 * (x * Math.sin(1) + y * Math.cos(1)) - 3]);
  const f = similarity(src, dst);
  const p = f([4, 7]);
  close(p[0], 2 * (4 * Math.cos(1) - 7 * Math.sin(1)) + 5, 1e-9);
});

test("2D poses compose and invert", () => {
  const a = { x: 10, y: -5, theta: 0.7 }, b = { x: 3, y: 4, theta: -0.2 };
  const p = [2, 9];
  const ab = poseCompose(a, b);
  const q1 = poseApply(ab, p), q2 = poseApply(a, poseApply(b, p));
  close(q1[0], q2[0], 1e-9);
  close(q1[1], q2[1], 1e-9);
  const back = poseInverseApply(a, poseApply(a, p));
  close(back[0], p[0], 1e-9);
  const id = poseCompose(a, poseInverse(a));
  close(id.x, 0, 1e-9);
  close(id.theta, 0, 1e-9);
  close(wrapAngle(3 * Math.PI), Math.PI, 1e-9);
  close(meanAngle([Math.PI - 0.1, -Math.PI + 0.1]), Math.PI, 1e-9);
});

test("polygons and polylines", () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(polygonArea(sq), 100);
  assert.ok(pointInPolygon([5, 5], sq));
  assert.ok(!pointInPolygon([15, 5], sq));
  assert.ok(isConvex(sq));
  assert.ok(!isConvex([[0, 0], [10, 0], [2, 2], [0, 10]]));
  const line = [[0, 0], [100, 0], [100, 100]];
  const at = polylineAt(line, 150);
  assert.deepEqual(at.point, [100, 50]);
  assert.deepEqual(at.dir, [0, 1]);
  const pr = polylineProject(line, [50, 10]);
  close(pr.s, 50, 1e-9);
  close(pr.distance, 10, 1e-9);
  assert.equal(pr.side, 1); // left of the direction of travel
});

test("seeded random numbers are reproducible", () => {
  const a = createRng(42), b = createRng(42);
  for (let i = 0; i < 5; i++) assert.equal(a.next(), b.next());
  const r = createRng(7);
  const n = 20000;
  let s = 0;
  for (let i = 0; i < n; i++) s += r.poisson(2.5);
  close(s / n, 2.5, 0.05);
});

test("relative marker pose recovers distance and directions without calibration", () => {
  const { H } = planeCamera({ tiltDeg: 50, yawDeg: 25 });
  const size = 30;
  // marker a at (0, 0) rotated 0; marker b at (400, 150) rotated 30 degrees
  const place = (x, y, deg) => {
    const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
    return markerCorners(size).map(([u, v]) => applyH(H, [x + c * u - s * v, y + s * u + c * v]));
  };
  const Ha = markerHomography(place(0, 0, 0), size), Hb = markerHomography(place(400, 150, 30), size);
  const rel = relativeMarkerPose(Ha, Hb);
  close(rel.distance, Math.hypot(400, 150), 0.5, "distance");
  const dirTrue = Math.atan2(150, 400);
  close(Math.atan2(rel.dirA[1], rel.dirA[0]), dirTrue, 1e-6, "direction in a");
  close(Math.atan2(rel.dirB[1], rel.dirB[0]), dirTrue - (30 * Math.PI) / 180, 1e-6, "direction in b");
});

test("focal length and pose from a plane homography", () => {
  const cam = planeCamera({ f: 1111, tiltDeg: 40 });
  const r = focalFromHomography(cam.H, 640, 360);
  close(r.f, 1111, 0.01);
  close(r.tiltDeg, 40, 1e-6);
  const pose = poseFromHomography(cam.H, cam.K);
  // a point 100 mm above the plane origin lies on the optical ray through the plane normal
  const X = toCamera(pose, 0, 0, 100);
  const expected = [cam.R[0][2] * 100 * -1 + cam.T[0], cam.R[1][2] * 100 * -1 + cam.T[1], cam.R[2][2] * 100 * -1 + cam.T[2]];
  // plane normal +z of the plane frame points towards the camera: camera sees "up" as -R[:,2] here
  const d = Math.hypot(X[0] - expected[0], X[1] - expected[1], X[2] - expected[2]);
  const d2 = Math.hypot(X[0] - (cam.R[0][2] * 100 + cam.T[0]), X[1] - (cam.R[1][2] * 100 + cam.T[1]), X[2] - (cam.R[2][2] * 100 + cam.T[2]));
  assert.ok(Math.min(d, d2) < 1e-6, "height maps along the plane normal");
  assert.ok(X[2] < cam.T[2], "points above the plane are closer to the camera");
  assert.ok(spread([[0, 0], [100, 0], [200, 0]]) < 1e-9);
  close(spread([[0, 0], [100, 0], [0, 100], [100, 100]]), 50, 1e-9);
});

test("camera: calibration, distortion round trip", () => {
  const cal = parseCalibration({
    image_size: [1280, 720],
    camera_matrix: [[1000, 0, 650], [0, 1000, 350], [0, 0, 1]],
    distortion: [-0.25, 0.08, 0.001, -0.001, 0],
  });
  const cam = new Camera(1920, 1080);
  cam.calibration = cal;
  assert.equal(cam.focalSource, "calibrated");
  close(cam.focal, 1500, 1e-9);
  const X = [120, -80, 500];
  const p = cam.project(X);
  const [u] = cam.undistortPoints([p]);
  const K = cam.intrinsics;
  close(u[0], (K.fx * X[0]) / X[2] + K.cx, 0.01, "undistort(project(X)) = ideal pinhole projection");
  close(u[1], (K.fy * X[1]) / X[2] + K.cy, 0.01);
  const other = new Camera(1000, 1000);
  other.calibration = cal; // different aspect ratio: ignored
  assert.equal(other.calibrated, false);
  assert.throws(() => parseCalibration({ foo: 1 }));
});
