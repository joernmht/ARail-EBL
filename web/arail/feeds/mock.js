/**
 * A stand-in for a control system, running in the browser: one train per rail dock drives
 * along the platform, stops, waits and leaves again. Positions are reported with the
 * normal feed protocol (layout coordinates), so everything downstream behaves exactly as
 * with a real control system. Useful for demos and tests.
 * @module arail/feeds/mock
 */
const CRUISE = 110; // mm/s (model speed)
const ACCEL = 60; // mm/s²

export class MockFeed {
  /**
   * @param {import("../core/world.js").World} world
   * @param {{dwell?: number, pause?: [number, number], seed?: number}} [options] real seconds
   */
  constructor(world, { dwell = 18, pause = [8, 25] } = {}) {
    this.world = world;
    this.dwell = dwell;
    this.pause = pause;
    this.trains = new Map();
    this.running = false;
    this.status = "idle";
  }

  start() {
    this.running = true;
    this.status = "connected";
    this.world.trains.apply({ type: "hello", protocol: "arail-feed/1", source: "mock control system" });
    this.world.events.emit("feed.status", { status: "connected", url: "mock" });
  }

  stop() {
    this.running = false;
    this.status = "idle";
    this.trains.clear();
    this.world.trains.reset();
    this.world.events.emit("feed.status", { status: "idle", url: "mock" });
  }

  /** Path of the train serving a dock: along the track next to the platform edge (layout mm). */
  _path(dock) {
    const a = dock.area;
    const t = dock.side * (a.W / 2 + 2.2); // track centre about 2 m beyond the platform edge
    const dir = -dock.side; // same direction convention as the timetable trains
    const len = dock.s1 - dock.s0;
    const sStop = dir < 0 ? dock.s0 + 0.03 * len : dock.s1 - 0.03 * len; // where the train front stops
    const sFrom = dir < 0 ? dock.s1 + 1.2 * len : dock.s0 - 1.2 * len;
    const k = 1000 / a.scale; // m -> mm
    return { a, t, dir, sFrom, sStop, lengthMM: 0.9 * len * k, total: Math.abs(sStop - sFrom) * k * 2, k };
  }

  /** Advance the mock trains by `dt` real seconds and report their positions. */
  tick(dt) {
    if (!this.running) return;
    const rng = this.world.rng;
    const reported = [];
    for (const st of this.world.services.docks.values()) {
      const dock = st.dock;
      if (dock.kind !== "rail") continue;
      let tr = this.trains.get(dock.id);
      if (!tr) {
        tr = { id: `mock-${dock.id}`, name: `Mock ${this.trains.size + 1}`, phase: "waiting", timer: rng.uniform(0, 6), x: 0, v: 0 };
        this.trains.set(dock.id, tr);
      }
      const p = this._path(dock);
      const stopAt = Math.abs(p.sStop - p.sFrom) * p.k; // distance (mm) from the start to the stop
      tr.timer -= dt;
      if (tr.phase === "waiting") {
        if (tr.timer <= 0) Object.assign(tr, { phase: "approach", x: 0, v: CRUISE });
        continue;
      }
      if (tr.phase === "approach") {
        const remaining = stopAt - tr.x;
        const brake = Math.sqrt(Math.max(0, 2 * ACCEL * remaining));
        tr.v = Math.min(CRUISE, brake);
        tr.x += tr.v * dt;
        if (remaining < 1 || tr.v < 2) Object.assign(tr, { phase: "dwell", timer: this.dwell, v: 0, x: stopAt });
      } else if (tr.phase === "dwell") {
        if (tr.timer <= 0) tr.phase = "leave";
      } else if (tr.phase === "leave") {
        tr.v = Math.min(CRUISE, tr.v + ACCEL * dt);
        tr.x += tr.v * dt;
        if (tr.x > stopAt * 2.2) {
          Object.assign(tr, { phase: "waiting", timer: rng.uniform(...this.pause), v: 0 });
          continue;
        }
      }
      const s = p.sFrom + p.dir * (tr.x / p.k);
      const [x, y] = p.a.toLayout(s, p.t);
      const heading = Math.atan2(p.a.dir[1] * p.dir, p.a.dir[0] * p.dir);
      reported.push({ id: tr.id, name: tr.name, x_mm: +x.toFixed(1), y_mm: +y.toFixed(1), heading_deg: +((heading * 180) / Math.PI).toFixed(1), speed_mm_s: +tr.v.toFixed(1), length_mm: +p.lengthMM.toFixed(0) });
    }
    this.world.trains.apply({ type: "trains", full: true, trains: reported });
  }
}
