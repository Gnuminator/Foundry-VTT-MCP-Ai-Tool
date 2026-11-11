#!/usr/bin/env bash
# Stage 31: who the GM vault is shared with (backlog r1-gm-vault, D-139). Stage 7 adds a first PC with PEER_ID, but it
# rewrites the bridge and dashboard settings on every run and cannot take a PC away again. This stage only touches
# Syncthing's list of devices on the folder foundry-gm-vault, so Danni's PC can be added, and the user's own PC taken off,
# without touching anything else. It never writes, moves or deletes a vault file: the notes stay on the Pi, and a PC that
# is taken off keeps its own copy of the folder (the user deletes that on the PC).
#
# Modes (environment, before bash):
#   (none)           report, read-only, any time: the devices on the vault, which are connected and how much of the vault
#                    each one holds; exit 0, exit 1 when Syncthing, the foundry user or the folder is missing
#   ADD=1 DEVICE_ID=<id> [DEVICE_NAME=<name>]
#                    add that PC's Syncthing device and share the vault with it (both ways, like stage 7). The device is
#                    never an introducer and never auto-accepts folders. Refused for a device that already holds a player
#                    vault folder (D-067: a player's device never gets the GM vault).
#   REMOVE=1 DEVICE_ID=<id>
#                    stop sharing the vault with that device and forget the device when no other folder uses it. Refused
#                    unless another device on the vault holds all of it (completion 100 %), so the vault is never left
#                    with the Pi as its only copy; FORCE=1 skips that one check.
# Every mode that changes something needs a dietpi-backup snapshot from today and the user's OK. Nothing restarts.
# Run from the PC (bash, not PowerShell):
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/31-gm-vault-peers.sh | ssh foundry-pi 'bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/31-gm-vault-peers.sh | ssh foundry-pi 'ADD=1 DEVICE_ID=ABCDEFG-... DEVICE_NAME=danni-pc bash -s'

require_root
PATH="$PATH:/usr/sbin:/sbin"

st_home="$TOOL_DATA/syncthing"
st_gui="127.0.0.1:8384"
folder_id="foundry-gm-vault"
device_id="${DEVICE_ID:-}"
device_name="${DEVICE_NAME:-}"
force="${FORCE:-0}"
mode=report
[ "${ADD:-0}" != 1 ] || mode=add
if [ "${REMOVE:-0}" = 1 ]; then
  [ "$mode" = report ] || die "give only one of ADD=1 and REMOVE=1"
  mode=remove
fi

# ---- Inputs are checked before anything is touched ----------------------------------------------------------------
if [ -n "$device_id" ]; then
  printf '%s' "$device_id" | grep -Eq '^[A-Z0-9]{7}(-[A-Z0-9]{7}){7}$' ||
    die "DEVICE_ID is not a Syncthing device ID (eight groups of seven letters and digits)"
fi
if [ -n "$device_name" ]; then
  printf '%s' "$device_name" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$' ||
    die "DEVICE_NAME may hold letters, digits, space, dot, underscore and hyphen, at most 40 characters"
fi
case "$mode" in
add) [ -n "$device_id" ] || die "ADD=1 needs DEVICE_ID=<the PC's Syncthing device ID>" ;;
remove) [ -n "$device_id" ] || die "REMOVE=1 needs DEVICE_ID=<the device to take off>" ;;
report) [ -z "$device_id" ] || die "DEVICE_ID needs ADD=1 or REMOVE=1" ;;
esac

command -v syncthing >/dev/null 2>&1 || die "Syncthing is not installed: run stage 7 first"
id "$FOUNDRY_USER" >/dev/null 2>&1 || die "the $FOUNDRY_USER user is missing: run stage 1 first"
if [ "$mode" != report ]; then
  require_recent_snapshot
  # A dropped SSH session must not stop a change halfway.
  trap '' HUP PIPE
fi

st() { runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" syncthing cli --home="$st_home" "$@" </dev/null; }
st show system >/dev/null 2>&1 || die "Syncthing does not answer on its GUI address; run stage 7, or see journalctl -u foundry-ai-tool-syncthing -n 50"
st config folders list | grep -x "$folder_id" >/dev/null || die "the folder $folder_id is missing: run stage 7 first"
my_id="$(st show system | sed -n 's/.*"myID": "\([A-Z0-9-]*\)".*/\1/p')"
[ -n "$my_id" ] || die "could not read the Pi's device ID"
[ -z "$device_id" ] || [ "$device_id" != "$my_id" ] || die "DEVICE_ID is this Pi's own ID: give the PC's device ID (Syncthing, Actions, Show ID)"

# peers: the devices the vault is shared with, without the Pi itself.
peers() { st config folders "$folder_id" devices list | grep -vx "$my_id" || true; }
# completion DEVICE: how much of the vault that device holds, in percent, or "?" when Syncthing does not say. The REST
# call goes to the GUI address on this Pi (loopback) with the folder's own API key, which is never printed.
api_key="$(st config gui apikey get 2>/dev/null || true)"
completion() {
  local body pct
  [ -n "$api_key" ] || { printf '?'; return 0; }
  body="$(curl -fs --max-time 5 -H "X-API-Key: $api_key" "http://$st_gui/rest/db/completion?folder=$folder_id&device=$1" 2>/dev/null || true)"
  pct="$(printf '%s' "$body" | tr -d ' \n' | sed -n 's/.*"completion":\([0-9]*\).*/\1/p')"
  printf '%s' "${pct:-?}"
}
connected() {
  st show connections 2>/dev/null | tr -d ' \n' | grep -c "\"$1\":{[^}]*\"connected\":true" || true
}
dev_name() { st config devices "$1" name get 2>/dev/null || echo "$1"; }
report() {
  local d
  say "the GM vault is shared with"
  if [ -z "$(peers)" ]; then
    echo "    no PC yet"
    return 0
  fi
  for d in $(peers); do
    c="not connected right now"
    [ "$(connected "$d")" -gt 0 ] && c="connected"
    echo "    $(dev_name "$d")  ${d%%-*}...  $c, holds $(completion "$d") % of the vault"
  done
}

case "$mode" in
report)
  report
  ;;

add)
  say "adding the device"
  for f in $(st config folders list); do
    [ "$f" != "$folder_id" ] || continue
    if st config folders "$f" devices list | grep -x "$device_id" >/dev/null; then
      die "that device is already on the folder $f: a player's device never gets the GM vault (D-067)"
    fi
  done
  if st config devices list | grep -x "$device_id" >/dev/null; then
    ok "device already known"
  else
    st config devices add --device-id "$device_id" --name "${device_name:-peer}"
    ok "added device ${device_name:-peer}"
  fi
  [ "$(st config devices "$device_id" auto-accept-folders get)" = "false" ] || st config devices "$device_id" auto-accept-folders set false
  [ "$(st config devices "$device_id" introducer get)" = "false" ] || st config devices "$device_id" introducer set false
  if st config folders "$folder_id" devices list | grep -x "$device_id" >/dev/null; then
    ok "$folder_id already shared with it"
  else
    st config folders "$folder_id" devices add --device-id "$device_id"
    ok "shared $folder_id with it"
  fi
  st config folders "$folder_id" devices list | grep -x "$device_id" >/dev/null || die "the device is not on the folder after the change"
  report
  say "stage 31 done: the PC is added. It sees a yellow bar for the Pi and for the folder; the vault starts to sync when it accepts both"
  ;;

remove)
  say "taking the device off"
  st config folders "$folder_id" devices list | grep -x "$device_id" >/dev/null || die "that device is not on the folder $folder_id (the report lists who is)"
  if [ "$force" != 1 ]; then
    safe=""
    for d in $(peers); do
      [ "$d" != "$device_id" ] || continue
      [ "$(completion "$d")" = 100 ] && safe="$safe $d"
    done
    [ -n "$safe" ] || die "no other device holds all of the vault yet (see the report); take this one off when another PC shows 100 %, or run again with FORCE=1"
    ok "another device holds all of the vault:$(for d in $safe; do printf ' %s' "$(dev_name "$d")"; done)"
  fi
  name="$(dev_name "$device_id")"
  st config folders "$folder_id" devices "$device_id" delete
  st config folders "$folder_id" devices list | grep -x "$device_id" >/dev/null && die "the device is still on the folder after the change"
  ok "$folder_id is no longer shared with $name"
  still=""
  for f in $(st config folders list); do
    if st config folders "$f" devices list | grep -x "$device_id" >/dev/null; then still="$f"; fi
  done
  if [ -z "$still" ]; then
    st config devices "$device_id" delete
    ok "$name is forgotten (it was on no other folder); its own copy of the vault stays on that PC"
  else
    ok "$name stays known: it is on the folder $still"
  fi
  report
  say "stage 31 done: $name is off the GM vault; the notes on the Pi are unchanged"
  ;;
esac
