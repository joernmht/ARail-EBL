"""Control-system bridge: protocol, adapters and the WebSocket server end to end."""

import argparse
import asyncio
import json
import os
import socket

import pytest

from arail_tools.bridge import protocol
from arail_tools.bridge.adapters import ADAPTERS
from arail_tools.bridge.adapters.replay import read_messages
from arail_tools.bridge.adapters.simulator import SimulatorAdapter, routes_from_layout
from arail_tools.bridge.adapters.tcp_json import to_message

from .conftest import ROOT

LAYOUT = os.path.join(ROOT, "web", "layouts", "ebl-lab.json")
SAMPLE = os.path.join(ROOT, "examples", "feeds", "sample-trains.jsonl")


def sim_args(**kw):
    base = dict(layout=LAYOUT, rate=4.0, dwell=10.0, positions="xy", seed=1)
    base.update(kw)
    return argparse.Namespace(**base)


def test_protocol_messages_validate():
    msg = protocol.trains_message([protocol.TrainPosition(id="1", name="RE 1", x_mm=10.0, y_mm=2.5, speed_mm_s=0.0)])
    assert protocol.validate(json.dumps(msg))["trains"][0] == {
        "id": "1",
        "name": "RE 1",
        "x_mm": 10.0,
        "y_mm": 2.5,
        "speed_mm_s": 0.0,
    }
    assert protocol.validate(protocol.hello("x"))["protocol"] == "arail-feed/1"
    assert protocol.validate(protocol.disruption_message("start", disruption="delay", target="platform-1"))
    for bad in (
        '{"trains": []}',
        '{"type": "trains"}',
        '{"type": "trains", "trains": [{"name": "x"}]}',
        '{"type": "trains", "trains": [{"id": 1, "x_mm": 5}]}',
        '{"type": "trains", "trains": [{"id": 1, "speed_mm_s": "fast"}]}',
        '{"type": "disruption", "action": "pause"}',
        "not json",
    ):
        with pytest.raises(protocol.ProtocolError):
            protocol.validate(bad)


def test_simulator_routes_follow_the_platforms():
    with open(LAYOUT) as f:
        layout = json.load(f)
    routes = routes_from_layout(layout)
    assert len(routes) == 4  # two platforms, both sides
    assert {r.track for r in routes} == {"G1", "G2", "G3", None}


def test_simulator_trains_stop_at_platforms():
    sim = SimulatorAdapter(sim_args())
    standing = set()
    for _ in range(4 * 90):
        msg = sim.tick(0.25)
        protocol.validate(msg)
        standing |= {t["id"] for t in msg["trains"] if t["speed_mm_s"] == 0}
    assert len(standing) == 4, "every train stood at its platform once"
    occupancy = SimulatorAdapter(sim_args(positions="track"))
    msgs = [occupancy.tick(0.25) for _ in range(200)]
    tracks = {t.get("track") for m in msgs for t in m["trains"]}
    assert {"G1", "G2", "G3"} <= tracks


def test_replay_file_is_valid():
    messages = read_messages(SAMPLE)
    assert len(messages) > 100
    assert messages[0][1]["type"] == "hello"
    assert any(m["type"] == "trains" and m["trains"] for _, m in messages)


def test_tcp_json_accepts_lists_and_single_trains():
    assert to_message([{"id": "a", "track": "G1"}])["full"] is True
    single = to_message({"id": "a", "x_mm": 1, "y_mm": 2})
    assert single["type"] == "trains" and single["full"] is False
    assert to_message({"type": "remove", "ids": ["a"]})["type"] == "remove"


def test_protocol_rejects_unknown_types_and_bad_train_lists():
    with pytest.raises(protocol.ProtocolError):
        protocol.validate({"type": "ICE", "id": "a"})
    # a single train may carry its own "type" field
    msg = to_message({"id": "a", "type": "ICE", "x_mm": 1, "y_mm": 2})
    assert msg["type"] == "trains" and msg["trains"][0]["type"] == "ICE"
    for bad in (["a", "b"], [1, 2], [{"name": "no id"}]):
        with pytest.raises(protocol.ProtocolError):
            to_message(bad)


def test_all_adapters_have_names_and_options():
    parser = argparse.ArgumentParser()
    for name, cls in ADAPTERS.items():
        assert cls.name == name
        cls.add_arguments(parser)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_server_end_to_end(tmp_path):
    aiohttp = pytest.importorskip("aiohttp")
    from aiohttp import web

    from arail_tools.bridge.server import BridgeServer

    async def scenario():
        record = tmp_path / "rec.jsonl"
        server = BridgeServer(
            SimulatorAdapter(sim_args(rate=20.0)), static_dir=os.path.join(ROOT, "web"), record=str(record)
        )
        runner = web.AppRunner(server.app())
        await runner.setup()
        port = free_port()
        await web.TCPSite(runner, "127.0.0.1", port).start()
        try:
            async with aiohttp.ClientSession() as session:
                async with session.ws_connect(f"http://127.0.0.1:{port}/feed") as ws:
                    first = json.loads((await ws.receive(timeout=5)).data)
                    assert first["type"] == "hello" and first["protocol"] == "arail-feed/1"
                    seen = []
                    for _ in range(40):
                        m = json.loads((await ws.receive(timeout=5)).data)
                        seen.append(m)
                    assert all(m["type"] == "trains" for m in seen)
                    assert any(m["trains"] for m in seen)
                async with session.get(f"http://127.0.0.1:{port}/health") as r:
                    health = await r.json()
                    assert health["ok"] and health["adapter"] == "simulator" and health["messages"] > 0
                async with session.get(f"http://127.0.0.1:{port}/app/") as r:
                    assert r.status == 200 and "ARail" in await r.text()
                async with session.get(f"http://127.0.0.1:{port}/arail/index.js") as r:
                    assert r.headers["Content-Type"].startswith("text/javascript")
                async with session.get(f"http://127.0.0.1:{port}/../README.md") as r:
                    assert r.status in (403, 404)
        finally:
            await runner.cleanup()
        lines = record.read_text().splitlines()
        assert lines and json.loads(lines[0])["type"] == "trains"

    asyncio.run(scenario())


def test_server_rejects_nan_redirects_safely_and_stops_quickly():
    aiohttp = pytest.importorskip("aiohttp")
    import time

    from aiohttp import web
    from yarl import URL

    from arail_tools.bridge.server import BridgeServer

    web_dir = os.path.join(ROOT, "web")

    async def scenario():
        server = BridgeServer(SimulatorAdapter(sim_args()), static_dir=web_dir)
        with pytest.raises(protocol.ProtocolError):
            await server.publish({"type": "trains", "trains": [{"id": "a", "note": float("nan")}]})
        runner = web.AppRunner(server.app())
        await runner.setup()
        port = free_port()
        await web.TCPSite(runner, "127.0.0.1", port).start()
        async with aiohttp.ClientSession() as session:
            # a directory without the trailing slash: the redirect stays on this server
            evil = f"http://127.0.0.1:{port}//evil.example/..%2F..%2F{web_dir.lstrip('/')}/app"
            async with session.get(URL(evil, encoded=True), allow_redirects=False) as r:
                assert r.status == 302 and r.headers["Location"] == "/app/"
            async with session.ws_connect(f"http://127.0.0.1:{port}/feed") as ws:

                async def read_until_closed():  # like the app: read all the time
                    while (msg := await ws.receive()).type == aiohttp.WSMsgType.TEXT:
                        pass
                    return msg

                reader = asyncio.create_task(read_until_closed())
                t0 = time.monotonic()
                await asyncio.wait_for(runner.cleanup(), timeout=20)
                assert time.monotonic() - t0 < 5, "connected apps do not delay stopping the bridge"
                msg = await asyncio.wait_for(reader, timeout=5)
                assert msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSING, aiohttp.WSMsgType.CLOSED)
                assert ws.close_code == 1001  # going away

    asyncio.run(scenario())
