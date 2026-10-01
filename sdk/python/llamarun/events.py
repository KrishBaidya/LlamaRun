"""Publish and subscribe to events between plugins.

Topics are namespaced by the publishing plugin's module: ``publish("heard")``
in ``jarvis_assistant`` is delivered as ``jarvis_assistant.heard``. You can
subscribe to plugins you list under ``"dependencies"``, and to ``app.*``
events from LlamaRun itself::

    class Logger(llamarun.Plugin):
        @llamarun.events.subscribe("jarvis_assistant.heard")
        def on_heard(self, data):
            app.log("info", f"Jarvis heard: {data['text']}")

``"jarvis_assistant.*"`` matches every topic of that plugin. Handlers run on a
background thread and take ``(data)`` or ``(data, event)``.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any, Callable, List, Tuple

from . import _rpc

_lock = threading.Lock()
_handlers: List[Tuple[str, Callable[..., Any]]] = []


@dataclass(frozen=True)
class Event:
    topic: str
    source: str
    """Module of the plugin that published it, or ``"app"``."""


def publish(topic: str, data: Any = None) -> None:
    """Send ``data`` (JSON-serialisable) to every subscriber of ``<your module>.<topic>``."""
    _rpc.notify("events.publish", {"topic": str(topic), "data": data})


def subscribe(topic: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Decorator for plugin methods (or plain functions) that handle ``topic``."""

    def mark(fn: Callable[..., Any]) -> Callable[..., Any]:
        topics = list(getattr(fn, "__llamarun_subscribe__", []))
        topics.append(topic)
        fn.__llamarun_subscribe__ = topics  # type: ignore[attr-defined]
        if "." not in fn.__qualname__ or "<locals>" in fn.__qualname__:
            on(topic, fn)  # a plain function; methods are bound by the host at load
        return fn

    return mark


def on(topic: str, fn: Callable[..., Any]) -> Callable[[], None]:
    """Subscribe ``fn`` at runtime. Returns a function that unsubscribes it."""
    with _lock:
        _handlers.append((topic, fn))
    _sync()

    def off() -> None:
        with _lock:
            if (topic, fn) in _handlers:
                _handlers.remove((topic, fn))
        _sync()

    return off


def topics() -> List[str]:
    with _lock:
        return sorted({t for t, _ in _handlers})


def matches(pattern: str, topic: str) -> bool:
    if pattern in ("*", topic):
        return True
    return pattern.endswith(".*") and topic.startswith(pattern[:-1])


def _sync() -> None:
    _rpc.notify("events.subscriptions", {"topics": topics()})


def _deliver(topic: str, data: Any, source: str) -> int:
    """Called by the host for an incoming event. Returns how many handlers ran."""
    from .ui import _call

    with _lock:
        handlers = [fn for pattern, fn in _handlers if matches(pattern, topic)]
    event = Event(topic=topic, source=source)
    for fn in handlers:
        try:
            _call(fn, data, event)
        except Exception as exc:
            from . import app

            app.log("error", f"event handler {getattr(fn, '__name__', fn)} for {topic} failed: {exc}")
    return len(handlers)


def _reset() -> None:
    with _lock:
        _handlers.clear()


def _bind_methods(instance: Any) -> None:
    """Register ``@subscribe``-decorated methods of the plugin instance."""
    for name in dir(type(instance)):
        attr = getattr(type(instance), name, None)
        for topic in getattr(attr, "__llamarun_subscribe__", []) or []:
            bound = getattr(instance, name)
            with _lock:
                if (topic, bound) not in _handlers:
                    _handlers.append((topic, bound))

