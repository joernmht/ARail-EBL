// The in-app video survey: a video of the whole layout -> a fixed marker map.
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

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
  await expect(page.locator(".survey [role=status]")).toContainText("done", { timeout: 60_000 });
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
