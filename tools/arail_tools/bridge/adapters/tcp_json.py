"""Generic adapter: read JSON lines from a TCP server (for example a small gateway next to
the interlocking/control system). Each line is either a complete protocol message, a list
of trains, or a single train object; missing fields are filled in.

    arail-bridge --adapter tcp-json --connect 192.168.1.20:5005

Reconnects automatically. Use it as it is when the control system (or a script next to it)
can emit JSON lines, or copy it as a starting point for your own adapter.
"""

from __future__ import annotations

import asyncio
import json
import logging

from .. import protocol
from .base import Adapter

log = logging.getLogger(__name__)


def to_message(obj) -> dict:
    """Turn a received JSON value into a protocol message."""
    if isinstance(obj, list):
        return protocol.trains_message(obj, full=True)
    if isinstance(obj, dict) and "type" not in obj and "id" in obj:
        return protocol.trains_message([obj], full=False)
    return protocol.validate(obj)


class TcpJsonAdapter(Adapter):
    name = "tcp-json"
    description = "control system (JSON over TCP)"

    @classmethod
    def add_arguments(cls, parser):
        parser.add_argument("--connect", help="host:port of the JSON-lines server (tcp-json)")

    def __init__(self, args):
        super().__init__(args)
        if not args.connect or ":" not in args.connect:
            raise SystemExit("--connect host:port is required for the tcp-json adapter")
        host, port = args.connect.rsplit(":", 1)
        self.host, self.port = host, int(port)

    @property
    def source(self) -> str:
        return f"control system at {self.host}:{self.port}"

    async def run(self, publish):
        delay = 1.0
        while True:
            try:
                reader, writer = await asyncio.open_connection(self.host, self.port)
                log.info("connected to %s:%s", self.host, self.port)
                delay = 1.0
                while line := await reader.readline():
                    text = line.decode("utf-8", "replace").strip()
                    if not text:
                        continue
                    try:
                        await publish(to_message(json.loads(text)))
                    except (json.JSONDecodeError, protocol.ProtocolError) as exc:
                        log.warning("ignored line (%s): %s", exc, text[:200])
                writer.close()
                log.warning("connection closed by %s:%s", self.host, self.port)
            except OSError as exc:
                log.warning("cannot connect to %s:%s (%s); retrying in %.0f s", self.host, self.port, exc, delay)
            await asyncio.sleep(delay)
            delay = min(30.0, delay * 2)
