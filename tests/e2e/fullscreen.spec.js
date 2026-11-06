// Full screen (web/app/app.js): the button is the usual icon, and a photo with a digital layer fills
// the screen with its virtual surroundings: the canvas takes the screen's shape, the photo at its top
// (on a wide screen in its middle), the lab and the layout's virtual parts below it (or at its sides);
// taps still find the layout under them.
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

/**
 * The layout point under the middle of the photo: picked on the canvas (a tap, and the terminal's pick
 * of a carrier on the ground), and straight from the tracking.
 */
const middle = (page) => page.evaluate(() => {
  const a = window.__arail, c = a.canvas, r = c.getBoundingClientRect(), s = a.source;
  const u = a.pictureAt.x + s.w / 2, v = a.pictureAt.y + s.h / 2;
  const picked = a.eventToLayout({ clientX: r.left + (u * r.width) / c.width, clientY: r.top + (v * r.height) / c.height });
  const ground = a.terminal?.sim ? a.terminal._groundPoint(u, v) : picked;
  const h = a.tracker.state.Hinv, d = h[6] * (s.w / 2) + h[7] * (s.h / 2) + h[8];
  const tracked = [(h[0] * (s.w / 2) + h[1] * (s.h / 2) + h[2]) / d, (h[3] * (s.w / 2) + h[4] * (s.h / 2) + h[5]) / d];
  return [picked, ground, tracked].map((p) => p.map((x) => Math.round(x)));
});

/** How often a frame drew the orthophoto around the photo (counted over a few frames). */
const orthoAround = (page) => page.evaluate(async () => {
  const a = window.__arail, f = a._drawOrthoAround;
  let n = 0;
  a._drawOrthoAround = (...args) => {
    n++;
    return f.apply(a, args);
  };
  await new Promise((r) => setTimeout(r, 300));
  a._drawOrthoAround = f;
  return n;
});

test("full screen: the usual icon; a photo with virtual surroundings fills a tablet held upright downwards, the photo at the top", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  const errors = await openApp(page, "/app/?example=container-task");
  await page.waitForFunction(() => window.__arail.tracker.state.H, null, { timeout: 30_000 });
  const button = page.locator("#btnFullscreen");
  await expect(button).toHaveAccessibleName("Full screen");
  await expect(button).toHaveText(""); // an icon, no text
  await expect(button.locator("svg")).toHaveCount(1);
  const before = await stage(page);
  expect(before.at).toEqual({ x: 0, y: 0 });
  // outside full screen the band below the photo (view.extend_below) is the floor, as ever: no orthophoto
  await page.waitForFunction(() => window.__arail.flyover.orthophoto());
  expect(await orthoAround(page)).toBe(0);
  await button.click();
  await expect(button).toHaveAccessibleName("Leave full screen");
  await page.waitForFunction(() => {
    const c = window.__arail.canvas;
    return !!document.fullscreenElement && Math.abs(c.width / c.height - innerWidth / innerHeight) < 0.01;
  });
  const s = await stage(page);
  expect(s.full).toBe(true);
  // the canvas has the screen's shape and fills it; the photo stays at its top (no empty sky above it),
  // the canvas goes on below it, beyond the band of view.extend_below
  expect(Math.abs(s.css[0] - s.screen[0])).toBeLessThan(2);
  expect(Math.abs(s.css[1] - s.screen[1])).toBeLessThan(2);
  expect(s.canvas[0]).toBe(s.photo[0]);
  expect(s.at).toEqual({ x: 0, y: 0 });
  expect(s.canvas[1]).toBeGreaterThan(before.canvas[1] + 100);
  // the room below is drawn (the lab in front of the table), not the stage's background
  const corner = await page.evaluate(() => {
    const c = window.__arail.canvas;
    return [...window.__arail.ctx.getImageData(4, c.height - 4, 1, 1).data];
  });
  expect(corner[3]).toBe(255);
  expect(corner.slice(0, 3)).not.toEqual([0, 0, 0]);
  // the real table goes on around the photo
  expect(await orthoAround(page)).toBeGreaterThan(0);
  // taps find the layout under them as before, also the terminal's pick of a carrier on the ground
  const [picked, ground, tracked] = await middle(page);
  expect(picked).toEqual(tracked);
  expect(ground).toEqual(tracked);
  // leaving full screen: the photo's own shape again
  await button.click();
  await page.waitForFunction((h) => !document.fullscreenElement && window.__arail.canvas.height === h, before.canvas[1]);
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
  const [picked, , tracked] = await middle(page);
  expect(picked).toEqual(tracked);
  // to the next part: the canvas keeps the screen's shape all the way (no step back to the photo's own shape)
  const aspect = s.screen[0] / s.screen[1];
  await page.evaluate(() => {
    const a = window.__arail, size = a.sizeCanvas.bind(a);
    window.__shapes = [];
    a.sizeCanvas = () => {
      size();
      window.__shapes.push(a.canvas.width / a.canvas.height);
    };
  });
  await page.locator('#tour [data-step="1"]').click();
  await page.waitForFunction(() => window.__arail.tourNav.showing() && window.__arail.tourNav.at.photo.id === "132439" && window.__arail.tracker.state.H, null, { timeout: 30_000 });
  const shapes = await page.evaluate(() => window.__shapes);
  expect(shapes.length).toBeGreaterThan(0);
  for (const k of shapes) expect(Math.abs(k - aspect)).toBeLessThan(0.01);
  // the photo only (no digital layer, nothing virtual around it): its own shape, in full screen too
  await page.evaluate(() => window.__arail.tourNav.showPhoto("132434"));
  await page.waitForFunction(() => window.__arail.source?.untracked && window.__arail.source.el.src.endsWith("132434.jpg"), null, { timeout: 30_000 });
  const only = await stage(page);
  expect(only.full).toBe(true);
  expect(only.at).toEqual({ x: 0, y: 0 });
  expect(only.canvas).toEqual(only.photo);
  expect(errors).toEqual([]);
});

test("full screen: a photo of one's own the layout finds no markers in keeps its shape", async ({ page }) => {
  const errors = await openApp(page, "/app/?layout=../layouts/ebl-lab.json#view");
  await page.locator("#fileOpen").setInputFiles("web/assets/town-day.jpg");
  await page.waitForFunction(() => window.__arail.source?.name === "town-day.jpg", null, { timeout: 30_000 });
  await page.waitForTimeout(500); // the markers looked for
  expect(await page.evaluate(() => [!!window.__arail.tracker.state.H, window.__arail.source.registered])).toEqual([false, false]);
  await page.locator("#btnFullscreen").click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.waitForTimeout(300);
  const s = await stage(page);
  expect(s.at).toEqual({ x: 0, y: 0 });
  expect(s.canvas).toEqual(s.photo);
  expect(errors).toEqual([]);
});

test("full screen: one's own photo the layout is found in fills the screen once tracked; an image from a link without markers keeps its shape", async ({ page }) => {
  // a photo of one's own (here the lab's) in which the layout is found
  const errors = await openApp(page, "/app/?layout=../layouts/ebl-lab.json#view");
  await page.locator("#fileOpen").setInputFiles("web/media/ebl-lab.jpg");
  await page.waitForFunction(() => window.__arail.source?.name === "ebl-lab.jpg" && window.__arail.tracker.state.H, null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__arail.source.registered)).toBe(true);
  await page.locator("#btnFullscreen").click();
  await page.waitForFunction(() => !!document.fullscreenElement && window.__arail.pictureAt.x + window.__arail.pictureAt.y > 0);
  const own = await stage(page);
  expect(Math.abs(own.canvas[0] / own.canvas[1] - own.screen[0] / own.screen[1])).toBeLessThan(0.01);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  // an image named by a link (?image=) in which the layout finds no markers: its own shape, in full screen too
  await page.goto("/app/?layout=../layouts/ebl-lab.json&image=../assets/town-day.jpg#view");
  await page.waitForFunction(() => /town-day\.jpg$/.test(window.__arail?.source?.el?.src || ""), null, { timeout: 30_000 });
  await page.waitForTimeout(500); // the markers looked for
  expect(await page.evaluate(() => [!!window.__arail.tracker.state.H, window.__arail.source.registered])).toEqual([false, false]);
  await page.locator("#btnFullscreen").click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.waitForTimeout(300);
  const link = await stage(page);
  expect(link.at).toEqual({ x: 0, y: 0 });
  expect(link.canvas).toEqual(link.photo);
  expect(errors).toEqual([]);
});

test("full screen: a layout's own photo the layout is not found in keeps its shape", async ({ page }) => {
  // the lab's layout with another photo of its own, one without its markers (a layout from a link whose photo does not track)
  await page.route((url) => url.pathname.endsWith("/layouts/ebl-lab.json"), async (route) => {
    const res = await route.fetch(), json = await res.json();
    json.view = { ...json.view, image: "../assets/town-day.jpg" };
    delete json.view.image_covered;
    await route.fulfill({ response: res, json });
  });
  const errors = await openApp(page, "/app/?layout=../layouts/ebl-lab.json#view");
  await page.waitForFunction(() => /town-day\.jpg$/.test(window.__arail?.source?.el?.src || ""), null, { timeout: 30_000 });
  // the app comes with it, but its markers are not found: not registered once it was looked at
  await page.waitForFunction(() => window.__arail.source.registered === false, null, { timeout: 10_000 });
  await page.locator("#btnFullscreen").click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.waitForTimeout(300);
  const s = await stage(page);
  expect(s.at).toEqual({ x: 0, y: 0 });
  expect(s.canvas).toEqual(s.photo);
  expect(errors).toEqual([]);
});
test("full screen: a clip the app comes with fills the screen only once the layout is found in it", async ({ page }) => {
  const errors = await openApp(page, "/app/?photo=132526#view");
  // a clip of the app (known) in which nothing is found yet (here one without frames): not registered, so
  // in full screen it keeps its shape; a photo of the app is registered at once
  const registered = await page.evaluate(() => {
    const a = window.__arail, photo = a.source.registered;
    a.setSource(document.createElement("video"), "video", 640, 360, "clip", null, { known: true });
    return [photo, a.source.registered];
  });
  expect(registered).toEqual([true, false]);
  await page.locator("#btnFullscreen").click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.waitForTimeout(300);
  const s = await stage(page);
  expect(s.at).toEqual({ x: 0, y: 0 });
  expect(s.canvas).toEqual([640, 360]);
  expect(errors).toEqual([]);
});
