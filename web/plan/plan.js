// The plan documents: the infrastructure of an ARail layout, or a rail-infra/1 file (the EBL's digital
// twin writes its track plan and its hall plan as such), drawn as a plan sheet (arail/plan/drawing.js)
// to print at its true size, or to download as SVG, DXF or rail-infra data. `?layout=` opens a
// layout, `?src=` a layout or rail-infra file by its URL (e.g. the twin's /api/infra), `?paper=`,
// `?scale=` and `?sheet=` choose the sheet.
import { composeLayout, normalizeLayers } from "../arail/core/layers.js";
import { DRAWING_LAYERS, LANE_SCALES, PAPERS, SCALES, drawSheet } from "../arail/plan/drawing.js";
import { toDXF } from "../arail/plan/dxf.js";
import { INFRA_FORMAT, layoutToInfra, infraProblems } from "../arail/plan/infra.js";
import { chooseLanguage, i18n, t, tr, translateDocument } from "../app/i18n.js";

const $ = (s) => document.querySelector(s);
// the layouts of ARail, with the modules that hold their infrastructure
const LAYOUTS = [
  ["../layouts/ebl-neustadt.json", "Bf Neustadt", ["infrastructure"]],
  ["../layouts/ebl-lab.json", "EBL lab, Beta 0.1"],
  ["../layouts/container-terminal.json", "Container terminal"],
  ["../layouts/ebl-container-train.json", "Hybrid container train"],
];

const params = new URLSearchParams(location.search);
const state = {
  file: null, // the file as loaded: a layout or rail-infra data
  name: "", // where it came from
  modules: new Set(), // the layout's modules that are on
  doc: null, // the rail-infra document drawn
  sheet: Math.max(1, Number(params.get("sheet")) || 1),
  layers: new Set(DRAWING_LAYERS.map((l) => l.id)),
  result: null,
};

function option(select, value, text) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = text;
  select.append(o);
  return o;
}

/** The sources: the layouts of ARail, and a file opened or given by its URL. */
function fillSources(extra) {
  const s = $("#source");
  s.replaceChildren();
  for (const [url, name] of LAYOUTS) option(s, url, tr(name));
  if (extra) option(s, extra, extra.split("/").pop() || extra).translate = false;
}

function fillPaper() {
  const s = $("#paper");
  for (const p of Object.keys(PAPERS)) option(s, p, p);
  s.value = PAPERS[params.get("paper")] ? params.get("paper") : "A3";
}

/** The scales that suit the frame: 1:n for mm, mm per lane for a schematic plan. */
function fillScales() {
  const s = $("#scale"), old = s.value || params.get("scale") || "auto";
  s.replaceChildren();
  option(s, "auto", tr("Auto"));
  if (state.doc?.frame?.unit === "lane") for (const v of LANE_SCALES) option(s, String(v), t("{mm} mm per lane", { mm: v }));
  else for (const v of SCALES) option(s, String(v), `1:${v}`);
  s.value = [...s.options].some((o) => o.value === old) ? old : "auto";
}

function fillLayers() {
  const box = $("#layers");
  for (const l of DRAWING_LAYERS) {
    const label = document.createElement("label"), box2 = document.createElement("input");
    box2.type = "checkbox";
    box2.checked = true;
    box2.addEventListener("change", () => {
      if (box2.checked) state.layers.add(l.id);
      else state.layers.delete(l.id);
      draw();
    });
    label.append(box2, tr(l.label));
    box.append(label);
  }
}

/** The modules of a layout as boxes; those on by default are ticked. */
function fillModules() {
  const box = $("#modules");
  box.replaceChildren();
  const layers = state.file?.format === INFRA_FORMAT ? [] : normalizeLayers(state.file?.layers);
  box.hidden = !layers.length;
  if (!layers.length) return;
  const head = document.createElement("span");
  head.textContent = tr("Modules");
  box.append(head);
  for (const l of layers) {
    const label = document.createElement("label"), input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.modules.has(l.id);
    input.addEventListener("change", () => {
      if (input.checked) state.modules.add(l.id);
      else state.modules.delete(l.id);
      convert();
      draw();
    });
    const name = document.createElement("span");
    name.textContent = l.name;
    name.translate = false;
    label.append(input, name);
    box.append(label);
  }
}

/** The document drawn: the file itself, or the layout with the modules ticked, converted. */
function convert() {
  const f = state.file;
  if (!f) return;
  if (f.format === INFRA_FORMAT) state.doc = f;
  else {
    const layers = (Array.isArray(f.layers) ? f.layers : []).map((l) => ({ ...l, enabled: state.modules.has(l.id) }));
    state.doc = layoutToInfra(composeLayout({ ...f, layers }).layout, { file: state.name, date: new Date().toISOString().slice(0, 10) });
  }
  const problems = infraProblems(state.doc);
  const st = $("#status");
  st.classList.toggle("bad", problems.length > 0);
  st.textContent = problems.length
    ? t("{n} problems in the data, e.g.: {first}", { n: problems.length, first: problems[0] })
    : t("{tracks} tracks, {elements} elements, {platforms} platforms", { tracks: state.doc.tracks?.length ?? 0, elements: state.doc.elements?.length ?? 0, platforms: state.doc.platforms?.length ?? 0 });
  fillScales();
}

async function load(url) {
  const st = $("#status");
  st.textContent = tr("Loading…");
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    open(await res.json(), url);
  } catch (err) {
    st.classList.add("bad");
    st.textContent = t("Could not load {name}: {error}", { name: url, error: err.message });
  }
}

/** Show a file: a layout (its modules on as by default) or rail-infra data. */
function open(json, name) {
  state.file = json;
  state.name = name;
  state.modules = new Set(json?.format === INFRA_FORMAT ? [] : normalizeLayers(json?.layers).filter((l) => l.enabled).map((l) => l.id));
  const extra = params.get("layers")?.split(",") ?? LAYOUTS.find(([u]) => u === name)?.[2] ?? [];
  if (json?.format !== INFRA_FORMAT) for (const id of extra) state.modules.add(id);
  state.sheet = state.result ? 1 : state.sheet;
  $("#tTitle").placeholder = json?.name || "";
  fillModules();
  convert();
  draw();
}

function titleOverrides() {
  const out = {};
  for (const [key, id] of [["title", "#tTitle"], ["number", "#tNumber"], ["author", "#tAuthor"], ["revision", "#tRevision"]]) if ($(id).value.trim()) out[key] = $(id).value.trim();
  return out;
}

function draw() {
  if (!state.doc) return;
  const scale = $("#scale").value === "auto" ? "auto" : Number($("#scale").value);
  const r = drawSheet(state.doc, { paper: $("#paper").value, scale, sheet: state.sheet, layers: state.layers, title: titleOverrides(), tr, date: new Date().toISOString().slice(0, 10) });
  state.result = r;
  state.sheet = r.sheet;
  const box = $("#sheet");
  box.innerHTML = r.svg;
  box.setAttribute("aria-label", t("Plan sheet {sheet} of {sheets}, {scale}, {paper}", { sheet: r.sheet, sheets: r.sheets, scale: r.scaleText, paper: r.paper }));
  const s = $("#sheetNo");
  if (s.options.length !== r.sheets) {
    s.replaceChildren();
    for (let i = 1; i <= r.sheets; i++) option(s, String(i), t("{n} of {total}", { n: i, total: r.sheets }));
  }
  s.value = String(r.sheet);
  $("#prev").disabled = r.sheet <= 1;
  $("#next").disabled = r.sheet >= r.sheets;
  const [w, h] = PAPERS[r.paper];
  $("#pageSize").textContent = `@page { size: ${w}mm ${h}mm; margin: 0; }`;
}

/** Offer a text as a file to save. */
function save(text, name, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const base = () => (state.doc?.name || "plan").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "plan";

// ------------------------------------------------------------------ the page
const lang = chooseLanguage();
i18n.setLanguage(lang);
document.documentElement.lang = lang;
translateDocument(["#bar", "#controls", "#tools", ".skip-link"]);
fillPaper();
fillLayers();
const src = params.get("src") || params.get("layout");
fillSources(src && !LAYOUTS.some(([u]) => u === src) ? src : null);
$("#source").value = src || LAYOUTS[0][0];

$("#source").addEventListener("change", () => {
  state.sheet = 1;
  load($("#source").value);
});
$("#file").addEventListener("change", async () => {
  const f = $("#file").files?.[0];
  if (!f) return;
  try {
    open(JSON.parse(await f.text()), f.name);
  } catch (err) {
    $("#status").classList.add("bad");
    $("#status").textContent = t("Could not load {name}: {error}", { name: f.name, error: err.message });
  }
});
for (const id of ["#paper", "#scale"]) $(id).addEventListener("change", () => {
  state.sheet = 1;
  draw();
});
$("#sheetNo").addEventListener("change", () => {
  state.sheet = Number($("#sheetNo").value);
  draw();
});
$("#prev").addEventListener("click", () => {
  state.sheet -= 1;
  draw();
});
$("#next").addEventListener("click", () => {
  state.sheet += 1;
  draw();
});
for (const id of ["#tTitle", "#tNumber", "#tAuthor", "#tRevision"]) $(id).addEventListener("input", draw);
$("#zoom").addEventListener("click", () => {
  const fit = $("#sheet").classList.toggle("fit");
  $("#zoom").setAttribute("aria-pressed", String(!fit));
});
$("#print").addEventListener("click", () => window.print());
$("#svg").addEventListener("click", () => state.result && save(state.result.svg, `${base()}-sheet-${state.result.sheet}.svg`, "image/svg+xml"));
$("#dxf").addEventListener("click", () => state.doc && save(toDXF(state.doc), `${base()}.dxf`, "image/vnd.dxf"));
$("#data").addEventListener("click", () => state.doc && save(JSON.stringify(state.doc, null, 1), `${base()}.rail-infra.json`, "application/json"));
$("#controls").addEventListener("submit", (e) => e.preventDefault());

window.__plan = state;
await load($("#source").value);
