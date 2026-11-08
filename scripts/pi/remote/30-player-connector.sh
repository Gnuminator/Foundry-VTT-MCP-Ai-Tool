#!/usr/bin/env bash
# Stage 30: the player connector's Pi side (D-136, backlog player-connector-pi). Players call POST https://<player host>/mcp/player
# with their own Cloudflare Access service token; the dashboard maps the token to one Foundry user and serves the read-only player
# tool set. The Cloudflare side (service tokens, Access application, tunnel route, DNS) is made by the PC script
# scripts/pi/player-connector-cloudflare.mjs, which also sends the login table to the Pi as /root/player-connector.json.new (the
# secrets go from Cloudflare straight into that file; no transcript, repo or vault sees them). This stage then:
#   1. checks the table (endpoint, audience, players with a Client ID, a secret and a 16-character Foundry user id, no duplicates;
#      only counts are printed) and installs it as $TOOL_ETC/player-connector.json (foundry:foundry, 0600), then removes the source;
#   2. writes $TOOL_ETC/player-connector.env (root:foundry 0640: FOUNDRY_AI_PLAYER_CONNECTOR=on and the path of the table) and a
#      systemd drop-in on the dashboard and on the bridge that reads it (the bridge reads the file's denyTerms list). The units
#      themselves (stage 5) are not edited. FOUNDRY_AI_PLAYER_CONNECTOR_DEV_USER must not be set anywhere: the stage refuses if it is;
#   3. adds the player host (taken from the table's endpoint) to DASHBOARD_ALLOWED_HOSTS in dashboard-access.env (a copy of the
#      file is kept next to it; set-dashboard-access.sh writes that file whole, so run this stage again after it);
#   4. restarts the bridge and the dashboard only if something they read changed (require_quiet: no players online, no recording);
#   5. checks: the dashboard answers 401 to /mcp/player with no token, 421 for an unlisted name, the units run as $FOUNDRY_USER
#      (the table is 0600 foundry), the ports 31414 to 31416 listen exactly as before the run and the bridge control port answers
#      on loopback. A failed check makes the run end with exit 1 (the install stays in place; CHECK=1 repeats the checks).
#      CHECK=1 has no "before" to compare the ports with: it prints them and fails on the control port check.
# It changes no port, no firewall, no tunnel setting and no GM connector. The tunnel route lives in Cloudflare (remotely managed).
#
# Modes (environment, before bash):
#   DRY_RUN=1  print what a real run would do; changes nothing, needs no snapshot
#   CHECK=1    read-only: the same checks on what is installed; exit 1 when one fails
#   UNDO=1     remove the drop-ins and the env file, take the host out of the allowed hosts, restart; the table is kept (secrets)
# A real run (and UNDO) needs a dietpi-backup snapshot from today and the user's OK. The PC script must have sent the table first.
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/30-player-connector.sh | ssh foundry-pi 'DRY_RUN=1 bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/30-player-connector.sh | ssh foundry-pi 'bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/30-player-connector.sh | ssh foundry-pi 'CHECK=1 bash -s'
# Tests only: SRC_FILE and UNIT_DIR (TOOL_ETC and NODE_DIR are set by lib.sh, so they are not overrides).

dry="${DRY_RUN:-0}"
check="${CHECK:-0}"
undo="${UNDO:-0}"
src="${SRC_FILE:-/root/player-connector.json.new}"
unit_dir="${UNIT_DIR:-/etc/systemd/system}"
cfg="$TOOL_ETC/player-connector.json"
envf="$TOOL_ETC/player-connector.env"
access="$TOOL_ETC/dashboard-access.env"
dash_unit=foundry-ai-tool-dashboard.service
bridge_unit=foundry-ai-tool-bridge.service
node="$NODE_DIR/bin/node"
dropin_name=player-connector.conf
fails=0
# A check of the real run that failed: counted, shown as a warning, and the run ends with exit 1 after the last check.
bad() { warn "$*"; fails=$((fails + 1)); }

require_root
modes=0
for m in "$dry" "$check" "$undo"; do [ "$m" = 1 ] && modes=$((modes + 1)); done
[ "$modes" -le 1 ] || die "use one of DRY_RUN=1, CHECK=1 and UNDO=1, not several"
if [ "$dry" != 1 ] && [ "$check" != 1 ]; then require_recent_snapshot; fi
[ -x "$node" ] || die "Node is missing: run stage 2 first"
[ -d "$TOOL_ETC" ] || die "$TOOL_ETC is missing: run stage 1 first"
for u in "$dash_unit" "$bridge_unit"; do
  [ -f "$unit_dir/$u" ] || die "$unit_dir/$u is missing: run stage 5 first"
  grep -q "^User=$FOUNDRY_USER\$" "$unit_dir/$u" || die "$u does not run as $FOUNDRY_USER: the table is readable by $FOUNDRY_USER only, so stop here. Nothing was changed"
done

# Prints "<endpoint host> <player count>" for a table, or exits 1 with the reason on stderr (never a value from the file).
table_summary() {
  "$node" -e '
    const fs = require("fs");
    let t;
    try { t = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { console.error("not valid JSON"); process.exit(1); }
    const bad = m => { console.error(m); process.exit(1); };
    let u;
    try { u = new URL(String(t.endpoint)); } catch { bad("endpoint is not a URL"); }
    if (u.protocol !== "https:") bad("endpoint must be https");
    if (u.pathname !== "/mcp/player") bad("endpoint path must be /mcp/player");
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(u.hostname)) bad("endpoint host is not a plain name");
    const aud = (Array.isArray(t.audience) ? t.audience : [t.audience]).map(a => String(a ?? "").trim()).filter(Boolean);
    if (aud.length === 0 || aud.some(a => !/^[A-Za-z0-9]{32,128}$/.test(a))) bad("audience must be the Access application AUD tag(s)");
    if (!Array.isArray(t.players) || t.players.length === 0) bad("no players");
    const ids = new Set(), users = new Set();
    for (const p of t.players) {
      const c = String(p?.clientId ?? "").trim(), s = String(p?.clientSecret ?? "").trim(), x = String(p?.userId ?? "").trim();
      if (!c || !s) bad("a player has no clientId or clientSecret");
      if (!/^[A-Za-z0-9]{16}$/.test(x)) bad("a player has no 16-character Foundry userId");
      if (ids.has(c)) bad("a clientId appears twice");
      if (users.has(x)) bad("a userId appears twice");
      ids.add(c); users.add(x);
    }
    process.stdout.write(u.hostname + " " + t.players.length);
  ' "$1"
}

# A key with a value in an env file, by name only.
has_key() { grep -qE "^[[:space:]]*$2=[^[:space:]]" "$1" 2>/dev/null; }

# The ports of the GM connectors, as the listening sockets show them (sorted, one line).
ports_line() { ss -ltnH 2>/dev/null | awk '{print $4}' | grep -E ':3141[456]$' | sort | tr '\n' ' ' || true; }

# The player host: from the installed table, else from the source.
player_host() {
  local f="$cfg"
  [ -f "$f" ] || f="$src"
  table_summary "$f" | cut -d' ' -f1
}

# No DEV_USER anywhere the services read (env files, units, drop-ins): it would let any loopback call act as a player.
refuse_dev_user() {
  local hits
  hits="$(grep -rlE 'FOUNDRY_AI_PLAYER_CONNECTOR_DEV_USER' "$TOOL_ETC" "$unit_dir"/foundry-ai-tool-*.service "$unit_dir"/foundry-ai-tool-*.service.d 2>/dev/null || true)"
  [ -z "$hits" ] || die "FOUNDRY_AI_PLAYER_CONNECTOR_DEV_USER is set in: $hits. It is for local development only; remove it. Nothing was changed"
}

host_in_list() { # $1 comma list, $2 host
  case ",$1," in *",$2,"*) return 0 ;; esac
  return 1
}

dropin_body="[Service]
EnvironmentFile=-$envf"
env_body="# Written by scripts/pi/remote/30-player-connector.sh (the player connector, D-136). Read by the bridge and the dashboard.
FOUNDRY_AI_PLAYER_CONNECTOR=on
FOUNDRY_AI_PLAYER_CONNECTOR_CONFIG=$cfg"

# ---- CHECK -------------------------------------------------------------------------------------------------
if [ "$check" = 1 ]; then
  say "check: the player connector on this Pi (read-only)"
  refuse_dev_user
  [ -f "$cfg" ] || die "$cfg is missing: run this stage first"
  summary="$(table_summary "$cfg")" || die "the installed table is not valid (see above)"
  host="${summary% *}"
  ok "table: host $host, ${summary#* } players (names, ids and secrets are not shown)"
  mode="$(stat -c '%a %U' "$cfg")"
  [ "$mode" = "600 $FOUNDRY_USER" ] && ok "$cfg is 0600 $FOUNDRY_USER" || die "$cfg is '$mode', expected '600 $FOUNDRY_USER'"
  [ "$(cat "$envf" 2>/dev/null)" = "$env_body" ] && ok "$envf as expected" || die "$envf is missing or differs"
  for u in "$dash_unit" "$bridge_unit"; do
    [ "$(cat "$unit_dir/$u.d/$dropin_name" 2>/dev/null)" = "$dropin_body" ] && ok "$u drop-in as expected" || die "$u has no player-connector drop-in"
  done
  hosts="$(sed -n 's/^DASHBOARD_ALLOWED_HOSTS=//p' "$access" 2>/dev/null | tail -n 1)"
  host_in_list "$hosts" "$host" && ok "$host is in DASHBOARD_ALLOWED_HOSTS" || die "$host is not in DASHBOARD_ALLOWED_HOSTS ($access)"
  if have_systemd; then
    for u in "$dash_unit" "$bridge_unit"; do systemctl is-active --quiet "$u" && ok "$u is running" || die "$u is not running"; done
    code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Host: $host" -H 'content-type: application/json' -d '{}' http://127.0.0.1:3000/mcp/player || true)"
    [ "$code" = 401 ] && ok "/mcp/player with no token: 401" || die "/mcp/player with no token gave '$code', expected 401"
    code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: not-listed.example' http://127.0.0.1:3000/ || true)"
    [ "$code" = 421 ] && ok "an unlisted name: 421" || die "an unlisted name gave '$code', expected 421"
    ok "ports 31414 to 31416 listening: $(ports_line)"
    cp_rc=0
    control_port_check 31414 || cp_rc=$?
    [ "$cp_rc" = 0 ] && ok "the bridge control port answers on loopback" || die "the bridge control port 31414 check returned $cp_rc (1 = no answer, 2 = a listener beyond loopback and the tailnet)"
  else
    warn "no systemd here (a test container?): the service checks are skipped"
  fi
  say "stage 30 check: ok"
  exit 0
fi

# ---- UNDO --------------------------------------------------------------------------------------------------
if [ "$undo" = 1 ]; then
  say "undo: the player connector off"
  host=""
  [ ! -f "$cfg" ] || host="$(player_host 2>/dev/null || true)"
  hosts=""
  [ ! -f "$access" ] || hosts="$(sed -n 's/^DASHBOARD_ALLOWED_HOSTS=//p' "$access" | tail -n 1)"
  # Only what is really there is undone, and only a service whose own input changes is restarted (a restart drops the GM link).
  restart_dash=0
  restart_bridge=0
  if [ -f "$envf" ]; then restart_dash=1 restart_bridge=1; fi
  [ ! -f "$unit_dir/$dash_unit.d/$dropin_name" ] || restart_dash=1
  [ ! -f "$unit_dir/$bridge_unit.d/$dropin_name" ] || restart_bridge=1
  undo_host=0
  if [ -n "$host" ] && host_in_list "$hosts" "$host"; then undo_host=1 restart_dash=1; fi
  if [ "$restart_dash" = 1 ]; then require_quiet_if_active "$dash_unit" "undoing the player connector (restarting the dashboard)"; fi
  if [ "$restart_bridge" = 1 ]; then require_quiet_if_active "$bridge_unit" "undoing the player connector (restarting the bridge)"; fi
  for u in "$dash_unit" "$bridge_unit"; do
    rm -f "${unit_dir:?}/$u.d/$dropin_name"
    rmdir "${unit_dir:?}/$u.d" 2>/dev/null || true
  done
  [ "$restart_dash" = 0 ] || mark_changed "$unit_dir/$dash_unit"
  [ "$restart_bridge" = 0 ] || mark_changed "$unit_dir/$bridge_unit"
  rm -f "${envf:?}"
  if [ "$undo_host" = 1 ]; then
    # Plain string work (no sed pattern), so the dots of the host are not wildcards.
    new=",$hosts,"
    while [ "${new#*",$host,"}" != "$new" ]; do new="${new%%",$host,"*},${new#*",$host,"}"; done
    new="${new#,}"
    new="${new%,}"
    tmp="$(mktemp "$TOOL_ETC/.dashboard-access.env.XXXXXX")"
    trap 'rm -f "${tmp:?}"' EXIT
    awk -v v="$new" '/^DASHBOARD_ALLOWED_HOSTS=/ { print "DASHBOARD_ALLOWED_HOSTS=" v; next } { print }' "$access" >"$tmp"
    chown --reference="$access" "$tmp"
    chmod --reference="$access" "$tmp"
    mv "$tmp" "$access"
    trap - EXIT
    mark_changed "$access"
    ok "$host taken out of DASHBOARD_ALLOWED_HOSTS"
  fi
  warn "$cfg is kept (it holds the players' secrets); delete it by hand when the connector is retired"
  enable_unit "$bridge_unit"
  enable_unit "$dash_unit" "$access"
  say "stage 30 undo done"
  exit 0
fi

# ---- the table ---------------------------------------------------------------------------------------------
say "the login table"
refuse_dev_user
use_src=0
if [ -f "$src" ]; then
  use_src=1
  summary="$(table_summary "$src")" || die "$src is not a valid table (see above). Nothing was changed"
elif [ -f "$cfg" ]; then
  summary="$(table_summary "$cfg")" || die "$cfg is not a valid table (see above). Nothing was changed"
  ok "no new table at $src; the installed one is kept"
else
  die "no table: neither $src nor $cfg exists. Run scripts/pi/player-connector-cloudflare.mjs on the PC first (it sends the table here). Nothing was changed"
fi
host="${summary% *}"
ok "table: host $host, ${summary#* } players (names, ids and secrets are not shown)"
if [ -f "$access" ]; then
  has_key "$access" CF_ACCESS_TEAM_DOMAIN || die "$access has no CF_ACCESS_TEAM_DOMAIN: run set-dashboard-access.sh first (the player login is checked against the same team). Nothing was changed"
else
  die "$access is missing: run set-dashboard-access.sh first. Nothing was changed"
fi
# Without the line the dashboard falls back to the unit's own list (the tailnet name); writing a line with only the player host would
# lock the GM out of the dashboard, so stop and let the user look.
grep -q '^DASHBOARD_ALLOWED_HOSTS=[^[:space:]]' "$access" || die "$access has no DASHBOARD_ALLOWED_HOSTS line with a value: run set-dashboard-access.sh (it writes the GM hosts) and then this stage. Nothing was changed"
cur_hosts="$(sed -n 's/^DASHBOARD_ALLOWED_HOSTS=//p' "$access" | tail -n 1)"
[ -n "$cur_hosts" ] || die "$access: the last DASHBOARD_ALLOWED_HOSTS line is empty: run set-dashboard-access.sh. Nothing was changed"
if host_in_list "$cur_hosts" "$host"; then new_hosts="$cur_hosts"; else new_hosts="${cur_hosts:+$cur_hosts,}$host"; fi

if [ "$dry" = 1 ]; then
  say "dry run: nothing is changed. A real run would:"
  if [ "$use_src" = 1 ]; then ok "install $src as $cfg (foundry, 0600) and remove $src"; else ok "keep the installed $cfg"; fi
  ok "write $envf (root:$FOUNDRY_USER 0640): the switch on, the table path"
  ok "write a drop-in $dropin_name on $dash_unit and on $bridge_unit"
  ok "DASHBOARD_ALLOWED_HOSTS: $cur_hosts -> $new_hosts"
  ok "restart the bridge and the dashboard if something they read changed (refused while players are online or a recording runs)"
  ok "ports 31414 to 31416 now: $(ports_line)"
  exit 0
fi

# A restart is coming when anything the services read will change: ask now, before the first write, so a refusal leaves everything as it
# was (a rerun after it then installs the table again).
will_change=0
if [ "$use_src" = 1 ]; then
  if [ -f "$cfg" ] && cmp -s "$src" "$cfg"; then :; else will_change=1; fi
fi
[ "$(cat "$envf" 2>/dev/null)" = "$env_body" ] || will_change=1
for u in "$dash_unit" "$bridge_unit"; do
  [ "$(cat "$unit_dir/$u.d/$dropin_name" 2>/dev/null)" = "$dropin_body" ] || will_change=1
done
[ "$new_hosts" = "$cur_hosts" ] || will_change=1
if [ "$will_change" = 1 ]; then
  require_quiet_if_active "$dash_unit" "restarting the dashboard for the player connector"
  require_quiet_if_active "$bridge_unit" "restarting the bridge for the player connector"
fi

ports_before="$(ports_line)"

if [ "$use_src" = 1 ]; then
  tmp="$(mktemp "$TOOL_ETC/.player-connector.json.XXXXXX")"
  trap 'rm -f "${tmp:?}"' EXIT
  cat "$src" >"$tmp"
  chown "$FOUNDRY_USER:$FOUNDRY_USER" "$tmp"
  chmod 0600 "$tmp"
  if [ -f "$cfg" ] && cmp -s "$tmp" "$cfg"; then
    rm -f "${tmp:?}"
    ok "$cfg unchanged"
  else
    mv "$tmp" "$cfg"
    mark_changed "$cfg"
    ok "$cfg installed (foundry, 0600)"
  fi
  trap - EXIT
  rm -f "${src:?}"
  ok "$src removed"
fi
chown "$FOUNDRY_USER:$FOUNDRY_USER" "$cfg"
chmod 0600 "$cfg"

say "settings and drop-ins"
write_file "$envf" 0640 "$env_body" || true
chown "root:$FOUNDRY_USER" "$envf"
for u in "$dash_unit" "$bridge_unit"; do
  install -d -m 0755 "$unit_dir/$u.d"
  if write_file "$unit_dir/$u.d/$dropin_name" 0644 "$dropin_body"; then mark_changed "$unit_dir/$u"; fi
done

if [ "$new_hosts" != "$cur_hosts" ]; then
  cp -p "$access" "$access.before-player-connector"
  tmp="$(mktemp "$TOOL_ETC/.dashboard-access.env.XXXXXX")"
  trap 'rm -f "${tmp:?}"' EXIT
  awk -v v="$new_hosts" 'BEGIN { d = 0 } /^DASHBOARD_ALLOWED_HOSTS=/ { print "DASHBOARD_ALLOWED_HOSTS=" v; d = 1; next } { print } END { if (!d) print "DASHBOARD_ALLOWED_HOSTS=" v }' "$access" >"$tmp"
  chown --reference="$access" "$tmp"
  chmod --reference="$access" "$tmp"
  mv "$tmp" "$access"
  trap - EXIT
  mark_changed "$access"
  ok "DASHBOARD_ALLOWED_HOSTS now has $host (old file: $access.before-player-connector)"
else
  ok "$host is already in DASHBOARD_ALLOWED_HOSTS"
fi

say "the services"
enable_unit "$bridge_unit" "$envf" "$cfg"
enable_unit "$dash_unit" "$envf" "$cfg" "$access"

say "the check"
if ! have_systemd; then
  warn "no systemd here (a test container?): the service checks are skipped"
else
  sleep 2
  code=""
  for _ in $(seq 1 30); do
    code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Host: $host" -H 'content-type: application/json' -d '{}' http://127.0.0.1:3000/mcp/player || true)"
    [ "$code" != 000 ] && [ -n "$code" ] && break
    sleep 1
  done
  [ "$code" = 401 ] && ok "/mcp/player with no token: 401" || bad "/mcp/player with no token gave '$code', expected 401 (journalctl -u $dash_unit -n 30)"
  code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: not-listed.example' http://127.0.0.1:3000/ || true)"
  [ "$code" = 421 ] && ok "an unlisted name: 421" || bad "an unlisted name gave '$code', expected 421"
  ports_after="$(ports_line)"
  if [ "$ports_before" = "$ports_after" ]; then ok "ports 31414 to 31416 as before: $ports_after"; else bad "ports 31414 to 31416 changed: before '$ports_before', after '$ports_after'"; fi
  cp_rc=0
  for _ in $(seq 1 15); do
    cp_rc=0
    control_port_check 31414 || cp_rc=$?
    [ "$cp_rc" = 0 ] && break
    sleep 1
  done
  [ "$cp_rc" = 0 ] && ok "the bridge control port answers on loopback" || bad "the bridge control port 31414 check returned $cp_rc"
fi
[ "$fails" = 0 ] || die "stage 30: $fails check(s) failed (see the warnings above). The install is in place; fix the cause and run it again with CHECK=1 (or UNDO=1 to take the install out)"
say "stage 30 done: player host $host. Next: the first call with each token, then 'journalctl -u $dash_unit | grep common_name' (the Client ID claim check), a no-token 401 and a GM-login 403 through Cloudflare"
