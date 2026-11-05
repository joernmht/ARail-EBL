// Full screen (web/app/app.js): the button is the usual icon, and a photo with a digital layer fills
// the screen with its virtual surroundings: the canvas takes the screen's shape, the photo in its
// middle, the lab and the layout's virtual parts around it; taps still find the layout under them.
import { expect, test } from "@playwright/test";

async function openApp(page, path) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.source && !window.__arail.source.stale, null, { timeout: 30_000 });
  return errors;
}

/** The canvas, the picture on it and the screen, as they are now. */
const stage = (page) => page.evaluate(() => {
  const a = window.__arail, c = a.canvas, r = c.getBoundingClientRect();
  return { full: !!document.fullscreenElement, canvas: [c.width, c.height], css: [r.width, r.height], at: { ...a.pictureAt }, photo: [a.source.w, a.source.h], screen: [innerWidth, innerHeight] };
});

/** The layout point under the middle of the photo: picked on the canvas, and straight from the tracking. */
const middle = (page) => page.evaluate(() => {
  const a = window.__arail, c = a.canvas, r = c.getBoundingClientRect(), s = a.source;
  const u = a.pictureAt.x + s.w / 2, v = a.pictureAt.y + s.h / 2;
  const picked = a.eventToLayout({ clientX: r.left + (u * r.width) / c.width, clientY: r.top + (v * r.height) / c.height });
  const h = a.tracker.state.Hinv, d = h[6] * (s.w / 2) + h[7] * (s.h / 2) + h[8];
  const tracked = [(h[0] * (s.w / 2) + h[1] * (s.h / 2) + h[2]) / d, (h[3] * (s.w / 2) + h[4] * (s.h / 2) + h[5]) / d];
  return [picked, tracked].map((p) => p.map((x) => Math.round(x)));
});

test("full screen: the usual icon; a photo with virtual surroundings fills a tablet held upright, above and below it", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  const errors = await openApp(page, "/app/?example=container-task");
  await page.waitForFunction(() => window.__arail.tracker.state.H, null, { timeout: 30_000 });
  const button = page.locator("#btnFullscreen");
  await expect(button).toHaveAccessibleName("Full screen");
  await expect(button).toHaveText(""); // an icon, no text
  await expect(button.locator("svg")).toHaveCount(1);
  const before = await stage(page);
  expect(before.at).toEqual({ x: 0, y: 0 });
  await button.click();
  await expect(button).toHaveAccessibleName("Leave full screen");
  await page.waitForFunction(() => window.__arail.pictureAt.y > 0);
  const s = await stage(page);
  expect(s.full).toBe(true);
  // the canvas has the screen's shape and fills it; the photo lies in its middle, the bands above and below it
  expect(Math.abs(s.css[0] - s.screen[0])).toBeLessThan(2);
  expect(Math.abs(s.css[1] - s.screen[1])).toBeLessThan(2);
  expect(s.canvas[0]).toBe(s.photo[0]);
  expect(s.at.x).toBe(0);
  expect(s.at.y).toBeGreaterThan(100);
  // the bands are drawn (the lab around the photo), not the stage's background
  const corner = await page.evaluate(() => [...window.__arail.ctx.getImageData(4, 4, 1, 1).data]);
  expect(corner[3]).toBe(255);
  expect(corner.slice(0, 3)).not.toEqual([0, 0, 0]);
  // taps find the layout under them as before
  const [picked, tracked] = await middle(page);
  expect(picked).toEqual(tracked);
  // leaving full screen: the photo's own shape again
  await button.click();
  await page.waitForFunction(() => !document.fullscreenElement && window.__arail.pictureAt.y === 0);
  expect((await stage(page)).canvas).toEqual(before.canvas);
  await expect(button).toHaveAccessibleName("Full screen");
  expect(errors).toEqual([]);
});

test("full screen on a wide screen: the bands at the photo's sides are filled; a photo without a digital layer keeps its shape", async ({ page }) => {
  const errors = await openApp(page, "/app/?photo=132526#settings");
  await page.waitForFunction(() => window.__arail.tracker.state.H, null, { timeout: 30_000 });
  await page.locator("#btnFullscreen").click();
  await page.waitForFunction(() => window.__arail.pictureAt.x > 0);
  const s = await stage(page);
  expect(Math.abs(s.css[0] - s.screen[0])).toBeLessThan(2);
  expect(Math.abs(s.css[1] - s.screen[1])).toBeLessThan(2);
  expect(s.at.y).toBe(0);
  const [picked, tracked] = await middle(page);
  expect(picked).toEqual(tracked);
  // the photo only (no digital layer, nothing virtual around it): its own shape, in full screen too
  await page.evaluate(() => window.__arail.tourNav.showPhoto("132434"));
  await page.waitForFunction(() => window.__arail.source?.untracked && window.__arail.source.el.src.endsWith("132434.jpg"), null, { timeout: 30_000 });
  const only = await stage(page);
  expect(only.full).toBe(true);
  expect(only.at).toEqual({ x: 0, y: 0 });
  expect(only.canvas).toEqual(only.photo);
  expect(errors).toEqual([]);
});
