#!/usr/bin/env bash
# Stage 21: the player vault reaches the players who ask for it (backlog player-vault-sync, D-134). The co-GM dashboard
# writes one Obsidian vault per player (O7) into /var/lib/foundry-ai-tool/obsidian/players/<Player name>/ once
# FOUNDRY_AI_PLAYER_VAULTS_DIR is set. This stage sets it, and shares each player's folder with that player's own devices
# through the Syncthing that stage 7 runs:
#   - one Syncthing folder per player (id foundry-player-<slug>), type SEND ONLY on the Pi: whatever a player's device
#     changes or deletes is ignored here, so nothing a player does reaches the Pi (D-067);
#   - shared only with the devices of that player (never the GM vault, never another player's folder, no introducer, no
#     auto-accept), so a player's Syncthing cannot learn of another player;
#   - opt-in: nothing is shared with a device until its ID is given here. A player who never asks installs nothing.
# It never writes a note (the dashboard owns the vault files), never deletes a vault file, and only shares a folder that
# carries the dashboard's marker file .aitool-player.json.
#
# Modes (environment, before bash):
#   (none)           report, read-only, any time: the dashboard switch, the player folders, what is shared with whom and
#                    which devices are connected; exit 0 with warnings, exit 1 when Syncthing or the foundry user is missing
#   STRICT=1         with the report: exit 1 when a player folder is not Send Only, a device is on two players' folders or on
#                    the GM vault, or a shared folder is missing
#   SETUP=1          switch the dashboard's player vaults on (a systemd drop-in with FOUNDRY_AI_PLAYER_VAULTS_DIR) and make the
#                    players folder; restarts the dashboard only when the drop-in is new or changed. Snapshot first.
#   PLAYER="<name>" DEVICE_ID=<id> [DEVICE_NAME=<name>]
#                    add: SETUP as above, then share that player's folder with that device (a second device of the same
#                    player is another run). <name> is the folder's name below the players folder, as the report lists it.
#   REMOVE=1 PLAYER="<name>" [DEVICE_ID=<id>]
#                    stop sharing with that device, or without DEVICE_ID drop the player's Syncthing folder (a setting only:
#                    the files stay); a device left on no folder is forgotten
#   OFF=1            every player folder out of Syncthing and the dashboard drop-in removed (the dashboard restarts); the
#                    vault files stay on the Pi
# Every mode that changes something needs a dietpi-backup snapshot from today and the user's OK; the dashboard restart goes
# through require_quiet (no players online, no recording).
# Run from the PC (bash, not PowerShell):
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/21-player-vault.sh | ssh foundry-pi 'bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/21-player-vault.sh | ssh foundry-pi 'PLAYER="Mira" DEVICE_ID=ABCDEFG-... DEVICE_NAME=mira-pc bash -s'

require_root
PATH="$PATH:/usr/sbin:/sbin"

players_dir="$TOOL_DATA/obsidian/players"
st_home="$TOOL_DATA/syncthing"
dashboard_unit="foundry-ai-tool-dashboard.service"
dropin_dir="/etc/systemd/system/$dashboard_unit.d"
dropin="$dropin_dir/player-vault.conf"
gm_folder="foundry-gm-vault"
folder_prefix="foundry-player-"
player="${PLAYER:-}"
device_id="${DEVICE_ID:-}"
device_name="${DEVICE_NAME:-}"
strict="${STRICT:-0}"
problems=0

mode=report
if [ "${OFF:-0}" = 1 ]; then
  mode=off
elif [ "${REMOVE:-0}" = 1 ]; then
  mode=remove
elif [ -n "$player" ] || [ -n "$device_id" ]; then
  mode=add
elif [ "${SETUP:-0}" = 1 ]; then
  mode=setup
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
if [ -n "$player" ]; then
  # One path segment below the players folder, no hidden name, no quoting trouble in a Syncthing label.
  case "$player" in
  */* | *\\* | .* | *\"* | *\$* | *\`* | *$'\n'*) die "PLAYER must be a folder name from the players folder (no slash, no leading dot, no quotes)" ;;
  esac
  [[ "$player" != *[[:cntrl:]]* ]] || die "PLAYER must not hold control characters"
fi
case "$mode" in
add) [ -n "$player" ] && [ -n "$device_id" ] || die "adding needs both PLAYER=\"<name>\" and DEVICE_ID=<id>" ;;
remove) [ -n "$player" ] || die "REMOVE=1 needs PLAYER=\"<name>\"" ;;
esac

command -v syncthing >/dev/null 2>&1 || die "Syncthing is not installed: run stage 7 first"
id "$FOUNDRY_USER" >/dev/null 2>&1 || die "the $FOUNDRY_USER user is missing: run stage 1 first"
if [ "$mode" != report ]; then
  require_recent_snapshot
fi

st() { runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" syncthing cli --home="$st_home" "$@" </dev/null; }
st show system >/dev/null 2>&1 || die "Syncthing does not answer on its GUI address; run stage 7, or see journalctl -u foundry-ai-tool-syncthing -n 50"
st config folders list | grep -x "$gm_folder" >/dev/null || die "the folder $gm_folder is missing: run stage 7 first"
my_id="$(st show system | sed -n 's/.*"myID": "\([A-Z0-9-]*\)".*/\1/p')"
[ -n "$my_id" ] || die "could not read the Pi's device ID"

# slug_for NAME: letters and digits of the name plus 8 hex of its hash, so two players never share an id and the id stays plain ASCII.
slug_for() {
  local ascii hash
  ascii="$(printf '%s' "$1" | LC_ALL=C tr -c 'A-Za-z0-9' '-' | tr 'A-Z' 'a-z' | tr -s '-' | sed 's/^-//; s/-$//' | cut -c1-30)"
  hash="$(printf '%s' "$1" | sha256sum | cut -c1-8)"
  printf '%s-%s' "${ascii:-player}" "$hash"
}
# player_folders: the Syncthing folder ids that belong to this stage, one per line.
player_folders() { st config folders list | grep "^$folder_prefix" || true; }
# folder_devices FOLDER: the devices a folder is shared with, without the Pi itself.
folder_devices() { st config folders "$1" devices list | grep -vx "$my_id" || true; }
# device_on_other_folder DEVICE FOLDER: prints the id of another folder (GM vault included) that DEVICE is on, if any.
device_on_other_folder() {
  local dev="$1" except="$2" f
  for f in $(st config folders list); do
    [ "$f" = "$except" ] && continue
    if st config folders "$f" devices list | grep -x "$dev" >/dev/null; then
      printf '%s' "$f"
      return 0
    fi
  done
  return 1
}
# check_player_folder NAME: the player's folder on disk is the dashboard's own (marker), a real directory, not a link.
check_player_folder() {
  local dir="$players_dir/$1"
  [ -d "$players_dir" ] || die "$players_dir does not exist yet: run this stage with SETUP=1, and wait a minute for the dashboard to write the folders"
  [ ! -L "$dir" ] || die "$dir is a link: refused"
  [ -d "$dir" ] || die "there is no player folder '$1' in $players_dir (the report lists the names; the dashboard writes a folder about a minute after it starts)"
  [ -f "$dir/.aitool-player.json" ] && [ ! -L "$dir/.aitool-player.json" ] && grep -q 'foundry-ai-tool' "$dir/.aitool-player.json" ||
    die "$dir has no dashboard marker (.aitool-player.json): it is not a player vault the dashboard wrote, so it is not shared"
}

# ---- The dashboard switch -------------------------------------------------------------------------------------------
ensure_dashboard_switch() {
  say "the dashboard's player vaults"
  install -d -m 0750 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$TOOL_DATA/obsidian" "$players_dir"
  ok "$players_dir"
  if have_systemd; then
    install -d -m 0755 "$dropin_dir"
  else
    warn "no systemd here (a test container?): the drop-in is written, nothing is restarted"
    mkdir -p "$dropin_dir"
  fi
  write_file "$dropin" 0644 "# Written by scripts/pi/remote/21-player-vault.sh; edit it there (the file is rewritten whole).
[Service]
Environment=FOUNDRY_AI_PLAYER_VAULTS_DIR=$players_dir" || true
  if [ -f "/etc/systemd/system/$dashboard_unit" ]; then
    enable_unit "$dashboard_unit" "$dropin"
  else
    warn "the dashboard unit is missing (stage 5 has not run): the drop-in waits for it"
  fi
}

# ---- Modes ----------------------------------------------------------------------------------------------------------
share_player() {
  local slug fid dir
  check_player_folder "$player"
  slug="$(slug_for "$player")"
  fid="$folder_prefix$slug"
  dir="$players_dir/$player"
  [ "$device_id" != "$my_id" ] || die "DEVICE_ID is this Pi's own ID: give the player's device ID (Syncthing, Actions, Show ID)"
  [ -n "$device_name" ] || device_name="player-$slug"
  # Before anything is added: one device belongs to one player, and never to the GM vault.
  local other
  if other="$(device_on_other_folder "$device_id" "$fid")"; then
    die "device $device_id is already on the folder $other: one device belongs to one player, and never to the GM vault. Nothing was shared"
  fi

  say "the folder for $player"
  # Syncthing's per-device ignore file: our writer's temp files are never offered, nor the marker (it names the Foundry user).
  write_file "$dir/.stignore" 0640 "// Written by scripts/pi/remote/21-player-vault.sh (Syncthing does not sync this file).
.aitool-player.json
.*.aitool-tmp-*" || true
  chown "$FOUNDRY_USER:$FOUNDRY_USER" "$dir/.stignore"
  if st config folders list | grep -x "$fid" >/dev/null; then
    ok "folder $fid already there"
    [ "$(st config folders "$fid" path get)" = "$dir" ] ||
      die "folder $fid points at $(st config folders "$fid" path get), not $dir: fix it by hand before adding a device"
    if [ "$(st config folders "$fid" type get)" != sendonly ]; then
      st config folders "$fid" type set sendonly
      ok "folder $fid is Send Only now"
    fi
  else
    st config folders add --id "$fid" --label "Foundry vault $player" --path "$dir" --type sendonly
    ok "added folder $fid (Send Only) at $dir"
  fi
  # Windows and Android clients do not keep Unix modes; the Pi's modes mean nothing to them.
  st config folders "$fid" ignore-perms set true

  say "sharing with $device_name"
  if st config devices list | grep -x "$device_id" >/dev/null; then
    ok "device already known"
  else
    # No --addresses flag: the new device gets `dynamic` (discovery); the player's Syncthing dials the Pi too.
    st config devices add --device-id "$device_id" --name "$device_name"
    ok "added device $device_name"
  fi
  st config devices "$device_id" auto-accept-folders set false
  st config devices "$device_id" introducer set false
  if st config folders "$fid" devices list | grep -x "$device_id" >/dev/null; then
    ok "$fid already shared with $device_name"
  else
    st config folders "$fid" devices add --device-id "$device_id"
    ok "shared $fid with $device_name"
  fi
  echo "    this Pi's device ID: $my_id"
  echo "    folder: $fid ($dir), Send Only"
  say "stage 21 done: tell $player to add the Pi in Syncthing (Add Remote Device, compare the ID above), accept the folder, set it to Receive Only, and open it in Obsidian (docs/player/obsidian.md)"
}

remove_player() {
  local slug fid d
  slug="$(slug_for "$player")"
  fid="$folder_prefix$slug"
  st config folders list | grep -x "$fid" >/dev/null || die "there is no Syncthing folder $fid: nothing to remove"
  if [ -n "$device_id" ]; then
    say "unsharing $fid from $device_id"
    st config folders "$fid" devices list | grep -x "$device_id" >/dev/null || die "$device_id is not on $fid"
    st config folders "$fid" devices delete --device-id "$device_id"
    ok "$fid no longer shared with $device_id"
    forget_if_unused "$device_id"
  else
    say "removing the Syncthing folder $fid"
    local devices
    devices="$(folder_devices "$fid")"
    st config folders "$fid" delete
    ok "folder $fid is out of Syncthing (the files in $players_dir/$player stay)"
    for d in $devices; do forget_if_unused "$d"; done
  fi
  say "stage 21 done: $player is no longer served"
}
# forget_if_unused DEVICE: a device that is on no folder any more is removed from Syncthing.
forget_if_unused() {
  local dev="$1" f
  for f in $(st config folders list); do
    if st config folders "$f" devices list | grep -x "$dev" >/dev/null; then
      ok "device $dev stays: it is still on $f"
      return 0
    fi
  done
  st config devices "$dev" delete
  ok "device $dev forgotten (it was on no folder)"
}

switch_off() {
  local f
  say "player folders out of Syncthing"
  for f in $(player_folders); do
    st config folders "$f" delete
    ok "removed $f (files stay)"
  done
  for f in $(st config devices list | grep -vx "$my_id" || true); do forget_if_unused "$f"; done
  say "the dashboard switch"
  if [ -f "$dropin" ]; then
    rm -f -- "${dropin:?}"
    mark_changed "$dropin"
    ok "removed $dropin"
  else
    ok "no drop-in"
  fi
  if have_systemd && [ -f "/etc/systemd/system/$dashboard_unit" ]; then
    enable_unit "$dashboard_unit" "$dropin"
  fi
  say "stage 21 done: player vaults are off; the files in $players_dir stay"
}

report() {
  say "the dashboard switch"
  if [ -f "$dropin" ]; then
    ok "drop-in $dropin sets FOUNDRY_AI_PLAYER_VAULTS_DIR"
  else
    echo "    the dashboard does not write player vaults yet (run with SETUP=1)"
  fi
  if have_systemd && [ -f "/etc/systemd/system/$dashboard_unit" ]; then
    systemctl show -p Environment "$dashboard_unit" 2>/dev/null | grep -q 'FOUNDRY_AI_PLAYER_VAULTS_DIR' ||
      echo "    the running dashboard does not have the setting (not restarted since)"
  fi

  say "player folders on disk"
  local d name fid slug shared_with
  if [ -d "$players_dir" ]; then
    for d in "$players_dir"/*/; do
      [ -d "$d" ] || continue
      name="$(basename "$d")"
      slug="$(slug_for "$name")"
      fid="$folder_prefix$slug"
      shared_with=""
      if st config folders list | grep -x "$fid" >/dev/null; then shared_with=" (shared as $fid)"; fi
      if [ -f "${d}.aitool-player.json" ]; then
        echo "    $name: $(find "$d" -type f -name '*.md' | wc -l) notes$shared_with"
      else
        echo "    $name: no dashboard marker, never shared"
      fi
    done
  else
    echo "    $players_dir does not exist yet"
  fi

  say "what is shared"
  local f dev_name dev connections p
  connections="$(st show connections 2>/dev/null || true)"
  if [ -z "$(player_folders)" ]; then
    echo "    no player has asked yet (no foundry-player-* folder)"
  fi
  for f in $(player_folders); do
    p="$(st config folders "$f" path get)"
    case "$p" in
    "$players_dir"/*) ok "$f -> ${p#"$players_dir"/}" ;;
    *)
      warn "$f points outside the players folder ($p)"
      problems=$((problems + 1))
      ;;
    esac
    if [ "$(st config folders "$f" type get)" != sendonly ]; then
      warn "$f is not Send Only: a player's change could reach the Pi"
      problems=$((problems + 1))
    fi
    if [ ! -d "$p" ]; then
      warn "$f: the folder $p is missing"
      problems=$((problems + 1))
    fi
    for dev in $(folder_devices "$f"); do
      dev_name="$(st config devices "$dev" name get 2>/dev/null || echo "$dev")"
      if [ "$(printf '%s' "$connections" | tr -d ' \n' | grep -c "\"$dev\":{[^}]*\"connected\":true")" -gt 0 ]; then
        echo "      $dev_name is connected"
      else
        echo "      $dev_name is not connected right now (its device may be off)"
      fi
      if other="$(device_on_other_folder "$dev" "$f")"; then
        warn "$dev_name is also on $other: one device belongs to one player, never to the GM vault"
        problems=$((problems + 1))
      fi
    done
  done
}

case "$mode" in
report) report ;;
setup)
  ensure_dashboard_switch
  say "stage 21 done: player vaults are on; the dashboard writes a folder per player within a minute"
  ;;
add)
  ensure_dashboard_switch
  share_player
  ;;
remove) remove_player ;;
off) switch_off ;;
esac

if [ "$mode" = report ]; then
  if [ "$strict" = 1 ] && [ "$problems" -gt 0 ]; then
    die "stage 21: $problems thing(s) to look at (see the warnings above)"
  fi
  say "stage 21 report done: ${problems} thing(s) to look at"
fi
