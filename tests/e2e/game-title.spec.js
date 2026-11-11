// End-to-end tests of the game page's title screen (game/title.js): it opens without a layout or a
// case, the photos fill the screen, the menu with its cursor, Free play and Options as submenus, the
// language (also from the address), Continue, the app's shell for an address with a case or given
// only a #case, a photo that fails to load, and a phone.
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
  // with the focus off the menu (a click on the photo), the keys still move the cursor
  await page.mouse.click(vp.width - 40, vp.height / 2);
  await expect(page.locator(".title-item:focus")).toHaveCount(0);
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("link", { name: /Leave/ })).toBeFocused();
  await page.mouse.click(vp.width - 40, vp.height / 2);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("link", { name: /Missions/ })).toBeFocused();
  // the app's shell is not started behind it
  expect(await page.evaluate(() => window.__arail)).toBeUndefined();
  expect(errors).toEqual([]);
});

test("the title screen is there from the first paint, before the scripts; the photo only for it", async ({ page }) => {
  // the page's scripts never arrive: the name, the photo and the shade are shown all the same
  await page.route("**/game/main.js", (route) => route.abort());
  await page.goto("/game/");
  await expect(page.locator("#title")).toBeVisible();
  await expect(page.locator(".title-name h1")).toBeVisible();
  await expect(page.locator(".title-slide.on")).toHaveAttribute("src", "../assets/ebl-lab-ar.jpg");
  await expect(page.locator(".app")).toBeHidden();
  await page.unroute("**/game/main.js");
  // an address with a case: no title, its photo not fetched
  const photos = [];
  page.on("request", (r) => r.url().includes("ebl-lab-ar.jpg") && photos.push(r.url()));
  await page.goto("/game/?layout=../layouts/ebl-lab.json#overview");
  await page.waitForFunction(() => window.__arail?.layoutUrl, null, { timeout: 30_000 });
  await expect(page.locator("#title")).toBeHidden();
  expect(photos).toEqual([]);
  expect(await page.locator(".title-slide").first().getAttribute("src")).toBeNull();
});

test("a shared link's tracking tags still open the title screen; the shell's keys open the shell", async ({ page }) => {
  const errors = await open(page, "/game/?utm_source=newsletter&fbclid=abc");
  await expect(page.locator("#title")).toBeVisible();
  expect(await page.evaluate(() => window.__arail)).toBeUndefined();
  await page.goto("/game/?mock=1");
  await page.waitForFunction(() => window.__arail?.layoutUrl, null, { timeout: 30_000 });
  await expect(page.locator("#title")).toBeHidden();
  expect(errors).toEqual([]);
});

test("the first photo, if it cannot be loaded, is left out: the next one is shown at once", async ({ page }) => {
  await page.route("**/assets/ebl-lab-ar.jpg", (route) => route.abort());
  const errors = await open(page);
  await page.waitForFunction(() => window.__title.slide === 1);
  expect(await page.evaluate(() => window.__title.imgs[0])).toBeNull();
  await expect(page.locator(".title-slide.on")).toHaveAttribute("src", "../media/ebl-container-train.jpg");
  await expect(page.locator("#titleCaption")).toHaveText("A container train and the intercity in the lab");
  expect(errors).toEqual([]);
});

test("the menu's keys: Home and End, the right arrow into a submenu, the left arrow back", async ({ page }) => {
  const errors = await open(page);
  await page.keyboard.press("End");
  await expect(page.getByRole("link", { name: /Leave/ })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByRole("link", { name: /Missions/ })).toBeFocused();
  await page.getByRole("button", { name: /Options/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".title-menu-head")).toHaveText("Options");
  await expect(page.locator(".title-item").first()).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".title-menu-head")).toHaveText("Main menu");
  await expect(page.getByRole("button", { name: /Options/ })).toBeFocused();
  // the right arrow on an item without a submenu does nothing
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".title-menu-head")).toHaveText("Main menu");
  await expect(page.getByRole("link", { name: /Missions/ })).toBeFocused();
  expect(errors).toEqual([]);
});

test.describe("with less motion asked for by the system", () => {
  test.use({ reducedMotion: "reduce" });
  test("the photos stay still until Options turns the background on", async ({ page }) => {
    const errors = await open(page);
    await expect(page.locator("#title")).toHaveClass(/\bstill\b/);
    expect(await page.evaluate(() => window.__title.timer)).toBeNull();
    await page.getByRole("button", { name: /Options/ }).click();
    await expect(page.getByRole("button", { name: /Moving background/ })).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: /Moving background/ }).click();
    await expect(page.locator("#title")).not.toHaveClass(/\bstill\b/);
    expect(await page.evaluate(() => window.__title.timer)).not.toBeNull();
    expect(errors).toEqual([]);
  });
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
  // where the shell was left: its layout and case (its modules are kept with the layout, not in the link)
  await expect(cont).toHaveAttribute("href", "?layout=..%2Flayouts%2Febl-lab.json#journeys");
  // another layout chosen in the shell: Continue follows it
  await cont.click();
  await page.waitForFunction(() => window.__arail?.layoutUrl, null, { timeout: 30_000 });
  await page.evaluate(() => window.__arail.openExample("neustadt"));
  await page.waitForFunction(() => /ebl-neustadt\.json$/.test(window.__arail.layoutUrl), null, { timeout: 30_000 });
  await page.goto("/game/");
  await page.waitForSelector(".title-item");
  await expect(page.locator(".title-item").first()).toHaveAttribute("href", /^\?layout=..%2Flayouts%2Febl-neustadt\.json#/);
  // a page opened from the menu is Continue then
  await page.getByRole("link", { name: /Roles/ }).click();
  await page.waitForURL(/\/game\/roles\//);
  await page.goto("/game/");
  await page.waitForSelector(".title-item");
  await expect(page.locator(".title-item").first()).toHaveAttribute("href", "roles/");
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

test("an address given only a #case leaves the title for the app's shell, and the title stops", async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => (location.hash = "overview"));
  await page.waitForFunction(() => window.__arail?.layoutUrl, null, { timeout: 30_000 });
  await expect(page.locator("#title")).toBeHidden();
  await expect(page.locator("#stage")).toBeVisible();
  // its photos do not start again behind the app (a tab switch, the system's motion setting)
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(await page.evaluate(() => window.__title.timer)).toBeNull();
  // the arrows are the app's again: the title's handler is not called any more
  await page.evaluate(() => (window.__title.onKey = () => (window.__titleKeyed = true)));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.__titleKeyed ?? false)).toBe(false);
  expect(errors).toEqual([]);
});

test("Back from the shell to the bare address shows the title screen again", async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => (location.hash = "overview"));
  await page.waitForFunction(() => window.__arail?.layoutUrl, null, { timeout: 30_000 });
  await page.goBack();
  await page.waitForSelector(".title-item");
  await expect(page.locator("#title")).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  expect(errors).toEqual([]);
});

test("Options shows full screen as it is, also when it is left with the browser's key", async ({ page }) => {
  const errors = await open(page);
  test.skip(!(await page.evaluate(() => document.fullscreenEnabled)), "no full screen in this browser");
  await page.getByRole("button", { name: /Options/ }).click();
  await page.getByRole("button", { name: /Full screen/ }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await expect(page.getByRole("button", { name: /Full screen/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /Full screen/ })).toBeFocused();
  // left without the menu (Esc, F11)
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByRole("button", { name: /Full screen/ })).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});

test("a ?lang= of the address goes along into the games and back to the title", async ({ page }) => {
  const errors = await open(page, "/game/?lang=de");
  await expect(page.locator(".title-item .title-label").first()).toHaveText("Missionen");
  await page.getByRole("button", { name: /Freies Spiel/ }).click();
  await expect(page.getByRole("link", { name: /Reisen/ })).toHaveAttribute("href", "?layout=..%2Flayouts%2Febl-lab.json&layers=journeys&lang=de#journeys");
  await page.goto("/game/?layout=../layouts/ebl-lab.json&lang=de#overview");
  await page.waitForFunction(() => window.__arail?.layoutUrl, null, { timeout: 30_000 });
  await expect(page.locator("#bar .menu-link")).toHaveAttribute("href", "?lang=de");
  // the language changed in the shell (as Settings → View does): Menu follows it
  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set("lang", "en");
    history.replaceState(history.state, "", url);
  });
  await page.locator("#bar .menu-link").click();
  await page.waitForSelector(".title-item");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(new URL(page.url()).search).toBe("?lang=en");
  await page.goto("/game/?layout=../layouts/ebl-lab.json&lang=de#overview");
  await page.waitForFunction(() => window.__arail?.layoutUrl, null, { timeout: 30_000 });
  await page.locator("#bar .menu-link").click();
  await page.waitForSelector(".title-item");
  // the shell was played last: Continue first, in German
  expect(await page.locator(".title-item .title-label").allTextContents()).toEqual(expect.arrayContaining(["Weiterspielen", "Missionen"]));
  expect(errors).toEqual([]);
});

test("a photo that cannot be loaded is left out; the photos go on", async ({ page }) => {
  await page.route("**/media/ebl-container-train.jpg", (route) => route.abort());
  const errors = await open(page);
  await page.evaluate(() => window.__title.setMotion(true));
  await page.evaluate(() => window.__title.next());
  await page.waitForFunction(() => window.__title.slide === 2);
  expect(await page.evaluate(() => window.__title.imgs[1])).toBeNull();
  await expect(page.locator(".title-slide.on")).toHaveAttribute("src", "../assets/town-day.jpg");
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
