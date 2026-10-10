// Journeys in the app: the lab example's module Journeys, a traveller made in the Journeys tab (start,
// aim, departure, transfer time, the travel plans to choose from), the travellers following their
// plans on the layout, "Show" following one in the flyover, the results and their CSV, the
// travellers kept with the layout, and the module offered in Settings → Simulation.
import { expect, test } from "@playwright/test";

const PATH = "/app/?layout=../layouts/ebl-lab.json&layers=journeys#journeys";

function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

async function open(page, path = PATH) {
  const errors = trackErrors(page);
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.journeys?.sim);
  return errors;
}

/** Make a traveller in the form and choose its plan number `pick`. */
async function make(page, { name = "", from, to, leave, transfer = null, pick = 0 }) {
  if (name) await page.locator("#journeyName").fill(name);
  await page.locator("#journeyFrom").selectOption(from);
  await page.locator("#journeyTo").selectOption(to);
  await page.locator("#journeyLeave").fill(leave);
  if (transfer != null) await page.locator("#journeyTransfer").selectOption(String(transfer));
  await page.locator("#journeyFind").click();
  await expect(page.locator(".plan-list .plan").first()).toBeVisible();
  await page.locator(`#journeyChoose-${pick}`).click();
}

test("make travellers, choose their plans, follow them and compare the arrivals", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await open(page);
  await expect(page.locator("#tab-journeys")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#panel-journeys h2").first()).toHaveText("Journeys");
  // the town's residents stay at home; the box brings them back and takes them away again
  await expect(page.locator("#journeysCrowd")).not.toBeChecked();
  // a plan for a house to a station beyond the layout: on foot to platform 2, the S 8
  await page.locator("#journeyFrom").selectOption("building:plattenbau-2");
  await page.locator("#journeyTo").selectOption("station:waldau");
  await page.locator("#journeyLeave").fill("07:20");
  await page.locator("#journeyFind").click();
  const first = page.locator(".plan-list .plan").first();
  await expect(first).toContainText("07:20 → 08:05");
  await expect(first).toContainText("Walk");
  await expect(first).toContainText("S 8");
  await expect(first).toContainText("Platform 2");
  await expect(first.locator(".tag")).toHaveText(["fastest"]);
  await expect(page.locator("#journeyChoose-0")).toBeFocused();
  await expect(page.locator("#journeyChoose-0")).toHaveAccessibleName(/^Choose: 07:20 → 08:05/);
  // changing the request drops the plans
  await page.locator("#journeyTransfer").selectOption("10");
  await expect(page.locator(".plan-list")).toHaveCount(0);
  await page.locator("#journeyTransfer").selectOption("3");
  await page.locator("#journeyFind").click();
  await page.locator("#journeyName").fill("Ada");
  await page.locator("#journeyChoose-0").click();
  await expect(page.locator(".traveller")).toHaveCount(1);
  await expect(page.locator(".traveller").first()).toContainText("Ada");
  await expect(page.locator(".traveller-status").first()).toHaveText("Not left yet: leaves at 07:20");
  await expect(page.locator(".plan-list")).toHaveCount(0);
  // another one, with a change of trains at the station, and one by bus in the town
  await make(page, { name: "Bob", from: "station:altstadt", to: "station:waldau", leave: "07:20" });
  await make(page, { from: "building:estate-1", to: "building:office-1", leave: "07:10", pick: 1 });
  await expect(page.locator(".traveller")).toHaveCount(3);
  const names = await page.locator(".traveller-name b").allTextContents();
  expect(names[2]).toMatch(/^[A-ZÇŞÖÜĐŽČŁ]\. /); // a name of its own, made up
  // run: they set off, wait, ride and arrive
  await page.evaluate(() => (window.__arail.world.speed = 30));
  await expect(page.locator(".traveller-status").first()).toHaveText(/Waiting for S 8 → Waldau 07:41 at Platform 2|On S 8 to Waldau/, { timeout: 60_000 });
  // "Show" follows Ada in the flyover
  await page.getByRole("button", { name: "Show Ada" }).click();
  await page.waitForFunction(() => window.__arail.mode === "flyover" && window.__arail.flyover.following);
  await expect(page.getByRole("button", { name: "Show Ada" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".traveller").first()).toHaveAttribute("aria-current", "true");
  await page.waitForFunction(() => window.__arail.journeys.sim.travellers.every((t) => t.state === "arrived"), null, { timeout: 120_000 });
  await expect(page.locator(".traveller-status").first()).toHaveText("Arrived at 08:05 (on time)");
  // the plan and the log
  await page.locator(".traveller details summary").nth(1).click();
  await expect(page.locator(".traveller details").nth(1)).toContainText("Change at Platform 1: 12 min");
  await expect(page.locator(".traveller details").nth(1).locator(".journey-log")).toContainText("Off RE 1 at Platform 1");
  await page.waitForTimeout(500); // refreshed: it stays open
  await expect(page.locator(".traveller details").nth(1)).toHaveAttribute("open", "");
  // a refresh between the click and its toggle event (which comes later) keeps them open
  const kept = await page.evaluate(async () => {
    const d = document.querySelectorAll(".traveller details")[2];
    d.querySelector("summary").click(); // open now, the toggle event queued
    window.__arail.journeys.update();
    await new Promise((r) => setTimeout(r, 50));
    window.__arail.journeys.update();
    return [d.isConnected, d.open, window.__arail.journeys.open.has(d.closest(".traveller").dataset.id)];
  });
  expect(kept).toEqual([true, true, true]);
  // results and their CSV
  const rows = page.locator(".journey-results tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("Ada");
  await expect(rows.first()).toContainText("08:05");
  const download = page.waitForEvent("download");
  await page.locator("#journeysCsv").click();
  expect((await download).suggestedFilename()).toBe("journeys.csv");
  // kept with the layout: after a reload they are there again, ready to start
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => window.__arail?.journeys?.sim?.travellers.length === 3);
  await expect(page.locator(".traveller-status").first()).toHaveText(/Not left yet|Walking|Waiting/);
  // removed: one, then all (the second click does it)
  await page.getByRole("button", { name: "Remove Bob" }).click();
  await expect(page.locator(".traveller")).toHaveCount(2);
  await page.locator("#journeysClear").click();
  await expect(page.locator("#journeysClear")).toHaveText("Click again to remove all");
  await page.locator("#journeysClear").click();
  await expect(page.locator(".traveller")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the generated people can come back; Settings → Simulation offers the module; journeys can be added to another layout", async ({ page }) => {
  const errors = await open(page);
  await page.locator("#journeysCrowd").check();
  await page.waitForFunction(() => window.__arail.world.simulations.find((s) => s.constructor.type === "town").agents.length > 0);
  await page.locator("#journeysCrowd").uncheck();
  await page.waitForFunction(() => !window.__arail.world.simulations.find((s) => s.constructor.type === "town").enabled);
  // the lab without the module: Settings → Simulation offers it
  await page.locator("#tab-view").click();
  await page.locator(".modules").getByRole("button", { name: "Journeys", exact: true }).click();
  await page.waitForFunction(() => !window.__arail.journeys.sim);
  await expect(page.locator("#tab-journeys")).toBeHidden();
  await page.locator("#tab-settings").click();
  await expect(page.locator("#journeysOpenExample")).toHaveText("Switch on the module “Journeys”");
  // another layout: added to it, with the lines named on its platforms
  await page.evaluate(() => window.__arail.openExample("neustadt"));
  await page.waitForFunction(() => /ebl-neustadt/.test(window.__arail.layoutUrl) && window.__arail.world.objects.length);
  await page.locator("#tab-settings").click();
  await page.locator("#journeysAdd").click();
  await page.waitForFunction(() => window.__arail.journeys.sim);
  await expect(page.locator("#tab-journeys")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#journeyFrom option").first()).toBeAttached();
  expect(errors).toEqual([]);
});
