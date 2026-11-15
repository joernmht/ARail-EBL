// Panels: Settings (view, simulation and control system), Disruptions.
import { UI_LANGUAGES, CD, checkSection, COMPATIBILITY, MockFeed, WEATHER_PRESETS, sectionSystems, SYSTEM_OVERLAYS, systemValue, WebSocketFeed } from "../arail/index.js";
import { applySituation, SITUATIONS, situationReady } from "./situations.js";
import { h, morph, mount, paramFields, readFile, section, storage, toast } from "./ui.js";

/** Fast-clock ratios offered in Settings → Simulation. */
const CLOCK_FACTORS = [1, 4, 6, 12, 24, 60];
const TIME_PRESETS = [["Morning", "06:30"], ["Noon", "12:00"], ["Evening", "17:00"], ["Night", "22:30"]];
/** The seasons of Settings → Simulation: a day of each ("MM-DD"; "": no date, every day the same mild day). */
const DATE_PRESETS = [["", "No date"], ["04-15", "Spring (15 April)"], ["07-15", "Summer (15 July)"], ["10-15", "Autumn (15 October)"], ["12-15", "Winter (15 December)"]];
/** The passenger demand of Settings → Simulation (a factor on all the demand of the layout). */
const DEMAND_PRESETS = [[0.5, "Quiet (× 0.5)"], [1, "Normal (× 1)"], [2, "Busy (× 2)"], [4, "Rush hour (× 4)"]];
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

  /** Settings → View: the image source, the examples, what is shown, the grid, the camera, recording, the language. */
  renderView(el) {
    const app = this.app, s = app.world.settings, d = app.display, g = app.world.layout.grid;
    // a control that had the focus (e.g. the box of a module just switched) gets it back in the new panel
    const focused = el.contains(document.activeElement) ? document.activeElement.id : null;
    const toggle = (id, label, get, set) => h("label", { class: "field check", for: id },
      h("input", { type: "checkbox", id, checked: get(), onchange: (e) => { set(e.target.checked); app.savePrefs(); } }), label);
    const placing = () => { app.saveLayout(); app.updateHud(); app.editor.renderPlacing(); };
    const sizes = [...new Set([10, 25, 50, 100, 250, g.size_mm])].sort((a, b) => a - b);
    this.focalRow = h("div", { class: "row" });
    // the image sources: the live camera (where the browser can open it: https), a photo or video taken
    // with the device's camera app, or a file
    const file = (id, label, accept, capture) => [
      h("label", { class: "btn small", for: id }, label),
      h("input", { class: "visually-hidden", type: "file", id, accept, capture, onchange: (e) => app.openSourceFile(e.target) }),
    ];
    mount(el,
      section("Image source",
        h("div", { class: "row image-sources" },
          app.liveAvailable ? h("button", { class: "btn small primary", type: "button", id: "btnLive", onclick: () => app.openLive() }, "Live camera") : null,
          file("filePhoto", "Take photo", "image/*", "environment"),
          file("fileVideo", "Record video", "video/*", "environment"),
          file("fileOpen", "Open file", "image/*,video/*", null))),
      // the app: the photo tour on the stage chooses what is shown; the layouts with a clip, a tab or a layout of their own are here
      app.tourNav ? section("Layouts",
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

  /** The focal length of Settings → View → Camera as it is now (it is learned from the frames). */
  updateView() {
    if (!this.focalRow?.isConnected) return;
    const cam = this.app.camera;
    const source = { calibrated: "calibrated", manual: "set by hand", estimated: "estimated", default: "initial guess" }[cam.focalSource];
    const step = (k) => () => { if (!cam.calibrated) { cam.setManualFocal(cam.focal * k); this.updateView(); } };
    morph(this.focalRow,
      h("span", { class: "mono" }, `${cam.focal.toFixed(0)} px`), h("span", { class: "hint" }, source),
      h("button", { class: "btn small", type: "button", disabled: cam.calibrated, onclick: step(1 / 1.05), "aria-label": "Shorter focal length" }, "−"),
      h("button", { class: "btn small", type: "button", disabled: cam.calibrated, onclick: step(1.05), "aria-label": "Longer focal length" }, "+"),
      h("button", { class: "btn small", type: "button", disabled: !cam.manualFocal, onclick: () => { cam.setManualFocal(null); this.updateView(); } }, "Automatic"),
    );
  }

  /* ================================================================ Settings */

  /** The Settings panel, what can be set: its views View (image source, layouts, display, camera, language), Simulation (presets) and Control system. */
  renderSettings(el) {
    this.settingsBody = h("div", { class: "settings-body" });
    mount(el,
      h("div", { class: "section settings-head" },
        h("div", { class: "seg settings-views", role: "group", "aria-label": "Settings" },
          SETTINGS_VIEWS.map(([v, label]) => h("button", { type: "button", id: `settingsView-${v}`, "aria-pressed": this.settingsView === v ? "true" : "false", onclick: () => this.setSettingsView(v) }, label)))),
      this.settingsBody,
    );
    // the other views' controls are gone: their live figures are not refreshed
    this.focalRow = this.feedStatus = this.dateSelect = null;
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
    this.updateSimulate();
  }

  /* ================================================================ Simulate */

  /**
   * Settings → Simulation: situations, each a characteristic combination of the day (its weekday
   * counts), the time, the weather and the demand, or an event (situations.js); the clock; and,
   * folded away, each of them on its own as presets. What the simulation measures is in the Overview.
   */
  renderSimulate(el) {
    const w = this.world, app = this.app, s = w.settings;
    const select = (id, options, value, set) => h("select", { id, onchange: (e) => { set(e.target.value); this.byHand(); } },
      options.map(([v, t]) => h("option", { value: v, selected: String(value) === String(v) }, t)));
    this.dateSelect = h("select", { id: "datePreset", onchange: (e) => { w.setDate(e.target.value || null); this.byHand(); } });
    this.weatherSelect = select("weatherSelect", [["off", "Off"], ["typical", "Typical for the date"], ...Object.entries(WEATHER_PRESETS).map(([k, p]) => [k, p.label])],
      w.weather.mode === "fixed" ? w.weather.preset : w.weather.mode, (v) => w.setWeather(v));
    this.demandSelect = h("select", { id: "demandPreset", onchange: (e) => { w.demand = Number(e.target.value); this.byHand(); } });
    this.timeButtons = TIME_PRESETS.map(([label, t]) => h("button", { class: "btn small", type: "button", "aria-pressed": "false", "data-time": t,
      onclick: () => { w.setTime(t); this.byHand(); } }, `${label} ${t}`));
    const list = (kind, label) => h("ul", { class: "situations", "aria-label": label }, SITUATIONS.filter((x) => x.kind === kind).map((x) => h("li", {}, this._situationCard(x))));
    mount(el,
      section("Situations",
        h("p", { class: "hint" }, "Each sets the day, the time, the weather and how many travel, at once. On a Saturday or Sunday there is no rush hour."),
        list("day", "Days"),
        h("h3", { class: "situations-head" }, "Events"),
        list("event", "Events"),
      ),
      section("Clock",
        h("div", { class: "fields" },
          h("label", { class: "field", for: "clockFactor" }, h("span", {}, "Fast clock"),
            // not part of a situation: the situation set stays pressed
            h("select", { id: "clockFactor", onchange: (e) => { w.clock.factor = Number(e.target.value); } },
              [...new Set([...CLOCK_FACTORS, w.clock.factor])].sort((a, b) => a - b).map((f) => h("option", { value: f, selected: f === w.clock.factor }, f === 1 ? "1:1 (real time)" : `1:${f}`)))),
          h("label", { class: "field check", for: "optLighting" },
            h("input", { type: "checkbox", id: "optLighting", checked: s.lighting !== false, onchange: (e) => { s.lighting = e.target.checked; app.savePrefs(); } }), "Day and night lighting"),
          h("label", { class: "field check", for: "optFreeze" },
            h("input", { type: "checkbox", id: "optFreeze", checked: !!w.clock.frozen, onchange: (e) => { w.clock.frozen = e.target.checked; } }), "Stop the clock"),
        ),
        h("p", { class: "hint" }, "Pause and the speed are in the upper right corner of the stage."),
        h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => this.clearSimulations() }, "Clear passengers")),
      ),
      h("details", { class: "section by-hand", id: "simByHand", open: !!this.byHandOpen, ontoggle: (e) => (this.byHandOpen = e.currentTarget.open) },
        h("summary", {}, h("h2", {}, "Each on its own")),
        h("div", { class: "field" }, h("span", {}, "Time of day"), h("div", { class: "row", role: "group", "aria-label": "Time of day" }, this.timeButtons)),
        h("div", { class: "fields" },
          h("label", { class: "field", for: "datePreset" }, h("span", {}, "Season"), this.dateSelect),
          h("label", { class: "field", for: "weatherSelect" }, h("span", {}, "Weather"), this.weatherSelect),
          h("label", { class: "field", for: "demandPreset" }, h("span", {}, "Demand"), this.demandSelect),
        ),
        h("p", { class: "hint" }, "With a season the sun rises and sets as on that day in Dresden, and the trees follow it. The typical weather is that of the date; without a date it is a mild dry day."),
      ),
    );
    this.updateSimulate();
  }

  /**
   * A situation as a card to press: its name and what it is; pressed while it is the one set (until
   * something is set on its own, or another layout opens); off where the layout lacks what it needs.
   */
  _situationCard(x) {
    const ready = situationReady(this.app, x), id = `situation-${x.id}`;
    return h("button", {
      type: "button", class: "situation", id, disabled: !ready, "aria-pressed": this._situationSet() === x.id ? "true" : "false",
      "aria-labelledby": `${id}-name`, "aria-describedby": `${id}-text`, onclick: () => this.setSituation(x),
    },
    h("span", { class: "situation-name", id: `${id}-name` }, x.label),
    h("span", { class: "situation-text", id: `${id}-text` }, x.text, ready ? null : [" (", h("span", { class: "case-state" }, "Not in this layout"), ")"]));
  }

  /**
   * The situation set last, while the layout is the one it was set on (the world loads another
   * layout, or the same one with other modules, into the same object: its layout is new then).
   */
  _situationSet() {
    return this.situation && this.situation.layout === this.world.layout ? this.situation.id : null;
  }

  /** Set a situation (situations.js); the card keeps the focus. */
  async setSituation(x) {
    await applySituation(this.app, x);
    this.situation = { id: x.id, layout: this.world.layout };
    if (this.app.activeTab === "settings" && this.settingsView === "simulate") {
      this.renderSettings(document.getElementById("panel-settings"));
      document.getElementById(`situation-${x.id}`)?.focus();
    }
  }

  /** Something set on its own: no situation is the one set any more. */
  byHand() {
    this.situation = null;
    for (const b of document.querySelectorAll(".situation[aria-pressed=true]")) b.setAttribute("aria-pressed", "false");
    this.updateSimulate();
  }

  /** "Clear passengers": every simulation removes what it simulates (the town and the cars start afresh). */
  clearSimulations() {
    const w = this.world, has = (type) => w.simulations.some((s) => s.constructor.type === type);
    w.simulations.forEach((s) => s.clear());
    const afresh = [has("town") && "the town", has("traffic") && "the cars"].filter(Boolean);
    toast(afresh.length ? `All passengers removed; ${afresh.join(" and ")} ${afresh.length > 1 ? "start" : "starts"} afresh.` : "All passengers removed.");
  }

  /**
   * The presets of Settings → Simulation → Each on its own as the world is now (a scenario or a story may have set
   * another time, date, weather or demand): the time of day pressed, a date or a demand that is no
   * preset as an option of its own.
   */
  updateSimulate() {
    if (!this.dateSelect?.isConnected) return;
    const w = this.world, c = w.clock, date = c.monthDay();
    const now = Math.round(c.minutes), at = (t) => { const [hh, mm] = t.split(":").map(Number); return hh * 60 + mm; };
    // the part of the day it is: the latest preset not after now (before the first: the last, the night)
    const part = [...TIME_PRESETS].reverse().find(([, t]) => at(t) <= now)?.[1] ?? TIME_PRESETS[TIME_PRESETS.length - 1][1];
    for (const b of this.timeButtons) b.setAttribute("aria-pressed", b.dataset.time === part ? "true" : "false");
    const key = date ? `${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}` : "";
    const dates = DATE_PRESETS.some(([v]) => v === key) ? DATE_PRESETS : [...DATE_PRESETS, [key, c.dateLabel({ long: true })]];
    if (document.activeElement !== this.dateSelect) {
      morph(this.dateSelect, dates.map(([v, t]) => h("option", { value: v }, t)));
      this.dateSelect.value = key;
    }
    if (document.activeElement !== this.weatherSelect) this.weatherSelect.value = w.weather.mode === "fixed" ? w.weather.preset : w.weather.mode;
    const demand = Math.round(w.demand * 100) / 100;
    const demands = DEMAND_PRESETS.some(([v]) => v === demand) ? DEMAND_PRESETS : [...DEMAND_PRESETS, [demand, `× ${demand.toFixed(2)}`]].sort((a, b) => a[0] - b[0]);
    if (document.activeElement !== this.demandSelect) {
      morph(this.demandSelect, demands.map(([v, t]) => h("option", { value: v }, t)));
      this.demandSelect.value = String(demand);
    }
  }

  /** The time and speed on the stage after the speed or Pause changed (app/speed.js). */
  updateSimulateControls() {
    this.app.speed?.update();
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
  }
}
