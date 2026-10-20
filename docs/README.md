# ARail-EBL documentation

**Using ARail**

| Guide | What it covers |
| --- | --- |
| [Getting started](getting-started.md) | The app: image sources, the flyover, the panels, keyboard shortcuts and URL options |
| [Setting up a lab](lab-setup.md) | Markers and dictionaries (also on model wagons), printing, placement, cameras and the marker map |
| [Lab session](lab-session.md) | Stickers on the whole layout, one video and `arail-survey`: a fixed (locked) layout and an orthophoto of the table |
| [Streets, trams, buses and road traffic](streets-and-buses.md) | Streets as a road network with cross-sections by the German guidelines; bus and tram stops and lines; cars with parking; bikes and e-scooters; signs, lights, zebra and railway crossings |
| [The builder](world-builder.md) | A street and layout editor beside the app: streets that join, what needs a street put at one, the check that everything has a street to it (with fixes), covered photos, a push to GitHub in one commit |
| [Container terminal](container-terminal.md) | Container trains, trucks and barges, gantry cranes and the yard; model wagons with deck cards (rolling-stock markers); the Terminal panel |
| [Infrastructure](infrastructure.md) | The maintenance story of the app on Bf Neustadt (a signal fails, is repaired and exchanged; a track renewed with a construction train), step by step; on the game page railway assets with their condition, faults and what is known of them; maintenance staff in shifts, emergency vans and drones; renewals and upgrades through the HOAI phases with funding, approval and tenders; the roles of the game; the asset information model, the line map and GeoJSON |
| [Rail operations](operations.md) | The operations plan of the app on Bf Neustadt (units and drivers on the trains, the trains on tracks, Run); the operations story of the app on Bf Neustadt (a train breaks down, the spare unit comes from the depot, the passengers change trains, the broken unit goes to the workshop), step by step; on the game page units with maintenance and failures, the four ECM functions and the penalties between the parties, crews with duties, rosters and the way to work; comparing setups under stress tests; the Operations panel |
| [Journeys](journeys.md) | The journeys story of the app on Bf Neustadt (a late train, a lost connection, the bus instead, passenger rights), step by step; on the game page, an exercise: every attendee makes a traveller with a start and an aim and chooses a travel plan with transfers (walks, buses, trains); the travellers on the layout, missed connections and the results; the Journeys panel |
| [Games](games.md) | A game for every role of the railway system: the role catalogue, what each mini game has, the game core, the career mode as a graph of possibilities (the career planner) and the railway undertaking's simulator, the big game; the first role game, the signaller of Bf Neustadt (routes in a relay interlocking, a failed signal, the substitute signal, a closure for the repair team) |
| [Roles of the railway](roles.md) | The role catalogue: the roles of the German railway system from the politician to the cleaning staff, each with its decisions, means, limits, personal risks, ways in and a mini game; the qualifications of the sector with their prerequisites (written from `web/game/roles/roles.json`) |
| [Languages](languages.md) | The app in English or German: choosing the language, how texts are translated, adding texts (also for plugins), the glossary of railway terms |
| [Railway systems and trains](rail-systems.md) | What each track section is equipped with (traction power, train protection, ETCS, signals, radio, gauge, line category, country); colouring the tracks by a system; where systems change (borders, separation sections); vehicles, consists and the train data (brake percentage, axle loads); where a train may run |
| [Day and night](day-and-night.md) | The fast clock, day/night lighting, demand over the day and the town simulation |
| [Disruptions and scenarios](disruptions-and-scenarios.md) | What each disruption does, and how to script exercises |
| [Camera calibration](calibration.md) | Only needed for wide-angle webcams |
| [Videos of the lab](videos.md) | How the project page's videos are rendered frame by frame; stabilizing an AR clip in several steps (marker poses, the picture's own motion, least squares); the tools (`render.mjs`, `arail-stabilize`, `arail-compose`); which steps could run live |

**Building on ARail**

| Guide | What it covers |
| --- | --- |
| [Layout file format](layout-format.md) | The JSON file describing a layout, with its layers (the app's modules) and all built-in object types and simulations |
| [Using ARail for research](research.md) | Applying a model or an algorithm of your own to the simulated railway: the ways in (plugin, planner, control-system feed, Node, scenarios), the browser workbench, what you can leave aside (the role games) |
| [Control-system interface](control-system-interface.md) | Feed protocol, bridge and adapters |
| [Extending ARail](extending.md) | Plugins: object types (also buildings), simulations, disruptions and vehicles; the drawing, clock, road and transit APIs |
| [Architecture](architecture.md) | Modules, data flow, coordinate systems, tracking maths, rendering, simulation and tests; the whole architecture in UML on the [architecture page](https://joernmht.github.io/ARail-EBL/architecture/) (classes and activities of every model) |

The Python tools (`arail-bridge`, `arail-calibrate`, `arail-survey`, `arail-synthetic`, `arail-stabilize`, `arail-compose`), the comparison of operations setups (`tools/ops-compare.mjs`) and the video renderer (`tools/video/render.mjs`) are listed in [`tools/README.md`](../tools/README.md). What changed between versions is in the [changelog](../CHANGELOG.md); changes not yet merged into it wait as fragments in [`changes/`](../changes/).

Contributions to the documentation are welcome, see [CONTRIBUTING.md](../CONTRIBUTING.md).
