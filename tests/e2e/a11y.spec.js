// Accessibility checks (axe-core, WCAG 2.2 AA rules) of the published pages, in light and dark mode.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = [
  ["project page", "/"],
  ["marker sheets", "/markers/"],
  ["app, View panel", "/app/#view"],
  ["app, Build panel", "/app/#build"],
  ["app, Simulate panel", "/app/#simulate"],
  ["app, Disruptions panel", "/app/#disrupt"],
  ["app, Control panel", "/app/#control"],
  ["404 page", "/404.html"],
];

for (const scheme of ["light", "dark"]) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });
    for (const [name, path] of PAGES) {
      test(`${name} has no accessibility violations`, async ({ page }) => {
        await page.goto(path);
        if (path.startsWith("/app/")) await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
          .analyze();
        const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`);
        expect(summary).toEqual([]);
      });
    }
  });
}

/** Violations on the page now, labelled with the state they were found in. */
async function violations(page, state, include = null) {
  let axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]);
  if (include) axe = axe.include(include);
  const results = await axe.analyze();
  return results.violations.map((v) => `${state}: ${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`);
}

// The states the new features add: placing (camera view and flyover), the inspector of every new
// object type, a locked marker map with moving markers, the town at night; on a phone screen too.
const STATES = [["light", "desktop", { width: 1440, height: 900 }], ["dark", "desktop", { width: 1440, height: 900 }], ["light", "phone", { width: 390, height: 844 }]];
for (const [scheme, device, viewport] of STATES) {
  test(`app states have no accessibility violations (${scheme} mode, ${device})`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(viewport);
    await page.goto("/app/#build");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/app/#build");
    await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
    const found = [];
    await page.locator(".palette").getByRole("button", { name: /^Street/ }).click();
    await expect(page.locator("#placing")).toBeVisible();
    found.push(...(await violations(page, "placing a street")));
    await page.locator("#btnFlyover").click();
    await page.waitForFunction(() => window.__arail.mode === "flyover");
    found.push(...(await violations(page, "placing in the flyover")));
    await page.keyboard.press("Escape");
    await page.locator("#btnFlyover").click(); // back to the camera view (the flyover draws a lot)
    await page.waitForFunction(() => window.__arail.mode === "camera");
    for (const type of ["plattenbau", "altbau-block", "house-estate", "office", "school", "supermarket", "factory", "road", "bus-stop", "bus-line", "tabletop"]) {
      await page.evaluate((t) => window.__arail.editor.select(window.__arail.world.objects.find((o) => o.type === t)), type);
      await expect(page.locator("#panel-build h2", { hasText: "Selected:" })).toBeVisible();
      found.push(...(await violations(page, `inspector of ${type}`, "#panel-build")));
    }
    await page.evaluate(() => window.__arail.editor.select(null));
    await page.getByRole("button", { name: "Keep positions" }).click();
    await page.locator("#movingMarkers").fill("40, 41");
    await page.locator("#movingMarkers").press("Enter");
    await expect(page.getByRole("button", { name: "Unlock" })).toBeVisible();
    found.push(...(await violations(page, "locked marker map with moving markers")));
    await page.locator("#tab-view").click();
    found.push(...(await violations(page, "View panel, locked map with moving markers")));
    await page.locator("#tab-simulate").click();
    await page.getByRole("button", { name: "Night 22:30" }).click();
    await expect(page.locator("#panel-simulate .town-stats li").first()).toBeVisible();
    found.push(...(await violations(page, "Simulate panel with the town at night")));
    expect(found).toEqual([]);
  });
}
