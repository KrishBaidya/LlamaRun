# Computer-use benchmark: Llama Run vs Claude Code

Runs [Cua Bench](https://cua.ai/docs/cua-bench) tasksets on local Linux desktop sandboxes with two harnesses:

- **Llama Run**: the app's own computer-use harness (`src/main/computer/tools.ts`, its instructions and tool loop) with Gemini 3.8 Flash. `llamarun-agent.ts` runs it in plain Node.
- **Claude Code**: `claude -p` with Claude Sonnet 5.5, Claude Code's own harness.

Both reach the desktop through the same tool server: one `cua-driver mcp` started inside each sandbox for the whole task, its stdio tunnelled to this machine and served to each agent as a stdio MCP server (`agents/llamarun_bench/driver.py`, `mcp-tcp.mjs`). So the comparison is harness plus model, on identical tools.

## Run

```bash
bench/setup.sh
```

```bash
GEMINI_API_KEY=... bench/run.sh llamarun cua-bench-basic 3
```

```bash
GEMINI_API_KEY=... ANTHROPIC_API_KEY=... bench/run.sh both cua-bench-basic,cua-bench-kicad 3
```

`run.sh [both|llamarun|claude-code] [datasets] [variants-per-task]` runs each taskset and prints the comparison (success rate, agent time, cost, per task) from `report.py`; per-step trajectories land in `~/.local/share/cua-bench/runs/<run>/<task>/task_0_agent_logs/`.

Gemini models:

| `LLAMARUN_MODEL` | Path |
|---|---|
| `gemini/gemini-3.8-flash` (default with `GEMINI_API_KEY`) | Gemini API directly (`gemini.ts`, Llama Run's loop) |
| `gemini-3.8-flash` (with `LLAMARUN_TOKEN`) | Through the Llama Run server, exactly as the app |

Gemini 3.8 Flash isn't marked as a vision model in Llama Run, so like in the app it works from the accessibility tree without screenshots.

## Notes

- `script/<file.json>` as the model replays fixed tool calls (see `scripts/`), to check the plumbing with no model: `scripts/click-button.json` scores 1.
- The `click-button` task's built-in oracle scores 0 because it clicks the first of several buttons; the evaluator itself is right.
- Not `cua-driver serve`: its HTTP endpoint makes every request a new driver session, so element rows and screenshots from one call are gone by the next ("belongs to another session", "no current snapshot"), and drags and x/y clicks never work. The app holds one driver for its lifetime, as the stdio server does.
- `setup.sh` works around two upstream issues: `cua-sandbox` 0.9.x calls an option the published `cua` 0.9.0 lacks, and Cua's runtime can't pull public ghcr.io images anonymously, so images are served from a local registry.
