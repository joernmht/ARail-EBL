// Hover and click on everything (app/inspect.js): a tooltip for what the mouse points at, an info
// card for what was tapped, in the camera view and the flyover, with the keyboard, and accessible.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function openApp(page, path = "/app/") {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.lastView, null, { timeout: 30_000 });
  return errors;
}

/**
 * Where (page px) something is seen now: a layout object by its id, or the first pickable of a kind
 * ("train", "person", …) in view.
 */
async function spot(page, { id = null, kind = null }) {
  return page.evaluate(async ({ id, kind }) => {
    const ARail = await import("/arail/index.js");
    const app = window.__arail, view = app.lastView, c = app.canvas, r = c.getBoundingClientRect();
    const toPage = (q) => q && q[0] > 0 && q[1] > 0 && q[0] < c.width && q[1] < c.height ? { x: r.left + (q[0] * r.width) / c.width, y: r.top + (q[1] * r.height) / c.height } : null;
    if (id) {
      const o = app.world.getObject(id), a = o.anchorPoint();
      return toPage(view.project(a[0], a[1], (o.pickHeight?.() || 0) * 0.6));
    }
    for (const p of ARail.movingPickables(app.world, view)) {
      if (p.kind !== kind) continue;
      const o = p.outline, x = o.reduce((s, q) => s + q[0], 0) / o.length, y = o.reduce((s, q) => s + q[1], 0) / o.length;
      const at = toPage(view.project(x, y, ((p.z0 ?? 0) + (p.z1 ?? 0)) / 2));
      if (at && app.world.pick(view, [((at.x - r.left) * c.width) / r.width, ((at.y - r.top) * c.height) / r.height])?.key === p.key) return { ...at, key: p.key };
    }
    return null;
  }, { id, kind });
}

test("the camera view: a tooltip on hover, the card on a click, Escape closes it", async ({ page }) => {
  const errors = await openApp(page);
  // a train at platform 1 (the timetable may have none there right now)
  await page.evaluate(() => window.__arail.world.services.call("platform-1"));
  await page.waitForFunction(() => window.__arail.world.services.vehicles().some((v) => v.dock.area.owner.id === "platform-1" && v.phase === "dwelling"), null, { timeout: 20_000 });
  const train = await spot(page, { kind: "train" });
  expect(train).not.toBeNull();
  await page.mouse.move(train.x, train.y);
  await expect(page.locator("#tooltip")).toBeVisible();
  await expect(page.locator("#tooltip")).toContainText(/Train|RE|RB|S /);
  await expect(page.locator("#stage")).toHaveClass(/pointable/);
  await page.mouse.click(train.x, train.y);
  const card = page.locator("#infoCard");
  await expect(card).toBeVisible();
  await expect(card.locator("dl").first()).toContainText("Stop");
  await expect(card.locator("dl").first()).toContainText("Delay");
  // its train data (the lab example's consists of RE 1 and RB 33)
  await expect(card).toContainText("Train data");
  await expect(card).toContainText("Brake percentage");
  await expect(card.getByRole("list", { name: "Vehicles in order" }).locator("li").first()).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).include("#infoCard").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await expect(page.locator("#tooltip")).toBeHidden(); // no tooltip over its own card
  await expect(page.locator("#infoLive")).not.toBeEmpty(); // said to screen readers
  // the card follows the live state
  const status = await card.locator(".info-status").innerText();
  expect(status.length).toBeGreaterThan(3);
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  // a building: what it is used for and the people inside
  const house = await spot(page, { id: "station-1" });
  if (house) {
    await page.mouse.click(house.x, house.y);
    await expect(card).toContainText("Station building");
    await expect(card.locator("dl").first()).toContainText("Occupancy");
    await card.getByRole("button", { name: "Close the info card" }).click();
    await expect(card).toBeHidden();
  }
  expect(errors).toEqual([]);
});

test("Build keeps its taps: a click selects for editing and opens no card; the tooltip still shows", async ({ page }) => {
  const errors = await openApp(page, "/app/#build");
  const house = await spot(page, { id: "station-1" });
  expect(house).not.toBeNull();
  await page.mouse.move(house.x, house.y);
  await expect(page.locator("#tooltip")).toContainText("Station building");
  await page.mouse.click(house.x, house.y);
  await expect(page.locator("#panel-build h2", { hasText: "Selected:" })).toBeVisible();
  await expect(page.locator("#infoCard")).toBeHidden();
  expect(errors).toEqual([]);
});

test("the flyover: a tap opens the card of a stop with its next buses; Enter at the cross with the keyboard", async ({ page }) => {
  const errors = await openApp(page);
  await page.locator("#btnFlyover").click();
  await page.waitForFunction(() => window.__arail.mode === "flyover" && !window.__arail.flyover.anim);
  await page.waitForTimeout(300);
  const stop = await spot(page, { id: "bus-stop-altmarkt" });
  expect(stop).not.toBeNull();
  await page.mouse.click(stop.x, stop.y);
  const card = page.locator("#infoCard");
  await expect(card).toBeVisible();
  // the stop itself, or a bus or person standing at it
  await expect(card).toContainText(/Altmarkt|Bus|Passenger/);
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  // keyboard: Enter on the stage shows the card of what is at the cross in the middle
  await page.locator("#stage").focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(page.locator("#infoLive")).not.toBeEmpty();
  expect(await page.evaluate(() => document.activeElement === window.__arail.canvas)).toBe(true); // the arrows go on moving the view
  expect(errors).toEqual([]);
});

for (const scheme of ["light", "dark"]) {
  test(`the tooltip and the info card have no accessibility violations (${scheme} mode)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page);
    const house = await spot(page, { id: "station-1" });
    await page.mouse.click(house.x, house.y);
    await expect(page.locator("#infoCard")).toBeVisible();
    await page.mouse.move(house.x + 2, house.y + 2);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).include("#stageWrap").analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`)).toEqual([]);
  });
}
