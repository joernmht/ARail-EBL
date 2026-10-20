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
    summary: "A catalogue of vehicles (locomotives, multiple units, coaches, freight wagons) with length, masses, axles, brake weights, seats and standing places and what they are equipped with; the consist of a train with its length, mass, top speed, brake percentage, axle and metre loads and places; the default fleet of the trains at the platforms; the train data on the info card of a train.",
    description: "The layout file's consists give the vehicles of trains by line or train number (vehicle_types adds types of its own). consistFor finds the consist of a train the world shows: a vehicle at a platform (its line; with rail operations its trip's line and its units), a train of the control system (its number). trainConsist gives every train at a platform its consist, kept on it: a planner's own, the layout's, its units, else the default fleet by the kind of its line (DEFAULT_FLEET: RE a locomotive with four double-deck coaches, RB a two-car unit, S a four-car unit); in the rush hours an entry's peak couples its vehicles as often as the platform takes them. The card provider trainCard, registered with registerRail, adds the train data to the card of every train that is pointed at: the consist as a strip and the figures, the brake percentage against the one its track requires (track.min_brake_percentage). consistProblems, a check of the registry, names unknown vehicle types in a layout file.",
    files: ["web/arail/rail/vehicles.js", "web/arail/rail/trains.js", "web/arail/rail/index.js"],
    classes: [
      {
        name: "Consist", file: "web/arail/rail/vehicles.js", kind: "class", role: "The vehicles of a train in order, with the train's figures.",
        attributes: ["vehicles: object[] — type, catalogue entry, load share, brakes isolated", "brakePosition: string — G, P, R or R+Mg", "length_m", "mass_t", "axles", "seats", "standing", "capacity — seats and standing places", "brakeWeight_t", "brakePercentage — brake weights / mass × 100", "vmax — the lowest top speed and its vehicle", "maxAxleLoad", "maxMetreLoad", "summary — e.g. BR 146.2 + 4 × DBpza"],
        operations: ["static massOf(v)", "static brakeWeightOf(v, position) — its own, else the nearest slower, else faster position; load-dependent; 0 when isolated"],
      },
      {
        name: "vehicles", file: "web/arail/rail/vehicles.js", kind: "module", role: "The catalogue.",
        attributes: ["VEHICLE_TYPES — typical values, rounded; seats, standing places, the cars of a unit", "BRAKE_POSITIONS", "VEHICLE_KINDS"],
        operations: ["consistRows(c) — the rows of a card, with its places"],
      },
      {
        name: "trains", file: "web/arail/rail/trains.js", kind: "module", role: "The consists of the world's trains and their card.",
        attributes: ["DEFAULT_FLEET — by the kind of a line: RE, RB, S, any other", "PEAK_DEMAND — the timetable's demand from which units run coupled"],
        operations: ["vehicleTypes(world) — the catalogue and the layout's own", "consistFor(world, who) — by train number, line or units", "trainConsist(world, v) — of a train at a platform, kept on it; the default fleet; coupled in the rush hours", "fleetEntry(line) — by the letters the line begins with", "consistOfHit(world, hit) — of a train pointed at", "trainCard(world, hit, card) — card provider", "consistProblems(json) — layout check"],
      },
      { name: "rail", file: "web/arail/rail/index.js", kind: "module", role: "The package's API.", operations: ["registerRail(registry) — the system change object, the trains at the platforms (RAIL_TRAIN), the train data card, the check of the consists"] },
    ],
    relations: [
      { from: "trains", to: "Consist", kind: "creates", label: "consistFor, trainConsist" },
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
      { key: "consists[]", default: "[]", meaning: "{id, name, lines, trains, vehicles: [{type, count, loaded, isolated}], brake_position, peak}: the vehicles of trains by line or train number; peak: that many times, coupled, in the rush hours where the platform takes them." },
      { key: "vehicle_types", default: "{}", meaning: "Vehicle types of the layout's own, as in the catalogue." },
      { key: "track.min_brake_percentage", default: "not known", meaning: "The brake percentage trains need on the section (Mindestbremshundertstel)." },
    ],
    rules: [
      "Brake percentage = sum of the brake weights in the train's brake position / train mass × 100 (isolated brakes count 0).",
      "The brake position: as given, else G for freight trains (only locomotives and wagons), else R when a vehicle has an R brake weight, else P.",
      "A wagon's brake weight and mass go from empty to loaded with its load (a load-dependent brake).",
      "Axle load = mass / axles; metre load = mass / length over buffers (EN 15528).",
      "A train at a platform without a consist of the layout runs as the default fleet has it for the kind of its line (the letters it begins with: RE, RB, S); a train of the control system has none then.",
      "Coupled in the rush hours: when the timetable's demand was at least PEAK_DEMAND when it was sent, as often as peak says and the platform's length (less 6 m) takes.",
    ],
  },
  {
    id: "stock", group: "rail", title: "Trains at the platforms",
    summary: "The trains at the platforms drawn solid from their vehicles, as long as they are, on their track: the cars of a multiple unit with cabs at its ends, locomotives, coaches, double-deck coaches, in the livery of their type; they stop with their front near the end of the platform, come in and leave along the track, and open their doors along it. The units of the operations story are drawn the same way.",
    description: "RAIL_TRAIN, registered by registerRail in place of core's box over the whole platform track, is what the services ask of a train: pose (where it is along its track), doorsOf (its doors along the platform, for the passengers), outline (for pointing at it), capacity (seats and standing places of its consist, for boarding) and draw. The line of a dock is its track (the track object with its track id), else a straight line along the platform's edge; carsOf makes the cars of a consist with the look of their type (LOOKS; else by its kind), drawTrain draws them along the line from the front backwards.",
    files: ["web/arail/rail/stock.js", "web/arail/rail/draw.js"],
    classes: [
      {
        name: "rail stock", file: "web/arail/rail/stock.js", kind: "module", role: "The trains at the platforms.",
        attributes: ["LOOKS — by vehicle type: livery, doors, decks, heights", "STOP_MARGIN_M — the front's distance from the platform's end", "RAIL_TRAIN — the vehicle of kind train: pose, doorsOf, outline, capacity, draw"],
        operations: ["carsOf(consist) — the cars, with cabs, doors, pantographs and their look", "dockLine(world, dock) — the track, else a line along the platform; kept per layout", "trainPose(world, v) — its cars, its front along the line, its direction; coming in and leaving as far as it is long", "trainDoors(world, v) — along the platform (m)", "trainOutline(pose)"],
      },
      {
        name: "rail draw", file: "web/arail/rail/draw.js", kind: "module", role: "Drawing trains along a line.",
        attributes: ["LIVERIES — talent, regio, coach, loco, wagon, plain"],
        operations: ["drawTrain(view, line, t, o) — car by car: body, band, windows (two rows on double-deck coaches, lit at night), doors open on the platform's side, cab windscreens, pantographs, head and tail lights", "turnCars(cars) — the driver changed ends", "carsLength(cars)", "drawPantograph(view, A, ax, m, mz, roof, up, a, colour, ref) — folded down or raised"],
      },
    ],
    relations: [
      { from: "rail stock", to: "rail draw", kind: "depends", label: "drawTrain" },
      { from: "rail stock", to: "Consist", kind: "uses", label: "trainConsist: its vehicles" },
      { from: "ServiceManager", to: "rail stock", kind: "uses", label: "RAIL_TRAIN (registered)" },
    ],
    rules: [
      "A train stops with its front 3 m before the end of the platform in its direction of travel; one longer than the platform stands out beyond its back.",
      "It comes in over as far as it is long and 40 m more, and leaves the same way, in the services' approach time.",
      "Doors are where its cars have them; only those beside the platform are used.",
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
