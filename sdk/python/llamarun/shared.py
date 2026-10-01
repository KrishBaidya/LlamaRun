"""State shared between plugins, kept by the app.

Each plugin owns a namespace named after its ``entry.module``. The owner can
always write to it; plugins that depend on the owner can read it; and the
owner can let others write by listing them in plugin.json::

    "shared": { "writers": ["other_module"] }     # or ["*"] for any dependent

Every key has a version, so several plugins can update the same value safely::

    counter = llamarun.shared.namespace("stats")
    counter.update("prompts", lambda n: (n or 0) + 1)

Values must be JSON-serialisable. The data is saved in
``PluginData/_shared/<module>.json`` and survives restarts.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple

from . import _rpc, events
from .errors import PluginError

_MISSING = object()


class ConflictError(PluginError):
    """Another plugin changed the value between your read and your write."""


class Namespace:
    def __init__(self, owner: str):
        self.owner = owner

    def get(self, key: str, default: Any = None) -> Any:
        value, version = self.get_versioned(key)
        return default if version == 0 else value

    def get_versioned(self, key: str) -> Tuple[Any, int]:
        """Return ``(value, version)``. A missing key has version 0."""
        result = _rpc.call("shared.get", {"namespace": self.owner, "key": key}) or {}
        return result.get("value"), int(result.get("version", 0))

    def set(self, key: str, value: Any, *, if_version: Optional[int] = None) -> int:
        """Store ``value``. With ``if_version``, raise :class:`ConflictError` if the key changed since.

        Returns the new version.
        """
        result = _rpc.call("shared.set", {"namespace": self.owner, "key": key, "value": value,
                                          "ifVersion": if_version}) or {}
        if not result.get("ok", False):
            raise ConflictError(f"shared value {self.owner}.{key} changed (now version {result.get('version')})")
        return int(result["version"])

    def delete(self, key: str) -> None:
        _rpc.call("shared.delete", {"namespace": self.owner, "key": key})

    def keys(self) -> List[str]:
        return list(_rpc.call("shared.keys", {"namespace": self.owner}) or [])

    def update(self, key: str, fn: Callable[[Any], Any], *, retries: int = 20) -> Any:
        """Atomically replace the value with ``fn(current)`` (``None`` if missing) and return it.

        If another plugin writes in between, ``fn`` is called again with the new value.
        """
        for _ in range(max(1, retries)):
            current, version = self.get_versioned(key)
            new = fn(None if version == 0 else current)
            try:
                self.set(key, new, if_version=version)
                return new
            except ConflictError:
                continue
        raise ConflictError(f"gave up updating {self.owner}.{key} after {retries} conflicts")

    def watch(self, key: Optional[str] = None, fn: Optional[Callable[..., Any]] = None):
        """Call ``fn(value, key)`` when ``key`` (or any key, if ``None``) changes.

        Use it directly or as a decorator. Returns an unsubscribe function when
        ``fn`` is given.
        """

        def register(f: Callable[..., Any]):
            def handler(data: Dict[str, Any], _event: Any = None) -> None:
                if key is None or data.get("key") == key:
                    from .ui import _call

                    _call(f, data.get("value"), data.get("key"))

            _rpc.call("shared.watch", {"namespace": self.owner})
            return events.on(f"$shared.{self.owner}", handler)

        if fn is not None:
            return register(fn)
        return lambda f: (register(f), f)[1]

    def __repr__(self) -> str:
        return f"<llamarun shared namespace {self.owner!r}>"


def namespace(owner: Optional[str] = None) -> Namespace:
    """The namespace of plugin ``owner`` (its ``entry.module``); your own if omitted."""
    return Namespace(owner or _rpc.current_plugin().module)


def get(key: str, default: Any = None) -> Any:
    return namespace().get(key, default)


def set(key: str, value: Any) -> int:  # noqa: A001
    return namespace().set(key, value)


def update(key: str, fn: Callable[[Any], Any]) -> Any:
    return namespace().update(key, fn)
