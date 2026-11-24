// The app's marker detection of videos (web/app/detection.js) with a stand-in worker, canvas and
// video: frames go to the worker once each, their markers come back with the frame they were found in,
// and nothing of another source or of a detector set up otherwise is applied.
import assert from "node:assert/strict";
import test from "node:test";

import { VideoDetection } from "../../web/app/detection.js";

/** A worker that keeps what it is sent; `answer` replies as detect-worker.js does. */
class FakeWorker {
  static last = null;
  constructor() {
    this.sent = [];
    FakeWorker.last = this;
  }
  postMessage(m) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(msg) {
    this.onmessage({ data: msg });
  }
  answer(markers, selected = null) {
    const frame = this.sent.filter((m) => m.type === "frame" || m.type === "bitmap").at(-1);
    this.reply({ type: "markers", id: frame.id, markers, rolling: {}, ms: 12, selected, bitmap: frame.bitmap });
  }
}

let now = 0;
function setup() {
  globalThis.Worker = FakeWorker;
  globalThis.document = {
    createElement: () => {
      const c = { width: 0, height: 0, drawn: [], getContext: () => ({ drawImage: (el) => c.drawn.push(el) }) };
      return c;
    },
  };
  Object.defineProperty(globalThis, "performance", { value: { now: () => now }, configurable: true, writable: true });
}

/** The app's detector as far as VideoDetection sees it. */
function detector(name = null) {
  return {
    codes: 50, rollingOptions: null, selected: name ? { name } : null, searched: 0,
    setDictionary(n) {
      this.selected = n ? { name: n } : null;
    },
    detectAll() {
      this.searched++;
      return { markers: { 3: [[0, 0], [1, 0], [1, 1], [0, 1]] }, rolling: {} };
    },
  };
}
const image = () => ({ width: 4, height: 3, data: new Uint8ClampedArray(48) });
const SIZE = { w: 4, h: 3 };
const source = (name) => ({ el: { name }, w: 8, h: 6 });

test("without a worker every frame is searched on the main thread, and the video itself is shown", () => {
  setup();
  const vd = new VideoDetection({ worker: false }), det = detector("ARUCO"), src = source("clip");
  vd.start(det);
  assert.equal(vd.state, "failed");
  const found = vd.search(src, SIZE, det, image);
  assert.deepEqual(Object.keys(found.markers), ["3"]);
  assert.equal(det.searched, 1);
  assert.equal(vd.picture(src), src.el);
});

test("in the worker: the frame is kept and shown with its markers; until it is ready the main thread searches", () => {
  setup();
  const vd = new VideoDetection(), det = detector("ARUCO"), src = source("camera");
  vd.start(det);
  const w = FakeWorker.last;
  assert.deepEqual(w.sent[0], { type: "init", dictionary: "ARUCO", codes: 50, rolling: null });
  assert.ok(vd.search(src, SIZE, det, image), "starting: searched here");
  w.reply({ type: "ready" });
  assert.equal(vd.state, "ready");
  assert.equal(vd.search(src, SIZE, det, image), null, "ready: in the worker");
  assert.equal(w.sent.filter((m) => m.type === "frame").length, 1);
  assert.equal(w.sent.at(-1).scale, 2, "processing px → picture px");
  assert.equal(vd.wanted(), false, "one frame in the worker at a time");
  assert.equal(vd.take(src, det), null, "no answer yet");
  assert.equal(vd.picture(src), src.el);
  w.answer({ 5: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  const r = vd.take(src, det);
  assert.deepEqual(Object.keys(r.markers), ["5"]);
  const shown = vd.picture(src);
  assert.notEqual(shown, src.el);
  assert.deepEqual(shown.drawn, [src.el], "the frame searched, drawn when it was sent");
  // the next frame goes into the other picture: the one shown stays until its markers are there
  vd.search(src, SIZE, det, image);
  assert.equal(vd.picture(src), shown);
  w.answer({});
  vd.take(src, det);
  assert.notEqual(vd.picture(src), shown);
});

test("markers of another source or of a detector set up otherwise are not applied", () => {
  setup();
  const vd = new VideoDetection(), det = detector(null), a = source("a"), b = source("b");
  vd.start(det);
  const w = FakeWorker.last;
  w.reply({ type: "ready" });
  vd.search(a, SIZE, det, image);
  w.answer({ 1: [] });
  assert.equal(vd.take(b, det), null, "another source shown now");
  // the layout's dictionary changed while a frame was in the worker
  vd.search(a, SIZE, det, image);
  det.setDictionary("ARUCO_4X4_1000");
  w.answer({ 1: [] });
  assert.equal(vd.take(a, det), null);
  // the next frame sets the worker up anew first
  vd.search(a, SIZE, det, image);
  assert.deepEqual(w.sent.slice(-2).map((m) => m.type), ["init", "frame"]);
  assert.equal(w.sent.at(-2).dictionary, "ARUCO_4X4_1000");
  // reset (another source): an answer still on its way is dropped
  vd.reset();
  w.answer({ 1: [] });
  assert.equal(vd.take(a, det), null);
});

test("a dictionary voted for in the worker becomes the app's, without setting the worker up again", () => {
  setup();
  const vd = new VideoDetection(), det = detector(null), src = source("camera");
  vd.start(det);
  const w = FakeWorker.last;
  w.reply({ type: "ready" });
  vd.search(src, SIZE, det, image);
  w.answer({ 0: [] }, "ARUCO_MIP_36h12");
  const r = vd.take(src, det);
  vd.adopt(det, r.selected);
  assert.equal(det.selected.name, "ARUCO_MIP_36h12");
  const inits = w.sent.filter((m) => m.type === "init").length;
  vd.search(src, SIZE, det, image);
  assert.equal(w.sent.filter((m) => m.type === "init").length, inits);
});

test("each new frame of the video once; a browser that announces none still has its frames searched", () => {
  setup();
  now = 1000;
  const vd = new VideoDetection({ worker: false }), det = detector("ARUCO"), src = source("camera");
  let announce = null;
  const video = { requestVideoFrameCallback: (f) => (announce = f) };
  vd.watch(video);
  assert.equal(vd.wanted(), true);
  vd.search(src, SIZE, det, image);
  assert.equal(vd.wanted(), false, "the same frame is not searched twice");
  announce();
  assert.equal(vd.wanted(), true, "a new frame");
  vd.search(src, SIZE, det, image);
  now += 600;
  assert.equal(vd.wanted(), true, "no frame announced for 0.6 s: searched anyway");
});

test("a worker that fails, or never answers a frame, does not stop the search", () => {
  setup();
  now = 0;
  const vd = new VideoDetection(), det = detector("ARUCO"), src = source("camera");
  vd.start(det);
  const w = FakeWorker.last;
  w.reply({ type: "ready" });
  vd.search(src, SIZE, det, image);
  assert.equal(vd.wanted(), false);
  now += 3500;
  assert.equal(vd.wanted(), true, "a frame lost in the worker is given up");
  // its script failed
  w.onerror({ preventDefault() {} });
  assert.equal(vd.state, "failed");
  assert.ok(w.terminated);
  assert.ok(vd.search(src, SIZE, det, image), "searched here from now on");
  // a worker that cannot be made at all
  globalThis.Worker = function () {
    throw new Error("no workers here");
  };
  const other = new VideoDetection();
  other.start(det);
  assert.equal(other.state, "failed");
});

test("a frame the worker cannot search is skipped; setting it up that fails is asked once more, then it is given up", () => {
  setup();
  now = 0;
  const vd = new VideoDetection(), det = detector("ARUCO"), src = source("camera");
  vd.start(det);
  const w = FakeWorker.last;
  // a script of a dictionary not loaded (the network): once more
  w.reply({ type: "error", of: "init", message: "dictionaries/aruco.js: 503" });
  assert.equal(vd.state, "starting");
  assert.deepEqual(w.sent.map((m) => m.type), ["init", "init"]);
  assert.deepEqual(w.sent[1], w.sent[0]);
  w.reply({ type: "ready" });
  assert.equal(vd.state, "ready");
  // a frame that failed: skipped, the next one goes to the worker
  vd.search(src, SIZE, det, image);
  w.reply({ type: "error", of: "frame", id: w.sent.at(-1).id, message: "broken" });
  assert.equal(vd.state, "ready");
  assert.ok(!w.terminated);
  assert.equal(vd.wanted(), true, "the next frame, without waiting for the lost one");
  assert.equal(vd.search(src, SIZE, det, image), null, "in the worker");
  w.answer({ 5: [] });
  assert.deepEqual(Object.keys(vd.take(src, det).markers), ["5"]);
  // set up anew (another dictionary), and failed once: asked once more with the settings of now
  det.setDictionary("ARUCO_4X4_1000");
  vd.search(src, SIZE, det, image);
  w.reply({ type: "error", of: "init", message: "dictionaries/aruco_4x4_1000.js: 503" });
  assert.deepEqual([w.sent.at(-1).type, w.sent.at(-1).dictionary], ["init", "ARUCO_4X4_1000"]);
  w.reply({ type: "ready" });
  // the next failure of setting it up is asked again once, too; the second time it is given up
  det.setDictionary("ARUCO_5X5_1000");
  vd.search(src, SIZE, det, image);
  w.reply({ type: "error", of: "init", message: "503" });
  assert.equal(vd.state, "ready");
  w.reply({ type: "error", of: "init", message: "503" });
  assert.equal(vd.state, "failed");
  assert.ok(w.terminated);
  assert.ok(vd.search(src, SIZE, det, image), "searched here from now on");
  // a worker whose frames all fail is given up after five in a row
  const again = new VideoDetection();
  again.start(det);
  const v = FakeWorker.last;
  v.reply({ type: "ready" });
  for (let i = 0; i < 4; i++) {
    again.search(src, SIZE, det, image);
    v.reply({ type: "error", of: "frame", id: v.sent.at(-1).id, message: "broken" });
  }
  assert.equal(again.state, "ready");
  again.search(src, SIZE, det, image);
  v.answer({});
  again.take(src, det);
  for (let i = 0; i < 5; i++) {
    again.search(src, SIZE, det, image);
    v.reply({ type: "error", of: "frame", id: v.sent.at(-1).id, message: "broken" });
  }
  assert.equal(again.state, "failed", "five in a row");
});

test("with bitmaps the frame goes to the worker unread, and comes back as the picture shown", async () => {
  setup();
  const made = [];
  globalThis.createImageBitmap = async (el, o) => {
    const b = { el, width: o.resizeWidth, height: o.resizeHeight, closed: false, close() { this.closed = true; } };
    made.push(b);
    return b;
  };
  const vd = new VideoDetection(), det = detector("ARUCO"), src = source("camera");
  vd.start(det);
  const w = FakeWorker.last;
  w.reply({ type: "ready", bitmaps: true });
  assert.equal(vd.bitmaps, true);
  let reads = 0;
  const read = () => {
    reads++;
    return image();
  };
  assert.equal(vd.search(src, SIZE, det, read), null);
  await Promise.resolve();
  const sent = w.sent.at(-1);
  assert.equal(sent.type, "bitmap");
  assert.equal(reads, 0, "no pixels read on the main thread");
  assert.deepEqual([sent.bitmap.width, sent.bitmap.height, sent.width, sent.height], [8, 6, 4, 3], "the bitmap as large as the picture, read at the processing size");
  w.answer({ 2: [] });
  vd.take(src, det);
  assert.equal(vd.picture(src), made[0]);
  // the next one replaces it, and the one before is freed
  vd.search(src, SIZE, det, read);
  await Promise.resolve();
  w.answer({});
  vd.take(src, det);
  assert.equal(vd.picture(src), made[1]);
  assert.equal(made[0].closed, true);
  // a bitmap still on its way when the source changes is freed, not shown
  vd.search(src, SIZE, det, read);
  vd.reset();
  await Promise.resolve();
  assert.equal(made[2].closed, true);
  assert.equal(made[1].closed, true);
  // a browser that cannot make a bitmap of the video: read on the main thread from then on
  globalThis.createImageBitmap = () => Promise.reject(new Error("no"));
  vd.search(src, SIZE, det, read);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(vd.bitmaps, false);
  vd.search(src, SIZE, det, read);
  assert.equal(reads, 1);
  assert.equal(w.sent.at(-1).type, "frame");
  delete globalThis.createImageBitmap;
});

test("after a pause (frozen, the flyover) the frame that was in the worker is neither applied nor shown", () => {
  setup();
  now = 0;
  const vd = new VideoDetection(), det = detector("ARUCO"), src = source("camera");
  vd.start(det);
  const w = FakeWorker.last;
  w.reply({ type: "ready" });
  vd.take(src, det);
  vd.search(src, SIZE, det, image);
  w.answer({ 4: [] });
  const shown = vd.take(src, det) && vd.picture(src);
  assert.notEqual(shown, src.el);
  // the next frame goes to the worker, then the camera view pauses for 30 s while it answers
  vd.search(src, SIZE, det, image);
  w.answer({ 4: [] });
  now += 30_000;
  assert.equal(vd.take(src, det), null, "its markers are old");
  assert.equal(vd.picture(src), src.el, "the video itself until the next frame is searched");
  assert.equal(vd.wanted(), true);
  // asked every frame again: the next answer counts
  now += 16;
  vd.search(src, SIZE, det, image);
  w.answer({ 5: [] });
  now += 16;
  assert.deepEqual(Object.keys(vd.take(src, det).markers), ["5"]);
});

test("bitmaps that failed for the video stay off when the worker is set up anew", async () => {
  setup();
  globalThis.createImageBitmap = () => Promise.reject(new Error("not for videos here"));
  const vd = new VideoDetection(), det = detector("ARUCO"), src = source("camera");
  vd.start(det);
  const w = FakeWorker.last;
  w.reply({ type: "ready", bitmaps: true });
  vd.search(src, SIZE, det, image);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(vd.bitmaps, false);
  // another dictionary: the worker is set up anew and says again that it can read bitmaps
  det.setDictionary("ARUCO_4X4_1000");
  vd.search(src, SIZE, det, image);
  w.reply({ type: "ready", bitmaps: true });
  assert.equal(vd.bitmaps, false, "the frames are read on the main thread");
  assert.equal(w.sent.at(-1).type, "frame");
  delete globalThis.createImageBitmap;
});
