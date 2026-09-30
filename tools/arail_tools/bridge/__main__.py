"""ARail bridge: connects a control system to the ARail web app.

    arail-bridge --adapter simulator --layout web/layouts/ebl-lab.json
    arail-bridge --adapter tcp-json --connect 192.168.1.20:5005 --host 0.0.0.0
    arail-bridge --adapter replay --file examples/feeds/sample-trains.jsonl --loop
    arail-bridge --serve web --tls-cert cert.pem --tls-key key.pem --host 0.0.0.0   # app + feed over https

Then connect the app (Control panel) to ws://localhost:8765/feed (or wss://<host>:8765/feed).
"""

from __future__ import annotations

import argparse
import logging
import socket
import ssl
import sys

try:
    from aiohttp import web
except ImportError:  # pragma: no cover
    sys.exit("The bridge needs aiohttp: pip install -e 'tools[bridge]'")

from .adapters import ADAPTERS
from .server import BridgeServer


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="arail-bridge",
        description="Bridge between a control system and the ARail web app",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--adapter", choices=sorted(ADAPTERS), default="simulator", help="where train positions come from")
    p.add_argument("--host", default="127.0.0.1", help="address to listen on (0.0.0.0 = all network interfaces)")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--serve", metavar="DIR", help="also serve the web app from DIR (e.g. web)")
    p.add_argument("--tls-cert", help="certificate (PEM) for https/wss")
    p.add_argument("--tls-key", help="private key (PEM) for https/wss")
    p.add_argument(
        "--origin",
        action="append",
        help="allowed browser origin, e.g. https://joernmht.github.io (repeatable; default: any)",
    )
    p.add_argument("--record", metavar="FILE", help="append all messages to FILE (JSON lines, replayable)")
    p.add_argument("-v", "--verbose", action="store_true")
    for cls in ADAPTERS.values():
        cls.add_arguments(p)
    return p


def main(argv=None) -> None:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    adapter = ADAPTERS[args.adapter](args)
    server = BridgeServer(adapter, static_dir=args.serve, allowed_origins=args.origin, record=args.record)
    ssl_ctx = None
    if args.tls_cert or args.tls_key:
        if not (args.tls_cert and args.tls_key):
            sys.exit("--tls-cert and --tls-key belong together")
        ssl_ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        ssl_ctx.load_cert_chain(args.tls_cert, args.tls_key)
    scheme, ws = ("https", "wss") if ssl_ctx else ("http", "ws")
    host = socket.gethostname() if args.host in ("0.0.0.0", "::") else args.host
    print(f"ARail bridge ({adapter.source})")
    print(f"  feed:   {ws}://{host}:{args.port}/feed")
    print(f"  health: {scheme}://{host}:{args.port}/health")
    if args.serve:
        print(f"  app:    {scheme}://{host}:{args.port}/app/?feed={ws}://{host}:{args.port}/feed")
    web.run_app(server.app(), host=args.host, port=args.port, ssl_context=ssl_ctx, print=None)


if __name__ == "__main__":
    main()
