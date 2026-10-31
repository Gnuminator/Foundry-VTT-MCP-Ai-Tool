#!/usr/bin/env bash
# Stage 20: the GM vault's sync check and the Pi's time zone (backlog i052-obsidian-o8, Obsidian O8). Stage 7 puts the vault
# in /var/lib/foundry-ai-tool/obsidian/gm and runs Syncthing; this stage looks at how that is doing and reports what the GM
# should know:
#   1. the vault folder: where Syncthing's folder foundry-gm-vault points, which disk that is on (the data volume: the Pi's
#      root disk, so it moves with the NVMe clone, docs/dev/PI-SETUP.md "Moving to NVMe") and its free space;
#   2. Syncthing: the service, and which devices are connected right now;
#   3. conflicts: every `.sync-conflict-*` file in the vault. Syncthing makes one when the same note was changed on two PCs
#      before they met; both versions are kept, nothing is lost, and the GM merges them in Obsidian and deletes the extra file;
#   4. the time zone: the Pi's must be TIMEZONE (default Europe/Copenhagen) because the session log, the change log and the
#      play stats stamp their notes with the Pi's local time.
# Without SET_TIMEZONE=1 this stage only reads: it changes nothing and needs no snapshot. It never moves, deletes or merges a
# vault file, and never restarts a service.
#
# Modes (environment, before bash):
#   (none)           the report above; exit 0 even with conflicts or a wrong zone (they are warnings), exit 1 when Syncthing or
#                    its folder is missing
#   STRICT=1         exit 1 when there is any conflict file or the zone is wrong (a check that must be clean)
#   SET_TIMEZONE=1   also set the time zone to TIMEZONE with `timedatectl set-timezone` when it differs. A system setting, so it
#                    needs a dietpi-backup snapshot from today and the user's OK. The bridge and the dashboard read the zone
#                    when they start: after a change, restart them (or the Pi) before the next session so their notes agree.
#   TIMEZONE=<zone>  another zone name (a file under /usr/share/zoneinfo)
# Run from the PC (bash, not PowerShell):
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/20-vault-sync.sh | ssh foundry-pi 'bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/20-vault-sync.sh | ssh foundry-pi 'SET_TIMEZONE=1 bash -s'
# The report is read-only, so it may run any time, game night included.

require_root
PATH="$PATH:/usr/sbin:/sbin"

folder_id="foundry-gm-vault"
st_home="$TOOL_DATA/syncthing"
want_tz="${TIMEZONE:-Europe/Copenhagen}"
set_tz="${SET_TIMEZONE:-0}"
strict="${STRICT:-0}"
problems=0

# The zone name ends up in a path and in a command: letters, digits and / _ + - only, and no way upward.
case "$want_tz" in
*[!A-Za-z0-9/_+-]* | "" | /* | *..*) die "TIMEZONE is not a zone name such as Europe/Copenhagen" ;;
esac
[ -f "/usr/share/zoneinfo/$want_tz" ] || die "TIMEZONE '$want_tz' is not a zone on this Pi (no /usr/share/zoneinfo/$want_tz)"

if [ "$set_tz" = 1 ]; then
  require_recent_snapshot
fi

command -v syncthing >/dev/null 2>&1 || die "Syncthing is not installed: run stage 7 first"
id "$FOUNDRY_USER" >/dev/null 2>&1 || die "the $FOUNDRY_USER user is missing: run stage 1 first"
st() { runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" syncthing cli --home="$st_home" "$@"; }

say "Syncthing"
if have_systemd; then
  state="$(systemctl is-active foundry-ai-tool-syncthing.service 2>/dev/null || true)"
  [ "$state" = active ] || die "foundry-ai-tool-syncthing is ${state:-unknown}: see journalctl -u foundry-ai-tool-syncthing -n 50"
  ok "foundry-ai-tool-syncthing is active"
fi
st show system >/dev/null 2>&1 || die "Syncthing does not answer on its GUI address; see $st_home"
st config folders list | grep -x "$folder_id" >/dev/null || die "the folder $folder_id is missing: run stage 7 first"
my_id="$(st show system | sed -n 's/.*"myID": "\([A-Z0-9-]*\)".*/\1/p')"
ok "this Pi's device ID: ${my_id:-unknown}"

say "the vault folder"
vault="$(st config folders "$folder_id" path get)"
[ -d "$vault" ] || die "the folder $folder_id points at $vault, which is not a directory"
# df -P: one line per filesystem, POSIX columns; field 1 is the device, 5 the use percentage, 6 the mount point.
read -r dev _ _ _ pct mnt < <(df -P "$vault" | tail -n 1)
ok "$vault is on $dev (mounted at $mnt, ${pct} used)"
if [ "$(df -P "$vault" | tail -n 1 | awk '{print $6}')" != "$(df -P "$TOOL_DATA" | tail -n 1 | awk '{print $6}')" ]; then
  warn "the vault is not on the same disk as $TOOL_DATA: the nightly backup and the space check expect it there"
fi
case "$vault" in
"$TOOL_DATA"/*) ok "inside the tool's data folder ($TOOL_DATA)" ;;
*) warn "the vault is outside $TOOL_DATA; the nightly restic backup may not include it" ;;
esac
echo "    notes: $(find "$vault" -type f -name '*.md' -not -path '*/.stversions/*' 2>/dev/null | wc -l) markdown files"

say "devices"
shared="$(st config folders "$folder_id" devices list | grep -vx "${my_id:-none}" || true)"
if [ -z "$shared" ]; then
  warn "the vault is not shared with any PC yet: on a PC run scripts/pi/setup-syncthing-pc.ps1, then stage 7 with PEER_ID"
  problems=$((problems + 1))
else
  connections="$(st show connections 2>/dev/null || true)"
  for dev_id in $shared; do
    name="$(st config devices "$dev_id" name get 2>/dev/null || echo "$dev_id")"
    if printf '%s' "$connections" | tr -d ' \n' | grep -q "\"$dev_id\":{[^}]*\"connected\":true"; then
      ok "$name is connected"
    else
      echo "    $name is not connected right now (its PC may be off; it syncs when it comes back)"
    fi
  done
fi

say "conflicts"
# -prune keeps Syncthing's own folders (.stfolder, .stversions) and the trash out of the list. Names can hold spaces: read lines.
conflicts="$(find "$vault" \( -name .stfolder -o -name .stversions -o -name .trash \) -prune -o -type f -name '*.sync-conflict-*' -print 2>/dev/null | sort || true)"
if [ -z "$conflicts" ]; then
  ok "no .sync-conflict-* files"
else
  n="$(printf '%s\n' "$conflicts" | wc -l)"
  warn "$n conflict file(s): the same note changed on two PCs. Open both versions in Obsidian, keep what you want in the note, delete the .sync-conflict file"
  printf '%s\n' "$conflicts" | head -n 20 | while IFS= read -r f; do
    echo "      ${f#"$vault"/}  ($(date -r "$f" '+%Y-%m-%d %H:%M'))"
  done
  [ "$n" -le 20 ] || echo "      ... and $((n - 20)) more"
  problems=$((problems + 1))
fi

say "time zone"
# The Pi has no /etc/timezone (checked 2026-10-29); timedatectl and the /etc/localtime link are the sources, the file the last.
have_tz="$(timedatectl show -p Timezone --value 2>/dev/null || true)"
[ -n "$have_tz" ] || have_tz="$(readlink /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||')"
[ -n "$have_tz" ] || have_tz="$(cat /etc/timezone 2>/dev/null || echo unknown)"
echo "    now $(date '+%Y-%m-%d %H:%M %Z'), zone $have_tz, wanted $want_tz"
if [ "$have_tz" = "$want_tz" ]; then
  ok "the Pi is on $want_tz"
elif [ "$set_tz" = 1 ]; then
  have_systemd || die "no systemd here: cannot set the zone"
  timedatectl set-timezone "$want_tz" || die "timedatectl set-timezone $want_tz failed"
  ok "time zone: $have_tz -> $want_tz (the bridge and the dashboard keep the old zone until they restart)"
else
  warn "the Pi is on $have_tz, not $want_tz: the notes get the wrong local time. Run this stage with SET_TIMEZONE=1 after a snapshot"
  problems=$((problems + 1))
fi

if [ "$strict" = 1 ] && [ "$problems" -gt 0 ]; then
  die "stage 20: $problems thing(s) to look at (see the warnings above)"
fi
say "stage 20 done: vault $vault, ${problems} thing(s) to look at"
