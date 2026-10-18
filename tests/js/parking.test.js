// Parking (objects/parking.js, core/parking.js, sims/traffic.js): tariffs by the hour, day, week or
// year, who may park (customers, employees, residents), lots and garages with their spaces,
// world.parking taking and releasing spaces, drivers planning where to park like a trip, and the
// road traffic parking its cars at buildings.
import assert from "node:assert/strict";
import test from "node:test";

import { PARKING_ACCESS, TARIFFS, Tariff, createWorld, ownerAccess, parkingTerms, planDrive } from "../../web/arail/index.js";

/** A street with a supermarket and its lot, a public garage, a factory with its staff lot and a house. */
const TOWN = [
  { id: "main", type: "road", name: "Main", points: [[0, 0], [5000, 0]] },
  { id: "shop", type: "supermarket", name: "Shop", position: [2500, 330] },
  { id: "lot", type: "parking-lot", name: "Shop lot", owner: "shop", position: [1900, 290] },
  { id: "garage", type: "parking-garage", name: "Garage", position: [3300, 330], tariff: "hourly" },
  { id: "factory", type: "factory", name: "Works", position: [4300, -400], rotation_deg: 180 },
  { id: "staff", type: "parking-lot", name: "Staff", owner: "factory", position: [3500, -290], rotation_deg: 180 },
  { id: "home", type: "house", name: "House", position: [1000, -300], rotation_deg: 180 },
];

function world(objects = TOWN, simulations = []) {
  return createWorld({ objects, simulations, clock: { start: "10:00", profiles: false } }, { seed: 2 });
}

test("tariffs: started hours, days and weeks; a yearly permit costs nothing per stay", () => {
  assert.deepEqual(Object.keys(TARIFFS), ["free", "hourly", "daily", "weekly", "yearly"]);
  const hourly = new Tariff({ kind: "hourly", price_eur: 2 });
  assert.deepEqual([0, 30, 60, 61, 120, 121].map((m) => hourly.fee(m)), [2, 2, 2, 4, 4, 6]);
  assert.equal(hourly.label(), "2 € per hour");
  assert.equal(new Tariff({ kind: "daily" }).fee(1441), 30, "15 € a day, two days started");
  assert.equal(new Tariff({ kind: "weekly", street: true }).label(), "20 € per week", "the street's usual price");
  assert.equal(new Tariff({ kind: "hourly", price_eur: 1.5 }).label(), "1.50 € per hour");
  const yearly = new Tariff({ kind: "yearly" });
  assert.equal(yearly.fee(5000), 0);
  assert.equal(yearly.label(), "120 € per year (permit)");
  assert.equal(new Tariff({ kind: "free", price_eur: 9 }).label(), "free");
  assert.equal(new Tariff({ kind: "free" }).fee(600), 0);
  assert.equal(new Tariff({ kind: "nonsense" }).kind, "free");
});

test("who may park: a supermarket's customers, a factory's employees, residents with a permit", () => {
  const w = world();
  assert.equal(ownerAccess(w.getObject("shop")), "customers");
  assert.equal(ownerAccess(w.getObject("factory")), "employees");
  assert.equal(ownerAccess(w.getObject("home")), "residents");
  assert.equal(ownerAccess(null), "public");
  assert.deepEqual(Object.keys(PARKING_ACCESS), ["auto", "public", "residents", "customers", "employees"]);
  const lot = w.parking.facility("lot"), staff = w.parking.facility("staff"), garage = w.parking.facility("garage");
  assert.deepEqual([lot.access, lot.for], ["customers", "shop"]);
  assert.deepEqual([staff.access, staff.for], ["employees", "factory"]);
  assert.deepEqual([garage.access, garage.for], ["public", null]);
  // free for the owner's customers and employees whatever the tariff; nobody else
  const shopping = parkingTerms(lot, { purpose: "shopping", destId: "shop" });
  assert.deepEqual([shopping.allowed, shopping.free, shopping.fee(90), shopping.why], [true, true, 0, "free for customers"]);
  assert.deepEqual([parkingTerms(lot, { purpose: "work", destId: "shop" }).allowed, parkingTerms(lot, { purpose: "work", destId: "shop" }).why], [false, "for customers only"]);
  assert.equal(parkingTerms(lot, { purpose: "shopping", destId: "factory" }).allowed, false, "shopping elsewhere");
  assert.equal(parkingTerms(staff, { purpose: "work", destId: "factory" }).why, "free for employees");
  assert.equal(parkingTerms(staff, { purpose: "visit", destId: "factory" }).why, "for employees only");
  // the garage: everybody, by its tariff
  const g = parkingTerms(garage, { purpose: "visit", destId: "home" });
  assert.deepEqual([g.allowed, g.free, g.fee(90), g.why], [true, false, 4, "2 € per hour"]);
  // residents' parking: a permit for it, the house it belongs to, or a resident nearby in a street
  const res = { id: "res", access: "residents", for: "home", tariff: new Tariff({ kind: "yearly" }) };
  assert.equal(parkingTerms(res, { home: "home" }).why, "with a residents' permit");
  assert.equal(parkingTerms(res, { permits: new Set(["res"]) }).allowed, true);
  assert.equal(parkingTerms(res, { home: "elsewhere" }).why, "for residents with a permit only");
  assert.equal(parkingTerms({ ...res, for: null }, { resident: true }).allowed, true, "residents' parking in a street");
  // the lot's card: its spaces, who may park, what it costs
  const card = Object.fromEntries(w.card({ kind: "object", ref: w.getObject("lot"), owner: w.getObject("lot"), label: "Shop lot" }).rows);
  assert.equal(card.Spaces, lot.spaces);
  assert.equal(card["Who may park"], "customers of the owner (free)");
  assert.equal(card["Parking costs"], "free");
  assert.equal(card["Taken now"], `0 of ${lot.spaces}`);
});

test("lots and garages: spaces by size and layout; world.parking takes and releases them", () => {
  const w = world();
  const lot = w.parking.facility("lot"), garage = w.parking.facility("garage");
  // a 30 × 17 m lot: two rows of perpendicular spaces (2.65 × 5.20 m) along an aisle
  assert.equal(lot.spaces, 20);
  assert.equal(lot.spots.length, 20);
  assert.equal(lot.kind, "lot");
  // a garage of 32 × 32 m and 4 levels: a space per 25 m² of each level (EAR 05)
  assert.equal(garage.spaces, Math.floor((32 * 32 * 4) / 25));
  assert.equal(garage.kind, "garage");
  const under = world([...TOWN, { id: "tg", type: "parking-garage", kind: "underground", position: [600, 330], spaces: 40, owner: "home" }]);
  assert.deepEqual([under.parking.facility("tg").kind, under.parking.facility("tg").spaces, under.parking.facility("tg").access], ["underground", 40, "residents"]);
  // the way in is at the front, next to the street; angled spaces take more room than perpendicular ones
  assert.ok(lot.entry[1] < w.getObject("lot").geometry.center[1], "the front faces the street (−y)");
  const angled = world([TOWN[0], { id: "lot", type: "parking-lot", layout: "angled", position: [1900, 290] }]).parking.facility("lot");
  const parallel = world([TOWN[0], { id: "lot", type: "parking-lot", layout: "parallel", position: [1900, 290] }]).parking.facility("lot");
  assert.ok(angled.spaces > 0 && angled.spaces < lot.spaces, `${angled.spaces}`);
  assert.ok(parallel.spaces > 0);
  assert.ok(parallel.spots.every((p) => Math.abs(p.dir[1]) < 1e-6), "parallel spaces along the rows");
  // taking a space: the free one nearest to a point; releasing it frees it
  const car = { id: "c1" }, other = { id: "c2" };
  const a = w.parking.take("lot", car, lot.entry);
  assert.ok(a && a.spot, "a space");
  assert.deepEqual([w.parking.occupied("lot"), w.parking.free("lot")], [1, 19]);
  const b = w.parking.take("lot", other, lot.entry);
  assert.notEqual(b.slot, a.slot);
  w.parking.release("lot", car);
  assert.deepEqual([w.parking.occupied("lot"), w.parking.free("lot")], [1, 19]);
  // a full lot takes nobody
  for (let k = 0; k < 25; k++) w.parking.take("lot", { id: `x${k}` }, null);
  assert.equal(w.parking.free("lot"), 0);
  assert.equal(w.parking.take("lot", { id: "late" }, null), null);
  // bikes: two at each street lamp
  const lamps = w.getObject("main").bikeParking();
  assert.ok(lamps.length > 10 && lamps.every((l) => l.capacity === 2 && l.kind === "lamp"));
  const stands = world([TOWN[0], { id: "bs", type: "bike-stand", position: [800, -110], stands: 6 }]).getObject("bs").bikeParking();
  assert.deepEqual([stands.length, stands[0].capacity, stands[0].kind], [6, 2, "stand"]);
});

test("drivers plan where to park like a trip: by the drive, the walk and the fee", () => {
  const w = world();
  const from = w.network().boundaryNodes()[0];
  const plan = (to, purpose) => planDrive(w, { from, to, purpose, stayMin: 90 });
  // shopping at the supermarket: its own lot, free
  const shop = plan("shop", "shopping");
  assert.equal(shop.facility.id, "lot");
  assert.deepEqual([shop.fee, shop.free, shop.why], [0, true, "free for customers"]);
  assert.ok(shop.route && shop.km > 0 && shop.minutes > 0);
  assert.ok(shop.walkM > 0 && shop.walkM < 400);
  assert.deepEqual(shop.options.map((o) => o.label), ["Shop lot", "Garage"], "what the driver weighed");
  // a visit to the supermarket's neighbour: not on the customers' lot; the garage, paid
  const visit = plan("shop", "visit");
  assert.equal(visit.facility.id, "garage");
  assert.equal(visit.fee, 4);
  // work at the factory: the staff lot
  assert.equal(plan("factory", "work").facility.id, "staff");
  assert.equal(plan("factory", "shopping").facility.id, "garage");
  // a full lot counts as a long search (10 min more); found full, the driver plans again without it
  for (let k = 0; k < 20; k++) w.parking.take("lot", { id: `p${k}` }, null);
  assert.equal(plan("shop", "shopping").options.find((o) => o.label === "Shop lot").full, true);
  assert.equal(planDrive(w, { from, to: "shop", purpose: "shopping", stayMin: 90, avoid: ["lot"] }).facility.id, "garage");
  // a facility tried already is left out; with none left there is no plan to park
  assert.equal(planDrive(w, { from, to: "shop", purpose: "shopping", avoid: ["lot", "garage"] }), null);
  // to a node: just the route
  const node = planDrive(w, { from, to: { node: w.network().boundaryNodes()[1] } });
  assert.equal(node.facility, null);
  assert.ok(node.route);
});

test("road traffic: cars with drivers and passengers park at buildings, pay, and leave again", () => {
  const w = world(TOWN, [{ type: "traffic", cars_per_km: 40, destinations: 1 }]);
  const sim = w.simulations.find((s) => s.constructor.type === "traffic");
  w.speed = 1;
  w.step(0.1);
  // at the start some cars stand in the parking already, gone to the building it belongs to
  const start = new Set(sim.parkedCars.map((p) => p.car));
  assert.ok(start.size > 0);
  for (const p of sim.parkedCars) assert.equal(p.car.destName, p.facility.for ? w.getObject(p.facility.for).name : null);
  for (let i = 0; i < 3000; i++) w.step(0.1);
  const came = sim.parkedCars.filter((p) => !start.has(p.car));
  assert.ok(came.length >= 5, `${came.length} cars parked`);
  for (const p of came) {
    assert.ok(p.car.driver?.name, "a driver");
    assert.ok(Array.isArray(p.car.passengers));
    // customers on the supermarket's lot for free; everybody else pays in the garage
    if (p.facility.id === "lot") assert.deepEqual([p.car.purpose, p.car.fee, p.car.why], ["shopping", 0, "free for customers"]);
    if (p.facility.id === "garage") assert.ok(p.car.fee > 0, `${p.car.purpose}: ${p.car.fee} €`);
    assert.notEqual(p.facility.id, "staff", "not at 10:00 for work, and never for anybody else");
  }
  assert.ok(came.some((p) => p.facility.id === "lot"));
  // the card of a parked car and of a driving one
  const hit = w.parking.pickables().find((x) => came.some((p) => p.car === x.ref.car && p.facility.id === "lot"));
  const rows = Object.fromEntries(w.card(hit).rows);
  assert.equal(w.card(hit).title, "Parked car");
  assert.equal(rows["Parked at"], "Shop lot");
  assert.equal(rows["Gone to"], "Shop");
  assert.equal(rows.Costs, "free for customers");
  const driving = sim.cars.find((c) => c.plan?.facility);
  if (driving) {
    const card = Object.fromEntries(w.card({ ref: driving, owner: sim, kind: "car", label: "Car" }).rows);
    assert.ok(card.Driver && card.Trip && card["Planned route"] && card["Parks at"] && card["Parking costs"], JSON.stringify(card));
  }
});
