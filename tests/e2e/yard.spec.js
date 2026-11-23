// End-to-end tests of the mission The last wagon (game/play/?mission=last-wagon): the yard master's
// shift at the hump yard, on the table. Its stop on the line of missions; which train goes over the
// hump next (one of a few, each with what it carries) and how fast it is pushed (a number, without
// a time to answer by); the picture of the yard with the hump chosen and the speed changed while a
// train is pushed, a track chosen and its train's wait said; the table: the layout's module Hump
// yard with the game's own run on it, the crest chosen there, the parts of the picture by their
// names here; a shift played through with what is said when something does not go to plan, and
// the verdict.
import { expect, test } from "@playwright/test";

import { inPicture } from "./picture.js";

const MISSION = "/game/play/?mission=last-wagon", SEAT = "#seat-yard-master";

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

/** The yard master's game, as plain data. */
const game = (page) => page.evaluate(() => {
  const p = window.__play, g = p.session.seat("yard-master").game;
  return {
    t: g.t, open: g.open.map((d) => d.id), v: g.v, loco: g.loco.state, on: g.loco.train, next: g.nextUp, jobs: g.jobs.map((j) => `${j.kind}:${j.track ?? j.cut}`),
    holds: Object.fromEntries(g.outbound.map((o) => [o.id, o.hold_min])), asked: Object.fromEntries(g.outbound.map((o) => [o.id, o.asked])),
    diary: p.diary.map((x) => [x.title, x.chose]),
  };
});

/** Answer what is said to the yard master, as long as somebody speaks. */
const heard = (page) => page.evaluate(() => {
  for (const story of document.querySelectorAll(".vn-story")) for (let i = 0; i < 50 && !story.hidden; i++) story.querySelector(".btn.primary")?.click();
  window.__play.draw(true);
});

/** Let the shift run until something is asked (or `until` s of it have passed); what is said on the way is answered. */
async function runTo(page, until) {
  for (let k = 0; k < 400; k++) {
    const done = await page.evaluate((to) => {
      const p = window.__play, g = p.session.seat("yard-master").game;
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
 * id, or the first part of it → an option or a number), the rest as the computer's yard master would; what is said
 * on the way is answered.
 */
async function advance(page, t, answers = {}) {
  await page.evaluate(([to, ans]) => {
    const p = window.__play, s = p.session, g = s.seat("yard-master").game;
    const decide = () => {
      for (const d of [...g.open]) s.act("yard-master", "decide", d.id, ans[d.id] ?? ans[d.id.split("-")[0]] ?? g.advice(d.id));
    };
    while (g.t < to && !s.over) {
      decide();
      s.step(0.5);
    }
    p.draw(true);
  }, [t, answers]);
  await heard(page);
}

test("the mission's stop on the line: the yard master's seat for a person, its place at the hump yard and its facts", async ({ page }) => {
  await page.goto(MISSION);
  await page.evaluate(() => localStorage.clear());
  await page.goto(MISSION);
  await page.waitForFunction(() => window.__play?.ready);
  await expect(page.locator("#setup h2, #setup h1").first()).toHaveText("The last wagon");
  await expect(page.locator("#setup")).toContainText("Frost on the hump, four trains to break up, one locomotive.");
  await expect(page.locator("#by-yard-master")).toBeChecked();
  await expect(page.locator("#setup")).toContainText("1 role");
  await expect(page.locator("#setup")).toContainText("35 min on the clock");
  expect(await page.evaluate(() => window.__play.problems ?? [])).toEqual([]);
});

test("which train next, and how fast: one of three with what each carries, then a number on a scale without a time to answer by", async ({ page }) => {
  const errors = await start(page);
  await heard(page);
  await runTo(page, 60);
  const asked = page.locator(`${SEAT} .play-decision:not(.waiting)`), slider = asked.locator(".play-scale input[type=range]");
  // the hump operator asks: the three trains in the order they came, each with the wagons booked on the outbound trains
  await expect(page.locator(`${SEAT} .vn-name strong`)).toHaveText("S. Pirol");
  await expect(asked.locator("h5")).toHaveText("56012, 56034 and 56058 wait in the arrival tracks. Which goes over the hump next?");
  await expect(asked.locator(".text")).toContainText("56012 came in first; 56034 has more wagons for the 06:10 to the port.");
  await expect(asked.locator(".play-options-row .btn")).toHaveCount(3);
  await expect(asked.locator(".play-options-row .btn").nth(0)).toContainText("56012 from the port");
  await expect(asked.locator(".play-options-row .btn").nth(0)).toContainText("first in; 06:10: 2 (priority), 06:14: 3");
  await expect(asked.locator(".play-options-row .btn").nth(1)).toContainText("06:10: 3 (1 not to be humped)");
  // no time to answer by: the hump waits for the word
  await expect(asked).not.toContainText("s left, then");
  await asked.locator(".play-options-row .btn").nth(0).click();
  expect((await game(page)).next).toBe("56012");
  // how fast: the scale between its ends, in tenths, at the instructions' speed
  await runTo(page, 60);
  await expect(asked.locator("h5")).toHaveText("56012 is ready for the hump. How fast shall it be pushed?");
  // the dilemma is in the first sentence; the train's list is behind More
  await expect(asked.locator(".text")).toContainText("Faster, its wagons are in sooner; above 1.4 m/s a switch may not get between two cuts, and wagons meet too hard.");
  await expect(asked.locator(".text")).not.toContainText("bad runners");
  await asked.locator(".play-why").click();
  await expect(asked.locator(".text")).toContainText(/56012: 10 wagons, \d of them bad runners/);
  await expect(asked.locator(".play-scale label")).toHaveText("56012 is pushed at");
  await expect(slider).toHaveAttribute("min", "0.8");
  await expect(slider).toHaveAttribute("max", "2");
  await expect(slider).toHaveAttribute("step", "0.1");
  await expect(slider).toHaveValue("1.2");
  await expect(asked.locator(".play-scale output")).toHaveText("1.2 m/s");
  await expect(asked.locator(".play-scale-end")).toHaveText(["0.8 m/s", "2 m/s"]);
  // two steps up with the keys, Enter: the train starts over the hump at 1.4 m/s, and the sheet has the number
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(asked.locator(".play-scale output")).toHaveText("1.4 m/s");
  await page.keyboard.press("Enter");
  await page.evaluate(() => window.__play.session.step(1));
  const g = await game(page);
  expect([g.open, g.loco, g.on, g.v]).toEqual([[], "push", "56012", 1.4]);
  expect(g.diary).toEqual([
    ["56012, 56034 and 56058 wait in the arrival tracks. Which goes over the hump next?", "56012 from the port"],
    ["56012 is ready for the hump. How fast shall it be pushed?", "56012 is pushed at 1.4 m/s"],
  ]);
  expect(errors).toEqual([]);
});

test("the picture of the yard: the hump chosen changes the speed while a train is pushed; a track chosen says how long its train waits", async ({ page }) => {
  const errors = await start(page);
  await advance(page, 70, { next: "56012", push: 1.2 });
  const board = page.locator(`${SEAT} .play-board`), pick = page.locator(`${SEAT} .play-pick`), tag = (id) => board.locator(`.pick[data-id="${id}"]`);
  await expect(page.locator(`${SEAT} .play-sketch h4`)).toHaveText("The yard");
  await expect(board).toHaveAttribute("aria-label", /^The hump yard Neustadt West: on the left the trains in the arrival tracks and the train on the hump/);
  // the trains waiting, the hump and the six tracks can be chosen; every wagon of the train on the hump is drawn
  for (const id of ["train-56034", "train-56058", "hump", "track-1", "track-6"]) await expect(tag(id)).toHaveCount(1);
  // (the late train is shown with the time it is announced for; it cannot be chosen before it is in)
  await expect(tag("train-56071")).toHaveCount(0);
  await expect(board).toContainText("56071");
  expect(await board.locator("rect:not(.hit)").count()).toBeGreaterThanOrEqual(30);
  // the hump: what the locomotive does, and the speed as moves
  await tag("hump").click({ force: true });
  await expect(tag("hump")).toHaveAttribute("aria-pressed", "true");
  await expect(pick.locator(".play-picked")).toHaveText("The hump: the locomotive pushes 56012 at 1.2 m/s");
  await expect(pick.locator("button")).toHaveText(["Faster: 1.4 m/s", "Slower: 1.0 m/s", "Stop the train"]);
  await pick.getByRole("button", { name: "Faster: 1.4 m/s" }).click();
  expect((await game(page)).v).toBe(1.4);
  expect(await page.evaluate(() => window.__play.session.seat("yard-master").game.sim.pushing.v)).toBe(1.4);
  // stopped, the train stands on the hump; pushed on, it goes at the speed it had
  await tag("hump").click({ force: true });
  await pick.getByRole("button", { name: "Stop the train" }).click();
  expect((await game(page)).v).toBe(0);
  await tag("hump").click({ force: true });
  await expect(pick.locator(".play-picked")).toHaveText("The hump: the locomotive 56012 stands on the hump");
  await expect(pick.locator("button")).toHaveText(["Push on at 1.4 m/s"]);
  await pick.getByRole("button", { name: "Push on at 1.4 m/s" }).click();
  expect((await game(page)).v).toBe(1.4);
  // a track: its outbound train, its wagons, and a wait said before it is asked for
  await tag("track-1").click({ force: true });
  await expect(pick.locator(".play-picked")).toContainText(/^Track 1: the 06:10 to the port; \d wagons?, \d+ m free at its entrance/);
  await pick.getByRole("button", { name: "Wait for its wagons: 1 min at most" }).click();
  let g = await game(page);
  expect([g.holds["51204"], g.asked["51204"]]).toEqual([1, true]);
  // a train in the arrival tracks: chosen for the hump next, the question about it is not asked
  await tag("train-56058").click({ force: true });
  await expect(pick.locator(".play-picked")).toContainText("56058 from Talsee: 10 wagons");
  await pick.getByRole("button", { name: "Over the hump next" }).click();
  await advance(page, 200, { push: 1.2 });
  g = await game(page);
  expect(g.diary.map((x) => x[0])).not.toContain("56034 and 56058 wait in the arrival tracks. Which goes over the hump next?");
  expect(await page.evaluate(() => window.__play.session.seat("yard-master").game.inbound.filter((x) => x.state === "hump" || x.push != null).map((x) => x.id))).toContain("56058");
  // the moves are also a form of the desk
  await page.keyboard.press("d");
  const desk = page.locator(`${SEAT} dialog[open]`);
  await expect(desk.locator(".play-move legend")).toHaveText(["Set the pushing speed", "Hold an outbound train", "Close up a track"]);
  expect(errors).toEqual([]);
});

test("the shift on the table: the layout's hump yard draws the game's run, the crest is chosen there, the parts of the picture are the yard's", async ({ page }) => {
  const errors = await start(page, { live: true });
  await page.waitForFunction(() => window.__play.tabled && window.__play.live?.view && window.__play.live.board?.constructor.type === "yard-board");
  // the module Hump yard is on, and its object shows the game's own simulation
  const on = await page.evaluate(() => {
    const live = window.__play.live, g = window.__play.session.seat("yard-master").game;
    return { boards: [...live.boards.keys()], layers: live.world.layers().filter((l) => l.enabled).map((l) => l.id), shown: live.board.yard.external === g.sim, own: live.board.yard.sim === g.sim };
  });
  expect(on).toEqual({ boards: ["yard"], layers: ["hump"], shown: true, own: true });
  expect(await inPicture(page)).toEqual([]);
  // the parts of the picture have the yard's names
  await page.locator("#tableBtn").click();
  await expect(page.locator("#tableParts [data-part]")).toHaveText(["The tracks", "Switches and retarders", "The hump", "Whole yard"]);
  await page.locator("#tableBtn").click();
  await advance(page, 100, { next: "56012", push: 1.2 });
  // the train on the hump and the cuts that roll are the object's to draw: its wagons are the game's
  const drawn = await page.evaluate(() => {
    const live = window.__play.live, g = window.__play.session.seat("yard-master").game;
    return { boxes: live.board.yard.boxes().length, wagons: g.sim.bodies.reduce((n, b) => n + b.wagons.length, 0) + g.sim.pushing.cuts.reduce((n, c) => n + c.wagons.length, 0), marks: live.board.marks().map((m) => m.item) };
  });
  expect(drawn.boxes).toBeGreaterThan(0);
  expect(drawn.boxes).toBeLessThanOrEqual(drawn.wagons);
  expect(drawn.marks).toEqual(["hump", "track-1", "track-2", "track-3", "track-4", "track-5", "track-6"]);
  // the crest is chosen on the table: the hump is chosen in the picture, with its moves
  await page.evaluate(() => window.__play.live.show("east", true));
  await page.waitForTimeout(400);
  const at = await page.evaluate(() => {
    const live = window.__play.live, p = live.board.placeOf("hump"), q = live.view.project(p[0], p[1], p[2]), r = live.canvas.getBoundingClientRect();
    const { width, height } = live.canvas, k = Math.max(r.width / width, r.height / height);
    return [r.left + (r.width - width * k) * 0.5 + q[0] * k, r.top + (r.height - height * k) * 0.8 + q[1] * k];
  });
  await page.mouse.click(...at);
  await expect(page.locator(`${SEAT} .play-board .pick[data-id="hump"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`${SEAT} .play-picked`)).toHaveText("The hump: the locomotive pushes 56012 at 1.2 m/s");
  await page.locator(`${SEAT} .play-pick`).getByRole("button", { name: "Slower: 1.0 m/s" }).click();
  expect((await game(page)).v).toBe(1);
  // what a question is about pulses on the table too: the track of the train that is due
  await advance(page, 500, { round: "free" });
  await runTo(page, 600);
  expect((await game(page)).open).toContain("hold-51204");
  expect(await page.evaluate(() => [...window.__play.live.board.asked()])).toContain("track-1");
  expect(await inPicture(page)).toEqual([]);
  // left, the layout has its own modules again and the hump yard its own run
  await page.locator("#leave").click();
  await page.waitForFunction(() => !window.__play.tabled);
  expect(await page.evaluate(() => {
    const live = window.__play.live;
    return [live.world.layers().filter((l) => l.enabled).map((l) => l.id).includes("hump"), live.world.objects.some((o) => o.type === "hump-yard" && o.external)];
  })).toEqual([false, false]);
  expect(errors).toEqual([]);
});

test("a shift played through: every train out on the minute; what does not go to plan is said, the customer service agent phones, and the verdict has the decisions", async ({ page }) => {
  const errors = await start(page);
  const said = [], asked = page.locator(`${SEAT} .play-decision:not(.waiting)`);
  for (let k = 0; k < 900; k++) {
    const state = await page.evaluate(() => {
      const p = window.__play, g = p.session.seat("yard-master").game;
      for (let i = 0; i < 40 && !g.open.length && !p.session.over && !p.listening(); i++) p.session.step(0.5);
      p.draw(true);
      const line = [...document.querySelectorAll("#seat-yard-master .vn-story")].find((el) => !el.hidden)?.querySelector(".vn-line")?.textContent ?? null;
      return { over: p.session.over, open: g.open.map((d) => d.id), line };
    });
    if (state.over) break;
    if (state.line) said.push(state.line);
    await heard(page);
    for (const id of state.open) {
      await page.evaluate((x) => window.__play.look("yard-master", x), id);
      if (id === "next") await asked.locator(".play-options-row .btn").first().click();
      else if (id.startsWith("push-") || id.startsWith("hold-")) {
        // (the instructions' speed where it stands; a wait of nought: the train goes at its cut-off)
        if (id.startsWith("hold-")) {
          await asked.locator(".play-scale input").evaluate((el) => {
            el.value = "0";
            el.dispatchEvent(new Event("input", { bubbles: true }));
          });
        }
        await asked.locator(".play-scale .btn").click();
      } else if (id.startsWith("round-")) {
        await expect(asked.locator("h5")).toContainText("must not be humped (label 15). When does the locomotive take it round to track 1?");
        await expect(asked.locator(".play-options-row .btn span")).toContainText(["Now, before the next train", "When no train waits for the hump"]);
        await asked.locator(".play-options-row .btn").nth(1).click();
      } else if (id.startsWith("call-")) {
        await expect(asked.locator("h5")).toContainText("is on the phone: “");
        await asked.locator(".play-options-row .btn").last().click();
      } else await asked.locator(".play-options-row .btn").last().click();
    }
  }
  // the night's yard master spoke first, and of the wagons that stayed behind
  expect(said[0]).toContain("Six in the morning, minus eight.");
  expect(said.some((x) => / missed the 06:\d\d to /.test(x))).toBe(true);
  const g = await page.evaluate(() => {
    const y = window.__play.session.seat("yard-master").game, a = y.account();
    return { kinds: [...new Set(y.irregulars.map((x) => x.kind))], a, called: [...y.called] };
  });
  expect(g.kinds).toContain("missed");
  expect([g.a.humped, g.a.gone, g.a.on_time, g.a.late_min, g.a.lost]).toEqual([4, 4, 4, 0, 0]);
  expect(g.a.missed).toBeGreaterThan(0);
  expect(g.a.moods.customers).toBeLessThan(100);
  expect(g.a.moods.production).toBe(100);
  // the verdict: the yard master's score, the decisions on the sheet with the numbers that were chosen
  await expect(page.locator("#result")).toBeVisible();
  await expect(page.locator("#result h2, #result h1").first()).toContainText("The last wagon");
  const diary = await page.evaluate(() => window.__play.diary.map((x) => x.chose));
  expect(diary).toContain("56012 from the port");
  expect(diary).toContain("56012 is pushed at 1.2 m/s");
  expect(diary.some((x) => /^The 06:\d\d waits at most 0 min$/.test(x))).toBe(true);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("arail.game.progress")));
  expect(kept.missions["last-wagon"].plays).toBe(1);
  expect(kept.roles).toContain("yard-master");
  expect(errors).toEqual([]);
});
