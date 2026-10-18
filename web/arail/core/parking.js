/**
 * Parking spaces of the world (`world.parking`): the facilities objects offer with `parkingInfo()`
 * (streets with parking strips, parking lots and garages, supermarkets; objects/parking.js) and the
 * places to lock a bike with `bikeParking()` (street lamps, bike stands), and who is parked where.
 * The traffic simulation parks its cars here, the cycling simulation its bikes; parked cars (on
 * the street and on lots; those in garages are out of sight) and bikes are drawn here.
 * @module arail/core/parking
 */
import { dist2, rectBetween } from "./math.js";
import { boxFaces } from "./transit.js";
import { bikeColour, drawBike } from "./vehicles.js";
import { grey, shade } from "./colors.js";

/** Clock minutes as "07:05" (the next day wraps round). */
const hhmm = (minutes) => {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** A parked car's size (m): the design car of EAR 23 is 4.88 × 1.89 m; an average one is smaller. */
export const PARKED_CAR = { length_m: 4.5, width_m: 1.8 };

export class ParkingSpaces {
  /** @param {import("./world.js").World} world */
  constructor(world) {
    this.world = world;
    this.reset();
  }

  /** Forget everything (a new layout). */
  reset() {
    this._key = null;
    this._list = [];
    this._byId = new Map();
    /** Facility id → Map(slot → {car, since}); slots of garages are numbers without a spot. */
    this.cars = new Map();
    this._bikeKey = null;
    this._bikeSpots = [];
    /** Bike spot key → [{rider, since}]. */
    this.bikes = new Map();
  }

  /** The facilities, recomputed when objects, the marker map or the scale change; who is parked stays. */
  _sync() {
    const w = this.world, key = `${w.objectsVersion}:${w.map.version}:${w.scale}`;
    if (key === this._key) return;
    this._key = key;
    const list = [];
    for (const o of w.objects) {
      if (typeof o.parkingInfo !== "function" || !o.geometry) continue;
      let fs = [];
      try {
        fs = o.parkingInfo() || [];
      } catch {
        fs = [];
      }
      for (const f of fs) if (f && f.spaces > 0) list.push(f);
    }
    this._list = list;
    this._byId = new Map(list.map((f) => [f.id, f]));
    // cars on spots that are gone (a street changed) drive away: the simulation hears it from `evicted`
    this.evicted = [];
    for (const [id, slots] of this.cars) {
      const f = this._byId.get(id);
      for (const [slot, entry] of slots) {
        if (!f || slot >= f.spaces) {
          slots.delete(slot);
          this.evicted.push(entry.car);
        }
      }
      if (!f) this.cars.delete(id);
    }
  }

  /** All facilities: [{id, owner, kind, label, spaces, spots, tariff, access, for, entry, exit}]. */
  facilities() {
    this._sync();
    return this._list;
  }

  /** A facility by id, or null. */
  facility(id) {
    this._sync();
    return this._byId.get(id) || null;
  }

  /** Cars parked at a facility now (null if there is no such facility). */
  occupied(id) {
    const f = this.facility(id);
    return f ? this.cars.get(id)?.size ?? 0 : null;
  }

  /** Free spaces of a facility (0 if there is none). */
  free(id) {
    const f = this.facility(id);
    return f ? f.spaces - (this.cars.get(id)?.size ?? 0) : 0;
  }

  /**
   * Park a car: the free slot nearest to `near` (a layout point), or any; null when it is full.
   * @returns {{slot: number, spot: {pos: number[], dir: number[]} | null} | null}
   */
  take(id, car, near = null) {
    const f = this.facility(id);
    if (!f) return null;
    if (!this.cars.has(id)) this.cars.set(id, new Map());
    const slots = this.cars.get(id);
    if (slots.size >= f.spaces) return null;
    let best = -1, bd = Infinity;
    for (let i = 0; i < f.spaces; i++) {
      if (slots.has(i)) continue;
      const p = f.spots[i]?.pos;
      const d = near && p ? dist2(p, near) : i;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) return null;
    slots.set(best, { car, since: this.world.clock?.minutes ?? 0 });
    return { slot: best, spot: f.spots[best] || null };
  }

  /** A car leaves its space. */
  release(id, car) {
    const slots = this.cars.get(id);
    if (!slots) return;
    for (const [slot, e] of slots) if (e.car === car) slots.delete(slot);
  }

  /** Empty every facility (the simulation starts again). */
  clearCars() {
    this.cars = new Map();
  }

  /** Where bikes can be locked: [{key, pos, dir, capacity, kind}] (street lamps and bike stands). */
  bikeSpots() {
    const w = this.world, key = `${w.objectsVersion}:${w.map.version}:${w.scale}`;
    if (key !== this._bikeKey) {
      this._bikeKey = key;
      const spots = [];
      for (const o of w.objects) {
        if (typeof o.bikeParking !== "function" || !o.geometry) continue;
        let list = [];
        try {
          list = o.bikeParking() || [];
        } catch {
          list = [];
        }
        list.forEach((b, i) => spots.push({ key: `${o.id}:${i}`, ...b }));
      }
      this._bikeSpots = spots;
      const keys = new Set(spots.map((b) => b.key));
      for (const k of [...this.bikes.keys()]) if (!keys.has(k)) this.bikes.delete(k);
    }
    return this._bikeSpots;
  }

  /** Lock a bike at the free spot nearest to p (within maxMM); the spot or null. */
  lockBike(rider, p, maxMM = Infinity) {
    let best = null, bd = maxMM;
    for (const b of this.bikeSpots()) {
      if ((this.bikes.get(b.key)?.length ?? 0) >= b.capacity) continue;
      const d = dist2(b.pos, p);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (!best) return null;
    if (!this.bikes.has(best.key)) this.bikes.set(best.key, []);
    this.bikes.get(best.key).push({ rider, since: this.world.clock?.minutes ?? 0 });
    return best;
  }

  /** Unlock a bike. */
  unlockBike(rider) {
    for (const [k, list] of this.bikes) {
      const i = list.findIndex((e) => e.rider === rider);
      if (i >= 0) {
        list.splice(i, 1);
        if (!list.length) this.bikes.delete(k);
        return;
      }
    }
  }

  /* ---------------------------------------------------------------- pointing and drawing */

  /** The cars parked on streets and lots as pickables (core/pick.js). */
  pickables() {
    const out = [], m = (x) => (x * 1000) / this.world.scale;
    for (const [id, slots] of this.cars) {
      const f = this._byId.get(id);
      if (!f) continue;
      for (const [slot, e] of slots) {
        const spot = f.spots[slot];
        if (!spot) continue;
        const half = m(PARKED_CAR.length_m) / 2;
        const rear = [spot.pos[0] - spot.dir[0] * half, spot.pos[1] - spot.dir[1] * half], front = [spot.pos[0] + spot.dir[0] * half, spot.pos[1] + spot.dir[1] * half];
        out.push({ key: `parked:${e.car.id}`, kind: "car", label: "Parked car", outline: rectBetween(rear, front, m(PARKED_CAR.width_m)), z0: 0, z1: m(1.45), owner: this, ref: { car: e.car, facility: f, since: e.since } });
      }
    }
    return out;
  }

  /** The card of a parked car: where, since when, who drove it, what it costs. */
  card(hit) {
    const { car, facility, since } = hit.ref;
    const now = this.world.clock?.minutes ?? since;
    const minutes = (((now - since) % 1440) + 1440) % 1440;
    const rows = [["Parked at", facility.label], ["Since", hhmm(since)]];
    if (car.driver?.name) rows.push(["Driver", car.driver.name]);
    if (car.destName) rows.push(["Gone to", car.destName]);
    rows.push(["Costs", car.fee > 0 ? `${car.fee.toFixed(2)} €` : car.why || facility.tariff.label()]);
    return { title: "Parked car", subtitle: facility.label, status: `Parked for ${Math.round(minutes)} min`, rows };
  }

  /** Parked cars at their spots (not those in garages) and bikes at lamps and stands. */
  draw(view) {
    const m = (x) => view.m(x);
    for (const [id, slots] of this.cars) {
      const f = this._byId.get(id);
      if (!f) continue;
      for (const [slot, e] of slots) {
        const spot = f.spots[slot];
        if (!spot || !view.inImage(spot.pos[0], spot.pos[1], 0, 60)) continue;
        const half = m(PARKED_CAR.length_m) / 2, body = e.car.colour || grey(0.6);
        const rear = [spot.pos[0] - spot.dir[0] * half, spot.pos[1] - spot.dir[1] * half], front = [spot.pos[0] + spot.dir[0] * half, spot.pos[1] + spot.dir[1] * half];
        const small = view.pxPerMM(spot.pos[0], spot.pos[1], 0) * m(PARKED_CAR.length_m) < 7;
        const faces = boxFaces(rear, front, m(PARKED_CAR.width_m), m(0.2), m(small ? 1.45 : 0.95), { side: body, top: shade(body, 0.92), end: shade(body, 0.9) });
        if (!small) {
          const u = spot.dir, c0 = [rear[0] + u[0] * m(0.9), rear[1] + u[1] * m(0.9)], c1 = [front[0] - u[0] * m(1.4), front[1] - u[1] * m(1.4)];
          faces.push(...boxFaces(c0, c1, m(PARKED_CAR.width_m - 0.2), m(0.95), m(1.45), { side: grey(0.18), top: shade(body, 0.95), end: grey(0.18) }));
        }
        view.faces(faces, [spot.pos[0], spot.pos[1], m(0.7)]);
      }
    }
    const spots = this._bikeSpots;
    for (const b of spots) {
      const n = this.bikes.get(b.key)?.length ?? 0;
      if (!n || !view.inImage(b.pos[0], b.pos[1], 0, 40)) continue;
      const list = this.bikes.get(b.key);
      for (let i = 0; i < n; i++) {
        // two bikes side by side, along the stand or the lamp
        const t = (i - (n - 1) / 2) * m(0.6), c = [b.pos[0] + b.dir[1] * t, b.pos[1] - b.dir[0] * t];
        const a = [c[0] - b.dir[0] * m(0.9), c[1] - b.dir[1] * m(0.9)], d = [c[0] + b.dir[0] * m(0.9), c[1] + b.dir[1] * m(0.9)];
        const rider = list?.[i]?.rider;
        drawBike(view, a, d, { kind: rider?.kind || "bike", colour: bikeColour(rider), scale: rider?.child ? 0.78 : 1 });
      }
    }
  }
}
