# Control-system interface

Without a control system, ARail runs its own timetable: virtual trains drive in and out of the platforms. With a control system connected, the **real model trains** drive the simulation: when a train stops at a platform, the virtual passengers alight and board it, and when it leaves, the ones who did not make it are annoyed.

```
control system ──(its own protocol)──> adapter ─┐
                                                ├─ arail-bridge ──WebSocket (arail-feed/1)──> ARail app(s)
          recorded feed / simulator ────────────┘
```

The **bridge** (`tools/arail_tools/bridge`, Python) runs next to the control system. An **adapter** inside it reads train positions from the control system; the bridge sends them as JSON messages to every connected app. Only train positions (and optionally disruptions) flow, and only from the control system to the apps: the bridge never sends commands to the control system.

## Quick start

```bash
pip install -e "tools[bridge]"
arail-bridge --adapter simulator --layout web/layouts/ebl-lab.json
```

Open the app on the same PC, go to the **Control** panel and press **Connect** (address `ws://localhost:8765/feed`). The app switches the platforms to the feed; simulated trains drive along the platform tracks and stop. Without Python, **Simulated control system** in the same panel runs an equivalent simulator inside the browser.

To try the flow with recorded data: `arail-bridge --adapter replay --file examples/feeds/sample-trains.jsonl --loop`.

## Feed protocol `arail-feed/1`

Every WebSocket text message is one JSON object with a `type`.

### `hello`

Sent by the bridge when an app connects:

```json
{ "type": "hello", "protocol": "arail-feed/1", "source": "EBL control system" }
```

### `trains`

The current positions of the trains:

```json
{
  "type": "trains",
  "time": 1759226400.5,
  "full": true,
  "trains": [
    { "id": "4711", "name": "RE 3", "x_mm": 512.0, "y_mm": 18.5, "heading_deg": 1.5, "speed_mm_s": 0, "length_mm": 240 },
    { "id": "4712", "name": "S 2", "track": "G1", "offset_mm": 350.0, "speed_mm_s": 42.0 },
    { "id": "4713", "name": "RB 5", "track": "G3" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | unique train ID (string or number), required |
| `name` | shown in the app (e.g. the line or train number) |
| `x_mm`, `y_mm` | position of the train's **front** in layout coordinates |
| `heading_deg` | direction of travel, counter-clockwise from the layout x axis |
| `track`, `offset_mm` | alternatively: position along a `track` object whose `track_id` matches, in mm from its first point (plus `offset_start_mm`) |
| `track` alone | occupancy only: the train is somewhere on this track |
| `speed_mm_s` | model speed; `0` = standing. If missing, ARail estimates the speed from successive positions; a train whose position has not been updated for 3 s counts as standing (for systems that only report changes). |
| `length_mm` | for drawing the train outline |
| `direction` | `+1` if the train moves towards increasing offsets, `-1` otherwise |

`full: true` means the list is complete: trains that are not in it are removed. With `full: false` (or `{"type": "train", ...}` for a single train) only the listed trains are updated. Send updates a few times per second.

### `remove`

```json
{ "type": "remove", "ids": ["4711"] }
```

### `disruption`

Start or stop a [disruption](disruptions-and-scenarios.md):

```json
{ "type": "disruption", "action": "start", "disruption": "delay", "target": "platform-1", "params": { "minutes": 5 }, "id": "d1" }
{ "type": "disruption", "action": "stop", "id": "d1" }
```

`duration_s` (simulated seconds) overrides the disruption type's duration; `null` keeps the disruption running until it is stopped.

## How arrivals are detected

The app decides from the positions when a train stands at a platform:

1. A train counts as **standing** when its speed stays below 3 mm/s (model) for 1.5 s.
2. It is **at a platform track** if
   - its `track` matches the platform's `track_left`/`track_right` (occupancy messages), or
   - its position lies next to the platform edge: at most 6 m (prototype) beyond the edge, and within the platform's length plus 5 m.
3. The train then becomes the vehicle at that platform track: its doors open for the passengers. When it moves again (for 0.5 s), it departs.

While a feed is active (messages within the last 15 s), all platform tracks are controlled by it and the built-in timetable only serves bus bays. If the feed stops, the timetable takes over again.

In the Control panel you can choose how real trains are drawn: as an **outline** at their reported position (default), as a **virtual train** at the platform, or not at all.

## Mapping the control system to the layout

- **Track names**: enter the control system's names of the platform tracks as `track_left`/`track_right` of each platform (Build panel or layout file). The example layout uses the labels G1–G3 found on the EBL table.
- **Positions along tracks**: if your system knows where a train is along a track, draw a `track` object along the centre of that track (Build → Track, tap along it) and set its `track_id`. Offsets are measured in mm from its first point; use `offset_start_mm` if the control system's zero is elsewhere.
- **Layout coordinates**: if your system already knows x/y positions (e.g. from a camera or a positioning system), convert them to the layout frame (origin marker, mm) and send `x_mm`/`y_mm`.

## The bridge

```bash
arail-bridge --help
arail-bridge --adapter simulator --layout web/layouts/ebl-lab.json          # simulated trains
arail-bridge --adapter replay --file examples/feeds/sample-trains.jsonl --loop
arail-bridge --adapter tcp-json --connect 192.168.1.20:5005 --host 0.0.0.0  # JSON lines from a gateway
arail-bridge ... --record session.jsonl                                     # record for later replay
```

| Option | Meaning |
| --- | --- |
| `--host`, `--port` | where to listen (default `127.0.0.1:8765`; `0.0.0.0` for the lab network) |
| `--serve web` | also serve the app, so phones can open it from the bridge |
| `--tls-cert`, `--tls-key` | serve https/wss |
| `--origin URL` | only accept apps from these web origins (repeatable) |
| `--record FILE` | append every message to a JSON-lines file (replayable) |

Endpoints: `/feed` (WebSocket), `/health` (status as JSON), and the app under `/` with `--serve`.

### https, phones and the lab network

Browsers restrict connections from secure pages:

| App opened from | Bridge on the same PC | Bridge elsewhere in the network |
| --- | --- | --- |
| GitHub Pages (https) | `ws://localhost:8765/feed` works | needs `wss://` (bridge with TLS) |
| the bridge (`--serve web`) over http | works | works, but phones get no live camera over plain http |
| the bridge over https (`--serve web --tls-cert ... --tls-key ...`) | works | works, camera included |

For phones and tablets in the lab, the last row is the practical choice: create a certificate for the bridge PC (for example with [mkcert](https://github.com/FiloSottile/mkcert), whose root certificate you install on the devices, or from your institution's IT), start the bridge with `--serve web --tls-cert cert.pem --tls-key key.pem --host 0.0.0.0`, and open `https://<bridge-pc>:8765/app/?feed=wss://<bridge-pc>:8765/feed` on the phone.

## Writing an adapter

An adapter is a small Python class. Start from [`adapters/template.py`](../tools/arail_tools/bridge/adapters/template.py):

```python
from arail_tools.bridge import protocol
from arail_tools.bridge.adapters.base import Adapter

class MyInterlockingAdapter(Adapter):
    name = "my-interlocking"
    description = "EBL interlocking"

    @classmethod
    def add_arguments(cls, parser):
        parser.add_argument("--my-host", default="10.0.0.5")

    async def run(self, publish):
        while True:
            occupied = await read_occupancy(self.args.my_host)      # your code
            trains = [protocol.TrainPosition(id=t.number, name=t.line, track=t.track, speed_mm_s=t.speed)
                      for t in occupied]
            await publish(protocol.trains_message(trains, full=True))
            await asyncio.sleep(0.5)
```

Register it in `adapters/__init__.py` (`ADAPTERS`), then run `arail-bridge --adapter my-interlocking`. Guidelines:

- Never block the event loop: use asyncio libraries, or `await asyncio.to_thread(blocking_call)`.
- Publish complete lists (`full=True`) regularly, even if nothing changed, so apps that connect later get the state and the feed stays "active".
- Keep the adapter read-only towards the control system.
- If the control system already speaks JSON lines over TCP, the `tcp-json` adapter may be enough: it accepts complete messages, lists of trains, or single train objects per line.

Test the adapter without the app with `--record`, and add a unit test in `tests/python/` (see `test_bridge.py`).

## Security notes

- The bridge listens on localhost by default. When you open it to the network, restrict origins with `--origin`, and prefer TLS.
- The feed carries train positions of a model railway; it does not need authentication in a lab network, but it should not be exposed to the internet.
- Report security problems as described in [SECURITY.md](../SECURITY.md).
