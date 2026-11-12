#!/usr/bin/env bash
# Stage 28 (scripts/pi/remote/28-gm-watchdog.sh) and the Assistant GM driver's page ping, in a Debian 13 ARM64 container
# with no systemd: stand-ins for systemctl and journalctl make the stage take its systemd path. The frozen-page scenario runs
# the real driver against a stand-in playwright-core whose page stops answering (scripts/pi/gm-watchdog.test.mjs) on ARM64
# Node. Each scenario prints PASS or FAIL lines:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" <IMAGE> bash /repo/scripts/pi/container-test/stage28-scenarios.sh [name ...]
# DESTRUCTIVE: it wipes the tool folders and installs the fakes into /usr/local/sbin. It refuses to run anywhere but a container.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_test_container


H=/repo/scripts/pi/container-test
R=/repo/scripts/pi/remote
only=" $* "
mkdir -p /opt/node24/bin /run/systemd/system
ln -sf "$(command -v node)" /opt/node24/bin/node
for f in systemctl curl journalctl sleep logger; do install -m 755 "$H/bin/$f" "/usr/local/sbin/$f"; done
eval "$(grep -E '^(FOUNDRY_USER|FOUNDRY_APP|FOUNDRY_DATA|TOOL_DIR|TOOL_ETC|TOOL_DATA)=' "$R/lib.sh")"
id "$FOUNDRY_USER" >/dev/null 2>&1 || useradd --system --home-dir "$FOUNDRY_DATA" --shell /usr/sbin/nologin "$FOUNDRY_USER"
DRIVER="$TOOL_DIR/gm-browser/assistant-gm.mjs"
NEW=/root/assistant-gm.mjs

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
want() { [ -z "${only// /}" ] || [[ "$only" == *" $1 "* ]]; }

fresh_pi() {
  rm -rf "${FOUNDRY_DATA:?}" "${FOUNDRY_APP:?}" "${TOOL_DIR:?}" "${TOOL_ETC:?}" "${TOOL_DATA:?}" /var/lib/foundry-import
  rm -f /tmp/stopped-* /tmp/disabled-* /tmp/calls /tmp/gm-nojoin /tmp/gm-stale /tmp/gm-noarmed /tmp/gmbroken "$NEW"
  mkdir -p "$FOUNDRY_DATA" "$FOUNDRY_APP" "$TOOL_DIR/gm-browser" "$TOOL_ETC" "$TOOL_DATA"
  echo '// old driver' >"$DRIVER"
  printf '%s\n' '// assistant-gm features: extra-gm link-check page-ping page-armed-log' 'console.log("new driver");' >"$NEW"
  echo fake-invocation-1 >/tmp/gm-invocation
  printf '{"active":true,"world":"curse-of-strahd","users":0}' >/tmp/status
  echo 0 >/tmp/status_rc
  : >/tmp/calls
}

# $1 the environment words (a single string), prints the output and "exit N"
run_stage() {
  local out rc
  out="$(cd /root && cat "$R/lib.sh" "$R/28-gm-watchdog.sh" | env NO_SNAPSHOT=1 $1 bash -s 2>&1)"
  rc=$?
  printf '%s\nexit %s\n' "$out" "$rc"
}

if want frozen-page; then
  out="$(cd /tmp && node --test --test-name-pattern='frozen page|page ping' /repo/scripts/pi/gm-watchdog.test.mjs 2>&1)"
  rc=$?
  if [ "$rc" = 0 ]; then echo "PASS frozen-page: the driver restarts a page that stops answering, on $(uname -m) node $(node -v)"; else
    echo "FAIL frozen-page"
    echo "$out" | tail -40 | sed 's/^/    /'
    fail=1
  fi
fi

if want dry-run; then
  fresh_pi
  before="$(sha256sum "$DRIVER")"
  out="$(run_stage '')"
  check dry-run 'the deployed driver has no page watchdog yet' "$out"
  check dry-run 'dry run: nothing was changed' "$out"
  check dry-run 'exit 0' "$out"
  [ "$before" = "$(sha256sum "$DRIVER")" ] && echo "PASS dry-run: driver unchanged" || {
    echo "FAIL dry-run: driver changed"
    fail=1
  }
  absent dry-run 'restart' "$(cat /tmp/calls)"
fi

if want apply; then
  fresh_pi
  out="$(run_stage 'APPLY=1')"
  check apply 'old driver kept as .*assistant-gm\.mjs\.prev-' "$out"
  check apply 'joined the world again with the page watchdog on' "$out"
  check apply 'exit 0' "$out"
  grep -q 'new driver' "$DRIVER" && echo "PASS apply: new driver installed" || {
    echo "FAIL apply: driver not installed"
    fail=1
  }
  grep -q 'old driver' "$TOOL_DIR"/gm-browser/assistant-gm.mjs.prev-* && echo "PASS apply: old driver kept" || {
    echo "FAIL apply: no backup"
    fail=1
  }
  check apply 'restart foundry-ai-tool-gm-browser.service' "$(cat /tmp/calls)"
  absent apply 'restart foundry.service' "$(cat /tmp/calls)"
  out="$(run_stage 'APPLY=1')"
  check rerun 'already this one' "$out"
  check rerun 'exit 0' "$out"
  out="$(run_stage 'UNDO=1')"
  check undo 'putting .*assistant-gm\.mjs\.prev-.* back' "$out"
  check undo 'the old driver is back' "$out"
  check undo 'it has no page watchdog' "$out"
  grep -q 'old driver' "$DRIVER" && echo "PASS undo: old driver back" || {
    echo "FAIL undo: not restored"
    fail=1
  }
  # the newest .prev-* is now the deployed driver: a second UNDO changes and restarts nothing
  : >/tmp/calls
  out="$(run_stage 'UNDO=1')"
  check undo-twice 'is the deployed driver already' "$out"
  check undo-twice 'exit 0' "$out"
  absent undo-twice 'restart' "$(cat /tmp/calls)"
fi

if want undo-older-build; then
  # the .prev-* put back already has the page watchdog: the message must not say it is off
  fresh_pi
  printf '%s\n' '// assistant-gm features: page-ping' 'console.log("older watch driver");' >"$DRIVER"
  out="$(run_stage 'APPLY=1')"
  check undo-older-build-setup 'exit 0' "$out"
  out="$(run_stage 'UNDO=1')"
  check undo-older-build 'it has the page watchdog too' "$out"
  absent undo-older-build 'has no page watchdog' "$out"
  check undo-older-build 'exit 0' "$out"
fi

if want not-armed; then
  # the browser joins but the journal has no "page watchdog armed" line (GM_PAGE_WATCH=0): not a pass, the old driver goes back
  fresh_pi
  touch /tmp/gm-noarmed
  out="$(run_stage 'APPLY=1')"
  check not-armed "no 'page watchdog armed' line" "$out"
  check not-armed 'did not rejoin with the new driver: putting the old one back' "$out"
  absent not-armed 'joined the world again' "$out"
  check not-armed 'exit 1' "$out"
  grep -q 'old driver' "$DRIVER" && echo "PASS not-armed: old driver back" || {
    echo "FAIL not-armed: old driver not restored"
    fail=1
  }
fi

if want stale-invocation; then
  # only the run before the restart has the join line; the new run has none: the read-back must roll back
  fresh_pi
  touch /tmp/gm-stale
  out="$(run_stage 'APPLY=1')"
  check stale 'did not rejoin with the new driver: putting the old one back' "$out"
  check stale 'the old one is back' "$out"
  absent stale 'joined the world again' "$out"
  check stale 'exit 1' "$out"
  grep -q 'old driver' "$DRIVER" && echo "PASS stale: old driver back" || {
    echo "FAIL stale: old driver not restored"
    fail=1
  }
fi

if want stopped-unit; then
  fresh_pi
  touch /tmp/stopped-foundry-ai-tool-gm-browser.service
  out="$(run_stage 'APPLY=1')"
  check stopped 'was not running: left stopped' "$out"
  check stopped 'exit 0' "$out"
  absent stopped 'restart foundry-ai-tool-gm-browser' "$(cat /tmp/calls)"
  absent stopped 'joined the world again' "$out"
  check stopped 'the Assistant GM is stopped, so the watchdog starts with its next start' "$out"
fi

if want players-online; then
  fresh_pi
  printf '{"active":true,"world":"curse-of-strahd","users":3}' >/tmp/status
  out="$(run_stage 'APPLY=1')"
  check players 'player\(s\) are online' "$out"
  check players 'exit 1' "$out"
  absent players 'restart foundry-ai-tool-gm-browser' "$(cat /tmp/calls)"
  grep -q 'old driver' "$DRIVER" && echo "PASS players: driver unchanged" || {
    echo "FAIL players: driver changed"
    fail=1
  }
fi

if want cut-over; then
  fresh_pi
  touch /tmp/disabled-foundry-ai-tool-gm-browser.service
  out="$(run_stage 'APPLY=1')"
  check cut-over 'is disabled' "$out"
  check cut-over 'exit 1' "$out"
  absent cut-over 'restart' "$(cat /tmp/calls)"
fi

if want failed-join; then
  fresh_pi
  touch /tmp/gm-nojoin
  out="$(run_stage 'APPLY=1')"
  check failed-join 'did not rejoin with the new driver: putting the old one back' "$out"
  check failed-join 'the old one is back' "$out"
  check failed-join 'exit 1' "$out"
  grep -q 'old driver' "$DRIVER" && echo "PASS failed-join: old driver back" || {
    echo "FAIL failed-join: old driver not restored"
    fail=1
  }
fi

if want refusals; then
  fresh_pi
  echo '// assistant-gm features: extra-gm link-check' >"$NEW"
  out="$(run_stage 'APPLY=1')"
  check old-source 'does not name the page-ping feature' "$out"
  check old-source 'exit 1' "$out"
  printf '%s\n' '// assistant-gm features: page-ping' 'console.log("page-ping driver from before the armed line");' >"$NEW"
  out="$(run_stage 'APPLY=1')"
  check no-armed-feature 'does not name the page-armed-log feature' "$out"
  check no-armed-feature 'exit 1' "$out"
  printf '%s\n' '// assistant-gm features: page-ping page-armed-log' 'let (' >"$NEW"
  out="$(run_stage 'APPLY=1')"
  check syntax 'does not parse' "$out"
  rm -f "$NEW"
  out="$(run_stage 'APPLY=1')"
  check no-source 'no new driver at' "$out"
  fresh_pi
  out="$(run_stage 'APPLY=yes')"
  check bad-apply 'APPLY must be 1 or left out' "$out"
  out="$(run_stage 'APPLY=1 UNDO=1')"
  check both 'pick one' "$out"
  out="$(run_stage 'UNDO=1')"
  check undo-none 'no assistant-gm.mjs.prev-' "$out"
  rm -f "$DRIVER"
  out="$(run_stage 'APPLY=1')"
  check no-stage5 'run stage 5 first' "$out"
  absent refusals 'restart' "$(cat /tmp/calls)"
fi

[ "$fail" = 0 ] && echo "ALL PASSED" || echo "FAIL: see above"
exit "$fail"
