// End-to-end tests of the signaller's shift on the table (game/play/ with the live picture as the
// game's own: web/game/table.js, web/game/live.js): the table is shown for a signaller's seat, a
// signal and where its route goes are chosen on it and the panel shows the same, T and its button
// switch it; the table's camera (the parts of the station, nearer and farther, the keys, a choice
// on the panel brings it there); a train at a platform is there for the world's people; the table on
// a photo of the lab, placed by its markers; the camera of a device that has none; accessibility.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { inPicture } from "./picture.js";

/** The first mission, with the live picture (a test's browser gets it only when the address asks for it). */
const FIRST = "/game/play/?mission=first-shift&live";
const SEAT = "#seat-signaller-relay";

/**
 * Start the first shift on the table and pause it. The live picture is never given up for being
 * slow (a test's browser draws without a graphics card), and the sound is off.
 */
async function start(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(FIRST);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("arail.game.sound", "false");
  });
  await page.goto(FIRST);
  await page.waitForFunction(() => window.__play?.ready);
  await page.evaluate(async () => {
    (await import("/game/live.js")).LIVE.slow_ms = 1e9;
  });
  await page.locator("#start").click();
  await page.waitForFunction(() => window.__play.session);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForFunction(() => window.__play.tabled && window.__play.live?.view);
  return errors;
}

/** The table's panel in the side bar, opened (its button opens it, a click on the table closes it). */
async function panel(page) {
  const p = page.locator("#tablePanel");
  if (await p.isHidden()) await page.locator("#tableBtn").click();
  await expect(p).toBeVisible();
  return p;
}

/** Where an item of the game's picture is on the page (client px), as the frame drawn last shows it. */
const where = (page, item) => page.evaluate((it) => {
  const live = window.__play.live, p = live.board.placeOf(it), q = live.view.project(p[0], p[1], 0), r = live.canvas.getBoundingClientRect();
  // the canvas covers its box (a photo of another shape is cut; SOURCES.focus of live.js says where)
  const { width, height } = live.canvas, k = Math.max(r.width / width, r.height / height);
  return [r.left + (r.width - width * k) * 0.5 + q[0] * k, r.top + (r.height - height * k) * 0.8 + q[1] * k];
}, item);

/** The signaller's game, as plain data. */
const game = (page) => page.evaluate(() => {
  const p = window.__play, g = p.session.seat(p.tab).game;
  return { routes: [...g.routes.keys()], picked: p.picked.get(p.tab) ?? null, offers: p.live.board.offers.map((o) => o.route), standing: [...p.live.board.standing.keys()] };
});

/** The table's camera: what it looks at and from how far. */
const camera = (page) => page.evaluate(() => {
  const c = window.__play.live.cam;
  return { x: c.target[0], y: c.target[1], distance: c.distance, flying: !!window.__play.live.flight };
});

/** Let the shift run for `seconds`, then draw. */
const run = (page, seconds) => page.evaluate((s) => {
  const p = window.__play;
  for (let i = 0; i < s; i++) p.session.step(1);
  p.draw(true);
}, seconds);

test("the signaller's shift on the table: a signal and where its route goes are chosen there, and the panel shows the same", async ({ page }) => {
  const errors = await start(page);
  await expect(page.locator("body")).toHaveClass(/\btabled\b/);
  await expect(page.locator("#backdrop")).toHaveClass(/\blive\b/);
  // the table's controls are in the side bar, behind its button; nothing of them on the picture
  const button = page.locator("#tableBtn");
  await expect(button).toHaveAccessibleName("The table");
  await expect(page.locator("#tablePanel")).toBeHidden();
  await panel(page);
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#tableOn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#tableBar [data-source=table]")).toHaveAttribute("aria-pressed", "true");
  expect(await inPicture(page)).toEqual([]);
  // the panel is still there, small, and works as before
  await expect(page.locator(`${SEAT} .play-board`)).toBeVisible();
  // somebody of the mission's story speaks first: answered, the table is the player's
  await run(page, 3);
  await page.locator(`${SEAT} .vn-story .btn`).click();

  // a click on signal A, on the table: it is chosen, its routes are offered there and below the panel
  await page.mouse.click(...(await where(page, "signal-A")));
  await expect(page.locator(`${SEAT} .play-picked`)).toHaveText("Signal A: stop");
  await expect(page.locator(`${SEAT} .play-board .pick[data-id="signal-A"]`)).toHaveAttribute("aria-pressed", "true");
  expect(await game(page)).toMatchObject({ picked: "signal-A", offers: ["A-G1", "A-G2", "A-G3"], routes: [] });
  // a click on track G2: the route is set (the game's own move), and the signal is let go of
  await page.mouse.click(...(await where(page, "track-G2")));
  await expect.poll(async () => (await game(page)).routes).toEqual(["A-G2"]);
  expect(await game(page)).toMatchObject({ picked: null, offers: [] });
  await expect(page.locator(`${SEAT} .play-board line.t-route`)).not.toHaveCount(0);
  // a click on a platform track without a signal chosen: the track is chosen (to close it), and a second click lets go of it
  await page.mouse.click(...(await where(page, "track-G1")));
  await expect(page.locator(`${SEAT} .play-pick`).getByRole("button", { name: "Close G1" })).toBeVisible();
  await page.mouse.click(...(await where(page, "track-G1")));
  expect((await game(page)).picked).toBeNull();

  // T and the switch in the side bar: the panel alone, with the backdrop as an ornament again; the choice is kept
  await page.keyboard.press("t");
  await expect(page.locator("body")).not.toHaveClass(/\btabled\b/);
  await panel(page);
  await expect(page.locator("#tableOn")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#tableSources")).toBeHidden();
  await expect(page.locator("#tableOff")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("arail.game.table"))).toBe("false");
  expect(await page.evaluate(() => window.__play.live.table)).toBe(false);
  await page.locator("#tableOn").click();
  await expect(page.locator("body")).toHaveClass(/\btabled\b/);
  await expect(page.locator("#tableSources")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("arail.game.table"))).toBe("true");
  // the route set on the table is the game's: the train comes in on it and stands at the platform, for the world's people too
  await page.getByRole("button", { name: "1×" }).click();
  await page.evaluate(() => {
    const p = window.__play;
    p.sit(p.tab, "computer");
    for (let i = 0; i < 170; i++) p.session.step(1);
  });
  await expect.poll(async () => (await game(page)).standing, { timeout: 30_000 }).toContain("RB 31");
  expect(await page.evaluate(() => {
    const board = window.__play.live.board, v = board.standing.get("RB 31").vehicle;
    return [v.kind, board.world.services.doors(v).length];
  })).toEqual(["table-train", 2]);
  expect(errors).toEqual([]);
});

test("the table's camera: the parts of the station, nearer and farther, the keys; a choice on the panel brings it there", async ({ page }) => {
  const errors = await start(page);
  await run(page, 3);
  await page.locator(`${SEAT} .vn-story .btn`).click();
  const whole = await camera(page);
  // a part of the station: the camera flies there and is nearer
  await (await panel(page)).getByRole("button", { name: "Talsee end" }).click();
  await expect.poll(async () => (await camera(page)).flying).toBe(false);
  const east = await camera(page);
  expect(east.x).toBeLessThan(whole.x - 1500);
  expect(east.distance).toBeLessThan(whole.distance * 0.7);
  // nearer and farther, by the buttons and the keys; the arrows slide the table
  await (await panel(page)).getByRole("button", { name: "Nearer" }).click();
  expect((await camera(page)).distance).toBeLessThan(east.distance * 0.8);
  await page.keyboard.press("-");
  expect((await camera(page)).distance).toBeCloseTo(east.distance, 0);
  await page.keyboard.press("ArrowRight");
  expect((await camera(page)).x).toBeLessThan(east.x - 10);
  // a drag slides it, the wheel goes nearer
  const before = await camera(page);
  await page.mouse.move(500, 420);
  await page.mouse.down();
  await page.mouse.move(620, 420, { steps: 5 });
  await page.mouse.up();
  const dragged = await camera(page);
  expect(dragged.x).toBeGreaterThan(before.x + 50);
  expect(await game(page)).toMatchObject({ picked: null }); // a drag is no click
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await camera(page)).distance).toBeLessThan(dragged.distance * 0.9);
  // signal A is at the other end: chosen on the panel, the camera goes there
  await page.locator(`${SEAT} .play-board .pick[data-id="signal-A"]`).click();
  await expect.poll(async () => (await camera(page)).flying).toBe(false);
  expect((await camera(page)).x).toBeGreaterThan(5000);
  expect(await page.evaluate(() => {
    const live = window.__play.live, p = live.board.placeOf("signal-A");
    return live.view.inImage(p[0], p[1], 0, 0);
  })).toBe(true);
  // 0: the whole station again
  await page.keyboard.press("0");
  await expect.poll(async () => (await camera(page)).flying).toBe(false);
  expect((await camera(page)).distance).toBeCloseTo(whole.distance, -1);
  expect(errors).toEqual([]);
});

test("the table on a photo of the lab: its markers are found, and the game is drawn onto the real table", async ({ page }) => {
  const errors = await start(page);
  await run(page, 3);
  await page.locator(`${SEAT} .vn-story .btn`).click();
  const photo = (await panel(page)).getByRole("button", { name: "Lab photo" });
  await photo.click();
  await expect(photo).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#tableParts")).toBeHidden();
  // the markers of the table are found in the photo (in a worker): then the game is on it
  await expect.poll(() => page.evaluate(() => window.__play.live.tracking), { timeout: 30_000 }).toBe(true);
  await expect(page.locator("#tableNote")).toBeHidden();
  await page.waitForFunction(() => window.__play.live.view && !window.__play.live.view.virtual);
  expect(await page.evaluate(() => {
    const live = window.__play.live;
    return [live.source, live.canvas.width, Math.round((100 * live.canvas.width) / live.canvas.height)];
  })).toEqual(["photo", 1280, 133]);
  // the photo shows the platforms: a track there is chosen on the real table
  await page.mouse.click(...(await where(page, "track-G2")));
  await expect(page.locator(`${SEAT} .play-picked`)).toHaveText("Track G2: free");
  // the camera's own moves are not for a photo
  const cam = await camera(page);
  await page.keyboard.press("+");
  expect((await camera(page)).distance).toBe(cam.distance);
  // a device without a camera: the table stays as it is, and a note says why
  await (await panel(page)).getByRole("button", { name: "Camera" }).click();
  await expect(page.locator("#tableNote")).toContainText(/camera/i);
  await expect(page.locator("#tableBar [data-source=table]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#tableParts")).toBeVisible();
  expect(await page.evaluate(() => [window.__play.live.source, window.__play.live.tracking])).toEqual(["table", null]);
  expect(errors).toEqual([]);
});

test("the table has no accessibility violations and no text in the picture: the panel, a signal chosen, its controls, a photo of the lab", async ({ page }) => {
  await start(page);
  const found = [];
  const check = async (state) => {
    // and the rule of the picture: no text on it outside the header, the side bar, the band and the panel
    found.push(...(await inPicture(page)).map((t) => `${state}: text in the picture: ${t}`));
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
    found.push(...results.violations.map((v) => `${state}: ${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`));
  };
  await run(page, 3);
  await check("a line of the story on the table");
  await page.locator(`${SEAT} .vn-story .btn`).click();
  await check("the table with the panel");
  await page.mouse.click(...(await where(page, "signal-A")));
  await expect(page.locator(`${SEAT} .play-picked`)).toBeVisible();
  await check("a signal chosen on the table");
  await panel(page);
  await check("the table's controls in the side bar");
  await (await panel(page)).getByRole("button", { name: "Lab photo" }).click();
  await expect.poll(() => page.evaluate(() => window.__play.live.tracking), { timeout: 30_000 }).toBe(true);
  await check("the table on a photo of the lab");
  expect(found).toEqual([]);
});

/**
 * A camera that answers only when the test says so, as a person answers the browser's prompt: `window.__camera.release()`
 * gives a stream (a canvas's), and `stopped` counts its tracks stopped.
 */
const slowCamera = () => {
  window.__camera = { asked: 0, release: null, stopped: 0 };
  if (!navigator.mediaDevices) Object.defineProperty(navigator, "mediaDevices", { value: {} });
  navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => {
    window.__camera.asked++;
    window.__camera.release = () => {
      const c = Object.assign(document.createElement("canvas"), { width: 640, height: 480 });
      c.getContext("2d").fillRect(0, 0, 640, 480);
      const stream = c.captureStream(5);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => (window.__camera.stopped++, stop());
      }
      resolve(stream);
    };
  });
};

test("a camera still opening when the table is left, or another source is chosen, is let go of", async ({ page }) => {
  await page.addInitScript(slowCamera);
  const errors = await start(page);
  await run(page, 3);
  await page.locator(`${SEAT} .vn-story .btn`).click();
  const live = () => page.evaluate(() => ({ source: window.__play.live.source, feed: !!window.__play.live.feed, table: window.__play.live.table, stopped: window.__camera.stopped }));
  // the camera is asked for; while the person still answers the prompt, the table is left (T)
  await (await panel(page)).getByRole("button", { name: "Camera" }).click();
  await page.waitForFunction(() => window.__camera.asked === 1);
  await page.keyboard.press("t");
  await expect(page.locator("body")).not.toHaveClass(/\btabled\b/);
  await page.evaluate(() => window.__camera.release());
  // the camera that opened late is stopped at once: no light without the table
  await expect.poll(live).toEqual({ source: "table", feed: false, table: false, stopped: 1 });
  // back on the table: from above, its controls as they are
  await page.keyboard.press("t");
  await expect(page.locator("body")).toHaveClass(/\btabled\b/);
  await panel(page);
  await expect(page.locator("#tableBar [data-source=table]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#tableParts")).toBeVisible();
  // the camera is asked for, and the lab's photo is chosen before the prompt is answered: the photo it is
  await page.getByRole("button", { name: "Camera" }).click();
  await page.waitForFunction(() => window.__camera.asked === 2);
  await page.getByRole("button", { name: "Lab photo" }).click();
  await expect.poll(async () => (await live()).source).toBe("photo");
  await page.evaluate(() => window.__camera.release());
  await expect.poll(live).toEqual({ source: "photo", feed: true, table: true, stopped: 2 });
  await expect(page.locator("#tableBar [data-source=photo]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#tableBar [data-source=camera]")).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});

test("where the table's markers cannot be searched, the line at the top says so", async ({ page }) => {
  // a browser that cannot start the search's worker
  await page.addInitScript(() => {
    window.Worker = function Worker() {
      throw new Error("no workers here");
    };
  });
  await start(page);
  await run(page, 3);
  await page.locator(`${SEAT} .vn-story .btn`).click();
  await (await panel(page)).getByRole("button", { name: "Lab photo" }).click();
  await expect(page.locator("#tableNote")).toHaveText("The table's markers cannot be searched in this browser: the game cannot be placed on the picture.");
  await expect(page.locator("#tableNote")).toBeVisible();
  expect(await page.evaluate(() => window.__play.live.tracking)).toBe(false);
});
