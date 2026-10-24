"""Tools your models can call, provided by your plugin.

Mark plugin methods with :func:`tool` and, once the user grants the ``tools``
permission, models can call them in chats just like MCP tools::

    class Weather(llamarun.Plugin):
        @llamarun.tool
        def get_forecast(self, city: str, days: int = 3) -> str:
            \"\"\"Weather forecast for a city.

            Args:
                city: City name, e.g. "Paris".
                days: How many days ahead, 1 to 7.
            \"\"\"
            return f"Sunny in {city} for {days} days"

The tool's description and input schema come from the docstring and the type
hints (``str``, ``int``, ``float``, ``bool``, ``list[...]``, ``dict``,
``Optional[...]`` and ``Literal[...]``). Pass ``description=`` or a JSON Schema
``parameters=`` to override them.

The method runs in the plugin's process with the plugin's own permissions.
Whatever it returns is given to the model: a string as is, anything else as
JSON. Raise :class:`ToolError` to tell the model the call failed and why.
"""

from __future__ import annotations

import inspect
import json
import re
import typing
from typing import Any, Callable, Dict, List, Optional, TypeVar, overload

F = TypeVar("F", bound=Callable[..., Any])

NAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
RESULT_LIMIT = 100_000
"""Longer results are cut; the app trims tool output for the model anyway."""


class ToolError(Exception):
    """Raise from a tool to report a failure to the model (it sees the message)."""


@overload
def tool(fn: F) -> F: ...
@overload
def tool(
    *, name: Optional[str] = None, description: Optional[str] = None, parameters: Optional[Dict[str, Any]] = None
) -> Callable[[F], F]: ...


def tool(fn: Optional[F] = None, *, name: Optional[str] = None, description: Optional[str] = None,
         parameters: Optional[Dict[str, Any]] = None):
    """Offer a plugin method to your models as a tool. Needs the ``tools`` permission."""

    def mark(f: F) -> F:
        tool_name = name or f.__name__
        if not NAME_PATTERN.match(tool_name):
            raise ValueError(f"tool name {tool_name!r} must be 1-64 letters, digits, '_' or '-'")
        f.__llamarun_tool__ = {"name": tool_name, "description": description, "parameters": parameters}  # type: ignore[attr-defined]
        return f

    return mark(fn) if fn is not None else mark


# ------------------------------------------------------------------- schemas


def _split_docstring(doc: str) -> tuple:
    """(description, {param: description}) from a Google-style docstring."""
    doc = inspect.cleandoc(doc or "")
    params: Dict[str, str] = {}
    match = re.search(r"^(Args|Arguments|Parameters):\s*$", doc, re.MULTILINE)
    if not match:
        return doc.strip(), params
    summary = doc[: match.start()].strip()
    current = None
    indent = None  # of the parameter lines; deeper lines continue a description
    for line in doc[match.end():].splitlines():
        if not line.strip():
            continue
        if not line.startswith((" ", "\t")):
            break  # the next section ("Returns:" ...)
        depth = len(line) - len(line.lstrip())
        m = re.match(r"^\s+(\w+)\s*(?:\([^)]*\))?\s*:\s*(.*)$", line)
        if m and (indent is None or depth <= indent):
            current, indent = m.group(1), depth
            params[current] = m.group(2).strip()
        elif current:
            params[current] = (params[current] + " " + line.strip()).strip()
    return summary, params


def _schema_for(annotation: Any) -> Dict[str, Any]:
    if annotation is inspect.Parameter.empty or annotation is Any:
        return {}
    origin = typing.get_origin(annotation)
    args = typing.get_args(annotation)
    if origin is typing.Union:
        rest = [a for a in args if a is not type(None)]
        return _schema_for(rest[0]) if len(rest) == 1 else {"anyOf": [_schema_for(a) for a in rest]}
    if origin is typing.Literal:
        values = list(args)
        schema: Dict[str, Any] = {"enum": values}
        kinds = {type(v) for v in values}
        if kinds == {str}:
            schema["type"] = "string"
        elif kinds <= {int}:
            schema["type"] = "integer"
        return schema
    if annotation is str:
        return {"type": "string"}
    if annotation is bool:
        return {"type": "boolean"}
    if annotation is int:
        return {"type": "integer"}
    if annotation is float:
        return {"type": "number"}
    if annotation in (list, tuple) or origin in (list, tuple, typing.List, typing.Sequence):
        item = _schema_for(args[0]) if args else {}
        return {"type": "array", "items": item} if item else {"type": "array"}
    if annotation is dict or origin in (dict, typing.Dict, typing.Mapping):
        return {"type": "object"}
    return {}


def spec(method: Callable[..., Any]) -> Dict[str, Any]:
    """The tool definition sent to the app: name, description and JSON Schema input."""
    meta = getattr(method, "__llamarun_tool__")
    summary, param_docs = _split_docstring(method.__doc__ or "")
    description = meta["description"] or summary or meta["name"].replace("_", " ")
    schema = meta["parameters"]
    if schema is None:
        try:
            hints = typing.get_type_hints(method)
        except Exception:
            hints = {}
        properties: Dict[str, Any] = {}
        required: List[str] = []
        for p in inspect.signature(method).parameters.values():
            if p.name == "self" or p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
                continue
            prop = _schema_for(hints.get(p.name, p.annotation))
            if p.name in param_docs:
                prop["description"] = param_docs[p.name]
            if p.default is not inspect.Parameter.empty and p.default is not None:
                try:
                    json.dumps(p.default)
                    prop["default"] = p.default
                except TypeError:
                    pass
            properties[p.name] = prop
            if p.default is inspect.Parameter.empty:
                required.append(p.name)
        schema = {"type": "object", "properties": properties}
        if required:
            schema["required"] = required
    return {"name": meta["name"], "description": description, "inputSchema": schema}


# ------------------------------------------------------------------- calling


def _text(value: Any) -> str:
    if value is None:
        return "Done."
    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) <= RESULT_LIMIT else text[:RESULT_LIMIT] + "\n…(cut)"


def call(method: Callable[..., Any], arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Runs a bound tool method; returns an MCP-style result for the app."""
    params = inspect.signature(method).parameters
    takes_any = any(p.kind is p.VAR_KEYWORD for p in params.values())
    kwargs = {k: v for k, v in (arguments or {}).items() if takes_any or k in params}
    missing = [n for n, p in params.items()
               if p.default is inspect.Parameter.empty and p.kind not in (p.VAR_POSITIONAL, p.VAR_KEYWORD)
               and n not in kwargs]
    if missing:
        return _result(f"Missing required argument(s): {', '.join(missing)}", error=True)
    try:
        return _result(_text(method(**kwargs)))
    except ToolError as exc:
        return _result(str(exc) or "The tool failed.", error=True)


def _result(text: str, error: bool = False) -> Dict[str, Any]:
    return {"content": [{"type": "text", "text": text}], "isError": error}
