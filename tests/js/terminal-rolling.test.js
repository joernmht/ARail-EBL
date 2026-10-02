// Model wagons from their rolling-stock tags: tag IDs, pose from one or more tags, size gate,
// outliers, smoothing, the states moving / standing / held / lost, and snapping to tracks.
import assert from "node:assert/strict";
import test from "node:test";

import { createRng, wrapAngle } from "../../web/arail/core/math.js";
import { CARRIER_TYPES } from "../../web/arail/terminal/model.js";
import { ROLLING_DEFAULTS, RollingStock, decodeTag, encodeTag } from "../../web/arail/terminal/rolling.js";

const SCALE = 87;
const mm = (m) => (m * 1000) / SCALE;
const DEG = Math.PI / 180;
const FPS = 30;

/** Every wagon is an Sgns; slots beyond its three spots do not exist. */
function stock(options = {}, tracks = () => []) {
  const bays = CARRIER_TYPES.sgns60.bays_m;
  return new RollingStock({ stride: 4, size_mm: 20, slotAlongMM: (number, slot) => (slot < bays.length ? mm(bays[slot]) : null), tracks, options });
}

/**
 * Lifted tag observations of one wagon at `center` with `heading` (to its A end).
 * @param {{number?: number, slots?: number[], edge?: number, rng?: object, mmJitter?: number, degJitter?: number, offsets?: object}} [o]
 */
function tagsOf(center, heading, { number = 3, slots = [0, 1, 2], edge = 20, rng = null, mmJitter = 0, degJitter = 0, offsets = {} } = {}) {
  const out = {};
  const j = (r) => (rng ? rng.uniform(-r, r) : 0);
  for (const slot of slots) {
    const a = mm(CARRIER_TYPES.sgns60.bays_m[slot]), off = offsets[slot] || [0, 0];
    out[encodeTag(number, slot, 4)] = {
      center: [center[0] + a * Math.cos(heading) + j(mmJitter) + off[0], center[1] + a * Math.sin(heading) + j(mmJitter) + off[1]],
      heading: heading + j(degJitter) * DEG,
      edge_mm: edge,
    };
  }
  return out;
}

/** Feed frames at 30 fps from `t0` for `seconds`; `at(t)` returns the observations. Returns the end time. */
function run(rs, t0, seconds, at) {
  const n = Math.round(seconds * FPS);
  for (let i = 1; i <= n; i++) rs.observe(at(t0 + i / FPS), t0 + i / FPS);
  return t0 + n / FPS;
}

test("tag IDs: wagon number and slot round trip", () => {
  for (const stride of [4, 3]) {
    for (let id = 0; id < 40; id++) {
      const { number, slot } = decodeTag(id, stride);
      assert.ok(number >= 1 && slot >= 0 && slot < stride);
      assert.equal(encodeTag(number, slot, stride), id);
    }
  }
  assert.deepEqual(decodeTag(10, 4), { number: 3, slot: 2 });
  assert.equal(encodeTag(1, 0, 3), 0);
  assert.equal(encodeTag(2, 0, 3), 3);
});

test("pose from one, two and three tags of an Sgns", () => {
  const C = [412.3, 251.7], H = 0.6;
  for (const slots of [[0], [1], [2], [0, 2], [1, 2], [0, 1, 2]]) {
    const rs = stock();
    rs.observe(tagsOf(C, H, { slots }), 0);
    const w = rs.wagons.get(3);
    assert.ok(w, `slots ${slots}`);
    assert.ok(Math.hypot(w.center[0] - C[0], w.center[1] - C[1]) < 0.1, `centre from slots ${slots}`);
    assert.ok(Math.abs(wrapAngle(w.heading - H)) < 1e-6, `heading from slots ${slots}`);
    assert.deepEqual(w.tags, slots);
    assert.equal(w.seen, slots.length);
    assert.equal(w.state, "moving", "not yet known to stand");
  }
  // jittered tags (±0.5 mm, ±1°): three tags give the centre within 1 mm and the heading within 0.5°
  const rng = createRng(7);
  let worstC = 0, worstH = 0;
  for (let k = 0; k < 300; k++) {
    const rs = stock(), h = rng.uniform(-Math.PI, Math.PI);
    rs.observe(tagsOf(C, h, { rng, mmJitter: 0.5, degJitter: 1 }), 0);
    const w = rs.wagons.get(3);
    worstC = Math.max(worstC, Math.hypot(w.center[0] - C[0], w.center[1] - C[1]));
    worstH = Math.max(worstH, Math.abs(wrapAngle(w.heading - h)));
  }
  assert.ok(worstC < 1, `centre error ${worstC.toFixed(3)} mm`);
  assert.ok(worstH < 0.5 * DEG, `heading error ${(worstH / DEG).toFixed(3)}°`);
});

test("size gate, unknown slots and outlier tags", () => {
  const C = [300, 200];
  let rs = stock();
  rs.observe(tagsOf(C, 0, { edge: 30 }), 0);
  assert.equal(rs.wagons.size, 0, "a 30 mm edge is not a 20 mm tag");
  rs.observe(tagsOf(C, 0, { edge: 20.5 }), 0.1);
  assert.equal(rs.wagons.get(3).tags.length, 3);
  // ID 3 would be slot 3 of wagon 1, which an Sgns does not have
  rs = stock();
  rs.observe({ 3: { center: [10, 10], heading: 0, edge_mm: 20 } }, 0);
  assert.equal(rs.wagons.size, 0);
  rs.observe({ 3: { center: [10, 10], heading: 0, edge_mm: 20 }, ...tagsOf(C, 0, { number: 1, slots: [0] }) }, 0.1);
  assert.deepEqual(rs.wagons.get(1).tags, [0]);
  // a tag 8 mm off the others is dropped
  rs = stock();
  rs.observe(tagsOf(C, 0.3, { offsets: { 0: [0, 8] } }), 0);
  const w = rs.wagons.get(3);
  assert.deepEqual(w.tags, [1, 2]);
  assert.ok(Math.hypot(w.center[0] - C[0], w.center[1] - C[1]) < 0.1);
  assert.ok(Math.abs(w.heading - 0.3) < 1e-6);
  // two tags that disagree: the one that fits the previous pose wins
  rs.observe(tagsOf(C, 0.3, { slots: [0, 2], offsets: { 0: [15, 0] } }), 0.1);
  assert.deepEqual(rs.wagons.get(3).tags, [2]);
  assert.ok(Math.hypot(rs.wagons.get(3).center[0] - C[0], rs.wagons.get(3).center[1] - C[1]) < 0.1);
});

test("states: standing after a second, moving, held through gaps, lost, still images", () => {
  const C = [500, 300];
  const rs = stock();
  rs.observe(tagsOf(C, 0), 0);
  const w = rs.wagons.get(3);
  assert.equal(w.firstSeen, 0);
  let t = run(rs, 0, 0.9, () => tagsOf(C, 0));
  assert.equal(w.state, "moving", "not standing before standing_s");
  t = run(rs, t, 0.1, () => tagsOf(C, 0));
  assert.equal(w.state, "standing", "standing after 1 s");
  assert.ok(w.speed < 0.01);
  // moving at 4 mm/s
  const t0 = t;
  t = run(rs, t, 2, (s) => tagsOf([C[0] + 4 * (s - t0), C[1]], 0));
  assert.equal(w.state, "moving");
  assert.ok(Math.abs(w.speed - 4) < 0.1, `speed ${w.speed}`);
  // a moving wagon whose tags vanish is held for movingHold_s, then lost
  const x = C[0] + 8;
  t = run(rs, t, 0.4, () => ({}));
  assert.equal(w.state, "held");
  assert.equal(w.stood, false, "held while it was moving");
  assert.deepEqual(w.tags, []);
  t = run(rs, t, 0.2, () => ({}));
  assert.equal(w.state, "lost");
  assert.ok(Math.abs(w.center[0] - x) < 1, "the pose is kept");
  // back again: moving until it has stood for a second, then a 2 s gap keeps it held
  t = run(rs, t, 1.1, () => tagsOf([x, C[1]], 0));
  assert.equal(w.state, "standing");
  t = run(rs, t, 2, () => ({}));
  assert.equal(w.state, "held");
  assert.equal(w.stood, true, "held after it stood still");
  t = run(rs, t, 0.1, () => tagsOf([x, C[1]], 0));
  assert.equal(w.state, "standing", "still standing after the gap");
  t = run(rs, t, ROLLING_DEFAULTS.hold_s - 0.1, () => ({}));
  assert.equal(w.state, "held");
  t = run(rs, t, 0.2, () => ({}));
  assert.equal(w.state, "lost", "lost after hold_s");
  assert.equal(w.seen, 3);
  // jitter of a standing wagon (±0.5 mm, ±1°) and a slow creep of 2 mm/s are not moving
  const quiet = stock(), rng = createRng(3);
  let tq = run(quiet, 0, 1.2, () => tagsOf(C, 0, { rng, mmJitter: 0.5, degJitter: 1 }));
  assert.equal(quiet.wagons.get(3).state, "standing");
  const states = new Set();
  for (let i = 0; i < 5 * FPS; i++) {
    tq += 1 / FPS;
    quiet.observe(tagsOf([C[0] + 2 * (tq - 1.2), C[1]], 0, { rng, mmJitter: 0.5, degJitter: 1 }), tq);
    states.add(quiet.wagons.get(3).state);
  }
  assert.deepEqual([...states], ["standing"]);
  // a still image: standing at once
  const photo = stock();
  photo.observe(tagsOf(C, 1), 10, { still: true });
  assert.equal(photo.wagons.get(3).state, "standing");
  assert.equal(photo.wagons.get(3).speed, 0);
  // ... and stays standing when live frames of the same pose follow
  run(photo, 10, 0.2, () => tagsOf(C, 1));
  assert.equal(photo.wagons.get(3).state, "standing");
});

test("a wagon that stops is standing about standing_s later, whatever its speed", () => {
  const C = [500, 300];
  for (const v of [5, 20, 50, 100]) {
    const rs = stock();
    const stop = run(rs, 0, 2, (s) => tagsOf([C[0] + v * s, C[1]], 0));
    const w = rs.wagons.get(3);
    assert.equal(w.state, "moving", `${v} mm/s`);
    let t = stop;
    while (w.state !== "standing" && t < stop + 5) t = run(rs, t, 1 / FPS, () => tagsOf([C[0] + v * stop, C[1]], 0));
    // the window must hold less than standing_mm_s · standing_s of travel: a slow wagon gets there
    // sooner, a fast one once its smoothed pose has settled
    const { standing_s, standing_mm_s, tau_s } = ROLLING_DEFAULTS, latency = t - stop;
    const earliest = standing_s * (1 - standing_mm_s / v) - 1e-9, limit = standing_s + 3 * tau_s;
    assert.ok(latency >= earliest && latency <= limit, `${v} mm/s: standing after ${latency.toFixed(2)} s`);
  }
});

test("smoothing, jumps, tags without a pose and reset", () => {
  const C = [500, 300];
  const rs = stock();
  let t = run(rs, 0, 1.5, () => tagsOf(C, 0));
  const w = rs.wagons.get(3);
  assert.equal(w.state, "standing");
  // a 10 mm step is smoothed (tau 0.15 s)
  rs.observe(tagsOf([C[0] + 10, C[1]], 0), (t += 1 / FPS));
  const a = 1 - Math.exp(-1 / FPS / ROLLING_DEFAULTS.tau_s);
  assert.ok(Math.abs(w.center[0] - (C[0] + 10 * a)) < 1e-6);
  t = run(rs, t, 1, () => tagsOf([C[0] + 10, C[1]], 0));
  assert.ok(Math.abs(w.center[0] - (C[0] + 10)) < 0.05);
  // a jump of more than 30 mm resets the smoothing: the new pose at once, moving until it stands
  rs.observe(tagsOf([C[0] + 50, C[1]], 0), (t += 1 / FPS));
  assert.ok(Math.abs(w.center[0] - (C[0] + 50)) < 1e-9);
  assert.equal(w.state, "moving");
  t = run(rs, t, 1, () => tagsOf([C[0] + 50, C[1]], 0));
  assert.equal(w.state, "standing");
  // tags without a pose (no camera pose) keep the wagon held, however long
  t = run(rs, t, 6, () => ({ 8: { center: null, heading: null, edge_mm: null } }));
  assert.equal(w.state, "held");
  assert.deepEqual(w.tags, [0]);
  assert.ok(Math.abs(w.center[0] - (C[0] + 50)) < 1e-6);
  // ... but do not create unknown wagons
  rs.observe({ 20: { center: null, heading: null, edge_mm: null } }, (t += 1 / FPS));
  assert.ok(!rs.wagons.has(6));
  // reset: every wagon lost, poses kept
  rs.reset();
  assert.equal(w.state, "lost");
  assert.ok(Math.abs(w.center[0] - (C[0] + 50)) < 1e-6);
  rs.observe(tagsOf(C, 0), (t += 1 / FPS));
  assert.equal(w.state, "moving");
  assert.ok(Math.abs(w.center[0] - C[0]) < 1e-9, "no smoothing towards the old pose");
});

test("snapping to the nearest track within 8 mm and 15°", () => {
  const track = { points: [[0, 100], [400, 100], [800, 500]] };
  const rs = stock({}, () => [track, { points: [[0, 130], [400, 130]] }]);
  rs.observe(tagsOf([200, 106], 5 * DEG), 0);
  let w = rs.wagons.get(3);
  assert.ok(Math.hypot(w.center[0] - 200, w.center[1] - 100) < 1e-6, "snapped onto the centre line");
  assert.ok(Math.abs(w.heading) < 1e-9);
  // facing the other way: snapped with the track direction reversed
  rs.reset();
  rs.observe(tagsOf([200, 96], Math.PI - 10 * DEG), 1);
  assert.ok(Math.abs(w.center[1] - 100) < 1e-6);
  assert.ok(Math.abs(wrapAngle(w.heading - Math.PI)) < 1e-9);
  // on the diagonal part
  rs.reset();
  rs.observe(tagsOf([600 + 3, 300 - 3], 45 * DEG), 2);
  assert.ok(Math.hypot(w.center[0] - 600, w.center[1] - 300) < 1e-6);
  assert.ok(Math.abs(w.heading - 45 * DEG) < 1e-9);
  // too far off, or turned too much: not snapped
  for (const [c, h] of [[[200, 109], 0], [[200, 104], 20 * DEG]]) {
    rs.reset();
    rs.observe(tagsOf(c, h), 3);
    w = rs.wagons.get(3);
    assert.ok(Math.hypot(w.center[0] - c[0], w.center[1] - c[1]) < 1e-6);
    assert.ok(Math.abs(w.heading - h) < 1e-9);
  }
  // the nearer of two tracks wins
  rs.reset();
  rs.observe(tagsOf([200, 124], 0), 4);
  assert.ok(Math.abs(rs.wagons.get(3).center[1] - 130) < 1e-6);
  // just beyond a track's end (the second track ends at x = 400): moved sideways only
  rs.reset();
  rs.observe(tagsOf([405, 126], 0), 5);
  w = rs.wagons.get(3);
  assert.ok(Math.hypot(w.center[0] - 405, w.center[1] - 130) < 1e-6);
  // far beyond a track's end, in line with it: not snapped
  for (const c of [[-100, 106], [2000, 134]]) {
    rs.reset();
    rs.observe(tagsOf(c, 0), 6);
    w = rs.wagons.get(3);
    assert.ok(Math.hypot(w.center[0] - c[0], w.center[1] - c[1]) < 1e-6, `${c} not snapped`);
  }
});

test("snapping many wagons to many long tracks fits in a frame", () => {
  // 30 tracks of 200 points each (without lengths), 20 wagons
  const tracks = [];
  for (let k = 0; k < 30; k++) tracks.push({ points: Array.from({ length: 200 }, (_, i) => [i * 10, 100 + 60 * k + 0.001 * i * i]) });
  let calls = 0;
  const rs = stock({}, () => (calls++, tracks));
  const frame = () => {
    const out = {};
    for (let n = 1; n <= 20; n++) Object.assign(out, tagsOf([100 * n, 100 + 60 * (n % 30) + 0.01 * n * n * 100 + 2], 0, { number: n }));
    return out;
  };
  const obs = frame();
  rs.observe(obs, 0);
  assert.equal(calls, 1, "the tracks are fetched once per frame");
  const t0 = performance.now();
  for (let i = 1; i <= 30; i++) rs.observe(obs, i / FPS);
  const perFrame = (performance.now() - t0) / 30;
  assert.ok(perFrame < 8, `${perFrame.toFixed(2)} ms per frame`);
  assert.equal(rs.wagons.size, 20);
});
