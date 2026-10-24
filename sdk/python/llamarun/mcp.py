"""Access to the MCP (Model Context Protocol) tools configured in LlamaRun."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from . import _rpc


@dataclass
class McpToolInfo:
    name: str
    description: str
    server: str
    input_schema: Dict[str, Any] = field(default_factory=dict)


def list_tools() -> List[McpToolInfo]:
    """Return every tool exposed by the connected MCP servers."""
    tools = _rpc.call("mcp.list_tools") or []
    return [
        McpToolInfo(
            name=t.get("name", ""),
            description=t.get("description", ""),
            server=t.get("server", ""),
            input_schema=t.get("inputSchema") or {},
        )
        for t in tools
    ]


def call_tool(tool_name: str, arguments: Dict[str, Any]) -> Any:
    """Call an MCP tool and return its result.

    The result is a dict ``{"content": [...], "isError": bool}`` following the
    MCP ``CallToolResult`` shape; text parts are ``{"type": "text", "text": ...}``.
    """
    return _rpc.call("mcp.call_tool", {"name": tool_name, "arguments": dict(arguments or {})})


# ---------------------------------------------------------- servers (SDK 1.3)


@dataclass
class McpServer:
    """An MCP server configured in LlamaRun, and how its connection is doing."""

    name: str
    state: str
    """``connecting``, ``connected`` or ``error``."""
    tool_count: int = 0
    error: str = ""
    command: str = ""
    url: str = ""


@dataclass
class DirectoryServer:
    """An entry in the MCP directory (Settings → MCP → Browse)."""

    id: str
    name: str
    description: str
    category: str = ""
    author: str = ""
    verified: bool = False
    requires_auth: bool = False
    tags: List[str] = field(default_factory=list)
    features: List[str] = field(default_factory=list)
    documentation_url: str = ""
    repository_url: str = ""
    long_description: str = ""
    config: Dict[str, Any] = field(default_factory=dict)
    """How LlamaRun would run it: ``command``, ``args``, ``env`` (names and placeholder values) or ``url``."""
    installed: bool = False
    """A server with this name is already configured."""


@dataclass
class DirectoryPage:
    servers: List[DirectoryServer]
    next_cursor: Optional[str] = None


def _directory_server(d: Dict[str, Any]) -> DirectoryServer:
    return DirectoryServer(
        id=str(d.get("id", "")),
        name=str(d.get("name", "")),
        description=str(d.get("description") or ""),
        category=str(d.get("category") or ""),
        author=str(d.get("author") or ""),
        verified=bool(d.get("verified")),
        requires_auth=bool(d.get("requiresAuth")),
        tags=list(d.get("tags") or []),
        features=list(d.get("features") or []),
        documentation_url=str(d.get("documentationUrl") or ""),
        repository_url=str(d.get("repositoryUrl") or ""),
        long_description=str(d.get("longDescription") or ""),
        config=dict(d.get("config") or {}),
        installed=bool(d.get("installed")),
    )


def _server(s: Dict[str, Any]) -> McpServer:
    return McpServer(
        name=str(s.get("name", "")),
        state=str(s.get("state", "")),
        tool_count=int(s.get("toolCount") or 0),
        error=str(s.get("error") or ""),
        command=str(s.get("command") or ""),
        url=str(s.get("url") or ""),
    )


def search_directory(query: str = "", cursor: Optional[str] = None) -> DirectoryPage:
    """Search the MCP directory. Needs the ``install`` or ``mcp`` permission.

    Pass ``next_cursor`` from a page to get the next one.
    """
    page = _rpc.call("mcp.directory.search", {"search": query, "cursor": cursor}) or {}
    return DirectoryPage([_directory_server(s) for s in page.get("servers") or []], page.get("nextCursor"))


def get_directory_server(server_id: str) -> DirectoryServer:
    """Full details of one directory entry, including how it would be run."""
    return _directory_server(_rpc.call("mcp.directory.get", {"id": server_id}) or {})


def list_servers() -> List[McpServer]:
    """The MCP servers the user has configured. Needs the ``install`` or ``mcp`` permission."""
    return [_server(s) for s in _rpc.call("mcp.list_servers") or []]


def add_server(
    name: Optional[str] = None,
    *,
    directory_id: Optional[str] = None,
    command: Optional[str] = None,
    args: Optional[List[str]] = None,
    env: Optional[Dict[str, str]] = None,
    url: Optional[str] = None,
    reason: str = "",
) -> Optional[McpServer]:
    """Ask the user to add an MCP server. Needs the ``install`` permission.

    Give either ``directory_id`` (an MCP directory entry) or a ``command`` (with
    ``args``) or ``url``. LlamaRun shows the user exactly what will run, with
    ``reason`` as the explanation, and lets them fill in the environment
    variables (API keys and so on) themselves. Blocks until they answer.

    Returns the server once it has tried to connect (check ``state`` and
    ``error``), or None if the user said no.
    """
    params: Dict[str, Any] = {"name": name, "directory_id": directory_id, "command": command, "args": list(args or []),
                              "env": dict(env or {}), "url": url, "reason": reason}
    result = _rpc.call("mcp.add_server", {k: v for k, v in params.items() if v is not None})
    return _server(result) if result else None
