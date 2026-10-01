/**
 * Colour helpers. Colours are CSS strings; internally [r, g, b] arrays (0-255).
 * @module arail/core/colors
 */

/** Parse "#rgb", "#rrggbb" or "rgb(r, g, b)" into [r, g, b]. */
export function parseColor(c) {
  if (Array.isArray(c)) return c;
  const s = String(c).trim();
  if (s[0] === "#") {
    const h = s.length === 4 ? s.slice(1).split("").map((x) => x + x).join("") : s.slice(1, 7);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) return m[1].split(",").slice(0, 3).map((v) => Number(v));
  return [128, 128, 128];
}

/** Parse a CSS colour into [r, g, b, a] (alpha 1 unless given by rgba() or #rrggbbaa); null if unknown. */
export function parseRgba(c) {
  if (Array.isArray(c)) return [c[0], c[1], c[2], c[3] ?? 1];
  const s = String(c).trim();
  if (/^#[0-9a-f]{3}$/i.test(s) || /^#[0-9a-f]{6}$/i.test(s)) return [...parseColor(s), 1];
  if (/^#[0-9a-f]{8}$/i.test(s)) return [...parseColor(s), parseInt(s.slice(7, 9), 16) / 255];
  const m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (!m) return null;
  const v = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith("%") ? Number(x.slice(0, -1)) / 100 : Number(x)));
  if (v.length < 3 || v.slice(0, 3).some((x) => !Number.isFinite(x))) return null;
  return [v[0], v[1], v[2], Number.isFinite(v[3]) ? v[3] : 1];
}

export function rgba(c, alpha = 1) {
  const [r, g, b] = parseColor(c);
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
}

/** Multiply brightness (factor < 1 darker, > 1 lighter). */
export function shade(c, factor, alpha = 1) {
  const [r, g, b] = parseColor(c);
  const f = (v) => (factor <= 1 ? v * factor : v + (255 - v) * (factor - 1));
  return rgba([f(r), f(g), f(b)], alpha);
}

export function mix(a, b, t, alpha = 1) {
  const A = parseColor(a), B = parseColor(b);
  return rgba([0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * t), alpha);
}

const RED = [228, 58, 52], YELLOW = [242, 200, 40], GREEN = [52, 176, 74];

/**
 * Colour for a satisfaction ("mood") value: 0 = unhappy (red) ... 1 = happy (green).
 * @param {number} m mood 0..1
 * @param {number} [alpha=1]
 * @param {number} [k=1] brightness factor
 */
export function moodColor(m, alpha = 1, k = 1) {
  m = Math.min(1, Math.max(0, m));
  const [p, q, t] = m < 0.5 ? [RED, YELLOW, m / 0.5] : [YELLOW, GREEN, (m - 0.5) / 0.5];
  return rgba([0, 1, 2].map((i) => (p[i] + (q[i] - p[i]) * t) * k), alpha);
}

/**
 * Colours of the corporate design of the Chair of Railway Operations, TU Dresden
 * (source of truth: the chair's CD repository `tud_cro_chaircd`). The app uses them for its
 * interface and the signs drawn over the layout; Gelb (yellow) is for diagrams and details.
 */
export const CD = {
  tuerkis: "#0A777F", // main brand colour
  brillantblau: "#00008C", // logo blue
  rot: "#D20F41",
  orange: "#C85000", // accent (the 10 %), attention
  gelb: "#FFC700", // secondary, diagrams only
  dunkelblau: "#001450",
  black: "#000000",
  white: "#FFFFFF",
};

/** A neutral grey: 0 = black ... 1 = white (buildings are greyscale, like a white model). */
export function grey(v) {
  const h = Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");
  return `#${h}${h}${h}`;
}

/** Palette used by the built-in objects. */
export const PALETTE = {
  platform: "#e9e6de",
  platformEdge: "#f5f5f0",
  safetyLine: "#ffd400",
  asphalt: "#4a4f57",
  pavement: "#b9b6ae",
  busBay: "#ffd400",
  glass: "#9fc9e0",
  steel: "#6c7a89",
  train: "#5aa0cd",
  trainWindow: "#23324a",
  trainDoor: "#f0c828",
  bus: "#e8b321",
  busWindow: "#2a3548",
  litWindow: "#ffe2a0", // windows with the lights on (night)
  warning: "#e5322d",
  signBlue: "#1d4f9c",
  signText: "#ffffff",
  roof: "#9b4a3c",
  wall: "#e2d3b8",
  grass: "#7fb069",
  field: "#d9c26a",
  water: "#4f93c9",
  forest: "#3f7d4a",
  sand: "#e3cf9c",
  parking: "#8a8f96",
  plaza: "#c9c3b6",
  trunk: "#6b4a2f",
  leaves: "#4c8c3f",
  conifer: "#2f6b3a",
};
