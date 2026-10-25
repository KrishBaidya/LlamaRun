"""Permission sandbox for plugin processes.

The plugin host calls :func:`install` before it imports the plugin. It adds a
:func:`sys.addaudithook` hook (which can't be removed afterwards) that raises
:class:`PermissionError` when the plugin does something its manifest didn't ask
for: opening sockets, starting programs, writing files outside its data
folder, or loading native code with ctypes.

This is a *policy* layer, not an OS security boundary. It stops accidents and
honest-but-careless plugins and makes a plugin's reach visible to the user,
but native code (which the ``native`` permission gates) can get around it.
"""

from __future__ import annotations

import os
import sys
import weakref
from typing import Callable, Iterable, Optional

#: Every permission a plugin can request in ``plugin.json``.
PERMISSIONS = (
    "hooks",
    "llm",
    "chats",
    "mcp",
    "tools",
    "install",
    "network",
    "subprocess",
    "filesystem",
    "native",
    "microphone",
    "clipboard",
    "memory",
    "skills",
    "context",
    "appearance",
    "commands",
)
UNRESTRICTED = "unrestricted"

_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC
_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1", ""}
_WIN_DEVICES = ("\\\\.\\nul", "\\\\.\\conin$", "\\\\.\\conout$", "nul", "conin$", "conout$")

_NETWORK = {"socket.connect", "socket.connect_ex", "socket.sendto", "socket.sendmsg", "socket.bind",
            "socket.getaddrinfo", "socket.gethostbyname", "socket.gethostbyname_ex", "socket.gethostbyaddr"}
_SUBPROCESS = {"subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn", "os.startfile",
               "os.fork", "os.forkpty", "_winapi.CreateProcess", "os.kill", "os.killpg", "pty.spawn"}
_NATIVE = {"ctypes.dlopen", "ctypes.dlsym", "ctypes.dlsym/handle", "ctypes.call_function", "ctypes.cdata",
           "ctypes.cdata/buffer", "ctypes.string_at", "ctypes.wstring_at", "ctypes.PyObj_FromPtr"}
_FS_READ = {"os.listdir", "os.scandir"}
_FS_WRITE_ONE = {"os.remove", "os.rmdir", "os.mkdir", "os.chmod", "os.chown", "os.truncate", "os.utime",
                 "shutil.rmtree", "os.chflags", "os.lchflags", "os.setxattr", "os.removexattr"}
_FS_WRITE_TWO = {"os.rename", "os.link", "os.symlink", "shutil.copyfile", "shutil.copymode", "shutil.copystat",
                 "shutil.move"}
_REGISTRY_WRITE = {"winreg.CreateKey", "winreg.DeleteKey", "winreg.DeleteValue", "winreg.SetValue",
                   "winreg.SaveKey", "winreg.LoadKey"}
_WATCHED = frozenset({"open", "object.__setattr__"} | _NETWORK | _SUBPROCESS | _NATIVE | _FS_READ
                     | _FS_WRITE_ONE | _FS_WRITE_TWO | _REGISTRY_WRITE)


def _norm(path) -> Optional[str]:
    if path is None or isinstance(path, int):
        return None
    try:
        return os.path.normcase(os.path.abspath(os.fsdecode(path)))
    except (TypeError, ValueError):
        return None


def _roots(paths: Iterable) -> tuple:
    out = []
    for p in paths:
        n = _norm(p)
        if n:
            out.append(n.rstrip("\\/") or n)
    return tuple(dict.fromkeys(out))


def system_read_roots() -> list:
    """Folders any plugin may read: the Python install and OS system files (not user files)."""
    roots = [sys.prefix, sys.base_prefix, sys.exec_prefix]
    if sys.platform == "win32":
        roots.append(os.environ.get("SystemRoot") or os.environ.get("windir") or "C:\\Windows")
    else:
        roots += ["/usr", "/lib", "/lib64", "/etc", "/bin", "/opt", "/System", "/Library", "/dev/null",
                  "/dev/urandom", "/dev/random", "/proc/self", "/sys/devices/system/cpu"]
    return roots


def blocked_message(permission: str, what: str) -> str:
    return (
        f'LlamaRun blocked {what}: this plugin needs the "{permission}" permission. '
        f'Add it to "permissions" in plugin.json and reinstall, or ask the user to grant it.'
    )


def install(
    grants: Iterable[str],
    *,
    read_roots: Iterable = (),
    write_roots: Iterable = (),
    on_blocked: Optional[Callable[[str, str], None]] = None,
) -> bool:
    """Install the audit hook. Returns False (and does nothing) for unrestricted plugins."""
    granted = frozenset(grants)
    if UNRESTRICTED in granted:
        return False
    write = _roots(write_roots)
    read = _roots([*read_roots, *system_read_roots()]) + write

    # State lives in keyword-only defaults: replacing a function's __kwdefaults__ or
    # __code__ raises an "object.__setattr__" audit event, which the hook refuses.
    def _llamarun_audit(
        event: str,
        args: tuple,
        *,
        _granted=granted,
        _read=read,
        _write=write,
        _bound=weakref.WeakSet(),
        _reported=set(),
        _on_blocked=on_blocked,
    ) -> None:
        if event not in _WATCHED:
            return

        def deny(permission: str, what: str) -> None:
            if _on_blocked is not None and (permission, event) not in _reported:
                _reported.add((permission, event))
                try:
                    _on_blocked(permission, what)
                except Exception:
                    pass
            raise PermissionError(blocked_message(permission, what))

        def under(path: Optional[str], roots: tuple) -> bool:
            if path is None:
                return True
            if sys.platform == "win32" and path.endswith(_WIN_DEVICES):
                return True
            return any(path == r or path.startswith(r + os.sep) for r in roots)

        if event == "object.__setattr__":
            obj, name = args[0], args[1]
            if getattr(obj, "__name__", None) == "_llamarun_audit" and name in (
                "__code__", "__defaults__", "__kwdefaults__"
            ):
                raise PermissionError("LlamaRun blocked tampering with the plugin sandbox")
            return

        if event == "open":
            path, _mode, flags = args
            target = _norm(path)
            if target is None or "filesystem" in _granted:
                return
            writing = isinstance(flags, int) and bool(flags & _WRITE_FLAGS)
            if writing and not under(target, _write):
                deny("filesystem", f"writing {os.fsdecode(path)!r}")
            if not writing and not under(target, _read):
                deny("filesystem", f"reading {os.fsdecode(path)!r}")
            return

        if event in _FS_READ:
            if "filesystem" not in _granted and args and not under(_norm(args[0]) or _norm("."), _read):
                deny("filesystem", f"listing {os.fsdecode(args[0])!r}")
            return

        if event in _FS_WRITE_ONE or event in _FS_WRITE_TWO:
            if "filesystem" in _granted:
                return
            paths = args[:2] if event in _FS_WRITE_TWO else args[:1]
            for p in paths:
                target = _norm(p)
                if target is not None and not under(target, _write):
                    deny("filesystem", f"{event} on {os.fsdecode(p)!r}")
            return

        if event in _REGISTRY_WRITE:
            if "filesystem" not in _granted:
                deny("filesystem", "changing the Windows registry")
            return

        if event in _NETWORK:
            if "network" in _granted:
                return
            if event in ("socket.getaddrinfo", "socket.gethostbyname", "socket.gethostbyname_ex"):
                host = args[0]
                if isinstance(host, bytes):
                    host = host.decode("ascii", "replace")
                if host is None or str(host).lower() in _LOOPBACK_HOSTS:
                    return
                deny("network", f"looking up {host!r}")
            if event == "socket.bind":
                sock, address = args
                if isinstance(address, tuple) and str(address[0]).lower() in _LOOPBACK_HOSTS:
                    _bound.add(sock)  # e.g. asyncio's socketpair() on Windows
                    return
                deny("network", f"listening on {address!r}")
            if event in ("socket.connect", "socket.connect_ex", "socket.sendto"):
                address = args[1]
                if isinstance(address, tuple) and str(address[0]).lower() in _LOOPBACK_HOSTS:
                    ports = set()
                    for s in list(_bound):
                        try:
                            ports.add(s.getsockname()[1])
                        except OSError:
                            pass
                    if address[1] in ports:
                        return  # a socket this process itself is listening on
                deny("network", f"connecting to {address!r}")
            deny("network", event)

        if event in _SUBPROCESS:
            if "subprocess" not in _granted:
                deny("subprocess", "starting or signalling another program")
            return

        if event in _NATIVE:
            if "native" not in _granted:
                deny("native", "loading native code with ctypes")
            return

    sys.addaudithook(_llamarun_audit)
    return True
