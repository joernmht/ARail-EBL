// End-to-end tests of the mission Short notice (game/play/?mission=short-notice): the maintenance
// district manager's week, on the table. Its stop on the line of missions; Monday morning: who
// speaks first, the week's clock at the shift's pace, the chart of the week with a person chosen
// and put on a work, the works council asked and the possession's length as a number with the
// welder's look beside it; the table: the week on the lab's layout, a van and then a site, a pin
// and then what is told there; a week played through with what is said when something does not go
// to plan, and the verdict.
import { expect, test } from "@playwright/test";

import { inPicture } from "./picture.js";

const MISSION = "/game/play/?mission=short-notice", ROLE = "maintenance-district-manager", SEAT = `#seat-${ROLE}`;

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

/** The district manager's game, as plain data. */
const game = (page) => page.evaluate((role) => {
  const p = window.__play, g = p.session.seat(role).game;
  return {
    t: g.t, hour: g.now, open: g.open.map((d) => d.id), crews: Object.fromEntries(g.works.map((w) => [w.id, [...w.crew]])), told: Object.fromEntries(g.works.map((w) => [w.id, Object.keys(w.told).sort()])),
    rota: g.rota.map((x) => [x.person, x.work, !!x.council, x.told != null]), len: g.work("rail").len, look: g.work("rail").look_at != null, diary: p.diary.map((x) => [x.title, x.chose]),
  };
}, ROLE);

/** Answer what is said to the district manager, as long as somebody speaks. */
const heard = (page) => page.evaluate(() => {
  for (const story of document.querySelectorAll(".vn-story")) for (let i = 0; i < 50 && !story.hidden; i++) story.querySelector(".btn.primary")?.click();
  window.__play.draw(true);
});

/** Let the week run until something is asked (or `until` s of the shift have passed); what is said on the way is answered. */
async function runTo(page, until) {
  for (let k = 0; k < 400; k++) {
    const done = await page.evaluate(([to, role]) => {
      const p = window.__play, g = p.session.seat(role).game;
      for (let i = 0; i < 20 && g.t < to && !g.open.length && !p.session.over && !p.listening(); i++) p.session.step(0.5);
      p.draw(true);
      return g.t >= to || g.open.length > 0 || p.session.over;
    }, [until, ROLE]);
    await heard(page);
    if (done) break;
  }
}

test("the mission's stop on the line: the district manager's seat for a person, its place in the district and its facts", async ({ page }) => {
  await page.goto(MISSION);
  await page.evaluate(() => localStorage.clear());
  await page.goto(MISSION);
  await page.waitForFunction(() => window.__play?.ready);
  await expect(page.locator("#setup h2, #setup h1").first()).toHaveText("Short notice");
  await expect(page.locator("#setup")).toContainText("Four works, five people, a storm.");
  await expect(page.locator(`#by-${ROLE}`)).toBeChecked();
  await expect(page.locator("#setup")).toContainText("1 role");
  await expect(page.locator("#setup")).toContainText("32 min on the clock");
  expect(await page.evaluate(() => window.__play.problems ?? [])).toEqual([]);
});

test("Monday morning: who speaks first, the week's clock, a person put on a work in the chart, the council asked, the possession's length as a number with the welder's look beside it", async ({ page }) => {
  const errors = await start(page);
  await page.evaluate(() => {
    const p = window.__play;
    for (let i = 0; i < 20 && !p.listening(); i++) p.session.step(0.5);
    p.draw(true);
  });
  expect(await page.locator(`${SEAT} .vn-story .vn-line`).first().textContent()).toContain("Monday, six o'clock, and the district is yours for a week.");
  await expect(page.locator(`${SEAT} .vn-name strong`).first()).toHaveText("A. Kranich");
  await heard(page);
  await runTo(page, 16);
  // the clock shows the week's time of day, without seconds: three minutes pass in a second of the shift
  await expect(page.locator("#clock")).toHaveText(/^06:[34]\d$/);
  await expect(page.locator(".play-hud")).toContainText("Mon");
  // the chart of the week: the works, the people, who is told
  const board = page.locator(`${SEAT} .play-board`), pick = page.locator(`${SEAT} .play-pick`), tag = (id) => board.locator(`.pick[data-id="${id}"]`);
  await expect(page.locator(`${SEAT} .play-sketch h4`)).toHaveText("The week");
  await expect(board).toHaveAttribute("aria-label", /^The week from Monday 06:00 to Friday 06:00 as a chart/);
  for (const id of ["work-tamp", "work-points", "work-rail", "work-veg", "person-p1", "person-p5", "aud-ops", "aud-town", "aud-safety"]) await expect(tag(id)).toHaveCount(1);
  // (the works council and the team can be chosen once there is a shift outside the rota to tell them of)
  for (const id of ["aud-council", "aud-staff"]) await expect(tag(id)).toHaveCount(0);
  // a person: where they live and what their week allows, and the works they can go onto
  await tag("person-p1").click({ force: true });
  await expect(tag("person-p1")).toHaveAttribute("aria-pressed", "true");
  await expect(pick.locator(".play-picked")).toContainText("H. Bussard, track technician (possession), lives at Bergheim: two small children; the partner works nights at the hospital on Tuesday and Wednesday.");
  await expect(pick.locator("button")).toHaveText(["Put on the tamping at Bergheim (Wed 22:00)", "Put on the rail change at Talsee (Thu 23:30)"]);
  await pick.getByRole("button", { name: /Put on the tamping/ }).click();
  await tag("person-p2").click({ force: true });
  await pick.getByRole("button", { name: /Put on the tamping/ }).click();
  let g = await game(page);
  expect(g.crews.tamp).toEqual(["p1", "p2"]);
  expect(g.rota).toEqual([["p1", "tamp", false, false], ["p2", "tamp", false, false]]);
  // rest is said where a person cannot: the vegetation by day and that night
  await tag("person-p5").click({ force: true });
  await expect(pick.locator("button")).toHaveText(["Put on the rail change at Talsee (Thu 23:30)"]);
  // the work: its other slots, who is on it, a room for who lives 45 km away
  await tag("work-tamp").click({ force: true });
  await expect(pick.locator(".play-picked")).toContainText("The tamping at Bergheim (Bergheim): the contractor's tamping machine is booked for the night of Wednesday");
  await expect(pick.locator("button")).toHaveText(["Plan it for Thu 22:00 (night)", "Take H. Bussard off it", "Take D. Wróbel off it", "Book a room at the site (90 EUR)"]);
  // the works council: one request for the shifts outside the rota; the people only on its consent
  await tag("aud-staff").click({ force: true });
  await expect(pick.locator("button")).toHaveText(["Tell them all 2 shifts now, before the works council has consented"]);
  await tag("aud-council").click({ force: true });
  await expect(pick.locator(".play-picked")).toContainText("S. Leylek, the works council's chair");
  await pick.getByRole("button", { name: "Ask for consent to 2 shifts outside the rota" }).click();
  expect((await game(page)).rota).toEqual([["p1", "tamp", true, false], ["p2", "tamp", true, false]]);
  // operations: the rail's possession is registered, and asked about: for how many hours?
  await tag("person-p2").click({ force: true });
  await pick.getByRole("button", { name: /Put on the rail change/ }).click();
  await tag("person-p5").click({ force: true });
  await pick.getByRole("button", { name: /Put on the rail change/ }).click();
  await tag("aud-ops").click({ force: true });
  await pick.getByRole("button", { name: "Register the possession for the rail change at Talsee (Thu 23:30)" }).click();
  const asked = page.locator(`${SEAT} .play-decision:not(.waiting)`), slider = asked.locator(".play-scale input[type=range]");
  await expect(page.locator(`${SEAT} .vn-name strong`)).toHaveText("W. Kauz");
  await expect(asked.locator("h5")).toHaveText("W. Kauz, the possession planner: “A possession on the line to Talsee from Thu 23:30. For how many hours?”");
  await expect(asked.locator(".text")).toContainText("Too short and the work runs over into trains nobody warned; too long and trains are taken out that could have run.");
  await expect(asked.locator(".play-scale label")).toHaveText("The possession is registered for");
  await expect(slider).toHaveAttribute("min", "3");
  await expect(slider).toHaveAttribute("max", "8");
  await expect(slider).toHaveAttribute("step", "0.5");
  await expect(asked.locator(".play-scale-end")).toHaveText(["3 h", "8 h"]);
  await expect(asked.locator(".play-options-row .btn")).toHaveText(["1D. Wróbel looks at the rail first (3 h)"]);
  // the welder looks first: the registration waits three hours, then the same question with a narrower estimate and nothing beside it
  await asked.locator(".play-options-row .btn").click();
  g = await game(page);
  expect([g.look, g.told.rail, g.open]).toEqual([true, [], []]);
  await runTo(page, 16 + 62);
  expect((await game(page)).open).toEqual(["length-rail"]);
  await page.evaluate((role) => window.__play.look(role, "length-rail"), ROLE);
  await asked.locator(".play-why").click();
  await expect(asked.locator(".text")).toContainText("having looked at the rail");
  await expect(asked.locator(".play-options-row")).toHaveCount(0);
  await slider.evaluate((el) => {
    el.value = "5.5";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(asked.locator(".play-scale output")).toHaveText("5.5 h");
  await asked.locator(".play-scale .btn").click();
  g = await game(page);
  expect([g.len, g.told.rail]).toEqual([5.5, ["ops"]]);
  expect(g.diary.at(-1)).toEqual(["W. Kauz, the possession planner: “A possession on the line to Talsee from Thu 23:30. For how many hours?”", "The possession is registered for 5.5 h"]);
  // the moves are also forms of the desk
  await page.keyboard.press("d");
  await expect(page.locator(`${SEAT} dialog[open] .play-move legend`)).toHaveText(["Give a work its slot", "Put a person on a work", "Tell somebody"]);
  expect(errors).toEqual([]);
});

test("the week on the table: the board on the lab's layout; a van, then the site it goes to; a pin, then what is told there; night comes with the week's clock", async ({ page }) => {
  const errors = await start(page, { live: true });
  await page.waitForFunction(() => window.__play.tabled && window.__play.live?.view && window.__play.live.board?.constructor.type === "works-board");
  await heard(page);
  await runTo(page, 16);
  expect(await page.evaluate(() => [...window.__play.live.boards.keys()])).toEqual(["works"]);
  expect(await inPicture(page)).toEqual([]);
  const at = (item) => page.evaluate((it) => {
    const live = window.__play.live, p = live.board.placeOf(it), q = live.view.project(p[0], p[1], p[2] ?? 0), r = live.canvas.getBoundingClientRect();
    const { width, height } = live.canvas, k = Math.max(r.width / width, r.height / height);
    return [r.left + (r.width - width * k) * 0.5 + q[0] * k, r.top + (r.height - height * k) * 0.8 + q[1] * k];
  }, item);
  const show = async (part) => {
    await page.evaluate((x) => window.__play.live.show(x, true), part);
    await page.waitForTimeout(400);
  };
  // a van in the yard of the base is chosen on the table: the person is chosen in the chart, with the works they can go onto
  await show("west");
  await page.mouse.click(...(await at("person-p1")));
  await expect(page.locator(`${SEAT} .play-board .pick[data-id="person-p1"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`${SEAT} .play-picked`)).toContainText("H. Bussard, track technician (possession), lives at Bergheim");
  // then the site: that is the move
  await page.mouse.click(...(await at("work-tamp")));
  expect((await game(page)).crews.tamp).toEqual(["p1"]);
  await expect(page.locator(`${SEAT} .play-board .pick[aria-pressed="true"]`)).toHaveCount(0);
  // a pin, then what is told there: the town hears of the tamping night
  await show("all");
  await page.mouse.click(...(await at("aud-town")));
  await expect(page.locator(`${SEAT} .play-picked`)).toContainText("M. Habicht, the head of the town's public order office");
  await page.mouse.click(...(await at("work-tamp")));
  expect((await game(page)).told.tamp).toEqual(["ops", "town"]);
  // the site alone: the work, with its slots
  await page.mouse.click(...(await at("work-rail")));
  await expect(page.locator(`${SEAT} .play-picked`)).toContainText("The rail change at Talsee (Talsee): a rail with an internal defect");
  await page.mouse.click(...(await at("work-rail")));
  // the week's clock is the table's: on Monday at eleven at night it is dark, and everybody's van is at home
  await page.evaluate((role) => {
    const p = window.__play, g = p.session.seat(role).game;
    while (g.now < 17 && !p.session.over) {
      for (const d of [...g.open]) p.session.act(role, "decide", d.id, g.advice(d.id));
      p.session.step(0.5);
    }
    p.draw(true);
  }, ROLE);
  await heard(page);
  await page.waitForTimeout(600);
  const night = await page.evaluate((role) => {
    const live = window.__play.live, g = window.__play.session.seat(role).game, d = g.district();
    return { night: d.night, home: d.people.every((p) => p.at === "home"), dark: live.view.darkness > 0.5, clock: document.querySelector("#clock").textContent };
  }, ROLE);
  expect(night).toEqual({ night: true, home: true, dark: true, clock: "23:00" });
  expect(await inPicture(page)).toEqual([]);
  // left, the layout's own trains and weather are the world's again
  await page.locator("#leave").click();
  await page.waitForFunction(() => !window.__play.tabled);
  expect(await page.evaluate(() => window.__play.live.world.simulations.some((s) => s.constructor.type === "works-board"))).toBe(false);
  expect(errors).toEqual([]);
});

test("a week played through as the computer would: what does not go to plan is said, the storm and a driver's report are asked about, and the verdict has the decisions", async ({ page }) => {
  const errors = await start(page);
  const said = [], asked = page.locator(`${SEAT} .play-decision:not(.waiting)`), seen = new Set();
  for (let k = 0; k < 2500; k++) {
    const state = await page.evaluate((role) => {
      const p = window.__play, s = p.session, g = s.seat(role).game, P = new g.constructor.player();
      for (let i = 0; i < 60 && !g.open.length && !s.over && !p.listening(); i++) {
        // (the hands of the week: the plan staffed and announced by the book)
        P.hands(g);
        s.step(0.5);
      }
      p.draw(true);
      const line = [...document.querySelectorAll(`#seat-${role} .vn-story`)].find((el) => !el.hidden)?.querySelector(".vn-line")?.textContent ?? null;
      return { over: s.over, open: g.open.map((d) => d.id), line, advice: Object.fromEntries(g.open.map((d) => [d.id, g.advice(d.id)])) };
    }, ROLE);
    if (state.over) break;
    if (state.line) said.push(state.line);
    await heard(page);
    for (const id of state.open) {
      await page.evaluate(([role, x]) => window.__play.look(role, x), [ROLE, id]);
      const kind = id.split("-")[0], a = state.advice[id];
      seen.add(kind);
      if (kind === "storm") {
        await expect(asked.locator("h5")).toContainText("A storm is forecast for Wednesday evening, gusts of 70 to 110 km/h.");
        await expect(asked.locator(".play-options-row .btn span")).toContainText(["Keep Wed 22:00", "Move it to Thu 22:00", "Call it off for this week"]);
        await asked.locator(".play-options-row .btn").first().click();
      } else if (kind === "fault") {
        await expect(asked.locator("h5")).toContainText("A driver reports a hard knock on the line to ");
        await expect(asked.locator(".play-options-row .btn")).toHaveCount(3);
        await asked.locator(".play-options-row .btn").nth(1).click();
      } else if (typeof a === "number") await asked.locator(".play-scale .btn").click();
      else await page.evaluate(([role, x, o]) => window.__play.decide(role, x, o), [ROLE, id, a]);
    }
  }
  // the district manager on leave spoke first; the work planner said what to do about a fault
  expect(said[0]).toContain("Monday, six o'clock, and the district is yours for a week.");
  expect(said.some((x) => x.includes("Somebody must look before we know what it is"))).toBe(true);
  expect(said.some((x) => x.startsWith("The storm is here"))).toBe(true);
  for (const kind of ["storm", "fault", "forecast", "length"]) expect([...seen]).toContain(kind);
  const g = await page.evaluate((role) => {
    const w = window.__play.session.seat(role).game, a = w.account();
    return { kinds: [...new Set(w.irregulars.map((x) => x.kind))], a, danger: w.violations.some((v) => v.severity >= 3) };
  }, ROLE);
  expect(g.kinds).toContain("fault");
  expect(g.kinds).toContain("storm");
  expect(g.a.done).toBeGreaterThanOrEqual(3);
  expect(g.a.in_time).toBeGreaterThanOrEqual(6);
  expect(g.danger).toBe(false);
  // the verdict: the district manager's score, the decisions on the sheet
  await expect(page.locator("#result")).toBeVisible();
  await expect(page.locator("#result h2, #result h1").first()).toContainText("Short notice");
  const diary = await page.evaluate(() => window.__play.diary.map((x) => x.chose));
  expect(diary).toContain("Keep Wed 22:00");
  expect(diary.some((x) => /^Open again in \d(\.5)? h$/.test(x))).toBe(true);
  expect(diary.some((x) => /^The possession is registered for \d(\.5)? h$/.test(x))).toBe(true);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("arail.game.progress")));
  expect(kept.missions["short-notice"].plays).toBe(1);
  expect(kept.missions["short-notice"].passed).toBe(true);
  expect(errors).toEqual([]);
});
