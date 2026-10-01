// Browser tests of the German house types: the Buildings palette, placing and editing them, and
// their windows lighting up at night.
import { expect, test } from "@playwright/test";

/** Collect uncaught page errors (console noise such as blocked web fonts is ignored). */
function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function openApp(page, path = "/app/") {
  const errors = trackErrors(page);
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
  return errors;
}

/** Screen position (CSS px) of a layout point (mm). */
async function screenPoint(page, x, y) {
  return page.evaluate(([px, py]) => {
    const a = window.__arail, H = a.tracker.state.H;
    const w = H[6] * px + H[7] * py + H[8];
    const u = (H[0] * px + H[1] * py + H[2]) / w, v = (H[3] * px + H[4] * py + H[5]) / w;
    const r = a.canvas.getBoundingClientRect();
    return { x: r.left + (u * r.width) / a.canvas.width, y: r.top + (v * r.height) / a.canvas.height };
  }, [x, y]);
}

/** Warm (lit window) pixels in a box of the canvas around a layout point. */
async function warmPixels(page, x, y, z = 0) {
  return page.evaluate(([px, py, pz]) => {
    const a = window.__arail;
    a.render();
    const H = a.tracker.state.H;
    const w = H[6] * px + H[7] * py + H[8];
    const u = (H[0] * px + H[1] * py + H[2]) / w, v = (H[3] * px + H[4] * py + H[5]) / w;
    const size = 260 * a.px();
    const x0 = Math.max(0, Math.round(u - size)), y0 = Math.max(0, Math.round(v - 1.6 * size));
    const img = a.ctx.getImageData(x0, y0, Math.round(2 * size), Math.round(2 * size)).data;
    let n = 0;
    for (let i = 0; i < img.length; i += 4) if (img[i] > 230 && img[i + 1] > 190 && img[i + 2] < 190 && img[i] - img[i + 2] > 60) n++;
    return n;
  }, [x, y, z]);
}

test("buildings: place a Plattenbau, change its series and see its windows lit at night", async ({ page }) => {
  const errors = await openApp(page, "/app/#build");
  const palette = page.locator(".palette");
  await expect(palette.getByRole("heading", { name: "Buildings" })).toBeVisible();
  for (const name of ["Building", "Plattenbau", "Altbau block", "Single-family house", "Single-family estate", "Office building", "School", "Supermarket", "Workshop / factory"]) {
    await expect(palette.getByRole("button", { name: new RegExp(`^${name.replace("/", "\\/")}`) })).toBeVisible();
  }
  // the Buildings group comes right after Transport
  const headings = await palette.getByRole("heading").allTextContents();
  expect(headings.indexOf("Buildings")).toBe(headings.indexOf("Transport") + 1);

  await page.evaluate(() => {
    const w = window.__arail.world;
    for (const o of [...w.objects]) if (["building", "tree", "forest", "windmill", "area"].includes(o.type)) w.removeObject(o.id);
  });
  await palette.getByRole("button", { name: /^Plattenbau/ }).click();
  const p = await screenPoint(page, 300, 560);
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(() => window.__arail.editor.selected?.type === "plattenbau");
  const added = await page.evaluate(() => {
    const o = window.__arail.editor.selected;
    return { id: o.id, spec: o.spec, height: o.heightMM(), residents: o.capacity().residents, entrances: o.entrances().length };
  });
  expect(added.spec.series).toBe("wbs70");
  expect(added.spec.position[0]).toBeCloseTo(300, -1);
  expect(added.entrances).toBe(4);
  expect(added.residents).toBeGreaterThan(50);
  await page.selectOption(`#obj-${added.id}-series`, "wbs70-11");
  await expect.poll(() => page.evaluate(() => window.__arail.editor.selected.spec.series)).toBe("wbs70-11");
  const taller = await page.evaluate(() => window.__arail.editor.selected.heightMM());
  expect(taller).toBeGreaterThan(1.6 * added.height);
  const sections = page.locator(`#obj-${added.id}-sections`);
  await sections.fill("2");
  await sections.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__arail.editor.selected.entrances().length)).toBe(2);

  // by day the windows are grey; at night they light up warm (the camera image gets darker)
  const lit = () => page.evaluate(() => window.__arail.editor.selected.geometry.windows.filter((w) => w.d.emissive).length);
  await page.evaluate(() => {
    const w = window.__arail.world;
    w.clock.set("12:00");
    w.clock.frozen = true;
  });
  await warmPixels(page, 300, 560);
  expect(await lit()).toBe(0);
  await page.evaluate(() => window.__arail.world.clock.set("21:30"));
  expect(await warmPixels(page, 300, 560)).toBeGreaterThan(200);
  expect(await lit()).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test("buildings: draw a single-family estate as an outline", async ({ page }) => {
  const errors = await openApp(page, "/app/#build");
  await page.locator(".palette").getByRole("button", { name: /^Single-family estate/ }).click();
  for (const [x, y] of [[850, 250], [1450, 266], [1441, 616], [841, 600]]) {
    const q = await screenPoint(page, x, y);
    await page.mouse.click(q.x, q.y);
  }
  await page.locator("#placing").getByRole("button", { name: "Finish" }).click();
  await page.waitForFunction(() => window.__arail.editor.selected?.type === "house-estate");
  const estate = await page.evaluate(() => {
    const o = window.__arail.editor.selected;
    return { id: o.id, points: o.spec.points.length, houses: o.geometry.houses.length, plots: o.geometry.plots.length, entrances: o.entrances().length };
  });
  expect(estate.points).toBe(4);
  expect(estate.plots).toBeGreaterThanOrEqual(3);
  expect(estate.houses).toBeGreaterThan(0);
  expect(estate.entrances).toBe(estate.houses);
  await page.selectOption(`#obj-${estate.id}-mix`, "bungalow");
  await expect.poll(() => page.evaluate(() => window.__arail.editor.selected.geometry.houses.every((h) => h.style === "bungalow"))).toBe(true);
  expect(errors).toEqual([]);
});
