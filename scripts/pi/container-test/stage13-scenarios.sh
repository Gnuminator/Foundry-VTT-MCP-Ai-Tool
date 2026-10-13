#!/usr/bin/env bash
# Stage 13 (scripts/pi/remote/13-player-creation.sh) in a Debian 13 ARM64 container with no systemd: stand-ins
# for systemctl, curl (/api/status and /join), journalctl and sleep make it take its systemd path, and a fake
# in-browser part replaces the Chromium driver. Each scenario starts from a fresh fake Pi and prints one block
# that scripts/pi/player-creation.test.mjs reads:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" <IMAGE> bash /repo/scripts/pi/container-test/stage13-scenarios.sh [name ...]
# (<IMAGE> is the pinned Debian 13 image in player-creation.test.mjs.) With names, only those scenarios run.
# Nothing here reaches the network after apt-get: the Actor Studio build comes from a local zip (STUDIO_ZIP),
# never from GitHub. The stage's node snippets run on Debian 13's own nodejs (20.x) linked as
# /opt/node24/bin/node, not Node 24 as on the Pi; they use nothing newer than Node 20.
#
# DESTRUCTIVE: each scenario wipes the Foundry data folder and the tool's folders, and the fakes go into
# /usr/local/sbin. It refuses to run anywhere but a container.
set -uo pipefail

[ -f /.dockerenv ] || [ -n "${container:-}" ] || {
  echo "REFUSED: run this only in the test container (docker run ..., see the header)"
  exit 98
}

H=/repo/scripts/pi/container-test
STAGE=/repo/scripts/pi/remote/13-player-creation.sh
LIB=/repo/scripts/pi/remote/lib.sh
LIBGM=/repo/scripts/pi/remote/lib-gm-passwords.sh

export DEBIAN_FRONTEND=noninteractive
apt_setup() { apt-get update && apt-get install -y --no-install-recommends nodejs zip unzip curl ca-certificates; }
# One retry: a Debian mirror hiccup should not fail a required CI check.
{ apt_setup || { /bin/sleep 20 && apt_setup; }; } >/dev/null 2>&1 || {
  echo "SETUP FAILED: apt-get"
  exit 99
}
mkdir -p /opt/node24/bin
ln -sf "$(command -v node)" /opt/node24/bin/node
for f in systemctl curl journalctl sleep; do install -m 755 "$H/bin/$f" "/usr/local/sbin/$f"; done
mkdir -p /run/systemd/system # have_systemd() looks for this folder

eval "$(grep -E '^(FOUNDRY_USER|FOUNDRY_APP|FOUNDRY_DATA|TOOL_DIR|TOOL_ETC|TOOL_DATA)=' "$LIB")"
# shellcheck source=fake-gm-check.sh
. "$H/fake-gm-check.sh"
PINNED_VERSION="$(sed -n 's/^PINNED_VERSION=//p' "$STAGE")"
IMPORT=/var/lib/foundry-import
id "$FOUNDRY_USER" >/dev/null 2>&1 || useradd --system --home-dir "$FOUNDRY_DATA" --shell /usr/sbin/nologin "$FOUNDRY_USER"

# $1 the installed Actor Studio version ("" for the pinned one, "none" for no module)
fresh_pi() {
  rm -rf "${FOUNDRY_DATA:?}" "${TOOL_DIR:?}" "${TOOL_ETC:?}" "${TOOL_DATA:?}" "${IMPORT:?}" /root/player-creation-settings.mjs
  rm -f /tmp/stopped-* /tmp/gmbroken /tmp/calls /tmp/status /tmp/status_rc /tmp/victim-file
  mkdir -p "$FOUNDRY_DATA/Config" "$FOUNDRY_DATA/Data/worlds" "$FOUNDRY_DATA/Data/modules"
  echo '{"world":"curse-of-strahd"}' >"$FOUNDRY_DATA/Config/options.json"
  for w in curse-of-strahd strahd-kit frostmaiden-training; do
    mkdir -p "$FOUNDRY_DATA/Data/worlds/$w/data/settings"
    echo '{"id":"'"$w"'"}' >"$FOUNDRY_DATA/Data/worlds/$w/world.json"
    echo dummy >"$FOUNDRY_DATA/Data/worlds/$w/data/settings/000001.log"
  done
  if [ "$1" != none ]; then
    mkdir -p "$FOUNDRY_DATA/Data/modules/foundryvtt-actor-studio"
    echo '{"id":"foundryvtt-actor-studio","version":"'"${1:-$PINNED_VERSION}"'"}' >"$FOUNDRY_DATA/Data/modules/foundryvtt-actor-studio/module.json"
  fi
  # The closing GM password check: every world's Gamemaster has a password, and Foundry has an administrator password.
  fake_classic_level
  fake_admin_password
  for w in curse-of-strahd strahd-kit frostmaiden-training; do fake_gm_user "$w" secret123; done
  chown -R "$FOUNDRY_USER:$FOUNDRY_USER" "$FOUNDRY_DATA"
  mkdir -p "$TOOL_ETC" "$TOOL_DIR/app" "$TOOL_DATA"
  for w in curse-of-strahd strahd-kit frostmaiden-training; do
    printf 'GM_USER=Gamemaster\nGM_PASSWORD=secret123\n' >"$TOOL_ETC/world-$w.env"
  done
  chmod 600 "$TOOL_ETC"/world-*.env
  echo '{}' >"$TOOL_DIR/app/package.json"
  chown -R "$FOUNDRY_USER:$FOUNDRY_USER" "$TOOL_DATA"
  cp "$H/stage13-driver.mjs" /root/player-creation-settings.mjs
  : >/tmp/calls
}

# A module zip of the pinned version under $IMPORT; prints the STUDIO_ZIP and STUDIO_SHA256 pair for env.
local_zip() {
  local dir=/tmp/zip-src zip="$IMPORT/test-studio.zip"
  rm -rf "${dir:?}" && mkdir -p "$dir/dist"
  echo '{"id":"foundryvtt-actor-studio","version":"'"$PINNED_VERSION"'"}' >"$dir/module.json"
  echo 'export {};' >"$dir/dist/index.js"
  install -d -m 700 "$IMPORT"
  rm -f "$zip"
  (cd "$dir" && zip -qr "$zip" module.json dist)
  echo "STUDIO_ZIP=$zip STUDIO_SHA256=$(sha256sum "$zip" | cut -d' ' -f1)"
}

# name, /api/status body, its curl exit code, installed version, inactive units ("foundry", "gm"),
# then the environment for the stage (KEY=VALUE words; "localzip" adds a local build, "gmbroken" makes the
# Assistant GM browser fail to start again, "nogmpw" takes the administrator password away and leaves the campaign's
# Gamemaster without one, "twice" runs the whole stage a second time on the same fake Pi and
# prints that run as "--- rerun output" and "--- rerun exit", the calls of both runs together; "options600" gives
# options.json mode 600; "options-readonly" makes the Config folder root's; "plant-link" leaves a link at the temp
# name options.json.world-tmp pointing to /tmp/victim-file; "kit-session-up" leaves a kit-session.env in the tool's
# data folder). The "--- files" block says what mode and owner options.json has and whether the temp name is left.
scenario() {
  local name="$1" status="$2" rc="$3" installed="$4" inactive="$5"
  shift 5
  if [ -n "$only" ] && [[ " $only " != *" $name "* ]]; then return 0; fi
  fresh_pi "$installed"
  printf '%s' "$status" >/tmp/status
  printf '%s' "$rc" >/tmp/status_rc
  for u in $inactive; do
    case "$u" in
      foundry) touch /tmp/stopped-foundry.service ;;
      gm) touch /tmp/stopped-foundry-ai-tool-gm-browser.service ;;
    esac
  done
  local env_words=() rerun=0
  for w in "$@"; do
    case "$w" in
      twice) rerun=1 ;;
      localzip) read -ra pair < <(local_zip) && env_words+=("${pair[@]}") ;;
      gmbroken) touch /tmp/gmbroken ;;
      nogmpw) rm -f "$FOUNDRY_DATA/Config/admin.txt" && fake_gm_user curse-of-strahd "" ;;
      options600) chmod 600 "$FOUNDRY_DATA/Config/options.json" ;;
      options-readonly)
        # The Config folder is root's here: the foundry user cannot write the temp file next to options.json.
        chown root:root "$FOUNDRY_DATA/Config"
        chmod 755 "$FOUNDRY_DATA/Config"
        ;;
      plant-link)
        # A link left at the temp name set_world uses, pointing at a file root must never touch.
        echo victim >/tmp/victim-file && chmod 644 /tmp/victim-file
        ln -s /tmp/victim-file "$FOUNDRY_DATA/Config/options.json.world-tmp"
        ;;
      kit-session-up) echo STAMP=20261013-074544 >"$TOOL_DATA/kit-session.env" ;;
      *) env_words+=("$w") ;;
    esac
  done
  echo "=== SCENARIO $name"
  echo "--- output"
  (cd /root && cat "$LIB" "$LIBGM" "$STAGE" | env "${env_words[@]}" bash -s) 2>&1
  echo "--- exit $?"
  if [ "$rerun" = 1 ]; then
    echo "--- rerun output"
    (cd /root && cat "$LIB" "$LIBGM" "$STAGE" | env "${env_words[@]}" bash -s) 2>&1
    echo "--- rerun exit $?"
  fi
  echo "--- calls"
  cat /tmp/calls
  echo "--- options.json"
  node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).world+"\n")' "$FOUNDRY_DATA/Config/options.json"
  echo "--- files"
  cfg="$FOUNDRY_DATA/Config"
  echo "options mode $(stat -c %a "$cfg/options.json") owner $(stat -c %U "$cfg/options.json") tmp $([ -e "$cfg/options.json.world-tmp" ] || [ -L "$cfg/options.json.world-tmp" ] && echo present || echo absent)"
  if [ -e /tmp/victim-file ]; then echo "victim $(stat -c %U:%G:%a /tmp/victim-file) $(cat /tmp/victim-file)"; fi
  echo "--- module version"
  node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version+"\n")}catch{console.log("none")}' "$FOUNDRY_DATA/Data/modules/foundryvtt-actor-studio/module.json"
  echo "--- prev"
  (cd "$IMPORT" 2>/dev/null && find . -path './prev-*' \( -name module.json -o -name 000001.log \) | sed 's#^\./prev-[0-9-]*/##' | sort)
  echo "=== END $name"
}

only="$*"
U0='{"active":true,"users":0}'
scenario good "$U0" 0 "" ""
scenario install-twice "$U0" 0 none "" localzip twice
scenario gm-passwords-missing "$U0" 0 "" "" nogmpw
scenario status-unreadable '' 7 "" ""
scenario status-unreadable-force '' 7 "" "" FORCE=1
scenario status-html '<html>' 0 "" ""
scenario users-online '{"active":true,"users":2}' 0 "" ""
scenario setup-screen '{"active":false,"version":"14.368"}' 0 "" ""
scenario downgrade-refused "$U0" 0 2.10.5-aitool.9 ""
scenario downgrade-allowed "$U0" 0 2.10.5-aitool.9 "" ALLOW_DOWNGRADE=1 localzip
scenario upgrade "$U0" 0 2.10.5 "" localzip
scenario foundry-off "$U0" 0 "" "foundry"
scenario services-off "$U0" 0 "" "foundry gm"
scenario gm-browser-fails "$U0" 0 "" "" gmbroken
scenario training-needs-kit-world "$U0" 0 "" "" WORLD=frostmaiden-training
scenario training-world "$U0" 0 "" "" WORLD=frostmaiden-training KIT_WORLD=
scenario options-600 "$U0" 0 "" "" options600
scenario options-readonly "$U0" 0 "" "" options-readonly
scenario plant-link "$U0" 0 "" "" plant-link
scenario kit-session-up "$U0" 0 "" "" kit-session-up
echo "=== ALL DONE"
