/**
 * Signs drawn on the layout: the German bus and tram stop sign (a green "H" on a yellow disc,
 * Zeichen 224) and the road signs of the StVO that the traffic signs, zebra crossings, parking and
 * railway crossings put up (Stop 206, give way 205, priority road 306, one-way street 220, the
 * mandatory directions 209–214, no stopping 283 and 286, parking 314, bike and footpath signs 237,
 * 239, 240, 241 with "Radverkehr frei" or "E-Scooter frei", pedestrian crossing 350, the St Andrew's
 * cross 201); the streets put up dead end 357 and pedestrian zone 242.1. Real-world signs keep their colours (`SIGN_COLOURS`, after RAL); they are only half as
 * dark at night (retroreflective).
 * @module arail/objects/signs
 */
import { FONT, grey, OVERLAY } from "../core/colors.js";

export const STOP_SIGN = { disc: "#f7d417", text: OVERLAY.busStop, post: grey(0.4) };

/** Is a sign of radius `r` (px) larger than the image? Then it stands right at the camera and is not drawn. */
const atCamera = (view, r) => r > Math.max(view.camera.width, view.camera.height);

/** The colours of German road signs (RAL 3020 traffic red, 5017 traffic blue, 1023 traffic yellow, 9016 traffic white). */
export const SIGN_COLOURS = {
  red: "#bb1e10", blue: "#0e518d", yellow: "#f0ca00", white: "#f6f6f6", black: "#1c1c1c", post: grey(0.4),
  // the lamps of traffic lights when lit
  lampRed: "#ff2a1a", lampAmber: "#ffb300", lampGreen: "#20d060", lampOff: grey(0.25),
};

/**
 * The road signs: their StVO number and shape. `shape`: octagon, triangle-down, diamond, rect,
 * disc, square; `fill`, `border`; `glyph`: what is drawn on it.
 */
export const ROAD_SIGNS = {
  stop: { code: "206", shape: "octagon", fill: "red", border: "white", glyph: "STOP" },
  "give-way": { code: "205", shape: "triangle-down", fill: "white", border: "red" },
  priority: { code: "306", shape: "diamond", fill: "yellow", border: "white" },
  "one-way": { code: "220", shape: "rect", fill: "blue", glyph: "arrow" },
  "turn-right": { code: "209", shape: "disc", fill: "blue", glyph: "right" },
  "turn-left": { code: "209-10", shape: "disc", fill: "blue", glyph: "left" },
  "turn-straight": { code: "209-30", shape: "disc", fill: "blue", glyph: "straight" },
  "turn-straight-right": { code: "214", shape: "disc", fill: "blue", glyph: "straight-right" },
  "turn-straight-left": { code: "214-10", shape: "disc", fill: "blue", glyph: "straight-left" },
  "turn-left-right": { code: "214-30", shape: "disc", fill: "blue", glyph: "left-right" },
  "no-stopping": { code: "283", shape: "disc", fill: "blue", border: "red", glyph: "cross" },
  "restricted-stopping": { code: "286", shape: "disc", fill: "blue", border: "red", glyph: "slash" },
  parking: { code: "314", shape: "square", fill: "blue", glyph: "P" },
  "bike-path": { code: "237", shape: "disc", fill: "blue", glyph: "bike" },
  "shared-path": { code: "240", shape: "disc", fill: "blue", glyph: "shared" },
  "separate-paths": { code: "241", shape: "disc", fill: "blue", glyph: "separate" },
  footpath: { code: "239", shape: "disc", fill: "blue", glyph: "walker" },
  "pedestrian-crossing": { code: "350", shape: "square", fill: "blue", glyph: "crossing" },
  "pedestrian-zone": { code: "242.1", shape: "square", fill: "blue", glyph: "zone" },
  "dead-end": { code: "357", shape: "square", fill: "blue", glyph: "dead-end" },
  crossbuck: { code: "201", shape: "crossbuck", fill: "white", border: "red" },
};

/**
 * A bus stop sign on a post.
 * @param {import("../core/view.js").View} view
 * @param {number[]} p foot of the post (layout mm)
 * @param {{letter?: string, height_m?: number}} [options] letter: bay or stop letter under the disc
 */
export function drawStopSign(view, p, { letter = "", height_m = 2.9 } = {}) {
  const z = view.m(height_m);
  const top = view.project(p[0], p[1], z), foot = view.project(p[0], p[1], 0);
  if (!top || !foot) return;
  const r = Math.max(5 * view.px, view.pxPerMM(p[0], p[1], z) * view.m(0.35));
  if (atCamera(view, r)) return;
  view.solid(view.depth(p[0], p[1], 0), (ctx) => {
    ctx.strokeStyle = view.dim(STOP_SIGN.post);
    ctx.lineWidth = 1.5 * view.px;
    ctx.beginPath();
    ctx.moveTo(foot[0], foot[1]);
    ctx.lineTo(top[0], top[1]);
    ctx.stroke();
    // the sign is retroreflective: only half as dark at night
    ctx.beginPath();
    ctx.arc(top[0], top[1], r, 0, 2 * Math.PI);
    ctx.fillStyle = view.dim(STOP_SIGN.disc, 0.5);
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.strokeStyle = view.dim(STOP_SIGN.text, 0.5);
    ctx.stroke();
    ctx.fillStyle = view.dim(STOP_SIGN.text, 0.5);
    ctx.font = `700 ${r * 1.3}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("H", top[0], top[1] + r * 0.05);
    if (letter && r > 8 * view.px) {
      ctx.font = `700 ${r * 0.6}px ${FONT}`;
      ctx.fillStyle = "#fff";
      ctx.fillText(letter, top[0], top[1] + r * 1.6);
    }
  });
}

/** The outline of a sign's shape around (0, 0) with radius r, as a path. */
function shapePath(ctx, shape, x, y, r) {
  ctx.beginPath();
  if (shape === "disc") ctx.arc(x, y, r, 0, 2 * Math.PI);
  else if (shape === "octagon") {
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      ctx[i ? "lineTo" : "moveTo"](x + r * Math.cos(a), y + r * Math.sin(a));
    }
    ctx.closePath();
  } else if (shape === "triangle-down") {
    ctx.moveTo(x - r * 1.1, y - r * 0.7);
    ctx.lineTo(x + r * 1.1, y - r * 0.7);
    ctx.lineTo(x, y + r * 1.15);
    ctx.closePath();
  } else if (shape === "diamond") {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
  } else if (shape === "rect") ctx.rect(x - r * 1.3, y - r * 0.55, r * 2.6, r * 1.1);
  else ctx.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
}

/** An arrow from (x0, y0) to (x1, y1) with its head, in the current stroke style. */
function arrow(ctx, x0, y0, x1, y1, head) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.moveTo(x1 - head * Math.cos(a - 0.6), y1 - head * Math.sin(a - 0.6));
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1 - head * Math.cos(a + 0.6), y1 - head * Math.sin(a + 0.6));
  ctx.stroke();
}

/** A tiny bike (two wheels and a frame) at (x, y), size s. */
function bike(ctx, x, y, s) {
  ctx.beginPath();
  ctx.arc(x - s * 0.55, y + s * 0.2, s * 0.32, 0, 2 * Math.PI);
  ctx.moveTo(x + s * 0.87, y + s * 0.2);
  ctx.arc(x + s * 0.55, y + s * 0.2, s * 0.32, 0, 2 * Math.PI);
  ctx.moveTo(x - s * 0.55, y + s * 0.2);
  ctx.lineTo(x - s * 0.1, y - s * 0.35);
  ctx.lineTo(x + s * 0.4, y - s * 0.35);
  ctx.lineTo(x + s * 0.55, y + s * 0.2);
  ctx.moveTo(x - s * 0.1, y - s * 0.35);
  ctx.lineTo(x + s * 0.05, y + s * 0.2);
  ctx.stroke();
}

/** A tiny walking person at (x, y), size s. */
function walker(ctx, x, y, s) {
  ctx.beginPath();
  ctx.arc(x, y - s * 0.6, s * 0.18, 0, 2 * Math.PI);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y - s * 0.4);
  ctx.lineTo(x, y + s * 0.15);
  ctx.lineTo(x - s * 0.3, y + s * 0.65);
  ctx.moveTo(x, y + s * 0.15);
  ctx.lineTo(x + s * 0.3, y + s * 0.65);
  ctx.moveTo(x - s * 0.3, y - s * 0.1);
  ctx.lineTo(x + s * 0.3, y - s * 0.2);
  ctx.stroke();
}

/** The glyph of a sign at (x, y), radius r. */
function glyph(ctx, view, sign, x, y, r) {
  const C = (c) => view.dim(SIGN_COLOURS[c], 0.5);
  ctx.strokeStyle = C(sign.fill === "blue" ? "white" : "black");
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const g = sign.glyph, h = r * 0.55;
  if (g === "STOP") {
    ctx.fillStyle = C("white");
    ctx.font = `700 ${r * 0.62}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("STOP", x, y + r * 0.04);
  } else if (g === "P") {
    ctx.font = `700 ${r * 1.4}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("P", x, y + r * 0.08);
  } else if (g === "arrow") arrow(ctx, x - r * 0.95, y, x + r * 0.95, y, r * 0.4);
  else if (g === "right") {
    ctx.beginPath();
    ctx.moveTo(x - h * 0.3, y + h);
    ctx.lineTo(x - h * 0.3, y);
    ctx.stroke();
    arrow(ctx, x - h * 0.3, y, x + h, y, r * 0.35);
  } else if (g === "left") {
    ctx.beginPath();
    ctx.moveTo(x + h * 0.3, y + h);
    ctx.lineTo(x + h * 0.3, y);
    ctx.stroke();
    arrow(ctx, x + h * 0.3, y, x - h, y, r * 0.35);
  } else if (g === "straight") arrow(ctx, x, y + h, x, y - h, r * 0.35);
  else if (g === "straight-right" || g === "straight-left" || g === "left-right") {
    const k = g === "straight-left" ? -1 : 1;
    if (g !== "left-right") {
      arrow(ctx, x - k * h * 0.3, y + h, x - k * h * 0.3, y - h, r * 0.3);
      arrow(ctx, x - k * h * 0.3, y + h * 0.1, x + k * h, y + h * 0.1, r * 0.3);
    } else {
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, y);
      ctx.stroke();
      arrow(ctx, x, y, x + h, y, r * 0.3);
      arrow(ctx, x, y, x - h, y, r * 0.3);
    }
  } else if (g === "cross" || g === "slash") {
    ctx.strokeStyle = C("red");
    ctx.lineWidth = Math.max(1, r * 0.2);
    ctx.beginPath();
    ctx.moveTo(x - h * 1.2, y - h * 1.2);
    ctx.lineTo(x + h * 1.2, y + h * 1.2);
    if (g === "cross") {
      ctx.moveTo(x + h * 1.2, y - h * 1.2);
      ctx.lineTo(x - h * 1.2, y + h * 1.2);
    }
    ctx.stroke();
  } else if (g === "bike") bike(ctx, x, y, r * 0.55);
  else if (g === "walker") walker(ctx, x, y, r * 0.6);
  else if (g === "zone") {
    // a grown-up and a child
    walker(ctx, x - r * 0.2, y - r * 0.05, r * 0.62);
    walker(ctx, x + r * 0.42, y + r * 0.2, r * 0.38);
  } else if (g === "dead-end") {
    // a white street that ends in a red bar
    ctx.lineCap = "butt";
    ctx.lineWidth = r * 0.42;
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.9);
    ctx.lineTo(x, y - r * 0.3);
    ctx.stroke();
    ctx.strokeStyle = C("red");
    ctx.lineWidth = r * 0.3;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.55, y - r * 0.45);
    ctx.lineTo(x + r * 0.55, y - r * 0.45);
    ctx.stroke();
  }
  else if (g === "shared") {
    ctx.beginPath();
    ctx.moveTo(x - r * 0.8, y);
    ctx.lineTo(x + r * 0.8, y);
    ctx.stroke();
    walker(ctx, x, y - r * 0.45, r * 0.38);
    bike(ctx, x, y + r * 0.42, r * 0.33);
  } else if (g === "separate") {
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.8);
    ctx.lineTo(x, y + r * 0.8);
    ctx.stroke();
    bike(ctx, x - r * 0.42, y, r * 0.28);
    walker(ctx, x + r * 0.42, y, r * 0.4);
  } else if (g === "crossing") {
    ctx.beginPath();
    ctx.moveTo(x - r * 0.75, y + r * 0.6);
    ctx.lineTo(x + r * 0.75, y + r * 0.6);
    ctx.lineTo(x, y - r * 0.7);
    ctx.closePath();
    ctx.fillStyle = C("white");
    ctx.fill();
    ctx.fillStyle = C("black");
    ctx.strokeStyle = C("black");
    ctx.lineWidth = Math.max(1, r * 0.1);
    walker(ctx, x, y + r * 0.12, r * 0.38);
  }
}

/**
 * A road sign on a post: its shape, colours and glyph; seen from far away a coloured dot.
 * @param {import("../core/view.js").View} view
 * @param {number[]} p foot of the post (layout mm)
 * @param {string} key a key of ROAD_SIGNS
 * @param {{height_m?: number, plate?: string, under?: string}} [options] plate: a supplementary
 *   sign under it ("bikes" for Radverkehr frei, "scooters" for E-Scooter frei, or a text);
 *   under: a second sign below (e.g. "priority" under a give-way sign)
 */
export function drawSign(view, p, key, { height_m = 2.3, plate = "", under = "" } = {}) {
  const sign = ROAD_SIGNS[key];
  if (!sign || !p) return;
  const z = view.m(height_m);
  const top = view.project(p[0], p[1], z), foot = view.project(p[0], p[1], 0);
  if (!top || !foot) return;
  const r = view.pxPerMM(p[0], p[1], z) * view.m(0.32);
  if (r < 0.8 * view.px || atCamera(view, r)) return;
  view.solid(view.depth(p[0], p[1], 0), (ctx) => {
    const C = (c) => view.dim(SIGN_COLOURS[c], 0.5);
    ctx.strokeStyle = view.dim(SIGN_COLOURS.post);
    ctx.lineWidth = Math.max(1, Math.min(2, r * 0.12));
    ctx.beginPath();
    ctx.moveTo(foot[0], foot[1]);
    ctx.lineTo(top[0], top[1]);
    ctx.stroke();
    const R = Math.max(2.5 * view.px, r);
    if (sign.shape === "crossbuck") {
      // red and white bars crossed at 45°
      ctx.lineCap = "butt";
      for (const [a, c] of [[Math.PI / 4, "white"], [-Math.PI / 4, "white"]]) {
        ctx.lineWidth = R * 0.42;
        ctx.strokeStyle = C(c);
        ctx.beginPath();
        ctx.moveTo(top[0] - Math.cos(a) * R * 1.4, top[1] - Math.sin(a) * R * 1.4);
        ctx.lineTo(top[0] + Math.cos(a) * R * 1.4, top[1] + Math.sin(a) * R * 1.4);
        ctx.stroke();
        ctx.lineWidth = R * 0.18;
        ctx.strokeStyle = C("red");
        ctx.setLineDash([R * 0.35, R * 0.35]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      return;
    }
    shapePath(ctx, sign.shape, top[0], top[1], R);
    ctx.fillStyle = C(sign.fill);
    ctx.fill();
    if (sign.border) {
      ctx.lineWidth = Math.max(1, R * (sign.shape === "triangle-down" ? 0.3 : 0.22));
      ctx.strokeStyle = C(sign.border);
      ctx.stroke();
    }
    if (R >= 5 * view.px) glyph(ctx, view, sign, top[0], top[1], R);
    let below = top[1] + R * (sign.shape === "triangle-down" ? 1.25 : 1.05);
    if (plate && R >= 4 * view.px) {
      // a supplementary sign: white with a black border
      const w = R * 1.9, h = R * 0.9;
      ctx.fillStyle = C("white");
      ctx.strokeStyle = C("black");
      ctx.lineWidth = Math.max(1, R * 0.06);
      ctx.beginPath();
      ctx.rect(top[0] - w / 2, below, w, h);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = C("black");
      ctx.fillStyle = C("black");
      ctx.lineWidth = Math.max(1, R * 0.1);
      if (plate === "bikes" || plate === "scooters") {
        if (plate === "bikes") bike(ctx, top[0] - w * 0.18, below + h * 0.5, h * 0.42);
        else {
          ctx.beginPath();
          ctx.arc(top[0] - w * 0.36, below + h * 0.72, h * 0.12, 0, 2 * Math.PI);
          ctx.moveTo(top[0] - w * 0.36, below + h * 0.72);
          ctx.lineTo(top[0] - w * 0.04, below + h * 0.72);
          ctx.lineTo(top[0] - w * 0.08, below + h * 0.2);
          ctx.stroke();
        }
        ctx.font = `700 ${h * 0.42}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("frei", top[0] + w * 0.24, below + h * 0.55);
      } else {
        ctx.font = `700 ${h * 0.42}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(plate, top[0], below + h * 0.55);
      }
      below += h * 1.1;
    }
    if (under && ROAD_SIGNS[under] && R >= 4 * view.px) {
      const s2 = ROAD_SIGNS[under], y2 = below + R * 0.95;
      shapePath(ctx, s2.shape, top[0], y2, R * 0.85);
      ctx.fillStyle = C(s2.fill);
      ctx.fill();
      if (s2.border) {
        ctx.lineWidth = Math.max(1, R * 0.18);
        ctx.strokeStyle = C(s2.border);
        ctx.stroke();
      }
    }
  });
}

/**
 * A traffic light head (three lights) on a post, showing a state.
 * @param {import("../core/view.js").View} view
 * @param {number[]} p foot of the post (layout mm)
 * @param {"red" | "amber" | "green" | "red-amber" | "off"} state
 */
export function drawTrafficLight(view, p, state, { height_m = 3.2 } = {}) {
  const z = view.m(height_m);
  const top = view.project(p[0], p[1], z), foot = view.project(p[0], p[1], 0);
  if (!top || !foot) return;
  const r = view.pxPerMM(p[0], p[1], z) * view.m(0.14);
  if (atCamera(view, 4 * r)) return;
  const lit = { red: state === "red" || state === "red-amber", amber: state === "amber" || state === "red-amber", green: state === "green" };
  const on = { red: SIGN_COLOURS.lampRed, amber: SIGN_COLOURS.lampAmber, green: SIGN_COLOURS.lampGreen };
  view.solid(view.depth(p[0], p[1], 0), (ctx) => {
    ctx.strokeStyle = view.dim(SIGN_COLOURS.post);
    ctx.lineWidth = Math.max(1, Math.min(2.5, r * 0.5));
    ctx.beginPath();
    ctx.moveTo(foot[0], foot[1]);
    ctx.lineTo(top[0], top[1]);
    ctx.stroke();
    const R = Math.max(1.6 * view.px, r);
    ctx.fillStyle = view.dim(SIGN_COLOURS.black);
    ctx.fillRect(top[0] - R * 1.5, top[1] - R * 4.6, R * 3, R * 7);
    ["red", "amber", "green"].forEach((c, i) => {
      ctx.beginPath();
      ctx.arc(top[0], top[1] - R * 3.2 + i * R * 2.2, R, 0, 2 * Math.PI);
      ctx.fillStyle = lit[c] ? on[c] : view.dim(SIGN_COLOURS.lampOff);
      ctx.fill();
    });
  });
  if (lit.red || lit.amber || lit.green) {
    const c = lit.green ? "green" : lit.amber && !lit.red ? "amber" : "red";
    view.glow([p[0], p[1], z - view.m(0.3)], view.m(0.7), on[c], view.darkness > 0.2 ? 0.9 : 0.35);
  }
}
