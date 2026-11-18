import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path[:0] = [str(HERE.parent), str(HERE.parents[2] / "sdk" / "python")]

import lsp_diagnostics as L  # noqa: E402


def test_reports_errors_only_and_clears_when_fixed(tmp_path):
    (tmp_path / "package.json").write_text("{}")
    f = tmp_path / "src" / "a.ts"
    f.parent.mkdir()
    f.write_text("const x = 1\nlet y = oops\n")
    assert L.project_root(f) == tmp_path
    server = L.Server([sys.executable, str(HERE / "fake_ls.py")], tmp_path)
    try:
        out = L.format_diagnostics(str(f), server.check(f, "typescript"))
        assert "a.ts:2:5: Cannot find name 'oops'." in out
        assert "warning" not in out
        f.write_text("const x = 1\n")
        assert L.format_diagnostics(str(f), server.check(f, "typescript")) == ""
    finally:
        server.close()


def test_unknown_languages_have_no_server():
    assert L.find_server(".txt") is None
