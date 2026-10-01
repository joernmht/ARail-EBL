// The app wears the corporate design of the Chair of Railway Operations (Türkis, chair logo,
// Noto Sans); the project website keeps its own blue design. The states that use the CD accent
// colours (pressed toggles, placing, toasts, disruptions) are checked for contrast in both modes.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function openApp(page, path = "/app/") {
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
}

const style = (page, selector, property) => page.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], property);

/** Colour-contrast violations of the elements matching `selectors`. */
async function contrastViolations(page, selectors) {
  let axe = new AxeBuilder({ page }).withRules(["color-contrast"]);
  for (const s of selectors) axe = axe.include(s);
  const results = await axe.analyze();
  expect(results.passes.flatMap((v) => v.nodes).length, "text elements checked").toBeGreaterThan(3);
  return results.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary}`));
}

const MODES = { light: { bar: "rgb(10, 119, 127)", accent: "rgb(10, 119, 127)" }, dark: { bar: "rgb(0, 20, 80)", accent: "rgb(54, 184, 191)" } };

for (const [scheme, expected] of Object.entries(MODES)) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test("the app shows the chair logo on a Türkis (light) or Dunkelblau (dark) bar, in Noto Sans", async ({ page }) => {
      await openApp(page);
      expect(await style(page, "#bar", "backgroundColor")).toBe(expected.bar);
      const logo = page.getByRole("img", { name: "TU Dresden, Chair of Railway Operations" });
      await expect(logo).toBeVisible();
      expect(await logo.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
      const box = await logo.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(30);
      expect(await style(page, "body", "fontFamily")).toMatch(/^"Noto Sans"/);
      expect(await style(page, "#tab-view", "borderBottomColor")).toBe(expected.accent); // selected tab
      expect(await page.locator('meta[name="theme-color"]').count()).toBe(2);
    });

    test("the project website stays blue", async ({ page }) => {
      await page.goto("/");
      const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
      expect(accent).toBe(scheme === "light" ? "#1d4f9c" : "#2f5fae");
    });

    test("CD accent states keep text readable: placing, pressed toggles, toasts, disruptions", async ({ page }) => {
      await openApp(page, "/app/#build");
      await page.getByRole("button", { name: /^Building/ }).click();
      await expect(page.locator("#placing")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Building/ })).toHaveAttribute("aria-pressed", "true");
      expect(await style(page, "#placing", "borderLeftColor")).toBe(scheme === "light" ? "rgb(200, 80, 0)" : "rgb(240, 146, 46)"); // Orange
      expect(await contrastViolations(page, [".palette", "#placing"])).toEqual([]);
      await page.keyboard.press("Escape");

      await page.locator("#tab-simulate").click();
      await page.getByRole("button", { name: "Pause" }).click();
      await expect(page.getByRole("button", { name: "Resume" })).toHaveAttribute("aria-pressed", "true");
      expect(await style(page, "#panel-simulate .btn[aria-pressed='true']", "backgroundColor")).toBe(scheme === "light" ? "rgb(200, 80, 0)" : "rgb(240, 146, 46)");
      expect(await contrastViolations(page, ["#panel-simulate", "#hud"])).toEqual([]);

      await page.locator("#tab-disrupt").click();
      await page.selectOption("#disType", "delay");
      await page.selectOption("#disTarget", "platform-1");
      await page.getByRole("button", { name: "Start: Delay" }).click();
      await expect(page.locator(".disruption")).toBeVisible();
      await expect(page.locator("#toast")).toBeVisible();
      expect(await contrastViolations(page, ["#panel-disrupt", "#toast"])).toEqual([]);
    });
  });
}
