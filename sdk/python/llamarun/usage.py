"""Tokens the user's chats have used (needs the ``usage`` permission).

Counts only, per day and model, as providers report them::

    from llamarun import usage

    for day in usage.days(30):
        for model, u in day.models.items():
            print(day.day, model, u.input_tokens, u.output_tokens)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

from . import _rpc

__all__ = ["Day", "Totals", "days"]


@dataclass
class Totals:
    input_tokens: int
    output_tokens: int
    #: Input tokens read from the provider's prompt cache.
    cached_input_tokens: int
    #: Output tokens a thinking model spent thinking.
    reasoning_tokens: int
    requests: int


@dataclass
class Day:
    #: YYYY-MM-DD, local time.
    day: str
    models: Dict[str, Totals]


def _totals(u: dict) -> Totals:
    return Totals(
        input_tokens=int(u.get("inputTokens", 0)),
        output_tokens=int(u.get("outputTokens", 0)),
        cached_input_tokens=int(u.get("cachedInputTokens", 0)),
        reasoning_tokens=int(u.get("reasoningTokens", 0)),
        requests=int(u.get("requests", 0)),
    )


def days(since_days: int = 30) -> List[Day]:
    """Usage per day and model for the last ``since_days`` days (up to 90), oldest first."""
    raw = _rpc.call("usage.list", {"since_days": int(since_days)}) or []
    return [Day(day=str(d.get("day", "")), models={m: _totals(u) for m, u in (d.get("models") or {}).items()}) for d in raw]
