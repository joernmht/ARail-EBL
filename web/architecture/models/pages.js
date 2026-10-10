/**
 * Models of the architecture page: the app, the marker pages, this page and the plugins. See ../model.js.
 * @module architecture/models/pages
 */
export const PAGES = [
  {
    id: "app", group: "pages", title: "The app",
    summary: "Sources (camera, photo, video, flyover), the frame loop, the HUD and the panels: View (with the modules), Build, the modules' tabs, Disruptions and Settings (simulation and control system).",
    description: "App owns one World and replaces its layout when another is opened; the layout's edits, the choice of modules and the display settings are kept in the browser. The tabs follow the modules: Terminal, Operations, Infrastructure and Journeys appear with their simulation, Build and Disruptions with the app's modules of those names (Build is on until switched off); View and Settings are always there. Panels are rendered from small DOM helpers (ui.js) and refreshed every 400 ms in place (morph), so focus and clicks are kept.",
    files: ["web/app/app.js", "web/app/ui.js", "web/app/panels.js", "web/app/editor.js", "web/app/inspect.js", "web/app/flyover.js", "web/app/survey.js", "web/app/terminal.js", "web/app/operations.js", "web/app/infra.js", "web/app/journeys.js"],
    classes: [
      {
        name: "App", file: "web/app/app.js", kind: "class", role: "The page: source, tracking, world, panels.",
        attributes: ["world: World", "tracker: PlaneTracker", "detector: MarkerDetector", "camera: Camera", "source: object | null — camera, photo or video", "mode: string — camera or flyover", "activeTab: string", "layoutUrl: string | null", "moduleHome: object | null — the layout a module layout belongs to", "appModules: Map — the app's modules on, per layout (also kept in the browser)"],
        operations: ["init()", "frame(dt)", "render()", "tabs() — the tabs shown", "selectTab(name)", "openTab(name) — after an action elsewhere, the focus on its heading", "modules() — the layout's modules and the app's", "toggleModule(id)", "setAppModule(id, on)", "openExample(id) — with its own photo or clip", "_loadExampleMedia(x)", "_drawMarkerCovers(view) — grey plates over the markers (setting coverMarkers)", "sizeCanvas() — the source, and below it the layout's view.extend_below", "loadLayoutFromUrl(url, opts)", "_applyLayout(json)", "saveLayout()"],
      },
      { name: "Panels", file: "web/app/panels.js", kind: "class", role: "The View, Settings and Disruptions panels.", attributes: ["settingsView: string — simulate or control"], operations: ["renderView(el)", "renderSettings(el)", "renderSimulate(el)", "setSettingsView(v)", "renderControl(el)", "renderDisruptions(el)", "_moduleBox(m)"] },
      { name: "Editor", file: "web/app/editor.js", kind: "class", role: "Build: placing, dragging, the inspector, the marker map.", operations: ["startPlacing(type)", "placeAt(p, e)", "select(obj)", "render(container)", "renderInspector()", "keepPositions()"] },
      { name: "OperationsPanel", file: "web/app/operations.js", kind: "class", role: "The Operations tab.", operations: ["render(el)", "update()", "addOperations()"] },
      {
        name: "Inspector", file: "web/app/inspect.js", kind: "class", role: "Hover and click: the tooltip of what the mouse points at, the info card of what was tapped, their outlines on the stage.",
        attributes: ["hover: object | null — the pickable under the mouse", "open: object | null — the card shown: its key and pickable", "keyAim: boolean — the cross in the middle of the flyover (keyboard)"],
        operations: ["hoverAt(pixel)", "tapAt(pixel, opts) — outside Build and Terminal", "inspectCentre() — Enter on the flyover", "show(hit)", "close()", "update() — every 400 ms", "drawOverlay(ctx, view)", "act(id) — follow"],
      },
      { name: "ui", file: "web/app/ui.js", kind: "module", role: "DOM helpers.", attributes: ["storage — localStorage that never throws"], operations: ["h(tag, attrs, ...children)", "mount(el, ...children)", "morph(el, ...children) — update in place", "toast(text, ms, opts)", "paramFields(params, values, onChange, opts)"] },
    ],
    relations: [
      { from: "App", to: "World", kind: "composes", label: "world" },
      { from: "App", to: "PlaneTracker", kind: "composes", label: "tracker" },
      { from: "App", to: "Flyover", kind: "composes", label: "flyover" },
      { from: "App", to: "Editor", kind: "composes", label: "editor" },
      { from: "App", to: "Panels", kind: "composes", label: "panels" },
      { from: "App", to: "TerminalPanel", kind: "composes", label: "terminal" },
      { from: "App", to: "OperationsPanel", kind: "composes", label: "operations" },
      { from: "App", to: "InfraPanel", kind: "composes", label: "infra" },
      { from: "App", to: "JourneysPanel", kind: "composes", label: "journeys" },
      { from: "App", to: "Inspector", kind: "composes", label: "inspector" },
      { from: "Inspector", to: "World", kind: "uses", label: "pick, card" },
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
      { key: "?image=, ?camera=1, ?scenario=", default: "", meaning: "A photo, the live camera, a scenario played (switches the module Disruptions on)." },
      { key: "?example=", default: "", meaning: "An example of the Layouts menu with its own photo or clip and tab (e.g. example=crane-terminal: Bf Neustadt with the photo of the terminal)." },
    ],
    events: {
      listens: [
        { name: "disruption.started", does: "a toast" },
        { name: "disruption.ended", does: "a toast" },
        { name: "feed.status", does: "Settings → Control system updated" },
        { name: "journeys.traveller.arrived", does: "a toast" },
      ],
    },
    rules: ["Edits are saved 300 ms after the last change, per layout.", "Taps on the stage open the info card of what is there, except in Build (they select) and in Terminal (they pick containers); the tooltip follows the mouse in every tab.", "The app's modules (Build, on by default; Disruptions, off) are kept per layout, only where switched from their default; a module layout (the terminal) shares them with its home.", "A link to the tab of an app's module (#build, #disrupt) switches it on."],
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
    files: ["web/architecture/model.js", "web/architecture/uml.js", "web/architecture/architecture.js", "web/architecture/models/tracking.js", "web/architecture/models/world.js", "web/architecture/models/transport.js", "web/architecture/models/disruptions.js", "web/architecture/models/terminal.js", "web/architecture/models/operations.js", "web/architecture/models/infra.js", "web/architecture/models/journeys.js", "web/architecture/models/control.js", "web/architecture/models/tools.js", "web/architecture/models/pages.js"],
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
