#!/usr/bin/env bash
# Pi stage 24 (scripts/pi/remote/24-compose.sh, MODE=status|up|down|cutover|rollback) in a Debian 13 ARM64 container with the real
# lib.sh and stand-ins for systemctl, docker (compose ps/up/down/config, inspect, logs), ss and tailscale-free state. The stand-ins
# keep the units and the containers as files, so a cutover really flips them and a rollback really flips them back. Everything
# the stage writes goes into a sandbox folder (lib.sh's paths are pointed there after it is sourced); the scenarios change
# nothing outside /tmp and also run in Git Bash. The last line is ALL SCENARIOS OK when every one passed:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" debian:13-slim bash /repo/scripts/pi/container-test/stage24-scenarios.sh
# (scripts/pi/docker-compose.test.mjs runs it with PI_STAGE23_CONTAINER=1.) STAGE=<file> runs it against another copy of the script.
# Scenarios: bad MODE; status (clean, and a unit next to the stack = exit 1); up refused on live ports and on the live data folder
# while a unit runs, up on rehearsal ports beside the units, up with the units off, up on a busy port, up unhealthy, up without a
# snapshot; down (quiet check, the Assistant GM not counted); cutover (order of the stops, the record, the start), unhealthy ->
# automatic rollback, players online, no snapshot, a control port beyond loopback, a unit that will not stop, a port that stays
# busy, a rerun, a dry run; rollback (order, only the recorded units, a stack that will not go down); 19 a closed stdout;
# 20 up on the live ports refused, a rehearsal left running seen by status and down; 21 a rehearsal on live data folders or on
# one live port, a dry run writes no log, the cutover record is cleared after a rollback.
set -uo pipefail

REPO="${REPO:-/repo}"
STAGE="${STAGE:-$REPO/scripts/pi/remote/24-compose.sh}"
LIB="$REPO/scripts/pi/remote/lib.sh"
fails=0
pass() { echo "ok: $*"; }
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }

root="$(mktemp -d)"
trap 'rm -rf "${root:?}"' EXIT
n=0
all_units="foundry.service foundry-ai-tool-bridge.service foundry-ai-tool-dashboard.service foundry-ai-tool-gm-browser.service"

new_pi() { # opts: nosnapshot, nobrowser (no Assistant GM unit)
  SB="$root/pi.$((++n))"
  BIN="$SB/bin"
  FAKE="$SB/fake"
  mkdir -p "$BIN" "$FAKE/c" "$FAKE/logs" "$SB/tool/app/deploy/pi" "$SB/etc" "$SB/data" "$SB/foundry-app" "$SB/foundry-data" "$SB/dietpi"
  : >"$FAKE/calls"
  : >"$SB/tool/app/deploy/pi/compose.yml"
  echo "FOUNDRY_UID=996" >"$SB/tool/app/deploy/pi/.env"
  : >"$SB/etc/bridge.env"
  echo 0 >"$FAKE/online"
  echo 0 >"$FAKE/ctl_rc"
  if [[ " $* " == *" nosnapshot "* ]]; then echo "2020-01-01_01:25:00  Backup completed" >"$SB/stats"; else echo "$(date +%F)_01:25:00  Backup completed" >"$SB/stats"; fi
  local u
  for u in $all_units; do
    [[ "$u" == *gm-browser* && " $* " == *" nobrowser "* ]] && continue
    touch "$FAKE/exists-$u" "$FAKE/enabled-$u" "$FAKE/active-$u"
  done
  write_stubs
}

write_stubs() {
  cat >"$BIN/systemctl" <<EOF
#!/usr/bin/env bash
F="$FAKE"
EOF
  cat >>"$BIN/systemctl" <<'EOF'
echo "systemctl $*" >>"$F/calls"
u=""; now=0
for a in "$@"; do case "$a" in *.service) u="$a" ;; --now) now=1 ;; esac; done
case "$1" in
  is-active) if [ -f "$F/active-$u" ]; then [ "$2" = --quiet ] || echo active; exit 0; else [ "$2" = --quiet ] || echo inactive; exit 3; fi ;;
  is-enabled) if [ -f "$F/enabled-$u" ]; then echo enabled; exit 0; else echo disabled; exit 1; fi ;;
  cat) [ -f "$F/exists-$u" ] ;;
  disable) rm -f "$F/enabled-$u"; if [ "$now" = 1 ] && [ ! -f "$F/stuck-$u" ]; then rm -f "$F/active-$u"; fi ;;
  enable) [ -f "$F/exists-$u" ] || exit 1; touch "$F/enabled-$u"; if [ "$now" = 1 ] && [ ! -f "$F/startfail-$u" ]; then touch "$F/active-$u"; fi ;;
  start | restart) [ -f "$F/startfail-$u" ] || touch "$F/active-$u" ;;
  stop) rm -f "$F/active-$u" ;;
esac
exit 0
EOF
  cat >"$BIN/ss" <<EOF
#!/usr/bin/env bash
F="$FAKE"
EOF
  cat >>"$BIN/ss" <<'EOF'
p="${@: -1}"; p="${p##*:}"
if grep -qx "$p" "$F/busy" 2>/dev/null; then echo "LISTEN 0 511 127.0.0.1:$p 0.0.0.0:*"; fi
exit 0
EOF
  cat >"$BIN/docker" <<EOF
#!/usr/bin/env bash
F="$FAKE"
EOF
  cat >>"$BIN/docker" <<'EOF'
echo "docker $*" >>"$F/calls"
svcs="foundry bridge dashboard gm-browser"
case "$1" in
  info) [ ! -f "$F/daemon-down" ] || exit 1 ;;
  image) [ ! -f "$F/missing-image" ] || exit 1 ;;
  ps)
    # docker ps -q|-aq --filter label=com.docker.compose.project=P [--filter label=com.docker.compose.service=S]
    [ ! -f "$F/daemon-down" ] || exit 1
    shift; all=0; proj=""; want=""
    while [ $# -gt 0 ]; do
      case "$1" in
        -aq) all=1 ;;
        --filter) shift
          case "$1" in
            label=com.docker.compose.project=*) proj="${1#label=com.docker.compose.project=}" ;;
            label=com.docker.compose.service=*) want="${1#label=com.docker.compose.service=}" ;;
          esac ;;
      esac
      shift
    done
    for s in $svcs; do
      [ -f "$F/c/$s" ] || continue
      [ "$(cat "$F/p-$s" 2>/dev/null || echo foundry-ai-tool-pi)" = "$proj" ] || continue
      [ -z "$want" ] || [ "$want" = "$s" ] || continue
      read -r st h r <"$F/c/$s"
      [ "$all" = 1 ] || [ "$st" = running ] || continue
      # The real docker ps -q prints container ids, not names: the stand-in uses cid-<service> and strips it again.
      echo "cid-$s"
    done ;;
  update | stop) ;;
  rm) [ ! -f "$F/rm-fail" ] || exit 1
      for a in "$@"; do case "$a" in rm | -f) ;; *) rm -f "$F/c/${a#cid-}" ;; esac; done ;;
  inspect)
    case "$*" in
      *StartedAt*) echo 2026-11-03T10:00:00Z ;;
      *) last="${@: -1}"; cat "$F/c/${last#cid-}" 2>/dev/null || exit 1 ;;
    esac ;;
  logs) last="${@: -1}"; cat "$F/logs/${last#cid-}" 2>/dev/null; exit 0 ;;
  compose)
    proj="$5"
    # compose -f FILE -p PROJECT: like the real thing, it fails when the interpolation needs a .env that is gone
    [ -f "$(dirname "$3")/.env" ] || exit 1
    shift 5
    case "$1" in
      config)
        case "$2" in
          --services) for s in $svcs; do echo "$s"; done ;;
          --images) printf 'foundry-ai-tool-pi/foundry:local\nfoundry-ai-tool-pi/app:local\n' ;;
        esac ;;
      up)
        [ ! -f "$F/up-hard-fail" ] || exit 1
        for s in $svcs; do echo "running healthy 0" >"$F/c/$s"; echo "$proj" >"$F/p-$s"; done
        if [ -f "$F/up-unhealthy" ]; then echo "running unhealthy 0" >"$F/c/bridge"; exit 1; fi
        if [ -f "$F/gm-unhealthy" ]; then echo "running unhealthy 0" >"$F/c/gm-browser"; exit 1; fi ;;
      down)
        [ ! -f "$F/down-fail" ] || exit 1
        for s in $svcs; do
          [ "$(cat "$F/p-$s" 2>/dev/null || echo foundry-ai-tool-pi)" = "$proj" ] && rm -f "$F/c/$s"
        done ;;
    esac ;;
esac
exit 0
EOF
  # Root for require_root; anything else is the real id.
  cat >"$BIN/id" <<'EOF'
#!/usr/bin/env bash
if [ "$*" = "-u" ]; then echo 0; else /usr/bin/id "$@"; fi
EOF
  chmod +x "$BIN/systemctl" "$BIN/ss" "$BIN/docker" "$BIN/id"
}

run_stage() { # env assignments as arguments
  local f="$SB/run.sh" kv
  {
    cat "$LIB"
    printf '%s\n' "have_systemd() { return 0; }" "sleep() { :; }" \
      "TOOL_DIR=$SB/tool" "TOOL_ETC=$SB/etc" "TOOL_DATA=$SB/data" "NODE_DIR=$SB/node24" \
      "FOUNDRY_APP=$SB/foundry-app" "FOUNDRY_DATA=$SB/foundry-data" \
      'users_online() { cat "'"$FAKE"'/online"; }' \
      'control_port_check() { return "$(cat "'"$FAKE"'/ctl_rc")"; }'
    cat "$STAGE"
  } >"$f"
  OUT="$(
    export TEST_ALLOW_CUTOVER=1
    for kv in "$@"; do export "${kv?}"; done
    export PATH="$BIN:$PATH" DIETPI_DIR="$SB/dietpi" DIETPI_BACKUP_STATS="$SB/stats" PORT_WAIT=1 WAIT_TIMEOUT=5
    unset FOUNDRY_HTTP_PORT_UNSET
    bash "$f" 2>&1
  )"
  RC=$?
  CALLS="$(cat "$FAKE/calls")"
}
running_stack() { local s; for s in foundry bridge dashboard gm-browser; do echo "running healthy 0" >"$FAKE/c/$s"; done; }
unit_on() { [ -f "$FAKE/active-$1" ] && [ -f "$FAKE/enabled-$1" ]; }
unit_off() { [ ! -f "$FAKE/active-$1" ] && [ ! -f "$FAKE/enabled-$1" ]; }
all_on() { local u; for u in "$@"; do unit_on "$u" || return 1; done; }
all_off() { local u; for u in "$@"; do unit_off "$u" || return 1; done; }
stack_gone() { [ -z "$(ls "$FAKE/c")" ]; }
# order_ok PATTERN...: the first line matching each pattern comes later than the one before.
order_ok() {
  local prev=0 cur p
  for p in "$@"; do
    cur="$(echo "$CALLS" | grep -nE -- "$p" | head -n 1 | cut -d: -f1)"
    [ -n "$cur" ] && [ "$cur" -gt "$prev" ] || { echo "order: '$p' not after line $prev"; return 1; }
    prev="$cur"
  done
}
reh="FOUNDRY_HTTP_PORT=30100 BRIDGE_CONTROL_PORT=31614 BRIDGE_LINK_PORT=31615 DASHBOARD_PORT=3300"
bridge=foundry-ai-tool-bridge.service
dash=foundry-ai-tool-dashboard.service
gmb=foundry-ai-tool-gm-browser.service

# 1. MODE
new_pi
run_stage MODE=bogus
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'MODE must be'; then pass "an unknown MODE is refused"; else fail "mode (rc $RC): $OUT"; fi

# 2. status
new_pi
run_stage
if [ "$RC" -eq 0 ] && echo "$OUT" | grep -q 'foundry.service: enabled, active' && echo "$OUT" | grep -q 'foundry: no container' && [ "$(echo "$CALLS" | grep -cE 'systemctl (disable|enable|stop|start)|compose.* (up|down)')" -eq 0 ]; then
  pass "status (the default) reads units and containers and changes nothing"
else fail "status (rc $RC): $OUT"; fi
running_stack
run_stage MODE=status
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'at the same time'; then pass "status fails when a unit and the stack run together"; else fail "status mixed (rc $RC): $OUT"; fi

# 3. up refusals and starts. run_stage exports TEST_ALLOW_CUTOVER=1, so the live-port cases below (up with the units off,
# busy ports, unhealthy, no snapshot) exercise the cutover path of `up`; scenario 20 checks the refusal itself.
new_pi
run_stage MODE=up
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'live port(s) 30000 31414 31415 3000' && ! echo "$CALLS" | grep -q 'compose.* up'; then pass "up is refused on the live ports while a unit runs"; else fail "up live (rc $RC): $OUT"; fi
run_stage MODE=up $reh
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'rehearsal would use a live data folder' && ! echo "$CALLS" | grep -q 'compose.* up'; then pass "up is refused on rehearsal ports with the live data folders"; else fail "up data (rc $RC): $OUT"; fi
run_stage MODE=up $reh FOUNDRY_DATA_DIR="$SB/rfdata" TOOL_DATA_DIR="$SB/data/"
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'rehearsal would use a live data folder' && ! echo "$CALLS" | grep -q 'compose.* up'; then pass "a trailing slash on the live tool data folder does not get past the refusal"; else fail "up data slash (rc $RC): $OUT"; fi
# A rehearsal Foundry folder set to the live tool folder (the other kind) is caught too.
run_stage MODE=up $reh FOUNDRY_DATA_DIR="$SB/data" TOOL_DATA_DIR="$SB/rdata"
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'rehearsal would use a live data folder' && ! echo "$CALLS" | grep -q 'compose.* up'; then pass "the rehearsal Foundry folder on the live tool folder is refused"; else fail "up cross kind (rc $RC): $OUT"; fi
# A relative data folder is refused (compose and this script would resolve it against different folders).
run_stage MODE=up $reh FOUNDRY_DATA_DIR="rfdata" TOOL_DATA_DIR="$SB/rdata"
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'FOUNDRY_DATA_DIR must be an absolute path' && ! echo "$CALLS" | grep -q 'compose.* up'; then pass "a relative data folder is refused"; else fail "up relative (rc $RC): $OUT"; fi
# A quoted value in deploy/pi/.env is unquoted like compose does: the live tool folder in quotes is still refused as live
# data (without the strip it would start with a quote and hit the relative-path refusal instead).
cp "$SB/tool/app/deploy/pi/.env" "$SB/env.bak"
printf 'TOOL_DATA_DIR="%s"\n' "$SB/data" >>"$SB/tool/app/deploy/pi/.env"
run_stage MODE=up $reh FOUNDRY_DATA_DIR="$SB/rfdata"
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'rehearsal would use a live data folder' && ! echo "$CALLS" | grep -q 'compose.* up'; then pass "a quoted .env value is unquoted before the live folder compare"; else fail "up quoted env (rc $RC): $OUT"; fi
cp "$SB/env.bak" "$SB/tool/app/deploy/pi/.env"
# A trailing comment and whitespace in .env are dropped like compose does: the live tool folder with a comment is still refused.
printf '  TOOL_DATA_DIR = %s   # live\n' "$SB/data" >>"$SB/tool/app/deploy/pi/.env"
run_stage MODE=up $reh FOUNDRY_DATA_DIR="$SB/rfdata"
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'rehearsal would use a live data folder' && ! echo "$CALLS" | grep -q 'compose.* up'; then pass "a .env value with a comment and spaces is read like compose before the live folder compare"; else fail "up env comment (rc $RC): $OUT"; fi
# A shell value that is set but empty wins over .env (compose then takes the default, the live folder): a safe .env value
# behind it is not used.
cp "$SB/env.bak" "$SB/tool/app/deploy/pi/.env"
printf 'TOOL_DATA_DIR=%s\n' "$SB/rdata" >>"$SB/tool/app/deploy/pi/.env"
run_stage MODE=up $reh FOUNDRY_DATA_DIR="$SB/rfdata" TOOL_DATA_DIR=
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'rehearsal would use a live data folder'; then pass "a set-but-empty shell value does not fall through to .env"; else fail "up empty shell (rc $RC): $OUT"; fi
cp "$SB/env.bak" "$SB/tool/app/deploy/pi/.env"
# A relative data folder in .env must not block the way out: rollback and down ignore the absolute-path rule.
printf 'TOOL_DATA_DIR=rel/data\n' >>"$SB/tool/app/deploy/pi/.env"
run_stage MODE=rollback
if ! echo "$OUT" | grep -q 'must be an absolute path'; then pass "rollback is not blocked by a relative .env data folder"; else fail "rollback relative env (rc $RC): $OUT"; fi
run_stage MODE=down $reh
if ! echo "$OUT" | grep -q 'must be an absolute path'; then pass "down is not blocked by a relative .env data folder"; else fail "down relative env (rc $RC): $OUT"; fi
new_pi # rollback changed the units: start the next scenarios from a fresh Pi
# realpath that fails: the check fails closed instead of comparing raw strings.
mkdir -p "$SB/nort"
printf '#!/bin/sh\nexit 1\n' >"$SB/nort/realpath"
chmod +x "$SB/nort/realpath"
run_stage MODE=up $reh FOUNDRY_DATA_DIR="$SB/rfdata" TOOL_DATA_DIR="$SB/rdata" PATH="$SB/nort:$PATH"
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'cannot check the data folders' && ! echo "$CALLS" | grep -q 'compose.* up'; then pass "a failing realpath refuses instead of comparing raw paths"; else fail "up no realpath (rc $RC): $OUT"; fi
mkdir -p "$SB/rfdata" "$SB/rdata"
run_stage MODE=up $reh FOUNDRY_DATA_DIR="$SB/rfdata" TOOL_DATA_DIR="$SB/rdata"
if [ "$RC" -eq 0 ] && echo "$CALLS" | grep -qE 'compose.* up -d --no-build --wait .*foundry bridge dashboard$' && ! echo "$CALLS" | grep -qE 'compose.*--wait.*gm-browser' && ! echo "$CALLS" | grep -qE 'systemctl (disable|enable|stop|start)' && all_on $all_units; then
  pass "a rehearsal comes up beside the running units and touches none of them"
else fail "up rehearsal (rc $RC): $OUT"; fi
new_pi
for u in $all_units; do rm -f "$FAKE/active-$u" "$FAKE/enabled-$u"; done
run_stage MODE=up
if [ "$RC" -eq 0 ] && echo "$CALLS" | grep -q 'compose.* up' && echo "$OUT" | grep -q 'the stack runs and is healthy'; then pass "up on the live ports works while the units are off"; else fail "up off (rc $RC): $OUT"; fi
new_pi
for u in $all_units; do rm -f "$FAKE/active-$u" "$FAKE/enabled-$u"; done
echo 3000 >"$FAKE/busy"
run_stage MODE=up
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'port 3000 is already in use' && ! echo "$CALLS" | grep -q 'compose.* up'; then pass "up refuses a port something else holds"; else fail "up busy (rc $RC): $OUT"; fi
new_pi
for u in $all_units; do rm -f "$FAKE/active-$u" "$FAKE/enabled-$u"; done
touch "$FAKE/up-unhealthy"
run_stage MODE=up
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'not healthy' && ! echo "$CALLS" | grep -q 'compose.* down'; then pass "an unhealthy up exits 1 and leaves the stack for a look"; else fail "up unhealthy (rc $RC): $OUT"; fi
new_pi nosnapshot
for u in $all_units; do rm -f "$FAKE/active-$u" "$FAKE/enabled-$u"; done
run_stage MODE=up
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'no dietpi-backup snapshot' && ! echo "$CALLS" | grep -q 'compose.* up'; then pass "up needs a snapshot from today"; else fail "up nosnapshot (rc $RC): $OUT"; fi

# 4. down
new_pi
for u in $all_units; do rm -f "$FAKE/active-$u" "$FAKE/enabled-$u"; done
running_stack
run_stage MODE=down
if [ "$RC" -eq 0 ] && stack_gone && echo "$CALLS" | grep -q 'compose.* down'; then pass "down removes the containers"; else fail "down (rc $RC): $OUT"; fi
running_stack
echo 3 >"$FAKE/online"
: >"$FAKE/calls"
run_stage MODE=down
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'player(s) are online' && ! stack_gone && ! echo "$CALLS" | grep -q 'compose.* down'; then pass "down refuses while players are online"; else fail "down players (rc $RC): $OUT"; fi
echo 1 >"$FAKE/online"
echo '[assistant-gm] joined world' >"$FAKE/logs/gm-browser"
run_stage MODE=down
if [ "$RC" -eq 0 ] && stack_gone; then pass "the joined Assistant GM container is not counted as a player"; else fail "down gm (rc $RC): $OUT"; fi

# 5. cutover, happy path
new_pi
run_stage MODE=cutover
if [ "$RC" -eq 0 ] && all_off $all_units && [ "$(ls "$FAKE" | grep -c '^exists-')" -eq 4 ]; then pass "cutover disables and stops all four units and leaves them installed"; else fail "cutover (rc $RC): $OUT"; fi
if order_ok "disable --now $gmb" "disable --now $dash" "disable --now $bridge" "disable --now foundry.service" 'compose.* up -d --no-build --wait'; then
  pass "units stop in reverse dependency order, then the stack starts"
else fail "order: $CALLS"; fi
if [ "$(wc -l <"$SB/tool/compose-cutover.state")" -eq 4 ] && ! stack_gone && echo "$OUT" | grep -q 'cut over: the stack is healthy'; then pass "the record lists the units that were on, the stack is healthy"; else fail "state: $(cat "$SB/tool/compose-cutover.state" 2>&1) / $OUT"; fi

# 6. a rerun when already cut over, then the manual rollback (one command)
: >"$FAKE/calls"
run_stage MODE=cutover
if [ "$RC" -eq 0 ] && echo "$OUT" | grep -q 'already cut over' && ! echo "$CALLS" | grep -qE 'disable|compose.* (up|down)'; then pass "cutover again changes nothing"; else fail "cutover again (rc $RC): $OUT"; fi
: >"$FAKE/calls"
run_stage MODE=rollback
if [ "$RC" -eq 0 ] && stack_gone && all_on $all_units && echo "$OUT" | grep -q 'rolled back'; then pass "rollback: stack gone, all four units enabled and active"; else fail "rollback (rc $RC): $OUT"; fi
if order_ok 'compose.* down' "enable --now foundry.service" "enable --now $bridge" "enable --now $dash" "enable --now $gmb"; then pass "rollback stops the stack first, then starts the units in dependency order"; else fail "rollback order: $CALLS"; fi

# 7. cutover that does not hold: automatic rollback
new_pi
touch "$FAKE/up-unhealthy"
run_stage MODE=cutover
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'ROLLED BACK' && stack_gone && all_on $all_units; then pass "an unhealthy stack after the wait rolls back by itself"; else fail "auto rollback (rc $RC): $OUT"; fi
if order_ok "disable --now foundry.service" 'compose.* up' 'compose.* down' "enable --now foundry.service" "enable --now $gmb"; then pass "the automatic rollback runs after the failed start, in order"; else fail "auto order: $CALLS"; fi
new_pi
echo 2 >"$FAKE/ctl_rc"
run_stage MODE=cutover
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'ROLLED BACK' && all_on $all_units; then pass "a control port beyond loopback counts as unhealthy"; else fail "ctl (rc $RC): $OUT"; fi
new_pi
echo 3000 >"$FAKE/busy"
run_stage MODE=cutover
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'still in use' && all_on $all_units && ! echo "$CALLS" | grep -q 'compose.* up'; then pass "a port that stays busy rolls back before the stack starts"; else fail "busy (rc $RC): $OUT"; fi
new_pi
touch "$FAKE/stuck-foundry.service"
run_stage MODE=cutover
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'still enabled or active' && all_on $all_units && ! echo "$CALLS" | grep -q 'compose.* up'; then pass "a unit that will not stop rolls back; the stack never starts"; else fail "stuck (rc $RC): $OUT"; fi

# 8. cutover refusals change nothing
new_pi
echo 2 >"$FAKE/online"
run_stage MODE=cutover
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'player(s) are online' && ! echo "$CALLS" | grep -qE 'disable|compose.* up' && all_on $all_units; then pass "cutover refuses while players are online"; else fail "cutover players (rc $RC): $OUT"; fi
new_pi nosnapshot
run_stage MODE=cutover
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'no dietpi-backup snapshot' && ! echo "$CALLS" | grep -qE 'disable|compose.* up' && all_on $all_units; then pass "cutover needs a snapshot from today"; else fail "cutover snapshot (rc $RC): $OUT"; fi
new_pi
touch "$FAKE/missing-image"
run_stage MODE=cutover
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'not built' && ! echo "$CALLS" | grep -qE 'disable' && all_on $all_units; then pass "cutover without the images is refused before anything stops"; else fail "cutover images (rc $RC): $OUT"; fi
new_pi
run_stage MODE=cutover DRY_RUN=1
if [ "$RC" -eq 0 ] && echo "$OUT" | grep -q 'dry run' && ! echo "$CALLS" | grep -qE 'disable|compose.* up' && all_on $all_units && [ ! -e "$SB/tool/compose-cutover.state" ]; then pass "cutover DRY_RUN=1 prints the plan and changes nothing"; else fail "cutover dry (rc $RC): $OUT"; fi

# 9. rollback uses the record: no Assistant GM unit was on, so it is not started
new_pi nobrowser
run_stage MODE=cutover
touch "$FAKE/exists-$gmb"
run_stage MODE=rollback
if [ "$RC" -eq 0 ] && all_on foundry.service $bridge $dash && ! unit_on $gmb && ! echo "$CALLS" | grep -q "enable --now $gmb"; then pass "rollback starts only the units cutover recorded"; else fail "record (rc $RC): $OUT"; fi

# 10. rollback with a stack that will not go down starts no unit
new_pi
run_stage MODE=cutover
touch "$FAKE/down-fail" "$FAKE/rm-fail"
: >"$FAKE/calls"
run_stage MODE=rollback
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'still run after down' && ! echo "$CALLS" | grep -q 'enable --now' && all_off $all_units; then pass "rollback starts no unit while containers remain (two copies would clash)"; else fail "rollback blocked (rc $RC): $OUT"; fi

# 11. rollback needs neither a quiet table nor a snapshot
new_pi nosnapshot
for u in $all_units; do rm -f "$FAKE/active-$u" "$FAKE/enabled-$u"; done
echo 5 >"$FAKE/online"
run_stage MODE=rollback
if [ "$RC" -eq 0 ] && all_on $all_units && echo "$OUT" | grep -q 'no snapshot from today; going on'; then pass "rollback is the way out: a snapshot gap is a warning, not a stop"; else fail "rollback nosnap (rc $RC): $OUT"; fi

# 12. cutover is refused for now (the backup and the other stages do not know the stack)
new_pi
run_stage MODE=cutover TEST_ALLOW_CUTOVER=0
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'MODE=cutover is not supported' && all_on $all_units && ! echo "$CALLS" | grep -qE 'disable|compose.* up'; then pass "MODE=cutover is refused and changes nothing"; else fail "cutover refused (rc $RC): $OUT"; fi
run_stage MODE=cutover TEST_ALLOW_CUTOVER=0 DRY_RUN=1
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'not supported'; then pass "also with DRY_RUN=1"; else fail "cutover dry refused (rc $RC): $OUT"; fi

# 13. the Docker daemon is down: containers may exist and come back with it, so nothing is assumed
new_pi
for u in $all_units; do rm -f "$FAKE/active-$u" "$FAKE/enabled-$u"; done
touch "$FAKE/daemon-down"
run_stage MODE=up
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'daemon does not answer' && ! echo "$CALLS" | grep -q 'compose.* up'; then pass "up is refused while the Docker daemon is down"; else fail "up daemon (rc $RC): $OUT"; fi
run_stage MODE=status
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'which containers exist is unknown'; then pass "status says the container state is unknown and exits 1"; else fail "status daemon (rc $RC): $OUT"; fi
run_stage MODE=rollback
if [ "$RC" -eq 1 ] && all_off $all_units && ! echo "$CALLS" | grep -qE 'enable --now|disable --now docker'; then pass "rollback with the daemon down starts no unit"; else fail "rollback daemon (rc $RC): $OUT"; fi
run_stage MODE=rollback FORCE=1
if [ "$RC" -eq 0 ] && all_on $all_units && order_ok 'disable --now docker.service docker.socket' "enable --now foundry.service"; then pass "FORCE=1 disables docker.service and docker.socket first, then starts the units"; else fail "rollback force (rc $RC): $OUT / $CALLS"; fi

# 14. no deploy/pi/.env (a stage 5 replaced the checkout) but the containers run: found by label, rollback removes them
new_pi
for u in $all_units; do rm -f "$FAKE/active-$u" "$FAKE/enabled-$u"; done
running_stack
rm -f "$SB/tool/app/deploy/pi/.env"
run_stage MODE=status
if [ "$RC" -eq 0 ] && echo "$OUT" | grep -q 'container cid-foundry'; then pass "status lists the containers without a .env"; else fail "status no env (rc $RC): $OUT"; fi
run_stage MODE=rollback
if [ "$RC" -eq 0 ] && stack_gone && all_on $all_units && echo "$CALLS" | grep -q 'docker rm -f' && echo "$CALLS" | grep -q 'docker update --restart=no'; then
  pass "without a .env, rollback finds the containers by label, stops them and starts the units"
else fail "rollback no env (rc $RC): $OUT"; fi
new_pi
running_stack
rm -f "$SB/tool/app/deploy/pi/.env"
run_stage MODE=cutover
if [ "$RC" -eq 1 ] && ! echo "$CALLS" | grep -qE 'disable --now'; then pass "cutover stops nothing when the .env is gone"; else fail "cutover no env (rc $RC): $OUT"; fi

# 15. a rehearsal is its own compose project and never touches the live one
new_pi
for u in $all_units; do rm -f "$FAKE/active-$u" "$FAKE/enabled-$u"; done
mkdir -p "$SB/rfdata" "$SB/rdata"
run_stage MODE=up $reh FOUNDRY_DATA_DIR="$SB/rfdata" TOOL_DATA_DIR="$SB/rdata"
if [ "$RC" -eq 0 ] && echo "$CALLS" | grep -q -- '-p foundry-ai-tool-pi-rehearsal up' && ! echo "$CALLS" | grep -q -- '-p foundry-ai-tool-pi up'; then pass "a rehearsal up uses the project foundry-ai-tool-pi-rehearsal"; else fail "rehearsal project (rc $RC): $CALLS"; fi
run_stage MODE=down $reh FOUNDRY_DATA_DIR="$SB/rfdata" TOOL_DATA_DIR="$SB/rdata"
if [ "$RC" -eq 0 ] && echo "$CALLS" | grep -q -- '-p foundry-ai-tool-pi-rehearsal down'; then pass "a rehearsal down stops the rehearsal project"; else fail "rehearsal down (rc $RC): $CALLS"; fi
echo foundry-ai-tool-pi >"$FAKE/p-foundry"
running_stack
echo foundry-ai-tool-pi >"$FAKE/p-bridge"
run_stage MODE=down $reh FOUNDRY_DATA_DIR="$SB/rfdata" TOOL_DATA_DIR="$SB/rdata"
if ! stack_gone; then pass "a rehearsal down leaves the live containers alone"; else fail "rehearsal down touched live: $OUT"; fi

# 16. up on a running live stack asks for a quiet table
new_pi
for u in $all_units; do rm -f "$FAKE/active-$u" "$FAKE/enabled-$u"; done
running_stack
echo 3 >"$FAKE/online"
run_stage MODE=up
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'player(s) are online' && ! echo "$CALLS" | grep -q 'compose.* up'; then pass "up on a running live stack refuses while players are online"; else fail "up players (rc $RC): $OUT"; fi

# 17. a gm-browser that is not healthy does not roll back a cutover and does not fail the check
new_pi
touch "$FAKE/gm-unhealthy"
run_stage MODE=cutover
if [ "$RC" -eq 0 ] && all_off $all_units && ! stack_gone && echo "$OUT" | grep -q 'gm-browser is not healthy' && ! echo "$OUT" | grep -q 'ROLLED BACK'; then pass "the cutover gate is foundry, bridge and dashboard; gm-browser only warns"; else fail "gm unhealthy (rc $RC): $OUT"; fi

# 18. an env value compose would read differently from systemd is refused, naming the key and never the value
new_pi
for u in $all_units; do rm -f "$FAKE/active-$u" "$FAKE/enabled-$u"; done
printf 'GOOD=abc\nASSISTANT_PASSWORD=pa$$sw0rd-s3cret\n' >"$SB/etc/assistant-gm.env"
run_stage MODE=up
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'assistant-gm.env:ASSISTANT_PASSWORD' && ! echo "$OUT" | grep -q 's3cret' && ! echo "$CALLS" | grep -q 'compose.* up'; then pass "an env value with a dollar sign is refused by key, the value is never printed"; else fail "env values (rc $RC): $OUT"; fi

# 19. an SSH drop (stdout closed) mid-run does not stop the switch half way, and the run is logged on the Pi
new_pi
run_stage MODE=status
f="$SB/run.sh"
( export TEST_ALLOW_CUTOVER=1 MODE=cutover PATH="$BIN:$PATH" DIETPI_DIR="$SB/dietpi" DIETPI_BACKUP_STATS="$SB/stats" PORT_WAIT=1 WAIT_TIMEOUT=5; bash "$f" 2>&1 | head -n 1 >/dev/null )
if all_off $all_units && ! stack_gone && ls "$SB"/tool/compose-run-*.log >/dev/null 2>&1; then pass "a closed stdout does not interrupt a cutover; the run is logged"; else fail "sigpipe: $(cat "$SB"/tool/compose-run-*.log 2>&1 | tail -5)"; fi

# 20. MODE=up on the live ports is the refused cutover; a rehearsal left running is seen by status and by a down without its ports
new_pi
for u in $all_units; do rm -f "$FAKE/active-$u" "$FAKE/enabled-$u"; done
run_stage MODE=up TEST_ALLOW_CUTOVER=0
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'is the cutover, which is not supported' && ! echo "$CALLS" | grep -q 'compose.* up'; then pass "MODE=up on the live ports is refused"; else fail "up live refused (rc $RC): $OUT"; fi
mkdir -p "$SB/rfdata" "$SB/rdata"
run_stage MODE=up $reh FOUNDRY_DATA_DIR="$SB/rfdata" TOOL_DATA_DIR="$SB/rdata" TEST_ALLOW_CUTOVER=0
if [ "$RC" -eq 0 ]; then pass "a rehearsal up still works with the cutover refused"; else fail "rehearsal up (rc $RC): $OUT"; fi
run_stage MODE=status
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'a rehearsal is running'; then pass "status warns about a running rehearsal"; else fail "status rehearsal (rc $RC): $OUT"; fi
run_stage MODE=down
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'a rehearsal does' && ! stack_gone; then pass "down without the rehearsal ports leaves it and names the ports"; else fail "down rehearsal (rc $RC): $OUT"; fi

# 21. a rehearsal never touches live data folders or live ports (units off); a dry run logs nothing; the record is cleared
new_pi
for u in $all_units; do rm -f "$FAKE/active-$u" "$FAKE/enabled-$u"; done
run_stage MODE=up $reh TEST_ALLOW_CUTOVER=0
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'rehearsal would use a live data folder' && ! echo "$CALLS" | grep -q 'compose.* up'; then pass "a rehearsal on the live data folders is refused also with the units off"; else fail "rehearsal live data (rc $RC): $OUT"; fi
mkdir -p "$SB/rfdata" "$SB/rdata"
run_stage MODE=up FOUNDRY_HTTP_PORT=30100 BRIDGE_CONTROL_PORT=31614 BRIDGE_LINK_PORT=31615 FOUNDRY_DATA_DIR="$SB/rfdata" TOOL_DATA_DIR="$SB/rdata" TEST_ALLOW_CUTOVER=0
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'is the cutover, which is not supported' && ! echo "$CALLS" | grep -q 'compose.* up'; then pass "one live port (the dashboard's 3000) makes it the live project, which is refused"; else fail "one live port (rc $RC): $OUT"; fi
new_pi
for u in $all_units; do rm -f "$FAKE/active-$u" "$FAKE/enabled-$u"; done
mkdir -p "$SB/rfdata" "$SB/rdata"
run_stage MODE=up $reh FOUNDRY_DATA_DIR="$SB/rfdata" TOOL_DATA_DIR="$SB/rdata" DRY_RUN=1 TEST_ALLOW_CUTOVER=0
if [ "$RC" -eq 0 ] && echo "$OUT" | grep -q 'dry run' && ! ls "$SB"/tool/compose-run-*.log >/dev/null 2>&1; then pass "a dry run writes no run log"; else fail "dry run log (rc $RC): $OUT"; fi
new_pi
run_stage MODE=cutover
if [ -f "$SB/tool/compose-cutover.state" ] && [ ! -e "$SB/tool/compose-cutover.state.new" ]; then pass "the cutover record is complete (written through a temp file)"; else fail "record: $(ls "$SB/tool")"; fi
run_stage MODE=rollback
if [ "$RC" -eq 0 ] && [ ! -e "$SB/tool/compose-cutover.state" ]; then pass "the cutover record is cleared after a successful rollback"; else fail "record kept (rc $RC): $OUT"; fi

if [ "$fails" -eq 0 ]; then echo "ALL SCENARIOS OK"; else echo "$fails scenario check(s) FAILED"; exit 1; fi
