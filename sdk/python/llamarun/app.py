"""Application-level services: version, notifications and logging."""

from __future__ import annotations

import datetime as _dt
import threading
from pathlib import Path
from typing import Literal

from . import _rpc

LogLevel = Literal["debug", "info", "warning", "error"]
_LEVELS = ("debug", "info", "warning", "error")
_MAX_LOG_BYTES = 1_000_000
_log_lock = threading.Lock()


def get_version() -> str:
    """Return the LlamaRun application version, e.g. ``"0.4.0"``."""
    return str(_rpc.call("app.get_version"))


def get_data_dir() -> Path:
    """Return this plugin's data folder (``PluginData/<module>``), creating it if needed.

    Use it for caches, downloaded models and config files. It is kept outside
    the plugin folder, so it survives plugin updates and reinstalls.
    """
    path = _rpc.current_plugin().data_dir
    path.mkdir(parents=True, exist_ok=True)
    return path


def notify(title: str, message: str) -> None:
    """Show an OS notification."""
    _rpc.call("app.notify", {"title": str(title), "message": str(message)})


def open_url(url: str) -> None:
    """Open an ``http(s)`` or ``mailto`` link in the user's browser. Needs no permission."""
    _rpc.call("app.open_url", {"url": str(url)})


def open_path(path) -> None:
    """Open a file or folder with its default app (e.g. show your data folder).

    Without the ``filesystem`` permission, only paths inside the plugin's data
    folder can be opened.
    """
    _rpc.call("app.open_path", {"path": str(Path(path).resolve())})


def log(level: LogLevel, message: str) -> None:
    """Write a line to this plugin's ``debug.log`` and the app log.

    ``debug`` lines are dropped unless LlamaRun runs in development mode.
    The log lives in ``PluginData/<module>/debug.log`` so it survives plugin updates.
    """
    if level not in _LEVELS:
        raise ValueError(f"level must be one of {_LEVELS}")
    ctx = _rpc.current_plugin()
    if level == "debug" and not ctx.debug:
        return
    line = f"{_dt.datetime.now().isoformat(timespec='seconds')} [{level.upper()}] {message}"
    _write_log(ctx.data_dir / "debug.log", line)
    _rpc.notify("app.log", {"level": level, "message": str(message), "plugin": ctx.name})


def _write_log(path, line: str) -> None:
    with _log_lock:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.exists() and path.stat().st_size > _MAX_LOG_BYTES:
                path.replace(path.with_suffix(".log.1"))
            with path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError:
            pass


# ------------------------------------------------------------------ theme


def set_theme(css: str) -> None:
    """Restyle Llama Run's windows (overlay, chat, settings) with your CSS. Needs ``appearance``.

    The app is styled with CSS variables, so most themes only set a few, e.g.
    ``:root { --primary: oklch(0.7 0.2 150); --radius: 4px }``. Call again to
    replace it; it is removed when the plugin stops.
    """
    _rpc.call("appearance.set_css", {"css": css})


def clear_theme() -> None:
    _rpc.call("appearance.set_css", {"css": ""})


# ------------------------------------------------------------------ shortcuts

_shortcuts: dict = {}
_shortcuts_lock = threading.Lock()


def add_shortcut(accelerator: str, callback, *, id: str = "") -> None:  # noqa: A002
    """Call ``callback()`` when the user presses ``accelerator`` anywhere, e.g. ``"Ctrl+Alt+E"``.

    Uses Electron's accelerator syntax (``Ctrl``, ``Alt``, ``Shift``, ``Super``,
    ``CmdOrCtrl``, letters, ``F1``–``F24``, ``Space``…). Adding the same ``id``
    again replaces its shortcut, which suits a shortcut the user picks in
    settings. Raises :class:`~llamarun.PluginError` when the shortcut is
    invalid or taken. Shortcuts are removed when the plugin stops.
    """
    key = id or accelerator
    _rpc.call("app.shortcut.register", {"id": key, "accelerator": str(accelerator)})
    with _shortcuts_lock:
        _shortcuts[key] = callback


def remove_shortcut(id: str) -> None:  # noqa: A002
    """Remove a shortcut added with :func:`add_shortcut` (by its ``id``, or its accelerator if it had none)."""
    with _shortcuts_lock:
        _shortcuts.pop(id, None)
    _rpc.call("app.shortcut.unregister", {"id": id})


def _shortcut_pressed(params: dict) -> None:
    with _shortcuts_lock:
        callback = _shortcuts.get(str(params.get("id", "")))
    if callback is None:
        return
    try:
        callback()
    except Exception as exc:
        log("error", f"shortcut handler failed: {exc}")
