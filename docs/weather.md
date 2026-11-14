# Seasons and weather

ARail's clock can carry a **date**, and the world a **weather**. With a date the sun rises and sets as on that day in Dresden and the trees follow the season; the weather is the typical one of the date or one set by hand or by a scenario. The rails, the people on foot, the cyclists and the market read it, and the picture shows it: snow on the roofs, wet streets, rain and flakes falling.

This is the base of the concept in [#254](https://github.com/joernmht/ARail-EBL/issues/254) (part of the seasons, [#239](https://github.com/joernmht/ARail-EBL/issues/239)). What comes later is listed [at the end](#what-is-not-there-yet).

**Nothing changes unasked.** A layout without a date and without weather behaves exactly as before: the sun from 06:00 to 20:30, a mild dry day, every factor 1.

## In the app

**Settings → Simulation → Date and weather**:

- **Month** and **Day**: the date, or *No date* (every day is the same day). The date runs on at midnight.
- **Weather**: *Off*, *Typical for the date*, or a fixed one: *Clear, Cloudy, Overcast, Rain, Heavy rain, Snowfall, Frost, Fog, Heat*.
- The line below says what holds now: sunrise and sunset, the temperature and the sky, the ground (dry, wet, ice, centimetres of snow) and the rails.

With a date or a weather, a chip on the stage shows them: *6 Dec · −2 °C · snow*. What is set here is not saved with the layout; a layout's own date and weather are ([layout file](#in-a-layout-file)).

The lab example's scenario *Evening at the Striezelmarkt* (module Striezelmarkt) sets 6 December, 15:45 and snowfall: dusk comes at four.

## The date and the sun

- The date is a day of the year (`"12-06"`); the clock has no year, so there are no leap days, weekdays or holidays yet.
- **Seasons** are the meteorological ones (winter: December to February).
- **Sunrise and sunset** come from the date and the latitude (`clock.latitude`, 51.05° N), in Central European Time with summer time (29 March to 24 October), at Dresden's longitude: 08:06 to 16:01 on 21 December, 04:49 to 21:23 on 21 June. Twilight is as before (45 minutes to either side). Lamps and windows follow the light, so they come on at four in December.
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

A **course** (key frames over the day) lies on top of either: the first frost night, snow from six in the morning.

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

- **Snow**: flakes fall, drifting with the wind. Snow cover whitens the ground and what faces up (roofs, the tops of stalls and trees) as it settles, fully at 4 cm; streets in use take half of it.
- **Rain**: streaks, slanted by the wind, denser with the rate; wet ground is darker.
- **Cloud and fog**: a grey veil over the picture by day; fog thicker towards the distance. The flyover's sky turns grey.
- **Trees**: deciduous trees are bare in winter, light green in spring, yellow to red-brown in October (each tree in its own time); conifers stay green. Grass pales in winter; fields are brown, green, yellow and stubble through the year.
- **Over the camera image** the real model stays as it is: the virtual world gets its snow, the rain and the flakes lie over the whole picture.
- **Map and 2.5D**: no weather drawn.
- With *reduce motion* set in the system, rain and snow stand still. Labels and boards are drawn above the weather.

## In a layout file

```json
"clock": { "start": "07:00", "date": "11-10", "latitude": 51.05 },
"weather": { "mode": "typical" }
```

| Key | Default | Meaning |
| --- | --- | --- |
| `clock.date` | none | the date the layout starts with (`"MM-DD"`) |
| `clock.latitude` | `51.05` | °N, for the sun |
| `weather` | off | a preset's name (`"snow"`), or an object: |
| `weather.mode` | `"off"` | `off`, `typical`, `fixed` |
| `weather.preset` | | `clear`, `cloudy`, `overcast`, `rain`, `heavy-rain`, `snow`, `frost`, `fog`, `heat` |
| `weather.state` | | quantities over the preset: `temperature_c`, `cloud` (0…1), `precipitation` (`none`, `rain`, `sleet`, `snow`), `rate_mm_h`, `wind_mps`, `wind_deg`, `fog` (0…1); `wet` (0…1) and `snow_cm` for where the ground starts |
| `weather.course` | | `[["05:00", {…}], ["07:00", {…}]]`: quantities at times of day, in proportion between them |
| `weather.seed` | `1` | another typical year |

A scenario step sets them too ([Disruptions and scenarios](disruptions-and-scenarios.md)):

```json
{ "at": 0, "set": { "date": "12-06", "time": "15:45", "weather": "snow" } }
{ "at": 60, "set": { "weather": { "preset": "rain", "temperature_c": -2 } } }
```

The layout check reports a date, a mode, a preset or a course that is none.

## For plugins and simulations

```js
world.setDate("11-10");                 // or null: no date; sends clock.date and clock.set
world.setWeather("typical");            // or a preset's name, "off", or {preset, mode, course, …quantities}
const now = world.weather.now();        // {temperature_c, cloud, precipitation, rate_mm_h, wind_mps, wind_deg, fog,
                                        //  wet, snow_cm, frost, ice, sky, season, leaf}
world.weather.railCondition();          // "dry" | "wet" | "leaves" | "ice"
world.weather.walkFactor();             // also driveFactor(), cycleShare(), comfort() (−1 … 1)
world.events.on("weather.changed", ({ weather }) => { /* rain or snow starts or stops, ice forms, snow lies or is gone; set by hand */ });
```

- Read the derived quantities where they fit instead of setting thresholds of your own; with the weather off they are neutral (1, `"dry"`), so nothing needs an `if`.
- `world.clock.sun()` gives today's sunrise and sunset, `clock.season()` the season, `sunTimes(doy, latitude)`, `parseDate`, `formatDate`, `seasonOf`, `leafState(doy)` and `typicalAir(seed, doy, minutes)` are exported.
- Drawing: `view.weather` is the weather's look (`{snow, wet, cloud, fog, precipitation, rate, wind, leaf, season}`, or null). Polygons on the ground and faces that look up take the snow by themselves (a polygon's style `snow: 0…1` is its share, a face's `snow: false` keeps it clear); in your own canvas code use `view.dim(view.tone(colour, share))`.

## What is not there yet

In the order of #254: waiting under roofs, moods and umbrellas, boarding and dwell times, cars and buses slower (`driveFactor()` is there, the traffic does not read it yet); energy, failures and crews of the rail operations; the hump's season from the weather; then the winter of #240, #242, #243 and #244, heat and storms (#58) and live weather (#73).
