# ARail-EBL documentation

**Using ARail**

| Guide | What it covers |
| --- | --- |
| [Getting started](getting-started.md) | The app: image sources, the flyover, the panels, keyboard shortcuts and URL options |
| [Setting up a lab](lab-setup.md) | Markers and dictionaries (also on model wagons), printing, placement, cameras and the marker map |
| [Lab session](lab-session.md) | Stickers on the whole layout, one video and `arail-survey`: a fixed (locked) layout and an orthophoto of the table |
| [Streets, bus lines and road traffic](streets-and-buses.md) | Streets as a road network, bus stops, bus lines with buses, cars |
| [Container terminal](container-terminal.md) | Container trains, trucks and barges, gantry cranes and the yard; model wagons with deck cards (rolling-stock markers); the Terminal panel |
| [Infrastructure](infrastructure.md) | Railway assets with their condition, faults and what is known of them; maintenance staff in shifts, emergency vans and drones; renewals and upgrades through the HOAI phases with funding, approval and tenders; the roles of the game; the asset information model, the line map and GeoJSON |
| [Rail operations](operations.md) | Units with maintenance and failures, the four ECM functions and the penalties between the parties, crews with duties, rosters and the way to work; comparing setups under stress tests; the Operations panel |
| [Journeys](journeys.md) | An exercise: every attendee makes a traveller with a start and an aim and chooses a travel plan with transfers (walks, buses, trains); the travellers on the layout, missed connections and the results; the Journeys panel |
| [Railway systems and trains](rail-systems.md) | What each track section is equipped with (traction power, train protection, ETCS, signals, radio, gauge, line category, country); colouring the tracks by a system; where systems change (borders, separation sections); vehicles, consists and the train data (brake percentage, axle loads); where a train may run |
| [Day and night](day-and-night.md) | The fast clock, day/night lighting, demand over the day and the town simulation |
| [Disruptions and scenarios](disruptions-and-scenarios.md) | What each disruption does, and how to script exercises |
| [Camera calibration](calibration.md) | Only needed for wide-angle webcams |
| [Videos of the lab](videos.md) | How the project page's videos are rendered frame by frame; stabilizing an AR clip in several steps (marker poses, the picture's own motion, least squares); the tools (`render.mjs`, `arail-stabilize`, `arail-compose`); which steps could run live |

**Building on ARail**

| Guide | What it covers |
| --- | --- |
| [Layout file format](layout-format.md) | The JSON file describing a layout, with its layers (the app's modules) and all built-in object types and simulations |
| [Control-system interface](control-system-interface.md) | Feed protocol, bridge and adapters |
| [Extending ARail](extending.md) | Plugins: object types (also buildings), simulations, disruptions and vehicles; the drawing, clock, road and transit APIs |
| [Architecture](architecture.md) | Modules, data flow, coordinate systems, tracking maths, rendering, simulation and tests; the whole architecture in UML on the [architecture page](https://joernmht.github.io/ARail-EBL/architecture/) (classes and activities of every model) |

The Python tools (`arail-bridge`, `arail-calibrate`, `arail-survey`, `arail-synthetic`, `arail-stabilize`, `arail-compose`), the comparison of operations setups (`tools/ops-compare.mjs`) and the video renderer (`tools/video/render.mjs`) are listed in [`tools/README.md`](../tools/README.md). What changed between versions is in the [changelog](../CHANGELOG.md).

Contributions to the documentation are welcome, see [CONTRIBUTING.md](../CONTRIBUTING.md).
