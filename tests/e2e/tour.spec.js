// The photo tour of the app (web/app/tour-nav.js): the lab's photos as a Street View. The arrows go
// to the next part in the same perspective, the button in the upper left corner switches to the next
// side; a photo with a digital layer opens with its layout and is tracked, the others are shown as
// photos only.
import { expect, test } from "@playwright/test";

function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function openApp(page, path) {
  const errors = trackErrors(page);
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.tourNav?.tour, null, { timeout: 30_000 });
  return errors;
}

/** The tour's photo on the stage: [photo id, perspective], once it is the source. */
const shown = (page) => page.evaluate(() => {
  const t = window.__arail.tourNav;
  return t.showing() ? [t.at.photo.id, t.at.perspective] : null;
});

const tracked = (page) => page.waitForFunction(() => window.__arail.tourNav.showing() && window.__arail.tracker.state.H, null, { timeout: 30_000 });

/** Click the perspective button until the tour shows its photo from that side (at most once round). */
async function turnTo(page, perspective) {
  for (let i = 0; i < 6; i++) {
    const was = await shown(page);
    if (was?.[1] === perspective) return;
    await page.locator("#tourView").click();
    await page.waitForFunction((id) => window.__arail.tourNav.showing() && window.__arail.tourNav.at.photo.id !== id, was?.[0] ?? null, { timeout: 30_000 });
  }
  expect((await shown(page))?.[1]).toBe(perspective);
}

test("the arrows go round the lab in the same perspective; with a digital layer the photo is tracked, without it is the photo only", async ({ page }) => {
  const errors = await openApp(page, "/app/?photo=132526");
  // Bf Neustadt, its platforms from the front: tracked, no chip on the stage, the address keeps the photo
  await tracked(page);
  expect(await shown(page)).toEqual(["132526", "front"]);
  await expect(page.locator("#hud")).toBeEmpty();
  // one perspective button: the side of the photo shown, and where a click goes (the part's next side round the table)
  const view = page.locator("#tourView");
  await expect(page.locator("#tour button:not(.tour-step)")).toHaveCount(1);
  await expect(view).toHaveAccessibleName("Perspective: From the front");
  await expect(view).toHaveAccessibleDescription("Next perspective: From the front right");
  expect(await page.evaluate(() => window.__arail.tourNav.perspectivesHere())).toEqual(["front", "front-right", "back-left"]);
  // → : the next part towards Waldhof, again from the front
  await page.locator('[data-step="1"]').click();
  await expect.poll(() => shown(page)).toEqual(["132439", "front"]);
  await tracked(page);
  expect(page.url()).toMatch(/\?photo=132439$/);
  // the key → (nothing focused): Waldhof south, with the same digital layer: tracked, the layout stays
  await page.locator("body").focus();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => shown(page)).toEqual(["132409", "front"]);
  await tracked(page);
  await expect(page.locator("#hud")).not.toContainText("Photo only");
  expect(await page.evaluate(() => window.__arail.world.layout.name)).toBe("EBL Bf Neustadt and terminal (example)");
  // round the table to the front left (the front right and the back left on the way): a photo without
  // a digital layer, the photo only, not tracked
  await page.locator("#tourView").click();
  await expect.poll(() => shown(page)).toEqual(["132413", "front-right"]);
  await turnTo(page, "front-left");
  await expect.poll(() => shown(page)).toEqual(["132434", "front-left"]);
  await expect(page.locator("#hud")).toContainText("Photo only: no digital layer for this part yet");
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => ({ H: !!window.__arail.tracker.state.H, untracked: window.__arail.source.untracked, layout: window.__arail.world.layout.name })))
    .toEqual({ H: false, untracked: true, layout: "EBL Bf Neustadt and terminal (example)" });
  // from the back left; → from the back goes the other way round: back to Bf Neustadt, tracked again
  await turnTo(page, "back-left");
  await expect.poll(() => shown(page)).toEqual(["132826", "back-left"]);
  await page.locator('[data-step="1"]').click();
  await expect.poll(() => shown(page)).toEqual(["132809", "back-left"]);
  await tracked(page);
  await expect(page.locator("#hud")).not.toContainText("Photo only");
  expect(errors).toEqual([]);
});

test("two quick clicks on the perspective button go two sides on, also while the first photo still loads", async ({ page }) => {
  const errors = await openApp(page, "/app/?photo=132409");
  await tracked(page);
  // the next side's photo comes late: the second click comes while it is on its way (and the HUD refreshes)
  let send;
  await page.route("**/lab-map/photos/132413.jpg", async (route) => {
    await new Promise((resolve) => (send = resolve));
    await route.continue();
  });
  await page.locator("#tourView").click(); // → from the front right (on its way)
  await expect.poll(() => typeof send).toBe("function");
  await page.waitForTimeout(600);
  await expect(page.locator("#tourView")).toHaveAccessibleName("Perspective: From the front right");
  await page.locator("#tourView").click(); // → from the back left
  send();
  await expect.poll(() => shown(page), { timeout: 30_000 }).toEqual(["132826", "back-left"]);
  expect(errors).toEqual([]);
});

test("the hybrid train's layout reopened with its own photo, no scenario: the tour knows the photo, and a change of perspective comes back to it", async ({ page }) => {
  const errors = await openApp(page, "/app/?layout=../layouts/ebl-container-train.json#scenarios");
  await page.waitForFunction(() => window.__arail.tourNav.showing(), null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__arail.tourNav.scope)).toBeNull();
  expect(await shown(page)).toEqual(["terminal-wagons", "front"]);
  await page.locator("#tourView").click(); // the next side of the goods yard
  await expect.poll(() => shown(page), { timeout: 30_000 }).toEqual(["141017", "front-right"]);
  await turnTo(page, "front"); // once round the table
  expect(await page.evaluate(() => window.__arail.source.el.src.replace(/.*\//, ""))).toBe("ebl-container-train.jpg");
  expect(errors).toEqual([]);
});

test("a link with a photo and the hybrid train's example: the photo chooses the layout, the scenario's photos are not offered", async ({ page }) => {
  const errors = await openApp(page, "/app/?photo=132526&example=container-task");
  await tracked(page);
  expect(await page.evaluate(() => [window.__arail.layoutUrl.replace(/.*\//, ""), window.__arail.activeCase, window.__arail.caseById("terminal").opened, window.__arail.tourNav.scope])).toEqual(["ebl-neustadt.json", "terminal", false, null]);
  expect(errors).toEqual([]);
});

test("a photo that cannot be loaded: the stage and the perspective button stay at the photo shown", async ({ page }) => {
  const errors = await openApp(page, "/app/?photo=132409");
  await tracked(page);
  await page.route("**/lab-map/photos/132413.jpg", (route) => route.abort());
  // the next side of Waldhof south, from the front right, fails to load
  await page.locator("#tourView").click();
  await expect(page.locator("#toast")).toContainText("could not be loaded");
  // the tour is at the photo still shown: the button names it, and the next click goes to that side again
  await page.waitForFunction(() => window.__arail.tourNav.showing());
  expect(await shown(page)).toEqual(["132409", "front"]);
  await expect(page.locator("#tourView")).toHaveAccessibleName("Perspective: From the front");
  await expect(page.locator("#tourView")).toHaveAccessibleDescription("Next perspective: From the front right");
  expect(errors).toEqual([]);
});

test("a photo of the container train opens its layout; the examples in Settings → View open theirs", async ({ page }) => {
  const errors = await openApp(page, "/app/?photo=132257");
  await expect(page.locator("#layoutName")).toHaveText("EBL hybrid container train (example)");
  await tracked(page);
  expect(await shown(page)).toEqual(["132257", "front"]);
  // the list of layouts is no longer in the bar: the examples are in the View panel
  await expect(page.locator("#exampleSelect")).toHaveCount(0);
  await page.locator("#tab-settings").click();
  await page.locator("#settingsView-view").click();
  await page.locator("#example-neustadt").click();
  await page.waitForFunction(() => window.__arail.world.layout.name === "EBL Bf Neustadt and terminal (example)" && window.__arail.tracker.state.H);
  expect(await shown(page)).toBeNull(); // the layout's own photo, not one of the tour's
  // the tour goes on from the part of Bf Neustadt with the platforms: the button opens its photo from
  // the side chosen (the front)
  await page.locator("#tourView").click();
  await expect.poll(() => shown(page)).toEqual(["132526", "front"]);
  expect(errors).toEqual([]);
});

test("the hybrid container train's example with its scenario shown: the tour offers the photos with the terminal and the train, its own photo among them", async ({ page }) => {
  const errors = await openApp(page, "/app/?example=container-task");
  await page.waitForFunction(() => /ebl-container-train\.jpg$/.test(window.__arail.source?.el?.src || "") && window.__arail.tourNav.showing(), null, { timeout: 30_000 });
  // not started, but its example is open: the scenario's photos only, the photo shown is their front
  expect(await page.evaluate(() => [window.__arail.activeCase, window.__arail.caseById("terminal").started, window.__arail.tourNav.scope?.key])).toEqual(["terminal", false, "terminal|container||wagons"]);
  expect(await shown(page)).toEqual(["terminal-wagons", "front"]);
  expect(await page.evaluate(() => window.__arail.tourNav.tour.photos().map((p) => p.id))).toEqual(["141012", "terminal-wagons"]);
  // the list of scenarios: all photos again
  await page.locator("#scenariosBack").click();
  await page.waitForFunction(() => !window.__arail.tourNav.scope);
  // the example opened again from Settings → View: its scenario shown, its photos only
  await page.locator("#tab-settings").click();
  await page.locator("#settingsView-view").click();
  await page.locator("#example-container-task").click();
  await page.waitForFunction(() => window.__arail.activeCase === "terminal" && window.__arail.tourNav.scope?.key === "terminal|container||wagons", null, { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("the hybrid train's scenario only selected (not started, its example not opened): the tour walks into its part with all photos and the arrows", async ({ page }) => {
  const errors = await openApp(page, "/app/?photo=132409#terminal");
  await tracked(page);
  expect(await page.evaluate(() => [window.__arail.activeCase, window.__arail.caseById("terminal").started])).toEqual(["terminal", false]);
  // → from the front: Waldhof, then the goods yard, whose photo from the front opens the hybrid train's layout
  await page.locator('[data-step="1"]').click();
  await expect.poll(() => shown(page), { timeout: 30_000 }).toEqual(["132345", "front"]);
  await page.locator('[data-step="1"]').click();
  await expect.poll(() => shown(page), { timeout: 30_000 }).toEqual(["terminal-wagons", "front"]);
  await page.waitForFunction(() => /ebl-container-train\.json$/.test(window.__arail.layoutUrl));
  await page.waitForTimeout(500); // the HUD's refresh (it sets the tour's photos)
  expect(await page.evaluate(() => [window.__arail.tourNav.scope, window.__arail.tourNav.tour.parts.length > 10])).toEqual([null, true]);
  await expect(page.locator("#tour .tour-step").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("the flyover hides the tour and shows the joined orthophoto of the linked parts of the table", async ({ page }) => {
  const errors = await openApp(page, "/app/?photo=132526");
  await tracked(page);
  await expect(page.locator("#tour")).toBeVisible();
  await page.keyboard.press("f");
  await expect(page.locator("#tour")).toBeHidden();
  await page.waitForFunction(() => window.__arail.flyover.ortho?.ok, null, { timeout: 30_000 });
  const ortho = await page.evaluate(() => ({ url: window.__arail.flyover.ortho.url, bounds: window.__arail.world.layout.view.ortho.bounds_mm }));
  expect(ortho.url).toMatch(/ebl-neustadt-linked-ortho\.jpg$/);
  expect(ortho.bounds[2] - ortho.bounds[0]).toBeGreaterThan(14000); // Bf Neustadt and Waldhof south
  await page.keyboard.press("f");
  await expect(page.locator("#tour")).toBeVisible();
  expect(await shown(page)).toEqual(["132526", "front"]);
  expect(errors).toEqual([]);
});

test("?photo= with a photo that is not one of the tour's six of its part shows it, and the arrows go on from its part", async ({ page }) => {
  const errors = await openApp(page, "/app/?photo=132504"); // Bf Neustadt from the front, as the layout's own photo
  await tracked(page);
  expect(await shown(page)).toEqual(["132504", "front"]);
  await page.locator('[data-step="-1"]').click();
  await expect.poll(() => shown(page)).toEqual(["132540", "front"]); // the part before, from the front
  expect(errors).toEqual([]);
});
