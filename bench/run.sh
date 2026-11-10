#!/usr/bin/env bash
# Runs Cua Bench tasksets with Llama Run's harness and/or Claude Code, then prints the comparison.
#
#   GEMINI_API_KEY=... ANTHROPIC_API_KEY=... bench/run.sh [both|llamarun|claude-code] [datasets] [variants-per-task]
#
#   datasets: comma-separated, default cua-bench-basic (also cua-bench-kicad, cua-bench-workflows)
#   LLAMARUN_MODEL: gemini/gemini-3.8-flash with GEMINI_API_KEY (Gemini API directly), or
#     gemini-3.8-flash with LLAMARUN_TOKEN (through the Llama Run server, as the app does)
#   CLAUDE_MODEL (default claude-sonnet-5-5), JOBS (default 4), TASKS (task-name glob, e.g. 'click*,drag*')
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH" PYTHONPATH="$PWD/agents"
which=${1:-both}
datasets=${2:-cua-bench-basic}
variants=${3:-3}
jobs=${JOBS:-4}
runs=()

image_for() {
  case "$1" in
    cua-bench-basic) echo localhost:5000/trycua/bench-web:1.0 ;;
    cua-bench-kicad) echo localhost:5000/trycua/linux-kicad:24.04 ;;
    *) echo localhost:5000/trycua/linux:24.04 ;;
  esac
}

run() { # agent-class model dataset
  local out
  out=$( (cb run dataset "$3" --max-variants "$variants" -j "$jobs" --image "$(image_for "$3")" ${TASKS:+--task-filter "$TASKS"} \
    --agent-import-path "llamarun_bench:$1" --model "$2" 2>&1 || true) | tee /dev/stderr | sed 's/\x1b\[[0-9;]*m//g')
  runs+=("$(echo "$out" | sed -n 's/^ *Run ID: *//p' | head -1)")
}

IFS=, read -ra list <<<"$datasets"
for dataset in "${list[@]}"; do
  if [ "$which" != claude-code ]; then
    default_model=gemini-3.8-flash
    if [ -z "${LLAMARUN_TOKEN:-}" ] && [ -n "${GEMINI_API_KEY:-${GOOGLE_API_KEY:-${GEMNIN_KEY:-}}}" ]; then default_model=gemini/gemini-3.8-flash; fi
    run LlamaRunAgent "${LLAMARUN_MODEL:-$default_model}" "$dataset"
  fi
  if [ "$which" != llamarun ]; then run ClaudeCodeAgent "${CLAUDE_MODEL:-claude-sonnet-5-5}" "$dataset"; fi
done

python3 report.py "${runs[@]}" --json "results-$(date +%Y%m%d-%H%M%S).json"
