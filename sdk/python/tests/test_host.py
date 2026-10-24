import json
import os
import shutil
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import llamarun  # noqa: E402
from llamarun import _rpc, events, settings, storage, ui  # noqa: E402
from plugin_host import ManifestError, PluginRunner, check_sdk_version, parse_manifest  # noqa: E402

EXAMPLES = ROOT.parents[1] / "examples" / "plugins"


def write_plugin(root: Path, folder: str, module: str, body: str, **manifest) -> Path:
    path = root / folder
    path.mkdir(parents=True)
    data = {
        "name": folder,
        "description": "test",
        "version": "1.0.0",
        "author": "tests",
        "sdk_version": "1.1",
        "entry": {"module": module, "class": "P"},
    }
    data.update(manifest)
    (path / "plugin.json").write_text(json.dumps(data), encoding="utf-8")
    (path / f"{module}.py").write_text(textwrap.dedent(body), encoding="utf-8")
    return path


class FakeApp:
    """Stands in for the Electron side: records calls and notifications."""

    def __init__(self):
        self.calls = []
        self.notes = []
        self.results = {
            "app.get_version": "0.0-test",
            "llm.get_available_models": ["m1"],
            "llm.generate": "generated",
            "mcp.list_tools": [],
        }

    def transport(self, method, params):
        self.calls.append((method, params))
        result = self.results.get(method)
        return result(params) if callable(result) else result

    def notifier(self, method, params):
        self.notes.append((method, json.loads(json.dumps(params))))

    def notes_of(self, method):
        return [p for m, p in self.notes if m == method]


@pytest.fixture
def fake():
    app = FakeApp()
    _rpc.set_transport(app.transport, app.notifier)
    yield app
    _rpc.set_transport(None)
    _rpc.set_default_plugin(None)
    ui._reset()
    events._reset()
    settings._reset()


@pytest.fixture
def load(tmp_path, fake):
    runners = []

    def _load(body, module="mod_x", **manifest):
        folder = write_plugin(tmp_path / "Plugins", module, module, body, **manifest)
        runner = PluginRunner(folder, tmp_path / "Data" / module, debug=True, log=lambda lvl, msg: fake.notes.append(("log", msg)))
        runners.append(runner)
        info = runner.load()
        assert info["loaded"], info["error"]
        return runner

    yield _load
    for r in runners:
        r.unload()
        sys.modules.pop(r.module, None)
        while str(r.folder) in sys.path:
            sys.path.remove(str(r.folder))


# --------------------------------------------------------------------- manifest


def test_sdk_version_rules():
    check_sdk_version("1.0", "1.3")
    with pytest.raises(ManifestError):
        check_sdk_version("1.4", "1.3")
    with pytest.raises(ManifestError):
        check_sdk_version("2.0", "1.3")
    assert llamarun.__version__ == "1.3"


def test_manifest_reports_missing_field(tmp_path):
    folder = tmp_path / "bad"
    folder.mkdir()
    (folder / "plugin.json").write_text(json.dumps({"name": "x"}))
    with pytest.raises(ManifestError, match='"description"'):
        parse_manifest(folder)


# ------------------------------------------------------------------------ hooks


def test_hooks_report_and_rewrite(load):
    runner = load("""
        import llamarun
        class P(llamarun.Plugin):
            def on_before_text_generation(self, ctx):
                if ctx.input_text == "stop":
                    ctx.cancel = True
                    return ctx
                ctx.input_text += "!"
                return ctx
    """)
    assert runner.info()["hooks"] == ["before_text_generation"]
    assert runner.before_text_generation("hi", "m")["input_text"] == "hi!"
    assert runner.before_text_generation("stop", "m")["cancel"] is True
    assert runner.after_text_generation("q", "a", "m") is None


def test_failing_hook_is_skipped(load, fake):
    runner = load("""
        import llamarun
        class P(llamarun.Plugin):
            def on_after_text_generation(self, result):
                raise RuntimeError("boom")
    """)
    assert runner.after_text_generation("q", "a", "m") is None
    assert any("boom" in str(n[1]) for n in fake.notes)


def test_threads_keep_plugin_identity_without_start_thread(load):
    runner = load("""
        import threading
        import llamarun
        from llamarun import app, storage
        class P(llamarun.Plugin):
            def on_load(self):
                self.done = threading.Event()
                threading.Thread(target=self.work, daemon=True).start()
            def work(self):
                storage.set("dir", str(app.get_data_dir()))
                self.done.set()
    """, module="mod_t")
    assert runner.instance.done.wait(5)
    data = json.loads((runner.data_dir / "storage.json").read_text())
    assert data == {"dir": str(runner.data_dir)}


def test_example_prompt_logger(tmp_path, fake):
    shutil.copytree(EXAMPLES / "prompt_logger", tmp_path / "prompt_logger")
    runner = PluginRunner(tmp_path / "prompt_logger", tmp_path / "Data", debug=True, log=lambda *a: None)
    try:
        assert runner.load()["loaded"], runner.error
        assert runner.before_text_generation("/skip this", "m")["cancel"]
        out = runner.before_text_generation("/summarize text", "m")
        assert out["input_text"].startswith("Summarize the following")
        fake.results["ui.dialog"] = True
        assert runner.custom("clearHistory") is True
        assert ("app.notify", {"title": "Prompt Logger", "message": "Cleared stored prompt history."}) in fake.calls
        assert fake.notes_of("settings.register") == [] and any(m == "settings.register" for m, _ in fake.calls)
    finally:
        runner.unload()
        sys.modules.pop("prompt_logger", None)


def test_host_calls_fail_cleanly_outside_app():
    _rpc.set_transport(None)
    with pytest.raises(llamarun.PluginError):
        llamarun.llm.generate("hi")


def test_storage_works_outside_app(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    storage.set("k", [1, 2])
    assert storage.get("k") == [1, 2]
    storage.delete("k")
    assert storage.get("k", "gone") == "gone"


# --------------------------------------------------------------------------- UI


def test_tree_serialises_callbacks_by_position():
    clicked = []
    tree = ui.Card(
        ui.Heading("Hi"),
        "plain text",
        None,
        ui.Row(ui.Button("Go", on_click=lambda: clicked.append(1)), ui.Switch("s", "S", default=True)),
        title="T",
    )
    cbs = ui._Callbacks()
    data = tree.to_dict(cbs)
    assert data["props"] == {"title": "T"}
    assert [c["type"] for c in data["children"]] == ["Heading", "Text", "Row"]
    button = data["children"][2]["children"][0]
    assert button["props"]["on_click"] == {"$cb": "cb0"}
    cbs.fns["cb0"]()
    assert clicked == [1]
    assert ui.Select("v", options={"a": "A"}).props["options"] == [{"value": "a", "label": "A"}]


def test_view_panel_renders_and_dispatches(fake):
    class Counter(ui.View):
        def __init__(self):
            super().__init__(count=0)

        def render(self):
            return ui.Column(
                ui.Text(f"count={self.state['count']}"),
                ui.Button("+", on_click=lambda values: self.set_state(count=self.state["count"] + int(values["step"]))),
                ui.Input("step", default="1"),
            )

    panel = ui.panel("Counter", view=Counter()).show()
    opened = fake.notes_of("ui.panel.open")[0]
    assert opened["tree"]["children"][0]["props"]["text"] == "count=0"
    ui._dispatch({"id": panel.id, "event": "$callback", "handler": "cb0", "payload": {"step": "5"}})
    ui._dispatch({"id": panel.id, "event": "$callback", "handler": "cb0", "payload": {"step": "1"}})
    time.sleep(0.2)  # renders are coalesced
    renders = fake.notes_of("ui.render")
    assert len(renders) == 1 and renders[0]["tree"]["children"][0]["props"]["text"] == "count=6"
    closed = []
    panel.on_close(lambda: closed.append(True))
    ui._dispatch({"id": panel.id, "event": "$closed"})
    assert closed == [True] and not panel.visible


def test_tsx_panel_state_and_events(fake):
    panel = ui.panel("History", tsx="History", state={"items": []})
    panel.on("add", lambda text: panel.set_state(items=panel.state["items"] + [text]) or len(panel.state["items"]))
    panel.show()
    assert fake.notes_of("ui.panel.open")[0]["tsx"] == "History"
    assert ui._dispatch({"id": panel.id, "event": "add", "payload": "a"}) == 1
    assert fake.notes_of("ui.state")[-1]["state"] == {"items": ["a"]}
    with pytest.raises(llamarun.PluginError, match="no handler"):
        ui._dispatch({"id": panel.id, "event": "nope"})


def test_hud_throttles_level_updates(fake):
    hud = ui.hud("Listening", indicator="pulse")
    for i in range(50):
        hud.update(level=i / 50)
    hud.update(text="done")
    time.sleep(0.1)
    updates = fake.notes_of("ui.hud")
    assert updates[0]["op"] == "show"
    assert 2 <= len(updates) < 10
    assert updates[-1]["props"]["level"] == pytest.approx(49 / 50)
    with pytest.raises(TypeError):
        hud.update(colour="red")
    hud.close()
    assert fake.notes_of("ui.hud")[-1]["op"] == "close"


def test_dialogs_round_trip(fake):
    fake.results["ui.dialog"] = lambda p: {"value": "typed"} if p["kind"] == "form" else True
    assert ui.prompt("Name?") == "typed"
    assert ui.confirm("Sure?") is True
    fields = [c for m, c in fake.calls if m == "ui.dialog"][0]["fields"]
    assert fields[0]["type"] == "Input" and fields[0]["props"]["name"] == "value"
    fake.results["ui.dialog"] = None
    assert ui.select("Pick", ["a", "b"]) is None


def test_chat_send_streams_in_order(fake):
    from llamarun import chats

    def host(params):
        stream = params["stream"]
        # The host numbers stream messages; the plugin's thread pool may deliver them out of order.
        for msg in [
            {"seq": 2, "type": "token", "text": "lo"},
            {"seq": 0, "type": "start", "chat_id": "c1"},
            {"seq": 1, "type": "token", "text": "Hel"},
            {"seq": 3, "type": "tool", "name": "get_weather", "server": "wx"},
        ]:
            chats._deliver({"stream": stream, **msg})
        return {"chat_id": "c1", "message_id": "m1", "text": "Hello", "status": "done",
                "tools": [{"name": "get_weather", "server": "wx"}], "paused": False}

    fake.results["chats.send"] = host
    tokens, tools, started = [], [], []
    reply = chats.send("hi", instructions="Be brief", voice=True,
                       on_token=tokens.append, on_tool=tools.append, on_start=started.append)
    assert tokens == ["Hel", "lo"] and started == ["c1"] and tools[0].name == "get_weather"
    assert reply.ok and reply.text == "Hello" and reply.chat_id == "c1" and not reply.paused
    sent = [c for m, c in fake.calls if m == "chats.send"][0]
    assert sent["instructions"] == "Be brief" and sent["voice"] is True and "chat_id" not in sent
    assert chats._streams == {}


def test_shortcuts_call_back(fake):
    from llamarun import app

    pressed = []
    fake.results["app.shortcut.register"] = None
    app.add_shortcut("Ctrl+Alt+E", lambda: pressed.append(1), id="talk")
    app._shortcut_pressed({"id": "talk"})
    app._shortcut_pressed({"id": "other"})
    assert pressed == [1]
    assert [c for m, c in fake.calls if m == "app.shortcut.register"] == [{"id": "talk", "accelerator": "Ctrl+Alt+E"}]


def test_settings_register_and_change(load, fake):
    fake.results["settings.register"] = {"voice": "Zira"}
    runner = load("""
        import llamarun
        from llamarun import settings, ui
        class P(llamarun.Plugin):
            changes = []
            def on_load(self):
                ui.settings(
                    ui.Heading("Voice"),
                    ui.Select("voice", "Voice", options=["George", "Zira"]),
                    ui.Slider("rate", "Rate", default=0, min=-10, max=10),
                )
            @settings.on_change
            def changed(self, changed):
                self.changes.append(changed)
    """, module="mod_settings")
    assert settings.get("voice") == "Zira" and settings.get("rate") == 0
    schema = [p for m, p in fake.calls if m == "settings.register"][0]["schema"]
    assert [n["type"] for n in schema] == ["Heading", "Select", "Slider"]
    assert runner.info()["loaded"]
    changed = settings._apply({"voice": "Zira", "rate": 3})
    assert changed == {"rate": 3}
    assert runner.instance.changes == [{"rate": 3}]


# ------------------------------------------------------------ plugin cooperation


def test_exposed_services_and_subscriptions(load, fake):
    runner = load("""
        import llamarun
        class P(llamarun.Plugin):
            heard = []
            @llamarun.expose
            def speak(self, text, loud=False):
                return text.upper() if loud else text
            @llamarun.expose(name="ping")
            def _ping(self):
                return "pong"
            @llamarun.events.subscribe("other.*")
            def on_other(self, data, event):
                self.heard.append((event.topic, data))
    """, module="mod_svc")
    info = runner.info()
    assert info["services"] == ["ping", "speak"]
    assert info["subscriptions"] == ["other.*"]
    assert runner.call_service("speak", ["hi"], {"loud": True}) == "HI"
    assert runner.call_service("ping", [], {}) == "pong"
    assert events._deliver("other.done", {"n": 1}, "other") == 1
    assert events._deliver("unrelated.x", {}, "unrelated") == 0
    assert runner.instance.heard == [("other.done", {"n": 1})]

    fake.results["services.call"] = lambda p: f"{p['plugin']}.{p['method']}{tuple(p['args'])}"
    assert llamarun.plugins.get("jarvis").speak("x") == "jarvis.speak('x',)"


def test_shared_update_retries_on_conflict(fake):
    store = {"value": 1, "version": 1}
    conflicts = [True]

    def get(p):
        return dict(store)

    def set_(p):
        if conflicts and conflicts.pop():
            store.update(value=10, version=2)  # someone else wrote first
            return {"ok": False, "version": 2}
        assert p["ifVersion"] == store["version"]
        store.update(value=p["value"], version=store["version"] + 1)
        return {"ok": True, "version": store["version"]}

    fake.results.update({"shared.get": get, "shared.set": set_})
    assert llamarun.shared.namespace("stats").update("n", lambda n: n + 1) == 11
    assert store == {"value": 11, "version": 3}


# ----------------------------------------------------------------- real process


def spawn_host(folder: Path, data: Path, grants: str = "unrestricted"):
    return subprocess.Popen(
        [sys.executable, "-I", "-X", "utf8", "-B", "-u", str(ROOT / "plugin_host.py"),
         "--plugin", str(folder), "--data", str(data), "--grants", grants],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        env={"SYSTEMROOT": os.environ.get("SYSTEMROOT", ""), "TEMP": str(data / "tmp")},
    )


class HostSession:
    def __init__(self, proc, answers=None):
        self.proc = proc
        self.answers = answers or {}
        self.notes = []
        self.next_id = 100

    def send(self, msg):
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()

    def request(self, method, params=None):
        self.next_id += 1
        msg_id = self.next_id
        self.send({"jsonrpc": "2.0", "id": msg_id, "method": method, "params": params or {}})
        while True:
            line = self.proc.stdout.readline()
            assert line, "host exited"
            msg = json.loads(line)
            if msg.get("method") and "id" in msg:
                self.send({"jsonrpc": "2.0", "id": msg["id"], "result": self.answers.get(msg["method"])})
            elif msg.get("method"):
                self.notes.append(msg)
            elif msg.get("id") == msg_id:
                if "error" in msg:
                    raise RuntimeError(msg["error"]["message"])
                return msg["result"]

    def close(self):
        self.proc.stdin.close()
        return self.proc.wait(timeout=10)


def test_rpc_roundtrip_over_pipes(tmp_path):
    shutil.copytree(EXAMPLES / "prompt_logger", tmp_path / "prompt_logger")
    host = HostSession(spawn_host(tmp_path / "prompt_logger", tmp_path / "Data", "hooks,llm,mcp"),
                       {"app.get_version": "0.0", "llm.get_available_models": [], "mcp.list_tools": [],
                        "settings.register": {}})
    info = host.request("plugin.load")
    assert info["loaded"], info
    assert info["hooks"] == ["before_text_generation", "after_text_generation"]
    assert host.request("events.before_text_generation", {"input_text": "/skip", "model": "m"})["cancel"] is True
    assert host.close() == 0


SANDBOX_PROBE = """
    import os, socket, subprocess, sys, tempfile
    import llamarun
    from llamarun import app

    def attempt(fn):
        try:
            fn()
            return "ok"
        except PermissionError as exc:
            return "blocked" if "LlamaRun blocked" in str(exc) else f"other: {exc}"
        except Exception as exc:
            return f"error: {type(exc).__name__}"

    class P(llamarun.Plugin):
        @llamarun.expose
        def probe(self):
            outside = os.path.join(os.path.dirname(app.get_data_dir()), "outside.txt")
            return {
                "write_data": attempt(lambda: (app.get_data_dir() / "x.txt").write_text("hi")),
                "write_temp": attempt(lambda: tempfile.NamedTemporaryFile(delete=True).close()),
                "write_outside": attempt(lambda: open(outside, "w").close()),
                "read_home": attempt(lambda: os.listdir(os.path.expanduser("~") if os.environ.get("USERPROFILE") else os.path.dirname(os.path.dirname(app.get_data_dir())))),
                "dns": attempt(lambda: socket.getaddrinfo("example.com", 80)),
                "connect": attempt(lambda: socket.create_connection(("192.0.2.1", 9), timeout=0.2)),
                "loopback_pair": attempt(lambda: [s.close() for s in socket.socketpair()]),
                "subprocess": attempt(lambda: subprocess.run([sys.executable, "-c", "pass"])),
                "ctypes": attempt(lambda: __import__("ctypes").CDLL("kernel32" if sys.platform == "win32" else None)),
            }
"""


def test_sandbox_enforces_permissions(tmp_path):
    folder = write_plugin(tmp_path / "Plugins", "probe", "mod_probe", SANDBOX_PROBE)
    data = tmp_path / "Data" / "mod_probe"
    host = HostSession(spawn_host(folder, data, "hooks"))
    assert host.request("plugin.load")["loaded"]
    result = host.request("services.call", {"method": "probe"})
    assert host.close() == 0
    assert result["write_data"] == "ok"
    assert result["write_temp"] == "ok"
    assert result["loopback_pair"] == "ok"
    for key in ("write_outside", "read_home", "dns", "connect", "subprocess", "ctypes"):
        assert result[key] == "blocked", (key, result[key])
    blocked = {n["params"]["permission"] for n in host.notes if n["method"] == "sandbox.blocked"}
    assert blocked == {"filesystem", "network", "subprocess", "native"}


def test_granted_permissions_are_allowed(tmp_path):
    folder = write_plugin(tmp_path / "Plugins", "probe", "mod_probe", SANDBOX_PROBE)
    host = HostSession(spawn_host(folder, tmp_path / "Data" / "mod_probe", "filesystem,subprocess,native"))
    assert host.request("plugin.load")["loaded"]
    result = host.request("services.call", {"method": "probe"})
    host.close()
    for key in ("write_outside", "read_home", "subprocess", "ctypes"):
        assert result[key] == "ok", (key, result[key])
    assert result["dns"] == "blocked"


@pytest.mark.skipif(sys.platform != "win32", reason="Windows pipe semantics")
def test_background_threads_are_not_blocked_by_the_protocol_pipe(tmp_path):
    """A plugin thread using fd 0 natively must not wait for the next RPC message.

    The C runtime locks a descriptor while a read on it is pending. Loading
    numpy touches fd 0, so if the protocol were read from fd 0, importing it
    on a background thread would stall until the app sent something.
    """
    folder = write_plugin(tmp_path / "Plugins", "bg", "mod_bg", """
        import ctypes, threading, time
        import llamarun
        from llamarun import app
        class P(llamarun.Plugin):
            def on_load(self):
                threading.Thread(target=self.work, daemon=True).start()
            def work(self):
                time.sleep(0.3)  # let the host go back to waiting for messages
                ctypes.CDLL("ucrtbase")._lseek(0, 0, 1)
                (app.get_data_dir() / "done").write_text("ok")
    """)
    data = tmp_path / "Data" / "mod_bg"
    host = HostSession(spawn_host(folder, data, "native"))
    host.request("plugin.load")
    marker = data / "done"
    deadline = time.time() + 5
    while not marker.exists() and time.time() < deadline:
        time.sleep(0.05)
    unblocked = marker.exists()  # checked before closing stdin, which would release the lock
    assert host.close() == 0
    assert unblocked, "plugin thread stayed blocked until the host received another message"


def test_tools_describe_and_run(load, fake):
    runner = load("""
        from typing import List, Literal, Optional
        import llamarun
        class P(llamarun.Plugin):
            @llamarun.tool
            def forecast(self, city: str, days: int = 3, units: Literal["c", "f"] = "c",
                         tags: Optional[List[str]] = None) -> dict:
                \"\"\"Weather forecast for a city.

                Args:
                    city: City name, e.g. "Paris".
                    days: How many days ahead,
                        from 1 to 7.
                \"\"\"
                return {"city": city, "days": days, "units": units}

            @llamarun.tool(name="fail-now", description="Always fails")
            def fail(self):
                raise llamarun.ToolError("no luck")

            @llamarun.tool
            def crash(self):
                \"\"\"Crashes.\"\"\"
                raise RuntimeError("boom")
    """, module="mod_tools")
    specs = {s["name"]: s for s in runner.info()["tools"]}
    assert sorted(specs) == ["crash", "fail-now", "forecast"]
    f = specs["forecast"]
    assert f["description"] == "Weather forecast for a city."
    assert f["inputSchema"]["required"] == ["city"]
    props = f["inputSchema"]["properties"]
    assert props["city"] == {"type": "string", "description": 'City name, e.g. "Paris".'}
    assert props["days"] == {"type": "integer", "description": "How many days ahead, from 1 to 7.", "default": 3}
    assert props["units"]["enum"] == ["c", "f"]
    assert props["tags"] == {"type": "array", "items": {"type": "string"}}
    assert specs["fail-now"]["description"] == "Always fails"

    ok = runner.call_tool("forecast", {"city": "Paris", "extra": 1})
    assert ok == {"content": [{"type": "text", "text": '{"city": "Paris", "days": 3, "units": "c"}'}], "isError": False}
    assert runner.call_tool("forecast", {})["isError"]
    assert runner.call_tool("fail-now", {})["content"][0]["text"] == "no luck"
    crashed = runner.call_tool("crash", {})
    assert crashed["isError"] and "boom" in crashed["content"][0]["text"]
    with pytest.raises(Exception):
        runner.call_tool("missing", {})


def test_tool_names_are_checked():
    with pytest.raises(ValueError):
        llamarun.tool(name="has space")(lambda self: None)


def test_install_calls(fake):
    fake.results["mcp.directory.search"] = {"servers": [{"id": "a1", "name": "GitHub", "description": "Repos",
                                                         "requiresAuth": True, "config": {"type": "command"}}],
                                            "nextCursor": "c2"}
    fake.results["mcp.add_server"] = lambda p: None if p.get("directory_id") == "no" else {"name": "GitHub", "state": "connected", "toolCount": 4}
    fake.results["plugins.install"] = {"id": "x", "name": "X", "state": "running", "tools": ["t"]}
    fake.results["plugins.marketplace.search"] = {"available": False, "message": "not yet"}
    page = llamarun.mcp.search_directory("git")
    assert page.next_cursor == "c2" and page.servers[0].requires_auth and page.servers[0].name == "GitHub"
    assert llamarun.mcp.add_server(directory_id="no") is None
    added = llamarun.mcp.add_server(directory_id="a1", reason="for repos")
    assert added.tool_count == 4 and fake.calls[-1][1] == {"directory_id": "a1", "args": [], "env": {}, "reason": "for repos"}
    assert llamarun.plugins.install("C:/x", reason="r").tools == ["t"]
    assert not llamarun.plugins.search_marketplace("q").available
