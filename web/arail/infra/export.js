/**
 * The asset information model (AIM) as data: an asset's record as an IFC 4.3 object would carry it
 * (class, predefined type, GlobalId, linear placement on its line, property sets), and the whole
 * network as GeoJSON in WGS 84 for a GIS (QGIS reads it as it is).
 *
 * What the records know depends on the asset's data: old assets lost their year of construction or
 * their manufacturer's data; projects with BIM hand over complete as-built data.
 * @module arail/infra/export
 */
import { DISCIPLINES, GENERATIONS, METHODS, gradeLabel } from "./catalog.js";
import { kmLabel } from "./network.js";
import { hashKey } from "../ops/util.js";

/** Invented manufacturers by asset type (for the data that a complete record has). */
const MAKERS = {
  signal: ["Signalbau Elbe", "Lichtsignal AG"], turnout: ["Weichenwerk Mitte", "Stahlbau Weiche"], balise: ["Balisenbau"], interlocking: ["Stellwerkstechnik Ost", "Digitale Schiene GmbH"],
  "level-crossing": ["BÜ-Werk Mittelsachsen"], gsmr: ["Funknetz Systems"], catenary: ["Fahrleitungsbau Ost"], substation: ["Energieanlagen Sachsen"], lift: ["Aufzugbau Dresden"],
  pis: ["Anzeigetechnik GmbH"], track: ["Gleisbau Elbtal"], cable: ["Kabelwerk Meißen"], platform: ["Bauwerk Bahnhof"],
};

/**
 * The record of an asset in the asset information model.
 * @param {import("./engine.js").InfraEngine} e
 * @param {import("./assets.js").Asset} a
 */
export function assetRecord(e, a) {
  const k = e.known(a);
  const has = (what) => (hashKey(a.id, what) % 100) / 100 < a.data;
  const makers = MAKERS[a.type] ?? ["–"];
  const il = a.interlocking ? e.assets.get(a.interlocking) : null;
  const lonlat = a.pos ? e.net.toLonLat(a.pos) : null;
  return {
    GlobalId: a.guid,
    Class: a.t.ifc[0],
    PredefinedType: a.t.ifc[1],
    Name: a.name,
    Description: `${a.t.label} (${a.t.de})`,
    Placement: {
      Alignment: `line ${a.line}`, Distance: kmLabel(a.km), ...(a.t.linear ? { Length: `${a.length_km.toFixed(3)} km` } : {}),
      ...(lonlat ? { Longitude: lonlat[0], Latitude: lonlat[1] } : {}), OnLayout: !!a.on_layout,
    },
    Pset_ManufacturerOccurrence: {
      AcquisitionDate: a.builtKnown ? String(Math.floor(a.built)) : null,
      Manufacturer: has("maker") ? makers[hashKey(a.id) % makers.length] : null,
      SerialNumber: has("serial") ? `SN-${(hashKey(a.id, "sn") % 900000) + 100000}` : null,
    },
    Pset_ServiceLife: { ServiceLifeDuration: `P${a.life}Y`, MeanTimeBetweenFailure: `${(1 / Math.max(1e-6, a.failureRate(k.h, e.load(a.line)))).toFixed(1)} years` },
    Pset_Condition: {
      AssessmentDate: k.t == null ? null : e.dateText(k.t),
      AssessmentCondition: k.fault ? "6 restricting (fault)" : gradeLabel(k.grade),
      AssessmentDescription: k.source === "age" ? "estimated from the age" : k.source === "unknown" ? "estimated, year of construction unknown" : `${METHODS[k.source]?.label ?? k.source}; ${k.live > 0 ? `${Math.round(k.live * 100)} % reported live` : "nothing reported live"}`,
    },
    ARail_Maintenance: {
      Discipline: DISCIPLINES[a.discipline]?.label ?? a.discipline,
      Interlocking: il ? `${il.name} (${GENERATIONS[il.generation]?.label ?? il.generation})` : a.type === "interlocking" ? GENERATIONS[a.generation]?.label ?? a.generation : null,
      KnownGrade: Number(k.value.toFixed(2)),
      Uncertainty: `± ${(k.sigma * 5).toFixed(1)} grades`,
      DataCompleteness: `${Math.round(a.data * 100)} %`,
      FaultsThisYear: a.faults,
    },
  };
}

/**
 * The network as a GeoJSON FeatureCollection in WGS 84: lines, stations and assets with their
 * known condition (never the true one).
 * @param {import("./engine.js").InfraEngine} e
 */
export function toGeoJSON(e) {
  const net = e.net, ll = (p) => net.toLonLat(p);
  const features = [];
  for (const l of net.lines.values()) {
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: net.stretch(l.id, l.km[0], l.km[1]).map(ll) }, properties: { kind: "line", id: l.id, name: l.name, tracks: l.tracks, electrified: l.electrified, speed_kmh: l.speed_kmh } });
  }
  for (const s of net.stations.values()) {
    const at = net.at(s.line, s.km);
    if (at) features.push({ type: "Feature", geometry: { type: "Point", coordinates: ll(at.pos) }, properties: { kind: "station", id: s.id, name: s.name, line: s.line, km: s.km, on_layout: s.on_layout } });
  }
  for (const a of e.active()) {
    const k = e.known(a);
    const geometry = a.t.linear && !a.on_layout
      ? { type: "LineString", coordinates: net.stretch(a.line, a.km, a.km + a.length_km).map(ll) }
      : a.pos ? { type: "Point", coordinates: ll(a.pos) } : null;
    if (!geometry) continue;
    features.push({
      type: "Feature", geometry,
      properties: {
        kind: "asset", id: a.id, name: a.name, type: a.type, ifc: `${a.t.ifc[0]}.${a.t.ifc[1]}`, guid: a.guid, line: a.line, km: Number(a.km.toFixed(3)),
        discipline: a.discipline, built: a.builtKnown ? Math.floor(a.built) : null, grade_known: Number(k.value.toFixed(2)), uncertainty: Number((k.sigma * 5).toFixed(2)),
        last_check: k.t == null ? null : e.dateText(k.t), live_share: Number(k.live.toFixed(2)), fault: !!k.fault, on_layout: !!a.on_layout,
      },
    });
  }
  return {
    type: "FeatureCollection",
    name: e.model.name,
    // the georeference behind the coordinates (an invented place)
    properties: { crs_of_the_network: `EPSG:${e.model.georef.epsg}`, origin: [e.model.georef.easting, e.model.georef.northing], date: e.dateText() },
    features,
  };
}
