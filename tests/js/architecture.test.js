// The architecture page (web/architecture/model.js) against the code: every source file in a package
// and in a model, the packages' dependencies are the imports, classes, attributes and operations are
// in their files, activities are well formed and name existing code, the event catalog is exactly
// the events sent, the registry is exactly what is registered, the settings of the simulations and
// the parameters of the disruptions are those of the code. When this test fails, update
// web/architecture/model.js together with the code (see CONTRIBUTING.md).
import assert from "node:assert/strict";
import test from "node:test";

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { registry } from "../../web/arail/index.js";
import { DATA_FLOW, EVENTS, GROUPS, MODEL_GROUPS, MODELS, PACKAGES, REGISTRY } from "../../web/architecture/model.js";
import { ACTIVITY_KINDS, activitySteps, memberName } from "../../web/architecture/uml.js";
import { ROOT } from "./helpers.js";

const rel = (p) => relative(ROOT, p).split("\\").join("/");
const texts = new Map();
/** The text of a file of the repository (by its path from the root). */
function read(file) {
  if (!texts.has(file)) texts.set(file, readFileSync(join(ROOT, file), "utf8"));
  return texts.get(file);
}
function walk(dir, keep) {
  const out = [];
  for (const f of readdirSync(join(ROOT, dir))) {
    const p = `${dir}/${f}`;
    if (f === "__pycache__" || f.endsWith(".egg-info")) continue;
    if (statSync(join(ROOT, p)).isDirectory()) out.push(...walk(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The source files the page has to cover. */
const SOURCES = [
  ...["web/arail", "web/app", "web/markers", "web/plugins", "web/architecture"].flatMap((d) => walk(d, (p) => p.endsWith(".js"))),
  ...walk("tools/arail_tools", (p) => p.endsWith(".py")),
  ...readdirSync(join(ROOT, "tools")).filter((f) => f.endsWith(".mjs")).map((f) => `tools/${f}`),
].sort();

const pkgOfFile = new Map(PACKAGES.flatMap((p) => p.files.map((f) => [f, p.id])));
/** Classes of the page by name (the first one: a model's own class of the same name comes first, see classOf). */
const classes = new Map();
for (const m of MODELS) for (const c of m.classes) if (c.kind !== "module" && !classes.has(c.name)) classes.set(c.name, { ...c, model: m.id });
/** A class as a model sees it: its own of that name, else the page's. */
const classOf = (name, m) => m.classes.find((x) => x.name === name) || classes.get(name);
const isPython = (file) => file.endsWith(".py");

/** Is a class declared in the file (JS or Python)? Its base class, if it has one. */
function declaration(name, file) {
  const t = read(file);
  const m = isPython(file) ? t.match(new RegExp(`^class\\s+${esc(name)}\\b(?:\\(([^)]*)\\))?`, "m")) : t.match(new RegExp(`\\bclass\\s+${esc(name)}\\b(?:\\s+extends\\s+([\\w.$]+))?`));
  return m ? { base: (m[1] || "").trim() || null } : null;
}

/** Is an operation (method or function) defined in the file? */
function hasOperation(name, file) {
  const t = read(file), n = esc(name);
  if (definition(name, file)) return true; // a function or method
  if (isPython(file)) return false;
  return new RegExp(`^\\s*(export\\s+)?(const|let)\\s+${n}\\s*=`, "m").test(t) // a constant (function or value)
    || new RegExp(`^\\s*${n}\\s*[:=]\\s*(async\\s*)?(\\([^)]*\\)|\\w+)\\s*=>`, "m").test(t); // a property that is a function
}

/** Is an attribute (field, getter, constant) in the file? */
function hasAttribute(name, file) {
  const t = read(file), n = esc(name);
  if (isPython(file)) return new RegExp(`self\\.${n}\\b|^\\s*${n}\\s*[:=]`, "m").test(t);
  return new RegExp(`this\\.${n}\\b|this\\.#${n}\\b|^\\s*(static\\s+)?#?${n}\\s*[;=]|\\bget\\s+${n}\\s*\\(|^\\s*(export\\s+)?(const|let)\\s+${n}\\b|[{,]\\s*${n}\\s*:`, "m").test(t);
}

/** The files of a class and of its base classes (as far as the page knows them). */
function classFiles(c, m) {
  const files = [c.file];
  let base = c.extends && c.extends !== "-" ? classOf(c.extends, m) : null;
  for (let i = 0; base && i < 6; i++) {
    files.push(base.file);
    base = base.extends && base.extends !== "-" ? classOf(base.extends, m) : null;
  }
  return files;
}

test("packages: every source file is in exactly one package; every file named exists", () => {
  const groups = new Set(GROUPS.map((g) => g.id)), ids = new Set();
  for (const p of PACKAGES) {
    assert.ok(!ids.has(p.id), `duplicate package ${p.id}`);
    ids.add(p.id);
    assert.ok(groups.has(p.group), `package ${p.id}: no group ${p.group}`);
    for (const f of p.files) assert.ok(existsSync(join(ROOT, f)), `package ${p.id}: ${f} does not exist`);
  }
  for (const p of PACKAGES) {
    for (const u of p.uses || []) assert.ok(ids.has(u), `package ${p.id} uses ${u}, which is no package`);
    for (const [to] of p.links || []) assert.ok(ids.has(to), `package ${p.id} links to ${to}, which is no package`);
  }
  for (const f of SOURCES) {
    const n = PACKAGES.filter((p) => p.files.includes(f)).length;
    assert.equal(n, 1, `${f} is in ${n} packages of web/architecture/model.js (PACKAGES), not in one`);
  }
});

test("packages: the «use» dependencies are exactly the imports between them", () => {
  const derived = new Map(PACKAGES.map((p) => [p.id, new Set()]));
  for (const f of SOURCES.filter((x) => /\.(m?js)$/.test(x))) {
    const from = pkgOfFile.get(f);
    // without comments (they hold examples of imports)
    const t = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
    for (const m of t.matchAll(/(?:^|[;\s])(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|(?:^|[;\s])import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/gm)) {
      const spec = m[1] || m[2] || m[3];
      if (!spec.startsWith(".")) continue;
      const target = rel(resolve(dirname(join(ROOT, f)), spec));
      const to = pkgOfFile.get(target);
      assert.ok(to, `${f} imports ${target}, which is in no package`);
      if (to !== from) derived.get(from).add(to);
    }
  }
  for (const p of PACKAGES) {
    if (p.external) continue;
    assert.deepEqual([...(p.uses || [])].sort(), [...derived.get(p.id)].sort(), `package ${p.id}: "uses" must be the packages its modules import`);
  }
});

test("models: every source file is described by a model; the models' files and groups exist", () => {
  const groups = new Set(MODEL_GROUPS.map((g) => g.id)), ids = new Set();
  for (const m of MODELS) {
    assert.ok(!ids.has(m.id), `duplicate model ${m.id}`);
    ids.add(m.id);
    assert.ok(groups.has(m.group), `model ${m.id}: no group ${m.group}`);
    assert.ok(m.title && m.summary, `model ${m.id}: title and summary`);
    for (const f of m.files) assert.ok(pkgOfFile.has(f), `model ${m.id}: ${f} is in no package`);
  }
  const described = new Set(MODELS.flatMap((m) => m.files));
  for (const f of SOURCES) assert.ok(described.has(f), `${f} is described by no model (MODELS[].files)`);
});

test("models: classes, attributes and operations are in their files", () => {
  for (const m of MODELS) {
    for (const c of m.classes) {
      const where = `model ${m.id}, ${c.name}`;
      assert.ok(m.files.includes(c.file), `${where}: ${c.file} is not among the model's files`);
      if (c.kind !== "module") {
        const d = declaration(c.name, c.file);
        assert.ok(d, `${where}: no class ${c.name} in ${c.file}`);
        if (c.extends && c.extends !== "-") assert.ok(d.base && (d.base === c.extends || d.base.endsWith(`.${c.extends}`) || c.extends.endsWith(`.${d.base}`)), `${where}: extends ${d.base}, not ${c.extends}`);
        else assert.ok(!d.base || isPython(c.file), `${where}: extends ${d.base} (write it in "extends")`);
      }
      const files = c.kind === "module" ? [c.file] : classFiles(c, m);
      for (const a of c.attributes || []) {
        const n = memberName(a);
        assert.ok(n && files.some((f) => hasAttribute(n, f) || hasOperation(n, f)), `${where}: no attribute ${n} in ${files.join(", ")}`);
      }
      for (const o of c.operations || []) {
        const n = memberName(o);
        assert.ok(n && files.some((f) => hasOperation(n, f)), `${where}: no operation ${n} in ${files.join(", ")}`);
      }
    }
    for (const r of m.relations || []) {
      for (const n of [r.from, r.to]) assert.ok(classes.has(n) || m.classes.some((c) => c.name === n), `model ${m.id}: relation ${r.from} → ${r.to}: no class ${n} on the page`);
      assert.ok(["inherits", "composes", "aggregates", "uses", "creates", "depends"].includes(r.kind), `model ${m.id}: relation kind ${r.kind}`);
    }
  }
});

/**
 * The parameters of a definition of `name` in a file (a function, a method, an object's method),
 * as written at the top level of its parenthesis; null if the file defines none. A call at the
 * start of a line is no definition: a definition's parenthesis is followed by `{` (`:` in Python).
 */
function definition(name, file) {
  const t = read(file), n = esc(name), py = isPython(file);
  const patterns = py ? [new RegExp(`^\\s*(?:async\\s+)?def\\s+${n}\\s*\\(`, "gm")]
    : [new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s*\\*?\\s*${n}\\s*\\(`, "gm"), new RegExp(`^\\s*(?:static\\s+)?(?:async\\s+)?(?:get\\s+|set\\s+)?\\*?\\s*${n}\\s*\\(`, "gm")];
  for (const re of patterns) {
    for (const m of t.matchAll(re)) {
      const parts = [];
      let depth = 0, cur = "", i = m.index + m[0].length;
      for (; i < t.length; i++) {
        const ch = t[i];
        if (depth === 0 && ch === ")") break;
        if ("([{".includes(ch)) depth++;
        if (")]}".includes(ch)) depth--;
        if (depth === 0 && ch === ",") {
          parts.push(cur.trim());
          cur = "";
        } else cur += ch;
      }
      if (cur.trim()) parts.push(cur.trim());
      const after = t.slice(i + 1).match(/^\s*(\S)/)?.[1];
      if (py ? after === ":" || after === "-" : after === "{") return parts.filter((x) => !(py && ["self", "cls", "*"].includes(x)));
    }
  }
  return null;
}

test("operations: the parameters written are those of the code, in their order", () => {
  const wrong = [];
  for (const m of MODELS) {
    for (const c of m.classes) {
      const files = c.kind === "module" ? [c.file] : classFiles(c, m);
      for (const o of c.operations || []) {
        const call = String(o).split(" — ")[0].match(/^(?:static\s+)?([#\w$]+)\s*\(([^)]*)\)/);
        if (!call) continue;
        const documented = call[2].split(",").map((x) => x.trim()).filter(Boolean);
        const code = files.map((f) => definition(call[1], f)).find((x) => x);
        if (!code) continue; // a property that is a function: that it exists is checked above
        const ids = code.map((p) => (/^[{[]/.test(p) ? null : p.replace(/^\*{1,2}|^\.\.\./, "").replace(/\s*[=:].*$/s, "").trim()));
        const bad = documented.length > code.length || documented.some((d, i) => ids[i] !== null && d.replace(/^\.\.\.|^\*{1,2}/, "") !== ids[i]);
        if (bad) wrong.push(`model ${m.id}, ${c.name}.${call[1]}(${documented.join(", ")}): the code has (${ids.map((x) => x ?? "{…}").join(", ")})`);
      }
    }
  }
  assert.deepEqual(wrong, [], wrong.join("\n"));
});

test("activities: well formed (reachable, no dead ends, decisions with guards) and naming existing code", () => {
  const eventNames = new Set(EVENTS.map((e) => e.name));
  for (const m of MODELS) {
    for (const a of m.activities || []) {
      const where = `model ${m.id}, activity "${a.name}"`;
      const ids = new Set();
      for (const [id, kind, label, ref] of a.nodes) {
        assert.ok(!ids.has(id), `${where}: duplicate node ${id}`);
        ids.add(id);
        assert.ok(ACTIVITY_KINDS.includes(kind), `${where}: node ${id} has kind ${kind}`);
        if (["action", "send", "receive"].includes(kind)) assert.ok(label, `${where}: node ${id} needs a label`);
        if (kind === "send" || kind === "receive") assert.ok(eventNames.has(label), `${where}: ${kind} ${label} is not in the event catalog (EVENTS)`);
        if (ref) checkRef(ref, m, `${where}, node ${id}`);
      }
      const out = new Map(), inn = new Map();
      for (const [from, to, guard] of a.edges) {
        assert.ok(ids.has(from) && ids.has(to), `${where}: edge ${from} → ${to} to a node that does not exist`);
        out.set(from, [...(out.get(from) || []), { to, guard }]);
        inn.set(to, (inn.get(to) || 0) + 1);
      }
      const starts = a.nodes.filter((n) => n[1] === "start");
      assert.ok(starts.length >= 1, `${where}: no start`);
      for (const [id, kind] of a.nodes) {
        const o = out.get(id) || [];
        if (kind === "end" || kind === "flowfinal") assert.equal(o.length, 0, `${where}: ${id} (${kind}) has outgoing edges`);
        else assert.ok(o.length > 0, `${where}: ${id} leads nowhere`);
        if (kind === "start") assert.ok(!inn.get(id), `${where}: an edge goes into the start ${id}`);
        else assert.ok(inn.get(id), `${where}: nothing leads to ${id}`);
        if (kind === "decision") {
          assert.ok(o.length >= 2, `${where}: decision ${id} with ${o.length} way out`);
          assert.ok(o.every((e) => e.guard), `${where}: decision ${id}: every way out needs a guard`);
        }
        if (kind === "merge" || kind === "join") assert.ok((inn.get(id) || 0) >= 2, `${where}: ${kind} ${id} with one way in`);
        if (kind === "fork") assert.ok(o.length >= 2, `${where}: fork ${id} with one way out`);
      }
      // every node is reached from a start
      const seen = new Set(), stack = starts.map((n) => n[0]);
      while (stack.length) {
        const id = stack.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        for (const e of out.get(id) || []) stack.push(e.to);
      }
      for (const id of ids) assert.ok(seen.has(id), `${where}: ${id} cannot be reached from the start`);
      assert.equal(activitySteps(a).length, a.nodes.length);
    }
  }
});

/** "Class.member" (a class of the page, or one declared in the model's files) or "function" (of the model's files). */
function checkRef(ref, m, where) {
  const [owner, member] = ref.includes(".") ? ref.split(".") : [null, ref];
  const name = member.replace(/\(.*$/, "");
  if (!owner) {
    assert.ok(m.files.some((f) => hasOperation(name, f)), `${where}: no function ${name} in the files of model ${m.id}`);
    return;
  }
  const c = classOf(owner, m);
  if (c) {
    const files = c.kind === "module" ? [c.file] : classFiles(c, m);
    assert.ok(files.some((f) => hasOperation(name, f)), `${where}: ${owner} has no ${name} (${files.join(", ")})`);
    return;
  }
  const file = m.files.find((f) => declaration(owner, f));
  assert.ok(file, `${where}: no class ${owner} on the page or in the files of model ${m.id}`);
  assert.ok(hasOperation(name, file), `${where}: ${owner} has no ${name} (${file})`);
}

/**
 * The events of the world's event bus, from the code: names given to `events.emit`, to the helpers
 * `_emit` and `_visitEvent`, the terminal's constants (EV), and the events of the operations and
 * infrastructure engines, which their simulations pass on as `ops.*` and `infra.*`.
 * @returns {Map<string, Set<string>>} event → files that send it
 */
function sentEvents() {
  const sent = new Map();
  const add = (name, file) => {
    if (!sent.has(name)) sent.set(name, new Set());
    sent.get(name).add(file);
  };
  const framework = SOURCES.filter((f) => f.startsWith("web/") && f.endsWith(".js"));
  const ev = constTable("TERMINAL_EVENTS");
  for (const f of framework) {
    const t = read(f);
    for (const m of t.matchAll(/\bevents\.emit\(\s*["'`]([a-z][\w.-]*)["'`]/g)) add(m[1], f);
    for (const m of t.matchAll(/\b(?:_emit|_visitEvent)\(\s*["'`]([a-z][\w.-]*)["'`]/g)) add(m[1], f);
    if (f.startsWith("web/arail/terminal/") && !f.endsWith("types.js")) for (const [k, v] of Object.entries(ev)) if (new RegExp(`\\b(EV|TERMINAL_EVENTS)\\.${k}\\b`).test(t)) add(v, f);
    if (f.startsWith("web/arail/ops/")) for (const m of t.matchAll(/(?<!events)\.emit\(\s*["'`]([a-z][\w.-]*)["'`]/g)) add(`ops.${m[1]}`, f);
    if (f.startsWith("web/arail/infra/")) for (const m of t.matchAll(/\.events\(\s*["'`]([a-z][\w.-]*)["'`]/g)) add(`infra.${m[1]}`, f);
  }
  return sent;
}

test("events: the catalog is exactly the events sent, with the files that send them", () => {
  const sent = sentEvents();
  const listed = new Map(EVENTS.map((e) => [e.name, e]));
  assert.equal(listed.size, EVENTS.length, "duplicate events in the catalog");
  for (const [name, files] of sent) {
    assert.ok(listed.has(name), `the event ${name} (sent in ${[...files].join(", ")}) is not in the catalog (EVENTS)`);
    assert.deepEqual([...listed.get(name).from].sort(), [...files].sort(), `event ${name}: "from" must be the files that send it`);
  }
  for (const e of EVENTS) {
    if (e.kind === "request" || e.kind === "layout") continue; // listened to: sent by scenarios, plugins or the app
    assert.ok(sent.has(e.name), `the event ${e.name} of the catalog is sent nowhere`);
  }
  // the requests of the terminal are listened to
  for (const v of Object.values(constTable("TERMINAL_REQUESTS"))) assert.ok(listed.get(v)?.kind === "request", `the request ${v} is not in the catalog as a request`);
  // the models' events: sent or listened to in their own files
  for (const m of MODELS) {
    for (const e of m.events?.emits || []) {
      assert.ok(listed.has(e.name), `model ${m.id} sends ${e.name}, which is not in the catalog`);
      if (sent.has(e.name)) assert.ok([...sent.get(e.name)].some((f) => m.files.includes(f)), `model ${m.id} sends ${e.name}, but none of its files does`);
    }
    for (const e of m.events?.listens || []) {
      assert.ok(listed.has(e.name), `model ${m.id} listens to ${e.name}, which is not in the catalog`);
      const literal = new RegExp(`\\bon\\(\\s*["'\`]${esc(e.name)}["'\`]`);
      const constant = Object.entries({ ...constTable("TERMINAL_EVENTS"), ...constTable("TERMINAL_REQUESTS") }).find(([, v]) => v === e.name)?.[0];
      assert.ok(m.files.some((f) => literal.test(read(f)) || (constant && new RegExp(`\\bon\\(\\s*(EV|REQ|TERMINAL_EVENTS|TERMINAL_REQUESTS)\\.${constant}\\b`).test(read(f)))),
        `model ${m.id} listens to ${e.name}, but none of its files does (events.on)`);
    }
  }
});

/** A table of event names of the terminal (TERMINAL_EVENTS, TERMINAL_REQUESTS): key → name. */
function constTable(name) {
  const out = {};
  const block = read("web/arail/terminal/types.js").match(new RegExp(`export const ${name} = (?:Object\\.freeze\\()?\\{([^}]*)\\}`));
  assert.ok(block, `terminal/types.js: no ${name}`);
  for (const m of block[1].matchAll(/(\w+):\s*"([^"]+)"/g)) out[m[1]] = m[2];
  return out;
}

test("registry: exactly the registered simulations, object types, disruptions and vehicles", () => {
  const check = (kind, entries, map, nameOf) => {
    const listed = entries.filter((e) => !e.plugin);
    assert.deepEqual(listed.map((e) => e.type).sort(), [...map.keys()].sort(), `REGISTRY.${kind}: the types must be those registered by registerBuiltins`);
    for (const e of entries) {
      assert.ok(existsSync(join(ROOT, e.file)), `REGISTRY.${kind} ${e.type}: ${e.file} does not exist`);
      if (e.model) assert.ok(MODELS.some((m) => m.id === e.model && m.files.includes(e.file)), `REGISTRY.${kind} ${e.type}: model ${e.model} must exist and describe ${e.file}`);
      if (e.plugin) {
        assert.ok(new RegExp(`["'\`]${esc(e.type)}["'\`]`).test(read(e.file)), `REGISTRY.${kind} ${e.type}: not in ${e.file}`);
        continue;
      }
      const def = map.get(e.type);
      const name = nameOf(def);
      if (e.class) {
        assert.equal(e.class, name, `REGISTRY.${kind} ${e.type}: the class is ${name}`);
        assert.ok(declaration(e.class, e.file), `REGISTRY.${kind} ${e.type}: no class ${e.class} in ${e.file}`);
      } else assert.ok(new RegExp(`(type|kind):\\s*["'\`]${esc(e.type)}["'\`]`).test(read(e.file)), `REGISTRY.${kind} ${e.type}: not defined in ${e.file}`);
    }
  };
  check("simulations", REGISTRY.simulations, registry.simulations, (c) => c.name);
  check("objects", REGISTRY.objects, registry.objects, (c) => c.name);
  check("disruptions", REGISTRY.disruptions, registry.disruptions, () => null);
  check("vehicles", REGISTRY.vehicles, registry.vehicles, () => null);
  // the parameters of the disruption types
  for (const e of REGISTRY.disruptions.filter((x) => !x.plugin)) {
    const def = registry.disruptions.get(e.type);
    assert.equal(e.label, def.label, `disruption ${e.type}: label`);
    assert.deepEqual([...(e.params || [])].sort(), (def.params || []).map((p) => p.key).sort(), `disruption ${e.type}: params must be the keys of its parameters`);
  }
});

test("settings: the parameters of each simulation are its `static params`, with their defaults", () => {
  for (const [type, Sim] of registry.simulations) {
    const entry = REGISTRY.simulations.find((e) => e.type === type);
    const model = MODELS.find((m) => m.id === entry?.model);
    assert.ok(model, `simulation ${type}: REGISTRY.simulations needs the model that describes it`);
    const documented = (model.parameters || []).filter((p) => p.sim === type);
    const code = Sim.params || [];
    assert.deepEqual(documented.map((p) => p.key).sort(), code.map((p) => p.key).sort(), `simulation ${type}: the parameters (sim: "${type}") of model ${model.id} must be its static params`);
    for (const p of code) {
      const d = documented.find((x) => x.key === p.key);
      assert.equal(String(d.default), String(p.default), `simulation ${type}, ${p.key}: default ${p.default}`);
    }
  }
});

test("data flow: nodes and flows fit together; the code of each process exists", () => {
  const ids = new Set();
  for (const n of DATA_FLOW.nodes) {
    assert.ok(!ids.has(n.id), `data flow: duplicate node ${n.id}`);
    ids.add(n.id);
    assert.ok(["external", "process", "store"].includes(n.kind), `data flow: node ${n.id} kind ${n.kind}`);
    for (const f of n.files || []) assert.ok(existsSync(join(ROOT, f)), `data flow: node ${n.id}: ${f} does not exist`);
    if (n.kind === "process") assert.ok(n.files?.length, `data flow: process ${n.id} needs its files`);
  }
  for (const f of DATA_FLOW.flows) assert.ok(ids.has(f.from) && ids.has(f.to) && f.label, `data flow: flow ${f.from} → ${f.to}`);
  for (const id of ids) assert.ok(DATA_FLOW.flows.some((f) => f.from === id || f.to === id), `data flow: ${id} has no flow`);
});
