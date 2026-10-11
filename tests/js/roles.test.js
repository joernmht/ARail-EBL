// The role catalogue (web/game/roles/roles.json, web/arail/game/roles.js): a sound catalogue from the
// politician to the cleaning staff, every family with roles, careers and interactions naming roles of
// the catalogue; the career graph and the shortest career; the playable game's role; docs/roles.md
// written from the data (tools/roles-md.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ROLE_SETTINGS, SignallerGame, careerGraph, careerPath, roleCounts, validateRoles } from "../../web/arail/index.js";
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
  const problems = validateRoles(bad).join("\n");
  assert.match(problems, /setting must be one of/);
  assert.match(problems, /names an unknown role "astronaut"/);
  assert.match(problems, /the id is used twice/);
});

test("the careers: a graph over the catalogue, the shortest career between two roles", () => {
  const { edges, next, prev } = careerGraph(CAT);
  assert.ok(edges.length > CAT.roles.length);
  for (const [a, b] of edges) {
    assert.ok(next.get(a).includes(b));
    assert.ok(prev.get(b).includes(a));
  }
  const path = careerPath(CAT, "train-cleaner", "federal-transport-minister");
  assert.ok(path && path[0] === "train-cleaner" && path.at(-1) === "federal-transport-minister", String(path));
  for (let i = 1; i < path.length; i++) assert.ok(next.get(path[i - 1]).includes(path[i]));
  assert.deepEqual(careerPath(CAT, "train-cleaner", "train-cleaner"), ["train-cleaner"]);
  assert.equal(careerPath(CAT, "train-cleaner", "nobody"), null);
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
});
