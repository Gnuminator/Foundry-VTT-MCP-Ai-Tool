#!/usr/bin/env bash
# The cut-over guard (refuse_when_cut_over in scripts/pi/remote/lib.sh, backlog pi-compose-cutover) in front of every stage that
# starts, restarts or enables a stack unit, in a Debian 13 ARM64 container with the real lib.sh and stand-ins for systemctl
# and docker. For each guarded stage: with a container of project foundry-ai-tool-pi (running, or stopped) the stage exits 1
# with the refusal and calls no systemctl start/restart/enable/stop and writes nothing; with a docker daemon that does not
# answer it refuses too (unknown = refuse); FORCE=1 changes nothing. Where the stage cannot run harmlessly without a container
# (it would go on and change the machine), the "no container" case only runs inside a throw-away container (/.dockerenv),
# and there only checks that the refusal text is absent. Nothing outside /tmp is touched. The last line is ALL SCENARIOS OK:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" debian:13-slim bash /repo/scripts/pi/container-test/cutover-guard-scenarios.sh
# (scripts/pi/cutover-guard-container.test.mjs runs it with PI_CUTOVER_CONTAINER=1.)
set -uo pipefail

REPO="${REPO:-/repo}"
REMOTE="$REPO/scripts/pi/remote"
LIB="$REMOTE/lib.sh"
fails=0
pass() { echo "ok: $*"; }
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }

# stage file => the WHAT text its guard call carries (a fragment is enough)
STAGES="$(cd "$REMOTE" && grep -l '^refuse_when_cut_over "' ./*.sh | sed 's|^\./||; s|\.sh$||' | grep -v '^lib$' | sort | tr '\n' ' ')"
[ "$(echo "$STAGES" | wc -w)" -ge 18 ] || { echo "FAIL: found only: $STAGES"; exit 1; }

root="$(mktemp -d)"
trap 'rm -rf "${root:?}"' EXIT
in_container=0
[ -f /.dockerenv ] && in_container=1

# new_box MODE: MODE is none (docker not installed), running, stopped (a stopped container), down (daemon silent)
new_box() {
  SB="$root/box.$((++N))"
  BIN="$SB/bin"
  # No $SB/dietpi folder: lib.sh then skips the snapshot check ("not DietPi"), which is not what is tested here.
  mkdir -p "$BIN" "$SB/etc" "$SB/data" "$SB/tool"
  cp "$LIB" "$SB/lib.sh" # set-dashboard-access.sh sources the lib.sh next to it
  : >"$SB/calls"
  cat >"$BIN/systemctl" <<EOF
#!/usr/bin/env bash
echo "systemctl \$*" >>"$SB/calls"
case "\$1" in is-active) exit 3 ;; is-enabled) echo disabled; exit 1 ;; esac
exit 0
EOF
  cat >"$BIN/id" <<'EOF'
#!/usr/bin/env bash
if [ "$*" = "-u" ]; then echo 0; else /usr/bin/id "$@"; fi
EOF
  case "$1" in
    none) ;;
    *)
      cat >"$BIN/docker" <<EOF
#!/usr/bin/env bash
echo "docker \$*" >>"$SB/calls"
mode="$1"
case "\$1" in
  info) [ "\$mode" != down ] || exit 1 ;;
  ps)
    [ "\$mode" != down ] || exit 1
    all=0; for a in "\$@"; do [ "\$a" != -aq ] || all=1; done
    if [ "\$mode" = running ] || { [ "\$mode" = stopped ] && [ "\$all" = 1 ]; }; then echo cid-foundry; fi ;;
esac
exit 0
EOF
      chmod +x "$BIN/docker" ;;
  esac
  chmod +x "$BIN/systemctl" "$BIN/id"
}
N=0

# run_stage FILE [env...]: lib.sh, the sandbox paths, then the stage; the output is in OUT, the status in RC.
run_stage() {
  local f="$SB/run.sh" file="$1" kv
  shift
  {
    cat "$LIB"
    printf '%s\n' "have_systemd() { return 1; }" "sleep() { :; }" \
      "TOOL_DIR=$SB/tool" "TOOL_ETC=$SB/etc" "TOOL_DATA=$SB/data" "NODE_DIR=$SB/node24" \
      "FOUNDRY_APP=$SB/foundry-app" "FOUNDRY_DATA=$SB/foundry-data" \
      'users_online() { echo 0; }'
    cat "$REMOTE/$file.sh"
  } >"$f"
  OUT="$(
    for kv in "$@"; do export "${kv?}"; done
    export PATH="$BIN:$PATH" DIETPI_DIR="$SB/dietpi" DIETPI_BACKUP_STATS="$SB/stats" WAIT_TIMEOUT=2
    timeout 60 bash "$f" 2>&1 </dev/null
  )"
  RC=$?
  CALLS="$(cat "$SB/calls")"
}

# mutating: a systemctl change was called, or something was written into the sandbox's config, data or tool folders.
mutating() {
  echo "$CALLS" | grep -E '^systemctl .*(start|restart|enable|stop|disable|daemon-reload)' >/dev/null && return 0
  local d
  for d in etc data tool; do
    [ -z "$(ls -A "$SB/$d" 2>/dev/null)" ] || return 0
  done
  return 1
}

for s in $STAGES; do
  for mode in running stopped; do
    new_box "$mode"
    run_stage "$s"
    if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'the stack runs as containers' && ! mutating; then
      pass "$s: refused with a $mode container, nothing changed"
    else
      fail "$s ($mode container, rc $RC): $OUT"
    fi
  done

  # FORCE=1 never overrides the guard
  new_box running
  run_stage "$s" FORCE=1
  if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'the stack runs as containers' && ! mutating; then
    pass "$s: FORCE=1 does not override the guard"
  else
    fail "$s (FORCE=1, rc $RC): $OUT"
  fi

  # docker installed, daemon silent, and nothing says systemd will not bring it back (have_systemd is false here): unknown
  new_box down
  run_stage "$s"
  if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'whether the stack runs as containers is unknown' && ! mutating; then
    pass "$s: a silent Docker daemon refuses (unknown)"
  else
    fail "$s (daemon down, rc $RC): $OUT"
  fi

  # no docker at all: the stage goes on to whatever it does next; only the refusal text must be absent
  if [ "$in_container" = 1 ]; then
    new_box none
    run_stage "$s" DRY_RUN=1
    if ! echo "$OUT" | grep -q 'the stack runs as containers\|whether the stack runs as containers is unknown'; then
      pass "$s: no docker, no refusal from the guard"
    else
      fail "$s (no docker, rc $RC): $OUT"
    fi
  fi
done

if [ "$fails" -eq 0 ]; then echo "ALL SCENARIOS OK"; else echo "$fails scenario(s) failed"; exit 1; fi
