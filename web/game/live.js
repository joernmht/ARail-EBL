// The live backdrop of the game: the lab's layout, running. The world of a layout is simulated
// (trains, buses, trams, people, day and night) and drawn from a virtual camera on a canvas behind
// the game, as the app's flyover draws it, without the table's photo and without labels. The
// camera stands where a picture of the game was taken (shots.js) and flies on when another one is
// asked for; standing, it sways a little. It is an ornament: it changes nothing in a game, and
// where it cannot be drawn fast enough it gives up, and the still pictures stay.
//
// For a game that has a board (BOARDS) it is more than that: the table (`setTable`). Then the world
// is the one the game plays in. The signaller's trains run on the station's tracks and its signals
// stand beside them (table.js), the maintenance dispatcher's vans drive the streets to the faults
// (district.js); the table is the photo of the real one (the layout's orthophoto), the world runs
// at the game's speed, and the camera is the player's: it shows the station or a part of it, and can
// be moved. What is clicked on the table is told to the page (`hit`). The games of one shift share
// the table: the seat shown can choose on it, the others' games are drawn with it.
//
// The table can also be seen as the app shows the lab (`setSource`): on a photo of the lab, or
// through the camera of this device in the lab itself. Then the picture is the photo or the camera
// image, the camera's place is found from the table's markers (as the app finds it, in a worker),
// and the game is drawn onto the real table: augmented reality.
import { SKY, SKY_NIGHT, clearUncovered, drawGroundImage, mipmaps } from "../app/flyover.js";
import { Camera, FlyCamera, PlaneTracker, View, createWorld, orthoOf, rgba, toRad } from "../arail/index.js";
import { DistrictBoard } from "./district.js";
import { between, seenFrom } from "./shots.js";
import { TableBoard } from "./table.js";

/**
 * The boards of the games that are played on the table, by the game's id: each draws its game on
 * the layout's world and says what of it is at a pixel (`show`, `draw`, `hit`, `placeOf`, `partOf`,
 * `bounds`, `dispose`; `active`, `picked`, `offers`).
 */
export const BOARDS = { signaller: TableBoard, maintenance: DistrictBoard };

/** Where the pages keep whether the backdrop is live. */
export const LIVE_KEY = "arail.game.live";

/**
 * How it runs: the simulation's speed, the widest canvas (px), the frames a second, how long the
 * camera flies to another shot (s), how far and how slowly it sways while it stands (degrees, s),
 * and when it gives up: after `probe` frames a frame may take `slow_ms` on average, once at
 * `shrink` of its size, then not at all. Only what a shot shows is drawn (seenFrom in shots.js).
 */
export const LIVE = { speed: 3, max_px: 1280, fps: 24, fly_s: 1.8, sway_deg: 4, sway_s: 46, probe: 30, slow_ms: 60, shrink: 0.66 };

/**
 * The table: the camera's direction and tilt (it looks from the windows over the station to the
 * town, so Bergheim is on the left as on the panel), how fast it flies to another part (s), how
 * near and far it may go (mm) and where it may look ([x0, y0, x1, y1], layout mm), how far down
 * the picture the station's middle stands (0 … 1: the panel stands below it), how fast the world may run
 * with the game (its people need not keep up with a shift at 20×), the beat of what pulses (ms),
 * the modules of the layout that stay on (those whose trains run into the station are the game's now),
 * and how far towards the camera things are drawn (y, layout mm: the town behind the table would stand in the way).
 */
export const TABLE_VIEW = {
  yaw_deg: 270, pitch_deg: 48, fly_s: 0.7, min_mm: 350, max_mm: 9000, area: [-2400, -600, 8200, 1200], middle: 0.44, speed_max: 6, pulse_ms: 1500,
  layers: ["sbahn"], front_mm: 960,
};

/**
 * What the table is seen through: the camera over the table's photo ("table"), a photo of the lab
 * ("photo", below web/), this device's camera ("camera"). `max_px`: the widest picture searched for
 * markers and drawn on; `every_ms`: how often a camera frame is searched; `tries`: how often a photo is (it does not
 * change: its markers are found at once, or not at all); `focus`: the part of the
 * picture kept in view where the window has another shape (as CSS object-position, 0 … 1).
 */
export const SOURCES = { kinds: ["table", "photo", "camera"], photo: "media/ebl-neustadt.jpg", max_px: 1280, every_ms: 90, tries: 5, focus: [0.5, 0.8] };


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
    /** The table: the boards of the games shown on it by their game's id (BOARDS), that of the seat shown, whether the table is shown, and the game's speed (0: it waits). */
    this.boards = new Map();
    this.board = null;
    this.table = false;
    this.pace = 1;
    /** The camera's flight to another part of the table ({from, to, t0}), the view of the frame drawn last, the table's photo. */
    this.flight = null;
    this.view = null;
    this.ortho = null;
    this.url = null;
    /**
     * What the table is seen through (SOURCES.kinds), and for a photo or the camera: the picture
     * ({el, width, height, still, stream}), its camera and the tracker of the table's markers, the
     * canvas a frame is searched on, the worker that searches, and what it found last ({H} or null).
     */
    this.source = "table";
    this.feed = null;
    this.eye = null;
    this.tracker = null;
    this.proc = null;
    this.worker = null;
    this.searching = false;
    this.searched = 0;
    this.found = null;
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
      // an ornament: no signs over the stops (and no labels at all: View `labels`), and the clock at the simulation's
      // own pace, so that a morning stays a morning
      world.settings.labels = false;
      world.speed = LIVE.speed;
      world.clock.factor = 1;
      this.world = world;
      this.layout = layout;
      this.url = new URL(url, globalThis.location?.href ?? "http://localhost/").href;
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
    this.clock(time ?? shot.time);
    // on the table the camera is the player's
    if (this.table || this.to?.name === shot.name) return;
    this.from = this.to ? this.at(performance.now()) : null;
    this.nearFrom = this.near;
    this.to = shot;
    this.near = this.objectsIn(seenFrom(shot));
    this.t0 = performance.now();
  }

  /** The world's time of day follows the one asked for (minutes after midnight) where it is more than an hour off. */
  clock(minutes) {
    if (minutes == null || !this.world) return;
    const now = this.world.clock.minutes, off = Math.abs(((minutes - now) % 1440 + 2160) % 1440 - 720);
    if (off > 60) this.world.setTime(minutes);
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

  /** Whether the table is seen as it is (a photo, the camera) and its markers are found: null while it is the virtual camera's. */
  get tracking() {
    return this.feed ? !!this.found : null;
  }

  /** Why the game cannot be placed on the photo or the camera's picture (no search, no markers in a photo), or null. */
  get problem() {
    return this.feed ? this.searchProblem || this.notFound || null : null;
  }

  /** A frame: the world goes on, the picture is drawn; the first frames say whether it is fast enough. */
  frame(now) {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    if (document.hidden || (!this.to && !this.table) || now - this.last < 1000 / LIVE.fps - 2) return;
    const dt = this.last ? Math.min(0.25, (now - this.last) / 1000) : 0;
    this.last = now;
    const began = performance.now();
    if (this.table) {
      this.world.paused = !(this.pace > 0);
      this.world.speed = Math.min(TABLE_VIEW.speed_max, Math.max(1, this.pace));
    }
    this.world.step(dt);
    this.draw(now);
    this.spent += performance.now() - began;
    // the first frames say whether it is fast enough: if not, once more at a smaller size, then not at all
    if (!this.feed && this.checks < 2 && ++this.frames === LIVE.probe) {
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
    if (this.table && this.feed) return void this.drawReal(now);
    const width = Math.max(320, Math.round(Math.min(canvas.clientWidth * (globalThis.devicePixelRatio || 1), LIVE.max_px) * this.size));
    const height = Math.max(180, Math.round((width * canvas.clientHeight) / Math.max(1, canvas.clientWidth)));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    if (this.camera.width !== width || this.camera.height !== height) this.camera.setSize(width, height);
    const table = this.table;
    if (table) this.fly(now);
    else {
      const p = this.at(now);
      this.cam.set({ target: p.target, distance: p.distance_mm, yaw: toRad(p.yaw_deg), pitch: toRad(p.pitch_deg) });
    }
    const pose = this.cam.homography(width, height);
    this.camera.setManualFocal(pose.focal);
    const night = world.night();
    this.background(width, height, night);
    // what pulses on the table (a route whose points move, what can be chosen) beats slowly
    const pulse = table ? 0.5 + 0.5 * Math.sin((2 * Math.PI * now) / TABLE_VIEW.pulse_ms) : null;
    const view = new View({ ctx, camera: this.camera, H: pose.H, pose: pose.pose, scale: world.scale, px: width / Math.max(1, canvas.clientWidth), time: world.time, night, virtual: true, pulse, labels: false });
    let objects;
    if (table) {
      this.ground(view, night);
      // (what stands between the camera and the station is left out)
      objects = this.objectsIn(seenFrom({ target: this.cam.target, distance_mm: this.cam.distance, yaw_deg: (this.cam.yaw * 180) / Math.PI })).filter((o) => !(this.boxes.get(o)?.[1] > TABLE_VIEW.front_mm));
    } else {
      // on the way from one shot to another, what both show
      const flying = this.from && now - this.t0 < LIVE.fly_s * 1000 && this.nearFrom;
      objects = flying ? [...new Set([...this.nearFrom, ...this.near])] : this.near;
    }
    if (table) {
      // nothing is drawn between the camera and the table: the cars and lines of the town there would lie on the lab's floor
      const a = view.project(TABLE_VIEW.area[0] - 20000, TABLE_VIEW.front_mm, 0), b = view.project(TABLE_VIEW.area[2] + 20000, TABLE_VIEW.front_mm, 0);
      ctx.save();
      // (as long as the camera looks over the table from the windows: turned round, the town is behind the station)
      if (a && b && Math.abs(a[0] - b[0]) > 1 && Math.cos(this.cam.yaw - toRad(TABLE_VIEW.yaw_deg)) > 0.8) {
        const edge = (x) => a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
        ctx.beginPath();
        ctx.moveTo(-10, -10);
        ctx.lineTo(width + 10, -10);
        ctx.lineTo(width + 10, edge(width + 10));
        ctx.lineTo(-10, edge(-10));
        ctx.closePath();
        ctx.clip();
      }
      world.draw(view, { objects });
      ctx.restore();
    } else world.draw(view, { objects });
    this.view = view;
  }

  /* ---------------------------------------------------------------- the real table: a photo, the camera */

  /**
   * See the table through something else: "table" (the camera over the table's photo), "photo" (a
   * photo of the lab), "camera" (this device's camera; it needs https and a person's leave).
   * @param {"table" | "photo" | "camera"} kind
   * @param {string} [base] the way to web/ from the page
   * @returns {Promise<{source: string, problem?: string, stale?: boolean}>} what it is seen through now, and why not as
   *   asked; `stale`: another source was asked for, or the table was left, while this one was opening (what it opened
   *   is let go of: a camera's light goes out)
   */
  async setSource(kind, base = "../../") {
    // a new request: one still opening is stale now (leaving the table and closeFeed make it stale too); what is
    // shown stays until the new source has opened, and where it cannot open, it stays as it was
    const request = (this.request = (this.request || 0) + 1), stale = () => request !== this.request || !this.table;
    if (kind !== "photo" && kind !== "camera") {
      this.closeFeed();
      this.source = "table";
      return { source: "table" };
    }
    let feed = null, problem = null;
    try {
      if (kind === "photo") {
        const img = new Image();
        img.src = new URL(SOURCES.photo, new URL(base, location.href)).href;
        await img.decode();
        feed = { el: img, width: img.naturalWidth, height: img.naturalHeight, still: true, stream: null };
      } else if (!navigator.mediaDevices?.getUserMedia || !globalThis.isSecureContext) problem = "The camera needs a secure page (https).";
      else {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: SOURCES.max_px } }, audio: false });
        feed = { el: null, width: 0, height: 0, still: false, stream };
        if (!stale()) {
          const video = document.createElement("video");
          video.muted = true;
          video.playsInline = true;
          video.srcObject = stream;
          await video.play();
          Object.assign(feed, { el: video, width: video.videoWidth, height: video.videoHeight });
        }
      }
    } catch (e) {
      problem = kind === "photo" ? "The photo of the lab could not be loaded." : `The camera could not be opened (${e.name === "NotAllowedError" ? "not allowed" : e.message}).`;
    }
    if (!problem && !stale() && !(feed.width > 0 && feed.height > 0)) problem = "The picture is empty.";
    if (problem || stale()) {
      // what was opened is let go of (a camera's light goes out); what is shown stays
      for (const track of feed?.stream?.getTracks() ?? []) track.stop();
      return stale() ? { source: this.source, stale: true } : { source: this.source, problem };
    }
    // the new one has opened: the one before goes
    this.closeFeed();
    // searched and drawn at one size: the picture's own, or smaller
    const k = Math.min(1, SOURCES.max_px / feed.width);
    feed.w = Math.round(feed.width * k);
    feed.h = Math.round(feed.height * k);
    this.feed = feed;
    this.source = kind;
    this.eye = new Camera(feed.w, feed.h);
    this.tracker = new PlaneTracker(this.world.map, { survey: false });
    this.found = null;
    this.searched = 0;
    this.tries = 0;
    this.notFound = null;
    this.proc ||= document.createElement("canvas");
    this.startSearch();
    return { source: kind };
  }

  /** Let go of the photo or the camera (and of one that is still opening: its request is stale now). */
  closeFeed() {
    this.request = (this.request || 0) + 1;
    for (const track of this.feed?.stream?.getTracks() ?? []) track.stop();
    this.feed = null;
    this.found = null;
    this.searching = false;
  }

  /** The worker that finds the table's markers in a picture (the live page's, web/live/detect-worker.js), started once. */
  startSearch() {
    if (this.worker || this.searchProblem) return;
    // the markers cannot be searched: said once (the event livetracking), the picture is shown without the game
    const fail = () => {
      this.searching = false;
      if (this.ready || this.searchProblem) return;
      this.searchProblem = "The table's markers cannot be searched in this browser: the game cannot be placed on the picture.";
      this.canvas.dispatchEvent(new CustomEvent("livetracking", { detail: { tracking: false, problem: this.searchProblem } }));
    };
    if (typeof Worker !== "function") return fail();
    const m = this.world.layout.markers;
    try {
      const worker = new Worker(new URL("../live/detect-worker.js", import.meta.url), { type: "module" });
      worker.onmessage = ({ data: msg }) => {
        if (msg.type === "ready") this.ready = true;
        else if (msg.type === "error" && !this.ready) fail();
        else if (msg.type === "markers" || msg.type === "error") {
          this.searching = false;
          if (msg.type === "markers" && this.feed && msg.id === this.searchId) this.markers(msg.markers);
        }
      };
      worker.onerror = fail;
      worker.postMessage({ type: "init", dictionary: m.dictionary || "ARUCO", codes: this.world.map.detectionCodes(m.codes) });
      this.worker = worker;
    } catch {
      this.worker = null;
      fail();
    }
  }

  /** Search the picture for markers: a photo once (until they are found), the camera every few frames. */
  search(now) {
    const f = this.feed;
    if (!f || !this.ready || this.searching || (f.still && this.found) || now - this.searched < SOURCES.every_ms) return;
    // a still picture is searched a few times; where its markers are not found, that is said once and the search stops
    if (f.still && this.tries >= SOURCES.tries) {
      if (!this.notFound) {
        this.notFound = "The table's markers were not found in the photo: the game cannot be placed on it.";
        this.canvas.dispatchEvent(new CustomEvent("livetracking", { detail: { tracking: false, problem: this.notFound } }));
      }
      return;
    }
    this.tries = (this.tries || 0) + 1;
    if (!f.still && f.el.readyState < 2) return;
    const c = this.proc;
    if (c.width !== f.w || c.height !== f.h) {
      c.width = f.w;
      c.height = f.h;
    }
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(f.el, 0, 0, f.w, f.h);
    const image = g.getImageData(0, 0, f.w, f.h);
    this.searching = true;
    this.searched = now;
    this.searchId = (this.searchId || 0) + 1;
    this.worker.postMessage({ type: "frame", id: this.searchId, width: f.w, height: f.h, scale: 1, buffer: image.data.buffer }, [image.data.buffer]);
  }

  /** The markers found in the picture: where the camera stands (the homography from the layout to the picture), or nowhere. */
  markers(found) {
    const t = this.tracker.update(found, performance.now() / 1000, this.eye, { still: this.feed.still });
    const had = !!this.found;
    this.found = t.H ? { H: t.H } : null;
    if (had !== !!this.found) this.canvas.dispatchEvent(new CustomEvent("livetracking", { detail: { tracking: !!this.found } }));
  }

  /** The table as it is: the photo or the camera image, and on it the game and the layout's digital layer, where the markers say the table is. */
  drawReal(now) {
    const { canvas, ctx, world } = this, f = this.feed;
    this.search(now);
    if (canvas.width !== f.w || canvas.height !== f.h) {
      canvas.width = f.w;
      canvas.height = f.h;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(f.el, 0, 0, f.w, f.h);
    if (!this.found) {
      this.view = null;
      return;
    }
    const shown = Math.max(1, Math.max(canvas.clientWidth / f.w, canvas.clientHeight / f.h));
    const view = new View({ ctx, camera: this.eye, H: this.found.H, scale: world.scale, px: 1 / shown, time: world.time, pulse: 0.5 + 0.5 * Math.sin((2 * Math.PI * now) / TABLE_VIEW.pulse_ms), labels: false });
    // what the picture shows of the layout, as a camera over the table would see it
    const like = FlyCamera.fromPose(view.pose, this.eye.intrinsics.fy, f.h);
    const objects = like ? this.objectsIn(seenFrom({ target: like.target, distance_mm: like.distance, yaw_deg: (like.yaw * 180) / Math.PI })) : world.objects;
    world.draw(view, { objects });
    this.view = view;
  }

  /* ---------------------------------------------------------------- the table */

  /**
   * Make the table the picture of a game that has a board (BOARDS), or let it be the backdrop again
   * (null). The first time the world becomes the game's: the modules whose trains run into the
   * station go off, the table's photo is loaded. Every game shown gets its board (the signaller's
   * takes the platform tracks); the board of `game` is the one a person chooses on.
   * @param {object | null} game the game of the seat shown, or null
   * @param {{active?: boolean, picked?: string | null, offers?: {i: number, route?: string | null, target?: string | null, disabled?: boolean}[], others?: object[]}} [state]
   *   whether a person can choose on it, what is chosen (an item of the game's picture), the moves offered from it
   *   (a route of a signal, the thing a move needs), and the other games of the shift, drawn with it
   * @returns {boolean} whether the table is shown
   */
  setTable(game, { active = false, picked = null, offers = [], others = [] } = {}) {
    if (!this.world || this.failed) return false;
    const idOf = (g) => g?.constructor?.id, shown = new Map();
    if (game && !BOARDS[idOf(game)]) game = null;
    if (game) for (const g of [game, ...others]) if (BOARDS[idOf(g)] && !shown.has(idOf(g))) shown.set(idOf(g), g);
    if (game && !this.table) {
      // (the modules on before: the backdrop gets them back when the table is left)
      this.layersBefore = this.world.layers().filter((l) => l.enabled).map((l) => l.id);
      this.world.setLayers(this.world.layers().filter((l) => TABLE_VIEW.layers.includes(l.id)).map((l) => l.id));
      this.world.clock.factor = 1;
      this.boxes.clear();
      this.near = this.nearFrom = null;
      this.loadOrtho();
    }
    // a board for every game shown; one whose game is gone leaves the world
    for (const [id, b] of this.boards) {
      if (shown.has(id)) continue;
      b.dispose();
      this.boards.delete(id);
    }
    for (const [id, g] of shown) {
      let b = this.boards.get(id);
      if (!b) this.boards.set(id, (b = new BOARDS[id](this.world)));
      const mine = g === game;
      b.show(g);
      b.active = mine && active;
      b.picked = mine ? picked : null;
      b.offers = mine && active ? offers : [];
    }
    const before = this.board, on = !!game;
    this.board = game ? this.boards.get(idOf(game)) : null;
    if (on !== this.table) {
      this.table = on;
      this.flight = null;
      if (on) {
        this.cam.set({ yaw: toRad(TABLE_VIEW.yaw_deg), pitch: toRad(TABLE_VIEW.pitch_deg) });
        this.show("all", true);
      } else {
        // the backdrop again: the camera goes back to the shot asked for next, the world to its own pace, with its
        // modules and its own timetable at the platforms (the boards have left the world)
        this.closeFeed();
        this.source = "table";
        if (this.layersBefore) this.world.setLayers(this.layersBefore);
        this.layersBefore = null;
        this.world.clock.factor = 1;
        this.boxes.clear();
        this.near = this.nearFrom = null;
        this.world.paused = false;
        this.world.speed = LIVE.speed;
        this.to = this.from = null;
      }
    } else if (on && before !== this.board) this.show("all");
    return on;
  }

  /** The canvas as it is drawn: its size in px (the size of the frame drawn last). */
  extent() {
    return [this.canvas.width || 1, this.canvas.height || 1];
  }

  /**
   * Show a part of the table: the whole station, or its points towards Bergheim ("west"), its
   * platforms, its points towards Talsee ("east"). The camera flies there (`now`: it is there at once).
   * @param {"all" | "west" | "platforms" | "east"} part
   * @param {boolean} [now]
   */
  show(part, now = false) {
    if (!this.board || this.feed) return;
    const [w, h] = [Math.max(1, this.canvas.clientWidth || this.canvas.width), Math.max(1, this.canvas.clientHeight || this.canvas.height)];
    const [x0, y0, x1, y1] = this.board.bounds(part), to = this.cam.clone();
    to.set({ yaw: toRad(TABLE_VIEW.yaw_deg), pitch: toRad(TABLE_VIEW.pitch_deg) });
    to.fit([x0, y0, x1, y1], w / h, 0.03);
    // the picture's lower edge is the panel's: the station's middle stands a little above the picture's
    const mid = to.project([(x0 + x1) / 2, (y0 + y1) / 2], w, h);
    if (mid) to.pan(0, TABLE_VIEW.middle * h - mid[1], w, h, mid);
    this.part = part;
    if (now) {
      this.cam.set(to.state());
      this.flight = null;
    } else this.flight = { from: this.cam.state(), to: to.state(), t0: performance.now() };
  }

  /**
   * Bring something of the game into the picture (an item of its picture, "signal-A", "track-G2"):
   * where the camera does not show it, it flies to the part of the station that has it.
   */
  reveal(item) {
    const p = this.table && !this.feed ? this.board?.placeOf(item) : null;
    if (!p || !this.view || this.view.inImage(p[0], p[1], 0, -60 * this.view.px)) return;
    this.show(this.board.partOf(p));
  }

  /** The camera on its way to another part of the table. */
  fly(now) {
    const f = this.flight;
    if (!f) return;
    const t = Math.min(1, (now - f.t0) / (TABLE_VIEW.fly_s * 1000));
    this.cam.set(FlyCamera.between(f.from, f.to, t));
    if (t >= 1) this.flight = null;
  }

  /** The camera stays over the table, neither too near nor too far. */
  keep() {
    const a = TABLE_VIEW.area, c = this.cam;
    c.distance = Math.min(TABLE_VIEW.max_mm, Math.max(TABLE_VIEW.min_mm, c.distance));
    c.target = [Math.min(a[2], Math.max(a[0], c.target[0])), Math.min(a[3], Math.max(a[1], c.target[1]))];
    this.flight = null;
    this.part = null;
  }

  /** A point of the page (client px) on the canvas (px), as the board and the camera take it. */
  pixel(clientX, clientY) {
    // the canvas covers its box (CSS object-fit: cover, object-position: SOURCES.focus): a picture of another shape is cut
    const r = this.canvas.getBoundingClientRect(), { width, height } = this.canvas, k = Math.max(r.width / width, r.height / height) || 1;
    return [(clientX - r.left - (r.width - width * k) * SOURCES.focus[0]) / k, (clientY - r.top - (r.height - height * k) * SOURCES.focus[1]) / k];
  }

  /** Slide the table under the pointer: from one point of the page to another (client px). */
  drag(from, to) {
    if (!this.table || this.feed) return;
    const a = this.pixel(...from), b = this.pixel(...to), [w, h] = this.extent();
    this.cam.pan(b[0] - a[0], b[1] - a[1], w, h, a);
    this.keep();
  }

  /** Go nearer (factor > 1) or farther, towards a point of the page (client px; default: the middle of the picture). */
  zoom(factor, at = null) {
    if (!this.table || this.feed) return;
    const [w, h] = this.extent(), p = at ? this.pixel(...at) : [w / 2, h / 2];
    this.cam.zoomAt(factor, p[0], p[1], w, h);
    this.keep();
  }

  /** Turn the camera round what it looks at, and tilt it (radians). */
  orbit(yaw, pitch = 0) {
    if (!this.table || this.feed) return;
    this.cam.orbit(yaw, pitch);
    this.keep();
  }

  /**
   * What of the game is at a point of the page (client px): `{item}` (a signal, a platform track:
   * an item of the game's picture), `{route}` (where a route of the signal chosen goes), or null.
   * @param {number} clientX
   * @param {number} clientY
   * @param {boolean} [touch] a finger: it may be farther away
   */
  hit(clientX, clientY, touch = false) {
    if (!this.table || !this.board || !this.view) return null;
    return this.board.hit(this.view, this.pixel(clientX, clientY), touch ? 1.7 : 1);
  }

  /** Load the photo of the real table (the layout's orthophoto); until it is there the table is drawn virtual. */
  loadOrtho() {
    const o = orthoOf(this.world.layout);
    if (!o || this.ortho || typeof Image !== "function") return;
    const entry = (this.ortho = { bounds: o.bounds_mm, img: null, levels: null, canvas: null, key: null, exact: false });
    const img = new Image();
    img.onload = () => {
      // the parts of the photo that no picture of the survey covered are transparent: the virtual table shows there
      entry.img = clearUncovered(img);
      entry.levels = mipmaps(entry.img);
    };
    try {
      img.src = new URL(o.image, this.url).href;
    } catch {
      this.ortho = null;
    }
  }

  /**
   * The photo of the real table on the ground, in perspective (as the app's flyover draws it): into
   * a canvas of its own, roughly while the camera moves and exactly once it stands. What is real
   * there (the tracks, the platforms) is then not drawn again (`View#showsReal`).
   */
  ground(view, night) {
    const o = this.ortho;
    if (!o?.levels) return;
    view.groundPhoto = o.bounds;
    const { width, height } = this.canvas, key = `${view.H.map((v) => v.toPrecision(8)).join(",")}|${width}x${height}`;
    const moving = key !== this.poseKey;
    this.poseKey = key;
    o.canvas ||= document.createElement("canvas");
    if (o.key !== key || (!moving && !o.exact)) {
      if (o.canvas.width !== width || o.canvas.height !== height) {
        o.canvas.width = width;
        o.canvas.height = height;
      }
      const g = o.canvas.getContext("2d");
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, width, height);
      drawGroundImage(g, view, o.img, o.bounds, o.levels, moving ? 3 : 0.5);
      o.key = key;
      o.exact = !moving;
    }
    view.ground(-90, (ctx) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(o.canvas, 0, 0);
    });
    const b = o.bounds;
    if (night > 0.01) view.polygon([[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]], { fill: rgba(SKY_NIGHT.top, 0.62 * Math.min(1, night)), emissive: true, order: -89 });
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
