import assert from "node:assert/strict";
import test from "node:test";

import { LayoutObject, Registry, registerBuiltins, World, rectFootprint, resolvePoint } from "../../web/arail/index.js";

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
      { id: "office", type: "test-box", position: [900, 600], use: "work", people: 150 },
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
  const visitors = t.agents.filter((a) => a.role === "visitor");
  assert.ok(visitors.length > 0);
  assert.ok(visitors.filter((a) => a.state === "inside" && a.inside === "office").length >= visitors.length * 0.5, "visitors came by train to work");
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
