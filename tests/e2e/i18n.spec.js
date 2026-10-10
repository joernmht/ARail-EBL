// The app in German (app/i18n.js, arail/i18n): ?lang=de, View → Language, the page's markup, the
// panels View, Settings and Build, the HUD and the info card of a train; what is still English there
// may only be names, codes and numbers.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function openApp(page, path) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.lastView, null, { timeout: 30_000 });
  return errors;
}

/** The texts asked for in German that have no translation and are not names, codes or numbers. */
async function stillEnglish(page) {
  return page.evaluate(async () => {
    const { i18n } = await import("/app/i18n.js");
    const ARail = await import("/arail/index.js");
    const w = window.__arail.world;
    // the names of the layout (objects, stops, lines, layers) and of the vehicles
    const names = [w.layout.name, ...w.objects.map((o) => o.name), ...w.objects.map((o) => o.spec.track_id), ...w.layers().map((l) => l.name),
      ...Object.values(ARail.VEHICLE_TYPES).map((t) => t.label.split(" (")[0])].filter(Boolean).sort((a, b) => b.length - a.length);
    return [...i18n.missing].filter((text) => {
      if (/^[a-z][a-z0-9-]*$/.test(text) || /^wss?:\/\//.test(text)) return false; // ids, addresses
      let rest = text;
      for (const n of names) rest = rest.split(n).join(" ");
      // English words left: two or more lowercase letters after names, codes and units are gone
      rest = rest.replace(/\b(mm|m|t|t\/m|km\/h|s|min|px|kV|Hz|x)\b/g, " ");
      return /\b[a-z]{3,}\b/.test(rest);
    });
  });
}

test("?lang=de: the frame, View, Settings, Build and a train's card in German; only names stay as they are", async ({ page }) => {
  const errors = await openApp(page, "/app/?lang=de&layers=border");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("tab", { name: "Ansicht" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Einstellungen" })).toBeVisible();
  await expect(page.locator("#btnFlyover")).toHaveText("Überflug");
  await expect(page.locator("#stage")).toHaveAttribute("aria-label", "Kamerabild mit erweiterter Realität");
  const view = page.locator("#panel-view");
  await expect(view).toContainText("Gleise färben nach");
  await expect(page.locator("#optLanguage")).toHaveValue("de");
  await expect(page.locator("#hud")).toContainText(/Verfolgung|Noch kein Bild/);
  // the other panels
  await page.evaluate(() => window.__arail.selectTab("settings"));
  await expect(page.locator("#panel-settings")).toContainText("Uhrzeit");
  await page.evaluate(() => window.__arail.selectTab("control"));
  await expect(page.locator("#panel-settings")).toContainText("Leitsystem");
  await page.evaluate(() => window.__arail.selectTab("build"));
  await expect(page.locator("#panel-build")).toContainText("Zur Anlage hinzufügen");
  await expect(page.locator("#panel-build")).toContainText("Bahnsteig");
  await page.evaluate(() => window.__arail.selectTab("view"));
  // the card of RE 1 at the Czech track G3: its train data and where it may run, in German
  await page.evaluate(() => window.__arail.world.services.call("platform-1:right", { line: "RE 1" }));
  await page.waitForFunction(() => window.__arail.world.services.vehicles().some((v) => v.line === "RE 1" && v.dock.track === "G3" && v.phase === "dwelling"), null, { timeout: 20_000 });
  await page.evaluate(async () => {
    const ARail = await import("/arail/index.js");
    const app = window.__arail;
    app.inspector.show(ARail.movingPickables(app.world, app.lastView).find((p) => p.kind === "train" && p.ref.line === "RE 1" && p.ref.dock.track === "G3"));
  });
  const card = page.locator("#infoCard");
  await expect(card).toContainText("Zugdaten");
  await expect(card).toContainText("Bremshundertstel");
  await expect(card).toContainText("darf auf diesem Gleis nicht fahren");
  await expect(card).toContainText(/Gleis G3: nein · .*Nicht zugelassen in CZ/);
  await expect(card.getByRole("button", { name: "Infokarte schließen" })).toBeVisible();
  expect(await stillEnglish(page)).toEqual([]);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).include("#bar").include("#panel").include("#infoCard").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  expect(errors).toEqual([]);
});

test("View → Language switches without reloading and is kept on the device; ?lang= chooses for one link", async ({ page }) => {
  const errors = await openApp(page, "/app/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("tab", { name: "View" })).toBeVisible();
  await page.locator("#optLanguage").focus();
  await page.locator("#optLanguage").selectOption("de");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("tab", { name: "Ansicht" })).toBeVisible();
  await expect(page.locator("#panel-view")).toContainText("Sprache der App");
  await expect(page.locator("#optLanguage")).toBeFocused();
  await expect(page.locator("#toast")).toContainText("Deutsch");
  await expect(page.getByRole("button", { name: "Vollbild" })).toBeVisible();
  // kept: a reload is German
  await page.reload();
  await page.waitForFunction(() => window.__arail?.lastView);
  await expect(page.getByRole("tab", { name: "Ansicht" })).toBeVisible();
  // a link with ?lang=en is English, without changing the choice; choosing here follows into the link
  await page.goto("/app/?lang=en");
  await page.waitForFunction(() => window.__arail?.lastView);
  await expect(page.getByRole("tab", { name: "View" })).toBeVisible();
  await page.locator("#optLanguage").selectOption("de");
  await expect(page).toHaveURL(/lang=de/);
  await page.locator("#optLanguage").selectOption("en");
  await expect(page.getByRole("tab", { name: "View" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Full screen" })).toBeVisible();
  expect(errors).toEqual([]);
});
