// Windows on the stage of the play page (game/play/) that a person places and sizes: the game's picture
// (the signaller's panel) and a table kept in view at work (the timetable). Each gets a handle to move it
// by and a grip to size it by, with the pointer or the arrow keys; a double-click on the handle (or Home)
// puts it back where the page has it. Where a window was left is kept in the browser, by its key, and it
// stays inside the stage when the screen is smaller. The page draws into the windows; this only places them.
import { h } from "../app/ui.js";

/** Where the places of the windows are kept in the browser. */
export const WINDOWS_KEY = "arail.play.windows";
/** How far an arrow key moves or sizes a window (px; with Shift four times as far), and how small one may get (px). */
export const WINDOW_STEP_PX = 24;
export const WINDOW_MIN_W = 240;
export const WINDOW_MIN_H = 120;
/** The highest layer a window gets (the page keeps what speaks above it). */
export const WINDOW_LAYERS = 500;

/** A number of px kept between `lo` and `hi` (when `hi` is below `lo`, `lo`). */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

/** A place as it fits a stage of `W` × `H` px: no larger than the stage, and inside it. */
export function inside(place, W, H) {
  const w = clamp(place.w, WINDOW_MIN_W, W), h = clamp(place.h, WINDOW_MIN_H, H);
  return { x: clamp(place.x, 0, W - w), y: clamp(place.y, 0, H - h), w, h };
}

export class Windows {
  /**
   * @param {{get: (key: string, fallback: any) => any, set: (key: string, value: any) => void}} storage where the places are kept (ui.js)
   * @param {{stage?: string}} [options] the stage the windows stand on: the nearest ancestor that matches (else a window's parent)
   */
  constructor(storage, { stage = null } = {}) {
    this.storage = storage;
    this.stage = stage;
    const kept = storage.get(WINDOWS_KEY, {});
    /** @type {Record<string, {x: number, y: number, w: number, h: number}>} the places, by key: px from the stage's upper left corner */
    this.places = kept && typeof kept === "object" ? kept : {};
    /** The windows framed, by key; the next one brought to the front gets this layer. */
    this.els = new Map();
    this.top = 1;
  }

  /**
   * Make an element a window of the stage: a handle to move it by and a grip to size it by, at its
   * place if one is kept. Once per element; `name` says which window it is ("the panel").
   * @param {HTMLElement} el
   * @param {string} key
   * @param {string} name
   */
  frame(el, key, name) {
    if (el.dataset.win) return el;
    el.dataset.win = key;
    el.classList.add("play-window");
    const move = h("button", {
      class: "win-move", type: "button", "aria-label": `Move ${name}`,
      title: `Move ${name}: drag it, or the arrow keys. A double-click (or Home) puts it back.`,
      onpointerdown: (e) => this.drag(e, el, "move"), onkeydown: (e) => this.key(e, el, "move"), ondblclick: () => this.reset(el),
    }, h("span", { "aria-hidden": "true" }));
    const grip = h("button", {
      class: "win-grip", type: "button", "aria-label": `Size ${name}`,
      title: `Size ${name}: drag the corner, or the arrow keys. A double-click (or Home) puts it back.`,
      onpointerdown: (e) => this.drag(e, el, "size"), onkeydown: (e) => this.key(e, el, "size"), ondblclick: () => this.reset(el),
    });
    el.prepend(move);
    el.append(grip);
    // what is clicked in a window comes to the front
    el.addEventListener("pointerdown", () => this.raise(el));
    this.els.set(key, el);
    this.apply(el);
    return el;
  }

  /** The stage a window stands on (its nearest ancestor that is a stage, else its parent), or null. */
  stageOf(el) {
    return (this.stage && el.parentElement?.closest(this.stage)) || el.parentElement;
  }

  /** Put a window at its place (kept inside its stage), or where the page has it when none is kept. */
  apply(el) {
    const place = this.places[el.dataset.win], stage = this.stageOf(el);
    if (!place || !stage) {
      el.classList.remove("placed");
      for (const k of ["left", "top", "width", "height"]) el.style[k] = "";
      return;
    }
    const W = stage.clientWidth, H = stage.clientHeight;
    // (a stage not laid out, hidden: the window is placed when it is shown, not before with no size and place)
    if (!W || !H) return;
    el.classList.add("placed");
    const at = inside(place, W, H);
    Object.assign(el.style, { left: `${at.x}px`, top: `${at.y}px`, width: `${at.w}px`, height: `${at.h}px` });
  }

  /**
   * Where a window is drawn now, in px of its stage: its kept place as it fits the stage (kept on a larger
   * screen, it is drawn smaller or nearer), else where the page has it. A move or a size starts from here.
   */
  shown(el) {
    const place = this.places[el.dataset.win], stage = this.stageOf(el);
    return place && stage?.clientWidth && stage.clientHeight ? inside(place, stage.clientWidth, stage.clientHeight) : this.rect(el);
  }

  /** Put every window at its place again (the screen has changed its size). */
  fit() {
    for (const el of this.els.values()) if (el.isConnected) this.apply(el);
  }

  /** Where a window stands now, in px of its stage. */
  rect(el) {
    const a = el.getBoundingClientRect(), b = this.stageOf(el).getBoundingClientRect();
    return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
  }

  /** Bring a window in front of the others. */
  raise(el) {
    // (the layers stay low, below what the page keeps over the windows: renumbered in their order when they have grown)
    if (this.top >= WINDOW_LAYERS) {
      const order = [...this.els.values()].sort((a, b) => (Number(a.style.zIndex) || 0) - (Number(b.style.zIndex) || 0));
      order.forEach((w, i) => (w.style.zIndex = String(i + 2)));
      this.top = order.length + 1;
    }
    el.style.zIndex = String(++this.top);
  }

  /** Keep a window's new place (moved or sized by `dx`, `dy` px from `from`). */
  place(el, mode, from, dx, dy) {
    const stage = this.stageOf(el), W = stage.clientWidth, H = stage.clientHeight;
    const p = mode === "move"
      ? { ...from, x: clamp(from.x + dx, 0, W - from.w), y: clamp(from.y + dy, 0, H - from.h) }
      : { ...from, w: clamp(from.w + dx, WINDOW_MIN_W, W - from.x), h: clamp(from.h + dy, WINDOW_MIN_H, H - from.y) };
    this.places[el.dataset.win] = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Math.round(v)]));
    this.apply(el);
  }

  /** Move or size a window with the pointer; kept when it is let go. */
  drag(e, el, mode) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const from = this.shown(el), x0 = e.clientX, y0 = e.clientY, target = e.currentTarget;
    this.raise(el);
    el.classList.add("dragging");
    target.setPointerCapture?.(e.pointerId);
    const onmove = (ev) => this.place(el, mode, from, ev.clientX - x0, ev.clientY - y0);
    const done = () => {
      el.classList.remove("dragging");
      target.removeEventListener("pointermove", onmove);
      target.removeEventListener("pointerup", done);
      target.removeEventListener("pointercancel", done);
      this.keep();
    };
    target.addEventListener("pointermove", onmove);
    target.addEventListener("pointerup", done);
    target.addEventListener("pointercancel", done);
  }

  /** Move or size a window with the arrow keys (Shift: farther); Home puts it back. */
  key(e, el, mode) {
    if (e.key === "Home") {
      e.preventDefault();
      e.stopPropagation();
      return this.reset(el);
    }
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step) return;
    // (the arrow keys move the table's camera elsewhere: not while a window is moved)
    e.preventDefault();
    e.stopPropagation();
    const by = WINDOW_STEP_PX * (e.shiftKey ? 4 : 1);
    this.place(el, mode, this.shown(el), step[0] * by, step[1] * by);
    this.keep();
  }

  /** Put a window back where the page has it. */
  reset(el) {
    delete this.places[el.dataset.win];
    this.apply(el);
    this.keep();
  }

  keep() {
    this.storage.set(WINDOWS_KEY, this.places);
  }
}
