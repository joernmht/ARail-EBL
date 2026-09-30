// The project page and the marker sheets.
import { expect, test } from "@playwright/test";

test("project page links to the app and the compare slider works", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page).toHaveTitle("ARail-EBL");
  await expect(page.getByRole("link", { name: "Open the app" })).toHaveAttribute("href", "app/");
  await page.locator("#compareRange").fill("20");
  await expect.poll(() => page.locator("#compare").evaluate((el) => el.style.getPropertyValue("--pos"))).toBe("20%");
  const images = await page.locator("#compare img").evaluateAll((imgs) => imgs.map((i) => i.naturalWidth));
  expect(images).toEqual([1600, 1600]);
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(width[0]).toBe(width[1]); // no horizontal scrolling
  expect(errors).toEqual([]);
});

test("marker sheets have the exact paper size and validate the input", async ({ page }) => {
  await page.goto("/markers/");
  await expect(page.locator("#status")).toHaveText("8 markers on 1 sheet.");
  const sheet = page.locator("svg.sheet").first();
  await expect(sheet).toHaveAttribute("width", "210mm");
  await expect(sheet).toHaveAttribute("height", "297mm");
  // printed on the chosen paper
  await expect.poll(() => page.locator("#pageSize").evaluate((el) => el.textContent)).toContain("size: 210mm 297mm");
  // the ID label lies below the white border, which must stay empty for detection
  const g = await sheet.evaluate((svg) => {
    const square = svg.querySelector('rect[fill="#000"]');
    return { bottom: Number(square.getAttribute("y")) + Number(square.getAttribute("height")), label: Number(svg.querySelector("text").getAttribute("y")) };
  });
  expect(g.label - 3.4).toBeGreaterThanOrEqual(g.bottom + 6);
  await page.locator("#ids").fill("0-59");
  await expect(page.locator("#status")).toHaveText(/60 markers on \d+ sheets\./);
  await page.locator("#ids").fill("seven");
  await expect(page.locator("#status")).toHaveClass(/error/);
});

test("the 404 page links back to the site", async ({ page }) => {
  await page.goto("/404.html");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
  // GitHub Pages serves it for any missing address, so the links are absolute
  await expect(page.getByRole("link", { name: "Open the app" })).toHaveAttribute("href", "/ARail-EBL/app/");
});
