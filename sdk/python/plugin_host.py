"""LlamaRun plugin host: runs exactly one plugin in its own process.

Launched by the Electron app with the bundled interpreter::

    python -I -X utf8 -B -u plugin_host.py --plugin <folder> --data <PluginData/module>
        [--grants network,llm,...] [--debug]

Speaks newline-delimited JSON-RPC 2.0 over stdin/stdout. Requests go both
ways: the app asks the host to load the plugin and dispatch events, and
plugin code asks the app for models, MCP tools, UI and other plugins.

Before the plugin is imported, :mod:`llamarun._sandbox` installs an audit hook
enforcing the permissions the user granted (unless the plugin is a legacy
"unrestricted" one). ``sys.stdout`` is redirected to stderr so a stray
``print()`` cannot corrupt the protocol stream.
"""

from __future__ import annotations

import os
import sys

# -I leaves the script's own folder off sys.path; the SDK lives next to it.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import argparse  # noqa: E402
import concurrent.futures  # noqa: E402
import importlib  # noqa: E402
import json  # noqa: E402
import re  # noqa: E402
import tempfile  # noqa: E402
import threading  # noqa: E402
import traceback  # noqa: E402
from dataclasses import asdict  # noqa: E402
from pathlib import Path  # noqa: E402
from typing import Any, Callable, Dict, List, Optional  # noqa: E402

import llamarun  # noqa: E402
from llamarun import _rpc, _sandbox, app, chats, events, settings, ui  # noqa: E402
from llamarun.types import TextGenerationContext, TextGenerationResult  # noqa: E402

IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
REQUIRED_FIELDS = ("name", "description", "version", "author", "sdk_version")


# --------------------------------------------------------------------------- RPC


class RpcError(Exception):
    def __init__(self, message: str, code: int = -32000):
        super().__init__(message)
        self.code = code


class JsonRpcPeer:
    """Bidirectional JSON-RPC over a pair of text streams.

    The reader loop runs on the calling thread; incoming requests are handled
    on a thread pool so that a handler can itself make (blocking) outgoing
    requests without deadlocking the reader.
    """

    def __init__(self, reader, writer, handlers: Dict[str, Callable[[dict], Any]]):
        self._reader = reader
        self._writer = writer
        self._handlers = handlers
        self._write_lock = threading.Lock()
        self._pending: Dict[int, concurrent.futures.Future] = {}
        self._pending_lock = threading.Lock()
        self._next_id = 0
        self._pool = concurrent.futures.ThreadPoolExecutor(max_workers=16, thread_name_prefix="llamarun")
        self.closed = threading.Event()

    def _send(self, message: dict) -> None:
        data = json.dumps(message, ensure_ascii=False, default=str)
        with self._write_lock:
            self._writer.write(data + "\n")
            self._writer.flush()

    def request(self, method: str, params: dict, timeout: Optional[float] = None) -> Any:
        if self.closed.is_set():
            raise RpcError("host connection closed")
        with self._pending_lock:
            self._next_id += 1
            msg_id = self._next_id
            future: concurrent.futures.Future = concurrent.futures.Future()
            self._pending[msg_id] = future
        self._send({"jsonrpc": "2.0", "id": msg_id, "method": method, "params": params})
        try:
            return future.result(timeout=timeout)
        finally:
            with self._pending_lock:
                self._pending.pop(msg_id, None)

    def notify(self, method: str, params: dict) -> None:
        if not self.closed.is_set():
            self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def serve_forever(self) -> None:
        try:
            for line in self._reader:
                line = line.strip()
                if not line:
                    continue
                try:
                    message = json.loads(line)
                except ValueError:
                    continue
                if "method" in message:
                    self._pool.submit(self._handle_request, message)
                else:
                    self._handle_response(message)
        finally:
            self.closed.set()
            with self._pending_lock:
                for future in self._pending.values():
                    if not future.done():
                        future.set_exception(RpcError("host connection closed"))
            self._pool.shutdown(wait=False, cancel_futures=True)

    def _handle_response(self, message: dict) -> None:
        with self._pending_lock:
            future = self._pending.get(message.get("id"))
        if future is None or future.done():
            return
        if "error" in message and message["error"] is not None:
            err = message["error"]
            future.set_exception(llamarun.PluginError(err.get("message", "host error")))
        else:
            future.set_result(message.get("result"))

    def _handle_request(self, message: dict) -> None:
        msg_id = message.get("id")
        handler = self._handlers.get(message["method"])
        try:
            if handler is None:
                raise RpcError(f"method not found: {message['method']}", -32601)
            result = handler(message.get("params") or {})
            response = {"jsonrpc": "2.0", "id": msg_id, "result": result}
        except Exception as exc:  # report every failure to the caller
            code = exc.code if isinstance(exc, RpcError) else -32000
            response = {
                "jsonrpc": "2.0",
                "id": msg_id,
                "error": {"code": code, "message": str(exc), "data": traceback.format_exc()},
            }
        if msg_id is not None:
            self._send(response)


# ---------------------------------------------------------------------- manifest


class ManifestError(Exception):
    pass


def parse_manifest(folder: Path) -> dict:
    """Validate ``plugin.json`` and return it, raising ManifestError with a precise message.

    The app validates manifests too (it needs the permissions before starting
    the process); this keeps the host usable on its own, e.g. in tests.
    """
    path = folder / "plugin.json"
    if not path.is_file():
        raise ManifestError("plugin.json not found")
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except ValueError as exc:
        raise ManifestError(f"plugin.json is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ManifestError("plugin.json must contain a JSON object")
    for key in REQUIRED_FIELDS:
        if not isinstance(data.get(key), str) or not data[key].strip():
            raise ManifestError(f'plugin.json: "{key}" is required and must be a non-empty string')
    entry = data.get("entry")
    if not isinstance(entry, dict):
        raise ManifestError('plugin.json: "entry" is required and must be an object with "module" and "class"')
    for key in ("module", "class"):
        value = entry.get(key)
        if not isinstance(value, str) or not IDENTIFIER.match(value):
            raise ManifestError(f'plugin.json: "entry.{key}" must be a valid Python identifier')
    actions = data.get("actions", {})
    if not isinstance(actions, dict) or not all(
        isinstance(k, str) and isinstance(v, str) and IDENTIFIER.match(v) for k, v in actions.items()
    ):
        raise ManifestError('plugin.json: "actions" must map event names to method names')
    check_sdk_version(data["sdk_version"])
    return data


def check_sdk_version(wanted: str, host: str = llamarun.__version__) -> None:
    """Compatible when majors match and the plugin's minor is not newer than the host's."""
    try:
        w_major, w_minor = (int(p) for p in wanted.split(".")[:2])
        h_major, h_minor = (int(p) for p in host.split(".")[:2])
    except ValueError as exc:
        raise ManifestError(f'plugin.json: "sdk_version" must look like "1.1", got {wanted!r}') from exc
    if w_major != h_major or w_minor > h_minor:
        raise ManifestError(f"plugin targets SDK {wanted}, but this LlamaRun provides SDK {host}")


# ------------------------------------------------------------------------ plugin

HOOKS = {
    "before_text_generation": "on_before_text_generation",
    "after_text_generation": "on_after_text_generation",
}


class PluginRunner:
    """Loads one plugin and dispatches events to it."""

    def __init__(self, folder: Path, data_dir: Path, grants=frozenset({"unrestricted"}), debug: bool = False,
                 log: Optional[Callable[[str, str], None]] = None):
        self.folder = folder
        self.data_dir = data_dir
        self.grants = frozenset(grants)
        self.debug = debug
        self.manifest: dict = {}
        self.instance: Optional[llamarun.Plugin] = None
        self.error: Optional[str] = None
        self.services: Dict[str, str] = {}
        self._lock = threading.RLock()
        self._log = log or (lambda level, msg: print(f"[{level}] {msg}", file=sys.stderr))

    @property
    def name(self) -> str:
        return self.manifest.get("name") or self.folder.name

    @property
    def module(self) -> str:
        return (self.manifest.get("entry") or {}).get("module") or self.folder.name

    def context(self) -> _rpc.PluginContext:
        return _rpc.PluginContext(module=self.module, name=self.name, data_dir=self.data_dir, debug=self.debug,
                                  grants=self.grants, folder=self.folder)

    def info(self) -> dict:
        inst = self.instance
        hooks = []
        if inst is not None:
            for hook, method in HOOKS.items():
                if getattr(type(inst), method, None) is not getattr(llamarun.Plugin, method):
                    hooks.append(hook)
        return {
            "module": self.module,
            "name": self.name,
            "loaded": inst is not None,
            "error": self.error,
            "hooks": hooks,
            "services": sorted(self.services),
            "subscriptions": [t for t in events.topics() if not t.startswith("$")],
            "pythonVersion": sys.version.split()[0],
            "sdkVersion": llamarun.__version__,
        }

    def _report(self, where: str) -> str:
        detail = traceback.format_exc() if self.debug else str(sys.exc_info()[1])
        message = f"{where} failed: {detail}".rstrip()
        self._log("error", message)
        from llamarun import app as _app

        _app._write_log(self.data_dir / "debug.log", message)
        return str(sys.exc_info()[1])

    # -- lifecycle

    def load(self) -> dict:
        with self._lock:
            if self.instance is not None:
                return self.info()
            try:
                self.manifest = parse_manifest(self.folder)
            except ManifestError as exc:
                self.error = str(exc)
                return self.info()
            _rpc.set_default_plugin(self.context())
            for extra in (self.folder / ".deps", self.folder):
                if extra.is_dir() and str(extra) not in sys.path:
                    sys.path.insert(0, str(extra))
            try:
                module = importlib.import_module(self.module)
            except Exception:
                self.error = f'could not import "{self.module}": {self._report("import")}'
                return self.info()
            class_name = self.manifest["entry"]["class"]
            cls = getattr(module, class_name, None)
            if cls is None:
                self.error = f'class "{class_name}" not found in module "{self.module}"'
                return self.info()
            if not (isinstance(cls, type) and issubclass(cls, llamarun.Plugin)):
                self.error = f'"{class_name}" must subclass llamarun.Plugin'
                return self.info()
            try:
                instance = cls()
            except Exception:
                self.error = f"constructor failed: {self._report('__init__')}"
                return self.info()
            self._bind(instance)
            self.instance = instance
            self.error = None
            try:
                instance.on_load()
            except Exception:
                self._report("on_load")
            events._sync()
            return self.info()

    def _bind(self, instance: llamarun.Plugin) -> None:
        """Collect @expose methods, @events.subscribe and @settings.on_change handlers."""
        self.services = {}
        for attr_name in dir(type(instance)):
            attr = getattr(type(instance), attr_name, None)
            exposed = getattr(attr, "__llamarun_expose__", None)
            if exposed:
                self.services[str(exposed)] = attr_name
            if getattr(attr, "__llamarun_settings_listener__", False):
                settings._add_listener(getattr(instance, attr_name))
        events._bind_methods(instance)

    def unload(self) -> None:
        with self._lock:
            if self.instance is not None:
                try:
                    self.instance.on_unload()
                except Exception:
                    self._report("on_unload")
            self.instance = None
            for surface in list(ui._surfaces.values()):
                try:
                    surface.close()
                except Exception:
                    pass
            ui._reset()
            events._reset()
            settings._reset()

    # -- events

    def before_text_generation(self, input_text: str, model: str) -> Optional[dict]:
        if self.instance is None:
            return None
        ctx = TextGenerationContext(input_text=input_text, model=model)
        try:
            returned = self.instance.on_before_text_generation(ctx)
        except Exception:
            self._report("on_before_text_generation")
            return None
        if returned is None:
            return None
        if not isinstance(returned, TextGenerationContext):
            self._log("warning", f"on_before_text_generation returned {type(returned).__name__}; ignored")
            return None
        return asdict(returned)

    def after_text_generation(self, input_text: str, response_text: str, model: str) -> Optional[dict]:
        if self.instance is None:
            return None
        result = TextGenerationResult(input_text=input_text, response_text=response_text, model=model)
        try:
            returned = self.instance.on_after_text_generation(result)
        except Exception:
            self._report("on_after_text_generation")
            return None
        if returned is None:
            return None
        if not isinstance(returned, TextGenerationResult):
            self._log("warning", f"on_after_text_generation returned {type(returned).__name__}; ignored")
            return None
        return asdict(returned)

    def custom(self, action: str) -> bool:
        if self.instance is None:
            raise RpcError(f"{self.name} is not loaded")
        method = (self.manifest.get("actions") or {}).get(action)
        if not method:
            raise RpcError(f'{self.name} has no action "{action}"')
        try:
            getattr(self.instance, method)()
        except Exception as exc:
            self._report(f"action {action}")
            raise RpcError(f"{action} failed: {exc}") from exc
        return True

    def call_service(self, method: str, args: List[Any], kwargs: Dict[str, Any]) -> Any:
        if self.instance is None:
            raise RpcError(f"{self.name} is not loaded")
        attr = self.services.get(method)
        if attr is None:
            raise RpcError(f'{self.module} does not expose "{method}" (mark it with @llamarun.expose)')
        return getattr(self.instance, attr)(*args, **kwargs)

    def ui_event(self, params: dict) -> Any:
        try:
            return ui._dispatch(params)
        except Exception as exc:
            self._report(f"UI event {params.get('event')}")
            if self.debug:
                ui.toast(f"{self.name}: {exc}", kind="error", description=traceback.format_exc(limit=3))
            raise


# -------------------------------------------------------------------------- main


def claim_stdio():
    """Take the JSON-RPC pipes off file descriptors 0 and 1 and return them as text streams.

    Afterwards fd 0 is the null device and fd 1 writes to stderr. This matters
    for two reasons:

    * On Windows the C runtime holds a per-descriptor lock for as long as a
      read is pending, and the reader loop is almost always waiting. Native
      code that touches fd 0 (loading numpy does) would block until the app
      happened to send the next message, so a plugin importing such a
      library on a background thread stalled.
    * Native code that prints to stdout can't corrupt the protocol stream.
    """
    in_fd, out_fd = os.dup(0), os.dup(1)
    null = os.open(os.devnull, os.O_RDONLY)
    os.dup2(null, 0)
    os.close(null)
    os.dup2(2, 1)
    sys.stdout = sys.stderr  # keep print() away from the protocol stream
    protocol_in = open(in_fd, "r", encoding="utf-8", newline="\n")
    protocol_out = open(out_fd, "w", encoding="utf-8", newline="\n")
    return protocol_in, protocol_out


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plugin", required=True, help="plugin folder")
    parser.add_argument("--data", required=True, help="this plugin's data folder (PluginData/<module>)")
    parser.add_argument("--grants", default="unrestricted", help="comma-separated granted permissions")
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args(argv)

    folder = Path(args.plugin).resolve()
    data_dir = Path(args.data).resolve()
    grants = frozenset(g for g in args.grants.split(",") if g)
    tmp = data_dir / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    tempfile.tempdir = str(tmp)
    sys.dont_write_bytecode = True

    protocol_in, protocol_out = claim_stdio()
    peer: Optional[JsonRpcPeer] = None

    def log(level: str, message: str) -> None:
        if peer is not None:
            peer.notify("app.log", {"level": level, "message": message, "plugin": runner.name})
        else:
            print(f"[{level}] {message}", file=sys.stderr)

    runner = PluginRunner(folder, data_dir, grants, debug=args.debug, log=log)
    _rpc.set_default_plugin(runner.context())

    handlers: Dict[str, Callable[[dict], Any]] = {
        "ping": lambda p: {"python_version": sys.version.split()[0], "sdk_version": llamarun.__version__},
        "plugin.load": lambda p: runner.load(),
        "plugin.info": lambda p: runner.info(),
        "plugin.unload": lambda p: runner.unload(),
        "events.before_text_generation": lambda p: runner.before_text_generation(p["input_text"], p.get("model", "")),
        "events.after_text_generation": lambda p: runner.after_text_generation(
            p["input_text"], p["response_text"], p.get("model", "")
        ),
        "events.custom": lambda p: runner.custom(p["action"]),
        "events.deliver": lambda p: events._deliver(p["topic"], p.get("data"), p.get("source", "")),
        "services.call": lambda p: runner.call_service(p["method"], p.get("args") or [], p.get("kwargs") or {}),
        "settings.changed": lambda p: list(settings._apply(p.get("values") or {})),
        "ui.event": runner.ui_event,
        # Notifications from the app: streamed chat replies and global shortcuts.
        "chats.stream": lambda p: chats._deliver(p),
        "app.shortcut": lambda p: app._shortcut_pressed(p),
    }
    peer = JsonRpcPeer(protocol_in, protocol_out, handlers)
    _rpc.set_transport(lambda method, params: peer.request(method, params), peer.notify)

    # ctypes loads kernel32 while it is imported. Import it now, so plugins (and the
    # many libraries that import ctypes "just in case") can still import it; the
    # sandbox then blocks loading libraries and calling foreign functions.
    import ctypes  # noqa: F401

    # From here on the plugin's permissions apply, to the plugin and to the host alike.
    _sandbox.install(
        grants,
        read_roots=[folder, _HERE, data_dir],
        write_roots=[data_dir, tmp],
        on_blocked=lambda permission, what: peer.notify(
            "sandbox.blocked", {"permission": permission, "detail": what}
        ),
    )
    peer.notify("host.ready", {"python_version": sys.version.split()[0], "sdk_version": llamarun.__version__})
    peer.serve_forever()
    runner.unload()
    return 0


if __name__ == "__main__":
    sys.exit(main())
