// End-to-end tests of the play page of the big game (game/play/): a mission chosen and started, the
// seats as tabs with the keyboard, a move through a generated form and a refused one, a game's
// sketch with what is chosen in it (the panel's signals, the district's faults), a decision,
// the flows between the roles, a seat taken over and handed back, the end with the result and the
// debrief, autosave and resume, a phone screen; turns with the missions of the site (budget years
// alone; three years of four roles at three rhythms); what a seat's game is told before it begins;
// and the fields of a move a real game does not have yet (a number, limits), with a mission and a
// slow role's game of the test's own (the page's `games` take one more game; nothing is added to GAMES).
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const PAGE = "/game/play/", MORNING = `${PAGE}?mission=neustadt-morning`;
const SIGNALLER = "#seat-signaller-relay", MAINTENANCE = "#seat-maintenance-dispatcher";

/** Open the page with nothing stored; it is ready when the missions are loaded. */
async function open(page, path = PAGE) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__play?.ready);
  return errors;
}

/** Start the morning at Bf Neustadt (the signaller's seat for the person) and pause it. */
async function start(page) {
  const errors = await open(page, MORNING);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForFunction(() => window.__play.session);
  await page.getByRole("button", { name: "Pause" }).click();
  return errors;
}

/** Let the session run for `seconds` of simulated time, then draw. */
const run = (page, seconds) => page.evaluate((s) => {
  const p = window.__play;
  for (let i = 0; i < s; i++) p.session.step(1);
  p.draw(true);
}, seconds);

/** A mission's card on the first screen, and its link. */
const cardOf = (page, id) => page.locator(".play-mission").filter({ has: page.locator(`#mission-${id}`) });
const linkOf = (page, id) => page.locator(`.play-mission a[href="?mission=${id}"]`);

/** The form of a move in a seat's panel. */
const move = (page, seat, label) => page.locator(`${seat} .play-move`).filter({ has: page.getByRole("button", { name: label, exact: true }) });

/** The name of a flow, as the catalogue of flows has it. */
const flowName = (page, id) => page.evaluate(async (flow) => (await import("/arail/game/index.js")).flowOf(flow).name, id);

const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

test("a mission is chosen and started: its card, its seats, its wiring, the header strip", async ({ page }) => {
  const errors = await open(page);
  const card = cardOf(page, "neustadt-morning");
  await expect(card.locator("h3")).toHaveText("A morning at Bf Neustadt");
  await expect(card.locator(".play-roles li").first()).toContainText("Signaller in a relay interlocking");
  await expect(card.locator(".play-roles li").first()).toContainText(": you");
  await expect(card.locator(".play-roles li").nth(1)).toContainText("Maintenance and fault dispatcher");
  await expect(card.locator(".play-roles li").nth(1)).toContainText(": the computer");
  await expect(card).toContainText("1 round: The morning shift (a shift of 40 min).");
  await linkOf(page, "neustadt-morning").click();
  await expect(page).toHaveURL(/\?mission=neustadt-morning$/);
  await expect(page.locator("#setupTitle")).toBeFocused();
  // the seats as the mission suggests them, the seed under More
  await expect(page.locator("#by-signaller-relay-human")).toBeChecked();
  await expect(page.locator("#by-maintenance-dispatcher-computer")).toBeChecked();
  await page.locator("#setup summary").click();
  await expect(page.locator("#seed")).toHaveValue("1");
  const wiring = page.locator(".play-wiring tbody tr");
  await expect(wiring.first()).toContainText(`${await flowName(page, "fault-report")} to Maintenance and fault dispatcher`);
  await expect(wiring.first()).toContainText(`${await flowName(page, "repair-status")} from Maintenance and fault dispatcher`);
  await expect(wiring.first()).toContainText(`${await flowName(page, "asset-condition")} from itself`);
  await expect(page.getByRole("button", { name: "Resume" })).toHaveCount(0);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.locator("#stripTitle")).toHaveText("A morning at Bf Neustadt");
  await expect(page.locator("#stripTitle")).toBeFocused();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.locator("#where")).toHaveText("The morning shift");
  await expect(page.locator("#phases li")).toHaveText(["The morning shift (shift)"]);
  await expect(page.locator("#phases li")).toHaveAttribute("aria-current", "step");
  await expect(page.locator("#clock")).toHaveText(/^08:00:0\d$/);
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.locator(`${SIGNALLER} h3`)).toHaveText("Signaller at Bf Neustadt");
  await expect(page.locator(SIGNALLER).getByRole("link", { name: "Signaller in a relay interlocking" })).toHaveAttribute("href", "../roles/#role-signaller-relay");
  await expect(page.locator(`${SIGNALLER} .play-figures`)).toContainText("Trains through");
  await expect(page.locator(`${SIGNALLER} .score-total`)).toBeVisible();
  // P lets the shift run again, and pauses it
  await page.keyboard.press("p");
  await expect(page.getByRole("button", { name: "1×" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#live")).toHaveText("Running at 1×.");
  await page.keyboard.press("p");
  await expect(page.getByRole("button", { name: "Pause" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#live")).toHaveText("Paused.");
  // an address that names a mission opens it
  await page.goto(MORNING);
  await expect(page.locator("#setupTitle")).toHaveText("A morning at Bf Neustadt");
  expect(errors).toEqual([]);
});

test("the seats are tabs: arrow keys, Home and End; a computer's seat is shown without forms", async ({ page }) => {
  const errors = await start(page);
  const tabs = page.getByRole("tab");
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await expect(tabs.first()).toContainText("you");
  await expect(tabs.nth(1)).toContainText("computer");
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(SIGNALLER)).toBeHidden();
  const panel = page.getByRole("tabpanel");
  await expect(panel).toHaveAttribute("id", "seat-maintenance-dispatcher");
  await expect(panel.locator("h3")).toHaveText("Fault Night");
  await expect(panel).toContainText("played by the computer");
  await expect(panel.locator(".play-move")).toHaveCount(0);
  await expect(panel.locator(".play-moves-note")).toContainText("Send a team");
  await expect(panel.locator(".play-table h4")).toHaveText(["Faults", "Teams"]);
  await page.keyboard.press("ArrowRight"); // around
  await expect(tabs.first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(tabs.nth(1)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
});

test("a move through its form: a route is set; a move the game refuses shows why", async ({ page }) => {
  const errors = await start(page);
  const set = move(page, SIGNALLER, "Set a route");
  // nothing chosen: the page asks for it, the game is not asked
  await set.getByRole("button", { name: "Set a route" }).click();
  await expect(set.getByRole("status")).toHaveText("Choose: From → to.");
  await set.getByLabel("From → to").selectOption("A-G2");
  // the choice stays while the panel is drawn anew
  await page.evaluate(() => window.__play.draw(true));
  await expect(set.getByLabel("From → to")).toHaveValue("A-G2");
  await set.getByRole("button", { name: "Set a route" }).click();
  const routes = page.locator(`${SIGNALLER} .play-table`).filter({ has: page.locator("h4", { hasText: "Routes set" }) });
  await expect(routes.locator("tbody tr")).toContainText(["A → G2"]);
  await expect(set.getByRole("status")).toHaveText("");
  await expect(page.locator(`${SIGNALLER} .play-log li`).first()).toContainText("Route A → G2 set.");
  expect(await page.evaluate(() => window.__play.session.record.map((m) => [m.seat, m.name, ...m.args]))).toEqual([["signaller-relay", "setRoute", "A-G2"]]);
  // the track of a locked route cannot be closed: the game says why
  const close = move(page, SIGNALLER, "Close a track");
  await close.getByLabel("Track").selectOption("G2");
  await close.getByRole("button", { name: "Close a track" }).click();
  await expect(close.getByRole("status")).toHaveText("G2 is locked by route A-G2.");
  await expect(close.getByLabel("Track")).toHaveValue("G2");
  // RB 31 comes and stops at G2
  await run(page, 230);
  const trains = page.locator(`${SIGNALLER} .play-table`).filter({ has: page.locator("h4", { hasText: "Trains" }) });
  await expect(trains.locator("tbody tr").filter({ has: page.locator("th", { hasText: "RB 31" }) })).toContainText("at G2");
  expect(errors).toEqual([]);
});

test("the picture of a game: a signal chosen on the panel, its route from its menu, with the keyboard too; a fault with the teams to send", async ({ page }) => {
  const errors = await start(page);
  const board = page.locator(`${SIGNALLER} .play-board`), pick = page.locator(`${SIGNALLER} .play-pick`);
  await expect(page.locator(`${SIGNALLER} .play-sketch h4`)).toHaveText("The panel");
  await expect(board).toHaveAttribute("role", "group");
  await expect(board).toHaveAttribute("aria-label", /^Track diagram of Bf Neustadt/);
  await expect(pick.locator(".hint")).toHaveText("Choose something in the picture: its moves appear here.");
  // a signal is a button; chosen, it offers its routes
  const a = board.getByRole("button", { name: /^Signal A:/ });
  await expect(a).toHaveAttribute("aria-label", "Signal A: stop");
  await a.click();
  await expect(a).toHaveAttribute("aria-pressed", "true");
  await expect(pick.locator(".play-picked")).toHaveText("Signal A: stop");
  await expect(pick.getByRole("button")).toHaveText(["Route to G1", "Route to G2", "Route to G3"]);
  await expect(pick.getByRole("button", { name: "Route to G1" })).toBeFocused();
  await pick.getByRole("button", { name: "Route to G2" }).click();
  expect(await page.evaluate(() => window.__play.session.record.map((m) => [m.seat, m.name, ...m.args]))).toEqual([["signaller-relay", "setRoute", "A-G2"]]);
  // after the move the focus is back on the signal, which stays chosen and can cancel its route
  await expect(a).toBeFocused();
  await expect(pick.getByRole("button", { name: "Cancel the route to G2" })).toBeVisible();
  await run(page, 10);
  await expect(a).toHaveAttribute("aria-label", "Signal A: proceed, route to G2");
  expect(await board.locator("line.t-route").count()).toBeGreaterThan(2);
  // with the keyboard: Enter on a signal, then on a route that the interlocking refuses
  await board.getByRole("button", { name: /^Signal P2:/ }).focus();
  await page.keyboard.press("Enter");
  const refused = pick.getByRole("button", { name: "Route to Bergheim" });
  await expect(refused).toBeFocused();
  await expect(refused).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Enter");
  await expect(pick.getByRole("status")).toHaveText(/\S/);
  expect(await page.evaluate(() => window.__play.session.record.length)).toBe(1);
  // a train on the panel
  await run(page, 200);
  await expect(board.locator(".tag text").filter({ hasText: "RB 31" })).toBeVisible();

  // the computer's seat: the picture only; taken over, a fault that waits offers the teams
  await page.getByRole("tab", { name: /Maintenance and fault dispatcher/ }).click();
  const map = page.locator(`${MAINTENANCE} .play-board`);
  await expect(page.locator(`${MAINTENANCE} .play-sketch h4`)).toHaveText("The district");
  await expect(map).toHaveAttribute("role", "img");
  await expect(map.getByRole("button")).toHaveCount(0);
  await expect(map.locator(".tag")).toHaveCount(2);
  await page.locator(MAINTENANCE).getByRole("button", { name: "Take over" }).click();
  await page.evaluate(() => {
    const p = window.__play, g = p.session.seat("maintenance-dispatcher").game;
    for (let i = 0; i < 2000 && !g.faults.some((f) => f.state === "open"); i++) p.session.step(1);
    p.draw(true);
  });
  const fault = map.getByRole("button").first();
  await expect(fault).toHaveAttribute("aria-label", /waits for a team$/);
  await fault.click();
  const send = page.locator(`${MAINTENANCE} .play-pick`).getByRole("button").first();
  await expect(send).toHaveText(/^Send Team .+ \((signalling|track), \d+ min\)$/);
  await send.click();
  await expect(map.locator(".tag.t-train")).toHaveCount(1);
  expect(await page.evaluate(() => window.__play.session.record.at(-1).name)).toBe("send");
  expect(errors).toEqual([]);
});

test("the failure: decisions are announced and answered; the fault report and the repair status pass between the roles", async ({ page }) => {
  const errors = await start(page);
  await run(page, 790);
  const decisions = page.locator(`${SIGNALLER} .play-decision`);
  await expect(decisions).toHaveCount(2);
  await expect(page.locator("#live")).toContainText("2 decisions to take.");
  await expect(page.locator("#live")).toContainText("Signal N2 has failed.");
  await expect(page.locator("#tab-signaller-relay")).toContainText("2 decisions open");
  const report = decisions.filter({ hasText: "Signal N2 has failed. Report the fault to the maintenance dispatcher?" });
  await report.getByRole("button", { name: "Later" }).focus();
  await report.getByRole("button", { name: "Report it now" }).click();
  await expect(decisions).toHaveCount(1);
  // the focus goes on to the next decision
  await expect(decisions.getByRole("button").first()).toBeFocused();
  await decisions.getByRole("button", { name: /With the substitute signal Zs 1/ }).click();
  await expect(decisions).toHaveCount(0);
  await expect(page.locator(`${SIGNALLER} .play-decisions`)).toContainText("Nothing to decide just now.");
  await expect(page.locator(`${SIGNALLER} .play-log li`).first()).toHaveText("Right.");
  await run(page, 2);
  const flows = page.locator("#flowList li"), report$ = await flowName(page, "fault-report"), status$ = await flowName(page, "repair-status");
  const fault = flows.filter({ hasText: report$ });
  await expect(fault).toHaveCount(1);
  await expect(fault).toContainText("08:13:10");
  await expect(fault).toContainText("Signaller in a relay interlocking → Maintenance and fault dispatcher");
  await expect(fault).toContainText("fault: N2 · asset: Exit signal N2 · kind: lamp failure · place: Bf Neustadt · track: G2");
  // the dispatcher sends a signalling team as soon as one is free
  await page.evaluate(() => {
    const p = window.__play;
    for (let i = 0; i < 1500 && !p.session.flows.some((f) => f.flow === "repair-status" && f.payload.fault === "N2"); i++) p.session.step(1);
    p.draw(true);
  });
  const sent = flows.filter({ hasText: status$ }).filter({ hasText: "fault: N2" });
  await expect(sent).toHaveCount(1);
  await expect(sent).toContainText("Maintenance and fault dispatcher → Signaller in a relay interlocking");
  await expect(sent).toContainText(/state: dispatched · eta: \d+ s · team: /);
  // the newest first; counts per flow; the list by flow
  await expect(flows.first()).toContainText(status$);
  await expect(page.locator("#flowCounts li").filter({ hasText: report$ })).toContainText("1");
  await page.locator("#flowFilter").selectOption("fault-report");
  await expect(flows).toHaveCount(1);
  await page.locator("#flowFilter").selectOption("");
  expect(await flows.count()).toBeGreaterThan(1);
  // the dispatcher's seat shows the fault
  await page.locator("#tab-maintenance-dispatcher").click();
  await expect(page.locator(`${MAINTENANCE} .play-table`).first()).toContainText("Exit signal N2");
  expect(errors).toEqual([]);
});

test("a computer's seat is taken over and handed back", async ({ page }) => {
  const errors = await start(page);
  await page.locator("#tab-maintenance-dispatcher").click();
  const panel = page.locator(MAINTENANCE);
  await panel.getByRole("button", { name: "Take over" }).click();
  await expect(page.locator("#tab-maintenance-dispatcher")).toContainText("you");
  await expect(panel).toContainText("played by you");
  expect(await page.evaluate(() => window.__play.session.seat("maintenance-dispatcher").by)).toBe("human");
  // its moves are forms now; a move that cannot be made says why
  const send = move(page, MAINTENANCE, "Send a team");
  await expect(send).toContainText("No fault waits for a team.");
  await expect(send.getByRole("button", { name: "Send a team" })).toHaveAttribute("aria-disabled", "true");
  await send.getByRole("button", { name: "Send a team" }).click({ force: true }); // disabled, but a click tells why
  await expect(send.getByRole("status")).toHaveText("No fault waits for a team.");
  // a technician on call of one of the two trades
  const call = move(page, MAINTENANCE, "Call a technician on call");
  await expect(call).toContainText("4 h of overtime; ready at the base after 10 min.");
  await call.getByLabel("Trade").selectOption("track");
  await call.getByRole("button", { name: "Call a technician on call" }).click();
  await expect(panel.locator(".play-figures")).toContainText("4 h");
  await expect(panel.locator(".play-log li").first()).toContainText("The track technician on call, J. Sokół, is called");
  // the button stays where it was, with the focus
  const back = panel.getByRole("button", { name: "Hand to the computer" });
  await back.focus();
  await back.click();
  await expect(panel.getByRole("button", { name: "Take over" })).toBeFocused();
  await expect(panel.locator(".play-move")).toHaveCount(0);
  expect(await page.evaluate(() => window.__play.session.record.map((m) => [m.name, ...m.args.slice(0, 1)]))).toEqual([["@seat", "human"], ["callIn", "track"], ["@seat", "computer"]]);
  expect(errors).toEqual([]);
});

test("nobody of the people at work: the shift is skipped to its end; the result with the debrief, as a file, again", async ({ page }) => {
  const errors = await start(page);
  await expect(page.locator("#skipBar")).toBeHidden();
  await page.locator(SIGNALLER).getByRole("button", { name: "Hand to the computer" }).click();
  await page.getByRole("button", { name: "Skip to the end of the shift" }).click();
  await expect(page.locator("#resultTitle")).toHaveText("The result: A morning at Bf Neustadt");
  await expect(page.locator("#resultTitle")).toBeFocused();
  await expect(page.locator("#live")).toContainText("The session is over:");
  await expect(page.locator("#play")).toBeHidden();
  const result = await page.evaluate(() => window.__play.session.result());
  await expect(page.locator(".play-total .score-total")).toHaveText(String(result.score));
  await expect(page.locator(".play-total .tag")).toHaveText(result.passed ? "passed" : "not passed");
  const seats = page.locator(".play-result-seats .game-card");
  await expect(seats).toHaveCount(2);
  await expect(seats.first().locator("h3")).toHaveText("Signaller in a relay interlocking");
  await expect(seats.first()).toContainText("played by the computer at the end (the seat changed hands)");
  await expect(seats.first().locator("tbody tr")).toHaveText([new RegExp(`^1\\s*The morning shift\\s*${result.seats[0].score}\\s*(not )?passed\\s*0$`)]);
  await expect(seats.first().locator(".score-parts li")).toHaveCount(5);
  await expect(seats.first()).toContainText("Punctuality (35)");
  await expect(seats.nth(1)).toContainText("Fault Night, played by the computer.");
  await expect(page.locator("#result .play-counts")).toContainText(await flowName(page, "repair-status"));
  // what led to what: the faults of the shift on its time line, whose their minutes were, what the failure did
  const chain = page.locator("#result .play-chain");
  await expect(chain.locator("h3")).toHaveText("What led to what");
  const n2 = chain.locator(".play-thread").filter({ has: page.locator("h4", { hasText: "Exit signal N2, Bf Neustadt" }) });
  await expect(n2.locator("h4 .tag")).toHaveText(/^(repaired|repaired provisionally|not repaired)$/);
  await expect(n2.locator("p").first()).toHaveText(/^Out of order for [\d.]+ min.*: .*Maintenance and fault dispatcher [\d.]+ min.*\.$/);
  await expect(n2.locator(".play-line")).toHaveAttribute("aria-label", /^Exit signal N2: Out of order for [\d.]+ min.*, from 08:13 to 08:\d\d$/);
  expect(await n2.locator(".play-line i").count()).toBeGreaterThan(2);
  await expect(n2.locator(".play-stretches li").first()).toContainText("until a team was sent: Maintenance and fault dispatcher");
  await expect(n2.locator(".play-stretches li").filter({ hasText: "on the road" })).toHaveCount(1);
  await expect(n2.locator(".play-effects li").first()).toContainText("on the substitute signal Zs 1");
  expect(await chain.locator(".play-thread").count()).toBeGreaterThan(1);
  await expect(chain.locator(".play-keys li").filter({ hasText: "Maintenance and fault dispatcher" })).toHaveText(/: [\d.]+ min \(\d+ %\)$/);
  // the bars of the faults share the shift's time line: none sticks out
  expect(await chain.evaluate((el) => [...el.querySelectorAll(".play-line i")].every((i) => i.offsetLeft >= 0 && i.offsetLeft + i.offsetWidth <= i.parentElement.clientWidth + 1))).toBe(true);
  await expect(page.locator("#result .play-debrief li")).toHaveCount(4);
  await expect(page.locator("#result .play-debrief li").first()).toContainText("How long did the trains of track G2 wait");
  // finishing removes the save
  expect(await page.evaluate(() => localStorage.getItem("arail.play.neustadt-morning"))).toBeNull();
  // the session as a file
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save the session as a file" }).click()]);
  expect(file.suggestedFilename()).toBe("neustadt-morning-seed-1.json");
  const saved = JSON.parse(await readFile(await file.path(), "utf8"));
  expect(saved.format).toBe("arail-session/1");
  expect(saved.record.map((m) => m.name)).toEqual(["@seat"]);
  expect(saved.result.score).toBe(result.score);
  // again with the same seed and the same seats, then with another seed
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.locator("#stripTitle")).toBeFocused();
  await page.getByRole("button", { name: "Pause" }).click();
  expect(await page.evaluate(() => [window.__play.session.seed, window.__play.session.seat("signaller-relay").by])).toEqual([1, "human"]);
  await page.evaluate(() => {
    const p = window.__play;
    p.sit("signaller-relay", "computer");
    p.skip();
  });
  await expect(page.locator(".play-total .score-total")).toHaveText(String(result.score));
  await page.getByRole("button", { name: "New seed" }).click();
  await page.waitForFunction(() => window.__play.screen === "play");
  expect(await page.evaluate(() => window.__play.session.seed)).not.toBe(1);
  await page.getByRole("button", { name: "Other missions" }).click();
  await expect(page.locator("#choose")).toBeVisible();
  await expect(page.locator("#setup")).toBeHidden();
  await expect(page).toHaveURL(/\/game\/play\/$/);
  expect(errors).toEqual([]);
});

test("autosave and resume: after a reload the session goes on at the same time, with the route set", async ({ page }) => {
  const errors = await start(page);
  await run(page, 100);
  const set = move(page, SIGNALLER, "Set a route");
  await set.getByLabel("From → to").selectOption("A-G2");
  await set.getByRole("button", { name: "Set a route" }).click();
  await run(page, 20);
  await expect(page.locator("#clock")).toHaveText("08:02:00");
  await page.reload();
  await page.waitForFunction(() => window.__play?.ready);
  expect(await page.evaluate(() => window.__play.session)).toBeNull();
  await expect(page.locator("#setup")).toContainText("A session of this mission is saved in this browser (The morning shift, 08:02:00).");
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.locator("#clock")).toHaveText("08:02:00");
  await expect(page.getByRole("button", { name: "Pause" })).toHaveAttribute("aria-pressed", "true");
  const routes = page.locator(`${SIGNALLER} .play-table`).filter({ has: page.locator("h4", { hasText: "Routes set" }) });
  await expect(routes.locator("tbody tr")).toContainText(["A → G2"]);
  expect(await page.evaluate(() => [window.__play.session.ticks, window.__play.session.record.length])).toEqual([240, 1]);
  // a new session replaces the save
  await page.getByRole("button", { name: "Other missions" }).click();
  await linkOf(page, "neustadt-morning").click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("arail.play.neustadt-morning")).record)).toEqual([]);
  expect(errors).toEqual([]);
});

test("on a phone: the page does not scroll sideways, a wide table scrolls in its frame", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const errors = await open(page, MORNING);
  expect(await sideways(page)).toBe(false);
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await run(page, 802);
  await expect(page.locator(`${SIGNALLER} .play-decision`).first()).toBeVisible();
  expect(await sideways(page)).toBe(false);
  const trains = page.locator(`${SIGNALLER} .table-scroll`).first();
  expect(await trains.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(trains).toHaveAttribute("tabindex", "0");
  await page.locator(SIGNALLER).getByRole("button", { name: "Report it now" }).click();
  await run(page, 2);
  await expect(page.locator("#flowList li").first()).toBeVisible();
  expect(await sideways(page)).toBe(false);
  await page.evaluate(() => {
    const p = window.__play;
    p.sit("signaller-relay", "computer");
    p.skip();
  });
  await expect(page.locator("#resultTitle")).toBeVisible();
  expect(await sideways(page)).toBe(false);
  expect(errors).toEqual([]);
});

/* ---------------------------------------------------------------- turns */

test("budget years: a decision and the plan in a turn, End the turn, the account, the next round; to the result by the fallbacks", async ({ page }) => {
  const errors = await open(page, `${PAGE}?mission=budget-years`);
  await expect(page.locator("#by-asset-manager-human")).toBeChecked();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.locator("#where")).toHaveText("Round 1 of 4 · The year's plan");
  await expect(page.locator("#phases li")).toHaveText(["The year's plan (turn)", "The year's account (turn)"]);
  await expect(page.locator('#phases li[aria-current="step"]')).toHaveText("The year's plan (turn)");
  await expect(page.locator("#shiftBar")).toBeHidden();
  await expect(page.locator("#skipBar")).toBeHidden();
  await expect(page.getByRole("tab")).toHaveCount(1);
  const panel = page.locator("#seat-asset-manager"), end = page.locator("#endTurn"), decisions = panel.locator(".play-decision");
  await expect(decisions).toHaveCount(5);
  await expect(end).toHaveText("End the turn (5 open)");
  await expect(end).not.toHaveClass(/primary/);
  await expect(page.locator("#turnNote")).toHaveText("5 of your decisions are still open. Ending the turn decides them by their fallback.");
  await expect(page.locator("#live")).toContainText("5 decisions to take.");
  // a decision answered; its fallback is named
  const proposal = decisions.filter({ hasText: "proposes to repair the bridge" });
  await expect(proposal).toContainText("Still open at the end of the turn: Defer it a year");
  await proposal.getByRole("button", { name: /^Approve/ }).click();
  await expect(decisions).toHaveCount(4);
  await expect(end).toHaveText("End the turn (4 open)");
  // the plan as one move: its fields begin with the game's values; it takes the four decisions
  const plan = move(page, "#seat-asset-manager", "Set the year's plan");
  await expect(plan.getByLabel("Maintenance strategy")).toHaveValue("standard");
  await expect(plan.getByLabel(/^A technician on call/)).toBeChecked();
  await plan.getByLabel("Maintenance strategy").selectOption("thorough");
  await plan.getByLabel("Emergency teams").selectOption("3");
  await plan.getByRole("button", { name: "Set the year's plan" }).click();
  await expect(decisions).toHaveCount(0);
  await expect(end).toHaveText("End the turn");
  await expect(end).toHaveClass(/primary/);
  await expect(page.locator("#turnNote")).toHaveText("Nothing is left for you to decide in this turn.");
  expect(await page.evaluate(() => window.__play.session.seat("asset-manager").game.plan)).toMatchObject({ strategy: "thorough", teams: 3, on_call: true });
  // the account of the year
  await end.click();
  await expect(page.locator("#where")).toHaveText("Round 1 of 4 · The year's account");
  await expect(page.locator('#phases li[aria-current="step"]')).toHaveText("The year's account (turn)");
  await expect(page.locator("#live")).toContainText("Round 1 of 4. The year's account: a turn.");
  const years = panel.locator(".play-table").filter({ has: page.locator("h4", { hasText: "The years" }) });
  await expect(years.locator("tbody tr")).toHaveCount(1);
  await expect(end).toHaveClass(/primary/);
  // the next round: its decisions are asked anew
  await end.click();
  await expect(page.locator("#where")).toHaveText("Round 2 of 4 · The year's plan");
  await expect(end).toHaveText("End the turn (5 open)");
  // a turn is saved, and resumed where it stood
  await page.reload();
  await page.waitForFunction(() => window.__play?.ready);
  await expect(page.locator("#setup")).toContainText("saved in this browser (round 2 of 4, The year's plan)");
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.locator("#where")).toHaveText("Round 2 of 4 · The year's plan");
  await expect(years.locator("tbody tr")).toHaveCount(1);
  // to the end: what is open is decided by its fallback
  for (const where of ["Round 2 of 4 · The year's account", "Round 3 of 4 · The year's plan", "Round 3 of 4 · The year's account", "Round 4 of 4 · The year's plan", "Round 4 of 4 · The year's account"]) {
    await page.locator("#endTurn").click();
    await expect(page.locator("#where")).toHaveText(where);
  }
  await page.locator("#endTurn").click();
  await expect(page.locator("#resultTitle")).toHaveText("The result: Budget Years");
  await expect(page.locator("#resultTitle")).toBeFocused();
  const result = await page.evaluate(() => window.__play.session.result());
  expect(result.seats[0].rounds.at(-1).decisions.filter((d) => d.auto).length).toBe(15);
  expect(result.seats[0].rounds.at(-1).decisions.find((d) => d.id === "proposal" && !d.auto).option).toBe("approve");
  const seat = page.locator(".play-result-seats .game-card");
  await expect(seat).toHaveCount(1);
  await expect(seat.locator("tbody tr")).toHaveCount(4);
  await expect(seat.locator("tbody tr").first()).toContainText("the whole round");
  await expect(seat).toContainText("Objectives of round 4");
  await expect(page.locator(".play-total .score-total")).toHaveText(String(result.score));
  await expect(page.locator("#result .play-debrief li")).toHaveCount(3);
  expect(await page.evaluate(() => localStorage.getItem("arail.play.budget-years"))).toBeNull();
  expect(errors).toEqual([]);
});

test("three years of Neustadt: the computer's turn, your turn, the shift skipped; the budget, the staff plan and the reports in the flows", async ({ page }) => {
  const errors = await open(page, `${PAGE}?mission=neustadt-years`);
  await expect(page.locator("#by-asset-manager-human")).toBeChecked();
  await expect(page.locator("#by-bundestag-budget-mp-computer")).toBeChecked();
  await page.getByRole("button", { name: "Start" }).click();
  // the rapporteur's turn was the computer's: the session waits in the asset manager's
  await expect(page.locator("#where")).toHaveText("Round 1 of 3 · The plans for the year");
  await expect(page.locator("#phases li")).toHaveCount(4);
  await expect(page.locator('#phases li[aria-current="step"]')).toHaveText("The plans for the year (turn)");
  await expect(page.getByRole("tab")).toHaveCount(6);
  await expect(page.locator("#tab-asset-manager")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#tab-signaller-relay")).toContainText("not at work");
  const flows = page.locator("#flowList li"), filter = page.locator("#flowFilter");
  await filter.selectOption("budget");
  const budget = flows.first();
  await expect(flows).toHaveCount(1);
  await expect(budget.locator("strong")).toHaveText(await flowName(page, "budget"));
  await expect(budget).toContainText("Round 1 · The night session: the rail budget");
  await expect(budget).toContainText("→ Asset manager");
  await expect(budget).toContainText("year: 2027 · maintenance: ");
  // a seat whose game has not begun
  await page.locator("#tab-signaller-relay").click();
  await expect(page.locator("#seat-signaller-relay")).toContainText("Not at work in this phase. Its game has not begun yet.");
  // the turn ends with its fallbacks: the plan goes down, the shift is the computers'
  await page.locator("#endTurn").click();
  await expect(page.locator("#where")).toHaveText("Round 1 of 3 · A morning at Bf Neustadt");
  await expect(page.locator("#clock")).toHaveText(/^08:00:\d\d$/);
  await filter.selectOption("staff-plan");
  await expect(flows).toHaveCount(1);
  await expect(flows).toContainText(["Round 1 · The plans for the year"]);
  await expect(flows).toContainText(["Asset manager → Maintenance and fault dispatcher"]);
  await expect(flows).toContainText(["teams: 2 · on call: yes"]);
  await expect(page.locator("#seat-signaller-relay h3")).toHaveText("Signaller at Bf Neustadt");
  await page.getByRole("button", { name: "Skip to the end of the shift" }).click();
  // the account: the morning's reports have come up
  await expect(page.locator("#where")).toHaveText("Round 1 of 3 · The year's accounts");
  await expect(page.locator("#tab-asset-manager")).toHaveAttribute("aria-selected", "true");
  await filter.selectOption("performance-report");
  // the signaller's, the maintenance dispatcher's and the undertaking's accounts of the morning
  await expect(flows.filter({ hasText: "Round 1 · 08:40:00" }).filter({ hasText: "→ Asset manager" })).toHaveCount(3);
  await expect(flows.filter({ hasText: "Round 1 · 08:40:00" }).filter({ hasText: "kind: undertaking" })).toContainText("Transport authority contract manager");
  await expect(flows.filter({ hasText: "Signaller in a relay interlocking → Asset manager" })).toContainText("kind: operations");
  await expect(page.locator("#flowCounts li").filter({ hasText: await flowName(page, "budget") }).first()).toBeVisible();
  // the next year begins with the next budget
  await page.locator("#endTurn").click();
  await expect(page.locator("#where")).toHaveText("Round 2 of 3 · The plans for the year");
  await filter.selectOption("budget");
  await expect(flows.first()).toContainText("Round 2 · The night session: the rail budget");
  expect(errors).toEqual([]);
});

test("a seat whose game must be told its world: the fields before Start; the key is not kept", async ({ page }) => {
  const errors = await open(page, `${PAGE}?mission=lab-morning`);
  const address = page.getByLabel("Address of the lab's simulation API"), key = page.getByLabel("API key");
  await expect(address).toHaveValue("http://127.0.0.1:8095");
  await expect(key).toHaveAttribute("type", "password");
  await expect(key).toHaveValue("");
  await address.fill("http://127.0.0.1:8096");
  await key.fill("a-secret-key");
  expect(await page.evaluate(() => window.__play.choice.settings["train-dispatcher"])).toEqual({ url: "http://127.0.0.1:8096", key: "a-secret-key" });
  expect(await page.evaluate(() => window.__play.told().roles[0].options)).toMatchObject({ station: "IN", url: "http://127.0.0.1:8096", key: "a-secret-key" });
  await page.reload();
  await page.waitForFunction(() => window.__play?.ready);
  await expect(address).toHaveValue("http://127.0.0.1:8096");
  await expect(key).toHaveValue("");
  expect(await page.evaluate(() => Object.values(localStorage).join(" ").includes("a-secret-key"))).toBe(false);
  // a session with the lab cannot be played again from its record: it is not kept, and Resume is not offered
  await expect(page.locator("#noResume")).toContainText("cannot be taken up again once this page is closed");
  await page.evaluate(() => localStorage.setItem("arail.play.lab-morning", JSON.stringify({ format: "arail-session/1", mission: "lab-morning", seed: 1, seats: {}, record: [], at: { phase: 0, tick: 40 } })));
  await page.reload();
  await page.waitForFunction(() => window.__play?.ready);
  await expect(page.getByRole("button", { name: "Resume" })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("arail.play.lab-morning"))).toBeNull();
  // started (no lab answers at this address: the shift goes on without it), it is not saved
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForFunction(() => window.__play.session);
  await page.evaluate(() => {
    const p = window.__play;
    p.save();
  });
  expect(await page.evaluate(() => localStorage.getItem("arail.play.lab-morning"))).toBeNull();
  // the page is left for another, and the browser keeps it for "back": the lab's world is given back all the same
  // (the browser may throw the page away without another word)
  const left = () => page.evaluate(() => window.__play.session?.seat("train-dispatcher").game._left ?? null);
  expect(await left()).toBe(false);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  expect(await left()).toBe(true);
  // shown again from the cache, the session cannot go on: the mission from its start, with the reason
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  expect(await page.evaluate(() => [window.__play.session, window.__play.screen])).toEqual([null, "choose"]);
  await expect(page.locator("#setup .hint.error")).toContainText("The session ended when this page was left");
  await expect(page.locator("#setupTitle")).toBeFocused();
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  // the morning without the lab is kept as before, and goes on when the page comes back from the cache
  await page.goto(MORNING);
  await page.waitForFunction(() => window.__play?.ready);
  await expect(page.locator("#noResume")).toHaveCount(0);
  await expect(page.locator("#setup .hint.error")).toHaveCount(0);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForFunction(() => window.__play.session);
  await page.evaluate(() => {
    dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  expect(await page.evaluate(() => [!!window.__play.session, window.__play.screen])).toEqual([true, "play"]);
  await run(page, 30);
  expect(await page.evaluate(() => window.__play.session.t)).toBeGreaterThanOrEqual(30);
  expect(errors.filter((e) => !/fetch|Failed to load|ERR_CONNECTION|NetworkError/i.test(e))).toEqual([]);
});

/** A mission with turns: an asset manager plans two years; each year a short morning at Bf Neustadt shows what the plan was worth. */
const YEARS = {
  format: "arail-mission/1", id: "test-years", title: "Two budget years",
  text: "The asset manager plans the year; a morning at Bf Neustadt shows what the plan was worth.", seed: 3,
  roles: [
    { role: "asset-manager", game: "test-plan", seat: "human" },
    { role: "signaller-relay", game: "signaller", seat: "computer" },
    { role: "maintenance-dispatcher", game: "maintenance", seat: "computer" },
  ],
  rounds: 2,
  phases: [
    { id: "plan", kind: "turn", title: "The year's plan", roles: ["asset-manager"] },
    { id: "shift", kind: "shift", title: "A morning", roles: ["signaller-relay", "maintenance-dispatcher"], length: 300, clock: "08:00" },
    { id: "review", kind: "turn", title: "The year's account", roles: ["asset-manager"] },
  ],
  debrief: ["What did the second team cost, and what did it save?"],
};

/**
 * Give the page a slow role's game of the test's own (played in turns: a decision with a fallback,
 * a move with a number and a checkbox, state flows at the end of the plan, reports read in the
 * account; a setting it is told before it begins), beside the games of GAMES.
 */
const addPlanGame = (page) => page.evaluate(async () => {
  const { Game } = await import("/arail/game/index.js");
  class PlanGame extends Game {
    static id = "test-plan";
    static title = "A year of the assets";
    static role = "asset-manager";
    static scale = "years";
    static description = "Plan the teams and the upkeep of a year.";
    static takes = [{ flow: "performance-report" }];
    static gives = [{ flow: "staff-plan" }, { flow: "asset-condition" }];
    static actions = { ...Game.actions, spend: { label: "Spend on upkeep" } };
    static settings = [{ id: "note", label: "A note for the plan", type: "text", value: "none" }];

    constructor(options) {
      super(options);
      this.note = options.note;
      this.resource("money", "Money", 100, "k€");
      this.teams = 2;
      this.grade = 3;
      this.reports = 0;
    }

    begin(ctx) {
      if (ctx.phase.id !== "plan") return;
      this.ask({ id: `teams-${ctx.round}`, title: "How many emergency teams this year?", text: "The second team is the dearer one.", options: [{ id: "1", label: "One team" }, { id: "2", label: "Two teams" }], fallback: "2", then: (o) => (this.teams = Number(o)) });
    }

    spend(amount, urgent) {
      if (amount > this.value("money")) return { ok: false, reason: "That is more than the money left." };
      this.add("money", -amount);
      this.grade = Math.max(1, this.grade - amount / 40);
      this.log(`Spent ${amount} k€ on upkeep${urgent ? ", the urgent work first" : ""}.`);
      return { ok: true };
    }

    take(msg) {
      this.reports++;
      this.log(`A report on ${msg.payload.kind}: ${msg.payload.score} points.`);
    }

    finish(ctx) {
      if (ctx.phase.id !== "plan") return;
      this.give("staff-plan", { teams: this.teams, on_call: true });
      this.give("asset-condition", { grade: this.grade });
    }

    objectives() {
      return [{ id: "money", label: "Money kept", weight: 100, value: this.value("money") / 100, note: `${this.value("money")} k€ left` }];
    }

    view() {
      return {
        figures: [{ label: "Money", value: this.value("money"), unit: "k€" }, { label: "Reports read", value: this.reports }],
        tables: [{ id: "plan", title: "The plan", columns: ["", "Value"], rows: [["Teams", this.teams], ["Grade of the assets", this.grade]] }],
        actions: [{
          name: "spend", label: "Spend on upkeep",
          fields: [{ id: "amount", label: "Amount", type: "number", min: 0, max: 100, step: 10, value: 20, unit: "k€" }, { id: "urgent", label: "The urgent work first", type: "check" }],
        }],
      };
    }
  }
  const p = window.__play;
  p.games = new Map([...p.games, [PlanGame.id, PlanGame]]);
  p.route();
});

test("turns with a game of the test's own: a move with a number and a checkbox, what the page and the game refuse, a mission without its game", async ({ page }) => {
  await page.route("**/game/missions/missions.json", (r) => r.fulfill({ json: { format: "arail-missions/1", missions: ["neustadt-morning.json", "test-years.json"] } }));
  await page.route("**/game/missions/test-years.json", (r) => r.fulfill({ json: YEARS }));
  const errors = await open(page, `${PAGE}?mission=test-years`);
  // a mission with a game the page does not have cannot be played
  const card = cardOf(page, "test-years");
  await expect(card).toContainText('This mission cannot be played here: seat asset-manager: there is no game "test-plan".');
  await expect(page.locator("#setup")).toBeHidden();
  await addPlanGame(page);
  await expect(page.locator("#setup")).toContainText("2 rounds: The year's plan (a turn), A morning (a shift of 5 min), The year's account (a turn).");
  const plan$ = await flowName(page, "staff-plan");
  await expect(page.locator(".play-wiring tbody tr").first()).toContainText(`${plan$} to Maintenance and fault dispatcher`);
  // what the seat's game must be told before it begins
  await expect(page.getByLabel("A note for the plan")).toHaveValue("none");
  await page.getByLabel("A note for the plan").fill("year one");
  await page.getByRole("button", { name: "Start" }).click();
  expect(await page.evaluate(() => window.__play.session.seat("asset-manager").game.note)).toBe("year one");

  // the plan of year 1: a turn, no clock
  await expect(page.locator("#where")).toHaveText("Round 1 of 2 · The year's plan");
  await expect(page.locator("#phases li")).toHaveText(["The year's plan (turn)", "A morning (shift)", "The year's account (turn)"]);
  await expect(page.locator('#phases li[aria-current="step"]')).toHaveText("The year's plan (turn)");
  await expect(page.locator("#shiftBar")).toBeHidden();
  const panel = page.locator("#seat-asset-manager");
  await expect(panel.locator("h3")).toHaveText("A year of the assets");
  const end = page.locator("#endTurn");
  await expect(end).toHaveText("End the turn (1 open)");
  await expect(end).not.toHaveClass(/primary/);
  await expect(page.locator("#turnNote")).toHaveText("1 of your decisions is still open. Ending the turn decides it by its fallback.");
  await expect(page.locator("#live")).toContainText("Round 1 of 2. The year's plan: a turn.");
  await expect(page.locator("#live")).toContainText("Asset manager: How many emergency teams this year?");
  const decision = panel.locator(".play-decision");
  await expect(decision).toContainText("Still open at the end of the turn: Two teams");
  await decision.getByRole("button", { name: "One team" }).click();
  await expect(end).toHaveText("End the turn");
  await expect(end).toHaveClass(/primary/);
  // the move: a number within its limits, a checkbox; what the game refuses
  const spend = panel.locator(".play-move");
  const amount = spend.getByLabel("Amount (k€)");
  await expect(amount).toHaveValue("20");
  await expect(amount).toHaveAttribute("max", "100");
  await amount.fill("200");
  await spend.getByRole("button", { name: "Spend on upkeep" }).click();
  await expect(spend.getByRole("status")).toHaveText("Amount: at most 100 k€.");
  await amount.fill("80");
  await spend.getByLabel("The urgent work first").check();
  await spend.getByRole("button", { name: "Spend on upkeep" }).click();
  await expect(panel.locator(".play-log li").first()).toHaveText("Spent 80 k€ on upkeep, the urgent work first.");
  await expect(panel.locator(".play-figures div").first()).toHaveText("Money20 k€");
  await expect(spend.getByLabel("The urgent work first")).not.toBeChecked();
  await amount.fill("40");
  await spend.getByRole("button", { name: "Spend on upkeep" }).click();
  await expect(spend.getByRole("status")).toHaveText("That is more than the money left.");
  await expect(panel.locator(".play-table")).toContainText("Teams1");

  // the turn ends: the plan reaches the shift as state flows; nobody of the people works in the shift
  await end.focus();
  await end.click();
  await expect(page.locator("#where")).toHaveText("Round 1 of 2 · A morning");
  await expect(page.locator("#stripTitle")).toBeFocused();
  await expect(page.locator("#turnBar")).toBeHidden();
  await expect(panel).toContainText("Not at work in this phase. This is its last state.");
  await expect(panel.locator(".play-move")).toHaveCount(0);
  await expect(page.locator("#tab-asset-manager")).toContainText("not at work");
  const flows = page.locator("#flowList li");
  await expect(flows.filter({ hasText: plan$ })).toContainText("Round 1 · The year's plan");
  await expect(flows.filter({ hasText: plan$ })).toContainText("Asset manager → Maintenance and fault dispatcher");
  await expect(flows.filter({ hasText: plan$ })).toContainText("teams: 1 · on call: yes");
  await expect(flows.filter({ hasText: await flowName(page, "asset-condition") })).toContainText("grade: 1");
  expect(await page.evaluate(() => window.__play.session.seat("maintenance-dispatcher").game.teams.length)).toBe(1);
  await page.getByRole("button", { name: "Skip to the end of the shift" }).click();

  // the account: the shift's reports have come; nothing to decide, the turn can be ended
  await expect(page.locator("#where")).toHaveText("Round 1 of 2 · The year's account");
  await expect(panel.locator(".play-figures")).toContainText("Reports read2");
  await expect(flows.filter({ hasText: await flowName(page, "performance-report") }).first()).toContainText("Round 1 · 08:05:00");
  await expect(end).toHaveClass(/primary/);
  await expect(page.locator("#turnNote")).toHaveText("Nothing is left for you to decide in this turn.");
  await end.click();

  // year 2: the decision left open is taken by its fallback
  await expect(page.locator("#where")).toHaveText("Round 2 of 2 · The year's plan");
  await expect(end).toHaveText("End the turn (1 open)");
  await end.click();
  expect(await page.evaluate(() => window.__play.session.seat("asset-manager").game.teams)).toBe(2);
  await page.getByRole("button", { name: "Skip to the end of the shift" }).click();
  await expect(page.locator("#where")).toHaveText("Round 2 of 2 · The year's account");
  // a turn is resumed where it stood
  await page.reload();
  await page.waitForFunction(() => window.__play?.ready);
  await addPlanGame(page);
  await expect(page.locator("#setup")).toContainText("saved in this browser (round 2 of 2, The year's account)");
  await expect(page.getByLabel("A note for the plan")).toHaveValue("year one");
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.locator("#where")).toHaveText("Round 2 of 2 · The year's account");
  await expect(page.locator("#seat-asset-manager .play-figures")).toContainText("Reports read4");
  await page.locator("#endTurn").click();

  // the result: every seat with its two rounds
  await expect(page.locator("#resultTitle")).toHaveText("The result: Two budget years");
  const seats = page.locator(".play-result-seats .game-card");
  await expect(seats).toHaveCount(3);
  await expect(seats.first().locator("tbody tr")).toHaveText([/^1\s*the whole round\s*20\s*not passed\s*0$/, /^2\s*the whole round\s*20\s*not passed\s*0$/]);
  await expect(seats.first()).toContainText("Objectives of round 2");
  await expect(seats.nth(1).locator("tbody tr")).toHaveCount(2);
  await expect(seats.nth(1).locator("tbody tr").first()).toContainText("A morning");
  await expect(page.locator("#result .play-debrief li")).toHaveText(["What did the second team cost, and what did it save?"]);
  expect(errors).toEqual([]);
});
