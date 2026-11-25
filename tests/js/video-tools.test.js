// The video tools' logic that needs no browser (tools/video/story-box.mjs): what the terminal box of
// a short video shows at a frame and in which frames it is drawn (typewriter.mjs, which stops at once
// without lines), and which captured picture each frame of a recorded page shows (screen.mjs). See
// docs/short-videos.md.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BOX, ERASE_CPS, blink, boxFrames, resample, rowsAt, tooLong } from "../../tools/video/story-box.mjs";
import { ROOT } from "./helpers.js";

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
  // while "missions" is backspaced it keeps the colour it had just before: lighter, as a newer
  // line ("What if all that…", row 1) came after it; neither bright nor the question's orange
  assert.equal(at(cues, 160)[2].text, "missions");
  assert.equal(at(cues, 159)[2].color, BOX.kept);
  assert.equal(at(cues, 160)[2].color, at(cues, 159)[2].color);
  // a line that was the newest when the next of its row begins stays bright while it goes
  const two = [{ text: "houses", start: 0 }, { text: "trees", start: 20 }];
  assert.equal(at(two, 19)[2].color, BOX.text);
  assert.equal(at(two, 20)[2].text, "houses");
  assert.equal(at(two, 20)[2].color, BOX.text);
});

test("video box: a line longer than the box is found", () => {
  assert.equal(tooLong([{ text: "short", start: 0 }]), null);
  const long = { text: "x".repeat(BOX.columns + 1), start: 0 };
  assert.equal(tooLong([{ text: "short", start: 0 }, long]), long);
  assert.equal(tooLong([{ text: "x".repeat(BOX.columns), start: 0 }]), null);
});

test("video box: drawn from the first line to the end of the video; without lines, nothing to draw", () => {
  const cues = [{ text: "A real lab", start: 12, end: 40 }, { text: "But what if", start: 30, end: 90 }];
  assert.deepEqual(boxFrames(cues, 300), { first: 12, last: 300 });
  assert.deepEqual(boxFrames(cues), { first: 12, last: 90 }, "without the video's length: to the last line's end");
  assert.equal(boxFrames([], 300), null);
});

test("typewriter: cues without lines stop it at once, with a message; no frame is left to lay over the video", () => {
  const dir = mkdtempSync(join(tmpdir(), "arail-typewriter-"));
  try {
    writeFileSync(join(dir, "cues.json"), JSON.stringify({ size: [1280, 720], fps: 30, cps: 20, frames: 300, cues: [] }));
    mkdirSync(join(dir, "text"));
    writeFileSync(join(dir, "text", "f0000.png"), "an old frame");
    const p = spawnSync(process.execPath, [join(ROOT, "tools/video/typewriter.mjs"), join(dir, "cues.json"), join(dir, "text")], { encoding: "utf8" });
    assert.equal(p.status, 1, p.stdout + p.stderr);
    assert.match(p.stderr, /no lines to type/);
    assert.doesNotMatch(p.stdout, /NaN|frames with the box/);
    assert.deepEqual(readdirSync(join(dir, "text")), [], "the old frames removed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("screen recording: each frame shows the last picture taken before its time", () => {
  // pictures at 0, 0.05, 0.31 and 0.5 s; frames at 0, 0.1, 0.2 … 0.6 s
  assert.deepEqual(resample([0, 0.05, 0.31, 0.5], 0, 7, 10), [0, 1, 1, 1, 2, 3, 3]);
  // a page that did not change for a while holds its picture; the first picture before t0 is used
  assert.deepEqual(resample([-1, 2], 0, 3, 1), [0, 0, 1]);
  assert.deepEqual(resample([0], 0, 3, 30), [0, 0, 0]);
});
