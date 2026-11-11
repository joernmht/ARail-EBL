// What the game's pages draw the same way: a mission's facts as chips. (The places and their
// pictures are places.js; the head of a page, .scene in site.css, is in its HTML.)
import { h } from "../app/ui.js";

/**
 * Facts as chips.
 * @param {string[]} facts
 * @param {string} [label] what the list is, for screen readers
 */
export function factChips(facts, label = "In short") {
  return h("ul", { class: "facts", "aria-label": label }, facts.map((f) => h("li", {}, f)));
}
