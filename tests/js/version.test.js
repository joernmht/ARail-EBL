// The version check of the app (web/app/version.js) and the deploy that stamps the version (pages.yml).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isOutdated } from "../../web/app/version.js";

test("a published page is outdated when the site says another version; a page not published never", () => {
  assert.equal(isOutdated("abc123", "def456"), true);
  assert.equal(isOutdated("abc123", "abc123"), false);
  assert.equal(isOutdated("dev", "def456"), false);
  assert.equal(isOutdated("abc123", null), false); // version.json not read
  assert.equal(isOutdated("abc123", ""), false);
  assert.equal(isOutdated("", "def456"), false);
});

test("the pages carry the meta the deploy stamps, and the deploy stamps it and writes version.json", () => {
  for (const page of ["web/app/index.html", "web/game/index.html"]) {
    const html = readFileSync(page, "utf8");
    assert.equal(html.split('<meta name="arail-version" content="dev">').length, 2, `${page}: one meta arail-version, dev`);
  }
  const deploy = readFileSync(".github/workflows/pages.yml", "utf8");
  assert.match(deploy, /> web\/version\.json/);
  assert.match(deploy, /arail-version\\" content=\\"dev\\">\|<meta name=\\"arail-version\\" content=\\"\$v\\">\|" web\/app\/index\.html web\/game\/index\.html/);
  // the stamp comes before the upload: what is published has it
  assert.ok(deploy.indexOf("Stamp the version") < deploy.indexOf("upload-pages-artifact"));
});
