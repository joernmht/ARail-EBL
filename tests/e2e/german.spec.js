// End-to-end tests of German mode (game/german/): the signal box and the container terminal played on the
// page with the mouse and the keys, the end of a game with its score, and the best score kept.
import { expect, test } from "@playwright/test";

const PAGE = "/game/german/";

/** Open the page with nothing stored; the game waits to be started. */
async function open(page, query = "?seed=1") {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(PAGE);
  await page.evaluate(() => localStorage.clear());
  await page.goto(PAGE + query);
  await page.waitForFunction(() => window.__german?.game);
  return errors;
}

/** Start the game and stop its clock, so that the test lets the time pass (`run`). */
async function start(page) {
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.locator("#over")).toBeHidden();
  await page.evaluate(() => (window.__german.pace = 0));
}

/** Let the game run for `seconds` of simulated time. */
const run = (page, seconds) => page.evaluate((s) => {
  const p = window.__german;
  for (let i = 0; i < s && !p.game.over; i++) p.game.step(1);
  p.draw();
}, seconds);

test("the signal box: a train is let in through its entry signal and out through its exit signal", async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator("h1")).toHaveText("German mode");
  await expect(page.getByRole("link", { name: "Signal box" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#over")).toContainText("Ready?");
  // nothing runs before the start
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__german.game.t)).toBe(0);
  await start(page);
  await run(page, 20);
  // the timetable: the next trains, each with its planned track
  const first = await page.evaluate(() => window.__german.game.timetable().find((tr) => tr.dir > 0));
  const row = page.locator("#side tbody tr", { hasText: first.id });
  await expect(row).toContainText(first.plan);
  await expect(row).toContainText("Bergheim");
  // the first train from Bergheim: A, then its planned track
  await page.locator('[data-signal="A"]').click();
  await expect(page.locator("#hint")).toContainText("into which track?");
  await page.getByRole("button", { name: `To ${first.plan}`, exact: true }).click();
  await expect(page.locator("#hint")).toHaveText(`Route A → ${first.plan} set.`);
  await run(page, 10);
  await expect(page.locator('[data-signal="A"]')).toHaveAttribute("aria-label", /proceed/);
  // an exit signal has one route: one click
  const exit = `N${first.plan.slice(1)}`;
  await page.locator(`[data-signal="${exit}"]`).click();
  await expect(page.locator("#hint")).toHaveText(`Route ${exit} → Talsee set.`);
  await page.evaluate((id) => {
    const p = window.__german;
    while (p.game.trains.some((tr) => tr.id === id) && !p.game.over) p.game.step(1);
    p.draw();
  }, first.id);
  // by the timetable: every point
  await expect(page.locator("#points")).toHaveText("10");
  await expect(page.locator("#hint")).toHaveText(`${first.id}: +10`);
  // the panel shows which way the points lie: into G1 the diverging leg of W1 is dimmed, into G2 the straight one
  expect(await page.locator("#desk .sec.leg-off").count()).toBeGreaterThanOrEqual(6);
  // a route set by mistake is taken back with a second click on its signal
  await page.locator('[data-signal="P2"]').click();
  await expect(page.locator("#hint")).toHaveText("Route P2 → Bergheim set.");
  await page.locator('[data-signal="P2"]').click();
  await expect(page.locator("#hint")).toHaveText("Route P2 → Bergheim cancelled.");
  expect(await page.evaluate(() => window.__german.game.routeFrom("P2"))).toBeNull();
  // the same with the keys, for a train from Talsee
  await page.keyboard.press("f");
  await page.keyboard.press("3");
  await expect(page.locator("#hint")).toHaveText("Route F → G3 set.");
  await page.keyboard.press("1");
  await expect(page.locator("#hint")).toContainText(/No train in G1|Route N1/);
  expect(errors).toEqual([]);
});

test("the signal box: left alone it is stuck; the card says why and offers another game; the best score is kept", async ({ page }) => {
  const errors = await open(page);
  await start(page);
  // the computer plays for a while, then nobody
  await page.evaluate(() => {
    const p = window.__german, g = p.game, pl = new g.constructor.player();
    while (g.through < 4) {
      pl.think(g);
      g.step(1);
    }
    while (!g.over) g.step(1);
  });
  const over = page.locator("#over");
  await expect(over).toBeVisible();
  await expect(over.locator("h2")).toHaveText("Stuck.");
  await expect(over).toContainText(/trains wait on the line from (Bergheim|Talsee)/);
  const points = Number(await page.locator("#points").textContent());
  expect(points).toBeGreaterThanOrEqual(20);
  await expect(page.locator("#overResult")).toContainText(`${points} points · `);
  await expect(page.locator("#overResult")).toContainText(/\d+ trains through, \d+ on another track/);
  await expect(page.locator(".ger-meter.full").first()).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("arail.german.best")))).toEqual({ signaller: points });
  // the space bar starts the next game, as the button does
  await expect(page.getByRole("button", { name: "Again" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(over).toBeHidden();
  await expect(page.locator("#points")).toHaveText("0");
  await expect(page.locator("#best")).toHaveText(String(points));
  expect(errors).toEqual([]);
});

test("the container terminal: a container goes from the train onto a stack, and from the stack to its truck", async ({ page }) => {
  const errors = await open(page, "?game=terminal&seed=1");
  await expect(page.getByRole("link", { name: "Container terminal" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#pointsLabel")).toHaveText("Containers out");
  await start(page);
  await run(page, 30);
  const boxes = page.locator("#desk .box[role=button]");
  await expect(boxes).toHaveCount(2);
  const first = (await boxes.first().getAttribute("aria-label")).match(/Container (\w+)/)[1];
  // a container of the train: chosen, then the stack
  await boxes.first().click();
  await expect(page.locator("#hint")).toHaveText(`${first}: onto which stack?`);
  await page.getByRole("button", { name: "Onto stack 2" }).click();
  await expect(page.locator("#hint")).toHaveText(`${first} goes onto stack 2.`);
  // the other one with the keys: wagon 2, stack 2
  await page.keyboard.press("w");
  await page.keyboard.press("2");
  await expect(page.locator("#hint")).toContainText("goes onto stack 2.");
  await run(page, 80);
  expect(await page.evaluate(() => window.__german.game.real.stacks[1].length)).toBe(2);
  await expect(boxes).toHaveCount(1);
  // a truck comes for one of them: the top one goes with one click, the one below only then
  await page.evaluate(() => {
    const p = window.__german;
    while (!p.game.trucks.length && !p.game.over) p.game.step(1);
    p.draw();
  });
  const wants = await page.evaluate(() => window.__german.game.trucks[0].wants);
  if (wants === first) {
    await page.keyboard.press("2");
    await expect(page.locator("#hint")).toContainText("onto which stack?");
    await page.keyboard.press("3");
    await run(page, 40);
  }
  await page.locator("#desk .box.wanted[role=button]").click();
  await expect(page.locator("#hint")).toHaveText(`${wants} goes to its truck.`);
  await run(page, 60);
  await expect(page.locator("#points")).toHaveText("1");
  expect(errors).toEqual([]);
});

test("a game given up for a new one keeps its score as the best", async ({ page }) => {
  await open(page);
  await start(page);
  const points = await page.evaluate(() => {
    const p = window.__german, g = p.game, pl = new g.constructor.player();
    while (g.through < 3) {
      pl.think(g);
      g.step(1);
    }
    p.draw();
    return g.result().points;
  });
  expect(points).toBeGreaterThan(0);
  await page.getByRole("button", { name: "New game" }).click();
  await expect(page.locator("#points")).toHaveText("0");
  await expect(page.locator("#best")).toHaveText(String(points));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("arail.german.best")))).toEqual({ signaller: points });
});

test("the container terminal: left alone it is stuck", async ({ page }) => {
  const errors = await open(page, "?game=terminal&seed=2");
  await start(page);
  await run(page, 3600);
  await expect(page.locator("#over h2")).toHaveText("Stuck.");
  await expect(page.locator("#overResult")).toHaveText("0 containers out");
  expect(errors).toEqual([]);
});

test("the title screen offers German mode among the games, and Continue goes back to it", async ({ page }) => {
  await page.goto("/game/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/game/");
  await page.getByRole("button", { name: /Games/ }).click();
  await page.getByRole("link", { name: /German mode/ }).click();
  await expect(page).toHaveURL(/\/game\/german\/$/);
  await expect(page.locator("h1")).toHaveText("German mode");
  // back at the title: the submenu it was opened from, and Continue in the main menu
  await page.goto("/game/");
  await expect(page.locator(".title-menu-head")).toHaveText("Games");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: /Continue/ })).toHaveAttribute("href", "german/");
});

test("an address that names no game of the page opens the signal box", async ({ page }) => {
  for (const game of ["constructor", "__proto__", "nothing"]) {
    const errors = await open(page, `?game=${game}`);
    await expect(page.getByRole("link", { name: "Signal box" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
    expect(errors).toEqual([]);
  }
});

test("on a phone the picture scrolls sideways and the page does not", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await open(page, "?game=terminal&seed=1");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
