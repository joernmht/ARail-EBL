// The scene of a game's page: the photo of the place where the role works, on the lab's layout, with
// the place's name ("Where you work"), and a mission's facts as chips. The places are places.js;
// the head of a page (.scene in site.css) is in its HTML, and `showPlace` changes its photo.
import { h } from "../app/ui.js";

/** What the photo's caption says before the place's name. */
export const WHERE = "Where you work";

/**
 * The address of a place's photo.
 * @param {import("./places.js").Place} place
 * @param {string} base the way from the page to web/ ("../../")
 */
export function photoOf(place, base) {
  return base + place.photo;
}

/**
 * A place as a picture: its photo, and below or on it where that is.
 * @param {import("./places.js").Place} place
 * @param {string} base the way from the page to web/
 * @param {{label?: string, line?: boolean, cls?: string}} [options] label: what stands before the name; line: with the place's line
 */
export function placeFigure(place, base, { label = WHERE, line = false, cls = "" } = {}) {
  return h("figure", { class: `place${cls ? ` ${cls}` : ""}`, "data-place": place.id },
    h("img", { src: photoOf(place, base), alt: place.alt, loading: "lazy", decoding: "async", style: `object-position: ${place.focus ?? "50% 50%"}` }),
    h("figcaption", {}, h("span", { class: "place-label" }, label), " ", h("strong", {}, place.name), line ? [" ", h("span", { class: "place-line" }, place.line)] : null));
}

/**
 * Facts as chips.
 * @param {string[]} facts
 * @param {string} [label] what the list is, for screen readers
 */
export function factChips(facts, label = "In short") {
  return h("ul", { class: "facts", "aria-label": label }, facts.map((f) => h("li", {}, f)));
}

/**
 * Show another place in the head of a page (.scene): its photo and its name.
 * @param {Element} scene
 * @param {import("./places.js").Place} place
 * @param {string} base the way from the page to web/
 */
export function showPlace(scene, place, base) {
  const fig = scene?.querySelector(".scene-place");
  if (!fig || fig.dataset.place === place.id) return;
  fig.dataset.place = place.id;
  const img = fig.querySelector("img");
  img.src = photoOf(place, base);
  img.alt = place.alt;
  img.style.objectPosition = place.focus ?? "50% 50%";
  fig.querySelector("strong").textContent = place.name;
  const line = fig.querySelector(".place-line");
  if (line) line.textContent = place.line;
}
