// The photo tour on the stage (tour.js): walk round the lab from photo to photo, as in Street View.
// The perspective button in the upper left corner switches to the next side the part has a photo
// from, round the table; its icon shows where the camera stands. The arrows at the left and right
// edges of the stage (and the keys ← and →) go to the next part of the table, in the same
// perspective where it has one. A photo with a digital layer opens with the layout of that layer,
// which tracks it; the others are shown as photos only. A photo with a covered version (`covered`,
// made in the builder's Photos tab) is shown covered. While a scenario runs, the tour offers only
// the photos of its task (`setScope`): the button goes only to their sides, and without another part
// to go to the arrows are hidden.
import { PERSPECTIVES, PhotoTour, perspectiveOf } from "./tour.js";
import { $, h, mount } from "./ui.js";
import { tr } from "./i18n.js";

/**
 * The perspectives in the order the button goes through them: round the table, clockwise seen from
 * above, from the front to the right, along the back and back to the front on the left.
 */
export const ROUND = ["front", "front-right", "back-right", "back", "back-left", "front-left"];

/**
 * The icon of a perspective, seen from above: the table (its front below) and the camera, a dot with
 * its view towards the table, where it stands: [x, y] of the camera and the direction it looks in.
 */
const CAMERAS = {
  "back-left": [3, 2.5, 45], back: [10, 2, 90], "back-right": [17, 2.5, 135],
  "front-left": [3, 17.5, -45], front: [10, 18, -90], "front-right": [17, 17.5, -135],
};
export function perspectiveIcon(id) {
  const [x, y, deg] = CAMERAS[id] ?? CAMERAS.front, r = Math.PI / 180, len = deg % 90 ? 7 : 5.8;
  const tip = (d) => `${(x + len * Math.cos((deg + d) * r)).toFixed(2)} ${(y + len * Math.sin((deg + d) * r)).toFixed(2)}`;
  return `<svg viewBox="0 0 20 20" aria-hidden="true"><rect class="tour-table" x="4.5" y="7.4" width="11" height="5.2" rx="1"/><path class="tour-cone" d="M${x} ${y}L${tip(-30)}L${tip(30)}Z"/><circle class="tour-camera" cx="${x}" cy="${y}" r="1.8"/></svg>`;
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
    /** The photo map's data, the tour of all its photos, and the photos offered now (a scenario's, or null: all). */
    this.data = null;
    this.all = null;
    this.scope = null;
    /** The perspective chosen with the button (kept while a part does not have it). */
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
      this.data = data;
      this.all = this.tour = new PhotoTour(data);
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
    /** The perspective button: its icon, name and title follow the photo shown (sync). */
    this.button = h("button", { class: "btn tour-view", type: "button", id: "tourView", onclick: () => this.turn() });
    this._shown = null;
    const step = (dir, label) => {
      const b = h("button", { class: "btn tour-step", type: "button", "data-step": String(dir), "aria-label": label, title: label, onclick: () => this.go(dir) });
      b.innerHTML = STEP_ICONS[dir];
      return b;
    };
    mount(this.el, this.button, step(-1, "Next part to the left (←)"), step(1, "Next part to the right (→)"));
  }

  /** Is the photo of the tour on the stage (not another photo, a video or the camera)? */
  showing() {
    const s = this.app.source;
    return !!this.at && !!s && !s.stale && s.kind === "image" && s.el?.src === this.at.src;
  }

  /**
   * Is the tour at its photo: on the stage, or on its way there (the stage still shows what it showed
   * when the tour began to open it), so that a second click goes on from it?
   */
  _current() {
    if (!this.at || this.at.part == null) return false;
    return this.showing() || (this._from !== undefined && (this.app.source?.el ?? null) === this._from);
  }

  /** Are there photos to go to (none: a scenario whose layout has no photos in the tour)? */
  get open() {
    return !!this.tour?.parts.length;
  }

  /**
   * The part the tour is at: the one shown, else where the layout's digital layer is shown best, else
   * the first (of the scenario's parts while one runs).
   */
  here() {
    if (this._current()) return this.at.part;
    const url = this.app.layoutUrl;
    for (const [id, l] of Object.entries(this.tour.layers)) {
      if (url && new URL(l.layout, this.dataUrl).href === url && this.tour.home(id) >= 0) return this.tour.home(id);
    }
    return this.at?.part ?? Math.max(0, this.tour.home(Object.keys(this.tour.layers)[0]));
  }

  /** To the next part on the left (-1) or the right (1), in the perspective chosen. */
  go(dir) {
    if (!this.open) return;
    const part = this.tour.step(this.here(), this.perspective, dir);
    return this._open(this.tour.view(part, this.perspective));
  }

  /** Look at the part from another side (while a scenario runs, only a side it has a photo from). */
  choose(perspective) {
    if (!this.open) return;
    if (this.scope && !this.tour.parts[this.here()].views[perspective]) return;
    this.perspective = perspective;
    return this._open(this.tour.view(this.here(), perspective));
  }

  /** The sides the part the tour is at has a photo from, in the button's order (ROUND). */
  perspectivesHere() {
    if (!this.open) return [];
    const part = this.tour.parts[this.here()];
    return ROUND.filter((v) => part.views[v]);
  }

  /**
   * What the button shows: the perspective of the tour's photo on the stage, else the one chosen, and
   * where a click goes: the next side round the table the part has a photo from (with no photo of the
   * tour on the stage, the side chosen, or the next one it has); null with nowhere else to go.
   * @returns {{now: string, next: string | null}}
   */
  turning() {
    const have = this.perspectivesHere(), showing = this._current();
    const now = showing ? this.at.perspective : this.perspective, i = Math.max(0, ROUND.indexOf(now));
    let next = null;
    for (let k = showing ? 1 : 0; k < ROUND.length && !next; k++) {
      const v = ROUND[(i + k) % ROUND.length];
      if (have.includes(v)) next = v;
    }
    return { now, next };
  }

  /** The button: to the next side of the part (`turning`). */
  turn() {
    const { next } = this.turning();
    if (next) return this.choose(next);
  }

  /** The ids of the photo map's digital layers that show a layout (absolute URL). */
  layersShowing(url) {
    return Object.entries(this.all?.layers || {}).filter(([, l]) => url && new URL(l.layout, this.dataUrl).href === url).map(([id]) => id);
  }

  /** The name of the part of the table a photo belongs to (its group's, else its place). */
  partName(photo) {
    return this.data?.groups?.[photo.group]?.name || photo.place || photo.group;
  }

  /**
   * Offer only the photos of a scenario's task, or all again (null). The photo shown stays; in the
   * scenario's tour it keeps its place if it is one of them, and the buttons follow.
   * @param {{key: string, only: (photo: object) => boolean} | null} scope key: what the scope is (the same key: nothing changes)
   */
  setScope(scope) {
    if (!this.all || (scope?.key ?? null) === (this.scope?.key ?? null)) return;
    this.scope = scope ?? null;
    this.tour = scope ? new PhotoTour(this.data, { only: scope.only }) : this.all;
    if (this.at) {
      // a photo of the map that is not one of the tour's stands for its part, as with ?photo= (not in a scenario's tour)
      const found = this.tour.find(this.at.photo.id), group = scope ? -1 : this.tour.parts.findIndex((p) => p.id === this.at.photo.group);
      this.at = { ...this.at, part: found ? found.part : group >= 0 ? group : null };
    }
    this.sync();
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

  /** The address of a photo of the map as the stage shows it: its covered version, where it has one. */
  _src(photo) {
    return new URL(photo.covered || photo.image, this.dataUrl).href;
  }

  /**
   * The photo on the stage, when it is one of the tour's but the tour did not open it (a layout
   * opened with its own photo, which is on the photo map: the hybrid container train's): the tour is
   * there, so that a change of perspective can come back to it.
   */
  _adopt() {
    const s = this.app.source;
    if (!s || s.stale || s.kind !== "image" || !s.el?.src || this.showing()) return;
    for (const [i, part] of this.tour.parts.entries()) {
      for (const [v, p] of Object.entries(part.views)) {
        if (this._src(p) !== s.el.src) continue;
        this.at = { part: i, photo: p, perspective: v, exact: true, src: s.el.src };
        this.perspective = v;
        this._from = undefined;
        return;
      }
    }
  }

  async _open(view) {
    const app = this.app, token = ++this._token, p = view.photo;
    const src = this._src(p);
    this.at = { ...view, src };
    this._from = app.source?.el ?? null; // what the stage shows until the photo is there
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
   * The buttons as the stage is now: hidden in the flyover (and while a scenario runs whose layout has
   * no photos). The perspective button shows the side of the photo shown (its icon and name, "From
   * the front left"), its title where a click goes; with no other side to go to it is off. The arrows
   * are hidden without another part to go to.
   */
  sync() {
    if (!this.el || !this.tour) return;
    const hidden = this.app.flyover.active || !this.open;
    if (this.el.hidden !== hidden) this.el.hidden = hidden;
    if (!this.open) return;
    this._adopt();
    const { now, next } = this.turning(), label = (id) => PERSPECTIVES.find((v) => v.id === id)?.label ?? id;
    const key = `${now}|${next}|${tr("Perspective")}`; // the language shown, too
    if (this._shown !== key) {
      this._shown = key;
      const b = this.button;
      b.innerHTML = perspectiveIcon(now);
      b.dataset.view = now;
      b.setAttribute("aria-label", tr(`Perspective: ${label(now)}`));
      b.title = tr(next ? `Next perspective: ${label(next)}` : "No other perspective here");
      b.disabled = !next;
    }
    for (const b of this.el.querySelectorAll(".tour-step")) b.hidden = this.tour.parts.length < 2;
    // the HUD and a message while placing keep clear of the button
    $("#stageWrap")?.style.setProperty("--tour-w", `${this.button?.offsetWidth || 0}px`);
  }

  /** The chip of the HUD: that the photo has no digital layer (the perspective button says where it was taken). */
  hudChips() {
    if (!this.showing() || this.layoutOf(this.at.photo.id)) return [];
    return [["warn", "Photo only: no digital layer for this part yet"]];
  }

  /** ← and → on the stage (or with nothing focused) go round the lab; returns true if the key was used. */
  key(e) {
    if (!this.open || this.tour.parts.length < 2 || this.app.flyover.active || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return false;
    const t = e.target;
    if (t !== document.body && t !== document.documentElement && !t.closest?.("#stageWrap")) return false;
    this.go(e.key === "ArrowLeft" ? -1 : 1);
    return true;
  }
}
