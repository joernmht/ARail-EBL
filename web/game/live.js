// The live backdrop of the game: the lab's layout, running. The world of a layout is simulated
// (trains, buses, trams, people, day and night) and drawn from a virtual camera on a canvas behind
// the game, as the app's flyover draws it, without the table's photo and without labels. The
// camera stands where a picture of the game was taken (shots.js) and flies on when another one is
// asked for; standing, it sways a little. It is an ornament: it changes nothing in a game, and
// where it cannot be drawn fast enough it gives up, and the still pictures stay.
import { SKY, SKY_NIGHT } from "../app/flyover.js";
import { Camera, FlyCamera, View, createWorld, rgba, toRad } from "../arail/index.js";
import { between, seenFrom } from "./shots.js";

/** Where the pages keep whether the backdrop is live. */
export const LIVE_KEY = "arail.game.live";

/**
 * How it runs: the simulation's speed, the widest canvas (px), the frames a second, how long the
 * camera flies to another shot (s), how far and how slowly it sways while it stands (degrees, s),
 * and when it gives up: after `probe` frames a frame may take `slow_ms` on average, once at
 * `shrink` of its size, then not at all. Only what a shot shows is drawn (seenFrom in shots.js).
 */
export const LIVE = { speed: 3, max_px: 1280, fps: 24, fly_s: 1.8, sway_deg: 4, sway_s: 46, probe: 30, slow_ms: 60, shrink: 0.66 };

const mixHex = (a, b, t) => {
  const p = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return rgba(A.map((v, i) => v + (B[i] - v) * t));
};

/** The world of a layout, drawn live on a canvas from a camera that flies between shots. */
export class LiveScene {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    /** @type {import("../arail/index.js").World | null} */
    this.world = null;
    /** The layout that runs (its path below web/), or null. */
    this.layout = null;
    this.cam = new FlyCamera();
    this.camera = new Camera();
    /** Where the camera comes from, where it goes, and when it set off (ms). */
    this.from = null;
    this.to = null;
    this.t0 = 0;
    /** The objects drawn for the shot looked at and, while the camera flies, for the one it comes from. */
    this.near = null;
    this.nearFrom = null;
    /** Where each object lies ([x0, y0, x1, y1] of its footprint), found once. */
    this.boxes = new Map();
    this.running = false;
    /** It gave up (too slow, or no layout): the still pictures stay. */
    this.failed = false;
    this.last = 0;
    /** The size of the canvas against the screen's (1, or `shrink` after a slow start), and what the first frames took. */
    this.size = 1;
    this.frames = 0;
    this.spent = 0;
    this.checks = 0;
    this.loop = (t) => this.frame(t);
  }

  /**
   * Load a layout and make its world.
   * @param {string} url the layout's address
   * @param {string} layout its path below web/, as the shots name it
   * @returns {Promise<boolean>} whether it runs
   */
  async load(url, layout) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const world = createWorld(await res.json(), { seed: 1 });
      // an ornament: no signs over the stops, and the clock at the simulation's own pace, so that a morning stays a morning
      world.settings.labels = false;
      world.speed = LIVE.speed;
      world.clock.factor = 1;
      this.world = world;
      this.layout = layout;
      return true;
    } catch {
      this.failed = true;
      return false;
    }
  }

  /** Whether a shot can be shown: the layout it is of runs. */
  can(shot) {
    return !this.failed && !!this.world && !!shot && shot.layout === this.layout;
  }

  /**
   * Look at a shot: the camera flies there (at once the first time), and the world's time of day
   * follows where it is more than an hour off.
   * @param {import("./shots.js").Shot} shot
   * @param {{time?: number | null}} [options] time: the time of day to show instead of the shot's (minutes)
   */
  look(shot, { time = null } = {}) {
    if (!this.can(shot)) return;
    const minutes = time ?? shot.time, now = this.world.clock.minutes;
    const off = Math.abs(((minutes - now) % 1440 + 2160) % 1440 - 720);
    if (off > 60) this.world.setTime(minutes);
    if (this.to?.name === shot.name) return;
    this.from = this.to ? this.at(performance.now()) : null;
    this.nearFrom = this.near;
    this.to = shot;
    this.near = this.objectsIn(seenFrom(shot));
    this.t0 = performance.now();
  }

  /** The objects of the world that reach into a square on the ground (seenFrom); one that cannot say where it lies is always drawn. */
  objectsIn(square) {
    return this.world.objects.filter((o) => {
      let box = this.boxes.get(o);
      if (box === undefined) {
        const pts = (o.geometry && o.footprint?.()) || [];
        box = pts.length ? [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] : null;
        this.boxes.set(o, box);
      }
      return !box || (box[0] <= square[2] && box[2] >= square[0] && box[1] <= square[3] && box[3] >= square[1]);
    });
  }

  /** Where the camera is at a time (ms): on its way to the shot, or standing there and swaying. */
  at(now) {
    const to = this.to, fly = this.from ? Math.min(1, (now - this.t0) / (LIVE.fly_s * 1000)) : 1;
    const p = fly < 1 ? between(this.from, to, fly) : { target: to.target, distance_mm: to.distance_mm, yaw_deg: to.yaw_deg, pitch_deg: to.pitch_deg };
    return { ...p, yaw_deg: p.yaw_deg + LIVE.sway_deg * Math.sin((2 * Math.PI * now) / (LIVE.sway_s * 1000)) };
  }

  /** Let it run (it draws while the page is visible), or stop. */
  start() {
    if (this.running || this.failed || !this.world) return;
    this.running = true;
    this.last = 0;
    requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
  }

  /** A frame: the world goes on, the picture is drawn; the first frames say whether it is fast enough. */
  frame(now) {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    if (document.hidden || !this.to || now - this.last < 1000 / LIVE.fps - 2) return;
    const dt = this.last ? Math.min(0.25, (now - this.last) / 1000) : 0;
    this.last = now;
    const began = performance.now();
    this.world.step(dt);
    this.draw(now);
    this.spent += performance.now() - began;
    // the first frames say whether it is fast enough: if not, once more at a smaller size, then not at all
    if (this.checks < 2 && ++this.frames === LIVE.probe) {
      const slow = this.spent / this.frames > LIVE.slow_ms;
      this.frames = this.spent = 0;
      this.checks = slow ? this.checks + 1 : 2;
      if (slow && this.checks === 1) this.size = LIVE.shrink;
      else if (slow) {
        this.failed = true;
        this.stop();
        this.canvas.dispatchEvent(new Event("livefailed"));
      }
    }
  }

  /** Draw the world from where the camera is: the sky and the floor, then everything on the layout. */
  draw(now) {
    const { canvas, ctx, world } = this;
    const width = Math.max(320, Math.round(Math.min(canvas.clientWidth * (globalThis.devicePixelRatio || 1), LIVE.max_px) * this.size));
    const height = Math.max(180, Math.round((width * canvas.clientHeight) / Math.max(1, canvas.clientWidth)));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    if (this.camera.width !== width || this.camera.height !== height) this.camera.setSize(width, height);
    const p = this.at(now);
    this.cam.set({ target: p.target, distance: p.distance_mm, yaw: toRad(p.yaw_deg), pitch: toRad(p.pitch_deg) });
    const pose = this.cam.homography(width, height);
    this.camera.setManualFocal(pose.focal);
    const night = world.night();
    this.background(width, height, night);
    // on the way from one shot to another, what both show
    const flying = this.from && now - this.t0 < LIVE.fly_s * 1000 && this.nearFrom;
    const objects = flying ? [...new Set([...this.nearFrom, ...this.near])] : this.near;
    world.draw(new View({ ctx, camera: this.camera, H: pose.H, pose: pose.pose, scale: world.scale, px: width / Math.max(1, canvas.clientWidth), time: world.time, night, virtual: true }), { objects });
  }

  /** The sky above the horizon and the lab's floor below it, by day and at night (the colours of the app's flyover). */
  background(width, height, night) {
    const { ctx } = this, c = Object.fromEntries(Object.keys(SKY).map((k) => [k, mixHex(SKY[k], SKY_NIGHT[k], night)]));
    const horizon = Math.max(0, Math.min(height, height / 2 - this.cam.focal(height) * Math.tan(this.cam.pitch)));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (horizon > 0) {
      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, c.top);
      sky.addColorStop(1, c.horizon);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, Math.ceil(horizon));
    }
    const floor = ctx.createLinearGradient(0, horizon, 0, height);
    floor.addColorStop(0, c.floorFar);
    floor.addColorStop(1, c.floorNear);
    ctx.fillStyle = floor;
    ctx.fillRect(0, Math.floor(horizon), width, height - Math.floor(horizon));
    ctx.restore();
  }
}
