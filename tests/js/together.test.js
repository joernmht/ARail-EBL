// The town's people among each other and on their ways (sims/town.js): households that share their
// cars, people who go together (a child taken to school, partners shopping, pupils of a house), the
// choice of the mode by what was learned, and real trips by car and by bike on the streets.
import assert from "node:assert/strict";
import test from "node:test";

import { MODE_KEYS, canDrive, createWorld, validateLayout, registry } from "../../web/arail/index.js";
import { LANGUAGES } from "../../web/arail/core/people.js";

/**
 * A town along a street: three houses at its west end, an office, a school and a shop to the east
 * (the office 600 m away), a bus line between them, cars and bikes on the street.
 */
function layout(town = {}, { traffic = true, cycling = true, bus = true, more = [] } = {}) {
  const house = (id, x, extra = {}) => ({ id, type: "building", name: id, position: [x, 260], width_m: 30, depth_m: 12, floors: 5, use: "residential", ...extra });
  return {
    scale: 87,
    objects: [
      { id: "street", type: "road", name: "Lange Straße", points: [[-3000, 0], [10000, 0]], profile: "bike-lanes" },
      house("home-1", 0), house("home-2", 700), house("home-3", 1400),
      house("office", 7000, { use: "work", floors: 6, width_m: 50 }),
      house("school", 4000, { use: "school", floors: 3, width_m: 40 }),
      house("shop", 2600, { use: "shop", floors: 1, width_m: 30 }),
      ...(bus ? [
        { id: "stop-a", type: "bus-stop", name: "Siedlung", road: "street", position: [700, 0], side: "both" },
        { id: "stop-b", type: "bus-stop", name: "Kontor", road: "street", position: [6800, 0], side: "both" },
        { id: "line-1", type: "bus-line", name: "Line 1", number: "1", stops: ["stop-a", "stop-b"], headway_s: 60 },
      ] : []),
      ...more,
    ],
    simulations: [
      { type: "passengers", base_rate: 0 }, { type: "town", people_per_100: 40, walk_max_m: 100, ...town },
      ...(traffic ? [{ type: "traffic", cars_per_km: 1 }] : []), ...(cycling ? [{ type: "cycling", riders_per_km: 0 }] : []),
    ],
    clock: { start: "05:30", factor: 12 },
  };
}

const townOf = (w) => w.simulations.find((s) => s.constructor.type === "town");
const sim = (w, type) => w.simulations.find((s) => s.constructor.type === type);

/** Run a world until the clock shows `hours` (of the same day), calling `each` after every step. */
function runUntil(world, hours, each = null) {
  world.speed = 2.5;
  let guard = 0;
  while (world.clock.minutes < hours * 60 && guard++ < 4e5) {
    world.step(0.1);
    each?.();
  }
}

test("the test town is a valid layout", () => {
  assert.deepEqual(validateLayout(layout({ modes: { car: { constant: 2 } }, stretch: 3, together: true }), registry), []);
  assert.ok(validateLayout(layout({ modes: { ship: {} } }), registry).some((p) => /no row "ship"/.test(p)), "the table of the modes is checked");
});

test("households: the people of a house in families, couples and singles; a household shares its cars", () => {
  const world = createWorld(layout(), { seed: 11 });
  world.step(0.1);
  const t = townOf(world);
  const residents = t.agents.filter((a) => a.house);
  assert.ok(residents.length > 40);
  assert.ok(residents.every((a) => a.household), "everybody who lives in the town has a household");
  const households = [...new Set(residents.map((a) => a.household))];
  for (const h of households) {
    assert.ok(h.members.length >= 1 && h.members.length <= 5);
    assert.ok(h.members.every((m) => m.household === h && m.house.building === h.home), "of one house");
    const kids = h.members.filter((m) => m.profile.age === "child"), adults = h.members.filter((m) => m.profile.age !== "child");
    if (kids.length) assert.ok(kids.length <= 3 && adults.length <= 2, "a family: up to three children, one or two adults");
    else assert.ok(adults.length <= 2, "else a couple or a single");
    // its cars: for those who would have one, two at most; who has a licence can take one
    assert.ok(h.cars >= 0 && h.cars <= 2 && h.carsHome === h.cars);
    for (const m of adults) assert.equal(canDrive(m.profile), !!m.profile.licence && h.cars > 0, "a licence and a car in the household");
  }
  const sizes = households.map((h) => h.members.length);
  assert.ok(sizes.includes(1) && sizes.some((n) => n >= 3), "singles and families");
  const withKids = households.filter((h) => h.members.some((m) => m.profile.age === "child"));
  assert.ok(withKids.filter((h) => h.members.some((m) => m.profile.age !== "child")).length >= withKids.length * 0.7, "children live with adults");
  // children have an age in years, everybody a liking of each mode and maybe a bike
  for (const a of t.agents) {
    assert.equal(a.years != null, a.profile.age === "child");
    if (a.years != null) assert.ok(a.years >= 6 && a.years <= 18);
    assert.deepEqual(Object.keys(a.liking), MODE_KEYS);
  }
  assert.ok(t.agents.some((a) => a.bike) && t.agents.some((a) => !a.bike));
  // the same seed, the same households; another seed, others
  const again = createWorld(layout(), { seed: 11 });
  again.step(0.1);
  const key = (w) => JSON.stringify([...new Set(townOf(w).agents.filter((a) => a.house).map((a) => a.household))].map((h) => h.members.map((m) => m.id)));
  assert.equal(key(again), key(world));
  // names are birds, as everywhere
  const birds = new Set(LANGUAGES.flatMap((l) => l.birds));
  for (const a of t.agents.slice(0, 20)) assert.ok(birds.has(a.given) && birds.has(a.family.split(" ").pop()), a.name);
  // without `together`: everybody for themselves, each with the car their profile gives them
  const alone = createWorld(layout({ together: false }), { seed: 11 });
  alone.step(0.1);
  assert.ok(townOf(alone).agents.every((a) => !a.household));
});

test("going together: young children are taken to school, schoolmates and partners walk together, at the pace of the slowest", () => {
  const world = createWorld(layout({ car_share: 0, bus_share: 0, shopping: 1 }, { traffic: false, cycling: false, bus: false }), { seed: 11 });
  world.step(0.1);
  const t = townOf(world);
  // the plans of a house are made together
  const escorts = t.agents.filter((a) => a.plan.some((s) => s.escort));
  assert.ok(escorts.length > 0, "adults who take a child to school");
  for (const a of escorts) {
    const step = a.plan.find((s) => s.escort);
    assert.ok(a.profile.age !== "child" && step.with.length >= 1);
    for (const id of step.with) {
      const kid = t.agents.find((x) => x.id === id);
      assert.ok(kid.years < 10 && kid.household === a.household, "a young child of the household");
      const own = kid.plan.find((s) => s.pid === step.pid);
      assert.ok(own.led && own.at === step.at, "the child's own plan has the way too, led");
    }
    assert.ok(a.plan.filter((s) => s !== step).every((s) => s.at > step.at), "their own day begins at the school");
  }
  const mates = t.agents.filter((a) => a.role === "pupil" && a.plan.some((s) => s.with?.length && !s.escort));
  assert.ok(mates.length > 0, "pupils of a house who walk together");
  const shoppers = t.agents.filter((a) => a.profile.age !== "child" && a.plan.some((s) => s.purpose === "shopping" && s.with?.length));
  assert.ok(shoppers.length > 0, "people who go shopping with their partner or children");
  // on the way: those who come along are beside or behind their leader, and all are counted
  let together = 0, far = 0, seen = 0, slow = 0, counted = 0;
  const check = () => {
    for (const a of t.agents) {
      if (a.state !== "with") continue;
      together++;
      const lead = a.with;
      assert.ok(lead && lead.party && lead.party.members.includes(a) && lead.party.leader === lead);
      assert.equal(a.group, lead.group, "one group: they do not step aside for each other");
      if (lead.state !== "walking" || !lead.pos || !a.pos) continue;
      seen++;
      if (Math.hypot(a.pos[0] - lead.pos[0], a.pos[1] - lead.pos[1]) * 0.087 > 4.5) far++;
      if (lead.pace > 0 && lead.pace <= Math.min(...lead.party.members.map((m) => m.speed)) + 1e-9) slow++;
    }
  };
  runUntil(world, 8.5, () => {
    if (world.time % 2 < 0.26) check();
    counted = Math.max(counted, t.townStats().together);
  });
  assert.ok(together > 20, `people went along with others (${together} samples)`);
  assert.ok(seen > 10 && far === 0, "beside or behind their leader");
  assert.equal(slow, seen, "at the pace of the slowest");
  assert.ok(counted > 0, "the town counts them");
  assert.ok(t.pedestrians().length >= 0);
  // they arrived (the school is 350 m away: an hour on the fast clock): the children in the school, each with the trip in their own record
  runUntil(world, 9.6);
  const kids = escorts.flatMap((a) => a.plan.find((s) => s.escort).with.map((id) => t.agents.find((x) => x.id === id)));
  assert.ok(kids.filter((k) => k.inside === "school").length >= kids.length * 0.8, "the children are at school");
  const along = t.tripLog.filter((r) => r.along);
  assert.ok(along.length > 0 && along.every((r) => r.end === "arrived" && r.minutes > 0 && r.mode === "walk"));
  assert.ok(t.agents.every((a) => a.state !== "with" || a.with), "nobody left without a leader");
  // the adults who took them are on their own way again
  assert.ok(escorts.every((a) => !a.party || a.party.leader === a));
  // a card says who lives and goes with whom
  const parent = escorts[0], card = t.describeAgent(parent);
  assert.ok(card.rows.some((r) => r[0] === "Household" && /with /.test(r[1])));
  assert.ok(card.sections.find((s) => s.title === "Today").lines.some((l) => /, with /.test(l)));
  const child = kids[0];
  assert.ok(t.describeAgent(child).rows.some((r) => r[0] === "Age" && /years/.test(r[1])));
});

test("somebody led by another goes alone when nobody comes for them", () => {
  const world = createWorld(layout({ car_share: 0, bus_share: 0 }, { traffic: false, cycling: false, bus: false }), { seed: 11 });
  world.step(0.1);
  const t = townOf(world);
  const escort = t.agents.find((a) => a.plan.some((s) => s.escort));
  const step = escort.plan.find((s) => s.escort), kid = t.agents.find((x) => x.id === step.with[0]);
  // the adult stays in bed
  escort.plan = [];
  escort._dueFor = null;
  runUntil(world, (kid.plan.find((s) => s.pid === step.pid).at + 60) / 60);
  assert.ok(kid.state !== "with" && (kid.inside === "school" || kid.state === "walking"), `the child went by itself (${kid.state}, ${kid.inside})`);
  assert.ok(kid.trips.length || kid.record, "its own trip");
});

test("the choice of the mode: nobody drives or rides where it is switched off; where a line fits and it must, everybody rides", () => {
  const off = createWorld(layout({ car_share: 0, bus_share: 0 }, { cycling: false }), { seed: 5 });
  off.step(0.1);
  runUntil(off, 9);
  const t0 = townOf(off), s0 = t0.modalSplit();
  assert.ok(s0.trips > 30);
  assert.equal(s0.modes.car + s0.modes.transit + s0.modes.bike, 0, "all on foot");
  assert.equal(s0.shares.walk, 1);
  // everybody by bus where the line fits: the long ways to the office
  const bus = createWorld(layout({ car_share: 0, bus_share: 1 }, { cycling: false }), { seed: 5 });
  bus.step(0.1);
  runUntil(bus, 9);
  const t1 = townOf(bus);
  const toOffice = t1.tripLog.filter((r) => r.to === "office" && r.end === "arrived" && !r.along);
  assert.ok(toOffice.length > 5);
  assert.ok(toOffice.filter((r) => r.mode === "transit").length >= toOffice.length * 0.9, "to the office by bus");
  assert.ok(toOffice.filter((r) => r.mode === "transit").every((r) => r.parts.ride > 0 || r.gaveUp));
  // everybody who can by car
  const car = createWorld(layout({ car_share: 1, bus_share: 0 }, { cycling: false }), { seed: 5 });
  car.step(0.1);
  runUntil(car, 9);
  const t2 = townOf(car);
  const drove = t2.tripLog.filter((r) => r.mode === "car" && !r.along);
  assert.ok(drove.length > 5, `${drove.length} trips by car`);
  for (const r of drove) assert.ok(canDrive(t2.agents.find((a) => a.id === r.id).profile), "only who can drive");
  const couldNot = t2.tripLog.filter((r) => r.to === "office" && r.end === "arrived" && r.mode !== "car");
  for (const r of couldNot) {
    const a = t2.agents.find((x) => x.id === r.id);
    assert.ok(!canDrive(a.profile) || a.household.cars < a.household.members.filter((m) => canDrive(m.profile)).length || r.along, "who walked had no car to take");
  }
});

test("the choice of the mode: a mix by the length of the way; the record says what was weighed; the shares are counted", () => {
  const world = createWorld(layout({ stretch: 3 }), { seed: 5 });
  world.step(0.1);
  const t = townOf(world);
  runUntil(world, 9.5);
  const split = t.modalSplit(), long = t.modalSplit({ long: true });
  assert.ok(split.trips > 40 && long.trips > 10 && long.trips <= split.trips);
  assert.ok(Math.abs(MODE_KEYS.reduce((s, m) => s + split.shares[m], 0) - 1) < 0.003);
  assert.ok(MODE_KEYS.filter((m) => long.modes[m] > 0).length >= 3, `several modes on the long ways: ${JSON.stringify(long.modes)}`);
  assert.ok(long.shares.walk < split.shares.walk || split.shares.walk === long.shares.walk, "short ways are walked");
  assert.match(t.modalWords(), /On foot \d+ % · Bike \d+ % · Bus and tram \d+ % · Car \d+ %/);
  assert.equal(t.modalSplit({ purpose: "no such purpose" }).trips, 0);
  assert.ok(t.modalSplit({ from: 6, to: 8 }).trips <= split.trips);
  // a chosen trip says what was planned and expected, and what else was weighed
  const chosen = t.agents.flatMap((a) => a.trips).filter((r) => r.weighed);
  assert.ok(chosen.length > 10);
  for (const r of chosen) {
    assert.ok(r.weighed.some((o) => o.mode === r.mode) && r.weighed.some((o) => o.mode === "walk"));
    assert.ok(r.planned > 0 && r.expected > 0 && r.way);
  }
  // what it learned: its memory of the way, the town's experience, and its mood
  const someone = t.agents.find((a) => a.memory.ways.size > 0);
  assert.ok(someone, "people remember their ways");
  const [way, kept] = [...someone.memory.ways][0];
  assert.ok(kept.last && kept.modes[kept.last].n >= 1 && kept.modes[kept.last].ratio > 0, way);
  assert.ok(MODE_KEYS.some((m) => world.experience.trips[m] > 0), "the town heard of the trips");
  const card = t.describeAgent(someone);
  assert.ok(card.sections.some((s) => s.title === "Learned on its ways"));
  assert.ok(card.rows.some((r) => r[0] === "Bike"));
  // the CSV names the mode
  const csv = t.tripsCSV().split("\n");
  assert.match(csv[0], /,end,mode,went badly,with others$/);
  assert.ok(csv.slice(1).some((l) => /,(walk|bike|transit|car),/.test(l)));
});

test("by car and by bike on the streets: the town's own cars and riders are drawn, park and are fetched again", () => {
  const world = createWorld(layout({ car_share: 1, bus_share: 0 }, { cycling: false, more: [{ id: "lot", type: "parking-lot", name: "Parkplatz Kontor", position: [7000, -260], rotation_deg: 180, width_m: 40, depth_m: 16 }] }), { seed: 5 });
  world.step(0.1);
  const t = townOf(world), traffic = sim(world, "traffic");
  let own = 0, parkedOwn = 0, drivers = new Set();
  runUntil(world, 9, () => {
    for (const car of traffic.cars) {
      if (!car.owner) continue;
      own++;
      drivers.add(car.owner);
      assert.ok(t.agents.includes(car.owner) && car.owner.state === "driving" && car.owner.vehicleOwn === car, "its driver is one of the town, in it");
    }
    parkedOwn = Math.max(parkedOwn, traffic.parkedCars.filter((p) => p.owner).length);
  });
  assert.ok(own > 0 && drivers.size > 3, "cars of the town's own people on the street");
  assert.ok(parkedOwn > 0, "they park at the office");
  const atWork = t.agents.filter((a) => a.inside === "office" && a.carAt === "office");
  assert.ok(atWork.length > 0, "their car waits there");
  for (const a of atWork) assert.ok(a.household.carsHome < a.household.cars, "it is not at home for the others");
  const card = traffic.card({ ref: traffic.cars.find((c) => c.owner) ?? { v: 0, driver: atWork[0], passengers: [], purpose: "work", owner: atWork[0] } });
  assert.ok(card.rows.some((r) => r[0] === "Driver" && /lives in the town/.test(r[1])));
  // at night they are home again, with their cars
  runUntil(world, 23.6);
  const out = t.agents.filter((a) => a.house && a.carAt != null);
  assert.ok(out.length <= 2, `${out.length} cars still out`);
  for (const h of new Set(t.agents.map((a) => a.household).filter(Boolean))) assert.ok(h.carsHome >= h.cars - h.members.filter((m) => m.carAt != null).length);
  assert.ok(t.tripLog.some((r) => r.mode === "car" && r.purpose === "home" && r.parts.car > 0), "driven home");
  assert.equal(traffic.cars.filter((c) => c.owner && !t.agents.includes(c.owner)).length, 0);

  // by bike: where bikes are simulated, people ride them on the bike lane and lock them near the door
  const bikes = createWorld(layout({ car_share: 0, bus_share: 0, modes: { bike: { constant: -40 } } }), { seed: 5 });
  bikes.step(0.1);
  const tb = townOf(bikes), cycling = sim(bikes, "cycling");
  let riders = 0;
  runUntil(bikes, 9, () => {
    for (const r of cycling.riders) {
      if (!r.owner) continue;
      riders++;
      assert.ok(r.owner.bike && r.owner.state === "driving" && r.owner.vehicleOwn === r);
    }
  });
  assert.ok(riders > 0, "riders of the town on the street");
  assert.ok(tb.tripLog.some((r) => r.mode === "bike" && r.parts.bike > 0));
  assert.ok(tb.agents.some((a) => a.bikeAt === "office"), "the bike waits at the office");
  assert.ok(tb.townStats().cycling >= 0 && "cycling" in tb.townStats());
  assert.ok(tb.tripLog.filter((r) => r.mode === "bike").every((r) => tb.agents.find((a) => a.id === r.id).bike), "only who has a bike");
  runUntil(bikes, 23.6);
  assert.ok(tb.agents.filter((a) => a.house && a.bikeAt != null).length <= 2, "the bikes are home again");
});

test("without road traffic or bikes in the layout the time of a drive is counted, as before; setting the clock brings everything home", () => {
  const world = createWorld(layout({ car_share: 1, bus_share: 0 }, { traffic: false, cycling: false }), { seed: 5 });
  world.step(0.1);
  const t = townOf(world);
  let driving = 0;
  runUntil(world, 8.2, () => (driving = Math.max(driving, t.townStats().driving)));
  assert.ok(driving > 0, "people drive (not drawn)");
  assert.ok(t.agents.every((a) => a.state !== "driving" || a.vehicleOwn === null));
  runUntil(world, 9.5);
  assert.ok(t.tripLog.some((r) => r.mode === "car" && r.parts.car > 0));
  assert.ok(t.agents.some((a) => a.carAt === "office"));
  world.setTime("03:00");
  world.step(0.1);
  assert.ok(t.agents.every((a) => a.carAt == null && a.bikeAt == null && !a.party && !a.with), "everything at home again");
  assert.ok([...new Set(t.agents.map((a) => a.household).filter(Boolean))].every((h) => h.carsHome === h.cars));
});
