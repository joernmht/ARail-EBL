/**
 * The maintenance story of the infrastructure (`{"type": "maintenance-story"}` in the layout's
 * `simulations`): a walkthrough on the layout to click through, step by step.
 *
 * 1. The station in normal service: the assets' rings show their condition (from their age).
 * 2. An old exit signal fails; 3. the signaller closes its track; 4. the repair team drives out from
 *    the maintenance base; 5. it repairs the signal 6. and exchanges it for a new one; 7. the track
 *    reopens.
 * 8. A planned renewal: a worn track is closed; 9. a construction train brings the road-rail
 *    excavator, new sleepers and rails; 10. the old track comes out; 11. the new track goes in and is
 *    tamped; 12. acceptance, the track reopens.
 *
 * Everything is scripted (core/story.js): the picture is a function of the step and of how far its
 * animation has run, so Back, Next and a jump to a step always show the same. A closed platform track
 * holds its trains (a "track-closure" disruption). The asset management game of an infrastructure
 * district (`{"type": "infrastructure"}`, engine.js) is not used.
 * @module arail/infra/story
 */
import { Story } from "../core/story.js";
import { CD, OVERLAY, grey, rgba, shade } from "../core/colors.js";
import { polylineAt, polylineLengths, polylineProject } from "../core/math.js";
import { boxFaces } from "../core/transit.js";
import { drawPerson } from "../sims/passengers.js";
import { ASSET_TYPES, gradeColour, healthOf } from "./catalog.js";
import { healthAtAge } from "./assets.js";
import { ASSET_OBJECTS } from "./objects.js";
import { STAFF_COLOURS, drawVan } from "./simulation.js";

/** Colours of the construction machines (yellow, as on most sites) and of the new track. */
const MACHINE = { body: CD.gelb, dark: grey(0.22), glass: "#9fb4c2" };
const BALLAST = "#8d8880", NEW_SLEEPER = "#d9d6cf", NEW_RAIL = "#6d7278";
/** Prototype metres between the fence posts of the site and their distance from the track. */
const FENCE = { step_m: 6, off_m: 3.4, height_m: 1.1 };
/** The construction train (prototype metres): a locomotive and two flat wagons, the excavator ahead. */
const TRAIN = { loco_m: 16, wagon_m: 15, gap_m: 1, digger_m: 9 };
const TRAIN_M = TRAIN.loco_m + 2 * TRAIN.wagon_m + 2 * TRAIN.gap_m;
/** What the signaller learns of a signal's fault, by the generation of its interlocking. */
const REPORTS = {
  mechanical: "Nothing reports it: the driver of the next train finds the signal dark and tells the signaller by radio",
  relay: "The relay interlocking shows the fault on the signaller's panel",
  electronic: "The electronic interlocking reports the fault on the signaller's screen at once",
  digital: "The digital interlocking reports the fault at once, with its cause",
};

/** First letter in lower case ("Exit signal N2" in the middle of a sentence). */
const lower = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const upper = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** 0…1 → a share of k from a to b (0 before a, 1 after b). */
const part = (k, a, b) => Math.min(1, Math.max(0, (k - a) / Math.max(1e-9, b - a)));

export class MaintenanceStory extends Story {
  /** What it draws stands on the table module, never on a street's bridge (core/elevation.js). */
  static elevation = "ground";
  static type = "maintenance-story";
  static label = "Maintenance story (infrastructure)";
  static description = "A walkthrough to click through: an old signal fails, its track is closed, the repair team drives out, repairs the signal and exchanges it; then a worn track is closed and renewed with a construction train.";
  static params = [
    { key: "signal", label: "Signal that fails", type: "object", objectType: "signal", default: "signal-n2", help: "An exit signal at a platform track; its track is closed for the repair." },
    { key: "renewal", label: "Track that is renewed", type: "object", objectType: "track", default: "track-g3" },
    { key: "year", label: "Year", type: "number", min: 1900, max: 2200, step: 1, default: 2026, help: "The year of the story: the age of the assets and their condition." },
  ];

  static STEPS = [
    {
      id: "normal", title: "The station in normal service", seconds: 0,
      text: "Trains stop at both platforms. The rings show the condition of the station's assets by their age, from grade 1 (Türkis: as new) to grade 5 (Rot: deficient). {Signal} at {track} was built in {built}.",
    },
    {
      id: "fault", title: "{Signal} fails", seconds: 3,
      text: "Its lamp goes dark. {report}; trains may leave {track} only on a written order, at caution.",
    },
    {
      id: "close", title: "The signaller closes {track}", seconds: 3,
      text: "So that the repair team can work safely, {track} is closed: no train stops there now. The other track at {platform} runs as usual.",
    },
    {
      id: "drive", title: "The repair team drives out", seconds: 16,
      text: "The maintenance dispatcher sends the emergency team on duty: its van leaves {base} and drives through the town to the station; the technicians walk the last bit to the signal.",
    },
    {
      id: "repair", title: "The team repairs the signal", seconds: 12,
      text: "The technicians find a burnt-out lamp and a corroded cable terminal, replace both and test the signal together with the signaller. It works again, but it is {age} years old.",
    },
    {
      id: "exchange", title: "…and exchanges the old signal", seconds: 12,
      text: "The signal was due for renewal anyway. With the track closed, the team takes the old signal head off and mounts a new LED one: grade 1, as new.",
    },
    {
      id: "reopen", title: "{Track} reopens", seconds: 14,
      text: "The team reports the work done and drives back to its base; the signaller reopens the track, and trains stop at {track} again.",
    },
    {
      id: "possession", title: "A planned renewal: {renewal} is closed", seconds: 3,
      text: "{Renewal} was built in {renewalBuilt} and is worn out. Its renewal was planned a year ahead; for the works the track is closed: {renewalEffect}.",
    },
    {
      id: "arrive", title: "The construction train arrives", seconds: 16,
      text: "A construction train brings a road-rail excavator, new sleepers and rails onto the closed track; the team fences the site off.",
    },
    {
      id: "remove", title: "The old track comes out", seconds: 14,
      text: "The excavator takes out the old rails and sleepers, section by section, and loads them onto the train.",
    },
    {
      id: "build", title: "The new track goes in", seconds: 16,
      text: "New concrete sleepers and rails are laid, the ballast is topped up, and a tamping machine lifts and aligns the track.",
    },
    {
      id: "done", title: "Acceptance: {renewal} reopens", seconds: 14,
      text: "The construction supervision checks the track and accepts the works; the construction train leaves and the track reopens: grade 1, as new.",
    },
  ];

  constructor(world, config = {}) {
    super(world, config);
    this._paths = new Map();
  }

  /* ---------------------------------------------------------------- the objects of the story */

  /** The signal that fails: the one of the settings, else the first signal of the layout. */
  signal() {
    const o = this.world.getObject(this.config.signal);
    return (o?.type === "signal" ? o : this.world.objects.find((x) => x.type === "signal" && x.geometry)) ?? null;
  }

  /** The platform track (dock) of a track name: `{area, dock}`, or null. */
  _dockOf(trackId) {
    if (!trackId) return null;
    for (const area of this.world.stopAreas()) {
      if (area.kind !== "rail") continue;
      const dock = area.docks.find((k) => k.track === trackId);
      if (dock) return { area, dock };
    }
    return null;
  }

  /** The platform track (dock) of the signal: the track nearest to it that stops at a platform. */
  dock() {
    const at = this.signal()?.anchorPoint?.();
    if (!at) return null;
    const tracks = this.world.objects.filter((o) => o.type === "track" && o.spec.track_id && o.geometry && this._dockOf(o.spec.track_id));
    tracks.sort((a, b) => polylineProject(a.geometry.points, at).distance - polylineProject(b.geometry.points, at).distance);
    return tracks.length ? { ...this._dockOf(tracks[0].spec.track_id), track: tracks[0] } : null;
  }

  /** The track that is renewed (the settings', else the oldest track). */
  renewal() {
    const o = this.world.getObject(this.config.renewal);
    if (o?.type === "track" && o.geometry) return o;
    const tracks = this.world.objects.filter((x) => x.type === "track" && x.geometry);
    return tracks.sort((a, b) => (+a.spec.built || 9999) - (+b.spec.built || 9999))[0] ?? null;
  }

  /** The platform track (dock) of the renewed track, or null for a track without a platform. */
  renewalDock() {
    return this._dockOf(this.renewal()?.spec.track_id);
  }

  /** The maintenance base the repair team leaves from. */
  base() {
    return this.world.objects.find((o) => o.type === "maintenance-base" && o.geometry) ?? null;
  }

  /** The steps with the names of the layout's objects in their texts. */
  get steps() {
    const sig = this.signal(), d = this.dock(), ren = this.renewal(), rd = this.renewalDock(), base = this.base();
    const year = +this.config.year || 2026;
    const name = (o, fallback) => o?.spec?.name || o?.name || fallback;
    const trackName = (o) => (o?.spec?.track_id ? `track ${o.spec.track_id}` : lower(name(o, "the track")));
    const track = d ? trackName(d.track) : "its track", renewal = ren ? trackName(ren) : "the track";
    const generation = this.world.getObject(sig?.spec.interlocking)?.spec.generation ?? "relay";
    const words = {
      Signal: name(sig, "The signal"), signal: lower(name(sig, "the signal")), track, Track: upper(track), platform: d ? d.area.owner.name : "the platform",
      base: name(base, "the maintenance base"), built: +sig?.spec.built || "an unknown year", age: sig?.spec.built ? year - sig.spec.built : "many",
      report: REPORTS[generation] ?? REPORTS.relay,
      renewal, Renewal: upper(renewal), renewalBuilt: +ren?.spec.built || "an unknown year",
      renewalEffect: rd ? `no train stops there, the other track at ${rd.area.owner.name} runs as usual` : "the trains run on the other track",
    };
    const fill = (s) => String(s ?? "").replace(/\{(\w+)\}/g, (m, k) => (k in words ? String(words[k]) : m));
    return super.steps.map((s) => ({ ...s, title: fill(s.title), text: fill(s.text) }));
  }

  /* ---------------------------------------------------------------- the scene */

  compose(index, k) {
    const at = (name) => this.constructor.STEPS.findIndex((s) => s.id === name);
    const i = index, sig = this.signal(), d = this.dock(), ren = this.renewal(), rd = this.renewalDock();
    const scene = { step: this.constructor.STEPS[index]?.id, k, focus: [], disruptions: [] };
    // the signal: old, failed, repaired, exchanged
    scene.signal = i < at("fault") ? { state: "old" }
      : i < at("repair") ? { state: "fault" }
        : i === at("repair") ? (k < 1 ? { state: "repairing", k } : { state: "repaired" })
          : i === at("exchange") ? { state: "exchanging", k }
            : { state: "new" };
    // the repair team's van: in the yard, out, at the station, back
    scene.van = i < at("drive") ? { phase: "yard" } : i === at("drive") ? { phase: "out", k } : i < at("reopen") ? { phase: "site" } : i === at("reopen") ? { phase: "back", k } : { phase: "yard" };
    scene.repairers = i === at("repair") || i === at("exchange") ? { walk: i === at("repair") ? part(k, 0, 0.3) : 1 } : null;
    if (d) {
      if (i === at("fault")) scene.disruptions.push({ id: "fault", type: "infra-fault", target: d.dock.id, params: { hold: false, text: `${sig?.spec.name || "Signal"}: fault, trains on a written order` } });
      if (i >= at("close") && i < at("reopen")) scene.disruptions.push({ id: "closed", type: "track-closure", target: d.dock.id });
    }
    if (i < at("possession") && sig) scene.focus.push(sig.id);
    // the renewal: closed, the site, old track out, new track in, tamped, accepted
    const r = { state: "old", fence: 0, removed: 0, laid: 0, tamped: 0, closed: false };
    if (i >= at("possession")) Object.assign(r, { state: "closed", closed: true });
    if (i === at("arrive")) r.fence = part(k, 0.6, 1);
    if (i >= at("remove")) Object.assign(r, { state: "removing", fence: 1 });
    if (i === at("remove")) r.removed = part(k, 0.12, 1);
    if (i >= at("build")) Object.assign(r, { state: "building", removed: 1 });
    if (i === at("build")) Object.assign(r, { laid: part(k, 0, 0.7), tamped: part(k, 0.7, 1) });
    if (i >= at("done")) Object.assign(r, { state: k < 0.3 ? "accepting" : "new", laid: 1, tamped: 1, fence: 1 - part(k, 0.3, 0.5), closed: k < 0.3 });
    scene.renewal = r;
    if (r.closed && rd) scene.disruptions.push({ id: "works", type: "track-closure", target: rd.dock.id });
    // the construction train (how far it has come from the track's far end to the works) and the excavator
    scene.train = i < at("arrive") ? null : i === at("arrive") ? { k: part(k, 0, 0.7) } : i < at("done") || k < 0.3 ? { k: 1 } : { k: 1 - part(k, 0.3, 1) };
    // the excavator: share of the works from their start (s0) to their end (s1), or "train": ahead of the train
    scene.digger = i === at("arrive") || (i === at("done") && k >= 0.3) ? { on: "train" }
      : i === at("remove") ? { u: 1 - r.removed, working: k >= 0.12 }
        : i === at("build") ? { u: k < 0.7 ? part(k, 0, 0.7) : 1, working: k < 0.7 }
          : i === at("done") ? { u: 1 } : null;
    scene.workers = i === at("arrive") ? k >= 0.6 : i === at("remove") || i === at("build") || (i === at("done") && k < 0.3);
    if (i >= at("possession") && ren) scene.focus.push(ren.id);
    return scene;
  }

  /* ---------------------------------------------------------------- what the assets show */

  /** The condition of an asset by its age (grade value 1…5.99), or null when its year is not known. */
  ageGrade(o) {
    const type = ASSET_TYPES[ASSET_OBJECTS[o?.type]];
    const built = +o?.spec?.built;
    if (!type || !built) return null;
    const h = healthAtAge(Math.max(0, (+this.config.year || 2026) - built), type.life_y);
    return 1 + 4.99 * (1 - h);
  }

  /**
   * The station's assets by type, scored by their condition (grade 1 as new … 6 deficient; a fault
   * is the worst): by their age, the story's signal and track as its step has them.
   */
  states() {
    const groups = new Map();
    for (const o of this.world.objects) {
      const id = ASSET_OBJECTS[o.type], type = ASSET_TYPES[id];
      if (!type) continue;
      const v = this.assetView(o.id) ?? { value: this.ageGrade(o), fault: false };
      if (v.value == null && !v.fault) continue;
      const g = groups.get(id) ?? groups.set(id, { id: `asset:${id}`, label: type.label, measure: "condition", items: [] }).get(id);
      g.items.push({ name: o.name, score: v.fault ? 0 : healthOf(v.value), text: v.fault ? "Fault" : `grade ${(Math.floor(v.value * 10 + 1e-9) / 10).toFixed(1)}`, key: `object:${o.id}` });
    }
    return [...groups.values()];
  }

  /**
   * The state of an asset for drawing (as the infrastructure simulation's `assetView`): its ring
   * colour by its age, the story's signal and track by their step.
   */
  assetView(id) {
    if (!this.active || !this.scene) return null;
    const o = this.world.getObject(id);
    if (!o || !ASSET_OBJECTS[o.type]) return null;
    const sc = this.scene, focus = sc.focus.includes(id);
    let value = this.ageGrade(o), fault = false, label = null;
    const grade = (v) => `grade ${(Math.floor(v * 10 + 1e-9) / 10).toFixed(1)}`;
    if (id === this.signal()?.id) {
      const st = sc.signal.state === "exchanging" && sc.signal.k >= 1 ? "new" : sc.signal.state, pct = `${Math.round(100 * (sc.signal.k ?? 0))} %`;
      if (st === "fault" || st === "repairing") fault = true;
      if (st === "new" || (st === "exchanging" && sc.signal.k >= 0.5)) value = 1;
      const what = st === "fault" ? "Fault: signal dark" : st === "repairing" ? `Repair · ${pct}` : st === "exchanging" ? `Exchange · ${pct}` : st === "new" ? `New · ${grade(1)}` : value == null ? "age not known" : `${grade(value)} · built ${o.spec.built}`;
      label = [o.spec.name || o.name, what];
    } else if (id === this.renewal()?.id) {
      const r = sc.renewal;
      if (r.state === "new") value = 1;
      const what = { old: value == null ? "age not known" : `${grade(value)} · built ${o.spec.built}`, closed: "Closed for its renewal", removing: `Old track out · ${Math.round(100 * r.removed)} %`, building: r.tamped > 0 ? `Tamping · ${Math.round(100 * r.tamped)} %` : `New track · ${Math.round(100 * r.laid)} %`, accepting: "Acceptance", new: `New · ${grade(1)}` }[r.state];
      label = [o.spec.name || o.name, what];
    }
    return {
      colour: fault ? OVERLAY.danger : gradeColour(value), style: value == null ? "age" : "fresh", fault, value, label: focus ? label : null,
      badge: fault ? "!" : value == null ? "?" : String(Math.min(5, Math.floor(value))), selected: focus, labelZ: o.type === "signal" ? 7 : 5,
    };
  }

  /* ---------------------------------------------------------------- the ways */

  /** The network of the streets, or null. */
  _net() {
    try {
      return this.world.network?.() ?? null;
    } catch {
      return null;
    }
  }

  /** Cached until the layout changes: `make()` once per key. */
  _cached(key, make) {
    const k = `${this.world.objectsVersion}:${this.world.map.version}:${key}`;
    if (!this._paths.has(k)) {
      this._paths.set(k, make());
      if (this._paths.size > 40) this._paths.delete(this._paths.keys().next().value);
    }
    return this._paths.get(k);
  }

  /**
   * The repair van's way from the base's yard over the streets to the street node nearest the signal
   * (`park`), and the technicians' walk from there to the signal (`walk`: on the sidewalks, through an
   * underpass to the platform where there is one; `hidden`: the parts out of sight).
   */
  vanPath() {
    const base = this.base(), sig = this.signal();
    const from = base?.entrances?.()[0]?.pos, to = sig?.anchorPoint?.();
    if (!from || !to) return null;
    return this._cached(`van:${base.id}:${sig.id}`, () => {
      const net = this._net();
      const a = net?.nearestNode(from, { mode: "car" }), b = net?.nearestNode(to, { mode: "car" });
      const route = a && b ? net.route(a, b, { mode: "car" }) : null;
      if (!(route?.points?.length >= 2)) return null;
      const points = [from, ...route.points], lengths = polylineLengths(points);
      let walk = null;
      try {
        walk = net.walk(b.pos, to);
      } catch {
        walk = null;
      }
      if (!(walk?.points?.length >= 2)) walk = { points: [b.pos, to], lengths: polylineLengths([b.pos, to]), hidden: [] };
      return { points, lengths, length: lengths[lengths.length - 1], park: b.pos, walk: { ...walk, length: walk.lengths[walk.lengths.length - 1] } };
    });
  }

  /**
   * The works on the renewed track: from `s0` to `s1` (mm along the track, from its first point); the
   * construction train waits beyond `s1`, towards the track's far end `L`.
   */
  works() {
    const ren = this.renewal();
    if (!ren) return null;
    const L = ren.geometry.total, train = ren.mm(TRAIN_M + 6);
    const s1 = Math.max(L * 0.5, L - train), s0 = Math.min(L * 0.06, s1 * 0.2);
    return { s0, s1, L, track: ren };
  }

  /* ---------------------------------------------------------------- where the vehicles are */

  /** A point on the renewed track at `s` (mm along it), heading towards its first point. */
  _onTrack(s) {
    const g = this.renewal().geometry, a = polylineAt(g.points, Math.min(g.total, Math.max(0, s)), g.lengths);
    return { point: a.point, dir: [-a.dir[0], -a.dir[1]], s };
  }

  /** The repair van: `{point, dir}` on its way or parked near the signal, or null in the base's yard. */
  vanAt() {
    const path = this.vanPath(), v = this.scene?.van;
    if (!path || !v || v.phase === "yard") return null;
    if (v.phase === "site") return { point: path.park, dir: polylineAt(path.points, path.length, path.lengths).dir };
    const at = polylineAt(path.points, (v.phase === "out" ? v.k : 1 - v.k) * path.length, path.lengths);
    return { point: at.point, dir: v.phase === "out" ? at.dir : [-at.dir[0], -at.dir[1]] };
  }

  /**
   * The construction train: its head (`head`, mm along the track; it comes in from the far end and
   * waits beyond the works) and its vehicles, or null while it is away or gone.
   */
  trainAt() {
    const t = this.scene?.train, w = this.works();
    if (!t || !w) return null;
    const m = w.track.mm(1), start = w.L, stop = w.s1 + m * (TRAIN.digger_m + 3);
    const head = start - (start - stop) * t.k;
    if (head >= w.L - 1e-6) return null;
    const cars = [];
    let s = head;
    for (const [kind, len] of [["loco", TRAIN.loco_m], ["wagon", TRAIN.wagon_m], ["wagon", TRAIN.wagon_m]]) {
      // the vehicles beyond the track's far end are out of sight
      if (s + (len / 2) * m <= w.L) cars.push({ kind, ...this._onTrack(s + (len / 2) * m), length_m: len, load: kind === "wagon" ? 1 - this.scene.renewal.laid : 0 });
      s += (len + TRAIN.gap_m) * m;
    }
    return { head, cars };
  }

  /** The road-rail excavator on the track (`{point, dir, s, working}`), or null. */
  diggerAt() {
    const d = this.scene?.digger, w = this.works();
    if (!d || !w) return null;
    const m = w.track.mm(1);
    if (d.on === "train") {
      const train = this.trainAt();
      return train ? { ...this._onTrack(train.head - (TRAIN.digger_m / 2 + 1) * m), working: false } : null;
    }
    return { ...this._onTrack(w.s0 + (w.s1 - w.s0) * d.u), working: !!d.working };
  }

  /** The tamping machine on the renewed track (`{point, dir, s}`), or null. */
  tamperAt() {
    const r = this.scene?.renewal, w = this.works();
    if (!r || !w || !(r.tamped > 0 && r.tamped < 1)) return null;
    return this._onTrack(w.s0 + (w.s1 - w.s0) * r.tamped);
  }

  /**
   * Where to look in the current step (the app's flyover follows it): `{at, distance, pitch_deg}`
   * (layout mm): the van on its way (from high above, over the houses), the train, the machines at
   * work, else the signal or the renewed track.
   */
  view() {
    const sc = this.scene;
    if (!sc) return null;
    const sig = this.signal(), w = this.works();
    const van = this.vanAt(), train = this.trainAt(), digger = this.diggerAt(), tamper = this.tamperAt();
    if (van && (sc.van.phase === "out" || sc.van.phase === "back")) return { at: van.point, distance: 1700, pitch_deg: 68 };
    // the signal from high above: the trains at the platforms beside it would hide it
    if (sig && sc.focus.includes(sig.id)) return { at: sig.anchorPoint(), distance: sc.repairers ? 800 : 1300, pitch_deg: 64 };
    if (tamper) return { at: tamper.point, distance: 1000, pitch_deg: 40 };
    if (digger?.working) return { at: digger.point, distance: 1000, pitch_deg: 40 };
    if (train?.cars.length) return { at: train.cars[0].point, distance: 1300, pitch_deg: 42 };
    return w ? { at: this._onTrack((w.s0 + w.s1) / 2).point, distance: 1700, pitch_deg: 45 } : null;
  }

  /* ---------------------------------------------------------------- drawing */

  draw(view) {
    if (!this.active || !this.scene) return;
    const sc = this.scene, t = view.time || 0;
    this._drawRenewal(view, sc);
    // the repair van on its way or at the station, the technicians at work
    const van = this.vanAt();
    if (van) drawVan(view, van.point, van.dir, true);
    if (sc.repairers) this._drawRepairers(view, sc, t);
    // the construction train, the excavator, the tamping machine and the team
    const train = this.trainAt();
    if (train) for (const c of train.cars) drawCar(view, c);
    const digger = this.diggerAt();
    if (digger) drawExcavator(view, digger.point, digger.dir, digger.working ? Math.sin(t * 1.4) * 0.9 : 0, t);
    const tamper = this.tamperAt();
    if (tamper) drawTamper(view, tamper.point, tamper.dir, t);
    if (sc.workers) this._drawWorkers(view, digger ?? train?.cars[0], t);
  }

  /** The base shows the repair van in its yard while it is not out (and two other vans). */
  drawBase(view, base) {
    if (!this.active || !this.scene) return;
    const s = base.slots?.();
    if (!s) return;
    const dir = [Math.cos(s.angle), Math.sin(s.angle)];
    const home = this.scene.van.phase === "yard";
    for (let i = home ? 0 : 1; i < 3; i++) drawVan(view, s.vans[i], dir, i === 0);
  }

  /** The technicians: one walks from the van to the signal at first, then both work there; the signal head is exchanged. */
  _drawRepairers(view, sc, t) {
    const path = this.vanPath(), sig = this.signal();
    if (!path || !sig) return;
    const at = sig.anchorPoint(), m = view.m(1), walk = path.walk;
    const k = sc.repairers.walk;
    const colours = { colour: STAFF_COLOURS.body, legs: STAFF_COLOURS.legs };
    if (k < 1) {
      const s = k * walk.length, p = polylineAt(walk.points, s, walk.lengths);
      // where the way is out of sight (in the underpass), nobody is drawn
      if (!walk.hidden?.some(([a, b]) => s > a && s < b)) drawPerson(view, p.point, { dir: p.dir, height: 1.8, ...colours, phase: t * 6, speed: 1.2 });
    } else drawPerson(view, [at[0] - 1.1 * m, at[1] + 0.6 * m], { dir: [1, 0], height: 1.8, ...colours, phase: t * 3, speed: 0.3 });
    if (k >= 1) drawPerson(view, [at[0] + 0.9 * m, at[1] - 0.8 * m], { dir: [1, 0], height: 1.75, ...colours, phase: t * 3, speed: 0.3 });
    if (sc.step === "exchange") drawSignalHead(view, at, sc.k, sig.mm(1));
  }

  /** The renewed track: closed, fenced, old track out, new track in. */
  _drawRenewal(view, sc) {
    const w = this.works();
    if (!w) return;
    const ren = w.track, r = sc.renewal, g = ren.geometry, { s0, s1 } = w;
    const st = this.assetView(ren.id);
    // the old track taken out (ballast only), the new one laid behind the excavator
    const removedFrom = r.state === "removing" ? s1 - (s1 - s0) * r.removed : r.removed >= 1 ? s0 : s1;
    const laidTo = r.laid > 0 ? s0 + (s1 - s0) * r.laid : s0;
    if (removedFrom < s1) {
      const bare = slice(g, Math.max(removedFrom, laidTo), s1);
      if (bare.length >= 2) view.ribbon(bare, view.m(3.4), { fill: BALLAST, order: 6.5 });
    }
    if (r.laid > 0) drawNewTrack(view, ren, s0, laidTo);
    // its state band once the renewal is the story (before, the track looks like the others): red with
    // crosses over the works while it is closed
    if (st && sc.focus.includes(ren.id)) drawBand(view, ren, g.points, r.closed ? { ...st, colour: OVERLAY.danger, fault: true } : st);
    if (r.closed) {
      const n = Math.max(2, Math.round((s1 - s0) / ren.mm(12)));
      for (let i = 0; i < n; i++) {
        const a = polylineAt(g.points, s0 + ((i + 0.5) * (s1 - s0)) / n, g.lengths), q = [-a.dir[1], a.dir[0]], hw = ren.mm(1.6), hu = ren.mm(1.2);
        const x = (sx, sy) => [a.point[0] + a.dir[0] * hu * sx + q[0] * hw * sy, a.point[1] + a.dir[1] * hu * sx + q[1] * hw * sy];
        view.line([x(-1, -1), x(1, 1)], { stroke: rgba(OVERLAY.danger, 0.85), width: 2, order: 41 });
        view.line([x(-1, 1), x(1, -1)], { stroke: rgba(OVERLAY.danger, 0.85), width: 2, order: 41 });
      }
    }
    if (r.fence > 0) drawFence(view, ren, s0, s0 + (s1 - s0) * r.fence);
  }

  /** Three workers along the works, beside the excavator (or the train). */
  _drawWorkers(view, near, t) {
    const w = this.works();
    if (!w || !near) return;
    const g = w.track.geometry, m = view.m(1);
    for (let i = 0; i < 3; i++) {
      const a = polylineAt(g.points, Math.min(g.total, Math.max(0, near.s + (i - 1) * 9 * m)), g.lengths);
      const q = [-a.dir[1], a.dir[0]], side = i === 1 ? -1 : 1;
      const p = [a.point[0] + q[0] * side * 2.6 * m, a.point[1] + q[1] * side * 2.6 * m];
      drawPerson(view, p, { dir: a.dir, height: 1.78, colour: STAFF_COLOURS.body, legs: STAFF_COLOURS.legs, phase: t * 3 + i, speed: 0.4 });
    }
  }
}

/* ---------------------------------------------------------------- drawing helpers */

/** The state of a track: a band along it (as the infrastructure simulation draws it). */
function drawBand(view, o, points, st) {
  view.ribbon(points, o.mm(2.4), { fill: rgba(st.colour, st.fault ? 0.24 : 0.38), order: 39, emissive: true });
  view.line(points, { stroke: st.fault ? OVERLAY.danger : st.style === "age" ? "rgba(150,156,166,0.95)" : st.colour, width: st.fault ? 3 : 1.8, dash: st.style === "age" ? [2, 5] : null, order: 40, emissive: true });
  if (st.label) {
    const L = polylineLengths(points);
    const mid = polylineAt(points, L[L.length - 1] * 0.35, L).point;
    view.label([mid[0], mid[1], o.mm(2)], st.label, { size: 10, anchor: "bottom", order: st.fault ? 6 : 2, optional: !st.fault && !st.selected, badge: st.badge, badgeColor: st.fault ? OVERLAY.danger : st.colour, background: st.fault ? OVERLAY.dangerLabel : OVERLAY.label });
  }
}

/** The part of a track's centre line from s0 to s1 (mm along it). */
function slice(g, s0, s1) {
  if (s1 <= s0) return [];
  const out = [polylineAt(g.points, s0, g.lengths).point];
  for (let i = 1; i < g.points.length - 1; i++) if (g.lengths[i] > s0 && g.lengths[i] < s1) out.push(g.points[i]);
  out.push(polylineAt(g.points, s1, g.lengths).point);
  return out;
}

/** New sleepers and rails from s0 to s1 (mm along the track). */
function drawNewTrack(view, track, s0, s1) {
  const g = track.geometry, m = track.mm(1);
  const bed = slice(g, s0, s1);
  if (bed.length < 2) return;
  view.ribbon(bed, m * 4, { fill: shade(BALLAST, 1.08), order: 6.5 });
  const big = view.pxPerMM?.(bed[0][0], bed[0][1]) * m * 0.65 > 2.5;
  if (big) {
    for (let s = s0 + m * 0.33; s < s1; s += m * 0.65) {
      const a = polylineAt(g.points, s, g.lengths), q = [-a.dir[1], a.dir[0]];
      const P = (u, v) => [a.point[0] + a.dir[0] * u * m + q[0] * v * m, a.point[1] + a.dir[1] * u * m + q[1] * v * m];
      view.polygon([P(-0.13, -1.3), P(0.13, -1.3), P(0.13, 1.3), P(-0.13, 1.3)], { fill: NEW_SLEEPER, order: 6.6 });
    }
  } else view.ribbon(bed, m * 2.6, { fill: rgba(NEW_SLEEPER, 0.85), order: 6.6 });
  for (const side of [-1, 1]) {
    const rail = bed.map((p, i) => {
      const a = bed[Math.max(0, i - 1)], b = bed[Math.min(bed.length - 1, i + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, q = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
      return [p[0] + q[0] * side * 0.72 * m, p[1] + q[1] * side * 0.72 * m];
    });
    view.ribbon(rail, m * 0.12, { fill: NEW_RAIL, order: 6.7 });
  }
}

/** Fence posts with red and white tape on both sides of the track, from s0 to s1 (mm along it). */
function drawFence(view, track, s0, s1) {
  const g = track.geometry, m = track.mm(1);
  for (const side of [-1, 1]) {
    const top = [];
    for (let s = s0; s <= s1 + 1e-6; s += FENCE.step_m * m) {
      const a = polylineAt(g.points, s, g.lengths), q = [-a.dir[1], a.dir[0]];
      const p = [a.point[0] + q[0] * side * FENCE.off_m * m, a.point[1] + q[1] * side * FENCE.off_m * m];
      view.faces(boxFaces([p[0] - a.dir[0] * 0.06 * m, p[1] - a.dir[1] * 0.06 * m], [p[0] + a.dir[0] * 0.06 * m, p[1] + a.dir[1] * 0.06 * m], 0.12 * m, 0, FENCE.height_m * m, { side: grey(0.9), top: CD.rot }), [p[0], p[1], 0.5 * m]);
      top.push(p);
    }
    if (top.length >= 2) {
      view.line(top, { stroke: CD.rot, width: 2, order: 8, z: FENCE.height_m * m });
      view.line(top, { stroke: "#ffffff", width: 2, dash: [5, 5], order: 8.1, z: FENCE.height_m * m });
    }
  }
}

/** The old signal head comes off and the new one goes on (k 0…1): a head going down and up. */
function drawSignalHead(view, at, k, m) {
  const up = k < 0.5 ? 1 - part(k, 0.1, 0.45) : part(k, 0.55, 0.9);
  const z = (1.2 + 4.2 * up) * m;
  const colour = k < 0.5 ? grey(0.25) : grey(0.12);
  view.faces(boxFaces([at[0] - 0.18 * m, at[1]], [at[0] + 0.18 * m, at[1]], 0.64 * m, z, z + 1.5 * m, { side: colour, top: colour }), [at[0], at[1], z]);
  if (k >= 0.9) view.glow([at[0], at[1], z + 1 * m], 0.8 * m, "#3ed37a", 0.9);
}

/** A vehicle of the construction train: the yellow locomotive, or a flat wagon with new sleepers and rails (`load` 0…1). */
function drawCar(view, car) {
  const { point: at, dir, length_m: len } = car;
  if (!view.inImage(at[0], at[1], 0, 120)) return;
  const m = view.m(1), P = (a) => [at[0] + dir[0] * a * m, at[1] + dir[1] * a * m];
  if (car.kind === "loco") {
    view.faces([
      ...boxFaces(P(-len / 2), P(len / 2), 2.9 * m, 0.9 * m, 3.4 * m, { side: MACHINE.body, top: shade(MACHINE.body, 0.9), end: MACHINE.glass }),
      ...boxFaces(P(-len / 2 + 2), P(-len / 2 + 5), 3 * m, 3.4 * m, 4.2 * m, { side: MACHINE.glass, top: MACHINE.body }),
    ], [at[0], at[1], 2 * m]);
    return;
  }
  const faces = [...boxFaces(P(-len / 2), P(len / 2), 2.8 * m, 0.9 * m, 1.3 * m, { side: grey(0.35), top: grey(0.45) })];
  if (car.load > 0) faces.push(...boxFaces(P(-len / 2 + 1), P(-len / 2 + 1 + (len - 2) * car.load), 2.5 * m, 1.3 * m, 2.2 * m, { side: shade(NEW_SLEEPER, 0.9), top: NEW_SLEEPER }));
  view.faces(faces, [at[0], at[1], 1.4 * m]);
}

/** A road-rail excavator on the track: undercarriage, the turning body with its cab, the boom (swing in radians). */
function drawExcavator(view, at, dir, swing, t) {
  if (!view.inImage(at[0], at[1], 0, 80)) return;
  const m = view.m(1), l = Math.hypot(dir[0], dir[1]) || 1, u = [dir[0] / l, dir[1] / l];
  const c = Math.cos(swing), s = Math.sin(swing), w = [u[0] * c - u[1] * s, u[0] * s + u[1] * c];
  const P = (v, a) => [at[0] + v[0] * a * m, at[1] + v[1] * a * m];
  view.faces([
    ...boxFaces(P(u, -3), P(u, 3), 2.6 * m, 0.4 * m, 1.3 * m, { side: MACHINE.dark, top: MACHINE.dark }),
    ...boxFaces(P(w, -2.6), P(w, 1.4), 2.6 * m, 1.3 * m, 2.6 * m, { side: MACHINE.body, top: shade(MACHINE.body, 0.92) }),
    ...boxFaces(P(w, 0.2), P(w, 1.6), 1.1 * m, 2.6 * m, 3.9 * m, { side: MACHINE.glass, top: MACHINE.body }),
  ], [at[0], at[1], 1.6 * m]);
  // the boom: up from the body, out to the bucket (a plank in the vertical plane of the body)
  const q = [-w[1] * 0.3 * m, w[0] * 0.3 * m], dig = 0.5 + 0.5 * Math.sin(t * 1.8);
  const p0 = P(w, 1.5), p1 = P(w, 4.6), p2 = P(w, 6.6);
  const plank = (a, za, b, zb) => ({ pts: [[a[0] - q[0], a[1] - q[1], za], [b[0] - q[0], b[1] - q[1], zb], [b[0] + q[0], b[1] + q[1], zb], [a[0] + q[0], a[1] + q[1], za]], normal: [0, 0, 1], color: MACHINE.body });
  view.faces([plank(p0, 2.4 * m, p1, 4.6 * m), plank(p1, 4.6 * m, p2, (0.6 + 1.6 * dig) * m)], [p1[0], p1[1], 3 * m]);
}

/** A tamping machine (18 m, yellow) on the track. */
function drawTamper(view, at, dir, t) {
  if (!view.inImage(at[0], at[1], 0, 80)) return;
  const m = view.m(1);
  const P = (a) => [at[0] + dir[0] * a * m, at[1] + dir[1] * a * m];
  const bounce = 0.05 * Math.sin(t * 9) * m;
  view.faces([
    ...boxFaces(P(-9), P(9), 2.9 * m, 0.6 * m + bounce, 3.6 * m + bounce, { side: MACHINE.body, top: shade(MACHINE.body, 0.9), end: MACHINE.glass }),
    ...boxFaces(P(-3), P(3), 3 * m, 0.2 * m, 0.7 * m, { side: MACHINE.dark, top: MACHINE.dark }),
  ], [at[0], at[1], 2 * m]);
}
