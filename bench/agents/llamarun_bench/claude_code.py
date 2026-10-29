"""Claude Code (its own harness) driving the sandbox through Cua Driver's MCP server."""

import asyncio
import json
import os
import shutil
import tempfile
import time
from pathlib import Path

from cua_bench.agents import AgentResult, BaseAgent, FailureMode

from .driver import sandbox_driver

TIMEOUT_S = float(os.environ.get("BENCH_TASK_TIMEOUT", "900"))
# The same note Llama Run's runner adds (bench/llamarun-agent.ts BENCH_NOTE).
BENCH_NOTE = "Do this on the computer now, without asking questions: nobody can answer. When it is done, reply with a short summary."


class ClaudeCodeAgent(BaseAgent):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.model = kwargs.get("model") or "claude-sonnet-5-5"
        self.max_steps = int(kwargs.get("max_steps") or 50)

    @staticmethod
    def name() -> str:
        return "claude-code"

    async def perform_task(self, task_description, session, logging_dir: Path | None = None, **kwargs) -> AgentResult:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        out_dir = Path(logging_dir or Path.cwd())
        out_dir.mkdir(parents=True, exist_ok=True)
        home = Path(tempfile.mkdtemp(prefix="claude-bench-"))
        try:
            async with sandbox_driver(session) as (url, token):
                config = home / "mcp.json"
                config.write_text(json.dumps({"mcpServers": {"cua": {"type": "http", "url": url, "headers": {"Authorization": f"Bearer {token}"}}}}))
                # A clean environment: its own HOME, only the API key, none of the host session's settings.
                env = {"PATH": os.environ["PATH"], "HOME": str(home), "ANTHROPIC_API_KEY": os.environ["ANTHROPIC_API_KEY"], "DISABLE_TELEMETRY": "1"}
                for key in ("HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"):
                    if key in os.environ:
                        env[key] = os.environ[key]
                started = time.monotonic()
                proc = await asyncio.create_subprocess_exec(
                    "claude", "-p", f"{task_description}\n\n{BENCH_NOTE}", "--model", self.model,
                    "--mcp-config", str(config), "--strict-mcp-config", "--tools", "", "--allowedTools", "mcp__cua",
                    "--max-turns", str(self.max_steps), "--output-format", "json", "--no-session-persistence",
                    cwd=str(home), env=env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                )
                try:
                    stdout, stderr = await asyncio.wait_for(proc.communicate(), TIMEOUT_S)
                except asyncio.TimeoutError:
                    proc.kill()
                    return AgentResult(total_input_tokens=0, total_output_tokens=0, failure_mode=FailureMode.UNKNOWN)
                wall = time.monotonic() - started
        finally:
            shutil.rmtree(home, ignore_errors=True)
        try:
            result = json.loads(stdout.decode())
        except json.JSONDecodeError:
            result = {"error": (stdout + stderr).decode(errors="replace")[-2000:]}
        result.update({"harness": "claude-code", "model": self.model, "task": task_description, "wallMs": round(wall * 1000)})
        (out_dir / "claude-code.json").write_text(json.dumps(result, indent=2))
        usage = result.get("usage") or {}
        print(f"claude-code: {result.get('num_turns')} turns in {wall:.1f}s, cost ${result.get('total_cost_usd')}")
        return AgentResult(
            total_input_tokens=int(usage.get("input_tokens", 0)) + int(usage.get("cache_read_input_tokens", 0)) + int(usage.get("cache_creation_input_tokens", 0)),
            total_output_tokens=int(usage.get("output_tokens", 0)),
            failure_mode=FailureMode.UNKNOWN if result.get("is_error") or "error" in result else FailureMode.NONE,
        )
