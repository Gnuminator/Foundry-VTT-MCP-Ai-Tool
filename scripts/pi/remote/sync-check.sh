#!/usr/bin/env bash
# Sync check: when did Syncthing last move a file for each vault folder, and when was each PC last seen
# (backlog obsidian-staleness, decision 41). The GM vault (stage 7, 20) and the player vaults (stage 21) are kept
# current on the Pi by the bridge and the dashboard, but a PC that was off, or a Syncthing that stopped, leaves its copy
# old and nothing says so: nobody opens _status.md. This reports it in plain lines.
#
# Read only, always: it changes nothing, needs no snapshot, may run any time (game night included). It reads Syncthing's
# REST API on this Pi (loopback) with the GUI's API key, which is passed on stdin and never printed.
#   per folder:  the time of the last file that synced (stats/folder lastFile.at), the last scan, and each device it is
#                shared with: connected now, or last seen at ..., and how much of the folder it holds (db/completion)
#   a WARNING when a PC is not connected and was last seen more than STALE_HOURS ago (default 48), has never been seen,
#   or holds less than 100 percent while connected; the report is in the Pi's local time
# Modes (environment, before bash):
#   (none)           report; exit 0 even with warnings, exit 1 when Syncthing is missing or does not answer
#   STRICT=1         exit 1 when there is any warning (a check that must be clean)
#   STALE_HOURS=<n>  how old a not-connected PC's last-seen may be before it is a warning (default 48)
# Run from the PC (bash, not PowerShell):
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/sync-check.sh | ssh foundry-pi 'bash -s'

require_root
PATH="$PATH:/usr/sbin:/sbin"

st_home="$TOOL_DATA/syncthing"
st_gui="127.0.0.1:8384"
strict="${STRICT:-0}"
stale_hours="${STALE_HOURS:-48}"
problems=0

case "$stale_hours" in
"" | *[!0-9]*) die "STALE_HOURS must be a whole number of hours" ;;
esac

command -v syncthing >/dev/null 2>&1 || die "Syncthing is not installed: run stage 7 first"
command -v curl >/dev/null 2>&1 || die "curl is missing"
id "$FOUNDRY_USER" >/dev/null 2>&1 || die "the $FOUNDRY_USER user is missing: run stage 1 first"
st() { runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" syncthing cli --home="$st_home" "$@" </dev/null; }
st show system >/dev/null 2>&1 || die "Syncthing does not answer on its GUI address; run stage 7, or see journalctl -u foundry-ai-tool-syncthing -n 50"

api_key="$(st config gui apikey get 2>/dev/null || true)"
[ -n "$api_key" ] || die "could not read Syncthing's API key"
# rest PATH: a GET on the REST API; prints the body, or nothing when the call fails. The key goes on stdin, not in argv.
rest() {
  printf 'X-API-Key: %s\n' "$api_key" | curl -fs --max-time 5 -H @- "http://$st_gui/rest/$1" 2>/dev/null || true
}
flat() { tr -d ' \n'; }

stats_dev="$(rest stats/device | flat)"
stats_folder="$(rest stats/folder | flat)"
[ -n "$stats_dev" ] && [ -n "$stats_folder" ] || die "Syncthing's statistics did not answer"
connections="$(rest system/connections | flat)"
my_id="$(st show system | sed -n 's/.*"myID": "\([A-Z0-9-]*\)".*/\1/p')"
now="$(date +%s)"

# ago ISO: "3 h 20 min ago" for an ISO time (Syncthing writes a local offset, which GNU date reads), or "never".
# Syncthing's "never" is the 1970 epoch.
ago() {
  local secs
  secs="$(date -d "$1" +%s 2>/dev/null || echo 0)"
  if [ "$secs" -le 86400 ]; then
    printf 'never'
    return
  fi
  local d=$((now - secs))
  [ "$d" -ge 0 ] || d=0
  if [ "$d" -lt 120 ]; then
    printf '%s s ago' "$d"
  elif [ "$d" -lt 7200 ]; then
    printf '%s min ago' $((d / 60))
  elif [ "$d" -lt 172800 ]; then
    printf '%s h %s min ago' $((d / 3600)) $((d % 3600 / 60))
  else
    printf '%s days ago' $((d / 86400))
  fi
}
# epoch ISO: seconds since 1970 for an ISO time, 0 for never.
epoch() { date -d "$1" +%s 2>/dev/null || echo 0; }
# json_field BODY ID KEY: the string value KEY inside the object ID of a flattened statistics body.
json_field() {
  printf '%s' "$1" | sed -n "s/.*\"$2\":{[^}]*\"$3\":\"\\([^\"]*\\)\".*/\\1/p"
}

shared_any=0
for folder_id in $(st config folders list); do
  case "$folder_id" in
  foundry-gm-vault | foundry-player-*) ;;
  *) continue ;;
  esac
  say "$folder_id"
  # lastFile is an object inside the folder's object; its "at" is the first "at" after the folder id.
  last_at="$(printf '%s' "$stats_folder" | sed -n "s/.*\"$folder_id\":{\"lastFile\":{\"at\":\"\\([^\"]*\\)\".*/\\1/p")"
  scan_at="$(printf '%s' "$stats_folder" | sed -n "s/.*\"$folder_id\":{[^}]*}[^}]*\"lastScan\":\"\\([^\"]*\\)\".*/\\1/p")"
  if [ -n "$last_at" ]; then
    echo "    last file synced: $(ago "$last_at") ($last_at)"
  else
    echo "    last file synced: none recorded"
  fi
  [ -z "$scan_at" ] || echo "    last scan on this Pi: $(ago "$scan_at")"
  peers="$(st config folders "$folder_id" devices list | grep -vx "${my_id:-none}" || true)"
  if [ -z "$peers" ]; then
    echo "    not shared with any PC"
    continue
  fi
  shared_any=1
  for dev_id in $peers; do
    name="$(st config devices "$dev_id" name get 2>/dev/null || echo "$dev_id")"
    seen="$(json_field "$stats_dev" "$dev_id" lastSeen)"
    pct="$(rest "db/completion?folder=$folder_id&device=$dev_id" | flat | sed -n 's/.*"completion":\([0-9.]*\).*/\1/p')"
    pct="${pct:-?}"
    if printf '%s' "$connections" | grep -q "\"$dev_id\":{[^}]*\"connected\":true"; then
      state="connected now"
      case "$pct" in
      100 | 100.*) ;;
      *)
        warn "$name is connected but holds $pct percent of $folder_id: it is still catching up, or stuck"
        problems=$((problems + 1))
        ;;
      esac
    else
      state="not connected, last seen $(ago "${seen:-1970-01-01T00:00:00Z}")"
      se="$(epoch "${seen:-1970-01-01T00:00:00Z}")"
      if [ "$se" -le 86400 ]; then
        warn "$name has never connected to this Pi: its copy of $folder_id was never filled"
        problems=$((problems + 1))
      elif [ $((now - se)) -gt $((stale_hours * 3600)) ]; then
        warn "$name was last seen $(ago "$seen"), more than $stale_hours hours ago: its copy of $folder_id is out of date until its PC is on and Syncthing runs"
        problems=$((problems + 1))
      fi
    fi
    echo "    $name: $state, holds ${pct} percent"
  done
done
[ "$shared_any" = 1 ] || echo "    no vault folder is shared with any PC yet"

if [ "$strict" = 1 ] && [ "$problems" -gt 0 ]; then
  die "sync check: $problems thing(s) to look at (see the warnings above)"
fi
say "sync check done: ${problems} thing(s) to look at"
