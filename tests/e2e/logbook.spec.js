// End-to-end tests of the logbook of the game (game/logbook/): an empty logbook; with a progress kept
// in the browser (made by `record` and `meet` of game/progress.js, as the play page makes it) the rank
// the stars add up to, the missions on their line, the badges, the railway terms as cards to turn
// and the quiz about them, the places worked at, a sheet per mission with what was decided, the
// address of a sheet, and the logbook emptied through its dialog; the way from a mission's verdict
// on the play page to its sheet; a phone.
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

const PAGE = "/game/logbook/";
/** Where the pages keep what a player has reached (game/progress.js). */
const PROGRESS = "arail.game.progress";

/** The missions of the line in their order: missions.json and the documents it lists. */
const MISSIONS = new URL("../../web/game/missions/", import.meta.url);
const LINE = JSON.parse(readFileSync(new URL("missions.json", MISSIONS), "utf8")).missions.map((file) => JSON.parse(readFileSync(new URL(file, MISSIONS), "utf8")));
const missionOf = (id) => LINE.find((m) => m.id === id);

/** What the signaller decided when the signal failed, as the play page keeps it for the sheet. */
const DECIDED = [
  { who: "Signaller in a relay interlocking", title: "Signal N2 has failed. Report the fault to the maintenance dispatcher?", chose: "Report it now", round: 1 },
  { who: "Signaller in a relay interlocking", title: "Exit signal N2 cannot show a proceed aspect. How can RB 33 leave track G2?", chose: "With the substitute signal Zs 1, once its route is set and locked and the track ahead is clear", round: 1 },
];
/**
 * Missions played, in the order they were: the first shift twice (90 points, then 72: its best is
 * kept, its sheet is the last time's), the morning at Bf Neustadt passed with a rule broken, and the
 * budget years not passed, with a danger to people and decisions in two rounds.
 */
const PLAYED = [
  { mission: "first-shift", score: 90, passed: true, roles: ["signaller-relay"], terms: ["route"] },
  { mission: "first-shift", score: 72, passed: true, roles: ["signaller-relay"], terms: ["route"] },
  { mission: "neustadt-morning", score: 74, passed: true, roles: ["signaller-relay"], violations: 1, decisions: DECIDED, terms: ["zs1", "route", "closure"] },
  {
    mission: "budget-years", score: 45, passed: false, roles: ["asset-manager"], violations: 2, danger: true, terms: ["lufv", "grade", "replacement"],
    decisions: [
      { who: "Asset manager", title: "Year 1: the maintenance strategy", chose: "Lean: €3.50 M", round: 1 },
      { who: "Asset manager", title: "Year 1: the emergency teams", chose: "1 team: €400,000", round: 1 },
      { who: "Asset manager", title: "Year 2: the maintenance strategy", chose: "Thorough: €5.10 M", round: 2 },
    ],
  },
];
/** The terms met in them, as the glossary orders them is the page's matter; these are their ids. */
const MET = ["route", "zs1", "closure", "lufv", "grade", "replacement"];

/**
 * Open the logbook with a progress kept in the browser: the missions played and further terms met
 * (nothing: an empty browser). It is ready when the missions are loaded.
 */
async function open(page, { played = [], terms = [], path = PAGE } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(PAGE);
  await page.evaluate(async ([key, plays, met]) => {
    localStorage.clear();
    if (!plays.length && !met.length) return;
    const { emptyProgress, meet, record } = await import("/game/progress.js");
    localStorage.setItem(key, JSON.stringify(meet(plays.reduce((p, x) => record(p, x), emptyProgress()), met)));
  }, [PROGRESS, played, terms]);
  // from another document, so that an address with a #sheet loads the page anew
  await page.goto("about:blank");
  await page.goto(path);
  await page.waitForFunction(() => window.__logbook?.ready);
  return errors;
}

/** The glossary's terms and the badges, as the page has them. */
const catalogue = (page) => page.evaluate(async () => {
  const { TERMS } = await import("/game/glossary.js");
  const { BADGES } = await import("/game/progress.js");
  return { terms: TERMS.map((t) => ({ id: t.id, term: t.term, de: t.de ?? null, line: t.line })), badges: BADGES.map((b) => ({ id: b.id, title: b.title, how: b.how })) };
});

const kept = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), PROGRESS);
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
/** A class among others. */
const cls = (name) => new RegExp(`(^|\\s)${name}(\\s|$)`);

test("an empty logbook: a passenger with no star, the line still to play, every badge and term closed, no sheet", async ({ page }) => {
  const errors = await open(page);
  const { terms, badges } = await catalogue(page);
  await expect(page).toHaveTitle("Your logbook · ARail Game");
  const rank = page.locator("#rank");
  await expect(rank.locator("h1")).toHaveText("Passenger");
  await expect(rank.locator(".log-count span")).toHaveText(["0 stars", `0 of ${LINE.length} missions passed`, `0 of ${terms.length} railway terms`, `0 of ${badges.length} badges`]);
  await expect(rank.locator(".log-next")).toHaveText("1 more star to Trainee");
  const meter = rank.getByRole("progressbar", { name: "On the way to Trainee" });
  await expect(meter).toHaveAttribute("aria-valuenow", "0");
  await expect(meter).toHaveAttribute("aria-valuemin", "0");
  await expect(meter).toHaveAttribute("aria-valuemax", "1");
  // the ladder of ranks: the first is the one held
  const ranks = rank.locator(".log-ranks li");
  await expect(ranks).toHaveCount(8);
  await expect(ranks.first()).toHaveText("Passenger 0★");
  await expect(ranks.first()).toHaveClass(cls("now"));
  await expect(ranks.first()).toHaveAttribute("aria-current", "true");
  await expect(ranks.last()).toHaveText("Minister of transport 27★");
  await expect(rank.locator(".log-ranks li.had")).toHaveCount(0);
  await expect(rank.getByRole("link", { name: "Play your first shift" })).toHaveAttribute("href", "../play/");
  // the line: every mission in its order, none played, each to play
  const line = page.locator("#line li");
  await expect(line.locator(".name")).toHaveText(LINE.map((m) => m.title));
  await expect(line.locator(".no")).toHaveText(LINE.map((_, i) => String(i + 1).padStart(2, "0")));
  await expect(line.locator(".best")).toHaveText(LINE.map(() => "not played yet"));
  await expect(line.locator(".stars .visually-hidden")).toHaveText(LINE.map(() => "0 of 3 stars"));
  await expect(page.locator("#line li.done, #line li.tried")).toHaveCount(0);
  await expect(line.first().getByRole("link", { name: `Play ${LINE[0].title}` })).toHaveAttribute("href", `../play/?mission=${LINE[0].id}`);
  await expect(page.locator("#line").getByRole("link", { name: "Sheet" })).toHaveCount(0);
  // the badges: all there, none earned, each with how it is earned
  const badge = page.locator("#badges li");
  await expect(badge.locator("strong")).toHaveText(badges.map((b) => b.title));
  await expect(page.locator("#badges li.on")).toHaveCount(0);
  await expect(badge.first()).toContainText(badges[0].how);
  await expect(badge.first()).not.toContainText("Earned.");
  await expect(badge.first().locator(".medal")).toHaveText("?");
  // the terms: none met, no card to turn, no quiz
  await expect(page.locator("#termsNote")).toHaveText(`None of ${terms.length} met yet. A term is met when a mission shows it.`);
  await expect(page.locator("#terms button.log-term")).toHaveCount(0);
  await expect(page.locator("#terms li.closed")).toHaveText(`+${terms.length}terms still to meet`);
  await expect(page.locator("#quizBtn")).toBeHidden();
  await expect(page.locator("#quiz")).toBeHidden();
  // the places: pictures of where the missions play, none been to (a picture nobody has seen says nothing)
  const places = page.locator("#places li");
  expect(await places.count()).toBeGreaterThan(2);
  await expect(page.locator("#places li.been")).toHaveCount(0);
  await expect(places.first().locator("span")).toHaveText("Not been there yet");
  await expect(places.first().locator("img")).toHaveAttribute("alt", "");
  // no sheet, and why
  await expect(page.locator("#sheetsNote")).toBeVisible();
  await expect(page.locator("#sheetsNote")).toContainText("A mission you have played leaves a sheet here");
  await expect(page.locator("#sheets article")).toHaveCount(0);
  // the way back to the missions
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Missions" })).toHaveAttribute("href", "../play/");
  expect(errors).toEqual([]);
});

test("a logbook with missions played: the rank and what the next one needs, the line with stars and best scores, the badges earned, the places", async ({ page }) => {
  const errors = await open(page, { played: PLAYED });
  const { terms, badges } = await catalogue(page);
  // 3 stars of the first shift (its best) and 2 of the morning: 5, a signaller; the dispatcher needs 8
  const rank = page.locator("#rank");
  await expect(rank.locator("h1")).toHaveText("Signaller");
  const earned = await page.evaluate(async ([key, ids]) => (await import("/game/progress.js")).badgesOf(JSON.parse(localStorage.getItem(key)), ids), [PROGRESS, LINE.map((m) => m.id)]);
  await expect(rank.locator(".log-count span")).toHaveText(["5 stars", `2 of ${LINE.length} missions passed`, `${MET.length} of ${terms.length} railway terms`, `${earned.length} of ${badges.length} badges`]);
  await expect(rank.locator(".log-next")).toHaveText("3 more stars to Dispatcher");
  const meter = rank.getByRole("progressbar", { name: "On the way to Dispatcher" });
  await expect(meter).toHaveAttribute("aria-valuenow", "5");
  await expect(meter).toHaveAttribute("aria-valuemin", "4");
  await expect(meter).toHaveAttribute("aria-valuemax", "8");
  expect(await meter.locator("i").evaluate((i) => i.style.width)).toBe("25%");
  const ranks = rank.locator(".log-ranks li");
  await expect(rank.locator(".log-ranks li.had")).toHaveText(["Passenger 0★", "Trainee 1★"]);
  await expect(rank.locator(".log-ranks li.now")).toHaveText("Signaller 4★");
  await expect(ranks.nth(2)).toHaveAttribute("aria-current", "true");
  await expect(rank.getByRole("link", { name: "To the missions" })).toHaveAttribute("href", "../play/");
  await expect(rank.getByRole("link", { name: "Play your first shift" })).toHaveCount(0);
  // the line: the best score and the most stars are kept, and how often a mission was played
  const stop = (id) => page.locator("#line li").nth(LINE.indexOf(missionOf(id)));
  await expect(stop("first-shift")).toHaveClass(cls("done"));
  await expect(stop("first-shift").locator(".stars .visually-hidden")).toHaveText("3 of 3 stars");
  await expect(stop("first-shift").locator(".best")).toHaveText("best 90 · played 2 times");
  await expect(stop("neustadt-morning")).toHaveClass(cls("done"));
  await expect(stop("neustadt-morning").locator(".stars .visually-hidden")).toHaveText("2 of 3 stars");
  await expect(stop("neustadt-morning").locator(".best")).toHaveText("best 74 · played once");
  // tried and not passed: no star, not done
  await expect(stop("budget-years")).toHaveClass(cls("tried"));
  await expect(stop("budget-years")).not.toHaveClass(cls("done"));
  await expect(stop("budget-years").locator(".stars .visually-hidden")).toHaveText("0 of 3 stars");
  await expect(stop("budget-years").locator(".best")).toHaveText("best 45 · played once");
  await expect(page.locator("#line li.done")).toHaveCount(2);
  await expect(page.locator("#line").getByRole("link", { name: "Sheet" })).toHaveCount(3);
  await expect(stop("neustadt-morning").getByRole("link", { name: "Sheet" })).toHaveAttribute("href", "#sheet-neustadt-morning");
  await expect(stop("neustadt-morning").getByRole("link", { name: "Play A morning at Bf Neustadt" })).toHaveAttribute("href", "../play/?mission=neustadt-morning");
  const untouched = LINE.find((m) => !PLAYED.some((p) => p.mission === m.id));
  await expect(stop(untouched.id).locator(".best")).toHaveText("not played yet");
  // the badges: the earned ones lit and said to be earned, the others still with how
  const badge = (title) => page.locator("#badges li").filter({ has: page.locator("strong", { hasText: new RegExp(`^${title}$`) }) });
  await expect(page.locator("#badges li.on")).toHaveCount(earned.length);
  for (const title of ["First shift", "Signed off", "Three stars", "By the book", "The authority would like a word"]) {
    await expect(badge(title)).toHaveClass(cls("on"));
    await expect(badge(title)).toContainText("Earned.");
    await expect(badge(title).locator(".medal")).toHaveText("★");
  }
  for (const title of ["Many hats", "Speaks railway", "Full house", "All aboard", "Perfectionist"]) {
    await expect(badge(title)).not.toHaveClass(cls("on"));
    await expect(badge(title).locator(".medal")).toHaveText("?");
  }
  await expect(badge("Many hats")).toContainText("Sit in four different roles.");
  // the places: where a mission was played, the picture with its name and what it shows
  const places = await page.evaluate(async (docs) => {
    const { placeOfMission } = await import("/game/places.js");
    return docs.map((doc) => ({ mission: doc.id, name: placeOfMission(doc).name }));
  }, LINE);
  const been = [...new Set(places.filter((p) => PLAYED.some((x) => x.mission === p.mission)).map((p) => p.name))];
  expect(been.length).toBe(2);
  await expect(page.locator("#places li.been span")).toHaveText(been);
  await expect(page.locator("#places li.been img").first()).toHaveAttribute("alt", /\S/);
  await expect(page.locator("#places li")).toHaveCount(new Set(places.map((p) => p.name)).size);
  await expect(page.locator("#places li:not(.been) span").first()).toHaveText("Not been there yet");
  expect(errors).toEqual([]);
});

test("the railway terms met are cards: a card turns to what the term is, and back; the others stay closed", async ({ page }) => {
  const errors = await open(page, { played: PLAYED });
  const { terms } = await catalogue(page);
  // in the glossary's order: the term and its German word
  const met = terms.filter((t) => MET.includes(t.id)), cards = page.locator("#terms button.log-term");
  await expect(page.locator("#termsNote")).toHaveText(`${met.length} of ${terms.length} met. Tap a card to turn it. A term is met when a mission shows it.`);
  expect(await cards.evaluateAll((list) => list.map((b) => b.dataset.term))).toEqual(met.map((t) => t.id));
  await expect(cards.locator("strong")).toHaveText(met.map((t) => t.term));
  const zs1 = page.locator('#terms button.log-term[data-term="zs1"]'), term = terms.find((t) => t.id === "zs1");
  await expect(zs1.locator("[lang=de]")).toHaveText(term.de);
  await expect(zs1).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#terms li.closed")).toHaveText(`+${terms.length - met.length}terms still to meet`);
  await expect(page.locator("#terms li.closed button")).toHaveCount(0);
  // a click turns the card: what the term is; the focus stays on it
  await zs1.click();
  await expect(zs1).toHaveClass(cls("turned"));
  await expect(zs1).toHaveAttribute("aria-expanded", "true");
  await expect(zs1).toHaveText(term.line);
  await expect(zs1).toBeFocused();
  await expect(page.locator("#terms button.log-term.turned")).toHaveCount(1);
  // with the keyboard: Enter turns it back, and another card
  await page.keyboard.press("Enter");
  await expect(zs1).not.toHaveClass(cls("turned"));
  await expect(zs1).toHaveAttribute("aria-expanded", "false");
  await expect(zs1.locator("strong")).toHaveText(term.term);
  await expect(zs1).toBeFocused();
  await cards.first().focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await expect(page.locator("#terms button.log-term.turned")).toHaveCount(2);
  await expect(cards.first()).toHaveText(met[0].line);
  await expect(cards.nth(1)).toHaveText(met[1].line);
  await expect(cards.nth(1)).toBeFocused();
  // a term met outside a mission played (shown on the play page) is a card too
  const more = terms.find((t) => !MET.includes(t.id));
  await open(page, { played: PLAYED, terms: [more.id] });
  await expect(page.locator(`#terms button.log-term[data-term="${more.id}"] strong`)).toHaveText(more.term);
  await expect(page.locator("#terms button.log-term")).toHaveCount(met.length + 1);
  expect(errors).toEqual([]);
});

test("the quiz: from four terms met, a term's line is asked with four terms to choose from; right and wrong, in a row, closed", async ({ page }) => {
  // three terms are not enough for a question
  const errors = await open(page, { terms: MET.slice(0, 3) });
  await expect(page.locator("#terms button.log-term")).toHaveCount(3);
  await expect(page.locator("#quizBtn")).toBeHidden();
  await open(page, { played: PLAYED });
  const { terms } = await catalogue(page);
  const met = terms.filter((t) => MET.includes(t.id)).map((t) => t.term);
  const button = page.locator("#quizBtn"), quiz = page.locator("#quiz"), options = quiz.locator(".log-quiz-options .btn");
  await expect(button).toBeVisible();
  await expect(button).toHaveText("Quiz me");
  await expect(quiz).toBeHidden();
  await button.click();
  await expect(quiz).toBeVisible();
  await expect(quiz.locator(".log-quiz-q .eyebrow")).toHaveText("Which term is it?");
  // four different terms of those met, the one asked among them; the focus is on the first
  const asked = () => page.evaluate(() => {
    const q = window.__logbook.quiz;
    return { id: q.term.id, term: q.term.term, line: q.term.line, options: q.options.map((t) => t.term) };
  });
  const first = await asked();
  await expect(options).toHaveText(first.options);
  expect(first.options.length).toBe(4);
  expect(new Set(first.options).size).toBe(4);
  expect(first.options).toContain(first.term);
  for (const name of first.options) expect(met).toContain(name);
  await expect(options.first()).toBeFocused();
  // the line asked is the term's, without the term's own words where it names them
  const shown = (await quiz.locator(".log-quiz-q").textContent()).replace("Which term is it?", "");
  expect(shown.replace("…", "").length).toBeLessThanOrEqual(first.line.length);
  expect(first.line.startsWith(shown.split("…")[0])).toBe(true);
  // a wrong answer: the right term is shown, and said to those who do not see the page
  const wrong = first.options.find((name) => name !== first.term);
  await options.filter({ hasText: new RegExp(`^${wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).click();
  await expect(quiz.locator(".log-quiz-a")).toHaveText(`Not quite: it is ${first.term}.`);
  await expect(page.locator("#live")).toHaveText(`Not quite: it is ${first.term}.`);
  await expect(quiz.locator(".log-quiz-options .btn.wrong")).toHaveText(wrong);
  await expect(quiz.locator(".log-quiz-options .btn.right")).toHaveText(first.term);
  // answered: the options rest, the focus is on the next question
  await expect(options.first()).toHaveAttribute("aria-disabled", "true");
  await expect(quiz.getByRole("button", { name: "Next question" })).toBeFocused();
  await quiz.locator(".log-quiz-options .btn.right").click({ force: true }); // it rests, but a click must change nothing
  await expect(quiz.locator(".log-quiz-a")).toHaveText(`Not quite: it is ${first.term}.`);
  expect(await page.evaluate(() => window.__logbook.streak)).toBe(0);
  // the next question asks another term; right answers count in a row
  await quiz.getByRole("button", { name: "Next question" }).click();
  const second = await asked();
  expect(second.id).not.toBe(first.id);
  await expect(quiz.locator(".log-quiz-a")).toHaveCount(0);
  await expect(quiz.getByRole("button", { name: "Next question" })).toHaveCount(0);
  await expect(options.first()).toBeFocused();
  await options.nth(second.options.indexOf(second.term)).click();
  await expect(quiz.locator(".log-quiz-a")).toHaveText("Right.");
  await expect(page.locator("#live")).toHaveText(`Right: ${second.term}.`);
  await expect(quiz.locator(".log-quiz-options .btn.right")).toHaveText(second.term);
  await expect(quiz.locator(".log-quiz-options .btn.wrong")).toHaveCount(0);
  await page.keyboard.press("Enter"); // Next question has the focus
  const third = await asked();
  expect(third.id).not.toBe(second.id);
  await options.nth(third.options.indexOf(third.term)).click();
  await expect(quiz.locator(".log-quiz-a")).toHaveText("Right. 2 in a row.");
  // closed: the focus is back on its button, and it can be asked for again
  await quiz.getByRole("button", { name: "Close the quiz" }).click();
  await expect(quiz).toBeHidden();
  await expect(button).toBeFocused();
  await button.click();
  await expect(quiz).toBeVisible();
  await expect(options).toHaveCount(4);
  expect(errors).toEqual([]);
});

test("a sheet per mission played: the score, the roles, what was decided round by round, the terms met, the debrief; one sheet to print", async ({ page }) => {
  const errors = await open(page, { played: PLAYED });
  const { terms } = await catalogue(page);
  await expect(page.locator("#sheetsNote")).toBeHidden();
  // in the order of the line, one per mission, of the last time it was played
  const sheets = page.locator("#sheets article.log-sheet");
  expect(await sheets.evaluateAll((list) => list.map((a) => a.id))).toEqual(["sheet-first-shift", "sheet-neustadt-morning", "sheet-budget-years"]);
  // the morning at Bf Neustadt: passed with a rule broken; the two decisions, the terms with their lines, the debrief's questions
  const morning = page.locator("#sheet-neustadt-morning"), doc = missionOf("neustadt-morning");
  await expect(morning).toHaveAttribute("aria-labelledby", "sheet-title-neustadt-morning");
  await expect(morning.locator("h3")).toHaveText(doc.title);
  await expect(morning.locator(".log-sheet-score .stars .visually-hidden")).toHaveText("2 of 3 stars");
  await expect(morning.locator(".log-sheet-score")).toContainText("74 of 100 · passed · 1 rule broken");
  await expect(morning).toContainText("You were: Signaller in a relay interlocking.");
  await expect(morning.locator("p.hint").first()).toHaveText(doc.hook);
  await expect(morning.locator("h4")).toHaveText(["What you decided", "The terms you met", "To think about"]);
  const decided = morning.locator(".log-decisions li");
  await expect(decided).toHaveCount(2);
  await expect(decided.locator("span")).toHaveText(DECIDED.map((d) => d.title));
  await expect(decided.locator("strong")).toHaveText(DECIDED.map((d) => d.chose));
  await expect(morning.locator(".log-round")).toHaveCount(0);
  const met = ["zs1", "route", "closure"].map((id) => terms.find((t) => t.id === id));
  await expect(morning.locator(".log-dl dt")).toHaveText(met.map((t) => (t.de ? `${t.term} (${t.de})` : t.term)));
  await expect(morning.locator(".log-dl dd")).toHaveText(met.map((t) => t.line));
  await expect(morning.locator(".log-dl dt [lang=de]").first()).toHaveText(`(${met[0].de})`);
  await expect(morning.locator(".log-debrief li")).toHaveText(doc.debrief);
  await expect(morning.getByRole("link", { name: "Play it again" })).toHaveAttribute("href", "../play/?mission=neustadt-morning");
  // the first shift: the last time's score (not the best), no rule broken, and nothing was asked
  const first = page.locator("#sheet-first-shift");
  await expect(first.locator(".log-sheet-score .stars .visually-hidden")).toHaveText("2 of 3 stars");
  await expect(first.locator(".log-sheet-score")).toContainText("72 of 100 · passed · no rule broken");
  await expect(first).toContainText("No decision was asked of you: you worked on the picture.");
  await expect(first.locator(".log-decisions")).toHaveCount(0);
  // the budget years: not passed, a danger to people; the decisions under their rounds
  const years = page.locator("#sheet-budget-years");
  await expect(years.locator(".log-sheet-score .stars .visually-hidden")).toHaveText("0 of 3 stars");
  await expect(years.locator(".log-sheet-score")).toContainText("45 of 100 · not passed · a danger to people");
  await expect(years).toContainText("You were: Asset manager.");
  await expect(years.locator(".log-round")).toHaveText(["Round 1", "Round 2"]);
  await expect(years.locator(".log-decisions")).toHaveCount(2);
  await expect(years.locator(".log-decisions").first().locator("li")).toHaveCount(2);
  await expect(years.locator(".log-decisions").nth(1).locator("li strong")).toHaveText(["Thorough: €5.10 M"]);
  // one sheet goes to the printer alone: it is marked while it prints
  await page.evaluate(() => {
    window.print = () => {
      window.__printed = [...document.querySelectorAll(".log-sheet.printing")].map((a) => a.id);
    };
  });
  await morning.getByRole("button", { name: "Print this sheet" }).click();
  expect(await page.evaluate(() => window.__printed)).toEqual(["sheet-neustadt-morning"]);
  await page.evaluate(() => dispatchEvent(new Event("afterprint")));
  await expect(page.locator(".log-sheet.printing")).toHaveCount(0);
  // on paper the rest of the page is not there
  await morning.getByRole("button", { name: "Print this sheet" }).click();
  await page.emulateMedia({ media: "print" });
  await expect(morning).toBeVisible();
  await expect(first).toBeHidden();
  await expect(page.locator("#rank")).toBeHidden();
  await expect(page.locator(".site-bar")).toBeHidden();
  await expect(morning.locator(".log-sheet-tools")).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  expect(errors).toEqual([]);
});

test("the address of a sheet: #sheet-<mission> shows it with the focus on its title; the line's link leads there", async ({ page }) => {
  const errors = await open(page, { played: PLAYED, path: `${PAGE}#sheet-neustadt-morning` });
  const sheet = page.locator("#sheet-neustadt-morning");
  await expect(sheet.locator("h3")).toBeFocused();
  await expect(sheet.locator("h3")).toBeInViewport();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(200);
  // a sheet that is not there: the page from its top, nothing lost
  await open(page, { played: PLAYED, path: `${PAGE}#sheet-night-session` });
  await expect(page.locator("#rank h1")).toBeInViewport();
  await expect(page.locator("#sheets article.log-sheet")).toHaveCount(3);
  // from the line to a sheet
  await page.locator("#line").getByRole("link", { name: "Sheet" }).last().click();
  await expect(page).toHaveURL(/#sheet-budget-years$/);
  await expect(page.locator("#sheet-budget-years h3")).toBeInViewport();
  expect(errors).toEqual([]);
});

test("the logbook is emptied only through its dialog: Keep it and Escape keep it, Empty it removes everything", async ({ page }) => {
  const errors = await open(page, { played: PLAYED });
  const dialog = page.locator("#resetDialog"), before = await kept(page);
  expect(Object.keys(before.missions)).toEqual(["first-shift", "neustadt-morning", "budget-years"]);
  await expect(dialog).toBeHidden();
  await page.locator("#resetBtn").click();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Empty your logbook? The stars, badges, terms and sheets are gone for good.");
  // Keep it, and Escape: nothing is lost
  await dialog.getByRole("button", { name: "Keep it" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#resetBtn")).toBeFocused();
  await page.locator("#resetBtn").click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await kept(page)).toEqual(before);
  await expect(page.locator("#rank h1")).toHaveText("Signaller");
  // with a card turned and the quiz open
  await page.locator("#terms button.log-term").first().click();
  await page.locator("#quizBtn").click();
  await expect(page.locator("#quiz")).toBeVisible();
  // Empty it: the progress is gone from the browser and from the page, and it is said
  await page.locator("#resetBtn").click();
  await dialog.getByRole("button", { name: "Empty it" }).click();
  await expect(dialog).toBeHidden();
  expect(await kept(page)).toBeNull();
  await expect(page.locator("#live")).toHaveText("Your logbook is empty.");
  await expect(page.locator("#rank h1")).toHaveText("Passenger");
  await expect(page.locator("#rank .log-count span").first()).toHaveText("0 stars");
  await expect(page.locator("#line li.done, #line li.tried")).toHaveCount(0);
  await expect(page.locator("#badges li.on")).toHaveCount(0);
  await expect(page.locator("#terms button.log-term")).toHaveCount(0);
  await expect(page.locator("#quiz")).toBeHidden();
  await expect(page.locator("#quizBtn")).toBeHidden();
  await expect(page.locator("#places li.been")).toHaveCount(0);
  await expect(page.locator("#sheets article")).toHaveCount(0);
  await expect(page.locator("#sheetsNote")).toBeVisible();
  // the focus is not lost with what was removed
  expect(await page.evaluate(() => document.activeElement !== document.body && document.activeElement.isConnected)).toBe(true);
  // and it stays empty
  await page.reload();
  await page.waitForFunction(() => window.__logbook?.ready);
  await expect(page.locator("#rank h1")).toHaveText("Passenger");
  await expect(page.locator("#rank").getByRole("link", { name: "Play your first shift" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("from a mission's verdict to its sheet: what the play page keeps is what the logbook shows", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/game/play/?mission=budget-years");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/game/play/?mission=budget-years");
  await page.waitForFunction(() => window.__play?.ready);
  await page.locator("#start").click();
  // read on to the decisions of the first year and take one; every turn after it ends by its fallbacks
  const stage = page.locator("#seat-asset-manager .vn-stage");
  await page.evaluate(() => {
    const story = document.querySelector("#seat-asset-manager .vn-story");
    for (let i = 0; i < 300 && !story.hidden; i++) story.querySelector(".btn.primary").click();
  });
  const asked = await page.evaluate(() => {
    const d = window.__play.session.seat("asset-manager").game.open[0];
    return { title: d.title, chose: d.options[0].label };
  });
  await stage.locator(".play-decision:not(.waiting) .play-options-row .btn").first().click();
  for (let i = 0; i < 40 && (await page.evaluate(() => window.__play.screen)) === "play"; i++) await page.locator("#endTurn").click();
  await expect(page.locator("#resultTitle")).toHaveText("The result: Budget Years");
  const result = await page.evaluate(() => window.__play.session.result());
  const stars = result.passed ? 1 + (result.score >= 70) + (result.score >= 85) : 0;
  // the verdict's link leads to the mission's sheet in the logbook
  await page.locator("#result").getByRole("link", { name: "Your sheet" }).click();
  await page.waitForFunction(() => window.__logbook?.ready);
  await expect(page).toHaveURL(/\/game\/logbook\/#sheet-budget-years$/);
  const sheet = page.locator("#sheet-budget-years");
  await expect(sheet.locator("h3")).toBeFocused();
  await expect(sheet.locator("h3")).toHaveText("Budget Years");
  await expect(sheet.locator(".log-sheet-score .stars .visually-hidden")).toHaveText(`${stars} of 3 stars`);
  await expect(sheet.locator(".log-sheet-score")).toContainText(`${result.score} of 100 · ${result.passed ? "passed" : "not passed"}`);
  await expect(sheet).toContainText("You were: Asset manager.");
  await expect(sheet.locator(".log-decisions li")).toHaveCount(1);
  await expect(sheet.locator(".log-decisions li span")).toHaveText(asked.title);
  await expect(sheet.locator(".log-decisions li strong")).toHaveText(asked.chose);
  await expect(sheet.locator(".log-round")).toHaveCount(0);
  // the terms the mission showed are on the sheet, and cards of the logbook
  const met = (await kept(page)).sheets["budget-years"].terms;
  expect(met.length).toBeGreaterThan(0);
  await expect(sheet.locator(".log-dl dt")).toHaveCount(met.length);
  for (const id of met) await expect(page.locator(`#terms button.log-term[data-term="${id}"]`)).toHaveCount(1);
  // the rank, the line and the place follow
  await expect(page.locator("#rank .log-count span").first()).toHaveText(stars === 1 ? "1 star" : `${stars} stars`);
  const stop = page.locator("#line li").nth(LINE.indexOf(missionOf("budget-years")));
  await expect(stop.locator(".best")).toHaveText(`best ${result.score} · played once`);
  await expect(stop.locator(".stars .visually-hidden")).toHaveText(`${stars} of 3 stars`);
  await expect(page.locator("#places li.been")).toHaveCount(1);
  await expect(page.locator("#badges li.on strong").first()).toHaveText("First shift");
  expect(errors).toEqual([]);
});

test("a damaged sheet does not break the logbook: it is shown with what is left of it", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(PAGE);
  // a progress written by hand, or by an older page: a sheet without its parts, a mission without its numbers
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({
    format: "arail-progress/1", missions: { "budget-years": { passed: true, stars: 2 } }, sheets: { "budget-years": {}, "fault-night": { decisions: "none" } }, terms: ["lufv"],
  })), PROGRESS);
  await page.goto("/game/play/");
  await page.goto(PAGE);
  await page.waitForFunction(() => window.__logbook?.ready);
  await expect(page.locator("#rankTitle")).toHaveText("Trainee");
  await expect(page.locator("#sheets .log-sheet")).toHaveCount(2);
  const sheet = page.locator("#sheet-budget-years");
  await expect(sheet.locator("h3")).toHaveText(missionOf("budget-years").title);
  await expect(sheet).toContainText("No decision was asked of you");
  await expect(sheet).toContainText("You were: nobody.");
  await expect(page.locator("#terms .log-term[data-term]")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("on a phone: the logbook does not scroll sideways, with a card turned and the quiz open", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const errors = await open(page, { played: PLAYED });
  expect(await sideways(page)).toBe(false);
  await page.locator("#terms button.log-term").first().click();
  await page.locator("#quizBtn").click();
  await expect(page.locator("#quiz .log-quiz-options .btn")).toHaveCount(4);
  expect(await sideways(page)).toBe(false);
  await page.locator("#resetBtn").click();
  await expect(page.locator("#resetDialog")).toBeInViewport();
  expect(await sideways(page)).toBe(false);
  expect(errors).toEqual([]);
});
