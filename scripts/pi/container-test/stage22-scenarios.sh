#!/usr/bin/env bash
# Stage 22 (scripts/pi/remote/22-seven-books.sh, piped together with gm-script.sh) in a Debian 13 ARM64 container
# with no systemd: stand-ins for systemctl, curl (/api/status), journalctl and systemd-run make it take its systemd
# path, and the GM script itself is not run (the fake systemd-run only logs the call; the script's logic is tested in
# scripts/pi/seven-books.test.mjs). Each scenario checks the words it needs and prints PASS or FAIL lines:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" <IMAGE> bash /repo/scripts/pi/container-test/stage22-scenarios.sh [name ...]
# DESTRUCTIVE: it wipes the Foundry data folder and the tool's folders and installs the fakes into /usr/local/sbin.
# It refuses to run anywhere but a container.
set -uo pipefail

[ -f /.dockerenv ] || [ -n "${container:-}" ] || {
  echo "REFUSED: run this only in the test container (docker run ..., see the header)"
  exit 98
}

H=/repo/scripts/pi/container-test
R=/repo/scripts/pi/remote
only=" $* "
export DEBIAN_FRONTEND=noninteractive
apt_setup() { apt-get update && apt-get install -y --no-install-recommends nodejs curl ca-certificates; }
{ apt_setup || { /bin/sleep 20 && apt_setup; }; } >/dev/null 2>&1 || {
  echo "SETUP FAILED: apt-get"
  exit 99
}
mkdir -p /opt/node24/bin /run/systemd/system
ln -sf "$(command -v node)" /opt/node24/bin/node
for f in systemctl curl journalctl sleep systemd-run logger; do install -m 755 "$H/bin/$f" "/usr/local/sbin/$f"; done
eval "$(grep -E '^(FOUNDRY_USER|FOUNDRY_DATA|TOOL_DIR|TOOL_ETC|TOOL_DATA)=' "$R/lib.sh")"
id "$FOUNDRY_USER" >/dev/null 2>&1 || useradd --system --home-dir "$FOUNDRY_DATA" --shell /usr/sbin/nologin "$FOUNDRY_USER"

fail=0
check() { # $1 name, $2 what is expected in the output (grep -E), $3 the output
  if grep -Eq -- "$2" <<<"$3"; then echo "PASS $1: $2"; else
    echo "FAIL $1: wanted /$2/"
    echo "$3" | sed 's/^/    /'
    fail=1
  fi
}
absent() { # $1 name, $2 what must not be in the output, $3 the output
  if grep -Eq -- "$2" <<<"$3"; then
    echo "FAIL $1: did not want /$2/"
    echo "$3" | sed 's/^/    /'
    fail=1
  else echo "PASS $1: no /$2/"; fi
}

fresh_pi() { # $1 the world /api/status reports
  rm -rf "${FOUNDRY_DATA:?}" "${TOOL_DIR:?}" "${TOOL_ETC:?}" "${TOOL_DATA:?}" /root/seven-books-*.js /root/grave-domain-*.js
  rm -f /tmp/stopped-* /tmp/calls /tmp/logger /tmp/status /tmp/status_rc /tmp/started-kit
  mkdir -p "$FOUNDRY_DATA/Data/worlds" "$TOOL_DIR/gm-browser" "$TOOL_ETC" "$TOOL_DATA"
  echo '// stand-in' >"$TOOL_DIR/gm-browser/assistant-gm.mjs"
  echo 'GM_USER=Gamemaster' >"$TOOL_ETC/assistant-gm.env"
  printf '{"active":true,"world":"%s","users":0}' "$1" >/tmp/status
  echo 0 >/tmp/status_rc
  cp "$R/seven-books-trim.js" "$R/seven-books-baseline.js" "$R/seven-books-delete-legacy.js" "$R/grave-domain-patch.js" /root/
  : >/tmp/calls
}

# $1 the environment words (a single string), prints the output and "exit N"
run_stage() {
  local out rc
  out="$(cd /root && cat "$R/lib.sh" "$R/22-seven-books.sh" "$R/gm-script.sh" | env NO_SNAPSHOT=1 $1 bash -s 2>&1)"
  rc=$?
  printf '%s\nexit %s\n' "$out" "$rc"
}
want() { [ -z "${only// /}" ] || [[ "$only" == *" $1 "* ]]; }

if want dry-run; then
  fresh_pi curse-of-strahd
  out="$(run_stage '')"
  check dry-run 'dry run of /root/seven-books-trim.js' "$out"
  check dry-run 'dry run passed' "$out"
  check dry-run 'exit 0' "$out"
  check dry-run '--dry-run' "$(cat /tmp/calls)"
fi

if want real-needs-dry-run; then
  fresh_pi curse-of-strahd
  out="$(run_stage 'APPLY=1')"
  check real-needs-dry-run 'no passed dry run of this script' "$out"
  absent real-needs-dry-run 'systemd-run' "$(cat /tmp/calls)"
fi

if want real-after-dry-run; then
  fresh_pi curse-of-strahd
  run_stage '' >/dev/null
  : >/tmp/calls
  out="$(run_stage 'APPLY=1')"
  check real-after-dry-run 'REAL run of /root/seven-books-trim.js' "$out"
  check real-after-dry-run 'a dry run of this script .* passed before' "$out"
  check real-after-dry-run 'exit 0' "$out"
  absent real-after-dry-run '--dry-run' "$(cat /tmp/calls)"
fi

if want wrong-world; then
  fresh_pi strahd-kit
  out="$(run_stage '')"
  check wrong-world 'world strahd-kit is running, not curse-of-strahd' "$out"
  check wrong-world 'exit 1' "$out"
  absent wrong-world 'systemd-run' "$(cat /tmp/calls)"
fi

if want players-online; then
  fresh_pi curse-of-strahd
  printf '{"active":true,"world":"curse-of-strahd","users":2}' >/tmp/status
  out="$(run_stage '')"
  check players-online '2 player\(s\) are online' "$out"
  check players-online 'exit 1' "$out"
fi

if want delete-needs-ok; then
  fresh_pi curse-of-strahd
  out="$(run_stage 'MODE=delete APPLY=1')"
  check delete-needs-ok 'DELETE_LEGACY=with-the-users-ok' "$out"
  check delete-needs-ok 'exit 1' "$out"
  absent delete-needs-ok 'systemd-run' "$(cat /tmp/calls)"
  # the dry run needs no OK
  out="$(run_stage 'MODE=delete')"
  check delete-needs-ok 'dry run of /root/seven-books-delete-legacy.js' "$out"
fi

if want no-upload; then
  fresh_pi curse-of-strahd
  rm -f /root/seven-books-trim.js
  out="$(run_stage '')"
  check no-upload 'scp the GM scripts' "$out"
  check no-upload 'exit 1' "$out"
fi

if want gm-script-env-ignored; then
  # GM_SCRIPT in the environment must not turn MODE=trim into the delete script (or skip the DELETE_LEGACY check)
  fresh_pi curse-of-strahd
  out="$(run_stage 'GM_SCRIPT=/root/seven-books-delete-legacy.js')"
  check gm-script-env-ignored 'dry run of /root/seven-books-trim.js' "$out"
  check gm-script-env-ignored 'GM script /root/seven-books-trim.js' "$out"
  absent gm-script-env-ignored 'seven-books-delete-legacy' "$(cat /tmp/calls) $out"
  fresh_pi curse-of-strahd
  out="$(run_stage 'GM_SCRIPT=/root/seven-books-delete-legacy.js MODE=delete APPLY=1')"
  check gm-script-env-ignored 'DELETE_LEGACY=with-the-users-ok' "$out"
  absent gm-script-env-ignored 'systemd-run' "$(cat /tmp/calls)"
fi

if want apply-must-be-1; then
  fresh_pi curse-of-strahd
  out="$(run_stage 'APPLY=0')"
  check apply-must-be-1 'APPLY must be 1 or left out' "$out"
  check apply-must-be-1 'exit 1' "$out"
  absent apply-must-be-1 'systemd-run' "$(cat /tmp/calls)"
fi

if want other-worlds; then
  fresh_pi curse-of-strahd
  mkdir -p "$FOUNDRY_DATA/Data/worlds/curse-of-strahd" "$FOUNDRY_DATA/Data/worlds/strahd-kit"
  out="$(run_stage '')"
  check other-worlds 'other worlds \(strahd-kit\) share the edited module packs' "$out"
  check other-worlds 'exit 0' "$out"
  # a real run needs the OK for the other worlds, and then the dry run that has just passed
  out="$(run_stage 'APPLY=1')"
  check other-worlds 'OTHER_WORLDS_OK=1' "$out"
  check other-worlds 'exit 1' "$out"
  out="$(run_stage 'APPLY=1 OTHER_WORLDS_OK=1')"
  check other-worlds 'REAL run of /root/seven-books-trim.js' "$out"
  check other-worlds 'exit 0' "$out"
fi

if want check-mode; then
  # MODE=check is always a dry run of the trim script with CHECK_ONLY in front; it takes no APPLY and needs no snapshot
  fresh_pi curse-of-strahd
  out="$(run_stage 'MODE=check')"
  check check-mode 'dry run of /root/seven-books-check.js' "$out"
  check check-mode 'exit 0' "$out"
  check check-mode '^const CHECK_ONLY = true;$' "$(head -n 1 /root/seven-books-check.js)"
  check check-mode '--dry-run' "$(cat /tmp/calls)"
  fresh_pi curse-of-strahd
  out="$(run_stage 'MODE=check APPLY=1')"
  check check-mode 'MODE=check only reads' "$out"
  check check-mode 'exit 1' "$out"
  absent check-mode 'systemd-run' "$(cat /tmp/calls)"
  fresh_pi curse-of-strahd
  rm -f /root/seven-books-trim.js
  out="$(run_stage 'MODE=check')"
  check check-mode 'scp the GM scripts' "$out"
fi

if want baseline; then
  # MODE=baseline: the baseline GM script, a dry run first, the real run only after a passed dry run of the same file
  fresh_pi curse-of-strahd
  out="$(run_stage 'MODE=baseline')"
  check baseline 'dry run of /root/seven-books-baseline.js' "$out"
  check baseline 'dry run passed' "$out"
  check baseline 'exit 0' "$out"
  check baseline '--dry-run' "$(cat /tmp/calls)"
  : >/tmp/calls
  out="$(run_stage 'MODE=baseline APPLY=1')"
  check baseline 'REAL run of /root/seven-books-baseline.js' "$out"
  check baseline 'exit 0' "$out"
  absent baseline '--dry-run' "$(cat /tmp/calls)"
  fresh_pi curse-of-strahd
  out="$(run_stage 'MODE=baseline APPLY=1')"
  check baseline 'no passed dry run of this script' "$out"
  absent baseline 'systemd-run' "$(cat /tmp/calls)"
  # the baseline edits the shared module packs too: the other-worlds OK applies
  fresh_pi curse-of-strahd
  mkdir -p "$FOUNDRY_DATA/Data/worlds/curse-of-strahd" "$FOUNDRY_DATA/Data/worlds/strahd-kit"
  run_stage 'MODE=baseline' >/dev/null
  out="$(run_stage 'MODE=baseline APPLY=1')"
  check baseline 'OTHER_WORLDS_OK=1' "$out"
  check baseline 'exit 1' "$out"
  fresh_pi curse-of-strahd
  rm -f /root/seven-books-baseline.js
  out="$(run_stage 'MODE=baseline')"
  check baseline 'scp the GM scripts' "$out"
  check baseline 'exit 1' "$out"
fi

if want baseline-undo; then
  # MODE=baseline-undo runs the baseline file with BASELINE_MODE 'undo' in front, as its own file
  fresh_pi curse-of-strahd
  out="$(run_stage 'MODE=baseline-undo')"
  check baseline-undo 'dry run of /root/seven-books-baseline-undo.js' "$out"
  check baseline-undo 'exit 0' "$out"
  check baseline-undo "^const BASELINE_MODE = 'undo';$" "$(head -n 1 /root/seven-books-baseline-undo.js)"
  check baseline-undo '--dry-run' "$(cat /tmp/calls)"
  fresh_pi curse-of-strahd
  rm -f /root/seven-books-baseline.js
  out="$(run_stage 'MODE=baseline-undo')"
  check baseline-undo 'scp the GM scripts' "$out"
  check baseline-undo 'exit 1' "$out"
fi

if want check-mode-baseline; then
  # MODE=check also checks the baseline when its script is uploaded: both checks in one file, the baseline one last
  fresh_pi curse-of-strahd
  out="$(run_stage 'MODE=check')"
  check check-mode-baseline 'exit 0' "$out"
  check check-mode-baseline "BASELINE_MODE = 'check';" "$(cat /root/seven-books-check.js)"
  check check-mode-baseline '^const CHECK_ONLY = true;$' "$(head -n 1 /root/seven-books-check.js)"
  # without the baseline script the check is the trim check alone
  fresh_pi curse-of-strahd
  rm -f /root/seven-books-baseline.js
  out="$(run_stage 'MODE=check')"
  check check-mode-baseline 'exit 0' "$out"
  absent check-mode-baseline "BASELINE_MODE" "$(cat /root/seven-books-check.js)"
fi

if want grave; then
  # MODE=grave-patch: the Grave Domain patch, dry run first; MODE=grave-check is a read-only dry run of the same file with
  # GRAVE_MODE 'check' in front (no APPLY, no snapshot)
  fresh_pi curse-of-strahd
  out="$(run_stage 'MODE=grave-patch')"
  check grave 'dry run of /root/grave-domain-patch.js' "$out"
  check grave 'exit 0' "$out"
  out="$(run_stage 'MODE=grave-patch APPLY=1')"
  check grave 'REAL run of /root/grave-domain-patch.js' "$out"
  check grave 'passed before' "$out"
  check grave 'exit 0' "$out"
  fresh_pi curse-of-strahd
  out="$(run_stage 'MODE=grave-check')"
  check grave 'dry run of /root/grave-domain-check.js' "$out"
  check grave "^const GRAVE_MODE = 'check';$" "$(head -n 1 /root/grave-domain-check.js)"
  out="$(run_stage 'MODE=grave-check APPLY=1')"
  check grave 'MODE=grave-check only reads' "$out"
  check grave 'exit 1' "$out"
  # MODE=check puts the grave check in the combined file when the patch is uploaded
  fresh_pi curse-of-strahd
  out="$(run_stage 'MODE=check')"
  check grave 'exit 0' "$out"
  check grave "GRAVE_MODE = 'check';" "$(cat /root/seven-books-check.js)"
fi

if want grave-no-upload; then
  # grave-check without the file uploaded: refused, nothing changed
  fresh_pi curse-of-strahd
  rm -f /root/grave-domain-patch.js
  out="$(run_stage 'MODE=grave-check')"
  check grave-no-upload 'no /root/grave-domain-patch.js' "$out"
  check grave-no-upload 'exit 1' "$out"
fi

if want bad-mode; then
  fresh_pi curse-of-strahd
  out="$(run_stage 'MODE=wipe')"
  check bad-mode 'MODE must be trim, check, baseline, baseline-undo, delete, grave-patch or grave-check' "$out"
fi

[ "$fail" = 0 ] && echo "ALL PASSED" || echo "FAIL: see above"
exit "$fail"
