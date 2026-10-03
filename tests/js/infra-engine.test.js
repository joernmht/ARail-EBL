// Infrastructure simulation without the world (web/arail/infra/): condition grades, settings and their
// validation, the network as a small GIS (km, georeference, GeoJSON), assets with their wear, faults and
// what is known of them, the shifts of the staff, faults reported and repaired, inspections, proposals
// and projects through the HOAI phases with funding, procurement and the level crossing plant, decisions
// of the roles, years and their score, saving and replaying a game.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSET_TYPES, Asset, GENERATIONS, INFRA_DEFAULTS, InfraEngine, METHODS, Network, PROJECT_STAGES, Plant, ROLE_IDS, YEAR, annuityFactor, assetRecord,
  createRng, gradeColour, gradeOf, gradeValue, healthAfter, healthAtAge, healthOf, ifcGuid, infraShiftOf, makePeople, normalizeInfra, onCallPerson,
  scenariosOf, toGeoJSON, utmToLonLat, validateInfra, wearRate, weekdayOf,
} from "../../web/arail/index.js";

const DAY = 1440;
/** Every role played by the computer: decisions are taken at once. */
const COMPUTER = Object.fromEntries(ROLE_IDS.map((r) => [r, "computer"]));
const engine = (config = {}, opts = {}) => new InfraEngine({ roles: COMPUTER, ...config }, { seed: 7, ...opts });

test("condition grades run from 1.0 (as new) to 5.99, grade 6 is an open fault", () => {
  assert.equal(gradeValue(1), 1);
  assert.ok(Math.abs(gradeValue(0) - 5.99) < 1e-9);
  assert.equal(gradeOf(1), 1);
  assert.equal(gradeOf(0), 5);
  assert.equal(gradeOf(0.5), 3);
  for (const h of [0, 0.13, 0.5, 0.77, 1]) assert.ok(Math.abs(healthOf(gradeValue(h)) - h) < 1e-9);
  assert.notEqual(gradeColour(1), gradeColour(5));
  assert.match(gradeColour(null), /150,156,166/);
});

test("the wear law: an asset maintained as usual reaches grade 4 at the end of its service life", () => {
  for (const life of [12, 30, 50]) {
    assert.ok(Math.abs(healthAtAge(life, life) - 0.3) < 1e-9);
    assert.equal(gradeOf(healthAtAge(life, life)), 4);
    // the wear from a health on is the same law
    const h = healthAtAge(life / 3, life);
    assert.ok(Math.abs(healthAfter(h, (2 * life) / 3, wearRate(life)) - 0.3) < 1e-9);
  }
  assert.ok(healthAtAge(0, 30) === 1);
});

test("asset types have an IFC 4.3 class, a discipline, costs and a default inspection", () => {
  for (const [id, t] of Object.entries(ASSET_TYPES)) {
    assert.equal(t.ifc.length, 2, id);
    assert.match(t.ifc[0], /^Ifc[A-Z]\w+$/, id);
    assert.ok(t.renew_eur > 0 && t.repair_h > 0 && t.fail_per_y > 0, id);
    assert.ok(METHODS[t.inspect.method], id);
    if (METHODS[t.inspect.method].types) assert.ok(METHODS[t.inspect.method].types.includes(id), id);
  }
  // the classes that IFC4X3_ADD2 has for railway parts
  assert.deepEqual(ASSET_TYPES.track.ifc, ["IfcRailwayPart", "PLAINTRACK"]);
  assert.deepEqual(ASSET_TYPES.turnout.ifc, ["IfcRailwayPart", "TURNOUTTRACK"]);
  assert.deepEqual(ASSET_TYPES["level-crossing"].ifc, ["IfcFacilityPart", "LEVELCROSSING"]);
  assert.deepEqual(ASSET_TYPES.balise.ifc, ["IfcCommunicationsAppliance", "TRANSPONDER"]);
  assert.equal(ifcGuid("signal-n1").length, 22);
  assert.equal(ifcGuid("signal-n1"), ifcGuid("signal-n1"));
  assert.notEqual(ifcGuid("signal-n1"), ifcGuid("signal-n2"));
});

test("settings: defaults, the example network, validation in plain words", () => {
  const m = normalizeInfra({});
  assert.equal(m.lines.length, 2);
  assert.equal(m.placement.station, "bahnhof");
  assert.equal(m.stations.find((s) => s.id === "bahnhof").on_layout, true);
  assert.deepEqual(m.hoai.shares, [2, 20, 25, 8, 15, 10, 4, 15, 1]);
  assert.equal(m.hoai.shares.reduce((s, v) => s + v, 0), 100);
  assert.equal(m.procurement.eu_works_eur, 5_404_000);
  assert.equal(m.roles.planner, "student");
  assert.deepEqual(validateInfra({}, { objects: [] }), []);
  const bad = validateInfra({
    lines: [{ id: "A", km: [5, 1], path: [[0, 0, 0]] }], stations: [{ id: "x", line: "B" }], roles: { boss: "student", planner: "robot" },
    assets: [{ id: "q", type: "teleporter", line: "A", km: 1 }, { id: "r", type: "signal", object: "nowhere" }], types: { warp: {} },
  }, { objects: [] });
  const text = bad.join("\n");
  for (const want of ['unknown line "B"', "its km must run upwards", "at least two points", 'unknown type "teleporter"', 'no object "nowhere"', 'unknown asset type "warp"', 'unknown role "boss"', 'planner must be "student" or "computer"']) {
    assert.ok(text.includes(want), `${want} in\n${text}`);
  }
  assert.ok(validateInfra({ lines: [] }, {}).some((p) => p.includes("both lines and stations")));
  assert.ok(scenariosOf({}).some((s) => s.id === "storm"));
  assert.ok(scenariosOf({ scenarios: [{ id: "mine", name: "Mine" }] }).some((s) => s.id === "mine"));
});

test("the network: km along the lines, the layout at its station, a georeference and WGS 84", () => {
  const net = new Network(normalizeInfra({}));
  const a = net.at("6250", 0), b = net.at("6250", 30.4);
  assert.deepEqual(a.pos.map(Math.round), [-21300, -1500]);
  assert.deepEqual(b.pos.map(Math.round), [8500, 2800]);
  // the layout's origin is km 21.1 of line 6250; x runs with the km
  assert.equal(net.kmOfLayout([0, 0]), 21.1);
  assert.equal(net.kmOfLayout([1149.4, 0]), 21.2);
  const p0 = net.fromLayout([0, 0]), p1 = net.fromLayout([1000, 0]);
  assert.ok(Math.abs(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) - 87) < 1e-6, "1000 mm in H0 are 87 m");
  // the inverse UTM projection: on the central meridian of zone 33 at 50° N
  const [lon, lat] = utmToLonLat(500000, 5538630.703, 33);
  assert.ok(Math.abs(lon - 15) < 1e-7 && Math.abs(lat - 50) < 1e-7);
  const ll = net.toLonLat(p0);
  assert.ok(ll[0] > 13 && ll[0] < 14.5 && ll[1] > 50.5 && ll[1] < 51.5, `invented place in Saxony: ${ll}`);
  assert.ok(net.driveMinutes([0, 0], [5000, 0]) > 8 && net.driveMinutes([0, 0], [5000, 0]) < 20);
});

test("what is known of an asset: its age, the last inspection, and what its interlocking reports live", () => {
  const types = normalizeInfra({}).types;
  const assets = new Map();
  const il = (id, generation) => assets.set(id, Object.assign(new Asset({ id, type: "interlocking", name: id, generation, built: 2000 }, types.interlocking), { _rate: 0.03 }));
  il("dstw", "digital");
  il("relay", "relay");
  il("mech", "mechanical");
  const sig = (id, interlocking) => {
    const a = new Asset({ id, type: "signal", name: id, built: 2000, interlocking }, types.signal);
    a._rate = wearRate(a.life);
    a.h = 0.4;
    assets.set(id, a);
    return a;
  };
  const d = sig("s-d", "dstw"), r = sig("s-r", "relay"), m = sig("s-m", "mech");
  assert.equal(d.liveShare(assets), GENERATIONS.digital.share);
  assert.equal(r.liveShare(assets), 0);
  assert.equal(d.reportPath(assets), "diagnosis");
  assert.equal(r.reportPath(assets), "panel");
  assert.equal(m.reportPath(assets), "driver");
  const ctx = { assets, startYear: 2027, seed: 1 };
  // never inspected: only the age, uncertain
  const k0 = r.known(0, ctx);
  assert.equal(k0.source, "age");
  assert.ok(k0.sigma > 0.15);
  // an inspection makes it certain; the certainty fades with time
  r.observe(0, 0.04, "walk", createRng(3));
  const k1 = r.known(0, ctx), k2 = r.known(2 * YEAR, ctx);
  assert.ok(Math.abs(k1.h - 0.4) < 5 * 0.04 && k1.sigma < 0.05, "within five standard deviations");
  assert.ok(k2.sigma > k1.sigma && k2.h < k1.h);
  // the digital interlocking reports most of the signal's condition: known much better than by age
  assert.ok(d.known(0, ctx).sigma < r.known(2 * YEAR, ctx).sigma);
  // a drone sees only part of a signal
  const before = m.obs;
  m.observe(0, 0.07, "drone", createRng(4), { visible: types.signal.drone });
  assert.ok(m.obs && m.obs.sigma > 0.07 && before === null);
  // a fault, once known, is grade 6
  r.fault = { knownAt: 10 };
  assert.equal(r.known(5, ctx).grade, gradeOf(r.known(5, ctx).h));
  assert.equal(r.known(10, ctx).grade, 6);
});

test("shifts: five people keep one emergency post around the clock, the day shift is on weekdays, one technician is on call", () => {
  const m = normalizeInfra({});
  const people = makePeople(m, 3);
  assert.equal(weekdayOf(0, 2027), 4, "1 January 2027 is a Friday");
  const em = people.filter((p) => p.discipline === "signal" && p.role === "emergency");
  assert.equal(em.length, 5);
  for (let t = 0; t < 10 * DAY; t += 30) {
    const on = em.filter((p) => infraShiftOf(p, t, m, people).on);
    assert.equal(on.length, 1, `exactly one on shift at minute ${t}`);
  }
  const day = people.find((p) => p.discipline === "track" && p.role === "day");
  assert.equal(infraShiftOf(day, 3 * DAY + 600, m, people).kind, "day", "Monday 10:00");
  assert.equal(infraShiftOf(day, 1 * DAY + 600, m, people).on, false, "Saturday");
  // outside the day shift somebody of each discipline with day technicians is on call
  const oc = onCallPerson("track", 1 * DAY + 600, m, people);
  assert.ok(oc && infraShiftOf(oc, 1 * DAY + 600, m, people).kind === "oncall");
  assert.equal(new Set(people.map((p) => p.name)).size, people.length, "names are unique");
  assert.equal(people.filter((p) => p.role === "alv").length, 4);
});

test("the network's assets: generated beyond the layout, deterministic, in a plausible condition", () => {
  const a = engine(), b = engine();
  assert.ok(a.assets.size > 150);
  assert.deepEqual([...a.assets.keys()], [...b.assets.keys()]);
  assert.deepEqual([...a.assets.values()].map((x) => x.h), [...b.assets.values()].map((x) => x.h));
  const types = new Set([...a.assets.values()].map((x) => x.type));
  for (const t of Object.keys(ASSET_TYPES)) assert.ok(types.has(t), `${t} generated`);
  // every field element belongs to an interlocking
  for (const x of a.assets.values()) if (x.t.field) assert.ok(a.assets.get(x.interlocking)?.type === "interlocking", x.id);
  const g = a.meanGrade();
  assert.ok(g > 2.4 && g < 3.8, `network grade ${g}`);
  assert.ok(a.compliance() > 0.95, "the plan keeps the rules at the start");
  assert.ok(Math.abs(a.meanGrade({ known: true }) - g) < 0.4);
});

test("a fault is reported by its path, a technician drives out and repairs it; the delay costs money", () => {
  const e = engine();
  e.runTo(3 * DAY + 600); // Monday 10:00
  const relay = [...e.assets.values()].find((a) => a.type === "signal" && e.assets.get(a.interlocking)?.generation === "relay");
  const mech = [...e.assets.values()].find((a) => a.type === "signal" && e.assets.get(a.interlocking)?.generation === "mechanical");
  assert.ok(e.act("fail", relay.id));
  assert.ok(e.act("fail", mech.id));
  const fr = relay.fault, fm = mech.fault;
  assert.ok(fr.knownAt - fr.t <= 6, "the relay interlocking's panel shows it at once");
  assert.ok(fm.knownAt - fm.t >= 5, "a train driver has to come by");
  assert.equal(e.act("fail", relay.id), false, "an asset with an open fault cannot fail again");
  e.runTo(e.now + 12 * 60);
  assert.equal(relay.fault, null);
  assert.equal(mech.fault, null);
  assert.ok(e.stats.callouts >= 2);
  assert.ok(e.stats.delayMin > 0 && e.stats.perfEur > 0);
  assert.ok(e.logs.some((l) => l.text.startsWith(`Repaired: ${relay.name}`)));
  assert.ok(relay.obs && relay.obs.source === "repair", "the technician saw its condition");
});

test("nobody of our own on call: a contractor comes, later", () => {
  const e = engine({ staff: { station: { day: 0, emergency: 0 } } });
  const lift = [...e.assets.values()].find((a) => a.type === "lift");
  e.runTo(1 * DAY + 120); // Saturday night
  e.act("fail", lift.id);
  e.runTo(e.now + 30);
  const f = lift.fault;
  assert.equal(f.how, "contractor");
  assert.ok(f.arrive - f.t >= e.model.costs.contractor_callout_min);
  e.runTo(e.now + DAY);
  assert.ok(e.stats.contractorCallouts >= 1 && e.stats.stationHours > 0);
});

test("inspections follow the plan: the ALV changes method and frequency; the rules are audited", () => {
  const e = engine();
  assert.equal(e.act("plan", "signal", "train", 2), false, "a measurement train cannot inspect signals");
  assert.equal(e.act("plan", "balise", "drone", 2), false, "a drone cannot see a balise");
  assert.ok(e.act("plan", "catenary", "drone", 4));
  assert.ok(e.act("plan", "signal", "walk", 0));
  e.runTo(YEAR);
  const y = e.years[0];
  assert.ok(y.droneFlights > 0, "drones fly");
  assert.ok(y.trainRuns > 0, "measurement trains run");
  assert.ok(y.compliance < 0.9, `no signal inspections break the rules (${y.compliance})`);
  assert.ok(e.logs.some((l) => l.text.startsWith("EBA audit")));
});

test("a proposal becomes a project and goes through the HOAI phases to commissioning", () => {
  const e = engine();
  const sw = [...e.assets.values()].filter((a) => a.type === "turnout").sort((a, b) => a.h - b.h)[0];
  assert.ok(e.act("propose", "renew", [sw.id]));
  assert.equal(e.act("propose", "renew", [sw.id]), false, "the same proposal twice");
  const pr = e.proposals.find((p) => p.assets.includes(sw.id));
  assert.equal(pr.status, "approved");
  const p = e.desk.projects.get(pr.project);
  assert.equal(p.stage, "lph1");
  e.runTo(3 * YEAR);
  const stages = p.history.map((x) => x.stage);
  for (const s of ["lph1", "lph2", "lph3", "lph4", "lph5", "lph6", "lph7", "award", "possession", "construction", "acceptance", "lph9"]) assert.ok(stages.includes(s), `${s} in ${stages}`);
  assert.ok(!stages.includes("approval"), "a like-for-like renewal needs no planning approval");
  assert.equal(p.stage, "done");
  assert.ok(sw.h > 0.8 && sw.built > 2027, "renewed");
  assert.deepEqual(p.feesDone.slice().sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9], "a fee for every HOAI phase");
  assert.ok(p.paid.planning > 0.05 * p.price && p.paid.planning < 0.25 * p.price);
  assert.ok(Object.keys(PROJECT_STAGES).includes(p.stage));
});

test("upgrades need a benefit-cost ratio of 1: the authority refuses one below, funds one above", () => {
  const e = engine();
  assert.ok(e.act("propose", "upgrade", [], "electrify-6251"));
  assert.ok(e.act("propose", "upgrade", [], "underpass-6250-15"));
  e.runTo(YEAR);
  const [el, up] = ["electrify-6251", "underpass-6250-15"].map((id) => [...e.desk.projects.values()].find((p) => p.upgrade === id));
  assert.ok(el.ratio < 1 && el.stage === "stopped", `electrification NKV ${el.ratio}`);
  assert.ok(up.ratio >= 1 && up.history.some((x) => x.stage === "funding") && up.stage !== "stopped", `underpass NKV ${up.ratio}`);
  assert.ok(Math.abs(annuityFactor(0.017, 30) - 23.35) < 0.01);
  e.runTo(4 * YEAR);
  assert.ok(up.history.some((x) => x.stage === "approval"), "an upgrade needs planning approval");
  if (up.stage === "done" || up.stage === "lph9") {
    assert.ok(e.assetAt("level-crossing", "6250", 15.7) === null, "the level crossing is gone");
    assert.ok(up.received > 0, "the Bund paid its share");
  }
});

test("a level crossing renewal: crossing agreement (EKrG), the plant builds the system, the partners pay their shares", () => {
  const e = engine();
  const lc = [...e.assets.values()].find((a) => a.type === "level-crossing" && a.road_owner === "municipal");
  assert.ok(e.act("propose", "renew", [lc.id]));
  const p = [...e.desk.projects.values()][0];
  e.runTo(4 * YEAR);
  const stages = p.history.map((x) => x.stage);
  assert.ok(stages.includes("agreement") && stages.includes("factory") && stages.includes("commissioning"), stages.join());
  assert.ok(p.factoryOrder && e.factory.orders.find((o) => o.id === p.factoryOrder).stage === "done");
  // municipal road: the railway pays a third, the Bund half, the Land a sixth (EKrG § 13)
  if (p.paid.construction > 0) assert.ok(Math.abs(p.partners / (p.paid.construction + p.partners) - 2 / 3) < 0.01);
});

test("the level crossing plant: lines, a queue, failed factory tests mean rework", () => {
  const plant = new Plant({ lines: 1, weeks: { engineering: 1, production: 1, test: 1, delivery: 1 }, test_fail_p: 1, rework_weeks: 2 });
  const a = plant.order(0, { project: "P-1", name: "A" }), b = plant.order(0, { name: "B" });
  assert.deepEqual(plant.start(0).map((o) => o.id), [a.id]);
  assert.equal(b.stage, "queued");
  const rng = createRng(1);
  plant.advance(a, 10, rng);
  assert.equal(a.stage, "production");
  plant.advance(a, 20, rng);
  assert.equal(a.stage, "test");
  plant.advance(a, 30, rng);
  assert.equal(a.stage, "rework");
  plant.s.test_fail_p = 0;
  plant.advance(a, 40, rng);
  plant.advance(a, 50, rng);
  assert.equal(a.stage, "delivery");
  assert.deepEqual(plant.start(50).map((o) => o.id), [b.id], "the line is free once the system is on its way");
  plant.advance(a, 60, rng);
  assert.equal(a.stage, "done");
  assert.ok(plant.leadWeeks() >= 4);
});

test("decisions wait for student roles: running stops for them, the default is taken when time is up", () => {
  const e = new InfraEngine({}, { seed: 7 });
  const sw = [...e.assets.values()].find((a) => a.type === "turnout");
  e.act("propose", "renew", [sw.id]);
  const item = e.open("asset-manager")[0];
  assert.ok(item && item.kind === "proposal");
  const stop = e.runTo(YEAR, { pause: true });
  assert.ok(stop, "it stops for a decision");
  // nothing decided: the asset manager's default comes after the decision days
  e.runTo(item.deadline + 1);
  assert.equal(item.decided.by, "default");
  // a decision by a player
  const next = e.open().find((i) => i.pause !== false);
  if (next) {
    assert.ok(e.act("decide", next.id, next.options[0].id));
    assert.equal(next.decided.by, "player");
    assert.equal(e.act("decide", next.id, next.options[0].id), false, "decided once");
  }
  // the computer takes over a role and decides what is open at once
  assert.ok(e.act("role", "alv", "computer"));
  assert.equal(e.open("alv").length, 0);
});

test("a game is deterministic, closes its years with a score, and is restored from its actions", () => {
  const play = (e) => {
    e.runTo(40 * DAY);
    e.act("staff", "track", "day", 8);
    e.act("plan", "catenary", "drone", 3);
    const sig = [...e.assets.values()].filter((a) => a.type === "signal").sort((a, b) => a.h - b.h)[0];
    e.act("propose", "repair", [sig.id]);
    e.runTo(400 * DAY);
    e.act("inspect", sig.id, "walk");
    e.runTo(2 * YEAR + 10);
    return e;
  };
  const a = play(engine()), b = play(engine());
  assert.equal(a.years.length, 2);
  assert.deepEqual(a.years, b.years);
  for (const y of a.years) {
    assert.ok(y.score.total >= 0 && y.score.total <= 100);
    for (const k of ["condition", "reliability", "money", "rules", "information"]) assert.ok(y.score[k] >= 0 && y.score[k] <= 100, k);
  }
  assert.ok(a.people.filter((p) => p.discipline === "track" && p.role === "day").length === 8, "two technicians hired");
  // restored from the saved actions
  const saved = JSON.parse(JSON.stringify(a.save()));
  const c = engine();
  c.replay(saved.actions);
  c.runTo(saved.now);
  assert.deepEqual(c.years, a.years);
  assert.equal(c.logs.length, a.logs.length);
});

test("five years run in well under ten seconds; scenarios bring their events", () => {
  const t0 = Date.now();
  const e = engine({}, { scenario: scenariosOf({}).find((s) => s.id === "storm") });
  e.runTo(5 * YEAR);
  assert.equal(e.years.length, 5);
  assert.ok(e.finished);
  assert.ok(Date.now() - t0 < 10_000);
  assert.ok(e.logs.some((l) => l.text.startsWith("Storm")) || e.years[0].faults > 0);
  assert.equal(e.runTo(6 * YEAR), null, "nothing runs after the end");
  assert.equal(e.now, 5 * YEAR);
});

test("the asset information model and GeoJSON: IFC class, linear placement, property sets, WGS 84", () => {
  const e = engine();
  const a = [...e.assets.values()].find((x) => x.type === "signal");
  const r = assetRecord(e, a);
  assert.equal(r.Class, "IfcSignal");
  assert.equal(r.GlobalId, a.guid);
  assert.match(r.Placement.Distance, /^km \d+\.\d{3}$/);
  assert.ok(r.Pset_Condition.AssessmentCondition);
  assert.match(r.Pset_ServiceLife.ServiceLifeDuration, /^P\d+Y$/);
  const g = toGeoJSON(e);
  assert.equal(g.type, "FeatureCollection");
  const kinds = new Set(g.features.map((f) => f.properties.kind));
  assert.deepEqual([...kinds].sort(), ["asset", "line", "station"]);
  for (const f of g.features) {
    const pts = f.geometry.type === "Point" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const [lon, lat] of pts) assert.ok(lon > 13 && lon < 14.5 && lat > 50.7 && lat < 51.3, `${f.properties.id}: ${lon}, ${lat}`);
  }
  // the known condition only, never the true one
  assert.ok(g.features.every((f) => !("health" in f.properties) && !("grade_true" in f.properties)));
  assert.equal(INFRA_DEFAULTS.georef.epsg, 25833);
});
