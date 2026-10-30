#!/usr/bin/env bash
# Stage 19: the join page look of a world (backlog join-page-look): a background picture and the World Description, the two
# things players see on /join before they log in. The picture is campaign art, so it is never in the repo: copy it and the
# description (an HTML file) to the Pi first and give the stage the picture's sha256.
#
# Why not a GM script: World Configuration (the "editWorld" request) needs the full Gamemaster role while a world runs
# (Foundry's setup view checks hasRole("GAMEMASTER")); the Assistant GM has role 3 and is refused. So the stage edits the
# world's world.json with Foundry stopped, as docs/dev/PI-SETUP.md describes for settings only a GM can reach.
#
# What it does, in this order, and stops before the next step when one fails:
#   1. refuses unless IMAGE_SRC is a regular file (not a link), EXPECT_SHA256 matches it, it is a webp (RIFF....WEBP) of at most
#      MAX_BYTES (5 MB), DESC_FILE is a regular file of at most 20 KB, the world folder and world.json exist and DEST_NAME is a plain
#      file name; a dry run stops after printing the current values and what would change (no snapshot, nothing stopped);
#   2. a real run needs a dietpi-backup snapshot from today and nobody online (lib.sh require_quiet: players, recording);
#   3. writes the current background and description to $TOOL_DATA/join-page-look/<time>-<world>-before.json (the undo);
#   4. stops the Assistant GM browser and Foundry, installs the picture next to world.json (owner foundry, mode 644; a different
#      picture already there is kept in the store and UNDO puts it back), sets "background" and "description" in world.json (other
#      keys untouched; temp file + rename), starts Foundry and waits for the join page, starts the Assistant GM browser again, and
#      checks that /join names the picture and the picture is served;
#      until the join page answers, any failure stops Foundry, puts world.json back and starts both services again; after that a
#      failing /join or picture check only reports (the edit stays). It also refuses during a system trial or a kit session, and
#      ignores a dropped SSH connection (HUP, PIPE) so Foundry is never left stopped halfway.
# Join Page Theme and Next Session are not touched. The same picture and description again change nothing.
#
# Modes (environment, before bash):
#   DRY_RUN=1  print the current values and the plan; changes nothing, needs no snapshot
#   UNDO=1     put the "before" values back from the newest before.json (background removed when it was not set), put a kept earlier
#              picture back, or else remove the picture unless the restored background still names it; same stop and start, same snapshot and quiet checks (UNDO_FILE=<path> picks another file)
# Needed: IMAGE_SRC=/root/join-bg.webp  EXPECT_SHA256=<64 hex>  DESC_FILE=/root/join-desc.html   Optional: WORLD (curse-of-strahd),
# DEST_NAME (join-background.webp). A real run restarts Foundry on the campaign world: the user's OK and a snapshot come first,
# never on a game-night day. These lines are bash, not PowerShell:
#   scp join-bg.webp join-desc.html foundry-pi:/root/
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/19-join-page-look.sh | ssh foundry-pi 'IMAGE_SRC=/root/join-bg.webp EXPECT_SHA256=<sha> DESC_FILE=/root/join-desc.html DRY_RUN=1 bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/19-join-page-look.sh | ssh foundry-pi 'IMAGE_SRC=... EXPECT_SHA256=... DESC_FILE=... bash -s'
# Tests only: WORLDS_DIR points at a stand-in for /var/lib/foundry/Data/worlds, JOIN_URL for http://127.0.0.1:30000.

dry="${DRY_RUN:-0}"
undo="${UNDO:-0}"
world="${WORLD:-curse-of-strahd}"
dest_name="${DEST_NAME:-join-background.webp}"
src="${IMAGE_SRC:-}"
desc_file="${DESC_FILE:-}"
want_sha="${EXPECT_SHA256:-}"
max_bytes="${MAX_BYTES:-5242880}"
worlds_dir="${WORLDS_DIR:-$FOUNDRY_DATA/Data/worlds}"
base_url="${JOIN_URL:-http://127.0.0.1:30000}"
store="$TOOL_DATA/join-page-look"
gm_unit=foundry-ai-tool-gm-browser.service
node="$NODE_DIR/bin/node"

require_root
[[ "$world" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "odd world id: $world"
[[ "$dest_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*\.webp$ ]] || die "DEST_NAME must be a plain .webp file name: $dest_name"
[[ "$want_sha" =~ ^[0-9a-f]{64}$ ]] || die "set EXPECT_SHA256 to the picture's sha256 (64 lower-case hex characters)"
dir="$worlds_dir/$world"
dest="$dir/$dest_name"
world_json="$dir/world.json"
[ -d "$dir" ] && [ ! -L "$dir" ] || die "no world folder $dir"
[ -f "$world_json" ] && [ ! -L "$world_json" ] || die "no $world_json"
[ -x "$node" ] || die "no $node"

sha_of() { sha256sum "$1" | cut -d' ' -f1; }
# Prints one field of world.json as JSON ("null" when absent).
field() { "$node" -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify(o[process.argv[2]]??null))' "$world_json" "$1"; }

if [ "$undo" = 1 ]; then
  before="${UNDO_FILE:-$(ls -1 "$store/" 2>/dev/null | grep -E "^[0-9]{8}-[0-9]{6}-$world-before\.json$" | tail -n 1 | sed "s#^#$store/#" || true)}"
  [ -n "$before" ] && [ -f "$before" ] || die "no before.json for $world in $store: nothing to undo from"
  say "undo from $before"
  echo "    now:    background $(field background)"
  echo "    before: $("$node" -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write("background "+JSON.stringify(o.background)+", description "+JSON.stringify(o.description).slice(0,90))' "$before")"
else
  [ -n "$src" ] || die "set IMAGE_SRC to the picture file on the Pi"
  [ -f "$src" ] && [ ! -L "$src" ] || die "$src is not a regular file"
  size="$(stat -c %s "$src")"
  [ "$size" -gt 0 ] && [ "$size" -le "$max_bytes" ] || die "$src is $size bytes (limit $max_bytes)"
  [ "$(sha_of "$src")" = "$want_sha" ] || die "$src does not match EXPECT_SHA256: the wrong file, or it changed after copying"
  [ "$(head -c 4 "$src")" = RIFF ] && [ "$(tail -c +9 "$src" | head -c 4)" = WEBP ] || die "$src is not a webp file"
  [ -n "$desc_file" ] || die "set DESC_FILE to the description (an HTML file) on the Pi"
  [ -f "$desc_file" ] && [ ! -L "$desc_file" ] || die "$desc_file is not a regular file"
  [ "$(stat -c %s "$desc_file")" -gt 0 ] && [ "$(stat -c %s "$desc_file")" -le 20480 ] || die "$desc_file must be 1 to 20480 bytes"
  say "picture $src ($size bytes, sha256 ${want_sha:0:12}) as $dest_name, description from $desc_file, world $world"
  echo "    now: background $(field background), description $(field description | cut -c1-90)"
fi

# The new values, as a JSON string for the edit below.
bg_new="worlds/$world/$dest_name"
if [ "$undo" != 1 ]; then
  desc_new="$(cat "$desc_file")"
  if [ "$(field background)" = "\"$bg_new\"" ] && [ "$(field description)" = "$("$node" -e 'process.stdout.write(JSON.stringify(process.argv[1]))' -- "$desc_new")" ] \
    && [ -f "$dest" ] && [ "$(sha_of "$dest")" = "$want_sha" ]; then
    ok "the world already has this picture and description: nothing to change"
    if have_systemd && ! systemctl is-active --quiet foundry.service; then
      warn "Foundry is not running (a run that was cut off?): systemctl start foundry.service"
    fi
    exit 0
  fi
fi

if have_systemd; then
  refuse_during_system_trial "stage 19"
  ! systemctl is-active --quiet foundry-ai-tool-kit-gm-browser.service || die "a kit session is running (the kit GM browser): stage 19 would stop its Foundry. Nothing was changed"
fi
foundry_can_write "$dir" || die "the foundry user cannot write in $dir: nothing was changed"

if [ "$dry" = 1 ]; then
  if have_systemd && [ "$(curl -fs --max-time 5 "$base_url/join" 2>/dev/null | grep -c 'id="join-game"' || true)" -eq 0 ]; then
    warn "$base_url/join shows no id=\"join-game\" marker: a real run could not tell that Foundry is up"
  fi
  if [ "$undo" = 1 ]; then
    say "dry run: would stop Foundry, put the before values back and start it again; nothing changed"
  else
    say "dry run: would stop Foundry, install $dest, set background $bg_new and the description, start Foundry again; nothing changed"
  fi
  exit 0
fi

require_recent_snapshot
require_quiet "setting the join page look of $world"

stamp="$(date +%Y%m%d-%H%M%S)"
install -d -m 755 "$store"
# A dropped SSH connection must not kill the stage while Foundry is stopped: the next line of output would raise SIGPIPE.
trap '' HUP PIPE
STAGE_LOG="$store/$stamp-$world-run.log"

# The picture a rerun would overwrite is kept, so UNDO can put it back.
prev="" staged=""
# Root never writes into the foundry-owned world folder (lib.sh: a link left there would be followed): the picture is staged
# here as a root-owned file and put in place with foundry_copy_file, and a link at the destination is refused.
[ ! -L "$dest" ] || die "$dest is a link: not touching it. Nothing was changed"
if [ "$undo" != 1 ] && [ -f "$dest" ] && [ "$(sha_of "$dest")" != "$want_sha" ]; then
  prev="$store/$stamp-$world-$dest_name.prev"
  # Read as the foundry user: root `install` on a path foundry owns would follow a link swapped in after the check above.
  runuser -u "$FOUNDRY_USER" -- cat -- "$dest" >"$prev" && chmod 644 "$prev" || die "could not keep the picture now in the world. Nothing was changed"
  ok "the picture now in the world is kept as $prev"
fi
if [ "$undo" != 1 ]; then
  staged="$store/$stamp-$world-$dest_name.new"
  install -m 644 "$src" "$staged"
  [ "$(sha_of "$staged")" = "$want_sha" ] || die "the staged picture's hash differs from EXPECT_SHA256. Nothing was changed"
fi
if [ "$undo" != 1 ]; then
  "$node" -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));fs.writeFileSync(process.argv[2],JSON.stringify({hadBackground:"background" in o,background:o.background??null,hadDescription:"description" in o,description:o.description??null,picture:process.argv[3],prevPicture:process.argv[4]||null},null,2)+"\n")' \
    "$world_json" "$store/$stamp-$world-before.json" "$dest_name" "$prev"
  ok "the values before this run: $store/$stamp-$world-before.json"
fi

copy="$store/$stamp-$world-world.json.bak"
was_foundry=0 was_gm=0 stopped=0
if have_systemd; then
  systemctl is-active --quiet foundry.service && was_foundry=1
  systemctl is-active --quiet "$gm_unit" && was_gm=1
fi
# Foundry writes world.json itself on exit (play time): the copy is taken, and the restore done, only while Foundry is stopped.
restore() {
  [ "$stopped" = 1 ] || return 0
  warn "the run did not finish: world.json is put back and the services start again"
  systemctl stop foundry.service || true
  foundry_copy_file "$copy" "$world_json" || warn "could not put $copy back over $world_json"
  if [ -n "$prev" ] && [ -f "$prev" ]; then foundry_copy_file "$prev" "$dest" || true; fi
  # The next UNDO must not start from the values of a run that did not finish.
  if [ -f "$store/$stamp-$world-before.json" ]; then mv -f "$store/$stamp-$world-before.json" "$store/$stamp-$world-failed.json" || true; fi
  [ "$was_foundry" = 1 ] && { systemctl start foundry.service || true; }
  [ "$was_gm" = 1 ] && { systemctl start "$gm_unit" || true; }
  return 0
}
trap restore EXIT

if have_systemd; then
  say "stopping the Assistant GM browser and Foundry"
  stopped=1
  systemctl stop "$gm_unit" 2>/dev/null || true
  systemctl stop foundry.service
fi
cp -a "$world_json" "$copy"

if [ "$undo" = 1 ]; then
  foundry_edit_json "$world_json" 'const b=JSON.parse(require("fs").readFileSync(a[0],"utf8"));if(b.hadBackground)o.background=b.background;else delete o.background;if(b.hadDescription)o.description=b.description;else delete o.description' "$before"
else
  foundry_copy_file "$staged" "$dest"
  [ "$(sha_of "$dest")" = "$want_sha" ] || die "the installed picture's hash differs from EXPECT_SHA256"
  ok "installed $dest"
  foundry_edit_json "$world_json" 'o.background=a[0];o.description=a[1]' "$bg_new" "$desc_new"
fi
ok "world.json: background $(field background)"

if have_systemd && [ "$was_foundry" = 1 ]; then
  say "starting Foundry"
  systemctl start foundry.service
  up=0
  for _ in $(seq 1 60); do
    if [ "$(curl -fs --max-time 5 "$base_url/join" 2>/dev/null | grep -c 'id="join-game"' || true)" -gt 0 ]; then up=1; break; fi
    sleep 2
  done
  [ "$up" = 1 ] || die "the join page does not answer on $base_url (journalctl -u foundry -n 50); world.json is put back"
  stopped=0
  [ "$was_gm" = 1 ] && { systemctl start "$gm_unit" || warn "the Assistant GM browser did not start: journalctl -u $gm_unit -n 50"; }
  ok "Foundry is up again"
  if [ "$undo" != 1 ]; then
    [ "$(curl -fs --max-time 10 "$base_url/join" 2>/dev/null | grep -c "$bg_new" || true)" -gt 0 ] || die "/join does not name $bg_new (world.json is written and stays; check the page and journalctl -u foundry)"
    [ "$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' "$base_url/$bg_new")" = 200 ] || die "$bg_new is not served with HTTP 200 (world.json is written and stays)"
    ok "/join names $bg_new and the picture is served"
  fi
elif have_systemd; then
  stopped=0
  [ "$was_gm" = 1 ] && { systemctl start "$gm_unit" || true; }
  ok "Foundry was not running before this run: left stopped"
fi
trap - EXIT
if [ "$undo" = 1 ]; then
  # After Foundry is up with the old values: a failed start has then already put world.json back, with its picture still there.
  prev_pic="$("$node" -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(o.prevPicture||"")' "$before")"
  if [ -n "$prev_pic" ] && [ -f "$prev_pic" ]; then
    foundry_copy_file "$prev_pic" "$dest"
    ok "put the earlier $dest_name back"
  elif [ "$(field background)" != "\"$bg_new\"" ] && [ -f "$dest" ] && [ "$(sha_of "$dest")" = "$want_sha" ]; then
    rm -f -- "${dest:?}"
    ok "removed $dest_name"
  fi
fi
ok "done; check /join logged out (a private window), then reload once"
