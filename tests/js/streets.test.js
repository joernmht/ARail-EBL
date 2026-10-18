// Streets in a wider sense (objects/street-profile.js, objects/road.js, objects/traffic-signs.js,
// core/network.js): the cross-sections and their standard widths by the German guidelines, what
// follows from widths below them, street parking, traffic signs, lights and zebra crossings in the
// road network, the settings the editors show, and who goes first at a junction.
import assert from "node:assert/strict";
import test from "node:test";

import {
  NORMS, ROAD_KINDS, approachPrio, createWorld, crossSection, lightAt, mustYield, parseArrows, profileOf, registry, roadKind, roomAfter, sharedConflict,
  squeezing, waitFor, widthChoices, GRIDLOCK_S,
} from "../../web/arail/index.js";
import { paramShape } from "../../web/app/ui.js";

/** The cross-section of a street's settings, as a street works it out. */
function xs(spec) {
  const kind = roadKind(spec.kind || "street");
  return crossSection({ ...spec, kind }, ROAD_KINDS[kind]);
}

/** The strips on one side, from the centre line out: "type from–to". */
const strips = (x) => x.strips.filter((s) => s.side > 0 && s.type !== "curb").map((s) => `${s.type} ${s.from}–${s.to}`);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ""} ${a} ≠ ${b}`);

function world(objects, extra = {}) {
  return createWorld({ objects, simulations: [], clock: { start: "10:00", profiles: false }, ...extra }, { seed: 4 });
}

test("cross-sections: the strips of each profile, with the standard widths of the guidelines", () => {
  // a street with sidewalks: 7 m of car lanes, 2.50 m sidewalks (RASt 06)
  const plain = xs({ profile: "plain" }), side = xs({});
  assert.equal(side.profile, "sidewalks", "the default for a street");
  assert.deepEqual(strips(plain), ["car-lane 0–3.5"]);
  assert.deepEqual(strips(side), ["car-lane 0–3.5", "sidewalk 3.5–6"]);
  assert.equal(side.half, 6);
  assert.equal(side.bike, "road");
  // bike lanes and paths make the street wider; the car lanes keep their width
  const advisory = xs({ profile: "advisory-lanes" }), lanes = xs({ profile: "bike-lanes" });
  const paths = xs({ profile: "bike-paths" }), shared = xs({ profile: "shared-paths" });
  assert.deepEqual(strips(advisory), ["car-lane 0–3.5", "advisory-lane 3.5–5", "sidewalk 5–7.5"]);
  assert.deepEqual(strips(lanes), ["car-lane 0–3.5", "bike-lane 3.5–5.35", "sidewalk 5.35–7.85"]);
  assert.deepEqual(strips(paths), ["car-lane 0–3.5", "buffer 3.5–4", "bike-path 4–6", "sidewalk 6–8.5"]);
  assert.deepEqual(strips(shared), ["car-lane 0–3.5", "buffer 3.5–4", "shared-path 4–6.5"]);
  for (const x of [advisory, lanes, paths, shared]) {
    assert.equal(x.carWidth, 7, "width_m is the car lanes'");
    assert.equal(x.laneWidth, 3.5);
    assert.deepEqual(x.warnings, []);
  }
  assert.deepEqual([advisory.bike, lanes.bike, paths.bike, shared.bike], ["advisory", "lane", "path", "shared"]);
  // bike paths and shared paths are at sidewalk level, bike lanes on the street
  assert.equal(lanes.strips.find((s) => s.type === "bike-lane").level, "street");
  assert.equal(paths.strips.find((s) => s.type === "bike-path").level, "sidewalk");
  // where each goes across the street: cars in the lane, bikes on their lane, people on the sidewalk
  assert.ok(lanes.laneOffset < lanes.bikeOffset && lanes.bikeOffset < lanes.walkOffset);
  near(lanes.bikeOffset, 3.5 + 1.85 / 2, "the middle of the bike lane");
  // a street with two lanes each way
  const two = xs({ lanes: 2, width_m: 13 });
  assert.deepEqual(strips(two), ["car-lane 0–3.25", "car-lane 3.25–6.5", "sidewalk 6.5–9"]);
  near(two.laneOffset, 6.5 - 3.25 / 2, "the outer lane");
  // footpaths: people only, shared with bikes, a bike path; a tram track of its own
  assert.deepEqual(strips(xs({ kind: "path" })), ["path 0–1.5"]);
  assert.equal(xs({ kind: "path" }).bike, "none");
  assert.equal(xs({ kind: "path", profile: "shared-paths" }).bike, "shared");
  assert.equal(xs({ kind: "path", profile: "bike-paths" }).bike, "path");
  const own = xs({ kind: "tram" });
  assert.deepEqual(strips(own), ["tram-bed 0–3.3"]);
  assert.equal(own.tram, "own");
  near(own.tramOffset, NORMS.tram.spacing / 2);
  assert.equal(xs({ kind: "tram", tram_tracks: "single" }).tramBed, NORMS.tram.bedSingle);
});

test("cross-sections: tram tracks in the street and parking strips", () => {
  // in the car lanes: no wider; the tracks in the middle of each lane
  const street = xs({ tram: "street" });
  assert.equal(street.half, 6);
  near(street.tramOffset, 3.5 / 2);
  assert.equal(xs({ tram: "street", tram_tracks: "single" }).tramOffset, 0, "one track in the middle");
  // lanes of their own (3.25 m each) or a track bed (6.60 m) in the middle, the car lanes beside them
  const lanes = xs({ tram: "lanes" }), median = xs({ tram: "median" });
  assert.deepEqual(strips(lanes).slice(0, 2), ["tram-lane 0–3.25", "car-lane 3.25–6.75"]);
  assert.deepEqual(strips(median).slice(0, 2), ["tram-bed 0–3.3", "car-lane 3.3–6.8"]);
  assert.equal(median.strips.find((s) => s.type === "tram-bed").level, "bed");
  near(median.tramOffset, NORMS.tram.spacing / 2);
  // parking strips (EAR 23): 2.00 m parallel, 4.35 m angled, 5.20 m perpendicular; a bike lane keeps 0.75 m from parked cars
  for (const [layout, depth] of [["parallel", 2], ["angled", 4.35], ["perpendicular", 5.2]]) {
    const x = xs({ parking: layout, width_m: 7 });
    assert.equal(x.parking.right.depth, depth);
    assert.equal(x.parking.right.layout, layout);
    near(x.half, 3.5 + depth + 2.5, layout);
  }
  const withLane = xs({ profile: "bike-lanes", parking: "parallel" });
  assert.deepEqual(strips(withLane).slice(1, 4), ["bike-lane 3.5–5.35", "buffer 5.35–6.1", "parking 6.1–8.1"]);
  const right = xs({ parking: "parallel", parking_sides: "right" });
  assert.ok(right.parking.right && !right.parking.left, "one side only");
});

test("cross-sections: widths below the guidelines are reported, and what follows from them", () => {
  // two cars cannot pass below 4.10 m; a narrow bike lane, advisory lane, bike path, sidewalk
  const narrow = xs({ profile: "bike-lanes", width_m: 4, bike_m: 1.2 });
  assert.deepEqual(narrow.warnings, [
    "Car lanes 4 m: two cars cannot pass each other (RASt 06: 4.10 m at least)",
    "Bike lane 1.2 m: below the minimum of 1.5 m (ERA 2010, VwV-StVO); bikes ride in the car lane",
  ]);
  assert.ok(narrow.obstruct, "a bike on a bike lane below its minimum holds up the cars");
  assert.deepEqual(xs({ profile: "advisory-lanes", width_m: 4.2, bike_m: 1.1 }).warnings, [
    "Advisory bike lane 1.1 m: below the minimum of 1.25 m (ERA 2010); bikes ride in the car lane",
    "Car lanes 4.2 m between advisory bike lanes: at least 4.5 m (ERA 2010)",
  ]);
  assert.deepEqual(xs({ profile: "bike-paths", bike_m: 1.2, sidewalk_m: 1.5 }).warnings, [
    "Bike path 1.2 m: below the minimum of 1.6 m (ERA 2010); riders use the sidewalk",
    "Sidewalk 1.5 m: below 1.8 m for two people to pass; people walk on the bike path",
  ]);
  assert.deepEqual(xs({ sidewalk_m: 1.5 }).warnings, ["Sidewalk 1.5 m: below the 2.5 m of RASt 06"]);
  assert.deepEqual(xs({ profile: "shared-paths", bike_m: 2 }).warnings, ["Shared path 2 m: below the minimum of 2.5 m (ERA 2010, VwV-StVO)"]);
  assert.deepEqual(xs({ lanes: 2, width_m: 9 }).warnings, ["Car lanes 2.25 m: two lanes in one direction need 5.00 m together (RASt 06)"]);
  assert.deepEqual(xs({ tram: "street", width_m: 5.5 }).warnings, ["Car lanes 2.75 m: a tram (2.65 m wide) needs lanes of at least 3.00 m"]);
  assert.deepEqual(xs({ parking: "perpendicular", width_m: 5.5 }).warnings, ["Perpendicular parking needs 6 m to drive in and out; the car lanes are 5.5 m"]);
  assert.deepEqual(xs({ kind: "tram", width_m: 5 }).warnings, ["Track bed 5 m: two tracks need at least 6.05 m (BOStrab)"]);
  // a car passes a bike at 1.5 m within its lane only on a lane of 4.60 m: bikes on the road of a
  // usual street hold up the cars; a bike lane or path does not
  assert.equal(xs({}).obstruct, true);
  assert.equal(xs({ profile: "bike-lanes" }).obstruct, false);
  assert.equal(xs({ profile: "bike-paths" }).obstruct, false);
  assert.equal(xs({ lanes: 2, width_m: 13 }).obstruct, false, "two lanes each way: the cars pass in the other lane");
  // riders and people on foot on a shared path: the narrower, the more often they meet with anger
  assert.equal(sharedConflict(2.5), 0.4);
  near(sharedConflict(3), 0.3);
  assert.equal(sharedConflict(4), 0.1);
  assert.equal(sharedConflict(6), 0.1);
  assert.equal(xs({ profile: "shared-paths" }).conflict, 0.4);
  assert.equal(xs({ profile: "bike-paths" }).conflict, 0.05, "a bike path wide enough beside a sidewalk wide enough");
  assert.equal(xs({ profile: "bike-paths", bike_m: 1.2, sidewalk_m: 1.5 }).conflict, 0.7);
});

test("the street's settings: old layouts by their sidewalks, the standard widths and the fields the editors show", () => {
  assert.equal(profileOf({}), "sidewalks");
  assert.equal(profileOf({ sidewalk_m: 0 }), "plain", "an old street without sidewalks");
  assert.equal(profileOf({ kind: "path" }), "plain");
  assert.equal(profileOf({ profile: "nonsense" }), "sidewalks");
  // the standard widths offered (RASt 06, ERA 2010, BOStrab)
  assert.deepEqual(widthChoices("width_m", {}), [4.5, 5.5, 6.5, 7]);
  assert.deepEqual(widthChoices("width_m", { lanes: 2 }), [10, 11, 13]);
  assert.deepEqual(widthChoices("width_m", { kind: "tram" }), [3.4, 6.6]);
  assert.deepEqual(widthChoices("width_m", { kind: "path" }), [2, 2.5, 3, 4]);
  assert.deepEqual(widthChoices("bike_m", { profile: "bike-lanes" }), NORMS.bikeLane.values);
  assert.deepEqual(widthChoices("bike_m", { profile: "advisory-lanes" }), NORMS.advisoryLane.values);
  assert.deepEqual(widthChoices("bike_m", { profile: "sidewalks" }), []);
  assert.deepEqual(widthChoices("sidewalk_m"), NORMS.sidewalk.values);
  // the fields: only those that fit the kind and the profile, the choices of the kind
  const params = registry.objects.get("road").params;
  const shape = (values) => JSON.parse(paramShape(params, values));
  const keys = (values) => shape(values).map(([k]) => k);
  assert.deepEqual(keys({ kind: "street" }), ["name", "kind", "profile", "width_m", "lanes", "sidewalk_m", "tram", "parking", "speed_kmh", "lamps", "crossings"]);
  assert.ok(keys({ kind: "street", profile: "bike-lanes" }).includes("bike_m"));
  assert.ok(!keys({ kind: "street", profile: "shared-paths" }).includes("sidewalk_m"), "a shared path is the sidewalk");
  assert.ok(keys({ kind: "street", tram: "median" }).includes("tram_tracks"));
  assert.ok(keys({ kind: "street", parking: "angled" }).includes("parking_tariff"));
  assert.ok(keys({ kind: "street", parking: "angled", parking_tariff: "hourly" }).includes("parking_price_eur"));
  assert.deepEqual(keys({ kind: "path" }), ["name", "kind", "profile", "width_m", "speed_kmh", "lamps"]);
  assert.deepEqual(keys({ kind: "tram" }), ["name", "kind", "width_m", "tram_tracks", "speed_kmh", "lamps"]);
  const profile = (values) => shape(values).find(([k]) => k === "profile")[1];
  assert.deepEqual(profile({ kind: "path" }), ["plain", "shared-paths", "bike-paths"]);
  assert.deepEqual(shape({ kind: "street" }).find(([k]) => k === "width_m")[2], [4.5, 5.5, 6.5, 7], "the standard widths to click");
  assert.notEqual(paramShape(params, { kind: "street" }), paramShape(params, { kind: "path" }), "the form is drawn anew");
  assert.equal(paramShape(params, { kind: "street", width_m: 7 }), paramShape(params, { kind: "street", width_m: 6.5 }), "a width alone does not change it");
});

test("streets in the road network: who may use an edge, and where across the street each goes", () => {
  const w = world([
    { id: "main", type: "road", name: "Main", profile: "bike-lanes", points: [[0, 0], [4000, 0]] },
    { id: "cross", type: "road", name: "Cross", points: [[2000, -1500], [2000, 1500]] },
    { id: "path", type: "road", name: "Path", kind: "path", profile: "shared-paths", points: [[0, 800], [1500, 800]] },
    { id: "foot", type: "road", name: "Foot", kind: "path", points: [[0, 1200], [1500, 1200]] },
    { id: "tramway", type: "road", name: "Tramway", kind: "tram", points: [[-1000, -2000], [3000, -2000]] },
  ]);
  const net = w.network();
  const edgeOf = (id) => net.edges.find((e) => e.road === id && e.kind !== "connector");
  const mm = (m) => (m * 1000) / w.scale;
  const main = edgeOf("main"), cross = edgeOf("cross"), path = edgeOf("path"), foot = edgeOf("foot"), tram = edgeOf("tramway");
  assert.deepEqual([main.car, main.bus, main.tram, main.bike, main.walk], [true, true, false, true, true]);
  assert.equal(main.bikeWay, "lane");
  near(main.bikeOffset, mm(3.5 + 1.85 / 2));
  assert.equal(main.obstruct, false);
  assert.equal(cross.bikeWay, "road");
  assert.equal(cross.obstruct, true, "bikes on a usual street hold up the cars");
  assert.deepEqual([path.car, path.bike, path.walk, path.bikeWay], [false, true, true, "shared"]);
  near(path.conflict, sharedConflict(3));
  assert.deepEqual([foot.bike, foot.walk], [false, true], "a footpath: people only");
  assert.deepEqual([tram.kind, tram.car, tram.bike, tram.walk, tram.tram], ["tram", false, false, false, true]);
  near(tram.tramOffset, mm(NORMS.tram.spacing / 2));
  // routes by mode: bikes take the shared path, not the footpath; trams only the tram track
  assert.ok(net.edges.filter((e) => e.road === "foot").every((e) => !e.bike));
  const a = net.nearestNode([0, 0], { mode: "car" }), b = net.nearestNode([4000, 0], { mode: "car" });
  assert.ok(net.route(a, b, { mode: "bike" }), "bikes ride along Main");
  assert.equal(net.route(a, b, { mode: "tram" }), null, "no tram tracks in Main");
});

test("street parking: spaces along the strip, none near junctions and at bus stops, a tariff", () => {
  const w = world([
    { id: "main", type: "road", name: "Main", parking: "parallel", parking_tariff: "hourly", points: [[0, 0], [4000, 0]] },
    { id: "cross", type: "road", name: "Cross", points: [[2000, -1500], [2000, 1500]] },
    { id: "stop", type: "bus-stop", name: "Stop", position: [800, -90] },
  ]);
  const main = w.getObject("main");
  const [right, left] = main.parkingInfo();
  assert.deepEqual([right.id, left.id], ["main:right", "main:left"]);
  assert.equal(right.label, "Main (right side)");
  assert.equal(right.tariff.label(), "1 € per hour", "street parking costs less than a lot");
  assert.equal(right.access, "public");
  const len = (5.7 * 1000) / w.scale, junction = 2000, gap = (5 * 1000) / w.scale;
  for (const f of [right, left]) {
    assert.equal(f.spaces, f.spots.length);
    // the spaces are a car's length apart, never on the junction or within 5 m of its edge
    for (const s of f.spots) assert.ok(Math.abs(s.s - junction) > len / 2 + gap, `a space at ${s.s}`);
  }
  // the bus stop (right side, 18 m) and 15 m before and after it
  const stop = w.getObject("stop").geometry, reach = stop.L / 2 + (15 * 1000) / w.scale;
  assert.ok(right.spots.every((s) => Math.abs(s.s - stop.s) >= reach + len / 2 - 1e-6), "no parking at the bus stop");
  assert.ok(left.spots.some((s) => Math.abs(s.s - stop.s) < reach), "the other side has no stop");
  assert.ok(left.spaces > right.spaces);
  // a yearly permit makes it residents' parking; world.parking keeps the facilities
  const w2 = world([{ id: "res", type: "road", parking: "angled", parking_sides: "right", parking_tariff: "yearly", points: [[0, 0], [3000, 0]] }]);
  const [res] = w2.getObject("res").parkingInfo();
  assert.equal(w2.getObject("res").parkingInfo().length, 1, "one side");
  assert.equal(res.access, "residents");
  assert.deepEqual(w2.parking.facilities().map((f) => f.id), ["res:right"]);
  // the street's card and its problems
  const card = w.card({ kind: "object", ref: main, owner: main, label: main.name });
  const rows = Object.fromEntries(card.rows);
  assert.equal(rows["Cross-section"], "with sidewalks");
  assert.equal(rows["Car lanes"], "2 × 3.5 m");
  assert.match(rows.Parking, /^\d+ spaces · 1 € per hour$/);
  assert.deepEqual(main.problems(), []);
});

test("traffic lights: the main street and the street across get green in turn; only on a junction", () => {
  const w = world([
    { id: "main", type: "road", name: "Main", points: [[0, 0], [4000, 0]] },
    { id: "cross", type: "road", name: "Cross", points: [[2000, -1500], [2000, 1500]] },
    { id: "light", type: "traffic-light", position: [2000, 0], cycle_s: 60, split: 50, main: "main" },
    { id: "off", type: "traffic-light", position: [900, 900] },
  ]);
  const light = w.getObject("light");
  const at = (t) => `${light.state(0, t)}/${light.state(1, t)}`;
  // main: green 25 s, amber 3 s, all red 2 s; then the street across: red-amber 1 s, green, amber, all red
  assert.equal(at(0), "green/red");
  assert.equal(at(24.9), "green/red");
  assert.equal(at(26), "amber/red");
  assert.equal(at(29), "red/red", "all red");
  assert.equal(at(30.5), "red/red-amber");
  assert.equal(at(40), "red/green");
  assert.equal(at(56), "red/amber");
  assert.equal(at(59.5), "red-amber/red");
  assert.equal(at(60), at(0), "the cycle repeats");
  // offset_s shifts the cycle (a green wave)
  light.set({ offset_s: 30 });
  assert.equal(light.state(0, 0), "red");
  light.set({ offset_s: 0, split: 70 });
  assert.equal(light.state(0, 35), "green", "70 % of the cycle for the main street");
  // the road network puts it on the junction: an approach along the main street and across it
  const net = w.network(), sig = net.signalOf("light");
  assert.ok(sig);
  assert.deepEqual(sig.approaches.map((a) => a.group).sort(), [0, 0, 1, 1]);
  assert.equal(net.signalOf("off"), null);
  assert.deepEqual(w.getObject("off").problems(), ["Not on a junction: move the traffic lights onto a junction of three or more streets."]);
  assert.deepEqual(light.problems(), []);
  // what a vehicle sees: green 2, red 0 (the street across: green from 42 s to 55 s of the cycle now)
  const j = { signal: { obj: light, group: 1 } };
  assert.equal(lightAt(j, 50), "green");
  assert.equal(approachPrio(j, 50), 2);
  assert.equal(approachPrio(j, 0), 0);
  assert.equal(approachPrio({ prio: 2 }, 0), 2, "a priority road");
  assert.equal(approachPrio({ rule: { giveWay: true } }, 0), 0, "give way or Stop");
  assert.equal(lightAt({}, 0), "green", "no lights");
});

test("traffic signs and zebra crossings: one-way streets, lane arrows, no stopping, people crossing", () => {
  const w = world([
    { id: "main", type: "road", name: "Main", parking: "parallel", points: [[0, 0], [4000, 0]] },
    { id: "cross", type: "road", name: "Cross", points: [[2000, -1500], [2000, 1500]] },
    { id: "oneway", type: "traffic-sign", sign: "one-way", position: [500, -150] },
    { id: "nostop", type: "traffic-sign", sign: "no-stopping", zone_m: 40, position: [2600, -150] },
    { id: "zebra", type: "zebra-crossing", position: [3300, 0] },
    { id: "far", type: "traffic-sign", sign: "stop", position: [9000, 9000] },
  ]);
  assert.deepEqual(parseArrows("left | straight right"), [["left"], ["straight", "right"]]);
  assert.deepEqual(parseArrows(""), [], "no lanes");
  // a sign belongs to the traffic on its side: south of a street drawn west to east, the eastbound
  const rule = w.getObject("oneway").trafficRule();
  assert.deepEqual([rule.road, rule.dir, rule.sign], ["main", 1, "one-way"]);
  const net = w.network();
  const before = net.edges.filter((e) => e.road === "main" && e.kind === "road" && e.points[0][0] < 2000);
  const after = net.edges.filter((e) => e.road === "main" && e.kind === "road" && e.points[0][0] >= 2000);
  assert.ok(before.length && before.every((e) => e.carDir === 1), "one way up to the next junction");
  assert.ok(after.every((e) => e.carDir === 0), "beyond the junction: both ways");
  // no stopping: no parking in its zone, on its side
  const s = w.getObject("nostop").noParking(w.getObject("main"), "right");
  assert.equal(s.length, 1);
  const zone = (40 * 1000) / w.scale;
  near(s[0][1] - s[0][0], zone);
  assert.equal(w.getObject("nostop").noParking(w.getObject("main"), "left"), null);
  const right = w.getObject("main").parkingInfo().find((f) => f.side === "right");
  assert.ok(right.spots.every((p) => p.s < s[0][0] || p.s > s[0][1]), "no space in the zone");
  // zebra crossing: on the street, nobody parks on it or 5 m before it; vehicles stop while people cross
  const z = w.getObject("zebra");
  assert.ok(z.geometry.ok);
  const [[z0, z1]] = z.noParking(w.getObject("main"));
  near(z1 - z0, (4 + 2 * 5) * 1000 / w.scale, "4 m wide and 5 m on each side");
  assert.equal(z.busy(), false, "nobody walks");
  const edge = net.edges.find((e) => e.road === "main" && e.zebras?.length);
  assert.ok(edge, "the road network knows the zebra crossing");
  assert.ok(right.spots.every((p) => p.s < z0 || p.s > z1));
  // a sign away from the streets says so
  assert.deepEqual(w.getObject("far").problems(), ["Not next to a street: move the sign to the side of a street."]);
  assert.deepEqual(w.getObject("oneway").problems(), []);
  const card = Object.fromEntries(w.card({ kind: "object", ref: z, owner: z, label: z.name }).rows);
  assert.equal(card.Now, "nobody is crossing");
});

test("junctions: who goes first, keeping the junction clear, and squeezing past in a circle", () => {
  const j = { key: "j1", pos: [0, 0], r: 50 };
  const user = (vehicle, front, approach) => ({ vehicle, front, rear: [front[0] - 40, front[1]], approach });
  const me = { kind: "car", seq: 5 };
  // somebody in the junction: wait
  assert.equal(mustYield(me, j, 300, [user({ kind: "car", seq: 1 }, [10, 0])]), true);
  // coming with a higher priority: wait; with a lower one: go
  assert.equal(mustYield(me, j, 300, [user({ kind: "car", seq: 1 }, [0, 500], { key: "j1", d: 600, prio: 2 })]), true);
  assert.equal(mustYield(me, j, 300, [user({ kind: "car", seq: 1 }, [0, 500], { key: "j1", d: 200, prio: 0 })]), false);
  // the same priority: the closer one first; as close: tram, bus, car, bike, then the one made first
  assert.equal(mustYield(me, j, 300, [user({ kind: "car", seq: 9 }, [0, 500], { key: "j1", d: 200 })]), true);
  assert.equal(mustYield(me, j, 300, [user({ kind: "car", seq: 9 }, [0, 500], { key: "j1", d: 400 })]), false);
  assert.equal(mustYield(me, j, 300, [user({ kind: "tram", seq: 9 }, [0, 500], { key: "j1", d: 300 })]), true);
  assert.equal(mustYield(me, j, 300, [user({ kind: "bike", seq: 1 }, [0, 500], { key: "j1", d: 300 })]), false);
  assert.equal(mustYield(me, j, 300, [user({ kind: "car", seq: 4 }, [0, 500], { key: "j1", d: 300 })]), true);
  assert.equal(mustYield(me, j, 300, [user({ kind: "car", seq: 6 }, [0, 500], { key: "j1", d: 300 })]), false);
  assert.equal(mustYield(me, j, 300, [user({ kind: "car", seq: 1 }, [0, 500], { key: "j2", d: 10 })]), false, "another junction");
  // room behind the junction (StVO § 11): a car standing just behind it leaves none, a moving one does
  const self = { kind: "car" };
  const standing = { vehicle: { kind: "car", v: 0 }, front: [110, 0], rear: [70, 0], dir: [1, 0], speed: 0 };
  assert.equal(roomAfter(self, [50, 0], [1, 0], [standing], 50, 20), false);
  assert.equal(roomAfter(self, [50, 0], [1, 0], [{ ...standing, speed: 5 }], 50, 20), true);
  assert.equal(roomAfter(self, [50, 0], [1, 0], [], 50, 20), true);
  // two vehicles that wait for each other squeeze past after GRIDLOCK_S
  const a = { v: 0 }, b = { v: 0 };
  let t = 0;
  for (; t < GRIDLOCK_S + 1 && !squeezing(a) && !squeezing(b); t += 0.1) {
    waitFor(a, { vehicle: b }, 0.1);
    waitFor(b, { vehicle: a }, 0.1);
  }
  assert.ok(squeezing(a) || squeezing(b), "one squeezes past");
  assert.ok(t > GRIDLOCK_S - 0.2, `not before ${GRIDLOCK_S} s (${t})`);
  const c = { v: 0 }, d = { v: 0 };
  for (let k = 0; k < 200; k++) waitFor(c, { vehicle: d }, 0.1);
  assert.equal(squeezing(c), false, "waiting behind one that does not wait for it is no gridlock");
});
