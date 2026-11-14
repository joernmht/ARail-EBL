// The lab example's market square: the modules Striezelmarkt and Market visitors switched on by
// their boxes, the market drawn in the flyover with its visitors, the card of a stall in German.
import { expect, test } from "@playwright/test";
import { moduleBox, openModules, viewTo } from "./ui.js";

const LAB = "/app/?layout=../layouts/ebl-lab.json";

test("the Striezelmarkt and its visitors: switched on in Sandbox, drawn in the flyover, a stall's card", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(LAB);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${LAB}&lang=de`);
  await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
  await openModules(page);
  for (const name of ["Striezelmarkt", "Marktbesucher"]) {
    await moduleBox(page, name).click();
    await expect(moduleBox(page, name)).toHaveAttribute("aria-pressed", "true");
  }
  await page.waitForFunction(() => window.__arail.world.getObject("christmas-tree") && window.__arail.world.simulations.some((s) => s.constructor.type === "market"));
  await viewTo(page, "flyover");
  const state = await page.evaluate(() => {
    const a = window.__arail, w = a.world;
    w.setTime("18:30");
    const f = a.flyover;
    f.anim = null;
    f.cam.set({ target: [-560, -780], distance: 1400, yaw: Math.PI / 2, pitch: (50 * Math.PI) / 180 });
    const market = w.simulations.find((s) => s.constructor.type === "market");
    for (let i = 0; i < 600; i++) w.step(0.1);
    a.render();
    const stall = w.getObject("stall-1");
    const card = w.card({ key: "object:stall-1", kind: "object", label: stall.name, outline: stall.footprint(), owner: stall, ref: stall });
    return { visitors: market.visitors.length, sold: Object.values(market.marketStats().sold).reduce((x, y) => x + y, 0), card };
  });
  expect(state.visitors).toBeGreaterThan(100);
  expect(state.sold).toBeGreaterThan(0);
  expect(state.card.title).toBe("Glühwein");
  expect(state.card.rows.map((r) => r[0])).toEqual(expect.arrayContaining(["Sells", "Queue now", "Takings today"]));
  expect(errors).toEqual([]);
});
