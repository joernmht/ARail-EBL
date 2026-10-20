// The panel's chapters and the cases of Interaction (app/interaction.js), opened as a person does:
// the chapter Interaction, the entry of the strip (a side, a tool, Modules), the tab of the case.
import { expect } from "@playwright/test";

/** Open Interaction → a case, by its id or a former tab name ("ops", "infra"); the case's tab is chosen. */
export async function openCase(page, name) {
  await page.locator("#tab-interaction").click();
  const { id, entry, side } = await page.evaluate((name) => {
    const app = window.__arail, c = app.caseFor(name);
    return { id: c.id, entry: app.interaction.entryOf(c.id), side: c.side };
  }, name);
  await page.locator(`#strip-${entry}`).click();
  if (side) await page.locator(`#case-${id}`).click();
  await expect(page.locator(`#strip-${entry}`)).toHaveAttribute("aria-selected", "true");
}

/** Open Interaction → Modules, the boxes that switch the modules on and off. */
export async function openModules(page) {
  await page.locator("#tab-interaction").click();
  await page.locator("#strip-modules").click();
  await expect(page.locator(".modules")).toBeVisible();
}

/** The box of a module in Interaction → Modules, by its name. */
export const moduleBox = (page, name) => page.locator(".modules").getByRole("button", { name, exact: true });

/** Does the layout have what a case needs (its simulation, its app module)? */
export const caseReady = (page, name) => page.evaluate((name) => !!window.__arail.caseFor(name)?.ready, name);
