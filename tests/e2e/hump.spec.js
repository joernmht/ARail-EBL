// The app's example Hump a train (app/cases.js HumpCase, app/hump.js): Start switches Bf Neustadt's module
// Hump yard on and shows the yard in the flyover; the hump master pushes the train slower, faster,
// stops it and pushes on; its cuts are followed into their tracks and chosen in the list or on the
// stage; leaving it switches the module off again; the hump blocked, nothing can be pushed on. The example layout
// Hump yard in Settings → View.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectCase, openList, startExample } from "./ui.js";

function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function open(page, path = "/app/") {
  const errors = trackErrors(page);
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.world?.objects.length, null, { timeout: 30_000 });
  return errors;
}

const state = (page) => page.evaluate(() => {
  const y = window.__arail.world.objects.find((o) => o.type === "hump-yard");
  return y?.taskState() ?? null;
});

test("Hump a train: Start switches the module on, the yard in the flyover; slower, faster, stop, push on; a cut chosen; leaving switches it off", async ({ page }) => {
  const errors = await open(page);
  await openList(page);
  await page.locator("#pill-freight").click();
  expect(await page.locator(".case-card .case-name").allTextContents()).toEqual(["Load the hybrid train", "Hump a train"]);
  await expect(page.locator("#case-hump")).toHaveAccessibleName("Railway undertaking Hump a train");
  await startExample(page, "hump");
  expect(await page.evaluate(() => window.__arail.layersOn())).toContain("hump");
  await expect.poll(() => page.evaluate(() => window.__arail.mode)).toBe("flyover");
  // the task: the train's cuts, all waiting or on the hump; the bar counts the cuts standing
  let st = await state(page);
  expect(st.of).toBeGreaterThan(5);
  await expect(page.locator("#humpCuts > li")).toHaveCount(st.of);
  await expect(page.locator("#caseTask")).toContainText(`of ${st.of}`);
  await expect(page.locator("#humpSpeed")).toHaveText("1.2 m/s");
  // faster, slower, stopped, pushed on
  await page.locator("#humpFaster").click();
  await expect(page.locator("#humpSpeed")).toHaveText("1.4 m/s");
  await page.locator("#humpSlower").click();
  await page.locator("#humpSlower").click();
  await expect(page.locator("#humpSpeed")).toHaveText("1.0 m/s");
  await page.locator("#humpStop").click();
  await expect(page.locator("#humpSpeed")).toHaveText("Stopped");
  await expect(page.locator("#humpStatus")).toHaveText("Stopped before the crest");
  await expect(page.locator("#humpStop")).toBeFocused();
  await expect(page.locator("#humpStop")).toHaveText("Push on");
  expect(await page.evaluate(() => window.__arail.world.objects.find((o) => o.type === "hump-yard").sim.pushing?.v)).toBe(0);
  await page.locator("#humpStop").click();
  await expect(page.locator("#humpSpeed")).toHaveText("1.0 m/s");
  // a cut chosen in the list: pressed, and the yard outlines it
  await page.locator("#hump-cut-1").click();
  await expect(page.locator("#hump-cut-1")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.__arail.world.objects.find((o) => o.type === "hump-yard").chosen)).toMatch(/\/1$/);
  // at full speed the train runs to its end: every cut standing, the figures say how it went
  await page.evaluate(() => (window.__arail.world.speed = 30));
  await expect.poll(async () => (await state(page)).finished, { timeout: 60_000 }).toBe(true);
  st = await state(page);
  await expect(page.locator("#humpStatus")).toContainText("Train broken up");
  await expect(page.locator(".task-done")).toHaveText("Done");
  await expect(page.locator(".task-figures")).toContainText("Wrong track");
  await expect(page.locator(".task-figures")).toContainText(String(st.misrouted));
  // leaving it: the town as it was, without the module; the yard on its own again
  await page.locator("#casesBack").click();
  await expect.poll(() => page.evaluate(() => window.__arail.layersOn())).not.toContain("hump");
  expect(await page.evaluate(() => window.__arail.caseById("hump").completed)).toBe(true);
  expect(errors).toEqual([]);
});

test("a cut chosen on the stage: a tap on its wagon in the flyover", async ({ page }) => {
  const errors = await open(page, "/app/#hump");
  await expectCase(page, "hump");
  await page.locator("#caseStart").click();
  await page.waitForFunction(() => window.__arail.caseById("hump").started);
  await expect.poll(() => page.evaluate(() => window.__arail.mode)).toBe("flyover");
  // the cuts released, the world paused and the train stopped: they stand still to be tapped (stopped as Stop does it:
  // the button is off once every cut is released, which a slow computer may reach before a click)
  await page.evaluate(() => (window.__arail.world.speed = 30));
  await expect.poll(async () => (await state(page)).cuts.filter((c) => c.state === "standing").length, { timeout: 60_000 }).toBeGreaterThan(1);
  await page.evaluate(() => {
    window.__arail.world.paused = true;
    window.__arail.world.objects.find((o) => o.type === "hump-yard").setPush({ stopped: true });
  });
  // a wagon where it is drawn: the centre of its box in canvas pixels, as CSS pixels on the page
  const at = await page.evaluate(() => {
    const app = window.__arail, y = app.world.objects.find((o) => o.type === "hump-yard"), view = app.lastView, c = app.canvas;
    const r = c.getBoundingClientRect();
    for (const b of y.boxes()) {
      const p = view.project(b.center[0], b.center[1], b.z0 + b.height / 2);
      if (p && p[0] > 20 && p[1] > 20 && p[0] < c.width - 20 && p[1] < c.height - 20) return { id: b.id, x: r.left + (p[0] * r.width) / c.width, y: r.top + (p[1] * r.height) / c.height };
    }
    return null;
  });
  expect(at, "a wagon in the picture").not.toBeNull();
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => window.__arail.world.objects.find((o) => o.type === "hump-yard").chosen)).not.toBeNull();
  await expect(page.locator('#humpCuts [aria-pressed="true"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("the hump blocked: nothing can be pushed on, so Slower, Faster and Stop are off", async ({ page }) => {
  const errors = await open(page, "/app/#hump");
  await page.locator("#caseStart").click();
  await page.waitForFunction(() => window.__arail.caseById("hump").started);
  // the first cut derails just beyond the crest (as in a switch thrown under it): held there, the train stops behind it
  await page.evaluate(() => {
    const app = window.__arail, sim = app.world.objects.find((o) => o.type === "hump-yard").sim;
    app.world.paused = true;
    while (!sim.bodies.length) sim.step();
    Object.assign(sim.bodies[0], { v: 0, held: true, derailed: true });
    app.world.speed = 30;
    app.world.paused = false;
  });
  await expect.poll(async () => (await state(page)).finished, { timeout: 60_000 }).toBe(true);
  expect((await state(page)).notHumped).toBeGreaterThan(0);
  await expect(page.locator("#humpStatus")).toContainText("Hump blocked");
  for (const id of ["#humpSlower", "#humpFaster", "#humpStop"]) await expect(page.locator(id)).toBeDisabled();
  await expect(page.locator("#humpRestart")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("the example Hump yard (Settings → View): Bf Neustadt with its module, the example shown; the former #scenarios opens the list of examples", async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => window.__arail.openExample("hump"));
  await expect.poll(() => page.evaluate(() => window.__arail.layersOn().toSorted())).toEqual(["hump", "market-visitors", "sbahn", "waldhof", "wintermarkt"]);
  await expectCase(page, "hump");
  await expect(page.locator("#caseName")).toHaveText("Hump a train");
  await expect(page.locator("#caseStart")).toBeEnabled();
  // old links
  await page.goto("/app/?layout=../layouts/ebl-neustadt.json#scenarios");
  await expect(page.locator("#casesTitle")).toHaveText("Examples");
  expect(errors).toEqual([]);
});

for (const scheme of ["light", "dark"]) {
  test(`Hump a train, started, with a cut chosen and the train stopped, has no accessibility violations (${scheme} mode)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const errors = await open(page, "/app/#hump");
    await page.locator("#caseStart").click();
    await page.waitForFunction(() => window.__arail.caseById("hump").started);
    await page.evaluate(() => (window.__arail.world.speed = 30));
    await expect.poll(async () => (await state(page)).cuts.some((c) => c.misrouted || c.state === "standing"), { timeout: 60_000 }).toBe(true);
    // stopped as Stop does it (the button is off once every cut is released, which a slow computer may reach before a click)
    await page.evaluate(() => {
      window.__arail.world.paused = true;
      window.__arail.world.objects.find((o) => o.type === "hump-yard").setPush({ stopped: true });
    });
    await expect(page.locator("#humpStop")).toHaveText("Push on");
    await page.locator("#hump-cut-2").click();
    await page.evaluate(() => document.querySelector("#panel")?.scrollTo(0, 0));
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`)).toEqual([]);
    expect(errors).toEqual([]);
  });
}
