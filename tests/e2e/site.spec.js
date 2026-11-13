// The project page and the marker sheets.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("project page links to the app and the compare slider works", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page).toHaveTitle("ARail-EBL");
  await expect(page.getByRole("link", { name: "Open the app" })).toHaveAttribute("href", "app/");
  await page.locator("#compareRange").fill("20");
  await expect.poll(() => page.locator("#compare").evaluate((el) => el.style.getPropertyValue("--pos"))).toBe("20%");
  await page.locator("#compare").scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator("#compare img").evaluateAll((imgs) => imgs.map((i) => i.naturalWidth))).toEqual([1600, 1600]);
  // the video at the top: a real train through a virtual town, with its poster and a pause button
  const video = page.locator("#heroClip");
  await expect(video).toHaveAttribute("poster", "media/ebl-city-train.jpg");
  for (const src of ["media/ebl-city-train.jpg", await page.locator("#heroClip source").getAttribute("src")]) {
    expect((await page.request.get(`/${src}`)).ok(), src).toBe(true);
  }
  await expect(page.getByRole("button", { name: /^(Pause|Play) the video$/ })).toBeVisible();
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(width[0]).toBe(width[1]); // no horizontal scrolling
  expect(errors).toEqual([]);
});

test("the switch below the video shows the page of one group: its question, its ways, its way in and its board", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const groups = page.getByRole("group", { name: "Show me ARail for" });
  expect(await groups.getByRole("radio").evaluateAll((rs) => rs.map((r) => r.value))).toEqual(["educators", "scientists", "practitioners"]);
  // below the video, above the pages it switches
  const video = await page.locator("#heroVideo").boundingBox(), sw = await groups.boundingBox(), first = await page.locator("#educators").boundingBox();
  expect(sw.y).toBeGreaterThanOrEqual(video.y + video.height);
  expect(first.y).toBeGreaterThanOrEqual(sw.y + sw.height);
  // educators first; one page at a time, and one line for the group on every application
  await expect(page.getByRole("radio", { name: "Educators" })).toBeChecked();
  const shown = () => page.locator("section.pitch").evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => e.id));
  expect(await shown()).toEqual(["educators"]);
  await expect(page.getByRole("heading", { level: 2, name: /Do you teach it that way\?/ })).toBeVisible();
  expect(await page.locator(".app-card .teach").evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => e.dataset.aud))).toEqual(Array(6).fill("educators"));
  // each page: the question, three ways, three steps, a form to file it with, and its board
  const pages = [
    ["scientists", "Scientists", /Does it survive the whole railway\?/, "Submit a paper", "paper.yml", "Implemented papers"],
    ["practitioners", "Practitioners", /Does your training\?/, "Bring a case from practice", "practice_case.yml", "Cases from practice"],
    ["educators", "Educators", /Do you teach it that way\?/, "Propose a teaching concept", "teaching_concept.yml", "Teaching concepts"],
  ];
  for (const [id, name, question, cta, form, board] of pages) {
    await page.getByRole("radio", { name }).check();
    expect(await shown()).toEqual([id]);
    const section = page.locator(`#${id}`);
    await expect(section.getByRole("heading", { level: 2 })).toHaveText(question);
    await expect(section.locator(".ways li")).toHaveCount(3);
    await expect(section.locator(".route .path li")).toHaveCount(3);
    await expect(section.getByRole("link", { name: cta })).toHaveAttribute("href", `https://github.com/joernmht/ARail-EBL/issues/new?template=${form}`);
    await expect(section.getByRole("heading", { name: board })).toBeVisible();
    expect(await page.locator(".app-card .teach").evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => e.dataset.aud))).toEqual(Array(6).fill(id));
    // the choice is in the address, for a link to share
    expect(new URL(page.url()).searchParams.get("for")).toBe(id);
    const width = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(width[0]).toBe(width[1]);
  }
  // the arrow keys move the switch, as radio buttons do
  await page.getByRole("radio", { name: "Practitioners" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("radio", { name: "Scientists" })).toBeChecked();
  expect(await shown()).toEqual(["scientists"]);
  // a link with the group opens its page
  await page.goto("/?for=practitioners");
  await expect(page.getByRole("radio", { name: "Practitioners" })).toBeChecked();
  expect(await shown()).toEqual(["practitioners"]);
  // an unknown group: the first page
  await page.goto("/?for=nobody");
  expect(await shown()).toEqual(["educators"]);
  // the paper's way in says what filing it allows
  await page.getByRole("radio", { name: "Scientists" }).check();
  await expect(page.locator("#scientists .route .path")).toContainText("give the paper to an AI");
  await expect(page.locator("#scientists .route .path")).toContainText("not republished");
  expect(errors).toEqual([]);
});

test("the boards list what has been brought, with its status and its links; empty, they say so", async ({ page }) => {
  await page.goto("/");
  // as the repository has it: nothing yet is said, not left blank
  for (const kind of ["teaching", "papers", "practice"]) await expect(page.locator(`[data-refs="${kind}"] li`)).toHaveCount(1);
  await expect(page.locator('[data-refs="teaching"]')).toContainText("The board is empty.");
  await page.route("**/references.json", (route) => route.fulfill({
    json: {
      teaching: [
        { title: "A morning at Bf Neustadt for three courses", by: "S. Fink, Chair of Railway Operations", status: "implemented", issue: 12, link: "game/play/?mission=neustadt-morning" },
        { title: "Passenger rights after a lost connection", by: "M. van Kraai", status: "in-progress", issue: 13 },
        { title: "A mark-up <img src=x onerror=window.__ran=1>", status: "proposed", issue: 14, link: "javascript:window.__ran=1" },
        { title: "Of an unknown status", status: "done" },
      ],
      papers: [{ title: "Holding connections under delay", by: "W. Sokół", status: "proposed", source: "https://doi.org/10.0000/example", issue: 15 }],
    },
  }));
  await page.reload();
  const rows = page.locator('[data-refs="teaching"] li');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("A morning at Bf Neustadt for three courses");
  await expect(rows.nth(0)).toContainText("S. Fink, Chair of Railway Operations");
  await expect(rows.nth(0).locator(".state")).toHaveText("Implemented");
  await expect(rows.nth(0).getByRole("link", { name: "Open it" })).toHaveAttribute("href", /\/game\/play\/\?mission=neustadt-morning$/);
  await expect(rows.nth(0).getByRole("link", { name: "Issue #12" })).toHaveAttribute("href", "https://github.com/joernmht/ARail-EBL/issues/12");
  await expect(rows.nth(1).locator(".state")).toHaveText("In progress");
  await expect(rows.nth(1).getByRole("link", { name: "Open it" })).toHaveCount(0);
  // what is in the file is shown as text, and only links of this site or https ones become links
  await expect(rows.nth(2)).toContainText("<img src=x onerror=window.__ran=1>");
  await expect(rows.nth(2).locator(".state")).toHaveText("Proposed");
  await expect(rows.nth(2).locator("img")).toHaveCount(0);
  expect(await page.locator('main a[href^="javascript:"]').count()).toBe(0);
  expect(await page.evaluate(() => window.__ran)).toBeUndefined();
  // a paper links to where it is published
  await page.getByRole("radio", { name: "Scientists" }).check();
  await expect(page.locator('[data-refs="papers"]').getByRole("link", { name: "Holding connections under delay" })).toHaveAttribute("href", "https://doi.org/10.0000/example");
  // a kind the file does not have keeps its empty board
  await expect(page.locator('[data-refs="practice"] li')).toHaveCount(1);
  // readable on the board
  const results = await new AxeBuilder({ page }).include(".refs").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} ${n.any.map((c) => c.message).join(" ")}`).join("; ")}`)).toEqual([]);
});

test("project page shows what runs today, each application opening an example in the app", async ({ page, request }) => {
  await page.goto("/");
  // what runs, how it gets onto a lab's table, what is next, in this order
  const order = await page.locator("#base, #applications, #next").evaluateAll((els) => els.map((e) => e.id));
  expect(order).toEqual(["applications", "base", "next"]);
  const cards = await page.locator(".app-card").evaluateAll((els) => els.map((e) => e.id));
  expect(cards).toEqual(["app-town", "app-terminal", "app-operations", "app-infrastructure", "app-journeys", "app-disruptions"]);
  const examples = await page.getByRole("link", { name: "Open this example" }).evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  expect(examples).toHaveLength(6);
  // the cards of the stories: the story in the app, the game on the game page
  // (the app's case of each story; the game page's case of each game)
  for (const [card, layer, story, game] of [["#app-infrastructure", "infrastructure", "infra-disruption", "infra"], ["#app-journeys", "journeys", "journeys", "journeys"]]) {
    await expect(page.locator(`${card} .acts a.btn.primary`)).toHaveAttribute("href", `app/?layout=../layouts/ebl-neustadt.json&layers=${layer}#${story}`);
    await expect(page.locator(`${card} .acts a`, { hasText: "The game" })).toHaveAttribute("href", `game/?layout=../layouts/ebl-lab.json&layers=${layer}#${game}`);
  }
  // no dated "new from the lab" section: what is new goes to the changelog (#181)
  await expect(page.locator("#lab, .fresh")).toHaveCount(0);
  // the examples of the app (app/main.js) and of the game page (game/main.js)
  const pages = { app: await (await request.get("/app/main.js")).text(), game: await (await request.get("/game/main.js")).text() };
  const links = [...examples, ...(await page.locator(".app-card .acts a[href^='app/'], .app-card .acts a[href^='game/']").evaluateAll((as) => as.map((a) => a.getAttribute("href"))))];
  for (const href of links) {
    const page = href.split("/")[0], params = new URL(href, "http://x/").searchParams;
    if (params.has("example")) {
      expect(pages[page], href).toContain(`id: "${params.get("example")}"`);
      continue;
    }
    const layout = params.get("layout");
    expect((await request.get(new URL(layout, `http://localhost/${page}/`).pathname)).ok(), layout).toBe(true);
  }
  // the stories of the app open their module of Bf Neustadt; their games are a link to the game page
  const neustadt = await (await request.get("/layouts/ebl-neustadt.json")).json();
  for (const [card, layer, story, game] of [["#app-operations", "operations", "evu-disruption", "ops"], ["#app-infrastructure", "infrastructure", "infra-disruption", "infra"]]) {
    await expect(page.locator(`${card} a.btn.primary`)).toHaveAttribute("href", `app/?layout=../layouts/ebl-neustadt.json&layers=${layer}#${story}`);
    await expect(page.locator(`${card} .acts a`, { hasText: "The game" })).toHaveAttribute("href", `game/?layout=../layouts/ebl-lab.json&layers=${layer}#${game}`);
    expect(neustadt.layers.map((l) => l.id), card).toContain(layer);
  }
  // cooperation: the contact person by email
  await expect(page.getByRole("link", { name: "Get in touch" })).toHaveAttribute("href", /^mailto:joern\.maurischat@tu-dresden\.de/);
  const images = await page.locator(".app-card img").evaluateAll((imgs) => imgs.map((i) => i.getAttribute("src")));
  for (const src of images) expect((await request.get(`/${src}`)).ok(), src).toBe(true);
});

test("project page fits a phone: the video first, no horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const pic = await page.locator("#heroVideo").boundingBox();
  const title = await page.getByRole("heading", { level: 1 }).boundingBox();
  expect(pic.y).toBeLessThan(title.y);
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(width[0]).toBe(width[1]);
});

test("marker sheets have the exact paper size and validate the input", async ({ page }) => {
  await page.goto("/markers/");
  await expect(page.locator("#status")).toHaveText("8 markers on 1 sheet.");
  const sheet = page.locator("svg.sheet").first();
  await expect(sheet).toHaveAttribute("width", "210mm");
  await expect(sheet).toHaveAttribute("height", "297mm");
  // printed on the chosen paper
  await expect.poll(() => page.locator("#pageSize").evaluate((el) => el.textContent)).toContain("size: 210mm 297mm");
  // the ID label lies below the white border, which must stay empty for detection
  const g = await sheet.evaluate((svg) => {
    const square = svg.querySelector('rect[fill="#000"]');
    return { bottom: Number(square.getAttribute("y")) + Number(square.getAttribute("height")), label: Number(svg.querySelector("text").getAttribute("y")) };
  });
  expect(g.label - 3.4).toBeGreaterThanOrEqual(g.bottom + 6);
  await page.locator("#ids").fill("0-59");
  await expect(page.locator("#status")).toHaveText(/60 markers on \d+ sheets\./);
  await page.locator("#ids").fill("seven");
  await expect(page.locator("#status")).toHaveClass(/error/);
});

test("deck cards for model wagons have the exact spot pitch and validate the input", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/markers/?kind=rolling");
  await expect(page.locator("#status")).toHaveText("6 cards with 18 markers on 1 sheet.");
  await expect(page.locator("#rollingFields")).toBeVisible();
  await expect(page.locator("#ids")).toBeHidden();
  await expect(page.locator("#kind")).toHaveValue("rolling");
  // the truck chassis is not model rolling stock; "all" (every ID per wagon) is for label sheets
  expect(await page.locator("#wagonType option").evaluateAll((os) => os.map((o) => o.value))).toEqual(["sgns60", "lgns40", "sggrss80", "all"]);
  const sheet = page.locator("svg.sheet").first();
  await expect(sheet).toHaveAttribute("width", "210mm");
  const g = await sheet.evaluate((svg) => {
    const num = (el, a) => Number(el.getAttribute(a));
    const card = svg.querySelector('rect[stroke]');
    const tags = [...svg.querySelectorAll('rect[fill="#000"]')].slice(0, 3);
    const label = [...svg.querySelectorAll("text")].find((t) => t.textContent.startsWith("W1 "));
    return {
      card: { x: num(card, "x"), y: num(card, "y"), w: num(card, "width"), h: num(card, "height") },
      tags: tags.map((t) => ({ x: num(t, "x"), y: num(t, "y"), size: num(t, "width") })),
      label: { y: num(label, "y"), text: label.textContent },
    };
  });
  // tags at the 6.1 m spot pitch of an Sgns in H0 (70.1 mm), inside the card; the label below it
  expect(Math.abs(g.tags[0].x - g.tags[1].x - 70.1)).toBeLessThanOrEqual(0.1);
  expect(Math.abs(g.tags[1].x - g.tags[2].x - 70.1)).toBeLessThanOrEqual(0.1);
  expect(g.card.h).toBeCloseTo(28.0, 1);
  for (const t of g.tags) {
    expect(t.size).toBe(20);
    expect(t.x).toBeGreaterThanOrEqual(g.card.x + 2.5 - 0.001);
    expect(t.x + t.size).toBeLessThanOrEqual(g.card.x + g.card.w - 2.5 + 0.001);
  }
  expect(g.label.text).toBe("W1 · Sgns (60 ft) · IDs 0–2");
  expect(g.label.y - 3.4).toBeGreaterThanOrEqual(g.card.y + g.card.h);
  // an 80 ft wagon's card is longer than a portrait sheet is wide
  await page.locator("#wagonType").selectOption("sggrss80");
  await expect(page.locator("#status")).toHaveText("6 cards with 24 markers on 2 sheets.");
  await expect(sheet).toHaveAttribute("width", "297mm");
  await expect.poll(() => page.locator("#pageSize").evaluate((el) => el.textContent)).toContain("size: 297mm 210mm");
  // bad input
  await page.locator("#tagSize").fill("24");
  await expect(page.locator("#status")).toHaveClass(/error/);
  await expect(page.locator("#status")).toHaveText("Tags of 24 mm do not fit on the deck (at most 23 mm)");
  await page.locator("#tagSize").fill("20");
  await page.locator("#wagons").fill("one");
  await expect(page.locator("#status")).toHaveClass(/error/);
  await page.locator("#wagons").fill("146-147");
  await expect(page.locator("#status")).toHaveText("Wagon 147 needs ID 587; AprilTag 36h11 has 587 IDs");
  await page.locator("#wagons").fill("3");
  await expect(page.locator("#status")).toHaveText("1 card with 4 markers on 1 sheet.");
  await expect(page.locator("#status")).not.toHaveClass(/error/);
  // back to the markers for the layout
  await page.locator("#kind").selectOption("markers");
  await expect(page.locator("#status")).toHaveText("8 markers on 1 sheet.");
  await expect(page.locator("#rollingFields")).toBeHidden();
  expect(new URL(page.url()).searchParams.get("kind")).toBeNull();
  expect(errors).toEqual([]);
});

test("label sheets: one tag per container spot on 63.5 × 29.6 mm labels, layout markers on 60 × 60 mm labels", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/markers/?kind=rolling&paper=labels63x30&type=all&wagons=1-25");
  await expect(page.locator("#status")).toHaveText("100 tags on 4 sheets of 63.5 × 29.6 mm labels; 8 labels left over.");
  await expect(page.locator("#labelFields")).toBeVisible();
  await expect(page.locator("#scale")).toBeHidden();
  const first = await page.locator("svg.sheet").first().evaluate((svg) => {
    const r = svg.querySelector('rect[fill="#000"]');
    return ["x", "y", "width"].map((a) => Number(r.getAttribute(a)));
  });
  expect(first).toEqual([7.25 + 21.75, 15.3 + 4.8, 20]);
  await page.locator("#skip").fill("26");
  await expect(page.locator("#status")).toHaveText("100 tags on 5 sheets of 63.5 × 29.6 mm labels; 9 labels left over.");
  await page.locator("#paper").selectOption("a4");
  await expect(page.locator("#status")).toHaveText("“Every ID per wagon” is for label sheets: choose a wagon type for deck cards");
  await page.goto("/markers/?paper=labels60x60&ids=0-99&size=40");
  await expect(page.locator("#status")).toHaveText("100 markers on 9 sheets of 60 × 60 mm labels; 8 labels left over.");
  await expect(page.locator("#cutlines")).toBeHidden();
  await page.locator("#size").fill("50");
  await expect(page.locator("#status")).toHaveText(/at most 43 mm/);
  // the ready-made sets are links that fill in the form
  await page.getByRole("link", { name: "Wagon tags, IDs 0–99" }).click();
  await expect(page.locator("#status")).toHaveText("100 tags on 4 sheets of 63.5 × 29.6 mm labels; 8 labels left over.");
  await page.getByRole("link", { name: "60 × 60 mm", exact: true }).click();
  await expect(page.locator("#outlines")).toBeChecked();
  await expect(page.locator("#status")).toHaveText("12 markers on 1 sheet of 60 × 60 mm labels; 0 labels left over.");
  // any other sheet from its measurements
  await page.locator("#paper").selectOption("custom");
  await expect(page.locator("#cw")).toBeVisible();
  await page.locator("#cw").fill("70");
  await page.locator("#ch").fill("37");
  await page.locator("#crows").fill("8");
  await page.locator("#cpx").fill("70");
  await page.locator("#cpy").fill("37");
  await page.locator("#cleft").fill("0");
  await page.locator("#ctop").fill("0.5");
  await expect(page.locator("#status")).toHaveText(/40 mm do not fit on 70 × 37 mm labels .*at most 25 mm/);
  await page.locator("#size").fill("20");
  await expect(page.locator("#status")).toHaveText("12 markers on 1 sheet of 70 × 37 mm labels; 12 labels left over.");
  await page.locator("#crows").fill("9");
  await expect(page.locator("#status")).toHaveText(/do not fit on A4/);
  await page.locator("#crows").fill("8");
  await page.locator("#paper").selectOption("labels60x60");
  await expect(page.locator("#cw")).toBeHidden();
  // the printer shift is kept for the next visit
  await page.locator("#shiftX").fill("1.5");
  await page.reload();
  await expect(page.locator("#shiftX")).toHaveValue("1.5");
  expect(errors).toEqual([]);
});

test("deck card settings come from the address; bad values are shown, not corrected", async ({ page }) => {
  await page.goto("/markers/?kind=rolling&type=lgns40&wagons=2,5&stride=3&size=10&scale=160");
  await expect(page.locator("#wagonType")).toHaveValue("lgns40");
  await expect(page.locator("#wagons")).toHaveValue("2,5");
  await expect(page.locator("#stride")).toHaveValue("3");
  await expect(page.locator("#tagSize")).toHaveValue("10");
  await expect(page.locator("#scale")).toHaveValue("160");
  await expect(page.locator("#status")).toHaveText("2 cards with 4 markers on 1 sheet.");
  // unknown type and scale: the defaults; a bad stride: an error
  await page.goto("/markers/?kind=rolling&type=chassis40&scale=99&stride=9");
  await expect(page.locator("#wagonType")).toHaveValue("sgns60");
  await expect(page.locator("#scale")).toHaveValue("87");
  await expect(page.locator("#stride")).toHaveValue("9");
  await expect(page.locator("#status")).toHaveClass(/error/);
  await expect(page.locator("#status")).toHaveText("IDs per wagon must be a whole number from 1 to 8");
});

for (const scheme of ["light", "dark"]) {
  test(`deck card settings have no accessibility violations (${scheme} mode)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/markers/?kind=rolling");
    await expect(page.locator("#status")).toHaveText(/cards with/);
    const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
    const summary = async () => (await new AxeBuilder({ page }).withTags(tags).analyze()).violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`);
    expect(await summary()).toEqual([]);
    // with an error message shown
    await page.locator("#tagSize").fill("30");
    await expect(page.locator("#status")).toHaveClass(/error/);
    expect(await summary()).toEqual([]);
  });
}

test("the 404 page links back to the site", async ({ page }) => {
  await page.goto("/404.html");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
  // GitHub Pages serves it for any missing address, so the links are absolute
  await expect(page.getByRole("link", { name: "Open the app" })).toHaveAttribute("href", "/ARail-EBL/app/");
});

test("every page links to the Impressum and the Datenschutzerklärung, which give the operator", async ({ page, request }) => {
  for (const path of ["/", "/markers/", "/lab-map/", "/architecture/", "/404.html", "/impressum/", "/datenschutz/"]) {
    await page.goto(path);
    for (const [name, target] of [[/^Impressum$/, "impressum/"], [/^Datenschutz/, "datenschutz/"]]) {
      const link = page.getByRole("link", { name });
      if (path.startsWith(`/${target}`)) continue;
      await expect(link, `${path}: ${name}`).toHaveCount(1);
      const href = new URL(await link.getAttribute("href"), page.url()).pathname.replace(/^\/ARail-EBL/, "");
      expect(href, `${path}: ${name}`).toBe(`/${target}`);
      expect((await request.get(href)).ok(), href).toBe(true);
    }
  }
  // the project page's own footer is the way there from the app (the brand links to it)
  await page.goto("/app/?layout=../layouts/ebl-lab.json");
  await expect(page.locator("#bar .brand")).toHaveAttribute("href", "../");
  for (const path of ["/impressum/", "/datenschutz/"]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.locator("main address")).toContainText("Jörn Maurischat");
    await expect(page.locator("main address")).toContainText("01062 Dresden");
    await expect(page.locator("main").getByRole("link", { name: "joern.maurischat@tu-dresden.de" })).toHaveAttribute("href", "mailto:joern.maurischat@tu-dresden.de");
    const width = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(width[0]).toBe(width[1]);
  }
});
