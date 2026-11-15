// The situations of Settings → Simulation: characteristic combinations of what the simulation can be
// set to, each in one click: a day (with its weekday: a Saturday or Sunday has no rush hour, see
// core/clock.js WEEKEND_PROFILES), a time, the weather and the passenger demand, and for an event the
// module it needs (the Christmas market) or a crowd at the stops (after a match). They show what can
// be set; Settings → Simulation → Each on its own sets one thing at a time.

/**
 * @typedef {object} Situation
 * @property {string} id
 * @property {string} label its name
 * @property {string} text what it is, in one line (the day, the time, the weather, who travels)
 * @property {"day" | "event"} kind
 * @property {string} date "YYYY-MM-DD" (its weekday counts)
 * @property {string} time "HH:MM"
 * @property {string | object} weather a preset's name, or `{preset, …quantities}` (core/weather.js)
 * @property {number} demand the passenger demand (world.demand)
 * @property {string[]} [layers] the modules of the layout it needs (switched on with it)
 * @property {{factor: number, minutes: number}} [crowd] a crowd surge at every stop (the disruption `crowd`)
 */

/** The id of a situation's crowd: setting a situation again, or another one, ends it. */
export const CROWD_ID = "situation-crowd";

/** @type {Situation[]} */
export const SITUATIONS = [
  {
    id: "winter-rush", kind: "day", label: "Winter weekday, morning rush",
    text: "Tuesday, 13 January, 07:15: frost, commuters crowd the platforms",
    date: "2026-01-13", time: "07:15", weather: "frost", demand: 2,
  },
  {
    id: "foggy-monday", kind: "day", label: "Foggy Monday in November",
    text: "Monday, 16 November, 06:45: fog, the week begins in the dark",
    date: "2026-11-16", time: "06:45", weather: "fog", demand: 2,
  },
  {
    id: "spring-sunday", kind: "day", label: "Spring Sunday",
    text: "Sunday, 19 April, 11:00: mild and cloudy, a day out without a rush hour",
    date: "2026-04-19", time: "11:00", weather: "cloudy", demand: 1,
  },
  {
    id: "autumn-storm", kind: "day", label: "Thunderstorm on an autumn night",
    text: "Friday, 23 October, 22:30: heavy rain, gusts and lightning, the last trains of the week",
    date: "2026-10-23", time: "22:30", weather: "thunderstorm", demand: 0.5,
  },
  {
    id: "future-heat", kind: "day", label: "Hot weekend in the summer of 2050",
    text: "Saturday, 16 July 2050, 15:00: 39 °C in the shade, a heatwave of the future",
    date: "2050-07-16", time: "15:00", weather: { preset: "heat", temperature_c: 39 }, demand: 1,
  },
  {
    id: "christmas-market", kind: "event", label: "Christmas market",
    text: "Saturday, 5 December, 16:30: snow, the Striezelmarkt lights up at dusk",
    date: "2026-12-05", time: "16:30", weather: "snow", demand: 2, layers: ["striezelmarkt", "market-visitors"],
  },
  {
    id: "after-match", kind: "event", label: "After the football match",
    text: "Saturday, 19 September, 17:20: the final whistle, the fans head for the trains and buses",
    date: "2026-09-19", time: "17:20", weather: "cloudy", demand: 1, crowd: { factor: 6, minutes: 20 },
  },
];

/**
 * Can this layout show the situation: it has the modules an event needs (on or off), and stops for
 * a crowd?
 * @param {import("./app.js").App} app
 * @param {Situation} s
 */
export function situationReady(app, s) {
  const w = app.world, layers = w.layers().map((l) => l.id);
  if (s.layers?.some((id) => !layers.includes(id))) return false;
  if (s.crowd && !w.stopAreas().length) return false;
  return true;
}

/**
 * Set the world to the situation: the modules it needs on first (that starts the simulations
 * again), then the date, the time, the weather and the demand, and an event's crowd (the crowd of
 * the situation set before ends: one crowd at a time, never one on top of another).
 * @param {import("./app.js").App} app
 * @param {Situation} s
 */
export async function applySituation(app, s) {
  if (s.layers?.length) {
    const on = app.layersOn();
    if (s.layers.some((id) => !on.includes(id))) await app.chooseModules([...new Set([...on, ...s.layers])]);
  }
  const w = app.world;
  // the crowd of the situation set before ends (another one's, or this one's: one at a time)
  w.disruptions.stop(CROWD_ID);
  w.setDate(s.date);
  w.setTime(s.time);
  w.setWeather(s.weather);
  w.demand = s.demand;
  if (s.crowd) w.disruptions.start({ id: CROWD_ID, type: "crowd", target: "*", params: { factor: s.crowd.factor, minutes: s.crowd.minutes } });
}
