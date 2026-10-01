// The flyover: a virtual camera instead of the camera image, grid editing with snapping and
// table modules that extend the tabletop.
import AxeBuilder from "@axe-core/playwright";
import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

/** Collect uncaught page errors (console noise such as blocked web fonts is ignored). */
function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function openApp(page, path = "/app/") {
  const errors = trackErrors(page);
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
  return errors;
}

/** Switch the flyover on with the stage button and wait until it is drawn. */
async function enterFlyover(page) {
  await page.locator("#btnFlyover").click();
  await page.waitForFunction(() => window.__arail.mode === "flyover");
  await expect(page.locator("#btnFlyover")).toHaveAttribute("aria-pressed", "true");
}

/** Put the flyover camera into a known place (no animation). */
async function setCamera(page, state) {
  await page.evaluate((s) => {
    const f = window.__arail.flyover;
    f.anim = null;
    f.cam.set({ ...s, yaw: s.yaw_deg != null ? (s.yaw_deg * Math.PI) / 180 : undefined, pitch: s.pitch_deg != null ? (s.pitch_deg * Math.PI) / 180 : undefined });
  }, state);
}

/** Screen position (CSS px) of a layout point (mm) with the current pose (flyover or camera). */
async function screenPoint(page, x, y) {
  return page.evaluate(([px, py]) => {
    const a = window.__arail, H = a.pose().H;
    const w = H[6] * px + H[7] * py + H[8];
    const u = (H[0] * px + H[1] * py + H[2]) / w, v = (H[3] * px + H[4] * py + H[5]) / w;
    const r = a.canvas.getBoundingClientRect();
    return { x: r.left + (u * r.width) / a.canvas.width, y: r.top + (v * r.height) / a.canvas.height };
  }, [x, y]);
}

/** Distinct colours in a coarse sample of the canvas (a blank canvas has one). */
async function canvasColours(page) {
  return page.evaluate(() => {
    const a = window.__arail;
    a.render();
    const { width, height } = a.canvas, data = a.ctx.getImageData(0, 0, width, height).data, seen = new Set();
    for (let y = 5; y < height; y += 23) for (let x = 5; x < width; x += 23) {
      const i = (y * width + x) * 4;
      seen.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
    }
    return seen.size;
  });
}

test("flyover: switch on, it draws the layout, keyboard zoom, back to the camera image", async ({ page }) => {
  const errors = await openApp(page);
  const before = await page.evaluate(() => ({ w: window.__arail.canvas.width, h: window.__arail.canvas.height, H: window.__arail.tracker.state.H }));
  await enterFlyover(page);
  await expect(page.locator("#flyNav")).toBeVisible();
  await expect(page.locator("#hud")).toContainText("Flyover");
  await expect(page.locator("#hud")).toContainText("Grid 50 mm");
  expect(await canvasColours(page)).toBeGreaterThan(20);
  // the canvas fills the stage
  const box = await page.locator("#stage").boundingBox(), stage = await page.locator("#stageWrap").boundingBox();
  expect(Math.abs(box.width - stage.width)).toBeLessThan(2);
  expect(Math.abs(box.height - stage.height)).toBeLessThan(2);
  // keyboard: + zooms in, - zooms out, Q rotates (the stage has the focus after a click)
  await page.locator("#stage").click({ position: { x: 20, y: box.height - 20 } });
  const d0 = await page.evaluate(() => window.__arail.flyover.cam.distance);
  await page.keyboard.press("+");
  await expect.poll(() => page.evaluate(() => window.__arail.flyover.cam.distance)).toBeLessThan(d0 * 0.85);
  await page.keyboard.press("-");
  await page.keyboard.press("-");
  await expect.poll(() => page.evaluate(() => window.__arail.flyover.cam.distance)).toBeGreaterThan(d0 * 1.1);
  const yaw0 = await page.evaluate(() => window.__arail.flyover.cam.yaw);
  await page.keyboard.press("q");
  await expect.poll(() => page.evaluate((y) => window.__arail.flyover.cam.yaw - y, yaw0)).toBeGreaterThan(0.2);
  // plan view button
  await page.locator("#flyNav [data-fly=plan]").click();
  await expect(page.locator("#flyNav [data-fly=plan]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#hud")).toContainText("plan view");
  // F: back to the camera image with its tracking
  await page.keyboard.press("f");
  await page.waitForFunction(() => window.__arail.mode === "camera");
  await expect(page.locator("#flyNav")).toBeHidden();
  const after = await page.evaluate(() => ({ w: window.__arail.canvas.width, h: window.__arail.canvas.height, H: window.__arail.tracker.state.H }));
  expect(after).toEqual(before);
  await expect(page.locator("#hud")).toContainText("Tracking");
  expect(errors).toEqual([]);
});

test("flyover navigation: drag to orbit, Shift-drag to pan, wheel to zoom, pinch and twist", async ({ page }) => {
  const errors = await openApp(page);
  await enterFlyover(page);
  await setCamera(page, { target: [600, 100], distance: 1800, yaw_deg: 90, pitch_deg: 50 });
  const cam = () => page.evaluate(() => window.__arail.flyover.cam.toJSON());
  const box = await page.locator("#stage").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  // drag: orbit
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 120, cy + 40, { steps: 6 });
  await page.mouse.up();
  let c = await cam();
  expect(c.yaw_deg).toBeGreaterThan(110);
  expect(c.pitch_deg).toBeGreaterThan(50);
  // Shift-drag: pan, the grabbed point stays under the pointer
  const grabbed = await page.evaluate(([x, y]) => {
    const a = window.__arail, r = a.canvas.getBoundingClientRect();
    return a.flyover.groundPoint(((x - r.left) * a.canvas.width) / r.width, ((y - r.top) * a.canvas.height) / r.height);
  }, [cx, cy]);
  await page.keyboard.down("Shift");
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 150, cy - 60, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const now = await screenPoint(page, grabbed[0], grabbed[1]);
  expect(Math.abs(now.x - (cx + 150))).toBeLessThan(1.5);
  expect(Math.abs(now.y - (cy - 60))).toBeLessThan(1.5);
  // the wheel zooms towards the pointer
  const d0 = (await cam()).distance_mm;
  await page.mouse.move(cx - 100, cy + 50);
  await page.mouse.wheel(0, -500);
  await expect.poll(async () => (await cam()).distance_mm).toBeLessThan(d0 * 0.6);
  // two fingers: spreading them zooms in, turning them turns the view
  const d1 = (await cam()).distance_mm, yaw1 = (await cam()).yaw_deg;
  await page.evaluate(([x, y]) => {
    const c = window.__arail.canvas;
    const ev = (type, id, px, py) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: id === 11, clientX: px, clientY: py, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true }));
    ev("pointerdown", 11, x - 50, y);
    ev("pointerdown", 12, x + 50, y);
    ev("pointermove", 12, x + 50, y + 100); // spread and turn by 45°
    ev("pointermove", 11, x - 50, y);
    ev("pointerup", 12, x + 50, y + 100);
    ev("pointerup", 11, x - 50, y);
  }, [cx, cy]);
  c = await cam();
  expect(c.distance_mm).toBeLessThan(d1 * 0.85);
  expect(Math.abs(((c.yaw_deg - yaw1 + 540) % 360) - 180)).toBeGreaterThan(20);
  // the camera is kept for this layout
  await page.waitForTimeout(600);
  const saved = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("arail.flycam:")));
  expect(saved.length).toBe(1);
  expect(errors).toEqual([]);
});

test("flyover build: a table module by two taps on the grid, dragging snaps, R turns", async ({ page }) => {
  const errors = await openApp(page, "/app/#build");
  await enterFlyover(page);
  await setCamera(page, { target: [2000, 100], distance: 3000, yaw_deg: 90, pitch_deg: 90 });
  await page.waitForTimeout(100);
  const palette = page.locator(".palette");
  await expect(palette.getByRole("heading", { name: "Table" })).toBeVisible();
  await palette.getByRole("button", { name: /^Table module/ }).click();
  await expect(page.locator("#placing")).toContainText("snap to the 50 mm grid");
  const before = await page.evaluate(() => window.__arail.world.objects.length);
  // two taps, off the grid, beside the real table (x up to 1870 mm): the corners snap to (2050, -400) and (2800, 600)
  for (const [x, y] of [[2063, -388], [2787, 612]]) {
    const p = await screenPoint(page, x, y);
    await page.mouse.click(p.x, p.y);
  }
  await page.waitForFunction((n) => window.__arail.world.objects.length === n + 1, before);
  const table = await page.evaluate(() => window.__arail.editor.selected.toJSON());
  expect(table).toMatchObject({ type: "tabletop", position: [2425, 100], width_mm: 750, depth_mm: 1000, rotation_deg: 0 });
  // drag an object (the windmill in the fields of the example town): its position snaps to the grid
  await page.evaluate(() => window.__arail.editor.select(null));
  await setCamera(page, { target: [300, -2100], distance: 2000, yaw_deg: 90, pitch_deg: 90 });
  const start = await page.evaluate(() => window.__arail.world.getObject("windmill-1").spec.position);
  const from = await screenPoint(page, start[0], start[1]);
  const to = await screenPoint(page, start[0] + 237, start[1] - 141);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  const moved = await page.evaluate(() => window.__arail.world.getObject("windmill-1").spec.position);
  expect(Math.abs(moved[0] % 50)).toBe(0);
  expect(Math.abs(moved[1] % 50)).toBe(0);
  expect(Math.abs(moved[0] - (start[0] + 237))).toBeLessThanOrEqual(25);
  expect(Math.abs(moved[1] - (start[1] - 141))).toBeLessThanOrEqual(25);
  // ... and freely with Alt held
  const from2 = await screenPoint(page, moved[0], moved[1]), to2 = await screenPoint(page, moved[0] + 13, moved[1] + 7);
  await page.keyboard.down("Alt");
  await page.mouse.move(from2.x, from2.y);
  await page.mouse.down();
  await page.mouse.move(to2.x, to2.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  const free = await page.evaluate(() => window.__arail.world.getObject("windmill-1").spec.position);
  expect(Math.abs(free[0] - moved[0] - 13)).toBeLessThan(2);
  expect(Math.abs(free[1] - moved[1] - 7)).toBeLessThan(2);
  // turn the selected object: R by 15°, the inspector button by 90°
  const rot0 = await page.evaluate(() => window.__arail.editor.selected.spec.rotation_deg);
  await page.locator("#stage").focus();
  await page.keyboard.press("r");
  await expect.poll(() => page.evaluate(() => window.__arail.editor.selected.spec.rotation_deg)).toBeCloseTo(rot0 + 15, 5);
  await page.getByRole("button", { name: "90° clockwise" }).click();
  await expect.poll(() => page.evaluate(() => window.__arail.editor.selected.spec.rotation_deg)).toBeCloseTo(rot0 - 75, 5);
  // the table module is saved with the layout and drawn: its middle shows the table colour
  await page.evaluate(() => window.__arail.editor.select(null));
  await setCamera(page, { target: [2000, 100], distance: 3000, yaw_deg: 90, pitch_deg: 90 });
  const colour = await page.evaluate(() => {
    const a = window.__arail;
    a.render();
    const H = a.pose().H, [x, y] = [2212, 313]; // between grid lines
    const w = H[6] * x + H[7] * y + H[8], u = Math.round((H[0] * x + H[1] * y + H[2]) / w), v = Math.round((H[3] * x + H[4] * y + H[5]) / w);
    return [...a.ctx.getImageData(u, v, 1, 1).data].slice(0, 3);
  });
  expect(colour).toEqual([220, 222, 220]); // TABLE_SURFACES.grey.top
  await page.waitForTimeout(400);
  const saved = await page.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith("arail.layout:"))?.[1]);
  expect(JSON.parse(saved).objects.some((o) => o.type === "tabletop" && o.width_mm === 750)).toBe(true);
  expect(errors).toEqual([]);
});

test("flyover build: drag out a table module; tables are picked at their edges, a drag inside pans", async ({ page }) => {
  const errors = await openApp(page, "/app/#build");
  await enterFlyover(page);
  await setCamera(page, { target: [1700, 100], distance: 3200, yaw_deg: 90, pitch_deg: 90 });
  await page.locator(".palette").getByRole("button", { name: /^Table module/ }).click();
  const a = await screenPoint(page, 2110, -390), b = await screenPoint(page, 2690, 390);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__arail.editor.selected?.type === "tabletop");
  const added = await page.evaluate(() => window.__arail.editor.selected.toJSON());
  expect(added).toMatchObject({ position: [2400, 0], width_mm: 600, depth_mm: 800 });
  await page.evaluate(() => window.__arail.editor.select(null));
  // a drag inside the (unselected) table pans the view
  const t0 = await page.evaluate(() => window.__arail.flyover.cam.target);
  const c = await screenPoint(page, 2400, 0);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x - 80, c.y, { steps: 4 });
  await page.mouse.up();
  const t1 = await page.evaluate(() => window.__arail.flyover.cam.target);
  expect(t1[0]).toBeGreaterThan(t0[0] + 50);
  expect(await page.evaluate((id) => window.__arail.world.getObject(id).spec.position, added.id)).toEqual([2400, 0]); // not moved
  // a tap at its edge selects it
  const edge = await screenPoint(page, 2700, 0);
  await page.mouse.click(edge.x, edge.y);
  await expect.poll(() => page.evaluate(() => window.__arail.editor.selected?.type)).toBe("tabletop");
  expect(errors).toEqual([]);
});

test("camera view: a table module dragged out over the camera image covers it (no grid, no snapping)", async ({ page }) => {
  const errors = await openApp(page, "/app/#build");
  await page.locator(".palette").getByRole("button", { name: /^Table module/ }).click();
  const a = await screenPoint(page, 547, -153), b = await screenPoint(page, 813, -31);
  const box = await page.locator("#stage").boundingBox();
  for (const p of [a, b]) expect(p.x > box.x && p.x < box.x + box.width && p.y > box.y && p.y < box.y + box.height - 80).toBe(true); // above the placing bar
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__arail.editor.selected?.type === "tabletop");
  const spec = await page.evaluate(() => window.__arail.editor.selected.toJSON());
  expect(spec.position[0]).toBeCloseTo(680, -1);
  expect(spec.position[1]).toBeCloseTo(-92, -1);
  expect(spec.width_mm).toBeCloseTo(266, -1);
  expect(spec.depth_mm).toBeCloseTo(122, -1);
  expect(spec.width_mm % 50).not.toBe(0); // not snapped: the grid is off over the camera image
  await page.evaluate(() => window.__arail.editor.select(null));
  const colour = await page.evaluate(() => {
    const a = window.__arail;
    a.render();
    const H = a.pose().H, [x, y] = [680, -92];
    const w = H[6] * x + H[7] * y + H[8], u = Math.round((H[0] * x + H[1] * y + H[2]) / w), v = Math.round((H[3] * x + H[4] * y + H[5]) / w);
    return [...a.ctx.getImageData(u, v, 1, 1).data].slice(0, 3);
  });
  [220, 222, 220].forEach((c, i) => expect(Math.abs(colour[i] - c)).toBeLessThan(16)); // the extension, nearly opaque
  expect(errors).toEqual([]);
});

test("the outline of a real table is picked in the flyover only (over the camera image it is not drawn)", async ({ page }) => {
  const errors = await openApp(page, "/app/#build");
  await page.evaluate(() => {
    const a = window.__arail;
    a.world.addObject({ id: "real-table", type: "tabletop", kind: "physical", position: [700, -200], width_mm: 1800, depth_mm: 1000 });
    a.editor.select(null);
  });
  const drag = async () => {
    const p = await screenPoint(page, 400, 300); // on its far edge (y = 300)
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x - 60, p.y - 20, { steps: 5 });
    await page.mouse.up();
    return page.evaluate(() => ({ selected: window.__arail.editor.selected?.id ?? null, position: window.__arail.world.getObject("real-table").spec.position }));
  };
  expect(await drag()).toEqual({ selected: null, position: [700, -200] });
  await enterFlyover(page);
  await setCamera(page, { target: [700, -200], distance: 3000, yaw_deg: 90, pitch_deg: 90 });
  await page.waitForTimeout(100);
  expect((await drag()).selected).toBe("real-table");
  expect(errors).toEqual([]);
});

test("View panel: grid spacing and snapping, markers; the camera view shows the grid on request", async ({ page }) => {
  const errors = await openApp(page, "/app/#view");
  await page.locator("#btnFlyoverPanel").click();
  await page.waitForFunction(() => window.__arail.mode === "flyover");
  await expect(page.locator("#btnFlyoverPanel")).toHaveAttribute("aria-pressed", "true");
  await page.selectOption("#gridSize", "25");
  expect(await page.evaluate(() => window.__arail.world.layout.grid.size_mm)).toBe(25);
  await expect(page.locator("#hud")).toContainText("Grid 25 mm");
  await page.locator("#optSnap").uncheck();
  expect(await page.evaluate(() => window.__arail.world.toJSON().grid)).toEqual({ size_mm: 25, snap: false });
  await page.locator(".fly-buttons").getByRole("button", { name: "Zoom in" }).click();
  await page.locator("#optFlyMarkers").uncheck();
  expect(await page.evaluate(() => window.__arail.display.flyMarkers)).toBe(false);
  await page.locator("#btnFlyoverPanel").click();
  await page.waitForFunction(() => window.__arail.mode === "camera");
  // grid over the camera image: snapping works there too
  expect(await page.evaluate(() => window.__arail.gridVisible())).toBe(false);
  await page.locator("#optGridCamera").check();
  expect(await page.evaluate(() => window.__arail.gridVisible())).toBe(true);
  expect(await canvasColours(page)).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test("the orthophoto of the table is drawn in perspective; night darkens the flyover", async ({ page }) => {
  const errors = await openApp(page);
  // a test photo: left half pure red with its bottom quarter green, right half pure blue
  await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 200;
    const g = c.getContext("2d");
    g.fillStyle = "#ff0000";
    g.fillRect(0, 0, 200, 200);
    g.fillStyle = "#00ff00";
    g.fillRect(0, 150, 200, 50);
    g.fillStyle = "#0000ff";
    g.fillRect(200, 0, 200, 200);
    const a = window.__arail;
    a.world.layout.view = { ...a.world.layout.view, ortho: { image: c.toDataURL("image/png"), bounds_mm: [-200, -400, 1600, 600] } };
    a.display.flyMarkers = false;
  });
  await enterFlyover(page);
  await setCamera(page, { target: [700, 100], distance: 2600, yaw_deg: 90, pitch_deg: 35 });
  const sample = (x, y) => page.evaluate(([px, py]) => {
    const a = window.__arail;
    a.world.settings.labels = false;
    a.render();
    const H = a.pose().H, w = H[6] * px + H[7] * py + H[8];
    const u = Math.round((H[0] * px + H[1] * py + H[2]) / w), v = Math.round((H[3] * px + H[4] * py + H[5]) / w);
    return [...a.ctx.getImageData(u, v, 1, 1).data].slice(0, 3);
  }, [x, y]);
  await expect.poll(() => sample(163, 337)).toEqual([255, 0, 0]); // left half (x < 700), between grid lines, away from objects
  expect(await sample(1313, 337)).toEqual([0, 0, 255]); // right half, on the table (the example town is in front of it, y < -320)
  // row 0 of the image is at ymax: its bottom quarter (y < -150) lies at the front of the table
  expect(await sample(575, -225)).toEqual([0, 255, 0]);
  // at night the photo is darker, too
  await page.evaluate(() => window.__arail.world.setTime("23:30"));
  const night = await sample(163, 337);
  expect(night[0]).toBeLessThan(140);
  expect(errors).toEqual([]);
});

test("the video survey works in the flyover: markers appear on the table", async ({ page }) => {
  const VIDEO = "tests/fixtures/synthetic-survey.webm";
  test.skip(!existsSync(VIDEO), "run `npm run fixtures` first");
  const errors = await openApp(page, "/app/?layout=../layouts/synthetic-demo.json#build");
  await page.waitForFunction(() => window.__arail.world.layout.name === "Synthetic test layout" && window.__arail.tracker.state.H);
  await page.evaluate(() => window.__arail.tracker.resurvey());
  await enterFlyover(page);
  await page.locator("#surveyVideo").setInputFiles(VIDEO);
  await expect(page.locator(".survey [role=status]")).toContainText("done", { timeout: 60_000 });
  expect(await page.evaluate(() => window.__arail.world.map.ids().length)).toBe(8);
  expect(await page.evaluate(() => window.__arail.mode)).toBe("flyover");
  expect(await canvasColours(page)).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test("dragging a line or an outline drawn on the grid keeps its points on the grid", async ({ page }) => {
  const errors = await openApp(page, "/app/#build");
  await enterFlyover(page);
  await setCamera(page, { target: [2100, -800], distance: 1600, yaw_deg: 90, pitch_deg: 90 });
  // an area beside the table, drawn on the 50 mm grid (its centre is not on the grid)
  await page.evaluate(() => window.__arail.world.addObject({ id: "area-grid", type: "area", points: [[2000, -900], [2250, -900], [2250, -750], [2000, -700]] }));
  const from = await screenPoint(page, 2120, -810), to = await screenPoint(page, 2120 + 113, -810 + 71);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  const points = await page.evaluate(() => window.__arail.world.getObject("area-grid").spec.points);
  for (const p of points) for (const v of p) expect(Math.abs(v % 50)).toBe(0);
  expect(points[0]).toEqual([2100, -850]); // moved by about (113, 71), its first corner on the grid
  expect(errors).toEqual([]);
});

test("a bus stop dragged across its street follows the pointer (its position snaps, not the point on the street)", async ({ page }) => {
  const errors = await openApp(page, "/app/#build");
  await enterFlyover(page);
  await setCamera(page, { target: [650, -760], distance: 1500, yaw_deg: 0, pitch_deg: 90 });
  // Altmarkt on Schulstraße (x = 650): 60 mm towards the east, across the street, in small steps
  const from = await screenPoint(page, 650, -760), to = await screenPoint(page, 710, -760);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  const stop = await page.evaluate(() => {
    const o = window.__arail.world.getObject("bus-stop-altmarkt");
    return { position: o.spec.position, road: o.geometry.road };
  });
  expect(Math.abs(stop.position[0] - 710)).toBeLessThanOrEqual(25); // on the grid next to the pointer, not hundreds of mm beyond
  expect(Math.abs(stop.position[1] + 760)).toBeLessThanOrEqual(25);
  expect(stop.road).toBe("road-schulstrasse");
  expect(errors).toEqual([]);
});

test("flyover keys: + and − zoom by the same step, also when + needs Shift", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); // camera moves are immediate
  const errors = await openApp(page);
  await enterFlyover(page);
  await page.locator("#stage").focus();
  const step = async (key) => {
    const d0 = await page.evaluate(() => window.__arail.flyover.cam.distance);
    await page.keyboard.press(key);
    return d0 / (await page.evaluate(() => window.__arail.flyover.cam.distance));
  };
  expect(await step("Shift+Equal")).toBeCloseTo(1.25, 3); // "+" on a US keyboard
  expect(await step("Minus")).toBeCloseTo(0.8, 3);
  expect(await step("Shift+Minus")).toBeCloseTo(0.8, 3); // "_"
  expect(errors).toEqual([]);
});

test("a broken orthophoto entry does not stop the flyover from drawing", async ({ page }) => {
  const errors = await openApp(page);
  const failed = [];
  page.on("console", (m) => m.type() === "error" && /Frame failed/.test(m.text()) && failed.push(m.text()));
  await page.evaluate(() => {
    const a = window.__arail;
    a.world.layout.view = { ...a.world.layout.view, ortho: { image: "http://[not-a-url", bounds_mm: [-200, -400, 1600, 600] } };
  });
  await enterFlyover(page);
  await expect(page.locator("#toast")).toContainText("could not be loaded");
  await page.waitForTimeout(300);
  expect(failed).toEqual([]);
  expect(await canvasColours(page)).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test("keyboard: the Flyover toggle in the View panel and the rotate buttons keep the focus", async ({ page }) => {
  const errors = await openApp(page, "/app/#view");
  await page.locator("#btnFlyoverPanel").focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__arail.mode === "flyover");
  await expect(page.locator("#btnFlyoverPanel")).toBeFocused();
  await expect(page.locator("#btnFlyoverPanel")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__arail.mode === "camera");
  await expect(page.locator("#btnFlyoverPanel")).toBeFocused();
  // Build: turn the selected house twice with the keyboard
  await page.locator("#tab-build").click();
  await page.evaluate(() => window.__arail.editor.select(window.__arail.world.getObject("building-1")));
  const rot0 = await page.evaluate(() => window.__arail.editor.selected.spec.rotation_deg || 0);
  const button = page.getByRole("button", { name: "90° clockwise" });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  const rot = await page.evaluate(() => window.__arail.editor.selected.spec.rotation_deg);
  expect(Math.abs((((rot - rot0 + 180) % 360) + 360) % 360 - 180)).toBeCloseTo(180, 5);
  expect(errors).toEqual([]);
});

test("flyover keys only while the stage has the focus: F focuses it, scroll keys elsewhere are left alone", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await openApp(page, "/app/#view");
  await page.locator("#panel-view .hint").first().click(); // nothing focused
  await page.keyboard.press("f");
  await page.waitForFunction(() => window.__arail.mode === "flyover");
  await expect(page.locator("#stage")).toBeFocused();
  const cam = () => page.evaluate(() => window.__arail.flyover.cam.toJSON());
  const c0 = await cam();
  await page.keyboard.press("ArrowUp");
  expect((await cam()).target).not.toEqual(c0.target);
  // a click on text in the panel: Page Down and the arrows do not move the camera
  await page.locator("#panel-view .hint").first().click();
  const c1 = await cam();
  for (const key of ["PageDown", "ArrowDown", "Home", "+"]) await page.keyboard.press(key);
  expect(await cam()).toEqual(c1);
  expect(errors).toEqual([]);
});

test("without an image, the message of the empty stage comes back after the flyover", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/app/?layout=../layouts/not-there.json");
  await page.waitForFunction(() => window.__arail?.world);
  expect(await page.evaluate(() => window.__arail.source)).toBeNull();
  await page.evaluate(() => window.__arail.showEmpty("No image yet: take a photo or open a file."));
  await enterFlyover(page);
  await expect(page.locator("#emptyStage")).toBeHidden();
  await page.locator("#btnFlyover").click();
  await page.waitForFunction(() => window.__arail.mode === "camera");
  await expect(page.locator("#emptyStage")).toBeVisible();
  expect(errors).toEqual([]);
});

for (const scheme of ["light", "dark"]) {
  test(`the flyover has no accessibility violations (${scheme} mode)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page, "/app/#view");
    await enterFlyover(page);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`);
    expect(summary).toEqual([]);
    // the Build panel with the rotation buttons of a selected object
    await page.locator("#tab-build").click();
    await page.evaluate(() => window.__arail.editor.select(window.__arail.world.getObject("building-1")));
    const build = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
    expect(build.violations.map((v) => v.id)).toEqual([]);
  });
}
