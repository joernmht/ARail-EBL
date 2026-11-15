# Seasons and weather

ARail's clock can carry a **date**, and the world a **weather**. With a date the sun rises and sets as on that day in Dresden and the trees follow the season; the weather is the typical one of the date or one set by hand or by a scenario. The rails, the people on foot, the cyclists and the market read it, and the picture shows it: snow on the roofs, wet streets, rain and flakes falling.

This is the base of the concept in [#254](https://github.com/joernmht/ARail-EBL/issues/254) (part of the seasons, [#239](https://github.com/joernmht/ARail-EBL/issues/239)). What comes later is listed [at the end](#what-is-not-there-yet).

**Nothing changes unasked.** A layout without a date and without weather behaves exactly as before: the sun from 06:00 to 20:30, a mild dry day, every factor 1.

## In the app

**Settings → Simulation → Season and weather**, as presets:

- **Season**: *No date* (every day is the same day), or a day of each season: *Spring* (15 April), *Summer* (15 July), *Autumn* (15 October), *Winter* (15 December), in 2026. The date runs on at midnight, into the next year; leap years have 29 February. Another date (from a scenario, a layout or `world.setDate`) shows as an option of its own (*Sunday, 6 December 2026*).
- **Weather**: *Off*, *Typical for the date*, or a fixed one: *Clear, Cloudy, Overcast, Rain, Heavy rain, Thunderstorm, Snowfall, Frost, Fog, Heat*.

**Overview → Measured → Weather** says what holds now: the temperature and the sky, the rails, the ground (dry, wet, ice, centimetres of snow), sunrise and sunset.

With a date or a weather, a clock on the stage shows them: *Sun 6 Dec · 15:46 · −2 °C · snow*. What is set here is not saved with the layout; a layout's own date and weather are ([layout file](#in-a-layout-file)).

The lab example's scenario *Evening at the Striezelmarkt* (module Striezelmarkt) sets 6 December, 15:45 and snowfall: dusk comes at four.

## The date and the sun

- The date has a year (`"2026-12-06"`; written without one, `"12-06"`, it is in 2026), so it has a weekday; leap years have 29 February. Holidays are not there yet.
- **Seasons** are the meteorological ones (winter: December to February). The seasons, the leaves and the climate go by the month and the day, so a leap year is no day ahead after February.
- **Sunrise and sunset** come from the date and the latitude (`clock.latitude`, 51.05° N), in Central European Time with summer time (from the last Sunday of March to the last Sunday of October), at Dresden's longitude: 08:06 to 16:01 on 21 December, 04:49 to 21:23 on 21 June. Twilight is as before (45 minutes to either side). Lamps and windows follow the light, so they come on at four in December.
- **Leaves**: bare until early April, leafing until early May, in leaf, colouring in October, falling in November, bare from December.

## The weather

`world.weather.now()` gives the **air** (temperature, cloud, rain, sleet or snow with its rate, wind, fog) and the **ground**, which remembers:

- rain wets the ground; it dries slowly in still air, faster in sun and wind, hardly at all in frost;
- snow settles (1 mm of water is about 1 cm of fresh snow) and melts above zero, leaving the ground wet;
- wet ground in frost is **ice**.

Where it comes from:

| Mode | The air |
| --- | --- |
| `off` (default) | a mild dry day (15 °C); nobody is told anything |
| `typical` | the typical weather of the clock's date: each day is fair, cloudy or wet by the shares of its month, in spells of three days (tomorrow tends to be like today); the temperature follows the month and the hour (coldest at 04:30, warmest at 15:30); rain falls in two-hour slots, as snow below 0.5 °C; fog on calm autumn and winter mornings. The same seed and date give the same weather. Without a date it is the mild day |
| `fixed` | a preset, and quantities set one by one over it |

In the typical weather a summer shower that pours down (3 mm/h and more) on a warm afternoon (18 °C and more) is a thunderstorm, with gusts.

A **course** (key frames over the day) lies on top of either: the first frost night, snow from six in the morning. Given on its own (without a mode or a preset) it lies over the typical weather; with `"mode": "off"` it does nothing, and the layout check says so.

The ground goes with the clock: while it is stopped nothing settles, dries or melts, and at a faster clock it all goes faster. What lies stays when a weather follows another or the time is set: frost after snowfall keeps the snow, the cleared streets stay cleared, and a weather that brings rain or snow starts at least as wet or as white as its preset; only `wet` and `snow_cm` given with it (or a weather after *Off*) set the ground anew, once: what falls or melts afterwards stays when the time is set later. The typical weather is gone through again, over the day and a half before the time set.

The climate is Dresden's: the typical year gives about 10 °C, 600 to 680 mm of rain and snow on about 150 days (the German Weather Service's figures for Dresden-Klotzsche 1991–2020: 9.8 °C, about 640 mm, about 156 days). The split by month, the fair days, the wind and the fog are estimates until the DWD's monthly normals replace them.

## What it affects

| Who | What |
| --- | --- |
| **Rails** | the condition every track has from the weather: *wet* in rain, in snow and on wet ground, *leaves* in the weeks the leaves fall when it is damp, *ice* on wet rails in frost. A track takes the worse of its own `rail_condition` and the weather's; a *Slippery rails* disruption still overrides both for its track. Adhesion, starting and braking follow as before ([Railway systems and trains](rail-systems.md)) |
| **People on foot** (the town, the journeys, the market) | × 0.85 on snow, × 0.7 on ice |
| **Bikes and e-scooters** | how many ride: from 35 % at −5 °C to all at 15 °C; half in rain, a quarter in heavy rain, a fifth on snow |
| **The market** | fewer visitors in rain (55 %, 30 % in heavy rain); hot drinks wanted more at 3 °C and below, less at 18 °C and above |
| **Everybody** | the light: the day's length by the date |

These numbers are starting values and estimates (`WEATHER_EFFECTS` in `core/weather.js`, `MARKET_WEATHER` in `sims/market.js`); #254 collects their sources.

## What it looks like

- **Snow cover** whitens everything as it settles, fully at 4 cm: the ground, the tables, the paving, the tracks' sleepers, and what faces up, on slopes down to about 70° (roofs, the tiers of a fir, the tops of stalls and trees). It stays until warmth melts it or the **traffic clears the streets**: about 60 % an hour at normal daytime traffic, hardly at night, fast in the rush hours, while snow falling covers them again; the sidewalks are trodden half as fast. Clearing by hand and by ploughs comes with #243.
- **Snow falling**: soft flakes at three depths, the near ones larger and faster, swaying and drifting with the wind.
- **Rain**: streaks at three depths, slanted by the wind, denser with the rate; wet ground is darker.
- **Thunderstorm**: a darker sky, heavy rain, and now and then (every 8 to 20 seconds) a short bolt from the top of the picture with a faint brightening of the sky. Never more than two flashes in a second, and none with reduced motion.
- **Cloud and fog**: a grey veil over the picture by day; fog thicker towards the distance. The flyover's sky turns grey.
- **Trees**: deciduous trees are bare in winter, light green in spring, yellow to red-brown in October (each tree in its own time); conifers stay green. Grass pales in winter; fields are brown, green, yellow and stubble through the year.
- **Over the camera image** the real model stays as it is: the virtual world gets its snow, the rain and the flakes lie over the whole picture.
- **Map and 2.5D**, and the builder's plan: no weather drawn.
- With *reduce motion* set in the system, rain and snow stand still and no lightning flashes. Labels and boards are drawn above the weather.

**How it is drawn.** The weather is one overlay over the picture. Rain and snow are three layers, each a tile painted once (its flakes or drops at fixed places, seamless at its edges) and filled over the picture as a repeating pattern that moves with the real time: a frame costs one fill per layer (two for heavy rain or snow), whatever the number of flakes, about 0.01 to 0.08 ms. Snow cover and wet ground are colours of what is drawn anyway (`view.tone`), no extra drawing.

## In a layout file

```json
"clock": { "start": "07:00", "date": "11-10", "latitude": 51.05 },
"weather": { "mode": "typical" }
```

| Key | Default | Meaning |
| --- | --- | --- |
| `clock.date` | none | the date the layout starts with (`"YYYY-MM-DD"`, or `"MM-DD"` in 2026, so `"02-29"` needs a leap year written with it: without, the layout has no date and the check reports it) |
| `clock.latitude` | `51.05` | °N, for the sun |
| `weather` | off | a preset's name (`"snow"`), `"typical"`, `"off"`, or an object: |
| `weather.mode` | `"off"` | `off`, `typical`, `fixed` |
| `weather.preset` | | `clear`, `cloudy`, `overcast`, `rain`, `heavy-rain`, `thunderstorm`, `snow`, `frost`, `fog`, `heat` |
| `weather.state` | | quantities over the preset: `temperature_c`, `cloud` (0…1), `precipitation` (`none`, `rain`, `sleet`, `snow`), `rate_mm_h`, `wind_mps`, `wind_deg`, `fog` (0…1), `thunder` (true, false); `wet` (0…1) and `snow_cm` for where the ground starts |
| `weather.course` | | `[["05:00", {…}], ["07:00", {…}]]`: quantities at times of day, in proportion between them |
| `weather.seed` | `1` | another typical year |

A scenario step sets them too ([Disruptions and scenarios](disruptions-and-scenarios.md)):

```json
{ "at": 0, "set": { "date": "2026-12-06", "time": "15:45", "weather": "snow" } }
{ "at": 60, "set": { "weather": { "preset": "rain", "temperature_c": -2 } } }
```

The layout check reports a date, a mode, a preset or a course that is none, a course with mode off, and a step's `"02-29"` when the layout's year (2026 without one) has no 29 February. A step that fails (a date, time or weather that is none) changes none of them.

## For plugins and simulations

```js
world.setDate("2026-11-10");            // or "11-10" (the clock's year), or null: no date; sends clock.date and clock.set;
                                        // undefined, and nothing changes, for what is no date ("02-29" in 2027)
world.clock.weekday();                  // 0 = Monday … 6 = Sunday; dateLabel({long: true}): "Tuesday, 10 November 2026" 
world.setWeather("typical");            // or a preset's name, "off", or {preset, mode, course, …quantities}
const now = world.weather.now();        // {temperature_c, cloud, precipitation, rate_mm_h, wind_mps, wind_deg, fog, thunder,
                                        //  wet, snow_cm, frost, ice, sky, season, leaf}
world.weather.ground.cleared;           // 0 … 1: how far the traffic has cleared the streets of snow
world.weather.railCondition();          // "dry" | "wet" | "leaves" | "ice"
world.weather.walkFactor();             // also driveFactor(), cycleShare(), comfort() (−1 … 1)
world.events.on("weather.changed", ({ weather }) => { /* rain or snow starts or stops, ice forms, snow lies or is gone; set by hand */ });
```

- Read the derived quantities where they fit instead of setting thresholds of your own; with the weather off they are neutral (1, `"dry"`), so nothing needs an `if`.
- `world.clock.sun()` gives today's sunrise and sunset, `clock.season()` the season; `sunTimes(doy, latitude, {year})`, `parseDay`, `parseDate`, `formatDate`, `dayOfWeek`, `isLeapYear`, `summerTime`, `seasonOf`, `leafState(doy)` and `typicalAir(seed, doy, minutes)` are exported; the last three take the day of a common year: `commonDay(clock.date, clock.year)`.
- Drawing: `view.weather` is the weather's look (`{snow, cleared, wet, cloud, fog, precipitation, rate, wind, thunder, leaf, season}`, or null). Faces that look up take the snow by themselves (a face's `snow: false` keeps it clear). A polygon, ribbon or plate takes it only when it says it is a surface: its style `snow: 0…1` is the share of the cover it takes (`snow: 1` for paving, asphalt, a platform, a track bed; the building kit's `plate` is a surface unless it says `snow: 0`). Markers, areas and status fills (a disruption, a crowd's mood, a selection) leave it out and keep their colour; in your own canvas code use `view.dim(view.tone(colour, share))`, with `1 - look.cleared` as the share for what traffic clears.

## What is not there yet

In the order of #254: waiting under roofs, moods and umbrellas, boarding and dwell times, cars and buses slower (`driveFactor()` is there, the traffic does not read it yet); energy, failures and crews of the rail operations; the hump's season from the weather; then the winter of #240, #242, #243 and #244, heat and storms (#58) and live weather (#73).
