#!/usr/bin/env bash
# Pi stage 34 (scripts/pi/remote/34-who-uses-what.sh, who-uses-what-pi-job) in a Debian 13 ARM64 container with the real lib.sh,
# runuser, cmp, install and ssh-keygen (no systemd here: nothing starts), a stand-in Node that answers --check and writes a
# note for --out, and a stand-in git that answers ls-remote. Scenarios:
#   1 refusals before anything is touched: two modes, a missing source file, no access env, no GM token, no git
#   2 DRY_RUN changes nothing and never prints a secret
#   3 a real run: both files installed 0644 in a 0755 folder, the state folder 0700 foundry, a real ed25519 deploy key 0600
#     foundry (never printed), the pinned GitHub host key, the units with the right user, one writable folder and no secret
#   4 a rerun changes nothing and keeps the key byte for byte; a changed script is installed again and the key still stays
#   5 CHECK exits 0 when the report and the vault repo answer and 1 when the repo refuses; it prints no secret; writes nothing
#   6 the snapshot rule: a stale snapshot refuses before anything is written; DRY_RUN and CHECK need none
#   7 UNDO removes the units and the files and keeps the state folder with the key
#   8 with a fake systemctl and journalctl: a failed first reading prints the PUBLIC key, dies and does not enable the timer;
#     a good reading enables the timer after the start; a rerun with the key accepted works
# The last line is ALL SCENARIOS OK when every one passed:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" <IMAGE> bash /repo/scripts/pi/container-test/stage34-scenarios.sh
# (scripts/pi/who-uses-what-stage.test.mjs runs it with PI_STAGE34_CONTAINER=1.) STAGE=<file> runs another copy of the script.
#
# DESTRUCTIVE: it adds a user and writes /etc/foundry-ai-tool and /opt. It refuses to run anywhere but a container.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]:-/nonexistent}")/lib.sh" || { echo "REFUSED: container-test/lib.sh not found"; exit 98; }
require_test_container

STAGE="${STAGE:-/repo/scripts/pi/remote/34-who-uses-what.sh}"
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
dest="$TOOL_DIR/who-uses-what"
state="$TOOL_DATA/who-uses-what"
src=/root/src
unit_dir=/tmp/units
service_file="$unit_dir/foundry-ai-tool-who-uses-what.service"
timer_file="$unit_dir/foundry-ai-tool-who-uses-what.timer"
token="GMTOKENabcdef0123456789secret"
mkdir -p "$unit_dir" /tmp/fakebin

# A stand-in Node: --check passes; the report script writes a note for --out. Never prints its env.
cat >"$NODE_DIR/bin/node" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *--check*) exit 0 ;;
esac
out=""
while [ $# -gt 0 ]; do case "$1" in --out) out="$2" ;; esac; shift; done
[ -n "$out" ] && printf '# Who uses what\n\nstand-in\n' >"$out"
exit 0
EOF
chmod 0755 "$NODE_DIR/bin/node"

# A stand-in git: ls-remote answers unless /tmp/fake-git-refuse exists.
cat >/tmp/fakebin/git <<'EOF'
#!/usr/bin/env bash
case "$1" in
  ls-remote) [ -f /tmp/fake-git-refuse ] && { echo "git: permission denied" >&2; exit 128; }; exit 0 ;;
  *) exit 0 ;;
esac
EOF
chmod 0755 /tmp/fakebin/git
export PATH="/tmp/fakebin:$PATH"

fresh() {
  rm -rf "$dest" "$state" "$service_file" "$timer_file" /tmp/fake-git-refuse
  mkdir -p "$src"
  echo "// who-uses-what v1" >"$src/who-uses-what.mjs"
  printf '#!/usr/bin/env bash\necho job v1\n' >"$src/who-uses-what-push.sh"
  cp "$JOB" "$src/who-uses-what-push.sh"
  cat >"$access_env" <<EOF2
# The dashboard's access settings
DASHBOARD_ALLOWED_HOSTS=pi.example
GM_DASHBOARD_TOKEN=$token
EOF2
  chown "root:$FOUNDRY_USER" "$access_env"
  chmod 0640 "$access_env"
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
mv /tmp/fakebin/git /tmp/fakebin/git.gone
run DRY_RUN=1
rc=$?
mv /tmp/fakebin/git.gone /tmp/fakebin/git
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'git is not installed'; then pass "a missing git is refused"; else fail "no git: rc=$rc $OUT"; fi

# 2.
fresh
run DRY_RUN=1
rc=$?
if [ "$rc" -eq 0 ] && [ ! -e "$dest" ] && [ ! -e "$state" ] && [ ! -e "$service_file" ] && [ ! -e "$timer_file" ] && echo "$OUT" | grep -q 'generate the deploy key'; then
  pass "DRY_RUN says what it would do and changes nothing"; else fail "dry run: rc=$rc $OUT"; fi
if ! echo "$OUT" | grep -q "$token"; then pass "the dry run does not print the token"; else fail "token in dry run output"; fi

# 3.
run
rc=$?
if [ "$rc" -eq 0 ] && cmp -s "$src/who-uses-what.mjs" "$dest/who-uses-what.mjs" && cmp -s "$src/who-uses-what-push.sh" "$dest/who-uses-what-push.sh"; then
  pass "both files are installed"; else fail "install: rc=$rc $OUT"; fi
if [ "$(stat -c '%a' "$dest")" = 755 ] && [ "$(stat -c '%a %U' "$dest/who-uses-what-push.sh")" = "644 root" ]; then pass "folder 0755, files 0644 root"; else fail "modes"; fi
if [ "$(stat -c '%a %U:%G' "$state")" = "700 $FOUNDRY_USER:$FOUNDRY_USER" ] && [ "$(stat -c '%a %U' "$state/id_ed25519")" = "600 $FOUNDRY_USER" ] &&
  [ "$(stat -c '%a' "$state/id_ed25519.pub")" = 644 ]; then
  pass "state folder 0700 and the deploy key 0600, both owned by $FOUNDRY_USER"; else fail "state modes: $(ls -la "$state")"; fi
if ssh-keygen -l -f "$state/id_ed25519" 2>/dev/null | grep -q 'ED25519'; then pass "the deploy key is a real ed25519 key"; else fail "key is not ed25519"; fi
if grep -q '^github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl$' "$state/known_hosts"; then
  pass "known_hosts pins GitHub's ed25519 key"; else fail "known_hosts: $(cat "$state/known_hosts")"; fi
if ! echo "$OUT" | grep -q "BEGIN OPENSSH PRIVATE KEY" && ! echo "$OUT" | grep -q "$token"; then pass "no private key and no token in the output"; else fail "secret printed"; fi
if grep -q "^User=$FOUNDRY_USER$" "$service_file" && grep -q "EnvironmentFile=-$access_env" "$service_file" && grep -q "^ReadWritePaths=$state$" "$service_file" &&
  grep -q "^Type=oneshot$" "$service_file" && ! grep -q "$token" "$service_file"; then
  pass "the service runs as $FOUNDRY_USER, reads the access env, writes one folder and holds no secret"; else fail "service: $(cat "$service_file" 2>&1)"; fi
if grep -q '^OnCalendar=\*-\*-\* 00/4:25:00$' "$timer_file" && grep -q '^OnCalendar=Sun \*-\*-\* 23:00:00$' "$timer_file" && grep -q '^Persistent=false$' "$timer_file"; then
  pass "the timer: every 4 hours and Sunday 23:00"; else fail "timer: $(cat "$timer_file" 2>&1)"; fi

# 4.
key_sum="$(sha256sum "$state/id_ed25519" | cut -d' ' -f1)"
sums="$(sha256sum "$dest"/* "$service_file" "$timer_file" "$state/known_hosts" | sha256sum)"
m1="$(stat -c %Y "$dest/who-uses-what-push.sh")"
sleep 1
run
rc=$?
if [ "$rc" -eq 0 ] && [ "$(sha256sum "$dest"/* "$service_file" "$timer_file" "$state/known_hosts" | sha256sum)" = "$sums" ] &&
  [ "$m1" = "$(stat -c %Y "$dest/who-uses-what-push.sh")" ] && [ "$key_sum" = "$(sha256sum "$state/id_ed25519" | cut -d' ' -f1)" ]; then
  pass "a rerun changes nothing and keeps the key"; else fail "rerun: rc=$rc $OUT"; fi
echo "// who-uses-what v2" >"$src/who-uses-what.mjs"
run
rc=$?
if [ "$rc" -eq 0 ] && grep -q 'v2' "$dest/who-uses-what.mjs" && [ "$key_sum" = "$(sha256sum "$state/id_ed25519" | cut -d' ' -f1)" ]; then
  pass "a changed script is installed again, the key stays"; else fail "changed script: rc=$rc $OUT"; fi

# 5.
run CHECK=1
rc=$?
if [ "$rc" -eq 0 ] && echo "$OUT" | grep -q 'vault repo answers' && echo "$OUT" | grep -q 'stage 34 check: ok'; then pass "CHECK passes when the report and the vault repo answer"; else fail "check clean: rc=$rc $OUT"; fi
touch /tmp/fake-git-refuse
run CHECK=1
rc=$?
rm -f /tmp/fake-git-refuse
if [ "$rc" -eq 1 ] && echo "$OUT" | grep -q 'deploy key'; then pass "CHECK exits 1 when the vault repo refuses the key"; else fail "check refused: rc=$rc $OUT"; fi
if ! echo "$OUT" | grep -q "$token" && ! echo "$OUT" | grep -q 'BEGIN OPENSSH'; then pass "CHECK prints no secret"; else fail "secret in check output"; fi

# 6.
fresh
mkdir -p /tmp/fakedietpi
echo "2020-01-01_01:25:00  Backup completed" >/tmp/stats
run DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats
rc=$?
if [ "$rc" -ne 0 ] && [ ! -e "$dest" ] && [ ! -e "$state" ] && [ ! -e "$service_file" ]; then pass "a stale snapshot refuses before anything is written"; else fail "stale snapshot: rc=$rc $OUT"; fi
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
key_sum="$(sha256sum "$state/id_ed25519" | cut -d' ' -f1)"
run UNDO=1
rc=$?
if [ "$rc" -eq 0 ] && [ ! -e "$dest" ] && [ ! -e "$service_file" ] && [ ! -e "$timer_file" ] && [ "$key_sum" = "$(sha256sum "$state/id_ed25519" | cut -d' ' -f1)" ]; then
  pass "UNDO removes the units and the files and keeps the state folder with the key"; else fail "undo: rc=$rc $OUT"; fi

# 8. A stand-in systemd: the first reading fails until the key is "accepted".
mkdir -p /run/systemd/system
cat >/tmp/fakebin/systemctl <<'EOF'
#!/usr/bin/env bash
echo "$*" >>/tmp/systemctl.log
case "$1" in
  start) [ -f /tmp/fake-key-ok ] ;;
  *) exit 0 ;;
esac
EOF
cat >/tmp/fakebin/journalctl <<'EOF'
#!/usr/bin/env bash
if [ -f /tmp/fake-key-ok ]; then echo "who-uses-what: pushed the note (900 bytes)"; else echo "who-uses-what: git push was refused twice"; fi
EOF
chmod 0755 /tmp/fakebin/systemctl /tmp/fakebin/journalctl
rm -f /tmp/systemctl.log /tmp/fake-key-ok
fresh
run
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'Allow write access' && echo "$OUT" | grep -q "$(cut -d' ' -f2 "$state/id_ed25519.pub")" &&
  ! grep -q 'enable' /tmp/systemctl.log && ! echo "$OUT" | grep -q 'BEGIN OPENSSH'; then
  pass "a refused first reading prints the public key, dies and leaves the timer off"; else fail "no key yet: rc=$rc log=$(cat /tmp/systemctl.log) $OUT"; fi
: >/tmp/systemctl.log
touch /tmp/fake-key-ok
run
rc=$?
start_line="$(grep -n '^start foundry-ai-tool-who-uses-what.service' /tmp/systemctl.log | head -n 1 | cut -d: -f1)"
enable_line="$(grep -n '^enable --now foundry-ai-tool-who-uses-what.timer' /tmp/systemctl.log | head -n 1 | cut -d: -f1)"
if [ "$rc" -eq 0 ] && [ -n "$start_line" ] && [ -n "$enable_line" ] && [ "$start_line" -lt "$enable_line" ]; then
  pass "with the key accepted the reading runs first and the timer is enabled after it"; else fail "key ok: rc=$rc log=$(cat /tmp/systemctl.log) $OUT"; fi
if ! grep -qE '^(restart|stop) ' /tmp/systemctl.log && ! grep -v 'who-uses-what' /tmp/systemctl.log | grep -qE '^(start|restart|stop|enable|disable)'; then
  pass "no other unit is started, stopped or restarted"; else fail "other units touched: $(cat /tmp/systemctl.log)"; fi
rm -rf /run/systemd/system /tmp/fakebin/systemctl /tmp/fakebin/journalctl /tmp/fake-key-ok /tmp/systemctl.log

if [ "$fails" -eq 0 ]; then echo "ALL SCENARIOS OK"; else echo "$fails scenario(s) FAILED"; exit 1; fi
