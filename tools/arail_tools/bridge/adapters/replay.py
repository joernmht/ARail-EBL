"""Replay a recorded feed: a JSON-lines file with one message per line.

Each line is a protocol message, optionally with ``"t"`` (seconds since the start of the
recording). Without ``t``, lines are sent ``--interval`` seconds apart.

    arail-bridge --adapter replay --file examples/feeds/sample-trains.jsonl --loop
"""

from __future__ import annotations

import asyncio
import json

from .. import protocol
from .base import Adapter


def read_messages(path: str) -> list[tuple[float | None, dict]]:
    out = []
    with open(path, encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError as exc:
                raise SystemExit(f"{path}:{n}: invalid JSON ({exc})") from exc
            t = msg.pop("t", None)
            try:
                protocol.validate(msg)
            except protocol.ProtocolError as exc:
                raise SystemExit(f"{path}:{n}: {exc}") from exc
            out.append((None if t is None else float(t), msg))
    return out


class ReplayAdapter(Adapter):
    name = "replay"
    description = "recorded feed"

    @classmethod
    def add_arguments(cls, parser):
        parser.add_argument("--file", help="JSON-lines file to replay (replay)")
        parser.add_argument("--interval", type=float, default=0.25, help="seconds between lines without 't' (replay)")
        parser.add_argument("--loop", action="store_true", help="start again at the end (replay)")
        parser.add_argument("--speed", type=float, default=1.0, help="replay speed factor (replay)")

    def __init__(self, args):
        super().__init__(args)
        if not args.file:
            raise SystemExit("--file is required for the replay adapter")
        self.messages = read_messages(args.file)
        if not self.messages:
            raise SystemExit(f"{args.file}: no messages")

    @property
    def source(self) -> str:
        return f"recorded feed ({self.args.file})"

    async def run(self, publish):
        while True:
            last = 0.0
            for t, msg in self.messages:
                wait = self.args.interval if t is None else max(0.0, t - last)
                if t is not None:
                    last = t
                await asyncio.sleep(wait / max(self.args.speed, 1e-3))
                await publish(msg)
            if not self.args.loop:
                return
