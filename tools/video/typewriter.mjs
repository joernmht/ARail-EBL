#!/usr/bin/env node
// Draws the lines of a video's story as an old computer would type them: a prompt, the text typed
// letter by letter, a block cursor, then erased again. Each frame with a line is a PNG with alpha
// (f0000.png …, numbered as the video's frames) that arail-compose lays over the top of the video.
//   arail-compose tools/video/plans/hero.json --cues build/video/hero-cues.json
//   node tools/video/typewriter.mjs build/video/hero-cues.json build/video/hero-text
// Needs the dev dependencies (Playwright with Chromium: npm install). The type is the site's
// Noto Sans Mono (web/assets/fonts).
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [cueFile, outDir] = process.argv.slice(2);
if (!cueFile || !outDir) {
  console.error("usage: node tools/video/typewriter.mjs <cues.json> <out-dir>");
  process.exit(2);
}
const { size: [width], fps, cps, cues } = JSON.parse(readFileSync(resolve(cueFile), "utf8"));
const out = resolve(outDir);
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (/^f\d+\.png$/.test(f)) rmSync(join(out, f));

const HEIGHT = Math.round(width * 0.16); // the strip at the top the lines are drawn in
const scale = width / 1280;
const fonts = pathToFileURL(join(ROOT, "web/assets/fonts/fonts-app.css")).href;
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${fonts}"><style>
html, body { margin: 0; background: transparent; }
.strip { width: ${width}px; height: ${HEIGHT}px; display: grid; place-items: center; }
.box { display: none; position: relative; padding: ${14 * scale}px ${24 * scale}px; border-radius: ${4 * scale}px;
  background: rgba(0, 12, 48, .84); border: ${1.5 * scale}px solid rgba(54, 184, 191, .65);
  box-shadow: 0 0 ${18 * scale}px rgba(54, 184, 191, .25), 0 ${6 * scale}px ${24 * scale}px rgba(0, 0, 0, .45);
  font: 600 ${30 * scale}px/1.25 "Noto Sans Mono", monospace; letter-spacing: .01em; color: #e3f7f8; white-space: pre;
  text-shadow: 0 0 ${7 * scale}px rgba(54, 184, 191, .7); }
/* the lines of an old screen */
.box::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: repeating-linear-gradient(to bottom, rgba(255, 255, 255, .05) 0 ${1 * scale}px, transparent ${1 * scale}px ${3 * scale}px); }
.prompt { color: #36b8bf; margin-right: .55em; }
.cursor { display: inline-block; width: .62em; height: 1.05em; margin-left: .06em; vertical-align: -.17em; background: #36b8bf;
  box-shadow: 0 0 ${8 * scale}px rgba(54, 184, 191, .9); }
.cursor.off { visibility: hidden; }
</style></head><body><div class="strip"><div class="box" id="box"><span class="prompt">&gt;</span><span id="text"></span><span class="cursor" id="cursor"></span></div></div>
<script>
// the state of a line at a moment: the letters typed so far, then held, then backspaced in the last 0.4 s
window.__show = (text, t, length, cps) => {
  const box = document.getElementById("box");
  if (text === null) { box.style.display = "none"; return; }
  box.style.display = "inline-block";
  const typed = Math.min(text.length, Math.floor(t * cps));
  const erase = 0.4, left = length - t;
  const shown = left < erase ? Math.floor(typed * Math.max(0, left / erase)) : typed;
  document.getElementById("text").textContent = text.slice(0, shown);
  const busy = typed < text.length || left < erase;
  document.getElementById("cursor").className = "cursor" + (busy || Math.floor(t * 2.2) % 2 === 0 ? "" : " off");
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: HEIGHT }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
let n = 0;
for (const c of cues) {
  const length = (c.end - c.start) / fps;
  for (let f = c.start; f < c.end; f++) {
    await page.evaluate(([text, t, length, cps]) => window.__show(text, t, length, cps), [c.text, (f - c.start) / fps, length, cps]);
    await page.screenshot({ path: join(out, `f${String(f).padStart(4, "0")}.png`), omitBackground: true });
    n++;
  }
}
await browser.close();
console.log(`${n} frames with lines (${cues.length} lines): ${outDir}`);
