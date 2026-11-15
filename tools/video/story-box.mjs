// The logic of the video tools that needs no browser, so it can be tested in Node
// (tests/js/video-tools.test.js): what the terminal box of a short video shows at a frame
// (typewriter.mjs), and which captured picture each frame of a recorded page shows (screen.mjs).
// See docs/short-videos.md.

/** The design of the box: its rows, its width in characters, the colours of its lines. */
export const BOX = { rows: 3, columns: 56, text: "#e3f7f8", kept: "#9fbccb", accent: "#f0922e", prompt: "#36b8bf" };

/** The old line of a row is backspaced this fast (characters a second) before the new one is typed. */
export const ERASE_CPS = 60;

/** The cursor blinks 1.1 times a second: shown (true) or "off". */
export const blink = (t) => (Math.floor(t * 2.2) % 2 === 0 ? true : "off");

/**
 * What the box shows at frame f: in each row its latest line, the line before it backspaced first;
 * the newest line of all bright (or orange, `style: "accent"`) with the cursor, the older rows lighter.
 * @param {{text: string, start: number, row?: number, style?: string}[]} cues the lines (frames)
 * @param {number} f the frame
 * @param {{fps: number, cps: number, box?: typeof BOX}} o frames and letters a second
 * @returns {{text: string, color: string, cursor: boolean | "off"}[]} the rows, top to bottom
 */
export function rowsAt(cues, f, { fps, cps, box = BOX }) {
  const rowOf = (c) => (c.row ?? box.rows) - 1;
  const color = (c) => (c.style === "accent" ? box.accent : box.text);
  const begun = cues.filter((c) => c.start <= f);
  const newest = begun.reduce((a, c) => (!a || c.start >= a.start ? c : a), null);
  const out = [];
  for (let r = 0; r < box.rows; r++) {
    const mine = begun.filter((c) => rowOf(c) === r);
    const cur = mine.at(-1);
    if (!cur) {
      out.push({ text: "", color: box.text, cursor: false });
      continue;
    }
    const prev = mine.at(-2), t = (f - cur.start) / fps;
    const wipe = prev ? prev.text.length / ERASE_CPS : 0;
    let text, busy, erasing = false;
    if (t < wipe) {
      text = prev.text.slice(0, Math.max(0, prev.text.length - Math.floor(t * ERASE_CPS)));
      busy = erasing = true;
    } else {
      const typed = Math.min(cur.text.length, Math.floor((t - wipe) * cps));
      text = cur.text.slice(0, typed);
      busy = typed < cur.text.length;
    }
    const top = cur === newest;
    // a line being backspaced keeps its own colour; the new one has its colour once it is typed
    out.push({ text, color: top ? color(erasing ? prev : cur) : box.kept, cursor: top ? (busy ? true : blink(t)) : false });
  }
  return out;
}

/** The first line longer than the box, or null. */
export const tooLong = (cues, box = BOX) => cues.find((c) => c.text.length > box.columns) ?? null;

/**
 * Which captured picture each output frame shows: the last one taken before the frame's time.
 * @param {number[]} times when the pictures were taken (s, in order)
 * @param {number} t0 the time of frame 0 (s)
 * @param {number} count frames to make
 * @param {number} fps frames a second
 * @returns {number[]} for each frame, the index of its picture
 */
export function resample(times, t0, count, fps) {
  const out = [];
  let k = 0;
  for (let i = 0; i < count; i++) {
    const t = t0 + i / fps;
    while (k + 1 < times.length && times[k + 1] <= t) k++;
    out.push(k);
  }
  return out;
}
