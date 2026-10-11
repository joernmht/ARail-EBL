// The ARail app: an interactive presentation of the lab. Its modules' tabs are stories to click
// through on the layout of the lab survey (Bf Neustadt): a train that breaks down (operations), the
// maintenance of the infrastructure; the terminal moves its containers one by one. The games and
// exercises are on the game page (../game/).
import { App } from "./app.js";
import { StoryPanel } from "./story.js";
import { TerminalPanel } from "./terminal.js";

const LAB = "../layouts/ebl-lab.json", NEUSTADT = "../layouts/ebl-neustadt.json", TRAIN = "../layouts/ebl-container-train.json";

/** @type {import("./app.js").Page} */
const PAGE = {
  id: "app",
  panels: {
    terminal: (app) => new TerminalPanel(app),
    ops: (app) => new StoryPanel(app, {
      tab: "ops", type: "ops-story", title: "Operations",
      empty: "This layout has no operations story. Settings → Simulation switches on the module Operations of Bf Neustadt.",
      hint: "A railway undertaking at Bf Neustadt with its depot, and an operations story to click through in the Operations tab: RB 31 to Talsee breaks down at the platform, the operations control sends the spare unit, the passengers change trains, and the broken unit goes to the workshop.",
    }),
    infra: (app) => new StoryPanel(app, {
      tab: "infra", type: "maintenance-story", title: "Infrastructure",
      empty: "This layout has no maintenance story. Settings → Simulation switches on the module Infrastructure of Bf Neustadt.",
      hint: "The station Bf Neustadt with its signals, the interlocking and a maintenance base, and a maintenance story to click through in the Infrastructure tab: a signal fails, its track is closed, the repair team drives out and exchanges the old signal; a worn track is renewed with a construction train.",
    }),
  },
  shows: { terminal: "terminal", ops: "ops-story", infra: "maintenance-story" },
  examples: [
    { id: "neustadt", label: "Example: Bf Neustadt", layout: NEUSTADT },
    { id: "neustadt-video", label: "Example: Bf Neustadt, video", layout: NEUSTADT, video: "../media/ebl-station-trains.mp4" },
    { id: "crane-terminal", label: "Example: terminal at the crane", layout: NEUSTADT, image: "../media/ebl-terminal.jpg", tab: "terminal" },
    { id: "container-train", label: "Example: hybrid container train", layout: TRAIN, tab: "terminal" },
    { id: "terminal", label: "Example: container terminal (virtual)", layout: "../layouts/container-terminal.json", home: LAB },
    { id: "lab", label: "Example: Beta 0.1 (EBL lab photo, older)", layout: LAB },
  ],
  exampleLayers: { operations: { layout: NEUSTADT, layer: "operations" }, infrastructure: { layout: NEUSTADT, layer: "infrastructure" } },
};

new App(PAGE).init();
