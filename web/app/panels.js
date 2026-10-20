// Panels: Settings (view, simulation and control system), Disruptions.
import { UI_LANGUAGES, CD, checkSection, COMPATIBILITY, moodColor, boardStatus, decodeTag, encodeTag, formatTime, MockFeed, PURPOSE_COLOURS, PURPOSE_LABELS, TRIP_PARTS, sectionSystems, SYSTEM_OVERLAYS, systemValue, terminalOf, WebSocketFeed } from "../arail/index.js";
import { download, h, morph, mount, paramFields, readFile, section, storage, toast } from "./ui.js";
import { tr } from "./i18n.js";

const SPEEDS = [1, 2, 5, 10, 30];
/** Fast-clock ratios offered in Settings → Simulation. */
const CLOCK_FACTORS = [1, 4, 6, 12, 24, 60];
const TIME_PRESETS = [["Morning", "06:30"], ["Noon", "12:00"], ["Evening", "17:00"], ["Night", "22:30"]];
/** The views of the Settings panel. */
const SETTINGS_VIEWS = [["view", "View"], ["simulate", "Simulation"], ["control", "Control system"]];
/** "Platform 1, Track G2" for the id of a platform's track (a dock, "platform-1:left"), or null. */
const trackName = (world, id) => {
  for (const a of world.stopAreas()) for (const k of a.docks) if (k.id === id) return `${a.owner.name}, ${k.label}`;
  return null;
};

export class Panels {
  constructor(app) {
    this.app = app;
    this.disruptionDraft = { type: "delay", target: "*", params: {} };
    /** The view of the Settings panel: "view", "simulate" or "control". */
    this.settingsView = SETTINGS_VIEWS.some(([v]) => v === storage.get("arail.settingsView")) ? storage.get("arail.settingsView") : "view";
  }

  get world() {
    return this.app.world;
  }

  /* ================================================================ View (a view of Settings) */

  /** Settings → View: the examples, what is shown, the grid, the camera, recording, the language. */
  renderView(el) {
    const app = this.app, s = app.world.settings, d = app.display, g = app.world.layout.grid;
    // a control that had the focus (e.g. the box of a module just switched) gets it back in the new panel
    const focused = el.contains(document.activeElement) ? document.activeElement.id : null;
    const toggle = (id, label, get, set) => h("label", { class: "field check", for: id },
      h("input", { type: "checkbox", id, checked: get(), onchange: (e) => { set(e.target.checked); app.savePrefs(); } }), label);
    const placing = () => { app.saveLayout(); app.updateHud(); app.editor.renderPlacing(); };
    const sizes = [...new Set([10, 25, 50, 100, 250, g.size_mm])].sort((a, b) => a - b);
    this.viewInfo = h("dl", { class: "kv" });
    this.focalRow = h("div", { class: "row" });
    mount(el,
      // the app: the photo tour on the stage chooses what is shown; the examples with a clip, a tab or a layout of their own are here
      app.tourNav ? section("Examples",
        h("div", { class: "row examples" }, app.page.examples.map((x) => h("button", { class: "btn small", type: "button", id: `example-${x.id}`, onclick: () => app.openExample(x.id) }, x.label)))) : null,
      section("Show",
        h("div", { class: "fields" },
          toggle("optLabels", "Signs and boards", () => s.labels, (v) => (s.labels = v)),
          toggle("optStopBoards", "Departure boards at the stops", () => !!s.stopBoards, (v) => (s.stopBoards = v)),
          toggle("optTrails", "Walking trails", () => s.trails, (v) => (s.trails = v)),
          toggle("optSpaceCircles", "The room people take", () => !!s.spaceCircles, (v) => (s.spaceCircles = v)),
          toggle("optMarkers", "Marker outlines", () => d.markers, (v) => (d.markers = v)),
          toggle("optCoverMarkers", "Cover the markers", () => s.coverMarkers, (v) => (s.coverMarkers = v)),
          toggle("optTracks", "Tracks", () => s.showTracks, (v) => (s.showTracks = v)),
        ),
        h("label", { class: "field", for: "optOpacity" }, h("span", {}, "Opacity of virtual objects"),
          h("input", { type: "range", id: "optOpacity", min: 0.2, max: 1, step: 0.05, value: d.opacity, oninput: (e) => { d.opacity = Number(e.target.value); app.savePrefs(); } })),
        h("div", { class: "fields" },
          h("label", { class: "field", for: "optTrackSystems" }, h("span", {}, "Colour the tracks by"),
            h("select", { id: "optTrackSystems", onchange: (e) => { s.trackSystems = e.target.value; app.savePrefs(); this.renderView(el); } },
              [["", "nothing"], ...SYSTEM_OVERLAYS, ...(app.world.compatibilityTrain ? [[COMPATIBILITY, `where ${app.world.compatibilityTrain.name} may run`]] : [])]
                .map(([v, t]) => h("option", { value: v, selected: (s.trackSystems || "") === v }, t)))),
          h("label", { class: "field", for: "peopleColour" }, h("span", {}, "Colour of people"),
            h("select", { id: "peopleColour", onchange: (e) => { s.peopleColour = e.target.value; app.savePrefs(); } },
              [["auto", "town: purpose of the trip; passengers: mood"], ["purpose", "purpose of the trip"], ["mood", "mood"]].map(([v, t]) => h("option", { value: v, selected: (s.peopleColour || "auto") === v }, t)))),
        ),
        this._systemsLegend(),
      ),
      section("Grid",
        h("div", { class: "fields" },
          h("label", { class: "field", for: "gridSize" }, h("span", {}, "Grid spacing"),
            h("select", { id: "gridSize", onchange: (e) => { g.size_mm = Number(e.target.value); placing(); } },
              sizes.map((v) => h("option", { value: v, selected: v === g.size_mm }, `${v} mm`)))),
          toggle("optSnap", "Snap to the grid", () => g.snap, (v) => { g.snap = v; placing(); }),
          toggle("optGridCamera", "Grid in camera view", () => !!d.gridInCamera, (v) => (d.gridInCamera = v)),
          toggle("optFlyMarkers", "Markers in the flyover", () => d.flyMarkers !== false, (v) => (d.flyMarkers = v)),
        ),
      ),
      section("Camera",
        h("div", { class: "field" }, h("span", {}, "Focal length"), this.focalRow),
        h("div", { class: "row" },
          h("label", { class: "btn small", for: "calibrationFile" }, "Load calibration"),
          h("input", { type: "file", id: "calibrationFile", accept: ".json,application/json", class: "visually-hidden", onchange: (e) => this._loadCalibration(e) }),
          h("button", { class: "btn small", type: "button", onclick: () => { app.camera.setCalibration(null); storage.remove("arail.calibration"); toast("Calibration removed."); } }, "Remove calibration"),
          h("button", { class: "btn small", type: "button", id: "btnRecord", "aria-pressed": app.recorder ? "true" : "false", onclick: () => app.toggleRecording() }, "Record video of the stage"),
        ),
        h("details", { class: "tracking" }, h("summary", {}, "Tracking details"), this.viewInfo),
      ),
      section("Language",
        h("label", { class: "field", for: "optLanguage" }, h("span", { class: "visually-hidden" }, "Language of the app"),
          h("select", { id: "optLanguage", onchange: (e) => app.changeLanguage(e.target.value) },
            Object.entries(UI_LANGUAGES).map(([v, name]) => h("option", { value: v, lang: v, translate: "no", selected: app.language === v }, name)))),
      ),
    );
    this.updateView();
    if (focused) document.getElementById(focused)?.focus();
  }

  /** Draw Settings → View again if it is shown (a key pressed, a track colouring chosen on a card). */
  renderViewIfShown() {
    if (this.app.activeTab === "settings" && this.settingsView === "view" && this.settingsBody?.isConnected) this.renderView(this.settingsBody);
  }

  /** The legend of Settings → View → Colour the tracks by: each value on the layout's tracks, with its colour and how many tracks have it. */
  _systemsLegend() {
    const key = this.world.settings.trackSystems;
    if (!key) return null;
    const tracks = this.world.objects.filter((o) => o.type === "track");
    if (!tracks.length) return h("p", { class: "hint" }, "This layout has no tracks: add them in Build → Infrastructure → Track.");
    const seen = new Map();
    const train = this.world.compatibilityTrain;
    if (key === COMPATIBILITY && !train) return h("p", { class: "hint" }, "Tap a train and press “Show where it may run” on its card.");
    for (const t of tracks) {
      const v = key === COMPATIBILITY
        ? (checkSection(train.consist, t.spec).ok ? { label: `${train.name} may run`, colour: CD.tuerkis } : { label: `${train.name} may not run`, colour: CD.rot })
        : systemValue(key, sectionSystems(t.spec).values[key]);
      seen.set(v.label, { v, n: (seen.get(v.label)?.n || 0) + 1 });
    }
    return h("ul", { class: "legend-list", "aria-label": "Colours of the tracks" },
      [...seen.values()].map(({ v, n }) => h("li", {}, h("span", { class: "swatch", style: { background: v.colour }, "aria-hidden": "true" }), v.label, h("b", {}, `${n} track${n === 1 ? "" : "s"}`))));
  }

  async _loadCalibration(e) {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const json = JSON.parse(await readFile(f));
      const ok = this.app.camera.setCalibration(json);
      storage.set("arail.calibration", json);
      toast(ok ? "Calibration loaded." : "Calibration loaded, but it was made for another image shape; it is used when the image shape matches.");
    } catch (err) {
      toast(`This is not a calibration file: ${err.message}`);
    }
  }

  updateView() {
    if (!this.viewInfo) return;
    const app = this.app, st = app.tracker.state, cam = app.camera, map = app.world.map;
    const rows = [
      ["Source", app.source ? `${app.source.name} (${app.source.w} × ${app.source.h})` : "none"],
      ["Markers seen", st.visible.length ? st.visible.join(", ") : "none"],
      ["Used for the pose", st.used.length ? `${st.used.join(", ")}${st.holding ? " (holding last pose)" : ""}` : "–"],
      ["Marker map", `${map.ids().length} markers${map.locked ? " (locked)" : ""}`],
      ...(map.moving.size ? [["Moving markers", Object.keys(st.moving || {}).length ? `${Object.keys(st.moving).join(", ")} in view` : "none in view"]] : []),
      ["Marker type", app.detector?.dictionaryLabel ? `${app.detector.dictionaryLabel}${app.detector.autoDetecting ? " (detecting…)" : ""}` : "detecting…"],
      ...this._rollingRows(),
      ["Reprojection error", st.used.length ? `${st.rms.toFixed(2)} px` : "–"],
      ["Frame rate", app.source && app.source.kind !== "image" ? `${app.fps.toFixed(0)} fps, detection at ${Math.round(app.procMax)} px` : "–"],
    ];
    morph(this.viewInfo, rows.map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
    const source = { calibrated: "calibrated", manual: "set by hand", estimated: "estimated", default: "initial guess" }[cam.focalSource];
    const step = (k) => () => { if (!cam.calibrated) { cam.setManualFocal(cam.focal * k); this.updateView(); } };
    morph(this.focalRow,
      h("span", { class: "mono" }, `${cam.focal.toFixed(0)} px`), h("span", { class: "hint" }, source),
      h("button", { class: "btn small", type: "button", disabled: cam.calibrated, onclick: step(1 / 1.05), "aria-label": "Shorter focal length" }, "−"),
      h("button", { class: "btn small", type: "button", disabled: cam.calibrated, onclick: step(1.05), "aria-label": "Longer focal length" }, "+"),
      h("button", { class: "btn small", type: "button", disabled: !cam.manualFocal, onclick: () => { cam.setManualFocal(null); this.updateView(); } }, "Automatic"),
    );
  }

  /** Tracking details rows of the rolling-stock tags (layouts with `markers.rolling`): tags in view, model wagons. */
  _rollingRows() {
    const app = this.app, r = app.world.layout.markers.rolling;
    if (!r) return [];
    const tags = Object.keys(app.rollingDetections || {}).map(Number).sort((a, b) => a - b).map((id) => {
      const { number, slot } = decodeTag(id, r.stride);
      return `W${number}·${slot}`;
    });
    const term = terminalOf(app.world);
    const wagons = [...(term?.rolling?.wagons.values() || [])].sort((a, b) => a.number - b.number);
    // wagons with a height of their own (rolling_stock[].height_mm)
    const own = (term?.markerWagons() || []).map((c) => [c.number, term.tagHeight(encodeTag(c.number, 0, r.stride))])
      .filter(([, z]) => z !== r.height_mm).map(([n, z]) => `; W${n} ${z} mm`).join("");
    return [
      ["Rolling-stock tags", `${tags.length ? `${tags.join(", ")} in view` : "none in view"} (lifted to ${r.height_mm} mm${own})`],
      ["Model wagons", wagons.length ? wagons.map((w) => `W${w.number} ${w.state === "lost" ? "not visible" : w.state}`).join(", ") : "none seen"],
    ];
  }

  /* ================================================================ Settings */

  /** The Settings panel: its views View (examples, display, camera, language), Simulation (time, town, speed, demand, stops) and Control system. */
  renderSettings(el) {
    this.settingsBody = h("div", { class: "settings-body" });
    mount(el,
      h("div", { class: "section settings-head" },
        h("div", { class: "seg settings-views", role: "group", "aria-label": "Settings" },
          SETTINGS_VIEWS.map(([v, label]) => h("button", { type: "button", id: `settingsView-${v}`, "aria-pressed": this.settingsView === v ? "true" : "false", onclick: () => this.setSettingsView(v) }, label)))),
      this.settingsBody,
    );
    // the other views' controls are gone: their live figures are not refreshed
    this.viewInfo = this.board = this.clockFace = this.townBox = this.speedSeg = this.feedStatus = null;
    if (this.settingsView === "control") this.renderControl(this.settingsBody);
    else if (this.settingsView === "view") this.renderView(this.settingsBody);
    else this.renderSimulate(this.settingsBody);
  }

  setSettingsView(v) {
    this.settingsView = v;
    storage.set("arail.settingsView", v);
    if (this.app.activeTab === "settings") {
      this.renderSettings(document.getElementById("panel-settings"));
      document.getElementById(`settingsView-${v}`)?.focus(); // the button pressed is drawn anew: it keeps the focus
    }
    history.replaceState(null, "", `${location.pathname}${location.search}#${v}`);
  }

  /** Live figures of the Settings panel (every 400 ms while it is shown). */
  updateSettings() {
    if (this.settingsView === "control") return this.updateControl();
    if (this.settingsView === "view") return this.updateView();
    this.updateClock();
    this.updateTown();
    this.updateBoard();
  }

  /* ================================================================ Simulate */

  renderSimulate(el) {
    const w = this.world;
    this.board = h("div", { class: "board stops-board", "aria-live": "off" });
    this.speedSeg = h("div", { class: "seg", role: "group", "aria-label": "Speed" });
    this.pauseBtn = h("button", { class: "btn", type: "button", onclick: () => { w.paused = !w.paused; this.updateSimulateControls(); } });
    const demand = h("input", { type: "range", id: "demandRange", "aria-label": "Passenger demand", min: -2, max: 2, step: 0.1, value: Math.log2(w.demand),
      oninput: (e) => { w.demand = 2 ** Number(e.target.value); demandOut.textContent = `× ${w.demand.toFixed(2)}`; } });
    const demandOut = h("output", { for: "demandRange", class: "mono" }, `× ${w.demand.toFixed(2)}`);
    this.clockFace = h("div", { class: "clockface", "aria-live": "off" });
    this.timeRange = h("input", { type: "range", id: "timeOfDay", min: 0, max: 1439, step: 15, value: Math.round(w.clock.minutes),
      "aria-valuetext": w.clock.label(), oninput: (e) => { w.setTime(Number(e.target.value)); this.updateClock(); } });
    this.townBox = h("div", { class: "town-stats" });
    const app = this.app, s = w.settings;
    const hasTown = w.simulations.some((x) => x.constructor.type === "town");
    mount(el,
      section("Time of day",
        this.clockFace,
        h("label", { class: "field", for: "timeOfDay" }, h("span", {}, "Set the time"), this.timeRange),
        h("div", { class: "row", role: "group", "aria-label": "Jump to a time of day" },
          TIME_PRESETS.map(([label, t]) => h("button", { class: "btn small", type: "button", onclick: () => { w.setTime(t); this.updateClock(); } }, `${label} ${t}`))),
        h("div", { class: "fields" },
          h("label", { class: "field", for: "clockFactor" }, h("span", {}, "Fast clock"),
            h("select", { id: "clockFactor", onchange: (e) => { w.clock.factor = Number(e.target.value); } },
              [...new Set([...CLOCK_FACTORS, w.clock.factor])].sort((a, b) => a - b).map((f) => h("option", { value: f, selected: f === w.clock.factor }, f === 1 ? "1:1 (real time)" : `1:${f}`)))),
          h("label", { class: "field check", for: "optLighting" },
            h("input", { type: "checkbox", id: "optLighting", checked: s.lighting !== false, onchange: (e) => { s.lighting = e.target.checked; app.savePrefs(); } }), "Day and night lighting"),
          h("label", { class: "field check", for: "optFreeze" },
            h("input", { type: "checkbox", id: "optFreeze", checked: !!w.clock.frozen, onchange: (e) => { w.clock.frozen = e.target.checked; } }), "Stop the clock"),
        ),
      ),
      hasTown ? section("Town", this.townBox) : null,
      section("Speed",
        h("div", { class: "row" }, this.pauseBtn, this.speedSeg,
          h("button", { class: "btn", type: "button", onclick: () => this.clearSimulations() }, "Clear passengers")),
      ),
      section("Passenger demand", h("div", { class: "row" }, h("span", { class: "grow", style: { flex: 1 } }, demand), demandOut)),
      section("Stops", this.board),
    );
    this.updateSimulateControls();
    this.updateClock();
    this.updateTown();
    this.updateBoard();
  }

  /** "Clear passengers": every simulation removes what it simulates (the town and the cars start afresh). */
  clearSimulations() {
    const w = this.world, has = (type) => w.simulations.some((s) => s.constructor.type === type);
    w.simulations.forEach((s) => s.clear());
    const afresh = [has("town") && "the town", has("traffic") && "the cars"].filter(Boolean);
    toast(afresh.length ? `All passengers removed; ${afresh.join(" and ")} ${afresh.length > 1 ? "start" : "starts"} afresh.` : "All passengers removed.");
  }

  /** The clock face (refreshed periodically while Settings → Simulation is open). */
  updateClock() {
    if (!this.clockFace) return;
    const w = this.world, c = w.clock;
    const d = c.daylight();
    const phase = d > 0.97 ? "day" : d < 0.03 ? "night" : c.minutes < 12 * 60 ? "dawn" : "dusk";
    morph(this.clockFace,
      h("span", { class: "time mono" }, c.label()),
      h("span", { class: `daytime ${phase}` }, `${phase} · day ${c.day + 1}${c.frozen ? " · clock stopped" : ""}`),
    );
    if (this.timeRange && document.activeElement !== this.timeRange) {
      this.timeRange.value = String(Math.round(c.minutes));
    }
    this.timeRange?.setAttribute("aria-valuetext", c.label());
  }

  /** The town's people: where they are, and on their way by purpose (Settings → Simulation). */
  updateTown() {
    const town = this.world.simulations.find((x) => x.constructor.type === "town");
    if (!town || !this.townBox?.isConnected) return;
    const st = town.townStats();
    const item = (label, n, colour = null) => h("li", {}, colour ? h("i", { class: "swatch", style: { background: colour } }) : null, h("span", {}, label), h("b", { class: "mono" }, String(n)));
    morph(this.townBox,
      h("p", { class: "hint" }, `${st.total} people (${town.config.people_per_100} per 100 residents). Where they are:`),
      h("ul", { class: "legend-list" },
        item("at home", st.home), item("at work", st.work), item("at school", st.school), item("shopping", st.shopping),
        item("on the bus", st.riding), item("by car", st.driving), item("at stops", st.waiting), item("away (by train)", st.away)),
      h("p", { class: "hint" }, `On their way (${st.walking}), coloured by where they are going:`),
      h("ul", { class: "legend-list" }, Object.keys(PURPOSE_COLOURS).map((k) => item(PURPOSE_LABELS[k], st.byPurpose[k] || 0, PURPOSE_COLOURS[k]))),
      h("p", { class: "hint" }, `${st.captive} adults without a driving licence or a car: they walk or take the bus and the train.`),
      st.stranded ? h("p", { class: "hint" }, `${st.stranded} times one of them gave up waiting at a stop or found it closed.`) : null,
      this._tripTable(town),
    );
  }

  /** The town's trips from door to door by group (mean clock minutes in all and in their parts), with the CSV of all trips. */
  _tripTable(town) {
    const rows = town.tripStats();
    if (!rows.length) return h("p", { class: "hint" }, "No trip from door to door finished yet.");
    const parts = Object.keys(TRIP_PARTS);
    return h("div", {},
      h("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": "Door to door by group" }, h("table", { class: "trip-table" },
        h("caption", {}, "Door to door by group (mean clock minutes)"),
        h("thead", {}, h("tr", {}, ["Group", "Trips", "In all", ...parts.map((k) => TRIP_PARTS[k])].map((x) => h("th", { scope: "col" }, x)))),
        h("tbody", {}, rows.map((r) => h("tr", {}, h("th", { scope: "row" }, r.label), h("td", {}, String(r.trips)), h("td", {}, String(Math.round(r.minutes))),
          ...parts.map((k) => h("td", {}, String(Math.round(r.parts[k]))))))))),
      h("div", { class: "row" }, h("button", { class: "btn small", type: "button", id: "townTripsCsv", onclick: () => download("town-trips.csv", town.tripsCSV(), "text/csv") }, "Download the trips (CSV)")));
  }

  updateSimulateControls() {
    if (!this.speedSeg) return;
    const w = this.world;
    this.pauseBtn.textContent = tr(w.paused ? "Resume" : "Pause");
    this.pauseBtn.setAttribute("aria-pressed", w.paused ? "true" : "false");
    morph(this.speedSeg, SPEEDS.map((s) => h("button", { type: "button", "aria-pressed": w.speed === s ? "true" : "false", onclick: () => { w.speed = s; this.updateSimulateControls(); } }, `${s}×`)));
  }

  /** The stops of Settings → Simulation: people waiting, mood, the next vehicles; a button to call one (keys 1–9). */
  updateBoard() {
    if (!this.board?.isConnected) return;
    const w = this.world, sim = w.simulations[0];
    const areas = w.stopAreas();
    if (!areas.length) {
      morph(this.board, h("p", { class: "status" }, "No platforms or bus terminals on this layout yet (or their markers are not known yet). Add one in the Build panel."));
      return;
    }
    morph(this.board, areas.map((a, i) => {
      const s = sim?.stats(a.id) || { count: 0, mood: 1, inPerMin: 0, outPerMin: 0 };
      const fx = w.disruptions.effectsFor(a);
      // the next bus of each line at a terminal's bays, as on the board over the stop
      const status = fx.messages[0] || boardStatus(w, [a]).join(" · ");
      const docks = w.services.forArea(a.id);
      const bus = a.kind === "bus";
      return h("div", { class: "stop", "data-id": a.id },
        h("div", { class: `num${bus ? " bus" : ""}`, title: `Key ${i + 1}` }, a.owner.spec.number || (bus ? "H" : String(i + 1))),
        // a bus stop on both sides of the street: "Stop A" and "Stop B" (the letters on its signs)
        h("div", { class: "title" }, areas.filter((x) => x.owner === a.owner).length > 1 && a.docks[0]?.label ? `${a.owner.name} · ${a.docks[0].label}` : a.owner.name),
        // the people waiting; the bar is their mood
        h("div", { class: "figures" }, h("span", {}, `${s.count} waiting`)),
        h("div", { class: "meter", title: `mood ${(s.mood * 100).toFixed(0)} %` }, h("i", { style: { width: `${(s.mood * 100).toFixed(0)}%`, background: moodColor(s.mood) } })),
        h("div", { class: `status${fx.messages.length ? " warn" : ""}` }, status),
        h("div", { class: "calls" }, docks.filter((st) => !st.dock.managed).map((st) => {
          // a closed track (a track closure, a story's train) takes no train, nor one kept for a story's own
          const fxd = w.disruptions.effectsFor(a, st.dock), closed = fxd.closed || fxd.reserved;
          return h("button", {
            class: "btn", type: "button", disabled: !!st.vehicle || st.mode === "feed" || st.mode === "plan" || closed,
            title: st.mode === "plan" ? "The trains of this track are run by the rail operations (Operations panel)" : fxd.reserved ? "This track is kept for a story's train" : closed ? "This track is closed" : null,
            onclick: () => { if (w.services.call(st.dock.id)) this.updateBoard(); },
          }, `${bus ? "Bus" : "Train"} → ${st.dock.label}`);
        })),
      );
    }));
  }

  /* ================================================================ Disruptions */

  renderDisruptions(el) {
    this.activeList = h("div", { class: "section" });
    this.scenarioList = h("div", { class: "section" });
    this.newDisruption = h("div", { class: "section" });
    mount(el, this.activeList, this.newDisruption, this.scenarioList);
    this.updateDisruptions();
    this.renderNewDisruption();
    this.updateScenarios();
  }

  renderNewDisruption() {
    if (!this.newDisruption) return;
    const w = this.world, reg = w.registry, draft = this.disruptionDraft;
    // disruptions of a simulation the layout does not have are not offered, nor those a simulation starts itself (`hidden`),
    // nor closures of a platform's track on a layout without platforms
    const tracks = w.stopAreas().some((a) => a.kind === "rail" && a.docks.length);
    const offered = [...reg.disruptions.values()].filter((d) => !d.hidden && (!d.requires || w.simulations.some((s) => s.constructor.type === d.requires)) && (d.targets !== "track" || tracks));
    const def = offered.find((d) => d.type === draft.type) || offered[0];
    if (!def) return;
    draft.type = def.type;
    // "track": one track of a platform (its dock); else one entry per stop object (a bus stop on both sides of the street has two stop areas)
    const targets = def.targets === "track"
      ? w.stopAreas().filter((a) => a.kind === "rail").flatMap((a) => a.docks.map((k) => [k.id, `${a.owner.name}, ${k.label}`]))
      : [["*", def.targets === "rail" ? "all platforms" : "all stops"],
        ...new Map(w.stopAreas().filter((a) => !def.targets || def.targets === "any" || a.kind === def.targets).map((a) => [a.owner.id, a.owner.name]))];
    if (!targets.some(([v]) => v === draft.target)) draft.target = targets[0][0];
    const params = {};
    for (const p of def.params || []) params[p.key] = draft.params[p.key] ?? p.default;
    mount(this.newDisruption,
      h("h2", {}, "Start a disruption"),
      h("div", { class: "fields" },
        h("label", { class: "field", for: "disType" }, h("span", {}, "Kind"),
          h("select", { id: "disType", onchange: (e) => { draft.type = e.target.value; draft.params = {}; this.renderNewDisruption(); } },
            offered.map((d) => h("option", { value: d.type, selected: d.type === def.type }, d.label)))),
        def.targets === "none" ? null : h("label", { class: "field", for: "disTarget" }, h("span", {}, "Where"),
          h("select", { id: "disTarget", onchange: (e) => (draft.target = e.target.value) }, targets.map(([v, t]) => h("option", { value: v, selected: v === draft.target }, t)))),
      ),
      def.description ? h("p", { class: "hint" }, def.description) : null,
      paramFields(def.params || [], params, (k, v) => (draft.params[k] = v), { idPrefix: "dis", world: w }),
      h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", onclick: () => this._startDisruption(def, params) }, `Start: ${def.label}`)),
    );
  }

  _startDisruption(def, params) {
    const draft = this.disruptionDraft;
    try {
      const p = { ...params, ...draft.params };
      if (def.type === "replacement-bus" && !p.bus_terminal) {
        const bt = this.world.objects.find((o) => o.type === "bus-terminal");
        if (!bt) return toast("Add a bus terminal first (Build panel).");
        p.bus_terminal = bt.id;
      }
      this.world.disruptions.start({ type: def.type, target: def.targets === "none" ? "*" : draft.target, params: p });
    } catch (err) {
      toast(err.message);
    }
  }

  updateDisruptions() {
    if (!this.activeList) return;
    const w = this.world;
    const act = w.disruptions.active;
    morph(this.activeList,
      h("h2", {}, "Active ", h("span", { class: "count" }, act.length ? `(${act.length})` : "")),
      act.length ? act.map((d) => {
        const target = d.target === "*" ? "everywhere" : w.getObject(d.target)?.name || trackName(w, d.target) || d.target;
        const left = d.until == null ? "until stopped" : `${Math.max(0, Math.ceil((d.until - w.time) / 60))} min left (simulated)`;
        return h("div", { class: "disruption", "data-id": d.id }, h("strong", {}, `${d.def.label} · ${target}`), h("small", {}, left),
          h("button", { class: "btn small", type: "button", onclick: () => w.disruptions.stop(d.id) }, "Stop"));
      }) : h("p", { class: "hint" }, "No disruptions. Everything runs to plan."),
    );
  }

  updateScenarios() {
    if (!this.scenarioList) return;
    const sp = this.world.scenarios;
    morph(this.scenarioList,
      h("h2", {}, "Scenarios"),
      sp.scenarios.length ? sp.scenarios.map((sc) => {
        const running = sp.current === sc;
        const end = Math.max(1, ...sc.steps.map((s) => s.at || 0));
        return h("div", { class: "scenario", "data-id": sc.id },
          h("div", { class: "row" }, h("strong", { style: { flex: 1 } }, sc.name || sc.id),
            h("button", { class: `btn small${running ? "" : " primary"}`, type: "button", onclick: () => (running ? sp.stop() : sp.play(sc.id)) }, running ? "Stop" : "Play")),
          sc.description ? h("p", {}, sc.description) : null,
          running ? h("div", { class: "progress" }, h("i", { style: { width: `${Math.min(100, (100 * sp.elapsed) / end).toFixed(0)}%` } })) : null,
        );
      }) : h("p", { class: "hint" }, "This layout has no scenarios. Scenarios are timelines of disruptions in the layout file (see the documentation)."),
    );
  }

  /* ================================================================ Control system */

  renderControl(el) {
    const app = this.app;
    this.feedStatus = h("p", { class: "hint" });
    this.trainTable = h("div");
    const url = h("input", { type: "url", id: "feedUrl", value: app.feedUrl, placeholder: "ws://localhost:8765/feed", onchange: (e) => (app.feedUrl = e.target.value.trim()) });
    const s = this.world.settings;
    mount(el,
      section("Connection",
        h("p", { class: "hint" }, "Train positions from your control system come through the ARail bridge (Python) as WebSocket messages. See docs/control-system-interface.md."),
        h("label", { class: "field", for: "feedUrl" }, h("span", {}, "Bridge address"), url),
        h("div", { class: "row" },
          h("button", { class: "btn primary", type: "button", onclick: () => this.connect() }, "Connect"),
          h("button", { class: "btn", type: "button", onclick: () => this.disconnect() }, "Disconnect"),
          h("button", { class: "btn", type: "button", onclick: () => this.startMock() }, "Simulated control system"),
        ),
        this.feedStatus,
        h("p", { class: "hint" }, "On an https page (GitHub Pages) browsers allow wss:// addresses and ws://localhost only. Other options: start the bridge with TLS, or open the app from the bridge (see the documentation)."),
      ),
      section("Trains",
        h("label", { class: "field", for: "feedVehicles" }, h("span", {}, "Draw trains from the control system as"),
          h("select", { id: "feedVehicles", onchange: (e) => { s.feedVehicles = e.target.value; app.savePrefs(); } },
            [["outline", "outline"], ["solid", "virtual train"], ["none", "nothing (only passengers react)"]].map(([v, t]) => h("option", { value: v, selected: s.feedVehicles === v }, t)))),
        this.trainTable,
      ),
    );
    this.updateControl();
  }

  connect() {
    const app = this.app;
    this.disconnect(false);
    if (!app.feedUrl) return toast("Enter the address of the bridge first.");
    storage.set("arail.feedUrl", app.feedUrl);
    app.feed = new WebSocketFeed(this.world, { url: app.feedUrl });
    app.feed.connect();
    this.updateControl();
  }

  startMock() {
    this.disconnect(false);
    this.app.feed = new MockFeed(this.world);
    this.app.feed.start();
    toast("Simulated control system started: trains drive in, stop at the platforms and leave again.");
    this.updateControl();
  }

  disconnect(update = true) {
    const f = this.app.feed;
    if (f) {
      if (f instanceof MockFeed) f.stop();
      else f.close();
    }
    this.app.feed = null;
    if (update) this.updateControl();
  }

  updateControl() {
    if (!this.feedStatus) return;
    const f = this.app.feed, tr = this.world.trains;
    let dot = "", text = "Not connected. The built-in timetable sends trains.";
    if (f instanceof MockFeed) {
      dot = "ok";
      text = "Simulated control system is running.";
    } else if (f) {
      dot = f.status === "connected" ? (tr.active ? "ok" : "warn") : f.status === "connecting" ? "warn" : "bad";
      text = { connecting: "Connecting…", connected: tr.active ? `Connected to ${tr.source || "the bridge"}. ${f.messages} messages.` : "Connected, waiting for train positions…", disconnected: "Connection lost, retrying…", error: `Error: ${f.error || "cannot connect"}`, idle: "Not connected." }[f.status] || f.status;
      if (f.rejected) text += ` ${f.rejected} invalid messages (${f.error}).`;
    }
    morph(this.feedStatus, h("span", { class: `status-dot ${dot}` }), text);
    const trains = [...tr.trains.values()];
    morph(this.trainTable, trains.length
      ? h("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": "Trains" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Train", "Position", "Speed", "At"].map((t) => h("th", {}, t)))),
        h("tbody", {}, trains.map((t) => h("tr", {},
          h("td", {}, t.name),
          h("td", {}, t.pos ? `${t.pos[0].toFixed(0)}, ${t.pos[1].toFixed(0)} mm` : t.track ? `track ${t.track}` : "unknown"),
          h("td", {}, `${(t.speed ?? t.speedEst ?? 0).toFixed(0)} mm/s`),
          h("td", {}, t.dockId ? this.world.services.docks.get(t.dockId)?.dock.area.owner.name || t.dockId : "–"))))))
      : h("p", { class: "hint" }, tr.active ? "No trains reported." : "No control system connected."));
  }
}
