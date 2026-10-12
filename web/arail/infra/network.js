/**
 * The network of the infrastructure simulation as a small GIS: lines with an alignment, linear
 * referencing (line number + km, the way railways locate their assets), the layout placed at its
 * station, a georeference to a real coordinate reference system (ETRS89 / UTM, an invented place)
 * and GeoJSON in WGS 84 for QGIS and other GIS.
 *
 * Frames: layout (model mm, see core/layout.js) → network (prototype metres east and north of the
 * georeference point) → UTM (easting, northing) → WGS 84 (longitude, latitude).
 * @module arail/infra/network
 */

export class Network {
  /** @param {object} model normalized settings (config.js) */
  constructor(model) {
    this.model = model;
    /** @type {Map<string, object>} */
    this.lines = new Map(model.lines.map((l) => [l.id, { ...l, path: l.path.slice().sort((a, b) => a[0] - b[0]) }]));
    this.stations = new Map(model.stations.map((s) => [s.id, s]));
    this.placement = model.placement;
    this.scale = model.scale;
    this.georef = model.georef;
  }

  /** Is km on the line? */
  onLine(lineId, km) {
    const l = this.lines.get(lineId);
    return !!l && km >= l.km[0] - 1e-9 && km <= l.km[1] + 1e-9;
  }

  /**
   * Network position (m) and unit direction of a km of a line (the alignment is a polyline through
   * its points; between them km and length are taken as proportional).
   * @returns {{pos: number[], dir: number[]} | null}
   */
  at(lineId, km) {
    const l = this.lines.get(lineId);
    const p = l?.path;
    if (!p || p.length < 2) return null;
    let i = 0;
    while (i < p.length - 2 && km > p[i + 1][0]) i++;
    const a = p[i], b = p[i + 1];
    const t = b[0] > a[0] ? (km - a[0]) / (b[0] - a[0]) : 0;
    const dx = b[1] - a[1], dy = b[2] - a[2], len = Math.hypot(dx, dy) || 1;
    return { pos: [a[1] + dx * t, a[2] + dy * t], dir: [dx / len, dy / len] };
  }

  /** Network points (m) of a line between two km. */
  stretch(lineId, from, to) {
    const l = this.lines.get(lineId);
    if (!l) return [];
    const a = Math.max(l.km[0], Math.min(from, to)), b = Math.min(l.km[1], Math.max(from, to));
    const out = [this.at(lineId, a)?.pos];
    for (const q of l.path) if (q[0] > a && q[0] < b) out.push([q[1], q[2]]);
    out.push(this.at(lineId, b)?.pos);
    return out.filter(Boolean);
  }

  /* ---------------------------------------------------------------- the layout in the network */

  /** The layout's frame in the network: origin (m), direction of the layout's x axis and y axis. */
  _layoutFrame() {
    if (this._frame !== undefined) return this._frame;
    const p = this.placement;
    const at = p?.line ? this.at(p.line, p.km_at_origin) : null;
    if (!at) return (this._frame = null);
    const ux = [at.dir[0] * p.direction, at.dir[1] * p.direction];
    return (this._frame = { origin: at.pos, ux, uy: [-ux[1], ux[0]] });
  }

  /** Network position (m) of a layout point (mm), or null when the layout is not placed. */
  fromLayout(pt) {
    const f = this._layoutFrame();
    if (!f || !pt) return null;
    const x = (pt[0] * this.scale) / 1000, y = (pt[1] * this.scale) / 1000;
    return [f.origin[0] + f.ux[0] * x + f.uy[0] * y, f.origin[1] + f.ux[1] * x + f.uy[1] * y];
  }

  /** The km of a layout point on the line of the layout's station (by its x). */
  kmOfLayout(pt) {
    const p = this.placement;
    return Math.round((p.km_at_origin + (p.direction * pt[0] * this.scale) / 1e6) * 1000) / 1000;
  }

  /** The layout point (mm, on the line through the origin) of a km of the station's line, if it is near the layout. */
  layoutOfKm(km) {
    const p = this.placement;
    return [((km - p.km_at_origin) * 1e6 * p.direction) / this.scale, 0];
  }

  /* ---------------------------------------------------------------- travel */

  /**
   * Minutes by car between two network points: 1.35 times the straight distance at 50 km/h, plus
   * the minutes to park and walk to the asset.
   */
  driveMinutes(a, b, walkMin = 6) {
    if (!a || !b) return 30;
    return (Math.hypot(a[0] - b[0], a[1] - b[1]) * 1.35) / (50 / 0.06) + walkMin;
  }

  /* ---------------------------------------------------------------- georeference */

  /** UTM easting and northing of a network point. */
  toUTM(p) {
    const g = this.georef, r = ((g.rotation_deg || 0) * Math.PI) / 180;
    const c = Math.cos(r), s = Math.sin(r);
    return [g.easting + c * p[0] - s * p[1], g.northing + s * p[0] + c * p[1]];
  }

  /** WGS 84 [longitude, latitude] of a network point (rounded to 7 decimals, about 1 cm). */
  toLonLat(p) {
    const [e, n] = this.toUTM(p);
    const zone = utmZone(this.georef.epsg);
    const [lon, lat] = utmToLonLat(e, n, zone);
    return [Math.round(lon * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7];
  }
}

/** UTM zone of an EPSG code of ETRS89 / UTM (258xx) or WGS 84 / UTM north (326xx); 33 otherwise. */
export function utmZone(epsg) {
  const c = Number(epsg);
  if (c >= 25828 && c <= 25838) return c - 25800;
  if (c >= 32601 && c <= 32660) return c - 32600;
  return 33;
}

/**
 * Inverse transverse Mercator (UTM, northern hemisphere, GRS 80): [longitude, latitude] in degrees
 * (series after Snyder, "Map projections – a working manual", 1987; better than a millimetre in the zone).
 */
export function utmToLonLat(easting, northing, zone) {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const x = easting - 500000, y = northing;
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1), c = Math.cos(phi1), t = Math.tan(phi1);
  const C1 = ep2 * c * c, T1 = t * t, N1 = a / Math.sqrt(1 - e2 * s * s), R1 = (a * (1 - e2)) / (1 - e2 * s * s) ** 1.5;
  const D = x / (N1 * k0);
  const lat = phi1 - ((N1 * t) / R1) * (D * D / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon = (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / c;
  return [((zone - 1) * 6 - 180 + 3) + (lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

/** "km 21.234" (three decimals, like a kilometre post with metres). */
export const kmLabel = (km) => (Number.isFinite(km) ? `km ${km.toFixed(3)}` : "–");
