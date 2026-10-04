// The simple view: a map (plan view) and a 2.5D view with flat objects and moving things as blocks.
import { expect, test } from "@playwright/test";

async function openApp(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/app/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/app/");
  await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
  return errors;
}

/** Wait until camera moves have ended. */
async function settle(page) {
  await page.waitForFunction(() => !window.__arail.flyover.anim);
}

test("Map and 2.5D: the simple view from above and tilted, and back to the full flyover", async ({ page }) => {
  const errors = await openApp(page);
  await page.locator("#btnMap").click();
  await page.waitForFunction(() => window.__arail.mode === "flyover" && window.__arail.flyover.simple);
  await settle(page);
  await expect(page.locator("#btnMap")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#btnSimple3d")).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => window.__arail.flyover.cam.isPlan)).toBe(true);
  await expect(page.locator("#hud")).toContainText("Map");
  expect(await page.evaluate(() => window.__arail.lastView.simple)).toBe(true);

  await page.locator("#btnSimple3d").click();
  await settle(page);
  await expect(page.locator("#btnSimple3d")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#btnMap")).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => window.__arail.flyover.cam.isPlan)).toBe(false);
  await expect(page.locator("#hud")).toContainText("Simple 2.5D");

  // pressed again: the full flyover
  await page.locator("#btnSimple3d").click();
  await expect(page.locator("#btnSimple3d")).toHaveAttribute("aria-pressed", "false");
  await page.waitForFunction(() => window.__arail.lastView && !window.__arail.lastView.simple);
  expect(await page.evaluate(() => window.__arail.mode)).toBe("flyover");

  // keys: S the 2.5D view, Shift+S the map
  await page.locator("#stage").focus();
  await page.keyboard.press("s");
  await page.waitForFunction(() => window.__arail.flyover.simple);
  await page.keyboard.press("Shift+S");
  await settle(page);
  expect(await page.evaluate(() => window.__arail.flyover.cam.isPlan)).toBe(true);
  expect(errors).toEqual([]);
});

test("Build works in the map: tapping an object selects it", async ({ page }) => {
  const errors = await openApp(page);
  await page.locator("#btnMap").click();
  await settle(page);
  await page.locator("#tab-build").click();
  const target = await page.evaluate(() => {
    const a = window.__arail;
    a.render();
    const o = a.world.objects.find((x) => x.constructor.category === "Buildings" && x.geometry);
    const p = o.anchorPoint(), H = a.pose().H;
    const w = H[6] * p[0] + H[7] * p[1] + H[8];
    const u = (H[0] * p[0] + H[1] * p[1] + H[2]) / w, v = (H[3] * p[0] + H[4] * p[1] + H[5]) / w;
    const r = a.canvas.getBoundingClientRect();
    return { id: o.id, x: r.left + (u * r.width) / a.canvas.width, y: r.top + (v * r.height) / a.canvas.height };
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction((id) => window.__arail.editor.selected?.id === id, target.id);
  expect(errors).toEqual([]);
});
