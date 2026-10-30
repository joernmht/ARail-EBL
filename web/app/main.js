// The ARail app: an interactive presentation of the lab. Its scenarios in Interaction, examples to
// start, each with a small task: first the Introduction, a short film of the layout (what is real,
// what the app adds), and the Sandbox to look around freely; then by side the operations of a
// morning (the infrastructure puts the trains on tracks, the railway undertaking puts units and
// drivers on them), the infrastructure's disruption (a signal fails, a track is renewed), the
// railway undertaking's (a train breaks down), the container terminal and a traveller's journey;
// Build and Disruptions are tools of the layout. The games and exercises are on the game page (../game/).
import { App } from "./app.js";
import { BuildCase, DisruptionsCase, IntroCase, PlanCase, SandboxCase, StoryCase, TerminalCase } from "./cases.js";

const LAB = "../layouts/ebl-lab.json", NEUSTADT = "../layouts/ebl-neustadt.json", TRAIN = "../layouts/ebl-container-train.json";

/** Infrastructure → Operations: the trains of the operations plan on the tracks of the station. */
class InfraOperations extends PlanCase {
  static id = "infra-operations";
  static side = "infra";
  static label = "Trains on tracks";
  static description = "Put the trains of the morning on the tracks of the station";
  static task = "Give every train of the morning a track that is free and long enough.";
  static icon = "plan";
}

/** Railway undertaking → Operations: a unit and a driver on each train of the operations plan. */
class EvuOperations extends PlanCase {
  static id = "evu-operations";
  static side = "evu";
  static label = "Units and drivers";
  static description = "Put a unit and a driver on each train of the morning";
  static task = "Give every train of the morning a unit with enough places and a driver on shift.";
  static icon = "plan";
}

/** Infrastructure → Disruption: the maintenance story (a signal fails and is exchanged; a worn track is renewed). */
class InfraDisruption extends StoryCase {
  static id = "infra-disruption";
  static side = "infra";
  static label = "A signal fails";
  static icon = "infrastructure";
  static description = "A signal fails and is exchanged; a worn track is renewed";
  static aliases = ["infra"];
  static needs = "maintenance-story";
  static example = "infrastructure";
  static prefix = "infra";
}

/** Railway undertaking → Disruption: the operations story (a train breaks down, the spare unit takes over). */
class EvuDisruption extends StoryCase {
  static id = "evu-disruption";
  static side = "evu";
  static label = "A train breaks down";
  static icon = "operations";
  static description = "A train breaks down at the platform; the spare unit takes over";
  static aliases = ["ops"];
  static needs = "ops-story";
  static example = "operations";
  static prefix = "ops";
}

/** Railway undertaking → Journeys: the journeys story (a traveller's train is late). */
class JourneysStory extends StoryCase {
  static id = "journeys";
  static side = "evu";
  static label = "A traveller's journey";
  static tags = ["evu", "passengers"];
  static icon = "journeys";
  static description = "A traveller's train is late: the connection is lost, a bus takes over";
  static needs = "journeys-story";
  static example = "journeys";
  static prefix = "journeys";
}

/** @type {import("./app.js").Page} */
const PAGE = {
  id: "app",
  cases: [IntroCase, SandboxCase, InfraOperations, InfraDisruption, EvuOperations, EvuDisruption, TerminalCase, JourneysStory, BuildCase, DisruptionsCase],
  // a first visit: Interaction with the Introduction
  defaultCase: "intro",
  start: "interaction",
  examples: [
    { id: "neustadt", label: "Example: Bf Neustadt", layout: NEUSTADT },
    { id: "neustadt-video", label: "Example: Bf Neustadt, video", layout: NEUSTADT, video: "../media/ebl-station-trains.mp4" },
    { id: "crane-terminal", label: "Example: terminal at the crane", layout: NEUSTADT, image: "../media/ebl-terminal.jpg", tab: "terminal", layers: ["terminal"] },
    { id: "container-train", label: "Example: hybrid container train", layout: TRAIN, tab: "terminal", layers: [] },
    { id: "container-task", label: "Example: loading task at the hybrid container train", layout: TRAIN, tab: "terminal", layers: ["task"] },
    { id: "terminal", label: "Example: container terminal (virtual)", layout: "../layouts/container-terminal.json", home: LAB },
    { id: "lab", label: "Example: Beta 0.1 (EBL lab photo, older)", layout: LAB },
  ],
  exampleLayers: { plan: { layout: NEUSTADT, layer: "plan" }, operations: { layout: NEUSTADT, layer: "operations" }, infrastructure: { layout: NEUSTADT, layer: "infrastructure" }, journeys: { layout: NEUSTADT, layer: "journeys" } },
  // the photos of the lab as a Street View: they choose what the stage shows (the examples are in Settings → View)
  tour: { data: "../lab-map/data.json" },
};

new App(PAGE).init();
