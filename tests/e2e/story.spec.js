// End-to-end tests of the app as a presentation (Chromium): the maintenance story on Bf Neustadt to
// click through (buttons, the bar of the steps, a presenter's clicker, Play, the camera that follows it),
// the reduced Terminal tab, and the game page with the games on the lab's layout.
import { expect, test } from "@playwright/test";
import { caseReady, expectCase, openCase } from "./ui.js";

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
  await expectCase(page, "infra-disruption");
  await expect(page.locator("#scenarioName")).toHaveText("A signal fails");
  await expect(title(page)).toHaveText("The station in normal service");
  expect(errors).toEqual([]);
});

test("the maintenance story: Next and Back, the bar of the steps, Restart and a clicker", async ({ page }) => {
  const errors = await open(page, STORY);
  await expectCase(page, "infra-disruption");
  await expect(title(page)).toHaveText("The station in normal service");
  await expect(page.locator("#casePanel .step-count")).toHaveText("Step 1 of 12");
  // light in text: the controls, the bar of the steps and the step it is at, no story name or hints
  await expect(page.locator("#casePanel .step-seg")).toHaveCount(12);
  await expect(page.locator("#casePanel h2")).toHaveCount(0);
  await expect(page.locator("#casePanel .hint")).toHaveCount(0);
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

  // a jump on the bar of the steps: the construction train on the renewed track
  const segment = page.locator('#casePanel .step-seg[title="The construction train arrives"]');
  await segment.click();
  await expect(title(page)).toHaveText("The construction train arrives");
  await expect(segment).toHaveClass(/\bnow\b/);
  // the bar is one slider: it says where the story is, and its arrow keys step along it
  const bar = page.getByRole("slider", { name: "Steps" });
  await expect(bar).toHaveAttribute("aria-valuetext", /^Step 9 of 12: The construction train arrives$/);
  await bar.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(title(page)).toHaveText(/^A planned renewal/);
  await expect(bar).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(title(page)).toHaveText("The construction train arrives");
  expect(await storyDisruptions(page)).toEqual(["track-closure@platform-2:right"]); // track G3

  // a presenter's clicker: Page Down and Page Up
  await page.keyboard.press("PageDown");
  await expect(title(page)).toHaveText("The old track comes out");
  await page.keyboard.press("PageUp");
  await page.keyboard.press("PageUp");
  await expect(title(page)).toHaveText(/^A planned renewal/);

  // Restart: the station in normal service, nothing disrupted
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
  // released: the step's animation runs to its end, the story stays at that step (the one it was at
  // when the click came: a click can take as long as the pause between steps on a slow machine)
  const at = await title(page).textContent();
  await page.waitForFunction(() => window.__arail.infra.story.state().progress >= 1, null, { timeout: 15_000 });
  await page.waitForTimeout(2000); // 10 simulated seconds, more than the pause between steps
  await expect(title(page)).toHaveText(at);
  expect(errors).toEqual([]);
});

test("the camera always follows the story once it runs; the bar starts it before Start and keeps the focus; a photo chosen by hand stays", async ({ page }) => {
  const errors = await open(page, STORY);
  const mode = () => page.evaluate(() => window.__arail.mode);
  // shown by its link, not started: the stage stays as it is; there is no switch for the camera
  expect(await mode()).toBe("camera");
  await expect(page.locator("#infraStoryFollow")).toHaveCount(0);
  // the keyboard on the bar before Start: the scenario starts in the flyover, the bar keeps the focus
  const bar = page.locator("#infraStoryBar");
  await bar.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => window.__arail.caseById("infra-disruption").started && window.__arail.mode === "flyover");
  await expect(title(page)).toHaveText(/fails$/);
  await expect(bar).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(title(page)).toHaveText(/^The signaller closes/);
  // a step chosen on the bar: the camera on the signal
  await page.locator('#casePanel .step-seg[title="The team repairs the signal"]').click();
  await expect(title(page)).toHaveText("The team repairs the signal");
  const off = () => page.evaluate(() => {
    const a = window.__arail, at = a.infra.story.view().at, t = a.flyover.cam.target;
    return Math.round(Math.hypot(t[0] - at[0], t[1] - at[1]));
  });
  await expect.poll(off, { timeout: 15_000 }).toBeLessThan(50);
  // the photo chosen by hand stays (the story drawn on the real table) while the story goes on
  await page.evaluate(() => window.__arail.flyover.leave());
  await page.waitForFunction(() => window.__arail.mode === "camera");
  await page.locator("#infraStoryNext").click();
  await expect(title(page)).toHaveText(/exchanges the old signal$/);
  expect(await mode()).toBe("camera");
  // the flyover again: the next step takes its camera to the story
  await page.evaluate(() => window.__arail.flyover.enter());
  await page.locator("#infraStoryNext").click();
  await expect.poll(off, { timeout: 15_000 }).toBeLessThan(80);
  expect(errors).toEqual([]);
});

test("before Start no step is the one shown: Home on the bar, or its first segment, starts the scenario", async ({ page }) => {
  const errors = await open(page, STORY);
  await expect(page.locator("#casePanel .step-seg.now")).toHaveCount(0);
  const bar = page.locator("#infraStoryBar");
  await bar.focus();
  await page.keyboard.press("Home");
  await page.waitForFunction(() => window.__arail.caseById("infra-disruption").started && window.__arail.mode === "flyover");
  await expect(title(page)).toHaveText("The station in normal service");
  await expect(bar).toBeFocused();
  await expect(page.locator("#casePanel .step-seg.now")).toHaveCount(1);
  // started, a click on the first segment (the step shown) leaves it as it is
  const t0 = await page.evaluate(() => window.__arail.infra.story.t);
  await page.locator("#casePanel .step-seg").first().click();
  expect(await page.evaluate(() => window.__arail.infra.story.t)).toBeGreaterThanOrEqual(t0);
  expect(errors).toEqual([]);
});

test("left, a story goes back to its beginning: shown again, it shows the step Start begins with", async ({ page }) => {
  const errors = await open(page, STORY);
  await page.locator("#scenarioStart").click();
  await page.waitForFunction(() => window.__arail.caseById("infra-disruption").started);
  for (let i = 0; i < 3; i++) await page.locator("#infraStoryNext").click();
  await expect(page.locator("#casePanel .step-count")).toHaveText("Step 4 of 12");
  await page.locator("#scenariosBack").click();
  await page.waitForFunction(() => !window.__arail._homing, null, { timeout: 30_000 });
  await page.evaluate(() => window.__arail.selectTab("infra-disruption"));
  await page.waitForFunction(() => window.__arail.caseById("infra-disruption").ready, null, { timeout: 30_000 });
  await expect(page.locator("#casePanel .step-count")).toHaveText("Step 1 of 12");
  await expect(page.locator("#infraStoryBack")).toBeDisabled();
  // Next starts it and goes on from there: step 2
  await page.locator("#infraStoryNext").click();
  await expect(title(page)).toHaveText(/fails$/);
  expect(errors).toEqual([]);
});

test("Start opens the flyover also when the story's first step has no place of its own", async ({ page }) => {
  const errors = await open(page, STORY);
  await page.evaluate(() => (window.__arail.infra.story.view = () => null));
  await page.locator("#scenarioStart").click();
  await page.waitForFunction(() => window.__arail.caseById("infra-disruption").started && window.__arail.mode === "flyover", null, { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test("the first segment clicked before Start starts the scenario at its first step", async ({ page }) => {
  const errors = await open(page, STORY);
  await page.locator("#casePanel .step-seg").first().click();
  await page.waitForFunction(() => window.__arail.caseById("infra-disruption").started && window.__arail.mode === "flyover");
  await expect(title(page)).toHaveText("The station in normal service");
  expect(errors).toEqual([]);
});

test("the app's case Terminal moves containers; the visits are on the game page", async ({ page }) => {
  const errors = await open(page, "/app/?layout=../layouts/container-terminal.json#terminal");
  await page.waitForFunction(() => window.__arail.terminal.sim, null, { timeout: 30_000 });
  const panel = page.locator("#casePanel");
  await expect(panel).toBeVisible();
  await expect(panel.locator("h2", { hasText: "Containers" })).toBeVisible();
  for (const name of ["Arrivals", "New arrival", "Crane jobs"]) await expect(panel.locator("h2", { hasText: name })).toHaveCount(0);
  await expect(panel).toContainText("Choose a container, in the list or on the layout, and its new place"); // no task: the hint stays
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
  await expectCase(page, "infra");
  expect(await page.evaluate(() => window.__arail.world.simulations.some((s) => s.constructor.type === "maintenance-story"))).toBe(false);
  expect(errors).toEqual([]);
});
