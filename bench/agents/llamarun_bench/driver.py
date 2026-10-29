"""Starts Cua Driver inside a benchmark sandbox and tunnels its MCP server here."""

import os
import secrets
import shlex
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

BENCH = Path(__file__).resolve().parents[2]
# The Linux cua-driver binary from the cua-driver wheel (bench/setup.sh fetches it).
DRIVER_BIN = Path(os.environ.get("CUA_DRIVER_BIN", BENCH / ".cache" / "cua-driver"))
# Host side of the tunnel: speaks MCP over stdio, so agents run it as an MCP server command.
TCP_BRIDGE = BENCH / "mcp-tcp.mjs"
PORT = 8765

# Runs `cua-driver mcp` (stdio) for one connection that starts with the token line.
# Not `cua-driver serve`: its HTTP endpoint makes every request a new driver session, so a
# screenshot taken in one call "belongs to another session" in the next and pixel actions
# (drag, x/y clicks) always fail. The app keeps one driver for its lifetime; so does this.
SANDBOX_BRIDGE = r"""
import os, socket, subprocess, sys, threading
port, token = int(sys.argv[1]), sys.argv[2].encode()
srv = socket.create_server(("127.0.0.1", port))
while True:
    conn, _ = srv.accept()
    line = b""
    while not line.endswith(b"\n") and len(line) < 256:
        byte = conn.recv(1)
        if not byte:
            break
        line += byte
    if line.strip() == token:
        break
    conn.close()
driver = subprocess.Popen(["/tmp/cua-driver", "mcp"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=open("/tmp/cua-driver.log", "ab"), bufsize=0)

def to_driver():
    while chunk := conn.recv(65536):
        driver.stdin.write(chunk)
    driver.stdin.close()

threading.Thread(target=to_driver, daemon=True).start()
while chunk := os.read(driver.stdout.fileno(), 65536):
    conn.sendall(chunk)
"""


@asynccontextmanager
async def sandbox_driver(session) -> AsyncIterator[tuple[list[str], str]]:
    """Yields (mcp_command, token): the stdio MCP server command reaching Cua Driver in `session`'s desktop.

    The bench images have the desktop's accessibility bus but no cua-driver,
    so the binary is copied in and started with the desktop session's
    environment (its display, D-Bus session and accessibility bus). The
    command needs CUA_MCP_TOKEN set to the token.
    """
    sh = lambda command: session.run_command(command, check=False, timeout=120)
    await session.write_bytes("/tmp/cua-driver", DRIVER_BIN.read_bytes())
    await session.write_bytes("/tmp/mcp-bridge.py", SANDBOX_BRIDGE.encode())
    env = (await sh("tr '\\0' '\\n' < /proc/$(pgrep -f at-spi-bus-launcher | head -1)/environ | grep -E '^(DBUS|DISPLAY|XDG|HOME|USER)='"))["stdout"]
    exports = " ".join(f"export {shlex.quote(line)};" for line in env.splitlines() if line)
    token = secrets.token_hex(24)
    started = await sh(
        f"chmod +x /tmp/cua-driver; {exports}"
        " /tmp/cua-driver telemetry disable >/dev/null 2>&1;"
        f" nohup python3 /tmp/mcp-bridge.py {PORT} {token} > /tmp/mcp-bridge.log 2>&1 &"
        f" for i in $(seq 1 50); do (ss -ltn 2>/dev/null || netstat -ltn) | grep -q ':{PORT} ' && break; sleep 0.2; done;"
        f" (ss -ltn 2>/dev/null || netstat -ltn) | grep -q ':{PORT} ' && echo up || tail -5 /tmp/mcp-bridge.log"
    )
    if "up" not in started["stdout"]:
        raise RuntimeError(f"cua-driver did not start in the sandbox: {started['stdout']}")
    async with session.sandbox.tunnel.forward(PORT) as tunnel:
        yield ["node", str(TCP_BRIDGE), tunnel.host, str(tunnel.port)], token
