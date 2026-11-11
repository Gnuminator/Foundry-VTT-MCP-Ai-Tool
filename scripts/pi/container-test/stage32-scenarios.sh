#!/usr/bin/env bash
# Pi stage 32 (scripts/pi/remote/32-crash-guard.sh, pi-crash-loops-clock) in a Debian 13 ARM64 container with the real lib.sh
# (no systemd here: nothing starts) and stand-ins for curl and timedatectl. Scenarios:
#   1 refusals: two modes, no guarded unit present
#   2 DRY_RUN changes nothing and prints no secret
#   3 a real run: drop-ins for the three present units (gm-browser absent: skipped), Foundry gets Restart=always and the others
#     do not, every drop-in has a start limit and OnFailure, the alert and clock units and the scripts are in place and no
#     unit holds the token; the gm-browser drop-in appears once that unit exists
#   4 a rerun changes nothing
#   5 alert.sh: posts one fixed line with the token only on stdin, refuses an odd unit name, falls back to the journal without a
#     token, and survives a failing post
#   6 clock-check.sh: two bad checks post once, further bad checks post nothing, the first good check posts the recovery
#   7 CHECK reads the install back and exits 1 on an unsynchronized clock or a missing piece
#   8 the snapshot rule: a stale snapshot refuses before anything is written; DRY_RUN and CHECK need none
#   9 UNDO removes everything it installed and leaves the earlier units alone
# The last line is ALL SCENARIOS OK when every one passed:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" debian:13-slim bash /repo/scripts/pi/container-test/stage32-scenarios.sh
# (scripts/pi/crash-guard-stage.test.mjs runs it with PI_STAGE32_CONTAINER=1.)
#
# DESTRUCTIVE: it adds a user and writes /etc/foundry-ai-tool and /opt. It refuses to run anywhere but a container.
set -uo pipefail

[ -f /.dockerenv ] || [ -n "${container:-}" ] || {
  echo "REFUSED: run this only in the test container (docker run ..., see the header)"
  exit 98
}

STAGE="${STAGE:-/repo/scripts/pi/remote/32-crash-guard.sh}"
LIB=/repo/scripts/pi/remote/lib.sh
fails=0
pass() { echo "ok: $*"; }
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }

FOUNDRY_USER=foundry
TOOL_ETC=/etc/foundry-ai-tool
TOOL_DIR=/opt/foundry-ai-tool
dest="$TOOL_DIR/crash-guard"
bot_env="$TOOL_ETC/discord-bot.env"
unit_dir=/tmp/units
state=/var/lib/foundry-ai-tool-crash-guard
token="FAKEtoken.0123456789abcdefghijklmnopqrstuvwxyz.ABCDEFGHIJKLMNOPQRSTUVWX"
id "$FOUNDRY_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$FOUNDRY_USER"
install -d -m 0750 -o root -g "$FOUNDRY_USER" "$TOOL_ETC"
install -d -m 0755 "$TOOL_DIR"

# Stand-ins on a PATH folder in front of the real one: curl records its arguments and stdin; timedatectl answers from files.
bin=/tmp/standin-bin
mkdir -p "$bin"
cat >"$bin/curl" <<'EOF'
#!/usr/bin/env bash
{ echo "ARGS: $*"; echo "STDIN: $(cat)"; } >>/tmp/curl.log
[ -f /tmp/curl-fail ] && exit 22
exit 0
EOF
cat >"$bin/timedatectl" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *NTPSynchronized*) cat /tmp/td-sync 2>/dev/null || echo yes ;;
  *NTP*) cat /tmp/td-ntp 2>/dev/null || echo yes ;;
esac
EOF
chmod 0755 "$bin/curl" "$bin/timedatectl"
export PATH="$bin:$PATH"

fresh() {
  rm -rf "$dest" "$unit_dir" "$state" /tmp/curl.log /tmp/curl-fail /tmp/td-sync /tmp/td-ntp
  mkdir -p "$unit_dir"
  for u in foundry foundry-ai-tool-bridge foundry-ai-tool-dashboard; do printf '[Service]\nRestart=on-failure\n' >"$unit_dir/$u.service"; done
  cat >"$bot_env" <<EOF
DISCORD_TOKEN=$token
GAMENIGHT_WATCH_CHANNEL_ID=1566876401519427755
EOF
  chown "root:$FOUNDRY_USER" "$bot_env"
  chmod 0640 "$bot_env"
}

run() {
  local code
  OUT="$(cat "$LIB" "$STAGE" | env UNIT_DIR="$unit_dir" "$@" bash -s 2>&1)"
  code=$?
  return "$code"
}

# 1.
fresh
run DRY_RUN=1 UNDO=1
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'one of'; then pass "two modes are refused"; else fail "two modes: rc=$rc $OUT"; fi
rm -f "$unit_dir"/*.service
run DRY_RUN=1
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'nothing to guard'; then pass "no guarded unit: refused"; else fail "no units: rc=$rc $OUT"; fi

# 2.
fresh
run DRY_RUN=1
rc=$?
if [ "$rc" -eq 0 ] && [ ! -e "$dest" ] && [ ! -e "$unit_dir/foundry.service.d" ] && [ ! -e "$unit_dir/foundry-ai-tool-alert@.service" ] &&
  echo "$OUT" | grep -q 'gm-browser.service: not here'; then
  pass "DRY_RUN says what it would do and changes nothing"; else fail "dry run: rc=$rc $OUT"; fi
if ! echo "$OUT" | grep -q "$token"; then pass "the dry run does not print the token"; else fail "token in dry run output"; fi

# 3.
run
rc=$?
d="$unit_dir/foundry.service.d/10-crash-guard.conf"
if [ "$rc" -eq 0 ] && [ -f "$d" ] && [ -f "$unit_dir/foundry-ai-tool-bridge.service.d/10-crash-guard.conf" ] &&
  [ -f "$unit_dir/foundry-ai-tool-dashboard.service.d/10-crash-guard.conf" ] && [ ! -e "$unit_dir/foundry-ai-tool-gm-browser.service.d" ]; then
  pass "drop-ins written for the three present units, none for the absent gm-browser"; else fail "install: rc=$rc $OUT"; fi
if grep -q '^Restart=always$' "$d" && ! grep -q '^Restart=' "$unit_dir/foundry-ai-tool-bridge.service.d/10-crash-guard.conf"; then
  pass "only Foundry gets Restart=always"; else fail "Restart lines"; fi
all_ok=1
for f in "$unit_dir"/*.service.d/10-crash-guard.conf; do
  grep -q '^StartLimitBurst=' "$f" && grep -q '^StartLimitIntervalSec=' "$f" && grep -q '^OnFailure=foundry-ai-tool-alert@%n.service$' "$f" || all_ok=0
done
if [ "$all_ok" = 1 ]; then pass "every drop-in has a start limit and OnFailure"; else fail "drop-in content"; fi
if [ -x "$dest/alert.sh" ] && [ -x "$dest/clock-check.sh" ] && [ "$(stat -c '%a %U' "$dest/alert.sh")" = "755 root" ] &&
  [ -f "$unit_dir/foundry-ai-tool-alert@.service" ] && [ -f "$unit_dir/foundry-ai-tool-clock-check.service" ] && [ -f "$unit_dir/foundry-ai-tool-clock-check.timer" ]; then
  pass "scripts (0755 root), alert unit, clock service and timer in place"; else fail "units/scripts: $OUT"; fi
if ! grep -rq "$token" "$unit_dir" "$dest" && ! echo "$OUT" | grep -q "$token"; then pass "no unit, script or output holds the token"; else fail "token leaked"; fi
if grep -q "^User=$FOUNDRY_USER$" "$unit_dir/foundry-ai-tool-alert@.service" && grep -q '^ProtectSystem=strict$' "$unit_dir/foundry-ai-tool-alert@.service" &&
  grep -q "^ExecStart=$dest/alert.sh unit %i$" "$unit_dir/foundry-ai-tool-alert@.service"; then
  pass "the alert unit runs hardened as $FOUNDRY_USER"; else fail "alert unit"; fi
printf '[Service]\n' >"$unit_dir/foundry-ai-tool-gm-browser.service"
run
rc=$?
if [ "$rc" -eq 0 ] && [ -f "$unit_dir/foundry-ai-tool-gm-browser.service.d/10-crash-guard.conf" ]; then pass "gm-browser gets its drop-in once the unit exists"; else fail "gm-browser: rc=$rc $OUT"; fi

# 4.
sums="$(find "$unit_dir" "$dest" -type f -exec sha256sum {} + | sort | sha256sum)"
sleep 1
run
rc=$?
if [ "$rc" -eq 0 ] && [ "$(find "$unit_dir" "$dest" -type f -exec sha256sum {} + | sort | sha256sum)" = "$sums" ]; then pass "a rerun changes nothing"; else fail "rerun: rc=$rc $OUT"; fi

# 5.
: >/tmp/curl.log
OUT="$(env $(grep -E '^(DISCORD_TOKEN|GAMENIGHT_WATCH_CHANNEL_ID)=' "$bot_env" | tr '\n' ' ') "$dest/alert.sh" unit foundry-ai-tool-bridge.service 2>&1)"
if echo "$OUT" | grep -q 'alert: posted' && grep -q 'channels/1566876401519427755/messages' /tmp/curl.log && grep -q 'keeps failing' /tmp/curl.log; then
  pass "alert.sh posts one line to the channel"; else fail "alert post: $OUT $(cat /tmp/curl.log)"; fi
if ! grep -q "$token" <(grep '^ARGS' /tmp/curl.log) && grep -q "STDIN: header = \"Authorization: Bot $token" /tmp/curl.log && ! echo "$OUT" | grep -q "$token"; then
  pass "the token goes to curl on stdin only"; else fail "token on a command line or in output"; fi
: >/tmp/curl.log
OUT="$(DISCORD_TOKEN=$token GAMENIGHT_WATCH_CHANNEL_ID=1566876401519427755 "$dest/alert.sh" unit 'x"; rm -rf /' 2>&1)"
if echo "$OUT" | grep -q 'refusing odd unit name' && [ ! -s /tmp/curl.log ]; then pass "an odd unit name is refused, nothing posted"; else fail "odd name: $OUT"; fi
OUT="$(env -u DISCORD_TOKEN "$dest/alert.sh" unit foundry.service 2>&1)"
if echo "$OUT" | grep -q 'journal only' && [ ! -s /tmp/curl.log ]; then pass "without a token it writes the journal only"; else fail "no token: $OUT"; fi
touch /tmp/curl-fail
OUT="$(DISCORD_TOKEN=$token GAMENIGHT_WATCH_CHANNEL_ID=1566876401519427755 "$dest/alert.sh" clock-bad 2>&1)"
rc=$?
rm -f /tmp/curl-fail
if [ "$rc" -eq 0 ] && echo "$OUT" | grep -q 'post failed'; then pass "a failing post still exits 0"; else fail "failing post: rc=$rc $OUT"; fi

grep -q '^RestartMode=direct$' "$unit_dir/foundry-ai-tool-bridge.service.d/10-crash-guard.conf" && grep -q '^RestartMode=direct$' "$d" &&
  pass "every drop-in sets RestartMode=direct" || fail "RestartMode"
# A stand-in systemctl that reports a Result: only start-limit-hit posts; the install test line always does.
mkdir -p /tmp/sc-bin
cat >/tmp/sc-bin/systemctl <<'EOF'
#!/usr/bin/env bash
cat /tmp/sc-result
EOF
chmod 0755 /tmp/sc-bin/systemctl
: >/tmp/curl.log
echo timeout >/tmp/sc-result
OUT="$(PATH="/tmp/sc-bin:$PATH" DISCORD_TOKEN=$token GAMENIGHT_WATCH_CHANNEL_ID=1566876401519427755 "$dest/alert.sh" unit foundry.service 2>&1)"
if echo "$OUT" | grep -q "not start-limit-hit" && [ ! -s /tmp/curl.log ]; then pass "a unit that failed another way posts nothing"; else fail "result timeout: $OUT"; fi
echo start-limit-hit >/tmp/sc-result
OUT="$(PATH="/tmp/sc-bin:$PATH" DISCORD_TOKEN=$token GAMENIGHT_WATCH_CHANNEL_ID=1566876401519427755 "$dest/alert.sh" unit foundry.service 2>&1)"
if echo "$OUT" | grep -q 'alert: posted' && grep -q 'keeps failing' /tmp/curl.log; then pass "start-limit-hit posts"; else fail "result limit: $OUT"; fi
echo timeout >/tmp/sc-result
: >/tmp/curl.log
OUT="$(PATH="/tmp/sc-bin:$PATH" DISCORD_TOKEN=$token GAMENIGHT_WATCH_CHANNEL_ID=1566876401519427755 "$dest/alert.sh" unit crash-guard-test 2>&1)"
if echo "$OUT" | grep -q 'alert: posted' && grep -q 'crash guard is installed' /tmp/curl.log; then pass "the install test line posts whatever the Result"; else fail "test line: $OUT"; fi

# 6.
rm -rf "$state" /tmp/clock-alerts
cat >"$dest/alert.sh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>/tmp/clock-alerts
EOF
chmod 0755 "$dest/alert.sh"
echo no >/tmp/td-sync
export STATE_DIRECTORY="$state"
"$dest/clock-check.sh" >/dev/null 2>&1
r1=$?
[ ! -s /tmp/clock-alerts ] && one_ok=1 || one_ok=0
"$dest/clock-check.sh" >/dev/null 2>&1
r2=$?
"$dest/clock-check.sh" >/dev/null 2>&1
if [ "$r1" = 1 ] && [ "$r2" = 1 ] && [ "$one_ok" = 1 ] && [ "$(cat /tmp/clock-alerts)" = "clock-bad" ]; then
  pass "one bad check is quiet, the second posts once, the third posts nothing"; else fail "clock bad: $r1 $r2 $(cat /tmp/clock-alerts 2>&1)"; fi
echo yes >/tmp/td-sync
"$dest/clock-check.sh" >/dev/null 2>&1
r4=$?
"$dest/clock-check.sh" >/dev/null 2>&1
if [ "$r4" = 0 ] && [ "$(cat /tmp/clock-alerts)" = "$(printf 'clock-bad\nclock-ok')" ]; then pass "the first good check posts the recovery, once"; else fail "clock back: $(cat /tmp/clock-alerts)"; fi
unset STATE_DIRECTORY
run
rc=$? # restores the real alert.sh

# 7.
run CHECK=1
rc=$?
if [ "$rc" -eq 0 ] && echo "$OUT" | grep -q 'stage 32 check: ok'; then pass "CHECK passes on a complete install with a synchronized clock"; else fail "check: rc=$rc $OUT"; fi
echo no >/tmp/td-ntp
run CHECK=1
rc=$?
rm -f /tmp/td-ntp
if [ "$rc" -eq 1 ] && echo "$OUT" | grep -q 'not synchronized'; then pass "CHECK exits 1 when the clock is not synchronized"; else fail "check bad clock: rc=$rc $OUT"; fi
mv "$unit_dir/foundry.service.d/10-crash-guard.conf" /tmp/dropin.bak
run CHECK=1
rc=$?
mv /tmp/dropin.bak "$unit_dir/foundry.service.d/10-crash-guard.conf"
if [ "$rc" -eq 1 ] && echo "$OUT" | grep -q 'foundry.service: drop-in missing'; then pass "CHECK exits 1 when a drop-in is missing"; else fail "check missing: rc=$rc $OUT"; fi

# 8.
fresh
mkdir -p /tmp/fakedietpi
echo "2020-01-01_01:25:00  Backup completed" >/tmp/stats
run DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats
rc=$?
if [ "$rc" -ne 0 ] && [ ! -e "$dest" ] && [ ! -e "$unit_dir/foundry.service.d" ]; then pass "a stale snapshot refuses before anything is written"; else fail "stale snapshot: rc=$rc $OUT"; fi
run DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats DRY_RUN=1
rc=$?
if [ "$rc" -eq 0 ]; then pass "DRY_RUN needs no snapshot"; else fail "dry run, stale snapshot: rc=$rc $OUT"; fi
echo "$(date +%F)_09:00:00  Backup completed" >/tmp/stats
run DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats
rc=$?
if [ "$rc" -eq 0 ] && [ -f "$unit_dir/foundry.service.d/10-crash-guard.conf" ]; then pass "a snapshot from today lets the run through"; else fail "fresh snapshot: rc=$rc $OUT"; fi
run DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats CHECK=1
rc=$?
[ "$rc" -eq 0 ] && pass "CHECK needs no snapshot" || fail "check: rc=$rc $OUT"

# 9.
run DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats UNDO=1
rc=$?
if [ "$rc" -eq 0 ] && [ ! -e "$dest" ] && [ ! -e "$unit_dir/foundry.service.d" ] && [ ! -e "$unit_dir/foundry-ai-tool-alert@.service" ] &&
  [ ! -e "$unit_dir/foundry-ai-tool-clock-check.timer" ] && [ -f "$unit_dir/foundry.service" ] && [ -f "$bot_env" ]; then
  pass "UNDO removes the guard and leaves the services and the bot env alone"; else fail "undo: rc=$rc $OUT"; fi

if [ "$fails" -eq 0 ]; then echo "ALL SCENARIOS OK"; else echo "$fails scenario check(s) FAILED"; exit 1; fi
