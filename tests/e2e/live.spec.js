// The live page (web/live/): the demo draws the town once and fits it to the visitor's head, the
// cars in every frame; without the town's picture everything is drawn in every frame; the settings
// and keys; the markers of a video found in the worker.
import { expect, test } from "@playwright/test";
import { atPath, hasScene, routeScene, SCENE, SCENE_VIDEO } from "./scene.js";

/** Pixels drawn (alpha > 0) on a canvas of the stage. */
const drawn = (page, id) => page.evaluate((cid) => {
  const c = document.getElementById(cid), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
  return n;
}, id);

test("the demo: the town drawn once and fitted to the camera, the cars in every frame", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/live/?source=demo");
  await page.waitForFunction(() => window.__live?.pose && window.__live.stats.why.first === 1);
  const start = await page.evaluate(() => window.__live.stats.count);
  await page.waitForTimeout(3000);
  const s = await page.evaluate(() => {
    const l = window.__live;
    return { frames: l.stats.count, redraws: Object.values(l.stats.why).reduce((a, b) => a + b, 0), cars: l.world.simulations[0].cars.length };
  });
  const frames = s.frames - start;
  expect(frames).toBeGreaterThan(20);
  expect(s.redraws).toBeLessThan(frames / 3);
  expect(s.cars).toBeGreaterThan(0);
  await expect(page.locator("#layer-city")).toBeVisible();
  expect(await page.locator("#layer-city").evaluate((c) => c.style.transform)).toMatch(/^matrix3d\(/);
  expect(await drawn(page, "layer-city")).toBeGreaterThan(10_000);
  expect(await drawn(page, "layer-cars")).toBeGreaterThan(0);
  await expect(page.locator("#stats")).toContainText("drawn/s");
  await expect(page.locator("#stats")).toContainText("driving");
  expect(errors).toEqual([]);
});

test("without the town's picture everything is drawn in every frame", async ({ page }) => {
  await page.goto("/live/?source=demo&cache=0");
  await page.waitForFunction(() => window.__live?.pose && window.__live.stats.count > 10);
  await expect(page.locator("#layer-city")).toBeHidden();
  await expect(page.locator("#stats")).toContainText("drawn in every frame");
  // the whole town on the canvas of what moves
  expect(await drawn(page, "layer-cars")).toBeGreaterThan(10_000);
});

test("settings and keys: the address keeps them, the fit to the glasses moves the view", async ({ page }) => {
  await page.goto("/live/?source=demo");
  await page.waitForFunction(() => window.__live?.pose);
  await page.locator("#layer-cars").click();
  await page.keyboard.press("s");
  await expect(page.locator("#settings")).toBeVisible();
  await expect(page.locator("#btnSettings")).toHaveAttribute("aria-expanded", "true");
  await page.locator("#error").fill("4");
  await expect(page).toHaveURL(/error=4/);
  expect(await page.evaluate(() => window.__live.cache.options.maxError)).toBe(4);
  await page.locator("#background-mode").selectOption("black");
  await expect(page).toHaveURL(/bg=black/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings")).toBeHidden();
  // the focus goes back to the button, so the keys reach the page, not a hidden control
  await expect(page.locator("#btnSettings")).toBeFocused();
  await page.keyboard.press("c");
  await expect(page).toHaveURL(/cache=0/);
  await expect(page.locator("#layer-city")).toBeHidden();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
  await expect(page.locator("#view")).toHaveAttribute("style", /translate\(2px, 0px\).*scale\(1\.01\)/);
  await page.keyboard.press("0");
  await expect(page.locator("#view")).toHaveAttribute("style", /translate\(0px, 0px\).*scale\(1\)/);
  await page.keyboard.press("h");
  await expect(page.locator("#hud")).toBeHidden();
});

test("a video: its markers found in the worker, the town fitted to them", async ({ page }) => {
  test.skip(!hasScene(), "fixtures missing: npm run fixtures");
  await routeScene(page);
  await page.route(atPath("/media/test-scene.webm"), (route) => route.fulfill({ path: SCENE_VIDEO, contentType: "video/webm" }));
  await page.goto(`/live/?source=clip&video=../media/test-scene.webm&layout=${SCENE}`);
  await page.waitForFunction(() => window.__live?.pose && window.__live.detectorWhere === "worker", null, { timeout: 30_000 });
  const s = await page.evaluate(() => ({ found: window.__live.markers.found, objects: window.__live.world.objects.map((o) => o.type) }));
  expect(s.found).toBeGreaterThan(2);
  expect(s.objects).not.toContain("platform");
  expect(s.objects).toContain("building");
  await expect(page.locator("#stats")).toContainText("worker");
  expect(await page.locator("#layer-city").evaluate((c) => c.style.transform)).toMatch(/^matrix3d\(/);
});
