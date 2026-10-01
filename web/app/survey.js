// Survey a video: measure the marker map from a video file of the whole layout, frame by
// frame and as fast as the browser can decode, then keep the positions (a fixed layout).
// For the lab session see docs/lab-session.md; the Python tool `arail-survey` does the same
// offline with a global adjustment and also makes an orthophoto of the table.
import { Camera, PlaneTracker } from "../arail/index.js";

/** Wait for an event on an element (rejects after `ms`). */
function once(el, name, ms = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      el.removeEventListener(name, ok);
      reject(new Error(`${name}: timed out`));
    }, ms);
    const ok = () => {
      clearTimeout(t);
      resolve();
    };
    el.addEventListener(name, ok, { once: true });
  });
}

export class VideoSurvey {
  /**
   * @param {object} options
   * @param {import("../arail/index.js").World} options.world
   * @param {object} options.detector a MarkerDetector
   * @param {File | Blob | string} options.source video file or URL
   * @param {number} [options.fps=30] assumed frame rate (browsers do not report it)
   * @param {number} [options.every=2] process every n-th frame
   * @param {number} [options.maxSide=1600] longest side of the analysed frames (px)
   * @param {(p: object) => void} [options.onProgress]
   */
  constructor({ world, detector, source, fps = 30, every = 2, maxSide = 1600, onProgress = () => {} }) {
    this.world = world;
    this.detector = detector;
    this.source = source;
    this.fps = fps;
    this.every = every;
    this.maxSide = maxSide;
    this.onProgress = onProgress;
    this.cancelled = false;
    /** Frames each marker was seen in. */
    this.seen = new Map();
    this.frames = 0;
    this.tracked = 0;
  }

  cancel() {
    this.cancelled = true;
  }

  /**
   * Run the survey. The world's marker map is extended and refined (fixed markers stay; the map
   * must not be locked, a locked map surveys nothing; moving markers are left out).
   * @returns {Promise<{frames: number, tracked: number, markers: number[], seen: Map<number, number>, duration: number, cancelled: boolean}>}
   */
  async run() {
    const url = typeof this.source === "string" ? this.source : URL.createObjectURL(this.source);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    try {
      await once(video, "loadedmetadata", 15000).catch(() => {
        throw new Error("this video cannot be played in this browser (try MP4/H.264 or WebM)");
      });
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (!(duration > 0)) throw new Error("the video has no duration");
      const s = Math.min(1, this.maxSide / Math.max(video.videoWidth, video.videoHeight));
      const w = Math.round(video.videoWidth * s), h = Math.round(video.videoHeight * s);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const camera = new Camera(w, h);
      // a tracker of its own on the world's map: it adds and refines markers, video-style
      const tracker = new PlaneTracker(this.world.map, { minSurveyFrames: 3 });
      const step = this.every / this.fps;
      const total = Math.max(1, Math.floor(duration / step) + 1);
      for (let i = 0; i < total && !this.cancelled; i++) {
        const t = Math.min(duration - 1e-3, i * step);
        video.currentTime = t;
        await once(video, "seeked").catch(() => null);
        if (video.readyState < 2) continue;
        ctx.drawImage(video, 0, 0, w, h);
        let detections = {};
        try {
          detections = this.detector.detect(ctx.getImageData(0, 0, w, h), 1);
        } catch {
          continue;
        }
        const state = tracker.update(detections, t, camera);
        this.frames++;
        if (state.used.length) this.tracked++;
        for (const id of Object.keys(detections).map(Number)) {
          if (!this.world.map.moving.has(id)) this.seen.set(id, (this.seen.get(id) || 0) + 1); // moving markers are no part of the map
        }
        this.onProgress({ frame: i + 1, total, time: t, duration, markers: this.world.map.ids().length, visible: state.visible, used: state.used });
        // let the page breathe (drawing, input) between frames
        if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
      }
      this.world.objectChanged(null);
      return { frames: this.frames, tracked: this.tracked, markers: this.world.map.ids(), seen: this.seen, duration, cancelled: this.cancelled };
    } finally {
      video.removeAttribute("src");
      video.load();
      if (url !== this.source) URL.revokeObjectURL(url);
    }
  }
}

/**
 * Small top-down plot of the marker map as SVG markup: squares at the marker poses,
 * darker the more often a marker was seen; the origin marker outlined.
 * @param {import("../arail/index.js").MarkerMap} map
 * @param {Map<number, number>} seen
 */
export function markerPlotSvg(map, seen = new Map()) {
  const ids = map.ids();
  if (!ids.length) return "";
  const pts = ids.map((id) => ({ id, ...map.get(id) }));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const pad = 40;
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
  const W = Math.max(1, x1 - x0), H = Math.max(1, y1 - y0);
  const max = Math.max(1, ...seen.values());
  const r = Math.max(8, Math.min(W, H) * 0.02);
  const items = pts.map((p) => {
    const cx = p.x - x0, cy = y1 - p.y; // layout y up, SVG y down
    const n = seen.get(p.id) || 0;
    const shade = n ? 0.35 + 0.65 * (n / max) : 0.15;
    return `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${(-p.theta * 180) / Math.PI})">` +
      `<rect x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" fill="currentColor" fill-opacity="${shade.toFixed(2)}"${p.id === map.anchor ? ` stroke="var(--warn, #C85000)" stroke-width="${r * 0.35}"` : ""}/></g>` +
      `<text x="${cx.toFixed(1)}" y="${(cy - r * 1.6).toFixed(1)}" font-size="${(r * 1.4).toFixed(1)}" text-anchor="middle" fill="currentColor">${p.id}</text>`;
  });
  return `<svg class="marker-plot" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" role="img" aria-label="Marker map seen from above: ${ids.length} markers">${items.join("")}</svg>`;
}
