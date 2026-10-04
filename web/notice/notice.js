// Printable sign for the layout: what the marker stickers are, why they must stay where they are,
// what the app does not do, and a QR code to try it. The settings live in the address, so a filled-in
// sign can be shared as a link.

const $ = (id) => document.getElementById(id);

export const TEXTS = {
  de: {
    title: "Was sind die schwarz-weißen Quadrate?",
    lead: "Es sind Positionsmarker, ähnlich wie QR-Codes. An ihnen erkennt ein Handy, Tablet oder eine Webcam, wo es über der Anlage ist, und legt virtuelle Objekte genau auf die echte Anlage.",
    photoAlt: "Die Anlage durch die App gesehen: Züge an beiden Bahnsteigen mit wartenden Reisenden, Abfahrtstafeln, ein Bahnhofsgebäude und Plattenbauten hinter den Gleisen.",
    caption: "So sieht die Anlage durch die App aus: Reisende, Abfahrtstafeln, ein Bahnhof und eine Stadt, virtuell auf der echten H0-Anlage.",
    whyTitle: "Wozu?",
    why: "Für Lehre und Übungen: Bahnsteige mit Reisenden, eine Stadt mit Straßen und Buslinien, ein Containerterminal, Fahrzeuginstandhaltung, Personaleinsatz und Infrastruktur als Planspiel, Störungen im Betrieb. Alles auf der echten Anlage, im Browser, ohne Installation.",
    notTitle: "Was die Marker nicht tun",
    notControl: "Sie greifen nicht in den Bahnbetrieb ein. Die App schickt keine Befehle an Stellwerk oder Steuerung, sie liest höchstens Zugpositionen.",
    notCamera: "Das Kamerabild bleibt auf dem Gerät: nichts wird hochgeladen. Aufgenommen wird nur, wenn man selbst auf Aufnahme tippt, und dann nur auf das eigene Gerät.",
    removable: "Ablösbare Etiketten: sie lassen sich rückstandsfrei wieder entfernen.",
    keepTitle: "Bitte nicht verschieben, ablösen oder neu aufkleben.",
    keep: "Jeder Marker ist eingemessen. Ein verschobener Marker verfälscht das Bild für alle, und man sieht es ihm nicht an. Auch zum Putzen bitte liegen lassen.",
    loose: "Hat sich einer gelöst?",
    looseDo: "Bitte nicht selbst wieder aufkleben, sondern liegen lassen und Bescheid geben.",
    tryTitle: "Selbst ausprobieren",
    try: "Code scannen, die App öffnen und die Kamera von oben auf die Anlage richten.",
    contactTitle: "Fragen, Bedenken, lose Marker:",
    contactMissing: "Kontakt eintragen",
    until: (v) => `Die Marker bleiben bis ${v}.`,
    approved: (v) => `Abgestimmt mit ${v}.`,
    foot: "Danke, dass Sie die Marker liegen lassen!",
  },
  en: {
    title: "What are the black-and-white squares?",
    lead: "They are position markers, a bit like QR codes. From them a phone, tablet or webcam knows where it is above the layout, and puts virtual objects exactly onto the real layout.",
    photoAlt: "The layout seen through the app: trains at both platforms with waiting passengers, departure boards, a station building and Plattenbau behind the tracks.",
    caption: "The layout seen through the app: passengers, departure boards, a station and a town, virtual on the real H0 layout.",
    whyTitle: "What for?",
    why: "For teaching and exercises: platforms with passengers, a town with streets and bus lines, a container terminal, rolling stock maintenance, crews and infrastructure as a game, disruptions in operation. All on the real layout, in the browser, with nothing to install.",
    notTitle: "What the markers do not do",
    notControl: "They do not touch railway operation. The app sends no commands to the interlocking or the control system; at most it reads train positions.",
    notCamera: "The camera image stays on the device: nothing is uploaded. Nothing is recorded unless you tap record yourself, and then only onto your own device.",
    removable: "Removable labels: they come off again without residue.",
    keepTitle: "Please do not move, peel off or re-stick them.",
    keep: "Every marker has been measured. A moved marker spoils the picture for everybody, and you cannot tell by looking at it. Please leave them in place when cleaning, too.",
    loose: "One came loose?",
    looseDo: "Please do not stick it back yourself: leave it there and let us know.",
    tryTitle: "Try it yourself",
    try: "Scan the code, open the app and point the camera down at the layout.",
    contactTitle: "Questions, concerns, loose markers:",
    contactMissing: "add a contact",
    until: (v) => `The markers stay until ${v}.`,
    approved: (v) => `Agreed with ${v}.`,
    foot: "Thank you for leaving the markers in place!",
  },
};

const PAPER = { a4: { size: "A4", zoom: 1 }, a3: { size: "A3", zoom: Math.SQRT2 } };
const FIELDS = ["lang", "paper", "lab", "contact", "until", "approved"];

function readAddress() {
  const q = new URLSearchParams(location.search);
  for (const id of FIELDS) {
    const v = q.get(id);
    if (v == null) continue;
    const el = $(id);
    if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === v)) continue;
    el.value = v;
  }
  if (q.has("removable")) $("removable").checked = q.get("removable") !== "0";
}

function writeAddress() {
  const q = new URLSearchParams();
  for (const id of FIELDS) {
    const v = $(id).value.trim();
    if (v && v !== $(id).defaultValue && !(id === "lang" && v === "de") && !(id === "paper" && v === "a4")) q.set(id, v);
  }
  if (!$("removable").checked) q.set("removable", "0");
  const s = q.toString();
  history.replaceState(null, "", s ? `?${s}` : location.pathname);
}

function render() {
  const lang = $("lang").value;
  const t = TEXTS[lang];
  const sheet = $("sheet");
  sheet.lang = lang;
  for (const el of sheet.querySelectorAll("[data-t]")) el.textContent = t[el.dataset.t];
  for (const el of sheet.querySelectorAll("[data-t-alt]")) el.alt = t[el.dataset.tAlt];
  $("sLab").textContent = $("lab").value.trim() || "ARail";
  $("sRemovable").hidden = !$("removable").checked;

  const contact = $("contact").value.trim();
  const who = $("sContact");
  who.textContent = contact || `[${t.contactMissing}]`;
  who.classList.toggle("missing", !contact);
  const until = $("until").value.trim(), approved = $("approved").value.trim();
  $("sUntil").textContent = until ? t.until(until) : "";
  $("sUntil").hidden = !until;
  $("sApproved").textContent = approved ? t.approved(approved) : "";
  $("sApproved").hidden = !approved;

  const paper = PAPER[$("paper").value];
  $("pageSize").textContent = `@page { size: ${paper.size}; margin: 0; }`;
  sheet.style.setProperty("--print-zoom", paper.zoom);
  $("status").textContent = contact ? "" : "Enter a contact before printing: the sign asks people to report loose markers.";
  writeAddress();
  fit();
}

/** Zooms the A4 sheet to the width of the preview column on screen. */
function fit() {
  const sheet = $("sheet");
  const mm = 96 / 25.4;
  const avail = $("preview").clientWidth;
  sheet.style.setProperty("--fit", Math.min(1, avail / (210 * mm)).toFixed(4));
}

readAddress();
$("settings").addEventListener("input", render);
$("settings").addEventListener("change", render);
$("settings").addEventListener("submit", (e) => e.preventDefault());
$("print").addEventListener("click", () => window.print());
new ResizeObserver(fit).observe($("preview"));
render();
