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

## Checks

- `npm test`: the Node tests, the architecture check among them.
- `npx playwright test`: the browser tests, also accessibility (`npm run fixtures` first for the video tests).
- `python -m pytest tests/python` and ruff for the Python tools.
