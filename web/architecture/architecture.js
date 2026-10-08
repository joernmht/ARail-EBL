// The architecture page: packages, data flow, the models with their class and activity diagrams,
// the events and the extension points, drawn from model.js (which tests/js/architecture.test.js
// checks against the code). A model's diagrams are drawn when it is opened.
import { $, h, mount } from "../app/ui.js";
import { DATA_FLOW, EVENTS, GROUPS, MODEL_GROUPS, MODELS, PACKAGES, REGISTRY, REPO_URL } from "./model.js";
import { activityDiagram, activitySteps, classDiagram, dataFlowDiagram, fitViewBox, fontsReady, memberSignature, packageDiagram } from "./uml.js";

const src = (file) => `${REPO_URL}/blob/main/${file}`;
const fileLink = (file) => h("a", { href: src(file) }, h("code", {}, file));
/** Where a class of another model is described (for the names-only boxes of class diagrams). */
const classIndex = new Map(MODELS.flatMap((m) => m.classes.map((c) => [c.name, { model: m, cls: c }])));
const packageOf = (file) => PACKAGES.find((p) => p.files.includes(file));

/**
 * A diagram in a frame: drawn on demand, fitted to the width (or at its actual size, scrolling), with
 * a caption.
 */
function figure(make, caption, label) {
  const box = h("div", { class: "diagram", tabindex: "0", role: "region", "aria-label": label });
  const setFull = (full) => {
    box.classList.toggle("full", full);
    toggle.textContent = full ? "Fit to width" : "Actual size";
  };
  const toggle = h("button", { class: "btn small", type: "button", onclick: () => setFull(!box.classList.contains("full")) }, "Actual size");
  const fig = h("figure", { class: "diagram-figure" },
    h("div", { class: "diagram-tools" }, toggle),
    box,
    caption ? h("figcaption", {}, caption) : null);
  fig._draw = () => {
    if (fig._drawn) return;
    fig._drawn = true;
    try {
      const svg = make();
      mount(box, svg);
      fitViewBox(svg);
      // a diagram much wider than its frame would be too small to read fitted: it starts at its size
      if (Number(svg.getAttribute("width")) > 1.6 * (box.clientWidth || 800)) setFull(true);
    } catch (err) {
      console.error(err);
      mount(box, h("p", { class: "status bad" }, `This diagram could not be drawn: ${err.message}`));
    }
  };
  return fig;
}

/** A table in a frame that scrolls sideways; `label` names it (unique on the page). */
function table(head, rows, cls = "", label = head.join(", ")) {
  return h("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": label },
    h("table", { class: cls }, h("thead", {}, h("tr", {}, head.map((x) => h("th", { scope: "col" }, x)))),
      h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, c)))))));
}

/** "name — meaning" as the name in code and its meaning. */
const split = (s) => {
  const [a, ...b] = String(s).split(" — ");
  return [a.trim(), b.join(" — ").trim()];
};

/* ---------------------------------------------------------------- packages and data flow */

function renderPackages() {
  $("#packages-intro").textContent = "The framework is a set of ES modules without a build step; the app, the marker pages and the plugins use it, and the Python tools talk to it over files and WebSocket messages. Each box is a package with its modules; a dashed arrow means «uses» (it imports modules of the other package).";
  const spec = { groups: GROUPS, packages: PACKAGES };
  const framework = figure(() => packageDiagram(spec, "Packages of the framework", { only: ["framework"] }),
    "The framework (web/arail). Not drawn: the arrows to core · math and core · drawing, which nearly every package uses, and those of index.js, which imports every package.", "Package diagram of the framework");
  const around = figure(() => packageDiagram(spec, "Pages, plugins and tools", { only: ["pages", "tools", "vendor"] }),
    "The pages, plugins and tools around the framework (one box here); arrows with a label: scripts loaded by a page, messages, files.", "Package diagram of the pages, plugins and tools");
  mount($("#packages-body"), framework, around,
    h("details", { class: "sub" }, h("summary", {}, "Packages as a table"),
      table(["Package", "Folder", "What it does", "Modules", "Uses"], PACKAGES.map((p) => [
        h("strong", {}, p.name), h("code", {}, p.path), p.summary, h("span", { class: "files" }, p.files.map((f, i) => [i ? ", " : "", h("a", { href: src(f) }, f.split("/").pop())])),
        (p.uses || []).map((u) => PACKAGES.find((x) => x.id === u)?.name ?? u).join(", ")]), "", "Packages")));
  framework._draw();
  around._draw();
}

function renderDataFlow() {
  $("#dataflow-intro").textContent = DATA_FLOW.intro;
  const fig = figure(() => dataFlowDiagram(DATA_FLOW, "Data flow of ARail-EBL"), "External entities (boxes), processes (rounded, numbered P), data stores (open, numbered D); the arrows carry the data written on them.", "Data-flow diagram");
  mount($("#dataflow-body"), fig,
    h("details", { class: "sub" }, h("summary", {}, "Flows as a table"),
      table(["From", "To", "Data"], DATA_FLOW.flows.map((f) => [nodeName(f.from), nodeName(f.to), f.label]), "", "Data flows")));
  fig._draw();
}

const nodeName = (id) => {
  const n = DATA_FLOW.nodes.find((x) => x.id === id);
  return n ? `${n.no ? `${n.no} ` : ""}${n.label}` : id;
};

/* ---------------------------------------------------------------- models */

function renderModels() {
  const body = $("#models-body");
  mount(body, MODEL_GROUPS.map((g) => h("div", { class: "model-group" },
    h("h3", {}, g.name),
    g.intro ? h("p", { class: "intro" }, g.intro) : null,
    MODELS.filter((m) => m.group === g.id).map((m) => modelDetails(m)))));
  $("#openAll").onclick = () => body.querySelectorAll("details.model").forEach((d) => (d.open = true));
  $("#closeAll").onclick = () => body.querySelectorAll("details.model").forEach((d) => (d.open = false));
}

function modelDetails(m) {
  const figures = [];
  const classesFig = m.classes.length ? figure(() => classDiagram(m, `Classes: ${m.title}`, (name) => external(name, m)),
    "Classes with their main attributes and operations (− internal); names only: classes of other models.", `Class diagram: ${m.title}`) : null;
  if (classesFig) figures.push(classesFig);
  const activities = (m.activities || []).map((a) => {
    const fig = figure(() => activityDiagram(a), a.description || null, `Activity diagram: ${a.name}`);
    figures.push(fig);
    return h("div", { class: "activity", id: `activity-${m.id}-${a.id}` },
      h("h5", {}, a.name),
      fig,
      h("details", { class: "sub" }, h("summary", {}, "Steps as text"),
        h("ol", { class: "steps" }, activitySteps(a).map((s) => h("li", {}, s.text.replace(/^\d+\.\s*/, ""))))));
  });
  const meta = [plural(m.classes.length, "class", "classes"), plural((m.activities || []).length, "activity", "activities"), m.parameters?.length ? plural(m.parameters.length, "setting") : null].filter(Boolean).join(" · ");
  const details = h("details", { class: "model", id: `model-${m.id}` },
    h("summary", {},
      h("span", { class: "model-title" }, m.title),
      h("span", { class: "model-summary" }, m.summary),
      h("span", { class: "model-meta" }, meta)),
    h("div", { class: "model-body" },
      m.description ? h("p", { class: "model-desc" }, m.description) : null,
      classesFig ? [h("h4", {}, "Classes"), classesFig,
        h("details", { class: "sub" }, h("summary", {}, "Classes as text"),
          table(["Class", "File", "Role", "Attributes", "Operations"], m.classes.map((c) => [
            h("strong", {}, c.name, c.extends && c.extends !== "-" ? h("small", {}, ` extends ${c.extends}`) : null),
            fileLink(c.file), c.role || "",
            h("ul", { class: "plain" }, (c.attributes || []).map((a) => h("li", {}, h("code", {}, memberSignature(a)), split(a)[1] ? ` ${split(a)[1]}` : ""))),
            h("ul", { class: "plain" }, (c.operations || []).map((o) => h("li", {}, h("code", {}, memberSignature(o)), split(o)[1] ? ` ${split(o)[1]}` : ""))),
          ]), "classes-table", `Classes of ${m.title}`))] : null,
      activities.length ? [h("h4", {}, activities.length > 1 ? "Activities" : "Activity"), activities] : null,
      m.parameters?.length ? [h("h4", {}, "Settings"), table(["Key", "Default", "Meaning"], m.parameters.map((p) => [h("code", {}, p.key), p.default ?? "", p.meaning]), "", `Settings of ${m.title}`)] : null,
      eventsOf(m),
      m.rules?.length ? [h("h4", {}, "Rules and constants"), h("ul", { class: "rules" }, m.rules.map((r) => h("li", {}, r)))] : null,
      h("h4", {}, "Source files"),
      h("ul", { class: "files-list" }, m.files.map((f) => h("li", {}, fileLink(f), packageOf(f) ? h("small", {}, ` · package ${packageOf(f).name}`) : null))),
    ));
  details.addEventListener("toggle", async () => {
    if (!details.open) return;
    if (location.hash !== `#model-${m.id}`) history.replaceState(null, "", `#model-${m.id}`);
    await fontsReady();
    figures.forEach((f) => f._draw());
  });
  return details;
}

function eventsOf(m) {
  const emits = m.events?.emits || [], listens = m.events?.listens || [];
  if (!emits.length && !listens.length) return null;
  return [h("h4", {}, "Events"),
    table(["Event", "Sends or listens", "When, and what it carries"], [
      ...emits.map((e) => [h("code", {}, e.name), "sends", `${e.when}${e.payload ? ` (${e.payload})` : ""}`]),
      ...listens.map((e) => [h("code", {}, e.name), "listens", e.does]),
    ], "events-table", `Events of ${m.title}`)];
}

function external(name, model) {
  const hit = classIndex.get(name);
  if (!hit || hit.model === model) return null;
  return { package: hit.model.title };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ---------------------------------------------------------------- events, registry, notation */

function renderEvents() {
  mount($("#events-body"), table(["Event", "Sent by", "Carries", "Meaning"], EVENTS.map((e) => [
    h("code", {}, e.name), h("span", { class: "files" }, e.from.map((f, i) => [i ? ", " : "", h("a", { href: src(f) }, f.replace(/^web\//, ""))])), e.payload || "", e.meaning]), "events-table", "Event catalog"));
}

function renderRegistry() {
  const groups = [["simulations", "Simulations", "The parts that move: each runs in every step of the world."], ["objects", "Object types", "What can be placed on a layout (Build panel)."], ["disruptions", "Disruptions", "What can go wrong (Disruptions tab, scenarios)."], ["vehicles", "Vehicles", "How trains and buses are drawn."]];
  mount($("#registry-body"), groups.map(([key, title, intro]) => h("div", { class: "registry-group" },
    h("h3", {}, title, h("span", { class: "count" }, ` (${REGISTRY[key].length})`)),
    h("p", { class: "intro" }, intro),
    table(["Type", "Class or definition", "File", "Model"], REGISTRY[key].map((r) => [h("code", {}, r.type), r.class ? h("code", {}, r.class) : r.label || "", fileLink(r.file),
      r.model ? h("a", { href: `#model-${r.model}` }, MODELS.find((m) => m.id === r.model)?.title ?? r.model) : ""]), "", title))));
}

/** The notation: a small class diagram and a small activity that show every symbol. */
function renderNotation() {
  const classes = figure(() => classDiagram({
    classes: [
      { name: "Simulation", file: "", kind: "class", stereotype: "base class", role: "", attributes: ["enabled: boolean"], operations: ["step(dt)"] },
      { name: "MySimulation", file: "", kind: "class", extends: "Simulation", role: "", attributes: ["count: number", "_cache: Map"], operations: ["step(dt)", "_spawn()"] },
      { name: "Crowd", file: "", kind: "class", role: "", attributes: [], operations: [] },
      { name: "World", file: "", kind: "class", role: "", attributes: [], operations: [] },
      { name: "Report", file: "", kind: "class", role: "", attributes: [], operations: [] },
    ],
    relations: [
      { from: "MySimulation", to: "Crowd", kind: "composes", label: "1..* crowds" },
      { from: "MySimulation", to: "World", kind: "uses", label: "world" },
      { from: "MySimulation", to: "Report", kind: "creates" },
    ],
  }, "Notation of the class diagrams"), "Generalisation (hollow triangle), composition (filled diamond: owns, same life), association (arrow), «create» (dashed). + public, − internal (a name starting with _).", "Notation of the class diagrams");
  const activity = figure(() => activityDiagram({
    name: "Notation of the activity diagrams",
    nodes: [["s", "start"], ["a", "action", "An action", "Class.method"], ["d", "decision", "A question?"], ["f", "fork"], ["b", "action", "One branch"], ["c", "send", "an.event"], ["j", "join"], ["r", "receive", "another.event"], ["m", "merge"], ["e", "end"], ["x", "flowfinal"]],
    edges: [["s", "a"], ["a", "d"], ["d", "f", "yes"], ["d", "r", "no"], ["f", "b"], ["f", "c"], ["b", "j"], ["c", "j"], ["j", "m"], ["r", "m"], ["m", "e"], ["c", "x"]],
  }), "Start, action (with the code that does it), decision with guards, fork and join (in parallel), send signal (an event on the world's bus), accept event (waits for one), merge, end of the activity, end of one flow.", "Notation of the activity diagrams");
  mount($("#notation-body"), h("div", { class: "notation" }, classes, activity),
    h("p", { class: "intro" }, "Data flow: an external entity is a box, a process a rounded box with its number (P), a data store an open box with its number (D)."));
  return [classes, activity];
}

/* ---------------------------------------------------------------- start */

async function init() {
  renderModels();
  renderEvents();
  renderRegistry();
  await fontsReady();
  renderPackages();
  renderDataFlow();
  for (const f of renderNotation()) f._draw();
  // a link to a model opens it
  const open = () => {
    const target = location.hash && document.getElementById(location.hash.slice(1));
    const model = target?.closest?.("details.model");
    if (model && !model.open) {
      model.open = true;
      target.scrollIntoView();
    }
  };
  window.addEventListener("hashchange", open);
  open();
  document.documentElement.dataset.ready = "true";
}

init();
