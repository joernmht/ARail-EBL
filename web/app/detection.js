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
 * A frame the worker could not search is skipped; after this many in a row the worker is given up
 * (it would find nothing any more), and the main thread searches.
 */
const FRAME_ERRORS = 5;
/**
 * Not asked for markers for this long (ms; the picture frozen, the flyover, a layout loading): what
 * was in the worker then is old, and neither applied nor shown when the camera view goes on.
 */
const PAUSE = 1000;

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
    /** The frame in the worker: {id, source, settings, picture, at} (picture: null for a bitmap), or null. */
    this.pending = null;
    /** The worker's answer for `pending`, until it is taken. */
    this.result = null;
    /** The frame searched last with its markers (the picture shown with them): {source, picture}. */
    this.shown = null;
    /** Pictures of frames: the one shown and the one in the worker, by turns (without bitmaps). */
    this.pictures = [];
    /**
     * Frames go to the worker as bitmaps (createImageBitmap; the worker reads their pixels and sends them
     * back to be shown), not as pixels read on the main thread: when the worker can draw them.
     */
    this.bitmaps = false;
    /** createImageBitmap failed for the video once: frames are read on the main thread from then on. */
    this.bitmapsFailed = false;
    /** When `take` was last asked (performance.now()), or null. */
    this.asked = null;
    this.frameId = 0;
    /** The video and its callback for new frames (requestVideoFrameCallback), or null. */
    this.watched = null;
    /** A frame of the watched video not searched yet (always true without requestVideoFrameCallback). */
    this.newFrame = true;
    /** Setting the worker up failed once and was asked again (it fails for good the second time). */
    this.initRetried = false;
    /** Frames in a row the worker could not search (FRAME_ERRORS: given up). */
    this.frameErrors = 0;
  }

  /**
   * Start the worker (once), set up as the app's detector: until it is ready, frames are searched on
   * the main thread. Setting it up (also anew) that fails is asked once more before the worker is given
   * up; a frame it cannot search is skipped (FRAME_ERRORS in a row: given up).
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
        this.initRetried = false;
        // also answering a worker set up anew: a bitmap path that failed stays off
        this.bitmaps = !!msg.bitmaps && typeof createImageBitmap === "function" && !this.bitmapsFailed;
      } else if (msg.type === "markers") {
        this.frameErrors = 0;
        if (this.pending?.id === msg.id) this.result = msg;
        else msg.bitmap?.close?.();
      } else if (msg.type === "error" && (msg.of === "init" || msg.id == null)) {
        // setting it up failed (a script of a dictionary not loaded: the network): asked once more, then
        // given up (the time to start, WORKER_TIMEOUT, goes on)
        if (this.initRetried) {
          clearTimeout(timeout);
          fail();
        } else {
          this.initRetried = true;
          worker.postMessage({ type: "init", ...JSON.parse(this.settings) });
        }
      } else if (msg.type === "error") {
        // a frame it could not search: skipped, the next one is sent
        if (this.pending?.id === msg.id) this.pending = this.result = null;
        if (++this.frameErrors >= FRAME_ERRORS) fail();
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
    this._show(null);
    this.result?.bitmap?.close?.();
    this.pending = this.result = null;
    this.newFrame = true;
  }

  /** The frame shown from now on ({source, picture}, or null: the video itself); a bitmap shown before is freed. */
  _show(shown) {
    const old = this.shown?.picture;
    if (old && old !== shown?.picture) old.close?.();
    this.shown = shown;
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
   * Search the video's current frame at the processing size `size`. On the main thread its markers come
   * back at once. In the worker they come with `take` in a later frame of the screen, and the frame is
   * kept to be shown with them: as a bitmap that the worker reads and sends back (the main thread neither
   * reads its pixels nor copies it), else drawn into a picture of its own while `read` reads its pixels.
   * @param {object} source the app's source: its element (`el`) and the size of the picture (`w`, `h`)
   * @param {{w: number, h: number}} size the processing size
   * @param {import("../arail/core/detector.js").MarkerDetector} detector the app's detector (its settings)
   * @param {() => {width: number, height: number, data: Uint8ClampedArray}} read the frame's pixels at the
   *   processing size, read on the main thread
   * @returns {{markers: object, rolling: object, ms: number} | null} the markers now, or null (in the worker)
   */
  search(source, size, detector, read) {
    if (this.watched) {
      this.newFrame = false;
      this.watched.at = performance.now();
    }
    const scale = source.w / size.w;
    if (this.state !== "ready") {
      this._show(null); // the video itself is shown: its frame is the one searched
      const image = read(), t0 = performance.now();
      const found = typeof detector.detectAll === "function" ? detector.detectAll(image, scale) : { markers: detector.detect(image, scale) };
      return { markers: found.markers, rolling: found.rolling || {}, ms: performance.now() - t0 };
    }
    const settings = JSON.stringify(settingsOf(detector));
    if (settings !== this.settings) {
      this.worker.postMessage({ type: "init", ...settingsOf(detector) });
      this.settings = settings;
    }
    const id = ++this.frameId;
    if (this.bitmaps) {
      // as large as the picture shown, or as the processing size if that is larger
      const big = size.w > source.w ? size : { w: source.w, h: source.h };
      this.pending = { id, source, settings, picture: null, at: performance.now() };
      createImageBitmap(source.el, { resizeWidth: big.w, resizeHeight: big.h, resizeQuality: "medium" }).then(
        (bitmap) => {
          if (this.pending?.id !== id || !this.worker) return bitmap.close();
          this.worker.postMessage({ type: "bitmap", id, bitmap, width: size.w, height: size.h, scale }, [bitmap]);
        },
        () => {
          // this browser cannot make a bitmap of the video: its pixels are read here from now on
          this.bitmaps = false;
          this.bitmapsFailed = true;
          if (this.pending?.id === id) this.pending = null;
        },
      );
      return null;
    }
    const picture = this.pictures.find((p) => p !== this.shown?.picture) || this._picture();
    if (picture.width !== source.w || picture.height !== source.h) {
      picture.width = source.w;
      picture.height = source.h;
    }
    picture.getContext("2d").drawImage(source.el, 0, 0, source.w, source.h);
    const image = read();
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
   * Asked again after a pause (PAUSE: the picture frozen, the flyover, a layout loading), the frame
   * that was in the worker is old: it is forgotten, and the video itself is shown until the next one.
   * @param {object} source the app's current source
   * @param {import("../arail/core/detector.js").MarkerDetector} detector the app's detector
   * @returns {{markers: object, rolling: object, ms: number, selected: string | null} | null}
   */
  take(source, detector) {
    // after a pause (frozen, the flyover, a layout loading) the frame in the worker is an old one
    const now = performance.now(), paused = this.asked != null && now - this.asked > PAUSE;
    this.asked = now;
    if (paused) this.reset();
    const r = this.result, p = this.pending;
    if (!r || !p) return null;
    this.result = this.pending = null;
    if (p.source !== source || p.settings !== JSON.stringify(settingsOf(detector))) {
      r.bitmap?.close?.();
      return null;
    }
    this._show({ source, picture: r.bitmap ?? p.picture });
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
