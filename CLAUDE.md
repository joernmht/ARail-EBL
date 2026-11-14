# ARail-EBL: notes for Claude

Read [CONTRIBUTING.md](CONTRIBUTING.md) first: code style, tests, the corporate design, user-facing text.

## Always cross-check the architecture documentation

The architecture page (`web/architecture/`, on the site at `architecture/`) is drawn from
`web/architecture/model.js` and `web/architecture/models/*.js`: packages, the data flow, and for every
model its classes, activities, settings, events and rules. Whenever you change code under `web/arail`,
`web/app`, `web/markers`, `web/plugins` or `tools`:

1. Update the models in the same change: classes, attributes and operations (parameters as written in
   the code), the activity diagrams (steps, decisions, the code that does each action), events,
   registered types, the settings of simulations, files and package dependencies.
2. Run `node --test tests/js/architecture.test.js`. It checks all of that against the code and names
   what is missing or stale. It is part of `npm test`.
3. Cross-check what the test cannot: that the activity diagrams, rules and constants still describe
   what the code does, and the prose of `docs/architecture.md` and of the guide of the area you
   changed (`docs/*.md`).
4. Documentation that does not match the code: fix it. If the code looks wrong instead, say so.

## People get bird names

Every simulated person is named with birds, so nobody resembles a real person: both parts from one language of
`LANGUAGES` in `web/arail/core/people.js`, shown as "S. Fink". Make people with a `Population`; when you write a person
by hand (a driver in a layout, an example in a guide, a test, a story), pick the name from that list too, never a common
real name like "Weber" or "Müller". `tests/js/people.test.js` checks the JSON of layouts, examples and guides; for
names in code and prose, check yourself.

## Teaching concepts, papers and cases from practice

The project page has a board for each (`web/references.json`; see "The boards of the project page" in CONTRIBUTING.md). When you work on an issue labelled `teaching-concept`, `paper` or `practice-case`:

- Add its entry to `web/references.json` (`in-progress`), and set it to `implemented` with a link to what runs when it is done. Leave it out if the issue says "do not list".
- A `paper` issue allows you to read the paper and implement it only once it also has the label `accepted`: a maintainer has confirmed that its filer is an author (the form's ticks alone are not checked). Without it, don't start and don't list it. Never copy the paper's text into code, docs or the page: implement the method, name the paper.

## Checks

- `npm test`: the Node tests, the architecture check among them.
- `npx playwright test`: the browser tests, also accessibility (`npm run fixtures` first for the video tests).
- `python -m pytest tests/python` and ruff for the Python tools.

## Issues and pull requests

GitHub closes an issue only when a pull request into `main` names it with a closing keyword, one per issue:
`Closes #12, closes #13`. "Part of #12", "(#12)" in a commit, or a bare "#12" link the issue but leave it open.

- Before starting, look for the issues the work answers. In the pull request's first section, write
  `Closes #N` for every issue it finishes, and `Part of #N` for one it only advances.
- Fill in the template's sections. Don't drop the line with the issue when you replace the template's comments.
- Only partly done: comment on the issue with the PR, what is done and what is left, and leave it open.
- Done by an earlier PR that did not close it: close it as completed, with a comment naming the PR.
