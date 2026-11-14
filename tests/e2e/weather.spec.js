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

test("Settings → Simulation sets the date and the weather; the stage's chip shows them; the flyover draws the snow", async ({ page }) => {
  const errors = await open(page, `${LAB}#simulate`);
  // nothing set: no chip, the hint says so
  await expect(page.locator("#hud .chip.weather")).toHaveCount(0);
  await expect(page.locator("#weatherNow")).toHaveText("No date and no weather: every day is the same mild day.");
  await expect(page.locator("#dateDay")).toBeDisabled();
  // 6 December: the sun of that day
  await page.locator("#dateMonth").selectOption("12");
  await page.locator("#dateDay").fill("6");
  await page.locator("#dateDay").dispatchEvent("change");
  await expect(page.locator("#weatherNow")).toContainText("Sunrise 07:5");
  await expect(page.locator("#weatherNow")).toContainText("Sunset 15:5");
  await expect(page.locator("#hud .chip.weather")).toHaveText("6 Dec");
  // snowfall
  await page.locator("#weatherSelect").selectOption("snow");
  await expect(page.locator("#weatherNow")).toContainText("−2 °C · snow");
  await expect(page.locator("#weatherNow")).toContainText("Rails: Wet");
  await expect(page.locator("#hud .chip.weather")).toHaveText("6 Dec · −2 °C · snow");
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
  await page.evaluate(() => window.__arail.world.setWeather("overcast"));
  const overcast = await white();
  expect(snowy).toBeGreaterThan(overcast + 8); // the same grey sky, but the ground and the roofs are white
  // a scenario may have set them: the fields follow
  await page.evaluate(() => { window.__arail.world.setDate("07-10"); window.__arail.world.setWeather("off"); });
  await expect(page.locator("#dateMonth")).toHaveValue("7");
  await expect(page.locator("#weatherSelect")).toHaveValue("off");
  await expect(page.locator("#hud .chip.weather")).toHaveText("10 Jul");
  // no date again
  await page.locator("#dateMonth").selectOption("0");
  await expect(page.locator("#hud .chip.weather")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the date and the weather in German", async ({ page }) => {
  const errors = await open(page, `${LAB}&lang=de#simulate`);
  await expect(page.getByRole("heading", { name: "Datum und Wetter" })).toBeVisible();
  await page.locator("#dateMonth").selectOption({ label: "Dezember" });
  await page.locator("#weatherSelect").selectOption({ label: "Schneefall" });
  await expect(page.locator("#hud .chip.weather")).toHaveText("1. Dez. · −2 °C · Schnee");
  await expect(page.locator("#weatherNow")).toContainText("Sonnenuntergang 16:0");
  await expect(page.locator("#weatherNow")).toContainText("Schienen: Nass");
  const missing = await page.evaluate(async () => [...(await import("/app/i18n.js")).i18n.missing].filter((t) => /Sunrise|Sunset|snow|Weather|Month|Rails|ground/.test(t)));
  expect(missing).toEqual([]);
  expect(errors).toEqual([]);
});
