import assert from "node:assert/strict";
import test from "node:test";

import { LayoutObject, Registry, registerBuiltins, World, rectFootprint, resolvePoint } from "../../web/arail/index.js";
import { INTERVALS_MIN, regularInterval } from "../../web/arail/sims/town.js";

/** A minimal building with the building API the town needs (capacity, use, entrances). */
class Box extends LayoutObject {
  static type = "test-box";
  static params = [{ key: "use", type: "text", default: "residential" }, { key: "people", type: "number", default: 100 }];
  computeGeometry() {
    const c = resolvePoint(this.world.map, this.spec.position);
    return c ? { center: c, footprint: rectFootprint(c, 100, 80) } : null;
  }
  footprint() {
    return this.geometry?.footprint || null;
  }
  use() {
    return this.spec.use;
  }
  capacity() {
    const n = +this.spec.people;
    return { residential: { residents: n }, work: { jobs: n }, school: { pupils: n, jobs: 10 }, shop: { visitors: n, jobs: 5 } }[this.spec.use] || {};
  }
  entrances() {
    const c = this.geometry.center;
    return [{ pos: [c[0], c[1] - 40], dir: [0, -1] }];
  }
}

function townWorld(extra = {}) {
  const registry = registerBuiltins(new Registry());
  registry.registerObject(Box);
  const layout = {
    objects: [
      { id: "home-1", type: "test-box", position: [0, 600], use: "residential", people: 300 },
      { id: "home-2", type: "test-box", position: [300, 600], use: "residential", people: 200 },
      { id: "office", type: "test-box", position: [900, 600], use: "work", people: 400 },
      { id: "school", type: "test-box", position: [600, 900], use: "school", people: 200 },
      { id: "shop", type: "test-box", position: [600, 300], use: "shop", people: 50 },
      { id: "p1", type: "platform", from: [0, 0], to: [800, 0], width_mm: 60, sides: "both" },
    ],
    simulations: [{ type: "passengers", base_rate: 0 }, { type: "town", people_per_100: 20 }],
    clock: { start: "05:00", factor: 12 },
    ...extra,
  };
  const world = new World({ registry, layout, seed: 3 });
  world.speed = 10;
  return world;
}

/** Run until the clock shows `hhmm` (same day). */
function runUntil(world, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const target = h * 60 + m;
  let guard = 0;
  while (world.clock.minutes < target && guard++ < 1e6) world.step(0.1);
}

const town = (w) => w.simulations.find((s) => s.constructor.type === "town");

test("town: people leave home in the morning and reach work, school and the train", () => {
  const world = townWorld();
  world.step(0.1);
  const t = town(world);
  assert.ok(t.agents.length > 50, `${t.agents.length} people`);
  const start = t.townStats();
  assert.equal(start.home, t.agents.filter((a) => a.role !== "visitor").length, "everybody at home at 05:00 (visitors away)");
  runUntil(world, "09:30");
  const s = t.townStats();
  assert.ok(s.work > 10, `at work: ${JSON.stringify(s)}`);
  assert.ok(s.school > 3, `at school: ${JSON.stringify(s)}`);
  assert.ok(world.occupancy.get("office") > 0, "office occupied");
  const commuters = t.agents.filter((a) => a.role === "commuter");
  assert.ok(commuters.length > 0);
  assert.ok(commuters.filter((a) => a.state === "away").length >= commuters.length * 0.6, "commuters took the train");
  const visitors = t.agents.filter((a) => a.role === "visitor" && a.visit === "work");
  assert.ok(visitors.length > 0);
  assert.ok(visitors.filter((a) => a.state === "inside" && a.inside === "office").length >= visitors.length * 0.5, "visitors came by train to work");
  const pupils = t.agents.filter((a) => a.role === "visitor" && a.visit === "school");
  assert.ok(pupils.length > 0 && pupils.filter((a) => a.state === "inside" && a.inside === "school").length >= pupils.length * 0.5, "pupils came by train to school");
  // nobody lost
  for (const a of t.agents) assert.ok(["inside", "walking", "stop", "riding", "away"].includes(a.state), a.state);
});

test("town: in the evening people are home again and the homes are lit", () => {
  const world = townWorld();
  runUntil(world, "20:00");
  const t = town(world);
  const s = t.townStats();
  const residents = t.agents.filter((a) => a.role !== "visitor").length;
  assert.ok(s.home >= residents * 0.8, `home: ${JSON.stringify(s)} of ${residents}`);
  const visitors = t.agents.filter((a) => a.role === "visitor");
  assert.ok(visitors.every((a) => a.state === "away" || a.state === "walking" || a.state === "stop"), "visitors left");
  assert.ok((world.occupancy.get("home-1") || 0) > (world.occupancy.get("office") || 0));
});

test("town: setting the clock re-places everybody; runs are deterministic", () => {
  const a = townWorld(), b = townWorld();
  runUntil(a, "08:00");
  runUntil(b, "08:00");
  assert.deepEqual(town(a).townStats(), town(b).townStats());
  a.setTime("12:00");
  a.step(0.1);
  const s = town(a).townStats();
  assert.equal(s.walking + s.waiting + s.riding, 0, "nobody on the way right after a jump");
  assert.ok(s.work > 0 && s.school > 0);
  const pax = a.simulations.find((x) => x.constructor.type === "passengers");
  assert.equal([...pax.crowds.values()].flatMap((c) => c.people).filter((p) => p.agent).length, 0);
});

test("town: the occupancy of a building is the people inside, also after the clock was set", () => {
  const world = townWorld();
  const t = town(world);
  const check = (when) => {
    const inside = new Map();
    for (const a of t.agents) if (a.state === "inside") inside.set(a.inside, (inside.get(a.inside) || 0) + 1);
    for (const id of ["home-1", "home-2", "office", "school", "shop"]) {
      const want = (inside.get(id) || 0) * t._personWeight();
      assert.ok(Math.abs(world.occupancy.get(id) - want) < 1e-6, `${when}: ${id} occupancy ${world.occupancy.get(id)}, people inside ${want}`);
    }
  };
  runUntil(world, "09:30");
  check("09:30");
  // a jump re-places everybody: at home late in the evening, at work and school in the morning
  world.setTime("22:00");
  world.step(0.1);
  check("set to 22:00");
  world.setTime("10:00");
  world.step(0.1);
  check("set to 10:00");
});

test("town: works without platforms, schools or shops", () => {
  const world = townWorld({
    objects: [
      { id: "home-1", type: "test-box", position: [0, 600], use: "residential", people: 100 },
      { id: "office", type: "test-box", position: [900, 600], use: "work", people: 50 },
    ],
  });
  runUntil(world, "10:00");
  const t = town(world);
  assert.ok(t.agents.every((a) => a.role !== "commuter" && a.role !== "visitor" && a.role !== "pupil"));
  assert.ok(t.townStats().work > 0);
  world.removeObject("office");
  runUntil(world, "12:00");
  assert.ok(t.agents.every((a) => a.inside !== "office"));
});

test("town: works with the built-in house types and lights their windows by occupancy", () => {
  const registry = registerBuiltins(new Registry());
  const world = new World({
    registry, seed: 5,
    layout: {
      objects: [
        { id: "wbs", type: "plattenbau", position: [0, 600], sections: 3 },
        { id: "estate", type: "house-estate", points: [[-400, 900], [400, 900], [400, 1300], [-400, 1300]] },
        { id: "office", type: "office", position: [900, 600] },
        { id: "school", type: "school", position: [600, 1100] },
        { id: "market", type: "supermarket", position: [700, 250] },
        { id: "p1", type: "platform", from: [0, 0], to: [800, 0], width_mm: 60, sides: "both" },
      ],
      simulations: [{ type: "passengers", base_rate: 0 }, { type: "town" }],
      clock: { start: "05:30", factor: 12 },
    },
  });
  world.speed = 10;
  runUntil(world, "10:00");
  const t = town(world);
  const homes = new Set(t.agents.filter((a) => a.home?.kind === "layout").map((a) => a.home.building));
  assert.ok(homes.has("wbs") && homes.has("estate"), `homes ${[...homes]}`);
  const s = t.townStats();
  assert.ok(s.work > 0 && s.school > 0, JSON.stringify(s));
  const office = world.getObject("office");
  assert.ok(office.occupancy() > 0.05, `office occupancy ${office.occupancy()}`);
  assert.ok(world.getObject("wbs").occupancy() < 0.9);
  runUntil(world, "22:00");
  assert.equal(office.occupancy(), 0, "office empty at night");
  assert.ok(world.getObject("wbs").occupancy() > 0.5, `homes full at night ${world.getObject("wbs").occupancy()}`);
});

/** The town of `townWorld` with other objects, built (the population is made on the first step). */
function built(objects, config = {}) {
  const world = townWorld({ objects, simulations: [{ type: "passengers", base_rate: 0 }, { type: "town", people_per_100: 20, ...config }] });
  world.step(0.1);
  return { world, t: town(world) };
}

const HOMES = [
  { id: "home-1", type: "test-box", position: [0, 600], use: "residential", people: 300 },
  { id: "home-2", type: "test-box", position: [300, 600], use: "residential", people: 200 },
  { id: "p1", type: "platform", from: [0, 0], to: [800, 0], width_mm: 60, sides: "both" },
];
const roles = (t) => t.agents.reduce((m, a) => ((m[a.role] = (m[a.role] || 0) + 1), m), {});

test("town: a workplace or a shop among the homes brings nobody new; its places go to the residents", () => {
  const before = built(HOMES);
  const after = built([...HOMES, { id: "office", type: "test-box", position: [600, 600], use: "work", people: 100 }, { id: "shop", type: "test-box", position: [600, 300], use: "shop", people: 20 }]);
  const d0 = before.t.demand.totals, d1 = after.t.demand.totals;
  assert.equal(d1.residents, 500);
  assert.equal(d1.jobsLocal, 105, "all 105 jobs (100 at the office, 5 at the shop) taken by the residents");
  assert.ok(Math.abs(d0.out - d1.out - 105) < 1e-6, `105 fewer work elsewhere (${d0.out.toFixed(0)} → ${d1.out.toFixed(0)})`);
  assert.equal(d1.inWork, 0, "nobody comes from elsewhere to work");
  assert.equal(d1.inShopping, 0, "the residents fill the shop");
  assert.equal(after.t.agents.length, before.t.agents.length, "as many people as before");
  assert.ok(roles(after.t).worker > 0 && roles(after.t).commuter < roles(before.t).commuter, JSON.stringify([roles(before.t), roles(after.t)]));
  // the building's card says who takes its places
  const card = { rows: [] };
  after.t.describeObject(after.world.getObject("office"), card);
  assert.deepEqual(card.rows, [["Jobs", "100 from the town · 0 from elsewhere · 0 empty"]]);
});

test("town: a workplace beyond the local area draws people from elsewhere, by train", () => {
  // 30 m of layout = about 2.6 km: beyond the local area of 1500 m, and no bus line
  const far = built([...HOMES, { id: "works", type: "test-box", position: [30000, 600], use: "work", people: 100 }]);
  const d = far.t.demand.totals;
  assert.equal(d.jobsLocal, 0, "the residents do not get there");
  assert.ok(Math.abs(d.inWork - 60) < 1e-6, `60 % of the empty jobs taken from elsewhere: ${d.inWork}`);
  const visitors = far.t.agents.filter((a) => a.role === "visitor");
  assert.ok(visitors.length > 0 && visitors.every((a) => a.job === "works" && a.visit === "work"));
  // the same works within the local area: taken by the residents
  const near = built([...HOMES, { id: "works", type: "test-box", position: [30000, 600], use: "work", people: 100 }], { catchment_m: 5000 });
  assert.equal(near.t.demand.totals.jobsLocal, 100);
});

test("town: pupils without a school place go to school elsewhere; empty school places draw pupils from elsewhere", () => {
  const none = built(HOMES);
  assert.ok(Math.abs(none.t.demand.totals.pupilsOut - 75) < 1e-6, "15 % of 500 residents");
  assert.ok(none.t.agents.some((a) => a.role === "commuter" && a.visit === "school"));
  const big = built([...HOMES, { id: "school", type: "test-box", position: [600, 900], use: "school", people: 200 }]);
  const d = big.t.demand.totals;
  assert.equal(d.pupilsOut, 0);
  assert.ok(Math.abs(d.inSchool - (200 - 75) * 0.6) < 1e-6, `${d.inSchool} pupils from elsewhere`);
  // without a platform nobody comes or goes by train: the places stay empty, the pupils at home
  const island = built(HOMES.filter((o) => o.type !== "platform").concat([{ id: "school", type: "test-box", position: [600, 900], use: "school", people: 50 }]));
  assert.equal(island.t.demand.totals.inSchool, 0);
  assert.ok(island.t.agents.every((a) => a.role !== "commuter" && a.role !== "visitor"));
});

test("town: a platform added later makes the balance go by train", () => {
  const { world, t } = built(HOMES.filter((o) => o.type !== "platform"));
  assert.equal(t.demand.totals.out, 0, "no platform: nobody works elsewhere");
  world.addObject(HOMES.find((o) => o.type === "platform"));
  world.step(0.1);
  assert.ok(t.demand.totals.out > 0, "the town is worked out again with the platform");
  assert.ok(t.agents.some((a) => a.role === "commuter"));
});

test("passengers: a stop's card names how often trains and buses stop, also when the intervals are alike", () => {
  const { world } = built([
    ...HOMES.map((o) => (o.type === "platform" ? { ...o, headway_s: 50 } : o)),
    { id: "bt", type: "bus-terminal", position: [400, -400], bays: 1, headway_s: 50 },
  ]);
  const pax = world.simulations.find((s) => s.constructor.type === "passengers");
  const rows = pax._intervalRows([world.getStopArea("p1"), world.getStopArea("bt")]);
  assert.deepEqual(rows, [["Trains", "every 10 min (set)"], ["Buses", "every 10 min (set)"]]);
});

test("town: the cap scales residents and visitors alike", () => {
  const all = built([...HOMES, { id: "works", type: "test-box", position: [30000, 600], use: "work", people: 1000 }]);
  const capped = built([...HOMES, { id: "works", type: "test-box", position: [30000, 600], use: "work", people: 1000 }], { max_people: 60 });
  const share = (t) => t.agents.filter((a) => a.role === "visitor").length / t.agents.length;
  assert.ok(capped.t.agents.length <= 62, `${capped.t.agents.length} people`);
  assert.ok(Math.abs(share(capped.t) - share(all.t)) < 0.1, `visitors ${share(capped.t).toFixed(2)} of the capped town, ${share(all.t).toFixed(2)} of the full one`);
});

test("regular intervals: the longest of 5, 10, 15, 20, 30 and 60 minutes that carries the busiest hour", () => {
  assert.deepEqual(INTERVALS_MIN, [5, 10, 15, 20, 30, 60]);
  assert.equal(regularInterval(0, 140), 60, "at least once an hour");
  assert.equal(regularInterval(100, 140), 60);
  assert.equal(regularInterval(600, 140), 20, "600 an hour in the rush, 400 by day: 3 trains an hour");
  assert.equal(regularInterval(600, 140, 2), 30, "from two docks");
  assert.equal(regularInterval(100000, 50), 5, "never more often than every 5 minutes");
});

test("town: the timetable and the lines run as often as the town needs, unless they are set", () => {
  const { world, t } = built(HOMES);
  const dock = world.getStopArea("p1").docks[0];
  assert.equal(dock.auto, true);
  const iv = world.services.intervalOf(dock);
  assert.equal(iv.from, "demand");
  assert.ok(INTERVALS_MIN.includes(iv.minutes), `${iv.minutes} min`);
  assert.ok(Math.abs(iv.headway - (iv.minutes * 60) / world.clock.factor) < 1e-9, "in simulated seconds");
  assert.ok(t.serviceInterval({ kind: "rail" }).riders > 0);
  // a platform with an interval of its own keeps it
  world.getObject("p1").set({ headway_s: 50 });
  world.step(0.1);
  const own = world.getStopArea("p1").docks[0];
  assert.deepEqual(world.services.intervalOf(own), { headway: 50, minutes: 10, from: "set" });
  // the others at a platform follow the residents: a few an hour, not a crowd
  const perHour = (t.othersAt(world.getStopArea("p1")) * 3600) / world.clock.factor;
  assert.ok(perHour > 0 && perHour < 10, `${perHour.toFixed(1)} other passengers an hour`);
});

test("passengers: with a town the other passengers follow its residents, without one base_rate", () => {
  const withTown = built(HOMES);
  const pax = withTown.world.simulations.find((s) => s.constructor.type === "passengers");
  pax.config.base_rate = 0.5;
  pax._sync();
  const crowd = pax.crowds.get("p1");
  const wave = crowd.wave() / 0.65;
  assert.ok(Math.abs(pax._othersRate(crowd) - withTown.t.othersAt(crowd.area) * wave) < 1e-12);
  const plain = townWorld({ objects: HOMES, simulations: [{ type: "passengers", base_rate: 0.5 }] });
  plain.step(0.1);
  const p2 = plain.simulations[0], c2 = p2.crowds.get("p1");
  assert.ok(Math.abs(p2._othersRate(c2) - 0.5 * c2.wave() * (c2.area.L / 25)) < 1e-12);
  assert.ok(p2._othersRate(c2) > 20 * pax._othersRate(crowd), "the town of 500 sends far fewer than the fixed rate");
});
