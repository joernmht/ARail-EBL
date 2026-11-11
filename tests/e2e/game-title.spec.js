// End-to-end tests of the game page's title screen (game/title.js): it opens without a layout or a
// case, the photos fill the screen, the menu with its cursor, Free play and Options as submenus, the
// language, Continue, the app's shell for an address with a case, and a phone.
import { expect, test } from "@playwright/test";

/** Open the title screen; it is ready when its menu is drawn. */
async function open(page, path = "/game/") {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(path);
  await page.waitForSelector(".title-item");
  return errors;
}

const labels = (page) => page.locator(".title-item .title-label").allTextContents();

test("the game page opens with its title screen: the photos full screen and the main menu", async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator("#title")).toBeVisible();
  await expect(page.locator(".app")).toBeHidden();
  // the photo fills the screen
  const size = await page.locator(".title-slide.on").boundingBox();
  const vp = page.viewportSize();
  expect(size.width).toBeGreaterThanOrEqual(vp.width);
  expect(size.height).toBeGreaterThanOrEqual(vp.height);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ARail");
  expect(await labels(page)).toEqual(["Missions", "Signaller", "Free play", "Career", "Roles", "Options", "Leave"]);
  await expect(page.getByRole("link", { name: /Missions/ })).toHaveAttribute("href", "play/");
  await expect(page.getByRole("link", { name: /Signaller/ })).toHaveAttribute("href", "signaller/");
  // the cursor starts on the first item and moves with the arrows, round the end
  await expect(page.locator(".title-item").first()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("link", { name: /Leave/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("link", { name: /Signaller/ })).toBeFocused();
  // the app's shell is not started behind it
  expect(await page.evaluate(() => window.__arail)).toBeUndefined();
  expect(errors).toEqual([]);
});

test("Free play lists the page's cases, each with its layout; Escape goes back; Continue", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: /Free play/ }).click();
  await expect(page.locator(".title-menu-head")).toHaveText("Free play");
  expect(await labels(page)).toEqual(["Sandbox", "Assets", "Operations", "Terminal", "Journeys", "Back"]);
  await expect(page.locator(".title-item").first()).toBeFocused();
  await expect(page.getByRole("link", { name: /Assets/ })).toHaveAttribute("href", "?layout=../layouts/ebl-lab.json&layers=infrastructure#infra");
  await page.keyboard.press("Escape");
  await expect(page.locator(".title-menu-head")).toHaveText("Main menu");
  await expect(page.getByRole("button", { name: /Free play/ })).toBeFocused();
  // a case opens the app's shell with it, and is offered as Continue afterwards
  await page.getByRole("button", { name: /Free play/ }).click();
  await page.getByRole("link", { name: /Journeys/ }).click();
  await page.waitForFunction(() => window.__arail?.journeys, null, { timeout: 60_000 });
  await expect(page.locator("#title")).toBeHidden();
  await expect(page.locator("#bar .menu-link")).toHaveAttribute("href", "./");
  await page.locator("#bar .menu-link").click();
  await page.waitForSelector(".title-item");
  const cont = page.locator(".title-item").first();
  await expect(cont.locator(".title-label")).toHaveText("Continue");
  await expect(cont.locator(".title-sub")).toHaveText("Free play · Journeys");
  await expect(cont).toHaveAttribute("href", "?layout=../layouts/ebl-lab.json&layers=journeys#journeys");
  expect(errors).toEqual([]);
});

test("Options: the language, the moving background, kept on the device", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: /Options/ }).click();
  await page.getByRole("button", { name: /Deutsch/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.locator(".title-menu-head")).toHaveText("Optionen");
  await expect(page.getByRole("button", { name: /Deutsch/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".title-tagline")).toContainText("Eine Bahn betreiben");
  const motion = page.getByRole("button", { name: /Bewegter Hintergrund/ });
  const was = await motion.getAttribute("aria-pressed");
  await motion.click();
  await expect(page.getByRole("button", { name: /Bewegter Hintergrund/ })).toHaveAttribute("aria-pressed", was === "true" ? "false" : "true");
  expect(await page.locator("#title").evaluate((el) => el.classList.contains("still"))).toBe(was === "true");
  await page.reload();
  await page.waitForSelector(".title-item");
  await expect(page.locator(".title-item .title-label").first()).toHaveText("Missionen");
  expect(errors).toEqual([]);
});

test("an address with a case still opens the app's shell directly", async ({ page }) => {
  await page.goto("/game/?layout=../layouts/ebl-lab.json#overview");
  await page.waitForFunction(() => window.__arail?.layoutUrl);
  await expect(page.locator("#title")).toBeHidden();
  await expect(page.locator("#stage")).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });
  test("the photo fills the screen and the whole menu fits", async ({ page }) => {
    const errors = await open(page);
    const box = await page.locator(".title-slide.on").boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(390);
    expect(box.height).toBeGreaterThanOrEqual(664);
    const last = await page.getByRole("link", { name: /Leave/ }).boundingBox();
    expect(last.y + last.height).toBeLessThanOrEqual(664);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
  });
});
