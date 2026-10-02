// The project page and the marker sheets.
import AxeBuilder from "@axe-core/playwright";
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

test("deck cards for model wagons have the exact spot pitch and validate the input", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/markers/?kind=rolling");
  await expect(page.locator("#status")).toHaveText("6 cards with 18 markers on 1 sheet.");
  await expect(page.locator("#rollingFields")).toBeVisible();
  await expect(page.locator("#ids")).toBeHidden();
  await expect(page.locator("#kind")).toHaveValue("rolling");
  const sheet = page.locator("svg.sheet").first();
  await expect(sheet).toHaveAttribute("width", "210mm");
  const g = await sheet.evaluate((svg) => {
    const num = (el, a) => Number(el.getAttribute(a));
    const card = svg.querySelector('rect[stroke]');
    const tags = [...svg.querySelectorAll('rect[fill="#000"]')].slice(0, 3);
    const label = [...svg.querySelectorAll("text")].find((t) => t.textContent.startsWith("W1 "));
    return {
      card: { x: num(card, "x"), y: num(card, "y"), w: num(card, "width"), h: num(card, "height") },
      tags: tags.map((t) => ({ x: num(t, "x"), y: num(t, "y"), size: num(t, "width") })),
      label: { y: num(label, "y"), text: label.textContent },
    };
  });
  // tags at the 6.1 m spot pitch of an Sgns in H0 (70.1 mm), inside the card; the label below it
  expect(Math.abs(g.tags[0].x - g.tags[1].x - 70.1)).toBeLessThanOrEqual(0.1);
  expect(Math.abs(g.tags[1].x - g.tags[2].x - 70.1)).toBeLessThanOrEqual(0.1);
  expect(g.card.h).toBeCloseTo(28.0, 1);
  for (const t of g.tags) {
    expect(t.size).toBe(20);
    expect(t.x).toBeGreaterThanOrEqual(g.card.x + 2.5 - 0.001);
    expect(t.x + t.size).toBeLessThanOrEqual(g.card.x + g.card.w - 2.5 + 0.001);
  }
  expect(g.label.text).toBe("W1 · Sgns (60 ft) · IDs 0–2");
  expect(g.label.y - 3.4).toBeGreaterThanOrEqual(g.card.y + g.card.h);
  // an 80 ft wagon's card is longer than a portrait sheet is wide
  await page.locator("#wagonType").selectOption("sggrss80");
  await expect(page.locator("#status")).toHaveText("6 cards with 24 markers on 2 sheets.");
  await expect(sheet).toHaveAttribute("width", "297mm");
  await expect.poll(() => page.locator("#pageSize").evaluate((el) => el.textContent)).toContain("size: 297mm 210mm");
  // bad input
  await page.locator("#tagSize").fill("24");
  await expect(page.locator("#status")).toHaveClass(/error/);
  await expect(page.locator("#status")).toHaveText("Tags of 24 mm do not fit on the deck (at most 23 mm)");
  await page.locator("#tagSize").fill("20");
  await page.locator("#wagons").fill("one");
  await expect(page.locator("#status")).toHaveClass(/error/);
  await page.locator("#wagons").fill("146-147");
  await expect(page.locator("#status")).toHaveText("Wagon 147 needs ID 587; AprilTag 36h11 has 587 IDs");
  await page.locator("#wagons").fill("3");
  await expect(page.locator("#status")).toHaveText("1 card with 4 markers on 1 sheet.");
  await expect(page.locator("#status")).not.toHaveClass(/error/);
  // back to the markers for the layout
  await page.locator("#kind").selectOption("markers");
  await expect(page.locator("#status")).toHaveText("8 markers on 1 sheet.");
  await expect(page.locator("#rollingFields")).toBeHidden();
  expect(new URL(page.url()).searchParams.get("kind")).toBeNull();
  expect(errors).toEqual([]);
});

for (const scheme of ["light", "dark"]) {
  test(`deck card settings have no accessibility violations (${scheme} mode)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/markers/?kind=rolling");
    await expect(page.locator("#status")).toHaveText(/cards with/);
    const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
    const summary = async () => (await new AxeBuilder({ page }).withTags(tags).analyze()).violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`);
    expect(await summary()).toEqual([]);
    // with an error message shown
    await page.locator("#tagSize").fill("30");
    await expect(page.locator("#status")).toHaveClass(/error/);
    expect(await summary()).toEqual([]);
  });
}

test("the 404 page links back to the site", async ({ page }) => {
  await page.goto("/404.html");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
  // GitHub Pages serves it for any missing address, so the links are absolute
  await expect(page.getByRole("link", { name: "Open the app" })).toHaveAttribute("href", "/ARail-EBL/app/");
});
