// The role catalogue (web/game/roles/roles.json, web/arail/game/roles.js): a sound catalogue from the
// politician to the cleaning staff, every family with roles, careers, interactions and ways in naming
// roles and qualifications of the catalogue; the typical moves as a graph; the playable game's role;
// docs/roles.md written from the data (tools/roles-md.mjs). The careers themselves: career.test.js.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ROLE_SETTINGS, SignallerGame, careerGraph, roleCounts, validateRoles } from "../../web/arail/index.js";
import { ROLES_MD, rolesMarkdown } from "../../tools/roles-md.mjs";
import { readJSON } from "./helpers.js";

const CAT = readJSON("web/game/roles/roles.json");

test("the catalogue is sound: ids, families, settings, every field, careers naming roles of the catalogue", () => {
  assert.deepEqual(validateRoles(CAT), []);
  assert.ok(CAT.roles.length >= 100, `${CAT.roles.length} roles`);
  assert.ok(CAT.families.length >= 6);
  const counts = roleCounts(CAT);
  for (const f of CAT.families) assert.ok(counts.family.get(f.id) >= 5, f.id);
  for (const s of ROLE_SETTINGS) assert.ok(counts.setting.get(s) > 0, s);
  // from the politician to the cleaning staff
  assert.ok(CAT.roles.some((r) => r.id === "federal-transport-minister"));
  assert.ok(CAT.roles.some((r) => /clean/.test(r.id)));
  // the checks find what is wrong
  const bad = structuredClone(CAT);
  bad.roles[0].setting = "beach";
  bad.roles[1].career.to.push("astronaut");
  bad.roles.push({ ...bad.roles[2] });
  const careers = CAT.format === "arail-roles/2";
  if (careers) {
    const job = bad.roles.find((r) => r.access.job);
    job.access.routes[0].qualifications.push("pilot-licence");
    job.access.selection = "lottery";
    bad.qualifications[0].requires = [["nowhere"]];
  }
  const problems = validateRoles(bad).join("\n");
  assert.match(problems, /setting must be one of/);
  assert.match(problems, /names an unknown role "astronaut"/);
  assert.match(problems, /the id is used twice/);
  if (careers) {
    assert.match(problems, /needs an unknown qualification "pilot-licence"/);
    assert.match(problems, /selection must be one of/);
    assert.match(problems, /requires an unknown qualification "nowhere"/);
  }
  assert.match(validateRoles({ ...CAT, format: "arail-roles/9" }).join("\n"), /format must be/);
});

test("the typical moves: a graph over the catalogue, from both sides of the careers", () => {
  const { edges, next, prev } = careerGraph(CAT);
  assert.ok(edges.length > CAT.roles.length);
  for (const [a, b] of edges) {
    assert.ok(next.get(a).includes(b));
    assert.ok(prev.get(b).includes(a));
  }
  for (const r of CAT.roles) for (const x of r.career.to) assert.ok(next.get(r.id).includes(x) || x === r.id);
});

test("the playable game belongs to its role in the catalogue", () => {
  const role = CAT.roles.find((r) => r.id === SignallerGame.role);
  assert.ok(role, SignallerGame.role);
  assert.equal(role.game.page, "signaller/");
  assert.deepEqual(CAT.roles.filter((r) => r.game.page).map((r) => r.id), [SignallerGame.role]);
});

test("docs/roles.md is written from the data (node tools/roles-md.mjs)", () => {
  const md = readFileSync(ROLES_MD, "utf8");
  assert.equal(md, rolesMarkdown(CAT), "docs/roles.md is not up to date: run node tools/roles-md.mjs");
  for (const f of CAT.families) assert.ok(md.includes(`## ${f.name}`), f.id);
  for (const r of CAT.roles) assert.ok(md.includes(`<a id="${r.id}"></a>`), r.id);
  for (const q of CAT.qualifications ?? []) assert.ok(md.includes(`<a id="q-${q.id}"></a>`), q.id);
});
