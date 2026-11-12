// End-to-end tests of the play page of the big game (game/play/), which is played as a game: the
// missions as stops on a line (the next one chosen by itself, the arrows, stars after a mission
// passed), a mission chosen with its seats and started, a phase's name over the screen; the stage of
// a seat (the seats as tabs with the keyboard, the game's picture with what is chosen in it, a turn
// told line by line before its decisions, the mission's story, a railway term explained, a decision
// with a deadline, one decision at a time and the number keys), the desk as a dialog (a move through
// its form and a refused one), the flows between the roles, a seat taken over and handed back, only
// the picture, the sound; the verdict with its stars, what it keeps in the browser and the full
// report; autosave and resume, a phone; turns with the missions of the site (budget years alone;
// three years of six roles); what a seat's game is told before it begins; and the fields of a move
// a real game does not have yet (a number, limits), with a mission and a slow role's game of the
// test's own (the page's `games` take one more game; nothing is added to GAMES).
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const PAGE = "/game/play/", MORNING = `${PAGE}?mission=neustadt-morning`;
const SIGNALLER = "#seat-signaller-relay", MAINTENANCE = "#seat-maintenance-dispatcher", ASSETS = "#seat-asset-manager";
/** Where the pages keep what a player has reached (game/progress.js). */
const PROGRESS = "arail.game.progress";

/** The missions of the line in their order: missions.json and the documents it lists. */
const MISSIONS = new URL("../../web/game/missions/", import.meta.url);
const LINE = JSON.parse(readFileSync(new URL("missions.json", MISSIONS), "utf8")).missions.map((file) => JSON.parse(readFileSync(new URL(file, MISSIONS), "utf8")));
const missionOf = (id) => LINE.find((m) => m.id === id);

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

/** Start a mission that begins with a shift (the morning at Bf Neustadt, the signaller's seat for the person) and pause it. */
async function start(page, path = MORNING) {
  const errors = await open(page, path);
  await page.locator("#start").click();
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

/**
 * Read on at a seat's stage until nothing is left to read: what happened, line by line (Next, To
 * the decisions, Go on), and what the people of the mission's story say (OK). After it the stage
 * shows the decisions, or that there is nothing to decide.
 */
const readOn = (page, seat) => page.evaluate((sel) => {
  const story = document.querySelector(`${sel} .vn-story`);
  for (let i = 0; i < 300 && !story.hidden; i++) story.querySelector(".btn.primary").click();
}, seat);

/** The lines of the mission's story for the phase played now, in the order they are said. */
const storyNow = (page) => page.evaluate(async () => {
  const { storyOf } = await import("/arail/game/index.js");
  const s = window.__play.session;
  return storyOf(s.mission, s.phase.id, s.round);
});

/**
 * A person plays a seat to the end of the shift, with the moves the computer would make: before
 * every tick the game's computer player thinks, and each move it wants is made as the person's,
 * through the session (as the page's forms make them). The seat is the person's all through, and
 * the score is worth its stars.
 */
const playOut = (page, seat) => page.evaluate((id) => {
  const p = window.__play, s = p.session, at = s.seat(id), tick = s.phase.tick;
  const hands = new Proxy(at.game, {
    get: (g, key) => (key === "act" ? (name, ...args) => s.act(id, name, ...args) : typeof g[key] === "function" ? g[key].bind(g) : g[key]),
  });
  for (let i = 0; i < 1e5 && !s.over; i++) {
    at.player.think(hands, s);
    s.step(tick);
  }
  p.draw(true);
}, seat);

/** Keep a progress in the browser: missions played, as `record` of game/progress.js writes them. */
const keep = (page, plays) => page.evaluate(async ([key, list]) => {
  const { emptyProgress, record } = await import("/game/progress.js");
  localStorage.setItem(key, JSON.stringify(list.reduce((p, played) => record(p, played), emptyProgress())));
}, [PROGRESS, plays]);

/** The progress kept in the browser, or null. */
const kept = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), PROGRESS);

/** The stars of a round, as game/progress.js gives them. */
const starsFor = (score, passed) => (passed ? 1 + (score >= 70) + (score >= 85) : 0);

/** What is said to those who do not see the page: the live region (the backdrop's canvas is not it). */
const live = (page) => page.locator("p#live");

/** A mission's stop on the line. */
const stopOf = (page, id) => page.locator(`#missions a#mission-${id}`);
/** A class among others. */
const cls = (name) => new RegExp(`(^|\\s)${name}(\\s|$)`);

/** A seat's stage, and its desk (a dialog in its panel). */
const stageOf = (page, seat) => page.locator(`${seat} .vn-stage`);
const deskOf = (page, seat) => page.locator(`${seat} dialog.play-desk`);
/** A button among a seat's tools, below its stage. */
const tool = (page, seat, name) => part(page, seat, ".vn-tools").getByRole("button", { name, exact: typeof name === "string" });
/**
 * A part of a seat that is not in its panel: its figures and the note on its state in the line at the top
 * (`.vn-gauges`, `.vn-note`), its tools at the side (`.vn-tools`), its messages under the bell (`.play-log`).
 */
const part = (page, seat, sel) => page.locator(`${sel}[data-seat="${seat.replace(/^#seat-/, "")}"]`);
/** The names of a seat's tools at the side (icons, named by their labels). */
const toolNames = (page, seat) => part(page, seat, ".vn-tools").locator("button").evaluateAll((list) => list.map((b) => b.getAttribute("aria-label")));
/** The pop-up message shown now. */
const toast = (page) => page.locator("#toast");

/** Open a seat's desk from its stage. */
async function openDesk(page, seat) {
  await tool(page, seat, "Desk").click();
  await expect(deskOf(page, seat)).toBeVisible();
}

/** Close the dialog that is open (a desk, the flows, the report) with its own button. */
const closeDialog = (page) => page.locator("dialog[open] .play-dialog-head").getByRole("button", { name: "Close" }).click();

/** Open what the roles give each other. */
async function openFlows(page) {
  await page.locator("#showFlows").click();
  await expect(page.locator("#flowsDialog")).toBeVisible();
}

/** The form of a move on a seat's desk. */
const move = (page, seat, label) => page.locator(`${seat} .play-move`).filter({ has: page.getByRole("button", { name: label, exact: true }) });
/** A table on a seat's desk, by its title. */
const tableOf = (page, seat, title) => page.locator(`${seat} .play-table`).filter({ has: page.locator("h4", { hasText: title }) });

/** The name of a flow, as the catalogue of flows has it. */
const flowName = (page, id) => page.evaluate(async (flow) => (await import("/arail/game/index.js")).flowOf(flow).name, id);

const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

/* ---------------------------------------------------------------- the line, a mission chosen */

test("the line of missions: the next one not passed is chosen by itself, the arrows go along it, a mission passed shows its stars", async ({ page }) => {
  const errors = await open(page);
  const ids = LINE.map((m) => m.id), stops = page.locator("#missions a.lv-stop");
  const first = stopOf(page, ids[0]), second = stopOf(page, ids[1]), last = stopOf(page, ids.at(-1));
  expect(await stops.evaluateAll((list) => list.map((a) => a.id))).toEqual(ids.map((id) => `mission-${id}`));
  await expect(page.locator("#missionsNote")).toBeHidden();
  // nothing played yet: the first mission is the one to play next, and it is chosen though the address names none
  await expect(page).toHaveURL(/\/game\/play\/$/);
  await expect(first).toHaveClass(cls("on"));
  await expect(first).toHaveClass(cls("next"));
  await expect(first).toHaveAttribute("aria-current", "true");
  await expect(first).toHaveAttribute("href", `?mission=${ids[0]}`);
  await expect(first.locator(".no")).toHaveText("01");
  await expect(first.locator(".name")).toHaveText(LINE[0].title);
  await expect(first.locator(".stars .visually-hidden")).toHaveText("0 of 3 stars");
  await expect(first.locator(".tag")).toHaveText("next");
  await expect(page.locator("#missions .lv-stop.next")).toHaveCount(1);
  await expect(page.locator("#missions .lv-stop.on")).toHaveCount(1);
  await expect(page.locator("#missions .lv-stop.done")).toHaveCount(0);
  await expect(page.locator("#setupTitle")).toHaveText(LINE[0].title);
  await expect(page.locator("#setup .play-no")).toHaveText("Mission 01");
  await expect(page.locator("#setup .play-hook")).toHaveText(LINE[0].hook);
  // the rank the stars add up to leads to the logbook
  const rank = page.locator("#rank");
  await expect(rank).toHaveAttribute("href", "../logbook/");
  await expect(rank).toContainText("0 stars");
  await expect(rank.locator("strong")).toHaveText("Passenger");
  // the little train stands at the stop chosen
  const train = page.locator(".lv-train");
  const trainAt = () => page.evaluate(() => {
    const li = document.querySelector("#missions .lv-stop.on").parentElement;
    return [parseFloat(document.querySelector(".lv-train").style.left), li.offsetLeft + li.offsetWidth / 2];
  });
  const [at0, stop0] = await trainAt();
  expect(at0).toBeCloseTo(stop0, 0);

  // the arrows step along the line and round its ends; the address follows, the stop to play next stays marked
  await page.keyboard.press("ArrowRight");
  await expect(second).toHaveClass(cls("on"));
  await expect(first).not.toHaveClass(cls("on"));
  await expect(first).toHaveClass(cls("next"));
  await expect(page).toHaveURL(new RegExp(`\\?mission=${ids[1]}$`));
  await expect(page.locator("#setupTitle")).toHaveText(LINE[1].title);
  await expect(page.locator("#setupTitle")).toBeFocused();
  await expect(page.locator("#setup .play-no")).toHaveText("Mission 02");
  const [at1, stop1] = await trainAt();
  expect(at1).toBeCloseTo(stop1, 0);
  expect(at1).toBeGreaterThan(at0);
  await page.keyboard.press("ArrowLeft");
  await expect(first).toHaveClass(cls("on"));
  await page.keyboard.press("ArrowLeft");
  await expect(last).toHaveClass(cls("on"));
  await expect(page.locator("#setupTitle")).toHaveText(LINE.at(-1).title);
  await page.keyboard.press("ArrowRight");
  await expect(first).toHaveClass(cls("on"));
  // in a field the arrows are the field's own
  await page.locator("#setup details.play-more summary").click();
  await page.locator("#seed").focus();
  await page.keyboard.press("ArrowRight");
  await expect(first).toHaveClass(cls("on"));
  // "back" is the mission before
  await second.click();
  await expect(second).toHaveClass(cls("on"));
  await page.goBack();
  await expect(first).toHaveClass(cls("on"));
  await expect(page.locator("#setupTitle")).toHaveText(LINE[0].title);
  // the train has a horn: T, or a click on it
  await expect(train).not.toHaveClass(cls("honk"));
  await page.keyboard.press("t");
  await expect(train).toHaveClass(cls("honk"));
  await train.evaluate((el) => el.classList.remove("honk"));
  await train.click();
  await expect(train).toHaveClass(cls("honk"));

  // a mission tried and not passed keeps its place as the next one, without a star
  const role = LINE[0].roles[0].role;
  await keep(page, [{ mission: ids[0], score: 40, passed: false, roles: [role] }]);
  await page.goto(PAGE);
  await page.waitForFunction(() => window.__play?.ready);
  await expect(first).toHaveClass(cls("on"));
  await expect(first).toHaveClass(cls("next"));
  await expect(first).not.toHaveClass(cls("done"));
  await expect(page.locator("#setup .play-no")).toContainText("best 40");
  await expect(rank.locator("strong")).toHaveText("Passenger");
  // passed with 90 points: three stars on its stop, the rank they add up to, and the second mission is next and chosen
  await keep(page, [{ mission: ids[0], score: 40, passed: false, roles: [role] }, { mission: ids[0], score: 90, passed: true, roles: [role] }]);
  await page.goto(PAGE);
  await page.waitForFunction(() => window.__play?.ready);
  await expect(first).toHaveClass(cls("done"));
  await expect(first).not.toHaveClass(cls("next"));
  await expect(first.locator(".stars .visually-hidden")).toHaveText("3 of 3 stars");
  await expect(first.locator(".tag")).toHaveCount(0);
  await expect(second).toHaveClass(cls("on"));
  await expect(second).toHaveClass(cls("next"));
  await expect(second.locator(".tag")).toHaveText("next");
  await expect(page).toHaveURL(/\/game\/play\/$/);
  await expect(page.locator("#setupTitle")).toHaveText(LINE[1].title);
  await expect(rank).toContainText("3 stars");
  await expect(rank.locator("strong")).toHaveText("Trainee");
  // the mission passed, chosen again: its stars and its best score
  await first.click();
  await expect(page.locator("#setup .play-no .stars .visually-hidden")).toHaveText("3 of 3 stars");
  await expect(page.locator("#setup .play-no")).toContainText("best 90");
  // every mission passed: the line begins anew at its first stop
  await keep(page, ids.map((id) => ({ mission: id, score: 72, passed: true })));
  await page.goto(PAGE);
  await page.waitForFunction(() => window.__play?.ready);
  await expect(page.locator("#missions .lv-stop.done")).toHaveCount(ids.length);
  await expect(first).toHaveClass(cls("on"));
  await expect(first.locator(".stars .visually-hidden")).toHaveText("2 of 3 stars");
  expect(errors).toEqual([]);
});

test("a mission is chosen and started: its stop, its seats, the briefing and the wiring behind a fold, the session's bar", async ({ page }) => {
  const errors = await open(page);
  const doc = missionOf("neustadt-morning"), stop = stopOf(page, "neustadt-morning"), setup = page.locator("#setup");
  await expect(stop.locator(".name")).toHaveText("A morning at Bf Neustadt");
  await expect(stop.locator(".no")).toHaveText(String(LINE.indexOf(doc) + 1).padStart(2, "0"));
  await stop.click();
  await expect(page).toHaveURL(/\?mission=neustadt-morning$/);
  await expect(stop).toHaveClass(cls("on"));
  await expect(page.locator("#setupTitle")).toHaveText("A morning at Bf Neustadt");
  await expect(page.locator("#setupTitle")).toBeFocused();
  await expect(setup.locator(".play-hook")).toHaveText(doc.hook);
  await expect(setup.locator(".facts li")).toHaveText(["2 roles", "40 min on the clock", "together"]);
  // the seats as the mission suggests them: a seat taken is the person's, the others are the computer's
  await expect(setup.locator(".lv-seats legend")).toHaveText("Take your seats");
  await expect(setup.locator("label.lv-seat .name")).toHaveText(["Signaller in a relay interlocking", "Maintenance and fault dispatcher"]);
  await expect(page.getByRole("checkbox", { name: "Signaller in a relay interlocking" })).toBeChecked();
  await expect(page.locator("#by-signaller-relay")).toBeChecked();
  await expect(page.locator("#by-maintenance-dispatcher")).not.toBeChecked();
  const who = (id) => page.evaluate((seat) => getComputedStyle(document.querySelector(`label[for="by-${seat}"] .who`), "::after").content, id);
  expect([await who("signaller-relay"), await who("maintenance-dispatcher")]).toEqual(['"you"', '"computer"']);
  // a click anywhere on a seat takes it; Space on it gives it back
  await setup.locator("label.lv-seat").nth(1).click();
  await expect(page.locator("#by-maintenance-dispatcher")).toBeChecked();
  expect(await who("maintenance-dispatcher")).toBe('"you"');
  expect(await page.evaluate(() => window.__play.choice.seats)).toEqual({ "signaller-relay": "human", "maintenance-dispatcher": "human" });
  await page.locator("#by-maintenance-dispatcher").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#by-maintenance-dispatcher")).not.toBeChecked();
  expect(await page.evaluate(() => window.__play.choice.seats["maintenance-dispatcher"])).toBe("computer");
  // what nobody needs to start is behind one fold: the briefing, the phases, the seed, the wiring
  const more = setup.locator("details.play-more");
  await expect(more.locator("summary")).toHaveText("Briefing and settings");
  await expect(page.locator("#seed")).toBeHidden();
  await expect(setup.locator(".play-wiring")).toBeHidden();
  await more.locator("summary").click();
  await expect(more.locator("p").first()).toHaveText(doc.text);
  await expect(more).toContainText("1 round: The morning shift (a shift of 40 min).");
  await expect(page.locator("#seed")).toHaveValue("1");
  const wiring = page.locator(".play-wiring tbody tr");
  await expect(wiring.first()).toContainText(`${await flowName(page, "fault-report")} to Maintenance and fault dispatcher`);
  await expect(wiring.first()).toContainText(`${await flowName(page, "repair-status")} from Maintenance and fault dispatcher`);
  await expect(wiring.first()).toContainText(`${await flowName(page, "asset-condition")} from itself`);
  // nothing is saved: Play, and no Resume
  await expect(page.locator("#resume")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toHaveAttribute("id", "start");
  await expect(page.locator("#start")).toHaveClass(cls("primary"));
  await expect(page.locator(".site-bar")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-screen", "choose");
  await page.locator("#start").click();
  await expect(page.locator("#stripTitle")).toHaveText("A morning at Bf Neustadt");
  await expect(page.locator("#stripTitle")).toBeFocused();
  // while a session is played the site's bar and foot make way
  await expect(page.locator("body")).toHaveAttribute("data-screen", "play");
  await expect(page.locator("#main")).toHaveAttribute("data-screen", "play");
  // the page's bar stays, for the way to the other pages
  await expect(page.locator(".site-bar")).toBeVisible();
  await expect(page.locator(".site-nav a[href='../logbook/']")).toBeVisible();
  await expect(page.locator("#choose")).toBeHidden();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.locator("#where")).toHaveText("The morning shift");
  await expect(page.locator("#missionWhere")).toHaveText("The morning shift");
  await expect(page.locator("#phases li")).toHaveText(["The morning shift (shift)"]);
  await expect(page.locator("#phases li")).toHaveAttribute("aria-current", "step");
  await expect(page.locator("#clock")).toHaveText(/^08:00:0\d$/);
  await expect(page.locator("#turnBar")).toBeHidden();
  await expect(page.locator("#flowBadge")).toHaveText("0");
  await expect(page.getByRole("tab")).toHaveCount(2);
  // the stage of the person's seat: where the role works, the figures as gauges, the game's picture, the tools
  const stage = stageOf(page, SIGNALLER);
  // where the seat works is behind the pin at the side; the mission's name behind the flag (and nowhere else on the screen)
  await page.locator("#placeBtn").click();
  await expect(page.locator("#placePanel")).toBeVisible();
  await expect(page.locator("#placeBtn")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#placePanel .vn-where .place-label")).toHaveText("Where you work");
  await page.locator("#missionBtn").click();
  await expect(page.locator("#placePanel")).toBeHidden();
  await expect(page.locator("#missionName")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#missionPanel")).toBeHidden();
  await expect(page.locator("#missionBtn")).toBeFocused();
  expect(await page.evaluate((title) => [...document.querySelectorAll("#play *")].filter((el) => !el.closest("#chapter, .visually-hidden") && el.checkVisibility?.() && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes(title))).length, "A morning at Bf Neustadt")).toBe(0);
  await expect(page.locator("#placePanel .vn-where strong")).toHaveText(await page.evaluate(async () => (await import("/game/places.js")).placeOfGame("signaller").name));
  await expect(part(page, SIGNALLER, ".vn-gauges").locator("dt")).toContainText(["Trains through"]);
  await expect(stage.locator(".play-sketch")).toBeVisible();
  await expect(stage.locator(".vn-name strong")).toHaveText("You");
  await expect(stage.locator(".vn-name span")).toHaveText("Signaller in a relay interlocking");
  await expect(part(page, SIGNALLER, ".vn-note")).toHaveText("Nothing to decide just now. Watch the picture: choose something in it to act.");
  // the newest message pops up; the seat's tools are icons at the side, named
  await expect(toast(page)).toContainText("The shift begins");
  expect(await toolNames(page, SIGNALLER)).toEqual([expect.stringMatching(/^Moves \(\d+\)$/), "Desk", "Hand to the computer"]);
  // the role, the game and the score so far are on the seat's desk, a dialog; D opens it
  const desk = deskOf(page, SIGNALLER);
  await expect(desk).toBeHidden();
  await page.keyboard.press("d");
  await expect(desk).toBeVisible();
  await expect(desk.locator("h3")).toHaveText("Signaller at Bf Neustadt");
  await expect(desk.locator("h3")).toBeFocused();
  await expect(desk.getByRole("link", { name: "Signaller in a relay interlocking" })).toHaveAttribute("href", "../roles/#role-signaller-relay");
  await expect(desk.locator(".play-head")).toContainText("played by you");
  await expect(desk.locator(".score-total")).toBeVisible();
  await expect(part(page, SIGNALLER, ".play-log").locator("li").first()).toContainText("The shift begins");
  await page.keyboard.press("Escape");
  await expect(desk).toBeHidden();
  // P lets the shift run again, and pauses it (what the mission's people say first is heard out, so that nothing else is said meanwhile)
  await run(page, 3);
  await readOn(page, SIGNALLER);
  await page.keyboard.press("p");
  await expect(page.getByRole("button", { name: "1×" })).toHaveAttribute("aria-pressed", "true");
  await expect(live(page)).toContainText("Running at 1×.");
  await page.keyboard.press("p");
  await expect(page.getByRole("button", { name: "Pause" })).toHaveAttribute("aria-pressed", "true");
  await expect(live(page)).toContainText("Paused.");
  // an address that names a mission opens it
  await page.goto(MORNING);
  await page.waitForFunction(() => window.__play?.ready);
  await expect(page.locator("#setupTitle")).toHaveText("A morning at Bf Neustadt");
  await expect(page.locator("body")).toHaveAttribute("data-screen", "choose");
  await expect(page.locator(".site-bar")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a phase begins: its name over the whole screen for a moment; it takes no clicks and goes by itself", async ({ page }) => {
  const errors = await open(page, MORNING);
  // read in the moment the session begins (the name stays for about two seconds)
  const chapter = await page.evaluate(() => {
    document.querySelector("#start").click();
    const el = document.querySelector("#chapter .vn-chapter");
    return el && { lines: [...el.children].map((p) => p.textContent), clicks: getComputedStyle(el).pointerEvents, hidden: el.parentElement.getAttribute("aria-hidden") };
  });
  expect(chapter).toEqual({ lines: ["A morning at Bf Neustadt", "The morning shift", "You: Signaller in a relay interlocking"], clicks: "none", hidden: "true" });
  // what is under it can be used at once
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toHaveAttribute("aria-pressed", "true");
  // those who do not see it hear the phase
  await expect(live(page)).toContainText("The morning shift: a shift.");
  await expect(page.locator("#chapter .vn-chapter")).toHaveCount(0);
  // where less motion is asked for, it is not shown
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${PAGE}?mission=budget-years`);
  await page.waitForFunction(() => window.__play?.ready);
  await page.locator("#start").click();
  await expect(page.locator("#where")).toHaveText("Round 1 of 4 · The year's plan");
  // (on a phone the bar does not show it: the mission's panel at the side says it too)
  await expect(page.locator("#missionWhere")).toHaveText("Round 1 of 4 · The year's plan");
  await expect(page.locator("#chapter .vn-chapter")).toBeHidden();
  await expect(page.locator("#chapter .vn-chapter p")).toHaveText(["Round 1 of 4", "The year's plan", "You: Asset manager"]);
  expect(errors).toEqual([]);
});

/* ---------------------------------------------------------------- the stage and the desk of a seat */

test("the seats are tabs: arrow keys, Home and End; a computer's seat shows a face only, and its desk has no forms", async ({ page }) => {
  const errors = await start(page);
  const tabs = page.getByRole("tab");
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await expect(tabs.first()).toContainText("you");
  await expect(tabs.first()).toHaveClass(cls("mine"));
  await expect(tabs.nth(1)).toContainText("computer");
  await expect(tabs.nth(1)).toHaveClass(cls("theirs"));
  // the seats are faces at the side; their names are said to who does not see them, and are their tooltips
  await expect(tabs.nth(1)).toHaveAccessibleName(/Maintenance and fault dispatcher\s*computer/);
  await expect(tabs.nth(1)).toHaveAttribute("title", "Maintenance and fault dispatcher: the computer");
  await expect(tabs.first().locator(".name")).toHaveCSS("position", "absolute");
  await expect(page.locator("#rail #tabs")).toHaveAttribute("aria-orientation", "vertical");
  await tabs.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(SIGNALLER)).toBeHidden();
  const panel = page.getByRole("tabpanel");
  await expect(panel).toHaveAttribute("id", "seat-maintenance-dispatcher");
  const stage = stageOf(page, MAINTENANCE);
  await expect(stage.locator(".vn-name strong")).toHaveText("The computer");
  await expect(part(page, MAINTENANCE, ".vn-note")).toHaveText("The computer plays this seat. You can watch it, or take over.");
  expect(await toolNames(page, MAINTENANCE)).toEqual(["Desk", "Take over"]);
  // its desk (D): the same numbers, the moves by their names only
  await page.keyboard.press("d");
  const desk = deskOf(page, MAINTENANCE);
  await expect(desk).toBeVisible();
  await expect(desk.locator("h3")).toHaveText("Fault Night");
  await expect(desk.locator(".play-head")).toContainText("played by the computer");
  await expect(desk.locator(".play-move")).toHaveCount(0);
  await expect(desk.locator(".play-moves-note")).toContainText("The computer makes the moves. Take over to make them yourself:");
  await expect(desk.locator(".play-moves-note")).toContainText("Send a team");
  await expect(desk.locator(".play-table h4")).toHaveText(["Faults", "Teams"]);
  // while a dialog is open, the keys of the stage rest
  await page.keyboard.press("h");
  await expect(page.locator("body")).not.toHaveClass(cls("bare"));
  await closeDialog(page);
  await expect(desk).toBeHidden();
  await tabs.nth(1).focus();
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

test("a move through its form on the desk: a route is set; a move the game refuses shows why", async ({ page }) => {
  const errors = await start(page);
  // the moves are on the seat's desk: the stage's button opens it at its moves
  const desk = deskOf(page, SIGNALLER);
  await tool(page, SIGNALLER, /^Moves \(\d+\)$/).click();
  await expect(desk).toBeVisible();
  await expect(desk.locator(".play-moves h4")).toBeFocused();
  const set = move(page, SIGNALLER, "Set a route");
  // nothing chosen: the page asks for it, the game is not asked
  await set.getByRole("button", { name: "Set a route" }).click();
  await expect(set.getByRole("status")).toHaveText("Choose: From → to.");
  await set.getByLabel("From → to").selectOption("A-G2");
  // the choice stays while the panel is drawn anew
  await page.evaluate(() => window.__play.draw(true));
  await expect(set.getByLabel("From → to")).toHaveValue("A-G2");
  await set.getByRole("button", { name: "Set a route" }).click();
  const routes = tableOf(page, SIGNALLER, "Routes set");
  await expect(routes.locator("tbody tr")).toContainText(["A → G2"]);
  await expect(set.getByRole("status")).toHaveText("");
  await expect(part(page, SIGNALLER, ".play-log").locator("li").first()).toContainText("Route A → G2 set.");
  expect(await page.evaluate(() => window.__play.session.record.map((m) => [m.seat, m.name, ...m.args]))).toEqual([["signaller-relay", "setRoute", "A-G2"]]);
  // the track of a locked route cannot be closed: the game says why
  const close = move(page, SIGNALLER, "Close a track");
  await close.getByLabel("Track").selectOption("G2");
  await close.getByRole("button", { name: "Close a track" }).click();
  await expect(close.getByRole("status")).toHaveText("G2 is locked by route A-G2.");
  await expect(close.getByLabel("Track")).toHaveValue("G2");
  // RB 31 comes and stops at G2
  await run(page, 230);
  await expect(tableOf(page, SIGNALLER, "Trains").locator("tbody tr").filter({ has: page.locator("th", { hasText: "RB 31" }) })).toContainText("at G2");
  // Escape closes the desk; the focus is back on the stage, whose gauges and newest message have followed
  await page.keyboard.press("Escape");
  await expect(desk).toBeHidden();
  await expect(tool(page, SIGNALLER, /^Moves \(\d+\)$/)).toBeFocused();
  const stage = stageOf(page, SIGNALLER);
  await expect(part(page, SIGNALLER, ".vn-gauges").locator("div").filter({ hasText: "Trains through" }).locator("dd")).toHaveText(/^\d of 9$/);
  await expect(toast(page)).toHaveText(await page.evaluate(() => window.__play.session.seat("signaller-relay").game.logs.at(-1).text));
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
  await expect(a).toHaveClass(cls("pick"));
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
  await expect(page.locator(`${MAINTENANCE} .play-pick .hint`)).toHaveCount(0);
  await expect(map.locator(".tag")).toHaveCount(2);
  await tool(page, MAINTENANCE, "Take over").click();
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

test("the failure: decisions are announced and asked one at a time; answered, the fault report and the repair status pass between the roles", async ({ page }) => {
  const errors = await start(page);
  await run(page, 790);
  const stage = stageOf(page, SIGNALLER), decisions = stage.locator(".play-decision"), asked = stage.locator(".play-decision:not(.waiting)"), waiting = stage.locator(".play-decision.waiting .play-next");
  await expect(decisions).toHaveCount(2);
  await expect(live(page)).toContainText("2 decisions to take.");
  await expect(live(page)).toContainText("Signal N2 has failed.");
  await expect(page.locator("#tab-signaller-relay")).toContainText("2 decisions open");
  await expect(page.locator("#tab-signaller-relay .tag")).toHaveText("2");
  // in a shift what is asked comes before what the mission's people have to say
  await expect(stage.locator(".vn-story")).toBeHidden();
  // one decision in full, asked by somebody with a face, its options numbered as their keys; the other waits as its title
  await expect(stage.locator(".vn-count")).toHaveText("Decision 1 of 2");
  await expect(asked).toHaveCount(1);
  await expect(asked.locator("h5")).toHaveText("Signal N2 has failed. Report the fault to the maintenance dispatcher?");
  await expect(asked.locator(".text")).toContainText("The dispatcher sends the repair team");
  await expect(asked.locator(".play-options-row .btn")).toHaveText(["1Report it now", "2Later"]);
  await expect(asked.locator(".vn-countdown")).toHaveCount(0);
  await expect(stage.locator(".vn-name strong")).toHaveText("R. Dohle");
  await expect(stage.locator(".vn-speaker img")).toHaveAttribute("alt", /\S/);
  await expect(waiting).toHaveText("Exit signal N2 cannot show a proceed aspect. How can RB 33 leave track G2?");
  // the one that waits is put in focus by its title, and the first again
  await waiting.click();
  await expect(stage.locator(".vn-count")).toHaveText("Decision 2 of 2");
  await expect(asked.locator("h5")).toHaveText("Exit signal N2 cannot show a proceed aspect. How can RB 33 leave track G2?");
  await expect(asked.locator(".play-options-row .btn")).toHaveCount(3);
  // the title that was pressed is gone: the focus goes on into the decision now shown
  await expect(asked.locator(".play-options-row .btn").first()).toBeFocused();
  await waiting.click();
  await expect(asked.locator("h5")).toHaveText("Signal N2 has failed. Report the fault to the maintenance dispatcher?");
  await asked.getByRole("button", { name: "Later" }).focus();
  await asked.getByRole("button", { name: "Report it now" }).click();
  await expect(decisions).toHaveCount(1);
  await expect(stage.locator(".vn-count")).toHaveText("A decision");
  // the focus goes on to the next decision
  await expect(asked.locator(".play-options-row .btn").first()).toBeFocused();
  // its number key takes an option
  await expect(asked.locator(".play-options-row .btn").nth(1)).toHaveText(/^2With the substitute signal Zs 1/);
  await page.keyboard.press("2");
  await expect(decisions).toHaveCount(0);
  expect(await page.evaluate(() => window.__play.session.record.map((m) => [m.name, ...m.args]))).toEqual([["decide", "report", "now"], ["decide", "quiz-failure", "zs1"]]);
  expect(await page.evaluate(() => window.__play.diary.map((d) => [d.who, d.chose.slice(0, 31), d.round]))).toEqual([["Signaller in a relay interlocking", "Report it now", 1], ["Signaller in a relay interlocking", "With the substitute signal Zs 1", 1]]);
  // nothing is asked any more: who of the mission's story has something to say says it now; then the stage is quiet
  await readOn(page, SIGNALLER);
  await expect(part(page, SIGNALLER, ".vn-note")).toHaveText("Nothing to decide just now. Watch the picture: choose something in it to act.");
  await expect(toast(page)).toHaveText("Right.");
  await expect(part(page, SIGNALLER, ".play-log").locator("li").first()).toContainText("Right.");
  await expect(page.locator("#tab-signaller-relay .tag")).toHaveCount(0);
  await run(page, 2);
  // what the roles give each other is a dialog; its button counts the flows
  const flows = page.locator("#flowList li"), report$ = await flowName(page, "fault-report"), status$ = await flowName(page, "repair-status");
  await expect(page.locator("#flowBadge")).toHaveText(String(await page.evaluate(() => window.__play.session.flows.length)));
  await expect(page.locator("#flowsDialog")).toBeHidden();
  await openFlows(page);
  await expect(page.locator("#flowsTitle")).toHaveText("What the roles give each other");
  const fault = flows.filter({ hasText: report$ });
  await expect(fault).toHaveCount(1);
  await expect(fault).toContainText("08:13:10");
  await expect(fault).toContainText("Signaller in a relay interlocking → Maintenance and fault dispatcher");
  await expect(fault).toContainText("fault: N2 · asset: Exit signal N2 · kind: lamp failure · place: Bf Neustadt · track: G2");
  // the dispatcher sends a signalling team as soon as one is free (the session goes on behind the dialog)
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
  await page.locator("#closeFlows").click();
  await expect(page.locator("#flowsDialog")).toBeHidden();
  await expect(page.locator("#showFlows")).toBeFocused();
  // the dispatcher's seat shows the fault
  await page.locator("#tab-maintenance-dispatcher").click();
  await expect(page.locator(`${MAINTENANCE} .play-table`).first()).toContainText("Exit signal N2");
  expect(errors).toEqual([]);
});

test("something in the picture that needs attention pulses; chosen, it says what is known of it, and its figure is not written out", async ({ page }) => {
  const errors = await start(page);
  await run(page, 790);
  const stage = stageOf(page, SIGNALLER), n2 = stage.locator('.play-board .pick[data-id="signal-N2"]');
  // the failed signal: a red pulse on it, and no figure of its own in the line at the top
  await expect(n2).toHaveClass(cls("alert"));
  await expect(n2.locator("circle.pulse")).toHaveClass(cls("pulse-bad"));
  await expect(part(page, SIGNALLER, ".vn-gauges").locator("dt")).not.toContainText(["Signal N2"]);
  await expect(part(page, SIGNALLER, ".vn-gauges").locator("dt")).toContainText(["Trains through", "Late now"]);
  // the other signals do not pulse
  await expect(stage.locator(".play-board .pick.alert")).toHaveCount(1);
  // chosen: what is known of it, with its moves
  await n2.click();
  await expect(stage.locator(".play-asset")).toHaveText(/^Signal N2: failed/);
  await expect(stage.locator(".play-asset")).toHaveClass(cls("tone-bad"));
  // and said, for who does not see the picture
  await expect(live(page)).toContainText("Signal N2: failed");
  // a computer's seat with something that needs attention: it can be chosen to read, without moves
  // (at Fence at the halt at Talsee children are at the track some 20 minutes into the shift: a danger)
  await page.locator("#tab-maintenance-dispatcher").click();
  await run(page, 400);
  const district = stageOf(page, MAINTENANCE), fault = district.locator(".play-board .pick.alert").first();
  await expect(fault).toBeVisible();
  await fault.click();
  await expect(district.locator(".play-picked")).not.toBeEmpty();
  await expect(district.locator(".play-pick button")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("messages: one pops up at a time, a newer one takes its place and it goes by itself; all of them are under the bell, which counts the new ones", async ({ page }) => {
  const errors = await start(page);
  const bell = page.locator("#bellBtn"), badge = page.locator("#bellBadge"), panel = page.locator("#bellPanel");
  const say = (text) => page.evaluate((t) => {
    const p = window.__play;
    p.session.seat("signaller-relay").game.logs.push({ t: 0, kind: "info", text: t });
    p.draw(true);
  }, text);
  await say("First of two.");
  await say("Second of two.");
  await expect(toast(page)).toHaveText("Second of two.");
  await expect(page.locator(".play-toast")).toHaveCount(1);
  const fresh = await page.evaluate(() => window.__play.session.seat("signaller-relay").game.logs.length);
  await expect(badge).toHaveText(String(fresh));
  await expect(bell).toHaveAccessibleName(`Messages, ${fresh} new`);
  // it goes by itself
  await page.evaluate(() => (window.__play.toastUntil = 0));
  await page.evaluate(() => window.__play.draw(true));
  await expect(toast(page)).toBeHidden();
  // the bell: all of them, the newest first; opened, nothing is new any more
  await bell.click();
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused();
  await expect(part(page, SIGNALLER, ".play-log").locator("li").first()).toContainText("Second of two.");
  await expect(part(page, SIGNALLER, ".play-log").locator("li").nth(1)).toContainText("First of two.");
  // each message on its own card, the new ones marked (for screen readers too)
  await expect(part(page, SIGNALLER, ".play-log").locator("li").first()).toHaveClass(cls("new"));
  await expect(part(page, SIGNALLER, ".play-log").locator("li").first()).toContainText("(new)");
  await expect(badge).toBeHidden();
  // with the messages open nothing pops up; a click elsewhere closes them
  await say("Third.");
  await expect(toast(page)).toBeHidden();
  await page.mouse.click(400, 300);
  await expect(panel).toBeHidden();
  await expect(bell).toHaveAttribute("aria-expanded", "false");
  // a pop-up pressed opens the messages
  await say("Fourth.");
  await expect(toast(page)).toHaveText("Fourth.");
  await toast(page).click();
  await expect(panel).toBeVisible();
  await expect(toast(page)).toBeHidden();
  // another seat shown with the messages open: its messages not seen before are marked new there too
  const dispatcher = await page.evaluate(() => window.__play.session.seat("maintenance-dispatcher").game.logs.length);
  expect(dispatcher).toBeGreaterThan(0);
  await page.locator("#tab-maintenance-dispatcher").click();
  await expect(panel).toBeVisible();
  await expect(part(page, MAINTENANCE, ".play-log").locator("li.new")).toHaveCount(Math.min(dispatcher, 40));
  await expect(badge).toBeHidden();
  // a seat shown anew does not pop up what it said before
  await page.keyboard.press("Escape");
  await page.locator("#tab-signaller-relay").click();
  await expect(toast(page)).toBeHidden();
  await page.locator("#tab-maintenance-dispatcher").click();
  await expect(toast(page)).toBeHidden();
  await page.locator("#tab-signaller-relay").click();
  // a long shift: the game keeps only its newest messages, and what is new is still counted right
  await page.evaluate(() => {
    const p = window.__play, g = p.session.seat("signaller-relay").game;
    for (let i = 0; i < 320; i++) g.log(`Message ${i}.`);
    p.draw(true);
  });
  expect(await page.evaluate(() => window.__play.session.seat("signaller-relay").game.dropped)).toBeGreaterThan(0);
  await expect(badge).toHaveText("99+");
  await bell.click();
  await expect(part(page, SIGNALLER, ".play-log").locator("li.new")).toHaveCount(40);
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const p = window.__play, g = p.session.seat("signaller-relay").game;
    for (let i = 0; i < 3; i++) g.log(`After ${i}.`);
    p.draw(true);
  });
  await expect(badge).toHaveText("3");
  expect(errors).toEqual([]);
});

test("the play screen fills the window and does not scroll: the band stays at the bottom, the rail at the side; a long text scrolls in its box", async ({ page }) => {
  const errors = await start(page);
  await run(page, 790);
  const band = stageOf(page, SIGNALLER).locator(".vn-talk"), box = band.locator(".vn-box");
  await expect(band).toBeVisible();
  expect(await page.evaluate(() => [document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth])).toEqual([0, 0]);
  await expect(page.locator(".site-foot")).toBeHidden();
  await expect(page.locator(".site-bar")).toBeVisible();
  // the band ends at the bottom of the window, the rail at its right edge
  const [bottom, right, rail] = await page.evaluate(() => [document.querySelector("#seat-signaller-relay .vn-talk").getBoundingClientRect().bottom, document.querySelector("#rail").getBoundingClientRect().right, innerHeight]);
  expect(Math.abs(bottom - rail)).toBeLessThan(2);
  expect(right).toBe(page.viewportSize().width);
  // the line at the top is one line; the mission's name and where it stands are in the page's bar, not on a phone
  await expect(page.locator("#hud")).not.toHaveClass(cls("wrap"));
  expect(await part(page, SIGNALLER, ".vn-gauges").evaluate((el) => new Set([...el.children].map((c) => Math.round(c.getBoundingClientRect().top))).size)).toBe(1);
  await expect(page.locator(".site-bar .site-where")).toBeVisible();
  await expect(page.locator("#headTitle")).toHaveText("A morning at Bf Neustadt");
  await expect(page.locator("#where")).toHaveText("The morning shift");
  // (the note on a computer's seat: a few words on the screen, the whole sentence for screen readers)
  await page.locator("#tab-maintenance-dispatcher").click();
  await expect(part(page, MAINTENANCE, ".vn-note")).toHaveAttribute("data-short", "The computer plays this seat");
  await expect(part(page, MAINTENANCE, ".vn-note")).toHaveText("The computer plays this seat. You can watch it, or take over.");
  await page.locator("#tab-signaller-relay").click();
  // the wheel does not move it
  await page.mouse.wheel(0, 600);
  expect(await page.evaluate(() => document.querySelector("#seat-signaller-relay .vn-talk").getBoundingClientRect().bottom)).toBe(bottom);
  // a text longer than the band scrolls in the band
  await page.evaluate(() => {
    const p = window.__play, d = p.session.seat("signaller-relay").game.open[0];
    d.text = `${d.text} `.repeat(40);
    p.whole.add(`signaller-relay|${d.id}`);
    p.draw(true);
  });
  expect(await box.evaluate((el) => [el.scrollHeight > el.clientHeight, getComputedStyle(el).overflowY])).toEqual([true, "auto"]);
  expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".site-bar .site-where")).toBeHidden();
  expect(await page.evaluate(() => [document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth])).toEqual([0, 0]);
  expect(errors).toEqual([]);
});

test("a computer's seat is taken over and handed back", async ({ page }) => {
  const errors = await start(page);
  await page.locator("#tab-maintenance-dispatcher").click();
  const panel = page.locator(MAINTENANCE), desk = deskOf(page, MAINTENANCE);
  await tool(page, MAINTENANCE, "Take over").click();
  await expect(page.locator("#tab-maintenance-dispatcher")).toContainText("you");
  await expect(page.locator("#tab-maintenance-dispatcher")).toHaveClass(cls("mine"));
  expect(await toolNames(page, MAINTENANCE)).toEqual(["Moves (2)", "Desk", "Hand to the computer"]);
  // the tools are drawn anew, one more of them in front: the focus stays on the seat's switch
  await expect(tool(page, MAINTENANCE, "Hand to the computer")).toBeFocused();
  await expect(live(page)).toContainText("You play Maintenance and fault dispatcher now.");
  await expect(desk.locator(".play-head")).toContainText("played by you");
  await expect(stageOf(page, MAINTENANCE).locator(".vn-name strong")).toHaveText("You");
  expect(await page.evaluate(() => window.__play.session.seat("maintenance-dispatcher").by)).toBe("human");
  // its moves are forms now, on its desk; a move that cannot be made says why
  await tool(page, MAINTENANCE, "Moves (2)").click();
  await expect(desk).toBeVisible();
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
  await expect(part(page, MAINTENANCE, ".play-log").locator("li").first()).toContainText("The track technician on call, J. Sokół, is called");
  await closeDialog(page);
  await expect(part(page, MAINTENANCE, ".vn-gauges")).toContainText("4 h");
  await expect(toast(page)).toContainText("The track technician on call, J. Sokół, is called");
  // handed back: the seat's switch reads "Take over" again
  const back = tool(page, MAINTENANCE, "Hand to the computer");
  await back.focus();
  await back.click();
  await expect(tool(page, MAINTENANCE, "Take over")).toBeVisible();
  await expect(live(page)).toContainText("The computer plays Maintenance and fault dispatcher now.");
  // the same the other way, with one button less in front: the focus stays on the seat's switch
  await expect(tool(page, MAINTENANCE, "Take over")).toBeFocused();
  await expect(panel.locator(".play-move")).toHaveCount(0);
  await expect(tool(page, MAINTENANCE, /^Moves/)).toHaveCount(0);
  await expect(page.locator("#tab-maintenance-dispatcher")).toHaveClass(cls("theirs"));
  expect(await page.evaluate(() => window.__play.session.record.map((m) => [m.name, ...m.args.slice(0, 1)]))).toEqual([["@seat", "human"], ["callIn", "track"], ["@seat", "computer"]]);
  expect(errors).toEqual([]);
});

/* ---------------------------------------------------------------- reading: a turn, the story, the terms, a deadline */

test("a turn is told before it is decided: Space reads on line by line, then somebody of the story speaks, then the decisions, taken with the number keys", async ({ page }) => {
  const errors = await open(page, `${PAGE}?mission=budget-years`);
  await page.locator("#start").click();
  await expect(page.locator("#where")).toHaveText("Round 1 of 4 · The year's plan");
  const stage = stageOf(page, ASSETS), story = stage.locator(".vn-story"), line = story.locator(".vn-line"), go = story.locator(".btn.primary");
  const game = () => page.evaluate(() => {
    const g = window.__play.session.seat("asset-manager").game;
    return { logs: g.logs.map((l) => l.text), open: g.open.map((d) => ({ id: d.id, title: d.title, options: d.options.map((o) => o.label), fallback: d.options.find((o) => o.id === d.fallback)?.label })) };
  });
  const { logs, open: asked } = await game();
  expect(logs.length).toBeGreaterThan(1);
  expect(asked.length).toBeGreaterThan(1);
  // the game's messages first, one at a time, under the phase's name; the decisions wait behind them
  await expect(line).toHaveText(logs[0]);
  await expect(stage.locator(".vn-name strong")).toHaveText("The year's plan");
  // (who tells is the phase: no role beside its name, and no count of what is left)
  await expect(stage.locator(".vn-name span")).toHaveCount(0);
  await expect(stage.locator(".vn-talk")).toBeVisible();
  await expect(stage.locator(".vn-talk")).toHaveClass(cls("telling"));
  await expect(stage.locator(".vn-speaker")).toBeHidden();
  await expect(go).toHaveText("NextSpace");
  await expect(go).toHaveAccessibleName("Next");
  await expect(stage.locator(".vn-decisions")).toBeHidden();
  await expect(stage.locator(".vn-count")).toBeHidden();
  await expect(toast(page)).toBeHidden();
  // they are open all the same: the bar counts them, and they are announced
  await expect(page.locator("#endTurn")).toHaveText(`End the turn (${asked.length} open)`);
  await expect(live(page)).toContainText(`${asked.length} decisions to take.`);
  // Space reads on (the focus is on the session's title, not on a button)
  await expect(page.locator("#stripTitle")).toBeFocused();
  for (let i = 1; i < logs.length; i++) {
    await page.keyboard.press("Space");
    await expect(line).toHaveText(logs[i]);
  }
  await expect(go).toHaveAccessibleName("To the decisions");
  // a click reads on as well
  await go.click();
  // then what the mission's people say in this phase, each line answered with OK (or Space)
  const lines = await storyNow(page);
  expect(lines.length).toBeGreaterThan(0);
  for (const said of lines) {
    await expect(line).toHaveText(said.say);
    await expect(stage.locator(".vn-name strong")).toHaveText(said.who.name);
    await expect(stage.locator(".vn-talk")).not.toHaveClass(cls("telling"));
    await expect(stage.locator(".vn-speaker img")).toBeVisible();
    await expect(go).toHaveAccessibleName("OK");
    await expect(stage.locator(".vn-decisions")).toBeHidden();
    await expect(live(page)).toContainText(`${said.who.name}: ${said.say}`);
    await page.locator("#stripTitle").focus();
    await page.keyboard.press("Space");
  }
  // now the decisions: the first in full with what happens without an answer, the others as their titles
  await expect(story).toBeHidden();
  await expect(stage.locator(".vn-decisions")).toBeVisible();
  const focus = stage.locator(".play-decision:not(.waiting)");
  await expect(stage.locator(".vn-count")).toHaveText(`Decision 1 of ${asked.length}`);
  await expect(focus.locator("h5")).toHaveText(asked[0].title);
  await expect(focus.locator(".hint")).toHaveText(`If you skip it: ${asked[0].fallback}`);
  await expect(focus.locator(".vn-countdown")).toHaveCount(0);
  await expect(focus.locator(".play-options-row .btn span")).toHaveText(asked[0].options);
  await expect(focus.locator(".play-options-row kbd")).toHaveText(asked[0].options.map((_, i) => String(i + 1)));
  await expect(stage.locator(".play-decision.waiting .play-next")).toHaveText(asked.slice(1).map((d) => d.title));
  // a long text shows its first sentence; More shows the rest, Less the lead again
  const more = focus.locator(".play-why");
  await expect(more).toHaveText("More");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  const short = await focus.locator(".text").textContent();
  await more.click();
  await expect(more).toHaveText("Less");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  expect((await focus.locator(".text").textContent()).length).toBeGreaterThan(short.length);
  await more.click();
  await expect(more).toHaveText("More");
  // the number keys take an option of the decision in focus: the last one, then the first of the next
  await page.locator("#stripTitle").focus();
  await page.keyboard.press(String(asked[0].options.length));
  await expect(stage.locator(".vn-count")).toHaveText(`Decision 1 of ${asked.length - 1}`);
  await expect(focus.locator("h5")).toHaveText(asked[1].title);
  await page.keyboard.press("1");
  await expect(focus.locator("h5")).toHaveText(asked[2].title);
  // a key without an option does nothing
  await page.keyboard.press("9");
  await expect(focus.locator("h5")).toHaveText(asked[2].title);
  await expect(page.locator("#endTurn")).toHaveText(`End the turn (${asked.length - 2} open)`);
  const made = await page.evaluate(() => window.__play.session.seat("asset-manager").game.decisions.filter((d) => d.made).map((d) => [d.id, d.options.findIndex((o) => o.id === d.made)]));
  expect(made).toEqual([[asked[0].id, asked[0].options.length - 1], [asked[1].id, 0]]);
  // what the person decided is kept for the mission's sheet
  expect(await page.evaluate(() => window.__play.diary)).toEqual([
    { seat: "asset-manager", who: "Asset manager", title: asked[0].title, chose: asked[0].options.at(-1), round: 1 },
    { seat: "asset-manager", who: "Asset manager", title: asked[1].title, chose: asked[1].options[0], round: 1 },
  ]);

  // the account has much to tell: a line is read, and the lines after it can be skipped at once
  await page.locator("#endTurn").click();
  await expect(page.locator("#where")).toHaveText("Round 1 of 4 · The year's account");
  const told = (await game()).logs, unread = told.length - logs.length;
  expect(unread).toBeGreaterThan(3);
  await expect(line).toHaveText(told[logs.length]);
  const skip = story.getByRole("button", { name: /^Skip \d+ more$/ });
  await expect(skip).toHaveText(`Skip ${unread - 1} more`);
  await go.click();
  await expect(line).toHaveText(told[logs.length + 1]);
  await expect(skip).toHaveText(`Skip ${unread - 2} more`);
  await skip.click();
  await readOn(page, ASSETS); // what the story says in the account, if anything
  await expect(story).toBeHidden();
  expect(await page.evaluate(() => {
    const p = window.__play, g = p.session.seat("asset-manager").game;
    return p.read.get(g) === g.logs.length;
  })).toBe(true);
  // read to its end, the turn can be ended (in the line at the top); the newest message is the first under the bell
  await expect(part(page, ASSETS, ".vn-note")).toHaveText("Nothing left to decide here. End the turn when you are ready.");
  await expect(part(page, ASSETS, ".play-log").locator("li").first()).toContainText((await game()).logs.at(-1));
  await page.locator("#endTurn").click();
  await expect(page.locator("#where")).toHaveText("Round 2 of 4 · The year's plan");
  expect(errors).toEqual([]);
});

test("the mission's story: somebody speaks when the moment has come, answered with OK or Space; the clock waits meanwhile, and lines that came due are said in their order", async ({ page }) => {
  const first = LINE[0], errors = await start(page, `${PAGE}?mission=${first.id}`);
  const seat = `#seat-${first.roles[0].role}`, stage = stageOf(page, seat), story = stage.locator(".vn-story"), line = story.locator(".vn-line");
  const lines = await storyNow(page);
  expect(lines.length).toBeGreaterThan(3);
  expect(lines[0].at).toBeGreaterThan(1);
  // before its moment nobody speaks: there is no band of talk, the picture has the room; the tools are at the top of the stage
  await expect(story).toBeHidden();
  await expect(stage.locator(".vn-talk")).toBeHidden();
  await expect(part(page, seat, ".vn-tools")).toBeVisible();
  await expect(stage.locator(".vn-name strong")).toHaveText("You");
  await run(page, Math.ceil(lines[0].at));
  // the coach's first line, with the name, what they are and a face; it is said aloud for who does not see it
  await expect(line).toHaveText(lines[0].say);
  await expect(stage.locator(".vn-talk")).toBeVisible();
  // in the band only who speaks, what is said and the answer: no tools, no messages, no counters
  expect(await stage.locator(".vn-box").evaluate((box) => [...box.children].filter((el) => el.getClientRects().length && !el.classList.contains("visually-hidden")).map((el) => el.className))).toEqual(["vn-name", "vn-story"]);
  // the speaker stands taller than the band
  const tall = await stage.evaluate((st) => [st.querySelector(".vn-speaker img").getBoundingClientRect().height, st.querySelector(".vn-box").getBoundingClientRect().height]);
  expect(tall[0]).toBeGreaterThan(tall[1] + 30);
  await expect(stage.locator(".vn-name strong")).toHaveText(lines[0].who.name);
  await expect(stage.locator(".vn-name span")).toHaveText(lines[0].who.role);
  const face = await page.evaluate(async (who) => (await import("/game/cast.js")).faceOf(who), lines[0].who);
  await expect(stage.locator(".vn-speaker img")).toHaveAttribute("alt", face.alt);
  await expect(stage.locator(".vn-speaker img")).toHaveAttribute("src", new RegExp(`${face.picture.replace(/[.]/g, "\\.")}$`));
  await expect(stage.locator(".vn-speaker")).not.toHaveClass(cls("self"));
  await expect(live(page)).toContainText(`${lines[0].who.name}: ${lines[0].say}`);
  await expect(stage.locator(".vn-decisions")).toBeHidden();
  await expect(part(page, seat, ".vn-note")).toBeHidden();
  // the picture stays in use while somebody speaks
  await expect(page.locator(`${seat} .play-board`).getByRole("button").first()).toBeVisible();
  // the shift's clock waits for the answer: with the shift running, no time passes
  await page.getByRole("button", { name: "5×" }).click();
  const before = await page.evaluate(() => window.__play.session.t);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__play.session.t)).toBe(before);
  await expect(page.locator("#shiftBar")).toHaveClass(cls("held"));
  expect(await page.evaluate(() => window.__play.listening())).toBe(true);
  // OK: the stage goes on, the focus with it
  const ok = story.getByRole("button", { name: "OK" });
  await expect(ok).toHaveText("OKSpace");
  await ok.click();
  await expect(story).toBeHidden();
  await expect(part(page, seat, ".vn-tools").locator("button").first()).toBeFocused();
  // answered: the clock runs again (and is paused for what follows)
  await expect.poll(() => page.evaluate(() => window.__play.session.t)).toBeGreaterThan(before);
  await expect(page.locator("#shiftBar")).not.toHaveClass(cls("held"));
  await page.getByRole("button", { name: "Pause" }).click();
  expect(await page.evaluate(() => window.__play.session.t)).toBeLessThan(lines[1].at);
  await expect(stage.locator(".vn-talk")).toBeHidden();
  await expect(stage.locator(".vn-name strong")).toHaveText("You");
  await expect(stage.locator(".vn-speaker")).toHaveClass(cls("self"));
  // (that nothing is asked is said to who does not see the page, not written on it)
  await expect(part(page, seat, ".vn-note")).toHaveText("Nothing to decide just now. Watch the picture: choose something in it to act.");
  await expect(part(page, seat, ".vn-note")).toHaveClass(cls("visually-hidden"));
  // a line is said once: time passing does not bring it back
  await run(page, 5);
  await expect(story).toBeHidden();
  // the next line at its time; Space answers it (with the focus off the buttons)
  await page.evaluate((t) => {
    const p = window.__play;
    while (p.session.t < t) p.session.step(1);
    p.draw(true);
  }, Math.ceil(lines[1].at));
  await expect(line).toHaveText(lines[1].say);
  await page.locator("#stripTitle").focus();
  await page.keyboard.press("Space");
  await expect(story).toBeHidden();
  // two more lines come due without an answer: none is passed over, they are said one after the other
  await page.evaluate((t) => {
    const p = window.__play;
    while (p.session.t < t) p.session.step(1);
    p.draw(true);
  }, Math.ceil(lines[3].at) + 1);
  await expect(line).toHaveText(lines[2].say);
  await ok.click();
  await expect(line).toHaveText(lines[3].say);
  await ok.click();
  await expect(story).toBeHidden();
  // a seat handed to the computer and taken again later: of the lines that came due meanwhile only the latest is said
  await tool(page, seat, "Hand to the computer").click();
  await page.evaluate((t) => {
    const p = window.__play;
    while (p.session.t < t) p.session.step(1);
    p.draw(true);
  }, Math.ceil(lines[5].at) + 1);
  await expect(story).toBeHidden();
  await tool(page, seat, "Take over").click();
  await expect(line).toHaveText(lines[5].say);
  await ok.click();
  await expect(story).toBeHidden();
  expect(await page.evaluate((id) => [...window.__play.heardLines.get(id)].sort((a, b) => a - b), first.roles[0].role)).toEqual(lines.slice(0, 6).map((l) => l.index));
  expect(errors).toEqual([]);
});

test("a railway term in a text can be tapped: what it is, with its German word; a term shown counts as met", async ({ page }) => {
  const errors = await open(page, `${PAGE}?mission=budget-years`);
  expect(await kept(page)).toBeNull();
  await page.locator("#start").click();
  const stage = stageOf(page, ASSETS), line = stage.locator(".vn-story .vn-line"), box = stage.locator(".vn-term");
  // read on to the first line that names terms of the glossary
  const found = await page.evaluate(async () => {
    const { mark } = await import("/game/glossary.js");
    const story = document.querySelector("#seat-asset-manager .vn-story"), terms = (text) => mark(text).filter((x) => typeof x !== "string");
    for (let i = 0; i < 50 && !story.hidden && !terms(story.querySelector(".vn-line").textContent).length; i++) story.querySelector(".btn.primary").click();
    const text = story.hidden ? "" : story.querySelector(".vn-line").textContent;
    return { text, terms: terms(text).map((x) => ({ id: x.term.id, term: x.term.term, de: x.term.de ?? null, line: x.term.line, text: x.text })) };
  });
  expect(found.terms.length).toBeGreaterThan(0);
  // the terms are buttons in the text, in their order
  const terms = line.locator("button.term");
  await expect(line).toHaveText(found.text);
  await expect(terms).toHaveText(found.terms.map((t) => t.text));
  await expect(terms.first()).toHaveAttribute("aria-expanded", "false");
  await expect(box).toBeHidden();
  // shown is met: kept in the browser at once, before anything is tapped or the mission is over
  const before = await kept(page);
  expect(before.terms).toEqual(expect.arrayContaining(found.terms.map((t) => t.id)));
  expect(before.missions).toEqual({});
  expect(await page.evaluate(() => [...window.__play.met])).toEqual(expect.arrayContaining(found.terms.map((t) => t.id)));
  // tapped, a term is explained in a line, with its German word
  const term = found.terms[0];
  await terms.first().click();
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute("role", "note");
  await expect(box.locator("strong")).toHaveText(term.term);
  if (term.de) {
    await expect(box.locator("[lang=de]")).toHaveText(term.de);
  }
  await expect(box.locator("p").nth(1)).toHaveText(term.line);
  await expect(terms.first()).toHaveAttribute("aria-expanded", "true");
  await expect(terms.first()).toHaveClass(cls("on"));
  // another term replaces it; "Got it" closes it, and so does the term itself
  if (found.terms.length > 1) {
    await terms.nth(1).click();
    await expect(box.locator("strong")).toHaveText(found.terms[1].term);
    await expect(terms.first()).toHaveAttribute("aria-expanded", "false");
    await expect(terms.nth(1)).toHaveAttribute("aria-expanded", "true");
  }
  await box.getByRole("button", { name: "Got it" }).click();
  await expect(box).toBeHidden();
  await terms.first().click();
  await expect(box).toBeVisible();
  await terms.first().click();
  await expect(box).toBeHidden();
  // nothing new was met by tapping
  expect((await kept(page)).terms).toEqual(before.terms);
  // reading on closes an explanation
  await terms.first().click();
  await expect(box).toBeVisible();
  await stage.locator(".vn-story .btn.primary").click();
  await expect(box).toBeHidden();
  // a term in a decision's title is a button too
  await readOn(page, ASSETS);
  const titled = await page.evaluate(async () => {
    const { mark } = await import("/game/glossary.js");
    const g = window.__play.session.seat("asset-manager").game;
    return g.open.map((d) => ({ id: d.id, terms: mark(d.title).filter((x) => typeof x !== "string").map((x) => x.text) })).find((d) => d.terms.length) ?? null;
  });
  if (titled) {
    await page.evaluate((id) => window.__play.look("asset-manager", id), titled.id);
    await expect(stage.locator(".play-decision:not(.waiting) h5 button.term")).toHaveText(titled.terms);
  }
  expect(errors).toEqual([]);
});

test("a decision with a deadline: its time runs out as a bar, hurries near the end, and its fallback is taken", async ({ page }) => {
  const errors = await start(page, `${PAGE}?mission=transportleitung`);
  const seat = "#seat-ru-control-dispatcher", stage = stageOf(page, seat), asked = stage.locator(".play-decision:not(.waiting)");
  // on to the first decision that has a deadline
  const d = await page.evaluate(() => {
    const p = window.__play, g = p.session.seat("ru-control-dispatcher").game;
    for (let i = 0; i < 4800 && !g.open.some((x) => x.deadline != null); i++) p.session.step(p.session.phase.tick);
    p.draw(true);
    const x = g.open.find((y) => y.deadline != null);
    return x ? { id: x.id, title: x.title, left: x.deadline - g.t, fallback: x.fallback, then: x.options.find((o) => o.id === x.fallback).label, first: g.open[0] === x } : null;
  });
  expect(d).not.toBeNull();
  expect(d.first).toBe(true);
  expect(d.left).toBeGreaterThan(20);
  const bar = asked.locator(".vn-countdown"), width = () => bar.locator("i").evaluate((i) => parseFloat(i.style.width));
  const leftNow = () => page.evaluate((id) => {
    const g = window.__play.session.seat("ru-control-dispatcher").game;
    return Math.max(0, Math.ceil(g.open.find((x) => x.id === id).deadline - g.t));
  }, d.id);
  await expect(asked.locator("h5")).toHaveText(d.title);
  // the bar is for the eye; the seconds left and what happens then are written
  await expect(bar).toHaveAttribute("aria-hidden", "true");
  await expect(bar).not.toHaveClass(cls("low"));
  expect(await width()).toBeGreaterThan(95);
  await expect(asked.locator(".hint")).toHaveText(`${await leftNow()} s left, then: ${d.then}`);
  // half of its time gone: half the bar
  await run(page, Math.round(d.left / 2));
  expect(await width()).toBeGreaterThan(35);
  expect(await width()).toBeLessThan(65);
  await expect(bar).not.toHaveClass(cls("low"));
  await expect(asked.locator(".hint")).toHaveText(`${await leftNow()} s left, then: ${d.then}`);
  // less than a third left: it hurries
  await run(page, Math.round(d.left * 0.25));
  await expect(bar).toHaveClass(cls("low"));
  expect(await width()).toBeLessThan(34);
  expect(await page.evaluate(() => window.__play.hurried.size)).toBe(1);
  // its time is up: nobody decided, the fallback is taken and the decision leaves the stage
  await run(page, Math.ceil(d.left * 0.25) + 2);
  await expect(stage.locator(`.play-decision[data-key="${d.id}"]`)).toHaveCount(0);
  expect(await page.evaluate((id) => {
    const x = window.__play.session.seat("ru-control-dispatcher").game.decisions.find((y) => y.id === id);
    return [x.made, x.auto];
  }, d.id)).toEqual([d.fallback, true]);
  // what the computer's fallback decided is not the person's: it does not go on the sheet
  expect(await page.evaluate(() => window.__play.diary)).toEqual([]);
  expect(errors).toEqual([]);
});

/* ---------------------------------------------------------------- only the picture, the sound */

test("only the picture: H takes the game's interface out of the way and brings it back; so do the buttons", async ({ page }) => {
  const errors = await start(page);
  const strip = page.locator("#hud"), rail = page.locator("#rail"), seats = page.locator(".play-seats"), back = page.locator("#bareBack"), bare = page.locator("#bare");
  await expect(back).toBeHidden();
  await expect(bare).toHaveAttribute("aria-pressed", "false");
  // (a message has just popped up: it goes with the rest)
  await page.evaluate(() => {
    const p = window.__play;
    p.session.seat("signaller-relay").game.logs.push({ t: 0, kind: "info", text: "Just now." });
    p.draw(true);
  });
  await expect(toast(page)).toBeVisible();
  await page.keyboard.press("h");
  await expect(page.locator("body")).toHaveClass(cls("bare"));
  await expect(toast(page)).toBeHidden();
  await expect(strip).toBeHidden();
  await expect(rail).toBeHidden();
  await expect(seats).toBeHidden();
  await expect(page.locator("#backdrop")).toBeVisible();
  await expect(bare).toHaveAttribute("aria-pressed", "true");
  await expect(back).toBeVisible();
  await expect(back).toHaveText("Show the game (H)");
  await expect(back).toBeFocused();
  // the other keys rest while only the picture is shown
  await page.keyboard.press("d");
  await page.keyboard.press("p");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__play.speed)).toBe(0);
  await page.keyboard.press("H");
  await expect(page.locator("body")).not.toHaveClass(cls("bare"));
  await expect(strip).toBeVisible();
  await expect(rail).toBeVisible();
  await expect(seats).toBeVisible();
  await expect(back).toBeHidden();
  await expect(bare).toBeFocused();
  await expect(bare).toHaveAttribute("aria-pressed", "false");
  // the bar's button, and the button that brings the game back
  await bare.click();
  await expect(page.locator("body")).toHaveClass(cls("bare"));
  await expect(back).toBeFocused();
  await back.click();
  await expect(page.locator("body")).not.toHaveClass(cls("bare"));
  await expect(bare).toBeFocused();
  // the session ends while only the picture is shown: the verdict is not kept away
  await page.keyboard.press("h");
  await expect(page.locator("body")).toHaveClass(cls("bare"));
  await page.evaluate(() => {
    const p = window.__play;
    p.sit("signaller-relay", "computer");
    p.skip();
  });
  await expect(page.locator("#resultTitle")).toBeVisible();
  await expect(page.locator("body")).not.toHaveClass(cls("bare"));
  await expect(back).toBeHidden();
  expect(errors).toEqual([]);
});

test("the sound and the live backdrop: their buttons and M and L switch them, and the choices are kept in the browser", async ({ page }) => {
  const errors = await start(page);
  const sound = page.locator("#sound"), stored = (key = "arail.game.sound") => page.evaluate((k) => localStorage.getItem(k), key);
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  expect(await stored()).toBeNull();
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  expect(await stored()).toBe("false");
  expect(await page.evaluate(() => window.__play.sound.on)).toBe(false);
  await page.keyboard.press("m");
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  expect(await stored()).toBe("true");
  await page.keyboard.press("M");
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  // kept: off after a reload, on the first screen already and in the next session
  await page.reload();
  await page.waitForFunction(() => window.__play?.ready);
  expect(await page.evaluate(() => window.__play.sound.on)).toBe(false);
  await page.locator("#resume").click();
  await expect(sound).toBeVisible();
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  expect(await stored()).toBe("true");
  // the live backdrop (the layout's world running behind the game) is wanted unless switched off; L and its button
  // switch it, and that is kept too. A test's browser gets the still pictures either way.
  const liveBtn = page.locator("#liveBtn");
  // (an icon at the side, named)
  await expect(liveBtn).toHaveAccessibleName("Live");
  await expect(liveBtn.locator("svg.icon")).toHaveCount(1);
  await expect(liveBtn).toHaveAttribute("aria-pressed", "true");
  expect(await stored("arail.game.live")).toBeNull();
  await expect(page.locator("#backdrop")).not.toHaveClass(cls("live"));
  await page.keyboard.press("l");
  await expect(liveBtn).toHaveAttribute("aria-pressed", "false");
  expect(await stored("arail.game.live")).toBe("false");
  await liveBtn.click();
  await expect(liveBtn).toHaveAttribute("aria-pressed", "true");
  expect(await stored("arail.game.live")).toBe("true");
  await page.keyboard.press("L");
  await page.reload();
  await page.waitForFunction(() => window.__play?.ready);
  await expect(liveBtn).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => [window.__play.liveOn, window.__play.sound.on])).toEqual([false, true]);
  await expect(page.locator("#backdrop")).not.toHaveClass(cls("live"));
  expect(errors).toEqual([]);
});

/* ---------------------------------------------------------------- the end: the verdict, the logbook's progress, the report */

test("the verdict of a mission a person passed: the stars, what was gained, the cast; kept in the browser, shown on the line, and on to the next stop", async ({ page }) => {
  const first = LINE[0], next = LINE[1], role = first.roles[0].role;
  const errors = await start(page, `${PAGE}?mission=${first.id}`);
  await playOut(page, role);
  await expect(page.locator("#resultTitle")).toHaveText(`The result: ${first.title}`);
  await expect(page.locator("#resultTitle")).toBeFocused();
  await expect(page.locator("body")).toHaveAttribute("data-screen", "result");
  await expect(page.locator(".site-bar")).toBeVisible();
  const result = await page.evaluate(() => window.__play.session.result());
  expect(result.passed).toBe(true);
  expect(result.seats.map((s) => s.by)).toEqual(["human"]);
  const stars = starsFor(result.score, result.passed), verdict = page.locator("#result .vn-verdict");
  await expect(live(page)).toContainText(`The session is over: ${result.score} of 100, passed.`);
  await expect(verdict).toHaveClass(cls("passed"));
  await expect(verdict.locator(".vn-over")).toHaveText("Mission passed");
  await expect(verdict.locator(".vn-score .score-total")).toHaveText(String(result.score));
  await expect(verdict.locator(".vn-score .tag")).toHaveText("passed");
  // the stars come in one by one
  await expect(verdict.locator(".vn-score .stars .visually-hidden")).toHaveText(`${stars} of 3 stars`);
  await expect(verdict.locator(".vn-score .stars b")).toHaveCount(stars);
  expect(await verdict.locator(".vn-score .stars b").evaluateAll((list) => list.map((b) => parseFloat(b.style.animationDelay)))).toEqual([300, 680, 1060].slice(0, stars));
  // what was gained: the first star is a promotion, the first mission passed earns badges, and it is the best so far
  const gained = verdict.locator(".vn-gained li");
  await expect(gained.first()).toHaveText("Promoted: Trainee");
  await expect(gained.filter({ hasText: "Badge: " }).locator("strong")).toContainText(["First shift", "Signed off"]);
  await expect(gained.last()).toHaveText("Your best so far");
  expect(await page.evaluate(() => window.__play.gained)).toMatchObject({ stars, best: true, rank: "Trainee" });
  // the cast with their scores, a question to take along, and the ways on
  await expect(verdict.locator(".vn-cast li")).toHaveText([new RegExp(`^Signaller in a relay interlocking\\s*${result.seats[0].score} · you$`)]);
  await expect(verdict.locator(".vn-cast li")).toHaveClass(cls("ok"));
  await expect(verdict.locator(".vn-question")).toHaveText(`To take along ${first.debrief[0]}`);
  await expect(verdict.getByRole("link", { name: "Your sheet" })).toHaveAttribute("href", `../logbook/#sheet-${first.id}`);
  await expect(verdict.locator(".row").getByRole("button")).toHaveText([`▶Next stop: ${next.title}`, "Play again", "New seed", "The full report", "The line"]);
  // kept in the browser: the mission's stars and best score, its sheet, the role sat in
  const now = await kept(page);
  expect(now.format).toBe("arail-progress/1");
  expect(now.missions).toEqual({ [first.id]: { best: result.score, stars, plays: 1, passed: true } });
  expect(now.sheets[first.id]).toMatchObject({ score: result.score, passed: true, stars, roles: [role], violations: 0, danger: false, decisions: [] });
  expect(now.sheets[first.id].terms).toEqual(await page.evaluate(() => [...window.__play.met]));
  expect(now.roles).toEqual([role]);
  expect(now.clean).toBe(1);
  // finishing removes the session's save
  expect(await page.evaluate((id) => localStorage.getItem(`arail.play.${id}`), first.id)).toBeNull();

  // on to the next stop: the line shows what was reached
  await verdict.getByRole("button", { name: `Next stop: ${next.title}` }).click();
  await expect(page.locator("#setupTitle")).toHaveText(next.title);
  await expect(page.locator("#setupTitle")).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`\\?mission=${next.id}$`));
  await expect(stopOf(page, first.id)).toHaveClass(cls("done"));
  await expect(stopOf(page, first.id).locator(".stars .visually-hidden")).toHaveText(`${stars} of 3 stars`);
  await expect(stopOf(page, next.id)).toHaveClass(cls("on"));
  await expect(stopOf(page, next.id)).toHaveClass(cls("next"));
  await expect(page.locator("#rank")).toContainText(stars === 1 ? "1 star" : `${stars} stars`);
  await expect(page.locator("#rank strong")).toHaveText("Trainee");
  // without a mission in the address, the next stop is where the page opens now
  await page.goto(PAGE);
  await page.waitForFunction(() => window.__play?.ready);
  await expect(page.locator("#setupTitle")).toHaveText(next.title);

  // the same mission once more, with the same score: played twice, nothing new gained
  await stopOf(page, first.id).click();
  await expect(page.locator("#setup .play-no")).toContainText(`best ${result.score}`);
  await page.locator("#start").click();
  await page.getByRole("button", { name: "Pause" }).click();
  await playOut(page, role);
  await expect(page.locator("#resultTitle")).toBeFocused();
  await expect(verdict.locator(".vn-score .score-total")).toHaveText(String(result.score));
  await expect(verdict.locator(".vn-score .stars b")).toHaveCount(stars);
  await expect(verdict.locator(".vn-gained")).toHaveCount(0);
  expect((await kept(page)).missions[first.id]).toEqual({ best: result.score, stars, plays: 2, passed: true });
  // "The line" leads back to the mission played
  await verdict.getByRole("button", { name: "The line" }).click();
  await expect(page.locator("#setupTitle")).toHaveText(first.title);
  await expect(page.locator("#setupTitle")).toBeFocused();
  await expect(stopOf(page, first.id)).toHaveClass(cls("on"));
  expect(errors).toEqual([]);
});

test("the computer on every seat: the shift can be skipped, and nothing goes into the logbook", async ({ page }) => {
  const first = LINE[0], role = first.roles[0].role, errors = await open(page, `${PAGE}?mission=${first.id}`);
  await expect(page.locator("#setup .lv-seats legend")).toHaveText("Your seat");
  await page.locator(`label[for="by-${role}"]`).click();
  await expect(page.locator(`#by-${role}`)).not.toBeChecked();
  expect(await page.evaluate(() => Object.values(window.__play.choice.seats))).toEqual(["computer"]);
  await page.locator("#start").click();
  // nobody of the people is at work: the bar says so and offers to skip the shift
  await expect(page.locator("#skipBar")).toBeVisible();
  await expect(page.locator("#skipBar .hint")).toHaveText("Nobody of the people is at work in this shift: the computer plays it.");
  await expect(page.locator("#tabs [role=tab]")).toHaveCount(1);
  await expect(page.locator("#tabs")).toBeHidden();
  await expect(part(page, `#seat-${role}`, ".vn-note")).toHaveText("The computer plays this seat. You can watch it, or take over.");
  await page.locator("#skip").click();
  await expect(page.locator("#resultTitle")).toHaveText(`The result: ${first.title}`);
  const result = await page.evaluate(() => window.__play.session.result()), verdict = page.locator("#result .vn-verdict");
  expect(result.seats.map((s) => s.by)).toEqual(["computer"]);
  await expect(verdict.locator(".vn-score .score-total")).toHaveText(String(result.score));
  await expect(verdict.locator(".vn-score .tag")).toHaveText(result.passed ? "passed" : "not passed");
  // no stars, nothing gained, no sheet: the verdict says why
  await expect(verdict.locator(".stars")).toHaveCount(0);
  await expect(verdict.locator(".vn-gained")).toHaveCount(0);
  await expect(verdict.locator(".hint")).toHaveText("The computer played every seat: nothing goes into your logbook.");
  await expect(verdict.getByRole("link", { name: "Your sheet" })).toHaveCount(0);
  await expect(verdict.locator(".vn-cast li")).toHaveText([new RegExp(`${result.seats[0].score} · computer$`)]);
  expect(await page.evaluate(() => window.__play.gained)).toBeNull();
  expect(await kept(page)).toBeNull();
  // the line is as it was
  await verdict.getByRole("button", { name: "The line" }).click();
  await expect(stopOf(page, first.id)).not.toHaveClass(cls("done"));
  await expect(stopOf(page, first.id)).toHaveClass(cls("next"));
  await expect(stopOf(page, first.id).locator(".stars .visually-hidden")).toHaveText("0 of 3 stars");
  await expect(page.locator("#rank strong")).toHaveText("Passenger");
  expect(errors).toEqual([]);
});

test("whose a mission was: a seat played and handed to the computer for the last stretch counts, a seat taken over just before the end does not", async ({ page }) => {
  const first = LINE[0], role = first.roles[0].role, seat = `#seat-${role}`;
  const errors = await start(page, `${PAGE}?mission=${first.id}`);
  /** How many ticks the shift lasts with the computer at the seat (its game may end before the time is up). */
  const length = () => page.evaluate(async () => {
    const { Session } = await import("/arail/game/index.js");
    const p = window.__play, copy = new Session(p.told(), { games: p.games, seed: p.session.seed, seats: Object.fromEntries([...p.session.seats.keys()].map((id) => [id, "computer"])) });
    copy.run();
    return copy.lasted[0];
  });
  const ticks = await length();
  expect(ticks).toBeGreaterThan(40);

  // played for most of the shift with the moves the computer would make, then handed over to fast-forward the rest
  await page.evaluate(([id, n]) => {
    const p = window.__play, s = p.session, at = s.seat(id);
    const hands = new Proxy(at.game, { get: (g, key) => (key === "act" ? (name, ...args) => s.act(id, name, ...args) : typeof g[key] === "function" ? g[key].bind(g) : g[key]) });
    for (let i = 0; i < n && !s.over; i++) {
      at.player.think(hands, s);
      s.step(s.phase.tick);
    }
    p.draw(true);
  }, [role, Math.round(ticks * 0.8)]);
  await expect(page.locator("#play")).toBeVisible();
  await tool(page, seat, "Hand to the computer").click();
  await page.locator("#skip").click();
  await expect(page.locator("#resultTitle")).toHaveText(`The result: ${first.title}`);
  let result = await page.evaluate(() => window.__play.session.result());
  const verdict = page.locator("#result .vn-verdict");
  expect(result.seats.map((s) => s.by)).toEqual(["computer"]);
  expect(result.passed).toBe(true);
  const held = await page.evaluate((id) => window.__play.session.heldByPeople()[id], role);
  expect(held).toBeGreaterThan(0.7);
  expect(held).toBeLessThan(0.9);
  // the mission is the person's: the stars, the sheet, the role
  await expect(verdict.locator(".vn-score .stars .visually-hidden")).toHaveText(`${starsFor(result.score, true)} of 3 stars`);
  await expect(verdict.locator(".hint")).toHaveCount(0);
  await expect(verdict.locator(".vn-cast li .pts")).toHaveText([`${result.seats[0].score} · you`]);
  await expect(verdict.getByRole("link", { name: "Your sheet" })).toBeVisible();
  let now = await kept(page);
  expect(now.missions[first.id]).toEqual({ best: result.score, stars: starsFor(result.score, true), plays: 1, passed: true });
  expect(now.sheets[first.id]).toMatchObject({ score: result.score, passed: true, roles: [role] });
  expect(now.roles).toEqual([role]);

  // the other way round, with an empty logbook: the computer plays the shift, a person takes the seat for its last seconds
  await page.evaluate((key) => localStorage.removeItem(key), PROGRESS);
  await verdict.getByRole("button", { name: "Play again" }).click();
  await page.waitForFunction(() => window.__play.screen === "play" && !window.__play.session.over);
  await page.getByRole("button", { name: "Pause" }).click();
  await tool(page, seat, "Hand to the computer").click();
  await page.evaluate((n) => {
    const p = window.__play, s = p.session;
    for (let i = 0; i < n && !s.over; i++) s.step(s.phase.tick);
    p.draw(true);
  }, ticks - 6);
  await expect(page.locator("#play")).toBeVisible();
  await tool(page, seat, "Take over").click();
  await run(page, 600);
  await expect(page.locator("#resultTitle")).toHaveText(`The result: ${first.title}`);
  result = await page.evaluate(() => window.__play.session.result());
  expect(result.seats.map((s) => s.by)).toEqual(["human"]);
  expect(await page.evaluate((id) => window.__play.session.heldByPeople()[id], role)).toBeLessThan(0.2);
  // the computer's play earns nothing: no stars, no sheet, nothing kept
  await expect(verdict.locator(".stars")).toHaveCount(0);
  await expect(verdict.locator(".vn-gained")).toHaveCount(0);
  await expect(verdict.locator(".hint")).toHaveText("No seat was yours for most of its work: nothing goes into your logbook.");
  await expect(verdict.locator(".vn-cast li .pts")).toHaveText([`${result.seats[0].score} · computer`]);
  await expect(verdict.getByRole("link", { name: "Your sheet" })).toHaveCount(0);
  expect(await page.evaluate(() => window.__play.gained)).toBeNull();
  expect(await kept(page)).toBeNull();
  expect(errors).toEqual([]);
});

test("several seats: the stars are for the score of the person's own seat, and the sheet lists the decisions taken at it", async ({ page }) => {
  const errors = await start(page);
  // the signaller's seat is played by a person, with the moves the computer would make; what is decided goes through the page, as a click does
  await page.evaluate(() => {
    const p = window.__play, s = p.session, id = "signaller-relay", at = s.seat(id);
    const hands = new Proxy(at.game, {
      get: (g, key) => (key === "act" ? (name, ...args) => (name === "decide" ? p.decide(id, ...args) : s.act(id, name, ...args)) : typeof g[key] === "function" ? g[key].bind(g) : g[key]),
    });
    for (let i = 0; i < 1e5 && !s.over; i++) {
      at.player.think(hands, s);
      // (a decision noted at the other seat, which is the computer's: as if a person had sat there for a moment and decided)
      if (i === 100) p.diary.push({ seat: "maintenance-dispatcher", who: "Maintenance and fault dispatcher", title: "A decision at the other seat", chose: "Something", round: 1 });
      s.step(s.phase.tick);
    }
    p.draw(true);
  });
  await expect(page.locator("#resultTitle")).toHaveText("The result: A morning at Bf Neustadt");
  const result = await page.evaluate(() => window.__play.session.result()), verdict = page.locator("#result .vn-verdict");
  const own = result.seats.find((x) => x.seat === "signaller-relay").score, other = result.seats.find((x) => x.seat === "maintenance-dispatcher").score;
  expect(result.passed).toBe(true);
  expect(own).not.toBe(other);
  expect(result.score).toBe(Math.round((own + other) / 2));
  expect(await page.evaluate(() => [...window.__play.yours])).toEqual(["signaller-relay"]);
  // the verdict shows the mission's score; the stars are for the person's own seat, and the verdict says so
  await expect(verdict.locator(".vn-score .score-total")).toHaveText(String(result.score));
  await expect(verdict.locator(".vn-score .stars .visually-hidden")).toHaveText(`${starsFor(own, true)} of 3 stars`);
  await expect(verdict.locator(".vn-own")).toHaveText(`Your stars are for your own seat: ${own} of 100.`);
  await expect(verdict.locator(".vn-cast li .pts")).toHaveText([`${own} · you`, `${other} · computer`]);
  expect(await page.evaluate(() => window.__play.gained)).toMatchObject({ score: own, stars: starsFor(own, true), best: true });
  // kept: the own seat's score as the mission's best, its role, and of the decisions those taken at it
  const now = await kept(page), sheet = now.sheets["neustadt-morning"];
  expect(now.missions["neustadt-morning"]).toEqual({ best: own, stars: starsFor(own, true), plays: 1, passed: true });
  expect(sheet).toMatchObject({ score: own, passed: true, stars: starsFor(own, true), roles: ["signaller-relay"] });
  expect(now.roles).toEqual(["signaller-relay"]);
  expect(sheet.decisions.length).toBeGreaterThan(1);
  expect([...new Set(sheet.decisions.map((d) => d.who))]).toEqual(["Signaller in a relay interlocking"]);
  expect(sheet.decisions.map((d) => d.title)).toContain("Signal N2 has failed. Report the fault to the maintenance dispatcher?");
  expect(sheet.decisions.every((d) => !("seat" in d))).toBe(true);
  // (the diary itself knew of the other seat's decision)
  expect(await page.evaluate(() => window.__play.diary.filter((d) => d.seat === "maintenance-dispatcher").length)).toBe(1);
  expect(errors).toEqual([]);
});

test("the logbook as it is kept now is what a session's end adds to: missions played in another tab stay, a logbook emptied there stays empty of the old", async ({ page }) => {
  const errors = await open(page, `${PAGE}?mission=malus-month`);
  /** Play the mission to its end at the person's seat: every turn ended at once, what is open decided by its fallback. */
  const play = async () => {
    await page.locator("#start").click();
    await page.waitForFunction(() => window.__play.session);
    await page.evaluate(() => {
      const p = window.__play;
      for (let i = 0; i < 40 && p.screen === "play"; i++) p.endTurn();
    });
    await expect(page.locator("#resultTitle")).toHaveText("The result: Malus Month");
  };
  // while this page is open, another tab plays a mission: its stars are in the browser, not in this page's memory
  await page.evaluate(async (key) => {
    const { emptyProgress, record } = await import("/game/progress.js");
    localStorage.setItem(key, JSON.stringify(record(emptyProgress(), { mission: "fault-night", score: 90, passed: true, roles: ["maintenance-dispatcher"], terms: ["closure"] })));
  }, PROGRESS);
  await play();
  let now = await kept(page);
  expect(Object.keys(now.missions).sort()).toEqual(["fault-night", "malus-month"]);
  expect(now.missions["fault-night"]).toEqual({ best: 90, stars: 3, plays: 1, passed: true });
  expect(now.terms).toContain("closure");
  // the other tab empties the logbook; the mission is played again here: only this time's play is kept
  await page.locator("#result").getByRole("button", { name: "The line" }).click();
  await page.evaluate((key) => localStorage.removeItem(key), PROGRESS);
  await play();
  now = await kept(page);
  expect(Object.keys(now.missions)).toEqual(["malus-month"]);
  expect(now.missions["malus-month"].plays).toBe(1);
  expect(Object.keys(now.sheets)).toEqual(["malus-month"]);
  expect(errors).toEqual([]);
});

test("nobody of the people at work: the shift is skipped to its end; the verdict, the full report with the debrief, as a file, again", async ({ page }) => {
  const errors = await start(page);
  await expect(page.locator("#skipBar")).toBeHidden();
  // a minute at the seat, then the computer has it for the rest of the shift
  await run(page, 60);
  await tool(page, SIGNALLER, "Hand to the computer").click();
  await expect(page.locator("#skipBar")).toBeVisible();
  await page.getByRole("button", { name: "Skip to the end of the shift" }).click();
  await expect(page.locator("#resultTitle")).toHaveText("The result: A morning at Bf Neustadt");
  await expect(page.locator("#resultTitle")).toBeFocused();
  await expect(live(page)).toContainText("The session is over:");
  await expect(page.locator("#play")).toBeHidden();
  const result = await page.evaluate(() => window.__play.session.result()), verdict = page.locator("#result .vn-verdict");
  await expect(verdict).toHaveClass(cls(result.passed ? "passed" : "failed"));
  await expect(verdict.locator(".vn-over")).toHaveText(result.passed ? "Mission passed" : "Mission not passed");
  await expect(verdict.locator(".vn-score .score-total")).toHaveText(String(result.score));
  await expect(verdict.locator(".vn-score .tag")).toHaveText(result.passed ? "passed" : "not passed");
  // the cast with their scores; the seat handed over was the computer's for nearly all of its work: nothing for the logbook
  await expect(verdict.locator(".vn-cast")).toHaveAttribute("aria-label", "The seats");
  await expect(verdict.locator(".vn-cast li .name")).toHaveText(["Signaller in a relay interlocking", "Maintenance and fault dispatcher"]);
  await expect(verdict.locator(".vn-cast li .pts")).toHaveText(result.seats.map((s) => `${s.score} · computer`));
  await expect(verdict.locator(".hint")).toHaveText("No seat was yours for most of its work: nothing goes into your logbook.");
  await expect(verdict.locator(".vn-question")).toContainText("How long did the trains of track G2 wait");
  expect(await kept(page)).toBeNull();
  // the full report is a dialog: every seat with its rounds and objectives
  const report = page.locator("#result dialog.play-report");
  await expect(report).toBeHidden();
  await verdict.getByRole("button", { name: "The full report" }).click();
  await expect(report).toBeVisible();
  await expect(report.locator("#reportTitle")).toHaveText("The full report");
  await expect(report).toContainText("1 round, seed 1. The whole is passed when every seat passed all its rounds");
  const seats = report.locator(".play-result-seats .game-card");
  await expect(seats).toHaveCount(2);
  await expect(seats.first().locator("h3")).toHaveText("Signaller in a relay interlocking");
  await expect(seats.first()).toContainText("played by the computer at the end (the seat changed hands)");
  await expect(seats.first().locator("tbody tr")).toHaveText([new RegExp(`^1\\s*The morning shift\\s*${result.seats[0].score}\\s*(not )?passed\\s*0$`)]);
  await expect(seats.first().locator(".score-parts li")).toHaveCount(5);
  await expect(seats.first()).toContainText("Punctuality (35)");
  await expect(seats.nth(1)).toContainText("Fault Night, played by the computer.");
  await expect(report.locator(".play-counts")).toContainText(await flowName(page, "repair-status"));
  // what led to what: the faults of the shift on its time line, whose their minutes were, what the failure did
  const chain = report.locator(".play-chain");
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
  await expect(report.locator(".play-debrief li")).toHaveCount(missionOf("neustadt-morning").debrief.length);
  await expect(report.locator(".play-debrief li").first()).toContainText("How long did the trains of track G2 wait");
  // finishing removes the save
  expect(await page.evaluate(() => localStorage.getItem("arail.play.neustadt-morning"))).toBeNull();
  // the session as a file
  const [file] = await Promise.all([page.waitForEvent("download"), report.getByRole("button", { name: "Save the session as a file" }).click()]);
  expect(file.suggestedFilename()).toBe("neustadt-morning-seed-1.json");
  const saved = JSON.parse(await readFile(await file.path(), "utf8"));
  expect(saved.format).toBe("arail-session/1");
  expect(saved.record.map((m) => m.name)).toEqual(["@seat"]);
  expect(saved.result.score).toBe(result.score);
  await closeDialog(page);
  await expect(report).toBeHidden();
  // again with the same seed and the same seats, then with another seed
  await verdict.getByRole("button", { name: "Play again" }).click();
  await expect(page.locator("#stripTitle")).toBeFocused();
  await page.getByRole("button", { name: "Pause" }).click();
  expect(await page.evaluate(() => [window.__play.session.seed, window.__play.session.seat("signaller-relay").by])).toEqual([1, "human"]);
  await page.evaluate(() => {
    const p = window.__play;
    p.sit("signaller-relay", "computer");
    p.skip();
  });
  await expect(verdict.locator(".vn-score .score-total")).toHaveText(String(result.score));
  await verdict.getByRole("button", { name: "New seed" }).click();
  await page.waitForFunction(() => window.__play.screen === "play");
  expect(await page.evaluate(() => window.__play.session.seed)).not.toBe(1);
  // "Other missions" leaves the session (kept, to take up again) for the line, with the mission that was played
  await page.getByRole("button", { name: "Other missions" }).click();
  await expect(page.locator("#choose")).toBeVisible();
  await expect(page.locator("#setupTitle")).toHaveText("A morning at Bf Neustadt");
  await expect(page.locator("#setupTitle")).toBeFocused();
  await expect(page).toHaveURL(/\?mission=neustadt-morning$/);
  await expect(page.locator("#resume")).toBeVisible();
  await expect(page.locator(".site-bar")).toBeVisible();
  expect(errors).toEqual([]);
});

/* ---------------------------------------------------------------- saved, resumed; a phone */

test("autosave and resume: after a reload the session goes on at the same time, with the route set", async ({ page }) => {
  const errors = await start(page);
  await run(page, 100);
  await tool(page, SIGNALLER, /^Moves \(\d+\)$/).click();
  const set = move(page, SIGNALLER, "Set a route");
  await set.getByLabel("From → to").selectOption("A-G2");
  await set.getByRole("button", { name: "Set a route" }).click();
  await closeDialog(page);
  await run(page, 20);
  await expect(page.locator("#clock")).toHaveText("08:02:00");
  const at = await page.evaluate(() => [window.__play.session.ticks, window.__play.session.record.length]);
  expect(at[1]).toBe(1);
  await page.reload();
  await page.waitForFunction(() => window.__play?.ready);
  expect(await page.evaluate(() => window.__play.session)).toBeNull();
  // the mission's setup offers the session: Resume first, and Play has become "Start anew"
  await expect(page.locator("#setup")).toContainText("A session of this mission is saved in this browser (The morning shift, 08:02:00).");
  await expect(page.locator("#resume")).toHaveText("Resume");
  await expect(page.locator("#resume")).toHaveClass(cls("primary"));
  await expect(page.getByRole("button", { name: "Start anew" })).toHaveAttribute("id", "start");
  await expect(page.locator("#start")).not.toHaveClass(cls("primary"));
  await page.locator("#resume").click();
  await expect(page.locator("#clock")).toHaveText("08:02:00");
  await expect(page.getByRole("button", { name: "Pause" })).toHaveAttribute("aria-pressed", "true");
  await expect(live(page)).toContainText("Paused.");
  await expect(tableOf(page, SIGNALLER, "Routes set").locator("tbody tr")).toContainText(["A → G2"]);
  expect(await page.evaluate(() => [window.__play.session.ticks, window.__play.session.record.length])).toEqual(at);
  // a new session replaces the save
  await page.getByRole("button", { name: "Other missions" }).click();
  await expect(page.locator("#setupTitle")).toHaveText("A morning at Bf Neustadt");
  await page.getByRole("button", { name: "Start anew" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("arail.play.neustadt-morning")).record)).toEqual([]);
  expect(errors).toEqual([]);
});

test("the terms met are kept with a session that is taken up again: those of the last screen before the page was left too", async ({ page }) => {
  const errors = await open(page, `${PAGE}?mission=budget-years`);
  await page.locator("#start").click();
  // the first line of the turn names railway terms: shown, they count as met
  await expect(stageOf(page, "#seat-asset-manager").locator(".vn-story .term").first()).toBeVisible();
  const met = await page.evaluate(() => [...window.__play.met]);
  expect(met.length).toBeGreaterThan(0);
  // the page is left with nothing done since: the session's save has them all the same
  await page.reload();
  await page.waitForFunction(() => window.__play?.ready);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("arail.play.budget-years")).met)).toEqual(met);
  await page.locator("#resume").click();
  await page.waitForFunction(() => window.__play.session);
  expect(await page.evaluate(() => [...window.__play.met])).toEqual(expect.arrayContaining(met));
  expect(errors).toEqual([]);
});

test("two people at two seats: each seat is told its own lines of the story, and what one has answered is still said to the other", async ({ page }) => {
  const errors = await open(page, MORNING);
  await page.locator('label[for="by-maintenance-dispatcher"]').click();
  await expect(page.locator("#by-maintenance-dispatcher")).toBeChecked();
  await page.locator("#start").click();
  await page.waitForFunction(() => window.__play.session);
  await page.getByRole("button", { name: "Pause" }).click();
  await run(page, 3);
  const signaller = stageOf(page, SIGNALLER), maintenance = stageOf(page, MAINTENANCE);
  // the train dispatcher speaks to the signaller, the team leader to the maintenance dispatcher
  await expect(signaller.locator(".vn-name strong")).toHaveText("R. Dohle");
  await expect(signaller.locator(".vn-line")).toContainText("Nine trains this morning");
  await signaller.locator(".vn-story .btn").click();
  await expect(signaller.locator(".vn-story")).toBeHidden();
  await page.locator("#tab-maintenance-dispatcher").click();
  await expect(maintenance.locator(".vn-name strong")).toHaveText("M. Specht");
  await expect(maintenance.locator(".vn-line")).toContainText("Two teams on shift");
  // a line for everybody, said now: the signaller's OK does not take it from the maintenance dispatcher
  await page.evaluate(() => {
    const p = window.__play;
    p.beats = [...p.beats, { index: 99, phase: "shift", at: 3, say: "Both of you: the line to Talsee is busy today." }].sort((a, b) => a.at - b.at || a.index - b.index);
    p.draw(true);
  });
  // (the maintenance dispatcher has not answered the team leader yet: that line stays first there)
  await expect(maintenance.locator(".vn-line")).toContainText("Two teams on shift");
  await maintenance.locator(".vn-story .btn").click();
  await expect(maintenance.locator(".vn-line")).toContainText("Both of you");
  await page.locator("#tab-signaller-relay").click();
  await expect(signaller.locator(".vn-line")).toContainText("Both of you");
  await signaller.locator(".vn-story .btn").click();
  await expect(signaller.locator(".vn-story")).toBeHidden();
  await page.locator("#tab-maintenance-dispatcher").click();
  await expect(maintenance.locator(".vn-line")).toContainText("Both of you");
  await maintenance.locator(".vn-story .btn").click();
  await expect(maintenance.locator(".vn-story")).toBeHidden();
  expect(await page.evaluate(() => Object.fromEntries([...window.__play.heardLines].map(([seat, lines]) => [seat, [...lines].sort((a, b) => a - b)])))).toEqual({
    "signaller-relay": [0, 99], "maintenance-dispatcher": [3, 99],
  });
  expect(errors).toEqual([]);
});

test("a session taken up again and left at once keeps what was decided, and what was said stays said", async ({ page }) => {
  const errors = await open(page, `${PAGE}?mission=malus-month`);
  const stage = stageOf(page, "#seat-transport-authority-contract-manager"), saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("arail.play.malus-month")));
  await page.locator("#start").click();
  // what happened is read, the operator's contract manager speaks, the first decision is taken
  for (let i = 0; i < 6 && !(await stage.locator(".vn-decisions").isVisible()); i++) await stage.locator(".vn-story .btn").first().click();
  await expect(stage.locator(".vn-name strong")).toHaveText("T. Lerche");
  expect(await page.evaluate(() => [...window.__play.heardLines].map(([seat, lines]) => [seat, lines.size]))).toEqual([["transport-authority-contract-manager", 1]]);
  await stage.locator(".play-options-row .btn").first().click();
  const diary = await page.evaluate(() => window.__play.diary);
  expect(diary).toHaveLength(1);
  // the page is left and the session taken up again, twice, with nothing done in between
  for (let i = 0; i < 2; i++) {
    await page.reload();
    await page.waitForFunction(() => window.__play?.ready);
    await page.locator("#resume").click();
    await page.waitForFunction(() => window.__play.session);
    expect((await saved()).diary).toEqual(diary);
    expect(await page.evaluate(() => window.__play.diary)).toEqual(diary);
  }
  // the line of the story that was answered is not said again
  expect((await saved()).heard.seats["transport-authority-contract-manager"]).toHaveLength(1);
  expect(await page.evaluate(() => window.__play.beat("transport-authority-contract-manager"))).toBeNull();
  for (let i = 0; i < 6 && (await stage.locator(".vn-story .btn").count()); i++) {
    await expect(stage.locator(".vn-line")).not.toContainText("We are short of drivers");
    await stage.locator(".vn-story .btn").first().click();
  }
  expect(errors).toEqual([]);
});

test("on a phone: no screen scrolls sideways; the line and a wide table scroll in their frames", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const errors = await open(page, `${PAGE}?mission=${LINE.at(-1).id}`);
  expect(await sideways(page)).toBe(false);
  // the line is longer than the screen: it scrolls in its frame, the stop chosen in view
  const line = page.locator("nav.lv-line");
  const inFrame = (id) => page.evaluate((stop) => {
    const a = document.querySelector(`#mission-${stop}`).getBoundingClientRect(), frame = document.querySelector("nav.lv-line").getBoundingClientRect();
    return a.left >= frame.left && a.right <= frame.right;
  }, id);
  expect(await line.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await inFrame(LINE.at(-1).id)).toBe(true);
  expect(await inFrame(LINE[0].id)).toBe(false);
  await page.evaluate(() => window.__play.choose("neustadt-morning"));
  await expect(page.locator("#setupTitle")).toHaveText("A morning at Bf Neustadt");
  expect(await inFrame("neustadt-morning")).toBe(true);
  await page.locator("#setup details.play-more summary").click();
  expect(await sideways(page)).toBe(false);
  await page.locator("#start").click();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await run(page, 802);
  const stage = stageOf(page, SIGNALLER);
  await expect(stage.locator(".play-decision").first()).toBeVisible();
  expect(await sideways(page)).toBe(false);
  // the panel is wider than the screen: its frame scrolls, and can be reached with the keyboard
  const board = page.locator(`${SIGNALLER} .play-board`);
  expect(await board.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(board).toHaveAttribute("tabindex", "0");
  // so does a wide table on the desk
  await openDesk(page, SIGNALLER);
  const trains = page.locator(`${SIGNALLER} .table-scroll`).first();
  expect(await trains.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(trains).toHaveAttribute("tabindex", "0");
  expect(await sideways(page)).toBe(false);
  await closeDialog(page);
  await stage.getByRole("button", { name: "Report it now" }).click();
  await run(page, 2);
  await openFlows(page);
  await expect(page.locator("#flowList li").first()).toBeVisible();
  expect(await sideways(page)).toBe(false);
  await page.locator("#closeFlows").click();
  await page.evaluate(() => {
    const p = window.__play;
    p.sit("signaller-relay", "computer");
    p.skip();
  });
  await expect(page.locator("#resultTitle")).toBeVisible();
  expect(await sideways(page)).toBe(false);
  await page.getByRole("button", { name: "The full report" }).click();
  await expect(page.locator("#result dialog.play-report")).toBeVisible();
  expect(await sideways(page)).toBe(false);
  expect(errors).toEqual([]);
});

/* ---------------------------------------------------------------- turns */

test("budget years: a decision and the plan in a turn, End the turn, the account, the next round; to the result by the fallbacks, and onto the sheet", async ({ page }) => {
  const errors = await open(page, `${PAGE}?mission=budget-years`);
  await expect(page.locator("#by-asset-manager")).toBeChecked();
  await page.locator("#start").click();
  await expect(page.locator("#where")).toHaveText("Round 1 of 4 · The year's plan");
  await expect(page.locator("#phases li")).toHaveText(["The year's plan (turn)", "The year's account (turn)"]);
  await expect(page.locator('#phases li[aria-current="step"]')).toHaveText("The year's plan (turn)");
  await expect(page.locator("#shiftBar")).toBeHidden();
  await expect(page.locator("#skipBar")).toBeHidden();
  // one seat only: there are no tabs to choose between
  await expect(page.locator("#tabs [role=tab]")).toHaveCount(1);
  await expect(page.locator("#tabs")).toBeHidden();
  const panel = page.locator(ASSETS), stage = stageOf(page, ASSETS), end = page.locator("#endTurn"), decisions = stage.locator(".play-decision"), asked = stage.locator(".play-decision:not(.waiting)");
  // what happened is read first; then the five decisions of the year
  await expect(stage.locator(".vn-story")).toBeVisible();
  await expect(live(page)).toContainText("5 decisions to take.");
  await readOn(page, ASSETS);
  await expect(decisions).toHaveCount(5);
  await expect(end).toHaveText("End the turn (5 open)");
  await expect(end).not.toHaveClass(/primary/);
  await expect(page.locator("#turnNote")).toHaveText("5 of your decisions are still open. Ending the turn decides them by their fallback.");
  await expect(tool(page, ASSETS, "End the turn")).toHaveCount(0);
  // a decision that waits is put in focus and answered; its fallback is named, and who asks is the person its title names
  await stage.locator(".play-decision.waiting .play-next").filter({ hasText: "proposes to repair the bridge" }).click();
  await expect(asked).toContainText("proposes to repair the bridge");
  await expect(asked.locator(".hint")).toHaveText("If you skip it: Defer it a year (€20,000)");
  await expect(stage.locator(".vn-name strong")).toHaveText("E. Kiebitz");
  await asked.getByRole("button", { name: /^Approve/ }).click();
  await expect(decisions).toHaveCount(4);
  await expect(end).toHaveText("End the turn (4 open)");
  // the plan as one move, on the desk (the seat's only move names the stage's button): its fields begin with the game's values; it takes the four decisions
  await tool(page, ASSETS, "Set the year's plan").click();
  await expect(deskOf(page, ASSETS)).toBeVisible();
  const plan = move(page, ASSETS, "Set the year's plan");
  await expect(plan.getByLabel("Maintenance strategy")).toHaveValue("standard");
  await expect(plan.getByLabel(/^A technician on call/)).toBeChecked();
  await plan.getByLabel("Maintenance strategy").selectOption("thorough");
  await plan.getByLabel("Emergency teams").selectOption("3");
  await plan.getByRole("button", { name: "Set the year's plan" }).click();
  await expect(decisions).toHaveCount(0);
  await closeDialog(page);
  await expect(end).toHaveText("End the turn");
  await expect(end).toHaveClass(/primary/);
  await expect(page.locator("#turnNote")).toHaveText("Nothing is left for you to decide in this turn.");
  expect(await page.evaluate(() => window.__play.session.seat("asset-manager").game.plan)).toMatchObject({ strategy: "thorough", teams: 3, on_call: true });
  // with nothing left to decide the line at the top offers to end the turn (once on the screen: not again at the side)
  await expect(part(page, ASSETS, ".vn-note")).toHaveText("Nothing left to decide here. End the turn when you are ready.");
  await expect(end).toBeVisible();
  await expect(tool(page, ASSETS, "End the turn")).toHaveCount(0);
  // the account of the year
  await end.click();
  await expect(page.locator("#where")).toHaveText("Round 1 of 4 · The year's account");
  await expect(page.locator('#phases li[aria-current="step"]')).toHaveText("The year's account (turn)");
  await expect(live(page)).toContainText("Round 1 of 4. The year's account: a turn.");
  const years = tableOf(page, ASSETS, "The years");
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
  // of a session taken up again only the last messages are told anew
  expect(await page.evaluate(() => {
    const g = window.__play.session.seat("asset-manager").game;
    return g.logs.length - window.__play.read.get(g);
  })).toBeLessThanOrEqual(3);
  await expect(stage.locator(".vn-story")).toBeVisible();
  // to the end: what is open is decided by its fallback
  for (const where of ["Round 2 of 4 · The year's account", "Round 3 of 4 · The year's plan", "Round 3 of 4 · The year's account", "Round 4 of 4 · The year's plan", "Round 4 of 4 · The year's account"]) {
    await page.locator("#endTurn").click();
    await expect(page.locator("#where")).toHaveText(where);
  }
  await page.locator("#endTurn").click();
  await expect(page.locator("#resultTitle")).toHaveText("The result: Budget Years");
  await expect(page.locator("#resultTitle")).toBeFocused();
  const result = await page.evaluate(() => window.__play.session.result()), verdict = page.locator("#result .vn-verdict");
  expect(result.seats[0].rounds.at(-1).decisions.filter((d) => d.auto).length).toBe(15);
  expect(result.seats[0].rounds.at(-1).decisions.find((d) => d.id === "proposal" && !d.auto).option).toBe("approve");
  await expect(verdict.locator(".vn-score .score-total")).toHaveText(String(result.score));
  await expect(verdict.locator(".vn-score .stars .visually-hidden")).toHaveText(`${starsFor(result.score, result.passed)} of 3 stars`);
  await expect(verdict.locator(".vn-cast li")).toHaveText([new RegExp(`^Asset manager\\s*${result.score} · you$`)]);
  // the full report: the seat with its four rounds
  await verdict.getByRole("button", { name: "The full report" }).click();
  const report = page.locator("#result dialog.play-report"), seat = report.locator(".play-result-seats .game-card");
  await expect(seat).toHaveCount(1);
  await expect(seat.locator("tbody tr")).toHaveCount(4);
  await expect(seat.locator("tbody tr").first()).toContainText("the whole round");
  await expect(seat).toContainText("Objectives of round 4");
  await expect(report.locator(".play-chain")).toHaveCount(0);
  await expect(report.locator(".play-debrief li")).toHaveCount(3);
  await closeDialog(page);
  expect(await page.evaluate(() => localStorage.getItem("arail.play.budget-years"))).toBeNull();
  // a person sat there: the mission is in the logbook's progress, with its sheet
  const now = await kept(page);
  expect(now.missions["budget-years"]).toEqual({ best: result.score, stars: starsFor(result.score, result.passed), plays: 1, passed: result.passed });
  expect(now.sheets["budget-years"]).toMatchObject({ score: result.score, roles: ["asset-manager"] });
  await expect(verdict.getByRole("link", { name: "Your sheet" })).toHaveAttribute("href", "../logbook/#sheet-budget-years");
  // what a person decided before the page was closed is on the sheet too: it was kept with the saved session
  expect(now.sheets["budget-years"].decisions.map((d) => [d.round, d.chose])).toContainEqual([1, "Approve: repair it this year (€450,000)"]);
  expect(errors).toEqual([]);
});

test("three years of Neustadt: the computer's turn, your turn, the shift watched and skipped; the budget, the staff plan and the reports in the flows", async ({ page }) => {
  const errors = await open(page, `${PAGE}?mission=neustadt-years`);
  await expect(page.locator("#by-asset-manager")).toBeChecked();
  await expect(page.locator("#by-bundestag-budget-mp")).not.toBeChecked();
  await expect(page.locator("#setup label.lv-seat")).toHaveCount(6);
  await page.locator("#start").click();
  // the rapporteur's turn was the computer's: the session waits in the asset manager's
  await expect(page.locator("#where")).toHaveText("Round 1 of 3 · The plans for the year");
  await expect(page.locator("#phases li")).toHaveCount(4);
  await expect(page.locator('#phases li[aria-current="step"]')).toHaveText("The plans for the year (turn)");
  await expect(page.getByRole("tab")).toHaveCount(6);
  await expect(page.locator("#tab-asset-manager")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#tab-signaller-relay")).toContainText("not at work");
  const flows = page.locator("#flowList li"), filter = page.locator("#flowFilter");
  await openFlows(page);
  await filter.selectOption("budget");
  const budget = flows.first();
  await expect(flows).toHaveCount(1);
  await expect(budget.locator("strong")).toHaveText(await flowName(page, "budget"));
  await expect(budget).toContainText("Round 1 · The night session: the rail budget");
  await expect(budget).toContainText("→ Asset manager");
  await expect(budget).toContainText("year: 2027 · maintenance: ");
  await page.locator("#closeFlows").click();
  // a seat whose game has not begun
  await page.locator("#tab-signaller-relay").click();
  await expect(part(page, SIGNALLER, ".vn-note")).toHaveText("Not at work in this phase. Its game has not begun yet.");
  await expect(page.locator(`${SIGNALLER} .play-sketch`)).toBeHidden();
  await expect(deskOf(page, SIGNALLER).locator(".play-state")).toHaveText("Not at work in this phase. Its game has not begun yet.");
  // the turn ends with its fallbacks: the plan goes down, the shift is the computers'
  await page.locator("#endTurn").click();
  await expect(page.locator("#where")).toHaveText("Round 1 of 3 · A morning at Bf Neustadt");
  await expect(page.locator("#clock")).toHaveText(/^08:00:\d\d$/);
  await expect(page.locator("#skipBar")).toBeVisible();
  // nobody of the people is at work in it: a seat that is, one with a picture, is shown to watch
  await expect(page.locator("#tab-signaller-relay")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(`${SIGNALLER} .play-sketch h4`)).toHaveText("The panel");
  await expect(page.locator(`${SIGNALLER} .play-board`)).toHaveAttribute("role", "img");
  await expect(deskOf(page, SIGNALLER).locator("h3")).toHaveText("Signaller at Bf Neustadt");
  await openFlows(page);
  await filter.selectOption("staff-plan");
  await expect(flows).toHaveCount(1);
  await expect(flows).toContainText(["Round 1 · The plans for the year"]);
  await expect(flows).toContainText(["Asset manager → Maintenance and fault dispatcher"]);
  await expect(flows).toContainText(["teams: 2 · on call: yes"]);
  await page.locator("#closeFlows").click();
  await page.getByRole("button", { name: "Skip to the end of the shift" }).click();
  // the account: the person's seat is shown again; the morning's reports have come up
  await expect(page.locator("#where")).toHaveText("Round 1 of 3 · The year's accounts");
  await expect(page.locator("#tab-asset-manager")).toHaveAttribute("aria-selected", "true");
  await openFlows(page);
  await filter.selectOption("performance-report");
  // the signaller's, the maintenance dispatcher's and the undertaking's accounts of the morning
  await expect(flows.filter({ hasText: "Round 1 · 08:40:00" }).filter({ hasText: "→ Asset manager" })).toHaveCount(3);
  await expect(flows.filter({ hasText: "Round 1 · 08:40:00" }).filter({ hasText: "kind: undertaking" })).toContainText("Transport authority contract manager");
  await expect(flows.filter({ hasText: "Signaller in a relay interlocking → Asset manager" })).toContainText("kind: operations");
  await expect(page.locator("#flowCounts li").filter({ hasText: await flowName(page, "budget") }).first()).toBeVisible();
  await page.locator("#closeFlows").click();
  // the next year begins with the next budget
  await page.locator("#endTurn").click();
  await expect(page.locator("#where")).toHaveText("Round 2 of 3 · The plans for the year");
  await openFlows(page);
  await filter.selectOption("budget");
  await expect(flows.first()).toContainText("Round 2 · The night session: the rail budget");
  expect(errors).toEqual([]);
});

test("a seat whose game must be told its world: the fields before Play; the key is not kept", async ({ page }) => {
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
  await expect(page.locator("#resume")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("arail.play.lab-morning"))).toBeNull();
  // started (no lab answers at this address: the shift goes on without it), it is not saved
  await page.locator("#start").click();
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
  await expect(page.locator("#setupTitle")).toHaveText("A morning in the lab");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(page.locator(".site-bar")).toBeVisible();
  // the morning without the lab is kept as before, and goes on when the page comes back from the cache
  await page.goto(MORNING);
  await page.waitForFunction(() => window.__play?.ready);
  await expect(page.locator("#noResume")).toHaveCount(0);
  await expect(page.locator("#setup .hint.error")).toHaveCount(0);
  await page.locator("#start").click();
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
  // somebody of the test's own speaks in the plan of the first year
  story: [{ phase: "plan", rounds: [1], who: { name: "S. Fink", role: "Head of the district", portrait: "office" }, say: "Two years, one district. Plan the teams first." }],
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
  // the line has the two missions; one with a game the page does not have is shown, but cannot be played
  await expect(page.locator("#missions a.lv-stop .name")).toHaveText(["A morning at Bf Neustadt", "Two budget years"]);
  await expect(stopOf(page, "test-years")).toHaveClass(cls("on"));
  await expect(page.locator("#setupTitle")).toHaveText("Two budget years");
  await expect(page.locator("#setup .hint.error")).toHaveText('This mission cannot be played here: seat asset-manager: there is no game "test-plan".');
  await expect(page.locator("#start")).toHaveCount(0);
  await addPlanGame(page);
  await expect(page.locator("#setup .hint.error")).toHaveCount(0);
  // a mission without a hook shows the first sentence of its briefing
  await expect(page.locator("#setup .play-hook")).toHaveText(YEARS.text);
  await expect(page.locator("#setup .facts li")).toHaveText(["3 roles", "2 rounds", "5 min on the clock + 2 turns each", "together"]);
  await expect(page.locator("#setup")).toContainText("2 rounds: The year's plan (a turn), A morning (a shift of 5 min), The year's account (a turn).");
  const plan$ = await flowName(page, "staff-plan");
  await expect(page.locator(".play-wiring tbody tr").first()).toContainText(`${plan$} to Maintenance and fault dispatcher`);
  // what the seat's game must be told before it begins
  await expect(page.getByLabel("A note for the plan")).toHaveValue("none");
  await page.getByLabel("A note for the plan").fill("year one");
  await page.locator("#start").click();
  expect(await page.evaluate(() => window.__play.session.seat("asset-manager").game.note)).toBe("year one");

  // the plan of year 1: a turn, no clock; nothing has happened yet, so the mission's own line is said first
  await expect(page.locator("#where")).toHaveText("Round 1 of 2 · The year's plan");
  await expect(page.locator("#phases li")).toHaveText(["The year's plan (turn)", "A morning (shift)", "The year's account (turn)"]);
  await expect(page.locator('#phases li[aria-current="step"]')).toHaveText("The year's plan (turn)");
  await expect(page.locator("#shiftBar")).toBeHidden();
  const panel = page.locator(ASSETS), stage = stageOf(page, ASSETS), desk = deskOf(page, ASSETS);
  await expect(desk.locator("h3")).toHaveText("A year of the assets");
  const end = page.locator("#endTurn");
  await expect(end).toHaveText("End the turn (1 open)");
  await expect(end).not.toHaveClass(/primary/);
  await expect(page.locator("#turnNote")).toHaveText("1 of your decisions is still open. Ending the turn decides it by its fallback.");
  await expect(live(page)).toContainText("Round 1 of 2. The year's plan: a turn.");
  await expect(live(page)).toContainText("Asset manager: How many emergency teams this year?");
  await expect(stage.locator(".vn-story .vn-line")).toHaveText(YEARS.story[0].say);
  await expect(stage.locator(".vn-name")).toHaveText("S. FinkHead of the district");
  await stage.locator(".vn-story").getByRole("button", { name: "OK" }).click();
  const decision = stage.locator(".play-decision");
  await expect(stage.locator(".vn-count")).toHaveText("A decision");
  await expect(decision.locator(".hint")).toHaveText("If you skip it: Two teams");
  // the focus has gone on to the decision's first option
  await expect(decision.getByRole("button", { name: "One team" })).toBeFocused();
  await decision.getByRole("button", { name: "One team" }).click();
  await expect(end).toHaveText("End the turn");
  await expect(end).toHaveClass(/primary/);
  // the move, on the desk: a number within its limits, a checkbox; what the game refuses
  await tool(page, ASSETS, "Spend on upkeep").click();
  await expect(desk).toBeVisible();
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
  await expect(part(page, ASSETS, ".play-log").locator("li").first()).toContainText("Spent 80 k€ on upkeep, the urgent work first.");
  await expect(part(page, ASSETS, ".vn-gauges").locator("div").first()).toHaveText("Money20 k€");
  await expect(spend.getByLabel("The urgent work first")).not.toBeChecked();
  await amount.fill("40");
  await spend.getByRole("button", { name: "Spend on upkeep" }).click();
  await expect(spend.getByRole("status")).toHaveText("That is more than the money left.");
  await expect(panel.locator(".play-table")).toContainText("Teams1");
  await closeDialog(page);
  // what the move did is told on the stage, in a turn, as a line to read
  await expect(stage.locator(".vn-story .vn-line")).toHaveText("Spent 80 k€ on upkeep, the urgent work first.");
  await expect(stage.locator(".vn-story .btn.primary")).toHaveAccessibleName("Go on");

  // the turn ends: the plan reaches the shift as state flows; nobody of the people works in the shift
  await end.focus();
  await end.click();
  await expect(page.locator("#where")).toHaveText("Round 1 of 2 · A morning");
  await expect(page.locator("#stripTitle")).toBeFocused();
  await expect(page.locator("#turnBar")).toBeHidden();
  await expect(page.locator("#skipBar")).toBeVisible();
  // a seat at work, with a picture, is shown; the person's own seat rests in its last state
  await expect(page.locator("#tab-signaller-relay")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#tab-asset-manager")).toContainText("not at work");
  await page.locator("#tab-asset-manager").click();
  await expect(part(page, ASSETS, ".vn-note")).toHaveText("Not at work in this phase. This is its last state.");
  await expect(desk.locator(".play-state")).toHaveText("Not at work in this phase. This is its last state.");
  await expect(panel.locator(".play-move")).toHaveCount(0);
  expect(await toolNames(page, ASSETS)).toEqual(["Desk", "Hand to the computer"]);
  const flows = page.locator("#flowList li");
  await expect(flows.filter({ hasText: plan$ })).toContainText("Round 1 · The year's plan");
  await expect(flows.filter({ hasText: plan$ })).toContainText("Asset manager → Maintenance and fault dispatcher");
  await expect(flows.filter({ hasText: plan$ })).toContainText("teams: 1 · on call: yes");
  await expect(flows.filter({ hasText: await flowName(page, "asset-condition") })).toContainText("grade: 1");
  expect(await page.evaluate(() => window.__play.session.seat("maintenance-dispatcher").game.teams.length)).toBe(1);
  await page.getByRole("button", { name: "Skip to the end of the shift" }).click();

  // the account: the person's seat is shown again; the shift's reports have come and are told; nothing to decide, the turn can be ended
  await expect(page.locator("#where")).toHaveText("Round 1 of 2 · The year's account");
  await expect(page.locator("#tab-asset-manager")).toHaveAttribute("aria-selected", "true");
  await expect(stage.locator(".vn-story .vn-line")).toHaveText(/^A report on \w+: \d+ points\.$/);
  await readOn(page, ASSETS);
  await expect(part(page, ASSETS, ".vn-gauges").locator("div").nth(1)).toHaveText("Reports read2");
  await expect(flows.filter({ hasText: await flowName(page, "performance-report") }).first()).toContainText("Round 1 · 08:05:00");
  await expect(end).toHaveClass(/primary/);
  await expect(page.locator("#turnNote")).toHaveText("Nothing is left for you to decide in this turn.");
  await end.click();

  // year 2: the story's line was for the first year only; the decision left open is taken by its fallback
  await expect(page.locator("#where")).toHaveText("Round 2 of 2 · The year's plan");
  await expect(stage.locator(".vn-story")).toBeHidden();
  await expect(stage.locator(".play-decision")).toHaveCount(1);
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
  await expect(part(page, ASSETS, ".vn-gauges").locator("div").nth(1)).toHaveText("Reports read4");
  await page.locator("#endTurn").click();

  // the result: every seat with its two rounds
  await expect(page.locator("#resultTitle")).toHaveText("The result: Two budget years");
  await expect(page.locator("#result .vn-cast li .name")).toHaveText(["Asset manager", "Signaller in a relay interlocking", "Maintenance and fault dispatcher"]);
  await expect(page.locator("#result .vn-cast li").first()).toHaveClass(cls("bad"));
  await expect(page.locator("#result .vn-question")).toContainText("What did the second team cost, and what did it save?");
  await page.getByRole("button", { name: "The full report" }).click();
  const seats = page.locator("#result .play-result-seats .game-card");
  await expect(seats).toHaveCount(3);
  await expect(seats.first().locator("tbody tr")).toHaveText([/^1\s*the whole round\s*20\s*not passed\s*0$/, /^2\s*the whole round\s*20\s*not passed\s*0$/]);
  await expect(seats.first()).toContainText("Objectives of round 2");
  await expect(seats.nth(1).locator("tbody tr")).toHaveCount(2);
  await expect(seats.nth(1).locator("tbody tr").first()).toContainText("A morning");
  await expect(page.locator("#result .play-debrief li")).toHaveText(["What did the second team cost, and what did it save?"]);
  expect(errors).toEqual([]);
});
