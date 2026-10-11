#!/usr/bin/env node
// Write docs/roles.md, the role catalogue as a guide, from its data (web/game/roles/roles.json).
//
//   node tools/roles-md.mjs            writes docs/roles.md
//   node tools/roles-md.mjs --check    exits with 1 if docs/roles.md is not up to date
//
// tests/js/roles.test.js checks that docs/roles.md is what this script writes.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ROLE_SETTINGS, careerGraph, roleCounts, validateRoles } from "../web/arail/game/roles.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const ROLES_JSON = `${ROOT}web/game/roles/roles.json`;
export const ROLES_MD = `${ROOT}docs/roles.md`;

const SETTING = { operational: "operational", field: "in the field", office: "in the office", mixed: "mixed" };
const KIND = { knowledge: "knowledge", simulation: "simulation", both: "knowledge and simulation" };

/** Text for a table cell or a list line: no line breaks, no pipes. */
const cell = (s) => String(s ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").trim();

/**
 * The guide of a role catalogue.
 * @param {{families: Array<{id: string, name: string, description?: string}>, roles: object[]}} cat
 * @returns {string} Markdown
 */
export function rolesMarkdown(cat) {
  const byId = new Map(cat.roles.map((r) => [r.id, r]));
  const name = (id) => byId.get(id)?.name ?? id;
  const ref = (id) => `[${cell(name(id))}](#${id})`;
  const counts = roleCounts(cat);
  const { edges } = careerGraph(cat);
  const out = [];
  out.push("# Roles of the railway", "");
  out.push("<!-- Written by tools/roles-md.mjs from web/game/roles/roles.json: change the data, then run `node tools/roles-md.mjs`. -->", "");
  out.push(`From the politician to the cleaning staff: ${cat.roles.length} roles of the German railway system in ${cat.families.length} families, described for game design and teaching. For each role: where the work is done, the decisions taken and their effects, the budgets and means with orders of magnitude, the rules and limits, the personal risks, the career (how one becomes it, where one comes from and can go, pay), what the role is measured by, the rhythm of its decisions, the roles it works with, and a mini game. How the games fit together is in [Games](games.md); the catalogue can be browsed and searched on the roles page (\`game/roles/\`), and its data is \`web/game/roles/roles.json\`.`, "");
  out.push("The catalogue was compiled for game design: names, rules and numbers are simplified and given in orders of magnitude, and are to be checked by the chair's experts before they are taught as facts. German terms are given in parentheses where they help.", "");
  out.push("## Overview", "");
  out.push(`| Family | Roles | ${ROLE_SETTINGS.map((s) => SETTING[s]).join(" | ")} |`, `| --- | ---: | ${ROLE_SETTINGS.map(() => "---:").join(" | ")} |`);
  for (const f of cat.families) {
    const rs = cat.roles.filter((r) => r.family === f.id);
    out.push(`| [${cell(f.name)}](#${f.id}) | ${rs.length} | ${ROLE_SETTINGS.map((s) => rs.filter((r) => r.setting === s).length).join(" | ")} |`);
  }
  out.push(`| **All** | **${cat.roles.length}** | ${ROLE_SETTINGS.map((s) => `**${counts.setting.get(s) || 0}**`).join(" | ")} |`, "");
  out.push(`Mini games: ${["knowledge", "simulation", "both"].map((k) => `${counts.kind.get(k) || 0} ${KIND[k]}`).join(", ")}; effort to build them on ARail: ${["small", "medium", "large"].map((e) => `${counts.effort.get(e) || 0} ${e}`).join(", ")}. The careers of the catalogue join the roles by ${edges.length} steps from one role to another.`, "");
  const playable = cat.roles.filter((r) => r.game?.page);
  if (playable.length) out.push(`Playable now: ${playable.map((r) => `${ref(r.id)} (\`game/${r.game.page}\`)`).join(", ")}.`, "");
  for (const f of cat.families) {
    const rs = cat.roles.filter((r) => r.family === f.id);
    out.push(`<a id="${f.id}"></a>`, "", `## ${f.name}`, "");
    if (f.description) out.push(f.description, "");
    out.push("| Role | German | Where | Mini game |", "| --- | --- | --- | --- |");
    for (const r of rs) out.push(`| ${ref(r.id)} | ${cell(r.name_de)} | ${SETTING[r.setting] ?? r.setting} | ${cell(r.game?.title)} (${KIND[r.game?.kind] ?? r.game?.kind}, ${r.game?.effort}) |`);
    out.push("");
    for (const r of rs) {
      const g = r.game || {};
      out.push(`<a id="${r.id}"></a>`, "", `### ${r.name}`, "");
      out.push(`*${cell(r.name_de)}* · ${cell(r.organisation)} · ${SETTING[r.setting] ?? r.setting} · ${cell(r.timescale)}`, "");
      out.push(cell(r.summary), "");
      out.push(`- **Decides:** ${r.decisions.map(cell).join("; ")}.`);
      out.push(`- **Effects:** ${r.effects.map(cell).join("; ")}.`);
      out.push(`- **Means and budgets:** ${r.resources.map(cell).join("; ")}.`);
      out.push(`- **Rules and limits:** ${r.limits.map(cell).join("; ")}.`);
      out.push(`- **Personal risks:** ${r.risks.map(cell).join("; ")}.`);
      out.push(`- **Career:** ${cell(r.career.entry)} Comes from: ${r.career.from.length ? r.career.from.map(ref).join(", ") : "–"}. Leads to: ${r.career.to.length ? r.career.to.map(ref).join(", ") : "–"}. ${cell(r.career.chances)}`);
      out.push(`- **Measured by:** ${r.kpis.map(cell).join("; ")}.`);
      out.push(`- **Works with:** ${r.interacts?.length ? r.interacts.map(ref).join(", ") : "–"}.`);
      out.push(`- **Mini game, ${cell(g.title)}** (${KIND[g.kind] ?? g.kind}, effort ${g.effort}${g.page ? `, playable: \`game/${g.page}\`` : ""}): ${cell(g.loop)} *Success:* ${cell(g.win)} *Knowledge:* ${cell(g.knowledge)} *Builds on:* ${(g.arail || []).map(cell).join(", ")}. *In the big game:* ${cell(g.bigGame)}`);
      out.push("");
    }
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cat = JSON.parse(readFileSync(ROLES_JSON, "utf8"));
  const problems = validateRoles(cat);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  const md = rolesMarkdown(cat);
  if (process.argv.includes("--check")) {
    let now = "";
    try {
      now = readFileSync(ROLES_MD, "utf8");
    } catch {
      /* missing: not up to date */
    }
    if (now !== md) {
      console.error("docs/roles.md is not up to date: run node tools/roles-md.mjs");
      process.exit(1);
    }
  } else {
    writeFileSync(ROLES_MD, md);
    console.log(`docs/roles.md: ${cat.roles.length} roles`);
  }
}
