// The photo tour of the app (web/app/tour-nav.js): the lab's photos as a Street View. The arrows go
// to the next part in the same perspective, the buttons in the upper left corner choose it; a photo
// with a digital layer opens with its layout and is tracked, the others are shown as photos only.
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

test("the arrows go round the lab in the same perspective; with a digital layer the photo is tracked, without it is the photo only", async ({ page }) => {
  const errors = await openApp(page, "/app/?photo=132526");
  // Bf Neustadt, its platforms from the front: tracked, no chip on the stage, the address keeps the photo
  await tracked(page);
  expect(await shown(page)).toEqual(["132526", "front"]);
  await expect(page.locator("#hud")).toBeEmpty();
  await expect(page.locator('[data-view="front"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-view="back"]')).toHaveClass(/missing/); // no photo from straight behind here
  await expect(page.locator('[data-view="back"]')).toHaveAccessibleDescription(/nearest one is shown/);
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
  // from the front left: a photo without a digital layer: the photo only, not tracked
  await page.getByRole("button", { name: "From the front left" }).click();
  await expect.poll(() => shown(page)).toEqual(["132434", "front-left"]);
  await expect(page.locator("#hud")).toContainText("Photo only: no digital layer for this part yet");
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => ({ H: !!window.__arail.tracker.state.H, untracked: window.__arail.source.untracked, layout: window.__arail.world.layout.name })))
    .toEqual({ H: false, untracked: true, layout: "EBL Bf Neustadt and terminal (example)" });
  // from the back left; → from the back goes the other way round: back to Bf Neustadt, tracked again
  await page.getByRole("button", { name: "From the back left" }).click();
  await expect.poll(() => shown(page)).toEqual(["132826", "back-left"]);
  await page.locator('[data-step="1"]').click();
  await expect.poll(() => shown(page)).toEqual(["132809", "back-left"]);
  await tracked(page);
  await expect(page.locator("#hud")).not.toContainText("Photo only");
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
  // the tour goes on from the part of Bf Neustadt with the platforms
  await page.locator('[data-view="front"]').click();
  await expect.poll(() => shown(page)).toEqual(["132526", "front"]);
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
