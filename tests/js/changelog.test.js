// The changelog fragments (changes/*.md, tools/changelog.mjs): every fragment is well formed, and the
// merge puts each under the heading of its kind in "Unreleased", creating headings in their order.
import assert from "node:assert/strict";
import test from "node:test";

import { fragmentFaults, mergeFragments, readFragments } from "../../tools/changelog.mjs";

test("the fragments in changes/ are well formed", () => {
  const faults = readFragments().flatMap((f) => fragmentFaults(f.name, f.text));
  assert.deepEqual(faults, []);
});

test("a malformed fragment is named", () => {
  assert.equal(fragmentFaults("trams.added.md", "- **Trams**\n").length, 0);
  assert.match(fragmentFaults("Trams.md", "- x")[0], /name it/);
  assert.match(fragmentFaults("trams.new.md", "- x")[0], /kind "new"/);
  assert.match(fragmentFaults("trams.fixed.md", " \n")[0], /empty/);
  assert.match(fragmentFaults("trams.fixed.md", "Trams")[0], /list item/);
});

test("fragments go under their headings in Unreleased, after the items there; missing headings in order", () => {
  const log = [
    "# Changelog", "", "## [Unreleased]", "", "### Added", "", "- old added", "", "### Fixed", "", "- old fixed", "",
    "## [0.1.0] – 2026-09-30", "", "### Added", "", "- released", "",
  ].join("\n");
  const out = mergeFragments(log, [
    { name: "a.added.md", text: "- new added\n" },
    { name: "b.changed.md", text: "- new changed\n  with a second line\n" },
    { name: "c.fixed.md", text: "- new fixed\n" },
    { name: "d.security.md", text: "- new security\n" },
  ]);
  assert.equal(out, [
    "# Changelog", "", "## [Unreleased]", "", "### Added", "", "- old added", "- new added", "",
    "### Changed", "", "- new changed", "  with a second line", "",
    "### Fixed", "", "- old fixed", "- new fixed", "",
    "### Security", "", "- new security", "",
    "## [0.1.0] – 2026-09-30", "", "### Added", "", "- released", "",
  ].join("\n"));
  assert.equal(mergeFragments(log, []), log);
  assert.throws(() => mergeFragments("# Changelog\n", [{ name: "a.added.md", text: "- x" }]), /Unreleased/);
});
