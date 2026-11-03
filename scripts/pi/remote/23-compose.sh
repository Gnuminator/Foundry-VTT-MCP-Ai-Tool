#!/usr/bin/env bash
# Stage 23: run the Pi stack as containers instead of (or beside) the systemd units (backlog pi-docker-compose).
# Needs stage 22 first (Docker, the images, deploy/pi/.env). Design and settings: deploy/pi/README.md.
#
# Every mode that changes something needs a dietpi-backup snapshot from today (/boot/dietpi/dietpi-backup 1) and the
# user's OK first (pi-work skill). Never on a game-night day. MODE=status and DRY_RUN=1 change nothing and need neither.
#
#   MODE=status    read-only: each systemd unit (enabled, active), each container (state, health, restarts); exit 1 when a
#                  unit and the stack run at the same time (two copies of one service)
#   MODE=up        start the compose stack (docker compose up -d --wait). Refused while a systemd unit runs and the stack would
#                  use the live ports (30000, 31414, 31415, 3000) or the live data folders: a second Foundry on the live data
#                  folder corrupts it. A rehearsal beside the units sets other ports and its own data folders in the ssh line,
#                  for example (deploy/pi/test.env has the ports):
#                    ssh foundry-pi 'MODE=up FOUNDRY_HTTP_PORT=30100 BRIDGE_CONTROL_PORT=31614 BRIDGE_LINK_PORT=31615 \
#                      DASHBOARD_PORT=3300 FOUNDRY_DATA_DIR=/var/lib/foundry-rehearsal TOOL_DATA_DIR=/var/lib/foundry-ai-tool-rehearsal bash -s'
#   MODE=down      stop and remove the containers (docker compose down; the data folders are bind mounts and stay). Asks for a
#                  quiet table first when the stack serves the live Foundry port.
#   MODE=cutover   the switch to containers: quiet check, remember which units run, stop AND DISABLE foundry.service,
#                  foundry-ai-tool-bridge/-dashboard/-gm-browser.service (they stay installed), wait for the ports, then
#                  `up -d --wait`. When the stack is not healthy after the wait, or the bridge control port does not answer on
#                  loopback only, it runs the rollback by itself and exits 1. Already cut over: it changes nothing.
#   MODE=rollback  ONE command back to systemd: stop the compose stack, then enable and start the units in dependency order
#                  (foundry, bridge, dashboard, gm-browser), the ones cutover recorded, else every installed one. Needs no quiet
#                  table (it is the way out) and only warns without a snapshot from today.
# Without MODE it is status. DRY_RUN=1 with any other mode checks everything and prints the plan.
#
# Not touched in any mode: Syncthing, cloudflared, Tailscale (serve), the Discord bot, the GitHub runner, the env files,
# Foundry's and the tool's data folders, the images. Nothing is deleted except the containers of `down`.
# Stage 5 and stage 3 still write and enable the systemd units: do NOT run them on a cut-over Pi until they know about
# compose (they would start a second copy); MODE=rollback first, or leave the units alone. deploy/pi/deployed-state.sh
# reports a unit and a container running together as FAIL.
#
# Tests only: TOOL_CHECKOUT, CUTOVER_STATE, WAIT_TIMEOUT, PORT_WAIT.

mode="${MODE:-status}"
dry="${DRY_RUN:-0}"
checkout="${TOOL_CHECKOUT:-$TOOL_DIR/app}"
compose_dir="$checkout/deploy/pi"
compose_file="$compose_dir/compose.yml"
env_file="$compose_dir/.env"
state_file="${CUTOVER_STATE:-$TOOL_DIR/compose-cutover.state}"
wait_timeout="${WAIT_TIMEOUT:-300}"
port_wait="${PORT_WAIT:-30}"
# Dependency order: Foundry first, the Assistant GM browser last. Stopping goes the other way round.
units=(foundry.service foundry-ai-tool-bridge.service foundry-ai-tool-dashboard.service foundry-ai-tool-gm-browser.service)
live_foundry_data="$FOUNDRY_DATA"

require_root
PATH="$PATH:/usr/sbin:/sbin"

case "$mode" in
  status | up | down | cutover | rollback) ;;
  *) die "MODE must be status, up, down, cutover or rollback (got '$mode'). Nothing was changed" ;;
esac

# ---- helpers ---------------------------------------------------------------------------------------------------
# The value compose will use: the shell wins over deploy/pi/.env wins over the default in compose.yml.
effective() { # NAME DEFAULT
  local v="${!1:-}"
  if [ -z "$v" ] && [ -f "$env_file" ]; then v="$(sed -n "s/^$1=//p" "$env_file" | tail -n 1)"; fi
  printf '%s' "${v:-$2}"
}
http_port="$(effective FOUNDRY_HTTP_PORT 30000)"
control_port="$(effective BRIDGE_CONTROL_PORT 31414)"
link_port="$(effective BRIDGE_LINK_PORT 31415)"
dash_port="$(effective DASHBOARD_PORT 3000)"
foundry_data="$(effective FOUNDRY_DATA_DIR "$live_foundry_data")"
tool_data="$(effective TOOL_DATA_DIR "$TOOL_DATA")"
foundry_app="$(effective FOUNDRY_APP_DIR "$FOUNDRY_APP")"

dc() { docker compose -f "$compose_file" "$@"; }
unit_active() { have_systemd && systemctl is-active --quiet "$1"; }
unit_enabled() { have_systemd && [ "$(systemctl is-enabled "$1" 2>/dev/null || true)" = enabled ]; }
unit_installed() { have_systemd && systemctl cat "$1" >/dev/null 2>&1; }
port_busy() { [ -n "$(ss -ltnH "sport = :$1" 2>/dev/null || true)" ]; }
live_ports() { # prints the live ports this setup would use
  local p
  for p in "$http_port:30000" "$control_port:31414" "$link_port:31415" "$dash_port:3000"; do
    [ "${p%%:*}" != "${p##*:}" ] || printf '%s ' "${p%%:*}"
  done
}

# True when a container of the stack runs (compose ps lists running ones by default).
stack_running() { [ -n "$(dc ps -q 2>/dev/null || true)" ]; }

# One line per service; returns 0 when every service has a running, healthy container.
stack_report() {
  local svc cid line st h n bad=0 total=0
  while read -r svc; do
    [ -n "$svc" ] || continue
    total=$((total + 1))
    cid="$(dc ps -aq "$svc" 2>/dev/null | head -n 1 || true)"
    if [ -z "$cid" ]; then
      echo "    $svc: no container"
      bad=1
      continue
    fi
    line="$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.RestartCount}}' "$cid" 2>/dev/null || true)"
    st="" h="" n=""
    read -r st h n <<<"$line" || true
    echo "    $svc: ${st:-unknown}, health ${h:-unknown}, restarts ${n:-?}"
    { [ "$st" = running ] && [ "$h" = healthy ]; } || bad=1
  done < <(dc config --services 2>/dev/null || true)
  [ "$total" -gt 0 ] || return 1
  return "$bad"
}

# True when the Assistant GM container has joined the world in its current run (the logs since its last start).
gm_container_joined() {
  local cid started
  cid="$(dc ps -q gm-browser 2>/dev/null | head -n 1 || true)"
  [ -n "$cid" ] || return 1
  started="$(docker inspect -f '{{.State.StartedAt}}' "$cid" 2>/dev/null || true)"
  [ -n "$started" ] || return 1
  [ "$(docker logs --since "$started" "$cid" 2>&1 | grep -c '\[assistant-gm\] joined world' || true)" -gt 0 ]
}

# require_quiet for the stack: refuses while players are online (the Assistant GM container counts as one once it has
# joined) or a recording runs. Only when the stack serves the live Foundry port; a rehearsal drops nobody.
require_quiet_stack() { # $1 what
  local online joined=0
  [ "$http_port" = 30000 ] || return 0
  if [ -n "$(dc ps -q foundry 2>/dev/null || true)" ]; then
    online="$(users_online)"
    if gm_container_joined; then joined=1; fi
    if [ "$online" = "?" ]; then
      refuse "cannot read who is online in Foundry (/api/status on port 30000), so $1 is not safe"
    elif [ "$online" -gt "$joined" ]; then
      refuse "$((online - joined)) player(s) are online in Foundry: $1 would drop them"
    fi
  fi
  require_no_recording "$1"
}

# What must be true before a compose start.
preflight_stack() {
  local img missing=""
  command -v docker >/dev/null 2>&1 || die "docker is not installed: run stage 22 first. Nothing was changed"
  docker info >/dev/null 2>&1 || die "the Docker daemon does not answer (systemctl status docker). Nothing was changed"
  [ -f "$compose_file" ] || die "$compose_file is missing: run stage 22 (it needs a tool build that has deploy/pi). Nothing was changed"
  grep -q '^FOUNDRY_UID=[0-9]' "$env_file" 2>/dev/null || die "$env_file has no FOUNDRY_UID: run stage 22 again (a new stage 5 build replaces the checkout and its .env). Nothing was changed"
  for img in $(dc config --images 2>/dev/null); do
    docker image inspect "$img" >/dev/null 2>&1 || missing="$missing $img"
  done
  [ -z "$missing" ] || die "image(s)$missing not built: run stage 22. Nothing was changed"
  [ -d "$foundry_app" ] && [ -d "$foundry_data" ] && [ -d "$tool_data" ] ||
    die "a folder the containers mount is missing ($foundry_app, $foundry_data, $tool_data): docker would create it as root. Nothing was changed"
  [ -f "$TOOL_ETC/bridge.env" ] || warn "$TOOL_ETC/bridge.env is missing: the bridge starts without its settings"
}

# up: no systemd unit may run on the live ports or data folders.
conflict_guard() {
  local u active="" live=""
  for u in "${units[@]}"; do unit_active "$u" && active="$active $u"; done
  if [ -n "$active" ]; then
    live="$(live_ports)"
    [ -z "$live" ] || die "systemd unit(s)$active run and the stack would use the live port(s) $live. Two copies on one port fail. MODE=cutover switches over; for a rehearsal set other ports (deploy/pi/test.env). Nothing was changed"
    if [ "$foundry_data" = "$live_foundry_data" ] || [ "$tool_data" = "$TOOL_DATA" ]; then
      die "systemd unit(s)$active run and the stack would share their data folder ($foundry_data, $tool_data): two Foundrys on one data folder corrupt it. Set FOUNDRY_DATA_DIR and TOOL_DATA_DIR for the rehearsal. Nothing was changed"
    fi
  elif ! stack_running; then
    for p in $http_port $control_port $link_port $dash_port; do
      ! port_busy "$p" || die "port $p is already in use by something that is not this stack (ss -ltnp). Nothing was changed"
    done
  fi
}

# Wait for the ports of a stopped Foundry and bridge to be released.
wait_ports_free() {
  local i=0 p busy
  while :; do
    busy=""
    for p in $http_port $control_port $link_port $dash_port; do port_busy "$p" && busy="$busy $p"; done
    [ -z "$busy" ] && return 0
    [ "$i" -ge "$port_wait" ] && { echo "$busy"; return 1; }
    sleep 1
    i=$((i + 1))
  done
}

# The stack after `up --wait`: all healthy, and the bridge control port answers on loopback only.
verify_stack() {
  local rc=0
  stack_report || rc=1
  if [ "$rc" = 0 ]; then
    control_port_check "$control_port" || {
      case "$?" in
        2) warn "the bridge control port $control_port listens beyond loopback" ;;
        *) warn "the bridge control port $control_port does not answer a ping" ;;
      esac
      rc=1
    }
  fi
  return "$rc"
}

# ---- rollback --------------------------------------------------------------------------------------------------
rollback_units_list() { # prints the units to start, one per line
  local u
  if [ -f "$state_file" ]; then
    for u in "${units[@]}"; do grep -qx "$u" "$state_file" && echo "$u"; done
  else
    for u in "${units[@]}"; do unit_installed "$u" && echo "$u"; done
  fi
  return 0
}

rollback_now() {
  local u fail="" list
  have_systemd || die "no systemd here: nothing to roll back to"
  say "rollback: stopping the compose stack"
  if command -v docker >/dev/null 2>&1 && [ -f "$compose_file" ] && [ -f "$env_file" ]; then
    dc down >/dev/null 2>&1 || warn "docker compose down reported an error"
    if stack_running; then
      out "ERROR: containers of the stack still run after down; the units were NOT started (two copies would clash). Look at: docker ps" 1
      return 1
    fi
    ok "no container of the stack runs"
  else
    warn "no docker or no compose file: assuming no containers"
  fi
  list="$(rollback_units_list)"
  [ -n "$list" ] || { out "ERROR: no systemd unit to start (none installed, or the record lists none)" 1; return 1; }
  say "rollback: enabling and starting the units in dependency order"
  while read -r u; do
    [ -n "$u" ] || continue
    if systemctl enable --now "$u" >/dev/null 2>&1; then :; else warn "systemctl enable --now $u failed"; fi
    sleep 2
    if unit_active "$u" && unit_enabled "$u"; then
      ok "$u enabled and active"
    else
      warn "$u is not enabled and active (journalctl -u $u -n 50)"
      fail="$fail $u"
    fi
  done <<<"$list"
  [ -z "$fail" ] || { out "ERROR: rollback incomplete, unit(s) not running:$fail" 1; return 1; }
  ok "rolled back: the systemd units run, the containers are gone"
}

# ---- modes -----------------------------------------------------------------------------------------------------
mode_status() {
  local u both=0
  say "systemd units"
  for u in "${units[@]}"; do
    if unit_installed "$u"; then
      echo "    $u: $(systemctl is-enabled "$u" 2>/dev/null || true), $(systemctl is-active "$u" 2>/dev/null || true)"
      if unit_active "$u"; then both=$((both + 1)); fi
    else
      echo "    $u: not installed"
    fi
  done
  say "containers (project foundry-ai-tool-pi)"
  if command -v docker >/dev/null 2>&1 && [ -f "$compose_file" ] && grep -q '^FOUNDRY_UID=[0-9]' "$env_file" 2>/dev/null; then
    stack_report || true
    if [ "$both" -gt 0 ] && stack_running; then
      warn "a systemd unit and the stack run at the same time"
      return 1
    fi
  else
    echo "    no docker, no compose file or no $env_file (stage 22 not run)"
  fi
  return 0
}

mode_up() {
  preflight_stack
  conflict_guard
  if [ "$dry" = 1 ]; then
    say "dry run: would run  docker compose -f $compose_file up -d --wait --no-build  (ports $http_port $control_port $link_port $dash_port); nothing changed"
    return 0
  fi
  require_recent_snapshot
  say "starting the stack"
  if ! dc up -d --wait --wait-timeout "$wait_timeout" --no-build >/dev/null 2>&1; then
    warn "docker compose up --wait did not finish healthy within ${wait_timeout}s"
  fi
  say "check"
  if verify_stack; then
    ok "the stack runs and is healthy"
  else
    out "ERROR: the stack is not healthy. It is left running for a look (docker compose -f $compose_file logs <service>); MODE=down stops it" 1
    return 1
  fi
}

mode_down() {
  [ -f "$compose_file" ] && command -v docker >/dev/null 2>&1 || die "no docker or no compose file: nothing to stop"
  if [ "$dry" = 1 ]; then
    say "dry run: would run  docker compose -f $compose_file down; nothing changed"
    return 0
  fi
  require_recent_snapshot
  require_quiet_stack "stopping the containers"
  say "stopping the stack"
  dc down >/dev/null 2>&1 || warn "docker compose down reported an error"
  if stack_running; then
    out "ERROR: containers of the stack still run after down" 1
    return 1
  fi
  ok "no container of the stack runs"
  local u any=""
  for u in "${units[@]}"; do unit_active "$u" && any="$any $u"; done
  if [ -n "$any" ]; then
    ok "systemd unit(s) running:$any"
  else
    warn "neither the stack nor a systemd unit runs now: MODE=rollback (units) or MODE=up (stack) brings a side back"
  fi
}

mode_cutover() {
  local u existing=() was=() i
  have_systemd || die "systemd is not running here: nothing to cut over from"
  preflight_stack
  for u in "${units[@]}"; do
    if unit_installed "$u"; then existing+=("$u"); fi
  done
  [ "${#existing[@]}" -gt 0 ] || die "no systemd unit of the tool is installed: nothing to cut over from (MODE=up starts the stack)"
  for u in "${existing[@]}"; do
    if unit_active "$u" || unit_enabled "$u"; then was+=("$u"); fi
  done
  if [ "${#was[@]}" -eq 0 ] && stack_running; then
    say "already cut over"
    verify_stack && { ok "the units are off, the stack is healthy: nothing to do"; return 0; }
    out "ERROR: the units are off but the stack is not healthy. MODE=rollback goes back to the units" 1
    return 1
  fi
  stack_running && die "containers of the stack run while systemd units are enabled or active (${was[*]}): a mixed state. MODE=rollback first, or MODE=down. Nothing was changed"
  if [ "$dry" = 1 ]; then
    say "dry run: would stop and disable (in this order): $(for ((i = ${#existing[@]} - 1; i >= 0; i--)); do printf '%s ' "${existing[i]}"; done)"
    say "dry run: then docker compose up -d --wait on ports $http_port $control_port $link_port $dash_port; rolls back by itself when unhealthy; nothing changed"
    return 0
  fi
  require_recent_snapshot
  require_quiet "cutting over (it stops Foundry, the bridge, the dashboard and the Assistant GM)"
  if [ "${#was[@]}" -gt 0 ]; then
    : >"$state_file"
    for u in "${was[@]}"; do printf '%s\n' "$u" >>"$state_file"; done
    ok "recorded the units that were on in $state_file (${was[*]})"
  fi
  say "stopping and disabling the units (they stay installed)"
  for ((i = ${#existing[@]} - 1; i >= 0; i--)); do
    u="${existing[i]}"
    if ! systemctl disable --now "$u" >/dev/null 2>&1; then
      warn "systemctl disable --now $u failed"
    fi
    if unit_active "$u" || unit_enabled "$u"; then
      rollback_now || true
      die "$u is still enabled or active after disable --now; rolled back to the units, nothing else changed"
    fi
    ok "$u stopped and disabled"
  done
  say "waiting for the ports"
  if ! busy="$(wait_ports_free)"; then
    rollback_now || true
    die "port(s)$busy are still in use after ${port_wait}s with the units off; rolled back to the units"
  fi
  ok "ports $http_port $control_port $link_port $dash_port are free"
  say "starting the stack (up to ${wait_timeout}s for healthy)"
  if ! dc up -d --wait --wait-timeout "$wait_timeout" --no-build >/dev/null 2>&1; then
    warn "docker compose up --wait did not finish healthy"
  fi
  say "check"
  if verify_stack; then
    ok "cut over: the stack is healthy and the units are off and disabled"
    ok "back: MODE=rollback. Look: deploy/pi/deployed-state.sh"
    return 0
  fi
  out "ERROR: the stack is not healthy after the wait: rolling back to the units" 1
  if rollback_now; then
    die "ROLLED BACK: the systemd units run again, the containers are gone (the cutover did not hold)"
  fi
  die "ROLLBACK FAILED: fix by hand (systemctl status; docker ps), then MODE=rollback again"
}

mode_rollback() {
  local list
  have_systemd || die "systemd is not running here: nothing to roll back to"
  list="$(rollback_units_list | tr '\n' ' ')"
  [ -n "$list" ] || die "no systemd unit to start (none installed, or the record $state_file lists none)"
  if [ "$dry" = 1 ]; then
    say "dry run: would stop the compose stack, then enable and start: $list; nothing changed"
    return 0
  fi
  # The way out must not be blocked by a missing snapshot: only a warning.
  ( require_recent_snapshot ) || warn "no snapshot from today; going on, a rollback restores the earlier state"
  if [ "$http_port" = 30000 ] && [ -n "$(dc ps -q foundry 2>/dev/null || true)" ]; then
    online="$(users_online)"
    [ "$online" = 0 ] || warn "Foundry reports $online user(s) online: the rollback drops them (the Assistant GM counts as one)"
  fi
  rollback_now
}

case "$mode" in
  status) mode_status ;;
  up) mode_up ;;
  down) mode_down ;;
  cutover) mode_cutover ;;
  rollback) mode_rollback ;;
esac
