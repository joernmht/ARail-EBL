// Small DOM helpers for the app (no framework).

export const $ = (sel, root = document) => root.querySelector(sel);

/**
 * Create an element: h("button", {class: "btn", onclick: fn}, "Label", child, ...).
 * Attributes with null/false are skipped; `true` sets an empty attribute.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") {
      // handler properties (not listeners), so that `morph` can carry them over
      el[k] = v;
      (el._handlers ||= []).push(k);
    } else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = !!v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/** Replace the children of `el`. */
export function mount(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

/**
 * Like `mount`, but changes the existing elements in place where they match (same tag at
 * the same position). For content that is refreshed periodically: buttons stay the same
 * elements, so focus and clicks in progress are not lost.
 */
export function morph(el, ...children) {
  morphChildren(el, mount(document.createElement(el.tagName), ...children));
  return el;
}

function morphChildren(target, source) {
  const old = [...target.childNodes], next = [...source.childNodes];
  next.forEach((b, i) => {
    const a = old[i];
    if (!a) target.append(b);
    else if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) target.replaceChild(b, a);
    else if (a.nodeType === Node.TEXT_NODE) {
      if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
    } else morphElement(a, b);
  });
  for (const a of old.slice(next.length)) a.remove();
}

function morphElement(a, b) {
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  for (const k of new Set([...(a._handlers || []), ...(b._handlers || [])])) a[k] = b[k] || null;
  a._handlers = b._handlers;
  if ("value" in b && a.value !== b.value && a !== document.activeElement) a.value = b.value;
  if ("checked" in b && a.checked !== b.checked) a.checked = b.checked;
  morphChildren(a, b);
}

export function section(title, ...children) {
  return h("div", { class: "section" }, h("h2", {}, title), ...children);
}

let toastTimer = null;
/**
 * Show a short message over the stage.
 * @param {string} text
 * @param {number} [ms] how long it is shown
 * @param {{minor?: boolean}} [options] minor: a passing note that does not replace a message being shown
 */
export function toast(text, ms = 4500, { minor = false } = {}) {
  const el = $("#toast");
  if (!el || (minor && !el.hidden)) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

/**
 * Scroll the stage into view when its placing bar is out of view (on narrow screens the panel is
 * below the stage): what to tap on the stage must be seen.
 */
export function revealStage() {
  const stage = $("#stageWrap"), bar = $("#placing");
  if (!stage || !bar || bar.hidden) return;
  const r = bar.getBoundingClientRect();
  if (r.top >= 0 && r.bottom <= innerHeight) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  stage.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
}

/** Offer a text file for download (works on normal web pages). */
export function download(filename, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export const storage = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable (private mode, quota): ignore */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/**
 * Form fields for a list of parameter specs (see LayoutObject.params).
 * @param {object[]} params ParamSpec list
 * @param {object} values current values
 * @param {(key: string, value: any) => void} onChange
 * @param {{idPrefix: string, world?: object}} options
 */
export function paramFields(params, values, onChange, { idPrefix, world } = {}) {
  const wrap = h("div", { class: "fields" });
  for (const p of params) {
    const id = `${idPrefix}-${p.key}`;
    const v = values[p.key];
    const help = p.help ? h("small", { class: "help", id: `${id}-help` }, p.help) : null;
    const described = p.help ? `${id}-help` : null;
    const label = h("span", {}, p.label, p.unit ? h("small", {}, ` (${p.unit})`) : null);
    let field;
    if (p.type === "boolean") {
      const input = h("input", { type: "checkbox", id, checked: !!v, "aria-describedby": described, onchange: (e) => onChange(p.key, e.target.checked) });
      field = h("label", { class: "field check wide", for: id }, input, p.label, help);
    } else if (p.type === "select") {
      const sel = h("select", { id, "aria-describedby": described, onchange: (e) => onChange(p.key, e.target.value) },
        p.options.map(([val, text]) => h("option", { value: val, selected: String(v) === String(val) }, text)));
      field = h("label", { class: "field", for: id }, label, sel, help);
    } else if (p.type === "color") {
      const input = h("input", { type: "color", id, value: v || p.fallback || "#7fb069", "aria-describedby": described, oninput: (e) => onChange(p.key, e.target.value) });
      const reset = p.default === "" ? h("button", { class: "btn small", type: "button", onclick: () => onChange(p.key, "") }, "Auto") : null;
      field = h("label", { class: "field", for: id }, label, h("span", { class: "row" }, input, reset), help);
    } else if (p.type === "marker" || p.type === "object") {
      const options = p.type === "marker"
        ? (world?.map.ids() || []).map((m) => [String(m), `Marker ${m}`])
        : (world?.objects || []).filter((o) => !p.objectType || o.type === p.objectType).map((o) => [o.id, o.name]);
      const sel = h("select", { id, "aria-describedby": described, onchange: (e) => onChange(p.key, e.target.value === "" ? undefined : p.type === "marker" ? Number(e.target.value) : e.target.value) },
        h("option", { value: "" }, "—"), options.map(([val, text]) => h("option", { value: val, selected: String(v) === val }, text)));
      field = h("label", { class: "field", for: id }, label, sel, help);
    } else {
      const isNum = p.type === "number";
      const input = h("input", {
        type: isNum ? "number" : "text", id, value: v ?? "", min: p.min, max: p.max, step: p.step ?? "any",
        placeholder: isNum && p.default == null ? "default" : null, "aria-describedby": described,
        onchange: (e) => {
          const raw = e.target.value;
          if (!isNum) return onChange(p.key, raw);
          if (raw === "") return onChange(p.key, undefined);
          const num = Number(raw);
          if (Number.isFinite(num)) onChange(p.key, num);
        },
      });
      field = h("label", { class: `field${p.type === "text" && p.key !== "name" ? " wide" : ""}`, for: id }, label, input, help);
    }
    wrap.append(field);
  }
  return wrap;
}
