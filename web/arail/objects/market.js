/**
 * A market square and what stands on it for a German Christmas market (Weihnachtsmarkt, in Dresden
 * the Striezelmarkt): wooden stalls that sell Glühwein, Stollen or Lederwaren (one of them a
 * steam locomotive), a big decorated Christmas tree, a ferris wheel, a carousel and a mini train
 * for children. The goods keep their German names in every language: it is a German market.
 *
 * - `market-square`: the paved square; its gates (`entrances()`) are where streets meet it.
 * - `market-stall`: a stall (hut or locomotive) with its goods, counter and standing tables.
 * - `christmas-tree`: the tree with baubles, lights and a star.
 * - `ferris-wheel`, `carousel`, `mini-train`: rides, each boarding and running in turn
 *   ({@link Ride}); the market simulation (sims/market.js) puts its visitors on them.
 *
 * What the simulation needs of each comes from `marketInfo()`. Stalls are greyscale like all
 * buildings; the signs, the decorations, the rides and the lights have colours. Sizes are
 * prototype metres; the front of a stall is its local −y side.
 * @module arail/objects/market
 */
import { LayoutObject } from "../core/object.js";
import { resolvePoint, resolvePoints } from "../core/anchors.js";
import { clamp, createRng, hashKey, pointInPolygon, pointSegment, polygonCentroid, polylineAt, polylineLengths, toRad } from "../core/math.js";
import { parseTime } from "../core/clock.js";
import { CD, FONT, PALETTE, grey, shade } from "../core/colors.js";
import { BuildingBase, TIER, TONES, gableRoof, polygonNormal } from "./building-kit.js";

const NAME = { key: "name", label: "Name", type: "text", default: "" };
const ROTATION = { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0 };
const num = (v, fallback, lo, hi) => clamp(Number.isFinite(+v) && v !== "" && v != null ? +v : fallback, lo, hi);

/**
 * What the stalls sell, by id: the German name (never translated), the kind, the price (€), the
 * seconds it takes to serve one customer, the clock minutes people stay at the stall to eat or
 * drink it (0: they take it with them), how much people want it (weight) and whether children ask
 * for it (`kids`). `hot`: it is made over a fire or a grill, which glows at night.
 */
export const MARKET_GOODS = {
  gluehwein: { name: "Glühwein", kind: "drink", price: 4.5, serve_s: 18, stay: [12, 25], weight: 10 },
  punsch: { name: "Punsch", kind: "drink", price: 4, serve_s: 18, stay: [10, 20], weight: 3, kids: true },
  eierpunsch: { name: "Eierpunsch", kind: "drink", price: 4.5, serve_s: 20, stay: [10, 20], weight: 2.5 },
  kakao: { name: "Kakao", kind: "drink", price: 3.5, serve_s: 20, stay: [8, 15], weight: 2, kids: true },
  baumstriezel: { name: "Baumstriezel", kind: "food", price: 6, serve_s: 35, stay: [6, 12], weight: 2.5, kids: true, hot: true },
  handbrot: { name: "Handbrot", kind: "food", price: 7, serve_s: 40, stay: [8, 15], weight: 3, hot: true },
  printen: { name: "Aachener Printen", kind: "sweets", price: 5, serve_s: 25, stay: [0, 0], weight: 1.2 },
  lebkuchen: { name: "Nürnberger Lebkuchen", kind: "sweets", price: 6, serve_s: 25, stay: [0, 0], weight: 1.8 },
  stollen: { name: "Dresdner Stollen", kind: "sweets", price: 18, serve_s: 40, stay: [0, 0], weight: 2 },
  "marzipan-luebeck": { name: "Lübecker Marzipan", kind: "sweets", price: 7, serve_s: 25, stay: [0, 0], weight: 1.2 },
  marzipan: { name: "Marzipan", kind: "sweets", price: 4, serve_s: 20, stay: [0, 0], weight: 1, kids: true },
  langos: { name: "Langos", kind: "food", price: 6.5, serve_s: 45, stay: [8, 14], weight: 2.5, hot: true },
  flammlachs: { name: "Flammlachs", kind: "food", price: 9, serve_s: 40, stay: [8, 15], weight: 2, hot: true },
  maronen: { name: "Maronen", kind: "food", price: 5, serve_s: 20, stay: [5, 10], weight: 1.5, hot: true },
  pilze: { name: "Pilze", kind: "food", price: 7, serve_s: 35, stay: [8, 15], weight: 2, hot: true },
  strickwaren: { name: "Strickwaren", kind: "crafts", price: 25, serve_s: 60, stay: [0, 0], weight: 1 },
  lederwaren: { name: "Lederwaren", kind: "crafts", price: 35, serve_s: 70, stay: [0, 0], weight: 0.8 },
  holzkunst: { name: "Holzkunst aus dem Erzgebirge", kind: "crafts", price: 30, serve_s: 70, stay: [0, 0], weight: 1 },
  kerzen: { name: "Kerzen", kind: "crafts", price: 8, serve_s: 40, stay: [0, 0], weight: 0.8 },
};

/** The kinds of goods in words, and the colour of their stalls' signs. */
export const GOODS_KINDS = {
  drink: { label: "hot drinks", colour: CD.rot },
  food: { label: "food", colour: CD.orange },
  sweets: { label: "sweets", colour: CD.gelb },
  crafts: { label: "crafts", colour: CD.tuerkis },
};

/** Opening hours of a market when no market simulation says otherwise (clock minutes). */
export const MARKET_HOURS = { open: 10 * 60, close: 22 * 60 };

/** Warm light of the stalls and the fairy lights (night). */
const WARM = "#ffd27a";

/** The opening hours of the market: the market simulation's, else {@link MARKET_HOURS}. */
export function marketHours(world) {
  const sim = world?.simulations?.find?.((s) => s.constructor.type === "market" && s.enabled);
  return sim?.hours?.() ?? MARKET_HOURS;
}

/** Is the market open at this time of day (clock minutes)? */
export function marketOpen(world, minutes = world?.clock?.minutes ?? 720) {
  const { open, close } = marketHours(world);
  return close > open ? minutes >= open && minutes < close : minutes >= open || minutes < close;
}

/* ================================================================== faces */

/** A planar face of layout points [x, y, z] (mm), its normal worked out (two-sided by default). */
function face(pts, colour, { twoSided = true, emissive = false, alpha } = {}) {
  return { pts, normal: polygonNormal(pts), color: colour, twoSided, emissive, alpha };
}

/**
 * A box standing on the layout: centre [x, y] (mm), `dir` along its length, length and width (mm),
 * from z0 to z1 (mm): its four sides and its top (closed, culled from behind).
 */
function boxFaces(c, dir, length, width, z0, z1, colour, top = colour) {
  const ux = dir[0] * (length / 2), uy = dir[1] * (length / 2), vx = -dir[1] * (width / 2), vy = dir[0] * (width / 2);
  const g = [[c[0] - ux - vx, c[1] - uy - vy], [c[0] + ux - vx, c[1] + uy - vy], [c[0] + ux + vx, c[1] + uy + vy], [c[0] - ux + vx, c[1] - uy + vy]];
  const out = [];
  for (let i = 0; i < 4; i++) {
    const a = g[i], b = g[(i + 1) % 4];
    out.push(face([[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]], colour, { twoSided: false }));
  }
  out.push(face(g.map(([x, y]) => [x, y, z1]), top, { twoSided: false }));
  return out;
}

/** A regular polygon of n corners round [cx, cy] (mm), counter-clockwise. */
function circle(c, r, n, a0 = 0) {
  return Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos(a0 + (i * 2 * Math.PI) / n), c[1] + r * Math.sin(a0 + (i * 2 * Math.PI) / n)]);
}

/** A cylinder standing on the layout: its sides and top. */
function cylinderFaces(c, r, z0, z1, n, colour, top = colour) {
  const g = circle(c, r, n), out = [];
  for (let i = 0; i < n; i++) {
    const a = g[i], b = g[(i + 1) % n];
    out.push(face([[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]], colour, { twoSided: false }));
  }
  out.push(face(g.map(([x, y]) => [x, y, z1]), top, { twoSided: false }));
  return out;
}

/* ================================================================== the square */

export class MarketSquare extends LayoutObject {
  static type = "market-square";
  static label = "Market square";
  static category = "Market";
  static placement = "polygon";
  static description = "A paved square (Marktplatz) for a market: its gates are where streets meet it, and the market simulation's visitors walk on it.";
  static params = [
    NAME,
    { key: "paving", label: "Paving", type: "select", options: [["cobbles", "cobblestones"], ["slabs", "slabs"]], default: "cobbles" },
    { key: "gate_m", label: "Gates within", type: "number", unit: "m", min: 5, max: 60, step: 1, default: 25, help: "A side of the square gets gates where a street or footpath passes this close to it." },
  ];

  computeGeometry() {
    const pts = resolvePoints(this.world.map, this.spec.points);
    if (!pts || pts.length < 3) return null;
    // counter-clockwise, so that the outward normal of a side is to its right
    const area = pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0);
    const points = area < 0 ? [...pts].reverse() : pts;
    const lamps = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.round(L / this.mm(22)));
      const nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        lamps.push([a[0] + (b[0] - a[0]) * t - nx * this.mm(1.2), a[1] + (b[1] - a[1]) * t - ny * this.mm(1.2)]);
      }
    }
    return { points, centroid: polygonCentroid(points), lamps };
  }

  footprint() {
    return this.geometry?.points || null;
  }

  /** Is a layout point on the square? */
  covers(p) {
    return !!this.geometry && pointInPolygon(p, this.geometry.points);
  }

  /**
   * The gates of the square (as doors, for the road network): on each side, points every 20 m
   * that lie within `gate_m` of a street or footpath, with the outward direction. Worked out from
   * the streets as they are now (kept until the objects change).
   */
  entrances() {
    const g = this.geometry;
    if (!g) return [];
    const key = `${this.world.objectsVersion ?? ""}:${this.world.map?.version ?? ""}:${this.spec.gate_m}`;
    if (g.gates && g.gatesKey === key) return g.gates;
    const near = this.mm(num(this.spec.gate_m, 25, 5, 60));
    const lines = [];
    for (const o of this.world.objects) {
      if (o === this || typeof o.roadInfo !== "function" || !o.geometry) continue;
      let info = null;
      try {
        info = o.roadInfo();
      } catch {
        info = null;
      }
      if (info?.points?.length >= 2 && info.walk !== false) lines.push(info.points);
    }
    const distance = (p) => {
      let best = Infinity;
      for (const l of lines) for (let i = 1; i < l.length; i++) best = Math.min(best, pointSegment(p, l[i - 1], l[i]).distance);
      return best;
    };
    const gates = [], step = this.mm(20), pts = g.points;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < this.mm(4)) continue;
      const n = Math.max(1, Math.round(L / step)), dir = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        if (distance(p) <= near) gates.push({ pos: p, dir });
      }
    }
    g.gates = gates;
    g.gatesKey = key;
    return gates;
  }

  /** The stalls, rides and the tree on the square. */
  contents() {
    return this.world.objects.filter((o) => o !== this && typeof o.marketInfo === "function" && o.geometry && this.covers(o.anchorPoint()));
  }

  card() {
    const card = super.card();
    const things = this.contents();
    const stalls = things.filter((o) => o.type === "market-stall").length, rides = things.filter((o) => o instanceof Ride).length;
    if (stalls) card.rows.push(["Market stalls", String(stalls)]);
    if (rides) card.rows.push(["Rides", String(rides)]);
    card.rows.push(["Gates", String(this.entrances().length)]);
    if (stalls) {
      const { open, close } = marketHours(this.world);
      card.rows.push(["Market", `${marketOpen(this.world) ? "open" : "closed"} (${fmt(open)}–${fmt(close)})`]);
    }
    return card;
  }

  draw(view) {
    const g = this.geometry, slabs = this.spec.paving === "slabs";
    view.polygon(g.points, { fill: slabs ? PALETTE.pavement : "#bdb4a5", alpha: 0.95, stroke: "rgba(90,85,75,0.5)", width: 1.2, order: 0.6, snow: 1 });
    // the joints of the paving, close up only
    const spacing = this.mm(slabs ? 3 : 1.5), c = g.centroid;
    const s = view.pxPerMM(c[0], c[1], 0) * spacing;
    if (s > 5 * view.px && !view.simple) {
      const img = view.projectAll(g.points);
      if (img && !view.offImage(img)) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of g.points) {
          x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
          y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
        }
        const lines = [];
        for (let x = x0 + spacing; x < x1; x += spacing) lines.push([[x, y0], [x, y1]]);
        for (let y = y0 + spacing; y < y1; y += spacing) lines.push([[x0, y], [x1, y]]);
        const proj = lines.map((l) => view.projectAll(l)).filter(Boolean);
        view.ground(0.65, (ctx) => {
          ctx.beginPath();
          img.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
          ctx.closePath();
          ctx.clip();
          // the joints vanish under snow
          ctx.globalAlpha *= 1 - (view.weather?.snow ?? 0);
          ctx.strokeStyle = view.dim("rgba(80,72,60,0.28)");
          ctx.lineWidth = 0.6 * view.px;
          ctx.beginPath();
          for (const [a, b] of proj) {
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
          }
          ctx.stroke();
        });
      }
    }
    // lanterns round the square (not in the way of a gate's arch)
    const arches = this.world.objects.filter((o) => o.type === "market-gate" && o.geometry).map((o) => o.geometry.center);
    for (const p of g.lamps) {
      if (arches.some((c) => Math.hypot(c[0] - p[0], c[1] - p[1]) < this.mm(5))) continue;
      view.prism(circle(p, this.mm(0.12), 6), 0, this.mm(4.2), { side: grey(0.25), top: grey(0.25) });
      view.glow([p[0], p[1], this.mm(4.3)], this.mm(1.6), WARM, 0.9);
      view.lightPool(p, this.mm(5), WARM, 0.7);
    }
  }
}

/** "10:00" from clock minutes. */
const fmt = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;

/* ================================================================== stalls */

const GOODS_OPTIONS = Object.entries(MARKET_GOODS).map(([k, v]) => [k, v.name]);

export class MarketStall extends BuildingBase {
  static type = "market-stall";
  static label = "Market stall";
  static category = "Market";
  static use = "other";
  static description = "A wooden stall (Marktbude) with a counter, fairy lights and standing tables, or a stall built like a steam locomotive. Sells one kind of goods.";
  static params = [
    NAME,
    ROTATION,
    { key: "goods", label: "Goods", type: "select", options: GOODS_OPTIONS, default: "gluehwein" },
    { key: "style", label: "Built as", type: "select", options: [["hut", "wooden hut"], ["locomotive", "steam locomotive"]], default: "hut" },
    { key: "width_m", label: "Width", type: "number", unit: "m", min: 2.5, max: 10, step: 0.5, default: 4, help: "Along the counter (a locomotive is 9 m long)" },
    { key: "depth_m", label: "Depth", type: "number", unit: "m", min: 2, max: 5, step: 0.5, default: 2.5 },
    { key: "tables", label: "Standing tables", type: "number", min: 0, max: 6, step: 1, help: "Leave empty: two for drinks and food, none for the others" },
  ];

  goods() {
    return MARKET_GOODS[this.spec.goods] || MARKET_GOODS.gluehwein;
  }

  floorsCount() {
    return 1;
  }

  tableCount() {
    const t = this.spec.tables;
    if (t !== "" && t != null && Number.isFinite(+t)) return Math.round(clamp(+t, 0, 6));
    return ["drink", "food"].includes(this.goods().kind) ? 2 : 0;
  }

  computeGeometry() {
    const m = this.model();
    if (!m) return null;
    const loco = this.spec.style === "locomotive";
    const w = loco ? 9 : num(this.spec.width_m, 4, 2.5, 10), d = loco ? 2.6 : num(this.spec.depth_m, 2.5, 2, 5);
    const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2, sign = GOODS_KINDS[this.goods().kind]?.colour || CD.rot;
    m.setAnchor(0, 0, 1.5, Math.hypot(w, d) / 2 + 2);
    let counter, lights = [], height, hatch, board;
    if (loco) ({ counter, lights, height, hatch, board } = this._locomotive(m, w, sign));
    else {
      const wall = grey(0.74), H = 2.3;
      const body = m.box(x0, y0, x1, y1, 0, H, { wall });
      const roof = gableRoof(m, { x0, y0, x1, y1, z: H, pitch: 32, overhang: 0.55, roof: grey(0.6), wall });
      const front = body.walls[0];
      // the counter's opening, lit while the stall is open; the sign over it; boards on the walls
      m.window(front, 0.35, w - 0.35, 1.0, 2.05, { group: "shop", colour: grey(TONES.opening), tier: TIER.coarse });
      for (const wl of body.walls) for (let s = 0.5; s < wl.length; s += 0.5) m.decal(wl, s - 0.02, s + 0.02, 0, wl === front ? 0.95 : H, grey(0.62), TIER.fine);
      m.part([...body.faces, ...roof.faces]);
      m.part(m.box(x0 + 0.25, y0 - 0.45, x1 - 0.25, y0, 0.92, 1.0, { wall: grey(0.8), top: grey(0.86) }).faces, { after: true, facing: front });
      m.shadow(m.rect(x0 - 0.5, y0 - 0.5, x1 + 0.5, y1 + 0.5), H + 1.2);
      counter = [0, y0 - 0.45];
      height = (roof.ridgeZ ?? H + 1.2);
      hatch = [0, y0, 1.6];
      const eave = H + 0.05 - 0.55 * Math.tan(toRad(32));
      for (let i = 0; i <= 6; i++) lights.push(m.frame.at(x0 - 0.5 + ((w + 1) * i) / 6, y0 - 0.55, eave));
      // the sign: a board on the eave over the counter, painted with the goods (drawn in draw)
      board = signBoard(m, x0 + 0.2, x1 - 0.2, y0 - 0.62, eave - 0.04, eave + 0.6);
    }
    // standing tables in front of the counter
    const n = this.tableCount(), tables = [];
    for (let i = 0; i < n; i++) {
      const along = n === 1 ? 0 : (i / (n - 1) - 0.5) * Math.max(w * 0.9, 3 * n - 1.5);
      tables.push(m.frame.xy(along, y0 - 3.6 - (i % 2) * 0.8));
    }
    const geo = m.finish({
      footprint: m.rect(x0 - (loco ? 0.4 : 0.3), y0 - 0.5, x1 + 0.3, y1 + (loco ? 0 : 0.3)),
      height,
      capacity: {},
      detail: { window: 1, fine: 0.04 },
      counter: m.frame.xy(counter[0], counter[1] - 1.1),
      out: m.frame.dir(0, -1),
      tables,
      lights,
      hatch: m.frame.at(hatch[0], hatch[1] - 0.3, hatch[2]),
      loco,
      chimney: loco ? m.frame.at(-w / 2 + 1.2, 0, 3.7) : null,
      board,
      sign,
    });
    const len = Math.hypot(geo.out[0], geo.out[1]) || 1;
    geo.out = [geo.out[0] / len, geo.out[1] / len];
    return geo;
  }

  /** The stall as a steam locomotive (smokebox to the local −x), served from the side of its cab. */
  _locomotive(m, L, sign) {
    const black = grey(0.2), dark = grey(0.3), red = CD.rot, brass = CD.gelb;
    const x0 = -L / 2, x1 = L / 2, cab0 = x1 - 3.1;
    // frame and buffer beam
    const frame = m.box(x0, -1.05, x1, 1.05, 0.45, 0.95, { wall: dark, top: dark });
    const beam = m.box(x0 - 0.25, -1.3, x0, 1.3, 0.45, 1.05, { wall: red, top: red });
    const buffers = [-0.85, 0.85].flatMap((y) => m.box(x0 - 0.65, y - 0.15, x0 - 0.25, y + 0.15, 0.6, 0.9, { wall: black, top: black }).faces);
    // wheels on both sides: red discs
    const wheels = [];
    for (const [x, r] of [[x0 + 1.4, 0.55], [x0 + 3.2, 0.75], [x0 + 5, 0.75]]) {
      for (const side of [-1, 1]) {
        const y = side * 1.08, ring = Array.from({ length: 12 }, (_, i) => [x + r * Math.cos((i * Math.PI) / 6), y, r + r * Math.sin((i * Math.PI) / 6)]);
        wheels.push(m.face(side < 0 ? ring : [...ring].reverse(), red));
      }
    }
    // the boiler: a cylinder along x, with brass bands, the smokebox door in front
    const zc = 1.85, rb = 0.85, seg = 12, boiler = [];
    const P = (x, i) => [x, rb * Math.cos((i * 2 * Math.PI) / seg), zc + rb * Math.sin((i * 2 * Math.PI) / seg)];
    for (let i = 0; i < seg; i++) {
      boiler.push(m.face([P(x0 + 0.2, i), P(x0 + 0.2, i + 1), P(cab0, i + 1), P(cab0, i)].map(([x, y, z]) => [x, y, z]), black));
    }
    // a face's points are counter-clockwise seen from outside: the door looks to −x
    boiler.push(m.face(Array.from({ length: seg }, (_, i) => P(x0 + 0.2, -i)), dark));
    for (const xb of [x0 + 1.6, x0 + 3.6]) {
      for (let i = 0; i < seg; i++) boiler.push(m.face([P(xb, i), P(xb, i + 1), P(xb + 0.12, i + 1), P(xb + 0.12, i)].map(([x, y, z]) => [x, y * 1.02, zc + (z - zc) * 1.02]), brass));
    }
    // chimney and dome
    const chimney = [], cx = x0 + 1.2;
    const C = (r, i, z) => [cx + r * Math.cos((i * Math.PI) / 4), r * Math.sin((i * Math.PI) / 4), z];
    for (let i = 0; i < 8; i++) chimney.push(m.face([C(0.28, i, 2.5), C(0.28, i + 1, 2.5), C(0.34, i + 1, 3.6), C(0.34, i, 3.6)], black));
    chimney.push(m.face(Array.from({ length: 8 }, (_, i) => C(0.34, i, 3.6)), grey(0.1)));
    const dome = m.box(x0 + 3.3, -0.35, x0 + 4.0, 0.35, 2.5, 3.0, { wall: brass, top: brass });
    // the cab: the stall's kitchen, with the serving hatch on its front side
    const cab = m.box(cab0, -1.3, x1, 1.3, 0.95, 3.3, { wall: black });
    const cabRoof = m.box(cab0 - 0.25, -1.5, x1 + 0.25, 1.5, 3.3, 3.5, { wall: dark, top: grey(0.35) });
    const side = cab.walls[0];
    m.window(side, 0.3, 2.8, 1.25, 2.6, { group: "shop", colour: grey(0.32), tier: TIER.coarse });
    m.decal(frame.walls[0], 0.2, L - 0.2, 0.75, 0.85, red, TIER.fine);
    m.part([...frame.faces, ...beam.faces, ...buffers]);
    m.part(wheels, { after: true });
    m.part([...boiler, ...chimney, ...dome.faces], { ref: [x0 + 3, 0] });
    m.part([...cab.faces, ...cabRoof.faces], { ref: [x1 - 1.5, 0] });
    m.part(m.box(cab0 + 0.2, -1.75, x1 - 0.2, -1.3, 1.15, 1.25, { wall: grey(0.8), top: grey(0.86) }).faces, { after: true, facing: side });
    m.shadow(m.rect(x0 - 0.6, -1.5, x1 + 0.3, 1.5), 3.5);
    const lights = [];
    for (let i = 0; i <= 6; i++) lights.push(m.frame.at(cab0 - 0.25 + (3.6 * i) / 6, -1.55, 3.3));
    for (let i = 0; i <= 4; i++) lights.push(m.frame.at(x0 + 0.3 + i * 1.2, -0.9, 2.55));
    // the sign on the cab, over the hatch
    const board = signBoard(m, cab0 + 0.15, x1 - 0.15, -1.34, 2.68, 3.24);
    return { counter: [x1 - 1.55, -1.75], lights, height: 3.6, hatch: [x1 - 1.55, -1.3, 1.9], board };
  }

  /** What the market simulation needs: the goods, where people queue and stand. */
  marketInfo() {
    const g = this.geometry;
    if (!g) return null;
    return { kind: "stall", goods: this.spec.goods in MARKET_GOODS ? this.spec.goods : "gluehwein", counter: g.counter, out: g.out, tables: g.tables };
  }

  /** The stall's lights burn while the market is open. */
  litShare(darkness) {
    const on = clamp((darkness - 0.1) / 0.2, 0, 1);
    const open = marketOpen(this.world) ? 1 : 0;
    return { main: 0, shop: on * open };
  }

  card() {
    const card = super.card();
    const goods = this.goods();
    // an unnamed stall is called by its goods
    if (!this.spec.name) card.title = goods.name;
    card.subtitle = this.spec.name ? `Market stall · ${goods.name}` : "Market stall";
    card.rows = card.rows.filter(([k]) => !["Floors", "Occupancy", "Holds"].includes(k));
    card.rows.push(["Sells", goods.name], ["Kind", GOODS_KINDS[goods.kind]?.label ?? goods.kind], ["Price", `${goods.price.toFixed(2)} €`]);
    if (this.spec.style === "locomotive") card.rows.push(["Built like", "a steam locomotive"]);
    const n = this.tableCount();
    if (n) card.rows.push(["Standing tables", String(n)]);
    return card;
  }

  draw(view) {
    super.draw(view);
    const g = this.geometry;
    const open = marketOpen(this.world);
    for (const t of g.tables) drawTable(view, t, this.mm(1));
    if (g.loco && open) drawSteam(view, g.chimney, this.mm(1), hashKey(this.id) % 100);
    if (view.darkness > 0.05 && open) {
      for (const p of g.lights) view.glow(p, this.mm(0.45), WARM, 0.9);
      view.lightPool(g.counter, this.mm(3.2), WARM, 0.8);
      if (this.goods().hot) view.glow(g.hatch, this.mm(1.1), CD.orange, 0.8);
    }
    paintSign(view, g.board, this.goods().name, { fill: g.sign, lit: open, depth: view.depth(g.center[0], g.center[1], 0) - 1 });
  }
}

/**
 * A sign board in a model: a vertical board along local x from x0 to x1 at y, from z0 to z1 (m),
 * facing −y (its back, wood, is a face of the model). Returns its corners in layout mm, front
 * view from the left bottom counter-clockwise, for {@link paintSign}.
 */
function signBoard(m, x0, x1, y, z0, z1) {
  m.part([m.face([[x1, y + 0.03, z0], [x0, y + 0.03, z0], [x0, y + 0.03, z1], [x1, y + 0.03, z1]], grey(0.45))], { after: true });
  return { corners: [m.frame.at(x0, y, z0), m.frame.at(x1, y, z0), m.frame.at(x1, y, z1), m.frame.at(x0, y, z1)], width: x1 - x0, height: z1 - z0 };
}

/**
 * Paint a sign: the board in its colour with the text on it, in perspective, while its front faces
 * the camera (by night lit while `lit`). Close up only: below 4 px the board is a coloured patch.
 * @param {{corners: number[][], width: number, height: number}} board corners [left bottom, right bottom, right top, left top] (mm), size (m)
 */
export function paintSign(view, board, text, { fill = CD.dunkelblau, ink = "#ffffff", lit = false, depth = null, twoSided = false } = {}) {
  if (!board || view.simple) return;
  let [a, b, c, d] = board.corners;
  const n = polygonNormal([a, b, c, d]);
  const cam = view.cam(a[0], a[1], a[2]), nc = view.normalToCamera(n);
  if (nc[0] * cam[0] + nc[1] * cam[1] + nc[2] * cam[2] >= 0) {
    if (!twoSided) return;
    [a, b, c, d] = [b, a, d, c]; // seen from behind: the other side, painted the same
  }
  const P = [a, b, c, d].map((p) => view.project(p[0], p[1], p[2]));
  if (P.some((p) => !p) || view.offImage(P)) return;
  const W = board.width * 100, H = board.height * 100; // the board in cm
  const tall = Math.hypot(P[3][0] - P[0][0], P[3][1] - P[0][1]);
  const glow = lit && view.darkness > 0.05;
  const board2d = (ctx) => {
    // left top as the origin, x along the board, y down it
    ctx.transform((P[2][0] - P[3][0]) / W, (P[2][1] - P[3][1]) / W, (P[0][0] - P[3][0]) / H, (P[0][1] - P[3][1]) / H, P[3][0], P[3][1]);
    ctx.fillStyle = glow ? fill : view.dim(fill);
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = view.dim("#4a3a28");
    ctx.lineWidth = Math.min(W, H) * 0.06;
    ctx.strokeRect(0, 0, W, H);
    if (tall < 4 * view.px) return;
    let size = H * 0.62;
    ctx.font = `700 ${size}px ${FONT}`;
    const w = ctx.measureText(text).width || 1;
    if (w > W * 0.9) {
      size *= (W * 0.9) / w;
      ctx.font = `700 ${size}px ${FONT}`;
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = glow ? ink : view.dim(ink, 0.6);
    ctx.fillText(text, W / 2, H / 2 + size * 0.05);
  };
  const m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
  view.solid(depth ?? view.depth(m[0], m[1], m[2]) - 1, board2d);
  if (glow) view.glow(m, Math.hypot(c[0] - a[0], c[1] - a[1]) * 0.45, fill, 0.35);
}

/** A standing table (Stehtisch) at a layout point. */
function drawTable(view, p, k) {
  view.prism(circle(p, 0.05 * k, 6), 0, 1.05 * k, { side: grey(0.4), top: grey(0.4) });
  view.prism(circle(p, 0.38 * k, 10), 1.05 * k, 1.1 * k, { side: grey(0.55), top: grey(0.78) });
}

/** Puffs of steam over a chimney (animated by the view's time). */
function drawSteam(view, top, k, seed) {
  if (view.simple) return;
  for (let i = 0; i < 4; i++) {
    const f = ((view.time * 0.35 + i / 4 + seed / 100) % 1);
    const p = [top[0] + f * 1.2 * k, top[1] + f * 0.4 * k, top[2] + f * 3 * k];
    const q = view.project(p[0], p[1], p[2]);
    if (!q) continue;
    const r = Math.max(1.5 * view.px, view.pxPerMM(p[0], p[1], p[2]) * (0.35 + f * 0.9) * k);
    const a = 0.55 * (1 - f);
    const puff = (ctx) => {
      ctx.globalAlpha *= a;
      ctx.fillStyle = view.dim("#f4f4f4", 0.5);
      ctx.beginPath();
      ctx.arc(q[0], q[1], r, 0, 2 * Math.PI);
      ctx.fill();
    };
    puff.plain = true;
    view.solid(view.depth(p[0], p[1], p[2]) - 1, puff);
  }
}

/* ================================================================== the tree */

const BAUBLES = [CD.rot, CD.gelb, grey(0.88), CD.rot, "#c9a227"];

export class ChristmasTree extends LayoutObject {
  static type = "christmas-tree";
  static label = "Christmas tree";
  static category = "Market";
  static placement = "point";
  static description = "A big decorated Christmas tree: baubles, lights at night and a star on top.";
  static params = [
    NAME,
    { key: "height_m", label: "Height", type: "number", unit: "m", min: 4, max: 35, step: 1, default: 20 },
    { key: "lights", label: "Fairy lights", type: "boolean", default: true },
    { key: "seed", label: "Random seed", type: "number", min: 1, max: 9999, step: 1, default: 1 },
  ];

  computeGeometry() {
    const c = resolvePoint(this.world.map, this.spec.position);
    if (!c) return null;
    const k = this.mm(1), H = num(this.spec.height_m, 20, 4, 35), R = H * 0.3, base = 0.6, tiers = 5, n = 14;
    const faces = [], rng = createRng(hashKey(this.id, this.spec.seed ?? 1));
    // the podium
    faces.push(...cylinderFaces(c, (R + 1) * k, 0, base * k, 16, grey(0.62), grey(0.7)));
    faces.push(...cylinderFaces(c, 0.35 * k, base * k, (base + 1.5) * k, 6, PALETTE.trunk));
    const decorations = [], lights = [];
    const trunk = base + 1.2, crown = H - trunk - 0.6;
    for (let t = 0; t < tiers; t++) {
      const z0 = trunk + (t * crown) / tiers * 0.92, z1 = Math.min(H - 0.6, z0 + (crown / tiers) * 1.9);
      const r = R * (1 - (t / tiers) * 0.82), colour = shade(PALETTE.conifer, t % 2 ? 1.12 : 0.95);
      const ring = circle(c, r * k, n, t * 0.2), apex = [c[0], c[1], z1 * k];
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        faces.push(face([[a[0], a[1], z0 * k], [b[0], b[1], z0 * k], apex], colour, { twoSided: false }));
      }
      faces.push(face([...ring].reverse().map(([x, y]) => [x, y, z0 * k]), shade(colour, 0.7), { twoSided: false }));
      // baubles and lights on the tier's cone
      for (let j = 0; j < 7 + (tiers - t) * 2; j++) {
        const a = rng.uniform(0, 2 * Math.PI), f = rng.uniform(0.05, 0.6);
        const rr = r * (1 - f) + 0.15, z = z0 + (z1 - z0) * f;
        const p = [c[0] + Math.cos(a) * rr * k, c[1] + Math.sin(a) * rr * k, z * k], nrm = [Math.cos(a), Math.sin(a), 0.4];
        if (j % 2) decorations.push({ p, n: nrm, colour: rng.pick(BAUBLES), r: rng.uniform(0.18, 0.3) * k });
        else lights.push({ p, n: nrm, phase: rng.uniform(0, 2 * Math.PI) });
      }
    }
    return { center: c, faces, decorations, lights, top: [c[0], c[1], (H - 0.1) * k], height: H * k, radius: (R + 1) * k };
  }

  footprint() {
    const g = this.geometry;
    return g ? circle(g.center, g.radius, 16) : null;
  }

  standsOn() {
    const g = this.geometry;
    return g ? [g.center] : null;
  }

  pickHeight() {
    return this.geometry?.height ?? 0;
  }

  /** People stop and look at the tree (the market simulation). */
  marketInfo() {
    const g = this.geometry;
    return g ? { kind: "sight", at: g.center, radius: g.radius } : null;
  }

  draw(view) {
    const g = this.geometry;
    view.faces(g.faces, [g.center[0], g.center[1], 0]);
    if (view.simple) return;
    const lit = this.spec.lights !== false, night = view.darkness;
    const visible = (d) => {
      const cam = view.cam(d.p[0], d.p[1], d.p[2]), nc = view.normalToCamera(d.n);
      return nc[0] * cam[0] + nc[1] * cam[1] + nc[2] * cam[2] < 0;
    };
    const dots = [];
    for (const d of g.decorations) {
      if (!visible(d)) continue;
      const q = view.project(d.p[0], d.p[1], d.p[2]);
      if (q) dots.push([q, Math.max(1.2 * view.px, view.pxPerMM(d.p[0], d.p[1], d.p[2]) * d.r), view.dim(d.colour, 0.55)]);
    }
    if (lit && night > 0.05) {
      for (const d of g.lights) {
        if (!visible(d)) continue;
        const q = view.project(d.p[0], d.p[1], d.p[2]);
        const tw = 0.65 + 0.35 * Math.sin(view.time * 2 + d.phase);
        if (q) dots.push([q, Math.max(1 * view.px, view.pxPerMM(d.p[0], d.p[1], d.p[2]) * this.mm(0.13)), `rgba(255,236,170,${(night * tw).toFixed(3)})`]);
      }
    }
    const top = view.project(g.top[0], g.top[1], g.top[2]);
    const s = top ? Math.max(3 * view.px, view.pxPerMM(g.top[0], g.top[1], g.top[2]) * this.mm(0.9)) : 0;
    const deco = (ctx) => {
      for (const [q, r, colour] of dots) {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(q[0], q[1], r, 0, 2 * Math.PI);
        ctx.fill();
      }
      if (top) {
        // the star: five points, upright on the picture
        ctx.fillStyle = night > 0.05 && lit ? "#ffe27a" : view.dim(CD.gelb, 0.4);
        ctx.strokeStyle = view.dim("#8a6a00", 0.5);
        ctx.lineWidth = 0.8 * view.px;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? s * 0.45 : s;
          ctx[i ? "lineTo" : "moveTo"](top[0] + r * Math.cos(a), top[1] - s * 0.6 + r * Math.sin(a));
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    };
    deco.plain = true;
    view.solid(view.depth(g.center[0], g.center[1], 0) - 0.5, deco);
    if (lit) {
      view.glow(g.top, this.mm(2.5), "#ffe27a", 1);
      view.glow([g.center[0], g.center[1], g.height * 0.4], g.radius * 1.1, WARM, 0.35);
      view.lightPool(g.center, g.radius * 1.8, WARM, 0.6);
    }
  }
}

/* ================================================================== the gate */

export class MarketGate extends LayoutObject {
  static type = "market-gate";
  static label = "Market gate";
  static category = "Market";
  static placement = "point";
  static description = "An arch over an entrance of the market with its name on a board, a fir garland and lights; people walk through it.";
  static params = [
    NAME,
    ROTATION,
    { key: "text", label: "Text", type: "text", default: "Striezelmarkt" },
    { key: "width_m", label: "Width", type: "number", unit: "m", min: 2, max: 15, step: 0.5, default: 5 },
    { key: "height_m", label: "Height", type: "number", unit: "m", min: 3, max: 10, step: 0.5, default: 5 },
  ];

  computeGeometry() {
    const c = resolvePoint(this.world.map, this.spec.position);
    if (!c) return null;
    const a = toRad(+this.spec.rotation_deg || 0), k = this.mm(1);
    const W = num(this.spec.width_m, 5, 2, 15), H = num(this.spec.height_m, 5, 3, 10);
    const u = [Math.cos(a), Math.sin(a)];
    const at = (x, y, z = 0) => [c[0] + (u[0] * x - u[1] * y) * k, c[1] + (u[1] * x + u[0] * y) * k, z * k];
    const faces = [];
    for (const x of [-W / 2, W / 2]) faces.push(...boxFaces(at(x, 0).slice(0, 2), u, 0.3 * k, 0.3 * k, 0, H * k, "#6b4a2f"));
    faces.push(...boxFaces(at(0, 0).slice(0, 2), u, (W + 0.5) * k, 0.35 * k, (H - 0.15) * k, (H + 0.05) * k, "#6b4a2f"));
    // the fir garland along the beam
    faces.push(...boxFaces(at(0, -0.05).slice(0, 2), u, (W + 0.2) * k, 0.5 * k, (H - 0.45) * k, (H - 0.15) * k, PALETTE.conifer));
    const board = { corners: [at(-W * 0.4, -0.2, H + 0.05), at(W * 0.4, -0.2, H + 0.05), at(W * 0.4, -0.2, H + 1.05), at(-W * 0.4, -0.2, H + 1.05)], width: W * 0.8, height: 1 };
    const back = board.corners.map((p) => p.slice());
    faces.push(face(back, grey(0.45)));
    const lights = Array.from({ length: 9 }, (_, i) => at(-W / 2 + (W * i) / 8, -0.3, H - 0.4));
    const fp = [at(-W / 2 - 0.3, -0.4), at(W / 2 + 0.3, -0.4), at(W / 2 + 0.3, 0.4), at(-W / 2 - 0.3, 0.4)].map((p) => p.slice(0, 2));
    return { center: c, faces, board, lights, footprint: fp, height: (H + 1.1) * k };
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  pickHeight() {
    return this.geometry?.height ?? 0;
  }

  draw(view) {
    const g = this.geometry;
    view.faces(g.faces, [g.center[0], g.center[1], 0], { outline: "rgba(40,30,20,0.3)" });
    paintSign(view, g.board, this.spec.text || "", { fill: CD.rot, lit: true, twoSided: true, depth: view.depth(g.center[0], g.center[1], 0) - 1 });
    if (view.darkness > 0.05) for (const p of g.lights) view.glow(p, this.mm(0.4), WARM, 0.9);
  }
}

/* ================================================================== rides */

/**
 * A ride: it boards for `board_s`, then runs for `ride_s` (simulated seconds), and again. It
 * waits for riders while it boards (at most twice `board_s`, so that it moves without any). The
 * market simulation puts its visitors on it (`board`) and takes them off when a run has ended
 * (`takeAlighted`).
 */
export class Ride extends LayoutObject {
  static category = "Market";
  static placement = "point";

  /** Places for riders. */
  places() {
    return 12;
  }

  /** Seconds a run takes. */
  runSeconds() {
    return num(this.spec.ride_s, 150, 20, 900);
  }

  /** The state of the ride: {phase: "boarding" | "running", t, riders, alighted, runs, carried}. */
  get ride() {
    return (this._ride ||= { phase: "boarding", t: 0, riders: [], alighted: [], runs: 0, carried: 0 });
  }

  /** Can somebody get on now? */
  canBoard() {
    const r = this.ride;
    return r.phase === "boarding" && r.riders.length < this.places() && r.t < num(this.spec.board_s, 60, 10, 600) - 3;
  }

  /** Put a rider on (an agent of the simulation; `colour` for drawing). False when it cannot. */
  board(agent) {
    if (!this.canBoard()) return false;
    this.ride.riders.push(agent);
    return true;
  }

  /** The riders of the run that ended (each once). */
  takeAlighted() {
    const out = this.ride.alighted;
    this.ride.alighted = [];
    return out;
  }

  /** Take riders off without a run (the simulation was cleared). */
  clearRiders(which = () => true) {
    const r = this.ride;
    r.riders = r.riders.filter((a) => !which(a));
    r.alighted = r.alighted.filter((a) => !which(a));
  }

  /** Seconds until the ride moves on to its next phase (about). */
  secondsLeft() {
    const r = this.ride, board = num(this.spec.board_s, 60, 10, 600);
    return Math.max(0, (r.phase === "boarding" ? board : this.runSeconds()) - r.t);
  }

  update(dt) {
    const r = this.ride, board = num(this.spec.board_s, 60, 10, 600);
    r.t += dt;
    if (r.phase === "boarding") {
      if ((r.t >= board && r.riders.length) || r.t >= 2 * board) {
        r.phase = "running";
        r.t = 0;
      }
    } else {
      this.animate(dt);
      if (r.t >= this.runSeconds()) {
        r.phase = "boarding";
        r.t = 0;
        r.runs++;
        r.carried += r.riders.length;
        r.alighted.push(...r.riders);
        r.riders = [];
        this.stopped();
      }
    }
  }

  /** Move the ride while it runs (subclasses). */
  animate(dt) {}

  /** The run has ended (subclasses put the ride back to where it boards). */
  stopped() {}

  pickHeight() {
    return this.mm(4);
  }

  card() {
    const card = super.card(), r = this.ride;
    card.status = r.phase === "boarding" ? `Boarding: ${r.riders.length} of ${this.places()} places taken` : `Running: ${Math.ceil(this.secondsLeft())} s to go`;
    card.rows.push(["Places", String(this.places())], ["A run", `${Math.round(this.runSeconds())} s`], ["Runs", String(r.runs)], ["Riders so far", String(r.carried)]);
    return card;
  }

  /** The colour of a rider: the coat of a market visitor, else the agent's colour, else one of the CD's. */
  static riderColour(agent, i) {
    return agent?.coat || agent?.colour || [CD.rot, CD.tuerkis, CD.gelb, CD.brillantblau][i % 4];
  }
}

const RIDE_PARAMS = (board, ride) => [
  { key: "board_s", label: "Boarding", type: "number", unit: "s", min: 10, max: 600, step: 5, default: board },
  { key: "ride_s", label: "A run", type: "number", unit: "s", min: 20, max: 900, step: 10, default: ride },
];

export class FerrisWheel extends Ride {
  static type = "ferris-wheel";
  static label = "Ferris wheel";
  static description = "A ferris wheel (Riesenrad) with gondolas and lights; turns while it runs and stands while people get in.";
  static params = [
    NAME,
    ROTATION,
    { key: "diameter_m", label: "Diameter", type: "number", unit: "m", min: 10, max: 60, step: 1, default: 24 },
    { key: "gondolas", label: "Gondolas", type: "number", min: 6, max: 40, step: 1, default: 16 },
    { key: "rpm", label: "Speed", type: "number", unit: "rpm", min: 0.2, max: 4, step: 0.1, default: 1 },
    ...RIDE_PARAMS(60, 180),
  ];

  places() {
    return Math.round(num(this.spec.gondolas, 16, 6, 40)) * 4;
  }

  computeGeometry() {
    const c = resolvePoint(this.world.map, this.spec.position);
    if (!c) return null;
    const a = toRad(+this.spec.rotation_deg || 0), D = num(this.spec.diameter_m, 24, 10, 60), k = this.mm(1);
    const u = [Math.cos(a), Math.sin(a)], v = [-u[1], u[0]];
    const at = (x, y, z = 0) => [c[0] + (u[0] * x + v[0] * y) * k, c[1] + (u[1] * x + v[1] * y) * k, z * k];
    const R = D / 2, hub = R + 2.6, half = D * 0.32 + 3;
    const fp = [[-half, -5], [half, -5], [half, 4], [-half, 4]].map(([x, y]) => at(x, y).slice(0, 2));
    return { center: c, u, v, at, R, hub, footprint: fp, gate: at(0, -6.2).slice(0, 2), out: [-v[0], -v[1]] };
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  pickHeight() {
    const g = this.geometry;
    return g ? this.mm(g.hub + g.R) : 0;
  }

  marketInfo() {
    const g = this.geometry;
    return g ? { kind: "ride", ride: "ferris-wheel", gate: g.gate, out: g.out, kids: false } : null;
  }

  animate(dt) {
    this.angle = ((this.angle || 0) + dt * (num(this.spec.rpm, 1, 0.2, 4) / 60) * 2 * Math.PI) % (2 * Math.PI);
  }

  stopped() {
    // stand with a gondola at the bottom
    const n = Math.round(num(this.spec.gondolas, 16, 6, 40)), step = (2 * Math.PI) / n;
    this.angle = Math.round((this.angle || 0) / step) * step;
  }

  draw(view) {
    const g = this.geometry, { at, R, hub } = g, k = this.mm(1);
    const steel = grey(0.82), dark = grey(0.45);
    const faces = [];
    // the platform where people get in, and the ticket box
    const half = R * 0.64 + 3;
    faces.push(face([at(-half, -4.6, 0.6), at(half, -4.6, 0.6), at(half, 3.6, 0.6), at(-half, 3.6, 0.6)], grey(0.7), { twoSided: false }));
    faces.push(face([at(-half, -4.6, 0), at(half, -4.6, 0), at(half, -4.6, 0.6), at(-half, -4.6, 0.6)], grey(0.55), { twoSided: false }));
    faces.push(...boxFaces(at(-3.5, -4.2).slice(0, 2), g.u, 2.2 * k, 1.6 * k, 0.6 * k, 3 * k, grey(0.85), CD.rot));
    // two A-frames, a leg from each foot to the hub
    const beam = (p, q, w, colour) => {
      // as wide as `w` along the wheel: the flat side faces the front and the back
      const flat = [g.u[0] * w * k * 0.5, g.u[1] * w * k * 0.5];
      faces.push(face([[p[0] - flat[0], p[1] - flat[1], p[2]], [p[0] + flat[0], p[1] + flat[1], p[2]], [q[0] + flat[0], q[1] + flat[1], q[2]], [q[0] - flat[0], q[1] - flat[1], q[2]]], colour));
    };
    for (const y of [-1.6, 1.6]) {
      const top = at(0, y * 0.9, hub);
      beam(at(-R * 0.6, y * 2, 0.6), top, 0.5, dark);
      beam(at(R * 0.6, y * 2, 0.6), top, 0.5, dark);
    }
    // the wheel: two rims with spokes, in planes along the wheel
    const n = Math.round(num(this.spec.gondolas, 16, 6, 40)), turn = this.angle || 0, segs = Math.max(32, n * 2);
    const W = (y, r, t, z = 0) => at(r * Math.cos(t), y, hub + r * Math.sin(t) + z);
    for (const y of [-1.2, 1.2]) {
      for (let i = 0; i < segs; i++) {
        const t0 = turn + (i * 2 * Math.PI) / segs, t1 = turn + ((i + 1) * 2 * Math.PI) / segs;
        faces.push(face([W(y, R - 0.35, t0), W(y, R, t0), W(y, R, t1), W(y, R - 0.35, t1)], steel));
      }
      for (let i = 0; i < n; i++) {
        const t = turn + (i * 2 * Math.PI) / n, e = 0.06;
        faces.push(face([W(y, 0.4, t - e * 4), W(y, R - 0.3, t - e * 0.2), W(y, R - 0.3, t + e * 0.2), W(y, 0.4, t + e * 4)], steel));
      }
    }
    faces.push(...boxFaces(at(0, 0).slice(0, 2), g.v, 3.2 * k, 1.2 * k, (hub - 0.6) * k, (hub + 0.6) * k, dark));
    // gondolas hang upright below the rim; riders sit in them
    const riders = this.ride.riders, colours = [CD.rot, CD.gelb, CD.tuerkis, CD.orange];
    for (let i = 0; i < n; i++) {
      const t = turn - Math.PI / 2 + (i * 2 * Math.PI) / n;
      const pivot = W(0, R, t), base = [pivot[0], pivot[1]], z1 = pivot[2] - 0.4 * k, z0 = z1 - 1.9 * k;
      faces.push(...boxFaces(base, g.u, 1.7 * k, 1.9 * k, z0, z0 + 0.95 * k, colours[i % 4], grey(0.9)));
      faces.push(...boxFaces(base, g.u, 1.9 * k, 2.1 * k, z1 - 0.15 * k, z1, grey(0.92)));
      const inside = riders.slice(i * 4, i * 4 + 4);
      inside.forEach((r, j) => {
        const off = [(j % 2 ? 0.4 : -0.4) * k, (j < 2 ? 0.45 : -0.45) * k];
        const p = [base[0] + g.u[0] * off[0] + g.v[0] * off[1], base[1] + g.u[1] * off[0] + g.v[1] * off[1]];
        faces.push(...boxFaces(p, g.u, 0.32 * k, 0.32 * k, z0 + 0.95 * k, z0 + 1.35 * k, Ride.riderColour(r, j)));
      });
    }
    // lights along the rim at night
    if (view.darkness > 0.05) {
      for (let i = 0; i < segs; i += 2) {
        const t0 = turn + (i * 2 * Math.PI) / segs, t1 = t0 + 0.6 * ((2 * Math.PI) / segs);
        const on = Math.floor(view.time * 2 + i / 2) % 3 === 0 ? CD.gelb : "#fff1c8";
        faces.push(face([W(-1.35, R + 0.05, t0), W(-1.35, R + 0.3, t0), W(-1.35, R + 0.3, t1), W(-1.35, R + 0.05, t1)], on, { emissive: true }));
      }
      view.glow(at(0, 0, hub), R * k * 0.9, WARM, 0.25);
      view.lightPool(g.gate, this.mm(5), WARM, 0.7);
    }
    view.faces(faces, at(0, 0, 0.6), { outline: "rgba(60,60,60,0.25)" });
  }
}

export class Carousel extends Ride {
  static type = "carousel";
  static label = "Carousel";
  static category = "Market";
  static description = "A carousel (Kinderkarussell) with horses under a striped canopy; turns while it runs.";
  static params = [
    NAME,
    ROTATION,
    { key: "diameter_m", label: "Diameter", type: "number", unit: "m", min: 5, max: 20, step: 0.5, default: 10 },
    { key: "seats", label: "Horses", type: "number", min: 6, max: 40, step: 1, default: 16 },
    { key: "rpm", label: "Speed", type: "number", unit: "rpm", min: 1, max: 10, step: 0.5, default: 4 },
    ...RIDE_PARAMS(45, 150),
  ];

  places() {
    return Math.round(num(this.spec.seats, 16, 6, 40));
  }

  computeGeometry() {
    const c = resolvePoint(this.world.map, this.spec.position);
    if (!c) return null;
    const a = toRad(+this.spec.rotation_deg || 0), R = num(this.spec.diameter_m, 10, 5, 20) / 2, k = this.mm(1);
    const out = [Math.sin(a), -Math.cos(a)];
    return { center: c, R, footprint: circle(c, (R + 0.6) * k, 20), gate: [c[0] + out[0] * (R + 1.6) * k, c[1] + out[1] * (R + 1.6) * k], out };
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  marketInfo() {
    const g = this.geometry;
    return g ? { kind: "ride", ride: "carousel", gate: g.gate, out: g.out, kids: true } : null;
  }

  animate(dt) {
    this.angle = ((this.angle || 0) + dt * (num(this.spec.rpm, 4, 1, 10) / 60) * 2 * Math.PI) % (2 * Math.PI);
  }

  draw(view) {
    const g = this.geometry, c = g.center, R = g.R, k = this.mm(1), turn = this.angle || 0, n = 16;
    const faces = [...cylinderFaces(c, R * k, 0, 0.45 * k, 20, grey(0.6), grey(0.78))];
    faces.push(...cylinderFaces(c, 0.9 * k, 0.45 * k, 3.4 * k, 10, grey(0.9), grey(0.9)));
    // horses on two rings, going up and down, on brass poles
    const seats = this.places(), riders = this.ride.riders, running = this.ride.phase === "running";
    for (let i = 0; i < seats; i++) {
      const outer = i % 2 === 0, r = (outer ? 0.78 : 0.52) * R, t = turn + (i * 2 * Math.PI) / seats;
      const p = [c[0] + r * Math.cos(t) * k, c[1] + r * Math.sin(t) * k], dir = [-Math.sin(t), Math.cos(t)];
      const bob = running ? 0.25 * Math.sin(turn * 3 + i) : 0, z = (1.05 + bob) * k;
      faces.push(...boxFaces(p, dir, 0.08 * k, 0.08 * k, 0.45 * k, 3.4 * k, CD.gelb));
      faces.push(...boxFaces(p, dir, 1.3 * k, 0.35 * k, z, z + 0.55 * k, grey(0.96)));
      faces.push(...boxFaces([p[0] + dir[0] * 0.55 * k, p[1] + dir[1] * 0.55 * k], dir, 0.35 * k, 0.3 * k, z + 0.5 * k, z + 0.95 * k, grey(0.96)));
      if (riders[i]) faces.push(...boxFaces(p, dir, 0.38 * k, 0.32 * k, z + 0.55 * k, z + 1.25 * k, Ride.riderColour(riders[i], i)));
    }
    // the striped canopy and its valance
    const ring = circle(c, (R + 0.3) * k, n, turn * 0.0), apex = [c[0], c[1], 5.4 * k];
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n], colour = i % 2 ? CD.rot : grey(0.97);
      faces.push(face([[a[0], a[1], 3.4 * k], [b[0], b[1], 3.4 * k], apex], colour));
      faces.push(face([[a[0], a[1], 2.9 * k], [b[0], b[1], 2.9 * k], [b[0], b[1], 3.4 * k], [a[0], a[1], 3.4 * k]], i % 2 ? grey(0.97) : CD.rot));
    }
    faces.push(...cylinderFaces(c, 0.12 * k, 5.4 * k, 6.2 * k, 6, CD.gelb));
    if (view.darkness > 0.05) {
      for (let i = 0; i < n * 2; i++) {
        const t = (i * Math.PI) / n, p = [c[0] + (R + 0.32) * Math.cos(t) * k, c[1] + (R + 0.32) * Math.sin(t) * k];
        faces.push(...boxFaces(p, [-Math.sin(t), Math.cos(t)], 0.25 * k, 0.05 * k, 2.95 * k, 3.15 * k, "#ffe9a8").map((f) => ({ ...f, emissive: true })));
      }
      view.lightPool(c, (R + 3) * k, WARM, 0.8);
      view.glow([c[0], c[1], 3 * k], R * k, WARM, 0.3);
    }
    view.faces(faces, [c[0], c[1], 0], { outline: "rgba(60,60,60,0.22)" });
  }
}

export class MiniTrain extends Ride {
  static type = "mini-train";
  static label = "Mini train";
  static category = "Market";
  static description = "A mini train for children (Kindereisenbahn): a small steam locomotive with open cars on an oval track, with a station where the children get in.";
  static params = [
    NAME,
    ROTATION,
    { key: "length_m", label: "Length", type: "number", unit: "m", min: 8, max: 40, step: 1, default: 16 },
    { key: "width_m", label: "Width", type: "number", unit: "m", min: 4, max: 20, step: 0.5, default: 7 },
    { key: "cars", label: "Wagons", type: "number", min: 1, max: 6, step: 1, default: 3 },
    { key: "speed_kmh", label: "Speed", type: "number", unit: "km/h", min: 2, max: 15, step: 0.5, default: 6 },
    ...RIDE_PARAMS(45, 150),
  ];

  places() {
    return Math.round(num(this.spec.cars, 3, 1, 6)) * 4;
  }

  computeGeometry() {
    const c = resolvePoint(this.world.map, this.spec.position);
    if (!c) return null;
    const a = toRad(+this.spec.rotation_deg || 0), L = num(this.spec.length_m, 16, 8, 40), W = Math.min(num(this.spec.width_m, 7, 4, 20), L), k = this.mm(1);
    const u = [Math.cos(a), Math.sin(a)], v = [-u[1], u[0]];
    const at = (x, y) => [c[0] + (u[0] * x + v[0] * y) * k, c[1] + (u[1] * x + v[1] * y) * k];
    // the oval: the front straight (−y) first, from left to right, then round
    const r = W / 2, s = (L - W) / 2, path = [];
    path.push([-s, -r], [s, -r]);
    for (let i = 1; i <= 12; i++) path.push([s + r * Math.sin((i * Math.PI) / 12), -r * Math.cos((i * Math.PI) / 12)]);
    path.push([-s, r]);
    for (let i = 1; i <= 12; i++) path.push([-s - r * Math.sin((i * Math.PI) / 12), r * Math.cos((i * Math.PI) / 12)]);
    const points = path.map(([x, y]) => at(x, y)), lengths = polylineLengths(points);
    const outline = [];
    for (const [x, y] of path) {
      const l = Math.hypot(x, y) || 1;
      outline.push(at(x + (x / l) * 1.2, y + (y / l) * 1.2));
    }
    return { center: c, u, v, at, r, points, lengths, length: lengths[lengths.length - 1], footprint: outline, gate: at(0, -r - 3), out: [-v[0], -v[1]] };
  }

  footprint() {
    return this.geometry?.footprint || null;
  }

  marketInfo() {
    const g = this.geometry;
    return g ? { kind: "ride", ride: "mini-train", gate: g.gate, out: g.out, kids: true } : null;
  }

  runSeconds() {
    const g = this.geometry, v = num(this.spec.speed_kmh, 6, 2, 15) / 3.6;
    if (!g) return super.runSeconds();
    // whole laps, about as long as `ride_s`
    const lap = this.meters(g.length) / v;
    return Math.max(1, Math.round(super.runSeconds() / lap)) * lap;
  }

  animate(dt) {
    const g = this.geometry;
    if (!g) return;
    this.s = ((this.s || 0) + this.mm(dt * (num(this.spec.speed_kmh, 6, 2, 15) / 3.6))) % g.length;
  }

  stopped() {
    this.s = 0;
  }

  draw(view) {
    const g = this.geometry, k = this.mm(1);
    // the track: two rails round the oval
    const off = (d) => g.points.map((p, i) => {
      const a = g.points[Math.max(0, i - 1)], b = g.points[Math.min(g.points.length - 1, i + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [p[0] - ((b[1] - a[1]) / l) * d * k, p[1] + ((b[0] - a[0]) / l) * d * k];
    });
    // the path runs counter-clockwise: + is inside, − outside
    view.polygon(off(-0.7), { fill: PALETTE.ballast, alpha: 0.6, order: 1.2, snow: 1 });
    view.polygon(off(0.7), { fill: "#bdb4a5", alpha: 0.95, order: 1.25, snow: 1 });
    for (const d of [0.3, -0.3]) view.line([...off(d), off(d)[0]], { stroke: PALETTE.rail, width: 1.2, order: 1.3 });
    // the station: a platform with a roof
    const faces = [];
    const st = g.at(0, -g.r - 1.4);
    faces.push(...boxFaces(st, g.u, 5 * k, 1.6 * k, 0, 0.3 * k, grey(0.72)));
    for (const x of [-2.2, 2.2]) faces.push(...boxFaces([st[0] + g.u[0] * x * k, st[1] + g.u[1] * x * k], g.u, 0.12 * k, 0.12 * k, 0.3 * k, 2.6 * k, grey(0.5)));
    faces.push(...boxFaces(st, g.u, 5.4 * k, 2.2 * k, 2.6 * k, 2.8 * k, grey(0.9), CD.rot));
    // the train: loco ahead, cars behind
    const cars = Math.round(num(this.spec.cars, 3, 1, 6)), riders = this.ride.riders;
    const head = (this.s || 0) + this.mm(cars * 2.1 + 2);
    const along = (s) => {
      const q = ((s % g.length) + g.length) % g.length;
      const { point, dir } = polylineAt(g.points, q, g.lengths);
      return { p: point, d: dir };
    };
    const loco = along(head - this.mm(1.1));
    faces.push(...boxFaces(loco.p, loco.d, 2 * k, 1 * k, 0.25 * k, 0.75 * k, CD.rot));
    const front = [loco.p[0] + loco.d[0] * 0.35 * k, loco.p[1] + loco.d[1] * 0.35 * k];
    faces.push(...boxFaces(front, loco.d, 1.2 * k, 0.8 * k, 0.75 * k, 1.3 * k, grey(0.2)));
    const chim = [loco.p[0] + loco.d[0] * 0.8 * k, loco.p[1] + loco.d[1] * 0.8 * k];
    faces.push(...boxFaces(chim, loco.d, 0.25 * k, 0.25 * k, 1.3 * k, 1.75 * k, grey(0.15)));
    const cabin = [loco.p[0] - loco.d[0] * 0.65 * k, loco.p[1] - loco.d[1] * 0.65 * k];
    faces.push(...boxFaces(cabin, loco.d, 0.7 * k, 1 * k, 0.75 * k, 1.6 * k, CD.rot, grey(0.2)));
    const colours = [CD.gelb, CD.tuerkis, CD.orange];
    for (let i = 0; i < cars; i++) {
      const car = along(head - this.mm(2.2 + i * 2.1 + 0.9));
      faces.push(...boxFaces(car.p, car.d, 1.8 * k, 1 * k, 0.25 * k, 0.75 * k, colours[i % 3], grey(0.4)));
      riders.slice(i * 4, i * 4 + 4).forEach((r, j) => {
        const o = [(j % 2 ? 0.4 : -0.4) * k, (j < 2 ? 0.22 : -0.22) * k];
        const p = [car.p[0] + car.d[0] * o[0] - car.d[1] * o[1], car.p[1] + car.d[1] * o[0] + car.d[0] * o[1]];
        faces.push(...boxFaces(p, car.d, 0.3 * k, 0.3 * k, 0.75 * k, 1.3 * k, Ride.riderColour(r, j)));
      });
    }
    if (view.darkness > 0.05) {
      view.glow([front[0] + loco.d[0] * 0.7 * k, front[1] + loco.d[1] * 0.7 * k, 1 * k], this.mm(0.8), "#fff6d8", 0.9);
      view.lightPool(st, this.mm(4), WARM, 0.7);
    }
    view.faces(faces, [g.center[0], g.center[1], 0], { outline: "rgba(60,60,60,0.25)" });
  }
}

/** Opening hours as clock minutes from "HH:MM" texts (null where a text is not a time). */
export function parseHours(open, close) {
  const o = parseTime(open), c = parseTime(close);
  return o == null || c == null ? null : { open: o, close: c };
}
