// The locked marker map (Build → Marker map): Keep positions locks it, live tracking then uses
// only the measured markers (and fewer detector codes); moving markers are never part of it.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function openBuild(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/app/#build");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/app/#build");
  await page.waitForFunction(() => window.__arail?.tracker.state.H && window.__arail.world.map.ids().length === 5, null, { timeout: 30_000 });
  return errors;
}

const codes = (page) => page.evaluate(() => window.__arail.detector.codes);
const hud = (page) => page.locator("#hud");

test("Keep positions locks the marker map; Unlock and Measure again open it again", async ({ page }) => {
  const errors = await openBuild(page);
  expect(await codes(page)).toBe(50);
  await page.getByRole("button", { name: "Keep positions" }).click();
  await expect(page.locator("#markerMapStatus")).toHaveText("Marker map locked: only these 5 markers are used; new markers are ignored.");
  await expect(page.locator("#toast")).toContainText("Marker map locked");
  expect(await codes(page)).toBe(5); // markers 0-4: five codes, further apart
  await page.evaluate(() => window.__arail.render());
  await expect(hud(page)).toContainText("Tracking · 5 markers · locked");
  // kept in the browser and in the exported layout
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith("arail.layout:"))) || "{}").markers?.locked)).toBe(true);
  // the locked state has no accessibility problems either
  const results = await new AxeBuilder({ page }).include("#panel-build").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  // after a reload the map is still locked
  await page.reload();
  await page.waitForFunction(() => window.__arail?.tracker.state.H);
  expect(await page.evaluate(() => window.__arail.world.map.locked)).toBe(true);
  expect(await codes(page)).toBe(5);
  await page.getByRole("button", { name: "Unlock" }).click();
  expect(await page.evaluate(() => window.__arail.world.map.locked)).toBe(false);
  expect(await codes(page)).toBe(50);
  await expect(page.locator("#markerMapStatus")).toContainText("Unknown markers are measured automatically");
  await expect(page.getByRole("button", { name: "Unlock" })).toHaveCount(0);
  await page.getByRole("button", { name: "Keep positions" }).click();
  await page.getByRole("button", { name: "Measure again" }).click();
  expect(await page.evaluate(() => window.__arail.world.map.locked)).toBe(false);
  expect(await codes(page)).toBe(50);
  expect(errors).toEqual([]);
});

test("moving markers are taken out of the map and still detected", async ({ page }) => {
  const errors = await openBuild(page);
  const field = page.getByLabel("Moving markers");
  await expect(field).toHaveAccessibleDescription(/never part of the map/);
  await field.fill("4, 40");
  await field.press("Enter");
  await expect(page.locator("#toast")).toContainText("Marker 4 is a moving marker now and was removed from the map.");
  expect(await page.evaluate(() => window.__arail.world.map.ids())).toEqual([0, 1, 2, 3]);
  await page.getByRole("button", { name: "Keep positions" }).click();
  expect(await codes(page)).toBe(41); // the moving marker 40 must be detected, too
  const markers = await page.evaluate(() => window.__arail.world.toJSON().markers);
  expect(markers.moving).toEqual([4, 40]);
  expect(markers.locked).toBe(true);
  expect(Object.keys(markers.poses)).toEqual(["0", "1", "2", "3"]);
  // marker 4 is in the lab photo: it is reported as a moving marker on the layout plane
  await page.evaluate(() => window.__arail.redetect());
  await expect.poll(() => page.evaluate(() => Object.keys(window.__arail.tracker.state.moving))).toEqual(["4"]);
  const center = await page.evaluate(() => window.__arail.tracker.state.moving[4].center);
  expect(Math.hypot(center[0] - 1159.7, center[1] - 188.5)).toBeLessThan(15);
  // not a marker ID, or the origin: refused, nothing changes
  await field.fill("4, x");
  await field.press("Enter");
  await expect(page.locator("#toast")).toContainText("“x” is not a marker ID");
  await field.fill("0");
  await field.press("Enter");
  await expect(page.locator("#toast")).toContainText("Marker 0 defines the layout frame");
  expect(await page.evaluate(() => [...window.__arail.world.map.moving])).toEqual([4, 40]);
  expect(errors).toEqual([]);
});
