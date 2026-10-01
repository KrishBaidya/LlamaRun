"""Check what this plugin is allowed to do.

Permissions are requested with ``"permissions"`` in plugin.json and approved
by the user when the plugin is installed. They can be turned off later in
Settings → Plugins, so check before using an optional feature::

    if permissions.has("network"):
        download_model()
    else:
        ui.toast("Turn on Internet access for this plugin to download voices")
"""

from __future__ import annotations

from typing import FrozenSet

from . import _rpc
from ._sandbox import PERMISSIONS, UNRESTRICTED

__all__ = ["PERMISSIONS", "granted", "has"]


def granted() -> FrozenSet[str]:
    """Permissions this plugin currently has."""
    grants = _rpc.current_plugin().grants
    return frozenset(PERMISSIONS) if UNRESTRICTED in grants else frozenset(grants)


def has(permission: str) -> bool:
    if permission not in PERMISSIONS:
        raise ValueError(f"unknown permission {permission!r}; expected one of {', '.join(PERMISSIONS)}")
    return permission in granted()
