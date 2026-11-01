// End-to-end tests of the operations plan in the app (Chromium): Bf Neustadt's module Operations
// switched on from its case; Railway undertaking → Operations puts units and drivers on the trains,
// Infrastructure → Operations puts them on tracks, with what does not work shown at once and the
// chart over the hour; Run plays the plan on the layout and tells how it went; in German too.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { caseReady, expectCase, openCase } from "./ui.js";

const PLAN = "/app/?layout=../layouts/ebl-neustadt.json&layers=plan";

/** Open a page with nothing stored; it is ready when the photo is tracked or the flyover shows the layout. */
async function open(page, path) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.tracker.state.H || (window.__arail?.mode === "flyover" && window.__arail.world.objects.length), null, { timeout: 30_000 });
  return errors;
}

/** The select of a train's unit, driver or track. */
const choice = (page, side, train, key) => page.locator(`#plan-${side}-${train}-${key}`);

test("Railway undertaking → Operations switches on the module Operations and shows the plan's problems", async ({ page }) => {
  const errors = await open(page, "/app/#overview");
  expect(await caseReady(page, "evu-operations")).toBe(false);
  await openCase(page, "evu-operations");
  const on = page.locator("#caseOn");
  await expect(on).toHaveText("Switch on “Operations”");
  await on.click();
  await page.waitForFunction(() => window.__arail.world.simulations.some((s) => s.constructor.type === "ops-plan"), null, { timeout: 30_000 });
  await expectCase(page, "evu-operations");
  await expect(page.locator("#casePanel h2").first()).toHaveText("A morning at Bf Neustadt");
  await expect(page.locator("#evuPlanStatus")).toHaveText("4 problems");
  await expect(page.locator(".plan-train")).toHaveCount(6);
  await expect(page.locator(".plan-problems li")).toHaveText(["Too few places: 216 for 420", "Weber is still out until 07:45", "442 201 is still out until 07:52", "Outside the shift of Becker (05:30–08:10)"]);
  // the chart: the units and the drivers, red where it does not work
  await expect(page.locator(".plan-row")).toHaveCount(9);
  await expect(page.locator(".plan-span.bad")).not.toHaveCount(0);
  // the module is alone (it runs the trains of the platforms while the plan plays)
  expect(await page.evaluate(() => window.__arail.layersOn())).toEqual(["plan"]);
  expect(errors).toEqual([]);
});

test("both sides fix the plan; Run plays it on the layout and tells how it went", async ({ page }) => {
  const errors = await open(page, `${PLAN}#evu-operations`);
  await expect(page.locator("#evuPlanStatus")).toHaveText("4 problems");
  await choice(page, "evu", "s1-0725", "unit").selectOption("442 102");
  await choice(page, "evu", "s1-0745", "driver").selectOption("becker");
  await choice(page, "evu", "rb71-0752", "unit").selectOption("442 202");
  await choice(page, "evu", "rb71-0752", "driver").selectOption("weber");
  await expect(page.locator("#evuPlanStatus")).toHaveText("No problems");
  await expect(page.locator(".plan-problems")).toHaveCount(0);
  // the same trains on the other side: their tracks
  await openCase(page, "infra-operations");
  await expect(page.locator("#infraPlanStatus")).toHaveText("2 problems");
  await expect(page.locator(".plan-problems li")).toHaveText(["Track G3 is taken by RB 71 until 07:24", "No track"]);
  await expect(page.locator(".plan-row")).toHaveCount(3);
  await choice(page, "infra", "s1-0725", "track").selectOption("G2");
  await choice(page, "infra", "s1-0745", "track").selectOption("G3");
  await expect(page.locator("#infraPlanStatus")).toHaveText("No problems");
  // Run: from 07:00, fast
  await page.locator("#infraPlanRun").click();
  await expect(page.locator("#infraPlanStatus")).toContainText("Running");
  await expect(choice(page, "infra", "s1-0705", "track")).toBeDisabled();
  await page.getByRole("group", { name: "Speed" }).getByRole("button", { name: "30×" }).click();
  // its trains at the platforms, with their units and drivers
  await page.waitForFunction(() => window.__arail.world.services.vehicles().some((v) => v.plan?.unit === "442 101" && v.phase === "dwelling"), null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__arail.world.services.vehicles().find((v) => v.plan)?.info?.[0])).toBe("442 101 · Becker");
  await expect(page.locator("#infraPlanResult")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#infraPlanResult .tile .value")).toHaveText(["6", "0", "0", "0"]);
  await expect(page.locator(".plan-chip")).toHaveText(Array(6).fill("on time"));
  // the platforms are the timetable's again
  expect(await page.evaluate(() => [...window.__arail.world.services.docks.values()].every((st) => st.mode === "timetable"))).toBe(true);
  expect(errors).toEqual([]);
});

test("the draft runs with a delay, cancelled trains on the board and people left behind; Start again", async ({ page }) => {
  const errors = await open(page, `${PLAN}#evu-operations`);
  await page.locator("#evuPlanRun").click();
  await page.getByRole("group", { name: "Speed" }).getByRole("button", { name: "30×" }).click();
  // while it runs: no accessibility violations (the chips, the time in the chart)
  await page.waitForFunction(() => window.__arail.world.clock.minutes > 7 * 60 + 25, null, { timeout: 30_000 });
  const results = await new AxeBuilder({ page }).include("#casePanel").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await expect(page.locator(".plan-now").first()).toBeVisible();
  await expect(page.locator("#evuPlanResult")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#evuPlanResult .tile .value")).toHaveText(["3", "1", "2", "204"]);
  await expect(page.locator(".plan-chip")).toHaveText(["on time", "on time", "on time", "+4 min", "cancelled", "cancelled"]);
  // Start again: the plan as the layout has it
  await choice(page, "evu", "s1-0725", "unit").selectOption("442 102");
  await expect(page.locator("#evuPlanStatus")).toHaveText("3 problems");
  await page.locator("#evuPlanReset").click();
  await expect(page.locator("#evuPlanStatus")).toHaveText("4 problems");
  expect(errors).toEqual([]);
});

test("the plan in German", async ({ page }) => {
  const errors = await open(page, `${PLAN}&lang=de#evu-operations`);
  await expect(page.locator("#scenarioName")).toHaveText("Fahrzeuge und Fahrer");
  await expect(page.locator("#scenarioTask")).toContainText("Aufgabe: Geben Sie jedem Zug des Morgens ein Fahrzeug");
  await expect(page.locator("#evuPlanStatus")).toHaveText("4 Probleme");
  await expect(page.locator("#evuPlanRun")).toHaveText("Fahren");
  await expect(page.locator(".plan-problems li").first()).toHaveText("Zu wenige Plätze: 216 für 420");
  await expect(page.locator(".plan-problems li").nth(1)).toHaveText("Weber ist bis 07:45 unterwegs");
  await expect(choice(page, "evu", "s1-0705", "unit").locator("option:checked")).toHaveText("442 101 · 440 Plätze");
  await openCase(page, "infra-operations");
  await expect(page.locator(".plan-problems li")).toHaveText(["Gleis G3 ist bis 07:24 von RB 71 belegt", "Kein Gleis"]);
  expect(errors).toEqual([]);
});
