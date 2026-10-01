"""Call functions that other plugins expose.

Every plugin runs in its own process, so plugins can't import each other.
Instead, a plugin marks methods with :func:`expose`, and plugins that list it
under ``"dependencies"`` in plugin.json call them through the app::

    # jarvis_assistant (the provider)
    class Jarvis(llamarun.Plugin):
        @llamarun.expose
        def speak(self, text: str) -> None: ...

    # another plugin, with "dependencies": {"jarvis_assistant": ">=1.0"}
    jarvis = llamarun.plugins.get("jarvis_assistant")
    jarvis.speak("Build finished")

Arguments and return values must be JSON-serialisable. Errors raised by the
provider come back as :class:`~llamarun.PluginError`.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, TypeVar, overload

from . import _rpc

F = TypeVar("F", bound=Callable[..., Any])


@overload
def expose(fn: F) -> F: ...
@overload
def expose(*, name: Optional[str] = None) -> Callable[[F], F]: ...


def expose(fn: Optional[F] = None, *, name: Optional[str] = None):
    """Make a plugin method callable by plugins that depend on this one."""

    def mark(f: F) -> F:
        f.__llamarun_expose__ = name or f.__name__  # type: ignore[attr-defined]
        return f

    return mark(fn) if fn is not None else mark


class ServiceProxy:
    """Calls into another plugin. Get one with :func:`get`."""

    def __init__(self, module: str, timeout: Optional[float] = None):
        self._module = module
        self._timeout = timeout

    def __getattr__(self, method: str) -> Callable[..., Any]:
        if method.startswith("_"):
            raise AttributeError(method)

        def call(*args: Any, **kwargs: Any) -> Any:
            return _rpc.call("services.call", {"plugin": self._module, "method": method, "args": list(args),
                                               "kwargs": kwargs, "timeout": self._timeout})

        call.__name__ = method
        return call

    def __repr__(self) -> str:
        return f"<llamarun plugin {self._module!r}>"


def get(module: str, *, timeout: Optional[float] = 60.0) -> ServiceProxy:
    """Return a proxy for the plugin whose ``entry.module`` is ``module``.

    The plugin must be listed under ``"dependencies"`` in your plugin.json.
    """
    return ServiceProxy(module, timeout)


def available() -> List[Dict[str, Any]]:
    """Plugins you depend on, whether they're running, and the methods they expose."""
    return list(_rpc.call("services.list") or [])
