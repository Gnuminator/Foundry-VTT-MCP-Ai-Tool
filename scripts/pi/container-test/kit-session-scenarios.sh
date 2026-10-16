#!/usr/bin/env bash
# The kit-session stage (scripts/pi/remote/kit-session.sh) in a Debian 13 ARM64 container with no systemd: stand-ins
# for systemctl, systemd-run, ss, curl (/api/status and /join), journalctl and sleep make it take its systemd path, and a fake in-browser
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
for f in systemctl curl journalctl sleep systemd-run ss; do install -m 755 "$H/bin/$f" "/usr/local/sbin/$f"; done
mkdir -p /run/systemd/system # have_systemd() looks for this folder

eval "$(grep -E '^(FOUNDRY_USER|FOUNDRY_DATA|TOOL_DIR|TOOL_ETC|TOOL_DATA)=' "$LIB")"
IMPORT=/var/lib/foundry-import
STATE="$TOOL_DATA/kit-session.env"
KIT_ENV="$TOOL_ETC/kit-gm.env" # root's folder, not the foundry user's
KIT_PROFILE="$TOOL_DATA/kit-gm-browser"
id "$FOUNDRY_USER" >/dev/null 2>&1 || useradd --system --home-dir "$FOUNDRY_DATA" --shell /usr/sbin/nologin "$FOUNDRY_USER"

# $1 the world options.json launches, $2 "upload" (the driver waits in /root) or "installed"
fresh_pi() {
  rm -rf "${FOUNDRY_DATA:?}" "${TOOL_DIR:?}" "${TOOL_ETC:?}" "${TOOL_DATA:?}" "${IMPORT:?}" /root/kit-session.mjs
  rm -f /tmp/stopped-* /tmp/gmbroken /tmp/calls /tmp/status /tmp/status_rc /tmp/driverfail /tmp/gm-counts /tmp/joinfail /tmp/stopfail
  rm -f /tmp/started-kit /tmp/kitnojoin /tmp/kitstopfail /tmp/kitrunfail /tmp/nolink /tmp/nobridge /tmp/kit-counts /tmp/kit-activating /tmp/fake-orig-bridge /tmp/seen-kit-pw /tmp/kit-env-seen /tmp/stage-out
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
  # stage 5's Assistant GM driver (the Kit GM browser runs it); the container never runs it
  mkdir -p "$TOOL_DIR/gm-browser"
  echo '// stand-in for assistant-gm.mjs' >"$TOOL_DIR/gm-browser/assistant-gm.mjs"
  if [ "$2" = installed ]; then
    cp "$H/kit-session-driver.mjs" "$TOOL_DIR/gm-browser/kit-session.mjs"
    chmod 644 "$TOOL_DIR/gm-browser/kit-session.mjs"
  else
    cp "$H/kit-session-driver.mjs" /root/kit-session.mjs
  fi
  : >/tmp/calls
}

# What a Kit GM that is up leaves on the Pi: its password file (a valid one, for the lookup of leaks the line is
# distinctive), its profile folder and the running browser unit. $1 the password line's 32 hex characters.
make_kit_files() {
  printf 'ASSISTANT_GM_PASSWORD=%s\n' "$1" >"$KIT_ENV"
  chmod 600 "$KIT_ENV"
  mkdir -p "$KIT_PROFILE"
  echo profile-data >"$KIT_PROFILE/Cookies"
  chown -R "$FOUNDRY_USER:$FOUNDRY_USER" "$KIT_PROFILE"
  chmod 700 "$KIT_PROFILE"
  touch /tmp/started-kit
}

# $1 the original world, $2 WAS_GM_BROWSER, $3 what kind of state file: "kit" (default: a session with a Kit GM, with the
# password file, the profile folder and the browser it leaves, and the bridge user the setup replaced:
# ORIG_BRIDGE_USER=AbCdEfGh01234567), "kit-noorig" (no ORIG_BRIDGE_USER line: a session from before it existed),
# "kit-emptyorig" (ORIG_BRIDGE_USER= with nothing: it was Any GM) or "old" (from before the Kit GM existed: no
# KIT_GM_BROWSER line, nothing else): a kit session that is up (what MODE=up leaves behind)
write_state() {
  printf 'ORIG_WORLD=%s\nWAS_GM_BROWSER=%s\nSTAMP=20261012-101010\n' "$1" "$2" >"$STATE"
  case "${3:-kit}" in
    old) ;;
    *)
      echo 'STAMP_EPOCH=1792000000' >>"$STATE"
      echo 'KIT_GM_BROWSER=1' >>"$STATE"
      make_kit_files 0123456789abcdef0123456789abcdef
      ;;&
    kit) echo 'ORIG_BRIDGE_USER=AbCdEfGh01234567' >>"$STATE" ;;
    kit-emptyorig) echo 'ORIG_BRIDGE_USER=' >>"$STATE" ;;
  esac
  chmod 600 "$STATE"
}

# name, /api/status body, its curl exit code, inactive units ("foundry", "gm"), MODE (up, down, or "-" for none),
# then the environment for the stage (KEY=VALUE words) and these switches:
#   up-state     a state file of a kit session is there (original world curse-of-strahd, GM browser ran), with the Kit GM
#                password file, profile folder and running browser a session leaves
#   down-state   the same, and options.json launches strahd-kit; down-state-gm0: the GM browser had not run;
#                down-state-no-orig: no original world; down-state-old: a state file from before the Kit GM existed
#                (no KIT_GM_BROWSER line, no password file, no profile, no browser)
#                down-state-noorig / down-state-emptyorig: without the ORIG_BRIDGE_USER line / with it empty
#   bad-state    a state file that holds a world id the stage must not trust; bad-kit-flag: a KIT_GM_BROWSER line that
#                does not say 1; bad-epoch: a STAMP_EPOCH line that is not seconds; bad-orig-state: an ORIG_BRIDGE_USER line that is not a user id
#   origbridge-empty / origbridge-bad / origbridge-none   the fake setup driver reports no bridge user (Any GM), one that
#                is not a user id, or does not report one at all (default: AbCdEfGh01234567)
#   kit-activating   a Kit GM browser unit between restarts ("activating"), nothing else left behind
#   options600   options.json has mode 600 (it must keep it)     options-readonly  the foundry user cannot write in the Config folder
#   xtrace       the stage runs as bash -x -s (a trace on stderr, as when someone runs it by mistake)
#   plant-links  the foundry user left links in its folders where the stage's profile folder, old files and the temp file
#                of options.json would be
#   leftover     a Kit GM password file, temp file, profile folder and running browser, and no state file (a run that
#                was cut off)
#   on-kit       options.json launches strahd-kit
#   driverfail   the fake driver fails
#   gmbroken     the Assistant GM browser fails to start again
#   noupload     no driver anywhere     noenvfile  no GM login for strahd-kit     noworld  no strahd-kit world
#   nogmdriver   stage 5's assistant-gm.mjs is not installed     nobridge  the bridge service has no unit file
#   kitnojoin    the Kit GM browser never logs "joined world"     nolink  no connection on the bridge's port 31415
#   kitrunfail   systemd-run fails     kitstopfail  "systemctl stop" leaves the Kit GM browser running
#   gm-counts    /api/status counts the Assistant GM browser as a user while it runs
#   kit-counts   /api/status counts the Kit GM browser as a user while it runs
#   joinfail     the world does not answer on port 30000 once Foundry was stopped
#   stopfail     "systemctl stop foundry.service" fails
#   closepipe=N  the stage's output is cut off after N lines, as when the ssh session drops (SIGPIPE): the next write
#                dies. For up (the lines of up-ok): 13 ends at "strahd-kit is running", after options.json was changed;
#                14 ends at "making the password file", 15 after "wrote ...kit-gm.env" (the driver is next), 21 at
#                "starting the Kit GM browser" and 22 at "started foundry-ai-tool-kit-gm-browser.service"; for down (the lines of down-ok): 6 ends after the teardown
#                driver's lines, 9 ends after "Foundry launches ... again" (the cut falls while Foundry is stopped and
#                options.json is back) and 10 after "options.json launches ..." (the cut falls while the world starts)
scenario() {
  local name="$1" status="$2" rc="$3" inactive="$4" mode="$5"
  shift 5
  if [ -n "$only" ] && [[ " $only " != *" $name "* ]]; then return 0; fi
  local first=curse-of-strahd driver=upload pipe_lines="" bash_flags=(-s)
  local w
  for w in "$@"; do
    case "$w" in
      down-state* | on-kit | bad-state | bad-kit-flag | bad-epoch | bad-orig-state) first=strahd-kit ;;
    esac
    case "$w" in down-state* | bad-state | bad-kit-flag | bad-epoch | bad-orig-state) driver=installed ;; esac
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
      down-state-old) write_state curse-of-strahd 1 old ;;
      down-state-noorig) write_state curse-of-strahd 1 kit-noorig ;;
      down-state-emptyorig) write_state curse-of-strahd 1 kit-emptyorig ;;
      bad-orig-state)
        printf 'ORIG_WORLD=curse-of-strahd\nWAS_GM_BROWSER=1\nSTAMP=20261012-101010\nKIT_GM_BROWSER=1\nORIG_BRIDGE_USER=../etc\n' >"$STATE"
        make_kit_files 0123456789abcdef0123456789abcdef
        ;;
      origbridge-empty) echo EMPTY >/tmp/fake-orig-bridge ;;
      origbridge-bad) echo BAD >/tmp/fake-orig-bridge ;;
      origbridge-none) echo NONE >/tmp/fake-orig-bridge ;;
      kit-activating) touch /tmp/kit-activating ;;
      options600) chmod 600 "$FOUNDRY_DATA/Config/options.json" ;;
      options-readonly)
        # The Config folder is root's here: the foundry user cannot write the temp file (set_world fails before any rename).
        chown root:root "$FOUNDRY_DATA/Config"
        chmod 755 "$FOUNDRY_DATA/Config"
        ;;
      xtrace) bash_flags=(-x -s) ;;
      plant-links)
        # A directory and a file root must never touch, reached through links in the foundry user's folder.
        mkdir -p /tmp/victim-dir && chmod 755 /tmp/victim-dir
        echo victim >/tmp/victim-file && chmod 644 /tmp/victim-file
        ln -s /tmp/victim-dir "$TOOL_DATA/kit-gm-browser"
        ln -s /tmp/victim-file "$TOOL_DATA/kit-gm.env.tmp"
        ln -s /tmp/victim-file "$FOUNDRY_DATA/Config/options.json.foundry-tmp" # the temp name set_world used
        ;;
      bad-state) printf 'ORIG_WORLD=../../etc\nWAS_GM_BROWSER=1\nSTAMP=20261012-101010\n' >"$STATE" ;;
      bad-kit-flag) printf 'ORIG_WORLD=curse-of-strahd\nWAS_GM_BROWSER=1\nSTAMP=20261012-101010\nKIT_GM_BROWSER=maybe\n' >"$STATE" ;;
      bad-epoch) printf 'ORIG_WORLD=curse-of-strahd\nWAS_GM_BROWSER=1\nSTAMP=20261012-101010\nSTAMP_EPOCH=soon\nKIT_GM_BROWSER=1\n' >"$STATE" ;;
      leftover)
        make_kit_files fedcba9876543210fedcba9876543210
        echo stale >"$TOOL_ETC/.kit-gm.stale1"
        ;;
      nogmdriver) rm -f "$TOOL_DIR/gm-browser/assistant-gm.mjs" ;;
      nobridge) touch /tmp/nobridge ;;
      kitnojoin) touch /tmp/kitnojoin ;;
      nolink) touch /tmp/nolink ;;
      kitrunfail) touch /tmp/kitrunfail ;;
      kitstopfail) touch /tmp/kitstopfail ;;
      kit-counts) touch /tmp/kit-counts ;;
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
  local rc outcopy=1
  # A password the Pi already holds before the run (a session that is up, a leftover): looked for in the output below.
  local pw_before=""
  [ ! -f "$KIT_ENV" ] || pw_before="$(sed -n 's/^ASSISTANT_GM_PASSWORD=//p' "$KIT_ENV")"
  if [ -n "$pipe_lines" ]; then
    # head quits after N lines; the stage's next write then dies of SIGPIPE, and its handlers must still run.
    # (No copy of the output for the leak check here: a tee in the middle would move the cut by one line.)
    outcopy=0
    (cd /root && cat "$LIB" "$STAGE" | env "${env_words[@]}" bash "${bash_flags[@]}") 2>&1 | head -n "$pipe_lines"
    rc=${PIPESTATUS[0]}
  else
    (cd /root && cat "$LIB" "$STAGE" | env "${env_words[@]}" bash "${bash_flags[@]}") >/tmp/stage-out 2>&1
    rc=$?
    cat /tmp/stage-out
  fi
  echo "--- exit $rc"
  echo "--- calls"
  cat /tmp/calls
  echo "--- options.json"
  node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).world+"\n")' "$FOUNDRY_DATA/Config/options.json"
  echo "--- state"
  if [ -e "$STATE" ]; then
    echo "mode $(stat -c %a "$STATE") owner $(stat -c %U "$STATE")"
    sed -e 's/^STAMP=[0-9-]*$/STAMP=<stamp>/' -e 's/^STAMP_EPOCH=[0-9]*$/STAMP_EPOCH=<epoch>/' "$STATE"
  else
    echo absent
  fi
  echo "--- driver"
  echo "upload $([ -e /root/kit-session.mjs ] && echo kept || echo removed)"
  echo "installed $([ -e "$TOOL_DIR/gm-browser/kit-session.mjs" ] && echo yes || echo no)"
  echo "--- prev"
  (cd "$IMPORT" 2>/dev/null && find . -path './prev-*' -type f | sed 's#^\./prev-[0-9-]*/##' | sort)
  echo "--- kitgm"
  # The Kit GM's password file, profile folder and browser, as the stage left them. The password itself is never printed.
  if [ -e "$KIT_ENV" ]; then
    echo "env mode $(stat -c %a "$KIT_ENV") owner $(stat -c %U "$KIT_ENV") lines $(grep -c '' "$KIT_ENV") shape $(grep -Eqx 'ASSISTANT_GM_PASSWORD=[0-9a-f]{32}' "$KIT_ENV" && echo ok || echo wrong)"
  else
    echo "env absent"
  fi
  echo "env-tmp $(compgen -G "$TOOL_ETC/.kit-gm.*" >/dev/null && echo present || echo absent)"
  if [ -e "$KIT_PROFILE" ]; then
    echo "profile mode $(stat -c %a "$KIT_PROFILE") owner $(stat -c %U "$KIT_PROFILE")"
  else
    echo "profile absent"
  fi
  echo "unit $([ -e /tmp/started-kit ] && echo running || echo stopped)"
  echo "options mode $(stat -c %a "$FOUNDRY_DATA/Config/options.json") owner $(stat -c %U "$FOUNDRY_DATA/Config/options.json") tmp $([ -e "$FOUNDRY_DATA/Config/options.json.foundry-tmp" ] || [ -L "$FOUNDRY_DATA/Config/options.json.foundry-tmp" ] && echo present || echo absent)"
  echo "tooldata $(find "$TOOL_DATA" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort | tr '\n' ' ' | sed 's/ $//')"
  echo "unit-activating $([ -e /tmp/kit-activating ] && echo yes || echo no)"
  echo "victims $(stat -c '%U:%a' /tmp/victim-dir 2>/dev/null || echo none) $(stat -c '%U:%a' /tmp/victim-file 2>/dev/null || echo none) $(cat /tmp/victim-file 2>/dev/null || true)"
  echo "env-seen-by-unit $(cat /tmp/kit-env-seen 2>/dev/null || echo none)"
  # Where the passwords (the one the driver was handed, the one that was there before the run) show up.
  local seen="" secret n_out n_calls
  [ ! -f /tmp/seen-kit-pw ] || seen="$(cat /tmp/seen-kit-pw)"
  for secret in "$seen" "$pw_before"; do
    [ -n "$secret" ] || continue
    n_calls="$(grep -c -F -- "$secret" /tmp/calls || true)"
    if [ "$outcopy" = 1 ]; then n_out="$(grep -c -F -- "$secret" /tmp/stage-out || true)"; else n_out=skipped; fi
    echo "leak output=$n_out calls=$n_calls"
  done
  [ -z "$seen" ] || echo "driver-password-is-file $([ -f "$KIT_ENV" ] && [ "$(sed -n 's/^ASSISTANT_GM_PASSWORD=//p' "$KIT_ENV")" = "$seen" ] && echo yes || echo no)"
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
scenario up-pipe-closed-kit-file "$U0" 0 "" up closepipe=14
scenario up-pipe-closed-kit-driver "$U0" 0 "" up closepipe=15
scenario up-pipe-closed-kit-start "$U0" 0 "" up closepipe=21
scenario up-pipe-closed-kit-wait "$U0" 0 "" up closepipe=22
scenario up-no-gm-driver "$U0" 0 "" up nogmdriver
scenario up-no-bridge-unit "$U0" 0 "" up nobridge
scenario up-leftover "$U0" 0 "" up leftover
scenario up-kit-not-joined "$U0" 0 "" up kitnojoin
scenario up-kit-run-fails "$U0" 0 "" up kitrunfail
scenario up-no-bridge-link "$U0" 0 "" up nolink
scenario up-orig-bridge-empty "$U0" 0 "" up origbridge-empty
scenario up-orig-bridge-bad "$U0" 0 "" up origbridge-bad
scenario up-orig-bridge-none "$U0" 0 "" up origbridge-none
scenario up-leftover-activating "$U0" 0 "" up kit-activating
scenario up-xtrace "$U0" 0 "" up xtrace
scenario up-plant-links "$U0" 0 "" up plant-links
scenario up-options-600 "$U0" 0 "" up options600
scenario up-options-readonly "$U0" 0 "" up options-readonly
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
scenario down-pipe-closed-stopping "$U0" 0 "gm" down down-state closepipe=9
scenario down-pipe-closed-starting "$U0" 0 "gm" down down-state closepipe=10
scenario down-pipe-closed-after-teardown "$U0" 0 "gm" down down-state closepipe=6
scenario down-old-state "$U0" 0 "gm" down down-state-old
scenario down-options-600 "$U0" 0 "gm" down down-state options600
scenario down-no-orig-bridge "$U0" 0 "gm" down down-state-noorig
scenario down-empty-orig-bridge "$U0" 0 "gm" down down-state-emptyorig
scenario down-bad-orig-bridge "$U0" 0 "gm" down bad-orig-state
scenario down-bad-kit-flag "$U0" 0 "gm" down bad-kit-flag
scenario down-bad-epoch "$U0" 0 "gm" down bad-epoch
scenario down-kit-active "$U0" 0 "gm" down down-state kit-counts
scenario down-kit-active-users-online '{"active":true,"users":2}' 0 "gm" down down-state kit-counts
scenario down-kit-stop-fails "$U0" 0 "gm" down down-state kitstopfail
scenario down-stop-fails "$U0" 0 "gm" down down-state stopfail
scenario down-gm-browser-fails "$U0" 0 "gm" down down-state gmbroken
echo "=== ALL DONE"
