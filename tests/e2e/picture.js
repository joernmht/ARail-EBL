// What the game's pages may show on their picture. The rule: no information stands in a box on the
// picture; it is in the line at the top (the semi-transparent header) or in the rail at the side, and
// what is about something in the picture pulses on it. The band of who speaks, the game's own
// picture (the control desk: only what it draws itself, SKETCH), the tables a person places on the
// stage (the timetable the game keeps in view) and dialogs are not the picture; the phase's name over
// the whole screen is a title, for a moment. Used by the play page's tests (play.spec.js,
// table.spec.js, dispatcher.spec.js).

/**
 * What the game's own picture (the panel, PlayPage.sketch) may hold as text, part by part: its
 * heading, the names its shapes write (a text, a tag, as such a shape that can be chosen), and below
 * it what is chosen in it with what is known of it and its moves. Nothing else in it: a box or a
 * callout added to the panel or drawn into its picture is text in the picture.
 */
export const SKETCH = [
  ".play-sketch > h4",
  ".play-board .shapes > text",
  ".play-board .pick > text",
  ".play-board .tag > text",
  ".play-pick > :is(.play-picked, .play-asset, .hint, .row, .play-refused)",
];

/** What of the play screen may hold text. */
export const NOT_PICTURE = [".play-hud", ".play-rail", ".vn-talk", ...SKETCH, ".play-sheet", "dialog", "#chapter", ".visually-hidden", ".bare-back"].join(", ");

/** Every visible text on the play screen that stands in the picture: its text and the element it is in. */
export const inPicture = (page) => page.evaluate((allowed) => {
  const out = [], walk = document.createTreeWalker(document.querySelector("#play"), NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || el.closest(allowed) || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    out.push(`${n.textContent.trim().slice(0, 60)} (in ${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${[...el.classList].join(".")})`);
  }
  return out;
}, NOT_PICTURE);
