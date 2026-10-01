"""Per-plugin persistent key/value storage.

Values must be JSON-serialisable. Data is kept in
``PluginData/<module>/storage.json``, outside the plugin folder, so it
survives plugin updates.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Dict

from . import _rpc
from .errors import PluginError

_lock = threading.RLock()


def _path() -> Path:
    return _rpc.current_plugin().data_dir / "storage.json"


def _read(path: Path) -> Dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        return {}


def _write(path: Path, data: Dict[str, Any]) -> None:
    try:
        encoded = json.dumps(data, indent=2, ensure_ascii=False)
    except (TypeError, ValueError) as exc:
        raise PluginError(f"storage value is not JSON-serialisable: {exc}") from exc
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(encoded, encoding="utf-8")
    os.replace(tmp, path)


def get(key: str, default: Any = None) -> Any:
    """Return the stored value for ``key``, or ``default``."""
    with _lock:
        return _read(_path()).get(key, default)


def set(key: str, value: Any) -> None:  # noqa: A001 - mirrors the documented API
    """Store ``value`` under ``key``."""
    with _lock:
        path = _path()
        data = _read(path)
        data[key] = value
        _write(path, data)


def delete(key: str) -> None:
    """Remove ``key`` if present."""
    with _lock:
        path = _path()
        data = _read(path)
        if key in data:
            del data[key]
            _write(path, data)


def clear() -> None:
    """Remove every key stored by this plugin."""
    with _lock:
        _write(_path(), {})
