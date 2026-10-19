# Changelog fragments

A pull request does not edit `CHANGELOG.md`. It adds a file here instead, so that two pull requests never change the same lines:

```
changes/<topic>.<kind>.md
```

- `<topic>`: a short name in lower case with hyphens, e.g. `tram-loops` or `181-landing-page`.
- `<kind>`: `added`, `changed`, `deprecated`, `removed`, `fixed` or `security` (the headings of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)).
- The text: one or more list items, written as they should appear in the changelog:

  ```markdown
  - **Trams turn in loops** (`tram-line`, `web/arail/objects/tram.js`): ...
  ```

A change of several kinds gets one file per kind (`trams.added.md`, `trams.fixed.md`).

`node tools/changelog.mjs` moves all fragments into the section "Unreleased" of `CHANGELOG.md`, each under the heading of its kind, and deletes them. This happens at a release, or whenever the changelog should be read in one piece. `npm test` checks that every fragment is named and written correctly (`tests/js/changelog.test.js`).
