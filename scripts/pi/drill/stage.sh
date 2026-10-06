#!/usr/bin/env bash
# Rebuild drill helper (docs/dev/PI-SETUP.md, "Rebuild drill"), runs inside the drill container.
# Runs one stage the way the PC runs it on the Pi over SSH (lib.sh plus the stage, one bash stream)
# and appends its wall time to /drill/timings.log. Extra environment (TOOL_REF, ...) passes through.
# Usage: stage.sh 3-foundry.sh
set -uo pipefail

stage="${1:?usage: stage.sh <stage file name, e.g. 3-foundry.sh>}"
mkdir -p /drill
start=$(date +%s)
echo "### $stage start $(date -u +%H:%M:%S)" | tee -a /drill/timings.log
cat /stages/lib.sh "/stages/$stage" | bash -s 2>&1 | tee "/drill/$stage.log"
rc=${PIPESTATUS[1]}
end=$(date +%s)
echo "### $stage rc=$rc wall=$((end - start))s" | tee -a /drill/timings.log
exit "$rc"
