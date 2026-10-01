// Browser tests of streets, bus stops and bus lines: drawing a street that snaps to another one,
// placing bus stops on it, picking them for a bus line, and a bus serving the stops.
import AxeBuilder from "@axe-core/playwright";
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

async function tap(page, x, y) {
  const p = await screenPoint(page, x, y);
  await page.mouse.click(p.x, p.y);
}

test("streets: draw a street, place bus stops and a bus line; a bus serves the stops", async ({ page }) => {
  const errors = await openApp(page, "/app/#build");
  await page.evaluate(() => {
    const w = window.__arail.world;
    w.simulations = w.simulations.filter((s) => s.constructor.type !== "road-traffic");
    w.paused = true;
  });
  const palette = page.locator(".palette");
  for (const name of ["Street", "Bus stop", "Bus line"]) await expect(palette.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();

  // two streets on the far part of the lab table (the example town is in front of it); the second
  // one starts near the end of the first: its first point snaps onto that end
  const count = (type) => page.evaluate((t) => window.__arail.world.objects.filter((o) => o.type === t).length, type);
  const roads0 = await count("road"), stops0 = await count("bus-stop");
  const streets = [];
  for (const points of [[[100, 300], [400, 290], [700, 300]], [[703, 302], [1000, 330]]]) {
    await palette.getByRole("button", { name: /^Street/ }).click();
    for (const [x, y] of points) await tap(page, x, y);
    await page.locator("#placing").getByRole("button", { name: "Finish" }).click();
    await page.waitForFunction((n) => window.__arail.world.objects.filter((o) => o.type === "road").length === n, roads0 + streets.length + 1);
    streets.push(await page.evaluate(() => window.__arail.editor.selected.spec));
  }
  expect(streets[0].points.length).toBe(3);
  expect(streets[1].points[0]).toEqual(streets[0].points[2]);
  const joined = await page.evaluate(() => {
    const net = window.__arail.world.network();
    const n = net.nodes.find((x) => Math.hypot(x.pos[0] - 700, x.pos[1] - 300) < 3);
    return n ? [...new Set(n.edges.map((id) => net.edges[id]).filter((e) => e.kind === "road").map((e) => e.road))].sort() : null;
  });
  expect(joined).toEqual(streets.map((x) => x.id).sort());

  // two bus stops next to the streets, on both sides
  const stops = [];
  for (const [x, y] of [[250, 250], [900, 270]]) {
    await palette.getByRole("button", { name: /^Bus stop/ }).click();
    await tap(page, x, y);
    await page.waitForFunction((n) => window.__arail.world.objects.filter((o) => o.type === "bus-stop").length === n, stops0 + stops.length + 1);
    const id = await page.evaluate(() => window.__arail.editor.selected.id);
    await page.selectOption(`#obj-${id}-side`, "both");
    await expect.poll(() => page.evaluate(() => window.__arail.world.stopAreas().filter((a) => a.owner === window.__arail.editor.selected).length)).toBe(2);
    stops.push(id);
  }

  // a bus line: tap the stops in order (other taps are ignored), then Finish
  await palette.getByRole("button", { name: /^Bus line/ }).click();
  await expect(page.locator("#placing")).toContainText("Tap the stops");
  await tap(page, 650, 400); // not a stop
  await expect(page.locator("#toast")).toContainText("Tap a bus stop");
  for (const id of stops) {
    const c = await page.evaluate((i) => window.__arail.world.getObject(i).anchorPoint(), id);
    await tap(page, c[0], c[1]);
  }
  await expect(page.locator("#placing")).toContainText("2 stops");
  await page.locator("#placing").getByRole("button", { name: "Finish" }).click();
  await page.waitForFunction(() => window.__arail.editor.selected?.type === "bus-line");
  const line = await page.evaluate(() => {
    const o = window.__arail.editor.selected;
    const info = o.info();
    return { id: o.id, stops: o.spec.stops, ok: info.ok, problems: info.problems, visits: info.visits.map((v) => v.dockId) };
  });
  expect(line.stops).toEqual(stops);
  expect(line.ok).toBe(true);
  expect(line.problems).toEqual([]);
  expect(line.visits).toEqual([`${stops[0]}:right`, `${stops[1]}:right`, `${stops[1]}:left`, `${stops[0]}:left`]);
  await expect(page.locator(".section").filter({ hasText: "Selected: Bus line" })).toContainText(`Stops: `);
  await page.fill(`#obj-${line.id}-number`, "62");
  await page.locator(`#obj-${line.id}-number`).press("Enter");
  await expect.poll(() => page.evaluate(() => window.__arail.world.transit.lines.get(window.__arail.editor.selected.id).label)).toBe("62");

  // the inspector of the line is accessible
  const results = await new AxeBuilder({ page }).include("#panel-build").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);

  // run: a bus of the line arrives at a stop with its doors open
  await page.evaluate((lineId) => {
    const w = window.__arail.world;
    window.__arrived = [];
    w.events.on("vehicle.arrived", (e) => e.vehicle.lineId === lineId && window.__arrived.push(e.dock.id)); // (the example has bus lines, too)
    w.setTime("10:00");
    w.speed = 30;
    w.paused = false;
  }, line.id);
  await page.waitForFunction(() => window.__arrived.length > 0, null, { timeout: 60_000 });
  const arrived = await page.evaluate(() => window.__arrived[0]);
  expect(line.visits).toContain(arrived);
  await expect.poll(() => page.evaluate((id) => window.__arail.world.transit.statusFor(`${id}:right`), stops[0])).toMatch(/^Bus 62/);
  expect(errors).toEqual([]);
});

test("streets: a bus stop away from the streets says so in the inspector", async ({ page }) => {
  const errors = await openApp(page, "/app/#build");
  await page.locator(".palette").getByRole("button", { name: /^Bus stop/ }).click();
  await tap(page, 900, 350);
  await page.waitForFunction(() => window.__arail.editor.selected?.type === "bus-stop");
  await expect(page.locator(".section").filter({ hasText: "Selected: Bus stop" }).locator(".hint.error")).toContainText("Not next to a street");
  expect(errors).toEqual([]);
});

test("stops board: both sides of a stop as Stop A and B; loop lines go round as Ring ↻ / Ring ↺", async ({ page }) => {
  const errors = await openApp(page, "/app/#simulate");
  await page.evaluate(() => {
    const w = window.__arail.world;
    w.setTime("10:00");
    w.speed = 10;
    w.paused = false;
  });
  const board = page.locator(".board");
  await expect(board.locator(".stop .title").filter({ hasText: /^Altmarkt · Stop A$/ })).toHaveCount(1);
  await expect(board.locator(".stop .title").filter({ hasText: /^Altmarkt · Stop B$/ })).toHaveCount(1);
  await expect(board.locator(".stop .title").filter({ hasText: /^Bahnhof$/ })).toHaveCount(1);
  // the example's two lines go round the town in opposite directions
  await expect(board.locator(".stop .status").filter({ hasText: /^Bus 62 Ring ↺/ }).first()).toBeVisible();
  await expect(board.locator(".stop .status").filter({ hasText: /^Bus 85 Ring ↻/ }).first()).toBeVisible();
  await expect(board).not.toContainText("(loop)");
  // both lines start at the station's bus terminal: its row shows the next bus of each
  // (unless a timetable bus of the terminal's third bay is there, then that one and the next line)
  await expect(board.locator('.stop[data-id="bus-terminal-1"] .status')).toHaveText(/^Bus (62 Ring ↺.* · Bus 85 Ring ↻|30[58] .* · Bus (62|85) Ring)/);
  await expect(board.locator(".stop .status").filter({ hasText: /(^|· )30[58] / })).toHaveCount(0);
  // the inspector of a loop line says which way round its buses go
  await page.locator("#tab-build").click();
  await page.evaluate(() => window.__arail.editor.select(window.__arail.world.getObject("bus-line-85")));
  await expect(page.locator(".section").filter({ hasText: "Selected: Bus line" })).toContainText("The buses go round clockwise (“Ring ↻” on the signs).");
  expect(errors).toEqual([]);
});
