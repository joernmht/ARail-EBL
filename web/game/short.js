// Short texts, by rule: what a page of the game shows first of a long text is its lead, the first
// sentence, cut at a word when even that is long. The rest is shown when asked for. The budgets say
// how many words a screen may show before anyone opens anything (the tests count them). No DOM.

/** The most words of a lead. */
export const LEAD_WORDS = 22;

/** The most words a screen shows before anything is opened: choosing the seats, and a seat at work. */
export const BUDGET = { setup: 120, seat: 260 };

/**
 * The lead of a text: its first sentence; cut after `words` words, with an ellipsis, when longer.
 * @param {string} text
 * @param {number} [words]
 * @returns {string}
 */
export function lead(text, words = LEAD_WORDS) {
  const t = String(text ?? "").trim().replace(/\s+/g, " ");
  // a sentence ends at . ! ? followed by a space and a capital or a digit (not after "e.g." or a number's point)
  const end = t.search(/[.!?](?=\s+[A-ZÄÖÜ0-9€"(])/);
  const first = end < 0 ? t : t.slice(0, end + 1);
  const parts = first.split(" ");
  return parts.length <= words ? first : `${parts.slice(0, words).join(" ").replace(/[,;:]$/, "")}…`;
}

/**
 * Whether a text says more than its lead.
 * @param {string} text
 * @param {number} [words]
 */
export function hasMore(text, words = LEAD_WORDS) {
  return lead(text, words) !== String(text ?? "").trim().replace(/\s+/g, " ");
}

/** The words of a text, counted as a reader would. */
export function wordCount(text) {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean).length;
}
