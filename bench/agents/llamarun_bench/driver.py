"""Starts Cua Driver inside a benchmark sandbox and tunnels its MCP endpoint here."""

import os
import secrets
import shlex
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

BENCH = Path(__file__).resolve().parents[2]
# The Linux cua-driver binary from the cua-driver wheel (bench/setup.sh fetches it).
DRIVER_BIN = Path(os.environ.get("CUA_DRIVER_BIN", BENCH / ".cache" / "cua-driver"))
PORT = 8765


@asynccontextmanager
async def sandbox_driver(session) -> AsyncIterator[tuple[str, str]]:
    """Yields (mcp_url, bearer_token) for Cua Driver running in `session`'s desktop.

    The bench images have the desktop's accessibility bus but no cua-driver,
    so the binary is copied in and started with the desktop session's
    environment (its display, D-Bus session and accessibility bus).
    """
    sh = lambda command: session.run_command(command, check=False, timeout=120)
    await session.write_bytes("/tmp/cua-driver", DRIVER_BIN.read_bytes())
    env = (await sh("tr '\\0' '\\n' < /proc/$(pgrep -f at-spi-bus-launcher | head -1)/environ | grep -E '^(DBUS|DISPLAY|XDG|HOME|USER)='"))["stdout"]
    exports = " ".join(f"export {shlex.quote(line)};" for line in env.splitlines() if line)
    token = secrets.token_hex(24)
    started = await sh(
        f"chmod +x /tmp/cua-driver; {exports} export CUA_DRIVER_RS_MCP_HTTP_PORT={PORT} CUA_DRIVER_RS_MCP_HTTP_TOKEN={token};"
        " /tmp/cua-driver telemetry disable >/dev/null 2>&1;"
        " nohup /tmp/cua-driver serve > /tmp/cua-driver.log 2>&1 &"
        f" for i in $(seq 1 50); do (ss -ltn 2>/dev/null || netstat -ltn) | grep -q ':{PORT} ' && break; sleep 0.2; done;"
        f" (ss -ltn 2>/dev/null || netstat -ltn) | grep -q ':{PORT} ' && echo up || tail -5 /tmp/cua-driver.log"
    )
    if "up" not in started["stdout"]:
        raise RuntimeError(f"cua-driver did not start in the sandbox: {started['stdout']}")
    async with session.sandbox.tunnel.forward(PORT) as tunnel:
        yield tunnel.url.rstrip("/") + "/mcp", token
