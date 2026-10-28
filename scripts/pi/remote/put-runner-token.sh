#!/usr/bin/env bash
# Run on the PC (Git bash), not on the Pi. Mints a one-hour GitHub Actions registration token for one of stage 17's
# runners and writes it straight into the Pi's root-only token file, so it is never printed, never on a command line
# and never in a file on the PC:
#   scripts/pi/remote/put-runner-token.sh vault     (Gnuminator/obsidian-vault)
#   scripts/pi/remote/put-runner-token.sh board     (Gnuminator/foundry-ai-tool-pm-board)
# Needs `gh` signed in with admin on the repo and the Pi reachable as `foundry-pi`. Then run stage 17 within the hour
# (scripts/pi/remote/17-gh-runner.sh deletes the file after it registers the runner).
set -euo pipefail

case "${1:-}" in
vault) repo=Gnuminator/obsidian-vault ;;
board) repo=Gnuminator/foundry-ai-tool-pm-board ;;
*)
  echo "usage: put-runner-token.sh vault|board" >&2
  exit 2
  ;;
esac
name="$1"

# The token goes gh -> ssh stdin -> file. If gh fails, pipefail stops the pipe and the remote side removes its half file.
gh api -X POST "repos/$repo/actions/runners/registration-token" --jq .token |
  ssh foundry-pi "set -e; umask 077; f=/etc/foundry-ai-tool/gh-runner-$name.reg; t=\$f.tmp; trap 'rm -f \"\$t\"' EXIT; cat > \"\$t\"; [ \"\$(wc -c < \"\$t\")\" -ge 20 ]; chown root:root \"\$t\"; chmod 600 \"\$t\"; mv -f \"\$t\" \"\$f\""
echo "registration token for $repo is on the Pi (not shown); run stage 17 within the hour"
