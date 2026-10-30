// The plan documents (web/plan/): a layout or rail-infra data as a plan sheet at a scale, with its
// title block; the paper, the scale and the sheets; the drawing layers; downloads; a file opened.
import { expect, test } from "@playwright/test";

const ready = (page) => page.waitForFunction(() => window.__plan?.result, null, { timeout: 30_000 });

test("Bf Neustadt as a site plan: A3 at 1:100, its signals, the title block filled in", async ({ page }) => {
  await page.goto("/plan/");
  await ready(page);
  const svg = page.locator("#sheet svg");
  await expect(svg).toHaveAttribute("width", "420mm");
  await expect(page.locator("#status")).toContainText(/\d+ tracks, [1-9]\d* elements, 6 platforms/);
  await expect(svg.locator("text", { hasText: /^1:100$/ })).toHaveCount(1);
  await expect(svg.locator("text", { hasText: /^Main signal$/ })).toHaveCount(1);
  await page.locator("#tNumber").fill("EBL-PL-001");
  await expect(svg.locator("text", { hasText: /^EBL-PL-001$/ })).toHaveCount(1);
  // the print page has the paper's size
  expect(await page.locator("#pageSize").textContent()).toContain("420mm 297mm");
});

test("paper and scale: a larger sheet, a larger scale cut into sheets, from sheet to sheet", async ({ page }) => {
  await page.goto("/plan/?paper=A2");
  await ready(page);
  await expect(page.locator("#sheet svg")).toHaveAttribute("width", "594mm");
  await page.locator("#scale").selectOption("20");
  await expect.poll(() => page.evaluate(() => window.__plan.result.sheets)).toBeGreaterThan(1);
  await expect(page.locator("#prev")).toBeDisabled();
  await page.locator("#next").click();
  await expect(page.locator("#sheetNo")).toHaveValue("2");
  await expect(page.locator("#sheet svg text", { hasText: /continued on sheet 1/ })).toHaveCount(1);
});

test("drawing layers switch off; the true size; the downloads", async ({ page }) => {
  await page.goto("/plan/");
  await ready(page);
  await page.getByLabel("Tracks", { exact: true }).uncheck();
  expect(await page.evaluate(() => window.__plan.result.legend)).not.toContain("Track");
  await page.locator("#zoom").click();
  await expect(page.locator("#zoom")).toHaveAttribute("aria-pressed", "true");
  for (const [id, name] of [["#svg", /\.svg$/], ["#dxf", /\.dxf$/], ["#data", /\.rail-infra\.json$/]]) {
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator(id).click()]);
    expect(download.suggestedFilename()).toMatch(name);
  }
});

test("a rail-infra file opened: a schematic track plan in lanes", async ({ page }) => {
  await page.goto("/plan/?lang=de");
  await ready(page);
  await expect(page.locator("h1")).toHaveText("Planunterlagen");
  const doc = {
    format: "rail-infra/1", name: "Track plan", source: { generator: "test" }, frame: { id: "t", unit: "lane" },
    tracks: [{ id: "a", name: "Strecke 11", track: "11", points: [[0, 0], [40, 0]], kms: [20, 21] }],
    elements: [{ id: "s", type: "signal", kind: "main", name: "N1", track: "11", km: 20.5, at: [20, -0.6], heading_deg: 0 }],
  };
  await page.locator("#file").setInputFiles({ name: "plan.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)) });
  await expect(page.locator("#status")).toHaveText("1 Gleise, 1 Elemente, 0 Bahnsteige");
  await expect(page.locator("#sheet svg text", { hasText: /^Schematisch, nicht maßstäblich$/ }).first()).toBeVisible();
  await expect(page.locator("#modules")).toBeHidden();
});
