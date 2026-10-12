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
    id: "role-catalogue", group: "games", title: "The role catalogue",
    summary: "The roles of the German railway system, from the politician to the cleaning staff, in families, with what a game of each needs: setting, decisions and effects, means, limits, personal risks, career and ways in, measures, rhythm, the roles it works with, and a mini game; and the qualifications the ways in need.",
    description: "The data is web/game/roles/roles.json (format arail-roles/2), loaded where it is needed: the roles page, the career planner, the guide docs/roles.md written by tools/roles-md.mjs, the tests. Each role's access says whether it is a job, how it is filled, a minimum age, the fitness, its ways in (alternatives of qualifications and years in other roles) and what is gained in it; the catalogue's qualifications (school certificates, apprenticeships, degrees, trainings, licences, certificates, exams) say what each needs first. A role's typical moves (career from and to) are hints, drawn as a graph.",
    files: ["web/arail/game/roles.js"],
    classes: [{
      name: "roles", file: "web/arail/game/roles.js", kind: "module", role: "Checks a catalogue and reads it as a career graph.",
      attributes: ["ROLE_SETTINGS — operational, field, office, mixed", "GAME_EFFORTS — small, medium, large"],
      operations: ["validateRoles(cat) — ids, families, settings, every field; qualifications and their prerequisites; access and ways in; careers, interactions and ways in naming roles and qualifications of the catalogue", "careerGraph(cat) — the typical moves from role to role, from both sides of the careers", "roleCounts(cat) — per family, setting, kind of game, effort"],
    }],
    relations: [],
    rules: ["A role's id is kebab-case and unique; its family is one of the catalogue's; its game is knowledge, simulation or both, of small, medium or large effort.", "A job has at least one way in; a way in names qualifications and roles of the catalogue.", "The typical moves have a step a → b where a names b in its career's `to`, or b names a in its `from`."],
  },
  {
    id: "career-model", group: "games", title: "The career mode's model",
    summary: "One person's working life through the roles as a graph of possibilities: from a school certificate, at every point some jobs are open and some educations can be started; the player chooses.",
    description: "A person holds qualifications and years in roles. A job is open when one of its ways in has all its qualifications and the years of experience asked, and the person is old enough; an education can be started when one of its sets of prerequisites is held. An education that cannot be done alongside a job means leaving the current role for its time. After a year in a role, what the role gains (a supplementary certificate, a recognition) is held. For a role aimed at, each way in tells what is there and what is missing, and each missing qualification what it needs first. Every job of the catalogue must be reachable from leaving school.",
    files: ["web/arail/game/career.js"],
    classes: [{
      name: "career", file: "web/arail/game/career.js", kind: "module", role: "The person, what is open, the steps, what is missing.",
      attributes: ["SELECTIONS — application, internal, election, appointment, none", "QUALIFICATION_KINDS — school, apprenticeship, degree, training, licence, certificate, exam"],
      operations: ["startPoints(cat) — the school certificates and the age at each", "createCareer(cat, start)", "ageOf(p)", "yearsIn(p, roles)", "canStart(cat, p, qid)", "routeStatus(p, route) — qualifications and experience missing", "roleStatus(cat, p, roleId) — open or not, each way in", "options(cat, p) — jobs open, educations to start, working on", "takeRole(cat, p, roleId)", "study(cat, p, qid)", "work(cat, p, years)", "missingText(cat, st)", "prerequisiteTree(cat, qid)", "reachable(cat) — every qualification and job reachable from leaving school"],
    }],
    relations: [],
    activities: [{
      id: "step", name: "A step of a career (career.options, takeRole, study, work)",
      nodes: [
        ["s", "start"],
        ["a1", "action", "Leave school with a certificate", "createCareer", "player"],
        ["m1", "merge"],
        ["a2", "action", "What is open: jobs with a way in fulfilled, educations with their prerequisites held", "options", "game"],
        ["d1", "decision", "The player's choice"],
        ["a3", "action", "Take a job (application, internal, election or appointment)", "takeRole", "player"],
        ["a4", "action", "Start an education; leave the role unless it can be done alongside", "study", "player"],
        ["a5", "action", "Work on: years in the role; after a year, what the role gains", "work", "player"],
        ["m2", "merge"],
        ["d2", "decision", "Go on?"],
        ["e", "end"],
      ],
      edges: [["s", "a1"], ["a1", "m1"], ["m1", "a2"], ["a2", "d1"], ["d1", "a3", "a job"], ["d1", "a4", "an education"], ["d1", "a5", "work on"], ["a3", "m2"], ["a4", "m2"], ["a5", "m2"], ["m2", "d2"], ["d2", "m1", "yes"], ["d2", "e", "no"]],
    }],
    rules: ["A way in is fulfilled when all its qualifications are held and, for each experience it asks, the years in any of its roles are reached.", "School certificates start a career at 16 (the first and the intermediate) or 18 (the Abitur and the Fachhochschulreife)."],
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
  {
    id: "roles-page", group: "games", title: "The roles page",
    summary: "The role catalogue as a page (game/roles/): the families as filters, a search, every role as a card with its details and ways in, links between roles and to the career planner.",
    files: ["web/game/roles/roles.js"],
    classes: [{
      name: "RolesPage", file: "web/game/roles/roles.js", kind: "class", role: "Shows the catalogue loaded from roles.json.",
      operations: ["filters()", "pickFamily(id)", "shown() — the roles the filters let through", "render()", "link(id)", "card(r)", "ways(r) — a role's ways in", "show(id) — a role opened and scrolled to"],
    }],
    relations: [],
  },
  {
    id: "career-page", group: "games", title: "The career planner",
    summary: "The career mode as a prototype (game/career/): start from a school certificate, see what is open, take a step, work on, step back; aim at a role and see what is missing on each way in.",
    files: ["web/game/career/career.js"],
    classes: [{
      name: "CareerPage", file: "web/game/career/career.js", kind: "class", role: "Shows a career and passes the player's steps to the model; keeps it in the browser.",
      operations: ["start(id)", "persist()", "step(fn) — a step, kept for a step back", "undo()", "roleLink(id)", "render()", "aimView(id) — the role aimed at, its ways in"],
    }],
    relations: [],
  },
];
