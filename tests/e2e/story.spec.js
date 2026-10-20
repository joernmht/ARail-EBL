// End-to-end tests of the app as a presentation (Chromium): the maintenance story on Bf Neustadt to
// click through (buttons, the list of steps, a presenter's clicker, Play, the camera that follows it),
// the reduced Terminal tab, and the game page with the games on the lab's layout.
import { expect, test } from "@playwright/test";
import { caseReady, openCase } from "./ui.js";

const STORY = "/app/?layout=../layouts/ebl-neustadt.json&layers=infrastructure#infra";

/** Collect uncaught page errors (console noise such as blocked web fonts is ignored). */
function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Open a page with nothing stored; it is ready when the photo is tracked or the flyover shows the layout. */
async function open(page, path) {
  const errors = trackErrors(page);
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.tracker.state.H || (window.__arail?.mode === "flyover" && window.__arail.world.objects.length), null, { timeout: 30_000 });
  return errors;
}

/** The story's disruptions as "type@target". */
const storyDisruptions = (page) => page.evaluate(() => window.__arail.world.disruptions.active
  .filter((d) => d.id.startsWith("story:")).map((d) => `${d.type}@${d.target}`).sort());

const title = (page) => page.locator("#infraStoryTitle");

test("the app opens Bf Neustadt; Infrastructure → Disruption switches on the maintenance story", async ({ page }) => {
  const errors = await open(page, "/app/#overview");
  expect(await page.evaluate(() => window.__arail.layoutUrl)).toMatch(/ebl-neustadt\.json$/);
  // the presentation has no game cases; its modules (the terminal among them) are off until they are switched on
  for (const c of ["evu-disruption", "journeys", "infra-disruption", "terminal"]) expect(await caseReady(page, c), c).toBe(false);
  await openCase(page, "infra-disruption");
  const on = page.locator("#caseOn");
  await expect(on).toHaveText("Switch on “Infrastructure”");
  await on.click();
  await page.waitForFunction(() => window.__arail.world.simulations.some((s) => s.constructor.type === "maintenance-story"), null, { timeout: 30_000 });
  await expect(page.locator("#case-infra-disruption")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#casePanel h2").first()).toHaveText("Maintenance at Bf Neustadt");
  await expect(title(page)).toHaveText("The station in normal service");
  expect(errors).toEqual([]);
});

test("the maintenance story: Next and Back, the list of steps, Start again and a clicker", async ({ page }) => {
  const errors = await open(page, STORY);
  await expect(page.locator("#case-infra-disruption")).toHaveAttribute("aria-selected", "true");
  await expect(title(page)).toHaveText("The station in normal service");
  await expect(page.locator("#casePanel .story-count")).toHaveText("Step 1 of 12");
  await expect(page.locator("#infraStoryBack")).toBeDisabled();
  expect(await storyDisruptions(page)).toEqual([]);

  // the signal fails: a fault on its platform track
  await page.locator("#infraStoryNext").click();
  await expect(title(page)).toHaveText(/fails$/);
  expect(await storyDisruptions(page)).toEqual(["infra-fault@platform-2:left"]);
  // the signaller closes that track only; the other track of the platform stays open
  await page.locator("#infraStoryNext").click();
  await expect(title(page)).toHaveText(/^The signaller closes/);
  expect(await storyDisruptions(page)).toEqual(["track-closure@platform-2:left"]);
  // back: the closure ends again
  await page.locator("#infraStoryBack").click();
  await expect(title(page)).toHaveText(/fails$/);
  expect(await storyDisruptions(page)).toEqual(["infra-fault@platform-2:left"]);

  // a jump in the list of steps: the construction train on the renewed track
  await page.locator("#casePanel .story-steps button", { hasText: "The construction train arrives" }).click();
  await expect(title(page)).toHaveText("The construction train arrives");
  await expect(page.locator("#casePanel .story-steps button", { hasText: "The construction train arrives" })).toHaveAttribute("aria-current", "step");
  expect(await storyDisruptions(page)).toEqual(["track-closure@platform-2:right"]); // track G3

  // a presenter's clicker: Page Down and Page Up
  await page.keyboard.press("PageDown");
  await expect(title(page)).toHaveText("The old track comes out");
  await page.keyboard.press("PageUp");
  await page.keyboard.press("PageUp");
  await expect(title(page)).toHaveText(/^A planned renewal/);

  // Start again: the station in normal service, nothing disrupted
  await page.locator("#infraStoryRestart").click();
  await expect(title(page)).toHaveText("The station in normal service");
  expect(await storyDisruptions(page)).toEqual([]);
  // the story's disruptions are not toasts
  await expect(page.locator("#toast")).not.toContainText("Track closure");
  expect(errors).toEqual([]);
});

test("the maintenance story plays step after step until Play is released", async ({ page }) => {
  const errors = await open(page, STORY);
  await page.evaluate(() => (window.__arail.world.speed = 5));
  await page.locator("#infraStoryPlay").click();
  await expect(page.locator("#infraStoryPlay")).toHaveAttribute("aria-pressed", "true");
  // the first step has no animation: after a pause, the next one begins
  await expect(title(page)).toHaveText(/fails$/, { timeout: 15_000 });
  await page.locator("#infraStoryPlay").click();
  await expect(page.locator("#infraStoryPlay")).toHaveAttribute("aria-pressed", "false");
  // released: the step's animation runs to its end, the story stays at that step
  await page.waitForFunction(() => window.__arail.infra.story.state().progress >= 1, null, { timeout: 15_000 });
  await page.waitForTimeout(2000); // 10 simulated seconds, more than the pause between steps
  await expect(title(page)).toHaveText(/fails$/);
  expect(errors).toEqual([]);
});

test("Camera follows opens the flyover and goes where the story happens", async ({ page }) => {
  const errors = await open(page, STORY);
  const follow = page.locator("#infraStoryFollow");
  await expect(follow).toHaveAttribute("aria-pressed", "false"); // the camera view of the photo
  await follow.click();
  await page.waitForFunction(() => window.__arail.mode === "flyover");
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  await page.locator("#casePanel .story-steps button", { hasText: "The team repairs the signal" }).click();
  // the camera's target comes to the signal
  await expect.poll(() => page.evaluate(() => {
    const a = window.__arail, at = a.infra.story.view().at, t = a.flyover.cam.target;
    return Math.round(Math.hypot(t[0] - at[0], t[1] - at[1]));
  }), { timeout: 15_000 }).toBeLessThan(50);
  // off: the camera stays where it is
  await follow.click();
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => window.__arail.flyover.following)).toBeNull();
  expect(errors).toEqual([]);
});

test("the app's case Terminal moves containers; the visits are on the game page", async ({ page }) => {
  const errors = await open(page, "/app/?layout=../layouts/container-terminal.json#terminal");
  await page.waitForFunction(() => window.__arail.terminal.sim, null, { timeout: 30_000 });
  const panel = page.locator("#casePanel");
  await expect(panel).toBeVisible();
  await expect(panel.locator("h2", { hasText: "Containers" })).toBeVisible();
  for (const name of ["Arrivals", "New arrival", "Crane jobs"]) await expect(panel.locator("h2", { hasText: name })).toHaveCount(0);
  await expect(panel).toContainText("Choose a container, in the list or on the layout, and its new place");
  // a move: choose a container and a place in the yard
  const id = "ARLU 100001 9";
  await page.locator("#termList button", { hasText: id }).click();
  await expect(panel.locator("h2", { hasText: `Move ${id}` })).toBeVisible();
  const value = await page.evaluate((c) => {
    const t = window.__arail.terminal.sim.targets(c).ok.find((x) => x.carrier === "yard-a");
    return `${t.at.carrier}|${t.at.bay}|${t.at.row}|${t.at.tier}`;
  }, id);
  await page.locator("#termTarget").selectOption(value);
  await page.locator("#termMove").click();
  await page.evaluate(() => (window.__arail.world.speed = 30));
  await page.waitForFunction((c) => window.__arail.terminal.sim.inventory.get(c).at?.carrier === "yard-a", id, { timeout: 60_000 });

  // the game page: the whole terminal with its visits and crane jobs
  await open(page, "/game/?layout=../layouts/container-terminal.json#terminal");
  await page.waitForFunction(() => window.__arail.terminal.sim, null, { timeout: 30_000 });
  await expect(page.locator("#casePanel h2", { hasText: "Arrivals" })).toBeVisible();
  await expect(page.locator("#casePanel h2", { hasText: "Crane jobs" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the game page opens the lab with its games", async ({ page }) => {
  const errors = await open(page, "/game/#view");
  expect(await page.evaluate(() => window.__arail.layoutUrl)).toMatch(/ebl-lab\.json$/);
  await expect(page.locator(".brand")).toContainText("Game");
  // the game cases: their modules are layers of the lab, switched on in Interaction or by the URL
  await open(page, "/game/?layers=infrastructure#infra");
  await page.waitForFunction(() => window.__arail.infra?.sim, null, { timeout: 60_000 });
  await expect(page.locator("#case-infra")).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => window.__arail.world.simulations.some((s) => s.constructor.type === "maintenance-story"))).toBe(false);
  expect(errors).toEqual([]);
});
