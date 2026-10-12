// The photo map (web/lab-map/): the survey photos on a map of the lab, each opening as the photo or,
// where a layout covers that part of the table, in the app with its digital layer.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

test("every photo is a dot, and a dot opens the photo", async ({ page }) => {
  await page.goto("/lab-map/");
  const data = await (await page.request.get("/lab-map/data.json")).json();
  await expect(page.locator(".shot")).toHaveCount(data.photos.length);
  const plain = data.photos.findIndex((p) => !p.layer);
  await page.locator(".shot").nth(plain).dispatchEvent("click");
  await expect(page.locator("#viewer")).toBeVisible();
  await expect(page.locator("#viewerImg")).toHaveAttribute("src", data.photos[plain].image);
  await expect(page.locator("#viewerLayer")).toBeHidden();
  await expect(page.locator("#viewerNoLayer")).toBeVisible();
  await page.locator("#viewerClose").click();
  await expect(page.locator("#viewer")).toBeHidden();
});

test("a photo with a layer opens in the app, which tracks it", async ({ page }) => {
  await page.goto("/lab-map/");
  await page.locator(".shot.layer").first().focus();
  await page.keyboard.press("Enter");
  const link = page.locator("#viewerLayer");
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", /^\.\.\/app\/\?layout=.+&image=.+lab-map%2Fphotos%2F/);
  await link.click();
  await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
});

test("?photo= opens that photo; the lists below the map open photos too", async ({ page }) => {
  const data = await (await page.request.get("/lab-map/data.json")).json();
  const p = data.photos[3];
  await page.goto(`/lab-map/?photo=${p.id}`);
  await expect(page.locator("#viewerTitle")).toContainText(p.time);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#viewerTitle")).toContainText(data.photos[4].time);
  await page.keyboard.press("Escape");
  await page.locator("#lists summary").first().click();
  await page.locator("#lists button").first().click();
  await expect(page.locator("#viewer")).toBeVisible();
});

for (const scheme of ["light", "dark"]) {
  test(`photo map with the viewer open has no accessibility violations (${scheme} mode)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/lab-map/?photo=" + (await (await page.request.get("/lab-map/data.json")).json()).photos.find((p) => p.layer).id);
    await expect(page.locator("#viewer")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
}
