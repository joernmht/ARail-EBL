// End-to-end tests of the journeys story (Chromium): the app's Journeys tab on Bf Neustadt, a
// traveller's journey to click through (buttons, the list of steps, a presenter's clicker, the
// platform track and the bus bay kept free, the clock, the camera that follows Ada and her bus); the
// game page keeps the journeys exercise.
import { expect, test } from "@playwright/test";

const STORY = "/app/?layout=../layouts/ebl-neustadt.json&layers=journeys#journeys";

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

const title = (page) => page.locator("#journeysStoryTitle");
const step = (page, name) => page.locator("#panel-journeys .story-steps button", { hasText: name });

test("the app opens Bf Neustadt; Settings switches on the journeys story", async ({ page }) => {
  const errors = await open(page, "/app/#simulate");
  await expect(page.locator("#tab-journeys")).toBeHidden();
  const on = page.locator("#journeysOpenExample");
  await expect(on).toHaveText("Switch on the module “Journeys”");
  await on.click();
  await page.waitForFunction(() => window.__arail.world.simulations.some((s) => s.constructor.type === "journeys-story"), null, { timeout: 30_000 });
  await expect(page.locator("#tab-journeys")).toBeVisible();
  await page.locator("#tab-journeys").click();
  await expect(page.locator("#panel-journeys h2").first()).toHaveText("Ada's journey");
  await expect(title(page)).toHaveText("Ada sets off");
  await expect(page.locator("#panel-journeys .story-count")).toHaveText("Step 1 of 11");
  expect(errors).toEqual([]);
});

test("the journeys story: Next and Back, the list of steps, a clicker; her track and her bay kept free; the clock", async ({ page }) => {
  const errors = await open(page, STORY);
  await expect(page.locator("#tab-journeys")).toHaveAttribute("aria-selected", "true");
  await expect(title(page)).toHaveText("Ada sets off");
  await expect(page.locator("#journeysStoryBack")).toBeDisabled();
  expect(await storyDisruptions(page)).toEqual([]);

  // the board, then the platform: her track is kept for her train, without a message
  await page.locator("#journeysStoryNext").click();
  await expect(title(page)).toHaveText("The departure board");
  await page.locator("#journeysStoryNext").click();
  await expect(title(page)).toHaveText("On platform 1");
  expect(await storyDisruptions(page)).toEqual(["kept-free@platform-1:right"]);
  // the train is late: the platform shows it; the story's disruptions are no toasts
  await page.locator("#journeysStoryNext").click();
  await expect(title(page)).toHaveText("RB 31 is 20 minutes late");
  await expect(page.locator("#panel-journeys .story-now")).toContainText("a level crossing fault near Bergheim");
  expect(await page.evaluate(() => {
    const w = window.__arail.world;
    return w.disruptions.effectsFor(w.stopAreas().find((a) => a.id === "platform-1")).messages;
  })).toEqual(["RB 31 to Talsee about 20 min late"]);
  expect(await page.evaluate(() => window.__arail.world.clock.label())).toBe("07:38");
  await expect(page.locator("#hud")).toContainText("step 4 of 11");
  await expect(page.locator("#toast")).not.toContainText("Kept free");

  // a jump in the list of steps: the bus; its bay is kept free too
  await step(page, "Bus 270 leaves with Ada").click();
  await expect(title(page)).toHaveText("Bus 270 leaves with Ada");
  await expect(step(page, "Bus 270 leaves with Ada")).toHaveAttribute("aria-current", "step");
  expect(await storyDisruptions(page)).toEqual(["kept-free@bus-terminal-1:bay2", "kept-free@platform-1:right"]);
  // a presenter's clicker: Page Down and Page Up
  await page.keyboard.press("PageDown");
  await expect(title(page)).toHaveText("Meanwhile: RB 31 comes in");
  expect(await page.evaluate(() => window.__arail.world.clock.label())).toBe("08:00");
  await page.keyboard.press("PageDown");
  await expect(title(page)).toHaveText("Ada in Altstadt: her journey in numbers");
  await expect(page.locator("#panel-journeys .story-now")).toContainText("12 minutes late");
  expect(await storyDisruptions(page)).toEqual([]);
  await page.keyboard.press("PageDown");
  await expect(title(page)).toHaveText("Her rights as a passenger");
  await expect(page.locator("#panel-journeys .story-now")).toContainText("25 % of her fare back");
  await page.keyboard.press("PageUp");
  await expect(title(page)).toHaveText("Ada in Altstadt: her journey in numbers");

  // Start again: Ada at home, nothing kept free, the clock back at 07:30
  await page.locator("#journeysStoryRestart").click();
  await expect(title(page)).toHaveText("Ada sets off");
  expect(await storyDisruptions(page)).toEqual([]);
  expect(await page.evaluate(() => window.__arail.world.clock.label())).toBe("07:30");
  expect(errors).toEqual([]);
});

test("Camera follows: the flyover goes with Ada through the town and with her bus", async ({ page }) => {
  const errors = await open(page, STORY);
  const follow = page.locator("#journeysStoryFollow");
  await follow.click();
  await page.waitForFunction(() => window.__arail.mode === "flyover");
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  /** How far (mm) the camera's target is from where the story happens. */
  const off = () => page.evaluate(() => {
    const a = window.__arail, at = a.journeys.story.view().at, t = a.flyover.cam.target;
    return Math.round(Math.hypot(t[0] - at[0], t[1] - at[1]));
  });
  await step(page, "To the bus station").click();
  await expect.poll(off, { timeout: 15_000 }).toBeLessThan(80);
  // she walks on, out of the underpass and along the street: the camera stays with her
  await page.waitForFunction(() => window.__arail.journeys.story.progress > 0.6, null, { timeout: 20_000 });
  expect(await page.evaluate(() => window.__arail.journeys.story.adaAt().hidden)).toBe(false);
  await expect.poll(off, { timeout: 15_000 }).toBeLessThan(120);
  // the bus comes over the streets: the camera with it
  await step(page, "Bus 270 leaves with Ada").click();
  await page.waitForFunction(() => window.__arail.journeys.story.busAt(), null, { timeout: 15_000 });
  await expect.poll(off, { timeout: 15_000 }).toBeLessThan(150);
  expect(errors).toEqual([]);
});

test("the game page keeps the journeys exercise in its Journeys tab", async ({ page }) => {
  const errors = await open(page, "/game/?layout=../layouts/ebl-lab.json&layers=journeys#journeys");
  await page.waitForFunction(() => window.__arail.world.simulations.some((s) => s.constructor.type === "journeys"), null, { timeout: 30_000 });
  await expect(page.locator("#tab-journeys")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#panel-journeys h2", { hasText: "New traveller" })).toBeVisible();
  expect(await page.evaluate(() => window.__arail.world.simulations.some((s) => s.constructor.type === "journeys-story"))).toBe(false);
  expect(errors).toEqual([]);
});
