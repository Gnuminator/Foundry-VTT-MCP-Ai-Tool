#!/usr/bin/env bash
# Stage 11 (scripts/pi/remote/11-world.sh) in a Debian 13 ARM64 container with no systemd: stand-ins for
# systemctl, curl (/join), journalctl and sleep make it take its systemd path, and a fake Assistant GM
# (stage11-provision.mjs) replaces the Chromium driver and records each provisioning call in /tmp/provision.
# Each scenario starts from a fresh fake Pi and prints one block that scripts/pi/stage11-world.test.mjs reads:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" <IMAGE> bash /repo/scripts/pi/container-test/stage11-scenarios.sh [name ...]
# (<IMAGE> is the pinned Debian 13 image in stage11-world.test.mjs.) With names, only those scenarios run.
# Nothing here reaches the network after apt-get. The stage's node snippets run on Debian 13's own nodejs (20.x)
# linked as /opt/node24/bin/node, not Node 24 as on the Pi. Passwords are never printed: the blocks show env file
# key names, modes and short hashes only.
#
# DESTRUCTIVE: each scenario wipes the Foundry data folder and the tool's folders, and the fakes go into
# /usr/local/sbin. It refuses to run anywhere but a container.
set -uo pipefail

[ -f /.dockerenv ] || [ -n "${container:-}" ] || {
  echo "REFUSED: run this only in the test container (docker run ..., see the header)"
  exit 98
}

H=/repo/scripts/pi/container-test
STAGE=/repo/scripts/pi/remote/11-world.sh
LIB=/repo/scripts/pi/remote/lib.sh
LIBGM=/repo/scripts/pi/remote/lib-gm-passwords.sh

export DEBIAN_FRONTEND=noninteractive
apt_setup() { apt-get update && apt-get install -y --no-install-recommends nodejs tar ca-certificates; }
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
IMPORT=/var/lib/foundry-import
id "$FOUNDRY_USER" >/dev/null 2>&1 || useradd --system --home-dir "$FOUNDRY_DATA" --shell /usr/sbin/nologin "$FOUNDRY_USER"
data="$FOUNDRY_DATA/Data"

fresh_pi() {
  rm -rf "${FOUNDRY_DATA:?}" "${TOOL_DIR:?}" "${TOOL_ETC:?}" "${TOOL_DATA:?}" "${IMPORT:?}" /tmp/bundle-src
  manifest_extra=""
  bundle_module=""
  bundle_assets=0
  rm -f /tmp/stopped-* /tmp/provfail /tmp/calls /tmp/provision /tmp/out.first /tmp/out.last /tmp/victim-file
  ln -sf "$(command -v node)" /opt/node24/bin/node # the no-node fixture removes it
  mkdir -p "$data/worlds" "$data/modules/foundry-mcp-bridge" "$FOUNDRY_DATA/Config"
  echo '{"world":"curse-of-strahd"}' >"$FOUNDRY_DATA/Config/options.json"
  local w
  for w in curse-of-strahd strahd-kit; do
    mkdir -p "$data/worlds/$w/data"
    echo '{"id":"'"$w"'","title":"'"$w"' (on the Pi)"}' >"$data/worlds/$w/world.json"
    echo "the Pi's own $w" >"$data/worlds/$w/sentinel"
  done
  # The closing GM password check: the fake classic-level and an administrator password. No world has a users
  # database (a bundle brings none), so the check finds every world "never launched".
  fake_classic_level
  fake_admin_password
  chown -R "$FOUNDRY_USER:$FOUNDRY_USER" "$FOUNDRY_DATA"
  mkdir -p "$TOOL_ETC" "$TOOL_DIR/app" "$TOOL_DIR/gm-browser" "$TOOL_DATA"
  install -m 644 "$H/stage11-provision.mjs" "$TOOL_DIR/gm-browser/assistant-gm.mjs"
  printf 'ASSISTANT_GM_USER="Assistant GM"\nASSISTANT_GM_PASSWORD="asecret"\n' >"$TOOL_ETC/assistant-gm.env"
  for w in curse-of-strahd strahd-kit; do
    printf 'GM_USER="Gamemaster"\nGM_PASSWORD="gsecret1"\n' >"$TOOL_ETC/world-$w.env"
  done
  chmod 600 "$TOOL_ETC"/*.env
  chown -R "$FOUNDRY_USER:$FOUNDRY_USER" "$TOOL_DATA"
  : >/tmp/calls
  # lib.sh's require_quiet reads /api/status before the stage stops Foundry: nobody is online here.
  printf '%s' '{"active":true,"users":0}' >/tmp/status
  printf '%s' 0 >/tmp/status_rc
  : >/tmp/out.first
  : >/tmp/out.last
  : >/tmp/provision
  chmod 666 /tmp/provision # the fake runs as the foundry user
}

# A bundle tar the way scripts/pi/push-world.ps1 builds it (tar -cf <bundle> -C <stage> . : entries start with ./):
# MANIFEST.txt (plus the line in $manifest_extra, if a scenario set one), a module folder for $bundle_module if a
# scenario set one, SHA256SUMS over every file under Data/, Data/worlds/<id>/world.json and one data file.
# Sets BUNDLE_PATH. $1 the world id.
make_bundle() {
  local w="$1" src=/tmp/bundle-src
  rm -rf "${src:?}"
  mkdir -p "$src/Data/worlds/$w/data"
  printf '{"id":"%s","title":"%s (bundle)"}\n' "$w" "$w" >"$src/Data/worlds/$w/world.json"
  echo "bundle copy of $w" >"$src/Data/worlds/$w/data/note.txt"
  printf 'world: %s\nmodules:\nasset folders:\nfiles: 2\n' "$w" >"$src/MANIFEST.txt"
  [ -z "$manifest_extra" ] || printf '%s\n' "$manifest_extra" >>"$src/MANIFEST.txt"
  if [ -n "$bundle_module" ]; then
    mkdir -p "$src/Data/modules/$bundle_module"
    echo '{"id":"'"$bundle_module"'","version":"1.1.0"}' >"$src/Data/modules/$bundle_module/module.json"
  fi
  if [ "$bundle_assets" = 1 ]; then
    mkdir -p "$src/Data/ddb-images"
    echo "bundle pic" >"$src/Data/ddb-images/pic.png"
    echo "bundle new" >"$src/Data/ddb-images/new.png"
  fi
  (cd "$src" && find Data -type f | LC_ALL=C sort | xargs sha256sum >SHA256SUMS)
  install -d -m 700 "$IMPORT"
  BUNDLE_PATH="$IMPORT/$w-$RANDOM.tar"
  tar -cf "$BUNDLE_PATH" -C "$src" .
}

# Builds a bundle of world $1 and runs the stage with the environment words after it.
run_stage() {
  local bw="$1"
  shift
  make_bundle "$bw"
  (
    set +o pipefail
    cd /root && cat "$LIB" "$LIBGM" "$STAGE" | env BUNDLE="$BUNDLE_PATH" "$@" bash -s
  ) 2>&1
}

# Env files without a password value: name, mode, owner, key names in order, a short hash of the file and of its
# GM_PASSWORD line (to compare across runs).
env_state() {
  local f
  for f in "$TOOL_ETC"/world-*.env; do
    [ -f "$f" ] || continue
    echo "$(basename "$f") $(stat -c 'mode=%a owner=%U' "$f") keys=$(cut -d= -f1 "$f" | paste -sd, -) sha=$(sha256sum "$f" | cut -c1-12) gmpw=$(grep '^GM_PASSWORD=' "$f" | sha256sum | cut -c1-12)"
  done
}

# yes when any password in the env files (or the fixed fake ones) appears in the given output files.
leak_check() {
  local f p leak=no
  local pws="gsecret1 asecret"
  for f in "$TOOL_ETC"/*.env; do
    [ -f "$f" ] || continue
    pws="$pws $(grep 'PASSWORD=' "$f" | cut -d'"' -f2 | tr '\n' ' ')"
  done
  for p in $pws; do
    [ -n "$p" ] || continue
    if cat "$@" | grep -qF -e "$p"; then leak=yes; fi
  done
  echo "$leak"
}

give_other_extra() {
  printf 'EXTRA_GM_USER="Other"\nEXTRA_GM_PASSWORD="osecret"\n' >>"$TOOL_ETC/world-curse-of-strahd.env"
}

# Fixtures for how set_world writes options.json (as the foundry user, through a temp file and a rename) and for the
# refusals before anything stops. Same names and meaning as in kit-session-scenarios.sh.
options600() { chmod 600 "$FOUNDRY_DATA/Config/options.json"; } # it must keep mode 600 and its owner
# The Config folder is root's: the foundry user cannot write the temp file, so the run is refused up front.
options_readonly() {
  chown root:root "$FOUNDRY_DATA/Config"
  chmod 755 "$FOUNDRY_DATA/Config"
}
# A file root must never touch, reached through a link the foundry user left at the temp name set_world uses.
plant_link() {
  echo victim >/tmp/victim-file
  chmod 644 /tmp/victim-file
  ln -s /tmp/victim-file "$FOUNDRY_DATA/Config/options.json.foundry-tmp"
  chown -h "$FOUNDRY_USER:$FOUNDRY_USER" "$FOUNDRY_DATA/Config/options.json.foundry-tmp"
}
# The bundle ships an asset folder (ddb-images with pic.png and new.png). assets_file: the Pi has its own, different
# pic.png (a regular file); assets_link: the Pi's pic.png is a link the foundry user left, to a root file the merge
# must never write through.
assets_file() {
  bundle_assets=1
  mkdir -p "$data/ddb-images"
  echo "pi pic" >"$data/ddb-images/pic.png"
  chown -R "$FOUNDRY_USER:$FOUNDRY_USER" "$data/ddb-images"
}
assets_link() {
  bundle_assets=1
  echo victim >/tmp/victim-file
  chmod 644 /tmp/victim-file
  mkdir -p "$data/ddb-images"
  ln -s /tmp/victim-file "$data/ddb-images/pic.png"
  chown -R -h "$FOUNDRY_USER:$FOUNDRY_USER" "$data/ddb-images"
}
# The Pi's asset folder itself is a link (to a folder outside the data tree): refused before anything stops.
assets_dirlink() {
  bundle_assets=1
  mkdir -p /tmp/elsewhere
  ln -s /tmp/elsewhere "$data/ddb-images"
  chown -h "$FOUNDRY_USER:$FOUNDRY_USER" "$data/ddb-images"
}
# A folder below the Pi's asset folder is a link (to a folder outside the data tree): refused too.
assets_deeplink() {
  bundle_assets=1
  mkdir -p /tmp/elsewhere "$data/ddb-images"
  ln -s /tmp/elsewhere "$data/ddb-images/adventures"
  chown -R -h "$FOUNDRY_USER:$FOUNDRY_USER" "$data/ddb-images"
}
# A kit session is up (kit-session.sh wrote its state file): this stage must not switch the world under it.
kit_session_up() { printf 'STAMP=20261013-074544\n' >"$TOOL_DATA/kit-session.env"; }
# No Node where stage 2 puts it. fresh_pi links it again for the next scenario.
no_node() { rm -f /opt/node24/bin/node; }

# A module the Pi already has from the campaign bundle, named in the MANIFEST's pi-modules: line (a second world
# that uses it without shipping it). $1 the Pi's version, $2 the line's entry. The sentinel proves the stage never
# replaces the Pi's copy.
pimod_setup() {
  mkdir -p "$data/modules/aitool-content"
  echo '{"id":"aitool-content","version":"'"$1"'"}' >"$data/modules/aitool-content/module.json"
  echo "the Pi's own aitool-content" >"$data/modules/aitool-content/sentinel"
  chown -R "$FOUNDRY_USER:$FOUNDRY_USER" "$data/modules/aitool-content"
  manifest_extra="pi-modules: $2"
}
pimod_installed() { pimod_setup 1.0.0 aitool-content@1.0.0; }  # the same version
pimod_newer() { pimod_setup 1.2.0 aitool-content@1.1.0; }      # the Pi is ahead of the PC
pimod_older() { pimod_setup 1.0.0 aitool-content@1.1.0; }      # the Pi is behind the PC: refused
pimod_unsure() { pimod_setup 1.0.0 aitool-content@beta; }      # not comparable: a warning
pimod_legacy() { pimod_setup 1.0.0 aitool-content; }           # an older push-world.ps1: no version, a warning
# The same line, but the Pi does not have the module.
pimod_missing() {
  manifest_extra="pi-modules: aitool-content@1.0.0"
}

pimod_suffix_older() { pimod_setup 2.10.5-aitool.3 aitool-content@2.10.5-aitool.4; } # same numbers, lower -aitool.n on the Pi: refused
pimod_suffix_newer() { pimod_setup 2.10.5-aitool.5 aitool-content@2.10.5-aitool.4; } # higher -aitool.n on the Pi: fine

# An installed world $1 that is not a kit copy of anything (a real world: no kitOf marker). The sentinel proves the
# stage never resets it.
installed_world() {
  mkdir -p "$data/worlds/$1/data"
  echo '{"id":"'"$1"'","title":"'"$1"' (on the Pi)"}' >"$data/worlds/$1/world.json"
  echo "the Pi's own $1" >"$data/worlds/$1/sentinel"
  chown -R "$FOUNDRY_USER:$FOUNDRY_USER" "$data/worlds/$1"
}
# The Assistant GM driver of a Pi whose stage 5 ran before D-118: the stand-in with the extra GM variables stripped
# (the real old driver ignored PROVISION_EXTRA_GM_USER and PROVISION_EXTRA_GM_PASSWORD).
old_driver() {
  sed 's/PROVISION_EXTRA_GM_/IGNORED_EXTRA_GM_/g' "$H/stage11-provision.mjs" >"$TOOL_DIR/gm-browser/assistant-gm.mjs"
}
# The old driver, and an env file for the training world that already names an extra GM (an earlier run wrote it).
old_driver_env() {
  old_driver
  printf 'GM_USER="Gamemaster"\nGM_PASSWORD="gsecret1"\nEXTRA_GM_USER="Claude"\nEXTRA_GM_PASSWORD="xsecret"\n' >"$TOOL_ETC/world-frostmaiden-training.env"
  chmod 600 "$TOOL_ETC/world-frostmaiden-training.env"
}
training_installed() { installed_world frostmaiden-training; }
frost_kit_unmarked() { installed_world frost-kit; }

# The bundle ships aitool-content 1.1.0 while the Pi has its own 1.2.0 (with a sentinel, as after the campaign bundle).
ship_module() {
  mkdir -p "$data/modules/aitool-content"
  echo '{"id":"aitool-content","version":"1.2.0"}' >"$data/modules/aitool-content/module.json"
  echo "the Pi's own aitool-content" >"$data/modules/aitool-content/sentinel"
  chown -R "$FOUNDRY_USER:$FOUNDRY_USER" "$data/modules/aitool-content"
  bundle_module=aitool-content
}
# The fake Assistant GM fails its first provisioning call (a Chromium hiccup), then works.
provision_fails_once() {
  echo 1 >/tmp/provfail
  chmod 666 /tmp/provfail
}

# name, the world the bundle holds, a setup function ("-" for none), then the environment for the stage
# (KEY=VALUE words; "rerun" runs the stage a second time on the same Pi with a new copy of the bundle).
scenario() {
  local name="$1" bw="$2" setup="$3"
  shift 3
  if [ -n "$only" ] && [[ " $only " != *" $name "* ]]; then return 0; fi
  # "RERUN:KEY=VALUE" words apply to the second run only (they come after the others, so they win).
  local rerun=0 env_words=() rerun_words=() w
  for w in "$@"; do
    case "$w" in
      rerun) rerun=1 ;;
      RERUN:*) rerun_words+=("${w#RERUN:}") ;;
      *) env_words+=("$w") ;;
    esac
  done
  fresh_pi
  [ "$setup" = - ] || "$setup"
  echo "=== SCENARIO $name"
  echo "--- env before"
  env_state
  if [ "$rerun" = 1 ]; then
    run_stage "$bw" "${env_words[@]}" >/tmp/out.first
    local first_rc=$?
    echo "--- first run"
    echo "exit $first_rc"
    env_state
  fi
  run_stage "$bw" "${env_words[@]}" "${rerun_words[@]}" >/tmp/out.last
  local rc=$?
  echo "--- output"
  cat /tmp/out.last
  echo "--- exit $rc"
  echo "--- calls"
  cat /tmp/calls
  echo "--- provision"
  cat /tmp/provision
  echo "--- options.json"
  node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).world+"\n")' "$FOUNDRY_DATA/Config/options.json"
  echo "--- options state"
  # Mode and owner of options.json after the run, and whether a temp file (or a link) is left at the temp name.
  echo "options mode $(stat -c %a "$FOUNDRY_DATA/Config/options.json") owner $(stat -c %U "$FOUNDRY_DATA/Config/options.json") tmp $([ -e "$FOUNDRY_DATA/Config/options.json.foundry-tmp" ] || [ -L "$FOUNDRY_DATA/Config/options.json.foundry-tmp" ] && echo present || echo absent)"
  echo "--- victim"
  if [ -f /tmp/victim-file ]; then
    echo "victim $(stat -c %U:%G:%a /tmp/victim-file) $(cat /tmp/victim-file)"
  else
    echo none
  fi
  echo "--- assets"
  for f in pic.png new.png; do
    p="$data/ddb-images/$f"
    if [ -e "$p" ] || [ -L "$p" ]; then
      echo "$f $([ -L "$p" ] && echo link || echo file) $(stat -c %U "$p") $(cat "$p")"
    else
      echo "$f none"
    fi
  done
  echo "--- env after"
  env_state
  echo "--- pending"
  ls "$TOOL_ETC" | grep '\.pending$' || true
  echo "--- sentinels"
  for w in curse-of-strahd strahd-kit; do
    if [ -f "$data/worlds/$w/sentinel" ]; then echo "$w yes"; else echo "$w no"; fi
  done
  for w in frostmaiden-training frost-kit; do
    if [ -d "$data/worlds/$w" ]; then
      if [ -f "$data/worlds/$w/sentinel" ]; then echo "$w yes"; else echo "$w no"; fi
    fi
  done
  echo "--- kitof"
  for w in "$data"/worlds/*/; do
    node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]+"world.json","utf8"));const f=j.flags&&j.flags["foundry-ai-tool"];console.log(j.id+" kitOf="+((f&&f.kitOf)||"-"))' "$w"
  done
  echo "--- worlds"
  for w in "$data"/worlds/*/; do
    node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]+"world.json","utf8"));console.log(j.id+"="+j.title)' "$w"
  done
  echo "--- modules"
  for w in "$data"/modules/*/; do
    [ -d "$w" ] || continue
    if [ -f "$w/sentinel" ]; then echo "$(basename "$w") yes"; else echo "$(basename "$w") no"; fi
  done
  echo "--- leak"
  leak_check /tmp/out.last /tmp/out.first
  echo "=== END $name"
}

only="$*"
scenario training frostmaiden-training - WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd EXTRA_GM_USER=Claude
scenario training-rerun frostmaiden-training - WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd EXTRA_GM_USER=Claude rerun
scenario kept-gains-extra curse-of-strahd - KIT_WORLD= EXTRA_GM_USER=Claude
scenario extra-conflict curse-of-strahd give_other_extra KIT_WORLD= EXTRA_GM_USER=Claude
scenario extra-is-gm curse-of-strahd - KIT_WORLD= EXTRA_GM_USER=Gamemaster
scenario extra-is-assistant curse-of-strahd - KIT_WORLD= "EXTRA_GM_USER=Assistant GM"
scenario kit-default-refused frostmaiden-training - WORLD=frostmaiden-training
scenario kit-needs-title frostmaiden-training - WORLD=frostmaiden-training KIT_WORLD=frost-kit
scenario launch-not-installed frostmaiden-training - WORLD=frostmaiden-training KIT_WORLD= LAUNCH=nope
scenario pi-modules-installed frostmaiden-training pimod_installed WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd EXTRA_GM_USER=Claude
scenario pi-modules-missing frostmaiden-training pimod_missing WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd EXTRA_GM_USER=Claude
scenario launch-omitted frostmaiden-training - WORLD=frostmaiden-training KIT_WORLD= EXTRA_GM_USER=Claude
scenario kit-is-campaign frostmaiden-training - WORLD=frostmaiden-training KIT_WORLD=curse-of-strahd "KIT_TITLE=Frost kit" LAUNCH=curse-of-strahd
scenario kit-is-launch frostmaiden-training - WORLD=frostmaiden-training KIT_WORLD=frost-kit "KIT_TITLE=Frost kit" LAUNCH=frost-kit
scenario kit-is-strahd-kit frostmaiden-training - WORLD=frostmaiden-training KIT_WORLD=strahd-kit "KIT_TITLE=Frost kit" LAUNCH=curse-of-strahd
scenario launch-empty frostmaiden-training - WORLD=frostmaiden-training KIT_WORLD= LAUNCH= EXTRA_GM_USER=Claude
scenario extra-trailing-space frostmaiden-training - WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd "EXTRA_GM_USER=Claude "
scenario ship-modules-refused frostmaiden-training ship_module WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd EXTRA_GM_USER=Claude
scenario ship-modules-allowed frostmaiden-training ship_module WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd EXTRA_GM_USER=Claude SHIP_MODULES=1
scenario pi-modules-newer frostmaiden-training pimod_newer WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd
scenario pi-modules-older frostmaiden-training pimod_older WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd
scenario pi-modules-unsure frostmaiden-training pimod_unsure WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd
scenario pi-modules-legacy frostmaiden-training pimod_legacy WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd
scenario ship-campaign-launch-kit curse-of-strahd ship_module LAUNCH=strahd-kit
scenario ship-second-launch-self frostmaiden-training ship_module WORLD=frostmaiden-training KIT_WORLD= LAUNCH=frostmaiden-training
scenario provision-fails-campaign curse-of-strahd provision_fails_once REPLACE_WORLD=1 RERUN:REPLACE_WORLD=0 rerun
scenario provision-fails-then-rerun frostmaiden-training provision_fails_once WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd EXTRA_GM_USER=Claude rerun
scenario strahd-default curse-of-strahd - REPLACE_WORLD=1
scenario kit-names-installed curse-of-strahd training_installed KIT_WORLD=frostmaiden-training KIT_TITLE=x
scenario kit-names-installed-replace curse-of-strahd training_installed KIT_WORLD=frostmaiden-training KIT_TITLE=x REPLACE_KIT=1
scenario kit-copy-rerun frostmaiden-training - WORLD=frostmaiden-training KIT_WORLD=frost-kit "KIT_TITLE=Frost kit" LAUNCH=curse-of-strahd rerun
scenario kit-unmarked frostmaiden-training frost_kit_unmarked WORLD=frostmaiden-training KIT_WORLD=frost-kit "KIT_TITLE=Frost kit" LAUNCH=curse-of-strahd
scenario kit-is-strahd-kit-replace frostmaiden-training - WORLD=frostmaiden-training KIT_WORLD=strahd-kit "KIT_TITLE=Frost kit" LAUNCH=curse-of-strahd REPLACE_KIT=1
scenario pi-modules-suffix-older frostmaiden-training pimod_suffix_older WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd
scenario pi-modules-suffix-newer frostmaiden-training pimod_suffix_newer WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd
scenario old-driver-extra frostmaiden-training old_driver WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd EXTRA_GM_USER=Claude
scenario old-driver-env frostmaiden-training old_driver_env WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd
scenario old-driver-plain frostmaiden-training old_driver WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd
# How options.json is written (the foundry user, a temp file, a rename) and the up-front refusals. LAUNCH=strahd-kit
# makes the world actually change, so a write that went wrong shows. The campaign bundle ships no module here.
scenario world-switch curse-of-strahd - LAUNCH=strahd-kit
scenario options-600 curse-of-strahd options600 LAUNCH=strahd-kit
scenario options-readonly curse-of-strahd options_readonly LAUNCH=strahd-kit
scenario plant-link curse-of-strahd plant_link LAUNCH=strahd-kit
# The asset merge: a changed file is replaced (and saved to prev), a new one added; a link at a destination name is
# replaced by the bundle's file and its target is not written.
scenario assets-merge curse-of-strahd assets_file LAUNCH=strahd-kit
scenario assets-link curse-of-strahd assets_link LAUNCH=strahd-kit
scenario assets-dirlink curse-of-strahd assets_dirlink LAUNCH=strahd-kit
scenario assets-deeplink curse-of-strahd assets_deeplink LAUNCH=strahd-kit
scenario kit-session-up curse-of-strahd kit_session_up LAUNCH=strahd-kit
scenario no-node curse-of-strahd no_node LAUNCH=strahd-kit
echo "=== ALL DONE"
