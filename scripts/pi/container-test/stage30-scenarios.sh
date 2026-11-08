#!/usr/bin/env bash
# Pi stage 30 (scripts/pi/remote/30-player-connector.sh, player-connector-pi) in a Debian 13 ARM64 container with the real lib.sh
# (no systemd here: nothing restarts, the service checks are skipped) and Debian's own nodejs for the table check. Scenarios:
#   1 refusals before anything is touched: two modes, no table, a table with a bad user id, a duplicate id, a non-https endpoint,
#     a wrong path, a unit that does not run as foundry, no dashboard-access.env, FOUNDRY_AI_PLAYER_CONNECTOR_DEV_USER set anywhere
#   2 DRY_RUN changes nothing and never prints a secret
#   3 a real run: the table installed foundry 0600 and the source removed, the env file root:foundry 0640, the drop-ins on both
#     units, the host added to DASHBOARD_ALLOWED_HOSTS with a copy kept, the other lines of that file untouched, no secret printed
#   4 a rerun with no new table changes nothing; a new table replaces the installed one; the host is not added twice
#   5 CHECK exits 0 on a good install and 1 once the table's mode is wrong; it prints no secret
#   6 the snapshot rule: a stale snapshot refuses a real run; DRY_RUN and CHECK need none
#   7 UNDO removes the drop-ins and the env file, takes the host out, keeps the table
# The last line is ALL SCENARIOS OK when every one passed:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" debian:13-slim bash /repo/scripts/pi/container-test/stage30-scenarios.sh
# (scripts/pi/player-connector-stage.test.mjs runs it with PI_STAGE30_CONTAINER=1.) STAGE=<file> runs another copy of the script.
#
# DESTRUCTIVE: it adds a user and writes /etc/foundry-ai-tool and /opt. It refuses to run anywhere but a container.
set -uo pipefail

[ -f /.dockerenv ] || [ -n "${container:-}" ] || {
  echo "REFUSED: run this only in the test container (docker run ..., see the header)"
  exit 98
}

STAGE="${STAGE:-/repo/scripts/pi/remote/30-player-connector.sh}"
LIB=/repo/scripts/pi/remote/lib.sh
fails=0
pass() { echo "ok: $*"; }
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }

apt-get update >/dev/null 2>&1 && apt-get install -y --no-install-recommends nodejs >/dev/null 2>&1
command -v node >/dev/null 2>&1 || {
  echo "FAIL: nodejs could not be installed"
  exit 1
}

FOUNDRY_USER=foundry
TOOL_ETC=/etc/foundry-ai-tool
NODE_DIR=/opt/node24
id "$FOUNDRY_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$FOUNDRY_USER"
install -d -m 0750 -o root -g "$FOUNDRY_USER" "$TOOL_ETC"
install -d -m 0755 "$NODE_DIR/bin"
ln -sf "$(command -v node)" "$NODE_DIR/bin/node"
cfg="$TOOL_ETC/player-connector.json"
envf="$TOOL_ETC/player-connector.env"
access="$TOOL_ETC/dashboard-access.env"
src=/root/player-connector.json.new
unit_dir=/tmp/units
dash=foundry-ai-tool-dashboard.service
bridge=foundry-ai-tool-bridge.service
host=player-ai.example.org
aud=0123456789abcdef0123456789abcdef0123456789abcdef
secrets=(SECRETone1111111111 SECRETtwo2222222222 SECRETthree33333333 SECRETfour444444444)
cids=(cid1.access cid2.access cid3.access cid4.access)
uids=(aaaaaaaaaaaaaaa1 aaaaaaaaaaaaaaa2 aaaaaaaaaaaaaaa3 aaaaaaaaaaaaaaa4)

# table [endpoint] [uid4]: a four player table at $src
table() {
  local endpoint="${1:-https://$host/mcp/player}" uid4="${2:-${uids[3]}}"
  cat >"$src" <<EOF
{ "endpoint": "$endpoint", "audience": "$aud", "players": [
  { "clientId": "${cids[0]}", "clientSecret": "${secrets[0]}", "userId": "${uids[0]}" },
  { "clientId": "${cids[1]}", "clientSecret": "${secrets[1]}", "userId": "${uids[1]}" },
  { "clientId": "${cids[2]}", "clientSecret": "${secrets[2]}", "userId": "${uids[2]}" },
  { "clientId": "${cids[3]}", "clientSecret": "${secrets[3]}", "userId": "$uid4" } ] }
EOF
  chmod 0600 "$src"
}

fresh() {
  rm -rf "$unit_dir" "$cfg" "$envf" "$access" "$access.before-player-connector" "$src"
  mkdir -p "$unit_dir"
  for u in "$dash" "$bridge"; do
    printf '[Service]\nUser=%s\nGroup=%s\nExecStart=/bin/true\n' "$FOUNDRY_USER" "$FOUNDRY_USER" >"$unit_dir/$u"
  done
  cat >"$access" <<EOF
CF_ACCESS_TEAM_DOMAIN=team.cloudflareaccess.com
CF_ACCESS_AUD=${aud}
GM_EMAILS=gm@example.org
DASHBOARD_ALLOWED_HOSTS=pi.tail1234.ts.net,cogm.example.org
GM_DASHBOARD_TOKEN=GMTOKENabcdef012345
EOF
  chown "root:$FOUNDRY_USER" "$access"
  chmod 0640 "$access"
  table
}

# run [VAR=value ...]: the stage as the user runs it (lib.sh and the stage on one stdin); output in OUT, its exit code returned.
run() {
  local code
  OUT="$(cat "$LIB" "$STAGE" | env SRC_FILE="$src" UNIT_DIR="$unit_dir" NO_SNAPSHOT=1 "$@" bash -s 2>&1)"
  code=$?
  return "$code"
}
no_secret() { # $1 label
  local s
  for s in "${secrets[@]}" "${cids[@]}" GMTOKENabcdef012345; do
    if echo "$OUT" | grep -q "$s"; then
      fail "$1: a secret or id was printed ($s)"
      return 1
    fi
  done
  return 0
}

# 1.
fresh
run DRY_RUN=1 UNDO=1
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'one of'; then pass "two modes are refused"; else fail "two modes: rc=$rc $OUT"; fi
rm -f "$src"
run
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'player-connector-cloudflare.mjs'; then pass "no table points at the PC script"; else fail "no table: rc=$rc $OUT"; fi
table "https://$host/mcp/player" "short"
run
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q '16-character' && [ ! -e "$cfg" ]; then pass "a bad user id is refused, nothing installed"; else fail "bad uid: rc=$rc $OUT"; fi
table "https://$host/mcp/player" "${uids[0]}"
run
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'userId appears twice'; then pass "a duplicate user id is refused"; else fail "dup uid: rc=$rc $OUT"; fi
table "http://$host/mcp/player"
run
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'must be https'; then pass "a non-https endpoint is refused"; else fail "http: rc=$rc $OUT"; fi
table "https://$host/other"
run
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q '/mcp/player'; then pass "a wrong path is refused"; else fail "path: rc=$rc $OUT"; fi
table
sed -i "s/^User=.*/User=root/" "$unit_dir/$dash"
run
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'does not run as'; then pass "a unit that does not run as $FOUNDRY_USER is refused"; else fail "unit user: rc=$rc $OUT"; fi
fresh
rm "$access"
run
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'set-dashboard-access.sh'; then pass "no dashboard-access.env points at set-dashboard-access.sh"; else fail "no access env: rc=$rc $OUT"; fi
fresh
echo "FOUNDRY_AI_PLAYER_CONNECTOR_DEV_USER=abc" >"$TOOL_ETC/dashboard.env"
run
rc=$?
rm -f "$TOOL_ETC/dashboard.env"
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'DEV_USER' && [ ! -e "$cfg" ] && [ -f "$src" ]; then pass "a DEV_USER setting anywhere is refused, nothing changed"; else fail "dev user: rc=$rc $OUT"; fi

# 2.
fresh
before="$(sha256sum "$access" "$src" | sha256sum)"
run DRY_RUN=1
rc=$?
if [ "$rc" -eq 0 ] && [ ! -e "$cfg" ] && [ ! -e "$envf" ] && [ ! -e "$unit_dir/$dash.d" ] && [ "$before" = "$(sha256sum "$access" "$src" | sha256sum)" ] &&
  echo "$OUT" | grep -q "$host"; then pass "DRY_RUN says what it would do and changes nothing"; else fail "dry run: rc=$rc $OUT"; fi
no_secret "dry run" && pass "the dry run prints no secret or id"

# 3.
run
rc=$?
if [ "$rc" -eq 0 ] && [ "$(stat -c '%a %U:%G' "$cfg")" = "600 $FOUNDRY_USER:$FOUNDRY_USER" ] && [ ! -e "$src" ] && grep -q "${secrets[2]}" "$cfg"; then
  pass "the table is installed foundry 0600 and the source is removed"; else fail "install: rc=$rc $OUT"; fi
if [ "$(stat -c '%a %U:%G' "$envf")" = "640 root:$FOUNDRY_USER" ] && grep -qx 'FOUNDRY_AI_PLAYER_CONNECTOR=on' "$envf" &&
  grep -qx "FOUNDRY_AI_PLAYER_CONNECTOR_CONFIG=$cfg" "$envf" && ! grep -q DEV_USER "$envf"; then
  pass "the env file is root:$FOUNDRY_USER 0640: switch on, table path, no DEV_USER"; else fail "env file: $(cat "$envf" 2>&1)"; fi
if grep -qx "EnvironmentFile=-$envf" "$unit_dir/$dash.d/player-connector.conf" && grep -qx "EnvironmentFile=-$envf" "$unit_dir/$bridge.d/player-connector.conf" &&
  [ "$(grep -c '' "$unit_dir/$dash")" = 4 ]; then pass "both units have the drop-in and the units themselves are untouched"; else fail "drop-ins"; fi
if grep -qx "DASHBOARD_ALLOWED_HOSTS=pi.tail1234.ts.net,cogm.example.org,$host" "$access" && grep -q 'GM_DASHBOARD_TOKEN=GMTOKENabcdef012345' "$access" &&
  grep -q 'CF_ACCESS_TEAM_DOMAIN=team.cloudflareaccess.com' "$access" && [ "$(stat -c '%a %U:%G' "$access")" = "640 root:$FOUNDRY_USER" ] &&
  grep -qx 'DASHBOARD_ALLOWED_HOSTS=pi.tail1234.ts.net,cogm.example.org' "$access.before-player-connector"; then
  pass "the host is added, the other lines and the mode are kept, a copy is saved"; else fail "allowed hosts: $(cat "$access")"; fi
no_secret "install" && pass "no secret or id is printed by the install"

# 4.
sums="$(sha256sum "$cfg" "$envf" "$access" "$unit_dir"/*.d/* | sha256sum)"
run
rc=$?
if [ "$rc" -eq 0 ] && [ "$sums" = "$(sha256sum "$cfg" "$envf" "$access" "$unit_dir"/*.d/* | sha256sum)" ] && [ "$(grep -o "$host" "$access" | wc -l)" = 1 ]; then
  pass "a rerun with no new table changes nothing"; else fail "rerun: rc=$rc $OUT"; fi
table
sed -i 's/SECRETone1111111111/SECRETnew00000000000/' "$src"
run
rc=$?
if [ "$rc" -eq 0 ] && grep -q SECRETnew00000000000 "$cfg" && [ "$(grep -o "$host" "$access" | wc -l)" = 1 ] && [ ! -e "$src" ]; then
  pass "a new table replaces the installed one, the host is not added twice"; else fail "replace: rc=$rc $OUT"; fi

# 5.
run CHECK=1
rc=$?
if [ "$rc" -eq 0 ] && echo "$OUT" | grep -q 'stage 30 check: ok'; then pass "CHECK passes on a good install"; else fail "check: rc=$rc $OUT"; fi
no_secret "check" && pass "CHECK prints no secret or id"
chmod 0644 "$cfg"
run CHECK=1
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q "expected '600"; then pass "CHECK fails when the table's mode is wrong"; else fail "check mode: rc=$rc $OUT"; fi
chmod 0600 "$cfg"

# 6.
mkdir -p /tmp/fakedietpi /tmp/stats
echo "2000-01-01_00:00:00 Backup completed" >/tmp/stats/stats
table
OUT="$(cat "$LIB" "$STAGE" | env SRC_FILE="$src" UNIT_DIR="$unit_dir" DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats/stats bash -s 2>&1)"
rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q 'no dietpi-backup snapshot completed today' && [ -f "$src" ]; then pass "a stale snapshot refuses a real run before anything changes"; else fail "stale snapshot: rc=$rc $OUT"; fi
OUT="$(cat "$LIB" "$STAGE" | env SRC_FILE="$src" UNIT_DIR="$unit_dir" DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats/stats DRY_RUN=1 bash -s 2>&1)"
rc=$?
if [ "$rc" -eq 0 ]; then pass "DRY_RUN needs no snapshot"; else fail "dry run snapshot: rc=$rc $OUT"; fi
OUT="$(cat "$LIB" "$STAGE" | env SRC_FILE="$src" UNIT_DIR="$unit_dir" DIETPI_DIR=/tmp/fakedietpi DIETPI_BACKUP_STATS=/tmp/stats/stats CHECK=1 bash -s 2>&1)"
rc=$?
if [ "$rc" -eq 0 ]; then pass "CHECK needs no snapshot"; else fail "check snapshot: rc=$rc $OUT"; fi
rm -f "$src"

# 7.
run UNDO=1
rc=$?
if [ "$rc" -eq 0 ] && [ ! -e "$envf" ] && [ ! -e "$unit_dir/$dash.d" ] && [ ! -e "$unit_dir/$bridge.d" ] && [ -f "$cfg" ] &&
  grep -qx 'DASHBOARD_ALLOWED_HOSTS=pi.tail1234.ts.net,cogm.example.org' "$access" && grep -q 'GM_DASHBOARD_TOKEN=GMTOKENabcdef012345' "$access"; then
  pass "UNDO removes the drop-ins and the env file, takes the host out and keeps the table"; else fail "undo: rc=$rc $OUT"; fi
no_secret "undo" && pass "UNDO prints no secret or id"

if [ "$fails" -eq 0 ]; then echo "ALL SCENARIOS OK"; else echo "$fails scenario(s) FAILED"; exit 1; fi
