#!/usr/bin/env bash
# Stage 28: the Assistant GM hang watchdog (Backlog item assistant-gm-hang-watchdog, G1). The new driver pings its own
# page every 15 s and restarts the browser when the page has not answered for 120 s, even while the module socket is up
# (a frozen page keeps its socket; the 2 minute no-socket check never sees it). The watchdog is on by default in the driver
# (GM_PAGE_WATCH=0 turns it off), so this stage only has to put the new driver in place and restart the Assistant GM.
#
# What it does: checks the driver you copied ($ASSISTANT_GM_DRIVER, default /root/assistant-gm.mjs) names the feature
# `page-ping` and passes `node --check`, copies the deployed driver to assistant-gm.mjs.prev-<time> (never deleted), installs
# the new one, restarts foundry-ai-tool-gm-browser.service and reads back that it joined the world again and, in the same run
# of the unit, logged "page watchdog armed". A failed read-back puts the old driver back and restarts it (a failed put-back
# stops with the file to copy by hand). UNDO=1 puts the newest .prev-* back the same way; when that file is the deployed
# driver already it changes and restarts nothing. It touches no world, no
# Foundry setting and no other service. The bridge link is down for the minute the browser takes to rejoin; players are not
# dropped (Foundry is not restarted), but run it when no one needs the co-GM dashboard. A snapshot first.
# Refused when the Assistant GM runs as a container (the compose stack bakes the driver into its image: rebuild that instead).
#
#   scp scripts/pi/remote/assistant-gm.mjs foundry-pi:/root/
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/28-gm-watchdog.sh | ssh foundry-pi 'bash -s'            a dry run
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/28-gm-watchdog.sh | ssh foundry-pi 'APPLY=1 bash -s'    the real run
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/28-gm-watchdog.sh | ssh foundry-pi 'UNDO=1 bash -s'     the old driver back
# Env (in front of bash): APPLY=1 (anything else but empty is refused), UNDO=1, ASSISTANT_GM_DRIVER. Take the snapshot
# (/boot/dietpi/dietpi-backup 1) and get the user's OK before APPLY=1 or UNDO=1.

require_root
refuse_when_cut_over "stage 28 (Assistant GM watchdog)"
require_arm64
APPLY="${APPLY:-}"
UNDO="${UNDO:-}"
GM_UNIT=foundry-ai-tool-gm-browser.service
driver="$TOOL_DIR/gm-browser/assistant-gm.mjs"
driver_src="${ASSISTANT_GM_DRIVER:-/root/assistant-gm.mjs}"
stamp="$(date +%Y%m%d-%H%M%S)"
export PATH="$NODE_DIR/bin:$PATH"

case "$APPLY" in "" | 1) ;; *) die "APPLY must be 1 or left out (got '$APPLY'). Nothing was changed" ;; esac
case "$UNDO" in "" | 1) ;; *) die "UNDO must be 1 or left out (got '$UNDO'). Nothing was changed" ;; esac
[ -z "$APPLY" ] || [ -z "$UNDO" ] || die "APPLY=1 and UNDO=1 together: pick one. Nothing was changed"
[ -x "$NODE_DIR/bin/node" ] || die "no Node at $NODE_DIR: run stage 2 first. Nothing was changed"
[ -f "$driver" ] || die "no Assistant GM driver at $driver: run stage 5 first. Nothing was changed"
systemctl cat "$GM_UNIT" >/dev/null 2>&1 || die "$GM_UNIT does not exist (the Assistant GM may run as a container: rebuild the gm-browser image instead). Nothing was changed"
systemctl is-enabled --quiet "$GM_UNIT" 2>/dev/null || die "$GM_UNIT is disabled (the stack may be cut over to containers: rebuild the gm-browser image instead). Nothing was changed"
refuse_during_system_trial "stage 28 (gm watchdog)"
install -d -m 700 /var/lib/foundry-import
exec 9>/var/lib/foundry-import/gm-watchdog.lock
flock -n 9 || die "another stage 28 run holds /var/lib/foundry-import/gm-watchdog.lock. Nothing was changed"
trap '' HUP PIPE

hash_of() { sha256sum "$1" | cut -d' ' -f1; }
was_active=0
case "$(systemctl is-active "$GM_UNIT" 2>/dev/null || true)" in active | activating) was_active=1 ;; esac

page_watch_armed() { # the current run of the unit logged "page watchdog armed" (the join alone does not prove the watch is on)
  local id
  id="$(systemctl show -p InvocationID --value "$GM_UNIT" 2>/dev/null || true)"
  [ -n "$id" ] || return 1
  [ "$(journalctl "_SYSTEMD_INVOCATION_ID=$id" --no-pager -o cat 2>/dev/null | grep -c '\[assistant-gm\] page watchdog armed' || true)" -gt 0 ]
}

has_page_ping() { grep -Eq '^// assistant-gm features:( [a-z0-9-]+)* page-ping( |$)' "$1"; }

# restarts the unit when it ran before, then waits up to 150 s for the join; 0 when it joined. $1 = armed: the join only
# counts when the same run also logged that the page watchdog is armed (the new driver; not for the old one put back).
restart_and_read_back() {
  [ "$was_active" = 1 ] || {
    ok "$GM_UNIT was not running: left stopped"
    return 0
  }
  systemctl restart "$GM_UNIT" || return 1
  local i
  for i in $(seq 1 30); do
    if browser_joined "$GM_UNIT" && { [ "${1:-}" != armed ] || page_watch_armed; }; then return 0; fi
    sleep 5
  done
  if [ "${1:-}" = armed ] && browser_joined "$GM_UNIT"; then
    warn "the Assistant GM joined but its journal has no 'page watchdog armed' line: is GM_PAGE_WATCH=0 set in the unit's environment?"
  fi
  return 1
}

put_back() { # $1 file to restore
  install -m 0644 "$1" "$driver.new" && mv -f "$driver.new" "$driver"
}

if [ -n "$UNDO" ]; then
  prev="$(find "$(dirname "$driver")" -maxdepth 1 -name 'assistant-gm.mjs.prev-*' -print | sort | tail -n 1)"
  [ -n "$prev" ] || die "no assistant-gm.mjs.prev-* to put back. Nothing was changed"
  if [ "$(hash_of "$prev")" = "$(hash_of "$driver")" ]; then
    ok "the newest $prev is the deployed driver already ($(hash_of "$driver")): nothing to put back, nothing restarted"
    exit 0
  fi
  ok "UNDO: putting $prev back"
  # A second UNDO picks the next-newest file only after the first one is deployed again: show what else is kept.
  find "$(dirname "$driver")" -maxdepth 1 -name 'assistant-gm.mjs.prev-*' ! -path "$prev" -print | sort | sed 's/^/     older, kept: /'
  require_recent_snapshot
  require_quiet_if_active "$GM_UNIT" "restarting the Assistant GM browser (the bridge link drops for about a minute)"
  cp -p -- "$driver" "$driver.undone-$stamp"
  put_back "$prev" || die "could not put $prev back over $driver: the deployed driver is as it was (kept as $driver.undone-$stamp)"
  restart_and_read_back || die "the old driver is back but the Assistant GM did not join: journalctl -u foundry-ai-tool-gm-browser -n 30"
  # Worded from the driver's own feature line: an older .prev-* may already have the page watchdog.
  if has_page_ping "$driver"; then
    ok "the old driver is back ($(hash_of "$driver")); it has the page watchdog too (an older build of it)"
  else
    ok "the old driver is back ($(hash_of "$driver")); it has no page watchdog"
  fi
  exit 0
fi

# ---- checks (the whole of a dry run) -------------------------------------------------------------------------
[ -f "$driver_src" ] || die "no new driver at $driver_src: scp scripts/pi/remote/assistant-gm.mjs foundry-pi:/root/ first. Nothing was changed"
[ ! -L "$driver_src" ] || die "$driver_src is a link. Nothing was changed"
grep -Eq '^// assistant-gm features:( [a-z0-9-]+)* page-ping( |$)' "$driver_src" || die "$driver_src does not name the page-ping feature: it is an older driver. Nothing was changed"
grep -Eq '^// assistant-gm features:( [a-z0-9-]+)* page-armed-log( |$)' "$driver_src" || die "$driver_src does not name the page-armed-log feature: its page watchdog logs no 'armed' line, so the read-back would fail. Nothing was changed"
node --check "$driver_src" 2>/dev/null || die "$driver_src does not parse (node --check). Nothing was changed"
if [ "$(hash_of "$driver_src")" = "$(hash_of "$driver")" ]; then
  ok "the deployed driver is already this one ($(hash_of "$driver")): nothing to do"
  exit 0
fi
if grep -Eq '^// assistant-gm features:( [a-z0-9-]+)* page-ping( |$)' "$driver"; then
  ok "the deployed driver already has the page watchdog; it differs from the new one"
else
  ok "the deployed driver has no page watchdog yet"
fi
ok "new driver $(hash_of "$driver_src"), deployed $(hash_of "$driver"); $GM_UNIT running: $was_active"
if [ -z "$APPLY" ]; then
  ok "dry run: nothing was changed (APPLY=1 installs it and restarts the Assistant GM browser)"
  exit 0
fi

# ---- the real run ----------------------------------------------------------------------------------------------
require_recent_snapshot
require_quiet_if_active "$GM_UNIT" "restarting the Assistant GM browser (the bridge link drops for about a minute)"
backup="$driver.prev-$stamp"
cp -p -- "$driver" "$backup"
ok "old driver kept as $backup"
put_back "$driver_src" || {
  put_back "$backup" || die "could not install the new driver, and the old one could not be put back: copy $backup over $driver by hand"
  die "could not install the new driver; the old one is back ($backup)"
}
[ "$(hash_of "$driver")" = "$(hash_of "$driver_src")" ] || {
  put_back "$backup" || die "the installed driver does not match the new one, and the old one could not be put back: copy $backup over $driver by hand"
  die "the installed driver does not match the new one; the old one is back"
}
if restart_and_read_back armed; then
  if [ "$was_active" = 1 ]; then
    ok "installed $driver ($(hash_of "$driver")); the Assistant GM joined the world again with the page watchdog on"
  else
    ok "installed $driver ($(hash_of "$driver")); the Assistant GM is stopped, so the watchdog starts with its next start (no read-back)"
  fi
else
  warn "the Assistant GM did not rejoin with the new driver: putting the old one back"
  put_back "$backup" || die "the new driver did not join and the old one could not be put back: copy $backup over $driver by hand, then restart $GM_UNIT"
  restart_and_read_back || warn "the old driver is back but the Assistant GM did not join either: journalctl -u foundry-ai-tool-gm-browser -n 30"
  die "the new driver did not join the world; the old one is back ($backup)"
fi
