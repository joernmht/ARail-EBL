/**
 * Models of the architecture page: the railway systems of the track sections. See ../model.js.
 * @module architecture/models/rail
 */
export const RAIL = [
  {
    id: "systems", group: "rail", title: "Railway systems of the sections",
    summary: "Every track is a section with its traction power, train protection, ETCS, signals, radio, gauge, line category, loading gauge, line speed, country and infrastructure manager; View → Colour the tracks by shows one of them on the table.",
    description: "The systems are parameters of the track object; a value left empty is the one usual in the section's country (COUNTRIES: typical values, simplified). Their names follow the parameters of the EU Register of Infrastructure (RINF). sectionSystems resolves a section's values, systemChanges finds where neighbouring sections meet end to end with a different value. With the world setting trackSystems a track draws a band in the colour of its value and the changes it starts; the info card of a track lists all its systems. The system change object marks where a system changes (a separation section, a train control transition, a border, the boundary between infrastructure managers) and says what happens there.",
    files: ["web/arail/rail/systems.js", "web/arail/rail/objects.js"],
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
    ],
    relations: [
      { from: "Track", to: "systems", kind: "depends", label: "params, band" },
      { from: "SystemChange", to: "systems", kind: "depends", label: "card" },
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
  {
    id: "trains", group: "rail", title: "Vehicles and trains",
    summary: "A catalogue of vehicles (locomotives, multiple units, coaches, freight wagons) with length, masses, axles, brake weights and what they are equipped with; the consist of a train with its length, mass, top speed, brake percentage, axle and metre loads; the train data on the info card of a train.",
    description: "The layout file's consists give the vehicles of trains by line or train number (vehicle_types adds types of its own). consistFor finds the consist of a train the world shows: a vehicle at a platform (its line; with rail operations its trip's line and its units), a train of the control system (its number). The card provider trainCard, registered with registerRail, adds the train data to the card of every train that is pointed at: the consist as a strip and the figures, the brake percentage against the one its track requires (track.min_brake_percentage). consistProblems, a check of the registry, names unknown vehicle types in a layout file.",
    files: ["web/arail/rail/vehicles.js", "web/arail/rail/trains.js", "web/arail/rail/index.js"],
    classes: [
      {
        name: "Consist", file: "web/arail/rail/vehicles.js", kind: "class", role: "The vehicles of a train in order, with the train's figures.",
        attributes: ["vehicles: object[] — type, catalogue entry, load share, brakes isolated", "brakePosition: string — G, P, R or R+Mg", "length_m", "mass_t", "axles", "brakeWeight_t", "brakePercentage — brake weights / mass × 100", "vmax — the lowest top speed and its vehicle", "maxAxleLoad", "maxMetreLoad", "summary — e.g. BR 146.2 + 4 × DBpza"],
        operations: ["static massOf(v)", "static brakeWeightOf(v, position) — its own, else the nearest slower, else faster position; load-dependent; 0 when isolated"],
      },
      {
        name: "vehicles", file: "web/arail/rail/vehicles.js", kind: "module", role: "The catalogue.",
        attributes: ["VEHICLE_TYPES — typical values, rounded", "BRAKE_POSITIONS", "VEHICLE_KINDS"],
        operations: ["consistRows(c) — the rows of a card"],
      },
      {
        name: "trains", file: "web/arail/rail/trains.js", kind: "module", role: "The consists of the world's trains and their card.",
        operations: ["vehicleTypes(world) — the catalogue and the layout's own", "consistFor(world, who) — by train number, line or units", "consistOfHit(world, hit) — of a train pointed at", "trainCard(world, hit, card) — card provider", "consistProblems(json) — layout check"],
      },
      { name: "rail", file: "web/arail/rail/index.js", kind: "module", role: "The package's API.", operations: ["registerRail(registry) — the system change object, the train data card, the check of the consists"] },
    ],
    relations: [
      { from: "trains", to: "Consist", kind: "creates", label: "consistFor" },
      { from: "Consist", to: "vehicles", kind: "depends", label: "VEHICLE_TYPES" },
      { from: "rail", to: "trains", kind: "depends", label: "registers" },
      { from: "rail", to: "SystemChange", kind: "creates", label: "registers" },
    ],
    activities: [{
      id: "train-card", name: "The train data of a train pointed at",
      description: "World.card runs the card providers of the registry; trainCard adds to the card of a train.",
      nodes: [
        ["s", "start"],
        ["d1", "decision", "A train?"],
        ["a1", "action", "Its number, its line (with rail operations the trip's), its units", "trainCard"],
        ["a2", "action", "The layout's consist for its number or line, else its units", "consistFor"],
        ["d2", "decision", "A consist?"],
        ["a3", "action", "Say that none is known", "trainCard"],
        ["a4", "action", "Length, mass, axles, top speed, brake position and percentage, axle and metre loads", "consistRows"],
        ["d3", "decision", "Its track requires a brake percentage?"],
        ["a5", "action", "Met or not (then the card warns)", "trainCard"],
        ["m1", "merge"],
        ["a6", "action", "The vehicles as a strip", "trainCard"],
        ["a7", "action", "May it run on its track (compat)? If not, the card says so", "trainCard"],
        ["a8", "action", "May it run on each track of the layout; an action to show it on the tracks", "trainCard"],
        ["e", "end"],
      ],
      edges: [["s", "d1"], ["d1", "a1", "yes"], ["d1", "e", "no"], ["a1", "a2"], ["a2", "d2"], ["d2", "a3", "no"], ["d2", "a4", "yes"], ["a3", "e"], ["a4", "d3"], ["d3", "a5", "yes"], ["d3", "m1", "no"], ["a5", "m1"], ["m1", "a6"], ["a6", "a7"], ["a7", "a8"], ["a8", "e"]],
    }],
    parameters: [
      { key: "consists[]", default: "[]", meaning: "{id, name, lines, trains, vehicles: [{type, count, loaded, isolated}], brake_position}: the vehicles of trains by line or train number." },
      { key: "vehicle_types", default: "{}", meaning: "Vehicle types of the layout's own, as in the catalogue." },
      { key: "track.min_brake_percentage", default: "not known", meaning: "The brake percentage trains need on the section (Mindestbremshundertstel)." },
    ],
    rules: [
      "Brake percentage = sum of the brake weights in the train's brake position / train mass × 100 (isolated brakes count 0).",
      "The brake position: as given, else G for freight trains (only locomotives and wagons), else R when a vehicle has an R brake weight, else P.",
      "A wagon's brake weight and mass go from empty to loaded with its load (a load-dependent brake).",
      "Axle load = mass / axles; metre load = mass / length over buffers (EN 15528).",
    ],
  },
  {
    id: "compat", group: "rail", title: "May this train run here?",
    summary: "The route compatibility check: a train's vehicles against the systems of a section, on the card of a train and as the colour of the tracks.",
    description: "Every vehicle type of the catalogue has a capability profile: the traction power it draws and its pantograph heads, its train protection and ETCS level, its train radio, its track gauge and the countries it is authorised in. checkSection compares a consist with the resolved systems of a section and names every reason it may not run there; the train data card lists the result for each track and warns when the train may not run on its own track. Its action “Show where it may run” sets world.compatibilityTrain and the overlay compatibility of View → Colour the tracks by: then every track is drawn turquoise where the train may run and red where not, with the first reason.",
    files: ["web/arail/rail/compat.js"],
    classes: [
      {
        name: "compat", file: "web/arail/rail/compat.js", kind: "module", role: "The check, its card section and its band on the tracks.",
        attributes: ["COMPATIBILITY — the overlay's key"],
        operations: ["checkSection(consist, spec) — ok, problems with the system they concern, notes", "checkTracks(consist, world) — for every track", "compatibilitySection(consist, world) — a section of a card", "drawCompatibilityBand(view, track, consist)"],
      },
    ],
    relations: [
      { from: "compat", to: "Consist", kind: "depends", label: "vehicles, loads" },
      { from: "Track", to: "compat", kind: "depends", label: "band" },
    ],
    activities: [{
      id: "check", name: "May a train run on a section?",
      description: "checkSection, for a consist and the spec of a track.",
      nodes: [
        ["s", "start"],
        ["a1", "action", "The section's systems: its own, else usual in its country (sectionSystems)", "checkSection"],
        ["d1", "decision", "A locomotive, multiple unit or railcar?"],
        ["a2", "action", "The train cannot move by itself", "checkSection"],
        ["a3", "action", "Power: a diesel, or an electric vehicle that draws it with fitting pantograph heads", "checkSection"],
        ["a4", "action", "Train protection of the leading vehicle: the class B system, or ETCS at the section's level", "checkSection"],
        ["a5", "action", "Train radio", "checkSection"],
        ["m1", "merge"],
        ["a6", "action", "Track gauge of every vehicle", "checkSection"],
        ["a7", "action", "Axle and metre load against the line category (routeClassLimits)", "checkSection"],
        ["a8", "action", "Every vehicle authorised in the section's country", "checkSection"],
        ["d2", "decision", "Any problem?"],
        ["a9", "action", "May run", "checkSection"],
        ["a10", "action", "May not run, with the reasons", "checkSection"],
        ["e", "end"],
      ],
      edges: [["s", "a1"], ["a1", "d1"], ["d1", "a2", "no"], ["d1", "a3", "yes"], ["a2", "m1"], ["a3", "a4"], ["a4", "a5"], ["a5", "m1"], ["m1", "a6"], ["a6", "a7"], ["a7", "a8"], ["a8", "d2"], ["d2", "a9", "no"], ["d2", "a10", "yes"], ["a9", "e"], ["a10", "e"]],
    }],
    parameters: [
      { key: "vehicle type: power, pantograph_mm, train_control, etcs, radio, gauge_mm, countries", default: "per type", meaning: "The capability profile of a vehicle type (vehicle_types of a layout as well)." },
      { key: "settings.trackSystems = \"compatibility\"", default: "off", meaning: "The tracks coloured by whether world.compatibilityTrain may run there; not kept between sessions." },
    ],
    rules: [
      "A diesel vehicle runs on any section; an electric one needs the section's power and pantograph heads of its width, unless a diesel in the train hauls it.",
      "The leading traction vehicle needs the section's class B train protection (PZB for PZB with LZB), or ETCS at the section's level or higher; a section without either asks for nothing.",
      "Every vehicle needs the section's track gauge and an authorisation for its country; the heaviest axle and metre load must be within the line category.",
    ],
  },
];
