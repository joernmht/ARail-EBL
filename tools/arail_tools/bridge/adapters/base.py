"""Adapter interface: an adapter talks to a control system and publishes feed messages."""

from __future__ import annotations

import abc
import argparse
from collections.abc import Awaitable, Callable
from typing import Any

Publish = Callable[[dict[str, Any]], Awaitable[None]]


class Adapter(abc.ABC):
    """Base class of all adapters.

    Subclasses implement :meth:`run`, which runs until cancelled and calls ``publish`` with
    protocol messages (build them with ``protocol.trains_message`` & co.). Command line
    options are declared in :meth:`add_arguments` and arrive in ``__init__`` as ``args``.
    """

    #: name used on the command line: ``arail-bridge --adapter <name>``
    name = "adapter"
    #: shown in the ``hello`` message and in the app
    description = ""

    def __init__(self, args: argparse.Namespace):
        self.args = args

    @classmethod
    def add_arguments(cls, parser: argparse.ArgumentParser) -> None:
        """Add adapter-specific command line options (optional)."""
        return None

    @property
    def source(self) -> str:
        return self.description or self.name

    @abc.abstractmethod
    async def run(self, publish: Publish) -> None:
        """Connect to the control system and publish messages until cancelled."""
