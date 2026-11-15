// The video tools' logic that needs no browser (tools/video/story-box.mjs): what the terminal box of
// a short video shows at a frame (typewriter.mjs), and which captured picture each frame of a
// recorded page shows (screen.mjs). See docs/short-videos.md.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BOX, ERASE_CPS, blink, resample, rowsAt, tooLong } from "../../tools/video/story-box.mjs";

const fps = 10, cps = 10;
const at = (cues, f) => rowsAt(cues, f, { fps, cps });

test("video box: a line is typed letter by letter into its row, the newest with the cursor", () => {
  const cues = [{ text: "A real lab", start: 0, row: 1 }];
  assert.deepEqual(at(cues, 0).map((r) => r.text), ["", "", ""]);
  assert.equal(at(cues, 6)[0].text, "A real");
  assert.equal(at(cues, 5)[0].cursor, true, "steady while typing");
  assert.equal(at(cues, 10)[0].text, "A real lab");
  assert.equal(at(cues, 10)[0].color, BOX.text);
  // typed: the cursor blinks
  assert.equal(at(cues, 10)[0].cursor, blink(1));
  assert.equal(at(cues, 15)[0].cursor, blink(1.5));
  assert.notEqual(blink(1), blink(1.5));
  // no line yet: nothing, no cursor
  assert.ok(at(cues, -1).every((r) => r.text === "" && r.cursor === false));
});

test("video box: a line stays until the next of its row backspaces it; older rows are lighter", () => {
  const cues = [
    { text: "A real lab", start: 0, row: 1 },
    { text: "But what if", start: 20, row: 2 },
    { text: "houses", start: 40 }, // row 3 by default
    { text: "trees", start: 60 },
  ];
  const f = 55;
  const rows = at(cues, f);
  assert.deepEqual(rows.map((r) => r.text), ["A real lab", "But what if", "houses"]);
  assert.deepEqual(rows.map((r) => r.color), [BOX.kept, BOX.kept, BOX.text]);
  assert.deepEqual(rows.map((r) => r.cursor === false), [true, true, false], "only the newest line has the cursor");
  // the next line of row 3: "houses" backspaced at ERASE_CPS, then "trees" typed
  const wipe = Math.ceil(("houses".length / ERASE_CPS) * fps);
  assert.ok(at(cues, 60)[2].text.length <= "houses".length && "houses".startsWith(at(cues, 60)[2].text));
  assert.equal(at(cues, 60 + wipe)[2].text, "");
  assert.equal(at(cues, 60 + wipe + 30)[2].text, "trees");
  assert.deepEqual(at(cues, 99).slice(0, 2).map((r) => r.text), ["A real lab", "But what if"], "rows 1 and 2 stay");
});

test("video box: the end types the rows anew, the question in the accent colour", () => {
  const cues = [
    { text: "A real lab", start: 0, row: 1 },
    { text: "But what if", start: 20, row: 2 },
    { text: "missions", start: 40 },
    { text: "What if all that is possible?", start: 100, row: 1 },
    { text: "Would your work still be the same?", start: 160, style: "accent" },
  ];
  const rows = at(cues, 300);
  assert.deepEqual(rows.map((r) => r.text), ["What if all that is possible?", "But what if", "Would your work still be the same?"]);
  assert.equal(rows[2].color, BOX.accent);
  assert.equal(rows[0].color, BOX.kept);
  // while "missions" is backspaced it keeps its own colour, not the question's orange
  assert.equal(at(cues, 160)[2].text, "missions");
  assert.equal(at(cues, 160)[2].color, BOX.text);
});

test("video box: a line longer than the box is found", () => {
  assert.equal(tooLong([{ text: "short", start: 0 }]), null);
  const long = { text: "x".repeat(BOX.columns + 1), start: 0 };
  assert.equal(tooLong([{ text: "short", start: 0 }, long]), long);
  assert.equal(tooLong([{ text: "x".repeat(BOX.columns), start: 0 }]), null);
});

test("screen recording: each frame shows the last picture taken before its time", () => {
  // pictures at 0, 0.05, 0.31 and 0.5 s; frames at 0, 0.1, 0.2 … 0.6 s
  assert.deepEqual(resample([0, 0.05, 0.31, 0.5], 0, 7, 10), [0, 1, 1, 1, 2, 3, 3]);
  // a page that did not change for a while holds its picture; the first picture before t0 is used
  assert.deepEqual(resample([-1, 2], 0, 3, 1), [0, 0, 1]);
  assert.deepEqual(resample([0], 0, 3, 30), [0, 0, 0]);
});
