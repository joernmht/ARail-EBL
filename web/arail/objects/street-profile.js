/**
 * Cross-sections of streets (Straßenquerschnitte): what lies side by side across a street, from its
 * centre line out to the houses, with the standard widths of the German guidelines as defaults.
 *
 * A street (objects/road.js) has a **profile**: a plain street without sidewalks, with sidewalks,
 * with bike lanes on the street (advisory lanes with a dashed line, or bike lanes with a solid one),
 * with bike paths at sidewalk level, or with shared foot and bike paths. Bike lanes and paths make
 * the street wider: `width_m` is always the width of the car lanes (the core carriageway). Tram
 * tracks lie in the car lanes, in lanes of their own in the middle, or on a track bed of their own
 * in the middle (`tram`); street parking adds a parking strip on one or both sides (`parking`).
 *
 * `crossSection(spec)` turns these settings into **strips** (car lanes, bike lanes, parking,
 * buffers, bike paths, sidewalks, tram lanes and the track bed), each with its distance from the
 * centre line, and works out what the simulations need: where cars, bikes, trams and people go,
 * which widths are below the minimum of the guidelines, whether a bike holds up the cars behind it
 * and how often riders and people on foot get in each other's way. Everything is in prototype
 * metres; the street converts it to layout millimetres.
 *
 * The widths (`NORMS`) are those of RASt 06 (Richtlinien für die Anlage von Stadtstraßen), ERA 2010
 * (Empfehlungen für Radverkehrsanlagen), EFA 2002 (Fußgängerverkehrsanlagen), EAR 05 (ruhender
 * Verkehr), the VwV-StVO and BOStrab; see docs/streets-and-buses.md for the sources.
 *
 * A **pedestrian zone** (Fußgängerzone, Zeichen 242.1, kind `pedestrian`) is one strip paved from
 * house to house: people stroll along the shop windows on both sides, bikes ride through only where
 * they are allowed (Radverkehr frei, at walking pace), and trams may run through it on tracks in the
 * paving.
 * @module arail/objects/street-profile
 */

/**
 * Standard widths (prototype metres). `default` is the regular width of the guideline, `min` the
 * smallest one it allows, `values` the usual choices (offered in the editors; any other width can
 * be typed in).
 */
export const NORMS = {
  /**
   * The car lanes of a two-way street (Fahrbahn), by who has to pass whom (RASt 06): two cars 4.50 m
   * (4.10 m tight), a truck and a car 5.50 m, two buses 6.50 m, two buses often 7.00 m.
   */
  carriageway: { carCar: 4.5, tight: 4.1, truckCar: 5.5, busBus: 6.5, busBusOften: 7.0, values: [4.5, 5.5, 6.5, 7.0], source: "RASt 06" },
  /** A car lane: 3.25 m with buses, 3.00 m next to a bike lane; two lanes in one direction 5.00 to 6.50 m (RASt 06). */
  carLane: { default: 3.25, min: 2.5, values: [3.0, 3.25, 3.5], source: "RASt 06" },
  /** A sidewalk (Seitenraum): 0.20 m to the houses + 1.80 m for two people to pass + 0.50 m to the cars (RASt 06); EFA 2002 by the houses along it. */
  sidewalk: { default: 2.5, min: 2.5, walking: 1.8, values: [1.8, 2.1, 2.5, 3.3, 4.0, 5.0], source: "RASt 06, EFA 2002, DIN 18040-3" },
  /** Advisory bike lane (Schutzstreifen, dashed line, cars may cross it when needed); at least 4.50 m of car lanes between two. */
  advisoryLane: { default: 1.5, min: 1.25, values: [1.25, 1.5, 2.0], core: 4.5, source: "ERA 2010" },
  /** Bike lane (Radfahrstreifen, solid line, Zeichen 237), including the 0.25 m line. */
  bikeLane: { default: 1.85, min: 1.5, values: [1.5, 1.85, 2.25], source: "ERA 2010, VwV-StVO" },
  /** Bike path at sidewalk level (Radweg, one way); 1.60 m where few ride. */
  bikePath: { default: 2.0, min: 1.6, values: [1.6, 2.0, 2.5], source: "ERA 2010" },
  /** Shared foot and bike path (gemeinsamer Geh- und Radweg, Zeichen 240) in towns: 2.50 m to more than 4.00 m by how many use it. */
  sharedPath: { default: 2.5, min: 2.5, values: [2.5, 3.0, 4.0], source: "ERA 2010, VwV-StVO" },
  /** Safety strip (Sicherheitstrennstreifen) between a bike lane or path and the cars (0.50 m), or the parked cars (0.75 m). */
  buffer: { road: 0.5, parking: 0.75, source: "ERA 2010" },
  /** Parking strips (EAR 23): depth across the street, length of a space along it, the aisle to drive in. */
  parking: {
    parallel: { depth: 2.0, length: 5.7, source: "EAR 23" },
    angled: { depth: 4.35, length: 3.75, aisle: 3.5, source: "EAR 23 (45°)" },
    perpendicular: { depth: 5.2, length: 2.65, aisle: 6.0, source: "EAR 23" },
  },
  /**
   * Trams: the widest vehicle (BOStrab § 34), the distance between the tracks for it, a tram lane,
   * a track bed of its own for two tracks or one (about 6 m and 3 m), the platform (BOStrab § 31).
   */
  tram: { vehicle: 2.65, spacing: 3.4, lane: 3.25, bedDouble: 6.6, bedSingle: 3.4, platform: 2.0, source: "BOStrab §§ 31, 34" },
  /**
   * A pedestrian zone from house to house; people stroll this far from the house fronts (the shop
   * windows), and beside trams they keep a sidewalk's width on each side.
   */
  zone: { default: 12, values: [8, 10, 12, 15, 20], walk: 2.5 },
};

/** The profile of a pedestrian zone (kind `pedestrian`): one paved strip. */
export const ZONE_PROFILE = "zone";

/** Profiles of streets: label, whether there are sidewalks, what bikes get and at which level. */
export const STREET_PROFILES = {
  plain: { label: "plain street (no sidewalks)", sidewalks: false, bike: "road" },
  sidewalks: { label: "with sidewalks", sidewalks: true, bike: "road" },
  "advisory-lanes": { label: "advisory bike lanes (dashed line)", sidewalks: true, bike: "advisory", level: "street" },
  "bike-lanes": { label: "bike lanes on the street", sidewalks: true, bike: "lane", level: "street" },
  "bike-paths": { label: "bike paths at sidewalk level", sidewalks: true, bike: "path", level: "sidewalk" },
  "shared-paths": { label: "shared foot and bike paths", sidewalks: true, bike: "shared", level: "sidewalk" },
};

/** What footpaths (kind `path`) can be: for people on foot, shared with bikes, or for bikes only. */
export const PATH_PROFILES = {
  plain: { label: "footpath (people on foot)", bike: "none", walk: true },
  "shared-paths": { label: "shared foot and bike path (Zeichen 240)", bike: "shared", walk: true },
  "bike-paths": { label: "bike path (Zeichen 237)", bike: "path", walk: false },
};

/** Where tram tracks lie in a street (BOStrab § 16: straßenbündiger and besonderer Bahnkörper). */
export const TRAM_LAYOUTS = {
  none: { label: "no tram" },
  street: { label: "in the car lanes (shared with cars)" },
  lanes: { label: "in lanes of their own in the middle (cars may cross)" },
  median: { label: "on a track bed of their own in the middle" },
};

/** Tracks of a tram line in a street or on its own track bed. */
export const TRAM_TRACKS = {
  double: { label: "two tracks" },
  single: { label: "one track, both directions" },
  "single-oneway": { label: "one track, one direction (as drawn)" },
};

/** How cars park along a street. */
export const PARKING_LAYOUTS = {
  none: { label: "no parking" },
  parallel: { label: "parallel to the curb" },
  angled: { label: "angled (45°)" },
  perpendicular: { label: "perpendicular" },
};

/** Car width + 1.5 m passing distance (StVO § 5) + a rider and some room: below this a car cannot pass a bike in its lane (m). */
export const PASS_M = 4.6;
/** How far from the curb a rider on the road rides (m, centre of the bike). */
export const ROAD_RIDE_M = 0.8;

/** A finite positive number, else the fallback. */
const positive = (v, fallback) => (Number(v) > 0 ? Number(v) : fallback);

/** The profile of a street spec; old layouts have none: no sidewalks (`sidewalk_m` 0) means plain. */
export function profileOf(spec = {}) {
  if (spec.kind === "pedestrian") return ZONE_PROFILE;
  if (spec.kind === "path") return PATH_PROFILES[spec.profile] ? spec.profile : "plain";
  if (STREET_PROFILES[spec.profile]) return spec.profile;
  return spec.sidewalk_m !== undefined && !(Number(spec.sidewalk_m) > 0) ? "plain" : "sidewalks";
}

/** The width (m) of the bike lane or path a profile has by default, or 0. */
export function bikeDefault(profile) {
  const bike = STREET_PROFILES[profile]?.bike;
  return bike === "advisory" ? NORMS.advisoryLane.default : bike === "lane" ? NORMS.bikeLane.default : bike === "path" ? NORMS.bikePath.default : 0;
}

/** The norm of a profile's bike lane or path: {default, min, values, source}, or null. */
export function bikeNorm(profile, kind = "street") {
  const bike = kind === "path" ? PATH_PROFILES[profile]?.bike : STREET_PROFILES[profile]?.bike;
  return bike === "advisory" ? NORMS.advisoryLane : bike === "lane" ? NORMS.bikeLane : bike === "path" ? NORMS.bikePath : bike === "shared" ? NORMS.sharedPath : null;
}

/**
 * @typedef {object} Strip
 * @property {string} type "tram-bed" | "tram-lane" | "car-lane" | "advisory-lane" | "bike-lane" |
 *   "parking" | "buffer" | "curb" | "bike-path" | "shared-path" | "sidewalk" | "path" | "zone"
 * @property {-1 | 1} side -1 right, +1 left of the drawing direction (0: across the centre line)
 * @property {number} from distance of its inner edge from the centre line (m)
 * @property {number} to distance of its outer edge (m)
 * @property {number} width m
 * @property {"street" | "sidewalk" | "bed"} level street level (between the curbs), sidewalk level (raised), a track bed
 */

/**
 * The cross-section of a street.
 * @param {object} spec the street's settings: `kind` ("street", "residential", "main", "path",
 *   "pedestrian", "tram"), `profile`, `width_m` (car lanes; the path, the pedestrian zone or track
 *   bed for the others), `lanes` (car lanes in each direction), `sidewalk_m`, `bike_m`, `tram`,
 *   `tram_tracks`, `parking`, `parking_sides` ("both", "right", "left"), `bikes` (a pedestrian zone:
 *   bikes allowed)
 * @param {{width_m: number, car: boolean}} [kind] defaults of the kind: the width when `width_m` is empty, cars or not
 * @returns {object} {profile, strips, carriageway (curb to curb), half (the outer edge), carWidth,
 *   lanes, laneWidth, laneOffset, walkOffset, bike, bikeOffset, bikeWidth, sidewalk (outside the
 *   curb), tram, tramTracks, tramOffset, tramBed, parking ({right, left}: {layout, from, depth} or
 *   null), obstruct (bikes hold cars up), conflict (0..1, riders and people on foot), warnings}
 */
export function crossSection(spec = {}, kind = { width_m: 7, car: true }) {
  const strips = [], warnings = [];
  const profile = profileOf(spec);
  const tracks = TRAM_TRACKS[spec.tram_tracks] ? spec.tram_tracks : "double";
  const out = {
    profile, strips, carriageway: 0, half: 0, carWidth: 0, lanes: 1, laneWidth: 0, laneOffset: 0, walkOffset: 0,
    bike: "none", bikeOffset: 0, bikeWidth: 0, sidewalk: 0, tram: "none", tramTracks: tracks, tramOffset: 0, tramBed: 0,
    parking: { right: null, left: null }, obstruct: false, conflict: 0, warnings,
  };
  const both = (type, from, width, level) => {
    for (const side of [-1, 1]) strips.push({ type, side, from, to: from + width, width, level });
    return from + width;
  };
  // a pedestrian zone: one paved strip, people along the house fronts, trams in the middle
  if (spec.kind === "pedestrian") {
    const width = positive(spec.width_m, kind.width_m);
    both("zone", 0, width / 2, "sidewalk");
    out.half = width / 2;
    out.carriageway = width;
    out.walkOffset = Math.max(width / 4, width / 2 - NORMS.zone.walk);
    if (spec.bikes === true) {
      out.bike = "zone";
      out.bikeWidth = width;
      out.bikeOffset = width / 4;
      out.conflict = sharedConflict(width);
    }
    if (TRAM_LAYOUTS[spec.tram] && spec.tram !== "none") {
      out.tram = "street";
      out.tramOffset = tracks === "double" ? NORMS.tram.spacing / 2 : 0;
      const need = (tracks === "double" ? NORMS.tram.spacing : 0) + NORMS.tram.vehicle + 2 * NORMS.sidewalk.default;
      if (width < need) warnings.push(`Pedestrian zone ${fmt(width)} m: trams need ${fmt(need)} m, with a sidewalk's width on each side to walk beside them`);
    }
    return out;
  }
  // footpaths and tram tracks of their own: one strip
  if (spec.kind === "path" || spec.kind === "tram") {
    const tram = spec.kind === "tram";
    const width = positive(spec.width_m, tram ? (tracks === "double" ? NORMS.tram.bedDouble : NORMS.tram.bedSingle) : kind.width_m);
    both(tram ? "tram-bed" : profile === "plain" ? "path" : profile === "bike-paths" ? "bike-path" : "shared-path", 0, width / 2, tram ? "bed" : "sidewalk");
    out.half = width / 2;
    out.carriageway = width;
    if (tram) {
      out.tram = "own";
      out.tramBed = width;
      out.tramOffset = tracks === "double" ? Math.min(NORMS.tram.spacing, width - NORMS.tram.vehicle) / 2 : 0;
      if (tracks === "double" && width < NORMS.tram.spacing + NORMS.tram.vehicle) warnings.push(`Track bed ${fmt(width)} m: two tracks need at least ${fmt(NORMS.tram.spacing + NORMS.tram.vehicle)} m (BOStrab)`);
    } else {
      out.bike = PATH_PROFILES[profile].bike;
      if (out.bike !== "none") {
        out.bikeWidth = width;
        out.bikeOffset = width / 4;
        const norm = bikeNorm(profile, "path");
        if (width < norm.min) warnings.push(`${out.bike === "shared" ? "Shared path" : "Bike path"} ${fmt(width)} m: below the minimum of ${fmt(norm.min)} m (${norm.source})`);
        out.conflict = out.bike === "shared" ? sharedConflict(width) : 0;
      }
    }
    return out;
  }
  // the middle: tram lanes or the track bed
  const tram = TRAM_LAYOUTS[spec.tram] && spec.tram !== "none" ? spec.tram : "none";
  out.tram = tram;
  let x = 0;
  if (tram === "lanes") {
    const lane = NORMS.tram.lane;
    x = both("tram-lane", 0, tracks === "double" ? lane : lane / 2, "street");
    out.tramOffset = tracks === "double" ? lane / 2 : 0;
  } else if (tram === "median") {
    const bed = tracks === "double" ? NORMS.tram.bedDouble : NORMS.tram.bedSingle;
    x = both("tram-bed", 0, bed / 2, "bed");
    out.tramBed = bed;
    out.tramOffset = tracks === "double" ? NORMS.tram.spacing / 2 : 0;
  }
  // the car lanes
  const lanes = Math.max(1, Math.min(3, Math.round(Number(spec.lanes) || 1)));
  const carWidth = positive(spec.width_m, kind.width_m);
  const laneWidth = carWidth / (2 * lanes);
  out.lanes = lanes;
  out.carWidth = carWidth;
  out.laneWidth = laneWidth;
  const carFrom = x;
  for (let i = 0; i < lanes; i++) x = both("car-lane", x, laneWidth, "street");
  out.laneOffset = x - laneWidth / 2; // the outer (right) lane
  if (tram === "street") out.tramOffset = tracks === "double" ? carFrom + laneWidth / 2 : 0;
  if (lanes === 1 && carWidth < NORMS.carriageway.tight) warnings.push(`Car lanes ${fmt(carWidth)} m: two cars cannot pass each other (RASt 06: 4.10 m at least)`);
  else if (lanes > 1 && laneWidth < NORMS.carLane.min) warnings.push(`Car lanes ${fmt(laneWidth)} m: two lanes in one direction need 5.00 m together (RASt 06)`);
  if (tram !== "none" && laneWidth < 3.0) warnings.push(`Car lanes ${fmt(laneWidth)} m: a tram (${fmt(NORMS.tram.vehicle)} m wide) needs lanes of at least 3.00 m`);
  // bikes on the street: right of the car lanes
  const P = STREET_PROFILES[profile];
  const bikeWidth = P.bike === "road" ? 0 : positive(spec.bike_m, bikeDefault(profile) || NORMS.sharedPath.default);
  out.bike = P.bike;
  if (P.bike === "advisory" || P.bike === "lane") {
    const norm = bikeNorm(profile);
    out.bikeOffset = x + bikeWidth / 2;
    out.bikeWidth = bikeWidth;
    x = both(P.bike === "advisory" ? "advisory-lane" : "bike-lane", x, bikeWidth, "street");
    if (bikeWidth < norm.min) warnings.push(`${P.bike === "advisory" ? "Advisory bike lane" : "Bike lane"} ${fmt(bikeWidth)} m: below the minimum of ${fmt(norm.min)} m (${norm.source}); bikes ride in the car lane`);
    if (P.bike === "advisory" && lanes === 1 && carWidth < NORMS.advisoryLane.core) warnings.push(`Car lanes ${fmt(carWidth)} m between advisory bike lanes: at least ${fmt(NORMS.advisoryLane.core)} m (ERA 2010)`);
  }
  // parking strips (each side on its own), then the curb
  const layout = PARKING_LAYOUTS[spec.parking] && spec.parking !== "none" ? spec.parking : null;
  const sides = spec.parking_sides === "right" ? [-1] : spec.parking_sides === "left" ? [1] : [-1, 1];
  let curb = x;
  if (layout) {
    const P2 = NORMS.parking[layout];
    // a bike lane next to parked cars keeps its distance to the opening doors
    const gap = P.bike === "advisory" || P.bike === "lane" ? NORMS.buffer.parking : 0;
    for (const side of sides) {
      if (gap) strips.push({ type: "buffer", side, from: x, to: x + gap, width: gap, level: "street" });
      strips.push({ type: "parking", side, from: x + gap, to: x + gap + P2.depth, width: P2.depth, level: "street" });
      out.parking[side < 0 ? "right" : "left"] = { layout, from: x + gap, depth: P2.depth, length: P2.length };
    }
    curb = x + gap + P2.depth;
    if (P2.aisle && carWidth < P2.aisle) warnings.push(`${layout === "angled" ? "Angled" : "Perpendicular"} parking needs ${fmt(P2.aisle)} m to drive in and out; the car lanes are ${fmt(carWidth)} m`);
  }
  // a street drawn with parking on one side only is wider there: both curbs at the wider side keep it simple
  out.carriageway = 2 * curb;
  // the side spaces: curb, then bike path and sidewalk, a shared path, or a sidewalk
  let side0 = curb;
  if (P.sidewalks) {
    const sidewalk = positive(spec.sidewalk_m, NORMS.sidewalk.default);
    if (P.bike === "path" || P.bike === "shared") {
      const buffer = layout ? NORMS.buffer.parking : NORMS.buffer.road;
      x = both("buffer", curb, buffer, "sidewalk");
      if (P.bike === "path") {
        out.bikeOffset = x + bikeWidth / 2;
        out.bikeWidth = bikeWidth;
        x = both("bike-path", x, bikeWidth, "sidewalk");
        out.walkOffset = x + sidewalk / 2;
        x = both("sidewalk", x, sidewalk, "sidewalk");
        const norm = NORMS.bikePath;
        if (bikeWidth < norm.min) warnings.push(`Bike path ${fmt(bikeWidth)} m: below the minimum of ${fmt(norm.min)} m (${norm.source}); riders use the sidewalk`);
        if (sidewalk < NORMS.sidewalk.walking) warnings.push(`Sidewalk ${fmt(sidewalk)} m: below ${fmt(NORMS.sidewalk.walking)} m for two people to pass; people walk on the bike path`);
        out.conflict = Math.min(0.8, (bikeWidth < norm.min ? 0.35 : 0) + (sidewalk < NORMS.sidewalk.walking ? 0.35 : 0)) || 0.05;
      } else {
        const shared = positive(spec.bike_m, NORMS.sharedPath.default);
        out.bikeOffset = x + shared / 4;
        out.bikeWidth = shared;
        out.walkOffset = x + (shared * 3) / 4;
        x = both("shared-path", x, shared, "sidewalk");
        if (shared < NORMS.sharedPath.min) warnings.push(`Shared path ${fmt(shared)} m: below the minimum of ${fmt(NORMS.sharedPath.min)} m (${NORMS.sharedPath.source})`);
        out.conflict = sharedConflict(shared);
      }
    } else {
      out.walkOffset = curb + sidewalk / 2;
      x = both("sidewalk", curb, sidewalk, "sidewalk");
      if (sidewalk < NORMS.sidewalk.min) warnings.push(`Sidewalk ${fmt(sidewalk)} m: below the ${fmt(NORMS.sidewalk.min)} m of RASt 06`);
    }
    strips.push({ type: "curb", side: -1, from: curb, to: curb + 0.25, width: 0.25, level: "sidewalk" }, { type: "curb", side: 1, from: curb, to: curb + 0.25, width: 0.25, level: "sidewalk" });
  } else {
    // a plain street: people walk at its edge
    out.walkOffset = Math.max(0, curb - 0.6);
  }
  out.sidewalk = x - side0;
  out.half = x;
  // bikes on the road ride near the curb (or the parked cars)
  if (P.bike === "road") {
    out.bikeOffset = Math.max(laneWidth / 2, carFrom + lanes * laneWidth - ROAD_RIDE_M);
    out.bikeWidth = 0;
  }
  // does a bike hold up the cars behind it? Only one lane each way, and too narrow to pass at 1.5 m
  const room = laneWidth + (P.bike === "advisory" ? bikeWidth : 0);
  out.obstruct = lanes === 1 && (P.bike === "road" ? laneWidth < PASS_M : P.bike === "advisory" ? room < PASS_M || bikeWidth < NORMS.advisoryLane.min : P.bike === "lane" ? bikeWidth < NORMS.bikeLane.min : false);
  return out;
}

/**
 * How often a rider meeting a person on foot on a shared path of this width (m) leaves both angry
 * (0.1 … 0.8): 0.4 at the minimum of 2.50 m, 0.3 at 3.00 m, 0.1 from 4.00 m (ERA 2010 asks for
 * 4.00 m and more where many walk and ride).
 */
export function sharedConflict(width) {
  return Math.max(0.1, Math.min(0.8, 0.1 + 0.2 * (4 - width)));
}

/** A number of metres for texts: 1.5, 1.85. */
function fmt(m) {
  return String(Math.round(m * 100) / 100);
}

/**
 * The standard widths that fit a setting of a street, for the editors (`presets` of a parameter):
 * the car lanes by kind, the bike lane or path by profile, the sidewalk.
 * @param {string} key "width_m" | "bike_m" | "sidewalk_m"
 * @param {object} spec the street's settings
 * @returns {number[]}
 */
export function widthChoices(key, spec = {}) {
  const profile = profileOf(spec);
  if (key === "sidewalk_m") return NORMS.sidewalk.values;
  if (key === "bike_m") return bikeNorm(profile, spec.kind)?.values ?? [];
  if (key === "width_m") {
    if (spec.kind === "path") return [2.0, 2.5, 3.0, 4.0];
    if (spec.kind === "pedestrian") return NORMS.zone.values;
    if (spec.kind === "tram") return [NORMS.tram.bedSingle, NORMS.tram.bedDouble];
    const lanes = Math.max(1, Math.round(Number(spec.lanes) || 1));
    if (lanes === 1) return NORMS.carriageway.values;
    // two lanes in one direction: 5.00 to 6.50 m (RASt 06); more: by the lane width
    return lanes === 2 ? [10.0, 11.0, 13.0] : NORMS.carLane.values.map((w) => Math.round(w * 2 * lanes * 100) / 100);
  }
  return [];
}
