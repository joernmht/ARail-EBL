// Railway systems of the track sections (rail/systems.js): View → Colour the tracks by, its legend,
// the card of a track, and the lab example's module Border station.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const LAB = "/app/?layout=../layouts/ebl-lab.json&layers=border";

async function openApp(page, path = LAB) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.lastView, null, { timeout: 30_000 });
  return errors;
}

test("View → Colour the tracks by: the tracks of the border station by traction power, with a legend; the choice is kept", async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator("#layoutName")).toContainText("Border station");
  await expect(page.locator("#optTrackSystems")).toHaveValue("");
  await page.locator("#optTrackSystems").selectOption("power");
  const legend = page.getByRole("list", { name: "Colours of the tracks" });
  await expect(legend).toContainText("15 kV 16.7 Hz AC");
  await expect(legend).toContainText("2 tracks");
  await expect(legend).toContainText("3 kV DC");
  expect(await page.evaluate(() => window.__arail.world.settings.trackSystems)).toBe("power");
  // by country
  await page.locator("#optTrackSystems").selectOption("country");
  await expect(legend).toContainText("Czechia");
  await page.reload();
  await page.waitForFunction(() => window.__arail?.lastView);
  await expect(page.locator("#optTrackSystems")).toHaveValue("country");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).include("#panel").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  expect(errors).toEqual([]);
});

test("the card of a track lists its systems; Build offers them per track", async ({ page }) => {
  const errors = await openApp(page);
  // a point on track G3, away from the platform and its trains
  const at = await page.evaluate(() => {
    const app = window.__arail, view = app.lastView, c = app.canvas, r = c.getBoundingClientRect();
    const t = app.world.getObject("track-g3").geometry.points, x = t[0][0] + 0.88 * (t[1][0] - t[0][0]), y = t[0][1] + 0.88 * (t[1][1] - t[0][1]);
    const q = view.project(x, y, 0);
    return { x: r.left + (q[0] * r.width) / c.width, y: r.top + (q[1] * r.height) / c.height, pixel: q };
  });
  const hit = await page.evaluate((q) => window.__arail.world.pick(window.__arail.lastView, q)?.key, at.pixel);
  test.skip(hit !== "object:track-g3", `something stands on the track there (${hit})`);
  await page.mouse.click(at.x, at.y);
  const card = page.locator("#infoCard");
  await expect(card).toContainText("Systems");
  await expect(card).toContainText("Traction power: 3 kV DC (usual in CZ)");
  await expect(card).toContainText("Infrastructure manager: Správa železnic (usual in CZ)");
  // Build: the systems as fields of the track
  await page.keyboard.press("Escape");
  await page.locator("#tab-build").click();
  await page.evaluate(() => window.__arail.editor.select(window.__arail.world.getObject("track-g3")));
  await expect(page.locator("#obj-track-g3-country")).toHaveValue("CZ");
  await expect(page.locator("#obj-track-g3-power")).toHaveValue("");
  await page.locator("#obj-track-g3-etcs").selectOption("l2");
  expect(await page.evaluate(() => window.__arail.world.getObject("track-g3").spec.etcs)).toBe("l2");
  expect(errors).toEqual([]);
});

test("may this train run here: RE 1 at the Czech track G3; Show where it may run colours the tracks", async ({ page }) => {
  const errors = await openApp(page);
  await page.evaluate(() => window.__arail.world.services.call("platform-1:right", { line: "RE 1" }));
  await page.waitForFunction(() => window.__arail.world.services.vehicles().some((v) => v.line === "RE 1" && v.dock.track === "G3" && v.phase === "dwelling"), null, { timeout: 20_000 });
  // its card, as a tap on it opens it
  await page.evaluate(async () => {
    const ARail = await import("/arail/index.js");
    const app = window.__arail;
    const hit = ARail.movingPickables(app.world, app.lastView).find((p) => p.kind === "train" && p.ref.line === "RE 1" && p.ref.dock.track === "G3");
    app.inspector.show(hit);
  });
  const card = page.locator("#infoCard");
  await expect(card).toBeVisible();
  await expect(card.locator(".info-status")).toContainText("may not run on this track");
  await expect(card).toContainText("May it run here?");
  await expect(card).toContainText("Track G1: yes");
  await expect(card).toContainText(/Track G3: no · .*Not authorised in CZ/);
  await card.getByRole("button", { name: "Show where it may run" }).click();
  expect(await page.evaluate(() => window.__arail.world.settings.trackSystems)).toBe("compatibility");
  // the View panel: the choice and its legend
  await page.locator("#tab-view").click();
  await expect(page.locator("#optTrackSystems")).toHaveValue("compatibility");
  const legend = page.getByRole("list", { name: "Colours of the tracks" });
  await expect(legend).toContainText("RE 1 may run");
  await expect(legend).toContainText("RE 1 may not run");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).include("#panel").include("#infoCard").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  // not kept for the next session: it belongs to the train
  await page.reload();
  await page.waitForFunction(() => window.__arail?.lastView);
  await expect(page.locator("#optTrackSystems")).toHaveValue("");
  expect(errors).toEqual([]);
});
