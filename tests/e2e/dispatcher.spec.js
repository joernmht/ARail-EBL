// End-to-end tests of the mission Whose minutes? (game/play/?mission=whose-minutes): the train
// dispatcher's shift on the table. Its stop on the line of missions; a decision that is a number,
// taken with a slider (the keyboard, Enter, the button) or with the option beside it; the picture of
// the platform tracks with a train chosen and its order changed; the phone with its choices; the
// trains marked on the table among the signaller's, one chosen there, and an order that the
// signaller's train on the table keeps; what the senior dispatcher says when something does not go
// to plan; the verdict with the decisions on the sheet.
import { expect, test } from "@playwright/test";

import { inPicture } from "./picture.js";

const MISSION = "/game/play/?mission=whose-minutes", SEAT = "#seat-train-dispatcher";

/** Open the mission with nothing stored and no sound, start it and pause it. `live`: on the table. */
async function start(page, { live = false } = {}) {
  const errors = [], url = live ? `${MISSION}&live` : MISSION;
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("arail.game.sound", "false");
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__play?.ready);
  if (live) {
    await page.evaluate(async () => {
      (await import("/game/live.js")).LIVE.slow_ms = 1e9;
    });
  }
  await page.locator("#start").click();
  await page.waitForFunction(() => window.__play.session);
  await page.getByRole("button", { name: "Pause" }).click();
  return errors;
}

/** The dispatcher's game, as plain data. */
const game = (page) => page.evaluate(() => {
  const p = window.__play, g = p.session.seat("train-dispatcher").game;
  return {
    t: g.t, open: g.open.map((d) => d.id), goodwill: ["regio", "fern", "cargo"].map((ru) => g.goodwill(ru)),
    orders: Object.fromEntries(g.trains.filter((tr) => tr.order).map((tr) => [tr.id, [tr.order.for, tr.order.minutes]])), plans: Object.fromEntries(g.trains.map((tr) => [tr.id, tr.plan])),
    promises: g.promises.map((x) => x.train), diary: p.diary.map((x) => [x.title, x.chose]),
  };
});

/** Answer what the senior dispatcher says, as long as he speaks. */
const heard = (page) => page.evaluate(() => {
  for (const story of document.querySelectorAll(".vn-story")) for (let i = 0; i < 50 && !story.hidden; i++) story.querySelector(".btn.primary")?.click();
  window.__play.draw(true);
});

/** Let the shift run until something is asked (or `until` s of it have passed); what is said on the way is answered. */
async function runTo(page, until) {
  for (let k = 0; k < 400; k++) {
    const done = await page.evaluate((to) => {
      const p = window.__play, g = p.session.seat("train-dispatcher").game;
      for (let i = 0; i < 20 && g.t < to && !g.open.length && !p.session.over && !p.listening(); i++) p.session.step(0.5);
      p.draw(true);
      return g.t >= to || g.open.length > 0 || p.session.over;
    }, until);
    await heard(page);
    if (done) break;
  }
}

/**
 * Let the shift run to `t` s of it, whatever is asked on the way: what `answers` name is decided so (a decision's
 * id → an option or a number), the rest stays open until its time is up; what is said on the way is answered.
 */
async function advance(page, t, answers = {}) {
  await page.evaluate(([to, ans]) => {
    const p = window.__play, s = p.session, g = s.seat("train-dispatcher").game;
    const decide = () => {
      for (const d of [...g.open]) if (d.id in ans) s.act("train-dispatcher", "decide", d.id, ans[d.id]);
    };
    while (g.t < to && !s.over) {
      decide();
      s.step(0.5);
    }
    decide();
    p.draw(true);
  }, [t, answers]);
  await heard(page);
}

test("the mission's stop on the line: the dispatcher's seat for a person, the signaller's for the computer, its place and its facts", async ({ page }) => {
  await page.goto(MISSION);
  await page.evaluate(() => localStorage.clear());
  await page.goto(MISSION);
  await page.waitForFunction(() => window.__play?.ready);
  await expect(page.locator("#setup h2, #setup h1").first()).toHaveText("Whose minutes?");
  await expect(page.locator("#setup")).toContainText("Three undertakings, nine trains, forecasts that may be off.");
  await expect(page.locator("#by-train-dispatcher")).toBeChecked();
  await expect(page.locator("#by-signaller-relay")).not.toBeChecked();
  await expect(page.locator("#setup")).toContainText("2 roles");
  await expect(page.locator("#setup")).toContainText("40 min on the clock");
  expect(await page.evaluate(() => window.__play.problems ?? [])).toEqual([]);
});

test("a decision that is a number: the slider with its ends and where it stands, the arrow keys, Enter; the order goes to the signaller and onto the sheet", async ({ page }) => {
  const errors = await start(page);
  await heard(page);
  await runTo(page, 400);
  const asked = page.locator(`${SEAT} .play-decision:not(.waiting)`), slider = asked.locator(".play-scale input[type=range]");
  await expect(asked.locator("h5")).toHaveText("IC 2045 comes about 5 min late; GZ 47 is on time. How long shall GZ 47 wait to let it go first?");
  // the dilemma is in the first sentence; the rest is behind More
  await expect(asked.locator(".text")).toContainText("If GZ 47 goes first, IC 2045 may crawl behind it to Talsee; if it waits, it blocks G3 for RB 34.");
  await expect(asked.locator(".text")).not.toContainText("The rule of the line");
  await asked.locator(".play-why").click();
  await expect(asked.locator(".text")).toContainText("a train on time goes before a late one; it may be asked to wait up to 3 min");
  // the scale: named, between its ends, in its steps, where it stands said beside it and to a screen reader
  await expect(asked.locator(".play-scale label")).toHaveText("GZ 47 waits at most");
  await expect(slider).toHaveAttribute("min", "0");
  await expect(slider).toHaveAttribute("max", "8");
  await expect(slider).toHaveAttribute("step", "0.5");
  await expect(slider).toHaveValue("0");
  await expect(asked.locator(".play-scale output")).toHaveText("0 min");
  await expect(asked.locator(".play-scale-end")).toHaveText(["0 min", "8 min"]);
  expect(await slider.evaluate((el) => document.querySelector(`label[for="${el.id}"]`)?.textContent)).toBe("GZ 47 waits at most");
  // the option beside it has the key 1; the time left and what happens then are written
  await expect(asked.locator(".play-options-row .btn")).toHaveText(["1IC 2045 first, however late it comes"]);
  await expect(asked.locator(".hint")).toContainText("s left, then: IC 2045 first, however late it comes");
  // the arrow keys move it by its step; it stays where it stands while the page draws on
  await slider.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await expect(asked.locator(".play-scale output")).toHaveText("2.5 min");
  await expect(slider).toHaveAttribute("aria-valuetext", "2.5 min");
  await page.evaluate(() => window.__play.draw(true));
  await expect(slider).toHaveValue("2.5");
  await page.keyboard.press("ArrowLeft");
  await expect(asked.locator(".play-scale output")).toHaveText("2 min");
  // (a digit in the slider is not the option's key)
  await page.keyboard.press("1");
  expect((await game(page)).open).toEqual(["first-GZ 47"]);
  // Enter takes it: the order is the signaller's to keep, and the decision is on the sheet with its number
  await page.keyboard.press("Enter");
  const g = await game(page);
  expect(g.open).toEqual([]);
  expect(g.orders).toEqual({ "GZ 47": ["IC 2045", 2] });
  expect(g.diary).toEqual([["IC 2045 comes about 5 min late; GZ 47 is on time. How long shall GZ 47 wait to let it go first?", "GZ 47 waits at most 2 min"]]);
  expect(await page.evaluate(() => {
    const s = window.__play.session;
    s.step(1);
    return [...s.seat("signaller-relay").game.holds].map(([id, h]) => [id, h.for, h.until]);
  })).toEqual([["GZ 47", "IC 2045", 580 + 120]]);
  expect(errors).toEqual([]);
});

test("the button takes the number; the option beside the scale is taken with its key; a number nobody takes falls back", async ({ page }) => {
  const errors = await start(page);
  await heard(page);
  await runTo(page, 400);
  const asked = page.locator(`${SEAT} .play-decision:not(.waiting)`);
  // the option: IC 2045 first, however late it comes (the key 1, outside the slider)
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("1");
  let g = await game(page);
  expect(g.orders["GZ 47"][0]).toBe("IC 2045");
  expect(g.orders["GZ 47"][1]).toBeGreaterThan(8);
  expect(g.diary.at(-1)[1]).toBe("IC 2045 first, however late it comes");
  await advance(page, 530);
  expect((await game(page)).open).toEqual(["hours"]);
  // the freight undertaking's wish: one of three, no scale
  await expect(asked.locator("h5")).toContainText("B. Habicht, the freight undertaking's dispatcher, is on the phone: “The driver of GZ 49 is near the end of the driving time.");
  await expect(page.locator(`${SEAT} .vn-name strong`)).toHaveText("B. Habicht");
  await expect(asked.locator(".play-scale")).toHaveCount(0);
  await expect(asked.locator(".play-options-row .btn span")).toHaveText(["Promise GZ 49 a clear run", "Promise to try, and no more", "Refuse: GZ 49 runs as the morning allows"]);
  await asked.locator(".play-options-row .btn").nth(0).click();
  expect((await game(page)).promises).toEqual(["GZ 49"]);
  // the wait for RB 33's passengers: asked by the regional undertaking's dispatcher; set with the pointer, taken with the button
  // (GZ 47 stands on G3 when RB 34 is due there: that may be asked too)
  await advance(page, 610);
  expect((await game(page)).open).toEqual(expect.arrayContaining(["wait-RB 34", "track-GZ 49"]));
  await page.evaluate(() => window.__play.look("train-dispatcher", "wait-RB 34"));
  await expect(asked.locator("h5")).toHaveText("RB 33 comes about 4 min late. How long shall RB 34 wait for its passengers?");
  await expect(page.locator(`${SEAT} .vn-name strong`)).toHaveText("L. Meise");
  await expect(asked.locator(".play-scale output")).toHaveText("3 min");
  await asked.locator(".play-scale input").evaluate((el) => {
    el.value = "4.5";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(asked.locator(".play-scale output")).toHaveText("4.5 min");
  await asked.locator(".play-scale .btn").click();
  g = await game(page);
  expect(g.orders["RB 34"]).toEqual(["RB 33", 4.5]);
  expect(g.diary.at(-1)).toEqual(["RB 33 comes about 4 min late. How long shall RB 34 wait for its passengers?", "RB 34 waits at most 4.5 min"]);
  // which of the two on G2 goes elsewhere: nobody answers, and it stays as planned
  await page.evaluate(() => window.__play.look("train-dispatcher", "track-GZ 49"));
  await expect(asked.locator("h5")).toHaveText("GZ 49 is due on G2 at 08:20, and RB 33 will still be there. Which of them goes elsewhere?");
  await expect(asked.locator(".play-options-row .btn span")).toContainText(["As planned: GZ 49 waits for G2", "RB 33 to G1"]);
  await advance(page, 710);
  g = await game(page);
  expect(g.open).not.toContain("track-GZ 49");
  expect(g.plans["RB 33"]).toBe("G2");
  expect(await page.evaluate(() => window.__play.session.seat("train-dispatcher").game.decisions.find((d) => d.id === "track-GZ 49").auto)).toBe(true);
  expect(errors).toEqual([]);
});

test("the picture of the tracks: a train a question is about pulses; a train chosen offers its orders, and an order given there is kept", async ({ page }) => {
  const errors = await start(page);
  await advance(page, 610, { "first-GZ 47": 0, hours: "effort" });
  expect((await game(page)).open).toEqual(["wait-RB 34", "track-GZ 49"]);
  const board = page.locator(`${SEAT} .play-board`), pick = page.locator(`${SEAT} .play-pick`), tag = (id) => board.locator(`.pick[data-id="train-${id}"]`);
  await expect(page.locator(`${SEAT} .play-sketch h4`)).toHaveText("The tracks");
  await expect(board).toHaveAttribute("aria-label", /^The platform tracks G3, G2 and G1 of Bf Neustadt from 08:00 to 08:40/);
  // the trains the questions are about pulse: RB 34 and its feeder, GZ 49 and the train in its way
  for (const id of ["RB 33", "RB 34", "GZ 49"]) await expect(tag(id)).toHaveClass(/alert/);
  await expect(tag("RB 35")).not.toHaveClass(/alert/);
  // a train chosen says what is known of it, and offers its orders
  await tag("RB 34").click({ force: true });
  await expect(tag("RB 34")).toHaveAttribute("aria-pressed", "true");
  await expect(pick.locator(".play-picked")).toHaveText("RB 34: Regional, G3, departs 08:15");
  await expect(pick.locator("button")).toHaveText(["Wait for RB 33: 1 min at most", "To G2 instead of G3"]);
  // an order given in the picture answers the question about the same train; a minute more is offered next
  await pick.getByRole("button", { name: "Wait for RB 33: 1 min at most" }).click();
  let g = await game(page);
  expect(g.orders["RB 34"]).toEqual(["RB 33", 1]);
  expect(g.open).not.toContain("wait-RB 34");
  await tag("RB 34").click({ force: true });
  await expect(pick.locator(".play-picked")).toHaveText("RB 34: Regional, G3, departs 08:15; waits for RB 33 until 08:16");
  // (G2 is no longer offered: while RB 34 waits, RB 33 is expected there)
  await expect(pick.locator("button")).toHaveText(["Wait for RB 33: 2 min at most", "Do not wait for RB 33"]);
  // RB 33 to the through track: its tag moves to the row of G1, and the signaller's train has its plan
  await tag("RB 33").click({ force: true });
  const before = await tag("RB 33").locator("rect.hit").evaluate((r) => r.getBBox().y);
  await pick.getByRole("button", { name: "To G1 instead of G2" }).click();
  g = await game(page);
  expect(g.plans["RB 33"]).toBe("G1");
  expect(await tag("RB 33").locator("rect.hit").evaluate((r) => r.getBBox().y)).toBeGreaterThan(before + 30);
  expect(await page.evaluate(() => {
    const s = window.__play.session;
    s.step(1);
    return s.seat("signaller-relay").game.trains.find((tr) => tr.id === "RB 33").plan;
  })).toBe("G1");
  // the regional undertaking's goodwill pays for the other platform
  expect((await game(page)).goodwill[0]).toBeLessThan(100);
  // the orders are also a form of the desk
  await page.keyboard.press("d");
  const desk = page.locator(`${SEAT} dialog[open]`);
  await expect(desk.locator(".play-move legend")).toHaveText(["Order a train to wait", "Send a train to another track"]);
  expect(errors).toEqual([]);
});

test("the dispatcher's shift on the table: every train is marked among the signaller's, one is chosen there, and what is ordered happens on the table", async ({ page }) => {
  const errors = await start(page, { live: true });
  await page.waitForFunction(() => window.__play.tabled && window.__play.live?.view && window.__play.live.board?.constructor.type === "dispatch-board");
  expect(await page.evaluate(() => [...window.__play.live.boards.keys()].sort())).toEqual(["dispatcher", "signaller"]);
  expect(await inPicture(page)).toEqual([]);
  await heard(page);
  await runTo(page, 400);
  // the question is about the freight train and the intercity: both are asked about on the board
  expect(await page.evaluate(() => [...window.__play.live.board.asked()].sort())).toEqual(["GZ 47", "IC 2045"]);
  // GZ 47 waits two minutes: it stands on G3 beyond its time, on the table
  await page.locator(`${SEAT} .play-scale input`).evaluate((el) => {
    el.value = "2";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator(`${SEAT} .play-scale .btn`).click();
  const gz = (t) => page.evaluate((to) => {
    const p = window.__play, s = p.session;
    while (s.t < to && !s.over) {
      s.step(0.5);
      for (const story of document.querySelectorAll(".vn-story")) if (!story.hidden) story.querySelector(".btn.primary")?.click();
      for (const d of s.seat("train-dispatcher").game.open) if (d.id !== "first-GZ 47") s.act("train-dispatcher", "decide", d.id, d.fallback);
    }
    p.draw(true);
    const tr = s.seat("signaller-relay").game.trains.find((x) => x.id === "GZ 47");
    return { state: tr.state, v: tr.v, track: tr.path.map((sec) => sec).includes("g3"), passed: tr.passed };
  }, t);
  const standing = await gz(640);
  expect([standing.v, standing.track, standing.passed]).toEqual([0, true, null]);
  // the train is chosen on the table: its ring is where the signaller's train stands
  await page.waitForFunction(() => window.__play.live.board.where("GZ 47"));
  const at = await page.evaluate(() => {
    const live = window.__play.live, p = live.board.placeOf("train-GZ 47"), q = live.view.project(p[0], p[1], 0), r = live.canvas.getBoundingClientRect();
    const { width, height } = live.canvas, k = Math.max(r.width / width, r.height / height);
    return [r.left + (r.width - width * k) * 0.5 + q[0] * k, r.top + (r.height - height * k) * 0.8 + q[1] * k];
  });
  await page.mouse.click(...at);
  await expect(page.locator(`${SEAT} .play-board .pick[data-id="train-GZ 47"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`${SEAT} .play-picked`)).toContainText("GZ 47: Freight, G3, passes 08:09:40; waits for IC 2045 until 08:11:40");
  // its order is changed there: it goes at once, and the signaller's train on the table moves
  await page.locator(`${SEAT} .play-pick`).getByRole("button", { name: "Go at its time, before IC 2045" }).click();
  const gone = await gz(700);
  expect(gone.passed).not.toBeNull();
  expect(gone.passed).toBeLessThan(700);
  expect(await inPicture(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("a morning played through: what does not go to plan is said, an undertaking phones, and the verdict has the stars and the decisions", async ({ page }) => {
  const errors = await start(page);
  // the intercity first whatever it costs, nobody waits for passengers, no promises: the freight and the regional undertaking pay
  const said = [];
  for (let k = 0; k < 600; k++) {
    const state = await page.evaluate(() => {
      const p = window.__play, g = p.session.seat("train-dispatcher").game;
      for (let i = 0; i < 40 && !g.open.length && !p.session.over && !p.listening(); i++) p.session.step(0.5);
      p.draw(true);
      const line = [...document.querySelectorAll("#seat-train-dispatcher .vn-story")].find((el) => !el.hidden)?.querySelector(".vn-line")?.textContent ?? null;
      return { over: p.session.over, open: g.open.map((d) => d.id), line };
    });
    if (state.over) break;
    if (state.line) said.push(state.line);
    await heard(page);
    const asked = page.locator(`${SEAT} .play-decision:not(.waiting)`);
    for (const id of state.open) {
      await page.evaluate((x) => window.__play.look("train-dispatcher", x), id);
      if (id.startsWith("first-")) await asked.locator(".play-options-row .btn").first().click();
      else if (id.startsWith("wait-")) {
        // (the slider at nought: the train does not wait)
        await asked.locator(".play-scale input").evaluate((el) => {
          el.value = "0";
          el.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await asked.locator(".play-scale .btn").click();
      } else if (id.startsWith("call-")) {
        await expect(asked.locator("h5")).toContainText("is on the phone: “");
        await asked.locator(".play-options-row .btn", { hasText: "Say sorry" }).click();
      } else await asked.locator(".play-options-row .btn").last().click();
    }
  }
  // the senior dispatcher spoke first, and of what did not go to plan
  expect(said[0]).toContain("Today the desk above the signal box is yours");
  const g = await page.evaluate(() => {
    const d = window.__play.session.seat("train-dispatcher").game;
    return { kinds: [...new Set(d.irregulars.map((x) => x.kind))], called: [...d.called], goodwill: ["regio", "fern", "cargo"].map((ru) => d.goodwill(ru)), added: d.account().by };
  });
  expect(g.called.length).toBeGreaterThanOrEqual(1);
  expect(g.added.cargo).toBeGreaterThan(g.added.fern);
  expect(Math.min(...g.goodwill)).toBeLessThan(62);
  // the verdict: the dispatcher's score, the decisions on the sheet with the numbers that were chosen
  await expect(page.locator("#result")).toBeVisible();
  await expect(page.locator("#result h2, #result h1").first()).toContainText("Whose minutes?");
  const diary = await page.evaluate(() => window.__play.diary.map((x) => x.chose));
  expect(diary).toContain("IC 2045 first, however late it comes");
  expect(diary.some((x) => /^RB 3[46] waits at most 0 min$/.test(x))).toBe(true);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("arail.game.progress")));
  expect(kept.missions["whose-minutes"].plays).toBe(1);
  expect(kept.roles).toContain("train-dispatcher");
  expect(kept.sheets["whose-minutes"].decisions.some((d) => /waits at most 0 min/.test(d.chose))).toBe(true);
  expect(errors).toEqual([]);
});
