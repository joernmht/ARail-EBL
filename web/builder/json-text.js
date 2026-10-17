// Files the builder pushes change only where the layout changed: the changes are merged into the
// file's own JSON (not the defaults the world fills in), and the new JSON is written into the
// file's own text: what did not change keeps its text, what is new is written like its
// neighbours (one object per line, or one value per line, with their spaces). So a moved bus stop
// is one changed line in the commit. No DOM here: tested in Node.

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Are two JSON values the same (keys in any order)? */
export function sameJSON(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => sameJSON(v, b[i]));
  if (isObject(a)) {
    if (!isObject(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && sameJSON(a[k], b[k]));
  }
  return false;
}

/** Arrays of objects that all have an id (the objects of a layout, its layers). */
const byId = (arr) => Array.isArray(arr) && arr.length > 0 && arr.every((v) => isObject(v) && typeof v.id === "string");

/**
 * The file's JSON with the changes made since it was opened: `baseline` is what the editor had
 * then (the file with its defaults filled in), `current` what it has now. Where `current` equals
 * `baseline` the file's own value stays (also where the file had none); objects in arrays with
 * ids are matched by id.
 * @param {*} original the file's JSON
 * @param {*} baseline
 * @param {*} current
 */
export function mergeChanges(original, baseline, current) {
  if (sameJSON(baseline, current)) return original;
  if (current === undefined) return undefined;
  if (isObject(current) && isObject(baseline) && isObject(original)) {
    const out = {};
    // the file's keys in their order, then the new ones
    const keys = [...Object.keys(original).filter((k) => Object.hasOwn(current, k)), ...Object.keys(current).filter((k) => !Object.hasOwn(original, k))];
    for (const k of keys) {
      const v = mergeChanges(original[k], baseline[k], current[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (Array.isArray(current) && byId(current) && Array.isArray(original) && byId(original) && byId(baseline)) {
    const o = new Map(original.map((v) => [v.id, v])), b = new Map(baseline.map((v) => [v.id, v]));
    return current.map((v) => (o.has(v.id) && b.has(v.id) ? mergeChanges(o.get(v.id), b.get(v.id), v) : idFirst(v)));
  }
  return current;
}

/** A new object with its id, type and name first, as in the files. */
function idFirst(v) {
  const head = ["id", "type", "name"].filter((k) => Object.hasOwn(v, k));
  return Object.fromEntries([...head, ...Object.keys(v).filter((k) => !head.includes(k))].map((k) => [k, v[k]]));
}

/* ---------------------------------------------------------------- the text */

/**
 * Parse JSON text and keep where each value is: {kind, start, end, value, members | items}.
 * kind: "object" (members: [{key, node}]), "array" (items: [node]) or "value".
 */
export function parseText(text) {
  let i = 0;
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const fail = (what) => {
    throw new SyntaxError(`JSON: ${what} at ${i}`);
  };
  const value = () => {
    ws();
    const start = i, c = text[i];
    if (c === "{") {
      i++;
      const members = [];
      ws();
      if (text[i] === "}") i++;
      else {
        for (;;) {
          ws();
          if (text[i] !== '"') fail("a key expected");
          const kStart = i;
          const key = str();
          ws();
          if (text[i] !== ":") fail("':' expected");
          i++;
          members.push({ key, keyStart: kStart, node: value() });
          ws();
          if (text[i] === ",") i++;
          else if (text[i] === "}") {
            i++;
            break;
          } else fail("',' or '}' expected");
        }
      }
      return { kind: "object", start, end: i, members, value: Object.fromEntries(members.map((m) => [m.key, m.node.value])) };
    }
    if (c === "[") {
      i++;
      const items = [];
      ws();
      if (text[i] === "]") i++;
      else {
        for (;;) {
          items.push(value());
          ws();
          if (text[i] === ",") i++;
          else if (text[i] === "]") {
            i++;
            break;
          } else fail("',' or ']' expected");
        }
      }
      return { kind: "array", start, end: i, items, value: items.map((n) => n.value) };
    }
    if (c === '"') {
      const v = str();
      return { kind: "value", start, end: i, value: v };
    }
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 40));
    if (!m) fail("a value expected");
    i += m[0].length;
    return { kind: "value", start, end: i, value: JSON.parse(m[0]) };
  };
  const str = () => {
    const start = i;
    i++;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i));
  };
  const root = value();
  ws();
  if (i < text.length) fail("end of text expected");
  return root;
}

/** The indentation of the line a position is on. */
function indentAt(text, pos) {
  const line = text.lastIndexOf("\n", pos - 1) + 1;
  return /^[ \t]*/.exec(text.slice(line))[0];
}

/**
 * How a container is written: on several lines (with the indent of its children and of its closing
 * bracket) or on one (with or without spaces inside the brackets, ", " or ",", ": " or ":").
 */
function styleOf(text, node) {
  const src = text.slice(node.start, node.end);
  const children = node.kind === "object" ? node.members.map((m) => ({ start: m.keyStart })) : node.items;
  if (src.includes("\n") && children.length) {
    return { multi: true, indent: indentAt(text, children[0].start), close: indentAt(text, node.end - 1), colon: /"\s*:\s/.test(src) ? ": " : ":" };
  }
  const pad = /^[{[] /.test(src) && children.length ? " " : "";
  return {
    multi: false,
    // spaces inside the brackets: of objects, or of arrays
    ...(node.kind === "object" ? { pad } : { arrPad: pad }),
    comma: /,\s/.test(src) || !/,/.test(src) ? ", " : ",",
    colon: node.kind === "object" && /"\s*:\s/.test(src) ? ": " : node.kind === "object" ? ":" : ": ",
  };
}

const INLINE = { multi: false, pad: "", arrPad: "", comma: ", ", colon: ": " };

/** A new value written on one line in a style. */
function inline(v, style = INLINE) {
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    const pad = style.arrPad || "";
    return `[${pad}${v.map((x) => inline(x, style)).join(style.comma)}${pad}]`;
  }
  if (isObject(v)) {
    const keys = Object.keys(v), pad = style.pad || "";
    if (!keys.length) return "{}";
    return `{${pad}${keys.map((k) => `${JSON.stringify(k)}${style.colon}${inline(v[k], style)}`).join(style.comma)}${pad}}`;
  }
  return JSON.stringify(v);
}

/** Of the items of an array (or the values of an object), the one written like a new value should be: the last container. */
function exampleOf(nodes) {
  for (let k = nodes.length - 1; k >= 0; k--) if (nodes[k] && nodes[k].kind !== "value") return nodes[k];
  return null;
}

/**
 * Write a value like `node` was written (node: where the old value is in `text`, or null for a new
 * value, then like `like`, a sibling).
 */
function write(text, node, v, like = null, indent = "") {
  if (node && sameJSON(node.value, v)) return text.slice(node.start, node.end);
  const kind = Array.isArray(v) ? "array" : isObject(v) ? "object" : "value";
  if (kind === "value") return JSON.stringify(v);
  const model = node && node.kind === kind ? node : like && like.kind === kind ? like : null;
  if (!model) return kind === "object" && Object.keys(v).length > 3 ? writeMulti(text, null, v, { indent: `${indent}  `, close: indent, colon: ": " }) : inline(v);
  const style = styleOf(text, model);
  if (!style.multi) {
    if (node && node.kind === kind) return writeInline(text, node, v, style);
    return inline(v, style);
  }
  // a sibling's indent is relative to its line: the same for this one
  return writeMulti(text, node && node.kind === kind ? node : null, v, model === node ? style : { ...style, indent: indent + style.indent.slice(indentAt(text, model.start).length), close: indent });
}

/** On one line, keeping the text of what did not change. */
function writeInline(text, node, v, style) {
  if (Array.isArray(v)) {
    const old = matchItems(node, v), pad = style.arrPad || "";
    if (!v.length) return "[]";
    return `[${pad}${v.map((x, i) => (old[i] && sameJSON(old[i].value, x) ? text.slice(old[i].start, old[i].end) : old[i] ? writeInline(text, old[i], x, styleOfOr(text, old[i], style)) : inline(x, style))).join(style.comma)}${pad}]`;
  }
  if (isObject(v)) {
    const old = new Map((node.members || []).map((m) => [m.key, m.node]));
    const keys = orderKeys(node, v), pad = style.pad || "";
    if (!keys.length) return "{}";
    return `{${pad}${keys.map((k) => {
      const o = old.get(k), x = v[k];
      const val = o && sameJSON(o.value, x) ? text.slice(o.start, o.end) : o && o.kind !== "value" && (Array.isArray(x) || isObject(x)) ? writeInline(text, o, x, styleOfOr(text, o, style)) : inline(x, style);
      return `${JSON.stringify(k)}${style.colon}${val}`;
    }).join(style.comma)}${pad}}`;
  }
  return JSON.stringify(v);
}

const styleOfOr = (text, node, fallback) => {
  const s = node.kind === "value" ? fallback : styleOf(text, node);
  return s.multi ? fallback : { ...fallback, ...s };
};

/** Over several lines, keeping the text of what did not change. */
function writeMulti(text, node, v, style) {
  const { indent, close, colon } = style;
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    const old = node ? matchItems(node, v) : [];
    const like = node ? exampleOf(node.items) : null;
    return `[\n${v.map((x, i) => indent + write(text, old[i] || null, x, like, indent)).join(",\n")}\n${close}]`;
  }
  const keys = node ? orderKeys(node, v) : Object.keys(v);
  if (!keys.length) return "{}";
  const old = new Map((node?.members || []).map((m) => [m.key, m.node]));
  const like = node ? exampleOf(node.members.map((m) => m.node)) : null;
  return `{\n${keys.map((k) => `${indent}${JSON.stringify(k)}${colon}${write(text, old.get(k) || null, v[k], like, indent)}`).join(",\n")}\n${close}}`;
}

/** The keys of a new object: those it had, in their order, then the new ones. */
function orderKeys(node, v) {
  const had = (node.members || []).map((m) => m.key);
  return [...had.filter((k) => Object.hasOwn(v, k)), ...Object.keys(v).filter((k) => !had.includes(k))];
}

/** For each item of the new array, the old item it was (by id, else at the same place), or null. */
function matchItems(node, v) {
  const items = node.items || [];
  if (byId(v) && byId(items.map((n) => n.value))) {
    const m = new Map(items.map((n) => [n.value.id, n]));
    return v.map((x) => m.get(x.id) || null);
  }
  return v.map((x, i) => {
    const same = items.find((n) => sameJSON(n.value, x));
    return same || items[i] || null;
  });
}

/**
 * The text of a file with a new value: what did not change keeps its text, the rest is written
 * like its neighbours. The text of an unchanged value is the file itself.
 * @param {string} text the file as it is
 * @param {*} value its new JSON
 */
export function stringifyLike(text, value) {
  let root;
  try {
    root = parseText(text);
  } catch {
    return `${JSON.stringify(value, null, 2)}\n`;
  }
  const lead = text.slice(0, root.start), tail = text.slice(root.end);
  return lead + write(text, root, value) + tail;
}

/**
 * The text of a new file, written like the layouts: a key per line, the objects (and other lists
 * of objects) one per line.
 */
export function formatNew(json) {
  const lines = Object.entries(json).filter(([, v]) => v !== undefined).map(([k, v]) => {
    const key = JSON.stringify(k);
    if (Array.isArray(v) && v.length && v.some(isObject)) return `  ${key}: [\n${v.map((x) => `    ${inline(x)}`).join(",\n")}\n  ]`;
    if (isObject(v) && Object.keys(v).length > 3) return `  ${key}: {\n${Object.entries(v).map(([k2, x]) => `    ${JSON.stringify(k2)}: ${inline(x)}`).join(",\n")}\n  }`;
    return `  ${key}: ${inline(v)}`;
  });
  return `{\n${lines.join(",\n")}\n}\n`;
}

