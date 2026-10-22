// The live page (web/live/) with a camera: Chromium's fake one, allowed without asking. Settings →
// Camera shows the camera in use (also the only one), Reload looks for cameras again and starts the
// one chosen; a camera chosen that is not there gives another one and a note.
import { expect, test } from "@playwright/test";

test.use({ permissions: ["camera"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

test("Settings → Camera: the camera in use, also when it is the only one; Reload looks again and starts it", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/live/");
  await page.waitForFunction(() => window.__live?.source?.kind === "camera" && window.__live.video.srcObject);
  await page.locator("#btnSettings").click();
  await expect(page.locator("#deviceRow")).toBeVisible();
  expect(await page.locator("#device option").count()).toBeGreaterThan(0);
  // Reload: a new stream from the camera
  await page.evaluate(() => (window.__firstStream = window.__live.video.srcObject));
  await page.locator("#deviceReload").click();
  await page.waitForFunction(() => window.__live.source?.kind === "camera" && window.__live.video.srcObject && window.__live.video.srcObject !== window.__firstStream);
  await expect(page.locator("#deviceRow")).toBeVisible();
  // the camera chosen is not there: another one runs, and the page says so
  await page.evaluate(() => localStorage.setItem("arail.live.device", JSON.stringify("no-such-camera")));
  await page.locator("#deviceReload").click();
  await expect(page.locator("#message")).toContainText("The camera chosen is not available");
  expect(await page.evaluate(() => window.__live.source.kind)).toBe("camera");
  // the demo has no camera to choose
  await page.locator("#source").selectOption("demo");
  await expect(page.locator("#deviceRow")).toBeHidden();
  expect(errors).toEqual([]);
});
