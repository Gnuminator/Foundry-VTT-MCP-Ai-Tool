#!/usr/bin/env bash
# Pi stage 31 (scripts/pi/remote/31-gm-vault-peers.sh, backlog r1-gm-vault) in a Debian 13 ARM64 container with the real
# Syncthing and the real lib.sh. Three Syncthing instances run on loopback with discovery, relays and NAT off: "Pi" (user
# foundry, the layout of stage 7), "pc1" (the user's PC, already sharing the vault) and "pc2" (Danni's PC, added by the stage).
# Scenarios:
#   1 the report lists pc1, exits 0 and changes nothing
#   2 REMOVE of pc1 is refused while no other device holds the vault
#   3 ADD adds pc2 (not an introducer, no auto-accept); pc2 gets the notes; ADD again is harmless
#   4 REMOVE of pc1 works once pc2 holds all of it: files stay on the Pi, pc1 is forgotten, pc2 still gets new notes and pc1 none
#   5 the refusals: a bad ID, ADD and REMOVE together, the Pi's own ID, REMOVE of a device that is not on the vault, ADD of a
#     device that is on a player folder
# The last line is ALL SCENARIOS OK when every one passed:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" <IMAGE> bash /repo/scripts/pi/container-test/stage31-scenarios.sh
# (scripts/pi/gm-vault-peers.test.mjs runs it with PI_STAGE31_CONTAINER=1.) STAGE=<file> runs it against another copy.
#
# DESTRUCTIVE: it adds a user, installs packages and writes /var/lib/foundry-ai-tool. It refuses to run anywhere but a container.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_test_container


STAGE="${STAGE:-/repo/scripts/pi/remote/31-gm-vault-peers.sh}"
LIB=/repo/scripts/pi/remote/lib.sh


. "$LIB"
set +e # lib.sh turns -e on; the scenarios count their own failures
useradd --system --no-create-home --shell /usr/sbin/nologin "$FOUNDRY_USER"
gm_dir="$TOOL_DATA/obsidian/gm"
pi_home="$TOOL_DATA/syncthing"
install -d -m 0750 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$TOOL_DATA" "$TOOL_DATA/obsidian" "$gm_dir"
install -d -m 0700 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$pi_home"
mkdir -p /tmp/pc1-st /tmp/pc1-vault /tmp/pc2-st /tmp/pc2-vault

pi() { runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" syncthing cli --home="$pi_home" "$@"; }
pc1() { HOME=/root syncthing cli --home=/tmp/pc1-st "$@"; }
pc2() { HOME=/root syncthing cli --home=/tmp/pc2-st "$@"; }
wait_for() {
  local n="$1" i=0
  shift
  until "$@" >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -le "$n" ] || return 1
    sleep 1
  done
}
quiet_options() {
  local cli="$1"
  "$cli" config options natenabled set false
  "$cli" config options local-ann-enabled set false
  "$cli" config options global-ann-enabled set false
  "$cli" config options relays-enabled set false
  "$cli" config options uraccepted set -- -1
}
start_pi() {
  runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" nohup syncthing serve --no-browser --no-restart --no-default-folder \
    --skip-port-probing --no-upgrade --home="$pi_home" --gui-address=127.0.0.1:8384 >/tmp/pi-st.log 2>&1 </dev/null &
  wait_for 60 pi show system
}
start_pc() { # $1 cli function, $2 home, $3 gui port
  HOME=/root nohup syncthing serve --no-browser --no-restart --no-default-folder --skip-port-probing --no-upgrade \
    --home="$2" --gui-address="127.0.0.1:$3" >"/tmp/$(basename "$2").log" 2>&1 </dev/null &
  wait_for 60 "$1" show system
}

runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" syncthing generate --home="$pi_home" >/dev/null 2>&1
HOME=/root syncthing generate --home=/tmp/pc1-st >/dev/null 2>&1
HOME=/root syncthing generate --home=/tmp/pc2-st >/dev/null 2>&1
# `syncthing cli` reads the GUI address from the config, so each PC's config must carry its own port.
sed -i 's/127\.0\.0\.1:8384/127.0.0.1:8385/; s#<listenAddress>default</listenAddress>#<listenAddress>tcp://127.0.0.1:22001</listenAddress>#' /tmp/pc1-st/config.xml
sed -i 's/127\.0\.0\.1:8384/127.0.0.1:8386/; s#<listenAddress>default</listenAddress>#<listenAddress>tcp://127.0.0.1:22002</listenAddress>#' /tmp/pc2-st/config.xml
sed -i 's#<listenAddress>default</listenAddress>#<listenAddress>tcp://127.0.0.1:22000</listenAddress>#' "$pi_home/config.xml"
start_pi || { echo "SETUP FAILED: the Pi's Syncthing: $(cat /tmp/pi-st.log)"; exit 99; }
start_pc pc1 /tmp/pc1-st 8385 || { echo "SETUP FAILED: pc1: $(cat /tmp/pc1-st.log)"; exit 99; }
start_pc pc2 /tmp/pc2-st 8386 || { echo "SETUP FAILED: pc2: $(cat /tmp/pc2-st.log)"; exit 99; }
quiet_options pi
quiet_options pc1
quiet_options pc2
pi_id="$(pi show system | sed -n 's/.*"myID": "\([A-Z0-9-]*\)".*/\1/p')"
pc1_id="$(pc1 show system | sed -n 's/.*"myID": "\([A-Z0-9-]*\)".*/\1/p')"
pc2_id="$(pc2 show system | sed -n 's/.*"myID": "\([A-Z0-9-]*\)".*/\1/p')"
# No --addresses flag: the cli panics on it (stage 7 avoids it too); the address is added to the new device afterwards.
pi config devices add --device-id "$pc1_id" --name user-pc
pi config devices "$pc1_id" addresses add tcp://127.0.0.1:22001
pc1 config devices add --device-id "$pi_id" --name test-pi
pc1 config devices "$pi_id" addresses add tcp://127.0.0.1:22000
pi config folders add --id foundry-gm-vault --label "Foundry GM vault" --path "$gm_dir" --type sendreceive
pc1 config folders add --id foundry-gm-vault --label "Foundry GM vault" --path /tmp/pc1-vault --type sendreceive
pi config folders foundry-gm-vault devices add --device-id "$pc1_id"
pc1 config folders foundry-gm-vault devices add --device-id "$pi_id"
# pc2 already knows the Pi and the folder (Danni's accept step), but the Pi does not know pc2 until the stage adds it.
pc2 config devices add --device-id "$pi_id" --name test-pi
pc2 config devices "$pi_id" addresses add tcp://127.0.0.1:22000
pc2 config folders add --id foundry-gm-vault --label "Foundry GM vault" --path /tmp/pc2-vault --type sendreceive
pc2 config folders foundry-gm-vault devices add --device-id "$pi_id"

run_stage() { # env assignments first, as arguments
  (
    for kv in "$@"; do export "${kv?}"; done
    cat "$LIB" "$STAGE" | bash -s 2>&1
  )
}
vault_sum() { find "$gm_dir" -type f -not -path '*/.stfolder/*' | sort | xargs -r sha256sum; }
# pc2_complete: the Pi says pc2 holds all of the vault.
pc2_complete() {
  local key
  key="$(pi config gui apikey get)"
  curl -fs -H "X-API-Key: $key" "http://127.0.0.1:8384/rest/db/completion?folder=foundry-gm-vault&device=$pc2_id" | tr -d ' \n' | grep -q '"completion":100'
}

printf 'note one\n' | runuser -u "$FOUNDRY_USER" -- tee "$gm_dir/one.md" >/dev/null
wait_for 90 test -f /tmp/pc1-vault/one.md || fail "setup: pc1 did not get the first note"

# 1.
before="$(vault_sum)"
out="$(run_stage)"
rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q 'user-pc'; then pass "the report lists pc1 (exit 0)"; else fail "report (exit $rc): $out"; fi
[ "$before" = "$(vault_sum)" ] && pass "the report changed nothing" || fail "the report changed the vault"

# 2.
out="$(run_stage REMOVE=1 DEVICE_ID="$pc1_id")"
rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'no other device holds all of the vault' &&
  pi config folders foundry-gm-vault devices list | grep -qx "$pc1_id"; then
  pass "REMOVE is refused while no other device holds the vault"
else
  fail "guard (exit $rc): $out"
fi

# 2b. A device that was added but never connected or accepted the folder is no safe copy, whatever its percentage reads.
mkdir -p /tmp/pc3-st
HOME=/root syncthing generate --home=/tmp/pc3-st >/dev/null 2>&1
pc3_id="$(HOME=/root syncthing device-id --home=/tmp/pc3-st 2>/dev/null | head -n 1)"
out="$(run_stage ADD=1 DEVICE_ID="$pc3_id" DEVICE_NAME=never-connects)"
out="$(run_stage REMOVE=1 DEVICE_ID="$pc1_id")"
rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'no other device holds all of the vault' &&
  pi config folders foundry-gm-vault devices list | grep -qx "$pc1_id"; then
  pass "a device that never connected does not count as a copy"
else
  fail "never-connected guard (exit $rc): $out"
fi
run_stage REMOVE=1 DEVICE_ID="$pc3_id" FORCE=1 >/dev/null

# 3.
out="$(run_stage ADD=1 DEVICE_ID="$pc2_id" DEVICE_NAME=danni-pc)"
rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q 'shared foundry-gm-vault with it'; then pass "ADD shares the vault with pc2"; else fail "add (exit $rc): $out"; fi
if [ "$(pi config devices "$pc2_id" introducer get)" = false ] && [ "$(pi config devices "$pc2_id" auto-accept-folders get)" = false ]; then
  pass "pc2 is no introducer and does not auto-accept"
else
  fail "pc2 flags"
fi
if wait_for 90 test -f /tmp/pc2-vault/one.md; then pass "pc2 gets the notes"; else fail "pc2 got nothing: $(tail -n 5 /tmp/pi-st.log)"; fi
out="$(run_stage ADD=1 DEVICE_ID="$pc2_id")"
rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q 'already'; then pass "ADD twice is harmless"; else fail "second add (exit $rc): $out"; fi

# 4.
wait_for 60 pc2_complete || fail "pc2 never reached 100 %"
before="$(vault_sum)"
out="$(run_stage REMOVE=1 DEVICE_ID="$pc1_id")"
rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q 'is forgotten'; then pass "REMOVE of pc1 works once pc2 holds everything"; else fail "remove (exit $rc): $out"; fi
if pi config devices list | grep -qx "$pc1_id"; then fail "pc1 is still a known device"; else pass "pc1 is forgotten"; fi
[ "$before" = "$(vault_sum)" ] && pass "the vault files stayed" || fail "the vault changed"
printf 'note two\n' | runuser -u "$FOUNDRY_USER" -- tee "$gm_dir/two.md" >/dev/null
if wait_for 90 test -f /tmp/pc2-vault/two.md; then pass "pc2 still gets new notes"; else fail "pc2 missed note two"; fi
sleep 3
[ ! -f /tmp/pc1-vault/two.md ] && pass "pc1 no longer gets new notes" || fail "pc1 got note two"

# 5.
for bad in 'NOPE' 'abc'; do
  out="$(run_stage ADD=1 DEVICE_ID="$bad")"
  rc=$?
  if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'not a Syncthing device ID'; then pass "refused DEVICE_ID '$bad'"; else fail "bad id '$bad' (exit $rc): $out"; fi
done
out="$(run_stage ADD=1 REMOVE=1 DEVICE_ID="$pc2_id")"
rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'only one of ADD=1 and REMOVE=1'; then pass "ADD and REMOVE together are refused"; else fail "both (exit $rc): $out"; fi
out="$(run_stage ADD=1 DEVICE_ID="$pi_id")"
rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q "this Pi's own ID"; then pass "the Pi's own ID is refused"; else fail "own id (exit $rc): $out"; fi
out="$(run_stage REMOVE=1 DEVICE_ID="$pc1_id")"
rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'is not on the folder'; then pass "REMOVE of a device not on the vault is refused"; else fail "not on folder (exit $rc): $out"; fi
pi config devices add --device-id "$pc1_id" --name user-pc
pi config folders add --id foundry-player-test --label player --path /tmp/player-test --type sendonly
pi config folders foundry-player-test devices add --device-id "$pc1_id"
out="$(run_stage ADD=1 DEVICE_ID="$pc1_id")"
rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'never gets the GM vault'; then pass "a player folder's device is refused"; else fail "player device (exit $rc): $out"; fi

[ "$fails" -eq 0 ] && echo "ALL SCENARIOS OK" || exit 1
