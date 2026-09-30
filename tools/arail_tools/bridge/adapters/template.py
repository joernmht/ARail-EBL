"""Template for an adapter to your own control system. Copy this file, rename the class,
register it in ``adapters/__init__.py`` and fill in :meth:`read_positions`.

Typical sources of train positions in a lab:
- the interlocking / control system's track occupancy (which train is on which section),
- a train describer or a database of the operations control centre,
- sensors on the layout (RFID/Hall sensors, axle counters) giving a section and a time.

What ARail needs per train: an ID, optionally a name, and either
- layout coordinates (x_mm, y_mm) of the train's front, or
- a track name + offset along it (matching a track object of the layout), or
- only the track name (occupancy): the train is somewhere on that track.
Plus the speed if known (0 = standing); otherwise ARail estimates it from successive positions.
"""

from __future__ import annotations

import asyncio

from .. import protocol
from .base import Adapter


class TemplateAdapter(Adapter):
    name = "template"
    description = "my control system"

    @classmethod
    def add_arguments(cls, parser):
        parser.add_argument("--template-poll", type=float, default=0.5, help="seconds between polls (template)")

    async def read_positions(self) -> list[protocol.TrainPosition]:
        """Ask the control system for the current train positions.

        Replace this with real code, e.g. an HTTP request, a database query, OPC UA,
        or parsing a serial protocol. It must not block: use asyncio libraries, or wrap
        blocking calls with ``await asyncio.to_thread(...)``.
        """
        return [
            protocol.TrainPosition(id="demo-1", name="RE 1", track="G3", speed_mm_s=0.0),
        ]

    async def run(self, publish):
        while True:
            trains = await self.read_positions()
            await publish(protocol.trains_message(trains, full=True))
            await asyncio.sleep(self.args.template_poll)
