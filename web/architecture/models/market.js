/**
 * The models of a market square: its stalls, the Christmas tree and the rides
 * (objects/market.js), and its visitors (sims/market.js). See model.js for the conventions.
 * @module architecture/models/market
 */
export const MARKET = [
  {
    id: "market-objects", group: "market", title: "The market square, its stalls, the tree and the rides",
    summary: "A paved square whose gates are where streets meet it, arches with the market's name over them; wooden stalls (one a steam locomotive) with signs that sell Glühwein, Stollen or Lederwaren, a Christmas tree, a ferris wheel, a carousel and a mini train that board and run in turn.",
    description: "Everything on the square answers marketInfo(): a stall its goods, where people queue (its counter, the direction out of it) and its standing tables; the tree where people stand to look at it; a ride its gate. The goods keep their German names in every language. Stalls are greyscale like all buildings (BuildingBase draws them, with their counter lit while the market is open); the signs (by the kind of goods), the decorations, the rides and the lights have colours. The rides cycle by themselves; the market simulation puts its visitors on them.",
    files: ["web/arail/objects/market.js"],
    classes: [
      {
        name: "MarketSquare", file: "web/arail/objects/market.js", kind: "class", extends: "LayoutObject", role: "The paved square (Marktplatz), with lanterns round it.",
        operations: ["entrances() — gates: points every 20 m of its sides within gate_m of a street or footpath", "covers(p)", "contents() — the stalls, rides and the tree on it", "card() — stalls, rides, gates, open or closed", "draw(view) — cobbles or slabs, lanterns with light at night"],
      },
      {
        name: "MarketStall", file: "web/arail/objects/market.js", kind: "class", extends: "BuildingBase", role: "A stall: a wooden hut or a steam locomotive, with its goods.",
        operations: ["goods() — its entry of MARKET_GOODS", "tableCount() — two for drinks and food unless set", "_locomotive(m, L, sign) — boiler, chimney, wheels, cab with the serving hatch", "marketInfo() — {kind: stall, goods, counter, out, tables}", "litShare(darkness) — the counter lit while the market is open", "card() — goods, kind, price", "draw(view) — tables, steam, fairy lights, a fire's glow for hot food, its sign with the goods"],
      },
      {
        name: "MarketGate", file: "web/arail/objects/market.js", kind: "class", extends: "LayoutObject", role: "An arch over an entrance with the market's name on a board, a fir garland and lights; no obstacle: people walk through it.",
        operations: ["draw(view)"],
      },
      {
        name: "ChristmasTree", file: "web/arail/objects/market.js", kind: "class", extends: "LayoutObject", role: "The tree: tiers of a cone, baubles, twinkling lights and a star.",
        operations: ["marketInfo() — {kind: sight, at, radius}", "draw(view)"],
      },
      {
        name: "Ride", file: "web/arail/objects/market.js", kind: "class", extends: "LayoutObject", stereotype: "base class", role: "A ride that boards and runs in turn.",
        attributes: ["ride: object — {phase: boarding | running, t, riders, alighted, runs, carried}"],
        operations: ["places()", "runSeconds()", "canBoard()", "board(agent)", "takeAlighted() — the riders of the run that ended", "clearRiders(which)", "update(dt) — boarding (until board_s with riders, at most twice that), running (ride_s)", "animate(dt)", "stopped()", "card() — phase, places, runs, riders so far"],
      },
      { name: "FerrisWheel", file: "web/arail/objects/market.js", kind: "class", extends: "Ride", role: "A ferris wheel: four people per gondola; stands with a gondola at the bottom while people get in.", operations: ["marketInfo() — {kind: ride, gate, out, kids: false}", "draw(view)"] },
      { name: "Carousel", file: "web/arail/objects/market.js", kind: "class", extends: "Ride", role: "A carousel with horses under a striped canopy, for children.", operations: ["marketInfo()", "draw(view)"] },
      { name: "MiniTrain", file: "web/arail/objects/market.js", kind: "class", extends: "Ride", role: "A mini train on an oval track with a station: whole laps.", operations: ["runSeconds() — whole laps, about ride_s", "marketInfo()", "draw(view)"] },
      {
        name: "market", file: "web/arail/objects/market.js", kind: "module", role: "The goods, their kinds and the market's hours.",
        attributes: ["MARKET_GOODS — id → {name (German), kind, price, serve_s, stay (clock min), weight, kids, hot}", "GOODS_KINDS — drink, food, sweets, crafts: label and the colour of the sign", "MARKET_HOURS — 10:00 to 22:00 when no market simulation says otherwise"],
        operations: ["marketHours(world)", "marketOpen(world, minutes)", "parseHours(open, close)", "signBoard(m, x0, x1, y, z0, z1) — a sign board on a model: its back a face, its front for paintSign", "paintSign(view, board, text, opts) — the board in its colour with the text in perspective, while it faces the camera (lit at night)"],
      },
    ],
    relations: [
      { from: "MarketSquare", to: "MarketStall", kind: "aggregates", label: "contents()" },
      { from: "MarketSquare", to: "Ride", kind: "aggregates", label: "contents()" },
      { from: "MarketSquare", to: "ChristmasTree", kind: "aggregates", label: "contents()" },
    ],
    activities: [{
      id: "ride", name: "A ride's turn (Ride.update)",
      nodes: [
        ["s", "start"],
        ["m1", "merge"],
        ["a1", "action", "Boarding: the simulation puts riders on while there are places", "Ride.board"],
        ["d1", "decision", "board_s over with riders, or twice board_s?"],
        ["a2", "action", "Running: turn, go round", "Ride.animate"],
        ["d2", "decision", "ride_s over?"],
        ["a3", "action", "The riders get off; back to where it boards", "Ride.stopped"],
      ],
      edges: [["s", "m1"], ["m1", "a1"], ["a1", "d1"], ["d1", "a1", "no"], ["d1", "a2", "yes"], ["a2", "d2"], ["d2", "a2", "no"], ["d2", "a3", "yes"], ["a3", "m1"]],
    }],
    rules: [
      "A gate of the square is a point of a side (every 20 m) within gate_m (25 m) of a street or footpath; the road network connects it like a door.",
      "Stalls light their counter and fairy lights only while the market is open; the tree's lights burn all night.",
      "A stall's sign (the goods' name on a board over the counter, the coloured board by the kind of goods) is painted only while its front faces the camera, and lit at night while the market is open; a gate's sign on both sides.",
    ],
  },
  {
    id: "market", group: "market", title: "Market visitors",
    summary: "People come to the market while it is open, from the houses of the town, from the ends of the streets and by train; they queue at the stalls, stay at the standing tables, look at the tree, take rides and go home, some of them to the station.",
    description: "The number of people on the market follows the time of day (MARKET_PROFILE, × visitors). Those coming by train get off the trains at the platforms (the passenger simulation lets them alight) and go back to the station, where the passenger simulation takes them on. Off the square they walk the road network like the town's residents; on the square along flow fields: a 1 m grid without the stalls and rides (only its largest connected area), a Dijkstra distance to each place people go to, people stepping to the nearest neighbour cell and pushed apart by the crowd (crowdForces). Stays are clock minutes, walking and serving simulated seconds.",
    files: ["web/arail/sims/market.js"],
    classes: [
      {
        name: "MarketSimulation", file: "web/arail/sims/market.js", kind: "class", extends: "Simulation", role: "The visitors of the market squares.",
        attributes: ["visitors: Visitor[] — {origin, state, task, plan, bought, spent, mood}", "stalls: Map — per stall: queue, serving, sold, takings, waits", "rideQueues: Map — per ride: its queue", "tables: Map — the people at each standing table", "today: object — sold by goods, takings, came and left by how, rides (since midnight)"],
        operations: [
          "hours()", "isOpen(minutes)", "present() — people at the market at this time of day", "target() — people who should be there now: none come in the last half hour", "venues() — the squares as walking grids", "step(dt)", "_spawn(dt) — from the town and the ends of the streets",
          "_vehicleArrived(e) — visitors get off a train", "_comeIn(v, from, fromKey)", "_enterSquare(v, venue, gate)", "_plan(v, rng) — 2 to 5 things to do", "_nextTask(v, venue)", "_serve(dt)",
          "_stayAt(v, venue, o, info, minutes, goods) — at a standing table", "_rides(venue)", "_move(dt)", "_stepOnSquare(v, venue, dt, push, neighbours)", "_goOut(v, t)", "_walkStreet(v, dt)", "_giveUp() — after 75 clock minutes at the station: home another way", "_afterJump() — the clock was set: the market as it would be",
          "clear()", "doing(v)", "describeAgent(agent)", "describeObject(o, card) — queue, waiting time, sold and takings of a stall; queue of a ride; visitors and sales of a square",
          "states() — the stalls by their queue, the visitors by their mood", "marketStats()", "pickables(view)", "card(hit)", "draw(view) — in winter coats, by mood or by purpose",
        ],
      },
      {
        name: "Venue", file: "web/arail/sims/market.js", kind: "class", role: "A market square as a walking grid of 1 m cells, with its gates and flow fields.",
        attributes: ["walkable: Uint8Array — on the square, not on a stall or ride", "gates: object[] — {pos, dir, key, inside}", "fields: Map — the flow fields by place"],
        operations: ["_keepLargestArea()", "field(p) — Dijkstra over eight neighbours", "direction(f, p, target)", "free(p)", "nearestCell(p)", "randomPoint(rng)"],
      },
      { name: "market", file: "web/arail/sims/market.js", kind: "module", role: "The day of a market.", attributes: ["MARKET_PROFILE — share of visitors by the hour, the most from 17:30 to 20:30", "MARKET_COLOUR — Rot, when people show the purpose of their trip"] },
    ],
    relations: [
      { from: "MarketSimulation", to: "Venue", kind: "creates", label: "venues()" },
      { from: "MarketSimulation", to: "MarketSquare", kind: "uses", label: "entrances(), contents()" },
      { from: "MarketSimulation", to: "MarketStall", kind: "uses", label: "marketInfo()" },
      { from: "MarketSimulation", to: "Ride", kind: "uses", label: "board, takeAlighted" },
      { from: "MarketSimulation", to: "PassengerSimulation", kind: "uses", label: "alight, enter" },
      { from: "MarketSimulation", to: "RoadNetwork", kind: "uses", label: "walk" },
      { from: "MarketSimulation", to: "Population", kind: "uses", label: "bird names" },
    ],
    activities: [{
      id: "visit", name: "A visit to the market",
      nodes: [
        ["s", "start"],
        ["d1", "decision", "How do they come?"],
        ["r1", "receive", "vehicle.arrived"],
        ["a1", "action", "Get off the train (the passenger simulation)", "MarketSimulation._vehicleArrived"],
        ["r2", "receive", "passenger.exited"],
        ["a2", "action", "From a house of the town or the end of a street", "MarketSimulation._spawn"],
        ["m1", "merge"],
        ["a3", "action", "Walk the streets to the nearest gate of the square", "MarketSimulation._comeIn"],
        ["m2", "merge"],
        ["a4", "action", "The next thing to do: a stall (by its goods, queue and distance), the tree, a ride", "MarketSimulation._nextTask"],
        ["d2", "decision", "Anything left, and the market open?"],
        ["a5", "action", "Walk the flow field there, pushed by the crowd", "MarketSimulation._stepOnSquare"],
        ["d3", "decision", "What?"],
        ["a6", "action", "Queue; served at the counter; pay", "MarketSimulation._serve"],
        ["a7", "action", "Stay at a standing table to eat or drink", "MarketSimulation._stayAt"],
        ["a8", "action", "Queue at the gate, ride, get off", "MarketSimulation._rides"],
        ["a9", "action", "Look at the tree for a few minutes", "MarketSimulation._stepOnSquare"],
        ["m3", "merge"],
        ["a10", "action", "To the gate nearest home; out into the streets", "MarketSimulation._goOut"],
        ["d4", "decision", "Came by train?"],
        ["a11", "action", "Wait at the platform for any train (the passenger simulation)", "MarketSimulation._walkStreet"],
        ["r3", "receive", "passenger.boarded"],
        ["a12", "action", "Home", "MarketSimulation._walkStreet"],
        ["e", "end"],
      ],
      edges: [
        ["s", "d1"], ["d1", "r1", "by train"], ["r1", "a1"], ["a1", "r2"], ["r2", "m1"], ["d1", "a2", "from the town or the streets"], ["a2", "m1"], ["m1", "a3"], ["a3", "m2"],
        ["m2", "a4"], ["a4", "d2"], ["d2", "a5", "yes"], ["a5", "d3"], ["d3", "a6", "a stall"], ["a6", "a7"], ["d3", "a8", "a ride"], ["d3", "a9", "the tree"], ["a7", "m3"], ["a8", "m3"], ["a9", "m3"], ["m3", "m2"],
        ["d2", "a10", "no"], ["a10", "d4"], ["d4", "a11", "yes"], ["a11", "r3"], ["r3", "e"], ["d4", "a12", "no"], ["a12", "e"],
      ],
    }],
    parameters: [
      { key: "visitors", default: "240", meaning: "People on the market at once at the busiest time (17:30 to 20:30); fewer over the day (MARKET_PROFILE).", sim: "market" },
      { key: "open", default: "10:00", meaning: "When the market opens.", sim: "market" },
      { key: "close", default: "22:00", meaning: "When it closes: nobody comes in the last half hour; at closing time everybody finishes what they do and goes.", sim: "market" },
      { key: "by_train", default: "0.3", meaning: "Share of the visitors who come by train (when there are platforms and a passenger simulation).", sim: "market" },
      { key: "from_homes", default: "0.45", meaning: "Of the others, the share who come from the houses of the town (by their residents); the rest from the ends of the streets.", sim: "market" },
      { key: "children", default: "0.15", meaning: "Share of children: they want rides, Kakao, Punsch and sweets.", sim: "market" },
      { key: "seed", default: "1", meaning: "Random seed of the visitors.", sim: "market" },
    ],
    rules: [
      "Visitors want 2 to 5 things; three in four grown-ups a hot drink first. A stall is chosen by the weight of its goods (children: three times for what they like) / (1 + queue/4) / (1 + distance/40 m).",
      "A queue of 12 sends people elsewhere, and costs mood; waiting longer than a minute costs mood too.",
      "Serving takes serve_s × 0.7 to 1.4; at a craft stall 45 % buy. Drinks and food are eaten on the spot at a standing table (four places), else in front of the stall, for the goods' stay in clock minutes.",
      "Who came by train goes back to the station and waits there for any train; after 75 clock minutes (no trains after midnight), or when the passengers give up, they go home another way.",
      "When the clock is set, the market is filled to 80 % of the people it should have, on the square.",
    ],
  },
];
