// Layers of a layout in the app: the lab example with its layers Rail operations and
// Infrastructure, switched in the View panel and from the Simulate panel, kept per layout, old
// links to the former example files, and new objects in a layer.
import { expect, test } from "@playwright/test";

const LAB = "/app/?layout=../layouts/ebl-lab.json";

function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

async function open(page, path) {
  const errors = trackErrors(page);
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.world?.getObject("station-1"));
  return errors;
}

const on = (page) => page.evaluate(() => window.__arail.layersOn());

test("the View panel switches the layers of the lab example; the choice is kept", async ({ page }) => {
  const errors = await open(page, `${LAB}#view`);
  const ops = page.getByRole("checkbox", { name: /Rail operations/ }), infra = page.getByRole("checkbox", { name: /Infrastructure/ });
  await expect(ops).not.toBeChecked();
  await expect(infra).not.toBeChecked();
  await expect(page.locator("#tab-ops")).toBeHidden();
  await ops.check();
  await page.waitForFunction(() => window.__arail.world.getObject("depot-1"));
  await expect(page.locator("#tab-ops")).toBeVisible();
  await expect(page.locator("#layoutName")).toContainText("Rail operations");
  await expect(page.getByRole("checkbox", { name: /Rail operations/ })).toBeChecked();
  // both at once
  await page.getByRole("checkbox", { name: /Infrastructure/ }).check();
  await page.waitForFunction(() => window.__arail.world.getObject("interlocking-bf"));
  expect(await on(page)).toEqual(["operations", "infrastructure"]);
  await expect(page.locator("#tab-infra")).toBeVisible();
  // kept for this layout, without counting as a change of it
  await page.reload();
  await page.waitForFunction(() => window.__arail?.world?.getObject("depot-1"));
  expect(await on(page)).toEqual(["operations", "infrastructure"]);
  expect(await page.evaluate(() => localStorage.getItem(`arail.layout:${window.__arail.layoutUrl}`))).toBeNull();
  await page.getByRole("checkbox", { name: /Rail operations/ }).uncheck();
  await page.waitForFunction(() => !window.__arail.world.getObject("depot-1"));
  await expect(page.locator("#tab-ops")).toBeHidden();
  expect(errors).toEqual([]);
});

test("Simulate offers to switch on the layer; old links open the lab with that layer", async ({ page }) => {
  const errors = await open(page, `${LAB}#simulate`);
  await page.locator("#opsOpenExample").click();
  await page.waitForFunction(() => window.__arail.operations.sim?.engine, null, { timeout: 60_000 });
  expect(await on(page)).toEqual(["operations"]);
  await page.goto("/app/?layout=../layouts/ebl-infrastructure.json#infra");
  await page.waitForFunction(() => window.__arail?.world?.getObject("interlocking-bf"));
  expect(await page.evaluate(() => window.__arail.layoutUrl)).toMatch(/layouts\/ebl-lab\.json$/);
  expect(await on(page)).toEqual(["infrastructure"]);
  expect(errors).toEqual([]);
});

test("Build: new objects go to the chosen layer and stay with it", async ({ page }) => {
  const errors = await open(page, `${LAB}&layers=operations#build`);
  await page.selectOption("#layoutActiveLayer", "operations");
  const id = await page.evaluate(() => window.__arail.world.addObject({ type: "tree", position: [1800, -600] }).id);
  const json = await page.evaluate(() => window.__arail.world.toJSON());
  expect(json.objects.some((o) => o.id === id)).toBe(false);
  expect(json.layers.find((l) => l.id === "operations").objects.some((o) => o.id === id)).toBe(true);
  await page.evaluate((id) => window.__arail.editor.select(window.__arail.world.getObject(id)), id);
  await expect(page.locator("#panel-build")).toContainText("Layer: Rail operations");
  expect(errors).toEqual([]);
});
