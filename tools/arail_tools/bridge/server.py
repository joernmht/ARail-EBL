"""WebSocket server of the bridge (aiohttp).

Routes:
- ``/feed``   WebSocket; sends ``hello``, the latest ``trains`` message, then every new message
- ``/health`` JSON status
- ``/...``    the web app, if started with ``--serve web`` (so phones can use it over https)
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path

from aiohttp import WSMsgType, web

from . import protocol
from .adapters.base import Adapter

log = logging.getLogger("arail.bridge")

MIME = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".css": "text/css",
    ".html": "text/html",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".md": "text/markdown",
}


class BridgeServer:
    def __init__(
        self,
        adapter: Adapter,
        *,
        static_dir: str | None = None,
        allowed_origins: list[str] | None = None,
        record: str | None = None,
    ):
        self.adapter = adapter
        self.static_dir = Path(static_dir).resolve() if static_dir else None
        self.allowed_origins = set(allowed_origins or [])
        self.clients: set[web.WebSocketResponse] = set()
        self.last_trains: dict | None = None
        self.messages = 0
        self.started = time.time()
        self._task: asyncio.Task | None = None
        self._record = open(record, "a", encoding="utf-8") if record else None  # noqa: SIM115 - closed on cleanup

    # ------------------------------------------------------------ publishing
    async def publish(self, message: dict) -> None:
        """Validate a message and send it to all connected apps."""
        message = protocol.validate(message)
        if message["type"] == "trains":
            if message.get("full", True):
                self.last_trains = message
        self.messages += 1
        if self._record:
            self._record.write(json.dumps({"t": round(time.time() - self.started, 3), **message}) + "\n")
            self._record.flush()
        text = json.dumps(message, separators=(",", ":"))
        clients = list(self.clients)
        results = await asyncio.gather(*(ws.send_str(text) for ws in clients), return_exceptions=True)
        for ws, r in zip(clients, results, strict=True):
            if isinstance(r, Exception):
                self.clients.discard(ws)

    async def _run_adapter(self) -> None:
        while True:
            try:
                await self.adapter.run(self.publish)
                log.info("adapter %s finished", self.adapter.name)
                return
            except asyncio.CancelledError:
                raise
            except Exception:  # keep the bridge alive, retry the adapter
                log.exception("adapter %s failed; restarting in 3 s", self.adapter.name)
                await asyncio.sleep(3)

    # ------------------------------------------------------------ handlers
    async def feed(self, request: web.Request) -> web.StreamResponse:
        origin = request.headers.get("Origin")
        if self.allowed_origins and origin not in self.allowed_origins:
            raise web.HTTPForbidden(text=f"origin {origin} not allowed")
        ws = web.WebSocketResponse(heartbeat=20)
        await ws.prepare(request)
        self.clients.add(ws)
        log.info("app connected (%s), %d connected", request.remote, len(self.clients))
        try:
            await ws.send_str(json.dumps(protocol.hello(self.adapter.source)))
            if self.last_trains:
                await ws.send_str(json.dumps(self.last_trains))
            async for msg in ws:  # apps only greet; nothing to do
                if msg.type == WSMsgType.ERROR:
                    break
        finally:
            self.clients.discard(ws)
            log.info("app disconnected, %d connected", len(self.clients))
        return ws

    async def health(self, request: web.Request) -> web.Response:
        return web.json_response(
            {
                "ok": True,
                "protocol": protocol.PROTOCOL,
                "adapter": self.adapter.name,
                "source": self.adapter.source,
                "clients": len(self.clients),
                "messages": self.messages,
                "uptime_s": round(time.time() - self.started, 1),
                "trains": len(self.last_trains["trains"]) if self.last_trains else 0,
            }
        )

    async def static(self, request: web.Request) -> web.StreamResponse:
        if not self.static_dir:
            raise web.HTTPNotFound()
        rel = request.match_info.get("path", "")
        path = (self.static_dir / rel).resolve()
        if path != self.static_dir and self.static_dir not in path.parents:
            raise web.HTTPForbidden()
        if path.is_dir():
            if rel and not rel.endswith("/"):
                raise web.HTTPFound(f"/{rel}/")
            path = path / "index.html"
        if not path.is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(
            path,
            headers={"Content-Type": MIME.get(path.suffix, "application/octet-stream"), "Cache-Control": "no-cache"},
        )

    # ------------------------------------------------------------ app
    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_get("/feed", self.feed)
        app.router.add_get("/health", self.health)
        app.router.add_get("/{path:.*}", self.static)

        async def start(_):
            self._task = asyncio.create_task(self._run_adapter())

        async def stop(_):
            if self._task:
                self._task.cancel()
                try:
                    await self._task
                except (asyncio.CancelledError, Exception):
                    pass
            for ws in list(self.clients):
                await ws.close()
            if self._record:
                self._record.close()

        app.on_startup.append(start)
        app.on_cleanup.append(stop)
        return app
