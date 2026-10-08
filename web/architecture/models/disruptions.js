/**
 * Models of the architecture page: disruptions and scenarios. See ../model.js for the format.
 * @module architecture/models/disruptions
 */
export const DISRUPTIONS = [
  {
    id: "disruptions", group: "disruptions", title: "Disruptions and their effects",
    summary: "A disruption is a registered definition started for a target: its effects, merged per stop area, are read in every sub-step by the timetable, the bus lines, the passengers and the planned trains until it expires or is stopped.",
    description: "Disruptions are started from the Disruptions tab, by scenarios, by the control system's feed, or by simulations themselves (the infrastructure's faults). A definition says where it applies (any stop, platforms only, or nowhere: it acts once, like a driver calling in sick), its parameters, its duration and its effects: closed, hold, cancel, leave, demand, frequency, mood and messages. The types of all modules are listed under Extension points.",
    files: ["web/arail/core/disruptions.js", "web/arail/ops/disruptions.js", "web/arail/infra/disruptions.js"],
    classes: [
      {
        name: "DisruptionManager", file: "web/arail/core/disruptions.js", kind: "class", role: "The disruptions running, and their effects per stop area.",
        attributes: ["world: World", "active: object[] — {id, type, def, target, params, started, until}"],
        operations: ["start(spec) — {type, target, params, duration, id}", "stop(id)", "step() — stops those that expired", "effectsFor(area) — the merged effects at a stop area", "reset()", "draw(view) — hatching, a blinking sign at each stop"],
      },
      {
        name: "disruptions", file: "web/arail/core/disruptions.js", kind: "module", role: "The built-in types and where a disruption applies.",
        attributes: ["BUILTIN_DISRUPTIONS — delay, cancellation, closure, replacement-bus, crowd, signal-failure"],
        operations: ["affectedAreas(d, world)", "appliesTo(d, area, world)"],
      },
      { name: "ops disruptions", file: "web/arail/ops/disruptions.js", kind: "module", role: "The operations' types: they inject an event into the operations engine.", attributes: ["OPS_DISRUPTIONS — crew-sick, unit-failure, drivers-leave, workshop-closed, units-damaged"] },
      { name: "infra disruptions", file: "web/arail/infra/disruptions.js", kind: "module", role: "The infrastructure's types: they act on its engine.", attributes: ["INFRA_DISRUPTIONS — asset-fault, cable-theft, storm, infra-fault (started by the simulation)"] },
    ],
    relations: [
      { from: "World", to: "DisruptionManager", kind: "composes", label: "disruptions" },
      { from: "DisruptionManager", to: "Registry", kind: "uses", label: "definitions" },
      { from: "ServiceManager", to: "DisruptionManager", kind: "uses", label: "effectsFor" },
      { from: "PassengerSimulation", to: "DisruptionManager", kind: "uses", label: "effectsFor" },
      { from: "Transit", to: "DisruptionManager", kind: "uses", label: "effectsFor" },
      { from: "ops disruptions", to: "OperationsSimulation", kind: "uses", label: "inject" },
      { from: "infra disruptions", to: "InfrastructureSimulation", kind: "uses", label: "failAsset, inject" },
    ],
    activities: [{
      id: "life", name: "A disruption from start to expiry",
      nodes: [
        ["s", "start"],
        ["a1", "action", "Asked for: Disruptions tab, scenario, control system or a simulation", "Panels._startDisruption", "source"],
        ["d1", "decision", "Type registered?"],
        ["a2", "action", "Its parameters and end; the same id replaced", "DisruptionManager.start"],
        ["a3", "action", "Its onStart (operations, infrastructure: act once)", "DisruptionManager.start"],
        ["x1", "send", "disruption.started"],
        ["m1", "merge"],
        ["a4", "action", "A sub-step of the world", "World.step"],
        ["d2", "decision", "Expired, or stopped?"],
        ["fk", "fork"],
        ["a5", "action", "Timetable and bus lines: hold, cancel, pass closed stops", "ServiceManager.step", "consumers"],
        ["a6", "action", "Passengers: fewer or more come, mood, leave", "PassengerSimulation._stepCrowd", "consumers"],
        ["a7", "action", "Planned trains held or cancelled (operations, journeys)", "TimetableRail.step", "consumers"],
        ["jn", "join"],
        ["a8", "action", "Removed; its onStop", "DisruptionManager.stop"],
        ["x2", "send", "disruption.ended"],
        ["e", "end"],
        ["f", "flowfinal"],
      ],
      edges: [["s", "a1"], ["a1", "d1"], ["d1", "f", "no: an error"], ["d1", "a2", "yes"], ["a2", "a3"], ["a3", "x1"], ["x1", "m1"], ["m1", "a4"], ["a4", "d2"], ["d2", "fk", "no"], ["fk", "a5"], ["fk", "a6"], ["fk", "a7"], ["a5", "jn"], ["a6", "jn"], ["a7", "jn"], ["jn", "m1"], ["d2", "a8", "yes"], ["a8", "x2"], ["x2", "e"]],
    }],
    events: {
      emits: [
        { name: "disruption.started", payload: "disruption", when: "started" },
        { name: "disruption.ended", payload: "disruption", when: "expired or stopped" },
      ],
    },
    rules: [
      "Merged effects: closed, hold, cancel and leave if any disruption says so; demand and frequency multiplied; mood summed; messages joined.",
      "Timetable: due vehicles wait while closed or held; cancelled ones do not come; closed sends dwelling vehicles away.",
      "Bus lines: no departure while cancelled; a held bus stays; closed stops are passed.",
      "Passengers: arrivals × demand (none while closed); −0.3 mood for newcomers while held or cancelled; leave: people walk out.",
      "The Disruptions tab offers the types that are not hidden and whose simulation the layout has; the module Disruptions shows the tab.",
    ],
  },
  {
    id: "scenarios", group: "disruptions", title: "Scenarios",
    summary: "Timelines of a layout file: at given simulated times they set demand and speed, show messages, call trains, start and stop disruptions and send events.",
    files: ["web/arail/core/scenarios.js"],
    classes: [{
      name: "ScenarioPlayer", file: "web/arail/core/scenarios.js", kind: "class", role: "Plays one scenario at a time.",
      attributes: ["scenarios: object[] — {id, name, description, steps}", "current: object | null — the one playing", "startedAt: number — world time when played", "elapsed: number — simulated s since then"],
      operations: ["load(scenarios)", "play(id)", "stop()", "step() — runs the steps that are due", "_run(step)"],
    }],
    relations: [
      { from: "World", to: "ScenarioPlayer", kind: "composes", label: "scenarios" },
      { from: "ScenarioPlayer", to: "DisruptionManager", kind: "uses", label: "start, stop" },
      { from: "ScenarioPlayer", to: "ServiceManager", kind: "uses", label: "call" },
      { from: "ScenarioPlayer", to: "EventBus", kind: "uses", label: "emit" },
    ],
    activities: [{
      id: "run", name: "A scenario run",
      nodes: [
        ["s", "start"],
        ["a1", "action", "Play (Disruptions tab, or ?scenario= in the address)", "ScenarioPlayer.play"],
        ["x1", "send", "scenario.started"],
        ["m1", "merge"],
        ["a2", "action", "Each sub-step: the time since it was played", "ScenarioPlayer.step"],
        ["d1", "decision", "A step due?"],
        ["a3", "action", "Its actions in order: set, message, call, start, stop, emit", "ScenarioPlayer._run"],
        ["d2", "decision", "Failed?"],
        ["a4", "action", "Say so (scenario.message); its later actions skipped", "ScenarioPlayer._run"],
        ["m2", "merge"],
        ["d3", "decision", "Was it the last step?"],
        ["a5", "action", "Stop: its disruptions run on", "ScenarioPlayer.stop"],
        ["x2", "send", "scenario.ended"],
        ["e", "end"],
      ],
      edges: [["s", "a1"], ["a1", "x1"], ["x1", "m1"], ["m1", "a2"], ["a2", "d1"], ["d1", "a3", "yes"], ["a3", "d2"], ["d2", "a4", "yes"], ["d2", "m2", "no"], ["a4", "m2"], ["m2", "d1"], ["d1", "d3", "no"], ["d3", "m1", "no: next sub-step"], ["d3", "a5", "yes"], ["a5", "x2"], ["x2", "e"]],
    }],
    parameters: [
      { key: "scenarios[].steps[].at", default: "0", meaning: "Simulated seconds after Play (a pause stops the time)." },
      { key: "set, message, call, start, stop, emit", default: "", meaning: "What a step does: demand or speed, a message, a train or bus called, a disruption started or stopped, an event sent (e.g. terminal.request.*)." },
    ],
    events: {
      emits: [
        { name: "scenario.started", payload: "scenario", when: "played" },
        { name: "scenario.ended", payload: "scenario", when: "after its last step, or stopped" },
        { name: "scenario.message", payload: "scenario, text", when: "a message step, or a step failed" },
      ],
    },
    rules: ["The layers that are on add their scenarios; one with the same id replaces.", "call skips tracks run by the rail operations or the journeys, and the stops of bus lines."],
  },
];
