/**
 * The markers of the app's moving pictures (the live camera, a clip): each new frame of the video is
 * searched once, in a worker when the browser can run one (the live page's, web/live/detect-worker.js),
 * so that the page goes on drawing and simulating while a frame is searched; else, and until the worker
 * is ready, on the main thread. A frame searched in the worker is kept and shown with the markers found
 * in it, so that the picture and the pose drawn over it always belong together.
 * @module app/detection
 */

/** How long a worker may take to load before the frames are searched on the main thread for good (ms). */
const WORKER_TIMEOUT = 8000;
/**
 * A video whose browser announces no new frame for this long (ms) has its frame searched anyway: a
 * browser that has requestVideoFrameCallback but does not call it (for a video not in the page) must
 * not stop the search.
 */
const FRAME_SILENCE = 500;
/** A frame the worker has not answered for this long (ms) is given up: the next one is sent. */
const FRAME_LOST = 3000;

/**
 * What the detector does, as the worker's `init` takes it: the dictionary chosen (or "auto"), the codes
 * and the wagons' tags. A worker with other settings is set up anew before the next frame.
 * @param {import("../arail/core/detector.js").MarkerDetector} detector
 */
function settingsOf(detector) {
  return { dictionary: detector.selected?.name ?? "auto", codes: detector.codes, rolling: detector.rollingOptions ?? null };
}

export class VideoDetection {
  /**
   * @param {{worker?: boolean}} [options] worker: false searches every frame on the main thread
   */
  constructor({ worker = true } = {}) {
    /** "off" (not started), "starting", "ready" or "failed" (the main thread searches). */
    this.state = worker && typeof Worker === "function" ? "off" : "failed";
    this.worker = null;
    /** The settings the worker has (JSON of settingsOf), or null. */
    this.settings = null;
    /** The frame in the worker: {id, source, settings, picture, at}, or null. */
    this.pending = null;
    /** The worker's answer for `pending`, until it is taken. */
    this.result = null;
    /** The frame searched last with its markers (the picture shown with them): {source, picture}. */
    this.shown = null;
    /** Pictures of frames: the one shown and the one in the worker, by turns. */
    this.pictures = [];
    this.frameId = 0;
    /** The video and its callback for new frames (requestVideoFrameCallback), or null. */
    this.watched = null;
    /** A frame of the watched video not searched yet (always true without requestVideoFrameCallback). */
    this.newFrame = true;
  }

  /**
   * Start the worker (once), set up as the app's detector: until it is ready, frames are searched on
   * the main thread.
   * @param {import("../arail/core/detector.js").MarkerDetector} detector
   */
  start(detector) {
    if (this.state !== "off" || !detector) return;
    let worker;
    try {
      worker = new Worker(new URL("../live/detect-worker.js", import.meta.url), { type: "module" });
    } catch {
      this.state = "failed";
      return;
    }
    this.state = "starting";
    this.worker = worker;
    const fail = () => this._fail();
    const timeout = setTimeout(fail, WORKER_TIMEOUT);
    worker.onmessage = ({ data: msg }) => {
      if (msg.type === "ready") {
        clearTimeout(timeout);
        if (this.state === "starting") this.state = "ready";
      } else if (msg.type === "markers") {
        if (this.pending?.id === msg.id) this.result = msg;
      } else if (msg.type === "error") {
        clearTimeout(timeout);
        fail();
      }
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      clearTimeout(timeout);
      fail();
    };
    worker.postMessage({ type: "init", ...settingsOf(detector) });
    this.settings = JSON.stringify(settingsOf(detector));
  }

  /** The worker failed: from now on the main thread searches the frames. */
  _fail() {
    this.worker?.terminate();
    this.worker = null;
    this.state = "failed";
    this.pending = this.result = null;
    this.settings = null;
  }

  /** Forget the frames of a picture that is no longer shown (another source, the layout loads anew). */
  reset() {
    this.pending = this.result = this.shown = null;
    this.newFrame = true;
  }

  /**
   * Watch a video for new frames: only those are searched (a camera gives 30 a second, the screen asks
   * for 60). Without requestVideoFrameCallback every frame of the screen counts as new.
   * @param {HTMLVideoElement | null} video
   */
  watch(video) {
    if (this.watched?.video === video) return;
    this.watched = null;
    this.newFrame = true;
    if (!video || typeof video.requestVideoFrameCallback !== "function") return;
    const watched = (this.watched = { video, at: performance.now() });
    const next = () => video.requestVideoFrameCallback(() => {
      if (this.watched !== watched) return;
      this.newFrame = true;
      watched.at = performance.now();
      next();
    });
    next();
  }

  /** Is a frame to be searched now: a new one (or none announced for a while), and none in the worker? */
  wanted() {
    if (this.pending && performance.now() - this.pending.at > FRAME_LOST) this.pending = this.result = null;
    if (this.pending) return false;
    return this.newFrame || (!!this.watched && performance.now() - this.watched.at > FRAME_SILENCE);
  }

  /**
   * Search a frame. On the main thread its markers come back at once; in the worker the frame is kept
   * (its picture drawn from `el`) and they come with `take` in a later frame of the screen.
   * @param {{width: number, height: number, data: Uint8ClampedArray}} image the frame at its processing size
   * @param {number} scale processing px → picture px
   * @param {import("../arail/core/detector.js").MarkerDetector} detector the app's detector (its settings)
   * @param {object} source the app's source: its element and size of the picture
   * @returns {{markers: object, rolling: object, ms: number} | null} the markers now, or null (in the worker)
   */
  search(image, scale, detector, source) {
    if (this.watched) {
      this.newFrame = false;
      this.watched.at = performance.now();
    }
    if (this.state !== "ready") {
      this.shown = null; // the video itself is shown: its frame is the one searched
      const t0 = performance.now();
      const found = typeof detector.detectAll === "function" ? detector.detectAll(image, scale) : { markers: detector.detect(image, scale) };
      return { markers: found.markers, rolling: found.rolling || {}, ms: performance.now() - t0 };
    }
    const settings = JSON.stringify(settingsOf(detector));
    if (settings !== this.settings) {
      this.worker.postMessage({ type: "init", ...settingsOf(detector) });
      this.settings = settings;
    }
    const picture = this.pictures.find((p) => p !== this.shown?.picture) || this._picture();
    if (picture.width !== source.w || picture.height !== source.h) {
      picture.width = source.w;
      picture.height = source.h;
    }
    picture.getContext("2d").drawImage(source.el, 0, 0, source.w, source.h);
    const id = ++this.frameId;
    this.pending = { id, source, settings, picture, at: performance.now() };
    this.worker.postMessage({ type: "frame", id, width: image.width, height: image.height, scale, buffer: image.data.buffer }, [image.data.buffer]);
    return null;
  }

  _picture() {
    const c = document.createElement("canvas");
    this.pictures.push(c);
    return c;
  }

  /**
   * The worker's markers for the frame it was given, if they are there and still belong to what is
   * shown (the same source, a worker with the same settings); that frame becomes the picture shown.
   * @param {object} source the app's current source
   * @param {import("../arail/core/detector.js").MarkerDetector} detector the app's detector
   * @returns {{markers: object, rolling: object, ms: number, selected: string | null} | null}
   */
  take(source, detector) {
    const r = this.result, p = this.pending;
    if (!r || !p) return null;
    this.result = this.pending = null;
    if (p.source !== source || p.settings !== JSON.stringify(settingsOf(detector))) return null;
    this.shown = { source, picture: p.picture };
    return { markers: r.markers, rolling: r.rolling || {}, ms: r.ms, selected: r.selected };
  }

  /**
   * The worker chose a dictionary while the app's detector votes: the app's detector takes it, too (the
   * app keeps a dictionary found when the layout changes), and the worker keeps its settings.
   * @param {import("../arail/core/detector.js").MarkerDetector} detector
   * @param {string | null} name the worker's chosen dictionary
   */
  adopt(detector, name) {
    if (!name || detector.selected) return;
    detector.setDictionary(name);
    this.settings = JSON.stringify(settingsOf(detector));
  }

  /** The picture to show for a source: the frame searched last (in the worker), else the video itself. */
  picture(source) {
    return this.shown?.source === source ? this.shown.picture : source.el;
  }
}
