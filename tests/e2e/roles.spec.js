// End-to-end tests of the role catalogue page (game/roles/): the roles as cards, the families and
// the search as filters, a role named in the address, links between roles, its ways in and the link
// to the career planner, a phone.
import { expect, test } from "@playwright/test";

/** Open the page; it is ready when the cards are there. */
async function open(page, path = "/game/roles/") {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(path);
  await page.waitForFunction(() => window.__roles && document.querySelectorAll(".role-card").length > 0);
  return errors;
}

test("the catalogue: every role as a card; a family and the search filter them", async ({ page }) => {
  const errors = await open(page);
  const n = await page.evaluate(() => window.__roles.cat.roles.length);
  await expect(page.locator(".role-card")).toHaveCount(n);
  await expect(page.locator("#count")).toHaveText(`All ${n} roles.`);
  await expect(page.locator("#roleCount")).toContainText(`${n} roles in`);
  // a family's button
  const fam = page.locator("#families .btn").first();
  await fam.click();
  await expect(fam).toHaveAttribute("aria-pressed", "true");
  const inFamily = await page.evaluate(() => window.__roles.cat.roles.filter((r) => r.family === window.__roles.cat.families[0].id).length);
  await expect(page.locator(".role-card")).toHaveCount(inFamily);
  await fam.click();
  // the search, also in German names
  await page.fill("#q", "Fahrdienstleiter");
  await expect(page.locator("#role-signaller-relay")).toBeVisible();
  await expect(page.locator("#count")).toContainText(`of ${n} roles.`);
  expect(errors).toEqual([]);
});

test("a role in the address opens with its details; links lead to other roles; the playable game", async ({ page }) => {
  const errors = await open(page, "/game/roles/#role-signaller-relay");
  const card = page.locator("#role-signaller-relay");
  await expect(card.locator("details")).toHaveAttribute("open", "");
  await expect(card).toContainText("Decides");
  await expect(card.getByRole("link", { name: "Play it" })).toHaveAttribute("href", "../signaller/");
  // a role it works with
  const other = card.locator("dd .links a").first();
  const id = (await other.getAttribute("href")).replace("#role-", "");
  await other.click();
  await expect(page.locator(`#role-${id} details`)).toHaveAttribute("open", "");
  await expect(page).toHaveURL(new RegExp(`#role-${id}$`));
  expect(errors).toEqual([]);
});

test("a role's ways in, and a link to aim for it in the career planner", async ({ page }) => {
  const errors = await open(page, "/game/roles/#role-signaller-relay");
  test.skip(await page.evaluate(() => window.__roles.cat.format === "arail-roles/1"), "the catalogue has no careers yet (format 1)");
  const card = page.locator("#role-signaller-relay");
  await expect(card.locator("dt", { hasText: "Ways in" })).toBeVisible();
  await expect(card.getByRole("link", { name: "Aim for this role in the career planner" })).toHaveAttribute("href", "../career/#aim=signaller-relay");
  await expect(page.getByRole("link", { name: "Plan a career" })).toHaveAttribute("href", "../career/");
  expect(errors).toEqual([]);
});

test("what a role gives to and takes from other roles: flows with their receivers, a party, a mission to play", async ({ page }) => {
  const errors = await open(page, "/game/roles/#role-maintenance-dispatcher");
  const card = page.locator("#role-maintenance-dispatcher");
  await expect(card.locator(".tags")).toContainText("Infrastructure manager");
  const gives = card.locator("dl > div").filter({ has: page.locator("dt", { hasText: /^Gives$/ }) });
  await expect(gives.locator("li").filter({ hasText: "Repair status" })).toContainText("Signaller in a relay interlocking");
  await expect(gives.locator("li strong").filter({ hasText: "Closure request" })).toHaveAttribute("title", /Gleissperrung/);
  const takes = card.locator("dl > div").filter({ has: page.locator("dt", { hasText: /^Takes$/ }) });
  await expect(takes.locator("li").filter({ hasText: "Fault report" })).toContainText("from");
  // a role named in a flow is a link to its card
  await takes.locator("li").filter({ hasText: "Track closure" }).getByRole("link", { name: "Signaller in a relay interlocking" }).click();
  await expect(page).toHaveURL(/#role-signaller-relay$/);
  await expect(page.locator("#role-maintenance-dispatcher").getByRole("link", { name: "Play it" })).toHaveAttribute("href", "../play/?mission=fault-night");
  expect(errors).toEqual([]);
});

test("on a phone: the cards in one column, no sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});
