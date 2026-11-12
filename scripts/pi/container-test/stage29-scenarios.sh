#!/usr/bin/env bash
# Pi stage 29 (scripts/pi/remote/29-gamenight-watch.sh, watch-on-pi) in a Debian 13 ARM64 container with the real lib.sh,
# runuser, cmp and install (no systemd here: nothing starts) and a stand-in Node that answers --check and --once. Scenarios:
#   1 refusals before anything is touched: two modes, a missing source file, no bot env, no token, no #gm-bot line
#   2 DRY_RUN changes nothing and never prints a secret
#   3 a real run: both files installed 0644 in a 0755 folder, the settings file created root:foundry 0640 with the public
#     check off, the unit written with the right user and no secret in it
#   4 a rerun changes nothing; an edited settings file is kept byte for byte; a changed script is installed again
#   5 DRY_RUN reports the public check on once all three lines are filled in (names only)
#   6 CHECK exits 0 when the round is clean and 1 when a check prints FAIL; it prints no secret
#   7 the snapshot rule: a stale snapshot refuses before anything is written; DRY_RUN and CHECK need none
#   8 UNDO removes the unit and the files and keeps the settings file
#   9 with a fake systemctl and journalctl: a first run starts the unit and waits for the watching line; a file newer than
#     the running service restarts it; nothing newer does not; a unit that never reaches its watching line fails the stage
# The stand-in Node refuses --env-file anywhere on its command line, as real Node does (CHECK must use --env-files).
# The last line is ALL SCENARIOS OK when every one passed:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" <IMAGE> bash /repo/scripts/pi/container-test/stage29-scenarios.sh
# (scripts/pi/gamenight-watch-stage.test.mjs runs it with PI_STAGE29_CONTAINER=1.) STAGE=<file> runs another copy of the script.
#
# DESTRUCTIVE: it adds a user and writes /etc/foundry-ai-tool and /opt. It refuses to run anywhere but a container.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_test_container


STAGE="${STAGE:-/repo/scripts/pi/remote/29-gamenight-watch.sh}"
LIB=/repo/scripts/pi/remote/lib.sh

FOUNDRY_USER=foundry
TOOL_ETC=/etc/foundry-ai-tool
TOOL_DIR=/opt/foundry-ai-tool
NODE_DIR=/opt/node24
id "$FOUNDRY_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$FOUNDRY_USER"
install -d -m 0750 -o root -g "$FOUNDRY_USER" "$TOOL_ETC"
install -d -m 0755 "$TOOL_DIR" "$NODE_DIR/bin"
bot_env="$TOOL_ETC/discord-bot.env"
watch_env="$TOOL_ETC/gamenight-watch.env"
dest="$TOOL_DIR/gamenight-watch"
src=/root/src
unit_dir=/tmp/units
unit_file="$unit_dir/foundry-ai-tool-gamenight-watch.service"
token="FAKEtoken.0123456789abcdefghijklmnopqrstuvwxyz.ABCDEFGHIJKLMNOPQRSTUVWX"
cf_secret="CFSECRETabcdef0123456789"
mkdir -p "$unit_dir"

# A stand-in Node: --check passes, --once prints one clean round (or a FAIL line when FAKE_FAIL=1). Never prints its env.
cat >"$NODE_DIR/bin/node" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  # Real Node reads --env-file from the whole command line, script arguments included, and stops on a list it cannot open.
  *"--env-file "*|*"--env-file="*) echo "node: ${*#*--env-file}: not found"; exit 9 ;;
  *--check*) exit 0 ;;
  *--once*)
    echo "2026-11-07 20:00:00 session open: watch started"
    echo "2026-11-07 20:00:00 foundry ok 12 ms -> up"
    [ -f /tmp/fake-fail ] && echo "2026-11-07 20:00:00 bridge FAIL 3 ms (the Foundry module is not connected to the bridge) -> up"
    exit 0 ;;
esac
EOF
chmod 0755 "$NODE_DIR/bin/node"

fresh() {
  rm -rf "$dest" "$unit_file" "$watch_env" /tmp/fake-fail
  mkdir -p "$src"
  echo "// watch v1" >"$src/gamenight-watch.mjs"
  echo "// pi watch v1" >"$src/gamenight-watch-pi.mjs"
  cat >"$bot_env" <<EOF
# The recorder bot's settings
DISCORD_TOKEN=$token
GAMENIGHT_WATCH_CHANNEL_ID=1566876401519427755
EOF
  chown "root:$FOUNDRY_USER" "$bot_env"
  chmod 0640 "$bot_env"
}

# run [VAR=value ...]: the stage as the user runs it (lib.sh and the stage on one stdin); output in OUT, its exit code returned.
run() {
  local code
  OUT="$(cat "$LIB" "$STAGE" | env SRC_DIR="$src" UNIT_DIR="$unit_dir" "$@" bash -s 2>&1)"
  code=$?
  return "$code"
}

# 1.
fresh
run DRY_RUN=1 UNDO=1
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'one of'; then pass "two modes are refused"; else fail "two modes: rc=$rc $OUT"; fi
mv "$src/gamenight-watch-pi.mjs" "$src/x"
run DRY_RUN=1
rc=$?
mv "$src/x" "$src/gamenight-watch-pi.mjs"
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'scp scripts/gamenight-watch.mjs'; then pass "a missing source file says what to copy"; else fail "missing source: rc=$rc $OUT"; fi
mv "$bot_env" "$bot_env.gone"
run DRY_RUN=1
rc=$?
mv "$bot_env.gone" "$bot_env"
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'stage 8'; then pass "a missing bot env points at stage 8"; else fail "missing env: rc=$rc $OUT"; fi
grep -v '^DISCORD_TOKEN=' "$bot_env" >"$bot_env.tmp" && cat "$bot_env.tmp" >"$bot_env" && rm "$bot_env.tmp"
run DRY_RUN=1
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'no DISCORD_TOKEN'; then pass "no token is refused"; else fail "no token: rc=$rc $OUT"; fi
fresh
grep -v '^GAMENIGHT_WATCH_CHANNEL_ID=' "$bot_env" >"$bot_env.tmp" && cat "$bot_env.tmp" >"$bot_env" && rm "$bot_env.tmp"
run DRY_RUN=1
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'stage 26'; then pass "no #gm-bot line points at stage 26"; else fail "no channel: rc=$rc $OUT"; fi

# 2.
fresh
run DRY_RUN=1
rc=$?
if [ "$rc" -eq 0 ] && [ ! -e "$dest" ] && [ ! -e "$watch_env" ] && [ ! -e "$unit_file" ] && echo "$OUT" | grep -q 'public check: off'; then
  pass "DRY_RUN says what it would do and changes nothing"; else fail "dry run: rc=$rc $OUT"; fi
if ! echo "$OUT" | grep -q "$token"; then pass "the dry run does not print the token"; else fail "token in dry run output"; fi

# 3.
run
rc=$?
if [ "$rc" -eq 0 ] && cmp -s "$src/gamenight-watch.mjs" "$dest/gamenight-watch.mjs" && cmp -s "$src/gamenight-watch-pi.mjs" "$dest/gamenight-watch-pi.mjs"; then
  pass "both files are installed"; else fail "install: rc=$rc $OUT"; fi
if [ "$(stat -c '%a' "$dest")" = 755 ] && [ "$(stat -c '%a %U' "$dest/gamenight-watch-pi.mjs")" = "644 root" ]; then pass "folder 0755, files 0644 root"; else fail "modes"; fi
if [ "$(stat -c '%a %U:%G' "$watch_env")" = "640 root:$FOUNDRY_USER" ] && ! grep -qE '^[A-Z_]+=' "$watch_env"; then
  pass "the settings file is root:$FOUNDRY_USER 0640 with every line commented out"; else fail "settings file: $(stat -c '%a %U:%G' "$watch_env")"; fi
if grep -q "^User=$FOUNDRY_USER$" "$unit_file" && grep -q "EnvironmentFile=-$bot_env" "$unit_file" && grep -q "EnvironmentFile=-$watch_env" "$unit_file" &&
  grep -q "ExecStart=$NODE_DIR/bin/node $dest/gamenight-watch-pi.mjs --post" "$unit_file" && ! grep -q "$token" "$unit_file"; then
  pass "the unit runs as $FOUNDRY_USER, loads both env files and posts"; else fail "unit: $(cat "$unit_file" 2>&1)"; fi
if ! echo "$OUT" | grep -q "$token"; then pass "the token is never printed"; else fail "token printed"; fi

# 4.
sums="$(sha256sum "$dest"/* "$unit_file" "$watch_env" | sha256sum)"
m1="$(stat -c %Y "$dest/gamenight-watch-pi.mjs")"
sleep 1
run
rc=$?
if [ "$rc" -eq 0 ] && [ "$(sha256sum "$dest"/* "$unit_file" "$watch_env" | sha256sum)" = "$sums" ] && [ "$m1" = "$(stat -c %Y "$dest/gamenight-watch-pi.mjs")" ]; then
  pass "a rerun changes nothing"; else fail "rerun: rc=$rc $OUT"; fi
printf 'WATCH_PUBLIC_URL=https://pub.example\nCF_ACCESS_CLIENT_ID=abc.access\nCF_ACCESS_CLIENT_SECRET=%s\n' "$cf_secret" >>"$watch_env"
env_sum="$(sha256sum <"$watch_env")"
echo "// pi watch v2" >"$src/gamenight-watch-pi.mjs"
run
rc=$?
if [ "$rc" -eq 0 ] && [ "$(sha256sum <"$watch_env")" = "$env_sum" ] && grep -q 'v2' "$dest/gamenight-watch-pi.mjs"; then
  pass "an edited settings file is kept; a changed script is installed again"; else fail "edit/kept: rc=$rc $OUT"; fi
if ! echo "$OUT" | grep -q "$cf_secret"; then pass "the Access secret is never printed"; else fail "Access secret printed"; fi

# 5.
run DRY_RUN=1
rc=$?
if [ "$rc" -eq 0 ] && echo "$OUT" | grep -q 'public check: on' && ! echo "$OUT" | grep -q "$cf_secret"; then pass "all three lines filled in: public check on, no value shown"; else fail "public on: rc=$rc $OUT"; fi

# 6.
run CHECK=1
rc=$?
if [ "$rc" -eq 0 ] && echo "$OUT" | grep -q 'foundry ok'; then pass "CHECK passes on a clean round"; else fail "check clean: rc=$rc $OUT"; fi
touch /tmp/fake-fail
run CHECK=1
rc=$?
rm -f /tmp/fake-fail
if [ "$rc" -eq 1 ] && echo "$OUT" | grep -q 'at least one check failed'; then pass "CHECK exits 1 when a check fails"; else fail "check fail: rc=$rc $OUT"; fi
if ! echo "$OUT" | grep -q "$token" && ! echo "$OUT" | grep -q "$cf_secret"; then pass "CHECK prints no secret"; else fail "secret in check output"; fi

# 7.
fresh
mkdir -p /tmp/fakedietpi
echo "2020-01-01_01:25:00  Backup completed" >/tmp/stats
run DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats
rc=$?
if [ "$rc" -ne 0 ] && [ ! -e "$dest" ] && [ ! -e "$watch_env" ] && [ ! -e "$unit_file" ]; then pass "a stale snapshot refuses before anything is written"; else fail "stale snapshot: rc=$rc $OUT"; fi
run DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats DRY_RUN=1
rc=$?
if [ "$rc" -eq 0 ]; then pass "DRY_RUN needs no snapshot"; else fail "dry run, stale snapshot: rc=$rc $OUT"; fi
echo "$(date +%F)_09:00:00  Backup completed" >/tmp/stats
run DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats
rc=$?
if [ "$rc" -eq 0 ] && [ -f "$dest/gamenight-watch-pi.mjs" ]; then pass "a snapshot from today allows the run"; else fail "fresh snapshot: rc=$rc $OUT"; fi
run DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats CHECK=1
rc=$?
if [ "$rc" -eq 0 ]; then pass "CHECK works with the snapshot rule on"; else fail "check: rc=$rc $OUT"; fi

# 8.
env_sum="$(sha256sum <"$watch_env")"
run UNDO=1
rc=$?
if [ "$rc" -eq 0 ] && [ ! -e "$dest" ] && [ ! -e "$unit_file" ] && [ "$(sha256sum <"$watch_env")" = "$env_sum" ]; then
  pass "UNDO removes the unit and the files and keeps the settings file"; else fail "undo: rc=$rc $OUT"; fi

# 9. With a stand-in systemd (a /run/systemd/system folder and a fake systemctl and journalctl): the restart rules and
# the wait for the watch's "watching" line.
mkdir -p /run/systemd/system /tmp/fakebin
cat >/tmp/fakebin/systemctl <<'EOF'
#!/usr/bin/env bash
# Fake systemctl: state in /tmp/fake-*; every call is logged to /tmp/systemctl.log.
echo "$*" >>/tmp/systemctl.log
case "$1" in
  is-active) [ -f /tmp/fake-active ] && [ ! -f /tmp/fake-dead ] ;;
  show) cat /tmp/fake-started 2>/dev/null ;;
  start | restart) touch /tmp/fake-active /tmp/fake-acted ;;
  *) exit 0 ;;
esac
EOF
cat >/tmp/fakebin/journalctl <<'EOF'
#!/usr/bin/env bash
# A unit that dies on its first journal read (a settings problem: exit 2 before any watching line).
[ -f /tmp/fake-diesoon ] && touch /tmp/fake-dead
[ -f /tmp/fake-acted ] && [ ! -f /tmp/fake-nowatch ] && [ ! -f /tmp/fake-diesoon ] && echo "2026-11-08 09:00:00 watching 127.0.0.1:30000 every 60s (posting to Discord); checks: foundry"
EOF
chmod 0755 /tmp/fakebin/systemctl /tmp/fakebin/journalctl
rm -f /tmp/systemctl.log /tmp/fake-active /tmp/fake-dead /tmp/fake-nowatch /tmp/fake-started
fresh
rm -f /tmp/fake-acted; run PATH="/tmp/fakebin:$PATH"
rc=$?
if [ "$rc" -eq 0 ] && grep -q '^start ' /tmp/systemctl.log && echo "$OUT" | grep -q 'running and watching'; then pass "a first run starts the unit and sees the watching line"; else fail "systemd start: rc=$rc $OUT"; fi
: >/tmp/systemctl.log
echo "Tue 2000-01-01 00:00:00 UTC" >/tmp/fake-started
rm -f /tmp/fake-acted; run PATH="/tmp/fakebin:$PATH"
rc=$?
if [ "$rc" -eq 0 ] && grep -q '^restart ' /tmp/systemctl.log; then pass "files newer than the running service restart it (a cut-off upgrade)"; else fail "newer-than-service: rc=$rc log=$(cat /tmp/systemctl.log) $OUT"; fi
: >/tmp/systemctl.log
echo "Tue 2099-01-01 00:00:00 UTC" >/tmp/fake-started
rm -f /tmp/fake-acted; run PATH="/tmp/fakebin:$PATH"
rc=$?
if [ "$rc" -eq 0 ] && ! grep -q "^restart " /tmp/systemctl.log && echo "$OUT" | grep -q "not restarted"; then pass "nothing newer than the service: no restart, no wait for a new watching line"; else fail "no restart: rc=$rc log=$(cat /tmp/systemctl.log) $OUT"; fi
touch /tmp/fake-nowatch; echo "Tue 2000-01-01 00:00:00 UTC" >/tmp/fake-started
rm -f /tmp/fake-acted; run PATH="/tmp/fakebin:$PATH"
rc=$?
rm -f /tmp/fake-nowatch
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q "'watching' line"; then pass "a unit that never reaches its watching line fails the stage"; else fail "no watching line: rc=$rc $OUT"; fi
touch /tmp/fake-diesoon; echo "Tue 2000-01-01 00:00:00 UTC" >/tmp/fake-started
rm -f /tmp/fake-acted /tmp/fake-dead; run PATH="/tmp/fakebin:$PATH"
rc=$?
rm -f /tmp/fake-diesoon /tmp/fake-dead
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q "'watching' line"; then pass "a unit that stops before its watching line fails the stage at once"; else fail "unit stops first: rc=$rc $OUT"; fi
rm -rf /run/systemd/system /tmp/fakebin /tmp/fake-active /tmp/fake-started /tmp/fake-acted /tmp/systemctl.log

if [ "$fails" -eq 0 ]; then echo "ALL SCENARIOS OK"; else echo "$fails scenario(s) FAILED"; exit 1; fi
