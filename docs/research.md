# Using ARail for research

This guide is for people who want to apply a model or an algorithm of their own to the simulated
railway (dispatching and rescheduling, timetables, passenger flows, disruption management,
maintenance strategies) on the lab's layout or a virtual one. It shows the ways in, and what of
ARail you can leave aside.

## What you need, and what you do not

- **The framework**, `web/arail/` (entry `web/arail/index.js`): the world, layouts and their
  modules, the simulations (passengers, town, road traffic, the container terminal, rail
  operations, infrastructure, journeys), disruptions and scenarios, drawing. It runs in the browser
  and in Node, without a build step.
- **Layouts**, `web/layouts/`: the lab (Beta 0.1), Bf Neustadt from the lab survey, the container
  terminal; or your own (see [Layout file format](layout-format.md)).
- Not needed: the **role games** (`web/arail/game/`, the pages `game/signaller/`, `game/roles/`,
  `game/career/`). They have their own entry (`web/arail/game/index.js`), and no part of the
  framework imports them (a test checks it), so a layout, a simulation or a plugin loads none of
  their code. The app's **stories** (the maintenance, operations and journeys stories) only run
  when a layout's story module is switched on.

## The ways in

| Your work | The way in | Guide |
| --- | --- | --- |
| A simulation, a disruption type, an object of your own | A plugin: a module whose default export registers your types (`registry.registerSimulation`, `registerDisruption`, `registerObject`); the layout lists it | [Extending ARail](extending.md) |
| Your algorithm runs the trains of some platforms | A planner (`world.services.planner = {claims(dock), statusLines(area)}`): those tracks get no timetable trains, your code calls them with `world.services.call(dock, {source: "plan"})`; the rail operations do it this way | [Extending ARail](extending.md), `web/arail/core/services.js` |
| Your algorithm (or the lab's interlocking) runs outside, in Python or elsewhere | The control-system feed: train positions and disruptions over WebSocket, the Python bridge with adapters | [Control-system interface](control-system-interface.md) |
| Experiments without a browser | Node: `createWorld(layout, {seed})`, `world.step(dt)`; the operations engine and `tools/ops-compare.mjs` (setups × stress tests, CSV); the infrastructure engine without a world | [Rail operations](operations.md), [Infrastructure](infrastructure.md), [`tools/README.md`](../tools/README.md) |
| Stress tests, the same for every run | Disruptions and scenarios as data in the layout | [Disruptions and scenarios](disruptions-and-scenarios.md) |

The simulations are deterministic: the same seed and the same inputs give the same run, in Node and
in the browser; time is simulated time, with a fast clock (see [Day and night](day-and-night.md)).

## In the browser

- The **app** (`app/`) is an interactive presentation of the lab: its module tabs are stories to
  click through. Build, Disruptions and Settings work on any layout.
- The **game page** (`game/`) has the tools with the most to set and measure: the rail operations
  with their setups compared under stress tests and CSV export, the infrastructure asset
  management over budget years, the journeys exercise, the whole container terminal. The name is
  historical: for research it is the workbench.

## What the role games cost you

Measured on the branch that added them:

| | |
| --- | --- |
| Running a simulation | nothing: game code never runs in a simulation |
| Loading the framework | nothing: the framework does not import the games |
| Stories | their types are registered (three story simulations, one hidden disruption type), and they run only when a layout's story module is on |
| Tests | the games' Node tests take about 2 s; their browser tests 4 of the specs |
| Repository | the role catalogue's data and its guide, about 2.6 MB, next to the lab's photos and videos |

## When you contribute

Run `npm test` (also the architecture check: describe new files in `web/architecture/`, see
[CONTRIBUTING.md](../CONTRIBUTING.md)), `npx playwright test` for the pages you touch, and keep the
guide of the area you change up to date.
