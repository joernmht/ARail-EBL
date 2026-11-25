#!/usr/bin/env node
// Draws the lines of a video's story as an old computer would type them: a terminal box of three
// rows over the whole width of the picture, at its top edge, each row with a prompt; the text typed letter by letter behind
// a block cursor. Each line goes into its row (`row` 1 to 3, default 3) and stays there until the
// next line of that row backspaces it; the newest line is bright and has the cursor, the older ones
// are a little lighter. The box stays from the first line to the end of the video. Each frame is a PNG with alpha (f0000.png …, numbered as the video's
// frames) that arail-compose lays over the top of the video. See docs/short-videos.md for the design.
//   arail-compose tools/video/plans/hero.json --cues build/video/hero-cues.json
//   node tools/video/typewriter.mjs build/video/hero-cues.json build/video/hero-text
// Needs the dev dependencies (Playwright with Chromium: npm install). The type is the site's
// Noto Sans Mono (web/assets/fonts).
//
// The styles of a line (`style` in the plan's `say`): `text` (default), `accent` (the orange of the
// departure boards, for the last line, the question).
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { BOX, boxFrames, rowsAt, tooLong } from "./story-box.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [cueFile, outDir] = process.argv.slice(2);
if (!cueFile || !outDir) {
  console.error("usage: node tools/video/typewriter.mjs <cues.json> <out-dir>");
  process.exit(2);
}
const { size: [width], fps, cps, cues, frames } = JSON.parse(readFileSync(resolve(cueFile), "utf8"));
const out = resolve(outDir);
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (/^f\d+\.png$/.test(f)) rmSync(join(out, f));
// (the old frames are gone first: none of them is laid over the video)
const span = boxFrames(cues, frames);
if (!span) {
  console.error(`${cueFile}: no lines to type (the plan's shots have no \`say\`): nothing drawn. Give them lines, or leave out the plan's \`overlay\`.`);
  process.exit(1);
}

const HEIGHT = Math.round(width * 0.2); // the strip at the top the box is drawn in
const s = width / 1280;
const fonts = pathToFileURL(join(ROOT, "web/assets/fonts/fonts-app.css")).href;
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${fonts}"><style>
html, body { margin: 0; background: transparent; }
.strip { width: ${width}px; height: ${HEIGHT}px; display: flex; align-items: flex-start; }
/* the whole width of the picture, from its top edge; the text a column of the box's width in the middle */
.box { position: relative; width: 100%; box-sizing: border-box; padding: ${10 * s}px max(${20 * s}px, calc((100% - ${BOX.columns + 3}ch) / 2));
  background: rgba(0, 12, 48, .84); border-bottom: ${1.5 * s}px solid rgba(54, 184, 191, .65);
  box-shadow: 0 0 ${18 * s}px rgba(54, 184, 191, .25), 0 ${6 * s}px ${24 * s}px rgba(0, 0, 0, .45);
  font: 600 ${24 * s}px/1.5 "Noto Sans Mono", monospace; letter-spacing: .01em; white-space: pre; }
/* the lines of an old screen */
.box::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: repeating-linear-gradient(to bottom, rgba(255, 255, 255, .05) 0 ${1 * s}px, transparent ${1 * s}px ${3 * s}px); }
.row { height: 1.5em; overflow: hidden; text-shadow: 0 0 ${7 * s}px rgba(54, 184, 191, .6); }
.prompt { color: ${BOX.prompt}; margin-right: .6em; }
.cursor { display: inline-block; width: .6em; height: 1.05em; margin-left: .06em; vertical-align: -.17em; background: ${BOX.prompt};
  box-shadow: 0 0 ${8 * s}px rgba(54, 184, 191, .9); }
.cursor.off { visibility: hidden; }
</style></head><body><div class="strip"><div class="box" id="box"></div></div>
<script>
// rows: [{text, color, cursor (true / false / "blink")}]
window.__draw = (rows) => {
  const box = document.getElementById("box");
  box.replaceChildren(...rows.map((r) => {
    const row = document.createElement("div");
    row.className = "row";
    const p = document.createElement("span");
    p.className = "prompt";
    p.textContent = ">";
    const t = document.createElement("span");
    t.textContent = r.text;
    t.style.color = r.color;
    row.append(p, t);
    if (r.cursor) {
      const c = document.createElement("span");
      c.className = "cursor" + (r.cursor === "off" ? " off" : "");
      row.append(c);
    }
    return row;
  }));
};
</script></body></html>`;

const rows = (f) => rowsAt(cues, f, { fps, cps });

const long = tooLong(cues);
if (long) throw new Error(`a line longer than the box (${BOX.columns} characters): ${long.text}`);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: HEIGHT }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
const { first, last } = span;
for (let f = first; f < last; f++) {
  await page.evaluate((r) => window.__draw(r), rows(f));
  await page.screenshot({ path: join(out, `f${String(f).padStart(4, "0")}.png`), omitBackground: true });
}
await browser.close();
console.log(`${last - first} frames with the box (${cues.length} lines): ${outDir}`);
