// The role catalogue (web/game/roles/roles.json, web/arail/game/roles.js): a sound catalogue from the
// politician to the cleaning staff, every family with roles, careers, interactions and ways in naming
// roles and qualifications of the catalogue; the typical moves as a graph; who gives what to whom (party,
// scale, the flows a role gives, what it takes); the playable games' roles; docs/roles.md written from
// the data (tools/roles-md.mjs). The careers themselves: career.test.js.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FLOWS, GAMES, PARTIES, ROLE_SETTINGS, SCALES, SignallerGame, careerGraph, flowGraph, flowOf, roleCounts, takesOf, validateRoles } from "../../web/arail/game/index.js";
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
  const careers = CAT.format !== "arail-roles/1";
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

test("who gives what to whom: every role has a party, a rhythm and flows; every pair that works together exchanges one", () => {
  assert.equal(CAT.format, "arail-roles/3");
  const parties = new Set(PARTIES.map((p) => p.id)), used = new Set();
  for (const r of CAT.roles) {
    assert.ok(parties.has(r.party), `${r.id}: ${r.party}`);
    used.add(r.party);
    assert.ok(SCALES.indexOf(r.scale) >= 0 && SCALES.indexOf(r.horizon) >= SCALES.indexOf(r.scale), `${r.id}: ${r.scale}, ${r.horizon}`);
    assert.ok(r.gives.length >= 2, `${r.id} gives ${r.gives.length} flows`);
    for (const g of r.gives) assert.ok(flowOf(g.flow) && g.to.length && !g.to.includes(r.id) && !/[.!]$/.test(g.what), `${r.id}: ${g.flow}`);
  }
  assert.deepEqual([...parties].filter((p) => !used.has(p)), [], "every party has a role");
  // what a role takes is what the others give it
  const takes = takesOf(CAT), fg = flowGraph(CAT);
  assert.equal(fg.edges.length, CAT.roles.reduce((a, r) => a + r.gives.reduce((b, g) => b + g.to.length, 0), 0));
  assert.ok(fg.edges.length > 2000, `${fg.edges.length} flows from role to role`);
  for (const r of CAT.roles) assert.ok(takes.get(r.id).length >= 1, `${r.id} takes nothing`);
  assert.deepEqual(FLOWS.filter((f) => !fg.flows.has(f.id)).map((f) => f.id), [], "every flow of the catalogue is given by a role");
  const sig = takes.get("signaller-relay"), by = (flow) => sig.find((t) => t.flow === flow)?.from ?? [];
  assert.ok(by("repair-status").includes("maintenance-dispatcher") && by("dispatching-order").includes("train-dispatcher"));
  assert.ok(CAT.roles.find((r) => r.id === "signaller-relay").gives.find((g) => g.flow === "fault-report").to.includes("maintenance-dispatcher"));
  assert.ok(CAT.roles.find((r) => r.id === "bundestag-budget-mp").gives.some((g) => g.flow === "budget"));
  // the games' ports are flows their roles give and take in the catalogue (a game is a part of its role)
  for (const G of GAMES.values()) {
    const role = CAT.roles.find((r) => r.id === G.role);
    for (const g of G.gives) {
      if (g.flow === "performance-report" || !g.to) continue;
      const entry = role.gives.find((x) => x.flow === g.flow);
      assert.ok(entry && g.to.some((x) => entry.to.includes(x)), `${G.id} gives ${g.flow} to ${g.to}: not in the catalogue's ${G.role}`);
    }
    for (const t of G.takes) {
      if (!t.from) continue;
      const entry = takes.get(G.role).find((x) => x.flow === t.flow);
      assert.ok(entry && t.from.some((x) => entry.from.includes(x)), `${G.id} takes ${t.flow} from ${t.from}: not in the catalogue's ${G.role}`);
    }
  }
  // the checks find what is wrong
  const bad = structuredClone(CAT);
  const [a, b] = bad.roles;
  a.party = "moon-base";
  a.scale = "weeks";
  a.gives.push({ flow: "telepathy", to: [a.id, "astronaut"], what: "" });
  a.gives.push({ ...a.gives[0] });
  b.horizon = "seconds";
  b.scale = "years";
  const lonely = bad.roles[5];
  for (const r of bad.roles) for (const g of r.gives) g.to = g.to.filter((x) => x !== lonely.id);
  lonely.gives = [];
  const problems = validateRoles(bad).join("\n");
  for (const part of ['unknown party "moon-base"', "scale must be one of", 'gives an unknown flow "telepathy"', "to itself", 'to an unknown role "astronaut"', "does not say what is handed over", "twice", "the horizon (seconds) is shorter than the scale (years)", `role ${lonely.id}: gives is missing`, `role ${lonely.id}: takes nothing`, "but no flow passes between them"]) assert.ok(problems.includes(part), part);
  // a catalogue of format 2 has no flows and is sound without them
  const two = structuredClone(CAT);
  two.format = "arail-roles/2";
  for (const r of two.roles) for (const k of ["party", "scale", "horizon", "gives"]) delete r[k];
  assert.deepEqual(validateRoles(two), []);
});

test("the playable games belong to their roles in the catalogue; a role's page is the game's or a mission that seats it", () => {
  const missions = (id) => readJSON(`web/game/missions/${id}.json`);
  assert.deepEqual(CAT.roles.filter((r) => r.game.page).map((r) => r.id).sort(), [...GAMES.values()].map((G) => G.role).sort());
  assert.equal(CAT.roles.find((r) => r.id === SignallerGame.role).game.page, "signaller/");
  for (const G of GAMES.values()) {
    const page = CAT.roles.find((r) => r.id === G.role).game.page;
    const m = page.match(/^play\/\?mission=([a-z-]+)$/);
    if (G === SignallerGame) continue;
    assert.ok(m, `${G.role}: ${page}`);
    assert.ok(missions(m[1]).roles.some((r) => r.role === G.role && r.game === G.id && r.seat === "human"), `${page} seats ${G.role} for a person`);
  }
});

test("docs/roles.md is written from the data (node tools/roles-md.mjs)", () => {
  const md = readFileSync(ROLES_MD, "utf8");
  assert.equal(md, rolesMarkdown(CAT), "docs/roles.md is not up to date: run node tools/roles-md.mjs");
  for (const f of CAT.families) assert.ok(md.includes(`## ${f.name}`), f.id);
  for (const r of CAT.roles) assert.ok(md.includes(`<a id="${r.id}"></a>`), r.id);
  for (const q of CAT.qualifications ?? []) assert.ok(md.includes(`<a id="q-${q.id}"></a>`), q.id);
  for (const f of FLOWS) assert.ok(md.includes(`<a id="flow-${f.id}"></a>`), f.id);
  assert.ok(md.includes("- **Gives:** ") && md.includes("- **Takes:** ") && md.includes("## Parties"));
});
