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
    const frame = this.sent.filter((m) => m.type === "frame").at(-1);
    this.reply({ type: "markers", id: frame.id, markers, rolling: {}, ms: 12, selected });
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
const image = () => ({ width: 4, height: 4, data: new Uint8ClampedArray(64) });
const source = (name) => ({ el: { name }, w: 8, h: 6 });

test("without a worker every frame is searched on the main thread, and the video itself is shown", () => {
  setup();
  const vd = new VideoDetection({ worker: false }), det = detector("ARUCO"), src = source("clip");
  vd.start(det);
  assert.equal(vd.state, "failed");
  const found = vd.search(image(), 2, det, src);
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
  assert.ok(vd.search(image(), 2, det, src), "starting: searched here");
  w.reply({ type: "ready" });
  assert.equal(vd.state, "ready");
  assert.equal(vd.search(image(), 2, det, src), null, "ready: in the worker");
  assert.equal(w.sent.filter((m) => m.type === "frame").length, 1);
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
  vd.search(image(), 2, det, src);
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
  vd.search(image(), 1, det, a);
  w.answer({ 1: [] });
  assert.equal(vd.take(b, det), null, "another source shown now");
  // the layout's dictionary changed while a frame was in the worker
  vd.search(image(), 1, det, a);
  det.setDictionary("ARUCO_4X4_1000");
  w.answer({ 1: [] });
  assert.equal(vd.take(a, det), null);
  // the next frame sets the worker up anew first
  vd.search(image(), 1, det, a);
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
  vd.search(image(), 1, det, src);
  w.answer({ 0: [] }, "ARUCO_MIP_36h12");
  const r = vd.take(src, det);
  vd.adopt(det, r.selected);
  assert.equal(det.selected.name, "ARUCO_MIP_36h12");
  const inits = w.sent.filter((m) => m.type === "init").length;
  vd.search(image(), 1, det, src);
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
  vd.search(image(), 1, det, src);
  assert.equal(vd.wanted(), false, "the same frame is not searched twice");
  announce();
  assert.equal(vd.wanted(), true, "a new frame");
  vd.search(image(), 1, det, src);
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
  vd.search(image(), 1, det, src);
  assert.equal(vd.wanted(), false);
  now += 3500;
  assert.equal(vd.wanted(), true, "a frame lost in the worker is given up");
  w.reply({ type: "error", id: 1, message: "broken" });
  assert.equal(vd.state, "failed");
  assert.ok(w.terminated);
  assert.ok(vd.search(image(), 1, det, src), "searched here from now on");
  // a worker that cannot be made at all
  globalThis.Worker = function () {
    throw new Error("no workers here");
  };
  const other = new VideoDetection();
  other.start(det);
  assert.equal(other.state, "failed");
});
