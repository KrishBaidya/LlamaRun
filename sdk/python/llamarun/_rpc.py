"""Low-level bridge between the ``llamarun`` package and the LlamaRun app.

Plugin authors never import this module directly. The plugin host installs a
transport with :func:`set_transport`; every public SDK call goes through
:func:`call`. Outside the app no transport is installed, so host calls raise
:class:`~llamarun.errors.PluginError` while pure-Python pieces (dataclasses,
``storage``) keep working, which keeps plugins unit-testable.
"""

from __future__ import annotations

import contextvars
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, FrozenSet, Optional

from .errors import PluginError

Transport = Callable[[str, dict], Any]


@dataclass(frozen=True)
class PluginContext:
    """Identifies the plugin on whose behalf SDK code is running."""

    module: str
    name: str
    data_dir: Path
    debug: bool = False
    grants: FrozenSet[str] = field(default_factory=lambda: frozenset({"unrestricted"}))
    folder: Optional[Path] = None


_transport: Optional[Transport] = None
_notifier: Optional[Callable[[str, dict], None]] = None
_default: Optional[PluginContext] = None
_current: contextvars.ContextVar[Optional[PluginContext]] = contextvars.ContextVar(
    "llamarun_current_plugin", default=None
)


def set_transport(transport: Optional[Transport], notifier: Optional[Callable[[str, dict], None]] = None) -> None:
    global _transport, _notifier
    _transport = transport
    _notifier = notifier


def in_app() -> bool:
    """True when a host transport is installed (running inside LlamaRun)."""
    return _transport is not None


def call(method: str, params: Optional[dict] = None) -> Any:
    """Invoke a host method and return its result, raising PluginError on failure."""
    if _transport is None:
        raise PluginError(f"{method}: not running inside LlamaRun")
    try:
        return _transport(method, params or {})
    except PluginError:
        raise
    except Exception as exc:  # transport failures surface as SDK errors
        raise PluginError(f"{method}: {exc}") from exc


def notify(method: str, params: dict) -> None:
    """Fire-and-forget message to the host (logging, UI updates)."""
    if _notifier is not None:
        try:
            _notifier(method, params)
        except Exception:
            pass


def current_plugin() -> PluginContext:
    ctx = _current.get() or _default
    if ctx is not None:
        return ctx
    # Outside the app (tests, REPL): scope data to the working directory.
    name = os.environ.get("LLAMARUN_PLUGIN", "dev_plugin")
    return PluginContext(module=name, name=name, data_dir=Path.cwd() / ".llamarun_data" / name, debug=True)


def set_default_plugin(ctx: Optional[PluginContext]) -> None:
    """Identity used by threads that have none bound. The host runs one plugin per process."""
    global _default
    _default = ctx


def bind_plugin(ctx: Optional[PluginContext]) -> contextvars.Token:
    return _current.set(ctx)


def unbind_plugin(token: contextvars.Token) -> None:
    _current.reset(token)
