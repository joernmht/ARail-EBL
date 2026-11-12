// The sounds of the game: a few short cues, made by the browser (Web Audio), no files. A choice
// clicks, a chapter chimes like a station's gong, a deadline running out beeps, a result is a
// little tune, and the little train on the line of missions has a horn. Quiet, never the only sign of anything, and off with one button (kept in the browser).

/** Where the pages keep whether the sound is on. */
export const SOUND_KEY = "arail.game.sound";

/**
 * The cues: notes as [frequency Hz, start s, length s], and the wave they are played with.
 * @type {Record<string, {wave: OscillatorType, notes: number[][]}>}
 */
export const CUES = {
  choose: { wave: "triangle", notes: [[660, 0, 0.06], [880, 0.05, 0.08]] },
  next: { wave: "sine", notes: [[520, 0, 0.05]] },
  chapter: { wave: "sine", notes: [[659, 0, 0.35], [523, 0.22, 0.5]] },
  hurry: { wave: "square", notes: [[740, 0, 0.07], [740, 0.14, 0.07]] },
  refuse: { wave: "sawtooth", notes: [[196, 0, 0.14]] },
  term: { wave: "sine", notes: [[988, 0, 0.05], [1319, 0.05, 0.09]] },
  star: { wave: "triangle", notes: [[1047, 0, 0.12], [1319, 0.1, 0.2]] },
  passed: { wave: "triangle", notes: [[523, 0, 0.14], [659, 0.13, 0.14], [784, 0.26, 0.14], [1047, 0.39, 0.4]] },
  failed: { wave: "triangle", notes: [[392, 0, 0.2], [330, 0.18, 0.2], [262, 0.36, 0.45]] },
  horn: { wave: "sawtooth", notes: [[311, 0, 0.5], [370, 0, 0.5], [311, 0.6, 0.28], [370, 0.6, 0.28]] },
};

/** How loud a cue is at most (0–1). */
export const VOLUME = 0.07;

/** Plays the cues. Without Web Audio, or switched off, it does nothing. */
export class Sound {
  /** @param {{on?: boolean}} [options] */
  constructor({ on = true } = {}) {
    this.on = !!on;
    /** @type {AudioContext | null} made with the first cue (browsers want a click first) */
    this.ctx = null;
  }

  /** Switch the sound on or off. */
  set(on) {
    this.on = !!on;
    if (!this.on) this.ctx?.suspend?.();
  }

  /**
   * Play a cue of CUES.
   * @param {string} name
   */
  play(name) {
    const cue = CUES[name], Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!this.on || !cue || !Ctx) return;
    try {
      this.ctx ??= new Ctx();
      if (this.ctx.state === "suspended") this.ctx.resume();
      const t0 = this.ctx.currentTime + 0.01;
      for (const [hz, at, len] of cue.notes) {
        const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
        osc.type = cue.wave;
        osc.frequency.value = hz;
        // a soft start and a fading end, so that nothing clicks
        gain.gain.setValueAtTime(0, t0 + at);
        gain.gain.linearRampToValueAtTime(VOLUME, t0 + at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start(t0 + at);
        osc.stop(t0 + at + len + 0.02);
      }
    } catch {
      /* no sound is not an error */
    }
  }
}
