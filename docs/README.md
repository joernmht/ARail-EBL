# ARail-EBL documentation

**Using ARail**

| Guide | What it covers |
| --- | --- |
| [Getting started](getting-started.md) | The app: image sources, the flyover, the panels, keyboard shortcuts and URL options |
| [Setting up a lab](lab-setup.md) | Markers and dictionaries (also on model wagons), printing, placement, cameras and the marker map |
| [Lab session](lab-session.md) | Stickers on the whole layout, one video and `arail-survey`: a fixed (locked) layout and an orthophoto of the table |
| [Streets, bus lines and road traffic](streets-and-buses.md) | Streets as a road network, bus stops, bus lines with buses, cars |
| [Container terminal](container-terminal.md) | Container trains, trucks and barges, gantry cranes and the yard; model wagons with deck cards (rolling-stock markers); the Terminal panel |
| [Rail operations](operations.md) | Units with maintenance and failures, the four ECM functions and the penalties between the parties, crews with duties, rosters and the way to work; comparing setups under stress tests; the Operations panel |
| [Day and night](day-and-night.md) | The fast clock, day/night lighting, demand over the day and the town simulation |
| [Disruptions and scenarios](disruptions-and-scenarios.md) | What each disruption does, and how to script exercises |
| [Camera calibration](calibration.md) | Only needed for wide-angle webcams |

**Building on ARail**

| Guide | What it covers |
| --- | --- |
| [Layout file format](layout-format.md) | The JSON file describing a layout, with all built-in object types and simulations |
| [Control-system interface](control-system-interface.md) | Feed protocol, bridge and adapters |
| [Extending ARail](extending.md) | Plugins: object types (also buildings), simulations, disruptions and vehicles; the drawing, clock, road and transit APIs |
| [Architecture](architecture.md) | Modules, data flow, coordinate systems, tracking maths, rendering, simulation and tests |

The Python tools (`arail-bridge`, `arail-calibrate`, `arail-survey`, `arail-synthetic`) and the comparison of operations setups (`tools/ops-compare.mjs`) are listed in [`tools/README.md`](../tools/README.md). What changed between versions is in the [changelog](../CHANGELOG.md).

Contributions to the documentation are welcome, see [CONTRIBUTING.md](../CONTRIBUTING.md).
