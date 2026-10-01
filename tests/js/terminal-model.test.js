// Container terminal model and infrastructure (WP1): BIC codes, carriers, the inventory with its
// stacking rules, reservations and moves in flight, and the geometry of the five terminal
// object types, checked against the example layout's numbers.
import assert from "node:assert/strict";
import test from "node:test";

import {
  BAY_M, CARRIER_TYPES, CONTAINER_HEIGHT_M, Carrier, Container, HIGH_CUBE_HEIGHT_M, Inventory, ROW_M,
  bargeType, bicCheckDigit, bicProblem, makeBic, parseBic, yardType,
} from "../../web/arail/terminal/model.js";
import { ContainerYard, GantryCrane, Quay, ReachStacker, TruckLane, yardGrid } from "../../web/arail/terminal/objects.js";
import { createRng, createWorld, pointInPolygon, polygonArea, rectFootprint, registry, toRad } from "../../web/arail/index.js";
import { readJSON } from "./helpers.js";

const EXAMPLE = readJSON("web/layouts/container-terminal.json");
const TERMINAL = EXAMPLE.simulations.find((s) => s.type === "terminal");
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const nearPoint = (p, q, tol = 1e-6) => near(p[0], q[0], tol) && near(p[1], q[1], tol);

/** An inventory with one carrier of each kind: wagons, a truck, a barge and a 4 × 2 yard of 3 tiers. */
function makeInventory() {
  const inv = new Inventory();
  for (const [id, type] of [["S", "sgns60"], ["L", "lgns40"], ["G", "sggrss80"], ["T", "chassis40"]]) inv.addCarrier(new Carrier({ id, type }));
  inv.addCarrier(new Carrier({ id: "Y", type: yardType({ bays: 4, rows: 2, tiers: 3 }), label: "Block Y" }));
  inv.addCarrier(new Carrier({ id: "B", type: bargeType({ length_m: 55, tiers: 2 }) }));
  return inv;
}

let serial = 0;
const box = (size = "20", high = false) => new Container({ id: makeBic("TEST", ++serial), size, high });

/** Add a container and fail the test if it does not fit. */
function put(inv, size, at, high = false) {
  const c = box(size, high);
  assert.equal(inv.add(c, at), null, `${size} ft at ${JSON.stringify(at)}`);
  return c;
}

/* ---------------------------------------------------------------- BIC */

test("BIC codes: check digit, parsing, problems and new numbers", () => {
  assert.equal(bicCheckDigit("CSQU305438"), 3);
  assert.equal(bicCheckDigit("CSQU 305438"), 3);
  assert.ok(Number.isNaN(bicCheckDigit("CSQ305438")));
  for (const c of TERMINAL.containers) assert.equal(bicProblem(c.id), null, c.id);
  assert.equal(bicProblem("ARLU 100001 4"), "check digit should be 9");
  assert.equal(bicProblem("not a number"), null);
  const want = { owner: "CSQU", serial: "305438", check: 3 };
  for (const id of ["CSQU 305438 3", "CSQU3054383", "CSQU 305438-3", "csqu305438-3"]) assert.deepEqual(parseBic(id), want, id);
  assert.equal(parseBic("CSQU 30543 3"), null);
  assert.equal(makeBic("TRKU", 123), "TRKU 000123 9");
  assert.equal(makeBic("ARLU", 500000).slice(0, 12), "ARLU 500000 ");
  assert.equal(bicProblem(makeBic("DBCU", 42)), null);
});

/* ---------------------------------------------------------------- containers and carriers */

test("containers: sizes, heights and their layout file entry", () => {
  const c = new Container({ id: "ARLU 100001 9", size: 40, high: true });
  assert.equal(c.size, "40");
  assert.equal(c.bays, 2);
  assert.equal(c.teu, 2);
  assert.equal(c.height_m, HIGH_CUBE_HEIGHT_M);
  assert.equal(c.length_m, 12.192);
  assert.deepEqual(c.toJSON(), { id: "ARLU 100001 9", size: "40", high: true });
  const d = new Container({ id: "X", colour: "#336699", label: "Reefer" });
  assert.equal(d.height_m, CONTAINER_HEIGHT_M);
  assert.deepEqual(d.toJSON(), { id: "X", size: "20", colour: "#336699", label: "Reefer" });
  assert.equal(d.at, null);
  assert.equal(d.handler, null);
  assert.equal(d.move, null);
});

test("carriers: bays, rows, sizes and first bays per type", () => {
  const sgns = new Carrier({ id: "KT41/1", type: "sgns60" });
  assert.equal(sgns.kind, "wagon");
  assert.equal(sgns.label, "Sgns (60 ft)");
  assert.deepEqual([sgns.bays, sgns.rows, sgns.tiers], [3, 1, 1]);
  assert.ok(sgns.allows("20") && sgns.allows(40) && !sgns.allows("45"));
  assert.deepEqual(sgns.firstBays("20"), [0, 1, 2]);
  assert.deepEqual(sgns.firstBays("40"), [0, 1]);
  assert.deepEqual(sgns.firstBays("45"), []);
  assert.deepEqual(new Carrier({ id: "G", type: "sggrss80" }).firstBays("40"), [0, 2], "never across the joint");
  assert.deepEqual(new Carrier({ id: "L", type: "lgns40" }).firstBays("40"), [0]);
  assert.deepEqual(new Carrier({ id: "T", type: "chassis40" }).firstBays("45"), [0]);
  const yard = new Carrier({ id: "Y", type: yardType({ bays: 4, rows: 2, tiers: 3 }) });
  assert.deepEqual(yard.firstBays("45"), [0, 1, 2], "yards: any bay with a bay behind it");
  assert.deepEqual([yard.bays, yard.rows, yard.tiers], [4, 2, 3]);
  const unknown = new Carrier({ id: "?", type: "nope" });
  assert.deepEqual([unknown.type, unknown.kind, unknown.label, unknown.bays, unknown.rows, unknown.tiers], [null, null, "?", 0, 0, 0]);
  assert.equal(unknown.allows("20"), false);

  // positions: 2-bay sizes at the midpoint of their two bays
  assert.equal(sgns.along(0), 6.1);
  assert.ok(near(sgns.along(0, "40"), 3.05));
  assert.ok(near(sgns.along(1, "40"), -3.05));
  assert.ok(Number.isNaN(sgns.along(3)));
  assert.ok(near(yard.along(0, "45"), -BAY_M));
  assert.ok(near(yard.across(1), ROW_M / 2));
  assert.ok(Number.isNaN(sgns.across(1)));
  assert.equal(new Carrier({ id: "B", type: bargeType({}) }).across(2), 2.9);
});

test("carriers: layout points and footprint follow the pose", () => {
  const c = new Carrier({ id: "W1", type: "sgns60" });
  assert.equal(c.toLayout(0, 0, 87), null, "no pose yet");
  assert.equal(c.footprint(87), null);
  c.pose = { center: [100, 200], heading: Math.PI / 2 };
  const mm = (m) => (m * 1000) / 87;
  assert.ok(nearPoint(c.toLayout(6.1, 0, 87), [100, 200 + mm(6.1)]), "along = heading");
  assert.ok(nearPoint(c.toLayout(0, 1, 87), [100 - mm(1), 200]), "across + = left");
  const fp = c.footprint(87);
  assert.equal(fp.length, 4);
  assert.ok(polygonArea(fp) > 0, "counter-clockwise");
  assert.ok(near(Math.abs(polygonArea(fp)), mm(19.74) * mm(2.9), 1e-6));
  // trucks reach from the rear to the front of the chassis, not symmetric about the loading centre
  const t = new Carrier({ id: "T1", type: "chassis40" });
  t.pose = { center: [0, 0], heading: 0 };
  const xs = t.footprint(87).map((p) => p[0]);
  assert.ok(near(Math.max(...xs), mm(9.7)) && near(Math.min(...xs), mm(-6.8)));
});

/* ---------------------------------------------------------------- canPlace */

test("canPlace on wagons and trucks: sizes, positions, rows and tiers", () => {
  const inv = makeInventory();
  const c20 = box("20"), c40 = box("40"), c45 = box("45");
  assert.equal(inv.canPlace(c20, { carrier: "nowhere", bay: 0 }), 'Unknown place "nowhere"');
  assert.equal(inv.canPlace(c20, null), 'Unknown place "undefined"');
  assert.equal(inv.canPlace(c45, { carrier: "L", bay: 0 }), "Lgns (40 ft) takes no 45 ft containers");
  assert.equal(inv.canPlace(c45, { carrier: "S", bay: 0 }), "Sgns (60 ft) takes no 45 ft containers");
  assert.equal(inv.canPlace(c45, { carrier: "T", bay: 0 }), null, "a chassis takes 45 ft");
  assert.equal(inv.canPlace(c20, { carrier: "S", bay: 3 }), "No 20 ft position at bay 4");
  assert.equal(inv.canPlace(c20, { carrier: "S", bay: -1 }), "No 20 ft position at bay 0");
  assert.equal(inv.canPlace(c40, { carrier: "S", bay: 2 }), "No 40 ft position at bay 3");
  assert.equal(inv.canPlace(c40, { carrier: "G", bay: 1 }), "No 40 ft position at bay 2", "Sggrss: not across the joint");
  assert.equal(inv.canPlace(c40, { carrier: "G", bay: 2 }), null);
  assert.equal(inv.canPlace(c20, { carrier: "S", bay: 0, row: 1 }), "No row 2");
  assert.equal(inv.canPlace(c20, { carrier: "S", bay: 0, tier: 1 }), "Stacks here are at most 1 high");

  // Sgns: three 20s; or a 40 and a 20 (pairs 0 and 1)
  for (let b = 0; b < 3; b++) put(inv, "20", { carrier: "S", bay: b });
  assert.equal(inv.usedTeu("S"), 3);
  assert.equal(inv.canPlace(c20, { carrier: "S", bay: 1 }), `Occupied by ${inv.at("S", 0, 1, 0).id}`);
  const s2 = new Inventory();
  s2.addCarrier(new Carrier({ id: "S", type: "sgns60" }));
  put(s2, "40", { carrier: "S", bay: 0 });
  put(s2, "20", { carrier: "S", bay: 2 });
  const s3 = new Inventory();
  s3.addCarrier(new Carrier({ id: "S", type: "sgns60" }));
  put(s3, "20", { carrier: "S", bay: 0 });
  const forty = put(s3, "40", { carrier: "S", bay: 1 });
  assert.equal(s3.at("S", 0, 2, 0), forty, "a 40 covers both its bays");
  assert.equal(s3.canPlace(box("20"), { carrier: "S", bay: 2 }), `Occupied by ${forty.id}`);
  assert.equal(s3.usedTeu("S"), 3);
  assert.equal(s3.capacityTeu("S"), 3);
});

test("canPlace in yards: stacking on the same span only, up to the stack height", () => {
  const inv = makeInventory();
  const a = put(inv, "20", { carrier: "Y", bay: 0, row: 0 });
  put(inv, "20", { carrier: "Y", bay: 0, row: 0, tier: 1 }); // 20 on 20
  const f = put(inv, "40", { carrier: "Y", bay: 2, row: 0 });
  put(inv, "40", { carrier: "Y", bay: 2, row: 0, tier: 1 }); // 40 on 40
  put(inv, "45", { carrier: "Y", bay: 2, row: 0, tier: 2 }); // 45 on 40
  assert.equal(inv.canPlace(box("20"), { carrier: "Y", bay: 2, row: 0, tier: 3 }), "Stacks here are at most 3 high");
  // 40 on two 20s
  put(inv, "20", { carrier: "Y", bay: 0, row: 1 });
  put(inv, "20", { carrier: "Y", bay: 1, row: 1 });
  assert.equal(inv.canPlace(box("40"), { carrier: "Y", bay: 0, row: 1, tier: 1 }), "A 40 ft container needs a 40/45 ft container below");
  // a 40 shifted by a bay over a 40
  put(inv, "40", { carrier: "Y", bay: 2, row: 1 });
  assert.equal(inv.canPlace(box("40"), { carrier: "Y", bay: 1, row: 1, tier: 1 }), "A 40 ft container needs a 40/45 ft container below");
  // 20 on a 40 (either of its bays)
  assert.equal(inv.canPlace(box("20"), { carrier: "Y", bay: 2, row: 1, tier: 1 }), "A 20 ft container needs a 20 ft container below");
  assert.equal(inv.canPlace(box("20"), { carrier: "Y", bay: 3, row: 1, tier: 1 }), "A 20 ft container needs a 20 ft container below");
  assert.equal(inv.canPlace(box("20"), { carrier: "Y", bay: 1, row: 0, tier: 1 }), "Nothing to stand on");
  // as if lifted first: its own place counts as free, stacking on itself does not work
  assert.equal(inv.canPlace(a, { carrier: "Y", bay: 0, row: 0 }), "Already there");
  assert.equal(inv.canPlace(f, { carrier: "Y", bay: 2, row: 0 }), "Already there");
  const free = put(inv, "20", { carrier: "Y", bay: 1, row: 0 });
  assert.equal(inv.canPlace(free, { carrier: "Y", bay: 1, row: 0, tier: 1 }), "Nothing to stand on");
  // a 40 lifted from bays 2-3 may go to bays 1-2: its own cell counts as free
  const g = new Inventory();
  g.addCarrier(new Carrier({ id: "Y", type: yardType({ bays: 4, rows: 1, tiers: 2 }) }));
  const moving = put(g, "40", { carrier: "Y", bay: 2 });
  assert.equal(g.canPlace(moving, { carrier: "Y", bay: 1 }), null);
  assert.equal(g.canPlace(box("40"), { carrier: "Y", bay: 1 }), `Occupied by ${moving.id}`);
  assert.equal(inv.capacityTeu("Y"), 4 * 2 * 3);
  assert.equal(inv.capacityTeu("nowhere"), 0);
});

test("canPlace: reserved cells are free only for the move that reserved them", () => {
  const inv = makeInventory();
  const c = put(inv, "20", { carrier: "S", bay: 0 });
  const target = { carrier: "Y", bay: 1, row: 1, tier: 0 };
  inv.reserve(target, "40", "M1");
  assert.equal(inv.reservedBy("Y", 1, 1, 0), "M1");
  assert.equal(inv.reservedBy("Y", 1, 2, 0), "M1", "a 40 reserves two bays");
  assert.equal(inv.reservedBy("Y", 1, 3, 0), null);
  assert.equal(inv.canPlace(box("20"), { carrier: "Y", bay: 2, row: 1 }), "Reserved for move M1");
  const forty = box("40");
  forty.move = "M1";
  assert.equal(inv.canPlace(forty, target), null);
  assert.equal(inv.canPlace(c, { carrier: "Y", bay: 1, row: 1 }), "Reserved for move M1");
  // reserving again moves the reservation; release frees it
  inv.reserve({ carrier: "Y", bay: 0, row: 0 }, "20", "M1");
  assert.equal(inv.reservedBy("Y", 1, 1, 0), null);
  assert.equal(inv.reservedBy("Y", 0, 0, 0), "M1");
  inv.release("M1");
  inv.release("M1");
  assert.equal(inv.reservedBy("Y", 0, 0, 0), null);
  assert.equal(inv.canPlace(c, { carrier: "Y", bay: 0, row: 0 }), null);
  assert.deepEqual(inv.check(), []);
});

test("canPlace: nothing is stacked on a container that is about to be moved", () => {
  const inv = makeInventory();
  const below = put(inv, "20", { carrier: "Y", bay: 0, row: 0 });
  below.move = "M7";
  const reason = inv.canPlace(box("20"), { carrier: "Y", bay: 0, row: 0, tier: 1 });
  assert.ok(reason.startsWith("Nothing to stand on"), reason);
  assert.match(reason, /being moved \(M7\)/);
});

/* ---------------------------------------------------------------- canLift, moves in flight */

test("canLift: stored, not yet moving, nothing on top or reserved above", () => {
  const inv = makeInventory();
  const lower = put(inv, "40", { carrier: "Y", bay: 0, row: 0 });
  const upper = put(inv, "20", { carrier: "Y", bay: 2, row: 0 });
  const top = put(inv, "40", { carrier: "Y", bay: 0, row: 0, tier: 1 });
  assert.equal(inv.canLift(lower), `Blocked by ${top.id} on top: move that first`);
  assert.equal(inv.canLift(top.id), null, "an id works too");
  assert.equal(inv.canLift(upper), null);
  inv.reserve({ carrier: "Y", bay: 2, row: 0, tier: 1 }, "20", "M2");
  assert.equal(inv.canLift(upper), "Blocked by move M2, which sets a container on top: wait for it");
  top.move = "M3";
  assert.equal(inv.canLift(top), `${top.id} is already being moved (M3)`);
  const loose = box("20");
  assert.equal(inv.canLift(loose), `${loose.id} is not on a carrier`);
  assert.equal(inv.canLift("nope"), 'Unknown container "nope"');
  assert.equal(inv.canLift(null), "No container");
});

test("detach and attach: a container on a handler fills no cell", () => {
  const inv = makeInventory();
  const c = put(inv, "40", { carrier: "S", bay: 0 }, true);
  const target = { carrier: "Y", bay: 1, row: 1 };
  c.move = "M1";
  inv.reserve(target, c.size, "M1");
  assert.equal(inv.detach(c.id, "crane-1"), null);
  assert.equal(c.at, null);
  assert.equal(c.handler, "crane-1");
  assert.equal(inv.at("S", 0, 0, 0), null, "its cells are free");
  assert.equal(inv.canPlace(box("20"), { carrier: "S", bay: 1 }), null);
  assert.equal(inv.canLift(c), `${c.id} is not on a carrier`);
  assert.equal(inv.on("S").length, 0);
  assert.deepEqual(inv.snapshot(), [], "only stored containers are in the snapshot");
  assert.deepEqual(inv.check(), []);
  assert.equal(inv.detach(c.id, "crane-1"), `${c.id} is not on a carrier`);
  // a wrong place leaves it on the handler
  assert.equal(inv.attach(c.id, { carrier: "L", bay: 1 }), "No 40 ft position at bay 2");
  assert.equal(c.handler, "crane-1");
  assert.equal(inv.attach(c.id, target), null);
  assert.deepEqual(c.at, { carrier: "Y", bay: 1, row: 1, tier: 0 });
  assert.equal(c.handler, null);
  assert.equal(inv.at("Y", 1, 2, 0), c);
  assert.equal(inv.reservedBy("Y", 1, 1, 0), "M1", "the move releases its reservation itself");
  assert.deepEqual(inv.check(), []);
  c.move = null;
  assert.ok(inv.check().some((p) => p.includes("move M1")), "a reservation under a container of another move is reported");
  inv.release("M1");
  assert.deepEqual(inv.check(), []);
  // nothing is lifted from under another container
  const top = put(inv, "40", { carrier: "Y", bay: 1, row: 1, tier: 1 });
  assert.equal(inv.detach(c.id, "rs"), `Blocked by ${top.id} on top: move that first`);
  assert.equal(inv.attach(c.id, { carrier: "Y", bay: 0, row: 0 }), `Blocked by ${top.id} on top: move that first`);
  // a stored container can be set down directly elsewhere
  assert.equal(inv.attach(top.id, { carrier: "Y", bay: 0, row: 0 }), null);
  assert.equal(inv.top("Y", 1, 1), 1);
  assert.deepEqual(inv.check(), []);
});

test("remove and removeCarrier: containers and reservations go with them", () => {
  const inv = makeInventory();
  const a = put(inv, "20", { carrier: "T", bay: 0 });
  const b = put(inv, "20", { carrier: "T", bay: 1 });
  const c = put(inv, "20", { carrier: "Y", bay: 0, row: 0 });
  inv.reserve({ carrier: "T", bay: 0 }, "40", "M9");
  assert.equal(inv.remove(c.id), c);
  assert.equal(inv.remove(c.id), null);
  assert.equal(c.at, null);
  assert.equal(inv.at("Y", 0, 0, 0), null);
  inv.remove(a.id);
  inv.add(a, { carrier: "Y", bay: 3, row: 1 });
  assert.equal(inv.add(a, { carrier: "Y", bay: 2, row: 1 }), `${a.id} is already in the terminal`);
  assert.deepEqual(inv.removeCarrier("T"), [b]);
  assert.equal(inv.get(b.id), null);
  assert.equal(inv.reservedBy("T", 0, 0, 0), null);
  assert.ok(!inv.carriers.has("T"));
  assert.deepEqual(inv.check(), []);
  assert.deepEqual(inv.removeCarrier("nope"), []);
});

/* ---------------------------------------------------------------- queries */

test("freeSlots: order tier, bay, row, and a container's own cells are free for it", () => {
  const inv = new Inventory();
  inv.addCarrier(new Carrier({ id: "Y", type: yardType({ bays: 3, rows: 2, tiers: 2 }) }));
  const forty = put(inv, "40", { carrier: "Y", bay: 0, row: 0 });
  const slots = inv.freeSlots(box("20"), "Y");
  const key = (s) => `${s.tier}:${s.bay}:${s.row}`;
  assert.deepEqual(slots.map(key), ["0:0:1", "0:1:1", "0:2:0", "0:2:1"]);
  const sorted = [...slots].sort((a, b) => a.tier - b.tier || a.bay - b.bay || a.row - b.row);
  assert.deepEqual(slots, sorted);
  assert.deepEqual(inv.freeSlots(box("40"), "Y").map(key), ["0:0:1", "0:1:1", "1:0:0"]);
  // the 40 itself: bays 1-2 of row 0 overlap its own cell; not where it is, not on itself
  assert.deepEqual(inv.freeSlots(forty, "Y").map(key), ["0:0:1", "0:1:0", "0:1:1"]);
  assert.deepEqual(inv.freeSlots(box("20"), "nowhere"), []);
  assert.deepEqual(inv.freeSlots(box("45"), "Y").every((s) => s.bay < 2), true);
});

test("top, heightBelow and on: stacks with high cubes", () => {
  const inv = makeInventory();
  put(inv, "20", { carrier: "Y", bay: 1, row: 1 }, true);
  put(inv, "20", { carrier: "Y", bay: 1, row: 1, tier: 1 });
  put(inv, "40", { carrier: "Y", bay: 2, row: 0 });
  assert.equal(inv.top("Y", 1, 1), 2);
  assert.equal(inv.top("Y", 0, 3), 1, "the second bay of a 40");
  assert.equal(inv.top("Y", 0, 0), 0);
  assert.equal(inv.heightBelow({ carrier: "Y", bay: 1, row: 1 }), 0);
  assert.equal(inv.heightBelow({ carrier: "Y", bay: 1, row: 1, tier: 1 }), HIGH_CUBE_HEIGHT_M);
  assert.ok(near(inv.heightBelow({ carrier: "Y", bay: 1, row: 1, tier: 2 }), HIGH_CUBE_HEIGHT_M + CONTAINER_HEIGHT_M));
  assert.ok(near(inv.heightBelow({ carrier: "Y", bay: 2, row: 0, tier: 1 }), CONTAINER_HEIGHT_M));
  assert.deepEqual(inv.on("Y").map((c) => [c.at.tier, c.at.row, c.at.bay]), [[0, 0, 2], [0, 1, 1], [1, 1, 1]]);
  assert.equal(inv.usedTeu("Y"), 4);
});

/* ---------------------------------------------------------------- consistency */

test("check() stays empty through 300 random adds, lifts, set-downs, reservations and removals", () => {
  const rng = createRng(17);
  const inv = makeInventory();
  const ids = [...inv.carriers.keys()];
  const sizes = ["20", "20", "40", "45"];
  const randomRef = () => {
    const c = inv.carriers.get(rng.pick(ids));
    return { carrier: c.id, bay: rng.int(c.bays + 1), row: rng.int(c.rows), tier: rng.int(c.tiers + 1) };
  };
  let moves = 0, placed = 0, lifted = 0, set = 0;
  for (let i = 0; i < 300; i++) {
    const stored = [...inv.containers.values()].filter((c) => c.at), carried = [...inv.containers.values()].filter((c) => c.handler);
    const op = rng.int(5);
    if (op === 0 || !inv.containers.size) {
      const c = box(rng.pick(sizes), rng.chance(0.3)), ref = randomRef();
      const reason = inv.canPlace(c, ref);
      assert.equal(inv.add(c, ref), reason);
      if (!reason) placed++;
    } else if (op === 1 && stored.length) {
      // a move: reserve a free place, then lift the container
      const c = rng.pick(stored);
      if (inv.canLift(c)) continue;
      const free = inv.freeSlots(c, rng.pick(ids));
      if (!free.length) continue;
      const id = `M${++moves}`;
      inv.reserve(rng.pick(free), c.size, id);
      c.move = id;
      assert.equal(inv.detach(c.id, "crane"), null);
      lifted++;
    } else if (op === 2 && carried.length) {
      const c = rng.pick(carried);
      assert.equal(inv.attach(c.id, inv._reservations.get(c.move).at), null);
      inv.release(c.move);
      c.move = null;
      set++;
    } else if (op === 3 && stored.length) {
      const c = rng.pick(stored);
      if (!inv.canLift(c)) inv.remove(c.id);
    } else if (op === 4 && stored.length) {
      const c = rng.pick(stored), ref = randomRef();
      const reason = inv.attach(c.id, ref);
      if (reason === null) assert.deepEqual(c.at, { carrier: ref.carrier, bay: ref.bay, row: ref.row, tier: ref.tier });
    }
    assert.deepEqual(inv.check(), [], `after operation ${i}`);
  }
  assert.ok(placed > 20 && lifted > 15 && set > 10, `placed ${placed}, lifted ${lifted}, set down ${set}`);
});

test("check() reports every kind of inconsistency", () => {
  const fresh = () => {
    const inv = makeInventory();
    const a = put(inv, "40", { carrier: "Y", bay: 0, row: 0 });
    const b = put(inv, "40", { carrier: "Y", bay: 0, row: 0, tier: 1 });
    const c = put(inv, "20", { carrier: "S", bay: 2 });
    assert.deepEqual(inv.check(), []);
    return { inv, a, b, c };
  };
  const expect = (inv, pattern) => {
    const problems = inv.check();
    assert.ok(problems.some((p) => pattern.test(p)), `${pattern} in ${JSON.stringify(problems)}`);
  };
  let s = fresh();
  s.c.at = { ...s.c.at, bay: 1 }; // moved without the inventory
  expect(s.inv, /its cell S bay 2 row 1 tier 1 holds nothing/);
  expect(s.inv, /S bay 3 row 1 tier 1: holds .*, which is at S bay 2/);
  s = fresh();
  s.c.handler = "crane-1";
  expect(s.inv, /on S and on handler crane-1 at the same time/);
  s = fresh();
  s.inv.detach(s.c.id, "crane-1");
  s.c.handler = null;
  expect(s.inv, /neither on a carrier nor on a handler/);
  s = fresh();
  s.inv.containers.delete(s.a.id); // lost without the inventory: the 40 on top has nothing below
  expect(s.inv, /which is not in the terminal/);
  expect(s.inv, /nothing to stand on/);
  s = fresh();
  s.inv.carriers.delete("S");
  expect(s.inv, /on an unknown carrier "S"/);
  expect(s.inv, /cells of an unknown carrier "S"/);
  s = fresh();
  s.inv.carriers.get("Y").type = yardType({ bays: 4, rows: 2, tiers: 1 }); // the block lost a tier
  expect(s.inv, /Stacks here are at most 1 high/);
  s = fresh();
  s.inv.reserve({ carrier: "Y", bay: 2, row: 1, tier: 1 }, "20", "M5");
  expect(s.inv, /move M5: its reserved place Y bay 3 row 2 tier 2: nothing to stand on/);
  s = fresh();
  s.inv.reserve({ carrier: "S", bay: 2 }, "20", "M6");
  expect(s.inv, /move M6: its reserved place S bay 3 row 1 tier 1 holds/);
  s = fresh();
  s.inv.reserve({ carrier: "Y", bay: 3, row: 1 }, "20", "M8");
  s.inv._reserved.get("Y").set("0:1:2", "M8");
  expect(s.inv, /marked as reserved for move M8, which has no such reservation/);
  s.inv._reserved.get("Y").delete("0:1:3");
  expect(s.inv, /move M8: its reserved cell Y 0:1:3 is not marked/);
  s = fresh();
  s.inv.containers.set("other", s.c);
  expect(s.inv, /other: listed under a different id/);
});

test("snapshot: stored containers in inventory order, and back", () => {
  const inv = makeInventory();
  put(inv, "40", { carrier: "S", bay: 1 }, true);
  const lifted = put(inv, "20", { carrier: "B", bay: 3, row: 2 });
  put(inv, "45", { carrier: "Y", bay: 2, row: 1 });
  put(inv, "40", { carrier: "Y", bay: 2, row: 1, tier: 1 });
  inv.containers.get([...inv.containers.keys()][0]).colour = "#123456";
  inv.detach(lifted.id, "crane-1");
  const snap = inv.snapshot();
  assert.equal(snap.length, 3);
  assert.deepEqual(snap[0], { ...inv.containers.values().next().value.toJSON(), at: { carrier: "S", bay: 1, row: 0, tier: 0 } });
  assert.equal(snap[0].high, true);
  const again = makeInventory();
  for (const e of JSON.parse(JSON.stringify(snap))) assert.equal(again.add(new Container(e), e.at), null);
  assert.deepEqual(again.snapshot(), snap);
  assert.deepEqual(again.check(), []);
});

/* ---------------------------------------------------------------- objects */

const mm87 = (m) => (m * 1000) / 87;

test("yard blocks: grid, stack positions and the editor's rect contract", () => {
  assert.deepEqual(yardGrid(952, 134, 87), { bays: 12, rows: 4 });
  assert.deepEqual(yardGrid(318, 134, 87), { bays: 4, rows: 4 });
  assert.deepEqual(yardGrid(100, 30, 160), { bays: 2, rows: 1 });
  const world = createWorld({ scale: 87, objects: [{ id: "y", type: "container-yard", position: [500, 300], width_mm: 476, depth_mm: 134, rotation_deg: 30, tiers: 2 }] });
  const yard = world.getObject("y");
  assert.ok(yard instanceof ContainerYard);
  const g = yard.geometry;
  assert.deepEqual([g.bays, g.rows, g.tiers], [6, 4, 2]);
  assert.ok(near(g.angle, toRad(30)));
  assert.deepEqual(yard.footprint(), rectFootprint([500, 300], 476, 134, toRad(30)));
  assert.equal(yard.anchorPoint(), g.center);
  assert.deepEqual(yard.snapPoint(), g.footprint[0]);
  const [dx, dy] = yard.duplicateOffset();
  assert.ok(near(Math.hypot(dx, dy), 476) && near(Math.atan2(dy, dx), toRad(30)));
  // the carrier of the block: bay 1 / row 1 is the corner stack, stacks 6.9 m × 2.9 m apart
  const carrier = new Carrier({ id: "y", type: yard.carrierType() });
  carrier.pose = { center: g.center, heading: g.angle };
  assert.deepEqual([carrier.bays, carrier.rows, carrier.tiers], [6, 4, 2]);
  const p00 = carrier.toLayout(carrier.along(0), carrier.across(0), 87), p10 = carrier.toLayout(carrier.along(1), carrier.across(0), 87);
  const p01 = carrier.toLayout(carrier.along(0), carrier.across(1), 87);
  assert.ok(near(Math.hypot(p10[0] - p00[0], p10[1] - p00[1]), mm87(BAY_M)));
  assert.ok(near(Math.hypot(p01[0] - p00[0], p01[1] - p00[1]), mm87(ROW_M)));
  assert.ok(near(Math.atan2(p10[1] - p00[1], p10[0] - p00[0]), toRad(30)), "bays along the width");
  for (let b = 0; b < 6; b++) for (let r = 0; r < 4; r++) assert.ok(pointInPolygon(carrier.toLayout(carrier.along(b), carrier.across(r), 87), g.footprint));
  // dragging and editing recompute the geometry
  yard.translate(10, -5);
  assert.ok(nearPoint(yard.geometry.center, [510, 295]));
  yard.set({ width_mm: 160 });
  assert.equal(yard.geometry.bays, 2);
  world.setScale(160);
  assert.equal(yard.geometry.bays, 3, "a different scale gives other bays");
});

test("terminal objects follow their markers", () => {
  const world = createWorld({
    scale: 87,
    markers: { poses: { 5: [100, 200, 90] }, locked: true },
    objects: [
      { id: "y", type: "container-yard", position: { marker: 5, offset: [10, 0] } },
      { id: "l", type: "truck-lane", points: [{ marker: 5, offset: [0, 0] }, [600, 200]] },
      { id: "r", type: "reach-stacker", position: { marker: 5, offset: [0, 20] } },
    ],
  });
  assert.ok(nearPoint(world.getObject("y").geometry.center, [100, 210]));
  assert.ok(nearPoint(world.getObject("r").geometry.center, [80, 200]));
  world.map.set(5, { x: 300, y: 200, theta: 0 });
  assert.ok(nearPoint(world.getObject("y").geometry.center, [310, 200]));
  assert.ok(nearPoint(world.getObject("l").geometry.points[0], [300, 200]));
  world.map.delete(5);
  assert.equal(world.getObject("y").geometry, null, "not placed without its marker");
  assert.equal(world.getObject("y").footprint(), null);
  assert.deepEqual(world.getObject("y").problems(), []);
  assert.equal(world.getObject("l").at(0), null);
  assert.deepEqual(world.getObject("l").positions(), []);
});

test("gantry cranes: local coordinates, reach and rails, also turned by 30°", () => {
  for (const deg of [0, 30, -135]) {
    const world = createWorld({ scale: 87, objects: [{ id: "c", type: "gantry-crane", position: [400, 250], width_mm: 1150, depth_mm: 345, rotation_deg: deg, outreach_m: 8 }] });
    const crane = world.getObject("c");
    assert.ok(crane instanceof GantryCrane);
    const g = crane.geometry;
    assert.deepEqual(crane.footprint(), rectFootprint([400, 250], 1150, 345, toRad(deg)));
    for (const [s, t] of [[0, 0], [123.4, -56.7], [-500, 200]]) {
      const p = crane.fromLocal(s, t);
      assert.ok(nearPoint(crane.toLocal(p), [s, t], 1e-9), `${deg}°: ${s}, ${t}`);
    }
    assert.deepEqual(crane.sRange(), [-575 + mm87(8), 575 - mm87(8)]);
    assert.deepEqual(crane.tRange(), [-172.5 - mm87(8), 172.5 + mm87(8)]);
    const [s1] = crane.sRange(), [, t1] = crane.tRange();
    assert.ok(crane.reaches(crane.fromLocal(s1, t1)), "the corner of the coverage");
    assert.ok(!crane.reaches(crane.fromLocal(s1 - 0.1, 0)), "beyond the portal");
    assert.ok(!crane.reaches(crane.fromLocal(0, t1 + 0.1)), "beyond the outreach");
    assert.ok(crane.reaches(crane.fromLocal(0, -172.5 - mm87(7.9))));
    assert.ok(nearPoint(crane.toLocal(g.railA[0]), [-575, -172.5]) && nearPoint(crane.toLocal(g.railA[1]), [575, -172.5]));
    assert.ok(nearPoint(crane.toLocal(g.railB[0]), [-575, 172.5]) && nearPoint(crane.toLocal(g.railB[1]), [575, 172.5]));
    for (const p of g.coverage) assert.ok(crane.reaches(p));
    assert.ok(polygonArea(g.coverage) > 0);
    assert.ok(near(g.lift, mm87(15)) && near(g.outreach, mm87(8)));
    assert.deepEqual(crane.problems(), []);
  }
  const world = createWorld({ scale: 87, objects: [{ id: "c", type: "gantry-crane", position: [0, 0], width_mm: 150, depth_mm: 345 }] });
  const short = world.getObject("c");
  assert.deepEqual(short.sRange(), [0, 0]);
  assert.ok(short.reaches([0, 100]));
  assert.match(short.problems()[0], /^The runway is shorter than the crane \(16 m\): make it at least 184 mm long\.$/);
  assert.equal(new GantryCrane(createWorld({}), { id: "x", type: "gantry-crane" }).toLocal([0, 0]), null);
});

test("truck lanes: positions around the middle, passing side and the lane's ribbon", () => {
  const world = createWorld({ scale: 87, objects: [{ id: "l", type: "truck-lane", points: [[0, 0], [400, 0], [400, 400]], positions: 2 }] });
  const lane = world.getObject("l");
  assert.ok(lane instanceof TruckLane);
  const g = lane.geometry;
  assert.equal(g.total, 800);
  assert.equal(g.side, 1);
  assert.ok(near(g.passingOffset, mm87(3.5)));
  assert.deepEqual(lane.positions(), [400 - mm87(9.5), 400 + mm87(9.5)]);
  assert.ok(nearPoint(lane.at(100, 10).point, [100, 10]), "+ = left");
  assert.ok(nearPoint(lane.at(600).point, [400, 200]));
  assert.ok(nearPoint(lane.at(600).dir, [0, 1]));
  assert.ok(nearPoint(lane.at(-50).point, [-50, 0]), "straight on before the entry");
  assert.ok(nearPoint(lane.at(850, -5).point, [405, 450]), "and after the end");
  // the ribbon: from the outer edge of the loading lane to the outer edge of the passing lane
  assert.ok(pointInPolygon([100, mm87(5)], g.footprint));
  assert.ok(pointInPolygon([100, -mm87(1.5)], g.footprint));
  assert.ok(!pointInPolygon([100, -mm87(2)], g.footprint));
  assert.ok(!pointInPolygon([100, mm87(5.5)], g.footprint));
  lane.set({ passing_side: "right" });
  assert.equal(lane.geometry.side, -1);
  assert.ok(near(lane.geometry.passingOffset, -mm87(3.5)));
  assert.ok(pointInPolygon([100, -mm87(5)], lane.geometry.footprint));
  assert.ok(nearPoint(lane.anchorPoint(), [400, 0]));
  assert.deepEqual(lane.problems(), ["No gantry crane reaches its truck positions and there is no reach stacker: trucks cannot be loaded."]);
  // too short: positions are squeezed between 10 m from both ends
  lane.set({ points: [[0, 0], [400, 0]], positions: 3 });
  assert.deepEqual(lane.positions().map((s) => +s.toFixed(3)), [+mm87(10).toFixed(3), 200, +(400 - mm87(10)).toFixed(3)]);
  world.addObject({ id: "rs", type: "reach-stacker", position: [0, 0] });
  assert.deepEqual(lane.problems(), [`Too short for 3 truck positions: make it at least ${Math.ceil(mm87(58))} mm long, or use fewer positions.`]);
  assert.equal(new TruckLane(world, { id: "z", type: "truck-lane", points: [[0, 0], [0, 0]] }).geometry, null, "one point is no lane");
});

test("quays: water and wall on the quay side, berth at the last point", () => {
  for (const side of ["right", "left"]) {
    const world = createWorld({ scale: 87, objects: [{ id: "q", type: "quay", points: [[0, 0], [1000, 0]], quay_side: side, berth_m: 60, water_m: 16 }] });
    const quay = world.getObject("q");
    assert.ok(quay instanceof Quay);
    const g = quay.geometry, k = side === "left" ? 1 : -1;
    assert.equal(g.side, k);
    assert.ok(near(g.quayOffset, k * mm87(5.25)));
    assert.deepEqual(g.berth, [1000 - mm87(60), 1000]);
    // water from the wall line across the fairway; the barge centre line lies in it
    const inWater = (y) => pointInPolygon([500, y], g.water);
    assert.ok(inWater(0) && inWater(k * mm87(5)) && inWater(-k * mm87(10.5)));
    assert.ok(!inWater(k * mm87(5.5)) && !inWater(-k * mm87(11)));
    // the wall: 3 m on the land side of the wall line, only along the berth
    const onWall = (x, y) => pointInPolygon([x, y], g.wall);
    assert.ok(onWall(900, k * mm87(6.5)));
    assert.ok(!onWall(900, k * mm87(5)) && !onWall(900, k * mm87(8.5)));
    assert.ok(!onWall(1000 - mm87(61), k * mm87(6.5)), "not before the berth");
    assert.ok(polygonArea(g.water) > 0 && polygonArea(g.wall) > 0);
    assert.equal(quay.footprint(), g.water);
    assert.ok(nearPoint(quay.at(1050, 3).point, [1050, 3]));
    assert.deepEqual(quay.problems(), ["No gantry crane reaches the berth: barges are only loaded and unloaded by cranes."]);
  }
  const world = createWorld({ scale: 87, objects: [{ id: "q", type: "quay", points: [[0, 0], [300, 0], [300, 300]], berth_m: 60 }] });
  const quay = world.getObject("q");
  assert.equal(quay.geometry.wall.length, 6, "a berth around a corner follows it");
  quay.set({ points: [[0, 0], [500, 0]] });
  assert.equal(quay.problems()[0], `Shorter than its berth: make it at least ${Math.ceil(mm87(60))} mm long, or shorten the berth.`);
});

test("reach stackers: an 8 m × 4 m footprint at the parking place", () => {
  const world = createWorld({ scale: 87, objects: [{ id: "r", type: "reach-stacker", position: [10, 20], rotation_deg: 90 }] });
  const rs = world.getObject("r");
  assert.ok(rs instanceof ReachStacker);
  assert.deepEqual(rs.footprint(), rectFootprint([10, 20], mm87(8), mm87(4), toRad(90)));
  assert.deepEqual(rs.anchorPoint(), [10, 20]);
});

test("the editor's contract: rect objects, footprints, background picking", () => {
  for (const type of ["container-yard", "gantry-crane"]) {
    const cls = registry.objects.get(type);
    assert.equal(cls.placement, "rect");
    const keys = cls.params.map((p) => p.key);
    for (const k of ["width_mm", "depth_mm", "rotation_deg"]) assert.ok(keys.includes(k), `${type}.${k}`);
    // what the editor writes when a rectangle is drawn
    const world = createWorld({ scale: 87 });
    const o = world.addObject({ type, position: [300, 200], width_mm: 600, depth_mm: 300, rotation_deg: 0 });
    assert.deepEqual(o.footprint(), rectFootprint([300, 200], 600, 300, 0));
    assert.ok(o.contains([300, 200]));
    o.set({ rotation_deg: 45 });
    assert.deepEqual(o.footprint(), rectFootprint([300, 200], 600, 300, toRad(45)));
  }
  for (const type of ["truck-lane", "quay"]) {
    const world = createWorld({ scale: 87 });
    const o = world.addObject({ type, points: [[0, 0], [500, 0]] });
    assert.ok(o.footprint().length >= 4, type);
    o.translate(0, 100);
    assert.deepEqual(o.spec.points, [[0, 100], [500, 100]]);
    assert.equal(o.geometry.points[0][1], 100);
  }
  assert.deepEqual(["container-yard", "gantry-crane", "truck-lane", "quay", "reach-stacker"].filter((t) => registry.objects.get(t).background), ["gantry-crane", "quay"]);
});

/* ---------------------------------------------------------------- the example layout */

test("the example layout: every slot of the crane's work lies inside its coverage, Block B outside", () => {
  const world = createWorld(EXAMPLE);
  const mm = (m) => (m * 1000) / world.scale;
  const crane = world.getObject("crane-1");
  // coverage x ∈ [267.3, 1232.7], y ∈ [73.6, 682.8]
  const s = crane.sRange().map((v) => v + crane.geometry.center[0]), t = crane.tRange().map((v) => v + crane.geometry.center[1]);
  assert.ok(near(s[0], 267.3, 0.05) && near(s[1], 1232.7, 0.05), s.join(", "));
  assert.ok(near(t[0], 73.6, 0.05) && near(t[1], 682.8, 0.05), t.join(", "));
  assert.ok(near(crane.geometry.railA[0][1], 200, 0.1) && near(crane.geometry.railB[0][1], 556.3, 0.1), "rails at 0 m and 31 m");
  assert.ok(near(crane.geometry.length, mm(100), 0.5), "a 100 m runway");

  const slotPoints = (carrier) => {
    const out = [];
    for (let b = 0; b < carrier.bays; b++) for (let r = 0; r < carrier.rows; r++) out.push(carrier.toLayout(carrier.along(b), carrier.across(r), world.scale));
    return out;
  };
  // trains at their stops (§5.6: the head at stop_mm, a 19 m locomotive, the wagons behind it)
  for (const train of TERMINAL.trains) {
    const track = world.getObject(train.track).geometry;
    const pts = train.direction === -1 ? [...track.points].reverse() : track.points;
    const dir = [Math.sign(pts[1][0] - pts[0][0]), 0];
    assert.equal(track.points.length, 2);
    const head = pts[0][0] + dir[0] * train.stop_mm;
    let back = mm(19);
    for (const [k, type] of train.wagons.entries()) {
      const L = mm(CARRIER_TYPES[type].length_m);
      const wagon = new Carrier({ id: `${train.id}/${k + 1}`, type });
      wagon.pose = { center: [head - dir[0] * (back + L / 2), pts[0][1]], heading: Math.atan2(0, dir[0]) };
      back += L;
      for (const p of slotPoints(wagon)) assert.ok(crane.reaches(p), `${wagon.id} slot at ${p}`);
    }
    assert.ok(near(head, train.id === "KT41" ? 1347 : 225, 0.01), `${train.id} head at x ${head}`);
  }
  // Block A and the truck positions
  const yardCarrier = (id) => {
    const o = world.getObject(id), c = new Carrier({ id, type: o.carrierType() });
    c.pose = { center: o.geometry.center, heading: o.geometry.angle };
    return c;
  };
  const blockA = yardCarrier("yard-a"), blockB = yardCarrier("yard-b");
  assert.deepEqual([blockA.bays, blockA.rows, blockA.tiers], [12, 4, 3]);
  assert.deepEqual([blockB.bays, blockB.rows, blockB.tiers], [4, 4, 2]);
  for (const p of slotPoints(blockA)) assert.ok(crane.reaches(p), `Block A ${p}`);
  for (const p of slotPoints(blockB)) assert.ok(!crane.reaches(p), `Block B ${p}`);
  const lane = world.getObject("lane-1");
  const xs = lane.positions().map((v) => lane.at(v).point);
  for (const [i, x] of [531.6, 750, 968.4].entries()) assert.ok(near(xs[i][0], x, 0.1) && near(xs[i][1], 332.2, 1e-9), `truck position ${xs[i]}`);
  for (const p of xs) assert.ok(crane.reaches(p));
  assert.ok(near(lane.geometry.passingOffset, mm(3.5)) && near(332.2 + lane.geometry.passingOffset, 372.4, 0.05), "passing lane at 15 m");
  // the barge berths with its bow at the end of the quay
  const quay = world.getObject("quay-1"), cfg = TERMINAL.barges[0];
  const barge = new Carrier({ id: cfg.id, type: bargeType(cfg) });
  assert.equal(barge.bays, 5);
  const bow = quay.at(quay.geometry.total);
  barge.pose = { center: quay.at(quay.geometry.total - mm(cfg.length_m / 2)).point, heading: Math.atan2(bow.dir[1], bow.dir[0]) };
  for (const p of slotPoints(barge)) assert.ok(crane.reaches(p), `barge slot at ${p}`);
  assert.deepEqual(slotPoints(barge).slice(0, 3).map((p) => +p[1].toFixed(1)), [600.6, 633.9, 667.2]);
  assert.ok(near(quay.geometry.points[0][1] + quay.geometry.quayOffset, 573.6, 0.05), "quay wall at 32.5 m");
  const waterEdge = Math.max(...quay.geometry.water.map((p) => p[1]));
  assert.ok(near(waterEdge, 757.5, 0.05), `water up to ${waterEdge}`);

  // no editor problems in the example
  for (const o of world.objects) assert.deepEqual(o.problems?.() ?? [], [], o.id);
});

test("the example layout: every configured container fits where it is placed", () => {
  const world = createWorld(EXAMPLE);
  const inv = new Inventory();
  for (const train of TERMINAL.trains) train.wagons.forEach((type, k) => inv.addCarrier(new Carrier({ id: `${train.id}/${k + 1}`, type })));
  for (const b of TERMINAL.barges) inv.addCarrier(new Carrier({ id: b.id, type: bargeType(b), label: b.name }));
  for (const o of world.objects) if (o instanceof ContainerYard) inv.addCarrier(new Carrier({ id: o.id, type: o.carrierType(), label: o.name, owner: o.id }));
  for (const c of TERMINAL.containers) assert.equal(inv.add(new Container(c), c.at), null, c.id);
  assert.deepEqual(inv.check(), []);
  assert.equal(inv.snapshot().length, TERMINAL.containers.length);
  assert.deepEqual(inv.snapshot().map((e) => e.id), TERMINAL.containers.map((c) => c.id));
  assert.equal(inv.usedTeu("KT41/1"), 3);
  // the scenario's first moves are possible
  assert.equal(inv.canLift("ARLU 100002 4"), null);
  assert.equal(inv.canLift("ARLU 100001 9"), null);
  assert.equal(inv.canLift("ARLU 100005 0"), "Blocked by ARLU 100006 6 on top: move that first");
  assert.ok(inv.freeSlots("ARLU 100001 9", "yard-a").length > 0);
});
