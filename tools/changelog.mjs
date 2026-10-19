#!/usr/bin/env node
// Merge the changelog fragments (changes/*.md) into CHANGELOG.md, section "Unreleased".
//
// Every pull request adds a fragment of its own instead of editing CHANGELOG.md, so two pull requests
// never change the same lines: changes/<topic>.<kind>.md, <kind> one of added, changed, deprecated,
// removed, fixed, security; its text is one or more list items ("- **Trams** ..."). At a release, or
// whenever the changelog should be read in one piece, this script moves them into CHANGELOG.md.
//
//   node tools/changelog.mjs            merges the fragments into CHANGELOG.md and deletes them
//   node tools/changelog.mjs --check    exits with 1 if a fragment is malformed
//
// tests/js/changelog.test.js checks the fragments in changes/ and the merge.
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const CHANGES_DIR = `${ROOT}changes`;
export const CHANGELOG_MD = `${ROOT}CHANGELOG.md`;

/** The kinds of change in the order of Keep a Changelog, with their headings. */
export const KINDS = { added: "Added", changed: "Changed", deprecated: "Deprecated", removed: "Removed", fixed: "Fixed", security: "Security" };

/**
 * What is wrong with a fragment.
 * @param {string} name file name, e.g. "trams.added.md"
 * @param {string} text its content
 * @returns {string[]} the faults, empty if it is fine
 */
export function fragmentFaults(name, text) {
  const m = /^[a-z0-9][a-z0-9-]*\.([a-z]+)\.md$/.exec(name);
  if (!m) return [`${name}: name it <topic>.<kind>.md (lower case, digits and hyphens)`];
  const faults = [];
  if (!(m[1] in KINDS)) faults.push(`${name}: the kind "${m[1]}" is not one of ${Object.keys(KINDS).join(", ")}`);
  if (!text.trim()) faults.push(`${name}: empty`);
  else if (!text.trimStart().startsWith("- ")) faults.push(`${name}: start with a list item ("- ...")`);
  return faults;
}

/**
 * The changelog with the fragments in its section "Unreleased", each under the heading of its kind
 * (created where missing, in the order of KINDS), after the items already there.
 * @param {string} changelog CHANGELOG.md
 * @param {Array<{name: string, text: string}>} fragments sorted by name
 * @returns {string}
 */
export function mergeFragments(changelog, fragments) {
  const lines = changelog.split("\n");
  const start = lines.findIndex((l) => /^## \[Unreleased\]/.test(l));
  if (start < 0) throw new Error("CHANGELOG.md has no section \"## [Unreleased]\"");
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  const byKind = new Map();
  for (const f of fragments) {
    const kind = f.name.split(".").at(-2);
    byKind.set(kind, [...(byKind.get(kind) ?? []), f.text.trim()]);
  }
  for (const [kind, heading] of Object.entries(KINDS)) {
    const items = byKind.get(kind);
    if (!items) continue;
    const block = items.join("\n").split("\n");
    const h = lines.findIndex((l, i) => i > start && i < end && l === `### ${heading}`);
    if (h < 0) {
      // a new heading before the first heading of a later kind, else at the end of the section
      const later = Object.values(KINDS).slice(Object.keys(KINDS).indexOf(kind) + 1);
      let at = lines.findIndex((l, i) => i > start && i < end && later.some((x) => l === `### ${x}`));
      if (at < 0) at = end;
      const added = [`### ${heading}`, "", ...block, ""];
      lines.splice(at, 0, ...added);
      end += added.length;
      continue;
    }
    // after the last line of this heading's block: before the next heading, past trailing blank lines
    let at = lines.findIndex((l, i) => i > h && (i >= end || /^#{2,3} /.test(l)));
    if (at < 0) at = lines.length;
    while (at > h + 1 && lines[at - 1] === "") at--;
    lines.splice(at, 0, ...block);
    end += block.length;
  }
  return lines.join("\n");
}

/** The fragments in changes/ (README.md aside), sorted by name. */
export function readFragments(dir = CHANGES_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort()
    .map((name) => ({ name, text: readFileSync(`${dir}/${name}`, "utf8") }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fragments = readFragments();
  const faults = fragments.flatMap((f) => fragmentFaults(f.name, f.text));
  if (faults.length) {
    console.error(faults.join("\n"));
    process.exit(1);
  }
  if (process.argv.includes("--check")) {
    console.log(`${fragments.length} changelog fragments, all fine`);
  } else {
    writeFileSync(CHANGELOG_MD, mergeFragments(readFileSync(CHANGELOG_MD, "utf8"), fragments));
    for (const f of fragments) unlinkSync(`${CHANGES_DIR}/${f.name}`);
    console.log(`${fragments.length} changelog fragments merged into CHANGELOG.md`);
  }
}
