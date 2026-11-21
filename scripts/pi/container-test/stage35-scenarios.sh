#!/usr/bin/env bash
# Pi stage 35 (scripts/pi/remote/35-who-uses-what.sh, who-uses-what-pi-job and stage35-board-endpoint) in a Debian 13 ARM64
# container with the real lib.sh, cmp, install and curl (no systemd here: nothing starts) and a stand-in Node that answers
# --check and writes a note and a report for --out and --json. The reading goes to the PM board with the token file stage 16
# made; there is no vault deploy key. Scenarios:
#   1 refusals before anything is touched: two modes, a missing source file, no access env, no GM token, and the board token
#     file missing, with the wrong mode, with a line that is not an Access header, or a link
#   2 DRY_RUN changes nothing and never prints a secret
#   3 a real run: both files installed 0644 in a 0755 folder, the units run no User=, have no writable path and hold no secret,
#     no key, no known_hosts and no state folder are made
#   4 a rerun changes nothing; a changed script is installed again
#   5 CHECK exits 0 when the report is readable and the token file is in order, 1 when the token file is gone; no secret printed
#   6 the snapshot rule: a stale snapshot refuses before anything is written; DRY_RUN and CHECK need none
#   7 UNDO removes the units and the files
#   8 the first version's state folder (deploy key, clone) is named by DRY_RUN and CHECK, removed by a real run (a link
#     planted inside is not followed), and a state folder that is itself a link is refused
#   9 with a fake systemctl and journalctl: a failed first reading dies and does not enable the timer; a good reading enables
#     the timer after the start; no other unit is touched
# The last line is ALL SCENARIOS OK when every one passed:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" <IMAGE> bash /repo/scripts/pi/container-test/stage35-scenarios.sh
# (scripts/pi/who-uses-what-stage.test.mjs runs it with PI_STAGE35_CONTAINER=1.) STAGE=<file> runs another copy of the script.
#
# DESTRUCTIVE: it adds a user and writes /etc/foundry-ai-tool and /opt. It refuses to run anywhere but a container.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]:-/nonexistent}")/lib.sh" || { echo "REFUSED: container-test/lib.sh not found"; exit 98; }
require_test_container

STAGE="${STAGE:-/repo/scripts/pi/remote/35-who-uses-what.sh}"
LIB=/repo/scripts/pi/remote/lib.sh
JOB=/repo/scripts/pi/who-uses-what-push.sh

FOUNDRY_USER=foundry
TOOL_ETC=/etc/foundry-ai-tool
TOOL_DIR=/opt/foundry-ai-tool
TOOL_DATA=/var/lib/foundry-ai-tool
NODE_DIR=/opt/node24
id "$FOUNDRY_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$FOUNDRY_USER"
install -d -m 0750 -o root -g "$FOUNDRY_USER" "$TOOL_ETC"
install -d -m 0755 "$TOOL_DIR" "$NODE_DIR/bin"
install -d -m 0755 "$TOOL_DATA"
access_env="$TOOL_ETC/dashboard-access.env"
board_conf="$TOOL_ETC/board-status.conf"
dest="$TOOL_DIR/who-uses-what"
state=/var/lib/foundry-ai-tool-who-uses-what
src=/root/src
unit_dir=/tmp/units
service_file="$unit_dir/foundry-ai-tool-who-uses-what.service"
timer_file="$unit_dir/foundry-ai-tool-who-uses-what.timer"
token="GMTOKENabcdef0123456789secret"
cfsecret="CFSECRETxyz987654321"
mkdir -p "$unit_dir" /tmp/fakebin

# A stand-in Node: --check passes; the report script writes a note for --out and a report for --json. Never prints its env.
cat >"$NODE_DIR/bin/node" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *--check*) exit 0 ;;
esac
out=""
json=""
while [ $# -gt 0 ]; do case "$1" in --out) out="$2" ;; --json) json="$2" ;; esac; shift; done
[ -n "$out" ] && printf '# Who uses what\n\nstand-in\n' >"$out"
[ -n "$json" ] && printf '{"schema":1,"people":[]}' >"$json"
exit 0
EOF
chmod 0755 "$NODE_DIR/bin/node"

fresh() {
  rm -rf "$dest" "$state" "$service_file" "$timer_file"
  mkdir -p "$src"
  echo "// who-uses-what v1" >"$src/who-uses-what.mjs"
  cp "$JOB" "$src/who-uses-what-push.sh"
  cat >"$access_env" <<EOF2
# The dashboard's access settings
DASHBOARD_ALLOWED_HOSTS=pi.example
GM_DASHBOARD_TOKEN=$token
EOF2
  chown "root:$FOUNDRY_USER" "$access_env"
  chmod 0640 "$access_env"
  rm -f "$board_conf"
  printf '# stage 16 token\nheader = "CF-Access-Client-Id: abc.access"\nheader = "CF-Access-Client-Secret: %s"\n' "$cfsecret" >"$board_conf"
  chown root:root "$board_conf"
  chmod 0600 "$board_conf"
}

# run [VAR=value ...]: the stage as the user runs it (lib.sh and the stage on one stdin); output in OUT, its exit code returned.
run() {
  local code
  OUT="$(cat "$LIB" "$STAGE" | env SRC_DIR="$src" UNIT_DIR="$unit_dir" "$@" bash -s 2>&1)"
  code=$?
  return "$code"
}
no_secret() { ! echo "$OUT" | grep -q "$token" && ! echo "$OUT" | grep -q "$cfsecret"; }

# 1.
fresh
run DRY_RUN=1 UNDO=1
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'one of'; then pass "two modes are refused"; else fail "two modes: rc=$rc $OUT"; fi
mv "$src/who-uses-what-push.sh" "$src/x"
run DRY_RUN=1
rc=$?
mv "$src/x" "$src/who-uses-what-push.sh"
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'scp scripts/who-uses-what.mjs'; then pass "a missing source file says what to copy"; else fail "missing source: rc=$rc $OUT"; fi
mv "$access_env" "$access_env.gone"
run DRY_RUN=1
rc=$?
mv "$access_env.gone" "$access_env"
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'GM_DASHBOARD_TOKEN'; then pass "a missing access file is refused"; else fail "missing access env: rc=$rc $OUT"; fi
grep -v '^GM_DASHBOARD_TOKEN=' "$access_env" >"$access_env.tmp" && cat "$access_env.tmp" >"$access_env" && rm "$access_env.tmp"
run DRY_RUN=1
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'no GM_DASHBOARD_TOKEN'; then pass "no GM token is refused"; else fail "no token: rc=$rc $OUT"; fi
fresh
rm -f "$board_conf"
run DRY_RUN=1
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'run stage 16 first'; then pass "no board token file says to run stage 16 first"; else fail "no board conf: rc=$rc $OUT"; fi
fresh
chmod 0640 "$board_conf"
run DRY_RUN=1
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'mode 0600'; then pass "a board token file with the wrong mode is refused"; else fail "board conf mode: rc=$rc $OUT"; fi
fresh
printf 'output = "/etc/shadow"\n' >>"$board_conf"
run DRY_RUN=1
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'not a header line' && ! echo "$OUT" | grep -q '/etc/shadow'; then pass "a token file with another curl option is refused, the line not shown"; else fail "board conf line: rc=$rc $OUT"; fi
fresh
mv "$board_conf" /tmp/real-board.conf
ln -s /tmp/real-board.conf "$board_conf"
run DRY_RUN=1
rc=$?
rm -f "$board_conf" /tmp/real-board.conf
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'run stage 16 first'; then pass "a board token file that is a link is refused"; else fail "board conf link: rc=$rc $OUT"; fi

# 2.
fresh
run DRY_RUN=1
rc=$?
if [ "$rc" -eq 0 ] && [ ! -e "$dest" ] && [ ! -e "$state" ] && [ ! -e "$service_file" ] && [ ! -e "$timer_file" ] && echo "$OUT" | grep -q 'DRY_RUN=1: nothing changed'; then
  pass "DRY_RUN says what it would do and changes nothing"; else fail "dry run: rc=$rc $OUT"; fi
if no_secret; then pass "the dry run prints no secret"; else fail "secret in dry run output"; fi

# 3.
run
rc=$?
if [ "$rc" -eq 0 ] && cmp -s "$src/who-uses-what.mjs" "$dest/who-uses-what.mjs" && cmp -s "$src/who-uses-what-push.sh" "$dest/who-uses-what-push.sh"; then
  pass "both files are installed"; else fail "install: rc=$rc $OUT"; fi
if [ "$(stat -c '%a' "$dest")" = 755 ] && [ "$(stat -c '%a %U' "$dest/who-uses-what-push.sh")" = "644 root" ]; then pass "folder 0755, files 0644 root"; else fail "modes"; fi
if [ ! -e "$state" ] && ! find / -xdev \( -name 'id_ed25519*' -o -name known_hosts \) -newer "$access_env" 2>/dev/null | grep -q .; then
  pass "no state folder, no key and no known_hosts are made"; else fail "a key or state folder exists: $(ls -la "$state" 2>&1)"; fi
if no_secret; then pass "no secret in the output"; else fail "secret printed"; fi
if grep -q "EnvironmentFile=-$access_env" "$service_file" && grep -q "^Type=oneshot$" "$service_file" && ! grep -q '^User=' "$service_file" &&
  ! grep -q '^ReadWritePaths=' "$service_file" && grep -q '^NoNewPrivileges=true$' "$service_file" && grep -q '^ProtectSystem=strict$' "$service_file" &&
  ! grep -q "$token" "$service_file" && ! grep -q "$cfsecret" "$service_file" && ! grep -q "$board_conf" "$service_file"; then
  pass "the service is a sandboxed root oneshot with no writable path, reads the access env and holds no secret"; else fail "service: $(cat "$service_file" 2>&1)"; fi
if grep -q '^OnCalendar=\*-\*-\* 00/4:25:00$' "$timer_file" && grep -q '^OnCalendar=Sun \*-\*-\* 23:00:00$' "$timer_file" && grep -q '^Persistent=false$' "$timer_file"; then
  pass "the timer: every 4 hours and Sunday 23:00"; else fail "timer: $(cat "$timer_file" 2>&1)"; fi

# 4.
sums="$(sha256sum "$dest"/* "$service_file" "$timer_file" | sha256sum)"
m1="$(stat -c %Y "$dest/who-uses-what-push.sh")"
sleep 1
run
rc=$?
if [ "$rc" -eq 0 ] && [ "$(sha256sum "$dest"/* "$service_file" "$timer_file" | sha256sum)" = "$sums" ] && [ "$m1" = "$(stat -c %Y "$dest/who-uses-what-push.sh")" ]; then
  pass "a rerun changes nothing"; else fail "rerun: rc=$rc $OUT"; fi
echo "// who-uses-what v2" >"$src/who-uses-what.mjs"
run
rc=$?
if [ "$rc" -eq 0 ] && grep -q 'v2' "$dest/who-uses-what.mjs"; then pass "a changed script is installed again"; else fail "changed script: rc=$rc $OUT"; fi

# 5. The job reads the stand-in report; nothing is posted (CHECK).
run CHECK=1
rc=$?
if [ "$rc" -eq 0 ] && echo "$OUT" | grep -q 'nothing posted' && echo "$OUT" | grep -q 'stage 35 check: ok'; then pass "CHECK passes when the report is readable and the token file is in order"; else fail "check clean: rc=$rc $OUT"; fi
if no_secret; then pass "CHECK prints no secret"; else fail "secret in check output"; fi
mv "$board_conf" "$board_conf.gone"
run CHECK=1
rc=$?
mv "$board_conf.gone" "$board_conf"
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'run stage 16 first'; then pass "CHECK exits non-zero when the board token file is gone"; else fail "check no conf: rc=$rc $OUT"; fi

# 6.
fresh
mkdir -p /tmp/fakedietpi
echo "2020-01-01_01:25:00  Backup completed" >/tmp/stats
run DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats
rc=$?
if [ "$rc" -ne 0 ] && [ ! -e "$dest" ] && [ ! -e "$service_file" ]; then pass "a stale snapshot refuses before anything is written"; else fail "stale snapshot: rc=$rc $OUT"; fi
run DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats DRY_RUN=1
rc=$?
if [ "$rc" -eq 0 ]; then pass "DRY_RUN needs no snapshot"; else fail "dry run, stale snapshot: rc=$rc $OUT"; fi
echo "$(date +%F)_09:00:00  Backup completed" >/tmp/stats
run DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats
rc=$?
if [ "$rc" -eq 0 ] && [ -f "$dest/who-uses-what-push.sh" ]; then pass "a snapshot from today allows the run"; else fail "fresh snapshot: rc=$rc $OUT"; fi
run DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats CHECK=1
rc=$?
if [ "$rc" -eq 0 ]; then pass "CHECK works with the snapshot rule on"; else fail "check: rc=$rc $OUT"; fi

# 7.
run UNDO=1
rc=$?
if [ "$rc" -eq 0 ] && [ ! -e "$dest" ] && [ ! -e "$service_file" ] && [ ! -e "$timer_file" ]; then
  pass "UNDO removes the units and the files"; else fail "undo: rc=$rc $OUT"; fi

# 8. What the first version of the stage left: a deploy key and a clone in the state folder.
legacy_make() {
  install -d -m 0700 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$state/repo/objects"
  runuser -u "$FOUNDRY_USER" -- ssh-keygen -q -t ed25519 -N '' -f "$state/id_ed25519" 2>/dev/null || printf 'KEY\n' >"$state/id_ed25519"
  echo "github.com ssh-ed25519 AAAA" >"$state/known_hosts"
}
fresh
run
legacy_make
run DRY_RUN=1
rc=$?
if [ "$rc" -eq 0 ] && [ -f "$state/id_ed25519" ] && echo "$OUT" | grep -q "remove $state"; then pass "DRY_RUN names the old deploy key folder and leaves it"; else fail "legacy dry run: rc=$rc $OUT"; fi
run CHECK=1
rc=$?
if echo "$OUT" | grep -q 'still there' && [ -f "$state/id_ed25519" ]; then pass "CHECK warns about the old deploy key folder and leaves it"; else fail "legacy check: rc=$rc $OUT"; fi
printf 'ROOTONLY\n' >/tmp/rootonly
ln -s /tmp/rootonly "$state/planted"
run
rc=$?
if [ "$rc" -eq 0 ] && [ ! -e "$state" ] && [ -f /tmp/rootonly ] && echo "$OUT" | grep -q 'delete the deploy key on GitHub'; then
  pass "a real run removes the old deploy key folder, does not follow a link inside it and says to delete the key on GitHub"; else fail "legacy removal: rc=$rc $OUT"; fi
rm -f /tmp/rootonly
fresh
mkdir -p /tmp/linkdest
ln -s /tmp/linkdest "$state"
run
rc=$?
rm -f "$state"
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'symbolic link' && [ -d /tmp/linkdest ] && [ ! -e "$dest" ]; then pass "a state folder that is a link is refused before anything is written"; else fail "state link: rc=$rc $OUT"; fi
rm -rf /tmp/linkdest

# 9. A stand-in systemd: the first reading fails until the board "accepts".
mkdir -p /run/systemd/system
cat >/tmp/fakebin/systemctl <<'EOF'
#!/usr/bin/env bash
echo "$*" >>/tmp/systemctl.log
case "$1" in
  start) [ -f /tmp/fake-board-ok ] ;;
  *) exit 0 ;;
esac
EOF
cat >/tmp/fakebin/journalctl <<'EOF'
#!/usr/bin/env bash
if [ -f /tmp/fake-board-ok ]; then echo "who-uses-what: posted the reading to the board (900 bytes, HTTP 200)"; else echo "who-uses-what: the board answered HTTP 404"; fi
EOF
chmod 0755 /tmp/fakebin/systemctl /tmp/fakebin/journalctl
export PATH="/tmp/fakebin:$PATH"
rm -f /tmp/systemctl.log /tmp/fake-board-ok
fresh
run
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'timer is NOT enabled' && echo "$OUT" | grep -q 'endpoint is not deployed' && ! grep -q 'enable' /tmp/systemctl.log && no_secret; then
  pass "a refused first reading dies and leaves the timer off"; else fail "board refuses: rc=$rc log=$(cat /tmp/systemctl.log) $OUT"; fi
: >/tmp/systemctl.log
touch /tmp/fake-board-ok
run
rc=$?
start_line="$(grep -n '^start foundry-ai-tool-who-uses-what.service' /tmp/systemctl.log | head -n 1 | cut -d: -f1)"
enable_line="$(grep -n '^enable --now foundry-ai-tool-who-uses-what.timer' /tmp/systemctl.log | head -n 1 | cut -d: -f1)"
if [ "$rc" -eq 0 ] && [ -n "$start_line" ] && [ -n "$enable_line" ] && [ "$start_line" -lt "$enable_line" ]; then
  pass "with the board accepting, the reading is sent first and the timer is enabled after it"; else fail "board ok: rc=$rc log=$(cat /tmp/systemctl.log) $OUT"; fi
if ! grep -qE '^(restart|stop) ' /tmp/systemctl.log && ! grep -v 'who-uses-what' /tmp/systemctl.log | grep -qE '^(start|restart|stop|enable|disable)'; then
  pass "no other unit is started, stopped or restarted"; else fail "other units touched: $(cat /tmp/systemctl.log)"; fi
rm -rf /run/systemd/system /tmp/fakebin/systemctl /tmp/fakebin/journalctl /tmp/fake-board-ok /tmp/systemctl.log

if [ "$fails" -eq 0 ]; then echo "ALL SCENARIOS OK"; else echo "$fails scenario(s) FAILED"; exit 1; fi
