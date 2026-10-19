/**
 * The built-in object types of the layout (stations, streets, the town, the landscape, the table)
 * and what the framework exports of them. One line per type, so that two changes adding types
 * do not change the same line; `web/arail/index.js` re-exports all of it.
 * @module arail/objects
 */
import { Platform } from "./platform.js";
import { BusTerminal } from "./bus-terminal.js";
import { Building } from "./building.js";
import { AltbauBlock, Factory, House, HouseEstate, Office, Plattenbau, School, Supermarket } from "./houses.js";
import { StationBuilding } from "./station.js";
import { Underpass } from "./underpass.js";
import { Forest, Tree } from "./trees.js";
import { Area } from "./landscape.js";
import { Road } from "./road.js";
import { BusStop } from "./bus-stop.js";
import { BusLine } from "./bus-line.js";
import { Track } from "./track.js";
import { TramLine, TramStop } from "./tram.js";
import { TrafficLight, TrafficSign, ZebraCrossing } from "./traffic-signs.js";
import { BikeStand, ParkingGarage, ParkingLot } from "./parking.js";
import { RailCrossing } from "./crossings.js";
import { Label } from "./label.js";
import { Tabletop } from "./tabletop.js";

export { Platform, BusTerminal, Building, Tree, Forest, Area, Road, Track, Label, Tabletop, BusStop, BusLine, StationBuilding, Underpass };
export { TABLE_SURFACES, TABLE_THICKNESS_MM, drawTable, defaultTableBounds, hasPhysicalTable } from "./tabletop.js";
export { ROAD_KINDS, roadKind, offsetPolyline, slicePolyline, drawStreetLamp, stripColour, GAUGE_M } from "./road.js";
export {
  NORMS, STREET_PROFILES, PATH_PROFILES, TRAM_LAYOUTS, TRAM_TRACKS, PARKING_LAYOUTS, PASS_M, ROAD_RIDE_M, crossSection, profileOf, bikeDefault, bikeNorm,
  sharedConflict, widthChoices,
} from "./street-profile.js";
export { drawStopSign, drawSign, drawTrafficLight, STOP_SIGN, SIGN_COLOURS, ROAD_SIGNS } from "./signs.js";
export { TrafficSign, TrafficLight, ZebraCrossing, SIGN_TYPES, TURNS, parseArrows, streetNear } from "./traffic-signs.js";
export { TARIFFS, PARKING_ACCESS, Tariff, ParkingLot, ParkingGarage, BikeStand, ownerAccess, parkingTerms } from "./parking.js";
export { TramStop, TramLine, TRAM_STOP_TYPES, STEP_FREE_M, tramRails } from "./tram.js";
export {
  RailCrossing, CrossingType, OverTrack, UnderTrack, AtGrade, CrossbuckOnly, FlashingLights, HalfBarriers, FullBarriers, CROSSING_TYPES, CROSSING_NORMS,
} from "./crossings.js";
export { Plattenbau, AltbauBlock, House, HouseEstate, Office, School, Supermarket, Factory, PLATTENBAU_SERIES, buildHouse } from "./houses.js";
export {
  BuildingBase, BuildingModel, Frame, TONES, TIER, USE_OPTIONS, OCCUPANCY, LIGHTS_ON, defaultOccupancy, lightsOn, capacityFor,
  gableRoof, hipRoof, parapetRoof, blockPiece, sawtoothRoof, axes, drawModel, lightWindows, facesCamera, hashString, hash01, polygonNormal,
} from "./building-kit.js";
export { drawTree } from "./trees.js";

/** The built-in object types, in the order of the Build tab's lists. */
export const OBJECT_TYPES = [
  Platform,
  BusTerminal,
  Road,
  Underpass,
  BusStop,
  BusLine,
  TramStop,
  TramLine,
  TrafficSign,
  TrafficLight,
  ZebraCrossing,
  ParkingLot,
  ParkingGarage,
  BikeStand,
  RailCrossing,
  Building,
  StationBuilding,
  Plattenbau,
  AltbauBlock,
  House,
  HouseEstate,
  Office,
  School,
  Supermarket,
  Factory,
  Tree,
  Forest,
  Area,
  Track,
  Label,
  Tabletop,
];

/** Register the built-in object types. */
export function registerObjects(registry) {
  for (const cls of OBJECT_TYPES) registry.registerObject(cls);
  return registry;
}
