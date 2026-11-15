// The date and the weather in the app (#254): Settings → Simulation → Date and weather, the chip on
// the stage, snow in the flyover, in English and in German.
import { expect, test } from "@playwright/test";
import { viewTo } from "./ui.js";

const LAB = "/app/?layout=../layouts/ebl-lab.json";

async function open(page, path) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(LAB);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.reload(); // a change of the hash alone loads nothing
  await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
  return errors;
}

test("Settings → Simulation sets the season and the weather; the stage's chip shows them, the Overview measures them; the flyover draws the snow", async ({ page }) => {
  const errors = await open(page, `${LAB}#simulate`);
  // nothing set: no chip, no date
  await expect(page.locator("#hud .chip.weather")).toHaveCount(0);
  await expect(page.locator("#datePreset")).toHaveValue("");
  // winter: 15 December 2026, a Tuesday
  await page.locator("#datePreset").selectOption("12-15");
  await expect(page.locator("#hud .chip.weather")).toHaveText(/^Tue 15 Dec · \d\d:\d\d$/);
  // snowfall
  await page.locator("#weatherSelect").selectOption("snow");
  await expect(page.locator("#hud .chip.weather")).toHaveText(/^Tue 15 Dec · \d\d:\d\d · −2 °C · snow$/);
  // the Overview: the weather in one figure, the rails and the sun of that day in its note
  await page.locator("#tab-overview").click();
  const weather = page.locator("#measures [data-measure=weather]");
  await expect(weather.locator(".measure-value")).toHaveText("−2 °C · snow");
  await expect(weather.locator(".measure-note")).toContainText("Rails: Wet");
  await expect(weather.locator(".measure-note")).toContainText(/Sunrise 0[78]:\d\d · Sunset 15:5\d/);
  // the flyover: more of the picture is white than without the snow
  await viewTo(page, "flyover");
  const white = () => page.evaluate(() => {
    const a = window.__arail;
    a.flyover.anim = null;
    a.flyover.cam.set({ target: [500, -900], distance: 2600, yaw: Math.PI / 2, pitch: 1.2 });
    a.world.setTime("12:00");
    a.render();
    const { width, height } = a.canvas, data = a.ctx.getImageData(0, 0, width, height).data;
    // the mean brightness of the picture (every seventh pixel)
    let sum = 0, n = 0;
    for (let i = 0; i < data.length; i += 4 * 7) {
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      n++;
    }
    return sum / n;
  });
  const snowy = await white();
  // overcast on bare ground (after snowfall, the snow would lie on)
  await page.evaluate(() => window.__arail.world.setWeather({ preset: "overcast", snow_cm: 0 }));
  const overcast = await white();
  expect(snowy).toBeGreaterThan(overcast + 8); // the same grey sky, but the ground and the roofs are white
  // a scenario may have set them: the presets follow, a date that is no preset as an option of its own
  await page.evaluate(() => { window.__arail.world.setDate("2028-07-10"); window.__arail.world.setWeather("off"); });
  await page.locator("#tab-settings").click();
  await expect(page.locator("#datePreset")).toHaveValue("07-10");
  await expect(page.locator("#datePreset option:checked")).toHaveText("Monday, 10 July 2028");
  await expect(page.locator("#weatherSelect")).toHaveValue("off");
  await expect(page.locator("#hud .chip.weather")).toHaveText(/^Mon 10 Jul · \d\d:\d\d$/);
  // the demand: a preset, and one a scenario set (not a preset) as an option of its own
  await page.locator("#demandPreset").selectOption({ label: "Busy (× 2)" });
  expect(await page.evaluate(() => window.__arail.world.demand)).toBe(2);
  await page.evaluate(() => (window.__arail.world.demand = 1.5));
  await expect(page.locator("#demandPreset")).toHaveValue("1.5");
  await expect(page.locator("#demandPreset option:checked")).toHaveText("× 1.50");
  // no date again
  await page.locator("#datePreset").selectOption("");
  await expect(page.locator("#hud .chip.weather")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the season and the weather in German", async ({ page }) => {
  const errors = await open(page, `${LAB}&lang=de#simulate`);
  await expect(page.getByRole("heading", { name: "Jahreszeit und Wetter" })).toBeVisible();
  await page.locator("#datePreset").selectOption({ label: "Winter (15. Dezember)" });
  await page.locator("#weatherSelect").selectOption({ label: "Schneefall" });
  await expect(page.locator("#hud .chip.weather")).toHaveText(/^Di\. 15\. Dez\. · \d\d:\d\d · −2 °C · Schnee$/);
  await page.locator("#weatherSelect").selectOption({ label: "Gewitter" });
  await expect(page.locator("#hud .chip.weather")).toContainText("Gewitter");
  await page.locator("#tab-overview").click();
  const note = page.locator("#measures [data-measure=weather] .measure-note");
  await expect(note).toContainText(/Sonnenuntergang 15:5\d/);
  await expect(note).toContainText("Schienen: Nass");
  const missing = await page.evaluate(async () => [...(await import("/app/i18n.js")).i18n.missing].filter((t) => /Sunrise|Sunset|snow|Weather|Season|Winter|Rails|ground|day|December|thunder|Measured/.test(t)));
  expect(missing).toEqual([]);
  expect(errors).toEqual([]);
});
