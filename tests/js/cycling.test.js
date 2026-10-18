// Bikes and e-scooters (sims/cycling.js): where riders ride by the street's cross-section, the
// signs and the rules (children, rule-breakers), the riders the cars must follow, bikes locked near
// buildings and at street lamps, the riders' cards, and reproducible runs.
import assert from "node:assert/strict";
import test from "node:test";

import { RIDERS, createWorld, ridingSurface } from "../../web/arail/index.js";

/** Main street with bike lanes, a plain street across it, a shared path, a house and a shop. */
function world(cycling = {}, extra = [], seed = 9) {
  return createWorld({
    objects: [
      { id: "main", type: "road", name: "Main", profile: "bike-lanes", points: [[0, 0], [5000, 0]] },
      { id: "plain", type: "road", name: "Plain", points: [[2500, -2000], [2500, 2000]] },
      { id: "path", type: "road", name: "Path", kind: "path", profile: "shared-paths", points: [[0, 1500], [2500, 1500]] },
      { id: "home", type: "house", name: "House", position: [1200, -300], rotation_deg: 180 },
      { id: "shop", type: "supermarket", name: "Shop", position: [3800, 330] },
      ...extra,
    ],
    simulations: [{ type: "cycling", riders_per_km: 40, ...cycling }],
    clock: { start: "08:00", profiles: false },
  }, { seed });
}

const cyclingOf = (w) => w.simulations.find((s) => s.constructor.type === "cycling");

/** Run and collect where the riders ride: "road:where". */
function ride(w, seconds) {
  const sim = cyclingOf(w), seen = new Set();
  w.speed = 1;
  for (let t = 0; t < seconds; t += 0.1) {
    w.step(0.1);
    for (const r of sim.riders) for (const sf of r.surfaces || []) seen.add(`${sf.edge?.road}:${sf.where}`);
  }
  return seen;
}

test("where riders ride: bike lanes and paths, the road, sidewalks by the signs and the rules", () => {
  const rider = (kind, compliant = true, child = false) => ({ kind, compliant, child });
  const street = { kind: "road", bikeWay: "road" };
  assert.equal(ridingSurface({ kind: "road", bikeWay: "lane" }, rider("bike")), "lane");
  assert.equal(ridingSurface({ kind: "road", bikeWay: "advisory" }, rider("scooter")), "lane");
  assert.equal(ridingSurface({ kind: "road", bikeWay: "path" }, rider("bike", false)), "lane", "a bike path must be used");
  assert.equal(ridingSurface({ kind: "path", bikeWay: "shared" }, rider("bike")), "lane");
  assert.equal(ridingSurface(street, rider("bike")), "road");
  assert.equal(ridingSurface(street, rider("bike", false)), "sidewalk", "a rule-breaker");
  assert.equal(ridingSurface(street, rider("bike", true, true)), "sidewalk", "a child under 10 may");
  assert.equal(ridingSurface({ ...street, sidewalkBikes: true }, rider("bike")), "sidewalk-allowed");
  assert.equal(ridingSurface({ ...street, sidewalkBikes: true }, rider("scooter")), "road", "Radverkehr frei is not for e-scooters");
  assert.equal(ridingSurface({ ...street, sidewalkScooters: true }, rider("scooter")), "sidewalk-allowed");
  assert.deepEqual(RIDERS.bike.speed_kmh, [14, 22]);
  assert.deepEqual(RIDERS.scooter.speed_kmh, [15, 20]);
});

test("the cycling simulation: riders keep to the rules unless they break them", () => {
  // riders who keep the rules: on the bike lanes of Main, on the road of Plain, never on a sidewalk
  const keep = ride(world({ rule_breakers: 0, children: 0 }), 150);
  assert.ok(keep.has("main:lane") && keep.has("plain:road"), [...keep].join(" "));
  assert.ok(![...keep].some((x) => x.endsWith(":sidewalk")), [...keep].join(" "));
  // rule-breakers ride on Plain's sidewalks; on Main they have a bike lane
  const breakers = ride(world({ rule_breakers: 1, children: 0 }), 150);
  assert.ok(breakers.has("plain:sidewalk"), [...breakers].join(" "));
  assert.ok(!breakers.has("main:sidewalk"));
  // a sign allows bikes on Plain's sidewalks
  const sign = ride(world({ rule_breakers: 0, children: 0, scooters: 0 }, [{ id: "sign", type: "traffic-sign", sign: "bikes-allowed", position: [2350, 900] }]), 150);
  assert.ok(sign.has("plain:sidewalk-allowed"), [...sign].join(" "));
  // the riders the cars must follow: on a street too narrow to pass them, not on a bike lane
  const w = world({ rule_breakers: 0, children: 0 });
  ride(w, 100);
  const sim = cyclingOf(w), users = sim.roadUsers();
  assert.ok(users.length > 0, "riders on Plain's road hold up the cars");
  for (const u of users) {
    const r = u.vehicle, sf = r.surfaces[Math.min(r.surfaces.length - 1, 0)];
    assert.ok(r.kind === "bike" || r.kind === "scooter");
    assert.ok(sf, "a surface");
  }
  // a rider's card
  const hit = sim.pickables()[0];
  const card = w.card(hit);
  assert.match(card.title, /^(Bike|E-scooter)$/);
  assert.equal(card.subtitle, "Bikes and e-scooters");
  const rows = Object.fromEntries(card.rows);
  assert.ok(rows.Rider && rows.Riding && rows["Keeps the rules"] === "yes", JSON.stringify(rows));
});

test("bikes are locked near the buildings riders go to, at street lamps and bike stands", () => {
  const w = world({ to_buildings: 1, rule_breakers: 0 }, [{ id: "bs", type: "bike-stand", position: [3800, 120], stands: 4 }]);
  ride(w, 300);
  const sim = cyclingOf(w);
  assert.ok(sim.locked.length > 0, "riders lock their bikes for a while");
  for (const l of sim.locked) assert.ok(l.until > w.clock.minutes - 1e-6, "until later");
  // the bikes stand at lamps and stands, two at most at each
  const spots = w.parking.bikeSpots();
  assert.ok(spots.some((b) => b.kind === "stand") && spots.some((b) => b.kind === "lamp"));
  let locked = 0;
  for (const b of spots) {
    const n = w.parking.bikes.get(b.key)?.length ?? 0;
    assert.ok(n <= b.capacity, `${b.key}: ${n}`);
    locked += n;
  }
  assert.equal(locked, sim.locked.length);
});

test("bikes and e-scooters: the same seed gives the same riders", () => {
  const trace = (seed) => {
    const w = world({}, [], seed);
    ride(w, 60);
    return cyclingOf(w).riders.map((r) => `${r.kind}:${r.compliant}:${Math.round(r.s)}:${r.person.name}`).join("|");
  };
  const a = trace(9);
  assert.ok(a.length > 0);
  assert.equal(trace(9), a);
  assert.notEqual(trace(10), a);
});
