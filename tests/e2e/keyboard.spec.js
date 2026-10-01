// Keyboard-only use of the main flows (switch panels, place an object, fly the virtual camera, set
// the time) and what keyboard users must see: the focus on every control, and stage controls that
// are not hidden behind the placing bar (WCAG 2.2: 2.1.1 Keyboard, 2.4.7 Focus Visible, 2.4.11
// Focus Not Obscured).
import { expect, test } from "@playwright/test";

async function openApp(page, path = "/app/") {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForFunction(() => window.__arail?.tracker.state.H, null, { timeout: 30_000 });
  return errors;
}

/** Press Tab (or Shift+Tab) until `selector` has the focus; fails after `max` presses. */
async function tabTo(page, selector, { back = false, max = 80 } = {}) {
  for (let i = 0; i < max; i++) {
    if (await page.locator(selector).evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
  }
  throw new Error(`${selector} not reached with ${back ? "Shift+Tab" : "Tab"}`);
}

/** Buttons over the stage that are not (completely) visible: another element is on top of them. */
const hiddenStageButtons = (page) => page.evaluate(() => {
  const out = [];
  for (const b of document.querySelectorAll("#stageWrap button, #stageWrap label.btn")) {
    const q = b.getBoundingClientRect();
    if (!q.width || b.closest("[hidden]") || q.bottom > innerHeight || q.top < 0) continue;
    const corners = [[0.5, 0.5], [0.1, 0.15], [0.9, 0.15], [0.1, 0.85], [0.9, 0.85]];
    const covered = corners.filter(([fx, fy]) => {
      const top = document.elementFromPoint(q.left + q.width * fx, q.top + q.height * fy);
      return top !== b && !b.contains(top);
    });
    if (covered.length) out.push(`${b.dataset.fly || b.id || b.textContent.trim()} (${covered.length} of 5 points covered)`);
  }
  return out;
});

test("the buttons that open files show the keyboard focus", async ({ page }) => {
  await openApp(page, "/app/#view");
  const outline = (id) => page.locator(`label[for="${id}"]`).evaluate((el) => getComputedStyle(el).outlineStyle);
  // header: Take photo, Record video, Open file (labels of hidden file inputs)
  await page.locator(".brand").focus();
  for (const id of ["filePhoto", "fileVideo", "fileOpen"]) {
    await tabTo(page, `#${id}`, { max: 4 });
    expect(await outline(id), `focus ring on the “${id}” button`).not.toBe("none");
  }
  // View panel: Load calibration
  await page.locator("#btnFlyoverPanel").focus();
  await tabTo(page, "#calibrationFile");
  expect(await outline("calibrationFile")).not.toBe("none");
  // Build panel: Import layout and Survey a video
  await page.locator("#tab-build").click();
  await page.locator("#layoutNameField").focus();
  await tabTo(page, "#layoutImport");
  expect(await outline("layoutImport")).not.toBe("none");
  await tabTo(page, "#surveyVideo");
  expect(await outline("surveyVideo")).not.toBe("none");
  // a mouse click on the label does not draw the ring
  await page.locator("#tab-view").click();
  expect(await outline("calibrationFile")).toBe("none");
});

for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["tablet", { width: 1024, height: 768 }], ["phone", { width: 390, height: 844 }]]) {
  test(`the placing bar leaves the stage buttons free (${name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = await openApp(page, "/app/#build");
    await page.locator(".palette").getByRole("button", { name: /^Street/ }).click();
    await expect(page.locator("#placing")).toBeVisible();
    await page.locator("#stageWrap").scrollIntoViewIfNeeded();
    expect(await hiddenStageButtons(page), "camera view").toEqual([]);
    // the Flyover button can be pressed while placing (with the mouse, too)
    await page.locator("#btnFlyover").click();
    await page.waitForFunction(() => window.__arail.mode === "flyover");
    await expect(page.locator("#placing")).toBeVisible();
    await page.locator("#stageWrap").scrollIntoViewIfNeeded();
    expect(await hiddenStageButtons(page), "flyover").toEqual([]);
    // a message while placing does not hide the placing bar either
    await page.evaluate(() => window.__arail.editor.finish()); // "Tap at least 2 points."
    await expect(page.locator("#toast")).toBeVisible();
    expect(await hiddenStageButtons(page), "flyover with a message").toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("keyboard only: switch panels, fly the virtual camera, place a tree on the grid, set the time", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await openApp(page, "/app/#view");
  const a = (fn) => page.evaluate(fn);
  // F switches the flyover on and gives the stage the keyboard
  await page.locator("#panel-view .hint").first().click();
  await page.keyboard.press("f");
  await page.waitForFunction(() => window.__arail.mode === "flyover");
  await expect(page.locator("#stage")).toBeFocused();
  for (const key of ["Home", "PageUp", "PageUp", "PageUp", "PageUp", "PageUp"]) await page.keyboard.press(key); // whole layout, plan view
  // the panels: Tab to the selected tab, arrows switch
  await tabTo(page, "#tab-view");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#tab-build")).toBeFocused();
  await expect(page.locator("#panel-build")).toBeVisible();
  // pick the tree in the palette
  const tree = page.locator(".palette").getByRole("button", { name: /^Tree/ });
  await tabTo(page, ".palette button[title='A single tree.']");
  await page.keyboard.press("Enter");
  await expect(tree).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#placing")).toContainText("Enter");
  // back to the stage: the arrows move the view, Enter places the tree at the cross in the middle
  await tabTo(page, "#stage", { back: true });
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  const aim = await a(() => {
    const f = window.__arail.flyover, c = window.__arail.canvas;
    return f.groundPoint(c.width / 2, c.height / 2);
  });
  const trees = () => a(() => window.__arail.world.objects.filter((o) => o.type === "tree").map((o) => o.spec.position));
  const before = (await trees()).length;
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await trees()).length).toBe(before + 1);
  const pos = (await trees()).at(-1);
  // on the 50 mm grid, at the middle of the view
  expect(Math.abs(pos[0] % 50)).toBe(0);
  expect(Math.abs(pos[1] % 50)).toBe(0);
  expect(Math.hypot(pos[0] - aim[0], pos[1] - aim[1])).toBeLessThan(40);
  await expect(page.locator("#stage")).toBeFocused();
  // the time of day: Simulate → slider and presets
  await tabTo(page, "#tab-build");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#tab-simulate")).toBeFocused();
  await tabTo(page, "#timeOfDay");
  const t0 = await a(() => window.__arail.world.clock.minutes);
  await page.keyboard.press("ArrowRight"); // one quarter of an hour on from the quarter the slider shows
  const t1 = await a(() => window.__arail.world.clock.minutes);
  expect(t1).toBeGreaterThan(t0 + 1);
  expect(t1).toBeLessThan(t0 + 23);
  expect(t1 % 15).toBeLessThan(2);
  await tabTo(page, "#panel-simulate button:has-text('Night 22:30')");
  await page.keyboard.press("Enter");
  expect(await a(() => window.__arail.world.clock.label())).toMatch(/^22:3/);
  expect(errors).toEqual([]);
});
