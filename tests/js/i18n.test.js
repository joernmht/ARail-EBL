// Texts in other languages (arail/i18n): the translator (English text as the key, patterns with
// placeholders, plural forms, the parts between " · ", number formats) and the catalogues: the
// framework's and the app's German texts are complete where the code asks for a text by name, the
// page's own markup is translated, and every translation keeps the placeholders of its English text.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { Registry, Translator, UI_LANGUAGES, placeholders, registry } from "../../web/arail/index.js";
import { DE as FRAMEWORK_DE } from "../../web/arail/i18n/de.js";
import { EN as FRAMEWORK_EN } from "../../web/arail/i18n/en.js";
import { DE as APP_DE } from "../../web/app/lang/de.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");

/** The app's translator as the app makes it: the registry's texts, then the app's. */
function appTranslator(lang = "de") {
  const t = new Translator(lang);
  for (const [l, entries] of registry.texts) t.add(l, entries);
  return t.add("de", APP_DE);
}

test("the translator: exact texts, patterns with placeholders, plurals, the parts between ·", () => {
  const t = new Translator("de", {
    en: { "{n} tracks": { one: "{n} track" } },
    de: {
      "Colour the tracks by": "Gleise färben nach",
      "{n} tracks": { one: "{n} Gleis", other: "{n} Gleise" },
      "{n} min late": "{n} min Verspätung",
      "Waiting for {what}": "Wartet auf {what}",
      "the bus": "den Bus",
      "Track {id}": "Gleis {id}",
      "{id} ({n} t per axle)": "{id} ({n} t Radsatzlast)",
    },
  });
  assert.equal(t.translate("Colour the tracks by"), "Gleise färben nach");
  assert.equal(t.translate("1 track"), "1 Gleis", "the English singular is a pattern too");
  assert.equal(t.translate("3 tracks"), "3 Gleise");
  assert.equal(t.translate("Waiting for the bus"), "Wartet auf den Bus", "the variable part is translated in turn");
  assert.equal(t.translate("4 min late · Waiting for the bus"), "4 min Verspätung · Wartet auf den Bus");
  assert.equal(t.translate("D4 (22.5 t per axle)"), "D4 (22,5 t Radsatzlast)", "numbers get the decimal comma");
  assert.equal(t.translate("Track G3"), "Gleis G3");
  assert.equal(t.translate("Track systems of the layout"), "Track systems of the layout", "{id} is one word: no false match");
  assert.equal(t.translate("not in the catalogue"), "not in the catalogue", "what has no translation stays English");
  assert.ok(t.missing.has("not in the catalogue") && !t.missing.has("Track G3"), "and is noted as missing");
  // t(): by its English text, with parameters and the plural form
  assert.equal(t.t("{n} tracks", { n: 1 }), "1 Gleis");
  assert.equal(t.t("{n} tracks", { n: 1234.5 }), "1.234,5 Gleise");
  assert.equal(t.t("Waiting for {what}", { what: "the bus" }), "Wartet auf den Bus");
  // English: as written, the singular from the English catalogue
  t.setLanguage("en");
  assert.equal(t.translate("3 tracks"), "3 tracks");
  assert.equal(t.t("{n} tracks", { n: 1 }), "1 track");
  assert.equal(t.t("{n} tracks", { n: 2 }), "2 tracks");
  // an unknown language: English
  t.setLanguage("fr");
  assert.equal(t.translate("Colour the tracks by"), "Colour the tracks by");
});

test("formats: numbers, euros and dates in the language shown", () => {
  const t = new Translator("de");
  assert.equal(t.number(1234.5), "1.234,5");
  assert.equal(t.euros(1234567.4), "1.234.567 €");
  assert.match(t.date(new Date(2026, 9, 10)), /10\. Okt\. 2026/);
  t.setLanguage("en");
  assert.equal(t.number(1234.5), "1,234.5");
  assert.equal(t.euros(1234567.4), "1,234,567 €");
});

test("plugins bring their texts: registry.registerTexts", () => {
  const reg = new Registry();
  reg.registerTexts("de", { Windmill: "Windmühle" });
  reg.registerTexts("de", { "Sail speed": "Flügeldrehzahl" });
  assert.deepEqual(reg.texts.get("de"), { Windmill: "Windmühle", "Sail speed": "Flügeldrehzahl" });
  assert.throws(() => reg.registerTexts("", {}));
  // the built-ins: English singulars and German texts
  assert.ok(registry.texts.get("en")["{n} tracks"].one);
  assert.equal(registry.texts.get("de")["Rail platform"], "Bahnsteig");
  assert.deepEqual(Object.keys(UI_LANGUAGES), ["en", "de"]);
});

test("the catalogues: every translation keeps the placeholders of its English text, and no text twice", () => {
  const sources = { "web/arail/i18n/de.js": FRAMEWORK_DE, "web/arail/i18n/en.js": FRAMEWORK_EN, "web/app/lang/de.js": APP_DE };
  for (const [file, cat] of Object.entries(sources)) {
    for (const [key, value] of Object.entries(cat)) {
      const forms = typeof value === "string" ? [value] : Object.values(value);
      assert.ok(forms.length && forms.every((f) => typeof f === "string" && f.trim()), `${file}: "${key}" needs a text`);
      if (typeof value === "object") assert.ok(Object.keys(value).every((k) => ["zero", "one", "two", "few", "many", "other"].includes(k)), `${file}: "${key}": plural forms`);
      const want = new Set(placeholders(key));
      for (const f of forms) assert.deepEqual(new Set(placeholders(f)), want, `${file}: "${key}" → "${f}": the same placeholders`);
      if (want.size) assert.ok(key.replace(/\{\w+\}/g, "").trim(), `${file}: "${key}" is only placeholders`);
    }
    // an object literal keeps the last of two equal keys: a text written twice is a mistake
    const keys = [...read(file).matchAll(/^ {2}("(?:[^"\\]|\\.)*"|\w+):/gm)].map((m) => m[1]);
    const twice = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual(twice, [], `${file}: texts written twice`);
  }
});

test("every text the code asks for by name has a German translation", () => {
  const t = appTranslator();
  const files = [
    ...readdirSync(join(ROOT, "web/app")).filter((f) => f.endsWith(".js")).map((f) => `web/app/${f}`),
  ];
  const asked = new Set();
  for (const f of files) {
    const src = read(f);
    // t("…"), tr("…") and the canvas's accessible name
    for (const m of src.matchAll(/(?:\b(?:t|tr)\(|labelCanvas\(c,) *"((?:[^"\\\n]|\\.)+)"/g)) asked.add(JSON.parse(`"${m[1]}"`));
    for (const m of src.matchAll(/\btr\([^)]*\?\s*"((?:[^"\\\n]|\\.)+)"\s*:\s*"((?:[^"\\\n]|\\.)+)"/g)) asked.add(JSON.parse(`"${m[1]}"`)).add(JSON.parse(`"${m[2]}"`));
  }
  assert.ok(asked.size >= 8, `found ${asked.size} texts`);
  const missing = [...asked].filter((s) => /[A-Za-z]{2}/.test(s) && !t.has(s) && t.translate(s) === s);
  assert.deepEqual(missing, [], "texts without a German translation");
});

test("the page's own markup (bar, stage buttons, tabs) is translated", () => {
  const t = appTranslator();
  const html = read("web/app/index.html");
  const body = html.slice(html.indexOf('<header class="bar"'), html.indexOf("</nav>"));
  const texts = new Set();
  for (const m of body.matchAll(/>([^<>]+)</g)) texts.add(m[1].trim());
  for (const m of body.matchAll(/\b(?:aria-label|title|alt|placeholder)="([^"]+)"/g)) texts.add(m[1]);
  const BRAND = new Set(["AR", "ail", "EBL"]);
  const untranslated = [...texts].filter((s) => s && /[A-Za-z]{2}/.test(s) && !BRAND.has(s) && !t.has(s) && t.translate(s) === s);
  assert.deepEqual(untranslated, []);
  assert.equal(t.translate("Colour the tracks by"), "Gleise färben nach", "the app's texts");
  assert.equal(t.translate("Rail platform"), "Bahnsteig", "the framework's texts");
});

test("the cards of the framework in German: a train's data and where it may run, a track's systems", async () => {
  const { Consist, checkSection, compatibilitySection, createWorld, systemRows } = await import("../../web/arail/index.js");
  const t = appTranslator();
  const re = new Consist({ vehicles: [{ type: "br146" }, { type: "dbpza", count: 4 }] });
  const cz = checkSection(re, { country: "CZ" });
  const de = cz.problems.map((p) => t.translate(p.text));
  assert.match(de.join("\n"), /3 kV DC: kein Fahrzeug kann diesen Strom abnehmen/);
  assert.match(de.join("\n"), /LS \(Tschechien, Slowakei\) nötig; BR 146\.2 hat/);
  assert.match(de.join("\n"), /Nicht zugelassen in CZ: BR 146\.2, DBpza/);
  const world = createWorld({ objects: [{ id: "t", type: "track", track_id: "G3", country: "CZ", points: [[0, 0], [1000, 0]] }] });
  const lines = compatibilitySection(re, world).lines.map((l) => t.translate(l));
  assert.match(lines[0], /^Gleis G3: nein · 3 kV DC: kein Fahrzeug/);
  const rows = systemRows({ country: "CZ" }).map((r) => t.translate(Array.isArray(r) ? `${r[0]}: ${r[1]}` : r));
  assert.ok(rows.some((r) => /^Streckenklasse: D4 \(22,5 t Radsatzlast, 8 t Meterlast\)/.test(r)), rows.join("\n"));
});
