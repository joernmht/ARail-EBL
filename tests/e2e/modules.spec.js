// Modules of a layout on the game page (its layers; the app has the same shell): the lab example with its modules Rail operations,
// Infrastructure, Journeys and Container terminal, switched by clicking their boxes in Interaction → Sandbox
// and from a case that is off, kept per layout, old links to the former example files, new objects
// in a module, and the container terminal: a layout of its own, chosen alone, and the way back. The
// app's modules Build and Disruptions, the three chapters, and Settings with its views Simulation and Control system.
import { expect, test } from "@playwright/test";
import { caseReady, expectCase, moduleBox, openCase, openModules } from "./ui.js";

const LAB = "/game/?layout=../layouts/ebl-lab.json";

function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

async function open(page, path) {
  const errors = trackErrors(page);
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.world?.getObject("station-1"));
  return errors;
}

const on = (page) => page.evaluate(() => window.__arail.layersOn());
const box = moduleBox;

test("Interaction → Sandbox switches the modules of the lab example by clicking their boxes; the choice is kept (#modules opens it)", async ({ page }) => {
  const errors = await open(page, `${LAB}#modules`);
  await expect(page.locator(".modules").getByRole("button")).toHaveCount(7); // the lab's five, the app's Build and Disruptions
  const ops = box(page, "Rail operations"), infra = box(page, "Infrastructure");
  await expect(ops).toHaveAttribute("aria-pressed", "false");
  await expect(infra).toHaveAttribute("aria-pressed", "false");
  await expect(ops).toHaveAccessibleDescription(/A railway undertaking at work/);
  expect(await caseReady(page, "ops")).toBe(false);
  await ops.click();
  await page.waitForFunction(() => window.__arail.world.getObject("depot-1"));
  expect(await caseReady(page, "ops")).toBe(true);
  await expect(page.locator("#layoutName")).toContainText("Rail operations");
  await expect(box(page, "Rail operations")).toHaveAttribute("aria-pressed", "true");
  // two at once
  await box(page, "Infrastructure").click();
  await page.waitForFunction(() => window.__arail.world.getObject("interlocking-bf"));
  expect(await on(page)).toEqual(["operations", "infrastructure"]);
  expect(await caseReady(page, "infra")).toBe(true);
  // kept for this layout, without counting as a change of it
  await page.reload();
  await page.waitForFunction(() => window.__arail?.world?.getObject("depot-1"));
  expect(await on(page)).toEqual(["operations", "infrastructure"]);
  expect(await page.evaluate(() => localStorage.getItem(`arail.layout:${window.__arail.layoutUrl}`))).toBeNull();
  await box(page, "Rail operations").click();
  await page.waitForFunction(() => !window.__arail.world.getObject("depot-1"));
  expect(await caseReady(page, "ops")).toBe(false);
  await expect(box(page, "Rail operations")).toHaveAttribute("aria-pressed", "false");
  // with the keyboard: Enter on a focused box
  await box(page, "Journeys").focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__arail.layersOn().includes("journeys"));
  expect(await on(page)).toEqual(["infrastructure", "journeys"]);
  expect(await caseReady(page, "journeys")).toBe(true);
  expect(errors).toEqual([]);
});

test("a case whose module is off offers to switch it on; old links open the lab with that module", async ({ page }) => {
  const errors = await open(page, `${LAB}#ops`);
  await expectCase(page, "ops");
  await expect(page.locator("#caseOn")).toHaveText("Switch on “Rail operations”");
  await page.locator("#caseOn").click();
  await page.waitForFunction(() => window.__arail.operations.sim?.engine, null, { timeout: 60_000 });
  expect(await on(page)).toEqual(["operations"]);
  await openCase(page, "journeys");
  await page.locator("#caseOn").click();
  await page.waitForFunction(() => window.__arail.layersOn().includes("journeys"));
  expect(await on(page)).toEqual(["operations", "journeys"]);
  await page.goto("/game/?layout=../layouts/ebl-infrastructure.json#infra");
  await page.waitForFunction(() => window.__arail?.world?.getObject("interlocking-bf"));
  expect(await page.evaluate(() => window.__arail.layoutUrl)).toMatch(/layouts\/ebl-lab\.json$/);
  expect(await on(page)).toEqual(["infrastructure"]);
  expect(errors).toEqual([]);
});

test("Build: new objects go to the chosen module and stay with it", async ({ page }) => {
  const errors = await open(page, `${LAB}&layers=operations#build`);
  await page.selectOption("#layoutActiveLayer", "operations");
  const id = await page.evaluate(() => window.__arail.world.addObject({ type: "tree", position: [1800, -600] }).id);
  const json = await page.evaluate(() => window.__arail.world.toJSON());
  expect(json.objects.some((o) => o.id === id)).toBe(false);
  expect(json.layers.find((l) => l.id === "operations").objects.some((o) => o.id === id)).toBe(true);
  await page.evaluate((id) => window.__arail.editor.select(window.__arail.world.getObject(id)), id);
  await expect(page.locator("#casePanel")).toContainText("Module: Rail operations");
  expect(errors).toEqual([]);
});

test("the container terminal is a module of its own: chosen alone, the lab's modules shown there, and back", async ({ page }) => {
  const errors = await open(page, `${LAB}#modules`);
  const url = () => page.evaluate(() => window.__arail.layoutUrl.replace(/.*\/layouts\//, ""));
  await box(page, "Rail operations").click();
  await page.waitForFunction(() => window.__arail.world.getObject("depot-1"));
  await expect(box(page, "Container terminal")).toHaveClass(/exclusive/);
  await expect(box(page, "Container terminal").locator(".module-state")).toHaveText("Alone");
  // chosen: the terminal's layout opens (in the flyover), the other modules are off
  await box(page, "Container terminal").click();
  await page.waitForFunction(() => /container-terminal\.json$/.test(window.__arail.layoutUrl) && window.__arail.terminal.sim);
  expect(await caseReady(page, "terminal")).toBe(true);
  expect(await caseReady(page, "ops")).toBe(false);
  expect(await page.evaluate(() => window.__arail.mode)).toBe("flyover");
  await expect(box(page, "Container terminal")).toHaveAttribute("aria-pressed", "true");
  await expect(box(page, "Rail operations")).toHaveAttribute("aria-pressed", "false");
  // another module: back to the lab with that one
  await box(page, "Infrastructure").click();
  await page.waitForFunction(() => /ebl-lab\.json$/.test(window.__arail.layoutUrl) && window.__arail.world.getObject("interlocking-bf"));
  expect(await on(page)).toEqual(["infrastructure"]);
  // the terminal again, kept over a reload; clicked once more: the lab without modules
  await box(page, "Container terminal").click();
  await page.waitForFunction(() => /container-terminal\.json$/.test(window.__arail.layoutUrl));
  await page.goto("/game/?layout=../layouts/ebl-lab.json#modules");
  await page.waitForFunction(() => window.__arail?.terminal?.sim);
  expect(await url()).toBe("container-terminal.json");
  await expect(box(page, "Container terminal")).toHaveAttribute("aria-pressed", "true");
  await box(page, "Container terminal").click();
  await page.waitForFunction(() => /ebl-lab\.json$/.test(window.__arail.layoutUrl) && window.__arail.world.getObject("station-1"));
  expect(await on(page)).toEqual([]);
  await expect(page.locator(".modules [aria-pressed=true] .module-name")).toHaveText(["Build"]); // only the app's Build, on by default
  // a link to the lab with the module, and a link straight to the terminal (in a new browser): its modules are the lab's
  await page.goto(`${LAB}&layers=terminal#modules`);
  await page.waitForFunction(() => /container-terminal\.json$/.test(window.__arail?.layoutUrl || ""));
  await page.evaluate(() => localStorage.clear());
  await page.goto("/game/?layout=../layouts/container-terminal.json#modules");
  await page.waitForFunction(() => window.__arail?.terminal?.sim);
  await expect(box(page, "Container terminal")).toHaveAttribute("aria-pressed", "true");
  // the lab from the list of layouts opens the lab, not the terminal again
  await page.selectOption("#exampleSelect", "lab");
  await page.waitForFunction(() => /ebl-lab\.json$/.test(window.__arail.layoutUrl) && window.__arail.world.getObject("station-1"));
  expect(await url()).toBe("ebl-lab.json");
  expect(errors).toEqual([]);
});

test("Disruptions is a module: its tool works only while it is on; switched off, what it started stops; kept per layout", async ({ page }) => {
  const errors = await open(page, `${LAB}#modules`);
  const dis = () => box(page, "Disruptions");
  await expect(dis()).toHaveAttribute("aria-pressed", "false");
  await expect(dis()).toHaveAccessibleDescription(/Delays, signal failures, cancellations/);
  expect(await caseReady(page, "disrupt")).toBe(false);
  // with the keyboard: the box keeps the focus
  await dis().focus();
  await page.keyboard.press("Enter");
  await expect(dis()).toHaveAttribute("aria-pressed", "true");
  await expect(dis()).toBeFocused();
  expect(await caseReady(page, "disrupt")).toBe(true);
  expect(await on(page)).toEqual([]); // no layer of the layout
  // a delay and a scenario
  await openCase(page, "disrupt");
  await page.selectOption("#disType", "delay");
  await page.getByRole("button", { name: "Start: Delay" }).click();
  await page.locator(".scenario[data-id=football]").getByRole("button", { name: "Play" }).click();
  await expect.poll(() => page.evaluate(() => window.__arail.world.scenarios.current?.id)).toBe("football");
  await expect(page.locator("#casePanel .disruption").first()).toContainText("Delay");
  // off: they stop, the tool says it is off
  await openModules(page);
  await dis().click();
  expect(await caseReady(page, "disrupt")).toBe(false);
  expect(await page.evaluate(() => [window.__arail.world.scenarios.current, window.__arail.world.disruptions.active.length])).toEqual([null, 0]);
  await openCase(page, "disrupt");
  await expect(page.locator("#caseOn")).toHaveText("Switch on");
  // on again from there: kept over a reload, without counting as a change of the layout; a module of the lab, also in its terminal
  await page.locator("#caseOn").click();
  await expect(page.locator("#disType")).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => window.__arail?.world?.getObject("station-1"));
  expect(await caseReady(page, "disrupt")).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem(`arail.layout:${window.__arail.layoutUrl}`))).toBeNull();
  await openModules(page);
  await box(page, "Container terminal").click();
  await page.waitForFunction(() => /container-terminal\.json$/.test(window.__arail.layoutUrl) && window.__arail.terminal.sim);
  expect(await caseReady(page, "disrupt")).toBe(true);
  // another layout has its own choice
  await page.evaluate(() => window.__arail.openExample("neustadt"));
  await page.waitForFunction(() => /ebl-neustadt/.test(window.__arail.layoutUrl) && window.__arail.world.objects.length);
  expect(await caseReady(page, "disrupt")).toBe(false);
  expect(errors).toEqual([]);
});

test("Settings holds the simulation and the control system: #simulate and #control open those views, the last one is kept", async ({ page }) => {
  const errors = await open(page, `${LAB}#control`);
  // the three chapters, whatever the modules
  expect(await page.locator(".tabs [role=tab]:not([hidden])").allTextContents()).toEqual(["Overview", "Interaction", "Settings"]);
  await expect(page.locator("#tab-settings")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#settingsView-control")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#feedUrl")).toBeVisible();
  await page.locator("#settingsView-simulate").click();
  await expect(page.locator("#settingsView-simulate")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#timeOfDay")).toBeVisible();
  await expect(page.locator("#feedUrl")).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe("#simulate");
  // the tab opens the view chosen last, also after a reload
  await page.locator("#settingsView-control").click();
  await page.locator("#tab-overview").click();
  expect(new URL(page.url()).hash).toBe("#overview");
  await page.locator("#tab-settings").click();
  await expect(page.locator("#settingsView-control")).toHaveAttribute("aria-pressed", "true");
  expect(new URL(page.url()).hash).toBe("#control");
  await page.goto(`${LAB}#overview`);
  await page.waitForFunction(() => window.__arail?.world?.getObject("station-1"));
  await page.locator("#tab-settings").click();
  await expect(page.locator("#settingsView-control")).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("with the browser's storage blocked, the module Disruptions still switches on and stays on for the session", async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error("storage blocked"); };
    Storage.prototype.setItem = () => { throw new Error("storage blocked"); };
  });
  await page.goto(`${LAB}#modules`);
  await page.waitForFunction(() => window.__arail?.world?.getObject("station-1"));
  await box(page, "Disruptions").click();
  expect(await caseReady(page, "disrupt")).toBe(true);
  // another module (the layout is applied again): still on
  await box(page, "Journeys").click();
  await page.waitForFunction(() => window.__arail.journeys.sim);
  expect(await caseReady(page, "disrupt")).toBe(true);
  await expect(box(page, "Disruptions")).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("Build is a module, on until switched off: off, the tool says so and placing stops; kept per layout; a link to #build switches it on", async ({ page }) => {
  const errors = await open(page, `${LAB}#build`);
  const build = () => box(page, "Build");
  await expectCase(page, "build");
  await page.locator(".palette").getByRole("button", { name: /^Tree/ }).click();
  await expect(page.locator("#placing")).toBeVisible();
  await openModules(page);
  await expect(page.locator("#placing")).toBeHidden(); // another scenario shown: placing stops
  await expect(build()).toHaveAttribute("aria-pressed", "true");
  await expect(build()).toHaveAccessibleDescription(/Place and edit the objects of the layout/);
  await build().click();
  await expect(build()).toHaveAttribute("aria-pressed", "false");
  await expect(build()).toBeFocused();
  expect(await page.evaluate(() => [window.__arail.editor.placing, window.__arail.caseFor("build").ready])).toEqual([null, false]);
  // the tool says it is off; the chapters stay
  await openCase(page, "build");
  await expect(page.locator("#caseOn")).toHaveText("Switch on");
  await expect(page.locator(".palette")).toHaveCount(0);
  expect(await page.locator(".tabs [role=tab]").allTextContents()).toEqual(["Overview", "Interaction", "Settings"]);
  // kept over a reload, without counting as a change of the layout
  await page.goto(`${LAB}#modules`);
  await page.waitForFunction(() => window.__arail?.world?.getObject("station-1"));
  expect(await caseReady(page, "build")).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem(`arail.layout:${window.__arail.layoutUrl}`))).toBeNull();
  // another layout has its own choice
  await page.evaluate(() => window.__arail.openExample("neustadt"));
  await page.waitForFunction(() => /ebl-neustadt/.test(window.__arail.layoutUrl) && window.__arail.world.objects.length);
  expect(await caseReady(page, "build")).toBe(true);
  // a link to Build switches it on again
  await page.goto("about:blank");
  await page.goto(`${LAB}#build`);
  await page.waitForFunction(() => window.__arail?.world?.getObject("station-1"));
  await expectCase(page, "build");
  await expect(page.locator(".palette")).toBeVisible();
  expect(errors).toEqual([]);
});
