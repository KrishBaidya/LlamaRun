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

from dataclasses import dataclass, field
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


# ------------------------------------------------- installing plugins (SDK 1.3)


@dataclass
class InstalledPlugin:
    id: str
    name: str
    description: str
    version: str
    module: str
    state: str
    """``running``, ``error``, ``disabled``, ``needs-consent``…"""
    error: str = ""
    tools: List[str] = field(default_factory=list)
    """Tools it declares; models get them only if ``"tools"`` is in ``granted``."""
    granted: List[str] = field(default_factory=list)
    """The permissions the user allowed."""


@dataclass
class MarketplaceResults:
    available: bool
    """False while LlamaRun has no plugin marketplace."""
    plugins: List[Dict[str, Any]] = field(default_factory=list)
    message: str = ""


def _installed(p: Dict[str, Any]) -> InstalledPlugin:
    return InstalledPlugin(
        id=str(p.get("id", "")),
        name=str(p.get("name", "")),
        description=str(p.get("description") or ""),
        version=str(p.get("version") or ""),
        module=str(p.get("module") or ""),
        state=str(p.get("state") or ""),
        error=str(p.get("error") or ""),
        tools=[str(t) for t in p.get("tools") or []],
        granted=[str(g) for g in p.get("granted") or []],
    )


def installed() -> List[InstalledPlugin]:
    """Every installed plugin. Needs the ``install`` permission."""
    return [_installed(p) for p in _rpc.call("plugins.installed") or []]


def install(folder: str, *, reason: str = "") -> Optional[InstalledPlugin]:
    """Ask the user to install the plugin in ``folder``. Needs the ``install`` permission.

    The folder must be inside your plugin's data folder (``app.get_data_dir()``),
    unless you also have the ``filesystem`` permission. LlamaRun shows the
    plugin's name and the permissions it asks for, which the user can untick.
    Installing over a plugin with the same folder name updates it.

    Returns the plugin after it started (check ``state`` and ``error``), or
    None if the user said no.
    """
    result = _rpc.call("plugins.install", {"path": str(folder), "reason": reason})
    return _installed(result) if result else None


def search_marketplace(query: str) -> MarketplaceResults:
    """Search the LlamaRun plugin marketplace. Needs the ``install`` permission.

    The marketplace doesn't exist yet: this returns ``available=False`` until it does.
    """
    r = _rpc.call("plugins.marketplace.search", {"query": query}) or {}
    return MarketplaceResults(bool(r.get("available")), list(r.get("plugins") or []), str(r.get("message") or ""))
