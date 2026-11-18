import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path[:0] = [str(HERE.parent), str(HERE.parents[2] / "sdk" / "python")]

import usage_insights as U  # noqa: E402
from llamarun import usage  # noqa: E402


def test_report_totals_by_model_and_busiest_day():
    days = [
        usage.Day("2026-11-17", {"gemini-a": usage.Totals(1000, 50, 800, 0, 2)}),
        usage.Day("2026-11-18", {"gemini-a": usage.Totals(3000, 100, 0, 20, 3), "gemma4": usage.Totals(500, 40, 0, 0, 1)}),
    ]
    report = U.report(days)
    assert "| gemini-a | 4.0k | 150 | 800 | 20 | 5 |" in report
    assert "busiest 2026-11-18" in report
    assert report.index("gemini-a") < report.index("gemma4")


def test_empty_report():
    assert U.report([]) == "No usage counted in the last 30 days yet."
