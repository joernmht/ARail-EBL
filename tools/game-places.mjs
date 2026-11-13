// Takes the game's virtual close-ups (web/game/places/*-fly.jpg): pictures of the lab's layouts in
// the app's flyover, with everything in view virtual (trains, town, terminal), by day and at night.
// The table's photo is left out, because it blurs when the camera comes close; labels and the marker
// plates too, because a picture of the game carries no information boxes.
//
//   npm start                                  (in another terminal: the site on port 8000)
//   node tools/game-places.mjs                 (all pictures)
//   node tools/game-places.mjs tram-fly quay-fly --base http://localhost:8123
//
// It needs the browser of the end-to-end tests (npx playwright install chromium). The pictures are
// what web/game/places.js names; a new one needs a line in SHOTS (web/game/shots.js) and one there.
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SHOTS } from "../web/game/shots.js";

/** The size of a picture (px), and its JPEG quality. */
const WIDTH = 1440, HEIGHT = 810, QUALITY = 80;
/** How long the world runs before a picture is taken (ms), so that trains, buses and people are on their way. */
const SETTLE_MS = 2500;

// the pictures and their camera positions: web/game/shots.js (the live backdrop of the game flies between the same)
export { SHOTS };

/**
 * What the command line asks for: the pictures named (all without names) and the site's address.
 * @param {string[]} argv
 * @returns {{names: string[], base: string}}
 */
export function parseArgs(argv) {
  const names = [];
  let base = "http://localhost:8000";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") base = argv[++i] ?? base;
    else names.push(argv[i].replace(/\.jpg$/, ""));
  }
  return { names, base: base.replace(/\/$/, "") };
}

/** Take the pictures of one layout: the app in the flyover, its interface hidden, the camera put where each picture wants it. */
async function takeLayout(browser, base, layout, shots, out) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  const url = `${base}/app/?layout=../${layout}#sandbox`;
  await page.goto(url);
  // nothing kept from an earlier visit: the layout as it is in its file
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  await page.waitForFunction(() => window.__arail?.world?.objects?.length, null, { timeout: 30_000 });
  const view = page.locator("#btnView");
  for (let i = 0; i < 4 && (await view.getAttribute("data-view")) !== "flyover"; i++) await view.click();
  await page.waitForFunction(() => window.__arail.mode === "flyover");
  // without the table's photo, and without the app's interface: only the stage. And without information in the
  // picture: no labels (signs, trains' lines, stops' boards) and no marker plates with their numbers; the game puts its
  // information beside the picture (tests/e2e/play.spec.js checks it), signs of the world itself stay
  // (the views of the flyover's frames are Views: the last one drawn gives their class)
  await page.waitForFunction(() => window.__arail.lastView);
  await page.evaluate(() => {
    const app = window.__arail;
    if (app.world.layout.view) app.world.layout.view.ortho = null;
    app.flyover.ortho = null;
    app.display.flyMarkers = false;
    app.world.settings.labels = false;
    Object.getPrototypeOf(app.lastView).label = function () {};
  });
  await page.addStyleTag({ content: ".hud,.sim-clock,.fly-nav,.stage-tools,.toast,.panel,.bar,.placing{display:none!important}.main{grid-template-columns:1fr!important}.app{grid-template-rows:1fr!important}" });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await page.waitForTimeout(SETTLE_MS);
  let time = null;
  for (const shot of shots) {
    if (shot.time !== time) {
      time = shot.time;
      await page.evaluate((t) => window.__arail.world.setTime(t), time);
      await page.waitForTimeout(SETTLE_MS);
    }
    await page.evaluate((s) => {
      const fly = window.__arail.flyover;
      fly.anim = null;
      fly.cam.set({ target: s.target, distance: s.distance_mm, yaw: (s.yaw_deg * Math.PI) / 180, pitch: (s.pitch_deg * Math.PI) / 180 });
    }, shot);
    await page.waitForTimeout(SETTLE_MS / 2);
    await page.locator("#stage").screenshot({ path: join(out, `${shot.name}.jpg`), type: "jpeg", quality: QUALITY });
    console.log(`${shot.name}.jpg`);
  }
  await page.close();
}

/** Take the pictures asked for and write them into web/game/places/. */
async function main() {
  const { names, base } = parseArgs(process.argv.slice(2));
  const unknown = names.filter((n) => !SHOTS.some((s) => s.name === n));
  if (unknown.length) {
    console.error(`No such picture: ${unknown.join(", ")}. There are: ${SHOTS.map((s) => s.name).join(", ")}.`);
    process.exit(1);
  }
  const shots = SHOTS.filter((s) => !names.length || names.includes(s.name));
  const out = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "game", "places");
  await mkdir(out, { recursive: true });
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    for (const layout of [...new Set(shots.map((s) => s.layout))]) await takeLayout(browser, base, layout, shots.filter((s) => s.layout === layout), out);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
