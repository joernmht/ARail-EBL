// End-to-end tests of the mission Fit to run (game/play/?mission=fit-to-run): the workshop manager's
// night in the hall, on the table. Its stop on the line of missions; a free track asked about (one
// of a few, without a time to answer by) and the night's time of day at the shift's pace; the
// lathe's cut as a number with measuring first beside it; the picture of the depot with a unit
// chosen, moved, released to service and phoned for; the table: the layout's module Workshop hall
// with the game's night in it, a unit chosen there, the parts of the picture by their names here;
// a night played through with what is said when something does not go to plan, and the verdict.
import { expect, test } from "@playwright/test";

import { inPicture } from "./picture.js";

const MISSION = "/game/play/?mission=fit-to-run", SEAT = "#seat-workshop-manager", ROLE = "workshop-manager";

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

/** The workshop manager's game, as plain data. */
const game = (page) => page.evaluate((role) => {
  const p = window.__play, g = p.session.seat(role).game;
  return {
    t: g.t, open: g.open.map((d) => d.id), units: Object.fromEntries(g.units.map((u) => [u.id, { track: u.track, moving: !!u.moving, released: u.released_t != null, returned: u.rto_t != null, phoned: !!u.phoned, lift: u.lift }])),
    queue: [g.shunt.now, ...g.shunt.queue].filter(Boolean).map((m) => `${m.unit}:${m.to}`), calls: g.tally.calls, diary: p.diary.map((x) => [x.title, x.chose]),
  };
}, ROLE);

/** Answer what is said to the workshop manager, as long as somebody speaks. */
const heard = (page) => page.evaluate(() => {
  for (const story of document.querySelectorAll(".vn-story")) for (let i = 0; i < 50 && !story.hidden; i++) story.querySelector(".btn.primary")?.click();
  window.__play.draw(true);
});

/** Let the night run until something is asked (or `until` s of the shift have passed); what is said on the way is answered. */
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

/**
 * Let the night run to `t` s of the shift, whatever is asked on the way: what `answers` name is decided so (a
 * decision's id, or the first part of it → an option or a number; null: it stays open), the rest as the computer's
 * workshop manager would; with `hands`, what is done is released and put outside as the computer does. What is said is answered.
 */
async function advance(page, t, answers = {}, hands = true) {
  await page.evaluate(([to, ans, role, withHands]) => {
    const p = window.__play, s = p.session, g = s.seat(role).game, P = new g.constructor.player();
    while (g.t < to && !s.over) {
      for (const d of [...g.open]) {
        // (null: the question stays open)
        const a = d.id in ans ? ans[d.id] : d.id.split("-")[0] in ans ? ans[d.id.split("-")[0]] : g.advice(d.id);
        if (a !== null) s.act(role, "decide", d.id, a);
      }
      if (withHands) P.hands(g);
      s.step(0.5);
    }
    p.draw(true);
  }, [t, answers, ROLE, hands]);
  await heard(page);
}

test("the mission's stop on the line: the workshop manager's seat for a person, its place in the hall and its facts", async ({ page }) => {
  await page.goto(MISSION);
  await page.evaluate(() => localStorage.clear());
  await page.goto(MISSION);
  await page.waitForFunction(() => window.__play?.ready);
  await expect(page.locator("#setup h2, #setup h1").first()).toHaveText("Fit to run");
  await expect(page.locator("#setup")).toContainText("Four units, four orders, four trains at dawn.");
  await expect(page.locator(`#by-${ROLE}`)).toBeChecked();
  await expect(page.locator("#setup")).toContainText("1 role");
  await expect(page.locator("#setup")).toContainText("37 min on the clock");
  expect(await page.evaluate(() => window.__play.problems ?? [])).toEqual([]);
});

test("a free track, and the night's clock: one of a few without a time to answer by; the time of day runs at the shift's pace", async ({ page }) => {
  const errors = await start(page);
  // the ECM manager speaks first, of the four functions; then the foreman of the hall
  await page.evaluate(() => {
    const p = window.__play;
    for (let i = 0; i < 20 && !p.listening(); i++) p.session.step(0.5);
    p.draw(true);
  });
  const first = await page.locator(`${SEAT} .vn-story .vn-line`).first().textContent();
  expect(first).toContain("Tonight you are maintenance delivery");
  await expect(page.locator(`${SEAT} .vn-name strong`).first()).toHaveText("K. Eisvogel");
  await heard(page);
  await runTo(page, 30);
  const asked = page.locator(`${SEAT} .play-decision:not(.waiting)`);
  await expect(page.locator(`${SEAT} .vn-name strong`)).toHaveText("C. Gimpel");
  await expect(asked.locator("h5")).toHaveText("Track 1, the pit, is free. Who goes in: 442 105 or 442 101?");
  await expect(asked.locator(".text")).toContainText("A unit on a track keeps it until its work there is done or you move it out.");
  await expect(asked.locator(".text")).not.toContainText("Still to come");
  await asked.locator(".play-why").click();
  await expect(asked.locator(".text")).toContainText("Still to come: 442 107 at about 22:45 (wheel flat on axle 3), 442 103 at about 23:40 (inspection).");
  await expect(asked.locator(".play-options-row .btn")).toHaveCount(3);
  await expect(asked.locator(".play-options-row .btn").nth(0)).toContainText("442 105 (the brake pads, the brake test)");
  await expect(asked.locator(".play-options-row .btn").nth(1)).toContainText("442 101 (the drive of door 3 (if the night allows))");
  await expect(asked.locator(".play-options-row .btn").nth(2)).toContainText("Leave it free for now");
  // no time to answer by: nothing comes into the hall without a word
  await expect(asked).not.toContainText("s left, then");
  // the clock shows the night, without seconds: twelve of them pass in one of the shift
  await expect(page.locator("#clock")).toHaveText(/^22:0\d$/);
  await asked.locator(".play-options-row .btn").nth(2).click();
  // left free, the pit is not asked about again; the next track is
  await runTo(page, 40);
  await expect(asked.locator("h5")).toHaveText("Track 2, the lifting jacks, is free. Who goes in: 442 105 or 442 101?");
  await asked.locator(".play-options-row .btn").nth(0).click();
  let g = await game(page);
  expect(g.queue).toEqual(["105:2"]);
  await page.evaluate(() => window.__play.session.step(60));
  await page.evaluate(() => {
    for (let i = 0; i < 119; i++) window.__play.session.step(0.5);
    window.__play.draw(true);
  });
  g = await game(page);
  expect([g.units["105"].track, g.units["105"].lift]).toEqual(["2", 1]);
  await expect(page.locator("#clock")).toHaveText(/^22:2\d$/);
  expect(g.diary[0]).toEqual(["Track 1, the pit, is free. Who goes in: 442 105 or 442 101?", "Leave it free for now"]);
  expect(errors).toEqual([]);
});

test("the lathe's cut: a number on a scale, and beside it the choice to measure first; measured, the foreman's guess is less than half a millimetre wide", async ({ page }) => {
  const errors = await start(page);
  await advance(page, 300, { cut: null });
  const asked = page.locator(`${SEAT} .play-decision:not(.waiting)`), slider = asked.locator(".play-scale input[type=range]");
  await page.evaluate((role) => window.__play.look(role, "cut-107"), ROLE);
  await expect(asked.locator("h5")).toHaveText(/^442 107 is on the lathe\. Y\. Şahin: “The flat's damage goes \d(\.5)? to \d(\.5)? mm deep, I would say\. How deep do I cut\?”$/);
  await expect(asked.locator(".text")).toContainText("Cut too little and the lathe sets up again; cut too much and wheel life is gone.");
  await expect(asked.locator(".play-scale label")).toHaveText("The lathe cuts");
  await expect(slider).toHaveAttribute("min", "1");
  await expect(slider).toHaveAttribute("max", "6");
  await expect(slider).toHaveAttribute("step", "0.5");
  await expect(asked.locator(".play-scale-end")).toHaveText(["1 mm", "6 mm"]);
  await expect(asked.locator(".play-options-row .btn")).toHaveText(["1Measure the damage first (10 min)"]);
  // measured first: ten minutes of the night, then the same question with a guess of less than half a millimetre and no measuring beside it
  await asked.locator(".play-options-row .btn").click();
  expect((await game(page)).open).not.toContain("cut-107");
  await advance(page, 300 + 55, { cut: null });
  expect((await game(page)).open).toContain("cut-107");
  await page.evaluate((role) => window.__play.look(role, "cut-107"), ROLE);
  await expect(asked.locator("h5")).toHaveText(/The flat's damage goes \d(\.\d+)? to \d(\.\d+)? mm deep, measured\./);
  await expect(asked.locator(".play-options-row")).toHaveCount(0);
  const truth = await page.evaluate((role) => window.__play.session.seat(role).game.unit("107").tasks[0].depth, ROLE);
  // cut to half a millimetre below the damage, with the keys: one pass, nothing beyond need
  await slider.evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, truth + 0.5);
  await expect(asked.locator(".play-scale output")).toHaveText(`${truth + 0.5} mm`);
  await slider.focus();
  await page.keyboard.press("Enter");
  const cut = await page.evaluate((role) => window.__play.session.seat(role).game.unit("107").tasks[0].cut, ROLE);
  expect(cut).toBe(truth + 0.5);
  expect((await game(page)).diary.map((x) => x[1])).toEqual(expect.arrayContaining(["Measure the damage first (10 min)", `The lathe cuts ${truth + 0.5} mm`]));
  expect(errors).toEqual([]);
});

test("the picture of the depot: a unit chosen is moved, released to service and phoned for; a free track offers the units that can come", async ({ page }) => {
  const errors = await start(page);
  await heard(page);
  await runTo(page, 30);
  const board = page.locator(`${SEAT} .play-board`), pick = page.locator(`${SEAT} .play-pick`), tag = (id) => board.locator(`.pick[data-id="${id}"]`);
  await expect(page.locator(`${SEAT} .play-sketch h4`)).toHaveText("The depot");
  await expect(board).toHaveAttribute("aria-label", /^Betriebswerk Neustadt: on the left the stabling tracks outside, in the middle the hall/);
  // the two units outside can be chosen, and every free track; the trains of the morning are listed
  for (const id of ["unit-105", "unit-101", "track-1", "track-2", "track-3", "track-C"]) await expect(tag(id)).toHaveCount(1);
  await expect(board).toContainText("04:24");
  // a unit: its order and what it does, and its moves; the door's drive may wait, so it can be released as it is
  await tag("unit-101").click({ force: true });
  await expect(tag("unit-101")).toHaveAttribute("aria-pressed", "true");
  await expect(pick.locator(".play-picked")).toContainText("442 101: door 3 does not close and is locked: its drive, if the night allows");
  await expect(pick.locator("button")).toHaveText(["Release to service", "To track 1, the pit", "To track 2, the lifting jacks", "To track 3, the wheel lathe", "To stabling track C"]);
  await pick.getByRole("button", { name: "To track 3, the wheel lathe" }).click();
  expect((await game(page)).queue).toEqual(["101:3"]);
  // the question about the free pit is asked again without the unit that is on its way
  await runTo(page, 40);
  await expect(page.locator(`${SEAT} .play-decision:not(.waiting) h5`)).toHaveText("Track 1, the pit, is free. Does 442 105 go in?");
  // a free track: the units that can come
  await tag("track-1").click({ force: true });
  await expect(pick.locator(".play-picked")).toHaveText("Track 1, the pit: free");
  await pick.getByRole("button", { name: "442 105 comes here" }).click();
  let g = await game(page);
  expect(g.queue).toEqual(["101:3", "105:1"]);
  expect(g.open).toEqual([]);
  // one move at a time through the throat: the second waits for the first
  await advance(page, g.t + 10, {}, false);
  g = await game(page);
  expect([g.units["101"].moving, g.units["105"].moving, g.units["105"].track]).toEqual([true, false, "A"]);
  await advance(page, g.t + 30, {}, false);
  g = await game(page);
  expect([g.units["101"].track, g.units["105"].moving]).toEqual(["3", true]);
  // released to service is not returned to operation: the unit is phoned for
  await tag("unit-101").click({ force: true });
  await expect(pick.locator("button").first()).toHaveText("Release to service");
  await pick.getByRole("button", { name: "Release to service" }).click();
  g = await game(page);
  expect([g.units["101"].released, g.units["101"].returned]).toEqual([true, false]);
  await tag("unit-101").click({ force: true });
  await expect(pick.locator(".play-picked")).toContainText(/released 22:\d\d, not yet returned to operation/);
  await pick.getByRole("button", { name: "Phone O. Stieglitz for its return to operation" }).click();
  g = await game(page);
  expect([g.units["101"].phoned, g.calls]).toEqual([true, 1]);
  await advance(page, g.t + 15, {}, false);
  g = await game(page);
  expect(g.units["101"].returned).toBe(true);
  await tag("unit-101").click({ force: true });
  await expect(pick.locator(".play-picked")).toContainText("fit to run, with: door 3 locked");
  // the moves are also a form of the desk
  await page.keyboard.press("d");
  const desk = page.locator(`${SEAT} dialog[open]`);
  await expect(desk.locator(".play-move legend")).toHaveText(["Move a unit", "Release to service"]);
  expect(errors).toEqual([]);
});

test("the night on the table: the layout's workshop hall draws the game's night, a unit is chosen there, the parts of the picture are the depot's", async ({ page }) => {
  const errors = await start(page, { live: true });
  await page.waitForFunction(() => window.__play.tabled && window.__play.live?.view && window.__play.live.board?.constructor.type === "workshop-board");
  // the module Workshop hall is on, and its object shows the game's night
  const on = await page.evaluate((role) => {
    const live = window.__play.live, g = window.__play.session.seat(role).game;
    return { boards: [...live.boards.keys()], layers: live.world.layers().filter((l) => l.enabled).map((l) => l.id), shown: typeof live.board.hall.external, units: live.board.hall.picture().units.map((u) => u.id), own: g.hall().units.map((u) => u.id), night: live.world.night() > 0.5 };
  }, ROLE);
  expect(on).toEqual({ boards: ["workshop"], layers: ["workshop"], shown: "function", units: ["105", "101"], own: ["105", "101"], night: true });
  expect(await inPicture(page)).toEqual([]);
  // the parts of the picture have the depot's names
  await page.locator("#tableBtn").click();
  await expect(page.locator("#tableParts [data-part]")).toHaveText(["The throat", "Outside", "The hall", "Whole depot"]);
  await page.locator("#tableBtn").click();
  await advance(page, 120, { "free-1": "105", "free-2": "101" });
  const marks = await page.evaluate(() => window.__play.live.board.marks().map((m) => m.item));
  expect(marks).toEqual(["unit-105", "unit-101", "track-3", "track-A", "track-B", "track-C"]);
  // a unit is chosen on the table: it is chosen in the picture, with its moves
  await page.evaluate(() => window.__play.live.show("east", true));
  await page.waitForTimeout(400);
  const at = (item) => page.evaluate((it) => {
    const live = window.__play.live, p = live.board.placeOf(it), q = live.view.project(p[0], p[1], p[2]), r = live.canvas.getBoundingClientRect();
    const { width, height } = live.canvas, k = Math.max(r.width / width, r.height / height);
    return [r.left + (r.width - width * k) * 0.5 + q[0] * k, r.top + (r.height - height * k) * 0.8 + q[1] * k];
  }, item);
  await page.mouse.click(...(await at("unit-105")));
  await expect(page.locator(`${SEAT} .play-board .pick[data-id="unit-105"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`${SEAT} .play-picked`)).toContainText("442 105: brake pads of both bogies, brake test; the brake pads");
  await page.locator(`${SEAT} .play-pick`).getByRole("button", { name: "To track 3, the wheel lathe" }).click();
  expect((await game(page)).queue).toEqual(["105:3"]);
  // on the move, the unit is where the hall draws it: on its way out through the door
  await advance(page, 135, {}, false);
  const moving = await page.evaluate(() => {
    const u = window.__play.live.board.hall.picture().units.find((x) => x.id === "105");
    return [u.moving, u.track, u.at < 1];
  });
  expect(moving).toEqual([true, "1", true]);
  // what a question is about pulses on the table too: the unit a finding was found on
  await advance(page, 200, {}, false);
  await runTo(page, 700);
  const open = (await game(page)).open;
  expect(open.some((id) => id.startsWith("finding-") || id.startsWith("cut-") || id.startsWith("free-"))).toBe(true);
  expect((await page.evaluate(() => [...window.__play.live.board.asked()])).length).toBeGreaterThan(0);
  expect(await inPicture(page)).toEqual([]);
  // left, the layout has its own modules again and the hall its own quiet night
  await page.locator("#leave").click();
  await page.waitForFunction(() => !window.__play.tabled);
  expect(await page.evaluate(() => {
    const live = window.__play.live;
    return [live.world.layers().filter((l) => l.enabled).map((l) => l.id).includes("workshop"), live.world.objects.some((o) => o.type === "workshop-hall" && o.external)];
  })).toEqual([false, false]);
  expect(errors).toEqual([]);
});

test("a night played through as the computer would: what does not go to plan is said, the dispatcher asks for a time, and the verdict has the decisions", async ({ page }) => {
  const errors = await start(page);
  const said = [], asked = page.locator(`${SEAT} .play-decision:not(.waiting)`), seen = new Set();
  for (let k = 0; k < 1500; k++) {
    const state = await page.evaluate((role) => {
      const p = window.__play, s = p.session, g = s.seat(role).game, P = new g.constructor.player();
      for (let i = 0; i < 40 && !g.open.length && !s.over && !p.listening(); i++) {
        // (the hands of the hall: what is done is released, and put outside where another unit needs the track)
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
      if (kind === "finding") {
        // a finding beyond the order: phoned in, as the book says
        await expect(asked.locator("h5")).toContainText("C. Gimpel, the foreman, from under 442 ");
        await expect(asked.locator(".play-options-row .btn span")).toContainText(["Phone O. Stieglitz and wait for the order", "Repair it now, under the standing order", "Go on with the order; it goes into the release"]);
        await asked.locator(".play-options-row .btn").first().click();
      } else if (typeof a === "number") await asked.locator(".play-scale .btn").click();
      else await page.evaluate(([role, x, o]) => window.__play.decide(role, x, o), [ROLE, id, a]);
    }
  }
  // the ECM manager spoke first; the foreman said whose decision a finding is
  expect(said[0]).toContain("Ten at night. Four units, four orders, four trains from 04:24.");
  expect(said.some((x) => x.includes("The order is fleet management's"))).toBe(true);
  for (const kind of ["free", "finding", "cut"]) expect([...seen]).toContain(kind);
  const g = await page.evaluate((role) => {
    const w = window.__play.session.seat(role).game, a = w.account();
    return { kinds: [...new Set(w.irregulars.map((x) => x.kind))], a, danger: w.violations.some((v) => v.severity >= 3) };
  }, ROLE);
  expect(g.kinds).toContain("finding");
  expect(g.a.released).toBeGreaterThanOrEqual(3);
  expect(g.a.gone).toBeGreaterThanOrEqual(3);
  expect(g.a.calls).toBeGreaterThanOrEqual(1);
  expect(g.danger).toBe(false);
  // the verdict: the workshop manager's score, the decisions on the sheet
  await expect(page.locator("#result")).toBeVisible();
  await expect(page.locator("#result h2, #result h1").first()).toContainText("Fit to run");
  const diary = await page.evaluate(() => window.__play.diary.map((x) => x.chose));
  expect(diary).toContain("Phone O. Stieglitz and wait for the order");
  expect(diary.some((x) => /^The lathe cuts \d(\.5)? mm$/.test(x))).toBe(true);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("arail.game.progress")));
  expect(kept.missions["fit-to-run"].plays).toBe(1);
  expect(kept.roles).toContain(ROLE);
  expect(errors).toEqual([]);
});
