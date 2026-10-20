// Passenger mobility in the app (#165): Settings → View → The room people take (circles on the ground,
// the loads of vehicles in spaces), kept for the next visit; the town's trips from door to door by group
// in Settings → Simulation, with their CSV; both accessible in light and dark mode.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const LAB = "/app/?layout=../layouts/ebl-lab.json";

async function openApp(page, path = LAB) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
  return errors;
}

/** Violations in a part of the page now. */
async function violations(page, include) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).include(include).analyze();
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`);
}

for (const scheme of ["light", "dark"]) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test("Settings → View: the room people take, drawn and kept for the next visit", async ({ page }) => {
      const errors = await openApp(page);
      await page.locator("#tab-settings").click();
      await page.locator("#settingsView-view").click();
      const box = page.getByRole("checkbox", { name: "The room people take" });
      await expect(box).not.toBeChecked();
      await box.check();
      expect(await page.evaluate(() => window.__arail.world.settings.spaceCircles)).toBe(true);
      // people at the stops are drawn with the circle of their room
      await page.waitForFunction(() => {
        const sim = window.__arail.world.simulations.find((s) => s.constructor.type === "passengers");
        return [...sim.crowds.values()].some((c) => c.visible().length > 0);
      }, null, { timeout: 30_000 });
      await page.waitForTimeout(500);
      expect(await violations(page, "#panel-settings")).toEqual([]);
      await page.reload();
      await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
      expect(await page.evaluate(() => window.__arail.world.settings.spaceCircles)).toBe(true);
      await page.locator("#tab-settings").click();
      await page.locator("#settingsView-view").click();
      await expect(page.getByRole("checkbox", { name: "The room people take" })).toBeChecked();
      expect(errors).toEqual([]);
    });

    test("Settings → Simulation: the town's trips from door to door by group, with the CSV", async ({ page }) => {
      const errors = await openApp(page);
      // a morning of the town, quickly
      await page.evaluate(() => {
        const w = window.__arail.world;
        w.setTime("06:30");
        w.speed = 10;
        const town = w.simulations.find((s) => s.constructor.type === "town");
        for (let i = 0; i < 6000 && town.tripStats().length < 2; i++) w.step(0.1);
        w.speed = 1;
      });
      await page.locator("#tab-settings").click();
      await page.locator("#settingsView-simulate").click();
      const table = page.getByRole("table", { name: /Door to door by group/ });
      await expect(table).toBeVisible();
      await expect(table.getByRole("rowheader", { name: "everybody" })).toBeVisible();
      await expect(page.locator("#townTripsCsv")).toBeVisible();
      const download = page.waitForEvent("download");
      await page.locator("#townTripsCsv").click();
      expect((await download).suggestedFilename()).toBe("town-trips.csv");
      expect(await violations(page, "#panel-settings")).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}
