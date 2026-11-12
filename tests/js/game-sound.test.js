// The sounds of the game (web/game/sound.js): cues as notes; without Web Audio, or off, nothing happens.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CUES, Sound, VOLUME } from "../../web/game/sound.js";

test("cues: short, quiet, notes that can be heard", () => {
  assert.ok(VOLUME > 0 && VOLUME <= 0.1);
  for (const [name, cue] of Object.entries(CUES)) {
    assert.ok(["sine", "triangle", "square", "sawtooth"].includes(cue.wave), name);
    assert.ok(cue.notes.length >= 1, name);
    for (const [hz, at, len] of cue.notes) {
      assert.ok(hz >= 100 && hz <= 2000, `${name}: ${hz} Hz`);
      assert.ok(at >= 0 && len > 0 && at + len <= 1.2, `${name}: within a second or so`);
    }
  }
});

test("sound: without Web Audio it does nothing; switched off it makes no context", () => {
  const s = new Sound({ on: true });
  s.play("choose");
  assert.equal(s.ctx, null, "no AudioContext in Node");
  let made = 0;
  globalThis.AudioContext = class {
    constructor() { made++; this.currentTime = 0; this.state = "running"; this.destination = {}; }
    createOscillator() { return { frequency: {}, connect: (x) => x, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x) => x }; }
    suspend() {}
    resume() {}
  };
  try {
    const off = new Sound({ on: false });
    off.play("choose");
    assert.equal(made, 0);
    off.set(true);
    off.play("choose");
    off.play("no-such-cue");
    off.play("passed");
    assert.equal(made, 1, "one context for all cues");
  } finally {
    delete globalThis.AudioContext;
  }
});
