// The in-app video survey: a video of the whole layout -> a fixed marker map.
import AxeBuilder from "@axe-core/playwright";
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const axe = async (page) => (await new AxeBuilder({ page }).include("#panel-build").withTags(TAGS).analyze()).violations.map((v) => `${v.id}: ${v.help}`);

const VIDEO = "tests/fixtures/synthetic-survey.webm"; // made by `npm run fixtures` (WebM: test browsers lack H.264)

test("a video of the synthetic layout gives all markers; keeping them fixes the layout", async ({ page }) => {
  test.skip(!existsSync(VIDEO), "run `npm run fixtures` first");
  const truth = JSON.parse(readFileSync("tests/fixtures/meta.json", "utf8")).true_poses;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/app/?layout=../layouts/synthetic-demo.json#build");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/app/?layout=../layouts/synthetic-demo.json#build");
  await page.waitForFunction(() => window.__arail?.world.layout.name === "Synthetic test layout" && window.__arail.tracker.state.H);
  await page.evaluate(() => {
    window.__arail.tracker.resurvey(); // start from an empty marker map
    window.__arail.world.map.lock(); // ... that is locked: the survey unlocks it for its run
  });
  await page.locator("#surveyVideo").setInputFiles(VIDEO);
  await expect(page.locator("#toast")).toContainText("unlocked for the survey");
  // while it runs: progress bar, status line and plot are accessible
  await expect(page.locator(".survey progress")).toBeVisible();
  expect(await axe(page), "survey running").toEqual([]);
  await expect(page.locator(".survey [role=status]")).toContainText("done", { timeout: 60_000 });
  expect(await axe(page), "survey done").toEqual([]);
  const poses = await page.evaluate(() => window.__arail.world.toJSON().markers.poses);
  expect(Object.keys(poses).length).toBe(8);
  // positions agree with the truth (the survey's frame is the origin marker 0's)
  for (const [id, [x, y]] of Object.entries(truth)) {
    expect(Math.hypot(poses[id][0] - x, poses[id][1] - y), `marker ${id}`).toBeLessThan(5); // measured: 0.6–2.4 mm
  }
  await expect(page.locator(".survey svg.marker-plot")).toBeVisible();
  await page.locator(".survey").getByRole("button", { name: "Keep positions" }).click();
  expect(await page.evaluate(() => [...window.__arail.world.map.entries.values()].every((e) => e.fixed))).toBe(true);
  // fixed and locked: live tracking uses only these 8 markers (and 8 detector codes)
  expect(await page.evaluate(() => window.__arail.world.map.locked)).toBe(true);
  expect(await page.evaluate(() => window.__arail.detector.codes)).toBe(8);
  expect(errors).toEqual([]);
});

test("another layout loaded during a video survey is left alone by it", async ({ page }) => {
  test.skip(!existsSync(VIDEO), "run `npm run fixtures` first");
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/app/#build");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/app/#build");
  await page.waitForFunction(() => window.__arail?.world.layout.name === "EBL lab (example)" && window.__arail.tracker.state.H);
  // hold back one decoded frame of the survey (its "seeked" event) until the other layout is loaded
  await page.evaluate(() => {
    const add = HTMLMediaElement.prototype.addEventListener;
    HTMLMediaElement.prototype.addEventListener = function (name, fn, options) {
      if (name !== "seeked" || !window.__holdSeek) return add.call(this, name, fn, options);
      return add.call(this, name, (e) => (window.__releaseSeek = () => fn.call(this, e)), options);
    };
  });
  await page.locator("#surveyVideo").setInputFiles(VIDEO);
  await page.waitForFunction(() => window.__arail.editor.surveyState?.progress?.frame >= 8);
  await page.evaluate(() => (window.__holdSeek = true));
  await page.waitForFunction(() => window.__releaseSeek);
  // the synthetic layout: an empty marker map, and its photo comes later
  let sendPhoto;
  await page.route("**/media/synthetic-layout.jpg", async (route) => {
    await new Promise((resolve) => (sendPhoto = resolve));
    await route.continue();
  });
  await page.selectOption("#exampleSelect", "synthetic");
  await page.waitForFunction(() => window.__arail.world.layout.name === "Synthetic test layout");
  await page.evaluate(() => window.__releaseSeek());
  await expect(page.locator("#toast")).toContainText("Survey cancelled");
  await page.waitForTimeout(600); // longer than the delay of saving a change
  // the frame held back was not measured into the new layout's marker map, which was not saved as changed in this browser
  expect(await page.evaluate(() => window.__arail.world.map.ids())).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("arail.layout:")))).toEqual([]);
  await expect(page.locator(".survey [role=status]")).toHaveCount(0); // no result of the other layout's survey
  // the layout's own photo gives its markers
  await expect.poll(() => typeof sendPhoto).toBe("function");
  sendPhoto();
  await page.waitForFunction(() => window.__arail.source?.name === "Synthetic test layout" && window.__arail.world.map.ids().length === 8);
  expect(errors).toEqual([]);
});
