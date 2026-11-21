#!/usr/bin/env bash
# Shared helpers for the Orange Pi stage scripts (docs/dev/PI-SETUP.md, Part B).
# Claude runs each stage from the PC:  ssh foundry-pi 'bash -s' < scripts/pi/remote/<stage>.sh
# Every stage is safe to run again: it checks what is already there and only adds what is missing.

set -euo pipefail
# Files a stage makes are readable by the services (they run as foundry): never inherit a strict
# umask from the SSH session (stage 9's wrapper once passed on 077, and a stage 5 build came out
# root-only, so the bridge could not start; 2026-10-06). Secrets get their own modes where written.
umask 022

FOUNDRY_USER=foundry
NODE_DIR=/opt/node24
FOUNDRY_APP=/opt/foundry
FOUNDRY_DATA=/var/lib/foundry
TOOL_DIR=/opt/foundry-ai-tool
TOOL_ETC=/etc/foundry-ai-tool
TOOL_DATA=/var/lib/foundry-ai-tool

# A write that fails (the SSH connection dropped, stdout is gone) never stops a stage halfway; with STAGE_LOG set
# (stages 11, 14, 19 and 25) every line also goes to that file.
STAGE_LOG=""
out() { # $1 the line, $2 1 for stderr
  if [ "${2:-}" = 1 ]; then printf '%s\n' "$1" >&2 2>/dev/null || true; else printf '%s\n' "$1" 2>/dev/null || true; fi
  [ -z "$STAGE_LOG" ] || printf '%s %s\n' "$(date '+%F %T')" "$1" >>"$STAGE_LOG" 2>/dev/null || true
}
say() { out "==> $*"; }
ok() { out "    ok: $*"; }
warn() { out "    WARNING: $*" 1; }
die() {
  out "ERROR: $*" 1
  exit 1
}

require_root() {
  [ "$(id -u)" -eq 0 ] || die "run as root (the Pi's SSH login is root)"
}

require_arm64() {
  local arch
  arch="$(uname -m)"
  [ "$arch" = "aarch64" ] || die "expected an ARM64 board (aarch64), got $arch"
}

# Stage 14's dnd5e trial (docs/dev/PI-SETUP.md, "System trial (stage 14)"): until MODE=switch or MODE=rollback,
# only the kit world may be launched, since every world shares the one dnd5e folder and migrates to the version on
# trial when launched. A stage that launches worlds (or resets the kit) calls this first.
SYSTEM_TRIAL_DIR=/var/lib/foundry-import/system-trial
refuse_during_system_trial() { # $1 the stage, $2... the worlds it launches (none: the stage is refused whenever a trial is open)
  local stage="$1" phase id
  shift
  [ -e "$SYSTEM_TRIAL_DIR" ] || return 0
  phase="$(sed -n 's/^phase=//p' "$SYSTEM_TRIAL_DIR/state" 2>/dev/null | head -n1)" || phase=""
  [ "$phase" != switched ] || return 0
  # A stage that launches only the kit passes in phase trial alone: in installing, switching, rolling-back or an
  # unknown phase the Pi is mid-change (a halfway rollback), and nothing may start a session on it.
  if [ "$#" -gt 0 ] && [ "$phase" = trial ]; then
    for id in "$@"; do [ "$id" = strahd-kit ] || break; done
    [ "$id" != strahd-kit ] || return 0
  fi
  die "a dnd5e system trial is open ($SYSTEM_TRIAL_DIR, phase ${phase:-unknown}): $stage would launch or reset a world on the version on trial. Finish the trial first (stage 14, MODE=switch or MODE=rollback; MODE=status shows it). Nothing was changed"
}

# True when systemd runs (not in a test container).
have_systemd() {
  [ -d /run/systemd/system ]
}

# ---- The Docker stack (stage 24) ------------------------------------------------------------------------------
# After the cutover (stage 24 MODE=cutover) Foundry, the bridge, the dashboard and the Assistant GM browser run as the
# containers of compose project foundry-ai-tool-pi and their systemd units are disabled. A stage that starts, restarts or
# enables one of those units would start a second copy next to the container, so it calls refuse_when_cut_over first.
# Containers are found by label: that needs neither the compose file nor deploy/pi/.env.
COMPOSE_LIVE_PROJECT=foundry-ai-tool-pi

# containers_of PROJECT [SERVICE] [-a]: the container ids of a compose project (-a: stopped ones too). Prints nothing and
# returns 0 when docker is not installed; returns 1 (nothing printed) when docker is installed but its daemon does not
# answer: the state is then unknown and every caller treats that as "containers may exist".
containers_of() {
  command -v docker >/dev/null 2>&1 || return 0
  timeout 20 docker info >/dev/null 2>&1 || return 1
  local args=(ps -q)
  [ "${3:-}" != -a ] || args=(ps -aq)
  args+=(--filter "label=com.docker.compose.project=$1")
  [ -z "${2:-}" ] || args+=(--filter "label=com.docker.compose.service=$2")
  docker "${args[@]}" 2>/dev/null
}
# True when docker is not installed or its daemon answers.
daemon_known() { ! command -v docker >/dev/null 2>&1 || timeout 20 docker info >/dev/null 2>&1; }

# shim_state: a containerd-shim process (a container under live-restore, stage 23, left running when dockerd is stopped)
# is there or not. Returns 0 when one runs, 1 when none does, 2 when it cannot tell (pgrep missing or failing: exit 127
# must never read as "no container", so every caller treats 2 like 0). 6-backup.sh keeps its own copy of this (the
# nightly script is a stand-alone file); keep the two in step.
shim_state() {
  local rc=0
  command -v pgrep >/dev/null 2>&1 || return 2
  pgrep -f containerd-shim >/dev/null 2>&1 || rc=$?
  case "$rc" in 0) return 0 ;; 1) return 1 ;; *) return 2 ;; esac
}

# docker_cannot_return: 0 when docker is installed, its daemon is down AND systemd will not bring it back (docker.service
# and docker.socket are neither enabled nor active: stage 24's FORCE=1 rollback does that on purpose), so no container can
# be there. Anything else about a silent daemon stays "unknown".
docker_cannot_return() {
  local u
  have_systemd || return 1
  # live-restore (stage 23) keeps containers running under containerd when dockerd is stopped: a container process left
  # means "unknown", whatever systemd says about the docker units.
  local shim=0
  shim_state || shim=$?
  [ "$shim" = 1 ] || return 1
  for u in docker.service docker.socket; do
    if systemctl is-active --quiet "$u" 2>/dev/null; then return 1; fi
    [ "$(systemctl is-enabled "$u" 2>/dev/null || true)" != enabled ] || return 1
  done
  return 0
}

# refuse_when_cut_over WHAT: die when a container of the live project exists (also a stopped one: the backup stops the
# Foundry container each night, and a container that its restart policy brings back is still a second copy). Docker not
# installed = never cut over. Docker installed but silent = unknown, and unknown refuses (fail closed), unless
# docker_cannot_return. Never overridden by FORCE=1. Call it right after require_root (and the snapshot check), before the
# first change, in every stage that starts, restarts or enables Foundry, the bridge, the dashboard or the Assistant GM
# (scripts/pi/cutover-guard.test.mjs fails for a stage that touches a unit without it).
refuse_when_cut_over() {
  local what="$1" ids
  command -v docker >/dev/null 2>&1 || return 0
  if ! ids="$(containers_of "$COMPOSE_LIVE_PROJECT" "" -a)"; then
    docker_cannot_return && return 0
    die "the Docker daemon does not answer, so whether the stack runs as containers is unknown: $what is refused (it would start a systemd unit next to a container). Look at: systemctl status docker. Nothing was changed"
  fi
  [ -z "$ids" ] || die "the stack runs as containers (compose project $COMPOSE_LIVE_PROJECT): $what would start a second copy of a systemd unit next to them. Go back first: stage 24 with MODE=rollback (deploy/pi/README.md, Cutover and rollback). Nothing was changed"
}

# ---- Day two on the stack: units or containers (backlog pi-compose-day-two, D-149) ----------------------------------------
# A stage that has to start, stop or restart Foundry, the bridge, the dashboard or the Assistant GM browser calls
# `use_stack "<what>"` right after require_root (instead of refuse_when_cut_over) and then drives the four services only
# through the svc_* helpers below. use_stack sets STACK to "units" (no container of the live project exists: the systemd
# units run them, exactly as before) or "containers" (the stack was cut over: the containers run them and the units are
# off). The units path of every helper runs the very systemctl commands the stages ran before, so a Pi on systemd behaves
# as it did. Never overridden by FORCE=1. A silent Docker daemon is "unknown" and refuses (fail closed), as before.
# A unit and a container running together (a mixed state) refuses too: two copies of one service.
STACK=units
STACK_SERVICES="foundry bridge dashboard gm-browser"

# svc_unit SERVICE: the systemd unit of a stack service.
svc_unit() {
  case "$1" in
    foundry) echo foundry.service ;;
    bridge) echo foundry-ai-tool-bridge.service ;;
    dashboard) echo foundry-ai-tool-dashboard.service ;;
    gm-browser) echo foundry-ai-tool-gm-browser.service ;;
    *) return 1 ;;
  esac
}

use_stack() {
  local what="$1" ids s
  STACK=units
  command -v docker >/dev/null 2>&1 || return 0
  if ! ids="$(containers_of "$COMPOSE_LIVE_PROJECT" "" -a)"; then
    docker_cannot_return && return 0
    die "the Docker daemon does not answer, so whether the stack runs as containers is unknown: $what is refused (it could start a systemd unit next to a container). Look at: systemctl status docker. Nothing was changed"
  fi
  [ -n "$ids" ] || return 0
  if have_systemd; then
    for s in $STACK_SERVICES; do
      ! systemctl is-active --quiet "$(svc_unit "$s")" 2>/dev/null ||
        die "$(svc_unit "$s") runs next to the containers of $COMPOSE_LIVE_PROJECT (a mixed state, two copies of one service): $what is refused. Look: deploy/pi/deployed-state.sh; then stage 24 MODE=rollback. Nothing was changed"
    done
  fi
  STACK=containers
}

# svc_cid SERVICE [-a]: the container id of a stack service (-a: a stopped one too); empty when there is none. Returns 1
# when the Docker daemon does not answer (unknown is not "no container": a caller must not read it as "nothing to stop").
svc_cid() {
  local ids
  ids="$(containers_of "$COMPOSE_LIVE_PROJECT" "$1" "${2:-}" 2>/dev/null)" || return 1
  printf '%s' "$ids" | head -n 1
}
# svc_active SERVICE: runs now.
svc_active() {
  if [ "$STACK" = containers ]; then [ -n "$(svc_cid "$1")" ]; else systemctl is-active --quiet "$(svc_unit "$1")"; fi
}
# svc_wanted SERVICE: runs now, or is set up to run (enabled unit, existing container): "it was part of the stack". On
# containers it means "the container exists", so an Assistant GM container someone stopped on purpose is started again by
# a stage that stopped it; the units only restart an enabled one.
svc_wanted() {
  if [ "$STACK" = containers ]; then
    [ -n "$(svc_cid "$1" -a)" ]
  else
    systemctl is-active --quiet "$(svc_unit "$1")" || systemctl is-enabled --quiet "$(svc_unit "$1")" 2>/dev/null
  fi
}
# stack_docker ARGS: plain docker. Every stage bundle carries lib.sh, and the remote-command guard asks for any bundle that
# spells out a container stop, restart or remove. Only the five use_stack stages and this file call stack_docker and
# stack_compose (cutover-guard.test.mjs pins that list and the verbs), so the verbs go through this wrapper instead of
# making all 20 bundles ask; the guard asks for stack_docker / stack_compose verbs written in a command or in any file
# that is not a stage script, so the wrapper is no way around the rule.
stack_docker() { docker "$@"; }
# svc_stop SERVICE: stops it (a stopped one is fine). Containers: docker stop on the existing container, which keeps the
# 90 s grace of the compose file; nothing is recreated or removed.
svc_stop() {
  local cid
  if [ "$STACK" = containers ]; then
    cid="$(svc_cid "$1")" || {
      warn "the Docker daemon does not answer, so whether the $1 container runs is unknown: it was not stopped"
      return 1
    }
    [ -z "$cid" ] && return 0
    stack_docker stop "$cid" >/dev/null || return 1
    # Read it back: a stop that returned but left the container running must not pass (a failed stop already returned above).
    [ "$(timeout 20 docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || true)" != true ] || {
      warn "the $1 container ($cid) is not confirmed stopped"
      return 1
    }
  else
    systemctl stop "$(svc_unit "$1")"
  fi
}
# svc_start SERVICE: starts it. Containers: docker start on the existing container (a missing container is an error).
svc_start() {
  local cid
  if [ "$STACK" = containers ]; then
    cid="$(svc_cid "$1" -a)"
    [ -n "$cid" ] || {
      warn "no container of the service $1 in $COMPOSE_LIVE_PROJECT"
      return 1
    }
    docker start "$cid" >/dev/null
  else
    systemctl start "$(svc_unit "$1")"
  fi
}
# svc_restart SERVICE: restarts it, starts it when stopped.
svc_restart() {
  local cid
  if [ "$STACK" = containers ]; then
    cid="$(svc_cid "$1" -a)"
    [ -n "$cid" ] || {
      warn "no container of the service $1 in $COMPOSE_LIVE_PROJECT"
      return 1
    }
    stack_docker restart "$cid" >/dev/null
  else
    systemctl restart "$(svc_unit "$1")"
  fi
}
# svc_try_restart SERVICE: restarts it only when it runs (a stopped one stays stopped).
svc_try_restart() {
  if [ "$STACK" = containers ]; then
    ! svc_active "$1" || svc_restart "$1"
  else
    systemctl try-restart "$(svc_unit "$1")"
  fi
}
# svc_logs_hint SERVICE: the command to read its log, for messages.
svc_logs_hint() {
  if [ "$STACK" = containers ]; then
    echo "docker logs --tail 50 \$(docker ps -aq --filter label=com.docker.compose.project=$COMPOSE_LIVE_PROJECT --filter label=com.docker.compose.service=$1)"
  else
    echo "journalctl -u $(svc_unit "$1") -n 50"
  fi
}
# svc_gm_log SINCE: the Assistant GM browser's log lines since SINCE (a "YYYY-MM-DD HH:MM:SS" time); nothing when unknown.
svc_gm_log() {
  local cid
  if [ "$STACK" = containers ]; then
    cid="$(svc_cid gm-browser -a)"
    [ -z "$cid" ] || docker logs --since "$(date -d "$1" +%s 2>/dev/null || echo 0)" "$cid" 2>&1 || true
  else
    journalctl -u "$(svc_unit gm-browser)" --since "$1" --no-pager -o cat 2>/dev/null || true
  fi
}
# svc_gm_joined SINCE [WORLD]: the Assistant GM browser logged "joined world [WORLD]" since SINCE.
svc_gm_joined() {
  [ "$(svc_gm_log "$1" | grep -c "\[assistant-gm\] joined world${2:+ $2 }" || true)" -gt 0 ]
}

# stack_dir: the deployed checkout's deploy/pi folder (compose.yml and .env). Tests set TOOL_CHECKOUT.
stack_dir() { printf '%s' "${TOOL_CHECKOUT:-$TOOL_DIR/app}/deploy/pi"; }
# stack_compose ARGS...: docker compose on the live project from the deployed checkout (its .env is read by compose itself).
stack_compose() {
  (cd "$(stack_dir)" && docker compose -p "$COMPOSE_LIVE_PROJECT" -f compose.yml "$@")
}
# stack_env_set NAME VALUE: sets NAME=VALUE in deploy/pi/.env (the compose switches; stage 23 writes the file). Replaces the last
# NAME= line or appends one, through a temp file and a rename, mode kept; returns 0 when the file changed, 1 when it already
# had that value. NAME is upper case letters, digits and _; VALUE is plain path/host characters (no $, quote, space or #), so
# compose and env_file_value read it the same way. Nothing is printed except through ok().
stack_env_set() {
  local name="$1" value="$2" f tmp
  f="$(stack_dir)/.env"
  [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "stack_env_set: bad name '$name'"
  [[ "$value" =~ ^[A-Za-z0-9/._,:@+-]*$ ]] || die "stack_env_set: $name has a character compose would read differently (only letters, digits and /._,:@+- are written)"
  [ -f "$f" ] || die "$f is missing: run stage 23 first (it writes the compose settings). Nothing was changed"
  if grep -qE "^[[:space:]]*$name[[:space:]]*=" "$f" && [ "$(env_file_value "$f" "$name")" = "$value" ]; then return 1; fi
  tmp="$(mktemp "$f.XXXXXX")"
  { grep -vE "^[[:space:]]*$name[[:space:]]*=" "$f" || true; printf '%s=%s\n' "$name" "$value"; } >"$tmp"
  chmod --reference="$f" "$tmp"
  mv -f "$tmp" "$f"
  ok "$f: $name set"
}

# env_file_value FILE NAME: the value a compose .env FILE gives NAME, read the way compose reads it ("" when the file or the
# name is absent): the last assignment wins, whitespace around the name and the value is dropped, an unquoted value ends at a
# whitespace-then-# comment, one pair of matching quotes is removed (what is inside them is kept as it is). The one reader
# for deploy/pi/.env (stage 24); scripts/pi/cutover-guard.test.mjs tests it.
env_file_value() {
  local v=""
  if [ -f "$1" ]; then
    v="$(sed -n "s/^[[:space:]]*$2[[:space:]]*=//p" "$1" | tail -n 1)"
    v="${v#"${v%%[![:space:]]*}"}"
    case "$v" in
      \"*) v="${v#\"}" v="${v%%\"*}" ;;
      \'*) v="${v#\'}" v="${v%%\'*}" ;;
      *) v="$(printf '%s' "$v" | sed 's/[[:space:]][[:space:]]*#.*$//; s/[[:space:]]*$//')" ;;
    esac
  fi
  printf '%s' "$v"
}

# live_container SERVICE: the id of the RUNNING container of a service of the live project (empty when none or unknown).
live_container() {
  containers_of "$COMPOSE_LIVE_PROJECT" "$1" 2>/dev/null | head -n 1 || true
}

# gm_container_joined: 0 when the Assistant GM container joined the world in its current run (its logs since its last start).
gm_container_joined() {
  local cid started
  cid="$(live_container gm-browser)"
  [ -n "$cid" ] || return 1
  started="$(docker inspect -f '{{.State.StartedAt}}' "$cid" 2>/dev/null || true)"
  [ -n "$started" ] || return 1
  [ "$(docker logs --since "$started" "$cid" 2>&1 | grep -c '\[assistant-gm\] joined world' || true)" -gt 0 ]
}

# The Kit GM browser of a kit session on a cut-over Pi is a plain container of this name (kit-session.sh), not part of the
# compose project, so the stack guards never count it as a stack container.
KIT_GM_CONTAINER=foundry-ai-tool-kit-gm-browser
kit_container_running() {
  command -v docker >/dev/null 2>&1 || return 1
  [ "$(timeout 20 docker inspect -f '{{.State.Running}}' "$KIT_GM_CONTAINER" 2>/dev/null || true)" = true ]
}
# kit_container_joined: the Kit GM container runs and logged "joined world" in its current run.
kit_container_joined() {
  local started
  kit_container_running || return 1
  started="$(docker inspect -f '{{.State.StartedAt}}' "$KIT_GM_CONTAINER" 2>/dev/null || true)"
  [ -n "$started" ] || return 1
  [ "$(docker logs --since "$started" "$KIT_GM_CONTAINER" 2>&1 | grep -c '\[assistant-gm\] joined world' || true)" -gt 0 ]
}

# Install Debian packages that are missing.
apt_install() {
  local missing=()
  for pkg in "$@"; do
    dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    say "installing ${missing[*]}"
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}" >/dev/null
  fi
}

# Files write_file changed in this run (space separated, a space on both sides), so enable_unit can tell a unit
# whose files changed from one that is only being "set up again".
LIB_CHANGED=" "
file_changed() {
  case "$LIB_CHANGED" in *" $1 "*) return 0 ;; esac
  return 1
}
# mark_changed PATH...: for a file a stage changed another way than write_file (an installed build, a copied file).
mark_changed() {
  local p
  for p in "$@"; do LIB_CHANGED="$LIB_CHANGED$p "; done
}

# Write a file only when its content changes; returns 0 when it did, 1 when it was already like that.
write_file() {
  local path="$1" mode="$2" content="$3"
  if [ -f "$path" ] && [ "$(cat "$path")" = "$content" ]; then
    ok "$path unchanged"
    return 1
  fi
  printf '%s\n' "$content" >"$path"
  chmod "$mode" "$path"
  LIB_CHANGED="$LIB_CHANGED$path "
  ok "wrote $path"
  return 0
}

# enable_unit UNIT [DEPENDENCY_FILE...]: enable the unit and make sure it runs, when systemd runs (otherwise only
# report). A unit that already runs is restarted ONLY when its own unit file changed in this run (write_file or
# mark_changed) or is newer than the running service, likewise one of the DEPENDENCY_FILEs (its EnvironmentFile,
# say), or when RESTART_UNITS=1. A rerun
# that changed nothing leaves a running service alone: a restart drops the players (Foundry) or the GM link (bridge,
# dashboard, Assistant GM) and ends a recording. A stopped unit is started.
enable_unit() {
  local unit="$1" f restart=0 reason="" started=""
  shift
  if have_systemd; then
    systemctl daemon-reload
    systemctl enable "$unit" >/dev/null 2>&1
    if ! systemctl is-active --quiet "$unit"; then
      systemctl start "$unit"
    else
      # "Changed" is this run's write_file/mark_changed, or a file written after the unit last started: a refused
      # restart (require_quiet) leaves the new file on disk, and the rerun later must still restart the service.
      started="$(unit_started_epoch "$unit")"
      for f in "/etc/systemd/system/$unit" "$@"; do
        if file_changed "$f"; then
          restart=1 reason="$f changed"
        elif [ -n "$started" ] && [ -f "$f" ] && [ "$(stat -c %Y "$f")" -gt "$started" ]; then
          restart=1 reason="$f is newer than the running service"
        fi
      done
      if [ "${RESTART_UNITS:-0}" = 1 ]; then restart=1 reason="RESTART_UNITS=1"; fi
      if [ "$restart" = 1 ]; then
        require_quiet "restarting $unit ($reason)"
        say "restarting $unit ($reason)"
        systemctl restart "$unit"
      fi
    fi
    sleep 2
    systemctl is-active --quiet "$unit" || die "$unit did not start; see: journalctl -u $unit -n 50"
    if [ "$restart" = 1 ]; then ok "$unit restarted"; else ok "$unit running (not restarted: nothing it uses changed)"; fi
  else
    warn "no systemd here (a test container?): $unit written, not started"
  fi
}

# ---- Game-night guards ----------------------------------------------------------------------------------------
# A stage that stops or restarts a service must not do it while players are online or a recording runs, and no stage
# changes the Pi without a dietpi-backup snapshot from today (pi-work rule; r37 S1 to S4, R8). FORCE=1 (in front of
# bash on the ssh line: ... | ssh foundry-pi 'FORCE=1 bash -s') overrides a refusal, with a warning.
FORCE="${FORCE:-0}"

# refuse MESSAGE: die with MESSAGE and how to override; with FORCE=1 only warn.
refuse() {
  if [ "$FORCE" = 1 ]; then
    warn "$1 (FORCE=1: going on)"
  else
    die "$1. Run this when it is quiet, or put FORCE=1 in front of bash to go on anyway"
  fi
}

# users_online: prints how many users Foundry's /api/status counts ("0" on the setup screen, which has no users
# field) and "?" when it cannot be read. Read-only.
users_online() {
  local out
  out="$(curl -fs --max-time 5 http://127.0.0.1:30000/api/status 2>/dev/null |
    "$NODE_DIR/bin/node" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const u=JSON.parse(s).users;process.stdout.write(String(Number.isInteger(u)?u:0))}catch{process.stdout.write("?")}})' 2>/dev/null)" || out="?"
  printf '%s' "${out:-?}"
}

# unit_started_epoch UNIT: prints when the unit last became active (epoch seconds), or nothing when unknown.
unit_started_epoch() {
  local ts
  ts="$(systemctl show -p ActiveEnterTimestamp --value "$1" 2>/dev/null || true)"
  [ -n "$ts" ] || return 0
  date -d "$ts" +%s 2>/dev/null || true
}

# wait_for_watching UNIT SINCE [SECONDS]: 0 when the game-night watch logged its "watching" line since SINCE (a
# "YYYY-MM-DD HH:MM:SS" time), 1 when the unit stopped first or the time ran out (default 20 s). "Running" is not
# "watching": a settings problem exits 2 within seconds and the unit stays down. The journal holds log lines (the
# Foundry host name, never a token or a full address). Read-only.
wait_for_watching() {
  local unit="$1" since="$2" secs="${3:-20}" _
  for _ in $(seq 1 "$secs"); do
    [ "$(journalctl -u "$unit" --since "$since" --no-pager -o cat 2>/dev/null | grep -c ' watching ' || true)" -gt 0 ] && return 0
    systemctl is-active --quiet "$unit" || return 1
    sleep 1
  done
  return 1
}

# restart_gamenight_watch REASON [FILE]: restarts the game-night watch (stage 29) so a changed bot env file reaches it,
# then waits for its "watching" line (a restart that stopped on exit 2 is a warning, not a success). With FILE, only
# when FILE is newer than the running watch (a rerun after a cut-off run still repairs it). It holds no recording and
# no player, so no quiet check. Does nothing without systemd or without the unit installed.
restart_gamenight_watch() {
  local reason="$1" file="${2:-}" watch_unit=foundry-ai-tool-gamenight-watch.service started since
  have_systemd && [ -f "/etc/systemd/system/$watch_unit" ] || return 0
  if [ -n "$file" ]; then
    started="$(unit_started_epoch "$watch_unit")"
    if [ -n "$started" ] && [ -f "$file" ] && [ "$(stat -c %Y "$file")" -le "$started" ]; then return 0; fi
  fi
  since="$(date '+%Y-%m-%d %H:%M:%S')"
  if ! systemctl restart "$watch_unit"; then
    warn "could not restart $watch_unit: journalctl -u $watch_unit -n 20"
  elif wait_for_watching "$watch_unit" "$since"; then
    ok "restarted $watch_unit for $reason; it is watching"
  else
    warn "restarted $watch_unit for $reason but it did not reach its 'watching' line: journalctl -u $watch_unit -n 20"
  fi
}

# recording_active [DIR]: 0 when a Discord recording seems to run: a session folder under DIR (default
# $TOOL_DATA/recordings) whose raw/ has no session.json yet (the bot writes it when the recording stops) and either
# has a file changed in the last 10 minutes or, while the bot service runs, was last changed after the bot last
# started (the bot writes nothing while nobody speaks, so a long break must not look like "no recording"; a crashed
# session from before the last start does not count). Read-only.
recording_active() {
  local dir="${1:-$TOOL_DATA/recordings}" raw since=""
  [ -d "$dir" ] || return 1
  if have_systemd && systemctl is-active --quiet foundry-ai-tool-discord-bot.service; then
    since="$(unit_started_epoch foundry-ai-tool-discord-bot.service)"
  fi
  for raw in "$dir"/*/raw; do
    [ -d "$raw" ] || continue
    # Finished: stopped cleanly (session.json), or converted after a crash (convert-report.json / convert-failed.json).
    [ -f "$raw/session.json" ] && continue
    [ -f "$raw/convert-report.json" ] && continue
    [ -f "$raw/convert-failed.json" ] && continue
    if [ -n "$(find "$raw" -type f -mmin -10 -print -quit 2>/dev/null)" ]; then return 0; fi
    if [ -n "$since" ] && [ -n "$(find "$raw" -maxdepth 0 -newermt "@$since" -print 2>/dev/null)" ]; then return 0; fi
  done
  return 1
}

# require_no_recording WHAT: refuses while a Discord recording runs (stopping or restarting the bot ends it).
require_no_recording() {
  have_systemd || return 0
  if recording_active; then
    refuse "a Discord recording is in progress (a session folder in $TOOL_DATA/recordings without session.json, written to in the last 10 minutes): $1 would end it"
  fi
}

# browser_joined UNIT: 0 when the GM browser service UNIT runs AND has joined the world in its current run (its log has
# the "joined world" line; the browser exits and systemd starts it again when the game is left, so a new run is a new
# invocation). The run is told apart by its systemd invocation id (or, when the id finds nothing, by its main PID in this boot), not by a wall-clock time (ambiguous when the clocks
# go back). A service that is active but still waiting for a world, or whose login fails, holds no Foundry user, so
# it must not be subtracted from the count of users online. Read-only. Anything that cannot be read (also a journal
# that rotated the line out) counts as "not joined": the count then errs towards refusing.
browser_joined() {
  local unit="$1" id pid
  systemctl is-active --quiet "$unit" || return 1
  id="$(systemctl show -p InvocationID --value "$unit" 2>/dev/null || true)"
  [ -n "$id" ] || return 1
  # grep -c reads everything: with pipefail, grep -q could stop early and make journalctl's SIGPIPE fail the pipeline.
  [ "$(journalctl "_SYSTEMD_INVOCATION_ID=$id" --no-pager -o cat 2>/dev/null | grep -c '\[assistant-gm\] joined world' || true)" -gt 0 ] && return 0
  # After a quick restart systemd can report an invocation id that the journal lines of the new run do not carry (seen on
  # the Pi 2026-11-17: the unit said cf157491, its lines said f434a47f), so the id finds nothing and the Assistant GM is
  # counted as a player. The main PID of a running unit is unique to the run within this boot (-b: a PID from an earlier boot can be the same
  # number, so older boots must not count), so a line this boot logged by it counts too.
  pid="$(systemctl show -p MainPID --value "$unit" 2>/dev/null || true)"
  case "$pid" in '' | 0 | *[!0-9]*) return 1 ;; esac
  [ "$(journalctl -b "_PID=$pid" "_SYSTEMD_UNIT=$unit" --no-pager -o cat 2>/dev/null | grep -c '\[assistant-gm\] joined world' || true)" -gt 0 ]
}

# gm_browsers_joined: prints how many of the two GM browsers (the Assistant GM, and the Kit GM of a kit session, which
# runs the same program) hold a Foundry user right now: 0, 1 or 2.
gm_browsers_joined() {
  local n=0 unit
  for unit in foundry-ai-tool-gm-browser.service foundry-ai-tool-kit-gm-browser.service; do
    if browser_joined "$unit"; then n=$((n + 1)); fi
  done
  # The Assistant GM as a container (after the cutover) holds a Foundry user the same way, and so does the Kit GM container.
  if gm_container_joined; then n=$((n + 1)); fi
  if kit_container_joined; then n=$((n + 1)); fi
  printf '%s' "$n"
}

# gm_browsers_pending: prints how many GM browsers (the two units, the Assistant GM container) are running but have not
# joined the world in their current run: users Foundry may count that browser_joined does not (yet). Read-only.
gm_browsers_pending() {
  local n=0 unit
  for unit in foundry-ai-tool-gm-browser.service foundry-ai-tool-kit-gm-browser.service; do
    if systemctl is-active --quiet "$unit" && ! browser_joined "$unit"; then n=$((n + 1)); fi
  done
  if [ -n "$(live_container gm-browser)" ] && ! gm_container_joined; then n=$((n + 1)); fi
  if kit_container_running && ! kit_container_joined; then n=$((n + 1)); fi
  printf '%s' "$n"
}

# foundry_answers_without_docker: 0 when Docker is installed but its daemon is silent AND something answers /api/status on
# port 30000. After the cutover a silent daemon hides the Foundry container from live_container, but with live-restore it
# may still run and hold players, so require_quiet counts them anyway.
foundry_answers_without_docker() {
  ! daemon_known || return 1
  [ "$(users_online)" != "?" ]
}

# require_quiet WHAT: call before a stage stops or restarts Foundry (WHAT names the action). Refuses while players are
# online (the Assistant GM browser counts as one user once it has joined, see browser_joined; so does the Kit GM browser of a kit session) or a recording
# runs. Does nothing without systemd; Foundry not running means no one to drop.
require_quiet() {
  local what="$1" online assistant=0
  have_systemd || return 0
  # Foundry runs as the unit, or (after the cutover) as the container of the live project.
  if systemctl is-active --quiet foundry.service || [ -n "$(live_container foundry)" ] || foundry_answers_without_docker; then
    # The two counts come from different places (Foundry's /api/status and the GM browser's journal) and change at
    # slightly different moments when a GM browser joins or leaves (Pi sitting 2026-11-10: two refusals with only the
    # Assistant GM online, the third run passed). Read them again for up to 10 s, but only while the excess users could
    # be a GM browser that is running and has not logged "joined world" yet: a count with a real player beyond that
    # refuses on the first reading. (Each read can take longer when Docker does not answer.)
    local tries=0 pending=0
    while :; do
      online="$(users_online)"
      case "$online" in '' | *[!0-9]*) online="?" ;; esac
      assistant="$(gm_browsers_joined)"
      [ "$online" != "?" ] || break
      [ "$online" -gt "$assistant" ] || break
      # A silent Docker daemon makes every read below wait out its timeout: no retry loop then, the refusal comes at once.
      daemon_known || break
      pending="$(gm_browsers_pending)"
      [ "$((online - assistant))" -le "$pending" ] || break
      [ "$tries" -lt 5 ] || break
      tries=$((tries + 1))
      say "$((online - assistant)) more user(s) than joined GM browsers online: a GM browser may be joining, reading again ($tries of 5)"
      sleep 2
    done
    if [ "$online" = "?" ]; then
      refuse "cannot read who is online in Foundry (/api/status on port 30000), so $what is not safe"
    elif [ "$online" -gt "$assistant" ]; then
      refuse "$((online - assistant)) player(s) are online in Foundry: $what would drop them"
    fi
  fi
  require_no_recording "$what"
}

# require_quiet_if_active UNIT WHAT: require_quiet, but only when UNIT runs (a stopped unit is just started, which
# drops no one). For the helper scripts the user runs, which restart one service after writing a settings file: they
# call it before asking for anything, so a refusal comes before a token is pasted.
require_quiet_if_active() {
  have_systemd || return 0
  systemctl is-active --quiet "$1" || return 0
  require_quiet "$2"
}

# require_recent_snapshot: refuses unless a dietpi-backup snapshot COMPLETED today: the last "Backup completed" line
# in /mnt/dietpi-backup/.dietpi-backup_stats (format "2026-10-18_09:46:24  Backup completed"; the file's mtime is not
# used, a started, cancelled or restore run touches it too). The nightly one at 01:25 counts. Skipped off DietPi (a
# test container). Take one with: /boot/dietpi/dietpi-backup 1
# It has its own switch, NO_SNAPSHOT=1, so a new Pi (stages 1 to 4, no snapshot yet) does not need FORCE=1, which
# would also switch off the players and recording checks. FORCE=1 does not skip this check.
require_recent_snapshot() {
  local stats="${DIETPI_BACKUP_STATS:-/mnt/dietpi-backup/.dietpi-backup_stats}" last="" last_when day
  if [ ! -d "${DIETPI_DIR:-/boot/dietpi}" ]; then
    warn "not DietPi (a test container?): the snapshot check is skipped"
    return 0
  fi
  if [ -f "$stats" ]; then last="$(grep 'Backup completed' "$stats" | tail -n 1 || true)"; fi
  day="$(date +%F)"
  last_when="${last%% *}"
  case "$last" in
    "${day}_"*)
      ok "dietpi-backup snapshot from today ($last_when)"
      return 0
      ;;
  esac
  if [ "${NO_SNAPSHOT:-0}" = 1 ]; then
    warn "no dietpi-backup snapshot from today (last completed: ${last_when:-none}); NO_SNAPSHOT=1: going on without one"
    return 0
  fi
  die "no dietpi-backup snapshot completed today (last: ${last_when:-none}). Take one first: /boot/dietpi/dietpi-backup 1 (a brand-new Pi with nothing to lose: put NO_SNAPSHOT=1 in front of bash)"
}

# require_snapshot_after FILE: refuses unless the last completed dietpi-backup snapshot is newer than FILE's mtime (stage 14
# MODE=switch: the snapshot taken after the trial began, since a switch has no undo but restoring it). No NO_SNAPSHOT
# switch. Skipped off DietPi (a test container). Same stats file and format as require_recent_snapshot.
require_snapshot_after() {
  local stats="${DIETPI_BACKUP_STATS:-/mnt/dietpi-backup/.dietpi-backup_stats}" last="" last_when="" snap_epoch="" file_epoch=""
  [ -d "${DIETPI_DIR:-/boot/dietpi}" ] || return 0
  if [ -f "$stats" ]; then last="$(grep 'Backup completed' "$stats" | tail -n 1 || true)"; fi
  last_when="${last%% *}"
  [ -z "$last_when" ] || snap_epoch="$(date -d "${last_when/_/ }" +%s 2>/dev/null || true)"
  file_epoch="$(stat -c %Y "$1" 2>/dev/null || true)"
  [[ "$snap_epoch" =~ ^[0-9]+$ && "$file_epoch" =~ ^[0-9]+$ ]] || die "cannot compare the last snapshot (${last_when:-none}) with $1. Take one first: /boot/dietpi/dietpi-backup 1. Nothing was changed"
  [ "$snap_epoch" -gt "$file_epoch" ] || die "the last dietpi-backup snapshot ($last_when) is older than $1: take one now (/boot/dietpi/dietpi-backup 1), since this step has no undo but restoring it. Nothing was changed"
  ok "dietpi-backup snapshot from after the trial began ($last_when)"
}

# warn_dashboard_split: the co-GM dashboard treats every caller as the GM until GM_DASHBOARD_TOKEN or GM_EMAILS is set
# (by set-dashboard-access.sh, in $TOOL_ETC/dashboard-access.env). Without them everyone who reaches port 3000 (over
# Tailscale or the tunnel) sees the GM view. Reads names only, never values. Returns 0 when the split is on.
warn_dashboard_split() {
  local f="$TOOL_ETC/dashboard-access.env"
  if [ -f "$f" ] && grep -Eq '^(GM_DASHBOARD_TOKEN|GM_EMAILS)=.+' "$f"; then
    ok "dashboard player/GM split is on ($f sets a GM token or GM emails)"
    return 0
  fi
  warn "the dashboard player/GM split is OFF: $f has no GM_DASHBOARD_TOKEN or GM_EMAILS, so everyone who reaches port 3000 (Tailscale, the tunnel) is treated as the GM and sees spoilers. Run scripts/pi/remote/set-dashboard-access.sh in your own SSH session (docs/dev/REMOTE-ACCESS.md, Part C, step 10)"
  return 1
}

# ---- Writes into folders the foundry user owns --------------------------------------------------------
# Root must not write there: a link the foundry user left at the destination (or at a temp name) would make root
# write over any file, and a chown would hand it to the foundry user. These two helpers run the write as the foundry
# user, to a temp file next to the target (same mode) that is renamed over it, so a failure never leaves a half file
# and the target keeps its mode (its owner becomes the foundry user). The temp name is <target>.foundry-tmp; a leftover or a link there is
# removed first. $NODE_DIR/bin/node must exist (check it up front).

# True when the foundry user can write in directory $1 (read-only check, for the up-front refusals).
foundry_can_write() {
  runuser -u "$FOUNDRY_USER" -- test -w "$1"
}

# foundry_edit_json FILE JS [ARG...]: edits the JSON file as the foundry user. JS is the body of a function of
# (o, a): o is the parsed object (change it in place), a the ARGs. Example:
#   foundry_edit_json "$options" 'o.world = a[0] || null' "$world"
foundry_edit_json() {
  local file="$1" body="$2"
  shift 2
  runuser -u "$FOUNDRY_USER" -- "$NODE_DIR/bin/node" -e 'const fs=require("fs");const [p,body,...a]=process.argv.slice(1);const st=fs.statSync(p);const o=JSON.parse(fs.readFileSync(p,"utf8"));new Function("o","a",body)(o,a);const t=p+".foundry-tmp";fs.rmSync(t,{force:true});fs.writeFileSync(t,JSON.stringify(o,null,2)+"\n",{mode:st.mode&0o777});fs.chmodSync(t,st.mode&0o777);fs.renameSync(t,p)' "$file" "$body" "$@"
}

# foundry_copy_file SRC DST: copies a file as the foundry user (cp -a, so mode and times are kept), through a temp
# file and a rename. Used for the saved copy of options.json and for putting it back.
foundry_copy_file() {
  runuser -u "$FOUNDRY_USER" -- sh -c 't="$2.foundry-tmp"; rm -f "$t" && cp -a "$1" "$t" && mv -f "$t" "$2"' sh "$1" "$2"
}

# control_port_check [PORT]: the bridge's control port (default 31414), which the Cloudflare TCP route
# (D-095, mcp.<domain>) points at. It has no login of its own, so it must listen on loopback only (the Pi's own tailscale interface counts as private, it is the user's tailnet).
# Returns 0 = answers a ping on loopback and nothing listens beyond loopback, 1 = no ping answer,
# 2 = a listener beyond loopback (checked first). Read-only.
control_port_check() {
  local port="${1:-31414}" listeners reply=""
  listeners="$(ss -ltnH "sport = :$port" 2>/dev/null | awk '{print $4}' || true)"
  # A listener bound to the Pi's own tailscale interface (ss prints it as 100.x.y.z%tailscale0:PORT, and the IPv6 tailnet
  # address as [fd7a:...]%tailscale0:PORT) is reachable only from the user's tailnet, which the user trusts (stage 4), so
  # it is not a listener "beyond loopback". Only that interface scope counts, not the address range.
  if [ -n "$listeners" ] && printf '%s\n' "$listeners" | grep -qvE '^(127\.0\.0\.1|\[::1\]|[0-9.]+%tailscale[0-9]*|\[[0-9a-f:]+\]%tailscale[0-9]*):'; then
    return 2
  fi
  reply="$( { exec 3<>"/dev/tcp/127.0.0.1/$port"; printf '{"id":"ping","method":"ping"}\n' >&3; IFS= read -r -t 5 -u 3 line; printf '%s' "${line:-}"; } 2>/dev/null )" || true
  case "$reply" in *'"ok":true'*) return 0 ;; esac
  return 1
}
