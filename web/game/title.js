// The title screen of the game page (game/): what the page opens with when it is called without a
// layout or a case (a bare game/, or game/?lang=de). The photos of the lab, full screen, drift and
// fade into each other, as a game's title does; beside them the main menu: to go on with the game
// played last, the big game's missions, the signaller, free play on the lab's layout (the game
// page's cases, a submenu), the career planner, the role catalogue, the options (language, a moving
// background, full screen) and the way back to the project page. A link of the menu opens its page;
// free play opens this page again with a layout and a case, which goes straight into the app's shell.
import { UI_LANGUAGES } from "../arail/index.js";
import { chooseLanguage, i18n, setLanguage, tr, translateDocument } from "../app/i18n.js";
import { $, h, mount } from "../app/ui.js";

/** The photos behind the menu, in their order; the first one is in the page (index.html). */
export const SLIDES = [
  { src: "../assets/ebl-lab-ar.jpg", caption: "Bf Neustadt in the EBL lab, with its digital layer" },
  { src: "../media/ebl-container-train.jpg", caption: "A container train and the intercity in the lab" },
  { src: "../assets/town-day.jpg", caption: "The town around the layout, in the flyover" },
  { src: "../media/ebl-terminal.jpg", caption: "The container terminal and the line to Pirna" },
  { src: "../media/ebl-neustadt.jpg", caption: "Bf Neustadt, as the camera sees it" },
  { src: "../assets/town-night.jpg", caption: "The town at night" },
];

/** How long a photo stays (ms) before the next one fades in; the drift lasts a little longer. */
export const SLIDE_MS = 9000;

/** What the browser keeps: the game played last (Continue) and whether the background moves. */
const LAST = "arail.game.continue", MOTION = "arail.game.motion";

/** What the app's shell on this page remembers (App.key): its last layout and the case shown. */
const SHELL_LAYOUT = "arail.game.lastLayout", SHELL_CASE = "arail.game.case";

/**
 * The app's shell was played last (started by Free play, a link or an address): Continue goes back
 * to where it was left, its layout and case as the shell remembers them.
 */
export function rememberShell() {
  store.set(LAST, { shell: true });
}

/**
 * A link to this page with a layout or a case (?layout=…#case), with the address's language
 * (?lang=, e.g. for a projector) carried along; other links as they are.
 * @param {string} href
 * @param {{search: string}} [loc]
 */
export function withLang(href, loc = location) {
  const lang = new URLSearchParams(loc.search).get("lang");
  if (!lang || !href.startsWith("?")) return href;
  const [query, hash] = href.split("#");
  const q = new URLSearchParams(query);
  q.set("lang", lang);
  return `?${q}${hash != null ? `#${hash}` : ""}`;
}

/** The heading of each menu; a submenu's is also the label of the item that opens it. */
const HEADINGS = { main: "Main menu", free: "Free play", options: "Options" };

const store = {
  get(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable: for this page only */
    }
  },
};

/**
 * @typedef {{id?: string, label: string, sub?: string, href?: string, go?: string, act?: () => void, pressed?: boolean, lang?: string, keep?: boolean}} MenuItem
 * href: a page to open; go: a submenu; act: an option (pressed: whether it is on; lang: a language's
 * name, in that language). keep: not remembered as the game played last.
 */

/** The title screen: the photos, the menu and its submenus. */
export class TitleScreen {
  /**
   * Whether the page opens with the title screen: no layout, example, photo or case asked for (only
   * the language may be).
   * @param {{search: string, hash: string}} [loc]
   */
  static wanted(loc = location) {
    const keys = [...new URLSearchParams(loc.search).keys()];
    return !loc.hash.replace(/^#/, "") && keys.every((k) => k === "lang");
  }

  /**
   * @param {{freePlay: MenuItem[]}} options freePlay: the game page's cases on the lab's layout
   */
  constructor({ freePlay }) {
    this.root = $("#title");
    this.freePlay = freePlay;
    /** The menu shown: "main", "free" or "options". */
    this.view = "main";
    this.slide = 0;
    /** The photos' elements by their index in SLIDES (made when first shown), null for one that failed to load. */
    this.imgs = [this.root.querySelector(".title-slide")];
    this.timer = null;
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)");
    /** What the motion follows while the title is open (removed when it closes). */
    this.follow = () => this.setMotion(this.motion);
    this.keys = (e) => this.onKey(e);
    // full screen left with Esc or F11 (the browser's): Options shows it
    this.fullscreen = () => this.view === "options" && this.redraw();
  }

  /** Show it: the menu, the photos moving (unless motion is off), the keys. */
  open() {
    setLanguage(chooseLanguage());
    this.translateStatic();
    document.documentElement.classList.add("titled");
    this.root.hidden = false;
    // the menu's keys work wherever the focus is while the title is open (a click on the photo leaves it on the page)
    document.addEventListener("keydown", this.keys);
    this.render();
    this.setMotion(this.motion);
    this.reduced.addEventListener?.("change", this.follow);
    document.addEventListener("visibilitychange", this.follow);
    document.addEventListener("fullscreenchange", this.fullscreen);
    // the menu's first item takes the focus, as a game's menu has its cursor on it
    this.focusFirst();
  }

  /** Leave it for the app's shell (the page was given a case without loading again). */
  close() {
    this.reduced.removeEventListener?.("change", this.follow);
    document.removeEventListener("visibilitychange", this.follow);
    document.removeEventListener("fullscreenchange", this.fullscreen);
    document.removeEventListener("keydown", this.keys);
    clearInterval(this.timer);
    this.timer = null;
    this.root.hidden = true;
    document.documentElement.classList.remove("titled");
  }

  /** Whether the background moves: the choice of Options, else not when the system asks for less motion. */
  get motion() {
    return store.get(MOTION, !this.reduced.matches);
  }

  /** Let the background move (drift and fade from photo to photo) or keep it still. */
  setMotion(on) {
    this.root.classList.toggle("still", !on);
    clearInterval(this.timer);
    this.timer = null;
    if (on && !document.hidden && !this.root.hidden) this.timer = setInterval(() => this.next(), SLIDE_MS);
  }

  /** The next photo: loaded first, then it fades in and drifts. */
  next() {
    // the next photo that has not failed to load (none left: the one shown stays)
    let i = this.slide;
    do i = (i + 1) % SLIDES.length;
    while (this.imgs[i] === null && i !== this.slide);
    if (i === this.slide) return;
    let img = this.imgs[i];
    if (!img) {
      img = this.imgs[i] = h("img", { class: "title-slide", alt: "", src: SLIDES[i].src, decoding: "async", "data-i": String(i) });
      // a photo that cannot be loaded (missing, offline) is left out, and the next one is tried
      img.addEventListener("error", () => {
        this.imgs[i] = null;
        img.remove();
        if (this.timer) this.next();
      }, { once: true });
      $(".title-slides", this.root).append(img);
    }
    if (img.dataset.waiting) return; // still loading since an earlier tick
    const show = () => {
      delete img.dataset.waiting;
      for (const s of this.imgs) s?.classList.remove("on", "last");
      this.imgs[this.slide]?.classList.add("last");
      void img.offsetWidth; // the drift starts again from its beginning
      img.classList.add("on");
      this.slide = i;
      this.caption();
    };
    if (img.complete && img.naturalWidth) show();
    else {
      img.dataset.waiting = "1";
      img.addEventListener("load", show, { once: true });
    }
  }

  /** The caption of the photo shown. */
  caption() {
    const el = $("#titleCaption");
    if (el) el.textContent = tr(SLIDES[this.slide].caption);
  }

  /* ------------------------------------------------------------------ the menu */

  /** The items of the menu shown. @returns {MenuItem[]} */
  items() {
    if (this.view === "free") return [...this.freePlay, { label: "Back", go: "main" }];
    if (this.view === "options") {
      const lang = i18n.lang, motion = this.motion;
      return [
        ...Object.entries(UI_LANGUAGES).map(([code, name]) => ({ label: name, sub: "Language", pressed: lang === code, lang: code, act: () => this.setLanguage(code) })),
        { label: "Moving background", sub: motion ? "On" : "Off", pressed: motion, act: () => this.toggleMotion() },
        document.fullscreenEnabled ? { label: "Full screen", sub: document.fullscreenElement ? "On" : "Off", pressed: !!document.fullscreenElement, act: () => this.toggleFullscreen() } : null,
        { label: "Back", go: "main" },
      ].filter(Boolean);
    }
    return [
      this.continued(),
      { label: "Missions", sub: "The big game: several roles, one railway, in turns and shifts", href: "play/" },
      { label: "Signaller", sub: "Half an hour at Bf Neustadt in a relay interlocking", href: "signaller/" },
      { label: "Free play", sub: "The lab's layout: assets, operations, the terminal, journeys", go: "free" },
      { label: "Career", sub: "A working life through the roles of the railway", href: "career/" },
      { label: "Roles", sub: "Every role of the railway, with its decisions and limits", href: "roles/" },
      { label: "Options", sub: "Language, moving background, full screen", go: "options" },
      { label: "Leave", sub: "To the project page", href: "../", keep: true },
    ].filter(Boolean);
  }

  /**
   * Continue: the page opened last from here, or, when the app's shell was played last, the shell
   * where it was left: its last layout and case (its modules are kept with the layout), else nothing.
   * @returns {MenuItem | null}
   */
  continued() {
    const last = store.get(LAST, null);
    if (last?.href) return { label: "Continue", sub: last.label, href: last.href, keep: true };
    const layout = last?.shell ? store.get(SHELL_LAYOUT, null) : null;
    if (typeof layout !== "string" || !layout) return null;
    const id = store.get(SHELL_CASE, null);
    const known = this.freePlay.find((it) => it.id === id);
    const hash = typeof id === "string" && id ? id : "overview";
    return { label: "Continue", sub: known ? `Free play · ${known.label}` : "Free play", href: `?${new URLSearchParams({ layout })}#${hash}`, keep: true };
  }

  /** The heading of the menu shown. */
  heading() {
    return HEADINGS[this.view];
  }

  /** Draw the menu (again: after a submenu or another language). */
  render() {
    const menu = $("#titleMenu");
    const item = (it) => {
      const label = [
        h("span", { class: "title-label", translate: it.lang ? "no" : null, lang: it.lang || null }, it.label),
        it.sub ? h("span", { class: "title-sub" }, it.sub) : null,
      ];
      // one cursor, as in a game's menu: the mouse moves it too, when it moves (not when a menu is drawn under it)
      const hover = (e) => {
        if ((e.movementX || e.movementY) && document.activeElement !== e.currentTarget) e.currentTarget.focus({ preventScroll: true });
      };
      if (it.href) {
        return h("a", { class: "title-item", href: withLang(it.href), onclick: () => this.remember(it), onpointermove: hover }, label);
      }
      const go = !!it.go;
      return h("button", {
        class: `title-item${go && it.go !== "main" ? " more" : ""}${it.go === "main" ? " back" : ""}`,
        type: "button",
        "aria-pressed": it.pressed == null ? null : String(it.pressed),
        onclick: () => (go ? this.go(it.go) : it.act()),
        onpointermove: hover,
      }, label);
    };
    mount(menu,
      h("h2", { class: "title-menu-head", id: "titleMenuHead" }, this.heading()),
      h("ul", { class: "title-list", "aria-labelledby": "titleMenuHead" }, this.items().map((it) => h("li", {}, item(it)))));
    menu.dataset.view = this.view;
    menu.setAttribute("aria-label", tr("Main menu"));
    this.caption();
  }

  /** Draw the menu again, the cursor kept on its item. */
  redraw() {
    const at = this.root.contains(document.activeElement) ? document.activeElement.querySelector(".title-label")?.textContent : null;
    this.render();
    if (at) [...this.root.querySelectorAll(".title-item")].find((el) => el.querySelector(".title-label")?.textContent === at)?.focus({ preventScroll: true });
  }

  /** Open a submenu (or the main menu again), with the focus on its first item, or on the item that led there. */
  go(view) {
    const from = this.view;
    this.view = view;
    this.render();
    if (view === "main" && from !== "main") this.focusLabel(HEADINGS[from]);
    else this.focusFirst();
  }

  /** Put the focus on the item of that (English) label, else on the first one. */
  focusLabel(label) {
    const items = [...this.root.querySelectorAll(".title-item")];
    (items.find((el) => el.querySelector(".title-label")?.textContent === tr(label)) || items[0])?.focus({ preventScroll: true });
  }

  firstItem() {
    return this.root.querySelector(".title-item");
  }

  focusFirst() {
    this.firstItem()?.focus({ preventScroll: true });
  }

  /** The game opened from the menu, for Continue next time. */
  remember(it) {
    if (it.keep) return;
    // a case of Free play opens the app's shell, which remembers where it is left
    if (this.view === "free") rememberShell();
    else store.set(LAST, { href: it.href, label: it.label });
  }

  setLanguage(lang) {
    setLanguage(lang, { keep: true });
    this.translateStatic();
    this.render();
    this.focusLabel(UI_LANGUAGES[lang]);
  }

  /** The title screen's own markup (index.html) in the language shown; the menu is drawn in it. */
  translateStatic() {
    document.title = tr("ARail Game");
    translateDocument(["#title > .title-top", "#title .title-name", "#title > .title-foot"]);
  }

  toggleMotion() {
    const on = !this.motion;
    store.set(MOTION, on);
    this.setMotion(on);
    this.render();
    this.focusLabel("Moving background");
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      /* refused: nothing changes */
    }
    this.redraw();
  }

  /** The keys of a game's menu: the arrows move, Enter chooses (the item's own), Escape goes back. */
  onKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const items = [...this.root.querySelectorAll(".title-item")];
    const at = items.indexOf(document.activeElement);
    const move = { ArrowDown: 1, ArrowUp: -1, Home: "first", End: "last" }[e.key];
    if (move != null) {
      e.preventDefault();
      const i = move === "first" ? 0 : move === "last" ? items.length - 1 : at < 0 ? (move > 0 ? 0 : items.length - 1) : (at + move + items.length) % items.length;
      items[i]?.focus();
    } else if (e.key === "Escape" && this.view !== "main") {
      e.preventDefault();
      this.go("main");
    } else if (e.key === "ArrowRight" && document.activeElement?.classList.contains("more")) {
      e.preventDefault();
      document.activeElement.click();
    } else if (e.key === "ArrowLeft" && this.view !== "main") {
      e.preventDefault();
      this.go("main");
    }
  }
}
