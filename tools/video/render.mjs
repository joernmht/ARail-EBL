#!/usr/bin/env node
// Renders the app's augmented picture frame by frame, for videos: over a clip (or the photo of an
// example, or in the flyover), at a fixed frame rate however long a frame takes. A plan (JSON file)
// says what to render; see docs/videos.md for the plans of the project page's videos.
//   node tools/video/render.mjs <plan.json> [--frames N] [--only 0,90,180]
// Needs the dev dependencies (Playwright with Chromium: npm install) and, for clips, ffmpeg.
//
// Plan keys (all optional but `out` and `frames`):
//   page        app address after "app/?": "example=neustadt" or "layout=../layouts/x.json"
//   clip        a video file: converted to WebM with every frame a key frame (exact seeking)
//   start       first frame of the clip (default 0)
//   frames      frames to render; fps (default 30)
//   out         directory for the frames (f0000.jpg …); quality (JPEG, default 0.95)
//   viewport    [width, height] of the browser window (default [1600, 1000])
//   labels      name tags and boards (default false: none in a video)
//   eval        JavaScript run once the app is up, with `app` and `term` (the terminal simulation)
//   inject      scripts evaluated in the page: drawings for the video only (tools/video/sky.js)
//   warm_s      seconds of real time the simulation runs first, at warm_speed (default 1)
//   track       {from: -45, hold: 90}: the clip is tracked from start + from to start, then the
//               frame at start is held for `hold` frames
//   keep_rolling  after the hold, model wagons keep their poses (the camera's motion would make
//               them look moving)
//   freeze      the app's Freeze after tracking: one fixed picture, its pose kept
//   setup       JavaScript after tracking (app, term), e.g. a terminal move
//   speed       simulation speed for the shot (default: the layout's)
//   each        JavaScript run before every frame (app, term), e.g. switching off a highlight
//   proc_max    resolution of the marker detection, fixed (default 1280 px; the app adapts it
//               to the computer's speed, which a video must not depend on)
//   until       JavaScript condition (app, term, h = the first crane): the simulation runs on,
//               the picture held, until it is true
//   record      file: the raw pose of each frame (markers of that frame only), the tracker's pose,
//               the focal length and the picture's size, for arail-stabilize (pass 1)
//   poses       file from arail-stabilize: every frame is drawn with its pose and one focal
//               length, the tracker skipped (pass 2)
//   images      false: no frames written (a pass that only records)
//   fly         flyover camera path: {target, distance, yaw_deg, pitch_deg}, each a value or
//               [from, to] (eased); target [x, y] or [[x, y], [x, y]]
//   wait        JavaScript condition (app): before a flyover shot, the simulation runs until it
//               is true; lead_s seconds more, then the shot starts
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = join(ROOT, "web");
const ORIGIN = "http://arail.video";
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".mp4": "video/mp4", ".webm": "video/webm", ".ico": "image/x-icon",
};

function usage(msg) {
  if (msg) console.error(msg);
  console.error("usage: node tools/video/render.mjs <plan.json> [--frames N] [--only 0,90,180]");
  process.exit(2);
}

const args = process.argv.slice(2);
if (!args.length || args[0].startsWith("-")) usage();
const planFile = resolve(args[0]);
const plan = JSON.parse(readFileSync(planFile, "utf8"));
const opt = (name) => {
  const i = args.indexOf(name);
  return i > 0 ? args[i + 1] : null;
};
/** Paths in a plan are relative to the repository. */
const repo = (p) => (p ? resolve(ROOT, p) : null);
const {
  page: query = "example=neustadt", start = 0, fps = 30, quality = 0.95, viewport = [1600, 1000], labels = false,
  warm_s = 0, warm_speed = 1, track = null, keep_rolling = false, freeze = false, speed = null, fly = null, lead_s = 0,
  images = true, proc_max = 1280,
} = plan;
const frames = Number(opt("--frames") ?? plan.frames ?? 0);
const only = opt("--only") ? new Set(opt("--only").split(",").map(Number)) : null;
if (!plan.out && images) usage("the plan needs `out`");
const out = repo(plan.out);
if (out) mkdirSync(out, { recursive: true });
const dt = 1000 / fps;

/** The clip as WebM with a key frame on every frame (cached in the temp directory). */
function seekableClip(file) {
  const st = statSync(file);
  const key = createHash("sha1").update(`${file}:${st.size}:${st.mtimeMs}`).digest("hex").slice(0, 16);
  const dest = join(tmpdir(), `arail-clip-${key}.webm`);
  if (!existsSync(dest)) {
    console.log(`converting the clip for exact seeking: ${file}`);
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-an", "-c:v", "libvpx-vp9", "-crf", "20", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "5", "-g", "1", dest], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("ffmpeg could not convert the clip (is ffmpeg installed?)");
  }
  return dest;
}
const clip = plan.clip ? seekableClip(repo(plan.clip)) : null;
const poses = plan.poses ? JSON.parse(readFileSync(repo(plan.poses), "utf8")) : null;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: viewport[0], height: viewport[1] } });
page.on("pageerror", (e) => console.log("page error:", e.message));
// the web directory and the clip, served from disk
await page.route(`${ORIGIN}/**`, async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === "/__clip.webm" && clip) return route.fulfill({ path: clip, contentType: "video/webm" });
  let file = normalize(join(WEB, decodeURIComponent(url.pathname)));
  if (!file.startsWith(WEB + sep) && file !== WEB) return route.fulfill({ status: 403 });
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) return route.fulfill({ status: 404 });
  return route.fulfill({ path: file, contentType: TYPES[extname(file).toLowerCase()] || "application/octet-stream" });
});
// frames are stepped by hand: requestAnimationFrame waits for __step
await page.addInitScript(() => {
  let queue = [];
  window.requestAnimationFrame = (cb) => {
    queue.push(cb);
    return queue.length;
  };
  window.__step = (t) => {
    const q = queue;
    queue = [];
    for (const cb of q) cb(t);
  };
  window.__t = 1000;
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});
await page.goto(`${ORIGIN}/app/?${query}`);
await page.waitForFunction(() => window.__arail?.world && window.__arail.source, null, { polling: 250, timeout: 120000 });

const step = (ms) => page.evaluate((ms) => {
  const app = window.__arail;
  app.procMax = window.__procMax;
  if (window.__each) window.__each(app, window.__term);
  window.__t += ms;
  window.__step(window.__t);
}, ms);
await page.evaluate((procMax) => (window.__procMax = procMax), proc_max);
for (let i = 0; i < 10; i++) await step(dt);

await page.evaluate(async ({ labels, code }) => {
  const app = window.__arail;
  window.__term = app.world.simulations.find((s) => s.constructor.type === "terminal") || null;
  if (!labels) {
    const ARail = await import("/arail/index.js");
    ARail.View.prototype.label = function () {}; // no name tags in a video
    app.world.settings.labels = false;
    app.display.flyMarkers = false;
  }
  if (code) new Function("app", "term", code)(app, window.__term);
}, { labels, code: plan.eval || "" });
for (const file of plan.inject || []) await page.evaluate(readFileSync(repo(file), "utf8"));
await page.evaluate((each) => (window.__each = each ? new Function("app", "term", each) : null), plan.each || "");

// the simulation runs a while first
if (warm_s > 0) {
  await page.evaluate(async ({ warm_s, warm_speed }) => {
    const app = window.__arail, before = app.world.speed;
    app.world.speed = warm_speed;
    for (let i = 0; i < warm_s * 10; i++) {
      app.procMax = window.__procMax;
      window.__t += 100;
      window.__step(window.__t);
      if (i % 50 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    app.world.speed = before;
  }, { warm_s, warm_speed });
}

const seek = (i) => page.evaluate(async (i) => {
  const v = window.__arail.source.el;
  await new Promise((res) => {
    v.onseeked = () => res();
    v.currentTime = (i + 0.5) / window.__fps;
  });
  v.onseeked = null;
}, i);
await page.evaluate((fps) => (window.__fps = fps), fps);

if (clip) {
  await page.evaluate(async (url) => {
    const blob = await (await fetch(url)).blob();
    window.__arail.loadVideo(URL.createObjectURL(blob), "clip");
  }, `${ORIGIN}/__clip.webm`);
  await page.waitForFunction(() => window.__arail.source?.kind === "video" && window.__arail.source.el.readyState >= 2, null, { timeout: 120000, polling: 250 });
  await page.evaluate((focal) => {
    const app = window.__arail, v = app.source.el;
    v.pause();
    v.loop = false;
    if (focal) app.camera.setManualFocal(focal); // one focal length for the whole clip
  }, poses?.focal || null);
  if (track && !poses) {
    for (let i = Math.max(0, start + (track.from ?? -45)); i <= start; i++) {
      await seek(i);
      await step(dt);
    }
    for (let i = 0; i < (track.hold ?? 0); i++) await step(dt);
  }
}
if (keep_rolling) await page.evaluate(() => (window.__arail._observeRolling = () => {}));
if (freeze) await page.evaluate(() => window.__arail.setFrozen(true));
await page.evaluate(({ code, speed }) => {
  const app = window.__arail;
  if (speed != null) app.world.speed = speed;
  if (code) new Function("app", "term", code)(app, window.__term);
}, { code: plan.setup || "", speed });
if (plan.until) {
  let k = 0;
  for (; k < 3000; k++) {
    const ok = await page.evaluate((cond) => {
      const term = window.__term, h = term ? [...term.handlers.values()][0] : null;
      return new Function("app", "term", "h", `return (${cond})`)(window.__arail, term, h);
    }, plan.until);
    if (ok) break;
    await step(dt);
  }
  console.log(k < 3000 ? `until: after ${k} frames` : "until: never true (3000 frames)");
}

// a flyover shot: the camera on an eased path
const flyCam = (u) => page.evaluate(({ fly, u }) => {
  const f = window.__arail.flyover, e = u * u * (3 - 2 * u), at = (v) => (Array.isArray(v) ? v[0] + (v[1] - v[0]) * e : v);
  const target = Array.isArray(fly.target[0]) ? [0, 1].map((k) => at([fly.target[0][k], fly.target[1][k]])) : fly.target;
  f.anim = null;
  f.cam.set({ target, distance: at(fly.distance), yaw: (at(fly.yaw_deg) * Math.PI) / 180, pitch: (at(fly.pitch_deg) * Math.PI) / 180 });
}, { fly, u });
if (fly) {
  await page.evaluate(() => window.__arail.flyover.enter());
  await flyCam(0);
  await step(dt);
}
if (plan.wait) {
  let k = 0;
  for (; k < 6000; k++) {
    if (await page.evaluate((cond) => new Function("app", `return (${cond})`)(window.__arail), plan.wait)) break;
    await step(dt);
  }
  console.log(k < 6000 ? `wait: after ${k} frames` : "wait: never true (6000 frames)");
  for (let i = 0; i < Math.round(lead_s * fps); i++) await step(dt);
}

// pass 1 records the raw pose of each frame: the markers of that frame only, before smoothing
if (plan.record) {
  await page.evaluate(() => {
    const tr = window.__arail.tracker, update = tr.update.bind(tr);
    tr.update = (...a) => {
      const st = update(...a);
      const est = tr._estimate(tr.markers);
      window.__raw = est && est.ids.length ? est.H : null;
      return st;
    };
  });
}
// pass 2 draws each frame with its pose
if (poses) await page.evaluate(() => (window.__arail.tracker.update = () => window.__arail.tracker.state));

const record = [];
const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  if (clip && !freeze) await seek(start + i);
  if (fly) await flyCam(frames > 1 ? i / (frames - 1) : 0);
  if (poses) {
    const p = poses.poses[Math.min(i, poses.poses.length - 1)];
    await page.evaluate(({ H, Hinv }) => {
      const tr = window.__arail.tracker;
      tr.H = H;
      tr.Hinv = Hinv;
      tr.state = { H, Hinv, visible: [], used: [], holding: false, rms: 0, moving: {} };
    }, p);
  }
  await step(dt);
  if (plan.record) {
    record.push(await page.evaluate(() => {
      const app = window.__arail;
      return { H: window.__raw, Hs: app.tracker.state.H, f: app.camera.focal };
    }));
  }
  if (images && (!only || only.has(i))) {
    const data = await page.evaluate((q) => window.__arail.canvas.toDataURL("image/jpeg", q), quality);
    writeFileSync(join(out, `f${String(i).padStart(4, "0")}.jpg`), Buffer.from(data.split(",")[1], "base64"));
  }
  if (i % 30 === 0) console.log(`frame ${i} of ${frames} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
if (plan.record) {
  const size = await page.evaluate(() => [window.__arail.source.w, window.__arail.source.h]);
  const focal = record[record.length - 1]?.f ?? null;
  mkdirSync(dirname(repo(plan.record)), { recursive: true });
  writeFileSync(repo(plan.record), JSON.stringify({ clip: plan.clip, start, fps, size, focal, raw: record }));
  console.log(`recorded ${record.filter((r) => r.H).length} of ${frames} frames with markers, focal ${focal?.toFixed(0)} px: ${plan.record}`);
}
await browser.close();
