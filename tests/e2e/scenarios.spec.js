// The scenarios of the app's Interaction (app/interaction.js, app/cases.js): the list with its filter
// pills; the Introduction, a film of the layout that the app opens with (app/intro.js); the Sandbox
// with the modules, the infrastructure aging and the colour of people (app/sandbox.js); and
// scenarios with a task: Start sets up the stage (its module, the example it plays in, its view) and
// the task counts from then (the operations plan, a story, the loading task at the hybrid container
// train with its work orders, time and moves). A scenario shown is light in text: its name, Start or
// the bar of its task, and its panel; a story and the film have the bar of their steps in their panel.
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
/** The bar of the steps of a story or the film (story.js, stepBar): where it is, and its segments. */
const stepCount = (page) => page.locator("#casePanel .step-count");
const segments = (page) => page.locator("#casePanel .step-seg");

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
  // started: Start is gone (Restart is the film's), nothing but the film's scene, its bar and its controls
  await expect(page.locator("#scenarioStart")).toHaveCount(0);
  await expect(task(page)).toBeHidden();
  await expect(page.locator("#scenarioName")).toBeFocused();
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
  const count = (await film()).count;
  await expect(stepCount(page)).toHaveText(`Scene 4 of ${count}`);
  await expect(segments(page)).toHaveCount(count);
  await expect(segments(page).nth(3)).toHaveClass(/\bnow\b/);
  // the bar is one slider: it says the scene shown
  await expect(page.locator("#casePanel [role=slider]")).toHaveAttribute("aria-valuenow", "4");
  // the bar of the scenes jumps; the last one: back to the photo, the task is done
  await segments(page).last().click();
  expect(await film()).toMatchObject({ id: "end", mode: "camera" });
  await expect(stepCount(page)).toHaveText(`Scene ${count} of ${count}`);
  expect(await page.evaluate(() => window.__arail.caseById("intro").done)).toBe(true);
  await expect(page.locator("#introNext")).toBeDisabled();
  // back to the list: the film stops, the photo shows everything; the card says it was done
  await page.locator("#scenariosBack").click();
  expect(await film()).toMatchObject({ active: false, playing: false, fade: 1 });
  await expect(page.locator("#scenario-intro .scenario-state")).toHaveText("Done");
  await expect(page.locator("#scenario-sandbox .scenario-state")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the Introduction's Play, Next and scenes work before Start: they start it", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await open(page);
  const film = () => page.evaluate(() => {
    const app = window.__arail, c = app.caseById("intro"), p = c.panel;
    return { started: c.started, id: p.scenes[p.index].id, playing: p.playing, active: p.active };
  });
  // shown, not started: Play starts the film from its first scene, playing
  expect(await film()).toMatchObject({ started: false, active: false });
  await page.locator("#introPlay").click();
  await expect.poll(film).toMatchObject({ started: true, id: "welcome", playing: true, active: true });
  // shown again by its link, not started: Next starts it at the second scene, which waits; a scene of the list too
  await page.locator("#scenariosBack").click();
  await page.evaluate(() => window.__arail.selectTab("intro"));
  expect(await film()).toMatchObject({ started: false, active: false });
  await page.locator("#introNext").click();
  await expect.poll(film).toMatchObject({ started: true, id: "real", playing: false, active: true });
  await page.locator("#scenariosBack").click();
  await page.evaluate(() => window.__arail.selectTab("intro"));
  await segments(page).nth(2).click();
  await expect.poll(film).toMatchObject({ started: true, id: "virtual", playing: false, active: true });
  expect(errors).toEqual([]);
});

test("the Sandbox: the whole layout in the flyover, the modules, the infrastructure aging years ahead, the colour of people", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await open(page);
  await startScenario(page, "sandbox");
  expect(await page.evaluate(() => window.__arail.mode)).toBe("flyover");
  await expect(task(page)).toBeHidden(); // no task: free to look around, its controls only
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
  // leaving the Sandbox brings the station back to today (the other scenarios play in its own year)
  // and the stage back to the town's photo; the modules switched in it stay
  await page.locator("#scenariosBack").click();
  expect(await page.evaluate(() => window.__arail.world.settings.ageYears)).toBe(0);
  await page.waitForFunction(() => !window.__arail._homing && window.__arail.mode === "camera", null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__arail.layersOn())).toEqual(["sbahn", "waldhof", "infrastructure"]);
  expect(await condition()).toBeCloseTo(today, 6);
  expect(errors).toEqual([]);
});

test("Load the hybrid train: Start opens the loading task at the hybrid container train; the work orders, the time and the moves", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await open(page);
  await startScenario(page, "terminal");
  expect(await page.evaluate(() => [window.__arail.layoutUrl.replace(/.*\//, ""), window.__arail.layersOn(), window.__arail.mode, window.__arail.world.speed]))
    .toEqual(["ebl-container-train.json", ["task"], "camera", 10]);
  // light in text: the bar of the work orders with the time and the moves, no task text, no Save
  await expect(task(page)).toContainText("0 of 6");
  await expect(task(page).locator(".task-figures")).toContainText(/Time\s*\d+:\d\d min\s*Moves\s*0/);
  await expect(page.locator("#scenarioStart")).toHaveCount(0);
  await expect(page.locator("#termSave")).toHaveCount(0);
  await expect(page.locator("#termStatus")).toHaveCount(0);
  // the camera finds the real wagons and the truck by their tags in the photo
  await page.waitForFunction(() => window.__arail.terminal.sim.carriers().filter((c) => c.number != null && c.present).length >= 5, null, { timeout: 30_000 });
  // the work orders, numbered as on the stage, with what is on top of each
  const orders = page.locator(".term-orders li");
  await expect(orders).toHaveCount(6);
  await expect(orders.nth(0)).toContainText("Container train");
  await expect(orders.nth(0)).toContainText("under 2 containers");
  await expect(orders.nth(3)).toContainText("Block A");
  // the truck's container: choosing its order chooses it, with a place on the real train first
  await page.locator("#term-order-3").click();
  expect(await page.locator("#termTarget").inputValue()).toMatch(/^W[78]\|/);
  await page.locator("#termMove").click();
  await expect(task(page)).toContainText("1 of 6", { timeout: 60_000 });
  await expect(task(page).locator(".task-figures")).toContainText(/Moves\s*1/);
  await expect(orders.nth(2)).toContainText("done");
  // a buried one: the container on top is offered first; it goes to another stack
  await page.locator("#term-order-1").click();
  await expect(page.locator("#termMoveError")).toContainText("on top: move that first");
  await page.locator("#termTop").click();
  const top = await page.evaluate(() => window.__arail.caseById("terminal").panel.selected);
  expect(top).not.toBe(await page.evaluate(() => window.__arail.terminal.sim.orders()[0].container));
  await page.locator("#termMove").click();
  await expect(task(page).locator(".task-figures")).toContainText(/Moves\s*2/, { timeout: 60_000 });
  await expect(orders.nth(0)).toContainText("under 1 container");
  // Restart: the terminal as the layout has it, the time and the moves from 0
  const before = await page.evaluate(() => window.__arail.world.time - window.__arail.caseById("terminal").since);
  expect(before).toBeGreaterThan(60);
  await page.locator("#termReset").click();
  await expect(task(page)).toContainText("0 of 6");
  await expect(task(page).locator(".task-figures")).toContainText(/Moves\s*0/);
  expect(await page.evaluate(() => window.__arail.world.time - window.__arail.caseById("terminal").since)).toBeLessThan(30);
  await expect(orders.nth(0)).toContainText("under 2 containers");
  // back to the list: the scenario stops, the clock runs as before
  await page.locator("#scenariosBack").click();
  expect(await page.evaluate(() => [window.__arail.world.speed, window.__arail.caseById("terminal").started])).toEqual([2, false]);
  // started again: a speed chosen meanwhile stays when it ends; another layout ends it
  await startScenario(page, "terminal");
  expect(await page.evaluate(() => window.__arail.world.speed)).toBe(10);
  await page.evaluate(() => (window.__arail.world.speed = 5));
  await page.evaluate(() => window.__arail.openExample("neustadt"));
  await page.waitForFunction(() => /ebl-neustadt\.json$/.test(window.__arail.layoutUrl), null, { timeout: 30_000 });
  expect(await page.evaluate(() => [window.__arail.world.speed, window.__arail.caseById("terminal").started])).toEqual([5, false]);
  expect(errors).toEqual([]);
});

test("the loading task's layout shown, its scenario not started: the terminal's whole panel, the task's after Start", async ({ page }) => {
  const errors = await open(page, "/app/?layout=../layouts/ebl-container-train.json&layers=task#terminal");
  await page.waitForFunction(() => window.__arail.terminal.sim?.orders().length, null, { timeout: 30_000 });
  await expect(page.locator("#scenarioStart")).toHaveText("Start");
  // not started: no task yet, the terminal as a tool (its state, Reset terminal, Save as start state)
  await expect(page.locator("#termReset")).toHaveText("Reset terminal");
  await expect(page.locator("#termSave")).toBeVisible();
  await expect(page.locator("#termStatus")).toBeVisible();
  // started: only what the task needs
  await page.locator("#scenarioStart").click();
  await page.waitForFunction(() => window.__arail.caseById("terminal").started, null, { timeout: 30_000 });
  await expect(page.locator("#termReset")).toHaveText("Restart");
  await expect(page.locator("#termSave")).toHaveCount(0);
  await expect(page.locator("#termStatus")).toHaveCount(0);
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
  // Restart: the plan as the layout has it
  await page.locator("#infraPlanReset").click();
  await expect(task(page)).toContainText("4 of 6");
  await expect(page.locator("#plan-infra-s1-0725-track")).toHaveValue("G3");
  expect(errors).toEqual([]);
});

test("A train breaks down: Start switches on its module, the camera follows the story; the task counts its steps", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await open(page);
  await startScenario(page, "evu-disruption");
  expect(await page.evaluate(() => [window.__arail.layersOn(), window.__arail.mode])).toEqual([["operations"], "flyover"]);
  await expect(page.locator("#opsStoryFollow")).toHaveCount(0); // the camera always follows: no switch
  const n = await page.evaluate(() => window.__arail.caseById("evu-disruption").story.steps.length);
  const done = () => page.evaluate(() => window.__arail.caseById("evu-disruption").progress().done);
  // the bar of its steps is in the story's panel, nothing above it
  await expect(task(page)).toBeHidden();
  await expect(stepCount(page)).toHaveText(`Step 1 of ${n}`);
  expect(await done()).toBe(0);
  await page.locator("#opsStoryNext").click();
  await page.locator("#opsStoryNext").click();
  await expect(stepCount(page)).toHaveText(`Step 3 of ${n}`);
  expect(await done()).toBe(2);
  expect(errors).toEqual([]);
});

test("leaving a scenario for the list takes the stage back to the town, other chapters leave it running; while it runs, the photo tour has its task's photos only", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await open(page);
  const stage = () => page.evaluate(() => {
    const a = window.__arail;
    return { layout: a.layoutUrl.replace(/.*\//, ""), layers: a.layersOn(), mode: a.mode, photo: a.source?.el?.src?.replace(/.*\//, "") ?? null, stale: !!a.source?.stale };
  });
  const town = { layout: "ebl-neustadt.json", layers: ["sbahn", "waldhof"], mode: "camera", photo: "ebl-neustadt.jpg", stale: false };
  const home = () => page.waitForFunction(() => !window.__arail._homing && window.__arail.mode === "camera" && /ebl-neustadt\.jpg$/.test(window.__arail.source?.el?.src || ""), null, { timeout: 30_000 });
  expect(await stage()).toEqual(town);
  // the loading task at the hybrid train: the tour offers its photos only, from the front left and the front, and no arrows
  await startScenario(page, "terminal");
  await page.waitForFunction(() => window.__arail.tourNav.scope);
  expect(await page.locator("#tour [data-view]").evaluateAll((bs) => bs.filter((b) => !b.disabled).map((b) => b.dataset.view))).toEqual(["front-left", "front"]);
  await expect(page.locator("#tour .tour-step").first()).toBeHidden();
  await page.locator('#tour [data-view="front-left"]').click();
  await page.waitForFunction(() => window.__arail.tourNav.showing() && window.__arail.tourNav.at.perspective === "front-left", null, { timeout: 30_000 });
  // its photos are of its layout: the scenario goes on
  expect(await page.evaluate(() => [window.__arail.layoutUrl.replace(/.*\//, ""), window.__arail.caseById("terminal").started, /photo=/.test(location.search)])).toEqual(["ebl-container-train.json", true, true]);
  // ← Scenarios: back to the town with its photo, all photos again, the address without the photo
  await page.locator("#scenariosBack").click();
  await home();
  expect(await stage()).toEqual(town);
  expect(await page.evaluate(() => [window.__arail.tourNav.scope, window.__arail.tourNav.tour.parts.length > 10, location.search])).toEqual([null, true, ""]);
  await expect(page.locator("#tour .tour-step").first()).toBeVisible();
  // a scenario at the station switches its module on and flies into the flyover; its photos are Bf Neustadt's
  await startScenario(page, "infra-disruption");
  // running: its module, the flyover, no way home, and the tour of its task's photos
  const running = () => page.evaluate(() => [window.__arail.caseById("infra-disruption").started, window.__arail.layersOn(), window.__arail.mode, !!window.__arail._homing, window.__arail.tourNav.scope?.key ?? null]);
  const scope = await page.evaluate(() => window.__arail.tourNav.scope?.key ?? null);
  expect(scope).toMatch(/^infra-disruption\|/);
  const runs = [true, ["sbahn", "waldhof", "infrastructure"], "flyover", false, scope];
  expect(await running()).toEqual(runs);
  expect(await page.evaluate(() => window.__arail.tourNav.tour.parts.map((p) => p.name))).toEqual(["Neustadt", "Neustadt", "Neustadt", "Neustadt"]);
  // the other chapters leave it running, its stage and its tour as they are (a photo of another layout
  // would end it): the Overview, and the time in the corner (Settings → Simulation)
  await page.locator("#tab-overview").click();
  expect(await running()).toEqual(runs);
  await page.locator("#simTime").click();
  await expect(page.locator("#settingsView-simulate")).toHaveAttribute("aria-pressed", "true");
  expect(await running()).toEqual(runs);
  await page.locator("#tab-interaction").click();
  await expectCase(page, "infra-disruption");
  expect(await running()).toEqual(runs);
  // ← Scenarios ends it: the town as it was, without the scenario's module
  await page.locator("#scenariosBack").click();
  await home();
  expect(await stage()).toEqual(town);
  expect(await page.evaluate(() => [window.__arail.caseById("infra-disruption").started, window.__arail.tourNav.scope])).toEqual([false, null]);
  expect(errors).toEqual([]);
});

test("the stage fades from picture to picture (cuts with less motion); a scenario's flyover starts where the photo's camera stands", async ({ page }) => {
  const errors = await open(page);
  // the flyover and back: a still of the stage over it, fading out
  const toggle = () => page.evaluate(() => {
    window.__arail.flyover.toggle();
    const still = document.querySelector("#stageWrap > canvas.stage-fade");
    return still ? { opacity: Number(still.style.opacity), hidden: still.getAttribute("aria-hidden"), pointer: getComputedStyle(still).pointerEvents } : null;
  });
  expect(await toggle()).toEqual({ opacity: 1, hidden: "true", pointer: "none" });
  await page.waitForFunction(() => !document.querySelector(".stage-fade"), null, { timeout: 5000 });
  expect(await toggle()).not.toBeNull();
  await page.waitForFunction(() => !document.querySelector(".stage-fade") && window.__arail.tracker.state.H, null, { timeout: 30_000 });
  // a place shown from the photo: the flyover's flight starts at the photo's camera
  const flight = await page.evaluate(() => {
    const a = window.__arail, start = a.flyover.photoCamera();
    a.showPlace(null);
    const from = a.flyover.anim?.from;
    return start && from ? [start.yaw - from.yaw, start.pitch - from.pitch, start.distance / from.distance] : null;
  });
  expect(flight[0]).toBeCloseTo(0, 6);
  expect(flight[1]).toBeCloseTo(0, 6);
  expect(flight[2]).toBeCloseTo(1, 6);
  // with less motion the stage cuts
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => !document.querySelector(".stage-fade"), null, { timeout: 5000 });
  expect(await toggle()).toBeNull();
  expect(errors).toEqual([]);
});

test("a scenario only shown, not started, leaves the stage as it is when it is left", async ({ page }) => {
  const errors = await open(page, "/app/?layout=../layouts/ebl-lab.json");
  await expectCase(page, "intro");
  await page.evaluate(() => {
    const a = window.__arail, home = a.showHome.bind(a);
    window.__homes = 0;
    a.showHome = () => {
      window.__homes++;
      return home();
    };
  });
  await page.locator("#tab-overview").click();
  await page.locator("#tab-interaction").click();
  await page.locator("#scenariosBack").click();
  expect(await page.evaluate(() => [window.__homes, window.__arail.layoutUrl.replace(/.*\//, ""), window.__arail.mode])).toEqual([0, "ebl-lab.json", "camera"]);
  expect(errors).toEqual([]);
});
