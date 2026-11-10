"""Llama Run's own computer-use harness (bench/llamarun-agent.ts) as a Cua Bench agent."""

import asyncio
import json
import os
import time
from pathlib import Path

from cua_bench.agents import AgentResult, BaseAgent, FailureMode

from .driver import BENCH, sandbox_driver

RUNNER = BENCH / "dist" / "llamarun-agent.mjs"
TIMEOUT_S = float(os.environ.get("BENCH_TASK_TIMEOUT", "900"))


class LlamaRunAgent(BaseAgent):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.model = kwargs.get("model") or "gemini-3.8-flash"
        self.max_steps = int(kwargs.get("max_steps") or 50)

    @staticmethod
    def name() -> str:
        return "llamarun"

    async def perform_task(self, task_description, session, logging_dir: Path | None = None, **kwargs) -> AgentResult:
        out_dir = Path(logging_dir or Path.cwd())
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / "llamarun.json"
        async with sandbox_driver(session) as (mcp_command, token):
            started = time.monotonic()
            proc = await asyncio.create_subprocess_exec(
                "node", str(RUNNER), "--task", task_description, "--model", self.model,
                "--mcp-command", json.dumps(mcp_command), "--max-steps", str(self.max_steps), "--out", str(out),
                env={**os.environ, "CUA_MCP_TOKEN": token},
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            )
            try:
                stdout, _ = await asyncio.wait_for(proc.communicate(), TIMEOUT_S)
            except asyncio.TimeoutError:
                proc.kill()
                return AgentResult(total_input_tokens=0, total_output_tokens=0, failure_mode=FailureMode.UNKNOWN)
            print(stdout.decode(errors="replace")[-2000:])
            print(f"llamarun wall time {time.monotonic() - started:.1f}s")
        result = json.loads(out.read_text()) if out.exists() else {"error": "no result"}
        failed = bool(result.get("error"))
        usage = result.get("usage") or {}
        return AgentResult(
            total_input_tokens=int(usage.get("inputTokens", 0)),
            total_output_tokens=int(usage.get("outputTokens", 0)),
            failure_mode=FailureMode.API_ERROR if failed else FailureMode.NONE,
        )
