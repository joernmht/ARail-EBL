// The simple view: a map (plan view) and a 2.5D view with flat objects and moving things as blocks.
import { expect, test } from "@playwright/test";
import { openCase, viewTo } from "./ui.js";

async function openApp(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/app/?layout=../layouts/ebl-lab.json");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/app/?layout=../layouts/ebl-lab.json");
  await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
  return errors;
}

/** Wait until camera moves have ended. */
async function settle(page) {
  await page.waitForFunction(() => !window.__arail.flyover.anim);
}

test("one view button: the photo, the flyover, the map and 2.5D in turn, then the photo again", async ({ page }) => {
  const errors = await openApp(page);
  const view = page.locator("#btnView");
  // the camera view: named after its source, the title says where a click goes
  await expect(view).toHaveText("Photo");
  await expect(view).toHaveAccessibleName("View: Photo");
  await expect(view).toHaveAttribute("title", "Next view: Flyover (F)");
  await expect(page.locator(".stage-tools button:visible")).toHaveCount(2); // the view and full screen (Freeze only for a video)
  // the full flyover
  await view.click();
  await page.waitForFunction(() => window.__arail.mode === "flyover" && !window.__arail.flyover.simple);
  await expect(view).toHaveText("Flyover");
  await expect(view).toHaveAttribute("title", "Next view: Map (Shift+S)");
  // the map: the simple view from above
  await view.click();
  await page.waitForFunction(() => window.__arail.flyover.simple);
  await settle(page);
  await expect(view).toHaveText("Map");
  expect(await page.evaluate(() => window.__arail.flyover.cam.isPlan)).toBe(true);
  expect(await page.evaluate(() => window.__arail.lastView.simple)).toBe(true);
  // 2.5D: tilted
  await view.click();
  await settle(page);
  await expect(view).toHaveText("2.5D");
  await expect(view).toHaveAttribute("title", "Next view: Photo (F)");
  expect(await page.evaluate(() => window.__arail.flyover.cam.isPlan)).toBe(false);
  // the photo again, and from there the full flyover (not the simple view)
  await view.click();
  await page.waitForFunction(() => window.__arail.mode === "camera");
  await expect(view).toHaveText("Photo");
  await view.click();
  await page.waitForFunction(() => window.__arail.lastView && !window.__arail.lastView.simple && window.__arail.mode === "flyover");

  // keys: S the 2.5D view, Shift+S the map
  await page.locator("#stage").focus();
  await page.keyboard.press("s");
  await page.waitForFunction(() => window.__arail.flyover.simple);
  await page.keyboard.press("Shift+S");
  await settle(page);
  expect(await page.evaluate(() => window.__arail.flyover.cam.isPlan)).toBe(true);
  expect(errors).toEqual([]);
});

test("the view button's title names a key only where it leads: after Shift+S and F, F opens the map, so no key for the flyover", async ({ page }) => {
  const errors = await openApp(page);
  const view = page.locator("#btnView");
  await page.locator("#stage").focus();
  await page.keyboard.press("Shift+S"); // the map
  await page.waitForFunction(() => window.__arail.flyover.simple && window.__arail.mode === "flyover");
  await page.keyboard.press("f"); // back to the photo: the simple view stays chosen for F
  await page.waitForFunction(() => window.__arail.mode === "camera");
  await expect(view).toHaveText("Photo");
  await expect(view).toHaveAttribute("title", "Next view: Flyover");
  // the button goes to the full flyover, and from there its title names keys again
  await view.click();
  await page.waitForFunction(() => window.__arail.mode === "flyover" && !window.__arail.flyover.simple);
  await expect(view).toHaveAttribute("title", "Next view: Map (Shift+S)");
  await view.click();
  await view.click();
  await view.click(); // the photo again, the simple view left by the button
  await expect(view).toHaveAttribute("title", "Next view: Flyover (F)");
  expect(errors).toEqual([]);
});

test("Build works in the map: tapping an object selects it", async ({ page }) => {
  const errors = await openApp(page);
  await viewTo(page, "map");
  await settle(page);
  await openCase(page, "build");
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
