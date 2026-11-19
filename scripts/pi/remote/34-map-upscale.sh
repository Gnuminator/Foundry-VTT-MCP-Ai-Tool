#!/usr/bin/env bash
# Stage 34: the sharper adventure maps in the Pi's real world (backlog map-upscale-pi, I-092; the trial and the measured
# fixes are in vault Design/Strahd map upscaling trial 2026-10-18.md). Three parts, run in this order, each its own MODE:
#   files    puts the 2x maps in $FOUNDRY_DATA/Data/assets/strahd-maps-2x/ (a new folder; every file is checked against the
#            manifest's sha256 before and after; a file that is already right is left alone). The originals under
#            ddb-images/ are never touched, so the old maps stay on disk (kept until after G1).
#   scale    the scene scale fixes (scene size of the isometric book maps, the grid of three scenes) through gm-script.sh
#   switch   points the scene backgrounds at the 2x files (the scene size, grid, walls, notes and tokens do not move)
#   revert   points the backgrounds back at the originals (the way back; the 2x files stay on disk)
#   scale-revert  puts the scene size and grid fixes back to the imported values (only a scene with exactly the fixed values)
# Read-only, any time and no snapshot: MODE=check (the files on disk against the manifest, and the free space) and
# MODE=scenes-check (a GM dry run that reports which scenes are fixed, still as imported or odd; it stops the Assistant GM
# for a moment, so it refuses while players are online like the other GM runs).
#
# The scene names, map names and numbers are licensed material and stay on the PC: scripts/pi/map-upscale/prepare.mjs makes
# data.js (the DATA constant) and manifest.sha256 from them. Copy these to the Pi first (the maps are about 230 MB):
#   node scripts/pi/map-upscale/prepare.mjs --maps <2x folder> --switch <switch.json> --scale <scale.json> --out <outdir>
#   scp -r <2x folder> foundry-pi:/root/map-upscale/maps      (or: ssh foundry-pi mkdir -p /root/map-upscale, then scp)
#   scp <outdir>/data.js <outdir>/manifest.sha256 scripts/pi/remote/map-upscale-scenes.js foundry-pi:/root/map-upscale/
# Then, with a fresh dietpi-backup snapshot and the user's OK for each real step (bash, not PowerShell):
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/34-map-upscale.sh | ssh foundry-pi 'MODE=check bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/34-map-upscale.sh | ssh foundry-pi 'MODE=files bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/34-map-upscale.sh scripts/pi/remote/gm-script.sh | ssh foundry-pi 'MODE=scale bash -s'          (dry run)
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/34-map-upscale.sh scripts/pi/remote/gm-script.sh | ssh foundry-pi 'MODE=scale APPLY=1 bash -s'
#   the same with MODE=switch, and MODE=revert for the way back.
# Env: MODE (check, files, scale, switch, revert, scenes-check; default check); APPLY=1 for a real scale/switch/revert run
# (without it a dry run that changes nothing; any other APPLY value is refused); WORLD (curse-of-strahd, the world that must
# be running for the GM modes); SRC (the folder on the Pi, default /root/map-upscale); FOLDER (default assets/strahd-maps-2x,
# below the Foundry Data folder; must match the folder prepare.mjs put in data.js).
# The scene changes are in the world database; their way back is MODE=revert and MODE=scale-revert (the snapshot restores
# the whole Pi, play data included). Nothing is deleted.

require_root
trap '' HUP PIPE # a dropped ssh (HUP, closed pipe) must not kill the stage halfway through a step
export PATH="$NODE_DIR/bin:$PATH"

MODE="${MODE:-check}"
WORLD="${WORLD:-curse-of-strahd}"
SRC="${SRC:-/root/map-upscale}"
FOLDER="${FOLDER:-assets/strahd-maps-2x}"
[[ "$WORLD" =~ ^[a-z0-9-]+$ ]] || die "'$WORLD' is not a valid world id (lowercase letters, digits, dashes). Nothing was changed"
[[ "$FOLDER" =~ ^assets/[a-z0-9][a-z0-9._-]*$ ]] || die "FOLDER must look like assets/name (got '$FOLDER'). Nothing was changed"
case "${APPLY:-}" in "" | 1) ;; *) die "APPLY must be 1 or left out (got '${APPLY}'). Nothing was changed" ;; esac
case "$MODE" in
  check | scenes-check)
    [ -z "${APPLY:-}" ] || die "MODE=$MODE only reads and takes no APPLY. Nothing was changed"
    ;;
  files) [ -z "${APPLY:-}" ] || die "MODE=files writes at once (it is not a dry-run mode); leave APPLY out. Nothing was changed" ;;
  scale | scale-revert | switch | revert) ;;
  *) die "MODE must be check, files, scale, scale-revert, switch, revert or scenes-check (got '$MODE'). Nothing was changed" ;;
esac

manifest="$SRC/manifest.sha256"
maps="$SRC/maps"
dest="$FOUNDRY_DATA/Data/$FOLDER"

# A regular file that is not a link; the staging folder is root's, but a link there would still be followed by a copy.
plain_file() { [ -f "$1" ] && [ ! -L "$1" ]; }

# manifest_files: the file names in the manifest, after checking every line is "<64 hex>  <plain name>".
manifest_files() {
  plain_file "$manifest" || die "no $manifest: copy the manifest and the maps first (see the header). Nothing was changed"
  local bad
  bad="$(grep -Evc '^[0-9a-f]{64}  [A-Za-z0-9][A-Za-z0-9._-]*\.jpe?g$' "$manifest" || true)"
  [ "$bad" = 0 ] || die "$manifest has $bad line(s) that are not '<sha256>  <name>.jpg'. Nothing was changed"
  [ -s "$manifest" ] || die "$manifest is empty. Nothing was changed"
  cut -c67- "$manifest"
}

# verify_dir DIR LABEL: 0 when every manifest file is in DIR with the right hash. Reports the first few misses.
verify_dir() {
  local dir="$1" label="$2" bad=0 name want have n=0
  while read -r want name; do
    n=$((n + 1))
    if ! plain_file "$dir/$name"; then
      bad=$((bad + 1))
      [ "$bad" -gt 5 ] || warn "$label: $name is missing"
    else
      have="$(sha256sum "$dir/$name" | cut -d' ' -f1)"
      if [ "$have" != "$want" ]; then
        bad=$((bad + 1))
        [ "$bad" -gt 5 ] || warn "$label: $name has the wrong sha256"
      fi
    fi
  done <"$manifest"
  if [ "$bad" = 0 ]; then
    ok "$label: all $n files match the manifest"
    return 0
  fi
  warn "$label: $bad of $n files missing or wrong"
  return 1
}

case "$MODE" in
  check)
    manifest_files >/dev/null
    [ -d "$maps" ] && [ ! -L "$maps" ] && say "staged maps in $maps" && { verify_dir "$maps" "staged" || true; } || warn "no staged maps folder $maps"
    avail="$(df -Pk "$FOUNDRY_DATA" | awk 'NR==2{print $4}')"
    ok "free space on the Foundry data disk: $((avail / 1024)) MB"
    if [ -d "$dest" ]; then
      [ ! -L "$dest" ] || die "$dest is a symlink"
      say "installed maps in $dest"
      verify_dir "$dest" "installed" || exit 1
    else
      say "$dest does not exist yet (MODE=files creates it)"
      exit 1
    fi
    exit 0
    ;;
  files)
    id "$FOUNDRY_USER" >/dev/null 2>&1 || die "the $FOUNDRY_USER user is missing: run stage 1 first. Nothing was changed"
    require_recent_snapshot
    manifest_files >/dev/null
    [ -d "$maps" ] && [ ! -L "$maps" ] || die "no staged maps folder $maps (see the header). Nothing was changed"
    [ -d "$FOUNDRY_DATA/Data/assets" ] && [ ! -L "$FOUNDRY_DATA/Data/assets" ] || die "no $FOUNDRY_DATA/Data/assets: is this the Foundry data folder? Nothing was changed"
    foundry_can_write "$FOUNDRY_DATA/Data/assets" || die "the $FOUNDRY_USER user cannot write in $FOUNDRY_DATA/Data/assets. Nothing was changed"
    [ ! -L "$dest" ] || die "$dest is a symlink. Nothing was changed"
    say "checking the staged maps against the manifest"
    verify_dir "$maps" "staged" || die "the staged maps do not match the manifest (copy them again). Nothing was changed"
    need_kb=0
    while read -r _ name; do
      sz="$(stat -c %s "$maps/$name")"
      need_kb=$((need_kb + sz / 1024 + 1))
    done <"$manifest"
    avail="$(df -Pk "$FOUNDRY_DATA" | awk 'NR==2{print $4}')"
    [ "$avail" -gt "$((need_kb * 12 / 10 + 1048576))" ] || die "not enough free space on the Foundry data disk: $((avail / 1024)) MB free, the maps need $((need_kb / 1024)) MB plus 1 GB to spare. Nothing was changed"
    ok "free space $((avail / 1024)) MB, maps $((need_kb / 1024)) MB"
    # ---- changes start here: everything below is written as the foundry user, which owns the Foundry data
    runuser -u "$FOUNDRY_USER" -- mkdir -p "$dest" || die "could not create $dest"
    copied=0
    kept=0
    while read -r want name; do
      if plain_file "$dest/$name" && [ "$(sha256sum "$dest/$name" | cut -d' ' -f1)" = "$want" ]; then
        kept=$((kept + 1))
        continue
      fi
      # A temp name next to the target, renamed over it: a failure never leaves a half file under the real name.
      # (/root is closed to the foundry user, so root feeds the bytes in on stdin and the foundry user writes the file.)
      runuser -u "$FOUNDRY_USER" -- sh -c 't="$1.foundry-tmp"; rm -f "$t" && cat >"$t" && chmod 0644 "$t" && mv -f "$t" "$1"' sh "$dest/$name" <"$maps/$name" ||
        die "could not copy $name into $dest"
      [ "$(sha256sum "$dest/$name" | cut -d' ' -f1)" = "$want" ] || die "$name does not match its sha256 after the copy (the disk?). Stop here"
      copied=$((copied + 1))
    done <"$manifest"
    ok "copied $copied file(s), $kept already right"
    verify_dir "$dest" "installed" || die "the installed maps do not match the manifest"
    say "done: $dest holds the 2x maps; the originals under ddb-images/ are untouched. Next: MODE=scale, then MODE=switch"
    exit 0
    ;;
  scale | scale-revert | switch | revert | scenes-check)
    case "$MODE" in
      scenes-check) map_mode=check ;;
      *) map_mode="$MODE" ;;
    esac
    have_systemd || die "needs systemd (the Pi, not a test container). Nothing was changed"
    [ "$MODE" = scenes-check ] || [ -z "${APPLY:-}" ] || require_recent_snapshot
    plain_file "$SRC/data.js" || die "no $SRC/data.js: copy the prepared files first (see the header). Nothing was changed"
    plain_file "$SRC/map-upscale-scenes.js" || die "no $SRC/map-upscale-scenes.js: scp scripts/pi/remote/map-upscale-scenes.js there. Nothing was changed"
    # A data file for another folder would point the scenes at files this stage did not check.
    grep -q "\"$FOLDER/" "$SRC/data.js" || die "$SRC/data.js has no path under $FOLDER/: prepare.mjs was run with another --folder. Nothing was changed"
    if [ "$map_mode" = switch ]; then
      # Switching only to files that are on disk and right (the script also asks Foundry for each file).
      manifest_files >/dev/null
      verify_dir "$dest" "installed" || die "the 2x maps are not installed (or differ from the manifest): run MODE=files first. Nothing was changed"
    fi
    [ -x "$NODE_DIR/bin/node" ] || die "no Node at $NODE_DIR: run stage 2 first"
    running="$(curl -fs --max-time 5 http://127.0.0.1:30000/api/status 2>/dev/null |
      "$NODE_DIR/bin/node" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const w=JSON.parse(s).world;process.stdout.write(typeof w==="string"?w:"")}catch{}})' 2>/dev/null || true)"
    [ -n "$running" ] || die "cannot read which world runs (/api/status on port 30000 has no world): start $WORLD first. Nothing was changed"
    [ "$running" = "$WORLD" ] || die "world $running is running, not $WORLD. Nothing was changed"
    ok "world $WORLD is running"
    require_quiet "the map script run"
    GM_SCRIPT=/root/map-upscale-run.js
    {
      printf "const MAP_MODE = '%s';\n" "$map_mode"
      cat "$SRC/data.js"
      printf '\n'
      cat "$SRC/map-upscale-scenes.js"
    } >"$GM_SCRIPT.new" && mv -f -- "$GM_SCRIPT.new" "$GM_SCRIPT" || die "could not write $GM_SCRIPT. Nothing was changed"
    if [ "$MODE" = scenes-check ] || [ -z "${APPLY:-}" ]; then
      DRY_RUN=1
      say "dry run of the $map_mode script (APPLY=1 for the real run of scale, scale-revert, switch or revert)"
    else
      DRY_RUN=""
      say "REAL run of the $map_mode script in $WORLD"
    fi
    export GM_SCRIPT DRY_RUN
    ;;
esac
