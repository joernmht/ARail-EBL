// EBL photo map: the survey photos of 9 October 2026 on a map of the lab (data.json, made from the
// survey), each opening as the photo or, where ARail has a layout for that part of the table, in the
// app with its digital layer (app/?layout=…&image=…). Coordinates are mm in the hall frame: x along the
// window wall towards Waldhof, y towards the windows (the SVG's y points down, so it is flipped).

const NS = "http://www.w3.org/2000/svg";
const svg = document.getElementById("map");
const el = (name, attrs = {}, parent = null) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
};

const data = await (await fetch("data.json")).json();
const photos = data.photos;
const dots = new Map();

/** Group frame → SVG transform (pose = [x, y, rotation deg] in the hall frame). */
const groupTransform = ([x, y, r]) => `translate(${x} ${-y}) rotate(${-r})`;

// the table: each marker group's orthophoto, with its outline (dashed where its place is estimated)
const tables = el("g", { "aria-hidden": "true" }, svg);
for (const [id, g] of Object.entries(data.groups)) {
  const gEl = el("g", { transform: groupTransform(g.pose) }, tables);
  if (g.ortho) {
    const [x0, y0, x1, y1] = g.ortho.bounds_mm;
    el("image", { href: g.ortho.image, x: x0, y: -y1, width: x1 - x0, height: y1 - y0, preserveAspectRatio: "none" }, gEl);
    el("rect", { class: `group-outline${g.approx ? " approx" : ""}`, x: x0, y: -y1, width: x1 - x0, height: y1 - y0 }, gEl);
  }
  gEl.dataset.group = id;
}

// place names: one label per place, at the mean of its photos
const labels = el("g", { "aria-hidden": "true", class: "labels" });  // appended after the dots: on top, not in the way
const byPlace = new Map();
for (const p of photos) (byPlace.get(p.place) || byPlace.set(p.place, []).get(p.place)).push(p);
const mean = (ps, k) => ps.reduce((s, p) => s + p[k], 0) / ps.length;
// labels that would cover each other: moved (mm, SVG y down)
const SHIFT = { "Door and swing bridge": [600, 2600], "Hairpin: Bk Klausenburg, Bk Feldberg": [-1200, 0], "Curve at the Neustadt end": [0, -500] };
for (const [place, ps] of byPlace) {
  const [dx, dy] = SHIFT[place] || [0, 0];
  const t = el("text", { class: "group-label", x: mean(ps, "x") + dx, y: -mean(ps, "y") - 700 + dy, "text-anchor": "middle" }, labels);
  t.textContent = place;
}
const uppers = new Map();
for (const p of photos) if (p.upper) (uppers.get(p.upper) || uppers.set(p.upper, []).get(p.upper)).push(p);
for (const [name, ps] of uppers) {
  const t = el("text", { class: "upper-label", x: mean(ps, "x"), y: -Math.max(...ps.map((p) => p.y)) - 1500, "text-anchor": "middle" }, labels);
  t.textContent = `Stadtbahn: ${name}`;
}

// the photos
const shots = el("g", {}, svg);
svg.append(labels);
photos.forEach((p, i) => {
  const a = el("g", { class: `shot${p.layer ? " layer" : ""}`, role: "button", tabindex: "0",
    "aria-label": `${p.place}, ${p.time}${p.layer ? ", with digital layer" : ""}`, transform: `translate(${p.x} ${-p.y})` }, shots);
  if (p.heading !== null && p.heading !== undefined) el("path", { d: "M 0 -70 L 300 0 L 0 70 Z", transform: `rotate(${-p.heading})` }, a);
  el("circle", { r: 120 }, a);
  a.addEventListener("click", () => open(i));
  a.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(i); } });
  dots.set(i, a);
});

// lists by place (also the way to the photos without a pointer)
const lists = document.getElementById("lists");
for (const [place, ps] of byPlace) {
  const d = document.createElement("details");
  const s = document.createElement("summary");
  s.textContent = `${place} (${ps.length})`;
  const ul = document.createElement("ul");
  for (const p of ps) {
    const li = document.createElement("li"), b = document.createElement("button");
    b.type = "button"; b.textContent = p.time + (p.layer ? " · layer" : "");
    if (p.layer) b.className = "layer";
    b.addEventListener("click", () => open(photos.indexOf(p)));
    li.append(b); ul.append(li);
  }
  d.append(s, ul); lists.append(d);
}

// view box: pan and zoom
const all = (() => {
  const xs = [], ys = [];
  for (const g of Object.values(data.groups)) { xs.push(g.pose[0] - 3000, g.pose[0] + 3000); ys.push(-g.pose[1] - 2500, -g.pose[1] + 1500); }
  for (const p of photos) { xs.push(p.x); ys.push(-p.y); }
  const x0 = Math.min(...xs), y0 = Math.min(...ys) - 1200;
  return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0 + 600];
})();
let vb = [...all];
const setVb = () => svg.setAttribute("viewBox", vb.map((v) => v.toFixed(0)).join(" "));
// the map's height follows the hall's shape; a phone starts closer in (about 9 m of the table)
const box = svg.getBoundingClientRect();
svg.style.height = `${Math.round(Math.min(Math.max(280, box.width * all[3] / all[2]), innerHeight * 0.62))}px`;
if (box.width < 700) {
  const w = 9000, h = w * svg.getBoundingClientRect().height / box.width, ns = byPlace.get("Neustadt") || photos;
  vb = [mean(ns, "x") - w / 2, -mean(ns, "y") - h / 2, w, h];
}
setVb();
const zoom = (f, cx = vb[0] + vb[2] / 2, cy = vb[1] + vb[3] / 2) => {
  const w = Math.min(all[2] * 1.5, Math.max(1500, vb[2] * f)), h = w * vb[3] / vb[2], s = w / vb[2];
  vb = [cx - (cx - vb[0]) * s, cy - (cy - vb[1]) * s, w, h]; setVb();
};
document.getElementById("zoomIn").addEventListener("click", () => zoom(0.6));
document.getElementById("zoomOut").addEventListener("click", () => zoom(1 / 0.6));
document.getElementById("zoomAll").addEventListener("click", () => { vb = [...all]; setVb(); });
const toSvg = (e) => { const r = svg.getBoundingClientRect(), s = Math.max(vb[2] / r.width, vb[3] / r.height);
  return [vb[0] + (e.clientX - r.left - (r.width - vb[2] / s) / 2) * s, vb[1] + (e.clientY - r.top - (r.height - vb[3] / s) / 2) * s, s]; };
svg.addEventListener("wheel", (e) => { e.preventDefault(); const [x, y] = toSvg(e); zoom(e.deltaY > 0 ? 1.2 : 1 / 1.2, x, y); }, { passive: false });
// drag with one pointer, pinch with two
let drag = null;
const pointers = new Map();
let pinch = null;
svg.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".shot") && !pointers.size) return; // a tap on a dot opens it
  pointers.set(e.pointerId, e); svg.setPointerCapture(e.pointerId);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), w: vb[2] }; drag = null;
  } else { drag = { x: e.clientX, y: e.clientY, vb: [...vb], s: toSvg(e)[2] }; svg.classList.add("dragging"); }
});
svg.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, e);
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const [x, y] = toSvg({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 });
    zoom((pinch.w * pinch.d / Math.max(d, 1)) / vb[2], x, y);
  } else if (drag) { vb = [drag.vb[0] - (e.clientX - drag.x) * drag.s, drag.vb[1] - (e.clientY - drag.y) * drag.s, vb[2], vb[3]]; setVb(); }
});
const endDrag = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) { drag = null; svg.classList.remove("dragging"); } };
svg.addEventListener("pointerup", endDrag);
svg.addEventListener("pointercancel", endDrag);

// the viewer
const dlg = document.getElementById("viewer");
const img = document.getElementById("viewerImg");
const layerLink = document.getElementById("viewerLayer"), noLayer = document.getElementById("viewerNoLayer");
let current = -1;
function open(i) {
  current = (i + photos.length) % photos.length;
  const p = photos[current];
  for (const d of dots.values()) d.classList.remove("current");
  dots.get(current).classList.add("current");
  img.src = p.image;
  img.alt = `Photo of the layout at ${p.place}, ${p.time}`;
  document.getElementById("viewerTitle").textContent = `${p.place} · ${p.time}`;
  const bits = [];
  if (p.upper) bits.push(`Stadtbahn above: ${p.upper}`);
  if (p.km.length) bits.push(`km tags read: ${p.km.join(", ")}`);
  if (p.approx) bits.push("place on the map estimated");
  document.getElementById("viewerMeta").textContent = bits.join(" · ");
  const layer = p.layer && data.layers[p.layer];
  layerLink.hidden = !layer; noLayer.hidden = !!layer;
  if (layer) {
    layerLink.href = `../app/?layout=${encodeURIComponent(layer.layout)}&image=${encodeURIComponent(`../lab-map/${p.image}`)}`;
    layerLink.textContent = `Open with the digital layer (${layer.label})`;
  }
  document.getElementById("viewerFull").href = p.image;
  if (!dlg.open) dlg.showModal();
}
document.getElementById("viewerPrev").addEventListener("click", () => open(current - 1));
document.getElementById("viewerNext").addEventListener("click", () => open(current + 1));
document.getElementById("viewerClose").addEventListener("click", () => dlg.close());
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
dlg.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") open(current + 1);
  else if (e.key === "ArrowLeft") open(current - 1);
});

// ?photo=<id>: open that photo (links from elsewhere)
const want = new URLSearchParams(location.search).get("photo");
if (want) { const i = photos.findIndex((p) => p.id === want); if (i >= 0) open(i); }
