"""Build UI that LlamaRun draws with its own components.

You describe the UI in Python and the app renders it, so plugins match the
app's look and work in light and dark mode without any GUI toolkit. The
plugin keeps the state and receives the events.

Surfaces:

* :func:`settings` is a form on the plugin's page in Settings. Values are
  saved by the app and read with :mod:`llamarun.settings`.
* :func:`hud` is a small floating status card that never takes focus.
* :func:`toast`, :func:`confirm`, :func:`prompt`, :func:`select`,
  :func:`form` and :func:`alert` are notifications and blocking dialogs.
* :func:`panel` is a window, built from a :class:`View` in Python or from a
  TSX component in the plugin's ``ui/`` folder.

Example::

    from llamarun import ui

    class Counter(ui.View):
        def __init__(self):
            super().__init__(count=0)

        def render(self):
            return ui.Card(
                ui.Heading(f"Clicked {self.state['count']} times"),
                ui.Button("Click me", on_click=lambda: self.set_state(count=self.state["count"] + 1)),
            )

    ui.panel("Counter", view=Counter()).show()
"""

from __future__ import annotations

import base64
import inspect
import itertools
import mimetypes
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Literal, Optional, Sequence, Tuple, Union

from . import _rpc
from . import settings as _settings
from .errors import PluginError

__all__ = [
    "Node", "View", "Panel", "Hud",
    "Column", "Row", "Card", "Heading", "Text", "Markdown", "Code", "Separator", "Image", "Callout",
    "Button", "Input", "Textarea", "Switch", "Checkbox", "Select", "Slider",
    "Badge", "Progress", "Spinner", "List",
    "settings", "hud", "toast", "confirm", "prompt", "select", "form", "alert", "panel", "image_file",
]

Tone = Literal["default", "muted", "success", "warning", "destructive"]
Options = Union[Sequence[str], Sequence[Tuple[str, str]], Dict[str, str]]
Child = Union["Node", str, None]

_ids = itertools.count(1)
_surfaces: Dict[str, Any] = {}
_surfaces_lock = threading.Lock()


def _new_id(kind: str) -> str:
    return f"{kind}-{next(_ids)}"


# --------------------------------------------------------------------------- nodes


class Node:
    """One element of a UI tree. Create nodes with the component functions below."""

    __slots__ = ("type", "props", "children")

    def __init__(self, type: str, props: Optional[Dict[str, Any]] = None, children: Iterable[Child] = ()):
        self.type = type
        self.props = {k: v for k, v in (props or {}).items() if v is not None}
        self.children = [c if isinstance(c, Node) else Text(str(c)) for c in children if c is not None and c is not False]

    def __repr__(self) -> str:
        return f"<{self.type} {self.props!r} children={len(self.children)}>"

    def to_dict(self, callbacks: Optional["_Callbacks"] = None) -> dict:
        props: Dict[str, Any] = {}
        for key, value in self.props.items():
            if callable(value):
                if callbacks is not None:
                    props[key] = {"$cb": callbacks.add(value)}
            elif isinstance(value, Node):
                props[key] = value.to_dict(callbacks)
            else:
                props[key] = value
        out: Dict[str, Any] = {"type": self.type, "props": props}
        if self.children:
            out["children"] = [c.to_dict(callbacks) for c in self.children]
        return out


class _Callbacks:
    """Callables found while serialising a tree, addressed by position so ids stay stable."""

    def __init__(self) -> None:
        self.fns: Dict[str, Callable[..., Any]] = {}

    def add(self, fn: Callable[..., Any]) -> str:
        key = f"cb{len(self.fns)}"
        self.fns[key] = fn
        return key


def _call(fn: Callable[..., Any], *args: Any) -> Any:
    """Call ``fn`` with as many of ``args`` as it accepts, so handlers can ignore payloads."""
    try:
        params = inspect.signature(fn).parameters.values()
    except (TypeError, ValueError):
        return fn(*args)
    if any(p.kind == p.VAR_POSITIONAL for p in params):
        return fn(*args)
    positional = [p for p in params if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
    return fn(*args[: len(positional)])


def _options(options: Options) -> List[Dict[str, str]]:
    if isinstance(options, dict):
        return [{"value": str(k), "label": str(v)} for k, v in options.items()]
    out = []
    for item in options:
        if isinstance(item, (tuple, list)):
            out.append({"value": str(item[0]), "label": str(item[1])})
        else:
            out.append({"value": str(item), "label": str(item)})
    return out


# ---------------------------------------------------------------------- layout & text


def Column(*children: Child, gap: int = 3, align: Optional[Literal["start", "center", "end", "stretch"]] = None) -> Node:
    """Stack children vertically. ``gap`` is in Tailwind spacing units (1 = 4px)."""
    return Node("Column", {"gap": gap, "align": align}, children)


def Row(
    *children: Child,
    gap: int = 2,
    align: Literal["start", "center", "end", "stretch"] = "center",
    justify: Optional[Literal["start", "center", "end", "between"]] = None,
    wrap: bool = False,
) -> Node:
    """Lay children out horizontally."""
    return Node("Row", {"gap": gap, "align": align, "justify": justify, "wrap": wrap or None}, children)


def Card(*children: Child, title: Optional[str] = None, description: Optional[str] = None) -> Node:
    """A bordered surface with an optional title."""
    return Node("Card", {"title": title, "description": description}, children)


def Heading(text: str, level: Literal[1, 2, 3] = 2) -> Node:
    return Node("Heading", {"text": str(text), "level": level})


def Text(
    text: str,
    *,
    tone: Tone = "default",
    size: Literal["xs", "sm", "base", "lg"] = "sm",
    weight: Optional[Literal["normal", "medium", "semibold"]] = None,
    selectable: bool = True,
) -> Node:
    return Node("Text", {"text": str(text), "tone": tone, "size": size, "weight": weight, "selectable": selectable})


def Markdown(text: str) -> Node:
    """GitHub-flavoured Markdown with code highlighting, like chat replies."""
    return Node("Markdown", {"text": str(text)})


def Code(text: str, language: Optional[str] = None) -> Node:
    return Node("Code", {"text": str(text), "language": language})


def Separator() -> Node:
    return Node("Separator")


def Image(src: str, *, alt: str = "", width: Optional[int] = None, height: Optional[int] = None, rounded: bool = True) -> Node:
    """An image from a ``data:`` URL. Use :func:`image_file` for files in your plugin."""
    return Node("Image", {"src": src, "alt": alt, "width": width, "height": height, "rounded": rounded})


def Callout(text: str, *, title: Optional[str] = None, tone: Tone = "default") -> Node:
    """A highlighted note, for tips, warnings and errors."""
    return Node("Callout", {"text": str(text), "title": title, "tone": tone})


def Badge(text: str, *, variant: Literal["default", "secondary", "outline", "success", "destructive"] = "secondary") -> Node:
    return Node("Badge", {"text": str(text), "variant": variant})


def Progress(value: Optional[float] = None, *, label: Optional[str] = None) -> Node:
    """A progress bar from 0 to 100. ``None`` shows an indeterminate bar."""
    return Node("Progress", {"value": value, "label": label, "indeterminate": value is None or None})


def Spinner(label: Optional[str] = None) -> Node:
    return Node("Spinner", {"label": label})


def List(items: Iterable[Child], *, dividers: bool = True) -> Node:
    """A vertical list. Items can be strings or nodes."""
    return Node("List", {"dividers": dividers}, items)


# ------------------------------------------------------------------------ inputs
#
# Every input has a ``name``. In a View, the current values of all inputs are
# passed to Button ``on_click`` handlers as a dict keyed by name. In
# :func:`settings` and :func:`form`, ``name`` is the key the value is stored under
# and ``default`` is the initial value.


def Button(
    label: str,
    on_click: Optional[Callable[..., Any]] = None,
    *,
    variant: Literal["default", "secondary", "outline", "ghost", "destructive"] = "default",
    size: Literal["sm", "default", "lg"] = "default",
    icon: Optional[str] = None,
    disabled: bool = False,
) -> Node:
    """A button. ``on_click`` receives the view's input values (``dict``) if it takes an argument.

    ``icon`` is a lucide icon name in kebab-case, e.g. ``"play"`` or ``"trash-2"``.
    """
    return Node("Button", {"label": str(label), "on_click": on_click, "variant": variant, "size": size,
                           "icon": icon, "disabled": disabled or None})


def Input(
    name: str,
    label: Optional[str] = None,
    *,
    default: str = "",
    placeholder: Optional[str] = None,
    description: Optional[str] = None,
    type: Literal["text", "password", "number", "email", "url"] = "text",
    on_change: Optional[Callable[..., Any]] = None,
    on_submit: Optional[Callable[..., Any]] = None,
) -> Node:
    """A single-line text field. ``on_submit`` fires on Enter with the value."""
    return Node("Input", {"name": name, "label": label, "default": default, "placeholder": placeholder,
                          "description": description, "inputType": type, "on_change": on_change,
                          "on_submit": on_submit})


def Textarea(
    name: str,
    label: Optional[str] = None,
    *,
    default: str = "",
    placeholder: Optional[str] = None,
    description: Optional[str] = None,
    rows: int = 4,
    on_change: Optional[Callable[..., Any]] = None,
) -> Node:
    return Node("Textarea", {"name": name, "label": label, "default": default, "placeholder": placeholder,
                             "description": description, "rows": rows, "on_change": on_change})


def Switch(
    name: str,
    label: Optional[str] = None,
    *,
    default: bool = False,
    description: Optional[str] = None,
    on_change: Optional[Callable[..., Any]] = None,
) -> Node:
    return Node("Switch", {"name": name, "label": label, "default": bool(default), "description": description,
                           "on_change": on_change})


def Checkbox(
    name: str,
    label: Optional[str] = None,
    *,
    default: bool = False,
    description: Optional[str] = None,
    on_change: Optional[Callable[..., Any]] = None,
) -> Node:
    return Node("Checkbox", {"name": name, "label": label, "default": bool(default), "description": description,
                             "on_change": on_change})


def Select(
    name: str,
    label: Optional[str] = None,
    *,
    options: Options = (),
    default: Optional[str] = None,
    placeholder: Optional[str] = None,
    description: Optional[str] = None,
    on_change: Optional[Callable[..., Any]] = None,
) -> Node:
    """A dropdown. ``options`` is a list of values, ``(value, label)`` pairs, or a dict."""
    opts = _options(options)
    return Node("Select", {"name": name, "label": label, "options": opts,
                           "default": default if default is not None else (opts[0]["value"] if opts else ""),
                           "placeholder": placeholder, "description": description, "on_change": on_change})


def Slider(
    name: str,
    label: Optional[str] = None,
    *,
    default: float = 0,
    min: float = 0,
    max: float = 100,
    step: float = 1,
    description: Optional[str] = None,
    on_change: Optional[Callable[..., Any]] = None,
) -> Node:
    return Node("Slider", {"name": name, "label": label, "default": default, "min": min, "max": max, "step": step,
                           "description": description, "on_change": on_change})


def image_file(path: Union[str, Path]) -> str:
    """Read an image file (e.g. from your plugin folder) and return a ``data:`` URL for :func:`Image`."""
    path = Path(path)
    if not path.is_absolute():
        path = (_rpc.current_plugin().folder or Path.cwd()) / path
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


# ------------------------------------------------------------------------ settings


def settings(*fields: Node) -> Dict[str, Any]:
    """Declare the plugin's settings form, shown on its page in Settings → Plugins.

    Call it from ``on_load`` (again whenever the options change, e.g. a list of
    voices). Returns the current values. The app saves them and they survive
    updates; read them with ``llamarun.settings.get(name)`` and react to changes
    with ``@llamarun.settings.on_change``. ``Heading``, ``Text`` and ``Separator``
    nodes can be mixed in to group fields.
    """
    schema = [f.to_dict(None) for f in fields]
    defaults = {n["props"]["name"]: n["props"].get("default") for n in _walk(schema) if "name" in n.get("props", {})}
    if _rpc.in_app():
        values = _rpc.call("settings.register", {"schema": schema}) or {}
    else:
        values = {}
    return _settings._install(defaults, values)


def _walk(nodes: List[dict]):
    for n in nodes:
        yield n
        yield from _walk(n.get("children", []))


# ------------------------------------------------------------------------- toasts


def toast(
    message: str,
    *,
    kind: Literal["info", "success", "warning", "error"] = "info",
    description: Optional[str] = None,
    duration: float = 4.0,
) -> None:
    """Show a short message in a small card at the edge of the screen."""
    _rpc.notify("ui.toast", {"message": str(message), "kind": kind, "description": description, "duration": duration})


# ------------------------------------------------------------------------ dialogs
# These block the calling thread until the user answers, so call them from a
# hook, an action or your own thread, never while holding a lock the UI needs.


def _dialog(**params: Any) -> Any:
    return _rpc.call("ui.dialog", {k: v for k, v in params.items() if v is not None})


def alert(title: str, message: str = "") -> None:
    _dialog(kind="alert", title=str(title), message=str(message))


def confirm(
    title: str,
    message: str = "",
    *,
    confirm_label: str = "OK",
    cancel_label: str = "Cancel",
    destructive: bool = False,
) -> bool:
    """Ask a yes/no question. Returns ``False`` if the dialog is dismissed."""
    return bool(_dialog(kind="confirm", title=str(title), message=str(message), confirmLabel=confirm_label,
                        cancelLabel=cancel_label, destructive=destructive or None))


def prompt(
    title: str,
    message: str = "",
    *,
    label: Optional[str] = None,
    default: str = "",
    placeholder: Optional[str] = None,
    password: bool = False,
    multiline: bool = False,
) -> Optional[str]:
    """Ask for a line of text. Returns ``None`` if cancelled."""
    field = (Textarea("value", label, default=default, placeholder=placeholder) if multiline
             else Input("value", label, default=default, placeholder=placeholder,
                        type="password" if password else "text"))
    result = form(title, field, message=message)
    return None if result is None else str(result.get("value", ""))


def select(title: str, options: Options, message: str = "", *, default: Optional[str] = None) -> Optional[str]:
    """Let the user pick one option. Returns the chosen value, or ``None`` if cancelled."""
    result = form(title, Select("value", options=options, default=default), message=message)
    return None if result is None else result.get("value")


def form(title: str, *fields: Node, message: str = "", submit_label: str = "OK", cancel_label: str = "Cancel") -> Optional[Dict[str, Any]]:
    """Show a form built from input nodes. Returns ``{name: value}``, or ``None`` if cancelled."""
    result = _dialog(kind="form", title=str(title), message=str(message), fields=[f.to_dict(None) for f in fields],
                     confirmLabel=submit_label, cancelLabel=cancel_label)
    return result if isinstance(result, dict) else None


# ---------------------------------------------------------------------------- HUD

Indicator = Literal["none", "spinner", "pulse", "bars", "dot", "error"]


class Hud:
    """A floating status card. Create it with :func:`hud`.

    It sits at the bottom (or top) of the screen above other windows, never takes
    keyboard focus, and fades out when hidden. Clicking it calls ``on_click`` or,
    if there is none, hides it.
    """

    _LEVEL_INTERVAL = 1 / 30

    def __init__(self, *, title: str = "", text: str = "", indicator: Indicator = "none", level: float = 0.0,
                 position: Literal["bottom", "top"] = "bottom", on_click: Optional[Callable[[], Any]] = None):
        self.id = _new_id("hud")
        self._props: Dict[str, Any] = {"title": title, "text": text, "indicator": indicator,
                                       "level": float(level), "position": position}
        self._on_click = on_click
        self._visible = False
        self._last_level = 0.0
        self._level_timer: Optional[threading.Timer] = None
        self._lock = threading.Lock()
        self._hide_timer: Optional[threading.Timer] = None
        with _surfaces_lock:
            _surfaces[self.id] = self

    @property
    def visible(self) -> bool:
        return self._visible

    def _send(self, op: str, **extra: Any) -> None:
        _rpc.notify("ui.hud", {"id": self.id, "op": op, "props": dict(self._props), **extra})

    def update(self, **props: Any) -> "Hud":
        """Change ``title``, ``text``, ``indicator``, ``level`` (0–1) or ``position``.

        Updates to ``level`` alone are throttled to about 30 per second, so you
        can call it for every audio frame.
        """
        unknown = set(props) - set(self._props)
        if unknown:
            raise TypeError(f"unknown HUD properties: {', '.join(sorted(unknown))}")
        with self._lock:
            if "level" in props:
                props["level"] = max(0.0, min(1.0, float(props["level"])))
            self._props.update(props)
            if set(props) == {"level"}:
                now = time.monotonic()
                if now - self._last_level < self._LEVEL_INTERVAL:
                    if self._level_timer is None:
                        self._level_timer = threading.Timer(self._LEVEL_INTERVAL, self._flush_level)
                        self._level_timer.daemon = True
                        self._level_timer.start()
                    return self
                self._last_level = now
            if self._visible:
                self._send("update")
        return self

    def _flush_level(self) -> None:
        with self._lock:
            self._level_timer = None
            self._last_level = time.monotonic()
            if self._visible:
                self._send("update")

    def show(self, **props: Any) -> "Hud":
        """Show the card, optionally changing its properties first."""
        if self._hide_timer is not None:
            self._hide_timer.cancel()
            self._hide_timer = None
        if props:
            self._props.update(props)
        self._visible = True
        self._send("show")
        return self

    def hide(self, after: Optional[float] = None) -> None:
        """Hide the card, immediately or ``after`` seconds (cancelled by a later ``show``)."""
        if self._hide_timer is not None:
            self._hide_timer.cancel()
            self._hide_timer = None
        if after:
            self._hide_timer = threading.Timer(after, self.hide)
            self._hide_timer.daemon = True
            self._hide_timer.start()
            return
        self._visible = False
        self._send("hide")

    def close(self) -> None:
        """Remove the card for good."""
        self._visible = False
        self._send("close")
        with _surfaces_lock:
            _surfaces.pop(self.id, None)

    def _event(self, params: dict) -> Any:
        if params.get("event") == "click":
            if self._on_click is not None:
                return _call(self._on_click)
            self._visible = False
        elif params.get("event") == "dismissed":
            self._visible = False
        return None


def hud(
    title: str = "",
    text: str = "",
    *,
    indicator: Indicator = "none",
    level: float = 0.0,
    position: Literal["bottom", "top"] = "bottom",
    on_click: Optional[Callable[[], Any]] = None,
    show: bool = True,
) -> Hud:
    """Create a floating status card (and show it unless ``show=False``).

    ``indicator`` animates next to the title: ``spinner`` (working), ``pulse``
    (listening; its size follows ``level``), ``bars`` (speaking), ``dot`` (ready),
    ``error``, or ``none``.
    """
    card = Hud(title=title, text=text, indicator=indicator, level=level, position=position, on_click=on_click)
    if show:
        card.show()
    return card


# -------------------------------------------------------------------------- views


class View:
    """Base class for Python-built panels.

    Override :meth:`render` to return a :class:`Node` tree built from ``self.state``
    and call :meth:`set_state` to change it; the panel re-renders automatically
    (coalesced to at most ~30 renders per second).
    """

    def __init__(self, **state: Any) -> None:
        self.state: Dict[str, Any] = dict(state)
        self._panel: Optional["Panel"] = None

    def render(self) -> Node:
        raise NotImplementedError("View subclasses must implement render()")

    def set_state(self, **patch: Any) -> None:
        self.state.update(patch)
        self.refresh()

    def refresh(self) -> None:
        """Re-render after changing ``self.state`` (or other attributes) in place."""
        if self._panel is not None:
            self._panel._schedule_render()


class Panel:
    """A plugin window. Create it with :func:`panel`."""

    def __init__(self, title: str, *, view: Optional[View] = None, tsx: Optional[str] = None,
                 state: Optional[Dict[str, Any]] = None, width: int = 480, height: int = 560):
        if (view is None) == (tsx is None):
            raise ValueError("pass exactly one of view= (a ui.View) or tsx= (a panel name from plugin.json)")
        self.id = _new_id("panel")
        self.title = title
        self.view = view
        self.tsx = tsx
        self.width = width
        self.height = height
        self._state: Dict[str, Any] = dict(state or {})
        self._handlers: Dict[str, Callable[..., Any]] = {}
        self._close_handlers: List[Callable[[], Any]] = []
        self._callbacks = _Callbacks()
        self._visible = False
        self._render_timer: Optional[threading.Timer] = None
        self._render_lock = threading.Lock()
        if view is not None:
            view._panel = self
        with _surfaces_lock:
            _surfaces[self.id] = self

    # -- public API

    @property
    def visible(self) -> bool:
        return self._visible

    @property
    def state(self) -> Dict[str, Any]:
        """State shared with a TSX panel (read it there with ``usePluginState()``)."""
        return dict(self._state)

    def set_state(self, **patch: Any) -> None:
        """Merge ``patch`` into the state and push it to a TSX panel."""
        self._state.update(patch)
        if self._visible and self.tsx is not None:
            _rpc.notify("ui.state", {"id": self.id, "state": self._state})

    def replace_state(self, state: Dict[str, Any]) -> None:
        self._state = dict(state)
        if self._visible and self.tsx is not None:
            _rpc.notify("ui.state", {"id": self.id, "state": self._state})

    def on(self, event: str, fn: Optional[Callable[..., Any]] = None):
        """Handle ``emit(event, payload)`` / ``call(event, payload)`` from a TSX panel.

        Use as ``panel.on("save", self.save)`` or as a decorator. The handler gets
        the payload; its return value is what ``call()`` resolves to in TSX.
        """
        if fn is not None:
            self._handlers[event] = fn
            return fn

        def decorator(f: Callable[..., Any]) -> Callable[..., Any]:
            self._handlers[event] = f
            return f

        return decorator

    def on_close(self, fn: Callable[[], Any]) -> Callable[[], Any]:
        """Call ``fn`` when the user closes the window."""
        self._close_handlers.append(fn)
        return fn

    def show(self) -> "Panel":
        """Open the window, or bring it to the front if it's already open."""
        params: Dict[str, Any] = {"id": self.id, "title": self.title, "width": self.width, "height": self.height}
        if self.tsx is not None:
            params.update(tsx=self.tsx, state=self._state)
        else:
            params["tree"] = self._tree()
        self._visible = True
        _rpc.notify("ui.panel.open", params)
        return self

    def set_title(self, title: str) -> None:
        self.title = title
        if self._visible:
            _rpc.notify("ui.panel.title", {"id": self.id, "title": title})

    def close(self) -> None:
        if self._visible:
            self._visible = False
            _rpc.notify("ui.panel.close", {"id": self.id})

    # -- internals

    def _tree(self) -> dict:
        assert self.view is not None
        callbacks = _Callbacks()
        tree = self.view.render()
        if not isinstance(tree, Node):
            raise PluginError(f"{type(self.view).__name__}.render() must return a ui node, got {type(tree).__name__}")
        data = tree.to_dict(callbacks)
        self._callbacks = callbacks
        return data

    def _schedule_render(self) -> None:
        if not self._visible or self.view is None:
            return
        with self._render_lock:
            if self._render_timer is not None:
                return
            self._render_timer = threading.Timer(1 / 30, self._flush_render)
            self._render_timer.daemon = True
            self._render_timer.start()

    def _flush_render(self) -> None:
        with self._render_lock:
            self._render_timer = None
        if self._visible:
            _rpc.notify("ui.render", {"id": self.id, "tree": self._tree()})

    def _event(self, params: dict) -> Any:
        kind = params.get("event")
        payload = params.get("payload")
        if kind == "$closed":
            self._visible = False
            for fn in list(self._close_handlers):
                _call(fn)
            return None
        if kind == "$callback":
            fn = self._callbacks.fns.get(str(params.get("handler")))
            if fn is None:
                return None  # a stale callback from before the last render
            args = payload if isinstance(payload, list) else [payload]
            return _call(fn, *args)
        handler = self._handlers.get(str(kind))
        if handler is None:
            raise PluginError(f'panel "{self.title}" has no handler for event "{kind}"; add one with panel.on("{kind}", ...)')
        return _call(handler, payload)


def panel(title: str, *, view: Optional[View] = None, tsx: Optional[str] = None,
          state: Optional[Dict[str, Any]] = None, width: int = 480, height: int = 560) -> Panel:
    """Create a window. Call ``.show()`` to open it.

    * ``view=MyView()`` renders a Python :class:`View`.
    * ``tsx="History"`` renders the TSX component registered under
      ``"ui": {"panels": {"History": "ui/History.tsx"}}`` in plugin.json, with
      ``state`` as its initial state.
    """
    return Panel(title, view=view, tsx=tsx, state=state, width=width, height=height)


# ------------------------------------------------------------------ host dispatch


def _dispatch(params: dict) -> Any:
    """Route a UI event from the app to the surface that owns it (called by the host)."""
    with _surfaces_lock:
        surface = _surfaces.get(str(params.get("id")))
    if surface is None:
        return None
    return surface._event(params)


def _reset() -> None:
    """Forget every surface (the host calls this when the plugin unloads)."""
    with _surfaces_lock:
        _surfaces.clear()
