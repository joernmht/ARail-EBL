#!/usr/bin/env node
// Records a page of the site as it is used: a plan of steps (go to a page, move the mouse, click,
// type, wait), a cursor drawn into the page so the viewer sees where it goes, and the picture of
// the browser captured as it changes (Chrome's screencast), resampled to a fixed frame rate. For the
// game pages in the project page's video; see docs/videos.md.
//   node tools/video/screen.mjs <plan.json>
// Needs the dev dependencies (Playwright with Chromium: npm install).
//
// Plan keys:
//   size        [width, height] of the browser window (default [1280, 720])
//   fps         frames per second of the output (default 30)
//   out         directory for the frames (f0000.jpg …)
//   steps       what to do, in order; the picture is recorded from the first `record` step on:
//     { "goto": "game/" }                   a page of web/ (or "/build/…": a file of build/video/)
//     { "record": true }                    start recording here
//     { "move": "#selector" | [x, y], "ms": 600 }   move the cursor there, smoothly
//     { "click": "#selector" | [x, y], "ms": 600 }  move there, then click
//     { "hover": "#selector", "ms": 600 }   move there and stay
//     { "type": "text", "ms": 60 }          type, one key every ms
//     { "press": "Enter" }                  one key
//     { "scroll": 300, "ms": 800 }          scroll the page by so many pixels, smoothly
//     { "eval": "js" }                      JavaScript in the page
//     { "wait": 1500 }                      ms
//     { "animate": 5.8 }                    the page's CSS animations, stepped frame by frame for so
//                                           many seconds, each frame a screenshot (a page that only
//                                           animates sends the screencast no pictures); a plan with
//                                           this step is made of these frames only
//   cursor      false: no cursor drawn
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = join(ROOT, "web"), BUILD = join(ROOT, "build", "video");
const ORIGIN = "http://arail.video";
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".mp4": "video/mp4", ".webm": "video/webm",
};

if (!process.argv[2]) {
  console.error("usage: node tools/video/screen.mjs <plan.json>");
  process.exit(2);
}
const plan = JSON.parse(readFileSync(resolve(process.argv[2]), "utf8"));
const [width, height] = plan.size || [1280, 720];
const fps = plan.fps || 30;
const out = resolve(ROOT, plan.out);
mkdirSync(out, { recursive: true });

// the cursor: an arrow that follows the mouse, a ring where it clicks
const CURSOR = `(() => {
  const add = () => {
    if (document.getElementById("__cursor")) return;
    const c = document.createElement("div");
    c.id = "__cursor";
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2l18 10-8 2-4 8z" fill="#fff" stroke="#001450" stroke-width="2" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: 2147483647, pointerEvents: "none", transform: "translate(-200px,-200px)", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.5))" });
    document.documentElement.appendChild(c);
    addEventListener("mousemove", (e) => (c.style.transform = "translate(" + (e.clientX - 3) + "px," + (e.clientY - 2) + "px)"), true);
    addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      Object.assign(r.style, { position: "fixed", left: e.clientX - 18 + "px", top: e.clientY - 18 + "px", width: "36px", height: "36px", borderRadius: "50%", border: "3px solid #36b8bf", zIndex: 2147483646, pointerEvents: "none", transition: "transform .45s ease-out, opacity .45s ease-out" });
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = "scale(1.8)"; r.style.opacity = "0"; });
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
})();`;

const serve = (sub) => `${ORIGIN}/${sub.replace(/^\//, "")}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("page error:", e.message));
await page.route(`${ORIGIN}/**`, async (route) => {
  const path = decodeURIComponent(new URL(route.request().url()).pathname);
  const [base, rel] = path.startsWith("/build/") ? [BUILD, path.slice(7)] : [WEB, path];
  let file = normalize(join(base, rel));
  if (!file.startsWith(base + sep)) return route.fulfill({ status: 403 });
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) return route.fulfill({ status: 404 });
  return route.fulfill({ path: file, contentType: TYPES[extname(file).toLowerCase()] || "application/octet-stream" });
});
if (plan.cursor !== false) await page.addInitScript(CURSOR);
await page.addInitScript(() => {
  try { localStorage.clear(); } catch { /* no storage */ }
});

// the screencast: a frame whenever the picture changes, with its time
const cdp = await page.context().newCDPSession(page);
const shots = [];
let recording = false;
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  if (recording) shots.push({ t: metadata.timestamp, data });
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
let mouse = [width / 2, height / 2];
const target = async (where) => {
  if (Array.isArray(where)) return where;
  const box = await page.locator(where).first().boundingBox();
  if (!box) throw new Error(`not on the page: ${where}`);
  return [box.x + box.width / 2, box.y + box.height / 2];
};
const glide = async (to, ms = 600) => {
  const steps = Math.max(2, Math.round(ms / 16)), from = mouse;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps, e = u * u * (3 - 2 * u);
    await page.mouse.move(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e);
    await page.waitForTimeout(ms / steps);
  }
  mouse = to;
};
let started = 0;
const stepped = [];
for (const s of plan.steps) {
  if (s.goto) {
    await page.goto(serve(s.goto));
    await page.mouse.move(...mouse);
  } else if (s.record) {
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
    recording = true;
    started = Date.now() / 1000;
  } else if (s.move || s.hover) await glide(await target(s.move || s.hover), s.ms);
  else if (s.click) {
    await glide(await target(s.click), s.ms);
    await page.mouse.down();
    await page.waitForTimeout(90);
    await page.mouse.up();
  } else if (s.type) await page.keyboard.type(s.type, { delay: s.ms ?? 60 });
  else if (s.press) await page.keyboard.press(s.press);
  else if (s.scroll) {
    const n = Math.max(2, Math.round((s.ms ?? 800) / 16));
    for (let i = 0; i < n; i++) {
      await page.mouse.wheel(0, s.scroll / n);
      await page.waitForTimeout((s.ms ?? 800) / n);
    }
  } else if (s.eval) await page.evaluate(s.eval);
  else if (s.animate) {
    await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
    for (let i = 0; i < Math.round(s.animate * fps); i++) {
      await page.evaluate((ms) => document.getAnimations().forEach((a) => (a.currentTime = ms)), (i * 1000) / fps);
      stepped.push(await page.screenshot({ type: "jpeg", quality: 92 }));
    }
  }
  if (s.wait) await page.waitForTimeout(s.wait);
}
const ended = Date.now() / 1000;
recording = false;
await cdp.send("Page.stopScreencast").catch(() => {});
await browser.close();
if (stepped.length) {
  stepped.forEach((img, i) => writeFileSync(join(out, `f${String(i).padStart(4, "0")}.jpg`), img));
  console.log(`${stepped.length} frames (${(stepped.length / fps).toFixed(1)} s, stepped): ${plan.out}`);
  process.exit(0);
}
if (!shots.length) throw new Error("nothing recorded: the plan needs a `record` step");

// resampled to the frame rate: each output frame shows the last picture before its time
shots.sort((a, b) => a.t - b.t);
const t0 = Math.min(shots[0].t, started), count = Math.round((ended - t0) * fps);
let k = 0;
for (let i = 0; i < count; i++) {
  const t = t0 + i / fps;
  while (k + 1 < shots.length && shots[k + 1].t <= t) k++;
  writeFileSync(join(out, `f${String(i).padStart(4, "0")}.jpg`), Buffer.from(shots[k].data, "base64"));
}
console.log(`${count} frames (${(count / fps).toFixed(1)} s, ${shots.length} pictures): ${plan.out}`);
