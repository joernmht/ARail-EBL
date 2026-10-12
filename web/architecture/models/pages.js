/**
 * Models of the architecture page: the app, the marker pages, this page and the plugins. See ../model.js.
 * @module architecture/models/pages
 */
export const PAGES = [
  {
    id: "app", group: "pages", title: "The app",
    summary: "An interactive presentation of the lab: sources (camera, photo, video, flyover), the frame loop, the HUD and the panels: View (with the modules), Build, the modules' tabs (stories to click through; the terminal's moves), Disruptions and Settings (simulation and control system).",
    description: "App owns one World and replaces its layout when another is opened; the layout's edits, the choice of modules and the display settings are kept in the browser. A page (main.js; the game page's main.js) gives App its panels, the simulation that shows each module tab, and its examples: in the app the Operations tab shows the operations story, the Infrastructure tab the maintenance story and the Journeys tab the journeys story (StoryPanel), the Terminal tab the containers to move one by one. The tabs follow the modules: a module tab appears while the layout has the page's simulation for it, Build and Disruptions with the app's modules of those names (Build is on until switched off); View and Settings are always there. Panels are rendered from small DOM helpers (ui.js) and refreshed every 400 ms in place (morph), so focus and clicks are kept.",
    files: ["web/app/main.js", "web/app/app.js", "web/app/ui.js", "web/app/panels.js", "web/app/editor.js", "web/app/flyover.js", "web/app/survey.js", "web/app/terminal.js", "web/app/story.js"],
    classes: [
      {
        name: "App", file: "web/app/app.js", kind: "class", role: "A page with a stage: source, tracking, world, panels (the app and the game page).",
        attributes: ["page: Page — panels, the simulations that show the module tabs, examples", "tabPanels: object — the panels of the module tabs", "tabNames: string[] — the page's tabs", "world: World", "tracker: PlaneTracker", "detector: MarkerDetector", "camera: Camera", "source: object | null — camera, photo or video", "mode: string — camera or flyover", "activeTab: string", "layoutUrl: string | null", "moduleHome: object | null — the layout a module layout belongs to", "appModules: Map — the app's modules on, per layout (also kept in the browser)", "hudRects: object[] — the HUD's chips over the canvas: the stage's labels keep clear of them"],
        operations: ["init()", "frame(dt)", "render()", "updateHud() — the chips over the stage, and where they lie (hudRects)", "tabs() — the tabs shown", "key(name) — what the page keeps in the browser", "storyPanel() — the panel of the tab shown, when it tells a story", "selectTab(name)", "openTab(name) — after an action elsewhere, the focus on its heading", "modules() — the layout's modules and the app's", "toggleModule(id)", "switchOnModule(id) — from Settings or an example: an exclusive one alone, else without the exclusive ones", "setAppModule(id, on)", "openExample(id) — with its own photo or clip", "_loadExampleMedia(x)", "_drawMarkerCovers(view) — grey plates over the markers (setting coverMarkers)", "sizeCanvas() — the source, and below it the layout's view.extend_below", "loadLayoutFromUrl(url, opts)", "_applyLayout(json)", "saveLayout()"],
      },
      { name: "Panels", file: "web/app/panels.js", kind: "class", role: "The View, Settings and Disruptions panels.", attributes: ["settingsView: string — simulate or control"], operations: ["renderView(el)", "renderSettings(el)", "renderSimulate(el)", "setSettingsView(v)", "renderControl(el)", "renderDisruptions(el)", "_moduleBox(m)"] },
      { name: "Editor", file: "web/app/editor.js", kind: "class", role: "Build: placing, dragging, the inspector, the marker map.", operations: ["startPlacing(type)", "placeAt(p, e)", "select(obj)", "render(container)", "renderInspector()", "keepPositions()"] },
      {
        name: "StoryPanel", file: "web/app/story.js", kind: "class", role: "A module tab's story: the current step, Back, Next, Play, Start again, all steps; the flyover's camera follows it.",
        attributes: ["tab: string", "type: string — the story's simulation type", "follow: boolean — Camera follows", "settingsHint: string"],
        operations: ["render(el)", "update()", "next()", "back()", "restart()", "play()", "goTo(i)", "stepped() — after a step: the panel, the camera", "aim() — the flyover goes where the story happens (from the side it says)", "setFollow(on)", "key(e) — Page Down, Page Up"],
      },
      { name: "app main", file: "web/app/main.js", kind: "module", role: "The app's page: its panels (the operations story, the maintenance story, the journeys story, the terminal's moves), examples (Bf Neustadt first)." },
      { name: "ui", file: "web/app/ui.js", kind: "module", role: "DOM helpers.", attributes: ["storage — localStorage that never throws"], operations: ["h(tag, attrs, ...children)", "mount(el, ...children)", "morph(el, ...children) — update in place", "toast(text, ms, opts)", "paramFields(params, values, onChange, opts)"] },
    ],
    relations: [
      { from: "App", to: "World", kind: "composes", label: "world" },
      { from: "App", to: "PlaneTracker", kind: "composes", label: "tracker" },
      { from: "App", to: "Flyover", kind: "composes", label: "flyover" },
      { from: "App", to: "Editor", kind: "composes", label: "editor" },
      { from: "App", to: "Panels", kind: "composes", label: "panels" },
      { from: "App", to: "TerminalPanel", kind: "composes", label: "terminal" },
      { from: "App", to: "StoryPanel", kind: "composes", label: "ops, infra, journeys (the app)" },
      { from: "StoryPanel", to: "Story", kind: "uses", label: "steps" },
      { from: "app main", to: "App", kind: "creates" },
      { from: "Panels", to: "ui", kind: "depends" },
    ],
    activities: [{
      id: "open", name: "Opening a layout (App.loadLayoutFromUrl)",
      nodes: [
        ["s", "start"],
        ["a1", "action", "Fetch the file (a former example file: the lab with that module)", "App.loadLayoutFromUrl"],
        ["d1", "decision", "A module chosen that is a layout of its own?"],
        ["a2", "action", "Open that layout instead; remember its home", "App._openModuleLayout"],
        ["a3", "action", "Its home, if it is a module of another layout", "App._moduleHome"],
        ["d2", "decision", "Edits of this layout saved in the browser?"],
        ["a4", "action", "Apply the saved layout with the modules chosen last", "App._applyLayout"],
        ["a5", "action", "Apply the file with the modules chosen last", "App._applyLayout"],
        ["m1", "merge"],
        ["a6", "action", "The tabs of its modules", "App._syncTabs"],
        ["d3", "decision", "A virtual layout?"],
        ["a7", "action", "The flyover", "Flyover.enter"],
        ["a8", "action", "Its photo (if any)", "App.loadImage"],
        ["m2", "merge"],
        ["e", "end"],
      ],
      edges: [["s", "a1"], ["a1", "d1"], ["d1", "a2", "yes"], ["a2", "a1"], ["d1", "a3", "no"], ["a3", "d2"], ["d2", "a4", "yes"], ["d2", "a5", "no"], ["a4", "m1"], ["a5", "m1"], ["m1", "a6"], ["a6", "d3"], ["d3", "a7", "yes"], ["d3", "a8", "no"], ["a7", "m2"], ["a8", "m2"], ["m2", "e"]],
    }],
    parameters: [
      { key: "?layout=, ?layers=", default: "the last layout, its last modules", meaning: "A layout and its modules (e.g. layers=journeys)." },
      { key: "#tab", default: "view", meaning: "The tab: view, build, terminal, ops, infra, journeys, disrupt, settings (simulate, control: its views); #build and #disrupt switch their module on." },
      { key: "Page Down, Page Up", default: "", meaning: "A presenter's clicker: the next or the step before of the story of the tab shown." },
      { key: "?image=, ?camera=1, ?scenario=", default: "", meaning: "A photo, the live camera, a scenario played (switches the module Disruptions on)." },
      { key: "?example=", default: "", meaning: "An example of the Layouts menu with its own photo or clip and tab (e.g. example=crane-terminal: Bf Neustadt with the photo of the terminal)." },
    ],
    events: {
      listens: [
        { name: "disruption.started", does: "a toast" },
        { name: "disruption.ended", does: "a toast" },
        { name: "feed.status", does: "Settings → Control system updated" },
        { name: "journeys.traveller.arrived", does: "a toast" },
        { name: "story.step", does: "the story's tab shown anew; the flyover's camera follows" },
      ],
    },
    rules: ["Edits are saved 300 ms after the last change, per layout.", "The app's modules (Build, on by default; Disruptions, off) are kept per layout, only where switched from their default; a module layout (the terminal) shares them with its home.", "A link to the tab of an app's module (#build, #disrupt) switches it on."],
  },
  {
    id: "game-page", group: "pages", title: "The game page",
    summary: "The games and exercises on the lab's layout, beside the app: the app's shell (App) with the game panels in the module tabs.",
    description: "Infrastructure: asset management with roles, decisions and budget years (InfraPanel); Operations: a railway undertaking's fleet, workshop and crews, setups compared under stress tests (OperationsPanel); Journeys: travellers with travel plans for a class (JourneysPanel); the container terminal with its visits, new arrivals and crane jobs (TerminalPanel, full). Its examples start with the lab layout Beta 0.1 and its modules; it keeps what it remembers in the browser apart from the app's.",
    files: ["web/game/main.js", "web/game/operations.js"],
    classes: [
      { name: "game main", file: "web/game/main.js", kind: "module", role: "The game page: its panels, the simulations that show its tabs (infrastructure, operations, journeys, terminal), examples." },
      { name: "OperationsPanel", file: "web/game/operations.js", kind: "class", role: "The Operations tab: the day, fleet, workshop, crews, penalties, comparing setups.", operations: ["render(el)", "update()", "addOperations()"] },
    ],
    relations: [
      { from: "game main", to: "App", kind: "creates" },
      { from: "App", to: "InfraPanel", kind: "composes", label: "infra (game page)" },
      { from: "App", to: "OperationsPanel", kind: "composes", label: "ops (game page)" },
      { from: "App", to: "JourneysPanel", kind: "composes", label: "journeys (game page)" },
    ],
    rules: ["The game page keeps its last layout under arail.game.lastLayout; the layouts' edits and modules are shared with the app."],
  },
  {
    id: "markers", group: "pages", title: "Marker sheets and deck cards",
    summary: "Print pages: markers at an exact size, one marker per label on label sheets, and deck cards with the tags of model wagons.",
    files: ["web/markers/markers.js", "web/markers/label-sheets.js", "web/markers/deck-cards.js"],
    classes: [
      { name: "markers", file: "web/markers/markers.js", kind: "module", role: "The page.", operations: ["buildMarkers()", "buildLabels()", "buildDeckCards()", "render()"] },
      { name: "label-sheets", file: "web/markers/label-sheets.js", kind: "module", role: "Label sheets (e.g. HERMA).", operations: ["labelSheet(key)", "labelSheets(items, opts)", "spotTags(opts)"] },
      { name: "deck-cards", file: "web/markers/deck-cards.js", kind: "module", role: "Deck cards for model wagons (testable in Node).", operations: ["deckCards(opts)", "deckSheets(cards, opts)", "markerSvg(bits, x, y, size)"] },
    ],
    relations: [{ from: "markers", to: "label-sheets", kind: "depends" }, { from: "markers", to: "deck-cards", kind: "depends" }],
  },
  {
    id: "architecture-page", group: "pages", title: "This page",
    summary: "The architecture as data (model.js and models/*.js), drawn as UML with dagre's layout; a test checks the data against the code.",
    files: ["web/architecture/model.js", "web/architecture/uml.js", "web/architecture/architecture.js", "web/architecture/models/tracking.js", "web/architecture/models/world.js", "web/architecture/models/transport.js", "web/architecture/models/disruptions.js", "web/architecture/models/terminal.js", "web/architecture/models/operations.js", "web/architecture/models/infra.js", "web/architecture/models/journeys.js", "web/architecture/models/games.js", "web/architecture/models/control.js", "web/architecture/models/tools.js", "web/architecture/models/pages.js"],
    classes: [
      { name: "uml", file: "web/architecture/uml.js", kind: "module", role: "Diagrams as SVG.", operations: ["packageDiagram(spec, title, opts)", "dataFlowDiagram(spec, title)", "classDiagram(model, title, external)", "activityDiagram(activity)", "activitySteps(activity)", "fontsReady()"] },
      { name: "architecture", file: "web/architecture/architecture.js", kind: "module", role: "The page.", operations: ["renderPackages()", "renderDataFlow()", "renderModels()", "modelDetails(m)", "figure(make, caption, label)"] },
    ],
    relations: [{ from: "architecture", to: "uml", kind: "depends" }],
    rules: ["Diagrams of a model are drawn when it is opened; big ones start at their size and scroll.", "tests/js/architecture.test.js checks files, classes, members, the code of activities, events, registered types and settings against the code."],
  },
  {
    id: "plugins", group: "pages", title: "Example plugins",
    summary: "Plugins are ES modules named in a layout file: their default export gets the framework's API and registers object types, simulations, disruptions or vehicles.",
    files: ["web/plugins/windmill.js", "web/plugins/road-traffic.js"],
    classes: [
      { name: "Windmill", file: "web/plugins/windmill.js", kind: "class", extends: "LayoutObject", role: "An object type: a windmill whose blades turn.", operations: ["update(dt)", "draw(view)"] },
      { name: "RoadTraffic", file: "web/plugins/road-traffic.js", kind: "class", extends: "Simulation", role: "A simulation (the road traffic of version 0.1.0, kept for old layouts).", operations: ["step(dt)", "draw(view)"] },
    ],
    rules: ["loadPlugins imports each plugin once; a plugin from another origin is refused in the browser."],
  },
];
