"""The user's installed skills (needs the ``skills`` permission).

A skill is a folder with a ``SKILL.md`` (the format Claude uses) plus any
scripts and reference files. Models load them when a request fits and can run
their Python scripts, asking the user first::

    from llamarun import skills

    for s in skills.list():
        print(s["name"], s["description"])
    skills.install("anthropics/skills")  # the user is asked to confirm
"""

from __future__ import annotations

from typing import List

from . import _rpc

__all__ = ["install", "list"]


def list() -> List[dict]:  # noqa: A001
    """Installed skills: id, name, description, enabled, scripts, files, source."""
    return _rpc.call("skills.list") or []


def install(source: str) -> List[dict]:
    """Install skills from a link (GitHub, GitLab, any git repo, a .zip or a SKILL.md), a .zip or a folder.

    The user sees a confirmation first; raises :class:`~llamarun.PluginError` if they decline.
    Returns the skills that were installed.
    """
    return _rpc.call("skills.install", {"source": source}) or []
