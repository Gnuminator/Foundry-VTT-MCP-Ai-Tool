#!/usr/bin/env bash
# Stage 16 (scripts/pi/remote/16-board-status.sh) in a Debian 13 ARM64 container with no systemd: stand-ins for
# systemctl, curl and restic make it take its systemd path and "send" its first report. Each scenario starts from a
# fresh fake Pi and checks its own result; the last line is ALL SCENARIOS OK when every one passed:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" debian:13-slim bash /repo/scripts/pi/container-test/stage16-scenarios.sh [name ...]
# (scripts/pi/board-status.test.mjs runs it with PI_STAGE16_CONTAINER=1.) With names, only those scenarios run.
# The stage's node snippets run on Debian 13's own nodejs linked as /opt/node24/bin/node, not Node 24 as on the Pi.
#
# DESTRUCTIVE: each scenario wipes the tool's folders, and the fakes go into /usr/local/sbin. It refuses to run
# anywhere but a container. Nothing here reaches the network after apt-get.
set -uo pipefail

[ -f /.dockerenv ] || [ -n "${container:-}" ] || {
  echo "REFUSED: run this only in the test container (docker run ..., see the header)"
  exit 98
}

STAGE=/repo/scripts/pi/remote/16-board-status.sh
LIB=/repo/scripts/pi/remote/lib.sh
only="$*"

export DEBIAN_FRONTEND=noninteractive
apt_setup() { apt-get update && apt-get install -y --no-install-recommends nodejs curl ca-certificates; }
# One retry: a Debian mirror hiccup should not fail a required CI check.
{ apt_setup || { /bin/sleep 20 && apt_setup; }; } >/dev/null 2>&1 || {
  echo "SETUP FAILED: apt-get"
  exit 99
}
mkdir -p /opt/node24/bin /run/systemd/system
ln -sf "$(command -v node)" /opt/node24/bin/node
real_curl="$(command -v curl)"
eval "$(grep -E '^(TOOL_DIR|TOOL_ETC)=' "$LIB")"

cat >/usr/local/sbin/systemctl <<'EOF'
#!/usr/bin/env bash
echo "systemctl $*" >>/tmp/calls
case "${1:-}" in
  show) echo success ;;
  start | restart) touch "/tmp/active-${@: -1}" ;;
  is-active) [ -f "/tmp/active-${@: -1}" ] || exit 3 ;;
esac
exit 0
EOF
cat >/usr/local/sbin/restic <<'EOF'
#!/usr/bin/env bash
echo '[{"time":"2026-10-23T02:31:09Z","id":"deadbeef"}]'
EOF
# curl stand-in: /api/status answers a Foundry; a POST (--data-binary) is recorded without the -K file's content and
# answers the code in /tmp/post-code (default 204).
cat >/usr/local/sbin/curl <<'EOF'
#!/usr/bin/env bash
case "${*: -1}" in
  */api/status) echo '{"active":true,"version":"14.368","system":"dnd5e","systemVersion":"6.0.5","users":1}'; exit 0 ;;
esac
case "$*" in
  *--data-binary*)
    printf '%s\n' "$*" >/tmp/post-args
    cat >/tmp/post-body
    cat /tmp/post-code 2>/dev/null || printf 204
    exit 0 ;;
esac
echo "fake curl: unexpected call" >&2
exit 22
EOF
chmod 755 /usr/local/sbin/systemctl /usr/local/sbin/restic /usr/local/sbin/curl
: "$real_curl"

SECRET_ID='abc123.access'
SECRET_VAL='s3cr3t-value-xyz'
fails=0

fresh_pi() {
  rm -rf "${TOOL_DIR:?}" "${TOOL_ETC:?}"
  rm -f /etc/systemd/system/foundry-board-status.* /tmp/active-* /tmp/calls /tmp/post-args /tmp/post-body /tmp/post-code
  mkdir -p "$TOOL_ETC" "$TOOL_DIR" /etc/systemd/system
}

# conf CONTENT MODE: write the token file.
conf() {
  printf '%s' "$1" >"$TOOL_ETC/board-status.conf"
  chmod "$2" "$TOOL_ETC/board-status.conf"
  chown root:root "$TOOL_ETC/board-status.conf"
}
good_conf() { conf "header = \"CF-Access-Client-Id: $SECRET_ID\"
header = \"CF-Access-Client-Secret: $SECRET_VAL\"
" 600; }

# DEBUG_OUT=1 (in the container's environment) prints the stage's output after each run.
run_stage() {
  cat "$LIB" "$STAGE" | bash -s >/tmp/out 2>&1
  echo $? >/tmp/rc
  [ -z "${DEBUG_OUT:-}" ] || cat /tmp/out
}

check() { # check NAME CONDITION-COMMAND...
  local name="$1"
  shift
  if "$@"; then :; else
    echo "FAIL $SCEN: $name"
    fails=$((fails + 1))
  fi
}
no_secret_in_output() { ! grep -qE "$SECRET_VAL|$SECRET_ID" /tmp/out; }
nothing_installed() { [ ! -e "$TOOL_DIR/status" ] && [ ! -e /etc/systemd/system/foundry-board-status.timer ]; }
refused() { [ "$(cat /tmp/rc)" != 0 ]; }

scenario() {
  SCEN="$1"
  if [ -n "$only" ] && [[ " $only " != *" $SCEN "* ]]; then return 1; fi
  fresh_pi
  return 0
}

if scenario no-token-file; then
  run_stage
  check "refused" refused
  check "nothing installed" nothing_installed
  check "says the file is missing" grep -q 'board-status.conf is missing' /tmp/out
fi

if scenario loose-mode; then
  good_conf
  chmod 644 "$TOOL_ETC/board-status.conf"
  run_stage
  check "refused" refused
  check "nothing installed" nothing_installed
  check "no secret printed" no_secret_in_output
fi

if scenario extra-line; then
  conf "header = \"CF-Access-Client-Id: $SECRET_ID\"
header = \"CF-Access-Client-Secret: $SECRET_VAL\"
url = \"http://evil.example/\"
" 600
  run_stage
  check "refused" refused
  check "nothing installed" nothing_installed
  check "names line 3" grep -q 'line 3' /tmp/out
  check "does not print the line" bash -c '! grep -q evil /tmp/out'
  check "no secret printed" no_secret_in_output
fi

if scenario no-secret-header; then
  conf "header = \"CF-Access-Client-Id: $SECRET_ID\"
" 600
  run_stage
  check "refused" refused
  check "nothing installed" nothing_installed
fi

if scenario symlinked-token; then
  good_conf
  mv "$TOOL_ETC/board-status.conf" /tmp/real-conf
  ln -s /tmp/real-conf "$TOOL_ETC/board-status.conf"
  run_stage
  check "refused" refused
  check "nothing installed" nothing_installed
  rm -f /tmp/real-conf
fi

if scenario installs-and-reports; then
  good_conf
  run_stage
  check "exit 0" bash -c '[ "$(cat /tmp/rc)" = 0 ]'
  check "status script installed 0755" bash -c '[ "$(stat -c %a '"$TOOL_DIR"'/status/board-status.sh)" = 755 ]'
  check "timer written hourly" grep -q 'OnCalendar=\*-\*-\* \*:07:00' /etc/systemd/system/foundry-board-status.timer
  check "timer enabled" grep -q 'enable foundry-board-status.timer' /tmp/calls
  check "the timer is started" grep -q 'start foundry-board-status.timer' /tmp/calls
  check "first report posted" test -s /tmp/post-body
  check "body is the report" node -e '
const p = JSON.parse(require("fs").readFileSync("/tmp/post-body", "utf8"));
if (p.host !== "foundry-pi" || p.foundry.version !== "14.368" || p.foundry.dnd5e !== "6.0.5" || p.backup.result !== "success") process.exit(1);
if (Object.keys(p).sort().join() !== "backup,disk,foundry,host,sentAt,uptimeSeconds,v") process.exit(1);'
  check "token not in the curl arguments" bash -c "! grep -qE '$SECRET_VAL|$SECRET_ID' /tmp/post-args"
  check "token not in the body" bash -c "! grep -qE '$SECRET_VAL|$SECRET_ID' /tmp/post-body"
  check "no secret printed" no_secret_in_output
  check "token file untouched" bash -c '[ "$(stat -c "%u %a" '"$TOOL_ETC"'/board-status.conf)" = "0 600" ]'
  # Second run: nothing to rewrite, still fine.
  run_stage
  check "rerun exit 0" bash -c '[ "$(cat /tmp/rc)" = 0 ]'
  check "rerun says unchanged" grep -q 'board-status.sh unchanged' /tmp/out
fi

if scenario board-says-403; then
  good_conf
  printf 403 >/tmp/post-code
  run_stage
  check "stage fails on the first report" refused
  check "timer still installed" test -e /etc/systemd/system/foundry-board-status.timer
  check "says HTTP 403" grep -q 'HTTP 403' /tmp/out
  check "no secret printed" no_secret_in_output
fi

if [ "$fails" = 0 ]; then
  echo "ALL SCENARIOS OK"
else
  echo "$fails check(s) failed"
  exit 1
fi
