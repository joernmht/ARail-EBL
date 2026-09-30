"""ARail bridge: publishes train positions from a control system to the web app (WebSocket).

See docs/control-system-interface.md. Start with ``arail-bridge --help``.
"""

from .protocol import PROTOCOL, TrainPosition, disruption_message, hello, trains_message, validate

__all__ = ["PROTOCOL", "TrainPosition", "disruption_message", "hello", "trains_message", "validate"]
