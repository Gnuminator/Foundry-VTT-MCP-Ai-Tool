#!/usr/bin/env bash
# Pi stage 21 (scripts/pi/remote/21-player-vault.sh) on a CUT-OVER Pi (day two, D-149): the stack runs as containers and the
# player-vault switch lives in deploy/pi/.env. The real lib.sh and the real stage run against stand-ins for docker (compose up,
# ps, inspect, start, stop; container state kept as files), syncthing (folder and device lists as files), runuser, id and
# install, all inside a sandbox folder under /tmp, so this also runs in Git Bash and changes nothing outside /tmp:
#   REPO=$PWD bash scripts/pi/container-test/stage21-stack-scenarios.sh
# The last line is ALL SCENARIOS OK when every one passed. The units side (drop-in, real Syncthing) is stage21-scenarios.sh.
# Scenarios:
#   1 report on a cut-over Pi: works, reads .env and the container, touches nothing, calls no systemctl
#   2 SETUP=1: the players folder, the value in .env, ONLY the dashboard container recreated, once; the other three untouched
#   3 SETUP=1 again: nothing changes and nothing is recreated or restarted
#   4 report after SETUP: matches; drift both ways is warned about (STRICT=1 fails on the unset-but-live one)
#   5 SETUP=1 with a stopped dashboard container: started through compose, no quiet check needed
#   6 OFF=1: Syncthing player folders gone, .env empty, dashboard recreated once without the value; a second OFF changes nothing
#   7 OFF=1 with a stopped dashboard: recreated without starting, stays stopped
#   8 a quiet refusal leaves .env, the container and Syncthing as they were (SETUP and OFF)
#   9 REMOVE and add are not refused on a cut-over Pi; no scenario ran systemctl start, restart or enable
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]:-/nonexistent}")/lib.sh" || { echo "REFUSED: container-test/lib.sh not found"; exit 98; }

REPO="${REPO:-/repo}"
STAGE="${STAGE:-$REPO/scripts/pi/remote/21-player-vault.sh}"
LIB="$REPO/scripts/pi/remote/lib.sh"

root="$(mktemp -d)"
trap 'rm -rf "${root:?}"' EXIT
n=0
svcs="foundry bridge dashboard gm-browser"

new_pi() { # a cut-over Pi: four running containers, Syncthing with the GM vault folder
  SB="$root/pi.$((++n))"
  BIN="$SB/bin"
  FAKE="$SB/fake"
  players="$SB/data/obsidian/players"
  envf="$SB/app/deploy/pi/.env"
  mkdir -p "$BIN" "$FAKE" "$SB/app/deploy/pi" "$SB/data/obsidian"
  : >"$FAKE/calls"
  : >"$FAKE/events"
  : >"$SB/app/deploy/pi/compose.yml"
  printf 'FOUNDRY_UID=996\nOTHER_SWITCH=keep\n' >"$envf"
  local s
  for s in $svcs; do
    echo running >"$FAKE/state-$s"
    echo "NODE_ENV=production" >"$FAKE/env-$s"
  done
  echo foundry-gm-vault >"$FAKE/folders"
  : >"$FAKE/devices"
  printf '%s\n' "TOOL_DATA=\"$SB/data\"" "TOOL_CHECKOUT=\"$SB/app\"" \
    "if [ -f \"$SB/quiet-refuse\" ]; then require_quiet() { die \"players are online: \$1 is refused\"; }; fi" >"$SB/override.sh"
  write_stubs
}

seed_player() { # Syncthing already shares one player folder with one device (what OFF takes away)
  echo foundry-player-mira-12345678 >>"$FAKE/folders"
  echo "FOUNDRY-PLAYER-DEVICE" >"$FAKE/fdev-foundry-player-mira-12345678"
  echo "FOUNDRY-PLAYER-DEVICE" >>"$FAKE/devices"
}

write_stubs() {
  cat >"$BIN/systemctl" <<EOF
#!/usr/bin/env bash
echo "systemctl \$*" >>"$FAKE/calls"
exit 3
EOF
  cat >"$BIN/id" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  -u) echo 0 ;;
  foundry) exit 0 ;;
  *) exec /usr/bin/id "$@" ;;
esac
EOF
  cat >"$BIN/runuser" <<'EOF'
#!/usr/bin/env bash
shift 3
exec "$@"
EOF
  cat >"$BIN/install" <<'EOF'
#!/usr/bin/env bash
# only `install -d [-m MODE] [-o USER] [-g GROUP] DIR...` is used here; the owner and mode mean nothing in the sandbox
while [ $# -gt 0 ]; do
  case "$1" in -d) ;; -m | -o | -g) shift ;; *) mkdir -p "$1" ;; esac
  shift
done
EOF
  cat >"$BIN/syncthing" <<EOF
#!/usr/bin/env bash
F="$FAKE"
EOF
  cat >>"$BIN/syncthing" <<'EOF'
echo "syncthing $*" >>"$F/calls"
shift 2 # cli --home=...
case "$*" in
  "show system") echo '{ "myID": "AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA" }' ;;
  "show connections") echo '{}' ;;
  "config folders list") cat "$F/folders" ;;
  "config devices list") cat "$F/devices" ;;
  "config folders "*" devices list") cat "$F/fdev-$3" 2>/dev/null ;;
  "config folders "*" delete") grep -vx "$3" "$F/folders" >"$F/folders.new"; mv "$F/folders.new" "$F/folders"; rm -f "$F/fdev-$3" ;;
  "config devices "*" delete") grep -vx "$3" "$F/devices" >"$F/devices.new"; mv "$F/devices.new" "$F/devices" ;;
esac
exit 0
EOF
  cat >"$BIN/docker" <<EOF
#!/usr/bin/env bash
F="$FAKE"
EOF
  cat >>"$BIN/docker" <<'EOF'
echo "docker $*" >>"$F/calls"
svcs="foundry bridge dashboard gm-browser"
key=FOUNDRY_AI_PLAYER_VAULTS_DIR
case "$1" in
  info) exit 0 ;;
  ps)
    shift; all=0; want=""
    while [ $# -gt 0 ]; do
      case "$1" in
        -aq) all=1 ;;
        --filter) shift; case "$1" in label=com.docker.compose.service=*) want="${1#label=com.docker.compose.service=}" ;; esac ;;
      esac
      shift
    done
    for s in $svcs; do
      [ -f "$F/state-$s" ] || continue
      [ -z "$want" ] || [ "$want" = "$s" ] || continue
      [ "$all" = 1 ] || [ "$(cat "$F/state-$s")" = running ] || continue
      echo "cid-$s"
    done ;;
  inspect)
    last="${@: -1}"; s="${last#cid-}"
    [ -f "$F/state-$s" ] || exit 1
    cat "$F/env-$s" ;;
  stop) s="${2#cid-}"; echo exited >"$F/state-$s"; echo "stop $s" >>"$F/events" ;;
  start | restart) s="${2#cid-}"; echo running >"$F/state-$s"; echo "$1 $s" >>"$F/events" ;;
  compose)
    shift 5 # compose -p PROJECT -f compose.yml
    [ "$1" = up ] || exit 0
    nostart=0; for a in "$@"; do [ "$a" != --no-start ] || nostart=1; done
    s="${@: -1}"
    [ -f .env ] || exit 1
    have_line=0; grep -q "^$key=" .env && have_line=1
    want="$(sed -n "s/^$key=//p" .env | tail -n 1)"
    cur="$(sed -n "s/^$key=//p" "$F/env-$s" 2>/dev/null | tail -n 1)"
    if [ -f "$F/state-$s" ] && [ "$cur" = "$want" ]; then
      if [ "$nostart" = 0 ] && [ "$(cat "$F/state-$s")" != running ]; then echo running >"$F/state-$s"; echo "start $s" >>"$F/events"; fi
    else
      { echo "NODE_ENV=production"; [ "$have_line" = 0 ] || echo "$key=$want"; } >"$F/env-$s"
      if [ "$nostart" = 1 ]; then echo exited >"$F/state-$s"; else echo running >"$F/state-$s"; fi
      echo "recreate $s" >>"$F/events"
    fi ;;
esac
exit 0
EOF
  chmod +x "$BIN"/*
}

run_stage() { # env assignments first: run_stage VAR=value ...
  (
    cd "$SB" || exit 99
    export PATH="$BIN:$PATH"
    for kv in "$@"; do export "${kv?}"; done
    cat "$LIB" "$SB/override.sh" "$STAGE" | bash -s 2>&1
  )
}
count() { grep -c "$1" "$2" || true; }
recreates() { count "^recreate dashboard" "$FAKE/events"; }
envval() { sed -n 's/^FOUNDRY_AI_PLAYER_VAULTS_DIR=//p' "$envf" | tail -n 1; }
cenv() { sed -n 's/^FOUNDRY_AI_PLAYER_VAULTS_DIR=//p' "$FAKE/env-dashboard" | tail -n 1; }
others_untouched() { # no event names another service, and all of them still run
  ! grep -qE ' (foundry|bridge|gm-browser)$' "$FAKE/events" || return 1
  local s
  for s in foundry bridge gm-browser; do [ "$(cat "$FAKE/state-$s")" = running ] || return 1; done
}
no_unit_starts() { ! grep -qE '^systemctl (start|restart|enable|try-restart)' "$FAKE/calls"; }

# 1. report on a cut-over Pi
new_pi
out="$(run_stage)"; rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q 'does not write player vaults yet' && ! echo "$out" | grep -q WARNING &&
  echo "$out" | grep -q 'report done: 0 thing'; then
  pass "the report works on a cut-over Pi (switch not set)"
else
  fail "report (exit $rc): $out"
fi
if ! grep -qE '^docker (compose|start|stop|restart|exec)' "$FAKE/calls" && [ -z "$(cat "$FAKE/events")" ] && no_unit_starts; then
  pass "the report changes no container and starts no unit"
else
  fail "the report touched the stack: $(cat "$FAKE/calls")"
fi

# 2. SETUP=1
out="$(run_stage SETUP=1)"; rc=$?
if [ "$rc" -eq 0 ] && [ -d "$players" ] && [ "$(envval)" = "$players" ] && grep -qx 'OTHER_SWITCH=keep' "$envf"; then
  pass "SETUP=1 makes the players folder and writes the switch into .env"
else
  fail "setup (exit $rc, .env: $(cat "$envf")): $out"
fi
if [ "$(recreates)" = 1 ] && [ "$(cenv)" = "$players" ] && others_untouched &&
  grep -qE '^docker compose .* up -d --no-deps dashboard$' "$FAKE/calls"; then
  pass "only the dashboard container was recreated, once, with the value"
else
  fail "recreate: events $(cat "$FAKE/events"); calls $(grep compose "$FAKE/calls")"
fi

# 3. the same again
: >"$FAKE/calls"
before="$(cat "$envf")"
out="$(run_stage SETUP=1)"; rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q 'not restarted: nothing it uses changed' && [ "$(cat "$envf")" = "$before" ] &&
  [ "$(recreates)" = 1 ] && ! grep -qE '^docker (compose|start|stop|restart)' "$FAKE/calls"; then
  pass "SETUP=1 twice changes nothing and recreates nothing"
else
  fail "second setup (exit $rc): $out; calls $(cat "$FAKE/calls")"
fi

# 4. report after SETUP, and drift
out="$(run_stage)"; rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q "sets FOUNDRY_AI_PLAYER_VAULTS_DIR=$players" && echo "$out" | grep -q 'matches .env' &&
  ! echo "$out" | grep -q WARNING; then
  pass "the report after SETUP matches .env and the container"
else
  fail "report after setup (exit $rc): $out"
fi
echo "NODE_ENV=production" >"$FAKE/env-dashboard"
out="$(run_stage)"; rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q 'does not have it yet'; then
  pass "the report warns when .env is set but the running container lacks it"
else
  fail "drift 1 (exit $rc): $out"
fi
echo "FOUNDRY_AI_PLAYER_VAULTS_DIR=$players" >>"$FAKE/env-dashboard"
printf 'FOUNDRY_UID=996\n' >"$envf"
out="$(run_stage)"; rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q 'still writes player vaults'; then
  pass "the report warns when .env is unset but the container still has it"
else
  fail "drift 2 (exit $rc): $out"
fi
out="$(run_stage STRICT=1)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "STRICT=1 fails on it"; else fail "strict (exit $rc): $out"; fi
echo exited >"$FAKE/state-dashboard"
out="$(run_stage)"; rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q 'dashboard container: stopped'; then
  pass "the report says a stopped dashboard container is stopped"
else
  fail "stopped report (exit $rc): $out"
fi

# 5. SETUP with a stopped dashboard container: started, not recreated, no quiet check
new_pi
run_stage SETUP=1 >/dev/null
echo exited >"$FAKE/state-dashboard"
touch "$SB/quiet-refuse"
: >"$FAKE/events"
out="$(run_stage SETUP=1)"; rc=$?
if [ "$rc" -eq 0 ] && [ "$(cat "$FAKE/state-dashboard")" = running ] && [ "$(count '^start dashboard' "$FAKE/events")" = 1 ] &&
  [ "$(recreates)" = 0 ] && others_untouched; then
  pass "SETUP=1 starts a stopped dashboard container through compose (no recreate, no quiet check)"
else
  fail "setup with a stopped dashboard (exit $rc): $out; events $(cat "$FAKE/events")"
fi

# 6. OFF=1
new_pi
seed_player
run_stage SETUP=1 >/dev/null
: >"$FAKE/events"
out="$(run_stage OFF=1)"; rc=$?
if [ "$rc" -eq 0 ] && [ -z "$(envval)" ] && [ -z "$(cenv)" ] && [ "$(recreates)" = 1 ] && others_untouched &&
  ! grep -qx 'foundry-player-mira-12345678' "$FAKE/folders" && grep -qx 'foundry-gm-vault' "$FAKE/folders" && grep -qx 'OTHER_SWITCH=keep' "$envf"; then
  pass "OFF=1 empties .env, drops the player folders and recreates only the dashboard, once"
else
  fail "off (exit $rc, .env $(cat "$envf")): $out; events $(cat "$FAKE/events")"
fi
: >"$FAKE/calls"
before="$(cat "$envf")"
out="$(run_stage OFF=1)"; rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q 'does not have the setting' && [ "$(cat "$envf")" = "$before" ] && [ "$(recreates)" = 1 ] &&
  ! grep -qE '^docker (compose|start|stop|restart)' "$FAKE/calls"; then
  pass "OFF=1 twice changes nothing and recreates nothing"
else
  fail "second off (exit $rc): $out; calls $(cat "$FAKE/calls")"
fi

# 7. OFF with a stopped dashboard
new_pi
seed_player
run_stage SETUP=1 >/dev/null
echo exited >"$FAKE/state-dashboard"
touch "$SB/quiet-refuse"
: >"$FAKE/events"
: >"$FAKE/calls"
out="$(run_stage OFF=1)"; rc=$?
if [ "$rc" -eq 0 ] && [ -z "$(envval)" ] && [ -z "$(cenv)" ] && [ "$(cat "$FAKE/state-dashboard")" = exited ] &&
  grep -qE '^docker compose .* up --no-start --no-deps dashboard$' "$FAKE/calls" && ! grep -q ' -d ' "$FAKE/calls"; then
  pass "OFF=1 recreates a stopped dashboard container without starting it"
else
  fail "off with a stopped dashboard (exit $rc): $out; calls $(cat "$FAKE/calls")"
fi

# 8. a quiet refusal leaves everything as it was
new_pi
touch "$SB/quiet-refuse"
before="$(cat "$envf")"
: >"$FAKE/calls"
out="$(run_stage SETUP=1)"; rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'players are online' && [ "$(cat "$envf")" = "$before" ] && [ -z "$(cenv)" ] &&
  [ ! -d "$players" ] && ! grep -qE '^docker compose' "$FAKE/calls"; then
  pass "SETUP=1 refused by the quiet check leaves .env, the folder and the container as they were"
else
  fail "quiet setup (exit $rc): $out; .env $(cat "$envf")"
fi
rm -f "$SB/quiet-refuse"
seed_player
run_stage SETUP=1 >/dev/null
touch "$SB/quiet-refuse"
before="$(cat "$envf")"
folders_before="$(cat "$FAKE/folders")"
: >"$FAKE/calls"
out="$(run_stage OFF=1)"; rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'players are online' && [ "$(cat "$envf")" = "$before" ] && [ "$(cenv)" = "$players" ] &&
  [ "$(cat "$FAKE/folders")" = "$folders_before" ] && ! grep -qE '^docker compose' "$FAKE/calls"; then
  pass "OFF=1 refused by the quiet check leaves .env, the container and Syncthing as they were"
else
  fail "quiet off (exit $rc): $out"
fi

# 9. REMOVE and add are not refused; no unit was started, restarted or enabled in any scenario
new_pi
out="$(run_stage REMOVE=1 PLAYER=Ghost)"; rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'nothing to remove' && ! echo "$out" | grep -q 'stack runs as containers'; then
  pass "REMOVE is not refused on a cut-over Pi"
else
  fail "remove (exit $rc): $out"
fi
mkdir -p "$players/Mira"
out="$(run_stage PLAYER=Mira DEVICE_ID=BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB-BBBBBBB)"; rc=$?
if echo "$out" | grep -q 'no dashboard marker' && ! echo "$out" | grep -q 'stack runs as containers' && [ "$(recreates)" = 0 ]; then
  pass "add is checked before the stack is touched, and not refused on a cut-over Pi"
else
  fail "add (exit $rc): $out"
fi
if no_unit_starts; then pass "no scenario called systemctl start, restart or enable"; else fail "a unit was touched: $(grep '^systemctl' "$FAKE/calls")"; fi

[ "$fails" -eq 0 ] && echo "ALL SCENARIOS OK" || exit 1
