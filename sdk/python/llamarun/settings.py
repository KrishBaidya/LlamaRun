"""The plugin's user-facing settings.

Declare the form with :func:`llamarun.ui.settings` in ``on_load``; the app
shows it on the plugin's page in Settings → Plugins and saves the values in
``PluginData/<module>/settings.json``. Read them here::

    from llamarun import settings, ui

    class MyPlugin(llamarun.Plugin):
        def on_load(self):
            ui.settings(ui.Switch("sounds", "Play sounds", default=True))

        @settings.on_change
        def settings_changed(self, changed):
            if "sounds" in changed:
                ...

        def speak(self):
            if settings.get("sounds"):
                ...
"""

from __future__ import annotations

import threading
from typing import Any, Callable, Dict, List

from . import _rpc

_lock = threading.RLock()
_defaults: Dict[str, Any] = {}
_values: Dict[str, Any] = {}
_listeners: List[Callable[[Dict[str, Any]], Any]] = []


def get(key: str, default: Any = None) -> Any:
    """Return the saved value of ``key``, its declared default, or ``default``."""
    with _lock:
        if key in _values:
            return _values[key]
        return _defaults.get(key, default)


def all() -> Dict[str, Any]:  # noqa: A001 - mirrors the documented API
    """Every declared setting with its current value."""
    with _lock:
        return {**_defaults, **{k: v for k, v in _values.items() if k in _defaults or not _defaults}}


def set(key: str, value: Any) -> None:  # noqa: A001
    """Change a setting from code. The Settings page updates immediately."""
    with _lock:
        _values[key] = value
    if _rpc.in_app():
        _rpc.call("settings.set", {"values": {key: value}})


def on_change(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Decorator: call ``fn(changed)`` with ``{name: new_value}`` when the user edits settings.

    Works on plugin methods and on plain functions.
    """
    fn.__llamarun_settings_listener__ = True  # type: ignore[attr-defined]
    if "." not in getattr(fn, "__qualname__", "") or "<locals>" in fn.__qualname__:
        _listeners.append(fn)  # a plain function; methods are bound by the host at load
    return fn


def _add_listener(fn: Callable[..., Any]) -> None:
    if fn not in _listeners:
        _listeners.append(fn)


def _install(defaults: Dict[str, Any], values: Dict[str, Any]) -> Dict[str, Any]:
    with _lock:
        _defaults.clear()
        _defaults.update(defaults)
        _values.update(values)
    return all()


def _apply(values: Dict[str, Any]) -> Dict[str, Any]:
    """Called by the host when the user saved new values. Returns what changed."""
    with _lock:
        changed = {k: v for k, v in values.items() if get(k) != v}
        _values.update(values)
    if changed:
        from .ui import _call

        for fn in list(_listeners):
            try:
                _call(fn, dict(changed))
            except Exception as exc:  # one broken listener shouldn't stop the others
                from . import app

                app.log("error", f"settings listener {getattr(fn, '__name__', fn)} failed: {exc}")
    return changed


def _reset() -> None:
    with _lock:
        _defaults.clear()
        _values.clear()
        _listeners.clear()
