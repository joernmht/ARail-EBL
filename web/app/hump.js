// Hump panel: the panel of the example "Hump a train" (cases.js, HumpCase). The hump master breaks up
// one train over the hump yard of the layout (arail/hump/object.js, its task): pushes it slower or
// faster, stops it before the crest and pushes on, and follows every cut from the hump into its
// classification track. Pushed too fast, the cuts follow each other too closely: a switch cannot be
// thrown between two of them (a cut in the wrong track), the retarders cannot part them (impacts too
// hard). A cut is chosen in the list or on the stage (a tap on its wagons in the flyover, Enter at the
// cross in the middle); it is outlined there. Light in text: what the example is about is said in the list.
import { pickBoxes, TASK_PUSH } from "../arail/index.js";
import { h, morph, mount, toast } from "./ui.js";

/** The rolling classes of the cuts, as the band on their wagons shows them. */
const CLASSES = { good: "good runner", medium: "medium runner", bad: "bad runner" };
/** A wagon type as it is written on the wagon ("eanos" → "Eanos"). */
const typeName = (t) => t.charAt(0).toUpperCase() + t.slice(1);
/** The number of a cut in its train ("T1/4" → "4"). */
const cutNumber = (id) => id.split("/").pop();

/** The layout's hump yard (the object), or null. */
export function humpOf(world) {
  return world?.objects.find((o) => o.type === "hump-yard") ?? null;
}

export class HumpPanel {
  /**
   * @param {object} app the ARail app (app.js)
   * @param {{owner?: import("./cases.js").Case}} [options] owner: the case it is the panel of (its task runs once it is started)
   */
  constructor(app, { owner = null } = {}) {
    this.app = app;
    this.owner = owner;
    this.el = null;
  }

  /** The layout's hump yard, or null. */
  get yard() {
    return humpOf(this.app.world);
  }

  /** Draw the panel anew. @param {HTMLElement} el the case's place */
  render(el) {
    this.el = { root: el, head: h("div", { class: "section" }), tracks: h("div", { class: "section" }), cuts: h("div", { class: "section" }) };
    mount(el, this.el.head, this.el.cuts, this.el.tracks);
    this.update();
  }

  /** Refresh in place (every 400 ms while shown, and after every action). */
  update() {
    const e = this.el;
    if (!e?.root.isConnected) return;
    const y = this.yard, st = y?.taskState();
    if (!st) {
      // shown, not started: what Start will do
      morph(e.head, h("p", { class: "hint" }, "Start puts a train of its own on the push track of the empty yard. You push it over the hump."));
      morph(e.cuts);
      morph(e.tracks);
      return;
    }
    morph(e.head, ...this._head(st));
    morph(e.cuts, h("h2", {}, "The train"), h("p", { class: "hint" }, "Its cuts from the hump end. Choose one to follow it on the stage."),
      h("ul", { class: "hump-cuts", id: "humpCuts" }, st.cuts.map((c) => h("li", {}, this._cut(c, y.chosen === c.id)))));
    morph(e.tracks, ...this._tracks(y, st));
  }

  /**
   * The pushing speed, Slower, Faster, Stop (or Push on), Restart, and how the train goes. The three
   * push controls are off once every cut is released, and once the task is over with cuts still on
   * the hump (the hump blocked: nothing can be pushed on).
   */
  _head(st) {
    const v = st.push_mps, humped = st.cuts.every((c) => c.state !== "waiting" && c.state !== "pushed"), off = humped || st.finished;
    return [
      h("div", { class: "row hump-push", role: "group", "aria-label": "Pushing speed" },
        h("button", { class: "btn", type: "button", id: "humpSlower", disabled: off || v <= TASK_PUSH.min_mps + 1e-9, onclick: () => this.push(-1) }, "Slower"),
        h("output", { class: "hump-speed", id: "humpSpeed", "aria-live": "off" }, st.stopped ? "Stopped" : `${v.toFixed(1)} m/s`),
        h("button", { class: "btn", type: "button", id: "humpFaster", disabled: off || v >= TASK_PUSH.max_mps - 1e-9, onclick: () => this.push(1) }, "Faster"),
        h("button", { class: `btn${st.stopped ? " primary" : ""}`, type: "button", id: "humpStop", disabled: off, onclick: () => this.stop(!st.stopped) }, st.stopped ? "Push on" : "Stop"),
        h("button", { class: "btn", type: "button", id: "humpRestart", title: "The same train again, in empty tracks", onclick: () => this.restart() }, "Restart")),
      h("p", { class: `hump-status${st.finished && (st.misrouted || st.hard || st.derailed || st.short || st.notHumped) ? " bad" : ""}`, id: "humpStatus", role: "status" }, this._status(st, humped)),
    ];
  }

  /** How the train goes, in one line; at its end, how it went. */
  _status(st, humped) {
    if (st.finished) {
      const bad = [st.misrouted ? `In the wrong track: ${st.misrouted}` : null, st.hard ? `Impacts too hard: ${st.hard}` : null,
        st.derailed ? `Derailed: ${st.derailed}` : null, st.short ? `Short of their track: ${st.short}` : null].filter(Boolean);
      // the yard backed up to the crest: the rest of the train cannot be humped
      if (st.notHumped) return ["Hump blocked: the cuts reach back to the crest", `Not humped: ${st.notHumped}`, ...bad].join(" · ");
      return ["Train broken up", ...(bad.length ? bad : ["every cut in its track"])].join(" · ");
    }
    if (humped) return "Over the hump: the last cuts roll into their tracks";
    if (st.stopped) return "Stopped before the crest";
    return `Pushing at ${(st.push_mps * 3.6).toFixed(1)} km/h`;
  }

  /** A cut as a button: its number, wagons, track and rolling class; where it is now. */
  _cut(c, chosen) {
    const where = c.state === "waiting" ? "waiting" : c.state === "pushed" ? "on the hump"
      : c.state === "rolling" ? `rolling at ${(c.v_mps * 3.6).toFixed(0)} km/h`
        : c.derailed ? "derailed at a switch" : c.stood ? `in track ${c.stood}` : "short of its track";
    const bad = [c.misrouted ? "wrong track" : null, c.hard ? "impact too hard" : null].filter(Boolean);
    return h("button", {
      type: "button", class: `hump-cut run-${c.cls}${bad.length ? " problem" : ""}`, id: `hump-cut-${cutNumber(c.id)}`, "aria-pressed": chosen ? "true" : "false",
      onclick: () => this.choose(chosen ? null : c.id),
    },
    h("span", { class: "hump-cut-head" }, h("strong", {}, `Cut ${cutNumber(c.id)}`), ` → track ${c.track}`),
    h("span", { class: "meta" }, h("span", { translate: "no" }, c.wagons.map(typeName).join(", ")), ` · ${CLASSES[c.cls]}${c.careful ? " · with care" : ""}`),
    h("span", { class: "hump-cut-state" }, where, bad.length ? h("span", { class: "hump-bad" }, ` · ${bad.join(", ")}`) : null));
  }

  /** The classification tracks: the wagons for each, those in it, the room left. */
  _tracks(y, st) {
    const contents = y.sim.results().tracks;
    return [
      h("h2", {}, "Classification tracks"),
      h("table", { class: "hump-tracks" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Track"), h("th", { scope: "col" }, "Wagons in it"), h("th", { scope: "col" }, "Room left"))),
        h("tbody", {}, y.yard.tracks.map((t) => {
          const due = st.cuts.filter((c) => c.track === t.name).reduce((n, c) => n + c.wagons.length, 0), k = contents.find((x) => x.name === t.name);
          return h("tr", {}, h("th", { scope: "row" }, t.name), h("td", {}, `${k?.wagons ?? 0} of ${due}`), h("td", {}, `${Math.round(k?.free_m ?? t.length_m)} m`));
        }))),
    ];
  }

  /** Push slower (-1) or faster (+1), by one step; a stopped train goes on. */
  push(dir) {
    const y = this.yard, st = y?.taskState();
    if (!st) return;
    y.setPush({ push_mps: st.push_mps + dir * TASK_PUSH.step_mps, stopped: false });
    this.update();
  }

  /** Stop the train before the crest (true), or push on (false). */
  stop(stopped) {
    this.yard?.setPush({ stopped });
    this.update();
    // the button changed its text: it keeps the focus
    document.getElementById("humpStop")?.focus();
  }

  /** The same train again, in empty tracks, at the speed chosen. */
  restart() {
    const y = this.yard, t = y?.task;
    if (!t) return;
    y.startTask({ wagons: t.wagons, seed: t.seed, push_mps: t.push_mps });
    this.update();
  }

  /** Choose a cut (null: none): it is outlined on the stage. */
  choose(id) {
    this.yard?.choose(id);
    this.update();
  }

  /**
   * A tap on the stage (or Enter at the cross in the middle of the flyover): the cut whose wagon is
   * there is chosen, or none.
   * @param {[number, number]} p canvas pixels
   * @param {{keyboard?: boolean}} [options]
   * @returns {boolean} whether a cut was chosen
   */
  pickAt([u, v], { keyboard = false } = {}) {
    const y = this.yard, view = this.app.lastView;
    if (!y?.task || !view) return false;
    const id = pickBoxes(view, y.boxes(), u, v);
    if (!id) {
      if (keyboard) toast("No wagon at the cross: move the view with the arrow keys.");
      return false;
    }
    this.choose(id);
    document.getElementById(`hump-cut-${cutNumber(id)}`)?.scrollIntoView?.({ block: "nearest" });
    return true;
  }
}
