// Curves of trams (core/curves.js): the corners of a driving line rounded to a radius, the stops
// and centre line positions carried over, curves that do not fit reported, stub ends and kinks left
// as they are, points where the line folds back left out.
import assert from "node:assert/strict";
import test from "node:test";

import { TRAM_CURVES, polylineLengths, roundCorners } from "../../web/arail/index.js";

/** A driving line through the points (centre line positions = its own arc lengths unless given). */
function line(points, centre) {
  const lengths = polylineLengths(points);
  return { points, lengths, length: lengths.at(-1), speeds: points.slice(1).map(() => 14), marks: [0, 500, lengths.at(-1)], centre: centre || lengths.slice() };
}

const R = 287; // 25 m in H0, mm

test("a corner becomes an arc of the radius, tangent to the straights; stops and positions are carried over", () => {
  assert.deepEqual([TRAM_CURVES.min_m, TRAM_CURVES.standard_m], [25, 40]);
  const out = roundCorners(line([[0, 0], [1000, 0], [1000, 1000]]), R, { metre: 1000 / 87 });
  assert.equal(out.curves.length, 1);
  assert.ok(Math.abs(out.curves[0].radius - R) < 1e-6);
  assert.deepEqual(out.tight, []);
  // two straights of 713 mm and a quarter circle
  assert.ok(Math.abs(out.length - (2 * (1000 - R) + (Math.PI / 2) * R)) < 0.5, `${out.length}`);
  // no turn of more than 5° at any point
  const P = out.points;
  for (let i = 1; i < P.length - 1; i++) {
    const a = [P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]], b = [P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]];
    assert.ok(Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])) <= (5 * Math.PI) / 180 + 1e-9);
  }
  // a stop before the curve stays where it was; the end moves up by what the curve saves
  assert.equal(out.marks[1], 500);
  assert.ok(Math.abs(out.marks[2] - out.length) < 1e-6);
  // the centre line positions run on through the curve
  assert.ok(out.centre.every((c, i) => i === 0 || c >= out.centre[i - 1] - 1e-9));
  // slow in the curve: √(0.8 m/s² × 25 m)
  const k = out.lengths.findIndex((s) => s > out.curves[0].s0 + 1);
  assert.ok(Math.abs(out.speeds[k - 1] - Math.sqrt(0.8 * 25)) < 0.01);
  assert.equal(out.speeds[0], 14);
});

test("a curve made of points bending too tightly is one corner; a curve that bends gently stays", () => {
  // a quarter circle of 90 mm (8 m) drawn with points: rounded to 25 m
  const tight = [];
  for (let k = 0; k <= 4; k++) tight.push([300 + 90 * Math.cos(-Math.PI / 2 + (k * Math.PI) / 8), 90 + 90 * Math.sin(-Math.PI / 2 + (k * Math.PI) / 8)]);
  const a = roundCorners(line([[0, 0], ...tight, [390, 690]]), R);
  assert.equal(a.curves.length, 1);
  assert.ok(Math.abs(a.curves[0].radius - R) < 1e-6);
  // a quarter circle of 1000 mm (87 m): left as it is
  const gentle = [];
  for (let k = 0; k <= 16; k++) gentle.push([1000 + 1000 * Math.cos(-Math.PI / 2 + (k * Math.PI) / 32), 1000 + 1000 * Math.sin(-Math.PI / 2 + (k * Math.PI) / 32)]);
  const b = roundCorners(line([[0, 0], ...gentle, [2000, 2000]]), R);
  assert.deepEqual([b.curves.length, b.tight.length], [0, 0]);
});

test("curves that do not fit are as large as there is room for, and said so; S-curves and stub ends", () => {
  // two corners 400 mm apart turning the same way (a narrow loop): 200 mm each at most
  const u = roundCorners(line([[0, 0], [1000, 0], [1000, 400], [0, 400]]), R);
  assert.deepEqual(u.curves.map((c) => Math.round(c.radius)), [200, 200]);
  assert.deepEqual(u.tight.map((t) => Math.round(t.radius)), [200, 200]);
  // right, then left, with room for both
  const s = roundCorners(line([[0, 0], [1000, 0], [1000, -600], [2000, -600]]), R);
  assert.deepEqual(s.curves.map((c) => Math.round(c.radius)), [R, R]);
  // the end of a stub track: out and back on the same centre line position, left as it is
  const pts = [[0, 0], [500, 0]], centre = [0, 500];
  for (let j = 0; j <= 10; j++) {
    pts.push([500 + 20 * Math.sin((Math.PI * j) / 10), 20 - 20 * Math.cos((Math.PI * j) / 10)]);
    centre.push(500);
  }
  pts.push([0, 40]);
  centre.push(1000);
  const stub = roundCorners(line(pts, centre), R);
  assert.deepEqual([stub.curves.length, stub.tight.length], [0, 0]);
});

test("a point where the line folds back for a moment is left out; a kink beside a curve does not take its room", () => {
  // a point 0.3 mm back, and a corner point behind the samples that turned already
  const fold = roundCorners(line([[0, 0], [500, 0], [499.7, 0], [1000, 0], [1000, 600]]), R);
  assert.deepEqual([fold.curves.length, fold.tight.length], [1, 0]);
  const back = roundCorners(line([[0, 0], [600, 0], [680, -46], [640, -10], [700, -57], [1200, -346]]), R);
  assert.deepEqual(back.tight, []);
  // a 30° turn, then a kink of 0.5° 6 mm on
  const kink = roundCorners(line([[0, 0], [600, 0], [860, -150], [865.2, -153.03], [1300, -405]]), R);
  assert.deepEqual(kink.tight, []);
  assert.ok(kink.curves.some((c) => Math.abs(c.radius - R) < 1e-6));
});
