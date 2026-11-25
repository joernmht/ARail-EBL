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
 * What keeps the world from taking the situation, in a few words, or null: the layout lacks what it
 * needs, or its date, time, weather, demand or crowd is none the world takes.
 * @param {import("./app.js").App} app
 * @param {Situation} s
 * @returns {string | null}
 */
export function situationProblem(app, s) {
  const w = app.world;
  if (!situationReady(app, s)) return "this layout lacks what it needs";
  if (!w.clock.isDate(s.date)) return "its date is no date";
  if (!w.clock.isTime(s.time)) return "its time is no time of day";
  if (!w.weather.isWeather(s.weather)) return "its weather is no weather";
  if (!(Number(s.demand) >= 0)) return "its demand is no number of 0 or more";
  if (s.crowd && !(w.registry.disruptions.has("crowd") && s.crowd.factor > 0 && s.crowd.minutes > 0)) return "its crowd cannot be started";
  return null;
}

/**
 * Set the world to the situation. All of it is checked first ({@link situationProblem}): what does
 * not fit throws, and nothing is changed. Then the modules it needs are switched on (that loads the
 * layout again and starts the simulations anew); a switch that fails has said why and throws, and
 * nothing else is set (the modules are as the switch left them). Then the date, the time, the
 * weather and the demand, and an event's crowd (the crowd of the situation set before ends: one
 * crowd at a time, never one on top of another); checked, these do not fail.
 * @param {import("./app.js").App} app
 * @param {Situation} s
 */
export async function applySituation(app, s) {
  const problem = situationProblem(app, s);
  if (problem) throw new Error(problem);
  if (s.layers?.length) {
    const on = app.layersOn();
    if (s.layers.some((id) => !on.includes(id))) await app.chooseModules([...new Set([...on, ...s.layers])]);
    // a switch that failed has said why (App#setLayers): nothing else is set then
    if (s.layers.some((id) => !app.layersOn().includes(id))) throw new Error("its modules could not be switched on");
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

/** What the weather is set to, not what it does by itself (it starts to snow, ice forms): mode, preset, quantities, course. */
const weatherSetting = (weather) => JSON.stringify([weather.mode, weather.preset, weather.state, weather.course, weather.seed]);

/**
 * The situation just set, as a mark to tell later whether it still holds ({@link situationHolds}).
 * Call `off()` when it is dropped.
 * @param {import("../arail/core/world.js").World} world
 * @param {Situation} s
 * @returns {{id: string, layout: object, weather: string, demand: number, timeSet: boolean, off: () => void}}
 */
export function markSituation(world, s) {
  const mark = { id: s.id, layout: world.layout, weather: weatherSetting(world.weather), demand: world.demand, timeSet: false };
  // the time or the date set again, by whoever (Settings, a scenario, a story, a plugin)
  mark.off = world.events.once("clock.set", () => (mark.timeSet = true));
  return mark;
}

/**
 * Does the situation set still hold: nothing has set the time or the date since, the weather and the
 * demand are as it set them, and the layout is the one it was set on (the world loads another
 * layout, or the same one with other modules, into the same object: its layout is new then)? The
 * clock running on (past midnight too), the fast clock and the weather changing by itself leave it.
 * @param {import("../arail/core/world.js").World} world
 * @param {ReturnType<typeof markSituation> | null} mark
 */
export function situationHolds(world, mark) {
  return !!mark && !mark.timeSet && mark.layout === world.layout && mark.weather === weatherSetting(world.weather) && mark.demand === world.demand;
}
