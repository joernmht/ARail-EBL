// The app wears the corporate design of the Chair of Railway Operations (Türkis, chair logo,
// Noto Sans), and so does the project page. The states that use the CD accent
// colours (pressed toggles, placing, toasts, disruptions) are checked for contrast in both modes.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function openApp(page, path = "/app/") {
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
}

const style = (page, selector, property) => page.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], property);

/** Colour-contrast violations of the elements matching `selectors`. */
async function contrastViolations(page, selectors) {
  let axe = new AxeBuilder({ page }).withRules(["color-contrast"]);
  for (const s of selectors) axe = axe.include(s);
  const results = await axe.analyze();
  expect(results.passes.flatMap((v) => v.nodes).length, "text elements checked").toBeGreaterThan(3);
  return results.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary}`));
}

const MODES = { light: { bar: "rgb(10, 119, 127)", accent: "rgb(10, 119, 127)" }, dark: { bar: "rgb(0, 20, 80)", accent: "rgb(54, 184, 191)" } };

for (const [scheme, expected] of Object.entries(MODES)) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test("the app shows the chair logo on a Türkis (light) or Dunkelblau (dark) bar, in Noto Sans", async ({ page }) => {
      await openApp(page);
      expect(await style(page, "#bar", "backgroundColor")).toBe(expected.bar);
      const logo = page.getByRole("img", { name: "TU Dresden, Chair of Railway Operations" });
      await expect(logo).toBeVisible();
      expect(await logo.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
      const box = await logo.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(30);
      expect(await style(page, "body", "fontFamily")).toMatch(/^"Noto Sans"/);
      expect(await style(page, "#tab-view", "borderBottomColor")).toBe(expected.accent); // selected tab
      expect(await page.locator('meta[name="theme-color"]').count()).toBe(2);
    });

    test("the project page wears the app's design: the same bar, logo, accent and font", async ({ page }) => {
      await page.goto("/");
      const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
      expect(accent).toBe(scheme === "light" ? "#0A777F" : "#36b8bf");
      expect(await style(page, ".site-bar", "backgroundColor")).toBe(expected.bar);
      await expect(page.getByRole("img", { name: "TU Dresden, Chair of Railway Operations" })).toBeVisible();
      expect(await style(page, "body", "fontFamily")).toMatch(/^"Noto Sans"/);
    });

    test("CD accent states keep text readable: placing, pressed toggles, toasts, disruptions", async ({ page }) => {
      await openApp(page, "/app/#build");
      await page.getByRole("button", { name: /^Building/ }).click();
      await expect(page.locator("#placing")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Building/ })).toHaveAttribute("aria-pressed", "true");
      expect(await style(page, "#placing", "borderLeftColor")).toBe(scheme === "light" ? "rgb(200, 80, 0)" : "rgb(240, 146, 46)"); // Orange
      expect(await contrastViolations(page, [".palette", "#placing"])).toEqual([]);
      await page.keyboard.press("Escape");

      await page.locator("#tab-simulate").click();
      await page.getByRole("button", { name: "Pause" }).click();
      await expect(page.getByRole("button", { name: "Resume" })).toHaveAttribute("aria-pressed", "true");
      expect(await style(page, "#panel-simulate .btn[aria-pressed='true']", "backgroundColor")).toBe(scheme === "light" ? "rgb(200, 80, 0)" : "rgb(240, 146, 46)");
      expect(await contrastViolations(page, ["#panel-simulate", "#hud"])).toEqual([]);

      await page.locator("#tab-disrupt").click();
      await page.selectOption("#disType", "delay");
      await page.selectOption("#disTarget", "platform-1");
      await page.getByRole("button", { name: "Start: Delay" }).click();
      await expect(page.locator(".disruption")).toBeVisible();
      await expect(page.locator("#toast")).toBeVisible();
      expect(await contrastViolations(page, ["#panel-disrupt", "#toast"])).toEqual([]);
    });
  });
}

for (const scheme of ["light", "dark"]) {
  test(`the white chair logo stays visible in a high-contrast theme (forced colours, ${scheme})`, async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active", colorScheme: scheme });
    await page.goto("/app/#view");
    await page.waitForFunction(() => window.__arail?.world);
    // the bar takes the system's background (white in a light theme); the logo (an image) stays white
    const backdrop = await page.locator(".cro-logo").evaluate((img) => {
      for (let el = img; el; el = el.parentElement) {
        const c = getComputedStyle(el).backgroundColor.match(/[\d.]+/g).map(Number);
        if (c.length < 4 || c[3] > 0.5) return c.slice(0, 3);
      }
      return [255, 255, 255];
    });
    const lum = (c) => c.map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    expect((1 + 0.05) / (lum(backdrop) + 0.05), `white logo on rgb(${backdrop})`).toBeGreaterThanOrEqual(3);
  });
}

test.describe("layout of the app bar and the tabs", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("the chair logo does not push the bar onto a second row on a tablet, so the stage keeps its height", async ({ page }) => {
    await openApp(page);
    const bar = await page.locator("#bar").boundingBox();
    expect(bar.height, "one row").toBeLessThan(80);
    await expect(page.locator("#layoutName")).toBeVisible();
    const name = await page.locator("#layoutName").evaluate((el) => ({ width: el.clientWidth, full: el.scrollWidth <= el.clientWidth }));
    expect(name.full, `layout name shown in full (${name.width} px)`).toBe(true);
    for (const id of ["#btnLive", "#exampleSelect"]) {
      const box = await page.locator(id).boundingBox();
      expect(box.y + box.height, `${id} in the first row`).toBeLessThan(bar.y + 70);
    }
    const stage = await page.locator("#stageWrap").boundingBox();
    expect(stage.height).toBeGreaterThan(768 - 80);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
  });

  test("the fonts come from our own server, not from Google", async ({ page }) => {
    const foreign = [];
    page.on("request", (req) => { if (/fonts\.(googleapis|gstatic)\.com/.test(req.url())) foreign.push(req.url()); });
    for (const [path, families] of [["/", ["Noto Sans", "Noto Sans Mono"]], ["/app/", ["Noto Sans", "Noto Sans Mono"]], ["/markers/", ["Archivo", "JetBrains Mono"]]]) {
      await page.goto(path);
      const loaded = await page.evaluate(async (names) => {
        await Promise.all(names.map((f) => document.fonts.load(`16px "${f}"`, "Bahnsteig Gleis 3 – Jörn")));
        return names.map((f) => [...document.fonts].some((face) => face.family.replace(/"/g, "") === f && face.status === "loaded"));
      }, families);
      expect(loaded, path).toEqual(families.map(() => true));
    }
    expect(foreign).toEqual([]);
  });

  test("selecting a tab does not shift the tabs", async ({ page }) => {
    await openApp(page);
    const boxes = () => page.locator(".tabs button").evaluateAll((tabs) => tabs.map((t) => Math.round(t.getBoundingClientRect().left * 4) / 4));
    const before = await boxes();
    for (const tab of ["#tab-build", "#tab-disrupt", "#tab-view"]) {
      await page.locator(tab).click();
      await expect(page.locator(tab)).toHaveAttribute("aria-selected", "true");
      expect(await boxes(), tab).toEqual(before);
    }
  });
});
