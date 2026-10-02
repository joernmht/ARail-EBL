// The container terminal in the app: the Terminal tab, moves from the panel and by picking on the
// canvas (pointer and keyboard), arrivals, trucks, the start state, scenarios, phones.
import { expect, test } from "@playwright/test";

const EXAMPLE = "/app/?layout=../layouts/container-terminal.json#terminal";

/** Collect uncaught page errors and console errors (blocked web fonts and other resources are ignored). */
function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

/** Open the example terminal with nothing stored; it opens in the flyover. */
async function openTerminal(page, path = EXAMPLE) {
  const errors = trackErrors(page);
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.mode === "flyover" && window.__arail.terminal.sim, null, { timeout: 30_000 });
  await expect(page.locator("#panel-terminal")).toBeVisible();
  return errors;
}

/** Where a container is: its carrier id, null while it hangs on a crane, undefined if it has left. */
const carrierOf = (page, id) => page.evaluate((c) => {
  const box = window.__arail.terminal.sim.inventory.get(c);
  return box ? box.at?.carrier ?? null : undefined;
}, id);

const setSpeed = (page, speed) => page.evaluate((s) => (window.__arail.world.speed = s), speed);

/** Choose a container in the list of the Terminal panel. */
async function chooseInList(page, id) {
  await page.locator("#termList button", { hasText: id }).click();
  await expect(page.locator("#panel-terminal h2", { hasText: `Move ${id}` })).toBeVisible();
}

/** Point the flyover camera straight down at a layout point (no animation). */
async function lookDownAt(page, target, distance = 900) {
  await page.evaluate(([t, d]) => {
    const a = window.__arail, f = a.flyover;
    window.__lastView = a.lastView; // a frame with the new camera replaces app.lastView
    f.anim = null;
    f.cam.set({ target: t, distance: d, pitch: Math.PI / 2 });
  }, [target, distance]);
  await page.waitForFunction(() => window.__arail.lastView && window.__arail.lastView !== window.__lastView);
}

/** Screen point (CSS px) of the top of a container's box, or of a target box, in the current view. */
function boxPoint(page, { id = null, target = null } = {}) {
  return page.evaluate(([cid, carrier]) => {
    const a = window.__arail, sim = a.terminal.sim, view = a.lastView;
    let box;
    if (carrier) {
      // the place on that carrier nearest to the middle of the stage (away from the buttons and the placing bar)
      const dist = (b) => {
        const p = view.project(b.center[0], b.center[1], b.z0 + b.height);
        return p ? Math.hypot(p[0] - a.canvas.width / 2, p[1] - a.canvas.height / 2) : Infinity;
      };
      box = sim.targetBoxes(a.terminal.selected, view).filter((t) => t.target.carrier === carrier).map((t) => t.box).sort((p, q) => dist(p) - dist(q))[0];
    } else box = sim.boxes(view).find((b) => b.id === cid);
    if (!box) return null;
    const p = view.project(box.center[0], box.center[1], box.z0 + box.height);
    const r = a.canvas.getBoundingClientRect();
    return { x: r.left + (p[0] * r.width) / a.canvas.width, y: r.top + (p[1] * r.height) / a.canvas.height, center: box.center };
  }, [id, target]);
}

test("the example terminal opens in the flyover; leaving it shows that the layout is virtual", async ({ page }) => {
  const errors = await openTerminal(page);
  const state = await page.evaluate(() => {
    const sim = window.__arail.terminal.sim;
    return { kt41: sim.visits.get("KT41").state, bg1: sim.visits.get("BG1").state, kt52: sim.visits.get("KT52").state, yard: sim.carrier("yard-a")?.present };
  });
  expect(state).toEqual({ kt41: "positioned", bg1: "positioned", kt52: "away", yard: true });
  await expect(page.locator("#tab-terminal")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#panel-terminal h2").first()).toHaveText("KV terminal");
  await expect(page.locator(".term-board .stop[data-id=KT41] .status")).toHaveText("at Loading track 1");
  await expect(page.locator(".term-board .stop[data-id=BG1] .status")).toHaveText("at the quay");
  await expect(page.locator("#hud")).toContainText("Terminal · 0 moves");
  await page.locator("#btnFlyover").click();
  await page.waitForFunction(() => window.__arail.mode === "camera");
  await expect(page.locator("#emptyStage")).toBeVisible();
  await expect(page.locator("#emptyStage")).toContainText("This layout is virtual");
  expect(errors).toEqual([]);
});

test("a move from the panel: a container from the train to the yard", async ({ page }) => {
  const errors = await openTerminal(page);
  await chooseInList(page, "ARLU 100001 9");
  await expect(page.locator("#termList button", { hasText: "ARLU 100001 9" })).toHaveAttribute("aria-current", "true");
  // a 40 ft container: both of its bays, in the list and in the Move form
  await expect(page.locator("#termList button", { hasText: "ARLU 100001 9" })).toContainText("bay 1–2");
  await expect(page.locator(".term-move .hint").first()).toHaveText("40 ft high cube · KT 41 Hamburg · wagon 1 · bay 1–2");
  // a place in the yard, chosen in "Move to"
  const value = await page.evaluate(() => {
    const t = window.__arail.terminal.sim.targets("ARLU 100001 9").ok.find((x) => x.carrier === "yard-a");
    return `${t.at.carrier}|${t.at.bay}|${t.at.row}|${t.at.tier}`;
  });
  await page.locator("#termTarget").selectOption(value);
  await page.locator("#termMove").click();
  await expect(page.locator("#toast")).toContainText("Move M1 queued: Portal crane 1, from KT 41 Hamburg · wagon 1 · bay 1–2 to Block A · bay");
  await expect(page.locator(".term-jobs tbody tr")).toHaveCount(1);
  await expect(page.locator(".term-jobs td.route")).toContainText(/^KT 41 Hamburg · wagon 1 · bay 1–2→ Block A · bay \d+–\d+ · /);
  await setSpeed(page, 30);
  await page.waitForFunction(() => window.__arail.terminal.sim.inventory.get("ARLU 100001 9").at?.carrier === "yard-a", null, { timeout: 60_000 });
  await expect(page.locator(".term-jobs td.state")).toHaveText("done");
  const at = await page.evaluate(() => window.__arail.terminal.sim.inventory.get("ARLU 100001 9").at);
  expect(`${at.carrier}|${at.bay}|${at.row}|${at.tier}`).toBe(value);
  expect(errors).toEqual([]);
});

test("the deck card links print each wagon type with the layout's settings", async ({ page }) => {
  const errors = await openTerminal(page);
  // one link per type of the example's rolling stock: W1-W2 Sgns, W3 Sggrss, W4 Lgns
  const links = page.locator("#panel-terminal a", { hasText: /^(Sgns|Sggrss|Lgns) W/ });
  await expect(links).toHaveText(["Sgns W1–W2", "Sggrss W3", "Lgns W4"]);
  const href = await links.nth(1).getAttribute("href");
  const q = new URL(href, page.url()).searchParams;
  expect(Object.fromEntries(q)).toEqual({ kind: "rolling", type: "sggrss80", wagons: "3", stride: "4", size: "20", scale: "87" });
  // the marker page takes them over
  await page.goto(new URL(href.replace("stride=4", "stride=5").replace("size=20", "size=14").replace("scale=87", "scale=120"), page.url()).href);
  await expect(page.locator("#wagonType")).toHaveValue("sggrss80");
  await expect(page.locator("#wagons")).toHaveValue("3");
  await expect(page.locator("#stride")).toHaveValue("5");
  await expect(page.locator("#tagSize")).toHaveValue("14");
  await expect(page.locator("#scale")).toHaveValue("120");
  await expect(page.locator("#status")).toHaveText("1 card with 4 markers on 1 sheet.");
  await expect(page.locator("svg.sheet text", { hasText: /^W3 / })).toHaveText("W3 · Sggrss (80 ft) · IDs 10–13");
  expect(errors).toEqual([]);
});

test("model wagon tags seen without a camera pose keep the wagon held", async ({ page }) => {
  const errors = await openTerminal(page);
  const states = await page.evaluate(() => {
    const a = window.__arail, sim = a.terminal.sim, w1 = sim.carrier("W1");
    const tags = (center) => Object.fromEntries([0, 1, 2].map((slot) => {
      const x = center[0] + sim.mm(w1.type.bays_m[slot]);
      return [slot, { center: [x, center[1]], heading: 0, edge_mm: 20 }];
    }));
    for (let t = 0; t <= 1.5; t += 0.1) sim.observe(tags([700, 300]), t);
    const out = [sim.rolling.wagons.get(1).state];
    // the layout markers are covered: no pose, but the tags are still read
    a.tracker.H = null;
    a.rollingDetections = { 0: [[0, 0], [10, 0], [10, 10], [0, 10]], 1: [[20, 0], [30, 0], [30, 10], [20, 10]] };
    for (let t = 1.6; t <= 12; t += 0.1) {
      a.clock = t;
      a._observeRolling(false);
    }
    out.push(sim.rolling.wagons.get(1).state, w1.available);
    // the tags gone as well: lost
    a.rollingDetections = {};
    a.clock = 20;
    a._observeRolling(false);
    out.push(sim.rolling.wagons.get(1).state);
    return out;
  });
  expect(states).toEqual(["standing", "held", true, "lost"]);
  expect(errors).toEqual([]);
});

test("Build does not take the rolling-stock marker type for the layout", async ({ page }) => {
  const errors = await openTerminal(page);
  await page.locator("#tab-build").click();
  const select = page.locator("#layoutDictionary");
  await expect(select).toHaveValue("ARUCO");
  await select.selectOption("APRILTAG_36h11");
  await expect(page.locator("#toast")).toContainText("AprilTag 36h11 is the marker type of the rolling-stock markers");
  await expect(select).toHaveValue("ARUCO");
  expect(await page.evaluate(() => window.__arail.world.layout.markers.dictionary)).toBe("ARUCO");
  // another type is taken
  await select.selectOption("ARUCO_MIP_36h12");
  await expect.poll(() => page.evaluate(() => window.__arail.world.layout.markers.dictionary)).toBe("ARUCO_MIP_36h12");
  expect(errors).toEqual([]);
});

test("a train is called; a container goes from train to train; unload and load", async ({ page }) => {
  const errors = await openTerminal(page);
  await setSpeed(page, 30);
  await page.locator(".term-board .stop[data-id=KT52]").getByRole("button", { name: "Call" }).click();
  await expect(page.locator(".term-board .stop[data-id=KT52] .status")).toContainText("approaching Loading track 2");
  await page.waitForFunction(() => window.__arail.terminal.sim.visits.get("KT52").state === "positioned", null, { timeout: 60_000 });
  await expect(page.locator(".term-board .stop[data-id=KT52] .status")).toHaveText("at Loading track 2");
  await chooseInList(page, "ARLU 100002 4");
  const value = await page.evaluate(() => {
    const t = window.__arail.terminal.sim.targets("ARLU 100002 4").ok.find((x) => x.carrier.startsWith("KT52/"));
    return `${t.at.carrier}|${t.at.bay}|${t.at.row}|${t.at.tier}`;
  });
  await page.locator("#termTarget").selectOption(value);
  await page.locator("#termMove").click();
  await page.waitForFunction(() => /^KT52\//.test(window.__arail.terminal.sim.inventory.get("ARLU 100002 4").at?.carrier || ""), null, { timeout: 60_000 });
  // bulk moves: the results are toasted
  await page.locator(".term-board .stop[data-id=BG1]").getByRole("button", { name: "Unload to yard" }).click();
  await expect(page.locator("#toast")).toContainText(/\d+ moves? queued/);
  // paused, the moves stay queued (cranes start them in a simulation step)
  const kt52 = page.locator(".term-board .stop[data-id=KT52]");
  await page.evaluate(() => (window.__arail.world.paused = true));
  await kt52.getByRole("button", { name: "Load from yard" }).click();
  await expect(page.locator("#toast")).toContainText(/\d+ moves? queued/);
  // a train with queued moves leaves only when forced
  await kt52.getByRole("button", { name: "Depart", exact: true }).click();
  await expect(kt52.locator(".status")).toContainText(/still has \d+ moves?/);
  await expect(kt52.getByRole("button", { name: "Depart anyway" })).toBeVisible();
  // once a crane works on it, the card says so, with the moves still waiting
  await page.evaluate(() => (window.__arail.world.paused = false));
  await page.waitForFunction(() => {
    const a = window.__arail, busy = a.terminal.sim.moves.some((m) => m.state === "active" && m.to.carrier.startsWith("KT52/"));
    if (busy) a.world.paused = true; // keep the crane at work
    return busy;
  }, null, { timeout: 60_000, polling: "raf" });
  await expect(kt52.locator(".status")).toContainText(/^A crane is working on KT 52 Duisburg; \d+ more moves? waiting$/);
  // the count follows the moves: one cancelled in Crane jobs
  const waiting = () => page.evaluate(() => window.__arail.terminal.sim.moves.filter((m) => m.state === "queued" && m.to.carrier.startsWith("KT52/")).length);
  const before = await waiting();
  expect(before).toBeGreaterThan(1);
  await page.locator(".term-jobs tr[data-state=queued]").last().getByRole("button", { name: /^Cancel/ }).click();
  expect(await waiting()).toBe(before - 1);
  await expect(kt52.locator(".status")).toContainText(before - 1 === 1 ? "1 more move waiting" : `${before - 1} more moves waiting`);
  // Depart anyway: the waiting moves are cancelled; the train leaves once the crane is done
  await kt52.getByRole("button", { name: "Depart anyway" }).click();
  await expect(page.locator("#toast")).toContainText("leaves once the crane is done");
  await expect(kt52.locator(".status")).toHaveText("leaving once the crane is done");
  await expect(kt52.getByRole("button")).toHaveCount(0);
  expect(await waiting()).toBe(0);
  await page.evaluate(() => (window.__arail.world.paused = false));
  await page.waitForFunction(() => window.__arail.terminal.sim.visits.get("KT52").state !== "positioned", null, { timeout: 60_000 });
  await expect(kt52.locator(".status")).toHaveText(/^(departing|away)$/);
  expect(await page.evaluate(() => window.__arail.terminal.sim.inventory.check())).toEqual([]);
  expect(errors).toEqual([]);
});

test("trucks: a pickup truck leaves with its container; a delivered container goes to the yard", async ({ page }) => {
  const errors = await openTerminal(page);
  await setSpeed(page, 30);
  await page.locator("#termTruckPurpose").selectOption("pickup");
  await page.locator("#termSendTruck").click();
  await page.waitForFunction(() => window.__arail.terminal.sim.visits.get("T1")?.state === "positioned", null, { timeout: 60_000 });
  await expect(page.locator(".term-board .stop[data-id=T1] .status")).toContainText("at position");
  await chooseInList(page, "ARLU 100003 0");
  await page.getByRole("button", { name: "To a truck" }).click();
  await expect(page.locator("#toast")).toContainText("to Truck T1");
  // loaded, the truck drives off: the container leaves the terminal with it
  await page.waitForFunction(() => !window.__arail.terminal.sim.visits.has("T1"), null, { timeout: 90_000 });
  expect(await carrierOf(page, "ARLU 100003 0")).toBeUndefined();
  // a delivery truck brings a container
  await page.locator("#termTruckPurpose").selectOption("delivery");
  await page.locator("#termTruckSize").selectOption("40");
  await page.locator("#termSendTruck").click();
  await page.waitForFunction(() => window.__arail.terminal.sim.visits.get("T2")?.state === "positioned", null, { timeout: 60_000 });
  const id = await page.evaluate(() => window.__arail.terminal.sim.inventory.on("T2")[0].id);
  await chooseInList(page, id);
  await page.getByRole("button", { name: "To the yard" }).click();
  await page.waitForFunction((c) => window.__arail.terminal.sim.inventory.get(c)?.at?.carrier === "yard-a", id, { timeout: 60_000 });
  expect(errors).toEqual([]);
});

test("picking on the canvas in the flyover: a container, then a highlighted place", async ({ page }) => {
  const errors = await openTerminal(page);
  await lookDownAt(page, [900, 380]);
  const box = await boxPoint(page, { id: "ARLU 100001 9" });
  await page.mouse.click(box.x, box.y);
  await expect(page.locator("#placing")).toBeVisible();
  await expect(page.locator("#placing")).toContainText("Move ARLU 100001 9 (40 ft)");
  expect(await page.evaluate(() => [window.__arail.terminal.selected, window.__arail.terminal.stage])).toEqual(["ARLU 100001 9", "target"]);
  // the targets are highlighted
  expect(await page.evaluate(() => window.__arail.terminal.sim.highlight.targets.length)).toBeGreaterThan(3);
  const place = await boxPoint(page, { target: "yard-a" });
  await page.mouse.click(place.x, place.y);
  await expect(page.locator("#toast")).toContainText("Move M1 queued");
  await expect(page.locator("#placing")).toBeHidden();
  const move = await page.evaluate(() => window.__arail.terminal.sim.moves[0]);
  expect(move.container).toBe("ARLU 100001 9");
  expect(move.to.carrier).toBe("yard-a");
  expect(errors).toEqual([]);
});

test("Escape ends a pick on the canvas", async ({ page }) => {
  const errors = await openTerminal(page);
  await lookDownAt(page, [900, 380]);
  const box = await boxPoint(page, { id: "ARLU 100004 5" });
  await page.mouse.click(box.x, box.y);
  await expect(page.locator("#placing")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#placing")).toBeHidden();
  expect(await page.evaluate(() => [window.__arail.terminal.stage, window.__arail.terminal.sim.highlight.targets])).toEqual([null, null]);
  expect(await page.evaluate(() => window.__arail.terminal.sim.moves.length)).toBe(0);
  // a second Escape clears the selection
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.__arail.terminal.selected)).toBeNull();
  expect(errors).toEqual([]);
});

test("Enter on the stage picks at the cross in the middle", async ({ page }) => {
  const errors = await openTerminal(page);
  await lookDownAt(page, [900, 380]);
  const { center } = await boxPoint(page, { id: "ARLU 100001 9" });
  await lookDownAt(page, center);
  await page.locator("#stage").focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => [window.__arail.terminal.selected, window.__arail.terminal.stage])).toEqual(["ARLU 100001 9", "target"]);
  await expect(page.locator("#placing")).toContainText("Enter picks at the cross");
  // aim at a place in the yard and press Enter again
  const target = await page.evaluate(() => window.__arail.terminal.sim.targets("ARLU 100001 9").ok.find((t) => t.carrier === "yard-a"));
  const place = await page.evaluate((t) => window.__arail.terminal.sim.targetBoxes("ARLU 100001 9", window.__arail.lastView)
    .find((x) => x.target.carrier === t.carrier && x.target.at.bay === t.at.bay && x.target.at.row === t.at.row).box.center, target);
  await lookDownAt(page, place);
  await page.keyboard.press("Enter");
  await expect(page.locator("#toast")).toContainText("Move M1 queued");
  const move = await page.evaluate(() => window.__arail.terminal.sim.moves[0]);
  expect(move.to).toEqual(target.at);
  expect(errors).toEqual([]);
});

test("Save as start state: the moved container stays where it is after a reload", async ({ page }) => {
  const errors = await openTerminal(page);
  await setSpeed(page, 30);
  await chooseInList(page, "ARLU 100001 9");
  await page.getByRole("button", { name: "To the yard" }).click();
  await page.waitForFunction(() => window.__arail.terminal.sim.inventory.get("ARLU 100001 9").at?.carrier === "yard-a", null, { timeout: 60_000 });
  await page.getByRole("button", { name: "Save as start state" }).click();
  await expect(page.locator("#toast")).toContainText("Start state saved");
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith("arail.layout:") && localStorage.getItem(k).includes("yard-a")));
  await page.reload();
  await page.waitForFunction(() => window.__arail?.terminal.sim && window.__arail.mode === "flyover", null, { timeout: 30_000 });
  expect(await carrierOf(page, "ARLU 100001 9")).toBe("yard-a");
  expect(errors).toEqual([]);
});

test("a layout without a terminal: open the example or add a terminal", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/app/#terminal");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/app/#terminal");
  await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
  await expect(page.locator("#panel-terminal")).toContainText("This layout has no container terminal.");
  // adding one: the panel of an (empty) terminal
  await page.getByRole("button", { name: "Add a container terminal to this layout" }).click();
  await expect(page.locator("#panel-terminal h2").first()).toHaveText("Container terminal");
  await expect(page.locator("#hud")).toContainText("Terminal · 0 moves");
  // the example from a layout without a terminal
  await page.evaluate(() => window.__arail.resetLayout());
  await expect(page.getByRole("button", { name: "Open the example terminal" })).toBeVisible();
  await page.getByRole("button", { name: "Open the example terminal" }).click();
  await page.waitForFunction(() => window.__arail.mode === "flyover" && window.__arail.terminal.sim?.name === "KV terminal", null, { timeout: 30_000 });
  // back to the lab photo: the flyover is left and the photo is shown again
  await page.selectOption("#exampleSelect", "../layouts/ebl-lab.json");
  await page.waitForFunction(() => window.__arail.mode === "camera" && window.__arail.tracker.state.H && !window.__arail.terminal.sim, null, { timeout: 30_000 });
  await expect(page.locator("#emptyStage")).toBeHidden();
  await expect(page.locator("#panel-terminal")).toContainText("This layout has no container terminal.");
  expect(errors).toEqual([]);
});

test("picking in the camera view: a yard block and a reach stacker added to the lab photo", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/app/#terminal");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/app/#terminal");
  await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
  // a yard block in the middle of the markers, half full, and a reach stacker beside it
  await page.evaluate(async () => {
    const a = window.__arail, json = a.world.toJSON(), ms = a.world.map.ids().map((id) => a.world.map.get(id));
    const c = [ms.reduce((s, m) => s + m.x, 0) / ms.length, ms.reduce((s, m) => s + m.y, 0) / ms.length];
    json.objects.push({ id: "yard-t", type: "container-yard", name: "Test block", position: c, width_mm: 476, depth_mm: 134, rotation_deg: 0, tiers: 2 });
    json.objects.push({ id: "rs-t", type: "reach-stacker", name: "Test stacker", position: [c[0], c[1] + 160] });
    json.simulations.push({ type: "terminal", fill: { "yard-t": 0.5 } });
    await a._applyLayout(json);
  });
  await page.waitForFunction(() => window.__arail.mode === "camera" && window.__arail.lastView && window.__arail.terminal.sim?.boxes(window.__arail.lastView).length, null, { timeout: 30_000 });
  // the topmost container of a stack, near the middle of the block
  const id = await page.evaluate(() => {
    const sim = window.__arail.terminal.sim, inv = sim.inventory;
    return sim.boxes(window.__arail.lastView).map((b) => inv.get(b.id)).filter((c) => !inv.canLift(c)).sort((p, q) => Math.abs(p.at.bay - 3) - Math.abs(q.at.bay - 3))[0].id;
  });
  const box = await boxPoint(page, { id });
  await page.mouse.click(box.x, box.y);
  await expect(page.locator("#placing")).toBeVisible();
  expect(await page.evaluate(() => [window.__arail.terminal.selected, window.__arail.terminal.stage])).toEqual([id, "target"]);
  const place = await boxPoint(page, { target: "yard-t" });
  await page.mouse.click(place.x, place.y);
  await expect(page.locator("#toast")).toContainText("queued: Test stacker");
  expect(await page.evaluate(() => window.__arail.terminal.sim.moves.map((m) => [m.container, m.to.carrier]))).toEqual([[id, "yard-t"]]);
  expect(errors).toEqual([]);
});

test("the morning shift scenario finishes its moves", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openTerminal(page);
  await page.locator("#tab-disrupt").click();
  await page.locator(".scenario[data-id=morning-shift]").getByRole("button", { name: "Play" }).click();
  await page.waitForFunction(() => window.__arail.world.scenarios.elapsed > 0 && window.__arail.world.speed === 10);
  await setSpeed(page, 30);
  await page.waitForFunction(() => {
    const m = window.__arail.terminal.sim.moves;
    return m.length >= 3 && m.every((x) => x.state === "done");
  }, null, { timeout: 120_000, polling: 500 });
  const where = await page.evaluate(() => {
    const inv = window.__arail.terminal.sim.inventory;
    return [inv.get("ARLU 100001 9")?.at?.carrier, inv.get("EBLU 300003 2")?.at?.carrier];
  });
  expect(where).toEqual(["yard-a", "KT52/1"]);
  expect(await page.evaluate(() => window.__arail.terminal.sim.inventory.check())).toEqual([]);
  expect(errors).toEqual([]);
});

test("on a phone the six tabs fit, or scroll with the selected tab in view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openTerminal(page);
  const tabs = () => page.evaluate(() => {
    const bar = document.querySelector(".tabs").getBoundingClientRect(), sel = document.querySelector(".tabs [aria-selected=true]").getBoundingClientRect();
    const all = [...document.querySelectorAll(".tabs button")].map((x) => x.getBoundingClientRect());
    return { fits: all.every((x) => x.left >= 0 && x.right <= innerWidth + 0.5), shown: sel.left >= bar.left - 0.5 && sel.right <= bar.right + 0.5 };
  });
  const names = ["view", "build", "simulate", "terminal", "disrupt", "control"];
  // 390 px: all six fit
  for (const tab of names) {
    await page.locator(`#tab-${tab}`).click();
    expect((await tabs()).fits, `#tab-${tab} at 390 px`).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // narrower: the tabs scroll, the selected one is kept in view (selected as the arrow keys do, without the browser scrolling it)
  await page.setViewportSize({ width: 300, height: 700 });
  for (const tab of [...names, ...names.slice().reverse()]) {
    await page.evaluate((t) => window.__arail.selectTab(t), tab);
    expect((await tabs()).shown, `#tab-${tab} at 300 px`).toBe(true);
  }
  expect(errors).toEqual([]);
});
