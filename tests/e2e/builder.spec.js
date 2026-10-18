// The builder (web/builder/): a street editor of its own. Streets are drawn so that they join,
// a bus stop goes onto its street, the Problems tab lists what has no street to it with a fix,
// undo takes changes back, unpushed changes survive a reload, and a push puts the layout (only its
// changed lines) and a covered photo into one commit on GitHub (here a GitHub in the test).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const LAB = "/builder/?layout=../layouts/ebl-lab.json";
const LAB_TEXT = readFileSync(new URL("../../web/layouts/ebl-lab.json", import.meta.url), "utf8");

function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** A GitHub with the repository's files as they are here; it records what is pushed. */
async function fakeGitHub(page, { files = {}, token = "test-token" } = {}) {
  const gh = { blobs: {}, trees: [], commits: [], patches: [], head: "c0", files: { "web/layouts/ebl-lab.json": LAB_TEXT, ...files } };
  const sha = (s) => createHash("sha1").update(s).digest("hex");
  await page.route("https://api.github.com/**", async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.replace("/repos/joernmht/ARail-EBL", "");
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body), headers: { "access-control-allow-origin": "*" } });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    const auth = req.headers().authorization;
    if (auth && auth !== `Bearer ${token}`) return json(401, { message: "Bad credentials" });
    let m;
    if ((m = path.match(/^\/contents\/(.+)$/)) && req.method() === "GET") {
      const p = decodeURIComponent(m[1]);
      if (p === "web/layouts") return json(200, Object.keys(gh.files).filter((f) => f.startsWith("web/layouts/")).map((f) => ({ name: f.split("/").pop(), path: f, sha: sha(gh.files[f]), type: "file" })));
      if (!(p in gh.files)) return json(404, { message: "Not Found" });
      return json(200, { type: "file", sha: sha(gh.files[p]), content: Buffer.from(gh.files[p]).toString("base64"), git_url: "x" });
    }
    if (path === "/git/ref/heads/main") return json(200, { object: { sha: gh.head } });
    if ((m = path.match(/^\/git\/commits\/(\w+)$/))) return json(200, { sha: m[1], tree: { sha: `t-${m[1]}` } });
    if (path.startsWith("/git/trees/t-")) return json(200, { tree: Object.entries(gh.files).map(([p, text]) => ({ path: p, type: "blob", sha: sha(text) })) });
    if (path === "/git/blobs") {
      const body = req.postDataJSON(), s = sha(body.content);
      gh.blobs[s] = Buffer.from(body.content, "base64");
      return json(201, { sha: s });
    }
    if (path === "/git/trees") {
      gh.trees.push(req.postDataJSON());
      return json(201, { sha: `tree-${gh.trees.length}` });
    }
    if (path === "/git/commits") {
      gh.commits.push(req.postDataJSON());
      return json(201, { sha: `c${gh.commits.length}`, html_url: `https://github.com/joernmht/ARail-EBL/commit/c${gh.commits.length}` });
    }
    if (path === "/git/refs/heads/main") {
      gh.patches.push(req.postDataJSON());
      gh.head = req.postDataJSON().sha;
      return json(200, { object: { sha: gh.head } });
    }
    return json(404, { message: `no route ${req.method()} ${path}` });
  });
  return gh;
}

async function openBuilder(page, path = LAB) {
  const errors = trackErrors(page);
  await page.goto(path);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(path);
  await page.waitForFunction(() => window.__builder?.doc && window.__builder.world.objects.length, null, { timeout: 30_000 });
  return errors;
}

/** Click on the plan at a layout point (mm). */
async function clickAt(page, p, options) {
  const s = await page.evaluate((p) => {
    const b = window.__builder, q = b.plan.toScreen(p), r = b.plan.canvas.getBoundingClientRect();
    return [r.left + (q[0] * r.width) / b.plan.canvas.width, r.top + (q[1] * r.height) / b.plan.canvas.height];
  }, p);
  await page.mouse.click(s[0], s[1], options);
}

const objects = (page, type) => page.evaluate((type) => window.__builder.world.objects.filter((o) => o.type === type).map((o) => ({ id: o.id, ...o.toJSON() })), type);
const problems = (page) => page.evaluate(() => window.__builder.problems.map((p) => p.key));

test("a street joins the one it starts on, a bus stop goes onto it, a fix connects a street on its own, undo takes it back", async ({ page }) => {
  await fakeGitHub(page);
  const errors = await openBuilder(page);
  await expect(page.locator("#layoutName")).toHaveText("EBL lab, Beta 0.1 (example)");
  await expect(page.locator("#saveState")).toHaveText("No changes");
  // Street (S): from the end of Bahnhofstraße to the east, then south; Enter finishes
  await page.locator("#plan").focus();
  await page.keyboard.press("s");
  await expect(page.getByRole("button", { name: "Street", exact: true })).toHaveAttribute("aria-pressed", "true");
  await clickAt(page, [1455, -405]); // near the end: snaps onto it
  await clickAt(page, [1700, -412]); // level with the point before
  await clickAt(page, [1700, -900]);
  await page.keyboard.press("Enter");
  const street = (await objects(page, "road")).at(-1);
  expect(street.points).toEqual([[1450, -410], [1700, -410], [1700, -900]]);
  expect(await problems(page)).not.toContain("near:road-bahnhofstrasse:1"); // the end it started on is joined now
  // a bus stop east of it: on its left side (it runs south)
  await page.keyboard.press("Escape");
  await page.keyboard.press("b");
  await clickAt(page, [1740, -650]);
  const [stop] = await objects(page, "bus-stop").then((s) => s.filter((x) => x.id === "bus-stop-1"));
  expect(stop.side).toBe("left");
  await expect(page.locator("#panel-element h2").first()).toContainText("Bus stop");
  // the Problems tab: Hinter dem Bahnhof is on its own; its fix adds a street to Bahnhofstraße
  await page.locator("#tab-problems").click();
  await expect(page.locator("#panel-problems")).toContainText("Hinter dem Bahnhof: not connected to the other streets");
  const roads = (await objects(page, "road")).length;
  await page.getByRole("button", { name: "Add a street to Bahnhofstraße" }).click();
  expect((await objects(page, "road")).length).toBe(roads + 1);
  expect(await problems(page)).not.toContain("island:road-hinter-dem-bahnhof");
  await expect(page.locator("#saveState")).toHaveText("Not pushed · 3 changes");
  // undo (Ctrl+Z) and redo
  await page.locator("#plan").focus();
  await page.keyboard.press("Control+z");
  expect((await objects(page, "road")).length).toBe(roads);
  expect(await problems(page)).toContain("island:road-hinter-dem-bahnhof");
  await page.locator("#btnRedo").click();
  expect((await objects(page, "road")).length).toBe(roads + 1);
  expect(errors).toEqual([]);
});

test("a selected street: drag a corner, add one with a double click, Delete takes the element away", async ({ page }) => {
  await fakeGitHub(page);
  const errors = await openBuilder(page);
  await page.evaluate(() => window.__builder.select(window.__builder.world.getObject("road-bahnhofstrasse")));
  // double-click on its line: a new corner there
  await clickAt(page, [800, -410], { clickCount: 2 });
  let road = (await objects(page, "road")).find((o) => o.id === "road-bahnhofstrasse");
  expect(road.points).toHaveLength(3);
  expect(road.points[1]).toEqual([800, -410]);
  // drag it 100 mm north (snapped to the grid)
  const at = async (p) => page.evaluate((p) => {
    const b = window.__builder, q = b.plan.toScreen(p), r = b.plan.canvas.getBoundingClientRect();
    return [r.left + (q[0] * r.width) / b.plan.canvas.width, r.top + (q[1] * r.height) / b.plan.canvas.height];
  }, p);
  const [x0, y0] = await at([800, -410]), [x1, y1] = await at([800, -300]);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 4 });
  await page.mouse.up();
  road = (await objects(page, "road")).find((o) => o.id === "road-bahnhofstrasse");
  expect(road.points[1]).toEqual([800, -300]);
  // Delete: the street is gone, Ctrl+Z brings it back
  await page.evaluate(() => (window.__builder.vertex = null));
  await page.locator("#plan").focus();
  await page.keyboard.press("Delete");
  expect((await objects(page, "road")).some((o) => o.id === "road-bahnhofstrasse")).toBe(false);
  await page.keyboard.press("Control+z");
  expect((await objects(page, "road")).some((o) => o.id === "road-bahnhofstrasse")).toBe(true);
  expect(errors).toEqual([]);
});

test("unpushed changes come back after a reload", async ({ page }) => {
  await fakeGitHub(page);
  await openBuilder(page);
  await page.evaluate(() => {
    const b = window.__builder;
    b.world.getObject("bus-stop-altmarkt").set({ position: [655, -760] });
    b.changed();
  });
  await page.reload();
  await page.waitForFunction(() => window.__builder?.doc && window.__builder.world.objects.length);
  expect(await page.evaluate(() => window.__builder.world.getObject("bus-stop-altmarkt").spec.position)).toEqual([655, -760]);
  await expect(page.locator("#saveState")).toHaveText("Not pushed · 1 change");
  await expect(page.locator("#toast")).toContainText("unpushed changes to this layout were restored");
});

test("a push: the layout with only its changed line and a covered photo, in one commit to main", async ({ page }) => {
  const gh = await fakeGitHub(page);
  const errors = await openBuilder(page);
  await page.evaluate(() => {
    const b = window.__builder;
    b.world.getObject("bus-stop-altmarkt").set({ position: [655, -760] });
    b.changed();
  });
  // a covered photo for the layout's photo
  await page.locator("#tab-photos").click();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.locator("#panel-photos input[type=file]").first().setInputFiles({ name: "lab.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("#panel-photos")).toContainText("New covered photo: ebl-lab-covered.png");
  // push with a token
  await page.locator("#btnPush").click();
  const dialog = page.locator("#pushDialog");
  await expect(dialog).toContainText("web/layouts/ebl-lab.json");
  await expect(dialog).toContainText("web/media/ebl-lab-covered.png");
  await expect(page.locator("#commitMessage")).toHaveValue("Builder: EBL lab, Beta 0.1 (example) (1 change, 1 covered photo)");
  await page.locator("#ghToken").fill("test-token");
  await dialog.getByRole("button", { name: "Push to main" }).click();
  await expect(dialog).toContainText("Pushed.");
  // one commit on top of main with both files
  expect(gh.commits).toHaveLength(1);
  expect(gh.commits[0].parents).toEqual(["c0"]);
  expect(gh.trees[0].tree.map((e) => e.path).sort()).toEqual(["web/layouts/ebl-lab.json", "web/media/ebl-lab-covered.png"]);
  const layout = gh.blobs[gh.trees[0].tree.find((e) => e.path.endsWith(".json")).sha].toString("utf8");
  const before = LAB_TEXT.split("\n"), after = layout.split("\n");
  const changed = after.filter((l) => !before.includes(l));
  expect(changed.filter((l) => l.includes("bus-stop-altmarkt"))).toHaveLength(1);
  expect(changed.some((l) => l.includes('"image_covered": "../media/ebl-lab-covered.png"'))).toBe(true);
  expect(changed.length).toBeLessThanOrEqual(3); // the stop, the link, a comma
  expect([...gh.blobs[gh.trees[0].tree.find((e) => e.path.endsWith(".png")).sha]]).toEqual([...png]);
  expect(gh.patches).toEqual([{ sha: "c1", force: false }]);
  await expect(page.locator("#saveState")).toHaveText("No changes");
  // the token stays for this tab only (not remembered)
  expect(await page.evaluate(() => [sessionStorage.getItem("arail.builder.token"), localStorage.getItem("arail.builder.token")])).toEqual(["test-token", null]);
  expect(errors).toEqual([]);
});

test("a push of a layout that was changed on GitHub meanwhile stops and says so", async ({ page }) => {
  const gh = await fakeGitHub(page);
  await openBuilder(page);
  await page.evaluate(() => {
    const b = window.__builder;
    b.world.getObject("bus-stop-altmarkt").set({ position: [655, -760] });
    b.changed();
  });
  gh.files["web/layouts/ebl-lab.json"] = LAB_TEXT.replace('"name": "EBL lab, Beta 0.1 (example)"', '"name": "Someone else"');
  await page.locator("#btnPush").click();
  await page.locator("#ghToken").fill("test-token");
  await page.locator("#pushDialog").getByRole("button", { name: "Push to main" }).click();
  await expect(page.locator("#pushDialog")).toContainText("Changed on GitHub since you opened it: web/layouts/ebl-lab.json");
  await expect(page.locator("#pushDialog").getByRole("button", { name: "Push anyway, over it" })).toBeVisible();
  expect(gh.commits).toHaveLength(0);
});

test("a new layout: a table, a street to its edge, pushed as a new file without the defaults", async ({ page }) => {
  const gh = await fakeGitHub(page);
  const errors = await openBuilder(page);
  await page.locator("#btnOpen").click();
  await page.locator("#newName").fill("EBL Waldhof");
  await page.getByRole("button", { name: "Start a new layout" }).click();
  await expect(page.locator("#layoutName")).toHaveText("EBL Waldhof");
  await page.locator("#plan").focus();
  await page.keyboard.press("s");
  await clickAt(page, [-1000, 0]);
  await clickAt(page, [1000, 0]);
  await page.keyboard.press("Enter");
  await page.locator("#btnPush").click();
  await expect(page.locator("#pushDialog")).toContainText("web/layouts/ebl-waldhof.json");
  await page.locator("#ghToken").fill("test-token");
  await page.locator("#pushDialog").getByRole("button", { name: "Push to main" }).click();
  await expect(page.locator("#pushDialog")).toContainText("Pushed.");
  const entry = gh.trees[0].tree.find((e) => e.path === "web/layouts/ebl-waldhof.json");
  const json = JSON.parse(gh.blobs[entry.sha].toString("utf8"));
  expect(json.name).toBe("EBL Waldhof");
  expect(json.objects.map((o) => o.type)).toEqual(["tabletop", "road"]);
  expect(json.objects[1].points).toEqual([[-1000, 0], [1000, 0]]);
  expect(json.grid).toBeUndefined(); // no defaults
  expect(errors).toEqual([]);
});

test("a wrong token is refused with a hint", async ({ page }) => {
  await fakeGitHub(page);
  await openBuilder(page);
  await page.evaluate(() => {
    const b = window.__builder;
    b.world.getObject("bus-stop-altmarkt").set({ position: [655, -760] });
    b.changed();
  });
  await page.locator("#btnPush").click();
  await page.locator("#ghToken").fill("wrong");
  await page.locator("#pushDialog").getByRole("button", { name: "Push to main" }).click();
  await expect(page.locator("#pushDialog")).toContainText("GitHub did not accept the token");
});

test("the app shows a layout's covered photo instead of the photo", async ({ page }) => {
  const errors = trackErrors(page);
  await page.route((url) => url.pathname === "/layouts/ebl-lab.json", async (route) => {
    const json = JSON.parse(LAB_TEXT);
    json.view.image_covered = "../media/ebl-neustadt.jpg"; // any photo stands for the covered one here
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(json) });
  });
  await page.goto("/app/?layout=../layouts/ebl-lab.json");
  await page.waitForFunction(() => window.__arail?.source?.el?.src, null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__arail.source.el.src)).toMatch(/media\/ebl-neustadt\.jpg$/);
  expect(errors).toEqual([]);
});

test("the street tools: the cross-section and widths of the new street, its figure, and the street drawn with them", async ({ page }) => {
  const errors = await openBuilder(page);
  await page.locator("#plan").focus();
  await page.keyboard.press("s");
  const settings = page.getByRole("group", { name: "The new street" });
  await expect(settings).toBeVisible();
  // a street with sidewalks: 7 m of car lanes and 2.5 m sidewalks, 12 m in all
  const figure = page.locator("#panel-element figure.cross-section");
  await expect(figure.locator("figcaption")).toContainText("Sidewalk 2.5 m · Car lanes 7 m · Sidewalk 2.5 m");
  await expect(figure.locator("figcaption b")).toHaveText("12 m in all");
  await expect(settings.locator(".street-width")).toHaveText("12 m wide in all");
  // bike lanes: the field for their width appears, with the standard widths of ERA 2010 to click
  await settings.locator("#new-street-profile").selectOption("bike-lanes");
  const presets = settings.getByRole("group", { name: "Bike lanes or paths: standard values" });
  await expect(presets.getByRole("button")).toHaveText(["1.5", "1.85", "2.25"]);
  await presets.getByRole("button", { name: "1.5", exact: true }).click();
  await expect(presets.getByRole("button", { name: "1.5", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(figure.locator("figcaption")).toContainText("Bike lane 1.5 m · Car lanes 7 m · Bike lane 1.5 m");
  await expect(figure.locator("figcaption b")).toHaveText("15 m in all");
  // narrower than the guidelines: said at once, and the street can still be drawn
  await settings.locator("#new-street-bike_m").fill("1.2");
  await settings.locator("#new-street-bike_m").press("Tab");
  await expect(settings.locator(".hint.error")).toHaveText("Bike lane 1.2 m: below the minimum of 1.5 m (ERA 2010, VwV-StVO); bikes ride in the car lane");
  // the car lanes: a standard width to click
  await settings.getByRole("group", { name: "Width: standard values" }).getByRole("button", { name: "6.5", exact: true }).click();
  await expect(figure.locator("figcaption b")).toHaveText("13.9 m in all");
  // draw it: the new street has the settings chosen
  await clickAt(page, [1700, -1500]);
  await clickAt(page, [2300, -1500]);
  await page.keyboard.press("Enter");
  const street = (await objects(page, "road")).at(-1);
  expect([street.profile, street.bike_m, street.width_m]).toEqual(["bike-lanes", 1.2, 6.5]);
  // the settings stay for the next street of this kind; Standard street takes them back
  await expect(settings.locator("#new-street-profile")).toHaveValue("bike-lanes");
  await settings.getByRole("button", { name: "Standard street" }).click();
  await expect(settings.locator("#new-street-profile")).toHaveValue("sidewalks");
  await expect(figure.locator("figcaption b")).toHaveText("12 m in all");
  // a tram track of its own (T): the track bed and the tracks
  await page.locator("#plan").focus();
  await page.keyboard.press("t");
  await expect(page.getByRole("button", { name: "Tram track" })).toHaveAttribute("aria-pressed", "true");
  await expect(figure.locator("figcaption")).toContainText("Track bed 6.6 m");
  expect(errors).toEqual([]);
});

test("the street tools in German: the new street, its strips and widths", async ({ page }) => {
  const errors = await openBuilder(page, `${LAB}&lang=de`);
  await page.locator("#plan").focus();
  await page.keyboard.press("s");
  const settings = page.getByRole("group", { name: "Die neue Straße" });
  await expect(settings).toBeVisible();
  await expect(settings.locator("label[for=new-street-profile] > span").first()).toHaveText("Querschnitt");
  const caption = page.locator("#panel-element figure.cross-section figcaption");
  await expect(caption).toContainText("Gehweg 2,5 m · Fahrstreifen 7 m · Gehweg 2,5 m");
  await expect(caption.locator("b")).toHaveText("insgesamt 12 m");
  await settings.locator("#new-street-profile").selectOption("advisory-lanes");
  await expect(caption).toContainText("Schutzstreifen 1,5 m");
  expect(errors).toEqual([]);
});
