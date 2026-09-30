"""Simulated control system: trains drive along the platforms of a layout file, stop, wait
and leave again. Use it to try the bridge and the app without a real control system.

    arail-bridge --adapter simulator --layout web/layouts/ebl-lab.json

With ``--positions track`` the trains run along the layout's track objects and are reported
as ``track`` + ``offset_mm``; by default they are reported in layout coordinates.
"""

from __future__ import annotations

import asyncio
import json
import math
import random
from dataclasses import dataclass

from .. import protocol
from .base import Adapter

CRUISE = 110.0  # mm/s model speed
ACCEL = 60.0  # mm/s^2
GAP_M = 2.2  # track centre beyond the platform edge (prototype metres)


def _resolve_point(poses: dict, p) -> tuple[float, float] | None:
    if isinstance(p, list) and len(p) >= 2:
        return float(p[0]), float(p[1])
    if isinstance(p, dict) and "marker" in p:
        m = poses.get(str(p["marker"]))
        if not m:
            return None
        th = math.radians(float(m[2]) if len(m) > 2 else 0.0)
        dx, dy = (p.get("offset") or [0, 0])[:2]
        return (m[0] + math.cos(th) * dx - math.sin(th) * dy, m[1] + math.sin(th) * dx + math.cos(th) * dy)
    return None


@dataclass
class Route:
    """A straight run past a platform edge: start point, unit direction, stop distance."""

    name: str
    start: tuple[float, float]
    direction: tuple[float, float]
    stop_at: float  # mm from the start where the train front stops
    length_mm: float
    track: str | None = None
    track_offset0: float = 0.0  # offset_mm of `start` along the track object


def routes_from_layout(layout: dict) -> list[Route]:
    """One route per platform edge that serves trains."""
    scale = float(layout.get("scale") or 87)
    poses = (layout.get("markers") or {}).get("poses") or {}
    routes = []
    for obj in layout.get("objects", []):
        if obj.get("type") != "platform":
            continue
        if isinstance(obj.get("between"), list) and len(obj["between"]) == 2:
            a = _resolve_point(poses, {"marker": obj["between"][0]})
            b = _resolve_point(poses, {"marker": obj["between"][1]})
        else:
            a, b = _resolve_point(poses, obj.get("from")), _resolve_point(poses, obj.get("to"))
        if not a or not b:
            continue
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy)
        if length < 1:
            continue
        u = (dx / length, dy / length)
        n = (-u[1], u[0])
        off, ext = float(obj.get("offset_mm") or 0), float(obj.get("extend_mm") or 0)
        a = (a[0] + n[0] * off - u[0] * ext, a[1] + n[1] * off - u[1] * ext)
        L = length + 2 * ext
        half = float(obj.get("width_mm") or 50) / 2 + GAP_M * 1000 / scale
        sides = obj.get("sides") or "both"
        for side, key in ((1, "left"), (-1, "right")):
            if sides not in ("both", key):
                continue
            direction = -side  # same convention as the web app: left edge towards the start
            centre = (a[0] + n[0] * side * half, a[1] + n[1] * side * half)
            if direction > 0:
                start = (centre[0] - u[0] * 1.2 * L, centre[1] - u[1] * 1.2 * L)
                d = u
            else:
                start = (centre[0] + u[0] * 2.2 * L, centre[1] + u[1] * 2.2 * L)
                d = (-u[0], -u[1])
            routes.append(
                Route(
                    name=f"{obj.get('name') or obj.get('id')} {key}",
                    start=start,
                    direction=d,
                    stop_at=2.17 * L,
                    length_mm=0.9 * L,
                    track=obj.get(f"track_{key}") or None,
                )
            )
    return routes


class Train:
    def __init__(self, tid: str, name: str, route: Route, rng: random.Random, dwell: float):
        self.id, self.name, self.route, self.rng, self.dwell = tid, name, route, rng, dwell
        self.phase, self.timer, self.x, self.v = "waiting", rng.uniform(0, 6), 0.0, 0.0

    def step(self, dt: float) -> None:
        r = self.route
        self.timer -= dt
        if self.phase == "waiting":
            if self.timer <= 0:
                self.phase, self.x, self.v = "approach", 0.0, CRUISE
        elif self.phase == "approach":
            remaining = r.stop_at - self.x
            self.v = min(CRUISE, math.sqrt(max(0.0, 2 * ACCEL * remaining)))
            self.x += self.v * dt
            if remaining < 1 or self.v < 2:
                self.phase, self.timer, self.v, self.x = "dwell", self.dwell, 0.0, r.stop_at
        elif self.phase == "dwell":
            if self.timer <= 0:
                self.phase = "leave"
        elif self.phase == "leave":
            self.v = min(CRUISE, self.v + ACCEL * dt)
            self.x += self.v * dt
            if self.x > r.stop_at * 2.2:
                self.phase, self.timer, self.v = "waiting", self.rng.uniform(8, 25), 0.0

    def position(self, mode: str) -> protocol.TrainPosition | None:
        if self.phase == "waiting":
            return None
        r = self.route
        x, y = r.start[0] + r.direction[0] * self.x, r.start[1] + r.direction[1] * self.x
        heading = math.degrees(math.atan2(r.direction[1], r.direction[0]))
        pos = protocol.TrainPosition(
            id=self.id, name=self.name, speed_mm_s=round(self.v, 1), length_mm=round(r.length_mm)
        )
        if mode == "track" and r.track:
            pos.track = r.track
            pos.offset_mm = None  # occupancy: the simulator does not know the track objects' offsets
        else:
            pos.x_mm, pos.y_mm, pos.heading_deg = round(x, 1), round(y, 1), round(heading, 2)
        return pos


class SimulatorAdapter(Adapter):
    name = "simulator"
    description = "simulated control system"

    @classmethod
    def add_arguments(cls, parser):
        parser.add_argument("--layout", default="web/layouts/ebl-lab.json", help="layout file (simulator)")
        parser.add_argument("--rate", type=float, default=4.0, help="position reports per second (simulator)")
        parser.add_argument(
            "--dwell", type=float, default=18.0, help="seconds a train stands at a platform (simulator)"
        )
        parser.add_argument(
            "--positions",
            choices=["xy", "track"],
            default="xy",
            help="report layout coordinates, or only track occupancy (simulator)",
        )
        parser.add_argument("--seed", type=int, default=1)

    def __init__(self, args):
        super().__init__(args)
        with open(args.layout, encoding="utf-8") as f:
            self.layout = json.load(f)
        rng = random.Random(args.seed)
        self.trains = [
            Train(f"sim-{i + 1}", f"Sim {i + 1}", r, rng, args.dwell)
            for i, r in enumerate(routes_from_layout(self.layout))
        ]
        if not self.trains:
            raise SystemExit(f"{args.layout}: no platforms whose position is known (markers.poses)")

    @property
    def source(self) -> str:
        return f"simulated control system ({self.layout.get('name', 'layout')})"

    def tick(self, dt: float) -> dict:
        for t in self.trains:
            t.step(dt)
        positions = [p for p in (t.position(self.args.positions) for t in self.trains) if p]
        return protocol.trains_message(positions, full=True)

    async def run(self, publish):
        dt = 1.0 / max(0.5, self.args.rate)
        while True:
            await publish(self.tick(dt))
            await asyncio.sleep(dt)
