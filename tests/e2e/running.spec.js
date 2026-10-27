// The running dynamics of a train in the app (#84–#87): tap a train and its card has the sections Run,
// Braking and train protection, Adhesion and forces, Energy and driving style, which fold, with charts;
// while the card is open the track ahead of the train is drawn on the table; slippery rails on its
// track show on the card; accessible in light and dark mode.
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

/** RE 1 called to track G3 of platform 1, and its card opened. */
async function openRE1(page) {
  await page.evaluate(async () => {
    window.__ARail = await import("/arail/index.js");
    window.__arail.world.services.call("platform-1:right", { line: "RE 1" });
  });
  // standing at the platform: its card opened
  await page.waitForFunction(() => {
    const app = window.__arail;
    const hit = window.__ARail.movingPickables(app.world, app.lastView).find((p) => p.kind === "train" && p.ref.line === "RE 1" && p.ref.dock?.track === "G3" && p.ref.phase === "dwelling");
    if (hit) app.inspector.show(hit);
    return !!hit;
  }, null, { timeout: 30_000 });
  return page.locator("#infoCard");
}

for (const scheme of ["light", "dark"]) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test("a train's card: its run with charts, the sections that fold, the track ahead on the table", async ({ page }) => {
      const errors = await openApp(page);
      const card = await openRE1(page);
      // the run is open: its distance, running times and two charts
      const run = card.locator("details.info-section", { has: page.locator("summary", { hasText: "Run" }) });
      await expect(run).toHaveAttribute("open", "");
      await expect(run).toContainText("Minimum running time");
      await expect(run).toContainText(/From its stop to the next one · 4\.0 km/);
      await expect(run.locator("svg.info-chart-plot")).toHaveCount(2);
      await expect(run.getByRole("img", { name: /Speed over distance/ })).toBeVisible();
      // braking and train protection is folded; opening it shows the Minden distance and the PZB chart, and it stays open
      const braking = card.locator("details.info-section", { has: page.locator("summary", { hasText: "Braking and train protection" }) });
      await expect(braking).not.toHaveAttribute("open", "");
      await braking.locator("summary").click();
      await expect(braking).toContainText(/\d+ m · Minden formula/);
      await expect(braking).toContainText("PZB 90");
      await expect(braking.getByRole("img", { name: /PZB from the distant signal/ })).toBeVisible();
      await page.waitForTimeout(800); // the card is drawn anew: the section stays open
      await expect(braking).toHaveAttribute("open", "");
      // energy and coasting
      const energy = card.locator("details.info-section", { has: page.locator("summary", { hasText: "Energy and driving style" }) });
      await energy.locator("summary").click();
      await expect(energy).toContainText("kWh from the contact line");
      await expect(energy).toContainText(/Coasting within 5 % supplement · \d+:\d\d min/);
      // the couplings on the strip of its vehicles
      await expect(card.locator(".consist-strip li.pull-low").first()).toBeVisible();
      // the track ahead is drawn while the card is open
      expect(await page.evaluate(() => !!window.__arail.world.trackAhead?.result?.profile)).toBe(true);
      expect(await violations(page, "#infoCard")).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(card).toBeHidden();
      expect(await page.evaluate(() => window.__arail.world.trackAhead)).toBe(null);
      expect(errors).toEqual([]);
    });
  });
}

test("slippery rails on its track: the card shows the rails and a longer braking distance", async ({ page }) => {
  const errors = await openApp(page);
  const card = await openRE1(page);
  const forces = card.locator("details.info-section", { has: page.locator("summary", { hasText: "Adhesion and forces" }) });
  await forces.locator("summary").click();
  await expect(forces).toContainText("Dry · adhesion 0.33 at a standstill");
  const dry = await page.evaluate(() => window.__arail.world.trackAhead.result.braking.distance_m);
  await page.evaluate(() => window.__arail.world.disruptions.start({ type: "low-adhesion", target: "platform-1:right", params: { condition: "leaves" } }));
  await expect(forces).toContainText("Leaves on the rails · adhesion 0.05 at a standstill", { timeout: 5000 });
  await expect(forces).toContainText("Load limit with sand");
  await page.waitForFunction((d) => window.__arail.world.trackAhead.result.braking.distance_m > 1.5 * d, dry);
  expect(errors).toEqual([]);
});
