// The ARail game page: the games and exercises on the lab's layout, beside the app (../app/), which
// presents the modules as stories. Its cases in Interaction, by side: Infrastructure, asset management
// with roles, decisions and budget years; Railway undertaking, the operations (fleet, workshop and
// crews, setups compared under stress tests), the container terminal with its visits and the journeys
// (travellers with travel plans for a class). It is the app's shell (stage, flyover, Build, Settings).
import { App } from "../app/app.js";
import { BuildCase, Case, DisruptionsCase, TerminalCase } from "../app/cases.js";
import { InfraPanel } from "./infra.js";
import { JourneysPanel } from "./journeys.js";
import { OperationsPanel } from "./operations.js";

const LAB = "../layouts/ebl-lab.json", NEUSTADT = "../layouts/ebl-neustadt.json", TRAIN = "../layouts/ebl-container-train.json";

/** Infrastructure → Assets: the asset management game of an infrastructure district. */
class AssetsGame extends Case {
  static id = "infra";
  static side = "infra";
  static label = "Assets";
  static description = "Asset management as a game: roles, decisions and budget years";
  static needs = "infrastructure";
  static example = "infrastructure";

  makePanel() {
    return new InfraPanel(this.app);
  }

  add() {
    return this.panel.addInfrastructure();
  }
}

/** Railway undertaking → Operations: the day of the rail operations, its fleet, workshop and crews. */
class OperationsGame extends Case {
  static id = "ops";
  static side = "evu";
  static label = "Operations";
  static description = "Fleet, workshop, crews and penalties; setups compared under stress tests";
  static needs = "operations";
  static example = "operations";

  makePanel() {
    return new OperationsPanel(this.app);
  }

  add() {
    return this.panel.addOperations();
  }
}

/** Railway undertaking → Terminal, with its visits, new arrivals and crane jobs. */
class TerminalGame extends TerminalCase {
  static full = true;
}

/** Railway undertaking → Journeys: the exercise, every attendee makes a traveller. */
class JourneysGame extends Case {
  static id = "journeys";
  static side = "evu";
  static label = "Journeys";
  static description = "Every attendee makes a traveller and chooses a travel plan";
  static needs = "journeys";
  static example = "journeys";

  makePanel() {
    return new JourneysPanel(this.app);
  }

  add() {
    return this.panel.addJourneys();
  }
}

/** @type {import("../app/app.js").Page} */
const PAGE = {
  id: "game",
  cases: [AssetsGame, OperationsGame, TerminalGame, JourneysGame, BuildCase, DisruptionsCase],
  examples: [
    { id: "lab", label: "Example: the lab with its games (Beta 0.1)", layout: LAB },
    { id: "terminal", label: "Example: container terminal (virtual)", layout: "../layouts/container-terminal.json", home: LAB },
    { id: "neustadt", label: "Example: Bf Neustadt and its terminal", layout: NEUSTADT, layers: ["terminal"] },
    { id: "crane-terminal", label: "Example: terminal at the crane", layout: NEUSTADT, image: "../media/ebl-terminal.jpg", tab: "terminal", layers: ["terminal"] },
    { id: "container-train", label: "Example: hybrid container train", layout: TRAIN, tab: "terminal" },
  ],
  exampleLayers: {
    operations: { layout: LAB, layer: "operations" }, infrastructure: { layout: LAB, layer: "infrastructure" }, journeys: { layout: LAB, layer: "journeys" },
  },
};

new App(PAGE).init();
