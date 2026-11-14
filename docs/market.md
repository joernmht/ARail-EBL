# The market square and the Striezelmarkt

A market square (Marktplatz) on a table module of its own, west of the town of the lab example, and on it, as two modules that are switched on and off, a German Christmas market (in Dresden the Striezelmarkt) and its visitors. The stalls sell Glühwein, Punsch, Eierpunsch, Kakao, Baumstriezel, Handbrot, Aachener Printen, Nürnberger Lebkuchen, Dresdner Stollen, Lübecker Marzipan, Marzipan, Langos, Flammlachs, Maronen, Pilze (from a stall built like a steam locomotive), Strickwaren, Lederwaren, Holzkunst aus dem Erzgebirge and Kerzen: the goods keep their German names in every language. A big decorated Christmas tree stands in the middle, with a ferris wheel, a carousel and a mini train round it.

For a railway lab the visitors matter beyond the market: about a third of them come by train and go home by train, so the market fills the platforms in the evening and, at closing time, all at once.

## In the app

Open the lab example (`app/?layout=../layouts/ebl-lab.json`) and switch on the modules in **Interaction → Sandbox**, or with the address: `app/?layout=../layouts/ebl-lab.json&layers=striezelmarkt,market-visitors`.

| Module | What it adds |
| --- | --- |
| *(the base)* | the market module M with the paved Marktplatz, Lindenallee leading to it and the Altbau Am Markt on its south side |
| **Striezelmarkt** (`striezelmarkt`) | 22 stalls, the Christmas tree, the ferris wheel (Riesenrad), the carousel (Kinderkarussell) and the mini train (Kindereisenbahn); the scenario *Evening at the Striezelmarkt* |
| **Market visitors** (`market-visitors`) | the visitor simulation `market`; the scenario *Closing time at the Striezelmarkt*. Needs the Striezelmarkt: without stalls and rides the visitors have nothing to do |

The rides board and run in turn also without visitors. The stalls light their counters and fairy lights while the market is open (10:00 to 22:00), the tree its lights all night, the lanterns round the square at dusk. Point at a stall for its goods, price, queue, waiting time, sales and takings today; at the square for the visitors now and what sold best; at a visitor for where they came from, what they bought and what they still want to do; at a ride for its places, runs and queue. The Overview rates the stalls by their queues and the visitors by their mood.

The clock's sun follows a summer day (sunset 20:30): *Evening at the Striezelmarkt* sets the clock to 19:45, so that the lights come on at dusk while the market is open. *Closing time* starts at 20:30 on a busy evening; at 22:00 the market closes and everybody goes, many to the station.

## The objects

| Type | Placement | What it is |
| --- | --- | --- |
| `market-square` | polygon | the paved square; its gates (`entrances()`) are points of its sides within `gate_m` of a street or footpath, connected to the road network like doors |
| `market-stall` | point | a wooden hut or a steam locomotive (`style`) selling one kind of `goods`, with a counter on its front (−y), fairy lights and standing tables (two for drinks and food unless `tables` says otherwise) |
| `christmas-tree` | point | tiers of a cone with baubles, twinkling lights and a star; people stop to look at it |
| `ferris-wheel`, `carousel`, `mini-train` | point | rides: boarding for `board_s`, then running for `ride_s` (the mini train whole laps); riders are drawn in the gondolas, on the horses, in the cars |

The settings are in the [layout file format](layout-format.md#market-square-and-christmas-market). Stalls are greyscale like all buildings; their signs are coloured by the kind of goods (hot drinks Rot, food Orange, sweets Gelb, crafts Türkis).

## The visitors

The number of people at the market follows the time of day: `visitors` (240 by default, 260 in the lab) at the busiest time from 17:30 to 20:30, fewer over the day (`MARKET_PROFILE`), none in the last half hour before closing. They come

- **by train** (`by_train`, 0.3): they get off the trains at the platforms (the passenger simulation lets them alight, door by door) and walk to the market;
- **from the town** (`from_homes`, 0.45 of the others): from the houses of the town, by their residents;
- **from beyond the layout**: from the free ends of the streets.

Off the square they walk the road network on the sidewalks, like the town's residents. On the square they walk along **flow fields**: the square is a grid of 1 m cells without the stalls and rides (only its largest connected area, so that nobody is caught behind a row of stalls); for each place people go to (a counter, a gate, a table) the walking distance of every cell to it is worked out once, by Dijkstra over eight neighbours, and people step to the neighbour cell nearest to it. The crowd pushes them apart (the social forces of the passenger simulation); in a crowd they walk slower.

Each visitor wants two to five things, three in four grown-ups a hot drink first; children want rides, Kakao, Punsch and sweets:

- **A stall** is chosen by the weight of its goods (Glühwein ten times as much as Lederwaren) divided by its queue and its distance. People queue in a line out from the counter; serving takes the goods' `serve_s` (Glühwein 18 s, Lederwaren 70 s); at a craft stall 45 % buy. A queue of 12 sends people elsewhere, and long waits cost mood.
- **Drinks and food** are eaten on the spot: at a standing table (four places each), else in front of the stall, for 5 to 25 clock minutes by the goods.
- **The tree**: people stand round it for a few minutes.
- **A ride**: they queue at its gate and get on while it boards.

Then they leave by the gate nearest home; who came by train walks to the station and waits at the platform for any train (handed over to the passenger simulation). At closing time everybody finishes what they are doing and goes. Setting the clock fills the market as it would be at that time (80 % of the people it should have, on the square).

Stays are clock minutes, walking and serving simulated seconds, as everywhere in ARail ([Day and night](day-and-night.md)). People are named with bird names, like everybody in the simulations.

## For plugins and simulations

- `marketInfo()` of an object tells the market what it is: `{kind: "stall", goods, counter, out, tables}`, `{kind: "sight", at, radius}` or `{kind: "ride", ride, gate, out, kids}`. An object of a plugin with this method takes part (a ride extends `Ride` and overrides `places()`, `animate(dt)`, `stopped()` and `draw(view)`).
- `MARKET_GOODS` lists the goods (German name, kind, price, serving time, stay, weight, whether children ask for it, whether it is made over a fire); `marketOpen(world)` and `marketHours(world)` the hours (the market simulation's, else 10:00 to 22:00).
- The simulation (`sims/market.js`): `marketStats()` (visitors by what they do, sold today by goods, takings, how they came), `isOpen()`, `target()`, `doing(visitor)`.
