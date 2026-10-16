// The photo tour on the stage (tour.js): walk round the lab from photo to photo, as in Street View.
// The perspective buttons in the upper left corner choose the side the photos are taken from, the
// arrows at the left and right edges of the stage (and the keys ← and →) go to the next part of the
// table, in the same perspective where it has one. A photo with a digital layer opens with the
// layout of that layer, which tracks it; the others are shown as photos only.
import { PERSPECTIVES, PhotoTour, perspectiveOf } from "./tour.js";
import { $, h, mount } from "./ui.js";

/**
 * The icon of a perspective: an arrow from where the camera stands towards the table, which lies
 * between the back row of the buttons and the front row.
 */
const ARROWS = {
  "back-left": [4.5, 4.5, 14.5, 14.5], back: [10, 3, 10, 16.5], "back-right": [15.5, 4.5, 5.5, 14.5],
  "front-left": [4.5, 15.5, 14.5, 5.5], front: [10, 17, 10, 3.5], "front-right": [15.5, 15.5, 5.5, 5.5],
};
function perspectiveIcon(id) {
  const [x0, y0, x1, y1] = ARROWS[id], a = Math.atan2(y1 - y0, x1 - x0), k = 5.5;
  const head = [a + 2.4, a - 2.4].map((b) => `${(x1 + k * Math.cos(b)).toFixed(2)} ${(y1 + k * Math.sin(b)).toFixed(2)}`);
  return `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M${x0} ${y0}L${x1} ${y1}M${head[0]}L${x1} ${y1}L${head[1]}"/></svg>`;
}

const STEP_ICONS = {
  "-1": '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 3.5 6 10l6.5 6.5"/></svg>',
  1: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 3.5 14 10l-6.5 6.5"/></svg>',
};

export class TourNav {
  /**
   * @param {import("./app.js").App} app
   * @param {{data: string}} options the photo map's data (its URL, relative to the page)
   */
  constructor(app, { data }) {
    this.app = app;
    this.dataUrl = new URL(data, location.href).href;
    this.el = $("#tour");
    /** @type {PhotoTour | null} */
    this.tour = null;
    /** All photos of the photo map, by id (?photo= may name one that is not in the tour). */
    this.byId = new Map();
    /** The perspective chosen with the buttons (kept while a part does not have it). */
    this.perspective = "front";
    /** The photo the tour shows ({part, photo, perspective, exact, src}), or null. */
    this.at = null;
    this._token = 0;
  }

  /** Load the photo map's data and make the buttons; without them the tour stays hidden. */
  async load() {
    if (!this.el) return false;
    try {
      const res = await fetch(this.dataUrl);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      this.tour = new PhotoTour(data);
      for (const p of data.photos || []) this.byId.set(p.id, p);
    } catch (err) {
      console.warn("The photo tour could not be loaded:", err);
      return false;
    }
    this._render();
    this.sync();
    return true;
  }

  _render() {
    const views = h("div", { class: "tour-views", role: "group", "aria-label": "Perspective" },
      PERSPECTIVES.map((p) => {
        const b = h("button", { class: "btn", type: "button", "data-view": p.id, "aria-label": p.label, title: p.label, "aria-pressed": "false", onclick: () => this.choose(p.id) });
        b.innerHTML = perspectiveIcon(p.id);
        return b;
      }));
    // the table between the cameras at its back (above) and at its front (below)
    views.insertBefore(h("span", { class: "tour-table", "aria-hidden": "true" }), views.children[3]);
    const step = (dir, label) => {
      const b = h("button", { class: "btn tour-step", type: "button", "data-step": String(dir), "aria-label": label, title: label, onclick: () => this.go(dir) });
      b.innerHTML = STEP_ICONS[dir];
      return b;
    };
    mount(this.el, views, step(-1, "Next part to the left (←)"), step(1, "Next part to the right (→)"),
      h("span", { class: "visually-hidden", id: "tourMissing" }, "No photo from this side here: the nearest one is shown."));
  }

  /** Is the photo of the tour on the stage (not another photo, a video or the camera)? */
  showing() {
    const s = this.app.source;
    return !!this.at && !!s && !s.stale && s.kind === "image" && s.el?.src === this.at.src;
  }

  /** The part the tour is at: the one shown, else where the layout's digital layer is shown best, else the first. */
  here() {
    if (this.showing()) return this.at.part;
    const url = this.app.layoutUrl;
    for (const [id, l] of Object.entries(this.tour.layers)) {
      if (url && new URL(l.layout, this.dataUrl).href === url && this.tour.home(id) >= 0) return this.tour.home(id);
    }
    return this.at?.part ?? Math.max(0, this.tour.home(Object.keys(this.tour.layers)[0]));
  }

  /** To the next part on the left (-1) or the right (1), in the perspective chosen. */
  go(dir) {
    if (!this.tour) return;
    const part = this.tour.step(this.here(), this.perspective, dir);
    return this._open(this.tour.view(part, this.perspective));
  }

  /** Look at the part from another side. */
  choose(perspective) {
    if (!this.tour) return;
    this.perspective = perspective;
    return this._open(this.tour.view(this.here(), perspective));
  }

  /**
   * Show a photo of the photo map by its id (?photo=): one of the tour's, or any other, which then
   * stands for its part. Returns false if there is no such photo.
   */
  showPhoto(id) {
    if (!this.tour) return false;
    const found = this.tour.find(id);
    if (found) {
      this.perspective = found.perspective;
      this._open(this.tour.view(found.part, found.perspective));
      return true;
    }
    const photo = this.byId.get(id), part = photo ? this.tour.parts.findIndex((p) => p.id === photo.group) : -1;
    if (part < 0) return false;
    const perspective = Number.isFinite(photo.heading) ? perspectiveOf(photo.heading - this.tour.parts[part].front) : "front";
    this.perspective = perspective;
    this._open({ part, photo, perspective, exact: true });
    return true;
  }

  /** The layout of a photo's digital layer (absolute URL), or null. */
  layoutOf(id) {
    const l = this.tour?.layers[this.byId.get(id)?.layer];
    return l ? new URL(l.layout, this.dataUrl).href : null;
  }

  async _open(view) {
    const app = this.app, token = ++this._token, p = view.photo;
    const src = new URL(p.image, this.dataUrl).href;
    this.at = { ...view, src };
    const part = this.tour.parts[view.part], label = PERSPECTIVES.find((v) => v.id === view.perspective).label;
    app.flyover.leave(); // a photo is shown in the camera view
    const layout = this.layoutOf(p.id);
    await app.openPhoto(src, `${part.name} · ${label}`, { layout, track: !!layout, current: () => token === this._token });
    if (token !== this._token) return;
    // the address opens this photo again
    const q = new URLSearchParams(location.search);
    for (const k of ["layout", "layers", "image", "example", "camera"]) q.delete(k);
    q.set("photo", p.id);
    history.replaceState(null, "", `${location.pathname}?${q}${location.hash}`);
    this.sync();
  }

  /**
   * The buttons as the stage is now: hidden in the flyover; the perspective shown pressed; the
   * perspectives the part has no photo for dimmed (choosing one shows the nearest it has).
   */
  sync() {
    if (!this.el || !this.tour) return;
    const hidden = this.app.flyover.active;
    if (this.el.hidden !== hidden) this.el.hidden = hidden;
    const showing = this.showing(), part = this.tour.parts[this.here()];
    for (const b of this.el.querySelectorAll("[data-view]")) {
      const v = b.dataset.view;
      b.setAttribute("aria-pressed", showing && this.at.perspective === v ? "true" : "false");
      b.classList.toggle("missing", !part.views[v]);
      if (part.views[v]) b.removeAttribute("aria-describedby");
      else b.setAttribute("aria-describedby", "tourMissing");
    }
    // the HUD and a message while placing keep clear of the buttons
    const views = this.el.querySelector(".tour-views"), wrap = $("#stageWrap");
    wrap?.style.setProperty("--tour-w", `${views?.offsetWidth || 0}px`);
    wrap?.style.setProperty("--tour-h", `${views?.offsetHeight || 0}px`);
  }

  /** The chips of the HUD: where the photo was taken; that it has no digital layer. */
  hudChips() {
    if (!this.showing()) return [];
    const part = this.tour.parts[this.at.part], label = PERSPECTIVES.find((v) => v.id === this.at.perspective).label;
    const chips = [["info", `${part.name} · ${label}`]];
    if (!this.layoutOf(this.at.photo.id)) chips.push(["warn", "Photo only: no digital layer for this part yet"]);
    return chips;
  }

  /** ← and → on the stage (or with nothing focused) go round the lab; returns true if the key was used. */
  key(e) {
    if (!this.tour || this.app.flyover.active || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return false;
    const t = e.target;
    if (t !== document.body && t !== document.documentElement && !t.closest?.("#stageWrap")) return false;
    this.go(e.key === "ArrowLeft" ? -1 : 1);
    return true;
  }
}
