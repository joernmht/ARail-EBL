// End-to-end tests of the career planner (game/career/): a career started from a school certificate,
// educations and jobs taken by choice, working on, a step back, the role aimed at with its ways in, the
// address from the roles page, a phone.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const careers = JSON.parse(readFileSync(new URL("../../web/game/roles/roles.json", import.meta.url), "utf8")).format === "arail-roles/2";
test.skip(!careers, "the catalogue has no careers yet (format 1)");

/** Open the planner with nothing stored. */
async function open(page, path = "/game/career/") {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__career?.person);
  return errors;
}

test("a career from leaving school: an education, a job, working on, a step back", async ({ page }) => {
  const errors = await open(page);
  // the career started on opening is the one the start list shows
  expect(await page.locator("#start").inputValue()).toBe(await page.evaluate(() => window.__career.person.start));
  // start from the first school certificate: no job is open yet, educations are
  const first = await page.locator("#start option").first().getAttribute("value");
  await page.selectOption("#start", first);
  await page.getByRole("button", { name: "Start a career" }).click();
  await expect(page.locator("#log li")).toHaveCount(1);
  await expect(page.locator("#next")).toContainText("No job is open yet: start an education.");
  const edu = page.getByRole("list", { name: "Educations you can start" }).locator("li");
  expect(await edu.count()).toBeGreaterThanOrEqual(3);
  // an apprenticeship: afterwards jobs are open
  const apprenticeship = edu.filter({ hasText: "apprenticeship" }).first();
  await apprenticeship.getByRole("button", { name: "Start" }).click();
  await expect(page.locator("#log li")).toHaveCount(2);
  const jobs = page.getByRole("list", { name: "Jobs open to you" }).locator("li");
  await expect(jobs.first()).toBeVisible();
  await jobs.first().getByRole("button", { name: "Take it" }).click();
  await expect(page.locator("#you")).not.toContainText("not in a role");
  await page.getByRole("button", { name: "+3 years" }).click();
  await expect(page.locator("#you")).toContainText("3 years");
  // a step back
  await page.getByRole("button", { name: "Step back" }).click();
  await expect(page.locator("#you")).not.toContainText(": 3 years");
  // the career is remembered in the browser
  await page.reload();
  await page.waitForFunction(() => window.__career?.person);
  await expect(page.locator("#log li")).toHaveCount(3);
  expect(errors).toEqual([]);
});

test("aiming at a role: its ways in with what is there and what is missing", async ({ page }) => {
  const errors = await open(page, "/game/career/#aim=signaller-relay");
  await expect(page.locator("#aim")).toHaveValue("signaller-relay");
  const info = page.locator("#aimInfo");
  await expect(info).toContainText("Signaller in a relay interlocking");
  await expect(info).toContainText("Not yet: one of these ways leads in.");
  expect(await info.locator(".career-route").count()).toBeGreaterThanOrEqual(1);
  await expect(info.locator("li.miss").first()).toBeVisible();
  // another aim
  await page.selectOption("#aim", "federal-transport-minister");
  await expect(info).toContainText("Federal Minister of Transport");
  expect(errors).toEqual([]);
});

test("on a phone: one column, no sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});
