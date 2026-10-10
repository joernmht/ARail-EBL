// The app in the language chosen (arail/i18n): from the URL (?lang=de, e.g. for a projector), else
// as chosen in the View panel (kept on this device), else the browser's. The English text is the
// key: `h()` (ui.js) translates the texts and labels of the elements it makes, the canvas labels
// are translated by the View, and what has no translation stays English.
import { Translator, UI_LANGUAGES, registry } from "../arail/index.js";
import { DE } from "./lang/de.js";

/** The app's translator: the framework's texts (and those of plugins), then the app's own. */
export const i18n = new Translator("en");

/** Take the texts of the registry (the framework's and those plugins registered) and the app's. */
export function addTexts(reg = registry) {
  for (const [lang, entries] of reg.texts) i18n.add(lang, entries);
  i18n.add("de", DE);
}
addTexts();

/** A finished English text in the language shown. */
export const tr = (text) => i18n.translate(text);

/** The text of an entry (`{name}` placeholders, `n` chooses the plural form) in the language shown. */
export const t = (text, params) => i18n.t(text, params);

const STORE = "arail.lang";
const read = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE));
  } catch {
    return null;
  }
};

/** The language to show: the URL's `lang`, else the one chosen on this device, else the browser's, else English. */
export function chooseLanguage() {
  const url = new URLSearchParams(location.search).get("lang");
  const browser = (navigator.languages?.length ? navigator.languages : [navigator.language]).map((l) => String(l || "").slice(0, 2).toLowerCase());
  return [url, read(), ...browser].find((l) => l && l in UI_LANGUAGES) || "en";
}

/** The attributes that hold texts people read or hear. */
export const TEXT_ATTRIBUTES = ["aria-label", "title", "alt", "placeholder"];

/** The English texts of the page's own markup (index.html), for switching back. */
const originals = new WeakMap();

/**
 * Translate the page's own markup (the bar, the tabs, the stage's buttons): its texts and the
 * attributes people read or hear. The panels, the HUD and the cards are made again instead.
 */
export function translateDocument(roots = ["#bar", "#stageWrap > .fly-nav", "#stageWrap > .stage-tools", "#panel > .tabs"]) {
  for (const root of roots.map((s) => document.querySelector(s)).filter(Boolean)) {
    // names (translate="no") are left as they are, with what is inside them
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && n.getAttribute("translate") === "no" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let node = walker.currentNode; node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!node.nodeValue.trim()) continue;
        if (!originals.has(node)) originals.set(node, node.nodeValue);
        node.nodeValue = tr(originals.get(node));
        continue;
      }
      let own = originals.get(node);
      if (!own) originals.set(node, (own = Object.fromEntries(TEXT_ATTRIBUTES.filter((a) => node.hasAttribute(a)).map((a) => [a, node.getAttribute(a)]))));
      for (const [a, v] of Object.entries(own)) node.setAttribute(a, tr(v));
    }
  }
  // the stage's accessible name: the flyover sets its own (its English text kept in data-label)
  const canvas = document.querySelector("#stage");
  if (canvas) {
    canvas.dataset.label ??= canvas.getAttribute("aria-label") || "";
    if (canvas.dataset.label) canvas.setAttribute("aria-label", tr(canvas.dataset.label));
  }
}

/**
 * Show the app in a language: the translator, the page's language (`<html lang>`) and its own
 * markup. The app makes its panels again.
 * @param {string} lang
 * @param {{keep?: boolean}} [options] keep: remember it on this device (chosen in the app)
 */
export function setLanguage(lang, { keep = false } = {}) {
  if (!(lang in UI_LANGUAGES)) lang = "en";
  i18n.setLanguage(lang);
  document.documentElement.lang = lang;
  if (keep) {
    try {
      localStorage.setItem(STORE, JSON.stringify(lang));
    } catch {
      /* storage unavailable: for this page only */
    }
    // a link with ?lang= would choose again on reload: it follows the choice
    const url = new URL(location.href);
    if (url.searchParams.has("lang")) {
      url.searchParams.set("lang", lang);
      history.replaceState(history.state, "", url);
    }
  }
  translateDocument();
}
