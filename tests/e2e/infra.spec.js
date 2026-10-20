// Infrastructure in the app: the Infrastructure tab of the example (its views, roles and decisions, the
// line map and the GeoJSON, an asset's record and a proposal, running to the next decision and to the
// year's end, saving), faults on the layout, adding infrastructure to a layout from Settings →
// Simulation, and the tabs on a phone.
import { expect, test } from "@playwright/test";
import { caseReady, openCase, openModules } from "./ui.js";

const EXAMPLE = "/game/?layout=../layouts/ebl-lab.json&layers=infrastructure#infra";

function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

/** Open the example with nothing stored. */
async function openInfra(page, path = EXAMPLE) {
  const errors = trackErrors(page);
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.infra.sim?.engine, null, { timeout: 60_000 });
  return errors;
}

test("Infrastructure → Assets shows the district: overview, line map, assets, decisions, projects, staff, results", async ({ page }) => {
  const errors = await openInfra(page);
  await expect(page.locator("#strip-infra")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#case-infra")).toHaveAttribute("aria-selected", "true");
  expect(await caseReady(page, "terminal")).toBe(false);
  expect(await caseReady(page, "ops")).toBe(false);
  await expect(page.locator("#casePanel h2").first()).toHaveText("Infrastructure district Bahnhof");
  // Overview: key figures, the colours on the layout, what happened
  await expect(page.locator("#casePanel .ops-tiles .tile")).toHaveCount(8);
  await page.locator("#infraColour").selectOption("checked");
  await expect.poll(() => page.evaluate(() => window.__arail.infra.sim.display.mode)).toBe("checked");
  await page.locator("#infraColour").selectOption("known");
  // Line map: one diagram per line, a mark per asset; choosing one shows its record
  await page.locator("#infraView-map").click();
  await expect(page.locator("svg.line-map")).toHaveCount(2);
  const marks = await page.locator("svg.line-map .mark").count();
  const assets = await page.evaluate(() => window.__arail.infra.sim.engine.active().length);
  expect(marks).toBe(assets);
  await page.locator('svg.line-map .mark[data-asset="signal-n2"]').dispatchEvent("click");
  await expect(page.locator(".infra-card h3").first()).toContainText("Exit signal N2");
  await expect(page.locator(".infra-card")).toContainText("IfcSignal.VISUAL");
  const download = page.waitForEvent("download");
  await page.locator("#infraGeo").click();
  expect((await download).suggestedFilename()).toMatch(/\.geojson$/);
  // Assets: filters, the record and the measures of the ALV
  await page.locator("#infraView-assets").click();
  await page.locator("#infraOnLayout").check();
  const rows = await page.locator("#casePanel .infra-assets tbody tr").count();
  const onLayout = await page.evaluate(() => window.__arail.infra.sim.engine.active().filter((a) => a.on_layout).length);
  expect(rows).toBe(Math.min(onLayout, 40));
  await page.locator("#infraRole").selectOption("alv");
  await page.locator("#casePanel .infra-assets tbody tr").first().locator("button.link").click();
  await expect(page.locator(".infra-card")).toBeVisible();
  await page.locator(".infra-card button", { hasText: /^Repair/ }).first().click();
  await expect(page.locator("#toast")).toContainText(/Proposed|cannot/);
  // the inspection plan of the ALV
  await expect(page.locator("#casePanel select[aria-label$=': method']").first()).toBeVisible();
  // Decisions: the asset manager approves the proposal
  await page.locator("#infraRole").selectOption("asset-manager");
  await page.locator("#infraView-decisions").click();
  const decision = page.locator(".infra-decision").first();
  await expect(decision).toBeVisible();
  await decision.locator("button.btn").first().click();
  await expect(page.locator("#toast")).toBeVisible();
  // Projects, Staff, Results
  await page.locator("#infraView-projects").click();
  await expect(page.locator("#casePanel .infra-upgrades li")).toHaveCount(2);
  await page.locator("#infraView-staff").click();
  await expect(page.locator("#casePanel .ops-table").first().locator("tbody tr")).toHaveCount(4);
  await page.locator("#infraView-results").click();
  await expect(page.locator("#casePanel .ops-compare")).toBeVisible();
  expect(errors).toEqual([]);
});

test("running to the next decision and to the year's end; the year's results; saving the game", async ({ page }) => {
  const errors = await openInfra(page);
  await page.locator("#infraNext").click();
  await expect(page.locator("#casePanel [role=status]")).toContainText(/Ran .* to /);
  await page.locator("#infraYear").click();
  await expect.poll(() => page.evaluate(() => window.__arail.infra.sim.engine.years.length)).toBeGreaterThan(0);
  await page.locator("#infraView-results").click();
  await expect(page.locator("#casePanel .ops-compare thead th").nth(1)).toHaveText("2027");
  const download = page.waitForEvent("download");
  await page.locator("#infraSave").click();
  expect((await download).suggestedFilename()).toMatch(/game\.json$/);
  // the game is kept in the browser and restored
  await page.reload();
  await page.waitForFunction(() => window.__arail?.infra.sim?.engine?.years.length > 0, null, { timeout: 60_000 });
  // the instructor starts a new game with a scenario
  await page.locator("#infraRole").selectOption("instructor");
  await page.locator("#infraView-results").click();
  await page.locator("#infraScenario").selectOption("storm");
  await page.locator("#infraNew").click();
  await expect.poll(() => page.evaluate(() => window.__arail.infra.sim.engine.scenario)).toBe("storm");
  expect(errors).toEqual([]);
});

test("a fault on the layout: the van drives out, the station's trains are disturbed", async ({ page }) => {
  const errors = await openInfra(page);
  await page.locator("#infraFail").click();
  await expect(page.locator("#toast")).toContainText(/fails/);
  // the button picks an asset by the clock; a fault of some of them (a track, a balise) is noticed by a
  // driver only after a while: an exit signal's fault stops the next train within seconds
  await page.evaluate(() => window.__arail.infra.sim.failAsset("signal-n2"));
  await expect.poll(() => page.evaluate(() => window.__arail.world.disruptions.active.some((d) => d.type === "infra-fault")), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const e = window.__arail.infra.sim.engine;
    return e.people.some((p) => ["driving", "repairing"].includes(e.activity(p).state));
  }), { timeout: 30_000 }).toBe(true);
  // the fault is listed in Disruptions (module Disruptions); switching the module off leaves it on
  await openModules(page);
  await page.locator(".modules").getByRole("button", { name: "Disruptions", exact: true }).click();
  await openCase(page, "disrupt");
  await expect(page.locator("#casePanel .disruption", { hasText: "Infrastructure fault" }).first()).toBeVisible();
  await openModules(page);
  await page.locator(".modules").getByRole("button", { name: "Disruptions", exact: true }).click();
  expect(await caseReady(page, "disrupt")).toBe(false);
  expect(await page.evaluate(() => window.__arail.world.disruptions.active.some((d) => d.type === "infra-fault"))).toBe(true);
  expect(errors).toEqual([]);
});

test("adding infrastructure to a layout from the case Assets while it is off", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/game/?layout=../layouts/ebl-lab.json#infra");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/game/?layout=../layouts/ebl-lab.json#infra");
  await page.waitForFunction(() => window.__arail?.world.objects.length, null, { timeout: 30_000 });
  expect(await caseReady(page, "infra")).toBe(false);
  await expect(page.locator("#caseOn")).toHaveText("Switch on “Infrastructure”");
  await page.locator("#caseAdd").click();
  await expect(page.locator("#case-infra")).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => page.evaluate(() => window.__arail.infra.sim?.engine?.assets.size ?? 0)).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test("Infrastructure → Assets on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openInfra(page);
  await expect(page.locator("#case-infra")).toBeVisible();
  for (const v of ["map", "assets", "decisions", "projects", "staff", "results", "overview"]) {
    await page.locator(`#infraView-${v}`).click();
    await expect(page.locator(`#infraView-${v}`)).toHaveAttribute("aria-pressed", "true");
  }
  // no sideways scrolling of the page
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});
