"""Available adapters. Register new ones in ``ADAPTERS``."""

from .base import Adapter
from .replay import ReplayAdapter
from .simulator import SimulatorAdapter
from .tcp_json import TcpJsonAdapter
from .template import TemplateAdapter

ADAPTERS: dict[str, type[Adapter]] = {
    cls.name: cls for cls in (SimulatorAdapter, ReplayAdapter, TcpJsonAdapter, TemplateAdapter)
}

__all__ = ["ADAPTERS", "Adapter"]
