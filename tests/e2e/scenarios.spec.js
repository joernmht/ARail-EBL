// The scenarios of the app's Interaction (app/interaction.js, app/cases.js): the list with its filter
// pills; the Introduction, a film of the layout that the app opens with (app/intro.js); the Sandbox
// with the modules, the infrastructure aging and the colour of people (app/sandbox.js); and
// scenarios with a task: Start sets up the stage (its module, the example it plays in, its view) and
// the task counts from then (the operations plan, a story, the hybrid container train).
import { expect, test } from "@playwright/test";
import { expectCase, startScenario } from "./ui.js";

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
  await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
  return errors;
}

const task = (page) => page.locator("#scenarioTask");

test("the app opens with the Introduction; the scenarios in a list with filter pills, the pill kept", async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator("#tab-interaction")).toHaveAttribute("aria-selected", "true");
  await expectCase(page, "intro");
  await expect(page.locator("#scenarioName")).toHaveText("Introduction");
  // shown, not started: the stage stays as it is until Start
  await expect(page.locator("#scenarioStart")).toHaveText("Start");
  expect(await page.evaluate(() => window.__arail.mode)).toBe("camera");
  await page.locator("#scenariosBack").click();
  await expect(page.locator("#scenario-intro")).toBeFocused();
  expect(await page.locator(".pill").allTextContents()).toEqual(["All", "First steps", "Infrastructure", "Railway undertaking", "Passengers", "Freight", "Tools"]);
  await expect(page.locator("#pill-all")).toHaveAttribute("aria-pressed", "true");
  expect(await page.locator(".scenario-card .scenario-name").allTextContents()).toEqual([
    "Introduction", "Sandbox", "Trains on tracks", "A signal fails", "Units and drivers", "A train breaks down", "Load the hybrid train", "A traveller's journey", "Build", "Disruptions",
  ]);
  // a card's name says its side; what it is about describes it
  await expect(page.locator("#scenario-evu-disruption")).toHaveAccessibleName("Railway undertaking A train breaks down");
  await expect(page.locator("#scenario-evu-disruption")).toHaveAccessibleDescription(/breaks down at the platform/);
  for (const [pill, names] of [
    ["explore", ["Introduction", "Sandbox"]], ["infra", ["Trains on tracks", "A signal fails"]], ["evu", ["Units and drivers", "A train breaks down", "Load the hybrid train", "A traveller's journey"]],
    ["passengers", ["A traveller's journey"]], ["freight", ["Load the hybrid train"]], ["tools", ["Build", "Disruptions"]],
  ]) {
    await page.locator(`#pill-${pill}`).click();
    await expect(page.locator(`#pill-${pill}`)).toHaveAttribute("aria-pressed", "true");
    expect(await page.locator(".scenario-card .scenario-name").allTextContents(), pill).toEqual(names);
  }
  // the list and its pill are kept over a reload
  await page.reload();
  await page.waitForFunction(() => window.__arail?.world?.objects.length);
  await expect(page.locator("#pill-tools")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".scenario-card")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("the Introduction plays as a film: the photo alone for what is real, what the app adds over it, then the flyover from scene to scene", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); // the camera goes and the photo fades at once
  const errors = await open(page);
  const film = () => page.evaluate(() => {
    const app = window.__arail, p = app.caseById("intro").panel;
    return { index: p.index, id: p.scenes[p.index].id, count: p.scenes.length, playing: p.playing, active: p.active, mode: app.mode, fade: app.fade };
  });
  await page.locator("#scenarioStart").click();
  await expect.poll(film).toMatchObject({ index: 0, id: "welcome", playing: true, active: true, mode: "camera", fade: 1 });
  await expect(page.locator("#scenarioStart")).toHaveText("Start again");
  await expect(page.locator("#introPlay")).toHaveAttribute("aria-pressed", "true");
  // it goes on by itself: what is real, the photo alone with the real things outlined
  await expect.poll(async () => (await film()).id, { timeout: 15_000 }).toBe("real");
  await page.locator("#introPlay").click(); // pause
  expect(await film()).toMatchObject({ id: "real", playing: false, mode: "camera", fade: 0 });
  await expect(page.locator(".intro-kind")).toHaveText("Real");
  await expect(page.locator(".intro-facts")).toContainText("Markers");
  // what the app adds: the photo with everything again
  await page.locator("#introNext").click();
  expect(await film()).toMatchObject({ id: "virtual", mode: "camera", fade: 1 });
  await expect(page.locator(".intro-kind")).toHaveText("Virtual");
  // then each kind of thing in the flyover
  await page.locator("#introNext").click();
  expect(await film()).toMatchObject({ id: "station", mode: "flyover" });
  await expect(task(page)).toContainText(`4 of ${(await film()).count}`);
  // the list of scenes jumps; the last one: back to the photo, the task is done
  await page.locator(".story-steps li button").last().click();
  expect(await film()).toMatchObject({ id: "end", mode: "camera" });
  await expect(task(page)).toContainText("Done!");
  await expect(page.locator("#introNext")).toBeDisabled();
  // another scenario: the film stops, the photo shows everything
  await page.locator("#scenariosBack").click();
  expect(await film()).toMatchObject({ active: false, playing: false, fade: 1 });
  expect(errors).toEqual([]);
});

test("the Sandbox: the whole layout in the flyover, the modules, the infrastructure aging years ahead, the colour of people", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await open(page);
  await startScenario(page, "sandbox");
  expect(await page.evaluate(() => window.__arail.mode)).toBe("flyover");
  await expect(task(page)).not.toContainText("Task"); // no task: free to look around
  await expect(page.locator(".modules").getByRole("button", { name: "Waldhof", exact: true })).toHaveAttribute("aria-pressed", "true");
  // aging: the module with the story of the infrastructure switched on, then the years ahead
  await page.locator("#sandboxAgeing").click();
  await page.waitForFunction(() => window.__arail.layersOn().includes("infrastructure"), null, { timeout: 30_000 });
  await expect(page.locator("#sandboxAge")).toBeVisible();
  const condition = () => page.evaluate(async () => {
    const ARail = await import("/arail/index.js");
    return ARail.overallState(window.__arail.world).groups.filter((g) => g.id.startsWith("asset:")).reduce((s, g) => s + g.mean, 0);
  });
  const today = await condition();
  await page.locator("#sandboxAge").fill("40");
  await expect(page.locator("label[for=sandboxAge]")).toContainText("In 2066: 40 years older, without renewals");
  expect(await page.evaluate(() => window.__arail.world.settings.ageYears)).toBe(40);
  expect(await condition()).toBeLessThan(today);
  // people by their mood
  await page.locator("#sandboxPeopleColour").selectOption("mood");
  expect(await page.evaluate(() => window.__arail.world.settings.peopleColour)).toBe("mood");
  expect(errors).toEqual([]);
});

test("Load the hybrid train: Start opens the hybrid container train with its photo; three containers on the real train finish the task", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await open(page);
  await startScenario(page, "terminal");
  expect(await page.evaluate(() => [window.__arail.layoutUrl.replace(/.*\//, ""), window.__arail.mode, window.__arail.world.speed])).toEqual(["ebl-container-train.json", "camera", 10]);
  await expect(task(page)).toContainText("Task: Load 3 containers onto the real container train with the crane.");
  await expect(task(page)).toContainText("0 of 3");
  await expect(task(page)).toContainText("The clock runs 10 times as fast.");
  // the camera finds the real wagons by their tags in the photo
  await page.waitForFunction(() => window.__arail.terminal.sim.carriers().filter((c) => c.number != null && c.present).length >= 5, null, { timeout: 30_000 });
  // three containers from the barge, each to a free place on the real train: chosen in the list and in "Move to"
  for (const id of ["TUDU 600023 0", "ARLU 600024 3", "EBLU 600025 2"]) {
    await page.locator("#termList button", { hasText: id }).click();
    const slot = await page.evaluate((id) => {
      const app = window.__arail, t = app.terminal.sim, to = t.targets(id).ok.find((x) => app.caseById("terminal").loads(t, x.carrier)).at;
      return `${to.carrier}|${to.bay}|${to.row ?? 0}|${to.tier ?? 0}`;
    }, id);
    await page.locator("#termTarget").selectOption(slot);
    await page.locator("#termMove").click();
  }
  await expect(task(page)).toContainText("3 of 3", { timeout: 120_000 });
  await expect(task(page)).toContainText("Done!");
  // back to the list: the scenario stops, the clock runs as before
  await page.locator("#scenariosBack").click();
  expect(await page.evaluate(() => [window.__arail.world.speed, window.__arail.caseById("terminal").started])).toEqual([2, false]);
  expect(errors).toEqual([]);
});

test("Trains on tracks: Start switches on the plan, alone, and shows the platforms; the task counts the trains without a problem", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await open(page);
  await startScenario(page, "infra-operations");
  expect(await page.evaluate(() => [window.__arail.layersOn(), window.__arail.mode])).toEqual([["plan"], "flyover"]);
  await expect(task(page)).toContainText("4 of 6");
  await page.locator("#plan-infra-s1-0725-track").selectOption("G2");
  await expect(task(page)).toContainText("5 of 6");
  // Start again: the plan as the layout has it
  await page.locator("#scenarioStart").click();
  await expect(task(page)).toContainText("4 of 6");
  await expect(page.locator("#plan-infra-s1-0725-track")).toHaveValue("G3");
  expect(errors).toEqual([]);
});

test("A train breaks down: Start switches on its module, the camera follows the story; the task counts its steps", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await open(page);
  await startScenario(page, "evu-disruption");
  expect(await page.evaluate(() => [window.__arail.layersOn(), window.__arail.mode])).toEqual([["operations"], "flyover"]);
  await expect(page.locator("#opsStoryFollow")).toHaveAttribute("aria-pressed", "true");
  const n = await page.evaluate(() => window.__arail.caseById("evu-disruption").story.steps.length);
  await expect(task(page)).toContainText(`0 of ${n}`);
  await page.locator("#opsStoryNext").click();
  await page.locator("#opsStoryNext").click();
  await expect(task(page)).toContainText(`2 of ${n}`);
  expect(errors).toEqual([]);
});
