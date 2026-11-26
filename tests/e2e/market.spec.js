// The lab example's market square: the modules Wintermarkt and Market visitors switched on by
// their boxes, the market drawn in the flyover with its visitors, the card of a stall in German.
import { expect, test } from "@playwright/test";
import { moduleBox, openModules, viewTo } from "./ui.js";

const LAB = "/app/?layout=../layouts/ebl-lab.json";

test("the Wintermarkt and its visitors: switched on in Sandbox, drawn in the flyover, a stall's card", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(LAB);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${LAB}&lang=de`);
  await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
  await openModules(page);
  for (const name of ["Wintermarkt", "Marktbesucher"]) {
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

test("Bf Neustadt: the Wintermarkt is on by default, also where a choice of modules was saved before it came", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const url = "/app/?layout=../layouts/ebl-neustadt.json";
  const on = () => page.evaluate(() => window.__arail.layersOn());
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  await page.waitForFunction(() => window.__arail?.world?.objects?.length, null, { timeout: 30_000 });
  expect(await on()).toEqual(["sbahn", "waldhof", "wintermarkt", "market-visitors"]);
  // a choice saved before the market came (S-Bahn switched off, the hump yard on), without the ids of then
  await page.evaluate((key) => {
    localStorage.clear();
    localStorage.setItem(key, JSON.stringify(["waldhof", "hump"]));
  }, `arail.layers:${new URL("/layouts/ebl-neustadt.json", page.url()).href}`);
  await page.reload();
  await page.waitForFunction(() => window.__arail?.world?.objects?.length, null, { timeout: 30_000 });
  expect(await on()).toContain("wintermarkt");
  expect(await on()).toContain("market-visitors");
  expect(await on()).toContain("hump");
  expect(await on()).not.toContain("sbahn"); // switched off before: it stays off
  // switched off by hand, it stays off
  await page.evaluate(() => window.__arail.setLayers(window.__arail.layersOn().filter((id) => id !== "wintermarkt" && id !== "market-visitors")));
  await page.reload();
  await page.waitForFunction(() => window.__arail?.world?.objects?.length, null, { timeout: 30_000 });
  expect(await on()).not.toContain("wintermarkt");
  expect(errors).toEqual([]);
});

test("Bf Neustadt: an example brings back no module switched off by hand; a choice of Breakdown alone gets the Wintermarkt when it is left", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const url = "/app/?layout=../layouts/ebl-neustadt.json";
  const on = () => page.evaluate(() => window.__arail.layersOn());
  const loaded = () => page.waitForFunction(() => window.__arail?.world?.objects?.length, null, { timeout: 30_000 });
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  await loaded();
  // the market switched off by hand, then Examples → Hump yard: the hump yard on, the market still off
  await page.evaluate(() => window.__arail.setLayers(window.__arail.layersOn().filter((id) => id !== "wintermarkt" && id !== "market-visitors")));
  await page.evaluate(() => window.__arail.openExample("hump"));
  await expect.poll(on).toEqual(["sbahn", "waldhof", "hump"]);
  // and so for Bf Neustadt from then on
  await page.goto(url);
  await loaded();
  expect(await on()).toEqual(["sbahn", "waldhof", "hump"]);
  // Breakdown (an exclusive module) alone, chosen before the market came and before the ids were kept:
  // alone, also on the next visit
  await page.evaluate((key) => {
    localStorage.clear();
    localStorage.setItem(key, JSON.stringify(["operations"]));
  }, `arail.layers:${new URL("/layouts/ebl-neustadt.json", page.url()).href}`);
  for (let i = 0; i < 2; i++) {
    await page.reload();
    await loaded();
    expect(await on()).toEqual(["operations"]);
  }
  // left for S-Bahn: the market comes with it
  await page.evaluate(() => window.__arail.toggleModule("sbahn"));
  await expect.poll(on).toEqual(["sbahn", "wintermarkt", "market-visitors"]);
  // the Plan (an exclusive module) chosen last, then Examples → Hump yard: the hump yard beside the town's own
  // modules, not alone
  await page.evaluate(() => window.__arail.setLayers(["plan"]));
  await expect.poll(on).toEqual(["plan"]);
  await page.evaluate(() => window.__arail.openExample("hump"));
  await expect.poll(on).toEqual(["sbahn", "waldhof", "wintermarkt", "market-visitors", "hump"]);
  expect(errors).toEqual([]);
});

test("the lab: what was saved under the old id striezelmarkt (a choice, an edited layout, an address) gets the Wintermarkt", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const on = () => page.evaluate(() => window.__arail.layersOn());
  const loaded = () => page.waitForFunction(() => window.__arail?.world?.objects?.length, null, { timeout: 30_000 });
  await page.goto(LAB);
  await loaded();
  const file = new URL("/layouts/ebl-lab.json", page.url()).href;
  const ids = await page.evaluate(() => window.__arail.world.layers().map((l) => l.id));
  const old = ids.map((id) => (id === "wintermarkt" ? "striezelmarkt" : id));
  // a choice kept with the old id: the market on, although it is off by default in the lab
  await page.evaluate(({ file, old }) => {
    localStorage.clear();
    localStorage.setItem(`arail.layers:${file}`, JSON.stringify(["striezelmarkt", "market-visitors"]));
    localStorage.setItem(`arail.layersKnown:${file}`, JSON.stringify(old));
  }, { file, old });
  await page.reload();
  await loaded();
  expect(await on()).toEqual(["wintermarkt", "market-visitors"]);
  expect(await page.evaluate((file) => JSON.parse(localStorage.getItem(`arail.layers:${file}`)), file)).toEqual(["wintermarkt", "market-visitors"]);
  // a layout saved with edits under the old id: the market is there, its gates read Wintermarkt
  await page.evaluate(async ({ file }) => {
    const json = await (await fetch(file)).json();
    const layer = json.layers.find((l) => l.id === "wintermarkt");
    layer.id = "striezelmarkt";
    layer.name = "Striezelmarkt";
    for (const o of layer.objects) if (o.type === "market-gate") o.text = "Striezelmarkt";
    localStorage.setItem(`arail.layout:${file}`, JSON.stringify(json));
    localStorage.setItem(`arail.layers:${file}`, JSON.stringify(["striezelmarkt", "market-visitors"]));
  }, { file });
  await page.reload();
  await loaded();
  expect(await on()).toEqual(["wintermarkt", "market-visitors"]);
  expect(await page.evaluate(() => window.__arail.world.getObject("market-gate")?.spec.text)).toBe("Wintermarkt");
  // an address with the old ids: the module and the scenario under their new ones
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${LAB}&layers=striezelmarkt&scenario=striezelmarkt-evening`);
  await loaded();
  expect(await on()).toContain("wintermarkt");
  // the scenario has one step: played, it has set 6 December and is over at once
  await expect.poll(() => page.evaluate(() => window.__arail.world.clock.monthDay()), { timeout: 10_000 }).toEqual({ month: 12, day: 6 });
  await expect(page.getByText("has no scenario")).toHaveCount(0);
  expect(errors).toEqual([]);
});
