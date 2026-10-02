# Disruptions and scenarios

Disruptions change how vehicles run and how passengers behave. Start them in the **Disruptions** panel, from a scenario, from the control system, or in code (`world.disruptions.start(...)`). Durations are in simulated minutes: at 2× speed (the default), a 10-minute delay lasts 5 real minutes.

## Built-in disruptions

| Type | Label | Target | What happens |
| --- | --- | --- | --- |
| `delay` | Delay | any stop | Vehicles are held back. Waiting passengers get annoyed faster. When the delay ends, the next vehicle comes within a few seconds, and its passengers alight in a bad mood. |
| `cancellation` | Cancellations | any stop | Scheduled vehicles do not run (the board shows the cancellations); moods drop. |
| `closure` | Closure | any stop | Nobody enters, waiting passengers leave, vehicles do not stop. The area is hatched red. |
| `replacement-bus` | Rail replacement bus | platform | Trains at the platform are cancelled, passengers leave; at the chosen bus terminal buses run 2.5× as often with more passengers. |
| `crowd` | Crowd surge | any stop | Passenger demand multiplied (default 4×), e.g. after a football match. |
| `signal-failure` | Signal failure | platforms (all by default) | Trains are held; strong mood penalty. |

"Any stop" means platforms, bus terminals and bus stops. Without a target (`"*"`), a disruption applies to all stops it can target. Every active disruption shows a flashing warning sign over the affected stops, and its message replaces the next departures on their boards.

At the stops of [bus lines](streets-and-buses.md), a *closure* makes the buses pass the stop, a *delay* holds them at the stop, and *cancellations* cancel departures from a terminus; while departures are suspended, a bus laying over at the terminus makes room by going to the depot.

## Effects

Each disruption type translates into a small set of *effects* per stop area; the effects of all active disruptions are combined:

| Effect | Type | Meaning |
| --- | --- | --- |
| `closed` | yes/no | no passengers enter, no vehicles stop |
| `hold` | yes/no | vehicles are held (they come soon after the hold ends) |
| `cancel` | yes/no | scheduled vehicles are cancelled |
| `leave` | yes/no | waiting passengers give up and leave |
| `demand` | factor | passenger arrival rate (factors multiply) |
| `frequency` | factor | vehicle frequency, > 1 = more often |
| `mood` | per second | extra change of passenger mood while waiting (negative = worse) |
| `messages` | text | shown on the stop's sign and on the board |

The services (trains and buses) and the passenger simulation only look at these effects, not at disruption types. New disruption types therefore work with every simulation, and new simulations react to every disruption type. How to add a type: [Extending ARail](extending.md#disruption-types).

## Scenarios

A scenario is a timeline stored in the layout file. It is played from the Disruptions panel or with `?scenario=<id>` in the app URL.

```json
{
  "id": "signal-failure",
  "name": "Rush hour with a signal failure",
  "description": "Many commuters; a signal failure holds all trains, then platform 2 is served by replacement buses.",
  "steps": [
    { "at": 0, "set": { "demand": 1.5 }, "message": "Rush hour: many commuters are on their way." },
    { "at": 30, "start": { "id": "sf", "type": "signal-failure", "target": "*", "params": { "minutes": 3 } } },
    { "at": 210, "start": { "id": "rb", "type": "replacement-bus", "target": "platform-2",
                            "params": { "bus_terminal": "bus-terminal-1", "minutes": 5 } } },
    { "at": 510, "set": { "demand": 1 }, "message": "Services are back to normal." }
  ]
}
```

`at` is simulated seconds after the start. A step can contain several actions:

| Action | Example | Effect |
| --- | --- | --- |
| `set` | `{"demand": 1.5, "speed": 5}` | passenger demand and time-lapse speed |
| `message` | `"Signal failure!"` | shown in the app (event `scenario.message`) |
| `call` | `"platform-1"` | send a vehicle to an object, stop area or dock (e.g. `"platform-1:left"`) |
| `start` | `{"id": "sf", "type": "delay", "target": "platform-1", "params": {"minutes": 5}, "duration": 300}` | start a disruption; `duration` in seconds overrides the default |
| `stop` | `"sf"` | stop a disruption by its `id` |
| `emit` | `{"name": "myplugin.event", "payload": {}}` | a custom event for plugins; `terminal.request.*` events drive the container terminal (below) |

The example layout contains three scenarios: a signal failure at rush hour, a crowd after a football match with extra trains, and a platform closure. They are meant as starting points for exercises in teaching: for example, let students decide which disruption to start, and watch the effect on passengers.

### Scenarios for the container terminal

The [container terminal](container-terminal.md) listens to `emit` steps named `terminal.request.*`. The scenario *Morning shift* of the [terminal example](../web/layouts/container-terminal.json) calls a train, sends trucks and moves containers:

```json
{
  "id": "morning-shift",
  "name": "Morning shift",
  "description": "KT 52 arrives on loading track 2; trucks collect and deliver; the crane works train, barge and yard.",
  "steps": [
    { "at": 0, "set": { "speed": 10 } },
    { "at": 0, "message": "Morning shift: KT 52 is due on loading track 2." },
    { "at": 0, "emit": { "name": "terminal.request.call", "payload": { "visit": "KT52" } } },
    { "at": 5, "emit": { "name": "terminal.request.truck", "payload": { "purpose": "pickup" } } },
    { "at": 6, "emit": { "name": "terminal.request.move", "payload": { "container": "ARLU 100002 4", "to": { "kind": "truck" } } } },
    { "at": 8, "emit": { "name": "terminal.request.move", "payload": { "container": "ARLU 100001 9", "to": { "carrier": "yard-a" } } } },
    { "at": 10, "emit": { "name": "terminal.request.move", "payload": { "container": "EBLU 300003 2", "to": { "carrier": "KT52/1" } } } },
    { "at": 12, "emit": { "name": "terminal.request.truck", "payload": { "purpose": "delivery", "size": "40" } } },
    { "at": 400, "message": "The delivery truck's container can go to KT 52 or to the yard: choose it in the Terminal panel." }
  ]
}
```

A move to a train that is still approaching waits until it has arrived. A request the terminal refuses appears as a message, e.g. *Terminal: KT 52 Duisburg is already here*. All requests and their payloads: [Container terminal](container-terminal.md#scenario-requests).

## From the control system

A control system can start and stop disruptions through the bridge, e.g. when a real signal fails in the lab:

```json
{ "type": "disruption", "action": "start", "disruption": "signal-failure", "target": "*", "id": "sf1", "duration_s": 300 }
{ "type": "disruption", "action": "stop", "id": "sf1" }
```

See [Control-system interface](control-system-interface.md).
