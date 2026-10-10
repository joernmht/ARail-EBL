// Modules of a layout in the app (its layers): the lab example with its modules Rail operations,
// Infrastructure, Journeys and Container terminal, switched by clicking their boxes in the View panel
// and from Settings → Simulation, kept per layout, old links to the former example files, new objects
// in a module, and the container terminal: a layout of its own, chosen alone, and the way back. The
// app's modules Build and Disruptions, and the Settings tab with its views Simulation and Control system.
import { expect, test } from "@playwright/test";

const LAB = "/app/?layout=../layouts/ebl-lab.json";

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
const box = (page, name) => page.locator(".modules").getByRole("button", { name, exact: true });

test("the View panel switches the modules of the lab example by clicking their boxes; the choice is kept", async ({ page }) => {
  const errors = await open(page, `${LAB}#view`);
  await expect(page.locator(".modules").getByRole("button")).toHaveCount(6); // the lab's four, the app's Build and Disruptions
  const ops = box(page, "Rail operations"), infra = box(page, "Infrastructure");
  await expect(ops).toHaveAttribute("aria-pressed", "false");
  await expect(infra).toHaveAttribute("aria-pressed", "false");
  await expect(ops).toHaveAccessibleDescription(/A railway undertaking at work/);
  await expect(page.locator("#tab-ops")).toBeHidden();
  await ops.click();
  await page.waitForFunction(() => window.__arail.world.getObject("depot-1"));
  await expect(page.locator("#tab-ops")).toBeVisible();
  await expect(page.locator("#layoutName")).toContainText("Rail operations");
  await expect(box(page, "Rail operations")).toHaveAttribute("aria-pressed", "true");
  await expect(box(page, "Rail operations").locator(".module-state")).toHaveText("On");
  // two at once
  await box(page, "Infrastructure").click();
  await page.waitForFunction(() => window.__arail.world.getObject("interlocking-bf"));
  expect(await on(page)).toEqual(["operations", "infrastructure"]);
  await expect(page.locator("#tab-infra")).toBeVisible();
  // kept for this layout, without counting as a change of it
  await page.reload();
  await page.waitForFunction(() => window.__arail?.world?.getObject("depot-1"));
  expect(await on(page)).toEqual(["operations", "infrastructure"]);
  expect(await page.evaluate(() => localStorage.getItem(`arail.layout:${window.__arail.layoutUrl}`))).toBeNull();
  await box(page, "Rail operations").click();
  await page.waitForFunction(() => !window.__arail.world.getObject("depot-1"));
  await expect(page.locator("#tab-ops")).toBeHidden();
  await expect(box(page, "Rail operations")).toHaveAttribute("aria-pressed", "false");
  // with the keyboard: Enter on a focused box
  await box(page, "Journeys").focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__arail.layersOn().includes("journeys"));
  expect(await on(page)).toEqual(["infrastructure", "journeys"]);
  await expect(page.locator("#tab-journeys")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Settings → Simulation offers to switch on a module; old links open the lab with that module", async ({ page }) => {
  const errors = await open(page, `${LAB}#simulate`);
  await expect(page.locator("#opsOpenExample")).toHaveText("Switch on the module “Rail operations”");
  await page.locator("#opsOpenExample").click();
  await page.waitForFunction(() => window.__arail.operations.sim?.engine, null, { timeout: 60_000 });
  expect(await on(page)).toEqual(["operations"]);
  await page.locator("#journeysOpenExample").click();
  await page.waitForFunction(() => window.__arail.layersOn().includes("journeys"));
  expect(await on(page)).toEqual(["operations", "journeys"]);
  await page.goto("/app/?layout=../layouts/ebl-infrastructure.json#infra");
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
  await expect(page.locator("#panel-build")).toContainText("Module: Rail operations");
  expect(errors).toEqual([]);
});

test("the container terminal is a module of its own: chosen alone, the lab's modules shown there, and back", async ({ page }) => {
  const errors = await open(page, `${LAB}#view`);
  const url = () => page.evaluate(() => window.__arail.layoutUrl.replace(/.*\/layouts\//, ""));
  await box(page, "Rail operations").click();
  await page.waitForFunction(() => window.__arail.world.getObject("depot-1"));
  await expect(box(page, "Container terminal")).toHaveClass(/exclusive/);
  await expect(box(page, "Container terminal").locator(".module-state")).toHaveText("Alone");
  // chosen: the terminal's layout opens (in the flyover), the other modules are off
  await box(page, "Container terminal").click();
  await page.waitForFunction(() => /container-terminal\.json$/.test(window.__arail.layoutUrl) && window.__arail.terminal.sim);
  await expect(page.locator("#tab-terminal")).toBeVisible();
  await expect(page.locator("#tab-ops")).toBeHidden();
  expect(await page.evaluate(() => window.__arail.mode)).toBe("flyover");
  await page.locator("#tab-view").click();
  await expect(box(page, "Container terminal")).toHaveAttribute("aria-pressed", "true");
  await expect(box(page, "Rail operations")).toHaveAttribute("aria-pressed", "false");
  // another module: back to the lab with that one
  await box(page, "Infrastructure").click();
  await page.waitForFunction(() => /ebl-lab\.json$/.test(window.__arail.layoutUrl) && window.__arail.world.getObject("interlocking-bf"));
  expect(await on(page)).toEqual(["infrastructure"]);
  // the terminal again, kept over a reload; clicked once more: the lab without modules
  await box(page, "Container terminal").click();
  await page.waitForFunction(() => /container-terminal\.json$/.test(window.__arail.layoutUrl));
  await page.goto("/app/#view");
  await page.waitForFunction(() => window.__arail?.terminal?.sim);
  expect(await url()).toBe("container-terminal.json");
  await expect(box(page, "Container terminal")).toHaveAttribute("aria-pressed", "true");
  await box(page, "Container terminal").click();
  await page.waitForFunction(() => /ebl-lab\.json$/.test(window.__arail.layoutUrl) && window.__arail.world.getObject("station-1"));
  expect(await on(page)).toEqual([]);
  await expect(page.locator(".modules [aria-pressed=true] .module-name")).toHaveText(["Build"]); // only the app's Build, on by default
  // a link to the lab with the module, and a link straight to the terminal (in a new browser): its modules are the lab's
  await page.goto(`${LAB}&layers=terminal#view`);
  await page.waitForFunction(() => /container-terminal\.json$/.test(window.__arail?.layoutUrl || ""));
  await page.evaluate(() => localStorage.clear());
  await page.goto("/app/?layout=../layouts/container-terminal.json#view");
  await page.waitForFunction(() => window.__arail?.terminal?.sim);
  await expect(box(page, "Container terminal")).toHaveAttribute("aria-pressed", "true");
  // the lab from the list of layouts opens the lab, not the terminal again
  await page.selectOption("#exampleSelect", "lab");
  await page.waitForFunction(() => /ebl-lab\.json$/.test(window.__arail.layoutUrl) && window.__arail.world.getObject("station-1"));
  expect(await url()).toBe("ebl-lab.json");
  expect(errors).toEqual([]);
});

test("Disruptions is a module: its tab only while it is on; switched off, what it started stops; kept per layout", async ({ page }) => {
  const errors = await open(page, `${LAB}#view`);
  const dis = () => box(page, "Disruptions");
  await expect(dis()).toHaveAttribute("aria-pressed", "false");
  await expect(dis()).toHaveAccessibleDescription(/Delays, signal failures, cancellations/);
  await expect(page.locator("#tab-disrupt")).toBeHidden();
  // with the keyboard: the box keeps the focus
  await dis().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#tab-disrupt")).toBeVisible();
  await expect(dis()).toHaveAttribute("aria-pressed", "true");
  await expect(dis()).toBeFocused();
  await expect(dis().locator(".module-state")).toHaveText("On");
  expect(await on(page)).toEqual([]); // no layer of the layout
  // a delay and a scenario
  await page.locator("#tab-disrupt").click();
  await page.selectOption("#disType", "delay");
  await page.getByRole("button", { name: "Start: Delay" }).click();
  await page.locator(".scenario[data-id=football]").getByRole("button", { name: "Play" }).click();
  await expect.poll(() => page.evaluate(() => window.__arail.world.scenarios.current?.id)).toBe("football");
  await expect(page.locator("#panel-disrupt .disruption").first()).toContainText("Delay");
  // off: they stop, the tab goes
  await page.locator("#tab-view").click();
  await dis().click();
  await expect(page.locator("#tab-disrupt")).toBeHidden();
  expect(await page.evaluate(() => [window.__arail.world.scenarios.current, window.__arail.world.disruptions.active.length])).toEqual([null, 0]);
  // on again: kept over a reload, without counting as a change of the layout; a module of the lab, also in its terminal
  await dis().click();
  await page.reload();
  await page.waitForFunction(() => window.__arail?.world?.getObject("station-1"));
  await expect(page.locator("#tab-disrupt")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem(`arail.layout:${window.__arail.layoutUrl}`))).toBeNull();
  await box(page, "Container terminal").click();
  await page.waitForFunction(() => /container-terminal\.json$/.test(window.__arail.layoutUrl) && window.__arail.terminal.sim);
  await expect(page.locator("#tab-disrupt")).toBeVisible();
  // another layout has its own choice
  await page.evaluate(() => window.__arail.openExample("synthetic"));
  await page.waitForFunction(() => /synthetic/.test(window.__arail.layoutUrl) && window.__arail.world.objects.length);
  await expect(page.locator("#tab-disrupt")).toBeHidden();
  expect(errors).toEqual([]);
});

test("Settings holds the simulation and the control system: #simulate and #control open those views, the last one is kept", async ({ page }) => {
  const errors = await open(page, `${LAB}#control`);
  // no module on: View, Build and Settings
  expect(await page.locator(".tabs [role=tab]:not([hidden])").allTextContents()).toEqual(["View", "Build", "Settings"]);
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
  await page.locator("#tab-view").click();
  expect(new URL(page.url()).hash).toBe("#view");
  await page.locator("#tab-settings").click();
  await expect(page.locator("#settingsView-control")).toHaveAttribute("aria-pressed", "true");
  expect(new URL(page.url()).hash).toBe("#control");
  await page.goto(`${LAB}#view`);
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
  await page.goto(`${LAB}#view`);
  await page.waitForFunction(() => window.__arail?.world?.getObject("station-1"));
  await box(page, "Disruptions").click();
  await expect(page.locator("#tab-disrupt")).toBeVisible();
  // another module (the layout is applied again): still on
  await box(page, "Journeys").click();
  await page.waitForFunction(() => window.__arail.journeys.sim);
  await expect(page.locator("#tab-disrupt")).toBeVisible();
  await expect(box(page, "Disruptions")).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("Build is a module, on until switched off: off, its tab goes and placing stops; kept per layout; a link to #build switches it on", async ({ page }) => {
  const errors = await open(page, `${LAB}#build`);
  const build = () => box(page, "Build");
  await expect(page.locator("#tab-build")).toHaveAttribute("aria-selected", "true");
  await page.locator(".palette").getByRole("button", { name: /^Tree/ }).click();
  await expect(page.locator("#placing")).toBeVisible();
  await page.locator("#tab-view").click();
  await expect(build()).toHaveAttribute("aria-pressed", "true");
  await expect(build()).toHaveAccessibleDescription(/Place and edit the objects of the layout/);
  await build().click();
  await expect(page.locator("#tab-build")).toBeHidden();
  await expect(build()).toHaveAttribute("aria-pressed", "false");
  await expect(build()).toBeFocused();
  await expect(page.locator("#placing")).toBeHidden();
  expect(await page.evaluate(() => [window.__arail.editor.placing, window.__arail.tabs()])).toEqual([null, ["view", "settings"]]);
  // the arrow keys skip it
  await page.locator("#tab-view").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#tab-settings")).toBeFocused();
  // kept over a reload, without counting as a change of the layout
  await page.reload();
  await page.waitForFunction(() => window.__arail?.world?.getObject("station-1"));
  await expect(page.locator("#tab-build")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem(`arail.layout:${window.__arail.layoutUrl}`))).toBeNull();
  // another layout has its own choice
  await page.evaluate(() => window.__arail.openExample("synthetic"));
  await page.waitForFunction(() => /synthetic/.test(window.__arail.layoutUrl) && window.__arail.world.objects.length);
  await expect(page.locator("#tab-build")).toBeVisible();
  // a link to the Build tab switches it on again
  await page.goto("about:blank");
  await page.goto(`${LAB}#build`);
  await page.waitForFunction(() => window.__arail?.world?.getObject("station-1"));
  await expect(page.locator("#tab-build")).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
});
