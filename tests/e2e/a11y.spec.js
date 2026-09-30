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
