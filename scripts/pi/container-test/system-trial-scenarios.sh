#!/usr/bin/env bash
# Stage 14 (scripts/pi/remote/14-system-trial.sh) in a Debian 13 ARM64 container with no systemd: stand-ins for
# systemctl, curl (/api/status, /join and the release download), journalctl and sleep make it take its systemd
# path, and a fake Foundry (bin/fake-foundry-open, run by the fake systemctl on every start) writes into the world
# options.json names and migrates its world.json to the installed dnd5e version. Each scenario starts from a fresh
# fake Pi, runs the stage one or more times and prints one block that scripts/pi/system-trial.test.mjs reads:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" <IMAGE> bash /repo/scripts/pi/container-test/system-trial-scenarios.sh [name ...]
# (<IMAGE> is the pinned Debian 13 image in system-trial.test.mjs.) With names, only those scenarios run.
# Nothing here reaches the network after apt-get: the "release" is a zip built here, and the stage runs from a copy
# whose PIN_SHA256 line holds that zip's sha256 (the real pin is the real release's). The stage's node snippets run
# on Debian 13's own nodejs (20.x) linked as /opt/node24/bin/node, not Node 24 as on the Pi.
#
# DESTRUCTIVE: each scenario wipes the Foundry data folder and the import folder, and the fakes go into
# /usr/local/sbin. It refuses to run anywhere but a container.
set -uo pipefail

# Every scenario, in the order they run (system-trial.test.mjs reads this list to split them over containers).
SCENARIOS=(
  trial-download trial-zip trial-zip-nested zip-outside-import zip-missing download-fails bad-sha bad-sha-zip
  zip-too-new zip-max-below zip-wrong-version already-installed newer-installed kit-launched second-trial
  trial-fails rollback rollback-migrated-refused rollback-restore-migrated rollback-world-created rollback-halfway
  rollback-no-trial trial-again switch switch-fails switch-twice switch-no-trial rollback-after-switch status
  status-no-trial online-refused online-force status-unreadable bad-env
)

[ -f /.dockerenv ] || [ -n "${container:-}" ] || {
  echo "REFUSED: run this only in the test container (docker run ..., see the header)"
  exit 98
}

H=/repo/scripts/pi/container-test
STAGE=/repo/scripts/pi/remote/14-system-trial.sh
LIB=/repo/scripts/pi/remote/lib.sh

export DEBIAN_FRONTEND=noninteractive
apt_setup() { apt-get update && apt-get install -y --no-install-recommends nodejs zip unzip ca-certificates; }
# One retry: a Debian mirror hiccup should not fail a required CI check.
{ apt_setup || { /bin/sleep 20 && apt_setup; }; } >/dev/null 2>&1 || {
  echo "SETUP FAILED: apt-get"
  exit 99
}
mkdir -p /opt/node24/bin
ln -sf "$(command -v node)" /opt/node24/bin/node
for f in systemctl curl journalctl sleep fake-foundry-open; do install -m 755 "$H/bin/$f" "/usr/local/sbin/$f"; done
mkdir -p /run/systemd/system # have_systemd() looks for this folder

eval "$(grep -E '^(FOUNDRY_USER|FOUNDRY_APP|FOUNDRY_DATA)=' "$LIB")"
IMPORT=/var/lib/foundry-import
TRIAL="$IMPORT/system-trial"
id "$FOUNDRY_USER" >/dev/null 2>&1 || useradd --system --home-dir "$FOUNDRY_DATA" --shell /usr/sbin/nologin "$FOUNDRY_USER"
data="$FOUNDRY_DATA/Data"
sysdir="$data/systems/dnd5e"

# A dnd5e folder: system.json, a file that says which version it is, and a language file.
# $1 folder, $2 version, $3 compatibility.minimum, $4 compatibility.maximum ("" for none)
make_system() {
  local maxpart=""
  [ -z "$4" ] || maxpart=",\"maximum\":\"$4\""
  mkdir -p "$1/lang"
  printf '{"id":"dnd5e","version":"%s","compatibility":{"minimum":"%s","verified":"14.368"%s}}\n' "$2" "$3" "$maxpart" >"$1/system.json"
  echo "dnd5e $2 files" >"$1/release.txt"
  echo '{}' >"$1/lang/en.json"
}

# The release zips under /tmp/zips (outside the import folder, which every scenario wipes).
# $1 name, $2 version, $3 compatibility.minimum, $4 compatibility.maximum, $5 flat (system.json at the top) or
# nested (inside a dnd5e folder)
make_zip() {
  local src="/tmp/zip-src/$1"
  rm -rf "${src:?}"
  make_system "$src/dnd5e" "$2" "$3" "$4"
  if [ "$5" = nested ]; then
    (cd "$src" && zip -qr "/tmp/zips/$1.zip" dnd5e)
  else
    (cd "$src/dnd5e" && zip -qr "/tmp/zips/$1.zip" .)
  fi
}
rm -rf /tmp/zips /tmp/zip-src
mkdir -p /tmp/zips
make_zip good 6.0.6 14.367 14 flat
make_zip nested 6.0.6 14.367 14 nested
make_zip toonew 6.0.6 14.369 14 flat
make_zip maxbelow 6.0.6 14.300 13 flat
make_zip wrongver 6.0.7 14.367 14 flat
# The release with one more file in it: same name, other bytes.
make_zip tampered 6.0.6 14.367 14 flat
echo "not in the release" >/tmp/zip-src/tampered/dnd5e/extra.txt
(cd /tmp/zip-src/tampered/dnd5e && rm -f /tmp/zips/tampered.zip && zip -qr /tmp/zips/tampered.zip .)

pin_zip=good # the zip whose sha256 the stage under test is pinned to
serve() { echo "/tmp/zips/$1.zip" >/tmp/download_zip; } # what the fake curl delivers for the download

fresh_pi() {
  rm -rf "${FOUNDRY_DATA:?}" "${IMPORT:?}"
  rm -f /tmp/stopped-* /tmp/gmbroken /tmp/join_fail /tmp/downloads /tmp/download_zip /tmp/calls /tmp/out.last
  mkdir -p "$data/worlds" "$FOUNDRY_DATA/Config" "$FOUNDRY_APP"
  echo '{"version":"14.368.0"}' >"$FOUNDRY_APP/package.json"
  echo '{"port":30000,"world":"curse-of-strahd"}' >"$FOUNDRY_DATA/Config/options.json"
  make_system "$sysdir" 6.0.5 14.359 ""
  echo 'not a world' >"$data/worlds/README.txt"
  local w
  for w in curse-of-strahd strahd-kit frostmaiden-training pi-check; do
    mkdir -p "$data/worlds/$w/data"
    printf '{"id":"%s","title":"%s","system":"dnd5e","systemVersion":"6.0.5"}\n' "$w" "$w" >"$data/worlds/$w/world.json"
    echo original >"$data/worlds/$w/data/marker.txt"
    echo "leveldb log of $w" >"$data/worlds/$w/data/LOG"
  done
  chown -R "$FOUNDRY_USER:$FOUNDRY_USER" "$FOUNDRY_DATA"
  touch /tmp/fake_foundry_opens
  printf '{"users":0,"systemVersion":"@SYSVER@"}' >/tmp/status
  printf '0' >/tmp/status_rc
  pin_zip=good
  serve good
  : >/tmp/calls
}

# What the Pi looks like now, one fact per line (stamps are replaced by STAMP, so the block can be compared).
snap() { # $1 label
  echo "--- $1 state"
  local f id w stopped trial_state trial_dir
  {
    echo "system $(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$sysdir/system.json" 2>/dev/null | head -n1) ($(cat "$sysdir/release.txt" 2>/dev/null))"
    echo "options $(sed -n 's/.*"world": *"\([^"]*\)".*/\1/p' "$FOUNDRY_DATA/Config/options.json")"
    stopped="$(ls /tmp/stopped-* 2>/dev/null | sed 's#/tmp/stopped-##' | paste -sd' ' -)"
    echo "stopped ${stopped:-none}"
    for w in "$data"/worlds/*/; do
      id="$(basename "$w")"
      echo "world $id systemVersion=$(sed -n 's/.*"systemVersion": *"\([^"]*\)".*/\1/p' "$w/world.json") marker=$(cat "$w/data/marker.txt" 2>/dev/null || echo -) files=$(ls "$w/data" | paste -sd, -) opened=$(cat "$w/data/opened-by-foundry.txt" 2>/dev/null || echo -)"
    done
    f="$(ls "$IMPORT"/*.zip "$IMPORT"/*.part 2>/dev/null | xargs -r -n1 basename | paste -sd' ' -)"
    echo "zips ${f:-none}"
    f="$(ls -d "$IMPORT"/work-* 2>/dev/null | xargs -r -n1 basename | paste -sd' ' -)"
    echo "work ${f:-none}"
    if [ -d "$TRIAL" ]; then
      trial_state="$(sort "$TRIAL/state" 2>/dev/null | paste -sd';' -)"
      trial_dir="$(ls "$TRIAL" | paste -sd' ' -)"
      echo "trial-state ${trial_state:-none}"
      echo "trial-dir $trial_dir"
      for w in "$TRIAL"/worlds/*/; do
        [ -d "$w" ] || continue
        echo "trial-copy $(basename "$w") systemVersion=$(sed -n 's/.*"systemVersion": *"\([^"]*\)".*/\1/p' "$w/world.json") marker=$(cat "$w/data/marker.txt" 2>/dev/null || echo -) files=$(ls "$w/data" | paste -sd, -)"
      done
    else
      echo "trial-state none"
    fi
    (cd "$IMPORT" 2>/dev/null && for f in prev-*; do [ -e "$f" ] && find "$f" -maxdepth 3 \( -path '*/dnd5e-*/*' -o -path '*/trial/*/*' -o -path '*/worlds/*/*' \) -prune -o -print; done | sort | sed 's/^/prev /') || true
  } | sed -E 's/[0-9]{8}-[0-9]{6}/STAMP/g'
}

# Runs the stage on a copy whose PIN_SHA256 is the sha256 of $pin_zip, with the env words after the label, then
# prints the run's block: exit code, output, systemctl calls, download urls and the Pi's state afterwards.
run_stage() { # $1 label, then KEY=VALUE words for the stage
  local label="$1" rc sha
  shift
  sha="$(sha256sum "/tmp/zips/$pin_zip.zip" | cut -d' ' -f1)"
  sed "s/^PIN_SHA256=.*/PIN_SHA256=$sha/" "$STAGE" >/tmp/stage14.sh
  grep -q "^PIN_SHA256=$sha\$" /tmp/stage14.sh || {
    echo "SETUP FAILED: the PIN_SHA256 line of the stage"
    exit 97
  }
  : >/tmp/calls
  rm -f /tmp/downloads
  (
    set +o pipefail
    cd /root && cat "$LIB" /tmp/stage14.sh | env "$@" bash -s
  ) >/tmp/out.last 2>&1
  rc=$?
  echo "--- $label exit"
  echo "$rc"
  echo "--- $label output"
  cat /tmp/out.last
  echo "--- $label calls"
  grep -v '^journalctl' /tmp/calls || true
  echo "--- $label downloads"
  cat /tmp/downloads 2>/dev/null || true
  snap "$label"
}

# Time passes between steps, so that a file Foundry writes is newer than the trial's marker.
later() { /bin/sleep 1; }
# The kit run: Foundry opens strahd-kit and the run adds a file to it.
kit_run() {
  later
  fake-foundry-open strahd-kit
  echo "kit run result" >"$data/worlds/strahd-kit/data/kit-run.txt"
}
# Someone launches another world during the trial.
launch_world() {
  later
  fake-foundry-open "$1"
}
set_installed_version() { sed -i "s/\"version\":\"[^\"]*\"/\"version\":\"$1\"/" "$sysdir/system.json"; }
with_zip() { # $1 name of a zip in /tmp/zips: copy it to the import folder as mine.zip
  install -d -m 700 "$IMPORT"
  cp "/tmp/zips/$1.zip" "$IMPORT/mine.zip"
}
MINE="$IMPORT/mine.zip"

# ---- scenarios ---------------------------------------------------------------------------------------------------
s_trial_download() { run_stage trial MODE=trial; }
s_trial_zip() {
  with_zip good
  run_stage trial MODE=trial ZIP="$MINE"
}
s_trial_zip_nested() {
  pin_zip=nested
  with_zip nested
  run_stage trial MODE=trial ZIP="$MINE"
}
s_zip_outside_import() { run_stage trial MODE=trial ZIP=/tmp/zips/good.zip; }
s_zip_missing() { run_stage trial MODE=trial ZIP="$IMPORT/nope.zip"; }
s_download_fails() {
  rm -f /tmp/download_zip
  run_stage trial MODE=trial
}
s_bad_sha() {
  serve tampered
  run_stage trial MODE=trial
}
s_bad_sha_zip() {
  with_zip tampered
  run_stage trial MODE=trial ZIP="$MINE"
}
s_zip_too_new() {
  pin_zip=toonew
  serve toonew
  run_stage trial MODE=trial
}
s_zip_max_below() {
  pin_zip=maxbelow
  serve maxbelow
  run_stage trial MODE=trial
}
s_zip_wrong_version() {
  pin_zip=wrongver
  serve wrongver
  run_stage trial MODE=trial
}
setup_already_installed() { set_installed_version 6.0.6; } # setup_<name> runs before the first state block
s_already_installed() { run_stage trial MODE=trial; }
setup_newer_installed() { set_installed_version 6.0.7; }
s_newer_installed() { run_stage trial MODE=trial; }
setup_kit_launched() { echo '{"port":30000,"world":"strahd-kit"}' >"$FOUNDRY_DATA/Config/options.json"; }
s_kit_launched() { run_stage trial MODE=trial; }
s_second_trial() {
  run_stage trial MODE=trial
  run_stage second MODE=trial
}
s_trial_fails() {
  touch /tmp/join_fail
  run_stage trial MODE=trial
}
s_rollback() {
  run_stage trial MODE=trial
  kit_run
  run_stage rollback MODE=rollback
}
s_rollback_migrated_refused() {
  run_stage trial MODE=trial
  kit_run
  launch_world frostmaiden-training
  snap before
  run_stage rollback MODE=rollback
}
s_rollback_restore_migrated() {
  run_stage trial MODE=trial
  kit_run
  launch_world frostmaiden-training
  run_stage rollback MODE=rollback RESTORE_MIGRATED=1
}
s_rollback_world_created() {
  run_stage trial MODE=trial
  kit_run
  mkdir -p "$data/worlds/new-world/data"
  echo '{"id":"new-world","title":"new-world","system":"dnd5e","systemVersion":"6.0.6"}' >"$data/worlds/new-world/world.json"
  run_stage rollback MODE=rollback
}
s_rollback_halfway() {
  run_stage trial MODE=trial
  kit_run
  touch /tmp/join_fail
  run_stage rollback MODE=rollback
  rm -f /tmp/join_fail
  run_stage rerun MODE=rollback
}
s_rollback_no_trial() { run_stage rollback MODE=rollback; }
s_trial_again() {
  run_stage trial MODE=trial
  kit_run
  run_stage rollback MODE=rollback
  run_stage again MODE=trial
}
s_switch() {
  run_stage trial MODE=trial
  kit_run
  run_stage switch MODE=switch
}
s_switch_fails() {
  run_stage trial MODE=trial
  kit_run
  touch /tmp/join_fail
  run_stage switch MODE=switch
}
s_switch_twice() {
  run_stage trial MODE=trial
  run_stage switch MODE=switch
  run_stage second MODE=switch
}
s_switch_no_trial() { run_stage switch MODE=switch; }
s_rollback_after_switch() {
  run_stage trial MODE=trial
  run_stage switch MODE=switch
  run_stage rollback MODE=rollback
}
s_status() {
  run_stage trial MODE=trial
  kit_run
  launch_world frostmaiden-training
  snap before
  run_stage status MODE=status
}
s_status_no_trial() { run_stage status MODE=status; }
s_online_refused() {
  printf '{"users":2,"systemVersion":"@SYSVER@"}' >/tmp/status
  run_stage trial MODE=trial
}
s_online_force() {
  printf '{"users":2,"systemVersion":"@SYSVER@"}' >/tmp/status
  run_stage trial MODE=trial FORCE=1
}
s_status_unreadable() {
  printf '' >/tmp/status
  printf '7' >/tmp/status_rc
  run_stage trial MODE=trial
}
s_bad_env() {
  run_stage no_mode
  run_stage bogus_mode MODE=bogus
  run_stage force_2 MODE=trial FORCE=2
  run_stage restore_2 MODE=rollback RESTORE_MIGRATED=2
  run_stage restore_in_trial MODE=trial RESTORE_MIGRATED=1
  run_stage zip_in_rollback MODE=rollback ZIP=/var/lib/foundry-import/x.zip
  run_stage zip_in_switch MODE=switch ZIP=/var/lib/foundry-import/x.zip
}

only="$*"
run_scenario() { # $1 name
  if [ -n "$only" ] && [[ " $only " != *" $1 "* ]]; then return 0; fi
  fresh_pi
  if declare -F "setup_${1//-/_}" >/dev/null; then "setup_${1//-/_}"; fi
  echo "=== SCENARIO $1"
  snap start
  "s_${1//-/_}"
  echo "=== END $1"
}
for name in "${SCENARIOS[@]}"; do
  run_scenario "$name"
done
echo "=== ALL DONE"
