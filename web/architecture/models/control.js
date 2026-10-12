/**
 * Models of the architecture page: the control system's trains (feed and bridge). See ../model.js.
 * @module architecture/models/control
 */
export const CONTROL = [
  {
    id: "feed", group: "control", title: "Trains of the control system",
    summary: "Positions of real trains from the control system (arail-feed/1 messages): trains that stand at a platform are handed to the timetable's docks, so passengers get on and off the real train.",
    description: "WebSocketFeed is the browser's client of the bridge (it reconnects on its own); MockFeed simulates a control system in the page. TrainRegistry applies the messages, estimates speeds, and detects a train that stands still beside a platform track: the dock is then in mode feed and the services treat the train as arrived until it moves again. Disruption messages of the feed start and stop disruptions.",
    files: ["web/arail/core/trains.js", "web/arail/feeds/websocket.js", "web/arail/feeds/mock.js"],
    classes: [
      {
        name: "TrainRegistry", file: "web/arail/core/trains.js", kind: "class", role: "Positions, speeds and arrivals of the control system's trains.",
        attributes: ["trains: Map — id → train", "source: string | null — the control system", "timeout: number — 15 s without news: gone", "stopSpeed: number — 3 mm/s counts as standing", "stopAfter: number — 1.5 s standing: arrived"],
        operations: ["apply(input) — a feed message", "step(dtReal)", "reset()", "draw(view)", "_matchDock(t)", "_syncModes()"],
      },
      { name: "WebSocketFeed", file: "web/arail/feeds/websocket.js", kind: "class", role: "The client of the bridge, with reconnects.", attributes: ["url: string", "status: string — connecting, connected, disconnected, error", "messages: number", "rejected: number"], operations: ["connect()", "close()"] },
      { name: "MockFeed", file: "web/arail/feeds/mock.js", kind: "class", role: "A simulated control system in the page.", attributes: ["dwell: number — s at a platform"], operations: ["start()", "stop()", "tick(dt)"] },
    ],
    relations: [
      { from: "World", to: "TrainRegistry", kind: "composes", label: "trains" },
      { from: "WebSocketFeed", to: "TrainRegistry", kind: "uses", label: "apply" },
      { from: "MockFeed", to: "TrainRegistry", kind: "uses", label: "apply" },
      { from: "TrainRegistry", to: "ServiceManager", kind: "uses", label: "feedArrived, feedDeparted" },
      { from: "TrainRegistry", to: "DisruptionManager", kind: "uses", label: "disruption messages" },
    ],
    activities: [
      {
        id: "socket", name: "Messages from the bridge",
        nodes: [
          ["s", "start"],
          ["a1", "action", "Connect; say hello", "WebSocketFeed.connect"],
          ["m1", "merge"],
          ["d1", "decision", "What happens?"],
          ["a2", "action", "Parse and apply: trains (full or changes), remove, disruption", "TrainRegistry.apply"],
          ["x1", "send", "feed.trains"],
          ["a3", "action", "Docks of standing trains to mode feed", "TrainRegistry._syncModes"],
          ["d2", "decision", "Closed on purpose?"],
          ["a4", "action", "Retry later (up to 30 s)", "WebSocketFeed.connect"],
          ["f", "flowfinal"],
        ],
        edges: [["s", "a1"], ["a1", "m1"], ["m1", "d1"], ["d1", "a2", "a message"], ["d1", "d2", "the connection closed"], ["a2", "x1"], ["x1", "a3"], ["a3", "m1"], ["d2", "f", "yes"], ["d2", "a4", "no"], ["a4", "a1"]],
      },
      {
        id: "arrival", name: "A train arrives at a platform (TrainRegistry.step)",
        nodes: [
          ["s", "start"],
          ["m1", "merge"],
          ["d1", "decision", "Another train?"],
          ["d2", "decision", "No news for 15 s?"],
          ["a1", "action", "Remove it", "TrainRegistry.step"],
          ["a2", "action", "How long it stands or moves", "TrainRegistry.step"],
          ["d3", "decision", "Standing 1.5 s beside a free platform track?"],
          ["a3", "action", "It has arrived: the dock serves it", "TrainRegistry._matchDock"],
          ["d4", "decision", "At a platform and moving again?"],
          ["a4", "action", "It departs", "TrainRegistry.step"],
          ["e", "end"],
        ],
        edges: [["s", "m1"], ["m1", "d1"], ["d1", "d2", "yes"], ["d1", "e", "no"], ["d2", "a1", "yes"], ["d2", "a2", "no"], ["a1", "m1"], ["a2", "d3"], ["d3", "a3", "yes"], ["d3", "d4", "no"], ["a3", "m1"], ["d4", "a4", "yes"], ["d4", "m1", "no"], ["a4", "m1"]],
      },
    ],
    parameters: [
      { key: "?feed=", default: "ws://localhost:8765/feed", meaning: "Address of the bridge (Settings → Control system)." },
      { key: "?mock=1", default: "off", meaning: "The simulated control system." },
    ],
    events: {
      emits: [
        { name: "feed.trains", payload: "trains", when: "a message with trains was applied" },
        { name: "feed.status", payload: "status, error, url", when: "the connection changes" },
      ],
    },
    rules: ["Speed estimated against a position at least 0.25 s old; silent for 3 s counts as standing.", "A dock: the train's track, or 0–6 m beside the platform's edge within its length ± 5 m, and the dock empty.", "The trains are stepped in real time, also while the simulation is paused."],
  },
  {
    id: "bridge", group: "control", title: "The bridge (arail-bridge, Python)",
    summary: "Adapters read train positions from a control system (or a simulator, a recording, TCP JSON); the server checks them against the protocol and sends them to every app over WebSocket.",
    files: ["tools/arail_tools/bridge/__init__.py", "tools/arail_tools/bridge/__main__.py", "tools/arail_tools/bridge/protocol.py", "tools/arail_tools/bridge/server.py", "tools/arail_tools/bridge/adapters/__init__.py", "tools/arail_tools/bridge/adapters/base.py", "tools/arail_tools/bridge/adapters/replay.py", "tools/arail_tools/bridge/adapters/simulator.py", "tools/arail_tools/bridge/adapters/tcp_json.py", "tools/arail_tools/bridge/adapters/template.py"],
    classes: [
      { name: "BridgeServer", file: "tools/arail_tools/bridge/server.py", kind: "class", role: "aiohttp app: /feed (WebSocket), /health, the app's files.", attributes: ["adapter: Adapter", "clients: set", "last_trains: dict | None — sent to new clients"], operations: ["publish(message)", "_run_adapter()", "feed(request)", "health(request)", "app()"] },
      { name: "Adapter", file: "tools/arail_tools/bridge/adapters/base.py", kind: "class", extends: "abc.ABC", stereotype: "abstract", role: "A source of messages.", attributes: ["name: str", "args: Namespace"], operations: ["add_arguments(parser)", "source() — property", "run(publish) — abstract"] },
      { name: "SimulatorAdapter", file: "tools/arail_tools/bridge/adapters/simulator.py", kind: "class", extends: "Adapter", role: "Trains along the layout's tracks.", operations: ["tick(dt)"] },
      { name: "protocol", file: "tools/arail_tools/bridge/protocol.py", kind: "module", role: "arail-feed/1.", attributes: ["PROTOCOL — \"arail-feed/1\""], operations: ["hello(source)", "trains_message(trains, full, t)", "disruption_message(action, disruption, target, params, id, duration_s)", "validate(message)"] },
    ],
    relations: [
      { from: "BridgeServer", to: "Adapter", kind: "aggregates", label: "adapter" },
      { from: "BridgeServer", to: "protocol", kind: "depends" },
    ],
    activities: [{
      id: "life", name: "The bridge running",
      nodes: [
        ["s", "start"],
        ["a1", "action", "Arguments; the adapter; the server", "main"],
        ["fk", "fork"],
        ["a2", "action", "The adapter produces a message", "BridgeServer._run_adapter"],
        ["a3", "action", "Check it; keep the last full list of trains; record it", "BridgeServer.publish"],
        ["a4", "action", "Send it to every client (drop the failed ones)", "BridgeServer.publish"],
        ["d1", "decision", "The adapter?"],
        ["a5", "action", "Wait 3 s and start it again", "BridgeServer._run_adapter"],
        ["f1", "flowfinal"],
        ["a6", "action", "A client connects: origin checked, hello and the last trains sent", "BridgeServer.feed"],
        ["f2", "flowfinal"],
      ],
      edges: [["s", "a1"], ["a1", "fk"], ["fk", "a2"], ["fk", "a6", "each connection"], ["a2", "a3"], ["a3", "a4"], ["a4", "d1"], ["d1", "a2", "running"], ["d1", "a5", "failed"], ["d1", "f1", "finished"], ["a5", "a2"], ["a6", "f2"]],
    }],
    parameters: [
      { key: "--adapter", default: "simulator", meaning: "simulator, replay, tcp-json, or your own (template)." },
      { key: "--host, --port", default: "127.0.0.1, 8765", meaning: "Where the bridge listens." },
      { key: "--tls-cert, --tls-key, --origin, --serve, --record", default: "", meaning: "wss://, allowed origins, the app from the bridge, a recording." },
    ],
    rules: ["Only full lists of trains are kept for new clients.", "tcp-json: a list is a full message, a single train a change; reconnects 1 … 30 s."],
  },
];
