// End-to-end tests of the app in a real browser (Chromium).
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { SCENE, SCENE_VIDEO, hasScene, routeScene } from "./scene.js";

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

/** Screen position (CSS px) of a layout point (mm). */
async function screenPoint(page, x, y) {
  return page.evaluate(([px, py]) => {
    const a = window.__arail, H = a.tracker.state.H;
    const w = H[6] * px + H[7] * py + H[8];
    const u = (H[0] * px + H[1] * py + H[2]) / w, v = (H[3] * px + H[4] * py + H[5]) / w;
    const r = a.canvas.getBoundingClientRect();
    return { x: r.left + (u * r.width) / a.canvas.width, y: r.top + (v * r.height) / a.canvas.height };
  }, [x, y]);
}

test("the lab example is tracked and passengers appear", async ({ page }) => {
  const errors = await openApp(page);
  const state = await page.evaluate(() => window.__arail.tracker.state);
  expect(state.used.length).toBeGreaterThanOrEqual(4);
  await expect(page.locator("#hud")).toContainText("Tracking");
  await page.waitForFunction(() => {
    const sim = window.__arail.world.simulations.find((s) => s.constructor.type === "passengers");
    return [...sim.crowds.values()].reduce((n, c) => n + c.people.length, 0) > 5;
  });
  const types = await page.evaluate(() => window.__arail.world.objects.map((o) => o.type));
  expect(types).toContain("windmill"); // example plugin loaded
  expect(errors).toEqual([]);
});

test("build: place, edit and delete a building", async ({ page }) => {
  const errors = await openApp(page, "/app/#build");
  const before = await page.evaluate(() => window.__arail.world.objects.length);
  await page.getByRole("button", { name: /^Building/ }).click();
  await expect(page.locator("#placing")).toBeVisible();
  const p = await screenPoint(page, 850, 490);
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction((n) => window.__arail.world.objects.length === n + 1, before);
  const added = await page.evaluate(() => window.__arail.editor.selected.spec);
  expect(added.type).toBe("building");
  expect(added.position[0]).toBeCloseTo(850, -1);
  expect(added.position[1]).toBeCloseTo(490, -1);
  expect(added.rotation_deg).toBeCloseTo(1.5, 0); // aligned with the nearest platform
  const floors = page.locator(`#obj-${added.id}-floors`);
  await floors.fill("5");
  await floors.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__arail.editor.selected.spec.floors)).toBe(5);
  await page.getByRole("button", { name: "Delete" }).click();
  await expect.poll(() => page.evaluate(() => window.__arail.world.objects.length)).toBe(before);
  expect(errors).toEqual([]);
});

test("disruptions: start and stop a delay", async ({ page }) => {
  const errors = await openApp(page, "/app/#disrupt");
  await page.selectOption("#disType", "delay");
  await page.selectOption("#disTarget", "platform-1");
  await page.getByRole("button", { name: "Start: Delay" }).click();
  await expect(page.locator(".disruption")).toContainText("Delay · Platform 1");
  await expect(page.locator("#hud")).toContainText("1 disruption");
  await page.locator(".disruption").getByRole("button", { name: "Stop" }).click();
  await expect(page.locator(".disruption")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("control: the simulated control system reports trains", async ({ page }) => {
  const errors = await openApp(page, "/app/#control");
  await page.getByRole("button", { name: "Simulated control system" }).click();
  await page.waitForFunction(() => window.__arail.world.trains.active && window.__arail.world.trains.trains.size > 0);
  await expect(page.locator("#hud")).toContainText("Control system");
  const modes = await page.evaluate(() => [...window.__arail.world.services.docks.values()].filter((s) => s.dock.kind === "rail").map((s) => s.mode));
  expect(new Set(modes)).toEqual(new Set(["feed"]));
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.waitForFunction(() => !window.__arail.world.trains.active);
  expect(errors).toEqual([]);
});

test("a layout without a marker map is surveyed from its photo", async ({ page }) => {
  // the lab example as before it was surveyed: no marker known, the map open
  const lab = JSON.parse(readFileSync("web/layouts/ebl-lab.json", "utf8"));
  await page.route("**/layouts/lab-unsurveyed.json", (route) => route.fulfill({ json: { ...lab, name: "EBL lab, not surveyed", markers: { ...lab.markers, poses: {}, locked: false } } }));
  const errors = await openApp(page, "/app/?layout=../layouts/lab-unsurveyed.json");
  await expect(page.locator("#layoutName")).toHaveText("EBL lab, not surveyed");
  await page.waitForFunction(() => {
    const a = window.__arail;
    return a.tracker.state.H && [0, 1, 2, 3, 4].every((id) => a.world.map.has(id));
  });
  // every object is placed
  const [placed, total] = await page.evaluate(() => {
    const objects = window.__arail.world.objects;
    return [objects.filter((o) => o.geometry).length, objects.length];
  });
  expect(total).toBeGreaterThan(20);
  expect(placed).toBe(total);
  expect(errors).toEqual([]);
});

test("the lab examples: Bf Neustadt, the terminal at the crane and the hybrid container train", async ({ page }) => {
  const errors = await openApp(page, "/app/?example=neustadt");
  await expect(page.locator("#layoutName")).toHaveText("EBL Bf Neustadt and terminal (example)");
  await page.waitForFunction(() => window.__arail.tracker.state.used.length >= 6 && window.__arail.world.map.locked);
  // the same layout with the photo of the terminal: its own photo, the Terminal tab
  await page.selectOption("#exampleSelect", "crane-terminal");
  await page.waitForFunction(() => window.__arail.source?.name === "terminal at the crane" && window.__arail.tracker.state.used.includes(5));
  await expect(page.locator("#tab-terminal")).toHaveAttribute("aria-selected", "true");
  // the hybrid container train: model wagons from the tags in its photo, a harbour below the table
  await page.selectOption("#exampleSelect", "container-train");
  await expect(page.locator("#layoutName")).toHaveText("EBL hybrid container train (example)");
  const terminal = () => window.__arail.world.simulations.find((s) => typeof s.markerWagons === "function");
  await page.waitForFunction((fn) => {
    const t = new Function(`return (${fn})()`)();
    return t && t.markerWagons().filter((c) => c.present).length >= 5;
  }, terminal.toString());
  expect(await page.evaluate(() => window.__arail.world.objects.some((o) => o.type === "quay"))).toBe(true);
  expect(errors).toEqual([]);
});

test("switching layouts while placing an object keeps the app running", async ({ page }) => {
  const errors = await openApp(page, "/app/#build");
  await page.selectOption("#exampleSelect", "neustadt");
  await page.waitForFunction(() => {
    const a = window.__arail;
    return a.world.layout.name === "EBL Bf Neustadt and terminal (example)" && a.tracker.state.used.length >= 6;
  });
  await page.getByRole("button", { name: /^Rail platform/ }).click();
  // a point at a marker seen in the photo
  const marker = await page.evaluate(() => {
    const e = window.__arail.world.map.get(window.__arail.tracker.state.used[0]);
    return [e.x, e.y];
  });
  const p = await screenPoint(page, marker[0], marker[1]);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => page.evaluate(() => window.__arail.editor.placing?.points.length)).toBe(1);
  await page.selectOption("#exampleSelect", "lab");
  await page.waitForFunction(() => window.__arail.world.layout.name === "EBL lab, Beta 0.1 (example)" && window.__arail.tracker.state.H);
  await expect(page.locator("#placing")).toBeHidden();
  const t0 = await page.evaluate(() => window.__arail.clock);
  await expect.poll(() => page.evaluate(() => window.__arail.clock)).toBeGreaterThan(t0 + 0.2); // frames still run
  expect(errors).toEqual([]);
});

test("a layout chosen from the Layouts menu gets only its own markers, not those of the previous photo", async ({ page }) => {
  const errors = await openApp(page, "/app/?example=neustadt#build");
  await page.waitForFunction(() => window.__arail.world.layout.name === "EBL Bf Neustadt and terminal (example)" && window.__arail.tracker.state.used.length >= 6);
  // the lab photo arrives late: meanwhile the photo of Bf Neustadt (markers 10 to 30) is still the source
  await page.route("**/media/ebl-lab.jpg", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.selectOption("#exampleSelect", "lab");
  await page.waitForFunction(() => window.__arail.world.layout.name === "EBL lab, Beta 0.1 (example)");
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__arail.world.map.ids())).toEqual([0, 1, 2, 3, 4]);
  await page.waitForFunction(() => window.__arail.source?.name === "EBL lab, Beta 0.1 (example)" && window.__arail.tracker.state.H);
  expect(await page.evaluate(() => window.__arail.world.map.ids())).toEqual([0, 1, 2, 3, 4]);
  expect(errors).toEqual([]);
});

test("a layout chosen from the Layouts menu while a video plays is not tracked in that video", async ({ page }) => {
  test.skip(!hasScene(), "run `npm run fixtures` first");
  await routeScene(page);
  const errors = await openApp(page, `/app/?layout=${SCENE}#build`);
  await page.locator("#fileVideo").setInputFiles(SCENE_VIDEO);
  await page.waitForFunction(() => window.__arail.source?.kind === "video" && window.__arail.tracker.state.H);
  // the lab photo comes later: meanwhile the video of the test scene (markers 0–7) is still shown
  let sendPhoto;
  await page.route("**/media/ebl-lab.jpg", async (route) => {
    await new Promise((resolve) => (sendPhoto = resolve));
    await route.continue();
  });
  await page.selectOption("#exampleSelect", "lab");
  await page.waitForFunction(() => window.__arail.world.layout.name === "EBL lab, Beta 0.1 (example)");
  await page.waitForTimeout(800); // many video frames
  expect(await page.evaluate(() => ({ ids: window.__arail.world.map.ids(), tracked: !!window.__arail.tracker.state.H }))).toEqual({ ids: [0, 1, 2, 3, 4], tracked: false });
  await expect.poll(() => typeof sendPhoto).toBe("function");
  sendPhoto();
  await page.waitForFunction(() => window.__arail.source?.name === "EBL lab, Beta 0.1 (example)" && window.__arail.tracker.state.H);
  expect(await page.evaluate(() => window.__arail.world.map.ids())).toEqual([0, 1, 2, 3, 4]);
  expect(errors).toEqual([]);
});

test("a layout saved in this browser by version 0.1.0 is restored, and the app says so", async ({ page }) => {
  // as World.toJSON() of 0.1.0 wrote it (no grid, clock or town; road kind "road", coloured buildings, the road-traffic plugin)
  const saved = {
    format: "arail-layout/1", name: "EBL lab (example)", scale: 87,
    markers: { dictionary: "ARUCO", size_mm: 30, codes: 50, origin: 0, sizes_mm: {}, poses: { 0: [0, 0, 0], 1: [700.4, 18.9, 1.47], 2: [-9.8, 143, 1.49], 3: [708.3, 162.3, 0.39], 4: [1159.7, 188.5, -0.69] } },
    services: { rail_headway_s: 70, rail_dwell_s: 24, bus_headway_s: 80, bus_dwell_s: 20, approach_s: 6 },
    simulations: [{ base_rate: 0.5, max_per_area: 140, type: "passengers" }, { type: "road-traffic", cars_per_km: 90, speed_kmh: 35 }],
    objects: [
      { name: "Platform 1", number: "1", width_mm: 70, sides: "both", track_left: "G2", track_right: "G3", lines: "RE 1, RB 33", id: "platform-1", type: "platform", between: [0, 1] },
      { track_id: "G2", id: "track-g2", type: "track", points: [[-150, 43], [1450, 86.1]] },
      { name: "Bus station", rotation_deg: 1.5, bays: 2, bay_length_m: 16, width_m: 2.8, lane_width_m: 3.2, lines: "62, 85", id: "bus-terminal-1", type: "bus-terminal", position: [610, -266] },
      { name: "House", rotation_deg: 1.5, width_m: 10, depth_m: 8, floors: 2, roof: "gable", color: "#f0e0c0", roof_color: "#7a3b2e", id: "building-3", type: "building", position: [420, 494] },
      { name: "My road", kind: "road", width_m: 6, type: "road", points: [[100, 300], [900, 320]], id: "road-2" },
    ],
    scenarios: [], plugins: ["../plugins/road-traffic.js"], view: { image: "../media/ebl-lab.jpg" },
  };
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/app/#build");
  await page.evaluate((json) => {
    localStorage.clear();
    localStorage.setItem(`arail.layout:${new URL("../layouts/ebl-lab.json", location.href).href}`, JSON.stringify(json));
    localStorage.setItem("arail.settings", JSON.stringify({ labels: true, trails: false, showTracks: true, feedVehicles: "outline" }));
  }, saved);
  await page.reload();
  await page.waitForFunction(() => window.__arail?.tracker.state.H && window.__arail.source?.kind === "image", null, { timeout: 30_000 });
  // the message is not replaced by the note that the photo is being analysed
  await page.waitForTimeout(600);
  await expect(page.locator("#toast")).toContainText("Your changes to this layout were restored");
  const state = await page.evaluate(() => {
    const w = window.__arail.world, road = w.getObject("road-2");
    return { n: w.objects.length, placed: w.objects.every((o) => o.geometry), street: road.roadInfo().car, colour: w.getObject("building-3").spec.color, sims: w.simulations.map((s) => s.constructor.type), lighting: w.settings.lighting };
  });
  expect(state).toEqual({ n: 5, placed: true, street: true, colour: "#f0e0c0", sims: ["passengers", "road-traffic"], lighting: true });
  // Reset to original: the example town of this version
  await page.getByRole("button", { name: "Reset to original" }).click();
  await expect.poll(() => page.evaluate(() => window.__arail.world.objects.length)).toBeGreaterThan(50);
  expect(errors).toEqual([]);
});

test("URL option ?scenario= plays a scenario of the layout; an unknown one is named in a message", async ({ page }) => {
  const errors = await openApp(page, "/app/?scenario=football#disrupt");
  await expect.poll(() => page.evaluate(() => window.__arail.world.scenarios.current?.id)).toBe("football");
  await page.goto("/app/?scenario=nope");
  await page.waitForFunction(() => window.__arail?.tracker.state.H);
  await expect(page.locator("#toast")).toContainText("no scenario “nope”");
  expect(errors).toEqual([]);
});

test("importing a file that is not a layout changes nothing", async ({ page }) => {
  const errors = await openApp(page, "/app/#build");
  const before = await page.evaluate(() => JSON.stringify(window.__arail.world.toJSON().objects));
  const calibration = { format: "arail-camera/1", image_size: [1920, 1080], camera_matrix: [[1500, 0, 960], [0, 1500, 540], [0, 0, 1]] };
  await page.locator("#layoutImport").setInputFiles({
    name: "camera-calibration.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(calibration)),
  });
  await expect(page.locator("#toast")).toContainText("not an ARail layout file");
  expect(await page.evaluate(() => JSON.stringify(window.__arail.world.toJSON().objects))).toBe(before);
  expect(errors).toEqual([]);
});

test("editing offset X and then offset Y keeps both", async ({ page }) => {
  const errors = await openApp(page, "/app/#build");
  // a bus station placed relative to marker 1
  await page.evaluate(() => window.__arail.world.addObject({ id: "bus-terminal-m", type: "bus-terminal", name: "Bus station", position: { marker: 1, offset: [100, -50] }, rotation_deg: 0, bays: 2 }));
  await page.waitForFunction(() => window.__arail.world.getObject("bus-terminal-m")?.geometry);
  await page.evaluate(() => window.__arail.editor.select(window.__arail.world.getObject("bus-terminal-m")));
  await page.locator("#geo-bus-terminal-m-dx").fill("250");
  await page.locator("#geo-bus-terminal-m-dx").press("Enter");
  await page.locator("#geo-bus-terminal-m-dy").fill("20");
  await page.locator("#geo-bus-terminal-m-dy").press("Enter");
  await expect.poll(() => page.evaluate(() => window.__arail.world.getObject("bus-terminal-m").spec.position.offset)).toEqual([250, 20]);
  expect(errors).toEqual([]);
});

test("another tab opens at its top, also when the panel was scrolled down; on a phone the page scrolls back to the tabs", async ({ page }) => {
  const errors = await openApp(page, "/app/#build");
  await page.locator("#panel").evaluate((p) => (p.scrollTop = p.scrollHeight));
  expect(await page.locator("#panel").evaluate((p) => p.scrollTop)).toBeGreaterThan(200);
  await page.locator("#tab-view").click();
  expect(await page.locator("#panel").evaluate((p) => p.scrollTop)).toBe(0);
  await expect(page.locator(".modules")).toBeInViewport();
  // the same tab again (e.g. its panel drawn anew) stays where it is
  await page.locator("#panel").evaluate((p) => (p.scrollTop = 300));
  await page.evaluate(() => window.__arail.selectTab("view"));
  expect(await page.locator("#panel").evaluate((p) => p.scrollTop)).toBe(300);
  // a phone: the page scrolls, the tabs stick to the top
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#tab-build").click();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const tabsTop = await page.locator("#panel").evaluate((p) => p.getBoundingClientRect().top);
  expect(tabsTop).toBeLessThan(0);
  await page.locator("#tab-view").click();
  expect(Math.round(await page.locator("#panel").evaluate((p) => p.getBoundingClientRect().top))).toBe(0);
  await expect(page.locator(".modules")).toBeInViewport();
  expect(errors).toEqual([]);
});

test("periodic panel updates keep keyboard focus on buttons", async ({ page }) => {
  const errors = await openApp(page, "/app/#view");
  await page.getByRole("button", { name: "Longer focal length" }).focus();
  await page.waitForTimeout(1000); // the panel is refreshed every 400 ms
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Longer focal length");
  await page.keyboard.press("Space");
  await expect.poll(() => page.evaluate(() => window.__arail.camera.focalSource)).toBe("manual");
  expect(await page.evaluate(() => window.__arail.world.paused)).toBe(false); // Space pressed the button
  expect(errors).toEqual([]);
});

test("the time chip says night after sunset, also with the day and night lighting switched off", async ({ page }) => {
  const errors = await openApp(page, "/app/#simulate");
  const chip = page.locator("#hud .chip.clock");
  await page.getByRole("button", { name: "Night 22:30" }).click();
  await page.evaluate(() => window.__arail.updateHud());
  await expect(chip).toContainText("· night");
  await page.locator("#optLighting").uncheck(); // only the drawing stays bright
  await page.evaluate(() => window.__arail.updateHud());
  await expect(chip).toContainText("· night");
  await expect(page.locator(".clockface")).toContainText("night");
  await page.getByRole("button", { name: "Noon 12:00" }).click();
  await page.evaluate(() => window.__arail.updateHud());
  await expect(chip).not.toContainText("night");
  expect(errors).toEqual([]);
});

test("the layout list is named by the text it shows (Layouts…), for speech input", async ({ page }) => {
  await openApp(page, "/app/");
  const list = page.getByRole("combobox", { name: "Layouts", exact: true });
  await expect(list).toHaveAttribute("id", "exampleSelect");
  await expect(list.locator("option").first()).toHaveText("Layouts…");
});
