// The corporate design (CD) of the Chair of Railway Operations in the framework's colours and
// in the app's theme: CD hex values, Noto Sans on the canvas, and text contrast of the theme
// tokens in light and dark mode (also for states the browser accessibility tests do not reach).
import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BusTerminal, Camera, CD, CD_LIGHT, createWorld, FONT, moodColor, OVERLAY, PALETTE, parseRgba, rgba, View } from "../../web/arail/index.js";
import { readJSON, ROOT } from "./helpers.js";

/* ---------------------------------------------------------------- WCAG contrast */

function luminance([r, g, b]) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Alpha-composite colour `c` over the opaque colour `under`. */
function over(c, under) {
  const [r, g, b, a] = parseRgba(c), u = parseRgba(under);
  return [r, g, b].map((v, i) => a * v + (1 - a) * u[i]);
}

function contrast(text, background, under = "#ffffff") {
  const L1 = luminance(over(text, over(background, under))), L2 = luminance(over(background, under));
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

/** `color-mix(in srgb, a p%, b)` */
const mixColor = (a, p, b) => {
  const A = parseRgba(a), B = parseRgba(b);
  return `rgb(${[0, 1, 2].map((i) => A[i] * p + B[i] * (1 - p)).join(",")})`;
};

/* ---------------------------------------------------------------- framework colours */

test("design: signs, vehicles, overlays and the mood scale use the CD colours", () => {
  const rgb = (c) => parseRgba(c).slice(0, 3);
  assert.deepEqual(rgb(moodColor(0)), rgb(CD.rot), "unhappy: Rot 1");
  assert.deepEqual(rgb(moodColor(0.5)), rgb(CD.gelb), "neutral: Gelb 1");
  assert.deepEqual(rgb(moodColor(1)), rgb(CD.tuerkis), "happy: Türkis 1");
  assert.equal(PALETTE.signBlue, CD.tuerkis, "platform and label signs");
  assert.equal(PALETTE.train, CD.tuerkis);
  assert.equal(PALETTE.bus, CD.gelb);
  assert.equal(PALETTE.warning, CD.rot);
  assert.equal(OVERLAY.sign, CD.tuerkis);
  assert.equal(OVERLAY.selection, CD.orange);
  assert.equal(OVERLAY.danger, CD.rot);
  assert.equal(OVERLAY.tracked, CD_LIGHT.tuerkis);
  assert.deepEqual(rgb(OVERLAY.label), rgb(CD.dunkelblau), "label boards are Dunkelblau");
  assert.match(FONT, /^"Noto Sans",/);
});

test("design: text on canvas labels stays legible over any camera image", () => {
  for (const under of ["#ffffff", "#000000", "#8fd3c0"]) {
    for (const text of [OVERLAY.labelText, OVERLAY.status, OVERLAY.alert]) {
      assert.ok(contrast(text, OVERLAY.label, under) >= 4.5, `${text} on ${OVERLAY.label} over ${under}`);
    }
    assert.ok(contrast(OVERLAY.labelText, OVERLAY.dangerLabel, under) >= 4.5, `disruption label over ${under}`);
    assert.ok(contrast(OVERLAY.labelText, rgba(OVERLAY.sign, 0.92), under) >= 4.5, `train line label over ${under}`);
  }
  assert.ok(contrast(OVERLAY.labelText, OVERLAY.sign) >= 4.5, "badge text on Türkis");
  // the "H" badge of bus stop labels is 12 px text too (it was 4.41:1 with the old green #1f8a3b)
  assert.ok(contrast(OVERLAY.labelText, OVERLAY.busStop) >= 4.5, `badge text on the bus stop green: ${contrast(OVERLAY.labelText, OVERLAY.busStop).toFixed(2)}`);
});

/** A canvas context that records what is drawn (enough for labels). */
function recordingContext(width = 1280, height = 720) {
  const log = [], state = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key === "canvas") return { width, height };
      if (key === "measureText") return (s) => ({ width: 7 * String(s).length });
      if (/^create\w*Gradient$/.test(key)) return () => ({ addColorStop() {} });
      if (key in target) return target[key];
      return (...args) => log.push({ call: key, args });
    },
    set(target, key, value) {
      target[key] = value;
      log.push({ set: key, value });
      return true;
    },
  });
  return { ctx, log };
}

/** A view looking straight down on the layout from 1 m. */
function topView(ctx) {
  const camera = new Camera(1280, 720);
  const { fx, cx, cy } = camera.intrinsics, d = 1000;
  return new View({ ctx, camera, H: [fx, 0, cx * d, 0, -fx, cy * d, 0, 0, d], scale: 87 });
}

test("design: labels are drawn in Noto Sans on Dunkelblau with Türkis badges; selections in Orange", (t) => {
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  const { ctx, log } = recordingContext();
  const view = topView(ctx);
  view.label([0, 0, 0], ["Platform 1: 3 people", "Next train in 5 s"], { badge: "1" });
  view.render();
  assert.deepEqual(errors, []);
  const sets = (key) => log.filter((e) => e.set === key).map((e) => e.value);
  assert.ok(sets("font").length && sets("font").every((f) => f.includes(FONT)), sets("font").join(" | "));
  const fills = sets("fillStyle");
  assert.equal(fills[0], OVERLAY.label, "label board");
  assert.equal(fills[1], OVERLAY.sign, "badge");
  assert.ok(fills.slice(2).every((c) => c === OVERLAY.labelText), "white text");

  const world = createWorld(readJSON("web/layouts/ebl-lab.json"));
  const styles = [];
  world.getObject("platform-1").drawSelection({ polygon: (points, style) => styles.push(style) });
  assert.equal(styles.length, 1);
  assert.equal(styles[0].stroke, CD.orange);
});

// colours of the design before the CD (cyan / magenta / amber overlays, signage blue, blue trains, ...)
const OLD_COLOURS = [
  [0, 229, 255], [255, 92, 240], [242, 169, 59], [29, 79, 156], [15, 26, 43], [0, 70, 90], [229, 50, 45], [156, 28, 25],
  [60, 10, 10], [90, 160, 205], [60, 115, 150], [80, 140, 180], [232, 179, 33], [243, 210, 122], [217, 164, 27], [255, 138, 128],
];

test("design: everything the world draws over the layout is in the CD (labels, signs, vehicles, tracks, feed trains, disruptions, selection)", (t) => {
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  // the 3D stop sign of the bus terminal (yellow disc, green "H") is a real-world sign, drawn by
  // workstream A3's objects/signs.js; it is not part of this check
  if (BusTerminal.prototype._stopSign) t.mock.method(BusTerminal.prototype, "_stopSign", () => {});
  const world = createWorld(readJSON("web/layouts/ebl-lab.json"));
  Object.assign(world.settings, { showTracks: true, lighting: false });
  for (let i = 0; i < 90 * 10; i++) world.step(0.1); // passengers, virtual trains and buses at their stops
  world.disruptions.start({ type: "closure", target: "platform-2" });

  const { ctx, log } = recordingContext();
  const styles = [], labels = [];
  const record = (view) => {
    for (const m of ["polygon", "line", "ribbon"]) {
      const draw = view[m].bind(view);
      view[m] = (...args) => (styles.push({ m, style: args[args.length - 1] }), draw(...args));
    }
    const label = view.label.bind(view);
    view.label = (at, text, style = {}) => (labels.push(style), label(at, text, style));
    return view;
  };
  world.draw(record(topView(ctx)), { selected: world.getObject("platform-1") });
  // trains reported by the control system: on a track, with a heading, and with a position only
  world.trains.apply({ type: "trains", trains: [
    { id: "ICE 1", track: "G1", offset_mm: 600, length_mm: 300 },
    { id: "RB 2", x_mm: 900, y_mm: -200, heading_deg: 10 },
    { id: "S 3", x_mm: 300, y_mm: -250 },
  ] });
  world.draw(record(topView(ctx)));
  assert.deepEqual(errors, []);

  // no colour of the old design is left in anything drawn
  const colours = log.filter((e) => e.set === "fillStyle" || e.set === "strokeStyle").map((e) => e.value).filter((v) => typeof v === "string");
  assert.ok(colours.length > 100, `${colours.length} colours drawn`);
  for (const c of colours) {
    const v = parseRgba(c);
    if (!v) continue;
    const old = OLD_COLOURS.find((o) => o.every((x, i) => Math.round(v[i]) === x));
    assert.equal(old, undefined, `colour of the old design: ${c}`);
  }
  const fonts = log.filter((e) => e.set === "font").map((e) => e.value);
  assert.ok(fonts.length > 5 && fonts.every((f) => f.includes(FONT)), `fonts: ${[...new Set(fonts)].join(" | ")}`);

  // the CD roles
  const strokes = styles.map((s) => s.style.stroke);
  assert.ok(styles.some((s) => s.style.layer === "overlay" && s.style.stroke === OVERLAY.selection), "selection: Orange 1");
  assert.ok(strokes.includes(rgba(OVERLAY.tracked, 0.85)), "tracks: light Türkis");
  assert.ok(styles.filter((s) => s.style.stroke === OVERLAY.tracked && s.style.fill === OVERLAY.trackedFill).length >= 3, "control-system trains: Türkis outlines (track, heading, position)");
  assert.ok(styles.some((s) => s.m === "polygon" && s.style.fill === rgba(OVERLAY.danger, 0.28)), "closed platform: Rot 1 hatching");
  const badges = new Set(labels.map((l) => l.badgeColor).filter(Boolean));
  for (const c of [OVERLAY.sign, OVERLAY.busStop]) assert.ok(badges.has(c), `badge ${c} in ${[...badges].join(", ")}`);

  // every label drawn is legible over a bright and over a dark camera image
  for (const l of labels) {
    const background = l.background || OVERLAY.label;
    const texts = [...(l.colors || []).filter(Boolean), l.color || OVERLAY.labelText];
    for (const under of ["#ffffff", "#000000"]) {
      for (const text of texts) assert.ok(contrast(text, background, under) >= 4.5, `${text} on ${background} over ${under}: ${contrast(text, background, under).toFixed(2)}`);
    }
    if (l.badge && l.badgeColor) assert.ok(contrast(OVERLAY.labelText, l.badgeColor) >= 4.5, `badge text on ${l.badgeColor}: ${contrast(OVERLAY.labelText, l.badgeColor).toFixed(2)}`);
  }
});

/* ---------------------------------------------------------------- app theme */

const CSS = readFileSync(join(ROOT, "web/app/app.css"), "utf8");

/** Custom properties declared in the first rule whose selector is `selector`. */
function tokens(selector) {
  const start = CSS.indexOf(`${selector} {`);
  assert.ok(start >= 0, `rule ${selector}`);
  const body = CSS.slice(start, CSS.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const LIGHT = tokens(":root");
const DARK = { ...LIGHT, ...tokens(':root[data-theme="dark"]') };

test("design: the app theme follows the chair's screen design (tud-mobile) in light and dark mode", () => {
  assert.deepEqual(tokens(':root:not([data-theme="light"])'), tokens(':root[data-theme="dark"]'), "both dark-mode rules agree");
  assert.equal(LIGHT["--accent"], CD.tuerkis);
  assert.equal(LIGHT["--bar"], CD.tuerkis, "the app bar is Türkis");
  assert.equal(LIGHT["--warn"], CD.orange);
  assert.equal(LIGHT["--danger"], CD.rot);
  assert.equal(LIGHT["--board"], CD.dunkelblau, "departure boards are Dunkelblau");
  assert.equal(LIGHT["--sign"], CD.tuerkis);
  assert.equal(DARK["--bar"], CD.dunkelblau);
  assert.equal(DARK["--accent"], CD_LIGHT.tuerkis);
  assert.equal(DARK["--warn"], CD_LIGHT.orange);
  assert.equal(DARK["--danger"], CD_LIGHT.rot);
  assert.match(LIGHT["--font"], /^"Noto Sans",/);
  assert.match(LIGHT["--mono"], /^"Noto Sans Mono",/);
  assert.doesNotMatch(CSS, /Archivo|JetBrains/);
});

test("design: all text colour pairs of the theme have a contrast of at least 4.5:1", () => {
  for (const [mode, T] of [["light", LIGHT], ["dark", DARK]]) {
    const pairs = [
      ["--text", "--bg"], ["--text", "--surface"], ["--text", "--surface-2"],
      ["--text-2", "--bg"], ["--text-2", "--surface"], ["--text-2", "--surface-2"],
      ["--accent-ink", "--surface"], ["--accent-ink", "--surface-2"],
      ["--accent-text", "--accent"], ["--warn-text", "--warn"], ["--danger", "--surface"],
      ["--bar-text", "--bar"], ["--bar-muted", "--bar"], ["--bar-primary-text", "--bar-primary"],
      ["--board-text", "--board"], ["--board-muted", "--board"], ["--board-warn", "--board"], ["--board-text", "--board-2"],
      ["--sign-text", "--sign"], ["--overlay-text", "--overlay"], ["--overlay-ok", "--overlay"], ["--overlay-warn", "--overlay"], ["--overlay-bad", "--overlay"],
    ];
    for (const [fg, bg] of pairs) {
      // translucent overlays sit on the camera image: check over white (the worst case for light text)
      const c = contrast(T[fg], T[bg], "#ffffff");
      assert.ok(c >= 4.5, `${mode}: ${fg} ${T[fg]} on ${bg} ${T[bg]}: ${c.toFixed(2)}`);
    }
    // the bus stop number on the departure board: the German bus stop sign, large text (20.8 px bold: 3:1)
    const stop = contrast(T["--stop-sign-text"], T["--stop-sign"]);
    assert.ok(stop >= 3, `${mode}: bus stop sign ${stop.toFixed(2)}`);
    // tinted backgrounds of states: pressed palette button, current list entry, disruption
    const tints = [["--warn", 0.1], ["--accent", 0.1], ["--danger", 0.08]];
    for (const [tint, p] of tints) {
      const bg = mixColor(T[tint], p, T["--surface"]);
      for (const fg of ["--text", "--text-2"]) {
        const c = contrast(T[fg], bg);
        assert.ok(c >= 4.5, `${mode}: ${fg} on ${tint} ${p * 100} %: ${c.toFixed(2)}`);
      }
    }
  }
});

test("design: the chair logo scales (viewBox) and has a white variant for the app bar", () => {
  for (const file of ["cro-logo.svg", "cro-logo-white.svg"]) {
    const svg = readFileSync(join(ROOT, "web/assets", file), "utf8");
    assert.match(svg, /viewBox="0 0 1014 321"/, file);
    assert.match(svg, /<title>[^<]*Chair of Railway Operations<\/title>/, file);
  }
  const white = readFileSync(join(ROOT, "web/assets/cro-logo-white.svg"), "utf8");
  const fills = new Set([...white.matchAll(/fill="([^"]+)"/g)].map((m) => m[1].toUpperCase()));
  assert.deepEqual([...fills], ["#FFFFFF"]);
  const html = readFileSync(join(ROOT, "web/app/index.html"), "utf8");
  assert.match(html, /<img class="cro-logo" src="\.\.\/assets\/cro-logo-white\.svg"[^>]*alt="[^"]*Chair of Railway Operations"/);
});
