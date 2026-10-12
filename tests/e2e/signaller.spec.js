// End-to-end tests of the signaller's game (game/signaller/): routes on the panel and with the
// keyboard, a refused route with its reason, the failed signal with the fault report and the
// substitute signal with its checks, the score at the end, a phone screen.
import { expect, test } from "@playwright/test";

const PAGE = "/game/signaller/";

/** Open the page with nothing stored and the game paused. */
async function open(page, path = PAGE) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__signaller?.game);
  await page.getByRole("button", { name: "Pause" }).click();
  return errors;
}

/** Let the game run for `seconds` of simulated time. */
const run = (page, seconds) => page.evaluate((s) => {
  const p = window.__signaller;
  for (let i = 0; i < s; i++) p.game.step(1);
  p.draw(true);
  p.side();
}, seconds);

test("a route on the panel: start signal, destination; the points move and the signal clears", async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator("h1")).toHaveText("Signaller at Bf Neustadt");
  await expect(page.locator("#clock")).toHaveText("08:00:00");
  await page.locator('[data-signal="A"]').click();
  await expect(page.locator("#deskHint")).toContainText("Start A: now its destination (G1, G2, G3)");
  await page.locator(".dest", { hasText: "G2" }).click();
  await expect(page.locator("#routes .sig-list")).toContainText("A → G2");
  await run(page, 8);
  await expect(page.locator('[data-signal="A"]')).toHaveAttribute("aria-label", /Signal A: proceed, route A-G2/);
  // a route through the same points is refused, with the reason
  await page.locator('[data-signal="P2"]').click();
  await expect(page.locator(".dest", { hasText: "Bergheim" })).toHaveAttribute("aria-disabled", "true");
  await page.locator(".dest", { hasText: "Bergheim" }).click({ force: true }); // disabled, but a click tells why
  await expect(page.locator("#deskHint")).toContainText("locked by route A-G2");
  // RB 31 comes, stops at G2
  await run(page, 220);
  await expect(page.locator("#trains tbody tr").filter({ has: page.locator("th", { hasText: "RB 31" }) })).toContainText("at G2");
  expect(errors).toEqual([]);
});

test("with the keyboard: a start signal and its destination; Escape lets go of the start", async ({ page }) => {
  const errors = await open(page);
  const a = page.locator('[data-signal="F"]');
  await a.focus();
  await page.keyboard.press("Enter");
  await expect(a).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".dest").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(a).toHaveAttribute("aria-pressed", "false");
  // the form beside the panel
  await page.selectOption("#routeFrom", "F");
  await page.getByRole("button", { name: "→ G3" }).click();
  await expect(page.locator("#routes .sig-list")).toContainText("F → G3");
  expect(errors).toEqual([]);
});

test("the failed signal: the report, the substitute signal with its checks, the questions", async ({ page }) => {
  const errors = await open(page);
  // a careful start: the trains of the first quarter hour, as planned
  await page.evaluate(() => {
    const g = window.__signaller.game;
    while (g.t < 885) {
      for (const tr of g.trains) {
        if (tr.state === "gone") continue;
        const sig = tr.state === "coming" ? (tr.dir > 0 ? "A" : "F") : g.nextSignal(tr);
        if (!sig || g.routeFrom(sig)) continue;
        if (tr.state === "coming" && (g.t < tr.enterAt - 60 || g.trains.some((x) => x !== tr && x.state === "running" && g.nextSignal(x) === sig))) continue;
        if (sig === "A" || sig === "F") g.setRoute(`${sig}-${tr.plan}`);
        else if (!(tr.id === "GZ 47" && !g.trains.find((x) => x.id === "IC 2045").passed) && !(tr.stops && (tr.state !== "dwelling" || g.t < tr.dep - 20))) g.setRoute(`${sig}-${tr.dir > 0 ? "T" : "B"}`);
      }
      g.step(1);
    }
  });
  await run(page, 1);
  await expect(page.locator("#decisions")).toContainText("Signal N2 has failed. Report the fault to the maintenance dispatcher?");
  await page.getByRole("button", { name: "Report it now" }).click();
  await expect(page.locator("#signals")).toContainText("N2: reported at 08:");
  // the question about the failure
  await page.getByRole("button", { name: /With the substitute signal Zs 1/ }).click();
  await expect(page.locator("#log li").first()).toHaveText("Right.");
  // RB 33 at G2: the route from N2 is set, the signal stays at stop
  await page.selectOption("#routeFrom", "N2");
  await page.getByRole("button", { name: "→ Talsee" }).click();
  await run(page, 50);
  await expect(page.locator('[data-signal="N2"]')).toHaveAttribute("aria-label", /failed, stop, route N2-T/);
  await page.locator("#signals").getByRole("button", { name: "N2", exact: true }).click();
  await page.getByLabel(/the route from this signal is set and locked/).check();
  await page.getByLabel(/the track ahead is clear/).check();
  await page.selectOption("#zs1Reason", "lamp");
  await page.getByRole("button", { name: "Give Zs 1" }).click();
  await expect(page.locator("#deskHint")).toHaveText("Zs 1 at N2: the train may pass at up to 40 km/h.");
  await expect(page.locator("#log")).toContainText("Substitute signal Zs 1 at N2 (counter 1)");
  await run(page, 30);
  await expect(page.locator("#trains tbody tr").filter({ has: page.locator("th", { hasText: "RB 33" }) })).not.toContainText("at G2");
  expect(await page.evaluate(() => window.__signaller.game.violations.length)).toBe(0);
  expect(errors).toEqual([]);
});

test("the end of the game: the score, the debrief and a new game", async ({ page }) => {
  const errors = await open(page);
  await page.selectOption("#level", "training");
  await page.getByRole("button", { name: "Pause" }).click();
  await page.evaluate(() => {
    const g = window.__signaller.game;
    // nobody sets a route: the trains wait at the entry signals until the end of the shift
    while (!g.over) g.step(5);
  });
  await run(page, 1);
  await expect(page.locator("#scoreTitle")).toHaveText("Your half hour");
  await expect(page.locator("#score .tag")).toHaveText("not passed");
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.locator("#clock")).toHaveText("08:00:00");
  expect(errors).toEqual([]);
});

test("on a phone: the panel scrolls sideways inside its frame, the page does not", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(wide).toBe(false);
  const desk = await page.evaluate(() => { const d = document.querySelector("#deskScroll"); return d.scrollWidth > d.clientWidth; });
  expect(desk).toBe(true);
  expect(errors).toEqual([]);
});
