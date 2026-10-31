#!/usr/bin/env bash
# Pi stage 20 (scripts/pi/remote/20-vault-sync.sh, Obsidian O8) in a Debian 13 ARM64 container with the real Syncthing and
# the real lib.sh. Two Syncthing instances run in the container, both on loopback and with discovery, relays and NAT off:
# "Pi" (user foundry, home /var/lib/foundry-ai-tool/syncthing, the vault in /var/lib/foundry-ai-tool/obsidian/gm, the layout
# of stage 7) and "PC" (root, /tmp/pc-st, its vault in /tmp/pc-vault). Scenarios:
#   1 a note written on the Pi arrives on the PC, and one written on the PC arrives on the Pi (the sync in both directions)
#   2 the report on a clean vault: exit 0, "no .sync-conflict-*", the PC connected, the zone right
#   3 the same note changed on both sides while the PC is stopped makes a .sync-conflict-* file; the report lists it, exit 0,
#     and STRICT=1 exits 1; nothing in the vault is changed or removed by the stage
#   4 the zone: a wrong /etc/timezone warns (exit 0, STRICT=1 exit 1); a bad TIMEZONE is refused; SET_TIMEZONE=1 without
#     systemd stops with a message and changes nothing
#   5 a missing folder (an unknown folder id config) stops with "run stage 7 first"
# The last line is ALL SCENARIOS OK when every one passed:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" debian:13-slim bash /repo/scripts/pi/container-test/stage20-scenarios.sh
# (scripts/pi/vault-sync.test.mjs runs it with PI_STAGE20_CONTAINER=1.) STAGE=<file> runs the scenarios against another copy
# of the script.
#
# DESTRUCTIVE: it adds a user, installs packages and writes /var/lib/foundry-ai-tool and /etc/timezone. It refuses to run
# anywhere but a container.
set -uo pipefail

[ -f /.dockerenv ] || [ -n "${container:-}" ] || {
  echo "REFUSED: run this only in the test container (docker run ..., see the header)"
  exit 98
}

STAGE="${STAGE:-/repo/scripts/pi/remote/20-vault-sync.sh}"
LIB=/repo/scripts/pi/remote/lib.sh
fails=0
pass() { echo "ok: $*"; }
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }

export DEBIAN_FRONTEND=noninteractive
{ apt-get update && apt-get install -y --no-install-recommends syncthing tzdata procps ca-certificates; } >/dev/null 2>&1 ||
  { echo "SETUP FAILED: apt-get"; exit 99; }

. "$LIB"
set +e # lib.sh turns -e on; the scenarios count their own failures
useradd --system --no-create-home --shell /usr/sbin/nologin "$FOUNDRY_USER"
gm_dir="$TOOL_DATA/obsidian/gm"
pi_home="$TOOL_DATA/syncthing"
pc_home=/tmp/pc-st
pc_vault=/tmp/pc-vault
install -d -m 0750 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$TOOL_DATA" "$TOOL_DATA/obsidian" "$gm_dir"
install -d -m 0700 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$pi_home"
mkdir -p "$pc_home" "$pc_vault"

pi() { runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" syncthing cli --home="$pi_home" "$@"; }
pc() { HOME=/root syncthing cli --home="$pc_home" "$@"; }

# Quiet, loopback-only options for one instance: $1 = cli function, $2 = the sync port.
quiet_options() {
  local cli="$1" port="$2"
  "$cli" config options natenabled set false
  "$cli" config options local-ann-enabled set false
  "$cli" config options global-ann-enabled set false
  "$cli" config options relays-enabled set false
  "$cli" config options uraccepted set -- -1
  : "$port" # the listen address is set in config.xml before the first start (the cli has no list setter for it)
}
wait_for() { # $1 seconds, then a command
  local n="$1" i=0
  shift
  until "$@" >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -le "$n" ] || return 1
    sleep 1
  done
}
start_pi() {
  runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" nohup syncthing serve --no-browser --no-restart --no-default-folder \
    --skip-port-probing --no-upgrade --home="$pi_home" --gui-address=127.0.0.1:8384 >/tmp/pi-st.log 2>&1 </dev/null &
  wait_for 60 pi show system
}
start_pc() {
  HOME=/root nohup syncthing serve --no-browser --no-restart --no-default-folder --skip-port-probing --no-upgrade \
    --home="$pc_home" --gui-address=127.0.0.1:8385 >/tmp/pc-st.log 2>&1 </dev/null &
  wait_for 60 pc show system
}

runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" syncthing generate --home="$pi_home" >/dev/null 2>&1
HOME=/root syncthing generate --home="$pc_home" >/dev/null 2>&1
# `syncthing cli` reads the GUI address from the config, so the PC's config must say 8385, not the generated 8384.
sed -i 's/127\.0\.0\.1:8384/127.0.0.1:8385/' "$pc_home/config.xml"
sed -i 's#<listenAddress>default</listenAddress>#<listenAddress>tcp://127.0.0.1:22001</listenAddress>#' "$pc_home/config.xml"
sed -i 's#<listenAddress>default</listenAddress>#<listenAddress>tcp://127.0.0.1:22000</listenAddress>#' "$pi_home/config.xml"
start_pi || { echo "SETUP FAILED: the Pi's Syncthing does not start: $(cat /tmp/pi-st.log)"; exit 99; }
start_pc || { echo "SETUP FAILED: the PC's Syncthing does not start: $(cat /tmp/pc-st.log)"; exit 99; }
[ "$(pi config gui raw-address get)" = "127.0.0.1:8384" ] || { echo "SETUP FAILED: the Pi's GUI address"; exit 99; }
quiet_options pi 22000
quiet_options pc 22001
pi_id="$(pi show system | sed -n 's/.*"myID": "\([A-Z0-9-]*\)".*/\1/p')"
pc_id="$(pc show system | sed -n 's/.*"myID": "\([A-Z0-9-]*\)".*/\1/p')"
# No --addresses flag: the cli panics on it (stage 7 avoids it too); the address is added to the new device afterwards.
pi config devices add --device-id "$pc_id" --name test-pc
pi config devices "$pc_id" addresses add tcp://127.0.0.1:22001
pc config devices add --device-id "$pi_id" --name test-pi
pc config devices "$pi_id" addresses add tcp://127.0.0.1:22000
pi config folders add --id foundry-gm-vault --label "Foundry GM vault" --path "$gm_dir" --type sendreceive
pc config folders add --id foundry-gm-vault --label "Foundry GM vault" --path "$pc_vault" --type sendreceive
pi config folders foundry-gm-vault devices add --device-id "$pc_id"
pc config folders foundry-gm-vault devices add --device-id "$pi_id"

run_stage() { # env assignments first, as arguments: run_stage VAR=value ...
  (
    for kv in "$@"; do export "${kv?}"; done
    cat "$LIB" "$STAGE" | bash -s 2>&1
  )
}

# 1.
printf 'from the Pi\n' | runuser -u "$FOUNDRY_USER" -- tee "$gm_dir/from-pi.md" >/dev/null
printf 'from the PC\n' >"$pc_vault/from-pc.md"
if wait_for 90 test -f "$pc_vault/from-pi.md" && wait_for 90 test -f "$gm_dir/from-pc.md"; then
  pass "a note written on each side arrives on the other"
else
  fail "no sync: PC has $(ls "$pc_vault"), Pi has $(ls "$gm_dir"); $(tail -n 5 /tmp/pi-st.log)"
fi

# 2.
echo Europe/Copenhagen >/etc/timezone
ln -sf /usr/share/zoneinfo/Europe/Copenhagen /etc/localtime
out="$(run_stage)"
rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q 'no .sync-conflict-\* files' && echo "$out" | grep -q 'test-pc is connected' &&
  echo "$out" | grep -q 'the Pi is on Europe/Copenhagen' && echo "$out" | grep -q 'inside the tool.s data folder'; then
  pass "the report on a clean vault"
else
  fail "clean report (exit $rc): $out"
fi
if echo "$out" | grep -q 'WARNING'; then fail "warnings on a clean vault: $out"; else pass "no warning on a clean vault"; fi

# 3. Both sides change the note while the PC is stopped; the older change loses and keeps its text in a conflict file.
printf 'first\n' | runuser -u "$FOUNDRY_USER" -- tee "$gm_dir/shared.md" >/dev/null
wait_for 60 test -f "$pc_vault/shared.md"
pc_pid="$(pgrep -f -- "--home=$pc_home" | head -n 1)"
kill "$pc_pid"
wait_for 30 bash -c "! kill -0 $pc_pid"
printf 'pi edit\n' | runuser -u "$FOUNDRY_USER" -- tee "$gm_dir/shared.md" >/dev/null
sleep 2
printf 'pc edit\n' >"$pc_vault/shared.md"
start_pc
has_conflict() { find "$gm_dir" -name '*.sync-conflict-*' | grep -q .; }
if wait_for 120 has_conflict; then pass "a conflict file appears in the Pi's vault"; else fail "no conflict file: $(ls -A "$gm_dir")"; fi
before="$(find "$gm_dir" -type f -not -path '*/.stfolder/*' | sort | xargs sha256sum)"
out="$(run_stage)"
rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q 'WARNING: 1 conflict file' && echo "$out" | grep -q 'shared\.sync-conflict-'; then
  pass "the report lists the conflict (exit 0)"
else
  fail "conflict report (exit $rc): $out"
fi
out="$(run_stage STRICT=1)"
rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'thing(s) to look at'; then pass "STRICT=1 fails on a conflict"; else fail "strict (exit $rc): $out"; fi
after="$(find "$gm_dir" -type f -not -path '*/.stfolder/*' | sort | xargs sha256sum)"
if [ "$before" = "$after" ]; then pass "the stage changed nothing in the vault"; else fail "the vault changed during the report"; fi

# 4.
echo UTC >/etc/timezone
ln -sf /usr/share/zoneinfo/UTC /etc/localtime
out="$(run_stage)"
rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q 'WARNING: the Pi is on UTC, not Europe/Copenhagen'; then pass "a wrong zone warns (exit 0)"; else fail "zone warn (exit $rc): $out"; fi
out="$(run_stage SET_TIMEZONE=1)"
rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'no systemd here' && [ "$(readlink /etc/localtime)" = /usr/share/zoneinfo/UTC ]; then
  pass "SET_TIMEZONE=1 without systemd stops and changes nothing"
else
  fail "set tz (exit $rc): $out"
fi
for bad in '../etc/passwd' '/etc/passwd' 'Europe/Nowhere' 'UTC;id'; do
  out="$(run_stage TIMEZONE="$bad")"
  rc=$?
  if [ "$rc" -eq 1 ] && echo "$out" | grep -Eq 'not a zone|is not a zone'; then pass "refused TIMEZONE '$bad'"; else fail "TIMEZONE '$bad' (exit $rc): $out"; fi
done

# 5.
pi config folders foundry-gm-vault delete || fail "could not delete the folder for scenario 5"
out="$(run_stage)"
rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'run stage 7 first'; then pass "a missing folder stops the stage"; else fail "missing folder (exit $rc): $out"; fi

[ "$fails" -eq 0 ] && echo "ALL SCENARIOS OK" || exit 1
