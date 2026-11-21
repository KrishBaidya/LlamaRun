"""LSP Diagnostics, like OpenCode's: errors a language server finds after an edit.

After edit_file or write_file changes a code file, the matching language
server (one you have on PATH) opens it and reports diagnostics; the errors go
under the tool result so the model sees and fixes them. One server per
language and project folder stays running while the plugin is loaded.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import llamarun

#: extension -> (language id, server commands to try)
SERVERS: Dict[str, Tuple[str, List[List[str]]]] = {
    ".ts": ("typescript", [["typescript-language-server", "--stdio"]]),
    ".tsx": ("typescriptreact", [["typescript-language-server", "--stdio"]]),
    ".js": ("javascript", [["typescript-language-server", "--stdio"]]),
    ".jsx": ("javascriptreact", [["typescript-language-server", "--stdio"]]),
    ".py": ("python", [["pyright-langserver", "--stdio"], ["basedpyright-langserver", "--stdio"], ["pylsp"]]),
    ".rs": ("rust", [["rust-analyzer"]]),
    ".go": ("go", [["gopls"]]),
}
ROOT_MARKERS = ("package.json", "tsconfig.json", "pyproject.toml", "setup.py", "Cargo.toml", "go.mod", ".git")
WAIT_SECONDS = 8
MAX_REPORTED = 20


def project_root(path: Path) -> Path:
    for parent in [path.parent, *path.parents]:
        if any((parent / m).exists() for m in ROOT_MARKERS):
            return parent
    return path.parent


def find_server(ext: str) -> Optional[List[str]]:
    entry = SERVERS.get(ext)
    if not entry:
        return None
    for cmd in entry[1]:
        exe = shutil.which(cmd[0])
        if exe:
            return [exe, *cmd[1:]]
    return None


def format_diagnostics(path: str, items: List[dict]) -> str:
    errors = [d for d in items if d.get("severity", 1) == 1]
    if not errors:
        return ""
    lines = []
    for d in errors[:MAX_REPORTED]:
        start = d.get("range", {}).get("start", {})
        lines.append(f"{Path(path).name}:{start.get('line', 0) + 1}:{start.get('character', 0) + 1}: {d.get('message', '').splitlines()[0]}")
    more = f" (and {len(errors) - MAX_REPORTED} more)" if len(errors) > MAX_REPORTED else ""
    return f"Language server found {len(errors)} error(s){more}:\n" + "\n".join(lines)


class Server:
    """A language server over stdio (JSON-RPC with Content-Length framing)."""

    def __init__(self, cmd: List[str], root: Path):
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=str(root),
                                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        self.seq = 0
        self.lock = threading.Lock()
        self.diagnostics: Dict[str, List[dict]] = {}
        self.updated: Dict[str, float] = {}
        self.versions: Dict[str, int] = {}
        self.pending: Dict[int, threading.Event] = {}
        threading.Thread(target=self._read, daemon=True).start()
        self.request("initialize", {"processId": os.getpid(), "rootUri": root.as_uri(), "capabilities": {"textDocument": {"publishDiagnostics": {}}}}, timeout=20)
        self.notify("initialized", {})

    def _send(self, msg: dict) -> None:
        body = json.dumps(msg).encode("utf-8")
        with self.lock:
            self.proc.stdin.write(f"Content-Length: {len(body)}\r\n\r\n".encode() + body)
            self.proc.stdin.flush()

    def notify(self, method: str, params: dict) -> None:
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def request(self, method: str, params: dict, timeout: float = 10) -> None:
        self.seq += 1
        done = threading.Event()
        self.pending[self.seq] = done
        self._send({"jsonrpc": "2.0", "id": self.seq, "method": method, "params": params})
        done.wait(timeout)

    def _read(self) -> None:
        out = self.proc.stdout
        while True:
            length = 0
            while True:
                line = out.readline()
                if not line:
                    return
                line = line.strip()
                if not line:
                    break
                if line.lower().startswith(b"content-length:"):
                    length = int(line.split(b":")[1])
            msg = json.loads(out.read(length) or b"{}")
            if "id" in msg and msg["id"] in self.pending:
                self.pending.pop(msg["id"]).set()
            elif msg.get("method") == "textDocument/publishDiagnostics":
                params = msg.get("params", {})
                self.diagnostics[params.get("uri", "")] = params.get("diagnostics", [])
                self.updated[params.get("uri", "")] = time.time()
            elif "id" in msg and "method" in msg:
                # Requests from the server (workspace/configuration and the like): answer with nothing.
                self._send({"jsonrpc": "2.0", "id": msg["id"], "result": None})

    def check(self, path: Path, language: str) -> List[dict]:
        uri = path.as_uri()
        text = path.read_text(encoding="utf-8", errors="replace")
        version = self.versions.get(uri, 0) + 1
        self.versions[uri] = version
        asked = time.time()
        if version == 1:
            self.notify("textDocument/didOpen", {"textDocument": {"uri": uri, "languageId": language, "version": version, "text": text}})
        else:
            self.notify("textDocument/didChange", {"textDocument": {"uri": uri, "version": version}, "contentChanges": [{"text": text}]})
        deadline = asked + WAIT_SECONDS
        while time.time() < deadline:
            if self.updated.get(uri, 0) >= asked:
                # Servers often send twice (syntax, then types); give the second a moment.
                time.sleep(0.6)
                break
            time.sleep(0.1)
        return self.diagnostics.get(uri, [])

    def close(self) -> None:
        try:
            self.proc.kill()
        except Exception:
            pass


class LspDiagnostics(llamarun.Plugin):
    def on_load(self) -> None:
        self.servers: Dict[Tuple[str, str], Server] = {}
        self.missing: set = set()

    def on_unload(self) -> None:
        for s in self.servers.values():
            s.close()
        self.servers.clear()

    def on_after_tool_call(self, result: llamarun.ToolCallResult) -> Optional[str]:
        if result.tool not in ("edit_file", "write_file") or result.is_error:
            return None
        raw = str(result.arguments.get("path", ""))
        # The result names the absolute path ("Edited C:\\...\\a.ts" / "Wrote N bytes to C:\\...").
        path = Path(raw)
        if not path.is_absolute():
            for word in result.result.replace("(", " ").split():
                if word.lower().endswith(path.suffix.lower()) and Path(word).is_absolute():
                    path = Path(word)
                    break
        if not path.is_absolute() or not path.exists():
            return None
        ext = path.suffix.lower()
        cmd = find_server(ext)
        if not cmd:
            return None
        root = project_root(path)
        key = (cmd[0], str(root))
        try:
            server = self.servers.get(key)
            if server is None or server.proc.poll() is not None:
                server = Server(cmd, root)
                self.servers[key] = server
            return format_diagnostics(str(path), server.check(path, SERVERS[ext][0])) or None
        except Exception as exc:  # noqa: BLE001 - a broken server must not break the chat
            llamarun.app.log("warning", f"{cmd[0]}: {exc}")
            return None
