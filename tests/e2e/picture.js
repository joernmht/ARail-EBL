// What the game's pages may show on their picture. The rule: no information stands in a box on the
// picture; it is in the line at the top (the semi-transparent header) or in the rail at the side, and
// what is about something in the picture pulses on it. The band of who speaks, the game's own
// picture (the control desk) and dialogs are not the picture; the phase's name over the whole screen
// is a title, for a moment. Used by the play page's tests (play.spec.js, table.spec.js).

/** What of the play screen may hold text. */
export const NOT_PICTURE = ".play-hud, .play-rail, .vn-talk, .play-sketch, dialog, #chapter, .visually-hidden, .bare-back";

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
