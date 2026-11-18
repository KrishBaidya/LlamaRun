"""Usage Insights: the last 30 days of token use, like Hermes' /insights.

Reads counts only (the ``usage`` permission): per day and model, never what was said.
"""

from __future__ import annotations

from typing import Dict, List, Tuple

import llamarun
from llamarun import chats, ui, usage


def fmt(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1000:
        return f"{n / 1000:.1f}k"
    return str(n)


def summarise(days: List[usage.Day]) -> Tuple[Dict[str, usage.Totals], List[Tuple[str, int]]]:
    """Totals per model (biggest first) and tokens per day."""
    models: Dict[str, usage.Totals] = {}
    per_day: List[Tuple[str, int]] = []
    for day in days:
        total = 0
        for model, t in day.models.items():
            m = models.setdefault(model, usage.Totals(0, 0, 0, 0, 0))
            m.input_tokens += t.input_tokens
            m.output_tokens += t.output_tokens
            m.cached_input_tokens += t.cached_input_tokens
            m.reasoning_tokens += t.reasoning_tokens
            m.requests += t.requests
            total += t.input_tokens + t.output_tokens
        per_day.append((day.day, total))
    ordered = dict(sorted(models.items(), key=lambda kv: -(kv[1].input_tokens + kv[1].output_tokens)))
    return ordered, per_day


def report(days: List[usage.Day]) -> str:
    models, per_day = summarise(days)
    if not models:
        return "No usage counted in the last 30 days yet."
    rows = ["| Model | In | Out | Cached | Thinking | Requests |", "|---|---:|---:|---:|---:|---:|"]
    for model, t in models.items():
        rows.append(f"| {model} | {fmt(t.input_tokens)} | {fmt(t.output_tokens)} | {fmt(t.cached_input_tokens)} | {fmt(t.reasoning_tokens)} | {t.requests} |")
    busiest = max(per_day, key=lambda d: d[1])
    total_in = sum(t.input_tokens for t in models.values())
    cached = sum(t.cached_input_tokens for t in models.values())
    share = f" {round(100 * cached / total_in)}% of input came from the prompt cache." if total_in else ""
    return "\n".join([f"**Last 30 days**: {len(per_day)} active days; busiest {busiest[0]} ({fmt(busiest[1])} tokens).{share}", "", *rows])


class Insights(ui.View):
    def __init__(self) -> None:
        super().__init__(days=usage.days(30))

    def render(self):
        models, per_day = summarise(self.state["days"])
        if not models:
            return ui.Column(ui.Text("No usage counted in the last 30 days yet."), ui.Button("Refresh", on_click=self.reload, icon="refresh-cw"))
        top = max(t for _, t in per_day) or 1
        return ui.Column(
            ui.Card(
                ui.List([ui.Text(f"{m}: {fmt(t.input_tokens)} in, {fmt(t.output_tokens)} out, {t.requests} requests") for m, t in models.items()]),
                title="By model",
            ),
            ui.Card(
                ui.Column(*[ui.Progress(t / top, label=f"{d}  {fmt(t)}") for d, t in per_day[-14:]], gap=2),
                title="Last 14 active days",
            ),
            ui.Button("Refresh", on_click=self.reload, icon="refresh-cw"),
        )

    def reload(self) -> None:
        self.set_state(days=usage.days(30))


class UsageInsights(llamarun.Plugin):
    def on_load(self) -> None:
        self.panel = None
        chats.add_command("insights", self.insights, description="Tokens used in the last 30 days, by model and day")

    def insights(self, _args: str, _chat_id: str) -> str:
        return report(usage.days(30))

    def on_open(self) -> None:
        if self.panel is None:
            self.panel = ui.panel("Usage insights", view=Insights(), width=520, height=620)
        self.panel.show()
