#!/usr/bin/env bash
# Pi stage 21 (scripts/pi/remote/21-player-vault.sh, player-vault-sync, D-134) in a Debian 13 ARM64 container with the real
# Syncthing and the real lib.sh. Three Syncthing instances run in the container, all on loopback with discovery, relays and
# NAT off: "Pi" (user foundry, the layout of stage 7), and two player devices "A" (Mira) and "B" (Jens), both root. Scenarios:
#   1 refusals before anything is touched: a bad DEVICE_ID, a PLAYER with a slash or a leading dot, add without both inputs,
#     a PLAYER folder without the dashboard marker or a link
#   2 SETUP=1 writes the dashboard drop-in and the players folder (no systemd here: nothing restarts), and writes it once
#   3 add Mira + device A: a Send Only folder, a note written on the Pi reaches A, the marker file is not offered
#   4 what a player does never reaches the Pi: a new file and a changed note on A leave the Pi's files as they were
#   5 add Jens + device B: B gets Jens' notes and none of Mira's; the GM vault is shared with nobody new
#   6 device A for Jens is refused (one device, one player), the folder for Jens gains no device; adding A for Mira again is fine
#   7 report: exit 0 and no warning when clean; a Send Only folder turned into send and receive warns, STRICT=1 exits 1, and adding
#     again turns it back
#   8 REMOVE with a device: B is unshared and forgotten; REMOVE without one: the folder leaves Syncthing, the files stay
#   9 OFF=1: no player folder left, the drop-in gone, every vault file still there
# The last line is ALL SCENARIOS OK when every one passed:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" <IMAGE> bash /repo/scripts/pi/container-test/stage21-scenarios.sh
# (scripts/pi/player-vault.test.mjs runs it with PI_STAGE21_CONTAINER=1.) STAGE=<file> runs the scenarios against another copy
# of the script.
#
# DESTRUCTIVE: it adds a user, installs packages and writes /var/lib/foundry-ai-tool and /etc/systemd. It refuses to run
# anywhere but a container.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_test_container


STAGE="${STAGE:-/repo/scripts/pi/remote/21-player-vault.sh}"
LIB=/repo/scripts/pi/remote/lib.sh


. "$LIB"
set +e # lib.sh turns -e on; the scenarios count their own failures
useradd --system --no-create-home --shell /usr/sbin/nologin "$FOUNDRY_USER"
gm_dir="$TOOL_DATA/obsidian/gm"
players="$TOOL_DATA/obsidian/players"
pi_home="$TOOL_DATA/syncthing"
a_home=/tmp/a-st
b_home=/tmp/b-st
a_vault=/tmp/a-vault
b_vault=/tmp/b-vault
install -d -m 0750 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$TOOL_DATA" "$TOOL_DATA/obsidian" "$gm_dir"
install -d -m 0700 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$pi_home"
mkdir -p "$a_home" "$b_home" "$a_vault" "$b_vault"

pi() { runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" syncthing cli --home="$pi_home" "$@"; }
sa() { HOME=/root syncthing cli --home="$a_home" "$@"; }
sb() { HOME=/root syncthing cli --home="$b_home" "$@"; }

wait_for() { # $1 seconds, then a command
  local n="$1" i=0
  shift
  until "$@" >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -le "$n" ] || return 1
    sleep 1
  done
}
quiet_options() { # $1 = cli function
  "$1" config options natenabled set false
  "$1" config options local-ann-enabled set false
  "$1" config options global-ann-enabled set false
  "$1" config options relays-enabled set false
  "$1" config options uraccepted set -- -1
}
# gen_instance HOME PORT GUI [as_foundry]: generate, point the listen and GUI addresses, start.
start_instance() {
  local home="$1" gui="$2" cli="$3" log="$4"
  if [ "$home" = "$pi_home" ]; then
    runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" nohup syncthing serve --no-browser --no-restart --no-default-folder \
      --skip-port-probing --no-upgrade --home="$home" --gui-address="127.0.0.1:$gui" >"$log" 2>&1 </dev/null &
  else
    HOME=/root nohup syncthing serve --no-browser --no-restart --no-default-folder --skip-port-probing --no-upgrade \
      --home="$home" --gui-address="127.0.0.1:$gui" >"$log" 2>&1 </dev/null &
  fi
  wait_for 60 "$cli" show system
}
runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" syncthing generate --home="$pi_home" >/dev/null 2>&1
HOME=/root syncthing generate --home="$a_home" >/dev/null 2>&1
HOME=/root syncthing generate --home="$b_home" >/dev/null 2>&1
# `syncthing cli` reads the GUI address from the config, so each config must say its own port, not the generated 8384.
sed -i 's/127\.0\.0\.1:8384/127.0.0.1:8385/' "$a_home/config.xml"
sed -i 's/127\.0\.0\.1:8384/127.0.0.1:8386/' "$b_home/config.xml"
sed -i 's#<listenAddress>default</listenAddress>#<listenAddress>tcp://127.0.0.1:22000</listenAddress>#' "$pi_home/config.xml"
sed -i 's#<listenAddress>default</listenAddress>#<listenAddress>tcp://127.0.0.1:22001</listenAddress>#' "$a_home/config.xml"
sed -i 's#<listenAddress>default</listenAddress>#<listenAddress>tcp://127.0.0.1:22002</listenAddress>#' "$b_home/config.xml"
start_instance "$pi_home" 8384 pi /tmp/pi-st.log || { echo "SETUP FAILED: the Pi's Syncthing: $(cat /tmp/pi-st.log)"; exit 99; }
start_instance "$a_home" 8385 sa /tmp/a-st.log || { echo "SETUP FAILED: A's Syncthing: $(cat /tmp/a-st.log)"; exit 99; }
start_instance "$b_home" 8386 sb /tmp/b-st.log || { echo "SETUP FAILED: B's Syncthing: $(cat /tmp/b-st.log)"; exit 99; }
quiet_options pi
quiet_options sa
quiet_options sb
myid() { "$1" show system | sed -n 's/.*"myID": "\([A-Z0-9-]*\)".*/\1/p'; }
pi_id="$(myid pi)"
a_id="$(myid sa)"
b_id="$(myid sb)"
# The player devices know the Pi (as the player does after accepting the Pi's request) and dial it.
sa config devices add --device-id "$pi_id" --name the-pi
sa config devices "$pi_id" addresses add tcp://127.0.0.1:22000
sb config devices add --device-id "$pi_id" --name the-pi
sb config devices "$pi_id" addresses add tcp://127.0.0.1:22000
# The GM vault folder exists on the Pi, as after stage 7 (no peer).
pi config folders add --id foundry-gm-vault --label "Foundry GM vault" --path "$gm_dir" --type sendreceive

run_stage() { # env assignments first, as arguments: run_stage VAR=value ...
  (
    for kv in "$@"; do export "${kv?}"; done
    cat "$LIB" "$STAGE" | bash -s 2>&1
  )
}
# A player folder the way the dashboard leaves it: marker file, a theme dir, notes.
make_player() { # $1 name
  install -d -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$players/$1" "$players/$1/Handouts"
  printf '{"schema":2,"userId":"u-%s","name":"%s","generatedBy":"foundry-ai-tool","files":[]}\n' "$1" "$1" |
    runuser -u "$FOUNDRY_USER" -- tee "$players/$1/.aitool-player.json" >/dev/null
  printf 'letter for %s\n' "$1" | runuser -u "$FOUNDRY_USER" -- tee "$players/$1/Handouts/Letter.md" >/dev/null
}
dropin=/etc/systemd/system/foundry-ai-tool-dashboard.service.d/player-vault.conf
mira="Mira"
jens="Jens Æble"

# 1.
out="$(run_stage DEVICE_ID=notanid PLAYER="$mira")"; rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'not a Syncthing device ID'; then pass "a bad DEVICE_ID is refused"; else fail "bad id (exit $rc): $out"; fi
for bad in '../x' 'a/b' '.hidden' 'a"b'; do
  out="$(run_stage PLAYER="$bad" DEVICE_ID="$a_id")"; rc=$?
  if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'PLAYER must be a folder name'; then pass "PLAYER '$bad' is refused"; else fail "PLAYER '$bad' (exit $rc): $out"; fi
done
out="$(run_stage PLAYER="$mira")"; rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'needs both'; then pass "add without a device is refused"; else fail "add without device (exit $rc): $out"; fi
out="$(run_stage REMOVE=1)"; rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'needs PLAYER'; then pass "REMOVE without PLAYER is refused"; else fail "remove without player (exit $rc): $out"; fi
if [ ! -e "$dropin" ] && [ -z "$(pi config folders list | grep foundry-player-)" ]; then pass "the refusals changed nothing"; else fail "something was written by a refusal"; fi

# 2.
out="$(run_stage SETUP=1)"; rc=$?
if [ "$rc" -eq 0 ] && [ -d "$players" ] && grep -q "FOUNDRY_AI_PLAYER_VAULTS_DIR=$players" "$dropin" &&
  [ "$(stat -c %U "$players")" = "$FOUNDRY_USER" ]; then
  pass "SETUP=1 writes the drop-in and the players folder"
else
  fail "setup (exit $rc): $out"
fi
out="$(run_stage SETUP=1)"
if echo "$out" | grep -q "$dropin unchanged"; then pass "SETUP=1 twice writes the drop-in once"; else fail "setup rerun: $out"; fi
# A folder without the marker, and a link, are never shared.
install -d -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$players/NoMarker"
out="$(run_stage PLAYER=NoMarker DEVICE_ID="$a_id")"; rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'no dashboard marker'; then pass "a folder without the marker is refused"; else fail "no marker (exit $rc): $out"; fi
ln -s "$gm_dir" "$players/LinkToGm"
out="$(run_stage PLAYER=LinkToGm DEVICE_ID="$a_id")"; rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'is a link'; then pass "a link to the GM vault is refused"; else fail "link (exit $rc): $out"; fi
out="$(run_stage PLAYER=Ghost DEVICE_ID="$a_id")"; rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q "no player folder 'Ghost'"; then pass "an unknown player is refused"; else fail "ghost (exit $rc): $out"; fi
rmdir "$players/NoMarker"
rm -f "$players/LinkToGm"

# 3.
make_player "$mira"
make_player "$jens"
out="$(run_stage PLAYER="$mira" DEVICE_ID="$a_id" DEVICE_NAME=mira-pc)"; rc=$?
mira_fid="$(pi config folders list | grep '^foundry-player-mira-')"
if [ "$rc" -eq 0 ] && [ -n "$mira_fid" ] && [ "$(pi config folders "$mira_fid" type get)" = sendonly ] &&
  [ "$(pi config folders "$mira_fid" path get)" = "$players/$mira" ] &&
  pi config folders "$mira_fid" devices list | grep -qx "$a_id"; then
  pass "add Mira: a Send Only folder shared with her device"
else
  fail "add Mira (exit $rc, folder '$mira_fid'): $out"
fi
if [ "$(pi config devices "$a_id" auto-accept-folders get)" = false ] && [ "$(pi config devices "$a_id" introducer get)" = false ]; then
  pass "the device is neither an introducer nor auto-accepting"
else
  fail "device flags"
fi
# A accepts: the same folder id, receive only.
# A player who skips "Receive Only" (send and receive): the Pi's Send Only must still keep everything out (scenario 4).
sa config folders add --id "$mira_fid" --label Mira --path "$a_vault" --type sendreceive
sa config folders "$mira_fid" devices add --device-id "$pi_id"
if wait_for 90 test -f "$a_vault/Handouts/Letter.md"; then pass "a note on the Pi reaches Mira's device"; else fail "no sync to A: $(ls -A "$a_vault"); $(tail -n 5 /tmp/pi-st.log)"; fi
if [ ! -e "$a_vault/.aitool-player.json" ]; then pass "the marker file is not offered"; else fail "the marker file reached A"; fi

# 4. A adds a file and changes the note; the Pi keeps its files.
printf 'A was here\n' >"$a_vault/by-player.md"
printf 'changed by the player\n' >"$a_vault/Handouts/Letter.md"
printf 'a new note on the Pi\n' | runuser -u "$FOUNDRY_USER" -- tee "$players/$mira/Second.md" >/dev/null
wait_for 90 test -f "$a_vault/Second.md"
sleep 10
if [ ! -e "$players/$mira/by-player.md" ] && [ "$(cat "$players/$mira/Handouts/Letter.md")" = "letter for $mira" ]; then
  pass "what the player changes never reaches the Pi"
else
  fail "the Pi changed: $(ls -A "$players/$mira"); $(cat "$players/$mira/Handouts/Letter.md")"
fi

# 5.
out="$(run_stage PLAYER="$jens" DEVICE_ID="$b_id" DEVICE_NAME=jens-pc)"; rc=$?
jens_fid="$(pi config folders list | grep '^foundry-player-' | grep -v "^$mira_fid$")"
if [ "$rc" -eq 0 ] && [ -n "$jens_fid" ] && [ "$(pi config folders "$jens_fid" path get)" = "$players/$jens" ]; then
  pass "add Jens (a name with a non-ASCII letter)"
else
  fail "add Jens (exit $rc, folder '$jens_fid'): $out"
fi
sb config folders add --id "$jens_fid" --label Jens --path "$b_vault" --type receiveonly
sb config folders "$jens_fid" devices add --device-id "$pi_id"
if wait_for 90 test -f "$b_vault/Handouts/Letter.md" && grep -q "letter for $jens" "$b_vault/Handouts/Letter.md"; then
  pass "Jens gets his own notes"
else
  fail "no sync to B: $(ls -A "$b_vault")"
fi
# B asks for Mira's folder and for the GM vault: the Pi has not shared them with B, so nothing comes.
sb config folders add --id "$mira_fid" --label Nope --path /tmp/b-nope --type receiveonly
sb config folders "$mira_fid" devices add --device-id "$pi_id"
sb config folders add --id foundry-gm-vault --label NopeGm --path /tmp/b-nogm --type receiveonly
sb config folders foundry-gm-vault devices add --device-id "$pi_id"
sleep 12
if ! find /tmp/b-nope /tmp/b-nogm -type f -name '*.md' 2>/dev/null | grep -q . && ! grep -rq "letter for $mira" "$b_vault"; then
  pass "B never receives Mira's notes or the GM vault"
else
  fail "B received something it should not: $(find /tmp/b-nope /tmp/b-nogm "$b_vault" -type f)"
fi
if ! pi config folders foundry-gm-vault devices list | grep -vx "$pi_id" | grep -q .; then pass "the GM vault has no new device"; else fail "the GM vault is shared with a device"; fi

# 6.
out="$(run_stage PLAYER="$jens" DEVICE_ID="$a_id")"; rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'already on the folder'; then pass "one device cannot serve two players"; else fail "second player on a device (exit $rc): $out"; fi
if ! pi config folders "$jens_fid" devices list | grep -qx "$a_id"; then pass "nothing was added for the refused device"; else fail "A was added to Jens' folder"; fi
out="$(run_stage PLAYER="$mira" DEVICE_ID="$a_id")"; rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q 'already shared'; then pass "adding the same device again is fine"; else fail "re-add (exit $rc): $out"; fi
out="$(run_stage PLAYER="$mira" DEVICE_ID="$pi_id")"; rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q "this Pi's own ID"; then pass "the Pi's own ID is refused"; else fail "own id (exit $rc): $out"; fi

# 7.
out="$(run_stage)"; rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q 'mira-pc is connected' && echo "$out" | grep -q "$mira: 2 notes" && ! echo "$out" | grep -q WARNING; then
  pass "the report on a clean setup"
else
  fail "clean report (exit $rc): $out"
fi
pi config folders "$mira_fid" type set sendreceive
out="$(run_stage)"; rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q 'is not Send Only'; then pass "the report warns about a folder that is not Send Only"; else fail "warn (exit $rc): $out"; fi
out="$(run_stage STRICT=1)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "STRICT=1 fails on it"; else fail "strict (exit $rc): $out"; fi
out="$(run_stage PLAYER="$mira" DEVICE_ID="$a_id")"
if [ "$(pi config folders "$mira_fid" type get)" = sendonly ]; then pass "adding again sets Send Only back"; else fail "type not restored: $out"; fi

# 8.
out="$(run_stage REMOVE=1 PLAYER="$jens" DEVICE_ID="$b_id")"; rc=$?
if [ "$rc" -eq 0 ] && ! pi config folders "$jens_fid" devices list | grep -qx "$b_id" && ! pi config devices list | grep -qx "$b_id"; then
  pass "REMOVE with a device unshares and forgets it"
else
  fail "remove device (exit $rc): $out"
fi
out="$(run_stage REMOVE=1 PLAYER="$mira")"; rc=$?
if [ "$rc" -eq 0 ] && ! pi config folders list | grep -qx "$mira_fid" && [ -f "$players/$mira/Handouts/Letter.md" ]; then
  pass "REMOVE without a device drops the folder and keeps the files"
else
  fail "remove folder (exit $rc): $out"
fi
out="$(run_stage REMOVE=1 PLAYER="$mira")"; rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'nothing to remove'; then pass "removing twice says so"; else fail "second remove (exit $rc): $out"; fi

# 8b. A device that is on the GM vault is refused for a player (B is a stand-in GM PC here).
pi config devices add --device-id "$b_id" --name gm-pc
pi config folders foundry-gm-vault devices add --device-id "$b_id"
out="$(run_stage PLAYER="$mira" DEVICE_ID="$b_id")"; rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'already on the folder foundry-gm-vault'; then pass "a GM vault device is refused for a player"; else fail "gm device (exit $rc): $out"; fi
pi config folders foundry-gm-vault devices "$b_id" delete
# B stays paired but on no folder: a player-vault switch-off must not forget it.

# 9. Conflicting modes are refused; OFF removes the shares and the drop-in, forgets only player devices.
out="$(run_stage OFF=1 PLAYER="$mira")"; rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'OFF=1 takes every player out'; then pass "OFF with PLAYER is refused"; else fail "off+player (exit $rc): $out"; fi
out="$(run_stage OFF=1 SETUP=1)"; rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'only one of'; then pass "two switches are refused"; else fail "two switches (exit $rc): $out"; fi
out="$(run_stage PLAYER="$mira" DEVICE_ID="$a_id")"
out="$(run_stage OFF=1)"; rc=$?
if [ "$rc" -eq 0 ] && [ -z "$(pi config folders list | grep foundry-player-)" ] && [ ! -e "$dropin" ] &&
  [ -f "$players/$mira/Handouts/Letter.md" ] && [ -f "$players/$jens/Handouts/Letter.md" ] && ! pi config devices list | grep -qx "$a_id"; then
  pass "OFF=1 removes the shares and the drop-in, keeps the files"
else
  fail "off (exit $rc): $out"
fi
if pi config devices list | grep -qx "$b_id"; then pass "OFF=1 leaves a device that was on no player folder"; else fail "OFF forgot an unrelated device"; fi

[ "$fails" -eq 0 ] && echo "ALL SCENARIOS OK" || exit 1
