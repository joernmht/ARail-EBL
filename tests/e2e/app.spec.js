// End-to-end tests of the app in a real browser (Chromium).
import { expect, test } from "@playwright/test";

/** Collect uncaught page errors (console noise such as blocked web fonts is ignored). */
function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function openApp(page, path = "/app/") {
  const errors = trackErrors(page);
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
  return errors;
}

/** Screen position (CSS px) of a layout point (mm). */
async function screenPoint(page, x, y) {
  return page.evaluate(([px, py]) => {
    const a = window.__arail, H = a.tracker.state.H;
    const w = H[6] * px + H[7] * py + H[8];
    const u = (H[0] * px + H[1] * py + H[2]) / w, v = (H[3] * px + H[4] * py + H[5]) / w;
    const r = a.canvas.getBoundingClientRect();
    return { x: r.left + (u * r.width) / a.canvas.width, y: r.top + (v * r.height) / a.canvas.height };
  }, [x, y]);
}

test("the lab example is tracked and passengers appear", async ({ page }) => {
  const errors = await openApp(page);
  const state = await page.evaluate(() => window.__arail.tracker.state);
  expect(state.used.length).toBeGreaterThanOrEqual(4);
  await expect(page.locator("#hud")).toContainText("Tracking");
  await page.waitForFunction(() => {
    const sim = window.__arail.world.simulations.find((s) => s.constructor.type === "passengers");
    return [...sim.crowds.values()].reduce((n, c) => n + c.people.length, 0) > 5;
  });
  const types = await page.evaluate(() => window.__arail.world.objects.map((o) => o.type));
  expect(types).toContain("windmill"); // example plugin loaded
  expect(errors).toEqual([]);
});

test("build: place, edit and delete a building", async ({ page }) => {
  const errors = await openApp(page, "/app/#build");
  const before = await page.evaluate(() => window.__arail.world.objects.length);
  await page.getByRole("button", { name: /^Building/ }).click();
  await expect(page.locator("#placing")).toBeVisible();
  const p = await screenPoint(page, 850, 490);
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction((n) => window.__arail.world.objects.length === n + 1, before);
  const added = await page.evaluate(() => window.__arail.editor.selected.spec);
  expect(added.type).toBe("building");
  expect(added.position[0]).toBeCloseTo(850, -1);
  expect(added.position[1]).toBeCloseTo(490, -1);
  expect(added.rotation_deg).toBeCloseTo(1.5, 0); // aligned with the nearest platform
  const floors = page.locator(`#obj-${added.id}-floors`);
  await floors.fill("5");
  await floors.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__arail.editor.selected.spec.floors)).toBe(5);
  await page.getByRole("button", { name: "Delete" }).click();
  await expect.poll(() => page.evaluate(() => window.__arail.world.objects.length)).toBe(before);
  expect(errors).toEqual([]);
});

test("disruptions: start and stop a delay", async ({ page }) => {
  const errors = await openApp(page, "/app/#disrupt");
  await page.selectOption("#disType", "delay");
  await page.selectOption("#disTarget", "platform-1");
  await page.getByRole("button", { name: "Start: Delay" }).click();
  await expect(page.locator(".disruption")).toContainText("Delay · Platform 1");
  await expect(page.locator("#hud")).toContainText("1 disruption");
  await page.locator(".disruption").getByRole("button", { name: "Stop" }).click();
  await expect(page.locator(".disruption")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("control: the simulated control system reports trains", async ({ page }) => {
  const errors = await openApp(page, "/app/#control");
  await page.getByRole("button", { name: "Simulated control system" }).click();
  await page.waitForFunction(() => window.__arail.world.trains.active && window.__arail.world.trains.trains.size > 0);
  await expect(page.locator("#hud")).toContainText("Control system");
  const modes = await page.evaluate(() => [...window.__arail.world.services.docks.values()].filter((s) => s.dock.kind === "rail").map((s) => s.mode));
  expect(new Set(modes)).toEqual(new Set(["feed"]));
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.waitForFunction(() => !window.__arail.world.trains.active);
  expect(errors).toEqual([]);
});

test("the synthetic example is surveyed from scratch", async ({ page }) => {
  const errors = await openApp(page);
  await page.selectOption("#exampleSelect", "../layouts/synthetic-demo.json");
  await expect(page.locator("#layoutName")).toHaveText("Synthetic test layout");
  await page.waitForFunction(() => {
    const a = window.__arail;
    return a.world.layout.name === "Synthetic test layout" && a.tracker.state.H && a.world.map.ids().length >= 6;
  });
  const placed = await page.evaluate(() => window.__arail.world.objects.filter((o) => o.geometry).length);
  expect(placed).toBe(7);
  expect(errors).toEqual([]);
});
