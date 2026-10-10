// Hover and click on everything: a tooltip for what is under the pointer and an info card for what
// was tapped, in the camera view and the flyover (the world's pick interface, core/pick.js).
import { FONT, OVERLAY, projectedHull, PICK_TOLERANCE, rgba } from "../arail/index.js";
import { $, h, morph, mount } from "./ui.js";

/** A pointer that moves less than this (CSS px) between down and up taps rather than drags. */
const TAP_PX = 6;

export class Inspector {
  /** @param {object} app */
  constructor(app) {
    this.app = app;
    /** What is under the mouse: a pickable, or null. */
    this.hover = null;
    /** The open card: {key, hit} (the hit as it was when last found), or null. */
    this.open = null;
    /** The cross in the middle of the flyover shows where Enter points (after keys on the stage). */
    this.keyAim = false;
    this._pending = null;
    this._tap = null;
    const stage = $("#stageWrap");
    this.tip = h("div", { class: "tooltip", id: "tooltip", "aria-hidden": "true", hidden: true });
    this.card = h("aside", { class: "info-card", id: "infoCard", "aria-labelledby": "infoCardTitle", hidden: true });
    this.live = h("p", { class: "visually-hidden", id: "infoLive", "aria-live": "polite" });
    stage.append(this.tip, this.card, this.live);
    // camera view: the pointer (the flyover routes its own, see flyover.js)
    const c = app.canvas, mine = (fn) => (e) => app.mode !== "flyover" && fn(e);
    c.addEventListener("pointermove", mine((e) => {
      if (e.pointerType === "mouse" && !e.buttons) this.hoverAt(this._pixel(e));
    }));
    c.addEventListener("pointerleave", () => this.clearHover());
    c.addEventListener("pointerdown", mine((e) => {
      this._tap = e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
    }));
    c.addEventListener("pointerup", mine((e) => {
      const t = this._tap;
      this._tap = null;
      if (!t || t.id !== e.pointerId || Math.hypot(e.clientX - t.x, e.clientY - t.y) > TAP_PX) return;
      this.tapAt(this._pixel(e), { touch: e.pointerType !== "mouse" });
    }));
    c.addEventListener("pointercancel", () => (this._tap = null));
  }

  get world() {
    return this.app.world;
  }

  /** Taps open cards outside Build and Terminal (there they select and pick). */
  get clicks() {
    const tab = this.app.activeTab;
    return tab !== "build" && tab !== "terminal";
  }

  /** The tooltip follows the mouse unless something is being placed or dragged. */
  get hovers() {
    const ed = this.app.editor;
    return !ed.placing && !ed.drag && !this.app.terminal.stage;
  }

  _pixel(e) {
    const c = this.app.canvas, r = c.getBoundingClientRect();
    return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height];
  }

  /** What is at a canvas pixel in the view of the last frame (null without a view). */
  pickAt(pixel, { touch = false } = {}) {
    const view = this.app.lastView;
    if (!view) return null;
    return this.world.pick(view, pixel, { tolerance: touch ? PICK_TOLERANCE.touch : PICK_TOLERANCE.mouse });
  }

  /* ---------------------------------------------------------------- tooltip */

  /** The mouse is at a canvas pixel: the tooltip is updated in the next frame. */
  hoverAt(pixel) {
    this._pending = pixel;
    this.keyAim = false; // the mouse takes over from the keyboard
  }

  clearHover() {
    this._pending = null;
    this.hover = null;
    this.tip.hidden = true;
    this.app.canvas.classList.remove("pointable");
  }

  /** Once per frame (after drawing): the tooltip for the last mouse position. */
  frame() {
    const pixel = this._pending;
    if (!pixel) return;
    this._pending = null;
    const hit = this.hovers ? this.pickAt(pixel) : null;
    this.hover = hit;
    this.app.canvas.classList.toggle("pointable", !!hit && this.clicks);
    // its card is open already: no tooltip over it
    if (!hit || hit.key === this.open?.key) {
      this.tip.hidden = true;
      return;
    }
    const card = this.world.card(hit);
    mount(this.tip,
      h("strong", {}, card.title),
      card.subtitle ? h("span", {}, card.subtitle) : null,
      card.status ? h("span", { class: `status ${card.tone || ""}` }, card.status) : null);
    // beside the pointer, inside the stage
    const c = this.app.canvas, r = c.getBoundingClientRect(), stage = $("#stageWrap").getBoundingClientRect();
    const x = r.left - stage.left + (pixel[0] * r.width) / c.width, y = r.top - stage.top + (pixel[1] * r.height) / c.height;
    this.tip.hidden = false;
    const w = this.tip.offsetWidth, ht = this.tip.offsetHeight;
    this.tip.style.left = `${Math.max(4, Math.min(stage.width - w - 4, x + 14))}px`;
    this.tip.style.top = `${y + 18 + ht > stage.height ? Math.max(4, y - ht - 10) : y + 18}px`;
  }

  /* ---------------------------------------------------------------- card */

  /** A tap at a canvas pixel: the card of what is there, or the card closes. */
  tapAt(pixel, { touch = false } = {}) {
    if (!this.clicks) return false;
    const hit = this.pickAt(pixel, { touch });
    if (hit) this.show(hit);
    else this.close();
    return !!hit;
  }

  /** Enter on the flyover: the card of what is at the cross in the middle. */
  inspectCentre() {
    const c = this.app.canvas;
    this.keyAim = true;
    const hit = this.pickAt([c.width / 2, c.height / 2], { touch: true });
    // the keyboard stays on the stage (the arrows go on moving the view); the card is announced
    if (hit) this.show(hit);
    else {
      this.close();
      this.announce("Nothing at the cross. Move the view with the arrow keys.");
    }
    return !!hit;
  }

  /** Open the card of a pickable (and say what it is, for screen readers). */
  show(hit) {
    this.open = { key: hit.key, hit };
    this.tip.hidden = true;
    const card = this.render();
    if (card) this.announce(`${card.title}${card.subtitle ? `, ${card.subtitle}` : ""}${card.status ? `. ${card.status}` : ""}`);
  }

  /** Close the card; returns true if one was open. */
  close() {
    if (!this.open) return false;
    const hadFocus = this.card.contains(document.activeElement);
    this.open = null;
    this.card.hidden = true;
    if (hadFocus) this.app.canvas.focus?.({ preventScroll: true });
    return true;
  }

  /** Another layout: nothing of the old one stays open. */
  reset() {
    this.close();
    this.clearHover();
  }

  announce(text) {
    this.live.textContent = "";
    // a new text, also when it is the same as before
    setTimeout(() => (this.live.textContent = text), 30);
  }

  /** The pickable of the open card now (people and vehicles move on), or its last known one. */
  current() {
    if (!this.open) return null;
    const now = this.world.findPickable(this.app.lastView, this.open.key);
    if (now) this.open.hit = now;
    return now;
  }

  /** Refresh the card (every few hundred milliseconds); it closes when its object is gone. */
  update() {
    if (!this.open) return;
    if (this.open.key.startsWith("object:") && !this.current()) return this.close();
    this.render();
  }

  /** Draw the card anew (buttons keep their focus). */
  render() {
    if (!this.open) return null;
    const hit = this.current() || this.open.hit;
    const card = this.world.card(hit);
    const gone = !this.open.key.startsWith("object:") && !this.world.findPickable(this.app.lastView, this.open.key);
    morph(this.card,
      h("div", { class: "info-head" },
        h("div", {},
          h("h2", { id: "infoCardTitle" }, card.title),
          card.subtitle ? h("p", { class: "info-sub" }, card.subtitle) : null),
        h("button", { class: "btn small", type: "button", id: "infoCardClose", "aria-label": "Close the info card", title: "Close (Esc)", onclick: () => this.close() }, "×")),
      card.status || gone ? h("p", { class: `info-status ${card.tone || ""}` }, gone ? `${card.status ? `${card.status} · ` : ""}out of view` : card.status) : null,
      card.rows.length ? h("dl", { class: "info-rows" }, card.rows.map(([k, v]) => [h("dt", {}, k), h("dd", {}, String(v))])) : null,
      card.sections.map((s) => h("div", { class: "info-section" }, h("h3", {}, s.title), h("ul", {}, s.lines.map((l) => h("li", {}, l))))),
      card.text ? h("p", { class: "info-text" }, card.text) : null,
      card.actions.length ? h("div", { class: "row" }, card.actions.map((a) => h("button", { class: "btn small", type: "button", onclick: () => this.act(a.id) }, a.label))) : null,
    );
    this.card.hidden = false;
    return card;
  }

  /** An action of a card: "follow" (the flyover's camera follows it). */
  act(id) {
    const key = this.open?.key;
    if (!key || id !== "follow") return;
    if (key.startsWith("traveller:")) return this.app.followTraveller(key.slice("traveller:".length));
    const app = this.app;
    if (!app.flyover.active) app.flyover.enter();
    app.flyover.follow(() => {
      const p = this.world.findPickable(app.lastView, key);
      if (!p) return null;
      const o = p.outline;
      return [o.reduce((s, q) => s + q[0], 0) / o.length, o.reduce((s, q) => s + q[1], 0) / o.length];
    });
  }

  /* ---------------------------------------------------------------- highlight */

  /**
   * Outline what the card is about (and the objects it relates to), and what the mouse points at;
   * with the keyboard in the flyover, the cross in the middle where Enter points.
   */
  drawOverlay(ctx, view) {
    this.frame();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineJoin = "round";
    if (this.hover && this.hover.key !== this.open?.key) outline(ctx, view, this.hover, rgba(OVERLAY.tracked, 0.9), 2);
    if (this.open) {
      const hit = this.current();
      if (hit) {
        outline(ctx, view, hit, OVERLAY.selection, 3);
        const card = this.world.card(hit);
        for (const id of card.related || []) {
          const p = this.world.findPickable(view, `object:${id}`);
          if (p) outline(ctx, view, p, rgba(OVERLAY.selection, 0.7), 2, [6, 4]);
        }
      }
    }
    ctx.restore();
    if (this.keyAim && this.clicks && this.app.flyover.active && document.activeElement === this.app.canvas) aimCross(ctx, view, "Enter: info");
  }
}

/** An outline in image px: the ground footprint of what lies flat, the hull of the projected box of what is tall. */
function outline(ctx, view, p, colour, width, dash = []) {
  const flat = (p.z1 ?? 0) <= (p.z0 ?? 0);
  const pts = flat ? view.projectAll(p.outline.map((q) => [q[0], q[1], p.z0 ?? 0])) : projectedHull(view, p);
  if (!pts || pts.length < 2) return;
  const px = view.px || 1;
  ctx.setLineDash(dash.map((d) => d * px));
  for (const [c, w] of [["rgba(255,255,255,0.75)", width + 2.5], [colour, width]]) {
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    ctx.closePath();
    ctx.strokeStyle = c;
    ctx.lineWidth = w * px;
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

/** The cross in the middle of the flyover where Enter points, with a hint below it ("Enter: info"). */
export function aimCross(ctx, view, text) {
  const c = ctx.canvas, px = view.px || 1, x = c.width / 2, y = c.height / 2, r = 11 * px;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineCap = "round";
  for (const [colour, w] of [["rgba(255,255,255,0.9)", 5], [OVERLAY.selection, 2.5]]) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = w * px;
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.lineTo(x - 4 * px, y);
    ctx.moveTo(x + 4 * px, y);
    ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, y - 4 * px);
    ctx.moveTo(x, y + 4 * px);
    ctx.lineTo(x, y + r);
    ctx.stroke();
  }
  ctx.font = `700 ${11 * px}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const w = ctx.measureText(text).width + 10 * px;
  ctx.fillStyle = OVERLAY.label;
  ctx.fillRect(x - w / 2, y + r + 5 * px, w, 17 * px);
  ctx.fillStyle = OVERLAY.labelText;
  ctx.fillText(text, x, y + r + 8 * px);
  ctx.restore();
}
