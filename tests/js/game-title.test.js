// The game page's title screen (web/game/title.js): when the page opens with it, and that the script
// of web/game/index.html, which decides before the page is drawn, keeps the same rule.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SHELL_KEYS, TitleScreen, withLang } from "../../web/game/title.js";

const at = (search, hash = "") => ({ search, hash });

test("the title screen: without a case and without anything the app's shell acts on", () => {
  assert.equal(TitleScreen.wanted(at("")), true);
  assert.equal(TitleScreen.wanted(at("?lang=de")), true);
  // a shared link's tracking tags leave it
  assert.equal(TitleScreen.wanted(at("?utm_source=newsletter&fbclid=abc")), true);
  assert.equal(TitleScreen.wanted(at("?lang=de&utm_medium=social")), true);
  // a case, or anything the shell acts on, opens the shell
  assert.equal(TitleScreen.wanted(at("", "#infra")), false);
  for (const key of SHELL_KEYS) assert.equal(TitleScreen.wanted(at(`?${key}=1`)), false, key);
  assert.equal(TitleScreen.wanted(at("?utm_source=x&layout=../layouts/ebl-lab.json")), false);
});

test("the keys the shell acts on are those app.js reads from the address, and index.html decides with them", () => {
  const app = readFileSync(new URL("../../web/app/app.js", import.meta.url), "utf8");
  const read = new Set([...app.matchAll(/\bparams\.(?:get|has)\("(\w+)"\)/g)].map((m) => m[1]));
  assert.deepEqual([...read].sort(), [...SHELL_KEYS].sort(), "SHELL_KEYS of title.js are the parameters of app.js");
  const html = readFileSync(new URL("../../web/game/index.html", import.meta.url), "utf8");
  const list = html.match(/const shell = (\[[^\]]*\]);/);
  assert.ok(list, "the head script of index.html names the keys");
  assert.deepEqual(JSON.parse(list[1]), SHELL_KEYS, "index.html decides with SHELL_KEYS");
});

test("a link into the shell keeps the address's language; other links stay as they are", () => {
  assert.equal(withLang("?layout=a.json#infra", at("?lang=de")), "?layout=a.json&lang=de#infra");
  assert.equal(withLang("?layout=a.json#infra", at("")), "?layout=a.json#infra");
  assert.equal(withLang("play/", at("?lang=de")), "play/");
  assert.equal(withLang("?", at("?lang=de")), "?lang=de");
});
