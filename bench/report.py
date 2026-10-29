"""Compares benchmark runs: success rate, time and tool use per harness, per task.

    python bench/report.py <run-id-or-dir> [<run-id-or-dir> ...] [--json out.json]

Each run directory is one `cb run` (under ~/.local/share/cua-bench/runs). The
harness and model come from the per-variant llamarun.json / claude-code.json
the agents write.
"""

import argparse
import json
import statistics
from collections import defaultdict
from pathlib import Path

RUNS = Path.home() / ".local/share/cua-bench/runs"


def load_run(ref: str) -> list[dict]:
    root = Path(ref) if Path(ref).exists() else RUNS / ref
    rows = []
    for result_file in sorted(root.glob("*/result.json")):
        result = json.loads(result_file.read_text())
        variant = result_file.parent
        detail = {}
        for name in ("llamarun.json", "claude-code.json"):
            matches = list(variant.rglob(name))
            if matches:
                detail = json.loads(matches[0].read_text())
                break
        harness = detail.get("harness") or result.get("agent_info", {}).get("name", "?")
        rows.append(
            {
                "run": root.name,
                "task": result.get("task"),
                "variant": result.get("variant"),
                "harness": harness,
                "model": detail.get("model") or (result.get("agent_info", {}).get("model_info") or {}).get("name", "?"),
                "reward": result.get("reward") if result.get("status") == "completed" else 0.0,
                "status": result.get("status"),
                "error": result.get("error") or detail.get("error"),
                # The harness's own time on the task: not sandbox start-up, copying the driver in, or scoring.
                "agent_s": (detail.get("durationMs") or detail.get("wallMs") or 0) / 1000 or _seconds(result.get("agent_execution")),
                "tool_calls": detail.get("toolCalls") if "toolCalls" in detail else detail.get("num_turns"),
                "cost_usd": detail.get("total_cost_usd"),
            }
        )
    return rows


def _seconds(span: dict | None) -> float | None:
    if not span or not span.get("started_at") or not span.get("finished_at"):
        return None
    from datetime import datetime

    return (datetime.fromisoformat(span["finished_at"]) - datetime.fromisoformat(span["started_at"])).total_seconds()


def summarize(rows: list[dict]) -> dict:
    by_harness: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_harness[f"{row['harness']} · {row['model']}"].append(row)
    summary = {}
    for name, items in by_harness.items():
        times = [r["agent_s"] for r in items if r["agent_s"] is not None]
        costs = [r["cost_usd"] for r in items if isinstance(r["cost_usd"], (int, float))]
        tasks: dict[str, list[float]] = defaultdict(list)
        for r in items:
            tasks[r["task"]].append(float(r["reward"] or 0))
        summary[name] = {
            "variants": len(items),
            "success_rate": sum(float(r["reward"] or 0) for r in items) / len(items),
            "median_agent_s": statistics.median(times) if times else None,
            "mean_agent_s": statistics.mean(times) if times else None,
            "errors": sum(1 for r in items if r["error"]),
            "total_cost_usd": sum(costs) if costs else None,
            "per_task": {task: sum(v) / len(v) for task, v in sorted(tasks.items())},
        }
    return summary


def markdown(summary: dict) -> str:
    names = list(summary)
    lines = ["| | " + " | ".join(names) + " |", "|---|" + "---|" * len(names)]
    def row(label, fn):
        lines.append(f"| {label} | " + " | ".join(fn(summary[n]) for n in names) + " |")
    row("Variants", lambda s: str(s["variants"]))
    row("Success rate", lambda s: f"{s['success_rate']:.0%}")
    row("Median agent time", lambda s: f"{s['median_agent_s']:.1f} s" if s["median_agent_s"] is not None else "–")
    row("Mean agent time", lambda s: f"{s['mean_agent_s']:.1f} s" if s["mean_agent_s"] is not None else "–")
    row("Runs with errors", lambda s: str(s["errors"]))
    row("Model cost", lambda s: f"${s['total_cost_usd']:.2f}" if s["total_cost_usd"] is not None else "–")
    tasks = sorted({t for s in summary.values() for t in s["per_task"]})
    lines += ["", "| Task | " + " | ".join(names) + " |", "|---|" + "---|" * len(names)]
    for task in tasks:
        lines.append(f"| {task} | " + " | ".join(f"{summary[n]['per_task'][task]:.0%}" if task in summary[n]["per_task"] else "–" for n in names) + " |")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("runs", nargs="+")
    parser.add_argument("--json")
    args = parser.parse_args()
    rows = [row for ref in args.runs for row in load_run(ref)]
    summary = summarize(rows)
    print(markdown(summary))
    if args.json:
        Path(args.json).write_text(json.dumps({"summary": summary, "rows": rows}, indent=2))


if __name__ == "__main__":
    main()
