#!/usr/bin/env bash
# Stage 24: run the Pi stack as containers instead of (or beside) the systemd units (backlog pi-docker-compose).
# Needs stage 23 first (Docker, the images, deploy/pi/.env). Design and settings: deploy/pi/README.md.
#
# Every mode that changes something needs a dietpi-backup snapshot from today (/boot/dietpi/dietpi-backup 1) and the
# user's OK first (pi-work skill). Never on a game-night day. MODE=status and DRY_RUN=1 change nothing and need neither.
#
#   MODE=status    read-only: each systemd unit (enabled, active), each container (state, health, restarts); exit 1 when a
#                  unit and the stack run at the same time (two copies of one service)
#   MODE=up        start a REHEARSAL stack (docker compose up -d, then wait for foundry, bridge and dashboard). Refused on the
#                  live ports (30000, 31414, 31415, 3000, any one of them) until the cutover is supported (Backlog:
#                  pi-compose-cutover), and refused on the live data folders whatever state the units are in: a second
#                  Foundry on the live data folder corrupts it. A rehearsal sets other ports and its own data folders in the
#                  ssh line; it runs as its own compose project (foundry-ai-tool-pi-rehearsal) and never touches the live
#                  stack. For example (deploy/pi/test.env has the ports):
#                    ssh foundry-pi 'MODE=up FOUNDRY_HTTP_PORT=30100 BRIDGE_CONTROL_PORT=31614 BRIDGE_LINK_PORT=31615 \
#                      DASHBOARD_PORT=3300 FOUNDRY_DATA_DIR=/var/lib/foundry-rehearsal TOOL_DATA_DIR=/var/lib/foundry-ai-tool-rehearsal bash -s'
#                  (Under TEST_ALLOW_CUTOVER=1, tests only, the live project can start and then asks for a quiet table.)
#   MODE=down      stop and remove the containers (the data folders are bind mounts and stay). Asks for a quiet table first
#                  when the stack uses a live port. Use the same ports as the `up` (the project name follows them).
#   MODE=cutover   REFUSED for now. The switch to containers needs follow-ups first: a compose-aware nightly backup
#                  (6-backup.sh stops and copies foundry.service's world) and guards in every stage that starts or restarts
#                  foundry.service (3, 5, 7, 11, 12, 13, 14, 19, 21, switch-world, kit-session, set-dashboard-access). Backlog:
#                  pi-compose-cutover. The code below stays for that item and for the scenario tests (TEST_ALLOW_CUTOVER=1).
#   MODE=rollback  ONE command back to systemd: stop every container of the live project, then enable and start the units in
#                  dependency order (foundry, bridge, dashboard, gm-browser), the ones cutover recorded, else every installed
#                  one. Needs no quiet table (it is the way out) and only warns without a snapshot from today. Containers are
#                  found by label, so a missing compose file or .env does not hide them; with the Docker daemon down it
#                  refuses (the containers come back with the daemon) unless FORCE=1, which first disables docker.service.
# FOUNDRY_DATA_DIR and TOOL_DATA_DIR must be absolute paths for up and cutover (compose and this script would resolve a
# relative one against different folders); down, rollback and status ignore the rule so the way out is never blocked.
# Without MODE it is status. DRY_RUN=1 with any other mode checks everything and prints the plan.
#
# Not touched in any mode: Syncthing, cloudflared, Tailscale (serve), the Discord bot, the GitHub runner, the env files,
# Foundry's and the tool's data folders, the images. Nothing is deleted except the containers of `down` and `rollback`.
# Stage 5 and stage 3 still write and enable the systemd units: do NOT run them while the live project has containers
# (they would start a second copy); MODE=rollback first. deploy/pi/deployed-state.sh reports a unit and a container
# running together as FAIL.
#
# Tunable: WAIT_TIMEOUT (seconds to wait for healthy, default 300; raise it for a big world on the Pi), PORT_WAIT.
# Tests only: TOOL_CHECKOUT, CUTOVER_STATE, TEST_ALLOW_CUTOVER.

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
if [ "$mode" = cutover ] && [ "${TEST_ALLOW_CUTOVER:-0}" != 1 ]; then
  die "MODE=cutover is not supported until the nightly backup and the stages know the stack (Backlog: pi-compose-cutover). MODE=up with rehearsal ports (deploy/pi/test.env) and MODE=down are the rehearsal; MODE=rollback goes back to the units. Nothing was changed"
fi
# An SSH drop must not leave a switch half done: ignore HUP and a closed stdout from here on and keep the story on the Pi.
if [ "$mode" != status ]; then
  trap '' HUP PIPE
fi
if [ "$mode" != status ] && [ "$dry" != 1 ]; then
  STAGE_LOG="$TOOL_DIR/compose-run-$(date +%Y%m%d-%H%M%S).log"
  if (umask 077 && : >>"$STAGE_LOG") 2>/dev/null; then ok "this run is logged in $STAGE_LOG"; else STAGE_LOG=""; fi
fi

# ---- helpers ---------------------------------------------------------------------------------------------------
# The value compose will use: the shell wins (even set but empty, which compose then replaces with the default) over
# deploy/pi/.env wins over the default in compose.yml. A .env value is read like compose does: leading and trailing
# whitespace dropped, an unquoted value ends at a ` #` comment, one pair of matching quotes removed.
effective() { # NAME DEFAULT
  local v="${!1:-}"
  if [ -z "${!1+set}" ] && [ -f "$env_file" ]; then
    v="$(sed -n "s/^[[:space:]]*$1[[:space:]]*=//p" "$env_file" | tail -n 1)"
    v="${v#"${v%%[![:space:]]*}"}"
    case "$v" in
      \"*\") v="${v#\"}" v="${v%\"}" ;;
      \'*\') v="${v#\'}" v="${v%\'}" ;;
      *) v="$(printf '%s' "$v" | sed 's/[[:space:]]*#.*$//; s/[[:space:]]*$//')" ;;
    esac
  fi
  printf '%s' "${v:-$2}"
}
# True when the stack's data folders are, or sit inside or around, the live ones. Paths are canonicalised first, so a
# trailing slash, //, /./ or a symlink does not get past the refusal. Fails closed: when realpath cannot canonicalise a
# path the script stops, because a raw string compare would let those forms through.
canon() { realpath -m -- "$1" 2>/dev/null; }
overlaps() { # A B
  local a b
  a="$(canon "$1")" || die "cannot check the data folders (realpath -m failed for '$1'). Nothing was changed"
  b="$(canon "$2")" || die "cannot check the data folders (realpath -m failed for '$2'). Nothing was changed"
  a="$a/" b="$b/"
  case "$a" in "$b"*) return 0 ;; esac
  case "$b" in "$a"*) return 0 ;; esac
  return 1
}
# Both stack folders against both live folders, so a rehearsal Foundry folder set to the live tool folder (or the other way
# round) is caught too.
on_live_data() {
  local s l
  for s in "$foundry_data" "$tool_data"; do
    for l in "$live_foundry_data" "$TOOL_DATA"; do
      ! overlaps "$s" "$l" || return 0
    done
  done
  return 1
}
http_port="$(effective FOUNDRY_HTTP_PORT 30000)"
control_port="$(effective BRIDGE_CONTROL_PORT 31414)"
link_port="$(effective BRIDGE_LINK_PORT 31415)"
dash_port="$(effective DASHBOARD_PORT 3000)"
foundry_data="$(effective FOUNDRY_DATA_DIR "$live_foundry_data")"
tool_data="$(effective TOOL_DATA_DIR "$TOOL_DATA")"
foundry_app="$(effective FOUNDRY_APP_DIR "$FOUNDRY_APP")"
# Compose resolves a relative bind path against the compose file folder, this script against its own cwd: refuse both.
# Only for up and cutover, the modes that mount the data folders; down, rollback and status must never be blocked by it.
if [ "$mode" = up ] || [ "$mode" = cutover ]; then
  case "$foundry_data" in /*) ;; *) die "FOUNDRY_DATA_DIR must be an absolute path (got '$foundry_data'). Nothing was changed" ;; esac
  case "$tool_data" in /*) ;; *) die "TOOL_DATA_DIR must be an absolute path (got '$tool_data'). Nothing was changed" ;; esac
fi

# The live stack and a rehearsal are separate compose projects, so a rehearsal can never recreate or remove the live
# containers. A rehearsal is anything that uses none of the live ports.
live_project=foundry-ai-tool-pi
project="$live_project-rehearsal"
# Any one live port makes it the live project (a rehearsal that kept the live dashboard port still clashes with it).
if [ "$http_port" = 30000 ] || [ "$control_port" = 31414 ] || [ "$link_port" = 31415 ] || [ "$dash_port" = 3000 ]; then
  project="$live_project"
fi

dc() { docker compose -f "$compose_file" -p "$project" "$@"; }

# Container ids of a compose project, found by label: this needs neither the compose file nor deploy/pi/.env, so a
# stage 5 that replaced the checkout cannot hide a running stack. Fails (rc 1, nothing printed) when docker is installed
# but its daemon does not answer: the state is then unknown and every caller treats that as "containers may exist".
containers_of() { # $1 project, $2 optional service, $3 -a for stopped ones too
  command -v docker >/dev/null 2>&1 || return 0
  timeout 20 docker info >/dev/null 2>&1 || return 1
  local args=(ps -q)
  [ "${3:-}" != -a ] || args=(ps -aq)
  args+=(--filter "label=com.docker.compose.project=$1")
  [ -z "${2:-}" ] || args+=(--filter "label=com.docker.compose.service=$2")
  docker "${args[@]}" 2>/dev/null
}
daemon_known() { ! command -v docker >/dev/null 2>&1 || timeout 20 docker info >/dev/null 2>&1; }
need_daemon() { # $1 what
  daemon_known || die "the Docker daemon does not answer, so which containers exist is unknown (a stopped daemon brings its containers back when it starts): $1 is refused. systemctl status docker. Nothing was changed"
}
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

# True when a container of the project runs. Unknown (daemon down) counts as running: callers then refuse.
stack_running() { # $1 project, default the current one
  local ids
  ids="$(containers_of "${1:-$project}")" || return 0
  [ -n "$ids" ]
}
# The first container id of a service of the current project ("-a": stopped ones too).
# Prints nothing and returns 1 when the daemon does not answer (unknown is not "none").
svc_container() {
  local ids
  ids="$(containers_of "$project" "$1" "${2:-}")" || return 1
  printf '%s
' "$ids" | head -n 1
}

# The services that must be healthy for the stack to count as up. The Assistant GM browser (gm-browser) is reported
# but is no gate: it is healthy only once the world runs, the Assistant GM joined and the module socket connected, which
# depends on the world and its module, not on the containers (and without assistant-gm.env it never joins).
gate_services="foundry bridge dashboard"
gm_service=gm-browser

# One line per service; returns 0 when every gate service has a running, healthy container. gm-browser's line is
# informational, with a WARNING when it is not healthy.
stack_report() {
  local svc cid line st h n bad=0 total=0 gate
  while read -r svc; do
    [ -n "$svc" ] || continue
    gate=1
    [ "$svc" != "$gm_service" ] || gate=0
    [ "$gate" = 0 ] || total=$((total + 1))
    cid="$(svc_container "$svc" -a)" || cid=""
    if [ -z "$cid" ]; then
      echo "    $svc: no container"
      [ "$gate" = 0 ] || bad=1
      continue
    fi
    line="$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.RestartCount}}' "$cid" 2>/dev/null || true)"
    st="" h="" n=""
    read -r st h n <<<"$line" || true
    echo "    $svc: ${st:-unknown}, health ${h:-unknown}, restarts ${n:-?}"
    if ! { [ "$st" = running ] && [ "$h" = healthy ]; }; then
      if [ "$gate" = 1 ]; then bad=1; else warn "$svc is not healthy (it needs the world, the Assistant GM login and the module): not a reason to roll back"; fi
    fi
  done < <(dc config --services 2>/dev/null || true)
  [ "$total" -gt 0 ] || return 1
  return "$bad"
}

# True when the Assistant GM container has joined the world in its current run (the logs since its last start).
gm_container_joined() {
  local cid started
  cid="$(svc_container gm-browser)" || cid=""
  [ -n "$cid" ] || return 1
  started="$(docker inspect -f '{{.State.StartedAt}}' "$cid" 2>/dev/null || true)"
  [ -n "$started" ] || return 1
  [ "$(docker logs --since "$started" "$cid" 2>&1 | grep -c '\[assistant-gm\] joined world' || true)" -gt 0 ]
}

# require_quiet for the stack: refuses while players are online (the Assistant GM container counts as one once it has
# joined) or a recording runs. Only for the live project (any live port makes it that); a rehearsal drops nobody.
require_quiet_stack() { # $1 what
  local online joined=0
  [ "$project" = "$live_project" ] || return 0
  if [ -n "$(svc_container foundry)" ]; then
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
  command -v docker >/dev/null 2>&1 || die "docker is not installed: run stage 23 first. Nothing was changed"
  timeout 20 docker info >/dev/null 2>&1 || die "the Docker daemon does not answer (systemctl status docker). Nothing was changed"
  [ -f "$compose_file" ] || die "$compose_file is missing: run stage 23 (it needs a tool build that has deploy/pi). Nothing was changed"
  grep -q '^FOUNDRY_UID=[0-9]' "$env_file" 2>/dev/null || die "$env_file has no FOUNDRY_UID: run stage 23 again (a new stage 5 build replaces the checkout and its .env). Nothing was changed"
  for img in $(dc config --images 2>/dev/null); do
    docker image inspect "$img" >/dev/null 2>&1 || missing="$missing $img"
  done
  [ -z "$missing" ] || die "image(s)$missing not built: run stage 23. Nothing was changed"
  [ -d "$foundry_app" ] && [ -d "$foundry_data" ] && [ -d "$tool_data" ] ||
    die "a folder the containers mount is missing ($foundry_app, $foundry_data, $tool_data): docker would create it as root. Nothing was changed"
  [ -f "$TOOL_ETC/bridge.env" ] || warn "$TOOL_ETC/bridge.env is missing: the bridge starts without its settings"
  check_env_values
}

# Compose expands $VAR in unquoted and double-quoted values, drops " #..." comments and unquotes; systemd does none of
# that. A value with one of those characters would reach the container differently from the unit: refuse, naming the
# file and key only (never the value; the files hold passwords).
check_env_values() {
  local f key bad=""
  for f in bridge dashboard dashboard-access assistant-gm; do
    [ -f "$TOOL_ETC/$f.env" ] || continue
    while IFS= read -r key; do
      bad="$bad $f.env:$key"
    done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=.*[$#\\"'"'"']' "$TOOL_ETC/$f.env" 2>/dev/null | sed 's/=.*//' || true)
  done
  [ -z "$bad" ] || die "env value(s) with a \$, #, backslash or quote that compose reads differently from systemd:$bad. Change the value (letters, digits and - _ . / : + = are safe). Nothing was changed"
}

# up: no systemd unit may run on the live ports or data folders.
conflict_guard() {
  local u active="" live=""
  # Enabled counts too: a unit stopped for the 04:30 backup is started again by it.
  for u in "${units[@]}"; do if unit_active "$u" || unit_enabled "$u"; then active="$active $u"; fi; done
  if [ -n "$active" ]; then
    live="$(live_ports)"
    [ -z "$live" ] || die "systemd unit(s)$active run or are enabled and the stack would use the live port(s) $live. Two copies on one port fail. For a rehearsal set other ports (deploy/pi/test.env). Nothing was changed"
    if on_live_data; then
      die "systemd unit(s)$active run or are enabled and the stack would share their data folder ($foundry_data, $tool_data): two Foundrys on one data folder corrupt it. Set FOUNDRY_DATA_DIR and TOOL_DATA_DIR for the rehearsal. Nothing was changed"
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

# Start the project and wait for the gate services only: gm-browser is no gate (see gate_services) and would otherwise hold
# `--wait` for the whole timeout on a world without it.
start_stack() {
  dc up -d --no-build >/dev/null 2>&1 || warn "docker compose up reported an error"
  # shellcheck disable=SC2086
  dc up -d --no-build --wait --wait-timeout "$wait_timeout" $gate_services >/dev/null 2>&1 ||
    warn "docker compose up --wait did not finish healthy within ${wait_timeout}s"
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

# Stop and remove the containers of a project. `compose down` first when the compose file and .env can be read (it stops in
# reverse dependency order); then whatever is left, found by label: restart policy off (so a daemon restart does not bring
# them back), a graceful stop, remove.
stop_project() { # $1 project; returns 1 when containers remain (or when that cannot be told)
  local ids left
  command -v docker >/dev/null 2>&1 || return 0
  if [ -f "$compose_file" ] && [ -f "$env_file" ]; then
    docker compose -f "$compose_file" -p "$1" down >/dev/null 2>&1 || warn "docker compose down reported an error"
  fi
  ids="$(containers_of "$1" "" -a | tr '\n' ' ')" || return 1
  if [ -n "${ids// /}" ]; then
    # shellcheck disable=SC2086
    docker update --restart=no $ids >/dev/null 2>&1 || warn "docker update --restart=no failed"
    # shellcheck disable=SC2086
    docker stop -t 90 $ids >/dev/null 2>&1 || warn "docker stop reported an error"
    # shellcheck disable=SC2086
    docker rm -f $ids >/dev/null 2>&1 || warn "docker rm reported an error"
  fi
  left="$(containers_of "$1" "" -a)" || return 1
  [ -z "$left" ]
}

rollback_now() {
  local u fail="" list
  have_systemd || die "no systemd here: nothing to roll back to"
  if ! daemon_known; then
    # The containers come back with the daemon (restart: unless-stopped), next to the units we are about to start.
    [ "${FORCE:-0}" = 1 ] || {
      out "ERROR: the Docker daemon does not answer, so the containers cannot be stopped or counted, and they return when it starts. Nothing was changed. FORCE=1 disables docker.service and docker.socket first and goes on" 1
      return 1
    }
    warn "FORCE=1: the Docker daemon does not answer; disabling docker.service and docker.socket so no container returns"
    systemctl disable --now docker.service docker.socket >/dev/null 2>&1 || warn "systemctl disable --now docker.service docker.socket failed"
  else
    say "rollback: stopping the compose stack"
    if ! stop_project "$live_project"; then
      out "ERROR: containers of the stack still run after down; the units were NOT started (two copies would clash). Look at: docker ps" 1
      return 1
    fi
    ok "no container of the stack runs"
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
  # The record said which units were on before the cutover; after a rollback it is stale.
  rm -f "${state_file:?}"
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
  say "containers (project $project)"
  if ! daemon_known; then
    warn "the Docker daemon does not answer: which containers exist is unknown"
    return 1
  fi
  if command -v docker >/dev/null 2>&1; then
    if [ -f "$compose_file" ] && grep -q '^FOUNDRY_UID=[0-9]' "$env_file" 2>/dev/null; then
      stack_report || true
    else
      echo "    no compose file or no FOUNDRY_UID in $env_file (stage 23 not run, or stage 5 replaced the checkout): the per-service report is skipped"
      containers_of "$project" "" -a | sed 's/^/    container /'
    fi
    # Containers are found by label, so this holds without the compose file and .env.
    if [ "$both" -gt 0 ] && stack_running; then
      warn "a systemd unit and the stack run at the same time"
      return 1
    fi
    if [ "$project" = "$live_project" ] && stack_running "$live_project-rehearsal"; then
      warn "a rehearsal is running (project $live_project-rehearsal, restart: unless-stopped, it returns after a reboot): MODE=down with the rehearsal ports stops it"
      return 1
    fi
  else
    echo "    no docker (stage 23 not run)"
  fi
  return 0
}

mode_up() {
  # The live project next to the stock units is the cutover that is refused for now; MODE=up is for rehearsal ports.
  if [ "$project" = "$live_project" ] && [ "${TEST_ALLOW_CUTOVER:-0}" != 1 ]; then
    die "MODE=up on the live ports (project $live_project) is the cutover, which is not supported yet (Backlog: pi-compose-cutover): the nightly backup and the other stages would run next to the containers. Use rehearsal ports (deploy/pi/test.env). Nothing was changed"
  fi
  # A rehearsal on the live data folders is the same corruption as a second Foundry there, whatever the units are doing.
  if [ "$project" != "$live_project" ] && on_live_data; then
    die "the rehearsal would use a live data folder ($foundry_data, $tool_data): a second Foundry on it corrupts it, also with the units off. Set FOUNDRY_DATA_DIR and TOOL_DATA_DIR for the rehearsal. Nothing was changed"
  fi
  need_daemon "starting the stack"
  preflight_stack
  conflict_guard
  if [ "$dry" = 1 ]; then
    say "dry run: would run  docker compose -f $compose_file -p $project up -d --no-build, then wait for $gate_services  (ports $http_port $control_port $link_port $dash_port); nothing changed"
    return 0
  fi
  require_recent_snapshot
  # Starting the live project again can recreate running containers (new image, new environment): a quiet table first.
  if [ "$project" = "$live_project" ] && stack_running; then
    require_quiet_stack "starting the stack again (it can recreate running containers)"
  fi
  say "starting the stack"
  start_stack
  say "check"
  if verify_stack; then
    ok "the stack runs and is healthy"
  else
    out "ERROR: the stack is not healthy. It is left running for a look (docker compose -f $compose_file logs <service>); MODE=down stops it" 1
    return 1
  fi
}

mode_down() {
  command -v docker >/dev/null 2>&1 || die "no docker: nothing to stop"
  need_daemon "stopping the containers"
  if [ "$project" = "$live_project" ] && ! stack_running && stack_running "$live_project-rehearsal"; then
    die "no live container runs, but a rehearsal does (project $live_project-rehearsal): run MODE=down again with the rehearsal ports (FOUNDRY_HTTP_PORT=30100 BRIDGE_CONTROL_PORT=31614 BRIDGE_LINK_PORT=31615 DASHBOARD_PORT=3300 and its data folders). Nothing was changed"
  fi
  if [ "$dry" = 1 ]; then
    say "dry run: would stop and remove the containers of project $project; nothing changed"
    return 0
  fi
  require_recent_snapshot
  require_quiet_stack "stopping the containers"
  say "stopping the stack (project $project)"
  if ! stop_project "$project"; then
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
  need_daemon "cutting over"
  stack_running && die "containers of the stack run while systemd units are enabled or active (${was[*]}): a mixed state. MODE=rollback first, or MODE=down. Nothing was changed"
  if [ "$dry" = 1 ]; then
    say "dry run: would stop and disable (in this order): $(for ((i = ${#existing[@]} - 1; i >= 0; i--)); do printf '%s ' "${existing[i]}"; done)"
    say "dry run: then docker compose up -d --wait on ports $http_port $control_port $link_port $dash_port; rolls back by itself when unhealthy; nothing changed"
    return 0
  fi
  require_recent_snapshot
  require_quiet "cutting over (it stops Foundry, the bridge, the dashboard and the Assistant GM)"
  if [ "${#was[@]}" -gt 0 ]; then
    # Written whole to a temp file and renamed, so an interrupted run never leaves a record with only some of the units.
    for u in "${was[@]}"; do printf '%s\n' "$u"; done >"$state_file.new"
    mv -f "$state_file.new" "$state_file"
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
  start_stack
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
  if [ "$project" = "$live_project" ] && [ -n "$(svc_container foundry)" ]; then
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
