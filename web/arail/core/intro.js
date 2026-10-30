/**
 * The introduction to a layout: a short film of scenes about what is real in the lab (the table,
 * its tracks and platforms, the markers) and what the app adds (the town, its streets and lines,
 * people, table modules, the modules to switch on). The scenes are made from the layout as it is,
 * so every layout gets its own film, and a scene without anything to show is left out. A front end
 * plays them (the app: app/intro.js): it takes the camera to each scene's place, shows the photo
 * without or with what the app draws, and outlines what the scene is about.
 *
 * The texts are English sentences without numbers, to be translated as they are; what can be
 * counted or named is in a scene's `facts` ([label, value]: "Tracks", 8).
 * @module arail/core/intro
 */

/** Seconds a scene is shown while the film plays: at least, at most, and per word of its text. */
export const SCENE_SECONDS = Object.freeze({ min: 6, max: 14, perWord: 0.3 });

/**
 * A scene of the introduction.
 * @typedef {object} IntroScene
 * @property {string} id
 * @property {string} title
 * @property {string[]} text its sentences
 * @property {"real" | "virtual" | "both"} kind what it shows: real things of the lab, what the app draws, or both
 * @property {Array<[string, string | number]>} facts what can be counted or named ("Tracks", 8)
 * @property {string[]} focus the ids of the objects it is about (outlined)
 * @property {number[] | null} bounds [xmin, ymin, xmax, ymax] layout mm of the place it shows; null: the whole layout
 * @property {"camera" | "flyover"} view the camera image (the photo) or the flyover
 * @property {number} overlay in the camera image, how much of what the app draws is shown (0: the photo alone)
 * @property {number} seconds how long it is shown while the film plays
 */

/** Object types of the streets (crossings, signs, parking too), of the stops and of the lines. */
const STREETS = new Set(["road", "underpass", "zebra-crossing", "traffic-sign", "traffic-light", "rail-crossing", "parking-lot", "parking-garage", "bike-stand"]);
const STOPS = new Set(["bus-terminal", "bus-stop", "tram-stop"]);
/** Half the width and depth (layout mm) of the place where the scene People looks at the people waiting. */
const PEOPLE_MM = [450, 300];
/** Infrastructure that is no asset of its own: tracks have their scene, labels and system changes are signs. */
const NO_ASSET = new Set(["track", "label", "system-change"]);

/**
 * The scenes of a layout's introduction, in order.
 * @param {import("./world.js").World} world
 * @param {{photo?: boolean}} [options] photo: the layout is shown over a photo (or the camera), so
 *   the film can show the photo alone and then what the app draws over it
 * @returns {IntroScene[]}
 */
export function introScenes(world, { photo = false } = {}) {
  const placed = world.objects.filter((o) => o.geometry);
  const typed = (types) => placed.filter((o) => types.has(o.type));
  const category = (name) => placed.filter((o) => o.constructor.category === name);
  const running = (type) => world.simulations.some((s) => s.enabled !== false && s.constructor.type === type);
  const scenes = [];
  const add = (scene) => {
    const s = { kind: "both", facts: [], focus: [], bounds: null, view: "flyover", overlay: 1, ...scene };
    s.focus = s.focus.map((o) => o.id);
    s.seconds = sceneSeconds(s.text);
    scenes.push(s);
  };
  // at the photo, or in the flyover where there is none
  const shot = photo ? { view: "camera" } : {};
  const tables = category("Table"), tracks = typed(new Set(["track"])), platforms = typed(new Set(["platform"]));
  const realTracks = tracks.filter((o) => o.real), markers = world.map.ids().length;

  add({
    id: "welcome", title: world.layout.name || "This layout", ...shot,
    text: ["A model railway in the lab, and a virtual world the app draws around it.", "This short film shows what is real and what is virtual."],
    facts: [["Scale", `1:${world.scale}`]],
  });

  const real = placed.filter((o) => o.real);
  if (real.length || markers) {
    add({
      id: "real", title: "What is real", kind: "real", focus: real, bounds: photo ? null : boundsOf(real), ...shot, overlay: 0,
      text: [
        photo ? "The photo alone: this is what really stands in the lab." : "The outlined parts really stand in the lab.",
        markers ? "From the markers on the table the app knows where the camera looks from, and so where to draw everything else." : null,
      ].filter(Boolean),
      facts: counts([["Tables", tables.filter((o) => o.real).length], ["Tracks", realTracks.length], ["Platforms", platforms.length], ["Markers", markers]]),
    });
  }

  const virtual = placed.filter((o) => !o.real);
  if (photo && virtual.length) {
    add({
      id: "virtual", title: "What the app adds", kind: "virtual", view: "camera",
      text: [
        category("Buildings").length ? "Over the photo the app draws what is not really there: buildings, streets, people and vehicles." : "Over the photo the app draws what is not really there.",
        "What moves reacts to what happens on the layout.",
      ],
      facts: counts([["Buildings", category("Buildings").length], ["Streets", typed(new Set(["road"])).length], ["Trees", typed(new Set(["tree"])).length]]),
    });
  }

  if (realTracks.length || platforms.length) {
    const station = [...platforms, ...typed(new Set(["station-building", "underpass"]))];
    add({
      id: "station", title: "Tracks and platforms", kind: kindOf([...realTracks, ...platforms]), focus: [...realTracks, ...platforms],
      bounds: boundsOf(station.length ? station : realTracks, 0.25),
      text: [
        "Trains of the lab run on the real tracks.",
        running("passengers") ? "The app sends trains of its own to the platforms and puts passengers there; the boards show the next departures." : null,
      ].filter(Boolean),
      facts: counts([["Tracks", realTracks.length], ["Platforms", platforms.length]]),
    });
  }

  const assets = category("Infrastructure").filter((o) => !NO_ASSET.has(o.type));
  if (assets.length) {
    add({
      id: "infrastructure", title: "Signals and the interlocking", kind: kindOf(assets), focus: assets, bounds: boundsOf(assets, 0.2),
      text: ["Signals, switches and the interlocking belong to the infrastructure manager.", "Each of them has an age and a condition: old ones fail more often."],
      facts: byType(assets),
    });
  }

  const modules = tables.filter((o) => !o.real);
  if (modules.length) {
    add({
      id: "tables", title: "Virtual table modules", kind: "virtual", focus: modules, bounds: boundsOf(modules, 0.05),
      text: ["Table modules that are not in the lab extend the real table: they give the town more room."],
      facts: [["Table modules", modules.length]],
    });
  }

  const buildings = category("Buildings");
  if (buildings.length) {
    add({
      id: "town", title: "The town", kind: kindOf(buildings), focus: buildings, bounds: boundsOf(buildings, 0.05),
      text: [
        "Homes, offices, schools and shops around the station.",
        running("town") ? "The people who live here go to work, to school and shopping: on foot, by bike, by car and by bus." : null,
        "At night their windows light up.",
      ].filter(Boolean),
      facts: counts([["Buildings", buildings.length], ["Trees", typed(new Set(["tree"])).length]]),
    });
  }

  const streets = typed(STREETS), stops = typed(STOPS), busLines = typed(new Set(["bus-line"])), tramLines = typed(new Set(["tram-line"]));
  if (streets.length || stops.length) {
    add({
      id: "streets", title: "Streets, buses and trams", kind: "virtual", focus: [...streets, ...stops], bounds: boundsOf(streets.length ? streets : stops, 0.05),
      text: [
        running("traffic") || running("cycling") ? "Cars, bikes and people on foot share the streets, with crossings, signs and traffic lights." : "Streets with crossings, signs and traffic lights.",
        busLines.length || tramLines.length ? "Buses and trams run on their lines, from stop to stop." : null,
      ].filter(Boolean),
      facts: [...counts([["Streets", typed(new Set(["road"])).length], ["Stops", stops.length]]), ...names("Bus lines", busLines), ...names("Tram lines", tramLines)],
    });
  }

  // where people wait: a platform, else the bus station or a stop
  const people = ["passengers", "town", "cycling"].filter(running), at = platforms[0] || stops.find((o) => o.type === "bus-terminal") || stops[0] || null;
  if (people.length && (at || buildings.length)) {
    add({
      id: "people", title: "People", kind: "virtual", focus: at ? [at] : [], bounds: at ? around(at.anchorPoint(), PEOPLE_MM) : null,
      text: [
        people.includes("passengers") ? "Each person has a trip of their own: passengers wait for their train or bus, and get on when it comes." : "Each person has a trip of their own.",
        people.includes("town") ? "Residents walk from their homes to the stops, to work and to the shops." : null,
        "Tap a person to see who it is and where they are going.",
      ].filter(Boolean),
    });
  }

  const terminal = category("Terminal");
  if (terminal.length) {
    add({
      id: "terminal", title: "Container terminal", kind: kindOf(terminal), focus: terminal, bounds: boundsOf(terminal, 0.15),
      text: ["A gantry crane moves containers between trains, trucks and the yard."],
      facts: byType(terminal),
    });
  }

  if (world.layout.markers?.rolling) {
    add({
      id: "wagons", title: "Model wagons", kind: "real",
      text: ["The model wagons carry small markers of their own: the app knows where each wagon stands and puts containers on it."],
    });
  }

  const layers = world.layers();
  if (layers.length) {
    add({
      id: "modules", title: "Modules",
      text: ["Modules add more to the layout: lines, stations, a terminal, stories.", "Switch them on in the Sandbox, or start a scenario that shows one at work."],
      facts: layers.map((l) => [l.name, l.enabled ? "on" : "off"]),
    });
  }

  add({
    id: "end", title: "Your turn", ...shot,
    text: ["Tap anything on the stage to see what it is.", "Then start a scenario: each one gives you a small task to try."],
  });
  return scenes;
}

/** How long a scene is shown while the film plays (seconds), by the words of its text. */
export function sceneSeconds(text) {
  const words = (Array.isArray(text) ? text : [text]).join(" ").split(/\s+/).filter(Boolean).length;
  return Math.round(Math.min(SCENE_SECONDS.max, Math.max(SCENE_SECONDS.min, words * SCENE_SECONDS.perWord)) * 10) / 10;
}

/** The outline around these objects' footprints (layout mm), grown by a share of its size; null without any. */
export function boundsOf(objects, grow = 0) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const o of objects) {
    for (const p of o.footprint?.() || []) {
      b[0] = Math.min(b[0], p[0]);
      b[1] = Math.min(b[1], p[1]);
      b[2] = Math.max(b[2], p[0]);
      b[3] = Math.max(b[3], p[1]);
    }
  }
  if (!(b[2] >= b[0])) return null;
  const gx = (b[2] - b[0]) * grow, gy = (b[3] - b[1]) * grow;
  return [b[0] - gx, b[1] - gy, b[2] + gx, b[3] + gy];
}

/** The rectangle of half size [w, d] (layout mm) around a point; null without the point. */
function around(p, [w, d]) {
  return p ? [p[0] - w, p[1] - d, p[0] + w, p[1] + d] : null;
}

/** "real" when all of them are real, "virtual" when none is, else "both". */
function kindOf(objects) {
  const real = objects.filter((o) => o.real).length;
  return real === objects.length ? "real" : real ? "both" : "virtual";
}

/** The facts that are not zero. */
function counts(facts) {
  return facts.filter(([, n]) => n > 0);
}

/** How many of each type ("Signal", 3), the most first. */
function byType(objects) {
  const n = new Map();
  for (const o of objects) n.set(o.constructor.label, (n.get(o.constructor.label) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The names of the lines as one fact ("Bus lines", "7, 261, 262"), or none. */
function names(label, lines) {
  const list = lines.map((o) => o.spec.number || o.spec.name || o.id);
  return list.length ? [[label, list.join(", ")]] : [];
}
