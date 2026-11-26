// The version of the site, so that nobody keeps working with an old one. The deploy
// (.github/workflows/pages.yml) writes the commit it publishes into version.json and into the page's
// <meta name="arail-version">; here, the page left as it was is "dev" and checks nothing. A page older
// than the site (a tab left open for days, or files the browser kept in its cache: GitHub Pages lets it
// keep them for ten minutes) says so, and Reload fetches the page's files anew, past the cache, before
// it loads the page again.
import { h } from "./ui.js";

/** How often an open page asks for the version of the site, and when it is shown again. */
const EVERY_MS = 10 * 60 * 1000;

/** The version the page was published with ("dev": not published, nothing is checked). */
export function pageVersion(doc = document) {
  return doc.querySelector('meta[name="arail-version"]')?.content || "dev";
}

/** Whether a page of this version is older than the site's: a published page, a version the site says, and another one. */
export function isOutdated(page, site) {
  return typeof page === "string" && page !== "" && page !== "dev" && typeof site === "string" && site !== "" && site !== page;
}

/** The version of the site (version.json, never from the cache), or null when it cannot be read. */
export async function siteVersion(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json?.version === "string" ? json.version : null;
  } catch {
    return null;
  }
}

/**
 * The page's own files (its address, scripts, modules and style sheets of this site) fetched anew past
 * the cache, so that the browser keeps the new ones for the reload.
 */
export async function refreshFiles() {
  const own = new Set([location.href.split("#")[0]]);
  for (const e of performance.getEntriesByType("resource")) {
    const url = new URL(e.name, location.href);
    if (url.origin === location.origin && /\.(m?js|css|html)$/.test(url.pathname)) own.add(url.href);
  }
  await Promise.all([...own].map((u) => fetch(u, { cache: "reload" }).catch(() => null)));
}

/** The notice of a new version: Reload (after `beforeReload`, e.g. the layout's edits saved) or Later. */
function showNotice(beforeReload) {
  const reload = h("button", {
    class: "btn small", type: "button",
    onclick: async () => {
      reload.disabled = true;
      try {
        beforeReload?.();
      } catch (err) {
        console.warn("Before the reload:", err);
      }
      await refreshFiles();
      location.reload();
    },
  }, "Reload");
  const el = h("div", { class: "update-notice", id: "updateNotice", role: "status" },
    h("span", {}, "A new version of ARail is available."),
    reload,
    h("button", { class: "btn small", type: "button", onclick: () => el.remove() }, "Later"));
  document.body.append(el);
  return el;
}

/**
 * Ask the site for its version now, every ten minutes and when the page is shown again; a page older
 * than it shows the notice (again ten minutes after Later). Nothing on a page that was not published.
 * @param {{url?: string, every?: number, beforeReload?: () => void}} [opts]
 * @returns {{check: () => Promise<boolean>, stop: () => void} | null}
 */
export function watchVersion({ url = new URL("../version.json", import.meta.url).href, every = EVERY_MS, beforeReload = null } = {}) {
  const page = pageVersion();
  if (page === "dev") return null;
  const check = async () => {
    if (document.getElementById("updateNotice")) return true;
    const outdated = isOutdated(page, await siteVersion(url));
    if (outdated && !document.getElementById("updateNotice")) showNotice(beforeReload);
    return outdated;
  };
  const visible = () => document.visibilityState === "visible" && check();
  check();
  const timer = setInterval(check, every);
  document.addEventListener("visibilitychange", visible);
  return { check, stop: () => { clearInterval(timer); document.removeEventListener("visibilitychange", visible); } };
}
