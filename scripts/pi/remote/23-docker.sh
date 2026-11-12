#!/usr/bin/env bash
# Stage 23: Docker on the Pi, and the images for deploy/pi/compose.yml (backlog pi-docker-compose). It installs the
# engine, builds the images and writes the compose settings file. It does NOT start the stack and does not touch a
# running service: stage 24 (MODE=up on rehearsal ports) does that, after its own snapshot and OK.
#
# Run it only after a dietpi-backup snapshot from today (/boot/dietpi/dietpi-backup 1) and the user's OK (pi-work skill):
# it installs packages and builds for some minutes, which is heavy on a Pi that may be hosting a session.
#
# Packages, from Debian 13 (trixie) itself, not Docker's own apt repository, so nothing is added to /etc/apt:
#   docker.io        the engine (trixie: 26.1.x), pulls in containerd, runc and iptables
#   docker-compose-v2 or docker-compose
#                    the compose plugin ("docker compose"). Debian 13 ships the Go rewrite as `docker-compose` (2.26.x, with the
#                    CLI plugin under /usr/libexec/docker/cli-plugins); Ubuntu calls the same thing `docker-compose-v2`. The stage
#                    takes whichever name has an install candidate, `docker-compose-v2` first. deploy/pi/compose.test.yml
#                    and the env_file "required: false" syntax need Compose 2.24 or newer: the stage checks it.
#   docker-buildx    BuildKit front end for `docker compose build` (the Dockerfile has multi-stage targets); installed when
#                    the archive has it.
# No user is added to the docker group (root runs every stage), docker's data root stays /var/lib/docker (on the NVMe,
# like /), nothing is removed, nothing reboots. Docker adds a docker0 bridge and iptables rules for it; the containers
# use network_mode: host, so the host's ports and Tailscale serve are unchanged. Three side effects to know about:
#   - /etc/docker/daemon.json gets "live-restore": true when it does not exist yet (containers survive a daemon restart,
#     for example a docker.io upgrade); an existing file is only checked;
#   - Docker sets the iptables FORWARD policy to DROP. Nothing on the Pi forwards traffic today (host networking);
#     a future router or VPN exit role has to allow forwarding itself;
#   - /var/lib/docker (images, layers, container logs, a few GB) is part of the root file system, so the nightly
#     dietpi-backup snapshot includes it. Nothing under it is needed to restore: stage 23 rebuilds the images.
#
# What it does, in order, stopping at the first failure:
#   1. checks the deployed checkout ($TOOL_DIR/app, built by stage 5) has deploy/pi/compose.yml and the foundry user exists;
#   2. installs the missing packages and checks `docker compose version` is 2.24 or newer;
#   3. enables docker.service (a running daemon is left alone) and waits for `docker info`;
#   4. writes deploy/pi/.env in that checkout: FOUNDRY_UID and FOUNDRY_GID (the foundry user's ids),
#      DASHBOARD_ALLOWED_HOSTS (the Pi's tailnet name, found the way stage 5 finds it, else from the dashboard unit) and
#      FOUNDRY_AI_PLAYER_VAULTS_DIR (from stage 21's dashboard drop-in; empty when stage 21 has not run).
#      Other lines already in the file (a rehearsal's ports, say) are kept; the four names are rewritten;
#   5. builds the images: `docker compose -f deploy/pi/compose.yml build` in the checkout (log: $TOOL_DIR/docker-build.log).
# Safe to run again: the packages are checked first, an unchanged .env is left alone, and a build that finds its layers
# cached takes seconds. Stage 5 refuses on a cut-over Pi, so a new stage 5 build (which replaces the checkout and with it
# the .env) only happens on the units: after stage 24 MODE=rollback, a new stage 5, run this stage again before the next cutover.
#
# Modes (environment, before bash):
#   DRY_RUN=1     print what a real run would do (packages, .env content, build); changes nothing, needs no snapshot
#   SKIP_BUILD=1  install and write the .env, build nothing
# These lines are bash (Git Bash, or Claude's Bash tool), not PowerShell:
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/23-docker.sh | ssh foundry-pi 'DRY_RUN=1 bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/23-docker.sh | ssh foundry-pi 'bash -s'
# Tests only: TOOL_CHECKOUT points at a stand-in checkout, DASHBOARD_UNIT at a stand-in dashboard unit file,
# PLAYER_VAULT_DROPIN at a stand-in stage 21 drop-in, DOCKER_DAEMON_JSON at a stand-in /etc/docker/daemon.json.

dry="${DRY_RUN:-0}"
skip_build="${SKIP_BUILD:-0}"
checkout="${TOOL_CHECKOUT:-$TOOL_DIR/app}"
compose_dir="$checkout/deploy/pi"
compose_file="$compose_dir/compose.yml"
env_file="$compose_dir/.env"
dash_unit="${DASHBOARD_UNIT:-/etc/systemd/system/foundry-ai-tool-dashboard.service}"
player_dropin="${PLAYER_VAULT_DROPIN:-/etc/systemd/system/foundry-ai-tool-dashboard.service.d/player-vault.conf}"
build_log="$TOOL_DIR/docker-build.log"
daemon_json="${DOCKER_DAEMON_JSON:-/etc/docker/daemon.json}"
min_compose=2.24.0

require_root
# Over a non-login ssh the sbin folders may not be on PATH.
PATH="$PATH:/usr/sbin:/sbin"

say "the deployed checkout"
[ -f "$compose_file" ] || die "$compose_file is missing: the tool release stage 5 built is older than the Docker files. Run stage 5 with a TOOL_REF that has deploy/pi (a tag or branch with compose.yml). Nothing was changed"
[ -f "$compose_dir/Dockerfile" ] || die "$compose_dir/Dockerfile is missing (see above). Nothing was changed"
ok "$compose_file"
uid="$(id -u "$FOUNDRY_USER" 2>/dev/null || true)"
gid="$(id -g "$FOUNDRY_USER" 2>/dev/null || true)"
case "$uid$gid" in
  '' | *[!0-9]*) die "the $FOUNDRY_USER user does not exist: run stage 1 first. Nothing was changed" ;;
esac

# The Pi's tailnet name, for the dashboard's DNS rebinding guard. Same source as stage 5 (tailscale status); when Tailscale
# does not answer, the value stage 5 wrote into the dashboard unit.
tailnet_name() {
  local n="" json
  if command -v tailscale >/dev/null 2>&1 && json="$(tailscale status --json 2>/dev/null)" && [ -n "$json" ]; then
    if [ -x "$NODE_DIR/bin/node" ]; then
      n="$(printf '%s' "$json" | "$NODE_DIR/bin/node" -e \
        'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const n=JSON.parse(s).Self?.DNSName||"";process.stdout.write(n.replace(/\.$/,""))})' 2>/dev/null || true)"
    else
      # Self comes before Peer in tailscale's JSON, so the first DNSName is the Pi's own.
      n="$(printf '%s' "$json" | sed -n 's/.*"DNSName": *"\([^"]*\)".*/\1/p' | head -n 1 | sed 's/\.$//')"
    fi
  fi
  if [ -z "$n" ] && [ -f "$dash_unit" ]; then
    n="$(sed -n 's/^Environment=DASHBOARD_ALLOWED_HOSTS=//p' "$dash_unit" | head -n 1)"
  fi
  # A host list is names; anything else would end up in an env file.
  case "$n" in *[!A-Za-z0-9.,_-]*) n="" ;; esac
  printf '%s' "$n"
}

# The player vaults folder stage 21 put into the dashboard unit's drop-in (the compose dashboard has no drop-in).
player_vaults_dir() {
  local v=""
  if [ -f "$player_dropin" ]; then
    v="$(sed -n 's/^Environment=FOUNDRY_AI_PLAYER_VAULTS_DIR=//p' "$player_dropin" | head -n 1)"
  fi
  # A path; anything else would end up in an env file.
  case "$v" in *[!A-Za-z0-9/._-]*) v="" ;; esac
  printf '%s' "$v"
}

# The .env content: the four managed names first, then whatever else the file already held (comments of ours dropped).
build_env_content() {
  local hosts="$1" kept="" vaults
  vaults="$(player_vaults_dir)"
  if [ -f "$env_file" ]; then
    kept="$(grep -vE '^(#|[[:space:]]*$|FOUNDRY_UID=|FOUNDRY_GID=|DASHBOARD_ALLOWED_HOSTS=|FOUNDRY_AI_PLAYER_VAULTS_DIR=)' "$env_file" || true)"
  fi
  printf '%s\n' "# Written by scripts/pi/remote/23-docker.sh (rewritten on every run; other lines are kept). No secrets here."
  printf '%s\n' "FOUNDRY_UID=$uid" "FOUNDRY_GID=$gid" "DASHBOARD_ALLOWED_HOSTS=$hosts" "FOUNDRY_AI_PLAYER_VAULTS_DIR=$vaults"
  if [ -n "$kept" ]; then printf '%s\n' "$kept"; fi
}

# The first package of the list that has an install candidate in the archive.
pick_package() {
  local p cand
  for p in "$@"; do
    cand="$(apt-cache policy "$p" 2>/dev/null | sed -n 's/^ *Candidate: //p' | head -n 1)"
    if [ -n "$cand" ] && [ "$cand" != "(none)" ]; then
      printf '%s' "$p"
      return 0
    fi
  done
  return 1
}

compose_version() {
  docker compose version --short 2>/dev/null | sed 's/^v//' | head -n 1
}
version_ok() { # $1 version, true when at least $min_compose
  [ -n "$1" ] && [ "$(printf '%s\n%s\n' "$min_compose" "$1" | sort -V | head -n 1)" = "$min_compose" ]
}

hosts="$(tailnet_name)"
[ -n "$hosts" ] || warn "no tailnet name found (Tailscale does not answer and the dashboard unit has none): DASHBOARD_ALLOWED_HOSTS stays empty, so the dashboard answers loopback names only"
env_content="$(build_env_content "$hosts")"

if [ "$dry" = 1 ]; then
  say "dry run: nothing is changed"
  if command -v docker >/dev/null 2>&1; then
    echo "    docker: $(docker --version 2>/dev/null || echo present), compose: $(compose_version || true)"
  else
    echo "    docker: not installed"
  fi
  echo "    packages a real run installs when missing: docker.io, $(pick_package docker-compose-v2 docker-compose || echo '(no compose package has a candidate: apt-get update first)'), docker-buildx"
  if [ ! -e "$daemon_json" ]; then echo "    would write $daemon_json: live-restore true"; else echo "    $daemon_json exists: checked, not rewritten"; fi
  echo "    would write $env_file:"
  printf '%s\n' "$env_content" | sed 's/^/      /'
  if [ "$skip_build" = 1 ]; then echo "    SKIP_BUILD=1: no build"; else echo "    would build: docker compose -f deploy/pi/compose.yml build (in $checkout)"; fi
  exit 0
fi

require_recent_snapshot

say "Docker packages"
if ! command -v docker >/dev/null 2>&1 || ! dpkg -s docker.io >/dev/null 2>&1 || ! version_ok "$(compose_version)"; then
  # Refresh the package lists only when the archive's candidates are unknown or missing.
  if ! pick_package docker-compose-v2 docker-compose >/dev/null || [ -z "$(apt-cache policy docker.io 2>/dev/null | sed -n 's/^ *Candidate: //p')" ]; then
    say "apt-get update"
    DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null || die "apt-get update failed (network?). Nothing else was changed"
  fi
  compose_pkg="$(pick_package docker-compose-v2 docker-compose)" ||
    die "neither docker-compose-v2 nor docker-compose has an install candidate on this Debian: check /etc/apt/sources.list. Nothing was changed"
  pkgs=(docker.io "$compose_pkg")
  if pick_package docker-buildx >/dev/null; then pkgs+=(docker-buildx); fi
  apt_install "${pkgs[@]}"
fi
command -v docker >/dev/null 2>&1 || die "docker is not on PATH after the install"
version_ok "$(compose_version)" || die "docker compose is '$(compose_version)'; $min_compose or newer is needed (deploy/pi/compose.yml uses env_file required: false)"
ok "$(docker --version 2>/dev/null), compose $(compose_version)"

say "live-restore"
# With live-restore the containers keep running while the daemon restarts (a docker.io upgrade restarts it). Written only
# when there is no daemon.json yet; an existing file is never rewritten, only checked.
if [ ! -e "$daemon_json" ]; then
  install -d -m 0755 "$(dirname "$daemon_json")" || die "cannot create $(dirname "$daemon_json")"
  # Written to a .new file, checked and moved into place: a short write never leaves a daemon.json that dockerd cannot
  # parse (it refuses to start on one), and a rerun finds no file and writes it again.
  daemon_new="$daemon_json.new"
  if ! printf '{\n  "live-restore": true\n}\n' >"$daemon_new" 2>/dev/null || ! chmod 0644 "$daemon_new" ||
    ! grep -q '"live-restore"[[:space:]]*:[[:space:]]*true' "$daemon_new" 2>/dev/null || ! grep -q '}' "$daemon_new"; then
    rm -f -- "$daemon_new" || true
    die "$daemon_new could not be written completely: live-restore is not set. Nothing else was changed"
  fi
  mv -- "$daemon_new" "$daemon_json" || { rm -f -- "$daemon_new" || true; die "cannot move $daemon_new to $daemon_json"; }
  # Read the moved file back: if it is not what was checked, remove it so dockerd is not left with a broken file.
  if ! grep -q '"live-restore"[[:space:]]*:[[:space:]]*true' "$daemon_json" 2>/dev/null || ! grep -q '}' "$daemon_json"; then
    rm -f -- "$daemon_json" || true
    die "$daemon_json is missing or incomplete after the move: removed it; live-restore is not set"
  fi
  LIB_CHANGED="$LIB_CHANGED$daemon_json "
  ok "wrote $daemon_json"
  if have_systemd && systemctl is-active --quiet docker.service 2>/dev/null; then
    systemctl reload docker.service >/dev/null 2>&1 || warn "systemctl reload docker.service failed: live-restore applies at the next daemon restart"
    # Read it back: a reload that did not take leaves containers to restart with the daemon. The daemon applies the
    # reload asynchronously, so ask a few times before giving up.
    live_restore=""
    for _ in 1 2 3 4 5; do
      live_restore="$(timeout 10 docker info -f '{{.LiveRestoreEnabled}}' 2>/dev/null || true)"
      [ "$live_restore" = true ] && break
      sleep 1
    done
    if [ "$live_restore" = true ]; then
      ok "live-restore is on (docker info)"
    else
      warn "docker info reports LiveRestoreEnabled='${live_restore:-unknown}' after the reload: it applies at the next daemon restart"
    fi
  fi
elif grep -q '"live-restore"[[:space:]]*:[[:space:]]*true' "$daemon_json"; then
  ok "$daemon_json already sets live-restore"
else
  warn "$daemon_json exists without \"live-restore\": true; add it by hand so a docker.io upgrade does not restart every container"
fi

say "docker.service"
enable_unit docker.service
if have_systemd; then
  i=0
  until docker info >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -le 30 ] || die "the Docker daemon does not answer (docker info); see: journalctl -u docker -n 50"
    sleep 1
  done
  ok "the daemon answers"
else
  warn "no systemd here (a test container?): the daemon is not started or checked"
fi

say "$env_file"
write_file "$env_file" 0644 "$env_content" || true

if [ "$skip_build" = 1 ]; then
  ok "SKIP_BUILD=1: images not built"
  exit 0
fi

say "the images (a few minutes the first time)"
require_quiet "building the images (a long build can starve Foundry)"
if ! (cd "$checkout" && docker compose -f deploy/pi/compose.yml build) >"$build_log" 2>&1; then
  tail -n 40 "$build_log" >&2
  die "the image build failed (full log: $build_log). Nothing was started; the systemd units are as they were"
fi
images="$(cd "$checkout" && docker compose -f deploy/pi/compose.yml config --images 2>/dev/null || true)"
[ -n "$images" ] || die "docker compose lists no images for $compose_file"
for img in $images; do
  docker image inspect "$img" >/dev/null 2>&1 || die "image $img is missing after the build (log: $build_log)"
  ok "image $img"
done
ok "stage 23 done; nothing was started. Next: stage 24 (MODE=up on rehearsal ports first, then MODE=cutover; deploy/pi/README.md, Cutover and rollback)"
