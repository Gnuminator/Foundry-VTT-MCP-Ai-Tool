#!/usr/bin/env bash
# The kit-session stage (scripts/pi/remote/kit-session.sh) in a Debian 13 ARM64 container with no systemd: stand-ins
# for systemctl, curl (/api/status and /join), journalctl and sleep make it take its systemd path, and a fake in-browser
# part (kit-session-driver.mjs) replaces the Chromium driver. Each scenario starts from a fresh fake Pi and prints one
# block that scripts/pi/kit-session.test.mjs reads:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" <IMAGE> bash /repo/scripts/pi/container-test/kit-session-scenarios.sh [name ...]
# (<IMAGE> is the pinned Debian 13 image in kit-session.test.mjs.) With names, only those scenarios run.
# Nothing here reaches the network after apt-get. The stage's node snippets run on Debian 13's own nodejs (20.x)
# linked as /opt/node24/bin/node, not Node 24 as on the Pi; they use nothing newer than Node 20.
#
# DESTRUCTIVE: each scenario wipes the Foundry data folder and the tool's folders, and the fakes go into
# /usr/local/sbin. It refuses to run anywhere but a container.
set -uo pipefail

[ -f /.dockerenv ] || [ -n "${container:-}" ] || {
  echo "REFUSED: run this only in the test container (docker run ..., see the header)"
  exit 98
}

H=/repo/scripts/pi/container-test
STAGE="${KIT_STAGE_FILE:-/repo/scripts/pi/remote/kit-session.sh}" # KIT_STAGE_FILE: a test run against another copy of the stage
LIB=/repo/scripts/pi/remote/lib.sh

export DEBIAN_FRONTEND=noninteractive
apt_setup() { apt-get update && apt-get install -y --no-install-recommends nodejs curl ca-certificates; }
# One retry: a Debian mirror hiccup should not fail a required CI check.
{ apt_setup || { /bin/sleep 20 && apt_setup; }; } >/dev/null 2>&1 || {
  echo "SETUP FAILED: apt-get"
  exit 99
}
mkdir -p /opt/node24/bin
ln -sf "$(command -v node)" /opt/node24/bin/node
for f in systemctl curl journalctl sleep; do install -m 755 "$H/bin/$f" "/usr/local/sbin/$f"; done
mkdir -p /run/systemd/system # have_systemd() looks for this folder

eval "$(grep -E '^(FOUNDRY_USER|FOUNDRY_DATA|TOOL_DIR|TOOL_ETC|TOOL_DATA)=' "$LIB")"
IMPORT=/var/lib/foundry-import
STATE="$TOOL_DATA/kit-session.env"
id "$FOUNDRY_USER" >/dev/null 2>&1 || useradd --system --home-dir "$FOUNDRY_DATA" --shell /usr/sbin/nologin "$FOUNDRY_USER"

# $1 the world options.json launches, $2 "upload" (the driver waits in /root) or "installed"
fresh_pi() {
  rm -rf "${FOUNDRY_DATA:?}" "${TOOL_DIR:?}" "${TOOL_ETC:?}" "${TOOL_DATA:?}" "${IMPORT:?}" /root/kit-session.mjs
  rm -f /tmp/stopped-* /tmp/gmbroken /tmp/calls /tmp/status /tmp/status_rc /tmp/driverfail /tmp/gm-counts /tmp/joinfail /tmp/stopfail
  mkdir -p "$FOUNDRY_DATA/Config" "$FOUNDRY_DATA/Data/worlds"
  echo '{"world":"'"$1"'"}' >"$FOUNDRY_DATA/Config/options.json"
  for w in curse-of-strahd strahd-kit; do
    mkdir -p "$FOUNDRY_DATA/Data/worlds/$w/data/settings"
    echo '{"id":"'"$w"'"}' >"$FOUNDRY_DATA/Data/worlds/$w/world.json"
    echo dummy >"$FOUNDRY_DATA/Data/worlds/$w/data/settings/000001.log"
  done
  # The kit world also has users and actors databases; the campaign world's are never copied.
  for part in users actors; do
    mkdir -p "$FOUNDRY_DATA/Data/worlds/strahd-kit/data/$part"
    echo dummy >"$FOUNDRY_DATA/Data/worlds/strahd-kit/data/$part/000001.log"
  done
  chown -R "$FOUNDRY_USER:$FOUNDRY_USER" "$FOUNDRY_DATA"
  mkdir -p "$TOOL_ETC" "$TOOL_DIR/app" "$TOOL_DATA"
  for w in curse-of-strahd strahd-kit; do
    printf 'GM_USER=Gamemaster\nGM_PASSWORD=secret123\n' >"$TOOL_ETC/world-$w.env"
  done
  chmod 600 "$TOOL_ETC"/world-*.env
  echo '{}' >"$TOOL_DIR/app/package.json"
  chown -R "$FOUNDRY_USER:$FOUNDRY_USER" "$TOOL_DATA"
  if [ "$2" = installed ]; then
    mkdir -p "$TOOL_DIR/gm-browser"
    cp "$H/kit-session-driver.mjs" "$TOOL_DIR/gm-browser/kit-session.mjs"
    chmod 644 "$TOOL_DIR/gm-browser/kit-session.mjs"
  else
    cp "$H/kit-session-driver.mjs" /root/kit-session.mjs
  fi
  : >/tmp/calls
}

# $1 the original world, $2 WAS_GM_BROWSER: a kit session that is up (what MODE=up leaves behind)
write_state() {
  printf 'ORIG_WORLD=%s\nWAS_GM_BROWSER=%s\nSTAMP=20261012-101010\n' "$1" "$2" >"$STATE"
  chmod 600 "$STATE"
}

# name, /api/status body, its curl exit code, inactive units ("foundry", "gm"), MODE (up, down, or "-" for none),
# then the environment for the stage (KEY=VALUE words) and these switches:
#   up-state     a state file of a kit session is there (original world curse-of-strahd, GM browser ran)
#   down-state   the same, and options.json launches strahd-kit; down-state-gm0: the GM browser had not run;
#                down-state-no-orig: no original world
#   bad-state    a state file that holds a world id the stage must not trust
#   on-kit       options.json launches strahd-kit
#   driverfail   the fake driver fails
#   gmbroken     the Assistant GM browser fails to start again
#   noupload     no driver anywhere     noenvfile  no GM login for strahd-kit     noworld  no strahd-kit world
#   gm-counts    /api/status counts the Assistant GM browser as a user while it runs
#   joinfail     the world does not answer on port 30000 once Foundry was stopped
#   stopfail     "systemctl stop foundry.service" fails
#   closepipe=N  the stage's output is cut off after N lines, as when the ssh session drops (SIGPIPE): the next write
#                dies. For up, 13 lines end at "strahd-kit is running", after options.json was changed; for down,
#                8 ends after "Foundry launches ... again" (the cut falls while Foundry is stopped and options.json
#                is back) and 9 after "options.json launches ..." (the cut falls while the world starts)
scenario() {
  local name="$1" status="$2" rc="$3" inactive="$4" mode="$5"
  shift 5
  if [ -n "$only" ] && [[ " $only " != *" $name "* ]]; then return 0; fi
  local first=curse-of-strahd driver=upload pipe_lines=""
  local w
  for w in "$@"; do
    case "$w" in
      down-state* | on-kit | bad-state) first=strahd-kit ;;
    esac
    case "$w" in down-state* | bad-state) driver=installed ;; esac
  done
  fresh_pi "$first" "$driver"
  printf '%s' "$status" >/tmp/status
  printf '%s' "$rc" >/tmp/status_rc
  local u
  for u in $inactive; do
    case "$u" in
      foundry) touch /tmp/stopped-foundry.service ;;
      gm) touch /tmp/stopped-foundry-ai-tool-gm-browser.service ;;
    esac
  done
  local env_words=()
  [ "$mode" = - ] || env_words+=("MODE=$mode")
  for w in "$@"; do
    case "$w" in
      up-state) write_state curse-of-strahd 1 ;;
      down-state) write_state curse-of-strahd 1 ;;
      down-state-gm0) write_state curse-of-strahd 0 ;;
      down-state-no-orig) write_state "" 1 ;;
      bad-state) printf 'ORIG_WORLD=../../etc\nWAS_GM_BROWSER=1\nSTAMP=20261012-101010\n' >"$STATE" ;;
      driverfail) touch /tmp/driverfail ;;
      gm-counts) touch /tmp/gm-counts ;;
      joinfail) touch /tmp/joinfail ;;
      stopfail) touch /tmp/stopfail ;;
      closepipe=*) pipe_lines="${w#closepipe=}" ;;
      gmbroken) touch /tmp/gmbroken ;;
      noupload) rm -f /root/kit-session.mjs "$TOOL_DIR/gm-browser/kit-session.mjs" ;;
      noenvfile) rm -f "$TOOL_ETC/world-strahd-kit.env" ;;
      noworld) rm -rf "${FOUNDRY_DATA:?}/Data/worlds/strahd-kit" ;;
      on-kit) ;;
      *) env_words+=("$w") ;;
    esac
  done
  echo "=== SCENARIO $name"
  echo "--- output"
  local rc
  if [ -n "$pipe_lines" ]; then
    # head quits after N lines; the stage's next write then dies of SIGPIPE, and its handlers must still run.
    (cd /root && cat "$LIB" "$STAGE" | env "${env_words[@]}" bash -s) 2>&1 | head -n "$pipe_lines"
    rc=${PIPESTATUS[0]}
  else
    (cd /root && cat "$LIB" "$STAGE" | env "${env_words[@]}" bash -s) 2>&1
    rc=$?
  fi
  echo "--- exit $rc"
  echo "--- calls"
  cat /tmp/calls
  echo "--- options.json"
  node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).world+"\n")' "$FOUNDRY_DATA/Config/options.json"
  echo "--- state"
  if [ -e "$STATE" ]; then
    echo "mode $(stat -c %a "$STATE") owner $(stat -c %U "$STATE")"
    sed 's/^STAMP=[0-9-]*$/STAMP=<stamp>/' "$STATE"
  else
    echo absent
  fi
  echo "--- driver"
  echo "upload $([ -e /root/kit-session.mjs ] && echo kept || echo removed)"
  echo "installed $([ -e "$TOOL_DIR/gm-browser/kit-session.mjs" ] && echo yes || echo no)"
  echo "--- prev"
  (cd "$IMPORT" 2>/dev/null && find . -path './prev-*' -type f | sed 's#^\./prev-[0-9-]*/##' | sort)
  echo "=== END $name"
}

only="$*"
U0='{"active":true,"users":0}'
scenario up-ok "$U0" 0 "" up
scenario up-gm-was-off "$U0" 0 "gm" up
scenario up-foundry-was-off "$U0" 0 "foundry" up
scenario up-state-exists "$U0" 0 "" up up-state
scenario up-already-kit "$U0" 0 "" up on-kit
scenario up-users-online '{"active":true,"users":2}' 0 "" up
scenario up-users-online-force '{"active":true,"users":2}' 0 "" up FORCE=1
scenario up-status-unreadable '' 7 "" up
scenario up-driver-fails "$U0" 0 "" up driverfail
scenario up-driver-fails-gm-off "$U0" 0 "gm" up driverfail
scenario up-no-driver "$U0" 0 "" up noupload
scenario up-no-login "$U0" 0 "" up noenvfile
scenario up-no-world "$U0" 0 "" up noworld
scenario up-wrong-driver-path "$U0" 0 "" up SESSION_DRIVER=/tmp/kit-session.mjs
scenario up-ignores-world-env "$U0" 0 "" up WORLD=curse-of-strahd
scenario up-pipe-closed "$U0" 0 "" up closepipe=13
scenario bad-mode "$U0" 0 "" sideways
scenario no-mode "$U0" 0 "" -
scenario down-ok "$U0" 0 "gm" down down-state
scenario down-gm-was-off "$U0" 0 "gm" down down-state-gm0
scenario down-no-world "$U0" 0 "gm" down down-state-no-orig
scenario down-no-state "$U0" 0 "" down
scenario down-not-on-kit "$U0" 0 "gm" down up-state
scenario down-bad-state "$U0" 0 "gm" down bad-state
scenario down-driver-fails "$U0" 0 "gm" down down-state driverfail
scenario down-users-online '{"active":true,"users":1}' 0 "gm" down down-state
scenario down-users-online-force '{"active":true,"users":1}' 0 "gm" down down-state FORCE=1
scenario down-foundry-off "$U0" 0 "gm foundry" down down-state
scenario down-max-delete "$U0" 0 "gm" down down-state MAX_DELETE=9
scenario down-bad-max-delete "$U0" 0 "gm" down down-state MAX_DELETE=lots
scenario down-gm-active "$U0" 0 "" down down-state gm-counts
scenario down-gm-active-users-online '{"active":true,"users":2}' 0 "" down down-state gm-counts
scenario down-world-not-back "$U0" 0 "gm" down down-state joinfail
scenario down-world-not-back-gm-off "$U0" 0 "gm" down down-state-gm0 joinfail
scenario down-pipe-closed-stopping "$U0" 0 "gm" down down-state closepipe=8
scenario down-pipe-closed-starting "$U0" 0 "gm" down down-state closepipe=9
scenario down-stop-fails "$U0" 0 "gm" down down-state stopfail
scenario down-gm-browser-fails "$U0" 0 "gm" down down-state gmbroken
echo "=== ALL DONE"
