// The panel's chapters and the scenarios of Interaction (app/interaction.js), opened as a person
// does: the chapter Interaction, the list of scenarios with its filter pills, a scenario's card
// (which starts it); or a scenario shown without starting it, as a link to it does.
import { expect } from "@playwright/test";

/** Open Interaction → the list of scenarios. */
export async function openList(page) {
  await page.locator("#tab-interaction").click();
  if (await page.locator("#scenariosBack").isVisible()) await page.locator("#scenariosBack").click();
  await expect(page.locator(".scenario-list")).toBeVisible();
}

/**
 * Open Interaction → a scenario by its id or a former tab name ("ops", "infra", "modules"), shown
 * without starting it (as a link to it does: its view and task wait for Start).
 */
export async function openCase(page, name) {
  await page.locator("#tab-interaction").click();
  const id = await page.evaluate((name) => {
    const app = window.__arail, c = app.caseFor(name);
    app.selectTab(c.id);
    return c.id;
  }, name);
  await expectCase(page, id);
}

/** Start a scenario from the list (all pills): its card; resolves once it has started. */
export async function startScenario(page, id) {
  await openList(page);
  await page.locator("#pill-all").click();
  await page.locator(`#scenario-${id}`).click();
  await page.waitForFunction((id) => window.__arail.caseById(id)?.started, id, { timeout: 30_000 });
  await expectCase(page, id);
}

/** The scenario shown in Interaction is this one. */
export const expectCase = (page, id) => expect(page.locator("#panel-interaction .interaction")).toHaveAttribute("data-case", id);

/** Open Interaction → Sandbox, with the boxes that switch the modules on and off. */
export async function openModules(page) {
  await openCase(page, "sandbox");
  await expect(page.locator(".modules")).toBeVisible();
}

/** The box of a module in Interaction → Sandbox, by its name. */
export const moduleBox = (page, name) => page.locator(".modules").getByRole("button", { name, exact: true });

/** Does the layout have what a case needs (its simulation, its app module)? */
export const caseReady = (page, name) => page.evaluate((name) => !!window.__arail.caseFor(name)?.ready, name);

/** Click the speed button in the stage's upper right corner until it shows this speed ("30×"). */
export async function speedTo(page, label) {
  const speed = page.locator("#simSpeed");
  for (let i = 0; i < 6 && (await speed.textContent()) !== label; i++) await speed.click();
  await expect(speed).toHaveText(label);
}

/** Click the view button of the stage until it shows this view (photo, flyover, map, 3d; once round at most). */
export async function viewTo(page, view) {
  const button = page.locator("#btnView");
  for (let i = 0; i < 4 && (await button.getAttribute("data-view")) !== view; i++) await button.click();
  await expect(button).toHaveAttribute("data-view", view);
}
