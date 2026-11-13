// The project page's three groups (educators, scientists, practitioners): each has an issue form to
// file with, a label its issues are collected by, and a board on the page that lists what has been
// brought (web/references.json), with its status and its links.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

/** The board of each group: its key in references.json, its issue form and the label of its issues. */
const BOARDS = {
  teaching: { form: "teaching_concept.yml", label: "teaching-concept", group: "educators" },
  papers: { form: "paper.yml", label: "paper", group: "scientists" },
  practice: { form: "practice_case.yml", label: "practice-case", group: "practitioners" },
};
const STATUSES = ["proposed", "in-progress", "implemented"];

test("each group of the project page has its issue form, with the label its board links to", () => {
  const html = read("web/index.html");
  for (const [kind, { form, label, group }] of Object.entries(BOARDS)) {
    const yml = read(`.github/ISSUE_TEMPLATE/${form}`);
    assert.match(yml, new RegExp(`^labels: \\["${label}"\\]$`, "m"), `${form} labels its issues ${label}`);
    assert.ok(html.includes(`issues/new?template=${form}"`), `the page links to ${form}`);
    assert.ok(html.includes(`issues?q=label%3A${label}"`), `the page links to the issues labelled ${label}`);
    assert.ok(html.includes(`data-refs="${kind}"`), `the page has the board ${kind}`);
    assert.ok(html.includes(`data-aud="${group}"`) && html.includes(`value="${group}"`), `the switch has ${group}`);
    assert.ok(yml.includes(`?for=${group}`), `${form} links to the page of the ${group}`);
  }
  // a paper is filed by its author, and filing it allows giving it to an AI; the page says the same
  const paper = read(".github/ISSUE_TEMPLATE/paper.yml");
  assert.equal([...paper.matchAll(/required: true/g)].length >= 5, true, "the paper, the method, what to measure and both consents are required");
  assert.match(paper, /I am an author of this paper/);
  assert.match(paper, /given to an AI coding assistant/);
  assert.match(paper, /not republished/);
  assert.match(html, /give the paper to an AI/);
});

test("references.json lists what was brought: a title, a status, an issue, links of this site or https", () => {
  const refs = JSON.parse(read("web/references.json"));
  assert.deepEqual(Object.keys(refs).sort(), Object.keys(BOARDS).sort(), "one list per board");
  const html = read("web/index.html");
  for (const status of STATUSES) assert.ok(html.includes(`${JSON.stringify(status).replace(/^"([a-z]+)"$/, "$1")}: [`), `the page knows the status ${status}`);
  const issues = new Set();
  for (const [kind, list] of Object.entries(refs)) {
    assert.ok(Array.isArray(list), kind);
    for (const r of list) {
      const at = `${kind}: ${r.title}`;
      assert.ok(typeof r.title === "string" && r.title.trim() && r.title.length <= 120, `${at}: a title of at most 120 characters`);
      assert.ok(STATUSES.includes(r.status), `${at}: status one of ${STATUSES.join(", ")}`);
      assert.ok(Number.isInteger(r.issue) && r.issue > 0, `${at}: the number of its issue`);
      assert.ok(!issues.has(r.issue), `${at}: issue #${r.issue} is listed once`);
      issues.add(r.issue);
      if (r.by != null) assert.ok(typeof r.by === "string" && r.by.trim(), `${at}: by`);
      if (r.source != null) assert.match(r.source, /^https:\/\//, `${at}: source is an https link (where the paper is published)`);
      if (r.link != null) assert.match(r.link, /^(https:\/\/|(app|game|live|plan|builder|lab-map)\/)/, `${at}: link is a page of this site (app/…, game/…) or an https link`);
      if (r.status === "implemented") assert.ok(r.link, `${at}: what is implemented has a link to it`);
      assert.deepEqual(Object.keys(r).filter((k) => !["title", "by", "status", "issue", "link", "source"].includes(k)), [], `${at}: no other keys`);
    }
  }
});
