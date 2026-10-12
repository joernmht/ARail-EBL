// The architecture page (web/architecture/): the package and data-flow diagrams, every model's class
// and activity diagrams drawn without errors and inside their frames, links to a model, the text
// alternatives, a phone without sideways scrolling, and accessibility in light and dark mode.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function open(page, path = "/architecture/") {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(path);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true", null, { timeout: 30_000 });
  return errors;
}

/** Diagrams drawn, failed, and those whose drawing reaches outside their frame. */
const diagramState = (page) => page.evaluate(() => {
  const svgs = [...document.querySelectorAll("svg.uml")];
  const outside = svgs.filter((s) => {
    const b = s.getBBox(), [x, y, w, h] = s.getAttribute("viewBox").split(" ").map(Number);
    return b.x < x - 0.5 || b.y < y - 0.5 || b.x + b.width > x + w + 0.5 || b.y + b.height > y + h + 0.5;
  }).map((s) => s.querySelector("title").textContent);
  return { drawn: svgs.length, figures: document.querySelectorAll(".diagram-figure").length, failed: document.querySelectorAll(".diagram .status").length, outside };
});

test("the packages, the data flow and the notation are drawn; every model's diagrams when it is opened", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await open(page);
  await expect(page.locator("#packages svg.uml")).toHaveCount(2);
  await expect(page.locator("#dataflow svg.uml")).toHaveCount(1);
  await expect(page.locator("#notation svg.uml")).toHaveCount(2);
  // the models are closed: their diagrams are drawn when opened
  const models = page.locator("details.model");
  expect(await models.count()).toBeGreaterThan(30);
  expect(await page.locator("#models svg.uml").count()).toBe(0);
  await page.locator("#openAll").click();
  await expect.poll(async () => (await diagramState(page)).drawn, { timeout: 60_000 }).toBe(await page.locator(".diagram-figure").count());
  const st = await diagramState(page);
  expect(st.failed).toBe(0);
  expect(st.outside).toEqual([]);
  // every activity also as steps in text, every class diagram as a table
  expect(await page.locator("div.activity details.sub ol.steps").count()).toBe(await page.locator("div.activity").count());
  await page.locator("#closeAll").click();
  await expect(page.locator("details.model[open]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a link to a model opens it; the passenger model shows its forces, its settings and its events", async ({ page }) => {
  const errors = await open(page, "/architecture/#model-passengers");
  const model = page.locator("#model-passengers");
  await expect(model).toHaveAttribute("open", "");
  await expect(model.locator("svg.uml")).toHaveCount(3); // classes and two activities
  await expect(model.locator("svg.uml title").first()).toHaveText("Classes: Passengers at the stops");
  await expect(model.locator(".rules")).toContainText("push apart");
  await expect(model.locator("table").filter({ hasText: "base_rate" })).toContainText("0.5");
  await expect(model.locator(".events-table")).toContainText("passenger.boarded");
  // steps as text
  await model.getByText("Steps as text").first().click();
  await expect(model.locator("ol.steps").first()).toContainText("Board: to the nearest door");
  // a diagram at its actual size, and back
  const fig = model.locator(".diagram-figure").first();
  await fig.getByRole("button", { name: "Actual size" }).click();
  await expect(fig.locator(".diagram")).toHaveClass(/full/);
  await fig.getByRole("button", { name: "Fit to width" }).click();
  await expect(fig.locator(".diagram")).not.toHaveClass(/full/);
  expect(errors).toEqual([]);
});

test("the project page links to the architecture page; on a phone it does not scroll sideways", async ({ page }) => {
  await page.goto("/");
  await page.locator("footer").getByRole("link", { name: "Software architecture (UML)" }).click();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true", null, { timeout: 30_000 });
  await expect(page.locator("h1")).toHaveText("How ARail-EBL is built");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#openAll").click();
  await expect.poll(async () => (await diagramState(page)).drawn, { timeout: 60_000 }).toBe(await page.locator(".diagram-figure").count());
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

for (const scheme of ["light", "dark"]) {
  test(`the architecture page with every model open has no accessibility violations (${scheme} mode)`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    await page.locator("#openAll").click();
    await expect.poll(async () => (await diagramState(page)).drawn, { timeout: 60_000 }).toBe(await page.locator(".diagram-figure").count());
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`)).toEqual([]);
  });
}
