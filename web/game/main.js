// The ARail game page: the games and exercises on the lab's layout, beside the app (../app/), which
// presents the modules as stories. Infrastructure: asset management with roles, decisions and budget
// years; Operations: a railway undertaking's fleet, workshop and crews, setups compared under stress
// tests; Journeys: travellers with travel plans for a class; the container terminal with its visits.
// It is the app's shell (stage, flyover, Build, Settings) with the game panels in the modules' tabs.
import { App } from "../app/app.js";
import { TerminalPanel } from "../app/terminal.js";
import { InfraPanel } from "./infra.js";
import { JourneysPanel } from "./journeys.js";
import { OperationsPanel } from "./operations.js";

const LAB = "../layouts/ebl-lab.json", NEUSTADT = "../layouts/ebl-neustadt.json", TRAIN = "../layouts/ebl-container-train.json";

/** @type {import("../app/app.js").Page} */
const PAGE = {
  id: "game",
  panels: {
    terminal: (app) => new TerminalPanel(app, { full: true }),
    ops: (app) => new OperationsPanel(app),
    infra: (app) => new InfraPanel(app),
    journeys: (app) => new JourneysPanel(app),
  },
  shows: { terminal: "terminal", ops: "operations", infra: "infrastructure", journeys: "journeys" },
  examples: [
    { id: "lab", label: "Example: the lab with its games (Beta 0.1)", layout: LAB },
    { id: "terminal", label: "Example: container terminal (virtual)", layout: "../layouts/container-terminal.json", home: LAB },
    { id: "neustadt", label: "Example: Bf Neustadt and its terminal", layout: NEUSTADT },
    { id: "crane-terminal", label: "Example: terminal at the crane", layout: NEUSTADT, image: "../media/ebl-terminal.jpg", tab: "terminal" },
    { id: "container-train", label: "Example: hybrid container train", layout: TRAIN, tab: "terminal" },
  ],
  exampleLayers: {
    operations: { layout: LAB, layer: "operations" }, infrastructure: { layout: LAB, layer: "infrastructure" }, journeys: { layout: LAB, layer: "journeys" },
  },
};

new App(PAGE).init();
