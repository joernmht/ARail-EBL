/**
 * Signs drawn on the layout, shared by the stop types: the German bus stop sign (a green "H" on
 * a yellow disc, Zeichen 224; a real-world sign, so it keeps its colours) on a post.
 * @module arail/objects/signs
 */
import { FONT, grey } from "../core/colors.js";

export const STOP_SIGN = { disc: "#f7d417", text: "#1f8a3b", post: grey(0.4) };

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
  view.solid(view.depth(p[0], p[1], 0), (ctx) => {
    ctx.strokeStyle = view.dim(STOP_SIGN.post);
    ctx.lineWidth = 1.5 * view.px;
    ctx.beginPath();
    ctx.moveTo(foot[0], foot[1]);
    ctx.lineTo(top[0], top[1]);
    ctx.stroke();
    const r = Math.max(5 * view.px, view.pxPerMM(p[0], p[1], z) * view.m(0.35));
    // the sign is retroreflective: only half as dark at night
    ctx.beginPath();
    ctx.arc(top[0], top[1], r, 0, 2 * Math.PI);
    ctx.fillStyle = view.dim(STOP_SIGN.disc, 0.5);
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.strokeStyle = view.dim(STOP_SIGN.text, 0.5);
    ctx.stroke();
    ctx.fillStyle = view.dim(STOP_SIGN.text, 0.5);
    ctx.font = `800 ${r * 1.3}px ${FONT}`;
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
