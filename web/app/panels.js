// Panels: View, Simulate, Disruptions, Control system.
import { moodColor, dockStatus, formatTime, MockFeed, PURPOSE_COLOURS, PURPOSE_LABELS, WebSocketFeed } from "../arail/index.js";
import { h, morph, mount, paramFields, readFile, section, storage, toast } from "./ui.js";

const SPEEDS = [1, 2, 5, 10, 30];
/** Fast-clock ratios offered in the Simulate panel. */
const CLOCK_FACTORS = [1, 4, 6, 12, 24, 60];
const TIME_PRESETS = [["Morning", "06:30"], ["Noon", "12:00"], ["Evening", "17:00"], ["Night", "22:30"]];

export class Panels {
  constructor(app) {
    this.app = app;
    this.disruptionDraft = { type: "delay", target: "*", params: {} };
  }

  get world() {
    return this.app.world;
  }

  /* ================================================================ View */

  renderView(el) {
    const app = this.app, s = app.world.settings, d = app.display;
    const toggle = (id, label, get, set) => h("label", { class: "field check", for: id },
      h("input", { type: "checkbox", id, checked: get(), onchange: (e) => { set(e.target.checked); app.savePrefs(); } }), label);
    this.viewInfo = h("dl", { class: "kv" });
    this.focalRow = h("div", { class: "row" });
    this.flyBox = h("div", { class: "section flyover-section" });
    mount(el,
      section("Tracking", this.viewInfo, h("p", { class: "hint" },
        "Point the camera at the layout from above at an angle. At least one known marker must be visible; more markers make it steadier.")),
      this.flyBox,
      section("Show",
        h("div", { class: "fields" },
          toggle("optLabels", "Signs and boards", () => s.labels, (v) => (s.labels = v)),
          toggle("optTrails", "Walking trails", () => s.trails, (v) => (s.trails = v)),
          toggle("optMarkers", "Marker outlines", () => d.markers, (v) => (d.markers = v)),
          toggle("optTracks", "Tracks", () => s.showTracks, (v) => (s.showTracks = v)),
        ),
        h("label", { class: "field", for: "optOpacity" }, h("span", {}, "Opacity of virtual objects"),
          h("input", { type: "range", id: "optOpacity", min: 0.2, max: 1, step: 0.05, value: d.opacity, oninput: (e) => { d.opacity = Number(e.target.value); app.savePrefs(); } })),
      ),
      section("Camera",
        h("p", { class: "hint" }, "The focal length is estimated from the markers. If people or buildings lean, adjust it by hand."),
        this.focalRow,
        h("div", { class: "row" },
          h("label", { class: "btn small", for: "calibrationFile" }, "Load calibration"),
          h("input", { type: "file", id: "calibrationFile", accept: ".json,application/json", class: "visually-hidden", onchange: (e) => this._loadCalibration(e) }),
          h("button", { class: "btn small", type: "button", onclick: () => { app.camera.setCalibration(null); storage.remove("arail.calibration"); toast("Calibration removed."); } }, "Remove calibration"),
        ),
        h("p", { class: "hint" }, "A calibration file comes from ", h("code", {}, "arail-calibrate"), " (see the documentation). It only fits the camera and resolution it was made with."),
      ),
      section("Record",
        h("div", { class: "row" },
          h("button", { class: "btn small", type: "button", id: "btnRecord", "aria-pressed": app.recorder ? "true" : "false", onclick: () => app.toggleRecording() }, "Record video of the stage"),
        ),
        h("p", { class: "hint" }, "Saves the camera image with everything drawn on it as a WebM video."),
      ),
    );
    this.renderFlyover();
    this.updateView();
  }

  /** View panel, Flyover: switch it on and off, move its camera, set the grid. */
  renderFlyover() {
    const box = this.flyBox;
    if (!box?.isConnected) return;
    const app = this.app, fly = app.flyover, d = app.display, g = app.world.layout.grid, on = fly.active;
    const toggle = (id, label, get, set) => h("label", { class: "field check", for: id },
      h("input", { type: "checkbox", id, checked: get(), onchange: (e) => set(e.target.checked) }), label);
    const button = (cmd, label, text) => h("button", { class: "btn small", type: "button", "data-fly": cmd, "aria-label": label, title: label }, text);
    const sizes = [...new Set([10, 25, 50, 100, 250, g.size_mm])].sort((a, b) => a - b);
    // morph, not mount: the toggle that redrew this section keeps the keyboard focus
    morph(box,
      h("h2", {}, "Flyover"),
      h("div", { class: "row" },
        h("button", { class: "btn", type: "button", id: "btnFlyoverPanel", "aria-pressed": on ? "true" : "false", onclick: () => fly.toggle() }, "Flyover"),
        h("span", { class: "hint" }, on ? "Virtual camera. Press F or the button to return to the camera image." : "Look at and edit the layout with a virtual camera (key F).")),
      on ? h("div", { class: "row fly-buttons", role: "group", "aria-label": "Flyover camera" },
        button("zoom-in", "Zoom in", "+"), button("zoom-out", "Zoom out", "−"),
        button("rotate-left", "Rotate left", "↺"), button("rotate-right", "Rotate right", "↻"),
        h("button", { class: "btn small", type: "button", "data-fly": "plan", "aria-pressed": fly.cam.isPlan ? "true" : "false", title: "Plan view: look straight down" }, "Plan view"),
        button("fit", "Show the whole layout", "Fit")) : null,
      h("div", { class: "fields" },
        h("label", { class: "field", for: "gridSize" }, h("span", {}, "Grid spacing"),
          h("select", { id: "gridSize", onchange: (e) => { g.size_mm = Number(e.target.value); app.saveLayout(); app.updateHud(); app.editor.renderPlacing(); } },
            sizes.map((v) => h("option", { value: v, selected: v === g.size_mm }, `${v} mm`)))),
        toggle("optSnap", "Snap to the grid", () => g.snap, (v) => { g.snap = v; app.saveLayout(); app.updateHud(); app.editor.renderPlacing(); }),
        toggle("optGridCamera", "Grid in camera view", () => !!d.gridInCamera, (v) => { d.gridInCamera = v; app.savePrefs(); }),
        toggle("optFlyMarkers", "Show markers", () => d.flyMarkers !== false, (v) => { d.flyMarkers = v; app.savePrefs(); }),
      ),
      h("p", { class: "hint" },
        "Drag to turn the view; Shift-drag, right-drag or two fingers pan; scroll or pinch to zoom. In Build, placed and dragged objects snap to the grid (hold Alt for free placement), and Build → Table adds table modules to extend the tabletop."),
    );
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

  /* ================================================================ Simulate */

  renderSimulate(el) {
    const w = this.world;
    this.board = h("div", { class: "board", "aria-live": "off" });
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
        h("p", { class: "hint" }, "The clock runs faster than the trains and people (1:12 = one hour in five simulated minutes). Timetables, traffic and the town follow it: rush hours in the morning and evening, no trains and buses between 01:00 and 04:30."),
      ),
      hasTown ? section("Town",
        this.townBox,
        h("label", { class: "field", for: "peopleColour" }, h("span", {}, "Colour of people"),
          h("select", { id: "peopleColour", onchange: (e) => { s.peopleColour = e.target.value; app.savePrefs(); } },
            [["auto", "town: purpose of the trip; passengers: mood"], ["purpose", "purpose of the trip"], ["mood", "mood"]].map(([v, t]) => h("option", { value: v, selected: (s.peopleColour || "auto") === v }, t)))),
      ) : null,
      section("Speed",
        h("div", { class: "row" }, this.pauseBtn, this.speedSeg,
          h("button", { class: "btn", type: "button", onclick: () => { w.simulations.forEach((s) => s.clear()); toast("All passengers removed."); } }, "Clear passengers")),
        h("p", { class: "hint" }, "Speed is simulated time per real time. Space pauses."),
      ),
      section("Passenger demand", h("div", { class: "row" }, h("span", { class: "grow", style: { flex: 1 } }, demand), demandOut)),
      section("Stops", this.board, h("p", { class: "hint" }, "Keys 1–9 send a vehicle to the stop with that position in the list.")),
    );
    this.updateSimulateControls();
    this.updateClock();
    this.updateBoard();
  }

  /** Clock face and town figures (refreshed periodically while the Simulate panel is open). */
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
    const town = w.simulations.find((x) => x.constructor.type === "town");
    if (!town || !this.townBox) return;
    const st = town.townStats();
    const item = (label, n, colour = null) => h("li", {}, colour ? h("i", { class: "swatch", style: { background: colour } }) : null, h("span", {}, label), h("b", { class: "mono" }, String(n)));
    morph(this.townBox,
      h("p", { class: "hint" }, `${st.total} people (${town.config.people_per_100} per 100 residents). Where they are:`),
      h("ul", { class: "legend-list" },
        item("at home", st.home), item("at work", st.work), item("at school", st.school), item("shopping", st.shopping),
        item("on the bus", st.riding), item("at stops", st.waiting), item("away (by train)", st.away)),
      h("p", { class: "hint" }, `On their way (${st.walking}), coloured by where they are going:`),
      h("ul", { class: "legend-list" }, Object.keys(PURPOSE_COLOURS).map((k) => item(PURPOSE_LABELS[k], st.byPurpose[k] || 0, PURPOSE_COLOURS[k]))),
    );
  }

  updateSimulateControls() {
    if (!this.speedSeg) return;
    const w = this.world;
    this.pauseBtn.textContent = w.paused ? "Resume" : "Pause";
    this.pauseBtn.setAttribute("aria-pressed", w.paused ? "true" : "false");
    morph(this.speedSeg, SPEEDS.map((s) => h("button", { type: "button", "aria-pressed": w.speed === s ? "true" : "false", onclick: () => { w.speed = s; this.updateSimulateControls(); } }, `${s}×`)));
  }

  updateBoard() {
    if (!this.board) return;
    const w = this.world, sim = w.simulations[0];
    const areas = w.stopAreas();
    if (!areas.length) {
      morph(this.board, h("p", { class: "status" }, "No platforms or bus terminals on this layout yet (or their markers are not known yet). Add one in the Build panel."));
      return;
    }
    morph(this.board, areas.map((a, i) => {
      const s = sim?.stats(a.id) || { count: 0, mood: 1, inPerMin: 0, outPerMin: 0 };
      const fx = w.disruptions.effectsFor(a);
      const status = fx.messages[0] || dockStatus(w, a);
      const docks = w.services.forArea(a.id);
      const bus = a.kind === "bus";
      return h("div", { class: "stop", "data-id": a.id },
        h("div", { class: `num${bus ? " bus" : ""}`, title: `Key ${i + 1}` }, a.owner.spec.number || (bus ? "H" : String(i + 1))),
        h("div", { class: "title" }, a.owner.name),
        h("div", { class: "figures" }, h("span", {}, `${s.count} waiting`), h("span", {}, `mood ${(s.mood * 100).toFixed(0)} %`), h("span", {}, `in ${s.inPerMin}/min · out ${s.outPerMin}/min`)),
        h("div", { class: "meter" }, h("i", { style: { width: `${(s.mood * 100).toFixed(0)}%`, background: moodColor(s.mood) } })),
        h("div", { class: `status${fx.messages.length ? " warn" : ""}` }, status),
        h("div", { class: "calls" }, docks.filter((st) => !st.dock.managed).map((st) => h("button", {
          class: "btn", type: "button", disabled: !!st.vehicle || st.mode === "feed",
          onclick: () => { if (w.services.call(st.dock.id)) this.updateBoard(); },
        }, `${bus ? "Bus" : "Train"} → ${st.dock.label}`))),
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
    const def = reg.disruptions.get(draft.type) || [...reg.disruptions.values()][0];
    if (!def) return;
    draft.type = def.type;
    const areas = w.stopAreas().filter((a) => !def.targets || def.targets === "any" || a.kind === def.targets);
    const targets = [["*", def.targets === "rail" ? "all platforms" : "all stops"], ...areas.map((a) => [a.owner.id, a.owner.name])];
    if (!targets.some(([v]) => v === draft.target)) draft.target = "*";
    const params = {};
    for (const p of def.params || []) params[p.key] = draft.params[p.key] ?? p.default;
    mount(this.newDisruption,
      h("h2", {}, "Start a disruption"),
      h("div", { class: "fields" },
        h("label", { class: "field", for: "disType" }, h("span", {}, "Kind"),
          h("select", { id: "disType", onchange: (e) => { draft.type = e.target.value; draft.params = {}; this.renderNewDisruption(); } },
            [...reg.disruptions.values()].map((d) => h("option", { value: d.type, selected: d.type === def.type }, d.label)))),
        h("label", { class: "field", for: "disTarget" }, h("span", {}, "Where"),
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
      this.world.disruptions.start({ type: def.type, target: draft.target, params: p });
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
        const target = d.target === "*" ? "everywhere" : w.getObject(d.target)?.name || d.target;
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
      ? h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Train", "Position", "Speed", "At"].map((t) => h("th", {}, t)))),
        h("tbody", {}, trains.map((t) => h("tr", {},
          h("td", {}, t.name),
          h("td", {}, t.pos ? `${t.pos[0].toFixed(0)}, ${t.pos[1].toFixed(0)} mm` : t.track ? `track ${t.track}` : "unknown"),
          h("td", {}, `${(t.speed ?? t.speedEst ?? 0).toFixed(0)} mm/s`),
          h("td", {}, t.dockId ? this.world.services.docks.get(t.dockId)?.dock.area.owner.name || t.dockId : "–"))))))
      : h("p", { class: "hint" }, tr.active ? "No trains reported." : "No control system connected."));
  }
}
