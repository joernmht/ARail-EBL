// The career mode's model (web/arail/game/career.js): a career from a school certificate through
// educations and roles, chosen step by step; what is open at each point; the ways into a role and what
// is missing; experience counted in years; what a role gains; educations alongside a job or not; and
// the real catalogue: every job reachable from leaving school, several ways open, the typical moves
// only hints.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ageOf, careerOptions, createCareer, missingText, prerequisiteTree, reachable, roleStatus, startPoints, study, takeRole, validateRoles, work,
} from "../../web/arail/game/index.js";
import { readJSON } from "./helpers.js";

/** A small catalogue: two school certificates, an apprenticeship, a function training, a degree; three roles. */
const access = (job, routes, more = {}) => ({ job, selection: "application", age_min: 0, fitness: "", routes, gains: [], ...more });
const route = (label, qualifications, experience = []) => ({ label, qualifications, experience, note: "" });
const SMALL = {
  format: "arail-roles/2",
  families: [{ id: "f", name: "F" }],
  qualifications: [
    { id: "school-basic", name: "First school certificate", name_de: "Erster Schulabschluss", kind: "school", months: 0, requires: [], while_working: false, provider: "school", note: "" },
    { id: "abitur", name: "Abitur", name_de: "Abitur", kind: "school", months: 0, requires: [], while_working: false, provider: "school", note: "" },
    { id: "apprenticeship-ops", name: "Apprenticeship in railway operations", name_de: "Eisenbahner/in im Betriebsdienst", kind: "apprenticeship", months: 36, requires: [["school-basic"], ["abitur"]], while_working: false, provider: "company and vocational school", note: "" },
    { id: "function-training-signaller", name: "Signaller function training", name_de: "Funktionsausbildung Fahrdienstleiter", kind: "training", months: 9, requires: [["apprenticeship-ops"], ["bsc"]], while_working: false, provider: "training centre", note: "" },
    { id: "bsc", name: "B.Sc. transport engineering", name_de: "B.Sc. Verkehrsingenieurwesen", kind: "degree", months: 42, requires: [["abitur"]], while_working: false, provider: "university", note: "" },
    { id: "local-knowledge", name: "Local knowledge", name_de: "Örtliche Einweisung", kind: "certificate", months: 0, requires: [["function-training-signaller"]], while_working: true, provider: "employer", note: "" },
  ],
  roles: [],
};
const role = (id, a) => ({ id, name: id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()), family: "f", access: a, career: { from: [], to: [] } });
SMALL.roles = [
  role("signaller", access(true, [route("after the apprenticeship", ["apprenticeship-ops", "function-training-signaller"]), route("after a degree", ["bsc", "function-training-signaller"])], { age_min: 18, gains: ["local-knowledge"] })),
  role("dispatcher", access(true, [route("after years as a signaller", [], [{ roles: ["signaller"], years: 3 }])], { selection: "internal" })),
  role("commuter", access(false, [], { selection: "none" })),
];

test("a career starts from a school certificate; the options at that point", () => {
  assert.deepEqual(startPoints(SMALL).map((s) => [s.id, s.age]), [["school-basic", 16], ["abitur", 18]]);
  assert.throws(() => createCareer(SMALL, "bsc"), /Not a school certificate/);
  const p = createCareer(SMALL, "school-basic");
  assert.equal(ageOf(p), 16);
  const o = careerOptions(SMALL, p);
  assert.deepEqual(o.jobs, []); // no job without a training
  assert.deepEqual(o.educations, ["apprenticeship-ops"]); // the degree needs the Abitur
  assert.equal(o.work, false);
  const withAbitur = careerOptions(SMALL, createCareer(SMALL, "abitur"));
  assert.deepEqual(withAbitur.educations.sort(), ["apprenticeship-ops", "bsc"]); // two ways open
});

test("steps by choice: an apprenticeship, a training, a job; what is missing before", () => {
  const p = createCareer(SMALL, "school-basic");
  let st = roleStatus(SMALL, p, "signaller");
  assert.equal(st.ok, false);
  assert.equal(missingText(SMALL, st.routes[0]), "Apprenticeship in railway operations, Signaller function training");
  assert.match(takeRole(SMALL, p, "signaller").reason, /^Not yet: /);
  assert.match(study(SMALL, p, "function-training-signaller").reason, /needs first: Apprenticeship in railway operations, or B.Sc. transport engineering/);
  assert.deepEqual(study(SMALL, p, "apprenticeship-ops"), { ok: true });
  assert.equal(ageOf(p), 19);
  assert.deepEqual(study(SMALL, p, "function-training-signaller"), { ok: true });
  st = roleStatus(SMALL, p, "signaller");
  assert.equal(st.ok, true);
  assert.equal(st.routes[0].route.label, "after the apprenticeship"); // the open way first
  assert.deepEqual(careerOptions(SMALL, p).jobs, ["signaller"]);
  assert.deepEqual(takeRole(SMALL, p, "signaller"), { ok: true });
  assert.equal(p.current, "signaller");
  assert.equal(roleStatus(SMALL, p, "signaller").ok, false); // already in it
  assert.match(takeRole(SMALL, p, "commuter").reason, /is not a job/);
  // experience: three years as a signaller open the dispatcher's job; after a year, the role's gain
  assert.match(takeRole(SMALL, p, "dispatcher").reason, /3 years as Signaller/);
  work(SMALL, p, 1);
  assert.ok(p.qualifications.has("local-knowledge"));
  work(SMALL, p, 1);
  assert.match(missingText(SMALL, roleStatus(SMALL, p, "dispatcher").routes[0]), /\(2 so far\)/);
  work(SMALL, p, 1);
  assert.deepEqual(takeRole(SMALL, p, "dispatcher"), { ok: true });
  assert.deepEqual(p.log.map((l) => l.kind), ["start", "qualification", "qualification", "role", "gain", "work", "work", "work", "role"]);
});

test("an education away from the job leaves it; one alongside keeps it; the age limit", () => {
  const young = createCareer(SMALL, "abitur");
  assert.equal(ageOf(young), 18);
  study(SMALL, young, "bsc");
  study(SMALL, young, "function-training-signaller");
  assert.equal(roleStatus(SMALL, young, "signaller").ok, true); // after a degree
  takeRole(SMALL, young, "signaller");
  const p = structuredClone(young);
  // an education that cannot be done alongside the job: the role is left for it
  p.qualifications.delete("apprenticeship-ops");
  study(SMALL, p, "apprenticeship-ops");
  assert.equal(p.current, null);
  assert.equal(p.log.at(-2).kind, "leave");
  // a minimum age
  const kid = createCareer(SMALL, "school-basic");
  kid.qualifications.set("apprenticeship-ops", 0).set("function-training-signaller", 0);
  assert.match(takeRole(SMALL, kid, "signaller").reason, /age of at least 18/);
  assert.equal(prerequisiteTree(SMALL, "function-training-signaller").alternatives.length, 2);
});

test("reachable: every job of the small catalogue from leaving school", () => {
  const r = reachable(SMALL);
  assert.deepEqual([...r.roles].sort(), ["dispatcher", "signaller"]);
  assert.ok(r.qualifications.has("local-knowledge")); // gained in a role
});

const CAT = readJSON("web/game/roles/roles.json");

test("the real catalogue: sound, every job reachable from leaving school, several ways open", { skip: CAT.format !== "arail-roles/2" && "the catalogue has no careers yet (format 1)" }, () => {
  const cat = CAT;
  assert.deepEqual(validateRoles(cat), []);
  const jobs = cat.roles.filter((r) => r.access.job);
  const r = reachable(cat);
  assert.deepEqual(jobs.filter((x) => !r.roles.has(x.id)).map((x) => x.id), []);
  // not one path laid out in advance: many jobs have more than one way in, and every school certificate opens several educations
  assert.ok(jobs.filter((x) => x.access.routes.length > 1).length >= jobs.length / 2);
  for (const s of startPoints(cat)) assert.ok(careerOptions(cat, createCareer(cat, s.id)).educations.length >= 3, s.id);
  // entry-level jobs exist for every school certificate after one education
  for (const s of startPoints(cat)) {
    const p = createCareer(cat, s.id);
    const open = careerOptions(cat, p).educations.some((q) => {
      const x = structuredClone(p);
      study(cat, x, q);
      return careerOptions(cat, x).jobs.length > 0;
    });
    assert.ok(open, `${s.id}: a job after one education`);
  }
  // the signaller of the game needs a signaller's training on every way in
  const sig = cat.roles.find((x) => x.id === "signaller-relay");
  assert.ok(sig.access.routes.every((rt) => rt.qualifications.some((q) => /signaller|fahrdienst|railway-operations|betriebsdienst/i.test(q))), JSON.stringify(sig.access.routes));
});
