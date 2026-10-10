/**
 * The architecture of ARail-EBL as data: packages, the data flow, the models with their classes,
 * relations and activities, the events of the world's event bus and the extension points.
 *
 * The architecture page (web/architecture/) draws its UML diagrams from this file, and
 * tests/js/architecture.test.js checks it against the code: files, classes, attributes and
 * operations, the code named in activities, the events, the registered types, the settings of the
 * simulations and the dependencies between the packages. Change it together with the code.
 *
 * Conventions:
 * - attributes: "name: type — meaning"; operations: "name(params) — meaning" (the name as in the code)
 * - activity nodes: [id, kind, label, ref, lane] with kind one of start, end, flowfinal, action,
 *   decision, merge, fork, join, send (an event sent), receive (an event waited for); `ref` is the
 *   code that does it ("Class.method", or a function of the model's files)
 * - activity edges: [from, to, guard]
 * @module architecture/model
 */

import { CONTROL } from "./models/control.js";
import { DISRUPTIONS } from "./models/disruptions.js";
import { INFRA } from "./models/infra.js";
import { JOURNEYS } from "./models/journeys.js";
import { OPERATIONS } from "./models/operations.js";
import { PAGES } from "./models/pages.js";
import { RAIL } from "./models/rail.js";
import { TERMINAL } from "./models/terminal.js";
import { TOOLS } from "./models/tools.js";
import { TRACKING } from "./models/tracking.js";
import { TRANSPORT } from "./models/transport.js";
import { WORLD } from "./models/world.js";

export const REPO_URL = "https://github.com/joernmht/ARail-EBL";

/* ================================================================ packages */

/** Groups of packages: where they run. */
export const GROUPS = [
  { id: "framework", name: "web/arail · the framework (browser and Node)" },
  { id: "pages", name: "web · pages and plugins (browser)" },
  { id: "tools", name: "tools · Python and Node" },
  { id: "vendor", name: "web/vendor · third-party code" },
];

/**
 * Packages: UML packages, mostly the folders (core is split by what its modules do). `uses`: the
 * packages whose modules its modules import (checked against the imports); `links`: other ties
 * (scripts loaded by the page, messages), drawn but not checked.
 */
export const PACKAGES = [
  {
    id: "core-world", name: "core · world", group: "framework", path: "web/arail/core",
    summary: "The loaded layout: objects, simulations, the step, the clock, layers, people, the registry, the event bus and pointing at things.",
    files: ["web/arail/core/world.js", "web/arail/core/layout.js", "web/arail/core/layers.js", "web/arail/core/anchors.js", "web/arail/core/object.js", "web/arail/core/registry.js", "web/arail/core/events.js", "web/arail/core/simulation.js", "web/arail/core/clock.js", "web/arail/core/people.js", "web/arail/core/pick.js"],
    uses: ["core-math", "core-tracking", "core-transport", "core-disruptions", "core-drawing"],
  },
  {
    id: "core-math", name: "core · math", group: "framework", path: "web/arail/core", utility: true,
    summary: "Vectors, poses, homographies, polygons, polylines, seeded random numbers (used by nearly all packages).",
    files: ["web/arail/core/math.js"], uses: [],
  },
  {
    id: "core-tracking", name: "core · tracking", group: "framework", path: "web/arail/core",
    summary: "Markers in camera frames, the marker map, the camera pose; the flyover's virtual camera.",
    files: ["web/arail/core/detector.js", "web/arail/core/tracker.js", "web/arail/core/geometry.js", "web/arail/core/camera.js", "web/arail/core/flycam.js"],
    uses: ["core-math", "core-world"], links: [["vendor", "global script"]],
  },
  {
    id: "core-transport", name: "core · transport", group: "framework", path: "web/arail/core",
    summary: "Stops and docks, the timetable trains and buses, the road network, bus lines, the control system's trains.",
    files: ["web/arail/core/stops.js", "web/arail/core/services.js", "web/arail/core/vehicles.js", "web/arail/core/network.js", "web/arail/core/transit.js", "web/arail/core/trains.js"],
    uses: ["core-math", "core-drawing"],
  },
  {
    id: "core-disruptions", name: "core · disruptions", group: "framework", path: "web/arail/core",
    summary: "Disruption types and their effects, scripted scenarios.",
    files: ["web/arail/core/disruptions.js", "web/arail/core/scenarios.js"],
    uses: ["core-drawing"],
  },
  {
    id: "core-drawing", name: "core · drawing", group: "framework", path: "web/arail/core", utility: true,
    summary: "Projection and the display list, day and night, the simple view, the corporate-design colours (used by nearly all packages).",
    files: ["web/arail/core/view.js", "web/arail/core/simple.js", "web/arail/core/colors.js"],
    uses: ["core-tracking"],
  },
  {
    id: "objects", name: "objects", group: "framework", path: "web/arail/objects",
    summary: "The built-in object types: platforms, tracks, stations, streets, bus stops and lines, houses, trees, tables.",
    files: ["web/arail/objects/platform.js", "web/arail/objects/track.js", "web/arail/objects/station.js", "web/arail/objects/underpass.js", "web/arail/objects/road.js", "web/arail/objects/bus-stop.js", "web/arail/objects/bus-terminal.js", "web/arail/objects/bus-line.js", "web/arail/objects/signs.js", "web/arail/objects/building-kit.js", "web/arail/objects/building.js", "web/arail/objects/houses.js", "web/arail/objects/trees.js", "web/arail/objects/landscape.js", "web/arail/objects/label.js", "web/arail/objects/tabletop.js"],
    uses: ["core-math", "core-world", "core-transport", "core-drawing", "rail"],
  },
  {
    id: "sims", name: "sims", group: "framework", path: "web/arail/sims",
    summary: "Passengers at the stops, the town's residents, road traffic.",
    files: ["web/arail/sims/passengers.js", "web/arail/sims/town.js", "web/arail/sims/traffic.js"],
    uses: ["core-math", "core-world", "core-transport", "core-drawing"],
  },
  {
    id: "terminal", name: "terminal", group: "framework", path: "web/arail/terminal",
    summary: "The container terminal: inventory and rules, cranes and reach stackers, trains, trucks and barges, model wagons from tags.",
    files: ["web/arail/terminal/index.js", "web/arail/terminal/types.js", "web/arail/terminal/model.js", "web/arail/terminal/objects.js", "web/arail/terminal/operations.js", "web/arail/terminal/handlers.js", "web/arail/terminal/visits.js", "web/arail/terminal/movers.js", "web/arail/terminal/rolling.js", "web/arail/terminal/draw.js"],
    uses: ["core-math", "core-world", "core-drawing", "objects", "sims"],
  },
  {
    id: "ops", name: "ops", group: "framework", path: "web/arail/ops",
    summary: "Rail operations: a discrete-event simulation of units, maintenance (ECM), crews and penalties, on the world's clock.",
    files: ["web/arail/ops/index.js", "web/arail/ops/config.js", "web/arail/ops/util.js", "web/arail/ops/timetable.js", "web/arail/ops/fleet.js", "web/arail/ops/crew.js", "web/arail/ops/engine.js", "web/arail/ops/crewdesk.js", "web/arail/ops/contracts.js", "web/arail/ops/experiment.js", "web/arail/ops/simulation.js", "web/arail/ops/depot.js", "web/arail/ops/disruptions.js"],
    uses: ["core-math", "core-world", "core-transport", "core-drawing", "objects", "sims"],
  },
  {
    id: "infra", name: "infra", group: "framework", path: "web/arail/infra",
    summary: "Infrastructure asset management over years: assets, faults, staff, inspections, projects through the HOAI phases.",
    files: ["web/arail/infra/index.js", "web/arail/infra/catalog.js", "web/arail/infra/config.js", "web/arail/infra/network.js", "web/arail/infra/assets.js", "web/arail/infra/staff.js", "web/arail/infra/engine.js", "web/arail/infra/projects.js", "web/arail/infra/factory.js", "web/arail/infra/export.js", "web/arail/infra/simulation.js", "web/arail/infra/objects.js", "web/arail/infra/disruptions.js"],
    uses: ["core-math", "core-world", "core-transport", "core-drawing", "objects", "ops", "sims"],
  },
  {
    id: "journeys", name: "journeys", group: "framework", path: "web/arail/journeys",
    summary: "Travellers made by hand with travel plans and transfers; the journeys' timetable trains.",
    files: ["web/arail/journeys/index.js", "web/arail/journeys/rail.js", "web/arail/journeys/planner.js", "web/arail/journeys/simulation.js"],
    uses: ["core-math", "core-world", "core-transport", "core-drawing", "ops", "sims"],
  },
  {
    id: "rail", name: "rail", group: "framework", path: "web/arail/rail",
    summary: "Railway systems of the track sections (power, train protection, signals, radio, gauge, line category, country) and where they change; vehicles and the consists of trains with their figures.",
    files: ["web/arail/rail/index.js", "web/arail/rail/systems.js", "web/arail/rail/objects.js", "web/arail/rail/vehicles.js", "web/arail/rail/trains.js"],
    uses: ["core-math", "core-world", "core-drawing"],
  },
  {
    id: "feeds", name: "feeds", group: "framework", path: "web/arail/feeds",
    summary: "Train positions of a control system: the WebSocket client of the bridge, a simulated control system.",
    files: ["web/arail/feeds/websocket.js", "web/arail/feeds/mock.js"],
    uses: [], links: [["core-transport", "trains.apply(message)"]],
  },
  {
    id: "api", name: "index.js · API", group: "framework", path: "web/arail", hub: true,
    summary: "The framework's entry: createWorld, the registry with the built-in types, plugins, every export (it imports every package).",
    files: ["web/arail/index.js"],
    uses: ["core-world", "core-math", "core-tracking", "core-transport", "core-disruptions", "core-drawing", "objects", "sims", "terminal", "ops", "infra", "journeys", "feeds", "rail"],
  },
  {
    id: "app", name: "app", group: "pages", path: "web/app",
    summary: "The app: sources, frame loop, HUD, the panels (Build, View, the modules' tabs, Disruptions, Settings), the flyover, tooltips and info cards.",
    files: ["web/app/app.js", "web/app/ui.js", "web/app/panels.js", "web/app/editor.js", "web/app/inspect.js", "web/app/flyover.js", "web/app/survey.js", "web/app/terminal.js", "web/app/operations.js", "web/app/infra.js", "web/app/journeys.js"],
    uses: ["api"], links: [["vendor", "script tags"]],
  },
  {
    id: "markers", name: "markers", group: "pages", path: "web/markers",
    summary: "The marker sheets, label sheets and deck cards for model wagons (print pages).",
    files: ["web/markers/markers.js", "web/markers/label-sheets.js", "web/markers/deck-cards.js"],
    uses: ["core-tracking", "terminal"], links: [["vendor", "script tags"]],
  },
  {
    id: "architecture", name: "architecture", group: "pages", path: "web/architecture",
    summary: "This page: the architecture as data, drawn as UML.",
    files: ["web/architecture/model.js", "web/architecture/uml.js", "web/architecture/architecture.js", "web/architecture/models/tracking.js", "web/architecture/models/world.js", "web/architecture/models/transport.js", "web/architecture/models/disruptions.js", "web/architecture/models/terminal.js", "web/architecture/models/operations.js", "web/architecture/models/infra.js", "web/architecture/models/journeys.js", "web/architecture/models/rail.js", "web/architecture/models/control.js", "web/architecture/models/tools.js", "web/architecture/models/pages.js"],
    uses: ["app", "vendor"],
  },
  {
    id: "plugins", name: "plugins", group: "pages", path: "web/plugins",
    summary: "Example plugins loaded by layout files: a road-traffic preset, a windmill object type.",
    files: ["web/plugins/road-traffic.js", "web/plugins/windmill.js"],
    uses: [], links: [["api", "registers into"]],
  },
  {
    id: "vendor", name: "vendor", group: "vendor", path: "web/vendor", external: true,
    summary: "Third-party code: js-aruco2 (marker candidates and codes), dagre (the layout of these diagrams).",
    files: ["web/vendor/js-aruco2/cv.js", "web/vendor/js-aruco2/aruco.js", "web/vendor/dagre/dagre.esm.js"],
    uses: [],
  },
  {
    id: "bridge", name: "bridge (Python)", group: "tools", path: "tools/arail_tools/bridge",
    summary: "arail-bridge: adapters for control systems, the message protocol, the WebSocket server.",
    files: ["tools/arail_tools/bridge/__init__.py", "tools/arail_tools/bridge/__main__.py", "tools/arail_tools/bridge/protocol.py", "tools/arail_tools/bridge/server.py", "tools/arail_tools/bridge/adapters/__init__.py", "tools/arail_tools/bridge/adapters/base.py", "tools/arail_tools/bridge/adapters/replay.py", "tools/arail_tools/bridge/adapters/simulator.py", "tools/arail_tools/bridge/adapters/tcp_json.py", "tools/arail_tools/bridge/adapters/template.py"],
    uses: [], links: [["feeds", "WebSocket messages"]],
  },
  {
    id: "camera-tools", name: "camera tools (Python)", group: "tools", path: "tools/arail_tools",
    summary: "arail-survey (marker map and orthophoto from a video), arail-calibrate, synthetic scenes and the test fixtures.",
    files: ["tools/arail_tools/__init__.py", "tools/arail_tools/aruco.py", "tools/arail_tools/survey.py", "tools/arail_tools/calibrate.py", "tools/arail_tools/synthetic.py", "tools/arail_tools/fixtures.py"],
    uses: [], links: [["core-world", "layout and calibration files"]],
  },
  {
    id: "video-tools", name: "video tools", group: "tools", path: "tools/video",
    summary: "Videos of the app: rendering frame by frame after a plan (render.mjs, in a browser), steadier poses (arail-stabilize) and joining the shots (arail-compose).",
    files: ["tools/video/render.mjs", "tools/video/sky.js", "tools/arail_tools/stabilize.py", "tools/arail_tools/compose.py"],
    uses: [], links: [["core-world", "the app and its layouts, in a browser"]],
  },
  {
    id: "node-tools", name: "Node tools", group: "tools", path: "tools",
    summary: "The development server, fetching the fonts, comparing operations setups on the command line.",
    files: ["tools/serve.mjs", "tools/fetch-fonts.mjs", "tools/ops-compare.mjs"],
    uses: ["core-world", "ops"],
  },
];

/* ================================================================ data flow */

/** The data flow of the whole system (Gane–Sarson): who gives what to whom. */
export const DATA_FLOW = {
  intro: "From the camera to the augmented image, from the layout file to the world, from the control system to the trains at the platforms. Processes are numbered P, data stores D; the code of each process is listed in the table.",
  rankdir: "TB",
  nodes: [
    { id: "camera", kind: "external", label: "Camera, photo or video" },
    { id: "people", kind: "external", label: "Lab staff and students" },
    { id: "control", kind: "external", label: "Control system" },
    { id: "detect", kind: "process", no: "P1", label: "Detect the markers", files: ["web/arail/core/detector.js"] },
    { id: "track", kind: "process", no: "P2", label: "Track the layout", files: ["web/arail/core/tracker.js", "web/arail/core/geometry.js"] },
    { id: "load", kind: "process", no: "P3", label: "Load the layout and its modules", files: ["web/app/app.js", "web/arail/core/world.js", "web/arail/core/layers.js", "web/arail/core/layout.js"] },
    { id: "edit", kind: "process", no: "P4", label: "Build: place and edit", files: ["web/app/editor.js"] },
    { id: "simulate", kind: "process", no: "P5", label: "Simulate (World.step)", files: ["web/arail/core/world.js"] },
    { id: "draw", kind: "process", no: "P6", label: "Draw the augmented image", files: ["web/arail/core/view.js", "web/app/app.js"] },
    { id: "bridge", kind: "process", no: "P7", label: "Bridge (Python)", files: ["tools/arail_tools/bridge/server.py"] },
    { id: "feed", kind: "process", no: "P8", label: "Apply the feed", files: ["web/arail/feeds/websocket.js", "web/arail/core/trains.js"] },
    { id: "survey", kind: "process", no: "P9", label: "Survey (arail-survey)", files: ["tools/arail_tools/survey.py"] },
    { id: "calibrate", kind: "process", no: "P10", label: "Calibrate (arail-calibrate)", files: ["tools/arail_tools/calibrate.py"] },
    { id: "layouts", kind: "store", no: "D1", label: "Layout files" },
    { id: "browser", kind: "store", no: "D2", label: "Browser storage" },
    { id: "world", kind: "store", no: "D3", label: "World state" },
    { id: "results", kind: "store", no: "D4", label: "Results and saved games" },
    { id: "calibration", kind: "store", no: "D5", label: "Calibration file" },
  ],
  flows: [
    { from: "camera", to: "detect", label: "frames" },
    { from: "detect", to: "track", label: "marker corners and IDs, tags" },
    { from: "track", to: "world", label: "marker map: surveyed poses" },
    { from: "track", to: "draw", label: "pose: homography layout → image" },
    { from: "calibration", to: "track", label: "focal length, distortion" },
    { from: "layouts", to: "load", label: "layout JSON: base, layers, plugins" },
    { from: "browser", to: "load", label: "edits, modules chosen" },
    { from: "load", to: "world", label: "objects, simulations, scenarios" },
    { from: "people", to: "edit", label: "objects placed, moved, set" },
    { from: "edit", to: "world", label: "object specs" },
    { from: "edit", to: "browser", label: "the edited layout" },
    { from: "edit", to: "layouts", label: "Export layout" },
    { from: "people", to: "simulate", label: "time, speed, modules, disruptions, travellers, moves" },
    { from: "world", to: "simulate", label: "state" },
    { from: "simulate", to: "world", label: "people, vehicles, machines moved" },
    { from: "control", to: "bridge", label: "train positions" },
    { from: "bridge", to: "feed", label: "arail-feed/1 over WebSocket" },
    { from: "feed", to: "simulate", label: "trains at platforms, disruptions" },
    { from: "world", to: "draw", label: "what to draw" },
    { from: "draw", to: "people", label: "the augmented image, boards, panels" },
    { from: "simulate", to: "results", label: "CSV, GeoJSON, games" },
    { from: "camera", to: "survey", label: "videos of the layout" },
    { from: "survey", to: "layouts", label: "locked marker map, orthophoto" },
    { from: "camera", to: "calibrate", label: "photos of markers" },
    { from: "calibrate", to: "calibration", label: "camera-calibration.json" },
  ],
};

/* ================================================================ models */

/** Groups of models on the page, in this order. */
export const MODEL_GROUPS = [
  { id: "world", name: "The world", intro: "What every layout has: the world and its step, layout files and modules, the clock, objects, people, drawing." },
  { id: "tracking", name: "Tracking and cameras", intro: "From the camera image to the layout's pose: markers, the marker map, the flyover's virtual camera." },
  { id: "transport", name: "People and vehicles", intro: "Stops, the timetable's trains and buses, passengers, the town's residents, streets, bus lines and cars." },
  { id: "disruptions", name: "Disruptions and scenarios", intro: "What can go wrong, and timelines of it for exercises (the module Disruptions)." },
  { id: "terminal", name: "Module: container terminal" },
  { id: "operations", name: "Module: rail operations" },
  { id: "infra", name: "Module: infrastructure" },
  { id: "journeys", name: "Module: journeys" },
  { id: "rail", name: "Railway systems and trains", intro: "What the track sections are equipped with, where a system changes, and the vehicles and consists of the trains." },
  { id: "control", name: "The control system" },
  { id: "pages", name: "The app and the pages" },
  { id: "tools", name: "Tools" },
];

export const MODELS = [...WORLD, ...TRACKING, ...TRANSPORT, ...DISRUPTIONS, ...TERMINAL, ...OPERATIONS, ...INFRA, ...JOURNEYS, ...RAIL, ...CONTROL, ...PAGES, ...TOOLS];

/* ================================================================ events */

const terminalRequest = (name, does) => ({ name: `terminal.request.${name}`, kind: "request", from: [], payload: "", meaning: `Asks the terminal to ${does} (scenario emit steps, plugins).` });

/**
 * The events of the world's event bus (`world.events`): name, the files that send it, what it
 * carries, what it means. Requests (kind "request") are listened to, sent by scenarios or plugins.
 */
export const EVENTS = [
  { name: "layout.loaded", from: ["web/arail/core/world.js"], payload: "layout", meaning: "A layout was loaded." },
  { name: "object.added", from: ["web/arail/core/world.js"], payload: "object", meaning: "An object was placed." },
  { name: "object.changed", from: ["web/arail/core/world.js"], payload: "object", meaning: "An object was edited (also right before object.added)." },
  { name: "object.removed", from: ["web/arail/core/world.js"], payload: "object", meaning: "An object was deleted." },
  { name: "clock.day", from: ["web/arail/core/world.js"], payload: "day", meaning: "Midnight passed." },
  { name: "clock.set", from: ["web/arail/core/world.js"], payload: "minutes", meaning: "The time was set by hand: the simulations place everybody anew." },
  { name: "disruption.started", from: ["web/arail/core/disruptions.js"], payload: "disruption", meaning: "A disruption started." },
  { name: "disruption.ended", from: ["web/arail/core/disruptions.js"], payload: "disruption", meaning: "A disruption expired or was stopped." },
  { name: "scenario.started", from: ["web/arail/core/scenarios.js"], payload: "scenario", meaning: "A scenario is played." },
  { name: "scenario.ended", from: ["web/arail/core/scenarios.js"], payload: "scenario", meaning: "A scenario ended." },
  { name: "scenario.message", from: ["web/arail/core/scenarios.js", "web/arail/terminal/operations.js"], payload: "scenario, text", meaning: "A message for the stage (also a refused terminal request)." },
  { name: "vehicle.arriving", from: ["web/arail/core/services.js", "web/arail/core/transit.js"], payload: "vehicle, dock, area", meaning: "A train or bus comes in." },
  { name: "vehicle.arrived", from: ["web/arail/core/services.js", "web/arail/core/transit.js"], payload: "vehicle, dock, area", meaning: "It stands at its dock: doors open." },
  { name: "vehicle.departing", from: ["web/arail/core/services.js", "web/arail/core/transit.js"], payload: "vehicle, dock, area", meaning: "Doors close." },
  { name: "vehicle.departed", from: ["web/arail/core/services.js", "web/arail/core/transit.js"], payload: "vehicle, dock, area", meaning: "It has left." },
  { name: "vehicle.cancelled", from: ["web/arail/core/services.js", "web/arail/core/transit.js", "web/arail/ops/simulation.js", "web/arail/journeys/rail.js"], payload: "vehicle, dock, area", meaning: "A service was cancelled: waiting passengers lose mood." },
  { name: "feed.trains", from: ["web/arail/core/trains.js"], payload: "trains", meaning: "Trains of the control system were updated." },
  { name: "feed.status", from: ["web/arail/feeds/websocket.js", "web/arail/feeds/mock.js"], payload: "status, error, url", meaning: "The connection to the control system changed." },
  { name: "passenger.boarded", from: ["web/arail/sims/passengers.js"], payload: "area, dock, vehicle, person, agent", meaning: "Someone got on (with the agent of the simulation that handed the person over)." },
  { name: "passenger.exited", from: ["web/arail/sims/passengers.js"], payload: "area, person, agent, pos", meaning: "Someone left a stop on foot." },
  { name: "passenger.removed", from: ["web/arail/sims/passengers.js"], payload: "agent, person", meaning: "Someone was taken off a stop (e.g. the stop was removed)." },
  { name: "terminal.visit.arriving", from: ["web/arail/terminal/visits.js"], payload: "terminal, visit", meaning: "A train, barge or truck comes in." },
  { name: "terminal.visit.arrived", from: ["web/arail/terminal/visits.js"], payload: "terminal, visit", meaning: "It is in its place." },
  { name: "terminal.visit.departing", from: ["web/arail/terminal/visits.js"], payload: "terminal, visit", meaning: "It leaves." },
  { name: "terminal.visit.departed", from: ["web/arail/terminal/operations.js", "web/arail/terminal/visits.js"], payload: "terminal, visit", meaning: "It has left." },
  { name: "terminal.move.queued", from: ["web/arail/terminal/operations.js"], payload: "terminal, move", meaning: "A move was asked for." },
  { name: "terminal.move.started", from: ["web/arail/terminal/operations.js"], payload: "terminal, move", meaning: "A machine began it." },
  { name: "terminal.move.finished", from: ["web/arail/terminal/operations.js"], payload: "terminal, move", meaning: "The container is in its new place." },
  { name: "terminal.move.failed", from: ["web/arail/terminal/operations.js"], payload: "terminal, move", meaning: "It could not be done (with the reason)." },
  { name: "terminal.move.cancelled", from: ["web/arail/terminal/operations.js"], payload: "terminal, move", meaning: "Cancelled before the lock." },
  { name: "terminal.container.moved", from: ["web/arail/terminal/operations.js"], payload: "terminal, container, from, to, move", meaning: "A container changed its place." },
  { name: "terminal.container.added", from: ["web/arail/terminal/operations.js"], payload: "terminal, container, carrier", meaning: "A container came (a delivery, a random load)." },
  { name: "terminal.container.left", from: ["web/arail/terminal/operations.js"], payload: "terminal, container, visit, reason", meaning: "A container left the terminal." },
  { name: "terminal.wagon.seen", from: ["web/arail/terminal/operations.js"], payload: "terminal, carrier", meaning: "A model wagon is seen again." },
  { name: "terminal.wagon.lost", from: ["web/arail/terminal/operations.js"], payload: "terminal, carrier", meaning: "A model wagon is lost." },
  { name: "terminal.reset", from: ["web/arail/terminal/operations.js"], payload: "terminal", meaning: "The terminal was reset to its start state." },
  terminalRequest("call", "call a train or barge"),
  terminalRequest("depart", "send a visit away"),
  terminalRequest("move", "move a container"),
  terminalRequest("truck", "send a truck"),
  terminalRequest("train", "add a train"),
  terminalRequest("barge", "add a barge"),
  terminalRequest("unload", "unload a visit"),
  terminalRequest("load", "load a visit"),
  terminalRequest("reset", "reset to the start state"),
  ...[
    ["trip.departed", "trip", "A trip left its first station.", "web/arail/ops/engine.js"],
    ["trip.arrived", "trip", "A trip arrived at its end.", "web/arail/ops/engine.js"],
    ["trip.cancelled", "trip, cause", "A trip was cancelled (no unit, no driver, the station closed).", "web/arail/ops/engine.js"],
    ["trip.terminated", "trip, unit", "A trip ended early (its unit failed).", "web/arail/ops/engine.js"],
    ["unit.failed", "unit, trip", "A unit failed in service.", "web/arail/ops/engine.js"],
    ["unit.defect", "unit, trip, kind", "A unit got a defect.", "web/arail/ops/engine.js"],
    ["unit.released", "unit, job", "A unit is back in service from the workshop.", "web/arail/ops/engine.js"],
    ["job.planned", "job, unit", "Maintenance planned.", "web/arail/ops/engine.js"],
    ["job.started", "job, unit", "Work in the workshop began.", "web/arail/ops/engine.js"],
    ["job.finished", "job, unit", "Work done.", "web/arail/ops/engine.js"],
    ["penalty", "entry", "A penalty between the parties.", "web/arail/ops/engine.js"],
    ["day.end", "day", "The operating day ended.", "web/arail/ops/engine.js"],
    ["log", "t, text, kind", "A line of the operations' log.", "web/arail/ops/engine.js"],
    ["crew.signon", "person, duty", "A driver signed on.", "web/arail/ops/crewdesk.js"],
    ["crew.signoff", "person, duty", "A driver signed off.", "web/arail/ops/crewdesk.js"],
    ["crew.sick", "person, duty", "A driver called in sick.", "web/arail/ops/crewdesk.js"],
    ["crew.alighted", "person, duty, trip", "A driver got off at the end of a part of the duty.", "web/arail/ops/crewdesk.js"],
  ].map(([n, payload, meaning, file]) => ({ name: `ops.${n}`, from: [file], payload: `simulation, ${payload}`, meaning: `${meaning} (The operations engine's event, passed on by OperationsSimulation.)` })),
  ...[
    ["fault", "fault, asset", "A fault became known.", "web/arail/infra/engine.js"],
    ["dispatch", "fault, asset, person", "Somebody was sent to a fault.", "web/arail/infra/engine.js"],
    ["fixed", "fault, asset", "A fault was repaired.", "web/arail/infra/engine.js"],
    ["inspected", "asset, method, known", "An asset was inspected.", "web/arail/infra/engine.js"],
    ["asset.restricted", "asset", "A speed restriction (La) on an asset.", "web/arail/infra/engine.js"],
    ["asset.renewed", "asset, project", "A project put a renewed asset into service.", "web/arail/infra/projects.js"],
    ["decision", "item", "A decision waits for a role.", "web/arail/infra/engine.js"],
    ["year", "result", "A year of the game ended.", "web/arail/infra/engine.js"],
    ["log", "t, text, kind", "A line of the infrastructure's log.", "web/arail/infra/engine.js"],
  ].map(([n, payload, meaning, file]) => ({ name: `infra.${n}`, from: [file], payload: `simulation, ${payload}`, meaning: `${meaning} (The infrastructure engine's event, passed on by InfrastructureSimulation.)` })),
  { name: "journeys.traveller.added", from: ["web/arail/journeys/simulation.js"], payload: "simulation, traveller", meaning: "A traveller was made." },
  { name: "journeys.traveller.arrived", from: ["web/arail/journeys/simulation.js"], payload: "simulation, traveller, delay", meaning: "A traveller arrived." },
];

/* ================================================================ registry */

const obj = (type, cls, file, model) => ({ type, class: cls, file, model });
const dis = (type, label, file, params, does) => ({ type, label, file, model: "disruptions", params, does });

/** What registerBuiltins registers (and the example plugins, marked `plugin`). */
export const REGISTRY = {
  simulations: [
    { type: "passengers", class: "PassengerSimulation", file: "web/arail/sims/passengers.js", model: "passengers" },
    { type: "town", class: "TownSimulation", file: "web/arail/sims/town.js", model: "town" },
    { type: "traffic", class: "TrafficSimulation", file: "web/arail/sims/traffic.js", model: "traffic" },
    { type: "terminal", class: "TerminalSimulation", file: "web/arail/terminal/operations.js", model: "terminal-operations" },
    { type: "operations", class: "OperationsSimulation", file: "web/arail/ops/simulation.js", model: "ops-world" },
    { type: "infrastructure", class: "InfrastructureSimulation", file: "web/arail/infra/simulation.js", model: "infra-world" },
    { type: "journeys", class: "JourneysSimulation", file: "web/arail/journeys/simulation.js", model: "journeys" },
    { type: "road-traffic", class: "RoadTraffic", file: "web/plugins/road-traffic.js", model: "plugins", plugin: true },
  ],
  objects: [
    obj("platform", "Platform", "web/arail/objects/platform.js", "objects"),
    obj("bus-terminal", "BusTerminal", "web/arail/objects/bus-terminal.js", "objects"),
    obj("road", "Road", "web/arail/objects/road.js", "objects"),
    obj("underpass", "Underpass", "web/arail/objects/underpass.js", "objects"),
    obj("bus-stop", "BusStop", "web/arail/objects/bus-stop.js", "objects"),
    obj("bus-line", "BusLine", "web/arail/objects/bus-line.js", "objects"),
    obj("building", "Building", "web/arail/objects/building.js", "objects"),
    obj("station-building", "StationBuilding", "web/arail/objects/station.js", "objects"),
    obj("plattenbau", "Plattenbau", "web/arail/objects/houses.js", "objects"),
    obj("altbau-block", "AltbauBlock", "web/arail/objects/houses.js", "objects"),
    obj("house", "House", "web/arail/objects/houses.js", "objects"),
    obj("house-estate", "HouseEstate", "web/arail/objects/houses.js", "objects"),
    obj("office", "Office", "web/arail/objects/houses.js", "objects"),
    obj("school", "School", "web/arail/objects/houses.js", "objects"),
    obj("supermarket", "Supermarket", "web/arail/objects/houses.js", "objects"),
    obj("factory", "Factory", "web/arail/objects/houses.js", "objects"),
    obj("tree", "Tree", "web/arail/objects/trees.js", "objects"),
    obj("forest", "Forest", "web/arail/objects/trees.js", "objects"),
    obj("area", "Area", "web/arail/objects/landscape.js", "objects"),
    obj("track", "Track", "web/arail/objects/track.js", "objects"),
    obj("label", "Label", "web/arail/objects/label.js", "objects"),
    obj("tabletop", "Tabletop", "web/arail/objects/tabletop.js", "objects"),
    obj("container-yard", "ContainerYard", "web/arail/terminal/objects.js", "terminal-objects"),
    obj("gantry-crane", "GantryCrane", "web/arail/terminal/objects.js", "terminal-objects"),
    obj("truck-lane", "TruckLane", "web/arail/terminal/objects.js", "terminal-objects"),
    obj("quay", "Quay", "web/arail/terminal/objects.js", "terminal-objects"),
    obj("reach-stacker", "ReachStacker", "web/arail/terminal/objects.js", "terminal-objects"),
    obj("depot", "Depot", "web/arail/ops/depot.js", "ops-world"),
    obj("signal", "Signal", "web/arail/infra/objects.js", "infra-world"),
    obj("switch", "Switch", "web/arail/infra/objects.js", "infra-world"),
    obj("balise", "Balise", "web/arail/infra/objects.js", "infra-world"),
    obj("level-crossing", "LevelCrossing", "web/arail/infra/objects.js", "infra-world"),
    obj("gsmr-mast", "GsmrMast", "web/arail/infra/objects.js", "infra-world"),
    obj("interlocking", "Interlocking", "web/arail/infra/objects.js", "infra-world"),
    obj("catenary", "Catenary", "web/arail/infra/objects.js", "infra-world"),
    obj("cable-route", "CableRoute", "web/arail/infra/objects.js", "infra-world"),
    obj("lift", "Lift", "web/arail/infra/objects.js", "infra-world"),
    obj("passenger-display", "PassengerDisplay", "web/arail/infra/objects.js", "infra-world"),
    obj("maintenance-base", "MaintenanceBase", "web/arail/infra/objects.js", "infra-world"),
    obj("crossing-plant", "CrossingPlant", "web/arail/infra/objects.js", "infra-world"),
    obj("system-change", "SystemChange", "web/arail/rail/objects.js", "systems"),
    { ...obj("windmill", "Windmill", "web/plugins/windmill.js", "plugins"), plugin: true },
  ],
  disruptions: [
    dis("delay", "Delay", "web/arail/core/disruptions.js", ["minutes"], "Trains and buses held at the stop."),
    dis("cancellation", "Cancellations", "web/arail/core/disruptions.js", ["minutes"], "Services cancelled."),
    dis("closure", "Closure", "web/arail/core/disruptions.js", ["minutes"], "The stop closed: people leave, nobody comes."),
    dis("replacement-bus", "Rail replacement bus", "web/arail/core/disruptions.js", ["bus_terminal", "minutes"], "Trains cancelled; buses run more often from a bus terminal."),
    dis("crowd", "Crowd surge", "web/arail/core/disruptions.js", ["factor", "minutes"], "Many more passengers come."),
    dis("signal-failure", "Signal failure", "web/arail/core/disruptions.js", ["minutes"], "Trains held at the platforms."),
    dis("crew-sick", "Drivers call in sick", "web/arail/ops/disruptions.js", ["count", "notice_min"], "Sick calls to the operations' crew desk."),
    dis("unit-failure", "Unit failure", "web/arail/ops/disruptions.js", ["kind"], "A unit of a running train fails (hard or soft)."),
    dis("drivers-leave", "Drivers leave", "web/arail/ops/disruptions.js", ["count"], "Drivers leave the company."),
    dis("workshop-closed", "Workshop closed", "web/arail/ops/disruptions.js", ["hours"], "All bays of the workshop closed."),
    dis("units-damaged", "Units damaged", "web/arail/ops/disruptions.js", ["count", "days"], "Units out of service for days."),
    dis("asset-fault", "Asset fault", "web/arail/infra/disruptions.js", ["asset"], "An asset of the infrastructure fails."),
    dis("cable-theft", "Cable theft", "web/arail/infra/disruptions.js", [], "A cable is stolen: its signals fail."),
    dis("storm", "Storm damage", "web/arail/infra/disruptions.js", ["count"], "Assets damaged by a storm fail."),
    dis("infra-fault", "Infrastructure fault", "web/arail/infra/disruptions.js", [], "A fault at the station (started by the infrastructure itself, hidden in the tab)."),
  ],
  vehicles: [
    { type: "train", label: "TRAIN: a multiple unit with doors", file: "web/arail/core/vehicles.js", model: "services" },
    { type: "bus", label: "BUS: a 12 m bus", file: "web/arail/core/vehicles.js", model: "services" },
  ],
};
