#!/usr/bin/env bash
# Pi stage 23 (scripts/pi/remote/23-docker.sh, Docker and the images for deploy/pi/compose.yml) in a Debian 13 ARM64
# container with the real lib.sh and stand-ins for apt, dpkg, docker, systemctl, tailscale and id. Everything the stage writes
# goes into a sandbox folder (lib.sh's paths are pointed there after it is sourced), so the scenarios change nothing outside
# /tmp and also run in Git Bash. Each scenario starts from a fresh fake Pi; the last line is ALL SCENARIOS OK when every one passed:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" debian:13-slim bash /repo/scripts/pi/container-test/stage23-scenarios.sh
# (scripts/pi/docker-compose.test.mjs runs it with PI_STAGE23_CONTAINER=1.) STAGE=<file> runs it against another copy of the script.
# Scenarios: dry run; refusals (no compose.yml in the checkout, no snapshot, no foundry user); a first run on trixie names
# (docker.io, docker-compose, docker-buildx) with the .env, the build and no start; a second run; extra .env lines kept; the
# compose-v2 name preferred; apt-get update only without candidates; Compose too old; a failing build; SKIP_BUILD; the node
# and unit-file sources of the tailnet name; no group change for any user.
set -uo pipefail

REPO="${REPO:-/repo}"
STAGE="${STAGE:-$REPO/scripts/pi/remote/23-docker.sh}"
LIB="$REPO/scripts/pi/remote/lib.sh"
fails=0
pass() { echo "ok: $*"; }
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }

root="$(mktemp -d)"
trap 'rm -rf "${root:?}"' EXIT

# A fresh fake Pi in $SB: stand-in commands in $BIN, state in $FAKE, the tool checkout, DietPi's snapshot stats.
new_pi() { # opts: nocompose, nosnapshot, nouser, v2
  SB="$root/pi.$((++n))"
  BIN="$SB/bin"
  FAKE="$SB/fake"
  mkdir -p "$BIN" "$FAKE/pkgs" "$SB/tool/app/deploy/pi" "$SB/dietpi" "$SB/etc"
  : >"$FAKE/calls"
  if [[ " $* " != *" nocompose "* ]]; then
    : >"$SB/tool/app/deploy/pi/compose.yml"
    : >"$SB/tool/app/deploy/pi/Dockerfile"
  fi
  if [[ " $* " == *" nosnapshot "* ]]; then
    echo "2020-01-01_01:25:00  Backup completed" >"$SB/stats"
  else
    echo "$(date +%F)_01:25:00  Backup completed" >"$SB/stats"
  fi
  if [[ " $* " == *" v2 "* ]]; then
    printf '%s\n' docker.io docker-compose-v2 docker-compose docker-buildx >"$FAKE/candidates"
  else
    printf '%s\n' docker.io docker-compose docker-buildx >"$FAKE/candidates"
  fi
  [[ " $* " != *" nouser "* ]] && echo 996 >"$FAKE/uid"
  echo 2.26.1 >"$FAKE/compose_version"
  write_stubs
}

write_stubs() {
  # Every stand-in logs its call line to $FAKE/calls.
  stub() { printf '#!/usr/bin/env bash\nF="%s"\necho "%s $*" >>"$F/calls"\n%s\n' "$FAKE" "$1" "$2" >"$BIN/$1"; chmod +x "$BIN/$1"; }
  stub id '
case "$*" in
  "-u") echo 0 ;;
  "-u foundry") [ -f "$F/uid" ] && cat "$F/uid" || exit 1 ;;
  "-g foundry") [ -f "$F/uid" ] && cat "$F/uid" || exit 1 ;;
  *) /usr/bin/id "$@" ;;
esac'
  stub dpkg '[ "$1" = -s ] && [ -f "$F/pkgs/$2" ]'
  stub apt-cache '
if [ "$1" = policy ]; then
  if grep -qx "$2" "$F/candidates" 2>/dev/null; then echo "$2:"; echo "  Installed: (none)"; echo "  Candidate: 1.2.3-1"; else echo "N: Unable to locate package $2" >&2; fi
fi'
  stub apt-get '
case "$1" in
  update) [ ! -f "$F/candidates_after_update" ] || cp "$F/candidates_after_update" "$F/candidates" ;;
  install)
    for a in "$@"; do
      case "$a" in -*|install) continue ;; esac
      touch "$F/pkgs/$a"
    done
    cp "$F/docker-stub" "$(dirname "$0")/docker"
    touch "$F/active-docker.service"
    ;;
esac'
  stub systemctl '
u=""; for a in "$@"; do case "$a" in *.service) u="$a" ;; esac; done
case "$1" in
  is-active) [ -f "$F/active-$u" ] && { [ "$2" = --quiet ] || echo active; exit 0; } || { [ "$2" = --quiet ] || echo inactive; exit 3; } ;;
  start|restart) touch "$F/active-$u" ;;
  show) ;;
esac
exit 0'
  stub tailscale '
[ -f "$F/no-tailscale" ] && exit 1
if [ "$1" = status ] && [ "$2" = --json ]; then
  printf "{\n  \"Self\": {\n    \"DNSName\": \"pi.tail1234.ts.net.\",\n    \"HostName\": \"pi\"\n  },\n  \"Peer\": {\n    \"x\": {\n      \"DNSName\": \"pc.tail1234.ts.net.\"\n    }\n  }\n}\n"
fi
exit 0'
  # The docker stand-in is kept apart: apt-get "installs" it by copying it to bin/ (so "docker not installed" is real).
  printf '#!/usr/bin/env bash\nF="%s"\nSBX="%s"\n' "$FAKE" "$SB" >"$FAKE/docker-stub"
  cat >>"$FAKE/docker-stub" <<'EOF'
echo "docker $*" >>"$F/calls"
case "$1" in
  --version) echo "Docker version 26.1.5, build 1234" ;;
  info) [ ! -f "$F/daemon-down" ] ;;
  image) [ "$2" = inspect ] && [ -f "$F/images/$3" ] ;;
  compose)
    shift
    [ "$1" = version ] && { cat "$F/compose_version"; exit 0; }
    shift 2 # -f FILE
    case "$1" in
      build)
        [ ! -f "$F/build-fail" ] || { echo "build error: something broke"; exit 1; }
        mkdir -p "$F/images"
        for i in foundry-ai-tool-pi/foundry:local foundry-ai-tool-pi/app:local foundry-ai-tool-pi/gm-browser:local; do mkdir -p "$F/images/$(dirname "$i")"; touch "$F/images/$i"; done
        ;;
      config) printf 'foundry-ai-tool-pi/foundry:local\nfoundry-ai-tool-pi/app:local\nfoundry-ai-tool-pi/gm-browser:local\n' ;;
      up) echo "STARTED" >>"$F/calls" ;;
    esac
    ;;
esac
EOF
  chmod +x "$FAKE/docker-stub"
}

# Runs the stage in a sandbox; env assignments as arguments. Output and "rc=N" go to $OUT and $RC.
run_stage() {
  local f="$SB/run.sh" kv
  {
    cat "$LIB"
    printf '%s\n' "have_systemd() { return 0; }" "sleep() { :; }" \
      "TOOL_DIR=$SB/tool" "TOOL_ETC=$SB/etc" "TOOL_DATA=$SB/data" "NODE_DIR=$SB/node24"
    cat "$STAGE"
  } >"$f"
  OUT="$(
    for kv in "$@"; do export "${kv?}"; done
    export PATH="$BIN:$PATH" DIETPI_DIR="$SB/dietpi" DIETPI_BACKUP_STATS="$SB/stats" DASHBOARD_UNIT="$SB/etc/dashboard.service"
    bash "$f" 2>&1
  )"
  RC=$?
  CALLS="$(cat "$FAKE/calls")"
}
envf() { echo "$SB/tool/app/deploy/pi/.env"; }
n=0

# 1. dry run
new_pi
run_stage DRY_RUN=1
if [ "$RC" -eq 0 ] && echo "$OUT" | grep -q 'dry run' && echo "$OUT" | grep -q 'docker.io' && [ ! -e "$(envf)" ] &&
  ! echo "$CALLS" | grep -qE 'apt-get (install|update)|compose.* build'; then pass "dry run prints the plan and changes nothing"; else fail "dry run (rc $RC): $OUT"; fi

# 2. refusals
new_pi nocompose
run_stage
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'compose.yml is missing' && ! echo "$CALLS" | grep -q apt-get; then pass "no compose.yml in the checkout is refused"; else fail "nocompose (rc $RC): $OUT"; fi
new_pi nosnapshot
run_stage
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'no dietpi-backup snapshot' && ! echo "$CALLS" | grep -q apt-get && [ ! -e "$(envf)" ]; then pass "no snapshot from today: nothing installed or written"; else fail "nosnapshot (rc $RC): $OUT"; fi
new_pi nouser
run_stage
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'foundry user does not exist' && ! echo "$CALLS" | grep -q apt-get; then pass "no foundry user is refused"; else fail "nouser (rc $RC): $OUT"; fi

# 3. first run on trixie names
new_pi
run_stage
if [ "$RC" -eq 0 ]; then pass "first run exits 0"; else fail "first run (rc $RC): $OUT"; fi
if [ -f "$FAKE/pkgs/docker.io" ] && [ -f "$FAKE/pkgs/docker-compose" ] && [ -f "$FAKE/pkgs/docker-buildx" ] && [ ! -f "$FAKE/pkgs/docker-compose-v2" ]; then
  pass "installs docker.io, docker-compose and docker-buildx (trixie names)"
else
  fail "packages: $(ls "$FAKE/pkgs")"
fi
if ! echo "$CALLS" | grep -q 'apt-get update'; then pass "no apt-get update when the candidates are known"; else fail "apt-get update ran: $CALLS"; fi
if grep -qx 'FOUNDRY_UID=996' "$(envf)" && grep -qx 'FOUNDRY_GID=996' "$(envf)" && grep -qx 'DASHBOARD_ALLOWED_HOSTS=pi.tail1234.ts.net' "$(envf)"; then
  pass ".env has the foundry ids and the tailnet name (Self, not the peer)"
else
  fail ".env: $(cat "$(envf)")"
fi
if echo "$CALLS" | grep -q 'docker compose -f deploy/pi/compose.yml build' && ! echo "$CALLS" | grep -qE 'STARTED|compose.* (up|down|start)'; then pass "builds the images and starts nothing"; else fail "calls: $CALLS"; fi
if echo "$CALLS" | grep -q 'systemctl enable docker.service' && ! echo "$CALLS" | grep -qE 'usermod|adduser|gpasswd|groupadd'; then pass "enables docker.service, changes no user"; else fail "calls: $CALLS"; fi
if echo "$OUT" | grep -q 'image foundry-ai-tool-pi/app:local'; then pass "reports each built image"; else fail "images: $OUT"; fi

# 4. second run: nothing to install, .env unchanged
before="$(cat "$(envf)")"
: >"$FAKE/calls"
run_stage
if [ "$RC" -eq 0 ] && ! echo "$CALLS" | grep -qE 'apt-get (install|update)' && echo "$OUT" | grep -q 'unchanged' && [ "$(cat "$(envf)")" = "$before" ]; then
  pass "a second run installs nothing and leaves the .env alone"
else
  fail "rerun (rc $RC): $OUT"
fi

# 5. extra .env lines are kept, the three names are rewritten
printf 'FOUNDRY_UID=1\nFOUNDRY_HTTP_PORT=30100\n# an old comment\nDASHBOARD_ALLOWED_HOSTS=old.example\n' >"$(envf)"
run_stage
if [ "$RC" -eq 0 ] && grep -qx 'FOUNDRY_HTTP_PORT=30100' "$(envf)" && grep -qx 'FOUNDRY_UID=996' "$(envf)" && ! grep -q 'old.example' "$(envf)" &&
  [ "$(grep -c '^FOUNDRY_UID=' "$(envf)")" = 1 ]; then pass "other .env lines are kept, the managed names rewritten once"; else fail "keep (rc $RC): $(cat "$(envf)")"; fi

# 6. compose-v2 name preferred; apt-get update only without candidates
new_pi v2
run_stage
if [ "$RC" -eq 0 ] && [ -f "$FAKE/pkgs/docker-compose-v2" ] && [ ! -f "$FAKE/pkgs/docker-compose" ]; then pass "docker-compose-v2 is preferred when the archive has it"; else fail "v2 (rc $RC): $OUT"; fi
new_pi
: >"$FAKE/candidates"
printf '%s\n' docker.io docker-compose >"$FAKE/candidates_after_update"
run_stage
if [ "$RC" -eq 0 ] && echo "$CALLS" | grep -q 'apt-get update' && [ -f "$FAKE/pkgs/docker-compose" ]; then pass "apt-get update runs when no candidate is known"; else fail "update (rc $RC): $OUT"; fi
new_pi
: >"$FAKE/candidates"
run_stage
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'has an install candidate'; then pass "no candidate even after update is an error"; else fail "nocand (rc $RC): $OUT"; fi

# 7. Compose too old, failing build, SKIP_BUILD
new_pi
echo 2.20.1 >"$FAKE/compose_version"
run_stage
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q '2.24.0 or newer'; then pass "Compose older than 2.24 is refused"; else fail "old (rc $RC): $OUT"; fi
new_pi
touch "$FAKE/build-fail"
run_stage
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q 'image build failed' && echo "$OUT" | grep -q 'build error' && echo "$OUT" | grep -q 'Nothing was started'; then pass "a failing build stops with the log tail"; else fail "buildfail (rc $RC): $OUT"; fi
new_pi
run_stage SKIP_BUILD=1
if [ "$RC" -eq 0 ] && ! echo "$CALLS" | grep -q ' build' && [ -f "$(envf)" ]; then pass "SKIP_BUILD=1 builds nothing"; else fail "skip (rc $RC): $OUT"; fi

# 8. tailnet name sources: node snippet (a stand-in node), the dashboard unit, none
new_pi
mkdir -p "$SB/node24/bin"
printf '#!/usr/bin/env bash\ncat >/dev/null\nprintf node-name.ts.net\n' >"$SB/node24/bin/node"
chmod +x "$SB/node24/bin/node"
run_stage
if grep -qx 'DASHBOARD_ALLOWED_HOSTS=node-name.ts.net' "$(envf)"; then pass "uses node on the tailscale JSON when node exists (as stage 5 does)"; else fail "node: $(cat "$(envf)")"; fi
new_pi
touch "$FAKE/no-tailscale"
printf '[Service]\nEnvironment=DASHBOARD_ALLOWED_HOSTS=unit-name.ts.net\n' >"$SB/etc/dashboard.service"
run_stage
if grep -qx 'DASHBOARD_ALLOWED_HOSTS=unit-name.ts.net' "$(envf)"; then pass "without Tailscale the dashboard unit's value is used"; else fail "unit: $(cat "$(envf)")"; fi
new_pi
touch "$FAKE/no-tailscale"
run_stage
if [ "$RC" -eq 0 ] && grep -qx 'DASHBOARD_ALLOWED_HOSTS=' "$(envf)" && echo "$OUT" | grep -q 'WARNING: no tailnet name'; then pass "no name anywhere: empty value and a warning"; else fail "none (rc $RC): $OUT"; fi

if [ "$fails" -eq 0 ]; then echo "ALL SCENARIOS OK"; else echo "$fails scenario check(s) FAILED"; exit 1; fi
