/**
 * Models of the architecture page: the railway systems of the track sections. See ../model.js.
 * @module architecture/models/rail
 */
export const RAIL = [
  {
    id: "systems", group: "rail", title: "Railway systems of the sections",
    summary: "Every track is a section with its traction power, train protection, ETCS, signals, radio, gauge, line category, loading gauge, line speed, country and infrastructure manager; View → Colour the tracks by shows one of them on the table.",
    description: "The systems are parameters of the track object; a value left empty is the one usual in the section's country (COUNTRIES: typical values, simplified). Their names follow the parameters of the EU Register of Infrastructure (RINF). sectionSystems resolves a section's values, systemChanges finds where neighbouring sections meet end to end with a different value. With the world setting trackSystems a track draws a band in the colour of its value and the changes it starts; the info card of a track lists all its systems. The system change object marks where a system changes (a separation section, a train control transition, a border, the boundary between infrastructure managers) and says what happens there.",
    files: ["web/arail/rail/index.js", "web/arail/rail/systems.js", "web/arail/rail/objects.js"],
    classes: [
      {
        name: "systems", file: "web/arail/rail/systems.js", kind: "module", role: "The catalogues and the systems of a section.",
        attributes: ["POWER — traction power supplies", "TRAIN_CONTROL — class B train protection", "ETCS — ETCS levels", "SIGNALLING — lineside signals", "RADIO — train radio", "GAUGE — track gauges", "ROUTE_CLASS — line categories of EN 15528", "LOADING_GAUGE", "COUNTRIES — what is usual in a country, and its infrastructure manager", "SYSTEMS — key, label, RINF parameter, catalogue", "SYSTEM_PARAMS — the parameters of tracks", "SYSTEM_OVERLAYS — what can colour the tracks"],
        operations: ["sectionSystems(spec) — values, and which are usual in the country", "systemValue(key, value) — label, short text, colour", "systemRows(spec) — rows of a card", "routeClassLimits(code) — axle and metre load", "systemChanges(tracks, key, tolMM) — where neighbouring sections differ", "worldSystemChanges(world, key) — cached", "drawSystemBand(view, track, key)", "drawSystemChange(view, change)"],
      },
      {
        name: "SystemChange", file: "web/arail/rail/objects.js", kind: "class", extends: "LayoutObject", role: "A board where a system changes: separation section, train control transition, border, boundary of infrastructure managers.",
        attributes: ["kind: string — power, train_control, border, im"],
        operations: ["nearTracks() — the sections beside it", "card() — what happens there, the systems on both sides", "draw(view)"],
      },
      { name: "rail", file: "web/arail/rail/index.js", kind: "module", role: "The package's API.", operations: ["registerRail(registry)"] },
    ],
    relations: [
      { from: "Track", to: "systems", kind: "depends", label: "params, band" },
      { from: "SystemChange", to: "systems", kind: "depends", label: "card" },
      { from: "rail", to: "SystemChange", kind: "creates", label: "registers" },
    ],
    activities: [{
      id: "band", name: "A track coloured by a system",
      description: "Track.draw while View → Colour the tracks by is set (world.settings.trackSystems).",
      nodes: [
        ["s", "start"],
        ["d1", "decision", "A system chosen?"],
        ["a1", "action", "Its value: set on the track, else usual in its country", "sectionSystems"],
        ["a2", "action", "A band in the value's colour, the value at its middle", "drawSystemBand"],
        ["a3", "action", "Where tracks meet end to end with a different value (cached)", "worldSystemChanges"],
        ["d2", "decision", "A change this track starts?"],
        ["a4", "action", "An orange mark with both values", "drawSystemChange"],
        ["m1", "merge"],
        ["e", "end"],
      ],
      edges: [["s", "d1"], ["d1", "a1", "yes"], ["d1", "m1", "no"], ["a1", "a2"], ["a2", "a3"], ["a3", "d2"], ["d2", "a4", "yes"], ["d2", "m1", "no"], ["a4", "m1"], ["m1", "e"]],
    }],
    parameters: [
      { key: "track.country", default: "DE", meaning: "The country of the section: what is usual there fills the systems left empty." },
      { key: "track.power, pantograph_mm, train_control, etcs, signalling, radio, gauge_mm, route_class, loading_gauge, im", default: "\"\" (as usual)", meaning: "The section's systems." },
      { key: "track.max_speed_kmh", default: "not known", meaning: "The line speed." },
      { key: "settings.trackSystems", default: "\"\" (off)", meaning: "View → Colour the tracks by: the system shown." },
    ],
    rules: [
      "A section's value is its own if set, else the one usual in its country; the country defaults to Germany.",
      "Two sections meet when ends of their tracks are within 25 mm; a change is a system whose values differ.",
      "Line categories (EN 15528): A 16 t, B 18 t, C 20 t, D 22.5 t, E 25 t per axle; 1 5 t, 2 6.4 t, 3 7.2 t, 4 8 t, 5 8.8 t, 6 10 t per metre.",
    ],
  },
];
