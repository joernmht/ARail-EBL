/**
 * Texts in other languages: a small translator without a build step. The English text is the key
 * (as in gettext), so code stays readable and a text without a translation stays English. A
 * catalogue maps English texts to those of a language; `{name}` marks a part that changes
 * ("{n} min late": "{n} min Verspätung"), and plural forms are chosen with `Intl.PluralRules`
 * ({one, other}). `{n}`, `{id}` and `{time}` (also `{n2}`, …) stand for one word or number, any
 * other name for any text. The framework itself stays English: the app (or another front end) translates
 * what it shows, with `t` where it builds a text and `translate` for a finished one (from a card
 * of the framework, a label, a setting).
 * @module arail/i18n
 */

/** The languages there are catalogues for, each by its own name. */
export const UI_LANGUAGES = { en: "English", de: "Deutsch" };

const PLACEHOLDER = /\{(\w+)\}/g;
/** Placeholders that stand for one word or number ("Track {id}" is not "Track systems: …"). */
const WORD = /^(n|id|time)\d?$/;
const NUMERIC = /^[−-]?\d+(\.\d+)?$/;
const CACHE_LIMIT = 20000;

/** The placeholders of a text, in order ("{n} of {all}" → ["n", "all"]). */
export function placeholders(text) {
  return [...String(text).matchAll(PLACEHOLDER)].map((m) => m[1]);
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A finished text as a pattern: "{n} min late" matches "4 min late" with n = "4". The literal
 * characters say how specific it is (more specific patterns are tried first).
 */
function compile(pattern) {
  const names = [];
  let re = "^", literal = 0, last = 0;
  for (const m of pattern.matchAll(PLACEHOLDER)) {
    const lit = pattern.slice(last, m.index);
    // one word, or any text up to the separator " · " (the parts of a text are translated one by one)
    re += escape(lit) + (WORD.test(m[1]) ? "(\\S+?)" : "((?:(?! · ).)+?)");
    literal += lit.length;
    names.push(m[1]);
    last = m.index + m[0].length;
  }
  re += `${escape(pattern.slice(last))}$`;
  literal += pattern.length - last;
  return { re: new RegExp(re, "s"), names, literal };
}

/**
 * Translates texts into one language at a time.
 *
 * Catalogue entries: `"English text": "Übersetzung"`, or with plural forms
 * `"{n} tracks": {one: "{n} Gleis", other: "{n} Gleise"}` (the count is the parameter `n`). The
 * English catalogue holds only the English singulars (`"{n} tracks": {one: "{n} track"}`).
 */
export class Translator {
  /**
   * @param {string} [lang] the language shown
   * @param {Record<string, Record<string, string | {one?: string, other?: string}>>} [catalogues] by language
   */
  constructor(lang = "en", catalogues = {}) {
    /** @type {Map<string, Map<string, any>>} entries by language */
    this.catalogues = new Map();
    /** @type {Map<string, Array<{re: RegExp, names: string[], literal: number, key: string}>>} */
    this.patterns = new Map();
    this._cache = new Map();
    /** English texts that were asked for and have no translation in the language shown (to find what is still to translate). */
    this.missing = new Set();
    for (const [l, entries] of Object.entries(catalogues)) this.add(l, entries);
    this.setLanguage(lang);
  }

  /**
   * Add texts of a language (a plugin brings its own this way). Later entries replace earlier ones.
   * @param {string} lang
   * @param {Record<string, string | {one?: string, other?: string}>} entries
   */
  add(lang, entries) {
    const cat = this.catalogues.get(lang) ?? new Map();
    this.catalogues.set(lang, cat);
    for (const [key, value] of Object.entries(entries || {})) cat.set(key, value);
    // the patterns of the texts with placeholders, by language: the English text, and its English singular
    const english = this.catalogues.get("en");
    for (const [l, entries] of this.catalogues) {
      const list = [];
      for (const key of entries.keys()) {
        if (!key.includes("{")) continue;
        for (const form of new Set([key, english?.get(key)?.one].filter(Boolean))) {
          const p = compile(form);
          if (p.literal) list.push({ ...p, key });
        }
      }
      this.patterns.set(l, list.sort((a, b) => b.literal - a.literal));
    }
    this._cache.clear();
    return this;
  }

  /** Switch the language shown (`en`, `de`, …; an unknown one falls back to English texts). */
  setLanguage(lang) {
    this.lang = lang || "en";
    this._plural = new Intl.PluralRules(this.lang);
    this._number = new Map();
    this._cache.clear();
    this.missing.clear();
    return this;
  }

  /** Is there a translation of this English text (exact or as a pattern) in a language? */
  has(text, lang = this.lang) {
    return this.catalogues.get(lang)?.has(text) ?? false;
  }

  /**
   * The text of an entry in the language shown, with its parameters filled in.
   * @param {string} text the English text, with `{name}` placeholders
   * @param {Record<string, any>} [params] `n` also chooses the plural form
   */
  t(text, params = {}) {
    const entry = this.catalogues.get(this.lang)?.get(text);
    const out = this._form(entry, params.n) ?? this._form(this.catalogues.get("en")?.get(text), params.n) ?? text;
    if (!out.includes("{")) return out;
    return out.replace(PLACEHOLDER, (m, name) => (name in params ? this._value(params[name]) : m));
  }

  /**
   * A finished English text in the language shown: as a whole, else by the pattern of an entry
   * whose fixed parts it has (its variable parts are translated in turn), else part by part
   * between " · ". What has no translation stays as it is.
   * @param {string} text
   */
  translate(text) {
    if (this.lang === "en" || typeof text !== "string" || !text || !/[A-Za-z]/.test(text)) return text;
    const cached = this._cache.get(text);
    if (cached !== undefined) return cached;
    this._hit = false;
    const out = this._translate(text, 0);
    if (!this._hit && this.missing.size < CACHE_LIMIT) this.missing.add(text);
    if (this._cache.size > CACHE_LIMIT) this._cache.clear();
    this._cache.set(text, out);
    return out;
  }

  _translate(text, depth) {
    const cat = this.catalogues.get(this.lang);
    if (!cat) return text;
    const exact = cat.get(text);
    if (exact !== undefined) {
      this._hit = true;
      return this._form(exact, null) ?? text;
    }
    const trimmed = text.trim();
    if (trimmed !== text) {
      const inner = this._translate(trimmed, depth);
      return inner === trimmed ? text : text.replace(trimmed, inner);
    }
    if (depth > 3) return text;
    for (const p of this.patterns.get(this.lang) ?? []) {
      const m = p.re.exec(text);
      if (!m) continue;
      this._hit = true;
      const params = {};
      p.names.forEach((name, i) => (params[name] = m[i + 1]));
      const n = params.n != null && NUMERIC.test(params.n) ? Number(params.n.replace("−", "-")) : null;
      const form = this._form(cat.get(p.key), n) ?? p.key;
      return form.replace(PLACEHOLDER, (all, name) => {
        const v = params[name];
        if (v == null) return all;
        return NUMERIC.test(v) ? this._decimal(v) : this._translate(v, depth + 1);
      });
    }
    // parts between " · ", each on its own
    if (text.includes(" · ")) {
      const parts = text.split(" · ");
      const done = parts.map((s) => this._translate(s, depth + 1));
      if (done.some((s, i) => s !== parts[i])) return done.join(" · ");
    }
    return text;
  }

  /** The form of an entry for a count (null: no entry). */
  _form(entry, n) {
    if (entry == null) return null;
    if (typeof entry === "string") return entry;
    const cat = n == null ? "other" : this._plural.select(Number(n));
    return entry[cat] ?? entry.other ?? null;
  }

  _value(v) {
    if (typeof v === "number") return this.number(v);
    return typeof v === "string" ? this.translate(v) : String(v);
  }

  /** A number as written in a text of the code ("2.5") in the language shown ("2,5"), without grouping. */
  _decimal(s) {
    if (this.lang === "en" || !s.includes(".")) return s;
    const n = Number(s.replace("−", "-"));
    const digits = s.split(".")[1].length;
    const out = this.number(Math.abs(n), { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
    return s.startsWith("−") ? `−${out}` : s.startsWith("-") ? `-${out}` : out;
  }

  /**
   * A number in the language shown ("1,234.5" / "1.234,5").
   * @param {number} x
   * @param {Intl.NumberFormatOptions} [options] default: up to 2 decimals
   */
  number(x, options = { maximumFractionDigits: 2 }) {
    if (!Number.isFinite(x)) return String(x);
    const key = JSON.stringify(options);
    let f = this._number.get(key);
    if (!f) this._number.set(key, (f = new Intl.NumberFormat(this.lang, options)));
    return f.format(x);
  }

  /** An amount in euros, rounded to whole euros ("1,234 €" / "1.234 €"). */
  euros(x) {
    return `${this.number(Math.round(x), { maximumFractionDigits: 0 })} €`;
  }

  /**
   * A date (and time) in the language shown.
   * @param {Date | number} date
   * @param {Intl.DateTimeFormatOptions} [options] default: the date, e.g. "10 Oct 2026" / "10. Okt. 2026"
   */
  date(date, options = { day: "numeric", month: "short", year: "numeric" }) {
    return new Intl.DateTimeFormat(this.lang, options).format(date);
  }
}
