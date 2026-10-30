#!/usr/bin/env bash
# Stage 19: put the join page background image into a world's folder (backlog join-page-look). The image is campaign art, so it is
# never in the repo: copy it to the Pi first and give the stage its sha256.
#
# Why a stage and not the GM script: gm-script.sh limits a script file to 1 MB, and a base64 copy of a 0.9 MB webp is 1.3 MB.
# The image only has to be a file in the world's folder; the GM script (scripts/pi/gm-scripts/join-page-look.js) then
# points the world's Background Image setting at it and sets the description.
#
# What it does, in this order, and stops before the next step when one fails:
#   1. refuses unless IMAGE_SRC is a regular file (not a link), EXPECT_SHA256 matches it, it is a webp (RIFF....WEBP) of at most
#      MAX_BYTES (5 MB), the world folder exists and DEST_NAME is a plain file name;
#   2. when the destination already holds the same file it changes nothing; a different file there is refused unless REPLACE=1
#      (the old one is kept as <name>.old);
#   3. a real run needs a dietpi-backup snapshot from today; it installs the file as the foundry user's, mode 644, and checks the hash.
# Nothing else is touched: no service is stopped or restarted, Foundry serves the file as it is.
#
# Modes (environment, before bash):
#   DRY_RUN=1  print what a real run would do; changes nothing, needs no snapshot
#   UNDO=1     remove the destination file again (only when it still has EXPECT_SHA256), or put <name>.old back
# Needed: IMAGE_SRC=/root/join-bg.webp  EXPECT_SHA256=<64 hex>   Optional: WORLD (curse-of-strahd), DEST_NAME (join-background.webp)
# A real run changes the campaign world's folder: the user's OK and a snapshot come first. These lines are bash, not PowerShell:
#   scp join-bg.webp foundry-pi:/root/
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/19-join-image.sh | ssh foundry-pi 'IMAGE_SRC=/root/join-bg.webp EXPECT_SHA256=<sha> DRY_RUN=1 bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/19-join-image.sh | ssh foundry-pi 'IMAGE_SRC=/root/join-bg.webp EXPECT_SHA256=<sha> bash -s'
# Tests only: WORLDS_DIR points at a stand-in for /var/lib/foundry/Data/worlds.

dry="${DRY_RUN:-0}"
undo="${UNDO:-0}"
replace="${REPLACE:-0}"
world="${WORLD:-curse-of-strahd}"
dest_name="${DEST_NAME:-join-background.webp}"
src="${IMAGE_SRC:-}"
want_sha="${EXPECT_SHA256:-}"
max_bytes="${MAX_BYTES:-5242880}"
worlds_dir="${WORLDS_DIR:-$FOUNDRY_DATA/Data/worlds}"

require_root
[[ "$world" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "odd world id: $world"
[[ "$dest_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*\.webp$ ]] || die "DEST_NAME must be a plain .webp file name: $dest_name"
[[ "$want_sha" =~ ^[0-9a-f]{64}$ ]] || die "set EXPECT_SHA256 to the image's sha256 (64 lower-case hex characters)"
dir="$worlds_dir/$world"
dest="$dir/$dest_name"
[ -d "$dir" ] && [ ! -L "$dir" ] || die "no world folder $dir"

sha_of() { sha256sum "$1" | cut -d' ' -f1; }

if [ "$undo" = 1 ]; then
  if [ -f "$dest.old" ]; then
    say "undo: would put $dest.old back"
    [ "$dry" = 1 ] && exit 0
    require_recent_snapshot
    mv -f -- "$dest.old" "$dest"
    ok "put the earlier $dest_name back"
  elif [ -f "$dest" ]; then
    [ "$(sha_of "$dest")" = "$want_sha" ] || die "$dest is not the file EXPECT_SHA256 names: not removing it"
    say "undo: would remove $dest"
    [ "$dry" = 1 ] && exit 0
    require_recent_snapshot
    rm -f -- "${dest:?}"
    ok "removed $dest_name"
  else
    ok "nothing at $dest: nothing to undo"
  fi
  exit 0
fi

[ -n "$src" ] || die "set IMAGE_SRC to the image file on the Pi"
[ -f "$src" ] && [ ! -L "$src" ] || die "$src is not a regular file"
size="$(stat -c %s "$src")"
[ "$size" -gt 0 ] && [ "$size" -le "$max_bytes" ] || die "$src is $size bytes (limit $max_bytes)"
[ "$(sha_of "$src")" = "$want_sha" ] || die "$src does not match EXPECT_SHA256: the wrong file, or it changed after copying"
[ "$(head -c 4 "$src")" = RIFF ] && [ "$(tail -c +9 "$src" | head -c 4)" = WEBP ] || die "$src is not a webp file"
say "image $src ($size bytes, sha256 ${want_sha:0:12}) for world $world as $dest_name"

if [ -f "$dest" ]; then
  if [ "$(sha_of "$dest")" = "$want_sha" ]; then
    ok "$dest already holds this image: nothing to change"
    exit 0
  fi
  [ "$replace" = 1 ] || die "$dest exists with other content: REPLACE=1 keeps it as $dest_name.old and installs this image"
  say "would keep the existing file as $dest_name.old"
fi

if [ "$dry" = 1 ]; then
  say "dry run: would install $dest (owner $FOUNDRY_USER, mode 644); nothing changed"
  exit 0
fi

require_recent_snapshot
if [ -f "$dest" ]; then
  [ ! -e "$dest.old" ] || die "$dest.old already exists: not overwriting it"
  mv -- "$dest" "$dest.old"
fi
install -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" -m 644 "$src" "$dest"
[ "$(sha_of "$dest")" = "$want_sha" ] || die "the installed file's hash differs from EXPECT_SHA256"
ok "installed $dest ($(stat -c '%U:%G %a' "$dest"))"
