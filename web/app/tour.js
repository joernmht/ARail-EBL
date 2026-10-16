// The photo tour: the survey photos of the lab (the photo map's data, web/lab-map/data.json) as a
// Street View of the layout. The photos are grouped into parts of the table (the marker groups of
// the survey) in their order round the ring of tables, and each part keeps at most one photo for
// each of six perspectives: from the front, from the back and from the four diagonals. The front
// of a part is the side of the middle of the hall. Left and right go to the next part on that side
// of the camera, in the same perspective where the part has it. No DOM here: tested in Node.

/**
 * The six perspectives, by where the camera stands (left and right as seen from the front) and
 * the direction it looks in, relative to looking straight at the table from the front (degrees,
 * counter-clockwise: a camera at the front left looks to the right, -45°).
 */
export const PERSPECTIVES = [
  { id: "back-left", side: "back", angle: -135, label: "From the back left" },
  { id: "back", side: "back", angle: 180, label: "From the back" },
  { id: "back-right", side: "back", angle: 135, label: "From the back right" },
  { id: "front-left", side: "front", angle: -45, label: "From the front left" },
  { id: "front", side: "front", angle: 0, label: "From the front" },
  { id: "front-right", side: "front", angle: 45, label: "From the front right" },
];

const BY_ID = new Map(PERSPECTIVES.map((p) => [p.id, p]));
const RAD = Math.PI / 180;
/** Angle in (-180, 180]. */
const wrap = (a) => {
  const w = ((((a + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
};

/**
 * The perspective of a view direction relative to the front (degrees): 60° each, straight from the
 * front or the back within 30°, the diagonals between.
 */
export function perspectiveOf(relative) {
  const a = wrap(relative);
  if (Math.abs(a) <= 30) return "front";
  if (Math.abs(a) >= 150) return "back";
  if (a < 0) return a > -90 ? "front-left" : "back-left";
  return a < 90 ? "front-right" : "back-right";
}

/**
 * How well a photo shows its part in a perspective (lower is better): one with a digital layer
 * first (the app tracks it), then the one looking most nearly that way, near the middle of the
 * part, with more markers.
 */
function cost(photo, part, ideal) {
  const off = Math.abs(wrap(photo.heading - part.front - ideal));
  const dist = Math.hypot(photo.x - part.x, photo.y - part.y);
  return (photo.layer ? 0 : 1000) + off + dist / 50 - 2 * (photo.markers || 0);
}

export class PhotoTour {
  /**
   * @param {{photos: object[], groups?: object, layers?: object}} data the photo map (arail-lab-map/1)
   */
  constructor(data) {
    this.layers = data.layers || {};
    const groups = data.groups || {};
    const photos = (data.photos || []).filter((p) => Number.isFinite(p.heading) && Number.isFinite(p.x) && Number.isFinite(p.y));
    const all = data.photos || [];
    // the hall: the middle line of its ring of tables (the long axis, shortened by half the width at both ends)
    const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const r = (y1 - y0) / 2, cy = (y0 + y1) / 2;
    /** The hall's middle: the centre of the ring, and its middle line [from x, to x, y]. */
    this.hall = { x: (x0 + x1) / 2, y: cy, spine: x1 - x0 > 2 * r ? [x0 + r, x1 - r, cy] : [(x0 + x1) / 2, (x0 + x1) / 2, cy] };
    const byGroup = new Map();
    for (const p of all) {
      if (!byGroup.has(p.group)) byGroup.set(p.group, []);
      byGroup.get(p.group).push(p);
    }
    /**
     * The parts in their order round the ring (clockwise seen from above, windows at the top: along
     * the windows towards Waldhof): id, name, centre (mm, hall frame), `front` (the direction a
     * camera at its front looks in, degrees) and its photos by perspective.
     * @type {Array<{id: string, name: string, x: number, y: number, front: number, around: number, views: Object<string, object>, layers: Object<string, number>}>}
     */
    this.parts = [...byGroup].map(([id, ps]) => {
      const x = ps.reduce((s, p) => s + p.x, 0) / ps.length, y = ps.reduce((s, p) => s + p.y, 0) / ps.length;
      const [sx0, sx1, sy] = this.hall.spine, nx = Math.min(Math.max(x, sx0), sx1);
      const part = {
        id, name: groups[id]?.name || ps[0].place || id, x, y,
        front: Math.atan2(y - sy, x - nx) / RAD,
        around: Math.atan2(y - this.hall.y, x - this.hall.x) / RAD,
        views: {},
        /** How many of its photos (all of them, not only the tour's) have each digital layer. */
        layers: {},
      };
      for (const p of ps) if (p.layer) part.layers[p.layer] = (part.layers[p.layer] || 0) + 1;
      const best = {};
      for (const p of photos.filter((q) => q.group === id)) {
        const v = perspectiveOf(p.heading - part.front), c = cost(p, part, BY_ID.get(v).angle);
        if (!best[v] || c < best[v].c) best[v] = { p, c };
      }
      for (const v of PERSPECTIVES) if (best[v.id]) part.views[v.id] = best[v.id].p;
      return part;
    }).filter((part) => Object.keys(part.views).length)
      .sort((a, b) => b.around - a.around); // clockwise: the angle round the middle falls
  }

  /** All photos of the tour (at most six per part). */
  photos() {
    return this.parts.flatMap((part) => PERSPECTIVES.map((v) => part.views[v.id]).filter(Boolean));
  }

  /**
   * The photo of a part in a perspective, or the nearest one it has (by the direction of view; on
   * the same side before the other one). Returns {part (index), photo, perspective (of the photo),
   * exact (it is the one asked for)}.
   * @param {number} index
   * @param {string} perspective
   */
  view(index, perspective = "front") {
    const part = this.parts[this._index(index)], want = BY_ID.get(perspective) || BY_ID.get("front");
    const order = [...PERSPECTIVES].sort((a, b) => Math.abs(wrap(a.angle - want.angle)) - Math.abs(wrap(b.angle - want.angle))
      || (a.side === want.side ? 0 : 1) - (b.side === want.side ? 0 : 1));
    const v = order.find((p) => part.views[p.id]);
    return { part: this._index(index), photo: part.views[v.id], perspective: v.id, exact: v.id === want.id };
  }

  /**
   * The part to the left or the right of a part, as seen by a camera in a perspective: to the right
   * of a camera at the front is the next part clockwise, of one at the back the one before it. The
   * ring is closed.
   * @param {number} index
   * @param {string} perspective
   * @param {1 | -1} dir 1: right, -1: left
   */
  step(index, perspective, dir) {
    const side = (BY_ID.get(perspective) || BY_ID.get("front")).side;
    return this._index(index + (side === "front" ? dir : -dir));
  }

  /** Where a photo is in the tour ({part, perspective}), or null if it is not one of its photos. */
  find(id) {
    for (const [i, part] of this.parts.entries()) {
      for (const [v, p] of Object.entries(part.views)) if (p.id === id) return { part: i, perspective: v };
    }
    return null;
  }

  /** The part where a layer (a layout) is shown best: the one with the most photos with it, or -1. */
  home(layer) {
    let best = -1, n = 0;
    for (const [i, part] of this.parts.entries()) {
      if ((part.layers[layer] || 0) > n) [best, n] = [i, part.layers[layer]];
    }
    return best;
  }

  _index(i) {
    const n = this.parts.length;
    return ((Math.round(i) % n) + n) % n;
  }
}
