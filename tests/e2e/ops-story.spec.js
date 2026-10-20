// End-to-end tests of the operations story in the app (Chromium): Bf Neustadt's module Breakdown
// switched on in Settings (alone: Infrastructure takes its place), the story clicked through (the tracks its trains hold, the platform's
// message, the list of steps, a presenter's clicker, Start again), the flyover's camera following
// the spare unit to the depot, no timetable train where the story's trains are, and the game page
// keeping its Operations game.
import { expect, test } from "@playwright/test";
import { caseReady, openCase } from "./ui.js";

const STORY = "/app/?layout=../layouts/ebl-neustadt.json&layers=operations#ops";

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

/** The tracks the story holds for its trains, with the platform's message if there is one. */
const held = (page) => page.evaluate(() => window.__arail.world.disruptions.active
  .filter((d) => d.id.startsWith("story:ops-story:")).map((d) => `${d.type}@${d.target}${d.params.text ? `: ${d.params.text}` : ""}`).sort());

const title = (page) => page.locator("#opsStoryTitle");

test("Railway undertaking → Disruption switches on the module Breakdown of Bf Neustadt and tells the story", async ({ page }) => {
  const errors = await open(page, "/app/#overview");
  expect(await caseReady(page, "evu-disruption")).toBe(false);
  await openCase(page, "evu-disruption");
  const on = page.locator("#caseOn");
  await expect(on).toHaveText("Switch on “Breakdown”");
  await on.click();
  await page.waitForFunction(() => window.__arail.world.simulations.some((s) => s.constructor.type === "ops-story"), null, { timeout: 30_000 });
  await expect(page.locator("#case-evu-disruption")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#casePanel h2").first()).toHaveText("A breakdown at Bf Neustadt");
  await expect(title(page)).toHaveText("RB 31 to Talsee boards at track G3");
  await expect(page.locator("#casePanel .story-count")).toHaveText("Step 1 of 10");
  // the depot on its table module came with the module
  expect(await page.evaluate(() => ["table-bw", "depot-neustadt"].map((id) => !!window.__arail.world.getObject(id)))).toEqual([true, true]);
  // the module is alone: Infrastructure, switched on from its case, takes its place (both stories use platform 2)
  await openCase(page, "infra-disruption");
  await page.locator("#caseOn").click();
  await page.waitForFunction(() => window.__arail.world.simulations.some((s) => s.constructor.type === "maintenance-story"), null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__arail.layersOn())).toEqual(["infrastructure"]);
  expect(await caseReady(page, "evu-disruption")).toBe(false);
  expect(await page.evaluate(() => window.__arail.world.disruptions.active.filter((d) => d.type === "story-train").length)).toBe(0);
  expect(errors).toEqual([]);
});

test("the operations story: Next and Back, the platform's message, the list of steps, a clicker, Start again", async ({ page }) => {
  const errors = await open(page, STORY);
  await expect(page.locator("#case-evu-disruption")).toHaveAttribute("aria-selected", "true");
  await expect(title(page)).toHaveText("RB 31 to Talsee boards at track G3");
  await expect(page.locator("#opsStoryBack")).toBeDisabled();
  // both tracks of platform 2 held for the story's trains, quietly: no disruption in the HUD
  expect(await held(page)).toEqual(["story-train@platform-2:left", "story-train@platform-2:right"]);
  await expect(page.locator("#hud")).not.toContainText("disruption");

  // the fault: the platform shows it
  await page.locator("#opsStoryNext").click();
  await expect(title(page)).toHaveText("442 101 reports a fault");
  expect(await held(page)).toEqual(["story-train@platform-2:left", "story-train@platform-2:right: RB 31 Talsee 07:42: delayed, fault on the train"]);
  await expect(page.locator("#hud")).toContainText("1 disruption");
  // the passengers are sent across the platform
  await page.locator("#opsStoryNext").click();
  await page.locator("#opsStoryNext").click();
  await expect(title(page)).toHaveText("The passengers get off and wait");
  expect((await held(page))[1]).toBe("story-train@platform-2:right: RB 31 Talsee 07:42: now from track G2, about +25 min");
  // back: the reset again
  await page.locator("#opsStoryBack").click();
  await expect(title(page)).toHaveText("The driver calls the operations control");

  // a jump in the list of steps: the empty run frees track G3 at its end
  const empty = page.locator("#casePanel .story-steps button", { hasText: "442 101 runs empty to the workshop" });
  await empty.click();
  await expect(empty).toHaveAttribute("aria-current", "step");
  await page.evaluate(() => window.__arail.operations.story.skip());
  await expect.poll(() => held(page)).toEqual([]);
  // a presenter's clicker: Page Down and Page Up
  await page.keyboard.press("PageDown");
  await expect(title(page)).toHaveText("In the workshop: diagnosis and repair");
  await expect(page.locator("#casePanel .story-now")).toContainText("2 × 40 € = 80 €");
  await page.keyboard.press("PageUp");
  await expect(title(page)).toHaveText("442 101 runs empty to the workshop");
  // Start again: the train boards again, both tracks held without a message
  await page.locator("#opsStoryRestart").click();
  await expect(title(page)).toHaveText("RB 31 to Talsee boards at track G3");
  expect(await held(page)).toEqual(["story-train@platform-2:left", "story-train@platform-2:right"]);
  await expect(page.locator("#toast")).not.toContainText("A story's train");
  expect(errors).toEqual([]);
});

test("Camera follows the spare unit out of the depot and in at track G2", async ({ page }) => {
  const errors = await open(page, STORY);
  const follow = page.locator("#opsStoryFollow");
  await follow.click();
  await page.waitForFunction(() => window.__arail.mode === "flyover");
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  const distance = () => page.evaluate(() => {
    const a = window.__arail, at = a.operations.story.view().at, t = a.flyover.cam.target;
    return Math.round(Math.hypot(t[0] - at[0], t[1] - at[1]));
  });
  // the depot: the camera's target comes to the stand-by driver and the spare unit
  await page.locator("#casePanel .story-steps button", { hasText: "The spare unit leaves the depot" }).click();
  await expect.poll(distance, { timeout: 15_000 }).toBeLessThan(80);
  const target = await page.evaluate(() => window.__arail.flyover.cam.target);
  const depot = await page.evaluate(() => window.__arail.world.getObject("depot-neustadt").geometry.center);
  expect(Math.hypot(target[0] - depot[0], target[1] - depot[1])).toBeLessThan(700);
  // the station: it follows the spare unit coming in
  await page.locator("#casePanel .story-steps button", { hasText: "442 108 comes in at track G2" }).click();
  await expect.poll(distance, { timeout: 15_000 }).toBeLessThan(120);
  expect(errors).toEqual([]);
});

test("while the story plays, no timetable train stands at a track the story holds", async ({ page }) => {
  const errors = await open(page, STORY);
  await page.evaluate(() => {
    const a = window.__arail;
    a.world.speed = 10;
    window.__bad = [];
    // every frame: a timetable vehicle at a held track?
    const check = () => {
      for (const d of a.world.disruptions.active.filter((x) => x.type === "story-train")) {
        const v = a.world.services.docks.get(d.target)?.vehicle;
        if (v) window.__bad.push(`${d.target} in step ${a.operations.story.index + 1}`);
      }
      if (!a.operations.story.finished) requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  await page.locator("#opsStoryPlay").click();
  await expect(page.locator("#opsStoryPlay")).toHaveAttribute("aria-pressed", "true");
  await expect(title(page)).toHaveText("442 101 reports a fault", { timeout: 20_000 });
  await expect(title(page)).toHaveText("The passengers get off and wait", { timeout: 30_000 });
  expect(await page.evaluate(() => window.__bad)).toEqual([]);
  expect(errors).toEqual([]);
});

test("the game page keeps its Operations game on the lab's layout", async ({ page }) => {
  const errors = await open(page, "/game/?layout=../layouts/ebl-lab.json&layers=operations#ops");
  await page.waitForFunction(() => window.__arail?.operations.sim?.engine, null, { timeout: 60_000 });
  await expect(page.locator("#opsView-today")).toBeVisible();
  await expect(page.locator("#opsStoryNext")).toHaveCount(0);
  expect(await page.evaluate(() => window.__arail.world.simulations.some((s) => s.constructor.type === "ops-story"))).toBe(false);
  expect(errors).toEqual([]);
});
