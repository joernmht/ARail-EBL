// Undo and redo in the builder: the layout after each change (its JSON text), at most `limit` of
// them. No DOM here: tested in Node.

export class History {
  /** @param {number} [limit] how many changes can be undone */
  constructor(limit = 200) {
    this.limit = limit;
    this.states = [];
    this.at = -1;
  }

  /** Start again from a state (a layout just opened). */
  reset(state) {
    this.states = [state];
    this.at = 0;
  }

  /** The state now. */
  get current() {
    return this.states[this.at] ?? null;
  }

  /** After a change: its state (the same as now: nothing to undo). Returns true if it was new. */
  push(state) {
    if (state === this.current) return false;
    this.states = this.states.slice(0, this.at + 1);
    this.states.push(state);
    if (this.states.length > this.limit + 1) this.states.shift();
    this.at = this.states.length - 1;
    return true;
  }

  get canUndo() {
    return this.at > 0;
  }

  get canRedo() {
    return this.at < this.states.length - 1;
  }

  /** The state before the last change, or null. */
  undo() {
    if (!this.canUndo) return null;
    return this.states[--this.at];
  }

  /** The state of the change undone last, or null. */
  redo() {
    if (!this.canRedo) return null;
    return this.states[++this.at];
  }
}
