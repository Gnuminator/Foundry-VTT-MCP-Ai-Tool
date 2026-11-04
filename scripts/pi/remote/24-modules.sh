#!/usr/bin/env bash
# Stage 24: install the pinned Foundry modules from the PC's module archive (docs/dev/MODULE-REHEARSAL.md, "Pi: install
# from the archive"). It reads $MIRROR/pinned.json (the PC archive's mirror, put on the Pi with the scp that
# `node scripts/modules/rehearse.mjs pi-plan` prints), and for every pinned module that is not at its pinned version:
# stops the Assistant GM browser and Foundry, moves the old folder to $IMPORT/prev-<time>-modules/<id>, puts the pinned
# version in its place, starts Foundry again and reads the result back. It never downloads, never installs a version
# that is not pinned, and never switches a module on in a world: installing is not activating (the Admin set tools or
# Manage Modules do that, a separate step).
#   Only "modules" in pinned.json are installed. Systems are stage 14's (dnd5e) and Foundry is stage 3's; the bridge
#   (foundry-mcp-bridge) is stage 5's and aitool-content is stage 11's: a pin for either is skipped with a line.
#
# Order in a Pi sitting: stages 3, 14, 5 and 13 first (Foundry 14.369 needs the installed login drivers to know its user
# select, see the refusal below), this stage next, the Docker cutover (stages 22-docker and 23, refused here once the
# stack is cut over) after it. Run it on the strahd-kit world first (kit-session.sh MODE=up, then the Pi kit run), then
# on the real world; a snapshot before each. Stage 22 (seven books) runs after the content modules changed.
#
# Nothing changes before the checks pass, and the checks are the whole of a dry run (no APPLY): the pins and the
# mirror, every zip's sha256 (of a copy), its entry names (no absolute path, no "..", no link or device in what is
# unpacked), the module.json inside (its id and version must be the pin's), the room on the disk, and (for a real run) a
# snapshot from today, nobody online and no recording, no kit session, no open dnd5e trial. The last run's state is in
# $STATE; UNDO=1 puts that run's old folders back (a module that had no old folder is moved aside, never deleted).
# A real run that fails after Foundry stopped (an unpack, a move, the start, the read-back) undoes what it did in the
# same way and starts Foundry and the Assistant GM browser as they were. Nothing is deleted: old and replaced folders
# stay under $IMPORT (prev-<time>-modules, failed-<time>-modules) until the user removes them.
#
#   scp -r <archive>/modules <archive>/pinned.json foundry-pi:<MIRROR>/     (pi-plan prints the command)
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/24-modules.sh | ssh foundry-pi 'bash -s'            a dry run
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/24-modules.sh | ssh foundry-pi 'APPLY=1 bash -s'    the real run
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/24-modules.sh | ssh foundry-pi 'UNDO=1 bash -s'     the last run back
# Env (in front of bash): APPLY=1 (anything else but empty is refused), UNDO=1, MIRROR (default
# /home/dietpi/module-archive), ONLY (comma separated module ids: install just those), FORCE=1 (players or recording
# check only, never the snapshot). Take the snapshot (/boot/dietpi/dietpi-backup 1) and get the user's OK before APPLY=1
# or UNDO=1. The one run at a time is a lock in $IMPORT; every line also goes to $STATE_LOG.

require_root
MIRROR="${MIRROR:-/home/dietpi/module-archive}"
ONLY="${ONLY:-}"
APPLY="${APPLY:-}"
UNDO="${UNDO:-}"
IMPORT=/var/lib/foundry-import
STATE="$IMPORT/modules-stage.state"
STATE_LOG="$IMPORT/modules-stage.log"
data="$FOUNDRY_DATA/Data"
moddir="$data/modules"
stamp="$(date +%Y%m%d-%H%M%S)"
export PATH="$NODE_DIR/bin:$PATH"
ID_RE='^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$'
VERSION_RE='^[A-Za-z0-9][A-Za-z0-9_.+-]{0,60}$'

case "$APPLY" in "" | 1) ;; *) die "APPLY must be 1 or left out (got '$APPLY'). Nothing was changed" ;; esac
case "$UNDO" in "" | 1) ;; *) die "UNDO must be 1 or left out (got '$UNDO'). Nothing was changed" ;; esac
[ -z "$APPLY" ] || [ -z "$UNDO" ] || die "APPLY=1 and UNDO=1 together: pick one. Nothing was changed"
[[ "$MIRROR" == /* && "$MIRROR" != *..* ]] || die "MIRROR must be an absolute path without '..' (got '$MIRROR'). Nothing was changed"
[ -x "$NODE_DIR/bin/node" ] || die "no Node at $NODE_DIR: run stage 2 first. Nothing was changed"
command -v unzip >/dev/null || die "unzip is not installed (apt install unzip). Nothing was changed"
[ -d "$moddir" ] || die "no $moddir: Foundry has not run here yet (stage 3). Nothing was changed"
[ ! -e "$TOOL_DATA/kit-session.env" ] || die "a kit session is up ($TOOL_DATA/kit-session.env exists, the Kit GM browser holds strahd-kit): run kit-session.sh MODE=down first. Nothing was changed"
refuse_during_system_trial "stage 24 (modules)"
install -d -m 700 "$IMPORT"
exec 9>"$IMPORT/modules-stage.lock"
flock -n 9 || die "another stage 24 run holds $IMPORT/modules-stage.lock. Nothing was changed"
trap '' HUP PIPE
[ -n "$APPLY$UNDO" ] || STAGE_LOG=""
if [ -n "$UNDO" ]; then run_word=UNDO; elif [ -n "$APPLY" ]; then run_word=APPLY; else run_word="dry run"; fi
ok "$run_word started${STAGE_LOG:+ (logged in $STAGE_LOG)}"
[ -z "$APPLY$UNDO" ] || require_recent_snapshot

# ---- helpers -----------------------------------------------------------------------------------------------
json_get() { # $1 file, $2 key: one printable string field of a JSON file (a BOM is allowed); empty when missing
  node -e 'try{let s=require("fs").readFileSync(process.argv[1],"utf8").replace(/^﻿/,"");const v=JSON.parse(s)[process.argv[2]];if(v!=null)process.stdout.write(String(v).replace(/[^\w.+-]/g,"?").slice(0,60))}catch{}' "$1" "$2"
}
mod_version() { json_get "$moddir/$1/module.json" version; }
world_up() { curl -fs http://127.0.0.1:30000/join 2>/dev/null | grep -q 'id="join-game"'; }
free_path() { # $1, or $1.2, $1.3 ... when it exists
  local p="$1" n=2
  while [ -e "$p" ] || [ -L "$p" ]; do
    p="$1.$n"
    n=$((n + 1))
  done
  printf '%s' "$p"
}
check_room() { # $1 a path on the filesystem, $2 the bytes the run writes there (the storage rule of stage 10)
  local avail size left pct
  read -r avail size < <(df --output=avail,size -B1 "$1" | tail -n1)
  [ "${size:-0}" -gt 0 ] || die "cannot read the free space of $1. Nothing was changed"
  left=$((avail - $2))
  pct=$((left * 100 / size))
  if [ "$left" -lt $((size / 20)) ]; then
    die "not enough space: $avail bytes free, the run writes $2, which would leave $pct% (under 5%). Nothing was changed"
  elif [ "$pct" -lt 20 ]; then
    warn "space gets low: $pct% free after the run's $2 bytes (the rule is 20%); going on"
  else
    ok "room for the run's $2 bytes ($pct% free after)"
  fi
}

# The state file: stamp=, prev= (where the old folders went), failed= (where replaced new ones go), phase= and one
# module=<id>|<old version or NONE>|<new version> per module the run changes. It is written (atomically) before the
# first move, so the trap and UNDO=1 know every folder that may have moved.
state_get() { [ -f "$STATE" ] && sed -n "s/^$1=//p" "$STATE" | head -n1 || true; }
state_modules() { [ -f "$STATE" ] && sed -n 's/^module=//p' "$STATE" || true; }
state_phase() { # $1 the phase word: rewrites that one line
  { grep -v '^phase=' "$STATE" || true; printf 'phase=%s\n' "$1"; } >"$STATE.new"
  mv -f "$STATE.new" "$STATE"
}

# Puts the folders back that the state file lists: the old one from prev/<id> when it moved, and the new folder aside to
# failed/<id> (only when it is the state's new version, or when the old one moved out and something else sits in its
# place). A module with no old folder (old NONE) is moved aside when its new folder is there. Safe to run twice.
undo_state() {
  local prev failed id old new moved=0 cur
  prev="$(state_get prev)"
  failed="$(state_get failed)"
  [ -n "$prev" ] && [ -n "$failed" ] || return 0
  while IFS='|' read -r id old new; do
    [[ "$id" =~ $ID_RE ]] || continue
    cur="$(mod_version "$id")"
    if [ -d "$prev/$id" ]; then
      if [ -e "$moddir/$id" ] || [ -L "$moddir/$id" ]; then
        install -d -m 700 "$failed"
        mv "$moddir/$id" "$(free_path "$failed/$id")"
      fi
      mv "$prev/$id" "$moddir/$id"
      ok "$id: $old is back (replaced $new moved to $failed)"
      moved=1
    elif [ "$old" = NONE ] && [ -d "$moddir/$id" ] && [ "$cur" = "$new" ]; then
      install -d -m 700 "$failed"
      mv "$moddir/$id" "$(free_path "$failed/$id")"
      ok "$id: was not installed before, $new moved aside to $failed"
      moved=1
    fi
  done < <(state_modules)
  [ "$moved" = 1 ] || ok "nothing to put back"
}

stopped=0
was_foundry=0
was_gm_browser=0
work=""
undo=""
stop_services() {
  have_systemd || {
    warn "no systemd here (a test container?): nothing to stop"
    return 0
  }
  systemctl is-active --quiet foundry.service && was_foundry=1
  systemctl is-active --quiet foundry-ai-tool-gm-browser.service && was_gm_browser=1
  say "stopping the Assistant GM browser and Foundry"
  stopped=1
  systemctl stop foundry-ai-tool-gm-browser.service 2>/dev/null || true
  systemctl stop foundry.service
}
start_services() { # as they were before the run
  have_systemd || return 0
  if [ "$was_foundry" = 1 ]; then systemctl restart foundry.service || return 1; fi
  if [ "$was_gm_browser" = 1 ]; then
    systemctl is-active --quiet foundry-ai-tool-gm-browser.service || systemctl start foundry-ai-tool-gm-browser.service || return 1
  fi
}
on_exit() {
  [ -z "$work" ] || rm -rf "${work:?}"
  [ "$stopped" = 1 ] && have_systemd || return 0
  # Foundry may have been started again by the failed run (the read-back): stop it before folders move.
  systemctl stop foundry-ai-tool-gm-browser.service 2>/dev/null || true
  systemctl stop foundry.service 2>/dev/null || true
  if [ "$undo" = 1 ]; then
    undo_state || warn "putting the folders back did not finish (see above); the state is in $STATE"
    state_phase undone 2>/dev/null || true
  fi
  start_services || warn "Foundry or the Assistant GM browser did not come back: see journalctl -u foundry -n 50"
  warn "the run did not finish: ${undo:+the old folders are back, }Foundry and the Assistant GM browser are as they were"
}
trap on_exit EXIT

# ---- UNDO ---------------------------------------------------------------------------------------------------
if [ -n "$UNDO" ]; then
  [ -f "$STATE" ] || die "no $STATE: there is no run to undo. Nothing was changed"
  [ "$(state_get phase)" != undone ] || die "the last run ($(state_get stamp)) is already undone. Nothing was changed"
  say "UNDO: putting back the folders of the run from $(state_get stamp)"
  require_quiet "putting the old module folders back"
  stop_services
  undo=1
  undo_state
  state_phase undone
  undo=""
  start_services || die "the old folders are back, but Foundry did not start: journalctl -u foundry -n 50"
  trap - EXIT
  ok "the old module folders are back; Foundry and the Assistant GM browser are as they were"
  exit 0
fi

# ---- checks (a dry run is these) ----------------------------------------------------------------------------
say "reading $MIRROR/pinned.json"
[ -d "$MIRROR" ] && [ ! -L "$MIRROR" ] || die "no folder $MIRROR (copy the archive's modules and pinned.json there first, see the header). Nothing was changed"
[ -f "$MIRROR/pinned.json" ] && [ ! -L "$MIRROR/pinned.json" ] || die "no $MIRROR/pinned.json. Nothing was changed"
pins="$(node -e '
const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const m = o.modules;
if (!m || typeof m !== "object" || Array.isArray(m)) { console.error("pinned.json has no modules object"); process.exit(3); }
for (const [id, p] of Object.entries(m)) {
  if (!p || typeof p !== "object") { console.error("the pin of " + id + " is not an object"); process.exit(3); }
  const f = v => String(v ?? "-").replace(/[\t\r\n]/g, "?");
  console.log([id, p.version, p.file, p.sha256].map(f).join("\t"));
}
' "$MIRROR/pinned.json")" || die "cannot read the modules in $MIRROR/pinned.json. Nothing was changed"
[ -n "$pins" ] || die "pinned.json pins no module. Nothing was changed"

# Foundry 14.369 picks the user from a list in the join form; the login drivers the Pi installed from stage 5 (and the
# kit run that follows this stage) must know that or the Assistant GM browser cannot rejoin the world after the restart.
foundry_version="$(json_get "$FOUNDRY_APP/package.json" version)"
if [ -n "$foundry_version" ] && node -e 'const a=process.argv[1].split(".").map(Number),b=[14,369];process.exit((a[0]>b[0]||(a[0]===b[0]&&(a[1]??0)>=b[1]))?0:1)' "$foundry_version"; then
  driver="$TOOL_DIR/gm-browser/assistant-gm.mjs"
  if [ -f "$driver" ] && ! grep -q selectOption "$driver"; then
    die "Foundry $foundry_version picks the user from a list, but the installed $driver only types the name (it has no selectOption): run stage 5 (and 13) again first. Nothing was changed"
  fi
fi

work="$IMPORT/work-$stamp-modules"
install -d -m 755 "$work"
[ "$(stat -c %d "$work")" = "$(stat -c %d "$moddir")" ] || die "$work and $moddir are on different filesystems: the folder moves would copy. Nothing was changed"

plan=() # id|old|new|croot (the unpacked folder that holds module.json)
bytes=0
unchanged=0
while IFS=$'\t' read -r id version file sha; do
  if [ -n "$ONLY" ] && [[ ",$ONLY," != *",$id,"* ]]; then continue; fi
  case "$id" in
    foundry-mcp-bridge | aitool-content)
      warn "$id is pinned, but it is not installed by this stage (stage 5 installs the bridge, stage 11 the content module): skipped"
      continue
      ;;
  esac
  [[ "$id" =~ $ID_RE ]] && [[ "$id" != *..* ]] || die "'$id' is not a safe module id in pinned.json. Nothing was changed"
  [[ "$version" =~ $VERSION_RE ]] && [[ "$version" != *..* ]] || die "$id: '$version' is not a safe version in pinned.json. Nothing was changed"
  [ "$file" = "modules/$id/$version/$id-$version.zip" ] || die "$id: the pin's file is '$file', not modules/$id/$version/$id-$version.zip. Nothing was changed"
  [[ "$sha" =~ ^[0-9a-f]{64}$ ]] || die "$id: the pin has no sha256 (64 hex digits). Nothing was changed"
  zip="$MIRROR/$file"
  [ -f "$zip" ] && [ ! -L "$zip" ] || die "$id: no file $zip (a link does not count). Nothing was changed"
  # Everything below works on a copy, so the file cannot change between the check and the unpack.
  install -d -m 755 "$work/$id"
  cp -- "$zip" "$work/$id.zip"
  chmod 644 "$work/$id.zip"
  got="$(sha256sum "$work/$id.zip" | cut -d' ' -f1)"
  [ "$got" = "$sha" ] || die "$id: the zip's sha256 is $got, not the pinned $sha: damaged or not the pinned build. Nothing was changed"
  while IFS= read -r name; do
    case "$name" in
      /* | *\\* | ../* | */../* | */.. | ..) die "$id: the zip has an entry outside its folder (\"$name\"). Nothing was changed" ;;
    esac
  done < <(unzip -Z1 "$work/$id.zip" </dev/null)
  # zipinfo marks a link with an "l" in its permission column; root unpacks, so none may be written (an entry through a
  # link could land anywhere). The folder is handed to the foundry user when it moves into place.
  ! unzip -Z "$work/$id.zip" </dev/null | grep -q '^l' || die "$id: the zip holds a link. Nothing was changed"
  unzip -q "$work/$id.zip" -d "$work/$id" </dev/null || die "$id: cannot unpack the zip. Nothing was changed"
  rm -f "$work/$id.zip"
  [ -z "$(find "$work/$id" ! -type f ! -type d -print -quit)" ] || die "$id: the zip holds a link or special file. Nothing was changed"
  croot=""
  if [ -f "$work/$id/module.json" ]; then
    croot="$work/$id"
  else
    for d in "$work/$id"/*/; do
      if [ -f "${d}module.json" ]; then
        croot="${d%/}"
        break
      fi
    done
  fi
  [ -n "$croot" ] || die "$id: the zip has no module.json (at its root or one folder down). Nothing was changed"
  inner_id="$(json_get "$croot/module.json" id)"
  inner_version="$(json_get "$croot/module.json" version)"
  [ "$inner_id" = "$id" ] || die "$id: the zip holds module '${inner_id:-?}'. Nothing was changed"
  [ "$inner_version" = "$version" ] || die "$id: the zip's module.json says version '${inner_version:-?}', the pin says $version. Nothing was changed"
  old="$(mod_version "$id")"
  if [ -L "$moddir/$id" ]; then die "$moddir/$id is a link. Nothing was changed"; fi
  if [ "$old" = "$version" ]; then
    unchanged=$((unchanged + 1))
    out "    $id $version: already installed"
    continue
  fi
  if [ ! -e "$moddir/$id" ]; then
    old=NONE
  elif [ -z "$old" ]; then
    warn "$id: $moddir/$id has no readable module.json; it will be moved aside like an old version"
    old=unknown
  fi
  plan+=("$id|$old|$version|$croot")
  bytes=$((bytes + $(du -sb "$croot" | cut -f1)))
  out "    $id: ${old/NONE/not installed} -> $version"
done <<<"$pins"

if [ -n "$ONLY" ]; then
  for want in ${ONLY//,/ }; do
    cut -f1 <<<"$pins" | grep -qxF -- "$want" || die "ONLY names $want, which is not in pinned.json. Nothing was changed"
  done
fi
ok "${#plan[@]} module(s) to change, $unchanged already at the pinned version"
if [ "${#plan[@]}" -eq 0 ]; then
  ok "nothing to do"
  trap - EXIT
  [ -z "$work" ] || rm -rf "${work:?}"
  exit 0
fi
check_room "$IMPORT" "$((bytes * 2))"

if [ -z "$APPLY" ]; then
  ok "dry run: nothing was changed (APPLY=1 for the real run, after a snapshot and the user's OK)"
  trap - EXIT
  rm -rf "${work:?}"
  exit 0
fi

# ---- the real run -------------------------------------------------------------------------------------------
require_quiet "installing modules"
prev="$IMPORT/prev-$stamp-modules"
failed="$IMPORT/failed-$stamp-modules"
install -d -m 700 "$prev"
[ ! -f "$STATE" ] || mv -f "$STATE" "$STATE.last"
{
  printf 'stamp=%s\nprev=%s\nfailed=%s\nphase=installing\n' "$stamp" "$prev" "$failed"
  for row in "${plan[@]}"; do
    IFS='|' read -r id old new _ <<<"$row"
    printf 'module=%s|%s|%s\n' "$id" "$old" "$new"
  done
} >"$STATE.new"
mv -f "$STATE.new" "$STATE"
ok "state written to $STATE (UNDO=1 reads it)"

stop_services
undo=1
for row in "${plan[@]}"; do
  IFS='|' read -r id old new croot <<<"$row"
  [ ! -e "$moddir/$id" ] || mv "$moddir/$id" "$prev/$id"
  mv "$croot" "$moddir/$id"
  chown -R "$FOUNDRY_USER:$FOUNDRY_USER" "$moddir/$id"
  ok "$id: ${old/NONE/not installed} -> $new (old folder: $prev/$id)"
done

# ---- start and read back --------------------------------------------------------------------------------------
if have_systemd; then
  say "starting Foundry again"
  systemctl restart foundry.service
  for _ in $(seq 1 60); do
    world_up && break
    sleep 2
  done
  world_up || die "Foundry's world did not come back on port 30000 (the old folders are put back; see: journalctl -u foundry -n 50)"
  ok "Foundry is up"
  if [ "$was_gm_browser" = 1 ]; then
    enable_unit foundry-ai-tool-gm-browser.service
    joined=0
    for _ in $(seq 1 45); do
      if journalctl -u foundry-ai-tool-gm-browser --since '-3 min' --no-pager | grep -q 'joined world'; then
        joined=1
        break
      fi
      sleep 2
    done
    [ "$joined" = 1 ] || die "the Assistant GM browser did not join the world again (the old folders are put back; see: journalctl -u foundry-ai-tool-gm-browser -n 30)"
    ok "the Assistant GM browser joined the world"
  fi
else
  warn "no systemd here (a test container?): Foundry and the Assistant GM browser were not started"
fi
say "reading the installed folders back"
for row in "${plan[@]}"; do
  IFS='|' read -r id old new _ <<<"$row"
  now="$(mod_version "$id")"
  [ "$now" = "$new" ] || die "$id: $moddir/$id/module.json says '${now:-?}', not the pinned $new (the old folders are put back)"
  [ "$(stat -c %U "$moddir/$id/module.json")" = "$FOUNDRY_USER" ] || die "$id: module.json is not owned by $FOUNDRY_USER (the old folders are put back)"
  ok "$id $now"
done
# Foundry reads the module folders at start; the journal since the restart names a module it could not read.
if have_systemd; then
  bad="$(journalctl -u foundry --since '-5 min' --no-pager 2>/dev/null | grep -iE 'module.*(failed|error|invalid)' | head -n 5 || true)"
  [ -z "$bad" ] || warn "Foundry's log since the start mentions a module problem:"$'\n'"$bad"
fi

undo=""
state_phase installed
trap - EXIT
rm -rf "${work:?}"
ok "done: ${#plan[@]} module(s) installed; the old folders are in $prev. Switching them on in the world is the next step (Manage Modules or the Admin set tools), then the module errors check. UNDO=1 puts the old folders back"
