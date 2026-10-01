"""Access to the MCP (Model Context Protocol) tools configured in LlamaRun."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

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
