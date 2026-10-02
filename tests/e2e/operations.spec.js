// Rail operations in the app: the Operations tab of the example (the day, the fleet, the workshop,
// the crews, the penalties, a comparison of setups), its trains at the platforms, adding rail
// operations to a layout from the Simulate panel, the tabs on a phone and with the keyboard.
import { expect, test } from "@playwright/test";

const EXAMPLE = "/app/?layout=../layouts/ebl-operations.json#ops";

/** Collect uncaught page errors and console errors (blocked web fonts and other resources are ignored). */
function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

/** Open the example with nothing stored; its engine has run up to the clock's time. */
async function openOperations(page, path = EXAMPLE) {
  const errors = trackErrors(page);
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.operations.sim?.engine, null, { timeout: 60_000 });
  return errors;
}

test("the Operations tab shows the day, the fleet, the workshop, the crews and the penalties", async ({ page }) => {
  const errors = await openOperations(page);
  await expect(page.locator("#tab-ops")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#tab-terminal")).toBeHidden(); // the layout has rail operations and no terminal
  await expect(page.locator("#panel-ops h2").first()).toHaveText("EBL regional network");
  // Today: key figures and short-term changes
  await page.locator("#opsView-today").click();
  await expect(page.locator(".ops-tiles .tile")).toHaveCount(6);
  await expect(page.locator(".ops-tiles .tile", { hasText: "Units available" })).toBeVisible();
  const before = await page.evaluate(() => window.__arail.operations.sim.engine.logs.length);
  await page.locator("#opsSick").click();
  await expect(page.locator("#toast")).toBeVisible();
  await page.locator("#opsBreak").click();
  await expect.poll(() => page.evaluate(() => window.__arail.operations.sim.engine.logs.length)).toBeGreaterThan(before);
  await expect(page.locator(".ops-log li").first()).toBeVisible();
  // Fleet: a row per unit
  await page.locator("#opsView-fleet").click();
  const units = await page.evaluate(() => window.__arail.operations.sim.engine.units.size);
  await expect(page.locator("#panel-ops .ops-table tbody tr")).toHaveCount(units);
  // Workshop: the four functions of the ECM and the tracks
  await page.locator("#opsView-workshop").click();
  await expect(page.locator("#panel-ops .ops-table").first().locator("tbody tr")).toHaveCount(4);
  await expect(page.locator("#panel-ops .kv dt", { hasText: "Track 1" })).toBeVisible();
  // Crews: today's duties, and a driver calls in sick from the panel
  await page.locator("#opsView-crews").click();
  const duties = await page.evaluate(() => { const e = window.__arail.operations.sim.engine; return e.days.get(e.today).duties.length; });
  await expect(page.locator("#panel-ops .ops-table tbody tr")).toHaveCount(duties);
  if (await page.locator("#opsPerson").count()) {
    await page.getByRole("button", { name: "Calls in sick" }).click();
    await expect(page.locator("#toast")).toContainText(/called in sick|Nobody/);
  }
  // Penalties: the contracts of the layout and the net per party
  await page.locator("#opsView-money").click();
  const contracts = await page.evaluate(() => window.__arail.operations.sim.engine.model.contracts.length);
  await expect(page.locator("#panel-ops .ops-table").first().locator("tbody tr")).toHaveCount(contracts);
  await expect(page.locator("#panel-ops .ops-net tbody tr")).toHaveCount(4);
  // the view is kept
  await page.reload();
  await page.waitForFunction(() => window.__arail?.operations.sim?.engine, null, { timeout: 60_000 });
  await expect(page.locator("#opsView-money")).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("its trains stand at the platforms with their units and driver; the boards show its departures", async ({ page }) => {
  const errors = await openOperations(page);
  const modes = await page.evaluate(() => [...window.__arail.world.services.docks.values()].filter((s) => s.dock.kind === "rail").map((s) => s.mode));
  expect(modes.length).toBeGreaterThan(0);
  expect(new Set(modes)).toEqual(new Set(["plan"]));
  await page.evaluate(() => (window.__arail.world.speed = 4));
  await page.waitForFunction(() => window.__arail.operations.sim.visits.size > 0, null, { timeout: 60_000 });
  const label = await page.evaluate(() => {
    const visit = [...window.__arail.operations.sim.visits.values()][0];
    return { label: visit.vehicle.line, info: visit.vehicle.info };
  });
  expect(label.label).toMatch(/^(RE|RB|S) \d/);
  expect(label.info.join(" ")).toMatch(/442 \d{3}/);
  await page.locator("#tab-simulate").click();
  await expect(page.locator("#panel-simulate .board")).toContainText(/(RE|RB|S) \d+ → \w+ \d\d:\d\d/);
  // trains cannot be called to the platforms of the operations
  const calls = await page.locator("#panel-simulate .board .calls .btn", { hasText: "Train →" }).evaluateAll((b) => b.map((x) => x.disabled));
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every(Boolean)).toBe(true);
  expect(errors).toEqual([]);
});

test("a comparison of setups runs in the page and gives a table, the cancelled trains per day and a CSV", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openOperations(page);
  await page.locator("#opsView-compare").click();
  // two setups, a week, one run each
  const boxes = page.locator(".ops-choices input[type=checkbox]");
  const n = await boxes.count();
  expect(n).toBeGreaterThanOrEqual(3);
  for (let i = 2; i < n; i++) await boxes.nth(i).uncheck();
  await page.locator("#opsStress").selectOption("flu");
  await page.locator("#opsDays").selectOption("7");
  await page.locator("#opsSeeds").selectOption("1");
  await page.locator("#opsRun").click();
  await expect(page.locator(".ops-results")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("#opsRun")).toBeEnabled();
  await expect(page.locator(".ops-compare thead th")).toHaveCount(3);
  await expect(page.locator(".ops-compare tbody tr", { hasText: "Trains cancelled" })).toBeVisible();
  await expect(page.locator(".ops-sparks .spark-row")).toHaveCount(2);
  await expect(page.locator(".ops-results")).toContainText("Flu wave");
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#opsCsv").click()]);
  expect(download.suggestedFilename()).toBe("operations-comparison.csv");
  // a wider panel on large screens
  const narrow = (await page.locator("#panel").boundingBox()).width;
  await page.locator("#opsWide").click();
  await expect.poll(async () => (await page.locator("#panel").boundingBox()).width).toBeGreaterThan(narrow + 200);
  await page.locator("#tab-view").click();
  await expect.poll(async () => (await page.locator("#panel").boundingBox()).width).toBeLessThan(narrow + 2);
  expect(errors).toEqual([]);
});

test("the Simulate panel adds rail operations to a layout; the Operations tab takes the Terminal tab's place", async ({ page }) => {
  const errors = trackErrors(page);
  const path = "/app/?layout=../layouts/ebl-lab.json#simulate";
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.world.objects.length, null, { timeout: 30_000 });
  await expect(page.locator("#tab-ops")).toBeHidden();
  await expect(page.locator("#tab-terminal")).toBeVisible();
  await page.locator("#opsAdd").click();
  await expect(page.locator("#tab-ops")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#tab-terminal")).toBeHidden();
  await page.waitForFunction(() => window.__arail.operations.sim?.engine, null, { timeout: 60_000 });
  await expect(page.locator(".ops-tiles .tile")).toHaveCount(6);
  // kept in this browser
  await page.reload();
  await page.waitForFunction(() => window.__arail?.operations.sim, null, { timeout: 60_000 });
  // back to the example list: a layout without operations gives the Terminal tab back
  await page.evaluate(() => window.__arail.openExample("terminal"));
  await page.waitForFunction(() => window.__arail.terminal.sim, null, { timeout: 30_000 });
  await expect(page.locator("#tab-terminal")).toBeVisible();
  await expect(page.locator("#tab-ops")).toBeHidden();
  await expect(page.locator("#tab-terminal")).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
});

test("on a phone the six tabs fit; the arrow keys go from Simulate to Operations to Disruptions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openOperations(page, "/app/?layout=../layouts/ebl-operations.json#simulate");
  const fits = () => page.evaluate(() => [...document.querySelectorAll(".tabs button")].filter((x) => !x.hidden).every((x) => {
    const r = x.getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth + 0.5;
  }));
  for (const tab of ["view", "build", "simulate", "ops", "disrupt", "control"]) {
    await page.locator(`#tab-${tab}`).click();
    expect(await fits(), `#tab-${tab} at 390 px`).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator("#tab-simulate").click();
  await page.locator("#tab-simulate").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#tab-ops")).toBeFocused();
  await expect(page.locator("#panel-ops")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#tab-disrupt")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#tab-ops")).toBeFocused();
  expect(errors).toEqual([]);
});

test("the disruptions of the operations are offered without a place, and act on the operations", async ({ page }) => {
  const errors = await openOperations(page, "/app/?layout=../layouts/ebl-operations.json#disrupt");
  const types = await page.locator("#disType option").allTextContents();
  expect(types).toEqual(expect.arrayContaining(["Drivers call in sick", "Unit failure", "Drivers leave", "Workshop closed", "Units damaged"]));
  // they have no place to choose
  await page.locator("#disType").selectOption({ label: "Drivers call in sick" });
  await expect(page.locator("#disTarget")).toHaveCount(0);
  await page.getByRole("button", { name: "Start: Drivers call in sick" }).click();
  await expect(page.locator("#toast")).toContainText("Drivers call in sick:");
  expect(await page.evaluate(() => window.__arail.world.disruptions.active.map((d) => d.target))).toEqual(["*"]);
  await expect(page.locator("#panel-disrupt .scenario", { hasText: "Drivers missing in the morning" })).toBeVisible();
  // the other layouts do not offer them
  await page.evaluate(() => window.__arail.openExample("terminal"));
  await page.waitForFunction(() => window.__arail.terminal.sim, null, { timeout: 30_000 });
  await page.locator("#tab-disrupt").click();
  const others = await page.locator("#disType option").allTextContents();
  expect(others).not.toContain("Drivers call in sick");
  expect(errors).toEqual([]);
});
