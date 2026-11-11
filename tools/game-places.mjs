// Takes the game's virtual close-ups (web/game/places/*-fly.jpg): pictures of the lab's layouts in
// the app's flyover, with everything in view virtual (trains, town, terminal), by day and at night.
// The table's photo is left out, because it blurs when the camera comes close.
//
//   npm start                                  (in another terminal: the site on port 8000)
//   node tools/game-places.mjs                 (all pictures)
//   node tools/game-places.mjs tram-fly quay-fly --base http://localhost:8123
//
// It needs the browser of the end-to-end tests (npx playwright install chromium). The pictures are
// what web/game/places.js names; a new one needs a line in SHOTS here and one there.
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The size of a picture (px), and its JPEG quality. */
const WIDTH = 1440, HEIGHT = 810, QUALITY = 80;
/** How long the world runs before a picture is taken (ms), so that trains, buses and people are on their way. */
const SETTLE_MS = 2500;

const NEUSTADT = "../layouts/ebl-neustadt.json", TERMINAL = "../layouts/container-terminal.json";
/** The times of day (minutes after midnight). */
const DAY = 8 * 60 + 30, NIGHT = 22 * 60 + 30;

/**
 * The pictures: the layout, the flyover camera (the point looked at in layout mm, its distance in
 * mm, its direction and its tilt in degrees) and the time of day.
 * @type {Array<{name: string, layout: string, target: number[], distance_mm: number, yaw_deg: number, pitch_deg: number, time: number}>}
 */
export const SHOTS = [
  { name: "platform-fly", layout: NEUSTADT, target: [3000, 330], distance_mm: 650, yaw_deg: 20, pitch_deg: 18, time: DAY },
  { name: "forecourt-fly", layout: NEUSTADT, target: [3560, -330], distance_mm: 700, yaw_deg: 60, pitch_deg: 22, time: DAY },
  { name: "town-fly", layout: NEUSTADT, target: [3474, -1300], distance_mm: 1300, yaw_deg: 110, pitch_deg: 25, time: DAY },
  { name: "crossing-fly", layout: NEUSTADT, target: [-560, 404], distance_mm: 650, yaw_deg: 40, pitch_deg: 18, time: DAY },
  { name: "station-fly", layout: NEUSTADT, target: [2930, -150], distance_mm: 900, yaw_deg: 270, pitch_deg: 16, time: DAY },
  { name: "school-fly", layout: NEUSTADT, target: [5050, -1650], distance_mm: 900, yaw_deg: 60, pitch_deg: 20, time: DAY },
  { name: "tram-fly", layout: NEUSTADT, target: [1950, -217], distance_mm: 520, yaw_deg: 10, pitch_deg: 16, time: DAY },
  { name: "overview-fly", layout: NEUSTADT, target: [2600, 0], distance_mm: 5200, yaw_deg: 90, pitch_deg: 42, time: DAY },
  { name: "night-platform-fly", layout: NEUSTADT, target: [3000, 330], distance_mm: 650, yaw_deg: 20, pitch_deg: 18, time: NIGHT },
  { name: "night-town-fly", layout: NEUSTADT, target: [3474, -1300], distance_mm: 1300, yaw_deg: 110, pitch_deg: 25, time: NIGHT },
  { name: "night-line-fly", layout: NEUSTADT, target: [5200, 300], distance_mm: 900, yaw_deg: 10, pitch_deg: 14, time: NIGHT },
  { name: "night-office-fly", layout: NEUSTADT, target: [-2050, -750], distance_mm: 700, yaw_deg: 250, pitch_deg: 16, time: NIGHT },
  { name: "night-crossing-fly", layout: NEUSTADT, target: [-560, 404], distance_mm: 650, yaw_deg: 40, pitch_deg: 18, time: NIGHT },
  { name: "terminal-fly", layout: TERMINAL, target: [750, 420], distance_mm: 900, yaw_deg: 60, pitch_deg: 20, time: DAY },
  { name: "quay-fly", layout: TERMINAL, target: [600, 560], distance_mm: 800, yaw_deg: 300, pitch_deg: 18, time: DAY },
];

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
  const url = `${base}/app/?layout=${layout}#sandbox`;
  await page.goto(url);
  // nothing kept from an earlier visit: the layout as it is in its file
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  await page.waitForFunction(() => window.__arail?.world?.objects?.length, null, { timeout: 30_000 });
  const view = page.locator("#btnView");
  for (let i = 0; i < 4 && (await view.getAttribute("data-view")) !== "flyover"; i++) await view.click();
  await page.waitForFunction(() => window.__arail.mode === "flyover");
  // without the table's photo, and without the app's interface: only the stage
  await page.evaluate(() => {
    const app = window.__arail;
    if (app.world.layout.view) app.world.layout.view.ortho = null;
    app.flyover.ortho = null;
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
