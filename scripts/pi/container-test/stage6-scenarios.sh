#!/usr/bin/env bash
# The installed nightly backup script of Pi stage 6 (the foundry-backup.sh that scripts/pi/remote/6-backup.sh writes to
# /opt/foundry-ai-tool/backup) in a Debian 13 ARM64 container. The script is cut out of the stage exactly as the stage
# installs it and run as the timer would run it, with stand-ins for what the container lacks (systemctl, journalctl, curl,
# restic, sleep; the docker stand-in of the stage 25 scenarios for the container stack). Every scenario ends with Foundry
# running (or, when the script cannot start it, a named error) and an exit code that is checked:
#   1 clean run: nobody online, Foundry stopped for the copy, restic runs while it is down, Foundry started again, exit 0
#   2 a player online, then gone: Foundry is left alone, the script waits 30 minutes per look and then backs up, exit 0
#   3 the Assistant GM browser restarted before the run (a new invocation id the journal has no line for, the join line
#     found by the main PID): it is not a player, no waiting, exit 0; a GM browser that has not joined counts as a player
#   4 players online all night: six waits, the night is skipped (exit 1, marker written), Foundry never stopped and
#     running; the next night backs up anyway, exit 0, marker removed
#   5 restic fails: the exit code is restic's, Foundry is started again by the trap, the clean-up (forget, prune) is not run
#   6 Foundry does not come back after the copy: exit 1 with the ERROR line, no clean-up
#   6b Foundry answers after the copy but is back on the setup screen: exit 1 with the setup-screen ERROR
#   7 the container stack (after the Docker cutover): clean run, and restic failing, with Foundry's container running after
#   8 the container stack: Foundry's container restarts during the copy: exit 1, the torn snapshot is forgotten, the
#     container is running; a variant (restart and stop) restarts it and stops it again during the copy, which the
#     start time catches: exit 1, container running
# The last line is ALL SCENARIOS OK when every one passed:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" <IMAGE> bash /repo/scripts/pi/container-test/stage6-scenarios.sh
# (scripts/pi/backup-nightly-container.test.mjs runs it with PI_STAGE6_CONTAINER=1.) STAGE=<file> runs another copy of the
# stage.
#
# DESTRUCTIVE: it writes /opt/foundry-ai-tool/backup and /tmp/s6*. It refuses to run anywhere but a container.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]:-/nonexistent}")/lib.sh" || { echo "REFUSED: container-test/lib.sh not found"; exit 98; }
require_test_container

STAGE="${STAGE:-/repo/scripts/pi/remote/6-backup.sh}"
script_dir=/opt/foundry-ai-tool/backup
script="$script_dir/foundry-backup.sh"
S=/tmp/s6
BIN=/tmp/s6bin
SNAP=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789
GM=foundry-ai-tool-gm-browser.service

# The script as the stage installs it: the quoted heredoc of script_body, written with printf '%s\n'.
body="$(sed -n "/^  cat <<'BACKUP_SCRIPT'\$/,/^BACKUP_SCRIPT\$/p" "$STAGE" | sed '1d;$d')"
[ -n "$body" ] || { echo "FAIL: the nightly script is not in the stage"; exit 1; }
mkdir -p "$script_dir"
printf '%s\n' "$body" >"$script"
chmod 0755 "$script"
bash -n "$script" || { echo "FAIL: the installed script does not parse"; exit 1; }

# ---- stand-ins (PATH first) -------------------------------------------------------------------------------------------
mkdir -p "$BIN"
cat >"$BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
# State: /tmp/s6/down-<unit> = stopped; foundry.service and the GM units run unless that file exists, the Kit GM browser only
# with /tmp/s6/up-<unit>. /tmp/s6/startfail makes "start foundry.service" do nothing (Foundry stays down).
echo "systemctl $*" >>/tmp/s6/calls
cmd="${1:-}"
unit=""
want=""
quiet=0
prev=""
for a in "$@"; do
  case "$a" in
    *.service | *.socket) unit="$a" ;;
    --quiet | -q) quiet=1 ;;
    InvocationID | MainPID) want="$a" ;;
  esac
  prev="$a"
done
case "$cmd" in
  is-active)
    state=inactive code=3
    case "$unit" in
      foundry.service | foundry-ai-tool-gm-browser.service) [ -f "/tmp/s6/down-$unit" ] || { state=active; code=0; } ;;
      *) [ -f "/tmp/s6/up-$unit" ] && { state=active; code=0; } ;;
    esac
    [ "$quiet" = 1 ] || echo "$state"
    exit "$code"
    ;;
  stop) touch "/tmp/s6/down-$unit"; rm -f "/tmp/s6/up-$unit" ;;
  start | restart)
    [ "$unit" = foundry.service ] && [ -f /tmp/s6/startfail ] && exit 0
    rm -f "/tmp/s6/down-$unit"
    ;;
  show) [ -f "/tmp/s6/$want-$unit" ] && cat "/tmp/s6/$want-$unit" ;;
  is-enabled) exit 1 ;;
esac
exit 0
EOF
cat >"$BIN/journalctl" <<'EOF'
#!/usr/bin/env bash
# The Assistant GM browser's join line is found by a run's invocation id (/tmp/s6/joined-inv-<id>) or by a main PID
# (/tmp/s6/joined-pid-<pid>); anything else has no line.
echo "journalctl $*" >>/tmp/s6/calls
line='[assistant-gm] joined world curse-of-strahd as Assistant GM (GM: true, module active: true)'
for a in "$@"; do
  case "$a" in
    _SYSTEMD_INVOCATION_ID=*) [ -f "/tmp/s6/joined-inv-${a#_SYSTEMD_INVOCATION_ID=}" ] && echo "$line" ;;
    _PID=*) pidarg="${a#_PID=}" ;;
    -b) boot=1 ;;
    _SYSTEMD_UNIT=foundry-ai-tool-gm-browser.service) unitarg=1 ;;
  esac
done
# By PID only with this boot (-b) and the unit named, as the script asks.
[ -z "${pidarg:-}" ] || [ -z "${boot:-}" ] || [ -z "${unitarg:-}" ] || [ ! -f "/tmp/s6/joined-pid-$pidarg" ] || echo "$line"
exit 0
EOF
cat >"$BIN/curl" <<'EOF'
#!/usr/bin/env bash
# /api/status: nothing answers while Foundry is stopped (unit or container); otherwise the world and /tmp/s6/users
# (/tmp/s6/setup-screen: no world, as when a world will not open).
url="${*: -1}"
case "$url" in
  */api/status)
    [ ! -f /tmp/s6/down-foundry.service ] && [ ! -f /tmp/foundry-container-down ] || exit 7
    # setup-screen: the world ran before the backup, but after Foundry was started again it answers without one
    if [ -f /tmp/s6/setup-screen ] && grep -q '^systemctl start foundry.service' /tmp/s6/calls; then echo '{"active":false,"version":"14"}'; exit 0; fi
    echo "{\"active\":true,\"world\":\"curse-of-strahd\",\"users\":$(cat /tmp/s6/users)}"
    ;;
  *) exit 22 ;;
esac
EOF
cat >"$BIN/sleep" <<'EOF'
#!/usr/bin/env bash
# Never waits. The next value of /tmp/s6/users-seq (one per line) becomes the number of players online, so "online, then
# gone" is a list.
echo "sleep $*" >>/tmp/s6/calls
if [ -s /tmp/s6/users-seq ]; then
  head -n 1 /tmp/s6/users-seq >/tmp/s6/users
  sed -i 1d /tmp/s6/users-seq
fi
exit 0
EOF
cat >"$BIN/restic" <<'EOF'
#!/usr/bin/env bash
# backup: logs whether Foundry was down for the copy, runs /tmp/s6/restic-hook (a change made during the copy), fails with
# the code in /tmp/s6/restic-fail, else prints restic's JSON summary. Everything else only logs.
case "${1:-}" in
  backup)
    if [ -f /tmp/s6/down-foundry.service ] || [ -f /tmp/foundry-container-down ]; then d=yes; else d=no; fi
    echo "restic backup (foundry down: $d)" >>/tmp/s6/calls
    [ ! -x /tmp/s6/restic-hook ] || /tmp/s6/restic-hook
    if [ -f /tmp/s6/restic-fail ]; then
      echo "Fatal: unable to open repository (fake failure)" >&2
      exit "$(cat /tmp/s6/restic-fail)"
    fi
    echo '{"message_type":"status","percent_done":0.5}'
    echo "{\"message_type\": \"summary\", \"files_new\": 3, \"snapshot_id\": \"$SNAP\"}"
    ;;
  *) echo "restic $*" >>/tmp/s6/calls ;;
esac
exit 0
EOF
chmod +x "$BIN"/*
export PATH="$BIN:$PATH"
export SNAP

# reset: a fresh state; STACK=systemd (no docker) or containers (the stage 25 docker stand-in)
reset() {
  rm -rf "${S:?}" /tmp/dk /tmp/foundry-container-down /tmp/stopfail /tmp/calls "${BIN:?}/docker"
  mkdir -p "$S/sysd" "$S/marker" /tmp/dk/c
  echo 0 >"$S/users"
  : >"$S/calls"
  if [ "${1:-systemd}" = containers ]; then
    # The stand-in reads "docker stop CID"; the script says "docker stop -t 90 CID", so the wrapper drops the -t.
    cat >"$BIN/docker" <<'EOF'
#!/usr/bin/env bash
args=()
skip=0
for a in "$@"; do
  if [ "$skip" = 1 ]; then skip=0; elif [ "$a" = -t ]; then skip=1; else args+=("$a"); fi
done
exec bash /repo/scripts/pi/container-test/bin/fake-docker "${args[@]}"
EOF
    chmod +x "$BIN/docker"
    echo running >/tmp/dk/c/foundry
    echo 100 >/tmp/dk/started-foundry
  fi
}

# run_night [ENV=VALUE...]: the script as the timer runs it; out, rc and calls are set
run_night() {
  out="$(env FOUNDRY_BACKUP_SYSTEMD_DIR="$S/sysd" FOUNDRY_BACKUP_SKIP_MARKER="$S/marker/skipped-last-night" \
    FOUNDRY_BACKUP_ACTIVE_WAIT_TRIES=2 "$@" bash "$script" </dev/null 2>&1)"
  rc=$?
  calls="$(cat "$S/calls" /tmp/calls 2>/dev/null)"
}
sleeps() { grep -c '^sleep 1800$' "$S/calls" || true; }
first_line() { grep -n -m1 -- "$1" "$S/calls" | cut -d: -f1; } # the line number of a call, empty when it never happened
systemd_up() { [ ! -f "$S/down-foundry.service" ]; }
container_up() { [ "$(cat /tmp/dk/c/foundry)" = running ] && [ ! -f /tmp/foundry-container-down ]; }

# 1. clean run
reset
run_night
[ "$rc" = 0 ] && pass "1 clean run exits 0" || fail "1 clean run exit $rc: $out"
echo "$out" | grep -q 'backup done' && pass "1 backup done" || fail "1 no 'backup done': $out"
echo "$out" | grep -q "restic made snapshot ${SNAP:0:8}" && pass "1 the snapshot id is read from restic's summary" || fail "1 snapshot id: $out"
grep -q 'restic backup (foundry down: yes)' "$S/calls" && pass "1 restic ran while Foundry was down" || fail "1 copy while Foundry ran: $(cat "$S/calls")"
stop_n="$(first_line 'systemctl stop foundry.service')"
start_n="$(first_line 'systemctl start foundry.service')"
copy_n="$(first_line 'restic backup')"
if [ -n "$stop_n" ] && [ -n "$copy_n" ] && [ -n "$start_n" ] && [ "$stop_n" -lt "$copy_n" ] && [ "$copy_n" -lt "$start_n" ]; then
  pass "1 stop, copy, start in that order"; else fail "1 order: $(cat "$S/calls")"; fi
systemd_up && pass "1 Foundry is running afterwards" || fail "1 Foundry is down afterwards"
forget_n="$(first_line 'restic forget --keep-daily 7 --prune')"
if [ -n "$forget_n" ] && [ -n "$start_n" ] && [ "$start_n" -lt "$forget_n" ]; then pass "1 the clean-up ran after Foundry was back"; else fail "1 clean-up order: $(cat "$S/calls")"; fi
[ "$(sleeps)" = 0 ] && pass "1 nothing to wait for" || fail "1 waited"

# 2. a player online, then gone
reset
echo 2 >"$S/users"
printf '1\n0\n' >"$S/users-seq"
run_night
[ "$rc" = 0 ] && pass "2 exits 0 once the player has left" || fail "2 exit $rc: $out"
[ "$(sleeps)" = 2 ] && pass "2 two waits of 30 minutes" || fail "2 sleeps: $(sleeps)"
echo "$out" | grep -q '2 player(s) online in Foundry: not stopping it for the backup; trying again in 30 minutes (1 of 6)' && pass "2 the wait is explained" || fail "2 message: $out"
sleep_n="$(grep -n 'sleep 1800' "$S/calls" | tail -n 1 | cut -d: -f1)"
stop_n="$(first_line 'systemctl stop foundry.service')"
if [ -n "$sleep_n" ] && [ -n "$stop_n" ] && [ "$sleep_n" -lt "$stop_n" ]; then pass "2 Foundry is stopped only after the waiting"; else fail "2 order: $(cat "$S/calls")"; fi
systemd_up && pass "2 Foundry is running afterwards" || fail "2 Foundry is down afterwards"

# 3. the Assistant GM browser restarted before the run
reset
echo 1 >"$S/users"
echo inv-new >"$S/InvocationID-$GM"
echo 4242 >"$S/MainPID-$GM"
touch "$S/joined-pid-4242" # only the main PID of this run has the line; the invocation id's journal is empty
run_night
[ "$rc" = 0 ] && pass "3 a restarted GM browser is not a player: exit 0" || fail "3 exit $rc: $out"
[ "$(sleeps)" = 0 ] && pass "3 no waiting for it" || fail "3 waited for the GM browser"
grep -q 'restic backup (foundry down: yes)' "$S/calls" && systemd_up && pass "3 backed up, Foundry running" || fail "3 not backed up: $out"
# the control: a GM browser that has not joined is a player
reset
echo 1 >"$S/users"
echo inv-new >"$S/InvocationID-$GM"
echo 4242 >"$S/MainPID-$GM"
printf '0\n' >"$S/users-seq"
run_night
[ "$rc" = 0 ] && [ "$(sleeps)" = 1 ] && pass "3 a GM browser that has not joined counts as a player (waits once)" || fail "3 control: rc $rc sleeps $(sleeps): $out"

# 4. players online all night, then the next night
reset
echo 1 >"$S/users"
run_night
[ "$rc" = 1 ] && pass "4 a night with players online all night exits 1" || fail "4 exit $rc: $out"
[ "$(sleeps)" = 6 ] && pass "4 six waits" || fail "4 sleeps: $(sleeps)"
echo "$out" | grep -q 'ERROR: backup skipped for tonight' && pass "4 the skip is an ERROR line" || fail "4 message: $out"
[ "$(head -n 1 "$S/marker/skipped-last-night" 2>/dev/null)" = "$(date +%F)" ] && pass "4 the marker holds today's date" || fail "4 marker: $(cat "$S/marker/skipped-last-night" 2>&1)"
if ! grep -q 'systemctl stop foundry.service' "$S/calls" && systemd_up; then pass "4 Foundry was never stopped and runs"; else fail "4 Foundry was touched: $(cat "$S/calls")"; fi
# the night after: the marker says yesterday, so it backs up anyway
: >"$S/calls"
date -d yesterday +%F >"$S/marker/skipped-last-night"
run_night
[ "$rc" = 0 ] && pass "4 the next night backs up anyway: exit 0" || fail "4 next night exit $rc: $out"
echo "$out" | grep -q "last night's backup was skipped too: backing up anyway" && pass "4 it says why" || fail "4 message: $out"
[ ! -e "$S/marker/skipped-last-night" ] && pass "4 the marker is removed after a backup" || fail "4 marker kept"
systemd_up && pass "4 Foundry is running afterwards" || fail "4 Foundry is down afterwards"

# 5. restic fails
reset
echo 3 >"$S/restic-fail"
run_night
[ "$rc" = 3 ] && pass "5 restic failing fails the night with restic's code" || fail "5 exit $rc: $out"
systemd_up && echo "$out" | grep -q 'foundry.service started again' && pass "5 the trap started Foundry again" || fail "5 Foundry is down: $out"
grep -q 'restic forget' "$S/calls" && fail "5 the clean-up ran after a failed copy" || pass "5 no clean-up after a failed copy"
echo "$out" | grep -q 'backup done' && fail "5 reported 'backup done'" || pass "5 no 'backup done'"

# 6. Foundry does not come back
reset
touch "$S/startfail"
run_night
[ "$rc" = 1 ] && pass "6 a Foundry that stays down fails the night" || fail "6 exit $rc: $out"
echo "$out" | grep -q 'ERROR: the backup is done, but foundry.service is not active' && pass "6 the ERROR line says what to do" || fail "6 message: $out"
grep -q 'restic forget' "$S/calls" && fail "6 the clean-up ran" || pass "6 no clean-up"

# 7. the container stack
reset containers
run_night
[ "$rc" = 0 ] && pass "7 container stack: clean run exits 0" || fail "7 exit $rc: $out"
grep -q 'restic backup (foundry down: yes)' "$S/calls" && container_up && pass "7 copied while the container was stopped, and it runs" || fail "7 $out"
reset containers
echo 3 >"$S/restic-fail"
run_night
[ "$rc" = 3 ] && container_up && pass "7 container stack: restic failing exits 3 and the container runs" || fail "7 restic failing: rc $rc: $out"

# 8. the container restarts during the copy
reset containers
cat >"$S/restic-hook" <<'EOF'
#!/usr/bin/env bash
docker start cid-foundry
EOF
chmod +x "$S/restic-hook"
run_night
[ "$rc" = 1 ] && pass "8 a container that restarts during the copy fails the night" || fail "8 exit $rc: $out"
echo "$out" | grep -q 'started again while the worlds were being copied' && pass "8 the ERROR line names it" || fail "8 message: $out"
grep -q "restic forget $SNAP" "$S/calls" && echo "$out" | grep -q "the torn snapshot ${SNAP:0:8} was removed" && pass "8 the torn snapshot is forgotten" || fail "8 torn snapshot: $out"
container_up && pass "8 the container is running afterwards" || fail "8 the container is down"
# A container that restarted and was stopped again during the copy: only its new start time gives it away.
reset containers
cat >"$S/restic-hook" <<'EOF'
#!/usr/bin/env bash
docker start cid-foundry
docker stop cid-foundry
EOF
chmod +x "$S/restic-hook"
run_night
[ "$rc" = 1 ] && echo "$out" | grep -q 'started again while the worlds were being copied' && pass "8 a restart that stopped again is caught by its start time" || fail "8 restart and stop: rc $rc: $out"
container_up && pass "8 the container is running afterwards (restart and stop)" || fail "8 the container is down (restart and stop)"

# 6b. Foundry answers but is back on the setup screen
reset
touch "$S/setup-screen"
run_night
[ "$rc" = 1 ] && echo "$out" | grep -q 'Foundry may be on the setup screen' && pass "6 a Foundry back on the setup screen fails the night" || fail "6 setup screen: rc $rc: $out"

[ "$fails" -eq 0 ] && echo "ALL SCENARIOS OK" || exit 1
