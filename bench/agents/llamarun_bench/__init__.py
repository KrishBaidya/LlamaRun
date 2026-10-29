"""Cua Bench agents comparing Llama Run's computer-use harness with Claude Code.

Both drive the benchmark sandbox through the same tool server: Cua Driver
running inside the sandbox, its MCP endpoint tunnelled to this machine.
"""

from .claude_code import ClaudeCodeAgent
from .llamarun import LlamaRunAgent

__all__ = ["ClaudeCodeAgent", "LlamaRunAgent"]
