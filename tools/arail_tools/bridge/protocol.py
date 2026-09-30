"""ARail feed protocol (``arail-feed/1``): JSON messages from the bridge to the web app.

Messages (one JSON object per WebSocket text message):

    {"type": "hello", "protocol": "arail-feed/1", "source": "EBL control system"}
    {"type": "trains", "time": 1759226400.5, "full": true, "trains": [<train>, ...]}
    {"type": "remove", "ids": ["4711"]}
    {"type": "disruption", "action": "start", "disruption": "signal-failure", "target": "*",
     "params": {"minutes": 5}, "id": "sf1"}
    {"type": "disruption", "action": "stop", "id": "sf1"}

A <train> has an ``id`` and one of three kinds of position:

    {"id": "4711", "name": "RE 3", "x_mm": 512.0, "y_mm": 18.5, "heading_deg": 1.5}   # layout coordinates
    {"id": "4711", "name": "RE 3", "track": "G3", "offset_mm": 350.0}                  # along a track object
    {"id": "4711", "name": "RE 3", "track": "G3"}                                       # occupancy only

plus optional ``speed_mm_s`` (model speed; 0 = standing), ``length_mm`` and ``direction``
(+1 = towards increasing offset). ``full: true`` means the list is complete: trains missing
from it are removed. See docs/control-system-interface.md.
"""

from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field
from typing import Any

PROTOCOL = "arail-feed/1"
MESSAGE_TYPES = ("hello", "trains", "train", "remove", "disruption")


@dataclass
class TrainPosition:
    """Position report of one train. Give (x_mm, y_mm), or track (+ offset_mm)."""

    id: str
    name: str | None = None
    x_mm: float | None = None
    y_mm: float | None = None
    heading_deg: float | None = None
    track: str | None = None
    offset_mm: float | None = None
    speed_mm_s: float | None = None
    length_mm: float | None = None
    direction: int | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"id": str(self.id)}
        for key in (
            "name",
            "x_mm",
            "y_mm",
            "heading_deg",
            "track",
            "offset_mm",
            "speed_mm_s",
            "length_mm",
            "direction",
        ):
            v = getattr(self, key)
            if v is None:
                continue
            d[key] = round(v, 2) if isinstance(v, float) else v
        d.update(self.extra)
        return d


def hello(source: str) -> dict[str, Any]:
    return {"type": "hello", "protocol": PROTOCOL, "source": source}


def trains_message(trains: list[TrainPosition | dict], full: bool = True, t: float | None = None) -> dict[str, Any]:
    items = [tr.to_dict() if isinstance(tr, TrainPosition) else dict(tr) for tr in trains]
    return {"type": "trains", "time": round(time.time() if t is None else t, 3), "full": full, "trains": items}


def disruption_message(
    action: str,
    *,
    disruption: str | None = None,
    target: str = "*",
    params: dict | None = None,
    id: str | None = None,
    duration_s: float | None = None,
) -> dict[str, Any]:
    msg: dict[str, Any] = {"type": "disruption", "action": action}
    if disruption:
        msg["disruption"] = disruption
    if action == "start":
        msg["target"] = target
        msg["params"] = params or {}
    if id:
        msg["id"] = id
    if duration_s is not None:
        msg["duration_s"] = duration_s
    return msg


class ProtocolError(ValueError):
    pass


def _num(v):
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError) as exc:
        raise ProtocolError(f"not a number: {v!r}") from exc
    if not math.isfinite(f):
        raise ProtocolError(f"not a finite number: {v!r}")
    return f


def _check_train(tr) -> None:
    if not isinstance(tr, dict) or isinstance(tr.get("id"), bool) or not isinstance(tr.get("id"), (str, int)):
        raise ProtocolError("every train must be an object with an 'id'")
    for key in ("x_mm", "y_mm", "heading_deg", "offset_mm", "speed_mm_s", "length_mm", "direction"):
        _num(tr.get(key))
    if (tr.get("x_mm") is None) != (tr.get("y_mm") is None):
        raise ProtocolError(f"train {tr['id']}: give both x_mm and y_mm")


def validate(message: dict | str) -> dict[str, Any]:
    """Check a message (dict or JSON text) and return it as a dict; raises ProtocolError."""
    if isinstance(message, str):
        try:
            message = json.loads(message)
        except json.JSONDecodeError as exc:
            raise ProtocolError(f"invalid JSON: {exc}") from exc
    if not isinstance(message, dict) or not isinstance(message.get("type"), str):
        raise ProtocolError("a message must be an object with a string 'type'")
    t = message["type"]
    if t not in MESSAGE_TYPES:
        raise ProtocolError(f"unknown message type {t!r} (expected one of {', '.join(MESSAGE_TYPES)})")
    if t == "trains":
        trains = message.get("trains")
        if not isinstance(trains, list):
            raise ProtocolError("'trains' message needs a 'trains' list")
        for tr in trains:
            _check_train(tr)
    elif t == "train":
        _check_train(message.get("train", message))
    elif t == "remove":
        if not isinstance(message.get("ids"), list):
            raise ProtocolError("'remove' message needs an 'ids' list")
    elif t == "disruption":
        if message.get("action") not in ("start", "stop"):
            raise ProtocolError("'disruption' message needs action 'start' or 'stop'")
        if message["action"] == "start" and not message.get("disruption"):
            raise ProtocolError("starting a disruption needs its type in 'disruption'")
    return message
