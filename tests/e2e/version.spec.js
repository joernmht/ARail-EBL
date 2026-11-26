// A page older than the site (web/app/version.js): the notice, Later, and Reload, which fetches the
// page's own files past the cache before it loads the page again. The page is served as published
// (its meta arail-version stamped) and version.json says a newer one.
import { expect, test } from "@playwright/test";

const LAB = "/app/?layout=../layouts/ebl-lab.json";

async function publish(page, { pageVersion, siteVersion }) {
  // the app's page itself (app/ or app/index.html), with its version stamped as the deploy does
  await page.route((url) => /\/app\/(index\.html)?$/.test(url.pathname), async (route) => {
    const res = await route.fetch();
    const html = (await res.text()).replace('<meta name="arail-version" content="dev">', `<meta name="arail-version" content="${pageVersion}">`);
    await route.fulfill({ response: res, body: html });
  });
  await page.route("**/version.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ version: siteVersion() }) }));
}

test("an old page offers the new version: Later hides it, Reload fetches the page's files anew and loads it again", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let site = "aaa111";
  await publish(page, { pageVersion: "aaa111", siteVersion: () => site });
  await page.goto(LAB);
  await page.waitForFunction(() => window.__arail?.version, null, { timeout: 30_000 });
  // the same version: no notice
  expect(await page.evaluate(() => window.__arail.version.check())).toBe(false);
  await expect(page.locator("#updateNotice")).toHaveCount(0);
  // a newer one published
  site = "bbb222";
  expect(await page.evaluate(() => window.__arail.version.check())).toBe(true);
  const notice = page.locator("#updateNotice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("A new version of ARail is available.");
  await notice.getByRole("button", { name: "Later" }).click();
  await expect(notice).toHaveCount(0);
  // the next check shows it again; Reload: the page's own modules fetched past the cache, then the page loaded again
  await page.evaluate(() => window.__arail.version.check());
  const refetched = [];
  // (fetched by refreshFiles with cache: "reload"; the header does not show while requests are routed)
  page.on("request", (r) => {
    if (r.resourceType() === "fetch" && /\/app\/(app|panels)\.js$/.test(new URL(r.url()).pathname)) refetched.push(new URL(r.url()).pathname);
  });
  const loaded = page.waitForEvent("load");
  await notice.getByRole("button", { name: "Reload" }).click();
  await loaded;
  expect(refetched).toEqual(expect.arrayContaining(["/app/app.js", "/app/panels.js"]));
  expect(errors).toEqual([]);
});

test("in German; a page not published (dev) asks for no version", async ({ page }) => {
  let asked = 0;
  await page.route("**/version.json", (route) => { asked++; return route.fulfill({ contentType: "application/json", body: '{"version": "x"}' }); });
  await page.goto(`${LAB}&lang=de`);
  await page.waitForFunction(() => window.__arail?.world?.objects?.length, null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__arail.version)).toBeNull();
  expect(asked).toBe(0);
  // the notice's words in German
  await publish(page, { pageVersion: "aaa111", siteVersion: () => "bbb222" });
  await page.reload();
  await expect(page.locator("#updateNotice")).toContainText("Eine neue Version von ARail ist da.", { timeout: 30_000 });
  await expect(page.locator("#updateNotice").getByRole("button", { name: "Neu laden" })).toBeVisible();
});
