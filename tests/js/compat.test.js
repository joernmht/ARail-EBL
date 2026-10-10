// May this train run here? (rail/compat.js): a train's vehicles against the systems of a section:
// traction power and pantograph, train protection and ETCS, radio, gauge, line category and the
// authorisation for the country; on the card of a train and as the colour of the tracks.
import assert from "node:assert/strict";
import test from "node:test";

import { COMPATIBILITY, Consist, checkSection, checkTracks, createWorld } from "../../web/arail/index.js";
import { readJSON } from "./helpers.js";

const train = (...vehicles) => new Consist({ vehicles });
const keys = (r) => r.problems.map((p) => p.key);

test("a German regional train runs in Germany, not on a Czech section", () => {
  const re = train({ type: "br146" }, { type: "dbpza", count: 4 });
  assert.equal(checkSection(re, {}).ok, true);
  assert.equal(checkSection(re, { country: "DE", etcs: "l2" }).ok, true, "PZB is enough where there is ETCS too");
  const cz = checkSection(re, { country: "CZ" });
  assert.equal(cz.ok, false);
  assert.deepEqual(keys(cz).sort(), ["country", "power", "train_control"]);
  assert.match(cz.problems.find((p) => p.key === "power").text, /3 kV DC: no vehicle can draw this power/);
  assert.match(cz.problems.find((p) => p.key === "country").text, /BR 146\.2, DBpza/);
});

test("a multi-system locomotive with ETCS runs on both sides of the border", () => {
  const ec = train({ type: "br193" }, { type: "bpmz", count: 6 });
  for (const country of ["DE", "CZ", "AT", "PL", "NL"]) assert.deepEqual(keys(checkSection(ec, { country })), [], country);
  // Switzerland: 1450 mm heads (the Vectron has them), but it is not authorised there; the coaches are
  assert.deepEqual(keys(checkSection(ec, { country: "CH" })), ["country"]);
  assert.match(checkSection(ec, { country: "CH" }).problems[0].text, /BR 193/);
  // ETCS level 2 only: the Vectron has it, the BR 146 does not
  assert.equal(checkSection(ec, { country: "DE", train_control: "none", etcs: "l2", signalling: "etcs" }).ok, true);
  assert.deepEqual(keys(checkSection(train({ type: "br146" }), { train_control: "none", etcs: "l2" })), ["train_control"]);
});

test("power: diesels run anywhere, electric vehicles not on unelectrified lines; pantograph heads", () => {
  assert.equal(checkSection(train({ type: "br642" }), { power: "none" }).ok, true);
  assert.deepEqual(keys(checkSection(train({ type: "et442" }), { power: "none" })), ["power"]);
  // an electric locomotive that cannot draw the power is hauled by a diesel
  const r = checkSection(train({ type: "br218" }, { type: "br146" }), { power: "dc3", country: "DE" });
  assert.deepEqual(keys(r), []);
  assert.ok(r.notes.some((n) => /BR 146\.2 cannot draw 3 kV DC/.test(n)));
  // the BR 146 has only 1950 mm heads
  assert.deepEqual(keys(checkSection(train({ type: "br146" }), { pantograph_mm: "1450" })), ["pantograph_mm"]);
  assert.deepEqual(keys(checkSection(train({ type: "sgns", count: 5 }), {})), ["power"], "wagons alone do not move");
});

test("line category: a full freight train is too heavy per axle for category C2, not for D4", () => {
  // a diesel of 19.75 t per axle, so that only the wagons count
  const freight = new Consist({ vehicles: [{ type: "br218" }, { type: "sgns", count: 10, loaded: true }] });
  assert.equal(checkSection(freight, { route_class: "D4" }).ok, true);
  const c2 = checkSection(freight, { route_class: "C2" });
  assert.deepEqual(keys(c2), ["route_class"]);
  assert.match(c2.problems[0].text, /20 t per axle; Sgns has 22\.5 t/);
  assert.deepEqual(keys(checkSection(train({ type: "br185" }), { route_class: "C2" })), ["route_class"], "a TRAXX of 21.25 t per axle neither");
  const empty = new Consist({ vehicles: [{ type: "br218" }, { type: "sgns", count: 10 }] });
  assert.equal(checkSection(empty, { route_class: "C2" }).ok, true, "empty it may run");
  // radio, gauge
  assert.deepEqual(keys(checkSection(train({ type: "eu07" }), { country: "PL", radio: "frmcs" })), ["radio"]);
  assert.ok(keys(checkSection(train({ type: "br146" }), { gauge_mm: "1520" })).includes("gauge_mm"));
});

test("the lab's border station: RE 1 may not run on the Czech track G3; its card says so, and the tracks show it", () => {
  const json = readJSON("web/layouts/ebl-lab.json");
  for (const l of json.layers) l.enabled = l.id === "border";
  const world = createWorld(json);
  const re = new Consist(json.consists.find((c) => c.id === "re1"));
  const checks = Object.fromEntries(checkTracks(re, world).map((c) => [c.track.id, c.ok]));
  assert.deepEqual(checks, { "track-g1": true, "track-g2": true, "track-g3": false });
  // the card of RE 1 standing at G3
  world.services.call("platform-1:right", { line: "RE 1" });
  for (let i = 0; i < 100; i++) world.step(0.1);
  const v = world.services.vehicles().find((x) => x.line === "RE 1" && x.dock.track === "G3");
  assert.ok(v, "RE 1 at G3");
  const card = world.card({ key: `vehicle:${v.id}`, kind: "train", label: v.line, outline: [], owner: world.services, ref: v });
  assert.equal(card.tone, "bad");
  assert.match(card.status, /may not run on this track/);
  const may = card.sections.find((s) => s.title === "May it run here?");
  assert.ok(may.lines.includes("Track G1: yes"));
  assert.ok(may.lines.some((l) => /^Track G3: no · .*Not authorised in CZ/.test(l)));
  assert.ok(card.actions.some((a) => a.id === "compatibility"));
  // the tracks coloured by it
  world.compatibilityTrain = { name: "RE 1", consist: re };
  world.settings.trackSystems = COMPATIBILITY;
  const labels = [];
  const view = { virtual: false, m: (x) => (x * 1000) / 87, showsReal: () => true, ribbon() {}, line() {}, polygon() {}, label: (at, text) => labels.push(text) };
  for (const id of ["track-g1", "track-g3"]) world.getObject(id).draw(view);
  assert.deepEqual(labels, ["may run", "may not run: 3 kV DC"]);
  world.load(json);
  assert.equal(world.compatibilityTrain, null, "forgotten with another layout");
});
