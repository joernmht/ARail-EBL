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

test("moving markers: IDs that cannot be detected or that objects use are refused; a typo can be undone", async ({ page }) => {
  const errors = await openBuild(page);
  const field = page.getByLabel("Moving markers");
  const state = () => page.evaluate(() => ({ moving: [...window.__arail.world.map.moving], ids: window.__arail.world.map.ids() }));
  // beyond markers.codes (50): the detector would never read it
  await field.fill("60");
  await field.press("Enter");
  await expect(page.locator("#toast")).toContainText("Marker 60 cannot be detected: the layout uses the marker IDs 0 … 49");
  // Platform 1 lies between markers 0 and 1: it could no longer be placed
  await field.fill("1");
  await field.press("Enter");
  await expect(page.locator("#toast")).toContainText("Marker 1 cannot be a moving marker: Platform 1 is placed relative to it.");
  expect(await state()).toEqual({ moving: [], ids: [0, 1, 2, 3, 4] });
  expect(await page.evaluate(() => !!window.__arail.world.getObject("platform-1").geometry)).toBe(true);
  // marker 4 (no object uses it) by mistake, then corrected: its fixed pose comes back
  await page.getByRole("button", { name: "Keep positions" }).click();
  await field.fill("4");
  await field.press("Enter");
  expect(await state()).toEqual({ moving: [4], ids: [0, 1, 2, 3] });
  await field.fill("40");
  await field.press("Enter");
  await expect(page.locator("#toast")).toContainText("Marker 4 is back in the map.");
  expect(await state()).toEqual({ moving: [40], ids: [0, 1, 2, 3, 4] });
  expect(await page.evaluate(() => window.__arail.world.toJSON().markers.poses["4"])).toEqual([1159.7, 188.5, -0.69]);
  expect(errors).toEqual([]);
});

test("a video survey that measures nothing leaves the marker map locked", async ({ page }) => {
  const errors = await openBuild(page);
  await page.getByRole("button", { name: "Keep positions" }).click();
  expect(await codes(page)).toBe(5);
  await page.locator("#surveyVideo").setInputFiles({ name: "not-a-video.mp4", mimeType: "video/mp4", buffer: Buffer.from("not a video") });
  await expect(page.locator("#toast")).toContainText("could not be surveyed", { timeout: 30_000 });
  await expect(page.locator("#toast")).toContainText("The marker map is locked again.");
  expect(await page.evaluate(() => window.__arail.world.map.locked)).toBe(true);
  expect(await codes(page)).toBe(5);
  await expect(page.locator("#markerMapStatus")).toContainText("Marker map locked");
  // also in the browser's copy of the layout
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith("arail.layout:"))) || "{}").markers?.locked)).toBe(true);
  expect(errors).toEqual([]);
});

test("locking keeps a marker type that was detected automatically", async ({ page }) => {
  const errors = await openBuild(page);
  await page.selectOption("#layoutDictionary", "auto");
  const detector = () => page.evaluate(() => ({ codes: window.__arail.detector.codes, auto: window.__arail.detector.autoDetecting, label: window.__arail.detector.dictionaryLabel }));
  // the lab photo shows five markers: two detections give enough votes
  for (let i = 0; i < 3 && (await detector()).auto; i++) {
    await page.evaluate(() => window.__arail.redetect());
    await page.waitForTimeout(600);
  }
  expect(await detector()).toEqual({ codes: 50, auto: false, label: "ArUco Original" });
  await page.getByRole("button", { name: "Keep positions" }).click();
  expect(await detector()).toEqual({ codes: 5, auto: false, label: "ArUco Original" });
  await page.getByRole("button", { name: "Unlock" }).click();
  expect(await detector()).toEqual({ codes: 50, auto: false, label: "ArUco Original" });
  // choosing "detect automatically" again starts a new detection (read at once: a detection of the photo follows)
  const restarted = await page.evaluate(() => {
    const select = document.querySelector("#layoutDictionary");
    for (const v of ["ARUCO", "auto"]) {
      select.value = v;
      select.dispatchEvent(new Event("change"));
    }
    return window.__arail.detector.autoDetecting;
  });
  expect(restarted).toBe(true);
  expect(errors).toEqual([]);
});

test("a layout surveyed in 3D: heights in the marker table; markers off the plane are kept, not used for tracking", async ({ page }) => {
  const errors = await openBuild(page);
  // the lab photo's markers lie on the plane; two more were surveyed in 3D: on a raised level and on a wall
  await page.evaluate(async () => {
    const a = window.__arail, json = a.world.toJSON();
    json.markers.poses = { ...json.markers.poses, 20: [500, 300, 15, 62, 0.4, 20], 21: [600, 250, 0, 25, 90, -90] };
    await a._applyLayout(json);
  });
  await page.waitForFunction(() => window.__arail.world.map.ids().length === 7 && window.__arail.tracker.state.H);
  const table = page.locator("#panel-build table").filter({ hasText: "Rotation" });
  await expect(table.locator("th")).toHaveText(["ID", "X", "Y", "Z", "Rotation", "Status"]);
  await expect(table.locator("tr", { hasText: "62.0" })).toContainText("off the plane");
  await expect(page.locator("#markerMapOffPlane")).toContainText("2 markers lie off the layout plane");
  // written back with height and tilt
  const poses = await page.evaluate(() => window.__arail.world.toJSON().markers.poses);
  expect(poses[20]).toEqual([500, 300, 15, 62, 0.4, 20]);
  expect(poses[21]).toEqual([600, 250, 0, 25, 90, -90]);
  expect(poses[0]).toHaveLength(3);
  expect(await page.evaluate(() => window.__arail.tracker.state.used)).toEqual([0, 1, 2, 3, 4]);
  // the flyover draws them (at their height) without trouble
  await page.locator("#btnFlyover").click();
  await page.waitForFunction(() => window.__arail.mode === "flyover");
  await page.evaluate(() => window.__arail.render());
  expect(errors).toEqual([]);
});
