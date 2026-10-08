// Accessibility checks (axe-core, WCAG 2.2 AA rules) of the published pages, in light and dark mode.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = [
  ["project page", "/"],
  ["marker sheets", "/markers/"],
  ["app, View panel", "/app/#view"],
  ["app, Build panel", "/app/#build"],
  ["app, Settings: simulation", "/app/#simulate"],
  ["app, Disruptions panel", "/app/#disrupt"],
  ["app, Settings: control system", "/app/#control"],
  ["app, Terminal panel", "/app/?layout=../layouts/container-terminal.json#terminal"],
  ["marker sheets, deck cards", "/markers/?kind=rolling"],
  ["404 page", "/404.html"],
];

for (const scheme of ["light", "dark"]) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });
    for (const [name, path] of PAGES) {
      test(`${name} has no accessibility violations`, async ({ page }) => {
        await page.goto(path);
        // the app: tracking the layout's photo, or the flyover of a virtual layout (the container terminal)
        if (path.startsWith("/app/")) await page.waitForFunction(() => window.__arail?.tracker.state.H || (window.__arail?.mode === "flyover" && window.__arail.world.objects.length), null, { timeout: 30_000 });
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
          .analyze();
        const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`);
        expect(summary).toEqual([]);
      });
    }
  });
}

/** Settings → Simulation (the tab remembers its last view). */
async function openSimulation(page) {
  await page.locator("#tab-settings").click();
  await page.locator("#settingsView-simulate").click();
  await expect(page.locator("#settingsView-simulate")).toHaveAttribute("aria-pressed", "true");
}

/** Violations on the page now, labelled with the state they were found in. */
async function violations(page, state, include = null) {
  let axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]);
  if (include) axe = axe.include(include);
  const results = await axe.analyze();
  return results.violations.map((v) => `${state}: ${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`);
}

// The states the new features add: placing (camera view and flyover), the inspector of every new
// object type, a locked marker map with moving markers, the town at night; on a phone screen too.
const STATES = [["light", "desktop", { width: 1440, height: 900 }], ["dark", "desktop", { width: 1440, height: 900 }], ["light", "phone", { width: 390, height: 844 }]];
for (const [scheme, device, viewport] of STATES) {
  test(`app states have no accessibility violations (${scheme} mode, ${device})`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(viewport);
    await page.goto("/app/#build");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/app/#build");
    await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
    const found = [];
    await page.locator(".palette").getByRole("button", { name: /^Street/ }).click();
    await expect(page.locator("#placing")).toBeVisible();
    found.push(...(await violations(page, "placing a street")));
    await page.locator("#btnFlyover").click();
    await page.waitForFunction(() => window.__arail.mode === "flyover");
    found.push(...(await violations(page, "placing in the flyover")));
    await page.keyboard.press("Escape");
    await page.locator("#btnFlyover").click(); // back to the camera view (the flyover draws a lot)
    await page.waitForFunction(() => window.__arail.mode === "camera");
    for (const type of ["plattenbau", "altbau-block", "house-estate", "office", "school", "supermarket", "factory", "road", "bus-stop", "bus-line", "tabletop"]) {
      await page.evaluate((t) => window.__arail.editor.select(window.__arail.world.objects.find((o) => o.type === t)), type);
      await expect(page.locator("#panel-build h2", { hasText: "Selected:" })).toBeVisible();
      found.push(...(await violations(page, `inspector of ${type}`, "#panel-build")));
    }
    await page.evaluate(() => window.__arail.editor.select(null));
    await page.getByRole("button", { name: "Keep positions" }).click();
    await page.locator("#movingMarkers").fill("40, 41");
    await page.locator("#movingMarkers").press("Enter");
    await expect(page.getByRole("button", { name: "Unlock" })).toBeVisible();
    found.push(...(await violations(page, "locked marker map with moving markers")));
    await page.locator("#tab-view").click();
    found.push(...(await violations(page, "View panel, locked map with moving markers")));
    await openSimulation(page);
    await page.getByRole("button", { name: "Night 22:30" }).click();
    await expect(page.locator("#panel-settings .town-stats li").first()).toBeVisible();
    found.push(...(await violations(page, "Settings → Simulation with the town at night")));
    expect(found).toEqual([]);
  });
}

// Rail operations: every view of the Operations tab, the results of a comparison, the wide panel,
// and Settings → Simulation of a layout without rail operations.
for (const [scheme, device, viewport] of STATES) {
  test(`operations states have no accessibility violations (${scheme} mode, ${device})`, async ({ page }) => {
    test.setTimeout(150_000);
    const path = "/app/?layout=../layouts/ebl-lab.json&layers=operations#ops";
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(viewport);
    await page.goto(path);
    await page.evaluate(() => localStorage.clear());
    await page.goto(path);
    await page.waitForFunction(() => window.__arail?.operations.sim?.engine, null, { timeout: 60_000 });
    const found = [];
    for (const view of ["today", "fleet", "workshop", "crews", "money"]) {
      await page.locator(`#opsView-${view}`).click();
      await expect(page.locator(`#opsView-${view}`)).toHaveAttribute("aria-pressed", "true");
      found.push(...(await violations(page, `Operations panel, ${view}`, "#panel")));
    }
    await page.locator("#opsView-compare").click();
    const boxes = page.locator(".ops-choices input[type=checkbox]");
    for (let i = 3, n = await boxes.count(); i < n; i++) await boxes.nth(i).uncheck();
    await page.locator("#opsDays").selectOption("7");
    await page.locator("#opsSeeds").selectOption("1");
    await page.locator("#opsRun").click();
    await expect(page.locator(".ops-results")).toBeVisible({ timeout: 120_000 });
    found.push(...(await violations(page, "Operations panel, comparison results", "#panel")));
    if (device === "desktop") {
      await page.locator("#opsWide").click();
      found.push(...(await violations(page, "Operations panel, wide")));
      await page.locator("#opsWide").click();
    }
    await page.evaluate(() => window.__arail.openLayout("../layouts/ebl-lab.json", [])); // the lab without modules
    await page.waitForFunction(() => !window.__arail.operations.sim && window.__arail.world.objects.length, null, { timeout: 30_000 });
    await openSimulation(page);
    await expect(page.locator("#opsAdd")).toBeVisible();
    found.push(...(await violations(page, "Settings → Simulation, rail operations offered", "#panel")));
    expect(found).toEqual([]);
  });
}

// Infrastructure: every view of the Infrastructure tab with an asset's record, a decision and the
// instructor's controls, and Settings → Simulation of a layout without it.
for (const [scheme, device, viewport] of STATES) {
  test(`infrastructure states have no accessibility violations (${scheme} mode, ${device})`, async ({ page }) => {
    test.setTimeout(150_000);
    const path = "/app/?layout=../layouts/ebl-lab.json&layers=infrastructure#infra";
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(viewport);
    await page.goto(path);
    await page.evaluate(() => localStorage.clear());
    await page.goto(path);
    await page.waitForFunction(() => window.__arail?.infra.sim?.engine, null, { timeout: 60_000 });
    const found = [];
    await page.locator("#infraRole").selectOption("instructor");
    await page.locator("#infraNext").click();
    for (const view of ["overview", "map", "assets", "decisions", "projects", "staff", "results"]) {
      await page.locator(`#infraView-${view}`).click();
      await expect(page.locator(`#infraView-${view}`)).toHaveAttribute("aria-pressed", "true");
      if (view === "assets") await page.locator("#panel-infra .infra-assets tbody tr button.link").first().click();
      found.push(...(await violations(page, `Infrastructure panel, ${view}`, "#panel")));
    }
    await page.evaluate(() => window.__arail.openLayout("../layouts/ebl-lab.json", [])); // the lab without modules
    await page.waitForFunction(() => !window.__arail.infra.sim && window.__arail.world.objects.length, null, { timeout: 30_000 });
    await openSimulation(page);
    await expect(page.locator("#infraAdd")).toBeVisible();
    found.push(...(await violations(page, "Settings → Simulation, infrastructure offered", "#panel")));
    expect(found).toEqual([]);
  });
}

// The container terminal: its panel, a selected container with the Move form, a pick on the canvas
// (the placing bar), the crane jobs and the inspectors of the terminal's object types.
for (const [scheme, device, viewport] of STATES) {
  test(`terminal states have no accessibility violations (${scheme} mode, ${device})`, async ({ page }) => {
    test.setTimeout(150_000);
    const path = "/app/?layout=../layouts/container-terminal.json#terminal";
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(viewport);
    await page.goto(path);
    await page.evaluate(() => localStorage.clear());
    await page.goto(path);
    await page.waitForFunction(() => window.__arail?.mode === "flyover" && window.__arail.terminal.sim, null, { timeout: 30_000 });
    const found = [];
    found.push(...(await violations(page, "Terminal panel")));
    await page.locator("#termList button", { hasText: "ARLU 100001 9" }).click();
    await expect(page.locator("#termTarget")).toBeVisible();
    found.push(...(await violations(page, "a container selected, the Move form")));
    await page.getByRole("button", { name: "Pick on the layout" }).click();
    await expect(page.locator("#placing")).toBeVisible();
    found.push(...(await violations(page, "a pick on the canvas")));
    await page.getByRole("button", { name: "To the yard" }).click();
    await expect(page.locator(".term-jobs tbody tr")).toHaveCount(1);
    found.push(...(await violations(page, "the crane jobs with a move")));
    await page.locator("#tab-build").click();
    for (const type of ["container-yard", "gantry-crane", "truck-lane", "quay", "reach-stacker"]) {
      await page.evaluate((t) => window.__arail.editor.select(window.__arail.world.objects.find((o) => o.type === t)), type);
      await expect(page.locator("#panel-build h2", { hasText: "Selected:" })).toBeVisible();
      found.push(...(await violations(page, `inspector of ${type}`, "#panel-build")));
    }
    expect(found).toEqual([]);
  });
}

// Journeys: the Journeys tab with travel plans found, travellers on their way (one followed, its plan
// and log open), the results and the wide panel; the module boxes of the View panel (also in the
// container terminal, a module of its own), the Disruptions tab of its module and Settings →
// Simulation offering the journeys.
for (const [scheme, device, viewport] of STATES) {
  test(`journeys and modules states have no accessibility violations (${scheme} mode, ${device})`, async ({ page }) => {
    test.setTimeout(150_000);
    const path = "/app/?layout=../layouts/ebl-lab.json&layers=journeys#journeys";
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(viewport);
    await page.goto(path);
    await page.evaluate(() => localStorage.clear());
    await page.goto(path);
    await page.waitForFunction(() => window.__arail?.journeys?.sim, null, { timeout: 30_000 });
    const found = [];
    found.push(...(await violations(page, "Journeys panel, no travellers", "#panel")));
    await page.locator("#journeyFrom").selectOption("building:plattenbau-2");
    await page.locator("#journeyTo").selectOption("station:waldau");
    await page.locator("#journeyLeave").fill("07:20");
    await page.locator("#journeyFind").click();
    await expect(page.locator(".plan-list .plan").first()).toBeVisible();
    found.push(...(await violations(page, "Journeys panel, travel plans", "#panel")));
    await page.locator("#journeyChoose-0").click();
    await page.locator("#journeyFrom").selectOption("station:altstadt");
    await page.locator("#journeyTo").selectOption("building:school-1");
    await page.locator("#journeyLeave").fill("07:05");
    await page.locator("#journeyFind").click();
    await page.locator("#journeyChoose-0").click();
    await expect(page.locator(".traveller")).toHaveCount(2);
    await page.evaluate(() => (window.__arail.world.speed = 30));
    await page.waitForFunction(() => window.__arail.journeys.sim.travellers.some((t) => t.state === "waiting" || t.state === "train"), null, { timeout: 60_000 });
    await page.locator(".traveller details summary").first().click();
    await page.locator(".traveller").first().getByRole("button", { name: /^Show / }).click();
    found.push(...(await violations(page, "Journeys panel, travellers on their way")));
    await page.waitForFunction(() => window.__arail.journeys.sim.travellers.some((t) => t.state === "arrived"), null, { timeout: 90_000 });
    await expect(page.locator(".journey-results")).toBeVisible();
    found.push(...(await violations(page, "Journeys panel, results", "#panel")));
    if (device === "desktop") {
      await page.locator("#journeysWide").click();
      found.push(...(await violations(page, "Journeys panel, wide", "#panel")));
      await page.locator("#journeysWide").click();
    }
    await page.locator("#tab-view").click();
    await expect(page.locator(".modules")).toBeVisible();
    found.push(...(await violations(page, "View panel, modules", "#panel")));
    await page.locator(".modules").getByRole("button", { name: "Container terminal", exact: true }).click();
    await page.waitForFunction(() => window.__arail.terminal.sim, null, { timeout: 30_000 });
    await page.locator("#tab-view").click();
    found.push(...(await violations(page, "View panel, modules in the container terminal", "#panel")));
    await page.evaluate(() => window.__arail.openLayout("../layouts/ebl-lab.json", [])); // the lab without modules
    await page.waitForFunction(() => /ebl-lab/.test(window.__arail.layoutUrl) && !window.__arail.journeys.sim && window.__arail.world.objects.length, null, { timeout: 30_000 });
    await openSimulation(page);
    await expect(page.locator("#journeysAdd")).toBeVisible();
    found.push(...(await violations(page, "Settings → Simulation, journeys offered", "#panel")));
    await page.locator("#tab-view").click();
    await page.locator(".modules").getByRole("button", { name: "Disruptions", exact: true }).click();
    await expect(page.locator("#tab-disrupt")).toBeVisible();
    found.push(...(await violations(page, "View panel, the module Disruptions on", "#panel")));
    await page.locator("#tab-disrupt").click();
    await page.selectOption("#disType", "delay");
    await page.getByRole("button", { name: "Start: Delay" }).click();
    await page.locator(".scenario").first().getByRole("button", { name: "Play" }).click();
    await expect(page.locator(".scenario").first().getByRole("button", { name: "Stop" })).toBeVisible();
    await expect(page.locator(".disruption").first()).toBeVisible();
    found.push(...(await violations(page, "Disruptions panel, a disruption and a scenario", "#panel")));
    expect(found).toEqual([]);
  });
}
