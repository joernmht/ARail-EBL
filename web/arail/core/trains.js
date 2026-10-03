/**
 * Real (model) trains reported by a control system.
 *
 * A feed (see `feeds/`) delivers messages of the ARail feed protocol (docs/control-system-interface.md).
 * The registry keeps the latest position of every train, estimates speeds, detects when a
 * train stands at a platform and tells the services, so passengers board the real train.
 * While a feed is active, rail docks are controlled by it instead of the timetable.
 *
 * Positions can be given as
 * - layout coordinates: `x_mm`, `y_mm` (and optionally `heading_deg`),
 * - track + offset: `track` (a track object's `track_id`) and `offset_mm` along it,
 * - track only (occupancy): `track` matching a platform's `track_left`/`track_right`.
 * @module arail/core/trains
 */
import { toRad } from "./math.js";
import { OVERLAY, PALETTE, shade } from "./colors.js";

export const FEED_PROTOCOL = "arail-feed/1";

/**
 * Parse and validate one feed message (object or JSON string).
 * @returns {{type: string} & object}
 */
export function parseFeedMessage(input) {
  const msg = typeof input === "string" ? JSON.parse(input) : input;
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") throw new Error("Feed message needs a string `type`");
  if (msg.type === "trains") {
    if (!Array.isArray(msg.trains)) throw new Error("`trains` message needs a `trains` list");
    return { ...msg, trains: msg.trains.map(parseTrain) };
  }
  if (msg.type === "train") return { type: "trains", full: false, trains: [parseTrain(msg.train || msg)] };
  if (msg.type === "remove" && !Array.isArray(msg.ids)) throw new Error("`remove` message needs an `ids` list");
  return msg;
}

function parseTrain(t) {
  if (!t || (typeof t.id !== "string" && typeof t.id !== "number")) throw new Error("Every train needs an `id`");
  const num = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    id: String(t.id),
    name: t.name != null ? String(t.name) : String(t.id),
    x: num(t.x_mm),
    y: num(t.y_mm),
    heading: num(t.heading_deg),
    track: t.track != null ? String(t.track) : null,
    offset: num(t.offset_mm),
    speed: num(t.speed_mm_s),
    length: num(t.length_mm),
    direction: num(t.direction) ?? 1,
  };
}

export class TrainRegistry {
  /** @param {import("./world.js").World} world */
  constructor(world) {
    this.world = world;
    /** @type {Map<string, object>} */
    this.trains = new Map();
    this.clock = 0; // real seconds
    this.lastMessage = -Infinity;
    this.source = null;
    this.timeout = 15; // s without messages -> feed inactive
    this.stopSpeed = 3; // model mm/s; below this a train counts as standing
    this.stopAfter = 1.5; // s standing before passengers board
    this.quietAfter = 3; // s without new positions: a train without speed_mm_s counts as standing
  }

  /** True while a feed has delivered messages recently. */
  get active() {
    return this.clock - this.lastMessage < this.timeout;
  }

  reset() {
    for (const t of this.trains.values()) if (t.dockId) this.world.services.feedDeparted(t.dockId);
    this.trains.clear();
    this.lastMessage = -Infinity;
    this._syncModes();
  }

  /** Apply a feed message (already parsed or raw). */
  apply(input) {
    const msg = parseFeedMessage(input);
    this.lastMessage = this.clock;
    if (msg.type === "hello") {
      this.source = msg.source || "control system";
    } else if (msg.type === "trains") {
      const seen = new Set();
      for (const t of msg.trains) {
        seen.add(t.id);
        this._update(t);
      }
      if (msg.full) for (const id of [...this.trains.keys()]) if (!seen.has(id)) this._remove(id);
      this.world.events.emit("feed.trains", { trains: [...this.trains.values()] });
    } else if (msg.type === "remove") {
      for (const id of msg.ids) this._remove(String(id));
    } else if (msg.type === "disruption") {
      if (msg.action === "stop") this.world.disruptions.stop(msg.id);
      else {
        // duration_s: simulated seconds; null = until stopped; missing or invalid = the type's default
        const d = msg.duration_s === null ? null : Number(msg.duration_s);
        const duration = d === null || (Number.isFinite(d) && d > 0) ? d : undefined;
        this.world.disruptions.start({ type: msg.disruption, target: msg.target, params: msg.params, duration, id: msg.id });
      }
    }
    this._syncModes();
    return msg;
  }

  _resolve(t) {
    if (t.x != null && t.y != null) return { pos: [t.x, t.y], heading: t.heading != null ? toRad(t.heading) : null };
    if (t.track != null && t.offset != null) {
      const track = this.world.objects.find((o) => o.type === "track" && String(o.spec.track_id) === t.track);
      const g = track?.geometry;
      if (g) {
        const at = track.at(t.offset);
        return { pos: at.point, heading: Math.atan2(at.dir[1], at.dir[0]), path: { track, g } };
      }
    }
    return { pos: null, heading: null };
  }

  _update(t) {
    const r = this._resolve(t);
    const train = this.trains.get(t.id) || { id: t.id, stoppedFor: 0, movingFor: 0, dockId: null, speedEst: null, ref: null };
    if (r.pos) {
      // Speed from positions (for feeds without speed_mm_s), measured against a reference
      // position at least 0.25 s old, so that fast feeds get an estimate too.
      const ref = train.ref;
      const dt = ref ? this.clock - ref.time : 0;
      if (ref && dt >= 0.25) train.speedEst = Math.hypot(r.pos[0] - ref.pos[0], r.pos[1] - ref.pos[1]) / dt;
      if (!ref || dt >= 0.25) train.ref = { pos: r.pos, time: this.clock };
    }
    Object.assign(train, t, { pos: r.pos, heading: r.heading, path: r.path || null, updated: this.clock });
    this.trains.set(t.id, train);
  }

  /** Speed (mm/s) of a train: reported, else estimated; without new positions for a while it stands. */
  _speed(t) {
    if (t.speed != null) return t.speed;
    return this.clock - t.updated > this.quietAfter ? 0 : t.speedEst ?? 0;
  }

  _remove(id) {
    const t = this.trains.get(id);
    if (!t) return;
    if (t.dockId) this.world.services.feedDeparted(t.dockId);
    this.trains.delete(id);
  }

  /** Rail docks are feed-controlled while the feed is active (else timetable or planner, see ServiceManager.baseMode). */
  _syncModes() {
    const services = this.world.services;
    for (const st of services.docks.values()) {
      if (st.dock.kind !== "rail") continue;
      const mode = this.active ? "feed" : services.baseMode(st.dock);
      if (st.mode !== mode) {
        st.mode = mode;
        if (mode !== "feed" && st.vehicle?.source === "feed") services.feedDeparted(st.dock.id);
      }
    }
  }

  /** Dock at which a standing train is, or null. */
  _matchDock(t) {
    let best = null;
    for (const st of this.world.services.docks.values()) {
      const dock = st.dock;
      if (dock.kind !== "rail") continue;
      if (t.track != null && dock.track != null && dock.track === t.track && !t.pos) return dock;
      if (!t.pos) continue;
      if (t.track != null && dock.track != null && dock.track !== t.track) continue;
      const [s, tt] = dock.area.fromLayout(t.pos);
      const beyond = tt * dock.side - dock.area.W / 2; // distance from the platform edge (m)
      if (beyond < 0 || beyond > 6 || s < dock.s0 - 5 || s > dock.s1 + 5) continue;
      if (!best || beyond < best.d) best = { dock, d: beyond };
    }
    return best ? best.dock : null;
  }

  /** @param {number} dtReal real seconds */
  step(dtReal) {
    this.clock += dtReal;
    const wasActive = this._wasActive;
    this._wasActive = this.active;
    if (wasActive && !this.active) this.reset();
    for (const t of this.trains.values()) {
      if (this.clock - t.updated > this.timeout) {
        this._remove(t.id);
        continue;
      }
      if (this._speed(t) < this.stopSpeed) {
        t.stoppedFor += dtReal;
        t.movingFor = 0;
      } else {
        t.movingFor += dtReal;
        t.stoppedFor = 0;
      }
      if (!t.dockId && t.stoppedFor >= this.stopAfter) {
        const dock = this._matchDock(t);
        if (dock && !this.world.services.docks.get(dock.id)?.vehicle) {
          t.dockId = dock.id;
          this.world.services.feedArrived(dock.id, { trainId: t.id, line: t.name });
        }
      } else if (t.dockId && t.movingFor > 0.5) {
        this.world.services.feedDeparted(t.dockId);
        t.dockId = null;
      }
    }
  }

  draw(view) {
    // a virtual camera (flyover) shows no real trains: they are drawn as solid trains there
    const style = view.virtual ? "solid" : this.world.settings.feedVehicles;
    if (!this.active || style === "none") return;
    const outline = { fill: OVERLAY.trackedFill, stroke: OVERLAY.tracked, width: 2, order: 30 };
    const body = (pts) => {
      if (!view.virtual) return view.ribbon(pts, view.m(3.2), outline);
      const left = offsetLine(pts, view.m(1.45)), right = offsetLine(pts, -view.m(1.45));
      view.prism(left.concat(right.reverse()), view.m(0.4), view.m(3.9), { side: PALETTE.train, top: shade(PALETTE.train, 0.78) });
    };
    for (const t of this.trains.values()) {
      if (!t.pos) continue;
      if (style === "solid" && t.dockId) continue; // drawn as a virtual train at its platform
      const lenMM = t.length ?? 250;
      if (t.path?.track.geometry && t.offset != null) {
        const { track } = t.path;
        const a = t.offset - (t.direction >= 0 ? lenMM : 0), b = a + lenMM;
        const pts = [];
        for (let k = 0; k <= 12; k++) pts.push(track.at(a + ((b - a) * k) / 12).point);
        body(pts);
      } else if (t.heading != null) {
        // body outline behind the reported position (the train's front) along its heading
        const dx = Math.cos(t.heading), dy = Math.sin(t.heading);
        const back = [t.pos[0] - dx * lenMM, t.pos[1] - dy * lenMM];
        body([back, t.pos]);
      } else {
        const r = view.m(2.2);
        const ring = [];
        for (let k = 0; k < 16; k++) ring.push([t.pos[0] + r * Math.cos((k * Math.PI) / 8), t.pos[1] + r * Math.sin((k * Math.PI) / 8)]);
        view.polygon(ring, outline);
      }
      const standing = t.dockId ? " · at platform" : this._speed(t) < this.stopSpeed ? " · standing" : "";
      view.label([t.pos[0], t.pos[1], view.m(6)], `${t.name}${standing}`, { size: 11, background: OVERLAY.label, order: 4 });
    }
  }
}

/** A polyline shifted sideways by `d` (mm, positive = to the left). */
function offsetLine(points, d) {
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [p[0] - (dy / l) * d, p[1] + (dx / l) * d];
  });
}
