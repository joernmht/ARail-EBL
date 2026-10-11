/**
 * Models of the role games: the game core that every role's game shares, and the first game, the
 * signaller of Bf Neustadt in a relay interlocking, with its page. See model.js for the conventions.
 * @module architecture/models/games
 */

export const GAMES = [
  {
    id: "game-core", group: "games", title: "The game core",
    summary: "What the role games share: a role at work with a clock, resources, decisions with a deadline and a default, rules kept or broken, objectives with weights, a log; and the result that a round gives to the career mode and the big game.",
    description: "A first, small form of the common game core (issue #103). A game is one role of the role catalogue (docs/roles.md). It runs without the world and without the DOM, in Node and the browser, and is deterministic: random numbers come from streams keyed by the seed and what they are for. A page draws it and passes the player's moves; the game's events (log, decision, decided, violation, over) tell the page what happened.",
    files: ["web/arail/game/core.js"],
    classes: [{
      name: "Game", file: "web/arail/game/core.js", kind: "class", role: "A role's game: clock, resources, decisions, rules, objectives, score.",
      attributes: ["static id, title, role, kind — the game, its role in the catalogue, knowledge, simulation or both", "t: number — simulated seconds since the start", "over: string | null — why it ended", "resources: Map — money, time, counters", "decisions: object[] — asked, with options, deadline and fallback", "violations: object[] — rules broken, with their severity", "logs: object[]"],
      operations: ["rng(...parts) — a random stream for one purpose", "on(fn)", "emit(name, payload)", "log(text, kind)", "resource(id, label, value, unit)", "add(id, v)", "value(id)", "ask(spec) — a decision with options, a deadline and a fallback", "decide(id, option) — the player's or, at the deadline, the fallback", "violate(rule, text, severity) — 1 a slip, 2 a breach, 3 a danger to people", "step(dt) — deadlines, then tick", "tick(dt) — the game's own step", "end(reason)", "objectives() — weighted, each reached 0–1", "score() — 0–100", "result() — for the career mode: score, rules broken, passed, decisions"],
    }],
    relations: [],
    activities: [{
      id: "decision", name: "A decision (Game.ask, Game.step, Game.decide)",
      nodes: [
        ["s", "start"],
        ["a1", "action", "The game asks: title, options, a deadline and a fallback", "Game.ask"],
        ["d1", "decision", "Decided before the deadline?"],
        ["a2", "action", "The player's option is taken", "Game.decide", "player"],
        ["a3", "action", "At the deadline the fallback is taken", "Game.step", "game"],
        ["m1", "merge"],
        ["a4", "action", "What the option does (the game's handler)", "Game.decide"],
        ["a5", "action", "Recorded for the result: option, time, by default or not", "Game.result"],
        ["e", "end"],
      ],
      edges: [["s", "a1"], ["a1", "d1"], ["d1", "a2", "yes"], ["d1", "a3", "no"], ["a2", "m1"], ["a3", "m1"], ["m1", "a4"], ["a4", "a5"], ["a5", "e"]],
    }],
    rules: [
      "Score = the objectives' values (0–1) weighted by their weights, 0–100.",
      "A round is passed with a score of at least 50 and no danger to people (no rule broken with severity 3).",
    ],
  },
  {
    id: "signaller-game", group: "games", title: "The signaller's game",
    summary: "The signaller (Fahrdienstleiter) of Bf Neustadt in a relay interlocking: routes from a start signal to a destination for a morning half hour, a failed exit signal with the substitute signal, the fault report and the track closure for the repair team.",
    description: "The station of the lab survey and the maintenance story, as a track diagram: platform tracks G1–G3, the double-track line from Bergheim to Talsee, entry signals A and F, exit signals N1–N3 and P2, P3, points W1–W6. The interlocking refuses a route whose sections are occupied, locked by another route or closed; it moves the points, locks the route and clears the signal; the train takes the route when it may pass; the sections are released behind its tail, and a point with its section. Trains brake for a signal at stop, from its distant signal at caution until they see it clear, for the speed of the route and at their platform. At 08:13 (normal level) exit signal N2 fails: its route can be set but the signal stays at stop. Simplified from the German rules for signallers (Ril 408).",
    files: ["web/arail/game/signaller.js"],
    classes: [
      {
        name: "SignallerGame", file: "web/arail/game/signaller.js", kind: "class", extends: "Game", role: "The interlocking, the trains, the failure, the repair team and the score.",
        attributes: ["points: object — position, target, until when it moves", "signals: object — failed, substitute signal lit", "routes: Map — set or locked, the train on it, its sections not yet released", "closed: Map — closed tracks", "trains: Train[]", "failure: object | null — the failed signal: when, reported, repaired", "team: object — the repair team: driving, waiting, working, done, left", "answers: Map — the short questions, right or not"],
        operations: ["occupancy() — sections and their trains", "lockOf(section)", "routeFrom(signal) — the route no train has passed yet", "aspect(id) — proceed or stop", "blocked(routeId) — why not, or null", "routesFrom(signal)", "setRoute(routeId)", "cancelRoute(routeId) — unless a train approaches on it", "substitute(signal, checks) — Zs 1 with the checks and the reason", "reportFault()", "closeTrack(track)", "openTrack(track)", "tick(dt)", "nextSignal(tr)", "distanceTo(tr, signal)", "report() — the trains and their delays", "connections()", "objectives()", "state() — what the page draws"],
      },
      {
        name: "Train", file: "web/arail/game/signaller.js", kind: "class", role: "A train of the timetable: its path as far as its routes go, the head and the speed.",
        attributes: ["path: string[] — sections in the order of travel", "head: number — m from the start of the path", "v: number — m/s", "state: string — coming, running, dwelling, gone", "caution: Set — signals warned of at their distant signal", "starts — where each section of the path begins", "tail", "due — departure or passing time"],
      },
    ],
    relations: [
      { from: "SignallerGame", to: "Train", kind: "composes", label: "trains" },
    ],
    activities: [
      {
        id: "route", name: "A route from start to destination (SignallerGame.setRoute)",
        nodes: [
          ["s", "start"],
          ["a1", "action", "The player chooses a start signal and a destination", "SignallerPage.choose", "player"],
          ["d1", "decision", "Sections clear, not locked, no track closed, no other route from the signal?"],
          ["a2", "action", "Refused, with the reason", "SignallerGame.blocked", "interlocking"],
          ["a3", "action", "The points move to their position", "SignallerGame.setRoute", "interlocking"],
          ["a4", "action", "All points in position: the route is locked", "SignallerGame.tick", "interlocking"],
          ["d2", "decision", "The signal works?"],
          ["a5", "action", "The signal clears: proceed", "SignallerGame.aspect", "interlocking"],
          ["a6", "action", "Stays at stop: the player gives Zs 1 after the checks", "SignallerGame.substitute", "player"],
          ["m1", "merge"],
          ["a7", "action", "The train takes the route; the signal returns to stop behind its head", "SignallerGame.tick", "train"],
          ["a8", "action", "Sections (and their points) released behind its tail", "SignallerGame.tick", "interlocking"],
          ["e", "end"],
          ["e2", "flowfinal"],
        ],
        edges: [["s", "a1"], ["a1", "d1"], ["d1", "a2", "no"], ["a2", "e2"], ["d1", "a3", "yes"], ["a3", "a4"], ["a4", "d2"], ["d2", "a5", "yes"], ["d2", "a6", "failed"], ["a5", "m1"], ["a6", "m1"], ["m1", "a7"], ["a7", "a8"], ["a8", "e"]],
      },
      {
        id: "failure", name: "The failed signal and its repair (SignallerGame)",
        nodes: [
          ["s", "start"],
          ["a1", "action", "Signal N2 shows no proceed aspect; the game asks for a fault report", "SignallerGame.tick", "game"],
          ["d1", "decision", "Reported?"],
          ["a2", "action", "Asked again three minutes later", "SignallerGame.tick", "game"],
          ["a3", "action", "The repair team drives out from the maintenance base", "SignallerGame.reportFault", "player"],
          ["a4", "action", "The team asks for track G2 to be closed", "SignallerGame.tick", "game"],
          ["a5", "action", "The player closes G2 once it is clear", "SignallerGame.closeTrack", "player"],
          ["a6", "action", "The team works, then reports that it has left the track", "SignallerGame.tick", "game"],
          ["d2", "decision", "G2 opened before the report?"],
          ["a7", "action", "A danger to people: the round fails", "Game.violate", "game"],
          ["a8", "action", "The player opens G2; N2 works again", "SignallerGame.openTrack", "player"],
          ["e", "end"],
        ],
        edges: [["s", "a1"], ["a1", "d1"], ["d1", "a2", "later"], ["a2", "d1"], ["d1", "a3", "now"], ["a3", "a4"], ["a4", "a5"], ["a5", "d2"], ["d2", "a7", "yes"], ["d2", "a6", "no"], ["a7", "e"], ["a6", "a8"], ["a8", "e"]],
      },
    ],
    rules: [
      "Braking 0.6 m/s², accelerating 0.5 m/s² (freight 0.25); a train sees a signal from 400 m, its distant signal stands 1000 m before it.",
      "A point moves in 6 s; the substitute signal allows 40 km/h through the points that follow; a train dwells at least 40 s.",
      "Platform tracks are 750 m long; a freight train of 600 m fits.",
      "A connection holds when the second train leaves at least 30 s (same platform) or 150 s (the other platform) after the first arrived.",
      "Objectives: punctuality 35 (0 at 6 min average delay, weighted by kind of train), safety 30, connections and platforms 15, the failure 10 (reported within 2 min: full), questions 10.",
      "Rules broken: Zs 1 without a locked route or into an occupied section, and opening the track with the repair team on it: severity 3; Zs 1 without the checks: 2; no or the wrong reason recorded: 1.",
    ],
  },
  {
    id: "signaller-page", group: "games", title: "The signaller's page",
    summary: "The page of the signaller's game (game/signaller/): the panel as SVG, routes from the panel or a form, the substitute signal with its checks, tracks to close, decisions and questions, the trains, the messages and the score.",
    description: "The panel is a control desk in Dunkelblau in light and dark mode: sections in the light colours of the overlay (Türkis: a locked route, red: occupied, orange dashed: closed), signals with their lamps as buttons, the points' legs not in use dimmed, the trains as tags at their head. A start signal shows its destinations as buttons on the panel; everything on the panel can also be done in the side panels, with the keyboard. The game runs on requestAnimationFrame at the chosen speed (pause, 1×, 5×, 10×).",
    files: ["web/game/signaller/signaller.js"],
    classes: [{
      name: "SignallerPage", file: "web/game/signaller/signaller.js", kind: "class", role: "Draws the game and passes the player's moves to it.",
      operations: ["newGame()", "build() — the panel's fixed parts", "draw(force) — the state on the panel", "choose(id) — a start signal", "set(routeId)", "cancel(id)", "giveZs1(id)", "track(t, closed)", "side() — decisions, routes, signals and tracks, trains, messages, score", "frame(t)", "key(e) — Escape, P"],
    }],
    relations: [
      { from: "SignallerPage", to: "SignallerGame", kind: "uses", label: "game" },
    ],
  },
];
